// Shared building blocks for the synthesized voices: noise, band-limited custom waveforms, envelopes, saturation.
// Everything here works on a plain BaseAudioContext, so it is the same code live and in offline renders.

// ---------------------------------------------------------------------------
// Noise. One buffer per (kind, sample rate), shared by every voice. Each voice starts it at a random
// offset, otherwise every hat and snare would be the identical burst ("machine gun" repeats).
// ---------------------------------------------------------------------------
const noiseBuffers = new Map();

function makeNoise(ctx, kind) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, sr * 4, sr);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0; // brown: integrated white noise, leaky so it never drifts away
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return buf;
}

/** A looping noise source ('white' | 'pink' | 'brown'). start(t) picks a random starting point in the buffer. */
export function noise(ctx, kind = 'white') {
  const key = `${kind}:${ctx.sampleRate}`;
  let buf = noiseBuffers.get(key);
  if (!buf) { buf = makeNoise(ctx, kind); noiseBuffers.set(key, buf); }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const start = src.start.bind(src);
  src.start = (t = 0) => start(t, Math.random() * (buf.duration - 0.5));
  return src;
}

// ---------------------------------------------------------------------------
// Custom waveforms (PeriodicWave). Band-limited by the browser, so they do not alias at high pitches.
// ---------------------------------------------------------------------------
const HARMONICS = 64;

/** Spectrum recipes: amplitude of harmonic n (1-based) as a function. */
const WAVE_RECIPES = {
  pulse25: (n) => (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25),
  pulse12: (n) => (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.125),
  hollow: (n) => (n % 2 ? 1 / (n * n) : 0), // odd harmonics, steep roll-off: clarinet-ish, soft
  reed: (n) => (n % 2 ? 1 / n ** 0.85 : 0.18 / n),
  organ: (n) => ({ 1: 1, 2: 0.7, 3: 0.35, 4: 0.5, 6: 0.22, 8: 0.16 })[n] ?? 0,
  glass: (n) => (n <= 12 ? (1 / n ** 1.4) * (1 + 0.8 * Math.sin(n * 1.7) ** 2) : 0),
  vocal: (n) => { // two broad "formant" humps over a gently falling spectrum: an "ah" that follows the pitch
    const hump = (c, w) => Math.exp(-((n - c) ** 2) / (2 * w * w));
    return (1 / n ** 0.6) * (0.35 + 1.4 * hump(5, 2.2) + 0.9 * hump(11, 3));
  },
};
export const CUSTOM_WAVES = Object.keys(WAVE_RECIPES);
const COSINE_PHASE = new Set(['pulse25', 'pulse12']); // real pulses are cosine series; the rest are sine series

const waveCache = new WeakMap(); // ctx -> Map(key -> PeriodicWave)

function cachedWave(ctx, key, build) {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  let w = m.get(key);
  if (!w) { w = build(); m.set(key, w); }
  return w;
}

/** A PeriodicWave for a named recipe (see CUSTOM_WAVES). */
export function customWave(ctx, name) {
  return cachedWave(ctx, name, () => {
    const f = WAVE_RECIPES[name];
    const real = new Float32Array(HARMONICS + 1);
    const imag = new Float32Array(HARMONICS + 1);
    const target = COSINE_PHASE.has(name) ? real : imag;
    for (let n = 1; n <= HARMONICS; n++) target[n] = f(n);
    return ctx.createPeriodicWave(real, imag);
  });
}

/** Set an oscillator to a basic or custom waveform by name. */
export function setWave(ctx, osc, name) {
  if (WAVE_RECIPES[name]) osc.setPeriodicWave(customWave(ctx, name));
  else osc.type = name;
}

/** Harmonic weights (index = harmonic number, 1-based) -> PeriodicWave, cached by key. */
export function harmonicWave(ctx, key, weights) {
  return cachedWave(ctx, `h:${key}`, () => {
    const real = new Float32Array(weights.length);
    const imag = new Float32Array(weights.length);
    for (let n = 1; n < weights.length; n++) imag[n] = weights[n];
    return ctx.createPeriodicWave(real, imag);
  });
}

// ---------------------------------------------------------------------------
// Envelopes and shaping
// ---------------------------------------------------------------------------
/** Percussive envelope: linear attack to `peak`, exponential decay to silence. */
export function perc(g, t, peak, decay, attack = 0.001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

const satCurves = new Map();
/** tanh soft-clipper curve; `amount` is the pre-gain in the curve (higher = harder). Cached. */
export function saturationCurve(amount = 3) {
  const key = Math.round(amount * 10);
  let c = satCurves.get(key);
  if (!c) {
    c = new Float32Array(2048);
    for (let i = 0; i < c.length; i++) c[i] = Math.tanh(((i / (c.length - 1)) * 2 - 1) * amount) / Math.tanh(amount);
    satCurves.set(key, c);
  }
  return c;
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
