// Auth layer: login gate + developer console. Runs in the renderer (browser context).
//
// ADMIN_HASH is your "set in stone" password, stored as a SHA-256 hash only.
// Generate your own:  node scripts/hash.js "your password"
// The teacher password is set from the developer console and stored hashed.

const ADMIN_HASH = '9212e5e6ef4106525be27ac4fcde2db1aa65f4e706eb469cea7f0baec27dcc96'; // password: 2033

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getAuth() {
    const raw = localStorage.getItem('lds_auth');
    if (!raw) return { role: null, teacherHash: null };
    try { return JSON.parse(raw); } catch (e) { return { role: null, teacherHash: null }; }
}

function saveAuth(auth) {
    localStorage.setItem('lds_auth', JSON.stringify(auth));
}

async function attemptLogin(password) {
    const hash = await sha256(password);

    if (hash === ADMIN_HASH) {
        saveAuth({ role: 'admin', teacherHash: getAuth().teacherHash });
        return 'admin';
    }

    const auth = getAuth();
    if (auth.teacherHash && hash === auth.teacherHash) {
        saveAuth({ role: 'teacher', teacherHash: auth.teacherHash });
        return 'teacher';
    }

    return null;
}

async function setTeacherPassword(password) {
    const auth = getAuth();
    auth.teacherHash = await sha256(password);
    saveAuth(auth);
    return auth.teacherHash;
}

function logout() {
    const auth = getAuth();
    saveAuth({ role: null, teacherHash: auth.teacherHash });
}

function currentRole() {
    return getAuth().role;
}

// Permissions: teacher gets the checkout/roster/inventory tabs only.
const TEACHER_TABS = ['checkout', 'active-checkouts', 'roster'];

function applyRolePermissions(role) {
    document.querySelectorAll('.nav-item').forEach(item => {
        const tab = item.dataset.tab;
        if (role === 'teacher') {
            item.style.display = TEACHER_TABS.includes(tab) ? '' : 'none';
        } else {
            item.style.display = '';
        }
    });

    const devPanel = document.getElementById('devConsole');
    if (devPanel) devPanel.style.display = role === 'admin' ? '' : 'none';

    const roleBadge = document.getElementById('roleBadge');
    if (roleBadge) roleBadge.textContent = role === 'admin' ? 'Developer' : 'Teacher';
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
        if (onSuccess) onSuccess(role);
    };

    document.getElementById('loginSubmit').addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    input.focus();
}
