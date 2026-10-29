const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.invoke('updater:install'),
    getUpdaterState: () => ipcRenderer.invoke('updater:state'),
    onUpdaterState: (callback) => {
        ipcRenderer.on('updater:state', (_event, state) => callback(state));
    }
});
