// The preset/voice data feeds menus, the agent catalog and parameter validation — it must stay consistent
// with PARAM_META (keys, ranges, option values) or set_channel and the settings window would reject it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DRUM_KIT, SYNTH_PRESETS, PARAM_META } = require('../src/audio/instruments.js');

test('drum kit voices are unique and implemented', () => {
  const names = DRUM_KIT.map((d) => d.name);
  const voices = DRUM_KIT.map((d) => d.voice);
  assert.equal(new Set(names).size, names.length, 'duplicate kit entry name');
  assert.equal(new Set(voices).size, voices.length, 'duplicate kit voice');
  for (const d of DRUM_KIT) assert.match(d.voice, /^[a-z0-9]+$/, d.name);
});

test('synth presets only use known parameters inside their ranges', () => {
  const meta = Object.fromEntries(PARAM_META.synth.map((m) => [m.key, m]));
  for (const [family, list] of Object.entries(SYNTH_PRESETS)) {
    assert.ok(family && list.length, `empty family ${family}`);
    for (const { name, params } of list) {
      for (const [key, value] of Object.entries(params)) {
        const m = meta[key];
        assert.ok(m, `${family}/${name}: unknown parameter ${key}`);
        if (m.options) assert.ok(m.options.includes(value), `${family}/${name}: ${key}=${value} not in ${m.options}`);
        else if (typeof value === 'number') {
          assert.ok(value >= m.min && value <= m.max, `${family}/${name}: ${key}=${value} outside ${m.min}..${m.max}`);
          if (m.step === 1) assert.ok(Number.isInteger(value), `${family}/${name}: ${key} must be an integer`);
        }
      }
    }
  }
});

test('every effect is in exactly one menu group', async () => {
  const { EFFECT_DEFS, EFFECT_GROUPS } = await import('../src/audio/effects.js');
  const listed = Object.values(EFFECT_GROUPS).flat();
  assert.deepEqual([...listed].sort(), Object.keys(EFFECT_DEFS).sort());
});

test('plucked strings are in tune, warm at the bottom and ring for their decay time', async () => {
  const { karplusStrong } = await import('../src/audio/synths.js');
  const SR = 44100;
  const fundamentalOf = (d, from, len) => { // autocorrelation: the highest peak after it first dips below zero
    const ac = (lag) => { let s = 0; for (let i = 0; i < len; i++) s += d[from + i] * d[from + i + lag]; return s; };
    let lag = 1;
    while (lag < SR / 30 && ac(lag) > 0) lag++;
    let best = -Infinity, bestLag = lag;
    for (; lag < SR / 30; lag++) { const r = ac(lag); if (r > best) { best = r; bestLag = lag; } }
    const [a, b, c] = [ac(bestLag - 1), best, ac(bestLag + 1)]; // parabolic interpolation between samples
    return SR / (bestLag + (a - c) / (2 * (a - 2 * b + c)));
  };
  const energyAt = (d, f, from, len) => {
    let re = 0, im = 0;
    for (let i = 0; i < len; i++) { re += d[from + i] * Math.cos((2 * Math.PI * f * i) / SR); im += d[from + i] * Math.sin((2 * Math.PI * f * i) / SR); }
    return Math.hypot(re, im);
  };
  for (const freq of [55, 110, 440, 1760]) {
    const d = karplusStrong(SR, freq, { decay: 2, bright: 0.5, damp: 0.4, pick: 0.2, seconds: 1 });
    const hz = fundamentalOf(d, 2205, 4410);
    assert.ok(Math.abs(hz / freq - 1) < 0.012, `${freq} Hz string plays ${hz.toFixed(1)}`);
  }
  // an upright-bass setting: the fundamental carries the note, not a buzz of high harmonics
  const bass = karplusStrong(SR, 110, { decay: 1.4, bright: 0.3, damp: 0.55, pick: 0.25, velocity: 0.8, seconds: 1 });
  const low = energyAt(bass, 110, 441, 4410), high = energyAt(bass, 110 * 12, 441, 4410);
  assert.ok(low > high * 30, `bass fundamental ${low.toFixed(1)} vs 12th harmonic ${high.toFixed(1)}`);
  // `decay` is the 60 dB time of the fundamental
  const rms = (d, at) => { let s = 0; const n = 2205; for (let i = 0; i < n; i++) s += d[Math.round(at) + i] ** 2; return Math.sqrt(s / n); };
  const ring = karplusStrong(SR, 220, { decay: 2, bright: 0.4, damp: 0.4, pick: 0.2, seconds: 2 });
  const drop = 20 * Math.log10(rms(ring, SR * 1.1) / rms(ring, SR * 0.1));
  assert.ok(drop < -20 && drop > -45, `1 s of a 2 s string fell ${drop.toFixed(1)} dB (about -30 expected)`);
});
