import { Emitter, COLORS, ROOT_NOTE, arrayBufferToBase64, base64ToArrayBuffer } from './util.js';
import { defaultParams } from './audio/instruments.js';

export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16; // in 4/4; a project's bar length is barSteps(project)
export const MIXER_TRACKS = 126; // 0 = master, 1..125 inserts
export const PLAYLIST_TRACKS = 125;

const makeMixer = () =>
  Array.from({ length: MIXER_TRACKS }, (_, i) => ({
    name: i === 0 ? 'Master' : `Insert ${i}`,
    vol: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    color: null,
    fx: Array.from({ length: 10 }, () => null), // {type, params, on}
    sends: {}, // destination track -> level (fader law)
  }));

// Time signature: [beats per bar, beat unit]. A step is always a 16th note, so a beat is 16 / unit steps.
export const TIME_SIG_UNITS = [2, 4, 8, 16];
export const validTimeSig = (ts) => Array.isArray(ts) && Number.isInteger(ts[0]) && ts[0] >= 1 && ts[0] <= 32 && TIME_SIG_UNITS.includes(ts[1]);
export const beatSteps = (proj) => 16 / (validTimeSig(proj?.timeSig) ? proj.timeSig[1] : 4);
export const barSteps = (proj) => (validTimeSig(proj?.timeSig) ? proj.timeSig[0] : 4) * beatSteps(proj);

const makeTracks = () => Array.from({ length: PLAYLIST_TRACKS }, (_, i) => ({ name: `Track ${i + 1}`, color: null, mute: false, mixer: 0 }));

export function blankProject() {
  const p = {
    version: 1,
    name: 'Untitled',
    bpm: 130,
    timeSig: [4, 4],
    masterPitch: 0,
    mode: 'pattern',
    nextId: 1,
    channels: [],
    patterns: [],
    mixer: makeMixer(),
    playlist: { tracks: makeTracks(), clips: [] },
    automations: [],
    markers: [], // time markers in the playlist: { id, step, name }
    loop: null, // { start, end } in steps
    swing: 0,
    selected: { channel: null, pattern: null, mixer: 0 },
  };
  return p;
}

export class Store extends Emitter {
  constructor() {
    super();
    this.rev = 0; // bumped on every event: lets caches (the tempo map) know the project may have changed
    this.project = blankProject();
    this.samples = new Map(); // sampleId -> { name, data: ArrayBuffer, buffer: AudioBuffer|null }
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.filePath = null;
    this.resetToDefault();
  }

  uid() { return this.project.nextId++; }

  emit(evt, data) {
    this.rev++;
    super.emit(evt, data);
  }

  // ---------- project lifecycle ----------
  resetToDefault() {
    this.project = blankProject();
    this.samples.clear();
    const kit = [
      ['Kick', 36, 1],
      ['Clap', 39, 2],
      ['Hat', 42, 3],
      ['Snare', 38, 4],
    ];
    for (const [name, fixedKey, mixer] of kit) this._addChannel({ name, type: 'sf', bank: 128, program: 25, fixedKey, mixer });
    const pat = this._addPattern();
    this.project.selected.channel = this.project.channels[0].id;
    this.project.selected.pattern = pat.id;
    this.finishLoad();
  }

  finishLoad() {
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit('project');
  }

  snapshot() { return JSON.stringify(this.project); }

  checkpoint() {
    const snap = this.snapshot();
    // clicks that end up changing nothing (or double-clicks) would otherwise leave no-op undo steps
    if (this.undoStack[this.undoStack.length - 1] !== snap) this.undoStack.push(snap);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.project = JSON.parse(this.undoStack.pop());
    this.emit('project', { history: true });
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.project = JSON.parse(this.redoStack.pop());
    this.emit('project', { history: true });
    return true;
  }

  serialize() {
    const samples = {};
    for (const [id, s] of this.samples) samples[id] = { name: s.name, data: arrayBufferToBase64(s.data) };
    return JSON.stringify({ ...this.project, samples });
  }

  load(text, filePath = null) {
    const raw = JSON.parse(text);
    if (!raw || !Array.isArray(raw.channels) || !Array.isArray(raw.patterns)) throw new Error('Not an OpenStudio project');
    const { samples = {}, ...project } = raw;
    const base = blankProject();
    this.project = { ...base, ...project, mixer: this._mergeMixer(base.mixer, project.mixer) };
    this._normalizeLoaded(base, Object.keys(samples).map(Number));
    this.samples.clear();
    for (const [id, s] of Object.entries(samples)) this.samples.set(Number(id), { name: s.name, data: base64ToArrayBuffer(s.data), buffer: null });
    this.filePath = filePath;
    this.finishLoad();
  }

  /** Fill in anything an older or hand-edited file is missing so the rest of the app can rely on it. */
  _normalizeLoaded(base, sampleIds = []) {
    const p = this.project;
    p.selected = { ...base.selected, ...(p.selected || {}) };
    p.automations = Array.isArray(p.automations) ? p.automations : [];
    p.markers = (Array.isArray(p.markers) ? p.markers : []).filter((m) => m && Number.isFinite(m.step) && m.step >= 0)
      .map((m) => ({ id: m.id, step: m.step, name: String(m.name ?? 'Marker') }));
    const pl = p.playlist && typeof p.playlist === 'object' ? p.playlist : {};
    const tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
    p.playlist = {
      tracks: base.playlist.tracks.map((t, i) => ({ ...t, ...(tracks[i] || {}), mixer: tracks[i]?.mixer ?? 0 })),
      clips: (Array.isArray(pl.clips) ? pl.clips : []).filter((c) => c && Number.isFinite(c.start) && Number.isFinite(c.len) && c.len > 0),
    };
    for (const c of p.playlist.clips) {
      c.type ||= 'pattern';
      c.offset ??= 0;
      c.track = Math.min(Math.max(0, c.track | 0), PLAYLIST_TRACKS - 1);
    }
    for (const pat of p.patterns) {
      pat.notes ||= {};
      pat.bars = Math.max(1, pat.bars | 0);
    }
    for (const ch of p.channels) {
      ch.params = { ...defaultParams(ch.type, ch.voice), ...(ch.params || {}) };
      if (!Number.isFinite(ch.vol)) ch.vol = 0.78;
      if (!Number.isFinite(ch.pan)) ch.pan = 0;
      ch.color ||= COLORS[(ch.id * 5) % COLORS.length];
      ch.rootPitch ??= ROOT_NOTE;
      if (!(ch.mixer >= 0 && ch.mixer < MIXER_TRACKS)) ch.mixer = 0;
      // sampler slices: sorted fractions starting at 0
      if (ch.slices !== undefined && !(Array.isArray(ch.slices) && ch.slices.length && ch.slices.every((x, i) => Number.isFinite(x) && x >= 0 && x < 1 && (i === 0 || x > ch.slices[i - 1])))) delete ch.slices;
    }
    if (!p.patterns.length) this._addPattern();
    if (!this.pattern(p.selected.pattern)) p.selected.pattern = p.patterns[0].id;
    if (!this.channel(p.selected.channel)) p.selected.channel = p.channels[0]?.id ?? null;
    if (!(p.selected.mixer >= 0 && p.selected.mixer < MIXER_TRACKS)) p.selected.mixer = 0;
    // ids must stay unique even if nextId was lost
    let maxId = 0;
    const seen = (id) => { if (Number.isFinite(id)) maxId = Math.max(maxId, id); };
    p.channels.forEach((c) => seen(c.id));
    p.patterns.forEach((x) => seen(x.id));
    p.playlist.clips.forEach((c) => seen(c.id));
    p.automations.forEach((a) => seen(a.id));
    p.markers.forEach((m) => seen(m.id));
    sampleIds.forEach(seen);
    p.nextId = Math.max(p.nextId || 1, maxId + 1);
    for (const m of p.markers) if (!Number.isFinite(m.id)) m.id = p.nextId++;
    if (!Number.isFinite(p.bpm) || p.bpm <= 0) p.bpm = base.bpm;
    if (!validTimeSig(p.timeSig)) p.timeSig = [4, 4];
  }

  _mergeMixer(base, saved) {
    if (!Array.isArray(saved)) return base;
    return base.map((b, i) => {
      const m = saved[i];
      if (!m) return b;
      const out = { ...b, ...m, fx: b.fx.map((_, k) => m.fx?.[k] ?? null), sends: m.sends ?? {} };
      if (!Number.isFinite(out.vol)) out.vol = b.vol;
      if (!Number.isFinite(out.pan)) out.pan = b.pan;
      return out;
    });
  }

  // ---------- accessors ----------
  channel(id) { return this.project.channels.find((c) => c.id === id) || null; }
  pattern(id) { return this.project.patterns.find((p) => p.id === id) || null; }
  get currentPattern() { return this.pattern(this.project.selected.pattern) || this.project.patterns[0]; }
  get selectedChannel() { return this.channel(this.project.selected.channel) || this.project.channels[0] || null; }

  notesOf(pat, chId) {
    if (!pat.notes[chId]) pat.notes[chId] = [];
    return pat.notes[chId];
  }

  patternSteps(pat) {
    let end = 0;
    for (const list of Object.values(pat.notes)) for (const n of list) end = Math.max(end, n.s + n.l);
    const bar = barSteps(this.project);
    return Math.max(pat.bars, Math.ceil(end / bar - 1e-6)) * bar;
  }

  /** Steps in a bar / a beat of the project's time signature. */
  get barSteps() { return barSteps(this.project); }
  get beatSteps() { return beatSteps(this.project); }

  /** Grow the pattern if a note extends past its end (like FL's auto-extending patterns). */
  normalizePattern(pat) {
    let end = 0;
    for (const list of Object.values(pat.notes)) for (const n of list) end = Math.max(end, n.s + n.l);
    pat.bars = Math.max(pat.bars, Math.ceil(end / barSteps(this.project) - 1e-6), 1);
  }

  // ---------- channels ----------
  _addChannel({ name, type, voice = null, preset = null, mixer = 0, sampleId = null, color = null, bank = 0, program = 0, fixedKey = null, rootPitch = ROOT_NOTE }) {
    const id = this.uid();
    const ch = {
      id,
      name,
      type, // 'sf' | 'drum' | 'sampler' | a generator from ENGINES (synth, fm, organ, pluck, sfx)
      voice,
      params: { ...defaultParams(type, voice), ...(preset || {}) },
      vol: 0.78,
      pan: 0,
      mixer,
      mute: false,
      solo: false,
      color: color || COLORS[(id * 5) % COLORS.length],
      sampleId,
      rootPitch,
    };
    if (type === 'sf') Object.assign(ch, { bank, program, fixedKey });
    this.project.channels.push(ch);
    return ch;
  }

  addChannel(spec) {
    this.checkpoint();
    const ch = this._addChannel(spec);
    this.project.selected.channel = ch.id;
    this.emit('channels');
    this.emit('selection');
    return ch;
  }

  removeChannel(id) {
    this.checkpoint();
    const i = this.project.channels.findIndex((c) => c.id === id);
    if (i < 0) return;
    this.project.channels.splice(i, 1);
    for (const p of this.project.patterns) delete p.notes[id];
    if (this.project.selected.channel === id) this.project.selected.channel = this.project.channels[Math.max(0, i - 1)]?.id ?? null;
    this.emit('channels');
    this.emit('selection');
    this.emit('notes');
  }

  cloneChannel(id) {
    const src = this.channel(id);
    if (!src) return null;
    this.checkpoint();
    const copy = { ...JSON.parse(JSON.stringify(src)), id: this.uid(), name: `${src.name} #2` };
    const idx = this.project.channels.indexOf(src);
    this.project.channels.splice(idx + 1, 0, copy);
    for (const p of this.project.patterns) {
      if (p.notes[id]) p.notes[copy.id] = p.notes[id].map((n) => ({ ...n }));
    }
    this.project.selected.channel = copy.id;
    this.emit('channels');
    this.emit('selection');
    this.emit('notes');
    return copy;
  }

  /** Move a channel up (-1) or down (+1) in the rack. */
  moveChannel(id, dir) {
    const list = this.project.channels;
    const i = list.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    this.checkpoint();
    [list[i], list[j]] = [list[j], list[i]];
    this.emit('channels');
    return true;
  }

  /** Lowest-numbered insert track that no channel or playlist track is routed to (null when all are used). */
  freeMixerTrack() {
    const used = new Set(this.project.channels.map((c) => c.mixer));
    for (const t of this.project.playlist.tracks) used.add(t.mixer);
    for (let i = 1; i < MIXER_TRACKS; i++) {
      const m = this.project.mixer[i];
      if (!used.has(i) && !m.fx.some(Boolean) && !Object.keys(m.sends).length) return i;
    }
    return null;
  }

  selectChannel(id) {
    if (this.project.selected.channel === id) return;
    this.project.selected.channel = id;
    this.emit('selection');
  }

  // ---------- patterns ----------
  _addPattern(name) {
    const id = this.uid();
    const n = this.project.patterns.length + 1;
    const pat = { id, name: name || `Pattern ${n}`, color: COLORS[(n - 1 + 3) % COLORS.length], bars: 1, notes: {} };
    this.project.patterns.push(pat);
    return pat;
  }

  addPattern(name) {
    this.checkpoint();
    const pat = this._addPattern(name);
    this.project.selected.pattern = pat.id;
    this.emit('patterns');
    this.emit('selection');
    return pat;
  }

  clonePattern(id) {
    const src = this.pattern(id);
    if (!src) return null;
    this.checkpoint();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = this.uid();
    copy.name = `${src.name} (copy)`;
    this.project.patterns.splice(this.project.patterns.indexOf(src) + 1, 0, copy);
    this.project.selected.pattern = copy.id;
    this.emit('patterns');
    this.emit('selection');
    return copy;
  }

  removePattern(id) {
    if (this.project.patterns.length <= 1) return false;
    this.checkpoint();
    const i = this.project.patterns.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.project.patterns.splice(i, 1);
    this.project.playlist.clips = this.project.playlist.clips.filter((c) => c.type !== 'pattern' || c.pat !== id);
    if (this.project.selected.pattern === id) this.project.selected.pattern = this.project.patterns[Math.max(0, i - 1)].id;
    this.emit('patterns');
    this.emit('playlist');
    this.emit('selection');
    return true;
  }

  selectPattern(id) {
    if (this.project.selected.pattern === id || !this.pattern(id)) return;
    this.project.selected.pattern = id;
    this.emit('selection');
  }

  stepPattern(dir) {
    const list = this.project.patterns;
    const i = list.findIndex((p) => p.id === this.project.selected.pattern);
    const next = list[(i + dir + list.length) % list.length];
    this.selectPattern(next.id);
  }

  // ---------- notes ----------
  addNote(pat, chId, note) {
    const n = { p: note.p, s: note.s, l: note.l, v: note.v ?? 0.78 };
    // per-note extras survive copy / paste / duplicate
    if (note.pan) n.pan = note.pan;
    if (note.fine) n.fine = note.fine;
    if (note.m) n.m = true;
    this.notesOf(pat, chId).push(n);
    this.normalizePattern(pat);
    return n;
  }

  toggleStep(pat, chId, step, on) {
    const list = this.notesOf(pat, chId);
    const hits = list.filter((n) => n.s >= step - 1e-6 && n.s < step + 1 - 1e-6);
    if (on === undefined) on = hits.length === 0;
    if (on && hits.length === 0) {
      list.push({ p: this.channel(chId)?.rootPitch ?? ROOT_NOTE, s: step, l: 1, v: 0.78 });
      this.normalizePattern(pat);
    } else if (!on && hits.length) {
      pat.notes[chId] = list.filter((n) => !hits.includes(n));
    }
    this.emit('notes');
  }

  // ---------- playlist ----------
  addClip(clip) {
    const c = { type: 'pattern', offset: 0, mute: false, ...clip, id: this.uid() };
    this.project.playlist.clips.push(c);
    return c;
  }

  // ---------- mixer routing ----------
  /** Would sending `from` -> `to` create a feedback loop? */
  wouldCycle(from, to) {
    if (from === to) return true;
    const stack = [to];
    const seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (n === from) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const d of Object.keys(this.project.mixer[n].sends || {})) stack.push(Number(d));
    }
    return false;
  }

  // ---------- automation ----------
  automation(id) { return this.project.automations.find((a) => a.id === id) || null; }

  addAutomation({ name, target, value, len = 16 }) {
    const a = { id: this.uid(), name, color: '#c9a04f', target, len, points: [{ x: 0, y: value }, { x: len, y: value }] };
    this.project.automations.push(a);
    return a;
  }

  playlistEndStep() {
    let end = 0;
    for (const c of this.project.playlist.clips) end = Math.max(end, c.start + c.len);
    return end;
  }

  // ---------- samples ----------
  addSample(name, data) {
    const id = this.uid();
    this.samples.set(id, { name, data, buffer: null });
    return id;
  }
}
