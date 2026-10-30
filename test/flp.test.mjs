import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { parseFlp, importFlp, mapChannel, mapEffect, flpSamplePaths } from '../src/flp.js';

// ------------------------------------------------------------------ a tiny .flp writer (test fixture only)
const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const i32 = (v) => u32(v >>> 0);
const utf16 = (s) => [...Buffer.from(`${s}\0`, 'utf16le')];
const ascii = (s) => [...Buffer.from(`${s}\0`, 'latin1')];
const varint = (n) => { const out = []; do { let c = n & 0x7f; n >>>= 7; if (n) c |= 0x80; out.push(c); } while (n); return out; };

function ev(id, value) {
  if (id < 64) return [id, value & 0xff];
  if (id < 128) return [id, ...u16(value)];
  if (id < 192) return [id, ...u32(value)];
  return [id, ...varint(value.length), ...value];
}

function note({ pos, len, key, ch, vel = 100, pan = 64, fine = 120 }) {
  return [...u32(pos), ...u16(0x4000), ...u16(ch), ...u32(len), ...u16(key), ...u16(0), fine, 0, 64, 0, pan, vel, 128, 128];
}

/** A 60-byte (FL 21) playlist item. */
function item({ pos, len, track, pattern = null, channel = null, start = -1, end = -1, muted = false }) {
  const index = pattern != null ? 20480 + pattern : channel;
  const head = [...u32(pos), ...u16(20480), ...u16(index), ...u32(len), ...u16(499 - track), ...u16(0), ...u16(0x78), ...u16(muted ? 0x2000 : 0x40), ...u32(0), ...i32(start), ...i32(end)];
  return [...head, ...new Array(28).fill(0)];
}

function mixerRecord(insert, pid, value, slot = 0) {
  return [...u32(0), pid, 0, ...u16((insert << 6) | slot), ...i32(value)];
}

function buildFlp() {
  const e = [];
  e.push(...ev(199, ascii('21.0.3.3517')));
  e.push(...ev(156, 128500)); // 128.5 BPM
  e.push(...ev(17, 4), ...ev(18, 4));
  e.push(...ev(194, utf16('Night Drive')));
  // pattern 1 notes (channels: 0 = lead, 1 = kick, 2 = layer of 0 and 3)
  e.push(...ev(65, 1));
  e.push(...ev(224, [
    ...note({ pos: 0, len: 0, key: 60, ch: 1 }),
    ...note({ pos: 96, len: 0, key: 60, ch: 1, vel: 128 }),
    ...note({ pos: 0, len: 192, key: 72, ch: 0, pan: 0, fine: 170 }),
    ...note({ pos: 192, len: 96, key: 67, ch: 2 }),
  ]));
  e.push(...ev(193, utf16('Verse')), ...ev(150, 0x0000ff));
  e.push(...ev(65, 2), ...ev(193, utf16('Empty but named')));
  // channels
  e.push(...ev(64, 0), ...ev(21, 2), ...ev(201, utf16('3x Osc')), ...ev(203, utf16('Lead')), ...ev(128, 0x3020a0), ...ev(22, 2));
  e.push(...ev(219, [...u32(3200), ...u32(6400), ...i32(0), ...new Array(12).fill(0)]));
  e.push(...ev(64, 1), ...ev(21, 0), ...ev(201, utf16('')), ...ev(203, utf16('Kick')), ...ev(22, 1));
  e.push(...ev(196, utf16('C:\\Samples\\Kicks\\Big Kick.wav')));
  e.push(...ev(64, 2), ...ev(21, 3), ...ev(203, utf16('Layer')), ...ev(94, 0), ...ev(94, 3));
  e.push(...ev(64, 3), ...ev(21, 2), ...ev(201, utf16('Fruity Wrapper')), ...ev(203, utf16('Serum Pad')));
  e.push(...ev(64, 4), ...ev(21, 4), ...ev(203, utf16('Clap')), ...ev(196, utf16('D:\\Loops\\Clap.wav')));
  // arrangement
  e.push(...ev(99, 0), ...ev(241, utf16('Arrangement')));
  e.push(...ev(233, [
    ...item({ pos: 0, len: 384, track: 0, pattern: 1 }),
    ...item({ pos: 384, len: 384, track: 0, pattern: 1, start: 96, muted: true }),
    ...item({ pos: 0, len: 384, track: 3, pattern: 9 }), // a pattern that does not exist
    ...item({ pos: 96, len: 24, track: 4, channel: 4 }), // an audio clip whose file is missing
  ]));
  e.push(...ev(238, [...u32(1), ...u32(0x00ff00), ...u32(0), 1, ...new Array(53).fill(0)]), ...ev(239, utf16('Drums')));
  e.push(...ev(238, [...u32(2), ...u32(0x565148), ...u32(0), 0, ...new Array(53).fill(0)]));
  // mixer params: master 100%, insert 1 at 50%, insert 2 panned right, insert 3 sends to 2 at 80%
  e.push(...ev(225, [...mixerRecord(0, 192, 12800), ...mixerRecord(1, 192, 8000), ...mixerRecord(2, 193, 3200), ...mixerRecord(3, 64 + 2, 12800)]));
  // inserts: master, 1 (reverb plugin), 2, 3 (routes to 2 only)
  const insert = (name, routes, fx = [], flags = 0x4c) => {
    const out = [];
    out.push(...ev(204, utf16(name)), ...ev(236, [...u32(0), ...u32(flags), ...u32(0)]));
    fx.forEach((p, slot) => out.push(...ev(201, utf16(p)), ...ev(98, slot)));
    const r = new Array(127).fill(0);
    routes.forEach((x) => { r[x] = 1; });
    out.push(...ev(235, r), ...ev(154, 0xffffffff), ...ev(147, 0xffffffff));
    return out;
  };
  e.push(...insert('Master', [], [], 0x0c));
  e.push(...insert('Drum bus', [0], ['Fruity Reeverb 2', 'Fruity NoteBook 2', 'Gross Beat']));
  e.push(...insert('Lead', [0]));
  e.push(...insert('To bus', [2], [], 0x44));
  const header = [...Buffer.from('FLhd'), ...u32(6), ...u16(0), ...u16(4), ...u16(96)];
  return new Uint8Array([...header, ...Buffer.from('FLdt'), ...u32(e.length), ...e]);
}

test('parseFlp reads the project, channels, patterns, playlist and mixer', () => {
  const f = parseFlp(buildFlp());
  assert.equal(f.version, '21.0.3.3517');
  assert.equal(f.bpm, 128.5);
  assert.equal(f.title, 'Night Drive');
  assert.equal(f.ppq, 96);
  assert.deepEqual(f.channels.map((c) => [c.name, c.kind, c.plugin]), [['Lead', 'generator', '3x Osc'], ['Kick', 'sampler', ''], ['Layer', 'layer', ''], ['Serum Pad', 'generator', 'Fruity Wrapper'], ['Clap', 'audio', '']]);
  assert.equal(f.channels[0].color, '#a02030');
  assert.equal(f.channels[0].insert, 2);
  assert.deepEqual(f.channels[2].layer, [0, 3]);
  assert.equal(f.patterns[0].name, 'Verse');
  assert.equal(f.patterns[0].color, '#ff0000');
  assert.equal(f.patterns[0].notes.length, 4);
  assert.equal(f.arrangements[0].items.length, 4);
  assert.equal(f.arrangements[0].items[3].channel, 4);
  assert.equal(f.arrangements[0].items[1].muted, true);
  assert.equal(f.arrangements[0].items[1].startOffset, 96);
  assert.equal(f.arrangements[0].tracks[0].name, 'Drums');
  assert.equal(f.inserts.length, 4);
  assert.equal(f.inserts[1].vol, 8000);
  assert.deepEqual(f.inserts[1].fx.map((x) => x.plugin), ['Fruity Reeverb 2', 'Fruity NoteBook 2', 'Gross Beat']);
  assert.deepEqual(f.inserts[3].routes, [2]);
  assert.deepEqual(flpSamplePaths(f), ['C:\\Samples\\Kicks\\Big Kick.wav', 'D:\\Loops\\Clap.wav']);
});

test('importFlp builds a playable OpenStudio project', () => {
  const store = new Store();
  const flp = parseFlp(buildFlp());
  const report = importFlp(store, flp, { name: 'file' });
  store.finishLoad();
  const p = store.project;
  assert.equal(p.name, 'Night Drive');
  assert.equal(p.bpm, 128.5);
  assert.equal(p.mode, 'song');
  assert.deepEqual(p.channels.map((c) => c.name), ['Lead', 'Kick', 'Serum Pad', 'Clap']);
  const [lead, kick, pad] = p.channels;
  assert.equal(lead.type, 'synth');
  assert.equal(lead.mixer, 2);
  assert.equal(lead.vol, 0.5);
  assert.equal(lead.pan, -0.5);
  assert.equal(kick.type, 'drum', 'missing sample falls back to a drum voice');
  assert.equal(kick.voice, 'kick');
  assert.equal(pad.type, 'sf');
  assert.equal(pad.program, 89);
  assert.deepEqual(report.missingSamples, ['C:\\Samples\\Kicks\\Big Kick.wav', 'D:\\Loops\\Clap.wav']);
  assert.ok(report.substituted.some((s) => s.includes('Serum Pad')));
  assert.deepEqual(report.skipped, ['Gross Beat (insert 1)']);

  const verse = p.patterns[0];
  assert.equal(verse.name, 'Verse');
  assert.deepEqual(verse.notes[kick.id].map((n) => [n.s, n.l, n.v]), [[0, 1, 100 / 128], [4, 1, 1]]);
  const leadNotes = verse.notes[lead.id];
  assert.deepEqual(leadNotes.map((n) => [n.p, n.s, n.l]), [[72, 0, 8], [67, 8, 4]], 'the layer note reaches the lead');
  assert.equal(leadNotes[0].pan, -1);
  assert.equal(leadNotes[0].fine, 50);
  assert.deepEqual(verse.notes[pad.id].map((n) => n.p), [67], 'and the other layer child');
  assert.equal(p.patterns[1].name, 'Empty but named');

  assert.equal(p.playlist.clips.length, 3, 'the clip of a missing pattern is dropped');
  const [c1, c2, c3] = p.playlist.clips;
  const standIn = store.pattern(c3.pat);
  assert.equal(standIn.name, 'Clap (audio clip)');
  assert.deepEqual([c3.track, c3.start, c3.len], [4, 4, 1]);
  assert.equal(p.channels[3].type, 'drum');
  assert.equal(standIn.notes[p.channels[3].id].length, 1);
  assert.deepEqual([c1.track, c1.start, c1.len, c1.offset, c1.mute], [0, 0, 16, 0, false]);
  assert.deepEqual([c2.start, c2.offset, c2.mute], [16, 4, true]);
  assert.equal(p.playlist.tracks[0].name, 'Drums');
  assert.equal(p.playlist.tracks[0].color, '#00ff00');
  assert.equal(p.playlist.tracks[1].mute, true);

  assert.equal(p.mixer[1].name, 'Drum bus');
  assert.equal(p.mixer[1].vol, 0.5);
  assert.deepEqual(p.mixer[1].fx.filter(Boolean).map((x) => x.type), ['reverb']);
  assert.equal(p.mixer[2].pan, 0.5);
  assert.equal(p.mixer[3].sends[2], 0.8);
  assert.equal(p.mixer[3].master, false);
  assert.equal(p.mixer[3].mute, true, 'flag 0x08 off = insert disabled');
  assert.notEqual(p.mixer[2].master, false);
});

test('importFlp loads samples it is given', () => {
  const store = new Store();
  const data = new ArrayBuffer(16);
  importFlp(store, parseFlp(buildFlp()), { samples: new Map([['C:\\Samples\\Kicks\\Big Kick.wav', { name: 'Big Kick.wav', data }]]) });
  const kick = store.project.channels.find((c) => c.name === 'Kick');
  assert.equal(kick.type, 'sampler');
  assert.equal(store.samples.get(kick.sampleId).data, data);
});

test('parseFlp rejects other files', () => {
  assert.throws(() => parseFlp(new Uint8Array([1, 2, 3])), /Not an FL Studio project/);
  assert.throws(() => parseFlp(Buffer.from('MThd\0\0\0\x06\0\0\0\x01\0\x60xxxxxxxxxx')), /Not an FL Studio project/);
});

test('channel and effect mapping', () => {
  assert.deepEqual(mapChannel({ kind: 'generator', plugin: 'Sytrus', name: 'Bells' }), { type: 'fm' });
  assert.deepEqual(mapChannel({ kind: 'generator', plugin: 'Fruity Wrapper', name: 'Nexus Piano' }), { type: 'sf', program: 0 });
  assert.deepEqual(mapChannel({ kind: 'generator', plugin: 'FLEX', name: 'Open Hat' }), { type: 'drum', voice: 'openhat' });
  assert.deepEqual(mapChannel({ kind: 'generator', plugin: 'Harmor', name: '808 Bass' }), { type: 'sf', program: 38 });
  assert.deepEqual(mapChannel({ kind: 'generator', plugin: 'FPC', name: 'FPC' }), { type: 'sf', bank: 128, program: 0, kit: true });
  assert.deepEqual(mapChannel({ kind: 'sampler', plugin: '', name: 'Snare 3', sample: '' }), { type: 'drum', voice: 'snare' });
  assert.equal(mapEffect('Fruity parametric EQ 2'), 'eq');
  assert.equal(mapEffect('Fruity Limiter'), 'limiter');
  assert.equal(mapEffect('Fruity Wrapper', 'Valhalla VintageVerb'), 'reverb');
  assert.equal(mapEffect('Fruity NoteBook 2'), null);
});
