import { h, COLORS, clamp } from '../util.js';
import { icon } from './icons.js';
import { createKnob } from './knob.js';
import { showMenu, showMenuBelow } from './menu.js';
import { barSteps, beatSteps } from '../state.js';
import { overlayScrollbars } from './scrollbars.js';

const TYPE_ICON = { drum: 'drum', synth: 'synth', fm: 'synth', organ: 'keys', pluck: 'wave', sfx: 'wave', sampler: 'sampler', sf: 'piano' };

export function createChannelRack(app) {
  const { store, wm, transport, engine, actions } = app;
  const BAR = () => barSteps(store.project); // steps per bar / beat in the project's time signature
  const BEAT = () => beatSteps(store.project);

  const win = wm.create({
    id: 'rack', title: 'Channel rack', icon: 'channelrack', minW: 420, minH: 140,
    rect: () => ({ x: 14, y: 14, w: 700, h: 372 }),
    visible: true,
  });

  // title-bar extras: steps selector
  const stepsLabel = h('span', {}, '16');
  const stepsBtn = h('button', { class: 'cr-steps', 'data-hint': 'Pattern length in steps' }, stepsLabel, h('span', { class: 'caret' }, ' ▼'));
  stepsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  stepsBtn.addEventListener('click', () => {
    const pat = store.currentPattern;
    const min = Math.ceil(store.patternSteps({ ...pat, bars: 1 }) / BAR());
    showMenuBelow(stepsBtn, [1, 2, 3, 4, 6, 8].map((bars) => ({
      label: `${bars * BAR()} steps (${bars} bar${bars > 1 ? 's' : ''})`,
      checked: pat.bars === bars,
      disabled: bars < min,
      action: () => { store.checkpoint(); pat.bars = bars; store.emit('notes'); store.emit('patterns'); },
    })));
  });
  const swingKnob = createKnob({
    value: store.project.swing, min: 0, max: 1, def: 0, size: 18, label: 'Swing', fmt: (v) => (v ? `${Math.round(v * 100)}%` : 'Off'),
    onStart: () => store.checkpoint(), onChange: (v) => { store.project.swing = v; },
  });
  swingKnob.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
  for (const evt of ['project', 'settings']) store.on(evt, () => swingKnob.setValue(store.project.swing));
  win.titleExtra.append(h('span', { class: 'tb-flex' }), h('span', { class: 'cr-steps-lbl' }, 'Swing'), swingKnob, h('span', { class: 'cr-steps-lbl' }, 'Steps'), stepsBtn);

  const header = h('div', { class: 'cr-header' }, h('div', { class: 'cr-left cr-left-head' }), h('div', { class: 'cr-leds' }));
  const rowsEl = h('div', { class: 'cr-rows' });
  const addBtn = h('button', { class: 'cr-add', 'data-hint': 'Add one more channel' }, icon('plus'));
  addBtn.addEventListener('click', () => showMenuBelow(addBtn, actions.channelMenuItems()));
  const footer = h('div', { class: 'cr-footer' }, addBtn);
  const scroll = h('div', { class: 'cr-scroll' }, header, rowsEl, footer);
  win.body.append(scroll);
  overlayScrollbars(scroll, { host: win.body });
  win.body.classList.add('cr-body');

  // ------------------------------------------------------------- row build
  const rowMap = new Map();

  function channelMenu(ch) {
    return [
      { label: 'Piano roll', shortcut: 'F7', action: () => { store.selectChannel(ch.id); wm.get('piano').show(); } },
      { label: 'Channel settings…', shortcut: 'F10', action: () => actions.openChannelSettings(ch.id) },
      { separator: true },
      { label: 'Rename…', shortcut: 'F2', action: () => actions.renameChannel(ch.id) },
      { label: 'Color', submenu: COLORS.map((c) => ({ label: ' ', swatch: c, checked: ch.color === c, action: () => { store.checkpoint(); ch.color = c; store.emit('channels'); store.emit('notes'); } })) },
      { label: 'Route to mixer', submenu: () => mixerRouteItems(ch) },
      { label: 'Route to free mixer track', shortcut: 'Ctrl+L', action: () => routeToFree(ch) },
      { separator: true },
      { label: 'Fill each 2 steps', action: () => fill(ch, 2) },
      { label: 'Fill each 4 steps', action: () => fill(ch, 4) },
      { label: 'Fill each 8 steps', action: () => fill(ch, 8) },
      { label: 'Shift steps left', action: () => shiftSteps(ch, -1) },
      { label: 'Shift steps right', action: () => shiftSteps(ch, 1) },
      { separator: true },
      { label: 'Move up', shortcut: 'Alt+↑', disabled: store.project.channels[0] === ch, action: () => store.moveChannel(ch.id, -1) },
      { label: 'Move down', shortcut: 'Alt+↓', disabled: store.project.channels.at(-1) === ch, action: () => store.moveChannel(ch.id, 1) },
      { separator: true },
      { label: 'Mute', checked: ch.mute, action: () => { store.checkpoint(); ch.mute = !ch.mute; store.emit('channels'); } },
      { label: 'Solo', checked: ch.solo, action: () => { store.checkpoint(); ch.solo = !ch.solo; store.emit('channels'); } },
      { separator: true },
      { label: 'Clone', action: () => store.cloneChannel(ch.id) },
      { label: 'Clear notes (this pattern)', action: () => { store.checkpoint(); delete store.currentPattern.notes[ch.id]; store.emit('notes'); } },
      { label: 'Delete', action: () => store.removeChannel(ch.id) },
    ];
  }

  function mixerRouteItems(ch) {
    const items = [{ label: 'Master', checked: ch.mixer === 0, action: () => route(ch, 0) }];
    for (let i = 1; i <= 24; i++) items.push({ label: store.project.mixer[i].name, checked: ch.mixer === i, action: () => route(ch, i) });
    return items;
  }
  function route(ch, i) { store.checkpoint(); ch.mixer = i; store.emit('channels'); store.emit('mixer'); }

  function routeToFree(ch) {
    const i = store.freeMixerTrack();
    if (i == null) return;
    store.checkpoint();
    ch.mixer = i;
    const m = store.project.mixer[i];
    if (/^Insert \d+$/.test(m.name)) m.name = ch.name;
    store.project.selected.mixer = i;
    store.emit('channels'); store.emit('mixer'); store.emit('mixerSelection');
  }

  /** FL's "Fill each N steps": replace the channel's steps in this pattern with one hit every N steps. */
  function fill(ch, every) {
    const pat = store.currentPattern;
    store.checkpoint();
    const n = store.patternSteps(pat);
    const pitch = ch.rootPitch ?? 60;
    pat.notes[ch.id] = [];
    for (let s0 = 0; s0 < n; s0 += every) pat.notes[ch.id].push({ p: pitch, s: s0, l: 1, v: 0.78 });
    store.emit('notes');
  }

  /** Rotate the channel's notes by one step, wrapping around the pattern. */
  function shiftSteps(ch, dir) {
    const pat = store.currentPattern;
    const list = pat.notes[ch.id];
    if (!list?.length) return;
    store.checkpoint();
    const n = store.patternSteps(pat);
    for (const note of list) note.s = (((note.s + dir) % n) + n) % n;
    store.emit('notes');
  }

  // FL-style rack shortcuts while the rack has focus
  scroll.tabIndex = 0;
  scroll.addEventListener('keydown', (e) => {
    const ch = store.selectedChannel;
    if (!ch) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); e.stopPropagation();
      store.moveChannel(ch.id, e.key === 'ArrowUp' ? -1 : 1);
    } else if (!e.altKey && !ctrl && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); e.stopPropagation();
      const list = store.project.channels;
      const i = list.indexOf(ch) + (e.key === 'ArrowUp' ? -1 : 1);
      if (list[i]) store.selectChannel(list[i].id);
    } else if (ctrl && e.key.toLowerCase() === 'l') {
      e.preventDefault(); e.stopPropagation();
      routeToFree(ch);
    } else if (e.key === 'Delete' && e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      store.removeChannel(ch.id);
    }
  });
  rowsEl.addEventListener('pointerdown', () => scroll.focus({ preventScroll: true }), true);

  // drop samples (browser sample folders, the project's samples, or files from the desktop): onto a sampler row it
  // replaces that channel's sample, anywhere else it makes a new sampler channel
  const dropTypes = ['text/openstudio-file', 'text/openstudio-sample', 'Files'];
  scroll.addEventListener('dragover', (e) => { if (dropTypes.some((t) => e.dataTransfer.types.includes(t))) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  scroll.addEventListener('drop', async (e) => {
    if (!dropTypes.some((t) => e.dataTransfer.types.includes(t))) return;
    const files = [...e.dataTransfer.files];
    if (files.length && !files.some((f) => /^audio\//.test(f.type) || /\.(wav|mp3|ogg|flac|aiff?|m4a|aac)$/i.test(f.name))) return; // left to the window
    e.preventDefault();
    const target = store.channel(Number(e.target.closest?.('.cr-row')?.dataset.ch));
    const samples = [];
    const libFile = e.dataTransfer.getData('text/openstudio-file');
    const libSample = Number(e.dataTransfer.getData('text/openstudio-sample'));
    if (libFile) samples.push({ name: libFile.split(/[\\/]/).pop(), data: (await app.browser.readFile(libFile)).slice(0) });
    else if (store.samples.has(libSample)) samples.push({ id: libSample, name: store.samples.get(libSample).name });
    else for (const f of e.dataTransfer.files) if (/^audio\//.test(f.type) || /\.(wav|mp3|ogg|flac|aiff?|m4a|aac)$/i.test(f.name)) samples.push({ name: f.name, data: await f.arrayBuffer() });
    if (!samples.length) return;
    store.checkpoint();
    samples.forEach((smp, k) => {
      const id = smp.id ?? store.addSample(smp.name, smp.data);
      const name = smp.name.replace(/\.[^.]+$/, '');
      if (k === 0 && target?.type === 'sampler') {
        target.sampleId = id;
        target.name = name;
        delete target.slices;
      } else {
        const ch = store._addChannel({ name, type: 'sampler', sampleId: id });
        store.project.selected.channel = ch.id;
      }
    });
    store.emit('channels');
    store.emit('selection');
  });

  function buildRow(ch) {
    const led = h('button', { class: `led cr-led${ch.mute ? '' : ' on'}`, 'data-hint': 'Channel enabled — click to mute, right-click to solo' });
    led.addEventListener('click', () => { store.checkpoint(); ch.mute = !ch.mute; store.emit('channels'); });
    led.addEventListener('contextmenu', (e) => { e.preventDefault(); store.checkpoint(); ch.solo = !ch.solo; store.emit('channels'); });

    const pan = createKnob({
      value: ch.pan, min: -1, max: 1, def: 0, size: 24, bipolar: true, label: 'Panning',
      fmt: (v) => (Math.abs(v) < 0.01 ? 'Centered' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'left' : 'right'}`),
      onStart: () => store.checkpoint(),
      target: { kind: 'channel', id: ch.id, param: 'pan' },
      onChange: (v) => { ch.pan = v; store.emit('channelMix'); },
    });
    const vol = createKnob({
      value: ch.vol, min: 0, max: 1, def: 0.78, size: 24, label: 'Channel volume',
      fmt: (v) => `${Math.round((v / 0.78) * 100)}%`,
      onStart: () => store.checkpoint(),
      target: { kind: 'channel', id: ch.id, param: 'vol' },
      onChange: (v) => { ch.vol = v; store.emit('channelMix'); },
    });

    const mix = h('button', { class: 'cr-mix', 'data-hint': 'Mixer track — click to route, scroll to change' }, ch.mixer === 0 ? '—' : String(ch.mixer));
    mix.addEventListener('click', () => showMenuBelow(mix, mixerRouteItems(ch)));
    mix.addEventListener('wheel', (e) => { e.preventDefault(); route(ch, clamp(ch.mixer - Math.sign(e.deltaY), 0, 125)); }, { passive: false });

    const name = h('button', { class: 'cr-name', 'data-hint': 'Click to select · double-click for settings · right-click for options' },
      h('span', { class: 'cr-name-ico', style: { color: ch.color } }, icon(TYPE_ICON[ch.type])),
      h('span', { class: 'cr-name-txt' }, ch.name));
    name.addEventListener('click', () => { store.selectChannel(ch.id); engine.preview(ch, ch.rootPitch ?? 60); });
    name.addEventListener('dblclick', () => actions.openChannelSettings(ch.id));
    name.addEventListener('contextmenu', (e) => { e.preventDefault(); store.selectChannel(ch.id); showMenu(channelMenu(ch), e.clientX, e.clientY); });

    const left = h('div', { class: 'cr-left' }, led, pan, vol, mix, name);
    const pads = h('div', { class: 'cr-pads' });
    const row = h('div', { class: 'cr-row', dataset: { ch: ch.id } }, left, pads);
    row.style.setProperty('--ch-color', ch.color);
    return { row, pads, name, led, pan, vol };
  }

  function rebuild() {
    rowsEl.replaceChildren();
    rowMap.clear();
    for (const ch of store.project.channels) {
      const r = buildRow(ch);
      r.padKey = null;
      rowMap.set(ch.id, r);
      rowsEl.append(r.row);
    }
    refreshPads();
    refreshSelection();
  }

  // ------------------------------------------------------------------ pads
  /** Pads are shaded in groups: a beat in x/4, a dotted beat (3 eighths) in 6/8, 9/8, 12/8, two eighths otherwise. */
  function padGroup() {
    const beat = BEAT();
    if (beat >= 4) return beat;
    return store.project.timeSig[0] % 3 === 0 ? beat * 3 : beat * 2;
  }

  function ensurePadCount(n) {
    const g = padGroup();
    const key = `${n}:${g}`;
    for (const r of rowMap.values()) {
      if (r.padKey === key) continue;
      r.pads.replaceChildren();
      const frag = document.createDocumentFragment();
      for (let i = 0; i < n; i++) {
        frag.append(h('div', { class: `cr-pad g${Math.floor(i / g) % 2}${i % g === 0 && i ? ' gap' : ''}`, dataset: { step: i } }));
      }
      r.pads.append(frag);
      r.padKey = key;
    }
    const leds = header.querySelector('.cr-leds');
    if (leds.dataset.key !== key) {
      leds.dataset.key = key;
      leds.replaceChildren();
      for (let i = 0; i < n; i++) leds.append(h('div', { class: `cr-pled${i % g === 0 && i ? ' gap' : ''}` }));
    }
  }

  function refreshPads() {
    const pat = store.currentPattern;
    const n = store.patternSteps(pat);
    ensurePadCount(n);
    stepsLabel.textContent = String(n);
    for (const [id, r] of rowMap) {
      const lit = new Set();
      for (const note of pat.notes[id] || []) lit.add(Math.floor(note.s + 1e-6));
      const pads = r.pads.children;
      for (let i = 0; i < pads.length; i++) pads[i].classList.toggle('on', lit.has(i));
    }
  }

  function refreshSelection() {
    const sel = store.project.selected.channel;
    for (const [id, r] of rowMap) r.row.classList.toggle('selected', id === sel);
  }

  // paint behaviour
  let paint = null;
  rowsEl.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.cr-pad');
    if (!pad) return;
    e.preventDefault();
    const chId = Number(pad.closest('.cr-row').dataset.ch);
    const ch = store.channel(chId);
    const step = Number(pad.dataset.step);
    const pat = store.currentPattern;
    const isOn = pad.classList.contains('on');
    store.selectChannel(chId);
    store.checkpoint();
    paint = { chId, on: e.button === 2 ? false : !isOn };
    store.toggleStep(pat, chId, step, paint.on);
    if (paint.on) engine.preview(ch, ch.rootPitch ?? 60, 0.8, 0.25);
    window.addEventListener('pointerup', () => { paint = null; }, { once: true });
  });
  rowsEl.addEventListener('pointerover', (e) => {
    if (!paint) return;
    const pad = e.target.closest('.cr-pad');
    if (!pad || Number(pad.closest('.cr-row').dataset.ch) !== paint.chId) return;
    const step = Number(pad.dataset.step);
    if (pad.classList.contains('on') !== paint.on) store.toggleStep(store.currentPattern, paint.chId, step, paint.on);
  });
  rowsEl.addEventListener('contextmenu', (e) => { if (e.target.closest('.cr-pad')) e.preventDefault(); });

  // ------------------------------------------------------------- bindings
  store.on('project', rebuild);
  // volume / pan changed elsewhere (a MIDI controller, an agent, automation editing)
  store.on('channelMix', () => {
    for (const ch of store.project.channels) {
      const r = rowMap.get(ch.id);
      if (r) { r.vol.setValue(ch.vol); r.pan.setValue(ch.pan); }
    }
  });
  store.on('channels', () => {
    // rebuild preserving scroll
    const top = scroll.scrollTop;
    rebuild();
    scroll.scrollTop = top;
  });
  store.on('notes', refreshPads);
  store.on('patterns', refreshPads);
  store.on('selection', () => { refreshPads(); refreshSelection(); });
  win.on('focus', () => {});
  rebuild();

  let lastLed = -1;
  function update() {
    if (!win.visible) return;
    const leds = header.querySelector('.cr-leds').children;
    let cur = -1;
    if (transport.playing && transport.mode === 'pattern') cur = Math.floor(transport.patternPosition());
    if (cur !== lastLed) {
      if (lastLed >= 0 && leds[lastLed]) leds[lastLed].classList.remove('on');
      if (cur >= 0 && leds[cur]) leds[cur].classList.add('on');
      lastLed = cur;
    }
  }

  return { win, update };
}
