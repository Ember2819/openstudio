// Runs inside the renderer (see scripts/e2e.mjs). Renders every synthesized voice and every preset offline and
// checks the result is audible, finite, not wildly hot — and that the pitched engines are in tune.
(async () => {
  const log = [];
  const ok = (name, cond, detail = '') => log.push(`${cond ? 'ok' : 'FAIL'} ${name}${cond ? '' : ` ${detail}`}`);
  const inst = await import('./src/audio/instruments.js');
  const SR = 44100;

  async function render(play, seconds = 2.2) {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const dest = ctx.createGain();
    dest.connect(ctx.destination);
    play(ctx, dest);
    const buf = await ctx.startRendering();
    return buf.getChannelData(0);
  }
  const stats = (d) => {
    let peak = 0, bad = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (!Number.isFinite(a)) bad++; else if (a > peak) peak = a; }
    return { peak, bad };
  };
  /** Fundamental by autocorrelation over a window in the steady part of the sound. */
  function hzOf(d, from = 0.12, len = 0.2) {
    const a = Math.floor(from * SR), n = Math.floor(len * SR);
    let best = 0, bestLag = 0;
    const minLag = Math.floor(SR / 2000), maxLag = Math.floor(SR / 40);
    const ac = (lag) => { let s = 0; for (let i = 0; i < n; i++) s += d[a + i] * d[a + i + lag]; return s; };
    const r0 = ac(0);
    for (let lag = minLag; lag < maxLag; lag++) { const r = ac(lag); if (r > best) { best = r; bestLag = lag; } }
    // prefer the shortest lag whose correlation is close to the best (avoids octave-down picks)
    for (let lag = minLag; lag < bestLag; lag++) if (ac(lag) > best * 0.92 && ac(lag) > ac(lag - 1) && ac(lag) >= ac(lag + 1)) return SR / lag;
    return r0 > 0 ? SR / bestLag : 0;
  }

  // drum voices
  for (const d of inst.DRUM_KIT) {
    const out = await render((ctx, dest) => inst.playDrum(ctx, dest, d.voice, 0.05, 0.9, 0, inst.defaultParams('drum')));
    const s = stats(out);
    ok(`drum ${d.voice} is audible and finite`, s.peak > 0.03 && s.peak < 3 && !s.bad, JSON.stringify(s));
  }

  // every preset of every engine
  const play = {
    synth: inst.playSynth, fm: inst.playFm, organ: inst.playOrgan, pluck: inst.playPluck, wavetable: inst.playWavetable,
    sfx: (ctx, dest, pitch, t, dur, vel, semis, p) => inst.playSfx(ctx, dest, t, dur, vel, pitch - 60 + semis, p),
  };
  for (const [type, cats] of Object.entries(inst.ENGINE_PRESETS)) {
    for (const [cat, list] of Object.entries(cats)) {
      for (const p of list) {
        const params = { ...inst.defaultParams(type), ...p.params };
        const pitch = /bass/i.test(cat) ? 45 : 60;
        const out = await render((ctx, dest) => play[type](ctx, dest, pitch, 0.05, 0.6, 0.85, 0, params), type === 'sfx' ? 3.2 : 2.2);
        const s = stats(out);
        ok(`${type} preset ${p.name} is audible and finite`, s.peak > 0.02 && s.peak < 3 && !s.bad, JSON.stringify(s));
      }
    }
  }

  // tuning: A4 (MIDI 69) must come out at 440 Hz from every pitched engine, and an octave up at 880
  const tune = async (label, type, params, tol = 0.012) => {
    for (const [pitch, want] of [[69, 440], [81, 880], [45, 110]]) {
      const out = await render((ctx, dest) => play[type](ctx, dest, pitch, 0, Infinity, 0.8, 0, { ...inst.defaultParams(type), ...params }), 1);
      const hz = hzOf(out);
      ok(`${label} plays ${want} Hz at MIDI ${pitch}`, Math.abs(hz / want - 1) < tol, `got ${hz.toFixed(1)}`);
    }
  };
  await tune('subtractive synth', 'synth', { wave1: 'sawtooth', mix: 0, cutoff: 8000, attack: 0.001, release: 0.1 });
  await tune('FM synth', 'fm', { ratio: 1, index: 0.5, indexSus: 1, sustain: 1, decay: 2 });
  await tune('organ (8′ and up)', 'organ', { d16: 0, d513: 0 });
  await tune('plucked string', 'pluck', { decay: 3, bright: 0.5, damp: 0.3 });
  for (const table of (await import('./src/audio/wavetable.js')).WAVETABLES) {
    if (table === 'Digital' || table === 'Vowels') continue; // sparse / formant spectra: the fundamental is weak by design
    await tune(`wavetable "${table}"`, 'wavetable', { table, position: 0.5, cutoff: 18000, envAmt: 0, attack: 0.001, sustain: 1 });
  }

  // the wavetable position morphs: sine (0) is dull, square (1) is bright
  const bright = async (position) => {
    const d = await render((ctx, dest) => inst.playWavetable(ctx, dest, 57, 0, Infinity, 0.8, 0, { ...inst.defaultParams('wavetable'), table: 'Basic shapes', position, cutoff: 18000, envAmt: 0, attack: 0.001, sustain: 1 }), 0.5);
    let e = 0, de = 0;
    for (let i = 2000; i < 20000; i++) { e += d[i] * d[i]; de += (d[i] - d[i - 1]) ** 2; }
    return de / e;
  };
  const dull = await bright(0), sharp = await bright(1);
  ok('wavetable position morphs from sine to square', sharp > dull * 5, `${dull.toFixed(4)} vs ${sharp.toFixed(4)}`);

  // the pluck cache must not hand back a buffer for a different pitch or setting
  const a = await render((ctx, dest) => inst.playPluck(ctx, dest, 57, 0, 0.5, 0.8, 0, { ...inst.defaultParams('pluck'), decay: 1 }), 0.6);
  const b = await render((ctx, dest) => inst.playPluck(ctx, dest, 64, 0, 0.5, 0.8, 0, { ...inst.defaultParams('pluck'), decay: 1 }), 0.6);
  ok('pluck cache keeps pitches apart', Math.abs(hzOf(a) / hzOf(b) - 220 / 329.63) < 0.02, `${hzOf(a).toFixed(1)} vs ${hzOf(b).toFixed(1)}`);

  // an idle mixer strip is not built; using it builds it with the right settings
  const { Engine } = await import('./src/audio/engine.js');
  const app = window.openstudio;
  const ctx2 = new OfflineAudioContext(2, 4410, SR);
  const eng = new Engine(app.store, ctx2);
  const built = eng.tracks.filter(Boolean).length;
  ok('only the strips in use are built', built > 0 && built < 20, `built ${built}`);
  app.store.project.mixer[90].vol = 0.5;
  app.store.emit('mixer');
  ok('a strip is built when it is touched', !!eng.tracks[90]);
  eng.dispose();

  // slide notes bend the sounding note; Mod X closes the filter
  const engineRender = async (seconds, fn) => {
    const ctx = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
    const e = new Engine(app.store, ctx);
    await e.ready;
    const play = (spec, ...args) => {
      const node = e._channelNode(spec);
      if (node.mixer !== 'test') { node.mute.disconnect(); node.mute.connect(ctx.destination); node.mixer = 'test'; }
      return e.playNote(spec, ...args);
    };
    fn(play);
    const buf = await ctx.startRendering();
    e.dispose();
    return buf.getChannelData(0);
  };
  const steady = { attack: 0.001, sustain: 1, decay: 0.05, release: 0.05, envAmt: 0 };
  for (const type of ['synth', 'fm', 'wavetable', 'organ']) {
    const spec = { id: -40, type, params: { ...inst.defaultParams(type), ...steady, wave1: 'sawtooth', mix: 0, cutoff: 9000, ratio: 1, index: 0.3, indexSus: 1, d16: 0, d513: 0, table: 'Basic shapes', position: 0.66 } };
    const d = await engineRender(1.2, (play) => {
      play(spec, 57, 0.8, 0, 1.1);
      play(spec, 69, 0.8, 0.35, 0.2, { p: 69, sl: true });
    });
    const before = hzOf(d, 0.1, 0.2), after = hzOf(d, 0.7, 0.2);
    ok(`${type} slide note glides 220 → 440 Hz and stays`, Math.abs(before / 220 - 1) < 0.02 && Math.abs(after / 440 - 1) < 0.02, `${before.toFixed(1)} → ${after.toFixed(1)}`);
  }
  {
    const spec = { id: -41, type: 'sampler', sampleId: null, params: inst.defaultParams('sampler') };
    const silent = await engineRender(0.4, (play) => { play(spec, 60, 0.8, 0, 0.3, { p: 60, sl: true }); });
    ok('a slide note with nothing under it is silent', stats(silent).peak === 0);
  }
  {
    const spec = { id: -42, type: 'synth', params: { ...inst.defaultParams('synth'), ...steady, wave1: 'sawtooth', mix: 0, cutoff: 6000, res: 0.7 } };
    const bright = await engineRender(0.5, (play) => { play(spec, 57, 0.8, 0, 0.4); });
    const dark = await engineRender(0.5, (play) => { play(spec, 57, 0.8, 0, 0.4, { p: 57, mx: -0.8 }); });
    const hf = (d, from = 4411, to = 15000) => { let s = 0; for (let i = from; i < to; i++) s += (d[i] - d[i - 1]) ** 2; return s; };
    ok('Mod X closes the cutoff of the note', hf(dark) < hf(bright) * 0.2, `${hf(dark).toFixed(3)} vs ${hf(bright).toFixed(3)}`);
    const drum = { id: -43, type: 'drum', voice: 'hat', params: inst.defaultParams('drum') };
    const hat = await engineRender(0.3, (play) => { play(drum, 60, 0.9, 0, 0.1); });
    const dull = await engineRender(0.3, (play) => { play(drum, 60, 0.9, 0, 0.1, { p: 60, mx: -1 }); });
    ok('Mod X filters instruments without a cutoff control', hf(dull, 1, 6000) < hf(hat, 1, 6000) * 0.2, `${hf(dull, 1, 6000).toFixed(4)} vs ${hf(hat, 1, 6000).toFixed(4)}`);
  }

  // multi-sample zones: each key plays the nearest zone's sample from that zone's root
  {
    const sine = (hz) => {
      const b = new AudioBuffer({ numberOfChannels: 1, length: SR, sampleRate: SR });
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR);
      return b;
    };
    const ids = [9001, 9002];
    app.store.samples.set(ids[0], { name: 'low A2.wav', data: new ArrayBuffer(0), buffer: sine(110) });
    app.store.samples.set(ids[1], { name: 'high A4.wav', data: new ArrayBuffer(0), buffer: sine(440) });
    const spec = { id: -44, type: 'sampler', sampleId: ids[0], params: inst.defaultParams('sampler'), zones: [{ sampleId: ids[0], root: 45, lo: 0, hi: 56 }, { sampleId: ids[1], root: 69, lo: 57, hi: 127 }] };
    for (const [key, want] of [[45, 110], [47, 123.47], [69, 440], [64, 329.63]]) {
      const d = await engineRender(0.5, (play) => { play(spec, key, 0.8, 0, 0.4); });
      const hz = hzOf(d, 0.1, 0.2);
      ok(`zone for key ${key} plays ${want} Hz`, Math.abs(hz / want - 1) < 0.01, `got ${hz.toFixed(1)}`);
    }
    // velocity layers: both zones on the same keys, split by velocity
    const layered = { ...spec, id: -45, zones: [{ sampleId: ids[0], root: 57, lo: 0, hi: 127, vlo: 0, vhi: 0.5 }, { sampleId: ids[1], root: 57, lo: 0, hi: 127, vlo: 0.5, vhi: 1 }] };
    const soft = hzOf(await engineRender(0.5, (play) => { play(layered, 57, 0.3, 0, 0.4); }), 0.1, 0.2);
    const hard = hzOf(await engineRender(0.5, (play) => { play(layered, 57, 0.9, 0, 0.4); }), 0.1, 0.2);
    ok('velocity layers pick the sample by velocity', Math.abs(soft / 110 - 1) < 0.01 && Math.abs(hard / 440 - 1) < 0.01, `${soft.toFixed(1)} / ${hard.toFixed(1)}`);
    ids.forEach((id) => app.store.samples.delete(id));
  }

  return log.join('\n');
})()
