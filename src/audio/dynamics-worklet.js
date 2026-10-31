/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Envelope follower → gain, for the Gate and the Sidechain compressor (see effects.js). Input 0 is the key signal;
// the output is the gain to apply (connected to a GainNode's gain), one value per sample.
//   mode 0 (compressor): gain = (thr / env)^(1 - 1/ratio) above the threshold, never below `floor`
//   mode 1 (gate): gain opens to 1 when env is over the threshold, else falls to `floor`; `hold` keeps it open a bit
class OpenStudioDynamics extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: 0.1, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, automationRate: 'k-rate' },
      { name: 'floor', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.002, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.1, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 0.02, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
    this.held = 0;
    this.alive = true;
    this.port.onmessage = (e) => { if (e.data === 'close') this.alive = false; };
  }

  process(inputs, outputs, p) {
    const out = outputs[0][0];
    if (!out) return this.alive;
    const input = inputs[0];
    const l = input[0];
    const r = input[1] || l;
    const coef = (t) => (t > 0 ? Math.exp(-1 / (t * sampleRate)) : 0);
    const att = coef(p.attack[0]);
    const rel = coef(p.release[0]);
    const thr = p.threshold[0];
    const floor = p.floor[0];
    const gate = p.mode[0] >= 0.5;
    const slope = 1 - 1 / Math.max(1, p.ratio[0]);
    const holdN = p.hold[0] * sampleRate;
    for (let i = 0; i < out.length; i++) {
      const x = l ? Math.max(Math.abs(l[i]), Math.abs(r[i])) : 0;
      this.env = x > this.env ? att * this.env + (1 - att) * x : rel * this.env + (1 - rel) * x;
      if (gate) {
        if (this.env >= thr) this.held = holdN;
        const target = this.held > 0 ? 1 : floor;
        if (this.held > 0) this.held--;
        // open fast, close with the release
        this.gain = target > this.gain ? att * this.gain + (1 - att) * target : rel * this.gain + (1 - rel) * target;
        out[i] = this.gain;
      } else {
        const g = this.env > thr ? Math.pow(thr / this.env, slope) : 1;
        out[i] = Math.max(floor, g);
      }
    }
    return this.alive;
  }
}

registerProcessor('openstudio-dynamics', OpenStudioDynamics);
