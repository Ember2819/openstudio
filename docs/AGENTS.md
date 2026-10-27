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

## What agents can do

Time is measured in **steps**: 1 step = a 16th note, 4 = a beat, 16 = a bar (4/4 only). Pitches are MIDI numbers
or note names in OpenStudio's octave naming, where **MIDI 60 = C5**. Channels, patterns, clips and automations are
referred to by id (channels and patterns also by unique name).

| Area | Tools |
| --- | --- |
| Project | `get_project`, `set_project` (name, tempo, swing, master pitch, pattern/song mode, loop, metronome), `new_project`, `open_project`, `save_project`, `import_midi`, `export_midi`, `history` (undo/redo) |
| Transport | `transport` (play, pause, stop, seek by step or bar, status) |
| Discover | `list_catalog` (General MIDI instruments, drum kits and pieces, synth presets, drum voices, effects, channel parameters, automation targets) |
| Channels | `add_channel` (instrument, drum_kit, synth, drum, sampler), `update_channel`, `manage_channel` (remove, clone, move, select, route to a free mixer track), `preview_note`, `import_sample` |
| Patterns & notes | `get_pattern`, `add_pattern`, `update_pattern`, `pattern_action`, `set_notes`, `add_notes`, `set_steps` (step-sequencer grid strings), `remove_notes`, `transform_notes` (transpose, shift, quantize, legato, velocity, humanize, duplicate, reverse, mute) |
| Playlist | `get_playlist`, `add_clips` (pattern, audio, automation), `update_clips`, `edit_clips` (remove, duplicate, make unique, fit, mute), `update_playlist_track` |
| Mixer | `get_mixer_track`, `update_mixer_track`, `set_effect`, `move_effect`, `set_send`, `reset_mixer` |
| Automation | `create_automation`, `get_automation`, `update_automation`, `remove_automation` |
| Hear & see | `render_audio` (offline render + analysis: peak/RMS/crest, clipping, loudness per bar, spectral balance, warnings; optional WAV file; optionally one channel soloed), `screenshot`, `show_window`, `set_selection` |

Agents cannot hear, so `render_audio` is their ears: it tells them whether the mix is silent, clipping, too quiet,
bass-heavy, or phase-problematic, and how loudness develops over the song.

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
