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
| `loop`, `swing`, `bpm`, `mode` | Transport-level settings |

Conventions worth knowing:
- Time is measured in **steps**; 4 steps = 1 beat, 16 steps = 1 bar. Only 4/4 is supported.
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
- `instruments.js` — built-in synth, sampler and synthesized drums plus the parameter metadata that drives the
  settings window. `effects.js` — effect factories and their parameter metadata.
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
result (`analysis.js`). Details in [AGENTS.md](AGENTS.md).

## Testing
- `test/*.test.mjs` — `node:test` unit tests for DOM-free modules (store, automation, MIDI writer, SoundFont parser).
- `test/agent-*.test.mjs`, `test/mcp-server.test.mjs` — the agent tools (real Store, stub engine) and the MCP server
  (checked with the official MCP client). `scripts/e2e-mcp.mjs` drives the real app through MCP.
- `test/e2e/smoke.js` — runs inside the real app via `scripts/e2e.mjs` (playback levels, effects, sends,
  automation, audio clips, save/load, offline render).
