// Audio analysis for agents, which cannot listen: loudness, clipping, a loudness timeline and spectral balance.
// Pure functions over Float32Arrays so they can be unit-tested without an audio context.

const toDb = (x) => (x <= 1e-9 ? -120 : Math.round(20 * Math.log10(x) * 10) / 10);

export const BANDS = [
  ['sub', 20, 60], ['bass', 60, 250], ['lowMid', 250, 500], ['mid', 500, 2000], ['highMid', 2000, 6000], ['high', 6000, 20000],
];

/** In-place iterative radix-2 FFT. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Share of spectral energy per band (0-1) and the spectral centroid, from up to `maxFrames` Hann-windowed frames. */
export function spectrum(mono, sampleRate, { size = 4096, maxFrames = 160 } = {}) {
  const frames = Math.floor((mono.length - size) / (size / 2)) + 1;
  const energy = new Float64Array(size / 2);
  if (frames < 1) return null;
  const step = Math.max(1, Math.floor(frames / maxFrames));
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  const re = new Float64Array(size), im = new Float64Array(size);
  let used = 0;
  for (let f = 0; f < frames; f += step) {
    const off = (f * size) / 2;
    for (let i = 0; i < size; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) energy[k] += re[k] * re[k] + im[k] * im[k];
    used++;
  }
  const hz = sampleRate / size;
  const bands = BANDS.map(([name, lo, hi]) => {
    let e = 0;
    for (let k = Math.max(1, Math.floor(lo / hz)); k < Math.min(size / 2, Math.ceil(hi / hz)); k++) e += energy[k];
    return [name, e];
  });
  const total = bands.reduce((s, [, e]) => s + e, 0);
  let weighted = 0;
  for (let k = 1; k < size / 2; k++) weighted += k * hz * energy[k];
  const all = energy.reduce((s, e, k) => (k ? s + e : s), 0);
  return {
    framesAnalysed: used,
    energyShare: Object.fromEntries(bands.map(([name, e]) => [name, total > 0 ? Math.round((e / total) * 1000) / 1000 : 0])),
    centroidHz: all > 0 ? Math.round(weighted / all) : 0,
  };
}

/**
 * Analyse a stereo render. `windowSeconds` sets the timeline resolution (e.g. one bar); long renders are
 * merged into at most `maxWindows` entries.
 */
export function analyze(left, right, sampleRate, { windowSeconds = 1, maxWindows = 64, from = 0, to = left.length / sampleRate } = {}) {
  const a = Math.max(0, Math.floor(from * sampleRate));
  const b = Math.min(left.length, Math.ceil(to * sampleRate));
  const L = left.subarray(a, b), R = right.subarray(a, b);
  const n = L.length;
  if (n === 0) return { seconds: 0, silent: true, warnings: ['Nothing to analyse'] };

  let peak = 0, sumSq = 0, clipped = 0, sumL = 0, sumR = 0, cross = 0, sqL = 0, sqR = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    const m = Math.max(Math.abs(l), Math.abs(r));
    if (m > peak) peak = m;
    if (m >= 0.999) clipped++;
    sumSq += (l * l + r * r) / 2;
    sumL += l; sumR += r;
    cross += l * r; sqL += l * l; sqR += r * r;
  }
  const rms = Math.sqrt(sumSq / n);
  const corr = sqL > 0 && sqR > 0 ? cross / Math.sqrt(sqL * sqR) : null;

  const perWindow = Math.max(1, Math.ceil(windowSeconds * sampleRate));
  const count = Math.ceil(n / perWindow);
  const merge = Math.max(1, Math.ceil(count / maxWindows));
  const size = perWindow * merge;
  const timeline = [];
  for (let s = 0; s < n; s += size) {
    const e = Math.min(n, s + size);
    let wp = 0, ws = 0;
    for (let i = s; i < e; i++) {
      const l = L[i], r = R[i];
      wp = Math.max(wp, Math.abs(l), Math.abs(r));
      ws += (l * l + r * r) / 2;
    }
    timeline.push({ from: Math.round((from + s / sampleRate) * 100) / 100, to: Math.round((from + e / sampleRate) * 100) / 100, rmsDb: toDb(Math.sqrt(ws / (e - s))), peakDb: toDb(wp) });
  }

  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) / 2;

  const silent = peak < 1e-4;
  const warnings = [];
  if (silent) warnings.push('The render is silent — check that channels have notes, are not muted, and (in song mode) that the playlist has clips.');
  if (clipped > 0) warnings.push(`${clipped} samples reach full scale: the master will distort — lower channel or mixer levels.`);
  if (!silent && toDb(rms) > -9) warnings.push('Very loud overall (RMS above -9 dBFS); little headroom for mastering.');
  if (!silent && toDb(rms) < -36) warnings.push('Very quiet overall (RMS below -36 dBFS).');
  if (corr !== null && corr < 0) warnings.push('Left and right are anti-correlated: the mix will partly cancel in mono.');
  if (Math.abs(sumL / n) > 0.01 || Math.abs(sumR / n) > 0.01) warnings.push('DC offset detected.');

  return {
    seconds: Math.round((n / sampleRate) * 1000) / 1000,
    silent,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    crestDb: silent ? null : Math.round((toDb(peak) - toDb(rms)) * 10) / 10,
    clippedSamples: clipped,
    stereoCorrelation: corr === null ? null : Math.round(corr * 1000) / 1000,
    timeline,
    spectrum: silent ? null : spectrum(mono, sampleRate),
    warnings,
  };
}
