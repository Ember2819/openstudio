import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const { createMcpServer } = createRequire(import.meta.url)('../mcp/server.js');

const TOOLS = [
  {
    name: 'add', description: 'Add two numbers', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'], additionalProperties: false },
  },
  { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
];
const backend = {
  listTools: async () => TOOLS,
  async callTool(name, args) {
    if (name === 'add') return { content: [{ type: 'text', text: String(args.a + args.b) }], structuredContent: { sum: args.a + args.b } };
    if (name === 'fail') return { isError: true, content: [{ type: 'text', text: 'it broke' }] };
    throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  },
};

async function withServer(fn) {
  const server = createMcpServer({ backend, name: 'test', version: '1.2.3', instructions: 'Be nice.' });
  const { port } = await server.listen(0);
  try { await fn(`http://127.0.0.1:${port}/mcp`, port); } finally { await server.close(); }
}

const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

test('the official MCP client can connect, list and call tools', async () => {
  await withServer(async (url) => {
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    assert.equal(client.getServerVersion().name, 'test');
    assert.equal(client.getInstructions(), 'Be nice.');
    assert.ok(client.getServerCapabilities().tools);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['add', 'fail']);
    assert.equal(tools[0].annotations.readOnlyHint, true);

    const ok = await client.callTool({ name: 'add', arguments: { a: 2, b: 3 } });
    assert.equal(ok.content[0].text, '5');
    assert.deepEqual(ok.structuredContent, { sum: 5 });

    const bad = await client.callTool({ name: 'fail', arguments: {} });
    assert.equal(bad.isError, true);
    await assert.rejects(client.callTool({ name: 'ghost', arguments: {} }), /Unknown tool/);
    await client.ping();
    await client.close();
  });
});

test('protocol version negotiation', async () => {
  await withServer(async (url) => {
    for (const [asked, expected] of [['2025-06-18', '2025-06-18'], ['2024-11-05', '2024-11-05'], ['1999-01-01', '2025-11-25']]) {
      const res = await (await post(url, rpc(1, 'initialize', { protocolVersion: asked, capabilities: {}, clientInfo: { name: 'x', version: '1' } }))).json();
      assert.equal(res.result.protocolVersion, expected);
    }
  });
});

test('notifications get 202, batches are answered, bad input gets JSON-RPC errors', async () => {
  await withServer(async (url) => {
    const note = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(note.status, 202);
    assert.equal(await note.text(), '');

    const batch = await (await post(url, [rpc(1, 'ping'), { jsonrpc: '2.0', method: 'notifications/cancelled', params: {} }, rpc(2, 'tools/list')])).json();
    assert.deepEqual(batch.map((r) => r.id), [1, 2]);
    assert.equal(batch[1].result.tools.length, 2);

    const unknown = await (await post(url, rpc(3, 'resources/list'))).json();
    assert.equal(unknown.error.code, -32601);
    const noName = await (await post(url, rpc(4, 'tools/call', {}))).json();
    assert.equal(noName.error.code, -32602);
    const garbage = await post(url, '{not json');
    assert.equal(garbage.status, 400);
    assert.equal((await garbage.json()).error.code, -32700);
    const notRpc = await (await post(url, { hello: 'world' })).json();
    assert.equal(notRpc.error.code, -32600);
    assert.equal((await post(url, [])).status, 400);
  });
});

test('only POST /mcp with JSON is served', async () => {
  await withServer(async (url, port) => {
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
    assert.equal((await post(`http://127.0.0.1:${port}/other`, rpc(1, 'ping'))).status, 404);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
  });
});

test('web pages and rebound hosts are refused', async () => {
  await withServer(async (url, port) => {
    const ping = rpc(1, 'ping');
    assert.equal((await post(url, ping, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(url, ping, { Origin: 'http://localhost.evil.example' })).status, 403);
    assert.equal((await post(url, ping, { Origin: 'null' })).status, 403);
    assert.equal((await post(url, ping, { Origin: `http://localhost:${port}` })).status, 200);
    assert.equal((await post(url, ping, { Origin: 'http://127.0.0.1:3000' })).status, 200);
    // a DNS-rebinding page reaches 127.0.0.1 but carries its own hostname in Host
    const res = await new Promise((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json' } }, (r) => resolve(r.statusCode));
        req.on('error', reject);
        req.end(JSON.stringify(ping));
      });
    });
    assert.equal(res, 403);
  });
});
