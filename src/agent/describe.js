// Read-only views of the project for agents: compact, named, and without the 125 empty mixer/playlist tracks.
import { PARAM_META } from '../audio/instruments.js';
import { noteName } from '../util.js';
import { MIXER_TRACKS, STEPS_PER_BAR } from '../state.js';
import { round } from './helpers.js';
import { roleOf } from './music/roles.js';

export function channelInfo(app, ch) {
  const cat = app.actions.catalog?.();
  const out = { id: ch.id, name: ch.name, type: ch.type, role: roleOf(ch), vol: round(ch.vol), pan: round(ch.pan), mute: ch.mute, solo: ch.solo, mixer: ch.mixer, color: ch.color };
  if (ch.type === 'drum') out.voice = ch.voice;
  if (ch.type === 'sf') {
    out.bank = ch.bank;
    out.program = ch.program;
    if (ch.fixedKey != null) out.fixedKey = ch.fixedKey;
    out.rootPitch = ch.rootPitch;
    const name = ch.bank === 128
      ? cat?.kits.find((k) => k.program === ch.program)?.name
      : cat?.families.flatMap((f) => f.presets).find((p) => p.bank === ch.bank && p.program === ch.program)?.name;
    if (name) out.instrument = name;
  }
  if (ch.type === 'sampler') {
    out.sampleId = ch.sampleId;
    if (ch.zones) out.zones = ch.zones.map((z) => ({ sample: z.sampleId, root: z.root, lo: z.lo, hi: z.hi, ...(z.vlo != null ? { velocityMin: z.vlo } : {}), ...(z.vhi != null ? { velocityMax: z.vhi } : {}) }));
  }
  out.params = ch.params;
  return out;
}

export function patternInfo(store, pat) {
  const notes = {};
  for (const [id, list] of Object.entries(pat.notes)) if (list.length) notes[id] = list.length;
  const steps = store.patternSteps(pat);
  return { id: pat.id, name: pat.name, color: pat.color, bars: pat.bars, steps, notesPerChannel: notes };
}

export function clipInfo(c) {
  const out = { id: c.id, type: c.type, track: c.track, start: c.start, length: c.len, offset: c.offset || 0, mute: !!c.mute };
  if (c.type === 'pattern') out.pattern = c.pat;
  else if (c.type === 'audio') {
    out.sample = c.sampleId;
    out.gain = c.gain ?? 1;
    if (c.fadeIn) out.fadeIn = c.fadeIn;
    if (c.fadeOut) out.fadeOut = c.fadeOut;
    if (c.reverse) out.reverse = true;
    if (c.stretch) out.stretch = c.stretch;
    if (c.pitch) out.pitch = c.pitch;
  } else out.automation = c.autoId;
  return out;
}

export function automationInfo(store, a, withPoints = false) {
  return { id: a.id, name: a.name, target: a.target, length: a.len, ...(withPoints ? { points: a.points } : { pointCount: a.points.length }) };
}

export function mixerTrackInfo(store, i) {
  const m = store.project.mixer[i];
  const out = { track: i, name: m.name, vol: round(m.vol), pan: round(m.pan), mute: m.mute, solo: m.solo, color: m.color };
  if (i > 0) out.toMaster = m.master !== false;
  if (m.group) out.group = m.group;
  out.effects = m.fx.map((slot, k) => (slot ? { slot: k, type: slot.type, on: slot.on, params: slot.params } : null)).filter(Boolean);
  out.sends = Object.entries(m.sends).map(([to, level]) => ({ to: Number(to), level: round(level) }));
  out.channels = store.project.channels.filter((c) => c.mixer === i).map((c) => c.id);
  return out;
}

const isCustomMixer = (store, i) => {
  const m = store.project.mixer[i];
  return i === 0 || m.name !== `Insert ${i}` || m.vol !== 0.8 || m.pan !== 0 || m.mute || m.solo || m.color || m.master === false || m.group || m.fx.some(Boolean) || Object.keys(m.sends).length
    || store.project.channels.some((c) => c.mixer === i) || store.project.playlist.tracks.some((t) => t.mixer === i);
};

export function transportInfo(app) {
  const t = app.transport;
  const pos = t.position();
  const bst = t.formatBst(pos);
  return {
    playing: t.playing, positionSteps: round(pos), position: `${bst.bar}:${bst.beat}:${String(bst.tick).padStart(2, '0')}`,
    seconds: round(t.secondsAt(pos), 2), mode: t.mode, loopEnabled: t.loopEnabled, metronome: t.metronome,
  };
}

export function summarize(app) {
  const { store } = app;
  const p = store.project;
  const usedTracks = [];
  const perTrack = new Map();
  for (const c of p.playlist.clips) perTrack.set(c.track, (perTrack.get(c.track) || 0) + 1);
  p.playlist.tracks.forEach((t, i) => {
    if (perTrack.has(i) || t.mute || t.mixer || t.color || t.name !== `Track ${i + 1}`) usedTracks.push({ track: i, name: t.name, mute: t.mute, mixer: t.mixer, clips: perTrack.get(i) || 0 });
  });
  const end = store.playlistEndStep();
  const mixerTracks = [];
  for (let i = 0; i < MIXER_TRACKS; i++) if (isCustomMixer(store, i)) mixerTracks.push(mixerTrackInfo(store, i));
  return {
    name: p.name,
    filePath: store.filePath,
    unsavedChanges: store.dirty,
    bpm: p.bpm,
    timeSig: p.timeSig,
    stepsPerBar: store.barSteps,
    ...(p.song ? { song: p.song } : {}),
    swing: p.swing,
    masterPitch: p.masterPitch,
    mode: p.mode,
    loop: p.loop ? { ...p.loop, enabled: app.transport.loopEnabled } : null,
    selected: { channel: p.selected.channel, pattern: p.selected.pattern, mixerTrack: p.selected.mixer },
    transport: transportInfo(app),
    channels: p.channels.map((c) => channelInfo(app, c)),
    patterns: p.patterns.map((pat) => patternInfo(store, pat)),
    playlist: { clipCount: p.playlist.clips.length, endStep: end, endBar: end / STEPS_PER_BAR, tracks: usedTracks },
    mixer: mixerTracks,
    automations: p.automations.map((a) => automationInfo(store, a)),
    samples: [...store.samples].map(([id, s]) => ({ id, name: s.name, bytes: s.data.byteLength })),
    history: { canUndo: store.undoStack.length > 0, canRedo: store.redoStack.length > 0 },
  };
}

export const paramReference = (type) => (PARAM_META[type] || []).map((m) => ({
  key: m.key, label: m.label, ...(m.type ? { type: m.type } : { type: 'number' }), ...(m.options ? { options: m.options } : {}),
  ...(m.min != null ? { min: m.min, max: m.max } : {}), default: m.def, ...(m.log ? { logarithmic: true } : {}), ...(m.step ? { step: m.step } : {}),
}));

export { noteName };
