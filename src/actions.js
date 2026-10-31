import { promptDialog, confirmDialog, messageDialog, progressDialog, shortcutsDialog } from './ui/dialog.js';
import { renderSteps, renderStems } from './audio/render.js';
import { encodeWav } from './audio/wav.js';
import { encodeFlac } from './audio/flac.js';
import { STEPS_PER_BAR, validTimeSig } from './state.js';
import { ENGINES, ENGINE_PRESETS, SYNTH_PRESETS } from './audio/instruments.js';
import { getSoundfont } from './audio/engine.js';
import { buildCatalog } from './audio/catalog.js';
import { buildMidi } from './midifile.js';
import { parseMidi, importMidi } from './midiimport.js';
import { parseFlp, importFlp, flpSamplePaths } from './flp.js';
import { guessBars, slicesToNotes } from './audio/slicing.js';
import { describeTarget, readTarget, valueToNorm } from './automation.js';
import { ACTIONS, resolveCombo } from './ui/tiling.js';

/** Help → Keyboard shortcuts. Keys: alternatives separated by " / ", combos joined with "+". */
const SHORTCUTS = [
  ['General', [
    ['Space', 'Play / pause'],
    ['Home', 'Jump to the start'],
    ['Ctrl+L', 'Switch pattern / song mode'],
    ['Ctrl+M', 'Metronome'],
    ['Ctrl+Z', 'Undo'],
    ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
    ['Ctrl+N', 'New project'],
    ['Ctrl+O', 'Open project'],
    ['Ctrl+S', 'Save'],
    ['Ctrl+Shift+S', 'Save as'],
    ['Ctrl+R', 'Export audio'],
    ['Ctrl+Shift+R', 'Export stems'],
    ['Ctrl+,', 'Settings (themes, wallpaper)'],
    ['F1', 'This list'],
  ]],
  ['Windows', [
    ['F5', 'Playlist'],
    ['F6', 'Channel rack'],
    ['F7', 'Piano roll'],
    ['F9', 'Mixer'],
    ['Alt+F8', 'Browser'],
    ['F10', 'Channel settings'],
    ['F2', 'Rename the selected channel'],
  ]],
  ['Patterns', [
    ['F4 / Ctrl+Shift+P', 'New pattern'],
    ['+ / −', 'Next / previous pattern'],
  ]],
  ['Play from the computer keyboard', [
    ['Z S X D C V G B H N J M', 'Lower octave'],
    ['Q 2 W 3 E R 5 T 6 Y 7 U', 'Upper octave'],
  ]],
  ['Piano roll', [
    ['Del', 'Delete selected notes'],
    ['Ctrl+A / Ctrl+D', 'Select all / deselect'],
    ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste'],
    ['Ctrl+B', 'Duplicate selection'],
    ['Ctrl+Q', 'Quick quantize'],
    ['Ctrl+L', 'Quick legato'],
    ['↑ / ↓', 'Transpose a semitone'],
    ['Ctrl+↑ / Ctrl+↓', 'Transpose an octave'],
    ['Alt+R', 'Randomize velocity'],
    ['Alt+A', 'Arpeggiate…'],
    ['Alt+S', 'Strum…'],
    ['Alt+U', 'Chop…'],
    ['Ctrl+Drag', 'Temporary select tool'],
    ['Alt+Wheel', 'Row height'],
  ]],
  ['Playlist', [
    ['Ctrl+B', 'Duplicate selected clips'],
    ['Ctrl+D', 'Deselect clips'],
    ['Shift+Drag / Right-drag', 'Set the loop region (on the ruler)'],
    ['Right-click', 'Ruler menu: markers, loops (on the ruler)'],
    ['Click / Double-click', 'Jump to / rename a marker'],
    ['Double-click', 'Clear the loop region (on the ruler)'],
    ['Right-click', 'Clip menu (on a clip title)'],
  ]],
  ['Channel rack', [
    ['Alt+↑ / Alt+↓', 'Move the selected channel'],
    ['Ctrl+L', 'Route to a free mixer track'],
  ]],
  ['Mouse', [
    ['Ctrl+Wheel', 'Zoom piano roll / playlist'],
    ['Shift+Wheel', 'Scroll sideways'],
    ['Right-click', 'Delete notes / clips, erase steps'],
    ['Right-click', 'Automate a knob or fader, or link it to a MIDI controller'],
    ['Double-click', 'Reset a fader'],
  ]],
];

export function createActions(app) {
  const { store, transport } = app;

  const confirmDiscard = async () => !store.dirty || confirmDialog('Unsaved changes', 'Discard the current project?', 'Discard');

  /** First playlist track with nothing in [start, start + len). */
  const firstFreeTrack = (start, len) => {
    const clips = store.project.playlist.clips;
    let track = 0;
    while (clips.some((c) => c.track === track && c.start < start + len && c.start + c.len > start)) track++;
    return track;
  };

  const a = {
    undo() { store.undo(); },
    redo() { store.redo(); },

    async newProject() {
      if (!(await confirmDiscard())) return;
      transport.stop();
      store.resetToDefault();
      store.filePath = null;
      app.autosave?.discard();
    },

    async openProject(recentPath = null) {
      if (!(await confirmDiscard())) return;
      const res = recentPath ? await window.studioAPI.recent.open(recentPath) : await window.studioAPI.openProject();
      if (!res) { if (recentPath) messageDialog('Could not open project', `${recentPath} is no longer there.`); return; }
      if (res.kind === 'flp') { await a.importFlpData(res.data, res.path); return; }
      try {
        transport.stop();
        store.load(res.text, res.path);
        app.autosave?.discard();
      } catch (err) {
        messageDialog('Could not open project', err.message);
      }
    },

    /** Open an FL Studio project: its patterns, playlist, channels and mixer, with stand-ins for FL-only plugins. */
    async importFlpData(data, path = '') {
      let flp;
      try {
        flp = parseFlp(data);
      } catch (err) {
        messageDialog('Could not open FL Studio project', err.message);
        return null;
      }
      const refs = flpSamplePaths(flp);
      const found = refs.length && window.studioAPI.flpSamples ? await window.studioAPI.flpSamples(refs) : [];
      const samples = new Map(found.map((f) => [f.ref, { name: f.name, data: f.data }]));
      transport.stop();
      const fileName = path.split(/[\\/]/).pop().replace(/\.flp$/i, '');
      const report = importFlp(store, flp, { name: fileName, samples });
      store.filePath = null; // saving writes an .osp beside it, never over the .flp
      store.finishLoad();
      store.dirty = true;
      app.autosave?.discard();
      const notes = [];
      notes.push(`FL Studio ${flp.version || '(unknown version)'} project: ${report.channels} channels, ${report.patterns} patterns, ${report.clips} playlist clips, ${flp.bpm} BPM.`);
      if (report.substituted.length) notes.push(`\nStand-ins for FL Studio plugins and missing samples:\n• ${report.substituted.slice(0, 14).join('\n• ')}${report.substituted.length > 14 ? `\n… and ${report.substituted.length - 14} more` : ''}`);
      if (report.skipped.length) notes.push(`\nEffects with no equivalent (left out): ${report.skipped.slice(0, 10).join(', ')}${report.skipped.length > 10 ? '…' : ''}`);
      if (report.missingSamples.length) notes.push(`\n${report.missingSamples.length} sample file(s) were not found next to the project. Use FL Studio's "Export project data files" (or zip the project with its samples) to bring them along.`);
      notes.push('\nPlugin settings, automation clips and mixer effect settings are not imported. Save to keep it as an OpenStudio project.');
      if (!window.studioAPI.testRun) messageDialog('Imported FL Studio project', notes.join('\n'));
      return report;
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

    /** Add a generator channel: 'drum' (preset = { name, voice }) or any engine in ENGINES (preset = { name, params }). */
    addChannel(type, preset) {
      if (type === 'drum') return store.addChannel({ name: preset.name, type: 'drum', voice: preset.voice });
      if (!ENGINES[type]) throw new Error(`Unknown channel type ${type}`);
      const p = preset || (type === 'synth' ? SYNTH_PRESETS.Leads[0] : null);
      return store.addChannel({ name: preset ? preset.name : ENGINES[type].label, type, preset: p ? p.params : null });
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
        ...Object.entries(ENGINES).map(([type, info]) => ({
          label: info.label,
          submenu: [
            { label: `Empty ${info.label.toLowerCase()}`, action: () => a.addChannel(type) },
            { separator: true },
            ...Object.entries(ENGINE_PRESETS[type]).map(([cat, list]) => ({ label: cat, submenu: list.map((pr) => ({ label: pr.name, action: () => a.addChannel(type, pr) })) })),
          ],
        })),
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
      for (const m of store.project.mixer) { m.vol = 0.8; m.pan = 0; m.mute = false; m.solo = false; m.fx = m.fx.map(() => null); m.sends = {}; }
      app.engine.syncAll();
      store.emit('mixer');
      store.emit('mixerSelection');
    },

    toggleBrowser() {
      document.getElementById('browser').classList.toggle('collapsed');
      document.getElementById('browser-splitter').classList.toggle('collapsed');
      app.emit('browser');
    },

    showShortcuts() {
      const groups = [...SHORTCUTS];
      const t = app.tiler;
      if (t) {
        const rows = ACTIONS.filter(([id]) => t.cfg.binds[id]?.length)
          .map(([id, label]) => [t.cfg.binds[id].map((b) => resolveCombo(b, t.cfg.mod)).join(' / '), label]);
        groups.splice(2, 0, [`Tiling windows${t.active ? '' : ' (off — first one turns it on)'}`, rows]);
      }
      shortcutsDialog('Keyboard shortcuts', groups);
    },

    showAbout() {
      messageDialog('About OpenStudio', 'OpenStudio 0.4\nAn open-source digital audio workstation inspired by the classic pattern-based workflow.\n\nBuilt with Electron and the Web Audio API.');
    },

    showAgents() { app.prefs?.open('agents'); },

    /**
     * Change the project's time signature ([beats, unit]). Notes stay where they are in time; patterns keep (at least)
     * their length, rounded up to whole bars of the new signature.
     */
    setTimeSignature(ts) {
      if (!validTimeSig(ts)) { messageDialog('Time signature', 'Use 1–32 beats per bar and a beat unit of 2, 4, 8 or 16.'); return false; }
      const p = store.project;
      if (p.timeSig[0] === ts[0] && p.timeSig[1] === ts[1]) return true;
      store.checkpoint();
      const lens = new Map(p.patterns.map((pat) => [pat, store.patternSteps(pat)]));
      p.timeSig = [ts[0], ts[1]];
      for (const [pat, len] of lens) pat.bars = Math.max(1, Math.ceil(len / store.barSteps - 1e-6));
      store.emit('settings');
      store.emit('patterns');
      store.emit('notes');
      store.emit('playlist');
      return true;
    },

    /**
     * Put a recorded take (AudioBuffer) into the playlist at `step` on the first free track. Stored as a 32-bit float
     * WAV, so nothing is lost. One undo step.
     */
    addAudioTake(buffer, step) {
      const taken = [...store.samples.values()].filter((s) => /^Take \d+/.test(s.name)).length;
      store.checkpoint();
      const id = store.addSample(`Take ${taken + 1}.wav`, encodeWav(buffer, { float: true }));
      store.samples.get(id).buffer = buffer;
      const tempo = transport.tempo;
      const start = Math.round(step * 1000) / 1000;
      const len = Math.max(0.25, Math.round((tempo.stepAt(tempo.timeAt(start) + buffer.duration) - start) * 1000) / 1000);
      const track = firstFreeTrack(start, len);
      const t = store.project.playlist.tracks[track];
      if (/^Track \d+$/.test(t.name)) t.name = 'Audio';
      const clip = store.addClip({ type: 'audio', sampleId: id, track, start, len, offset: 0 });
      store.emit('playlist');
      store.emit('sampleReady', id);
      return clip;
    },

    /**
     * Write a sliced sampler's slices into the current pattern as notes that play the loop back in time (FL's Slicex
     * "dump score"). The loop's length in bars is guessed from the sample's duration at the project tempo.
     */
    slicesToPattern(chId) {
      const ch = store.channel(chId);
      const s = ch && store.samples.get(ch.sampleId);
      if (!ch?.slices?.length || !s?.buffer) return null;
      const beatsPerBar = store.barSteps / 4;
      const bars = guessBars(s.buffer.duration, store.project.bpm, beatsPerBar);
      const pat = store.currentPattern;
      store.checkpoint();
      pat.notes[ch.id] = slicesToNotes(ch.slices, bars * store.barSteps, ch.rootPitch ?? 60);
      pat.bars = Math.max(pat.bars, bars);
      store.normalizePattern(pat);
      store.selectChannel(ch.id);
      store.emit('notes');
      store.emit('patterns');
      return pat;
    },

    /** Create an automation clip for a knob/fader and open its editor. */
    createAutomation(target) {
      const norm = valueToNorm(store, target, readTarget(store, target));
      store.checkpoint();
      const bar = store.barSteps;
      const auto = store.addAutomation({ name: describeTarget(store, target), target, value: norm, len: bar });
      const start = Math.floor(transport.startStep / bar) * bar;
      store.addClip({ type: 'auto', autoId: auto.id, track: firstFreeTrack(start, auto.len), start, len: auto.len });
      store.emit('playlist');
      app.wm.get('playlist').show();
      a.openAutomation(auto.id);
    },

    /** Import a .mid file as a new pattern (with its own channels); optionally place it in the playlist. */
    async importMidiFile(file = null, place = null) {
      file ??= await pickFile('.mid,.midi,.rmi,audio/midi');
      if (!file) return null;
      let midi;
      try {
        midi = parseMidi(await file.arrayBuffer());
      } catch (err) {
        messageDialog('Could not import MIDI file', err.message);
        return null;
      }
      const wasEmpty = store.project.channels.every((c) => !store.project.patterns.some((p) => p.notes[c.id]?.length))
        && !store.project.playlist.clips.length;
      store.checkpoint();
      let pat;
      try {
        pat = importMidi(store, midi, { name: file.name.replace(/\.(mid|midi|rmi)$/i, ''), setTempo: wasEmpty });
      } catch (err) {
        store.undo();
        messageDialog('Could not import MIDI file', err.message);
        return null;
      }
      const at = place ?? { track: firstFreeTrack(0, store.patternSteps(pat)), start: 0 };
      store.addClip({ type: 'pattern', pat: pat.id, track: at.track, start: at.start, len: store.patternSteps(pat) });
      store.emit('channels');
      store.emit('patterns');
      store.emit('selection');
      store.emit('notes');
      store.emit('playlist');
      store.emit('mixer');
      transport.emit('bpm');
      return pat;
    },

    async exportMidi() {
      const song = store.project.mode === 'song';
      const bytes = buildMidi(store, { song });
      await window.studioAPI.writeFile({ suggestedName: `${store.project.name}.mid`, data: bytes.buffer, filters: [{ name: 'MIDI file', extensions: ['mid'] }] });
    },

    loadDemo() { loadDemo(store, transport); },

    /** Mixer tracks worth a stem: anything a channel, a playlist track or a send feeds, or that has effects. */
    stemTracks() {
      const p = store.project;
      const used = new Set();
      for (const c of p.channels) if (c.mixer > 0) used.add(c.mixer);
      for (const t of p.playlist.tracks) if (t.mixer > 0) used.add(t.mixer);
      p.mixer.forEach((m, i) => {
        if (i === 0) return;
        for (const d of Object.keys(m.sends || {})) used.add(Number(d));
        if (m.fx.some(Boolean)) used.add(i);
      });
      return [...used].filter((i) => i > 0 && i < p.mixer.length).sort((x, y) => x - y);
    },

    /** Export one WAV per used mixer track plus the master into a folder (FL Studio's "split mixer tracks"). */
    async exportStems() {
      const proj = store.project;
      const steps = proj.mode === 'song' ? store.playlistEndStep() : store.patternSteps(store.currentPattern);
      if (steps <= 0) { messageDialog('Nothing to export', 'The playlist is empty — switch to pattern mode or add clips first.'); return null; }
      const tracks = a.stemTracks();
      if (!tracks.length) { messageDialog('Export stems', 'Nothing is routed to a mixer insert, so there are no stems to export.\n\nRoute channels to their own mixer tracks first (channel rack → the track number box).'); return null; }
      const dir = await window.studioAPI.pickFolder({ title: 'Export stems into…' });
      if (!dir) return null;
      transport.stop();
      app.toolbar?.setBusy?.('Rendering stems…');
      const dlg = progressDialog('Exporting stems', 'Preparing…');
      const abort = new AbortController();
      dlg.done.then(() => abort.abort());
      let res;
      try {
        res = await renderStems(store, steps, tracks, { signal: abort.signal, onProgress: (f) => dlg.set(f, `Rendering ${tracks.length} stems… ${Math.round(f * 100)}%`) });
      } catch (err) {
        if (err.name !== 'AbortError') messageDialog('Export failed', err.message);
        return null;
      } finally {
        dlg.close();
        app.toolbar?.setBusy?.(null);
      }
      const safe = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
      const files = [await window.studioAPI.writeInFolder({ dir, name: `${safe(proj.name)} - Master.wav`, data: encodeWav(res.master) })];
      for (const [i, buf] of res.stems) {
        files.push(await window.studioAPI.writeInFolder({ dir, name: `${safe(proj.name)} - ${String(i).padStart(2, '0')} ${safe(proj.mixer[i].name)}.wav`, data: encodeWav(buf) }));
      }
      return files;
    },

    async exportWav() { return a.exportAudio('wav'); },
    async exportFlac() { return a.exportAudio('flac'); },

    /** Render the song (or pattern) and save it as WAV or FLAC. */
    async exportAudio(format = 'wav') {
      const proj = store.project;
      const steps = proj.mode === 'song' ? store.playlistEndStep() : store.patternSteps(store.currentPattern);
      if (steps <= 0) { messageDialog('Nothing to export', 'The playlist is empty — switch to pattern mode or add clips first.'); return; }
      transport.stop();
      app.toolbar?.setBusy?.('Rendering…');
      const dlg = progressDialog('Exporting audio', 'Preparing…');
      const abort = new AbortController();
      dlg.done.then(() => abort.abort());
      let rendered;
      try {
        rendered = await renderSteps(store, steps, {
          signal: abort.signal,
          onProgress: (f) => dlg.set(f, `Rendering… ${Math.round(f * 100)}%`),
        });
      } catch (err) {
        if (err.name !== 'AbortError') messageDialog('Export failed', err.message);
        return;
      } finally {
        dlg.close();
        app.toolbar?.setBusy?.(null);
      }
      let data;
      if (format === 'flac') {
        const enc = progressDialog('Exporting audio', 'Encoding FLAC…');
        try { data = await encodeFlac(rendered, { onProgress: (f) => enc.set(f, `Encoding FLAC… ${Math.round(f * 100)}%`) }); } finally { enc.close(); }
      } else data = encodeWav(rendered);
      const filters = format === 'flac' ? [{ name: 'FLAC audio (lossless)', extensions: ['flac'] }] : [{ name: 'WAV audio', extensions: ['wav'] }];
      await window.studioAPI.writeFile({ suggestedName: `${proj.name}.${format}`, data, filters });
    },

  };
  return a;
}

/** Open the native file picker from the renderer (no main-process round trip needed). */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
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
