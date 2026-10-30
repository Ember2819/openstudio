// Audio input recording: an input device is opened when recording is armed, an AudioWorklet copies its frames, and
// a take is the audio between two audio-clock times. Raw PCM (not MediaRecorder), so takes are lossless and line up
// with the song to the sample.
import { Emitter } from '../util.js';

const DEVICE_KEY = 'openstudio.audioInput';

export class AudioRecorder extends Emitter {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.chunks = [];
    this.capturing = false;
    this.from = 0; // audio-clock time where the take starts
    this.level = 0; // recent input peak, for meters
    this.deviceId = globalThis.localStorage?.getItem(DEVICE_KEY) || '';
    this.known = []; // last device list, for menus (which must be built synchronously)
    this.refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
  }

  refreshDevices() {
    return this.devices().then((list) => { this.known = list; return list; }, () => this.known);
  }

  get armed() { return !!this.node; }

  /** Audio inputs the browser can see (labels need permission, so they may be blank until the first arm). */
  async devices() {
    const list = await navigator.mediaDevices?.enumerateDevices?.() ?? [];
    return list.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, name: d.label || `Input ${i + 1}` }));
  }

  async setDevice(id) {
    this.deviceId = id || '';
    globalThis.localStorage?.setItem(DEVICE_KEY, this.deviceId);
    if (this.armed && !this.capturing) { this.disarm(); await this.arm(); }
    this.emit('change');
  }

  /** Open the input device and start listening (nothing is kept until start()). */
  async arm() {
    if (this.node) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Audio input is not available here');
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
    if (this.deviceId) audio.deviceId = { exact: this.deviceId };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      if (this.deviceId && err.name === 'OverconstrainedError') { await this.setDevice(''); return this.arm(); }
      throw new Error(err.name === 'NotAllowedError' ? 'Access to the audio input was refused' : err.name === 'NotFoundError' ? 'No audio input device was found' : err.message, { cause: err });
    }
    if (!AudioRecorder.loaded?.has(this.ctx)) {
      await this.ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
      (AudioRecorder.loaded ||= new WeakSet()).add(this.ctx);
    }
    this.stream = stream;
    this.refreshDevices(); // labels are visible now that we have permission
    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, 'openstudio-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0; // the worklet must reach the destination to be processed, silently
    this.source.connect(this.node).connect(this.sink).connect(this.ctx.destination);
    this.node.port.onmessage = (e) => {
      const { t, l, r } = e.data;
      let peak = 0;
      for (let i = 0; i < l.length; i += 16) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
      this.level = Math.max(peak, this.level * 0.7);
      if (this.capturing) this.chunks.push({ t, l, r });
    };
    this.emit('change');
  }

  disarm() {
    if (!this.node) return;
    this.node.port.postMessage('close');
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    for (const tr of this.stream.getTracks()) tr.stop();
    this.stream = this.source = this.node = this.sink = null;
    this.capturing = false;
    this.chunks = [];
    this.level = 0;
    this.emit('change');
  }

  /** Keep everything from audio-clock time `from` on. */
  start(from) {
    this.chunks = [];
    this.from = from;
    this.capturing = true;
  }

  /**
   * Finish the take (it ends at audio-clock time `to`, default now). `latency`: how many seconds the input lags what
   * the performer heard, so the take is moved that much earlier. Resolves to an AudioBuffer, or null if empty.
   */
  async stop(to = this.ctx.currentTime, latency = 0) {
    if (!this.capturing) return null;
    // keep listening until the last frames (late by `latency`) are in; batches are ~90 ms long
    await new Promise((r) => setTimeout(r, 160 + latency * 1000));
    this.capturing = false;
    const shift = latency;
    const chunks = this.chunks;
    this.chunks = [];
    const sr = this.ctx.sampleRate;
    const from = this.from + shift;
    const until = to + shift;
    const frames = Math.max(0, Math.round((until - from) * sr));
    if (!frames || !chunks.length) return null;
    const out = new AudioBuffer({ numberOfChannels: 2, length: frames, sampleRate: sr });
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    for (const c of chunks) {
      const at = Math.round((c.t - from) * sr);
      for (let i = 0; i < c.l.length; i++) {
        const k = at + i;
        if (k < 0 || k >= frames) continue;
        L[k] = c.l[i];
        R[k] = c.r[i];
      }
    }
    return out;
  }
}
