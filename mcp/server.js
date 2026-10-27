'use strict';
// A small, dependency-free Model Context Protocol server over the "Streamable HTTP" transport.
// It is stateless (no sessions, no SSE stream): every POST carries one JSON-RPC message (or a batch) and is
// answered with plain JSON, which every MCP client is required to accept. It only knows about tools; what the
// tools do is supplied by a `backend` so the server can be tested without Electron.
//
//   backend.listTools()          -> Promise<Tool[]>             ({ name, description, inputSchema, annotations? })
//   backend.callTool(name, args) -> Promise<CallToolResult>     ({ content, structuredContent?, isError? })
//                                   throws { code, message } for protocol-level errors (e.g. unknown tool)

const http = require('http');

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 16 * 1024 * 1024;
// Beyond this we stop reading and kill the socket: nothing legitimate is that large.
const DRAIN_CAP = 64 * 1024 * 1024;

const ERR = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603 };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Only loopback hosts/origins are served, so a web page cannot reach the server (DNS rebinding, CSRF). */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
function hostAllowed(host) {
  if (!host) return false;
  return LOOPBACK.test(host.replace(/:\d+$/, ''));
}
function originAllowed(origin) {
  if (origin === undefined) return true; // not a browser request
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK.test(u.hostname);
  } catch {
    return false;
  }
}

/** Read and discard an unread request body (up to a cap) before replying, so the client's keep-alive
 * connection is not reset out from under its next request. Destroys (and returns false) past the cap. */
async function drain(req, cap = DRAIN_CAP) {
  let extra = 0;
  for await (const chunk of req) {
    extra += chunk.length;
    if (extra > cap) { req.destroy(); return false; }
  }
  return true;
}

function createMcpServer({ backend, name, version, instructions }) {
  const serverInfo = { name, version };

  async function handleRequest(msg) {
    const { id, method, params } = msg;
    try {
      switch (method) {
        case 'initialize': {
          const asked = params?.protocolVersion;
          const result = {
            protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo,
          };
          if (instructions) result.instructions = instructions;
          return { jsonrpc: '2.0', id, result };
        }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: await backend.listTools() } };
        case 'tools/call': {
          if (!isObject(params) || typeof params.name !== 'string') return rpcError(id, ERR.INVALID_PARAMS, 'tools/call needs a tool name');
          const args = params.arguments ?? {};
          if (!isObject(args)) return rpcError(id, ERR.INVALID_PARAMS, 'Tool arguments must be an object');
          return { jsonrpc: '2.0', id, result: await backend.callTool(params.name, args) };
        }
        default:
          return rpcError(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (err) {
      if (err && Number.isInteger(err.code) && err.code <= -32000) return rpcError(id, err.code, err.message);
      return rpcError(id, ERR.INTERNAL, err?.message || String(err));
    }
  }

  /** Returns the response for a request, or null for notifications and client responses. */
  async function handleMessage(msg) {
    if (!isObject(msg) || msg.jsonrpc !== '2.0') return rpcError(isObject(msg) ? msg.id : null, ERR.INVALID_REQUEST, 'Not a JSON-RPC 2.0 message');
    // JSON-RPC ids are strings or numbers (absent for notifications); anything else is a protocol error
    if (msg.id !== undefined && msg.id !== null && typeof msg.id !== 'number' && typeof msg.id !== 'string') {
      return rpcError(null, ERR.INVALID_REQUEST, 'The request id must be a string or a number');
    }
    if (typeof msg.method !== 'string') return null; // a response to a server request: we never send any
    if (msg.id === undefined || msg.id === null) return null; // notification (initialized, cancelled, …)
    return handleRequest(msg);
  }

  async function handleHttp(req, res, port) {
    const send = (status, body, headers = {}) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers });
      res.end(text);
    };
    // reply only after the request has been fully read: responding on an unread body makes the client's
    // socket get reset, which would also kill its next request on that keep-alive connection
    const reply = async (status, body, headers = {}) => {
      if (!await drain(req)) return;
      send(status, body, headers);
    };

    if (!hostAllowed(req.headers.host) || !originAllowed(req.headers.origin)) return reply(403, rpcError(null, ERR.INVALID_REQUEST, 'Forbidden host or origin'));
    if (new URL(req.url, `http://127.0.0.1:${port}`).pathname !== '/mcp') return reply(404, rpcError(null, ERR.INVALID_REQUEST, 'The MCP endpoint is /mcp'));
    if (req.method !== 'POST') return reply(405, rpcError(null, ERR.INVALID_REQUEST, 'Use POST'), { Allow: 'POST' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reply(415, rpcError(null, ERR.INVALID_REQUEST, 'Content-Type must be application/json'));

    const chunks = [];
    let size = 0;
    let tooBig = false;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > DRAIN_CAP) { req.destroy(); return; }
      if (tooBig) continue; // keep reading (and discarding) so the connection survives for the next request
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(chunk);
    }
    if (tooBig) return send(413, rpcError(null, ERR.INVALID_REQUEST, 'Request too large'));
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return send(400, rpcError(null, ERR.PARSE, 'Parse error'));
    }

    if (Array.isArray(body)) {
      if (!body.length) return send(400, rpcError(null, ERR.INVALID_REQUEST, 'Empty batch'));
      const out = (await Promise.all(body.map(handleMessage))).filter(Boolean);
      return out.length ? send(200, out) : send(202);
    }
    const out = await handleMessage(body);
    return out ? send(200, out) : send(202);
  }

  let server = null;
  return {
    handleMessage,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          handleHttp(req, res, server.address()?.port).catch((err) => {
            if (res.destroyed) return;
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
            if (!res.writableEnded) res.end(JSON.stringify(rpcError(null, ERR.INTERNAL, err.message)));
          });
        });
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve({ port: server.address().port, host });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (!server) return resolve();
        server.closeAllConnections?.();
        server.close(() => resolve());
        server = null;
      });
    },
  };
}

module.exports = { createMcpServer, SUPPORTED_VERSIONS, ERR };
