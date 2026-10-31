// FLAC encoder (lossless, 16-bit): fixed linear predictors (orders 0-4) and partitioned Rice coding, the same tools
// the reference encoder uses at its fast settings. Typical music comes out at 50-65 % of the WAV size.
// Spec: https://xiph.org/flac/format.html

const BLOCK = 4096;

class BitWriter {
  constructor(size = 1 << 16) {
    this.buf = new Uint8Array(size);
    this.pos = 0; // bytes written
    this.acc = 0; // pending bits (up to 31)
    this.n = 0;
  }

  _grow(extra) {
    if (this.pos + extra < this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra + 1024));
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  /** Write the low `bits` bits of `value` (bits <= 24). */
  write(value, bits) {
    if (!bits) return;
    this._grow(4);
    this.acc = (this.acc << bits) | (value & ((1 << bits) - 1));
    this.n += bits;
    while (this.n >= 8) {
      this.n -= 8;
      this.buf[this.pos++] = (this.acc >>> this.n) & 0xff;
    }
    this.acc &= (1 << this.n) - 1;
  }

  writeLong(value, bits) { // up to 48 bits
    if (bits > 24) { this.write(Math.floor(value / 2 ** 24), bits - 24); this.write(value % 2 ** 24, 24); } else this.write(value, bits);
  }

  /** `count` zero bits then a one (Rice quotient). */
  unary(count) {
    while (count >= 24) { this.write(0, 24); count -= 24; }
    this.write(1, count + 1);
  }

  align() { if (this.n) this.write(0, 8 - this.n); }

  bytes() { return this.buf.subarray(0, this.pos); }
}

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  CRC8[i] = c;
  let d = i << 8;
  for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
  CRC16[i] = d;
}
const crc8 = (b, from, to) => { let c = 0; for (let i = from; i < to; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b, from, to) => { let c = 0; for (let i = from; i < to; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

/** Residuals of the fixed predictor of `order` (the first `order` samples are warm-up, not included). */
function residual(x, order, out) {
  const n = x.length;
  for (let i = order; i < n; i++) {
    let r;
    switch (order) {
      case 0: r = x[i]; break;
      case 1: r = x[i] - x[i - 1]; break;
      case 2: r = x[i] - 2 * x[i - 1] + x[i - 2]; break;
      case 3: r = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
      default: r = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
    out[i - order] = r;
  }
  return n - order;
}

const zig = (r) => (r >= 0 ? r * 2 : -r * 2 - 1);

/** Best Rice parameter for a run of residuals and its cost in bits. */
function riceParam(res, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += zig(res[i]);
  const n = to - from;
  if (!n) return { k: 0, bits: 0 };
  // the optimum is near log2(mean); check that and its neighbours exactly
  const guess = Math.max(0, Math.min(14, Math.floor(Math.log2(Math.max(1, sum / n)))));
  let best = null;
  for (let k = Math.max(0, guess - 1); k <= Math.min(14, guess + 1); k++) {
    let bits = n * (k + 1);
    for (let i = from; i < to; i++) bits += zig(res[i]) >>> k;
    if (!best || bits < best.bits) best = { k, bits };
  }
  return best;
}

/** Choose the partition order (0-6) that codes the residual in the fewest bits. */
function planResidual(res, order, blockSize) {
  let best = null;
  for (let p = 0; p <= 6; p++) {
    const parts = 1 << p;
    if (blockSize % parts || blockSize / parts <= order) break;
    const per = blockSize / parts;
    const ks = [];
    let bits = 0;
    let at = 0;
    for (let q = 0; q < parts; q++) {
      const len = q === 0 ? per - order : per;
      const r = riceParam(res, at, at + len);
      ks.push(r.k);
      bits += 4 + r.bits;
      at += len;
    }
    if (!best || bits < best.bits) best = { p, ks, bits };
  }
  return best;
}

function writeSubframe(w, x, scratch) {
  // constant blocks (silence) cost a few bytes
  let constant = true;
  for (let i = 1; i < x.length; i++) if (x[i] !== x[0]) { constant = false; break; }
  if (constant) {
    w.write(0, 1); w.write(0b000000, 6); w.write(0, 1);
    w.write(x[0] & 0xffff, 16);
    return;
  }
  let best = null;
  for (let order = 0; order <= Math.min(4, x.length - 1); order++) {
    residual(x, order, scratch[order]);
    const plan = planResidual(scratch[order], order, x.length);
    const bits = plan.bits + order * 16;
    if (!best || bits < best.bits) best = { order, plan, bits };
  }
  const { order, plan } = best;
  const res = scratch[order];
  w.write(0, 1);
  w.write(0b001000 | order, 6);
  w.write(0, 1); // no wasted bits
  for (let i = 0; i < order; i++) w.write(x[i] & 0xffff, 16);
  w.write(0b00, 2); // Rice, 4-bit parameters
  w.write(plan.p, 4);
  const parts = 1 << plan.p;
  const per = x.length / parts;
  let at = 0;
  for (let q = 0; q < parts; q++) {
    const len = q === 0 ? per - order : per;
    const k = plan.ks[q];
    w.write(k, 4);
    for (let i = at; i < at + len; i++) {
      const u = zig(res[i]);
      w.unary(u >>> k);
      if (k) w.write(u & ((1 << k) - 1), k);
    }
    at += len;
  }
}

/** UTF-8-style coding of the frame number. */
function writeUtf8(w, v) {
  if (v < 0x80) { w.write(v, 8); return; }
  const tail = [];
  let n = 1; // continuation bytes
  for (;;) {
    tail.unshift(0x80 | (v & 0x3f));
    v = Math.floor(v / 64);
    if (v <= 0x3f >> n) break;
    n++;
  }
  w.write(((0xff << (7 - n)) & 0xff) | v, 8);
  for (const b of tail) w.write(b, 8);
}

/**
 * Encode an AudioBuffer (mono or stereo) as 16-bit FLAC. `onProgress(fraction)` is called every few hundred
 * blocks; the encoder yields to the event loop then, so long songs don't freeze the window. Resolves to an ArrayBuffer.
 */
export async function encodeFlac(buffer, { onProgress } = {}) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const rate = buffer.sampleRate;
  const pcm = Array.from({ length: channels }, (_, c) => {
    const d = buffer.getChannelData(c);
    const out = new Int32Array(frames);
    for (let i = 0; i < frames; i++) {
      const s = Math.max(-1, Math.min(1, d[i]));
      out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
    return out;
  });

  const w = new BitWriter(Math.max(1 << 16, frames * channels));
  // "fLaC" + STREAMINFO (last metadata block)
  for (const ch of 'fLaC') w.write(ch.charCodeAt(0), 8);
  w.write(1, 1); w.write(0, 7); w.write(34, 24);
  w.write(BLOCK, 16); w.write(BLOCK, 16);
  w.write(0, 24); w.write(0, 24); // min / max frame size unknown
  w.write(rate >> 4, 16); w.write(rate & 0xf, 4);
  w.write(channels - 1, 3);
  w.write(15, 5); // 16 bits per sample
  w.writeLong(frames, 36);
  for (let i = 0; i < 16; i++) w.write(0, 8); // MD5 not computed

  const scratch = Array.from({ length: 5 }, () => new Int32Array(BLOCK));
  let frameNo = 0;
  for (let start = 0; start < frames; start += BLOCK) {
    const n = Math.min(BLOCK, frames - start);
    const headerAt = w.pos;
    w.write(0b11111111111110, 14); w.write(0, 1); w.write(0, 1); // sync, reserved, fixed blocksize
    w.write(n === BLOCK ? 0b1100 : 0b0111, 4); // 4096, or "16-bit size at the end of the header"
    w.write(0b0000, 4); // sample rate from STREAMINFO
    w.write(channels - 1, 4); // independent channels
    w.write(0b100, 3); w.write(0, 1); // 16 bits, reserved
    writeUtf8(w, frameNo);
    if (n !== BLOCK) w.write(n - 1, 16);
    w.write(crc8(w.buf, headerAt, w.pos), 8);
    for (let c = 0; c < channels; c++) writeSubframe(w, pcm[c].subarray(start, start + n), scratch);
    w.align();
    w.write(crc16(w.buf, headerAt, w.pos), 16);
    frameNo++;
    if (frameNo % 200 === 0) {
      onProgress?.(start / frames);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(1);
  const out = w.bytes();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
