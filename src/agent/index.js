// MCP tool layer. The main process hosts the actual MCP server (mcp/); this module defines the tools it
// exposes, runs them against the live project, and reports back. Every tool works through the same Store /
// Transport / Engine the UI uses, so whatever an agent does shows up in the windows immediately and lands on
// the undo stack.
import { Emitter } from '../util.js';
import { ToolError } from './helpers.js';
import { validate } from './schema.js';
import { tools as projectTools } from './tools/project.js';
import { tools as catalogTools } from './tools/catalog.js';
import { tools as channelTools } from './tools/channels.js';
import { tools as patternTools } from './tools/patterns.js';
import { tools as playlistTools } from './tools/playlist.js';
import { tools as mixerTools } from './tools/mixer.js';
import { tools as automationTools } from './tools/automation.js';
import { tools as renderTools } from './tools/render.js';
import { tools as uiTools } from './tools/ui.js';

export const TOOLS = [
  ...projectTools, ...catalogTools, ...channelTools, ...patternTools, ...playlistTools, ...mixerTools, ...automationTools, ...renderTools, ...uiTools,
];

/** What clients see in tools/list. */
export const describeTools = (tools = TOOLS) => tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));

/**
 * Run one tool. Resolves to { ok: true, value } or { ok: false, error }; never throws, so a bad call
 * cannot take the app down. Unexpected exceptions are logged and reported with their message.
 */
export async function runTool(app, name, args = {}, tools = TOOLS) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  const problem = validate(tool.inputSchema, args);
  if (problem) return { ok: false, error: `Invalid arguments for ${name}: ${problem}` };
  try {
    const value = await tool.run(args, app);
    // plain JSON only: results cross the IPC boundary and become MCP text content
    return { ok: true, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) };
  } catch (err) {
    if (!(err instanceof ToolError)) console.error(`[agent] ${name} failed`, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Main-process errors arrive wrapped by Electron ("Error invoking remote method …: Error: ENOENT …"). */
const unwrap = (err) => new ToolError(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));

function fileAccess(api) {
  return {
    read: (path) => api.readFile(path).catch((e) => { throw unwrap(e); }),
    write: (path, data) => api.writeFile(path, data).catch((e) => { throw unwrap(e); }),
  };
}

/**
 * Connect the app to the MCP server running in the main process. Resolves to the agent handle
 * ({ url, on('activity') }) or null when the server is disabled.
 */
export async function installAgent(app) {
  const api = globalThis.window?.studioAPI?.agent;
  const info = api ? await api.info().catch(() => null) : null;
  if (!info) return null;

  app.files = fileAccess(api);
  const agent = Object.assign(new Emitter(), { url: info.url, port: info.port, calls: 0 });

  // one call at a time: tools edit shared state and some (render) are async
  let queue = Promise.resolve();
  api.onCall((name, args) => {
    const job = queue.then(async () => {
      agent.emit('activity', { name, running: true });
      const res = await runTool(app, name, args);
      agent.calls++;
      agent.emit('activity', { name, running: false, ok: res.ok });
      return res;
    });
    queue = job.catch(() => {});
    return job;
  });
  api.register(describeTools());
  app.agent = agent;
  return agent;
}
