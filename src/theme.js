// Theme engine. A theme is a handful of base colours; every colour the UI uses (CSS variables for the
// DOM, `T` for canvas drawing) is derived from them here, so presets, custom colours and colours taken
// from a wallpaper all go through one path.
import { Emitter, clamp } from './util.js';

// ------------------------------------------------------------------ colour math
export function parse(c) {
  if (Array.isArray(c)) return c;
  if (c[0] === '#') {
    let s = c.slice(1);
    if (s.length === 3) s = s.replace(/./g, '$&$&');
    const n = parseInt(s.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g) || [0, 0, 0];
  return [+m[0], +m[1], +m[2]];
}
export const hex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
/** Linear mix: t = 0 → a, t = 1 → b. */
export const mix = (a, b, t) => { const x = parse(a), y = parse(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
export const alpha = (c, a) => { const [r, g, b] = parse(c); return `rgba(${r}, ${g}, ${b}, ${a})`; };
/** Relative luminance 0..1 (WCAG). */
export function luminance(c) {
  const [r, g, b] = parse(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function toHsl(c) {
  const [r, g, b] = parse(c).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function fromHsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return hex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return hex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}

// ------------------------------------------------------------------ presets
// base keys: bg (behind windows), surface (panels), text, accent (selection / active), grid (piano roll &
// playlist canvas), green (play / LEDs / playhead), red (record / close). Optional: mute, solo.
export const THEMES = {
  slate: { name: 'Slate', bg: '#283037', surface: '#313a41', text: '#d0d9de', accent: '#f2a03a', grid: '#2c3f46', green: '#8fc653', red: '#e5534b' },
  midnight: { name: 'Midnight', bg: '#12161f', surface: '#1a1f2b', text: '#cdd5e4', accent: '#6c9ef8', grid: '#1c2433', green: '#5fd0a0', red: '#ef5f6b' },
  graphite: { name: 'Graphite', bg: '#232323', surface: '#2d2d2d', text: '#d6d6d6', accent: '#f5a524', grid: '#333333', green: '#8bc34a', red: '#e5534b' },
  nord: { name: 'Nord', bg: '#2b303b', surface: '#353b48', text: '#d8dee9', accent: '#88c0d0', grid: '#3b4252', green: '#a3be8c', red: '#bf616a' },
  mocha: { name: 'Mocha', bg: '#231c1a', surface: '#2e2523', text: '#e6d8cf', accent: '#e8935a', grid: '#3a2e2a', green: '#b5c46a', red: '#e0605a' },
  amethyst: { name: 'Amethyst', bg: '#1e1a2b', surface: '#282338', text: '#ddd6ee', accent: '#c792ea', grid: '#2f2843', green: '#7fd6a6', red: '#f07178' },
  forest: { name: 'Forest', bg: '#1b2420', surface: '#232f2a', text: '#d5e2d9', accent: '#e3b04b', grid: '#29372f', green: '#7ccf7a', red: '#e06a5a' },
  ocean: { name: 'Ocean', bg: '#0f2027', surface: '#16303a', text: '#cfe6ec', accent: '#ffb86b', grid: '#18394a', green: '#5ee0b0', red: '#ff6b6b' },
  rosewood: { name: 'Rosewood', bg: '#211618', surface: '#2c1e21', text: '#ecd9db', accent: '#ff8a7a', grid: '#36262a', green: '#9ccf7c', red: '#ff5c5c' },
  daylight: { name: 'Daylight', bg: '#c9d0d6', surface: '#e9edf0', text: '#1f2a33', accent: '#e07a10', grid: '#d6dee4', green: '#3d9a2e', red: '#d23a32' },
  sky: { name: 'Sky', bg: '#b9cde0', surface: '#e6eef6', text: '#1b2b3c', accent: '#2f7de1', grid: '#d3e0ec', green: '#2e9a5a', red: '#d6453d' },
  paper: { name: 'Paper', bg: '#d8d2c6', surface: '#f3efe7', text: '#2b2621', accent: '#c4572e', grid: '#e7e1d5', green: '#5a8f2e', red: '#c23b2e' },
};

/** Accent swatches ("palettes"): each sets the accent and a highlight that sits well beside it. */
export const ACCENTS = [
  { name: 'Amber', accent: '#f2a03a', green: '#8fc653' },
  { name: 'Coral', accent: '#ff7a59', green: '#8fd18a' },
  { name: 'Rose', accent: '#f06292', green: '#7fd6a6' },
  { name: 'Violet', accent: '#b388ff', green: '#69d2a8' },
  { name: 'Azure', accent: '#4fa3ff', green: '#6fd08c' },
  { name: 'Cyan', accent: '#2ec4d6', green: '#a3d65c' },
  { name: 'Mint', accent: '#3ddc97', green: '#f2c14e' },
  { name: 'Lime', accent: '#b4d455', green: '#4fc3a1' },
  { name: 'Gold', accent: '#e9c46a', green: '#80c66a' },
  { name: 'Crimson', accent: '#e5484d', green: '#7cc98a' },
];

// ------------------------------------------------------------------ derivation
const BLACK = '#000000', WHITE = '#ffffff';

/** Every token, as { '--css-name': value }. */
export function deriveTokens(base) {
  const b = { mute: '#e08a35', solo: '#e3cf49', red: '#e5534b', green: '#8fc653', ...base };
  const dark = luminance(b.surface) < 0.3;
  const gridDark = luminance(b.grid) < 0.3;
  // "deep" is the direction of shadows and insets; in light themes it is the text colour, softened
  const deep = dark ? BLACK : mix(b.text, b.surface, 0.25);
  const lift = dark ? b.text : WHITE;
  const s = b.surface, txt = b.text;
  const g = b.grid, gInk = gridDark ? BLACK : mix(b.text, b.grid, 0.2), gk = gridDark ? 1 : 0.55;
  const onAccent = luminance(b.accent) > 0.35 ? mix(b.accent, BLACK, 0.86) : WHITE;
  const onGreen = luminance(b.green) > 0.35 ? mix(b.green, BLACK, 0.86) : WHITE;

  const t = {
    // surfaces
    bg: b.bg,
    surface: s,
    'surface-2': mix(s, txt, 0.06),
    'surface-3': mix(s, txt, 0.13),
    'surface-hover': mix(s, txt, 0.04),
    'surface-selected': mix(s, txt, 0.07),
    inset: dark ? mix(b.bg, BLACK, 0.15) : mix(s, WHITE, 0.55),
    'inset-2': dark ? mix(b.bg, BLACK, 0.3) : mix(b.bg, deep, 0.08),
    toolbar: mix(s, txt, 0.045),
    'menu-bg': dark ? mix(s, b.bg, 0.35) : mix(s, WHITE, 0.4),
    'title-bg': mix(s, txt, 0.02),
    'title-bg-active': mix(s, txt, 0.08),
    'shade-backdrop': alpha(dark ? mix(b.bg, BLACK, 0.6) : mix(b.text, BLACK, 0.4), 0.5),
    // lines
    line: dark ? mix(b.bg, BLACK, 0.35) : mix(b.bg, deep, 0.28),
    'line-soft': alpha(lift, dark ? 0.06 : 0.5),
    'line-faint': alpha(lift, dark ? 0.025 : 0.3),
    'border-hover': mix(s, txt, 0.27),
    dashed: mix(s, txt, 0.32),
    hover: alpha(dark ? txt : deep, dark ? 0.08 : 0.07),
    // text
    text: txt,
    'text-2': mix(txt, s, 0.15),
    'text-dim': mix(txt, s, 0.42),
    'text-muted': mix(txt, s, 0.6),
    'text-bright': dark ? mix(txt, WHITE, 0.7) : mix(txt, BLACK, 0.5),
    // accent
    accent: b.accent,
    'accent-hover': mix(b.accent, WHITE, 0.2),
    'accent-ink': onAccent,
    'accent-line': mix(b.accent, BLACK, 0.38),
    'accent-dim': alpha(b.accent, 0.35),
    'sel-fill': alpha(b.accent, 0.12),
    'sel-line': alpha(b.accent, 0.9),
    // status colours
    green: b.green,
    'green-ink': onGreen,
    'green-line': mix(b.green, BLACK, 0.42),
    'led-off': mix(s, b.green, dark ? 0.08 : 0.15),
    playhead: dark ? mix(b.green, WHITE, 0.2) : b.green,
    red: b.red,
    'red-ink': luminance(b.red) > 0.45 ? mix(b.red, BLACK, 0.86) : WHITE,
    'rec-idle': mix(b.red, s, 0.3),
    'rec-hover': mix(b.red, WHITE, 0.12),
    'rec-on': mix(b.red, '#ff3b30', 0.5),
    mute: b.mute,
    'mute-line': mix(b.mute, BLACK, 0.4),
    solo: b.solo,
    'solo-line': mix(b.solo, BLACK, 0.4),
    'on-status': mix(b.mute, BLACK, 0.86),
    // controls
    knob: mix(s, txt, 0.17),
    'knob-hover': mix(s, txt, 0.23),
    'knob-track': dark ? mix(b.bg, BLACK, 0.25) : mix(s, deep, 0.25),
    'knob-ptr': dark ? mix(txt, WHITE, 0.8) : mix(txt, BLACK, 0.2),
    'fader-cap': dark ? mix(txt, s, 0.25) : mix(s, WHITE, 0.6),
    'pad-off': mix(s, txt, 0.12),
    'pad-off-alt': mix(s, txt, 0.16),
    'pad-on': dark ? mix(txt, WHITE, 0.45) : mix(b.accent, s, 0.25),
    'pad-on-line': dark ? mix(txt, s, 0.55) : mix(b.accent, BLACK, 0.3),
    'scroll-thumb': alpha(dark ? txt : deep, dark ? 0.3 : 0.32),
    'scroll-thumb-hover': alpha(dark ? txt : deep, dark ? 0.52 : 0.55),
    'tooltip-bg': dark ? mix(b.bg, BLACK, 0.5) : mix(txt, BLACK, 0.2),
    'tooltip-text': dark ? mix(txt, WHITE, 0.7) : WHITE,
    // meters (signal colours stay recognisable in every theme)
    'meter-bg': dark ? mix(b.bg, BLACK, 0.55) : mix(txt, BLACK, 0.3),
    'meter-1': '#3f9a2a', 'meter-2': '#a6d838', 'meter-3': '#f1c232', 'meter-4': '#e5413a',
    // editor canvases (piano roll, playlist, automation)
    'grid-bg': mix(g, gInk, 0.14 * gk),
    'grid-a': g,
    'grid-b': mix(g, txt, 0.05),
    'grid-row-black': mix(g, gInk, gridDark ? 0.07 : 0.09),
    'grid-row-white': mix(g, txt, 0.045),
    'grid-line-row': mix(g, gInk, 0.07 * gk),
    'grid-line-edge': mix(g, gInk, 0.25 * gk),
    'grid-line-q': mix(g, txt, 0.03),
    'grid-scale-off': alpha(gridDark ? '#080e12' : gInk, gridDark ? 0.22 : 0.07),
    'key-bg': mix(g, gInk, 0.45 * gk),
    'grid-row-off': mix(g, gInk, gridDark ? 0.09 : 0.11),
    'grid-line-bar': mix(g, gInk, 0.62 * gk),
    'grid-line-beat': mix(g, gInk, 0.4 * gk),
    'grid-line-step': mix(g, gInk, 0.14 * gk),
    'grid-line-sub': mix(g, gInk, 0.04 * gk),
    'grid-line-oct': mix(g, gInk, 0.45 * gk),
    'grid-shade': alpha(gridDark ? '#080e12' : gInk, gridDark ? 0.38 : 0.12),
    'grid-scale': alpha(b.green, 0.1),
    'grid-edge': mix(g, gInk, 0.75 * gk),
    'grid-corner': mix(g, gInk, 0.3 * gk),
    'grid-vel-label': mix(g, gInk, 0.33 * gk),
    'ruler-a': mix(g, gInk, 0.12 * gk),
    'ruler-b': mix(g, gInk, 0.4 * gk),
    'ruler-text': mix(g, txt, 0.8),
    'ruler-text-dim': mix(g, txt, 0.5),
    'ruler-major': mix(g, txt, 0.55),
    'ruler-minor': mix(g, txt, 0.22),
    'ruler-tick': mix(g, txt, 0.12),
    'loop-fill': alpha(b.green, 0.09),
    'loop-bar': alpha(b.green, 0.55),
    'loop-bar-off': alpha(txt, 0.25),
    'key-white-a': '#e9eef1', 'key-white-b': mix('#c3ccd1', g, 0.1),
    'key-black-a': '#10171b', 'key-black-b': mix('#38464e', g, 0.2),
    'key-line': '#7d8b92', 'key-text': '#3b4a52',
    'key-down-a': mix(b.accent, WHITE, 0.25), 'key-down-b': b.accent,
    'kit-key': mix(txt, g, 0.15), 'kit-key-off': mix(g, gInk, 0.15 * gk),
    'note-muted': mix(g, txt, 0.3), 'note-muted-b': mix(g, txt, 0.38),
    'note-sel-outline': WHITE,
    'clip-muted': mix(s, txt, 0.3),
    automation: '#e9c46a',
    'wave-bg': dark ? mix(b.bg, BLACK, 0.3) : mix(s, deep, 0.1),
  };
  const out = {};
  for (const [k, v] of Object.entries(t)) out[`--${k}`] = v;
  return out;
}

/** Live tokens for canvas code, camelCased: T.gridLineBar, T.accent… (mutated in place on change). */
export const T = {};
const camel = (k) => k.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());

// ------------------------------------------------------------------ appearance state
const KEY = 'openstudio.appearance.v1';
const IMG_KEY = 'openstudio.wallpaper.custom';
export const DEFAULT_APPEARANCE = {
  theme: 'slate', // preset id, or 'custom'
  base: { ...THEMES.slate },
  wallpaper: { kind: 'none', value: null, fit: 'cover', dim: 0.25, blur: 0 },
};

class Appearance extends Emitter {
  constructor() {
    super();
    let saved;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    this.state = structuredClone(DEFAULT_APPEARANCE);
    if (saved?.base) this.state.base = { ...this.state.base, ...saved.base };
    if (saved?.theme) this.state.theme = saved.theme;
    if (saved?.wallpaper) this.state.wallpaper = { ...this.state.wallpaper, ...saved.wallpaper };
  }

  get base() { return this.state.base; }
  get wallpaper() { return this.state.wallpaper; }

  /** Custom wallpaper image (data URL) — stored on its own, it can be large. */
  get customImage() { try { return localStorage.getItem(IMG_KEY); } catch { return null; } }
  setCustomImage(dataUrl) {
    localStorage.setItem(IMG_KEY, dataUrl); // throws on quota; callers retry smaller
  }

  setTheme(id) {
    const preset = THEMES[id];
    if (!preset) return;
    this.state.theme = id;
    this.state.base = { ...preset };
    this.commit();
  }
  /** Change some base colours; the theme becomes "custom". */
  setBase(patch) {
    Object.assign(this.state.base, patch);
    delete this.state.base.name;
    this.state.theme = 'custom';
    this.commit();
  }
  setWallpaper(patch) {
    Object.assign(this.state.wallpaper, patch);
    this.commit({ colors: false });
  }
  reset() {
    this.state = structuredClone(DEFAULT_APPEARANCE);
    this.commit();
  }

  commit({ colors = true } = {}) {
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage full: still applies */ }
    this.apply({ colors });
  }

  apply({ colors = true } = {}) {
    if (colors) {
      const tokens = deriveTokens(this.state.base);
      const root = document.documentElement.style;
      for (const [k, v] of Object.entries(tokens)) { root.setProperty(k, v); T[camel(k)] = v; }
      document.documentElement.classList.toggle('theme-light', luminance(this.state.base.surface) >= 0.3);
    }
    this.applyWallpaper();
    this.emit('change', this.state);
  }

  applyWallpaper() {
    const desk = document.getElementById('desktop');
    if (!desk) return;
    let layer = desk.querySelector(':scope > .wallpaper');
    if (!layer) { layer = document.createElement('div'); layer.className = 'wallpaper'; desk.prepend(layer); }
    const w = this.state.wallpaper;
    const st = layer.style;
    st.background = '';
    st.backgroundImage = '';
    let image = null;
    if (w.kind === 'solid') st.background = w.value;
    else if (w.kind === 'gradient') st.background = w.value;
    else if (w.kind === 'preset') image = w.value;
    else if (w.kind === 'custom') image = this.customImage;
    if (image) {
      st.backgroundImage = `url("${image}")`;
      const fit = { cover: ['cover', 'no-repeat'], contain: ['contain', 'no-repeat'], tile: ['auto', 'repeat'], center: ['auto', 'no-repeat'] }[w.fit] || ['cover', 'no-repeat'];
      st.backgroundSize = fit[0];
      st.backgroundRepeat = fit[1];
      st.backgroundPosition = 'center';
    }
    layer.hidden = w.kind === 'none';
    const imgish = !!image || w.kind === 'gradient';
    st.filter = imgish && w.blur ? `blur(${w.blur}px)` : '';
    // blur bleeds transparent edges in; over-size the layer to hide them
    st.inset = imgish && w.blur ? `${-w.blur * 2}px` : '0';
    desk.style.setProperty('--wall-dim', String(imgish ? w.dim : 0));
  }
}

export const appearance = new Appearance();
