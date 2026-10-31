import { COLOR, arr, choice, int, num, obj, str } from '../schema.js';
import { automationOf, channelOf, edit, fail, mixerTrackOf, round } from '../helpers.js';
import { describeTarget, readTarget, targetValid, normToValue, valueToNorm } from '../../automation.js';
import { STEPS_PER_BAR } from '../../state.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const TARGET = obj({
  kind: choice(['mixer', 'channel', 'fx', 'chparam', 'tempo'], 'What is automated'),
  track: int('mixer / fx: mixer track', { minimum: 0, maximum: 125 }),
  slot: int('fx: effect slot', { minimum: 0, maximum: 9 }),
  id: int('channel / chparam: channel id'),
  param: choice(['vol', 'pan'], 'mixer / channel: which control'),
  key: str('fx / chparam: parameter key (list_catalog kinds "effects" and "channel_params")'),
}, ['kind'], 'Automation target. mixer: {kind,track,param}; channel: {kind,id,param}; fx: {kind,track,slot,key}; chparam: {kind,id,key}; tempo: {kind} (40-240 BPM; the song keeps the last automated tempo after a clip ends). See list_catalog automation_targets.');

const POINT = obj({
  step: num('Position in steps from the start of the clip', { minimum: 0 }),
  value: num('Value in the target\'s real units (e.g. 0.8 for a mixer fader, Hz for a cutoff); clamped to the target\'s range'),
  curve: choice(['linear', 'smooth', 'hold'], 'Shape of the segment that starts at this point (default linear)'),
}, ['step', 'value']);

/** Validate a target descriptor and return a clean copy. */
function checkTarget(store, t) {
  const need = (...keys) => { for (const k of keys) if (t[k] === undefined) fail(`${t.kind} targets need ${keys.join(', ')}`); };
  let clean;
  switch (t.kind) {
    case 'mixer': need('track', 'param'); mixerTrackOf(store, t.track); clean = { kind: 'mixer', track: t.track, param: t.param }; break;
    case 'channel': need('id', 'param'); channelOf(store, t.id); clean = { kind: 'channel', id: t.id, param: t.param }; break;
    case 'fx': need('track', 'slot', 'key'); clean = { kind: 'fx', track: t.track, slot: t.slot, key: t.key }; break;
    case 'tempo': clean = { kind: 'tempo' }; break;
    default: need('id', 'key'); clean = { kind: 'chparam', id: t.id, key: t.key };
  }
  if (!targetValid(store, clean)) fail(`That ${clean.kind} target does not exist or is not automatable (for fx: is there an effect in that slot, and is the key right?)`);
  return clean;
}

function toPoints(store, target, points, len) {
  const sorted = [...points].sort((a, b) => a.step - b.step);
  for (const p of sorted) if (p.step > len + 1e-6) fail(`Point at step ${p.step} is past the end of the automation (length ${len}) — increase length`);
  return sorted.map((p) => ({ x: p.step, y: valueToNorm(store, target, p.value), ...(p.curve && p.curve !== 'linear' ? { curve: p.curve } : {}) }));
}

function describe(store, a) {
  return {
    id: a.id, name: a.name, target: a.target, length: a.len,
    points: a.points.map((p) => ({ step: round(p.x), value: round(normToValue(store, a.target, p.y), 4), normalized: round(p.y), curve: p.curve || 'linear' })),
    clips: store.project.playlist.clips.filter((c) => c.type === 'auto' && c.autoId === a.id).map((c) => ({ id: c.id, track: c.track, start: c.start, length: c.len })),
  };
}

export const tools = [
  {
    name: 'create_automation',
    title: 'Create automation',
    description: 'Automate a knob or fader over time (like right-click → Create automation clip). Creates the curve and places an automation clip in the playlist, where it only takes effect in song mode. Without `points` the curve is flat at the control\'s current value. Reference positions are steps (16 = 1 bar) from the clip start.',
    inputSchema: obj({
      target: TARGET,
      name: str('Name (default: describes the target)'),
      length: num('Curve length in steps (default 16 = 1 bar)', { minimum: 1 }),
      points: arr(POINT, 'Curve points (at least 2 recommended)', { minItems: 1 }),
      track: int('Playlist track for the clip (default: first free)', { minimum: 0, maximum: 124 }),
      start: num('Clip start in steps (default 0)', { minimum: 0 }),
      color: COLOR,
    }, ['target']),
    annotations: { ...WRITE, title: 'Create automation' },
    run(a, app) {
      const { store } = app;
      const target = checkTarget(store, a.target);
      const len = a.length ?? STEPS_PER_BAR;
      const start = a.start ?? 0;
      const points = a.points ? toPoints(store, target, a.points, len) : null;
      const made = edit(store, () => {
        const auto = store.addAutomation({ name: a.name?.trim() || describeTarget(store, target), target, value: valueToNorm(store, target, readTarget(store, target)), len });
        if (points) auto.points = points.length === 1 ? [points[0], { ...points[0], x: len }] : points;
        if (a.color) auto.color = a.color;
        let track = a.track ?? 0;
        if (a.track === undefined) while (store.project.playlist.clips.some((c) => c.track === track && c.start < start + len && c.start + c.len > start)) track++;
        store.addClip({ type: 'auto', autoId: auto.id, track, start, len });
        return auto;
      });
      store.emit('playlist');
      return describe(store, made);
    },
  },
  {
    name: 'get_automation',
    title: 'Get automation',
    description: 'Read an automation\'s target, curve points (in real values) and the playlist clips that use it.',
    inputSchema: obj({ id: int('Automation id') }, ['id']),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Get automation' },
    run: (a, app) => describe(app.store, automationOf(app.store, a.id)),
  },
  {
    name: 'update_automation',
    title: 'Update automation',
    description: 'Rename an automation, change its length, or replace its curve (`points` replaces all points). Clips that matched the old length follow the new one.',
    inputSchema: obj({
      id: int('Automation id'),
      name: str('New name'),
      length: num('New curve length in steps', { minimum: 1 }),
      points: arr(POINT, 'The complete new curve', { minItems: 1 }),
      color: COLOR,
    }, ['id']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Update automation' },
    run(a, app) {
      const { store } = app;
      const auto = automationOf(store, a.id);
      const len = a.length ?? auto.len;
      const points = a.points ? toPoints(store, auto.target, a.points, len) : null;
      edit(store, () => {
        if (a.name !== undefined) auto.name = a.name.trim() || auto.name;
        if (a.color) auto.color = a.color;
        if (len !== auto.len) {
          for (const c of store.project.playlist.clips) if (c.type === 'auto' && c.autoId === auto.id && c.len === auto.len) c.len = len;
          auto.len = len;
          if (!points) {
            auto.points = auto.points.filter((p) => p.x <= len);
            if (auto.points.length < 2) auto.points.push({ x: len, y: auto.points[0]?.y ?? 0 });
          }
        }
        if (points) auto.points = points.length === 1 ? [points[0], { ...points[0], x: len }] : points;
        store.emit('playlist');
      });
      return describe(store, auto);
    },
  },
  {
    name: 'remove_automation',
    title: 'Remove automation',
    description: 'Delete an automation and all playlist clips that use it.',
    inputSchema: obj({ id: int('Automation id') }, ['id']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Remove automation' },
    run(a, app) {
      const { store } = app;
      const auto = automationOf(store, a.id);
      edit(store, () => {
        store.project.automations = store.project.automations.filter((x) => x !== auto);
        store.project.playlist.clips = store.project.playlist.clips.filter((c) => !(c.type === 'auto' && c.autoId === auto.id));
        store.emit('playlist');
      });
      return { removed: auto.id };
    },
  },
];
