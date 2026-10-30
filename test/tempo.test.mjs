import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { TempoMap } from '../src/tempo.js';
import { valueToNorm, describeTarget, formatTarget } from '../src/automation.js';

function song(bpm = 120) {
  const store = new Store();
  store.project.bpm = bpm;
  store.project.mode = 'song';
  return store;
}

/** A tempo clip from step `start` (length `len`) ramping from bpm a to bpm b. */
function tempoRamp(store, start, len, a, b) {
  const target = { kind: 'tempo' };
  const auto = store.addAutomation({ name: 'Tempo', target, value: valueToNorm(store, target, a), len });
  auto.points[1].y = valueToNorm(store, target, b);
  store.addClip({ type: 'auto', autoId: auto.id, track: 5, start, len });
  store.emit('playlist');
  return auto;
}

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('without tempo automation time is linear in steps', () => {
  const store = song(120);
  const map = new TempoMap(store);
  assert.equal(map.varies, false);
  close(map.timeAt(16), 2); // one bar of 4/4 at 120 BPM
  close(map.stepAt(2), 16);
  store.project.bpm = 60;
  close(map.timeAt(16), 4, 1e-9);
});

test('a tempo clip changes the tempo inside it and holds its last value after it', () => {
  const store = song(120);
  tempoRamp(store, 16, 16, 120, 180);
  const map = new TempoMap(store);
  assert.equal(map.varies, true);
  assert.equal(map.bpm(0), 120, 'before the clip: project tempo');
  close(map.bpm(16), 120);
  close(map.bpm(24), 150);
  close(map.bpm(40), 180, 1e-6); // after the clip: last value
  close(map.timeAt(16), 2);
  // bar 2 is a ramp, so it is shorter than 2 s and longer than 4/3 s
  const bar2 = map.timeAt(32) - map.timeAt(16);
  assert.ok(bar2 < 2 && bar2 > 4 / 3, String(bar2));
  close(map.timeAt(48) - map.timeAt(32), 4 / 3, 1e-6);
  close(map.stepAt(map.timeAt(37.5)), 37.5, 1e-6);
});

test('pattern mode ignores tempo automation; muted clips too', () => {
  const store = song(100);
  tempoRamp(store, 0, 16, 140, 140);
  const map = new TempoMap(store);
  close(map.bpm(4), 140);
  store.project.mode = 'pattern';
  assert.equal(map.bpm(4), 100);
  store.project.mode = 'song';
  store.project.playlist.clips[0].mute = true;
  store.emit('playlist');
  assert.equal(map.bpm(4), 100);
});

test('tempo is a describable automation target', () => {
  const store = song();
  assert.equal(describeTarget(store, { kind: 'tempo' }), 'Tempo');
  assert.equal(formatTarget(store, { kind: 'tempo' }, 128), '128.00 BPM');
});
