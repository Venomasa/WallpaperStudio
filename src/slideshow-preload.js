const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slideshow', {
  start: (ms) => ipcRenderer.send('start-slideshow', ms),
  stop: () => ipcRenderer.send('stop-slideshow')
});
