import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { buildMidi } from '../src/midifile.js';
import { parseMidi, importMidi } from '../src/midiimport.js';

test('a project exported to MIDI imports back with the same notes and tempo', () => {
  const src = new Store();
  src.project.bpm = 97;
  src.project.name = 'Café ünïcode';
  const keys = src._addChannel({ name: 'Piano', type: 'sf', bank: 0, program: 4 });
  const pat = src.currentPattern;
  pat.notes[keys.id] = [{ p: 60, s: 0, l: 2, v: 0.5 }, { p: 64, s: 4, l: 1.5, v: 1 }];
  pat.notes[src.project.channels[0].id] = [{ p: 60, s: 8, l: 1, v: 0.8 }]; // kick (fixed key 36)

  const midi = parseMidi(buildMidi(src, { song: false }));
  assert.equal(midi.tempo, Math.round(60000000 / 97));
  assert.equal(midi.tracks[0].name, 'Café ünïcode');

  const dst = new Store();
  const before = dst.project.channels.length;
  const imported = importMidi(dst, midi, { name: 'Imported' });
  assert.equal(dst.project.bpm, 97);
  assert.equal(dst.project.channels.length, before + 2);
  const piano = dst.project.channels.find((c) => c.name === 'Piano');
  assert.equal(piano.program, 4);
  assert.deepEqual(imported.notes[piano.id].map((n) => [n.p, n.s, n.l]), [[60, 0, 2], [64, 4, 1.5]]);
  const drums = dst.project.channels.find((c) => c.bank === 128 && c.fixedKey == null);
  assert.ok(drums, 'channel 10 becomes a drum kit');
  assert.deepEqual(imported.notes[drums.id].map((n) => [n.p, n.s]), [[36, 8]]);
});

test('running status, note-on velocity 0 and overlapping notes are handled', () => {
  const bytes = [
    ...'MThd'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    ...'MTrk'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 20,
    0x00, 0x90, 60, 100, // on
    0x18, 60, 90, // running status: second on, same key (overlap)
    0x18, 60, 0, // off (velocity 0) closes the first
    0x18, 0x80, 60, 0, // off closes the second
    0x00, 0xff, 0x2f, 0x00,
  ];
  const midi = parseMidi(new Uint8Array(bytes));
  const [a, b] = midi.tracks[0].notes;
  assert.deepEqual([a.tick, a.dur, b.tick, b.dur], [0, 48, 24, 48]);
});

test('files without notes are rejected', () => {
  const bytes = [...'MThd'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 6, 0, 0, 0, 0, 0, 96]);
  assert.throws(() => importMidi(new Store(), parseMidi(new Uint8Array(bytes))), /no notes/);
});
