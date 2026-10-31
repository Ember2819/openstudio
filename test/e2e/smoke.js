// Runs inside the renderer (see scripts/e2e.mjs). Resolves to a list of "ok …" / "FAIL …" lines.
(async () => {
  const a = window.openstudio;
  const s = a.store;
  const t = a.transport;
  const log = [];
  const ok = (name, cond) => log.push(`${cond ? 'ok' : 'FAIL'} ${name}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const peak = async (ms = 400) => {
    let p = 0;
    for (let i = 0; i < ms / 20; i++) { const lv = a.engine.readLevels(0); p = Math.max(p, lv[0], lv[1]); await wait(20); }
    return p;
  };

  // instrument bank loaded and catalogued
  for (let i = 0; i < 50 && !a.actions.catalog(); i++) await wait(100);
  ok('instrument bank loads', !!a.actions.catalog());
  ok('catalog has 16 families and drum kits', a.actions.catalog()?.families.length === 16 && a.actions.catalog()?.kits.length >= 10);

  // demo project plays and produces sound
  a.actions.loadDemo();
  t.setMode('pattern');
  t.play();
  await wait(1500);
  ok('pattern playback is audible', (await peak()) > 0.01);
  t.pause();
  t.setMode('song');
  t.stop();
  t.play();
  await wait(1200);
  ok('song playback is audible', (await peak()) > 0.01);
  t.stop();
  ok('stop returns to the start', t.position() === 0);

  // editing, undo/redo
  const n = s.project.channels.length;
  a.actions.addInstrument({ name: 'Flute', bank: 0, program: 73 });
  ok('add instrument channel', s.project.channels.length === n + 1);
  s.undo();
  ok('undo', s.project.channels.length === n);

  // mixer effects + sends
  const m = s.project.mixer[2];
  ['reverb', 'delay', 'chorus', 'phaser', 'limiter', 'flanger', 'tremolo', 'bitcrusher', 'peq', 'gate'].forEach((type, i) => { m.fx[i] = { type, params: {}, on: true }; });
  a.engine.syncFx(2);
  ok('effect chain builds', a.engine.tracks[2].fxNodes.length === 10);
  m.fx.fill(null);
  ['multiband', 'analyzer', 'eq', 'compressor', 'distortion', 'filter', 'stereo'].forEach((type, i) => { m.fx[i] = { type, params: {}, on: true }; });
  a.engine.syncFx(2);
  ok('second effect chain builds', a.engine.tracks[2].fxNodes.length === 7);

  // effects measured offline: a 440 Hz tone through one effect
  {
    const { createEffect, loadEffectWorklets } = await import('./src/audio/effects.js');
    const run = async (type, params, amp = 0.5, secs = 1.2, stereoIn = false) => {
      const ctx = new OfflineAudioContext(2, Math.round(44100 * secs), 44100);
      const fx = createEffect(ctx, type, params);
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const g = ctx.createGain();
      g.gain.setValueAtTime(amp, 0);
      g.gain.setValueAtTime(0, 0.1); // a short burst, then silence (for echoes)
      if (!stereoIn) g.gain.setValueAtTime(amp, 0.1);
      osc.connect(g).connect(fx.input);
      fx.output.connect(ctx.destination);
      osc.start();
      await loadEffectWorklets(ctx);
      const out = await ctx.startRendering();
      const rms = (c, from = 0, to = out.length) => { const d = out.getChannelData(c); let x = 0; for (let i = from; i < to; i++) x += d[i] * d[i]; return Math.sqrt(x / Math.max(1, to - from)); };
      return { out, rms };
    };
    const quiet = await run('gate', { threshold: -30 }, 0.01);
    const loud = await run('gate', { threshold: -30 }, 0.5);
    ok('gate: a signal below the threshold is shut', quiet.rms(0, 22050) < 0.01 * 0.707 * 0.1);
    ok('gate: a signal above the threshold passes', loud.rms(0, 22050) > 0.5 * 0.707 * 0.8);
    const pp = await run('delay', { mode: 'ping-pong', time: 300, feedback: 0.5, mix: 1, tone: 14000 }, 0.5, 1.2, true);
    const at = (sec) => Math.round(sec * 44100);
    const l1 = pp.rms(0, at(0.3), at(0.4)), r1 = pp.rms(1, at(0.3), at(0.4));
    const l2 = pp.rms(0, at(0.6), at(0.7)), r2 = pp.rms(1, at(0.6), at(0.7));
    ok('ping-pong delay: the first echo is on the left, the second on the right', l1 > r1 * 4 && r2 > l2 * 4);
    const st = await run('delay', { time: 300, feedback: 0.4, mix: 1 }, 0.5, 1.2, true);
    ok('mono-mode delay keeps echoes on both sides', Math.abs(st.rms(0, at(0.3), at(0.4)) - st.rms(1, at(0.3), at(0.4))) < 0.01);
    const mb = await run('multiband', {}, 0.1);
    ok(`multiband passes a quiet signal near unity (${(mb.rms(0, 22050) / (0.1 * 0.707)).toFixed(2)})`, Math.abs(mb.rms(0, 22050) / (0.1 * 0.707) - 1) < 0.2);
    const mbLoud = await run('multiband', { threshold: -30, ratio: 8 }, 0.8);
    ok('multiband compresses a loud signal', mbLoud.rms(0, 22050) < 0.8 * 0.707 * 0.6);
    const comp = await run('compressor', { threshold: -20, ratio: 4, gain: 0 }, 0.01);
    ok(`compressor below its threshold is unity gain (${(comp.rms(0, 22050) / (0.01 * 0.707)).toFixed(2)})`, Math.abs(comp.rms(0, 22050) / (0.01 * 0.707) - 1) < 0.08);
    const lim = await run('limiter', { ceiling: -6, gain: 12 }, 0.5);
    let lp = 0;
    { const d = lim.out.getChannelData(0); for (let i = 22050; i < 44100; i++) lp = Math.max(lp, Math.abs(d[i])); }
    ok(`limiter holds its ceiling (${(20 * Math.log10(lp)).toFixed(2)} dB)`, 20 * Math.log10(lp) < -5.9);
    const ctx = new AudioContext();
    const peq = createEffect(ctx, 'peq', { g4: 6, f4: 1000, q4: 1 });
    const resp = peq.response(new Float32Array([100, 1000, 10000]));
    ok('parametric EQ response peaks at its band', resp[1] > 5.5 && Math.abs(resp[0]) < 1.5 && Math.abs(resp[2]) < 1.5);
    ctx.close();
  }
  m.fx.fill(null);
  a.engine.syncFx(2);
  s.project.mixer[1].sends[2] = 0.7;
  s.emit('mixer');
  ok('send node created', a.engine.sendNodes.has('1:2'));

  // automation clip
  a.actions.createAutomation({ kind: 'mixer', track: 1, param: 'vol' });
  ok('automation clip created', s.project.automations.length === 1 && s.project.playlist.clips.some((c) => c.type === 'auto'));

  // audio clip from a generated sample
  const { encodeWav } = await import('./src/audio/wav.js');
  const off = new OfflineAudioContext(1, 22050, 22050);
  const buf = off.createBuffer(1, 22050, 22050);
  for (let i = 0; i < 22050; i++) buf.getChannelData(0)[i] = Math.sin(i / 10) * 0.5;
  const id = s.addSample('test.wav', encodeWav(buf));
  const decoded = await a.engine.ensureSample(id);
  ok('sample decodes', !!decoded);
  s.addClip({ type: 'audio', sampleId: id, track: 6, start: 0, len: 8 });

  // save / load round trip keeps clips, automation and samples
  const text = s.serialize();
  s.load(text);
  ok('project round trip', s.project.automations.length === 1 && s.samples.size === 1 && s.project.playlist.clips.some((c) => c.type === 'audio'));

  // offline export renders audio (step-by-step, like live playback)
  const { renderSteps } = await import('./src/audio/render.js');
  s.project.mode = 'song';
  const rendered = await renderSteps(s, Math.min(s.playlistEndStep(), 32), { tail: 1 });
  let rp = 0;
  const d = rendered.getChannelData(0);
  for (let i = 0; i < d.length; i += 11) rp = Math.max(rp, Math.abs(d[i]));
  ok('offline render has signal and no NaN', rp > 0.01 && !Number.isNaN(rp));

  // FLAC export decodes back to the same 16-bit samples
  {
    const { encodeFlac } = await import('./src/audio/flac.js');
    const flac = await encodeFlac(rendered);
    const back = await new OfflineAudioContext(2, 1, rendered.sampleRate).decodeAudioData(flac.slice(0));
    let maxErr = 0;
    const a0 = rendered.getChannelData(0), b0 = back.getChannelData(0);
    for (let i = 0; i < rendered.length; i += 13) maxErr = Math.max(maxErr, Math.abs(Math.max(-1, Math.min(1, a0[i])) - b0[i]));
    ok(`FLAC export decodes losslessly (${flac.byteLength} bytes, max error ${maxErr.toExponential(1)})`, back.length === rendered.length && maxErr < 1 / 32768 + 1e-6);
  }

  // export progress: monotonic, ends at 1; an abort rejects instead of hanging
  const prog = [];
  await renderSteps(s, 32, { tail: 1, onProgress: (f) => prog.push(f) });
  ok('render reports progress', prog.length > 2 && prog[0] === 0 && prog.at(-1) === 1 && prog.every((f, i) => !i || f >= prog[i - 1]));
  const ctl = new AbortController();
  let abortName = null;
  setTimeout(() => ctl.abort(), 20);
  try { await renderSteps(s, 256, { tail: 1, signal: ctl.signal }); } catch (e) { abortName = e.name; }
  ok('render can be cancelled', abortName === 'AbortError');

  // song playback wraps at the end of the arrangement when no loop is set
  t.setLoop(false);
  t.stop();
  t.seek(s.playlistEndStep() + 64);
  t.play();
  await wait(400);
  ok('song wraps to the start after the last bar', t.position() < 16);
  t.stop();
  t.seek(0);

  // MIDI import through the real action (File object, as from a drop or the file picker)
  const { buildMidi } = await import('./src/midifile.js');
  const before = s.project.channels.length;
  const pats = s.project.patterns.length;
  const file = new File([buildMidi(s, { song: true })], 'roundtrip.mid');
  const imported = await a.actions.importMidiFile(file);
  ok('MIDI import adds a pattern, channels and a clip', !!imported && s.project.patterns.length === pats + 1
    && s.project.channels.length > before && s.project.playlist.clips.some((c) => c.pat === imported.id));
  s.undo();
  ok('MIDI import is undoable', s.project.patterns.length === pats && s.project.channels.length === before);

  // channel reordering
  const firstId = s.project.channels[0].id;
  s.moveChannel(firstId, 1);
  ok('move channel down', s.project.channels[1].id === firstId);

  // a sliced automation clip keeps its place in the curve
  const auto = s.project.automations[0];
  auto.points = [{ x: 0, y: 0 }, { x: 16, y: 1 }];
  const autoClip = s.project.playlist.clips.find((c) => c.type === 'auto');
  const { curveAt } = await import('./src/automation.js');
  autoClip.offset = 8;
  ok('automation clip offset reads later in the curve', Math.abs(curveAt(auto.points, 0 + autoClip.offset) - 0.5) < 1e-6);

  // per-note pan and an insert taken off the master, rendered offline
  {
    s.resetToDefault();
    const ch = s._addChannel({ name: 'Sine', type: 'synth', mixer: 5, preset: { wave1: 'sine', wave2: 'sine' } });
    const pat = s.currentPattern;
    pat.notes[ch.id] = [{ p: 69, s: 0, l: 8, v: 0.9, pan: -1 }];
    s.project.mode = 'pattern';
    const lr = async () => {
      const out = await renderSteps(s, 8, { tail: 0.2 });
      const sum = (c) => { let x = 0; const dd = out.getChannelData(c); for (let i = 0; i < dd.length; i += 7) x += Math.abs(dd[i]); return x; };
      return [sum(0), sum(1)];
    };
    const [l, r] = await lr();
    ok('a note panned hard left plays on the left only', l > 0.5 && r < l * 0.02);
    s.project.mixer[5].master = false;
    const [l2, r2] = await lr();
    ok('an insert off the master is silent', l2 + r2 < 1e-3);
    s.project.mixer[5].sends[6] = 0.8;
    const [l3] = await lr();
    ok('…but reaches the master through a send', l3 > l * 0.5);
  }

  // mono / glide synth: overlapping notes slide without retriggering (808 glides)
  {
    s.resetToDefault();
    s.project.bpm = 120;
    s.project.mode = 'pattern';
    for (const c of s.project.channels) c.mute = true;
    const bass = s._addChannel({ name: '808', type: 'synth', preset: { wave1: 'sine', wave2: 'sine', mix: 0, sub: 0, cutoff: 18000, envAmt: 0, keytrack: 0, attack: 0.002, decay: 0.05, sustain: 1, release: 0.05, mono: true, glide: 0.1 } });
    // A2 (110 Hz) for 2 beats, then A3 (220 Hz) overlapping by a step
    s.currentPattern.notes = { [bass.id]: [{ p: 45, s: 0, l: 9, v: 0.9 }, { p: 57, s: 8, l: 8, v: 0.9 }] };
    const out = await renderSteps(s, 16, { tail: 0 });
    const d = out.getChannelData(0);
    const freqAt = (from, to) => { let z = 0; const i0 = Math.round(from * 44100), i1 = Math.round(to * 44100); for (let i = i0 + 1; i < i1; i++) if (d[i - 1] < 0 && d[i] >= 0) z++; return z / (to - from); };
    const rmsAt = (from, to) => { let x = 0; const i0 = Math.round(from * 44100), i1 = Math.round(to * 44100); for (let i = i0; i < i1; i++) x += d[i] * d[i]; return Math.sqrt(x / (i1 - i0)); };
    const f1 = freqAt(0.5, 0.95), mid = freqAt(1.0, 1.06), f2 = freqAt(1.3, 1.9);
    ok(`glide: 110 Hz → slides → 220 Hz (${f1.toFixed(0)}, ${mid.toFixed(0)}, ${f2.toFixed(0)})`, Math.abs(f1 - 110) < 4 && mid > 115 && mid < 215 && Math.abs(f2 - 220) < 4);
    const dip = Math.min(...[0.99, 1.0, 1.01, 1.02].map((t0) => rmsAt(t0, t0 + 0.01)));
    ok('mono legato: no gap or retrigger where the notes overlap', dip > rmsAt(0.8, 0.9) * 0.7);
  }

  // sidechain: a kick on one insert ducks a pad on another
  {
    s.resetToDefault();
    s.project.bpm = 120;
    s.project.mode = 'pattern';
    const kick = s._addChannel({ name: 'K', type: 'drum', voice: 'kick', mixer: 1 });
    const pad = s._addChannel({ name: 'P', type: 'synth', mixer: 2, preset: { wave1: 'sine', wave2: 'sine', attack: 0.001, sustain: 1, release: 0.01 } });
    for (const c of s.project.channels) if (c !== kick && c !== pad) c.mute = true;
    const pat = s.currentPattern;
    pat.notes = { [kick.id]: [0, 4, 8, 12].map((st) => ({ p: 60, s: st, l: 1, v: 1 })), [pad.id]: [{ p: 69, s: 0, l: 16, v: 0.8 }] };
    s.project.mixer[2].fx[0] = { type: 'sidechain', params: { source: 1, threshold: -30, ratio: 8, depth: 24, release: 0.1 }, on: true };
    const { renderStems } = await import('./src/audio/render.js');
    const res = await renderStems(s, 16, [2], { tail: 0 });
    const padOut = res.stems.get(2);
    const rms = (from, to) => { const d = padOut.getChannelData(0); let x = 0; const i0 = Math.round(from * 44100), i1 = Math.round(to * 44100); for (let i = i0; i < i1; i++) x += d[i] * d[i]; return Math.sqrt(x / (i1 - i0)); };
    const onKick = rms(0.52, 0.6); // right after the second kick
    const between = rms(0.38, 0.48); // just before it, after the first has decayed
    ok(`sidechain: the pad ducks under the kick (${(20 * Math.log10(onKick / between)).toFixed(1)} dB)`, onKick < between * 0.4);
    s.project.mixer[2].fx[0].params.source = 2; // keyed from itself: ignored, no loop
    const self = await renderSteps(s, 4, { tail: 0 });
    let pk = 0; { const d = self.getChannelData(0); for (let i = 0; i < d.length; i += 5) pk = Math.max(pk, Math.abs(d[i])); }
    ok('sidechain keyed from its own track is ignored', pk > 0.01 && Number.isFinite(pk));
  }

  // volume shaper: a held pad through "Gate 1/8" is on for a step and off for a step, locked to the song
  {
    s.resetToDefault();
    s.project.bpm = 120;
    s.project.mode = 'pattern';
    for (const c of s.project.channels) c.mute = true;
    const pad = s._addChannel({ name: 'Pad', type: 'synth', mixer: 3, preset: { wave1: 'sine', wave2: 'sine', attack: 0.001, sustain: 1, release: 0.01 } });
    s.currentPattern.notes = { [pad.id]: [{ p: 69, s: 0, l: 16, v: 0.8 }] };
    s.project.mixer[3].fx[0] = { type: 'shaper', params: { shape: 'Gate 1/8', depth: 1, smooth: 0.002 }, on: true };
    const out = await renderSteps(s, 16, { tail: 0 });
    const d = out.getChannelData(0);
    const rms = (from, to) => { let x = 0; const i0 = Math.round(from * 44100), i1 = Math.round(to * 44100); for (let i = i0; i < i1; i++) x += d[i] * d[i]; return Math.sqrt(x / (i1 - i0)); };
    const sd = 0.125; // a step at 120 BPM
    const on = rms(4 * sd + 0.01, 5 * sd - 0.01), off = rms(5 * sd + 0.01, 6 * sd - 0.01);
    ok(`volume shaper gates in time (${(20 * Math.log10(off / on)).toFixed(0)} dB)`, on > 0.05 && off < on * 0.05);
  }

  // audio clip fades and reverse
  {
    s.resetToDefault();
    s.project.bpm = 120;
    s.project.mode = 'song';
    const off = new OfflineAudioContext(1, 44100, 44100);
    const ramp = off.createBuffer(1, 44100, 44100);
    for (let i = 0; i < 44100; i++) ramp.getChannelData(0)[i] = Math.sin(i / 5) * (i / 44100); // gets louder
    const { encodeWav } = await import('./src/audio/wav.js');
    const id = s.addSample('ramp.wav', encodeWav(ramp, { float: true }));
    await a.engine.ensureSample(id);
    const clip = s.addClip({ type: 'audio', sampleId: id, track: 0, start: 0, len: 8 }); // 1 s at 120 BPM
    const rms = (b, from, to) => { const d = b.getChannelData(0); let x = 0; const i0 = Math.round(from * 44100), i1 = Math.round(to * 44100); for (let i = i0; i < i1; i++) x += d[i] * d[i]; return Math.sqrt(x / (i1 - i0)); };
    const plain = await renderSteps(s, 8, { tail: 0 });
    clip.fadeOut = 4; // the last half second
    const faded = await renderSteps(s, 8, { tail: 0 });
    ok('a fade-out turns the end of an audio clip down', rms(faded, 0.85, 0.98) < rms(plain, 0.85, 0.98) * 0.4 && Math.abs(rms(faded, 0.1, 0.4) - rms(plain, 0.1, 0.4)) < 0.01);
    delete clip.fadeOut;
    clip.reverse = true;
    const rev = await renderSteps(s, 8, { tail: 0 });
    ok('a reversed audio clip plays backwards', rms(rev, 0.05, 0.3) > rms(rev, 0.7, 0.95) * 2);
  }

  // render a clip to audio: it sounds the same, the original is muted
  {
    a.actions.loadDemo();
    s.project.mode = 'song';
    const drums = s.project.playlist.clips.find((c) => s.pattern(c.pat)?.name === 'Drums');
    const before = await renderSteps(s, 32, { tail: 0, only: new Set([drums.id]) });
    const clip = await a.actions.renderClipsToAudio([drums.id]);
    const after = await renderSteps(s, 32, { tail: 0 });
    const rms = (b) => { let x = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) x += d[i] * d[i]; return Math.sqrt(x / d.length); };
    ok('render to audio: the original clip is muted and an audio clip replaces it', drums.mute && clip?.type === 'audio' && clip.start === drums.start);
    const others = s.project.playlist.clips.filter((c) => c !== clip && !c.mute);
    others.forEach((c) => { c.mute = true; });
    const alone = await renderSteps(s, 32, { tail: 0 });
    others.forEach((c) => { c.mute = false; });
    ok(`render to audio: it sounds like the original (${rms(before).toFixed(4)} vs ${rms(alone).toFixed(4)})`, Math.abs(rms(alone) / rms(before) - 1) < 0.05 && rms(after) > 0);
    s.undo();
    ok('render to audio is one undo step', !drums.mute || !s.project.playlist.clips.find((c) => c.id === drums.id)?.mute);
  }

  // tempo-following audio clips: a 120 BPM loop played at 150 BPM
  {
    s.resetToDefault();
    s.project.bpm = 150;
    s.project.mode = 'song';
    const SR = 44100;
    const loop = new AudioBuffer({ numberOfChannels: 1, length: SR * 2, sampleRate: SR }); // one bar at 120
    const d0 = loop.getChannelData(0);
    for (let i = 0; i < d0.length; i++) d0[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / SR) * (i % 22050 < 4000 ? 1 : 0.2); // 4 pulses
    const { encodeWav } = await import('./src/audio/wav.js');
    const id = s.addSample('loop.wav', encodeWav(loop, { float: true }));
    await a.engine.ensureSample(id);
    const clip = s.addClip({ type: 'audio', sampleId: id, track: 0, start: 0, len: 16, stretch: { mode: 'stretch', bpm: 120 } });
    const hz = (b, from, to) => { const d = b.getChannelData(0); let z = 0; const i0 = Math.round(from * SR), i1 = Math.round(to * SR); for (let i = i0 + 1; i < i1; i++) if (d[i - 1] < 0 && d[i] >= 0) z++; return z / (to - from); };
    const lastPulse = (b) => { const d = b.getChannelData(0); let last = 0; for (let i = 1; i < d.length; i += 64) if (Math.abs(d[i]) > 0.3) last = i / SR; return last; };
    const st = await renderSteps(s, 16, { tail: 0 });
    ok(`stretch: a bar at 120 fits a bar at 150 and keeps its pitch (${hz(st, 0.1, 0.9).toFixed(0)} Hz, last pulse ${lastPulse(st).toFixed(2)} s)`, Math.abs(hz(st, 0.1, 0.9) - 220) < 6 && Math.abs(lastPulse(st) - 1.2 - 0.07) < 0.08);
    clip.stretch = { mode: 'resample', bpm: 120 };
    const rs = await renderSteps(s, 16, { tail: 0 });
    delete clip.stretch;
    s.project.bpm = 120;
    clip.pitch = 12;
    const up = await renderSteps(s, 16, { tail: 0 });
    ok(`pitch shift: an octave up at the same length (${hz(up, 0.1, 0.9).toFixed(0)} Hz, last pulse ${lastPulse(up).toFixed(2)} s)`, Math.abs(hz(up, 0.1, 0.9) - 440) < 8 && Math.abs(lastPulse(up) - 1.5 - 0.09) < 0.1);
    delete clip.pitch;
    ok(`resample: it plays faster and higher (${hz(rs, 0.1, 0.9).toFixed(0)} Hz)`, Math.abs(hz(rs, 0.1, 0.9) - 275) < 8 && Math.abs(lastPulse(rs) - lastPulse(st)) < 0.08);
  }

  // stems: each mixer track rendered into its own pair of channels, in one pass
  {
    a.actions.loadDemo();
    s.project.mode = 'song';
    const tracks = a.actions.stemTracks();
    const { renderStems } = await import('./src/audio/render.js');
    const res = await renderStems(s, s.playlistEndStep(), tracks, { tail: 0.5 });
    const level = (b) => { let m = 0; for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i += 7) m = Math.max(m, Math.abs(d[i])); } return m; };
    ok(`stems: one per used mixer track (${tracks.join(',')})`, tracks.length >= 4 && res.stems.size === tracks.length);
    ok('stems: every stem and the master have signal', level(res.master) > 0.05 && [...res.stems.values()].every((b) => level(b) > 0.005));
    const kickTrack = s.project.channels.find((c) => /kick/i.test(c.name)).mixer;
    const other = tracks.find((t) => t !== kickTrack && !s.project.channels.some((c) => c.mixer === t && /kick/i.test(c.name)));
    // the kick stem has the kick and the master plays like a normal render
    const normal = await renderSteps(s, s.playlistEndStep(), { tail: 0.5 });
    ok('stems: the master pass matches a normal render', Math.abs(level(normal) - level(res.master)) < 0.02);
    ok('stems: tracks differ from each other', level(res.stems.get(kickTrack)) > 0.01 && other != null);
    const many = Array.from({ length: 20 }, (_, i) => i + 1);
    const big = await renderStems(s, 16, many, { tail: 0 });
    ok('stems: more than 15 tracks take several passes', big.stems.size === 20);
  }

  // tempo automation: a render follows the tempo curve
  {
    s.resetToDefault();
    s.project.bpm = 120;
    s.project.mode = 'song';
    const pat = s.currentPattern;
    pat.notes[s.project.channels[0].id] = [{ p: 60, s: 0, l: 1, v: 0.8 }];
    s.addClip({ type: 'pattern', pat: pat.id, track: 0, start: 0, len: 32 });
    const target = { kind: 'tempo' };
    const { valueToNorm } = await import('./src/automation.js');
    const auto = s.addAutomation({ name: 'Tempo', target, value: valueToNorm(s, target, 240), len: 32 });
    s.addClip({ type: 'auto', autoId: auto.id, track: 1, start: 0, len: 32 });
    s.emit('playlist');
    const out = await renderSteps(s, 32, { tail: 0 });
    ok('a render at an automated 240 BPM lasts half as long', Math.abs(out.duration - 2) < 0.02);
    t.play();
    await wait(300);
    ok('the transport plays at the automated tempo', Math.abs(t.currentBpm() - 240) < 0.01);
    t.stop();
  }

  // FL Studio project import through the real action
  {
    const { parseFlp } = await import('./src/flp.js');
    let threw = false;
    try { parseFlp(new Uint8Array(30)); } catch { threw = true; }
    ok('a non-FLP file is refused', threw);
  }

  // sampler: slice a rendered drum loop at its hits, then rebuild it as notes
  {
    s.resetToDefault();
    s.project.bpm = 120;
    s.project.mode = 'pattern';
    const kick = s.project.channels[0];
    s.currentPattern.notes[kick.id] = [0, 4, 8, 12].map((st) => ({ p: kick.rootPitch, s: st, l: 1, v: 0.9 }));
    for (const c of s.project.channels.slice(1)) delete s.currentPattern.notes[c.id];
    const loopBuf = await renderSteps(s, 16, { tail: 0 });
    ok('rendered a one-bar loop', Math.abs(loopBuf.duration - 2) < 0.01);
    const { encodeWav } = await import('./src/audio/wav.js');
    const sid = s.addSample('loop.wav', encodeWav(loopBuf));
    const smp = s._addChannel({ name: 'Loop', type: 'sampler', sampleId: sid });
    await a.engine.ensureSample(sid);
    const { detectOnsets } = await import('./src/audio/slicing.js');
    smp.slices = detectOnsets(s.samples.get(sid).buffer.getChannelData(0), loopBuf.sampleRate, { sensitivity: 0.5 });
    ok(`auto-slice finds the four kicks (${smp.slices.map((x) => (x * 2).toFixed(2)).join(', ')})`, smp.slices.length === 4 && smp.slices.every((x, i) => Math.abs(x * 2 - i * 0.5) < 0.02));
    s.selectChannel(kick.id);
    a.actions.slicesToPattern(smp.id);
    const notes = s.currentPattern.notes[smp.id];
    ok('slices → pattern writes one note per slice, in time', notes.length === 4 && notes.every((n, i) => n.p === 60 + i && Math.abs(n.s - i * 4) < 0.1));
    delete s.currentPattern.notes[kick.id];
    s.project.bpm = 150; // the sliced loop now follows the tempo
    const re = await renderSteps(s, 16, { tail: 0.3 });
    let hits = 0;
    { const d = re.getChannelData(0); let prev = 0; const blk = 441; for (let i = 0; i + blk < d.length; i += blk) { let e = 0; for (let k = 0; k < blk; k++) e = Math.max(e, Math.abs(d[i + k])); if (e > 0.05 && prev <= 0.05) hits++; prev = e; } }
    ok(`the sliced loop replays its hits at the new tempo (${hits})`, hits === 4 && Math.abs(re.duration - (1.6 + 0.3)) < 0.02);
    s.currentPattern.notes[smp.id] = [{ p: 59, s: 0, l: 1, v: 0.9 }];
    const below = await renderSteps(s, 4, { tail: 0 });
    let bp = 0; { const d = below.getChannelData(0); for (let i = 0; i < d.length; i += 5) bp = Math.max(bp, Math.abs(d[i])); }
    ok('a key below the first slice is silent', bp < 1e-4);
    delete smp.slices;
    Object.assign(smp.params, { loop: true, loopStart: 0, loopEnd: 0.25 });
    s.currentPattern.notes[smp.id] = [{ p: 60, s: 0, l: 16, v: 0.9 }];
    const looped = await renderSteps(s, 16, { tail: 0 });
    let late = 0; { const d = looped.getChannelData(0); for (let i = Math.round(1.3 * 44100); i < d.length; i += 3) late = Math.max(late, Math.abs(d[i])); }
    ok('a looped sample keeps sounding while the note is held', late > 0.05);
  }

  // autosave keeps samples as raw buffers and recovers them
  {
    s.resetToDefault();
    const bytes = new Uint8Array(4096).map((_, i) => i & 255);
    const sid = s.addSample('keep.wav', bytes.buffer);
    s.checkpoint(); // marks the project dirty
    s.project.name = 'Autosaved';
    await a.autosave.save();
    s.resetToDefault();
    const rec = a.autosave.offerRecovery();
    let done = false;
    rec.then(() => { done = true; });
    for (let i = 0; i < 100 && !done; i++) {
      const btn = [...document.querySelectorAll('.modal .btn.primary')].find((b) => b.textContent === 'Recover');
      if (btn) { btn.click(); break; }
      await wait(50);
    }
    await Promise.race([rec, wait(3000)]);
    const back = s.samples.get(sid);
    ok('autosave recovery restores the project and its samples', s.project.name === 'Autosaved' && back && new Uint8Array(back.data)[300] === (300 & 255));
    a.autosave.discard();
  }

  // templates: every style builds a band with its mixer and nothing to undo
  {
    const { STYLES } = await import('./src/agent/music/styles.js');
    let good = 0;
    for (const id of Object.keys(STYLES)) {
      s.dirty = false;
      const done = await a.actions.newFromTemplate(id);
      if (done && s.project.channels.length >= 4 && s.project.channels.every((c) => c.mixer > 0) && s.undoStack.length === 0 && !s.dirty) good++;
    }
    ok(`new from template works for every style (${good}/${Object.keys(STYLES).length})`, good === Object.keys(STYLES).length);
  }

  // loading a damaged project doesn't throw and repairs ids/selection
  let loaded = true;
  try { s.load(JSON.stringify({ channels: [{ id: 3, type: 'synth', name: 'x' }], patterns: [{ id: 3, name: 'p', notes: {} }] })); } catch { loaded = false; }
  ok('damaged project loads with sane defaults', loaded && s.project.playlist.tracks.length === 125 && s.project.nextId > 3 && s.project.patterns[0].bars === 1);

  return log.join('\n');
})()
