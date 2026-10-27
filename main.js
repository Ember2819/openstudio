const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');

// Dev helper: `electron . --screenshot=/tmp/out.png [--eval="js"] [--wait=1500] [--size=1600x900]`
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;

function createWindow() {
  const [w, h] = (argOf('size') || '1600x940').split('x').map(Number);
  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#2d383e',
    title: 'OpenStudio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  const shot = argOf('screenshot');
  if (shot) {
    mainWindow.webContents.on('console-message', (_e, _lvl, msg) => console.log('[renderer]', msg));
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, Number(argOf('wait') || 1200)));
      const evalSrc = argOf('eval');
      if (evalSrc) {
        try {
          const res = await mainWindow.webContents.executeJavaScript(evalSrc);
          if (res !== undefined) console.log('[eval]', JSON.stringify(res));
        } catch (err) {
          console.log('[eval error]', err.message);
        }
        await new Promise((r) => setTimeout(r, Number(argOf('after') || 400)));
      }
      const input = argOf('input');
      if (input) {
        for (const ev of JSON.parse(input)) {
          if (ev.wait) { await new Promise((r) => setTimeout(r, ev.wait)); continue; }
          if (ev.eval) {
            try {
              const res = await mainWindow.webContents.executeJavaScript(ev.eval);
              if (res !== undefined) console.log('[eval]', JSON.stringify(res));
            } catch (err) { console.log('[eval error]', err.message); }
            continue;
          }
          mainWindow.webContents.sendInputEvent({ clickCount: 1, ...ev });
          await new Promise((r) => setTimeout(r, 25));
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(shot, img.toPNG());
      app.quit();
    });
  }
}

ipcMain.handle('project:save', async (_e, { suggestedName, text, forceDialog, knownPath }) => {
  let target = forceDialog ? null : knownPath;
  if (!target) {
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName,
      filters: [{ name: 'OpenStudio project', extensions: ['osp'] }],
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  await fs.promises.writeFile(target, text, 'utf8');
  return target;
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'OpenStudio project', extensions: ['osp', 'json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  return { path: file, text: await fs.promises.readFile(file, 'utf8') };
});

ipcMain.handle('sample:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a'] }],
  });
  if (res.canceled) return [];
  return Promise.all(
    res.filePaths.map(async (file) => {
      const buf = await fs.promises.readFile(file);
      return { name: path.basename(file), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    })
  );
});

ipcMain.handle('file:write', async (_e, { suggestedName, data, filters }) => {
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName, filters });
  if (res.canceled || !res.filePath) return null;
  await fs.promises.writeFile(res.filePath, Buffer.from(data));
  return res.filePath;
});

ipcMain.handle('asset:read', async (_e, rel) => {
  const root = path.join(__dirname, 'assets');
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) throw new Error('Invalid asset path');
  const buf = await fs.promises.readFile(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

if (argOf('screenshot')) {
  // dev-only: lets test scripts dump rendered audio / data to disk
  ipcMain.handle('dev:write', async (_e, file, data) => { await fs.promises.writeFile(file, Buffer.from(data)); return file; });
}

ipcMain.on('window:title', (_e, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

// ---- MCP server: lets AI agents drive the project (see docs/AGENTS.md) ----
// On by default, listening on 127.0.0.1 only. `--no-mcp` (or OPENSTUDIO_MCP=0) turns it off,
// `--mcp-port=N` / OPENSTUDIO_MCP_PORT picks the port (0 = any free port).
const DEFAULT_MCP_PORT = 6736;
let agentHost = null;

async function startAgents() {
  const off = process.argv.includes('--no-mcp') || process.env.OPENSTUDIO_MCP === '0';
  if (off) { ipcMain.handle('agent:info', () => null); return; }
  const port = Number(argOf('mcp-port') ?? process.env.OPENSTUDIO_MCP_PORT ?? DEFAULT_MCP_PORT);
  try {
    const { startAgentHost } = require('./mcp/bridge');
    agentHost = await startAgentHost({
      ipcMain,
      getWindow: () => mainWindow,
      version: app.getVersion(),
      port,
      instructions: require('./mcp/instructions'),
    });
    console.log(`[mcp] listening on ${agentHost.url}`);
  } catch (err) {
    console.error(`[mcp] could not start on port ${port}: ${err.message}`);
    ipcMain.handle('agent:info', () => null);
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const allowed = (perm) => perm === 'midi' || perm === 'midiSysex';
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed(perm));
  await startAgents();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { agentHost?.close(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
