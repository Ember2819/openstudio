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
