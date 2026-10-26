import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SoundFont, GM_FAMILIES } from '../src/audio/sf2.js';

const file = new URL('../assets/soundfonts/GeneralUser-GS.sf2', import.meta.url);
const present = existsSync(file);
const load = () => {
  const b = readFileSync(file);
  return new SoundFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

test('rejects data that is not a SoundFont', () => {
  assert.throws(() => new SoundFont(new ArrayBuffer(64)), /Not a SoundFont/);
});

test('parses presets and drum kits (needs `npm run assets`)', { skip: !present && 'asset not downloaded' }, () => {
  const sf = load();
  assert.ok(sf.presets.length > 250);
  assert.equal(sf.getPreset(0, 0).name, 'Grand Piano');
  assert.ok(sf.getPreset(128, 25), '808/909 kit');
  assert.equal(GM_FAMILIES.length, 16);
});

test('resolves regions by key and velocity (needs `npm run assets`)', { skip: !present && 'asset not downloaded' }, () => {
  const sf = load();
  const piano = sf.getPreset(0, 0);
  assert.ok(sf.match(piano, 60, 20).length > 0 && sf.match(piano, 60, 120).length > 0);
  const kit = sf.getPreset(128, 25);
  const kick = sf.match(kit, 36, 100);
  const snare = sf.match(kit, 38, 100);
  assert.ok(kick.length > 0 && snare.length > 0, 'kick and snare are mapped');
  assert.notEqual(kick[0].sampleIdx, snare[0].sampleIdx);
  const r = sf.match(piano, 60, 100)[0];
  assert.ok(r.attenDb >= 0 && r.release >= 0 && r.rootKey >= 0);
});
