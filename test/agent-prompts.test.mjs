import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudePrompt, opencodePrompt, codexPrompt, antigravityPrompt, piPrompt } from '../src/ui/agentprompts.js';

const URL = 'http://127.0.0.1:6736/mcp';

test('Claude quickstart registers the endpoint with claude mcp add', () => {
  const p = claudePrompt(URL);
  assert.match(p, new RegExp(`claude mcp add --scope user --transport http openstudio ${URL}`));
});

test('OpenCode quickstart carries a valid remote MCP config for the endpoint', () => {
  const p = opencodePrompt(URL);
  const json = p.slice(p.indexOf('{'), p.indexOf('\n  }\n') + 4);
  const cfg = JSON.parse(json);
  assert.deepEqual(cfg.mcp.openstudio, { type: 'remote', url: URL, enabled: true });
});

test('Codex quickstart registers the endpoint with codex mcp add, with a config.toml fallback', () => {
  const p = codexPrompt(URL);
  assert.match(p, new RegExp(`codex mcp add openstudio --url ${URL}`));
  assert.match(p, new RegExp(`\\[mcp_servers\\.openstudio\\]\\n\\s*url = "${URL}"`));
});

test('Antigravity quickstart uses the serverUrl key Antigravity requires', () => {
  const p = antigravityPrompt(URL);
  const json = p.slice(p.indexOf('{'), p.indexOf('\n  }\n') + 4);
  assert.deepEqual(JSON.parse(json).mcpServers.openstudio, { serverUrl: URL });
});

test('Pi quickstart registers the endpoint with pi mcp add', () => {
  assert.match(piPrompt(URL), new RegExp(`pi mcp add openstudio --url ${URL}`));
});

test('quickstarts use the live endpoint, not the default', () => {
  const other = 'http://127.0.0.1:7777/mcp';
  for (const make of [claudePrompt, opencodePrompt, codexPrompt, antigravityPrompt, piPrompt]) assert.ok(!make(other).includes('6736'), make.name);
});
