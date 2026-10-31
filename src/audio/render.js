import { Engine } from './engine.js';
import { scheduleStep } from './transport.js';
import { TempoMap } from '../tempo.js';

/**
 * Render `steps` steps of the project offline and resolve to an AudioBuffer.
 * Steps are scheduled just ahead of the render position (using OfflineAudioContext.suspend) — exactly like live
 * playback — so automation that changes effect or instrument parameters lands on the right step instead of
 * being applied all at once before rendering starts.
 * opts: { tail (seconds after the last step), sampleRate, from (first step to render, default 0), configure(engine),
 *         onProgress(fraction 0..1), signal (AbortSignal), channels (output channels, default 2),
 *         only (Set of clip ids: play just those clips) }
 * Progress is reported each time the render pauses to schedule more steps (OfflineAudioContext has no progress events).
 */
export async function renderSteps(store, steps, { tail = 3, sampleRate = 44100, from = 0, configure, onProgress, signal, channels = 2, only = null } = {}) {
  const tempo = new TempoMap(store); // follows tempo automation
  const t0 = tempo.timeAt(from);
  const at = (step) => tempo.timeAt(step) - t0; // seconds into the render
  const seconds = at(steps) + tail;
  const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
  const engine = new Engine(store, ctx);
  configure?.(engine);
  await engine.ready; // worklet-based effects must be running before the first sample
  // decode audio clips / sampler samples for this context before scheduling anything
  const ids = new Set();
  for (const c of store.project.playlist.clips) if (c.type === 'audio') ids.add(c.sampleId);
  for (const ch of store.project.channels) {
    if (ch.type !== 'sampler') continue;
    if (ch.sampleId != null) ids.add(ch.sampleId);
    for (const z of ch.zones ?? []) ids.add(z.sampleId);
  }
  await Promise.all([...ids].map((id) => engine.ensureSample(id)));

  const AHEAD = 4; // steps scheduled ahead of the render position
  let next = from;
  const lengths = new Map(); // the project cannot change mid-render, so pattern lengths are computed once
  const scheduleUpTo = (end) => {
    for (; next < Math.min(end, steps); next++) scheduleStep(store, engine, next, at(next), tempo.stepDur(next), { first: next === from, lengths, only });
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

/**
 * Render the master and a stereo stem for each mixer track in `tracks` (post-fader, like FL Studio's "split mixer
 * tracks"): every strip is routed into its own channel pair of one multichannel render, 15 tracks per pass.
 * Resolves to { master: AudioBuffer, stems: Map(track -> AudioBuffer) }. opts as for renderSteps.
 */
export async function renderStems(store, steps, tracks, opts = {}) {
  const PER_PASS = 15; // OfflineAudioContext allows 32 channels: the master pair + 15 stems
  const batches = [];
  for (let i = 0; i < tracks.length; i += PER_PASS) batches.push(tracks.slice(i, i + PER_PASS));
  if (!batches.length) batches.push([]);
  const stems = new Map();
  let master = null;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const n = 2 + batch.length * 2;
    const out = await renderSteps(store, steps, {
      ...opts,
      channels: n,
      onProgress: opts.onProgress && ((f) => opts.onProgress((b + f) / batches.length)),
      configure: (engine) => {
        const ctx = engine.ctx;
        ctx.destination.channelCount = n;
        ctx.destination.channelCountMode = 'explicit';
        ctx.destination.channelInterpretation = 'discrete';
        const merge = ctx.createChannelMerger(n);
        merge.connect(ctx.destination);
        const pair = (node, k) => {
          const split = ctx.createChannelSplitter(2);
          node.connect(split);
          split.connect(merge, 0, k);
          split.connect(merge, 1, k + 1);
        };
        engine.limiterOut.disconnect();
        pair(engine.limiterOut, 0);
        batch.forEach((track, j) => pair(engine.track(track).gate, 2 + j * 2));
        opts.configure?.(engine);
      },
    });
    const take = (k) => {
      const buf = new AudioBuffer({ numberOfChannels: 2, length: out.length, sampleRate: out.sampleRate });
      buf.copyToChannel(out.getChannelData(k), 0);
      buf.copyToChannel(out.getChannelData(k + 1), 1);
      return buf;
    };
    if (!master) master = take(0);
    batch.forEach((track, j) => stems.set(track, take(2 + j * 2)));
  }
  return { master, stems };
}
