# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/)
and the project uses [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

## [0.5.0]

### Changed
- Releases now build automatically after a version-bump change reaches `main`, and the release workflow rejects duplicate or
  non-increasing package versions.

## [0.4.0]

### Added
- **Agents write songs, not loops.** A producer toolset for MCP agents: `setup_song` (12 styles → instruments, routing, reverb and
  delay buses, master chain), `build_song` (a full arrangement in a real song form with fills, crashes, risers and impacts),
  `compose` (key-aware drums, bass, voice-led chords, arpeggios and motif-based melodies), `arrange`, `analyze_song` (a critic that
  works from the notes: key, chords per bar, register clashes, dynamics, form, repetition — each warning with a fix), `auto_mix`
  (role-based mix, calibrated from per-channel stem renders), `music_theory` and `songwriting_guide`. `render_audio` can report
  per-channel stems and masking. The server instructions teach the workflow. See [docs/AGENTS.md](docs/AGENTS.md).
- **New instruments:** FM synth, tonewheel organ (drawbars, percussion, rotary), Karplus-Strong plucked strings (guitar, harp, koto,
  banjo, …) and a Sound FX generator (risers, impacts, sweeps, whooshes, lasers, vinyl crackle, ocean, …), each with presets;
  ~25 new synth presets; the subtractive synth gains a sub oscillator, noise, 24 dB filter, key tracking, drive, vibrato, filter LFO and
  seven new waveforms (pulse widths, vocal, reed, glass, organ, hollow).
- **13 new synthesized drum voices:** 808 and punchy kicks, 808 and fat snares, snap, rimshot, conga, bongo, wood block, triangle,
  cabasa, pedal hat, ride bell (26 in total). Drum noise starts at a random point each hit, so hats no longer repeat sample-identically.
- Transport: a back-to-start button, a solid green Play while running (ring while paused), a PLAYING / PAUSED / STOPPED indicator,
  and a song-position slider in the second toolbar row — click or drag to jump, arrow keys to nudge, with elapsed and total time,
  bar lines and the loop region. In pattern mode it follows the pattern.
- Channel settings: a preset menu for every generator, and the window grows to show all of a big engine's controls.
- Channels have a `role` (kick, bass, chords, pad, lead, fx …) that agents use; it is guessed from the instrument when unset.
- `npm run test:e2e` renders every drum voice and preset offline and checks level, NaN and tuning.

### Fixed
- Linux AppImages ship a statically-linked runtime, so downloads run without `libfuse2` installed.
- Undo and redo no longer stop playback.
- A 100% wet effect (send buses) is now fully wet; before, 30% of the dry signal always leaked through.

### Performance
- The audio engine builds mixer strips on first use instead of all 126 up front (~1,100 audio nodes, including 252 analysers the
  browser keeps processing, for every project and every offline render).
- The scheduler computes each pattern's length once per tick, not once per clip per step (every note was visited each time).
- Offline renders can cover a window of the song, so analysis of one section does not render the whole thing.

- First-launch welcome dialog: recommends tiling mode (floating stays the default) and points to Settings, update checks and the MCP server.

### Changed
- Existing synth channels get key tracking (0.3), so cutoff follows the note a little: bass and high notes of one patch are closer in brightness.
- Exporting audio shows a progress bar with a percentage, and the export can be cancelled.
- Menu-bar menus (File, Edit, View…) open on hover instead of needing a click, and close by themselves when the pointer leaves both the word and its menu.
- The project-name box in the toolbar is the same height as the snap and pattern controls.
- The toolbar's project-name box shows only the project name; hover hints are a tooltip beside the cursor instead of text inside that box.
- Help → Agents (MCP server)… opens Settings → Agents instead of a dialog.
- Update check failures against a private repository now say so.

### Removed
- The "Agents ready" indicator in the toolbar (Help → Agents (MCP server)… is unchanged).

## [0.3.0]

### Added
- Tiling window manager mode modelled on niri (**Alt+T**): windows tile in columns on a sideways-scrolling strip and are driven
  from the keyboard. Each window type has a preferred shape and a content-aware ideal size, so the window you are working in
  grows to fit and the rest make room; windows open next to the ones they belong with. Every binding, the modifier key, gaps
  and behaviour are configurable in **Settings → Windows & keys**.
- Theming: every interface colour is derived from a theme's base colours. 12 preset themes (including light ones),
  10 accent palettes and custom colours in a new **Settings** drawer (gear button, **Ctrl+,**).
- Wallpapers: 8 preset images, gradients, solid colours or your own image (with fit, dim and blur), plus
  **Theme from wallpaper**, which builds a matching theme from the image's colours.
- MCP server (Streamable HTTP on `127.0.0.1:6736/mcp`, plus a stdio bridge) with tools for everything a person can do:
  projects and files, transport, channels, patterns and notes, playlist, mixer and effects, automation, MIDI import/export,
  offline rendering with audio analysis, screenshots and window control. Every call is an undo step. See `docs/AGENTS.md`.
- Four new drum kit voices (ride, shaker, tambourine, clave) and 13 new synth presets across three new families (Keys, Bells, Brass), including Supersaw, Acid Bass and Choir Pad.
- Toolbar indicator and Help → Agents dialog for the MCP server.
- In-app updates: **Help → Check for updates…** (and a quiet check on startup) finds the newest GitHub release and installs it in one click — the AppImage / Windows portable exe is replaced in place and the app restarts; macOS opens the downloaded .dmg. Downloads are verified against GitHub's SHA-256 digest.

### Changed
- Mixer: the dB scale sits in its own column at positions that match the fader curve, and faders and meters stretch with the window.
- Slim overlay scrollbars keep the piano keys, track headers and mixer master strip aligned with their grids; the mouse wheel
  scrolls the mixer and editor toolbars sideways, so no touchpad is needed.
- Toolbars never wrap: the main toolbar hides lower-priority items on narrow windows (it fits from 960 px), editor
  toolbars scroll. Windows also shrink in height with the app window, and default layouts always open fully on screen.
- The keyboard shortcuts page (F1) is grouped into sections with key caps and lists the tiling bindings.

### Fixed
- MCP server: replies now wait until the request body has been fully read (unread bodies are drained, up to a 64 MB cap), so one rejected or oversized request can no longer reset the keep-alive connection and take the client's next request down with it; oversized requests get a 413, and JSON-RPC ids that are not strings or numbers are rejected with a protocol error.
- MCP stdio bridge: forwarded requests time out after six minutes (override with `OPENSTUDIO_MCP_TIMEOUT_MS`) instead of hanging forever when the app dies mid-call.

## [0.2.0]

### Added
- SoundFont engine with 261 General MIDI instruments and 13 drum kits (GeneralUser GS), including a kit-aware piano roll.
- Audio clips (with waveforms), automation clips and an automation editor, playlist loop region, swing.
- Mixer sends with feedback protection; chorus, phaser, limiter and stereo-width effects; a better reverb.
- Piano roll mute/slice tools, quantize and scale highlighting; synth unison.
- MIDI keyboard input and MIDI file export.
- Unit tests, an end-to-end smoke test, ESLint and CI; open-source project files.

### Changed
- Flat, calmer UI with one consistent icon set; master meter and audio status in the toolbar.
- Application moved to the repository root; the large instrument bank is downloaded with `npm run assets`.

## [0.1.0]

### Added
- First playable version: toolbar, channel rack, piano roll, playlist, mixer, browser, synthesized drums and synth,
  undo/redo, project files and WAV export.
