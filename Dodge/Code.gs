var SHEET_NAME = 'Records';
var TOP_N = 10;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Missile Dodge')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, user-scalable=no');
}

// Works both as a sheet-bound script and as a standalone script
// (standalone: creates a spreadsheet once and remembers its ID).
function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  ss = SpreadsheetApp.create('Missile Dodge Records');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function getSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['Name', 'Time (s)', 'Date']);
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@'); // keep names as plain text
  }
  return sheet;
}

// Saves one run and returns the updated ranking plus this player's position.
function saveTime(name, seconds) {
  // Strip leading = + - @ so a name can never become a formula.
  var safeName = String(name || '').replace(/^[\s=+\-@]+/, '').trim().slice(0, 20) || 'Anonymous';
  var safeTime = Math.max(0, Math.round((Number(seconds) || 0) * 10) / 10);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getSheet_().appendRow([safeName, safeTime, new Date()]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return buildRanking_(safeName);
}

function getRanking() {
  return buildRanking_(null);
}

// Best time per player, longest survival first; ties go to whoever got there first.
function buildRanking_(playerName) {
  var sheet = getSheet_();
  var lastRow = sheet.getLastRow();
  var best = {};
  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    rows.forEach(function (r) {
      var name = String(r[0]).trim();
      var time = Number(r[1]);
      var at = r[2] instanceof Date ? r[2].getTime() : 0;
      if (!name || isNaN(time)) return;
      var cur = best[name];
      if (!cur || time > cur.time || (time === cur.time && at < cur.at)) {
        best[name] = { name: name, time: time, at: at };
      }
    });
  }

  var list = Object.keys(best).map(function (k) { return best[k]; });
  list.sort(function (a, b) { return b.time - a.time || a.at - b.at; });

  var myRank = 0, myBest = 0;
  if (playerName) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].name === playerName) { myRank = i + 1; myBest = list[i].time; break; }
    }
  }

  // Only plain strings/numbers: google.script.run returns null if a Date is included.
  return {
    top: list.slice(0, TOP_N).map(function (e) { return { name: e.name, time: e.time }; }),
    total: list.length,
    me: playerName || '',
    myRank: myRank,
    myBest: myBest
  };
}
