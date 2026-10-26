import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { curveAt, normToValue, valueToNorm, targetValid } from '../src/automation.js';

const pts = [{ x: 0, y: 0 }, { x: 8, y: 1 }, { x: 16, y: 0.5, curve: 'hold' }, { x: 24, y: 0 }];

test('curveAt interpolates linearly and clamps outside the points', () => {
  assert.equal(curveAt(pts, -4), 0);
  assert.equal(curveAt(pts, 4), 0.5);
  assert.equal(curveAt(pts, 8), 1);
  assert.equal(curveAt(pts, 100), 0);
});

test('hold segments keep the previous value, smooth segments ease', () => {
  assert.equal(curveAt(pts, 20), 0.5);
  const smooth = [{ x: 0, y: 0, curve: 'smooth' }, { x: 10, y: 1 }];
  assert.ok(curveAt(smooth, 2.5) < 0.25);
  assert.equal(curveAt(smooth, 5), 0.5);
});

test('normalised values map to real parameter ranges', () => {
  const s = new Store();
  const pan = { kind: 'mixer', track: 1, param: 'pan' };
  assert.equal(normToValue(s, pan, 0), -1);
  assert.equal(normToValue(s, pan, 1), 1);
  assert.equal(valueToNorm(s, pan, 0), 0.5);
  const vol = { kind: 'channel', id: s.project.channels[0].id, param: 'vol' };
  assert.ok(targetValid(s, vol));
  assert.equal(targetValid(s, { kind: 'channel', id: 9999, param: 'vol' }), false);
});

test('logarithmic parameters round-trip', () => {
  const s = new Store();
  const ch = s.addChannel({ type: 'sf', name: 'Piano', bank: 0, program: 0 });
  const t = { kind: 'chparam', id: ch.id, key: 'cutoff' };
  const v = normToValue(s, t, 0.5);
  assert.ok(v > 200 && v < 20000);
  assert.ok(Math.abs(valueToNorm(s, t, v) - 0.5) < 1e-9);
});
