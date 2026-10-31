import { h, clamp } from '../util.js';
import { showMenu } from './menu.js';

let automationHandler = null;
export const setAutomationHandler = (fn) => { automationHandler = fn; };
let controllerHandler = null; // { learn(target), linked(target) -> text | null, unlink(target) }
export const setControllerHandler = (fn) => { controllerHandler = fn; };

/** Context menu for any automatable control. `target` is an automation target descriptor (or a function returning one). */
export function showAutomationMenu(e, target, extra = []) {
  e.preventDefault();
  const t = typeof target === 'function' ? target() : target;
  const linked = t && controllerHandler?.linked(t);
  showMenu([
    ...extra,
    { label: 'Create automation clip', disabled: !t || !automationHandler, action: () => automationHandler(t) },
    { label: 'Link to controller…', disabled: !t || !controllerHandler, action: () => controllerHandler.learn(t) },
    ...(linked ? [{ label: `Unlink controller (${linked})`, action: () => controllerHandler.unlink(t) }] : []),
  ], e.clientX, e.clientY);
}

/** Floating tooltip that follows the pointer (top-right of it), so hints never cover the control being hovered. */
let tipEl = null;
let tipX = 0;
let tipY = 0;
const placeTip = () => {
  if (!tipEl) return;
  const w = tipEl.offsetWidth;
  const hgt = tipEl.offsetHeight;
  const x = tipX + 14 + w > window.innerWidth - 4 ? tipX - 14 - w : tipX + 14;
  const y = tipY - 14 - hgt < 4 ? tipY + 18 : tipY - 14 - hgt;
  tipEl.style.left = `${Math.max(4, x)}px`;
  tipEl.style.top = `${y}px`;
};
window.addEventListener('pointermove', (e) => { tipX = e.clientX; tipY = e.clientY; placeTip(); }, true);

export const hint = {
  set(text) {
    if (!text) { tipEl?.remove(); tipEl = null; return; }
    if (!tipEl) {
      tipEl = h('div', { class: 'value-bubble' });
      document.body.append(tipEl);
    }
    tipEl.textContent = text;
    placeTip();
  },
  clear() { this.set(''); },
};

const A0 = -135;
const A1 = 135;
const SVGNS = 'http://www.w3.org/2000/svg';

const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function arc(cx, cy, r, d0, d1) {
  if (Math.abs(d1 - d0) < 0.01) return '';
  const [x0, y0] = polar(cx, cy, r, d0);
  const [x1, y1] = polar(cx, cy, r, d1);
  const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${d1 > d0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
const svg = (tag, attrs) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

let bubble = null;
function showBubble(x, y, text) {
  if (!bubble) { bubble = h('div', { class: 'value-bubble' }); document.body.append(bubble); }
  bubble.textContent = text;
  bubble.style.left = `${x + 14}px`;
  bubble.style.top = `${y - 28}px`;
  bubble.style.display = 'block';
}
const hideBubble = () => { if (bubble) bubble.style.display = 'none'; };

/**
 * opts: { value, min, max, def, size, log, bipolar, step, label, fmt, onChange, onStart, green }
 * Returns an element with .setValue(v) (silent) and .value
 */
export function createKnob(opts) {
  const { min = 0, max = 1, size = 28, log = false, bipolar = false, step = 0, label = '', fmt = (v) => v.toFixed(2), green = false } = opts;
  const def = opts.def ?? opts.value ?? min;
  let value = clamp(opts.value ?? def, min, max);

  const toNorm = (v) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromNorm = (t) => {
    let v = log ? min * Math.pow(max / min, t) : min + t * (max - min);
    if (step) v = Math.round(v / step) * step;
    return clamp(v, min, max);
  };

  const c = size / 2;
  const root = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  const track = svg('path', { class: 'k-track', 'stroke-width': 2, d: arc(c, c, c - 1.5, A0, A1) });
  const val = svg('path', { class: 'k-value', 'stroke-width': 2 });
  const body = svg('circle', { class: 'k-body', cx: c, cy: c, r: c - 4.5 });
  const ptr = svg('line', { class: 'k-ptr', 'stroke-width': 1.6, x1: c, y1: c - (c - 4.5) * 0.25, x2: c, y2: c - (c - 4.5) * 0.9 });
  root.append(track, val, body, ptr);

  const el = h('div', { class: `knob${green ? ' green' : ''}` });
  el.style.width = el.style.height = `${size}px`;
  el.append(root);

  const render = () => {
    const t = clamp(toNorm(value), 0, 1);
    const deg = A0 + t * (A1 - A0);
    ptr.setAttribute('transform', `rotate(${deg} ${c} ${c})`);
    const from = bipolar ? 0 : A0;
    val.setAttribute('d', arc(c, c, c - 1.5, from, deg));
  };
  render();

  const text = () => `${label ? `${label}: ` : ''}${fmt(value)}`;
  const set = (v, emit) => {
    v = clamp(step ? Math.round(v / step) * step : v, min, max);
    if (v === value) return;
    value = v;
    render();
    hint.set(text());
    if (emit) opts.onChange?.(value);
  };

  // one undo step per gesture: scrolling or double-clicking right after a drag doesn't add more
  let lastStart = -Infinity;
  const start = (coalesce) => {
    const now = performance.now();
    if (!coalesce || now - lastStart > 600) opts.onStart?.();
    lastStart = now;
  };

  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, t: toNorm(value) };
    start(false);
    showBubble(e.clientX, e.clientY, text());
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const sens = e.shiftKey ? 700 : 170;
    const t = clamp(drag.t + (drag.y - e.clientY) / sens, 0, 1);
    set(fromNorm(t), true);
    showBubble(e.clientX, e.clientY, text());
  });
  const end = () => { drag = null; hideBubble(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => { start(true); set(def, true); });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    start(true);
    const t = clamp(toNorm(value) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03), 0, 1);
    set(fromNorm(t), true);
  }, { passive: false });
  if (opts.target) el.addEventListener('contextmenu', (e) => showAutomationMenu(e, opts.target, [{ label: 'Reset to default', action: () => { start(false); set(def, true); } }]));
  el.addEventListener('pointerenter', () => hint.set(text()));
  el.addEventListener('pointerleave', () => { if (!drag) hint.clear(); });

  el.setValue = (v) => { value = clamp(v, min, max); render(); };
  Object.defineProperty(el, 'value', { get: () => value });
  return el;
}
