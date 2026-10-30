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

  t.setRecording(false);
  ok('turning recording off closes the device', await until(() => !a.recorder.armed, 2000));
  t.setRecordAudio(false);
  t.setRecordNotes(true);
  return log.join('\n');
})()
