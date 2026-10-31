// MIDI controller links (FL Studio's "Link to controller"): a hardware knob, fader or slider (a MIDI CC) drives any
// automatable control. Links are saved with the project: project.controllerLinks = [{ cc, channel, target }], where
// channel is the MIDI channel 0-15 or -1 for any. Learning binds the next CC that moves.
import { normToValue, writeTarget, targetValid, describeTarget } from './automation.js';

const sameTarget = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function controllerLinks(store) {
  store.project.controllerLinks ??= [];
  return store.project.controllerLinks;
}

/** The link that drives a target, if any. */
export const linkFor = (store, target) => controllerLinks(store).find((l) => sameTarget(l.target, target)) ?? null;

export function unlink(store, target) {
  const list = controllerLinks(store);
  const i = list.findIndex((l) => sameTarget(l.target, target));
  if (i >= 0) list.splice(i, 1);
  return i >= 0;
}

/** Bind a CC (on a MIDI channel, -1 = any) to a target, replacing whatever that CC or that target had. */
export function link(store, cc, channel, target) {
  const list = controllerLinks(store);
  store.project.controllerLinks = list.filter((l) => !(l.cc === cc && (l.channel === channel || l.channel === -1 || channel === -1)) && !sameTarget(l.target, target));
  const made = { cc, channel, target: { ...target } };
  store.project.controllerLinks.push(made);
  return made;
}

/**
 * Handle a control change. Returns true when a link used it. While learning, the first CC binds the pending target.
 * `app`: { store, engine, transport, controllers: { pending } }. Each gesture (a pause of a second or more starts a new
 * one) is one undo step.
 */
export function handleCC(app, channel, cc, value) {
  const { store } = app;
  const state = app.controllers;
  if (state?.pending) {
    store.checkpoint();
    const made = link(store, cc, -1, state.pending);
    state.pending = null;
    state.onLearned?.(made);
    store.emit('controllers');
    return true;
  }
  const hits = controllerLinks(store).filter((l) => l.cc === cc && (l.channel === -1 || l.channel === channel));
  if (!hits.length) return false;
  const now = Date.now();
  if (!state || now - (state.lastMove ?? 0) > 1000) store.checkpoint();
  if (state) state.lastMove = now;
  for (const l of hits) {
    if (!targetValid(store, l.target)) continue;
    const v = normToValue(store, l.target, value / 127);
    const evt = writeTarget(store, app.engine, l.target, v);
    if (evt === 'tempo') app.transport?.setBpm(v);
    else if (evt === 'channelParams') store.emit('channelParams', l.target.id);
    else if (evt) store.emit(evt);
  }
  store.dirty = true;
  return true;
}

/** Text for menus: "CC 21 → Insert 1 — Volume". */
export const describeLink = (store, l) => `CC ${l.cc}${l.channel >= 0 ? ` (ch ${l.channel + 1})` : ''} → ${describeTarget(store, l.target)}`;
