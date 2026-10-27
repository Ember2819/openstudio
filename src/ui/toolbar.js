import { h } from '../util.js';
import { icon } from './icons.js';
import { createKnob, hint } from './knob.js';
import { showMenuBelow } from './menu.js';
import { createSnapSelect } from './snapselect.js';
import { promptDialog } from './dialog.js';
import { T } from '../theme.js';

export function createToolbar(app) {
  const { store, transport, wm, actions } = app;
  const root = document.getElementById('toolbar');

  // ------------------------------------------------------------------ menus
  const menus = {
    FILE: () => [
      { label: 'New project', shortcut: 'Ctrl+N', action: actions.newProject },
      { label: 'Open…', shortcut: 'Ctrl+O', action: actions.openProject },
      { separator: true },
      { label: 'Save', shortcut: 'Ctrl+S', action: () => actions.saveProject(false) },
      { label: 'Save as…', shortcut: 'Ctrl+Shift+S', action: () => actions.saveProject(true) },
      { separator: true },
      { label: 'Open demo project', action: actions.loadDemo },
      { label: 'Import sample…', action: actions.addSamplerFromFile },
      { label: 'Import MIDI file…', action: () => actions.importMidiFile() },
      { separator: true },
      { label: 'Export audio (WAV)…', shortcut: 'Ctrl+R', action: actions.exportWav },
      { label: 'Export MIDI…', action: actions.exportMidi },
    ],
    EDIT: () => [
      { label: 'Undo', shortcut: 'Ctrl+Z', disabled: !store.undoStack.length, action: actions.undo },
      { label: 'Redo', shortcut: 'Ctrl+Y', disabled: !store.redoStack.length, action: actions.redo },
      { separator: true },
      { label: 'Clear current pattern', action: actions.clearPattern },
    ],
    ADD: () => [
      { label: 'One more channel', submenu: () => actions.channelMenuItems() },
      { label: 'New pattern', shortcut: 'Ctrl+Shift+P', action: () => store.addPattern() },
    ],
    PATTERNS: () => [
      { label: 'New pattern', action: () => store.addPattern() },
      { label: 'Clone pattern', action: () => store.clonePattern(store.project.selected.pattern) },
      { label: 'Rename pattern…', action: actions.renamePattern },
      { label: 'Delete pattern', disabled: store.project.patterns.length < 2, action: () => store.removePattern(store.project.selected.pattern) },
      { separator: true },
      { label: 'Next pattern', shortcut: '+', action: () => store.stepPattern(1) },
      { label: 'Previous pattern', shortcut: '-', action: () => store.stepPattern(-1) },
      { separator: true },
      ...store.project.patterns.map((p) => ({ label: p.name, swatch: p.color, checked: p.id === store.project.selected.pattern, action: () => store.selectPattern(p.id) })),
    ],
    VIEW: () => [
      { label: 'Browser', shortcut: 'Alt+F8', checked: app.browserVisible(), action: actions.toggleBrowser },
      { label: 'Channel rack', shortcut: 'F6', checked: wm.get('rack').visible, action: () => wm.get('rack').toggle() },
      { label: 'Piano roll', shortcut: 'F7', checked: wm.get('piano').visible, action: () => wm.get('piano').toggle() },
      { label: 'Playlist', shortcut: 'F5', checked: wm.get('playlist').visible, action: () => wm.get('playlist').toggle() },
      { label: 'Mixer', shortcut: 'F9', checked: wm.get('mixer').visible, action: () => wm.get('mixer').toggle() },
      { separator: true },
      { label: 'Reset window layout', action: () => wm.resetLayout() },
    ],
    OPTIONS: () => [
      { label: 'Metronome', shortcut: 'Ctrl+M', checked: transport.metronome, action: () => transport.setMetronome(!transport.metronome) },
      { label: 'Record to piano roll', checked: transport.recording, action: () => transport.setRecording(!transport.recording) },
      { label: 'MIDI input', submenu: () => {
        const devs = app.midi?.devices?.() ?? [];
        return devs.length ? devs.map((d) => ({ label: d.name, checked: d.on, action: () => app.midi.toggle(d.id) })) : [{ label: app.midi?.error || 'No MIDI devices found', disabled: true }];
      } },
      { separator: true },
      { label: 'Song mode', checked: transport.mode === 'song', action: () => transport.setMode('song') },
      { label: 'Pattern mode', checked: transport.mode === 'pattern', action: () => transport.setMode('pattern') },
    ],
    TOOLS: () => [
      { label: 'Settings…', shortcut: 'Ctrl+,', action: () => actions.togglePreferences() },
      { separator: true },
      { label: 'Channel settings…', shortcut: 'F10', action: () => actions.openChannelSettings(store.selectedChannel?.id) },
      { label: 'Clear current pattern', action: actions.clearPattern },
      { label: 'Reset mixer', action: actions.resetMixer },
    ],
    HELP: () => [
      { label: 'Keyboard shortcuts', shortcut: 'F1', action: actions.showShortcuts },
      { label: 'Agents (MCP server)…', action: actions.showAgents },
      { separator: true },
      { label: 'Check for updates…', action: () => actions.checkForUpdates() },
      { label: 'Check for updates on startup', checked: actions.autoCheckUpdates(), action: () => actions.setAutoCheckUpdates(!actions.autoCheckUpdates()) },
      { separator: true },
      { label: 'About OpenStudio', action: actions.showAbout },
    ],
  };

  const menuButtons = Object.keys(menus).map((name) => {
    const b = h('button', { class: 'menu-btn' }, name);
    b.addEventListener('click', () => open(b, name));
    b.addEventListener('pointerenter', () => { if (menuOpen !== b) open(b, name); });
    return b;
  });
  let menuOpen = null;
  function open(btn, name) {
    menuOpen = btn;
    menuButtons.forEach((m) => m.classList.toggle('open', m === btn));
    showMenuBelow(btn, menus[name](), { onClose: () => { menuOpen = null; menuButtons.forEach((m) => m.classList.remove('open')); } });
  }

  // -------------------------------------------------------------- transport
  const patBtn = h('button', { class: 'ps-half', 'data-hint': 'Pattern mode — plays the selected pattern (Ctrl+L)', onClick: () => transport.setMode('pattern') }, 'PAT');
  const songBtn = h('button', { class: 'ps-half', 'data-hint': 'Song mode — plays the playlist (Ctrl+L)', onClick: () => transport.setMode('song') }, 'SONG');
  const modeSwitch = h('div', { class: 'mode-switch' }, patBtn, songBtn);

  const playBtn = h('button', { class: 'tbtn big play', 'data-hint': 'Play / Pause (Space)', onClick: () => transport.togglePlay() }, icon('play'));
  const stopBtn = h('button', { class: 'tbtn big stop', 'data-hint': 'Stop', onClick: () => transport.stop() }, icon('stop'));
  const recBtn = h('button', { class: 'tbtn big rec', 'data-hint': 'Record notes from the keyboard into the piano roll', onClick: () => transport.setRecording(!transport.recording) }, icon('record'));
  const metroBtn = h('button', { class: 'tbtn', 'data-hint': 'Metronome (Ctrl+M)', onClick: () => transport.setMetronome(!transport.metronome) }, icon('metronome'));

  const loopBtn = h('button', { class: 'tbtn', 'data-hint': 'Loop the playlist region (Shift+drag on the playlist ruler to set it)', onClick: () => transport.setLoop(!transport.loopEnabled) }, icon('loop'));

  // tempo
  const tempoVal = h('span', { class: 'tempo-val' }, '130.000');
  const tempoBox = h('div', { class: 'tempo-box', 'data-hint': 'Tempo — drag, scroll or double-click to type (BPM)' }, tempoVal);
  let tdrag = null;
  tempoBox.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    tempoBox.setPointerCapture(e.pointerId);
    store.checkpoint();
    tdrag = { y: e.clientY, bpm: store.project.bpm };
  });
  tempoBox.addEventListener('pointermove', (e) => {
    if (!tdrag) return;
    const d = (tdrag.y - e.clientY) / (e.shiftKey ? 12 : 3);
    transport.setBpm(e.shiftKey ? tdrag.bpm + d * 0.1 : tdrag.bpm + Math.round(d));
  });
  tempoBox.addEventListener('pointerup', () => { tdrag = null; });
  tempoBox.addEventListener('wheel', (e) => {
    e.preventDefault();
    transport.setBpm(store.project.bpm - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1));
  }, { passive: false });
  tempoBox.addEventListener('dblclick', async () => {
    const v = await promptDialog('Tempo', String(store.project.bpm), 'Beats per minute (10 – 522)');
    const n = parseFloat(v);
    if (Number.isFinite(n)) { store.checkpoint(); transport.setBpm(n); }
  });

  // time display
  let timeMode = 'ms';
  const timeLabel = h('div', { class: 'time-label' }, 'M:S:CS');
  const timeBig = h('span', { class: 'time-big' }, '0:00');
  const timeSmall = h('span', { class: 'time-small' }, '.00');
  const timeBox = h('div', { class: 'time-box', 'data-hint': 'Song position — click to switch between M:S:CS and B:S:T' },
    timeLabel, h('div', { class: 'time-digits' }, timeBig, timeSmall));
  timeBox.addEventListener('click', () => { timeMode = timeMode === 'ms' ? 'bst' : 'ms'; timeLabel.textContent = timeMode === 'ms' ? 'M:S:CS' : 'B:S:T'; });

  // master meter + voices / memory
  const meterCanvas = h('canvas', { class: 'master-meter', width: 192, height: 28 });
  const meterCtx = meterCanvas.getContext('2d');
  const polyEl = h('span', {}, '0 voices');
  const memEl = h('span', {}, '0 MB');
  const meters = h('div', { class: 'meter-box', 'data-hint': 'Master output level · active voices · memory' },
    meterCanvas, h('div', { class: 'meter-read' }, polyEl, memEl));

  // master controls
  const masterKnob = createKnob({
    value: store.project.mixer[0].vol, min: 0, max: 1, def: 0.8, size: 30, label: 'Master volume',
    fmt: (v) => `${Math.round((v / 0.8) * 100)}%`,
    onStart: () => store.checkpoint(),
    target: { kind: 'mixer', track: 0, param: 'vol' },
    onChange: (v) => { store.project.mixer[0].vol = v; store.emit('mixer'); },
  });
  const pitchKnob = createKnob({
    value: store.project.masterPitch, min: -12, max: 12, def: 0, step: 1, size: 24, bipolar: true, label: 'Master pitch',
    fmt: (v) => `${v > 0 ? '+' : ''}${v} semitones`,
    onStart: () => store.checkpoint(),
    onChange: (v) => { store.project.masterPitch = v; },
  });

  // right-hand buttons
  const undoBtn = h('button', { class: 'tbtn', 'data-hint': 'Undo (Ctrl+Z)', onClick: actions.undo }, icon('undo'));
  const redoBtn = h('button', { class: 'tbtn', 'data-hint': 'Redo (Ctrl+Y)', onClick: actions.redo }, icon('redo'));
  const saveBtn = h('button', { class: 'tbtn', 'data-hint': 'Save project (Ctrl+S)', onClick: () => actions.saveProject(false) }, icon('save'));
  const exportBtn = h('button', { class: 'tbtn tb-export', 'data-hint': 'Export audio (Ctrl+R)', onClick: actions.exportWav }, icon('export'));
  const helpBtn = h('button', { class: 'tbtn tb-help', 'data-hint': 'Keyboard shortcuts (F1)', onClick: actions.showShortcuts }, icon('help'));
  const prefsBtn = h('button', { class: 'tbtn tb-prefs', 'data-hint': 'Settings — themes, colours and wallpaper (Ctrl+,)', onClick: () => actions.togglePreferences() }, icon('gear'));

  const updateBtn = h('button', { class: 'update-pill', hidden: true, onClick: () => actions.checkForUpdates() }, icon('export'), 'Update available');

  const row1 = h('div', { class: 'tb-row tb-row1' },
    h('div', { class: 'menubar' }, menuButtons),
    h('div', { class: 'tb-sep' }),
    modeSwitch,
    h('div', { class: 'tb-group' }, playBtn, stopBtn, recBtn),
    tempoBox,
    h('div', { class: 'tb-group' }, metroBtn, loopBtn),
    timeBox,
    meters,
    h('div', { class: 'knob-pair' }, masterKnob, pitchKnob),
    h('div', { class: 'tb-flex' }),
    updateBtn,
    h('div', { class: 'tb-group' }, undoBtn, redoBtn, saveBtn, exportBtn, helpBtn),
    prefsBtn);

  // ------------------------------------------------------------------ row 2
  const projName = h('div', { class: 'hint-title' }, store.project.name);
  const hintText = h('div', { id: 'hint-text', class: 'hint-text' }, '');
  const hintPanel = h('div', { class: 'hint-panel' }, projName, hintText);

  const snapBtn = createSnapSelect(app);

  const patName = h('span', { class: 'pat-name' }, 'Pattern 1');
  const patSwatch = h('span', { class: 'pat-swatch' });
  const patBox = h('button', { class: 'pat-box', 'data-hint': 'Selected pattern — click to choose, scroll to step through patterns' }, patSwatch, patName, h('span', { class: 'caret' }, '▼'));
  patBox.addEventListener('click', () => {
    showMenuBelow(patBox, [
      ...store.project.patterns.map((p) => ({ label: p.name, swatch: p.color, checked: p.id === store.project.selected.pattern, action: () => store.selectPattern(p.id) })),
      { separator: true },
      { label: 'Rename…', action: actions.renamePattern },
      { label: 'Clone', action: () => store.clonePattern(store.project.selected.pattern) },
      { label: 'Delete', disabled: store.project.patterns.length < 2, action: () => store.removePattern(store.project.selected.pattern) },
    ]);
  });
  patBox.addEventListener('wheel', (e) => { e.preventDefault(); store.stepPattern(Math.sign(e.deltaY)); }, { passive: false });
  const patPrev = h('button', { class: 'tbtn small', 'data-hint': 'Previous pattern', onClick: () => store.stepPattern(-1) }, '◂');
  const patNext = h('button', { class: 'tbtn small', 'data-hint': 'Next pattern', onClick: () => store.stepPattern(1) }, '▸');
  const patAdd = h('button', { class: 'tbtn small', 'data-hint': 'New pattern', onClick: () => store.addPattern() }, icon('plus'));

  const toggles = [
    ['browser', 'browser', 'Browser (Alt+F8)', () => actions.toggleBrowser(), () => app.browserVisible()],
    ['rack', 'channelrack', 'Channel rack (F6)', () => wm.get('rack').toggle(), () => wm.get('rack')?.visible],
    ['piano', 'pianoroll', 'Piano roll (F7)', () => wm.get('piano').toggle(), () => wm.get('piano')?.visible],
    ['playlist', 'playlist', 'Playlist (F5)', () => wm.get('playlist').toggle(), () => wm.get('playlist')?.visible],
    ['mixer', 'mixer', 'Mixer (F9)', () => wm.get('mixer').toggle(), () => wm.get('mixer')?.visible],
  ].map(([id, ico, tip, fn, isOn]) => {
    const b = h('button', { class: 'tbtn wide', 'data-hint': tip, onClick: fn }, icon(ico, 'lg'));
    b._isOn = isOn;
    return b;
  });

  const statusEl = h('div', { class: 'audio-status', 'data-hint': 'Audio device sample rate and output latency' });

  const row2 = h('div', { class: 'tb-row tb-row2' },
    hintPanel,
    snapBtn,
    h('div', { class: 'pat-group' }, patPrev, patBox, patNext, patAdd),
    h('div', { class: 'tb-flex' }),
    h('div', { class: 'tb-group toggles' }, toggles),
    h('div', { class: 'tb-flex' }),
    statusEl);

  root.append(row1, row2);

  // global hint wiring
  root.parentElement.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-hint]');
    if (t && t.dataset.hint) hint.set(t.dataset.hint);
  });
  root.parentElement.addEventListener('mouseout', (e) => {
    const t = e.target.closest?.('[data-hint]');
    if (t && !t.contains(e.relatedTarget)) hint.clear();
  });

  // ---------------------------------------------------------------- updates
  const refreshStatic = () => {
    patBtn.classList.toggle('on', transport.mode === 'pattern');
    songBtn.classList.toggle('on', transport.mode === 'song');
    playBtn.classList.toggle('on', transport.playing);
    playBtn.replaceChildren(icon(transport.playing ? 'pause' : 'play'));
    recBtn.classList.toggle('on', transport.recording);
    metroBtn.classList.toggle('on', transport.metronome);
    loopBtn.classList.toggle('on', transport.loopEnabled);
    toggles.forEach((b) => b.classList.toggle('on', !!b._isOn()));
    undoBtn.disabled = !store.undoStack.length;
    redoBtn.disabled = !store.redoStack.length;
  };

  const refreshProject = () => {
    const p = store.project;
    projName.textContent = `${store.dirty ? '• ' : ''}${p.name}`;
    const pat = store.currentPattern;
    patName.textContent = pat.name;
    patSwatch.style.background = pat.color;
    tempoVal.textContent = p.bpm.toFixed(3);
    masterKnob.setValue(p.mixer[0].vol);
    pitchKnob.setValue(p.masterPitch);
    refreshStatic();
  };

  transport.on('change', refreshStatic);
  transport.on('mode', refreshStatic);
  transport.on('bpm', () => { tempoVal.textContent = store.project.bpm.toFixed(3); });
  wm.on('visibility', refreshStatic);
  app.on('browser', refreshStatic);
  for (const evt of ['project', 'patterns', 'selection']) store.on(evt, refreshProject);
  store.on('mixer', () => masterKnob.setValue(store.project.mixer[0].vol));
  refreshProject();

  let lastMem = 0;
  const level = [0, 0];
  function drawMasterMeter() {
    const c = meterCtx;
    const W = meterCanvas.width, H = meterCanvas.height;
    const peaks = app.engine.readLevels(0);
    c.clearRect(0, 0, W, H);
    for (let ch = 0; ch < 2; ch++) {
      level[ch] = Math.max(peaks[ch], level[ch] * 0.9);
      const db = 20 * Math.log10(Math.max(level[ch], 0.00001));
      const frac = Math.min(1, Math.max(0, (db + 54) / 60));
      const y = ch * 15 + 1;
      c.fillStyle = T.meterBg;
      c.fillRect(0, y, W, 11);
      const grad = c.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, T.meter1); grad.addColorStop(0.75, T.meter2); grad.addColorStop(0.9, T.meter3); grad.addColorStop(1, T.meter4);
      c.fillStyle = grad;
      c.fillRect(0, y, W * frac, 11);
    }
  }
  function update() {
    // pattern mode shows the position inside the looping pattern, like FL Studio
    const pos = transport.mode === 'pattern' && transport.playing ? transport.patternPosition() : transport.position();
    if (timeMode === 'ms') {
      const t = transport.formatTime(pos);
      timeBig.textContent = `${t.m}:${String(t.s).padStart(2, '0')}`;
      timeSmall.textContent = `.${String(t.cs).padStart(2, '0')}`;
    } else {
      const t = transport.formatBst(pos);
      timeBig.textContent = `${t.bar}:${String(t.beat).padStart(2, '0')}`;
      timeSmall.textContent = `:${String(t.tick).padStart(2, '0')}`;
    }
    const voices = app.engine.voiceCount;
    polyEl.textContent = `${voices} voice${voices === 1 ? '' : 's'}`;
    drawMasterMeter();
    const now = performance.now();
    if (now - lastMem > 1000) {
      lastMem = now;
      const mem = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0;
      memEl.textContent = `${Math.round(mem)} MB`;
      const ctx = app.engine.ctx;
      const lat = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000);
      statusEl.innerHTML = `<b>${(ctx.sampleRate / 1000).toFixed(1)} kHz</b> · ${lat || '<10'} ms<br>${ctx.state === 'running' ? 'Audio running' : 'Audio suspended'}`;
    }
    undoBtn.disabled = !store.undoStack.length;
    redoBtn.disabled = !store.redoStack.length;
  }

  /** Show a status message (e.g. while rendering) in the hint panel; null clears it. */
  const setBusy = (text) => {
    hintText.textContent = text || '';
    document.body.classList.toggle('busy', !!text);
  };

  /** Shows (or with null hides) the "Update available" pill; `version` goes into its tooltip. */
  function setUpdateAvailable(version) {
    updateBtn.hidden = !version;
    if (version) updateBtn.dataset.hint = `OpenStudio ${version} is available — click to download and install`;
  }

  return { update, refreshProject, setBusy, setUpdateAvailable };
}
