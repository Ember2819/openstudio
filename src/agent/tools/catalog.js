import { choice, int, obj, str } from '../schema.js';
import { fail } from '../helpers.js';
import { paramReference } from '../describe.js';
import { DRUM_KIT, PARAM_META, allEnginePresets } from '../../audio/instruments.js';
import { EFFECT_DEFS } from '../../audio/effects.js';
import { MIXER_TRACKS } from '../../state.js';

const effectReference = () => Object.entries(EFFECT_DEFS).map(([type, def]) => ({
  type, name: def.name,
  params: def.params.map((m) => ({
    key: m.key, label: m.label, ...(m.options ? { options: m.options } : { min: m.min, max: m.max }), default: m.def, ...(m.log ? { logarithmic: true } : {}),
  })),
}));

const TARGET_FORMATS = [
  { kind: 'mixer', fields: '{ kind: "mixer", track, param: "vol" | "pan" }', note: 'Mixer track fader / pan. vol is 0-1 (0.8 = 0 dB), pan is -1..1.' },
  { kind: 'channel', fields: '{ kind: "channel", id, param: "vol" | "pan" }', note: 'Channel volume (0-1) / pan.' },
  { kind: 'fx', fields: '{ kind: "fx", track, slot, key }', note: 'A parameter of the effect in a mixer slot; see list_catalog kind "effects" for keys and ranges.' },
  { kind: 'chparam', fields: '{ kind: "chparam", id, key }', note: 'A numeric instrument parameter of a channel; see list_catalog kind "channel_params".' },
];

export const tools = [
  {
    name: 'list_catalog',
    title: 'List catalog',
    description: 'Look up what can be added or tuned. kind: "instruments" (General MIDI sounds for add_channel type "instrument"; filter with query/family), "drum_kits" (kits and their pieces; pass query to see the pieces of matching kits), "synth_presets", "drum_voices" (built-in synthesized drums), "effects" (mixer effects and their parameter ranges), "channel_params" (instrument parameters per channel type), "automation_targets" (target formats).',
    inputSchema: obj({
      kind: choice(['instruments', 'drum_kits', 'synth_presets', 'drum_voices', 'effects', 'channel_params', 'automation_targets'], 'What to list'),
      query: str('Case-insensitive text to match in names'),
      family: str('For instruments: a family such as "Piano", "Strings", "Synth lead"'),
      limit: int('Maximum rows for instruments (default 60)', { minimum: 1, maximum: 500 }),
    }, ['kind']),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'List catalog' },
    run(a, app) {
      const q = a.query?.trim().toLowerCase();
      const has = (s) => !q || s.toLowerCase().includes(q);
      switch (a.kind) {
        case 'instruments': {
          const cat = app.actions.catalog() ?? fail('The instrument bank is still loading (or missing — run "npm run assets"). Try again in a moment.');
          const fam = a.family?.trim().toLowerCase();
          const rows = [];
          for (const f of cat.families) {
            if (fam && !f.name.toLowerCase().includes(fam)) continue;
            for (const p of f.presets) if (has(p.name) || has(f.name)) rows.push({ family: f.name, name: p.name, bank: p.bank, program: p.program });
          }
          const limit = a.limit ?? 60;
          return { families: cat.families.map((f) => f.name), total: rows.length, instruments: rows.slice(0, limit), ...(rows.length > limit ? { note: `Showing ${limit} of ${rows.length}; narrow with query or family.` } : {}) };
        }
        case 'drum_kits': {
          const cat = app.actions.catalog() ?? fail('The instrument bank is still loading (or missing — run "npm run assets"). Try again in a moment.');
          const kits = cat.kits.filter((k) => has(k.name));
          return {
            note: 'A "drum_kit" channel without a piece plays the whole kit: use the piece\'s key as the note pitch. With a piece it plays only that sound for any note.',
            kits: kits.map((k) => ({ name: k.name, program: k.program, ...(q ? { pieces: k.pieces } : { pieceCount: k.pieces.length }) })),
          };
        }
        case 'synth_presets':
          return {
            note: 'add_channel type = the engine below, with preset = the name; update_channel preset switches an existing channel. Parameters: kind "channel_params".',
            presets: allEnginePresets().filter((p) => has(p.name) || has(p.category) || has(p.type)).map((p) => ({ engine: p.type, category: p.category, name: p.name, params: p.params })),
          };
        case 'drum_voices':
          return { voices: DRUM_KIT.filter((d) => has(d.name)).map((d) => ({ name: d.name, voice: d.voice })), note: 'add_channel type "drum" with voice; pitch has no effect on pattern notes except tuning (use 60).' };
        case 'effects':
          return { slotsPerTrack: 10, effects: effectReference().filter((e) => has(e.type) || has(e.name)) };
        case 'channel_params':
          return Object.fromEntries(Object.keys(PARAM_META).map((t) => [t, paramReference(t)]));
        case 'automation_targets':
          return {
            formats: TARGET_FORMATS,
            mixerTracks: `0 (master) to ${MIXER_TRACKS - 1}`,
            channels: app.store.project.channels.map((c) => ({ id: c.id, name: c.name, type: c.type })),
            effectsInUse: app.store.project.mixer.flatMap((m, track) => m.fx.map((slot, k) => (slot ? { track, slot: k, type: slot.type } : null)).filter(Boolean)),
          };
        default:
          return fail(`Unknown catalog kind ${a.kind}`);
      }
    },
  },
];
