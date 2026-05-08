const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('settingsApi', {
  getAppSettings:  ()  => ipcRenderer.invoke('get-app-settings'),
  saveAppSettings: (s) => ipcRenderer.invoke('save-app-settings', s),
});
