import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, parseChord, parseProgression, diatonicChords, voiceChord, rng, scaleStep, snapToScale, inScale, pcName } from '../src/agent/music/theory.js';
import { detectKey, nameChord } from '../src/agent/music/critique.js';

test('keys: names, modes and spelling', () => {
  assert.equal(parseKey('A minor').name, 'A minor');
  assert.equal(parseKey('Am').mode, 'minor');
  assert.equal(parseKey('Bb').name, 'Bb major');
  assert.equal(parseKey('F# dorian').root, 6);
  assert.deepEqual(parseKey('C major pentatonic').scale, [0, 2, 4, 7, 9]);
  assert.throws(() => parseKey('H minor'), /not a key/);
  assert.throws(() => parseKey('C wobbly'), /Unknown mode/);
  assert.equal(pcName(10, true), 'Bb');
});

test('roman numerals follow the scale of the key', () => {
  const am = parseKey('A minor');
  assert.deepEqual(parseProgression('i VI III VII', am).map((c) => c.name), ['Am', 'F', 'C', 'G']);
  assert.deepEqual(parseProgression('i iv v', am).map((c) => c.name), ['Am', 'Dm', 'Em']);
  const c = parseKey('C major');
  assert.deepEqual(parseProgression('I V vi IV', c).map((x) => x.name), ['C', 'G', 'Am', 'F']);
  assert.deepEqual(parseProgression('I bVII IV I', c).map((x) => x.name), ['C', 'Bb', 'F', 'C']);
  assert.equal(parseChord('V7', c).quality, '7');
  assert.equal(parseChord('ii7', c).quality, 'm7');
  assert.equal(parseChord('vii°', c).quality, 'dim');
  assert.equal(parseChord('Imaj7', c).quality, 'maj7');
  assert.throws(() => parseChord('V13', c), /Unknown chord ending/);
});

test('chord names, slash chords and bar lengths', () => {
  const k = parseKey('C major');
  const chords = parseProgression('Am:2 F G7 Dm7/F', k);
  assert.deepEqual(chords.map((x) => [x.name, x.bars]), [['Am', 2], ['F', 1], ['G7', 1], ['Dm7', 1]]);
  assert.equal(chords[3].bass, 5);
  assert.deepEqual(parseChord('Bbmaj7', k).intervals, [0, 4, 7, 11]);
  assert.throws(() => parseChord('???', k), /not a chord/);
  assert.throws(() => parseProgression('', k), /empty/);
});

test('diatonic chords of major and minor', () => {
  assert.deepEqual(diatonicChords(parseKey('C major')).map((c) => c.name), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(diatonicChords(parseKey('A minor')).map((c) => c.name), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  assert.deepEqual(diatonicChords(parseKey('C major'), true).map((c) => c.name).slice(0, 2), ['Cmaj7', 'Dm7']);
});

test('voicings stay close together and inside the range', () => {
  const k = parseKey('A minor');
  let prev = null;
  let travel = 0;
  for (const c of parseProgression('i VI III VII i VI iv V', k)) {
    const v = voiceChord(c, prev, { lo: 48, hi: 76 });
    assert.ok(v.every((p) => p >= 48 && p <= 76), `${c.name} ${v}`);
    assert.deepEqual([...v].sort((a, b) => a - b), v);
    const pcs = new Set(v.map((p) => p % 12));
    for (const pc of pcs) assert.ok(c.intervals.some((i) => (c.root + i) % 12 === pc), `${c.name}: ${pc} is not a chord tone`);
    if (prev) travel += v.reduce((s, p, i) => s + Math.abs(p - (prev[i] ?? p)), 0) / v.length;
    prev = v;
  }
  assert.ok(travel / 7 < 4, `voices jump ${(travel / 7).toFixed(1)} semitones per chord on average`);
});

test('scales: stepping, snapping, membership', () => {
  const c = parseKey('C major');
  assert.equal(scaleStep(c, 60, 1), 62);
  assert.equal(scaleStep(c, 64, 1), 65);
  assert.equal(scaleStep(c, 71, 1), 72);
  assert.equal(scaleStep(c, 60, -1), 59);
  assert.equal(scaleStep(c, 61, 1), null);
  assert.equal(snapToScale(c, 61), 62);
  assert.ok(inScale(c, 67) && !inScale(c, 66));
});

test('the random generator is deterministic per seed', () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const xs = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => c.next()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('key detection and chord naming from note content', () => {
  const hist = new Array(12).fill(0);
  [0, 2, 4, 5, 7, 9, 11].forEach((pc, i) => { hist[pc] = [3, 1, 2, 2, 3, 2, 1][i]; });
  assert.equal(detectKey(hist).name, 'C major');
  const am = new Array(12).fill(0);
  [9, 0, 4].forEach((pc) => { am[pc] = 4; });
  assert.equal(nameChord(am), 'Am');
  const g7 = new Array(12).fill(0);
  [7, 11, 2, 5].forEach((pc) => { g7[pc] = 4; });
  assert.equal(nameChord(g7), 'G7');
  assert.equal(nameChord(new Array(12).fill(0)), null);
});
