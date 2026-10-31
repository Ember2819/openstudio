// Records audio input into the playlist: arm Record with "audio" on (Options → Record), press Play, and when playback
// or recording stops the take becomes a sample and an audio clip on a free playlist track, where it was played.
import { AudioRecorder } from './audio/recorder.js';
import { messageDialog } from './ui/dialog.js';

export function installAudioRecording(app) {
  const { transport, engine } = app;
  const rec = new AudioRecorder(engine.ctx);
  app.recorder = rec;
  let take = null; // { t0, step0 } while capturing
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
      ? { t0: first.time, step0: first.step }
      : { t0: ctx.currentTime, step0: transport.position() };
    rec.start(take.t0);
    app.emit?.('recording', true);
  }

  async function finishTake() {
    if (!take) return;
    const { t0, step0 } = take;
    take = null;
    const ctx = engine.ctx;
    const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    const buffer = await rec.stop(ctx.currentTime, latency);
    app.emit?.('recording', false);
    if (!buffer || buffer.duration < 0.05) return;
    app.actions.addAudioTake(buffer, step0, t0);
  }

  transport.on('change', () => { sync(); });
  return rec;
}
