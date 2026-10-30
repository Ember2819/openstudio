import { Engine } from './engine.js';
import { scheduleStep } from './transport.js';
import { TempoMap } from '../tempo.js';

/**
 * Render `steps` steps of the project offline and resolve to an AudioBuffer.
 * Steps are scheduled just ahead of the render position (using OfflineAudioContext.suspend) — exactly like live
 * playback — so automation that changes effect or instrument parameters lands on the right step instead of
 * being applied all at once before rendering starts.
 * opts: { tail (seconds after the last step), sampleRate, from (first step to render, default 0), configure(engine),
 *         onProgress(fraction 0..1), signal (AbortSignal) }
 * Progress is reported each time the render pauses to schedule more steps (OfflineAudioContext has no progress events).
 */
export async function renderSteps(store, steps, { tail = 3, sampleRate = 44100, from = 0, configure, onProgress, signal } = {}) {
  const tempo = new TempoMap(store); // follows tempo automation
  const t0 = tempo.timeAt(from);
  const at = (step) => tempo.timeAt(step) - t0; // seconds into the render
  const seconds = at(steps) + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const engine = new Engine(store, ctx);
  configure?.(engine);
  // decode audio clips / sampler samples for this context before scheduling anything
  const ids = new Set();
  for (const c of store.project.playlist.clips) if (c.type === 'audio') ids.add(c.sampleId);
  for (const ch of store.project.channels) if (ch.type === 'sampler' && ch.sampleId != null) ids.add(ch.sampleId);
  await Promise.all([...ids].map((id) => engine.ensureSample(id)));

  const AHEAD = 4; // steps scheduled ahead of the render position
  let next = from;
  const lengths = new Map(); // the project cannot change mid-render, so pattern lengths are computed once
  const scheduleUpTo = (end) => {
    for (; next < Math.min(end, steps); next++) scheduleStep(store, engine, next, at(next), tempo.stepDur(next), { first: next === from, lengths });
  };
  scheduleUpTo(from + AHEAD);
  for (let s = 1; s * AHEAD < steps - from; s++) {
    const step = from + s * AHEAD;
    const when = at(step);
    // suspend times are quantised to 128-frame blocks; suspend a little early so nothing is scheduled in the past
    ctx.suspend(Math.max(0, when - 0.01)).then(() => {
      // an aborted render is simply left suspended
      if (signal?.aborted) return;
      scheduleUpTo(step + AHEAD);
      onProgress?.(Math.min(0.99, when / seconds));
      ctx.resume();
    });
  }
  onProgress?.(0);
  const aborted = new Promise((_, reject) => {
    const abort = () => reject(Object.assign(new Error('Render cancelled'), { name: 'AbortError' }));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const out = await Promise.race([ctx.startRendering(), aborted]);
    onProgress?.(1);
    return out;
  } finally {
    engine.dispose();
  }
}
