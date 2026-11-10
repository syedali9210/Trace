// HTTP: who is asking, the request to its route (router.js; the routes are in routes/), static files, stored
// files, live events (SSE), invite/guest links and /mcp.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { get, now, ROOT, addClient } from './db.js';
import { filePath, extOf, MIME } from './media.js';
import { handleMcp } from './mcp.js';
import { r, routes, err, can } from './router.js';

// The app: the React app as built into ui/dist (npm run build:ui).
const WEB = path.join(ROOT, 'ui', 'dist');
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', json: 'application/json', ico: 'image/x-icon', png: 'image/png', webp: 'image/webp' };

// ---------- who is asking ----------
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((x) => x[0]));
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// The person at this computer is anyone asking from it, but only when they ask for Trace by its own local name. A web
// page whose domain is pointed at 127.0.0.1 (DNS rebinding) asks for its own name: it isn't you, and gets nothing.
const LOCAL_NAME = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const OPEN = (process.env.TRACE_HOST || '127.0.0.1') !== '127.0.0.1'; // TRACE_HOST=0.0.0.0: shared on the network, members sign in by invite
const NAMES = new Set(String(process.env.TRACE_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)); // other names this Trace answers to
export const hostOk = (host) => LOCAL_NAME.test(host || '') || NAMES.has(String(host).toLowerCase()) || NAMES.has(String(host).toLowerCase().replace(/:\d+$/, '')) || OPEN;
function who(req) {
  const ck = cookies(req);
  if (ck.trace_session) { const m = get('SELECT u.*, m.role FROM membership m JOIN user u ON u.id=m.user_id WHERE m.token=?', ck.trace_session); if (m) return m; }
  if (ck.trace_guest) { const g = get('SELECT * FROM guest_link WHERE token=? AND expires_at > ?', ck.trace_guest, now()); if (g) return { id: `guest:${g.token.slice(0, 6)}`, name: g.name || 'Guest', role: 'guest', guest: true, project_id: g.project_id }; }
  if (LOOPBACK.has(req.socket.remoteAddress) && LOCAL_NAME.test(req.headers.host || '')) return get("SELECT u.*, m.role FROM membership m JOIN user u ON u.id=m.user_id WHERE m.role='owner' LIMIT 1"); // the person at this computer
  return null;
}
// A change can only come from Trace's own page: another site's page (or a sandboxed preview, Origin "null") is refused.
const sameOrigin = (req) => { const o = req.headers.origin; return !o || o === `http://${req.headers.host}`; };

// ---------- routing ----------
async function body(req, limit = 5e6) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw err(413, 'That’s too big to upload in one go.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const send = (res, status, data, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(data)); };

export async function handle(req, res) {
  if (!hostOk(req.headers.host)) { res.writeHead(421, { 'content-type': 'text/plain' }).end('This Trace only answers to its own local address.'); return; } // DNS rebinding
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const origin = `http://${req.headers.host}`;
  try {
    if (url.pathname === '/mcp') return await handleMcp(req, res, await body(req), origin);
    const join = url.pathname.match(/^\/(join|guest)\/([\w-]+)$/);
    if (join) return invite(res, join[1], join[2]);
    const user = who(req);
    if (url.pathname.startsWith('/files/')) return serveFile(req, res, user, decodeURIComponent(url.pathname.slice(7)));
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    if (!user) return send(res, 401, { error: 'Open your invite link to sign in to this Trace.' });
    if (req.method !== 'GET' && (req.headers['x-trace'] !== '1' || !sameOrigin(req))) return send(res, 403, { error: 'Changes come only from Trace’s own page.' }); // cross-site forms, other sites' scripts, sandboxed previews
    for (const rt of routes) {
      if (rt.method !== req.method) continue;
      const m = url.pathname.match(rt.re);
      if (!m) continue;
      if (rt.level && !user.guest && !can(user, rt.level)) return send(res, 403, { error: 'Your role can’t do that here.' });
      if (user.guest && !rt.guest) return send(res, 403, { error: 'Guest links only open their project.' });
      const raw = rt.raw ? await body(req, 600e6) : null;
      let json = {};
      if (!rt.raw && req.method !== 'GET') { const b = await body(req); json = b.length ? JSON.parse(b) : {}; }
      const need = (level, project_id) => { if (!can(user, level, project_id)) throw err(403, user.guest ? 'Guests can view and comment only.' : 'Your role can’t do that in this project.'); };
      const out = await rt.fn({ params: m.groups || {}, query: Object.fromEntries(url.searchParams), body: json, raw, user, origin, need, req, res });
      if (out === undefined && res.headersSent) return; // streamed (SSE, downloads)
      return send(res, 200, out ?? { ok: true });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : `Something went wrong: ${e.message}` });
  }
}

function serveStatic(res, p) {
  const file = path.join(WEB, p === '/' || !path.extname(p) ? 'index.html' : p);
  if (!existsSync(path.join(WEB, 'index.html'))) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Trace is running, but its app isn’t built yet. In Trace’s folder run:  npm --prefix ui install  then  npm run build:ui  and reload this page.'); return; }
  if (!file.startsWith(WEB + path.sep) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end('Not found'); return; }
  const type = TYPES[extOf(file)] || 'application/octet-stream', buf = readFileSync(file);
  res.writeHead(200, { 'content-type': type, 'cache-control': p.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache', ...(/html/.test(type) ? pageHeaders(buf) : { 'x-content-type-options': 'nosniff' }) }); // built assets have hashed names
  res.end(buf);
}
// Trace's own page runs only Trace's own scripts (an injected <script> or onerror= goes nowhere), can't be framed by
// another site, and sends no referrer. Previews frame the dev servers on 127.0.0.1; pasted HTML runs at its own address.
const pageHeaders = (html) => {
  const boot = [...String(html).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  const local = 'http://127.0.0.1:* http://localhost:*';
  return {
    'content-security-policy': [`default-src 'self'`, `script-src 'self' ${boot}`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https: ${local}`, `media-src 'self' blob: ${local}`,
      `font-src 'self' data:`, `connect-src 'self'`, `frame-src 'self' ${local}`, `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`].join('; '),
    'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin',
  };
};

function serveFile(req, res, user, key) {
  if (!user) { res.writeHead(401).end(); return; }
  if (!/^[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]+$/.test(key)) { res.writeHead(404).end(); return; }
  if (user.guest) {
    const ok = get(`SELECT 1 FROM snapshot s JOIN asset a ON a.id=s.asset_id WHERE a.project_id=? AND ? IN (s.image_key, s.thumb_key, s.file_key)
      UNION SELECT 1 FROM reference WHERE project_id=? AND ? IN (file_key, thumb_key) LIMIT 1`, user.project_id, key, user.project_id, key);
    if (!ok) { res.writeHead(403).end(); return; }
  }
  const p = filePath(key);
  if (!existsSync(p)) { res.writeHead(404).end(); return; }
  const headers = { 'content-type': MIME[extOf(key)] || (extOf(key) === 'webp' ? 'image/webp' : 'application/octet-stream'), 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' };
  if (extOf(key) === 'svg' || extOf(key) === 'html') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"; // uploaded SVG/HTML can't run script
  if (req.headers.range) {
    const size = statSync(p).size, [s, e] = req.headers.range.replace('bytes=', '').split('-').map(Number);
    const end = e || size - 1;
    res.writeHead(206, { ...headers, 'content-range': `bytes ${s}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - s + 1 });
    const fd = readFileSync(p).subarray(s, end + 1);
    return res.end(fd);
  }
  res.writeHead(200, headers).end(readFileSync(p));
}

function invite(res, kind, t) {
  if (kind === 'join') {
    const m = get('SELECT * FROM membership WHERE token=?', t);
    if (!m) { res.writeHead(404, { 'content-type': 'text/plain' }).end('This invite link is no longer valid. Ask the workspace owner for a new one.'); return; }
    res.writeHead(302, { 'set-cookie': `trace_session=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`, location: '/' }).end();
  } else {
    const g = get('SELECT * FROM guest_link WHERE token=? AND expires_at > ?', t, now());
    if (!g) { res.writeHead(404, { 'content-type': 'text/plain' }).end('This guest link has expired. Ask for a new one.'); return; }
    res.writeHead(302, { 'set-cookie': `trace_guest=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.round((g.expires_at - now()) / 1000)}`, location: `/#/p/${g.project_id}` }).end();
  }
}

// ---------- live events ----------
r('GET', '/api/events', null, ({ user, res }) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const build = () => { try { return readFileSync(path.join(WEB, 'index.html'), 'utf8').match(/assets\/(index-[\w-]+\.js)/)?.[1] || ''; } catch { return ''; } }; // the UI build's entry: an open tab on an older one offers to reload
  res.write(`retry: 3000\n\nevent: build\ndata: ${JSON.stringify({ id: build() })}\n\n`);
  addClient(res, user);
  const ping = setInterval(() => res.write(`event: build\ndata: ${JSON.stringify({ id: build() })}\n\n`), 25000);
  res.on('close', () => clearInterval(ping));
}, { guest: true });

// ---------- the routes, by area (each file adds to router.js’s table as it loads) ----------
import './routes/home.js';
import './routes/projects.js';
import './routes/work.js';
import './routes/history.js';
import './routes/canvas.js';
import './routes/planning.js';
import './routes/ai.js';
import './routes/settings.js';
