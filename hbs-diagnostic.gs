var SHEET_ID = "1E9hk-Vo2v3JF9Y4oRgq7wKRGD-ILW3079WWzvdfAmsc";

function doGet(e) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheets()[0];
  
  // Lire lignes 1-10, colonnes 1-20 pour voir dates + 1ère propriété
  var range   = sheet.getRange(1, 1, 10, 20);
  var display = range.getDisplayValues();
  var colors  = range.getBackgrounds();
  
  var result = [];
  for (var r = 0; r < display.length; r++) {
    var row = { rowIndex: r, firstCell: display[r][0], cols: [] };
    for (var c = 0; c < display[r].length; c++) {
      row.cols.push({
        c      : c,
        text   : display[r][c],
        color  : colors[r][c]
      });
    }
    result.push(row);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(result, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}
