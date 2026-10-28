import { bool, choice, int, num, obj, ref, str, arr } from '../schema.js';
import { channelOf, edit, fail, patternOf } from '../helpers.js';
import { songContext, rememberSong, partFor } from '../music/session.js';
import { roleOf, isDrumRole } from '../music/roles.js';
import { STYLE_IDS, STRUCTURES, DEFAULT_STRUCTURE, SECTION_ROLES, ROLES, DRUM_LANES } from '../music/styles.js';
import { SFX } from '../../audio/sfx.js';
import { noteName } from '../../util.js';
import { STEPS_PER_BAR } from '../../state.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const KINDS = ['intro', 'verse', 'build', 'chorus', 'drop', 'break', 'outro'];
const ROLE = choice(ROLES, 'What the part does: drums (a whole kit), kick, snare, clap, hat, openhat, perc, tom, crash, ride, bass, chords, stabs, pad, arp, lead (melody) or fx (riser / impact). Default: guessed from the channel.');

const SECTION = obj({
  name: str('Section name, e.g. "Verse 1"'),
  bars: int('Length in bars', { minimum: 1, maximum: 64 }),
  energy: num('0 (sparse) to 1 (everything playing, loudest)', { minimum: 0, maximum: 1 }),
  kind: choice(KINDS, 'Decides which instruments play: intro, verse, build, chorus, drop, break, outro'),
  riser: bool('Put a riser over the end of this section'),
  impact: bool('Put an impact on the first beat of this section'),
}, ['name', 'bars']);

const LABEL = { drums: 'Drums', bass: 'Bass', chords: 'Chords', stabs: 'Stabs', pad: 'Pad', arp: 'Arp', lead: 'Lead', fx: 'FX' };
const KIND_LABEL = { intro: 'Intro', verse: 'Verse', build: 'Build', chorus: 'Chorus', drop: 'Drop', break: 'Break', outro: 'Outro' };

const rangeOf = (notes) => (notes.length ? `${noteName(Math.min(...notes.map((n) => n.p)))}–${noteName(Math.max(...notes.map((n) => n.p)))}` : null);

/** The tracks a built song uses, top to bottom. */
const TRACKS = ['drums', 'bass', 'chords', 'stabs', 'pad', 'arp', 'lead', 'fx', 'fx2', 'texture'];

export const tools = [
  {
    name: 'compose',
    title: 'Compose parts',
    description: 'Write musical parts into a pattern, in key and in time: it generates the notes for you. Every part shares one key, chord progression and style, so drums, bass, chords, arpeggios and melody fit together — chords are voice-led, the bass follows the roots, melodies move by step and land on chord tones, drums get accents, ghost notes and fills, velocities are humanized. REPLACES the notes of each part\'s channel in the pattern. Roles are guessed from the channel (set one with role). key / style / progression default to what setup_song stored. The same seed gives the same music; change seed for another take, density for a busier or sparser melody, energy (0-1) for a softer or bigger part, variation for more or less change between bars. For a whole song use build_song; to place the result use arrange or add_clips. Returns the chords and a summary per part.',
    inputSchema: obj({
      pattern: ref('Pattern to write into (default: the selected one)'),
      key: str('Key, e.g. "A minor", "C major", "F# dorian" (default: the song\'s key)'),
      style: choice(STYLE_IDS, 'Style: sets the grooves, rhythms and registers (default: the song\'s style, else pop)'),
      progression: str('Chords as roman numerals ("i VI III VII"), chord names ("Am F C G"), "Am:2 F:2" for two bars each, or a name ("epic", "pop", "lofi", "sad", …; see music_theory progressions)'),
      bars: int('Pattern length in bars (default: the pattern\'s length, or 4 for an empty pattern)', { minimum: 1, maximum: 64 }),
      seed: int('Random seed; the same seed writes the same music (default 1)', { minimum: 0, maximum: 1000000 }),
      energy: num('0-1: how big and loud the parts play (default 0.8)', { minimum: 0, maximum: 1 }),
      variation: num('0-1: how much changes from bar to bar (default 0.4)', { minimum: 0, maximum: 1 }),
      humanize: num('0-1: random timing and velocity drift (default 0.35)', { minimum: 0, maximum: 1 }),
      fills: bool('Drum fills at the end of each 4 bars (default true)'),
      parts: arr(obj({
        channel: ref('Channel that plays the part'),
        role: ROLE,
        density: num('lead: 0-1 how busy the melody is (default: the style\'s)', { minimum: 0, maximum: 1 }),
        octave: int('Shift the part up or down this many octaves', { minimum: -3, maximum: 3 }),
        rhythm: str('bass / chords: a custom rhythm. bass: "0r2 3f1 6o1.5" (step, r root / f fifth / o octave / t third / s seventh / a approach, length). chords: "0/3 4/1 6/2" (start/length)'),
        arp_pattern: choice(['up', 'down', 'updown', 'broken', 'random'], 'arp: note order'),
      }, ['channel']), 'The parts to write', { minItems: 1, maxItems: 24 }),
    }, ['parts']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Compose parts' },
    run(a, app) {
      const { store } = app;
      const ctx = songContext(app, a);
      const pat = patternOf(store, a.pattern);
      const has = Object.values(pat.notes).some((l) => l.length);
      const bars = a.bars ?? (has ? pat.bars : 4);
      const work = a.parts.map((p) => {
        const ch = channelOf(store, p.channel);
        const role = p.role ?? roleOf(ch);
        if (role === 'fx' && ch.type !== 'sfx') fail(`"${ch.name}" is not a Sound FX channel: role "fx" needs one (add_channel type "sfx")`);
        return { p, ch, role };
      });
      let drums;
      const written = work.map(({ p, ch, role }) => {
        const out = partFor(ch, role, ctx, {
          bars, seed: a.seed ?? 1, energy: a.energy, variation: a.variation, humanize: a.humanize, fills: a.fills,
          density: p.density, octave: p.octave, rhythm: p.rhythm, arpPattern: p.arp_pattern, drums,
        });
        drums = out.drums;
        return { ch, role, notes: out.notes };
      });
      edit(store, () => {
        for (const { ch, notes } of written) pat.notes[ch.id] = notes;
        pat.bars = Math.max(bars, a.bars ? bars : pat.bars);
        store.normalizePattern(pat);
        if (!store.project.song) rememberSong(app, ctx);
        store.emit('notes');
        store.emit('patterns');
      });
      return {
        pattern: pat.id, name: pat.name, bars: pat.bars, key: ctx.key.name, style: ctx.styleId,
        chords: ctx.chordNames, progression: ctx.progressionText,
        parts: written.map(({ ch, role, notes }) => ({ channel: ch.id, name: ch.name, role, notes: notes.length, range: isDrumRole(role) ? undefined : rangeOf(notes) })),
        next: 'Place the pattern with arrange / add_clips (song mode), or build_song for a whole arrangement. Check it with analyze_song.',
      };
    },
  },
  {
    name: 'build_song',
    title: 'Build a whole song',
    description: 'Write a complete, structured first draft of a song in one call: it uses the channels of the project by role (run setup_song first for a style-appropriate set), writes patterns for every section in a real song form — intro, verse, chorus, bridge, outro, or intro, build, drop, breakdown, drop, outro for dance styles — with more instruments and bigger drums as the energy rises, drum fills, crashes, risers and impacts, then places them on the playlist (one track per instrument, named) and switches to song mode. Verses repeat their patterns exactly, choruses are bigger, so the form is audible. Replaces the arrangement when clear is true. Returns the section map; refine afterwards with compose (different seed / energy), set_notes, add automation, then analyze_song and auto_mix.',
    inputSchema: obj({
      style: choice(STYLE_IDS, 'Style (default: the song\'s style from setup_song, else pop)'),
      key: str('Key, e.g. "A minor" (default: the song\'s key)'),
      progression: str('Chord progression: roman numerals, chord names, or a name like "epic" (default: the style\'s)'),
      structure: { type: ['string', 'array'], items: SECTION, description: `A named form (${Object.keys(STRUCTURES).join(', ')}) or your own list of sections. Default: the style's usual form.` },
      bpm: num('Tempo (default: the style\'s typical tempo, unless the project already has one from setup_song)', { minimum: 40, maximum: 220 }),
      seed: int('Random seed: the same seed builds the same song (default 1)', { minimum: 0, maximum: 1000000 }),
      variation: num('0-1: how much changes between bars (default 0.45)', { minimum: 0, maximum: 1 }),
      humanize: num('0-1: timing / velocity drift (default 0.35)', { minimum: 0, maximum: 1 }),
      name: str('Project name'),
      clear: bool('Replace the existing arrangement (playlist clips and all patterns). Required when the playlist already has clips.'),
    }),
    annotations: { ...WRITE, destructiveHint: true, title: 'Build a whole song' },
    run(a, app) {
      const { store, transport } = app;
      const proj = store.project;
      const ctx = songContext(app, a);
      const { style } = ctx;

      // sections
      let sections;
      if (Array.isArray(a.structure)) sections = a.structure.map((s) => ({ energy: 0.7, kind: 'verse', ...s }));
      else {
        const id = a.structure ?? DEFAULT_STRUCTURE[ctx.styleId];
        sections = (STRUCTURES[id] ?? fail(`Unknown structure "${id}" — ${Object.keys(STRUCTURES).join(', ')}`)).sections;
      }
      if (!sections.length) fail('The structure has no sections');

      // channels by role
      const byRole = new Map();
      for (const ch of proj.channels) { const r = roleOf(ch); (byRole.get(r) ?? byRole.set(r, []).get(r)).push(ch); }
      const drumChannels = proj.channels.filter((c) => isDrumRole(roleOf(c)));
      const first = (role) => byRole.get(role)?.[0];
      const fxChannels = byRole.get('fx') ?? [];
      const riserCh = fxChannels.find((c) => c.type === 'sfx' && SFX[c.params.sound]?.sustained && !SFX[c.params.sound]?.texture);
      const impactCh = fxChannels.find((c) => c.type === 'sfx' && !SFX[c.params.sound]?.sustained);
      const textureCh = fxChannels.find((c) => c.type === 'sfx' && SFX[c.params.sound]?.texture);
      const melodic = ['bass', 'chords', 'stabs', 'pad', 'arp', 'lead'].filter((r) => first(r));
      if (!drumChannels.length && !melodic.length) fail('The project has no channels to write for — run setup_song first, or add_channel');

      const hasClips = proj.playlist.clips.length > 0;
      if (hasClips && !a.clear) fail('The playlist already has clips. Pass clear: true to replace the arrangement, or use compose + arrange to extend it.');

      const wasSet = !!proj.song?.bpmSet;
      const seed = a.seed ?? 1;
      const common = { seed, variation: a.variation ?? 0.45, humanize: a.humanize };
      const made = new Map(); // cache key -> pattern
      const patterns = [];
      const placed = [];
      const skipped = new Set();

      edit(store, () => {
        if (a.clear) { proj.playlist.clips = []; proj.patterns = []; }
        else proj.patterns = proj.patterns.filter((p) => Object.values(p.notes).some((l) => l.length)); // drop untouched empty ones
        const addPattern = (name, bars) => {
          const p = store._addPattern(name);
          p.bars = bars;
          patterns.push(p);
          return p;
        };
        const color = (role) => first(role)?.color ?? null;

        let cursor = 0;
        for (const sec of sections) {
          const kind = sec.kind ?? 'verse';
          const energy = sec.energy ?? 0.7;
          const active = SECTION_ROLES[kind] ?? SECTION_ROLES.verse;
          const patBars = Math.min(sec.bars, 8);
          const place = (pat, track, startBar, bars) => {
            const clip = store.addClip({ type: 'pattern', pat: pat.id, track: TRACKS.indexOf(track), start: startBar * STEPS_PER_BAR, len: bars * STEPS_PER_BAR });
            placed.push({ clip: clip.id, section: sec.name, track, pattern: pat.name });
          };
          const cacheKey = (group) => `${group}|${kind}|${Math.round(energy * 10)}|${patBars}`;

          // drums: one pattern holding every drum channel
          if (drumChannels.length) {
            const lanes = DRUM_LANES.filter((l) => active.includes(l));
            const key = cacheKey('drums');
            let pat = made.get(key);
            if (!pat) {
              pat = addPattern(`Drums – ${KIND_LABEL[kind]}${energy >= 0.95 ? ' (full)' : ''}`, patBars);
              pat.color = color('kick') ?? pat.color;
              let drums;
              for (const ch of drumChannels) {
                const role = roleOf(ch);
                if (role !== 'drums' && !lanes.includes(role)) continue;
                const out = partFor(ch, role, ctx, { ...common, bars: patBars, energy, lanes, drums, seed: seed + 100 * (1 + KINDS.indexOf(kind)), fills: kind !== 'intro' && kind !== 'outro', crash: kind === 'chorus' || kind === 'drop' });
                drums = out.drums;
                if (out.notes.length) pat.notes[ch.id] = out.notes;
              }
              made.set(key, pat);
            }
            if (Object.values(pat.notes).some((l) => l.length)) place(pat, 'drums', cursor, sec.bars);
          }

          // melodic parts
          for (const role of melodic) {
            if (!active.includes(role)) continue;
            if (role === 'lead' && energy < 0.45) continue;
            const key = cacheKey(role);
            let pat = made.get(key);
            if (!pat) {
              const ch = first(role);
              const density = role === 'lead' ? (kind === 'chorus' || kind === 'drop' ? 0.62 : kind === 'break' ? 0.3 : 0.4) : undefined;
              const out = partFor(ch, role, ctx, { ...common, bars: patBars, energy, density, seed: seed + 100 * (1 + KINDS.indexOf(kind)), octave: 0 });
              pat = addPattern(`${LABEL[role]} – ${KIND_LABEL[kind]}`, patBars);
              pat.color = ch.color;
              pat.notes[ch.id] = out.notes;
              made.set(key, pat);
            }
            place(pat, role, cursor, sec.bars);
          }

          // an ambience (vinyl crackle, wind, waves) sits under the whole song
          if (textureCh && kind !== 'break') {
            const key = `texture|${patBars}`;
            let pat = made.get(key);
            if (!pat) {
              pat = addPattern(`FX – Texture ${patBars} bars`, patBars);
              pat.color = textureCh.color;
              pat.notes[textureCh.id] = [{ p: 60, s: 0, l: patBars * STEPS_PER_BAR, v: 0.9 }];
              made.set(key, pat);
            }
            place(pat, 'texture', cursor, sec.bars);
          }

          // transitions
          if (sec.riser && riserCh) {
            const bars = Math.min(sec.bars, kind === 'build' ? sec.bars : 4);
            const key = `riser|${bars}`;
            let pat = made.get(key);
            if (!pat) {
              pat = addPattern(`FX – Riser ${bars} bars`, bars);
              pat.color = riserCh.color;
              pat.notes[riserCh.id] = partFor(riserCh, 'fx', ctx, { ...common, bars }).notes;
              made.set(key, pat);
            }
            place(pat, 'fx', cursor + sec.bars - bars, bars);
          } else if (sec.riser) skipped.add('riser (add an sfx channel)');
          if (sec.impact && impactCh) {
            let pat = made.get('impact');
            if (!pat) {
              pat = addPattern('FX – Impact', 1);
              pat.color = impactCh.color;
              pat.notes[impactCh.id] = partFor(impactCh, 'fx', ctx, { ...common, bars: 1 }).notes;
              made.set('impact', pat);
            }
            place(pat, 'fx2', cursor, 1);
          } else if (sec.impact) skipped.add('impact (add an sfx channel with an impact sound)');
          cursor += sec.bars;
        }

        if (!proj.patterns.length) addPattern('Pattern 1', 1);
        // name the tracks that got clips, in order
        for (const [i, t] of TRACKS.entries()) {
          if (placed.some((p) => p.track === t)) proj.playlist.tracks[i].name = t === 'fx2' ? 'FX hits' : t === 'texture' ? 'Texture' : LABEL[t];
        }
        proj.selected.pattern = patterns[0]?.id ?? proj.patterns[0].id;
        rememberSong(app, ctx, { structure: Array.isArray(a.structure) ? 'custom' : (a.structure ?? DEFAULT_STRUCTURE[ctx.styleId]), seed, bpmSet: true });
        if (a.name) proj.name = a.name.trim() || proj.name;
        // keep a tempo somebody chose; the untouched default (130) becomes the style's typical tempo
        if (a.bpm !== undefined) proj.bpm = a.bpm;
        else if (proj.bpm === 130 && !wasSet) proj.bpm = style.bpm[1];
        proj.swing = style.swing;
        proj.mode = 'song';
        store.emit('patterns'); store.emit('notes'); store.emit('playlist'); store.emit('selection');
      });
      transport.emit('mode');
      transport.emit('bpm');
      const bpm = proj.bpm;
      const totalBars = sections.reduce((n, s) => n + s.bars, 0);
      let at = 1;
      return {
        style: ctx.styleId, key: ctx.key.name, bpm, chords: ctx.chordNames,
        bars: totalBars, seconds: Math.round((totalBars * 4 * 60) / bpm),
        sections: sections.map((s) => { const row = { name: s.name, bars: `${at}-${at + s.bars - 1}`, energy: s.energy ?? 0.7, plays: [...new Set(placed.filter((p) => p.section === s.name).map((p) => p.track))] }; at += s.bars; return row; }),
        patterns: patterns.map((p) => ({ id: p.id, name: p.name, bars: p.bars })),
        clips: placed.length,
        ...(skipped.size ? { skipped: [...skipped] } : {}),
        next: 'analyze_song to review the writing, auto_mix to balance it, render_audio to check levels. Rewrite any part with compose (another seed) or set_notes.',
      };
    },
  },
  {
    name: 'arrange',
    title: 'Arrange sections',
    description: 'Lay existing patterns out on the playlist as a sequence of sections, bar by bar: each section has a length in bars and the pattern clips that play in it (on the track you name, or the first free one). Sections follow each other from `start`. Use it to build or extend an arrangement from your own patterns; build_song does it automatically. Switches to song mode.',
    inputSchema: obj({
      sections: arr(obj({
        name: str('Section name (for your own bookkeeping)'),
        bars: int('Section length in bars', { minimum: 1, maximum: 256 }),
        clips: arr(obj({
          pattern: ref('Pattern to play'),
          track: int('Playlist track 0-124 (default: the first free track)', { minimum: 0, maximum: 124 }),
          bars: int('How long it plays in bars (default: the whole section)', { minimum: 1, maximum: 256 }),
          at: int('Start this many bars into the section (default 0)', { minimum: 0, maximum: 255 }),
        }, ['pattern']), 'Pattern clips in this section', { minItems: 1, maxItems: 64 }),
      }, ['bars', 'clips']), 'Sections in order', { minItems: 1, maxItems: 64 }),
      start: int('First bar (1 = the very beginning, default: right after the existing clips, or 1)', { minimum: 1 }),
      clear: bool('Remove the existing clips first'),
    }, ['sections']),
    annotations: { ...WRITE, destructiveHint: true, title: 'Arrange sections' },
    run(a, app) {
      const { store, transport } = app;
      const proj = store.project;
      const plan = a.sections.map((s, i) => ({
        s, clips: s.clips.map((c, k) => {
          const pat = patternOf(store, c.pattern);
          if (c.at !== undefined && c.at >= s.bars) fail(`sections[${i}].clips[${k}].at starts after the section ends`);
          return { c, pat };
        }),
      }));
      let cursor = (a.start ?? (a.clear || !proj.playlist.clips.length ? 1 : Math.ceil(store.playlistEndStep() / STEPS_PER_BAR) + 1)) - 1;
      const out = [];
      edit(store, () => {
        if (a.clear) proj.playlist.clips = [];
        for (const { s, clips } of plan) {
          for (const { c, pat } of clips) {
            const bars = c.bars ?? s.bars - (c.at ?? 0);
            const start = (cursor + (c.at ?? 0)) * STEPS_PER_BAR;
            const len = bars * STEPS_PER_BAR;
            let track = c.track;
            if (track === undefined) {
              track = 0;
              while (proj.playlist.clips.some((x) => x.track === track && x.start < start + len && x.start + x.len > start)) track++;
            }
            const clip = store.addClip({ type: 'pattern', pat: pat.id, track, start, len });
            out.push({ clip: clip.id, section: s.name ?? null, pattern: pat.name, track, startBar: start / STEPS_PER_BAR + 1, bars });
          }
          cursor += s.bars;
        }
        proj.mode = 'song';
        store.emit('playlist');
      });
      transport.emit('mode');
      return { endBar: cursor + 1, totalBars: cursor, clips: out };
    },
  },
];
