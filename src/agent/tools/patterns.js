import { COLOR, PITCH, arr, bool, choice, int, num, obj, ref, str } from '../schema.js';
import { channelOf, clamp01, edit, fail, noteIn, noteOut, parsePitch, patternOf, round, MAX_PITCH } from '../helpers.js';
import { patternInfo } from '../describe.js';
import { arpeggiate, strum, chop, flam, snapToScale, velocityRamp, articulate, limitRange } from '../../notetools.js';
import { SCALES } from '../music/theory.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const NOTE = obj({
  pitch: PITCH,
  start: num('Start in steps from the pattern start (16 steps = 1 bar, 4 = 1 beat)', { minimum: 0 }),
  length: num('Length in steps (1 = a 16th note)', { minimum: 0.0625 }),
  velocity: num('0-1 (default 0.78)', { minimum: 0, maximum: 1 }),
  muted: bool('Note is muted'),
  pan: num('Per-note pan -1 (left) .. 1 (right), default 0', { minimum: -1, maximum: 1 }),
  fine: num('Per-note fine pitch in cents, -120..120, default 0', { minimum: -120, maximum: 120 }),
  modX: num('Per-note Mod X -1..1 (moves the filter cutoff up to 4 octaves), default 0', { minimum: -1, maximum: 1 }),
  modY: num('Per-note Mod Y -1..1 (filter resonance), default 0', { minimum: -1, maximum: 1 }),
  slide: bool('Slide note: instead of playing, it glides the notes already sounding on the channel to its pitch over its length'),
}, ['pitch', 'start', 'length']);

const FILTER = obj({
  from: num('Only notes starting at or after this step'),
  to: num('Only notes starting before this step'),
  pitchMin: PITCH,
  pitchMax: PITCH,
}, [], 'Which notes to touch (default: all notes of the channel in that pattern)');

const matcher = (f) => {
  if (!f) return () => true;
  const lo = f.pitchMin === undefined ? 0 : parsePitch(f.pitchMin);
  const hi = f.pitchMax === undefined ? MAX_PITCH : parsePitch(f.pitchMax);
  return (n) => n.p >= lo && n.p <= hi && (f.from === undefined || n.s >= f.from - 1e-6) && (f.to === undefined || n.s < f.to - 1e-6);
};

/** Resolve the (channel, notes) pairs of a set_notes / add_notes call. */
function parts(store, a, what) {
  if (a.parts && (a.channel !== undefined || a.notes)) fail(`${what}: use either channel + notes, or parts`);
  const list = a.parts ?? [{ channel: a.channel, notes: a.notes }];
  return list.map((part, i) => {
    if (part.channel === undefined || !part.notes) fail(`${what}: ${a.parts ? `parts[${i}]` : 'the call'} needs channel and notes`);
    return { ch: channelOf(store, part.channel), notes: part.notes.map(noteIn) };
  });
}

const emitNotes = (store, pat) => { store.normalizePattern(pat); store.emit('notes'); store.emit('patterns'); };

const PARTS = arr(obj({ channel: ref('Channel'), notes: arr(NOTE, 'Notes') }, ['channel', 'notes']), 'Notes for several channels at once (instead of channel + notes)');

/** The piano-roll tools that replace notes (src/notetools.js). */
function replaceOp(a, sel) {
  switch (a.op) {
    case 'arpeggiate': return arpeggiate(sel, { ...a.arp, seed: 1 });
    case 'strum': return strum(sel, a.strum ?? {});
    case 'chop': return chop(sel, a.grid ?? 1);
    case 'flam': return flam(sel, { offset: a.steps ?? 0.25 });
    case 'snap_to_scale': {
      if (!a.scale) fail('snap_to_scale needs scale { root, name }');
      const intervals = SCALES[a.scale.name] ?? fail(`Unknown scale "${a.scale.name}" — one of ${Object.keys(SCALES).join(', ')}`);
      const root = typeof a.scale.root === 'string' && /^[A-Ga-g][#b♯♭]?$/.test(a.scale.root.trim()) ? `${a.scale.root.trim()}5` : a.scale.root;
      return snapToScale(sel, parsePitch(root) % 12, intervals);
    }
    case 'articulate': return articulate(sel, a.ratio ?? 0.5);
    case 'limit': {
      if (!a.range) fail('limit needs range { pitchMin, pitchMax }');
      const lo = parsePitch(a.range.pitchMin);
      const hi = parsePitch(a.range.pitchMax);
      if (hi - lo < 11) fail('limit: the range must span at least an octave');
      return limitRange(sel, lo, hi);
    }
    case 'velocity_ramp': {
      const v = a.velocity ?? {};
      return velocityRamp(sel, v.from ?? 0.2, v.to ?? 1);
    }
    default: return sel;
  }
}

export const tools = [
  {
    name: 'get_pattern',
    title: 'Get pattern',
    description: 'Read a pattern\'s notes, per channel, sorted by start time. Defaults to the selected pattern; pass channel to read just one channel.',
    inputSchema: obj({ pattern: ref('Pattern'), channel: ref('Channel') }),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Get pattern' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      const only = a.channel === undefined ? null : channelOf(store, a.channel);
      const channels = store.project.channels
        .filter((c) => (only ? c.id === only.id : (pat.notes[c.id] || []).length))
        .map((c) => ({ channel: c.id, name: c.name, notes: [...(pat.notes[c.id] || [])].sort((x, y) => x.s - y.s || x.p - y.p).map(noteOut) }));
      return { ...patternInfo(store, pat), channels };
    },
  },
  {
    name: 'add_pattern',
    title: 'Add pattern',
    description: 'Create an empty pattern and select it. 1 bar = 16 steps; patterns grow automatically when notes run past the end.',
    inputSchema: obj({ name: str('Pattern name (default "Pattern N")'), bars: int('Length in bars (default 1)', { minimum: 1, maximum: 256 }), color: COLOR }),
    annotations: { ...WRITE, title: 'Add pattern' },
    run(a, app) {
      const { store } = app;
      return edit(store, () => {
        const pat = store.addPattern(a.name?.trim() || undefined);
        if (a.bars) pat.bars = a.bars;
        if (a.color) pat.color = a.color;
        store.emit('patterns');
        return patternInfo(store, pat);
      });
    },
  },
  {
    name: 'update_pattern',
    title: 'Update pattern',
    description: 'Rename, recolour or resize a pattern. Only the fields you pass change. A pattern never becomes shorter than its last note.',
    inputSchema: obj({ pattern: ref('Pattern'), name: str('New name'), color: COLOR, bars: int('Length in bars', { minimum: 1, maximum: 256 }) }, ['pattern']),
    annotations: { ...WRITE, idempotentHint: true, title: 'Update pattern' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      return edit(store, () => {
        if (a.name !== undefined) pat.name = a.name.trim() || pat.name;
        if (a.color) pat.color = a.color;
        if (a.bars) { pat.bars = a.bars; store.normalizePattern(pat); }
        store.emit('notes');
        store.emit('patterns');
        store.emit('selection');
        return patternInfo(store, pat);
      });
    },
  },
  {
    name: 'pattern_action',
    title: 'Pattern action',
    description: 'Pattern housekeeping: "select" (make it the current pattern), "clone", "remove" (also removes its playlist clips; the last pattern cannot be removed), "clear" (delete all its notes).',
    inputSchema: obj({ pattern: ref('Pattern'), action: choice(['select', 'clone', 'remove', 'clear'], 'What to do') }, ['pattern', 'action']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Pattern action' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      return edit(store, () => {
        switch (a.action) {
          case 'select': store.selectPattern(pat.id); return { selected: pat.id };
          case 'clone': return patternInfo(store, store.clonePattern(pat.id));
          case 'remove':
            if (!store.removePattern(pat.id)) fail('A project needs at least one pattern');
            return { removed: pat.id, patterns: store.project.patterns.map((p) => p.id) };
          case 'clear': pat.notes = {}; store.emit('notes'); return patternInfo(store, pat);
          default: return fail(`Unknown action ${a.action}`);
        }
      });
    },
  },
  {
    name: 'set_notes',
    title: 'Set notes',
    description: 'REPLACE all notes of a channel in a pattern with the given list (an empty list clears the channel). Best for writing a part from scratch or rewriting one after get_pattern. Positions are in steps: 1 step = 16th note, 4 = beat, 16 = bar. Pitch is a number or a name like "C5" (MIDI 60 = C5). For drum kits the pitch is the kit key (see list_catalog drum_kits); for single-piece drum channels any pitch triggers the piece (use 60). Pass `parts` to write several channels in one call. Defaults to the selected pattern.',
    inputSchema: obj({ pattern: ref('Pattern'), channel: ref('Channel'), notes: arr(NOTE, 'The complete note list'), parts: PARTS }),
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true, title: 'Set notes' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      const work = parts(store, a, 'set_notes');
      edit(store, () => { for (const { ch, notes } of work) pat.notes[ch.id] = notes; emitNotes(store, pat); });
      return { pattern: pat.id, bars: pat.bars, written: work.map(({ ch, notes }) => ({ channel: ch.id, notes: notes.length })) };
    },
  },
  {
    name: 'add_notes',
    title: 'Add notes',
    description: 'ADD notes to a channel in a pattern, keeping the existing ones. Same note format as set_notes. Defaults to the selected pattern. Pass `parts` for several channels at once.',
    inputSchema: obj({ pattern: ref('Pattern'), channel: ref('Channel'), notes: arr(NOTE, 'Notes to add'), parts: PARTS }),
    annotations: { ...WRITE, title: 'Add notes' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      const work = parts(store, a, 'add_notes');
      edit(store, () => { for (const { ch, notes } of work) for (const n of notes) store.notesOf(pat, ch.id).push(n); emitNotes(store, pat); });
      return { pattern: pat.id, bars: pat.bars, added: work.map(({ ch, notes }) => ({ channel: ch.id, notes: notes.length })) };
    },
  },
  {
    name: 'set_steps',
    title: 'Set step grid',
    description: 'Step-sequencer style input: replace a channel\'s notes in a pattern with a grid string, one character per 16th-note step. "x" = hit, "X" = accent, "o" = ghost note, "." or "-" = rest; spaces and "|" are ignored, so "x...|x...|x...|x..." is one bar. Hits use `pitch` (default C5 / the channel\'s root note) and last one step. The pattern grows to fit the grid.',
    inputSchema: obj({ pattern: ref('Pattern'), channel: ref('Channel'), grid: str('e.g. "x...x...x...x..." (16 steps per bar)'), pitch: PITCH }, ['channel', 'grid']),
    annotations: { ...WRITE, destructiveHint: true, idempotentHint: true, title: 'Set step grid' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      const ch = channelOf(store, a.channel);
      const cells = [...a.grid].filter((c) => !/[\s|]/.test(c));
      const bad = cells.find((c) => !'xXo.-'.includes(c));
      if (bad) fail(`Grid character "${bad}" is not allowed — use x X o . -`);
      const pitch = a.pitch === undefined ? (ch.rootPitch ?? 60) : parsePitch(a.pitch);
      const vel = { x: 0.78, X: 0.98, o: 0.4 };
      edit(store, () => {
        pat.notes[ch.id] = cells.flatMap((c, s) => (vel[c] ? [{ p: pitch, s, l: 1, v: vel[c] }] : []));
        emitNotes(store, pat);
      });
      return { pattern: pat.id, channel: ch.id, steps: cells.length, hits: pat.notes[ch.id].length, bars: pat.bars };
    },
  },
  {
    name: 'remove_notes',
    title: 'Remove notes',
    description: 'Delete notes of a channel in a pattern: those matching `filter` (start range / pitch range), or every note when all is true.',
    inputSchema: obj({ pattern: ref('Pattern'), channel: ref('Channel'), filter: FILTER, all: bool('Delete every note of the channel (required when no filter is given)') }, ['channel']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Remove notes' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      const ch = channelOf(store, a.channel);
      if (!a.filter && !a.all) fail('Pass a filter, or all: true to delete every note of the channel');
      const hit = matcher(a.filter);
      const list = pat.notes[ch.id] || [];
      const removed = list.filter(hit).length;
      edit(store, () => { pat.notes[ch.id] = list.filter((n) => !hit(n)); emitNotes(store, pat); });
      return { removed, remaining: list.length - removed };
    },
  },
  {
    name: 'transform_notes',
    title: 'Transform notes',
    description: 'Piano-roll style bulk edit of a channel\'s notes (optionally only those matching `filter`). op: "transpose" (semitones), "shift" (steps, may be negative), "quantize" (snap starts and lengths to `grid` steps; startsOnly keeps lengths), "legato" (each note lasts until the next start), "velocity" (set / scale / add), "humanize" (random timing and velocity jitter), "duplicate" (copy the notes right after themselves, or `steps` later), "reverse" (mirror in time), "mute" / "unmute"; and the piano-roll tools: "arpeggiate" (chords → runs; arp options), "strum" (spread chord notes; strum options), "chop" (cut into `grid`-step pieces), "flam" (grace note before each note), "snap_to_scale" (move off-scale pitches to the nearest note of `scale`), "articulate" (length = `ratio` of the gap to the next note), "limit" (fold into pitchMin..pitchMax of `range` by octaves), "velocity_ramp" (fade velocities from `velocity.from` to `velocity.to`).',
    inputSchema: obj({
      pattern: ref('Pattern'),
      channel: ref('Channel'),
      op: choice(['transpose', 'shift', 'quantize', 'legato', 'velocity', 'humanize', 'duplicate', 'reverse', 'mute', 'unmute',
        'arpeggiate', 'strum', 'chop', 'flam', 'snap_to_scale', 'articulate', 'limit', 'velocity_ramp'], 'The operation'),
      filter: FILTER,
      semitones: int('transpose: amount (12 = an octave)'),
      steps: num('shift: amount; duplicate: offset (default: the notes\' own span, rounded up to a whole step)'),
      grid: num('quantize: grid size in steps (1 = 16th, 2 = 8th, 4 = quarter; default 1)', { minimum: 0.0625 }),
      startsOnly: bool('quantize: only move starts'),
      velocity: obj({ set: num('Set every velocity', { minimum: 0, maximum: 1 }), scale: num('Multiply velocities', { minimum: 0 }), add: num('Add to velocities', { minimum: -1, maximum: 1 }), from: num('velocity_ramp: first velocity', { minimum: 0, maximum: 1 }), to: num('velocity_ramp: last velocity', { minimum: 0, maximum: 1 }) }, [], 'velocity op: exactly one of set / scale / add; velocity_ramp: from / to'),
      humanize: obj({ timing: num('Max start offset in steps (default 0.06)', { minimum: 0 }), velocity: num('Max velocity change (default 0.1)', { minimum: 0, maximum: 1 }) }),
      arp: obj({
        rate: num('Steps between arp notes (1 = 16ths, 2 = 8ths, 4/3 = 8th triplets; default 1)', { minimum: 0.125 }),
        pattern: choice(['up', 'down', 'updown', 'downup', 'random'], 'Direction (default up)'),
        gate: num('Note length as a fraction of rate (default 0.9)', { minimum: 0.05, maximum: 1 }),
        octaves: int('Octaves to span (default 1)', { minimum: 1, maximum: 4 }),
      }),
      strum: obj({
        spread: num('Steps from the first to the last chord note (default 0.5)', { minimum: 0 }),
        direction: choice(['up', 'down'], 'up = lowest note first (default)'),
        taper: num('Velocity drop across the strum, 0-1 (default 0)', { minimum: 0, maximum: 1 }),
      }),
      scale: obj({ root: PITCH, name: str(`Scale name: ${Object.keys(SCALES).join(', ')}`) }, ['root', 'name'], 'snap_to_scale: the scale (root as a note name like "C" or "F#5", any octave)'),
      ratio: num('articulate: length as a fraction of the gap to the next note (0.5 = staccato)', { minimum: 0.05, maximum: 1 }),
      range: obj({ pitchMin: PITCH, pitchMax: PITCH }, ['pitchMin', 'pitchMax'], 'limit: the pitch range (at least an octave)'),
    }, ['channel', 'op']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Transform notes' },
    run(a, app) {
      const { store } = app;
      const pat = patternOf(store, a.pattern);
      const ch = channelOf(store, a.channel);
      const list = pat.notes[ch.id] || [];
      const hit = matcher(a.filter);
      const sel = list.filter(hit);
      if (!sel.length) return { changed: 0, note: 'No notes matched' };
      edit(store, () => {
        switch (a.op) {
          case 'transpose': {
            if (a.semitones === undefined) fail('transpose needs semitones');
            const lo = Math.min(...sel.map((n) => n.p)) + a.semitones;
            const hi = Math.max(...sel.map((n) => n.p)) + a.semitones;
            if (lo < 0 || hi > MAX_PITCH) fail(`Transposing by ${a.semitones} would leave the piano roll range (0-${MAX_PITCH})`);
            for (const n of sel) n.p += a.semitones;
            break;
          }
          case 'shift': {
            if (a.steps === undefined) fail('shift needs steps');
            if (Math.min(...sel.map((n) => n.s)) + a.steps < 0) fail('Shifting that far would move notes before the start of the pattern');
            for (const n of sel) n.s += a.steps;
            break;
          }
          case 'quantize': {
            const q = a.grid ?? 1;
            for (const n of sel) {
              n.s = Math.max(0, Math.round(n.s / q) * q);
              if (!a.startsOnly) n.l = Math.max(q, Math.round(n.l / q) * q);
            }
            break;
          }
          case 'legato': {
            const starts = [...new Set(sel.map((n) => n.s))].sort((x, y) => x - y);
            for (const n of sel) {
              const next = starts.find((s) => s > n.s + 1e-6);
              if (next != null) n.l = next - n.s;
            }
            break;
          }
          case 'velocity': {
            const v = a.velocity ?? fail('velocity needs { set | scale | add }');
            if (Object.keys(v).length !== 1) fail('velocity takes exactly one of set, scale, add');
            for (const n of sel) n.v = clamp01(v.set ?? (v.scale !== undefined ? n.v * v.scale : n.v + v.add));
            break;
          }
          case 'humanize': {
            const t = a.humanize?.timing ?? 0.06;
            const v = a.humanize?.velocity ?? 0.1;
            for (const n of sel) {
              n.s = Math.max(0, n.s + (Math.random() * 2 - 1) * t);
              n.v = clamp01(n.v + (Math.random() * 2 - 1) * v);
            }
            break;
          }
          case 'duplicate': {
            const min = Math.min(...sel.map((n) => n.s));
            const max = Math.max(...sel.map((n) => n.s + n.l));
            const offset = a.steps ?? Math.max(1, Math.ceil(max - min - 1e-6));
            for (const n of sel) list.push({ ...n, s: n.s + offset });
            break;
          }
          case 'reverse': {
            const lo = Math.min(...sel.map((n) => n.s));
            const hi = Math.max(...sel.map((n) => n.s + n.l));
            for (const n of sel) n.s = lo + hi - (n.s + n.l);
            break;
          }
          case 'mute': case 'unmute':
            for (const n of sel) { if (a.op === 'mute') n.m = true; else delete n.m; }
            break;
          case 'arpeggiate': case 'strum': case 'chop': case 'flam': case 'snap_to_scale': case 'articulate': case 'limit': case 'velocity_ramp': {
            const made = replaceOp(a, sel);
            const drop = new Set(sel);
            const kept = list.filter((n) => !drop.has(n));
            list.length = 0;
            list.push(...kept, ...made);
            sel.length = 0;
            sel.push(...made);
            break;
          }
          default:
            fail(`Unknown op ${a.op}`);
        }
        pat.notes[ch.id] = list;
        emitNotes(store, pat);
      });
      return { changed: sel.length, bars: pat.bars, notes: sel.slice(0, 20).map((n) => ({ ...noteOut(n), start: round(n.s) })) };
    },
  },
];
