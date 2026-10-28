// Sound-effect generator: risers, impacts, sweeps, textures and one-shots built from noise and oscillators.
// play(ctx, dest, t, len, v, k, tone) -> { nodes, out, end }
//   len   seconds the effect should last (sustained effects stretch to it; one-shots ignore it)
//   k     pitch multiplier from the note and the channel's pitch parameter
//   tone  0..1, how bright the effect is (scales filter cutoffs)
import { noise, saturationCurve, clamp } from './dsp.js';

const filt = (ctx, type, freq, q = 0.7) => {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
};
const osc = (ctx, type, freq) => {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
};
const gainNode = (ctx, v = 1) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};
const expTo = (param, to, at) => param.exponentialRampToValueAtTime(Math.max(to, 0.0001), at);
/** Exponential sweep from `from` at t0 to `to` at t1 (the ramp needs an explicit start event, or it begins at time 0). */
const sweep = (param, from, to, t0, t1) => { param.setValueAtTime(Math.max(from, 0.0001), t0); expTo(param, to, t1); };

/** Common wrap-up: a master gain with a short fade-out so nothing ends on a click. */
function voiceOf(ctx, dest, t, end, nodes, build) {
  const out = ctx.createGain();
  out.connect(dest);
  build(out);
  out.gain.setValueAtTime(1, Math.max(t, end - 0.02));
  out.gain.linearRampToValueAtTime(0, end);
  for (const n of nodes) { n.start(t); n.stop(end + 0.02); }
  return { nodes, out, end: end + 0.05, release() {} };
}

/** Sound definitions. sustained: stretches to the note / length; otherwise it is a one-shot of its natural length. texture: an ambience that sits under a whole song rather than marking a transition. */
export const SFX = {
  riser: {
    label: 'Riser', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx, 'pink');
      const bp = filt(ctx, 'bandpass', 300, 2.5);
      sweep(bp.frequency, 300, (5000 + tone * 8000) * Math.min(k, 3), t, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.02 * v, t);
      expTo(g.gain, 1 * v, t + len);
      const tonal = osc(ctx, 'sawtooth', 180 * k);
      sweep(tonal.frequency, 180 * k, 1500 * k, t, t + len);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t);
      expTo(tg.gain, 0.16 * v, t + len);
      const tlp = filt(ctx, 'lowpass', 1800 + tone * 3000);
      return voiceOf(ctx, dest, t, t + len, [n, tonal], (out) => {
        n.connect(bp).connect(g).connect(out);
        tonal.connect(tlp).connect(tg).connect(out);
      });
    },
  },
  downlifter: {
    label: 'Downlifter', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx, 'pink');
      const bp = filt(ctx, 'bandpass', 1000, 2);
      sweep(bp.frequency, (6000 + tone * 6000) * Math.min(k, 3), 250, t, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9 * v, t);
      expTo(g.gain, 0.01 * v, t + len);
      const tonal = osc(ctx, 'sawtooth', 1400 * k);
      sweep(tonal.frequency, 1400 * k, 90 * k, t, t + len);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.14 * v, t);
      expTo(tg.gain, 0.0005, t + len);
      return voiceOf(ctx, dest, t, t + len, [n, tonal], (out) => {
        n.connect(bp).connect(g).connect(out);
        tonal.connect(filt(ctx, 'lowpass', 2200 + tone * 3000)).connect(tg).connect(out);
      });
    },
  },
  swell: {
    label: 'Tonal Swell', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const lp = filt(ctx, 'lowpass', 250, 1.5);
      sweep(lp.frequency, 250, 2500 + tone * 7000, t, t + len * 0.92);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      expTo(g.gain, 0.35 * v, t + len * 0.95);
      const nodes = [-1, 0, 1].flatMap((d) => [osc(ctx, 'sawtooth', 110 * k), osc(ctx, 'sawtooth', 164.8 * k)].map((o) => { o.detune.value = d * 14; return o; }));
      return voiceOf(ctx, dest, t, t + len, nodes, (out) => {
        const bus = gainNode(ctx, 0.25);
        for (const o of nodes) o.connect(bus);
        bus.connect(lp).connect(g).connect(out);
      });
    },
  },
  sweep_up: {
    label: 'Noise Sweep Up', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx);
      const f = filt(ctx, 'lowpass', 200, 9);
      sweep(f.frequency, 200, (9000 + tone * 9000) * Math.min(k, 2), t, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5 * v, t + len * 0.85);
      return voiceOf(ctx, dest, t, t + len, [n], (out) => n.connect(f).connect(g).connect(out));
    },
  },
  sweep_down: {
    label: 'Noise Sweep Down', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx);
      const f = filt(ctx, 'lowpass', 1000, 9);
      sweep(f.frequency, (9000 + tone * 9000) * Math.min(k, 2), 200, t, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * v, t);
      g.gain.linearRampToValueAtTime(0.0001, t + len);
      return voiceOf(ctx, dest, t, t + len, [n], (out) => n.connect(f).connect(g).connect(out));
    },
  },
  whoosh: {
    label: 'Whoosh', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx, 'pink');
      const bp = filt(ctx, 'bandpass', 350, 1.2);
      sweep(bp.frequency, 350 * k, (2600 + tone * 3000) * Math.min(k, 2), t, t + len * 0.5);
      expTo(bp.frequency, 500 * k, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.9 * v, t + len * 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + len);
      return voiceOf(ctx, dest, t, t + len, [n], (out) => n.connect(bp).connect(g).connect(out));
    },
  },
  reverse_crash: {
    label: 'Reverse Crash', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx);
      const hp = filt(ctx, 'highpass', (3500 + tone * 3000) * Math.min(k, 2), 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.75 * v, t + len * 0.97); // swells, then stops dead on the downbeat
      return voiceOf(ctx, dest, t, t + len, [n], (out) => n.connect(hp).connect(g).connect(out));
    },
  },
  siren: {
    label: 'Siren', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const o = osc(ctx, 'sawtooth', 800 * k);
      const lfo = osc(ctx, 'sine', 1.1);
      const depth = gainNode(ctx, 280 * k);
      lfo.connect(depth).connect(o.frequency);
      const lp = filt(ctx, 'lowpass', 1800 + tone * 3500);
      const g = gainNode(ctx, 0.25 * v);
      return voiceOf(ctx, dest, t, t + len, [o, lfo], (out) => o.connect(lp).connect(g).connect(out));
    },
  },
  tape_stop: {
    label: 'Tape Stop', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const o1 = osc(ctx, 'sawtooth', 330 * k);
      const o2 = osc(ctx, 'square', 165.4 * k);
      for (const o of [o1, o2]) sweep(o.frequency, o.frequency.value, 14, t, t + len);
      const lp = filt(ctx, 'lowpass', 1000, 0.9);
      sweep(lp.frequency, 3000 + tone * 4000, 120, t, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3 * v, t);
      g.gain.setValueAtTime(0.3 * v, t + len * 0.5);
      expTo(g.gain, 0.002, t + len);
      return voiceOf(ctx, dest, t, t + len, [o1, o2], (out) => { o1.connect(lp); o2.connect(lp); lp.connect(g).connect(out); });
    },
  },
  wind: {
    label: 'Wind', sustained: true, texture: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx, 'pink');
      const bp = filt(ctx, 'bandpass', 700 * k, 0.9);
      const lfo = osc(ctx, 'sine', 0.27);
      const sweep = gainNode(ctx, 380 * k);
      lfo.connect(sweep).connect(bp.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.7 * v, t + Math.min(len * 0.3, 1.5));
      return voiceOf(ctx, dest, t, t + len, [n, lfo], (out) => n.connect(bp).connect(filt(ctx, 'lowpass', 2500 + tone * 5000)).connect(g).connect(out));
    },
  },
  ocean: {
    label: 'Ocean Waves', sustained: true, texture: true,
    play(ctx, dest, t, len, v, k, tone) {
      const n = noise(ctx, 'brown');
      const lp = filt(ctx, 'lowpass', 900 + tone * 1500, 0.6);
      const swell = osc(ctx, 'sine', 0.11);
      const swellDepth = gainNode(ctx, 0.4 * v);
      const g = gainNode(ctx, 0.55 * v);
      swell.connect(swellDepth).connect(g.gain);
      return voiceOf(ctx, dest, t, t + len, [n, swell], (out) => n.connect(lp).connect(g).connect(out));
    },
  },
  vinyl: {
    label: 'Vinyl Crackle', sustained: true, texture: true,
    play(ctx, dest, t, len, v, k, tone) {
      const sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, sr * 3, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * 0.012; // surface hiss
        if (Math.random() < 28 / sr) d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.85) * 0.5; // pops
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const hp = filt(ctx, 'highpass', 700, 0.7);
      const lp = filt(ctx, 'lowpass', 5000 + tone * 9000, 0.7);
      const g = gainNode(ctx, 1.4 * v);
      return voiceOf(ctx, dest, t, t + len, [src], (out) => src.connect(hp).connect(lp).connect(g).connect(out));
    },
  },
  sparkle: {
    label: 'Sparkle', sustained: true,
    play(ctx, dest, t, len, v, k, tone) {
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const count = Math.max(6, Math.round(len * 9));
      const nodes = [];
      const g = gainNode(ctx, 1);
      for (let i = 0; i < count; i++) {
        const at = t + (i / count) * len * 0.95 + Math.random() * 0.03;
        const semi = scale[Math.floor(Math.random() * scale.length)];
        const f = 1318 * k * Math.pow(2, semi / 12 - 0.5) * (0.8 + tone * 0.4);
        const o = osc(ctx, 'sine', clamp(f, 200, 15000));
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, at);
        og.gain.linearRampToValueAtTime((0.1 + Math.random() * 0.12) * v, at + 0.003);
        expTo(og.gain, 0.0001, at + 0.35 + Math.random() * 0.35);
        o.connect(og).connect(g);
        o.start(at); o.stop(at + 0.8);
        nodes.push(o);
      }
      const out = ctx.createGain();
      g.connect(out).connect(dest);
      return { nodes, out, end: t + len + 0.9, release() {} };
    },
  },

  impact: {
    label: 'Impact', sustained: false,
    play(ctx, dest, t, len, v, k, tone) {
      const end = t + 1.8;
      const sub = osc(ctx, 'sine', 90 * k);
      sweep(sub.frequency, 90 * k, 32 * k, t, t + 0.7);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(0.95 * v, t + 0.004);
      expTo(sg.gain, 0.0001, t + 1.5);
      const n = noise(ctx);
      const lp = filt(ctx, 'lowpass', 1000, 0.8);
      sweep(lp.frequency, 7000 + tone * 8000, 160, t, t + 1.2);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.7 * v, t + 0.002);
      expTo(ng.gain, 0.0001, t + 1.3);
      const sat = ctx.createWaveShaper();
      sat.curve = saturationCurve(2);
      return voiceOf(ctx, dest, t, end, [sub, n], (out) => {
        sub.connect(sg).connect(sat).connect(out);
        n.connect(lp).connect(ng).connect(out);
      });
    },
  },
  boom: {
    label: 'Boom', sustained: false,
    play(ctx, dest, t, len, v, k, tone) {
      const end = t + 3.2;
      const sub = osc(ctx, 'sine', 62 * k);
      sweep(sub.frequency, 62 * k, 26 * k, t, t + 1.6);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(1 * v, t + 0.01);
      expTo(sg.gain, 0.0001, t + 3);
      const n = noise(ctx, 'brown');
      const lp = filt(ctx, 'lowpass', 1000, 0.7);
      sweep(lp.frequency, 500 + tone * 1500, 70, t, t + 2.5);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.9 * v, t + 0.01);
      expTo(ng.gain, 0.0001, t + 3);
      return voiceOf(ctx, dest, t, end, [sub, n], (out) => { sub.connect(sg).connect(out); n.connect(lp).connect(ng).connect(out); });
    },
  },
  bass_drop: {
    label: 'Bass Drop', sustained: false,
    play(ctx, dest, t, len, v, k, tone) {
      const end = t + 1.6;
      const o = osc(ctx, 'sine', 150 * k);
      o.frequency.setValueAtTime(150 * k, t);
      o.frequency.setTargetAtTime(34 * k, t + 0.04, 0.22);
      const sat = ctx.createWaveShaper();
      sat.curve = saturationCurve(1.5 + tone * 3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.9 * v, t + 0.005);
      expTo(g.gain, 0.0001, t + 1.5);
      return voiceOf(ctx, dest, t, end, [o], (out) => o.connect(sat).connect(g).connect(out));
    },
  },
  laser: {
    label: 'Laser', sustained: false,
    play(ctx, dest, t, len, v, k, tone) {
      const o = osc(ctx, 'sawtooth', 3600 * k);
      sweep(o.frequency, 3600 * k, 160 * k, t, t + 0.28);
      const lp = filt(ctx, 'lowpass', 2500 + tone * 6000, 3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.4 * v, t + 0.003);
      expTo(g.gain, 0.0001, t + 0.32);
      return voiceOf(ctx, dest, t, t + 0.36, [o], (out) => o.connect(lp).connect(g).connect(out));
    },
  },
  zap: {
    label: 'Zap', sustained: false,
    play(ctx, dest, t, len, v, k, tone) {
      const o = osc(ctx, 'square', 1400 * k);
      sweep(o.frequency, 1400 * k, 70 * k, t, t + 0.2);
      const mod = osc(ctx, 'sine', 95);
      const md = gainNode(ctx, 700 * k);
      mod.connect(md).connect(o.frequency);
      const lp = filt(ctx, 'lowpass', 3000 + tone * 6000, 2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.35 * v, t + 0.002);
      expTo(g.gain, 0.0001, t + 0.22);
      return voiceOf(ctx, dest, t, t + 0.25, [o, mod], (out) => o.connect(lp).connect(g).connect(out));
    },
  },
  droplet: {
    label: 'Water Droplet', sustained: false,
    play(ctx, dest, t, len, v, k, tone) {
      const o = osc(ctx, 'sine', 520 * k);
      sweep(o.frequency, 520 * k, (1500 + tone * 600) * k, t, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.6 * v, t + 0.004);
      expTo(g.gain, 0.0001, t + 0.18);
      return voiceOf(ctx, dest, t, t + 0.2, [o], (out) => o.connect(g).connect(out));
    },
  },
};

export const SFX_SOUNDS = Object.keys(SFX);

/** Start an effect. `len` only matters for sustained sounds. */
export function playSfx(ctx, dest, t, dur, vel, semis, p) {
  const def = SFX[p.sound] ?? SFX.riser;
  const len = def.sustained ? clamp(p.follow && Number.isFinite(dur) ? dur : p.length, 0.15, 30) : 0;
  const k = Math.pow(2, (semis + (p.pitch || 0)) / 12);
  return def.play(ctx, dest, t, len, 0.3 + vel * 0.7, k, p.tone);
}
