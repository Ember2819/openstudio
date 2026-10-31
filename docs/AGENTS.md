# Working with AI agents (MCP)

OpenStudio runs a [Model Context Protocol](https://modelcontextprotocol.io) server, so any MCP-capable agent
(Claude Code, Claude Desktop, Cursor, Codex, your own) can work on a project the same way you do: write notes,
build the arrangement, mix, add effects, automate, render and export. There is nothing agent-specific to learn —
it is a plain MCP server exposing tools.

Everything an agent does goes through the same model the UI uses, so you watch the edits happen live, and every
call is one step on your undo stack (**Ctrl+Z** undoes an agent's edit). The toolbar shows what the agent is doing.

## Connect

Start OpenStudio (`npm start`). It listens on `http://127.0.0.1:6736/mcp` (Streamable HTTP, this computer only).

**Claude Code**
```bash
claude mcp add --transport http openstudio http://127.0.0.1:6736/mcp
```

**OpenCode** — add to `~/.config/opencode/opencode.json` (or `opencode.json` in a project), then restart OpenCode
```json
{ "$schema": "https://opencode.ai/config.json", "mcp": { "openstudio": { "type": "remote", "url": "http://127.0.0.1:6736/mcp", "enabled": true } } }
```

**Easiest:** Settings → *Agents* has a **Copy quickstart** button for Claude Code and for OpenCode. Paste the copied
prompt into the agent and it registers the server in its own config for you.

**Clients that take a JSON config** (Cursor, VS Code, …)
```json
{ "mcpServers": { "openstudio": { "url": "http://127.0.0.1:6736/mcp" } } }
```

**Clients that only speak stdio** (e.g. Claude Desktop) — `scripts/mcp-stdio.mjs` bridges stdio to the endpoint, and
with `--launch` starts OpenStudio for you if it is not running:
```json
{ "mcpServers": { "openstudio": { "command": "node", "args": ["/path/to/openstudio/scripts/mcp-stdio.mjs", "--launch"] } } }
```

Help → *Agents (MCP server)…* (Settings → Agents) shows the live endpoint.

| Setting | How |
| --- | --- |
| Turn the server off | `--no-mcp` or `OPENSTUDIO_MCP=0` |
| Another port (0 = any free one) | `--mcp-port=N` or `OPENSTUDIO_MCP_PORT=N` (the port is printed on start-up: `[mcp] listening on …`) |
| Another URL for the stdio bridge | `--url …` or `OPENSTUDIO_MCP_URL` |

## Making a song: the producer workflow

Agents get the best results by working like a producer, and the tools are built for that. You cannot hear what you
are making, so the tools write music that is in key and in time, and measure what you cannot judge by ear.

```
 setup_song ──▶ build_song ──▶ analyze_song ──▶ (refine: compose, set_notes, automation) ──▶ auto_mix ──▶ render_audio ──▶ save_project
   style, key     whole song      key, chords, register,      another seed / energy / density            balance from        levels, clipping,
   instruments    in sections     dynamics, form, fixes       for the weak parts only                    stem renders        spectrum, stems
```

| Step | Tool | What it does |
| --- | --- | --- |
| Learn | `songwriting_guide`, `music_theory` | The producer's handbook (workflow, harmony, melody, rhythm, arrangement, sound, mixing, checklist), and lookups so no pitch has to be computed by hand: keys and their chords, named progressions, styles, song forms, registers |
| Start | `setup_song` | A style (house, techno, trance, trap, hip-hop, lo-fi, pop, rock, drum & bass, synthwave, funk, ambient) becomes instruments (drums as separate channels, bass, chords, pad, arp, lead, riser and impact), each on its own mixer track with level, pan, high-pass, compression, shared reverb and delay buses, a master chain, tempo and swing |
| Write | `build_song` | A complete first draft in a real form (intro, verse, chorus, bridge, outro; or intro, build, drop, breakdown, drop, outro): patterns per section with rising energy, drum fills, crashes, risers and impacts, clips placed on named playlist tracks |
| Write | `compose` | Generate parts into a pattern: drums with accents, ghost notes and fills; bass following the chord roots; voice-led chords and pads; arpeggios; melodies built from a motif that is answered and resolved. Same seed, same music |
| Arrange | `arrange` | Lay existing patterns out as sections, bar by bar |
| Review | `analyze_song` | Works from the notes: detected key and how much of the music stays in it, chord per bar, whether the bass follows, register clashes, flat velocities, the energy curve, missing intro / ending / variation, and a fix for each |
| Mix | `auto_mix` | Role-based mix, then (calibrate) renders the loudest bars once per channel and corrects the faders; reports the levels it measured |
| Listen | `render_audio` | Levels, clipping, loudness over time, spectral balance; `stems: true` adds a per-channel breakdown with masking warnings |

## What agents can do

Time is measured in **steps**: 1 step = a 16th note, 4 = a beat, 16 = a bar (4/4 only). Pitches are MIDI numbers
or note names in OpenStudio's octave naming, where **MIDI 60 = C5**. Channels, patterns, clips and automations are
referred to by id (channels and patterns also by unique name).

| Area | Tools |
| --- | --- |
| Producer | `songwriting_guide`, `music_theory`, `setup_song`, `build_song`, `compose`, `arrange`, `analyze_song`, `auto_mix` (see above) |
| Project | `get_project`, `set_project` (name, tempo, time signature, swing, master pitch, pattern/song mode, loop, metronome), `new_project`, `open_project` (also imports FL Studio `.flp`), `save_project`, `import_midi`, `export_midi`, `history` (undo/redo) |
| Transport | `transport` (play, pause, stop, seek by step or bar, status) |
| Discover | `list_catalog` (General MIDI instruments, drum kits and pieces, presets of the five built-in generators, synthesized drum voices, effects, channel parameters, automation targets) |
| Channels | `add_channel` (instrument, drum_kit, synth, fm, organ, pluck, sfx, wavetable, drum, sampler), `update_channel` (also `role`, and `preset` for the built-in generators), `manage_channel` (remove, clone, move, select, route to a free mixer track), `preview_note`, `import_sample`, `slice_sample` (Slicex-style slicing, slices → pattern), `set_zones` (multi-sample key / velocity zones) |
| Patterns & notes | `get_pattern`, `add_pattern`, `update_pattern`, `pattern_action`, `set_notes`, `add_notes`, `set_steps` (step-sequencer grid strings), `remove_notes`, `transform_notes` (transpose, shift, quantize, legato, velocity, humanize, duplicate, reverse, mute, arpeggiate, strum, chop, flam, snap to scale, articulate, limit, velocity ramp); notes can carry `pan`, `fine` (cents), `modX` / `modY` (cutoff / resonance) and `slide` |
| Playlist | `get_playlist`, `add_clips` (pattern, audio, automation), `update_clips` (incl. audio gain, fades, reverse), `edit_clips` (remove, duplicate, make unique, fit, split by channel, render to audio, mute), `update_playlist_track`, `markers` (named time markers, jump, loop between them) |
| Mixer | `get_mixer_track`, `update_mixer_track` (incl. `toMaster`), `set_effect`, `move_effect`, `set_send`, `reset_mixer` |
| Automation | `create_automation` (any knob, fader, effect or instrument parameter, or the tempo), `get_automation`, `update_automation`, `remove_automation` |
| Hear & see | `render_audio` (offline render + analysis: peak/RMS/crest, clipping, loudness per bar, spectral balance, warnings; optional WAV file; optionally one channel soloed; `stems` per-channel breakdown), `export_stems` (one WAV per mixer track + master), `screenshot`, `show_window`, `set_selection` |

### Instruments

Every channel is one of:

| Type | What it is |
| --- | --- |
| `instrument`, `drum_kit` | The bundled General MIDI SoundFont: 128 melodic instruments with variations and 13 real drum kits |
| `synth` | Subtractive synth: two oscillators from 11 waveforms (including pulse widths, vocal, reed, glass), unison, sub oscillator, noise, 12 / 24 dB filter with key tracking, drive, vibrato and filter LFO; ~50 presets (basses, leads, pads, stabs, arps, plucks, bells) |
| `fm` | Three-operator FM with a decaying modulation index and tremolo: electric pianos, mallets, bells, bass, pads, brass |
| `organ` | Tonewheel organ: nine drawbars, percussion, key click and a rotary speaker |
| `pluck` | Karplus-Strong plucked strings (nylon and steel guitar, harp, koto, banjo, mandolin, pizzicato, upright bass) |
| `sfx` | Sound effects: risers, downlifters, tonal swells, noise sweeps, whooshes, reverse crashes, impacts, booms, bass drops, lasers, zaps, droplets, sirens, wind, ocean, vinyl crackle, sparkle, tape stop. A riser as long as its note |
| `drum` | 26 synthesized drum voices (808 / punchy / acoustic-style kicks and snares, claps, snaps, rimshots, hats, toms, congas, bongos, cowbell, wood block, triangle, cabasa, shakers, cymbals) |
| `sampler` | Plays an audio file |

### Safety rails

- `new_project` and `open_project` refuse to discard unsaved changes unless the agent passes `force: true`.
- Arguments are validated against each tool's JSON Schema; unknown fields and out-of-range values come back as
  clear errors, and a call that fails halfway leaves the project untouched.
- File tools take absolute paths (`~/` works) and read/write only what the user running OpenStudio can.

### Security model

The server binds to `127.0.0.1` only, rejects any request whose `Host` is not a loopback name (DNS rebinding) or
that carries a non-local `Origin` (web pages), and sends no CORS headers, so websites cannot drive it. There is no
authentication beyond that: any program running as you on this machine can connect, and it can open and save
project files and export audio anywhere you can write. Use `--no-mcp` if that is not acceptable.

## How it works

```
 agent ── HTTP /mcp ──▶ mcp/server.js ──▶ mcp/bridge.js ──IPC──▶ src/agent (renderer) ──▶ Store / Transport / Engine
        (JSON-RPC)      (protocol)        (main process)          (tool definitions)        (the app itself)
```

- `mcp/server.js` — dependency-free, stateless Streamable HTTP implementation of MCP (initialize, ping, tools).
- `mcp/bridge.js` — wires the server to the window: the renderer registers its tools, the main process forwards
  calls, adds `screenshot`, and provides path-based file access in place of the human file dialogs.
- `src/agent/` — the tools. One file per area in `src/agent/tools/`; `schema.js` validates arguments;
  `analysis.js` powers `render_audio`.

### Roles

Every channel has a role (`kick`, `snare`, `clap`, `hat`, `openhat`, `perc`, `tom`, `crash`, `ride`, `drums` for a whole kit, `bass`, `chords`, `stabs`, `pad`, `arp`, `lead`, `fx`). `setup_song` sets them; otherwise they are guessed from the instrument and name, and `update_channel` can set one. `compose`, `build_song`, `auto_mix` and `analyze_song` use roles to decide what each channel plays and how it is mixed.

### Adding a tool

Add an entry to the `tools` array of the matching file in `src/agent/tools/`:

```js
{
  name: 'my_tool',
  title: 'My tool',
  description: 'What it does, in terms an agent can act on (units, ranges, side effects).',
  inputSchema: obj({ channel: ref('Channel'), amount: num('0-1', { minimum: 0, maximum: 1 }) }, ['channel']),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  run(args, app) { return edit(app.store, () => { /* mutate, emit events */ return { … }; }); },
}
```

Wrap mutations in `edit()` (one undo step, rolled back on error), resolve and validate every reference *before*
changing anything, emit the same store events the UI would, and return compact JSON. Cover it in
`test/agent-tools.test.mjs` (headless, with the real Store) and run `npm run test:e2e:mcp` for the real thing.
