import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMates, setGroupVolume, setGroupFlag } from '../src/mixergroups.js';
import { Store } from '../src/state.js';

const mixer = () => Array.from({ length: 6 }, (_, i) => ({ vol: 0.8, mute: false, solo: false, ...(i === 1 || i === 2 || i === 4 ? { group: 1 } : i === 3 ? { group: 2 } : {}) }));

test('group mates', () => {
  const m = mixer();
  assert.deepEqual(groupMates(m, 1), [2, 4]);
  assert.deepEqual(groupMates(m, 3), []);
  assert.deepEqual(groupMates(m, 5), []);
  m[0].group = 1;
  assert.deepEqual(groupMates(m, 0), [], 'the master is never grouped');
  assert.ok(!groupMates(m, 1).includes(0));
});

test('a fader moves its group by the same amount, each stopping at its end', () => {
  const m = mixer();
  m[4].vol = 0.95;
  assert.deepEqual(setGroupVolume(m, 1, 0.9), [1, 2, 4]);
  assert.deepEqual([m[1].vol, m[2].vol, m[4].vol, m[3].vol].map((v) => Math.round(v * 100) / 100), [0.9, 0.9, 1, 0.8]);
  setGroupVolume(m, 2, 0.5, { alone: true });
  assert.equal(m[1].vol, 0.9);
});

test('mute / solo switch the group', () => {
  const m = mixer();
  assert.deepEqual(setGroupFlag(m, 2, 'mute', true), [2, 1, 4]);
  assert.ok(m[1].mute && m[4].mute && !m[3].mute);
  setGroupFlag(m, 1, 'solo', true, { alone: true });
  assert.ok(m[1].solo && !m[2].solo);
});

test('groups survive save / load and bad values are dropped', () => {
  const s = new Store();
  s.project.mixer[3].group = 2;
  s.project.mixer[4].group = 99;
  s.load(s.serialize());
  assert.equal(s.project.mixer[3].group, 2);
  assert.equal(s.project.mixer[4].group, undefined);
});
