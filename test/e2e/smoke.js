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
  ['reverb', 'delay', 'chorus', 'phaser', 'limiter'].forEach((type, i) => { m.fx[i] = { type, params: {}, on: true }; });
  a.engine.syncFx(2);
  ok('effect chain builds', a.engine.tracks[2].fxNodes.length === 5);
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

  // offline export renders audio
  const { Engine } = await import('./src/audio/engine.js');
  const { scheduleStep } = await import('./src/audio/transport.js');
  s.project.mode = 'song';
  const sd = 60 / s.project.bpm / 4;
  const steps = Math.min(s.playlistEndStep(), 32);
  const ctx = new OfflineAudioContext(2, Math.ceil((steps * sd + 1) * 44100), 44100);
  const eng = new Engine(s, ctx);
  for (let i = 0; i < steps; i++) scheduleStep(s, eng, i, i * sd, sd, { first: i === 0 });
  const rendered = await ctx.startRendering();
  eng.dispose();
  let rp = 0;
  const d = rendered.getChannelData(0);
  for (let i = 0; i < d.length; i += 11) rp = Math.max(rp, Math.abs(d[i]));
  ok('offline render has signal and no NaN', rp > 0.01 && !Number.isNaN(rp));

  return log.join('\n');
})()
