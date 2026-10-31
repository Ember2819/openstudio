import test from 'node:test';
import assert from 'node:assert/strict';
import { noteFromName, detectPitch, guessRoot, spreadZones, pickZones, validZones } from '../src/audio/zones.js';

test('note names in sample file names (scientific octaves: C4 = 60)', () => {
  assert.equal(noteFromName('Piano_C4.wav').midi, 60);
  assert.equal(noteFromName('Grand Piano C#4 mf.wav').midi, 61);
  assert.equal(noteFromName('Strings Db3.flac').midi, 49);
  assert.equal(noteFromName('bass-a1.wav').midi, 33);
  assert.equal(noteFromName('Bb2.wav').midi, 46);
  assert.equal(noteFromName('Cs5.wav').midi, 73);
  assert.equal(noteFromName('Kick 808.wav'), null);
  assert.equal(noteFromName('Take 12.wav'), null);
  assert.equal(noteFromName('Bass2.wav'), null, 'a word is not a note');
});

const tone = (hz, sr = 44100, secs = 0.6) => {
  const d = new Float32Array(Math.floor(sr * secs));
  for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sr) + 0.2 * Math.sin((4 * Math.PI * hz * i) / sr);
  return d;
};

test('pitch detection of a sample', () => {
  for (const [hz, midi] of [[440, 69], [110, 45], [261.63, 60], [1046.5, 84], [55, 33]]) {
    assert.ok(Math.abs(detectPitch(tone(hz), 44100) - midi) < 0.1, `${hz} Hz`);
  }
  const noise = new Float32Array(30000).map(() => Math.random() * 2 - 1);
  assert.equal(detectPitch(noise, 44100), null);
});

test('root guess: the name, with its octave checked by ear', () => {
  assert.equal(guessRoot('Piano C3.wav', tone(261.63), 44100), 60, 'C3 in a C3 = middle C library');
  assert.equal(guessRoot('Piano C4.wav', null, 44100), 60);
  assert.equal(guessRoot('Untitled.wav', tone(440), 44100), 69);
  assert.equal(guessRoot('Untitled.wav', null, 44100, 55), 55);
});

test('zones spread to halfway between roots; velocity layers share a range', () => {
  const z = spreadZones([{ sampleId: 1, root: 60 }, { sampleId: 2, root: 48 }, { sampleId: 3, root: 72, vlo: 0, vhi: 0.5 }, { sampleId: 4, root: 72, vlo: 0.5, vhi: 1 }]);
  assert.deepEqual(z.map((x) => [x.sampleId, x.lo, x.hi]), [[2, 0, 54], [1, 55, 66], [3, 67, 127], [4, 67, 127]]);
  assert.ok(validZones(z));
  assert.deepEqual(pickZones(z, 50).map((x) => x.sampleId), [2]);
  assert.deepEqual(pickZones(z, 66).map((x) => x.sampleId), [1]);
  assert.deepEqual(pickZones(z, 80, 0.3).map((x) => x.sampleId), [3]);
  assert.deepEqual(pickZones(z, 80, 0.9).map((x) => x.sampleId), [4]);
  assert.deepEqual(pickZones(z, 80, 0.5).map((x) => x.sampleId), [3, 4], 'layers overlap at the boundary');
  // gaps play the nearest root
  assert.deepEqual(pickZones([{ sampleId: 9, root: 60, lo: 58, hi: 62 }, { sampleId: 8, root: 40, lo: 38, hi: 42 }], 50).map((x) => x.sampleId), [9]);
  assert.equal(validZones([{ sampleId: 1, root: 60, lo: 70, hi: 50 }]), false);
  assert.equal(validZones([]), false);
});
