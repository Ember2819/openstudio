// Transport playback: resuming from the exact paused position (no playhead rewind), and song mode with
// nothing placed falling back to the edited pattern so Play is never silent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { Transport, scheduleStep } from '../src/audio/transport.js';

/** A store with one instrument channel and notes `spec` = [[step, pitch], ...] in the selected pattern. */
function songStore(spec = []) {
  const store = new Store();
  const ch = store.project.channels[0];
  store.currentPattern.notes[ch.id] = spec.map(([s, p]) => ({ p, s, l: 1, v: 0.8 }));
  store.emit('notes');
  return store;
}

/** A stub engine with a controllable clock and every scheduled event recorded. */
function makeEngine() {
  const calls = [];
  return {
    ctx: { currentTime: 0, state: 'running' },
    ensure() {},
    killAll() {},
    click(time, bar) { calls.push(['click', time, bar]); },
    playNote(ch, p, v, time, len) { calls.push(['note', Math.round(time * 1e6) / 1e6, p, Math.round(len * 1e6) / 1e6]); },
    playAudio(buffer, mixer, time, into, len) { calls.push(['audio', Math.round(time * 1e6) / 1e6, Math.round(into * 1e6) / 1e6, Math.round(len * 1e6) / 1e6]); },
    syncAll() {},
    calls,
  };
}

const noteCalls = (calls) => calls.filter((c) => c[0] === 'note');
const noteAt = (calls, pitch) => noteCalls(calls).find((c) => c[2] === pitch);

/** run `fn`, always stopping playback afterwards so a failed assert can't leave the scheduler running */
function withPlaying(t, fn) {
  try { fn(); } finally { t.stop(); }
}

test('play resumes from the exact paused position (no backward jump)', () => {
  const store = songStore([[0, 60], [4, 62]]);
  const engine = makeEngine();
  const t = new Transport(store, engine);
  withPlaying(t, () => {
    t.play();
    t.pause();
    // paused part-way into a step, like stopping mid-note
    engine.ctx.currentTime = 3.5;
    t.resumeStep = 8.4;
    t.startStep = 0;
    t.play();
    // the displayed position continues from where we paused — it must not rewind to the step boundary
    assert.equal(t.position(), 8.4);
    // the queue starts at the exact resumed position, on the step we are inside
    assert.equal(t.queue[0].step, 8.4);
    assert.equal(Math.floor(t.queue[0].step), 8);
  });
});

test('a part-way resume schedules the rest of the step and skips the notes behind the resume point', () => {
  // notes in step 12 (before and after the resume point) and in step 13
  const store = songStore([[12.25, 60], [12.75, 64], [13.5, 67]]);
  const engine = makeEngine();
  const t = new Transport(store, engine);
  t.resumeStep = 12.613; // mid-step: 12.25 is behind us, 12.75 and 13.5 are still ahead
  withPlaying(t, () => {
    t.play();
    const stepDur = t.stepDur;
    // the notes before the resume point are skipped, the ones after keep their exact offset
    const played = noteCalls(engine.calls);
    assert.ok(!played.some((c) => c[2] === 60), 'note behind the resume point is skipped');
    const at = (pitch) => played.find((c) => c[2] === pitch)?.[1];
    // first (partial) step starts 50 ms out; 12.75 sounds 0.137 steps into the song timeline from 12.613
    assert.ok(Math.abs(at(64) - (0.05 + (12.75 - 12.613) * stepDur)) < 1e-5, `12.75 at ${at(64)}`);
    // the next step starts after only the remainder of the partial step (0.387 steps), not a full one
    assert.ok(Math.abs(at(67) - (0.05 + (1 - 0.613) * stepDur + (13.5 - 13) * stepDur)) < 1e-5, `13.5 at ${at(67)}`);
    // the queue reports the exact resumed position, so the playhead continues smoothly from it
    assert.equal(t.queue[0].step, 12.613);
    assert.equal(t.queue[1].step, 13);
  });
});

test('seek while playing continues from the exact target', () => {
  const store = songStore([[15, 60]]);
  const engine = makeEngine();
  const t = new Transport(store, engine);
  withPlaying(t, () => {
    t.play();
    engine.ctx.currentTime = 1;
    t.seek(10.25);
    assert.equal(t.position(), 10.25); // held, not pulled back to step 10
    assert.equal(t.from, 10.25);
  });
});

test('song mode with nothing placed falls back to the edited pattern', () => {
  const store = songStore([[0, 60], [2, 64]]);
  store.project.mode = 'song'; // empty playlist: no clips anywhere
  const engine = makeEngine();
  const t = new Transport(store, engine);
  assert.equal(t.effectiveMode, 'pattern');
  withPlaying(t, () => {
    t.play();
    // the edited pattern is what plays, so it sounds
    assert.ok(noteAt(engine.calls, 60), 'the edited pattern plays');
    // and the transport runs like pattern mode: pattern length, wrapped pattern position
    assert.equal(t.lengthSteps, store.patternSteps(store.currentPattern));
    assert.ok(t.patternPosition() < store.patternSteps(store.currentPattern));
  });
  // with a clip placed it is a real song again
  store.addClip({ pat: store.currentPattern.id, track: 0, start: 0, len: 16 });
  store.emit('playlist');
  assert.equal(t.effectiveMode, 'song');
});

test('a fully muted song still falls back to the edited pattern', () => {
  const store = songStore([[0, 60]]);
  store.project.mode = 'song';
  const clip = store.addClip({ pat: store.currentPattern.id, track: 0, start: 0, len: 16 });
  clip.mute = true;
  store.emit('playlist');
  const engine = makeEngine();
  const t = new Transport(store, engine);
  assert.equal(t.effectiveMode, 'pattern');
  withPlaying(t, () => {
    t.play();
    assert.ok(noteAt(engine.calls, 60));
  });
});

test('loop recording still wraps when the song falls back to the pattern', () => {
  const store = songStore([[0, 60]]);
  store.project.mode = 'song';
  store.project.loop = { start: 16, end: 24 };
  const engine = makeEngine();
  const t = new Transport(store, engine);
  t.setLoop(true);
  const jumps = [];
  t.on('jump', (j) => jumps.push(j.step));
  withPlaying(t, () => {
    t.play();
    // drive the scheduler clock by hand through two full passes of the 8-step loop
    for (let i = 0; i < 24; i++) { engine.ctx.currentTime += t.stepDur; t._tick(); }
    assert.ok(jumps.includes(16), 'the loop wraps back to its start');
    assert.ok(t.position() < 24 + 1e-6, 'the position stays inside the loop');
  });
});

test('a seek at the pattern boundary does not wrap a fallback song back to 0', () => {
  // regression: the song wrap used the fallback's pattern length, so seek(16) with a 16-step pattern
  // started playback from step 0 and loop-recorded takes landed at the song start
  const store = songStore([[0, 60]]);
  store.project.mode = 'song'; // empty playlist
  const engine = makeEngine();
  const t = new Transport(store, engine);
  t.seek(16);
  withPlaying(t, () => {
    t.play();
    assert.equal(t.queue[0].step, 16, 'playback starts at the seek point, not step 0');
    assert.equal(t.position(), 16);
  });
  // the song wrap length stays the song's: the fallback pattern itself must not end the song
  assert.equal(t._songEnd, 0);
});

test('scheduleStep skips only the notes behind a part-way resume point', () => {
  const store = songStore([[12, 60], [12.5, 62], [12.9, 64], [13, 67]]);
  const engine = makeEngine();
  store.checkpoint = store.checkpoint || (() => {});
  scheduleStep(store, engine, 12, 0, 0.1, { from: 12.6 });
  const pitches = noteCalls(engine.calls).map((c) => c[2]);
  assert.deepEqual(pitches, [64]); // 12 and 12.5 are behind us, 13 belongs to the next step
});

test('song mode with a part-way resume keeps audio clips part-way in', () => {
  const store = new Store();
  store.project.mode = 'song';
  const engine = makeEngine();
  store.samples.set('s1', { buffer: { fake: true } });
  store.addClip({ type: 'audio', sampleId: 's1', track: 0, start: 8, len: 8 });
  store.emit('playlist');
  // resuming at 8.25: the clip that started at 8 continues 0.25 steps in (0.025 s at sd = 0.1)
  scheduleStep(store, engine, 8, 0, 0.1, { from: 8.25, first: true });
  assert.deepEqual(engine.calls.find((c) => c[0] === 'audio')?.slice(1), [0, 0.025, 0.775]);
});
