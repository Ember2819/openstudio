// Effect window: the editor of one mixer effect slot, opened by clicking the slot (like FL Studio's plugin windows).
// Every effect gets its knobs; the parametric EQ adds a response graph with draggable bands over a live spectrum,
// and the spectrum analyser draws the spectrum of what passes through it.
import { h, clamp, rgba } from '../util.js';
import { createKnob, hint } from './knob.js';
import { showMenu } from './menu.js';
import { sizeCanvas } from './draw.js';
import { T, appearance } from '../theme.js';
import { EFFECT_DEFS, PEQ_BANDS, defaultEffectParams } from '../audio/effects.js';

const F_MIN = 20;
const F_MAX = 20000;
const DB_RANGE = 18; // EQ graph: ±18 dB
const SPEC_TOP = 0; // spectrum: 0 dBFS at the top …
const SPEC_BOTTOM = -90; // … -90 dB at the bottom
const GRID_FREQS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const BAND_COLORS = ['#9aa7b0', '#e2a33c', '#d8c24a', '#7fc36b', '#5fb8c9', '#6f8fe0', '#b38be0'];

export function createEffectWindow(app) {
  const { store, wm, engine } = app;
  const win = wm.create({
    id: 'effect', title: 'Effect', icon: 'mixer', minW: 380, minH: 220,
    rect: (dw, dh) => ({ x: Math.max(20, dw / 2 - 330), y: Math.max(30, dh / 2 - 250), w: 660, h: 440 }),
    visible: false,
  });

  let cur = null; // { track, slot, type }
  const knobs = new Map(); // param key -> knob
  const root = h('div', { class: 'fxw-root' });
  win.body.append(root);

  const slotOf = () => (cur ? store.project.mixer[cur.track]?.fx[cur.slot] ?? null : null);
  const live = () => (cur ? engine.fxInstances.get(`${cur.track}:${cur.slot}`)?.fx ?? null : null);

  function setParam(key, v) {
    const slot = slotOf();
    if (!slot) return;
    slot.params[key] = v;
    engine.setEffectParam(cur.track, cur.slot, key, v);
    store.dirty = true;
    knobs.get(key)?.setValue(v);
    graph.dirty = true;
  }

  // ------------------------------------------------------------------ graph (EQ / spectrum)
  const canvas = h('canvas', { class: 'fxw-graph' });
  const g = canvas.getContext('2d');
  const graph = { w: 0, h: 0, dirty: true, hover: -1, drag: null, resp: null, freqs: null, peaks: null };
  const xOfF = (f) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * graph.w;
  const fOfX = (x) => F_MIN * Math.pow(F_MAX / F_MIN, clamp(x / graph.w, 0, 1));
  const yOfDb = (db) => graph.h / 2 - (db / DB_RANGE) * (graph.h / 2 - 10);
  const dbOfY = (y) => ((graph.h / 2 - y) / (graph.h / 2 - 10)) * DB_RANGE;
  const ySpec = (db) => ((SPEC_TOP - db) / (SPEC_TOP - SPEC_BOTTOM)) * graph.h;

  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    graph.w = r.width;
    graph.h = r.height;
    sizeCanvas(canvas, g, r.width, r.height);
    graph.freqs = new Float32Array(Math.max(64, Math.round(r.width / 2)));
    for (let i = 0; i < graph.freqs.length; i++) graph.freqs[i] = fOfX((i / (graph.freqs.length - 1)) * r.width);
    graph.dirty = true;
  }).observe(canvas);

  /** Position of an EQ band's handle. */
  function bandPoint(i) {
    const p = slotOf().params;
    const n = i + 1;
    const type = PEQ_BANDS[i].type;
    const y = type === 'highpass' || type === 'lowpass' ? yOfDb(0) : yOfDb(p[`g${n}`]);
    return { x: clamp(xOfF(p[`f${n}`]), 8, graph.w - 8), y };
  }

  function drawSpectrum(an, fill, line) {
    if (!an) return;
    const bins = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(bins);
    const sr = engine.ctx.sampleRate;
    const tilt = slotOf().params.slope ?? 3; // dB per octave, so pink-ish music reads flat
    g.beginPath();
    g.moveTo(0, graph.h);
    let started = false;
    const step = Math.max(1, Math.floor(graph.w / 400));
    for (let x = 0; x <= graph.w; x += step) {
      const f0 = fOfX(x);
      const f1 = fOfX(x + step);
      const b0 = Math.max(1, Math.floor((f0 / sr) * an.fftSize));
      const b1 = Math.max(b0 + 1, Math.ceil((f1 / sr) * an.fftSize));
      let m = -Infinity;
      for (let b = b0; b < b1 && b < bins.length; b++) m = Math.max(m, bins[b]);
      if (!Number.isFinite(m)) m = SPEC_BOTTOM;
      const db = m + tilt * Math.log2(Math.max(20, f0) / 1000);
      const y = clamp(ySpec(db), 0, graph.h);
      if (!started) { g.lineTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.lineTo(graph.w, graph.h);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    if (line) { g.strokeStyle = line; g.lineWidth = 1; g.stroke(); }
  }

  function drawGrid(eq) {
    g.fillStyle = T.gridBg;
    g.fillRect(0, 0, graph.w, graph.h);
    g.font = '10px "Noto Sans", sans-serif';
    g.textBaseline = 'top';
    g.lineWidth = 1;
    for (const f of GRID_FREQS) {
      const x = Math.round(xOfF(f)) + 0.5;
      g.strokeStyle = T.gridLineBeat;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, graph.h); g.stroke();
      g.fillStyle = T.rulerTextDim;
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, graph.h - 13);
    }
    const marks = eq ? [-12, -6, 0, 6, 12] : [-12, -24, -36, -48, -60, -72];
    for (const db of marks) {
      const y = Math.round(eq ? yOfDb(db) : ySpec(db)) + 0.5;
      g.strokeStyle = db === 0 && eq ? T.gridLineBar : T.gridLineBeat;
      g.beginPath(); g.moveTo(0, y); g.lineTo(graph.w, y); g.stroke();
      g.fillStyle = T.rulerTextDim;
      g.fillText(`${db > 0 ? '+' : ''}${db}`, 4, y + 2);
    }
  }

  function drawEq() {
    const fx = live();
    drawGrid(true);
    drawSpectrum(fx?.analyser, rgba(T.text, 0.1), rgba(T.text, 0.18));
    if (!fx?.response || !graph.freqs) return;
    if (graph.dirty || !graph.resp) { graph.resp = fx.response(graph.freqs); graph.dirty = false; }
    const resp = graph.resp;
    // the band being edited, shaded under its own curve
    const focus = graph.drag?.band ?? graph.hover;
    if (focus >= 0) {
      const own = fx.response(graph.freqs, [focus]);
      g.beginPath();
      g.moveTo(0, yOfDb(0));
      own.forEach((db, i) => g.lineTo((i / (own.length - 1)) * graph.w, yOfDb(clamp(db - slotOf().params.out, -DB_RANGE * 2, DB_RANGE * 2))));
      g.lineTo(graph.w, yOfDb(0));
      g.closePath();
      g.fillStyle = rgba(BAND_COLORS[focus], 0.18);
      g.fill();
    }
    g.beginPath();
    resp.forEach((db, i) => {
      const x = (i / (resp.length - 1)) * graph.w;
      const y = yOfDb(clamp(db, -DB_RANGE * 1.5, DB_RANGE * 1.5));
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.strokeStyle = T.accent;
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 1;
    PEQ_BANDS.forEach((b, i) => {
      const { x, y } = bandPoint(i);
      const on = i === focus;
      g.beginPath();
      g.arc(x, y, on ? 7 : 6, 0, Math.PI * 2);
      g.fillStyle = BAND_COLORS[i];
      g.fill();
      g.strokeStyle = on ? T.textBright || '#fff' : 'rgba(0,0,0,.6)';
      g.lineWidth = on ? 2 : 1;
      g.stroke();
      g.fillStyle = '#10161b';
      g.font = '600 9px "Noto Sans", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i + 1), x, y + 0.5);
      g.textAlign = 'left';
    });
    g.lineWidth = 1;
  }

  function drawAnalyzer() {
    drawGrid(false);
    drawSpectrum(live()?.analyser, rgba(T.accent, 0.22), T.accent);
  }

  const bandAt = (x, y) => {
    let best = -1;
    let bd = 12;
    PEQ_BANDS.forEach((_, i) => {
      const p = bandPoint(i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const bandHint = (i) => {
    const p = slotOf().params;
    const n = i + 1;
    const b = PEQ_BANDS[i];
    const meta = EFFECT_DEFS.peq.params;
    const fmt = (k) => meta.find((m) => m.key === k).fmt(p[k]);
    hint.set(`${n}. ${b.label}: ${fmt(`f${n}`)}${p[`g${n}`] !== undefined ? `, ${fmt(`g${n}`)}` : ''}, ${b.type.endsWith('shelf') ? 'slope' : 'Q'} ${fmt(`q${n}`)}`);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (cur?.type !== 'peq' || e.button !== 0) return;
    const { x, y } = local(e);
    const band = bandAt(x, y);
    if (band < 0) return;
    canvas.setPointerCapture(e.pointerId);
    store.checkpoint();
    graph.drag = { band };
    bandHint(band);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (cur?.type !== 'peq') return;
    const { x, y } = local(e);
    if (!graph.drag) {
      const over = bandAt(x, y);
      if (over !== graph.hover) { graph.hover = over; canvas.style.cursor = over >= 0 ? 'grab' : 'default'; }
      if (over >= 0) bandHint(over);
      return;
    }
    const i = graph.drag.band;
    const n = i + 1;
    setParam(`f${n}`, Math.round(fOfX(x)));
    if (slotOf().params[`g${n}`] !== undefined) setParam(`g${n}`, Math.round(clamp(dbOfY(y), -DB_RANGE, DB_RANGE) * 10) / 10);
    bandHint(i);
  });
  const endDrag = () => { if (graph.drag) { graph.drag = null; hint.clear(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (!graph.drag) { graph.hover = -1; hint.clear(); } });
  canvas.addEventListener('wheel', (e) => {
    if (cur?.type !== 'peq') return;
    const { x, y } = local(e);
    const i = bandAt(x, y);
    if (i < 0) return;
    e.preventDefault();
    store.checkpoint();
    const key = `q${i + 1}`;
    setParam(key, Math.round(clamp(slotOf().params[key] * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.1, 18) * 100) / 100);
    bandHint(i);
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    if (cur?.type !== 'peq') return;
    const { x, y } = local(e);
    const i = bandAt(x, y);
    if (i < 0) return;
    store.checkpoint();
    const n = i + 1;
    const d = defaultEffectParams('peq');
    for (const k of [`f${n}`, `g${n}`, `q${n}`]) if (d[k] !== undefined) setParam(k, d[k]);
  });

  // ------------------------------------------------------------------ building
  function knobFor(meta, size = 34) {
    const slot = slotOf();
    const { track, slot: k } = cur;
    if (meta.type === 'track') {
      // a mixer track picker (sidechain key input)
      const name = (v) => `${v}. ${store.project.mixer[v]?.name ?? ''}`;
      const sel = h('button', { class: 'dd', 'data-hint': meta.label }, h('span', {}, name(slot.params[meta.key] ?? meta.def)), h('span', { class: 'caret' }, '▼'));
      sel.addEventListener('click', () => {
        const r = sel.getBoundingClientRect();
        const used = new Set(store.project.channels.map((c) => c.mixer));
        const items = [];
        for (let v = meta.min; v <= meta.max; v++) {
          if (v === track) continue;
          const m = store.project.mixer[v];
          if (!used.has(v) && /^Insert \d+$/.test(m.name) && v !== slot.params[meta.key]) continue; // unused inserts
          items.push({ label: name(v), checked: slot.params[meta.key] === v, action: () => { store.checkpoint(); setParam(meta.key, v); render(); } });
        }
        showMenu(items.length ? items : [{ label: 'No other mixer tracks in use', disabled: true }], r.left, r.bottom);
      });
      return h('div', { class: 'mx-fx-param' }, sel, h('span', {}, meta.label));
    }
    if (meta.type === 'select') {
      const sel = h('button', { class: 'dd', 'data-hint': meta.label }, h('span', {}, slot.params[meta.key] ?? meta.def), h('span', { class: 'caret' }, '▼'));
      sel.addEventListener('click', () => {
        const r = sel.getBoundingClientRect();
        showMenu(meta.options.map((o) => ({ label: o, checked: (slot.params[meta.key] ?? meta.def) === o, action: () => { store.checkpoint(); setParam(meta.key, o); render(); } })), r.left, r.bottom);
      });
      return h('div', { class: 'mx-fx-param' }, sel, h('span', {}, meta.label));
    }
    const knob = createKnob({
      value: slot.params[meta.key] ?? meta.def, min: meta.min, max: meta.max, def: meta.def, size, log: meta.log, step: meta.step || 0, label: meta.label, fmt: meta.fmt,
      bipolar: meta.min < 0 && meta.max > 0,
      onStart: () => store.checkpoint(),
      target: { kind: 'fx', track, slot: k, key: meta.key },
      onChange: (v) => setParam(meta.key, v),
    });
    knobs.set(meta.key, knob);
    return h('div', { class: 'mx-fx-param' }, knob, h('span', {}, meta.short ?? meta.label));
  }

  function render() {
    knobs.clear();
    root.replaceChildren();
    const slot = slotOf();
    if (!slot) return;
    const def = EFFECT_DEFS[slot.type];
    const trackName = store.project.mixer[cur.track].name;
    win.setTitle(`${trackName} — ${def.name}`);

    const power = h('button', { class: `led${slot.on ? ' on' : ''}`, 'data-hint': 'Enable / bypass' });
    power.addEventListener('click', () => { store.checkpoint(); slot.on = !slot.on; engine.syncFx(cur.track); store.emit('mixer'); render(); });
    const reset = h('button', { class: 'btn fxw-btn', 'data-hint': 'Back to the default settings' }, 'Reset');
    reset.addEventListener('click', () => {
      store.checkpoint();
      for (const [k, v] of Object.entries(defaultEffectParams(slot.type))) setParam(k, v);
      render();
    });
    root.append(h('div', { class: 'fxw-head' }, power, h('span', { class: 'fxw-name' }, def.name), h('span', { class: 'fxw-track' }, `${trackName} · slot ${cur.slot + 1}`), h('div', { class: 'tb-flex' }), reset));

    if (def.view === 'eq') {
      root.append(h('div', { class: 'fxw-graph-wrap' }, canvas));
      const bands = h('div', { class: 'fxw-bands' });
      PEQ_BANDS.forEach((b, i) => {
        const metas = def.params.filter((m) => m.band === i).map((m) => ({ ...m, short: m.key[0] === 'f' ? 'Freq' : m.key[0] === 'g' ? 'Gain' : m.label.endsWith('slope') ? 'Slope' : 'Q' }));
        bands.append(h('div', { class: 'fxw-band' },
          h('div', { class: 'fxw-band-name' }, h('i', { style: { background: BAND_COLORS[i] } }), b.label),
          metas.map((m) => knobFor(m, 28))));
      });
      bands.append(h('div', { class: 'fxw-band' }, h('div', { class: 'fxw-band-name' }, 'Output'), knobFor(def.params.find((m) => m.key === 'out'), 28)));
      root.append(bands);
    } else if (def.view === 'spectrum') {
      root.append(h('div', { class: 'fxw-graph-wrap tall' }, canvas));
      root.append(h('div', { class: 'mx-fx-params fxw-knobs' }, def.params.map((m) => knobFor(m))));
    } else {
      root.append(h('div', { class: 'mx-fx-params fxw-knobs' }, def.params.map((m) => knobFor(m))));
    }
    graph.dirty = true;
  }

  function open(track, slot) {
    const s = store.project.mixer[track]?.fx[slot];
    if (!s) return;
    cur = { track, slot, type: s.type };
    win.show();
    render();
  }

  // keep up with undo / redo and with edits made elsewhere (agents, the mixer, automation)
  const resync = () => {
    if (!cur) return;
    const slot = slotOf();
    if (!slot) { cur = null; win.hide(); return; }
    if (slot.type !== cur.type) { cur.type = slot.type; render(); return; }
    for (const [key, knob] of knobs) if (slot.params[key] !== undefined) knob.setValue(slot.params[key]);
    graph.dirty = true;
  };
  // undo / redo keep the window on its slot; opening or creating a project closes it
  store.on('project', (e) => { if (e?.history) resync(); else if (cur) { cur = null; win.hide(); } });
  store.on('mixer', resync);
  appearance.on('change', () => { graph.dirty = true; });

  function update() {
    if (!win.visible || !cur || !graph.w) return;
    if (cur.type === 'peq') drawEq();
    else if (cur.type === 'analyzer') drawAnalyzer();
  }

  return { win, open, update, current: () => cur };
}
