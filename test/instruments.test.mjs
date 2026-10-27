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
  for (const d of DRUM_KIT) assert.match(d.voice, /^[a-z]+$/, d.name);
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
