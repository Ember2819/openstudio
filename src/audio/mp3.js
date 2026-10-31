// MP3 encoder (MPEG-1 Layer III, CBR, 32 / 44.1 / 48 kHz, mono or stereo). No dependencies: the polyphase
// filterbank, MDCT and alias reduction of the standard, global-gain rate control per granule, and Huffman coding with
// the standard tables (src/audio/mp3tables.js). It has no psychoacoustic model — the quantization noise is spread
// evenly — so it is meant for the higher bitrates (192-320 kbps), where that is inaudible.
// Spec: ISO/IEC 11172-3; the tables come from PDMP3 (public domain).
import { HUFFMAN, SYNTH_WINDOW } from './mp3tables.js';

export const MP3_BITRATES = [128, 160, 192, 224, 256, 320];
const BITRATE_INDEX = { 32: 1, 40: 2, 48: 3, 56: 4, 64: 5, 80: 6, 96: 7, 112: 8, 128: 9, 160: 10, 192: 11, 224: 12, 256: 13, 320: 14 };
const RATE_INDEX = { 44100: 0, 48000: 1, 32000: 2 };
const SFB_LONG = {
  44100: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576],
  48000: [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576],
  32000: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576],
};
const GRANULE = 576;
// overall level: the analysis filterbank and MDCT as written here, against a standard decoder (measured)
const SCALE = 1 / 9;

// ------------------------------------------------------------------ tables
const ANALYSIS = Float64Array.from(SYNTH_WINDOW, (d) => d / 32);
const MATRIX = new Float64Array(32 * 64); // M[i][k] = cos((2i + 1)(k - 16) pi / 64)
for (let i = 0; i < 32; i++) for (let k = 0; k < 64; k++) MATRIX[i * 64 + k] = Math.cos(((2 * i + 1) * (k - 16) * Math.PI) / 64);
const MDCT = new Float64Array(18 * 36); // windowed (block type 0) forward MDCT
for (let k = 0; k < 18; k++) for (let n = 0; n < 36; n++) MDCT[k * 36 + n] = Math.sin((Math.PI / 36) * (n + 0.5)) * Math.cos((Math.PI / 72) * (2 * n + 19) * (2 * k + 1)) * SCALE;
const ALIAS = [-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037];
const CS = ALIAS.map((c) => 1 / Math.sqrt(1 + c * c));
const CA = ALIAS.map((c) => c / Math.sqrt(1 + c * c));

/** Big-value tables 1-31: codes, size and linbits (4 and 14 don't exist). */
const LINBITS = { 16: 1, 17: 2, 18: 3, 19: 4, 20: 6, 21: 8, 22: 10, 23: 13, 24: 4, 25: 5, 26: 6, 27: 7, 28: 8, 29: 9, 30: 11, 31: 13 };
const TABLES = [];
for (let t = 1; t < 32; t++) {
  if (t === 4 || t === 14) continue;
  const codes = HUFFMAN[t >= 24 ? 24 : t >= 16 ? 16 : t];
  const dim = Math.round(Math.sqrt(codes.length));
  const linbits = LINBITS[t] ?? 0;
  TABLES.push({ t, codes, dim, linbits, cap: linbits ? 15 + (1 << linbits) - 1 : dim - 1, lens: Uint8Array.from(codes, (c) => Math.floor(c / 2 ** 20)) });
}
const SMALL = TABLES.filter((x) => !x.linbits); // for values up to 15
const ESC16 = TABLES.filter((x) => x.t >= 16 && x.t < 24);
const ESC24 = TABLES.filter((x) => x.t >= 24);
const COUNT1_A = HUFFMAN[32];

// ------------------------------------------------------------------ bits
class Bits {
  constructor(size) { this.buf = new Uint8Array(size); this.pos = 0; this.acc = 0; this.n = 0; }
  _grow() { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
  /** Write the low `bits` of `value` (bits <= 24). */
  put(value, bits) {
    if (!bits) return;
    this.acc = (this.acc << bits) | (value & ((1 << bits) - 1));
    this.n += bits;
    while (this.n >= 8) {
      if (this.pos >= this.buf.length) this._grow();
      this.n -= 8;
      this.buf[this.pos++] = (this.acc >>> this.n) & 0xff;
    }
    this.acc &= (1 << this.n) - 1;
  }
  get length() { return this.pos * 8 + this.n; }
}

// ------------------------------------------------------------------ filterbank
class Analysis {
  constructor() { this.x = new Float64Array(512); this.off = 0; this.y = new Float64Array(64); }
  /** 32 new samples -> 32 subband samples. */
  run(input, at, out, outAt, stride) {
    const x = this.x;
    this.off = (this.off - 32) & 511;
    for (let n = 0; n < 32; n++) x[(this.off + 31 - n) & 511] = input[at + n];
    const y = this.y;
    for (let k = 0; k < 64; k++) {
      let s = 0;
      for (let j = 0; j < 8; j++) { const i = k + 64 * j; s += ANALYSIS[i] * x[(this.off + i) & 511]; }
      y[k] = s;
    }
    for (let i = 0; i < 32; i++) {
      let s = 0;
      const row = i * 64;
      for (let k = 0; k < 64; k++) s += MATRIX[row + k] * y[k];
      out[outAt + i * stride] = s;
    }
  }
}

/** One channel's state: filterbank and the previous granule's subband samples (for the MDCT overlap). */
function channelState() {
  return { fb: new Analysis(), prev: new Float64Array(32 * 18), cur: new Float64Array(32 * 18) };
}

/** 576 PCM samples -> 576 MDCT lines (after alias reduction), in xr. */
function transform(st, pcm, at, xr) {
  const { cur, prev } = st;
  // 18 blocks of 32 subband samples; cur[sb * 18 + t]
  for (let t = 0; t < 18; t++) st.fb.run(pcm, at + t * 32, cur, t, 18);
  // frequency inversion: odd time samples of odd subbands
  for (let sb = 1; sb < 32; sb += 2) for (let t = 1; t < 18; t += 2) cur[sb * 18 + t] = -cur[sb * 18 + t];
  for (let sb = 0; sb < 32; sb++) {
    for (let k = 0; k < 18; k++) {
      let s = 0;
      const row = k * 36;
      for (let n = 0; n < 18; n++) s += MDCT[row + n] * prev[sb * 18 + n] + MDCT[row + 18 + n] * cur[sb * 18 + n];
      xr[sb * 18 + k] = s;
    }
  }
  // alias reduction (the inverse of the decoder's butterflies)
  for (let sb = 1; sb < 32; sb++) {
    for (let i = 0; i < 8; i++) {
      const lo = sb * 18 - 1 - i, hi = sb * 18 + i;
      const a = xr[lo], b = xr[hi];
      xr[lo] = a * CS[i] + b * CA[i];
      xr[hi] = b * CS[i] - a * CA[i];
    }
  }
  prev.set(cur);
}

// ------------------------------------------------------------------ quantization and Huffman
/** Bits a region [from, to) of quantized values costs with table `tb` (pairs). */
function regionBits(ix, from, to, tb) {
  let bits = 0;
  const { dim, lens, linbits } = tb;
  for (let i = from; i < to; i += 2) {
    let x = ix[i], y = ix[i + 1];
    if (linbits) {
      if (x > 14) { bits += linbits; x = 15; }
      if (y > 14) { bits += linbits; y = 15; }
    }
    bits += lens[x * dim + y] + (x ? 1 : 0) + (y ? 1 : 0);
  }
  return bits;
}

/** The cheapest table for a region: [table, bits]. Table null = all zeros (table 0). */
function bestTable(ix, from, to) {
  let max = 0;
  for (let i = from; i < to; i++) if (ix[i] > max) max = ix[i];
  if (max === 0) return [null, 0];
  let cands;
  if (max <= 15) cands = [...SMALL.filter((x) => x.cap >= max), ESC16[0], ESC24[0]];
  else cands = [ESC16.find((x) => x.cap >= max), ESC24.find((x) => x.cap >= max)].filter(Boolean);
  let best = null, bestBits = Infinity;
  for (const tb of cands) {
    const b = regionBits(ix, from, to, tb);
    if (b < bestBits) { bestBits = b; best = tb; }
  }
  return [best, bestBits];
}

/** Lay out a granule's quantized values (absolute, in ix) and count its bits. */
function plan(ix, sfb) {
  let i = GRANULE;
  while (i > 1 && ix[i - 1] === 0 && ix[i - 2] === 0) i -= 2;
  const count1End = i;
  while (i > 3 && ix[i - 1] <= 1 && ix[i - 2] <= 1 && ix[i - 3] <= 1 && ix[i - 4] <= 1) i -= 4;
  const bigEnd = i;
  // count1 region: table A or B
  let a = 0, b = 0;
  for (let k = bigEnd; k < count1End; k += 4) {
    const v = (ix[k] << 3) | (ix[k + 1] << 2) | (ix[k + 2] << 1) | ix[k + 3];
    const signs = ix[k] + ix[k + 1] + ix[k + 2] + ix[k + 3];
    a += Math.floor(COUNT1_A[v] / 2 ** 20) + signs;
    b += 4 + signs;
  }
  // three regions of the big values, split at scalefactor band edges near a third and two thirds
  let n = 0;
  while (n < 22 && sfb[n] < bigEnd) n++;
  const b1 = Math.min(16, Math.max(1, Math.round(n / 3)));
  const b2 = Math.min(b1 + 8, Math.max(b1 + 1, Math.round((2 * n) / 3)));
  const r1 = Math.min(bigEnd, sfb[b1]);
  const r2 = Math.min(bigEnd, sfb[Math.min(22, b2)]);
  const regions = [[0, r1], [r1, r2], [r2, bigEnd]].map(([f, t]) => bestTable(ix, f, t));
  return {
    bigValues: bigEnd / 2, count1End, region0: b1 - 1, region1: b2 - b1 - 1,
    tables: regions.map((r) => r[0]), count1B: b < a,
    bits: regions.reduce((s, r) => s + r[1], 0) + Math.min(a, b),
  };
}

const MAX_IX = 8206;
/** Quantize with a global gain into ix (absolute values); false if a value is too big to code. */
function quantize(xr34, gain, ix) {
  const step = Math.pow(2, (-(gain - 210) * 3) / 16);
  for (let i = 0; i < GRANULE; i++) {
    const q = Math.floor(xr34[i] * step + 0.4054);
    if (q > MAX_IX) return false;
    ix[i] = q;
  }
  return true;
}

/** The finest global gain whose granule fits in `budget` bits. */
function encodeGranule(xr, cutoff, budget, sfb) {
  const xr34 = new Float64Array(GRANULE);
  const sign = new Uint8Array(GRANULE);
  for (let i = 0; i < cutoff; i++) { sign[i] = xr[i] < 0 ? 1 : 0; xr34[i] = Math.pow(Math.abs(xr[i]), 0.75); }
  const ix = new Int32Array(GRANULE);
  let lo = 0, hi = 255, best = null;
  while (lo <= hi) {
    const g = (lo + hi) >> 1;
    const fits = quantize(xr34, g, ix) && plan(ix, sfb);
    if (fits && fits.bits <= budget) { best = g; hi = g - 1; } else lo = g + 1;
  }
  const gain = best ?? 255;
  quantize(xr34, gain, ix);
  return { gain, ix, sign, layout: plan(ix, sfb) };
}

function writeGranule(w, g) {
  const { ix, sign, layout } = g;
  const { tables, bigValues, count1End } = layout;
  const big = bigValues * 2;
  let region = 0;
  const edges = g.edges;
  for (let i = 0; i < big; i += 2) {
    while (region < 2 && i >= edges[region]) region++;
    const tb = tables[region];
    if (!tb) continue; // table 0: nothing is written
    let x = ix[i], y = ix[i + 1];
    const xe = tb.linbits && x > 14 ? x - 15 : -1;
    const ye = tb.linbits && y > 14 ? y - 15 : -1;
    if (xe >= 0) x = 15;
    if (ye >= 0) y = 15;
    const code = tb.codes[x * tb.dim + y];
    w.put(code % 2 ** 20, Math.floor(code / 2 ** 20));
    if (xe >= 0) w.put(xe, tb.linbits);
    if (x) w.put(sign[i], 1);
    if (ye >= 0) w.put(ye, tb.linbits);
    if (y) w.put(sign[i + 1], 1);
  }
  for (let i = big; i < count1End; i += 4) {
    const v = (ix[i] << 3) | (ix[i + 1] << 2) | (ix[i + 2] << 1) | ix[i + 3];
    if (layout.count1B) w.put(15 - v, 4);
    else { const c = COUNT1_A[v]; w.put(c % 2 ** 20, Math.floor(c / 2 ** 20)); }
    for (let k = 0; k < 4; k++) if (ix[i + k]) w.put(sign[i + k], 1);
  }
}

/**
 * Encode an AudioBuffer as MP3. `bitrate` in kbps (128-320). Other sample rates than 32 / 44.1 / 48 kHz are
 * resampled to 44.1 kHz. `onProgress(fraction)`; the encoder yields to the event loop as it goes.
 * Resolves to an ArrayBuffer.
 */
export async function encodeMp3(buffer, { bitrate = 256, onProgress } = {}) {
  if (!BITRATE_INDEX[bitrate]) throw new Error(`Unsupported MP3 bitrate ${bitrate}`);
  const channels = Math.min(2, buffer.numberOfChannels);
  let rate = buffer.sampleRate;
  let pcm = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  if (RATE_INDEX[rate] === undefined) {
    // linear resampling to 44.1 kHz (exports are normally rendered at 44.1 / 48 kHz already)
    const ratio = rate / 44100;
    const len = Math.floor(pcm[0].length / ratio);
    pcm = pcm.map((d) => { const o = new Float32Array(len); for (let i = 0; i < len; i++) { const p = i * ratio, k = Math.floor(p), f = p - k; o[i] = d[k] + ((d[k + 1] ?? d[k]) - d[k]) * f; } return o; });
    rate = 44100;
  }
  const sfb = SFB_LONG[rate];
  // keep the band below ~19 kHz (less at lower bitrates): the bits go where they are heard
  const top = bitrate >= 256 ? 19500 : bitrate >= 192 ? 18000 : 16500;
  const cutoff = Math.min(GRANULE, Math.ceil((top / (rate / 2)) * GRANULE));
  // enough frames for the encoder's delay (528 samples) and a decoder's (529) after the last sample
  const length = pcm[0].length;
  const frames = Math.max(1, Math.ceil((length + ENCODER_DELAY + 529) / 1152));
  const input = pcm.map((d) => { const o = new Float64Array(frames * 1152 + 1152); for (let i = 0; i < d.length; i++) o[i] = Math.max(-1, Math.min(1, d[i])); return o; });
  const states = pcm.map(channelState);
  const sideBytes = channels === 2 ? 32 : 17;
  const w = new Bits(Math.ceil(frames * (144000 * bitrate / rate + 2)));
  const xr = new Float64Array(GRANULE);
  let rest = 0;
  for (let f = 0; f < frames; f++) {
    // frame size: 144 * bitrate / rate bytes, with padding bytes to keep the average exact
    const num = 144000 * bitrate;
    let bytes = Math.floor(num / rate);
    rest += num % rate;
    let padding = 0;
    if (rest >= rate) { rest -= rate; padding = 1; bytes++; }
    let bitsLeft = (bytes - 4 - sideBytes) * 8;
    const grans = [];
    for (let gr = 0; gr < 2; gr++) {
      for (let ch = 0; ch < channels; ch++) {
        transform(states[ch], input[ch], f * 1152 + gr * GRANULE, xr);
        const parts = (2 - gr) * channels - ch;
        const budget = Math.min(4095, Math.floor(bitsLeft / parts));
        const g = encodeGranule(xr, cutoff, budget, sfb);
        const L = g.layout;
        g.edges = [Math.min(L.bigValues * 2, sfb[L.region0 + 1]), Math.min(L.bigValues * 2, sfb[Math.min(22, L.region0 + L.region1 + 2)])];
        bitsLeft -= L.bits;
        grans.push(g);
      }
    }
    // header
    const start = w.length;
    w.put(0xfff, 12); w.put(1, 1); w.put(1, 2); w.put(1, 1); // MPEG-1, Layer III, no CRC
    w.put(BITRATE_INDEX[bitrate], 4); w.put(RATE_INDEX[rate], 2); w.put(padding, 1); w.put(0, 1);
    w.put(channels === 2 ? 0 : 3, 2); w.put(0, 2); w.put(0, 1); w.put(1, 1); w.put(0, 2); // mode, ext, (c), original, emphasis
    // side information
    w.put(0, 9); // main_data_begin: no bit reservoir
    w.put(0, channels === 2 ? 3 : 5);
    for (let ch = 0; ch < channels; ch++) w.put(0, 4); // scfsi
    for (const g of grans) {
      const L = g.layout;
      w.put(L.bits, 12); w.put(L.bigValues, 9); w.put(g.gain, 8); w.put(0, 4); w.put(0, 1); // no scalefactors, long blocks
      for (const tb of L.tables) w.put(tb ? tb.t : 0, 5);
      w.put(L.region0, 4); w.put(L.region1, 3);
      w.put(0, 1); w.put(0, 1); w.put(L.count1B ? 1 : 0, 1);
    }
    // main data, then zero bits to the end of the frame
    for (const g of grans) writeGranule(w, g);
    const end = start + bytes * 8;
    while (w.length < end) w.put(0, Math.min(24, end - w.length));
    if (f % 200 === 199) { onProgress?.(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  onProgress?.(1);
  const info = infoFrame({ bitrate, rate, channels, frames, bytes: w.pos, delay: ENCODER_DELAY, padding: frames * 1152 - length - ENCODER_DELAY, cutoff: top });
  const out = new Uint8Array(info.length + w.pos);
  out.set(info);
  out.set(w.buf.subarray(0, w.pos), info.length);
  return out.buffer;
}

const ENCODER_DELAY = 528; // samples: the analysis filterbank and the MDCT overlap

/** CRC-16/ARC (poly 0x8005 reflected), as the LAME tag uses. */
function crc16(bytes, from, to) {
  let crc = 0;
  for (let i = from; i < to; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/**
 * The "Info" frame (Xing header for CBR, with the LAME extension) that goes first: frame count and size for seeking
 * and duration, and the encoder delay and end padding, so players trim them and the file is exactly as long as the
 * song (gapless). Decoders skip this frame.
 */
function infoFrame({ bitrate, rate, channels, frames, bytes, delay, padding, cutoff }) {
  const size = Math.floor((144000 * bitrate) / rate);
  const f = new Uint8Array(size);
  const dv = new DataView(f.buffer);
  dv.setUint32(0, (0xfff << 20) | (1 << 19) | (1 << 17) | (1 << 16) | (BITRATE_INDEX[bitrate] << 12) | (RATE_INDEX[rate] << 10) | ((channels === 2 ? 0 : 3) << 6) | (1 << 2));
  let p = 4 + (channels === 2 ? 32 : 17);
  for (const c of 'Info') f[p++] = c.charCodeAt(0);
  dv.setUint32(p, 0x0f); p += 4; // frames, bytes, TOC and quality present
  dv.setUint32(p, frames); p += 4;
  dv.setUint32(p, bytes + size); p += 4;
  for (let i = 0; i < 100; i++) f[p++] = Math.floor((i * 256) / 100); // CBR: a straight-line TOC
  dv.setUint32(p, 0); p += 4; // quality
  for (const c of 'LAMEOS1.0') f[p++] = c.charCodeAt(0); // the LAME tag layout; players look for "LAME"
  f[p++] = 0x01; // tag revision 0, CBR
  f[p++] = Math.min(255, Math.round(cutoff / 100));
  p += 4 + 2 + 2; // peak and ReplayGain: not measured
  f[p++] = 0; // flags / ATH
  f[p++] = Math.min(255, bitrate);
  f[p++] = delay >> 4; f[p++] = ((delay & 15) << 4) | (padding >> 8); f[p++] = padding & 255;
  f[p++] = 0; // misc
  f[p++] = 0; // MP3 gain
  p += 2; // preset / surround
  dv.setUint32(p, bytes + size); p += 4; // music length
  p += 2; // music CRC: not computed
  dv.setUint16(p, crc16(f, 0, p)); // CRC of everything before it
  return f;
}
