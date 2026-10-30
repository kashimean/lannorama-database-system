// Auth layer: splash, login gate (access code + password), welcome animation,
// developer console, and role/level permissions.
//
// Levels: developer > staff > ta
//   developer — everything, including changing the Apps Script link
//   staff     — checkout, add equipment, roster, blacklist, settings (sync/updater,
//               but the Drive link is read-only), updater
//   ta        — checkout only
//
// Developer hash is hardcoded (your "set in stone" password). Staff and TA codes
// are created in the Developer Console and stored in the cloud Users sheet.
// Generate a hash:  node scripts/hash.js "your password"

const ADMIN_HASH = '9212e5e6ef4106525be27ac4fcde2db1aa65f4e706eb469cea7f0baec27dcc96'; // password: 2033
const ADMIN_CODE = 'DEV';
const ADMIN_NAME = 'Developer';

const RANK = { ta: 1, staff: 2, developer: 3 };

// Tabs visible per level (a level sees its own tier plus everything below it).
const LEVEL_TABS = {
    ta: ['checkout'],
    staff: ['checkout', 'active-checkouts', 'roster', 'blacklist', 'inventory', 'settings'],
    developer: null // null = all tabs
};

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAuth() {
    const raw = localStorage.getItem('lds_auth');
    if (!raw) return { teacherHash: null, teacherName: 'Mr. Lanning' };
    try {
        const a = JSON.parse(raw);
        return { teacherHash: a.teacherHash || null, teacherName: a.teacherName || 'Mr. Lanning' };
    } catch (e) {
        return { teacherHash: null, teacherName: 'Mr. Lanning' };
    }
}

function saveAuth(auth) {
    // Only the display name and the legacy teacher hash persist. The session user
    // is held in memory only, so the app asks for a code + password on every launch.
    localStorage.setItem('lds_auth', JSON.stringify({
        teacherHash: auth.teacherHash,
        teacherName: auth.teacherName || 'Mr. Lanning'
    }));
}

let sessionUser = null;

// Pull the teacher hash/name and the access codes from the cloud (best effort).
async function loadCloudAuth() {
    const url = (typeof settings !== 'undefined' && settings) ? settings.webAppUrl : '';
    if (!url || !navigator.onLine) return getAuth();

    try {
        const res = await fetch(url);
        if (!res.ok) return getAuth();
        const cloud = await res.json();

        const rows = cloud && Array.isArray(cloud.auth) ? cloud.auth : [];
        const row = rows.find(r => String(r.key) === 'teacherHash');
        if (row && row.value) {
            const auth = getAuth();
            auth.teacherHash = String(row.value);
            saveAuth(auth);
        }

        if (cloud && Array.isArray(cloud.users) && typeof users !== 'undefined' && typeof normalizeRow === 'function') {
            users = cloud.users.map((item, idx) => normalizeRow(item, 'user', idx)).filter(u => u.code);
        }
    } catch (e) {
        // Offline or unreachable: keep the local values.
    }

    return getAuth();
}

function userList() {
    // Local copy first, then merge the cloud Users sheet.
    const local = (typeof users !== 'undefined' && Array.isArray(users)) ? users : [];
    const merged = new Map();
    for (const u of local) if (u && u.code) merged.set(String(u.code).toUpperCase(), u);
    merged.set(ADMIN_CODE, { id: 'us-dev', code: ADMIN_CODE, name: ADMIN_NAME, level: 'developer', passwordHash: ADMIN_HASH });
    return Array.from(merged.values());
}

async function attemptLogin(code, password) {
    const c = String(code || ADMIN_CODE).trim().toUpperCase();
    const hash = await sha256(password);

    const user = userList().find(u => String(u.code).toUpperCase() === c);
    if (!user) return null;

    // Developer always uses the hardcoded hash.
    if (user.level === 'developer' && user.code === ADMIN_CODE) {
        if (hash !== ADMIN_HASH) return null;
        sessionUser = user;
        return user;
    }

    if (user.passwordHash && hash === user.passwordHash) {
        sessionUser = user;
        return user;
    }

    // Backwards compatibility with the old single teacher password.
    const auth = getAuth();
    if (auth.teacherHash && hash === auth.teacherHash) {
        sessionUser = { id: user.id, code: user.code, name: user.name, level: 'staff', passwordHash: auth.teacherHash };
        return sessionUser;
    }

    return null;
}

async function addOrUpdateUser(code, name, level, password) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;

    const existing = (typeof users !== 'undefined' ? users : []).find(u => String(u.code).toUpperCase() === c);
    const record = existing || {
        id: 'us-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        code: c,
        name: name || c,
        level: level || 'ta',
        passwordHash: ''
    };

    if (name) record.name = name;
    if (level) record.level = level;
    if (password) record.passwordHash = await sha256(password);

    if (typeof queueChange === 'function') queueChange('user', record);
    return record;
}

function currentRole() {
    return sessionUser ? sessionUser.level : null;
}

function currentUser() {
    return sessionUser;
}

function displayNameFor(userOrRole) {
    const u = typeof userOrRole === 'object' ? userOrRole : null;
    if (u) return u.name || u.code;
    if (userOrRole === 'admin' || userOrRole === 'developer') return ADMIN_NAME;
    return getAuth().teacherName || 'Mr. Lanning';
}

function can(level) {
    const cur = currentRole();
    if (!cur) return false;
    return RANK[cur] >= RANK[level];
}

function applyRolePermissions(user) {
    const level = typeof user === 'object' ? user.level : user;

    // Tabs
    const allowed = LEVEL_TABS[level];
    document.querySelectorAll('.nav-item').forEach(item => {
        const tab = item.dataset.tab;
        if (!allowed) { item.style.display = ''; return; }
        item.style.display = allowed.includes(tab) ? '' : 'none';
    });

    // Panels: anything marked data-min-role is hidden below that level
    document.querySelectorAll('[data-min-role]').forEach(el => {
        el.style.display = RANK[level] >= RANK[el.dataset.minRole] ? '' : 'none';
    });

    // Drive link is developer-only; staff can sync but not change it
    const urlInput = document.getElementById('googleWebAppUrlInput');
    if (urlInput) {
        urlInput.disabled = level !== 'developer';
        urlInput.title = level === 'developer' ? '' : 'Read-only — only the Developer can change the Drive link';
    }

    const roleBadge = document.getElementById('roleBadge');
    if (roleBadge) roleBadge.textContent = displayNameFor(user);

    const signOut = document.getElementById('btnLogout');
    if (signOut) signOut.style.display = '';

    const devPanel = document.getElementById('devConsole');
    if (devPanel) devPanel.style.display = level === 'developer' ? '' : 'none';
}

function showWelcome(user) {
    const flash = document.getElementById('welcomeFlash');
    const text = document.getElementById('welcomeText');
    if (!flash || !text) return;

    text.textContent = `Welcome, ${displayNameFor(user)}`;
    flash.style.display = 'flex';
    flash.classList.remove('fade-out');
    void flash.offsetWidth; // restart the animation

    setTimeout(() => {
        flash.classList.add('fade-out');
        setTimeout(() => { flash.style.display = 'none'; }, 600);
    }, 1800);
}

function showSplash(ms, then) {
    const splash = document.getElementById('splashScreen');
    const app = document.getElementById('appContainer');
    const gate = document.getElementById('loginGate');
    if (!splash) { if (then) then(); return; }

    // Cover everything while the splash is up, so nothing behind it is visible.
    if (app) app.style.display = 'none';
    if (gate) gate.style.display = 'none';

    splash.style.display = 'flex';
    setTimeout(() => {
        splash.classList.add('fade-out');
        setTimeout(() => {
            splash.style.display = 'none';
            splash.classList.remove('fade-out');
            if (then) then();
        }, 500);
    }, ms);
}

function showLoginGate(onSuccess) {
    const gate = document.getElementById('loginGate');
    const app = document.getElementById('appContainer');
    const codeInput = document.getElementById('loginCode');
    const input = document.getElementById('loginPassword');
    const msg = document.getElementById('loginMessage');

    if (!gate || !app) return;

    app.style.display = 'none';
    gate.style.display = 'flex';

    const submit = async () => {
        const pw = input.value;
        if (!pw) { msg.textContent = 'Enter a password.'; return; }

        const user = await attemptLogin(codeInput ? codeInput.value : ADMIN_CODE, pw);
        if (!user) {
            msg.textContent = 'Unknown code or incorrect password.';
            input.select();
            return;
        }

        gate.style.display = 'none';
        app.style.display = '';
        applyRolePermissions(user);
        showWelcome(user);
        if (onSuccess) onSuccess(user);
    };

    document.getElementById('loginSubmit').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    if (codeInput) codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') input.focus(); });
    if (codeInput) codeInput.focus();
}

function logout() {
    sessionUser = null;
}
