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
    synth: inst.playSynth, fm: inst.playFm, organ: inst.playOrgan, pluck: inst.playPluck,
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

  return log.join('\n');
})()
