import test from 'node:test';
import assert from 'node:assert/strict';
import { chords, arpeggiate, strum, chop, flam, snapToScale, velocityRamp, articulate, limitRange } from '../src/notetools.js';

const n = (p, s, l, v = 0.8, extra = {}) => ({ p, s, l, v, ...extra });
const triad = [n(64, 0, 8), n(60, 0, 8), n(67, 0, 8)];

test('chords groups notes that start together', () => {
  const c = chords([...triad, n(62, 8, 4)]);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].notes.map((x) => x.p), [60, 64, 67]);
  assert.equal(c[0].end, 8);
});

test('arpeggiate walks the chord at the given rate and keeps note properties', () => {
  const up = arpeggiate([...triad.slice(0, 2), n(67, 0, 8, 0.8, { pan: -0.5 })], { rate: 2, gate: 0.5 });
  assert.deepEqual(up.map((x) => [x.p, x.s, x.l]), [[60, 0, 1], [64, 2, 1], [67, 4, 1], [60, 6, 1]]);
  assert.equal(up[2].pan, -0.5);
  assert.deepEqual(arpeggiate(triad, { rate: 2, pattern: 'down' }).map((x) => x.p), [67, 64, 60, 67]);
  assert.deepEqual(arpeggiate(triad, { rate: 1, pattern: 'updown' }).map((x) => x.p).slice(0, 6), [60, 64, 67, 64, 60, 64]);
  assert.deepEqual(arpeggiate(triad, { rate: 1, octaves: 2 }).map((x) => x.p).slice(0, 6), [60, 64, 67, 72, 76, 79]);
  const r1 = arpeggiate(triad, { rate: 1, pattern: 'random', seed: 7 }).map((x) => x.p);
  assert.deepEqual(r1, arpeggiate(triad, { rate: 1, pattern: 'random', seed: 7 }).map((x) => x.p), 'deterministic per seed');
  assert.ok(r1.every((p) => [60, 64, 67].includes(p)));
});

test('strum spreads the chord and keeps the end', () => {
  const s = strum(triad, { spread: 1, direction: 'up' });
  assert.deepEqual(s.map((x) => [x.p, x.s, x.s + x.l]), [[60, 0, 8], [64, 0.5, 8], [67, 1, 8]]);
  assert.deepEqual(strum(triad, { spread: 1, direction: 'down' }).map((x) => x.p), [67, 64, 60]);
  const t = strum(triad, { spread: 1, taper: 0.5 });
  assert.ok(t[2].v < t[0].v);
});

test('chop, flam, snapToScale, ramp, articulate, limit', () => {
  assert.deepEqual(chop([n(60, 0, 3.5)], 1).map((x) => [x.s, x.l]), [[0, 1], [1, 1], [2, 1], [3, 0.5]]);
  const f = flam([n(60, 4, 2)], { offset: 0.25 });
  assert.deepEqual(f.map((x) => x.s).sort(), [3.75, 4]);
  const major = [0, 2, 4, 5, 7, 9, 11];
  assert.deepEqual(snapToScale([n(61, 0, 1), n(66, 0, 1), n(60, 0, 1)], 0, major).map((x) => x.p), [60, 65, 60]);
  const ramp = velocityRamp([n(60, 0, 1), n(60, 2, 1), n(60, 4, 1)], 0.2, 1);
  assert.deepEqual(ramp.map((x) => Math.round(x.v * 10) / 10), [0.2, 0.6, 1]);
  assert.deepEqual(articulate([n(60, 0, 4), n(62, 4, 4)], 0.5).map((x) => x.l), [2, 2]);
  assert.deepEqual(limitRange([n(30, 0, 1), n(100, 0, 1), n(60, 0, 1)], 48, 72).map((x) => x.p), [54, 64, 60]);
});
