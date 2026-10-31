import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { buildMidi } from '../src/midifile.js';

const u32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

function readVlq(bytes, pos) {
  let v = 0;
  let b;
  do { b = bytes[pos++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80);
  return [v, pos];
}

function parse(bytes) {
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  const tracks = (bytes[10] << 8) | bytes[11];
  const division = (bytes[12] << 8) | bytes[13];
  let pos = 14;
  const out = [];
  for (let t = 0; t < tracks; t++) {
    assert.equal(String.fromCharCode(...bytes.slice(pos, pos + 4)), 'MTrk');
    const len = u32(bytes, pos + 4);
    const end = pos + 8 + len;
    let p = pos + 8;
    let tick = 0;
    const events = [];
    while (p < end) {
      let delta;
      [delta, p] = readVlq(bytes, p);
      tick += delta;
      const status = bytes[p++];
      if (status === 0xff) { const type = bytes[p++]; let l; [l, p] = readVlq(bytes, p); events.push({ tick, meta: type, data: bytes.slice(p, p + l) }); p += l; }
      else { const n = (status & 0xf0) === 0xc0 ? 1 : 2; events.push({ tick, status, data: bytes.slice(p, p + n) }); p += n; }
    }
    out.push(events);
    pos = end;
  }
  return { division, tracks: out };
}

test('exports a type-1 file with a tempo track and one track per used channel', () => {
  const s = new Store();
  s.project.bpm = 120;
  const kick = s.project.channels[0];
  s.toggleStep(s.currentPattern, kick.id, 0, true);
  s.toggleStep(s.currentPattern, kick.id, 4, true);
  const piano = s.addChannel({ type: 'sf', name: 'Piano', bank: 0, program: 4 });
  s.addNote(s.currentPattern, piano.id, { p: 64, s: 2, l: 2, v: 1 });

  const midi = parse(buildMidi(s, { song: false }));
  assert.equal(midi.division, 96);
  assert.equal(midi.tracks.length, 3);

  const tempo = midi.tracks[0].find((e) => e.meta === 0x51);
  assert.equal((tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2], 500000);

  const drums = midi.tracks[1].filter((e) => (e.status & 0xf0) === 0x90);
  assert.deepEqual(drums.map((e) => e.tick), [0, 96]); // steps 0 and 4, 24 ticks per step
  assert.ok(drums.every((e) => (e.status & 0x0f) === 9 && e.data[0] === 36)); // GM channel 10, kick key

  const keys = midi.tracks[2];
  assert.ok(keys.some((e) => (e.status & 0xf0) === 0xc0 && e.data[0] === 4)); // program change
  const on = keys.find((e) => (e.status & 0xf0) === 0x90);
  const off = keys.find((e) => (e.status & 0xf0) === 0x80);
  assert.equal(on.tick, 48);
  assert.equal(off.tick, 96);
  assert.equal(on.data[1], 127);
});

test('song export expands pattern clips', () => {
  const s = new Store();
  const kick = s.project.channels[0];
  s.toggleStep(s.currentPattern, kick.id, 0, true);
  s.addClip({ type: 'pattern', pat: s.currentPattern.id, track: 0, start: 0, len: 48 });
  const midi = parse(buildMidi(s, { song: true }));
  const ons = midi.tracks[1].filter((e) => (e.status & 0xf0) === 0x90).map((e) => e.tick);
  assert.deepEqual(ons, [0, 384, 768]); // one per bar (16 steps * 24 ticks)
});

test('muted and slide notes are not exported as notes', () => {
  const s = new Store();
  const piano = s.addChannel({ type: 'sf', name: 'Piano', bank: 0, program: 0 });
  s.addNote(s.currentPattern, piano.id, { p: 60, s: 0, l: 4, v: 1 });
  s.addNote(s.currentPattern, piano.id, { p: 64, s: 2, l: 2, v: 1, sl: true });
  s.addNote(s.currentPattern, piano.id, { p: 67, s: 4, l: 2, v: 1, m: true });
  for (const song of [false, true]) {
    if (song) s.addClip({ type: 'pattern', pat: s.currentPattern.id, track: 0, start: 0, len: 16 });
    const midi = parse(buildMidi(s, { song }));
    const ons = midi.tracks.at(-1).filter((e) => (e.status & 0xf0) === 0x90).map((e) => e.data[0]);
    assert.deepEqual(ons, [60], song ? 'song' : 'pattern');
  }
});
