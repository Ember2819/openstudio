const { contextBridge, ipcRenderer } = require('electron');

// automated / screenshot runs (see main.js) must not be interrupted by the first-launch welcome (--welcome forces it)
const testRun = process.argv.some((a) => a.startsWith('--screenshot=')) && !process.argv.includes('--welcome');

contextBridge.exposeInMainWorld('studioAPI', {
  testRun,
  saveProject: (opts) => ipcRenderer.invoke('project:save', opts),
  openProject: () => ipcRenderer.invoke('project:open'),
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    open: (file) => ipcRenderer.invoke('recent:open', file),
    clear: () => ipcRenderer.invoke('recent:clear'),
  },
  openSamples: () => ipcRenderer.invoke('sample:open'),
  flpSamples: (paths) => ipcRenderer.invoke('flp:samples', paths),
  writeFile: (opts) => ipcRenderer.invoke('file:write', opts),
  pickFolder: (opts) => ipcRenderer.invoke('dir:pick', opts),
  library: {
    folders: () => ipcRenderer.invoke('lib:folders'),
    add: () => ipcRenderer.invoke('lib:add'),
    remove: (p) => ipcRenderer.invoke('lib:remove', p),
    list: (dir) => ipcRenderer.invoke('lib:list', dir),
    read: (file) => ipcRenderer.invoke('lib:read', file),
  },
  writeInFolder: (opts) => ipcRenderer.invoke('dir:write', opts),
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
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
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
