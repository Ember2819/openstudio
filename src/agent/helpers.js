import { noteName, COLORS } from '../util.js';
import { MIXER_TRACKS, PLAYLIST_TRACKS } from '../state.js';

export const MAX_PITCH = 119; // B9, the top of the piano roll

/** An error the agent should see verbatim (bad reference, out-of-range value, …). */
export class ToolError extends Error {}
export const fail = (message) => { throw new ToolError(message); };

const NOTE_RE = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/;
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 60, "60" or "C5" -> 60. OpenStudio's octave naming: MIDI 60 is C5. */
export function parsePitch(v) {
  let p;
  if (typeof v === 'number') p = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) p = Number(v);
  else {
    const m = NOTE_RE.exec(String(v).trim());
    if (!m) fail(`"${v}" is not a pitch: use a MIDI number or a note name like C5, F#4, Bb3`);
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0;
    p = Number(m[3]) * 12 + SEMITONE[m[1].toUpperCase()] + acc;
  }
  if (!Number.isInteger(p) || p < 0 || p > MAX_PITCH) fail(`Pitch ${v} is outside the piano roll range (0-${MAX_PITCH}, C0-B9)`);
  return p;
}
export { noteName };

/** Find an item by numeric id or name (exact, case-insensitive, then a unique substring). */
function find(list, refValue, what) {
  if (typeof refValue === 'number' || (typeof refValue === 'string' && /^\d+$/.test(refValue))) {
    const hit = list.find((x) => x.id === Number(refValue));
    if (hit) return hit;
    fail(`No ${what} with id ${refValue}`);
  }
  const name = String(refValue).trim().toLowerCase();
  const exact = list.filter((x) => x.name.toLowerCase() === name);
  if (exact.length === 1) return exact[0];
  const partial = exact.length ? exact : list.filter((x) => x.name.toLowerCase().includes(name));
  if (partial.length === 1) return partial[0];
  if (!partial.length) fail(`No ${what} named "${refValue}"`);
  fail(`"${refValue}" matches ${partial.length} ${what}s (${partial.map((x) => `${x.id}: ${x.name}`).join(', ')}) — use the id`);
}

export const channelOf = (store, r) => (r === undefined || r === null ? (store.selectedChannel ?? fail('The project has no channels')) : find(store.project.channels, r, 'channel'));
export const patternOf = (store, r) => (r === undefined || r === null ? store.currentPattern : find(store.project.patterns, r, 'pattern'));

export function clipOf(store, id) {
  return store.project.playlist.clips.find((c) => c.id === id) ?? fail(`No playlist clip with id ${id}`);
}
export function automationOf(store, id) {
  return store.automation(id) ?? fail(`No automation with id ${id}`);
}

export function mixerTrackOf(store, i) {
  if (!Number.isInteger(i) || i < 0 || i >= MIXER_TRACKS) fail(`Mixer track must be 0 (master) to ${MIXER_TRACKS - 1}, got ${i}`);
  return store.project.mixer[i];
}
export function playlistTrackOf(store, i) {
  if (!Number.isInteger(i) || i < 0 || i >= PLAYLIST_TRACKS) fail(`Playlist track must be 0 to ${PLAYLIST_TRACKS - 1}, got ${i}`);
  return store.project.playlist.tracks[i];
}

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const round = (v, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;
export const pickColor = (i) => COLORS[i % COLORS.length];

/**
 * Run a mutation as one undo step. If it throws, the project is put back as it was; if it ended up
 * changing nothing, the undo step is dropped so a no-op call does not leave an empty entry behind.
 */
export function edit(store, fn) {
  const before = store.snapshot();
  const saved = { undo: store.undoStack.slice(), redo: store.redoStack, dirty: store.dirty };
  store.checkpoint();
  const rollback = () => { store.undoStack = saved.undo; store.redoStack = saved.redo; store.dirty = saved.dirty; };
  let result;
  try {
    result = fn();
  } catch (err) {
    if (store.snapshot() !== before) { store.project = JSON.parse(before); store.emit('project'); }
    rollback();
    throw err;
  }
  if (store.snapshot() === before) rollback();
  return result;
}

/** Notes as the agent sees them. */
export const noteOut = (n) => ({ pitch: n.p, name: noteName(n.p), start: n.s, length: n.l, velocity: round(n.v), ...(n.m ? { muted: true } : {}), ...(n.pan ? { pan: n.pan } : {}), ...(n.fine ? { fine: n.fine } : {}) });

/** Notes as the agent sends them -> project notes. */
export function noteIn(n, i = 0) {
  if (n.start < 0) fail(`notes[${i}].start must be 0 or later`);
  if (!(n.length > 0)) fail(`notes[${i}].length must be greater than 0`);
  const out = { p: parsePitch(n.pitch), s: n.start, l: n.length, v: n.velocity ?? 0.78 };
  if (n.muted) out.m = true;
  if (n.pan) out.pan = Math.max(-1, Math.min(1, n.pan));
  if (n.fine) out.fine = Math.round(Math.max(-120, Math.min(120, n.fine)));
  return out;
}

/** Check one instrument/effect parameter against its metadata and return the value to store. */
export function checkParam(metaList, key, value, what) {
  const meta = metaList.find((m) => m.key === key);
  if (!meta) fail(`${what} has no parameter "${key}" (available: ${metaList.map((m) => m.key).join(', ')})`);
  if (meta.type === 'select') {
    if (!meta.options.includes(value)) fail(`${what} parameter "${key}" must be one of ${meta.options.join(', ')}`);
  } else if (meta.type === 'toggle') {
    if (typeof value !== 'boolean') fail(`${what} parameter "${key}" must be true or false`);
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} parameter "${key}" must be a number`);
    if (value < meta.min || value > meta.max) fail(`${what} parameter "${key}" must be between ${meta.min} and ${meta.max} (got ${value})`);
  }
  return value;
}

/** Best match for `query` among `items` ({ name }): exact name, else a single partial match, else an error listing candidates. */
export function pickByName(items, query, what) {
  const q = String(query).trim().toLowerCase();
  const exact = items.filter((x) => x.name.toLowerCase() === q);
  if (exact.length) return exact[0];
  const partial = items.filter((x) => x.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (!partial.length) fail(`No ${what} matches "${query}" — try list_catalog`);
  fail(`"${query}" matches ${partial.length} ${what}s: ${partial.slice(0, 8).map((x) => x.name).join('; ')}${partial.length > 8 ? '; …' : ''}. Use the exact name.`);
}
