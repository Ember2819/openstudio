// Quickstart prompts the user pastes into their AI agent (Settings → Agents). Each one tells the agent to wire
// OpenStudio's MCP server into its own harness, so the user never edits a config file by hand.

const DOCS = 'https://github.com/Ember2819/openstudio/blob/main/docs/AGENTS.md';

const intro = (url) => `Set up OpenStudio (an open-source DAW running on this computer) as an MCP server for you, so you can work on music projects in it.

OpenStudio's MCP server is already running at ${url} (Streamable HTTP, this computer only, no auth). Register it under the name "openstudio".`;

const outro = `Then confirm the openstudio tools are available (call get_project) and tell me when it works. Read ${DOCS} for the tool list and conventions (time is in steps: 16 = 1 bar; MIDI 60 = C5; use render_audio to check the mix since you can't hear it). Don't overwrite my unsaved work. Once it works, ask me what I'd like to make.`;

export function claudePrompt(url) {
  return `${intro(url)}

You are Claude Code. Run:

  claude mcp add --scope user --transport http openstudio ${url}

(--scope user makes it available in every project.) Verify with \`claude mcp list\`. If this session can't see the new server yet, tell me to restart Claude Code or run /mcp.

${outro}`;
}

export function opencodePrompt(url) {
  return `${intro(url)}

You are OpenCode. Add it as a remote MCP server in my OpenCode config: ~/.config/opencode/opencode.json (global; create the file if it doesn't exist, or use opencode.json in the current project if I'd rather have it per-project). Merge it into the existing JSON without removing anything else:

  {
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
      "openstudio": { "type": "remote", "url": "${url}", "enabled": true }
    }
  }

Verify with \`opencode mcp list\`. OpenCode only reads its config on start-up, so tell me to restart OpenCode (and continue this task in the new session) before the tools appear.

${outro}`;
}

export function codexPrompt(url) {
  return `${intro(url)}

You are Codex. Run:

  codex mcp add openstudio --url ${url}

That writes the server to ~/.codex/config.toml, which the Codex CLI, IDE extension and app all share. If your sandbox won't let you run it or write that file, ask me to approve it, or add this to ~/.codex/config.toml yourself (keep everything else in the file):

  [mcp_servers.openstudio]
  url = "${url}"

Verify with \`codex mcp list\`. Codex loads MCP servers when a session starts, so tell me to start a new Codex session (and continue this task there) before the tools appear.

${outro}`;
}

export function antigravityPrompt(url) {
  return `${intro(url)}

You are the agent in Google Antigravity. Add it to my global Antigravity MCP config, ~/.gemini/config/mcp_config.json (older Antigravity versions use ~/.gemini/antigravity/mcp_config.json: edit whichever one exists, and create ~/.gemini/config/mcp_config.json if neither does). Merge it into the existing JSON without removing anything else. Antigravity needs the "serverUrl" key for remote servers; "url" and "httpUrl" are ignored:

  {
    "mcpServers": {
      "openstudio": { "serverUrl": "${url}" }
    }
  }

Then tell me how to load it: in the IDE, "…" at the top of the agent panel → MCP Servers → Manage MCP Servers (refresh there, or restart Antigravity if openstudio doesn't appear); in the Antigravity app, the refresh button under Installed MCP Servers; in the Antigravity CLI, /mcp and reload.

${outro}`;
}

export function piPrompt(url) {
  return `${intro(url)}

You are Pi. Run:

  pi mcp add openstudio --url ${url}

That writes it to ~/.pi/agent/mcp.json (add -l for this project only). Plain http is fine because the server is on loopback. Verify with \`pi mcp list\`: it should show openstudio and its tools. If I use the pi-mcp-adapter extension instead of Pi's built-in MCP, it reads the same file. Pi loads MCP servers when it starts, so tell me to restart Pi (and continue this task in the new session) before the tools appear.

${outro}`;
}
