// Team Gomoku (Apps Script web app)
//
// - Lobby: pick Red or Blue. The first player in is the host and starts the game.
// - Red and Blue take turns. Inside a team, members take turns in join order.
// - Five or more in a row wins.
// - 3-3 rule: a move that makes two open threes at once is not allowed
//   (for both teams), unless that move makes five.
//
// Game state lives in CacheService, not a spreadsheet: every player asks for
// the state every 1.5 s, and a sheet would hit its quota and be too slow.
// One deployment = one game room.

const SIZE = 15;               // 15 x 15 board
const STATE_KEY = 'omok_state';
const CACHE_TTL = 21600;       // 6 hours, the CacheService maximum
const LEAVE_MS = 10000;        // no poll for 10 s -> the player has left and is removed
const BAN_33 = true;           // false = allow 3-3 (double three)

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Team Gomoku')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Run this from the editor to wipe the room (everyone goes back to the name screen).
function resetRoom() {
  cache_().remove(STATE_KEY);
}

// ----- Called from index.html -----

// Runs for every player every 1.5 s, so normally it only reads, with no lock.
// Only when someone has gone quiet does it take the lock and remove them.
function poll(key) {
  const me = pid_(key);
  touch_(me);
  let st = load_();
  let age = seenMap_(st);
  if (hasLeft_(st, age, me)) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(1000)) {
      try {
        st = load_();
        age = seenMap_(st);
        if (purge_(st, age, me)) save_(st, age);
      } finally {
        lock.releaseLock();
      }
    }
  }
  return { state: view_(st, me, age) };
}

// The "나가기" button.
function leave(key) {
  return mutate_(key, function (st, me) {
    if (st.players[me]) removePlayer_(st, me);
  });
}

function join(key, name) {
  return mutate_(key, function (st, me) {
    name = String(name || '').trim().slice(0, 12);
    if (!name) return '이름을 적어 주세요.';
    const p = st.players[me];
    if (p) {
      p.name = name;
    } else {
      st.players[me] = { name: name, team: null, joined: Date.now() };
    }
  });
}

function setTeam(key, team) {
  return mutate_(key, function (st, me) {
    const p = st.players[me];
    if (!p) return '먼저 이름을 적고 들어오세요.';
    if (team !== 'red' && team !== 'blue') return '팀을 다시 골라 주세요.';
    if (st.phase === 'playing') {
      // Mid-game you may join a team once, at the end of its turn order.
      if (p.team) return '게임 중에는 팀을 바꿀 수 없어요.';
      st.order[team].push(me);
    }
    p.team = team;
  });
}

function start(key) {
  return mutate_(key, function (st, me, age) {
    if (host_(st, age) !== me) return '방장만 시작할 수 있어요.';
    if (st.phase === 'playing') return '이미 게임 중이에요.';
    const byJoin = function (a, b) { return st.players[a].joined - st.players[b].joined; };
    const ids = Object.keys(st.players);
    const red = ids.filter(function (id) { return st.players[id].team === 'red'; }).sort(byJoin);
    const blue = ids.filter(function (id) { return st.players[id].team === 'blue'; }).sort(byJoin);
    if (!red.length || !blue.length) return '레드와 블루에 한 명 이상씩 있어야 해요.';
    resetBoard_(st);
    st.order = { red: red, blue: blue };
    st.phase = 'playing';
  });
}

function place(key, cell) {
  return mutate_(key, function (st, me, age) {
    if (st.phase !== 'playing') return '지금은 둘 수 없어요.';
    if (current_(st, age) !== me) return '내 차례가 아니에요.';
    cell = Number(cell);
    if (!(cell >= 0 && cell < SIZE * SIZE) || cell % 1 !== 0) return '칸을 다시 골라 주세요.';
    if (st.board[cell] !== '.') return '이미 돌이 있는 칸이에요.';

    const team = st.turn;
    const stone = team === 'red' ? 'R' : 'B';
    st.board = st.board.slice(0, cell) + stone + st.board.slice(cell + 1);
    st.last = cell;
    st.moves++;

    const line = findLine_(st.board, cell, stone);
    if (line) {
      st.phase = 'over';
      st.winner = team;
      st.line = line;
      return;
    }
    // Returning an error means nothing is saved, so the stone is not placed.
    if (BAN_33 && isDoubleThree_(st.board, cell, stone)) return '삼삼(3-3)이라 둘 수 없는 자리예요.';
    if (st.moves === SIZE * SIZE) {
      st.phase = 'over';
      st.winner = 'draw';
      return;
    }
    // The next teammate is whoever comes after the person who just played.
    st.idx[team] = st.order[team].indexOf(me) + 1;
    st.turn = team === 'red' ? 'blue' : 'red';
    st.ban = BAN_33 ? banList_(st.board, st.turn === 'red' ? 'R' : 'B') : [];
  });
}

function toLobby(key) {
  return mutate_(key, function (st, me, age) {
    if (host_(st, age) !== me) return '방장만 로비로 돌아갈 수 있어요.';
    resetBoard_(st);
    st.phase = 'lobby';
  });
}

// ----- State -----

function newState_() {
  const st = { v: 1, phase: 'lobby', hostId: null, players: {}, order: { red: [], blue: [] } };
  resetBoard_(st);
  return st;
}

function resetBoard_(st) {
  st.board = new Array(SIZE * SIZE + 1).join('.');
  st.turn = 'red';
  st.idx = { red: 0, blue: 0 };
  st.last = -1;
  st.moves = 0;
  st.winner = null;
  st.line = [];
  st.ban = [];       // cells the team to move may not play (3-3)
  st.forfeit = false; // true when the game ended because a whole team left
}

function cache_() {
  return CacheService.getScriptCache();
}

function load_() {
  const raw = cache_().get(STATE_KEY);
  return raw ? JSON.parse(raw) : newState_();
}

// Call only while holding the lock.
function save_(st, age) {
  st.hostId = host_(st, age);
  st.v++;
  cache_().put(STATE_KEY, JSON.stringify(st), CACHE_TTL);
}

// Every change goes through here: one lock, one load, one save.
// Players who have left are removed first, so every action sees who is really here.
function mutate_(key, change) {
  const me = pid_(key);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    touch_(me);
    const st = load_();
    const age = seenMap_(st);
    purge_(st, age, me);
    const error = change(st, me, age);
    if (error) return { error: error, state: view_(st, me, age) };
    save_(st, age);
    return { state: view_(st, me, age) };
  } finally {
    lock.releaseLock();
  }
}

// ----- Players -----

// Each browser keeps a secret key; everyone else only ever sees its hash.
// That way nobody can play a stone under someone else's name.
function pid_(key) {
  key = String(key || '');
  if (!/^[A-Za-z0-9]{20}$/.test(key)) throw new Error('bad key');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key);
  return Utilities.base64EncodeWebSafe(digest).slice(0, 12);
}

// "Last seen" is stored per player, outside the main state, so polling needs no lock.
function touch_(id) {
  cache_().put('seen_' + id, String(Date.now()), 120);
}

// Milliseconds since each player last polled.
function seenMap_(st) {
  const ids = Object.keys(st.players);
  const got = ids.length ? cache_().getAll(ids.map(function (id) { return 'seen_' + id; })) : {};
  const now = Date.now();
  const age = {};
  ids.forEach(function (id) { age[id] = now - Number(got['seen_' + id] || 0); });
  return age;
}

function here_(age, id) {
  return age[id] < LEAVE_MS;
}

function hasLeft_(st, age, me) {
  return Object.keys(st.players).some(function (id) { return id !== me && !here_(age, id); });
}

// Remove everyone who has stopped polling. Returns true if anyone was removed.
function purge_(st, age, me) {
  let removed = false;
  Object.keys(st.players).forEach(function (id) {
    if (id !== me && !here_(age, id)) {
      removePlayer_(st, id);
      removed = true;
    }
  });
  return removed;
}

// Take a player out of the room and out of the turn order.
// If that empties a team mid-game, the other team wins.
function removePlayer_(st, id) {
  delete st.players[id];
  ['red', 'blue'].forEach(function (t) {
    const pos = st.order[t].indexOf(id);
    if (pos < 0) return;
    st.order[t].splice(pos, 1);
    if (pos < st.idx[t]) st.idx[t]--;   // keep pointing at the same next teammate
  });
  if (st.phase !== 'playing') return;
  const redGone = !st.order.red.length;
  const blueGone = !st.order.blue.length;
  if (redGone && blueGone) {
    resetBoard_(st);
    st.phase = 'lobby';
  } else if (redGone || blueGone) {
    st.phase = 'over';
    st.winner = redGone ? 'blue' : 'red';
    st.forfeit = true;
  }
}

// The host is the saved host while still here, otherwise the earliest player.
function host_(st, age) {
  if (st.hostId && st.players[st.hostId] && here_(age, st.hostId)) return st.hostId;
  const ids = Object.keys(st.players)
    .filter(function (id) { return here_(age, id); })
    .sort(function (a, b) { return st.players[a].joined - st.players[b].joined; });
  return ids[0] || null;
}

// Whose turn it is: the next teammate in order. Someone who left but was not
// removed yet (poll could not get the lock) is skipped.
function current_(st, age) {
  const list = st.order[st.turn];
  for (let k = 0; k < list.length; k++) {
    const id = list[(st.idx[st.turn] + k) % list.length];
    if (here_(age, id)) return id;
  }
  return null;
}

// ----- Rules -----

function findLine_(board, cell, stone) {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let d = 0; d < dirs.length; d++) {
    const line = [cell];
    [1, -1].forEach(function (s) {
      let rr = r + dirs[d][0] * s;
      let cc = c + dirs[d][1] * s;
      while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === stone) {
        line.push(rr * SIZE + cc);
        rr += dirs[d][0] * s;
        cc += dirs[d][1] * s;
      }
    });
    if (line.length >= 5) return line;
  }
  return null;
}

// ----- 3-3 rule -----
// An "open three" is a line that one more stone turns into an open four
// (_XXXX_, which can no longer be stopped). That covers both _XXX_ and
// broken threes like _XX_X_. Playing a stone that makes two of them, in two
// different directions, is a 3-3. The board passed in already has `cell` filled.

function isDoubleThree_(board, cell, stone) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  let threes = 0;
  for (let d = 0; d < dirs.length; d++) {
    if (makesOpenThree_(board, cell, stone, dirs[d][0], dirs[d][1])) threes++;
  }
  return threes >= 2;
}

function makesOpenThree_(board, cell, stone, dr, dc) {
  const r0 = Math.floor(cell / SIZE);
  const c0 = cell % SIZE;
  // What sits k steps from `cell` along this direction ('#' = off the board).
  function at(b, k) {
    const r = r0 + dr * k;
    const c = c0 + dc * k;
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE ? b[r * SIZE + c] : '#';
  }
  for (let k = -4; k <= 4; k++) {
    if (k === 0 || at(board, k) !== '.') continue;
    const q = (r0 + dr * k) * SIZE + (c0 + dc * k);
    const b2 = board.slice(0, q) + stone + board.slice(q + 1);
    // Is there now a run of exactly four, through both `cell` and q, open at both ends?
    for (let t = Math.max(-3, k - 3); t <= Math.min(0, k); t++) {
      let four = true;
      for (let j = t; j < t + 4; j++) {
        if (at(b2, j) !== stone) { four = false; break; }
      }
      if (four && at(b2, t - 1) === '.' && at(b2, t + 4) === '.') return true;
    }
  }
  return false;
}

// Every empty cell where `stone` would be a 3-3 (a winning move is never banned).
function banList_(board, stone) {
  const out = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (board[i] !== '.') continue;
    const b2 = board.slice(0, i) + stone + board.slice(i + 1);
    if (!findLine_(b2, i, stone) && isDoubleThree_(b2, i, stone)) out.push(i);
  }
  return out;
}

// ----- What the page sees -----

function view_(st, me, age) {
  // Hide anyone who left even if they are not removed from the state yet.
  const players = Object.keys(st.players).filter(function (id) { return here_(age, id); }).map(function (id) {
    const p = st.players[id];
    return { id: id, name: p.name, team: p.team, joined: p.joined };
  });
  players.sort(function (a, b) { return a.joined - b.joined; });
  return {
    v: st.v,
    me: me,
    size: SIZE,
    phase: st.phase,
    host: host_(st, age),
    players: players,
    order: st.order,
    turn: st.turn,
    current: st.phase === 'playing' ? current_(st, age) : null,
    board: st.board,
    last: st.last,
    winner: st.winner,
    line: st.line,
    forfeit: !!st.forfeit,
    ban:st.phase === 'playing' ? (st.ban || []) : []
  };
}
