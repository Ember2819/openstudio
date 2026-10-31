import { playDrum, playSynth, playFm, playOrgan, playPluck, playSfx, playSample, playWavetable, reversed, PARAM_META } from './instruments.js';
import { SoundFont } from './sf2.js';
import { wsola } from './stretch.js';
import { pickZones } from './zones.js';
import { playSoundfont } from './soundfont.js';
import { createEffect, loadEffectWorklets, compressorMakeupDb } from './effects.js';
import { faderToGain, channelGain, ROOT_NOTE } from '../util.js';
import { MIXER_TRACKS } from '../state.js';

let sharedSoundfont = null;
let soundfontLoading = null;
export const getSoundfont = () => sharedSoundfont;

/** Load the bundled GeneralUser GS bank once (shared between the live and offline engines). */
export function loadSoundfont() {
  if (!soundfontLoading) {
    soundfontLoading = window.studioAPI.readAsset('soundfonts/GeneralUser-GS.sf2').then((buf) => {
      sharedSoundfont = new SoundFont(buf);
      return sharedSoundfont;
    });
  }
  return soundfontLoading;
}

const MAX_VOICES = 160;
const SILENT = Object.freeze([0, 0]);

/** Several voices that start and stop together (layered sampler zones) as one. */
function layered(parts) {
  const v = {
    nodes: parts.flatMap((p) => p.nodes), out: parts[0].out, released: false,
    pitchParams: parts.flatMap((p) => p.pitchParams ?? []),
    get end() { return Math.max(...parts.map((p) => p.end)); },
    set end(_) { /* each part keeps its own */ },
    release: (when) => { v.released = true; for (const p of parts) p.release(when); },
  };
  return v;
}

/**
 * Per-note Mod X / Mod Y. Instruments with a cutoff (and resonance) control get those moved (X: up to four octaves
 * either way; Y: up to half the resonance range); the rest get a per-note low-pass when X closes it or Y adds
 * resonance.
 */
export function modParams(ch, mx, my) {
  const meta = PARAM_META[ch.type] || [];
  const cut = meta.find((m) => m.key === 'cutoff');
  const res = meta.find((m) => m.key === 'res');
  const out = {};
  let freq = 20000 * 2 ** (Math.min(0, mx) * 8); // no cutoff control: X only closes a per-note filter
  if (cut || res) {
    const p = { ...ch.params };
    if (cut && mx) p.cutoff = Math.max(cut.min, Math.min(cut.max, (p.cutoff ?? cut.def) * 2 ** (mx * 4)));
    if (res && my) p.res = Math.max(res.min, Math.min(res.max, (p.res ?? res.def) + (my * (res.max - res.min)) / 2));
    if (cut && !res && my > 0) { freq = p.cutoff ?? cut.def; p.cutoff = cut.max; } // the per-note filter takes over
    out.params = p;
  }
  if ((!cut && mx < 0) || (!res && my > 0)) out.filter = { freq: Math.min(20000, freq), q: 0.7 + Math.max(0, my) * 12 };
  return out;
}

export class Engine {
  constructor(store, ctx = new AudioContext({ latencyHint: 'interactive' })) {
    this.store = store;
    this.ctx = ctx;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.tracks = [];
    this.channelNodes = new Map();
    this.voices = new Set();
    this.exclusive = new Map();
    this.presetCache = new Map();
    this.fxInstances = new Map(); // `${track}:${slot}` -> {type, fx}
    this.sendNodes = new Map(); // `${from}:${to}` -> GainNode
    this.lastNote = new Map(); // channel id -> { voice, pitch, until } for glide / mono synths
    this.stepped = new Map(); // effects that follow the song step by step (volume shaper): slot key -> instance
    this.meterBuf = new Float32Array(512);
    this.clickBuffer = null;

    // effects built on AudioWorklets (gate, sidechain) come alive once their module is loaded
    this.ready = loadEffectWorklets(ctx);
    this._buildMaster();
    this.syncAll();

    this.unsubscribe = [
      store.on('project', () => this.syncAll()),
      store.on('channels', () => this.syncChannels()),
      store.on('channelMix', () => this.syncChannels()),
      store.on('mixer', () => this.syncMixer()),
      store.on('channelParams', (id) => this._decodeSampleFor(store.channel(id))),
    ];
  }

  dispose() {
    this.unsubscribe.forEach((off) => off());
  }

  ensure() {
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  // ------------------------------------------------------------------ graph
  _newStrip(i) {
    const c = this.ctx;
    const t = {
      index: i,
      input: c.createGain(),
      pan: c.createStereoPanner(),
      fader: c.createGain(),
      gate: c.createGain(),
      split: c.createChannelSplitter(2),
      aL: c.createAnalyser(),
      aR: c.createAnalyser(),
      fxNodes: [],
      peak: [0, 0],
    };
    t.aL.fftSize = t.aR.fftSize = 512;
    t.aL.smoothingTimeConstant = t.aR.smoothingTimeConstant = 0;
    t.pan.connect(t.fader).connect(t.gate);
    t.gate.connect(t.split);
    t.split.connect(t.aL, 0);
    t.split.connect(t.aR, 1);
    t.input.connect(t.pan);
    return t;
  }

  _buildMaster() {
    const t = this._newStrip(0);
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    // the compressor node adds its own makeup gain; take it back out so the master fader means what it says
    const out = this.ctx.createGain();
    out.gain.value = Math.pow(10, -compressorMakeupDb(-2, 0, 20) / 20);
    t.gate.connect(limiter).connect(out).connect(this.ctx.destination);
    this.limiter = limiter;
    this.limiterOut = out;
    this.tracks[0] = t;
  }

  /**
   * A mixer strip, built on first use. Only a handful of the 125 inserts are ever used, and each strip is ~9
   * nodes (two of them analysers that the browser keeps processing), so strips nobody routes to stay unbuilt —
   * which also makes every offline render (export, agent analysis) start much faster.
   */
  track(i) {
    return this.tracks[i] ?? this._buildTrack(i);
  }

  /**
   * Send the master straight to the output, skipping the final safety limiter. Used by offline measurements to see
   * how hot a mix really is: the limiter flattens the peaks, so a mix that is 6 dB too loud still reads "-1 dB".
   */
  bypassLimiter(on = true) {
    const t = this.tracks[0];
    t.gate.disconnect();
    t.gate.connect(t.split);
    if (on) t.gate.connect(this.ctx.destination);
    else t.gate.connect(this.limiter);
  }

  _buildTrack(i) {
    const t = this._newStrip(i);
    t.toMaster = this.store.project.mixer[i]?.master !== false;
    if (t.toMaster) t.gate.connect(this.tracks[0].input);
    this.tracks[i] = t;
    this._rebuildFxChain(i);
    this._applyStrip(i);
    return t;
  }

  /** A strip whose settings are all at their defaults does nothing, so it needs no nodes until something uses it. */
  _stripIdle(i) {
    const m = this.store.project.mixer[i];
    return !this.tracks[i] && m.vol === 0.8 && m.pan === 0 && !m.mute && !m.solo && m.master !== false && !m.fx.some(Boolean) && !Object.keys(m.sends || {}).length;
  }

  _rebuildFxChain(i) {
    if (this._stripIdle(i)) return;
    const t = this.track(i);
    const slots = this.store.project.mixer[i].fx;
    t.input.disconnect();
    for (const n of t.fxNodes) n.output.disconnect();
    t.fxNodes = [];
    let tail = t.input;
    slots.forEach((slot, k) => {
      const key = `${i}:${k}`;
      let inst = this.fxInstances.get(key);
      if (!slot) {
        if (inst) { this._dropFx(inst); this.fxInstances.delete(key); }
        return;
      }
      if (!inst || inst.type !== slot.type) {
        if (inst) this._dropFx(inst);
        inst = { type: slot.type, fx: createEffect(this.ctx, slot.type, slot.params), applied: { ...slot.params } };
        this.fxInstances.set(key, inst);
      } else {
        // keep the live effect in step with the project (undo/redo, loading)
        for (const [name, value] of Object.entries(slot.params)) {
          if (inst.applied[name] !== value) { inst.fx.set(name, value); inst.applied[name] = value; }
        }
      }
      if (inst.fx.key) this._wireKey(i, inst);
      if (inst.fx.onStep) this.stepped.set(key, inst); else this.stepped.delete(key);
      if (!slot.on) { this.stepped.delete(key); return; } // bypassed
      tail.connect(inst.fx.input);
      tail = inst.fx.output;
      t.fxNodes.push(inst.fx);
    });
    tail.connect(t.pan);
  }

  setEffectParam(track, slot, key, value) {
    const inst = this.fxInstances.get(`${track}:${slot}`);
    if (!inst) return;
    inst.fx.set(key, value);
    inst.applied[key] = value;
    if (key === 'source' && inst.fx.key) this._wireKey(track, inst);
  }

  /**
   * Feed a sidechain effect's key input from the mixer track named by its `source` parameter (that track's output,
   * after its fader). Skipped when it would make a loop (the keyed track feeding its own key source).
   */
  _wireKey(track, inst) {
    const src = Math.round(inst.applied.source ?? 0);
    const ok = src > 0 && src < MIXER_TRACKS && src !== track && !this.store.wouldCycle(src, track);
    const want = ok ? src : null;
    if (inst.keyFrom === want) return;
    if (inst.keyFrom != null) { try { this.tracks[inst.keyFrom]?.gate.disconnect(inst.fx.key); } catch { /* already gone */ } }
    inst.keyFrom = want;
    if (want != null) this.track(want).gate.connect(inst.fx.key);
  }

  /** Called by the scheduler for every step: tempo-synced effects schedule their envelopes. */
  stepEffects(step, time, stepDur) {
    for (const [key, inst] of this.stepped) {
      if (this.fxInstances.get(key) !== inst) { this.stepped.delete(key); continue; }
      inst.fx.onStep(step, time, stepDur);
    }
  }

  _dropFx(inst) {
    if (inst.keyFrom != null) { try { this.tracks[inst.keyFrom]?.gate.disconnect(inst.fx.key); } catch { /* already gone */ } }
    inst.fx.dispose();
  }

  syncAll() {
    for (let i = 0; i < MIXER_TRACKS; i++) this._rebuildFxChain(i);
    for (const c of this.store.project.playlist.clips) if (c.type === 'audio') this.ensureSample(c.sampleId);
    this.syncMixer();
    this.syncChannels();
  }

  syncMixer() {
    const mixer = this.store.project.mixer;
    const anySolo = mixer.some((m, i) => i > 0 && m.solo);
    this._anySolo = anySolo;
    mixer.forEach((m, i) => { if (!this._stripIdle(i)) this._applyStrip(i); });
    this._applyChannelMuting();
    this._syncRouting();
  }

  _applyStrip(i) {
    const t = this.track(i);
    const m = this.store.project.mixer[i];
    const anySolo = this._anySolo ?? this.store.project.mixer.some((x, k) => k > 0 && x.solo);
    const now = this.ctx.currentTime;
    t.pan.pan.setTargetAtTime(m.pan, now, 0.01);
    t.fader.gain.setTargetAtTime(faderToGain(m.vol), now, 0.01);
    const audible = i === 0 || (!m.mute && (!anySolo || m.solo));
    t.gate.gain.setTargetAtTime(audible ? 1 : 0, now, 0.01);
  }

  _syncRouting() {
    const now = this.ctx.currentTime;
    const want = new Set();
    this.store.project.mixer.forEach((m, i) => {
      // "route to master" (FL's default) can be switched off, e.g. for an insert that only feeds a bus
      const t = i > 0 ? this.tracks[i] : null;
      if (t && t.toMaster !== (m.master !== false)) {
        if (t.toMaster) t.gate.disconnect(this.tracks[0].input);
        else t.gate.connect(this.tracks[0].input);
        t.toMaster = m.master !== false;
      }
      for (const [dest, level] of Object.entries(m.sends || {})) {
        const key = `${i}:${dest}`;
        want.add(key);
        let entry = this.sendNodes.get(key);
        if (!entry) {
          const node = this.ctx.createGain();
          this.track(i).gate.connect(node);
          node.connect(this.track(Number(dest)).input);
          entry = { from: i, node };
          this.sendNodes.set(key, entry);
        }
        entry.node.gain.setTargetAtTime(faderToGain(level), now, 0.01);
      }
    });
    for (const [key, entry] of this.sendNodes) {
      if (want.has(key)) continue;
      this.tracks[entry.from]?.gate.disconnect(entry.node);
      entry.node.disconnect();
      this.sendNodes.delete(key);
    }
  }

  /** Recreate every effect on a track from scratch (after slots were reordered). */
  resetFx(track) {
    for (let k = 0; k < this.store.project.mixer[track].fx.length; k++) {
      const key = `${track}:${k}`;
      const inst = this.fxInstances.get(key);
      if (inst) this._dropFx(inst);
      this.fxInstances.delete(key);
    }
    this._rebuildFxChain(track);
  }

  /** Rebuild effect chain for one track (after slot add/remove/bypass). */
  syncFx(track) {
    this._rebuildFxChain(track);
  }

  _channelNode(ch) {
    let n = this.channelNodes.get(ch.id);
    if (!n) {
      n = { gain: this.ctx.createGain(), pan: this.ctx.createStereoPanner(), mixer: -1, mute: this.ctx.createGain() };
      n.gain.connect(n.pan).connect(n.mute);
      this.channelNodes.set(ch.id, n);
    }
    return n;
  }

  syncChannels() {
    const now = this.ctx.currentTime;
    const ids = new Set();
    for (const ch of this.store.project.channels) {
      ids.add(ch.id);
      const n = this._channelNode(ch);
      n.gain.gain.setTargetAtTime(channelGain(ch.vol), now, 0.01);
      n.pan.pan.setTargetAtTime(ch.pan, now, 0.01);
      if (n.mixer !== ch.mixer) {
        n.mute.disconnect();
        n.mute.connect(this.track(ch.mixer).input);
        n.mixer = ch.mixer;
      }
      this._decodeSampleFor(ch);
    }
    for (const [id, n] of this.channelNodes) {
      if (!ids.has(id)) { n.mute.disconnect(); this.channelNodes.delete(id); }
    }
    this._applyChannelMuting();
  }

  _applyChannelMuting() {
    const chs = this.store.project.channels;
    const anySolo = chs.some((c) => c.solo);
    const now = this.ctx.currentTime;
    for (const ch of chs) {
      const n = this.channelNodes.get(ch.id);
      if (!n) continue;
      const audible = !ch.mute && (!anySolo || ch.solo);
      n.mute.gain.setTargetAtTime(audible ? 1 : 0, now, 0.005);
    }
  }

  // ---------------------------------------------------------------- samples
  _decodeSampleFor(ch) {
    if (ch?.type !== 'sampler') return;
    if (ch.sampleId != null) this.ensureSample(ch.sampleId);
    for (const z of ch.zones ?? []) this.ensureSample(z.sampleId);
  }

  /** Decode a stored sample (once). Resolves to its AudioBuffer. */
  async ensureSample(id) {
    const s = this.store.samples.get(id);
    if (!s) return null;
    if (s.buffer) return s.buffer;
    if (s.decoding) return s.decoding;
    s.decoding = this.ctx.decodeAudioData(s.data.slice(0)).then((buf) => {
      s.buffer = buf;
      s.decoding = null;
      this.store.emit('sampleReady', id);
      return buf;
    }).catch((err) => {
      console.error('Could not decode sample', s.name, err);
      s.decoding = null;
      return null;
    });
    return s.decoding;
  }

  /**
   * Play an audio-clip segment into a mixer track. opts: { reverse, fadeIn, fadeOut, into } — fades in seconds of the
   * whole clip, `into` = how far into the clip this segment starts (so a clip started half-way picks up its fade).
   */
  playAudio(buffer, mixer, when, offset, dur, gain = 1, opts = {}) {
    if (offset >= buffer.duration) return null;
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const rate = opts.rate || 1; // resampling: speed and pitch together
    const length = Math.min(dur, (buffer.duration - offset) / rate);
    const src = ctx.createBufferSource();
    src.buffer = opts.reverse ? reversed(ctx, buffer) : buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const into = opts.into || 0;
    const fi = opts.fadeIn || 0;
    const fo = opts.fadeOut || 0;
    const total = into + length; // where this segment ends inside the clip
    // gain at a time inside the clip: fade-in ramp × fade-out ramp
    const at = (x) => gain * (fi > 0 ? Math.min(1, x / fi) : 1) * (fo > 0 ? Math.min(1, Math.max(0, (total - x) / fo)) : 1);
    g.gain.setValueAtTime(fi > 0 && into < fi ? at(into) : gain, t);
    if (fi > 0 && into < fi) g.gain.linearRampToValueAtTime(gain * (fo > 0 ? Math.min(1, (total - fi) / fo) : 1), t + (fi - into));
    const foStart = Math.max(into, total - fo);
    if (fo > 0 && foStart < total) {
      g.gain.setValueAtTime(at(foStart), t + (foStart - into));
      g.gain.linearRampToValueAtTime(0, t + length);
    } else {
      g.gain.setValueAtTime(gain, t + Math.max(0, length - 0.006));
      g.gain.linearRampToValueAtTime(0, t + length);
    }
    src.connect(g).connect(this.track(mixer in this.store.project.mixer ? mixer : 0).input);
    src.start(t, offset, length * rate);
    const v = { nodes: [src], out: g, end: t + length + 0.02, release() {} };
    this.voices.add(v);
    return v;
  }

  /**
   * A sample time-stretched to play `speed` times faster at the same pitch (WSOLA), computed once per speed and kept
   * with the sample. Speeds are rounded to 0.1 % so small tempo wobbles reuse the same buffer.
   */
  stretchedBuffer(sample, speed) {
    const key = (Math.round(speed * 1000) / 1000).toFixed(3);
    if (key === '1.000') return sample.buffer;
    sample.stretched ??= new Map();
    let buf = sample.stretched.get(key);
    if (!buf) {
      const src = sample.buffer;
      const chans = wsola(Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c)), Number(key));
      buf = new AudioBuffer({ numberOfChannels: chans.length, length: chans[0].length, sampleRate: src.sampleRate });
      chans.forEach((d, c) => buf.copyToChannel(d, c));
      sample.stretched.set(key, buf);
      if (sample.stretched.size > 4) sample.stretched.delete(sample.stretched.keys().next().value);
    }
    return buf;
  }

  // ------------------------------------------------------------------ notes
  /**
   * Trigger a note on a channel. `dur` in seconds (Infinity = held, use voice.release).
   * Returns the voice (or null).
   */
  /**
   * `note` (optional) carries per-note properties: `pan` (-1..1), `fine` (cents), `mx` / `my` (FL's Mod X / Mod Y,
   * -1..1: filter cutoff and resonance) and `sl` (a slide note: it bends the notes already sounding on the channel to
   * its pitch over its length instead of playing a note of its own).
   */
  playNote(ch, pitch, vel, when, dur, note = null) {
    const node = this._channelNode(ch);
    const fine = note?.fine ? note.fine / 100 : 0;
    const semis = (this.store.project.masterPitch || 0) + fine;
    const t = Math.max(when, this.ctx.currentTime);
    if (note?.sl) return this._slide(ch, pitch + semis, t, dur);
    let dest = node.gain;
    if (note?.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, note.pan));
      p.connect(node.gain);
      dest = p;
    }
    if (note && (note.mx || note.my)) {
      const mod = modParams(ch, note.mx || 0, note.my || 0);
      if (mod.params) ch = { ...ch, params: mod.params };
      if (mod.filter) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = mod.filter.freq;
        f.Q.value = mod.filter.q;
        f.connect(dest);
        dest = f;
      }
    }
    let v = null;
    if (ch.type === 'drum') v = playDrum(this.ctx, dest, ch.voice, t, vel, pitch - ROOT_NOTE + semis, ch.params);
    else if (ch.type === 'synth') {
      // portamento and mono / legato (808 glides): the channel remembers its last note
      const p = ch.params;
      const last = this.lastNote.get(ch.id);
      const abs = pitch + semis;
      if (p.mono && last?.voice?.legato && last.until > t + 0.002 && last.voice.end > t) {
        last.voice.legato(abs, t, dur, p.glide || 0);
        last.pitch = abs;
        last.until = t + dur;
        return last.voice;
      }
      if (p.mono && last?.voice && last.voice.end > t) last.voice.cut?.(t);
      v = playSynth(this.ctx, dest, pitch, t, dur, vel, semis, p, p.glide > 0 && last ? last.pitch : null);
      if (p.mono || p.glide > 0) this.lastNote.set(ch.id, { voice: v, pitch: abs, until: t + dur });
    }
    else if (ch.type === 'fm') v = playFm(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'organ') v = playOrgan(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'pluck') v = playPluck(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'wavetable') v = playWavetable(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'sfx') v = playSfx(this.ctx, dest, t, dur, vel, pitch - ROOT_NOTE + semis, ch.params);
    else if (ch.type === 'sampler') {
      if (ch.zones?.length) {
        // multi-sample: each zone that covers the key plays its own sample from its own root
        const parts = [];
        for (const z of pickZones(ch.zones, pitch, vel)) {
          const s = this.store.samples.get(z.sampleId);
          if (s?.buffer) { const p = playSample(this.ctx, dest, s.buffer, pitch, t, dur, vel, semis, ch.params, z.root); if (p) parts.push(p); }
        }
        v = parts.length > 1 ? layered(parts) : parts[0] ?? null;
      } else {
        const s = this.store.samples.get(ch.sampleId);
        if (s?.buffer) v = playSample(this.ctx, dest, s.buffer, pitch, t, dur, vel, semis, ch.params, ch.rootPitch ?? ROOT_NOTE, ch.slices);
      }
    } else if (ch.type === 'sf' && sharedSoundfont) {
      const preset = this._preset(ch);
      if (preset) {
        // regions are chosen by whole keys, so fine tuning goes in as cents
        const key = (ch.fixedKey != null ? ch.fixedKey + (pitch - ROOT_NOTE) : pitch) + (semis - fine);
        const params = fine ? { ...ch.params, tune: (ch.params.tune || 0) + fine } : ch.params;
        v = playSoundfont(this.ctx, dest, sharedSoundfont, preset, key, vel, t, dur, params, this.exclusive, ch.id);
      }
    }
    if (v) {
      v.channelId = ch.id;
      v.t0 = t;
      v.noteEnd = t + dur;
      v.pitchAbs = pitch + semis;
      this.voices.add(v);
      if (this.voices.size > MAX_VOICES) this._stealVoices();
    }
    return v;
  }

  /**
   * A slide note: every voice of the channel sounding at `t` glides by the same interval (so chords keep their shape),
   * taking the most recent one to `target` (absolute pitch) over `dur` seconds. The pitch stays there afterwards.
   */
  _slide(ch, target, t, dur) {
    let latest = null;
    const active = [];
    for (const v of this.voices) {
      if (v.channelId !== ch.id || !v.pitchParams?.length || v.t0 > t + 1e-4 || v.noteEnd <= t + 1e-4) continue;
      active.push(v);
      if (!latest || v.t0 >= latest.t0) latest = v;
    }
    if (!latest) return null;
    const delta = target - (latest.pitchAbs + (latest.bend || 0));
    const end = t + Math.max(0.005, Number.isFinite(dur) ? dur : 0.1);
    for (const v of active) {
      if (!v.bendSrc) {
        const src = this.ctx.createConstantSource();
        src.offset.value = 0;
        for (const param of v.pitchParams) src.connect(param);
        src.start(t);
        v.bendSrc = src;
        v.bend = 0;
        const stop = () => { if (Number.isFinite(v.end)) { try { src.stop(v.end + 0.05); } catch { /* stopped */ } } };
        stop();
        const release = v.release;
        v.release = (when) => { release(when); stop(); };
        if (v.kill) { const kill = v.kill; v.kill = (when) => { kill(when); stop(); }; }
      }
      const from = v.bend * 100;
      v.bend += delta;
      v.bendSrc.offset.setValueAtTime(from, t);
      v.bendSrc.offset.linearRampToValueAtTime(v.bend * 100, end);
    }
    return latest;
  }

  _preset(ch) {
    const key = `${ch.bank}:${ch.program}`;
    let p = this.presetCache.get(key);
    if (!p) {
      p = sharedSoundfont.getPreset(ch.bank, ch.program) || sharedSoundfont.getPreset(ch.bank === 128 ? 128 : 0, ch.bank === 128 ? 0 : ch.program) || sharedSoundfont.getPreset(0, 0);
      this.presetCache.set(key, p);
    }
    return p;
  }

  _pruneVoices() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) if (v.end < now) this.voices.delete(v);
  }

  _stealVoices() {
    this._pruneVoices();
    const now = this.ctx.currentTime;
    while (this.voices.size > MAX_VOICES) {
      const oldest = this.voices.values().next().value;
      this.voices.delete(oldest);
      try { (oldest.kill ? oldest.kill(now) : oldest.release(now)); } catch { /* ignore */ }
    }
  }

  /** Short audition used by clicking channels / piano keys. */
  preview(ch, pitch = ROOT_NOTE, vel = 0.8, dur = 0.4) {
    this.ensure();
    return this.playNote(ch, pitch, vel, this.ctx.currentTime, dur);
  }

  /** Audition an arbitrary channel spec that isn't in the project (browser preview). */
  previewSpec(spec, pitch = ROOT_NOTE) {
    this.ensure();
    const tmp = { id: -1, ...spec };
    if (tmp.type === 'sf' && !sharedSoundfont) return null;
    const node = this._channelNode(tmp);
    node.gain.gain.value = channelGain(0.78);
    if (node.mixer !== 0) { node.mute.disconnect(); node.mute.connect(this.tracks[0].input); node.mixer = 0; }
    node.mute.gain.value = 1;
    const prevSample = this.store.samples.get(tmp.sampleId);
    if (tmp.type === 'sampler' && !prevSample?.buffer) return null;
    return this.playNote(tmp, pitch, 0.8, this.ctx.currentTime, 0.6);
  }

  killAll(fade = 0.03) {
    const now = this.ctx.currentTime;
    this.lastNote.clear();
    for (const inst of this.stepped.values()) inst.fx.reset?.();
    for (const v of this.voices) {
      try {
        v.out.gain.cancelScheduledValues(now);
        v.out.gain.setTargetAtTime(0, now, fade / 3);
        for (const n of v.nodes) n.stop(now + fade * 2 + 0.01);
      } catch { /* node already stopped */ }
    }
    this.voices.clear();
  }

  click(when, accent) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    o.connect(g).connect(this.tracks[0].gate);
    o.start(when);
    o.stop(when + 0.06);
  }

  // ----------------------------------------------------------------- meters
  /** Returns [peakL, peakR] (linear 0..1+) for a mixer track. */
  readLevels(i) {
    const t = this.tracks[i];
    if (!t) return SILENT;
    const buf = this.meterBuf;
    const peak = (an) => {
      an.getFloatTimeDomainData(buf);
      let m = 0;
      for (let k = 0; k < buf.length; k++) { const a = Math.abs(buf[k]); if (a > m) m = a; }
      return m;
    };
    t.peak[0] = peak(t.aL);
    t.peak[1] = peak(t.aR);
    return t.peak;
  }

  get voiceCount() { this._pruneVoices(); return this.voices.size; }
}
