// The stdio bridge (scripts/mcp-stdio.mjs) against a mock OpenStudio HTTP endpoint: messages must be
// forwarded both ways with protocol errors answered locally, and a dead upstream must never hang the
// bridge or its client.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const closeUpstream = (child, upstream) => new Promise((resolve) => {
  child.stdin.end();
  child.on('exit', () => { upstream.close(() => resolve()); });
  setTimeout(() => child.kill('SIGKILL'), 8000).unref();
});

const echoHandler = (req, res, body) => {
  const msgs = JSON.parse(body);
  const list = Array.isArray(msgs) ? msgs : [msgs];
  const replies = list.filter((m) => m && m.id != null && m.method)
    .map((m) => ({ jsonrpc: '2.0', id: m.id, result: { echoed: m.method } }));
  res.writeHead(replies.length ? 200 : 202, { 'Content-Type': 'application/json' });
  res.end(replies.length ? JSON.stringify(replies) : '');
};

test('requests, batches and notifications are forwarded; garbage gets a parse error', async () => {
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => echoHandler(req, res, body));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const run = spawn(process.execPath, ['scripts/mcp-stdio.mjs', '--url', `http://127.0.0.1:${upstream.address().port}/mcp`], { cwd: root });
  const lines = [];
  run.stdout.on('data', (d) => lines.push(...d.toString().split('\n').filter((l) => l.trim())));
  const waitFor = async (n, ms = 4000) => {
    const deadline = Date.now() + ms;
    while (lines.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    return lines;
  };

  run.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  run.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  run.stdin.write('[{"jsonrpc":"2.0","id":2,"method":"tools/list"},{"jsonrpc":"2.0","method":"notifications/x"}]\n');
  run.stdin.write('{oops\n');
  await waitFor(3);

  // replies are id-matched, so they may come back in any order
  const byId = (id) => lines.map((l) => JSON.parse(l)).find((m) => m.id === id);
  assert.deepEqual(byId(1), { jsonrpc: '2.0', id: 1, result: { echoed: 'ping' } });
  assert.deepEqual(byId(2), { jsonrpc: '2.0', id: 2, result: { echoed: 'tools/list' } }, 'the notification is not answered, the rest of the batch is');
  assert.deepEqual(byId(null), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  assert.equal(lines.length, 3, 'the notification produced no output');
  await closeUpstream(run, upstream);
});

test('a dead upstream answers each request with an error and the bridge still exits', { timeout: 20000 }, async () => {
  // this upstream reads the request and then kills the socket: fetch would hang forever without a deadline
  const upstream = createServer((req) => { req.on('data', () => {}); req.on('end', () => req.destroy()); });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const run = spawn(process.execPath, ['scripts/mcp-stdio.mjs', '--url', `http://127.0.0.1:${upstream.address().port}/mcp`], {
    cwd: root, env: { ...process.env, OPENSTUDIO_MCP_TIMEOUT_MS: '1500' },
  });
  const lines = [];
  run.stdout.on('data', (d) => lines.push(...d.toString().split('\n').filter((l) => l.trim())));

  run.stdin.write('{"jsonrpc":"2.0","id":7,"method":"ping"}\n');
  const deadline = Date.now() + 10000;
  while (!lines.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(lines.length, 'the hung request must still get an answer');
  const msg = JSON.parse(lines[0]);
  assert.equal(msg.id, 7);
  assert.equal(msg.error.code, -32603);

  // stdin closing must end the process even with work in flight
  const exited = new Promise((resolve) => run.on('exit', resolve));
  run.stdin.end();
  const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('still-running'), 5000))]);
  assert.notEqual(code, 'still-running', 'the bridge must exit when stdin closes');
  upstream.close();
});
