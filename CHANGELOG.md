# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/)
and the project uses [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

### Performance
- Undo history is capped by memory (~190 MB) as well as by steps, so big projects can't exhaust memory.
- Autosave stores samples as raw buffers instead of re-encoding every sample to base64 every 30 seconds.

### Fixed
- The Compressor added up to ~10 dB of hidden gain (Web Audio's automatic makeup) on top of its Makeup knob; it is now
  unity below the threshold and Makeup is the real makeup. Projects that relied on it will play quieter — raise
  Makeup. The Limiter now holds its ceiling exactly instead of overshooting by up to 1 dB.
- Duplicating, copying and pasting notes keeps their mute state (and the new per-note pan and fine pitch).

### Added
- **Open FL Studio projects (.flp)** from File → Open (FL Studio 11.5 – 21): channels, patterns and every note (with
  velocity, per-note pan and fine pitch), the playlist arrangement with track names, colours and muted tracks, tempo, and
  the mixer (insert names, colours, faders, pan, routing and recognisable effects). Layer channels play their children.
  FL-only plugins get a built-in stand-in chosen from the plugin and channel name (3x Osc → synth, Sytrus → FM, a "Pad"
  VST → a pad sound, "Kick" → the kick voice …); samples are found beside the project or in the FL Studio install, and
  audio clips whose file is missing are played by the stand-in. A report lists what was substituted. Agents can do the
  same with `open_project`.
- Notes can carry their own **pan** and **fine pitch** (cents).
- **Tempo automation**: right-click the tempo display → Create automation clip (or an agent's `create_automation` with
  target `{ kind: "tempo" }`). Playback, export, the song clock and the position slider all follow the tempo curve, and
  the tempo display shows the current tempo while the song plays. After a tempo clip ends the song keeps its last tempo.
- **Time signatures** (2/4, 3/4, 5/4, 6/8, 7/8, 12/8 … any n/2, n/4, n/8, n/16): the box beside the snap selector in the
  toolbar, or `set_project` `timeSig`. Bars, beats, grid lines, rulers, snapping, the bar:beat clock, the metronome,
  channel-rack pad groups and pattern lengths follow it; MIDI files carry it both ways, as do FL Studio projects.
  Changing it keeps every note where it is.
- **Piano-roll tools** (Tools menu): Arpeggiate (Alt+A: up, down, up-down, random; rate, gate, octaves), Strum (Alt+S),
  Chop (Alt+U), Flam, Articulate (staccato / short / tenuto), Snap pitches to scale, Limit to range, velocity fade
  in / out. Agents get the same through `transform_notes`.
- The piano roll's event lane switches between **Velocity, Pan and Fine pitch** (click its label).
- **Audio recording**: arm Record with Options → Record → "Audio into the playlist" (or right-click the record button),
  press Play, and the take lands in the playlist as an audio clip where you started, on a free track named "Audio".
  Takes are kept as lossless 32-bit float WAV, compensated for output latency, and undoable; pick the device under
  Options → Audio input. Record can capture notes, audio or both.
- **Sampler**: root note, end point and a loop region (all draggable on the waveform), and **slicing** like FL Studio's
  Slicex — auto-slice at the hits (sensitivity presets), equal slices, or add / move / remove slice lines by hand;
  each slice plays from the root key up, and "Slices → pattern" writes the loop back as notes so it follows the tempo.
  Agents get `slice_sample`.
- **FLAC export** (File → Export audio (FLAC, lossless)…): about half the size of WAV, bit-identical audio. Agents
  can write `.flac` from `render_audio`.
- **File → Open recent**: the last 12 projects you opened or saved (also FL Studio projects); missing files are hidden.
- **Sample folders in the browser**: add the folders where your samples live (Browser → Sample folders → Add a
  folder…), browse them, click a file to hear it, double-click to make a sampler channel, or drag it into the playlist
  (an audio clip) or the channel rack (a new sampler, or onto a sampler to swap its sample). The app can only read
  audio files inside folders you added.
- The synth has **Mono / legato** and **Glide** (portamento): overlapping notes slide into each other without
  retriggering — 808 glides — with a new "808 Glide" preset.
- **Link to controller** (MIDI learn): right-click any knob, fader, effect parameter or the tempo → "Link to
  controller…", then move a knob or fader on your MIDI controller. Links are saved with the project, each gesture is
  one undo step, and Options → MIDI controller links lists and removes them.
- Mixer meters show a **peak hold** line and a latched **clip** indicator (click a meter to reset). Right-click a
  track with another one selected to **route the selected track into it** (only, or as an extra send), as in FL Studio.
- **Wavetable synth**: six morphing tables (basic shapes, pulse width, harmonic sweep, vowels, digital, organ drawbars)
  with a position envelope and LFO, unison and a filter, plus 8 presets (Morph Pad, Choir Vowels, Growl Bass …).
- **Volume shaper**: tempo-synced pumps and gates (Pump 1/4 and 1/2, Gate 1/8 and 1/16, Offbeat, Trance 3+3+2,
  Stutter 1/32) with depth and smoothing — locked to the song by the scheduler, in playback and export alike.
- **Sidechain compressor**: duck a track from another mixer track's output (the kick pumping the bass and pads):
  pick the key input in its effect window; threshold, ratio, maximum reduction and release. The **Gate** now has a
  real envelope follower (instant open, hold, release) instead of a smoothed average.
- **Playlist**: named **time markers** (right-click the ruler: add, jump to, loop between markers; click a marker to
  jump, double-click to rename), **Split by channel** for pattern clips, and audio-clip **gain, fade in / out and
  reverse** (right-click an audio clip). Agents: `markers`, `edit_clips` split_by_channel, `update_clips` fades.
- **Export stems** (File menu, Ctrl+Shift+R): one WAV per used mixer track (post-fader) plus the master, into a folder
  you pick — FL Studio's "split mixer tracks". Rendered in one pass for up to 15 tracks. Agents: `export_stems`.
- **Effect windows**: clicking an effect in the mixer opens its editor in its own window (like FL Studio's plugin
  windows), with a power switch and Reset.
- **New effects**: a 7-band **Parametric EQ** with a response graph you drag directly (wheel = Q, double-click = reset)
  over a live spectrum; a **Spectrum analyser**; a **Gate**; a 3-band **Multiband compressor**; and a **ping-pong**
  mode for the Delay.
- Exported MIDI files include tempo automation as tempo changes.
- Mixer inserts can be taken **off the master** (Sends → "→ Master"), as in FL Studio, so a track can feed a bus only.

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
