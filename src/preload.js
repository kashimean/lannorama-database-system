const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.invoke('updater:install'),
    getUpdaterState: () => ipcRenderer.invoke('updater:state'),
    onUpdaterState: (callback) => {
        ipcRenderer.on('updater:state', (_event, state) => callback(state));
    },

    // Kiosk mode (main process holds the truth, renderer only requests it)
    getKioskState: () => ipcRenderer.invoke('kiosk:get'),
    setKioskState: (on) => ipcRenderer.invoke('kiosk:set', on),
    onKioskState: (callback) => {
        ipcRenderer.on('kiosk:state', (_event, on) => callback(on));
    },

    printLogs: () => ipcRenderer.invoke('print:logs'),

    // Notifications (due today / overdue). The main process owns the scheduled timer because the
    // renderer cannot run anything while the window is closed.
    showNotification: (payload) => ipcRenderer.invoke('notify:show', payload),
    configureNotifications: (hour) => ipcRenderer.invoke('notify:configure', hour),
    onNotifyTick: (callback) => {
        ipcRenderer.on('notify:tick', (_event, info) => callback(info));
    }
});
