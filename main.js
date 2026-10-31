const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const updater = require('./updater');

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
  await rememberRecent(target);
  return target;
});

// ------------------------------------------------------------------ recent projects (File → Open recent)
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
let recent = null;
async function recentList() {
  if (!recent) {
    try { recent = JSON.parse(await fs.promises.readFile(recentFile(), 'utf8')).filter((f) => typeof f === 'string'); } catch { recent = []; }
  }
  return recent;
}
async function rememberRecent(file) {
  const list = (await recentList()).filter((f) => f !== file);
  list.unshift(file);
  recent = list.slice(0, 12);
  await fs.promises.writeFile(recentFile(), JSON.stringify(recent)).catch(() => {});
  try { app.addRecentDocument(file); } catch { /* not on every platform */ }
}
/** Read a project file for the renderer (.flp as bytes, anything else as text). */
async function readProject(file) {
  await rememberRecent(file);
  if (/\.flp$/i.test(file)) {
    const buf = await fs.promises.readFile(file);
    lastFlp = file;
    return { path: file, kind: 'flp', data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  return { path: file, text: await fs.promises.readFile(file, 'utf8') };
}
ipcMain.handle('recent:list', async () => {
  const out = [];
  for (const f of await recentList()) if (await fs.promises.stat(f).then((st) => st.isFile(), () => false)) out.push(f);
  return out;
});
// only paths that are already on the list can be opened this way
ipcMain.handle('recent:open', async (_e, file) => ((await recentList()).includes(file) ? readProject(file) : null));
ipcMain.handle('recent:clear', async () => { recent = []; await fs.promises.writeFile(recentFile(), '[]').catch(() => {}); return []; });

// The FL Studio project the user last opened: only its sample references may be read (see flp:samples).
let lastFlp = null;

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Projects', extensions: ['osp', 'flp', 'json'] },
      { name: 'OpenStudio project', extensions: ['osp', 'json'] },
      { name: 'FL Studio project', extensions: ['flp'] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return readProject(res.filePaths[0]);
});

const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aiff?|m4a|aac)$/i;

/** FL Studio installs on this computer, for samples referenced as %FLStudioFactoryData% / %FLStudioUserData%. */
let flRootsCache = null;
async function flRoots() {
  if (flRootsCache) return flRootsCache;
  const user = path.join(app.getPath('documents'), 'Image-Line', 'FL Studio');
  const dirs = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((p) => path.join(p, 'Image-Line'))
    : process.platform === 'darwin' ? ['/Applications'] : [];
  const roots = [];
  for (const d of dirs) {
    const names = await fs.promises.readdir(d).catch(() => []);
    for (const n of names) if (/^FL Studio/i.test(n)) roots.push({ factory: path.join(d, n, process.platform === 'darwin' ? 'Contents/Resources/FL' : ''), user });
  }
  flRootsCache = roots;
  return roots;
}

/** Where a sample an .flp refers to might be on this computer: the path itself, or beside / below the project. */
async function findSample(raw, projectDir) {
  const base = raw.split(/[\\/]/).pop();
  if (!AUDIO_EXT.test(base)) return null;
  const candidates = [];
  if (!raw.includes('%')) candidates.push(raw);
  else for (const root of await flRoots()) candidates.push(raw.replace(/^%FLStudio(Factory|User)Data%/i, (_m, which) => (which.toLowerCase() === 'user' ? root.user : root.factory)).replace(/\\/g, path.sep));
  // FL's "export project data files" keeps samples beside the project, often in a sub-folder
  candidates.push(path.join(projectDir, base));
  for (const sub of ['Samples', 'samples', 'Audio', 'audio', 'Data', 'Recorded', 'Rendered', 'Sliced audio']) candidates.push(path.join(projectDir, sub, base));
  for (const c of candidates) {
    try {
      const st = await fs.promises.stat(c);
      if (st.isFile() && st.size < 512 * 1024 * 1024) return c;
    } catch { /* not there */ }
  }
  return null;
}

ipcMain.handle('flp:samples', async (_e, paths) => {
  if (!lastFlp || !Array.isArray(paths)) return [];
  const dir = path.dirname(lastFlp);
  const out = [];
  for (const raw of paths.slice(0, 500)) {
    if (typeof raw !== 'string') continue;
    const file = await findSample(raw, dir);
    if (!file) continue;
    const buf = await fs.promises.readFile(file);
    out.push({ ref: raw, name: path.basename(file), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  }
  return out;
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

// Exports that produce several files (stems): the renderer may only write plain file names into the folder the user
// picked last, never anywhere else.
let exportDir = null;
ipcMain.handle('dir:pick', async (_e, { title } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, { title: title || 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  exportDir = res.filePaths[0];
  return exportDir;
});
ipcMain.handle('dir:write', async (_e, { dir, name, data }) => {
  if (!exportDir || dir !== exportDir) throw new Error('Pick the export folder first');
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must not reach a file name
  const base = String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
  if (!/\.(wav|mid)$/i.test(base) || base.startsWith('.')) throw new Error('Invalid file name');
  const file = path.join(exportDir, base);
  await fs.promises.writeFile(file, Buffer.from(data));
  return file;
});

// ------------------------------------------------------------------ sample library (browser → Sample folders)
// The folders are picked by the user in a dialog and kept here, in the main process: the renderer can list and read
// audio files inside them, and nothing else.
const libFile = () => path.join(app.getPath('userData'), 'library.json');
let libFolders = null;
async function libraryFolders() {
  if (!libFolders) {
    try { libFolders = JSON.parse(await fs.promises.readFile(libFile(), 'utf8')).folders.filter((f) => typeof f === 'string'); } catch { libFolders = []; }
  }
  return libFolders;
}
const saveLibrary = () => fs.promises.writeFile(libFile(), JSON.stringify({ folders: libFolders }, null, 2)).catch(() => {});
/** The real path of `p` if it is inside one of the library folders, else null. */
async function inLibrary(p) {
  if (typeof p !== 'string' || !p) return null;
  let real;
  try { real = await fs.promises.realpath(p); } catch { return null; }
  for (const root of await libraryFolders()) {
    let r;
    try { r = await fs.promises.realpath(root); } catch { continue; }
    if (real === r || real.startsWith(r + path.sep)) return real;
  }
  return null;
}
ipcMain.handle('lib:folders', () => libraryFolders());
ipcMain.handle('lib:add', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { title: 'Add a sample folder to the browser', properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return libraryFolders();
  const list = await libraryFolders();
  if (!list.includes(res.filePaths[0])) { list.push(res.filePaths[0]); await saveLibrary(); }
  return list;
});
ipcMain.handle('lib:remove', async (_e, p) => {
  libFolders = (await libraryFolders()).filter((f) => f !== p);
  await saveLibrary();
  return libFolders;
});
ipcMain.handle('lib:list', async (_e, dir) => {
  const real = await inLibrary(dir);
  if (!real) throw new Error('Not in a sample folder');
  const entries = await fs.promises.readdir(real, { withFileTypes: true });
  const out = [];
  for (const d of entries) {
    if (d.name.startsWith('.')) continue;
    if (d.isDirectory()) out.push({ name: d.name, path: path.join(dir, d.name), dir: true });
    else if (AUDIO_EXT.test(d.name)) out.push({ name: d.name, path: path.join(dir, d.name), dir: false });
    if (out.length >= 3000) break;
  }
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
});
ipcMain.handle('lib:read', async (_e, file) => {
  const real = await inLibrary(file);
  if (!real || !AUDIO_EXT.test(real)) throw new Error('Not an audio file in a sample folder');
  const st = await fs.promises.stat(real);
  if (st.size > 512 * 1024 * 1024) throw new Error('That file is too large');
  const buf = await fs.promises.readFile(real);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
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

// ------------------------------------------------------------------ updates
// The renderer never supplies URLs: it can only ask us to check, then install whatever that check found.
const REPO = updater.repoSlug(require('./package.json'));
const buildInfo = updater.readBuildInfo(__dirname);
let pendingUpdate = null; // result of the last successful check
let installing = null; // AbortController while a download is running
let installedTarget = null; // set once a new package replaced the running one

// Where the running app lives on disk, if we can replace it in place (AppImage, Windows portable exe).
function selfPath() {
  if (!app.isPackaged) return null;
  if (process.platform === 'linux') return process.env.APPIMAGE || null;
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE || null;
  return null;
}

ipcMain.handle('update:info', () => ({
  version: app.getVersion(),
  build: buildInfo?.build ?? null,
  autoCheck: app.isPackaged && !!buildInfo && !argOf('screenshot'),
  inPlace: !!selfPath(),
  platform: process.platform,
}));

ipcMain.handle('update:check', async () => {
  const res = await updater.checkForUpdate({ repo: REPO, current: { version: app.getVersion(), build: buildInfo?.build ?? null } });
  pendingUpdate = res.status === 'available' ? res : null;
  return {
    status: res.status,
    latest: res.latest,
    // an update exists but nothing was built for this platform/arch -> UI falls back to the release page
    downloadable: !!res.asset,
    size: res.asset?.size ?? 0,
    assetName: res.asset?.name ?? null,
  };
});

ipcMain.handle('update:install', async (e) => {
  if (!pendingUpdate?.asset) throw new Error('No update to install — check for updates first');
  if (installing) throw new Error('An update is already downloading');
  const { asset } = pendingUpdate;
  const target = selfPath();
  const send = (p) => { if (!e.sender.isDestroyed()) e.sender.send('update:progress', p); };
  installing = new AbortController();
  const signal = installing.signal;
  const run = (dest) => updater.downloadAsset({ asset, repo: REPO, dest, onProgress: send, signal });

  try {
    if (target) {
      // Download beside the current file so the final swap is a same-volume rename.
      const staging = `${target}.update`;
      try { await fs.promises.access(path.dirname(target), fs.constants.W_OK); } catch {
        throw new Error(`OpenStudio can't write to ${path.dirname(target)}. Move the app somewhere you own, or download the update manually.`);
      }
      await run(staging);
      if (process.platform === 'win32') {
        // a running .exe can be renamed but not overwritten; the old copy is deleted on the next launch
        await fs.promises.rm(`${target}.old`, { force: true });
        await fs.promises.rename(target, `${target}.old`);
        try { await fs.promises.rename(staging, target); } catch (err) {
          await fs.promises.rename(`${target}.old`, target).catch(() => {});
          throw err;
        }
      } else {
        await fs.promises.chmod(staging, 0o755);
        await fs.promises.rename(staging, target); // atomic; the running image keeps its old inode
      }
      installedTarget = target;
      return { action: 'restart' };
    }

    // No in-place swap is possible (macOS .dmg, running from source, system-managed install): hand over the file.
    const dest = path.join(app.getPath('downloads'), asset.name);
    await run(dest);
    if (process.platform === 'darwin') await shell.openPath(dest);
    else shell.showItemInFolder(dest);
    return { action: 'manual', path: dest };
  } catch (err) {
    if (target) await fs.promises.rm(`${target}.update`, { force: true });
    throw signal.aborted ? new Error('Cancelled') : err;
  } finally {
    installing = null;
  }
});

ipcMain.on('update:cancel', () => installing?.abort());

ipcMain.handle('update:restart', () => {
  if (!installedTarget) return false;
  if (process.platform === 'win32') {
    // app.relaunch() would start the temp-extracted copy; start the portable launcher itself instead
    spawn(installedTarget, process.argv.slice(1), { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  } else {
    app.relaunch({ execPath: installedTarget, args: process.argv.slice(1) });
    app.exit(0);
  }
  return true;
});

ipcMain.handle('update:openRelease', () => shell.openExternal(pendingUpdate?.latest?.url || `https://github.com/${REPO}/releases/latest`));

// Tidy up the previous copy left behind by a Windows swap.
if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) {
  fs.promises.rm(`${process.env.PORTABLE_EXECUTABLE_FILE}.old`, { force: true }).catch(() => {});
}

ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });

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
  // MIDI devices, and audio input for recording (Options → Record → Audio)
  const allowed = (perm) => perm === 'midi' || perm === 'midiSysex' || perm === 'media' || perm === 'audioCapture';
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => cb(allowed(perm) && !details?.mediaTypes?.includes('video')));
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
