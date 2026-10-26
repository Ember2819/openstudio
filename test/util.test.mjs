import test from 'node:test';
import assert from 'node:assert/strict';
import { noteName, isBlackKey, faderToGain, gainToDb, midiToFreq, snapSizeCheck } from './util-helpers.mjs';

test('note names follow the FL Studio convention (MIDI 60 = C5)', () => {
  assert.equal(noteName(60), 'C5');
  assert.equal(noteName(61), 'C#5');
  assert.equal(noteName(0), 'C0');
  assert.ok(isBlackKey(61) && !isBlackKey(62));
});

test('mixer fader law: 80% is unity gain, 100% is +6 dB, 0 is silence', () => {
  assert.ok(Math.abs(faderToGain(0.8) - 1) < 1e-9);
  assert.ok(Math.abs(gainToDb(faderToGain(1)) - 6) < 1e-9);
  assert.equal(faderToGain(0), 0);
});

test('midiToFreq', () => {
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});

test('"Line" snap picks the finest visible grid', () => {
  const { snapSize } = snapSizeCheck;
  assert.equal(snapSize('line', 40), 0.25);
  assert.equal(snapSize('line', 24), 0.5);
  assert.equal(snapSize('line', 1), 16);
  assert.equal(snapSize('none', 40), 0);
  assert.equal(snapSize('beat', 1), 4);
});
