// HTTP: the web app's REST API, static files, stored files, live events (SSE), invite/guest links and /mcp.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { db, all, get, run, insert, update, tx, now, uid, token as newToken, ROOT, DATA, WS, settings, setSettings, workspace, addClient, broadcast, audit, notify, edge } from './db.js';
import { getSecret, setSecret, deleteSecret, hint } from './secrets.js';
import { filePath, storeFile, readKey, extOf, MIME, palette, imageHashes, preview, crop, zip } from './media.js';
import { diffSnapshots } from './diff.js';
import { textVec, cosine } from './vec.js';
import * as E from './engine.js';
import * as R from './retrieval.js';
import * as W from './words.js';
import * as MEM from './memory.js';
import * as REF from './refs.js';
import { RENDERABLE, livePage, artifactPage, artifactKind } from './render.js';
import { BLOCKS, blockList, items as blockItems, summary as blockSummary, saveCanvas, canvasOf, visualSnap, changelog } from './blocks.js';
import { insights } from './insights.js';
import * as CS from './casestudy.js';
const { projectDirs } = CS;
import { CATALOG, connect, disconnect, setSourceStatus, pollSource } from './connectors/index.js';
import { registry } from './engine.js';
import { captureUpload } from './connectors/local.js';
import { captureLink, resolve as resolveLink, snapshotLink } from './connectors/link.js';
import { fileKeyOf } from './connectors/figma.js';
import { buildDeck, pptx, TEMPLATES } from './deck.js';
import { sortFiles } from './relevance.js';
import { handleMcp, hashToken, AGENT_SCRIPT, aiTools, proposals } from './mcp.js';
import * as AI from './ai.js';
import * as F from './folders.js';
import { seedDemo } from './demo.js';
import { categoryOf } from './category.js';
import * as HX from './history.js';
import * as FR from './frames.js';
import * as SC from './screens.js';
import * as CHK from './check.js';
import * as DS from './design.js';
import * as STRESS from './stress.js';

// The app: the built React app (ui/, shadcn + Fluid Functionalism; npm run build:ui), else the old no-build one.
const WEB = existsSync(path.join(ROOT, 'ui', 'dist', 'index.html')) ? path.join(ROOT, 'ui', 'dist') : path.join(ROOT, 'web');
const NM = path.join(ROOT, 'node_modules');
const VENDOR = { 'preact.mjs': 'preact/dist/preact.mjs', 'hooks.mjs': 'preact/hooks/dist/hooks.mjs', 'htm.mjs': 'htm/dist/htm.module.js', 'lottie.mjs': 'lottie-web/build/player/esm/lottie_light.min.js', 'phosphor/': '@phosphor-icons/web/src/regular/', 'geist/': '@fontsource-variable/geist/files/', 'geist-mono/': '@fontsource-variable/geist-mono/files/', 'inter/': '@fontsource-variable/inter/files/' };
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', json: 'application/json', ico: 'image/x-icon', png: 'image/png', webp: 'image/webp' };

const err = (status, message) => Object.assign(new Error(message), { status });
const LEVEL = { read: 0, comment: 1, review: 2, edit: 3, admin: 4 };
const ROLE = { viewer: 0, guest: 1, reviewer: 2, editor: 3, owner: 4 };
const strip = (o) => { if (o) { delete o.embedding; delete o.centroid; delete o.img_vec; } return o; };

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
function can(user, level, project_id) {
  if (user.guest) return project_id === user.project_id && LEVEL[level] <= LEVEL.comment;
  let role = user.role;
  if (project_id && role !== 'owner') role = get('SELECT role FROM project_member WHERE project_id=? AND user_id=?', project_id, user.id)?.role || role;
  return ROLE[role] >= LEVEL[level];
}

// ---------- routing ----------
const routes = [];
const r = (method, pattern, level, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), level, fn, ...opts });

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
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname, req);
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

function serveStatic(res, p, req) {
  let file;
  if (p.startsWith('/vendor/')) {
    const k = p.slice(8), base = Object.keys(VENDOR).find((v) => (v.endsWith('/') ? k.startsWith(v) : k === v));
    if (base) file = path.join(NM, VENDOR[base] + (base.endsWith('/') ? k.slice(base.length) : ''));
  } else file = path.join(WEB, p === '/' || !path.extname(p) ? 'index.html' : p);
  if (!file || !file.startsWith(file.includes('node_modules') ? NM : WEB) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end('Not found'); return; }
  const type = TYPES[extOf(file)] || 'application/octet-stream', buf = readFileSync(file);
  res.writeHead(200, { 'content-type': type, 'cache-control': p.startsWith('/vendor/') || p.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache', ...(/html/.test(type) ? pageHeaders(buf) : { 'x-content-type-options': 'nosniff' }) }); // built assets have hashed names
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
// Untrusted HTML (an agent's artifact, a component drawn live) runs at its own address with no origin of its own: it can't
// read Trace, its cookies or its API, even opened in a new window.
const sandboxed = (res, html) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(html); };

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

// ---------- shapes the UI uses ----------
const snapThumb = (id) => id && get('SELECT id, thumb_key, image_key, width, height, mime, file_key FROM snapshot WHERE id=?', id);
const projectName = (id) => id && get('SELECT name FROM project WHERE id=?', id)?.name;
const momentProject = (id) => { const m = get('SELECT project_id, route_guess FROM moment WHERE id=?', id); return m?.project_id || m?.route_guess; };

function momentCard(m) { // its pictures first, biggest first (a screen or a hero, not an icon), cards for code and docs after
  const assets = all(`SELECT a.id, a.name, a.type, a.tool, a.url, ma.first_snapshot_id, ma.last_snapshot_id FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id LEFT JOIN snapshot s ON s.id=ma.last_snapshot_id WHERE ma.moment_id=?
    ORDER BY (a.type IN ('code','doc','font','repo','pull request') OR json_extract(s.properties,'$.file.card') IS NOT NULL), COALESCE(s.width, 0) * COALESCE(s.height, 0) DESC`, m.id);
  return {
    ...strip({ ...m }),
    project_name: projectName(m.project_id), guess_name: projectName(m.route_guess),
    exploration_name: m.exploration_id && get('SELECT name FROM exploration WHERE id=?', m.exploration_id)?.name,
    asset_count: assets.length,
    assets: assets.slice(0, 8).map((a) => ({ id: a.id, name: a.name, type: a.type, tool: a.tool, url: a.url, after: snapThumb(a.last_snapshot_id), before: snapThumb(a.first_snapshot_id) })),
    top: all("SELECT kind, path, before, after FROM change WHERE moment_id=? AND kind NOT IN ('region','visual') ORDER BY weight DESC LIMIT 3", m.id),
    comments: get("SELECT COUNT(*) n FROM comment WHERE status='open' AND ((target_type='moment' AND target_id=?) OR (target_type='change' AND target_id IN (SELECT id FROM change WHERE moment_id=?)))", m.id, m.id).n,
  };
}

function projectCard(p) {
  const latest = get("SELECT * FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC LIMIT 1", p.id);
  // The cover is the app's first screen when Frames has walked it, else the newest work's biggest real picture (a
  // screen or a hero, not an icon), never a generated card for code, notes or agent logs.
  const visual = "a.tool != 'agent' AND a.type NOT IN ('repo','pull request','code','doc','font') AND json_extract(s.properties,'$.file.card') IS NULL";
  const screen = CS.walkedScreens(p.id)[0];
  const cover = !screen && latest && get(`SELECT ma.last_snapshot_id FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id JOIN snapshot s ON s.id=ma.last_snapshot_id WHERE ma.moment_id=? AND ${visual} ORDER BY COALESCE(s.width, 0) * COALESCE(s.height, 0) DESC LIMIT 1`, latest.id);
  const fallback = !screen && !cover && (get(`SELECT s.id FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND ${visual} ORDER BY a.updated_at DESC LIMIT 1`, p.id) || get('SELECT latest_snapshot_id id FROM asset WHERE project_id=? AND latest_snapshot_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1', p.id));
  return {
    ...strip({ ...p }),
    cover: screen ? { thumb_key: screen.thumb_key, image_key: screen.image_key, width: screen.width, height: screen.height } : snapThumb(cover?.last_snapshot_id || fallback?.id),
    tools: all('SELECT DISTINCT tool FROM asset WHERE project_id=?', p.id).map((x) => x.tool),
    moments: get("SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL", p.id).n,
    open_comments: get("SELECT COUNT(*) n FROM comment WHERE project_id=? AND status='open' AND parent_id IS NULL", p.id).n,
    last_activity: latest?.end_ts || p.updated_at,
    latest: latest && { id: latest.id, title: latest.title, actor_name: latest.actor_name, agent: latest.agent, end_ts: latest.end_ts, tool: latest.tool, magnitude: latest.magnitude, bucket: latest.bucket, basis: { type: latest.basis?.type, pixels: latest.basis?.pixels, properties: latest.basis?.properties }, event_count: latest.event_count, top: all("SELECT kind, path, before, after FROM change WHERE moment_id=? AND kind NOT IN ('region','visual') ORDER BY weight DESC LIMIT 3", latest.id) },
  };
}

const commentRow = (c) => ({ ...c, replies: all('SELECT * FROM comment WHERE parent_id=? ORDER BY created_at', c.id) });
function resolveTarget(type, id) {
  switch (type) {
    case 'moment': return momentProject(id);
    case 'change': { const c = get('SELECT moment_id FROM change WHERE id=?', id); return c && momentProject(c.moment_id); }
    case 'asset': return get('SELECT project_id FROM asset WHERE id=?', id)?.project_id;
    case 'reference': return get('SELECT project_id FROM reference WHERE id=?', id)?.project_id;
    case 'proposal': return get('SELECT project_id FROM proposal WHERE id=?', id)?.project_id;
    case 'issue': return get('SELECT project_id FROM issue WHERE id=?', id)?.project_id;
    case 'artifact': return get('SELECT project_id FROM artifact WHERE id=?', id)?.project_id;
    case 'project': return get('SELECT id FROM project WHERE id=?', id)?.id;
    case 'version': return get('SELECT id FROM project WHERE id=?', String(id).split(':')[0])?.id; // `${project}:${sha}`
  }
}

// ======================= routes =======================

// ---- session, home, activity ----
r('GET', '/api/me', null, ({ user }) => {
  const ws = workspace(), s = settings();
  return {
    user: { id: user.id, name: user.name, role: user.role, guest: !!user.guest, project_id: user.project_id },
    workspace: { name: ws.name, mode: ws.mode }, onboarded: s.onboarded, paused: s.paused,
    inbox: user.guest ? 0 : get("SELECT COUNT(*) n FROM moment WHERE status='draft'").n,
    projects: all("SELECT id, name, status FROM project WHERE status='active' ORDER BY updated_at DESC").filter((p) => !user.guest || p.id === user.project_id),
    unread: user.guest ? 0 : get('SELECT COUNT(*) n FROM notification WHERE user_id=? AND read=0', user.id).n,
  };
}, { guest: true });

r('GET', '/api/events', null, ({ user, res }) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const build = () => { try { return readFileSync(path.join(WEB, 'index.html'), 'utf8').match(/assets\/(index-[\w-]+\.js)/)?.[1] || ''; } catch { return ''; } }; // the UI build's entry: an open tab on an older one offers to reload
  res.write(`retry: 3000\n\nevent: build\ndata: ${JSON.stringify({ id: build() })}\n\n`);
  addClient(res, user);
  const ping = setInterval(() => res.write(`event: build\ndata: ${JSON.stringify({ id: build() })}\n\n`), 25000);
  res.on('close', () => clearInterval(ping));
}, { guest: true });

r('GET', '/api/home', 'read', () => ({
  projects: all("SELECT * FROM project WHERE status='active'").map(projectCard).sort((a, b) => b.last_activity - a.last_activity),
  archived: all("SELECT id, name FROM project WHERE status='archived'"),
  inbox: get("SELECT COUNT(*) n FROM moment WHERE status='draft'").n,
  unsorted: get("SELECT COUNT(*) n FROM moment WHERE status='draft' AND project_id IS NULL").n,
  capturing: get("SELECT COUNT(*) n FROM moment WHERE status='open'").n,
  sources: all('SELECT id, tool, name, status, error FROM source'),
}));

r('GET', '/api/activity', 'read', ({ query }) => {
  const p = query.project ? 'AND project_id=?' : '';
  const a = query.project ? [query.project] : [];
  return [
    ...all(`SELECT 'moment' kind, id, project_id, title text, actor_name who, updated_at ts, status FROM moment WHERE status='accepted' ${p} ORDER BY updated_at DESC LIMIT 30`, ...a),
    ...all(`SELECT 'comment' kind, id, project_id, body text, author_name who, created_at ts, target_type status FROM comment WHERE 1=1 ${p} ORDER BY created_at DESC LIMIT 30`, ...a),
    ...all(`SELECT 'proposal' kind, id, project_id, title text, author_id who, updated_at ts, status FROM proposal WHERE 1=1 ${p} ORDER BY updated_at DESC LIMIT 10`, ...a),
    ...all(`SELECT 'artifact' kind, id, project_id, title text, agent who, created_at ts, status FROM artifact WHERE 1=1 ${p} ORDER BY created_at DESC LIMIT 10`, ...a),
  ].sort((x, y) => y.ts - x.ts).slice(0, 40).map((x) => ({ ...x, project_name: projectName(x.project_id) }));
});

r('GET', '/api/notifications', null, ({ user }) => all('SELECT * FROM notification WHERE user_id=? ORDER BY created_at DESC LIMIT 50', user.id));
r('POST', '/api/notifications/read', null, ({ user }) => { run('UPDATE notification SET read=1 WHERE user_id=?', user.id); });

// Search everything: the work, notes in every block, case-study answers, and (for a project) its folders on disk.
r('GET', '/api/search', 'read', ({ query, user }) => {
  const q = String(query.q || '').trim(), pid = user.guest ? user.project_id : query.project || null;
  const results = R.search({ q, project: pid, types: query.types?.split(','), user, limit: 20 });
  const like = `%${q.replace(/[%_]/g, '')}%`, pp = pid ? [pid] : [];
  const notes = q.length < 2 ? [] : all(`SELECT id, project_id, block, kind, text, author_name, anchor, updated_at FROM note WHERE kind IN ('sticky','idea','constraint','insight','marker') AND text LIKE ? ${pid ? 'AND project_id=?' : ''} ORDER BY updated_at DESC LIMIT 8`, like, ...pp)
    .map((n) => ({ kind: n.kind, id: n.id, project_id: n.project_id, project_name: projectName(n.project_id), title: n.text.slice(0, 90), text: n.author_name, link: n.kind === 'insight' ? `#/p/${n.project_id}/canvas` : n.kind === 'marker' && n.anchor?.moment ? `#/m/${n.anchor.moment}` : `#/p/${n.project_id}/b/${n.block || 'brainstorm'}` }));
  const answers = q.length < 2 ? [] : all(`SELECT project_id, section, answer FROM case_answer WHERE answer LIKE ? ${pid ? 'AND project_id=?' : ''} LIMIT 5`, like, ...pp)
    .map((a) => ({ kind: 'answer', id: `${a.project_id}:${a.section}`, project_id: a.project_id, project_name: projectName(a.project_id), title: a.answer.slice(0, 90), text: `Case study · ${a.section}`, link: `#/p/${a.project_id}/casestudy/${a.section}` }));
  const p = pid && !user.guest && get('SELECT * FROM project WHERE id=?', pid);
  const folders = p ? CS.projectDirs(p) : [];
  const files = p && q.length >= 2 ? F.searchFiles(p, q, { folder: query.folder || undefined, limit: 8 }) : [];
  return { results: results.map((x) => ({ ...x, project_name: projectName(x.project_id) })), related: user.guest ? [] : R.expand(results), notes: [...notes, ...answers], files, folders };
}, { guest: true });
r('GET', '/api/projects/:id/file', 'read', ({ params, query, need }) => { need('read', params.id); return F.readFile(projectOr404(params.id), String(query.path || '')); });

// ---- the AI (Vercel AI Gateway; the person's own key) ----
const aiState = () => ({ ready: !!AI.aiKey(), model: AI.aiModel(), default_model: AI.DEFAULT_MODEL, from_env: !!process.env.AI_GATEWAY_API_KEY, hint: process.env.AI_GATEWAY_API_KEY ? `…${process.env.AI_GATEWAY_API_KEY.slice(-4)}` : hint('ai_gateway'), sync: settings().ai_sync !== false, sorted: MEM.sortedCounts() });
r('GET', '/api/ai', 'read', () => aiState());
r('PUT', '/api/ai', 'admin', ({ body, user }) => {
  if (typeof body.key === 'string') { const k = body.key.trim(); if (k) setSecret('ai_gateway', k); else deleteSecret('ai_gateway'); audit(user.name, 'user', k ? 'ai.key.set' : 'ai.key.remove', 'ai'); }
  const patch = {};
  if (typeof body.model === 'string') patch.ai_model = body.model.trim() || null;
  if (typeof body.sync === 'boolean') patch.ai_sync = body.sync;
  if (Object.keys(patch).length) setSettings(patch);
  return aiState();
});
r('POST', '/api/ai/test', 'admin', async () => { const t0 = now(); const m = await AI.complete({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 400, think: false }); return { ok: true, reply: String(m.content || '').trim().slice(0, 60), ms: now() - t0, model: AI.aiModel() }; });
// Ask: streams each tool the AI uses as it happens (one JSON object per line), then the answer.
r('POST', '/api/ai/chat', 'read', async ({ body, user, origin, res }) => {
  const question = String(body.question || '').trim();
  if (!question) throw err(400, 'Ask something first.');
  if (!AI.aiKey()) throw err(400, 'Add your Vercel AI Gateway key in Settings → AI to use the AI features.');
  const project = body.project ? get('SELECT id FROM project WHERE id=?', body.project)?.id : null;
  const { specs, call } = aiTools({ token: { name: user.name, project_ids: null }, origin, client: 'Trace AI', canWrite: can(user, 'edit') });
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const line = (o) => { if (!res.writableEnded) res.write(`${JSON.stringify(o)}\n`); };
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const peek = (out) => { try { const j = JSON.parse(out); return { link: j.link, proposal: j.proposal, count: Array.isArray(j.results) ? j.results.length : Array.isArray(j.files) ? j.files.length : Array.isArray(j.items) ? j.items.length : undefined }; } catch { return {}; } };
  try {
    const out = await AI.ask({ question, history: Array.isArray(body.history) ? body.history : [], project, context: typeof body.context === 'string' ? body.context.slice(0, 200) : null, tools: specs, call, signal: ac.signal,
      onStep: (st) => st.wait ? line({ type: 'wait', seconds: st.wait }) : line({ type: 'step', tool: st.tool, args: st.args, done: !!st.done, error: st.error ? String(st.result).replace(/^Error:\s*/, '').slice(0, 300) : undefined, ...(st.done && !st.error ? peek(st.result) : {}) }) });
    line({ type: 'answer', text: out.text, followups: out.followups, model: AI.aiModel() });
  } catch (e) { if (e.name !== 'AbortError') line({ type: 'error', error: e.status ? e.message : `Something went wrong: ${e.message}` }); }
  res.end();
});
// A file the AI proposed, written only when the person says so.
r('POST', '/api/ai/files/:id', 'edit', ({ params, user, need }) => {
  const pr = proposals.get(params.id);
  if (!pr) throw err(404, 'That proposal expired. Ask again.');
  need('edit', pr.project_id);
  const out = F.writeFile(projectOr404(pr.project_id), pr.path, pr.content);
  proposals.delete(params.id);
  audit(user.name, 'user', 'ai.file.write', `${out.root}/${out.rel}`);
  return out;
});
r('DELETE', '/api/ai/files/:id', 'edit', ({ params }) => { proposals.delete(params.id); });
r('POST', '/api/projects/:id/ai/insights', 'edit', ({ params, body, need }) => { need('edit', params.id); return AI.blockInsights(projectOr404(params.id), body.a, body.b); });
r('POST', '/api/moments/:id/ai/why', 'edit', ({ params, need }) => { const m = get('SELECT * FROM moment WHERE id=?', params.id); if (!m) throw err(404, 'No such change'); need('edit', m.project_id); return AI.findWhy(m); });
r('POST', '/api/projects/:id/ai/case-study', 'edit', ({ params, need }) => { need('edit', params.id); return AI.draftCaseStudy(projectOr404(params.id)); });
r('POST', '/api/projects/:id/ai/tasks', 'edit', ({ params, need }) => { need('edit', params.id); return AI.suggestTasks(projectOr404(params.id)); });
r('POST', '/api/projects/:id/ai/sync', 'edit', async ({ params, need }) => { need('edit', params.id); const p = projectOr404(params.id); const sorted = await AI.triageSessions(p, { batches: 2, later: false }); return { ...(await AI.syncProject(projectOr404(params.id), { force: true })), sorted }; });

// ---- to-do: tasks as a board (Home → To do, and each project's Tasks), linked "do this, then that" ----
r('GET', '/api/todo', 'read', ({ query, user }) => {
  const b = (settings().todo || {})[user.id] || {}, order = b.order || [];
  const projects = all("SELECT id, name FROM project WHERE status='active' ORDER BY created_at");
  const tint = Object.fromEntries(projects.map((p, i) => [p.id, i % 6])), name = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  const people = Object.fromEntries(all('SELECT id, name FROM user').map((u) => [u.id, u.name]));
  const ts = all(`SELECT * FROM issue WHERE status != 'closed' AND project_id IN (SELECT id FROM project WHERE status='active') ${query.project ? 'AND project_id=?' : ''} ORDER BY updated_at DESC LIMIT 300`, ...(query.project ? [query.project] : []));
  const rank = (id) => order.indexOf(id);
  ts.sort((x, y) => (rank(x.id) < 0 && rank(y.id) < 0 ? y.created_at - x.created_at : rank(x.id) < 0 ? -1 : rank(y.id) < 0 ? 1 : rank(x.id) - rank(y.id))); // new tasks first, then your order
  const ids = new Set(ts.map((t) => t.id));
  return {
    tasks: ts.map((t) => ({ id: t.id, title: t.title, body: t.body, status: t.status, project_id: t.project_id, project_name: name[t.project_id], tint: tint[t.project_id] ?? 0, assignee: t.assignee, assignee_type: t.assignee_type, assignee_name: t.assignee_type === 'user' ? people[t.assignee] || null : t.assignee, labels: t.labels, created_at: t.created_at, updated_at: t.updated_at, size: b.size?.[t.id] || '1x1', comments: get("SELECT COUNT(*) n FROM comment WHERE target_type='issue' AND target_id=?", t.id).n })),
    links: all("SELECT from_id, to_id FROM edge WHERE rel='then' AND from_type='issue' AND to_type='issue'").filter((l) => ids.has(l.from_id) && ids.has(l.to_id)),
  };
});
r('PUT', '/api/todo', 'read', ({ body, user }) => {
  const all_ = settings().todo || {}, b = all_[user.id] || {};
  if (Array.isArray(body.order) && body.order.every((x) => typeof x === 'string')) b.order = body.order.slice(0, 300);
  if (body.size && typeof body.size === 'object') b.size = Object.fromEntries(Object.entries({ ...b.size, ...body.size }).filter(([, v]) => ['1x1', '2x1', '1x2', '2x2'].includes(v)));
  setSettings({ todo: { ...all_, [user.id]: b } });
  return { ok: true };
});
const issueProject = (id) => get('SELECT project_id FROM issue WHERE id=?', id)?.project_id;
r('POST', '/api/todo/links', 'edit', ({ body, need }) => {
  if (!body.from || !body.to || body.from === body.to) throw err(400, 'Connect two different tasks.');
  need('edit', issueProject(body.from)); need('edit', issueProject(body.to));
  run("DELETE FROM edge WHERE rel='then' AND from_id=? AND to_id=?", body.to, body.from); // one direction only
  edge('issue', body.from, 'then', 'issue', body.to);
  broadcast('issue', { id: body.to, project_id: issueProject(body.to) });
  return { ok: true };
});
r('DELETE', '/api/todo/links', 'edit', ({ body, need }) => { need('edit', issueProject(body.from)); run("DELETE FROM edge WHERE rel='then' AND from_id=? AND to_id=?", body.from, body.to); broadcast('issue', { id: body.to, project_id: issueProject(body.to) }); });

// ---- onboarding & demo ----
r('POST', '/api/onboarding', 'admin', ({ body }) => {
  if (body.mode) update('workspace', WS, { mode: body.mode === 'team' ? 'team' : 'solo' });
  if (body.name) update('workspace', WS, { name: body.name });
  if (body.done) setSettings({ onboarded: true });
});
r('POST', '/api/demo', 'admin', async () => seedDemo({ addReference: REF.addReference }));

// ---- projects ----
r('POST', '/api/projects', 'edit', ({ body, user }) => {
  const name = String(body.name || '').trim();
  if (!name) throw err(400, 'Give the project a name.');
  const p = { id: uid('p'), workspace_id: WS, name, brief: body.brief || '', status: 'active', pinned: [], do_not_capture: [], created_at: now(), updated_at: now() };
  insert('project', p);
  E.updateCentroid(p.id);
  E.ftsPut('project', p.id, p.id, name, p.brief);
  if (body.from_moment) { E.moveMoment(body.from_moment, p.id, user); }
  audit(user.name, 'user', 'project.create', p.id);
  broadcast('project', { id: p.id });
  return p;
});

r('GET', '/api/projects/:id', 'read', async ({ params, need, user }) => {
  need('read', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  if (!p) throw err(404, 'No such project');
  const counts = {};
  for (const [k, sql] of Object.entries({ timeline: "SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL", references: 'SELECT COUNT(*) n FROM reference WHERE project_id=?', files: 'SELECT COUNT(*) n FROM asset WHERE project_id=?', decisions: 'SELECT COUNT(*) n FROM decision WHERE project_id=?', issues: "SELECT COUNT(*) n FROM issue WHERE project_id=? AND status IN ('open','in_progress')", proposals: "SELECT COUNT(*) n FROM proposal WHERE project_id=? AND status IN ('open','changes_requested')", artifacts: "SELECT COUNT(*) n FROM artifact WHERE project_id=? AND status IN ('proposed','working','queued')", explorations: "SELECT COUNT(*) n FROM exploration WHERE project_id=? AND status='open'" })) counts[k] = get(sql, p.id).n;
  return {
    ...projectCard(p), counts,
    people: all('SELECT DISTINCT actor_name name, agent FROM moment WHERE project_id=? AND status=? LIMIT 30', p.id, 'accepted'),
    members: all('SELECT pm.user_id, pm.role, u.name FROM project_member pm JOIN user u ON u.id=pm.user_id WHERE pm.project_id=?', p.id),
    explorations: all('SELECT * FROM exploration WHERE project_id=? ORDER BY created_at DESC', p.id),
    can_edit: can(user, 'edit', p.id), can_review: can(user, 'review', p.id),
  };
}, { guest: true });

r('PATCH', '/api/projects/:id', 'edit', ({ params, body, need, user }) => {
  need('edit', params.id);
  const patch = {};
  for (const k of ['name', 'brief', 'status', 'pinned', 'do_not_capture', 'folders']) if (body[k] !== undefined) patch[k] = body[k];
  update('project', params.id, { ...patch, updated_at: now() });
  if (patch.name || patch.brief !== undefined) { E.updateCentroid(params.id); const p = get('SELECT * FROM project WHERE id=?', params.id); E.ftsPut('project', p.id, p.id, p.name, p.brief); }
  if (patch.folders) MEM.remap(); // AI memory from these folders now belongs to this project
  audit(user.name, 'user', 'project.update', params.id, Object.keys(patch));
  broadcast('project', { id: params.id, project_id: params.id });
  return strip(get('SELECT * FROM project WHERE id=?', params.id));
});

// Hard delete: the project, everything captured into it, and stored files nothing else uses.
r('DELETE', '/api/projects/:id', 'admin', ({ params, user }) => {
  const id = params.id;
  const keys = new Set(all('SELECT s.image_key, s.thumb_key, s.file_key FROM snapshot s JOIN asset a ON a.id=s.asset_id WHERE a.project_id=?', id).flatMap((s) => [s.image_key, s.thumb_key, s.file_key]).concat(all('SELECT file_key, thumb_key FROM reference WHERE project_id=?', id).flatMap((x) => [x.file_key, x.thumb_key])).filter(Boolean));
  const copies = (get('SELECT folders FROM project WHERE id=?', id)?.folders || []).filter((d) => path.resolve(d).startsWith(F.DATA_FOLDERS + path.sep)); // a folder Trace copied in goes with it; a linked one stays where it is
  for (const s of all("SELECT id FROM source WHERE tool='folder' AND project_id=?", id)) disconnect(s.id, user); // and nothing keeps watching for it
  tx(() => {
    const mids = all('SELECT id FROM moment WHERE project_id=? OR (project_id IS NULL AND route_guess=?)', id, id).map((m) => m.id);
    for (const m of mids) for (const t of ['change', 'moment_asset', 'moment_event']) run(`DELETE FROM ${t} WHERE moment_id=?`, m);
    run('DELETE FROM moment WHERE project_id=? OR (project_id IS NULL AND route_guess=?)', id, id);
    run('DELETE FROM snapshot WHERE asset_id IN (SELECT id FROM asset WHERE project_id=?)', id);
    run('DELETE FROM ref_link WHERE ref_id IN (SELECT id FROM reference WHERE project_id=?)', id);
    for (const t of ['asset', 'comment', 'reference', 'decision', 'exploration', 'proposal', 'issue', 'artifact', 'deck', 'guest_link', 'summary', 'project_member', 'route_rule']) run(`DELETE FROM ${t} WHERE project_id=?`, id);
    run('DELETE FROM search_fts WHERE project_id=?', id);
    run("DELETE FROM edge WHERE (to_type='project' AND to_id=?)", id);
    run('DELETE FROM project WHERE id=?', id);
  });
  let removed = 0;
  for (const k of keys) {
    const used = get('SELECT 1 FROM snapshot WHERE ? IN (image_key, thumb_key, file_key) UNION SELECT 1 FROM reference WHERE ? IN (file_key, thumb_key) LIMIT 1', k, k);
    if (!used) { try { rmSync(filePath(k)); removed++; } catch {} }
  }
  for (const d of copies) rmSync(d, { recursive: true, force: true });
  audit(user.name, 'user', 'project.delete', id, { files_removed: removed });
  broadcast('project', { id, deleted: true });
  return { ok: true, files_removed: removed };
});

r('POST', '/api/projects/:id/brief/draft', 'edit', async ({ params, need }) => {
  need('edit', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  if (AI.aiKey()) return { brief: await AI.draftBrief(p), by: 'ai' }; // read from the docs and the work; the rules' version is a template
  const recent = all("SELECT title, summary, tags FROM moment WHERE project_id=? AND status='accepted' ORDER BY end_ts DESC LIMIT 25", p.id);
  return { brief: W.draftBrief(p, recent) };
});
r('GET', '/api/projects/:id/summary', 'read', async ({ params, need }) => { need('read', params.id); return R.summaries(get('SELECT * FROM project WHERE id=?', params.id)); }, { guest: true });

r('GET', '/api/projects/:id/timeline', 'read', ({ params, query, need }) => {
  need('read', params.id);
  const where = ["m.project_id=?", "m.status='accepted'"], args = [params.id];
  if (query.exploration) { where.push('m.exploration_id=?'); args.push(query.exploration); } else where.push('m.exploration_id IS NULL');
  if (query.tool) { where.push('m.tool=?'); args.push(query.tool); }
  if (query.person) { where.push('(m.actor_name=? OR m.agent=?)'); args.push(query.person, query.person); }
  if (query.type) { where.push("json_extract(m.basis,'$.type')=?"); args.push(query.type); }
  if (query.from) { where.push('m.end_ts>=?'); args.push(+query.from); }
  if (query.to) { where.push('m.end_ts<=?'); args.push(+query.to); }
  if (query.before) { where.push('m.end_ts<?'); args.push(+query.before); }
  const limit = Math.min(100, +query.limit || 30);
  const moments = all(`SELECT m.* FROM moment m WHERE ${where.join(' AND ')} ORDER BY m.end_ts DESC LIMIT ?`, ...args, limit).map((m) => ({ kind: 'moment', ts: m.end_ts, ...momentCard(m) }));
  const lo = moments.at(-1)?.ts ?? 0, hi = query.before ? +query.before : Infinity;
  const artifacts = query.exploration || query.tool || query.person || query.type ? [] : all("SELECT * FROM artifact WHERE project_id=? AND status != 'discarded' AND created_at < ? AND created_at >= ?", params.id, hi === Infinity ? now() + 1 : hi, moments.length === limit ? lo : 0).map((a) => ({ kind: 'artifact', ts: a.created_at, ...a, context_pack: undefined }));
  return { items: [...moments, ...artifacts].sort((a, b) => b.ts - a.ts), more: moments.length === limit, filters: { tools: all("SELECT DISTINCT tool FROM moment WHERE project_id=? AND status='accepted'", params.id).map((x) => x.tool), people: all("SELECT DISTINCT actor_name FROM moment WHERE project_id=? AND status='accepted'", params.id).map((x) => x.actor_name), types: all("SELECT DISTINCT json_extract(basis,'$.type') t FROM moment WHERE project_id=? AND status='accepted'", params.id).map((x) => x.t).filter(Boolean) } };
}, { guest: true });

r('GET', '/api/projects/:id/files', 'read', ({ params, need }) => {
  need('read', params.id);
  return sortFiles(all('SELECT a.*, s.thumb_key, s.image_key, s.mime, s.file_key, s.width, s.height, s.properties, (SELECT COUNT(*) FROM snapshot WHERE asset_id=a.id) versions FROM asset a LEFT JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? ORDER BY a.updated_at DESC', params.id)
    .map((a) => ({ ...a, properties: { file: a.properties?.file, page: a.properties?.page, lottie: a.properties?.lottie, video: a.properties?.video, pdf: a.properties?.pdf } }))); // each with its role: design, UI code, the app's pictures, or hidden and why
}, { guest: true });

r('PUT', '/api/projects/:id/members', 'admin', ({ params, body }) => {
  run('DELETE FROM project_member WHERE project_id=?', params.id);
  for (const m of body.members || []) insert('project_member', { project_id: params.id, user_id: m.user_id, role: m.role });
});

// ---- assets ----
r('GET', '/api/assets/:id', 'read', ({ params, need }) => {
  const a = get('SELECT * FROM asset WHERE id=?', params.id);
  if (!a) throw err(404, 'No such file');
  need('read', a.project_id);
  return {
    ...a, project_name: projectName(a.project_id),
    versions: all('SELECT s.id, s.thumb_key, s.image_key, s.file_key, s.mime, s.width, s.height, s.created_at, s.properties, s.flags, e.actor, e.type, e.payload FROM snapshot s LEFT JOIN event e ON e.id=s.event_id WHERE s.asset_id=? ORDER BY s.created_at DESC', a.id)
      .map((s) => ({ ...s, payload: { label: s.payload?.label, message: s.payload?.message, version_id: s.payload?.version_id }, properties: { file: s.properties?.file, page: s.properties?.page, lottie: s.properties?.lottie, video: s.properties?.video, pdf: s.properties?.pdf, image: s.properties?.image, root: s.properties?.root, nodes: s.properties?.nodes ? Object.keys(s.properties.nodes).length : undefined } })),
    moments: all("SELECT m.id, m.title, m.end_ts, m.bucket, m.magnitude, m.actor_name FROM moment_asset ma JOIN moment m ON m.id=ma.moment_id WHERE ma.asset_id=? AND m.status='accepted' ORDER BY m.end_ts DESC", a.id),
    comments: all("SELECT * FROM comment WHERE target_type='asset' AND target_id=? AND parent_id IS NULL ORDER BY created_at", a.id).map(commentRow),
  };
}, { guest: true });

// A component version as a live page (compiled against its project), for a sandboxed iframe beside the picture.
r('GET', '/api/snapshots/:id/live', 'read', async ({ params, need, query, res }) => {
  const s = get('SELECT s.id, s.text, a.name, a.path, a.project_id, a.source_id FROM snapshot s JOIN asset a ON a.id=s.asset_id WHERE s.id=?', params.id);
  if (!s) throw err(404, 'No such version');
  need('read', s.project_id);
  const src = get('SELECT * FROM source WHERE id=?', s.source_id);
  if (!RENDERABLE.test(s.name) || src?.tool !== 'folder' || !src.scope?.path) throw err(400, 'Only component files from a watched folder can be drawn live.');
  const page = await livePage({ file: path.join(src.scope.path, s.path || s.name), source: s.text || '' });
  if (!page) throw err(422, 'This version doesn’t compile against the project as it is now.');
  if (query.page) return sandboxed(res, page.html); // the frame itself
  return page;
}, { guest: true });

// ---- the tree: every version as a node, joined to the one it came from, with when and who ----
// Project: accepted changes (explorations branch off the main line; "evolved into" links drawn dashed).
// One component: each version of that file, drawn. Code saved while an AI was working counts as the AI's.
r('GET', '/api/projects/:id/tree', 'read', ({ params, query, need }) => {
  need('read', params.id);
  const ex = MEM.exchangesFor(params.id).reverse(); // oldest first
  const aiAt = (ts) => { let hit = null; for (const e of ex) { if (e.ts > ts) break; if (ts - e.ts < 30 * 60000) hit = e; } return hit && { tool: hit.tool, asked: hit.asked.slice(0, 160) }; };
  const components = all("SELECT a.id, a.name, a.path, (SELECT COUNT(*) FROM snapshot WHERE asset_id=a.id) versions FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND json_extract(s.properties,'$.component.mode') IS NOT NULL ORDER BY a.updated_at DESC", params.id);
  if (query.asset) {
    const a = get('SELECT * FROM asset WHERE id=? AND project_id=?', query.asset, params.id);
    if (!a) throw err(404, 'No such file in this project');
    const snaps = all('SELECT s.id, s.prev_id, s.image_key, s.thumb_key, s.width, s.height, s.created_at, s.properties, e.actor, e.ts FROM snapshot s LEFT JOIN event e ON e.id=s.event_id WHERE s.asset_id=? ORDER BY s.created_at', a.id);
    return {
      mode: 'asset', asset: { id: a.id, name: a.name, path: a.path }, components, lanes: [{ id: 'main', name: a.name }], links: [],
      nodes: snaps.map((s, i) => {
        const ai = aiAt(s.ts || s.created_at);
        const m = get("SELECT m.id, m.title, m.agent, m.actor_name FROM moment_asset ma JOIN moment m ON m.id=ma.moment_id WHERE ma.last_snapshot_id=? AND m.status != 'discarded' LIMIT 1", s.id);
        return { id: s.id, parent: s.prev_id, lane: 'main', title: `Version ${i + 1}`, when: s.ts || s.created_at, who: m?.agent || (ai ? ai.tool : s.actor || m?.actor_name || 'Someone'), agent: !!(m?.agent || ai), asked: ai?.asked, image: s.image_key ? { image_key: s.image_key, thumb_key: s.thumb_key, width: s.width, height: s.height } : null, drawn: !!s.properties?.component?.mode, error: s.properties?.component?.error, moment: m?.id, moment_title: m?.title };
      }),
    };
  }
  const ms = all("SELECT * FROM moment WHERE project_id=? AND status='accepted' ORDER BY end_ts", params.id);
  const lanes = [{ id: 'main', name: 'Main line' }, ...all('SELECT id, name FROM exploration WHERE project_id=? ORDER BY created_at', params.id)];
  const last = {};
  const nodes = ms.map((m) => {
    const lane = m.exploration_id || 'main';
    const parent = last[lane] || (lane !== 'main' ? [...ms].reverse().find((x) => !x.exploration_id && x.end_ts <= m.end_ts)?.id : null) || null;
    last[lane] = m.id;
    const ai = !m.agent && aiAt(m.start_ts);
    return { id: m.id, parent, lane, title: m.title, when: m.end_ts, who: m.agent || (ai ? ai.tool : m.actor_name), agent: !!(m.agent || ai), asked: ai?.asked, tool: m.tool, sentence: m.sentence || [{ t: m.summary || '' }], image: visualSnap(m.id), files: get('SELECT COUNT(*) n FROM moment_asset WHERE moment_id=?', m.id).n };
  });
  const ids = new Set(nodes.map((n) => n.id));
  return { mode: 'project', components, lanes, nodes, links: all("SELECT from_id, to_id FROM edge WHERE rel='evolved-into' AND from_type='moment'").filter((l) => ids.has(l.from_id) && ids.has(l.to_id)) };
}, { guest: true });

// ---- history: the project's folder as git, every version a node; run, read, download, roll back, push, @claude ----
const hxProject = (id, need, level = 'read') => { need(level, id); const p = get('SELECT * FROM project WHERE id=?', id); if (!p) throw err(404, 'No such project'); return p; };
const hxComments = (pid, sha) => all("SELECT * FROM comment WHERE target_type='version' AND target_id=? AND parent_id IS NULL ORDER BY created_at", `${pid}:${sha}`).map(commentRow);
r('GET', '/api/projects/:id/history', 'read', ({ params, need }) => HX.history(hxProject(params.id, need)), { guest: true });
r('POST', '/api/projects/:id/history/start', 'edit', ({ params, need, user }) => HX.start(hxProject(params.id, need, 'edit'), user));
r('POST', '/api/projects/:id/history/save', 'edit', async ({ params, need, user, body }) => ({ sha: await HX.save(hxProject(params.id, need, 'edit'), { message: body.message, user }) }));
r('POST', '/api/projects/:id/history/push', 'edit', ({ params, need, body }) => HX.push(hxProject(params.id, need, 'edit'), body));
r('POST', '/api/projects/:id/history/install', 'edit', async ({ params, need, body, user }) => { // a fix sends { add: { name, range | latest, dev } }
  const p = hxProject(params.id, need, 'edit');
  const add = body?.add?.name ? { name: String(body.add.name), dev: !!body.add.dev, range: body.add.latest ? `^${await HX.latestOf(body.add.name)}` : String(body.add.range || '') } : null;
  if (add && (!/^@?[\w.-]+(\/[\w.-]+)?$/.test(add.name) || !/^[\w.^~<>=*| -]+$/.test(add.range))) throw err(400, 'That isn’t a package and version.');
  if (add) audit(user.name, 'user', 'packages.add', p.id, add);
  return HX.install(p, { add });
});
r('POST', '/api/projects/:id/history/claude/stop', 'edit', ({ params, need }) => HX.stopAgent(hxProject(params.id, need, 'edit')));
r('GET', '/api/projects/:id/history/packages', 'read', ({ params, need }) => HX.packages(hxProject(params.id, need)), { guest: true });
r('GET', '/api/projects/:id/history/:sha', 'read', async ({ params, need }) => { const p = hxProject(params.id, need); const v = await HX.version(p, params.sha); return { ...v, comments: hxComments(p.id, v.sha) }; }, { guest: true });
r('GET', '/api/projects/:id/history/:sha/diff', 'read', async ({ params, query, need }) => ({ patch: await HX.diff(hxProject(params.id, need), params.sha, query.path) }), { guest: true });
r('GET', '/api/projects/:id/history/:sha/check', 'read', ({ params, query, need }) => CHK.check(hxProject(params.id, need), params.sha, { ask: query.ask }), { guest: true });
r('POST', '/api/projects/:id/history/:sha/design-doc', 'edit', async ({ params, need }) => { // proposed, like the AI's files: the person writes them
  const p = hxProject(params.id, need, 'edit'), dir = projectDirs(p)[0];
  if (!dir) throw err(400, 'Add the project’s folder first.');
  const { files } = await CHK.designDoc(p, params.sha);
  for (const [k, v] of proposals) if (now() - v.at > 3600000) proposals.delete(k);
  return { files: files.map((x) => { const id = uid('pf'); proposals.set(id, { project_id: p.id, path: x.path, content: x.content, why: 'Written by Trace from what runs', at: now() }); return { ...x, proposal: id, exists: existsSync(path.join(dir, x.path)) }; }) };
});
r('GET', '/api/projects/:id/insights/chats', 'read', async ({ params, need }) => (await import('./chats.js')).chatInsights(hxProject(params.id, need)), { guest: true });
r('GET', '/api/projects/:id/branches', 'read', ({ params, need }) => HX.branches(hxProject(params.id, need)), { guest: true });
r('GET', '/api/projects/:id/rejected', 'read', ({ params, need }) => CHK.noList(hxProject(params.id, need)), { guest: true });
r('GET', '/api/projects/:id/history/:sha/match', 'read', ({ params, query, need }) => { // ?with=figma, another version (a sha, or now), or another project's walk (p_…, or p_…:sha): a prototype
  const w = String(query.with || 'figma'), [oid, osha] = /^p_/.test(w) ? w.split(':') : [];
  return CHK.matchProject(hxProject(params.id, need), params.sha, oid ? { against: osha || 'now', other: hxProject(oid, need) } : { against: w });
}, { guest: true });
r('GET', '/api/projects/:id/history/:sha/queue', 'read', ({ params, need }) => CHK.queue(hxProject(params.id, need), params.sha), { guest: true });
r('POST', '/api/projects/:id/history/:sha/stress', 'edit', ({ params, need }) => STRESS.stressApp(hxProject(params.id, need, 'edit'), params.sha));
r('GET', '/api/projects/:id/history/:sha/stress', 'read', ({ params, need }) => STRESS.lastStress(hxProject(params.id, need).id, params.sha) || { pages: [] }, { guest: true });
r('GET', '/api/projects/:id/history/:sha/why', 'read', async ({ params, query, need }) => { const f = String(query.file || ''); if (!f) throw err(400, 'Which file?'); const ch = await HX.lastChanges(hxProject(params.id, need), [f], params.sha); return { file: f, last: ch[f] || null }; }, { guest: true }); // why a part looks as it does: its file's last change and the ask behind it
// ---- the design canvas (design.js): the working copy with the picker in it, its edits, the session now, Ask ----
r('GET', '/api/projects/:id/design', 'read', ({ params, need, origin }) => DS.design(hxProject(params.id, need), origin));
r('POST', '/api/projects/:id/design/open', 'edit', ({ params, need, origin }) => DS.design(hxProject(params.id, need, 'edit'), origin, { start: true }));
r('POST', '/api/projects/:id/design/edits', 'edit', ({ params, need, body }) => {
  const p = hxProject(params.id, need, 'edit'), e = body || {};
  if (!/^[a-z-]{2,30}$/.test(e.prop || '') || String(e.to ?? '').length > (e.prop === 'text' ? 2000 : 120) || String(e.path || '').length > 2000) throw err(400, 'That isn’t a property change.');
  return DS.putEdit(p, e, SC.screens(p, 'now').tokens?.tokens || [], { write: !!e.write });
});
r('DELETE', '/api/projects/:id/design/edits/:eid', 'edit', async ({ params, need }) => ({ edits: await DS.dropEdit(hxProject(params.id, need, 'edit'), params.eid) }));
r('GET', '/api/projects/:id/design/code', 'read', ({ params, query, need }) => DS.readCode(hxProject(params.id, need), query.file)); // the Code tab
r('POST', '/api/projects/:id/design/code', 'edit', ({ params, body, need }) => DS.writeCode(hxProject(params.id, need, 'edit'), body?.file, body?.text, body?.hash));
r('POST', '/api/projects/:id/design/send', 'edit', ({ params, need, body }) => DS.sendEdits(hxProject(params.id, need, 'edit'), String(body?.note || '').slice(0, 1000)));
r('POST', '/api/projects/:id/design/take', 'edit', ({ params, need }) => DS.takeEdits(hxProject(params.id, need, 'edit')));
r('POST', '/api/projects/:id/design/done', 'edit', ({ params, need, body }) => ({ edits: DS.doneEdits(hxProject(params.id, need, 'edit'), Array.isArray(body?.ids) ? body.ids : []) }));
r('GET', '/api/projects/:id/design/session', 'read', ({ params, need }) => DS.sessionNow(hxProject(params.id, need)));
r('POST', '/api/projects/:id/design/locate', 'read', ({ params, need, body }) => DS.locate(hxProject(params.id, need), body || {}));
r('POST', '/api/projects/:id/design/ask', 'read', ({ params, need, body }) => DS.askDesign(hxProject(params.id, need), body || {}));
r('GET', '/api/projects/:id/history/:sha/feedback', 'read', async ({ params, query, need }) => (await import('./evidence.js')).partComments(hxProject(params.id, need), params.sha, query.key || null, query.comp || null), { guest: true });
r('GET', '/api/projects/:id/history/:sha/frames', 'read', ({ params, need }) => FR.discover(hxProject(params.id, need), params.sha === 'now' ? 'now' : params.sha), { guest: true });
r('GET', '/api/projects/:id/history/:sha/screens', 'read', ({ params, need }) => SC.screens(hxProject(params.id, need), params.sha), { guest: true });
r('POST', '/api/projects/:id/history/:sha/screens', 'edit', ({ params, need, body }) => SC.walkApp(hxProject(params.id, need, 'edit'), params.sha, { force: !!body?.force, full: !!body?.full, device: body?.device }));
r('GET', '/api/projects/:id/history/:sha/files', 'read', ({ params, need }) => HX.files(hxProject(params.id, need), params.sha), { guest: true });
r('GET', '/api/projects/:id/history/:sha/file', 'read', ({ params, query, need }) => HX.file(hxProject(params.id, need), params.sha, query.path), { guest: true });
r('GET', '/api/projects/:id/history/:sha/zip', 'read', async ({ params, need, res, user }) => {
  const { name, buf } = await HX.archive(hxProject(params.id, need), params.sha);
  audit(user.name, 'user', 'history.download', params.id, { sha: params.sha });
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name.replace(/[^\w.-]+/g, '-')}.zip"`, 'content-length': buf.length });
  res.end(buf);
});
r('POST', '/api/projects/:id/history/:sha/rollback', 'edit', async ({ params, need, user }) => { const sha = await HX.rollback(hxProject(params.id, need, 'edit'), params.sha, user); audit(user.name, 'user', 'history.rollback', params.id, { to: params.sha, sha }); return { sha }; });
r('POST', '/api/projects/:id/history/:sha/run', 'edit', ({ params, need, body }) => HX.startLive(hxProject(params.id, need, 'edit'), params.sha, { mode: body?.mode }));
r('POST', '/api/projects/:id/history/:sha/stop', 'edit', ({ params, need }) => HX.stopLive(hxProject(params.id, need, 'edit'), params.sha));

r('GET', '/api/snapshots/:id/text', 'read', ({ params, need }) => {
  const s = get('SELECT s.text, a.project_id FROM snapshot s JOIN asset a ON a.id=s.asset_id WHERE s.id=?', params.id);
  if (!s) throw err(404, 'No such version');
  need('read', s.project_id);
  return { text: s.text || '' };
}, { guest: true });

r('GET', '/api/compare', 'read', async ({ query, need }) => {
  const a = get('SELECT * FROM snapshot WHERE id=?', query.a), b = get('SELECT * FROM snapshot WHERE id=?', query.b);
  if (!a || !b) throw err(404, 'Pick two versions');
  const asset = get('SELECT * FROM asset WHERE id=?', b.asset_id);
  need('read', asset.project_id);
  return { before: snapThumb(a.id), after: snapThumb(b.id), diff: await diffSnapshots(a, b, asset.type) };
}, { guest: true });

// ---- inbox & moments ----
r('GET', '/api/inbox', 'review', () => {
  const rows = all("SELECT * FROM moment WHERE status IN ('open','draft') ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, end_ts DESC LIMIT 300");
  return rows.map((m) => ({ ...momentCard(m), rows: changelog(m).rows, image: visualSnap(m.id), source_name: get('SELECT name FROM source WHERE id=?', m.source_id)?.name }));
});

r('GET', '/api/moments/:id', 'read', ({ params, need }) => {
  const m = get('SELECT * FROM moment WHERE id=?', params.id);
  if (!m) throw err(404, 'This moment was merged or deleted.');
  need('read', m.project_id || m.route_guess);
  const assets = all('SELECT a.*, ma.first_snapshot_id, ma.last_snapshot_id FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id WHERE ma.moment_id=?', m.id).map((a) => {
    const after = get('SELECT id, image_key, thumb_key, file_key, mime, width, height, properties, flags, text FROM snapshot WHERE id=?', a.last_snapshot_id);
    const before = a.first_snapshot_id && get('SELECT id, image_key, thumb_key, file_key, mime, width, height, properties, text FROM snapshot WHERE id=?', a.first_snapshot_id);
    const lite = (s) => s && { ...s, text: s.text?.slice(0, 4000), properties: { file: s.properties?.file, page: s.properties?.page, lottie: s.properties?.lottie, video: s.properties?.video, root: s.properties?.root, image: s.properties?.image, code: s.properties?.code ? { message: s.properties.code.message, sha: s.properties.code.sha } : undefined, component: s.properties?.component } };
    return { id: a.id, name: a.name, type: a.type, tool: a.tool, url: a.url, path: a.path, before: lite(before), after: lite(after) };
  });
  const ids = [m.id, ...all('SELECT id FROM change WHERE moment_id=?', m.id).map((c) => c.id)];
  const near = (op, dir) => m.project_id && get(`SELECT id, title FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL AND end_ts ${op} ? ORDER BY end_ts ${dir} LIMIT 1`, m.project_id, m.end_ts);
  return {
    ...momentCard(m), assets,
    changes: all('SELECT * FROM change WHERE moment_id=? ORDER BY weight DESC', m.id).map((c) => ({ ...c, category: W.category(c), attr: W.attrName(c), node: c.path.split(' › ')[0].replace(/\s*\([A-Z]+\)$/, '') })),
    comments: all(`SELECT * FROM comment WHERE parent_id IS NULL AND COALESCE(kind,'') != 'reasoning' AND ((target_type='moment' AND target_id=?) OR (target_type='change' AND target_id IN (${ids.map(() => '?').join(',')}))) ORDER BY created_at`, m.id, ...ids).map(commentRow),
    journey: (m.project_id || m.route_guess) ? journey(m.project_id || m.route_guess, { moment: m }) : null,
    evolved_from: all("SELECT m.id, m.title FROM edge e JOIN moment m ON m.id=e.from_id WHERE e.rel='evolved-into' AND e.to_id=? AND m.status != 'discarded'", m.id),
    evolved_into: all("SELECT m.id, m.title FROM edge e JOIN moment m ON m.id=e.to_id WHERE e.rel='evolved-into' AND e.from_id=? AND m.status != 'discarded'", m.id),
    events: all('SELECT e.type, COUNT(*) n FROM moment_event me JOIN event e ON e.id=me.event_id WHERE me.moment_id=? GROUP BY e.type', m.id),
    artifacts: all("SELECT id, title, type, status, agent FROM artifact WHERE moment_id=? OR source_comment_id IN (SELECT id FROM comment WHERE target_type='moment' AND target_id=?)", m.id, m.id),
    decisions: all("SELECT * FROM decision WHERE source_type='moment' AND source_id=?", m.id),
    links: E.momentLinks(m),
    prev: near('<', 'DESC'), next: near('>', 'ASC'),
  };
}, { guest: true });

const editMoment = (id, need) => need('edit', momentProject(id));
r('POST', '/api/moments/:id/accept', 'edit', async ({ params, body, user, need }) => {
  editMoment(params.id, need);
  if (body.project_id) E.moveMoment(params.id, body.project_id, user);
  return strip(await E.acceptMoment(params.id, user));
});
r('POST', '/api/moments/:id/discard', 'edit', ({ params, user, need }) => { editMoment(params.id, need); E.discardMoment(params.id, user); });
r('POST', '/api/moments/:id/restore', 'edit', async ({ params, need }) => { // undo for a discard
  editMoment(params.id, need);
  run("UPDATE moment SET status='draft', updated_at=? WHERE id=? AND status='discarded'", now(), params.id);
  E.enqueue('index', { moment_id: params.id });
});
r('POST', '/api/moments/:id/unfile', 'edit', ({ params, user, need }) => { editMoment(params.id, need); E.unfileMoment(params.id, user); });
r('POST', '/api/moments/:id/split', 'edit', async ({ params, body, need }) => { editMoment(params.id, need); return { id: await E.splitMoment(params.id, body.asset_ids || []) }; });
r('POST', '/api/moments/:id/merge', 'edit', async ({ params, need }) => { editMoment(params.id, need); return { id: await E.mergeWithPrevious(params.id) }; });
r('POST', '/api/moments/:id/mute', 'edit', ({ params, need }) => { editMoment(params.id, need); return { muted: E.muteKind(params.id) }; });
r('POST', '/api/moments/:id/redescribe', 'edit', ({ params, need }) => { editMoment(params.id, need); update('moment', params.id, { edited: 0 }); E.enqueue('describe', { moment_id: params.id }); }); // the changelog's refresh: written again from the diff
r('PATCH', '/api/moments/:id', 'edit', ({ params, body, user, need }) => {
  editMoment(params.id, need);
  if (body.project_id !== undefined) E.moveMoment(params.id, body.project_id, user);
  const patch = {};
  for (const k of ['title', 'summary', 'why', 'exploration_id', 'tags']) if (body[k] !== undefined) patch[k] = body[k];
  if (Object.keys(patch).length) {
    update('moment', params.id, { ...patch, edited: 1, updated_at: now() });
    const m = get('SELECT * FROM moment WHERE id=?', params.id);
    E.ftsPut('moment', m.id, m.project_id || m.route_guess, m.title, `${m.summary} ${m.why || ''}`);
  }
  if (body.pinned !== undefined) {
    const m = get('SELECT * FROM moment WHERE id=?', params.id), p = get('SELECT pinned FROM project WHERE id=?', m.project_id);
    const pins = (p?.pinned || []).filter((x) => !(x.type === 'moment' && x.id === m.id));
    if (body.pinned) pins.unshift({ type: 'moment', id: m.id, title: m.title, label: body.pin_label || 'Key moment' });
    update('project', m.project_id, { pinned: pins });
    update('moment', m.id, { pinned: body.pinned ? 1 : 0 });
  }
  broadcast('moment', { id: params.id });
  return strip(get('SELECT * FROM moment WHERE id=?', params.id));
});
r('POST', '/api/inbox/bulk', 'edit', async ({ body, user }) => {
  const done = [], failed = [];
  for (const id of body.ids || []) {
    try {
      if (body.action === 'accept') { if (body.project_id) E.moveMoment(id, body.project_id, user); await E.acceptMoment(id, user); }
      else if (body.action === 'discard') E.discardMoment(id, user);
      else if (body.action === 'move') E.moveMoment(id, body.project_id, user);
      done.push(id);
    } catch (e) { failed.push({ id, error: e.message }); }
  }
  return { done, failed };
});

// ---- capture: uploads & links ----
r('POST', '/api/upload', 'edit', ({ raw, query, req, user }) => {
  if (query.project_id && !can(user, 'edit', query.project_id)) throw err(403, 'Your role can’t add files to this project.');
  const name = decodeURIComponent(req.headers['x-filename'] || 'pasted.png').replace(/[\\]/g, '/').replace(/^\/+/, '');
  if (!raw?.length) throw err(400, 'That file is empty.');
  const out = captureUpload(E.systemSource('upload', 'Uploads'), { buf: raw, name, project_id: query.project_id || undefined, exploration_id: query.exploration_id || undefined, batch: query.batch || uid('b'), batch_size: +query.batch_size || 1, actor: user.name });
  if (query.last === '1' && query.batch) E.batchDone(query.batch);
  return { results: out };
}, { raw: true });

r('POST', '/api/links', 'edit', async ({ body, user, origin }) => {
  if (body.project_id && !can(user, 'edit', body.project_id)) throw err(403, 'Your role can’t add to this project.');
  const info = resolveLink(body.url);
  if (body.as === 'reference') return REF.addReference({ project_id: body.project_id, kind: 'link', url: info.url, title: body.title });
  // A Figma link becomes a real connector when Figma is connected.
  const key = info.provider === 'figma' && fileKeyOf(info.url);
  const fig = key && get("SELECT * FROM source WHERE tool='figma' AND status='active' LIMIT 1");
  if (fig) {
    if (!(fig.scope.files || []).includes(key)) update('source', fig.id, { scope: { ...fig.scope, files: [...(fig.scope.files || []), key] }, ...(body.project_id ? { mapping_rules: { ...fig.mapping_rules, paths: [...(fig.mapping_rules?.paths || [])] } } : {}) });
    pollSource(get('SELECT * FROM source WHERE id=?', fig.id));
  }
  const r_ = await captureLink(E.systemSource('link', 'Links'), info.url, { project_id: body.project_id, actor: user.name });
  return { ...r_, provider: info.provider, tracked_by_figma: !!fig };
});

// ---- comments ----
r('GET', '/api/comments', 'read', ({ query, need }) => {
  const pid = query.project || resolveTarget(query.target_type, query.target_id);
  need('read', pid);
  if (query.target_type) return all('SELECT * FROM comment WHERE target_type=? AND target_id=? AND parent_id IS NULL ORDER BY created_at', query.target_type, query.target_id).map(commentRow);
  return all(`SELECT * FROM comment WHERE project_id=? AND parent_id IS NULL ${query.status ? 'AND status=?' : ''} ORDER BY created_at DESC LIMIT 200`, pid, ...(query.status ? [query.status] : [])).map(commentRow);
}, { guest: true });

r('GET', '/api/comments/:id', 'read', ({ params, need }) => {
  const c = get('SELECT * FROM comment WHERE id=?', params.id);
  if (!c) throw err(404, 'Comment not found');
  need('read', c.project_id);
  const root = c.parent_id ? get('SELECT * FROM comment WHERE id=?', c.parent_id) : c;
  return { ...commentRow(root), focus: c.id, moment_id: root.target_type === 'moment' ? root.target_id : root.target_type === 'change' ? get('SELECT moment_id FROM change WHERE id=?', root.target_id)?.moment_id : null };
}, { guest: true });

r('POST', '/api/comments', 'comment', async ({ body, user, need }) => {
  const parent = body.parent_id && get('SELECT * FROM comment WHERE id=?', body.parent_id);
  const target_type = parent?.target_type || body.target_type, target_id = parent?.target_id || body.target_id;
  const pid = resolveTarget(target_type, target_id);
  if (!pid) throw err(400, 'File this into a project before commenting on it.');
  need('comment', pid);
  const text = String(body.body || '').trim();
  if (!text) throw err(400, 'Write something first.');
  let region = body.region || null;
  if (region?.kind === 'part' && target_type === 'version') region = (await import('./evidence.js')).partOf(get('SELECT * FROM project WHERE id=?', pid), target_id.split(':')[1], region) || null; // pinned to a part: what it is now, so a later walk can show it changed
  const c = { id: uid('cm'), project_id: pid, target_type, target_id, region, author_id: user.id, author_name: user.name, body: text, parent_id: parent?.id || null, status: 'open', reactions: {}, created_at: now(), updated_at: now() };
  insert('comment', c);
  E.ftsPut('comment', c.id, pid, `${user.name}`, text);
  edge('comment', c.id, 'commented-on', target_type, target_id);
  for (const m of text.matchAll(/@([\w.-]+)/g)) { // mentions
    const u = get("SELECT u.id, u.name FROM user u JOIN membership m ON m.user_id=u.id WHERE lower(u.name) LIKE lower(?) || '%'", m[1]);
    if (u && u.id !== user.id) notify('mention', `${user.name} mentioned you: “${text.slice(0, 80)}”`, `#/c/${c.id}`, u.id);
  }
  for (const d of W.decisions([{ id: c.id, text }])) insert('decision', { id: uid('de'), project_id: pid, text: d.text, source_type: 'comment', source_id: c.id, status: 'suggested', created_at: now() });
  broadcast('comment', { id: c.id, project_id: pid, target_type, target_id });
  const engine = /@trace\b/i.test(text) ? 'trace' : /@claude\b/i.test(text) ? 'claude' : null; // @claude: Claude Code on their plan; @trace: Trace's free model
  if (engine && can(user, 'edit', pid)) {
    const on = target_type === 'moment' ? `the change “${get('SELECT title FROM moment WHERE id=?', target_id)?.title}”` : undefined;
    try { const run = await HX.askAgent(get('SELECT * FROM project WHERE id=?', pid), { engine, target: target_type === 'version' ? target_id.split(':')[1] : null, text, comment: parent || c, user, on }); return { ...c, run: run.id, agent: run.agent }; }
    catch (e) { return { ...c, claude_error: e.message }; }
  }
  return c;
}, { guest: true });

r('PATCH', '/api/comments/:id', 'comment', ({ params, body, user, need }) => {
  const c = get('SELECT * FROM comment WHERE id=?', params.id);
  need('comment', c.project_id);
  if (body.body !== undefined && c.author_id !== user.id) throw err(403, 'Only the author can edit a comment.');
  update('comment', c.id, { body: body.body, status: body.status, updated_at: now() });
  broadcast('comment', { id: c.id, project_id: c.project_id, target_type: c.target_type, target_id: c.target_id });
  return get('SELECT * FROM comment WHERE id=?', c.id);
}, { guest: true });

r('POST', '/api/comments/:id/react', 'comment', ({ params, body, user, need }) => {
  const c = get('SELECT * FROM comment WHERE id=?', params.id);
  need('comment', c.project_id);
  const kind = ['agree', 'seen', 'question'].includes(body.kind) ? body.kind : 'agree'; // emoji-free reactions
  const re = c.reactions || {};
  const list = new Set(re[kind] || []);
  list.has(user.name) ? list.delete(user.name) : list.add(user.name);
  re[kind] = [...list];
  update('comment', c.id, { reactions: re });
  broadcast('comment', { id: c.id, project_id: c.project_id, target_type: c.target_type, target_id: c.target_id });
  return re;
}, { guest: true });

// ---- artifacts ----
r('GET', '/api/projects/:id/artifacts', 'read', ({ params, need }) => { need('read', params.id); return all('SELECT * FROM artifact WHERE project_id=? ORDER BY created_at DESC', params.id); }, { guest: true });
r('PATCH', '/api/artifacts/:id', 'edit', async ({ params, body, user, need }) => {
  const a = get('SELECT * FROM artifact WHERE id=?', params.id);
  need('edit', a.project_id);
  if (body.status === 'accepted') { // a moment logs the change, linked to the comment, which resolves
    const r_ = E.ingest(E.systemSource('agent', 'AI agents (MCP)'), { external_id: `artifact/${a.id}`, version: '1', type: 'artifact.accepted', actor: a.agent, payload: { agent: `${a.agent}${a.model ? ` · ${a.model}` : ''}`, title: a.title, summary: `Accepted ${a.type} from ${a.agent}${a.source_comment_id ? ', answering a comment' : ''}.`, links: [a.url].filter(Boolean), content: a.content?.slice(0, 4000), artifact_type: a.type, project_id: a.project_id, boundary: 'artifact', accept: true } });
    if (a.source_comment_id) { update('comment', a.source_comment_id, { status: 'resolved', ai_status: 'accepted' }); }
    update('artifact', a.id, { status: 'accepted' });
    edge('artifact', a.id, 'answers', 'comment', a.source_comment_id);
    audit(user.name, 'user', 'artifact.accept', a.id, { event: r_.event_id });
  } else if (body.status === 'discarded') update('artifact', a.id, { status: 'discarded' });
  if (body.request_changes) { // the note goes in the thread; the agent reads it the next time it's called
    const c = get('SELECT * FROM comment WHERE id=?', a.source_comment_id);
    const target = c ? { target_type: c.target_type, target_id: c.target_id, parent_id: c.id } : { target_type: 'artifact', target_id: a.id, parent_id: null };
    insert('comment', { id: uid('cm'), project_id: a.project_id, ...target, author_id: user.id, author_name: user.name, body: `Changes requested on “${a.title}”: ${body.request_changes}`, status: 'open', created_at: now(), updated_at: now() });
    update('artifact', a.id, { status: 'changes requested' });
  }
  broadcast('artifact', { id: a.id, project_id: a.project_id });
  return get('SELECT * FROM artifact WHERE id=?', a.id);
});

// ---- references: pictures, videos, links, notes, colours, fonts; each pinnable to the change it informed ----
r('GET', '/api/projects/:id/references', 'read', ({ params, need }) => { need('read', params.id); return REF.projectRefs(params.id); }, { guest: true });
r('POST', '/api/projects/:id/references', 'edit', async ({ params, body, need }) => { need('edit', params.id); return REF.addReference({ project_id: params.id, ...body }); });
r('POST', '/api/projects/:id/references/upload', 'edit', async ({ params, raw, req, query, need }) => {
  need('edit', params.id);
  const ref = await REF.addReference({ project_id: params.id, buf: raw, name: decodeURIComponent(req.headers['x-filename'] || 'reference.png') });
  if (query.moment) { need('edit', momentProject(query.moment)); REF.linkRef(ref.id, query.moment, { change_id: query.change || null }); } // added from a change: pinned to it
  return ref;
}, { raw: true });
r('PATCH', '/api/references/:id', 'edit', ({ params, body, need }) => {
  const ref = get('SELECT * FROM reference WHERE id=?', params.id);
  need('edit', ref.project_id);
  const patch = {};
  for (const k of ['x', 'y', 'w', 'h', 'grp', 'title', 'note']) if (body[k] !== undefined) patch[k] = body[k];
  update('reference', ref.id, patch);
  if (patch.title || patch.note) { const x = get('SELECT * FROM reference WHERE id=?', ref.id); update('reference', ref.id, { embedding: textVec(`${x.title} ${x.note || ''}`) }); E.ftsPut('reference', x.id, x.project_id, x.title, x.note || ''); }
  broadcast('reference', { id: ref.id, project_id: ref.project_id });
  return strip(get('SELECT * FROM reference WHERE id=?', ref.id));
});
r('DELETE', '/api/references/:id', 'edit', ({ params, need }) => { const ref = get('SELECT * FROM reference WHERE id=?', params.id); need('edit', ref.project_id); REF.deleteRef(ref); });
r('POST', '/api/references/:id/links', 'edit', ({ params, body, need }) => {
  const ref = get('SELECT * FROM reference WHERE id=?', params.id);
  need('edit', ref.project_id);
  if (momentProject(body.moment_id) !== ref.project_id) throw err(400, 'Pin it to a change in the same project.');
  REF.linkRef(ref.id, body.moment_id, { change_id: body.change_id || null, region: body.region || null, note: body.note || null });
  return REF.refsFor(body.moment_id);
});
r('DELETE', '/api/references/:id/links/:moment', 'edit', ({ params, need }) => { const ref = get('SELECT * FROM reference WHERE id=?', params.id); need('edit', ref.project_id); REF.unlinkRef(ref.id, params.moment); broadcast('reference', { id: ref.id, project_id: ref.project_id }); });
r('GET', '/api/references/:id/similar', 'read', ({ params, need }) => {
  const ref = get('SELECT * FROM reference WHERE id=?', params.id);
  need('read', ref.project_id);
  return all("SELECT * FROM reference WHERE project_id=? AND id != ? AND COALESCE(origin,'') != 'removed'", ref.project_id, ref.id)
    .map((x) => ({ x, s: 0.6 * cosine(ref.img_vec, x.img_vec) + 0.4 * cosine(ref.embedding, x.embedding) }))
    .sort((a, b) => b.s - a.s).slice(0, 8).map(({ x, s }) => ({ ...strip(x), similarity: +s.toFixed(2) }));
});

// ---- decisions ----
r('GET', '/api/projects/:id/decisions', 'read', async ({ params, need }) => { need('read', params.id); await (await import('./chats.js')).suggestDecisions(get('SELECT * FROM project WHERE id=?', params.id)).catch(() => 0); return all("SELECT * FROM decision WHERE project_id=? ORDER BY status='confirmed' DESC, created_at DESC", params.id); }, { guest: true });
r('POST', '/api/projects/:id/decisions', 'edit', ({ params, body, user, need }) => {
  need('edit', params.id);
  const d = { id: uid('de'), project_id: params.id, text: String(body.text || '').trim(), source_type: body.source_type || 'manual', source_id: body.source_id || null, confirmed_by: user.name, status: 'confirmed', created_at: now(), ...(body.governs && typeof body.governs === 'object' ? { governs: body.governs } : {}) }; // governs: the value at a place it settles, so a change that breaks it is caught
  if (!d.text) throw err(400, 'Write the decision.');
  insert('decision', d);
  E.ftsPut('decision', d.id, params.id, d.text.slice(0, 80), d.text);
  broadcast('decision', { id: d.id, project_id: params.id });
  return d;
});
r('PATCH', '/api/decisions/:id', 'edit', ({ params, body, user, need }) => {
  const d = get('SELECT * FROM decision WHERE id=?', params.id);
  need('edit', d.project_id);
  update('decision', d.id, { text: body.text, status: body.status, confirmed_by: body.status === 'confirmed' ? user.name : undefined });
  const x = get('SELECT * FROM decision WHERE id=?', d.id);
  E.ftsPut('decision', x.id, x.project_id, x.text.slice(0, 80), x.text);
  broadcast('decision', { id: d.id, project_id: d.project_id });
  return x;
});
r('DELETE', '/api/decisions/:id', 'edit', ({ params, need }) => { const d = get('SELECT * FROM decision WHERE id=?', params.id); need('edit', d.project_id); run('DELETE FROM decision WHERE id=?', d.id); run("DELETE FROM search_fts WHERE kind='decision' AND ref_id=?", d.id); });

// ---- explorations, proposals, issues ----
r('POST', '/api/projects/:id/explorations', 'edit', ({ params, body, need }) => {
  need('edit', params.id);
  const x = { id: uid('ex'), project_id: params.id, name: String(body.name || '').trim() || 'Untitled exploration', description: body.description || '', status: 'open', created_at: now() };
  insert('exploration', x);
  for (const mid of body.moment_ids || []) update('moment', mid, { exploration_id: x.id });
  broadcast('project', { id: params.id, project_id: params.id });
  return x;
});
r('PATCH', '/api/explorations/:id', 'edit', ({ params, body, need }) => {
  const x = get('SELECT * FROM exploration WHERE id=?', params.id); need('edit', x.project_id);
  update('exploration', x.id, { name: body.name, description: body.description, status: body.status });
  return get('SELECT * FROM exploration WHERE id=?', x.id);
});

r('GET', '/api/projects/:id/proposals', 'read', ({ params, need }) => { need('read', params.id); return all('SELECT * FROM proposal WHERE project_id=? ORDER BY updated_at DESC', params.id); }, { guest: true });
r('POST', '/api/projects/:id/proposals', 'edit', ({ params, body, user, need }) => {
  need('edit', params.id);
  const moment_ids = body.exploration_id ? all("SELECT id FROM moment WHERE exploration_id=? AND status IN ('accepted','draft') ORDER BY end_ts", body.exploration_id).map((m) => m.id) : body.moment_ids || [];
  if (!moment_ids.length) throw err(400, 'Pick some moments or an exploration to propose.');
  const p = { id: uid('pr'), project_id: params.id, exploration_id: body.exploration_id || null, title: body.title || 'Untitled proposal', description: body.description || '', moment_ids, reviewers: body.reviewers || [], reviews: [], status: 'open', author_id: user.id, created_at: now(), updated_at: now() };
  insert('proposal', p);
  E.ftsPut('proposal', p.id, params.id, p.title, p.description);
  for (const rid of p.reviewers) notify('review', `${user.name} asked for your review: ${p.title}`, `#/proposal/${p.id}`, rid);
  broadcast('proposal', { id: p.id, project_id: params.id });
  return p;
});
r('GET', '/api/proposals/:id', 'read', ({ params, need }) => {
  const p = get('SELECT * FROM proposal WHERE id=?', params.id);
  if (!p) throw err(404, 'No such proposal');
  need('read', p.project_id);
  return {
    ...p, author: get('SELECT name FROM user WHERE id=?', p.author_id)?.name,
    reviewer_names: p.reviewers.map((id) => ({ id, name: get('SELECT name FROM user WHERE id=?', id)?.name })),
    moments: p.moment_ids.map((id) => get('SELECT * FROM moment WHERE id=?', id)).filter(Boolean).map(momentCard),
    exploration: p.exploration_id && get('SELECT * FROM exploration WHERE id=?', p.exploration_id),
    comments: all("SELECT * FROM comment WHERE target_type='proposal' AND target_id=? AND parent_id IS NULL ORDER BY created_at", p.id).map(commentRow),
  };
}, { guest: true });
r('POST', '/api/proposals/:id/review', 'review', ({ params, body, user, need }) => {
  const p = get('SELECT * FROM proposal WHERE id=?', params.id);
  need('review', p.project_id);
  const verdict = ['approve', 'changes', 'comment'].includes(body.verdict) ? body.verdict : 'comment';
  const reviews = [...p.reviews, { user: user.name, user_id: user.id, verdict, body: body.body || '', ts: now() }];
  update('proposal', p.id, { reviews, status: verdict === 'changes' ? 'changes_requested' : p.status === 'changes_requested' && verdict === 'approve' ? 'open' : p.status, updated_at: now() });
  notify('review', `${user.name} ${verdict === 'approve' ? 'approved' : verdict === 'changes' ? 'requested changes on' : 'commented on'} “${p.title}”`, `#/proposal/${p.id}`, p.author_id);
  broadcast('proposal', { id: p.id, project_id: p.project_id });
  return get('SELECT * FROM proposal WHERE id=?', p.id);
});
r('POST', '/api/proposals/:id/accept', 'edit', ({ params, user, need }) => {
  const p = get('SELECT * FROM proposal WHERE id=?', params.id);
  need('edit', p.project_id);
  tx(() => {
    update('proposal', p.id, { status: 'accepted', updated_at: now() });
    if (p.exploration_id) {
      const x = get('SELECT * FROM exploration WHERE id=?', p.exploration_id);
      update('exploration', x.id, { status: 'accepted' });
      for (const id of p.moment_ids) { const m = get('SELECT tags FROM moment WHERE id=?', id); update('moment', id, { exploration_id: null, status: 'accepted', tags: [...new Set([...(m.tags || []), `from ${x.name}`])] }); }
    }
    const proj = get('SELECT pinned FROM project WHERE id=?', p.project_id);
    update('project', p.project_id, { pinned: [{ type: 'direction', id: p.id, title: p.title, label: 'Current direction' }, ...(proj.pinned || []).filter((x) => x.type !== 'direction')], updated_at: now() });
  });
  audit(user.name, 'user', 'proposal.accept', p.id);
  broadcast('proposal', { id: p.id, project_id: p.project_id });
  return get('SELECT * FROM proposal WHERE id=?', p.id);
});
r('POST', '/api/proposals/:id/reject', 'edit', ({ params, need }) => {
  const p = get('SELECT * FROM proposal WHERE id=?', params.id);
  need('edit', p.project_id);
  update('proposal', p.id, { status: 'rejected', updated_at: now() });
  if (p.exploration_id) update('exploration', p.exploration_id, { status: 'archived' }); // stays in history
  broadcast('proposal', { id: p.id, project_id: p.project_id });
});

r('GET', '/api/projects/:id/issues', 'read', ({ params, need }) => { need('read', params.id); return all("SELECT * FROM issue WHERE project_id=? ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, updated_at DESC", params.id); }, { guest: true });
r('POST', '/api/projects/:id/issues', 'edit', ({ params, body, user, need }) => {
  need('edit', params.id);
  const src = body.source_comment_id && get('SELECT * FROM comment WHERE id=?', body.source_comment_id);
  const i = { id: uid('is'), project_id: params.id, title: String(body.title || src?.body.slice(0, 80) || '').trim(), body: body.body || src?.body || '', assignee_type: body.assignee_type || null, assignee: body.assignee || null, labels: body.labels || [], links: [...(body.links || []), ...(src ? [{ type: src.target_type, id: src.target_id }] : [])], status: 'open', source_comment_id: src?.id || null, created_at: now(), updated_at: now() };
  if (!i.title) throw err(400, 'Give the issue a title.');
  insert('issue', i);
  E.ftsPut('issue', i.id, params.id, i.title, i.body);
  if (i.assignee_type === 'user' && i.assignee) notify('issue', `${user.name} assigned you: ${i.title}`, `#/p/${params.id}/issues`, i.assignee);
  broadcast('issue', { id: i.id, project_id: params.id });
  return i;
});
r('PATCH', '/api/issues/:id', 'edit', ({ params, body, need }) => {
  const i = get('SELECT * FROM issue WHERE id=?', params.id); need('edit', i.project_id);
  const patch = {};
  for (const k of ['title', 'body', 'status', 'assignee_type', 'assignee', 'labels', 'links']) if (body[k] !== undefined) patch[k] = body[k];
  update('issue', i.id, { ...patch, updated_at: now() });
  broadcast('issue', { id: i.id, project_id: i.project_id });
  return get('SELECT * FROM issue WHERE id=?', i.id);
});

// ---- workflow visualizer ----
r('GET', '/api/projects/:id/workflow', 'read', ({ params, need }) => { need('read', params.id); return get('SELECT workflow FROM project WHERE id=?', params.id)?.workflow || { nodes: [], edges: [] }; }, { guest: true });
r('PUT', '/api/projects/:id/workflow', 'edit', ({ params, body, need }) => { need('edit', params.id); update('project', params.id, { workflow: { nodes: body.nodes || [], edges: body.edges || [] } }); });
// Drafted from what actually happened in the project: who asks (the people in git and the workspace), where they ask
// (the agents' chats Trace reads), which agents made versions and how many, the versions themselves, Trace's walk and
// checks, then review. Tools the project captures from (Figma, uploads, a folder) feed the brief. A design project
// without git keeps the old shape: its tools in order of first use, then review.
r('POST', '/api/projects/:id/workflow/draft', 'edit', async ({ params, need }) => {
  need('edit', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  const h = await HX.history(p).catch(() => ({ versions: [] }));
  const nodes = [], edges = [], add = (n) => { nodes.push({ id: uid('n'), ...n }); return nodes.at(-1).id; }, link = (from, to) => from && to && edges.push({ from, to });
  const tools = all("SELECT s.id, s.tool, s.name, MIN(a.created_at) first, COUNT(*) n FROM asset a JOIN source s ON s.id=a.source_id WHERE a.project_id=? GROUP BY s.id ORDER BY first", params.id);
  const brief = add({ kind: 'stage', label: 'Brief & references', x: 40, y: 200, link: { type: 'project', id: params.id } });
  tools.slice(0, 3).forEach((t, i) => link(add({ kind: 'tool', label: t.name || t.tool, tool: t.tool, x: 40, y: 340 + i * 110, link: { type: 'source', id: t.id } }), brief));
  if (h.versions.length) {
    const people = [...new Set(h.versions.filter((v) => !v.agent).map((v) => v.who))].slice(0, 3);
    const agents = Object.entries(h.versions.filter((v) => v.agent).reduce((m, v) => ({ ...m, [v.agent]: (m[v.agent] || 0) + 1 }), {})).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const chats = all("SELECT adapter, COUNT(*) n FROM memory_doc WHERE project_id=? AND kind='session' GROUP BY adapter", params.id);
    const asks = add({ kind: 'stage', label: chats.length ? `Asks · ${chats.map((c) => MEM.ADAPTERS[c.adapter]?.label || c.adapter).join(', ')}` : 'Asks', x: 260, y: 200, link: { type: 'asks' } });
    link(brief, asks);
    people.forEach((who, i) => link(add({ kind: 'person', label: who, x: 260 + i * 190, y: 40, link: { type: 'person', id: who } }), asks));
    const git = add({ kind: 'stage', label: 'Versions in git', x: 700, y: 200, link: { type: 'versions' } });
    agents.forEach(([name], i) => { const id = add({ kind: 'agent', label: name, x: 480, y: 120 + i * 110, link: { type: 'agent', id: name } }); link(asks, id); link(id, git); });
    if (!agents.length) link(asks, git);
    const checks = add({ kind: 'stage', label: 'Walk & checks · Trace', x: 920, y: 200, link: { type: 'checks' } });
    link(git, checks);
    link(checks, add({ kind: 'stage', label: 'Review', x: 1140, y: 200, link: { type: 'inbox' } }));
  } else {
    let prev = brief;
    tools.forEach((t, i) => { const id = nodes.find((n) => n.link?.id === t.id)?.id; if (id) { link(prev, id); prev = id; } });
    link(prev, add({ kind: 'stage', label: 'Review inbox', x: 300, y: 200, link: { type: 'inbox' } }));
  }
  return { nodes, edges, drafted: true };
});
// This week in the project, for each kind of node: files a source captured, versions by a person or an agent, asks in
// the chats, versions saved, what the checks found last time, what waits for review.
r('GET', '/api/projects/:id/workflow/activity', 'read', async ({ params, need }) => {
  need('read', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id), week = now() - 7 * 86400000;
  const v = (await HX.history(p).catch(() => ({ versions: [] }))).versions.filter((x) => x.when > week);
  const count = (list, key) => list.reduce((m, x) => { const k = key(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    window: 'this week',
    source: Object.fromEntries(all('SELECT a.source_id, COUNT(*) n FROM snapshot s JOIN asset a ON a.id=s.asset_id WHERE a.project_id=? AND s.created_at > ? GROUP BY a.source_id', params.id, week).map((x) => [x.source_id, x.n])),
    person: count(v.filter((x) => !x.agent), (x) => x.who),
    agent: count(v, (x) => x.agent),
    user: Object.fromEntries(all('SELECT actor_id, COUNT(*) n FROM moment WHERE project_id=? AND end_ts > ? GROUP BY actor_id', params.id, week).map((x) => [x.actor_id, x.n])),
    asks: get("SELECT COUNT(*) n FROM memory_chunk c JOIN memory_doc d ON d.id=c.doc_id WHERE d.project_id=? AND c.role='exchange' AND c.ts > ?", params.id, week).n,
    versions: v.length,
    inbox: get("SELECT COUNT(*) n FROM moment WHERE status='draft' AND (project_id=? OR route_guess=?)", params.id, params.id).n,
    project: get('SELECT COUNT(*) n FROM reference WHERE project_id=? AND created_at > ?', params.id, week).n,
  };
}, { guest: true });

// ---- decks ----
r('GET', '/api/projects/:id/decks', 'read', ({ params, need }) => { need('read', params.id); return all('SELECT id, title, template, range, created_at, updated_at FROM deck WHERE project_id=? ORDER BY updated_at DESC', params.id); }, { guest: true });
r('POST', '/api/projects/:id/decks', 'edit', async ({ params, body, need }) => { need('edit', params.id); const d = await buildDeck({ project_id: params.id, ...body }); insert('deck', d); return d; });
r('GET', '/api/decks/:id', 'read', ({ params, need }) => { const d = get('SELECT * FROM deck WHERE id=?', params.id); if (!d) throw err(404, 'No such deck'); need('read', d.project_id); return { ...d, templates: TEMPLATES }; }, { guest: true });
r('PUT', '/api/decks/:id', 'edit', ({ params, body, need }) => { const d = get('SELECT * FROM deck WHERE id=?', params.id); need('edit', d.project_id); update('deck', d.id, { title: body.title, slides: body.slides, updated_at: now() }); return get('SELECT * FROM deck WHERE id=?', d.id); });
r('DELETE', '/api/decks/:id', 'edit', ({ params, need }) => { const d = get('SELECT * FROM deck WHERE id=?', params.id); need('edit', d.project_id); run('DELETE FROM deck WHERE id=?', d.id); });
r('GET', '/api/decks/:id/pptx', 'read', async ({ params, need, res }) => {
  const d = get('SELECT * FROM deck WHERE id=?', params.id); need('read', d.project_id);
  const buf = await pptx(d);
  res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'content-disposition': `attachment; filename="${d.title.replace(/[^\w .-]+/g, '')}.pptx"` });
  res.end(buf);
}, { guest: true });

// ---- sources ----
r('GET', '/api/sources', 'read', () => ({
  catalog: CATALOG,
  sources: all('SELECT * FROM source ORDER BY created_at').map((s) => ({ ...s, auth_ref: undefined, token_hint: s.auth_ref ? hint(s.auth_ref) : null, cursor: { backoff_until: s.cursor?.backoff_until }, events_24h: get('SELECT COUNT(*) n FROM event WHERE source_id=? AND created_at > ?', s.id, now() - 86400000).n, events: get('SELECT COUNT(*) n FROM event WHERE source_id=?', s.id).n, project_name: projectName(s.project_id) })),
  projects: all("SELECT id, name FROM project WHERE status='active'"),
}));
r('POST', '/api/sources', 'edit', async ({ body, user }) => { const s = await connect(body.tool, body, user); return { ...s, auth_ref: undefined }; });
r('PATCH', '/api/sources/:id', 'edit', ({ params, body, user }) => {
  const s = get('SELECT * FROM source WHERE id=?', params.id);
  if (body.status) setSourceStatus(s.id, body.status === 'active' ? 'active' : 'paused');
  const patch = {};
  for (const k of ['name', 'project_id', 'mapping_rules', 'auto_accept']) if (body[k] !== undefined) patch[k] = body[k];
  if (body.scope) patch.scope = { ...s.scope, ...body.scope };
  update('source', s.id, patch);
  audit(user.name, 'user', 'source.update', s.id, Object.keys(body));
  if (body.scope && registry[s.tool]?.poll) pollSource(get('SELECT * FROM source WHERE id=?', s.id));
  return { ...get('SELECT * FROM source WHERE id=?', s.id), auth_ref: undefined };
});
r('DELETE', '/api/sources/:id', 'edit', ({ params, user }) => disconnect(params.id, user));
r('POST', '/api/sources/:id/sync', 'edit', async ({ params }) => { await pollSource(get('SELECT * FROM source WHERE id=?', params.id)); return { ...get('SELECT id, last_sync, error, health FROM source WHERE id=?', params.id) }; });
r('GET', '/api/sources/:id/scopes', 'edit', async ({ params }) => { const s = get('SELECT * FROM source WHERE id=?', params.id); return (await registry[s.tool]?.listScopes?.(s)) || []; });
r('GET', '/api/sources/:id/health', 'read', async ({ params }) => { const s = get('SELECT * FROM source WHERE id=?', params.id); const h = (await registry[s.tool]?.health?.(s)) || { ok: true }; update('source', s.id, { health: { ...s.health, ...h } }); return h; });

// ---- settings, AI, engine ----
r('GET', '/api/settings', 'read', ({ user }) => {
  const total = get("SELECT COUNT(*) n FROM moment WHERE status IN ('accepted','draft')").n;
  const accepted = get("SELECT COUNT(*) n FROM moment WHERE status='accepted'").n;
  const moved = get("SELECT COUNT(DISTINCT moment_id) n FROM correction WHERE kind='move'").n;
  const edited = get("SELECT COUNT(*) n FROM moment WHERE status='accepted' AND edited=1").n;
  return {
    settings: settings(), workspace: workspace(), role: user.role,
    engine: {
      queue: all('SELECT stage, status, COUNT(*) n FROM job GROUP BY stage, status'),
      dead: all("SELECT id, stage, error, updated_at FROM job WHERE status='dead' ORDER BY updated_at DESC LIMIT 20"),
      events: get('SELECT COUNT(*) n FROM event').n, moments: total,
      noise_ratio: total ? +(get('SELECT COUNT(*) n FROM event').n / total).toFixed(1) : null,
      capture_accuracy: accepted ? +(1 - moved / accepted).toFixed(2) : null,
      accepted_without_edit: accepted ? +(1 - edited / accepted).toFixed(2) : null,
    },
    rules: all('SELECT r.*, p.name project_name FROM route_rule r LEFT JOIN project p ON p.id=r.project_id ORDER BY hits DESC'),
    projects: all("SELECT id, name, do_not_capture FROM project WHERE status='active'"),
  };
});
r('PATCH', '/api/settings', 'admin', ({ body, user }) => {
  const allowed = ['paused', 'session_gap_min', 'file_threshold', 'inbox_threshold', 'model_main', 'model_fast', 'model_fallback', 'ai_monthly_credit_tokens', 'mute', 'auto_accept_suggest_after'];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (body.workspace_name) update('workspace', WS, { name: body.workspace_name });
  if (body.mode) update('workspace', WS, { mode: body.mode === 'team' ? 'team' : 'solo' });
  audit(user.name, 'user', 'settings.update', 'workspace', patch);
  if ('paused' in patch) broadcast('paused', { paused: patch.paused });
  return setSettings(patch);
});
r('DELETE', '/api/rules/:id', 'admin', ({ params }) => run('DELETE FROM route_rule WHERE id=?', params.id));
r('POST', '/api/jobs/:id/retry', 'admin', ({ params }) => { run("UPDATE job SET status='queued', attempts=0, run_after=? WHERE id=?", now(), params.id); });

// ---- people ----
r('GET', '/api/members', 'read', ({ origin, user }) => ({
  members: all('SELECT u.id, u.name, u.email, m.role, m.token FROM membership m JOIN user u ON u.id=m.user_id ORDER BY m.created_at').map((m) => ({ ...m, token: undefined, invite: user.role === 'owner' && m.role !== 'owner' ? `${origin}/join/${m.token}` : undefined })),
  people: all('SELECT id, name, is_agent FROM user WHERE external=1 OR is_agent=1 ORDER BY name LIMIT 200'),
  guests: all('SELECT token, project_id, name, expires_at FROM guest_link WHERE expires_at > ? ORDER BY created_at DESC', now()).map((g) => ({ ...g, project_name: projectName(g.project_id), link: user.role === 'owner' ? `${origin}/guest/${g.token}` : undefined, token: g.token.slice(0, 6) })),
}));
r('POST', '/api/members', 'admin', ({ body, origin, user }) => {
  const role = ['editor', 'reviewer', 'viewer'].includes(body.role) ? body.role : 'editor';
  const name = String(body.name || '').trim();
  if (!name) throw err(400, 'Add the person’s name.');
  const u = get("SELECT * FROM user WHERE email != '' AND lower(email)=lower(?)", body.email || '\u0000') || { id: uid('u'), name, email: body.email || '', created_at: now() };
  if (!get('SELECT 1 FROM user WHERE id=?', u.id)) insert('user', u);
  else update('user', u.id, { external: 0 });
  const t = newToken();
  run('INSERT OR REPLACE INTO membership VALUES (?,?,?,?,?)', WS, u.id, role, t, now());
  update('workspace', WS, { mode: 'team' });
  audit(user.name, 'user', 'member.invite', u.id, { role });
  return { id: u.id, name: u.name, role, invite: `${origin}/join/${t}` };
});
r('PATCH', '/api/members/:id', 'admin', ({ params, body }) => { if (['editor', 'reviewer', 'viewer'].includes(body.role)) run('UPDATE membership SET role=? WHERE user_id=? AND role != ?', body.role, params.id, 'owner'); });
r('DELETE', '/api/members/:id', 'admin', ({ params }) => run("DELETE FROM membership WHERE user_id=? AND role != 'owner'", params.id));
r('POST', '/api/projects/:id/guest-links', 'admin', ({ params, body, origin }) => {
  const t = newToken(), days = Math.min(90, Math.max(1, +body.days || 14));
  insert('guest_link', { token: t, project_id: params.id, name: body.name || 'Client', expires_at: now() + days * 86400000, created_at: now() });
  return { link: `${origin}/guest/${t}`, expires_at: now() + days * 86400000 };
});
r('DELETE', '/api/guest-links/:prefix', 'admin', ({ params }) => run("DELETE FROM guest_link WHERE token LIKE ? || '%'", params.prefix));

// ---- MCP tokens ----
r('GET', '/api/mcp-tokens', 'admin', ({ origin }) => ({
  url: `${origin}/mcp`,
  tokens: all('SELECT id, name, hint, scopes, project_ids, created_at, last_used, revoked FROM mcp_token ORDER BY created_at DESC'),
  reads: all("SELECT ts, actor, action, target, detail FROM audit_log WHERE actor_type='agent' ORDER BY id DESC LIMIT 50"),
}));
r('POST', '/api/mcp-tokens', 'admin', ({ body, origin, user }) => {
  const t = `trace_${newToken()}`;
  const row = { id: uid('mt'), token_hash: hashToken(t), hint: `…${t.slice(-4)}`, name: String(body.name || 'Agent').trim(), scopes: body.write ? 'read,write' : 'read', project_ids: body.project_ids?.length ? body.project_ids : null, user_id: user.id, created_at: now() };
  insert('mcp_token', row);
  audit(user.name, 'user', 'mcp.token.create', row.id, { scopes: row.scopes });
  const url = `${origin}/mcp`;
  return {
    ...row, token_hash: undefined, token: t, url,
    claude_code: `claude mcp add --transport http trace ${url} --header "Authorization: Bearer ${t}"`,
    json: { mcpServers: { trace: { type: 'http', url, headers: { Authorization: `Bearer ${t}` } } } },
    stdio: `TRACE_URL=${origin} TRACE_TOKEN=${t} node "${path.join(ROOT, 'bin', 'trace-mcp.js')}"`,
  };
});
r('DELETE', '/api/mcp-tokens/:id', 'admin', ({ params, user }) => { run('UPDATE mcp_token SET revoked=1 WHERE id=?', params.id); audit(user.name, 'user', 'mcp.token.revoke', params.id); });
r('GET', '/api/audit', 'admin', ({ query }) => all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', Math.min(500, +query.limit || 100)));

// ---- data rights ----
r('GET', '/api/export', 'admin', ({ res, user }) => {
  const tables = ['workspace', 'user', 'project', 'source', 'event', 'asset', 'snapshot', 'moment', 'moment_asset', 'moment_event', 'change', 'comment', 'reference', 'decision', 'exploration', 'proposal', 'issue', 'artifact', 'edge', 'deck', 'route_rule', 'correction', 'audit_log'];
  const data = Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
  for (const s of data.source) delete s.auth_ref; // tokens never leave the vault
  const keys = new Set([...data.snapshot.flatMap((s) => [s.image_key, s.file_key]), ...data.reference.flatMap((x) => [x.file_key])].filter(Boolean));
  const entries = [{ name: 'trace.json', data: Buffer.from(JSON.stringify(data, null, 1)) }];
  for (const k of keys) { try { entries.push({ name: `files/${k}`, data: readKey(k) }); } catch {} }
  audit(user.name, 'user', 'export', 'workspace', { files: keys.size });
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="trace-export-${new Date().toISOString().slice(0, 10)}.zip"` });
  res.end(zip(entries));
});
r('DELETE', '/api/workspace', 'admin', ({ body }) => {
  if (body.confirm !== 'delete everything') throw err(400, 'Type “delete everything” to confirm.');
  for (const s of all('SELECT * FROM source')) { registry[s.tool]?.unsubscribe?.(s); if (s.auth_ref) deleteSecret(s.auth_ref); }
  deleteSecret('anthropic');
  const tables = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'search_fts%' AND name NOT LIKE 'memory_fts%' AND name NOT LIKE 'sqlite%'").map((t) => t.name).filter((t) => !['workspace', 'user', 'membership'].includes(t));
  tx(() => { for (const t of tables) run(`DELETE FROM ${t}`); run('DELETE FROM search_fts'); run('DELETE FROM memory_fts'); run("DELETE FROM user WHERE id NOT IN (SELECT user_id FROM membership)"); });
  for (const d of ['files', 'memory-imports']) { try { rmSync(path.join(DATA, d), { recursive: true, force: true }); } catch {} }
  setSettings({ onboarded: false });
  return { ok: true };
});

// ---- the feed (NCS "Latest"): each project's newest iteration, the one before, and its changelog ----
// A project's cover: its first walked screen (the app as it draws, waited for), else its running app's picture, else
// none (the card shows its latest work).
const coverOf = (p, shot) => { try { const w = SC.screens(p, 'now'); const s0 = w.screens?.[0]; if (s0?.thumb) return { thumb_key: s0.thumb, image_key: s0.shot, app: true, form: w.device || 'desktop' }; } catch {} return shot ? { thumb_key: shot.thumb_key, image_key: shot.image_key, app: true } : null; };
r('GET', '/api/feed', 'read', () => {
  const ps = all("SELECT * FROM project WHERE status='active'").map((p) => {
    const ms = all("SELECT * FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC LIMIT 2", p.id);
    const shot = get('SELECT thumb_key, image_key FROM history_shot WHERE project_id=? ORDER BY created_at DESC LIMIT 1', p.id); // the app itself, running: the best cover a code project has
    return { id: p.id, name: p.name, tasks: all("SELECT id, title, status, assignee_type, assignee FROM issue WHERE project_id=? AND status IN ('open','in_progress') ORDER BY status='in_progress' DESC, updated_at DESC LIMIT 4", p.id).map((t) => ({ ...t, assignee: t.assignee_type === 'agent' ? t.assignee : t.assignee && get('SELECT name FROM user WHERE id=?', t.assignee)?.name })), open_reviews: get("SELECT COUNT(*) n FROM comment WHERE project_id=? AND parent_id IS NULL AND status='open'", p.id).n, iterations: get("SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted'", p.id).n, last: ms[0]?.end_ts || p.updated_at, latest: ms[0] && { ...changelog(ms[0]), image: visualSnap(ms[0].id) }, previous: ms[1] && { id: ms[1].id, title: ms[1].title, end_ts: ms[1].end_ts, image: visualSnap(ms[1].id) },
      ...(AI.emptyDigest(p) ? {} : { stands: p.digest?.now || null, next: p.digest?.next?.[0] || null, stands_at: p.digest?.at || null }), cover: coverOf(p, shot), category: categoryOf(p), tools: all('SELECT DISTINCT tool FROM asset WHERE project_id=?', p.id).map((x) => x.tool), code: (p.folders || []).length > 0 };
  }).sort((a, b) => b.last - a.last);
  return { projects: ps, review: get("SELECT COUNT(*) n FROM moment WHERE status='draft'").n, capturing: get("SELECT COUNT(*) n FROM moment WHERE status='open'").n };
});
r('GET', '/api/projects-overview', 'read', ({ query }) => {
  const q = (query.q || '').toLowerCase();
  return all("SELECT * FROM project WHERE status='active' ORDER BY updated_at DESC").filter((p) => !q || `${p.name} ${p.brief}`.toLowerCase().includes(q)).map((p) => {
    const ms = all("SELECT id, title, end_ts FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC LIMIT 10", p.id);
    return { id: p.id, name: p.name, brief: (p.brief || '').split('\n')[0].replace(/^goal:\s*/i, '').replace(/^\w/, (c) => c.toUpperCase()), iterations: get("SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted'", p.id).n, last: ms[0]?.end_ts || p.updated_at,
      tools: all('SELECT DISTINCT tool FROM asset WHERE project_id=?', p.id).map((x) => x.tool), items: ms.map((m) => ({ id: m.id, title: m.title, end_ts: m.end_ts, image: visualSnap(m.id) })).filter((x) => x.image) };
  }).sort((a, b) => b.last - a.last);
});
r('GET', '/api/moments/:id/changelog', 'read', ({ params, need }) => { const m = get('SELECT * FROM moment WHERE id=?', params.id); need('read', m.project_id || m.route_guess); return changelog(m); }, { guest: true });

// ---- the journey: what the person gave and asked, what the AI understood and made, why, and the review ----
// Each iteration (an accepted change) gathers the prompts given since the one before it (from the AIs' own
// memory), the reasoning agents logged with explain_changes, and the references pinned to it.
const reasoningRow = (c) => ({ id: c.id, ts: c.created_at, agent: c.author_name, status: c.status, reactions: c.reactions || {}, ...(c.meta || {}), refs: (c.meta?.refs || []).map((id) => get('SELECT id, title, thumb_key, file_key, kind, url FROM reference WHERE id=?', id)).filter(Boolean), replies: all('SELECT id, author_name, body, created_at FROM comment WHERE parent_id=? ORDER BY created_at', c.id) });
const iterCard = (m) => { const c = changelog(m); return { ...c, start_ts: m.start_ts, status: m.status, project_id: m.project_id, image: visualSnap(m.id), files: get('SELECT COUNT(*) n FROM moment_asset WHERE moment_id=?', m.id).n, comments: get("SELECT COUNT(*) n FROM comment WHERE target_type='moment' AND target_id=? AND parent_id IS NULL AND COALESCE(kind,'') != 'reasoning'", m.id).n }; };
let remapped = 0;
function journey(project_id, { before, limit = 10, moment } = {}) {
  if (now() - remapped > 30000) { MEM.remap(); remapped = now(); } // folders learned from where you filed work
  MEM.ensureFresh(0); // reads what changed in the background; the page updates when it lands
  REF.syncPromptRefs(project_id);
  const accepted = all("SELECT id, end_ts FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC", project_id);
  const ex = MEM.exchangesFor(project_id);
  const reasons = all("SELECT * FROM comment WHERE project_id=? AND kind='reasoning' AND parent_id IS NULL ORDER BY created_at", project_id);
  const ids = new Set(accepted.map((x) => x.id)), led = (e) => e.moment && ids.has(e.moment);
  const iteration = (m) => {
    const prev = accepted.find((x) => x.end_ts < m.end_ts && x.id !== m.id)?.end_ts ?? 0;
    const inside = (ts) => ts > prev && ts <= m.end_ts;
    return {
      moment: iterCard(m),
      asked: ex.filter((e) => (led(e) ? e.moment === m.id : inside(e.ts))).reverse(),
      reasoning: reasons.filter((c) => (c.target_type === 'moment' && c.target_id === m.id) || (c.target_type === 'project' && inside(c.created_at))).map(reasoningRow),
      refs: REF.refsFor(m.id),
      pins: all("SELECT id, region, body, author_name, created_at FROM comment WHERE target_type='moment' AND target_id=? AND parent_id IS NULL AND region IS NOT NULL AND COALESCE(kind,'') != 'reasoning' ORDER BY created_at", m.id),
      marks: all("SELECT id, kind, text, color, anchor, meta, author_name, created_at FROM note WHERE project_id=? AND kind IN ('marker','stroke') AND json_extract(anchor,'$.moment')=? ORDER BY created_at", project_id, m.id), // drawn on the picture
    };
  };
  if (moment) return iteration(moment);
  const start = before ? accepted.findIndex((x) => x.end_ts < +before) : 0;
  const page = start < 0 ? [] : accepted.slice(start, start + limit);
  const newest = accepted[0]?.end_ts ?? 0;
  return {
    total: accepted.length, more: start >= 0 && start + limit < accepted.length,
    hidden: before ? undefined : MEM.exchangesFor(project_id, { hidden: true, limit: 100 }).length,
    now: before ? null : { asked: ex.filter((e) => !led(e) && e.ts > newest).reverse(), reasoning: reasons.filter((c) => c.target_type === 'project' && c.created_at > newest).map(reasoningRow) }, // asked, nothing captured yet
    iterations: page.map((x) => iteration(get('SELECT * FROM moment WHERE id=?', x.id))),
  };
}
r('GET', '/api/projects/:id/journey', 'read', ({ params, query, need }) => { need('read', params.id); return journey(params.id, { before: query.before, limit: Math.min(30, +query.limit || 10) }); }, { guest: true });

// ---- the script agents get before they work, and adding it to the project's own instruction files ----
const SCRIPT_FILES = { claude: 'CLAUDE.md', agents: 'AGENTS.md', gemini: 'GEMINI.md', cursor: path.join('.cursor', 'rules', 'trace.mdc') };
r('GET', '/api/projects/:id/agent-script', 'read', ({ params, need }) => {
  need('read', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  const dirs = projectDirs(p);
  return { text: AGENT_SCRIPT, dirs, files: Object.entries(SCRIPT_FILES).map(([k, f]) => ({ id: k, file: f, added: dirs.filter((d) => { try { return readFileSync(path.join(d, f), 'utf8').includes('<!-- trace:start'); } catch { return false; } }) })) };
});
// Write the script into a project's instruction files (CLAUDE.md, AGENTS.md…), replacing Trace's own block only.
function writeScript(p, file) {
  const rel_ = SCRIPT_FILES[file];
  if (!rel_) throw err(400, 'Pick CLAUDE.md, AGENTS.md, GEMINI.md or Cursor rules.');
  const dirs = projectDirs(p);
  if (!dirs.length) throw err(400, `Tell Trace which folder ${p.name} lives in first (project settings → Folders).`);
  const block = `<!-- trace:start · added by Trace; Trace replaces this block when you add it again -->\n${AGENT_SCRIPT}\n<!-- trace:end -->`;
  const written = [];
  for (const d of dirs) {
    const f = path.join(d, rel_);
    let text = existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (file === 'cursor' && !text) text = '---\ndescription: Explain each set of changes in Trace\nalwaysApply: true\n---\n';
    text = /<!-- trace:start[\s\S]*?<!-- trace:end -->/.test(text) ? text.replace(/<!-- trace:start[\s\S]*?<!-- trace:end -->/, () => block) : `${text}${text && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : ''}${block}\n`;
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    written.push(f);
  }
  return written;
}
r('POST', '/api/projects/:id/agent-script', 'edit', ({ params, body, need, user }) => {
  need('edit', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  const written = writeScript(p, body.file);
  audit(user.name, 'user', 'agent-script.add', p.id, { files: written });
  return { written };
});

// ---- assemble: point Trace at a folder (what the coding-agent skill runs) ----
// The project for the folder (found or made), the folder watched, the AI memory read, the script in CLAUDE.md,
// and the case study assembled, with what's still open.
r('POST', '/api/assemble', 'edit', async ({ body, user, origin }) => {
  const dir = path.resolve(String(body.dir || '').trim().replace(/^"|"$/g, ''));
  if (!body.dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw err(400, `“${body.dir}” isn’t a folder on this computer.`);
  const key = (x) => path.resolve(x).toLowerCase();
  const within = (d) => key(dir) === key(d) || key(dir).startsWith(key(d) + path.sep);
  const steps = [];
  let p = all("SELECT * FROM project WHERE status='active'").find((x) => projectDirs(x).some(within));
  if (!p) {
    p = { id: uid('p'), workspace_id: WS, name: String(body.name || path.basename(dir)).slice(0, 80), brief: '', status: 'active', pinned: [], do_not_capture: [], folders: [dir], created_at: now(), updated_at: now() };
    insert('project', p); E.updateCentroid(p.id); E.ftsPut('project', p.id, p.id, p.name, '');
    p = get('SELECT * FROM project WHERE id=?', p.id);
    if (!body.quiet) steps.push(`Made the project “${p.name}”`);
  } else if (!body.quiet) steps.push(`Found the project “${p.name}”`);
  if (!(p.folders || []).some((f) => key(f) === key(dir)) && !projectDirs(p).some((d) => key(d) === key(dir))) update('project', p.id, { folders: [...(p.folders || []), dir] });
  if (!body.quiet) {
    const src = all("SELECT * FROM source WHERE tool='folder'").find((s) => s.scope?.path && within(s.scope.path));
    if (!src) { await connect('folder', { path: dir, project_id: p.id }, user); steps.push('Watching the folder: its screens, docs and component code are being captured and drawn'); }
    else { if (!src.project_id) update('source', src.id, { project_id: p.id }); steps.push('Already watching the folder'); }
    for (const d of MEM.detected().filter((x) => ['claude-code', 'codex'].includes(x.id) && x.found && !x.source)) { MEM.connect(d.id, user); steps.push(`Reading ${d.label}’s memory of this folder`); }
    MEM.remap(); MEM.ensureFresh(0);
    if (body.script !== false) try { const w = writeScript(get('SELECT * FROM project WHERE id=?', p.id), 'claude'); steps.push(`Added the Trace script to ${w.map((f) => path.basename(f)).join(', ')}`); } catch (e) { steps.push(`Couldn’t add the script: ${e.message}`); }
    broadcast('project', { id: p.id, project_id: p.id });
    audit(user.name, 'user', 'assemble', p.id, { dir });
  }
  p = get('SELECT * FROM project WHERE id=?', p.id);
  const cs = CS.assemble(p);
  const count = (sql) => get(sql, p.id).n;
  return {
    project: { id: p.id, name: p.name }, link: `${origin}/#/p/${p.id}`, steps,
    counts: { iterations: count("SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted'"), files: count('SELECT COUNT(*) n FROM asset WHERE project_id=?'), docs: cs.docs.length, prompts: MEM.exchangesFor(p.id).length, references: count('SELECT COUNT(*) n FROM reference WHERE project_id=?'), decisions: count('SELECT COUNT(*) n FROM decision WHERE project_id=?'), constraints: cs.constraints },
    case_study: { readiness: cs.readiness, open: cs.sections.filter((s) => s.status !== 'filled').map((s) => ({ id: s.id, q: s.q, status: s.status })) },
  };
});

// ---- a code folder dropped or picked in the browser: its real place on this computer, else a copy Trace keeps ----
r('POST', '/api/folders/find', 'edit', ({ body }) => {
  const name = String(body.name || '').trim();
  if (!name || /[\\/]/.test(name)) throw err(400, 'That isn’t a folder name.');
  const sample = (body.files || []).slice(0, 40).map((f) => ({ path: String(f.path || ''), size: Number(f.size) })).filter((f) => f.path && !f.path.split(/[\\/]/).includes('..'));
  const dir = F.findOnDisk(name, sample, all("SELECT * FROM project WHERE status='active'").flatMap(projectDirs));
  return dir ? { dir } : { copy: F.newCopy(name) };
});
r('POST', '/api/folders/copy', 'edit', ({ raw, query }) => { F.copyInto(String(query.dir || ''), String(query.path || ''), raw || Buffer.alloc(0)); return { ok: true }; }, { raw: true });

// ---- the coding-agent skills: install them for Claude Code (trace: assemble and the case study; trace-design: the canvas) ----
const SKILLS = ['trace', 'trace-design'];
const skillSrc = (n) => path.join(ROOT, 'skills', n, 'SKILL.md');
const skillDst = (n) => path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'skills', n, 'SKILL.md');
const SKILL_DST = skillDst('trace');
const skillText = (origin, n = 'trace') => readFileSync(skillSrc(n), 'utf8').replaceAll('{{TRACE_DIR}}', ROOT.replace(/\\/g, '/')).replaceAll('{{TRACE_URL}}', origin);
const skillIn = (origin, n) => existsSync(skillDst(n)) && readFileSync(skillDst(n), 'utf8') === skillText(origin, n);
r('GET', '/api/skill', 'read', ({ origin }) => ({ text: skillText(origin), path: SKILL_DST, installed: SKILLS.every((n) => skillIn(origin, n)), skills: SKILLS.map((n) => ({ name: n, path: skillDst(n), installed: skillIn(origin, n) })), cli: `node "${ROOT.replace(/\\/g, '/')}/bin/trace.js" assemble` }));
r('POST', '/api/skill/install', 'admin', ({ origin, user }) => { for (const n of SKILLS) { mkdirSync(path.dirname(skillDst(n)), { recursive: true }); writeFileSync(skillDst(n), skillText(origin, n)); audit(user.name, 'user', 'skill.install', skillDst(n)); } return { path: SKILL_DST, paths: SKILLS.map(skillDst) }; });

// ---- the project canvas: blocks, their contents, links between them and what the links reveal ----
const memoItems = (p) => { const memo = {}; return (b) => (memo[b] ||= blockItems(p, b)); };
const projectOr404 = (id) => { const p = get('SELECT * FROM project WHERE id=?', id); if (!p) throw err(404, 'No such project'); return p; };
r('GET', '/api/projects/:id/canvas', 'read', ({ params, need }) => {
  need('read', params.id);
  const p = projectOr404(params.id), c = canvasOf(p), itemsOf = memoItems(p);
  const blocks = blockList(p);
  const order = [...c.order.filter((id) => blocks.some((b) => b.id === id)), ...blocks.map((b) => b.id).filter((id) => !c.order.includes(id))];
  return {
    blocks: order.map((id) => { const b = blocks.find((x) => x.id === id); return { ...b, size: c.size[id] || b.size || '1x1', summary: blockSummary(p, b, itemsOf(id)) }; }),
    links: c.links.filter((l) => blocks.some((b) => b.id === l.from) && blocks.some((b) => b.id === l.to)).map((l) => { const ins = insights(p, l.from, l.to, itemsOf); return { ...l, count: ins.length, kinds: [...new Set(ins.map((i) => i.kind))] }; }),
    range: (() => { const ts = all("SELECT MIN(created_at) a, MAX(end_ts) b FROM moment WHERE project_id=? AND status='accepted'", p.id)[0]; return { from: Math.min(ts?.a || now(), p.created_at || now()), to: now() }; })(),
  };
}, { guest: true });
r('PUT', '/api/projects/:id/canvas', 'edit', ({ params, body, need }) => { need('edit', params.id); const c = saveCanvas(projectOr404(params.id), body); broadcast('project', { id: params.id, project_id: params.id }); return c; });
r('GET', '/api/projects/:id/blocks/:block', 'read', ({ params, need }) => {
  need('read', params.id);
  const p = projectOr404(params.id), b = blockList(p).find((x) => x.id === params.block);
  if (!b) throw err(404, 'No such block');
  return { block: b, items: blockItems(p, b.id), project: { id: p.id, name: p.name } };
}, { guest: true });
r('GET', '/api/projects/:id/insights', 'read', ({ params, query, need }) => { need('read', params.id); const p = projectOr404(params.id); return { insights: insights(p, query.a, query.b, memoItems(p)) }; }, { guest: true });
r('POST', '/api/projects/:id/insights', 'edit', ({ params, body, user, need }) => {
  need('edit', params.id);
  if (!String(body.text || '').trim()) throw err(400, 'Write the insight first.');
  insert('note', { id: uid('nt'), project_id: params.id, block: null, kind: 'insight', text: String(body.text).slice(0, 1000), meta: { a: body.a, b: body.b }, author_id: user.id, author_name: user.name, created_at: now(), updated_at: now() });
  broadcast('project', { id: params.id, project_id: params.id });
});

// ---- sticky notes (and constraints, ideas) ----
r('POST', '/api/projects/:id/notes', 'comment', ({ params, body, user, need }) => {
  need('comment', params.id);
  const text = String(body.text || '').trim();
  if (!text && !['marker', 'stroke'].includes(body.kind)) throw err(400, 'Write something first.'); // a mark or a stroke can be wordless
  const kind = ['sticky', 'constraint', 'idea', 'marker', 'stroke'].includes(body.kind) ? body.kind : 'sticky';
  const pts = kind === 'stroke' && Array.isArray(body.meta?.points) ? body.meta.points.slice(0, 1500).filter((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) : null;
  if (kind === 'stroke' && (!pts || pts.length < 2)) throw err(400, 'A stroke needs at least two points.');
  const n = { id: uid('nt'), project_id: params.id, block: body.block || null, kind, text: text.slice(0, 2000), color: ['yellow', 'pink', 'green', 'blue', 'violet', 'red', 'ink'].includes(body.color) ? body.color : kind === 'stroke' ? 'red' : 'yellow', anchor: body.anchor || null, meta: pts ? { points: pts } : null, author_id: user.id, author_name: user.name, created_at: now(), updated_at: now() };
  insert('note', n);
  broadcast('project', { id: params.id, project_id: params.id });
  return n;
}, { guest: true });
r('PATCH', '/api/notes/:id', 'comment', ({ params, body, need }) => {
  const n = get('SELECT * FROM note WHERE id=?', params.id);
  if (!n) throw err(404, 'No such note');
  need('comment', n.project_id);
  const patch = {};
  for (const k of ['text', 'color', 'anchor', 'block']) if (body[k] !== undefined) patch[k] = body[k];
  if (body.done !== undefined) patch.done = body.done ? 1 : 0;
  update('note', n.id, { ...patch, updated_at: now() });
  broadcast('project', { id: n.project_id, project_id: n.project_id });
  return get('SELECT * FROM note WHERE id=?', n.id);
}, { guest: true });
r('DELETE', '/api/notes/:id', 'comment', ({ params, need }) => { const n = get('SELECT * FROM note WHERE id=?', params.id); if (!n) throw err(404, 'No such note'); need('comment', n.project_id); run('DELETE FROM note WHERE id=?', n.id); broadcast('project', { id: n.project_id, project_id: n.project_id }); }, { guest: true });

// ---- the case study ----
r('GET', '/api/projects/:id/case-study', 'read', ({ params, need, user }) => { // and Trace AI writes what's open, by itself, when the work changed
  need('read', params.id);
  const p = projectOr404(params.id);
  if (can(user, 'edit', p.id)) AI.autoDraft(p);
  return { ...CS.assemble(p), drafting: AI.isDrafting(p.id) };
}, { guest: true });
r('PUT', '/api/projects/:id/case-study/:section', 'edit', ({ params, body, user, need }) => { need('edit', params.id); CS.answer(params.id, params.section, body.answer, 'you', user.name); broadcast('project', { id: params.id, project_id: params.id }); return CS.assemble(projectOr404(params.id)); });
r('GET', '/api/projects/:id/case-study.md', 'read', ({ params, need, origin, res }) => {
  need('read', params.id);
  const p = projectOr404(params.id);
  res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${p.name.replace(/[^\w.-]+/g, '-')}-case-study.md"` });
  res.end(CS.markdown(CS.assemble(p), origin));
}, { guest: true });

// ---- artifacts you add by hand, and previews of any artifact ----
r('POST', '/api/projects/:id/artifacts', 'edit', ({ params, body, user, need }) => {
  need('edit', params.id);
  const content = String(body.content || '');
  if (!content.trim() && !body.url) throw err(400, 'Paste the artifact (code, HTML, markdown) or a link.');
  const a = { id: uid('ar'), project_id: params.id, type: body.type || 'other', title: String(body.title || '').trim() || content.match(/(?:function|const)\s+([A-Z]\w+)/)?.[1] || 'Untitled artifact', content: content || null, url: body.url || null, prompt: body.note || null, agent: 'you', model: null, status: 'accepted', meta: { added_by: user.name }, created_at: now() };
  insert('artifact', a);
  E.ftsPut('artifact', a.id, params.id, a.title, `${content.slice(0, 4000)} ${a.url || ''}`);
  broadcast('artifact', { id: a.id, project_id: params.id });
  return a;
});
r('POST', '/api/projects/:id/artifacts/upload', 'edit', async ({ params, raw, req, user, need }) => {
  need('edit', params.id);
  const name = decodeURIComponent(req.headers['x-filename'] || 'artifact');
  const mime = MIME[extOf(name)] || 'application/octet-stream';
  const text = /^(text\/|image\/svg|application\/json)/.test(mime) || /\.(jsx|tsx|js|ts|md|mdx|html?|css|svg|txt)$/i.test(name);
  const a = { id: uid('ar'), project_id: params.id, type: /^image\//.test(mime) && !/svg/.test(mime) ? 'image' : 'other', title: name.replace(/\.[^.]+$/, ''), content: text ? raw.toString('utf8').replace(/^﻿/, '').slice(0, 2000000) : null, file_key: text ? null : storeFile(raw, extOf(name)), agent: 'you', status: 'accepted', meta: { added_by: user.name, name, mime }, created_at: now() };
  insert('artifact', a);
  broadcast('artifact', { id: a.id, project_id: params.id });
  return a;
}, { raw: true });
r('GET', '/api/artifacts/:id/preview', 'read', async ({ params, need, query, res }) => {
  const a = get('SELECT * FROM artifact WHERE id=?', params.id);
  if (!a) throw err(404, 'No such artifact');
  need('read', a.project_id);
  let out;
  try { out = await artifactPage(a); } catch (e) { out = { kind: artifactKind(a), html: null, error: (e.errors?.[0]?.text || e.message || String(e)).slice(0, 400) }; }
  if (query.page) return sandboxed(res, out.html || ''); // the frame itself, or a new window
  return out;
}, { guest: true });

// ---- AI memory: what each AI already remembers, read when asked ----
r('GET', '/api/memory', 'read', () => ({ adapters: MEM.detected(), notes: get("SELECT COUNT(*) n FROM memory_doc WHERE kind='note'").n }));
r('POST', '/api/memory/connect', 'admin', ({ body, user }) => { const s_ = MEM.connect(body.adapter, user); return { id: s_.id }; });
r('DELETE', '/api/memory/:id', 'admin', ({ params, user }) => MEM.disconnect(params.id, user));
r('POST', '/api/memory/refresh', 'edit', async () => ({ indexing: await MEM.ensureFresh(8000) }));
r('POST', '/api/memory/import', 'admin', ({ raw, req }) => ({ id: MEM.importExport(raw, decodeURIComponent(req.headers['x-filename'] || 'export.json')).id }), { raw: true });
r('GET', '/api/memory/search', 'read', async ({ query, user }) => MEM.recall({ q: query.q || '', project_id: query.project, limit: +query.limit || 12, projects: user.guest ? [user.project_id] : undefined }), { guest: true });
// A chat filed in or out of its project by hand (the AI never overrules this), and the ones filed out.
r('PUT', '/api/memory/exchanges/:id/relevance', 'edit', ({ params, body, need }) => {
  const k = get('SELECT c.ts, d.project_id FROM memory_chunk c JOIN memory_doc d ON d.id=c.doc_id WHERE c.id=?', +params.id);
  if (!k?.project_id) throw err(404, 'That chat isn’t in a project. Reload and try again.');
  need('edit', k.project_id);
  MEM.judge(k.ts, { rel: !!body.relevant, by: 'you' });
  broadcast('memory', { project_id: k.project_id });
  return { ok: true };
});
r('GET', '/api/projects/:id/exchanges/hidden', 'read', ({ params, need }) => { need('read', params.id); return MEM.exchangesFor(params.id, { hidden: true, limit: 100 }); });
r('GET', '/api/memory/docs', 'read', ({ query, need }) => { if (query.project) need('read', query.project); return MEM.docsFor(query.project || null, 100); }, { guest: true });
r('GET', '/api/memory/docs/:id', 'read', ({ params, need }) => { const d = MEM.doc(params.id); if (!d) throw err(404, 'Not found'); if (d.project_id) need('read', d.project_id); return d; }, { guest: true });

// What became of an upload: sorted into a project (with Undo), or waiting in review.
r('GET', '/api/batch/:id', 'read', ({ params }) => all("SELECT id, status, stage, project_id, route_guess, route_confidence, title, event_count FROM moment WHERE batch=? AND status != 'discarded'", params.id)
  .map((m) => ({ ...m, project_name: projectName(m.project_id), image: visualSnap(m.id), iterations: get('SELECT COUNT(*) n FROM moment_asset WHERE moment_id=?', m.id).n })));
