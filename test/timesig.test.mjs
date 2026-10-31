import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, barSteps, beatSteps, validTimeSig } from '../src/state.js';
import { buildMidi } from '../src/midifile.js';
import { parseMidi } from '../src/midiimport.js';
import { snapSize } from '../src/ui/snap.js';

test('bar and beat lengths follow the time signature', () => {
  assert.deepEqual([barSteps({ timeSig: [4, 4] }), beatSteps({ timeSig: [4, 4] })], [16, 4]);
  assert.deepEqual([barSteps({ timeSig: [3, 4] }), beatSteps({ timeSig: [3, 4] })], [12, 4]);
  assert.deepEqual([barSteps({ timeSig: [6, 8] }), beatSteps({ timeSig: [6, 8] })], [12, 2]);
  assert.deepEqual([barSteps({ timeSig: [7, 8] }), beatSteps({ timeSig: [7, 8] })], [14, 2]);
  assert.equal(barSteps({}), 16, 'old projects are 4/4');
  assert.equal(validTimeSig([4, 3]), false);
  assert.equal(validTimeSig([0, 4]), false);
});

test('patterns are whole bars of the project time signature', () => {
  const store = new Store();
  store.project.timeSig = [3, 4];
  const pat = store.currentPattern;
  assert.equal(store.patternSteps(pat), 12);
  store.addNote(pat, store.project.channels[0].id, { p: 60, s: 13, l: 1 });
  assert.equal(pat.bars, 2);
  assert.equal(store.patternSteps(pat), 24);
});

test('loading repairs a bad time signature', () => {
  const store = new Store();
  const raw = JSON.parse(store.serialize());
  raw.timeSig = [5, 5];
  store.load(JSON.stringify(raw));
  assert.deepEqual(store.project.timeSig, [4, 4]);
  delete raw.timeSig;
  store.load(JSON.stringify(raw));
  assert.deepEqual(store.project.timeSig, [4, 4]);
});

test('MIDI export writes the time signature and import reads it back', () => {
  const store = new Store();
  store.project.timeSig = [6, 8];
  store.addNote(store.currentPattern, store.project.channels[0].id, { p: 60, s: 0, l: 2 });
  const midi = parseMidi(buildMidi(store, { song: false }));
  assert.deepEqual(midi.timeSig, [6, 8]);
});

test('beat and bar snapping follow the time signature', () => {
  assert.equal(snapSize('bar', 10, 2, 12), 12);
  assert.equal(snapSize('beat', 10, 2, 12), 2);
  assert.equal(snapSize('bar', 10), 16);
});
