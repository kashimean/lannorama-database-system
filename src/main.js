const { app, BrowserWindow, ipcMain, Notification } = require('electron');
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

// Printing the logs. webContents.print() is the reliable path in Electron; window.print()
// in the renderer often opens a print preview that is not available in a packaged app.
ipcMain.handle('print:logs', (event) => {
  return new Promise((resolve) => {
    const wc = event.sender;
    const options = {
      silent: false,
      printBackground: true,
      // Landscape so the six log columns fit on one page.
      landscape: true,
      margins: { marginType: 'default' }
    };
    try {
      wc.print(options, (success, failureType) => resolve({ success, failureType }));
    } catch (err) {
      resolve({ success: false, failureType: String(err) });
    }
  });
});

// Notifications (due today / overdue). The timer lives in the main process because the renderer
// cannot run anything while the window is closed. It fires at the configured hour on the dot,
// then the renderer decides what to announce (it owns the data and the once-per-day dedupe).
// If the app is not running at that hour nothing fires - Electron has no way to wake a closed
// app, so the launch-time check is the fallback.
let notifyHour = 7;
let notifyTimer = null;

function msUntilLocalHour(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

function scheduleNotifyTick() {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    if (winRef && !winRef.isDestroyed()) {
      winRef.webContents.send('notify:tick', { hour: notifyHour });
    }
    scheduleNotifyTick();
  }, msUntilLocalHour(notifyHour));
}

ipcMain.handle('notify:configure', (_event, hour) => {
  notifyHour = Math.min(23, Math.max(0, Number(hour) || 7));
  scheduleNotifyTick();
  return notifyHour;
});

ipcMain.handle('notify:show', (_event, payload) => {
  if (!Notification.isSupported()) return false;
  const n = new Notification({
    title: String((payload && payload.title) || 'Lannorama'),
    body: String((payload && payload.body) || ''),
    tag: String((payload && payload.tag) || '')
  });
  n.show();
  return true;
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
