// Tiling window manager mode, modelled on niri: windows live in columns on a horizontally scrolling
// strip, a column stacks windows vertically, and everything is driven from the keyboard.
// On top of that it sizes things itself: each window type has a preferred orientation and
// content-aware ideal size, and the focused column / window grows to its ideal while the rest
// shrink towards their minimums — everything fits on screen when it can, and scrolls when it can't.
import { Emitter, clamp } from '../util.js';
import { isMenuOpen } from './menu.js';

const KEY = 'openstudio.tiling.v1';
const TITLE_H = 26;

// ------------------------------------------------------------------ window profiles
/** min: smallest usable size. ideal(W, H): size it wants given the desktop. fill: takes any spare room. */
export const PROFILES = {
  rack: {
    name: 'Channel rack', orient: 'wide', min: [420, 150],
    ideal: (win, W) => {
      // as tall as its rows, as wide as its step pads
      const sc = win.body.querySelector('.cr-scroll');
      if (!sc) return { w: 760, h: 300 };
      const rows = sc.querySelector('.cr-rows');
      const h = [...sc.children].reduce((a, c) => a + c.offsetHeight, 0) + 12 + TITLE_H;
      return { w: Math.min(W, (rows?.scrollWidth || 700) + 24), h };
    },
  },
  piano: { name: 'Piano roll', orient: 'wide', fill: true, min: [520, 280], ideal: (win, W, H) => ({ w: W, h: H }) },
  playlist: { name: 'Playlist', orient: 'wide', fill: true, min: [560, 260], ideal: (win, W, H) => ({ w: W, h: H }) },
  mixer: { name: 'Mixer', orient: 'wide', min: [520, 330], ideal: (win, W) => ({ w: Math.min(W, 1180), h: 500 }) },
  automation: { name: 'Automation', orient: 'wide', min: [420, 220], ideal: () => ({ w: 780, h: 340 }) },
  settings: {
    name: 'Channel settings', orient: 'square', min: [420, 220],
    ideal: (win) => {
      const b = win.body.querySelector('.cs-body') || win.body;
      const h = [...b.children].reduce((a, c) => a + c.offsetHeight, 0) + TITLE_H + 8;
      return { w: 640, h: Math.max(260, h) };
    },
  },
};
/** Canonical order for auto-arrange: the pattern tools, the song, then mixing. */
const ORDER = ['rack', 'piano', 'playlist', 'mixer', 'automation', 'settings'];
/** Where a newly opened window belongs: next to (or stacked with) the window it works with. */
const AFFINITY = { piano: 'rack', rack: 'piano', settings: 'rack', automation: 'playlist', mixer: 'playlist' };

/** Generic ideals for a user-chosen orientation. */
const ORIENT_IDEAL = {
  wide: (W, H) => ({ w: W * 0.9, h: H * 0.45 }),
  tall: (W, H) => ({ w: W * 0.38, h: H }),
  square: (W, H) => { const s = Math.min(W, H) * 0.8; return { w: s, h: s }; },
};

// ------------------------------------------------------------------ key bindings
export const MODIFIERS = { Alt: 'Alt', Super: 'Super', 'Ctrl+Alt': 'Ctrl+Alt', 'Ctrl+Shift': 'Ctrl+Shift' };

/** [id, label, default binds]. "Mod" is the configurable modifier. */
export const ACTIONS = [
  ['toggle-tiling', 'Switch tiling / floating mode', ['Mod+T']],
  ['focus-column-left', 'Focus column left', ['Mod+H', 'Mod+Left']],
  ['focus-column-right', 'Focus column right', ['Mod+L', 'Mod+Right']],
  ['focus-window-up', 'Focus window above', ['Mod+K']],
  ['focus-window-down', 'Focus window below', ['Mod+J']],
  ['focus-column-first', 'Focus first column', ['Mod+Home']],
  ['focus-column-last', 'Focus last column', ['Mod+End']],
  ['move-column-left', 'Move column left', ['Mod+Ctrl+H', 'Mod+Ctrl+Left']],
  ['move-column-right', 'Move column right', ['Mod+Ctrl+L', 'Mod+Ctrl+Right']],
  ['move-window-up', 'Move window up', ['Mod+Ctrl+K']],
  ['move-window-down', 'Move window down', ['Mod+Ctrl+J']],
  ['consume-or-expel-left', 'Move window into / out of column, left', ['Mod+[']],
  ['consume-or-expel-right', 'Move window into / out of column, right', ['Mod+]']],
  ['consume-into-column', 'Pull next column\'s window into this column', ['Mod+,']],
  ['expel-from-column', 'Push window out to its own column', ['Mod+.']],
  ['cycle-width', 'Cycle column width (auto, ⅓, ½, ⅔, full)', ['Mod+W']],
  ['width-down', 'Narrower column', ['Mod+-']],
  ['width-up', 'Wider column', ['Mod+=']],
  ['height-down', 'Shorter window', ['Mod+Shift+-']],
  ['height-up', 'Taller window', ['Mod+Shift+=']],
  ['reset-sizes', 'Back to automatic sizes', ['Mod+Shift+R']],
  ['maximize-column', 'Maximize column', ['Mod+F']],
  ['fullscreen-window', 'Fullscreen window', ['Mod+Shift+F']],
  ['center-column', 'Centre column', ['Mod+C']],
  ['close-window', 'Close window', ['Mod+Q']],
  ['auto-arrange', 'Re-arrange everything automatically', ['Mod+Shift+A']],
  ['open-rack', 'Open / focus channel rack', ['Mod+1']],
  ['open-piano', 'Open / focus piano roll', ['Mod+2']],
  ['open-playlist', 'Open / focus playlist', ['Mod+3']],
  ['open-mixer', 'Open / focus mixer', ['Mod+4']],
  ['open-settings', 'Open / focus channel settings', ['Mod+5']],
  ['toggle-browser', 'Show / hide the browser', ['Mod+B']],
  ['show-help', 'Show key bindings', ['Mod+Shift+/']],
];

/** App shortcuts that use modifiers, so the binding editor can flag clashes. */
const APP_SHORTCUTS = {
  'Alt+R': 'Piano roll: randomize velocity', 'Alt+Up': 'Channel rack: move channel up', 'Alt+Down': 'Channel rack: move channel down',
  'Alt+F8': 'Browser', 'Ctrl+Z': 'Undo', 'Ctrl+Y': 'Redo', 'Ctrl+S': 'Save', 'Ctrl+O': 'Open', 'Ctrl+N': 'New project',
  'Ctrl+R': 'Export audio', 'Ctrl+M': 'Metronome', 'Ctrl+L': 'Pattern / song mode', 'Ctrl+B': 'Duplicate', 'Ctrl+D': 'Deselect',
  'Ctrl+A': 'Select all', 'Ctrl+C': 'Copy', 'Ctrl+X': 'Cut', 'Ctrl+V': 'Paste', 'Ctrl+Q': 'Quantize', 'Ctrl+,': 'Settings',
  'Ctrl+Shift+S': 'Save as', 'Ctrl+Shift+P': 'New pattern', 'Ctrl+Up': 'Transpose octave', 'Ctrl+Down': 'Transpose octave',
};

const CODE_KEYS = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', BracketLeft: '[', BracketRight: ']',
  Comma: ',', Period: '.', Minus: '-', Equal: '=', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: '\'', Backquote: '`',
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Delete: 'Delete', Backspace: 'Backspace', Insert: 'Insert',
};
/** Physical key name of an event ("H", "1", "[", "Left", "F5"), or null for bare modifiers. */
export function keyName(e) {
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^Numpad\d$/.test(c)) return c.slice(6);
  if (/^F\d{1,2}$/.test(c)) return c;
  return CODE_KEYS[c] ?? null;
}
/** "Ctrl+Alt+Shift+Super+Key" in a fixed order. */
export function comboOf(e) {
  const k = keyName(e);
  if (!k) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super', k].filter(Boolean).join('+');
}
/** Resolve "Mod" and normalise modifier order. */
export function resolveCombo(bind, mod) {
  const parts = bind.replace(/^Mod(?=\+|$)/, mod).split('+');
  const key = parts.pop();
  const set = new Set(parts);
  return [set.has('Ctrl') && 'Ctrl', set.has('Alt') && 'Alt', set.has('Shift') && 'Shift', set.has('Super') && 'Super', key].filter(Boolean).join('+');
}

const DEFAULTS = {
  mode: 'floating',
  mod: 'Alt',
  gaps: 8,
  center: 'overflow', // 'never' (minimal scroll) | 'overflow' (centre when it doesn't fit) | 'always'
  grow: true, // the focused column / window grows to its ideal size
  animate: true,
  binds: Object.fromEntries(ACTIONS.map(([id, , b]) => [id, b])),
  orient: {}, // id -> 'auto' | 'wide' | 'tall' | 'square'
};

// ------------------------------------------------------------------ the tiler
export class Tiler extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.wm = app.wm;
    this.desk = this.wm.desktop;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    this.cfg = { ...structuredClone(DEFAULTS), ...(saved?.cfg || {}) };
    this.cfg.binds = { ...structuredClone(DEFAULTS.binds), ...(saved?.cfg?.binds || {}) };
    this.columns = saved?.columns || []; // [{ ids: [], active, width: null | { frac } , heights: { id: px } }]
    this.focus = saved?.focus || null;
    this.manual = !!saved?.manual; // the user has moved things themselves: stop re-arranging on open / close
    this.fullscreen = null;
    this.view = 0;
    this.pointerDown = false;
    this.pendingLayout = false;

    this.minimap = document.createElement('div');
    this.minimap.className = 'tile-map';
    this.desk.append(this.minimap);

    this._wire();
    if (this.cfg.mode === 'tiling') this.enter(false);
  }

  get active() { return this.cfg.mode === 'tiling'; }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ cfg: this.cfg, columns: this.columns, focus: this.focus, manual: this.manual })); } catch { /* ignore */ }
  }

  setConfig(patch) {
    Object.assign(this.cfg, patch);
    this.desk.classList.toggle('tile-anim', this.active && this.cfg.animate);
    this.save();
    if (this.active) this.layout();
    this.emit('config');
  }

  // ---------------------------------------------------------------- mode
  enter(animate = true) {
    this.cfg.mode = 'tiling';
    this.wm.tiling = true;
    this.desk.classList.add('tiling');
    this.desk.classList.toggle('tile-anim', false);
    if (!this.columns.length) this.arrange(false);
    this.sanitize();
    this.layout();
    // enable transitions after the first placement so windows don't fly in from their floating spots
    requestAnimationFrame(() => this.desk.classList.toggle('tile-anim', this.cfg.animate && animate !== null));
    this.save();
    this.emit('mode');
  }

  exit() {
    this.cfg.mode = 'floating';
    this.wm.tiling = false;
    this.fullscreen = null;
    this.desk.classList.remove('tiling', 'tile-anim');
    for (const w of this.wm.windows.values()) { w.el.classList.remove('tile-fullscreen'); w._apply(); }
    this.minimap.replaceChildren();
    this.save();
    this.emit('mode');
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  // ---------------------------------------------------------------- model helpers
  visibleIds() { return [...this.wm.windows.values()].filter((w) => w.visible).map((w) => w.id); }
  colOf(id) { return this.columns.findIndex((c) => c.ids.includes(id)); }
  win(id) { return this.wm.get(id); }

  /** Drop closed / unknown windows, add open ones that aren't placed yet. */
  sanitize() {
    const vis = new Set(this.visibleIds());
    for (const c of this.columns) c.ids = c.ids.filter((id) => vis.has(id) && this.wm.get(id));
    this.columns = this.columns.filter((c) => c.ids.length);
    for (const id of ORDER.concat([...vis])) if (vis.has(id) && this.colOf(id) < 0) this.insert(id, false);
    if (!this.focus || this.colOf(this.focus) < 0) this.focus = this.columns[0]?.ids[0] ?? null;
  }

  profile(id) {
    const base = PROFILES[id] || { name: id, orient: 'square', min: [320, 200], ideal: () => ({ w: 600, h: 400 }) };
    const o = this.cfg.orient[id];
    if (!o || o === 'auto' || o === base.orient) return base;
    return { ...base, orient: o, fill: false, ideal: (win, W, H) => ORIENT_IDEAL[o](W, H) };
  }

  /** Sizes of a window inside the current desktop. */
  sizes(id) {
    const { W, H } = this.area();
    const p = this.profile(id);
    const w = this.win(id);
    const ideal = p.ideal(w, W, H);
    const minW = Math.min(Math.max(p.min[0], w.minW || 0), W);
    const minH = Math.min(Math.max(p.min[1], 0), H);
    return {
      fill: !!p.fill, orient: p.orient,
      minW, minH,
      idealW: clamp(ideal.w, minW, W), idealH: clamp(ideal.h, minH, H),
    };
  }

  area() {
    const g = this.cfg.gaps;
    return { W: Math.max(200, this.desk.clientWidth - 2 * g), H: Math.max(150, this.desk.clientHeight - 2 * g), g };
  }

  /** Would `id` sit well stacked into column `c`? Only wide windows stack, and only if they all fit. */
  stacksWith(c, id) {
    if (!c || c.ids.length >= 3) return false;
    const ids = [...c.ids, id];
    if (ids.some((x) => this.profile(x).orient !== 'wide')) return false;
    // one big editor (piano roll, playlist) per column
    if (ids.filter((x) => this.profile(x).fill).length > 1) return false;
    const { H, g } = this.area();
    const need = ids.reduce((a, x) => { const s = this.sizes(x); return a + (s.fill ? s.minH * 1.5 : s.idealH); }, 0);
    return need + g * (ids.length - 1) <= H;
  }

  /**
   * Place a newly opened window: with its partner (piano roll by the channel rack…) when that's open,
   * otherwise by the focused window — stacked into that column if it fits, else in a new column beside it.
   */
  insert(id, focus = true) {
    if (this.colOf(id) >= 0) return;
    const partner = AFFINITY[id];
    const anchor = partner && this.colOf(partner) >= 0 ? partner : this.focus;
    const ai = anchor ? this.colOf(anchor) : -1;
    const target = this.columns[ai];
    if (target && this.stacksWith(target, id)) {
      // pattern tools read top-down: the rack sits above the piano roll
      const at = ORDER.indexOf(id) < ORDER.indexOf(anchor) ? target.ids.indexOf(anchor) : target.ids.indexOf(anchor) + 1;
      target.ids.splice(at, 0, id);
    } else {
      const col = { ids: [id], active: id, width: null, heights: {} };
      if (ai < 0) this.columns.push(col);
      else this.columns.splice(ORDER.indexOf(id) < ORDER.indexOf(anchor) && anchor === partner ? ai : ai + 1, 0, col);
    }
    if (focus) this.focus = id;
  }

  /** Lay everything out from scratch by the profiles. */
  arrange(relayout = true) {
    const vis = this.visibleIds();
    const ids = ORDER.filter((id) => vis.includes(id)).concat(vis.filter((id) => !ORDER.includes(id)));
    // sizes the user set survive on columns that keep the same windows
    const kept = new Map(this.columns.map((c) => [c.ids.join(','), c]));
    this.columns = [];
    this.manual = false;
    for (const id of ids) {
      const last = this.columns[this.columns.length - 1];
      if (last && this.stacksWith(last, id)) last.ids.push(id);
      else this.columns.push({ ids: [id], active: id, width: null, heights: {} });
    }
    for (const c of this.columns) {
      const old = kept.get(c.ids.join(','));
      if (old) { c.width = old.width; c.heights = old.heights || {}; c.active = old.active; }
    }
    if (!ids.includes(this.focus)) this.focus = ids[0] ?? null;
    this.view = 0;
    if (relayout) { this.layout(); this.save(); }
  }

  // ---------------------------------------------------------------- layout
  /**
   * Shares `avail` between items with {min, ideal, fill, fixed}; `focus` is the index that grows first.
   * 1. everything fits at ideal → ideal, spare room to fill items (or everyone, proportionally)
   * 2. minimums fit → focused item gets as close to ideal as it can, the rest share what's left
   * 3. even minimums don't fit → returns minimums (the caller scrolls) or squeezes (heights)
   */
  share(items, avail, focus) {
    const sumIdeal = items.reduce((a, s) => a + s.ideal, 0);
    const sumMin = items.reduce((a, s) => a + s.min, 0);
    if (sumIdeal <= avail) {
      const out = items.map((s) => s.ideal);
      const extra = avail - sumIdeal;
      const fill = items.map((s, i) => (s.fill && !s.fixed ? i : -1)).filter((i) => i >= 0);
      const growers = fill.length ? fill : items.map((s, i) => (s.fixed ? -1 : i)).filter((i) => i >= 0);
      const weight = growers.reduce((a, i) => a + items[i].ideal, 0) || 1;
      for (const i of growers) out[i] += (extra * items[i].ideal) / weight;
      return out;
    }
    if (sumMin <= avail) {
      const out = items.map((s) => s.min);
      let left = avail - sumMin;
      if (this.cfg.grow && focus >= 0) {
        const give = Math.min(left, items[focus].ideal - items[focus].min);
        out[focus] += give; left -= give;
      }
      const want = items.map((s, i) => (i === focus && this.cfg.grow ? 0 : s.ideal - s.min));
      const totalWant = want.reduce((a, b) => a + b, 0) || 1;
      items.forEach((s, i) => { out[i] += (left * want[i]) / totalWant; });
      return out;
    }
    return null;
  }

  layout() {
    if (!this.active) return;
    if (this.pointerDown) { this.pendingLayout = true; return; }
    this.pendingLayout = false;
    this.sanitize();
    const { W, H, g } = this.area();
    const fi = this.colOf(this.focus);

    // column widths
    const cols = this.columns.map((c) => {
      const s = c.ids.map((id) => this.sizes(id));
      let min = Math.max(...s.map((x) => x.minW));
      let ideal = Math.max(...s.map((x) => x.idealW));
      const fixed = c.width?.frac != null;
      if (fixed) { min = ideal = clamp(c.width.frac * W, Math.min(min, W), W); }
      return { min, ideal, fill: s.some((x) => x.fill), fixed, s };
    });
    const availW = W - g * (cols.length - 1);
    let widths = this.share(cols, availW, fi);
    const scrolling = !widths;
    if (scrolling) {
      // too many columns for the screen: the focused one gets its ideal (up to a screenful), others their minimum
      widths = cols.map((c, i) => (i === fi && (this.cfg.grow || c.fixed) ? c.ideal : c.min));
    }
    widths = widths.map((w) => Math.round(w));

    // strip positions and viewport
    const xs = [];
    let x = 0;
    widths.forEach((w) => { xs.push(x); x += w + g; });
    const stripW = x - g;
    if (stripW <= W) this.view = 0;
    else if (fi >= 0 && !this.freeView) {
      const cx = xs[fi], cw = widths[fi];
      const outside = cx < this.view || cx + cw > this.view + W;
      if (this.cfg.center === 'always' || (this.cfg.center === 'overflow' && outside) || this.centerOnce) this.view = cx + cw / 2 - W / 2;
      else if (cx < this.view) this.view = cx;
      else if (cx + cw > this.view + W) this.view = cx + cw - W;
    }
    this.view = clamp(this.view, 0, Math.max(0, stripW - W));
    this.centerOnce = false;

    // windows inside columns
    this.columns.forEach((c, ci) => {
      const items = c.ids.map((id, k) => {
        const s = cols[ci].s[k];
        const fixed = c.heights?.[id] != null;
        const v = fixed ? clamp(c.heights[id], s.minH, H) : null;
        return { id, min: fixed ? v : s.minH, ideal: fixed ? v : s.idealH, fill: s.fill, fixed };
      });
      const focusK = c.ids.indexOf(this.focus);
      const availH = H - g * (items.length - 1);
      // a big editor wants "everything the others don't need", so it never starves a short neighbour
      const fills = items.filter((it) => it.fill && !it.fixed);
      if (fills.length) {
        const rest = items.filter((it) => !fills.includes(it)).reduce((a, it) => a + it.ideal, 0);
        for (const it of fills) it.ideal = Math.max(it.min, (availH - rest) / fills.length);
      }
      let hs = this.share(items, availH, focusK);
      if (!hs) {
        // not even the minimums fit: squeeze everyone proportionally
        const sum = items.reduce((a, s) => a + s.min, 0);
        hs = items.map((s) => Math.max(TITLE_H + 40, (s.min * availH) / sum));
      }
      let y = g;
      c.ids.forEach((id, k) => {
        const hh = Math.round(hs[k]);
        this.win(id).setTileRect({ x: g + xs[ci] - this.view, y, w: widths[ci], h: hh });
        y += hh + g;
      });
    });

    // fullscreen sits over everything
    for (const w of this.wm.windows.values()) w.el.classList.toggle('tile-fullscreen', w.id === this.fullscreen && w.visible);
    if (this.fullscreen && this.win(this.fullscreen)?.visible) this.win(this.fullscreen).setTileRect({ x: 0, y: 0, w: this.desk.clientWidth, h: this.desk.clientHeight });

    for (const w of this.wm.windows.values()) w.el.classList.toggle('tile-focus', w.id === this.focus);
    if (this.focus) this.wm.bringToFront(this.win(this.focus));
    this.drawMinimap(xs, widths, stripW, scrolling || stripW > W);
  }

  /** A strip of column blocks under the desktop when it scrolls, like niri's overview at a glance. */
  drawMinimap(xs, widths, stripW, show) {
    this.minimap.hidden = !show;
    if (!show) { this.minimap.replaceChildren(); return; }
    const W = this.desk.clientWidth;
    const scale = Math.min(1, 220 / stripW);
    this.minimap.style.width = `${Math.round(stripW * scale)}px`;
    const blocks = this.columns.map((c, i) => {
      const b = document.createElement('button');
      b.className = `tile-map-col${c.ids.includes(this.focus) ? ' on' : ''}`;
      b.style.left = `${xs[i] * scale}px`;
      b.style.width = `${Math.max(3, widths[i] * scale)}px`;
      b.dataset.hint = c.ids.map((id) => this.profile(id).name).join(' + ');
      b.addEventListener('click', () => this.focusWindow(c.active && c.ids.includes(c.active) ? c.active : c.ids[0]));
      return b;
    });
    const view = document.createElement('div');
    view.className = 'tile-map-view';
    view.style.left = `${this.view * scale}px`;
    view.style.width = `${Math.min(stripW, W) * scale}px`;
    this.minimap.replaceChildren(...blocks, view);
  }

  // ---------------------------------------------------------------- actions
  focusWindow(id) {
    if (!id) return;
    const ci = this.colOf(id);
    if (ci < 0) return;
    this.focus = id;
    this.freeView = false;
    this.columns[ci].active = id;
    this.win(id).focus();
    this.layout();
    this.save();
  }

  focusColumn(i) {
    const c = this.columns[clamp(i, 0, this.columns.length - 1)];
    if (c) this.focusWindow(c.ids.includes(c.active) ? c.active : c.ids[0]);
  }

  run(action) {
    const fi = this.colOf(this.focus);
    const col = this.columns[fi];
    const k = col ? col.ids.indexOf(this.focus) : -1;
    const { W, H } = this.area();
    const open = (id) => { const w = this.win(id); if (!w.visible) w.show(); this.focusWindow(id); };
    const after = () => { this.layout(); this.save(); };
    // rearranging by hand: from now on new windows are inserted, not re-laid out
    if (/^(move|consume|expel)/.test(action)) this.manual = true;
    switch (action) {
      case 'toggle-tiling': this.toggle(); return;
      case 'focus-column-left': this.focusColumn(fi - 1); return;
      case 'focus-column-right': this.focusColumn(fi + 1); return;
      case 'focus-column-first': this.focusColumn(0); return;
      case 'focus-column-last': this.focusColumn(this.columns.length - 1); return;
      case 'focus-window-up': if (col && k > 0) this.focusWindow(col.ids[k - 1]); return;
      case 'focus-window-down': if (col && k < col.ids.length - 1) this.focusWindow(col.ids[k + 1]); return;
      case 'move-column-left':
      case 'move-column-right': {
        const j = fi + (action.endsWith('left') ? -1 : 1);
        if (!col || j < 0 || j >= this.columns.length) return;
        [this.columns[fi], this.columns[j]] = [this.columns[j], this.columns[fi]];
        after(); return;
      }
      case 'move-window-up':
      case 'move-window-down': {
        const j = k + (action.endsWith('up') ? -1 : 1);
        if (!col || j < 0 || j >= col.ids.length) return;
        [col.ids[k], col.ids[j]] = [col.ids[j], col.ids[k]];
        after(); return;
      }
      case 'consume-or-expel-left':
      case 'consume-or-expel-right': {
        if (!col) return;
        const left = action.endsWith('left');
        if (col.ids.length === 1) {
          // alone: join the neighbouring column
          const n = this.columns[fi + (left ? -1 : 1)];
          if (!n) return;
          n.ids.push(this.focus);
          this.columns.splice(fi, 1);
        } else {
          // stacked: leave for a new column on that side
          col.ids.splice(k, 1);
          if (col.active === this.focus) col.active = col.ids[0];
          this.columns.splice(left ? fi : fi + 1, 0, { ids: [this.focus], active: this.focus, width: null, heights: {} });
        }
        after(); return;
      }
      case 'consume-into-column': {
        const n = this.columns[fi + 1];
        if (!col || !n) return;
        col.ids.push(n.ids.shift());
        if (!n.ids.length) this.columns.splice(fi + 1, 1);
        after(); return;
      }
      case 'expel-from-column': {
        if (!col || col.ids.length < 2) return;
        col.ids.splice(k, 1);
        col.active = col.ids[Math.max(0, k - 1)];
        this.columns.splice(fi + 1, 0, { ids: [this.focus], active: this.focus, width: null, heights: {} });
        after(); return;
      }
      case 'cycle-width': {
        if (!col) return;
        const presets = [1 / 3, 1 / 2, 2 / 3, 1];
        const cur = this.win(this.focus).tileRect?.w / W || 0.5;
        if (col.width?.frac != null) {
          const i = presets.findIndex((p) => Math.abs(p - col.width.frac) < 0.01);
          col.width = i >= 0 && i < presets.length - 1 ? { frac: presets[i + 1] } : null; // after "full", back to auto
        } else {
          col.width = { frac: presets.find((p) => p > cur + 0.02) ?? presets[0] };
        }
        after(); return;
      }
      case 'width-down':
      case 'width-up': {
        if (!col) return;
        const cur = (this.win(this.focus).tileRect?.w ?? W / 2) / W;
        col.width = { frac: clamp(cur + (action === 'width-up' ? 0.1 : -0.1), 0.15, 1) };
        after(); return;
      }
      case 'height-down':
      case 'height-up': {
        if (!col || col.ids.length < 2) return;
        const cur = this.win(this.focus).tileRect?.h ?? H / 2;
        col.heights = { ...col.heights, [this.focus]: clamp(cur + (action === 'height-up' ? 0.1 : -0.1) * H, 60, H) };
        after(); return;
      }
      case 'reset-sizes': if (col) { col.width = null; col.heights = {}; } after(); return;
      case 'maximize-column':
        if (!col) return;
        if (col.width?.frac === 1) { col.width = col.prevWidth ?? null; delete col.prevWidth; } else { col.prevWidth = col.width; col.width = { frac: 1 }; }
        after(); return;
      case 'fullscreen-window': this.fullscreen = this.fullscreen === this.focus ? null : this.focus; after(); return;
      case 'center-column': this.centerOnce = true; this.layout(); return;
      case 'close-window': if (this.focus) this.win(this.focus).hide(); return;
      case 'auto-arrange': this.arrange(); return;
      case 'open-rack': open('rack'); return;
      case 'open-piano': open('piano'); return;
      case 'open-playlist': open('playlist'); return;
      case 'open-mixer': open('mixer'); return;
      case 'open-settings': this.app.actions.openChannelSettings(this.app.store.selectedChannel?.id); this.focusWindow('settings'); return;
      case 'toggle-browser': this.app.actions.toggleBrowser(); return;
      case 'show-help': this.app.actions.showShortcuts(); return;
      default:
    }
  }

  // ---------------------------------------------------------------- bindings
  /** combo -> action for the current modifier. */
  bindingMap() {
    const map = new Map();
    for (const [id] of ACTIONS) for (const b of this.cfg.binds[id] || []) map.set(resolveCombo(b, this.cfg.mod), id);
    return map;
  }

  /** Every resolved combo bound to more than one thing (another action or an app shortcut). */
  conflicts() {
    const seen = new Map();
    const out = new Map();
    for (const [id] of ACTIONS) {
      for (const b of this.cfg.binds[id] || []) {
        const c = resolveCombo(b, this.cfg.mod);
        if (seen.has(c) && seen.get(c) !== id) out.set(`${id}|${b}`, `Also bound to “${ACTIONS.find((a) => a[0] === seen.get(c))[1]}”`);
        else if (APP_SHORTCUTS[c]) out.set(`${id}|${b}`, `Replaces ${APP_SHORTCUTS[c]} in tiling mode`);
        seen.set(c, id);
      }
    }
    return out;
  }

  setBinds(id, binds) {
    this.cfg.binds = { ...this.cfg.binds, [id]: binds };
    this.save();
    this.emit('config');
  }

  resetBinds() {
    this.cfg.binds = structuredClone(DEFAULTS.binds);
    this.save();
    this.emit('config');
  }

  // ---------------------------------------------------------------- wiring
  _wire() {
    const wm = this.wm;
    wm.on('visibility', (w) => {
      if (!this.active) return;
      if (w.visible) {
        if (this.manual) this.insert(w.id); else this.arrange(false);
        this.focusWindow(w.id);
        return;
      }
      // closed: focus its neighbour, like niri
      const ci = this.colOf(w.id);
      const col = this.columns[ci];
      if (this.fullscreen === w.id) this.fullscreen = null;
      if (col) {
        const k = col.ids.indexOf(w.id);
        col.ids.splice(k, 1);
        if (this.focus === w.id) {
          this.focus = col.ids[Math.min(k, col.ids.length - 1)]
            ?? this.columns[ci + 1]?.ids[0] ?? this.columns[ci - 1]?.ids[0] ?? null;
        }
        if (!col.ids.length) this.columns.splice(ci, 1);
      }
      if (!this.manual) this.arrange(false);
      this.layout();
      this.save();
    });
    wm.on('focus', (w) => {
      if (!this.active || this.focus === w.id) return;
      this.focus = w.id;
      this.freeView = false;
      const ci = this.colOf(w.id);
      if (ci >= 0) this.columns[ci].active = w.id;
      this.layout();
      this.save();
    });
    wm.on('tile-maximize', (w) => { this.focusWindow(w.id); this.run('maximize-column'); });
    wm.on('desktop-resize', () => this.layout());
    // content changes that move an ideal size (channels added, pattern length…)
    this.app.store.on('channels', () => this.layout());
    this.app.store.on('project', () => this.layout());
    this.app.on('browser', () => requestAnimationFrame(() => this.layout()));

    // clicking into a window focuses it, but the resize waits until the button is released so
    // nothing moves under the pointer mid-click or mid-drag
    window.addEventListener('pointerdown', () => { this.pointerDown = true; }, true);
    const release = () => {
      this.pointerDown = false;
      if (this.pendingLayout) setTimeout(() => this.layout(), 0);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);

    // scroll the strip: wheel over title bars or the desktop gaps, or Mod+wheel anywhere
    this.desk.addEventListener('wheel', (e) => {
      if (!this.active) return;
      const onChrome = e.target === this.desk || e.target.closest?.('.win-title') || e.target.closest?.('.tile-map');
      const modHeld = this.cfg.mod.split('+').every((m) => ({ Alt: e.altKey, Ctrl: e.ctrlKey, Shift: e.shiftKey, Super: e.metaKey }[m]));
      if (!onChrome && !modHeld) return;
      e.preventDefault();
      e.stopPropagation();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (modHeld) { this.focusColumn(this.colOf(this.focus) + Math.sign(d)); return; }
      // free scroll: move the viewport without changing focus
      const { W } = this.area();
      const strip = this.columns.reduce((a, c) => a + (this.win(c.ids[0]).tileRect?.w || 0) + this.cfg.gaps, -this.cfg.gaps);
      this.view = clamp(this.view + d, 0, Math.max(0, strip - W));
      this.freeView = true; // until focus changes, don't pull the view back to the focused column
      this.layout();
    }, { passive: false, capture: true });

    window.addEventListener('keydown', (e) => {
      if (e.repeat && !/focus|width|height/.test(this.bindingMap().get(comboOf(e)) || '')) return;
      if (this.capturing) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (isMenuOpen() || document.querySelector('.modal-shade')) return;
      const combo = comboOf(e);
      if (!combo) return;
      const action = this.bindingMap().get(combo);
      if (!action) return;
      if (!this.active && action !== 'toggle-tiling') return;
      e.preventDefault();
      e.stopPropagation();
      this.run(action);
    }, true);
  }
}
