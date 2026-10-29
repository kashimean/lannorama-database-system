# Lannorama Database System

Digital media equipment checkout tracker (Electron desktop app + Google Sheets cloud sync).

## Run in development

```cmd
cd C:\Users\Colton\equipment-tracker
npm install
npm start
```

## Build the installer EXE

```cmd
npm run dist:win
```

Output: `dist\Lannorama-Database-System-Setup-1.0.0.exe`

This is the installer your teacher runs. It creates a desktop + Start Menu shortcut.

## How auto-update works

1. Set `build.publish` in `package.json` to your GitHub owner/repo.
2. Add a GitHub Personal Access Token so electron-builder can publish:
   ```cmd
   set GH_TOKEN=your_github_token
   ```
3. Build and publish a release:
   ```cmd
   npm run release
   ```
   This uploads the installer + `latest.yml` to GitHub Releases.
4. On the teacher's machine, the installed app checks the release feed on launch and every 12 hours. Settings → **Auto-Updater** shows Check / Download / Install & Restart.

### Alternative to GitHub (no token needed)

If you'd rather host the files yourself, change `build.publish` to:

```json
"publish": [
  { "provider": "generic", "url": "https://your-server.com/lannorama-updates/" }
]
```

The folder must contain `latest.yml` plus the installer EXE. GitHub raw or any static host works.

## Important notes

- **Auto-update only works in the packaged/installed app.** Running `npm start` or opening `index.html` shows "Updater is inactive" — that's expected.
- **Version number drives updates.** Bump `"version"` in `package.json`, rebuild, publish. The installed app compares versions.
- **Code signing** is optional. Unsigned builds update fine, but Windows SmartScreen may warn on the first install.
- **Local data survives updates.** `localStorage` is stored per-user in the Electron app data folder, so updating the EXE does not wipe the offline queue or cached data.

## Google Sheets

Paste the Apps Script from Settings → Cloud & Settings into the sheet, then
**Deploy → Manage deployments → Edit → New version → Deploy**. Editing code alone
does not update the live `/exec` URL.
