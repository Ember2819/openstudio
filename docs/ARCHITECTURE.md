# Architecture

OpenStudio is an Electron app whose renderer is plain ES modules (no bundler). The audio engine is built on the
Web Audio API; everything is driven by one project model.

```
              ┌────────────┐   events    ┌────────────┐
 UI windows ─▶│   Store    │────────────▶│  UI / Engine│
 (src/ui)     │ (state.js) │             │  listeners  │
              └─────┬──────┘             └────────────┘
                    │ project data
              ┌─────▼──────┐  schedules   ┌──────────────┐
              │ Transport  │─────────────▶│    Engine    │──▶ speakers
              │(transport) │  notes/clips │ (engine.js)  │
              └────────────┘              └──────────────┘
```

## Process model
- `main.js` (Electron main): creates the window, file dialogs, reads bundled assets, MIDI permission. It also
  contains the dev-only screenshot/eval harness (active only with `--screenshot`).
- `mcp/`: the MCP server for AI agents (`server.js` protocol, `bridge.js` main↔renderer wiring). See
  [AGENTS.md](AGENTS.md).
- `updater.js` (+ the `update:*` handlers in `main.js`): in-app updates. Releases are tagged
  `v<version>-build<run number>` by `release.yml`, which also stamps `buildinfo.json` (via
  `scripts/stamp-build.mjs`) so a packaged app knows its own build number. The renderer UI is `src/ui/updater.js`; it
  never passes URLs to the main process, which only downloads the asset found by its own last check.
- `preload.js`: exposes a small `window.studioAPI` bridge (`contextIsolation` on, `nodeIntegration` off).
- `src/main.js` (renderer entry): builds the `app` object — store, engine, transport, window manager, actions —
  and creates each window. `window.openstudio` exposes it for debugging and tests.

## The project model (`src/state.js`)
One plain JSON object, `store.project`:

| Field | Meaning |
| --- | --- |
| `channels[]` | Instruments: `type` is `sf` (SoundFont), `synth`, `sampler` or `drum`; volume, pan, mixer track, params |
| `patterns[]` | `notes[channelId] = [{ p, s, l, v, m? }]` — pitch, start and length in **steps** (16th notes), velocity, mute |
| `playlist` | 125 `tracks[]` and `clips[]` of type `pattern`, `audio` or `auto` (start/len in steps) |
| `automations[]` | A target descriptor plus curve points (`x` in steps, `y` normalised 0–1) |
| `mixer[]` | Track 0 is master, 1–125 inserts: volume, pan, mute/solo, 10 FX slots, sends |
| `loop`, `swing`, `bpm`, `timeSig`, `mode` | Transport-level settings |

Conventions worth knowing:
- Time is measured in **steps** (16th notes). A bar is `barSteps(project)` steps: 16 in 4/4, 12 in 3/4 and 6/8
  (`project.timeSig`). The agent's composing code (`src/agent/music/`) writes 4/4.
- Tempo can be automated (target `{ kind: 'tempo' }`); `src/tempo.js` maps steps to seconds for the scheduler,
  offline renders and clocks.
- Pitch uses FL-style octave naming: MIDI 60 is **C5**.
- The channel rack's step pads *are* notes: a pad is lit when a note starts within that step.
- Samples (`store.samples`) live outside `project` so undo snapshots stay small; they are embedded in saved files.

**Undo/redo** is snapshot based: call `store.checkpoint()` once *before* a mutation (typically on pointer-down),
mutate freely, then `store.emit(...)`. Undo restores a JSON snapshot and emits `project`, which every window
handles by rebuilding.

**Events** (`store.on(name, fn)`): `project` (full replace), `channels` (structural; rebuilds the rack),
`channelMix` (volume/pan drag — does *not* rebuild), `patterns`, `notes`, `selection`, `playlist`, `mixer`,
`loop`, `sampleReady`, `soundfontReady`.

## Audio (`src/audio/`)
- `engine.js` — owns the `AudioContext`. Graph: *channel gain → pan → mixer track input → [FX chain] → pan →
  fader → mute gate → master*. Sends tap the gate and feed another track's input. `playNote()` dispatches to a
  voice implementation and tracks voices (pruned by end time, stolen over 160). `playAudio()` plays audio clips.
- `transport.js` — a look-ahead scheduler (25 ms timer, 120 ms horizon). `scheduleStep()` fires everything that
  starts on a step and is shared with offline export, so exported audio matches playback. UI positions are
  derived from the audio clock, not from timers.
- `sf2.js` — SoundFont 2 parser; resolves presets into flat *regions* (sample + generators).
  `soundfont.js` plays regions with buffer sources, filter, envelope, LFOs and exclusive-class choking.
- `instruments.js` — parameter metadata (which drives the settings window, automation and agent validation) and
  the preset libraries of every generator; the voices live beside it: `synths.js` (subtractive, FM, organ,
  Karplus-Strong plucked strings), `drums.js` (26 synthesized drum voices), `sfx.js` (risers, impacts, textures),
  and `dsp.js` (shared noise, band-limited custom waveforms, envelopes). `effects.js` — effect factories and their
  parameter metadata. Mixer strips are built the first time something uses them (`engine.track(i)`).
- `catalog.js` — instrument/drum-kit catalogue built from the loaded SoundFont. `wav.js` — WAV encoder.
- `render.js` — offline rendering for export. It schedules steps just ahead of the render position with
  `OfflineAudioContext.suspend()`, so parameter automation lands on the right step exactly as in live playback.

The bundled SoundFont is loaded through the main process (`asset:read`) and shared between the live engine and
the offline engine used for export.

## Automation (`src/automation.js`)
Targets are JSON descriptors (`{ kind: 'mixer', track, param }`, `fx`, `channel`, `chparam`). Knobs opt in with a
`target` option; right-click → *Create automation clip*. During song playback `scheduleStep` evaluates each
automation clip and ramps the matching `AudioParam` (or sets the effect parameter).

## Files and safety nets
- `midifile.js` writes Standard MIDI Files; `midiimport.js` reads them (type 0/1, running status, RMID) and
  imports one channel per track/MIDI channel into a new pattern (channel 10 becomes a drum kit).
- `autosave.js` writes unsaved work to IndexedDB every 30 s and offers to recover it on the next start.
- `Store.load()` repairs missing or invalid fields so old and hand-edited projects open safely.

## UI (`src/ui/`)
- `windows.js` — floating window manager (drag, resize, maximize, persisted layout).
- Each window is a module exporting `createX(app)`; canvas-based editors (piano roll, playlist, automation)
  use an invisible native scroller for scrolling and draw only the visible region.
- `knob.js`, `menu.js`, `dialog.js`, `snapselect.js` — shared controls. Colours come from `styles/theme.css`.

## Agents (`src/agent/`, `mcp/`)
The project lives in the renderer, so the MCP server (main process) only relays: the renderer registers its tool
definitions and executes calls (`src/agent/index.js`, one at a time) against the same `Store`/`Transport`/`Engine`
the UI uses. Tools wrap mutations in `edit()` — one undo step, rolled back if the call fails — and emit the usual
store events, so windows update as an agent works. `render_audio` reuses the offline renderer and analyses the
result (`analysis.js`, per-channel `stems.js`). Details in [AGENTS.md](AGENTS.md).

`src/agent/music/` is the music knowledge the producer tools stand on, as pure functions (no audio, no DOM):
`theory.js` (keys, scales, chord symbols and roman numerals, voice-led voicings, a seeded PRNG), `styles.js` (12
styles — grooves, bass and chord rhythms, instrument casts, mix roles — plus progressions and song forms),
`generate.js` (drums, bass, chords, pads, arpeggios and melodies as note lists), `critique.js` (the notes-only
song critic), `roles.js`, `mixing.js` (role-based mixer setup) and `session.js` (resolves key / style / progression
and writes a channel's part). Every generated note is fitted inside its pattern, and the same seed gives the same music.

## Testing
- `test/*.test.mjs` — `node:test` unit tests for DOM-free modules (store, automation, MIDI writer, SoundFont parser).
- `test/music-*.test.mjs` — theory, generators (every style: in key, in range, on the chord roots, deterministic) and the critic.
- `test/agent-*.test.mjs`, `test/mcp-server.test.mjs` — the agent tools (real Store, stub engine) and the MCP server
  (checked with the official MCP client). `scripts/e2e-mcp.mjs` drives the real app through MCP.
- `test/e2e/*.js` — run inside the real app via `scripts/e2e.mjs`: `smoke.js` (playback levels, effects, sends,
  automation, audio clips, save/load, offline render) and `voices.js` (every drum voice and preset rendered offline:
  audible, finite, in tune).
