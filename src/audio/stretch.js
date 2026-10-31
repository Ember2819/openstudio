// Time-stretching without changing pitch: WSOLA (waveform-similarity overlap-add). Frames of the input are taken at
// the analysis rate and overlap-added at a fixed synthesis rate; each frame is nudged (within a small tolerance) to
// where it best continues the previous one, which keeps transients and pitch intact for drums and most loops.

const WIN = 2048; // ~46 ms at 44.1 kHz
const HOP = WIN / 2; // synthesis hop (50 % overlap: Hann windows sum to one)
const TOL = 512; // how far a frame may move to line up

const hann = new Float32Array(WIN);
for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);

/**
 * Stretch `channels` (Float32Arrays of equal length) so they play `speed` times faster (speed > 1 shortens).
 * Returns new Float32Arrays of length round(n / speed).
 */
export function wsola(channels, speed) {
  const n = channels[0].length;
  const outLen = Math.max(1, Math.round(n / speed));
  if (Math.abs(speed - 1) < 1e-4) return channels.map((c) => c.slice(0, outLen));
  // the similarity search runs on a mono mix, every 4th sample
  const mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i];
  const out = channels.map(() => new Float32Array(outLen + WIN));
  const norm = new Float32Array(outLen + WIN);
  const ha = HOP * speed; // analysis hop
  let prev = 0; // where the previous frame was taken from
  for (let k = 0; k * HOP < outLen; k++) {
    const nominal = Math.round(k * ha);
    let pos = nominal;
    if (k > 0) {
      // the natural continuation of the previous frame starts HOP samples after it
      const target = prev + HOP;
      let best = -Infinity;
      for (let d = -TOL; d <= TOL; d += 2) {
        const cand = nominal + d;
        if (cand < 0 || cand + WIN > n) continue;
        let s = 0;
        for (let i = 0; i < WIN / 2; i += 4) {
          const a = target + i < n ? mono[target + i] : 0;
          s += a * mono[cand + i];
        }
        if (s > best) { best = s; pos = cand; }
      }
    }
    pos = Math.max(0, Math.min(pos, n - 1));
    const at = k * HOP;
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < WIN && pos + i < n; i++) dst[at + i] += src[pos + i] * hann[i];
    }
    for (let i = 0; i < WIN; i++) norm[at + i] += hann[i];
    prev = pos;
  }
  // even out the window sum at the edges (the first and last half-window)
  return out.map((o) => {
    const r = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 0.1 ? o[i] / norm[i] : o[i];
    return r;
  });
}

/** The tempo a loop was most likely made at: `seconds` long, a whole number of bars, closest to `near` BPM. */
export function guessLoopBpm(seconds, beatsPerBar = 4, near = 120) {
  let best = near;
  let bestErr = Infinity;
  for (const bars of [1, 2, 4, 8, 16, 0.5]) {
    const bpm = (bars * beatsPerBar * 60) / seconds;
    if (bpm < 50 || bpm > 220) continue;
    const err = Math.abs(Math.log(bpm / near));
    if (err < bestErr) { bestErr = err; best = bpm; }
  }
  return Math.round(best * 100) / 100;
}
