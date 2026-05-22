// ============================================================
// HOST BY SOPHIE — Google Apps Script v7
// Groupe les cellules colorées consécutives (non-blanc/gris clair)
// ============================================================

var SHEET_ID = "1E9hk-Vo2v3JF9Y4oRgq7wKRGD-ILW3079WWzvdfAmsc";

function doGet(e) {
  try {
    var ss      = SpreadsheetApp.openById(SHEET_ID);
    var sheet   = ss.getSheets()[0];
    var range   = sheet.getDataRange();
    var display = range.getDisplayValues();
    var bgColors= range.getBackgrounds();
    var numRows = display.length;
    var numCols = display[0].length;

    // ── 1. Ligne des dates ────────────────────────────────────
    var dateRow = -1, dateColMap = {};
    for (var r = 0; r < numRows; r++) {
      var count = 0, tmp = {};
      for (var c = 0; c < numCols; c++) {
        if (/^\d{1,2}-\d{1,2}$/.test(display[r][c].trim())) {
          tmp[c] = display[r][c].trim(); count++;
        }
      }
      if (count >= 10) { dateRow = r; dateColMap = tmp; break; }
    }
    if (dateRow === -1) return jsonResponse({ error: "Ligne de dates introuvable" });

    // ── 2. Lignes propriétés ──────────────────────────────────
    var keywords = ['SANFUEGO','KOE','TROPICAL','LODGE','SWEET','STUDIO','CHALET'];
    var propRows = [];
    for (var r = dateRow + 1; r < numRows; r++) {
      var name = display[r][0].trim();
      if (name.length > 2) {
        var up = name.toUpperCase();
        if (keywords.some(function(k){ return up.indexOf(k) !== -1; }))
          propRows.push({ row: r, name: name });
      }
    }

    // ── 3. Bookings : cellules colorées consécutives ──────────
    var bookings = [];
    var today    = new Date();

    propRows.forEach(function(prop) {
      var rowDisplay = display[prop.row];
      var rowColors  = bgColors[prop.row];
      var i = 0;

      while (i < numCols) {
        // Chercher le début d'un bloc coloré avec une date
        if (!dateColMap[i] || isLight(rowColors[i])) { i++; continue; }

        // Début du bloc
        var startCol  = i;
        var endCol    = i;
        var guestName = rowDisplay[i].trim();
        var blockColor= rowColors[i];

        // Étendre tant que la cellule suivante est aussi colorée (non-claire)
        while (i + 1 < numCols && dateColMap[i+1] && !isLight(rowColors[i+1])) {
          i++;
          endCol = i;
          if (!guestName && rowDisplay[i].trim()) guestName = rowDisplay[i].trim();
        }

        // Valider et ajouter
        if (guestName && !/^[x\/\-_\s]+$/i.test(guestName)) {
          bookings.push(makeBooking(prop.name, guestName, dateColMap[startCol], dateColMap[endCol]));
        }
        i++;
      }
    });

    bookings.sort(function(a,b){ return new Date(a.checkin) - new Date(b.checkin); });
    var upcoming = bookings.filter(function(b){ return new Date(b.checkout) >= today; });

    return jsonResponse({
      ok          : true,
      lastUpdated : new Date().toISOString(),
      properties  : propRows.map(function(p){ return p.name; }),
      total       : bookings.length,
      upcoming    : upcoming.length,
      bookings    : bookings
    });

  } catch(err) {
    return jsonResponse({ error: err.toString() });
  }
}

// Couleur "claire" = blanc ou gris très clair (fond vide)
function isLight(hex) {
  if (!hex || hex === 'null') return true;
  if (hex.length !== 7 || hex[0] !== '#') return true;
  var r = parseInt(hex.slice(1,3), 16);
  var g = parseInt(hex.slice(3,5), 16);
  var b = parseInt(hex.slice(5,7), 16);
  return (r > 220 && g > 220 && b > 220);  // blanc/gris très clair = vide
}

function makeBooking(property, guestRaw, startStr, endStr) {
  var clean = guestRaw.replace(/\b(airbnb|vrbo|booking\.com|booking|direct)\b/gi,'').replace(/\s+/g,' ').trim();
  return {
    property : property,
    guest    : clean || guestRaw,
    platform : extractPlatform(guestRaw),
    checkin  : formatDate(startStr),
    checkout : formatDate(endStr),
    nights   : nightsBetween(startStr, endStr)
  };
}

function formatDate(str) {
  var p = str.split('-');
  if (p.length !== 2) return str;
  var day = parseInt(p[0]), month = parseInt(p[1]);
  return ((month >= 3) ? 2026 : 2027) + '-' + pad(month) + '-' + pad(day);
}

function pad(n){ return n < 10 ? '0'+n : String(n); }

function nightsBetween(s, e) {
  try { return Math.max(1, Math.round((new Date(formatDate(e))-new Date(formatDate(s)))/86400000)+1); }
  catch(x){ return 1; }
}

function extractPlatform(str) {
  var up = str.toUpperCase();
  if (up.indexOf('AIRBNB')  !== -1) return 'Airbnb';
  if (up.indexOf('VRBO')    !== -1) return 'VRBO';
  if (up.indexOf('BOOKING') !== -1) return 'Booking.com';
  if (up.indexOf('DIRECT')  !== -1) return 'Direct';
  return 'Direct';
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
