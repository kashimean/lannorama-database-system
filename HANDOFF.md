# Handoff Notes — Lannorama Database System

Project: `C:/Users/Colton/equipment-tracker`

## Verified state (checked, not assumed)
- Git: branch `main`, HEAD `62b85b0`, remote `https://github.com/kashimean/lannorama-database-system.git`, in sync (0 ahead / 0 behind), clean tree.
- Token: classic PAT in `.env` (gitignored, confirmed not in any tracked file). Fine-grained token could NOT create releases (403); classic can.
- Releases: **`v1.0.5` is latest** and confirmed live — Atom feed 200, `latest.yml` resolves 200 with `version: 1.0.5`, size 77,695,351, sha512 matching the local `dist` build. Assets: `Lannorama-Database-System-Setup-1.0.5.exe`, `.exe.blockmap` (82,049), `latest.yml` (378).
- Root cause of the updater error: `latest.yml` was missing from the v1.0.1 release assets (stale 1.0.0 files were uploaded because `dist/` was not cleaned). Fixed by uploading the missing assets, deleting stale ones, and making `scripts/publisher.js` clean `dist/` before building.
- Updater reads **release assets via the Atom feed**, never repo files — adding `latest.yml` to git does nothing.
- `win.signAndEditExecutable: false` in package.json is required here: electron-builder's winCodeSign cache extraction fails on this machine because symlink creation needs admin/Developer Mode. Consequence: icon is not embedded in the app EXE (installer/shortcuts still use `buildResources/icon.ico`).
- Icon: the user's Google Drive logo (file id `1gX7oSjT1ujpztiq-XVYPtoSLGrjM25h6`, 300x300 RGBA PNG) is now the app icon.
  - `buildResources/icon.png` = source, `buildResources/icon.ico` = generated 370,070 bytes with sizes 16/32/48/64/128/256.
  - `scripts/build-icon-from-png.js` regenerates the ICO from the PNG with no external deps (built-in zlib PNG decoder + area-average resize). It replaces the old `scripts/generate-icon.js` camera-glyph generator.
  - In-app logo: `src/assets/icon.png` (packaged via `src/**`), used on the splash (`#splashScreen`), login card, and header brand, plus `<link rel="icon">`.
  - `src/main.js` sets `icon: path.join(__dirname, 'assets', 'icon.png')` for the running window.
  - Caveat: because `win.signAndEditExecutable` is false, the `.exe` file itself still shows the default Electron icon in Explorer; installer/shortcuts use `buildResources/icon.ico`.
- Google Sheets sync confirmed working by user. Offline-first queue: `queueChange` → `flushQueue` → `verifyQueue` (queue clears only when changes are confirmed present in the sheet). Sync Activity Log + Verify button.
- Apps Script must be redeployed as a NEW version for the `/exec` URL to change.

- **Real bug fixed (commit `03a8329`):** the app froze on the loading screen. `setReturnDateDays(1)` runs at load time and touches `miniCalendar`, but `const miniCalendar` was declared ~20 lines later → `Uncaught ReferenceError: Cannot access 'miniCalendar' before initialization` (temporal dead zone). The renderer aborted before `startAuth()`, so the splash (visible by default in CSS) never hid. Moved the `miniCalendar`/`weekendHint`/`calendarMonth` declarations above the date presets. Verified fixed with `npx electron . --enable-logging=stderr` — no console errors.
- Second fix in the same commit: `initUpdater()` returned early in dev mode before registering `ipcMain.handle('updater:state')`, so the renderer's `getUpdaterState()` rejected with "No handler registered". Handlers are now registered before the `isPackaged` check and `updater:check` returns null in dev mode.
- Debug method that found it: `npx electron . --enable-logging=stderr` prints renderer console errors to stdout — use this whenever the UI hangs.
- `apps-script.gs` is the copy-paste Apps Script code (same as `APPS_SCRIPT_TEMPLATE`), committed for convenience.

## Auth / lock mode (just added)
- `src/auth.js` (browser script, loaded before renderer.js in index.html).
- Admin password **2033**, hardcoded as SHA-256 hash in `ADMIN_HASH`:
  `9212e5e6ef4106525be27ac4fcde2db1aa65f4e706eb469cea7f0baec27dcc96`
  Regenerate with `node scripts/hash.js "password"`.
- Teacher password: set only from the Developer Console, stored hashed in `localStorage` key `lds_auth`, and **mirrored to the cloud `Auth` sheet** so it syncs across devices.
- Role is **session-only** (in-memory). Only the teacher hash/name persist, so the app asks for a password on every launch.
- `loadCloudAuth()` runs before the login gate: pulls the teacher hash from the cloud `Auth` sheet, falls back to local if offline/unreachable.
- Splash screen `#splashScreen` shows for 1.8s on launch, then fades into the login gate.
- Welcome animation `#welcomeFlash` after login: "Welcome, Developer" / "Welcome, Mr. Lanning". Display name comes from `teacherName` (settable in the Developer Console), admin name is fixed as `Developer`.
- Update popup `#updatePopup` appears on launch when the updater reports `available` (fires once per session), with Download / Later buttons.
- Login gate `#loginGate` hides `#appContainer` until a password is accepted.
- Roles: `admin` (all tabs + Developer Console), `teacher` (checkout, active checkouts, roster, inventory, and Settings limited to the Auto-Updater panel only).
- `applyRolePermissions(role)` hides nav items and the dev panel; `#roleBadge` shows Developer/Teacher.
- Developer Console panel `#devConsole` in Settings tab: set teacher password and display name, admin-only.
- Sign Out button `#btnLogout` is in the header and shows for both roles.
- Settings panels are gated by `data-teacher-access="1"`; only the Auto-Updater panel has it, so a teacher sees just that panel inside Settings.
- Apps Script template now includes `Auth` (`id,key,value`), `Users` (`id,code,name,level,passwordHash`) and `Blacklist` (`id,studentName,reason,addedBy,addedDate,active`) sheets; `sheetForAction` maps `auth`, `user`/`delete_user`, `blacklist`/`delete_blacklist`, and `doGet` returns `users` + `blacklist`. **The user must redeploy the Apps Script as a NEW version** for these to work — the `/exec` URL serves the snapshot at deploy time, so editing the code alone does nothing. `verifyQueue`'s `sheetFor` has branches for all of them. `getOrCreateSheet` auto-creates missing tabs, so the tabs themselves are not the blocker.
- Hardcoded default Apps Script URL in `src/renderer.js` line 159 (`DEFAULT_APPS_SCRIPT_URL`):
  `https://script.google.com/macros/s/AKfycbwafWSa7a8TZMU3vihFUHEuyeEjfVIVUUYRv-doKix8wCymq5oNTWN77dxpoKVP70aL/exec`
  It is applied when saved settings have no URL, so existing installs keep their own value.
- **49ers theme** in `src/style.css` `:root`: `--primary #c6011f` (scarlet), `--accent`/`--warning`/`--border-focus` `#cfb154` (gold), dark warm base `--bg-dark #1a0a0c`, `--bg-card #2a1114`, `--border-color #4a2226`.
- Splash is now fully opaque (`background: #1a0a0c` + radial scarlet glow) and `showSplash()` hides `#appContainer` and `#loginGate` while it is up, so nothing behind it is visible.
- Real bug fixed: `.login-gate` used `var(--bg-main)`, which does not exist in `:root` (renders transparent, app shows through). Changed to `var(--bg-dark)`.
- `src/main.js`: launches **maximized** (`win.maximize()`), NOT fullscreen — title bar and taskbar remain visible. `backgroundColor` is `#1a0a0c`. Menu bar hidden via `setMenuBarVisibility(false)`. (Earlier fullscreen behavior was removed at the user's request.)
- Build output for testing (NOT published): `dist/Lannorama-Database-System-Setup-1.0.4.exe` + blockmap + `win-unpacked`. Verified in `app.asar`: fullscreen, setFullScreen, c6011f, cfb154, and the Apps Script URL are all present. Latest GitHub release is still `v1.0.3`, so the update popup cannot fire from this local build.
- Caveat to tell the user: a client-side gate in a local app is not real security — anyone with the machine can inspect the code/localStorage. It stops casual use, not a determined user. The cloud-synced teacher hash is for convenience across devices, not security.

## Blacklist, Due Today, weekend skip, access codes (added after v1.0.4 was published — NOT in a release yet)
- **Blacklist**: new cloud `Blacklist` sheet. Staff/Developer can add a student with a reason (`addBlacklistEntry`), lift or re-apply an entry, and delete it. Checkout is blocked for blacklisted students (`isBlacklisted` guard in the checkout submit handler). Optional `settings.autoBlacklistOverdue` flag auto-creates an entry when a student has an overdue item (`applyAutoBlacklist()` runs inside `renderStats()`). New nav tab `data-tab="blacklist"` (`#tab-blacklist`, `data-min-role="staff"`), `#blacklistTableBody`, `#searchBlacklistInput`, `#btnAddBlacklist`, `#autoBlacklistOverdue`, home-page stat card `#statBlacklisted`. Roster rows show a `badge-blacklist` pill.
- **Mini calendar**: `#miniCalendar` is a small click-to-pick month grid under `#returnDateInput` (weekends shaded, today outlined, selected filled, prev/next month nav). `settings.skipWeekends` (default true, `#skipWeekends` checkbox) controls whether a weekend pick is pushed to Monday. `#weekendHint` explains when a date was moved.
- **Weekend skip**: `nextBusinessDay()` — Friday + 1 day lands on Monday, Sat/Sun push to Monday. Date presets (`setReturnDateDays`) now use it, so "Tomorrow" on a Friday resolves to Monday. `localDateStr()` is used for all date-sensitive comparisons because `toISOString()` can shift a day by timezone.
- **Due Today**: `checkoutStatus(c)` returns `due_today` when `returnDate === today`, `active` when in the future, `overdue` only when today is past the due date. New home-page stat card `#statDueToday` and `badge-due-today` pill in Active Checkouts.
- **Access codes + levels**: `RANK = { ta: 1, staff: 2, developer: 3 }`. Login gate now takes an access code (`#loginCode`) + password. Developer code `DEV` uses the hardcoded `ADMIN_HASH` (password 2033). Staff/TA codes are created in the Developer Console (`#userCodeInput`, `#userNameInput`, `#userLevelSelect`, `#userPasswordInput`, `#btnSaveUser`, `#userTableBody`) and stored in the cloud `Users` sheet as SHA-256 hashes. `LEVEL_TABS`: TA = checkout only; Staff = checkout, active checkouts, roster, blacklist, inventory, settings; Developer = all tabs. Panels are gated with `data-min-role`. The Drive link input `#googleWebAppUrlInput` is disabled for non-developers (staff can sync but not change the link). `applyRolePermissions(user)` + `can(level)` in `src/auth.js`; `sessionUser` is in-memory only so the code+password is required on every launch. `#roleBadge` shows the user's display name.
- `loadCloudAuth()` now also pulls the `Users` sheet before the login gate. `saveData()` persists `media_tracker_users` and `media_tracker_blacklist`; the JSON export includes both.
- All four JS files pass `node --check`. Every new id referenced by renderer.js exists in index.html (verified by count). Build rebuilt into `dist` and the features are present in `app.asar` — but nothing here has been exercised visually in Electron.

## Next steps
1. **The user must redeploy the Apps Script as a NEW version** (Deploy → Manage deployments → pencil → New version, Access must stay **Anyone**) or the `Auth`/`Users`/`Blacklist` sheets do nothing — the `/exec` URL serves the snapshot from deploy time. Verify by opening the `/exec` URL in a browser and confirming the JSON contains `auth`, `users`, `blacklist` keys.
2. Test the login gate (code + password), splash, welcome animation, update popup, mini calendar, Due Today card, blacklist tab, and level gating in the app. The app is confirmed to start and run (renderer no longer throws); the UI has not been exercised end-to-end visually in Electron yet. Theme, maximized launch, opaque splash, and icon are verified by inspecting the built `app.asar`, not visually.
3. Kiosk mode was dropped by the user ("don't worry about kiosk mode").
4. Publishing flow: `npm version patch --no-git-tag-version` → commit/push → `node scripts/publisher.js`. Latest release is `v1.0.5`; the next publish needs `1.0.6`.
