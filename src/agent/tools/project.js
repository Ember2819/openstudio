import { bool, choice, int, maybe, num, obj, str } from '../schema.js';
import { edit, fail } from '../helpers.js';
import { summarize, transportInfo } from '../describe.js';
import { importMidi, parseMidi } from '../../midiimport.js';
import { buildMidi } from '../../midifile.js';
import { parseFlp, importFlp, flpSamplePaths } from '../../flp.js';
import { STEPS_PER_BAR } from '../../state.js';

const RO = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/** Refuse to throw away the user's unsaved work unless the agent says so explicitly. */
function guardUnsaved(store, force, what) {
  if (store.dirty && !force) fail(`The project has unsaved changes. Save it first (save_project), or pass force: true to ${what} anyway and discard them.`);
}

const setTitle = (app) => globalThis.window?.studioAPI?.setTitle(`${app.store.dirty ? '*' : ''}${app.store.project.name} — OpenStudio`);

async function writeProject(app, path) {
  const { store } = app;
  // the file carries the name it is saved under, so it reopens with the same name
  const previous = store.project.name;
  store.project.name = path.split(/[\\/]/).pop().replace(/\.osp$/i, '');
  let saved;
  try {
    saved = await app.files.write(path, store.serialize());
  } catch (err) {
    store.project.name = previous;
    throw err;
  }
  store.filePath = saved;
  store.dirty = false;
  store.emit('project-saved');
  store.emit('patterns'); // refreshes the toolbar title
  setTitle(app);
  return saved;
}

async function openFlp(app, path) {
  let flp;
  try { flp = parseFlp(await app.files.read(path)); } catch (err) { fail(`Could not open ${path}: ${err.message}`); }
  const dir = path.replace(/[\\/][^\\/]*$/, '');
  const samples = new Map();
  for (const ref of flpSamplePaths(flp)) {
    const base = ref.split(/[\\/]/).pop();
    for (const candidate of [ref, `${dir}/${base}`, `${dir}/Samples/${base}`]) {
      if (candidate.includes('%')) continue;
      try { samples.set(ref, { name: base, data: await app.files.read(candidate) }); break; } catch { /* try the next place */ }
    }
  }
  app.transport.stop();
  const report = importFlp(app.store, flp, { name: path.split(/[\\/]/).pop().replace(/\.flp$/i, ''), samples });
  app.store.filePath = null;
  app.store.finishLoad();
  app.store.dirty = true;
  app.autosave?.discard();
  setTitle(app);
  return { ...summarize(app), imported: { flVersion: flp.version, ...report } };
}

export const tools = [
  {
    name: 'get_project',
    title: 'Get project',
    description: 'Overview of the open project: tempo, mode, loop, channels (with their settings), patterns, playlist summary, the mixer tracks in use, automations, samples, transport state and unsaved-changes flag. Call this first. Use get_pattern for notes, get_playlist for clips.',
    inputSchema: obj({}),
    annotations: { ...RO, title: 'Get project' },
    run: (_, app) => summarize(app),
  },
  {
    name: 'set_project',
    title: 'Project settings',
    description: 'Change project-level settings: name, tempo, swing, master pitch, pattern/song mode, the loop region (start/end in steps, or null to clear), loop playback and the metronome. Only the fields you pass change.',
    inputSchema: obj({
      name: str('Project name'),
      bpm: num('Tempo in beats per minute', { minimum: 10, maximum: 522 }),
      swing: num('Swing amount 0-1 (shifts every second step)', { minimum: 0, maximum: 1 }),
      masterPitch: int('Master transposition in semitones', { minimum: -12, maximum: 12 }),
      mode: choice(['pattern', 'song'], '"pattern" loops the selected pattern, "song" plays the playlist'),
      loop: maybe(obj({ start: num('Loop start in steps', { minimum: 0 }), end: num('Loop end in steps', { minimum: 0 }) }, ['start', 'end'])),
      loopEnabled: bool('Whether playback honours the loop region (song mode)'),
      metronome: bool('Metronome click during playback'),
    }),
    annotations: { ...WRITE, idempotentHint: true, title: 'Project settings' },
    run(a, app) {
      const { store, transport } = app;
      const p = store.project;
      if (a.loop && !(a.loop.end > a.loop.start)) fail('loop.end must be greater than loop.start');
      edit(store, () => {
        if (a.name !== undefined) { p.name = a.name.trim() || p.name; store.emit('patterns'); setTitle(app); }
        if (a.bpm !== undefined) transport.setBpm(a.bpm);
        if (a.swing !== undefined) p.swing = a.swing;
        if (a.masterPitch !== undefined) p.masterPitch = a.masterPitch;
        if (a.mode !== undefined) transport.setMode(a.mode);
        if (a.loop !== undefined) { p.loop = a.loop ? { start: a.loop.start, end: a.loop.end } : null; store.emit('loop'); }
      });
      if (a.loopEnabled !== undefined) transport.setLoop(a.loopEnabled);
      if (a.metronome !== undefined) transport.setMetronome(a.metronome);
      store.emit('settings');
      return { name: p.name, bpm: p.bpm, swing: p.swing, masterPitch: p.masterPitch, mode: p.mode, loop: p.loop, loopEnabled: transport.loopEnabled, metronome: transport.metronome };
    },
  },
  {
    name: 'new_project',
    title: 'New project',
    description: 'Start a new project (a small default drum rack), or the demo song. Refuses while there are unsaved changes unless force is true.',
    inputSchema: obj({ demo: bool('Load the demo song instead of an empty project'), force: bool('Discard unsaved changes') }),
    annotations: { ...WRITE, destructiveHint: true, title: 'New project' },
    run(a, app) {
      guardUnsaved(app.store, a.force, 'start a new project');
      app.transport.stop();
      if (a.demo) app.actions.loadDemo(); else app.store.resetToDefault();
      app.store.filePath = null;
      app.autosave?.discard();
      setTitle(app);
      return summarize(app);
    },
  },
  {
    name: 'open_project',
    title: 'Open project',
    description: 'Open an .osp project file from an absolute path, or import an FL Studio .flp project (patterns, notes, playlist, channels, mixer; FL plugins get built-in stand-ins, samples are looked for beside the project). Refuses while there are unsaved changes unless force is true.',
    inputSchema: obj({ path: str('Absolute path of the .osp or .flp file'), force: bool('Discard unsaved changes') }, ['path']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Open project' },
    async run(a, app) {
      guardUnsaved(app.store, a.force, 'open another project');
      if (/\.flp$/i.test(a.path)) return openFlp(app, a.path);
      const text = new TextDecoder().decode(await app.files.read(a.path));
      app.transport.stop();
      try { app.store.load(text, a.path); } catch (err) { fail(`Could not open ${a.path}: ${err.message}`); }
      app.autosave?.discard();
      setTitle(app);
      return summarize(app);
    },
  },
  {
    name: 'save_project',
    title: 'Save project',
    description: 'Save the project to an .osp file. Without a path it saves over the file it was opened from or last saved to.',
    inputSchema: obj({ path: str('Absolute path ending in .osp (optional when the project already has a file)') }),
    annotations: { ...WRITE, idempotentHint: true, openWorldHint: false, title: 'Save project' },
    async run(a, app) {
      const target = a.path ?? app.store.filePath ?? fail('This project has no file yet — pass a path');
      const path = await writeProject(app, /\.osp$/i.test(target) ? target : `${target}.osp`);
      return { path };
    },
  },
  {
    name: 'import_midi',
    title: 'Import MIDI',
    description: 'Import a Standard MIDI File as a new pattern with one channel per track/MIDI channel (channel 10 becomes a drum kit), and place it in the playlist. On an empty project the file\'s tempo is used.',
    inputSchema: obj({
      path: str('Absolute path of the .mid file'),
      track: int('Playlist track for the new clip (default: first free track)', { minimum: 0, maximum: 124 }),
      start: num('Playlist start in steps (default 0)', { minimum: 0 }),
    }, ['path']),
    annotations: { ...WRITE, title: 'Import MIDI' },
    async run(a, app) {
      const { store } = app;
      let parsed;
      try { parsed = parseMidi(await app.files.read(a.path)); } catch (err) { fail(`Could not read MIDI file: ${err.message}`); }
      const empty = store.project.channels.every((c) => !store.project.patterns.some((p) => p.notes[c.id]?.length)) && !store.project.playlist.clips.length;
      const name = a.path.split(/[\\/]/).pop().replace(/\.(mid|midi|rmi)$/i, '');
      const pat = edit(store, () => {
        const made = importMidi(store, parsed, { name, setTempo: empty });
        const len = store.patternSteps(made);
        const start = a.start ?? 0;
        let track = a.track ?? 0;
        if (a.track === undefined) while (store.project.playlist.clips.some((c) => c.track === track && c.start < start + len && c.start + c.len > start)) track++;
        store.addClip({ type: 'pattern', pat: made.id, track, start, len });
        return made;
      });
      for (const evt of ['channels', 'patterns', 'selection', 'notes', 'playlist', 'mixer']) store.emit(evt);
      app.transport.emit('bpm');
      return { pattern: pat.id, name: pat.name, bars: pat.bars, channels: store.project.channels.filter((c) => pat.notes[c.id]?.length).map((c) => c.id) };
    },
  },
  {
    name: 'export_midi',
    title: 'Export MIDI',
    description: 'Write the project (the selected pattern, or the whole playlist in song mode) to a Standard MIDI File.',
    inputSchema: obj({ path: str('Absolute path of the .mid file to write'), scope: choice(['auto', 'pattern', 'song'], 'auto = follow the project mode (default)') }, ['path']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Export MIDI' },
    async run(a, app) {
      const song = (a.scope ?? 'auto') === 'auto' ? app.store.project.mode === 'song' : a.scope === 'song';
      const bytes = buildMidi(app.store, { song });
      return { path: await app.files.write(a.path, bytes), bytes: bytes.byteLength };
    },
  },
  {
    name: 'history',
    title: 'Undo / redo',
    description: 'Undo or redo the last edit(s), exactly like Ctrl+Z / Ctrl+Y. Every mutating tool call is one undo step. Includes edits the user made by hand.',
    inputSchema: obj({ action: choice(['undo', 'redo'], 'Direction'), steps: int('How many steps (default 1)', { minimum: 1, maximum: 100 }) }, ['action']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Undo / redo' },
    run(a, app) {
      let done = 0;
      for (let i = 0; i < (a.steps ?? 1); i++) { if (!(a.action === 'undo' ? app.store.undo() : app.store.redo())) break; done++; }
      return { done, canUndo: app.store.undoStack.length > 0, canRedo: app.store.redoStack.length > 0 };
    },
  },
  {
    name: 'transport',
    title: 'Transport',
    description: 'Control playback (it plays through the user\'s speakers) or read the position. "seek" moves the playhead to `step` (steps) or `bar` (1-based). Returns the transport state after the action.',
    inputSchema: obj({
      action: choice(['play', 'pause', 'stop', 'toggle', 'seek', 'status'], 'What to do'),
      step: num('Seek target in steps', { minimum: 0 }),
      bar: num('Seek target as a 1-based bar number (bar 1 = the start)', { minimum: 1 }),
    }, ['action']),
    annotations: { ...WRITE, idempotentHint: false, title: 'Transport' },
    run(a, app) {
      const t = app.transport;
      switch (a.action) {
        case 'play': t.play(); break;
        case 'pause': t.pause(); break;
        case 'stop': t.stop(); break;
        case 'toggle': t.togglePlay(); break;
        case 'seek': {
          if (a.step === undefined && a.bar === undefined) fail('seek needs step or bar');
          t.seek(a.step ?? (a.bar - 1) * STEPS_PER_BAR);
          break;
        }
        default: break;
      }
      return transportInfo(app);
    },
  },
];
