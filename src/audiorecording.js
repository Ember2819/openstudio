// Records audio input into the playlist: arm Record with "audio" on (Options → Record), press Play, and when playback
// or recording stops the take becomes a sample and an audio clip on a free playlist track, where it was played.
// Loop recording: each pass of the loop (or any jump of the song position) becomes its own take, stacked on new
// tracks with the earlier passes muted, like FL Studio's loop takes.
import { AudioRecorder } from './audio/recorder.js';
import { messageDialog } from './ui/dialog.js';

export function installAudioRecording(app) {
  const { transport, engine } = app;
  const rec = new AudioRecorder(engine.ctx);
  app.recorder = rec;
  let take = null; // { t0, step0, jumps: [{ time, step }] } while capturing
  let arming = null;
  let busy = Promise.resolve();

  // monitoring keeps the input device open even when not recording
  let monitorTrack = null;
  const wanted = () => (transport.recording && transport.recordAudio) || monitorTrack != null;
  rec.setMonitor = async (track) => {
    monitorTrack = track;
    rec.monitorTrack = track;
    rec.monitor(track == null ? null : engine.track(track).input);
    await sync();
  };

  async function sync() {
    if (wanted() && !rec.armed) {
      if (!arming) {
        arming = rec.arm().catch((err) => {
          transport.setRecordAudio(false);
          monitorTrack = null;
          rec.monitorTrack = null;
          messageDialog('Audio recording', `${err.message}.\n\nChoose an input under Options → Audio input, and check that OpenStudio may use the microphone.`);
        }).finally(() => { arming = null; });
      }
      await arming;
      if (!rec.armed) return;
    }
    const taking = transport.recording && transport.recordAudio;
    // audio takes go into the playlist, so they record against the song
    if (taking && rec.armed && transport.mode !== 'song') transport.setMode('song');
    if (taking && transport.playing && rec.armed && !rec.capturing) startTake();
    if (rec.capturing && !(taking && transport.playing)) busy = busy.then(finishTake);
    if (!wanted() && rec.armed && !rec.capturing) { await busy; if (!wanted() && !rec.capturing) rec.disarm(); }
  }

  function startTake() {
    const ctx = engine.ctx;
    const q = transport.queue;
    // just started playing: the take begins exactly on the first scheduled step
    const first = q[0];
    take = first && first.time >= ctx.currentTime - 0.01
      ? { t0: first.time, step0: first.step, jumps: [] }
      : { t0: ctx.currentTime, step0: transport.position(), jumps: [] };
    rec.start(take.t0);
    app.emit?.('recording', true);
  }

  async function finishTake() {
    if (!take) return;
    const { t0, step0, jumps } = take;
    take = null;
    const ctx = engine.ctx;
    const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    const end = ctx.currentTime;
    const buffer = await rec.stop(end, latency);
    app.emit?.('recording', false);
    if (!buffer) return;
    const passes = splitTake(buffer, t0, step0, jumps.filter((j) => j.time > t0 && j.time < end));
    if (passes.length) app.actions.addAudioTakes(passes);
  }

  transport.on('change', () => { sync(); });
  transport.on('jump', (j) => { if (take && j.time > take.t0) take.jumps.push(j); });
  return rec;
}

/**
 * Cut a recorded buffer (which starts at audio time `t0`, song step `step0`) where the song position jumped, so each
 * pass of a loop is its own take. Passes shorter than 50 ms are dropped. Returns [{ buffer, step }].
 */
export function splitTake(buffer, t0, step0, jumps) {
  const sr = buffer.sampleRate;
  const cuts = [{ at: 0, step: step0 }, ...jumps.map((j) => ({ at: Math.round((j.time - t0) * sr), step: j.step }))]
    .filter((c) => c.at < buffer.length);
  const out = [];
  for (let i = 0; i < cuts.length; i++) {
    const from = cuts[i].at;
    const to = i + 1 < cuts.length ? cuts[i + 1].at : buffer.length;
    if ((to - from) / sr < 0.05) continue;
    if (from === 0 && to === buffer.length) { out.push({ buffer, step: cuts[i].step }); continue; }
    const part = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: to - from, sampleRate: sr });
    for (let c = 0; c < buffer.numberOfChannels; c++) part.copyToChannel(buffer.getChannelData(c).subarray(from, to), c);
    out.push({ buffer: part, step: cuts[i].step });
  }
  return out;
}
