// A headless "app" for exercising the MCP tools: the real Store, Transport and actions, with a stub audio engine.
import { Store } from '../src/state.js';
import { Transport } from '../src/audio/transport.js';
import { createActions } from '../src/actions.js';
import { runTool } from '../src/agent/index.js';
import { Emitter } from '../src/util.js';
import { ToolError } from '../src/agent/helpers.js';

export const CATALOG = {
  families: [
    { name: 'Piano', presets: [{ name: 'Acoustic Grand Piano', bank: 0, program: 0 }, { name: 'Bright Acoustic Piano', bank: 0, program: 1 }] },
    { name: 'Bass', presets: [{ name: 'Acoustic Bass', bank: 0, program: 32 }, { name: 'Fingered Bass', bank: 0, program: 33 }, { name: 'Fretless Bass', bank: 0, program: 35 }] },
  ],
  kits: [{ name: 'Standard', bank: 128, program: 0, pieces: [{ key: 36, name: 'Bass Drum 1' }, { key: 38, name: 'Acoustic Snare' }, { key: 42, name: 'Closed Hi-Hat' }] }],
};

export function makeApp() {
  const store = new Store();
  const calls = [];
  const engine = {
    ctx: { currentTime: 0, state: 'running' },
    ensure() {}, playNote() {}, killAll() {}, click() {}, syncAll() {},
    syncFx: (t) => calls.push(['syncFx', t]),
    resetFx: (t) => calls.push(['resetFx', t]),
    preview: (...a) => calls.push(['preview', ...a.slice(1)]),
    ensureSample: async () => ({ duration: 2 }),
  };
  const transport = new Transport(store, engine);
  const app = new Emitter();
  Object.assign(app, { store, engine, transport, calls, ui: { snap: 'line' } });
  app.actions = createActions(app);
  app.actions.catalog = () => CATALOG;
  const written = new Map();
  app.files = {
    read: async (p) => { if (!written.has(p)) throw new ToolError(`ENOENT: ${p}`); return written.get(p); },
    write: async (p, data) => { written.set(p, typeof data === 'string' ? new TextEncoder().encode(data).buffer : data); return p; },
  };
  app.written = written;
  app.browserVisible = () => true;
  return app;
}

/** Run a tool and return its value, throwing on failure. */
export async function call(app, name, args = {}) {
  const res = await runTool(app, name, args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

/** Run a tool that is expected to fail; returns the error text. */
export async function callFails(app, name, args = {}) {
  const res = await runTool(app, name, args);
  if (res.ok) throw new Error(`${name} unexpectedly succeeded`);
  return res.error;
}
