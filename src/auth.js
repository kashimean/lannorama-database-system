// Auth layer: splash, login gate (access code + password), welcome animation,
// developer console, and role/level permissions.
//
// Levels: developer > staff = test > ta
//   developer — everything, including changing the Apps Script link
//   staff     — checkout, add equipment, roster, blacklist, settings (sync/updater,
//               but the Drive link is read-only), updater
//   ta        — checkout only
//   test      — same permissions as staff, but every change is rolled back after it is
//               confirmed on the server, so a test session cannot leave data behind.
//               Test accounts are created in the Developer Console like any other code;
//               one is never created automatically for the developer.
//
// Developer hash is hardcoded (your "set in stone" password). Staff and TA codes
// are created in the Developer Console and stored in the cloud Users sheet.
// Generate a hash:  node scripts/hash.js "your password"

const ADMIN_HASH = '9212e5e6ef4106525be27ac4fcde2db1aa65f4e706eb469cea7f0baec27dcc96'; // password: 2033
const ADMIN_CODE = 'DEV';
const ADMIN_NAME = 'Developer';

// Test sits at the staff rank so it can exercise the same features, but it is a distinct
// level: the renderer treats it as "write, verify, roll back" instead of "write and keep".
const RANK = { ta: 1, staff: 2, test: 2, developer: 3 };

// Tabs visible per level (a level sees its own tier plus everything below it).
const LEVEL_TABS = {
    ta: ['checkout'],
    staff: ['checkout', 'active-checkouts', 'roster', 'blacklist', 'inventory', 'settings'],
    test: ['checkout', 'active-checkouts', 'roster', 'blacklist', 'inventory', 'settings'],
    developer: null // null = all tabs
};

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAuth() {
    const raw = localStorage.getItem('lds_auth');
    if (!raw) return { teacherHash: null, teacherName: 'Mr. Lanning', kiosk: false };
    try {
        const a = JSON.parse(raw);
        return {
            teacherHash: a.teacherHash || null,
            teacherName: a.teacherName || 'Mr. Lanning',
            kiosk: !!a.kiosk
        };
    } catch (e) {
        return { teacherHash: null, teacherName: 'Mr. Lanning', kiosk: false };
    }
}

function saveAuth(auth) {
    // Only the display name, the legacy teacher hash and the kiosk flag persist.
    // The session user is held in memory only, so the app asks for a code +
    // password on every launch.
    localStorage.setItem('lds_auth', JSON.stringify({
        teacherHash: auth.teacherHash,
        teacherName: auth.teacherName || 'Mr. Lanning',
        kiosk: !!auth.kiosk
    }));
}

function setKioskFlag(on) {
    const auth = getAuth();
    auth.kiosk = !!on;
    saveAuth(auth);
    return auth.kiosk;
}

// Overrides (blacklist bypass, stock bypass, duplicate-checkout bypass) are
// never allowed for a TA. In kiosk mode the session is a TA, so an override
// requires a Developer or Staff code + password entered at that moment.
function canOverride() {
    const level = currentRole();
    return level === 'developer' || level === 'staff';
}

let sessionUser = null;
let loginGateBound = false;

// Pull the teacher hash/name and the access codes from the cloud (best effort).
async function loadCloudAuth() {
    const url = (typeof settings !== 'undefined' && settings) ? settings.webAppUrl : '';
    if (!url || !navigator.onLine) return getAuth();

    try {
        // A hanging fetch used to block startAuth() before the splash could
        // ever hide, so the app looked frozen. Abort instead of waiting forever.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        let res;
        try {
            res = await fetch(url, { signal: ctrl.signal });
        } finally {
            clearTimeout(timer);
        }
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

async function addOrUpdateUser(code, name, level, password, photo) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;

    const existing = (typeof users !== 'undefined' ? users : []).find(u => String(u.code).toUpperCase() === c);
    const record = existing || {
        id: 'us-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        code: c,
        name: name || c,
        level: level || 'ta',
        passwordHash: '',
        photo: ''
    };

    if (name) record.name = name;
    if (level) record.level = level;
    if (password) record.passwordHash = await sha256(password);
    // Only overwrite the photo when a value is actually given, so editing a password
    // does not wipe an existing picture.
    if (photo !== undefined && photo !== null) record.photo = String(photo).trim();

    if (typeof queueChange === 'function') queueChange('user', record);
    return record;
}

// Sheets cannot store binary images, so a user's photo is a URL. A Google Drive share link
// (…/file/d/<id>/view or ?id=<id>) is turned into the thumbnail endpoint, which renders as a
// plain image and is small enough for the welcome screen.
function avatarUrl(photo) {
    const p = String(photo || '').trim();
    if (!p) return '';
    if (/^data:image\//i.test(p)) return p;
    const m = p.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/) || p.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
    if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w200`;
    return p;
}

// Initials for the fallback when there is no photo, or the photo cannot be fetched offline.
function initialsFor(name) {
    const n = String(name || '').trim();
    if (!n) return '?';
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function currentRole() {
    return sessionUser ? sessionUser.level : null;
}

// True when the signed-in code is a test account. The renderer uses this to send a change,
// confirm it landed, then undo it - and to skip writing to local storage entirely.
function isTestSession() {
    return sessionUser && sessionUser.level === 'test';
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
    if (roleBadge) {
        // A test session must be obvious on screen - it looks like staff otherwise, and the
        // only difference is that nothing it does survives.
        roleBadge.textContent = displayNameFor(user) + (level === 'test' ? ' · TEST' : '');
    }

    const signOut = document.getElementById('btnLogout');
    if (signOut) signOut.style.display = '';

    const devPanel = document.getElementById('devConsole');
    if (devPanel) devPanel.style.display = level === 'developer' ? '' : 'none';
}

function showWelcome(user) {
    const flash = document.getElementById('welcomeFlash');
    const text = document.getElementById('welcomeText');
    const avatar = document.getElementById('welcomeAvatar');
    if (!flash || !text) return;

    text.textContent = `Welcome, ${displayNameFor(user)}`;

    if (avatar) {
        const url = avatarUrl(user && user.photo);
        if (url) {
            // Sheets cannot hold binary images, so this is a URL. If it cannot be fetched
            // (offline, or the Drive file is not shared), fall back to initials rather than
            // showing a broken image on the welcome screen.
            avatar.innerHTML = '';
            const img = document.createElement('img');
            img.className = 'welcome-avatar-img';
            img.alt = '';
            img.onerror = () => {
                avatar.innerHTML = initialsFor(user && user.name);
            };
            img.src = url;
            avatar.appendChild(img);
        } else {
            avatar.textContent = initialsFor(user && user.name);
        }
    }

    flash.style.display = 'flex';
    flash.classList.remove('fade-out');
    void flash.offsetWidth; // restart the animation
    if (typeof playSound === 'function') playSound('startup');

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
            playSound('error');
            input.select();
            return;
        }

        gate.style.display = 'none';
        app.style.display = '';
        applyRolePermissions(user);
        showWelcome(user);
        if (onSuccess) onSuccess(user);
    };

    // Bound once, so signing out and returning to the gate does not stack
    // duplicate listeners (each extra click would fire submit more than once).
    if (!loginGateBound) {
        loginGateBound = true;
        document.getElementById('loginSubmit').addEventListener('click', submit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        if (codeInput) codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') input.focus(); });
    }
    // Always start from a clean gate: sign out must not leave the previous
    // code/password typed in the boxes.
    if (codeInput) codeInput.value = '';
    input.value = '';
    if (msg) msg.textContent = '';
    if (codeInput) codeInput.focus();
}

function logout() {
    sessionUser = null;
}

// Sign out returns straight to the login gate — no splash replay, no reload.
function signOut() {
    logout();
    const splash = document.getElementById('splashScreen');
    if (splash) { splash.style.display = 'none'; splash.classList.remove('fade-out'); }
    const welcome = document.getElementById('welcomeFlash');
    if (welcome) { welcome.style.display = 'none'; welcome.classList.remove('fade-out'); }
    showLoginGate(applyRolePermissions);
}
