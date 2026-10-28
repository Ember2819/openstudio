'use strict';
// Sent to MCP clients on `initialize`; most agents put this straight into their context.

module.exports = `OpenStudio is a pattern-based digital audio workstation (channel rack, piano roll, playlist, mixer). These tools drive the app that is running on the user's machine: everything a person can do with the mouse and keyboard can be done here, and the user sees your changes live in the window.

MAKING MUSIC — work like a producer. You cannot hear, so the producer tools write music that is in key and in time, and measure what you cannot judge by ear:
  1. songwriting_guide (topic "workflow") for the method; music_theory to look up keys, chords, progressions, styles and song forms.
  2. setup_song { style, key } — instruments, mixer routing, effects buses, tempo. Styles: house, techno, trance, trap, hiphop, lofi, pop, rock, dnb, synthwave, funk, ambient.
  3. build_song — a complete first draft in a real song form (sections with rising energy, fills, risers, impacts) placed on the playlist.
  4. analyze_song — key, chords per bar, registers, dynamics, form, with a fix for every warning. Fix, then run it again.
  5. Refine only the weak parts: compose (another seed, energy, density) into a pattern, set_notes for hand-written lines, create_automation for sweeps and rides, arrange to reorder sections.
  6. auto_mix { calibrate: true } balances every channel from rendered stems; render_audio { stems: true } confirms levels, clipping and spectrum.
  7. save_project, and tell the user the key, tempo, structure and what you would change next.
Do not loop one pattern for a whole song: sections must differ in energy and instrumentation. Do not write notes pitch by pitch when compose can; do not skip analyze_song and render_audio.

Model:
- Channels are instruments (type "sf" SoundFont, "synth", "fm", "organ", "pluck", "sfx", "drum", "sampler"), each with a role (kick, snare, hat, bass, chords, pad, arp, lead, fx …). Each channel plays into a mixer track (0 = master, 1-125 = inserts).
- Patterns hold notes per channel. The playlist places pattern, audio and automation clips on 125 tracks. In "pattern" mode the transport loops the selected pattern; in "song" mode it plays the playlist.
- Time is measured in steps: 1 step = a 16th note, 4 steps = 1 beat, 16 steps = 1 bar (4/4 only). Note starts and lengths, clip positions and the loop are all in steps and may be fractional.
- Pitch is a MIDI number or a note name such as "C5". OpenStudio names MIDI 60 "C5" (FL Studio style), so C4 = 48 and C6 = 72. Drum kits map pieces to keys: see list_catalog kind "drum_kits"; single-piece drum channels take any pitch (use 60).
- Volumes and pans: channel vol 0-1 (default 0.78), mixer vol 0-1 (0.8 = 0 dB, 1 = +6 dB), pan -1 (left) to 1 (right).

Working well:
- Start with get_project to see the current state, and list_catalog to find instruments, presets, effects and parameter ranges.
- Every mutating call is one undo step for the user (undo / redo tools mirror Ctrl+Z / Ctrl+Y). Do not discard the user's unsaved work: new_project, open_project, setup_song and build_song refuse unless you save first or pass force / clear.
- Prefer compose / set_notes / add_notes with many notes at once over many single calls.
- Check the result: analyze_song for the writing, render_audio for the sound, screenshot for the UI.
- Use transport to play and stop; playback goes to the user's speakers.`;
