import { h, clamp, rgba } from '../util.js';
import { T, appearance } from '../theme.js';
import { showMenu } from './menu.js';
import { sizeCanvas } from './draw.js';
import { snapSize, snapRound } from './snap.js';
import { curveAt, describeTarget, formatTarget, normToValue, targetValid } from '../automation.js';
import { barSteps, beatSteps } from '../state.js';

const PAD_L = 46;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 24;

/** Floating editor for one automation clip's curve. */
export function createAutomationEditor(app) {
  const { store, wm } = app;
  const BAR = () => barSteps(store.project); // steps per bar / beat in the project's time signature
  const BEAT = () => beatSteps(store.project);
  const win = wm.create({
    id: 'automation', title: 'Automation', icon: 'fx', minW: 420, minH: 220,
    rect: (dw, dh) => ({ x: Math.max(20, dw / 2 - 330), y: Math.max(40, dh / 2 - 170), w: 660, h: 340 }),
    visible: false,
  });

  let autoId = null;
  const auto = () => store.automation(autoId);

  const title = h('span', { class: 'ae-title' }, '');
  const lenLabel = h('span', { class: 'ae-len' }, '');
  const lenDown = h('button', { class: 'tbtn small', 'data-hint': 'Shorter', onClick: () => setLen(-BAR()) }, '−');
  const lenUp = h('button', { class: 'tbtn small', 'data-hint': 'Longer', onClick: () => setLen(BAR()) }, '+');
  const flat = h('button', { class: 'btn', 'data-hint': 'Flatten the curve to its first value', onClick: () => flatten() }, 'Flatten');
  const toolbar = h('div', { class: 'pr-toolbar' }, title, h('div', { class: 'tb-flex' }), h('span', { class: 'ae-lbl' }, 'Length'), lenDown, lenLabel, lenUp, flat);
  const canvas = h('canvas', { class: 'ae-canvas' });
  const wrap = h('div', { class: 'ae-wrap' }, canvas);
  win.body.append(toolbar, wrap);
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  const plot = () => ({ x: PAD_L, y: PAD_T, w: W - PAD_L - PAD_R, h: H - PAD_T - PAD_B });
  const toX = (step) => plot().x + (step / auto().len) * plot().w;
  const toY = (v) => plot().y + (1 - v) * plot().h;
  const fromX = (px) => ((px - plot().x) / plot().w) * auto().len;
  const fromY = (py) => clamp(1 - (py - plot().y) / plot().h, 0, 1);

  function layout() {
    W = wrap.clientWidth; H = wrap.clientHeight;
    if (!W || !H) return;
    sizeCanvas(canvas, ctx, W, H);
    draw();
  }
  new ResizeObserver(layout).observe(wrap);
  appearance.on('change', () => { if (win.visible) draw(); });

  function draw() {
    const a = auto();
    if (!W || !a) { ctx.clearRect(0, 0, W, H); return; }
    const p = plot();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = T.gridBg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = T.gridA;
    ctx.fillRect(p.x, p.y, p.w, p.h);

    // vertical grid
    ctx.font = '10px "Noto Sans", sans-serif';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= a.len; s++) {
      const bar = s % BAR() === 0, beat = s % BEAT() === 0;
      if (!bar && !beat && p.w / a.len < 9) continue;
      const x = Math.round(toX(s)) + 0.5;
      ctx.strokeStyle = bar ? T.gridLineBar : beat ? T.gridLineBeat : T.gridLineStep;
      ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
      if (bar) { ctx.fillStyle = T.rulerMajor; ctx.fillText(String(s / BAR() + 1), x + 4, p.y + p.h + 6); }
    }
    // horizontal grid + value labels (real units)
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      const y = Math.round(toY(v)) + 0.5;
      ctx.strokeStyle = i === 0 || i === 4 ? T.gridLineBar : T.gridLineEdge;
      ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
      if (targetValid(store, a.target)) {
        ctx.fillStyle = T.rulerMajor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatTarget(store, a.target, normToValue(store, a.target, v)), p.x - 6, y);
        ctx.textAlign = 'left';
      }
    }

    // curve
    ctx.beginPath();
    for (let px = 0; px <= p.w; px += 2) {
      const v = curveAt(a.points, (px / p.w) * a.len);
      const x = p.x + px, y = toY(v);
      if (px === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = T.automation;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(p.x + p.w, p.y + p.h);
    ctx.lineTo(p.x, p.y + p.h);
    ctx.closePath();
    ctx.fillStyle = rgba(T.automation, 0.14);
    ctx.fill();
    ctx.lineWidth = 1;

    // points
    a.points.forEach((pt, i) => {
      const x = toX(pt.x), y = toY(pt.y);
      ctx.beginPath();
      ctx.arc(x, y, i === hover ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === hover ? T.noteSelOutline : T.automation;
      ctx.fill();
      ctx.strokeStyle = T.gridEdge;
      ctx.stroke();
    });
  }

  // ------------------------------------------------------------ editing
  let hover = -1;
  let drag = null;
  const pointAt = (e) => {
    const a = auto();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 10;
    a.points.forEach((pt, i) => { const d = Math.hypot(toX(pt.x) - mx, toY(pt.y) - my); if (d < bd) { bd = d; best = i; } });
    return { index: best, mx, my };
  };
  const touch = () => { store.dirty = true; store.emit('playlist'); draw(); };
  const sz = () => snapSize(app.ui.snap, plot().w / auto().len, BEAT(), BAR());

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const a = auto();
    const { index } = pointAt(e);
    if (index < 0) return;
    const pt = a.points[index];
    showMenu([
      { title: 'Segment after this point' },
      ...['linear', 'smooth', 'hold'].map((c) => ({ label: c[0].toUpperCase() + c.slice(1), checked: (pt.curve || 'linear') === c, action: () => { store.checkpoint(); pt.curve = c; touch(); } })),
      { separator: true },
      { label: 'Delete point', disabled: a.points.length <= 2, action: () => { store.checkpoint(); a.points.splice(index, 1); touch(); } },
    ], e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !auto()) return;
    const a = auto();
    canvas.setPointerCapture(e.pointerId);
    store.checkpoint();
    let { index, mx, my } = pointAt(e);
    if (index < 0) {
      const step = clamp(snapRound(fromX(mx), sz()), 0, a.len);
      const pt = { x: step, y: fromY(my) };
      a.points.push(pt);
      a.points.sort((p, q) => p.x - q.x);
      index = a.points.indexOf(pt);
    }
    drag = { index };
    hover = index;
    touch();
  });
  canvas.addEventListener('pointermove', (e) => {
    const a = auto();
    if (!a) return;
    const { index, mx, my } = pointAt(e);
    if (!drag) {
      if (index !== hover) { hover = index; draw(); }
      return;
    }
    const pt = a.points[drag.index];
    const lo = drag.index === 0 ? 0 : a.points[drag.index - 1].x;
    const hi = drag.index === a.points.length - 1 ? a.len : a.points[drag.index + 1].x;
    pt.x = drag.index === 0 ? 0 : clamp(snapRound(fromX(mx), sz()), lo, hi);
    pt.y = fromY(my);
    touch();
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function setLen(delta) {
    const a = auto();
    if (!a) return;
    const next = Math.max(BAR(), a.len + delta);
    if (next === a.len) return;
    store.checkpoint();
    const old = a.len;
    a.len = next;
    for (const c of store.project.playlist.clips) if (c.type === 'auto' && c.autoId === a.id && c.len === old) c.len = next;
    if (next < old) a.points = a.points.filter((p) => p.x <= next);
    if (a.points.length < 2) a.points.push({ x: next, y: a.points[0].y });
    refreshHeader();
    touch();
  }

  function flatten() {
    const a = auto();
    if (!a) return;
    store.checkpoint();
    a.points = [{ x: 0, y: a.points[0].y }, { x: a.len, y: a.points[0].y }];
    touch();
  }

  function refreshHeader() {
    const a = auto();
    if (!a) { title.textContent = ''; lenLabel.textContent = ''; return; }
    title.textContent = describeTarget(store, a.target);
    lenLabel.textContent = `${a.len / BAR()} bar${a.len / BAR() === 1 ? '' : 's'}`;
    win.setTitle(`Automation — ${describeTarget(store, a.target)}`);
  }

  function open(id) {
    autoId = id;
    refreshHeader();
    win.show();
    layout();
  }

  store.on('project', () => { if (!auto()) { autoId = null; win.hide(); } else { refreshHeader(); draw(); } });
  app.on('snap', draw);
  win.on('show', () => layout());
  return { open, win };
}
