import { h, clamp, COLORS, faderToGain, fmtDb } from '../util.js';
import { icon } from './icons.js';
import { createKnob, hint, showAutomationMenu } from './knob.js';
import { showMenu } from './menu.js';
import { promptDialog } from './dialog.js';
import { MIXER_TRACKS } from '../state.js';
import { EFFECT_DEFS, defaultEffectParams } from '../audio/effects.js';
import { overlayScrollbars, wheelScrollsHorizontally } from './scrollbars.js';
import { T, appearance } from '../theme.js';

const METER_W = 12;
const THUMB_H = 16;

/** Fader position (0..1) for a dB value — the inverse of faderToGain. */
function dbToFader(db) {
  const g = Math.pow(10, db / 20);
  return g >= 1 ? 0.8 + (db / 6) * 0.2 : 0.8 * Math.pow(g, 1 / 2.5);
}
const SCALE_MARKS = [6, 0, -6, -12, -24, -48].map((db) => [db > 0 ? `+${db}` : String(db), dbToFader(db)]);
/** CSS offset from the bottom of the fader for a position; the thumb's centre travels the same line. */
const faderOffset = (v) => `calc(${v} * (100% - ${THUMB_H}px) + ${THUMB_H / 2}px)`;

export function createMixer(app) {
  const { store, wm, engine } = app;

  const win = wm.create({
    id: 'mixer', title: 'Mixer — Master', icon: 'mixer', minW: 520, minH: 330,
    rect: (dw, dh) => ({ x: 20, y: Math.max(20, dh - 490), w: Math.min(dw - 40, 1100), h: 470 }),
    visible: false,
  });

  const strips = [];
  const stripsEl = h('div', { class: 'mx-strips' });
  const masterHolder = h('div', { class: 'mx-master' });
  const fxPanel = h('div', { class: 'mx-fx' });
  win.body.classList.add('mx-body');
  const stripsScroll = h('div', { class: 'mx-scroll' }, stripsEl);
  const stripsPane = h('div', { class: 'mx-scroll-wrap' }, stripsScroll);
  win.body.append(masterHolder, stripsPane, fxPanel);
  overlayScrollbars(stripsScroll, { host: stripsPane, y: false });
  wheelScrollsHorizontally(stripsScroll);

  const mixer = () => store.project.mixer;
  const isRouted = (i) => i === 0 || store.project.channels.some((c) => c.mixer === i);

  // ------------------------------------------------------------------ strips
  function buildStrip(i) {
    const m = () => mixer()[i];
    const name = h('button', { class: 'mx-name', 'data-hint': 'Click to select · double-click to rename · right-click for options' }, i === 0 ? 'Master' : String(i));
    const label = h('div', { class: 'mx-label' }, m().name);
    name.addEventListener('click', () => select(i));
    name.addEventListener('dblclick', async () => {
      const v = await promptDialog('Rename mixer track', m().name);
      if (v && v.trim()) { store.checkpoint(); m().name = v.trim(); refreshLabels(); }
    });
    name.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      select(i);
      showMenu([
        { label: 'Rename…', action: () => name.dispatchEvent(new MouseEvent('dblclick')) },
        { label: 'Color', submenu: COLORS.map((c) => ({ label: ' ', swatch: c, action: () => { store.checkpoint(); m().color = c; refreshLabels(); } })) },
        { label: 'Reset', action: () => { store.checkpoint(); Object.assign(m(), { vol: 0.8, pan: 0, mute: false, solo: false, fx: m().fx.map(() => null), sends: {} }); engine.syncFx(i); store.emit('mixer'); renderFx(); } },
      ], e.clientX, e.clientY);
    });

    const pan = createKnob({
      value: m().pan, min: -1, max: 1, def: 0, size: 26, bipolar: true, label: 'Pan',
      fmt: (v) => (Math.abs(v) < 0.01 ? 'Centered' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`),
      onStart: () => store.checkpoint(),
      target: { kind: 'mixer', track: i, param: 'pan' },
      onChange: (v) => { m().pan = v; store.emit('mixer'); },
    });

    // fader
    const thumb = h('div', { class: 'mx-thumb' });
    const rail = h('div', { class: 'mx-rail' });
    const scale = h('div', { class: 'mx-scale' }, SCALE_MARKS.map(([t, v]) => h('span', { style: { bottom: faderOffset(v) } }, t)));
    const fader = h('div', { class: 'mx-fader', 'data-hint': 'Volume — drag, scroll or double-click to reset' }, rail, thumb);
    const setFaderUi = () => { thumb.style.bottom = `calc(${m().vol} * (100% - ${THUMB_H}px))`; };
    const setVol = (v) => {
      m().vol = clamp(v, 0, 1);
      setFaderUi();
      hint.set(`Track ${i}: ${fmtDb(faderToGain(m().vol))} dB`);
      store.emit('mixer');
    };
    let dragStart = null;
    fader.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      select(i);
      fader.setPointerCapture(e.pointerId);
      store.checkpoint();
      // relative drag (clicking never makes the level jump); Shift for fine control
      dragStart = { y: e.clientY, vol: m().vol, h: fader.getBoundingClientRect().height - THUMB_H };
    });
    fader.addEventListener('pointermove', (e) => {
      if (!dragStart) return;
      const d = (dragStart.y - e.clientY) / dragStart.h;
      setVol(dragStart.vol + d * (e.shiftKey ? 0.2 : 1));
      if (e.shiftKey) { dragStart = { y: e.clientY, vol: m().vol, h: dragStart.h }; }
    });
    fader.addEventListener('pointerup', () => { dragStart = null; });
    fader.addEventListener('pointercancel', () => { dragStart = null; });
    fader.addEventListener('dblclick', () => { store.checkpoint(); setVol(0.8); });
    fader.addEventListener('contextmenu', (e) => showAutomationMenu(e, { kind: 'mixer', track: i, param: 'vol' }));

    const meter = h('canvas', { class: 'mx-meter' });
    const db = h('div', { class: 'mx-db' }, '0.0');

    // the whole scale | fader | meter column takes the wheel, so it never scrolls the mixer by accident
    const faderWrap = h('div', { class: 'mx-fader-wrap' }, scale, fader, h('div', { class: 'mx-meter-box' }, meter));
    faderWrap.addEventListener('wheel', (e) => { e.preventDefault(); setVol(m().vol - Math.sign(e.deltaY) * 0.02); }, { passive: false });

    const muteBtn = h('button', { class: 'mx-btn mute', 'data-hint': 'Mute' }, 'M');
    const soloBtn = h('button', { class: 'mx-btn solo', 'data-hint': 'Solo' }, 'S');
    muteBtn.addEventListener('click', () => { store.checkpoint(); m().mute = !m().mute; refresh(); store.emit('mixer'); });
    soloBtn.addEventListener('click', () => { store.checkpoint(); m().solo = !m().solo; refresh(); store.emit('mixer'); });

    const el = h('div', { class: `mx-strip${i === 0 ? ' master' : ''}`, dataset: { track: i } },
      name, label, pan, h('div', { class: 'mx-btns' }, muteBtn, soloBtn),
      faderWrap, db);
    el.addEventListener('pointerdown', () => { if (store.project.selected.mixer !== i) select(i); });

    const s = { i, el, name, label, thumb, pan, muteBtn, soloBtn, db, meter, ctx: meter.getContext('2d'), mw: 0, mh: 0, level: [0, 0], hold: [0, 0], setFaderUi, active: false };
    const refresh = () => {
      const mm = m();
      s.pan.setValue(mm.pan);
      s.setFaderUi();
      muteBtn.classList.toggle('on', mm.mute);
      soloBtn.classList.toggle('on', mm.solo);
      el.classList.toggle('muted', mm.mute);
      db.textContent = fmtDb(faderToGain(mm.vol));
      s.active = isRouted(i);
      el.classList.toggle('routed', s.active);
      label.style.setProperty('--tc', mm.color || 'transparent');
    };
    s.refresh = refresh;
    refresh();
    return s;
  }

  function refreshLabels() {
    for (const s of strips) { s.label.textContent = mixer()[s.i].name; s.label.style.setProperty('--tc', mixer()[s.i].color || 'transparent'); }
    renderFx();
  }

  function build() {
    stripsEl.replaceChildren();
    masterHolder.replaceChildren();
    strips.length = 0;
    for (let i = 0; i < MIXER_TRACKS; i++) {
      const s = buildStrip(i);
      strips.push(s);
      (i === 0 ? masterHolder : stripsEl).append(s.el);
    }
    select(store.project.selected.mixer, true);
  }

  function select(i, silent) {
    store.project.selected.mixer = i;
    if (!silent) store.emit('mixerSelection');
    strips.forEach((s) => s.el.classList.toggle('selected', s.i === i));
    win.setTitle(`Mixer — ${mixer()[i].name}`);
    renderFx();
  }

  // ------------------------------------------------------------------ FX rack
  let openSlot = -1;
  function renderFx() {
    const i = store.project.selected.mixer;
    const track = mixer()[i];
    fxPanel.replaceChildren(h('div', { class: 'mx-fx-title' }, track.name, h('span', {}, 'Effects')));
    const list = h('div', { class: 'mx-slots' });
    track.fx.forEach((slot, k) => {
      const led = h('button', { class: `led${slot?.on ? ' on' : ''}`, 'data-hint': 'Enable / bypass effect' });
      led.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!slot) return;
        store.checkpoint();
        slot.on = !slot.on;
        engine.syncFx(i);
        renderFx();
      });
      const row = h('div', { class: `mx-slot${slot ? ' filled' : ''}${openSlot === k && slot ? ' open' : ''}`, 'data-hint': slot ? 'Click to edit · right-click to remove' : 'Click to add an effect' },
        led, h('span', { class: 'mx-slot-name' }, slot ? EFFECT_DEFS[slot.type].name : '(none)'));
      row.addEventListener('click', () => {
        if (!slot) {
          showMenu(Object.entries(EFFECT_DEFS).map(([type, def]) => ({
            label: def.name,
            action: () => {
              store.checkpoint();
              track.fx[k] = { type, params: defaultEffectParams(type), on: true };
              openSlot = k;
              engine.syncFx(i);
              renderFx();
              refreshActive();
            },
          })), row.getBoundingClientRect().left, row.getBoundingClientRect().bottom);
        } else { openSlot = openSlot === k ? -1 : k; renderFx(); }
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([
          ...(slot ? [
            { label: 'Remove effect', action: () => { store.checkpoint(); track.fx[k] = null; if (openSlot === k) openSlot = -1; engine.syncFx(i); renderFx(); } },
            { label: 'Move up', disabled: k === 0, action: () => moveSlot(k, -1) },
            { label: 'Move down', disabled: k === track.fx.length - 1, action: () => moveSlot(k, 1) },
            { separator: true },
          ] : []),
          ...Object.entries(EFFECT_DEFS).map(([type, def]) => ({
            label: `${slot ? 'Replace with' : 'Add'} ${def.name}`,
            action: () => { store.checkpoint(); track.fx[k] = { type, params: defaultEffectParams(type), on: true }; engine.syncFx(i); renderFx(); },
          })),
        ], e.clientX, e.clientY);
      });
      list.append(row);
    });
    fxPanel.append(list);

    fxPanel.append(sendsBlock(i, track));

    const slot = track.fx[openSlot];
    if (slot) {
      const def = EFFECT_DEFS[slot.type];
      const knobs = h('div', { class: 'mx-fx-params' });
      for (const meta of def.params) {
        if (meta.type === 'select') {
          const sel = h('button', { class: 'dd', 'data-hint': meta.label }, h('span', {}, slot.params[meta.key]), h('span', { class: 'caret' }, '▼'));
          sel.addEventListener('click', () => showMenu(meta.options.map((o) => ({ label: o, checked: slot.params[meta.key] === o, action: () => { store.checkpoint(); slot.params[meta.key] = o; engine.setEffectParam(i, openSlot, meta.key, o); renderFx(); } })), sel.getBoundingClientRect().left, sel.getBoundingClientRect().bottom));
          knobs.append(h('div', { class: 'mx-fx-param' }, sel, h('span', {}, meta.label)));
          continue;
        }
        const k = createKnob({
          value: slot.params[meta.key], min: meta.min, max: meta.max, def: meta.def, size: 34, log: meta.log, step: meta.step || 0, label: meta.label, fmt: meta.fmt,
          onStart: () => store.checkpoint(),
          target: { kind: 'fx', track: i, slot: openSlot, key: meta.key },
          onChange: (v) => { slot.params[meta.key] = v; engine.setEffectParam(i, openSlot, meta.key, v); store.dirty = true; },
        });
        knobs.append(h('div', { class: 'mx-fx-param' }, k, h('span', {}, meta.label)));
      }
      fxPanel.append(h('div', { class: 'mx-fx-edit' }, h('div', { class: 'mx-fx-edit-title' }, def.name), knobs));
    }
  }

  /** Swap an effect slot with its neighbour (automation targets follow the effect). */
  function moveSlot(k, dir) {
    const i = store.project.selected.mixer;
    const fx = mixer()[i].fx;
    const j = k + dir;
    if (j < 0 || j >= fx.length) return;
    store.checkpoint();
    [fx[k], fx[j]] = [fx[j], fx[k]];
    for (const a of store.project.automations) {
      const t = a.target;
      if (t.kind !== 'fx' || t.track !== i) continue;
      if (t.slot === k) t.slot = j; else if (t.slot === j) t.slot = k;
    }
    // the engine keys live effects by slot, so rebuild them in their new positions
    engine.resetFx(i);
    if (openSlot === k) openSlot = j; else if (openSlot === j) openSlot = k;
    renderFx();
  }

  function sendsBlock(i, track) {
    const box = h('div', { class: 'mx-sends' }, h('div', { class: 'mx-sub' }, i === 0 ? 'Output' : 'Sends'));
    if (i === 0) { box.append(h('div', { class: 'mx-send-note' }, 'The master track feeds the audio device.')); return box; }
    for (const [dest, level] of Object.entries(track.sends)) {
      const d = Number(dest);
      const knob = createKnob({
        value: level, min: 0, max: 1, def: 0.8, size: 22, label: 'Send level', fmt: (v) => `${fmtDb(faderToGain(v))} dB`,
        onStart: () => store.checkpoint(), onChange: (v) => { track.sends[d] = v; store.emit('mixer'); },
      });
      const remove = h('button', { class: 'mx-send-x', 'data-hint': 'Remove send' }, icon('close'));
      remove.addEventListener('click', () => { store.checkpoint(); delete track.sends[d]; store.emit('mixer'); renderFx(); });
      box.append(h('div', { class: 'mx-send' }, h('span', { class: 'mx-send-name' }, `→ ${mixer()[d].name}`), knob, remove));
    }
    const add = h('button', { class: 'btn mx-send-add' }, icon('plus'), 'Add send');
    add.addEventListener('click', () => {
      const r = add.getBoundingClientRect();
      const items = [];
      for (let d = 1; d < MIXER_TRACKS; d++) {
        if (track.sends[d] != null || store.wouldCycle(i, d)) continue;
        items.push({ label: mixer()[d].name, action: () => { store.checkpoint(); track.sends[d] = 0.8; store.emit('mixer'); renderFx(); } });
      }
      showMenu(items.length ? items.slice(0, 40) : [{ label: 'No available destinations', disabled: true }], r.left, r.bottom);
    });
    box.append(add);
    return box;
  }

  // ------------------------------------------------------------------ wiring
  const refreshActive = () => strips.forEach((s) => { s.active = isRouted(s.i); s.el.classList.toggle('routed', s.active); });
  store.on('project', () => { openSlot = -1; build(); });
  store.on('channels', refreshActive);
  store.on('mixer', () => { strips.forEach((s) => s.refresh()); });
  store.on('mixerSelection', () => select(store.project.selected.mixer, true));
  build();

  // Meters: the canvases stretch with the window, so match their backing store to the laid-out size
  const sizeMeters = () => {
    const dpr = window.devicePixelRatio || 1;
    for (const s of strips) {
      const hh = s.meter.clientHeight;
      if (!hh || (s.mh === hh && s.dpr === dpr)) continue;
      s.mw = METER_W; s.mh = hh; s.dpr = dpr;
      s.meter.width = Math.round(METER_W * dpr);
      s.meter.height = Math.round(hh * dpr);
      s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMeter(s, [0, 0]);
    }
  };
  win.on('resize', sizeMeters);
  win.on('show', sizeMeters);
  store.on('project', sizeMeters);
  appearance.on('change', () => strips.forEach((s) => drawMeter(s, [0, 0])));

  const drawMeter = (s, levels) => {
    const ctx = s.ctx;
    const w = s.mw, METER_H = s.mh;
    if (!METER_H) return;
    ctx.clearRect(0, 0, w, METER_H);
    ctx.fillStyle = T.meterBg;
    ctx.fillRect(0, 0, w, METER_H);
    const bw = (w - 3) / 2;
    for (let c = 0; c < 2; c++) {
      const lin = levels[c];
      const target = Math.min(1.25, lin);
      s.level[c] = target > s.level[c] ? target : s.level[c] * 0.88;
      s.hold[c] = Math.max(s.hold[c] * 0.995, s.level[c]);
      const dbv = 20 * Math.log10(Math.max(s.level[c], 0.00001));
      const frac = clamp((dbv + 60) / 66, 0, 1);
      const hh = frac * METER_H;
      const x = 1 + c * (bw + 1);
      const grad = ctx.createLinearGradient(0, METER_H, 0, 0);
      grad.addColorStop(0, T.meter1); grad.addColorStop(0.65, T.meter2); grad.addColorStop(0.88, T.meter3); grad.addColorStop(1, T.meter4);
      ctx.fillStyle = grad;
      ctx.fillRect(x, METER_H - hh, bw, hh);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (let y = 0; y < METER_H; y += 3) ctx.fillRect(x, y, bw, 1);
    }
  };

  function update() {
    if (!win.visible) return;
    for (const s of strips) {
      if (!s.active && s.i !== store.project.selected.mixer) {
        if (s.level[0] > 0.0005 || s.level[1] > 0.0005) { s.level = [0, 0]; drawMeter(s, [0, 0]); }
        continue;
      }
      drawMeter(s, engine.readLevels(s.i));
    }
  }

  return { win, update };
}
