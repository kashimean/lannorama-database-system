/**
 * Lannorama Database System — cloud backend (Google Apps Script, Web App).
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New version.
 * Access must stay "Anyone" for the app to reach it.
 *
 * Sheets are created automatically on first write, or run setupSheets() once
 * from the editor to build them all with the canonical headers.
 *
 * Everything is written by the ACTUAL column position of each header, never by
 * assumed column order, so a hand-arranged sheet still works.
 */

var HEADERS = {
  Equipment: ["id", "name", "category", "stock", "number"],
  Students: ["id", "name", "classType"],
  Checkouts: [
    "id", "studentName", "classType", "equipmentId", "equipmentName",
    "equipmentNumber", "accessories", "checkoutDate", "returnDate", "status"
  ],
  Users: ["id", "code", "name", "level", "passwordHash"],
  Blacklist: ["id", "studentName", "reason", "addedBy", "addedDate", "active"],
  Auth: ["id", "key", "value"]
};

// Hand-pasted sheets rarely use the exact header names, so every header is
// normalized to the canonical key. Without this, row.id is undefined and the
// app can never confirm a change, which is what caused duplicate rows.
var HEADER_ALIASES = {
  "id": "id", "record id": "id", "row id": "id",
  "student id": "id", "student_id": "id",
  "equipment id": "id", "equipment_id": "id",
  "checkout id": "id", "user id": "id", "blacklist id": "id",
  "name": "name", "full name": "name", "display name": "name",
  "student name": "studentName", "student_name": "studentName",
  "class": "classType", "class type": "classType", "class_type": "classType",
  "period": "classType", "period/section": "classType", "class period": "classType",
  "category": "category", "type": "category", "item type": "category",
  "stock": "stock", "count": "stock", "max stock": "stock", "quantity": "stock",
  "number": "number", "equipment number": "number", "asset number": "number",
  "serial": "number", "serial number": "number", "asset": "number", "item number": "number",
  "accessories": "accessories", "notes": "accessories", "notes/accessories": "accessories",
  "checkout date": "checkoutDate", "date out": "checkoutDate", "checked out": "checkoutDate",
  "return date": "returnDate", "date due": "returnDate", "due date": "returnDate",
  "returned date": "returnDate", "return status": "status", "status": "status",
  "key": "key", "value": "value", "code": "code", "access code": "code",
  "level": "level", "role": "level", "password hash": "passwordHash", "hash": "passwordHash",
  "added by": "addedBy", "added date": "addedDate", "date added": "addedDate",
  "reason": "reason", "active": "active",
  "equipment name": "equipmentName", "equipment": "equipmentName", "item": "equipmentName"
};

// Action type -> sheet name. delete_checkout was missing before, which made
// "Purge logs" a no-op on the server.
var ACTION_SHEET = {
  "equipment": "Equipment", "delete_equipment": "Equipment",
  "student": "Students", "delete_student": "Students",
  "checkout": "Checkouts", "delete_checkout": "Checkouts",
  "log": "Checkouts", "delete_log": "Checkouts",
  "user": "Users", "delete_user": "Users",
  "blacklist": "Blacklist", "delete_blacklist": "Blacklist",
  "auth": "Auth", "delete_auth": "Auth"
};

function normalizeHeader(h) {
  var k = String(h).toLowerCase().trim();
  return HEADER_ALIASES[k] || k;
}

// ------------------------------------------------------------------ GET

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var params = e && e.parameter ? e.parameter : {};

  if (params.action === "ping") {
    return json({ status: "ok", time: new Date().toISOString(), sheets: listSheets(ss) });
  }

  if (params.action === "setup") {
    return json({ status: "ok", created: setupSheets(ss) });
  }

  // Single sheet: ?sheet=Checkouts
  if (params.sheet) {
    var name = canonicalSheetName(params.sheet);
    return json({ status: "success", sheet: name, rows: readSheet(ss, name) });
  }

  var out = {};
  Object.keys(HEADERS).forEach(function (name) {
    out[name.toLowerCase()] = readSheet(ss, name);
  });
  return json(out);
}

// ------------------------------------------------------------------ POST

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ status: "error", error: "Invalid JSON body." });
  }

  var actions = payload.actions || [];
  if (!actions.length) {
    return json({ status: "success", applied: 0, skipped: [] });
  }

  // Two machines writing at the same time used to interleave and duplicate rows.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ status: "error", error: "Server busy, try again." });
  }

  var applied = 0;
  var skipped = [];

  try {
    actions.forEach(function (a) {
      var sheetName = sheetForAction(a);
      if (!sheetName) {
        skipped.push({ type: a.type, reason: "unknown action" });
        return;
      }

      var data = a.data || {};
      if (a.type === "assign_id") {
        if (assignId(ss, sheetName, data)) applied++;
        else skipped.push({ type: a.type, id: data.id, reason: "no matching row" });
      } else if (String(a.type).indexOf("delete") === 0) {
        if (removeRow(ss, sheetName, data)) applied++;
        else skipped.push({ type: a.type, id: data.id, reason: "row not found" });
      } else {
        upsert(ss, sheetName, data);
        applied++;
      }
    });
  } finally {
    lock.releaseLock();
  }

  return json({ status: "success", applied: applied, skipped: skipped });
}

function sheetForAction(a) {
  var type = String(a.type || "");
  if (type === "assign_id") return canonicalSheetName((a.data && a.data.sheet) || "Students");
  return ACTION_SHEET[type] || null;
}

function canonicalSheetName(name) {
  var k = String(name || "").toLowerCase().trim();
  var map = {
    equipment: "Equipment", gear: "Equipment",
    students: "Students", student: "Students", roster: "Students",
    checkouts: "Checkouts", checkout: "Checkouts", logs: "Checkouts", log: "Checkouts",
    users: "Users", user: "Users",
    blacklist: "Blacklist",
    auth: "Auth", settings: "Auth"
  };
  return map[k] || null;
}

// ------------------------------------------------------------------ helpers

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function listSheets(ss) {
  return Object.keys(HEADERS).map(function (name) {
    return { name: name, rows: readSheet(ss, name).length };
  });
}

function readSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0].map(normalizeHeader);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) row[headers[j]] = data[i][j];
    rows.push(row);
  }
  return rows;
}

// Create the sheet if missing, and add any canonical column the sheet does not
// have yet (older sheets were built before equipmentNumber existed).
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS[name]);
    return sheet;
  }

  var headers = headerRow(sheet);
  var canonical = HEADERS[name];
  for (var i = 0; i < canonical.length; i++) {
    if (headers.indexOf(canonical[i]) !== -1) continue;
    sheet.getRange(1, headers.length + 1).setValue(canonical[i]);
    headers.push(canonical[i]);
  }
  return sheet;
}

// Read the actual header row as canonical keys.
function headerRow(sheet) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalizeHeader);
}

// Run once from the editor to create any missing sheet and repair its header row.
// This never deletes data — it only writes headers and freezes row 1.
function setupSheets(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var created = [];
  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      created.push(name);
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    }
    sheet.setFrozenRows(1);
  });
  return created;
}

// Column position of each canonical header, based on the sheet's real header row.
function columnMap(sheet, name) {
  var headers = headerRow(sheet);
  var colOf = {};
  HEADERS[name].forEach(function (h, i) {
    var idx = headers.indexOf(h);
    colOf[h] = idx === -1 ? i : idx;
  });
  return colOf;
}

function upsert(ss, name, record) {
  var sheet = getOrCreateSheet(ss, name);
  var values = sheet.getDataRange().getValues();
  if (values.length === 0) {
    sheet.appendRow(HEADERS[name]);
    values = sheet.getDataRange().getValues();
  }

  var canonical = HEADERS[name];
  var colOf = columnMap(sheet, name);
  var idCol = colOf["id"];
  var width = headerRow(sheet).length || canonical.length;

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]).trim() === String(record.id).trim()) {
      var out = [];
      canonical.forEach(function (h) { out[colOf[h]] = valueOf(record, h); });
      sheet.getRange(r + 1, 1, 1, width).setValues([out]);
      return;
    }
  }

  var rowArr = [];
  canonical.forEach(function (h) { rowArr[colOf[h]] = valueOf(record, h); });
  sheet.appendRow(rowArr);
}

function valueOf(record, key) {
  var v = record[key];
  if (v === undefined || v === null) return "";
  return v;
}

// Write an id into a row that already exists (a hand-imported row with a blank
// id) instead of appending a duplicate.
function assignId(ss, name, data) {
  var sheet = getOrCreateSheet(ss, name);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return false;
  var headers = headerRow(sheet);
  var idCol = headers.indexOf("id");
  if (idCol === -1) return false;

  // Match on whichever name-like column the record carries.
  var matchKeys = ["name", "code", "studentName"];
  var matchCols = matchKeys.map(function (k) { return headers.indexOf(k); });

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]).trim()) continue;
    for (var c = 0; c < matchCols.length; c++) {
      if (matchCols[c] < 0) continue;
      var cell = String(values[r][matchCols[c]]).trim();
      var want = String(data.name || data.code || data.studentName || "").trim();
      if (cell && cell === want) {
        sheet.getRange(r + 1, idCol + 1).setValue(data.id);
        return true;
      }
    }
  }
  return false;
}

function removeRow(ss, name, record) {
  var sheet = getOrCreateSheet(ss, name);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return false;
  var headers = headerRow(sheet);
  var idCol = headers.indexOf("id");

  for (var r = 1; r < values.length; r++) {
    if (record.id && String(values[r][idCol]).trim() === String(record.id).trim()) {
      sheet.deleteRow(r + 1);
      return true;
    }
  }

  // Fallback for rows that never had an id: match on the name-like column.
  if (!record.id) {
    var want = String(record.name || record.code || record.studentName || "").trim();
    if (!want) return false;
    for (var c = 0; c < headers.length; c++) {
      if (headers[c] !== "name" && headers[c] !== "code" && headers[c] !== "studentName") continue;
      for (var r = 1; r < values.length; r++) {
        if (String(values[r][c]).trim() === want) {
          sheet.deleteRow(r + 1);
          return true;
        }
      }
    }
  }
  return false;
}
