import { h, Emitter, clamp, debounce } from '../util.js';
import { icon } from './icons.js';

const STORAGE_KEY = 'openstudio.layout.v1';
const TITLE_H = 24;

export class WindowManager extends Emitter {
  constructor(desktop) {
    super();
    this.desktop = desktop;
    this.windows = new Map();
    this.zTop = 10;
    this.saved = {};
    try { this.saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { this.saved = {}; }
    this.persist = debounce(() => this._persist(), 300);
    new ResizeObserver(() => { this.windows.forEach((w) => w.clampToDesktop()); this.emit('desktop-resize'); }).observe(desktop);
  }

  create(opts) {
    const w = new AppWindow(this, opts);
    this.windows.set(opts.id, w);
    return w;
  }

  get(id) { return this.windows.get(id); }

  _persist() {
    const out = {};
    for (const [id, w] of this.windows) out[id] = { x: w.x, y: w.y, w: w.w, h: w.h, visible: w.visible, max: w.maximized };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  }

  resetLayout() {
    localStorage.removeItem(STORAGE_KEY);
    this.saved = {};
    for (const w of this.windows.values()) w.applyDefault();
    this.persist();
  }

  bringToFront(win) {
    this.windows.forEach((w) => w.el.classList.toggle('active', w === win));
    win.el.style.zIndex = ++this.zTop;
    this.active = win;
  }
}

class AppWindow extends Emitter {
  constructor(mgr, opts) {
    super();
    this.mgr = mgr;
    this.id = opts.id;
    this.opts = opts;
    this.title = opts.title;
    this.visible = false;
    this.maximized = false;
    this.collapsed = false;
    this.minW = opts.minW ?? 260;
    this.minH = opts.minH ?? 120;
    this.defaultRect = opts.rect; // function(desktopW, desktopH) -> {x,y,w,h} or object
    this.defaultVisible = opts.visible ?? false;

    this.titleText = h('span', { class: 'win-title-text' }, opts.title);
    const btn = (name, hint, fn) => h('button', { class: 'win-btn', 'data-hint': hint, onClick: (e) => { e.stopPropagation(); fn(); } }, icon(name));
    this.titleEl = h('div', { class: 'win-title' },
      opts.icon ? h('span', { class: 'win-title-ico' }, icon(opts.icon)) : null,
      this.titleText,
      h('span', { class: 'win-title-extra' }),
      h('span', { class: 'win-btns' },
        btn('minimize', 'Minimize', () => this.toggleCollapse()),
        btn('maximize', 'Maximize', () => this.toggleMaximize()),
        btn('close', 'Close', () => this.hide())));
    this.body = h('div', { class: 'win-body' });
    this.el = h('div', { class: 'win hidden', 'data-win': opts.id, role: 'region', 'aria-label': opts.title }, this.titleEl, this.body);
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const handle = h('div', { class: `win-resize ${dir}` });
      handle.addEventListener('pointerdown', (e) => this._startResize(e, dir));
      this.el.append(handle);
    }
    mgr.desktop.append(this.el);

    this.el.addEventListener('pointerdown', () => this.focus(), true);
    this.titleEl.addEventListener('pointerdown', (e) => this._startDrag(e));
    this.titleEl.addEventListener('dblclick', () => this.toggleMaximize());

    new ResizeObserver(() => this.emit('resize')).observe(this.body);
    this.applyDefault(true);
  }

  get titleExtra() { return this.titleEl.querySelector('.win-title-extra'); }

  applyDefault(initial = false) {
    const dw = this.mgr.desktop.clientWidth;
    const dh = this.mgr.desktop.clientHeight;
    const saved = this.mgr.saved[this.id];
    const def = typeof this.defaultRect === 'function' ? this.defaultRect(dw, dh) : this.defaultRect || { x: 40, y: 40, w: 500, h: 360 };
    const r = initial && saved ? saved : def;
    this.maximized = false;
    this.collapsed = false;
    this.el.classList.remove('maximized', 'collapsed');
    if (r === def && dw && dh) {
      // default layouts open fully on screen, however small the window is
      const w = Math.min(r.w, Math.max(this.minW, dw)), hh = Math.min(r.h, Math.max(this.minH, dh));
      this.setRect(clamp(r.x, 0, Math.max(0, dw - w)), clamp(r.y, 0, Math.max(0, dh - hh)), w, hh);
    } else {
      this.setRect(r.x, r.y, r.w, r.h);
      // a saved layout may come from a bigger screen
      if (dw && dh) this.clampToDesktop();
    }
    const vis = initial && saved ? saved.visible : this.defaultVisible;
    if (vis) this.show(); else this.hide();
    if (initial && saved?.max) this.toggleMaximize();
  }

  setRect(x, y, w, hgt) {
    this.x = x; this.y = y; this.w = w; this.h = hgt;
    this._apply();
  }

  /** Placement from the tiling manager; the floating geometry (x, y, w, h) is left alone. */
  setTileRect(r) {
    this.tileRect = r;
    if (this.mgr.tiling) this._apply();
  }

  _apply() {
    const s = this.el.style;
    if (this.mgr.tiling && this.tileRect) {
      const r = this.tileRect;
      s.left = `${r.x}px`; s.top = `${r.y}px`; s.width = `${r.w}px`; s.height = `${r.h}px`;
      return;
    }
    s.left = `${this.x}px`;
    s.top = `${this.y}px`;
    s.width = `${this.w}px`;
    s.height = this.collapsed ? `${TITLE_H}px` : `${this.h}px`;
  }

  clampToDesktop() {
    if (this.maximized || this.mgr.tiling) return;
    const dw = this.mgr.desktop.clientWidth;
    const dh = this.mgr.desktop.clientHeight;
    this.w = Math.min(this.w, Math.max(this.minW, dw));
    this.h = Math.min(this.h, Math.max(this.minH, dh));
    this.x = clamp(this.x, 60 - this.w, dw - 60);
    this.y = clamp(this.y, 0, Math.max(0, dh - TITLE_H));
    this._apply();
  }

  setTitle(t) { this.title = t; this.titleText.textContent = t; this.el?.setAttribute('aria-label', t); }

  show() {
    if (this.visible) { this.focus(); return; }
    this.visible = true;
    this.el.classList.remove('hidden');
    this.focus();
    this.mgr.emit('visibility', this);
    this.emit('show');
    this.mgr.persist();
  }

  hide() {
    if (!this.visible && this.el.classList.contains('hidden')) return;
    this.visible = false;
    this.el.classList.add('hidden');
    this.mgr.emit('visibility', this);
    this.emit('hide');
    this.mgr.persist();
  }

  toggle() { this.visible ? this.hide() : this.show(); }

  focus() {
    this.mgr.bringToFront(this);
    this.emit('focus');
    this.mgr.emit('focus', this);
  }

  toggleCollapse() {
    if (this.mgr.tiling) return;
    this.collapsed = !this.collapsed;
    this.el.classList.toggle('collapsed', this.collapsed);
    this._apply();
  }

  toggleMaximize() {
    if (this.mgr.tiling) { this.mgr.emit('tile-maximize', this); return; }
    if (this.maximized) {
      this.maximized = false;
      this.el.classList.remove('maximized');
      this._apply();
    } else {
      this.collapsed = false;
      this.el.classList.remove('collapsed');
      this.maximized = true;
      this.el.classList.add('maximized');
    }
    this.focus();
    this.mgr.persist();
  }

  _startDrag(e) {
    if (e.button !== 0 || e.target.closest('.win-btn') || this.maximized || this.mgr.tiling) return;
    const sx = e.clientX, sy = e.clientY, ox = this.x, oy = this.y;
    this.titleEl.setPointerCapture(e.pointerId);
    this.el.classList.add('dragging');
    const move = (ev) => {
      const dw = this.mgr.desktop.clientWidth;
      const dh = this.mgr.desktop.clientHeight;
      this.x = clamp(ox + ev.clientX - sx, 60 - this.w, dw - 60);
      this.y = clamp(oy + ev.clientY - sy, 0, Math.max(0, dh - TITLE_H));
      this._apply();
    };
    const up = () => {
      this.titleEl.removeEventListener('pointermove', move);
      this.titleEl.removeEventListener('pointerup', up);
      this.titleEl.removeEventListener('pointercancel', up);
      this.el.classList.remove('dragging');
      this.mgr.persist();
    };
    this.titleEl.addEventListener('pointermove', move);
    this.titleEl.addEventListener('pointerup', up);
    this.titleEl.addEventListener('pointercancel', up);
  }

  _startResize(e, dir) {
    if (e.button !== 0 || this.maximized || this.collapsed || this.mgr.tiling) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const o = { x: this.x, y: this.y, w: this.w, h: this.h };
    const dw = this.mgr.desktop.clientWidth;
    const dh = this.mgr.desktop.clientHeight;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w, h: hh } = o;
      if (dir.includes('e')) w = clamp(o.w + dx, this.minW, dw * 2);
      if (dir.includes('s')) hh = clamp(o.h + dy, this.minH, dh * 2);
      if (dir.includes('w')) { w = clamp(o.w - dx, this.minW, dw * 2); x = o.x + (o.w - w); }
      if (dir.includes('n')) { hh = clamp(o.h - dy, this.minH, dh * 2); y = o.y + (o.h - hh); }
      this.setRect(x, Math.max(0, y), w, hh);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.mgr.persist();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }
}
