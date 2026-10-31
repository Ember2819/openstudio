/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Envelope follower → gain, for the Gate and the Sidechain compressor (see effects.js). Input 0 is the key signal;
// the output is the gain to apply (connected to a GainNode's gain), one value per sample.
//   mode 0 (compressor): gain = (thr / env)^(1 - 1/ratio) above the threshold, never below `floor`
//   mode 1 (gate): gain opens to 1 when env is over the threshold, else falls to `floor`; `hold` keeps it open a bit
//   mode 2 (envelope): the envelope times `ratio`, for the vocoder's bands
class OpenStudioDynamics extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: 0.1, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, automationRate: 'k-rate' },
      { name: 'floor', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.002, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.1, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 0.02, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
    this.held = 0;
    this.alive = true;
    this.port.onmessage = (e) => { if (e.data === 'close') this.alive = false; };
  }

  process(inputs, outputs, p) {
    const out = outputs[0][0];
    if (!out) return this.alive;
    const input = inputs[0];
    const l = input[0];
    const r = input[1] || l;
    const coef = (t) => (t > 0 ? Math.exp(-1 / (t * sampleRate)) : 0);
    const att = coef(p.attack[0]);
    const rel = coef(p.release[0]);
    const thr = p.threshold[0];
    const floor = p.floor[0];
    const gate = p.mode[0] >= 0.5;
    const env = p.mode[0] >= 1.5; // mode 2: the envelope itself, times `ratio` (vocoder bands)
    const scale = p.ratio[0];
    const slope = 1 - 1 / Math.max(1, p.ratio[0]);
    const holdN = p.hold[0] * sampleRate;
    for (let i = 0; i < out.length; i++) {
      const x = l ? Math.max(Math.abs(l[i]), Math.abs(r[i])) : 0;
      this.env = x > this.env ? att * this.env + (1 - att) * x : rel * this.env + (1 - rel) * x;
      if (env) { out[i] = this.env * scale; continue; }
      if (gate) {
        if (this.env >= thr) this.held = holdN;
        const target = this.held > 0 ? 1 : floor;
        if (this.held > 0) this.held--;
        // open fast, close with the release
        this.gain = target > this.gain ? att * this.gain + (1 - att) * target : rel * this.gain + (1 - rel) * target;
        out[i] = this.gain;
      } else {
        const g = this.env > thr ? Math.pow(thr / this.env, slope) : 1;
        out[i] = Math.max(floor, g);
      }
    }
    return this.alive;
  }
}

registerProcessor('openstudio-dynamics', OpenStudioDynamics);

/**
 * Pitch shifter and pitch correction. Shifting is the classic two-tap delay line: two read heads sweep through a
 * short window at the speed that changes the pitch, each faded in and out (sin² windows that sum to one) so the
 * jump back is never heard. Correction (mode 1) first finds the input's pitch (YIN on a 2x-decimated copy, every
 * 512 samples) and shifts it to the nearest note allowed by `mask` (12 bits, bit 0 = C), gliding there over `speed`.
 */
const DECIMATE = 2;
class OpenStudioPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'semis', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'window', defaultValue: 0.05, automationRate: 'k-rate' },
      { name: 'mask', defaultValue: 4095, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0.03, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.size = 1 << 16;
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.phase = 0;
    this.ratio = 1;
    this.target = 1;
    // pitch detection on a decimated mono copy
    this.ds = new Float32Array(2048); // DECIMATE x fewer samples than the input
    this.dw = 0;
    this.acc = 0;
    this.accN = 0;
    this.sinceDetect = 0;
    this.alive = true;
    this.port.onmessage = (e) => { if (e.data === 'close') this.alive = false; };
  }

  /** Fundamental (Hz) of the last stretch of decimated input, or 0 if unpitched or quiet. */
  detect() {
    const fs = sampleRate / DECIMATE;
    const W = 512;
    const minLag = Math.max(2, Math.floor(fs / 1000));
    const maxLag = Math.min(this.ds.length - W - 2, Math.floor(fs / 60));
    const ds = this.ds;
    const N = ds.length;
    const x = this.win ||= new Float32Array(W + maxLag + 2);
    const start = this.dw - x.length + N;
    for (let i = 0; i < x.length; i++) x[i] = ds[(start + i) % N];
    let energy = 0;
    for (let i = 0; i < W; i++) energy += x[i] * x[i];
    if (energy / W < 1e-5) return 0;
    const dn = this.dn ||= new Float32Array(maxLag + 2);
    let run = 0;
    let best = 0;
    dn[0] = 1;
    for (let tau = 1; tau <= maxLag + 1; tau++) {
      let d = 0;
      for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; d += v * v; }
      run += d;
      dn[tau] = run > 0 ? (d * tau) / run : 1;
      if (best) { if (dn[tau] > dn[tau - 1]) break; best = tau; } // follow the dip to its bottom
      else if (tau >= minLag && dn[tau] < 0.2) best = tau;
    }
    if (!best || best >= maxLag) return 0;
    // parabolic interpolation around the dip for sub-sample accuracy
    const a = dn[best - 1], b = dn[best], c = dn[best + 1];
    const den = a - 2 * b + c;
    const lag = den > 0 ? best + (0.5 * (a - c)) / den : best;
    return fs / lag;
  }

  process(inputs, outputs, p) {
    const out = outputs[0];
    const input = inputs[0];
    if (!out?.[0]) return this.alive;
    const n = out[0].length;
    const L = input?.[0];
    const R = input?.[1] || L;
    const W = Math.max(256, Math.round(p.window[0] * sampleRate));
    const correct = p.mode[0] >= 0.5;
    if (!correct) this.target = Math.pow(2, p.semis[0] / 12);
    const glide = correct ? Math.exp(-1 / (Math.max(0.0005, p.speed[0]) * sampleRate)) : 0.999;
    const mask = p.mask[0] | 0;
    const size = this.size;
    const mod = size - 1;
    for (let i = 0; i < n; i++) {
      const l = L ? L[i] : 0;
      const r = R ? R[i] : 0;
      this.buf[0][this.w] = l;
      this.buf[1][this.w] = r;
      if (correct) {
        this.acc += (l + r) * 0.5;
        if (++this.accN === DECIMATE) {
          this.ds[this.dw] = this.acc / DECIMATE;
          this.dw = (this.dw + 1) % this.ds.length;
          this.acc = 0;
          this.accN = 0;
        }
        if (++this.sinceDetect >= 512) {
          this.sinceDetect = 0;
          const hz = this.detect();
          if (hz > 0) {
            const midi = 69 + 12 * Math.log2(hz / 440);
            // the nearest allowed note
            let bestNote = Math.round(midi);
            let bestDist = Infinity;
            for (let k = Math.floor(midi) - 6; k <= Math.ceil(midi) + 6; k++) {
              if (!(mask & (1 << (((k % 12) + 12) % 12)))) continue;
              const dist = Math.abs(k - midi);
              if (dist < bestDist) { bestDist = dist; bestNote = k; }
            }
            this.target = Math.pow(2, (bestNote - midi) / 12);
          }
        }
      }
      this.ratio = glide * this.ratio + (1 - glide) * this.target;
      // the two read heads
      this.phase += (1 - this.ratio) / W;
      this.phase -= Math.floor(this.phase);
      for (let c = 0; c < 2; c++) {
        let y = 0;
        for (let h = 0; h < 2; h++) {
          const ph = h ? (this.phase + 0.5) % 1 : this.phase;
          const d = 1 + ph * W;
          const pos = this.w - d;
          const i0 = Math.floor(pos);
          const f = pos - i0;
          const a = this.buf[c][(i0 + size) & mod];
          const b = this.buf[c][(i0 + 1 + size) & mod];
          const g = Math.sin(Math.PI * ph);
          y += (a + (b - a) * f) * g * g;
        }
        if (out[c]) out[c][i] = y;
      }
      this.w = (this.w + 1) & mod;
    }
    return this.alive;
  }
}

registerProcessor('openstudio-pitch', OpenStudioPitch);
