const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

let winRef = null;
let updateState = { status: 'idle', message: 'Updater idle', version: '' };

function sendState() {
    if (winRef && !winRef.isDestroyed()) {
        winRef.webContents.send('updater:state', updateState);
    }
}

function setState(status, message) {
    updateState = { status, message, version: String(autoUpdater.currentVersion) };
    sendState();
}

function initUpdater(win) {
    winRef = win;

    // The updater only works in a packaged/installed build
    if (!app.isPackaged) {
        setState('dev', 'Updater is inactive while running from source. Build the EXE to enable auto-update.');
        return;
    }

    // We control download/install from the UI instead of doing it silently
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => setState('checking', 'Checking for updates...'));

    autoUpdater.on('update-available', (info) => {
        setState('available', `Update available: v${info.version} (you are on v${autoUpdater.currentVersion})`);
    });

    autoUpdater.on('update-not-available', () => {
        setState('up-to-date', 'You are on the latest version.');
    });

    autoUpdater.on('download-progress', (progress) => {
        setState('downloading', `Downloading update: ${progress.percent.toFixed(1)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
        setState('downloaded', `Update v${info.version} downloaded. Restart to install.`);
    });

    autoUpdater.on('error', (err) => {
        setState('error', `Updater error: ${err.message}`);
    });

    ipcMain.handle('updater:check', async () => {
        try {
            return await autoUpdater.checkForUpdates();
        } catch (err) {
            setState('error', `Updater error: ${err.message}`);
            return null;
        }
    });

    ipcMain.handle('updater:download', async () => {
        try {
            await autoUpdater.downloadUpdate();
        } catch (err) {
            setState('error', `Download failed: ${err.message}`);
        }
    });

    ipcMain.handle('updater:install', () => {
        autoUpdater.quitAndInstall();
    });

    ipcMain.handle('updater:state', () => updateState);

    // Check on launch, then every 12 hours
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 12 * 60 * 60 * 1000);
}

module.exports = { initUpdater };
