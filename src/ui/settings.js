import { h, noteName, rgba } from '../util.js';
import { detectOnsets, equalSlices } from '../audio/slicing.js';
import { guessRoot, spreadZones } from '../audio/zones.js';
import { icon } from './icons.js';
import { createKnob } from './knob.js';
import { showMenu } from './menu.js';
import { PARAM_META, ENGINES, ENGINE_PRESETS, defaultParams } from '../audio/instruments.js';
import { sizeCanvas } from './draw.js';
import { T, appearance } from '../theme.js';

const TYPE_LABEL = { drum: 'Drum voice', sampler: 'Sampler', sf: 'Instrument', ...Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.label])) };
const iconFor = (ch) => ({ drum: 'drum', sampler: 'sampler', organ: 'keys', pluck: 'wave', sfx: 'wave', sf: ch.bank === 128 ? 'drum' : 'piano' }[ch.type] || 'synth');

export function createSettings(app) {
  const { store, wm, engine, actions } = app;
  const win = wm.create({
    id: 'settings', title: 'Channel settings', icon: 'settings', minW: 420, minH: 220,
    rect: (dw, dh) => ({ x: Math.max(20, dw / 2 - 320), y: Math.max(40, dh / 2 - 190), w: 640, h: 360 }),
    visible: false,
  });
  win.body.classList.add('cs-body');

  let chId = null;
  let knobs = new Map(); // param key (or 'vol' / 'pan') -> knob, to follow changes made elsewhere
  const channel = () => store.channel(chId);

  function open(id) {
    chId = id ?? store.selectedChannel?.id ?? null;
    if (chId == null) return;
    render();
    win.show();
  }

  function touch() {
    store.dirty = true;
    store.emit('channelParams', chId);
  }

  function render() {
    const ch = channel();
    knobs = new Map();
    win.body.replaceChildren();
    if (!ch) { win.setTitle('Channel settings'); return; }
    win.setTitle(`Channel settings — ${ch.name}`);

    const nameBtn = h('button', { class: 'btn cs-name', style: { borderLeft: `4px solid ${ch.color}` } }, icon(iconFor(ch)), ch.name);
    nameBtn.addEventListener('click', () => actions.renameChannel(ch.id));

    const vol = createKnob({ value: ch.vol, min: 0, max: 1, def: 0.78, size: 38, label: 'Volume', target: { kind: 'channel', id: ch.id, param: 'vol' }, fmt: (v) => `${Math.round((v / 0.78) * 100)}%`, onStart: () => store.checkpoint(), onChange: (v) => { ch.vol = v; store.emit('channelMix'); } });
    const pan = createKnob({ value: ch.pan, min: -1, max: 1, def: 0, size: 38, bipolar: true, label: 'Panning', target: { kind: 'channel', id: ch.id, param: 'pan' }, fmt: (v) => (Math.abs(v) < 0.01 ? 'Centered' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`), onStart: () => store.checkpoint(), onChange: (v) => { ch.pan = v; store.emit('channelMix'); } });
    knobs.set('vol', vol);
    knobs.set('pan', pan);
    const head = h('div', { class: 'cs-head' },
      nameBtn,
      ch.type === 'sf' ? presetPicker(ch) : ENGINE_PRESETS[ch.type] ? enginePicker(ch) : h('span', { class: 'cs-type' }, ch.type === 'drum' ? `${TYPE_LABEL.drum} · ${ch.voice}` : TYPE_LABEL[ch.type]),
      h('div', { class: 'tb-flex' }),
      h('div', { class: 'cs-knob' }, vol, h('span', {}, 'Vol')),
      h('div', { class: 'cs-knob' }, pan, h('span', {}, 'Pan')));
    win.body.append(head);

    if (ch.type === 'sampler') win.body.append(samplerPanel(ch));

    const grid = h('div', { class: 'cs-grid' });
    for (const meta of PARAM_META[ch.type]) {
      if (meta.type === 'select') {
        const btn = h('button', { class: 'dd' }, h('span', {}, meta.labels?.[ch.params[meta.key]] ?? ch.params[meta.key]), h('span', { class: 'caret' }, '▼'));
        btn.addEventListener('click', () => {
          const r = btn.getBoundingClientRect();
          showMenu(meta.options.map((o) => ({ label: meta.labels?.[o] ?? o, checked: ch.params[meta.key] === o, action: () => { store.checkpoint(); ch.params[meta.key] = o; touch(); render(); } })), r.left, r.bottom);
        });
        grid.append(h('div', { class: 'cs-param' }, btn, h('span', {}, meta.label)));
      } else if (meta.type === 'toggle') {
        const b = h('button', { class: `btn cs-toggle${ch.params[meta.key] ? ' on' : ''}` }, ch.params[meta.key] ? 'On' : 'Off');
        b.addEventListener('click', () => { store.checkpoint(); ch.params[meta.key] = !ch.params[meta.key]; touch(); render(); });
        grid.append(h('div', { class: 'cs-param' }, b, h('span', {}, meta.label)));
      } else {
        const k = createKnob({
          value: ch.params[meta.key], min: meta.min, max: meta.max, def: meta.def, size: 42, log: meta.log, step: meta.step || 0,
          label: meta.label, fmt: meta.fmt, onStart: () => store.checkpoint(),
          target: { kind: 'chparam', id: ch.id, key: meta.key },
          onChange: (v) => { ch.params[meta.key] = v; touch(); },
        });
        knobs.set(meta.key, k);
        grid.append(h('div', { class: 'cs-param' }, k, h('span', {}, meta.label)));
      }
    }
    win.body.append(grid);
    // engines with many parameters (organ, FM, synth) need more room than the default window gives
    if (!wm.tiling) {
      const rows = Math.ceil(PARAM_META[ch.type].length / 6);
      const room = (document.getElementById('desktop')?.clientHeight ?? 700) - 24;
      const want = Math.min(room, 170 + rows * 90 + (ch.type === 'sampler' ? 150 + (ch.zones ? 42 : 0) : 0));
      if (win.h < want) win.setRect(win.x, Math.max(0, Math.min(win.y, room - want)), win.w, want);
    }

    const test = h('button', { class: 'btn cs-test' }, icon('play'), 'Test note');
    test.addEventListener('click', () => engine.preview(ch, 60, 0.85, 0.6));
    win.body.append(h('div', { class: 'cs-foot' }, test));
  }

  /** Preset chooser for SoundFont channels (instrument family → preset, or drum kit → piece). */
  function presetPicker(ch) {
    const cat = actions.catalog();
    const isDrum = ch.bank === 128;
    const kit = cat?.kits.find((k) => k.program === ch.program);
    const current = isDrum
      ? `${kit?.name ?? 'Drum kit'}${ch.fixedKey != null ? ` · ${kit?.pieces.find((p) => p.key === ch.fixedKey)?.name ?? ch.fixedKey}` : ''}`
      : (cat?.families.flatMap((f) => f.presets).find((p) => p.bank === ch.bank && p.program === ch.program)?.name ?? 'Instrument');
    const btn = h('button', { class: 'dd cs-preset', 'data-hint': 'Change the sound' }, h('span', {}, current), h('span', { class: 'caret' }, '▼'));
    btn.addEventListener('click', () => {
      if (!cat) return;
      const r = btn.getBoundingClientRect();
      const apply = (patch) => { store.checkpoint(); Object.assign(ch, patch); touchChannel(ch); };
      const items = isDrum
        ? cat.kits.map((k) => ({
            label: k.name,
            checked: k.program === ch.program,
            submenu: [
              ...(ch.fixedKey == null ? [] : []),
              ...k.pieces.filter((p) => p.key >= 27).map((p) => ({ label: p.name, checked: ch.fixedKey === p.key && k.program === ch.program, action: () => apply({ program: k.program, ...(ch.fixedKey != null ? { fixedKey: p.key, name: p.name } : {}) }) })),
            ],
          }))
        : cat.families.map((f) => ({
            label: f.name,
            submenu: f.presets.map((p) => ({ label: p.name, checked: p.bank === ch.bank && p.program === ch.program, action: () => apply({ bank: p.bank, program: p.program, name: p.name }) })),
          }));
      showMenu(items, r.left, r.bottom);
    });
    return btn;
  }

  /** Preset chooser for the built-in generators: replaces the channel's parameters with the preset's. */
  function enginePicker(ch) {
    const cats = ENGINE_PRESETS[ch.type];
    const all = Object.values(cats).flat();
    const same = (p) => Object.entries(p.params).every(([k, v]) => ch.params[k] === v);
    const current = all.find(same);
    const btn = h('button', { class: 'dd cs-preset', 'data-hint': `Load a ${TYPE_LABEL[ch.type].toLowerCase()} preset` }, h('span', {}, current?.name ?? `${TYPE_LABEL[ch.type]} · custom`), h('span', { class: 'caret' }, '▼'));
    btn.addEventListener('click', () => {
      const r = btn.getBoundingClientRect();
      showMenu(Object.entries(cats).map(([cat, list]) => ({
        label: cat,
        submenu: list.map((p) => ({
          label: p.name, checked: same(p),
          action: () => { store.checkpoint(); ch.params = { ...defaultParams(ch.type), ...p.params }; touch(); render(); engine.preview(ch, ch.type === 'sfx' ? 60 : /bass/i.test(cat) ? 48 : 60, 0.8, 0.8); },
        })),
      })), r.left, r.bottom);
    });
    return btn;
  }

  function touchChannel(ch) {
    store.emit('channels');
    engine.preview(ch, ch.fixedKey != null || ch.bank === 128 ? (ch.rootPitch ?? 60) : 60, 0.8, 0.8);
  }

  function samplerPanel(ch) {
    const s = store.samples.get(ch.sampleId);
    const canvas = h('canvas', { class: 'cs-wave', 'data-hint': 'Drag the start / end (and loop) markers. With slices: click a slice to hear it, drag a line to move it, double-click to add one, right-click a line to remove it.' });
    const load = h('button', { class: 'btn' }, icon('open'), s ? s.name : 'Load sample…');
    load.addEventListener('click', async () => {
      const files = await window.studioAPI.openSamples();
      if (!files.length) return;
      store.checkpoint();
      ch.sampleId = store.addSample(files[0].name, files[0].data);
      ch.name = files[0].name.replace(/\.[^.]+$/, '');
      delete ch.slices;
      delete ch.zones; // a new single sample
      store.emit('channels');
      render();
    });
    const root = h('button', { class: 'dd', 'data-hint': 'Root note: the key that plays the sample at its own pitch (with slices: the key of the first slice)' }, h('span', {}, `Root ${noteName(ch.rootPitch ?? 60)}`), h('span', { class: 'caret' }, '▼'));
    root.addEventListener('click', () => {
      const r = root.getBoundingClientRect();
      showMenu([3, 4, 5, 6].map((oct) => ({ label: `Octave ${oct}`, submenu: Array.from({ length: 12 }, (_, k) => oct * 12 + k).map((p) => ({ label: noteName(p), checked: ch.rootPitch === p, action: () => { store.checkpoint(); ch.rootPitch = p; touch(); store.emit('channels'); render(); } })) })), r.left, r.bottom);
    });
    const sliceBtn = h('button', { class: 'dd', 'data-hint': 'Chop the sample into slices played from the root key up (like FL Studio\'s Slicex)' }, h('span', {}, ch.slices?.length ? `${ch.slices.length} slices` : 'Slice'), h('span', { class: 'caret' }, '▼'));
    sliceBtn.addEventListener('click', () => {
      const r = sliceBtn.getBoundingClientRect();
      const ready = !!s?.buffer;
      showMenu([
        { label: 'Auto-slice at the hits', disabled: !ready, action: () => sliceAuto(ch, 0.5) },
        { label: 'Auto-slice (more slices)', disabled: !ready, action: () => sliceAuto(ch, 0.85) },
        { label: 'Auto-slice (fewer slices)', disabled: !ready, action: () => sliceAuto(ch, 0.2) },
        { label: 'Equal slices', disabled: !ready, submenu: [2, 4, 8, 16, 32].map((n) => ({ label: `${n}`, action: () => setSlices(ch, equalSlices(n)) })) },
        { separator: true },
        { label: 'Slices → pattern (plays the loop in time)', disabled: !ch.slices?.length, action: () => actions.slicesToPattern(ch.id) },
        { label: 'Clear slices', disabled: !ch.slices?.length, action: () => setSlices(ch, null) },
      ], r.left, r.bottom);
    });
    const zoned = ch.zones?.length > 0;
    const zonesBtn = h('button', { class: 'dd', 'data-hint': 'Multi-sample: map several samples across the keyboard, each from its own root key (sampled pianos, strings, kits)' }, h('span', {}, zoned ? `${ch.zones.length} zones` : 'Zones'), h('span', { class: 'caret' }, '▼'));
    zonesBtn.addEventListener('click', () => {
      const r = zonesBtn.getBoundingClientRect();
      showMenu([
        { label: 'Add samples as zones…', action: () => addZones(ch) },
        { label: 'Re-map key ranges from the roots', disabled: !zoned, action: () => setZones(ch, spreadZones(ch.zones)) },
        { label: 'Clear zones', disabled: !zoned, action: () => setZones(ch, null) },
      ], r.left, r.bottom);
    });
    // with zones each sample has its own root, and slicing is for single samples
    const tools = h('div', { class: 'cs-sampler-tools' }, load, ...(zoned ? [] : [root, sliceBtn]), zonesBtn);
    const wrap = h('div', { class: 'cs-sampler' }, canvas, tools);
    requestAnimationFrame(() => drawWave(canvas, s, ch));
    waveInteraction(canvas, s, ch);
    if (zoned) {
      const map = h('canvas', { class: 'cs-keymap', 'data-hint': 'Zones across the keyboard — click to hear a key, right-click a zone to change its root or velocity range or remove it' });
      wrap.insertBefore(map, tools);
      requestAnimationFrame(() => drawKeymap(map, ch));
      keymapInteraction(map, ch);
    }
    return wrap;
  }

  function setZones(ch, zones) {
    store.checkpoint();
    if (zones?.length) ch.zones = zones; else delete ch.zones;
    if (zones?.length && !zones.some((z) => z.sampleId === ch.sampleId)) ch.sampleId = zones[0].sampleId; // the waveform shows a zone in use
    touch();
    store.emit('channels');
    render();
  }

  const monoOf = (b) => {
    const mono = new Float32Array(b.length);
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / b.numberOfChannels; }
    return mono;
  };

  /** Load samples as zones: roots come from the file names (checked by ear) and the key ranges meet halfway. */
  async function addZones(ch) {
    const files = await window.studioAPI.openSamples();
    if (!files.length) return;
    const zones = ch.zones?.map((z) => ({ ...z })) ?? [];
    if (!zones.length && ch.sampleId != null) {
      // the sample already loaded becomes the first zone
      const s = store.samples.get(ch.sampleId);
      const b = await engine.ensureSample(ch.sampleId).catch(() => null);
      const root = (ch.rootPitch ?? 60) !== 60 || !s ? (ch.rootPitch ?? 60) : guessRoot(s.name, b && monoOf(b), b?.sampleRate ?? 44100, 60);
      zones.push({ sampleId: ch.sampleId, root });
    }
    for (const f of files) {
      const id = store.addSample(f.name, f.data);
      const b = await engine.ensureSample(id).catch(() => null);
      zones.push({ sampleId: id, root: guessRoot(f.name, b && monoOf(b), b?.sampleRate ?? 44100, 60) });
    }
    ch.sampleId ??= zones[0].sampleId;
    if (!ch.zones && files.length > 1 && /^Sampler( \d+)?$/.test(ch.name)) ch.name = files[0].name.replace(/[\s_-]*[a-g](#|b)?-?\d?\.[^.]+$/i, '') || ch.name;
    delete ch.slices;
    setZones(ch, spreadZones(zones));
  }

  const KEY_LO = 21; // A0 .. C8: the piano range is what the strip shows
  const KEY_HI = 108;
  function drawKeymap(canvas, ch) {
    const w = canvas.clientWidth || 560;
    const hh = 34;
    const ctx = canvas.getContext('2d');
    sizeCanvas(canvas, ctx, w, hh);
    const kw = w / (KEY_HI - KEY_LO + 1);
    const xOf = (k) => (Math.max(KEY_LO, Math.min(KEY_HI + 1, k)) - KEY_LO) * kw;
    ctx.fillStyle = T.waveBg;
    ctx.fillRect(0, 0, w, hh);
    // the keyboard along the bottom
    for (let k = KEY_LO; k <= KEY_HI; k++) {
      const black = [1, 3, 6, 8, 10].includes(k % 12);
      ctx.fillStyle = black ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.75)';
      ctx.fillRect(xOf(k) + 0.5, hh - 9, Math.max(1, kw - 1), 9);
    }
    ctx.font = '10px "Noto Sans", sans-serif';
    ctx.textBaseline = 'top';
    ch.zones.forEach((z, i) => {
      const x0 = xOf(z.lo), x1 = xOf(z.hi + 1);
      if (x1 <= x0) return;
      const layered = z.vlo != null || z.vhi != null;
      const top = layered ? 2 + (1 - (z.vhi ?? 1)) * 20 : 2;
      const bottom = layered ? 2 + (1 - (z.vlo ?? 0)) * 20 : 22;
      ctx.fillStyle = rgba(ch.color, i % 2 ? 0.45 : 0.7);
      ctx.fillRect(x0 + 0.5, top, x1 - x0 - 1, bottom - top);
      const rx = xOf(z.root) + kw / 2;
      ctx.fillStyle = T.text;
      ctx.fillRect(Math.round(rx), top, 1, bottom - top);
      if (x1 - x0 > 28 && (z.vhi ?? 1) >= 1) ctx.fillText(noteName(z.root), x0 + 3, top + 1); // one label per stack of layers
    });
  }

  function keymapInteraction(canvas, ch) {
    const keyAt = (e) => { const r = canvas.getBoundingClientRect(); return Math.round(KEY_LO - 0.5 + ((e.clientX - r.left) / r.width) * (KEY_HI - KEY_LO + 1)); };
    const zoneAt = (e) => { const k = keyAt(e); return ch.zones.find((z) => k >= z.lo && k <= z.hi); };
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) engine.preview(ch, keyAt(e), 0.85, 1.2); });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const z = zoneAt(e);
      if (!z) return;
      const i = ch.zones.indexOf(z);
      const edit = (fn) => { const zones = ch.zones.map((x) => ({ ...x })); fn(zones[i], zones); setZones(ch, zones.filter(Boolean)); };
      const name = store.samples.get(z.sampleId)?.name ?? 'Zone';
      showMenu([
        { label: name, disabled: true },
        { label: 'Root note', submenu: [1, 2, 3, 4, 5, 6, 7].map((oct) => ({ label: `Octave ${oct}`, submenu: Array.from({ length: 12 }, (_, k) => oct * 12 + k).map((p) => ({ label: noteName(p), checked: z.root === p, action: () => edit((x) => { x.root = p; }) })) })) },
        { label: 'Velocity', submenu: [['All velocities', null, null], ['Soft (0–50%)', 0, 0.5], ['Hard (50–100%)', 0.5, 1]].map(([label, lo, hi]) => ({ label, checked: (z.vlo ?? null) === lo && (z.vhi ?? null) === hi, action: () => edit((x) => { if (lo == null) { delete x.vlo; delete x.vhi; } else { x.vlo = lo; x.vhi = hi; } }) })) },
        { label: 'Remove zone', disabled: ch.zones.length < 2, action: () => edit((_, zones) => { zones[i] = null; }) },
      ], e.clientX, e.clientY);
    });
  }

  function setSlices(ch, slices) {
    store.checkpoint();
    if (slices?.length) ch.slices = slices; else delete ch.slices;
    touch();
    render();
  }

  function sliceAuto(ch, sensitivity) {
    const s = store.samples.get(ch.sampleId);
    if (!s?.buffer) return;
    const b = s.buffer;
    const mono = new Float32Array(b.length);
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / b.numberOfChannels; }
    setSlices(ch, detectOnsets(mono, b.sampleRate, { sensitivity }));
  }

  /** Markers on the waveform: start / end / loop points, or slice lines. */
  function waveInteraction(canvas, s, ch) {
    let drag = null;
    const fracAt = (e) => { const r = canvas.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    const near = (e, f) => Math.abs((fracAt(e) - f) * canvas.getBoundingClientRect().width) < 6;
    const markers = () => {
      if (ch.slices?.length) return ch.slices.map((f, i) => ({ key: i, f })).filter((m) => m.key > 0);
      const out = [{ key: 'start', f: ch.params.start || 0 }, { key: 'end', f: ch.params.end ?? 1 }];
      if (ch.params.loop) out.push({ key: 'loopStart', f: ch.params.loopStart ?? 0 }, { key: 'loopEnd', f: ch.params.loopEnd ?? 1 });
      return out;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!s?.buffer || e.button !== 0) return;
      const hit = markers().find((m) => near(e, m.f));
      if (hit) {
        store.checkpoint();
        canvas.setPointerCapture(e.pointerId);
        drag = hit.key;
        return;
      }
      if (ch.slices?.length) {
        // audition the slice under the pointer
        const f = fracAt(e);
        let i = 0;
        while (i + 1 < ch.slices.length && ch.slices[i + 1] <= f) i++;
        engine.preview(ch, (ch.rootPitch ?? 60) + i, 0.85, 2);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag == null) { canvas.style.cursor = s?.buffer && markers().some((m) => near(e, m.f)) ? 'ew-resize' : ''; return; }
      const f = fracAt(e);
      if (typeof drag === 'number') {
        const lo = ch.slices[drag - 1] + 0.002;
        const hi = (ch.slices[drag + 1] ?? 1) - 0.002;
        ch.slices[drag] = Math.round(Math.min(hi, Math.max(lo, f)) * 1e5) / 1e5;
      } else {
        const p = ch.params;
        if (drag === 'start') p.start = Math.min(f, (p.end ?? 1) - 0.01, 0.95);
        else if (drag === 'end') p.end = Math.max(f, (p.start || 0) + 0.01, 0.05);
        else if (drag === 'loopStart') p.loopStart = Math.min(f, (p.loopEnd ?? 1) - 0.01);
        else if (drag === 'loopEnd') p.loopEnd = Math.max(f, (p.loopStart ?? 0) + 0.01);
      }
      store.dirty = true;
      drawWave(canvas, s, ch);
    });
    const end = () => { if (drag != null) { drag = null; touch(); render(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', (e) => {
      if (!ch.slices?.length) return;
      const f = fracAt(e);
      if (ch.slices.some((x) => Math.abs(x - f) < 0.004)) return;
      setSlices(ch, [...ch.slices, Math.round(f * 1e5) / 1e5].sort((a, b) => a - b));
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hit = ch.slices?.length ? markers().find((m) => near(e, m.f)) : null;
      if (hit) setSlices(ch, ch.slices.filter((_, i) => i !== hit.key));
    });
  }

  function drawWave(canvas, s, ch) {
    const w = canvas.clientWidth || 560;
    const hh = 90;
    const ctx = canvas.getContext('2d');
    sizeCanvas(canvas, ctx, w, hh);
    ctx.fillStyle = T.waveBg;
    ctx.fillRect(0, 0, w, hh);
    if (!s?.buffer) {
      ctx.fillStyle = T.textDim;
      ctx.font = '12px "Noto Sans", sans-serif';
      ctx.fillText(s ? 'Decoding…' : 'No sample loaded', 12, hh / 2 + 4);
      return;
    }
    const data = s.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    ctx.fillStyle = ch.color;
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      for (let i = 0; i < step; i++) { const v = data[x * step + i] || 0; if (v < min) min = v; if (v > max) max = v; }
      ctx.fillRect(x, hh / 2 - max * (hh / 2 - 3), 1, Math.max(1, (max - min) * (hh / 2 - 3)));
    }
    ctx.font = '10px "Noto Sans", sans-serif';
    ctx.textBaseline = 'top';
    if (ch.slices?.length) {
      ch.slices.forEach((f, i) => {
        const x = Math.round(f * w) + 0.5;
        ctx.strokeStyle = T.accent;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke();
        ctx.fillStyle = T.text;
        ctx.fillText(noteName((ch.rootPitch ?? 60) + i), x + 3, 3);
      });
      return;
    }
    const p = ch.params;
    const sx = (p.start || 0) * w;
    const ex = (p.end ?? 1) * w;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, 0, sx, hh);
    ctx.fillRect(ex, 0, w - ex, hh);
    if (p.loop) {
      const lx = (p.loopStart ?? 0) * w;
      const rx = (p.loopEnd ?? 1) * w;
      ctx.fillStyle = rgba(T.accent, 0.12);
      ctx.fillRect(lx, 0, rx - lx, hh);
      ctx.strokeStyle = T.accent;
      for (const x of [lx, rx]) { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, hh); ctx.stroke(); }
      ctx.fillStyle = T.text;
      ctx.fillText('loop', lx + 3, hh - 13);
    }
    ctx.strokeStyle = T.text;
    for (const x of [sx, ex]) { ctx.beginPath(); ctx.moveTo(Math.round(Math.min(w - 1, x)) + 0.5, 0); ctx.lineTo(Math.round(Math.min(w - 1, x)) + 0.5, hh); ctx.stroke(); }
  }

  // a MIDI controller, automation editing or an agent changed a value: move the knobs, don't rebuild
  store.on('channelParams', (id) => {
    const ch = channel();
    if (!win.visible || id !== chId || !ch) return;
    for (const [key, k] of knobs) if (ch.params[key] !== undefined && typeof ch.params[key] === 'number') k.setValue(ch.params[key]);
  });
  store.on('channelMix', () => {
    const ch = channel();
    if (!win.visible || !ch) return;
    knobs.get('vol')?.setValue(ch.vol);
    knobs.get('pan')?.setValue(ch.pan);
  });
  store.on('selection', () => { if (win.visible && store.selectedChannel) { chId = store.selectedChannel.id; render(); } });
  store.on('channels', () => { if (win.visible) render(); });
  appearance.on('change', () => { if (win.visible) render(); });
  store.on('soundfontReady', () => { if (win.visible) render(); });
  store.on('sampleReady', () => { if (win.visible) render(); });
  store.on('project', () => { if (win.visible) { chId = store.selectedChannel?.id ?? null; render(); } });

  return { open, win };
}
