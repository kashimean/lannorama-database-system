// Auth layer: splash, login gate, welcome animation, developer console.
// Runs in the renderer (browser context).
//
// ADMIN_HASH is your "set in stone" password, stored as a SHA-256 hash only.
// Generate your own:  node scripts/hash.js "your password"
// The teacher password is set from the developer console, stored hashed, and
// mirrored to the cloud Auth sheet so it syncs across devices.

const ADMIN_HASH = '9212e5e6ef4106525be27ac4fcde2db1aa65f4e706eb469cea7f0baec27dcc96'; // password: 2033
const ADMIN_NAME = 'Developer';
const DEFAULT_TEACHER_NAME = 'Mr. Lanning';

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAuth() {
    const raw = localStorage.getItem('lds_auth');
    if (!raw) return { teacherHash: null, teacherName: DEFAULT_TEACHER_NAME };
    try {
        const a = JSON.parse(raw);
        return { teacherHash: a.teacherHash || null, teacherName: a.teacherName || DEFAULT_TEACHER_NAME };
    } catch (e) {
        return { teacherHash: null, teacherName: DEFAULT_TEACHER_NAME };
    }
}

function saveAuth(auth) {
    // Only the teacher hash and display name persist. The role is session-only,
    // so the app always asks for a password on launch.
    localStorage.setItem('lds_auth', JSON.stringify({
        teacherHash: auth.teacherHash,
        teacherName: auth.teacherName || DEFAULT_TEACHER_NAME
    }));
}

let sessionRole = null;

async function attemptLogin(password) {
    const hash = await sha256(password);

    if (hash === ADMIN_HASH) {
        sessionRole = 'admin';
        return 'admin';
    }

    const auth = getAuth();
    if (auth.teacherHash && hash === auth.teacherHash) {
        sessionRole = 'teacher';
        return 'teacher';
    }

    return null;
}

async function setTeacherPassword(password, name) {
    const auth = getAuth();
    auth.teacherHash = await sha256(password);
    if (name) auth.teacherName = name;
    saveAuth(auth);
    return auth;
}

// Pull the teacher hash/name from the cloud Auth sheet (best effort).
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
    } catch (e) {
        // Offline or unreachable: keep the local hash.
    }

    return getAuth();
}

function logout() {
    sessionRole = null;
}

function currentRole() {
    return sessionRole;
}

function displayNameFor(role) {
    return role === 'admin' ? ADMIN_NAME : (getAuth().teacherName || DEFAULT_TEACHER_NAME);
}

// Teacher sees these tabs; inside Settings only panels marked data-teacher-access.
const TEACHER_TABS = ['checkout', 'active-checkouts', 'roster', 'inventory', 'settings'];

function applyRolePermissions(role) {
    document.querySelectorAll('.nav-item').forEach(item => {
        const tab = item.dataset.tab;
        if (role === 'teacher') {
            item.style.display = TEACHER_TABS.includes(tab) ? '' : 'none';
        } else {
            item.style.display = '';
        }
    });

    document.querySelectorAll('#tab-settings .panel').forEach(panel => {
        if (role === 'teacher') {
            panel.style.display = panel.dataset.teacherAccess ? '' : 'none';
        } else {
            panel.style.display = '';
        }
    });

    const devPanel = document.getElementById('devConsole');
    if (devPanel) devPanel.style.display = role === 'admin' ? '' : 'none';

    const roleBadge = document.getElementById('roleBadge');
    if (roleBadge) roleBadge.textContent = role === 'admin' ? 'Developer' : 'Teacher';

    const signOut = document.getElementById('btnLogout');
    if (signOut) signOut.style.display = '';
}

function showWelcome(role) {
    const flash = document.getElementById('welcomeFlash');
    const text = document.getElementById('welcomeText');
    if (!flash || !text) return;

    text.textContent = `Welcome, ${displayNameFor(role)}`;
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
    if (!splash) { if (then) then(); return; }

    splash.style.display = 'flex';
    setTimeout(() => {
        splash.classList.add('fade-out');
        setTimeout(() => {
            splash.style.display = 'none';
            if (then) then();
        }, 500);
    }, ms);
}

function showLoginGate(onSuccess) {
    const gate = document.getElementById('loginGate');
    const app = document.getElementById('appContainer');
    const input = document.getElementById('loginPassword');
    const msg = document.getElementById('loginMessage');

    if (!gate || !app) return;

    app.style.display = 'none';
    gate.style.display = 'flex';

    const submit = async () => {
        const pw = input.value;
        if (!pw) { msg.textContent = 'Enter a password.'; return; }

        const role = await attemptLogin(pw);
        if (!role) {
            msg.textContent = 'Incorrect password.';
            input.select();
            return;
        }

        gate.style.display = 'none';
        app.style.display = '';
        applyRolePermissions(role);
        showWelcome(role);
        if (onSuccess) onSuccess(role);
    };

    document.getElementById('loginSubmit').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    input.focus();
}
