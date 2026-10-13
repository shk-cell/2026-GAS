// Classroom Call (Apps Script web app + classroom receivers)
//
// Each classroom PC runs the receiver (receiver/Receiver.exe). On first start it asks
// for a name for that place ("3학년 2반", "과학실") and then checks in every few
// seconds. The admin opens this web app, picks one or more receivers, and sends
// any message ("홍길동 지금 교무실로 와라"). It pops up on top of everything on
// those PCs, with a sound and a spoken announcement.
//
// Setup
// 1. Create a spreadsheet and open [Extensions → Apps Script] from it
//    (or create the project at script.google.com and fill in SPREADSHEET_ID).
// 2. Change ADMIN_PASSWORD below.
// 3. Deploy → New deployment → Web app
//    Execute as: Me / Who has access: Anyone  (classroom PCs cannot sign in)

const ADMIN_PASSWORD = '1234';            // ★ change: needed to see receivers and send messages

// Spreadsheet ID (optional)
// Leave empty if you opened this from the spreadsheet via [Extensions → Apps Script].
// Otherwise paste the long string between /d/ and /edit in the spreadsheet's URL.
const SPREADSHEET_ID = '';

const LOG_SHEET = '보낸메시지';
const TIME_ZONE = 'Asia/Seoul';
const ONLINE_MS = 20000;                  // checked in within 20 s -> shown as on
const KEEP_MSGS = 20;                     // recent messages kept per receiver
const CACHE_TTL = 21600;                  // 6 hours, the CacheService maximum
const SHOW_WITHIN_MS = 10 * 60 * 1000;    // receivers ignore messages older than 10 minutes

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.mode === 'poll') return json_(pollReceiver_(p));
  if (p.mode === 'ack') return json_(ackMessage_(p));
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('교실 호출')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----- Receivers (plain GET requests from callu.ps1) -----

// ?mode=poll&name=3학년 2반&after=<last message id seen>
// Also serves as the receiver's check-in. The first poll (after=-1) only
// returns the latest id, so a receiver that starts up does not replay old messages.
function pollReceiver_(p) {
  const name = clean_(p.name, 20);
  if (!name) return { error: '수신기 이름이 비어 있어요.' };
  cache_().put('seen_' + name, String(Date.now()), CACHE_TTL);
  register_(name);

  const after = Number(p.after);
  const msgs = messagesFor_(name);
  let latest = after >= 0 ? after : 0;
  msgs.forEach(function (m) { latest = Math.max(latest, m.id); });
  if (!(after >= 0)) return { latest: latest, messages: [] };

  const now = Date.now();
  const fresh = msgs.filter(function (m) { return m.id > after && now - m.id < SHOW_WITHIN_MS; });
  return { latest: latest, messages: fresh };
}

// ?mode=ack&name=...&id=<message id>  (the 확인 button on the popup)
function ackMessage_(p) {
  const name = clean_(p.name, 20);
  const id = String(Number(p.id));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = logSheet_();
    const hits = sheet.getRange('A:A').createTextFinder(id).matchEntireCell(true).findAll();
    for (let i = 0; i < hits.length; i++) {
      const row = hits[i].getRow();
      if (sheet.getRange(row, 3).getDisplayValue() === name) {
        const cell = sheet.getRange(row, 6);
        if (!cell.getDisplayValue()) cell.setValue(Utilities.formatDate(new Date(), TIME_ZONE, 'HH:mm:ss'));
        return { ok: true };
      }
    }
    return { error: '메시지를 찾을 수 없어요.' };
  } finally {
    lock.releaseLock();
  }
}

// ----- Admin page (google.script.run) -----

function loadAdmin(password) {
  checkPassword_(password);
  return { receivers: receivers_(), recent: recent_() };
}

// data = { to: [receiver names], text, from }
function sendMessage(password, data) {
  checkPassword_(password);
  const text = clean_(data && data.text, 200);
  const from = clean_(data && data.from, 20);
  const known = names_();
  const to = ((data && data.to) || []).map(function (n) { return clean_(n, 20); })
    .filter(function (n, i, all) { return n && known.indexOf(n) >= 0 && all.indexOf(n) === i; });
  if (!to.length) throw new Error('받을 곳을 골라 주세요.');
  if (!text) throw new Error('메시지를 적어 주세요.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Ids are millisecond timestamps, made strictly increasing so receivers never skip one.
    const cache = cache_();
    const id = Math.max(Date.now(), Number(cache.get('last_id') || 0) + 1);
    cache.put('last_id', String(id), CACHE_TTL);

    const msg = { id: id, text: text, from: from };
    const time = Utilities.formatDate(new Date(id), TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
    const rows = [];
    to.forEach(function (name) {
      const list = messagesFor_(name);
      list.push(msg);
      cache.put('msgs_' + name, JSON.stringify(list.slice(-KEEP_MSGS)), CACHE_TTL);
      rows.push([String(id), time, name, text, from, '']);
    });
    const sheet = logSheet_();
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { receivers: receivers_(), recent: recent_() };
}

// Remove a receiver that is no longer used (it comes back if it checks in again).
function removeReceiver(password, name) {
  checkPassword_(password);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    saveNames_(names_().filter(function (n) { return n !== name; }));
  } finally {
    lock.releaseLock();
  }
  return { receivers: receivers_(), recent: recent_() };
}

// ----- Helpers -----

function checkPassword_(password) {
  if (String(password) !== ADMIN_PASSWORD) throw new Error('비밀번호가 맞지 않아요.');
}

// Trim, cap the length, and strip leading = + - @ so text can never become a sheet formula.
function clean_(value, max) {
  return String(value == null ? '' : value).replace(/^[\s=+\-@]+/, '').trim().slice(0, max);
}

function cache_() {
  return CacheService.getScriptCache();
}

function messagesFor_(name) {
  const raw = cache_().get('msgs_' + name);
  return raw ? JSON.parse(raw) : [];
}

// Receiver names live in Script Properties (kept for good) with a cached copy,
// because every receiver polls every few seconds and Properties has a daily quota.
function names_() {
  const cached = cache_().get('receivers');
  if (cached) return JSON.parse(cached);
  const stored = PropertiesService.getScriptProperties().getProperty('receivers');
  const list = stored ? JSON.parse(stored) : [];
  cache_().put('receivers', JSON.stringify(list), CACHE_TTL);
  return list;
}

function saveNames_(list) {
  PropertiesService.getScriptProperties().setProperty('receivers', JSON.stringify(list));
  cache_().put('receivers', JSON.stringify(list), CACHE_TTL);
}

function register_(name) {
  if (names_().indexOf(name) >= 0) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    cache_().remove('receivers');   // re-read the stored list inside the lock
    const list = names_();
    if (list.indexOf(name) < 0) {
      list.push(name);
      saveNames_(list);
    }
  } finally {
    lock.releaseLock();
  }
}

// [{ name, online, seen: "HH:mm" or "" }], sorted by name.
function receivers_() {
  const list = names_().slice().sort();
  const got = list.length ? cache_().getAll(list.map(function (n) { return 'seen_' + n; })) : {};
  const now = Date.now();
  return list.map(function (name) {
    const t = Number(got['seen_' + name] || 0);
    return {
      name: name,
      online: t > 0 && now - t < ONLINE_MS,
      seen: t ? Utilities.formatDate(new Date(t), TIME_ZONE, 'MM-dd HH:mm') : ''
    };
  });
}

// Works both as a sheet-bound script and as a standalone script with SPREADSHEET_ID.
function logSheet_() {
  const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.appendRow(['ID', '시간', '받는 곳', '메시지', '보낸 사람', '확인']);
    sheet.setFrozenRows(1);
    sheet.getRange('A:F').setNumberFormat('@'); // keep ids and names as plain text
  }
  return sheet;
}

// The latest 40 rows (one per receiver per message), newest first.
function recent_() {
  const sheet = logSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const n = Math.min(40, last - 1);
  return sheet.getRange(last - n + 1, 1, n, 6).getDisplayValues().reverse().map(function (r) {
    return { id: r[0], time: r[1], to: r[2], text: r[3], from: r[4], ack: r[5] };
  });
}
