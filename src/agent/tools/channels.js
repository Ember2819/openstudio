import { COLOR, PITCH, bool, choice, int, num, obj, ref, str, arr } from '../schema.js';
import { channelOf, checkParam, edit, fail, parsePitch, pickByName, round } from '../helpers.js';
import { channelInfo } from '../describe.js';
import { DRUM_KIT, PARAM_META, SYNTH_PRESETS } from '../../audio/instruments.js';
import { MIXER_TRACKS } from '../../state.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const catalogOf = (app) => app.actions.catalog() ?? fail('The instrument bank is still loading (or missing — run "npm run assets"). Try again in a moment.');

function mixerIndex(v) {
  if (!Number.isInteger(v) || v < 0 || v >= MIXER_TRACKS) fail(`mixer must be 0 (master) to ${MIXER_TRACKS - 1}`);
  return v;
}

/** Read an audio file from disk into the sample library; resolves to { id, name, seconds }. */
export async function importSample(app, path) {
  const data = await app.files.read(path);
  const name = path.split(/[\\/]/).pop();
  const id = app.store.addSample(name, data);
  const buffer = await app.engine.ensureSample(id);
  if (!buffer) {
    app.store.samples.delete(id);
    fail(`Could not decode ${name} — supported formats: wav, mp3, ogg, flac, aac, m4a`);
  }
  app.store.dirty = true;
  app.store.emit('sampleReady', id);
  return { id, name, seconds: round(buffer.duration, 3) };
}

/** Resolve a melodic General MIDI sound from a name or bank/program. */
function resolveInstrument(app, { instrument, bank, program }) {
  const all = catalogOf(app).families.flatMap((f) => f.presets);
  if (instrument !== undefined) return pickByName(all, instrument, 'instrument');
  if (program !== undefined) {
    return all.find((p) => p.bank === (bank ?? 0) && p.program === program) ?? fail(`No instrument at bank ${bank ?? 0}, program ${program} — see list_catalog`);
  }
  return fail('Say which instrument: instrument (a name) or program (0-127, with optional bank)');
}

function resolveKit(app, kit) {
  const kits = catalogOf(app).kits;
  return typeof kit === 'number' ? (kits.find((k) => k.program === kit) ?? fail(`No drum kit with program ${kit}`)) : pickByName(kits, kit, 'drum kit');
}

function resolvePiece(kit, piece) {
  if (typeof piece === 'number') return kit.pieces.find((p) => p.key === piece) ?? fail(`${kit.name} has no piece on key ${piece}`);
  return pickByName(kit.pieces, piece, 'drum piece');
}

function applyParams(ch, params) {
  const meta = PARAM_META[ch.type] || [];
  for (const [key, value] of Object.entries(params)) ch.params[key] = checkParam(meta, key, value, `${ch.type} channels`);
}

function touched(store, ch) {
  store.emit('channelParams', ch.id);
  store.emit('channels');
  store.emit('mixer');
}

const PARAMS = obj({}, [], 'Instrument parameters as { key: value }. Keys and ranges per channel type: list_catalog kind "channel_params".');
PARAMS.additionalProperties = true;

export const tools = [
  {
    name: 'add_channel',
    title: 'Add channel',
    description: 'Add an instrument channel to the rack (like ADD → One more channel). type "instrument": a General MIDI sound (give instrument name, or program/bank). "drum_kit": a SoundFont drum kit (kit name or program), optionally one piece (name or key) to make a single-drum channel. "synth": the built-in synth, optionally from a preset. "drum": a built-in synthesized drum voice. "sampler": plays a sample (a sample id from import_sample, or a file path). Returns the new channel; its id is used everywhere else. The new channel becomes selected.',
    inputSchema: obj({
      type: choice(['instrument', 'drum_kit', 'synth', 'drum', 'sampler'], 'Kind of channel'),
      name: str('Channel name (defaults to the instrument / piece / preset name)'),
      instrument: str('instrument: General MIDI sound name, e.g. "Grand Piano" (see list_catalog)'),
      bank: int('instrument: SoundFont bank (default 0)', { minimum: 0, maximum: 127 }),
      program: int('instrument: program number 0-127', { minimum: 0, maximum: 127 }),
      kit: { type: ['string', 'integer'], description: 'drum_kit: kit name or program number' },
      piece: { type: ['string', 'integer'], description: 'drum_kit: piece name or key; omit for the full kit on one channel' },
      preset: str('synth: preset name, e.g. "Saw Bass" (see list_catalog synth_presets)'),
      voice: choice(DRUM_KIT.map((d) => d.voice), 'drum: built-in drum voice'),
      sample: int('sampler: sample id from import_sample'),
      path: str('sampler: absolute path of an audio file to import and use'),
      params: PARAMS,
      mixer: int('Mixer track to route to (default 0 = master)', { minimum: 0, maximum: 125 }),
      vol: num('Channel volume 0-1 (default 0.78)', { minimum: 0, maximum: 1 }),
      pan: num('Pan -1..1', { minimum: -1, maximum: 1 }),
      color: COLOR,
    }, ['type']),
    annotations: { ...WRITE, title: 'Add channel' },
    async run(a, app) {
      const { store } = app;
      let spec;
      switch (a.type) {
        case 'instrument': {
          const p = resolveInstrument(app, a);
          spec = { name: p.name.replace(/ \(variation \d+\)$/, ''), type: 'sf', bank: p.bank, program: p.program };
          break;
        }
        case 'drum_kit': {
          if (a.kit === undefined) fail('drum_kit needs kit (a name or program number)');
          const kit = resolveKit(app, a.kit);
          spec = a.piece === undefined
            ? { name: kit.name, type: 'sf', bank: 128, program: kit.program, rootPitch: 36 }
            : (() => { const pc = resolvePiece(kit, a.piece); return { name: pc.name, type: 'sf', bank: 128, program: kit.program, fixedKey: pc.key }; })();
          break;
        }
        case 'synth': {
          const preset = a.preset === undefined ? null : pickByName(Object.values(SYNTH_PRESETS).flat(), a.preset, 'synth preset');
          spec = { name: preset?.name ?? 'Synth', type: 'synth', preset: preset?.params ?? SYNTH_PRESETS.Leads[0].params };
          break;
        }
        case 'drum': {
          const d = DRUM_KIT.find((x) => x.voice === a.voice) ?? fail('drum needs voice: ' + DRUM_KIT.map((x) => x.voice).join(', '));
          spec = { name: d.name, type: 'drum', voice: d.voice };
          break;
        }
        case 'sampler': {
          let sampleId = a.sample;
          if (a.path) sampleId = (await importSample(app, a.path)).id;
          if (sampleId === undefined || !store.samples.has(sampleId)) fail('sampler needs sample (an id from import_sample) or path (an audio file)');
          spec = { name: store.samples.get(sampleId).name.replace(/\.[^.]+$/, ''), type: 'sampler', sampleId };
          break;
        }
        default:
          return fail(`Unknown channel type ${a.type}`);
      }
      if (a.name) spec.name = a.name;
      if (a.mixer !== undefined) spec.mixer = mixerIndex(a.mixer);
      if (a.color) spec.color = a.color;
      return edit(store, () => {
        const ch = store.addChannel(spec);
        if (a.vol !== undefined) ch.vol = a.vol;
        if (a.pan !== undefined) ch.pan = a.pan;
        if (a.params) applyParams(ch, a.params);
        touched(store, ch);
        return channelInfo(app, ch);
      });
    },
  },
  {
    name: 'update_channel',
    title: 'Update channel',
    description: 'Change a channel: name, volume, pan, mute, solo, colour, mixer routing, instrument parameters (params), and for instrument channels the sound itself (instrument/program/bank) or for drum_kit channels the kit/piece. Only the fields you pass change.',
    inputSchema: obj({
      channel: ref('Channel'),
      name: str('New name'),
      vol: num('Volume 0-1 (default 0.78)', { minimum: 0, maximum: 1 }),
      pan: num('Pan -1..1', { minimum: -1, maximum: 1 }),
      mute: bool('Mute'),
      solo: bool('Solo'),
      color: COLOR,
      mixer: int('Mixer track to route to', { minimum: 0, maximum: 125 }),
      params: PARAMS,
      instrument: str('instrument channels: new General MIDI sound name'),
      bank: int('instrument channels: bank', { minimum: 0, maximum: 127 }),
      program: int('instrument channels: program', { minimum: 0, maximum: 127 }),
      kit: { type: ['string', 'integer'], description: 'drum_kit channels: switch to this kit (name or program)' },
      piece: { type: ['string', 'integer'], description: 'drum_kit channels: switch to this piece (name or key)' },
    }, ['channel']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Update channel' },
    run(a, app) {
      const { store } = app;
      const ch = channelOf(store, a.channel);
      return edit(store, () => {
        if (a.name !== undefined) ch.name = a.name.trim() || ch.name;
        if (a.vol !== undefined) ch.vol = a.vol;
        if (a.pan !== undefined) ch.pan = a.pan;
        if (a.mute !== undefined) ch.mute = a.mute;
        if (a.solo !== undefined) ch.solo = a.solo;
        if (a.color) ch.color = a.color;
        if (a.mixer !== undefined) ch.mixer = mixerIndex(a.mixer);
        if (a.params) applyParams(ch, a.params);
        const newSound = a.instrument !== undefined || a.program !== undefined || a.bank !== undefined;
        if (newSound || a.kit !== undefined || a.piece !== undefined) {
          if (ch.type !== 'sf') fail('Only instrument and drum_kit channels have a SoundFont sound to change');
          if (a.kit !== undefined || a.piece !== undefined) {
            if (ch.bank !== 128) fail('This channel is not a drum kit');
            const kit = a.kit !== undefined ? resolveKit(app, a.kit) : catalogOf(app).kits.find((k) => k.program === ch.program) ?? fail('Unknown kit');
            ch.program = kit.program;
            if (a.piece !== undefined) { const pc = resolvePiece(kit, a.piece); ch.fixedKey = pc.key; if (a.name === undefined) ch.name = pc.name; }
          } else {
            if (ch.bank === 128) fail('This is a drum kit channel: use kit / piece');
            const p = resolveInstrument(app, { instrument: a.instrument, bank: a.bank, program: a.program ?? (a.instrument === undefined ? ch.program : undefined) });
            ch.bank = p.bank;
            ch.program = p.program;
            if (a.name === undefined) ch.name = p.name.replace(/ \(variation \d+\)$/, '');
          }
        }
        touched(store, ch);
        return channelInfo(app, ch);
      });
    },
  },
  {
    name: 'manage_channel',
    title: 'Manage channel',
    description: 'Structural channel actions: "remove" (also deletes its notes), "clone" (copies settings and notes), "move_up" / "move_down" in the rack, "select" (make it the active channel for the piano roll), "route_to_free_mixer" (give it its own mixer insert, like Ctrl+L in the rack).',
    inputSchema: obj({ channel: ref('Channel'), action: choice(['remove', 'clone', 'move_up', 'move_down', 'select', 'route_to_free_mixer'], 'What to do') }, ['channel', 'action']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Manage channel' },
    run(a, app) {
      const { store } = app;
      const ch = channelOf(store, a.channel);
      return edit(store, () => {
        switch (a.action) {
          case 'remove': store.removeChannel(ch.id); return { removed: ch.id, channels: store.project.channels.map((c) => c.id) };
          case 'clone': return channelInfo(app, store.cloneChannel(ch.id));
          case 'move_up': case 'move_down':
            store.moveChannel(ch.id, a.action === 'move_up' ? -1 : 1);
            return { channels: store.project.channels.map((c) => c.id) };
          case 'select': store.selectChannel(ch.id); return { selected: ch.id };
          case 'route_to_free_mixer': {
            const i = store.freeMixerTrack() ?? fail('Every mixer insert is already in use');
            ch.mixer = i;
            const m = store.project.mixer[i];
            if (/^Insert \d+$/.test(m.name)) m.name = ch.name;
            store.project.selected.mixer = i;
            for (const evt of ['channels', 'mixer', 'mixerSelection']) store.emit(evt);
            return { channel: ch.id, mixer: i };
          }
          default: return fail(`Unknown action ${a.action}`);
        }
      });
    },
  },
  {
    name: 'preview_note',
    title: 'Preview notes',
    description: 'Audition one or more notes on a channel through the speakers right now (like clicking a piano key). Does not change the project.',
    inputSchema: obj({
      channel: ref('Channel'),
      pitches: arr(PITCH, 'Notes to play together (a chord); default C5', { minItems: 1, maxItems: 16 }),
      velocity: num('0-1 (default 0.8)', { minimum: 0, maximum: 1 }),
      seconds: num('Length in seconds (default 0.6)', { minimum: 0.05, maximum: 10 }),
    }, ['channel']),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Preview notes' },
    run(a, app) {
      const ch = channelOf(app.store, a.channel);
      const pitches = (a.pitches ?? [60]).map(parsePitch);
      for (const p of pitches) app.engine.preview(ch, p, a.velocity ?? 0.8, a.seconds ?? 0.6);
      return { played: pitches, channel: ch.id };
    },
  },
  {
    name: 'import_sample',
    title: 'Import sample',
    description: 'Load an audio file (wav, mp3, ogg, flac, aac, m4a) into the project\'s sample library. Returns its id and length; use it with add_channel (sampler) or add_clips (audio clips).',
    inputSchema: obj({ path: str('Absolute path of the audio file') }, ['path']),
    annotations: { ...WRITE, title: 'Import sample' },
    run: (a, app) => importSample(app, a.path),
  },
];
