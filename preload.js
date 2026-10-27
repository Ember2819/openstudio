const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioAPI', {
  saveProject: (opts) => ipcRenderer.invoke('project:save', opts),
  openProject: () => ipcRenderer.invoke('project:open'),
  openSamples: () => ipcRenderer.invoke('sample:open'),
  writeFile: (opts) => ipcRenderer.invoke('file:write', opts),
  readAsset: (rel) => ipcRenderer.invoke('asset:read', rel),
  devWrite: (file, data) => ipcRenderer.invoke('dev:write', file, data),
  setTitle: (title) => ipcRenderer.send('window:title', title),
  // MCP bridge (src/agent): the main process hosts the server, the renderer owns the project and runs the tools
  agent: {
    info: () => ipcRenderer.invoke('agent:info'),
    register: (tools) => ipcRenderer.send('agent:register', tools),
    onCall: (handler) => ipcRenderer.on('agent:call', async (_e, { id, name, args }) => {
      ipcRenderer.send('agent:result', { id, ...(await handler(name, args)) });
    }),
    readFile: (path) => ipcRenderer.invoke('agent:read-file', path),
    writeFile: (path, data) => ipcRenderer.invoke('agent:write-file', path, data),
  },
});
