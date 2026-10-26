import { midiToFreq, ROOT_NOTE } from '../util.js';

// ---------------------------------------------------------------------------
// Parameter metadata (drives the channel settings window and defaults)
// ---------------------------------------------------------------------------
const DRUM_PARAMS = [
  { key: 'pitch', label: 'Pitch', min: -12, max: 12, def: 0, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} st` },
  { key: 'decay', label: 'Decay', min: 0.2, max: 3, def: 1, fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'tone', label: 'Tone', min: 0, max: 1, def: 0.85, fmt: (v) => `${Math.round(v * 100)}%` },
];

const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
const SYNTH_PARAMS = [
  { key: 'wave1', label: 'Osc 1', type: 'select', options: WAVES, def: 'sawtooth' },
  { key: 'wave2', label: 'Osc 2', type: 'select', options: WAVES, def: 'square' },
  { key: 'mix', label: 'Osc 2 mix', min: 0, max: 1, def: 0.4, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'detune', label: 'Detune', min: -100, max: 100, def: 8, fmt: (v) => `${v.toFixed(0)} ct` },
  { key: 'octave2', label: 'Osc 2 oct', min: -2, max: 2, def: 0, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'unison', label: 'Unison', min: 1, max: 7, def: 1, step: 1, fmt: (v) => `${v} voice${v > 1 ? 's' : ''}` },
  { key: 'spread', label: 'Spread', min: 0, max: 60, def: 16, fmt: (v) => `${v.toFixed(0)} ct` },
  { key: 'cutoff', label: 'Cutoff', min: 60, max: 18000, def: 4200, log: true, fmt: (v) => `${Math.round(v)} Hz` },
  { key: 'res', label: 'Resonance', min: 0.1, max: 18, def: 1.5, fmt: (v) => v.toFixed(1) },
  { key: 'envAmt', label: 'Filter env', min: 0, max: 1, def: 0.35, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'attack', label: 'Attack', min: 0.001, max: 2, def: 0.01, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
  { key: 'decay', label: 'Decay', min: 0.01, max: 3, def: 0.25, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, def: 0.6, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'release', label: 'Release', min: 0.005, max: 4, def: 0.18, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
];

const SAMPLER_PARAMS = [
  { key: 'pitch', label: 'Pitch', min: -12, max: 12, def: 0, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} st` },
  { key: 'start', label: 'Start', min: 0, max: 0.95, def: 0, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'attack', label: 'Attack', min: 0.001, max: 1, def: 0.002, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
  { key: 'release', label: 'Release', min: 0.005, max: 2, def: 0.05, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
  { key: 'cutoff', label: 'Cutoff', min: 100, max: 20000, def: 20000, log: true, fmt: (v) => `${Math.round(v)} Hz` },
  { key: 'gate', label: 'Gate', type: 'toggle', def: false },
  { key: 'reverse', label: 'Reverse', type: 'toggle', def: false },
];

const SF_PARAMS = [
  { key: 'tune', label: 'Tune', min: -12, max: 12, def: 0, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} st` },
  { key: 'attack', label: 'Attack', min: 0, max: 1.5, def: 0, fmt: (v) => `+${(v * 1000).toFixed(0)} ms` },
  { key: 'release', label: 'Release', min: 0.1, max: 4, def: 1, log: true, fmt: (v) => `${v.toFixed(2)}x` },
  { key: 'cutoff', label: 'Low-pass', min: 200, max: 20000, def: 20000, log: true, fmt: (v) => (v >= 19999 ? 'Open' : `${Math.round(v)} Hz`) },
];

export const PARAM_META = { drum: DRUM_PARAMS, synth: SYNTH_PARAMS, sampler: SAMPLER_PARAMS, sf: SF_PARAMS };

export function defaultParams(type) {
  const out = {};
  for (const m of PARAM_META[type] || []) out[m.key] = m.def;
  return out;
}

// ---------------------------------------------------------------------------
// Presets shown in the browser
// ---------------------------------------------------------------------------
export const DRUM_KIT = [
  { name: 'Kick', voice: 'kick' },
  { name: 'Snare', voice: 'snare' },
  { name: 'Clap', voice: 'clap' },
  { name: 'Closed Hat', voice: 'hat' },
  { name: 'Open Hat', voice: 'openhat' },
  { name: 'Tom', voice: 'tom' },
  { name: 'Rim', voice: 'rim' },
  { name: 'Cowbell', voice: 'cowbell' },
  { name: 'Crash', voice: 'crash' },
];

export const SYNTH_PRESETS = {
  Bass: [
    { name: 'Sub Bass', params: { wave1: 'sine', wave2: 'triangle', mix: 0.25, detune: 0, octave2: -1, cutoff: 1400, res: 0.7, envAmt: 0.1, attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.1 } },
    { name: 'Saw Bass', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.5, detune: 12, octave2: -1, cutoff: 900, res: 4, envAmt: 0.65, attack: 0.004, decay: 0.22, sustain: 0.35, release: 0.1 } },
    { name: 'Pluck Bass', params: { wave1: 'square', wave2: 'sawtooth', mix: 0.3, detune: 5, octave2: 0, cutoff: 700, res: 6, envAmt: 0.9, attack: 0.002, decay: 0.14, sustain: 0.0, release: 0.08 } },
  ],
  Leads: [
    { name: 'Saw Lead', params: { wave1: 'sawtooth', wave2: 'sawtooth', mix: 0.6, detune: 14, octave2: 0, cutoff: 6500, res: 2, envAmt: 0.3, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.2 } },
    { name: 'Square Lead', params: { wave1: 'square', wave2: 'square', mix: 0.4, detune: 7, octave2: 1, cutoff: 5200, res: 1.2, envAmt: 0.2, attack: 0.008, decay: 0.15, sustain: 0.75, release: 0.15 } },
    { name: 'Soft Sine', params: { wave1: 'sine', wave2: 'triangle', mix: 0.35, detune: 4, octave2: 1, cutoff: 9000, res: 0.5, envAmt: 0, attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.3 } },
  ],
  Pads: [
    { name: 'Warm Pad', params: { wave1: 'sawtooth', wave2: 'triangle', mix: 0.5, detune: 9, octave2: 0, cutoff: 1800, res: 0.8, envAmt: 0.25, attack: 0.5, decay: 0.8, sustain: 0.75, release: 1.2 } },
    { name: 'Glass Pad', params: { wave1: 'triangle', wave2: 'sine', mix: 0.55, detune: 7, octave2: 1, cutoff: 7000, res: 0.6, envAmt: 0.1, attack: 0.7, decay: 1, sustain: 0.8, release: 1.5 } },
  ],
  Plucks: [
    { name: 'Soft Pluck', params: { wave1: 'triangle', wave2: 'sine', mix: 0.4, detune: 3, octave2: 1, cutoff: 3000, res: 1, envAmt: 0.6, attack: 0.002, decay: 0.3, sustain: 0.0, release: 0.2 } },
    { name: 'Bell Pluck', params: { wave1: 'sine', wave2: 'sine', mix: 0.5, detune: 0, octave2: 2, cutoff: 12000, res: 0.5, envAmt: 0.0, attack: 0.001, decay: 0.9, sustain: 0.0, release: 0.5 } },
  ],
};

// ---------------------------------------------------------------------------
// Voices. Every play function returns { nodes: AudioScheduledSourceNode[], out: GainNode, end, release(t) }
// ---------------------------------------------------------------------------
let noiseBuffer = null;
function noise(ctx) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  return src;
}

function env(g, t, peak, decay, attack = 0.001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function finish(nodes, out, end) {
  return { nodes, out, end, release() {} };
}

const DRUMS = {
  kick(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170 * k, t);
    o.frequency.exponentialRampToValueAtTime(52 * k, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(40 * k, t + 0.45 * d);
    const g = ctx.createGain();
    env(g, t, v * 1.05, 0.5 * d);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600 + p.tone * 12000;
    o.connect(g).connect(lp).connect(dest);
    // transient click
    const n = noise(ctx);
    const ng = ctx.createGain();
    env(ng, t, v * 0.22 * (0.4 + p.tone), 0.012);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    n.connect(hp).connect(ng).connect(dest);
    const end = t + 0.55 * d + 0.05;
    o.start(t); o.stop(end);
    n.start(t); n.stop(t + 0.05);
    return finish([o, n], g, end);
  },
  snare(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const n = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900 * k;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000 + p.tone * 9000;
    const ng = ctx.createGain();
    env(ng, t, v * 0.75, 0.17 * d);
    n.connect(hp).connect(lp).connect(ng).connect(dest);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240 * k, t);
    o.frequency.exponentialRampToValueAtTime(170 * k, t + 0.08);
    const og = ctx.createGain();
    env(og, t, v * 0.6, 0.11 * d);
    o.connect(og).connect(dest);
    const end = t + 0.3 * d + 0.05;
    n.start(t); n.stop(end);
    o.start(t); o.stop(end);
    return finish([n, o], ng, end);
  },
  clap(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const n = noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1150 * k;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    [0, 0.011, 0.023, 0.035].forEach((off, i) => {
      const at = t + off;
      g.gain.setValueAtTime(v * 0.9, at);
      g.gain.exponentialRampToValueAtTime(0.05 * v + 0.0002, at + 0.009);
      if (i === 3) {
        g.gain.setValueAtTime(v * 0.85, at + 0.009);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.009 + 0.2 * d);
      }
    });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3500 + p.tone * 8000;
    n.connect(bp).connect(lp).connect(g).connect(dest);
    const end = t + 0.3 * d + 0.06;
    n.start(t); n.stop(end);
    return finish([n], g, end);
  },
  hat(ctx, dest, t, v, k, p) { return hatVoice(ctx, dest, t, v, k, p, 0.06 * p.decay); },
  openhat(ctx, dest, t, v, k, p) { return hatVoice(ctx, dest, t, v, k, p, 0.4 * p.decay); },
  tom(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(230 * k, t);
    o.frequency.exponentialRampToValueAtTime(95 * k, t + 0.22 * d);
    const g = ctx.createGain();
    env(g, t, v * 0.95, 0.35 * d);
    o.connect(g).connect(dest);
    const end = t + 0.4 * d + 0.05;
    o.start(t); o.stop(end);
    return finish([o], g, end);
  },
  rim(ctx, dest, t, v, k, p) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 1750 * k;
    const g = ctx.createGain();
    env(g, t, v * 0.7, 0.03 * p.decay);
    const n = noise(ctx);
    const ng = ctx.createGain();
    env(ng, t, v * 0.25, 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    o.connect(g).connect(dest);
    n.connect(hp).connect(ng).connect(dest);
    const end = t + 0.1 * p.decay;
    o.start(t); o.stop(end);
    n.start(t); n.stop(end);
    return finish([o, n], g, end);
  },
  cowbell(ctx, dest, t, v, k, p) {
    const g = ctx.createGain();
    env(g, t, v * 0.55, 0.28 * p.decay);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 820 * k;
    bp.Q.value = 1.4;
    const nodes = [560, 845].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * k;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.35 * p.decay + 0.05);
      return o;
    });
    bp.connect(g).connect(dest);
    return finish(nodes, g, t + 0.35 * p.decay + 0.05);
  },
  crash(ctx, dest, t, v, k, p) {
    const n = noise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200 * k;
    const g = ctx.createGain();
    env(g, t, v * 0.5, 1.3 * p.decay, 0.002);
    n.connect(hp).connect(g).connect(dest);
    const end = t + 1.4 * p.decay + 0.05;
    n.start(t); n.stop(end);
    return finish([n], g, end);
  },
};

function hatVoice(ctx, dest, t, v, k, p, decay) {
  const g = ctx.createGain();
  env(g, t, v * 0.42, decay);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 9500 * k;
  bp.Q.value = 0.8;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000 + p.tone * 2500;
  const nodes = [263, 400, 421, 474, 587, 845].map((f) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f * 2.1 * k;
    o.connect(bp);
    o.start(t);
    o.stop(t + decay + 0.06);
    return o;
  });
  bp.connect(hp).connect(g).connect(dest);
  return finish(nodes, g, t + decay + 0.06);
}

export function playDrum(ctx, dest, voice, t, vel, semis, params) {
  const fn = DRUMS[voice] || DRUMS.kick;
  const k = Math.pow(2, (semis + (params.pitch || 0)) / 12);
  return fn(ctx, dest, t, 0.25 + vel * 0.75, k, params);
}

/** Subtractive synth voice. dur === Infinity → held until voice.release(t). */
export function playSynth(ctx, dest, pitch, t, dur, vel, semis, p) {
  const freq = midiToFreq(pitch + semis);
  const out = ctx.createGain();
  const peak = 0.22 * (0.25 + vel * 0.75);
  const sus = Math.max(p.sustain, 0.0001);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = p.res;
  const base = Math.min(p.cutoff, 20000);
  const top = Math.min(20000, base * (1 + p.envAmt * 7));
  filter.frequency.setValueAtTime(top, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(base, 20), t + p.attack + p.decay);

  const voices = Math.max(1, Math.round(p.unison || 1));
  const stack = [];
  for (let u = 0; u < voices; u++) {
    const o = ctx.createOscillator();
    o.type = p.wave1;
    o.frequency.value = freq;
    o.detune.value = voices === 1 ? 0 : ((u / (voices - 1)) * 2 - 1) * (p.spread ?? 16);
    const g = ctx.createGain();
    g.gain.value = (1 - p.mix * 0.5) / Math.sqrt(voices);
    o.connect(g).connect(filter);
    stack.push(o);
  }
  const o2 = ctx.createOscillator();
  o2.type = p.wave2;
  o2.frequency.value = freq * Math.pow(2, p.octave2);
  o2.detune.value = p.detune;
  const g2 = ctx.createGain();
  g2.gain.value = p.mix;
  o2.connect(g2).connect(filter);
  filter.connect(out).connect(dest);

  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(peak, t + p.attack);
  out.gain.exponentialRampToValueAtTime(Math.max(peak * sus, 0.0001), t + p.attack + p.decay);

  const oscs = [...stack, o2];
  const voice = { nodes: oscs, out, end: Infinity, released: false };
  voice.release = (when) => {
    if (voice.released) return;
    voice.released = true;
    const rt = Math.max(when, t + 0.002);
    out.gain.cancelAndHoldAtTime(rt);
    out.gain.setTargetAtTime(0.0001, rt, Math.max(p.release, 0.01) / 3);
    const stopAt = rt + p.release * 1.6 + 0.05;
    oscs.forEach((o) => o.stop(stopAt));
    voice.end = stopAt;
  };
  oscs.forEach((o) => o.start(t));
  if (Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}

export function playSample(ctx, dest, buffer, pitch, t, dur, vel, semis, p) {
  const src = ctx.createBufferSource();
  src.buffer = p.reverse ? reversed(ctx, buffer) : buffer;
  src.playbackRate.value = Math.pow(2, (pitch - ROOT_NOTE + semis + (p.pitch || 0)) / 12);
  const g = ctx.createGain();
  const peak = 0.25 + vel * 0.75;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(p.attack, 0.001));
  let node = src;
  if (p.cutoff < 19500) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.cutoff;
    src.connect(lp);
    node = lp;
  }
  node.connect(g).connect(dest);
  const offset = buffer.duration * (p.start || 0);
  const natural = (buffer.duration - offset) / src.playbackRate.value;
  const voice = { nodes: [src], out: g, end: t + natural + 0.05, released: false };
  voice.release = (when) => {
    if (voice.released || !p.gate) return;
    voice.released = true;
    const rt = Math.max(when, t + 0.002);
    g.gain.cancelAndHoldAtTime(rt);
    g.gain.setTargetAtTime(0.0001, rt, Math.max(p.release, 0.01) / 3);
    src.stop(rt + p.release * 1.6 + 0.05);
    voice.end = rt + p.release * 1.6 + 0.05;
  };
  src.start(t, offset);
  if (p.gate && Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}

const reverseCache = new WeakMap();
function reversed(ctx, buffer) {
  if (reverseCache.has(buffer)) return reverseCache.get(buffer);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  reverseCache.set(buffer, out);
  return out;
}
