// Sample slicing (FL's Slicex / Fruity Slicer): find where the hits in a loop start, and turn slices into notes.
// Slices are kept as fractions of the sample (0..1) so they survive resampling and don't depend on the sample rate.

/**
 * Onsets (fractions 0..1) in mono sample data: a frame-energy envelope, its positive change (an energy "flux"), and
 * peaks of that flux above an adaptive threshold. `sensitivity` 0..1 (higher finds more), `minGap` seconds between
 * slices. Always starts with 0.
 */
export function detectOnsets(data, sampleRate, { sensitivity = 0.5, minGap = 0.06, max = 64 } = {}) {
  const hop = 128;
  const win = 512;
  const frames = Math.max(0, Math.floor((data.length - win) / hop) + 1);
  if (!frames) return [0];
  // two detection functions: full-band energy (kicks, bass) and the energy of the first difference, which favours
  // highs (hats, snares) so a hat on top of a ringing kick still shows up
  const full = new Float32Array(frames);
  const high = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    let d = 0;
    const o = f * hop;
    for (let i = 0; i < win; i++) {
      const x = data[o + i];
      const dx = x - (o + i > 0 ? data[o + i - 1] : 0);
      e += x * x;
      d += dx * dx;
    }
    full[f] = 10 * Math.log10(1e-12 + e / win);
    high[f] = 10 * Math.log10(1e-12 + d / win);
  }
  let loudest = -Infinity;
  let loudestHigh = -Infinity;
  for (let f = 0; f < frames; f++) { loudest = Math.max(loudest, full[f]); loudestHigh = Math.max(loudestHigh, high[f]); }
  // how much louder (dB) than a moment ago counts as a hit: 9 dB at sensitivity 0 down to 2 dB at 1
  const sens = Math.min(1, Math.max(0, sensitivity));
  const jump = 9 - 7 * sens;
  const back = Math.max(1, Math.round((0.012 * sampleRate) / hop)); // compare with ~12 ms earlier
  const strength = new Float32Array(frames);
  for (let f = back; f < frames; f++) {
    const a = full[f] < loudest - 45 ? 0 : full[f] - Math.max(full[f - back], loudest - 60);
    const b = high[f] < loudestHigh - 45 ? 0 : high[f] - Math.max(high[f - back], loudestHigh - 60);
    strength[f] = Math.max(a, b);
  }
  const gap = Math.max(1, Math.round((minGap * sampleRate) / hop));
  const out = [0];
  let last = -gap;
  for (let f = 1; f < frames - 1; f++) {
    if (strength[f] < jump || strength[f] < strength[f - 1] || strength[f] < strength[f + 1] || f - last < gap) continue;
    const frac = refine(data, Math.max(0, (f - back) * hop), Math.min(data.length, f * hop + win)) / data.length;
    if (frac - out[out.length - 1] >= (minGap * sampleRate) / data.length) out.push(frac);
    last = f;
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Where exactly a hit starts inside [from, to): the first 32-sample block whose high-passed energy (first difference)
 * is 4× the most it reached in the blocks just before `from`. The first difference ignores the slow swing of a
 * ringing kick, which would otherwise make short blocks look like onsets.
 */
function refine(data, from, to) {
  const B = 32;
  const energy = (i) => {
    let e = 0;
    for (let k = Math.max(1, i); k < i + B && k < data.length; k++) { const x = data[k] - data[k - 1]; e += x * x; }
    return e / B;
  };
  let before = 1e-12;
  for (let k = 1; k <= 4; k++) before = Math.max(before, energy(Math.max(0, from - k * B)));
  for (let i = from; i < to; i += B) if (energy(i) > before * 4) return i;
  return from;
}

/** `n` equal slices. */
export const equalSlices = (n) => Array.from({ length: Math.max(1, n) }, (_, i) => i / Math.max(1, n));

/** Slice `i` as { start, end } fractions (the last one runs to the end of the sample). */
export function sliceBounds(slices, i) {
  return { start: slices[i], end: i + 1 < slices.length ? slices[i + 1] : 1 };
}

/**
 * Notes that play the slices back in order, timed for the song tempo: slice i at its position in the loop, one key
 * per slice from `root` up. `loopSteps` is how many steps the whole sample should span (its length in bars × steps
 * per bar); `velocity` 0..1.
 */
export function slicesToNotes(slices, loopSteps, root = 60, velocity = 0.8) {
  const round = (x) => Math.round(x * 1000) / 1000;
  return slices.map((s, i) => {
    const { start, end } = sliceBounds(slices, i);
    return { p: root + i, s: round(start * loopSteps), l: round(Math.max(0.0625, (end - start) * loopSteps)), v: velocity };
  });
}

/** How many bars a loop most likely spans at a tempo (1, 2, 4, 8 …, the closest power of two). */
export function guessBars(seconds, bpm, beatsPerBar = 4) {
  const bars = (seconds * bpm) / 60 / beatsPerBar;
  if (bars <= 0) return 1;
  return Math.max(1, 2 ** Math.round(Math.log2(bars)));
}
