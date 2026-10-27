#!/usr/bin/env node
// stdio bridge for MCP clients that cannot speak HTTP: reads newline-delimited JSON-RPC on stdin, forwards each
// message to the running OpenStudio (http://127.0.0.1:6736/mcp), and writes the replies to stdout.
//
//   node scripts/mcp-stdio.mjs [--url http://127.0.0.1:6736/mcp] [--launch]
//
// --launch starts OpenStudio first if it is not running (waits up to 60 s for it).
// The URL can also be set with OPENSTUDIO_MCP_URL. Diagnostics go to stderr; stdout carries protocol only.
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const urlArg = args.indexOf('--url');
const url = (urlArg >= 0 ? args[urlArg + 1] : null) || process.env.OPENSTUDIO_MCP_URL || 'http://127.0.0.1:6736/mcp';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const log = (...m) => console.error('[openstudio-mcp]', ...m);
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Generous: tool calls in the app may legitimately run for up to 5 minutes. Without a deadline, a request
// whose socket dies mid-flight (app quit, crash) would hang this process — and the MCP client — forever.
// OPENSTUDIO_MCP_TIMEOUT_MS overrides it (used by the tests).
const FORWARD_TIMEOUT_MS = Number(process.env.OPENSTUDIO_MCP_TIMEOUT_MS) || 6 * 60 * 1000;

async function post(body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body,
    signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
  });
}

let launching = null;
async function launchApp() {
  if (!launching) {
    launching = (async () => {
      log('OpenStudio is not running — starting it');
      const electron = createRequire(import.meta.url)(join(root, 'node_modules', 'electron'));
      spawn(electron, ['.'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
      for (let i = 0; i < 120; i++) {
        await sleep(500);
        try {
          const res = await post(JSON.stringify({ jsonrpc: '2.0', id: 'probe', method: 'ping' }));
          if (res.ok) return;
        } catch { /* not up yet */ }
      }
      throw new Error('OpenStudio did not start within 60 s');
    })();
  }
  return launching;
}

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const ids = (Array.isArray(msg) ? msg : [msg]).filter((m) => m && m.id != null && m.method).map((m) => m.id);
  const fail = (message) => { for (const id of ids) send({ jsonrpc: '2.0', id, error: { code: -32603, message } }); };

  let res;
  try {
    try {
      res = await post(line);
    } catch (err) {
      if (!flag('launch')) throw err;
      await launchApp();
      res = await post(line);
    }
  } catch (err) {
    if (err?.name === 'TimeoutError') return fail(`OpenStudio at ${url} did not answer within ${FORWARD_TIMEOUT_MS / 60000} minutes.`);
    return fail(`Cannot reach OpenStudio at ${url} (${err.cause?.code || err.message}). Start the app (npm start) or add --launch to this command.`);
  }
  if (res.status === 202) return undefined;
  const text = await res.text();
  try {
    const out = JSON.parse(text);
    for (const m of Array.isArray(out) ? out : [out]) send(m);
  } catch {
    fail(`OpenStudio answered ${res.status} with something that is not JSON`);
  }
  return undefined;
}

const rl = createInterface({ input: process.stdin });
const inflight = new Set();
rl.on('line', (line) => {
  if (!line.trim()) return;
  const p = forward(line).catch((err) => log(err.message)).finally(() => inflight.delete(p));
  inflight.add(p);
});
rl.on('close', async () => { await Promise.all(inflight); process.exit(0); });
