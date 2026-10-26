import { promptDialog, confirmDialog, messageDialog } from './ui/dialog.js';
import { Engine } from './audio/engine.js';
import { scheduleStep } from './audio/transport.js';
import { encodeWav } from './audio/wav.js';
import { STEPS_PER_BAR } from './state.js';
import { SYNTH_PRESETS } from './audio/instruments.js';
import { getSoundfont } from './audio/engine.js';
import { buildCatalog } from './audio/catalog.js';
import { buildMidi } from './midifile.js';
import { describeTarget, readTarget, valueToNorm } from './automation.js';

const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['Ctrl+L', 'Toggle pattern / song mode'],
  ['F5 · F6 · F7 · F9', 'Playlist · Channel rack · Piano roll · Mixer'],
  ['Alt+F8', 'Browser'],
  ['F10', 'Channel settings'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+N / O / S', 'New / open / save project'],
  ['Ctrl+R', 'Export audio'],
  ['Ctrl+M', 'Metronome'],
  ['+ / −', 'Next / previous pattern'],
  ['Z S X D C V G B H N J M', 'Play the selected channel from the keyboard (lower octave)'],
  ['Q 2 W 3 E R 5 T 6 Y 7 U', 'Play the selected channel (upper octave)'],
  ['Piano roll: Del / Ctrl+A / Ctrl+C / Ctrl+V', 'Delete / select all / copy / paste notes'],
  ['Piano roll: Ctrl+Q / Ctrl+D', 'Quantize / duplicate selected notes'],
  ['Playlist ruler: Shift+drag', 'Set the loop region (double-click to clear)'],
  ['Knob or fader: right-click', 'Create an automation clip'],
  ['Piano roll: Ctrl+drag', 'Temporary select tool'],
  ['Piano roll / playlist: Ctrl+wheel', 'Zoom horizontally'],
  ['Right-click', 'Delete notes / clips, erase steps'],
];

export function createActions(app) {
  const { store, transport } = app;

  const confirmDiscard = async () => !store.dirty || confirmDialog('Unsaved changes', 'Discard the current project?', 'Discard');

  const a = {
    undo() { store.undo(); },
    redo() { store.redo(); },

    async newProject() {
      if (!(await confirmDiscard())) return;
      transport.stop();
      store.resetToDefault();
      store.filePath = null;
    },

    async openProject() {
      if (!(await confirmDiscard())) return;
      const res = await window.studioAPI.openProject();
      if (!res) return;
      try {
        transport.stop();
        store.load(res.text, res.path);
      } catch (err) {
        messageDialog('Could not open project', err.message);
      }
    },

    async saveProject(forceDialog) {
      const path = await window.studioAPI.saveProject({
        suggestedName: `${store.project.name}.osp`,
        text: store.serialize(),
        forceDialog,
        knownPath: store.filePath,
      });
      if (!path) return;
      store.filePath = path;
      const base = path.split(/[\\/]/).pop().replace(/\.osp$/i, '');
      store.project.name = base;
      store.dirty = false;
      store.emit('project-saved');
      store.emit('patterns'); // refresh toolbar title
      window.studioAPI.setTitle(`${base} — OpenStudio`);
    },

    addChannel(type, preset) {
      if (type === 'drum') return store.addChannel({ name: preset.name, type: 'drum', voice: preset.voice });
      const p = preset || SYNTH_PRESETS.Leads[0];
      return store.addChannel({ name: preset ? preset.name : 'Synth', type: 'synth', preset: p.params });
    },

    /** Add a SoundFont channel: { name, bank, program, fixedKey?, rootPitch? } */
    addInstrument(spec) {
      return store.addChannel({ type: 'sf', ...spec });
    },

    catalog() {
      const sf = getSoundfont();
      if (!sf) return null;
      if (!a._catalog) a._catalog = buildCatalog(sf);
      return a._catalog;
    },

    /** Menu used by the toolbar (ADD) and the channel rack "+" button. */
    channelMenuItems() {
      const cat = a.catalog();
      const items = [
        { label: 'Synth', action: () => a.addChannel('synth') },
        { label: 'Sampler…', action: () => a.addSamplerFromFile() },
        { separator: true },
      ];
      if (!cat) return [...items, { label: 'Loading instruments…', disabled: true }];
      items.push({
        label: 'Instruments',
        submenu: cat.families.map((f) => ({
          label: f.name,
          submenu: f.presets.map((p) => ({ label: p.name, action: () => a.addInstrument({ name: p.name, bank: p.bank, program: p.program }) })),
        })),
      });
      items.push({
        label: 'Drum kits',
        submenu: cat.kits.map((k) => ({
          label: k.name,
          submenu: [
            { label: 'Full kit (all keys)', action: () => a.addInstrument({ name: k.name, bank: 128, program: k.program, rootPitch: 36 }) },
            { separator: true },
            ...k.pieces.filter((pc) => pc.key >= 27).map((pc) => ({ label: pc.name, action: () => a.addInstrument({ name: pc.name, bank: 128, program: k.program, fixedKey: pc.key }) })),
          ],
        })),
      });
      return items;
    },

    async addSamplerFromFile() {
      const files = await window.studioAPI.openSamples();
      for (const f of files) {
        const sampleId = store.addSample(f.name, f.data);
        store.addChannel({ name: f.name.replace(/\.[^.]+$/, ''), type: 'sampler', sampleId });
      }
    },

    /** Add audio files to the sample library (drag them onto the playlist from the browser). */
    async importSamples() {
      const files = await window.studioAPI.openSamples();
      for (const f of files) {
        const id = store.addSample(f.name, f.data);
        await app.engine.ensureSample(id);
      }
      store.emit('sampleReady');
    },

    async renameChannel(id) {
      const ch = store.channel(id ?? store.project.selected.channel);
      if (!ch) return;
      const name = await promptDialog('Rename channel', ch.name);
      if (name && name.trim()) { store.checkpoint(); ch.name = name.trim(); store.emit('channels'); }
    },

    async renamePattern(id) {
      const pat = store.pattern(id ?? store.project.selected.pattern);
      const name = await promptDialog('Rename pattern', pat.name);
      if (name && name.trim()) { store.checkpoint(); pat.name = name.trim(); store.emit('patterns'); store.emit('selection'); }
    },

    clearPattern() {
      store.checkpoint();
      store.currentPattern.notes = {};
      store.emit('notes');
    },

    resetMixer() {
      store.checkpoint();
      for (const m of store.project.mixer) { m.vol = 0.8; m.pan = 0; m.mute = false; m.solo = false; m.fx = m.fx.map(() => null); }
      store.emit('project');
    },

    toggleBrowser() {
      document.getElementById('browser').classList.toggle('collapsed');
      document.getElementById('browser-splitter').classList.toggle('collapsed');
      app.emit('browser');
    },

    showShortcuts() {
      messageDialog('Keyboard shortcuts', SHORTCUTS.map(([k, d]) => `${k.padEnd(34, ' ')}${d}`).join('\n'));
    },

    showAbout() {
      messageDialog('About OpenStudio', 'OpenStudio 0.1\nAn open-source digital audio workstation inspired by the classic pattern-based workflow.\n\nBuilt with Electron and the Web Audio API.');
    },

    /** Create an automation clip for a knob/fader and open its editor. */
    createAutomation(target) {
      const norm = valueToNorm(store, target, readTarget(store, target));
      store.checkpoint();
      const auto = store.addAutomation({ name: describeTarget(store, target), target, value: norm, len: STEPS_PER_BAR });
      const start = Math.floor(transport.startStep / STEPS_PER_BAR) * STEPS_PER_BAR;
      const clips = store.project.playlist.clips;
      let track = 0;
      while (clips.some((c) => c.track === track && c.start < start + auto.len && c.start + c.len > start)) track++;
      store.addClip({ type: 'auto', autoId: auto.id, track, start, len: auto.len });
      store.emit('playlist');
      app.wm.get('playlist').show();
      a.openAutomation(auto.id);
    },

    async exportMidi() {
      const song = store.project.mode === 'song';
      const bytes = buildMidi(store, { song });
      await window.studioAPI.writeFile({ suggestedName: `${store.project.name}.mid`, data: bytes.buffer, filters: [{ name: 'MIDI file', extensions: ['mid'] }] });
    },

    loadDemo() { loadDemo(store, transport); },

    async exportWav() {
      const proj = store.project;
      const stepDur = 60 / proj.bpm / 4;
      const steps = proj.mode === 'song' ? store.playlistEndStep() : store.patternSteps(store.currentPattern);
      if (steps <= 0) { messageDialog('Nothing to export', 'The playlist is empty — switch to pattern mode or add clips first.'); return; }
      transport.stop();
      const tail = 3;
      const seconds = steps * stepDur + tail;
      const sr = 44100;
      const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
      const engine = new Engine(store, ctx);
      try {
        for (let s = 0; s < steps; s++) scheduleStep(store, engine, s, s * stepDur, stepDur, { first: s === 0 });
        const rendered = await ctx.startRendering();
        const data = encodeWav(rendered);
        await window.studioAPI.writeFile({ suggestedName: `${proj.name}.wav`, data, filters: [{ name: 'WAV audio', extensions: ['wav'] }] });
      } finally {
        engine.dispose();
      }
    },

  };
  return a;
}

function loadDemo(store, transport) {
  transport.stop();
  store.resetToDefault();
  const p = store.project;
  p.name = 'Demo beat';
  p.bpm = 124;
  const [kick, clap, hat, snare] = p.channels;
  const bass = store._addChannel({ name: 'Synth Bass', type: 'sf', bank: 0, program: 38, mixer: 5, color: '#c4824f' });
  const keys = store._addChannel({ name: 'Electric Piano', type: 'sf', bank: 0, program: 4, mixer: 6, color: '#5b8bc4' });
  const lead = store._addChannel({ name: 'Vibraphone', type: 'sf', bank: 0, program: 11, mixer: 7, color: '#92a95c' });
  ['Kick', 'Clap', 'Hat', 'Snare', 'Bass', 'Keys', 'Lead'].forEach((n, i) => { p.mixer[i + 1].name = n; });
  p.mixer[3].vol = 0.7;
  p.mixer[6].fx[0] = { type: 'reverb', params: { size: 2.6, damp: 0.5, mix: 0.28 }, on: true };
  p.mixer[7].fx[0] = { type: 'delay', params: { time: 363, feedback: 0.42, tone: 4200, mix: 0.3 }, on: true };

  const drums = p.patterns[0];
  drums.name = 'Drums';
  const note = (s, pitch, l = 1, v = 0.8) => ({ p: pitch, s, l, v });
  drums.notes[kick.id] = [0, 4, 8, 12].map((s) => note(s, 60, 1, 0.95));
  drums.notes[clap.id] = [4, 12].map((s) => note(s, 60, 1, 0.85));
  drums.notes[hat.id] = [2, 6, 10, 14].map((s) => note(s, 60, 1, 0.65)).concat([0, 4, 8, 12].map((s) => note(s + 0.5, 60, 1, 0.3)));
  drums.notes[snare.id] = [15].map((s) => note(s, 60, 1, 0.45));

  const mk = (name, color, bars) => { const pat = store._addPattern(name); pat.color = color; pat.bars = bars; return pat; };
  const bassP = mk('Bassline', '#c4824f', 1);
  bassP.notes[bass.id] = [[0, 45, 2], [3, 45, 1], [6, 48, 2], [8, 43, 2], [11, 43, 1], [14, 45, 2]].map(([s, pi, l]) => note(s, pi, l, 0.9));
  const chordsP = mk('Chords', '#5b8bc4', 2);
  const chord = (start, pitches, len) => pitches.map((pi) => note(start, pi, len, 0.7));
  chordsP.notes[keys.id] = [
    ...chord(0, [57, 60, 64], 6), ...chord(8, [57, 60, 64], 4),
    ...chord(16, [53, 57, 60], 6), ...chord(24, [55, 59, 62], 8),
  ];
  const leadP = mk('Lead melody', '#92a95c', 2);
  leadP.notes[lead.id] = [[0, 72, 2], [2, 71, 2], [4, 69, 4], [10, 67, 2], [12, 69, 3], [16, 65, 2], [18, 67, 2], [20, 69, 4], [26, 72, 2], [28, 71, 4]]
    .map(([s, pi, l]) => note(s, pi, l, 0.8));

  const bar = STEPS_PER_BAR;
  const clip = (pat, track, startBar, bars) => store.addClip({ pat: pat.id, track, start: startBar * bar, len: bars * bar });
  clip(drums, 0, 0, 8);
  clip(bassP, 1, 2, 6);
  clip(chordsP, 2, 4, 4);
  clip(leadP, 3, 6, 2);
  p.playlist.tracks[0].name = 'Drums';
  p.playlist.tracks[1].name = 'Bass';
  p.playlist.tracks[2].name = 'Chords';
  p.playlist.tracks[3].name = 'Lead';
  p.selected.pattern = drums.id;
  p.selected.channel = kick.id;
  p.mode = 'song';
  store.finishLoad();
}
