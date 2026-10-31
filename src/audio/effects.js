// Built-in mixer effects. Each effect: { input, output, set(key, value), dispose() }.
const pct = (v) => `${Math.round(v * 100)}%`;

export const EFFECT_DEFS = {
  reverb: {
    name: 'Reverb',
    params: [
      { key: 'size', label: 'Decay', min: 0.2, max: 8, def: 2.2, fmt: (v) => `${v.toFixed(1)} s` },
      { key: 'pre', label: 'Pre-delay', min: 0, max: 0.12, def: 0.02, fmt: (v) => `${Math.round(v * 1000)} ms` },
      { key: 'damp', label: 'Damping', min: 0, max: 1, def: 0.45, fmt: pct },
      { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.3, fmt: pct },
    ],
    create: (ctx, p) => createReverb(ctx, p),
  },
  delay: {
    name: 'Delay',
    params: [
      { key: 'time', label: 'Time', min: 20, max: 1200, def: 340, log: true, fmt: (v) => `${Math.round(v)} ms` },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, def: 0.4, fmt: pct },
      { key: 'tone', label: 'Tone', min: 400, max: 14000, def: 5000, log: true, fmt: (v) => `${Math.round(v)} Hz` },
      { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.3, fmt: pct },
      { key: 'mode', label: 'Mode', type: 'select', options: ['mono', 'ping-pong'], def: 'mono' },
    ],
    create: (ctx, p) => createDelay(ctx, p),
  },
  distortion: {
    name: 'Distortion',
    params: [
      { key: 'drive', label: 'Drive', min: 1, max: 40, def: 8, log: true, fmt: (v) => `${v.toFixed(1)}x` },
      { key: 'tone', label: 'Tone', min: 500, max: 16000, def: 7000, log: true, fmt: (v) => `${Math.round(v)} Hz` },
      { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.6, fmt: pct },
    ],
    create: (ctx, p) => createDistortion(ctx, p),
  },
  chorus: {
    name: 'Chorus',
    params: [
      { key: 'rate', label: 'Rate', min: 0.1, max: 6, def: 0.8, log: true, fmt: (v) => `${v.toFixed(2)} Hz` },
      { key: 'depth', label: 'Depth', min: 0, max: 1, def: 0.5, fmt: pct },
      { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, fmt: pct },
    ],
    create: (ctx, p) => createChorus(ctx, p),
  },
  phaser: {
    name: 'Phaser',
    params: [
      { key: 'rate', label: 'Rate', min: 0.05, max: 8, def: 0.4, log: true, fmt: (v) => `${v.toFixed(2)} Hz` },
      { key: 'depth', label: 'Depth', min: 0, max: 1, def: 0.7, fmt: pct },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, def: 0.5, fmt: pct },
      { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, fmt: pct },
    ],
    create: (ctx, p) => createPhaser(ctx, p),
  },
  flanger: {
    name: 'Flanger',
    params: [
      { key: 'rate', label: 'Rate', min: 0.05, max: 5, def: 0.25, log: true, fmt: (v) => `${v.toFixed(2)} Hz` },
      { key: 'depth', label: 'Depth', min: 0, max: 1, def: 0.6, fmt: pct },
      { key: 'feedback', label: 'Feedback', min: -0.9, max: 0.9, def: 0.5, fmt: pct },
      { key: 'mix', label: 'Mix', min: 0, max: 1, def: 0.5, fmt: pct },
    ],
    create: (ctx, p) => createFlanger(ctx, p),
  },
  tremolo: {
    name: 'Tremolo',
    params: [
      { key: 'rate', label: 'Rate', min: 0.1, max: 20, def: 4, log: true, fmt: (v) => `${v.toFixed(2)} Hz` },
      { key: 'depth', label: 'Depth', min: 0, max: 1, def: 0.5, fmt: pct },
      { key: 'stereo', label: 'Auto-pan', min: 0, max: 1, def: 0, fmt: pct },
    ],
    create: (ctx, p) => createTremolo(ctx, p),
  },
  bitcrusher: {
    name: 'Bitcrusher',
    params: [
      { key: 'bits', label: 'Bits', min: 1, max: 16, def: 6, step: 1, fmt: (v) => `${Math.round(v)} bit` },
      { key: 'drive', label: 'Drive', min: 0, max: 24, def: 0, fmt: (v) => `+${v.toFixed(1)} dB` },
      { key: 'tone', label: 'Tone', min: 500, max: 20000, def: 20000, log: true, fmt: (v) => (v >= 19999 ? 'Open' : `${Math.round(v)} Hz`) },
      { key: 'mix', label: 'Mix', min: 0, max: 1, def: 1, fmt: pct },
    ],
    create: (ctx, p) => createBitcrusher(ctx, p),
  },
  stereo: {
    name: 'Stereo width',
    params: [{ key: 'width', label: 'Width', min: 0, max: 2, def: 1, fmt: (v) => (v === 0 ? 'Mono' : `${Math.round(v * 100)}%`) }],
    create: (ctx, p) => createStereo(ctx, p),
  },
  limiter: {
    name: 'Limiter',
    params: [
      { key: 'ceiling', label: 'Ceiling', min: -12, max: 0, def: -0.5, fmt: (v) => `${v.toFixed(1)} dB` },
      { key: 'release', label: 'Release', min: 0.01, max: 1, def: 0.1, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
      { key: 'gain', label: 'Input gain', min: 0, max: 18, def: 0, fmt: (v) => `+${v.toFixed(1)} dB` },
    ],
    create: (ctx, p) => createLimiter(ctx, p),
  },
  filter: {
    name: 'Filter',
    params: [
      { key: 'mode', label: 'Mode', type: 'select', options: ['lowpass', 'highpass', 'bandpass'], def: 'lowpass' },
      { key: 'cutoff', label: 'Cutoff', min: 40, max: 18000, def: 2400, log: true, fmt: (v) => `${Math.round(v)} Hz` },
      { key: 'res', label: 'Resonance', min: 0.1, max: 18, def: 1, fmt: (v) => v.toFixed(1) },
    ],
    create: (ctx, p) => createFilter(ctx, p),
  },
  eq: {
    name: 'Equalizer',
    params: [
      { key: 'low', label: 'Low', min: -18, max: 18, def: 0, fmt: (v) => `${v.toFixed(1)} dB` },
      { key: 'mid', label: 'Mid', min: -18, max: 18, def: 0, fmt: (v) => `${v.toFixed(1)} dB` },
      { key: 'midFreq', label: 'Mid freq', min: 200, max: 6000, def: 1200, log: true, fmt: (v) => `${Math.round(v)} Hz` },
      { key: 'high', label: 'High', min: -18, max: 18, def: 0, fmt: (v) => `${v.toFixed(1)} dB` },
    ],
    create: (ctx, p) => createEq(ctx, p),
  },
  compressor: {
    name: 'Compressor',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, def: -20, fmt: (v) => `${v.toFixed(0)} dB` },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, def: 4, fmt: (v) => `${v.toFixed(1)}:1` },
      { key: 'attack', label: 'Attack', min: 0.001, max: 0.3, def: 0.01, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
      { key: 'release', label: 'Release', min: 0.02, max: 1.2, def: 0.2, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
      { key: 'gain', label: 'Makeup', min: 0, max: 18, def: 3, fmt: (v) => `${v.toFixed(1)} dB` },
    ],
    create: (ctx, p) => createCompressor(ctx, p),
  },
};

// ---------------------------------------------------------------- 7-band parametric EQ (FL's Parametric EQ 2 layout)
export const PEQ_BANDS = [
  { type: 'highpass', f: 20, q: 0.71, label: 'Low cut' },
  { type: 'lowshelf', f: 90, q: 0.71, label: 'Low shelf' },
  { type: 'peaking', f: 250, q: 1, label: 'Low mid' },
  { type: 'peaking', f: 1000, q: 1, label: 'Mid' },
  { type: 'peaking', f: 3500, q: 1, label: 'High mid' },
  { type: 'highshelf', f: 8000, q: 0.71, label: 'High shelf' },
  { type: 'lowpass', f: 20000, q: 0.71, label: 'High cut' },
];
const hzFmt = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);
const dbFmt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
EFFECT_DEFS.peq = {
  name: 'Parametric EQ',
  view: 'eq',
  params: [
    ...PEQ_BANDS.flatMap((b, i) => [
      { key: `f${i + 1}`, label: `${b.label} freq`, min: 20, max: 20000, def: b.f, log: true, fmt: hzFmt, band: i },
      ...(b.type === 'highpass' || b.type === 'lowpass' ? [] : [{ key: `g${i + 1}`, label: `${b.label} gain`, min: -18, max: 18, def: 0, fmt: dbFmt, band: i }]),
      { key: `q${i + 1}`, label: `${b.label} ${b.type.endsWith('shelf') ? 'slope' : 'Q'}`, min: 0.1, max: 18, def: b.q, log: true, fmt: (v) => v.toFixed(2), band: i },
    ]),
    { key: 'out', label: 'Output', min: -18, max: 18, def: 0, fmt: dbFmt },
  ],
  create: (ctx, p) => createPeq(ctx, p),
};
EFFECT_DEFS.analyzer = {
  name: 'Spectrum analyser',
  view: 'spectrum',
  params: [{ key: 'slope', label: 'Tilt', min: 0, max: 6, def: 3, step: 1.5, fmt: (v) => `${v.toFixed(1)} dB/oct` }],
  create: (ctx, p) => createAnalyzer(ctx, p),
};
EFFECT_DEFS.gate = {
  name: 'Gate',
  params: [
    { key: 'threshold', label: 'Threshold', min: -80, max: 0, def: -40, fmt: (v) => `${v.toFixed(0)} dB` },
    { key: 'range', label: 'Range', min: 0, max: 80, def: 60, fmt: (v) => `−${v.toFixed(0)} dB` },
    { key: 'release', label: 'Release', min: 0.005, max: 1, def: 0.08, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
  ],
  create: (ctx, p) => createGate(ctx, p),
};
EFFECT_DEFS.multiband = {
  name: 'Multiband compressor',
  params: [
    { key: 'lowX', label: 'Low / mid', min: 60, max: 1000, def: 200, log: true, fmt: hzFmt },
    { key: 'highX', label: 'Mid / high', min: 1000, max: 12000, def: 3000, log: true, fmt: hzFmt },
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, def: -24, fmt: (v) => `${v.toFixed(0)} dB` },
    { key: 'ratio', label: 'Ratio', min: 1, max: 20, def: 4, fmt: (v) => `${v.toFixed(1)}:1` },
    { key: 'attack', label: 'Attack', min: 0.001, max: 0.2, def: 0.005, log: true, fmt: (v) => `${(v * 1000).toFixed(1)} ms` },
    { key: 'release', label: 'Release', min: 0.02, max: 1, def: 0.12, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
    { key: 'low', label: 'Low gain', min: -12, max: 12, def: 0, fmt: dbFmt },
    { key: 'mid', label: 'Mid gain', min: -12, max: 12, def: 0, fmt: dbFmt },
    { key: 'high', label: 'High gain', min: -12, max: 12, def: 0, fmt: dbFmt },
    { key: 'mix', label: 'Mix', min: 0, max: 1, def: 1, fmt: pct },
  ],
  create: (ctx, p) => createMultiband(ctx, p),
};

EFFECT_DEFS.sidechain = {
  name: 'Sidechain compressor',
  params: [
    { key: 'source', label: 'Key input', type: 'track', min: 1, max: 125, def: 1, step: 1, fmt: (v) => `Insert ${v}` },
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, def: -30, fmt: (v) => `${v.toFixed(0)} dB` },
    { key: 'ratio', label: 'Ratio', min: 1, max: 20, def: 6, fmt: (v) => `${v.toFixed(1)}:1` },
    { key: 'depth', label: 'Max reduction', min: 0, max: 48, def: 18, fmt: (v) => `−${v.toFixed(0)} dB` },
    { key: 'release', label: 'Release', min: 0.01, max: 1, def: 0.12, log: true, fmt: (v) => `${(v * 1000).toFixed(0)} ms` },
  ],
  create: (ctx, p) => createSidechain(ctx, p),
};

export const defaultEffectParams = (type) => Object.fromEntries(EFFECT_DEFS[type].params.map((m) => [m.key, m.def]));

/**
 * The makeup gain (dB) that a Web Audio DynamicsCompressorNode adds on its own: the spec makes up 0.6 × the gain it
 * takes off a full-scale signal. Effects divide it back out so their own "makeup" / "ceiling" mean what they say.
 * Mirrors the spec's static curve, including the soft-knee solve.
 */
export function compressorMakeupDb(threshold, knee, ratio) {
  const lin = (d) => Math.pow(10, d / 20);
  const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
  const thr = lin(threshold);
  const slope = 1 / ratio;
  const kneeCurve = (x, k) => (x < thr ? x : thr + (1 - Math.exp(-k * (x - thr))) / k);
  const slopeAt = (x, k) => {
    if (x < thr) return 1;
    const x2 = x * 1.001;
    return (db(kneeCurve(x2, k)) - db(kneeCurve(x, k))) / (db(x2) - db(x));
  };
  const kneeThr = lin(threshold + knee);
  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeThr, k) < slope) maxK = k; else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const full = 1 >= kneeThr ? db(kneeCurve(kneeThr, k)) + slope * (0 - (threshold + knee)) : db(kneeCurve(1, k));
  return -0.6 * full;
}

function mixer(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  // up to 50% the dry signal eases off gently; beyond that it fades to nothing, so 100% is fully wet (send buses)
  const setMix = (m) => { dry.gain.value = m <= 0.5 ? 1 - m * 0.7 : 1.3 * (1 - m); wet.gain.value = m; };
  return { input, output, dry, wet, setMix };
}

/** Synthetic stereo room impulse: pre-delay, a few early reflections, then a damped exponential noise tail. */
function impulse(ctx, rt60, damp, pre = 0.02) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (rt60 + pre + 0.1));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const start = Math.floor(pre * sr);
    let lp = 0;
    for (let i = start; i < len; i++) {
      const t = (i - start) / sr;
      const env = Math.pow(10, (-3 * t) / rt60); // -60 dB at rt60
      const coef = 1 - damp * 0.96 * Math.min(1, 0.15 + t / rt60);
      lp += ((Math.random() * 2 - 1) - lp) * coef;
      const fadeIn = Math.min(1, t / 0.012);
      d[i] = lp * env * fadeIn * 0.9;
    }
    for (let k = 0; k < 8; k++) {
      const at = start + Math.floor((0.004 + Math.random() * 0.055) * sr);
      if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * Math.pow(0.8, k);
    }
  }
  return buf;
}

function createReverb(ctx, p) {
  const m = mixer(ctx);
  const conv = ctx.createConvolver();
  m.input.connect(conv).connect(m.wet).connect(m.output);
  let rebuildTimer = null;
  const rebuild = () => { conv.buffer = impulse(ctx, p.size, p.damp, p.pre); };
  rebuild();
  m.setMix(p.mix);
  return {
    input: m.input, output: m.output,
    set(key, v) {
      p[key] = v;
      if (key === 'mix') m.setMix(v);
      else { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 120); }
    },
    dispose() { clearTimeout(rebuildTimer); },
  };
}

function createDelay(ctx, p) {
  const m = mixer(ctx);
  // stereo echo: delay → tone → wet, with the toned echo fed back
  const toStereo = ctx.createGain();
  const delay = ctx.createDelay(2);
  const fb = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  m.input.connect(toStereo).connect(delay);
  delay.connect(tone).connect(m.wet);
  tone.connect(fb).connect(delay);
  // ping-pong: the (mono) input echoes on the left, then the right, then the left …
  const toPing = ctx.createGain();
  toPing.channelCount = 1;
  toPing.channelCountMode = 'explicit';
  const dl = ctx.createDelay(2);
  const dr = ctx.createDelay(2);
  const toneP = ctx.createBiquadFilter();
  toneP.type = 'lowpass';
  const fbP = ctx.createGain();
  const merge = ctx.createChannelMerger(2);
  m.input.connect(toPing).connect(dl);
  dl.connect(dr);
  dr.connect(toneP).connect(fbP).connect(dl);
  dl.connect(merge, 0, 0);
  dr.connect(merge, 0, 1);
  merge.connect(m.wet);
  m.wet.connect(m.output);
  const apply = () => {
    const t = p.time / 1000;
    const ping = p.mode === 'ping-pong';
    delay.delayTime.value = dl.delayTime.value = dr.delayTime.value = t;
    fb.gain.value = fbP.gain.value = p.feedback;
    tone.frequency.value = toneP.frequency.value = p.tone;
    toStereo.gain.value = ping ? 0 : 1;
    toPing.gain.value = ping ? 1 : 0;
    m.setMix(p.mix);
  };
  apply();
  return { input: m.input, output: m.output, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createDistortion(ctx, p) {
  const m = mixer(ctx);
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const pre = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  const post = ctx.createGain();
  post.gain.value = 0.6;
  m.input.connect(pre).connect(shaper).connect(tone).connect(post).connect(m.wet).connect(m.output);
  // the curve spans -1..1 input; the pre-gain pushes the signal into saturation
  const x = new Float32Array(2048);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(((i / (x.length - 1)) * 2 - 1) * 3);
  shaper.curve = x;
  const apply = () => { pre.gain.value = p.drive / 3; tone.frequency.value = p.tone; m.setMix(p.mix); };
  apply();
  return { input: m.input, output: m.output, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createFilter(ctx, p) {
  const f = ctx.createBiquadFilter();
  const apply = () => { f.type = p.mode; f.frequency.value = p.cutoff; f.Q.value = p.res; };
  apply();
  return { input: f, output: f, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createEq(ctx, p) {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 160;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 6500;
  low.connect(mid).connect(high);
  const apply = () => { low.gain.value = p.low; mid.gain.value = p.mid; mid.frequency.value = p.midFreq; high.gain.value = p.high; };
  apply();
  return { input: low, output: high, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createCompressor(ctx, p) {
  const c = ctx.createDynamicsCompressor();
  c.knee.value = 6;
  const makeup = ctx.createGain();
  c.connect(makeup);
  const apply = () => {
    c.threshold.value = p.threshold;
    c.ratio.value = p.ratio;
    c.attack.value = p.attack;
    c.release.value = p.release;
    makeup.gain.value = Math.pow(10, (p.gain - compressorMakeupDb(p.threshold, 6, p.ratio)) / 20);
  };
  apply();
  return { input: c, output: makeup, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createChorus(ctx, p) {
  const m = mixer(ctx);
  const lfos = [];
  const delays = [];
  const bases = [0.018, 0.025, 0.032];
  [-0.8, 0, 0.8].forEach((pan, i) => {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = bases[i];
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    const depth = ctx.createGain();
    lfo.connect(depth).connect(delay.delayTime);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    m.input.connect(delay).connect(panner).connect(m.wet);
    lfo.start();
    lfos.push({ lfo, depth, i });
    delays.push(delay);
  });
  m.wet.connect(m.output);
  const apply = () => {
    lfos.forEach(({ lfo, depth, i }) => { lfo.frequency.value = p.rate * (0.85 + i * 0.15); depth.gain.value = p.depth * 0.006; });
    m.setMix(p.mix);
  };
  apply();
  return { input: m.input, output: m.output, set(k, v) { p[k] = v; apply(); }, dispose() { lfos.forEach(({ lfo }) => lfo.stop()); } };
}

function createPhaser(ctx, p) {
  const m = mixer(ctx);
  const stages = [];
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  const depth = ctx.createGain();
  lfo.connect(depth);
  const fb = ctx.createGain();
  const sum = ctx.createGain();
  m.input.connect(sum);
  let prev = sum;
  for (let i = 0; i < 4; i++) {
    const f = ctx.createBiquadFilter();
    f.type = 'allpass';
    f.frequency.value = 600 * (i + 1);
    f.Q.value = 0.7;
    depth.connect(f.frequency);
    prev.connect(f);
    prev = f;
    stages.push(f);
  }
  prev.connect(fb).connect(sum);
  prev.connect(m.wet).connect(m.output);
  lfo.start();
  const apply = () => {
    lfo.frequency.value = p.rate;
    depth.gain.value = p.depth * 900;
    fb.gain.value = p.feedback;
    m.setMix(p.mix);
  };
  apply();
  return { input: m.input, output: m.output, set(k, v) { p[k] = v; apply(); }, dispose() { lfo.stop(); } };
}

function createFlanger(ctx, p) {
  const m = mixer(ctx);
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = 0.004;
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  const fb = ctx.createGain();
  lfo.connect(depth).connect(delay.delayTime);
  m.input.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(m.wet).connect(m.output);
  lfo.start();
  const apply = () => {
    lfo.frequency.value = p.rate;
    depth.gain.value = p.depth * 0.0035; // sweep 0.5..7.5 ms around the 4 ms centre
    fb.gain.value = p.feedback;
    m.setMix(p.mix);
  };
  apply();
  return { input: m.input, output: m.output, set(k, v) { p[k] = v; apply(); }, dispose() { lfo.stop(); } };
}

function createTremolo(ctx, p) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const lfo = ctx.createOscillator();
  const inv = ctx.createGain(); // LFO for the right side; phase-flipped as auto-pan increases
  inv.gain.value = 1;
  const amps = [ctx.createGain(), ctx.createGain()];
  const depths = [ctx.createGain(), ctx.createGain()];
  input.connect(split);
  amps.forEach((g, c) => { split.connect(g, c); g.connect(merge, 0, c); });
  lfo.connect(depths[0]).connect(amps[0].gain);
  lfo.connect(inv).connect(depths[1]).connect(amps[1].gain);
  merge.connect(output);
  lfo.start();
  const apply = () => {
    lfo.frequency.value = p.rate;
    // gain swings between 1 - depth and 1
    for (const g of amps) g.gain.value = 1 - p.depth / 2;
    for (const d of depths) d.gain.value = p.depth / 2;
    inv.gain.value = 1 - 2 * p.stereo;
  };
  apply();
  return { input, output, set(k, v) { p[k] = v; apply(); }, dispose() { lfo.stop(); } };
}

function createBitcrusher(ctx, p) {
  const m = mixer(ctx);
  const pre = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  m.input.connect(pre).connect(shaper).connect(tone).connect(m.wet).connect(m.output);
  let bits = -1;
  const apply = () => {
    const b = Math.round(p.bits);
    if (b !== bits) {
      bits = b;
      // quantise -1..1 to 2^bits levels (the curve is sampled finely enough to keep the steps sharp)
      const n = 8192;
      const levels = 2 ** (b - 1);
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = Math.round(((i / (n - 1)) * 2 - 1) * levels) / levels;
      shaper.curve = curve;
    }
    pre.gain.value = Math.pow(10, p.drive / 20);
    tone.frequency.value = Math.min(p.tone, ctx.sampleRate / 2);
    // a fully wet crusher shouldn't keep the dry signal underneath
    m.setMix(p.mix);
    if (p.mix >= 0.999) m.dry.gain.value = 0;
  };
  apply();
  return { input: m.input, output: m.output, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createStereo(ctx, p) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  input.connect(split);
  const g = { ll: ctx.createGain(), lr: ctx.createGain(), rl: ctx.createGain(), rr: ctx.createGain() };
  split.connect(g.ll, 0); split.connect(g.lr, 0);
  split.connect(g.rl, 1); split.connect(g.rr, 1);
  g.ll.connect(merge, 0, 0); g.rl.connect(merge, 0, 0);
  g.rr.connect(merge, 0, 1); g.lr.connect(merge, 0, 1);
  merge.connect(output);
  const apply = () => {
    const a = (1 + p.width) / 2, b = (1 - p.width) / 2;
    g.ll.gain.value = a; g.rr.gain.value = a; g.rl.gain.value = b; g.lr.gain.value = b;
  };
  apply();
  return { input, output, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createLimiter(ctx, p) {
  const pre = ctx.createGain();
  const c = ctx.createDynamicsCompressor();
  c.knee.value = 0;
  c.ratio.value = 20;
  c.attack.value = 0.002;
  const post = ctx.createGain();
  // a ratio-20 compressor still lets 1/20 of the overshoot through: a soft clip at the ceiling catches the rest
  const clip = ctx.createWaveShaper();
  clip.oversample = '4x';
  pre.connect(c).connect(post).connect(clip);
  let curveFor = null;
  const apply = () => {
    pre.gain.value = Math.pow(10, p.gain / 20);
    c.threshold.value = p.ceiling;
    c.release.value = p.release;
    post.gain.value = Math.pow(10, -compressorMakeupDb(p.ceiling, 0, 20) / 20);
    if (curveFor !== p.ceiling) {
      curveFor = p.ceiling;
      const ceil = Math.pow(10, p.ceiling / 20);
      const knee = ceil * 0.9;
      const N = 4096;
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        const a = Math.abs(x);
        const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
        curve[i] = Math.sign(x) * y;
      }
      clip.curve = curve;
    }
  };
  apply();
  return { input: pre, output: clip, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

function createPeq(ctx, p) {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const filters = PEQ_BANDS.map((b) => { const f = ctx.createBiquadFilter(); f.type = b.type; return f; });
  let node = input;
  for (const f of filters) { node.connect(f); node = f; }
  node.connect(out);
  // what the EQ window draws: a spectrum of the output
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.8;
  out.connect(analyser);
  const apply = () => {
    filters.forEach((f, i) => {
      const n = i + 1;
      f.frequency.value = p[`f${n}`];
      f.Q.value = p[`q${n}`];
      if (p[`g${n}`] !== undefined) f.gain.value = p[`g${n}`];
    });
    out.gain.value = Math.pow(10, p.out / 20);
  };
  apply();
  return {
    input, output: out, analyser,
    /** Summed response (dB) of every band at `freqs` (Float32Array, Hz). */
    response(freqs, bands = filters.map((_, i) => i)) {
      const mag = new Float32Array(freqs.length);
      const phase = new Float32Array(freqs.length);
      const total = new Float32Array(freqs.length).fill(p.out);
      for (const i of bands) {
        filters[i].getFrequencyResponse(freqs, mag, phase);
        for (let k = 0; k < freqs.length; k++) total[k] += 20 * Math.log10(Math.max(1e-6, mag[k]));
      }
      return total;
    },
    set(k, v) { p[k] = v; apply(); },
    dispose() {},
  };
}

function createAnalyzer(ctx, p) {
  const node = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.75;
  node.connect(analyser);
  return { input: node, output: node, analyser, params: p, set(k, v) { p[k] = v; }, dispose() {} };
}

// ---------------------------------------------------------------- envelope-follower effects (AudioWorklet)
const worklets = new WeakMap(); // context -> Promise (module loaded)

/** Load the dynamics worklet into a context (once). Engines call it at start; offline renders await it. */
export function loadEffectWorklets(ctx) {
  if (!worklets.has(ctx)) {
    const p = ctx.audioWorklet ? ctx.audioWorklet.addModule(new URL('./dynamics-worklet.js', import.meta.url)).then(() => true, (err) => { console.error('Effect worklet failed to load', err); return false; }) : Promise.resolve(false);
    worklets.set(ctx, p);
  }
  return worklets.get(ctx);
}

/**
 * A gain stage driven by a follower of `key`: input → vca (gain from the follower). The follower is built as soon as
 * the worklet is loaded; until then the signal passes unchanged.
 */
function follower(ctx, key, vca, params) {
  const state = { node: null, set: () => {} };
  vca.gain.value = 1;
  loadEffectWorklets(ctx).then((ok) => {
    if (!ok || state.disposed) return;
    const node = new AudioWorkletNode(ctx, 'openstudio-dynamics', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    key.connect(node);
    vca.gain.value = 0;
    node.connect(vca.gain);
    state.node = node;
    state.set = (values) => { for (const [k, v] of Object.entries(values)) node.parameters.get(k).setValueAtTime(v, ctx.currentTime); };
    state.set(params());
  });
  state.update = () => state.set(params());
  state.dispose = () => { state.disposed = true; if (state.node) { state.node.port.postMessage('close'); state.node.disconnect(); } };
  return state;
}

/** Noise gate: opens when the signal passes the threshold, closes with the release after a short hold. */
function createGate(ctx, p) {
  const input = ctx.createGain();
  const vca = ctx.createGain();
  input.connect(vca);
  const f = follower(ctx, input, vca, () => ({
    mode: 1, threshold: Math.pow(10, p.threshold / 20), floor: Math.pow(10, -p.range / 20), attack: 0.0005, release: p.release, hold: 0.015,
  }));
  return { input, output: vca, set(k, v) { p[k] = v; f.update(); }, dispose() { f.dispose(); } };
}

/**
 * Compressor keyed by another signal (`key`, wired by the engine from another mixer track): the key's envelope
 * (fast attack, set release) drives the gain of the input through the static compression curve — the classic
 * kick-ducks-the-bass pump.
 */
function createSidechain(ctx, p) {
  const input = ctx.createGain();
  const vca = ctx.createGain();
  const key = ctx.createGain();
  input.connect(vca);
  const f = follower(ctx, key, vca, () => ({
    mode: 0, threshold: Math.pow(10, p.threshold / 20), ratio: p.ratio, floor: Math.pow(10, -p.depth / 20), attack: 0.001, release: p.release,
  }));
  return { input, output: vca, key, set(k, v) { p[k] = v; if (k !== 'source') f.update(); }, dispose() { f.dispose(); } };
}

/** Three bands split by Linkwitz-Riley crossovers, each through its own compressor, then summed. */
function createMultiband(ctx, p) {
  const m = mixer(ctx);
  const lr = (type) => { const a = ctx.createBiquadFilter(); const b = ctx.createBiquadFilter(); a.type = b.type = type; a.Q.value = b.Q.value = Math.SQRT1_2; a.connect(b); return [a, b]; };
  const [lowA, lowB] = lr('lowpass');
  const [midHpA, midHpB] = lr('highpass');
  const [midLpA, midLpB] = lr('lowpass');
  const [highA, highB] = lr('highpass');
  const comps = [0, 1, 2].map(() => { const c = ctx.createDynamicsCompressor(); c.knee.value = 6; return c; });
  const gains = [0, 1, 2].map(() => ctx.createGain());
  m.input.connect(lowA); lowB.connect(comps[0]);
  m.input.connect(midHpA); midHpB.connect(midLpA); midLpB.connect(comps[1]);
  m.input.connect(highA); highB.connect(comps[2]);
  comps.forEach((c, i) => c.connect(gains[i]).connect(m.wet));
  m.wet.connect(m.output);
  const apply = () => {
    lowA.frequency.value = lowB.frequency.value = midHpA.frequency.value = midHpB.frequency.value = p.lowX;
    midLpA.frequency.value = midLpB.frequency.value = highA.frequency.value = highB.frequency.value = Math.max(p.highX, p.lowX * 1.5);
    for (const c of comps) {
      c.threshold.value = p.threshold;
      c.ratio.value = p.ratio;
      c.attack.value = p.attack;
      c.release.value = p.release;
    }
    // no automatic makeup: below the threshold the bands sum back to the input; the band gains are the makeup
    const auto = compressorMakeupDb(p.threshold, 6, p.ratio);
    [p.low, p.mid, p.high].forEach((db, i) => { gains[i].gain.value = Math.pow(10, (db - auto) / 20); });
    m.setMix(p.mix);
  };
  apply();
  return { input: m.input, output: m.output, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

export function createEffect(ctx, type, params) {
  const def = EFFECT_DEFS[type];
  return def.create(ctx, { ...defaultEffectParams(type), ...params });
}
