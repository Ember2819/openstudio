'use strict';
// Sent to MCP clients on `initialize`; most agents put this straight into their context.

module.exports = `OpenStudio is a pattern-based digital audio workstation (channel rack, piano roll, playlist, mixer). These tools drive the app that is running on the user's machine: everything a person can do with the mouse and keyboard can be done here, and the user sees your changes live in the window.

Start with get_project to see the current state, and list_catalog to find instruments, synth presets, effects and parameter ranges.

Model:
- Channels are instruments (type "sf" SoundFont, "synth", "drum", "sampler"). Each channel plays into a mixer track (0 = master, 1-125 = inserts).
- Patterns hold notes per channel. The playlist places pattern, audio and automation clips on 125 tracks. In "pattern" mode the transport loops the selected pattern; in "song" mode it plays the playlist.
- Time is measured in steps: 1 step = a 16th note, 4 steps = 1 beat, 16 steps = 1 bar (4/4 only). Note starts and lengths, clip positions and the loop are all in steps and may be fractional.
- Pitch is a MIDI number or a note name such as "C5". OpenStudio names MIDI 60 "C5" (FL Studio style), so C4 = 48 and C6 = 72. Drum kits map pieces to keys: see list_catalog kind "drum_kits".
- Volumes and pans: channel vol 0-1 (default 0.78), mixer vol 0-1 (0.8 = 0 dB, 1 = +6 dB), pan -1 (left) to 1 (right).

Working well:
- Every mutating call is one undo step for the user (undo / redo tools mirror Ctrl+Z / Ctrl+Y). Do not discard the user's unsaved work: new_project and open_project refuse unless you save first or pass force.
- Prefer set_notes / add_notes with many notes at once over many single calls.
- You cannot hear the result directly. Use render_audio (levels, loudness over time, spectral balance, clipping) to check the mix, and screenshot to see the UI.
- Use transport to play and stop; playback goes to the user's speakers.`;
