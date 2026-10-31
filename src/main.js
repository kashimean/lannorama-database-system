const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initUpdater } = require('./updater');

// Kiosk state lives in the main process so the renderer cannot escape it by
// itself: fullscreen is re-forced and the window cannot be closed while active.
let kioskActive = false;
let winRef = null;

function sendKioskState() {
  if (winRef && !winRef.isDestroyed()) {
    winRef.webContents.send('kiosk:state', kioskActive);
  }
}

function applyKiosk() {
  if (!winRef) return;

  if (kioskActive) {
    winRef.setFullScreen(true);
    winRef.setMenuBarVisibility(false);
    // No right-click menu, no dev tools while locked down.
    winRef.webContents.on('context-menu', (e) => e.preventDefault());
  } else {
    winRef.setFullScreen(false);
  }

  sendKioskState();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 650,
    title: "Lannorama Database System",
    backgroundColor: '#1a0a0c',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    fullscreen: kioskActive,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  winRef = win;

  win.loadFile('src/index.html');

  // Launch maximized (or fullscreen when kiosk is on)
  if (kioskActive) {
    win.setFullScreen(true);
  } else {
    win.maximize();
  }

  win.setMenuBarVisibility(false);

  // Kiosk tablets must not be able to drop out of fullscreen (F11 / Esc).
  win.on('leave-full-screen', () => {
    if (kioskActive) {
      win.setFullScreen(true);
    }
  });

  // Cannot close the window while kiosk is active — turn kiosk off first.
  win.on('close', (e) => {
    if (kioskActive) {
      e.preventDefault();
      sendKioskState();
    }
  });

  initUpdater(win);
}

ipcMain.handle('kiosk:get', () => kioskActive);

ipcMain.handle('kiosk:set', (_event, on) => {
  kioskActive = !!on;
  applyKiosk();
  return kioskActive;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
