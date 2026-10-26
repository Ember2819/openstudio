// Periodic autosave of unsaved work to IndexedDB, and an offer to recover it on the next start.
import { confirmDialog } from './ui/dialog.js';

const DB = 'openstudio';
const STORE = 'autosave';
const KEY = 'current';
const INTERVAL_MS = 30000;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const read = () => tx('readonly', (s) => s.get(KEY));
const write = (rec) => tx('readwrite', (s) => s.put(rec, KEY));
const clear = () => tx('readwrite', (s) => s.delete(KEY));

export function installAutosave(app) {
  const { store } = app;
  let last = null; // project snapshot (without samples) that was last written
  let busy = false;

  async function save() {
    if (busy || !store.dirty) return;
    const snap = store.snapshot();
    if (snap === last) return;
    busy = true;
    try {
      await write({ time: Date.now(), name: store.project.name, filePath: store.filePath, text: store.serialize() });
      last = snap;
    } catch (err) {
      console.warn('Autosave failed', err);
    } finally {
      busy = false;
    }
  }

  const discard = () => { last = null; clear().catch(() => {}); };

  setInterval(save, INTERVAL_MS);
  // a saved project, a fresh project or an opened file has nothing left to recover
  store.on('project-saved', discard);

  async function offerRecovery() {
    let rec;
    try { rec = await read(); } catch { return; }
    if (!rec?.text) return;
    const when = new Date(rec.time).toLocaleString();
    const ok = await confirmDialog('Recover unsaved work?',
      `OpenStudio found unsaved changes to "${rec.name}" from ${when} (the app was closed or crashed before they were saved).\n\nRecover them now?`,
      'Recover');
    if (!ok) { discard(); return; }
    try {
      app.transport.stop();
      store.load(rec.text, rec.filePath ?? null);
      store.dirty = true; // still unsaved
      store.emit('project');
    } catch (err) {
      console.error('Could not recover autosave', err);
      discard();
    }
  }

  return { save, discard, offerRecovery };
}
