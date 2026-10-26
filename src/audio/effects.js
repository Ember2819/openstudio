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

export const defaultEffectParams = (type) => Object.fromEntries(EFFECT_DEFS[type].params.map((m) => [m.key, m.def]));

function mixer(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  const setMix = (m) => { dry.gain.value = 1 - m * 0.7; wet.gain.value = m; };
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
  const delay = ctx.createDelay(2);
  const fb = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  m.input.connect(delay);
  delay.connect(tone).connect(m.wet).connect(m.output);
  tone.connect(fb).connect(delay);
  const apply = () => {
    delay.delayTime.value = p.time / 1000;
    fb.gain.value = p.feedback;
    tone.frequency.value = p.tone;
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
    makeup.gain.value = Math.pow(10, p.gain / 20);
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
  pre.connect(c).connect(post);
  const apply = () => {
    pre.gain.value = Math.pow(10, p.gain / 20);
    c.threshold.value = p.ceiling;
    c.release.value = p.release;
    post.gain.value = 1;
  };
  apply();
  return { input: pre, output: post, set(k, v) { p[k] = v; apply(); }, dispose() {} };
}

export function createEffect(ctx, type, params) {
  const def = EFFECT_DEFS[type];
  return def.create(ctx, { ...defaultEffectParams(type), ...params });
}
