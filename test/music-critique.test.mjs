import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { critique, flattenSong } from '../src/agent/music/critique.js';
import { roleOf } from '../src/agent/music/roles.js';
import { makeApp, call } from './agent-fixture.mjs';

const bar = (n) => n * 16;
function project(build) {
  const store = new Store();
  for (const c of [...store.project.channels]) store.removeChannel(c.id);
  build(store);
  return store;
}
const addSynth = (store, name, role) => { const ch = store._addChannel({ name, type: 'synth' }); ch.role = role; return ch; };
const put = (store, ch, notes, pat = store.currentPattern) => { pat.notes[ch.id] = notes; store.normalizePattern(pat); };

test('roles are guessed from instrument and name, and an explicit role wins', () => {
  assert.equal(roleOf({ type: 'sf', bank: 128, fixedKey: 36 }), 'kick');
  assert.equal(roleOf({ type: 'sf', bank: 128, fixedKey: 42 }), 'hat');
  assert.equal(roleOf({ type: 'sf', bank: 128, fixedKey: null }), 'drums');
  assert.equal(roleOf({ type: 'drum', voice: 'snare808' }), 'snare');
  assert.equal(roleOf({ type: 'sf', bank: 0, program: 33, name: 'Finger Bass' }), 'bass');
  assert.equal(roleOf({ type: 'sf', bank: 0, program: 89, name: 'Warm Pad' }), 'pad');
  assert.equal(roleOf({ type: 'sf', bank: 0, program: 73, name: 'Flute' }), 'lead');
  assert.equal(roleOf({ type: 'synth', name: 'Reese Bass' }), 'bass');
  assert.equal(roleOf({ type: 'sfx', name: 'Riser' }), 'fx');
  assert.equal(roleOf({ type: 'synth', name: 'Reese Bass', role: 'lead' }), 'lead');
});

test('the critic flags mechanical velocities, out-of-key notes, registers and empty channels', () => {
  const store = project((s) => {
    const bass = addSynth(s, 'Bass', 'bass');
    const keys = addSynth(s, 'Keys', 'chords');
    const lead = addSynth(s, 'Lead', 'lead');
    addSynth(s, 'Unused', 'arp');
    const pat = s.currentPattern;
    pat.bars = 4;
    // bass far too high, all the same velocity
    put(s, bass, Array.from({ length: 16 }, (_, i) => ({ p: 60 + (i % 3), s: i * 4, l: 2, v: 0.8 })), pat);
    // chords muddy in the bass octave
    put(s, keys, [0, 1, 2, 3].flatMap((b) => [36, 40, 43].map((p) => ({ p, s: bar(b), l: 2, v: 0.5 + b * 0.1 }))), pat);
    // a C major melody with a third of its notes wrong
    put(s, lead, [72, 61, 76, 63, 79, 61, 63, 66, 72, 74, 66, 77].map((p, i) => ({ p, s: i * 4, l: 4, v: 0.6 + (i % 4) * 0.1 })), pat);
  });
  const r = critique(store, 120, { key: 'C major' });
  const text = r.warnings.map((w) => `${w.area}: ${w.message}`).join('\n');
  assert.match(text, /almost identical velocities/);
  assert.match(text, /Bass "Bass" never goes below/);
  assert.match(text, /muddy the bass/);
  assert.match(text, /outside C major/);
  assert.match(text, /"Unused" has no notes/);
  assert.ok(r.warnings.every((w) => w.severity && w.area && w.message));
  assert.ok(r.warnings.filter((w) => w.severity === 'warning').every((w) => w.fix), 'every warning says what to do');
  assert.equal(r.key.used, 'C major');
});

test('a short, flat loop is called out as a song', async () => {
  const app = makeApp();
  await call(app, 'setup_song', { style: 'pop' });
  await call(app, 'build_song', { structure: 'loop' });
  const r = await call(app, 'analyze_song');
  assert.ok(r.warnings.some((w) => w.area === 'structure' && /bars/.test(w.message)));
});

test('flattenSong lays clips out in time, honouring offsets, mutes and loops', () => {
  const store = project((s) => {
    const ch = addSynth(s, 'Lead', 'lead');
    const pat = s.currentPattern;
    pat.bars = 1;
    put(s, ch, [{ p: 60, s: 0, l: 1, v: 0.8 }, { p: 62, s: 8, l: 1, v: 0.8 }], pat);
    s.addClip({ type: 'pattern', pat: pat.id, track: 0, start: 16, len: 32 });
    s.addClip({ type: 'pattern', pat: pat.id, track: 1, start: 64, len: 16, mute: true });
    s.project.mode = 'song';
  });
  const { notes, steps } = flattenSong(store);
  const ch = store.project.channels[0];
  assert.deepEqual(notes.get(ch.id).map((n) => [n.p, n.s]), [[60, 16], [62, 24], [60, 32], [62, 40]]);
  assert.equal(steps, 48);
});
