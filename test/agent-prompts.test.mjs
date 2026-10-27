import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudePrompt, opencodePrompt } from '../src/ui/agentprompts.js';

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

test('quickstarts use the live endpoint, not the default', () => {
  const other = 'http://127.0.0.1:7777/mcp';
  assert.ok(!claudePrompt(other).includes('6736'));
  assert.ok(!opencodePrompt(other).includes('6736'));
});
