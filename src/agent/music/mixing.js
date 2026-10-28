// Role-based mixing: where every kind of part belongs in level, stereo field, tone and space. Applies a sensible
// starting mix (own mixer track per channel, high-pass and compression where they help, shared reverb and delay
// buses, a gentle master chain). Effects it creates are tagged `auto` so running it again replaces them
// instead of piling up, and never touches effects the user added.
import { MIX_ROLES } from './styles.js';
import { roleOf } from './roles.js';
import { defaultEffectParams } from '../../audio/effects.js';

/** How wet each style likes its mix: reverb amount, hall size (s) and delay amount. */
const SPACE = {
  ambient: { rev: 1.7, size: 5.5, del: 1.2 }, lofi: { rev: 1.1, size: 2.6, del: 0.8 }, hiphop: { rev: 0.9, size: 1.9, del: 0.9 },
  techno: { rev: 0.8, size: 2.2, del: 1.1 }, trance: { rev: 1.2, size: 3.4, del: 1.1 }, house: { rev: 0.9, size: 2.4, del: 0.9 },
  trap: { rev: 1, size: 2.8, del: 1 }, pop: { rev: 1, size: 2.2, del: 0.8 }, rock: { rev: 0.9, size: 1.8, del: 0.6 },
  dnb: { rev: 0.9, size: 2.4, del: 1 }, synthwave: { rev: 1.3, size: 3.2, del: 1.2 }, funk: { rev: 0.7, size: 1.6, del: 0.5 },
};
const DEFAULT_SPACE = { rev: 1, size: 2.4, del: 1 };

/** Fader position for a linear gain (the inverse of util.faderToGain). */
export function gainToFader(g) {
  if (g <= 0) return 0;
  if (g >= 1) return Math.min(1, 0.8 + (0.2 * 20 * Math.log10(g)) / 6);
  return 0.8 * Math.pow(g, 1 / 2.5);
}
/** Send level (fader law) that gives a wet amount of `g` as a linear gain. */
const sendLevel = (g) => Math.round(gainToFader(Math.max(0.001, g)) * 1000) / 1000;

const clearAuto = (m) => { m.fx = m.fx.map((s) => (s?.auto ? null : s)); };
function addAuto(m, type, params = {}) {
  const slot = m.fx.findIndex((s) => !s);
  if (slot < 0) return false;
  m.fx[slot] = { type, params: { ...defaultEffectParams(type), ...params }, on: true, auto: true };
  return true;
}

/** Find or create the shared reverb / delay bus. Returns its mixer track, or null when there is no room. */
function ensureBus(store, kind, name, params) {
  const mixer = store.project.mixer;
  let i = mixer.findIndex((m, k) => k > 0 && m.bus === kind);
  if (i < 0) i = store.freeMixerTrack() ?? -1;
  if (i < 0) return null;
  const m = mixer[i];
  m.bus = kind;
  if (/^Insert \d+$/.test(m.name) || m.name === name) m.name = name;
  clearAuto(m);
  addAuto(m, kind, params);
  m.vol = 0.8;
  m.pan = 0;
  return i;
}

/**
 * Apply the starting mix to every channel. opts: { style, bpm } for the room and delay timing.
 * Returns what it did per channel.
 */
export function applyMixPlan(app, { style, bpm }) {
  const { store, engine } = app;
  const proj = store.project;
  const space = SPACE[style] ?? DEFAULT_SPACE;
  const touched = new Set([0]);

  const rev = ensureBus(store, 'reverb', 'Reverb', { size: space.size, pre: 0.02, damp: 0.5, mix: 1 });
  const del = ensureBus(store, 'delay', 'Delay', { time: Math.round((60000 / bpm) * 0.75), feedback: 0.38, tone: 3800, mix: 1 });
  if (rev) touched.add(rev);
  if (del) touched.add(del);

  const seen = new Map(); // role -> how many channels already placed (alternates their pan)
  const rows = [];
  for (const ch of proj.channels) {
    const role = roleOf(ch);
    const plan = MIX_ROLES[role] ?? MIX_ROLES.chords;
    if (ch.mixer === 0) {
      const free = store.freeMixerTrack();
      if (free != null) { ch.mixer = free; if (/^Insert \d+$/.test(proj.mixer[free].name)) proj.mixer[free].name = ch.name; }
    }
    const i = ch.mixer;
    if (i === 0) { rows.push({ channel: ch.id, name: ch.name, role, note: 'no free mixer track: left on the master' }); continue; }
    const shared = proj.channels.filter((c) => c.mixer === i).length > 1;
    const n = seen.get(role) ?? 0;
    seen.set(role, n + 1);
    const m = proj.mixer[i];
    clearAuto(m);
    m.vol = plan.vol;
    m.pan = Math.round((n % 2 === 0 ? 1 : -1) * plan.pan * 100) / 100;
    if (plan.hp > 0) addAuto(m, 'filter', { mode: 'highpass', cutoff: plan.hp, res: 0.7 });
    if (plan.comp) addAuto(m, 'compressor', plan.comp);
    if (plan.width) addAuto(m, 'stereo', { width: plan.width });
    if (role === 'pad') addAuto(m, 'chorus', { rate: 0.4, depth: 0.45, mix: 0.28 });
    m.sends = Object.fromEntries(Object.entries(m.sends ?? {}).filter(([to]) => Number(to) !== rev && Number(to) !== del));
    if (rev && plan.send[0] > 0 && !shared) m.sends[rev] = sendLevel(Math.min(0.6, plan.send[0] * space.rev));
    if (del && plan.send[1] > 0 && !shared) m.sends[del] = sendLevel(Math.min(0.5, plan.send[1] * space.del));
    touched.add(i);
    rows.push({ channel: ch.id, name: ch.name, role, mixer: i, fader: m.vol, pan: m.pan, effects: m.fx.filter((s) => s?.auto).map((s) => s.type), sends: Object.keys(m.sends).length ? { reverb: rev != null ? m.sends[rev] ?? 0 : 0, delay: del != null ? m.sends[del] ?? 0 : 0 } : undefined });
  }

  // gentle bus compression and a safety limiter on the master
  const master = proj.mixer[0];
  clearAuto(master);
  addAuto(master, 'compressor', { threshold: -14, ratio: 2, attack: 0.03, release: 0.25, gain: 1.5 });
  addAuto(master, 'limiter', { ceiling: -1, release: 0.08, gain: 0 });

  for (const t of touched) engine.syncFx?.(t);
  store.emit('mixer');
  store.emit('mixerSelection');
  store.emit('channels');
  return { channels: rows, buses: { reverb: rev, delay: del }, master: master.fx.filter((s) => s?.auto).map((s) => s.type) };
}
