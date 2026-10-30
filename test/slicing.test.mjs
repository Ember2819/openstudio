import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOnsets, equalSlices, sliceBounds, slicesToNotes, guessBars } from '../src/audio/slicing.js';

/** A fake drum loop: decaying noise bursts at the given times (seconds). */
function loop(hits, seconds = 2, sr = 22050) {
  const d = new Float32Array(Math.round(seconds * sr));
  let seed = 3;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 * 2 - 1; };
  for (const t of hits) {
    const o = Math.round(t * sr);
    for (let i = 0; i < sr * 0.15 && o + i < d.length; i++) d[o + i] += rnd() * 0.8 * Math.exp(-i / (sr * 0.03));
  }
  return { d, sr };
}

test('detectOnsets finds the hits of a loop', () => {
  const hits = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75];
  const { d, sr } = loop(hits);
  const on = detectOnsets(d, sr, { sensitivity: 0.5 });
  assert.equal(on[0], 0);
  assert.equal(on.length, hits.length, JSON.stringify(on.map((x) => (x * 2).toFixed(3))));
  on.forEach((f, i) => assert.ok(Math.abs(f * 2 - hits[i]) < 0.03, `hit ${i}: ${f * 2} vs ${hits[i]}`));
});

test('detectOnsets finds hats over a ringing kick and kick after kick', () => {
  const sr = 22050;
  const d = new Float32Array(sr * 2);
  let seed = 9;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 * 2 - 1; };
  const kick = (t) => { const o = Math.round(t * sr); for (let i = 0; i < sr * 0.6 && o + i < d.length; i++) d[o + i] += 0.9 * Math.sin(2 * Math.PI * 55 * i / sr) * Math.exp(-i / (sr * 0.25)); };
  const hat = (t) => { const o = Math.round(t * sr); for (let i = 0; i < sr * 0.05 && o + i < d.length; i++) d[o + i] += 0.15 * rnd() * Math.exp(-i / (sr * 0.01)); };
  kick(0); hat(0.25); kick(0.75); kick(1.0); hat(1.5);
  const on = detectOnsets(d, sr, { sensitivity: 0.5 }).map((x) => x * 2);
  const want = [0, 0.25, 0.75, 1.0, 1.5];
  assert.equal(on.length, want.length, on.map((x) => x.toFixed(3)).join(' '));
  on.forEach((x, i) => assert.ok(Math.abs(x - want[i]) < 0.01, `${x} vs ${want[i]}`));
});

test('detectOnsets ignores silence and a steady tone', () => {
  const sr = 22050;
  const tone = new Float32Array(sr);
  for (let i = 0; i < sr; i++) tone[i] = 0.5 * Math.sin(i / 7);
  assert.deepEqual(detectOnsets(tone, sr), [0]);
  assert.deepEqual(detectOnsets(new Float32Array(sr), sr), [0]);
});

test('slice helpers', () => {
  assert.deepEqual(equalSlices(4), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(sliceBounds([0, 0.5], 1), { start: 0.5, end: 1 });
  assert.deepEqual(slicesToNotes([0, 0.25, 0.5], 32, 60).map((n) => [n.p, n.s, n.l]), [[60, 0, 8], [61, 8, 8], [62, 16, 16]]);
  assert.equal(guessBars(2, 120), 1);
  assert.equal(guessBars(4.1, 120), 2);
  assert.equal(guessBars(7.5, 128), 4);
});
