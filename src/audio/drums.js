// Synthesized drum voices. Each voice: (ctx, dest, t, velocity, k, params) -> { nodes, out, end, release }
//   k      pitch multiplier (2^(semitones/12)), params { decay, tone, pitch } from the channel
import { noise, perc as env, saturationCurve } from './dsp.js';

const finish = (nodes, out, end) => ({ nodes, out, end, release() {} });

function osc(ctx, type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}
function filt(ctx, type, freq, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function hatVoice(ctx, dest, t, v, k, p, decay, level = 0.42) {
  const g = ctx.createGain();
  env(g, t, v * level, decay);
  const bp = filt(ctx, 'bandpass', 9500 * k, 0.8);
  const hp = filt(ctx, 'highpass', 6000 + p.tone * 2500);
  const nodes = [263, 400, 421, 474, 587, 845].map((f) => {
    const o = osc(ctx, 'square', f * 2.1 * k);
    o.connect(bp);
    o.start(t);
    o.stop(t + decay + 0.06);
    return o;
  });
  bp.connect(hp).connect(g).connect(dest);
  return finish(nodes, g, t + decay + 0.06);
}

/**
 * Cymbal metal: six detuned square waves at inharmonic ratios (the 808's recipe). Summed, their odd harmonics
 * fill the top octaves with a dense, clangy spectrum that a filter then places, which plain noise cannot do.
 */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(ctx, t, stop, mult) {
  const bus = ctx.createGain();
  bus.gain.value = 0.2;
  const nodes = METAL.map((f) => {
    const o = osc(ctx, 'square', f * mult);
    o.connect(bus);
    o.start(t);
    o.stop(stop);
    return o;
  });
  return { bus, nodes };
}

/** A sine "body" with a pitch drop, through its own envelope. */
function body(ctx, dest, t, from, to, drop, decay, peak) {
  const o = osc(ctx, 'sine', from);
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + drop);
  const g = ctx.createGain();
  env(g, t, peak, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + decay + 0.05);
  return { o, g };
}

/** Shaped noise burst: noise -> filters -> envelope. */
function burst(ctx, dest, t, peak, decay, filters, attack = 0.001) {
  const n = noise(ctx);
  const g = ctx.createGain();
  env(g, t, peak, decay, attack);
  let tail = n;
  for (const f of filters) tail = tail.connect(f);
  tail.connect(g).connect(dest);
  n.start(t);
  n.stop(t + attack + decay + 0.05);
  return { n, g };
}

export const DRUMS = {
  kick(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const o = osc(ctx, 'sine', 170 * k);
    o.frequency.setValueAtTime(170 * k, t);
    o.frequency.exponentialRampToValueAtTime(52 * k, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(40 * k, t + 0.45 * d);
    const g = ctx.createGain();
    env(g, t, v * 1.05, 0.5 * d);
    const lp = filt(ctx, 'lowpass', 600 + p.tone * 12000);
    o.connect(g).connect(lp).connect(dest);
    // transient click
    const click = burst(ctx, dest, t, v * 0.22 * (0.4 + p.tone), 0.012, [filt(ctx, 'highpass', 1800)]);
    const end = t + 0.55 * d + 0.05;
    o.start(t); o.stop(end);
    return finish([o, click.n], g, end);
  },
  snare(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const nz = burst(ctx, dest, t, v * 0.75, 0.17 * d, [filt(ctx, 'highpass', 900 * k), filt(ctx, 'lowpass', 3000 + p.tone * 9000)]);
    const o = osc(ctx, 'triangle', 240 * k);
    o.frequency.setValueAtTime(240 * k, t);
    o.frequency.exponentialRampToValueAtTime(170 * k, t + 0.08);
    const og = ctx.createGain();
    env(og, t, v * 0.6, 0.11 * d);
    o.connect(og).connect(dest);
    const end = t + 0.3 * d + 0.05;
    o.start(t); o.stop(end);
    return finish([nz.n, o], nz.g, end);
  },
  clap(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const n = noise(ctx);
    const bp = filt(ctx, 'bandpass', 1150 * k, 1.1);
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
    n.connect(bp).connect(filt(ctx, 'lowpass', 3500 + p.tone * 8000)).connect(g).connect(dest);
    const end = t + 0.3 * d + 0.06;
    n.start(t); n.stop(end);
    return finish([n], g, end);
  },
  hat(ctx, dest, t, v, k, p) { return hatVoice(ctx, dest, t, v, k, p, 0.06 * p.decay); },
  openhat(ctx, dest, t, v, k, p) { return hatVoice(ctx, dest, t, v, k, p, 0.4 * p.decay); },
  tom(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const { o, g } = body(ctx, dest, t, 230 * k, 95 * k, 0.22 * d, 0.35 * d, v * 0.95);
    return finish([o], g, t + 0.4 * d + 0.05);
  },
  rim(ctx, dest, t, v, k, p) {
    const o = osc(ctx, 'triangle', 1750 * k);
    const g = ctx.createGain();
    env(g, t, v * 0.7, 0.03 * p.decay);
    o.connect(g).connect(dest);
    const nz = burst(ctx, dest, t, v * 0.25, 0.02, [filt(ctx, 'highpass', 2500)]);
    const end = t + 0.1 * p.decay;
    o.start(t); o.stop(end);
    return finish([o, nz.n], g, end);
  },
  cowbell(ctx, dest, t, v, k, p) {
    const g = ctx.createGain();
    env(g, t, v * 0.55, 0.28 * p.decay);
    const bp = filt(ctx, 'bandpass', 820 * k, 1.4);
    const nodes = [560, 845].map((f) => {
      const o = osc(ctx, 'square', f * k);
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.35 * p.decay + 0.05);
      return o;
    });
    bp.connect(g).connect(dest);
    return finish(nodes, g, t + 0.35 * p.decay + 0.05);
  },
  /** Crash: a bright splash of metal and noise that blooms and then washes out over a couple of seconds. */
  crash(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const end = t + 2.4 * d + 0.06;
    const m = metal(ctx, t, end, 2.8 * k);
    const g = ctx.createGain();
    env(g, t, v * 0.55, 2.3 * d, 0.003);
    m.bus.connect(filt(ctx, 'highpass', 3600 * k)).connect(filt(ctx, 'lowpass', 9000 + p.tone * 7000)).connect(g).connect(dest);
    const wash = burst(ctx, dest, t, v * 0.32, 1.9 * d, [filt(ctx, 'highpass', 4500 * k), filt(ctx, 'lowpass', 8000 + p.tone * 8000)], 0.004);
    const splash = burst(ctx, dest, t, v * 0.28, 0.12 * d, [filt(ctx, 'bandpass', 3800 * k, 0.8)]);
    return finish([...m.nodes, wash.n, splash.n], g, end);
  },
  /** Ride: a defined stick "ping" on a quieter, sustaining shimmer of metal. */
  ride(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const end = t + 1.8 * d + 0.06;
    const m = metal(ctx, t, end, 3.4 * k);
    const g = ctx.createGain();
    env(g, t, v * 0.32, 1.7 * d, 0.002);
    m.bus.connect(filt(ctx, 'bandpass', 7200 * k, 0.7)).connect(filt(ctx, 'highpass', 3000 * k)).connect(g).connect(dest);
    const ping = ctx.createGain();
    env(ping, t, v * 0.16, 0.35 * d);
    const pings = [[3150, 1], [4520, 0.6], [5870, 0.4]].map(([f, a]) => {
      const o = osc(ctx, 'sine', f * k);
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(ping);
      o.start(t); o.stop(t + 0.45 * d + 0.05);
      return o;
    });
    ping.connect(dest);
    const tick = burst(ctx, dest, t, v * 0.18, 0.015, [filt(ctx, 'highpass', 5000)]);
    return finish([...m.nodes, ...pings, tick.n], g, end);
  },
  shaker(ctx, dest, t, v, k, p) {
    const d = p.decay;
    // a shaker swells instead of clicking
    const nz = burst(ctx, dest, t, v * 0.5, 0.09 * d, [filt(ctx, 'bandpass', 5200 * k, 1.6), filt(ctx, 'highpass', 3000 + p.tone * 3000)], 0.02);
    return finish([nz.n], nz.g, t + 0.14 * d + 0.05);
  },
  /** Tambourine: the jingles ring as metal, re-struck a few times in quick succession as they rattle together. */
  tambourine(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const end = t + 0.32 * d + 0.05;
    const m = metal(ctx, t, end, 9.5 * k);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    [[0, 1], [0.011, 0.75], [0.024, 0.6], [0.04, 0.45]].forEach(([off, a], i, hits) => {
      const at = t + off;
      g.gain.setValueAtTime(Math.max(v * 0.5 * a, 0.0002), at);
      if (i < hits.length - 1) g.gain.exponentialRampToValueAtTime(v * 0.12 * a + 0.0002, t + hits[i + 1][0] - 0.0005);
    });
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04 + 0.26 * d);
    m.bus.connect(filt(ctx, 'bandpass', 9000 * k, 1.1)).connect(filt(ctx, 'highpass', 5500)).connect(g).connect(dest);
    const shh = burst(ctx, dest, t, v * 0.18, 0.12 * d, [filt(ctx, 'bandpass', 10500 * k, 1.5)], 0.003);
    return finish([...m.nodes, shh.n], g, end);
  },
  clave(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const o = osc(ctx, 'sine', 2450 * k);
    const g = ctx.createGain();
    env(g, t, v * 0.8, 0.035 * d);
    const o2 = osc(ctx, 'triangle', 1230 * k);
    const g2 = ctx.createGain();
    env(g2, t, v * 0.25, 0.02 * d);
    o.connect(g).connect(dest);
    o2.connect(g2).connect(dest);
    const end = t + 0.08 * d + 0.03;
    o.start(t); o.stop(end);
    o2.start(t); o2.stop(end);
    return finish([o, o2], g, end);
  },

  // ---- added in 0.4 -------------------------------------------------------------------------------------
  /** Long, round 808-style kick: slow pitch glide, soft-clipped so it carries on small speakers. */
  kick808(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const o = osc(ctx, 'sine', 140 * k);
    o.frequency.setValueAtTime(140 * k, t);
    o.frequency.exponentialRampToValueAtTime(48 * k, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(40 * k, t + 0.9 * d);
    const g = ctx.createGain();
    env(g, t, v * 0.9, 1.0 * d, 0.002);
    const sat = ctx.createWaveShaper();
    sat.curve = saturationCurve(1 + p.tone * 3);
    sat.oversample = '2x';
    const lp = filt(ctx, 'lowpass', 400 + p.tone * 5000);
    o.connect(g).connect(sat).connect(lp).connect(dest);
    const end = t + 1.05 * d + 0.05;
    o.start(t); o.stop(end);
    return finish([o], g, end);
  },
  /** Tight, punchy kick for techno / house: fast drop, short body, hard click. */
  kickpunch(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const o = osc(ctx, 'sine', 230 * k);
    o.frequency.setValueAtTime(230 * k, t);
    o.frequency.exponentialRampToValueAtTime(58 * k, t + 0.035);
    o.frequency.exponentialRampToValueAtTime(44 * k, t + 0.22 * d);
    const g = ctx.createGain();
    env(g, t, v * 1.0, 0.26 * d);
    const sat = ctx.createWaveShaper();
    sat.curve = saturationCurve(2.2);
    o.connect(g).connect(sat).connect(dest);
    const click = burst(ctx, dest, t, v * 0.3 * (0.4 + p.tone), 0.008, [filt(ctx, 'bandpass', 3200, 0.9)]);
    const end = t + 0.3 * d + 0.05;
    o.start(t); o.stop(end);
    return finish([o, click.n], g, end);
  },
  snare808(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const a = body(ctx, dest, t, 215 * k, 180 * k, 0.05, 0.14 * d, v * 0.55);
    const b = body(ctx, dest, t, 335 * k, 300 * k, 0.05, 0.09 * d, v * 0.35);
    const nz = burst(ctx, dest, t, v * 0.5, 0.21 * d, [filt(ctx, 'highpass', 1400 * k), filt(ctx, 'lowpass', 4500 + p.tone * 8000)]);
    return finish([a.o, b.o, nz.n], nz.g, t + 0.3 * d + 0.05);
  },
  /** Backbeat snare with a fat body and a longer, rattly tail: rock / pop. */
  snarefat(ctx, dest, t, v, k, p) {
    const d = p.decay;
    const a = body(ctx, dest, t, 260 * k, 175 * k, 0.07, 0.2 * d, v * 0.7);
    const nz = burst(ctx, dest, t, v * 0.85, 0.28 * d, [filt(ctx, 'highpass', 700 * k), filt(ctx, 'lowpass', 5500 + p.tone * 8000)]);
    const rattle = burst(ctx, dest, t + 0.012, v * 0.25, 0.22 * d, [filt(ctx, 'bandpass', 4200, 0.9)], 0.015);
    return finish([a.o, nz.n, rattle.n], nz.g, t + 0.36 * d + 0.06);
  },
  rimshot(ctx, dest, t, v, k, p) {
    const a = body(ctx, dest, t, 520 * k, 480 * k, 0.02, 0.05 * p.decay, v * 0.6);
    const b = osc(ctx, 'triangle', 1820 * k);
    const bg = ctx.createGain();
    env(bg, t, v * 0.5, 0.035 * p.decay);
    b.connect(bg).connect(dest);
    const nz = burst(ctx, dest, t, v * 0.45, 0.03, [filt(ctx, 'bandpass', 2600, 0.8)]);
    const end = t + 0.1 * p.decay;
    b.start(t); b.stop(end);
    return finish([a.o, b, nz.n], bg, end);
  },
  /** Finger snap: two tiny noise slaps and a short, airy "pop". */
  snap(ctx, dest, t, v, k, p) {
    const n = noise(ctx);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v * 0.55, t + 0.001);
    g.gain.exponentialRampToValueAtTime(v * 0.12, t + 0.014);
    g.gain.linearRampToValueAtTime(v * 0.45, t + 0.016);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07 * p.decay);
    n.connect(filt(ctx, 'bandpass', 2000 * k, 2.2)).connect(g).connect(dest);
    const pop = body(ctx, dest, t, 1300 * k, 650 * k, 0.03, 0.05, v * 0.25);
    const end = t + 0.1 * p.decay + 0.03;
    n.start(t); n.stop(end);
    return finish([n, pop.o], g, end);
  },
  conga(ctx, dest, t, v, k, p) {
    const a = body(ctx, dest, t, 380 * k, 285 * k, 0.04, 0.3 * p.decay, v * 0.85);
    const slap = burst(ctx, dest, t, v * 0.2, 0.012, [filt(ctx, 'bandpass', 1700, 1.2)]);
    return finish([a.o, slap.n], a.g, t + 0.34 * p.decay + 0.05);
  },
  bongo(ctx, dest, t, v, k, p) {
    const a = body(ctx, dest, t, 560 * k, 430 * k, 0.025, 0.16 * p.decay, v * 0.8);
    const slap = burst(ctx, dest, t, v * 0.18, 0.01, [filt(ctx, 'bandpass', 2400, 1.2)]);
    return finish([a.o, slap.n], a.g, t + 0.2 * p.decay + 0.05);
  },
  woodblock(ctx, dest, t, v, k, p) {
    const a = body(ctx, dest, t, 1180 * k, 1150 * k, 0.01, 0.07 * p.decay, v * 0.75);
    const b = body(ctx, dest, t, 1770 * k, 1750 * k, 0.01, 0.045 * p.decay, v * 0.35);
    return finish([a.o, b.o], a.g, t + 0.1 * p.decay + 0.05);
  },
  /** Orchestral triangle: three inharmonic partials with a long ring. */
  triangle(ctx, dest, t, v, k, p) {
    const g = ctx.createGain();
    env(g, t, v * 0.4, 1.4 * p.decay, 0.001);
    const nodes = [[2800, 1], [5900, 0.55], [8700, 0.35], [11300, 0.2]].map(([f, a]) => {
      const o = osc(ctx, 'sine', f * k);
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.5 * p.decay + 0.05);
      return o;
    });
    g.connect(dest);
    return finish(nodes, g, t + 1.5 * p.decay + 0.05);
  },
  cabasa(ctx, dest, t, v, k, p) {
    const nz = burst(ctx, dest, t, v * 0.45, 0.055 * p.decay, [filt(ctx, 'highpass', 6500 * k), filt(ctx, 'lowpass', 14000)], 0.006);
    return finish([nz.n], nz.g, t + 0.09 * p.decay + 0.05);
  },
  hatpedal(ctx, dest, t, v, k, p) { return hatVoice(ctx, dest, t, v, k * 0.92, p, 0.028 * p.decay, 0.34); },
  ridebell(ctx, dest, t, v, k, p) {
    const g = ctx.createGain();
    env(g, t, v * 0.4, 0.9 * p.decay, 0.001);
    const nodes = [[1900, 1], [2890, 0.7], [4100, 0.5], [5600, 0.3]].map(([f, a]) => {
      const o = osc(ctx, 'sine', f * k);
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1 * p.decay + 0.05);
      return o;
    });
    g.connect(dest);
    const tick = burst(ctx, dest, t, v * 0.15, 0.01, [filt(ctx, 'highpass', 6000)]);
    return finish([...nodes, tick.n], g, t + 1 * p.decay + 0.05);
  },
};

export function playDrum(ctx, dest, voice, t, vel, semis, params) {
  const fn = DRUMS[voice] || DRUMS.kick;
  const k = Math.pow(2, (semis + (params.pitch || 0)) / 12);
  return fn(ctx, dest, t, 0.25 + vel * 0.75, k, params);
}
