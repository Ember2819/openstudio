import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
store.set('openstudio.keymap', JSON.stringify({ save: ['Ctrl+W'], bogus: ['X'], undo: 'not a list' }));
const { keymap, COMMANDS, comboLabel } = await import('../src/keymap.js');

test('saved keys load, unknown or broken entries are dropped', () => {
  assert.deepEqual(keymap.binds('save'), ['Ctrl+W']);
  assert.deepEqual(keymap.binds('undo'), ['Ctrl+Z'], 'a broken entry falls back to the default');
  assert.equal(keymap.map().get('Ctrl+W'), 'save');
  assert.equal(keymap.map().get('Ctrl+S'), undefined);
});

test('rebinding, defaults, conflicts and labels', () => {
  let changes = 0;
  keymap.on('change', () => changes++);
  keymap.set('record', ['Ctrl+Shift+R']);
  assert.equal(keymap.map().get('Ctrl+Shift+R'), 'record', 'a key the user chose wins over a default');
  const c = keymap.conflicts();
  assert.ok(c.get('record|Ctrl+Shift+R').includes('Export stems'));
  assert.ok(c.get('export-stems|Ctrl+Shift+R').includes('Record'));
  keymap.set('record', ['R']);
  assert.equal(keymap.map().get('R'), 'record');
  assert.equal(keymap.conflicts().size, 0);
  keymap.set('save', ['Ctrl+S']);
  assert.ok(keymap.isDefault('save'), 'setting the default keys clears the override');
  assert.equal(JSON.parse(store.get('openstudio.keymap')).save, undefined);
  keymap.reset();
  assert.deepEqual(keymap.binds('record'), []);
  assert.ok(changes >= 4);
  assert.equal(keymap.label('next-pattern'), '=');
  assert.equal(comboLabel('Shift+='), '+');
});

test('every default key is bound to one command only', () => {
  keymap.reset();
  assert.equal(keymap.conflicts().size, 0);
  assert.equal(new Set(COMMANDS.map((c) => c[0])).size, COMMANDS.length);
});
