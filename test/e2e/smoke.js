// Runs inside the renderer (see scripts/e2e.mjs). Resolves to a list of "ok …" / "FAIL …" lines.
(async () => {
  const a = window.openstudio;
  const s = a.store;
  const t = a.transport;
  const log = [];
  const ok = (name, cond) => log.push(`${cond ? 'ok' : 'FAIL'} ${name}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const peak = async (ms = 400) => {
    let p = 0;
    for (let i = 0; i < ms / 20; i++) { const lv = a.engine.readLevels(0); p = Math.max(p, lv[0], lv[1]); await wait(20); }
    return p;
  };

  // instrument bank loaded and catalogued
  for (let i = 0; i < 50 && !a.actions.catalog(); i++) await wait(100);
  ok('instrument bank loads', !!a.actions.catalog());
  ok('catalog has 16 families and drum kits', a.actions.catalog()?.families.length === 16 && a.actions.catalog()?.kits.length >= 10);

  // demo project plays and produces sound
  a.actions.loadDemo();
  t.setMode('pattern');
  t.play();
  await wait(1500);
  ok('pattern playback is audible', (await peak()) > 0.01);
  t.pause();
  t.setMode('song');
  t.stop();
  t.play();
  await wait(1200);
  ok('song playback is audible', (await peak()) > 0.01);
  t.stop();
  ok('stop returns to the start', t.position() === 0);

  // editing, undo/redo
  const n = s.project.channels.length;
  a.actions.addInstrument({ name: 'Flute', bank: 0, program: 73 });
  ok('add instrument channel', s.project.channels.length === n + 1);
  s.undo();
  ok('undo', s.project.channels.length === n);

  // mixer effects + sends
  const m = s.project.mixer[2];
  ['reverb', 'delay', 'chorus', 'phaser', 'limiter', 'flanger', 'tremolo', 'bitcrusher'].forEach((type, i) => { m.fx[i] = { type, params: {}, on: true }; });
  a.engine.syncFx(2);
  ok('effect chain builds', a.engine.tracks[2].fxNodes.length === 8);
  m.fx.fill(null);
  a.engine.syncFx(2);
  s.project.mixer[1].sends[2] = 0.7;
  s.emit('mixer');
  ok('send node created', a.engine.sendNodes.has('1:2'));

  // automation clip
  a.actions.createAutomation({ kind: 'mixer', track: 1, param: 'vol' });
  ok('automation clip created', s.project.automations.length === 1 && s.project.playlist.clips.some((c) => c.type === 'auto'));

  // audio clip from a generated sample
  const { encodeWav } = await import('./src/audio/wav.js');
  const off = new OfflineAudioContext(1, 22050, 22050);
  const buf = off.createBuffer(1, 22050, 22050);
  for (let i = 0; i < 22050; i++) buf.getChannelData(0)[i] = Math.sin(i / 10) * 0.5;
  const id = s.addSample('test.wav', encodeWav(buf));
  const decoded = await a.engine.ensureSample(id);
  ok('sample decodes', !!decoded);
  s.addClip({ type: 'audio', sampleId: id, track: 6, start: 0, len: 8 });

  // save / load round trip keeps clips, automation and samples
  const text = s.serialize();
  s.load(text);
  ok('project round trip', s.project.automations.length === 1 && s.samples.size === 1 && s.project.playlist.clips.some((c) => c.type === 'audio'));

  // offline export renders audio (step-by-step, like live playback)
  const { renderSteps } = await import('./src/audio/render.js');
  s.project.mode = 'song';
  const rendered = await renderSteps(s, Math.min(s.playlistEndStep(), 32), { tail: 1 });
  let rp = 0;
  const d = rendered.getChannelData(0);
  for (let i = 0; i < d.length; i += 11) rp = Math.max(rp, Math.abs(d[i]));
  ok('offline render has signal and no NaN', rp > 0.01 && !Number.isNaN(rp));

  // song playback wraps at the end of the arrangement when no loop is set
  t.setLoop(false);
  t.stop();
  t.seek(s.playlistEndStep() + 64);
  t.play();
  await wait(400);
  ok('song wraps to the start after the last bar', t.position() < 16);
  t.stop();
  t.seek(0);

  // MIDI import through the real action (File object, as from a drop or the file picker)
  const { buildMidi } = await import('./src/midifile.js');
  const before = s.project.channels.length;
  const pats = s.project.patterns.length;
  const file = new File([buildMidi(s, { song: true })], 'roundtrip.mid');
  const imported = await a.actions.importMidiFile(file);
  ok('MIDI import adds a pattern, channels and a clip', !!imported && s.project.patterns.length === pats + 1
    && s.project.channels.length > before && s.project.playlist.clips.some((c) => c.pat === imported.id));
  s.undo();
  ok('MIDI import is undoable', s.project.patterns.length === pats && s.project.channels.length === before);

  // channel reordering
  const firstId = s.project.channels[0].id;
  s.moveChannel(firstId, 1);
  ok('move channel down', s.project.channels[1].id === firstId);

  // a sliced automation clip keeps its place in the curve
  const auto = s.project.automations[0];
  auto.points = [{ x: 0, y: 0 }, { x: 16, y: 1 }];
  const autoClip = s.project.playlist.clips.find((c) => c.type === 'auto');
  const { curveAt } = await import('./src/automation.js');
  autoClip.offset = 8;
  ok('automation clip offset reads later in the curve', Math.abs(curveAt(auto.points, 0 + autoClip.offset) - 0.5) < 1e-6);

  // loading a damaged project doesn't throw and repairs ids/selection
  let loaded = true;
  try { s.load(JSON.stringify({ channels: [{ id: 3, type: 'synth', name: 'x' }], patterns: [{ id: 3, name: 'p', notes: {} }] })); } catch { loaded = false; }
  ok('damaged project loads with sane defaults', loaded && s.project.playlist.tracks.length === 125 && s.project.nextId > 3 && s.project.patterns[0].bars === 1);

  return log.join('\n');
})()
