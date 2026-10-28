import { choice, obj, str } from '../schema.js';
import { fail } from '../helpers.js';
import { noteName } from '../../util.js';
import { parseKey, diatonicChords, parseChord, parseProgression, voiceChord, pcName, SCALES } from '../music/theory.js';
import { STYLES, STYLE_IDS, STRUCTURES, DEFAULT_STRUCTURE, PROGRESSIONS, MIX_ROLES, SECTION_ROLES } from '../music/styles.js';
import { guide, fullGuide, GUIDE_TOPICS } from '../music/guide.js';

const names = (pitches) => pitches.map(noteName);

/** The pitches of a key's scale in one octave starting at its root, near the middle of the keyboard. */
const scaleOctave = (key, base = 60) => key.scale.map((i) => base + ((key.root - base) % 12 + 12) % 12 + i);

const REGISTERS = [
  { role: 'bass', range: 'C2–C3 (MIDI 24–48), roots around E1–G2', notes: 'Mono, low; nothing else below it.' },
  { role: 'chords', range: 'C3–C5 (MIDI 48–72)', notes: 'Voiced close together, moving as little as possible between chords.' },
  { role: 'pad', range: 'C3–A4 (MIDI 48–69)', notes: 'Long notes; keep it out of the bass octave.' },
  { role: 'arp', range: 'C5–C7 (MIDI 60–84)', notes: 'Short notes, 8ths or 16ths.' },
  { role: 'lead', range: 'G4–C7 (MIDI 67–84)', notes: 'The tune; about an octave and a half.' },
  { role: 'kick / snare / hats', range: 'on a drum-kit channel: kick 36, snare 38, clap 39, closed hat 42, open hat 46, crash 49, ride 51; single-piece channels: any pitch (use 60)', notes: 'See list_catalog kind "drum_kits" for every piece.' },
];

export const tools = [
  {
    name: 'music_theory',
    title: 'Music theory lookup',
    description: 'Look up music theory so you do not have to compute pitches. kind "key": the scale and diatonic chords of a key with note names and MIDI numbers, plus the relative key and progression suggestions. "progressions": named chord progressions written for the key (or as roman numerals). "chord": the notes of one chord or progression ("Am7", "i VI III VII") with a smooth voicing. "styles": every style (tempo, feel, key, instruments, default structure). "structures": song forms (intro / verse / chorus …) with section lengths. "registers": where each part sits on the keyboard. Read-only.',
    inputSchema: obj({
      kind: choice(['key', 'progressions', 'chord', 'styles', 'structures', 'registers'], 'What to look up'),
      key: str('A key such as "A minor", "C major", "F# dorian", "Bb"'),
      chord: str('chord / progression: a chord ("Am7", "G/B", "V7") or a progression ("i VI III VII", "Am F C G")'),
      mood: choice(['major', 'minor', 'modal'], 'progressions: only this group'),
      style: choice(STYLE_IDS, 'styles: one style in detail'),
    }, ['kind']),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Music theory lookup' },
    run(a) {
      switch (a.kind) {
        case 'key': {
          if (!a.key) fail('kind "key" needs key, e.g. "A minor"');
          let key;
          try { key = parseKey(a.key); } catch (e) { fail(e.message); }
          const scale = scaleOctave(key);
          const sevenths = diatonicChords(key, true);
          return {
            key: key.name,
            scaleNotes: key.scale.map((i) => pcName(key.root + i, key.flats)),
            scaleMidi: scale,
            scaleNames: names(scale),
            ...(key.scale.length === 7 ? {
              chords: diatonicChords(key).map((c, i) => ({ degree: c.degree, numeral: c.numeral, chord: c.name, seventh: sevenths[i].name })),
              relative: key.mode === 'major' ? `${pcName(key.root + 9, key.flats)} minor` : key.mode === 'minor' ? `${pcName(key.root + 3, key.flats)} major` : undefined,
            } : { note: 'This scale has no diatonic triads; use it for melodies over chords from the parent major / minor key.' }),
            octaveNote: 'Pitches use OpenStudio naming: MIDI 60 = C5.',
          };
        }
        case 'progressions': {
          let key = null;
          if (a.key) { try { key = parseKey(a.key); } catch (e) { fail(e.message); } }
          const out = [];
          for (const [group, list] of Object.entries(PROGRESSIONS)) {
            if (a.mood && a.mood !== group) continue;
            for (const [name, text] of Object.entries(list)) {
              let chords;
              const keyMood = ['major', 'lydian', 'mixolydian'].includes(key?.mode) ? 'major' : 'minor';
              if (key && key.scale.length === 7 && (group === 'modal' || group === keyMood)) {
                try { chords = parseProgression(text, key).map((c) => c.name); } catch { /* not for this key */ }
              }
              out.push({ name, mood: group, numerals: text, ...(chords ? { inKey: chords.join(' ') } : {}) });
            }
          }
          return { progressions: out, use: 'Pass a name or the numerals as `progression` to compose, build_song or setup_song. Numerals work in any key.' };
        }
        case 'chord': {
          if (!a.chord) fail('kind "chord" needs chord');
          let key;
          try { key = parseKey(a.key ?? 'C major'); } catch (e) { fail(e.message); }
          let chords;
          try { chords = /\s|-/.test(a.chord.trim()) ? parseProgression(a.chord, key) : [parseChord(a.chord, key)]; } catch (e) { fail(e.message); }
          let prev = null;
          return {
            key: key.name,
            chords: chords.map((c) => {
              const v = voiceChord(c, prev, { lo: 48, hi: 76, center: 62 });
              prev = v;
              return { chord: c.name, symbol: c.symbol, voicing: v, notes: names(v), bassNote: noteName(36 + (((c.bass ?? c.root) % 12) + 12) % 12) };
            }),
          };
        }
        case 'styles': {
          const one = a.style ? { [a.style]: STYLES[a.style] } : STYLES;
          return {
            styles: Object.entries(one).map(([id, s]) => ({
              id, name: s.name, about: s.blurb, bpm: { min: s.bpm[0], typical: s.bpm[1], max: s.bpm[2] }, swing: s.swing, usualMode: s.mode,
              progressions: s.progressions, structure: DEFAULT_STRUCTURE[id],
              drumLanes: Object.keys(s.drums.lanes), roles: Object.keys(s.cast),
              instruments: Object.fromEntries(Object.entries(s.cast).map(([role, c]) => [role, c.name ?? c.preset ?? c.voice ?? `GM ${c.program}`])),
            })),
          };
        }
        case 'structures':
          return {
            structures: Object.entries(STRUCTURES).map(([id, s]) => ({
              id, about: s.blurb, totalBars: s.sections.reduce((n, x) => n + x.bars, 0),
              sections: s.sections.map((x) => ({ name: x.name, bars: x.bars, energy: x.energy, kind: x.kind, plays: SECTION_ROLES[x.kind] })),
            })),
            defaults: DEFAULT_STRUCTURE,
            custom: 'build_song also accepts your own list: [{ name, bars, energy 0-1, kind: intro|verse|build|chorus|drop|break|outro }].',
          };
        case 'registers':
          return { registers: REGISTERS, mixRoles: Object.keys(MIX_ROLES), scales: Object.keys(SCALES) };
        default:
          return fail(`Unknown kind ${a.kind}`);
      }
    },
  },
  {
    name: 'songwriting_guide',
    title: 'Songwriting and production guide',
    description: `A concise producer's handbook for making a song that sounds finished without being able to listen: the recommended workflow, harmony, melody, rhythm, arrangement, sound choice, mixing, and a final checklist. Read "workflow" first. topic: ${GUIDE_TOPICS.join(', ')}, or "all".`,
    inputSchema: obj({ topic: choice([...GUIDE_TOPICS, 'all'], 'Which part of the guide (default workflow)') }),
    annotations: { readOnlyHint: true, openWorldHint: false, title: 'Songwriting guide' },
    run(a) {
      const topic = a.topic ?? 'workflow';
      return { topic, guide: topic === 'all' ? fullGuide() : guide(topic) };
    },
  },
];
