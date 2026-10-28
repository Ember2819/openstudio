// The producer's handbook served by the songwriting_guide tool. Written for an agent that cannot listen: it says
// what to do, in what order, with which tools, and what "good" looks like in numbers.

export const GUIDE_TOPICS = ['workflow', 'harmony', 'melody', 'rhythm', 'arrangement', 'sound', 'mixing', 'checklist'];

const WORKFLOW = `# Making a song that sounds finished

You cannot hear, so lean on the tools that know music: they keep notes in key, voice chords smoothly, write grooves with
accents and fills, and measure the result. Work in this order and re-check after each step.

1. **Decide** style, key, tempo and mood before touching notes. music_theory kind "styles" lists what each style needs.
   Pick a key that suits the mood (minor = dark / tense / emotional, major = bright / open) and a progression to match
   (music_theory kind "progressions").
2. **Set up** with setup_song { style, key }. It creates instruments suited to the style, routes each to its own mixer
   track, adds reverb and delay buses and a master chain, and sets tempo and swing. Use list_catalog and update_channel
   to swap any instrument you do not like (preview_note lets the user hear it).
3. **Draft** with build_song { style, key }. It writes every section of a real song form (intro, verse, chorus, bridge,
   outro — or intro, build, drop, breakdown, drop for dance music) as patterns, places them on the playlist, adds fills,
   risers and impacts, and switches to song mode. This takes seconds; do it first, then improve.
4. **Check** with analyze_song. It reports key, chords per bar, register clashes, flat dynamics, missing sections and
   repetition, each with a fix. Then render_audio for levels, clipping and spectral balance.
5. **Refine** the weak spots, not everything: re-compose one part with another seed, change density or energy, rewrite a
   melody by hand with set_notes, add automation (filter sweeps, volume rides), add a countermelody or a transition.
6. **Mix** with auto_mix (calibrate: true balances every channel from rendered stems), then render_audio again.
7. **Finish**: save_project, and tell the user what you made: key, tempo, structure, and what you would change next.

Never skip step 4 and 6: the feedback is the difference between a loop and a song.`;

const HARMONY = `# Harmony

- Stay in one key. Chords come from its scale: in a major key I ii iii IV V vi vii°; in a minor key i ii° III iv v VI VII.
  music_theory kind "key" prints them with note names and MIDI numbers.
- A chord change every bar (or every two bars for slow music) is the norm. Four chords looping is enough: the arrangement
  carries the interest, not the harmony.
- Classic progressions: I V vi IV (pop), vi IV I V (axis), i VI III VII (epic minor), i VII VI VII (dark), i iv VII III (sad),
  ii V I (jazz). Add sevenths (7, maj7, m7) for warmth in lo-fi, jazz and soul; keep triads for rock and big EDM.
- Voice chords in the middle (C3–C5, MIDI 48–72) and keep the movement between chords small: compose does this. Keep
  everything below C3 for the bass.
- The bass plays the chord root on the downbeat of a chord change. Passing notes and approach notes are welcome between.
- A chord outside the key (borrowed chord) once per loop adds colour: bVII in a major key, IV in a minor key.`;

const MELODY = `# Melody

- Write a short motif (1–2 bars), then repeat it with a change, then answer it, then resolve. compose role "lead" does exactly this.
- Strong beats (1 and 3) land on chord tones; passing notes between them move by step. Mostly small intervals, an occasional
  leap (a 4th or 5th) followed by a step back.
- Leave space. Rests are part of the tune; a lead that never stops tires the listener. Density 0.3–0.5 for verses, 0.5–0.8 for choruses.
- Range: a lead lives around G4–C6 (OpenStudio names, MIDI 67–84), a singable melody within about an octave and a half.
- Repeat the hook in the chorus exactly (same seed); vary the verse (new seed). Repetition is what makes a melody memorable.
- End phrases on the root, third or fifth of the chord that is playing.`;

const RHYTHM = `# Rhythm and groove

- 16 steps per bar, 4 per beat. Kick on beats 1 and 3 (or all four for dance music), snare / clap on 2 and 4 (beat 3 for half-time trap).
- Hats carry the feel: accent the off-beats, vary velocity (loud 0.9, medium 0.65, soft 0.35). Identical velocities sound like a machine.
- Add ghost notes (very quiet snare hits between backbeats) for funk, hip-hop, lo-fi, dnb: compose does it through "variation".
- Swing (set_project swing 0–1) shifts every second 16th later: 0.15–0.3 for hip-hop / lo-fi / funk, 0 for dance.
- Fill every 4th or 8th bar (a snare roll or tom run on the last beat), and put a crash on bar 1 of a new section.
- Make the bass and kick lock: the bass should not play a long note on top of every kick hit. Short notes on the kick, long notes between.`;

const ARRANGEMENT = `# Arrangement

A song is a sequence of sections that differ in energy. Do not loop one pattern for the whole piece.

| Section | Typical length | Energy | What plays |
| --- | --- | --- | --- |
| Intro | 4–8 bars | low | pad / chords, a little percussion, maybe the kick; tease the hook |
| Verse | 8–16 bars | medium | drums, bass, chords; the lead is sparse or absent |
| Pre-chorus / build | 4–8 bars | rising | everything tightens: riser, snare roll, filter opening |
| Chorus / drop | 8–16 bars | peak | full band, lead / hook, widest sound, crash on the downbeat |
| Breakdown / bridge | 8 bars | low | drums out, pads and a new melody; the contrast makes the next chorus hit |
| Outro | 4–8 bars | falling | elements leave one by one |

- Change something every 4 bars and something bigger every 8: a fill, an element dropping out, a new layer entering.
- Add before you subtract: bring instruments in one at a time in the intro and the verses.
- Total length: 64–128 bars is a normal song (2–4 minutes at 120 BPM). A loop is 8 bars.
- build_song writes this for you; arrange places existing patterns; analyze_song tells you where the form is weak.`;

const SOUND = `# Choosing sounds

- One instrument per job (drums, bass, chords, pad, lead, arp, fx). Two instruments in the same register fight each other.
- list_catalog kind "synth_presets" has presets for five engines: subtractive synth (basses, leads, pads, stabs), FM (electric pianos,
  bells, mallets), organ, plucked strings (guitar, harp, koto), and sound effects (risers, impacts, sweeps, textures).
  "instruments" lists General MIDI sounds (pianos, strings, brass, guitars), "drum_kits" real drum kits, "drum_voices" synthesized drums.
- Bass: sine / saw sub for modern styles (808 Sub, Reese Bass), finger / pick bass for band styles. Keep it mono and in the low octaves.
- Pads sustain; pluck and arp sounds are short. Use both so the song has body and rhythm.
- Sound effects glue sections together: a riser into every drop, an impact on its first beat, a downlifter after it, a reverse crash into a bar line.
- Preview before committing: preview_note plays a chord on any channel.`;

const MIXING = `# Mixing

- Levels: kick and bass loudest, then snare / lead, then chords and pads, hats and percussion quietest. auto_mix with
  calibrate: true measures every channel in an offline render and sets the faders to these proportions.
- Aim for a master peak around -3 to -1 dBFS and RMS around -16 to -12 dBFS before mastering; never full-scale (clipping).
- Clear the lows: high-pass everything except kick and bass (auto_mix does).
- Space: a reverb send (30% on pads, snare and lead; little on kick and bass) and a delay send on leads and arps. Dry drums feel tight, wet pads feel wide.
- Stereo: kick, bass, snare and lead near the centre; hats, percussion, arps and chords spread a little left and right. Pan with update_mixer_track.
- Check with render_audio: spectrum.energyShare should have bass roughly 0.3–0.5 of the total for most styles; warnings tell you about
  clipping, phase problems and silence. Per-channel stems (stems: true) show who masks whom.`;

const CHECKLIST = `# Before you say you are done

- [ ] One key throughout (analyze_song key.notesInKey above 0.9).
- [ ] The song has sections with different energy (energy.sections varies by at least 0.2).
- [ ] 64+ bars for a song, 8 for a loop; intro and outro present.
- [ ] Every channel has notes and a purpose; none sits in another's register.
- [ ] Velocities vary; drums have fills; hats are not flat.
- [ ] Transitions: riser or fill into each big section, a hit on its downbeat.
- [ ] render_audio: no clipping, peak below -1 dBFS, no "silent" warning, balanced spectrum.
- [ ] Saved (save_project) and tempo, key and structure reported to the user.`;

const TOPICS = { workflow: WORKFLOW, harmony: HARMONY, melody: MELODY, rhythm: RHYTHM, arrangement: ARRANGEMENT, sound: SOUND, mixing: MIXING, checklist: CHECKLIST };

export const guide = (topic = 'workflow') => TOPICS[topic] ?? null;
export const fullGuide = () => GUIDE_TOPICS.map((t) => TOPICS[t]).join('\n\n');
