// Lannorama Publisher — builds + publishes only when the version is newer than the latest GitHub Release.
// Run: node scripts/publisher.js
// Requires: GH_TOKEN env var (PAT with repo scope), Node 18+ (built-in fetch).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const build = pkg.build || {};
const publish = (build.publish || [])[0] || {};

// Load .env (gitignored) so the token is not hardcoded in any committed file
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const OWNER = process.env.GH_OWNER || publish.owner;
const REPO = process.env.GH_REPO || publish.repo;
const TOKEN = process.env.GH_TOKEN;

if (!OWNER || !REPO || !TOKEN) {
  console.error('Missing config. Set GH_OWNER, GH_REPO and GH_TOKEN, or fill in build.publish in package.json.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

// Compare semver strings: returns 1 if a > b, -1 if a < b, 0 if equal
function cmp(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function createRelease(tag, body) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: false })
  });
  if (!res.ok) throw new Error(`Create release failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function uploadAsset(releaseId, filePath) {
  const name = path.basename(filePath);
  const res = await fetch(
    `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(filePath) }
  );
  if (!res.ok) throw new Error(`Upload ${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  const version = pkg.version;
  const latest = await latestRelease();
  const remoteVersion = latest ? latest.tag_name.replace(/^v/, '') : null;

  console.log(`Local version:  ${version}`);
  console.log(`Published:      ${remoteVersion || 'none yet'}`);

  if (remoteVersion && cmp(version, remoteVersion) <= 0) {
    console.log('No new version detected — nothing to publish.');
    return;
  }

  console.log('New version detected. Building...');

  // Clean dist/ so stale artifacts from a previous build are never uploaded
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(dist)) {
    for (const f of fs.readdirSync(dist)) {
      if (f === 'win-unpacked') continue;
      fs.unlinkSync(path.join(dist, f));
    }
  }

  execSync('npx electron-builder --win', { cwd: ROOT, stdio: 'inherit' });

  const files = fs.readdirSync(dist).filter(f => /\.(exe|blockmap)$/i.test(f) || /^latest\.yml$/i.test(f));

  if (files.length === 0) {
    console.error('Nothing found in dist/ — build failed.');
    process.exit(1);
  }

  const tag = `v${version}`;
  const release = await createRelease(tag, `Lannorama Database System ${version}\n\nFiles uploaded automatically by scripts/publisher.js.`);
  console.log(`Release created: ${release.html_url}`);

  for (const f of files) {
    await uploadAsset(release.id, path.join(dist, f));
    console.log(`Uploaded: ${f}`);
  }

  console.log('Done. Installed apps will pick this up on their next check.');
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
