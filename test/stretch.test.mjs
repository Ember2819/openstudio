import test from 'node:test';
import assert from 'node:assert/strict';
import { wsola, guessLoopBpm } from '../src/audio/stretch.js';

const SR = 44100;
const zeroCrossHz = (d, from, to) => { let z = 0; for (let i = from + 1; i < to; i++) if (d[i - 1] < 0 && d[i] >= 0) z++; return (z * SR) / (to - from); };

test('wsola changes the length but not the pitch', () => {
  const n = SR * 2;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 0.5 * Math.sin((2 * Math.PI * 330 * i) / SR);
  for (const speed of [0.8, 1.25]) {
    const [out] = wsola([tone], speed);
    assert.equal(out.length, Math.round(n / speed));
    const hz = zeroCrossHz(out, SR * 0.2, out.length - SR * 0.2);
    assert.ok(Math.abs(hz - 330) < 3, `speed ${speed}: ${hz.toFixed(1)} Hz`);
    let peak = 0;
    for (let i = SR * 0.2; i < out.length - SR * 0.2; i++) peak = Math.max(peak, Math.abs(out[i]));
    assert.ok(peak > 0.45 && peak < 0.56, `level kept: ${peak}`);
  }
});

test('wsola keeps hits where they belong in time', () => {
  const n = SR * 2;
  const clicks = new Float32Array(n);
  for (const t of [0.5, 1.0, 1.5]) for (let i = 0; i < 400; i++) clicks[Math.round(t * SR) + i] = (i % 2 ? -1 : 1) * Math.exp(-i / 80);
  const [out] = wsola([clicks], 0.5); // twice as long
  for (const t of [1.0, 2.0, 3.0]) {
    let e = 0;
    for (let i = Math.round((t - 0.03) * SR); i < Math.round((t + 0.06) * SR); i++) e = Math.max(e, Math.abs(out[i]));
    assert.ok(e > 0.3, `hit near ${t}s`);
  }
});

test('guessLoopBpm', () => {
  assert.equal(guessLoopBpm(2, 4, 120), 120);
  assert.equal(guessLoopBpm(8, 4, 130), 120);
  assert.equal(Math.round(guessLoopBpm(3.75, 4, 140)), 128);
});
