// Plays SoundFont regions with native Web Audio nodes: buffer source -> lowpass -> amp envelope (-> pan).
const dbGain = (db) => Math.pow(10, db / 20);
// SoundFont banks are mastered quiet; bring them up to the level of the built-in synth voices
const SAMPLER_GAIN = 2.4;
const absHz = (cents) => 8.176 * Math.pow(2, cents / 1200);

/**
 * Start one note on a soundfont preset.
 * key: MIDI key to sound, vel: 0..1, dur: seconds (Infinity = held)
 * p: channel params { tune, attack, release, cutoff }
 * exclusive: Map used to choke exclusive classes (hi-hats) per channel
 */
export function playSoundfont(ctx, dest, sf, preset, key, vel, t, dur, p, exclusive, chId) {
  const vel127 = Math.max(1, Math.min(127, Math.round(vel * 127)));
  const regions = sf.match(preset, key, vel127);
  if (!regions.length) return null;

  const isDrum = preset.bank === 128;
  const top = ctx.createGain();
  top.connect(dest);
  const velGain = 0.12 + 0.88 * Math.pow(vel, 1.4);
  const parts = [];
  const nodes = [];
  const exclusiveKeys = new Set();
  let end = 0;
  let sustained = false;

  for (const r of regions) {
    const buf = sf.audioBuffer(r);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const cents = (key - r.rootKey) * (r.scale / 100) * 100 + r.tuneCents + (p.tune || 0) * 100;
    const rate = Math.pow(2, cents / 1200);
    src.playbackRate.value = rate;
    if (r.loop) {
      src.loop = true;
      src.loopStart = (r.loopStart - r.start) / r.rate;
      src.loopEnd = Math.min(buf.duration, (r.loopEnd - r.start) / r.rate);
    }
    nodes.push(src);

    // --- filter
    const velCents = 2400 * Math.pow(1 - vel, 2);
    const baseCents = Math.min(r.fc, 13500) - velCents;
    let fcHz = Math.min(absHz(baseCents), p.cutoff ?? 20000);
    const needFilter = fcHz < 17500 || r.modEnv.toFc !== 0 || r.mod.toFc !== 0;
    let filter = null;
    let chain = src;
    if (needFilter) {
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = Math.min(r.q, 30);
      fcHz = Math.max(30, Math.min(fcHz, ctx.sampleRate * 0.45));
      filter.frequency.setValueAtTime(fcHz, t);
      chain.connect(filter);
      chain = filter;
    }

    // --- amplitude envelope
    const level = dbGain(-r.attenDb) * velGain * SAMPLER_GAIN;
    const amp = ctx.createGain();
    const t0 = t + r.delay;
    const attack = Math.max(r.attack + (p.attack || 0), 0.002);
    amp.gain.setValueAtTime(0, t);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(level, t0 + attack);
    const holdEnd = t0 + attack + r.hold;
    amp.gain.setValueAtTime(level, holdEnd);
    const sus = level * dbGain(-r.sustainDb);
    amp.gain.setTargetAtTime(sus, holdEnd, Math.max(r.decay, 0.002) / 11.5);
    chain.connect(amp);
    let tail = amp;
    if (Math.abs(r.pan) > 0.01) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = r.pan;
      amp.connect(pan);
      tail = pan;
    }
    tail.connect(top);

    // --- filter envelope
    if (filter && r.modEnv.toFc !== 0) {
      const me = r.modEnv;
      const f0 = fcHz;
      const peak = Math.max(30, Math.min(fcHz * Math.pow(2, me.toFc / 1200), ctx.sampleRate * 0.45));
      const mt = t + me.delay;
      filter.frequency.cancelScheduledValues(t);
      filter.frequency.setValueAtTime(f0, mt);
      filter.frequency.exponentialRampToValueAtTime(peak, mt + Math.max(me.attack, 0.002));
      const mh = mt + Math.max(me.attack, 0.002) + me.hold;
      filter.frequency.setValueAtTime(peak, mh);
      const susF = Math.max(30, f0 * Math.pow(peak / f0, me.sustain));
      filter.frequency.setTargetAtTime(susF, mh, Math.max(me.decay, 0.002) / 4);
    }

    // --- LFOs (vibrato / modulation)
    const lfos = [];
    const addLfo = (cfg, target, amount) => {
      if (!amount) return;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = cfg.freq || 8.176;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(amount, t + cfg.delay);
      lfo.connect(g).connect(target);
      lfo.start(t);
      lfos.push(lfo);
      nodes.push(lfo);
    };
    addLfo(r.vib, src.detune, r.vib.toPitch);
    addLfo(r.mod, src.detune, r.mod.toPitch);
    if (filter) addLfo(r.mod, filter.detune, r.mod.toFc);

    const offset = 0;
    src.start(t, offset);
    const natural = buf.duration / rate;
    const partEnd = r.loop ? Infinity : t0 + natural + 0.05;
    if (r.loop) sustained = true;
    else lfos.forEach((l) => l.stop(partEnd));
    end = Math.max(end, partEnd);

    const part = {
      src, amp, lfos, r, dead: false,
      release(rt, scale = 1) {
        if (part.dead) return;
        part.dead = true;
        amp.gain.cancelAndHoldAtTime(rt);
        const rel = Math.min(Math.max(r.release * scale, 0.012), 8);
        amp.gain.setTargetAtTime(0, rt, rel / 6);
        if (r.loopUntilRelease) src.loop = false;
        const stopAt = rt + rel * 1.6 + 0.05;
        try { src.stop(stopAt); lfos.forEach((l) => l.stop(stopAt)); } catch { /* already stopped */ }
        part.end = stopAt;
      },
    };
    parts.push(part);

    if (r.exclusive) exclusiveKeys.add(`${chId}:${r.exclusive}`);
  }

  const voice = { nodes, out: top, end: sustained ? Infinity : end, parts, released: false, pitchParams: parts.map((x) => x.src.detune) };
  voice.release = (when) => {
    if (voice.released || isDrum) return; // GM percussion ignores note-off
    voice.released = true;
    const rel = p.release ?? 1;
    let latest = 0;
    for (const part of parts) { part.release(Math.max(when, t + 0.002), rel); latest = Math.max(latest, part.end || 0); }
    voice.end = latest;
  };
  voice.kill = (when) => {
    voice.released = true;
    let latest = 0;
    for (const part of parts) {
      if (part.dead) continue;
      part.dead = true;
      part.amp.gain.cancelAndHoldAtTime(when);
      part.amp.gain.setTargetAtTime(0, when, 0.004);
      try { part.src.stop(when + 0.04); part.lfos.forEach((l) => l.stop(when + 0.04)); } catch { /* stopped */ }
      latest = when + 0.05;
    }
    voice.end = Math.max(latest, 0);
  };
  // exclusive classes (e.g. a closed hat chokes an open hat on the same channel)
  for (const k of exclusiveKeys) {
    const prev = exclusive.get(k);
    if (prev) prev.kill(t);
    exclusive.set(k, voice);
  }
  if (Number.isFinite(dur)) voice.release(t + dur);
  return voice;
}
