// Glue between the pure generators and the project: resolve the song's key / style / progression, and turn a
// channel + role into the notes that channel should play. Used by compose, build_song and setup_song.
import { fail } from '../helpers.js';
import { parseKey, parseProgression, parseChord, hashSeed, pcName } from './theory.js';
import { STYLES, STYLE_IDS, LANE_KEY, KEY_LANE, PROGRESSIONS, namedProgression } from './styles.js';
import { generateDrums, generateBass, generateChords, generateArp, generateMelody, generateFx, chordTimeline, humanize } from './generate.js';
import { isKitChannel } from '../../audio/catalog.js';
import { SFX } from '../../audio/sfx.js';

const TOM_KEYS = [50, 47, 45]; // high, mid, low tom on a kit channel
const TOM_SEMIS = [4, 0, -5]; // the same fill on a synthesized drum channel, by pitch

/** Default progression name for a style in a given key's mood. */
function defaultProgression(style, key) {
  const group = key.mode === 'major' || key.mode === 'lydian' || key.mode === 'pentatonic_major' ? 'major'
    : ['dorian', 'mixolydian', 'phrygian'].includes(key.mode) ? 'modal' : 'minor';
  for (const name of style.progressions) if (PROGRESSIONS[group][name]) return PROGRESSIONS[group][name];
  return group === 'major' ? PROGRESSIONS.major.pop : group === 'minor' ? PROGRESSIONS.minor.epic : PROGRESSIONS.modal[key.mode] ?? PROGRESSIONS.modal.dorian;
}

/**
 * Everything a generator needs to know about the song: style, key, chords. Arguments win, then the song settings
 * stored in the project (set by setup_song / build_song), then the style's defaults.
 */
export function songContext(app, a = {}) {
  const meta = app.store.project.song ?? {};
  const styleId = a.style ?? meta.style ?? 'pop';
  const style = STYLES[styleId] ?? fail(`Unknown style "${styleId}" — styles: ${STYLE_IDS.join(', ')}`);
  const keyText = a.key ?? meta.key ?? fail('Say which key the song is in, e.g. key: "A minor" or "C major"');
  let key;
  try { key = parseKey(keyText); } catch (e) { fail(e.message); }
  // roman numerals need a 7-note scale: pentatonic / blues keys take their chords from the parent major / minor
  const chordKey = key.scale.length === 7 ? key : parseKey(`${pcName(key.root, key.flats)} ${/minor|blues/.test(key.mode) ? 'minor' : 'major'}`);
  const progText = a.progression ?? meta.progression;
  let text = progText ? (namedProgression(String(progText).trim().toLowerCase()) ?? progText) : defaultProgression(style, chordKey);
  let progression;
  try { progression = parseProgression(text, chordKey); } catch (e) { fail(`Progression "${progText}": ${e.message}`); }
  return { styleId, style, key, chordKey, progression, progressionText: text, chordNames: progression.map((c) => c.name) };
}

/** Remember the song's settings in the project so later calls need not repeat them. */
export function rememberSong(app, ctx, patch = {}) {
  app.store.project.song = { ...(app.store.project.song ?? {}), style: ctx.styleId, key: `${pcName(ctx.key.root, ctx.key.flats)} ${ctx.key.mode.replace('_', ' ')}`, progression: ctx.progressionText, ...patch };
}

export { parseChord };

/** Notes for a drum channel from a shared generated drum part: a kit channel gets every lane, a single piece its own lane. */
function drumNotes(ch, role, drums, only) {
  const kit = isKitChannel(ch);
  let lanes;
  if (kit) lanes = Object.keys(drums).filter((l) => !only || only.includes(l));
  else lanes = [role === 'drums' ? (KEY_LANE[ch.fixedKey] ?? 'perc') : role];
  const notes = [];
  for (const lane of lanes) {
    for (const n of drums[lane] ?? []) {
      let p = 60;
      if (kit) p = lane === 'tom' && n.alt !== undefined ? TOM_KEYS[n.alt] : (LANE_KEY[lane] ?? 60);
      else if (ch.type === 'drum' && lane === 'tom' && n.alt !== undefined) p = 60 + TOM_SEMIS[n.alt];
      notes.push({ p, s: n.s, l: n.l, v: n.v });
    }
  }
  return notes;
}

/** Keep every note inside the pattern: one that runs past the end would silently make the pattern a bar longer. */
function fit(notes, bars) {
  const end = bars * 16;
  const out = [];
  for (const n of notes) {
    if (n.s >= end - 0.02) continue;
    n.l = Math.round(Math.max(0.1, Math.min(n.l, end - n.s)) * 1000) / 1000;
    out.push(n);
  }
  return out;
}

/**
 * The notes `ch` should play for `role` in the song described by `ctx`.
 * opts: { bars, seed, energy, variation, humanize, fills, density, octave, rhythm, arpPattern, lanes (drum lanes a kit
 * channel may play), drums (shared drum part) }
 * Returns { notes, drums } — pass `drums` back in for the next drum channel so the lanes stay in step.
 */
export function partFor(ch, role, ctx, opts) {
  const { style, key, progression } = ctx;
  const bars = opts.bars;
  const timeline = chordTimeline(progression, bars, style.chordBars ?? 1);
  const seed = (opts.seed ?? 1) + (hashSeed(role) % 997);
  const base = { style, timeline, bars, seed, energy: opts.energy ?? 0.8, variation: opts.variation ?? 0.4, octave: opts.octave ?? 0 };
  const amount = opts.humanize ?? 0.35;
  let notes;
  let drums = opts.drums;
  switch (role) {
    case 'drums': case 'kick': case 'snare': case 'clap': case 'hat': case 'openhat': case 'perc': case 'tom': case 'crash': case 'ride': {
      drums ??= generateDrums({ style, bars, seed: (opts.seed ?? 1) + 11, energy: base.energy, variation: base.variation, fills: opts.fills ?? true, crash: opts.crash ?? true });
      notes = drumNotes(ch, role, drums, opts.lanes);
      return { notes: fit(humanize(notes, seed, amount, { timing: false }), bars), drums };
    }
    case 'bass': notes = generateBass({ ...base, pattern: opts.rhythm }); break;
    case 'chords': case 'stabs': notes = generateChords({ ...base, role, rhythm: opts.rhythm }); break;
    case 'pad': notes = generateChords({ ...base, role: 'pad' }); break;
    case 'arp': notes = generateArp({ ...base, pattern: opts.arpPattern }); break;
    case 'lead': notes = generateMelody({ ...base, key, density: opts.density }); break;
    case 'fx': {
      const sound = ch.type === 'sfx' ? ch.params?.sound : null;
      const sustained = sound ? !!SFX[sound]?.sustained : true;
      notes = generateFx({ kind: sustained ? 'riser' : 'impact', bars });
      return { notes: fit(notes, bars), drums };
    }
    default: fail(`Unknown role "${role}"`);
  }
  return { notes: fit(humanize(notes, seed, amount * (role === 'bass' ? 0.6 : 1)), bars), drums };
}
