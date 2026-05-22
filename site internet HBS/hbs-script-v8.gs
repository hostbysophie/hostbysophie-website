// ═══════════════════════════════════════════════════════════════
//  HBS Apps Script v8 — Calendar + Financials
//  Déployer : Extensions › Apps Script › Nouvelle version › Déployer
// ═══════════════════════════════════════════════════════════════

var CAL_SHEET_ID = "1E9hk-Vo2v3JF9Y4oRgq7wKRGD-ILW3079WWzvdfAmsc";
var FIN_SHEET_ID = "1IwUW7n_1-h4-zr_-_sNM3khh8WRkFVLBFvWMIY7giqs";

// Onglet financier → email(s) propriétaire
// hostbysophie@gmail.com est admin : voit TOUT
var PROPERTY_OWNERS = {
  "San fuego 28R":   ["sguenegou@gmail.com",     "hostbysophie@gmail.com"],
  "Appt Bubali 13L": ["richicarrental@gmail.com", "hostbysophie@gmail.com"],
  "Pool side":       ["hfaleenders@gmail.com",    "hostbysophie@gmail.com"],
  "Eucalyptus":      ["hfaleenders@gmail.com",    "hostbysophie@gmail.com"],
  "Flamingo":        ["hfaleenders@gmail.com",    "hostbysophie@gmail.com"],
  "Bananaquit":      ["hfaleenders@gmail.com",    "hostbysophie@gmail.com"],
  "Hooidberg":       ["hfaleenders@gmail.com",    "hostbysophie@gmail.com"],
  "Tropical Oasis":  ["hfaleenders@gmail.com",    "hostbysophie@gmail.com"]
};

// Mois de démarrage par email (1 = janvier). Mois < startMonth ignorés.
// Haiko : contrat démarré le 1er avril 2026 → on part du mois 4
var START_MONTH = {
  "hfaleenders@gmail.com": 4   // avril
  // tous les autres : 1 (pas de filtre)
};

// ─── ROUTER ──────────────────────────────────────────────────
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "calendar";
  var result;
  try {
    if (action === "financials") {
      result = getFinancials();
    } else {
      result = getCalendarData();
    }
  } catch (err) {
    result = { ok: false, error: err.toString() };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════
//  DONNÉES FINANCIÈRES
// ═══════════════════════════════════════════════════════════════
function getFinancials() {
  var ss = SpreadsheetApp.openById(FIN_SHEET_ID);

  // Initialiser chaque propriétaire
  var byOwner = {};
  ["hostbysophie@gmail.com", "sguenegou@gmail.com",
   "hfaleenders@gmail.com",  "richicarrental@gmail.com"]
    .forEach(function(email) {
      byOwner[email] = {
        revenue_ytd:    0,
        expense_ytd:    0,
        profit_ytd:     0,
        owner_share_ytd: 0,
        days_rented_ytd: 0,
        occ_sum:        0,   // pour calculer moyenne
        occ_count:      0,
        revenue_last:   0,
        occupancy_last: 0,
        last_month:     0,
        properties:     []
      };
    });

  var sum = function(arr) {
    return arr.reduce(function(s, v) { return s + (parseFloat(v) || 0); }, 0);
  };

  Object.keys(PROPERTY_OWNERS).forEach(function(tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return;

    // Lignes 6-13, colonnes B-N (label + 12 mois)
    // getRange(startRow, startCol, numRows, numCols)
    var data = sheet.getRange(6, 2, 8, 13).getValues();
    //  data[0] = INCOME        [ label, m1..m12 ]
    //  data[1] = EXPENSE
    //  data[2] = PROFIT
    //  data[3] = CLEANING
    //  data[4] = YOUR SHARE / COMMISSION FEE
    //  data[5] = CO HOST SHARE
    //  data[6] = DAY RENTED
    //  data[7] = OCCUPANCY RATE

    var income     = data[0].slice(1); // [m1..m12] (index 0 = janvier)
    var expense    = data[1].slice(1);
    var profit     = data[2].slice(1);
    var ownerShare = data[4].slice(1);
    var daysRented = data[6].slice(1);
    var occupancy  = data[7].slice(1);

    // Dernier mois avec des données (tous propriétaires confondus)
    var lastMonth = 0;
    for (var m = 0; m < 12; m++) {
      if ((parseFloat(income[m]) || 0) > 0) lastMonth = m + 1;
    }

    // Sommer en appliquant le filtre START_MONTH par email
    PROPERTY_OWNERS[tabName].forEach(function(email) {
      var o = byOwner[email];
      if (!o) return;

      // Mois de départ pour cet email (1-indexé). Défaut = 1 (tout)
      var startM = (START_MONTH[email] || 1) - 1; // converti en index 0-based

      var sumFrom = function(arr) {
        return arr.reduce(function(s, v, idx) {
          return idx >= startM ? s + (parseFloat(v) || 0) : s;
        }, 0);
      };

      // Dernier mois avec données pour cet email (en tenant compte du filtre)
      var lastMonthEmail = 0;
      for (var mm = startM; mm < 12; mm++) {
        if ((parseFloat(income[mm]) || 0) > 0) lastMonthEmail = mm + 1;
      }

      var lastOcc = lastMonthEmail > 0 ? (parseFloat(occupancy[lastMonthEmail - 1]) || 0) : 0;
      if (lastOcc > 0 && lastOcc < 2) lastOcc = lastOcc * 100; // normaliser en %

      o.revenue_ytd     += sumFrom(income);
      o.expense_ytd     += sumFrom(expense);
      o.profit_ytd      += sumFrom(profit);
      o.owner_share_ytd += sumFrom(ownerShare);
      o.days_rented_ytd += sumFrom(daysRented);

      if (lastMonthEmail > 0) {
        o.occ_sum   += lastOcc;
        o.occ_count += 1;
        if (lastMonthEmail > o.last_month) {
          o.last_month   = lastMonthEmail;
          o.revenue_last = parseFloat(income[lastMonthEmail - 1]) || 0;
        }
      }
      if (o.properties.indexOf(tabName) === -1) o.properties.push(tabName);
    });
  });

  // Calculer occupancy moyenne par propriétaire
  Object.keys(byOwner).forEach(function(email) {
    var o = byOwner[email];
    o.occupancy_last = o.occ_count > 0 ? Math.round(o.occ_sum / o.occ_count) : 0;
    delete o.occ_sum;
    delete o.occ_count;
  });

  return {
    ok: true,
    lastUpdated: new Date().toISOString(),
    financials: byOwner
  };
}

// ═══════════════════════════════════════════════════════════════
//  DONNÉES CALENDRIER (v7 inchangé)
// ═══════════════════════════════════════════════════════════════
function getCalendarData() {
  var ss    = SpreadsheetApp.openById(CAL_SHEET_ID);
  var sheet = ss.getSheetByName("CAL");
  if (!sheet) throw new Error("Onglet 'CAL' introuvable");

  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();

  // Trouver la ligne de dates (format "1-3", "2-3"...)
  var dispVals = sheet.getRange(1, 1, Math.min(5, lastRow), lastCol).getDisplayValues();
  var dateRow = -1;
  for (var r = 0; r < dispVals.length; r++) {
    for (var c = 0; c < dispVals[r].length; c++) {
      if (/^\d+-\d+$/.test((dispVals[r][c] || '').trim())) {
        dateRow = r; break;
      }
    }
    if (dateRow >= 0) break;
  }
  if (dateRow < 0) throw new Error("Ligne de dates introuvable");

  var dates    = sheet.getRange(dateRow + 1, 1, 1, lastCol).getDisplayValues()[0];
  var dataRows = lastRow - (dateRow + 1);
  if (dataRows <= 0) return { ok: true, bookings: [], total: 0, upcoming: 0, properties: [], lastUpdated: new Date().toISOString() };

  var propVals = sheet.getRange(dateRow + 2, 1, dataRows, 1).getValues();
  var bgVals   = sheet.getRange(dateRow + 2, 1, dataRows, lastCol).getBackgrounds();
  var txtVals  = sheet.getRange(dateRow + 2, 1, dataRows, lastCol).getDisplayValues();

  function isLight(hex) {
    if (!hex || hex === '#ffffff' || hex === 'white') return true;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
    var rv = parseInt(hex.substr(0, 2), 16);
    var gv = parseInt(hex.substr(2, 2), 16);
    var bv = parseInt(hex.substr(4, 2), 16);
    return rv > 220 && gv > 220 && bv > 220;
  }

  function parseDate(str) {
    var parts = (str || '').trim().split('-');
    if (parts.length !== 2) return null;
    var day = parseInt(parts[0]);
    var mon = parseInt(parts[1]);
    if (!day || !mon) return null;
    var year = new Date().getFullYear();
    return new Date(year, mon - 1, day);
  }

  function fmtDate(d) {
    var y   = d.getFullYear();
    var mo  = String(d.getMonth() + 1).padStart('0', 2);
    var da  = String(d.getDate()).padStart('0', 2);
    return y + '-' + mo + '-' + da;
  }

  // padStart polyfill pour Apps Script
  String.prototype.padStart = String.prototype.padStart || function(len, fill) {
    var s = String(this);
    while (s.length < len) s = fill + s;
    return s;
  };

  var knownPlatforms = ['AIRBNB', 'VRBO', 'BOOKING', 'BDC', 'RBNB', 'DIRECT'];
  var bookings = [];
  var today = new Date();

  for (var row = 0; row < dataRows; row++) {
    var propName = (propVals[row][0] || '').toString().trim();
    if (!propName || propName.charAt(0) === '#') continue;

    var inBlock = false;
    var blockStart = -1;
    var blockText = '';

    for (var col = 1; col < lastCol; col++) {
      var lit = isLight(bgVals[row][col]);
      var txt = (txtVals[row][col] || '').trim();

      if (!lit && !inBlock) {
        inBlock = true; blockStart = col; blockText = txt;
      } else if (!lit && inBlock) {
        if (txt && !blockText) blockText = txt;
      } else if (lit && inBlock) {
        // Fermer le bloc
        var sd = parseDate(dates[blockStart]);
        var ed = parseDate(dates[col]);
        if (sd && ed) {
          var nights = Math.round((ed - sd) / 86400000) || (col - blockStart);
          var words   = blockText.trim().split(/\s+/);
          var platform = 'Direct';
          var gWords   = words.slice();
          for (var p = words.length - 1; p >= 0; p--) {
            if (knownPlatforms.some(function(kp) { return words[p].toUpperCase().indexOf(kp) >= 0; })) {
              platform = words[p]; gWords = words.slice(0, p); break;
            }
          }
          bookings.push({
            property: propName,
            guest: gWords.join(' ') || blockText || 'Guest',
            platform: platform,
            checkin:  fmtDate(sd),
            checkout: fmtDate(ed),
            nights: nights
          });
        }
        inBlock = false; blockStart = -1; blockText = '';
      }
    }

    // Bloc jusqu'en fin de ligne
    if (inBlock && blockStart >= 0) {
      var sd2 = parseDate(dates[blockStart]);
      var ed2 = parseDate(dates[lastCol - 1]);
      if (sd2 && ed2) {
        bookings.push({
          property: propName,
          guest: blockText || 'Guest',
          platform: 'Direct',
          checkin:  fmtDate(sd2),
          checkout: fmtDate(ed2),
          nights: lastCol - blockStart
        });
      }
    }
  }

  bookings.sort(function(a, b) { return a.checkin.localeCompare(b.checkin); });

  var upcoming   = bookings.filter(function(b) { return new Date(b.checkout) >= today; });
  var properties = [];
  bookings.forEach(function(b) { if (properties.indexOf(b.property) < 0) properties.push(b.property); });

  return {
    ok: true,
    lastUpdated: new Date().toISOString(),
    total: bookings.length,
    upcoming: upcoming.length,
    properties: properties,
    bookings: bookings
  };
}
