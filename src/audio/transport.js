import { Emitter } from '../util.js';
import { STEPS_PER_BEAT, barSteps, beatSteps } from '../state.js';
import { applyTarget, curveAt, normToValue, targetValid } from '../automation.js';
import { TempoMap } from '../tempo.js';

const LOOKAHEAD = 0.12; // seconds scheduled ahead
const TICK_MS = 25;

/**
 * Fire everything that starts on `step`: notes, audio clips, automation. Shared by live playback and
 * offline export. opts: { metronome, first, lengths } — `first` is true on the first step after a start/seek/loop
 * jump, so audio clips that are already running get started part-way in. `lengths` is an optional Map the caller
 * may keep for a short while (a scheduling tick, a render batch): pattern lengths are expensive (every note is
 * visited) and otherwise recomputed for every clip on every step.
 */
export function scheduleStep(store, engine, step, time, sd, opts = {}) {
  const proj = store.project;
  if (opts.metronome && step % beatSteps(proj) === 0) engine.click(time, step % barSteps(proj) === 0);
  if (engine.stepped?.size) engine.stepEffects(step, time, sd);

  const anySolo = proj.channels.some((c) => c.solo);
  const swing = proj.swing || 0;
  const lengthOf = (pat) => {
    let len = opts.lengths?.get(pat.id);
    if (len === undefined) { len = store.patternSteps(pat); opts.lengths?.set(pat.id, len); }
    return len;
  };
  const emit = (pat, local) => {
    const shift = Math.floor(local) % 2 === 1 ? swing * sd * 0.5 : 0;
    for (const ch of proj.channels) {
      if (ch.mute || (anySolo && !ch.solo)) continue;
      const notes = pat.notes[ch.id];
      if (!notes) continue;
      let slides = null;
      for (const n of notes) {
        if (n.m) continue;
        if (n.s >= local - 1e-6 && n.s < local + 1 - 1e-6) {
          // slide notes bend what is sounding, so they go after the notes that start with them
          if (n.sl) (slides ??= []).push(n);
          else engine.playNote(ch, n.p, n.v, time + shift + (n.s - local) * sd, n.l * sd, n.pan || n.fine || n.mx || n.my ? n : null);
        }
      }
      if (slides) for (const n of slides) engine.playNote(ch, n.p, n.v, time + shift + (n.s - local) * sd, n.l * sd, n);
    }
  };

  if (proj.mode === 'pattern') {
    const pat = store.currentPattern;
    if (pat) emit(pat, step % lengthOf(pat));
    return;
  }

  for (const clip of proj.playlist.clips) {
    if (clip.mute || step < clip.start || step >= clip.start + clip.len) continue;
    // opts.only: render just these clips (automation keeps applying)
    if (opts.only && clip.type !== 'auto' && !opts.only.has(clip.id)) continue;
    const track = proj.playlist.tracks[clip.track];
    if (track?.mute) continue;
    const type = clip.type || 'pattern';
    if (type === 'pattern') {
      const pat = store.pattern(clip.pat);
      if (!pat) continue;
      const len = lengthOf(pat);
      emit(pat, (((step - clip.start + clip.offset) % len) + len) % len);
    } else if (type === 'audio') {
      if (step !== clip.start && !(opts.first && step > clip.start)) continue;
      const sample = store.samples.get(clip.sampleId);
      if (!sample?.buffer) continue;
      const into = step - clip.start;
      // tempo-following clips: `stretch` keeps the pitch, `resample` speeds up / slows down like a record
      // `pitch` (semitones) shifts without changing the length: time-stretch by 1/r, then play r times faster
      const st = clip.stretch;
      const speed = st?.bpm > 0 ? 60 / (sd * 4) / st.bpm : 1;
      const r = clip.pitch ? 2 ** (clip.pitch / 12) : 1;
      const timeSpeed = (st?.mode === 'stretch' ? speed : 1) / r;
      let buffer = sample.buffer;
      const rate = (st?.mode === 'resample' ? speed : 1) * r;
      if (Math.abs(timeSpeed - 1) > 1e-4 && engine.stretchedBuffer) buffer = engine.stretchedBuffer(sample, timeSpeed);
      engine.playAudio(buffer, track?.mixer ?? 0, time, (clip.offset + into) * sd * rate, (clip.len - into) * sd, clip.gain ?? 1,
        { reverse: clip.reverse, fadeIn: (clip.fadeIn || 0) * sd, fadeOut: (clip.fadeOut || 0) * sd, into: into * sd, rate });
    } else if (type === 'auto') {
      const auto = store.automation(clip.autoId);
      if (!auto || auto.target?.kind === 'tempo' || !targetValid(store, auto.target)) continue; // tempo: see tempo.js
      const local = step - clip.start + (clip.offset || 0);
      const v0 = normToValue(store, auto.target, curveAt(auto.points, local));
      const v1 = normToValue(store, auto.target, curveAt(auto.points, local + 1));
      applyTarget(store, engine, auto.target, v0, time, v1, time + sd);
    }
  }
}

/**
 * Step-based sequencer. One "step" = a 16th note. Position is exposed in (fractional) steps.
 */
export class Transport extends Emitter {
  constructor(store, engine) {
    super();
    this.store = store;
    this.engine = engine;
    this.playing = false;
    this.recording = false;
    // what Record captures: notes from the keyboard / MIDI into the piano roll, audio input into the playlist
    this.recordNotes = globalThis.localStorage?.getItem('openstudio.recordNotes') !== '0';
    this.recordAudio = globalThis.localStorage?.getItem('openstudio.recordAudio') === '1';
    this.metronome = false;
    this.loopEnabled = false;
    this.jumped = true;
    this.startStep = 0; // where Stop returns to
    this.resumeStep = 0; // where Play resumes from
    this.nextStep = 0;
    this.nextTime = 0;
    this.timer = null;
    this.queue = []; // {time, step} history for UI position
    this.openRecordNotes = new Map();
    this.tempo = new TempoMap(store);
    // a new or loaded project stops playback; undo / redo keeps it going (the scheduler reads the project afresh on every step)
    store.on('project', (e) => { if (this.playing && !e?.history) this.stop(); });
  }

  get ctx() { return this.engine.ctx; }
  get bpm() { return this.store.project.bpm; }
  /** Length of a step at the project tempo (seconds). With tempo automation use `tempo.stepDur(step)`. */
  get stepDur() { return 60 / this.bpm / STEPS_PER_BEAT; }

  /** The tempo at the play position: follows tempo automation while the song plays. */
  currentBpm() { return this.tempo.bpm(this.position()); }
  get mode() { return this.store.project.mode; }

  setMode(mode) {
    if (this.store.project.mode === mode) return;
    this.store.project.mode = mode;
    this.emit('mode');
    this.emit('change');
  }

  toggleMode() { this.setMode(this.mode === 'pattern' ? 'song' : 'pattern'); }

  setBpm(bpm) {
    this.store.project.bpm = Math.min(522, Math.max(10, Math.round(bpm * 1000) / 1000));
    this.store.dirty = true;
    this.emit('bpm');
  }

  setMetronome(on) { this.metronome = on; this.emit('change'); }
  setLoop(on) { this.loopEnabled = on; this.emit('change'); }
  setRecording(on) { this.recording = on; this.emit('change'); }
  setRecordNotes(on) { this.recordNotes = on; globalThis.localStorage?.setItem('openstudio.recordNotes', on ? '1' : '0'); this.emit('change'); }
  setRecordAudio(on) { this.recordAudio = on; globalThis.localStorage?.setItem('openstudio.recordAudio', on ? '1' : '0'); this.emit('change'); }

  // -------------------------------------------------------------- control
  play() {
    if (this.playing) return;
    this.engine.ensure();
    this.playing = true;
    this.nextStep = Math.floor(this.resumeStep + 1e-6);
    this.nextTime = this.ctx.currentTime + 0.05;
    this.queue = [];
    this.jumped = true;
    this._tick();
    this.timer = setInterval(() => this._tick(), TICK_MS);
    this.emit('change');
  }

  pause() {
    if (!this.playing) return;
    this.resumeStep = this.position();
    this._halt();
    this.emit('change');
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  /** 'playing', 'paused' (stopped part-way through) or 'stopped' (at the start point). */
  get state() {
    if (this.playing) return 'playing';
    return Math.abs(this.resumeStep - this.startStep) > 1e-6 ? 'paused' : 'stopped';
  }

  /** Jump back to the very beginning and clear the start marker. Keeps playing if it was playing. */
  restart() { this.seek(0); }

  /**
   * How far the song runs, in steps: the last bar that has clips in song mode (the loop end while a loop is
   * on), the whole pattern in pattern mode. 0 when there is nothing to play.
   */
  get lengthSteps() {
    if (this.mode === 'pattern') return this.store.patternSteps(this.store.currentPattern);
    const loop = this.store.project.loop;
    if (this.loopEnabled && loop) return loop.end;
    const bar = this.store.barSteps;
    return Math.ceil(this.store.playlistEndStep() / bar) * bar;
  }

  stop() {
    this._halt();
    this.resumeStep = this.startStep;
    this.closeRecordNotes();
    this.emit('change');
  }

  _halt() {
    clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.engine.killAll();
  }

  seek(step, { setStart = true } = {}) {
    step = Math.max(0, step);
    this.resumeStep = step;
    if (setStart) this.startStep = step;
    if (this.playing) {
      this.engine.killAll();
      this.nextStep = Math.floor(step);
      this.nextTime = this.ctx.currentTime + 0.03;
      this.queue = [];
      this.jumped = true;
      this.emit('jump', { time: this.nextTime, step: this.nextStep });
    }
    this.emit('change');
  }

  // -------------------------------------------------------------- position
  /** Current play position in steps (fractional), based on the audio clock. */
  position() {
    if (!this.playing) return this.resumeStep;
    const now = this.ctx.currentTime;
    const q = this.queue;
    let i = q.length - 1;
    while (i > 0 && q[i].time > now) i--;
    if (i < 0 || q.length === 0) return this.resumeStep;
    const e = q[i];
    if (e.time > now) return Math.max(0, e.step - (e.time - now) / e.dur);
    return e.step + (now - e.time) / e.dur;
  }

  /** Position within the current pattern (pattern mode wraps). */
  patternPosition() {
    const pos = this.position();
    if (this.mode !== 'pattern') return pos;
    const len = this.store.patternSteps(this.store.currentPattern);
    return pos % len;
  }

  // ------------------------------------------------------------ scheduling
  _tick() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    this._lengths = new Map(); // valid for this tick only: the user may edit patterns between ticks
    while (this.nextTime < horizon) {
      if (this.mode === 'song') {
        const loop = this.store.project.loop;
        if (this.loopEnabled && loop) {
          if (this.nextStep >= loop.end) { this.nextStep = loop.start; this.jumped = true; }
        } else {
          // like FL Studio, the song wraps to the start once it runs past the last bar that has clips
          const end = this.lengthSteps;
          if (end > 0 && this.nextStep >= end) { this.nextStep = 0; this.jumped = true; }
        }
        // where the song continues somewhere else (loop recording splits takes there)
        if (this.jumped) this.emit('jump', { time: this.nextTime, step: this.nextStep });
      }
      const dur = this.tempo.stepDur(this.nextStep);
      this._scheduleStep(this.nextStep, this.nextTime, dur);
      this.jumped = false;
      this.queue.push({ time: this.nextTime, step: this.nextStep, dur });
      this.nextTime += dur;
      this.nextStep++;
    }
    const cutoff = this.ctx.currentTime - 1;
    while (this.queue.length > 2 && this.queue[1].time < cutoff) this.queue.shift();
  }

  _scheduleStep(step, time, dur) {
    scheduleStep(this.store, this.engine, step, time, dur, { metronome: this.metronome, first: this.jumped, lengths: this._lengths });
  }

  // -------------------------------------------------------------- recording
  /**
   * Where a live note lands in the selected pattern, in pattern-local steps. Pattern mode records at the
   * pattern position; song mode records into the selected pattern where one of its clips is playing.
   */
  _recordPos() {
    const pat = this.store.currentPattern;
    if (!pat) return null;
    const len = this.store.patternSteps(pat);
    if (this.mode === 'pattern') return { pat, pos: this.patternPosition(), len };
    const pos = this.position();
    const clip = this.store.project.playlist.clips.find((c) => (c.type || 'pattern') === 'pattern' && c.pat === pat.id && !c.mute && pos >= c.start && pos < c.start + c.len);
    if (!clip) return null;
    return { pat, pos: (((pos - clip.start + clip.offset) % len) + len) % len, len };
  }

  recordNoteOn(ch, pitch, vel) {
    if (!this.recording || !this.recordNotes || !this.playing) return;
    const at = this._recordPos();
    if (!at) return;
    const snapped = Math.round(at.pos * 4) / 4;
    this.store.checkpoint();
    const note = this.store.addNote(at.pat, ch.id, { p: pitch, s: snapped % at.len, l: 0.25, v: vel });
    this.openRecordNotes.set(`${ch.id}:${pitch}`, { note, startPos: at.pos, pat: at.pat });
    this.store.emit('notes');
  }

  recordNoteOff(ch, pitch) {
    const open = this.openRecordNotes.get(`${ch.id}:${pitch}`);
    if (!open) return;
    this.openRecordNotes.delete(`${ch.id}:${pitch}`);
    const at = this._recordPos();
    const len = at && at.pat === open.pat ? at.pos - open.startPos : 0.25;
    open.note.l = Math.max(0.25, Math.round((len < 0 ? len + this.store.patternSteps(open.pat) : len) * 4) / 4);
    this.store.normalizePattern(open.pat);
    this.store.emit('notes');
  }

  closeRecordNotes() {
    for (const [, open] of this.openRecordNotes) open.note.l = Math.max(open.note.l, 0.25);
    this.openRecordNotes.clear();
  }

  // ---------------------------------------------------------------- format
  /** Seconds from the song start to `step` (follows tempo automation). */
  secondsAt(step) { return this.mode === 'song' ? this.tempo.timeAt(step) : step * this.stepDur; }

  formatTime(step) {
    const sec = this.secondsAt(step);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.floor((sec * 100) % 100);
    return { m, s, cs };
  }

  formatBst(step) {
    const barLen = this.store.barSteps;
    const beatLen = this.store.beatSteps;
    const bar = Math.floor(step / barLen) + 1;
    const beat = Math.floor((step % barLen) / beatLen) + 1;
    const tick = Math.floor(((step % beatLen) / beatLen) * 96);
    return { bar, beat, tick };
  }
}
