// AudioWorklet that hands raw input frames to the main thread in batches (see recorder.js).
/* global AudioWorkletProcessor, registerProcessor, currentTime, sampleRate */
const BATCH = 4096;

class OpenStudioRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.l = new Float32Array(BATCH);
    this.r = new Float32Array(BATCH);
    this.n = 0;
    this.t = 0;
    this.port.onmessage = (e) => { if (e.data === 'close') this.alive = false; };
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const l = input[0];
      const r = input[1] || input[0];
      if (this.n === 0) this.t = currentTime;
      const take = Math.min(l.length, BATCH - this.n);
      this.l.set(l.subarray(0, take), this.n);
      this.r.set(r.subarray(0, take), this.n);
      this.n += take;
      if (this.n >= BATCH) {
        this.port.postMessage({ t: this.t, l: this.l, r: this.r }, [this.l.buffer, this.r.buffer]);
        this.l = new Float32Array(BATCH);
        this.r = new Float32Array(BATCH);
        this.n = 0;
        if (take < l.length) {
          this.t = currentTime + take / sampleRate;
          this.l.set(l.subarray(take));
          this.r.set(r.subarray(take));
          this.n = l.length - take;
        }
      }
    }
    return this.alive;
  }
}

registerProcessor('openstudio-recorder', OpenStudioRecorder);
