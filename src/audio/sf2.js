// SoundFont 2 parser. Resolves presets into flat "regions" (one sample + all its generator values),
// which the sampler voice (soundfont.js) plays with native Web Audio nodes.

const G = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3, startAddrsCoarseOffset: 4,
  modLfoToPitch: 5, vibLfoToPitch: 6, modEnvToPitch: 7, initialFilterFc: 8, initialFilterQ: 9, modLfoToFilterFc: 10,
  modEnvToFilterFc: 11, endAddrsCoarseOffset: 12, modLfoToVolume: 13, pan: 17,
  delayModLFO: 21, freqModLFO: 22, delayVibLFO: 23, freqVibLFO: 24,
  delayModEnv: 25, attackModEnv: 26, holdModEnv: 27, decayModEnv: 28, sustainModEnv: 29, releaseModEnv: 30,
  delayVolEnv: 33, attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36, sustainVolEnv: 37, releaseVolEnv: 38,
  instrument: 41, keyRange: 43, velRange: 44, startloopAddrsCoarseOffset: 45, keynum: 46, velocity: 47,
  initialAttenuation: 48, endloopAddrsCoarseOffset: 50, coarseTune: 51, fineTune: 52, sampleID: 53, sampleModes: 54,
  scaleTuning: 56, exclusiveClass: 57, overridingRootKey: 58,
};

const DEFAULTS = {
  [G.initialFilterFc]: 13500,
  [G.delayModLFO]: -12000, [G.delayVibLFO]: -12000, [G.delayModEnv]: -12000, [G.attackModEnv]: -12000, [G.holdModEnv]: -12000,
  [G.decayModEnv]: -12000, [G.releaseModEnv]: -12000, [G.delayVolEnv]: -12000, [G.attackVolEnv]: -12000, [G.holdVolEnv]: -12000,
  [G.decayVolEnv]: -12000, [G.releaseVolEnv]: -12000, [G.scaleTuning]: 100, [G.overridingRootKey]: -1,
  [G.freqModLFO]: 0, [G.freqVibLFO]: 0,
};

const tc = (cents) => (cents <= -12000 ? 0 : Math.pow(2, cents / 1200));
const absHz = (cents) => 8.176 * Math.pow(2, cents / 1200);

export class SoundFont {
  constructor(arrayBuffer) {
    this.buf = arrayBuffer;
    this.dv = new DataView(arrayBuffer);
    this.bufferCache = new Map();
    this._parse();
    this._buildPresets();
  }

  _str(off, len) {
    let s = '';
    for (let i = 0; i < len; i++) { const c = this.dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  }

  _parse() {
    const dv = this.dv;
    if (this._str(0, 4) !== 'RIFF' || this._str(8, 4) !== 'sfbk') throw new Error('Not a SoundFont 2 file');
    const chunks = {};
    let pos = 12;
    while (pos + 8 <= dv.byteLength) {
      const id = this._str(pos, 4);
      const size = dv.getUint32(pos + 4, true);
      if (id === 'LIST') {
        let p = pos + 12;
        const end = pos + 8 + size;
        while (p + 8 <= end) {
          const sid = this._str(p, 4);
          const ssize = dv.getUint32(p + 4, true);
          chunks[sid] = { off: p + 8, size: ssize };
          p += 8 + ssize + (ssize & 1);
        }
      }
      pos += 8 + size + (size & 1);
    }
    this.smpl = chunks.smpl;
    const rec = (name, rsize, fn) => {
      const c = chunks[name];
      const n = Math.floor(c.size / rsize);
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = fn(c.off + i * rsize);
      return out;
    };
    this.phdr = rec('phdr', 38, (o) => ({ name: this._str(o, 20), preset: dv.getUint16(o + 20, true), bank: dv.getUint16(o + 22, true), bag: dv.getUint16(o + 24, true) }));
    this.pbag = rec('pbag', 4, (o) => ({ gen: dv.getUint16(o, true) }));
    this.pgen = rec('pgen', 4, (o) => ({ op: dv.getUint16(o, true), lo: dv.getUint8(o + 2), hi: dv.getUint8(o + 3), s: dv.getInt16(o + 2, true) }));
    this.inst = rec('inst', 22, (o) => ({ name: this._str(o, 20), bag: dv.getUint16(o + 20, true) }));
    this.ibag = rec('ibag', 4, (o) => ({ gen: dv.getUint16(o, true) }));
    this.igen = rec('igen', 4, (o) => ({ op: dv.getUint16(o, true), lo: dv.getUint8(o + 2), hi: dv.getUint8(o + 3), s: dv.getInt16(o + 2, true) }));
    this.shdr = rec('shdr', 46, (o) => ({
      name: this._str(o, 20), start: dv.getUint32(o + 20, true), end: dv.getUint32(o + 24, true),
      startLoop: dv.getUint32(o + 28, true), endLoop: dv.getUint32(o + 32, true), rate: dv.getUint32(o + 36, true),
      pitch: dv.getUint8(o + 40), corr: dv.getInt8(o + 41), type: dv.getUint16(o + 44, true),
    }));
  }

  _zones(bags, gens, from, to) {
    const zones = [];
    for (let b = from; b < to; b++) {
      const z = {};
      for (let g = bags[b].gen; g < bags[b + 1].gen; g++) z[gens[g].op] = gens[g];
      zones.push(z);
    }
    return zones;
  }

  _buildPresets() {
    this.presets = [];
    this.byKey = new Map();
    for (let p = 0; p < this.phdr.length - 1; p++) {
      const h = this.phdr[p];
      const preset = { name: h.name, bank: h.bank, program: h.preset, index: p, _regions: null };
      preset.zones = this._zones(this.pbag, this.pgen, h.bag, this.phdr[p + 1].bag);
      this.presets.push(preset);
      this.byKey.set(`${h.bank}:${h.preset}`, preset);
    }
  }

  getPreset(bank, program) { return this.byKey.get(`${bank}:${program}`) || null; }

  /** All regions of a preset (resolved once and cached). */
  regions(preset) {
    if (preset._regions) return preset._regions;
    const out = [];
    const pZones = preset.zones;
    const pGlobal = pZones.length && pZones[0][G.instrument] == null ? pZones[0] : null;
    for (const pz of pZones) {
      const instGen = pz[G.instrument];
      if (!instGen) continue;
      const instIndex = instGen.s & 0xffff;
      const inst = this.inst[instIndex];
      const iZones = this._zones(this.ibag, this.igen, inst.bag, this.inst[instIndex + 1].bag);
      const iGlobal = iZones.length && iZones[0][G.sampleID] == null ? iZones[0] : null;
      for (const iz of iZones) {
        if (iz[G.sampleID] == null) continue;
        const region = this._region(pz, pGlobal, iz, iGlobal);
        if (region) out.push(region);
      }
    }
    preset._regions = out;
    return out;
  }

  _region(pz, pg, iz, ig) {
    const inst = (id) => {
      const g = iz[id] ?? ig?.[id];
      return g ? g.s : (DEFAULTS[id] ?? 0);
    };
    const add = (id) => {
      const g = pz[id] ?? pg?.[id];
      return inst(id) + (g ? g.s : 0);
    };
    const range = (id) => {
      const gi = iz[id] ?? ig?.[id];
      const gp = pz[id] ?? pg?.[id];
      let lo = gi ? gi.lo : 0, hi = gi ? gi.hi : 127;
      if (gp) { lo = Math.max(lo, gp.lo); hi = Math.min(hi, gp.hi); }
      return [lo, hi];
    };
    const [keyLo, keyHi] = range(G.keyRange);
    const [velLo, velHi] = range(G.velRange);
    if (keyLo > keyHi || velLo > velHi) return null;

    const sampleIdx = (iz[G.sampleID]).s & 0xffff;
    const sh = this.shdr[sampleIdx];
    if (!sh || sh.type & 0x8000) return null; // ROM sample

    const start = sh.start + inst(G.startAddrsOffset) + inst(G.startAddrsCoarseOffset) * 32768;
    const end = sh.end + inst(G.endAddrsOffset) + inst(G.endAddrsCoarseOffset) * 32768;
    const loopStart = sh.startLoop + inst(G.startloopAddrsOffset) + inst(G.startloopAddrsCoarseOffset) * 32768;
    const loopEnd = sh.endLoop + inst(G.endloopAddrsOffset) + inst(G.endloopAddrsCoarseOffset) * 32768;
    const mode = inst(G.sampleModes) & 3;
    const rootKey = inst(G.overridingRootKey) >= 0 ? inst(G.overridingRootKey) : (sh.pitch === 255 ? 60 : sh.pitch);

    const sustainDb = Math.min(144, Math.max(0, add(G.sustainVolEnv) / 10));
    return {
      keyLo, keyHi, velLo, velHi,
      sampleIdx, start, end, loopStart, loopEnd, rate: sh.rate,
      loop: (mode === 1 || mode === 3) && loopEnd - loopStart > 8,
      loopUntilRelease: mode === 3,
      rootKey,
      tuneCents: add(G.coarseTune) * 100 + add(G.fineTune) + sh.corr,
      scale: add(G.scaleTuning),
      attenDb: Math.max(0, add(G.initialAttenuation) / 10),
      pan: Math.max(-1, Math.min(1, add(G.pan) / 500)),
      delay: tc(add(G.delayVolEnv)), attack: tc(add(G.attackVolEnv)), hold: tc(add(G.holdVolEnv)),
      decay: tc(add(G.decayVolEnv)), sustainDb, release: tc(add(G.releaseVolEnv)),
      fc: add(G.initialFilterFc), q: Math.max(0, add(G.initialFilterQ) / 10),
      modEnv: {
        delay: tc(add(G.delayModEnv)), attack: tc(add(G.attackModEnv)), hold: tc(add(G.holdModEnv)),
        decay: tc(add(G.decayModEnv)), sustain: 1 - Math.min(1000, Math.max(0, add(G.sustainModEnv))) / 1000, release: tc(add(G.releaseModEnv)),
        toFc: add(G.modEnvToFilterFc), toPitch: add(G.modEnvToPitch),
      },
      vib: { toPitch: add(G.vibLfoToPitch), freq: absHz(add(G.freqVibLFO)), delay: tc(add(G.delayVibLFO)) },
      mod: { toPitch: add(G.modLfoToPitch), toFc: add(G.modLfoToFilterFc), freq: absHz(add(G.freqModLFO)), delay: tc(add(G.delayModLFO)) },
      exclusive: inst(G.exclusiveClass),
    };
  }

  /** Regions of `preset` that sound for the given key and velocity (0..127). */
  match(preset, key, vel) {
    return this.regions(preset).filter((r) => key >= r.keyLo && key <= r.keyHi && vel >= r.velLo && vel <= r.velHi);
  }

  /** Float32 PCM for a region (trimmed to its start/end), as a context-independent AudioBuffer. */
  audioBuffer(region) {
    const id = `${region.sampleIdx}:${region.start}:${region.end}`;
    let buf = this.bufferCache.get(id);
    if (buf) return buf;
    const len = Math.max(1, region.end - region.start);
    const pcm = new Int16Array(this.buf, this.smpl.off + region.start * 2, len);
    buf = new AudioBuffer({ length: len, sampleRate: region.rate, numberOfChannels: 1 });
    const out = buf.getChannelData(0);
    for (let i = 0; i < len; i++) out[i] = pcm[i] / 32768;
    this.bufferCache.set(id, buf);
    return buf;
  }
}

export const GM_FAMILIES = [
  'Piano', 'Chromatic percussion', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass',
  'Reed', 'Pipe', 'Synth lead', 'Synth pad', 'Synth effects', 'Ethnic', 'Percussive', 'Sound effects',
];

// General MIDI percussion key names (35 = Acoustic Bass Drum ... 81 = Open Triangle)
export const GM_DRUM_NAMES = {
  27: 'High Q', 28: 'Slap', 29: 'Scratch Push', 30: 'Scratch Pull', 31: 'Sticks', 32: 'Square Click', 33: 'Metronome Click', 34: 'Metronome Bell',
  35: 'Kick 2', 36: 'Kick', 37: 'Side Stick', 38: 'Snare', 39: 'Clap', 40: 'Snare 2', 41: 'Low Floor Tom', 42: 'Closed Hat', 43: 'High Floor Tom',
  44: 'Pedal Hat', 45: 'Low Tom', 46: 'Open Hat', 47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash', 50: 'High Tom', 51: 'Ride', 52: 'Chinese Cymbal',
  53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash', 56: 'Cowbell', 57: 'Crash 2', 58: 'Vibraslap', 59: 'Ride 2', 60: 'Hi Bongo', 61: 'Low Bongo',
  62: 'Mute Hi Conga', 63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale', 67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa',
  70: 'Maracas', 71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro', 75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block',
  78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle', 82: 'Shaker', 83: 'Jingle Bell', 84: 'Bell Tree', 85: 'Castanets',
  86: 'Mute Surdo', 87: 'Open Surdo',
};
