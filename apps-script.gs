const HEADERS = {
  Equipment: ["id", "name", "category", "stock"],
  Students: ["id", "name", "classType"],
  Checkouts: ["id", "studentName", "classType", "equipmentId", "equipmentName", "accessories", "checkoutDate", "returnDate", "status"],
  Auth: ["id", "key", "value"],
  Users: ["id", "code", "name", "level", "passwordHash"],
  Blacklist: ["id", "studentName", "reason", "addedBy", "addedDate", "active"]
};

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
    var sheetName = sheetForAction(a.type);
    if (!sheetName) return;
    if (a.type.indexOf("delete") === 0) removeRow(ss, sheetName, a.data.id);
    else upsert(ss, sheetName, a.data);
    applied++;
  });

  return ContentService.createTextOutput(JSON.stringify({ status: "success", applied: applied }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetForAction(type) {
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
  var headers = data[0];
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
  var headers = HEADERS[name];
  var values = sheet.getDataRange().getValues();
  var rowArr = headers.map(function (h) { return record[h] !== undefined ? record[h] : ""; });

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(record.id)) {
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([rowArr]);
      return;
    }
  }
  sheet.appendRow(rowArr);
}

function removeRow(ss, name, id) {
  var sheet = getOrCreateSheet(ss, name);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}
