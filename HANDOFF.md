# Handoff Notes — Lannorama Database System

Project: `C:/Users/Colton/equipment-tracker`

## Verified state (checked, not assumed)
- Git: branch `main`, HEAD `433973e`, remote `https://github.com/kashimean/lannorama-database-system.git`, in sync (0 ahead / 0 behind), clean tree.
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

## Kiosk mode, blank class period, imported-row ids (commit `f9fa1f5` — NOT in a release yet)
- **Kiosk mode** (`src/main.js`, `src/preload.js`, `src/renderer.js`, `src/auth.js`, `src/style.css`):
  - Kiosk state lives in the **main process** so the renderer cannot escape it: `ipcMain.handle('kiosk:get')` / `('kiosk:set')`, `leave-full-screen` re-forces fullscreen while active, and `close` is vetoed while active (turn kiosk off first). Right-click menu is suppressed.
  - Kiosk flag persists in `localStorage` `lds_auth.kiosk`, so a tablet boots straight into the locked view with **no login gate** — `startAuth()` returns early and applies the kiosk session.
  - Kiosk session is a pseudo-user `{ code: 'KIOSK', level: 'ta' }` → checkout tab only. `body.kiosk` CSS makes it touch-first (56px min-height inputs/buttons, 44px calendar cells, larger fonts) and hides every tab except checkout.
  - **Overrides are refused in kiosk** unless a Developer or Staff code + password is entered at that moment (`requestOverride()` → `#modalOverride` → `confirmOverride()` → `canOverride()` requires `RANK >= staff`). Covered: blacklist bypass, stock-limit bypass, and the new duplicate-checkout guard (`existing` active checkouts for the same student blocks checkout).
  - Exiting kiosk requires the same authorization (`#btnExitKiosk` → override modal → `toggleKiosk(false)` then restores the authenticated user's role). Enable button: `#btnEnableKiosk` in a developer-only Settings panel.
  - Header additions: `#kioskTag`, `#btnExitKiosk` (Sign Out is hidden while kiosk is active).
- **Blank class period**: `normalizeRow` no longer defaults a student to "Beginning Digital Media" — an imported roster row with no period stays `''`. The autocomplete only fills the select when the student actually has a period (otherwise it clears it). Checkout no longer requires a class value. Roster shows `—` when blank.
- **Class period change after checkout writes back**: Active Checkouts now renders a `<select class="class-edit">` per row; changing it updates the checkout record AND the matching student record, and queues both (`updateCheckoutClass`).
- **Hand-imported sheet rows get system-style ids**: `normalizeRow` previously made `st-cloud-<idx>` style ids. Now `systemId(kind)` produces the normal shape (`st-`, `eq-`, `co-`, `us-`, `bl-` + timestamp, with a counter suffix when several are generated in one pass).
- **Duplicate-row sync loop fixed (commit `5a18a6d`)** — the user-reported bug where syncing created 4-5 copies of students/equipment. Root cause chain: (1) hand-pasted rows have no `id`, so `mapCloudRows` queued a full-record change; (2) `upsert` matches on column A, and when the sheet header is not exactly `id` the record id is empty, so a NEW system id was generated on every sync and `upsert` appended a new row each time; (3) `verifyQueue` compared `r.id`, which was `undefined` when the header differed, so the change was never confirmed and re-flushed forever. Fixes: `mapCloudRows` queues an `assign_id` action that writes the id **into the existing row** (never appends); `queueChange` dedupes identical type+data already in the queue; `dedupeByName()` removes rows sharing a name with an earlier row (first occurrence kept) for Students and Equipment; `verifyQueue` handles `assign_id` (id must be present) and deletes by name fallback. Apps Script side (`apps-script.gs`, verified byte-identical to `APPS_SCRIPT_TEMPLATE`): `HEADER_ALIASES` + `normalizeHeader()` normalize pasted headers (`Student ID`→`id`, `Class`→`classType`, `Student Name`→`studentName`), `upsert` repairs the header row on write, `assignId()` writes an id into a blank-id row, `removeRow` accepts a record with name fallback, `sheetForAction(a)` takes the whole action so `assign_id` can read `a.data.sheet`. **Must be redeployed as a NEW version.** Existing duplicates are cleaned by `dedupeByName` on the next sync.
- **Kiosk checkout was impossible (fixed)** — `body.kiosk .panel:not(.kiosk-allowed)` hid every panel, but no panel in `index.html` carried `kiosk-allowed`, so the checkout form itself was hidden. The checkout form panel is now `panel kiosk-allowed`. Also removed `required` from `#classTypeSelect` (label now "Class Period / Group (optional)") so students with a blank period can still check out, and the blacklist override callback now captures `pendingCheckoutData` in a closure — previously the override ran after the handler had already returned, so it used stale/null data. Stats bar is hidden in kiosk via `body.kiosk .stats-grid { display: none !important; }` per the user's request (Total Students, Total Gear Types, Blacklisted, etc.).
- Verified: all four JS files pass `node --check`, every new id exists in index.html, and `npx electron . --enable-logging=stderr` shows no console errors (only the standard CSP dev warning). Kiosk/override behavior has not been exercised visually.
- **Splash freeze fixed (commit `cb72b8c`)** — the user could not get past the splash screen. Cause: the startup duplicate-name dedupe ran before `pendingQueue` and the DOM consts (`statActive`) were initialized, so `queueChange` → `flushQueue` → `renderStats` threw `ReferenceError: Cannot access 'statActive' before initialization`, aborting module load before `startAuth()`. The dedupe function is defined at the top but now executes at boot after all state/DOM consts exist. Also: `loadCloudAuth()` got a 4s AbortController timeout and `startAuth()` races it with 5s so a hanging fetch cannot hold the splash open. Sign out no longer replays the splash (`signOut()` hides splash and shows the login gate directly; previously `logout()` + `location.reload()`), and login-gate listeners are guarded by `loginGateBound` so they no longer stack.
- **Sync error wording corrected (commit `92947d4`)** — the "Most likely cause is a different version" line the user saw was NOT the auto-updater; it is the Sync Activity Log line in `verifyQueue` (renderer.js ~line 663), printed whenever queued changes cannot be confirmed. It now only prints when the endpoint returns valid JSON but changes are genuinely missing. New `readJsonResponse()` detects an HTML response and reports the real cause (deployment Access not "Anyone", or the `/edit` URL instead of `/exec`). Added a **🧹 Clear Queue** button (`#btnClearQueue`) for entries that can never be confirmed (rows already deleted, names no longer present) — they would otherwise sit in the queue forever re-showing the error.
- **`delete_auth` bug fixed (commit `89a27a6`)** — `sheetForAction()` mapped `auth` to the Auth sheet but not `delete_auth`, so Auth deletes were silently skipped (`doPost` resolves the sheet name before checking `type.indexOf('delete')`). Now `auth || delete_auth` → Auth.
- **`upsert` column-order bug fixed (commit `433973e`)** — `upsert` wrote values positionally assuming canonical header order, which corrupts data on sheets whose columns are arranged differently (e.g. name before id). It now writes by the actual column position of each canonical header (`colOf`), and matches rows on the id column position rather than hardcoded column A.
- **Explicit duplicate-name sweep for Students + Equipment (commit `433973e`)** — `#btnCleanDupes` in Settings runs `dedupeByName` on both, re-renders roster/inventory/stats, logs what was removed, and flushes the queued deletes. `dedupeByName` keeps the first occurrence of each name (case-insensitive, trimmed) and queues the rest as `delete_student` / `delete_equipment`. It also runs at boot on local data and on every cloud sync.
- **Live endpoint verified by direct probe (not assumed)**: GET returns `200 application/json` with all six keys — `equipment(25)`, `students(59)`, `checkouts(9)`, `auth(0)`, `users(2)`, `blacklist(0)`; zero blank ids in every sheet; zero duplicate names in equipment or students. A probe student row was written and then deleted successfully, proving the student write+delete path works end-to-end. The Auth probe row I created (`id=__probe__`) is gone — the user removed it. Note: curl POSTs to `/exec` return `411 Length Required` when following the redirect (curl drops the body on redirect); posting directly to the `/exec` URL works (302, write lands).
- Local storage inspected at `%APPDATA%/lannorama-database-system/Local Storage/leveldb` — persisted queue was empty, so nothing was stuck.

## Next steps
1. **The user must redeploy the Apps Script as a NEW version** (Deploy → Manage deployments → pencil → New version, Access must stay **Anyone**) or the `Auth`/`Users`/`Blacklist` sheets do nothing — the `/exec` URL serves the snapshot from deploy time. Verify by opening the `/exec` URL in a browser and confirming the JSON contains `auth`, `users`, `blacklist` keys.
2. Test the login gate (code + password), splash, welcome animation, update popup, mini calendar, Due Today card, blacklist tab, and level gating in the app. The app is confirmed to start and run (renderer no longer throws); the UI has not been exercised end-to-end visually in Electron yet. Theme, maximized launch, opaque splash, and icon are verified by inspecting the built `app.asar`, not visually.
3. Kiosk mode was dropped by the user ("don't worry about kiosk mode").
4. Publishing flow: `npm version patch --no-git-tag-version` → commit/push → `node scripts/publisher.js`. Latest release is `v1.0.8`.

## Session findings (v1.0.7 + v1.0.8)

### Updater root cause (fixed, commit `69f1b7d`)
`src/updater.js` registered `ipcMain.handle('updater:state')` **twice**. Electron throws on duplicate
handler registration (`Attempted to register a second handler for 'updater:state'`). The throw happened
*AFTER* `updater:check`/`download`/`install` were registered but *BEFORE* the launch `checkForUpdates()`,
which is exactly why manual "Check for update" worked while the updater stayed `idle` on launch.
Verified the throw empirically. Duplicate removed; launch check + 12h interval now run.
Also added a **Install & Restart** button (`#popupInstall`) to the update popup, shown only when
`status === 'downloaded'`, wired to `installUpdate()` — previously the popup could only download.

### Admin: build-time vs runtime (decision: option 2)
`win.signAndEditExecutable` is a **build-time** option only. The app runs fine on non-admin school
hardware: `nsis.perMachine: false` installs per-user to `%LOCALAPPDATA%\Programs\...` (confirmed by the
actual install path), and nothing in `src/main.js` or `src/updater.js` requires elevation. The admin
requirement was only electron-builder's `winCodeSign` archive containing symlinks. Kept `true` because
the build runs on Colton's machine as admin. Alternative if a build machine lacks admin: enable Windows
Developer Mode (permits symlink creation without admin); the winCodeSign cache is already extracted.

### Icon verified embedded (measured, not assumed)
Compared rendered 32x32 icon SHA-256 of the built EXE against `buildResources/icon.ico`:
- `signAndEditExecutable: true` → EXE icon `796525DCC980BCFA` = matches icon.ico ✅
- `signAndEditExecutable: false` → EXE icon `FDDEE66732049016` = default Electron logo ❌
Windows reads the taskbar icon from the EXE/AppUserModelID, not from Electron's runtime `BrowserWindow`
`icon` option, so there is no way to get the taskbar icon without this flag.

### Installer graphics (verified embedded)
`scripts/build-installer-bitmaps.js` generates 24-bit BMPs with a built-in 5x7 bitmap font (no image
library available). Correct NSIS sizes: header **164x57**, sidebar **164x314** (MUI_HEADERIMAGE_BITMAP /
MUI_WELCOMEFINISHPAGE_BITMAP) — these apply only to the assisted installer (`oneClick: false`).
Paths in `package.json` must be relative to `buildResources` (e.g. `installerSidebar.bmp`), NOT
`buildResources/installerSidebar.bmp` — the latter resolves to `buildResources/buildResources/...` and
silently falls back to NSIS's default bitmap.
Proof of embedding: an incompressible noise BMP of the same dimensions grew the installer by 150,483
bytes (≈ its 154,582-byte size). The themed gradient BMPs only showed an 88-byte delta because smooth
gradients deflate extremely well — they ARE embedded.

### Other changes in v1.0.7
- All user-facing "Google Sheets" wording changed to "server" (status badge, toasts, sync log, Settings
  panel). The developer-only setup instructions panel still names Google explicitly (left as-is, only
  the Developer role sees it).
- 49ers theme: header and sidebar were still slate-blue (`#1e293b`, `#0f172a`) → scarlet/dark gradients;
  nav active pill now scarlet with red glow.
- Splash: animated 49ers gradient (black → scarlet → gold → black, 14s loop) + glass card + pulsing logo.
- Login gate: same animated gradient, frosted card, gold border, accent bar, glowing logo.
- Web Audio sound cues `playSound('success'|'notice'|'error'|'override')` (synthesized, no asset files),
  hooked into toasts, offline notice, stock override; On/Off toggle added to Settings (`#soundToggle`,
  `settings.soundMuted`).
- Network-disconnect notice modal `#modalNetwork` with the user's exact wording, shown on `offline`,
  cleared on `online`.

### Live releases
- `v1.0.7` and `v1.0.8` published to https://github.com/kashimean/lannorama-database-system/releases
  with exe + blockmap + latest.yml. `publisher.js` hit transient `fetch failed` errors; publishing the
  already-built `dist/` artifacts with retry succeeded. Next publish needs `1.0.9`.


## v1.0.10 work (uncommitted release, commits a84ab02 + fcaa0e5)

### Dropdown / search results were unreadable
Chromium draws `<select>` option popups on the OS white background, so the white theme text was
invisible. `select option` is now dark (`#2a1114`) with the checked option scarlet.

The native `<datalist>` popup cannot be styled at all in Chromium, so the student-name autocomplete
was replaced with an in-app panel (`#studentSuggestions`, `.autocomplete-list`) rendered in the
49ers red/gold palette. Blacklisted students are flagged inside the suggestion list.

### Blacklist override no longer auto-overrides
A Staff/Developer session previously skipped the prompt and completed the checkout silently. It now
warns first (`showToast` + `playSound('error')`), then requires an explicit `confirmDialog`
("Blacklist Override") before proceeding. Cancel shows "Override cancelled — checkout not completed."

### Logs system
Logs ARE the Checkouts sheet — already stored in the database, no duplicate table. New Staff+ tab
(`#tab-logs`) shows Student Name, Equipment Type, Equipment Number, Checkout Date, Return Date, Status.

- `renderLogsTable()` — searchable via `#searchLogInput`
- `buildPrintableLogs()` + `@media print` — prints plain black on white only (`#printArea`), the app
  itself is hidden. Landscape, `@page { margin: 15mm }`.
- `purgeLogs('all')` and `purgeLogs('lastMonth')` — in-app confirm, each row queued as
  `delete_checkout` so the purge syncs to the server.
- Printing goes through `ipcMain.handle('print:logs')` → `webContents.print()`. `window.print()` in the
  renderer opens a print preview that is not available in a packaged app, so the IPC path is used with
  `window.print()` only as a dev fallback.
- Equipment Number: new `number` field on equipment records (`#equipNumberInput` in the inventory
  modal). The checkout snapshots it at checkout time so the log keeps it even if inventory is edited
  or deleted later.

### Class type is now the checkout's own
The class recorded on a checkout is authoritative for that checkout. The form falls back to the
student's roster class only when the class select is left blank, and the roster is only filled in when
the student has no class yet — a single checkout never overwrites a student's existing class.

### Apps Script regenerated from scratch (`apps-script.gs`)
Real bug fixed: `sheetForAction` had no mapping for `delete_checkout`, so "Purge logs" was a silent
no-op on the server. The rewrite adds:
- `ACTION_SHEET` map covering every action type including all `delete_*`
- `LockService.getScriptLock()` so two machines cannot interleave writes
- `headerRow()` / `columnMap()` writing by the sheet's ACTUAL column position
- `getOrCreateSheet()` repairs missing canonical columns on older sheets (e.g. `equipmentNumber`)
- `setupSheets()` — creates missing sheets and repairs headers, never deletes data
- `doGet` supports `?action=ping`, `?action=setup`, and `?sheet=Checkouts`
- `doPost` returns `applied` and `skipped` with reasons for debugging
The Settings panel template (`APPS_SCRIPT_TEMPLATE`) is now generated from this same file.

**Still required:** redeploy the Apps Script as a NEW version (Access must stay Anyone).

## Live probe — why checkout/student edits still error (v1.0.11)

Probed the deployed /exec endpoint directly:

```
students:  59 rows, 0 with a class value
checkouts: 20 rows, 0 with studentName or checkoutDate
POST probe -> {"status":"success","applied":1,"skipped":[]}   (write path is healthy)
```

A checkout probe with a unique marker in every field read back as:

```
{"id":"probe-2","studentName":"","classType":"","equipmentId":"","equipmentName":"",
 "accessories":"A6","checkoutDate":"","returnDate":"","status":"S9","equipmentNumber":""}
```

Only `id`, `accessories`, `status` survived — every field that needs an alias mapping came
back blank. That is the header-normalization gap: the sheet headers are the no-space lowercase
variants (`studentname`, `classtype`, `equipmentid`, `checkoutdate`, `returndate`,
`equipmentnumber`), which were not in `HEADER_ALIASES`, so `columnMap()` falls back to assumed
canonical order and writes land in the wrong columns.

Simulated the FIXED script against exactly those headers — all 10 fields round-trip correctly.
So the fix is confirmed; the deployed version is simply older than the code in Settings.

**Action required:** redeploy the Apps Script as a NEW version with the code now shown in Settings
(v1.0.11), then click Verify. `?action=headers` reports the raw vs canonical header row per sheet
so any remaining mismatch is named explicitly.

Existing blank cells in the sheet are not retroactively filled — the fix makes reads/writes align
going forward.

## Second root cause: duplicate header columns (the reason errors continued after redeploy)

Live `?action=headers` against the deployed endpoint showed the header rows are polluted:

```
Students raw:   ["id","name","classType","classType", ... x48]
Checkouts raw:  canonical 10, then repeated blocks of studentName..returnDate
Blacklist raw:  canonical 6, then repeated blocks of studentName,addedBy,addedDate
```

Mechanism: `getOrCreateSheet()` appends any canonical column the header row does not contain.
Before the alias fix, a header spelled `studentname` never matched the canonical key `studentName`,
so **every read appended another copy**. Those duplicate columns are blank, and `readSheet()`
iterated all columns, so a blank duplicate overwrote the real value — every field that needs an
alias mapping read back empty. That is exactly the observed symptom.

Fixes:
- `readSheet()` keeps the first column per key and never lets a blank duplicate clobber a value.
- `fillRow()` builds a full-width row instead of a sparse array (sparse arrays can throw or blank cells).
- `?action=repair` clears duplicate header columns only when the column has no data below it.
- `?action=headers` now also reports `duplicates`.

Simulated against the real polluted Checkouts header row: old logic loses every aliased field,
new logic keeps all of them.

## Date cells: ISO timestamps broke "due today" / "overdue" (v1.0.14)

Live read showed every date field as a full ISO timestamp:

```
{"id":"co-1793594332708","checkoutDate":"2026-11-02T08:00:00.000Z",
 "returnDate":"2026-11-02T08:00:00.000Z","status":"active"}
```

Apps Script `getValues()` returns Date objects, and JSON serializes them as ISO timestamps.
`checkoutStatus()` compared that string against a plain `YYYY-MM-DD`, so `c.returnDate === t`
never matched — every checkout due today was classified as merely `active`. Overdue still worked
by luck (string compare), and Logs printed the whole timestamp.

Fixes:
- `readSheet()` flattens Date cells to `yyyy-MM-dd` using the spreadsheet timezone
  (`Utilities.formatDate(v, ss.getTimeZone(), "yyyy-MM-dd")`), so existing records read cleanly.
- `toDateStr()` in the app normalizes any date-like value (Date object, ISO timestamp, plain
  string) to `YYYY-MM-DD` in local time, applied to checkoutDate, returnDate and addedDate.
- `checkoutStatus()` compares normalized dates.
- `formatDateStr()` now uses the local date instead of `toISOString()`, which could record a
  late-in-the-day checkout as the previous day.

## Equipment search box + extra Aero (v1.0.15)

- The equipment `<select>` was replaced with a live search box (`#equipmentSearch` + hidden
  `#equipmentSearchId` + `#equipmentSuggestions` panel), mirroring the student autocomplete.
  It filters by name or equipment number and shows availability per item; out-of-stock rows are
  flagged. The panel only opens while the box is focused.
- `finalizeCheckout()` now clears `equipmentSearchId` because `checkoutForm.reset()` clears the
  visible box but not the hidden id, so a stale pick would carry into the next checkout.
- Typing invalidates a previous pick unless the text still matches the chosen item.
- Login gate gained a rotating conic aurora, drifting light rays, a specular sheen sweeping across
  the glass card, a shimmering title, and a pulsing glow. Content is forced above the sheen so the
  sweep does not wash over the text.

## User photos on the welcome screen (v1.0.16, commit 5ab08dc)

Google Sheets cannot store binary images, so a user photo is a URL column.

- `HEADERS.Users` gained `photo` plus aliases (photo/image/avatar/picture/photo url/photo_url/image url).
  This is a schema change -> the Apps Script must be redeployed as a NEW version.
- `avatarUrl()` converts a Drive share link (`/file/d/<id>/view` or `?id=<id>`) to
  `https://drive.google.com/thumbnail?id=<id>&sz=w200`; accepts data: URLs and plain URLs as-is.
- `initialsFor(name)` + `#welcomeAvatar` fall back to initials when there is no photo or the
  image cannot be fetched (offline, or the Drive file is not shared) — no broken image.
- `#userPhotoInput` in the user modal; avatar column in the Users table.
- `addOrUpdateUser(code, name, level, password, photo)` only overwrites photo when a value is
  given, so editing a password does not wipe an existing picture.

SMS bug alerts were discussed and the user decided to skip them. No detector or notifier was built.

## HTML-instead-of-JSON on reads (v1.0.17) — root cause

Live probe of the deployed endpoint: `?action=headers` returned JSON, but `?sheet=Users`
returned `text/html` containing:

    TypeError: ss.getTimeZone is not a function (line 246, file "Code")

An unhandled exception in an Apps Script web app is returned as an HTML error page, which is
what the app reports as "the server returned HTML instead of JSON". Every read path goes
through `readSheet()`, so this single line broke reads for every sheet — including the
confirmation read that runs after deleting a user, which is why the failure appeared to be a
delete bug rather than a read bug.

Fix: `timezoneOf(ss)` resolves the timezone defensively (both spellings, then
`Session.getScriptTimeZone()`, then `Etc/GMT`) so a method-name mismatch cannot take the app
down.

Also verified, not a bug: `delete_user` works correctly. The earlier "row not found" results
were an artifact of my probe sending the record at the top level; the script reads `a.data`,
and the app's `queueChange(type, data)` sends `{type, data}`. With the correct shape:
`{"status":"success","applied":1,"skipped":[]}`.

This fix only takes effect once the Apps Script is redeployed as a NEW version.

## Blank/duplicate header columns on Checkouts (v1.0.21)

Live `?action=headers` right now:

    Checkouts raw: ["id","studentName","classType","equipmentId","equipmentName","accessories",
                    "checkoutDate","returnDate","status","","","","","equipmentNumber"]
    duplicates:    ["","",""]   mismatched: ["","","","",""]

Two problems fixed:

1. `?action=repair` could never clear these. `normalizeHeader("")` is falsy, so the loop hit
   `if (!key) continue;` and skipped every blank column. Now blank columns with no data below
   are deleted (`sheet.deleteColumn`), iterating right-to-left so earlier indices are not
   shifted. Non-blank duplicates are still only cleared, never deleted.
2. The message printed empty strings ("duplicate header columns (, ,)"). `?action=headers` now
   reports duplicates as column letters (`J:blank`) and a separate `blankColumns` list, and the
   app prints those instead of blank names.

Helpers added to apps-script.gs: `letter(index)` (0-based index -> A1 letter) and
`hasDataBelow(sheet, index)`.

Blacklist Lift: verified working against the live deployment with the app's payload shape
(`{"status":"success","applied":1,"skipped":[]}`). The failure is the confirmation read hitting
the `ss.getTimeZone is not a function` bug, which returns HTML. Redeploy as a NEW version.

Blacklist student box is now an Aero autocomplete search box (`#blacklistSuggestions`), matching
the checkout page; native `<datalist>` removed.

## Mobile build (PWA + Capacitor Android) — commit 9285276

Icons (verified):
- Desktop/in-app icon rebuilt from `buildResources/source-desktop.png` (the Drive image
  `1v71a7WeOX3oKD9eKHpvtW7MDhEUg_g1D`). `buildResources/icon.ico` = 6 entries, sizes
  16/32/48/64/128/256. Verified 6/6 embedded in both `dist/win-unpacked/Lannorama Database
  System.exe` and `dist/Lannorama-Database-System-Setup-1.0.22.exe`.
- Mobile launcher icon from `buildResources/source-mobile.png` (Drive file
  `1GkX5zg8YDrULnxQTof8wXe26EEPiAPMO`): Android mipmap 48/72/96/152/192 + adaptive
  foregrounds per density (108dp canvas, content at 66% safe zone), iOS 1024/180/120/76/40,
  PWA 192/512 + apple-touch-icon 180. `scripts/build-icons.js` mirrors Android icons into
  `android/app/src/main/res` (verified byte-identical for all 5 densities).
- Launcher name under the icon is "Lannorama" (manifest `short_name`, Capacitor `appName`,
  `android/app/src/main/res/values/strings.xml`).
- `ic_launcher_background.xml` set to #1A0A0C.

Responsive: 100dvh, safe-area insets, sidebar becomes a horizontal nav strip below 768px,
tables scroll horizontally, single-column forms, 44px touch targets, 1rem inputs (iOS auto-zoom
below 16px), landscape-phone block hides the mini calendar. Desktop untouched.

Updater on mobile: CANNOT work — `electron-updater` needs Electron + NSIS, and an installed app
cannot replace itself. The service worker (`src/sw.js`) is the mobile update path: caches the app
shell, never caches dynamic backend responses, posts `UPDATE_AVAILABLE` so the popup becomes
"Reload for update". Desktop-only panels (updater, kiosk) are hidden on mobile with
`.hidden-on-mobile` (a class, because `applyRolePermissions()` re-sets display on login).

PWA hosting: needs HTTPS — GitHub Pages (free, repo is public). Pages is NOT enabled yet
(Pages API 404). Backend already answers cross-origin (`Access-Control-Allow-Origin: *`).

APK: built by `.github/workflows/android-apk.yml` on GitHub Actions (free, public repo) — no
Android SDK/java/adb on this machine, so the APK cannot be built locally. Capacitor
core/cli/android added as devDependencies; `npx cap add android` scaffolded `android/`.
The workflow is UNTESTED (first run may need tweaks).

iOS: cannot be built here (needs a Mac + Xcode). Free Apple ID sideload requires re-signing
every 7 days. Kiosk mode cannot work on mobile (web page cannot lock a device).

## OPEN QUESTION (user decision, not yet built)
Test accounts: user wants an account option where changes "never stay" but still verify they
reached the server. Two designs offered:
  A. write -> verify -> auto-rollback (compensating delete / restore prior value)
  B. sandbox `Test` sheet on the server, real sheets untouched
Not implemented. `RANK = {ta:1, staff:2, developer:3}`, `LEVEL_TABS`, `userLevelSelect` options
are staff/ta. Do not auto-add a test account to the developer account.

## Test accounts — implemented (commit 3f45a64), design A: write -> verify -> roll back

Chosen behaviour: a test account really writes to the server (so the Apps Script write path is
exercised and errors surface), the change is confirmed present in the table, then it is undone.
Nothing survives the session.

- `RANK.test = 2` (same rank as staff), `LEVEL_TABS.test` = staff tab set, `isTestSession()` in
  src/auth.js, role badge shows "TEST". Test accounts are created in the Developer Console like
  any other code — never auto-created for the developer.
- src/renderer.js: `testBaseline` captured at login and refreshed after each cloud read while
  `testInFlight` is false, `sendAndVerify()`, `runTestAction()`, `undoActionFor()`,
  `restoreTestRecord()`. `saveData()` skips localStorage writes for test sessions.
- `verifyQueue` and the test path share `actionAppliedInCloud()` / `cloudRowsFor()` /
  `sheetNameForAction()` so "the action landed" means the same thing in both.
- `assign_id` is refused in test mode: it only fills a blank id on a hand-imported row and there
  is no way to un-write it.
- If the change cannot be confirmed, it is rolled back locally too and reported as unverified.
- No caller of `queueChange` uses its return value (checked), so making it async is safe.

## APK build — VERIFIED WORKING (run 42560144941, success)

First three runs failed with exit 126 (permission denied): `android/gradlew` was committed as
mode 100644 because the executable bit is not preserved when committing from Windows. Fixed by
`git update-index --chmod=+x android/gradlew` (now 100755), `.gitattributes` keeping gradlew/*.sh
LF, and `chmod +x gradlew` in the workflow. Run 42560144941 produced a real 3.9M
`app-debug.apk` and uploaded it as artifact `Lannorama-apk`.

Workflow: checkout -> setup-node 20 -> setup-java 17 (Capacitor 6 / AGP 8 need JDK 17) ->
`npm ci` -> `npx cap sync android` (android/ is committed, so `cap add android` would fail) ->
`./gradlew assembleDebug --no-daemon` -> upload artifact. Trigger with Actions tab ->
"Build Android APK" -> Run workflow, or the GitHub API dispatch.

## PWA not working — root cause found (diagnosed 2026-11-09)

GitHub Pages is enabled but its **source path is `/docs`**, and there is no `docs/` folder in the
repo. So the site root serves GitHub's 404 page, and the app is only reachable under `/src/`:

- `https://kashimean.github.io/lannorama-database-system/index.html` -> 200 but it is GitHub's
  404 page (`<html lang="en-US">`), NOT the app.
- `.../src/index.html` -> 200 (the real app)
- `.../src/manifest.webmanifest` -> 200, `content-type: application/manifest+json` (correct)
- `.../src/sw.js` -> 200, `application/javascript`
- `.../manifest.webmanifest` and `.../sw.js` at the site root -> 404

So the manifest and service worker are served correctly, but only inside `/src/`, which means the
installable start_url/scope is `/src/` rather than the site root — and anyone opening the plain
site URL gets the 404 page, so nothing looks installable.

Fix (needs the user, the API cannot change the path of an existing legacy Pages site — POST
returned 409 "GitHub Pages is already enabled"):
  Settings -> Pages -> source path from `/docs` to `/src` (or build from the repo root and move
  the app files). After that: start_url `./index.html`, scope `./`, sw and icons all resolve at
  the site root.

Also note: the manifest/service worker do nothing in the Electron build (file:// origin) — PWA
only works over HTTPS. On the Capacitor Android build, sw.js registers from https://localhost.

Nothing in the code is half-edited: src/manifest.webmanifest, src/sw.js, the head links in
src/index.html and the responsive CSS are all committed (dd3e836 / 22c566e), node --check green.
