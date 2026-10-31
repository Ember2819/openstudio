// Wavetable synth: each table is 8 frames (band-limited PeriodicWaves); the "position" morphs between them.
//
// No AudioWorklet is needed: every frame has its own oscillator, and its level is a WaveShaper "window" of one shared
// position signal (a ConstantSource + envelope + LFO). So the position can be enveloped and modulated at audio rate and
// the morph is smooth, with the browser band-limiting every frame.
import { midiToFreq } from '../util.js';
import { harmonicWave, clamp } from './dsp.js';

const H = 48; // harmonics per frame
export const FRAMES = 8;

/** Table recipes: amplitude of harmonic n (1..H) in frame f (0..FRAMES-1). */
const TABLES = {
  'Basic shapes': (n, f) => {
    // sine → triangle → saw → square across the table
    const x = f / (FRAMES - 1) * 3;
    const sine = n === 1 ? 1 : 0;
    const tri = n % 2 ? (8 / (Math.PI ** 2 * n * n)) * (((n - 1) / 2) % 2 ? -1 : 1) : 0;
    const saw = 2 / (Math.PI * n);
    const sq = n % 2 ? 4 / (Math.PI * n) : 0;
    const k = x - Math.floor(Math.min(x, 2.999));
    const seg = Math.min(2, Math.floor(x));
    const pair = [[sine, tri], [tri, saw], [saw, sq]][seg];
    return pair[0] * (1 - k) + pair[1] * k;
  },
  'Pulse width': (n, f) => {
    const w = 0.5 - (f / (FRAMES - 1)) * 0.45; // 50 % → 5 %
    return (2 / (n * Math.PI)) * Math.sin(n * Math.PI * w);
  },
  'Harmonic sweep': (n, f) => {
    const top = 1 + Math.round((f / (FRAMES - 1)) * 23); // more and more harmonics
    return n <= top ? 1 / Math.sqrt(n) : 0;
  },
  'Vowels': (n, f) => {
    // formants of a, e, i, o, u … sung on a falling spectrum
    const V = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [440, 1020], [660, 1700], [390, 2000]];
    const [f1, f2] = V[f];
    const hz = n * 110; // formants are placed for an A2 voice; they move with the pitch, like a synth vowel
    const hump = (c, w) => Math.exp(-((hz - c) ** 2) / (2 * w * w));
    return (1 / n ** 0.5) * (0.15 + 1.2 * hump(f1, 120) + 0.8 * hump(f2, 180));
  },
  'Digital': (n, f) => {
    // odd sparse spectra: bright, metallic, buzzy
    const step = 1 + (f % 4);
    return (n % step === 0 || n === 1) ? (1 / n ** (0.4 + f * 0.08)) * (n % (f + 2) ? 1 : -1) : 0;
  },
  'Organ drawbars': (n, f) => {
    const bars = [{ 1: 1 }, { 1: 1, 2: 0.6 }, { 1: 1, 2: 0.6, 3: 0.5 }, { 1: 1, 2: 0.5, 3: 0.5, 4: 0.4 }, { 1: 1, 3: 0.6, 5: 0.5 }, { 1: 1, 2: 0.7, 4: 0.6, 8: 0.5 }, { 1: 0.8, 2: 0.8, 3: 0.6, 4: 0.6, 6: 0.5, 8: 0.5 }, { 1: 0.7, 2: 0.7, 3: 0.7, 4: 0.6, 5: 0.5, 6: 0.5, 8: 0.5, 10: 0.4, 12: 0.4 }];
    return bars[f][n] ?? 0;
  },
};
export const WAVETABLES = Object.keys(TABLES);

/** Normalised harmonic weights of one frame. */
function frameWeights(table, f) {
  const recipe = TABLES[table] ?? TABLES['Basic shapes'];
  const w = new Float32Array(H + 1);
  let sum = 0;
  for (let n = 1; n <= H; n++) { w[n] = recipe(n, f); sum += Math.abs(w[n]); }
  // equal loudness across frames, roughly: scale by the strongest partials
  const norm = sum > 0 ? 1 / Math.max(...[...w].map(Math.abs)) : 1;
  for (let n = 1; n <= H; n++) w[n] *= norm;
  return w;
}

const windows = new Map(); // frame -> Float32Array shaper curve
/** Shaper curve: input = position (0..1, on the shaper's -1..1 domain), output = this frame's weight. */
function windowCurve(k) {
  let c = windows.get(k);
  if (!c) {
    c = new Float32Array(1025);
    for (let i = 0; i < c.length; i++) {
      const pos = clamp((i / (c.length - 1)) * 2 - 1, 0, 1) * (FRAMES - 1);
      c[i] = Math.max(0, 1 - Math.abs(pos - k));
    }
    windows.set(k, c);
  }
  return c;
}

/**
 * Play a wavetable voice. p: { table, position, posEnv, posDecay, posLfo, lfoRate, unison, spread, cutoff, res, envAmt,
 * attack, decay, sustain, release }.
 */
export function playWavetable(ctx, dest, pitch, t, dur, vel, semis, p) {
  const freq = midiToFreq(pitch + semis);
  const out = ctx.createGain();
  const peak = 0.2 * (0.25 + vel * 0.75);
  const sus = Math.max(p.sustain, 0.0001);
  const sources = [];

  // the position signal
  const pos = ctx.createGain();
  const base = ctx.createConstantSource();
  base.offset.value = clamp(p.position, 0, 1);
  base.connect(pos);
  sources.push(base);
  if (Math.abs(p.posEnv) > 0.005) {
    const env = ctx.createConstantSource();
    env.offset.setValueAtTime(p.posEnv, t);
    env.offset.setTargetAtTime(0, t + p.attack, Math.max(0.005, p.posDecay) / 3);
    env.connect(pos);
    sources.push(env);
  }
  if (p.posLfo > 0.005) {
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = p.lfoRate;
    const depth = ctx.createGain();
    depth.gain.value = p.posLfo * 0.5;
    lfo.connect(depth).connect(pos);
    sources.push(lfo);
  }

  // one oscillator per frame (per unison voice), each through its frame's window
  const voices = Math.max(1, Math.round(p.unison || 1));
  const bus = ctx.createGain();
  bus.gain.value = 1 / Math.sqrt(voices);
  for (let k = 0; k < FRAMES; k++) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = windowCurve(k);
    const amp = ctx.createGain();
    amp.gain.value = 0; // driven by the shaper
    pos.connect(shaper).connect(amp.gain);
    const wave = harmonicWave(ctx, `wt:${p.table}:${k}`, frameWeights(p.table, k));
    for (let u = 0; u < voices; u++) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = freq;
      o.detune.value = voices === 1 ? 0 : ((u / (voices - 1)) * 2 - 1) * (p.spread ?? 12);
      o.connect(amp);
      sources.push(o);
    }
    amp.connect(bus);
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = p.res;
  const top = Math.min(20000, p.cutoff * (1 + p.envAmt * 6));
  filter.frequency.setValueAtTime(top, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, p.cutoff), t + p.attack + p.decay);
  bus.connect(filter).connect(out).connect(dest);

  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(peak, t + p.attack);
  out.gain.exponentialRampToValueAtTime(Math.max(peak * sus, 0.0001), t + p.attack + p.decay);

  const voice = { nodes: sources, out, end: Infinity, released: false };
  voice.release = (when) => {
    if (voice.released) return;
    voice.released = true;
    const rt = Math.max(when, t + 0.002);
    out.gain.cancelAndHoldAtTime(rt);
    out.gain.setTargetAtTime(0.0001, rt, Math.max(p.release, 0.01) / 3);
    const stopAt = rt + p.release * 1.6 + 0.05;
    for (const s of sources) { try { s.stop(stopAt); } catch { /* never started */ } }
    voice.end = stopAt;
  };
  sources.forEach((s) => s.start(t));
  if (Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}
