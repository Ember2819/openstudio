// Offline measurement of single channels ("stems") for agents: render a stretch of the song once per channel and
// report how loud, how bright and how much of the mix it is. Shared by render_audio (stems) and auto_mix.
import { renderSteps } from '../audio/render.js';
import { flattenSong } from './music/critique.js';
import { spectrum, BANDS } from './analysis.js';

export const toDb = (x) => (x <= 1e-9 ? -120 : 20 * Math.log10(x));

export function levelsOf(buf) {
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  let sq = 0, peak = 0;
  for (let i = 0; i < L.length; i++) { sq += (L[i] * L[i] + R[i] * R[i]) / 2; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  return { rmsDb: toDb(Math.sqrt(sq / L.length)), peakDb: toDb(peak), rms: Math.sqrt(sq / L.length) };
}

/** The window (in steps) with the most going on: `bars` bars of the song, or all of it when it is shorter. */
export function busiestWindow(store, bars = 4) {
  const { notes, steps } = flattenSong(store);
  const total = Math.max(1, Math.ceil(steps / 16));
  if (total <= bars) return { from: 0, to: Math.max(16, steps) };
  const energy = new Array(total).fill(0);
  for (const list of notes.values()) for (const n of list) energy[Math.min(total - 1, Math.floor(n.s / 16))] += n.v;
  let best = 0, bestSum = -1;
  for (let b = 0; b + bars <= total; b++) {
    const sum = energy.slice(b, b + bars).reduce((x, y) => x + y, 0);
    if (sum > bestSum) { bestSum = sum; best = b; }
  }
  return { from: best * 16, to: (best + bars) * 16 };
}

/**
 * Render steps [from, to) with only `only` audible (or everything) and return its levels, optionally with the
 * spectral balance. The project's solo flags are restored afterwards.
 */
export async function measure(app, { from, to, only = null, sampleRate = 22050, withSpectrum = false, unlimited = false }) {
  const proj = app.store.project;
  const keep = proj.channels.map((c) => c.solo);
  try {
    if (only) proj.channels.forEach((c) => { c.solo = c.id === only.id; });
    const buf = await renderSteps(app.store, to, { from, tail: 1, sampleRate, configure: unlimited ? (engine) => engine.bypassLimiter() : undefined });
    const out = levelsOf(buf);
    if (withSpectrum && out.peakDb > -80) {
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      const mono = new Float32Array(L.length);
      for (let i = 0; i < mono.length; i++) mono[i] = (L[i] + R[i]) / 2;
      const sp = spectrum(mono, sampleRate, { maxFrames: 60 });
      if (sp) {
        const [band] = Object.entries(sp.energyShare).sort((x, y) => y[1] - x[1])[0];
        out.centroidHz = sp.centroidHz;
        out.dominantBand = band;
      }
    }
    return out;
  } finally {
    proj.channels.forEach((c, i) => { c.solo = keep[i]; });
  }
}

export { BANDS };
