export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  // accessibility: buttons that show only an icon (or a letter like "M") are named by their hint
  if (tag === 'button' && el.dataset.hint && !el.hasAttribute('aria-label') && el.textContent.trim().length <= 2) {
    el.setAttribute('aria-label', el.dataset.hint.split(/ — | · /)[0]);
  }
  return el;
}

export class Emitter {
  constructor() { this._l = new Map(); }
  on(evt, fn) {
    if (!this._l.has(evt)) this._l.set(evt, new Set());
    this._l.get(evt).add(fn);
    return () => this._l.get(evt)?.delete(fn);
  }
  emit(evt, data) {
    const set = this._l.get(evt);
    if (set) for (const fn of [...set]) fn(data);
  }
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// FL Studio convention: MIDI 60 is C5.
export const noteName = (p) => NAMES[p % 12] + Math.floor(p / 12);
export const isBlackKey = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
export const midiToFreq = (p) => 440 * Math.pow(2, (p - 69) / 12);
export const ROOT_NOTE = 60;

// Mixer fader: 0.8 == 0 dB, 1.0 == +6 dB
export function faderToGain(v) {
  if (v <= 0) return 0;
  if (v >= 0.8) return Math.pow(10, (((v - 0.8) / 0.2) * 6) / 20);
  return Math.pow(v / 0.8, 2.5);
}
export const gainToDb = (g) => (g <= 0.00001 ? -Infinity : 20 * Math.log10(g));
export function fmtDb(g) {
  const db = gainToDb(g);
  return db === -Infinity ? '-inf' : (db >= 0 ? '+' : '') + db.toFixed(1);
}
// Channel volume knob -> gain
export const channelGain = (v) => v * v * 1.15;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex, amt) { // amt -1..1
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(clamp(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt), 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export const COLORS = [
  '#8b6cc0', '#5f9ea0', '#c4824f', '#92a95c', '#bb5d85', '#5b8bc4', '#bfa650', '#6cae8f',
  '#a0527f', '#6a7f93', '#c76c5d', '#7da25d',
];

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
