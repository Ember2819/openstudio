import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, callFails } from './agent-fixture.mjs';

const ids = (app) => Object.fromEntries(app.store.project.channels.map((c) => [c.name, c.id]));

test('get_project describes the default project', async () => {
  const app = makeApp();
  const p = await call(app, 'get_project');
  assert.equal(p.bpm, 130);
  assert.deepEqual(p.channels.map((c) => c.name), ['Kick', 'Clap', 'Hat', 'Snare']);
  assert.equal(p.patterns.length, 1);
  assert.equal(p.channels[0].type, 'sf');
  assert.ok(p.mixer.some((m) => m.track === 0));
  assert.equal(p.transport.playing, false);
});

test('invalid arguments come back as readable errors', async () => {
  const app = makeApp();
  assert.match(await callFails(app, 'set_project', { bpm: 9000 }), /at most 522/);
  assert.match(await callFails(app, 'set_project', { tempo: 120 }), /unknown field "tempo"/);
  assert.match(await callFails(app, 'nope'), /Unknown tool/);
  assert.match(await callFails(app, 'update_channel', { channel: 'Banjo' }), /No channel named "Banjo"/);
});

test('set_project changes tempo, mode, loop and keeps it on the undo stack', async () => {
  const app = makeApp();
  await call(app, 'set_project', { bpm: 98, swing: 0.2, mode: 'song', loop: { start: 0, end: 32 }, loopEnabled: true, metronome: true, name: 'Night drive' });
  const p = app.store.project;
  assert.deepEqual([p.bpm, p.swing, p.mode, p.name], [98, 0.2, 'song', 'Night drive']);
  assert.deepEqual(p.loop, { start: 0, end: 32 });
  assert.ok(app.transport.loopEnabled && app.transport.metronome);
  await call(app, 'history', { action: 'undo' });
  assert.equal(app.store.project.bpm, 130);
  assert.match(await callFails(app, 'set_project', { loop: { start: 8, end: 8 } }), /greater than/);
});

test('set_notes / add_notes / get_pattern use steps and note names', async () => {
  const app = makeApp();
  const bass = await call(app, 'add_channel', { type: 'instrument', instrument: 'Fingered Bass' });
  assert.equal(bass.program, 33);
  await call(app, 'set_notes', { channel: bass.id, notes: [{ pitch: 'C4', start: 0, length: 2 }, { pitch: 'G4', start: 4, length: 2, velocity: 0.5 }] });
  await call(app, 'add_notes', { channel: 'Fingered Bass', notes: [{ pitch: 55, start: 20, length: 1 }] });
  const pat = await call(app, 'get_pattern', { channel: bass.id });
  assert.equal(pat.bars, 2, 'pattern grows to fit a note at step 20');
  assert.deepEqual(pat.channels[0].notes.map((n) => [n.name, n.start, n.length, n.velocity]), [['C4', 0, 2, 0.78], ['G4', 4, 2, 0.5], ['G4', 20, 1, 0.78]]);
  // replacing wipes the old notes
  await call(app, 'set_notes', { channel: bass.id, notes: [] });
  assert.equal((await call(app, 'get_pattern', { channel: bass.id })).channels[0].notes.length, 0);
});

test('set_notes with parts writes several channels in one undo step', async () => {
  const app = makeApp();
  const { Kick, Snare } = ids(app);
  const before = app.store.undoStack.length;
  await call(app, 'set_notes', { parts: [{ channel: Kick, notes: [{ pitch: 60, start: 0, length: 1 }] }, { channel: Snare, notes: [{ pitch: 60, start: 4, length: 1 }] }] });
  assert.equal(app.store.undoStack.length, before + 1);
  await call(app, 'history', { action: 'undo' });
  assert.equal(app.store.currentPattern.notes[Kick]?.length ?? 0, 0);
  assert.match(await callFails(app, 'set_notes', { channel: Kick, notes: [], parts: [] }), /either channel \+ notes, or parts/);
});

test('set_steps takes a drum grid', async () => {
  const app = makeApp();
  const { Hat } = ids(app);
  const r = await call(app, 'set_steps', { channel: 'Hat', grid: 'x.o.|X.x.|x.o.|X.x.' });
  assert.equal(r.hits, 8);
  const notes = app.store.currentPattern.notes[Hat];
  assert.deepEqual(notes.map((n) => n.s), [0, 2, 4, 6, 8, 10, 12, 14]);
  assert.deepEqual(notes.slice(0, 3).map((n) => n.v), [0.78, 0.4, 0.98]);
  assert.match(await callFails(app, 'set_steps', { channel: Hat, grid: 'x.q.' }), /not allowed/);
  await call(app, 'set_steps', { channel: Hat, grid: 'x'.repeat(33) });
  assert.equal(app.store.currentPattern.bars, 3);
});

test('transform_notes: transpose, quantize, legato, velocity, duplicate, bounds', async () => {
  const app = makeApp();
  const ch = (await call(app, 'add_channel', { type: 'synth' })).id;
  await call(app, 'set_notes', { channel: ch, notes: [{ pitch: 60, start: 0.1, length: 0.9 }, { pitch: 64, start: 2.2, length: 1 }, { pitch: 67, start: 4, length: 1 }] });
  await call(app, 'transform_notes', { channel: ch, op: 'quantize', grid: 1 });
  let notes = (await call(app, 'get_pattern', { channel: ch })).channels[0].notes;
  assert.deepEqual(notes.map((n) => n.start), [0, 2, 4]);
  await call(app, 'transform_notes', { channel: ch, op: 'legato' });
  notes = (await call(app, 'get_pattern', { channel: ch })).channels[0].notes;
  assert.deepEqual(notes.map((n) => n.length), [2, 2, 1]);
  await call(app, 'transform_notes', { channel: ch, op: 'transpose', semitones: 12, filter: { from: 2 } });
  notes = (await call(app, 'get_pattern', { channel: ch })).channels[0].notes;
  assert.deepEqual(notes.map((n) => n.pitch), [60, 76, 79]);
  await call(app, 'transform_notes', { channel: ch, op: 'velocity', velocity: { scale: 0.5 } });
  assert.equal(app.store.currentPattern.notes[ch][0].v, 0.39);
  await call(app, 'transform_notes', { channel: ch, op: 'duplicate' });
  assert.equal(app.store.currentPattern.notes[ch].length, 6);
  assert.match(await callFails(app, 'transform_notes', { channel: ch, op: 'transpose', semitones: 100 }), /leave the piano roll range/);
  assert.match(await callFails(app, 'transform_notes', { channel: ch, op: 'shift', steps: -50 }), /before the start/);
  assert.equal(app.store.currentPattern.notes[ch].length, 6, 'a refused edit changes nothing');
});

test('remove_notes needs a filter or all', async () => {
  const app = makeApp();
  const { Kick } = ids(app);
  await call(app, 'set_steps', { channel: Kick, grid: 'x...x...x...x...' });
  assert.match(await callFails(app, 'remove_notes', { channel: Kick }), /filter, or all/);
  const r = await call(app, 'remove_notes', { channel: Kick, filter: { from: 8 } });
  assert.deepEqual([r.removed, r.remaining], [2, 2]);
  await call(app, 'remove_notes', { channel: Kick, all: true });
  assert.equal(app.store.currentPattern.notes[Kick].length, 0);
});

test('a failing call leaves the project and undo stack untouched', async () => {
  const app = makeApp();
  const before = app.store.snapshot();
  const depth = app.store.undoStack.length;
  // second note is invalid, after the first was valid
  const err = await callFails(app, 'add_notes', { channel: 'Kick', notes: [{ pitch: 60, start: 0, length: 1 }, { pitch: 'Z9', start: 1, length: 1 }] });
  assert.match(err, /not a pitch/);
  assert.equal(app.store.snapshot(), before);
  assert.equal(app.store.undoStack.length, depth);
  // a call that changes nothing leaves no undo entry either
  await call(app, 'update_channel', { channel: 'Kick', name: 'Kick' });
  assert.equal(app.store.undoStack.length, depth);
});

test('patterns: add, update, clone, remove, select, clear', async () => {
  const app = makeApp();
  const a = await call(app, 'add_pattern', { name: 'Verse', bars: 4 });
  assert.equal(a.bars, 4);
  assert.equal(app.store.project.selected.pattern, a.id);
  await call(app, 'update_pattern', { pattern: 'Verse', name: 'Chorus', color: '#aa5533' });
  assert.equal(app.store.pattern(a.id).name, 'Chorus');
  const c = await call(app, 'pattern_action', { pattern: a.id, action: 'clone' });
  assert.equal(c.name, 'Chorus (copy)');
  await call(app, 'pattern_action', { pattern: c.id, action: 'remove' });
  await call(app, 'pattern_action', { pattern: 1, action: 'select' }).catch(() => {});
  assert.equal(app.store.project.patterns.length, 2);
  const only = app.store.project.patterns[0];
  await call(app, 'pattern_action', { pattern: a.id, action: 'remove' });
  assert.match(await callFails(app, 'pattern_action', { pattern: only.id, action: 'remove' }), /at least one pattern/);
});

test('channels: add every kind, update params, manage', async () => {
  const app = makeApp();
  const kit = await call(app, 'add_channel', { type: 'drum_kit', kit: 'Standard' });
  assert.deepEqual([kit.bank, kit.rootPitch], [128, 36]);
  const snare = await call(app, 'add_channel', { type: 'drum_kit', kit: 0, piece: 'snare', vol: 0.5 });
  assert.deepEqual([snare.name, snare.fixedKey, snare.vol], ['Acoustic Snare', 38, 0.5]);
  const syn = await call(app, 'add_channel', { type: 'synth', preset: 'Saw Bass', params: { cutoff: 800 }, mixer: 4, color: '#112233' });
  assert.equal(syn.params.cutoff, 800);
  assert.equal(syn.params.wave1, 'sawtooth');
  assert.equal(syn.mixer, 4);
  const drum = await call(app, 'add_channel', { type: 'drum', voice: 'kick' });
  assert.equal(drum.voice, 'kick');
  const samp = await call(app, 'add_channel', { type: 'sampler', path: '/x/loop.wav' }).catch((e) => e.message);
  assert.match(samp, /ENOENT/);

  assert.match(await callFails(app, 'add_channel', { type: 'synth', params: { cutoff: 5 } }), /between 60 and 18000/);
  assert.match(await callFails(app, 'add_channel', { type: 'synth', params: { wave1: 'noise' } }), /one of sine/);
  assert.match(await callFails(app, 'add_channel', { type: 'synth', params: { bogus: 1 } }), /no parameter "bogus"/);
  assert.match(await callFails(app, 'add_channel', { type: 'instrument', instrument: 'Bass' }), /matches 5 instruments/);
  assert.match(await callFails(app, 'add_channel', { type: 'instrument', instrument: 'Kazoo' }), /No instrument matches/);

  const up = await call(app, 'update_channel', { channel: syn.id, name: 'Wobble', mute: true, pan: -0.3, params: { res: 6 } });
  assert.deepEqual([up.name, up.mute, up.pan, up.params.res], ['Wobble', true, -0.3, 6]);
  await call(app, 'update_channel', { channel: (await call(app, 'add_channel', { type: 'instrument', instrument: 'Acoustic Grand Piano' })).id, instrument: 'Bright Acoustic Piano' });
  assert.equal(app.store.selectedChannel.program, 1);
  assert.match(await callFails(app, 'update_channel', { channel: syn.id, instrument: 'Fingered Bass' }), /Only instrument and drum_kit/);

  const n = app.store.project.channels.length;
  const clone = await call(app, 'manage_channel', { channel: 'Wobble', action: 'clone' });
  assert.equal(app.store.project.channels.length, n + 1);
  await call(app, 'manage_channel', { channel: clone.id, action: 'remove' });
  const order = (await call(app, 'manage_channel', { channel: app.store.project.channels[0].id, action: 'move_down' })).channels;
  assert.equal(order[1], app.store.project.channels[1].id);
  const routed = await call(app, 'manage_channel', { channel: 'Wobble', action: 'route_to_free_mixer' });
  assert.ok(routed.mixer > 0);
  assert.equal(app.store.project.mixer[routed.mixer].name, 'Wobble');
  assert.match(await callFails(app, 'manage_channel', { channel: 'Hat', action: 'explode' }), /one of/);
  assert.match(await callFails(app, 'manage_channel', { channel: 'Kick', action: 'select' }), /matches 2 channels/);
});

test('mixer: levels, effects, sends, reset', async () => {
  const app = makeApp();
  await call(app, 'update_mixer_track', { track: 3, name: 'Drums', vol: 0.6, pan: 0.25, mute: true });
  assert.deepEqual([app.store.project.mixer[3].name, app.store.project.mixer[3].vol, app.store.project.mixer[3].mute], ['Drums', 0.6, true]);
  let info = await call(app, 'update_mixer_track', { track: 3, toMaster: false });
  assert.equal(app.store.project.mixer[3].master, false);
  assert.equal(info.toMaster, false);
  info = await call(app, 'update_mixer_track', { track: 3, toMaster: true });
  assert.equal(info.toMaster, true);
  assert.equal(app.store.project.mixer[3].master, undefined);

  let t = await call(app, 'set_effect', { track: 3, type: 'reverb', params: { mix: 0.5 } });
  assert.deepEqual(t.effects.map((e) => [e.slot, e.type, e.params.mix]), [[0, 'reverb', 0.5]]);
  t = await call(app, 'set_effect', { track: 3, type: 'delay' });
  assert.equal(t.effects[1].slot, 1);
  t = await call(app, 'set_effect', { track: 3, slot: 1, params: { feedback: 0.6 }, on: false });
  assert.deepEqual([t.effects[1].params.feedback, t.effects[1].on], [0.6, false]);
  assert.match(await callFails(app, 'set_effect', { track: 3, slot: 5, params: { mix: 1 } }), /Slot 5 is empty/);
  assert.match(await callFails(app, 'set_effect', { track: 3, slot: 0, params: { mix: 3 } }), /between 0 and 1/);
  assert.match(await callFails(app, 'set_effect', { track: 3, type: 'wobbler' }), /one of/);

  await call(app, 'move_effect', { track: 3, slot: 0, direction: 'down' });
  assert.deepEqual(app.store.project.mixer[3].fx.slice(0, 2).map((s) => s.type), ['delay', 'reverb']);
  assert.ok(app.calls.some((c) => c[0] === 'resetFx' && c[1] === 3));
  t = await call(app, 'set_effect', { track: 3, slot: 0, type: null });
  assert.deepEqual(t.effects.map((e) => e.type), ['reverb']);

  await call(app, 'set_send', { from: 3, to: 9, level: 0.5 });
  assert.equal(app.store.project.mixer[3].sends[9], 0.5);
  assert.match(await callFails(app, 'set_send', { from: 9, to: 3, level: 0.5 }), /feedback loop/);
  await call(app, 'set_send', { from: 3, to: 9, level: null });
  assert.deepEqual(app.store.project.mixer[3].sends, {});

  await call(app, 'reset_mixer');
  assert.equal(app.store.project.mixer[3].vol, 0.8);
  assert.equal(app.store.project.mixer[3].fx.every((s) => s === null), true);
});

test('playlist: place, move, duplicate, make unique, remove', async () => {
  const app = makeApp();
  const pat = app.store.project.patterns[0].id;
  const second = await call(app, 'add_pattern', { name: 'Fill', bars: 2 });
  const r = await call(app, 'add_clips', { clips: [
    { type: 'pattern', pattern: pat, track: 0, start: 0 },
    { type: 'pattern', pattern: 'Fill', track: 0, start: 16 },
    { type: 'pattern', pattern: pat, track: 1, start: 0, length: 32 },
  ] });
  assert.deepEqual(r.added.map((c) => c.length), [16, 32, 32]);
  assert.equal(r.endStep, 48);
  const [a, , c] = r.added;

  await call(app, 'update_clips', { clips: [{ id: a.id, start: 48, mute: true }] });
  const clip = app.store.project.playlist.clips.find((x) => x.id === a.id);
  assert.deepEqual([clip.start, clip.mute], [48, true]);

  const dup = await call(app, 'edit_clips', { ids: [c.id], action: 'duplicate' });
  assert.equal(dup.added[0].start, 32);
  const uniq = await call(app, 'edit_clips', { ids: [c.id], action: 'make_unique' });
  assert.notEqual(uniq.unique[0].pattern, pat);
  assert.equal(app.store.project.patterns.length, 3);
  const gone = await call(app, 'edit_clips', { track: 0, action: 'remove' });
  assert.equal(gone.removed.length, 2);

  const pl = await call(app, 'get_playlist', { track: 1 });
  assert.equal(pl.clips.length, 2);
  await call(app, 'update_playlist_track', { track: 1, name: 'Beat', mute: true });
  assert.equal(app.store.project.playlist.tracks[1].name, 'Beat');
  assert.match(await callFails(app, 'add_clips', { clips: [{ type: 'pattern', pattern: second.id, track: 0, start: 0 }, { type: 'audio', sample: 99, track: 0, start: 0 }] }), /no sample with id 99/);
  assert.match(await callFails(app, 'edit_clips', { action: 'remove' }), /either ids or track/);
});

test('audio clips take their length from the sample', async () => {
  const app = makeApp();
  const id = app.store.addSample('loop.wav', new ArrayBuffer(8));
  const r = await call(app, 'add_clips', { clips: [{ type: 'audio', sample: id, track: 2, start: 8, gain: 0.5 }] });
  // fake sample is 2 s long at 130 bpm: 2 / (60/130/4) steps
  assert.equal(r.added[0].length, Math.round(2 / app.transport.stepDur));
  assert.deepEqual([r.added[0].sample, r.added[0].gain], [id, 0.5]);
});

test('automation: create with real values, read back, update, remove', async () => {
  const app = makeApp();
  const au = await call(app, 'create_automation', {
    target: { kind: 'mixer', track: 1, param: 'vol' }, length: 32, start: 16,
    points: [{ step: 0, value: 0 }, { step: 16, value: 0.8, curve: 'smooth' }, { step: 32, value: 0.4 }],
  });
  assert.equal(au.name, 'Insert 1 — Volume');
  assert.deepEqual(au.points.map((p) => [p.step, p.value, p.curve]), [[0, 0, 'linear'], [16, 0.8, 'smooth'], [32, 0.4, 'linear']]);
  assert.deepEqual(au.clips.map((c) => [c.start, c.length]), [[16, 32]]);

  const fx = await call(app, 'set_effect', { track: 2, type: 'delay' });
  assert.equal(fx.effects.length, 1);
  const cut = await call(app, 'create_automation', { target: { kind: 'fx', track: 2, slot: 0, key: 'time' }, points: [{ step: 0, value: 20 }, { step: 16, value: 1200 }] });
  assert.equal(cut.points[1].value, 1200);
  assert.ok(cut.points[1].normalized === 1);

  const upd = await call(app, 'update_automation', { id: au.id, length: 64, points: [{ step: 0, value: 0.2 }, { step: 64, value: 0.8 }] });
  assert.equal(upd.length, 64);
  assert.equal(upd.clips[0].length, 64);
  assert.match(await callFails(app, 'update_automation', { id: au.id, points: [{ step: 100, value: 1 }] }), /past the end/);
  assert.match(await callFails(app, 'create_automation', { target: { kind: 'fx', track: 9, slot: 3, key: 'mix' } }), /does not exist/);
  assert.match(await callFails(app, 'create_automation', { target: { kind: 'mixer', track: 1 } }), /need track, param/);

  await call(app, 'remove_automation', { id: au.id });
  assert.equal(app.store.project.automations.length, 1);
  assert.equal(app.store.project.playlist.clips.filter((c) => c.type === 'auto').length, 1);
});

test('project lifecycle protects unsaved work and round-trips files', async () => {
  const app = makeApp();
  await call(app, 'set_steps', { channel: 'Kick', grid: 'x...x...x...x...' });
  assert.equal(app.store.dirty, true);
  assert.match(await callFails(app, 'new_project'), /unsaved changes/);
  assert.match(await callFails(app, 'save_project'), /no file yet/);

  const saved = await call(app, 'save_project', { path: '/tmp/song' });
  assert.equal(saved.path, '/tmp/song.osp');
  assert.equal(app.store.dirty, false);
  assert.equal(app.store.project.name, 'song');

  await call(app, 'set_project', { bpm: 150 });
  await call(app, 'new_project', { force: true });
  assert.equal(app.store.project.bpm, 130);
  assert.equal(app.store.filePath, null);

  const opened = await call(app, 'open_project', { path: '/tmp/song.osp' });
  assert.equal(opened.name, 'song');
  assert.equal(app.store.currentPattern.notes[ids(app).Kick].length, 4);
  assert.match(await callFails(app, 'open_project', { path: '/tmp/missing.osp' }), /ENOENT/);

  const demo = await call(app, 'new_project', { demo: true });
  assert.equal(demo.name, 'Demo beat');
  assert.equal(demo.mode, 'song');
});

test('export_midi and import_midi round-trip through files', async () => {
  const app = makeApp();
  await call(app, 'set_steps', { channel: 'Kick', grid: 'x...x...x...x...' });
  const out = await call(app, 'export_midi', { path: '/tmp/kick.mid' });
  assert.ok(out.bytes > 20);
  const imported = await call(app, 'import_midi', { path: '/tmp/kick.mid', start: 32 });
  assert.equal(imported.bars, 1);
  const clip = app.store.project.playlist.clips.at(-1);
  assert.deepEqual([clip.type, clip.start], ['pattern', 32]);
  assert.match(await callFails(app, 'import_midi', { path: '/tmp/nothing.mid' }), /Could not read MIDI file/);
});

test('transport reports state and seeks by bar', async () => {
  const app = makeApp();
  let t = await call(app, 'transport', { action: 'seek', bar: 3 });
  assert.equal(t.positionSteps, 32);
  assert.equal(t.position, '3:1:00');
  t = await call(app, 'transport', { action: 'stop' });
  assert.equal(t.positionSteps, 32, 'stop returns to where the playhead was set');
  assert.match(await callFails(app, 'transport', { action: 'seek' }), /needs step or bar/);
  await call(app, 'transport', { action: 'play' });
  assert.equal((await call(app, 'transport', { action: 'status' })).playing, true);
  await call(app, 'transport', { action: 'pause' });
  assert.equal(app.transport.playing, false);
});

test('catalog lookups', async () => {
  const app = makeApp();
  const inst = await call(app, 'list_catalog', { kind: 'instruments', query: 'bass' });
  assert.equal(inst.total, 5);
  assert.deepEqual(inst.instruments[0], { family: 'Bass', name: 'Acoustic Bass', bank: 0, program: 32 });
  const kits = await call(app, 'list_catalog', { kind: 'drum_kits', query: 'standard' });
  assert.equal(kits.kits[0].pieces.length, 3);
  assert.ok((await call(app, 'list_catalog', { kind: 'synth_presets', query: 'bass' })).presets.length >= 2);
  const fx = await call(app, 'list_catalog', { kind: 'effects' });
  assert.ok(fx.effects.find((e) => e.type === 'reverb').params.some((p) => p.key === 'mix'));
  assert.ok((await call(app, 'list_catalog', { kind: 'channel_params' })).synth.some((p) => p.key === 'cutoff' && p.logarithmic));
  assert.ok((await call(app, 'list_catalog', { kind: 'drum_voices' })).voices.length >= 8);
  assert.ok((await call(app, 'list_catalog', { kind: 'automation_targets' })).formats.length === 4);
});

test('ui tools: selection and windows', async () => {
  const app = makeApp();
  const shown = [];
  app.wm = { get: (id) => ({ visible: false, show() { shown.push(id); this.visible = true; }, hide() {} }) };
  app.actions.openChannelSettings = (id) => shown.push(`settings:${id}`);
  await call(app, 'set_selection', { channel: 'Hat', mixerTrack: 3 });
  assert.equal(app.store.selectedChannel.name, 'Hat');
  assert.equal(app.store.project.selected.mixer, 3);
  await call(app, 'show_window', { window: 'piano' });
  await call(app, 'show_window', { window: 'settings', channel: 'Snare' });
  assert.deepEqual(shown, ['piano', `settings:${ids(app).Snare}`]);
  assert.match(await callFails(app, 'show_window', { window: 'automation' }), /needs the automation id/);
});

test('preview_note plays through the engine without touching the project', async () => {
  const app = makeApp();
  const before = app.store.snapshot();
  const r = await call(app, 'preview_note', { channel: 'Kick', pitches: ['C5', 64] });
  assert.deepEqual(r.played, [60, 64]);
  assert.equal(app.calls.filter((c) => c[0] === 'preview').length, 2);
  assert.equal(app.store.snapshot(), before);
});
