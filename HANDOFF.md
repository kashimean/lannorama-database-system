# Handoff Notes — Lannorama Database System

Project: `C:/Users/Colton/equipment-tracker`

## Verified state (checked, not assumed)
- Git: branch `main`, HEAD `6f4e4ef`, remote `https://github.com/kashimean/lannorama-database-system.git`, in sync (0 ahead / 0 behind), clean tree.
- Token: classic PAT in `.env` (gitignored, confirmed not in any tracked file). Fine-grained token could NOT create releases (403); classic can.
- Releases: `v1.0.1` is latest. Assets: `Lannorama-Database-System-Setup-1.0.1.exe`, `.exe.blockmap`, `latest.yml`. Verified `latest.yml` fetches 200.
- Root cause of the updater error: `latest.yml` was missing from the v1.0.1 release assets (stale 1.0.0 files were uploaded because `dist/` was not cleaned). Fixed by uploading the missing assets, deleting stale ones, and making `scripts/publisher.js` clean `dist/` before building.
- Updater reads **release assets via the Atom feed**, never repo files — adding `latest.yml` to git does nothing.
- `win.signAndEditExecutable: false` in package.json is required here: electron-builder's winCodeSign cache extraction fails on this machine because symlink creation needs admin/Developer Mode. Consequence: icon is not embedded in the app EXE (installer/shortcuts still use `buildResources/icon.ico`).
- Icon: `scripts/generate-icon.js` → `buildResources/icon.ico` (302,430 bytes).
- Google Sheets sync confirmed working by user. Offline-first queue: `queueChange` → `flushQueue` → `verifyQueue` (queue clears only when changes are confirmed present in the sheet). Sync Activity Log + Verify button.
- Apps Script must be redeployed as a NEW version for the `/exec` URL to change.

## Auth / lock mode (just added)
- `src/auth.js` (browser script, loaded before renderer.js in index.html).
- Admin password **2033**, hardcoded as SHA-256 hash in `ADMIN_HASH`:
  `9212e5e6ef4106525be27ac4fcde2db1aa65f4e706eb469cea7f0baec27dcc96`
  Regenerate with `node scripts/hash.js "password"`.
- Teacher password: set only from the Developer Console, stored hashed in `localStorage` key `lds_auth`.
- Role is **session-only** (in-memory). Only the teacher hash persists, so the app asks for a password on every launch.
- Login gate `#loginGate` hides `#appContainer` until a password is accepted.
- Roles: `admin` (all tabs + Developer Console), `teacher` (checkout, active checkouts, roster only; Settings/Developer Console hidden).
- `applyRolePermissions(role)` hides nav items and the dev panel; `#roleBadge` shows Developer/Teacher.
- Developer Console panel `#devConsole` in Settings tab: set teacher password, Lock & Sign Out.
- Caveat to tell the user: a client-side gate in a local app is not real security — anyone with the machine can inspect the code/localStorage. It stops casual use, not a determined user.

## Next steps
1. Test the login gate in the app (browser or `npm start`). Logic is runtime-tested via a stubbed DOM (all assertions pass); the UI itself has not been exercised in Electron yet.
2. Consider persisting `lds_auth` through the cloud so the teacher password syncs across machines.
3. Kiosk mode was dropped by the user ("don't worry about kiosk mode").
4. Publishing flow: `npm version patch --no-git-tag-version` → commit/push → `node scripts/publisher.js`.
