// Audio recording through Chromium's fake input device (a beeping test tone). Runs inside the renderer.
(async () => {
  const a = window.openstudio;
  const s = a.store;
  const t = a.transport;
  const log = [];
  const ok = (name, cond) => log.push(`${cond ? 'ok' : 'FAIL'} ${name}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 50 && !fn(); i++) await wait(50); return fn(); };

  s.resetToDefault();
  t.setMode('pattern');
  t.setRecordNotes(false);
  t.setRecordAudio(true);
  t.setRecording(true);
  ok('arming opens the input device', await until(() => a.recorder.armed));
  ok('audio recording switches to song mode', t.mode === 'song');
  ok('the input has signal', await until(() => a.recorder.level > 0.01, 3000));

  t.seek(16);
  t.play();
  await wait(1600);
  t.stop();
  const clip = await until(() => s.project.playlist.clips.find((c) => c.type === 'audio'), 3000) && s.project.playlist.clips.find((c) => c.type === 'audio');
  ok('stopping leaves an audio clip in the playlist', !!clip);
  if (clip) {
    const sample = s.samples.get(clip.sampleId);
    const secs = sample.buffer.duration;
    ok('the take starts where playback started', Math.abs(clip.start - 16) < 1e-6);
    ok('the take is about as long as the playback', secs > 1.3 && secs < 2.0);
    ok('the clip length matches the take', Math.abs(clip.len - secs / t.stepDur) < 0.05);
    let peak = 0;
    const d = sample.buffer.getChannelData(0);
    for (let i = 0; i < d.length; i += 3) peak = Math.max(peak, Math.abs(d[i]));
    ok('the take has the input signal', peak > 0.01);
    ok('it is stored as a float WAV', new DataView(sample.data).getUint16(20, true) === 3);
    ok('the track is named Audio', s.project.playlist.tracks[clip.track].name === 'Audio');
    s.undo();
    ok('undo removes the take', !s.project.playlist.clips.some((c) => c.type === 'audio'));
  }

  // loop recording: every pass of the loop is its own take, stacked, the earlier ones muted
  s.project.loop = { start: 16, end: 24 }; // half a bar: 1 s at 120 BPM
  s.project.bpm = 120;
  s.emit('project');
  t.setLoop(true);
  t.seek(16);
  t.play();
  await wait(2600);
  t.stop();
  const takes = (await until(() => s.project.playlist.clips.filter((c) => c.type === 'audio').length >= 3, 4000), s.project.playlist.clips.filter((c) => c.type === 'audio'));
  ok('loop recording makes one take per pass', takes.length === 3);
  ok('every pass starts at the loop start', takes.every((c) => Math.abs(c.start - 16) < 1e-6));
  ok('passes go on their own tracks', new Set(takes.map((c) => c.track)).size === takes.length);
  ok('only the last pass plays', takes.slice(0, -1).every((c) => c.mute) && !takes.at(-1).mute);
  ok('a full pass is one loop long', Math.abs(s.samples.get(takes[1]?.sampleId)?.buffer.duration - 1) < 0.02);
  s.undo();
  ok('undo removes all the passes at once', !s.project.playlist.clips.some((c) => c.type === 'audio'));
  t.setLoop(false);

  t.setRecording(false);
  ok('turning recording off closes the device', await until(() => !a.recorder.armed, 2000));
  // monitoring: the input plays through a mixer track (its meter moves) without recording
  await a.recorder.setMonitor(5);
  ok('monitoring opens the input', await until(() => a.recorder.armed));
  // the fake device only beeps briefly once a second: watch the meter closely for a few seconds
  let heard = false;
  for (let i = 0; i < 1000 && !heard; i++) { const [l, r] = a.engine.readLevels(5); heard = l > 0.01 || r > 0.01; await wait(4); }
  ok('the monitored input reaches its mixer track', heard);
  await a.recorder.setMonitor(null);
  ok('monitoring off closes the input', await until(() => !a.recorder.armed, 2000));

  t.setRecordAudio(false);
  t.setRecordNotes(true);
  return log.join('\n');
})()
