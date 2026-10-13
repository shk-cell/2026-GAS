// Spin the Wheel app (no spreadsheet connection)
// 2 files: Code.gs (opens the page) + index.html (wheel screen and behavior)
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Spin the Wheel')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}