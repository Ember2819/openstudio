// FL Studio project (.flp) reader and importer.
//
// An FLP is a RIFF-like file: an "FLhd" header chunk (format, channel count, PPQ) and an "FLdt" chunk holding a flat
// stream of events. Event ids 0-63 carry a byte, 64-127 a word, 128-191 a dword and 192-255 a length-prefixed
// blob (text or binary). Which object an event belongs to is implied by order: a "new channel" event starts a
// channel and everything up to the next one describes it, the same for patterns, arrangements and mixer inserts.
// This reader was written from observing files saved by FL Studio 11-21; anything it does not understand is skipped.
import { STEPS_PER_BEAT, PLAYLIST_TRACKS, MIXER_TRACKS, blankProject, validTimeSig } from './state.js';
import { defaultEffectParams } from './audio/effects.js';

const EV = {
  // byte
  CH_ENABLED: 0, LOOP_ACTIVE: 9, SHOW_INFO: 10, CH_TYPE: 21, CH_ROUTE: 22, TIME_SIG_NUM: 17, TIME_SIG_BEAT: 18,
  MARKER_NUM: 33, MARKER_DEN: 34,
  // word
  CH_NEW: 64, PAT_NEW: 65, TEMPO_OLD: 66, CH_LAYER_CHILD: 94, MIX_SLOT: 98, ARR_NEW: 99,
  // dword
  CH_COLOR: 128, PAT_COLOR: 150, FINE_TEMPO: 156, MARKER_POS: 148, INS_OUTPUT: 147, INS_COLOR: 149, PAT_LENGTH: 164,
  // text / data
  PAT_NAME: 193, TITLE: 194, SAMPLE_PATH: 196, VERSION: 199, PLUGIN_INTERNAL: 201, PLUGIN_NAME: 203,
  INS_NAME: 204, MARKER_NAME: 205, LEVELS: 219, PAT_NOTES: 224, MIX_PARAMS: 225, PLAYLIST: 233, INS_ROUTING: 235,
  INS_FLAGS: 236, TRACK_DATA: 238, TRACK_NAME: 239, ARR_NAME: 241,
};

/** FL's channel types (event 21). */
const CH_KIND = { 0: 'sampler', 2: 'generator', 3: 'layer', 4: 'audio', 5: 'automation' };
const PATTERN_BASE = 20480; // playlist items above this index refer to patterns, below to channels (audio / automation clips)
const FL_TRACKS = 500;

/** Parse an .flp file into plain objects. Throws on anything that is not an FL Studio project. */
export function parseFlp(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 22 || tag(0) !== 'FLhd') throw new Error('Not an FL Studio project (.flp) file');
  const headerLen = dv.getUint32(4, true);
  const ppq = dv.getUint16(12, true) || 96;
  let o = 8 + headerLen;
  if (tag(o) !== 'FLdt') throw new Error('The FL Studio project is damaged (no data chunk)');
  const end = Math.min(b.length, o + 8 + dv.getUint32(o + 4, true));
  o += 8;

  const out = {
    version: '', ppq, bpm: null, title: '', timeSig: [4, 4],
    channels: [], patterns: new Map(), arrangements: [], inserts: [], mixerParams: null,
  };
  let utf16 = true; // FL 11.5+ writes text as UTF-16LE; the version event (always ASCII) tells us
  const text = (d) => {
    const s = utf16 && d.length >= 2 && d.length % 2 === 0 ? new TextDecoder('utf-16le').decode(d) : new TextDecoder('latin1').decode(d);
    return s.replace(/\0+$/, '').replace(/\0/g, '');
  };

  let section = 'project';
  let channel = null;
  let pattern = null;
  let arrangement = null;
  let insert = null;
  let slotPlugin = null; // pending mixer plugin, finished by its slot-index event
  const patternOf = (i) => {
    if (!out.patterns.has(i)) out.patterns.set(i, { index: i, name: '', color: null, notes: [], length: 0 });
    return out.patterns.get(i);
  };
  const newInsert = () => { insert = { index: out.inserts.length, name: '', color: null, flags: null, routes: [], fx: [] }; };
  const ensureArrangement = () => {
    if (!arrangement) { arrangement = { name: 'Arrangement', items: [], tracks: [] }; out.arrangements.push(arrangement); }
    return arrangement;
  };

  while (o < end) {
    const id = b[o++];
    let v = 0;
    let data = null;
    if (id < 64) { v = b[o]; o += 1; }
    else if (id < 128) { v = dv.getUint16(o, true); o += 2; }
    else if (id < 192) { v = dv.getUint32(o, true); o += 4; }
    else {
      let size = 0;
      for (let shift = 0; o < end; shift += 7) {
        const c = b[o++];
        size += (c & 0x7f) * 2 ** shift;
        if (!(c & 0x80)) break;
      }
      data = b.subarray(o, Math.min(end, o + size));
      o += size;
    }

    switch (id) {
      case EV.VERSION: {
        out.version = new TextDecoder('latin1').decode(data).replace(/\0/g, '');
        const [maj, min] = out.version.split('.').map(Number);
        utf16 = maj > 11 || (maj === 11 && min >= 5);
        break;
      }
      case EV.FINE_TEMPO: out.bpm = v / 1000; break;
      case EV.TEMPO_OLD: if (out.bpm == null) out.bpm = v; break;
      case EV.TITLE: out.title = text(data); break;
      case EV.TIME_SIG_NUM: if (section === 'project' && v) out.timeSig[0] = v; break;
      case EV.TIME_SIG_BEAT: if (section === 'project' && v) out.timeSig[1] = v; break;

      // ------------------------------------------------------------- patterns
      case EV.PAT_NEW: section = 'pattern'; pattern = patternOf(v); break;
      case EV.PAT_NAME: if (pattern) pattern.name = text(data); break;
      case EV.PAT_COLOR: if (pattern) pattern.color = bgr(v); break;
      case EV.PAT_LENGTH: if (pattern) pattern.length = v; break;
      case EV.PAT_NOTES: if (pattern) pattern.notes.push(...readNotes(data)); break;

      // ------------------------------------------------------------- channels
      case EV.CH_NEW:
        section = 'channel';
        channel = { index: v, kind: 'generator', name: '', plugin: '', color: null, vol: null, pan: null, pitch: 0, insert: 0, sample: '', layer: [], enabled: true };
        out.channels.push(channel);
        break;
      case EV.CH_TYPE: if (channel && section === 'channel') channel.kind = CH_KIND[v] ?? 'generator'; break;
      case EV.CH_ROUTE: if (channel && section === 'channel') channel.insert = v > 127 ? v - 256 : v; break;
      case EV.CH_ENABLED: if (channel && section === 'channel') channel.enabled = v !== 0; break;
      case EV.CH_LAYER_CHILD: if (channel && section === 'channel') channel.layer.push(v); break;
      case EV.SAMPLE_PATH: if (channel && section === 'channel') channel.sample = text(data); break;
      case EV.LEVELS:
        if (channel && section === 'channel' && data.length >= 12) {
          const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
          channel.pan = d.getUint32(0, true);
          channel.vol = d.getUint32(4, true);
          channel.pitch = d.getInt32(8, true);
        }
        break;
      case EV.CH_COLOR: if (channel && section === 'channel') channel.color = bgr(v); break;
      case EV.PLUGIN_INTERNAL:
        if (section === 'mixer') slotPlugin = { plugin: text(data), name: '' };
        else if (channel && section === 'channel') channel.plugin = text(data);
        break;
      case EV.PLUGIN_NAME:
        if (section === 'mixer') { if (slotPlugin) slotPlugin.name = text(data); }
        else if (channel && section === 'channel') channel.name = text(data);
        break;

      // --------------------------------------------------------- arrangements
      case EV.ARR_NEW:
        section = 'arrangement';
        arrangement = { name: `Arrangement ${v + 1}`, items: [], tracks: [] };
        out.arrangements.push(arrangement);
        break;
      case EV.ARR_NAME: if (arrangement) arrangement.name = text(data); break;
      case EV.PLAYLIST: ensureArrangement().items.push(...readPlaylist(data, out.version)); break;
      case EV.TRACK_DATA:
        if (data.length >= 8) {
          const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
          ensureArrangement().tracks.push({ index: d.getUint32(0, true) - 1, color: bgr(d.getUint32(4, true)), name: '', enabled: data.length > 12 ? data[12] !== 0 : true });
        }
        break;
      case EV.TRACK_NAME: { const t = ensureArrangement().tracks.at(-1); if (t) t.name = text(data); break; }

      // ---------------------------------------------------------------- mixer
      case EV.MIX_PARAMS: out.mixerParams = data; break;
      case EV.INS_COLOR: section = 'mixer'; if (!insert) newInsert(); insert.color = bgr(v); break;
      case EV.INS_NAME: section = 'mixer'; if (!insert) newInsert(); insert.name = text(data); break;
      case EV.INS_FLAGS:
        section = 'mixer';
        if (!insert) newInsert();
        if (data.length >= 8) insert.flags = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true);
        break;
      case EV.MIX_SLOT:
        if (section === 'mixer' && insert && slotPlugin) { insert.fx.push({ slot: v & 0x3f, ...slotPlugin }); }
        slotPlugin = null;
        break;
      case EV.INS_ROUTING:
        if (!insert) newInsert();
        insert.routes = [...data].map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
        break;
      case EV.INS_OUTPUT:
        if (!insert) newInsert();
        out.inserts.push(insert);
        insert = null;
        break;
      default: break;
    }
  }
  if (out.bpm == null || !Number.isFinite(out.bpm) || out.bpm <= 0) out.bpm = 140;
  applyMixerParams(out);
  out.patterns = [...out.patterns.values()].sort((a, b2) => a.index - b2.index);
  return out;
}

/** FL stores colours as 0x00BBGGRR. */
function bgr(v) {
  const r = v & 0xff;
  const g = (v >> 8) & 0xff;
  const bl = (v >> 16) & 0xff;
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Pattern notes: 24 bytes each. */
function readNotes(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const notes = [];
  for (let i = 0; i + 24 <= d.length; i += 24) {
    notes.push({
      pos: dv.getUint32(i, true),
      flags: dv.getUint16(i + 4, true),
      channel: dv.getUint16(i + 6, true),
      len: dv.getUint32(i + 8, true),
      key: dv.getUint16(i + 12, true),
      fine: d[i + 16], // 0..240, 120 = no detune, in cents
      release: d[i + 18],
      pan: d[i + 20], // 0..128, 64 = centre
      vel: d[i + 21], // 0..128, 100 = FL default
    });
  }
  return notes;
}

/** Playlist items: 32 bytes up to FL 20, 60 bytes from FL 21. */
function readPlaylist(d, version) {
  const major = parseInt(version, 10) || 0;
  const size = d.length % 60 === 0 && (d.length % 32 !== 0 || major >= 21) ? 60 : 32;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const items = [];
  for (let i = 0; i + size <= d.length; i += size) {
    const base = dv.getUint16(i + 4, true);
    const index = dv.getUint16(i + 6, true);
    const flags = dv.getUint16(i + 18, true);
    const item = {
      pos: dv.getUint32(i, true),
      len: dv.getUint32(i + 8, true),
      track: FL_TRACKS - 1 - dv.getUint16(i + 12, true),
      muted: (flags & 0x2000) !== 0,
    };
    if (index > base && base === PATTERN_BASE) {
      item.pattern = index - base;
      const s = dv.getInt32(i + 24, true);
      const e = dv.getInt32(i + 28, true);
      item.startOffset = s >= 0 ? s : 0;
      item.endOffset = e >= 0 ? e : null;
    } else {
      item.channel = index;
      const s = dv.getFloat32(i + 24, true);
      item.startOffset = Number.isFinite(s) && s > 0 ? s : 0; // audio clips: fraction of the sample? keep raw
    }
    items.push(item);
  }
  return items;
}

/** The mixer's parameter blob: 12-byte records of (param id, insert/slot, value). */
function applyMixerParams(out) {
  const d = out.mixerParams;
  if (!d) return;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  for (let i = 0; i + 12 <= d.length; i += 12) {
    const pid = d[i + 4];
    const where = dv.getUint16(i + 6, true);
    const value = dv.getInt32(i + 8, true);
    const ins = out.inserts[(where >> 6) & 0x7f];
    if (!ins) continue;
    if (pid === 192) ins.vol = value;
    else if (pid === 193) ins.pan = value;
    else if (pid >= 64 && pid < 64 + 127) (ins.sendLevels ||= {})[pid - 64] = value;
  }
  delete out.mixerParams;
}

// ------------------------------------------------------------------------------------------------- importing

/** FL plugin (or channel name) → an OpenStudio instrument. Order matters: the first match wins. */
const DRUM_WORDS = [
  [/open.?h(i|at)|\bohh?\b|\boh\b/i, 'openhat'], [/pedal/i, 'hatpedal'], [/h(i|igh)[\s-]?hat|\bhh\b|\bhat\b|\bhats\b|\bchh?\b/i, 'hat'],
  [/808.*kick|kick.*808/i, 'kick808'], [/\bkick|\bkik|\bbd\b|bass ?drum/i, 'kick'],
  [/808.*snare|snare.*808/i, 'snare808'], [/\bsnare|\bsnr\b|\bsd\b/i, 'snare'], [/\bclap|\bclp\b/i, 'clap'], [/\bsnap/i, 'snap'],
  [/rim ?shot/i, 'rimshot'], [/\brim\b/i, 'rim'], [/\btom/i, 'tom'], [/conga/i, 'conga'], [/bongo/i, 'bongo'], [/cowbell/i, 'cowbell'],
  [/wood ?block/i, 'woodblock'], [/crash|cymbal/i, 'crash'], [/ride ?bell/i, 'ridebell'], [/\bride\b/i, 'ride'], [/shaker|shkr/i, 'shaker'],
  [/cabasa/i, 'cabasa'], [/tamb/i, 'tambourine'], [/triangle/i, 'triangle'], [/clave/i, 'clave'], [/\bperc/i, 'conga'],
];
const GM_WORDS = [
  [/grand|piano|fl keys|\bkeys\b/i, 0], [/rhodes|e\.? ?piano|electric piano|wurli/i, 4], [/harpsi/i, 6], [/clav/i, 7],
  [/celest/i, 8], [/glock/i, 9], [/music ?box/i, 10], [/vibra/i, 11], [/marimba/i, 12], [/xylo/i, 13], [/\bbell/i, 14],
  [/organ/i, 16], [/accordion/i, 21], [/harmonica/i, 22], [/nylon|acoustic gtr|acoustic guitar/i, 24], [/guitar|gtr/i, 27],
  [/dist(ortion)?.*(gtr|guitar)/i, 30], [/slap/i, 36], [/fretless/i, 35], [/acoustic bass|upright|contrabass/i, 32],
  [/808|sub ?bass|\bsub\b|reese|synth ?bass/i, 38], [/\bbass/i, 33], [/violin/i, 40], [/viola/i, 41], [/cello/i, 42],
  [/pizz/i, 45], [/harp/i, 46], [/timpani/i, 47], [/string/i, 48], [/choir|vox|vocal|aah|ooh/i, 52], [/orch.*hit|\bhit\b/i, 55],
  [/trumpet/i, 56], [/trombone/i, 57], [/tuba/i, 58], [/french horn|\bhorn/i, 60], [/brass/i, 61], [/sax/i, 65], [/oboe/i, 68],
  [/bassoon/i, 70], [/clarinet/i, 71], [/piccolo/i, 72], [/flute/i, 73], [/pan ?flute/i, 75], [/whistle/i, 78], [/ocarina/i, 79],
  [/sitar/i, 104], [/banjo/i, 105], [/koto/i, 107], [/kalimba/i, 108], [/steel ?drum/i, 114],
  [/\bpad\b|atmos|ambient|warm/i, 89], [/sweep/i, 95], [/\bsaw|supersaw|lead/i, 81], [/square/i, 80], [/\bpluck/i, 'pluck'],
  [/\barp\b|\bseq\b/i, 81], [/\bfx\b|riser|impact|noise/i, 'sfx'],
];
const PLUGIN_ENGINE = {
  '3x osc': { type: 'synth' }, sytrus: { type: 'fm' }, 'fruity dx10': { type: 'fm' }, 'plucked!': { type: 'pluck' },
  'fruit kick': { type: 'drum', voice: 'kick' }, 'fruity kick': { type: 'drum', voice: 'kick' }, 'boobass': { type: 'sf', program: 33 },
  'fl keys': { type: 'sf', program: 0 }, 'fruity granulizer': null, 'transistor bass': { type: 'synth' }, simsynth: { type: 'synth' },
  'fruity organ': { type: 'organ' }, 'drumaxx': { type: 'drum', voice: 'kick' }, 'fpc': { type: 'kit' }, 'fruity drumsynth live': { type: 'drum', voice: 'kick' },
};
const FX_MAP = [
  [/reeverb|reverb|verb/i, 'reverb'], [/delay|echo/i, 'delay'], [/chorus/i, 'chorus'], [/phaser/i, 'phaser'], [/flanger|flangus/i, 'flanger'],
  [/limiter|maximus|soft clipper|clipper/i, 'limiter'], [/compressor|multiband|ott|compress/i, 'compressor'],
  [/dist|overdrive|waveshaper|squeeze|blood/i, 'distortion'], [/bitcrush|lofi|lo-fi|crush/i, 'bitcrusher'],
  [/eq|equali/i, 'eq'], [/filter|philter/i, 'filter'], [/stereo|enhancer|shaper/i, 'stereo'], [/tremolo|vibrato/i, 'tremolo'],
];

const firstMatch = (list, s) => list.find(([re]) => re.test(s))?.[1];

/** Decide which OpenStudio channel stands in for an FL channel. */
export function mapChannel(ch) {
  const name = ch.name || ch.plugin || '';
  const plugin = (ch.plugin || '').toLowerCase();
  const drum = firstMatch(DRUM_WORDS, name) ?? (ch.sample ? firstMatch(DRUM_WORDS, ch.sample.split(/[\\/]/).pop()) : undefined);
  if (ch.kind === 'sampler' || ch.kind === 'audio' || plugin === 'fruity slicer' || plugin === 'slicex' || plugin === 'directwave') {
    if (ch.sample) return { type: 'sampler', drum };
    if (drum) return { type: 'drum', voice: drum };
    if (ch.kind !== 'generator') return { type: 'sampler', empty: true }; // an FL sampler with nothing loaded is silent
  }
  const known = PLUGIN_ENGINE[plugin];
  if (known?.type === 'kit') return { type: 'sf', bank: 128, program: 0, kit: true };
  if (known?.type === 'drum' && drum) return { type: 'drum', voice: drum };
  if (drum && !/bass|pad|lead|key|piano|string/i.test(name)) return { type: 'drum', voice: drum };
  if (known) return { ...known };
  const gm = firstMatch(GM_WORDS, name);
  if (gm === 'pluck') return { type: 'pluck' };
  if (gm === 'sfx') return { type: 'sfx' };
  if (gm != null) return { type: 'sf', program: gm };
  return { type: 'synth' };
}

/** A mixer plugin name → an OpenStudio effect type, or null. */
export const mapEffect = (plugin, name = '') => firstMatch(FX_MAP, plugin) ?? firstMatch(FX_MAP, name) ?? null;

/** Every sample file the project refers to (for the caller to load before importing). */
export const flpSamplePaths = (flp) => [...new Set(flp.channels.map((c) => c.sample).filter(Boolean))];

/**
 * Replace the store's project with an imported FL Studio project (call store.finishLoad() afterwards).
 * `samples`: Map(path as written in the .flp -> { name, data: ArrayBuffer }) of the sample files that could be found.
 * Returns a report { channels, patterns, clips, missingSamples[], substituted[], skipped[] }.
 */
export function importFlp(store, flp, { name = '', samples = new Map() } = {}) {
  const report = { channels: 0, patterns: 0, clips: 0, missingSamples: [], substituted: [], skipped: [] };
  store.project = blankProject();
  store.samples.clear();
  const proj = store.project;
  proj.name = flp.title || name || 'FL Studio project';
  proj.bpm = Math.min(522, Math.max(10, Math.round(flp.bpm * 1000) / 1000));
  if (validTimeSig(flp.timeSig)) proj.timeSig = [flp.timeSig[0], flp.timeSig[1]];
  const toSteps = (ticks) => (ticks / flp.ppq) * STEPS_PER_BEAT;
  const round = (x) => Math.round(x * 1000) / 1000;

  // ---------------------------------------------------------------- mixer
  const insertCount = Math.min(flp.inserts.length, MIXER_TRACKS);
  for (let i = 0; i < insertCount; i++) {
    const src = flp.inserts[i];
    const m = proj.mixer[i];
    if (src.name) m.name = src.name;
    if (src.color && i > 0 && src.color !== '#485156') m.color = src.color;
    if (Number.isFinite(src.vol)) m.vol = clamp01(src.vol / 16000, 1);
    if (Number.isFinite(src.pan)) m.pan = Math.max(-1, Math.min(1, src.pan / 6400));
    if (src.flags != null && i > 0) m.mute = (src.flags & 0x08) === 0;
    let slot = 0;
    for (const fx of src.fx) {
      const type = mapEffect(fx.plugin, fx.name);
      if (!type) { if (!/notebook|send|balance|fruity big clock/i.test(fx.plugin)) report.skipped.push(`${fx.name || fx.plugin} (insert ${i})`); continue; }
      if (slot >= m.fx.length) break;
      m.fx[slot++] = { type, params: defaultEffectParams(type), on: true };
    }
    if (i > 0) {
      // a route with its send level at zero is just FL's default template wiring (old "Send 1-4" tracks)
      const level = (r) => src.sendLevels?.[r] ?? 12800;
      const routes = src.routes.filter((r) => r > 0 && r < MIXER_TRACKS && r !== i && level(r) > 0);
      for (const r of routes) if (!store.wouldCycle(i, r)) m.sends[r] = clamp01(level(r) / 16000, 1);
      // FL routes an insert to the master only when asked to: an insert that goes elsewhere (or nowhere) is off the master
      if (!src.routes.includes(0) && (routes.length || src.flags != null)) m.master = false;
    }
  }

  // ------------------------------------------------------------- channels
  const byIndex = new Map(); // FL channel index -> OpenStudio channel (null for skipped ones)
  const sampleIds = new Map();
  for (const ch of flp.channels) {
    if (ch.kind === 'automation' || ch.kind === 'layer') continue;
    const spec = mapChannel(ch);
    const label = ch.name || ch.plugin || (ch.sample ? ch.sample.split(/[\\/]/).pop().replace(/\.\w+$/, '') : `Channel ${ch.index + 1}`);
    const opts = { name: label, type: spec.type, color: ch.color && ch.color !== '#5c656a' ? ch.color : null };
    if (ch.insert > 0 && ch.insert < MIXER_TRACKS) opts.mixer = ch.insert;
    if (spec.type === 'sampler') {
      const file = samples.get(ch.sample);
      if (file) {
        let id = sampleIds.get(ch.sample);
        if (id == null) { id = store.addSample(file.name, file.data); sampleIds.set(ch.sample, id); }
        opts.sampleId = id;
      } else if (spec.empty) {
        // keep it: an empty sampler, as in FL
      } else {
        report.missingSamples.push(ch.sample);
        if (spec.drum) { opts.type = 'drum'; opts.voice = spec.drum; } else { opts.type = 'sf'; opts.program = 0; }
        report.substituted.push(`${label}: sample not found, using ${opts.type === 'drum' ? `the ${spec.drum} drum voice` : 'a piano'}`);
      }
    } else if (spec.type === 'drum') {
      opts.voice = spec.voice;
    } else if (spec.type === 'sf') {
      opts.bank = spec.bank ?? 0;
      opts.program = spec.program ?? 0;
    }
    if (ch.kind === 'generator' && !PLUGIN_ENGINE[(ch.plugin || '').toLowerCase()] && ch.plugin) {
      report.substituted.push(`${label} (${ch.plugin === 'Fruity Wrapper' ? 'VST plugin' : ch.plugin}) → ${describeSpec(opts)}`);
    }
    const made = store._addChannel(opts);
    if (ch.vol != null) made.vol = clamp01(ch.vol / 12800, 1);
    if (ch.pan != null) made.pan = Math.max(-1, Math.min(1, (ch.pan - 6400) / 6400));
    if (ch.kind === 'audio') made.audioClip = true;
    if (!ch.enabled) made.mute = true;
    byIndex.set(ch.index, made);
    report.channels++;
  }
  // a layer channel plays its children
  const targets = (idx, depth = 0) => {
    const c = flp.channels.find((x) => x.index === idx);
    if (!c) return [];
    if (c.kind === 'layer' && depth < 4) return c.layer.flatMap((k) => targets(k, depth + 1));
    return byIndex.get(idx) ? [byIndex.get(idx)] : [];
  };

  // ------------------------------------------------------------- patterns
  const patById = new Map();
  for (const fp of flp.patterns) {
    if (!fp.notes.length && !fp.name) continue;
    const pat = store._addPattern(fp.name || `Pattern ${fp.index}`);
    if (fp.color && fp.color !== '#485156') pat.color = fp.color;
    let endStep = 0;
    for (const n of fp.notes) {
      for (const ch of targets(n.channel)) {
        const s = round(toSteps(n.pos));
        const l = n.len > 0 ? round(toSteps(n.len)) : 1;
        const note = { p: Math.max(0, Math.min(131, n.key)), s, l: Math.max(0.0625, l), v: Math.max(0.02, Math.min(1, n.vel / 128)) };
        if (n.pan != null && n.pan !== 64) note.pan = round((n.pan - 64) / 64);
        if (n.fine != null && n.fine !== 120) note.fine = n.fine - 120; // cents
        store.notesOf(pat, ch.id).push(note);
        endStep = Math.max(endStep, s + note.l);
      }
    }
    const lenSteps = fp.length ? toSteps(fp.length) : 0;
    pat.bars = Math.max(1, Math.ceil(Math.max(endStep, lenSteps) / store.barSteps - 1e-6));
    patById.set(fp.index, pat);
    report.patterns++;
  }
  if (!proj.patterns.length) store._addPattern();

  // ------------------------------------------------------------- playlist
  const arr = flp.arrangements.find((a) => a.items.length) ?? flp.arrangements[0];
  const standIns = new Map(); // channel id -> pattern standing in for its (missing) audio clips
  if (arr) {
    for (const t of arr.tracks) {
      if (t.index < 0 || t.index >= PLAYLIST_TRACKS) continue;
      const track = proj.playlist.tracks[t.index];
      if (t.name) track.name = t.name;
      if (t.color && t.color !== '#485156') track.color = t.color;
      if (!t.enabled) track.mute = true;
    }
    for (const it of arr.items) {
      const track = Math.max(0, Math.min(PLAYLIST_TRACKS - 1, it.track));
      const start = round(toSteps(it.pos));
      const len = round(toSteps(it.len));
      if (!(len > 0)) continue;
      if (it.pattern != null) {
        const pat = patById.get(it.pattern);
        if (!pat) continue;
        store.addClip({ type: 'pattern', pat: pat.id, track, start, len, offset: round(toSteps(it.startOffset || 0)), mute: it.muted });
        report.clips++;
      } else {
        const ch = byIndex.get(it.channel);
        if (ch?.type === 'sampler' && ch.sampleId != null) {
          store.addClip({ type: 'audio', sampleId: ch.sampleId, track, start, len, offset: 0, mute: it.muted });
          // FL sends an audio clip through its channel's insert; here the playlist track carries the routing
          if (ch.mixer > 0 && !proj.playlist.tracks[track].mixer) proj.playlist.tracks[track].mixer = ch.mixer;
          report.clips++;
        } else if (ch && ch.type !== 'sampler') {
          // the audio file is missing: its stand-in instrument plays one note where the clip was
          let pat = standIns.get(ch.id);
          if (!pat) {
            pat = store._addPattern(`${ch.name} (audio clip)`);
            pat.color = ch.color;
            store.notesOf(pat, ch.id).push({ p: ch.rootPitch, s: 0, l: 1, v: 0.78 });
            standIns.set(ch.id, pat);
            ch.audioClip = false; // it plays now, so it stays in the rack
          }
          store.addClip({ type: 'pattern', pat: pat.id, track, start, len, offset: 0, mute: it.muted });
          report.clips++;
        }
      }
    }
    // FL plays the playlist by default when it has content
    if (proj.playlist.clips.length) proj.mode = 'song';
  }
  // channels that only exist to hold an audio clip don't belong in the rack
  const clipOnly = proj.channels.filter((c) => c.audioClip);
  for (const c of clipOnly) {
    if (!proj.patterns.some((p) => p.notes[c.id]?.length)) proj.channels.splice(proj.channels.indexOf(c), 1);
    delete c.audioClip;
  }
  if (!proj.channels.length) store._addChannel({ name: 'Kick', type: 'drum', voice: 'kick' });
  proj.selected = { channel: proj.channels[0].id, pattern: proj.patterns[0].id, mixer: 0 };
  return report;
}

const clamp01 = (v, hi = 1) => Math.max(0, Math.min(hi, v));
function describeSpec(o) {
  if (o.type === 'sf') return o.bank === 128 ? 'a drum kit' : `General MIDI program ${o.program + 1}`;
  if (o.type === 'drum') return `the ${o.voice} drum voice`;
  return `the built-in ${o.type}`;
}
