const { contextBridge, ipcRenderer } = require('electron');

// automated / screenshot runs (see main.js) must not be interrupted by the first-launch welcome (--welcome forces it)
const testRun = process.argv.some((a) => a.startsWith('--screenshot=')) && !process.argv.includes('--welcome');

contextBridge.exposeInMainWorld('studioAPI', {
  testRun,
  saveProject: (opts) => ipcRenderer.invoke('project:save', opts),
  openProject: () => ipcRenderer.invoke('project:open'),
  openSamples: () => ipcRenderer.invoke('sample:open'),
  writeFile: (opts) => ipcRenderer.invoke('file:write', opts),
  readAsset: (rel) => ipcRenderer.invoke('asset:read', rel),
  devWrite: (file, data) => ipcRenderer.invoke('dev:write', file, data),
  updates: {
    info: () => ipcRenderer.invoke('update:info'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    cancel: () => ipcRenderer.send('update:cancel'),
    restart: () => ipcRenderer.invoke('update:restart'),
    openRelease: () => ipcRenderer.invoke('update:openRelease'),
    onProgress: (fn) => {
      const handler = (_e, p) => fn(p);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.removeListener('update:progress', handler);
    },
  },
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
