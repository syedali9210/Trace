#!/usr/bin/env node
// stdio bridge for MCP clients that only speak stdio: newline-delimited JSON-RPC in, forwarded to Trace's
// HTTP endpoint, replies out. Set TRACE_URL (default http://127.0.0.1:4317) and TRACE_TOKEN.
import readline from 'node:readline';

const url = `${(process.env.TRACE_URL || 'http://127.0.0.1:4317').replace(/\/$/, '')}/mcp`;
const token = process.env.TRACE_TOKEN;
let session;

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...(session ? { 'mcp-session-id': session } : {}) }, body: line });
    session = r.headers.get('mcp-session-id') || session;
    if (r.status === 202) return;
    const text = await r.text();
    if (!r.ok && msg.id !== undefined) return out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Trace answered ${r.status}: ${text.slice(0, 300)}` } });
    if (text) process.stdout.write(text.replace(/\n/g, ' ') + '\n');
  } catch (e) {
    if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `Couldn’t reach Trace at ${url}. Is it running (npm start)? ${e.message}` } });
  }
});
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
