// The producer tools through the real tool layer (stub audio engine): setup, compose, build, arrange, analyse, mix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, callFails } from './agent-fixture.mjs';
import { flattenSong } from '../src/agent/music/critique.js';
import { STYLE_IDS, STRUCTURES } from '../src/agent/music/styles.js';

const channelsByRole = (app) => Object.fromEntries(app.store.project.channels.map((c) => [c.role, c]));

test('music_theory: keys, progressions, chords, styles, structures, registers', async () => {
  const app = makeApp();
  const key = await call(app, 'music_theory', { kind: 'key', key: 'A minor' });
  assert.deepEqual(key.scaleNotes, ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.deepEqual(key.chords.map((c) => c.chord), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
  assert.equal(key.relative, 'C major');
  const progs = await call(app, 'music_theory', { kind: 'progressions', key: 'A minor', mood: 'minor' });
  assert.equal(progs.progressions.find((p) => p.name === 'epic').inKey, 'Am F C G');
  const chord = await call(app, 'music_theory', { kind: 'chord', chord: 'i VI III VII', key: 'A minor' });
  assert.equal(chord.chords.length, 4);
  assert.ok(chord.chords.every((c) => c.voicing.every((p) => p >= 48 && p <= 76)));
  const styles = await call(app, 'music_theory', { kind: 'styles' });
  assert.deepEqual(styles.styles.map((s) => s.id).sort(), [...STYLE_IDS].sort());
  assert.ok((await call(app, 'music_theory', { kind: 'styles', style: 'trap' })).styles[0].bpm.typical === 140);
  const forms = await call(app, 'music_theory', { kind: 'structures' });
  assert.deepEqual(forms.structures.map((s) => s.id), Object.keys(STRUCTURES));
  assert.ok((await call(app, 'music_theory', { kind: 'registers' })).registers.length >= 5);
  assert.match(await callFails(app, 'music_theory', { kind: 'key' }), /needs key/);
  assert.match(await callFails(app, 'music_theory', { kind: 'key', key: 'Q# major' }), /not a key/);
});

test('songwriting_guide serves every topic', async () => {
  const app = makeApp();
  for (const topic of ['workflow', 'harmony', 'melody', 'rhythm', 'arrangement', 'sound', 'mixing', 'checklist']) {
    const g = await call(app, 'songwriting_guide', { topic });
    assert.match(g.guide, /^# /, topic);
  }
  assert.ok((await call(app, 'songwriting_guide', { topic: 'all' })).guide.length > 4000);
  assert.match((await call(app, 'songwriting_guide')).guide, /setup_song/);
});

test('setup_song builds a style-appropriate band with routing, buses and a master chain', async () => {
  const app = makeApp();
  const r = await call(app, 'setup_song', { style: 'house', key: 'F minor', name: 'Night Drive' });
  const p = app.store.project;
  assert.equal(p.name, 'Night Drive');
  assert.equal(p.bpm, 124);
  assert.deepEqual(r.chords, ['Fm', 'Eb', 'Db', 'Eb']);
  assert.deepEqual(p.song, { style: 'house', key: 'F minor', progression: 'i VII VI VII', bpmSet: true });
  const roles = r.channels.map((c) => c.role);
  for (const role of ['kick', 'clap', 'hat', 'bass', 'chords', 'pad', 'arp', 'lead', 'fx']) assert.ok(roles.includes(role), role);
  assert.equal(p.channels.length, r.channels.length);
  // every channel on its own insert, none on the master
  assert.equal(new Set(p.channels.map((c) => c.mixer)).size, p.channels.length);
  assert.ok(p.channels.every((c) => c.mixer > 0));
  // buses
  const reverb = p.mixer.findIndex((m) => m.bus === 'reverb');
  const delay = p.mixer.findIndex((m) => m.bus === 'delay');
  assert.ok(reverb > 0 && delay > 0);
  assert.equal(p.mixer[reverb].fx[0].type, 'reverb');
  assert.equal(p.mixer[delay].fx[0].type, 'delay');
  assert.equal(p.mixer[delay].fx[0].params.time, Math.round((60000 / 124) * 0.75), 'delay is dotted-eighth in time with the tempo');
  assert.equal(p.mixer[reverb].fx[0].params.mix, 1);
  const bass = channelsByRole(app).bass;
  assert.equal(p.mixer[bass.mixer].sends[reverb] ?? 0, 0, 'no reverb on the bass');
  const lead = channelsByRole(app).lead;
  assert.ok(p.mixer[lead.mixer].sends[reverb] > 0 && p.mixer[lead.mixer].sends[delay] > 0);
  assert.deepEqual(p.mixer[0].fx.filter(Boolean).map((s) => s.type), ['compressor', 'limiter']);
  assert.ok(p.mixer[0].fx.filter(Boolean).every((s) => s.auto));
  // a high-pass on the chords but not on the kick or the bass
  assert.ok(p.mixer[channelsByRole(app).chords.mixer].fx.some((s) => s?.type === 'filter' && s.params.mode === 'highpass'));
  assert.ok(!p.mixer[bass.mixer].fx.some((s) => s?.type === 'filter'));
});

test('setup_song protects existing work and accepts instrument overrides', async () => {
  const app = makeApp();
  await call(app, 'set_notes', { channel: 'Kick', notes: [{ pitch: 60, start: 0, length: 1 }] });
  assert.match(await callFails(app, 'setup_song', { style: 'pop' }), /clear: true/);
  const r = await call(app, 'setup_song', { style: 'pop', clear: true, instruments: { bass: 'Slap Bass 1', lead: 'Glass Lead' } });
  assert.equal(app.store.project.channels.find((c) => c.role === 'lead').name, 'Glass Lead');
  assert.equal(app.store.project.channels.find((c) => c.role === 'lead').type, 'synth');
  assert.match(await callFails(app, 'setup_song', { style: 'pop', clear: true, instruments: { guitar: 'x' } }), /not a role/);
  assert.match(await callFails(app, 'setup_song', { style: 'pop', clear: true, instruments: { bass: 'Unobtainium' } }), /No instrument matches|not a synth/);
  assert.ok(r.channels.length >= 8);
});

test('setup_song is one undo step', async () => {
  const app = makeApp();
  const before = app.store.project.channels.length;
  await call(app, 'setup_song', { style: 'techno' });
  assert.ok(app.store.project.channels.length > before);
  await call(app, 'history', { action: 'undo' });
  assert.equal(app.store.project.channels.length, before);
  assert.equal(app.store.project.song, undefined);
});

test('compose writes in-key, in-range, humanized parts that fit the pattern', async () => {
  const app = makeApp();
  await call(app, 'setup_song', { style: 'pop', key: 'C major' });
  const ch = channelsByRole(app);
  const r = await call(app, 'compose', { bars: 4, seed: 5, parts: [{ channel: ch.kick.id }, { channel: ch.snare.id }, { channel: ch.hat.id }, { channel: ch.bass.id }, { channel: ch.chords.id }, { channel: ch.lead.id }] });
  assert.deepEqual(r.chords, ['C', 'G', 'Am', 'F']);
  assert.equal(r.bars, 4);
  assert.equal(r.parts.length, 6);
  const pat = app.store.currentPattern;
  assert.equal(app.store.patternSteps(pat), 64, 'no note overruns the pattern');
  assert.ok(pat.notes[ch.kick.id].length >= 8 && pat.notes[ch.bass.id].length >= 8);
  const vels = new Set(pat.notes[ch.hat.id].map((n) => n.v));
  assert.ok(vels.size > 4, 'hat velocities vary');
  assert.ok(pat.notes[ch.lead.id].every((n) => n.p >= 60 && n.p <= 96));
  // deterministic
  const first = JSON.stringify(pat.notes);
  await call(app, 'compose', { bars: 4, seed: 5, parts: [{ channel: ch.kick.id }, { channel: ch.snare.id }, { channel: ch.hat.id }, { channel: ch.bass.id }, { channel: ch.chords.id }, { channel: ch.lead.id }] });
  assert.equal(JSON.stringify(app.store.currentPattern.notes), first);
  await call(app, 'compose', { bars: 4, seed: 6, parts: [{ channel: ch.lead.id }] });
  assert.notEqual(JSON.stringify(app.store.currentPattern.notes[ch.lead.id]), JSON.stringify(JSON.parse(first)[ch.lead.id]));
  // errors
  assert.match(await callFails(app, 'compose', { progression: 'I V ?', parts: [{ channel: ch.bass.id }] }), /Progression/);
  assert.match(await callFails(app, 'compose', { parts: [{ channel: ch.bass.id, role: 'fx' }] }), /Sound FX channel/);
});

test('compose uses a drum kit channel for every lane and respects a chosen progression', async () => {
  const app = makeApp();
  const kit = await call(app, 'add_channel', { type: 'drum_kit', kit: 'Standard' });
  const bass = await call(app, 'add_channel', { type: 'instrument', instrument: 'Fingered Bass' });
  const r = await call(app, 'compose', { key: 'A minor', style: 'rock', progression: 'Am F C G7', bars: 4, parts: [{ channel: kit.id }, { channel: bass.id }] });
  assert.deepEqual(r.chords, ['Am', 'F', 'C', 'G7']);
  const notes = app.store.currentPattern.notes[kit.id];
  const keys = new Set(notes.map((n) => n.p));
  assert.ok(keys.has(36) && keys.has(38), 'kick and snare keys of the kit');
  const bassNotes = app.store.currentPattern.notes[bass.id];
  const downbeats = bassNotes.filter((n) => Math.abs(n.s - Math.round(n.s / 16) * 16) < 0.3 && n.s - Math.floor(n.s / 16) * 16 < 0.3 || 16 - (n.s % 16) < 0.3);
  assert.deepEqual([...new Set(downbeats.map((n) => n.p % 12))].sort((a, b) => a - b), [0, 5, 7, 9], 'bass roots C F G A on the downbeats');
});

test('build_song writes a complete arrangement on named tracks and switches to song mode', async () => {
  const app = makeApp();
  await call(app, 'setup_song', { style: 'house' });
  const r = await call(app, 'build_song', { seed: 3 });
  const p = app.store.project;
  assert.equal(p.mode, 'song');
  assert.equal(r.bars, 72);
  assert.deepEqual(r.sections.map((s) => s.name), ['Intro', 'Build', 'Drop 1', 'Breakdown', 'Build 2', 'Drop 2', 'Outro']);
  assert.equal(app.store.playlistEndStep(), 72 * 16);
  // energy builds: the drop has more instruments than the intro and the breakdown
  const plays = (name) => r.sections.find((s) => s.name === name).plays.length;
  assert.ok(plays('Drop 1') > plays('Intro') && plays('Drop 1') > plays('Breakdown'));
  // reuse: both drops share patterns, so editing one edits both
  const drumClips = p.playlist.clips.filter((c) => c.track === 0);
  const dropPatterns = drumClips.filter((c) => c.start >= 16 * 16 && c.len === 16 * 16).map((c) => c.pat);
  assert.equal(new Set(dropPatterns).size, 1);
  assert.equal(p.playlist.tracks[0].name, 'Drums');
  assert.ok(p.playlist.tracks.some((t) => t.name === 'Lead'));
  // every pattern is exactly as long as intended
  assert.ok(p.patterns.every((pat) => app.store.patternSteps(pat) === pat.bars * 16));
  // risers and impacts exist for the transitions
  assert.ok(p.patterns.some((pat) => /Riser/.test(pat.name)) && p.patterns.some((pat) => /Impact/.test(pat.name)));
  // the untouched empty starter pattern is gone
  assert.ok(!p.patterns.some((pat) => pat.name === 'Pattern 1'));
  // guard and replace
  assert.match(await callFails(app, 'build_song', {}), /clear: true/);
  const again = await call(app, 'build_song', { clear: true, seed: 3, structure: 'short' });
  assert.equal(again.bars, 24);
  assert.equal(app.store.playlistEndStep(), 24 * 16);
});

test('build_song accepts a custom structure and respects the style tempo rules', async () => {
  const app = makeApp();
  await call(app, 'setup_song', { style: 'lofi', bpm: 70 });
  const r = await call(app, 'build_song', { structure: [{ name: 'Wake', bars: 4, energy: 0.3, kind: 'intro' }, { name: 'Groove', bars: 8, energy: 0.8, kind: 'chorus', impact: true }] });
  assert.equal(r.bpm, 70, 'a tempo chosen in setup_song survives');
  assert.deepEqual(r.sections.map((s) => s.bars), ['1-4', '5-12']);
  assert.ok(app.store.project.swing > 0.2, 'lo-fi swings');
  assert.match(await callFails(app, 'build_song', { clear: true, structure: 'nope' }), /Unknown structure/);
  assert.match(await callFails(makeApp(), 'build_song', { style: 'pop' }), /key/);
});

test('every style builds, analyses cleanly and stays in key', async () => {
  for (const style of STYLE_IDS) {
    const app = makeApp();
    await call(app, 'setup_song', { style });
    await call(app, 'build_song', {});
    const a = await call(app, 'analyze_song');
    assert.ok(a.key.notesInKey >= 0.9, `${style}: ${a.key.notesInKey}`);
    assert.ok(a.harmony.bassFollowsChords >= 0.9, `${style}: bass follows chords ${a.harmony.bassFollowsChords}`);
    const bad = a.warnings.filter((w) => w.severity === 'warning');
    assert.deepEqual(bad, [], `${style} should analyse clean`);
    const { notes } = flattenSong(app.store);
    assert.ok([...notes.values()].every((l) => l.length > 0), `${style}: every channel plays something`);
  }
});

test('arrange lays patterns out section by section', async () => {
  const app = makeApp();
  const a = await call(app, 'add_pattern', { name: 'A', bars: 2 });
  const b = await call(app, 'add_pattern', { name: 'B', bars: 4 });
  const r = await call(app, 'arrange', { sections: [
    { name: 'Intro', bars: 2, clips: [{ pattern: a.id, track: 0 }] },
    { name: 'Main', bars: 8, clips: [{ pattern: b.id }, { pattern: a.id, at: 4 }] },
  ] });
  assert.equal(r.totalBars, 10);
  assert.deepEqual(r.clips.map((c) => [c.pattern, c.startBar, c.bars, c.track]), [['A', 1, 2, 0], ['B', 3, 8, 0], ['A', 7, 4, 1]]);
  assert.equal(app.store.project.mode, 'song');
  // extending appends after the end
  const more = await call(app, 'arrange', { sections: [{ bars: 4, clips: [{ pattern: a.id, track: 2 }] }] });
  assert.equal(more.clips[0].startBar, 11);
  assert.match(await callFails(app, 'arrange', { sections: [{ bars: 2, clips: [{ pattern: 'Nope' }] }] }), /No pattern named/);
});

test('auto_mix applies a role-based mix, re-running replaces instead of stacking', async () => {
  const app = makeApp();
  await call(app, 'setup_song', { style: 'pop', mix: false });
  assert.equal(app.store.project.mixer[0].fx.filter(Boolean).length, 0);
  const r = await call(app, 'auto_mix', { calibrate: false });
  assert.equal(r.calibrated, false);
  const p = app.store.project;
  const count = () => p.mixer.reduce((n, m) => n + m.fx.filter(Boolean).length, 0);
  const total = count();
  assert.ok(total > 10);
  await call(app, 'auto_mix', { calibrate: false });
  assert.equal(count(), total, 'effects are replaced, not stacked');
  // the user's own effect on a track survives
  const bass = channelsByRole(app).bass;
  await call(app, 'set_effect', { track: bass.mixer, type: 'distortion' });
  await call(app, 'auto_mix', { calibrate: false });
  assert.ok(p.mixer[bass.mixer].fx.some((s) => s?.type === 'distortion' && !s.auto));
  // hats and perc pan to opposite sides when there are two of a role
  assert.ok(p.mixer[channelsByRole(app).hat.mixer].pan > 0);
  // calibrating an empty project explains itself instead of failing
  const empty = await call(app, 'auto_mix', {});
  assert.equal(empty.calibrated, false);
  assert.match(empty.note, /Nothing to render/);
});

test('channels: new engines, roles and presets through add_channel / update_channel', async () => {
  const app = makeApp();
  for (const args of [{ type: 'fm', preset: 'FM E-Piano' }, { type: 'organ', preset: 'Jazz Organ' }, { type: 'pluck', preset: 'Harp' }, { type: 'sfx', preset: 'Riser', role: 'fx' }, { type: 'synth', preset: 'Reese Bass' }, { type: 'drum', voice: 'kick808' }]) {
    const { type, preset } = args;
    const ch = await call(app, 'add_channel', args);
    assert.equal(ch.type, type);
    if (preset) assert.equal(ch.name, preset);
  }
  const organ = app.store.project.channels.find((c) => c.type === 'organ');
  assert.equal(organ.params.d16, 8);
  assert.equal(organ.params.perc, '3rd');
  await call(app, 'update_channel', { channel: organ.id, preset: 'Church', role: 'chords' });
  assert.equal(app.store.channel(organ.id).params.perc, 'off');
  assert.equal(app.store.channel(organ.id).role, 'chords');
  await call(app, 'update_channel', { channel: organ.id, params: { d8: 5, rotor: 'fast' } });
  assert.match(await callFails(app, 'update_channel', { channel: organ.id, params: { d8: 9 } }), /between 0 and 8/);
  assert.match(await callFails(app, 'update_channel', { channel: 'Kick', preset: 'Riser' }), /Only synth, fm/);
  assert.match(await callFails(app, 'add_channel', { type: 'fm', preset: 'No such preset' }), /No fm preset/);
  const presets = await call(app, 'list_catalog', { kind: 'synth_presets', query: 'bass' });
  assert.ok(presets.presets.some((p) => p.engine === 'synth' && p.name === 'Reese Bass') && presets.presets.some((p) => p.engine === 'fm' && p.name === 'FM Bass'));
  const params = await call(app, 'list_catalog', { kind: 'channel_params' });
  for (const t of ['synth', 'fm', 'organ', 'pluck', 'sfx', 'drum', 'sampler', 'sf']) assert.ok(params[t]?.length, t);
  assert.ok((await call(app, 'list_catalog', { kind: 'drum_voices' })).voices.length >= 25);
});
