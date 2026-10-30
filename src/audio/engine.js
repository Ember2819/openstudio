import { playDrum, playSynth, playFm, playOrgan, playPluck, playSfx, playSample } from './instruments.js';
import { SoundFont } from './sf2.js';
import { playSoundfont } from './soundfont.js';
import { createEffect } from './effects.js';
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
    this.meterBuf = new Float32Array(512);
    this.clickBuffer = null;

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
    t.gate.connect(limiter).connect(this.ctx.destination);
    this.limiter = limiter;
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
    t.gate.connect(this.tracks[0].input);
    t.toMaster = true;
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
        if (inst) { inst.fx.dispose(); this.fxInstances.delete(key); }
        return;
      }
      if (!inst || inst.type !== slot.type) {
        inst?.fx.dispose();
        inst = { type: slot.type, fx: createEffect(this.ctx, slot.type, slot.params), applied: { ...slot.params } };
        this.fxInstances.set(key, inst);
      } else {
        // keep the live effect in step with the project (undo/redo, loading)
        for (const [name, value] of Object.entries(slot.params)) {
          if (inst.applied[name] !== value) { inst.fx.set(name, value); inst.applied[name] = value; }
        }
      }
      if (!slot.on) return; // bypassed
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
      this.fxInstances.get(key)?.fx.dispose();
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
    if (ch?.type === 'sampler' && ch.sampleId != null) this.ensureSample(ch.sampleId);
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

  /** Play an audio-clip segment into a mixer track. */
  playAudio(buffer, mixer, when, offset, dur, gain = 1) {
    if (offset >= buffer.duration) return null;
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const length = Math.min(dur, buffer.duration - offset);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.setValueAtTime(gain, t + Math.max(0, length - 0.006));
    g.gain.linearRampToValueAtTime(0, t + length);
    src.connect(g).connect(this.track(mixer in this.store.project.mixer ? mixer : 0).input);
    src.start(t, offset, length);
    const v = { nodes: [src], out: g, end: t + length + 0.02, release() {} };
    this.voices.add(v);
    return v;
  }

  // ------------------------------------------------------------------ notes
  /**
   * Trigger a note on a channel. `dur` in seconds (Infinity = held, use voice.release).
   * Returns the voice (or null).
   */
  /**
   * `note` (optional) carries per-note properties: `pan` (-1..1) and `fine` (cents).
   */
  playNote(ch, pitch, vel, when, dur, note = null) {
    const node = this._channelNode(ch);
    const fine = note?.fine ? note.fine / 100 : 0;
    const semis = (this.store.project.masterPitch || 0) + fine;
    const t = Math.max(when, this.ctx.currentTime);
    let dest = node.gain;
    if (note?.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, note.pan));
      p.connect(node.gain);
      dest = p;
    }
    let v = null;
    if (ch.type === 'drum') v = playDrum(this.ctx, dest, ch.voice, t, vel, pitch - ROOT_NOTE + semis, ch.params);
    else if (ch.type === 'synth') v = playSynth(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'fm') v = playFm(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'organ') v = playOrgan(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'pluck') v = playPluck(this.ctx, dest, pitch, t, dur, vel, semis, ch.params);
    else if (ch.type === 'sfx') v = playSfx(this.ctx, dest, t, dur, vel, pitch - ROOT_NOTE + semis, ch.params);
    else if (ch.type === 'sampler') {
      const s = this.store.samples.get(ch.sampleId);
      if (s?.buffer) v = playSample(this.ctx, dest, s.buffer, pitch, t, dur, vel, semis, ch.params);
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
      this.voices.add(v);
      if (this.voices.size > MAX_VOICES) this._stealVoices();
    }
    return v;
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
