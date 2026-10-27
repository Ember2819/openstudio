import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, fft, spectrum } from '../src/agent/analysis.js';

const SR = 44100;
const sine = (hz, amp, seconds) => Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

test('fft puts a sine in the right bin', () => {
  const n = 1024;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 64 * i) / n));
  const im = new Float64Array(n);
  fft(re, im);
  const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]));
  assert.equal(mags.indexOf(Math.max(...mags.slice(0, n / 2))), 64);
});

test('levels of a steady sine', () => {
  const tone = sine(440, 0.5, 2);
  const r = analyze(tone, tone, SR, { windowSeconds: 1 });
  assert.equal(r.silent, false);
  assert.ok(Math.abs(r.peakDb - -6) < 0.1, `peak ${r.peakDb}`);
  assert.ok(Math.abs(r.rmsDb - -9) < 0.1, `rms ${r.rmsDb}`);
  assert.equal(r.clippedSamples, 0);
  assert.equal(r.stereoCorrelation, 1);
  assert.equal(r.timeline.length, 2);
  assert.deepEqual(r.warnings, []);
  assert.ok(r.spectrum.energyShare.lowMid > 0.95, JSON.stringify(r.spectrum));
  assert.ok(Math.abs(r.spectrum.centroidHz - 440) < 60);
});

test('spectral balance follows the frequency', () => {
  assert.ok(spectrum(sine(80, 0.5, 1), SR).energyShare.bass > 0.95);
  assert.ok(spectrum(sine(1000, 0.5, 1), SR).energyShare.mid > 0.95);
  assert.ok(spectrum(sine(10000, 0.5, 1), SR).energyShare.high > 0.95);
});

test('silence, clipping, phase problems and DC are flagged', () => {
  const zero = new Float32Array(SR);
  const silent = analyze(zero, zero, SR);
  assert.equal(silent.silent, true);
  assert.match(silent.warnings[0], /silent/);
  assert.equal(silent.spectrum, null);

  const hot = sine(100, 1.4, 1).map((x) => Math.max(-1, Math.min(1, x)));
  assert.ok(analyze(hot, hot, SR).warnings.some((w) => /full scale/.test(w)));

  const tone = sine(440, 0.3, 1);
  const inverted = tone.map((x) => -x);
  const anti = analyze(tone, inverted, SR);
  assert.ok(anti.stereoCorrelation < -0.99);
  assert.ok(anti.warnings.some((w) => /anti-correlated/.test(w)));

  const dc = tone.map((x) => x + 0.1);
  assert.ok(analyze(dc, dc, SR).warnings.some((w) => /DC offset/.test(w)));
});

test('the timeline shows loudness over time and merges long renders', () => {
  const loud = sine(440, 0.8, 1);
  const quiet = sine(440, 0.08, 1);
  const both = new Float32Array(2 * SR);
  both.set(loud, 0);
  both.set(quiet, SR);
  const r = analyze(both, both, SR, { windowSeconds: 1 });
  assert.ok(r.timeline[0].rmsDb - r.timeline[1].rmsDb > 19);

  const long = new Float32Array(200 * SR).fill(0.1);
  const merged = analyze(long, long, SR, { windowSeconds: 1, maxWindows: 64 });
  assert.ok(merged.timeline.length <= 64);
  assert.equal(merged.timeline.at(-1).to, 200);

  const range = analyze(both, both, SR, { windowSeconds: 1, from: 1, to: 2 });
  assert.equal(range.seconds, 1);
  assert.ok(range.peakDb < -20);
});
