// Digital Media Equipment Tracker - Renderer Script

// --- APPS SCRIPT TEMPLATE CODE FOR GOOGLE SHEETS ---
const APPS_SCRIPT_TEMPLATE = `const HEADERS = {
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
const studentList = document.getElementById('studentList');
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
const stockWarningItemName = document.getElementById('stockWarningItemName');
const btnCancelStockOverride = document.getElementById('btnCancelStockOverride');
const btnConfirmStockOverride = document.getElementById('btnConfirmStockOverride');

const modalEquipment = document.getElementById('modalEquipment');
const modalEquipmentTitle = document.getElementById('modalEquipmentTitle');
const editEquipmentId = document.getElementById('editEquipmentId');
const equipNameInput = document.getElementById('equipNameInput');
const equipCategorySelect = document.getElementById('equipCategorySelect');
const equipStockInput = document.getElementById('equipStockInput');
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
function normalizeRow(row, kind, idx) {
    const pick = (keys) => {
        for (const k of keys) {
            if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
        }
        return '';
    };

    if (kind === 'equipment') {
        return {
            id: pick(['id', 'ID']) || `eq-cloud-${idx}`,
            name: pick(['name', 'Name', 'Equipment', 'Equipment Name']) || 'Unnamed Gear',
            category: pick(['category', 'Category']) || 'Camera',
            stock: parseInt(pick(['stock', 'Stock', 'Max Stock'])) || 1
        };
    }

    if (kind === 'student') {
        return {
            id: pick(['id', 'ID']) || `st-cloud-${idx}`,
            name: pick(['name', 'Name', 'Student Name']) || 'Unnamed Student',
            classType: pick(['classType', 'Class', 'Class Type']) || 'Beginning Digital Media'
        };
    }

    if (kind === 'user') {
        return {
            id: pick(['id', 'ID']) || `us-cloud-${idx}`,
            code: pick(['code', 'Code', 'Access Code']),
            name: pick(['name', 'Name', 'Display Name']) || 'Unnamed User',
            level: (pick(['level', 'Level', 'Role']) || 'ta').toLowerCase(),
            passwordHash: pick(['passwordHash', 'Password Hash', 'hash'])
        };
    }

    if (kind === 'blacklist') {
        return {
            id: pick(['id', 'ID']) || `bl-cloud-${idx}`,
            studentName: pick(['studentName', 'Student Name', 'Name']),
            reason: pick(['reason', 'Reason', 'Notes']),
            addedBy: pick(['addedBy', 'Added By']),
            addedDate: pick(['addedDate', 'Added Date', 'Date']),
            active: String(pick(['active', 'Active'])) === 'false' ? 'false' : 'true'
        };
    }

    return {
        id: pick(['id', 'ID']) || `co-cloud-${idx}`,
        studentName: pick(['studentName', 'Student Name']),
        classType: pick(['classType', 'Class', 'Class Type']),
        equipmentId: pick(['equipmentId', 'Equipment ID']),
        equipmentName: pick(['equipmentName', 'Equipment Name', 'Equipment']),
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
    pendingQueue.push({
        id: 'q-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        type,
        data,
        ts: new Date().toISOString()
    });
    saveData();
    if (settings.webAppUrl) flushQueue();
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
        setSyncStatus('Google Sheets Synced', true);
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
        logSync(`Script confirmed: applied ${result.applied} action(s).`, 'ok');
    } catch (err) {
        // Apps Script blocks CORS preflight — best-effort opaque send, then verify by reading the sheet back
        try {
            await fetch(settings.webAppUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body
            });
            logSync('POST sent (opaque response). Verifying against the sheet...', 'warn');
        } catch (fallbackErr) {
            logSync(`POST failed: ${fallbackErr.message}`, 'err');
            setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
            return false;
        }
    }

    // Only clear the queue once the changes are actually confirmed in the sheet
    return verifyQueue(showToasts);
}

// Check whether each queued action is present in the sheet. This is the only
// trustworthy confirmation, since Apps Script POST responses are opaque in a browser.
async function verifyQueue(showToasts = true) {
    if (!settings.webAppUrl) return false;
    if (pendingQueue.length === 0) {
        setSyncStatus('Google Sheets Synced', true);
        return true;
    }

    try {
        const res = await fetch(settings.webAppUrl);
        if (!res.ok) throw new Error('bad response');
        const cloud = await res.json();

        const sheetFor = (type) => {
            if (type === 'checkout') return cloud.checkouts;
            if (type === 'student' || type === 'delete_student') return cloud.students;
            if (type === 'auth') return cloud.auth;
            if (type === 'user' || type === 'delete_user') return cloud.users;
            if (type === 'blacklist' || type === 'delete_blacklist') return cloud.blacklist;
            return cloud.equipment;
        };

        const missing = pendingQueue.filter(a => {
            const rows = sheetFor(a.type);
            if (!Array.isArray(rows)) return true;
            const found = rows.some(r => String(r.id) === String(a.data.id));
            // For deletes, the row must be GONE to count as applied
            return a.type.indexOf('delete') === 0 ? found : !found;
        });

        if (missing.length === 0) {
            const count = pendingQueue.length;
            pendingQueue = [];
            lastSync = new Date().toISOString();
            saveData();
            setSyncStatus('Google Sheets Synced', true);
            logSync(`Verified ${count} action(s) present in the sheet.`, 'ok');
            if (showToasts) showToast(`Confirmed: ${count} change(s) reached the Google Sheet.`, 'success');
            return true;
        }

        logSync(`Not confirmed: ${missing.length} action(s) missing from the sheet.`, 'err');
        logSync('Most likely cause: the deployed Apps Script is an older version. Redeploy (Deploy > Manage deployments > Edit > New version) with the code in Settings, then click Verify.', 'warn');
        setSyncStatus(`${missing.length} change(s) not confirmed`, false);
        if (showToasts) showToast(`${missing.length} change(s) did not reach the sheet — redeploy the Apps Script as a NEW version.`, 'error');
        return false;
    } catch (err) {
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
        setSyncStatus('Syncing with Google Sheets...', false);
        if (showToasts) showToast('Connecting to Google Sheet...', 'info');

        const res = await fetch(settings.webAppUrl);
        if (!res.ok) throw new Error('Network response was not ok');

        const cloudData = await res.json();

        if (cloudData.equipment && Array.isArray(cloudData.equipment)) {
            equipment = cloudData.equipment.map((item, idx) => normalizeRow(item, 'equipment', idx));
        }
        if (cloudData.students && Array.isArray(cloudData.students)) {
            students = cloudData.students.map((item, idx) => normalizeRow(item, 'student', idx));
        }
        if (cloudData.checkouts && Array.isArray(cloudData.checkouts)) {
            checkouts = cloudData.checkouts.map((item, idx) => normalizeRow(item, 'checkout', idx));
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
            users = cloudData.users.map((item, idx) => normalizeRow(item, 'user', idx)).filter(u => u.code);
        }
        if (cloudData.blacklist && Array.isArray(cloudData.blacklist)) {
            blacklist = cloudData.blacklist.map((item, idx) => normalizeRow(item, 'blacklist', idx));
        }

        // Put unsynced local changes back on top of the cloud snapshot
        pendingQueue.forEach(applyAction);

        lastSync = new Date().toISOString();
        saveData();
        await flushQueue(showToasts);
    } catch (err) {
        console.error('Cloud Sync Error:', err);
        setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
        if (showToasts) showToast('Could not reach Google Sheet. Working offline — changes are queued.', 'error');
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
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

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

// Default date to tomorrow (weekend-aware)
setReturnDateDays(1);

// --- MINI CALENDAR (click a day to set the return date) ---
const miniCalendar = document.getElementById('miniCalendar');
const weekendHint = document.getElementById('weekendHint');
let calendarMonth = new Date();

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
studentNameInput.addEventListener('input', () => {
    const val = studentNameInput.value.trim();
    const matched = students.find(s => s.name.toLowerCase() === val.toLowerCase());
    if (matched) {
        classTypeSelect.value = matched.classType;
    }
});

// --- RENDER FUNCTIONS ---
function refreshUI() {
    renderStats();
    populateStudentDatalist();
    populateEquipmentDropdown();
    renderActiveCheckouts();
    renderInventoryTable();
    renderRosterTable();
    renderBlacklistTable();
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
    studentList.innerHTML = '';
    students.forEach(s => {
        const option = document.createElement('option');
        option.value = s.name;
        option.label = s.classType;
        studentList.appendChild(option);
    });
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
            <td><span class="badge-pill badge-class">${escapeHtml(item.classType)}</span></td>
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
            <td><span class="badge-pill badge-class">${escapeHtml(student.classType)}</span></td>
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
    const selectedClass = classTypeSelect.value;
    const selectedEquipId = equipmentSelect.value;
    const returnDate = returnDateInput.value;
    const accessories = accessoriesInput.value.trim();

    if (!typedName || !selectedClass || !selectedEquipId || !returnDate) {
        showToast('Please fill out all required fields.', 'warning');
        return;
    }

    // Blacklisted students cannot check out equipment.
    if (isBlacklisted(typedName)) {
        const entry = blacklist.find(b => String(b.studentName).toLowerCase() === typedName.toLowerCase());
        showToast(`${typedName} is blacklisted${entry && entry.reason ? ' — ' + entry.reason : ''}. Checkout blocked.`, 'error');
        return;
    }

    const matchedEquipment = equipment.find(e => e.id === selectedEquipId);
    if (!matchedEquipment) return;

    // Package pending data
    pendingCheckoutData = {
        studentName: typedName,
        classType: selectedClass,
        equipmentId: selectedEquipId,
        equipmentName: matchedEquipment.name,
        accessories: accessories,
        checkoutDate: formatDateStr(new Date()),
        returnDate: returnDate,
        status: 'active'
    };

    // 1. Check if student is registered in database
    const registeredStudent = students.find(s => s.name.toLowerCase() === typedName.toLowerCase());
    if (!registeredStudent) {
        // Prompt Student Registration Modal
        unregisteredStudentNameDisplay.textContent = typedName;
        modalStudentClassSelect.value = selectedClass;
        modalRegisterStudent.classList.add('active');
        return;
    }

    // 2. Check Equipment Stock
    checkStockAndProceed();
});

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
btnCancelStockOverride.addEventListener('click', () => {
    modalStockWarning.classList.remove('active');
    pendingCheckoutData = null;
});

btnConfirmStockOverride.addEventListener('click', () => {
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
    modalEquipment.classList.add('active');
});

btnCloseEquipModal.addEventListener('click', () => modalEquipment.classList.remove('active'));

btnSaveEquipment.addEventListener('click', () => {
    const name = equipNameInput.value.trim();
    const category = equipCategorySelect.value;
    const stock = parseInt(equipStockInput.value) || 1;
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
            savedItem = equipment[idx];
        }
    } else {
        // Create
        savedItem = {
            id: 'eq-' + Date.now(),
            name,
            category,
            stock
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
    modalEquipment.classList.add('active');
}

function deleteEquipment(id) {
    if (confirm('Are you sure you want to delete this equipment type?')) {
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
    studentClassTypeSelect.value = 'Beginning Digital Media';
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

function deleteStudent(id) {
    if (confirm('Are you sure you want to delete this student from roster?')) {
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
    renderQueueStatus();
    if (settings.webAppUrl) {
        showToast('Connection restored — pushing queued changes to Google Sheets...', 'info');
        syncFromCloud(true);
    } else {
        setSyncStatus('Local Storage Mode', false);
    }
});

window.addEventListener('offline', () => {
    renderQueueStatus();
    setSyncStatus(`Offline — ${pendingQueue.length} change(s) queued`, false);
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

btnLoadSampleData.addEventListener('click', () => {
    if (confirm('Reset to default sample data? (Your current data will be overwritten)')) {
        equipment = DEFAULT_EQUIPMENT;
        students = DEFAULT_STUDENTS;
        checkouts = DEFAULT_CHECKOUTS;
        saveData();
        showToast('Restored default sample data!', 'success');
    }
});

// Helper String Escaper
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

// --- AUTH / LOGIN GATE ---
// The password is required on every launch: the role is kept in memory only,
// so nothing is remembered between runs except the teacher password hash.
async function startAuth() {
    const nameInput = document.getElementById('teacherNameInput');
    const pwInput = document.getElementById('teacherPasswordInput');
    const btnSet = document.getElementById('btnSetTeacherPassword');
    const btnOut = document.getElementById('btnLogout');

    // Pull the teacher hash from the cloud before the gate is shown, so a
    // password set on another device works here. Falls back to local on failure.
    const auth = await loadCloudAuth();
    if (nameInput) nameInput.value = auth.teacherName || 'Mr. Lanning';

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
            logout();
            location.reload();
        });
    }
}

startAuth();

if (settings.webAppUrl) {
    syncFromCloud(false);
} else {
    setSyncStatus(navigator.onLine ? 'Local Storage Mode' : `Offline — ${pendingQueue.length} change(s) queued`, false);
}
