import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/state.js';
import { link, linkFor, unlink, handleCC, controllerLinks, describeLink } from '../src/controllers.js';

function makeApp() {
  const store = new Store();
  const events = [];
  store.on('mixer', () => events.push('mixer'));
  store.on('channelMix', () => events.push('channelMix'));
  const fx = [];
  const engine = { setEffectParam: (...a) => fx.push(a) };
  let bpm = null;
  const transport = { setBpm: (v) => { bpm = v; } };
  return { app: { store, engine, transport, controllers: { pending: null } }, events, fx, getBpm: () => bpm };
}

test('learning binds the next CC; moving it sets the control', () => {
  const { app, events } = makeApp();
  const target = { kind: 'mixer', track: 3, param: 'vol' };
  let learned = null;
  app.controllers.pending = target;
  app.controllers.onLearned = (l) => { learned = l; };
  assert.equal(handleCC(app, 0, 21, 64), true);
  assert.deepEqual(learned, { cc: 21, channel: -1, target });
  assert.equal(app.controllers.pending, null);
  assert.equal(handleCC(app, 4, 21, 127), true);
  assert.equal(app.store.project.mixer[3].vol, 1);
  assert.ok(events.includes('mixer'));
  assert.equal(handleCC(app, 0, 22, 10), false, 'unlinked CCs fall through');
  assert.equal(describeLink(app.store, linkFor(app.store, target)), 'CC 21 → Insert 3 — Volume');
});

test('one undo step per gesture', () => {
  const { app } = makeApp();
  link(app.store, 7, -1, { kind: 'channel', id: app.store.project.channels[0].id, param: 'pan' });
  const before = app.store.undoStack.length;
  for (let v = 0; v <= 127; v += 16) handleCC(app, 0, 7, v);
  assert.equal(app.store.undoStack.length, before + 1);
  assert.equal(app.store.project.channels[0].pan, -1 + (112 / 127) * 2);
  app.store.undo();
  assert.equal(app.store.project.channels[0].pan, 0);
});

test('a CC drives one target; relinking replaces; tempo and effects', () => {
  const { app, fx, getBpm } = makeApp();
  const a = { kind: 'mixer', track: 1, param: 'pan' };
  const b = { kind: 'mixer', track: 2, param: 'pan' };
  link(app.store, 10, -1, a);
  link(app.store, 10, -1, b);
  assert.equal(controllerLinks(app.store).length, 1);
  assert.equal(linkFor(app.store, a), null);
  link(app.store, 11, -1, { kind: 'tempo' });
  handleCC(app, 0, 11, 127);
  assert.equal(getBpm(), 240);
  app.store.project.mixer[4].fx[0] = { type: 'delay', params: { time: 340, feedback: 0.4, tone: 5000, mix: 0.3 }, on: true };
  link(app.store, 12, -1, { kind: 'fx', track: 4, slot: 0, key: 'mix' });
  handleCC(app, 0, 12, 127);
  assert.equal(app.store.project.mixer[4].fx[0].params.mix, 1);
  assert.deepEqual(fx.at(-1), [4, 0, 'mix', 1]);
  assert.ok(unlink(app.store, b));
  // links survive save / load
  const text = app.store.serialize();
  app.store.load(text);
  assert.equal(controllerLinks(app.store).length, 2);
});
