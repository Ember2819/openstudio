import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';

test('default project has a drum kit, one pattern and an empty playlist', () => {
  const s = new Store();
  assert.equal(s.project.channels.length, 4);
  assert.equal(s.project.patterns.length, 1);
  assert.equal(s.project.playlist.clips.length, 0);
  assert.ok(s.project.channels.every((c) => c.type === 'sf' && c.bank === 128));
});

test('step pads are notes and extend the pattern', () => {
  const s = new Store();
  const ch = s.project.channels[0];
  const pat = s.currentPattern;
  s.toggleStep(pat, ch.id, 3, true);
  assert.deepEqual(pat.notes[ch.id].map((n) => n.s), [3]);
  s.toggleStep(pat, ch.id, 3, false);
  assert.equal(pat.notes[ch.id].length, 0);
  s.addNote(pat, ch.id, { p: 60, s: 20, l: 4 });
  assert.equal(s.patternSteps(pat), 32);
});

test('undo and redo restore snapshots', () => {
  const s = new Store();
  const before = s.project.channels.length;
  s.addChannel({ type: 'synth', name: 'Synth' });
  assert.equal(s.project.channels.length, before + 1);
  assert.ok(s.undo());
  assert.equal(s.project.channels.length, before);
  assert.ok(s.redo());
  assert.equal(s.project.channels.length, before + 1);
  assert.equal(s.undo() && s.undo(), false);
});

test('removing a pattern removes its clips', () => {
  const s = new Store();
  const second = s.addPattern('Second');
  s.addClip({ type: 'pattern', pat: second.id, track: 0, start: 0, len: 16 });
  s.addClip({ type: 'pattern', pat: s.project.patterns[0].id, track: 1, start: 0, len: 16 });
  assert.ok(s.removePattern(second.id));
  assert.equal(s.project.playlist.clips.length, 1);
});

test('mixer sends cannot create feedback loops', () => {
  const s = new Store();
  s.project.mixer[1].sends[2] = 0.8;
  s.project.mixer[2].sends[3] = 0.8;
  assert.equal(s.wouldCycle(3, 1), true);
  assert.equal(s.wouldCycle(1, 3), false);
  assert.equal(s.wouldCycle(2, 2), true);
});

test('projects survive a serialize/load round trip', () => {
  const s = new Store();
  s.addChannel({ type: 'sf', name: 'Piano', bank: 0, program: 0 });
  s.toggleStep(s.currentPattern, s.project.channels[0].id, 4, true);
  s.addClip({ type: 'pattern', pat: s.currentPattern.id, track: 2, start: 16, len: 16 });
  s.project.mixer[3].sends[5] = 0.5;
  const text = s.serialize();
  const copy = new Store();
  copy.load(text);
  assert.equal(JSON.stringify(copy.project), JSON.stringify(s.project));
});

test('loading rejects files that are not projects', () => {
  assert.throws(() => new Store().load('{"hello":1}'), /Not an OpenStudio project/);
});

test('loading a damaged or old project fills in defaults and keeps ids unique', () => {
  const s = new Store();
  s.load(JSON.stringify({
    channels: [{ id: 7, type: 'synth', name: 'Lead' }],
    patterns: [{ id: 2, name: 'P' }],
    playlist: { clips: [{ id: 9, pat: 2, track: 400, start: 0, len: 16 }, { id: 10, start: 0, len: 0 }] },
  }));
  const p = s.project;
  assert.equal(p.playlist.tracks.length, 125);
  assert.equal(p.playlist.clips.length, 1, 'zero-length clips are dropped');
  assert.equal(p.playlist.clips[0].track, 124);
  assert.equal(p.playlist.clips[0].type, 'pattern');
  assert.equal(p.channels[0].vol, 0.78);
  assert.ok(p.channels[0].params.cutoff > 0);
  assert.deepEqual(p.patterns[0].notes, {});
  assert.equal(p.selected.pattern, 2);
  assert.ok(s.uid() > 9, 'new ids never collide with loaded ones');
});

test('no-op checkpoints do not add undo steps', () => {
  const s = new Store();
  s.checkpoint();
  s.checkpoint();
  assert.equal(s.undoStack.length, 1);
});

test('undo history stays within its memory budget on big projects', () => {
  const store = new Store();
  const pat = store.currentPattern;
  const ch = store.project.channels[0].id;
  // ~4 MB snapshots
  pat.notes[ch] = Array.from({ length: 120000 }, (_, i) => ({ p: 60, s: i % 64, l: 1, v: 0.8 }));
  for (let k = 0; k < 60; k++) { store.checkpoint(); pat.notes[ch][0].v = k / 100; }
  const total = store.undoStack.reduce((a, x) => a + x.length, 0);
  assert.ok(total <= 96 * 1024 * 1024 + 5e6, String(total));
  assert.ok(store.undoStack.length >= 10 && store.undoStack.length < 60);
  assert.ok(store.undo());
});

test('load can take samples as raw buffers (autosave recovery)', () => {
  const store = new Store();
  const id = store.addSample('a.wav', new Uint8Array([1, 2, 3]).buffer);
  const text = store.snapshot();
  const data = store.samples.get(id).data;
  const other = new Store();
  other.load(text, null, { samples: [{ id, name: 'a.wav', data }] });
  assert.equal(other.samples.get(id).data, data);
  assert.ok(other.project.nextId > id);
});
