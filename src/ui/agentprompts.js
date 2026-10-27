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
