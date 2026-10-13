// Class Board (Google Sheets + Apps Script practice)
//
// - Writing a post: anyone
// - Reading posts / commenting / deleting: teacher only (password required)
// ★ Be sure to change this to a password only you know.
const TEACHER_PASSWORD = '1234';

// Spreadsheet ID (optional)
// If you opened this from the spreadsheet via [Extensions → Apps Script], leave it empty.
// If you created the project directly at script.google.com, paste the long string
// between /d/ and /edit in the spreadsheet's URL here.
const SPREADSHEET_ID = '';

// Name of the sheet where posts are stored (created automatically if missing)
const SHEET_NAME = 'Board';

// Time zone
const TIME_ZONE = 'America/Bogota';

// ---------------------------------------------------------------
// Open the web app
// ---------------------------------------------------------------
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Class Board')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------
// What anyone can do: leave a post
// ---------------------------------------------------------------
function addPost(name, title, content) {
  name = clean_(name, 20, 'Name');
  title = clean_(title, 50, 'Title');
  content = clean_(content, 1000, 'Content');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // handle posts one at a time so simultaneous writes don't collide
  try {
    const sheet = getSheet_();
    const row = sheet.getLastRow() + 1;
    const id = row === 2 ? 1 : Number(sheet.getRange(row - 1, 1).getValue()) + 1;
    const time = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd HH:mm');

    const range = sheet.getRange(row, 1, 1, 6);
    range.setNumberFormat('@'); // store as plain text (text starting with = or + won't become a formula)
    range.setValues([[String(id), time, name, title, content, '']]);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// ---------------------------------------------------------------
// What only the teacher can do
// ---------------------------------------------------------------

// Read the list of posts (newest first)
function getPosts(password) {
  checkTeacher_(password);
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  return values
    .map(function (r) {
      return {
        id: String(r[0]),
        time: String(r[1]),
        name: String(r[2]),
        title: String(r[3]),
        content: String(r[4]),
        comment: String(r[5])
      };
    })
    .reverse();
}

// Add a comment (multiple comments stack up underneath)
function addComment(password, id, text) {
  checkTeacher_(password);
  text = clean_(text, 300, 'Comment');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, id);
    if (row === -1) throw new Error('Post not found. It may have already been deleted.');

    const cell = sheet.getRange(row, 6);
    const stamp = Utilities.formatDate(new Date(), TIME_ZONE, 'MM-dd HH:mm');
    const line = '[' + stamp + '] ' + text;
    const old = String(cell.getValue());
    cell.setNumberFormat('@');
    cell.setValue(old ? old + '\n' + line : line);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// Delete a post
function deletePost(password, id) {
  checkTeacher_(password);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, id);
    if (row === -1) throw new Error('Post not found. It may have already been deleted.');
    sheet.deleteRow(row);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// ---------------------------------------------------------------
// Helper functions (a name ending in _ can't be called from the page)
// ---------------------------------------------------------------

// Check the password — throws an error if wrong, so the code below it never runs
function checkTeacher_(password) {
  if (password !== TEACHER_PASSWORD) {
    throw new Error('Incorrect password.');
  }
}

// Get the board sheet (creates it with a header row if missing)
function getSheet_() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheet not found. Check SPREADSHEET_ID at the top of Code.gs.');
  }
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['No.', 'Date', 'Name', 'Title', 'Content', 'Comments']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Find the row number of a post by its id (-1 if not found)
function findRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// Tidy up input: trim spaces, check it's not empty or too long
function clean_(value, max, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error('Please fill in the ' + label.toLowerCase() + '.');
  if (text.length > max) throw new Error(label + ' can be up to ' + max + ' characters.');
  return text;
}