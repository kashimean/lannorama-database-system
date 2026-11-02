// Digital Media Equipment Tracker - Renderer Script

// --- APPS SCRIPT TEMPLATE CODE FOR GOOGLE SHEETS ---
const APPS_SCRIPT_TEMPLATE = `/**
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
  "student name": "studentName", "student_name": "studentName", "studentname": "studentName",
  "class": "classType", "class type": "classType", "class_type": "classType", "classtype": "classType",
  "period": "classType", "period/section": "classType", "class period": "classType",
  "category": "category", "type": "category", "item type": "category",
  "stock": "stock", "count": "stock", "max stock": "stock", "quantity": "stock",
  "number": "number", "equipment number": "number", "asset number": "number",
  "serial": "number", "serial number": "number", "asset": "number", "item number": "number",
  "accessories": "accessories", "notes": "accessories", "notes/accessories": "accessories",
  "checkout date": "checkoutDate", "date out": "checkoutDate", "checked out": "checkoutDate", "checkoutdate": "checkoutDate",
  "return date": "returnDate", "date due": "returnDate", "due date": "returnDate",
  "returned date": "returnDate", "returndate": "returnDate", "return status": "status", "status": "status",
  "key": "key", "value": "value", "code": "code", "access code": "code",
  "level": "level", "role": "level", "password hash": "passwordHash", "hash": "passwordHash", "passwordhash": "passwordHash",
  "added by": "addedBy", "addedby": "addedBy", "added date": "addedDate", "addeddate": "addedDate", "date added": "addedDate",
  "reason": "reason", "active": "active",
  "equipment name": "equipmentName", "equipmentname": "equipmentName", "equipment": "equipmentName", "item": "equipmentName",
  "equipment id": "equipmentId", "equipmentid": "equipmentId",
  "equipment number": "equipmentNumber", "equipmentnumber": "equipmentNumber"
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

  // Report the RAW header row of every sheet. When a sheet's headers are written
  // without spaces (classtype, studentname, checkoutdate) they do not match the
  // canonical keys, and the app reads every field as blank.
  if (params.action === "headers") {
    var out = {};
    Object.keys(HEADERS).forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) { out[name] = null; return; }
      var raw = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
      out[name] = {
        raw: raw,
        canonical: HEADERS[name],
        mismatched: raw.filter(function (h) { return HEADERS[name].indexOf(normalizeHeader(h)) === -1; }),
        duplicates: raw.filter(function (h, i) { return raw.indexOf(h) !== i; })
      };
    });
    return json({ status: "success", headers: out });
  }

  // Clean up duplicate header columns left behind by older versions of this script,
  // which appended a canonical column on every read when the header spelling did not
  // match. A duplicate column is only cleared when it has no data below it, so this
  // never destroys anything.
  if (params.action === "repair") {
    var repaired = {};
    Object.keys(HEADERS).forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) return;
      var lastCol = sheet.getLastColumn();
      if (!lastCol) return;
      var raw = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var seen = {};
      var cleared = [];
      for (var j = 0; j < raw.length; j++) {
        var key = normalizeHeader(raw[j]);
        if (!key) continue;
        if (!seen[key]) { seen[key] = true; continue; }
        var hasData = false;
        if (sheet.getLastRow() > 1) {
          var col = sheet.getRange(2, j + 1, sheet.getLastRow() - 1, 1).getValues();
          for (var i = 0; i < col.length; i++) {
            if (String(col[i][0]).trim() !== "") { hasData = true; break; }
          }
        }
        if (!hasData) { sheet.getRange(1, j + 1).setValue(""); cleared.push(raw[j]); }
      }
      if (cleared.length) repaired[name] = cleared;
    });
    return json({ status: "success", repaired: repaired });
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
  // Repair the header row on read too. A sheet that has no id column at all can
  // never be confirmed by the app, because every row it returns has no id.
  var sheet = getOrCreateSheet(ss, name);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0].map(normalizeHeader);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      if (!key) continue;
      // Duplicate header columns were appended repeatedly by older versions of this
      // script (a header spelled "studentname" never matched the canonical key, so every
      // read appended another copy). The later duplicates are blank and were overwriting
      // the real values, which made every field read back empty. Keep the first column
      // for a key, and never let a blank duplicate clobber a value that is already set.
      if (row[key] === undefined || row[key] === "") row[key] = data[i][j];
    }
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
      var out = fillRow(colOf, canonical, record, width);
      sheet.getRange(r + 1, 1, 1, width).setValues([out]);
      return;
    }
  }

  sheet.appendRow(fillRow(colOf, canonical, record, width));
}

// Build a full-width row. Older versions left holes in the array for columns that
// are not canonical, and setValues on a sparse array can throw or blank cells.
// Only the first occurrence of each header is written; duplicate columns are left
// exactly as they are so a blank duplicate can never overwrite a real value.
function fillRow(colOf, canonical, record, width) {
  var out = [];
  for (var i = 0; i < width; i++) out.push("");
  canonical.forEach(function (h) { out[colOf[h]] = valueOf(record, h); });
  return out;
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
}`;

// --- INITIAL DEFAULT DATA ---
const DEFAULT_EQUIPMENT = [
    { id: 'eq-1', name: 'Canon EOS Rebel T7 Kit', category: 'Camera', stock: 5 },
    { id: 'eq-2', name: 'Sony FX3 Cinema Camera', category: 'Camera', stock: 2 },
    { id: 'eq-3', name: 'Heavy Duty Video Tripod', category: 'Support', stock: 6 },
    { id: 'eq-4', name: 'Wireless Lavalier Mic Set (Rode)', category: 'Audio', stock: 4 },
    { id: 'eq-5', name: 'Aputure LED Light Panel Kit', category: 'Lighting', stock: 3 },
    { id: 'eq-6', name: 'DJI RS3 Gimbal Stabilizer', category: 'Support', stock: 2 },
    { id: 'eq-7', name: 'Canon 50mm f/1.8 Prime Lens', category: 'Lens', stock: 4 },
    { id: 'eq-8', name: 'Shotgun Mic & Boom Pole', category: 'Audio', stock: 3 }
];

const DEFAULT_STUDENTS = [
    { id: 'st-1', name: 'Alex Johnson', classType: 'Advanced Digital Media' },
    { id: 'st-2', name: 'Sarah Miller', classType: 'Yearbook' },
    { id: 'st-3', name: 'Jordan Lee', classType: 'Beginning Digital Media' },
    { id: 'st-4', name: 'Chris Evans', classType: 'Leadership/ASB' },
    { id: 'st-5', name: 'Maya Patel', classType: 'Advanced Digital Media' }
];

// Access codes. Developer is hardcoded; Staff/TA codes are created in the
// Developer Console and stored in the cloud Users sheet.
const DEFAULT_USERS = [
    { id: 'us-dev', code: 'DEV', name: 'Developer', level: 'developer', passwordHash: '9212e5e6ef4106525be27ac4fcde2db1aa65f4e706eb469cea7f0baec27dcc96' }
];

// Calculate past and future dates for demo checkouts
const today = new Date();
const formatDateStr = (d) => d.toISOString().split('T')[0];

// Local date string — toISOString() can shift a day depending on timezone,
// which breaks "due today" checks, so use this for anything date-sensitive.
function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}

// Weekends don't count as return days: Friday + 1 day lands on Monday,
// and a Saturday/Sunday date is pushed to the following Monday.
function nextBusinessDay(d) {
    const day = d.getDay();
    if (day === 6) return addDays(d, 2);
    if (day === 0) return addDays(d, 1);
    return d;
}

function businessDaysFromToday(n) {
    return nextBusinessDay(addDays(new Date(), n));
}

// Status for an active checkout: due today is NOT overdue (class periods run
// through the day); it only becomes overdue the day AFTER the due date.
function checkoutStatus(c) {
    if (c.status !== 'active') return c.status;
    const t = localDateStr(new Date());
    if (c.returnDate === t) return 'due_today';
    if (c.returnDate > t) return 'active';
    return 'overdue';
}

function isBlacklisted(name) {
    const n = String(name || '').trim().toLowerCase();
    return blacklist.some(b => String(b.studentName).toLowerCase() === n && String(b.active) !== 'false');
}

// Optional: flag students automatically when an item goes past its due date.
function applyAutoBlacklist() {
    if (!settings.autoBlacklistOverdue) return;
    const me = (typeof currentRole === 'function' && currentRole()) ? (displayNameFor(currentRole()) || 'System') : 'System';
    let added = 0;

    checkouts.filter(c => c.status === 'active' && checkoutStatus(c) === 'overdue').forEach(c => {
        const exists = blacklist.some(b => String(b.studentName).toLowerCase() === String(c.studentName).toLowerCase());
        if (exists) return;
        const entry = {
            id: 'bl-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
            studentName: c.studentName,
            reason: `Overdue: ${c.equipmentName} (due ${c.returnDate})`,
            addedBy: me,
            addedDate: localDateStr(new Date()),
            active: 'true'
        };
        blacklist.push(entry);
        queueChange('blacklist', entry);
        added++;
    });

    return added;
}

const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);

const twoDaysAgo = new Date(today);
twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

const nextWeek = new Date(today);
nextWeek.setDate(nextWeek.getDate() + 5);

const DEFAULT_CHECKOUTS = [
    {
        id: 'co-1',
        studentName: 'Alex Johnson',
        classType: 'Advanced Digital Media',
        equipmentId: 'eq-2',
        equipmentName: 'Sony FX3 Cinema Camera',
        accessories: '16-35mm lens, 2x CFexpress cards, charger',
        checkoutDate: formatDateStr(twoDaysAgo),
        returnDate: formatDateStr(nextWeek),
        status: 'active'
    },
    {
        id: 'co-2',
        studentName: 'Sarah Miller',
        classType: 'Yearbook',
        equipmentId: 'eq-1',
        equipmentName: 'Canon EOS Rebel T7 Kit',
        accessories: '18-55mm lens, 64GB SD Card, shoulder bag',
        checkoutDate: formatDateStr(twoDaysAgo),
        returnDate: formatDateStr(yesterday),
        status: 'active'
    }
];

// --- APP STATE ---
let equipment = JSON.parse(localStorage.getItem('media_tracker_equipment')) || DEFAULT_EQUIPMENT;
let students = JSON.parse(localStorage.getItem('media_tracker_students')) || DEFAULT_STUDENTS;
let checkouts = JSON.parse(localStorage.getItem('media_tracker_checkouts')) || DEFAULT_CHECKOUTS;
const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwafWSa7a8TZMU3vihFUHEuyeEjfVIVUUYRv-doKix8wCymq5oNTWN77dxpoKVP70aL/exec';
let settings = JSON.parse(localStorage.getItem('media_tracker_settings')) || { webAppUrl: DEFAULT_APPS_SCRIPT_URL };
if (!settings.webAppUrl) settings.webAppUrl = DEFAULT_APPS_SCRIPT_URL;

let users = JSON.parse(localStorage.getItem('media_tracker_users')) || DEFAULT_USERS;
let blacklist = JSON.parse(localStorage.getItem('media_tracker_blacklist')) || [];
let pendingQueue = JSON.parse(localStorage.getItem('media_tracker_queue')) || [];
let lastSync = localStorage.getItem('media_tracker_lastsync') || '';

// Duplicate-name cleanup for the local copy. Defined here but executed at boot,
// AFTER the DOM consts (statActive etc.) are initialized — running it here made
// queueChange -> flushQueue -> renderStats touch statActive before initialization.
let localDupes = 0;
const dupCount = (list) => {
    const seen = new Set();
    let removed = 0;
    list.forEach(r => {
        const key = String(r.name || '').trim().toLowerCase();
        if (!key) return;
        if (seen.has(key)) { removed++; return; }
        seen.add(key);
    });
    return removed;
};

let pendingCheckoutData = null; // Holds form data during dialog confirmation prompts

// --- DOM ELEMENTS ---
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');

// Header Status
const syncStatusText = document.getElementById('syncStatusText');
const syncStatusDot = document.getElementById('syncStatusDot');

// Stats
const statActive = document.getElementById('statActive');
const statOverdue = document.getElementById('statOverdue');
const statDueToday = document.getElementById('statDueToday');
const statBlacklisted = document.getElementById('statBlacklisted');
const statGearTypes = document.getElementById('statGearTypes');
const statStudents = document.getElementById('statStudents');
const activeBadgeCount = document.getElementById('activeBadgeCount');

// Form Elements
const checkoutForm = document.getElementById('checkoutForm');
const studentNameInput = document.getElementById('studentNameInput');
const studentSuggestions = document.getElementById('studentSuggestions');
const classTypeSelect = document.getElementById('classTypeSelect');
const equipmentSelect = document.getElementById('equipmentSelect');
const returnDateInput = document.getElementById('returnDateInput');
const accessoriesInput = document.getElementById('accessoriesInput');

// Preset Buttons
const presetToday = document.getElementById('presetToday');
const presetTomorrow = document.getElementById('presetTomorrow');
const preset3Days = document.getElementById('preset3Days');
const preset1Week = document.getElementById('preset1Week');

// Modals
const modalRegisterStudent = document.getElementById('modalRegisterStudent');
const unregisteredStudentNameDisplay = document.getElementById('unregisteredStudentNameDisplay');
const modalStudentClassSelect = document.getElementById('modalStudentClassSelect');
const btnCancelRegister = document.getElementById('btnCancelRegister');
const btnConfirmRegister = document.getElementById('btnConfirmRegister');

const modalStockWarning = document.getElementById('modalStockWarning');
const modalNetwork = document.getElementById('modalNetwork');
const stockWarningItemName = document.getElementById('stockWarningItemName');
const btnCancelStockOverride = document.getElementById('btnCancelStockOverride');
const btnNetworkOk = document.getElementById('btnNetworkOk');
const btnConfirmStockOverride = document.getElementById('btnConfirmStockOverride');

const modalEquipment = document.getElementById('modalEquipment');
const modalEquipmentTitle = document.getElementById('modalEquipmentTitle');
const editEquipmentId = document.getElementById('editEquipmentId');
const equipNameInput = document.getElementById('equipNameInput');
const equipCategorySelect = document.getElementById('equipCategorySelect');
const equipStockInput = document.getElementById('equipStockInput');
const equipNumberInput = document.getElementById('equipNumberInput');
const btnOpenAddEquipment = document.getElementById('btnOpenAddEquipment');
const btnCloseEquipModal = document.getElementById('btnCloseEquipModal');
const btnSaveEquipment = document.getElementById('btnSaveEquipment');

const modalStudent = document.getElementById('modalStudent');
const modalStudentTitle = document.getElementById('modalStudentTitle');
const editStudentId = document.getElementById('editStudentId');
const studentFullNameInput = document.getElementById('studentFullNameInput');
const studentClassTypeSelect = document.getElementById('studentClassTypeSelect');
const btnOpenAddStudent = document.getElementById('btnOpenAddStudent');
const btnCloseStudentModal = document.getElementById('btnCloseStudentModal');
const btnSaveStudent = document.getElementById('btnSaveStudent');

// Settings Elements
const googleWebAppUrlInput = document.getElementById('googleWebAppUrlInput');
const btnSaveCloudSettings = document.getElementById('btnSaveCloudSettings');
const btnSyncNow = document.getElementById('btnSyncNow');
const btnExportData = document.getElementById('btnExportData');
const btnLoadSampleData = document.getElementById('btnLoadSampleData');
const appsScriptCodeTextarea = document.getElementById('appsScriptCodeTextarea');
const btnCopyScriptCode = document.getElementById('btnCopyScriptCode');

// Offline Queue Elements
const queueCountDisplay = document.getElementById('queueCountDisplay');
const connectionDisplay = document.getElementById('connectionDisplay');
const lastSyncDisplay = document.getElementById('lastSyncDisplay');
const queueList = document.getElementById('queueList');
const btnFlushQueue = document.getElementById('btnFlushQueue');
const btnVerifySync = document.getElementById('btnVerifySync');
const syncLog = document.getElementById('syncLog');

// Updater Elements
const updaterStatusText = document.getElementById('updaterStatusText');
const updaterVersionText = document.getElementById('updaterVersionText');
const btnCheckUpdates = document.getElementById('btnCheckUpdates');
const btnDownloadUpdate = document.getElementById('btnDownloadUpdate');
const btnInstallUpdate = document.getElementById('btnInstallUpdate');

// Tables & Search
const activeCheckoutsTableBody = document.getElementById('activeCheckoutsTableBody');
const inventoryTableBody = document.getElementById('inventoryTableBody');
const rosterTableBody = document.getElementById('rosterTableBody');
const searchActiveInput = document.getElementById('searchActiveInput');
const searchStudentInput = document.getElementById('searchStudentInput');
const blacklistTableBody = document.getElementById('blacklistTableBody');
const logsTableBody = document.getElementById('logsTableBody');
const searchLogInput = document.getElementById('searchLogInput');
if (searchLogInput) searchLogInput.addEventListener('input', renderLogsTable);

// Toast Container
const toastContainer = document.getElementById('toast-container');

// --- STORAGE HELPERS ---
function saveData() {
    localStorage.setItem('media_tracker_equipment', JSON.stringify(equipment));
    localStorage.setItem('media_tracker_students', JSON.stringify(students));
    localStorage.setItem('media_tracker_checkouts', JSON.stringify(checkouts));
    localStorage.setItem('media_tracker_users', JSON.stringify(users));
    localStorage.setItem('media_tracker_blacklist', JSON.stringify(blacklist));
    localStorage.setItem('media_tracker_settings', JSON.stringify(settings));
    localStorage.setItem('media_tracker_queue', JSON.stringify(pendingQueue));
    localStorage.setItem('media_tracker_lastsync', lastSync);
    refreshUI();
    renderQueueStatus();
}

// --- OFFLINE-FIRST SYNC ENGINE ---
const ID_PREFIX = { equipment: 'eq', student: 'st', checkout: 'co', user: 'us', blacklist: 'bl' };
let idSeq = 0;

// System-style id (same shape the app normally creates: 'st-' + Date.now()).
// A counter is appended when several rows are generated in one pass so ids
// never collide.
function systemId(kind) {
    idSeq += 1;
    return `${ID_PREFIX[kind] || 'id'}-${Date.now()}${idSeq > 1 ? '-' + idSeq : ''}`;
}

function normalizeRow(row, kind, idx) {
    // Case-insensitive lookup. The deployed script was returning lowercase keys
    // (classtype, studentname, checkoutdate) because the sheet headers had no spaces,
    // so every value came back blank and student/checkout edits looked broken.
    const lower = {};
    for (const k in row) lower[String(k).toLowerCase()] = row[k];
    const pick = (keys) => {
        for (const k of keys) {
            const v = lower[String(k).toLowerCase()];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return '';
    };

    if (kind === 'equipment') {
        return {
            id: pick(['id', 'ID']) || systemId('equipment'),
            name: pick(['name', 'Name', 'Equipment', 'Equipment Name']) || 'Unnamed Gear',
            category: pick(['category', 'Category']) || 'Camera',
            stock: parseInt(pick(['stock', 'Stock', 'Max Stock'])) || 1,
            // Optional asset/serial number, shown in Logs as "Equipment number".
            number: pick(['number', 'Number', 'Equipment Number', 'Asset', 'Asset Number', 'Serial'])
        };
    }

    if (kind === 'student') {
        return {
            id: pick(['id', 'ID']) || systemId('student'),
            name: pick(['name', 'Name', 'Student Name']) || 'Unnamed Student',
            // No forced default: an imported roster row with no period stays blank.
            classType: pick(['classType', 'Class', 'Class Type']) || ''
        };
    }

    if (kind === 'user') {
        return {
            id: pick(['id', 'ID']) || systemId('user'),
            code: pick(['code', 'Code', 'Access Code']),
            name: pick(['name', 'Name', 'Display Name']) || 'Unnamed User',
            level: (pick(['level', 'Level', 'Role']) || 'ta').toLowerCase(),
            passwordHash: pick(['passwordHash', 'Password Hash', 'hash'])
        };
    }

    if (kind === 'blacklist') {
        return {
            id: pick(['id', 'ID']) || systemId('blacklist'),
            studentName: pick(['studentName', 'Student Name', 'Name']),
            reason: pick(['reason', 'Reason', 'Notes']),
            addedBy: pick(['addedBy', 'Added By']),
            addedDate: pick(['addedDate', 'Added Date', 'Date']),
            active: String(pick(['active', 'Active'])) === 'false' ? 'false' : 'true'
        };
    }

    return {
        id: pick(['id', 'ID']) || systemId('checkout'),
        studentName: pick(['studentName', 'Student Name']),
        classType: pick(['classType', 'Class', 'Class Type']),
        equipmentId: pick(['equipmentId', 'Equipment ID']),
        equipmentName: pick(['equipmentName', 'Equipment Name', 'Equipment']),
        equipmentNumber: pick(['equipmentNumber', 'Equipment Number', 'Number', 'Asset Number', 'Serial']),
        accessories: pick(['accessories', 'Accessories', 'Notes']),
        checkoutDate: pick(['checkoutDate', 'Checkout Date', 'Date Out']),
        returnDate: pick(['returnDate', 'Return Date', 'Date Due']),
        status: pick(['status', 'Status']) || 'active'
    };
}

// Re-apply queued (not-yet-pushed) local changes on top of cloud data so nothing is lost
function applyAction(a) {
    const d = a.data;
    if (a.type === 'equipment') {
        const idx = equipment.findIndex(e => e.id === d.id);
        if (idx === -1) equipment.push(d); else equipment[idx] = { ...equipment[idx], ...d };
    } else if (a.type === 'student') {
        const idx = students.findIndex(s => s.id === d.id);
        if (idx === -1) students.push(d); else students[idx] = { ...students[idx], ...d };
    } else if (a.type === 'checkout') {
        const idx = checkouts.findIndex(c => c.id === d.id);
        if (idx === -1) checkouts.unshift(d); else checkouts[idx] = { ...checkouts[idx], ...d };
    } else if (a.type === 'delete_equipment') {
        equipment = equipment.filter(e => e.id !== d.id);
    } else if (a.type === 'delete_student') {
        students = students.filter(s => s.id !== d.id);
    } else if (a.type === 'user') {
        const idx = users.findIndex(u => u.id === d.id);
        if (idx === -1) users.push(d); else users[idx] = { ...users[idx], ...d };
    } else if (a.type === 'delete_user') {
        users = users.filter(u => u.id !== d.id);
    } else if (a.type === 'blacklist') {
        const idx = blacklist.findIndex(b => b.id === d.id);
        if (idx === -1) blacklist.push(d); else blacklist[idx] = { ...blacklist[idx], ...d };
    } else if (a.type === 'delete_blacklist') {
        blacklist = blacklist.filter(b => b.id !== d.id);
    }
}

// Every change is saved locally first, then queued for the cloud
function queueChange(type, data) {
    // Guard against re-queueing the same change on every sync pass — this was
    // the duplicate-row loop (an unconfirmed change flushed again each time).
    const key = type + '|' + JSON.stringify(data);
    if (pendingQueue.some(a => (a.type + '|' + JSON.stringify(a.data)) === key)) return null;

    pendingQueue.push({
        id: 'q-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        type,
        data,
        ts: new Date().toISOString()
    });
    saveData();
    if (settings.webAppUrl) flushQueue();
    return pendingQueue[pendingQueue.length - 1];
}

async function flushQueue(showToasts = false) {
    if (!settings.webAppUrl) {
        setSyncStatus('Local Storage Mode', false);
        return false;
    }
    if (!navigator.onLine) {
        setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
        return false;
    }
    if (pendingQueue.length === 0) {
        setSyncStatus('Server Synced', true);
        return true;
    }

    const body = JSON.stringify({ actions: pendingQueue });
    logSync(`POST ${pendingQueue.length} action(s) — sending...`);

    try {
        const res = await fetch(settings.webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        if (!res.ok) throw new Error('bad response');
        const result = await res.json();
        logSync(`Server confirmed: applied ${result.applied} action(s).`, 'ok');
    } catch (err) {
        // Apps Script blocks CORS preflight — best-effort opaque send, then verify by reading the sheet back
        try {
            await fetch(settings.webAppUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body
            });
            logSync('POST sent (opaque response). Verifying against the server...', 'warn');
        } catch (fallbackErr) {
            logSync(`POST failed: ${fallbackErr.message}`, 'err');
            setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
            return false;
        }
    }

    // Only clear the queue once the changes are actually confirmed in the sheet
    return verifyQueue(showToasts);
}

// Apps Script returns HTML when the deployment is not readable by the caller
// (Access is not "Anyone", or the URL is the edit URL instead of /exec). That
// case used to be reported as "deployed version is older", which is wrong.
async function readJsonResponse(res) {
    const ct = String(res.headers.get('content-type') || '');
    const text = await res.text();
    if (ct.indexOf('json') === -1 || /^\s*<(!DOCTYPE|html)/i.test(text)) {
        const err = new Error('The /exec URL returned an HTML page instead of JSON.');
        err.htmlPage = true;
        throw err;
    }
    return JSON.parse(text);
}

function logHtmlCause() {
    logSync('Cause: the server returned HTML, not JSON. Check that the deployment Access is "Anyone" (not "Anyone with access to the data") and that the URL ends in /exec — not the /edit URL.', 'warn');
}

// Check whether each queued action is present in the sheet. This is the only
// trustworthy confirmation, since Apps Script POST responses are opaque in a browser.
async function verifyQueue(showToasts = true) {
    if (!settings.webAppUrl) return false;
    if (pendingQueue.length === 0) {
        setSyncStatus('Server Synced', true);
        return true;
    }

    try {
        const res = await fetch(settings.webAppUrl);
        if (!res.ok) throw new Error('bad response');
        const cloud = await readJsonResponse(res);

        const sheetNameFor = (type, data) => {
            if (type === 'assign_id') return (data && data.sheet) || 'Students';
            if (type === 'checkout' || type === 'delete_checkout' || type === 'log' || type === 'delete_log') return 'Checkouts';
            if (type === 'student' || type === 'delete_student') return 'Students';
            if (type === 'auth' || type === 'delete_auth') return 'Auth';
            if (type === 'user' || type === 'delete_user') return 'Users';
            if (type === 'blacklist' || type === 'delete_blacklist') return 'Blacklist';
            return 'Equipment';
        };

        const sheetFor = (type, data) => {
            if (type === 'assign_id') return cloud[(data && data.sheet ? String(data.sheet).toLowerCase() : 'students')] || [];
            if (type === 'checkout' || type === 'delete_checkout' || type === 'log' || type === 'delete_log') return cloud.checkouts;
            if (type === 'student' || type === 'delete_student') return cloud.students;
            if (type === 'auth') return cloud.auth;
            if (type === 'user' || type === 'delete_user') return cloud.users;
            if (type === 'blacklist' || type === 'delete_blacklist') return cloud.blacklist;
            return cloud.equipment;
        };

        const missing = pendingQueue.filter(a => {
            const rows = sheetFor(a.type, a.data);
            if (!Array.isArray(rows)) return true;
            const byId = rows.some(r => String(r.id) === String(a.data.id));
            // A delete counts as applied when the row is GONE. An assign_id
            // counts as applied when the id is present on the row.
            if (a.type.indexOf('delete') === 0) {
                const byName = rows.some(r => String(r.name).trim().toLowerCase() === String(a.data.name || '').trim().toLowerCase());
                return byId || byName;
            }
            // Name fallback: a hand-imported row may still have no id, so match on the
            // name-like column the record carries instead of failing forever.
            const want = String((a.data && (a.data.name || a.data.code || a.data.studentName)) || '').trim().toLowerCase();
            const byName = want && rows.some(r => {
                const cell = String(r.name || r.code || r.studentName || '').trim().toLowerCase();
                return cell === want;
            });
            return !byId && !byName;
        });

        if (missing.length === 0) {
            const count = pendingQueue.length;
            pendingQueue = [];
            lastSync = new Date().toISOString();
            saveData();
            setSyncStatus('Server Synced', true);
            logSync(`Verified ${count} action(s) present on the server.`, 'ok');
            if (showToasts) showToast(`Confirmed: ${count} change(s) reached the server.`, 'success');
            return true;
        }

        logSync(`Not confirmed: ${missing.length} action(s) missing from the server.`, 'err');
        // Name the specific action so an actual data problem is not mistaken for an
        // old deployment. Rows with no id column at all look "missing" forever.
        missing.slice(0, 8).forEach(a => {
            const rows = sheetFor(a.type, a.data);
            const hasIdColumn = Array.isArray(rows) && rows.some(r => r.id !== undefined && String(r.id) !== '');
            const sheet = sheetNameFor(a.type, a.data);
            logSync(`  ${a.type} id=${a.data && a.data.id ? a.data.id : '(none)'} -> ${sheet}${hasIdColumn ? '' : ' (no id column in this table)'}`, 'warn');
        });
        logSync('Most likely cause: the deployed Apps Script is an older version. Redeploy (Deploy > Manage deployments > Edit > New version) with the code in Settings, then click Verify.', 'warn');
        // Ask the server for the raw header row of each sheet. Headers written without
        // spaces (classtype, studentname, checkoutdate) do not match the canonical keys,
        // which makes every field read back blank.
        try {
            const hres = await fetch(settings.webAppUrl + '?action=headers');
            const hj = await readJsonResponse(hres);
            if (hj && hj.headers) {
                Object.keys(hj.headers).forEach(function (name) {
                    var info = hj.headers[name];
                    if (!info) { logSync('  sheet ' + name + ': missing on the server', 'warn'); return; }
                    if (info.mismatched && info.mismatched.length) {
                        logSync('  sheet ' + name + ' headers not recognized: ' + info.mismatched.join(', ') + ' — rename them to ' + info.canonical.join(', '), 'err');
                    }
                    if (info.duplicates && info.duplicates.length) {
                        logSync('  sheet ' + name + ' has duplicate header columns (' + info.duplicates.join(', ') + ') — open ' + settings.webAppUrl + '?action=repair once to clear them', 'err');
                    }
                });
            }
        } catch (hdrErr) {
            logSync('Header check unavailable (deployed version is older than the code in Settings).', 'warn');
        }
        setSyncStatus(`${missing.length} change(s) not confirmed`, false);
        if (showToasts) showToast(`${missing.length} change(s) did not reach the server — redeploy the server code as a NEW version.`, 'error');
        return false;
    } catch (err) {
        if (err.htmlPage) {
            logSync(`Verify failed: ${err.message}`, 'err');
            logHtmlCause();
            setSyncStatus('Endpoint returned HTML — check Access is "Anyone"', false);
            if (showToasts) showToast('The /exec URL is serving HTML. Set deployment Access to "Anyone" and use the /exec URL.', 'error');
            return false;
        }
        logSync(`Verify failed: ${err.message}`, 'err');
        setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
        return false;
    }
}

function logSync(message, level = '') {
    if (!syncLog) return;
    if (syncLog.querySelector('.queue-empty')) syncLog.innerHTML = '';

    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span><span>${escapeHtml(message)}</span>`;
    syncLog.appendChild(line);
    syncLog.scrollTop = syncLog.scrollHeight;
}

// Map cloud rows to system-shaped records. Any row that was imported by hand
// (pasted into the sheet) has no id, so the app assigns a system-style id and
// writes it back INTO the same row with an assign_id action — never as a new
// row, which is what produced the duplicates.
function mapCloudRows(rawList, kind) {
    if (!Array.isArray(rawList)) return [];
    return rawList.map((item, idx) => {
        const rec = normalizeRow(item, kind, idx);
        const rawId = String((item && (item.id || item.ID)) || '').trim();
        if (!rawId) queueChange('assign_id', { sheet: SHEET_NAME[kind], name: rec.name || rec.code || rec.studentName, id: rec.id });
        return rec;
    });
}

const SHEET_NAME = { equipment: 'Equipment', student: 'Students', checkout: 'Checkouts', user: 'Users', blacklist: 'Blacklist', auth: 'Auth' };

// Remove rows that share a name with an earlier row (the duplicates the
// duplicate-id loop created). The first occurrence is kept.
function dedupeByName(list, kind) {
    const actionType = kind === 'student' ? 'delete_student' : 'delete_equipment';
    const seen = new Map();
    const out = [];

    list.forEach(r => {
        const key = String(r.name || '').trim().toLowerCase();
        if (!key) { out.push(r); return; }
        if (seen.has(key)) {
            queueChange(actionType, { id: r.id, name: r.name });
            return;
        }
        seen.set(key, r);
        out.push(r);
    });

    return out;
}

async function syncFromCloud(showToasts = true) {
    if (!settings.webAppUrl) {
        if (showToasts) showToast('Please enter a Google Web App URL in Settings first.', 'warning');
        setSyncStatus('Local Storage Mode', false);
        return;
    }

    if (!navigator.onLine) {
        setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
        if (showToasts) showToast('No connection. Showing local data — changes will sync when back online.', 'warning');
        return;
    }

    try {
        setSyncStatus('Syncing with server...', false);
        if (showToasts) showToast('Connecting to server...', 'info');

        const res = await fetch(settings.webAppUrl);
        if (!res.ok) throw new Error('Network response was not ok');

        const cloudData = await res.json();

        if (cloudData.equipment && Array.isArray(cloudData.equipment)) {
            equipment = dedupeByName(mapCloudRows(cloudData.equipment, 'equipment'), 'equipment');
        }
        if (cloudData.students && Array.isArray(cloudData.students)) {
            students = dedupeByName(mapCloudRows(cloudData.students, 'student'), 'student');
        }
        if (cloudData.checkouts && Array.isArray(cloudData.checkouts)) {
            checkouts = mapCloudRows(cloudData.checkouts, 'checkout');
        }
        if (cloudData.auth && Array.isArray(cloudData.auth)) {
            const row = cloudData.auth.find(r => String(r.key) === 'teacherHash');
            if (row && row.value) {
                const auth = getAuth();
                auth.teacherHash = String(row.value);
                saveAuth(auth);
            }
        }
        if (cloudData.users && Array.isArray(cloudData.users)) {
            users = mapCloudRows(cloudData.users, 'user').filter(u => u.code);
        }
        if (cloudData.blacklist && Array.isArray(cloudData.blacklist)) {
            blacklist = mapCloudRows(cloudData.blacklist, 'blacklist');
        }

        // Put unsynced local changes back on top of the cloud snapshot
        pendingQueue.forEach(applyAction);

        lastSync = new Date().toISOString();
        saveData();
        await flushQueue(showToasts);
    } catch (err) {
        console.error('Cloud Sync Error:', err);
        setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
        if (showToasts) showToast('Could not reach the server. Working offline — changes are queued.', 'error');
    }
}

function renderQueueStatus() {
    if (!queueCountDisplay) return;

    queueCountDisplay.textContent = pendingQueue.length;
    connectionDisplay.textContent = navigator.onLine ? 'Online' : 'Offline';
    lastSyncDisplay.textContent = lastSync ? new Date(lastSync).toLocaleString() : 'Never';

    queueList.innerHTML = '';
    if (pendingQueue.length === 0) {
        queueList.innerHTML = '<div class="queue-empty">Queue is empty — everything is synced.</div>';
        return;
    }

    pendingQueue.forEach(a => {
        const label = (a.data && (a.data.name || a.data.studentName)) || a.data.id;
        const div = document.createElement('div');
        div.className = 'queue-item';
        div.innerHTML = `<span class="q-type">${escapeHtml(a.type)}</span><span>${escapeHtml(label)}</span><span class="q-time">${new Date(a.ts).toLocaleTimeString()}</span>`;
        queueList.appendChild(div);
    });
}

function setSyncStatus(text, isOnline) {
    syncStatusText.textContent = text;
    const badge = document.getElementById('syncStatusBadge');
    badge.classList.toggle('offline', !isOnline);

    if (isOnline) {
        syncStatusDot.style.backgroundColor = 'var(--success)';
        syncStatusDot.style.boxShadow = '0 0 8px var(--success)';
    } else {
        syncStatusDot.style.backgroundColor = 'var(--warning)';
        syncStatusDot.style.boxShadow = 'none';
    }
}

// --- TOAST NOTIFICATION SYSTEM ---
// --- SUBTLE SOUND EFFECTS (Web Audio, no asset files) ---
let audioCtx = null;
let soundMuted = false;

function soundEnabled() {
    return !settings.soundMuted && !soundMuted;
}
function getAudioCtx() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (err) {
            return null;
        }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
}

// Windows 7 / Aero style cues. The Windows sounds of that era are not plain beeps:
// they are soft bell tones with quiet harmonic partials, a gentle low-pass so nothing
// is harsh, and a short shimmer tail that hangs in the air. Each profile below is
// built from that shape, synthesized entirely in Web Audio (no asset files).
//   attack ~15ms  -> no click at the start
//   partials      -> fundamental + 2nd/3rd/4.2nd harmonics at low level = "bell"
//   low-pass      -> rolls off the fizz, keeps it mellow
//   delay feedback-> the shimmer tail
const SOUND_PROFILES = {
    startup:    { notes: [[523.25, 0.00, 0.55], [659.25, 0.20, 0.55], [783.99, 0.40, 0.80]], gain: 0.14, bell: 0.35, lp: 2600, tail: 0.22 },
    success:    { notes: [[659.25, 0.00, 0.38], [880.00, 0.17, 0.50]],                 gain: 0.13, bell: 0.42, lp: 3200, tail: 0.25 },
    notice:     { notes: [[739.99, 0.00, 0.34]],                                        gain: 0.12, bell: 0.48, lp: 3000, tail: 0.28 },
    error:      { notes: [[440.00, 0.00, 0.32], [349.23, 0.19, 0.45]],                 gain: 0.13, bell: 0.22, lp: 1800, tail: 0.18 },
    override:   { notes: [[587.33, 0.00, 0.30], [739.99, 0.15, 0.32], [932.33, 0.30, 0.48]], gain: 0.13, bell: 0.52, lp: 3400, tail: 0.30 },
    disconnect: { notes: [[392.00, 0.00, 0.36], [293.66, 0.21, 0.52]],                 gain: 0.12, bell: 0.18, lp: 1500, tail: 0.16 },
    reconnect:  { notes: [[440.00, 0.00, 0.32], [587.33, 0.17, 0.36], [739.99, 0.34, 0.52]], gain: 0.12, bell: 0.40, lp: 2800, tail: 0.24 },
    click:      { notes: [[1046.50, 0.00, 0.09]],                                       gain: 0.05, bell: 0.60, lp: 4200, tail: 0.10 }
};

function playSound(kind) {
    if (!soundEnabled()) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const profile = SOUND_PROFILES[kind] || SOUND_PROFILES.notice;
    const now = ctx.currentTime;

    // Master: low-pass for the mellow Aero character, then a gentle limiter-ish gain.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = profile.lp;
    filter.Q.value = 0.6;

    const master = ctx.createGain();
    master.gain.value = profile.gain;

    // Shimmer tail: a short feedback delay gives the chime a room to ring in.
    const tail = ctx.createDelay(0.5);
    tail.delayTime.value = 0.11;
    const tailGain = ctx.createGain();
    tailGain.gain.value = profile.tail;
    const tailFilter = ctx.createBiquadFilter();
    tailFilter.type = 'lowpass';
    tailFilter.frequency.value = 2200;

    filter.connect(master);
    master.connect(ctx.destination);
    master.connect(tail);
    tail.connect(tailFilter);
    tailFilter.connect(tailGain);
    tailGain.connect(tail);
    tailGain.connect(ctx.destination);

    const partials = [1, 2, 3, 4.2]; // fundamental + harmonics = bell, not beep
    const harmonicLevel = [1.0, 0.34, 0.16, 0.07];

    profile.notes.forEach(function (n) {
        const freq = n[0], start = n[1], dur = n[2];
        partials.forEach(function (p, i) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = i === 0 ? 'sine' : 'sine';
            osc.frequency.setValueAtTime(freq * p, now + start);
            // Very slight detune on the upper partials: makes it ring rather than buzz.
            if (i > 0) osc.frequency.setValueAtTime(freq * p * (1 + 0.0015 * i), now + start);

            const level = harmonicLevel[i] * (i === 0 ? 1 : profile.bell);
            const t0 = now + start;
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(level, t0 + 0.015);        // soft attack, no click
            gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
            // Upper harmonics decay faster than the fundamental, like a real bell.
            if (i > 0) gain.gain.setTargetAtTime(0, t0 + dur * 0.5, dur * 0.25);

            osc.connect(gain);
            gain.connect(filter);
            osc.start(t0);
            osc.stop(t0 + dur + 0.05);
        });
    });
}

// In-app confirm. The native confirm() is a Windows dialog — on school machines it
// can steal focus, sit behind the window, or stall the renderer. Everything now stays
// inside the app, in the same Aero/49ers styling as the other modals.
function confirmDialog(message, title = 'Confirm') {
    const overlay = document.getElementById('modalConfirm');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('btnConfirmOk');
    const cancelBtn = document.getElementById('btnConfirmCancel');
    if (!overlay) return Promise.resolve(false);

    return new Promise((resolve) => {
        titleEl.textContent = title;
        msgEl.textContent = message;
        overlay.classList.add('active');
        playSound('notice');

        const finish = (value, kind) => {
            overlay.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
            playSound(kind);
            resolve(value);
        };
        const onOk = () => finish(true, 'success');
        const onCancel = () => finish(false, 'click');
        const onKey = (e) => {
            if (e.key === 'Escape') finish(false, 'click');
            if (e.key === 'Enter') finish(true, 'success');
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);
        okBtn.focus();
    });
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '❌';
    if (type === 'info') icon = 'ℹ️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    playSound(type === 'success' ? 'success' : type === 'error' ? 'error' : 'notice');

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// --- TAB NAVIGATION ---
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetTab = item.getAttribute('data-tab');

        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        item.classList.add('active');
        document.getElementById(`tab-${targetTab}`).classList.add('active');
        playSound('click');
    });
});

// --- DATE PRESETS ---
// Presets skip weekends: on a Friday, "Tomorrow" resolves to the following Monday.
function setReturnDateDays(days) {
    const d = nextBusinessDay(addDays(new Date(), days));
    returnDateInput.value = localDateStr(d);
    if (miniCalendar) renderMiniCalendar();
    if (weekendHint) {
        const chosen = new Date(returnDateInput.value + 'T00:00:00');
        const raw = addDays(new Date(), days);
        weekendHint.textContent = localDateStr(chosen) !== localDateStr(raw)
            ? `Weekend skipped — ${days === 1 ? 'tomorrow' : days + ' days'} lands on ${chosen.toLocaleDateString('en-US', { weekday: 'long' })}.`
            : '';
    }
}

presetToday.addEventListener('click', () => setReturnDateDays(0));
presetTomorrow.addEventListener('click', () => setReturnDateDays(1));
preset3Days.addEventListener('click', () => setReturnDateDays(3));
preset1Week.addEventListener('click', () => setReturnDateDays(7));

// --- MINI CALENDAR (click a day to set the return date) ---
// Declared before setReturnDateDays() runs at load time: a const in its
// temporal dead zone throws ReferenceError and kills the whole renderer.
const miniCalendar = document.getElementById('miniCalendar');
const weekendHint = document.getElementById('weekendHint');
let calendarMonth = new Date();

// Default date to tomorrow (weekend-aware)
setReturnDateDays(1);

function renderMiniCalendar() {
    if (!miniCalendar) return;

    const todayStr = localDateStr(new Date());
    const selStr = returnDateInput.value;
    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    const first = new Date(y, m, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    let html = `<div class="mini-cal-head">${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>`;
    html += '<div class="mini-cal-grid">';
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(d => html += `<div class="mini-cal-dow">${d}</div>`);

    for (let i = 0; i < startDay; i++) html += '<div class="mini-cal-cell empty"></div>';

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(y, m, d);
        const ds = localDateStr(date);
        const dow = date.getDay();
        const weekend = dow === 0 || dow === 6;
        const cls = ['mini-cal-cell'];
        if (weekend) cls.push('weekend');
        if (ds === todayStr) cls.push('today');
        if (ds === selStr) cls.push('selected');
        if (ds < todayStr) cls.push('past');
        html += `<button type="button" class="${cls.join(' ')}" data-date="${ds}">${d}</button>`;
    }

    html += '</div>';
    html += `<div class="mini-cal-foot"><button type="button" class="mini-cal-nav" id="calPrev">‹</button><span>Weekends are shaded — returns land on the next Monday</span><button type="button" class="mini-cal-nav" id="calNext">›</button></div>`;

    miniCalendar.innerHTML = html;

    miniCalendar.querySelectorAll('.mini-cal-cell:not(.empty)').forEach(cell => {
        cell.addEventListener('click', () => {
            const picked = cell.dataset.date;
            const date = new Date(picked + 'T00:00:00');
            const adjusted = settings.skipWeekends ? nextBusinessDay(date) : date;
            returnDateInput.value = localDateStr(adjusted);
            if (weekendHint) {
                weekendHint.textContent = localDateStr(adjusted) !== picked
                    ? `Weekend date pushed to ${adjusted.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}.`
                    : '';
            }
            renderMiniCalendar();
        });
    });

    const prev = document.getElementById('calPrev');
    const next = document.getElementById('calNext');
    if (prev) prev.addEventListener('click', () => { calendarMonth = new Date(y, m - 1, 1); renderMiniCalendar(); });
    if (next) next.addEventListener('click', () => { calendarMonth = new Date(y, m + 1, 1); renderMiniCalendar(); });
}

if (miniCalendar) renderMiniCalendar();

// Quick Tag Buttons for Accessories
document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tag');
        if (accessoriesInput.value.trim() === '') {
            accessoriesInput.value = tag;
        } else {
            accessoriesInput.value += `, ${tag}`;
        }
    });
});

// --- STUDENT AUTOCOMPLETE & CLASS AUTO-FILL ---
// Only auto-fills when the student actually has a period on record.
// A roster imported without a period stays blank instead of defaulting to
// Beginning Digital Media.
studentNameInput.addEventListener('input', () => {
    const val = studentNameInput.value.trim();
    const matched = students.find(s => s.name.toLowerCase() === val.toLowerCase());
    if (matched && matched.classType) {
        classTypeSelect.value = matched.classType;
    } else {
        classTypeSelect.value = '';
    }
    renderStudentSuggestions();
});

studentNameInput.addEventListener('focus', () => renderStudentSuggestions());

// Close the suggestion panel, but allow a click on an item to land first.
studentNameInput.addEventListener('blur', () => {
    setTimeout(() => { if (studentSuggestions) studentSuggestions.classList.remove('open'); }, 150);
});

// In-app suggestion panel. A native <datalist> popup is drawn by Chromium on a white
// background, which made white text unreadable — so suggestions are rendered here.
function renderStudentSuggestions() {
    if (!studentSuggestions) return;
    const q = studentNameInput.value.trim().toLowerCase();
    const matches = students.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 12);

    studentSuggestions.innerHTML = '';
    if (matches.length === 0) {
        studentSuggestions.classList.remove('open');
        return;
    }

    matches.forEach(s => {
        const row = document.createElement('div');
        row.className = 'autocomplete-item' + (isBlacklisted(s.name) ? ' blacklisted' : '');
        row.innerHTML = `<span>${escapeHtml(s.name)}</span><span class="ac-class">${escapeHtml(s.classType || '—')}</span>`;
        row.addEventListener('click', () => {
            studentNameInput.value = s.name;
            if (s.classType) classTypeSelect.value = s.classType;
            studentSuggestions.classList.remove('open');
        });
        studentSuggestions.appendChild(row);
    });

    // Only show the panel while the name box is actually focused. refreshUI() runs this on
    // startup, which used to pop the list open the moment the app launched.
    if (document.activeElement === studentNameInput) {
        studentSuggestions.classList.add('open');
    } else {
        studentSuggestions.classList.remove('open');
    }
}

// --- RENDER FUNCTIONS ---
function refreshUI() {
    renderStats();
    populateStudentDatalist();
    populateEquipmentDropdown();
    renderActiveCheckouts();
    renderInventoryTable();
    renderRosterTable();
    renderBlacklistTable();
    renderLogsTable();
    renderUserTable();
    loadSettingsInputs();
}

function renderStats() {
    const activeList = checkouts.filter(c => c.status === 'active');
    const dueTodayList = activeList.filter(c => checkoutStatus(c) === 'due_today');
    const overdueList = activeList.filter(c => checkoutStatus(c) === 'overdue');

    applyAutoBlacklist();

    statActive.textContent = activeList.length;
    activeBadgeCount.textContent = activeList.length;
    statOverdue.textContent = overdueList.length;
    if (statDueToday) statDueToday.textContent = dueTodayList.length;
    if (statBlacklisted) statBlacklisted.textContent = blacklist.filter(b => String(b.active) !== 'false').length;
    statGearTypes.textContent = equipment.length;
    statStudents.textContent = students.length;
}

function populateStudentDatalist() {
    renderStudentSuggestions();
}

function getEquipmentActiveCount(equipId) {
    return checkouts.filter(c => (c.equipmentId === equipId || c.equipmentName.toLowerCase() === equipId.toLowerCase()) && c.status === 'active').length;
}

function populateEquipmentDropdown() {
    const currentVal = equipmentSelect.value;
    equipmentSelect.innerHTML = '<option value="" disabled selected>Select equipment to check out...</option>';

    equipment.forEach(item => {
        const activeCount = getEquipmentActiveCount(item.id);
        const available = item.stock - activeCount;
        const option = document.createElement('option');
        option.value = item.id;
        
        let stockLabel = `${available} available / ${item.stock} total`;
        if (available <= 0) {
            stockLabel = `⚠️ OUT OF STOCK (${item.stock} checked out)`;
        }

        option.textContent = `${item.name} — [${stockLabel}]`;
        equipmentSelect.appendChild(option);
    });

    if (currentVal) equipmentSelect.value = currentVal;
}

const CLASS_OPTIONS = ['Beginning Digital Media', 'Advanced Digital Media', 'Yearbook', 'Leadership/ASB', 'Other'];

function classSelectHtml(current, id) {
    const opts = ['<option value="">— none —</option>']
        .concat(CLASS_OPTIONS.map(c => `<option value="${escapeHtml(c)}"${c === current ? ' selected' : ''}>${escapeHtml(c)}</option>`));
    return `<select class="class-edit" data-id="${id}">${opts.join('')}</select>`;
}

// Changing the period on an existing checkout writes back to the database
// (both the checkout row and the student's roster record).
function updateCheckoutClass(id, newClass) {
    const c = checkouts.find(x => x.id === id);
    if (!c) return;
    c.classType = newClass;
    saveData();
    queueChange('checkout', c);

    const s = students.find(st => String(st.name).toLowerCase() === String(c.studentName).toLowerCase());
    if (s) {
        s.classType = newClass;
        queueChange('student', s);
    }

    showToast(`Class period updated for ${c.studentName}.`, 'success');
    renderRosterTable();
}

function renderActiveCheckouts() {
    const searchTerm = searchActiveInput.value.toLowerCase().trim();
    const activeList = checkouts.filter(c => c.status === 'active');
    
    const filtered = activeList.filter(c => 
        c.studentName.toLowerCase().includes(searchTerm) ||
        c.equipmentName.toLowerCase().includes(searchTerm) ||
        c.classType.toLowerCase().includes(searchTerm) ||
        (c.accessories && c.accessories.toLowerCase().includes(searchTerm))
    );

    activeCheckoutsTableBody.innerHTML = '';

    if (filtered.length === 0) {
        activeCheckoutsTableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
                    No active checkouts matching criteria.
                </td>
            </tr>
        `;
        return;
    }

    const todayStr = localDateStr(new Date());

    filtered.forEach(item => {
        const st = checkoutStatus(item);
        const tr = document.createElement('tr');

        const statusBadge = st === 'overdue'
            ? '<span class="badge-pill badge-overdue">⚠️ OVERDUE</span>'
            : st === 'due_today'
                ? '<span class="badge-pill badge-due-today">📅 DUE TODAY</span>'
                : '<span class="badge-pill badge-active">Active</span>';

        tr.innerHTML = `
            <td><strong>${escapeHtml(item.studentName)}</strong>${isBlacklisted(item.studentName) ? ' <span class="badge-pill badge-blacklist">🚫 Blacklisted</span>' : ''}</td>
            <td>${classSelectHtml(item.classType, item.id)}</td>
            <td>${escapeHtml(item.equipmentName)}</td>
            <td style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(item.accessories || '—')}</td>
            <td>${item.checkoutDate}</td>
            <td>${item.returnDate}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-success btn-sm btn-return" data-id="${item.id}">
                    📥 Return
                </button>
            </td>
        `;

        activeCheckoutsTableBody.appendChild(tr);
    });

    // Attach return event listeners
    document.querySelectorAll('.btn-return').forEach(btn => {
        btn.addEventListener('click', () => {
            const coId = btn.getAttribute('data-id');
            returnEquipment(coId);
        });
    });

    // Attach class-period change listeners
    activeCheckoutsTableBody.querySelectorAll('.class-edit').forEach(sel => {
        sel.addEventListener('change', () => {
            updateCheckoutClass(sel.getAttribute('data-id'), sel.value);
        });
    });
}

function returnEquipment(checkoutId) {
    const idx = checkouts.findIndex(c => c.id === checkoutId);
    if (idx !== -1) {
        checkouts[idx].status = 'returned';
        checkouts[idx].actualReturnDate = formatDateStr(new Date());
        
        queueChange('checkout', checkouts[idx]);
        saveData();
        showToast(`Checked in ${checkouts[idx].equipmentName} from ${checkouts[idx].studentName}!`, 'success');
    }
}

function renderInventoryTable() {
    inventoryTableBody.innerHTML = '';

    equipment.forEach(item => {
        const activeCount = getEquipmentActiveCount(item.id);
        const available = item.stock - activeCount;
        const pctUsed = Math.min(100, Math.round((activeCount / item.stock) * 100));

        let fillClass = '';
        if (pctUsed >= 100) fillClass = 'empty';
        else if (pctUsed >= 70) fillClass = 'low';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td><span class="badge-pill badge-class">${escapeHtml(item.category)}</span></td>
            <td>${item.stock}</td>
            <td>${activeCount}</td>
            <td><strong style="color: ${available > 0 ? 'var(--success)' : 'var(--danger)'};">${available}</strong></td>
            <td>
                <div class="stock-bar-container">
                    <div class="stock-bar-fill ${fillClass}" style="width: ${pctUsed}%;"></div>
                </div>
                <span style="font-size: 0.8rem; color: var(--text-muted);">${100 - pctUsed}% left</span>
            </td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-equip" data-id="${item.id}">✏️ Edit</button>
                <button class="btn btn-danger btn-sm btn-delete-equip" data-id="${item.id}" style="margin-left: 4px;">🗑️</button>
            </td>
        `;

        inventoryTableBody.appendChild(tr);
    });

    // Attach listeners
    document.querySelectorAll('.btn-edit-equip').forEach(btn => {
        btn.addEventListener('click', () => openEditEquipmentModal(btn.getAttribute('data-id')));
    });
    document.querySelectorAll('.btn-delete-equip').forEach(btn => {
        btn.addEventListener('click', () => deleteEquipment(btn.getAttribute('data-id')));
    });
}

function renderRosterTable() {
    const searchTerm = searchStudentInput.value.toLowerCase().trim();
    const filtered = students.filter(s => 
        s.name.toLowerCase().includes(searchTerm) || 
        s.classType.toLowerCase().includes(searchTerm)
    );

    rosterTableBody.innerHTML = '';

    filtered.forEach(student => {
        const activeCount = checkouts.filter(c => c.studentName.toLowerCase() === student.name.toLowerCase() && c.status === 'active').length;
        const totalCount = checkouts.filter(c => c.studentName.toLowerCase() === student.name.toLowerCase()).length;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(student.name)}</strong></td>
            <td><span class="badge-pill badge-class">${escapeHtml(student.classType) || '—'}</span></td>
            <td>${activeCount > 0 ? `<span class="badge-pill badge-active">${activeCount} active</span>` : '0'}</td>
            <td>${totalCount} total</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-edit-student" data-id="${student.id}">✏️ Edit</button>
                <button class="btn btn-danger btn-sm btn-delete-student" data-id="${student.id}" style="margin-left: 4px;">🗑️</button>
            </td>
        `;

        rosterTableBody.appendChild(tr);
    });

    // Attach listeners
    document.querySelectorAll('.btn-edit-student').forEach(btn => {
        btn.addEventListener('click', () => openEditStudentModal(btn.getAttribute('data-id')));
    });
    document.querySelectorAll('.btn-delete-student').forEach(btn => {
        btn.addEventListener('click', () => deleteStudent(btn.getAttribute('data-id')));
    });
}

function renderBlacklistTable() {
    if (!blacklistTableBody) return;
    const searchTerm = (document.getElementById('searchBlacklistInput')?.value || '').toLowerCase().trim();
    const filtered = blacklist.filter(b =>
        String(b.studentName).toLowerCase().includes(searchTerm) ||
        String(b.reason).toLowerCase().includes(searchTerm)
    );

    blacklistTableBody.innerHTML = '';

    if (filtered.length === 0) {
        blacklistTableBody.innerHTML = `
            <tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">No students blacklisted.</td></tr>
        `;
        return;
    }

    filtered.forEach(b => {
        const active = String(b.active) !== 'false';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(b.studentName)}</strong></td>
            <td style="color:var(--text-muted);">${escapeHtml(b.reason || '—')}</td>
            <td>${escapeHtml(b.addedBy || '—')}</td>
            <td>${escapeHtml(b.addedDate || '—')}</td>
            <td>${active ? '<span class="badge-pill badge-blacklist">🚫 Active</span>' : '<span class="badge-pill badge-active">Lifted</span>'}</td>
            <td>
                ${active
                    ? `<button class="btn btn-secondary btn-sm btn-lift" data-id="${b.id}">Lift</button>`
                    : `<button class="btn btn-secondary btn-sm btn-reactivate" data-id="${b.id}">Re-apply</button>`}
                <button class="btn btn-danger btn-sm btn-delete-blacklist" data-id="${b.id}" style="margin-left:4px;">🗑️</button>
            </td>
        `;
        blacklistTableBody.appendChild(tr);
    });

    blacklistTableBody.querySelectorAll('.btn-lift').forEach(btn => {
        btn.addEventListener('click', () => {
            const b = blacklist.find(x => x.id === btn.getAttribute('data-id'));
            if (!b) return;
            b.active = 'false';
            queueChange('blacklist', b);
        });
    });
    blacklistTableBody.querySelectorAll('.btn-reactivate').forEach(btn => {
        btn.addEventListener('click', () => {
            const b = blacklist.find(x => x.id === btn.getAttribute('data-id'));
            if (!b) return;
            b.active = 'true';
            queueChange('blacklist', b);
        });
    });
    blacklistTableBody.querySelectorAll('.btn-delete-blacklist').forEach(btn => {
        btn.addEventListener('click', () => queueChange('delete_blacklist', { id: btn.getAttribute('data-id') }));
    });
}

function addBlacklistEntry(name, reason) {
    const student = String(name || '').trim();
    if (!student) { showToast('Enter a student name.', 'warning'); return; }

    const existing = blacklist.find(b => String(b.studentName).toLowerCase() === student.toLowerCase());
    const entry = existing || {
        id: 'bl-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        studentName: student,
        reason: reason || 'Behavior',
        addedBy: displayNameFor(currentRole()) || 'Staff',
        addedDate: localDateStr(new Date()),
        active: 'true'
    };

    if (existing) {
        existing.reason = reason || existing.reason;
        existing.active = 'true';
        existing.addedBy = displayNameFor(currentRole()) || 'Staff';
        existing.addedDate = localDateStr(new Date());
    } else {
        blacklist.push(entry);
    }

    queueChange('blacklist', entry);
    showToast(`${student} blacklisted.`, 'success');
}

// --- FORM SUBMISSION & CHECKOUT LOGIC ---
checkoutForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const typedName = studentNameInput.value.trim();
    // The class used for THIS checkout. If the form is left blank, fall back to the
    // student's roster class, but the value actually used here is what gets recorded.
    const rosterStudent = students.find(s => s.name.toLowerCase() === typedName.toLowerCase());
    const selectedClass = classTypeSelect.value || (rosterStudent && rosterStudent.classType) || '';
    const selectedEquipId = equipmentSelect.value;
    const returnDate = returnDateInput.value;
    const accessories = accessoriesInput.value.trim();

    if (!typedName || !selectedEquipId || !returnDate) {
        showToast('Please fill out all required fields.', 'warning');
        return;
    }

    const matchedEquipment = equipment.find(e => e.id === selectedEquipId);
    if (!matchedEquipment) return;

    // Package pending data BEFORE the override checks. The override callback runs
    // later, asynchronously, so it must see this checkout's data, not a stale one.
    pendingCheckoutData = {
        studentName: typedName,
        classType: selectedClass,
        equipmentId: selectedEquipId,
        equipmentName: matchedEquipment.name,
        // Snapshot the equipment number at checkout time so the log keeps it even if
        // the inventory record is edited or deleted later.
        equipmentNumber: matchedEquipment.number || '',
        accessories: accessories,
        checkoutDate: formatDateStr(new Date()),
        returnDate: returnDate,
        status: 'active'
    };

    // Blacklisted students cannot check out equipment. In kiosk mode this can
    // only be bypassed by a Developer or Staff code + password.
    if (isBlacklisted(typedName)) {
        const entry = blacklist.find(b => String(b.studentName).toLowerCase() === typedName.toLowerCase());
        const reason = `${typedName} is blacklisted${entry && entry.reason ? ' — ' + entry.reason : ''}.`;
        if (!canOverride()) {
            showToast(reason + ' Override requires a Developer or Staff code.', 'error');
            const data = pendingCheckoutData;
            requestOverride(`${reason} Enter a Developer or Staff code and password to override.`, () => proceedCheckout(data));
            return;
        }
        // Warn FIRST, then require an explicit confirmation before the override is used.
        // Previously a Staff/Developer session silently overrode and checked out.
        showToast(reason, 'error');
        playSound('error');
        const data = pendingCheckoutData;
        confirmDialog(
            `${reason} Proceed with the override and complete this checkout?`,
            'Blacklist Override'
        ).then(ok => {
            if (!ok) {
                showToast('Override cancelled — checkout not completed.', 'warning');
                return;
            }
            showToast(reason + ' Overridden by ' + displayNameFor(sessionUser) + '.', 'warning');
            playSound('override');
            proceedCheckout(data);
        });
        return;
    }

    // 1. Check if student is registered in database
    const registeredStudent = students.find(s => s.name.toLowerCase() === typedName.toLowerCase());
    if (!registeredStudent) {
        // Prompt Student Registration Modal
        unregisteredStudentNameDisplay.textContent = typedName;
        modalStudentClassSelect.value = selectedClass;
        modalRegisterStudent.classList.add('active');
        return;
    }

    // 2. Check for an existing active checkout for this student
    const existing = checkouts.filter(c => c.status === 'active' && String(c.studentName).toLowerCase() === typedName.toLowerCase());
    if (existing.length > 0) {
        const reason = `${typedName} already has ${existing.length} item(s) checked out (${existing.map(c => c.equipmentName).join(', ')}).`;
        if (!canOverride()) {
            showToast(reason + ' Override requires a Developer or Staff code.', 'error');
            requestOverride(`${reason} Enter a Developer or Staff code and password to override.`, () => proceedCheckout(pendingCheckoutData));
            return;
        }
        showToast(reason + ' Overridden by ' + displayNameFor(sessionUser) + '.', 'warning');
    }

    // 3. Check Equipment Stock
    checkStockAndProceed();
});

function proceedCheckout(data) {
    pendingCheckoutData = data;
    checkStockAndProceed();
}

function checkStockAndProceed() {
    const item = equipment.find(e => e.id === pendingCheckoutData.equipmentId);
    const activeCount = getEquipmentActiveCount(item.id);

    if (activeCount >= item.stock) {
        // Stock limit reached modal prompt
        stockWarningItemName.textContent = `${item.name} (${activeCount}/${item.stock} currently checked out)`;
        modalStockWarning.classList.add('active');
        return;
    }

    // If stock is good, finalize checkout immediately
    finalizeCheckout();
}

function finalizeCheckout() {
    if (!pendingCheckoutData) return;

    const newCheckout = {
        id: 'co-' + Date.now(),
        ...pendingCheckoutData
    };

    checkouts.unshift(newCheckout);

    // The class recorded on the checkout is authoritative for that checkout. Only fill in
    // the roster when the student has no class yet — never overwrite a student's existing
    // class with the class used for one checkout.
    const rosterStudent = students.find(s => s.name.toLowerCase() === newCheckout.studentName.toLowerCase());
    if (rosterStudent && !rosterStudent.classType && newCheckout.classType) {
        rosterStudent.classType = newCheckout.classType;
        queueChange('student', rosterStudent);
    }

    saveData();
    queueChange('checkout', newCheckout);

    showToast(`Checked out ${newCheckout.equipmentName} to ${newCheckout.studentName}!`, 'success');

    // Reset form
    checkoutForm.reset();
    setReturnDateDays(1);
    pendingCheckoutData = null;
}

// --- MODAL EVENT HANDLERS ---
// Student Registration Prompt Modal
btnCancelRegister.addEventListener('click', () => {
    modalRegisterStudent.classList.remove('active');
    pendingCheckoutData = null;
});

btnConfirmRegister.addEventListener('click', () => {
    if (!pendingCheckoutData) return;

    const newStudentClass = modalStudentClassSelect.value;
    const newStudent = {
        id: 'st-' + Date.now(),
        name: pendingCheckoutData.studentName,
        classType: newStudentClass
    };

    students.push(newStudent);
    saveData();
    queueChange('student', newStudent);
    
    showToast(`Registered new student: ${newStudent.name} (${newStudent.classType})`, 'success');
    modalRegisterStudent.classList.remove('active');

    // Continue to stock check
    checkStockAndProceed();
});

// Stock Override Prompt Modal
btnNetworkOk.addEventListener('click', () => {
    modalNetwork.classList.remove('active');
});

btnCancelStockOverride.addEventListener('click', () => {
    modalStockWarning.classList.remove('active');
    pendingCheckoutData = null;
});

btnConfirmStockOverride.addEventListener('click', () => {
    const data = pendingCheckoutData;
    const finish = () => {
        pendingCheckoutData = data;
        finalizeCheckout();
    };

    // In kiosk mode a stock-limit override needs a Developer or Staff code.
    if (kioskMode && !canOverride()) {
        modalStockWarning.classList.remove('active');
        requestOverride('Stock limit reached. Enter a Developer or Staff code and password to override.', finish);
        return;
    }
    playSound('override');

    modalStockWarning.classList.remove('active');
    finalizeCheckout();
});

// Equipment Add/Edit Modal
btnOpenAddEquipment.addEventListener('click', () => {
    modalEquipmentTitle.textContent = 'Add New Equipment';
    editEquipmentId.value = '';
    equipNameInput.value = '';
    equipCategorySelect.value = 'Camera';
    equipStockInput.value = '1';
    equipNumberInput.value = '';
    modalEquipment.classList.add('active');
});

btnCloseEquipModal.addEventListener('click', () => modalEquipment.classList.remove('active'));

btnSaveEquipment.addEventListener('click', () => {
    const name = equipNameInput.value.trim();
    const category = equipCategorySelect.value;
    const stock = parseInt(equipStockInput.value) || 1;
    const number = equipNumberInput.value.trim();
    const id = editEquipmentId.value;

    if (!name) {
        showToast('Please enter equipment name.', 'warning');
        return;
    }

    let savedItem;
    if (id) {
        // Edit
        const idx = equipment.findIndex(e => e.id === id);
        if (idx !== -1) {
            equipment[idx].name = name;
            equipment[idx].category = category;
            equipment[idx].stock = stock;
            equipment[idx].number = number;
            savedItem = equipment[idx];
        }
    } else {
        // Create
        savedItem = {
            id: 'eq-' + Date.now(),
            name,
            category,
            stock,
            number
        };
        equipment.push(savedItem);
    }

    saveData();
    if (savedItem) queueChange('equipment', savedItem);
    modalEquipment.classList.remove('active');
    showToast('Equipment saved successfully!', 'success');
});

function openEditEquipmentModal(id) {
    const item = equipment.find(e => e.id === id);
    if (!item) return;

    modalEquipmentTitle.textContent = 'Edit Equipment';
    editEquipmentId.value = item.id;
    equipNameInput.value = item.name;
    equipCategorySelect.value = item.category;
    equipStockInput.value = item.stock;
    equipNumberInput.value = item.number || '';
    modalEquipment.classList.add('active');
}

async function deleteEquipment(id) {
    const item = equipment.find(e => e.id === id);
    const name = item ? item.name : 'this equipment type';
    if (await confirmDialog(`Are you sure you want to delete ${name}?`, 'Delete Equipment')) {
        equipment = equipment.filter(e => e.id !== id);
        saveData();
        queueChange('delete_equipment', { id });
        showToast('Equipment removed.', 'info');
    }
}

// Student Add/Edit Modal
btnOpenAddStudent.addEventListener('click', () => {
    modalStudentTitle.textContent = 'Add Student';
    editStudentId.value = '';
    studentFullNameInput.value = '';
    studentClassTypeSelect.value = '';
    modalStudent.classList.add('active');
});

btnCloseStudentModal.addEventListener('click', () => modalStudent.classList.remove('active'));

btnSaveStudent.addEventListener('click', () => {
    const name = studentFullNameInput.value.trim();
    const classType = studentClassTypeSelect.value;
    const id = editStudentId.value;

    if (!name) {
        showToast('Please enter student full name.', 'warning');
        return;
    }

    let savedStudent;
    if (id) {
        const idx = students.findIndex(s => s.id === id);
        if (idx !== -1) {
            students[idx].name = name;
            students[idx].classType = classType;
            savedStudent = students[idx];
        }
    } else {
        savedStudent = {
            id: 'st-' + Date.now(),
            name,
            classType
        };
        students.push(savedStudent);
    }

    saveData();
    if (savedStudent) queueChange('student', savedStudent);
    modalStudent.classList.remove('active');
    showToast('Student saved successfully!', 'success');
});

function openEditStudentModal(id) {
    const s = students.find(item => item.id === id);
    if (!s) return;

    modalStudentTitle.textContent = 'Edit Student';
    editStudentId.value = s.id;
    studentFullNameInput.value = s.name;
    studentClassTypeSelect.value = s.classType;
    modalStudent.classList.add('active');
}

async function deleteStudent(id) {
    const student = students.find(s => s.id === id);
    const name = student ? student.name : 'this student';
    if (await confirmDialog(`Are you sure you want to delete ${name} from the roster?`, 'Delete Student')) {
        students = students.filter(s => s.id !== id);
        saveData();
        queueChange('delete_student', { id });
        showToast('Student deleted from roster.', 'info');
    }
}

// --- SEARCH LISTENERS ---
searchActiveInput.addEventListener('input', renderActiveCheckouts);
searchStudentInput.addEventListener('input', renderRosterTable);
const searchBlacklistInput = document.getElementById('searchBlacklistInput');
if (searchBlacklistInput) searchBlacklistInput.addEventListener('input', renderBlacklistTable);

// --- BLACKLIST ---
const btnAddBlacklist = document.getElementById('btnAddBlacklist');
if (btnAddBlacklist) {
    btnAddBlacklist.addEventListener('click', () => {
        if (!can('staff')) { showToast('Staff or Developer access required to blacklist a student.', 'error'); return; }
        const name = document.getElementById('blacklistStudentInput').value.trim();
        const reason = document.getElementById('blacklistReasonInput').value.trim();
        addBlacklistEntry(name, reason);
        if (document.getElementById('blacklistStudentInput')) document.getElementById('blacklistStudentInput').value = '';
        if (document.getElementById('blacklistReasonInput')) document.getElementById('blacklistReasonInput').value = '';
    });
}

// --- ACCESS CODES (Developer Console) ---
function renderUserTable() {
    const body = document.getElementById('userTableBody');
    if (!body) return;

    const list = (typeof userList === 'function' ? userList() : users).slice().sort((a, b) => RANK[b.level] - RANK[a.level]);
    body.innerHTML = '';

    if (list.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px;">No access codes yet.</td></tr>';
        return;
    }

    list.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(u.code)}</strong></td>
            <td>${escapeHtml(u.name)}</td>
            <td><span class="badge-pill badge-class">${escapeHtml(u.level)}</span></td>
            <td>${u.code === ADMIN_CODE ? '<span style="color:var(--text-muted);">hardcoded</span>' : `<button class="btn btn-danger btn-sm btn-delete-user" data-id="${u.id}">🗑️</button>`}</td>
        `;
        body.appendChild(tr);
    });

    body.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!can('developer')) return;
            const id = btn.getAttribute('data-id');
            users = users.filter(u => u.id !== id);
            saveData();
            queueChange('delete_user', { id });
            showToast('Access code removed.', 'info');
        });
    });
}

const btnSaveUser = document.getElementById('btnSaveUser');
if (btnSaveUser) {
    btnSaveUser.addEventListener('click', async () => {
        if (!can('developer')) { showToast('Developer access required to create access codes.', 'error'); return; }
        const code = document.getElementById('userCodeInput').value.trim();
        const name = document.getElementById('userNameInput').value.trim();
        const level = document.getElementById('userLevelSelect').value;
        const pw = document.getElementById('userPasswordInput').value;

        if (!code) { showToast('Enter an access code.', 'warning'); return; }
        if (!pw) { showToast('Enter a password for this code.', 'warning'); return; }

        const rec = await addOrUpdateUser(code, name, level, pw);
        if (rec) {
            showToast(`Access code ${rec.code} saved (${rec.level}).`, 'success');
            document.getElementById('userPasswordInput').value = '';
            renderUserTable();
        }
    });
}

// --- SETTINGS & BACKUP ---
function loadSettingsInputs() {
    googleWebAppUrlInput.value = settings.webAppUrl || '';
    appsScriptCodeTextarea.value = APPS_SCRIPT_TEMPLATE;

    const auto = document.getElementById('autoBlacklistOverdue');
    if (auto) auto.checked = !!settings.autoBlacklistOverdue;
    const skip = document.getElementById('skipWeekends');
    if (skip) skip.checked = settings.skipWeekends !== false;
    const sound = document.getElementById('soundToggle');
    if (sound) sound.value = settings.soundMuted ? 'off' : 'on';
}

const soundToggle = document.getElementById('soundToggle');
if (soundToggle) {
    soundToggle.addEventListener('change', () => {
        settings.soundMuted = soundToggle.value === 'off';
        saveData();
        if (!settings.soundMuted) playSound('success');
    });
}

const autoBlacklistToggle = document.getElementById('autoBlacklistOverdue');
if (autoBlacklistToggle) {
    autoBlacklistToggle.addEventListener('change', () => {
        settings.autoBlacklistOverdue = autoBlacklistToggle.checked;
        saveData();
    });
}

btnSaveCloudSettings.addEventListener('click', () => {
    settings.webAppUrl = googleWebAppUrlInput.value.trim();
    saveData();

    if (settings.webAppUrl) {
        showToast('Web App URL saved! Attempting sync...', 'info');
        syncFromCloud(true);
    } else {
        setSyncStatus('Local Storage Mode', false);
        showToast('Saved (Local Storage Mode)', 'info');
    }
});

btnSyncNow.addEventListener('click', () => {
    syncFromCloud(true);
});

btnVerifySync.addEventListener('click', () => {
    logSync('Manual verification requested.');
    verifyQueue(true);
});

// Entries that can never be confirmed (rows already deleted, names that no
// longer exist) would otherwise sit in the queue forever and keep showing the
// "not confirmed" error. Dropping them is safe: the sheet is the source of truth.
const btnClearQueue = document.getElementById('btnClearQueue');
if (btnClearQueue) {
    btnClearQueue.addEventListener('click', () => {
        if (pendingQueue.length === 0) { showToast('Queue is already empty.', 'info'); return; }
        const count = pendingQueue.length;
        pendingQueue = [];
        saveData();
        renderQueueStatus();
        setSyncStatus('Queue cleared — re-sync to compare against the server', false);
        logSync(`Dropped ${count} unconfirmable queue entry(ies).`, 'warn');
        showToast(`Queue cleared (${count}). Local data now matches the sheet on the next sync.`, 'success');
    });
}

// Explicit duplicate-name sweep for Students and Equipment: keeps the first
// occurrence of each name and queues the rest as deletes so the sheet is cleaned too.
const btnCleanDupes = document.getElementById('btnCleanDupes');
if (btnCleanDupes) {
    btnCleanDupes.addEventListener('click', async () => {
        const before = { students: students.length, equipment: equipment.length };
        students = dedupeByName(students, 'student');
        equipment = dedupeByName(equipment, 'equipment');
        const removed = (before.students - students.length) + (before.equipment - equipment.length);

        renderRosterTable();
        renderInventoryTable();
        renderStats();

        if (removed === 0) {
            logSync('Duplicate sweep found no repeated names in Students or Equipment.', 'ok');
            showToast('No duplicate names found.', 'info');
            return;
        }

        logSync(`Duplicate sweep: ${before.students - students.length} student name(s) and ${before.equipment - equipment.length} equipment name(s) queued for deletion.`, 'warn');
        showToast(`Queued ${removed} duplicate name(s) for deletion.`, 'success');
        await flushQueue(true);
    });
}

// --- AUTO-UPDATER UI ---
let updatePopupShown = false;

function showUpdatePopup(state) {
    const popup = document.getElementById('updatePopup');
    const body = document.getElementById('updatePopupBody');
    if (!popup || !body) return;

    // state.message already reads "Update available: vX (you are on vY)"
    body.textContent = state.message || 'An update is available.';
    popup.style.display = 'flex';
}

function renderUpdaterState(state) {
    if (!updaterStatusText || !state) return;

    updaterStatusText.textContent = state.message || 'Updater idle';
    updaterStatusText.className = `updater-status ${state.status === 'available' || state.status === 'up-to-date' ? 'available' : state.status === 'error' ? 'error' : state.status === 'downloading' ? 'downloading' : ''}`;
    updaterVersionText.textContent = state.version ? `v${state.version}` : 'v0.0.0';

    btnDownloadUpdate.disabled = state.status !== 'available';
    btnInstallUpdate.disabled = state.status !== 'downloaded';

    // Keep the popup buttons in sync with the updater state so the user can
    // actually install once the download finishes.
    const popup = document.getElementById('updatePopup');
    const popupDownload = document.getElementById('popupDownload');
    const popupInstall = document.getElementById('popupInstall');
    if (popup && popup.style.display !== 'none') {
        if (popupDownload) popupDownload.style.display = state.status === 'available' ? '' : 'none';
        if (popupInstall) popupInstall.style.display = state.status === 'downloaded' ? '' : 'none';
        if (state.status === 'downloaded') playSound('success');
    }

    // Notify on launch when an update is found
    if (state.status === 'available' && !updatePopupShown) {
        updatePopupShown = true;
        showUpdatePopup(state);
    }
}

if (window.electronAPI && window.electronAPI.getUpdaterState) {
    window.electronAPI.onUpdaterState(renderUpdaterState);
    window.electronAPI.getUpdaterState().then(renderUpdaterState);

    btnCheckUpdates.addEventListener('click', () => window.electronAPI.checkForUpdates());
    btnDownloadUpdate.addEventListener('click', () => window.electronAPI.downloadUpdate());
    btnInstallUpdate.addEventListener('click', () => window.electronAPI.installUpdate());

    const popupDownload = document.getElementById('popupDownload');
    const popupLater = document.getElementById('popupLater');
    if (popupDownload) popupDownload.addEventListener('click', () => window.electronAPI.downloadUpdate());
    if (popupInstall) popupInstall.addEventListener('click', () => window.electronAPI.installUpdate());
    if (popupLater) popupLater.addEventListener('click', () => {
        document.getElementById('updatePopup').style.display = 'none';
    });
} else {
    updaterStatusText.textContent = 'Updater is only active in the packaged EXE (open in a browser or run "npm start" for dev mode).';
}

btnFlushQueue.addEventListener('click', () => {
    flushQueue(true);
});

// Reconnect handling: push the queue the moment the connection returns
window.addEventListener('online', () => {
    if (modalNetwork) modalNetwork.classList.remove('active');
    renderQueueStatus();
    playSound('reconnect');
    if (settings.webAppUrl) {
        showToast('Connection restored — pushing queued changes to the server...', 'info');
        syncFromCloud(true);
    } else {
        setSyncStatus('Local Storage Mode', false);
    }
});

window.addEventListener('offline', () => {
    renderQueueStatus();
    setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
    if (modalNetwork) modalNetwork.classList.add('active');
    playSound('disconnect');
    showToast('You are offline. Changes are saved locally and will sync later.', 'warning');
});

// Periodic retry while offline
setInterval(() => {
    if (settings.webAppUrl && pendingQueue.length > 0 && navigator.onLine) {
        flushQueue(true);
    } else if (!navigator.onLine) {
        setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
    }
}, 30000);

btnCopyScriptCode.addEventListener('click', () => {
    navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE);
    showToast('Google Apps Script code copied to clipboard!', 'success');
});

btnExportData.addEventListener('click', () => {
    const backup = {
        equipment,
        students,
        checkouts,
        users,
        blacklist,
        exportDate: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `equipment-tracker-backup-${formatDateStr(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Database backup file exported!', 'success');
});

btnLoadSampleData.addEventListener('click', async () => {
    if (await confirmDialog('Reset to default sample data? Your current data will be overwritten.', 'Reset Database')) {
        equipment = DEFAULT_EQUIPMENT;
        students = DEFAULT_STUDENTS;
        checkouts = DEFAULT_CHECKOUTS;
        saveData();
        showToast('Restored default sample data!', 'success');
    }
});

// Helper String Escaper
function renderLogsTable() {
    if (!logsTableBody) return;
    logsTableBody.innerHTML = '';
    const q = (searchLogInput ? searchLogInput.value : '').trim().toLowerCase();
    const rows = checkouts.filter(c =>
        !q ||
        String(c.studentName).toLowerCase().includes(q) ||
        String(c.equipmentName).toLowerCase().includes(q) ||
        String(c.equipmentNumber || '').toLowerCase().includes(q) ||
        String(c.status).toLowerCase().includes(q)
    );

    if (rows.length === 0) {
        logsTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">No logs found.</td></tr>';
        return;
    }

    rows.forEach(c => {
        // Equipment number: the checkout's own recorded number, else the equipment record's.
        const eq = equipment.find(e => e.id === c.equipmentId || String(e.name).toLowerCase() === String(c.equipmentName).toLowerCase());
        const number = c.equipmentNumber || (eq && eq.number) || '—';
        const status = c.status === 'active' ? checkoutStatus(c) : c.status;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(c.studentName)}</strong></td>
            <td>${escapeHtml(c.equipmentName)}</td>
            <td>${escapeHtml(number)}</td>
            <td>${escapeHtml(c.checkoutDate)}</td>
            <td>${escapeHtml(c.returnDate)}</td>
            <td><span class="badge-pill ${c.status === 'active' ? 'badge-active' : 'badge-returned'}">${escapeHtml(status)}</span></td>
        `;
        logsTableBody.appendChild(tr);
    });
}

// Printable logs: a plain black-on-white view (no theme, no glass) so it prints cleanly.
function buildPrintableLogs() {
    const area = document.getElementById('printArea');
    if (!area) return;
    const rows = checkouts.slice().sort((a, b) => String(a.checkoutDate).localeCompare(String(b.checkoutDate)));
    area.innerHTML = `
        <h1>Checkout Logs — Lannorama Database System</h1>
        <p>Printed ${new Date().toLocaleString()} — ${rows.length} record(s)</p>
        <table>
            <thead><tr>
                <th>Student Name</th><th>Equipment Type</th><th>Equipment Number</th>
                <th>Checkout Date</th><th>Return Date</th><th>Status</th>
            </tr></thead>
            <tbody>
                ${rows.map(c => {
                    const eq = equipment.find(e => e.id === c.equipmentId || String(e.name).toLowerCase() === String(c.equipmentName).toLowerCase());
                    const number = c.equipmentNumber || (eq && eq.number) || '';
                    const status = c.status === 'active' ? checkoutStatus(c) : c.status;
                    return `<tr><td>${escapeHtml(c.studentName)}</td><td>${escapeHtml(c.equipmentName)}</td><td>${escapeHtml(number)}</td><td>${escapeHtml(c.checkoutDate)}</td><td>${escapeHtml(c.returnDate)}</td><td>${escapeHtml(status)}</td></tr>`;
                }).join('')}
            </tbody>
        </table>
    `;
}

function purgeLogs(monthFilter) {
    const now = new Date();
    let targets = checkouts;
    let label = 'all logs';
    if (monthFilter === 'lastMonth') {
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const pm = prev.getMonth(), py = prev.getFullYear();
        targets = checkouts.filter(c => {
            const d = new Date(c.checkoutDate);
            return !isNaN(d) && d.getMonth() === pm && d.getFullYear() === py;
        });
        label = `last month's logs (${prev.toLocaleString('en-US', { month: 'long', year: 'numeric' })})`;
    }
    if (targets.length === 0) {
        showToast(`No logs to purge (${label}).`, 'info');
        return;
    }
    confirmDialog(`Delete ${targets.length} log record(s) from ${label}? This cannot be undone.`, 'Purge Logs').then(ok => {
        if (!ok) { showToast('Purge cancelled.', 'warning'); return; }
        const ids = new Set(targets.map(c => c.id));
        checkouts = checkouts.filter(c => !ids.has(c.id));
        targets.forEach(c => queueChange('delete_checkout', { id: c.id }));
        saveData();
        renderLogsTable();
        renderActiveCheckouts();
        renderStats();
        showToast(`Purged ${ids.size} log record(s).`, 'success');
    });
}

const btnPrintLogs = document.getElementById('btnPrintLogs');
const btnPurgeLogs = document.getElementById('btnPurgeLogs');
const btnPurgeLastMonth = document.getElementById('btnPurgeLastMonth');
if (btnPrintLogs) btnPrintLogs.addEventListener('click', async () => {
    buildPrintableLogs();
    if (window.electronAPI && typeof window.electronAPI.printLogs === 'function') {
        const res = await window.electronAPI.printLogs();
        if (res && res.success) {
            showToast('Logs sent to printer.', 'success');
        } else {
            showToast('Printing failed' + (res && res.failureType ? ' (' + res.failureType + ')' : '') + '.', 'error');
        }
    } else {
        // Browser fallback (dev mode without the preload bridge).
        window.print();
    }
});
if (btnPurgeLogs) btnPurgeLogs.addEventListener('click', () => purgeLogs('all'));
if (btnPurgeLastMonth) btnPurgeLastMonth.addEventListener('click', () => purgeLogs('lastMonth'));

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// --- INITIALIZE APP ---
refreshUI();
renderQueueStatus();

// --- KIOSK MODE ---
// Kiosk is a locked-down, touch-first checkout-only view. The session in kiosk
// is a TA, so no override is possible until a Developer or Staff code + password
// is entered. Fullscreen is enforced in the main process (src/main.js).
let kioskMode = false;
let pendingOverride = null;

function kioskUser() {
    return { id: 'kiosk', code: 'KIOSK', name: 'Kiosk', level: 'ta', passwordHash: '' };
}

function applyKioskUI(on) {
    kioskMode = !!on;
    document.body.classList.toggle('kiosk', kioskMode);

    const badge = document.getElementById('roleBadge');
    const exitBtn = document.getElementById('btnExitKiosk');
    const signOut = document.getElementById('btnLogout');
    const kioskTag = document.getElementById('kioskTag');

    if (kioskMode) {
        sessionUser = kioskUser();
        applyRolePermissions(sessionUser);
        if (badge) badge.textContent = 'Kiosk (locked)';
        if (signOut) signOut.style.display = 'none';
        if (exitBtn) exitBtn.style.display = '';
        if (kioskTag) kioskTag.style.display = '';

        // Force the checkout tab — nothing else is reachable in kiosk.
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        const nav = document.querySelector('.nav-item[data-tab="checkout"]');
        const tab = document.getElementById('tab-checkout');
        if (nav) nav.classList.add('active');
        if (tab) tab.classList.add('active');
    } else {
        if (exitBtn) exitBtn.style.display = 'none';
        if (kioskTag) kioskTag.style.display = 'none';
        if (signOut) signOut.style.display = '';
        if (badge && sessionUser) badge.textContent = displayNameFor(sessionUser);
    }
}

function openOverrideModal(reason, onAllowed) {
    const modal = document.getElementById('modalOverride');
    const msg = document.getElementById('overrideMessage');
    if (!modal) { onAllowed(); return; }

    pendingOverride = onAllowed;
    if (msg) msg.textContent = reason;
    modal.classList.add('active');

    const codeInput = document.getElementById('overrideCode');
    const pwInput = document.getElementById('overridePassword');
    if (codeInput) codeInput.value = '';
    if (pwInput) pwInput.value = '';
    if (codeInput) codeInput.focus();
}

async function confirmOverride() {
    const modal = document.getElementById('modalOverride');
    const msg = document.getElementById('overrideMessage');
    const codeInput = document.getElementById('overrideCode');
    const pwInput = document.getElementById('overridePassword');

    const code = codeInput ? codeInput.value.trim() : '';
    const pw = pwInput ? pwInput.value : '';
    if (!code || !pw) {
        if (msg) msg.textContent = 'Enter the access code and password.';
        return;
    }

    const user = await attemptLogin(code, pw);
    if (!user) {
        if (msg) msg.textContent = 'Unknown code or incorrect password.';
        return;
    }
    if (RANK[user.level] < RANK.staff) {
        if (msg) msg.textContent = 'Only a Developer or Staff code can override.';
        return;
    }

    modal.classList.remove('active');
    const cb = pendingOverride;
    pendingOverride = null;
    showToast(`Override approved by ${displayNameFor(user)}.`, 'success');
    if (cb) cb(user);
}

function requestOverride(reason, onAllowed) {
    if (canOverride()) { onAllowed(); return; }
    openOverrideModal(reason, onAllowed);
}

async function toggleKiosk(on) {
    if (window.electronAPI && window.electronAPI.setKioskState) {
        await window.electronAPI.setKioskState(on);
    }
    setKioskFlag(on);
    applyKioskUI(on);
    showToast(on ? 'Kiosk mode enabled — checkout only.' : 'Kiosk mode disabled.', 'info');
}

const btnExitKiosk = document.getElementById('btnExitKiosk');
if (btnExitKiosk) {
    btnExitKiosk.addEventListener('click', () => {
        openOverrideModal('Enter a Developer or Staff code and password to exit kiosk mode.', async (user) => {
            await toggleKiosk(false);
            sessionUser = user;
            applyRolePermissions(user);
        });
    });
}

const btnEnableKiosk = document.getElementById('btnEnableKiosk');
if (btnEnableKiosk) {
    btnEnableKiosk.addEventListener('click', () => toggleKiosk(true));
}

const btnOverrideConfirm = document.getElementById('btnOverrideConfirm');
const btnOverrideCancel = document.getElementById('btnOverrideCancel');
if (btnOverrideConfirm) btnOverrideConfirm.addEventListener('click', confirmOverride);
if (btnOverrideCancel) btnOverrideCancel.addEventListener('click', () => {
    document.getElementById('modalOverride').classList.remove('active');
    pendingOverride = null;
});

// --- AUTH / LOGIN GATE ---
// The password is required on every launch: the role is kept in memory only,
// so nothing is remembered between runs except the teacher password hash.
async function startAuth() {
    const nameInput = document.getElementById('teacherNameInput');
    const pwInput = document.getElementById('teacherPasswordInput');
    const btnSet = document.getElementById('btnSetTeacherPassword');
    const btnOut = document.getElementById('btnLogout');

    // Show the splash immediately. Previously this function awaited the cloud
    // call first, so a hanging fetch kept the splash up forever and the login
    // gate never appeared.
    const auth = await Promise.race([
        loadCloudAuth(),
        new Promise(res => setTimeout(() => res(getAuth()), 5000))
    ]);
    if (nameInput) nameInput.value = auth.teacherName || 'Mr. Lanning';

    // Kiosk persists across restarts, so a tablet boots straight into the locked
    // checkout view with no login gate. Exiting still needs a code + password.
    if (auth.kiosk) {
        showSplash(1800, async () => {
            if (window.electronAPI && window.electronAPI.getKioskState) {
                const on = await window.electronAPI.getKioskState();
                applyKioskUI(on);
            } else {
                applyKioskUI(true);
            }
        });
        return;
    }

    showSplash(1800, () => showLoginGate(applyRolePermissions));

    if (btnSet) {
        btnSet.addEventListener('click', async () => {
            const pw = pwInput.value.trim();
            if (!pw) { showToast('Enter a password for the teacher.', 'error'); return; }
            const saved = await setTeacherPassword(pw, nameInput ? nameInput.value.trim() : '');
            pwInput.value = '';
            // Mirror to the cloud Auth sheet (queued if offline)
            queueChange('auth', { id: 'teacherHash', key: 'teacherHash', value: saved.teacherHash });
            showToast('Teacher password set and queued for cloud sync.', 'success');
        });
    }

    if (btnOut) {
        btnOut.addEventListener('click', () => {
            signOut();
        });
    }
}

startAuth();

// Run at boot, after all DOM consts exist. Keeps the first occurrence of each
// name and queues the rest for deletion (applied to the sheet when online).
localDupes = dupCount(equipment) + dupCount(students);
equipment = dedupeByName(equipment, 'equipment');
students = dedupeByName(students, 'student');
renderInventoryTable();
renderRosterTable();

if (localDupes > 0) {
    logSync(`Removed ${localDupes} duplicate name(s) from the local data — queued for the sheet.`, 'ok');
    showToast(`Found ${localDupes} duplicate name(s). Kept the first, queued the rest for deletion.`, 'warning');
}

if (settings.webAppUrl) {
    syncFromCloud(false);
} else {
    setSyncStatus(navigator.onLine ? 'Local Storage Mode' : `Offline — ${pendingQueue.length} change(s) queued`, false);
}
