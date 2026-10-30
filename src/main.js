const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initUpdater } = require('./updater');

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 650,
    title: "Lannorama Database System",
    backgroundColor: '#1a0a0c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile('src/index.html');

  // Launch maximized
  win.maximize();

  // Optional: remove top menu bar for clean modern app look
  win.setMenuBarVisibility(false);

  initUpdater(win);
}

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
