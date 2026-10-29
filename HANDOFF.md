# Handoff Notes — Lannorama Database System

Project: `C:/Users/Colton/equipment-tracker`

## Current state
- Electron app, renamed **Lannorama Database System** (package.json productName, main.js title, index.html header).
- Files: `package.json`, `src/main.js`, `src/preload.js`, `src/renderer.js`, `src/index.html`, `src/style.css`, `scripts/generate-icon.js`, `README.md`, `.gitignore`.
- Google Sheets sync works (user confirmed). Offline-first queue: `queueChange()` → `flushQueue()` → `verifyQueue()` (verifies by reading sheet back; only clears queue when confirmed). Sync Activity Log + Verify button in Settings.
- Apps Script must be redeployed as a NEW version (Deploy → Manage deployments → Edit → New version) — editing code alone does not update the `/exec` URL.
- Auto-updater: `src/updater.js` (electron-updater), IPC via preload, Auto-Updater panel in Settings. Only active in packaged EXE. Checks on launch + every 12h. `autoDownload = false`.
- Installer: electron-builder NSIS, `npm run dist:win`, artifact `Lannorama-Database-System-Setup-${version}.exe`. `build.publish` = github, owner placeholder `YOUR_GITHUB_USERNAME`, repo `lannorama-database-system`.
- Icon: `scripts/generate-icon.js` writes `buildResources/icon.ico` (sizes 16/32/48/64/256). `package.json` build.icon points to it. Run `node scripts/generate-icon.js`.
- `.gitignore`: node_modules/, dist/, .env, *.log.

## Publisher tool
- `scripts/publisher.js` added: compares package.json version to latest GitHub Release; if newer, runs `npx electron-builder --win` and uploads dist artifacts (.exe, .yml, .blockmap) via GitHub API. Needs GH_TOKEN (+ optional GH_OWNER/GH_REPO). Node 18+ for fetch. Run: `node scripts/publisher.js`.
- Installer output lives in `C:/Users/Colton/equipment-tracker/dist/` after a build: `Lannorama-Database-System-Setup-<version>.exe`, `latest.yml`, `.blockmap`. `latest.yml` is what the installed app reads.

## Pending / next steps
1. GitHub repo setup: `git init`, remote, push. Needs PAT with `repo` scope + `GH_TOKEN`.
2. Replace `YOUR_GITHUB_USERNAME` in package.json publish block.
3. Optional `bump` script: `"bump": "npm version patch && electron-builder --win --publish always"`.
4. **Kiosk mode** — user mentioned wanting a locked-down kiosk mode later (not started).
5. No bash shell available in this environment — user runs commands themselves.
