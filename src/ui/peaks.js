const cache = new WeakMap();
const BIN = 256;

/** Coarse min/max envelope of an AudioBuffer (all channels folded), computed once. */
export function getPeaks(buffer) {
  let p = cache.get(buffer);
  if (p) return p;
  const n = Math.ceil(buffer.length / BIN);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let b = 0; b < n; b++) {
      let lo = c === 0 ? 1 : min[b];
      let hi = c === 0 ? -1 : max[b];
      const end = Math.min(d.length, (b + 1) * BIN);
      for (let i = b * BIN; i < end; i++) {
        const v = d[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
  }
  p = { min, max, bins: n, binSeconds: BIN / buffer.sampleRate };
  cache.set(buffer, p);
  return p;
}

/**
 * Draw the waveform of `buffer` between t0..t1 (seconds) into the rectangle x,y,w,h.
 * Only draws the horizontal range clipX0..clipX1 (device-independent px) for speed.
 */
export function drawWaveform(ctx, buffer, x, y, w, h, t0, t1, clipX0, clipX1) {
  const p = getPeaks(buffer);
  const secPerPx = (t1 - t0) / w;
  const mid = y + h / 2;
  const amp = h / 2 - 1;
  const from = Math.max(0, Math.floor(clipX0 - x));
  const to = Math.min(Math.ceil(w), Math.ceil(clipX1 - x));
  for (let px = from; px < to; px++) {
    const s0 = t0 + px * secPerPx;
    const s1 = s0 + secPerPx;
    if (s0 >= buffer.duration) break;
    let b0 = Math.floor(s0 / p.binSeconds);
    let b1 = Math.max(b0, Math.floor(s1 / p.binSeconds));
    b1 = Math.min(b1, p.bins - 1);
    let lo = 1, hi = -1;
    for (let b = b0; b <= b1; b++) { if (p.min[b] < lo) lo = p.min[b]; if (p.max[b] > hi) hi = p.max[b]; }
    if (hi < lo) continue;
    const top = mid - hi * amp;
    const hh = Math.max(1, (hi - lo) * amp);
    ctx.fillRect(x + px, top, 1, hh);
  }
}
