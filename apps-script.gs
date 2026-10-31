const HEADERS = {
  Equipment: ["id", "name", "category", "stock"],
  Students: ["id", "name", "classType"],
  Checkouts: ["id", "studentName", "classType", "equipmentId", "equipmentName", "accessories", "checkoutDate", "returnDate", "status"],
  Auth: ["id", "key", "value"],
  Users: ["id", "code", "name", "level", "passwordHash"],
  Blacklist: ["id", "studentName", "reason", "addedBy", "addedDate", "active"]
};

// Hand-pasted sheets rarely use the exact header names, so every header is
// normalized to the canonical key. Without this, row.id is undefined and the
// app can never confirm a change, which is what caused duplicate rows.
var HEADER_ALIASES = {
  "id": "id", "student id": "id", "student_id": "id", "equipment id": "id",
  "equipment_id": "id", "checkout id": "id", "user id": "id", "record id": "id",
  "name": "name", "student name": "studentName", "student_name": "studentName",
  "class": "classType", "class type": "classType", "class_type": "classType",
  "period": "classType", "period/section": "classType",
  "category": "category", "type": "category", "stock": "stock", "count": "stock",
  "accessories": "accessories", "notes": "accessories",
  "checkout date": "checkoutDate", "date out": "checkoutDate",
  "return date": "returnDate", "date due": "returnDate", "due date": "returnDate",
  "status": "status", "key": "key", "value": "value", "code": "code",
  "level": "level", "role": "level", "password hash": "passwordHash",
  "added by": "addedBy", "added date": "addedDate", "reason": "reason",
  "active": "active", "equipment name": "equipmentName", "equipment": "equipmentName",
  "equipment id": "equipmentId"
};

function normalizeHeader(h) {
  var k = String(h).toLowerCase().trim();
  return HEADER_ALIASES[k] || k;
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ContentService.createTextOutput(JSON.stringify({
    equipment: readSheet(ss, "Equipment"),
    students: readSheet(ss, "Students"),
    checkouts: readSheet(ss, "Checkouts"),
    auth: readSheet(ss, "Auth"),
    users: readSheet(ss, "Users"),
    blacklist: readSheet(ss, "Blacklist")
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var payload = JSON.parse(e.postData.contents);
  var actions = payload.actions || [];
  var applied = 0;

  actions.forEach(function (a) {
    var sheetName = sheetForAction(a);
    if (!sheetName) return;

    if (a.type === "assign_id") {
      if (assignId(ss, sheetName, a.data)) applied++;
    } else if (a.type.indexOf("delete") === 0) {
      removeRow(ss, sheetName, a.data);
      applied++;
    } else {
      upsert(ss, sheetName, a.data);
      applied++;
    }
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success", applied: applied }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetForAction(a) {
  var type = a.type;
  if (type === "assign_id") return String((a.data && a.data.sheet) || "Students");
  if (type === "checkout") return "Checkouts";
  if (type === "student" || type === "delete_student") return "Students";
  if (type === "equipment" || type === "delete_equipment") return "Equipment";
  if (type === "auth") return "Auth";
  if (type === "user" || type === "delete_user") return "Users";
  if (type === "blacklist" || type === "delete_blacklist") return "Blacklist";
  return null;
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

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS[name]);
  }
  return sheet;
}

function upsert(ss, name, record) {
  var sheet = getOrCreateSheet(ss, name);
  var values = sheet.getDataRange().getValues();
  var canonical = HEADERS[name];

  // Repair the header row so future writes line up with the canonical columns.
  var headers = values[0].map(normalizeHeader);
  var fixed = false;
  for (var i = 0; i < canonical.length; i++) {
    if (headers[i] !== canonical[i]) { headers[i] = canonical[i]; fixed = true; }
  }
  if (fixed) sheet.getRange(1, 1, 1, canonical.length).setValues([canonical]);

  var rowArr = canonical.map(function (h) { return record[h] !== undefined ? record[h] : ""; });

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === String(record.id).trim()) {
      sheet.getRange(r + 1, 1, 1, canonical.length).setValues([rowArr]);
      return;
    }
  }
  sheet.appendRow(rowArr);
}

// Write an id into the row that already exists (a hand-imported row with a
// blank id) instead of appending a duplicate.
function assignId(ss, name, data) {
  var sheet = getOrCreateSheet(ss, name);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(normalizeHeader);
  var idCol = headers.indexOf("id");
  var nameCol = headers.indexOf("name");
  if (idCol === -1) return false;

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]).trim()) continue;
    if (nameCol >= 0 && String(values[r][nameCol]).trim() === String(data.name).trim()) {
      sheet.getRange(r + 1, idCol + 1).setValue(data.id);
      return true;
    }
  }
  return false;
}

function removeRow(ss, name, record) {
  var sheet = getOrCreateSheet(ss, name);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(normalizeHeader);
  var idCol = headers.indexOf("id");
  var nameCol = headers.indexOf("name");

  for (var r = 1; r < values.length; r++) {
    if (record.id && String(values[r][idCol]).trim() === String(record.id).trim()) {
      sheet.deleteRow(r + 1);
      return;
    }
    // Fallback for rows that never had an id: match on the name.
    if (!record.id && nameCol >= 0 && String(values[r][nameCol]).trim() === String(record.name).trim()) {
      sheet.deleteRow(r + 1);
      return;
    }
  }
}
