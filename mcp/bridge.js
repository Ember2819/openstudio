'use strict';
// Connects the MCP server (main process) to the project, which lives in the renderer.
//
// The renderer registers its tool definitions at start-up (`agent:register`) and executes calls
// (`agent:call` -> `agent:result`). The main process adds the few tools that need Electron itself
// (screenshots) and the path-based file access the tools use in place of the human file dialogs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMcpServer } = require('./server');

const CALL_TIMEOUT_MS = 5 * 60 * 1000;
const READY_TIMEOUT_MS = 30 * 1000;

const NATIVE_TOOLS = [
  {
    name: 'screenshot',
    title: 'Screenshot',
    description: 'Capture the OpenStudio window as a PNG image, to see what a person sees (open windows, piano roll, mixer…). Use show_window first to bring an editor into view.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

function resolveUserPath(p) {
  if (typeof p !== 'string' || !p) throw new Error('A file path is required');
  const full = p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(1)) : p;
  if (!path.isAbsolute(full)) throw new Error(`Use an absolute path (got "${p}")`);
  return path.normalize(full);
}

// compact JSON: agents read it as text, so indentation would only cost tokens
const text = (value) => ({ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) });

/**
 * Starts the MCP server and wires it to the renderer.
 * `electron` is injected ({ ipcMain, getWindow }) so this module has no hard dependency on Electron.
 */
async function startAgentHost({ ipcMain, getWindow, version, port, instructions }) {
  let tools = [];
  let ready = null;
  let markReady = () => {};
  const resetReady = () => { ready = new Promise((resolve) => { markReady = resolve; }); };
  resetReady();

  let nextId = 1;
  const pending = new Map(); // call id -> { resolve, reject, timer }
  const failPending = (reason) => {
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); pending.delete(id); }
  };

  const fromWindow = (event) => {
    const win = getWindow();
    return !!win && event.sender === win.webContents;
  };

  const registerIpc = () => {
    ipcMain.handle('agent:info', () => ({ url: server.url, port: server.port }));
    ipcMain.on('agent:register', (event, list) => {
      if (!fromWindow(event) || !Array.isArray(list)) return;
      tools = list;
      markReady();
    });
    ipcMain.on('agent:result', (event, msg) => {
      if (!fromWindow(event) || !msg) return;
      const p = pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve(msg);
    });
    ipcMain.handle('agent:read-file', async (event, file) => {
      if (!fromWindow(event)) throw new Error('Forbidden');
      const buf = await fs.promises.readFile(resolveUserPath(file));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    });
    ipcMain.handle('agent:write-file', async (event, file, data) => {
      if (!fromWindow(event)) throw new Error('Forbidden');
      const target = resolveUserPath(file);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, typeof data === 'string' ? data : Buffer.from(data));
      return target;
    });
  };

  const attach = (win) => {
    // a reload drops the renderer's tools and any call in flight
    win.webContents.on('did-start-loading', () => { tools = []; resetReady(); failPending('OpenStudio reloaded while the tool was running'); });
  };
  const watched = new WeakSet();
  const watch = () => { const win = getWindow(); if (win && !watched.has(win)) { watched.add(win); attach(win); } };

  async function callRenderer(name, args) {
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error('The OpenStudio window is not open');
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Tool "${name}" timed out`)); }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      win.webContents.send('agent:call', { id, name, args });
    });
  }

  async function screenshot() {
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error('The OpenStudio window is not open');
    let img = await win.webContents.capturePage();
    const { width } = img.getSize();
    if (width > 1600) img = img.resize({ width: 1600, quality: 'good' });
    return { content: [{ type: 'image', data: img.toPNG().toString('base64'), mimeType: 'image/png' }] };
  }

  async function untilReady() {
    let timer;
    try {
      await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OpenStudio is still starting up')), READY_TIMEOUT_MS); })]);
    } finally {
      clearTimeout(timer);
    }
  }

  const backend = {
    async listTools() {
      watch();
      await untilReady();
      return [...tools, ...NATIVE_TOOLS];
    },
    async callTool(name, args) {
      watch();
      if (name === 'screenshot') {
        try { return await screenshot(); } catch (err) { return { isError: true, content: [text(err.message)] }; }
      }
      await untilReady();
      if (!tools.some((t) => t.name === name)) throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
      let res;
      try {
        res = await callRenderer(name, args);
      } catch (err) {
        return { isError: true, content: [text(err.message)] };
      }
      if (!res.ok) return { isError: true, content: [text(res.error)] };
      const content = [text(res.value === undefined ? 'OK' : res.value)];
      for (const img of res.images || []) content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      const out = { content };
      if (res.value && typeof res.value === 'object' && !Array.isArray(res.value)) out.structuredContent = res.value;
      return out;
    },
  };

  const mcp = createMcpServer({ backend, name: 'openstudio', version, instructions });
  const server = { url: null, port: null };
  const bound = await mcp.listen(port);
  server.port = bound.port;
  server.url = `http://127.0.0.1:${bound.port}/mcp`;
  registerIpc();
  return { ...server, close: () => { failPending('OpenStudio is closing'); return mcp.close(); } };
}

module.exports = { startAgentHost, resolveUserPath };
