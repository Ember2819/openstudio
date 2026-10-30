import { COLOR, bool, choice, int, maybe, num, obj, str } from '../schema.js';
import { checkParam, edit, fail, mixerTrackOf } from '../helpers.js';
import { mixerTrackInfo } from '../describe.js';
import { EFFECT_DEFS, defaultEffectParams } from '../../audio/effects.js';
import { MIXER_TRACKS } from '../../state.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const TRACK = int('Mixer track: 0 = master, 1-125 = inserts', { minimum: 0, maximum: 125 });
const SLOTS = 10;
const slotOf = (v) => (Number.isInteger(v) && v >= 0 && v < SLOTS ? v : fail(`Effect slot must be 0-${SLOTS - 1}`));

const EFFECT_PARAMS = obj({}, [], 'Effect parameters as { key: value }; keys and ranges: list_catalog kind "effects"');
EFFECT_PARAMS.additionalProperties = true;

export const tools = [
  {
    name: 'get_mixer_track',
    title: 'Get mixer track',
    description: 'Details of one mixer track: levels, mute/solo, effect chain with parameters, sends and the channels routed to it. (get_project lists every track in use.)',
    inputSchema: obj({ track: TRACK }, ['track']),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Get mixer track' },
    run(a, app) { mixerTrackOf(app.store, a.track); return mixerTrackInfo(app.store, a.track); },
  },
  {
    name: 'update_mixer_track',
    title: 'Update mixer track',
    description: 'Set a mixer track\'s name, fader (0-1, where 0.8 = 0 dB and 1 = +6 dB), pan (-1..1), mute, solo, colour, or whether it feeds the master (toMaster: false for an insert that should only reach the master through a send to a bus). Only the fields you pass change.',
    inputSchema: obj({
      track: TRACK,
      name: str('Track name'),
      vol: num('Fader 0-1 (0.8 = 0 dB)', { minimum: 0, maximum: 1 }),
      pan: num('Pan -1..1', { minimum: -1, maximum: 1 }),
      mute: bool('Mute'),
      solo: bool('Solo'),
      color: maybe(COLOR),
      toMaster: bool('Route this insert to the master (default true)'),
    }, ['track']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Update mixer track' },
    run(a, app) {
      const { store } = app;
      const m = mixerTrackOf(store, a.track);
      edit(store, () => {
        if (a.name !== undefined) m.name = a.name.trim() || m.name;
        if (a.vol !== undefined) m.vol = a.vol;
        if (a.pan !== undefined) m.pan = a.pan;
        if (a.mute !== undefined) m.mute = a.mute;
        if (a.solo !== undefined) m.solo = a.solo;
        if (a.color !== undefined) m.color = a.color;
        if (a.toMaster !== undefined && a.track > 0) { if (a.toMaster) delete m.master; else m.master = false; }
        store.emit('mixer');
        store.emit('mixerSelection');
      });
      return mixerTrackInfo(store, a.track);
    },
  },
  {
    name: 'set_effect',
    title: 'Set effect',
    description: 'Add, change or remove a mixer effect. Each track has 10 slots processed in order. With `type` the slot gets that effect (a new one starts from defaults; omit slot to use the first free one); with only `params` / `on` the effect already in the slot is adjusted (on: false bypasses it); type null removes it. Effects: see list_catalog kind "effects".',
    inputSchema: obj({
      track: TRACK,
      slot: int('Effect slot 0-9', { minimum: 0, maximum: SLOTS - 1 }),
      type: { type: ['string', 'null'], enum: [...Object.keys(EFFECT_DEFS), null], description: 'Effect type, or null to remove the effect in the slot' },
      params: EFFECT_PARAMS,
      on: bool('false bypasses the effect'),
    }, ['track']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Set effect' },
    run(a, app) {
      const { store, engine } = app;
      const m = mixerTrackOf(store, a.track);
      let slot = a.slot;
      if (slot === undefined) {
        if (a.type == null) fail('Say which slot (0-9)');
        slot = m.fx.findIndex((s) => !s);
        if (slot < 0) fail('All 10 effect slots on this track are in use');
      }
      slotOf(slot);
      edit(store, () => {
        if (a.type === null) {
          m.fx[slot] = null;
        } else {
          if (a.type !== undefined && m.fx[slot]?.type !== a.type) m.fx[slot] = { type: a.type, params: defaultEffectParams(a.type), on: true };
          const fx = m.fx[slot] ?? fail(`Slot ${slot} is empty — pass type to add an effect`);
          const meta = EFFECT_DEFS[fx.type].params;
          for (const [key, value] of Object.entries(a.params || {})) fx.params[key] = checkParam(meta, key, value, EFFECT_DEFS[fx.type].name);
          if (a.on !== undefined) fx.on = a.on;
        }
        engine.syncFx(a.track);
        store.emit('mixer');
        store.emit('mixerSelection');
      });
      return mixerTrackInfo(store, a.track);
    },
  },
  {
    name: 'move_effect',
    title: 'Move effect',
    description: 'Swap an effect with its neighbour in the chain (earlier = processed first). Automation aimed at the effect follows it.',
    inputSchema: obj({ track: TRACK, slot: int('Effect slot 0-9', { minimum: 0, maximum: SLOTS - 1 }), direction: choice(['up', 'down'], 'up = towards slot 0') }, ['track', 'slot', 'direction']),
    annotations: { ...WRITE, title: 'Move effect' },
    run(a, app) {
      const { store, engine } = app;
      const m = mixerTrackOf(store, a.track);
      const k = a.slot;
      const j = k + (a.direction === 'up' ? -1 : 1);
      if (j < 0 || j >= SLOTS) fail(`Slot ${k} cannot move ${a.direction}`);
      edit(store, () => {
        [m.fx[k], m.fx[j]] = [m.fx[j], m.fx[k]];
        for (const au of store.project.automations) {
          const t = au.target;
          if (t.kind !== 'fx' || t.track !== a.track) continue;
          if (t.slot === k) t.slot = j; else if (t.slot === j) t.slot = k;
        }
        engine.resetFx(a.track);
        store.emit('mixer');
        store.emit('mixerSelection');
      });
      return mixerTrackInfo(store, a.track);
    },
  },
  {
    name: 'set_send',
    title: 'Set send',
    description: 'Route part of a mixer track\'s signal to another track (aux / bus send), after its fader. level 0-1 (0.8 = 0 dB); null removes the send. Sends that would create a feedback loop are refused. Every track already feeds the master.',
    inputSchema: obj({
      from: int('Source mixer track', { minimum: 1, maximum: MIXER_TRACKS - 1 }),
      to: int('Destination mixer track', { minimum: 1, maximum: MIXER_TRACKS - 1 }),
      level: { type: ['number', 'null'], minimum: 0, maximum: 1, description: 'Send level 0-1, or null to remove' },
    }, ['from', 'to', 'level']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Set send' },
    run(a, app) {
      const { store } = app;
      const m = mixerTrackOf(store, a.from);
      mixerTrackOf(store, a.to);
      if (a.level !== null && store.wouldCycle(a.from, a.to)) fail(`A send from ${a.from} to ${a.to} would create a feedback loop`);
      edit(store, () => {
        if (a.level === null) delete m.sends[a.to]; else m.sends[a.to] = a.level;
        store.emit('mixer');
        store.emit('mixerSelection');
      });
      return mixerTrackInfo(store, a.from);
    },
  },
  {
    name: 'reset_mixer',
    title: 'Reset mixer',
    description: 'Reset every mixer track to its defaults: faders, pans, mute/solo, effects and sends. Channel routing and names are kept.',
    inputSchema: obj({}),
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true, title: 'Reset mixer' },
    run(_, app) {
      app.actions.resetMixer();
      return { reset: true };
    },
  },
];
