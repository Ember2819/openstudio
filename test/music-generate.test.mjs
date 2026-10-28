import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, parseProgression, inScale, chordPcs } from '../src/agent/music/theory.js';
import { STYLES, STYLE_IDS, STRUCTURES, SECTION_ROLES, DEFAULT_STRUCTURE, MIX_ROLES, ROLES, namedProgression } from '../src/agent/music/styles.js';
import { generateDrums, generateBass, generateChords, generateArp, generateMelody, chordTimeline, parseHits, parseRhythm, chordAt } from '../src/agent/music/generate.js';
import { ENGINE_PRESETS, DRUM_VOICES } from '../src/audio/instruments.js';
import { SFX } from '../src/audio/sfx.js';

const ctxFor = (id, keyText, bars = 8) => {
  const style = STYLES[id];
  const key = parseKey(keyText ?? `A ${style.mode === 'major' ? 'major' : 'minor'}`);
  const chordKey = key.scale.length === 7 ? key : parseKey('A minor');
  const progression = parseProgression(namedProgression(style.progressions[0]), chordKey);
  return { style, key, progression, bars, timeline: chordTimeline(progression, bars, style.chordBars ?? 1) };
};

test('style data is consistent: patterns, rhythms, presets, structures', () => {
  for (const [id, s] of Object.entries(STYLES)) {
    assert.ok(s.bpm[0] <= s.bpm[1] && s.bpm[1] <= s.bpm[2], `${id}: bpm`);
    for (const [lane, cfg] of Object.entries(s.drums.lanes)) for (const pat of cfg.pats) assert.match(pat, /^[Xxmog.]{16}$/, `${id}/${lane}: ${pat}`);
    for (const b of s.bass.patterns) { const hits = parseHits(b); assert.ok(hits.length && hits.every((h) => h.s < 16), `${id}: bass ${b}`); }
    for (const r of s.chords.rhythms) assert.ok(parseRhythm(r).length, `${id}: rhythm ${r}`);
    for (const name of s.progressions) assert.ok(namedProgression(name), `${id}: progression ${name}`);
    assert.ok(STRUCTURES[DEFAULT_STRUCTURE[id]], `${id}: default structure`);
    for (const [role, cast] of Object.entries(s.cast)) {
      assert.ok(ROLES.includes(role), `${id}: role ${role}`);
      if (['synth', 'fm', 'organ', 'pluck', 'sfx'].includes(cast.kind)) assert.ok(Object.values(ENGINE_PRESETS[cast.kind]).flat().some((p) => p.name === cast.preset), `${id}: missing ${cast.kind} preset "${cast.preset}"`);
      if (cast.kind === 'drum') assert.ok(DRUM_VOICES.includes(cast.voice), `${id}: drum voice ${cast.voice}`);
    }
    assert.ok(s.cast.bass && s.cast.chords, `${id}: needs at least bass and chords`);
  }
  for (const s of Object.values(STRUCTURES)) for (const sec of s.sections) assert.ok(SECTION_ROLES[sec.kind], `section kind ${sec.kind}`);
  for (const role of ROLES) assert.ok(MIX_ROLES[role], `mix plan for ${role}`);
  for (const [name, def] of Object.entries(SFX)) assert.equal(typeof def.sustained, 'boolean', name);
});

test('drums: backbeat, downbeat kick, varied velocities, fills and determinism', () => {
  for (const id of STYLE_IDS) {
    const style = STYLES[id];
    if (!style.drums.lanes.kick) continue;
    const d = generateDrums({ style, bars: 8, seed: 3, energy: 0.9 });
    assert.ok(d.kick.some((n) => n.s % 16 === 0), `${id}: kick on beat 1`);
    const back = d.snare ?? d.clap;
    assert.ok(back?.length >= 6, `${id}: has a backbeat`);
    for (const lane of ['hat', 'openhat']) if (d[lane]) {
      const vs = new Set(d[lane].map((n) => n.v.toFixed(2)));
      assert.ok(vs.size > 2, `${id}: ${lane} velocities vary`);
    }
    for (const list of Object.values(d)) for (const n of list) assert.ok(n.v > 0 && n.v <= 1 && n.s >= 0 && n.s < 128, `${id}: note ${JSON.stringify(n)}`);
    assert.deepEqual(generateDrums({ style, bars: 8, seed: 3, energy: 0.9 }), d, `${id}: same seed, same drums`);
    assert.notDeepEqual(generateDrums({ style, bars: 8, seed: 4, energy: 0.9, variation: 0.9 }), d, `${id}: new seed, new drums`);
  }
});

test('drums: low energy thins the groove and a fill ends the phrase', () => {
  const style = STYLES.pop;
  const quiet = generateDrums({ style, bars: 8, seed: 1, energy: 0.3 });
  const loud = generateDrums({ style, bars: 8, seed: 1, energy: 1 });
  assert.ok(Object.keys(quiet).length < Object.keys(loud).length);
  assert.ok(loud.crash?.some((n) => n.s === 0), 'crash on the first beat of the phrase');
  const lastBeat = (loud.snare ?? []).filter((n) => n.s >= 3 * 16 + 12 && n.s < 4 * 16);
  assert.ok(lastBeat.length >= 2, `a snare fill on the last beat of bar 4, got ${lastBeat.length}`);
  assert.ok(generateDrums({ style, bars: 8, energy: 1, fills: false }).snare.length < loud.snare.length);
});

test('bass follows the chord roots, stays low, and never overlaps itself', () => {
  for (const id of STYLE_IDS) {
    const { style, timeline, bars } = ctxFor(id);
    const bass = generateBass({ style, timeline, bars, seed: 2 });
    assert.ok(bass.length >= bars, `${id}: bass has notes`);
    const [lo, hi] = style.bass.range;
    let onRoot = 0, checked = 0;
    for (const n of bass) {
      assert.ok(n.p >= lo - 2 && n.p <= hi + 13, `${id}: ${n.p} outside the bass register`);
      const chord = chordAt(timeline, n.s);
      if (n.s % 16 === 0) { checked++; if (n.p % 12 === (chord.bass ?? chord.root)) onRoot++; }
    }
    assert.equal(onRoot, checked, `${id}: the first note of every bar is the chord root`);
    const sorted = [...bass].sort((a, b) => a.s - b.s);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].p === sorted[i - 1].p) assert.ok(sorted[i - 1].s + sorted[i - 1].l <= sorted[i].s + 0.01, `${id}: overlapping same-pitch notes`);
  }
});

test('chords: chord tones only, smooth, inside their range, pads sustain', () => {
  for (const id of STYLE_IDS) {
    const { style, timeline, bars } = ctxFor(id);
    const chords = generateChords({ style, timeline, bars, seed: 2 });
    const pad = generateChords({ style, timeline, bars, seed: 2, role: 'pad' });
    assert.ok(chords.length > 0 && pad.length > 0, id);
    for (const n of chords) {
      assert.ok(chordPcs(chordAt(timeline, n.s + 0.01)).includes(n.p % 12) || style.chords.power, `${id}: ${n.p} at ${n.s} is not a chord tone`);
      assert.ok(n.p >= style.chords.range[0] - 1 && n.p <= style.chords.range[1] + 12, `${id}: chord note ${n.p} out of range`);
    }
    const first = Math.min(...pad.map((n) => n.l));
    assert.ok(first >= 8 || style.chordBars, `${id}: pad notes are long`);
  }
});

test('arps stay on chord tones; melodies stay in key, in range, resolve and are repeatable', () => {
  for (const id of STYLE_IDS) {
    const { style, key, timeline, bars } = ctxFor(id);
    const arp = generateArp({ style, timeline, bars, seed: 5 });
    for (const n of arp) assert.ok(chordPcs(chordAt(timeline, n.s + 0.01)).includes(n.p % 12), `${id}: arp note ${n.p} is not in the chord`);
    for (let seed = 1; seed <= 6; seed++) {
      const mel = generateMelody({ style, key, timeline, bars, seed });
      assert.ok(mel.length >= 8, `${id}/${seed}: a melody`);
      const [lo, hi] = style.lead.range;
      // in the key, or a chord tone of the chord underneath (the leading tone over a major V is fine)
      for (const n of mel) assert.ok((inScale(key, n.p) || chordPcs(chordAt(timeline, n.s)).includes(n.p % 12)) && n.p >= lo && n.p <= hi, `${id}/${seed}: ${n.p} at ${n.s}`);
      const outside = mel.filter((n) => !inScale(key, n.p)).length;
      assert.ok(outside <= mel.length * 0.2, `${id}/${seed}: ${outside} notes outside the key`);
      const repeats = mel.slice(1).filter((n, i) => n.p === mel[i].p).length / mel.length;
      assert.ok(repeats < 0.25, `${id}/${seed}: ${Math.round(repeats * 100)}% repeated notes`);
      const leaps = mel.slice(1).filter((n, i) => Math.abs(n.p - mel[i].p) > 9).length;
      assert.ok(leaps <= Math.max(2, mel.length * 0.12), `${id}/${seed}: ${leaps} big leaps`);
      // every phrase ends on a chord tone of the chord that is playing
      const lastOfPhrase = mel.filter((n) => n.s < 64 && n.s >= 32).pop();
      assert.ok(chordPcs(chordAt(timeline, lastOfPhrase.s)).includes(lastOfPhrase.p % 12), `${id}/${seed}: phrase ends off the chord`);
      for (let i = 1; i < mel.length; i++) assert.ok(mel[i - 1].s + mel[i - 1].l <= mel[i].s + 0.01, `${id}/${seed}: overlapping melody notes`);
    }
    assert.deepEqual(generateMelody({ style, key, timeline, bars, seed: 9 }), generateMelody({ style, key, timeline, bars, seed: 9 }));
    assert.notDeepEqual(generateMelody({ style, key, timeline, bars, seed: 9 }), generateMelody({ style, key, timeline, bars, seed: 10 }));
  }
});

test('melody density changes how busy it is', () => {
  const { style, key, timeline } = ctxFor('pop', 'C major', 8);
  const count = (density) => generateMelody({ style, key, timeline, bars: 8, seed: 3, density }).length;
  assert.ok(count(0.1) < count(0.5) && count(0.5) < count(0.95));
});

test('chord timeline repeats the progression and respects bar lengths', () => {
  const k = parseKey('C major');
  const tl = chordTimeline(parseProgression('C:2 G', k), 6);
  assert.deepEqual(tl.map((s) => [s.chord.name, s.start, s.len]), [['C', 0, 32], ['G', 32, 16], ['C', 48, 32], ['G', 80, 16]]);
  assert.deepEqual(chordTimeline(parseProgression('C', k), 1).map((s) => s.len), [16]);
});
