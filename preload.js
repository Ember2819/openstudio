const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioAPI', {
  saveProject: (opts) => ipcRenderer.invoke('project:save', opts),
  openProject: () => ipcRenderer.invoke('project:open'),
  openSamples: () => ipcRenderer.invoke('sample:open'),
  writeFile: (opts) => ipcRenderer.invoke('file:write', opts),
  readAsset: (rel) => ipcRenderer.invoke('asset:read', rel),
  devWrite: (file, data) => ipcRenderer.invoke('dev:write', file, data),
  setTitle: (title) => ipcRenderer.send('window:title', title),
});
