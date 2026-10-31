// Synth engines. Each play function: (ctx, dest, pitch, t, dur, vel, semis, params) -> voice
//   voice = { nodes: AudioScheduledSourceNode[], out: GainNode, end, release(t) }   dur === Infinity -> held until release()
import { midiToFreq } from '../util.js';
import { noise, setWave, harmonicWave, saturationCurve, clamp, dbToGain } from './dsp.js';

const REF_FREQ = 261.63; // C4: cutoff key-tracking pivots around here

/** Build the voice object and its release() for an enveloped amp node. */
function heldVoice(ctx, t, out, sources, releaseTime) {
  const voice = { nodes: sources, out, end: Infinity, released: false };
  voice.release = (when) => {
    if (voice.released) return;
    voice.released = true;
    const rt = Math.max(when, t + 0.002);
    out.gain.cancelAndHoldAtTime(rt);
    out.gain.setTargetAtTime(0.0001, rt, Math.max(releaseTime, 0.01) / 3);
    const stopAt = rt + releaseTime * 1.6 + 0.05;
    for (const s of sources) { try { s.stop(stopAt); } catch { /* never started */ } }
    voice.end = stopAt;
  };
  return voice;
}

// ---------------------------------------------------------------------------
// Subtractive: stacked unison oscillator + second oscillator + sub + noise -> drive -> 12/24 dB low-pass
// ---------------------------------------------------------------------------
/**
 * `from`: absolute pitch to glide from (portamento, over p.glide seconds), or null. The voice also gets `legato()`
 * (move to a new pitch without retriggering, for mono mode) and `cut()` (stop quickly).
 */
export function playSynth(ctx, dest, pitch, t, dur, vel, semis, p, from = null) {
  const freq = midiToFreq(pitch + semis);
  // pitch bend shared by every oscillator: glides are ramps of it, in cents
  const bend = ctx.createConstantSource();
  const glideTime = Math.max(0.005, p.glide || 0);
  bend.offset.setValueAtTime(from != null && p.glide > 0 ? (from - (pitch + semis)) * 100 : 0, t);
  if (from != null && p.glide > 0) bend.offset.linearRampToValueAtTime(0, t + glideTime);
  const out = ctx.createGain();
  const peak = 0.22 * (0.25 + vel * 0.75);
  const sus = Math.max(p.sustain, 0.0001);

  const steep = p.slope === '24 dB';
  const f1 = ctx.createBiquadFilter();
  f1.type = 'lowpass';
  f1.Q.value = p.res;
  const f2 = steep ? ctx.createBiquadFilter() : null;
  if (f2) { f2.type = 'lowpass'; f2.Q.value = 0.7; }
  const stages = f2 ? [f1, f2] : [f1];

  // cutoff follows the note a little (keytrack), so a bass and a high lead sound like the same patch
  const base = clamp(p.cutoff * Math.pow(freq / REF_FREQ, p.keytrack ?? 0), 40, 20000);
  const top = Math.min(20000, base * (1 + p.envAmt * 7));
  // the filter opens over the attack and closes over the decay, with the amp: a slow pad or brass swell gets
  // brighter as it fades in instead of starting wide open and darkening while it is still silent
  for (const f of stages) {
    f.frequency.setValueAtTime(base, t);
    f.frequency.exponentialRampToValueAtTime(top, t + Math.max(p.attack, 0.001));
    f.frequency.exponentialRampToValueAtTime(base, t + Math.max(p.attack, 0.001) + p.decay);
  }

  const bus = ctx.createGain();
  const sources = [];
  const detunable = []; // oscillators the vibrato LFO drives

  const voices = Math.max(1, Math.round(p.unison || 1));
  for (let u = 0; u < voices; u++) {
    const o = ctx.createOscillator();
    setWave(ctx, o, p.wave1);
    o.frequency.value = freq;
    o.detune.value = voices === 1 ? 0 : ((u / (voices - 1)) * 2 - 1) * (p.spread ?? 16);
    const g = ctx.createGain();
    g.gain.value = (1 - p.mix * 0.5) / Math.sqrt(voices);
    o.connect(g).connect(bus);
    bend.connect(o.detune);
    sources.push(o); detunable.push(o);
  }
  const o2 = ctx.createOscillator();
  setWave(ctx, o2, p.wave2);
  o2.frequency.value = freq * Math.pow(2, p.octave2);
  o2.detune.value = p.detune;
  const g2 = ctx.createGain();
  g2.gain.value = p.mix;
  o2.connect(g2).connect(bus);
  bend.connect(o2.detune);
  sources.push(o2); detunable.push(o2);

  if (p.sub > 0.005) {
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const sg = ctx.createGain();
    sg.gain.value = p.sub * 0.9;
    sub.connect(sg).connect(bus);
    bend.connect(sub.detune);
    sources.push(sub);
  }
  if (p.noise > 0.005) {
    const n = noise(ctx, 'white');
    const ng = ctx.createGain();
    ng.gain.value = p.noise * 0.35;
    n.connect(ng).connect(bus);
    sources.push(n);
  }

  let tail = bus;
  if (p.drive > 0.01) {
    const pre = ctx.createGain();
    pre.gain.value = 1 + p.drive * 3;
    const sat = ctx.createWaveShaper();
    sat.curve = saturationCurve(1.5 + p.drive * 2);
    const post = ctx.createGain();
    post.gain.value = 1 / (1 + p.drive * 1.2);
    bus.connect(pre).connect(sat).connect(post);
    tail = post;
  }
  tail.connect(f1);
  if (f2) f1.connect(f2);
  (f2 ?? f1).connect(out).connect(dest);

  // LFO: vibrato on the oscillators (fades in after the attack), wobble on the filter
  if (p.vibrato > 0.005 || p.wobble > 0.005) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.lfoRate;
    if (p.vibrato > 0.005) {
      const vib = ctx.createGain();
      vib.gain.setValueAtTime(0, t);
      vib.gain.linearRampToValueAtTime(p.vibrato * 60, t + p.attack + 0.3); // cents
      lfo.connect(vib);
      for (const o of detunable) vib.connect(o.detune);
    }
    if (p.wobble > 0.005) {
      const wob = ctx.createGain();
      wob.gain.value = p.wobble * 2400; // cents: at 1.0 the cutoff swings two octaves each way
      lfo.connect(wob);
      for (const f of stages) wob.connect(f.detune);
    }
    sources.push(lfo);
  }

  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(peak, t + p.attack);
  out.gain.exponentialRampToValueAtTime(Math.max(peak * sus, 0.0001), t + p.attack + p.decay);

  sources.push(bend);
  const voice = heldVoice(ctx, t, out, sources, p.release);
  voice.pitchParams = [bend.offset]; // slide notes bend every oscillator through the shared bend
  sources.forEach((o) => o.start(t));
  let bendTarget = 0;
  // mono / legato: glide the sounding voice to a new note and hold it until that note ends
  voice.legato = (absPitch, at, newDur, glide) => {
    const cents = (absPitch - (pitch + semis)) * 100;
    bend.offset.cancelScheduledValues(at);
    bend.offset.setValueAtTime(bendTarget, at);
    bend.offset.linearRampToValueAtTime(cents, at + Math.max(0.005, glide));
    bendTarget = cents;
    out.gain.cancelAndHoldAtTime(at);
    out.gain.setTargetAtTime(Math.max(peak * sus, 0.0001), at, 0.02);
    voice.released = false;
    voice.end = Infinity;
    if (Number.isFinite(newDur)) voice.release(at + newDur);
  };
  voice.cut = (at) => {
    out.gain.cancelAndHoldAtTime(at);
    out.gain.setTargetAtTime(0.0001, at, 0.004);
    for (const s of sources) { try { s.stop(at + 0.03); } catch { /* already stopped */ } }
    voice.released = true;
    voice.end = at + 0.03;
  };
  if (Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}

// ---------------------------------------------------------------------------
// FM: carrier <- modulator 1 <- modulator 2 (a DX-style stack). The modulation index decays on its own
// envelope, which is what gives FM its bright-to-mellow "struck" character.
// ---------------------------------------------------------------------------
export function playFm(ctx, dest, pitch, t, dur, vel, semis, p) {
  const freq = midiToFreq(pitch + semis);
  const out = ctx.createGain();
  const peak = 0.2 * (0.25 + vel * 0.75);
  const sus = Math.max(p.sustain, 0.0001);
  const velScale = 1 - p.velSens + p.velSens * vel; // louder notes are brighter, like a real keyboard

  const carrier = ctx.createOscillator();
  carrier.frequency.value = freq * p.cratio;
  const m1 = ctx.createOscillator();
  m1.frequency.value = freq * p.ratio;
  const m1g = ctx.createGain();
  m1g.connect(carrier.frequency);
  const sources = [carrier, m1];

  // frequency deviation = index x modulator frequency; clamp it so very high notes cannot alias into noise
  const shape = (g, index, modFreq) => {
    const dev = Math.min(index * modFreq * velScale, 9000);
    g.gain.setValueAtTime(dev, t);
    g.gain.setTargetAtTime(dev * p.indexSus, t, Math.max(p.indexDecay, 0.01) / 3);
  };
  shape(m1g, p.index, freq * p.ratio);
  const pitched = [carrier.detune, m1.detune];
  if (p.index2 > 0.005) {
    const m2 = ctx.createOscillator();
    m2.frequency.value = freq * p.ratio2;
    const m2g = ctx.createGain();
    m2.connect(m2g).connect(m1.frequency);
    shape(m2g, p.index2, freq * p.ratio2);
    sources.push(m2);
    pitched.push(m2.detune);
    // A modulated modulator has a DC component whenever ratio is a multiple of ratio2 (a sideband lands on 0 Hz).
    // Fed into the carrier's frequency, that DC offsets its pitch and the note goes out of tune and inharmonic,
    // so block it before it reaches the carrier.
    const dc = ctx.createBiquadFilter();
    dc.type = 'highpass';
    dc.frequency.value = Math.min(12, freq * 0.1);
    dc.Q.value = 0.5;
    m1.connect(dc).connect(m1g);
  } else {
    m1.connect(m1g);
  }

  let tail = carrier;
  if (p.cutoff < 19500) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.cutoff;
    carrier.connect(lp);
    tail = lp;
  }
  tail.connect(out);

  if (p.trem > 0.005) { // amplitude tremolo (vibraphone / suitcase e-piano)
    const mod = ctx.createGain();
    mod.gain.value = 1 - p.trem / 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.tremRate;
    const depth = ctx.createGain();
    depth.gain.value = p.trem / 2;
    lfo.connect(depth).connect(mod.gain);
    out.connect(mod).connect(dest);
    sources.push(lfo);
  } else {
    out.connect(dest);
  }

  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(peak, t + Math.max(p.attack, 0.001));
  out.gain.exponentialRampToValueAtTime(Math.max(peak * sus, 0.0001), t + p.attack + p.decay);

  const voice = heldVoice(ctx, t, out, sources, p.release);
  voice.pitchParams = pitched;
  sources.forEach((o) => o.start(t));
  if (Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}

// ---------------------------------------------------------------------------
// Tonewheel organ: nine drawbars become one band-limited oscillator (all footages are integer harmonics of
// the 16' pitch), plus key-click, percussion and a rotary-speaker wobble.
// ---------------------------------------------------------------------------
export const DRAWBARS = [
  { key: 'd16', label: "16'", harmonic: 1 },
  { key: 'd513', label: "5⅓'", harmonic: 3 },
  { key: 'd8', label: "8'", harmonic: 2 },
  { key: 'd4', label: "4'", harmonic: 4 },
  { key: 'd223', label: "2⅔'", harmonic: 6 },
  { key: 'd2', label: "2'", harmonic: 8 },
  { key: 'd135', label: "1⅗'", harmonic: 10 },
  { key: 'd113', label: "1⅓'", harmonic: 12 },
  { key: 'd1', label: "1'", harmonic: 16 },
];

/** Harmonic weights (1-based index) for a set of drawbar positions 0-8; each step is about 3 dB. */
export function drawbarWeights(p) {
  const w = new Array(17).fill(0);
  for (const d of DRAWBARS) {
    const level = Math.round(p[d.key] ?? 0);
    w[d.harmonic] += level <= 0 ? 0 : dbToGain(-(8 - level) * 3);
  }
  return w;
}

export function playOrgan(ctx, dest, pitch, t, dur, vel, semis, p) {
  const freq = midiToFreq(pitch + semis);
  const out = ctx.createGain();
  const peak = 0.2 * (0.35 + vel * 0.65);

  const weights = drawbarWeights(p);
  const o = ctx.createOscillator();
  o.setPeriodicWave(harmonicWave(ctx, weights.map((x) => x.toFixed(3)).join(','), weights));
  o.frequency.value = freq / 2; // the 16' pitch; the weights place everything else on its harmonics
  const sources = [o];
  const pitched = [o.detune];
  o.connect(out);

  if (p.perc !== 'off') { // percussion: a decaying 2nd or 3rd harmonic at the front of the note
    const po = ctx.createOscillator();
    po.frequency.value = freq * (p.perc === '3rd' ? 3 : 2);
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.5, t);
    pg.gain.setTargetAtTime(0, t, 0.09);
    po.connect(pg).connect(out);
    sources.push(po);
    pitched.push(po.detune);
  }
  if (p.click > 0.005) {
    const n = noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(p.click * 0.5, t);
    ng.gain.setTargetAtTime(0, t, 0.004);
    n.connect(bp).connect(ng).connect(out);
    sources.push(n);
  }

  let tail = out;
  if (p.rotor !== 'off' && p.rotorDepth > 0.005) { // rotary speaker: a little pitch wobble and amplitude swell
    const rate = p.rotor === 'fast' ? 6.7 : 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const vib = ctx.createGain();
    vib.gain.value = p.rotorDepth * (p.rotor === 'fast' ? 14 : 8); // cents
    lfo.connect(vib).connect(o.detune);
    const am = ctx.createGain();
    am.gain.value = 1 - p.rotorDepth * 0.12;
    const amDepth = ctx.createGain();
    amDepth.gain.value = p.rotorDepth * 0.12;
    lfo.connect(amDepth).connect(am.gain);
    out.connect(am);
    tail = am;
    sources.push(lfo);
  }
  tail.connect(dest);

  const attack = Math.max(p.attack, 0.002);
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(peak, t + attack);

  const voice = heldVoice(ctx, t, out, sources, p.release);
  voice.pitchParams = pitched;
  sources.forEach((s) => s.start(t));
  if (Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}

// ---------------------------------------------------------------------------
// Plucked string: Karplus-Strong, rendered into a buffer per (pitch, settings) and cached.
// ---------------------------------------------------------------------------
/**
 * Extended Karplus-Strong. `decay` is the time (s) for the fundamental to fall 60 dB, `bright` (0-1) the
 * colour of the initial pluck, `damp` (0-1) how much faster the highs die away than the fundamental, `pick`
 * the pluck position along the string (0.05 near the bridge = thin and nasal, 0.5 = hollow). Tuned with an
 * all-pass fractional delay, so it is in tune up to the top of the keyboard.
 */
export function karplusStrong(sr, freq, { decay = 2, bright = 0.6, damp = 0.4, pick = 0.2, velocity = 0.8, seconds } = {}) {
  const N = sr / freq;
  const w0 = (2 * Math.PI * freq) / sr;

  // Loss filter: a one-pole low-pass in the loop, H(z) = b / (1 - a z^-1). Its gain per trip round the string
  // gives the fundamental a 60 dB decay of `decay` seconds and the top of the spectrum a much shorter one, so
  // the tone mellows as it rings the way a real string does. Both are per second, so every pitch decays alike.
  const t60 = Math.max(decay, 0.05);
  const t60High = t60 * Math.pow(10, -0.3 - 1.5 * clamp(damp, 0, 1));
  const g0 = Math.pow(10, -3 / (freq * t60));
  const gHigh = Math.pow(10, -3 / (freq * t60High));
  const r = g0 / gHigh;
  const a = Math.min((r - 1) / (r + 1), 0.95);
  const b = Math.min(g0 * Math.sqrt(1 - 2 * a * Math.cos(w0) + a * a), 0.99995 * (1 - a)); // |H| = g0 at the fundamental, never above 1
  const lossDelay = Math.atan2(a * Math.sin(w0), 1 - a * Math.cos(w0)) / w0; // its phase delay there, in samples

  const M = Math.max(2, Math.floor(N - lossDelay - 0.5));
  const d = N - lossDelay - M; // fractional delay the all-pass must supply (0.5..1.5)
  const C = (1 - d) / (1 + d);
  const length = Math.ceil(sr * (seconds ?? clamp(decay * 0.9, 0.3, 4.5)));
  const out = new Float32Array(length);

  // Excitation: the string's shape at the moment it is let go — a triangle peaking at the pick position, which
  // gives the 1/n² harmonics and the pick-position notches of a real pluck — plus a little noise for the
  // finger or plectrum, low-passed by brightness and velocity (relative to the pitch, so every note has the
  // same colour). Filtered circularly: the delay line is one period of a periodic wave.
  const line = new Float32Array(M);
  const apex = clamp(Math.round(pick * M), 1, M - 1);
  for (let i = 0; i < M; i++) line[i] = i < apex ? i / apex : (M - i) / (M - apex);
  const bv = clamp(bright + (velocity - 0.6) * 0.3, 0, 1);
  const grit = 0.1 + 0.5 * bv;
  for (let i = 0; i < M; i++) line[i] += grit * (Math.random() * 2 - 1);
  const fc = Math.min(freq * (1.5 + 30 * bv * bv), sr * 0.45);
  const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  for (let pass = 0; pass < 2; pass++) { // two one-pole stages (12 dB/oct), each run twice round so it wraps cleanly
    let y = 0;
    for (let n = 0; n < 2 * M; n++) { const i = n % M; y += k * (line[i] - y); if (n >= M) line[i] = y; }
  }
  let mean = 0, max = 1e-9;
  for (let i = 0; i < M; i++) mean += line[i];
  mean /= M;
  for (let i = 0; i < M; i++) { line[i] -= mean; max = Math.max(max, Math.abs(line[i])); }
  for (let i = 0; i < M; i++) line[i] /= max;

  let ptr = 0, lp = 0, apIn = 0, apOut = 0;
  for (let n = 0; n < length; n++) {
    const cur = line[ptr];
    out[n] = cur;
    lp = b * cur + a * lp;
    const ap = C * (lp - apOut) + apIn;
    apIn = lp;
    apOut = ap;
    line[ptr] = ap;
    if (++ptr === M) ptr = 0;
  }
  const fade = Math.min(length, Math.round(sr * 0.06)); // no click where the rendered buffer ends
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

const pluckCache = new Map(); // key -> AudioBuffer, least recently used first
const PLUCK_CACHE_MAX = 64;

function pluckBuffer(ctx, freq, p, vel) {
  const bucket = vel < 0.45 ? 0 : vel < 0.75 ? 1 : 2; // three velocity layers are enough
  const key = [ctx.sampleRate, freq.toFixed(2), p.decay, p.bright, p.damp, p.pick, bucket].join('|');
  let buf = pluckCache.get(key);
  if (buf) { pluckCache.delete(key); pluckCache.set(key, buf); return buf; }
  const data = karplusStrong(ctx.sampleRate, freq, { ...p, velocity: [0.3, 0.6, 0.95][bucket] });
  buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  pluckCache.set(key, buf);
  if (pluckCache.size > PLUCK_CACHE_MAX) pluckCache.delete(pluckCache.keys().next().value);
  return buf;
}

export function playPluck(ctx, dest, pitch, t, dur, vel, semis, p) {
  const freq = clamp(midiToFreq(pitch + semis), 30, ctx.sampleRate / 4);
  const buf = pluckBuffer(ctx, freq, p, vel);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const out = ctx.createGain();
  out.gain.value = 0.4 * (0.3 + vel * 0.7);
  let tail = src;
  if (p.body > 0.01) { // a resonance in the low mids, like the air in a guitar body
    const eq = ctx.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.value = 180;
    eq.Q.value = 1.1;
    eq.gain.value = p.body * 7;
    src.connect(eq);
    tail = eq;
  }
  tail.connect(out).connect(dest);
  src.start(t);
  const voice = { nodes: [src], out, end: t + buf.duration + 0.05, released: false, pitchParams: [src.detune] };
  voice.release = (when) => { // the string is damped when the note ends, like a muted or lifted finger
    if (voice.released) return;
    voice.released = true;
    const rt = Math.max(when, t + 0.002);
    out.gain.cancelAndHoldAtTime(rt);
    out.gain.setTargetAtTime(0.0001, rt, Math.max(p.release, 0.01) / 3);
    const stopAt = rt + p.release * 1.6 + 0.05;
    src.stop(Math.min(stopAt, t + buf.duration + 0.05));
    voice.end = Math.min(stopAt, voice.end);
  };
  if (Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}
