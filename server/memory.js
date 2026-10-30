// AI memory. Every AI tool already keeps a memory of its work: Claude Code's sessions and memory files,
// Codex's sessions and AGENTS.md, Antigravity's transcripts and GEMINI.md, Cursor's and Copilot's chats,
// exported Claude.ai / ChatGPT conversations. Trace reads them when it's called, indexes only what changed,
// and answers "what do my AIs know about X" with cited passages, so what one AI learned reaches the others.
// Nothing is sent anywhere; secrets are redacted before indexing; all of it is served to agents as data.
import { createReadStream, existsSync, statSync, readdirSync, readFileSync, copyFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, all, get, run, insert, update, now, uid, WS, DATA, broadcast, audit } from './db.js';
import { tokens } from './vec.js';
import { unzip, preview } from './media.js';

const H = os.homedir();
const APPDATA = process.env.APPDATA || path.join(H, 'AppData', 'Roaming');
const IMPORTS = path.join(DATA, 'memory-imports');

const dirs = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)); } catch { return []; } };
const files = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(d, e.name)); } catch { return []; } };
const walk = (d, pred, depth = 6, out = []) => { for (const s of dirs(d)) if (depth > 0) walk(s, pred, depth - 1, out); for (const f of files(d)) if (pred(f)) out.push(f); return out; };
const ts = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || null);

// ---------- cleaning: secrets out, harness noise out ----------
const SECRETS = [/sk-ant-[\w-]{16,}/g, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[\w]{20,}/g, /\bfigd_[\w-]{20,}/g, /\bAKIA[0-9A-Z]{16}\b/g, /\bxox[abprs]-[\w-]{10,}/g, /\bAIza[\w-]{30,}/g, /\btrace_[\w-]{20,}/g,
  /\bvck_[\w-]{20,}/g, /\b[spr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, /\bgsk_[A-Za-z0-9]{20,}/g, /\bhf_[A-Za-z0-9]{30,}/g, /\bnpm_[A-Za-z0-9]{30,}/g, /\br8_[A-Za-z0-9]{30,}/g,
  /\bsbp_[a-f0-9]{30,}/g, /\bglpat-[\w-]{20,}/g, /\bxai-[A-Za-z0-9]{30,}/g, /\bya29\.[\w-]{20,}/g, /\bSG\.[\w-]{16,}\.[\w-]{16,}/g, /\bdop_v1_[a-f0-9]{40,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g];
const ASSIGN = /\b((?:\w*?[_-])?(?:api[_-]?key|(?:access[_-]?|auth[_-]?|refresh[_-]?|client[_-]?)?(?:token|secret)|password|passwd|(?:private|secret|access)[_-]?key|bearer)["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi;
const HEADER = /\b((?:Bearer|Basic|Token)\s+)[A-Za-z0-9._~+/=-]{16,}/g; // Authorization: Bearer …
const URL_PASS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}@/gi; // postgres://user:password@host
export const redact = (t) => SECRETS.reduce((s, re) => s.replace(re, '[redacted]'), String(t)).replace(ASSIGN, '$1[redacted]').replace(HEADER, '$1[redacted]').replace(URL_PASS, '$1[redacted]@');
export const clean = (t) => redact(String(t || '')
  .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<(command-[a-z-]+|local-command-std(?:out|err)|environment_context|user_instructions|task-notification)>[\s\S]*?<\/\1>/g, '')
  .replace(/<launch-selected-element>[\s\S]*?<\/launch-selected-element>/g, '[pointed at an element on the page]')
  .replace(/^\[Image(?: #\d+)?(?:: source: [^\]]*)?\]\s*$/gm, '') // the pictures themselves are kept as images
  .replace(/\n{3,}/g, '\n\n')).trim();
const cap = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);

// One chunk per exchange: what the person asked (and the pictures they gave), the AI's first reply (how it
// understood the ask) and its last (what it says it made). Tool output is left out.
function exchanges(turns) {
  const out = [];
  let cur = null;
  const done = () => {
    if (!cur) return;
    const [first, ...rest] = cur.answers, last = rest.at(-1);
    let text = `Asked: ${cur.asked}`;
    for (const a of cur.answers) if (text.length < 5000 || a === last) text += `\n\nAnswered: ${a}`;
    out.push({ role: 'exchange', text, ts: cur.ts, meta: { asked: cur.asked, first: first ? cap(first, 900) : null, last: last ? cap(last, 1400) : null, images: cur.images, shotPic: cur.shotPic } });
  };
  for (const { role, text, at, images, pics } of turns) {
    if (role === 'shot') { if (cur) cur.shotPic = pics[0]; continue; }
    const t = clean(text);
    if (!t && !images?.length) continue;
    if (role === 'user') { done(); cur = { asked: cap(t || '(pictures only)', 1600), answers: [], ts: at, images: images?.length ? images : undefined }; }
    else if (role === 'summary') out.push({ role: 'summary', text: cap(t, 4000), ts: at });
    else if (cur && t) cur.answers.push(cap(t, 2600));
  }
  done();
  return out;
}
// Pictures pasted into a prompt are what the person gave the AI: kept (content-addressed) for projects only.
async function keepImages(list) {
  const out = [];
  for (const { data, mime } of list.slice(0, 12)) {
    try {
      const p = await preview(Buffer.from(data, 'base64'), `prompt.${(mime || 'image/png').split('/')[1].replace('jpeg', 'jpg')}`);
      if (p.image_key) out.push({ file_key: p.file_key, image_key: p.image_key, thumb_key: p.thumb_key, w: p.width, h: p.height });
    } catch {}
  }
  return out;
}
function markdown(text, at) { // memory and instruction files, split at headings
  const parts = clean(text).split(/\n(?=#{1,3} )/).flatMap((p) => (p.length > 3000 ? p.match(/[\s\S]{1,3000}(\n|$)/g) : [p])).filter((p) => p.trim());
  return parts.map((p) => ({ role: 'note', text: p.trim(), ts: at }));
}
const firstLine = (s) => s.replace(/^Asked:\s*/, '').split('\n')[0].slice(0, 80);

async function lines(file, onLine) {
  const rl = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) if (l) onLine(l);
}
// A project's own CLAUDE.md / AGENTS.md belongs to that folder; the global ones in the home folder don't.
const inFolder = (f, docs) => {
  const dir = path.dirname(f.path).replace(/[\\/]\.claude$/, '');
  if (![H, path.join(H, '.claude'), path.join(H, '.codex'), path.join(H, '.gemini')].includes(dir)) docs[0].workspace = dir;
  return docs;
};
const mdDoc = (f, kind, title) => { const st = statSync(f); return [{ key: f, kind, title: title || path.basename(f), workspace: null, ts: st.mtimeMs, chunks: markdown(readFileSync(f, 'utf8'), st.mtimeMs) }]; };

// ---------- adapters: where each AI keeps its memory, and how to read it ----------
export const ADAPTERS = {
  'claude-code': {
    label: 'Claude Code', where: '~/.claude (sessions, memory files, CLAUDE.md)',
    detect: () => existsSync(path.join(H, '.claude', 'projects')),
    list() {
      const out = [];
      for (const d of dirs(path.join(H, '.claude', 'projects'))) {
        for (const f of files(d)) if (f.endsWith('.jsonl')) out.push({ path: f, kind: 'session' });
        for (const f of files(path.join(d, 'memory'))) if (f.endsWith('.md')) out.push({ path: f, kind: 'memory' });
      }
      const g = path.join(H, '.claude', 'CLAUDE.md');
      if (existsSync(g)) out.push({ path: g, kind: 'instructions' });
      for (const w of workspaces('claude-code')) for (const n of ['CLAUDE.md', path.join('.claude', 'CLAUDE.md')]) { const f = path.join(w, n); if (existsSync(f)) out.push({ path: f, kind: 'instructions' }); }
      return out;
    },
    async parse(f) {
      if (f.kind === 'memory') { // a memory folder belongs to the same project folder its sessions ran in
        const dir = path.dirname(path.dirname(f.path));
        const docs = mdDoc(f.path, f.kind, `Memory · ${path.basename(f.path, '.md')}`);
        docs[0].workspace = get("SELECT workspace FROM memory_doc WHERE path LIKE ? AND workspace IS NOT NULL LIMIT 1", `${dir}${path.sep}%.jsonl`)?.workspace || null;
        return docs;
      }
      if (f.kind !== 'session') return inFolder(f, mdDoc(f.path, f.kind, `Instructions · ${path.basename(path.dirname(f.path))}`));
      const turns = [];
      let title = null, workspace = null, first = null;
      const folders = projectFolders();
      await lines(f.path, (l) => {
        if (l.includes('"type":"custom-title"')) { try { title = JSON.parse(l).customTitle || title; } catch {} return; }
        const user = l.includes('"type":"user"'), asst = l.includes('"type":"assistant"');
        const shot = user && l.includes('"tool_use_id"') && l.includes('"type":"image"'); // a screenshot the AI took of its own work
        if ((!user && !asst) || (user && l.includes('"tool_use_id"') && !shot) || (asst && !l.includes('"type":"text"'))) return; // skip tool traffic cheaply
        let o; try { o = JSON.parse(l); } catch { return; }
        if (o.isSidechain || o.isMeta) return;
        workspace ||= o.cwd;
        if (shot) {
          const img = mapProject(workspace, folders) && (o.message?.content || []).flatMap((b) => (Array.isArray(b.content) ? b.content : [b])).filter((b) => b.type === 'image' && b.source?.type === 'base64').at(-1);
          if (img) turns.push({ role: 'shot', at: ts(o.timestamp), pics: [{ data: img.source.data, mime: img.source.media_type }] });
          return;
        }
        const c = o.message?.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
        if (/^(Caveat:|\[Request interrupted)/.test(text)) return;
        const at = ts(o.timestamp); first ||= at;
        const pics = user && Array.isArray(c) && mapProject(workspace, folders) ? c.filter((b) => b.type === 'image' && b.source?.type === 'base64').map((b) => ({ data: b.source.data, mime: b.source.media_type })) : [];
        turns.push({ role: o.isCompactSummary ? 'summary' : o.type, text, at, pics });
      });
      for (const t of turns) if (t.pics?.length && t.role === 'user') t.images = await keepImages(t.pics);
      const chunks = exchanges(turns);
      for (const c of chunks) if (c.meta?.shotPic) { c.meta.shot = (await keepImages([c.meta.shotPic]))[0] || null; delete c.meta.shotPic; } // only the last one per ask
      return chunks.length ? [{ key: f.path, kind: 'session', title: title || firstLine(chunks.find((c) => c.role === 'exchange')?.text || 'Session'), workspace, ts: first, chunks }] : [];
    },
  },
  codex: {
    label: 'Codex', where: '~/.codex (sessions, AGENTS.md)',
    detect: () => existsSync(path.join(H, '.codex')),
    list() {
      const out = walk(path.join(H, '.codex', 'sessions'), (f) => f.endsWith('.jsonl')).map((f) => ({ path: f, kind: 'session' }));
      const a = path.join(H, '.codex', 'AGENTS.md');
      if (existsSync(a)) out.push({ path: a, kind: 'instructions' });
      for (const w of workspaces('codex')) { const f = path.join(w, 'AGENTS.md'); if (existsSync(f)) out.push({ path: f, kind: 'instructions' }); }
      return out;
    },
    async parse(f) {
      if (f.kind !== 'session') return inFolder(f, mdDoc(f.path, f.kind, `Instructions · ${path.basename(path.dirname(f.path))}`));
      const turns = [];
      let workspace = null, first = null;
      const folders = projectFolders();
      await lines(f.path, (l) => {
        if (!l.includes('"session_meta"') && !(l.includes('"response_item"') && l.includes('"type":"message"'))) return;
        let o; try { o = JSON.parse(l); } catch { return; }
        if (o.type === 'session_meta') { workspace = o.payload?.cwd; first = ts(o.payload?.timestamp || o.timestamp); return; }
        const role = o.payload?.role;
        if (role !== 'user' && role !== 'assistant') return;
        const text = (o.payload.content || []).filter((c) => /_text$/.test(c.type)).map((c) => c.text).join('\n');
        if (role === 'user' && /^\s*(<|# AGENTS\.md)/.test(text)) return; // harness context, not the person
        const pics = role === 'user' && mapProject(workspace, folders) ? (o.payload.content || []).filter((x) => x.type === 'input_image' && /^data:image\//.test(x.image_url || '')).map((x) => ({ mime: x.image_url.slice(5, x.image_url.indexOf(';')), data: x.image_url.split(',')[1] })) : [];
        turns.push({ role, text, at: ts(o.timestamp), pics });
      });
      for (const t of turns) if (t.pics?.length) t.images = await keepImages(t.pics);
      const chunks = exchanges(turns);
      return chunks.length ? [{ key: f.path, kind: 'session', title: firstLine(chunks[0].text), workspace, ts: first, chunks }] : [];
    },
  },
  antigravity: {
    label: 'Antigravity / Gemini', where: '~/.gemini (Antigravity transcripts and plans, GEMINI.md)',
    detect: () => existsSync(path.join(H, '.gemini')),
    list() {
      const out = [];
      for (const d of dirs(path.join(H, '.gemini', 'antigravity', 'brain'))) {
        const t = path.join(d, '.system_generated', 'logs', 'transcript.jsonl');
        if (existsSync(t)) out.push({ path: t, kind: 'session' });
        for (const f of walk(path.join(d, 'artifacts'), (x) => x.endsWith('.md'), 2)) out.push({ path: f, kind: 'memory' });
        for (const f of files(d)) if (f.endsWith('.md')) out.push({ path: f, kind: 'memory' });
      }
      const g = path.join(H, '.gemini', 'GEMINI.md');
      if (existsSync(g)) out.push({ path: g, kind: 'instructions' });
      return out;
    },
    async parse(f) {
      if (f.kind !== 'session') return mdDoc(f.path, f.kind, f.kind === 'memory' ? `Plan · ${path.basename(f.path, '.md')}` : 'Instructions · GEMINI.md');
      const turns = [];
      await lines(f.path, (l) => {
        if (!l.includes('USER_INPUT') && !l.includes('PLANNER_RESPONSE')) return;
        let o; try { o = JSON.parse(l); } catch { return; }
        if (typeof o.content !== 'string') return;
        turns.push({ role: o.type === 'USER_INPUT' ? 'user' : 'assistant', text: o.content, at: ts(o.created_at) });
      });
      const chunks = exchanges(turns);
      return chunks.length ? [{ key: f.path, kind: 'session', title: firstLine(chunks[0].text), workspace: null, ts: chunks[0].ts, chunks }] : [];
    },
  },
  cursor: {
    label: 'Cursor', where: 'Cursor’s chat database (state.vscdb)',
    detect: () => existsSync(path.join(APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb')),
    list: () => [{ path: path.join(APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb'), kind: 'session' }],
    async parse(f) {
      const tmp = path.join(os.tmpdir(), `trace-cursor-${process.pid}.vscdb`);
      copyFileSync(f.path, tmp); // Cursor keeps it open; read a copy
      const cdb = new DatabaseSync(tmp, { readOnly: true });
      const docs = [];
      try {
        const kv = (k) => { try { return JSON.parse(cdb.prepare('SELECT value FROM cursorDiskKV WHERE key=?').get(k)?.value || 'null'); } catch { return null; } };
        for (const { key, value } of cdb.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all()) {
          let c; try { c = JSON.parse(value); } catch { continue; }
          const id = key.split(':')[1];
          const heads = c.fullConversationHeadersOnly || [];
          const bubbles = heads.length ? heads.map((h) => c.conversationMap?.[h.bubbleId] || kv(`bubbleId:${id}:${h.bubbleId}`)).filter(Boolean) : c.conversation || [];
          const turns = bubbles.map((b) => ({ role: b.type === 1 ? 'user' : 'assistant', text: b.text || b.rawText || '', at: ts(c.createdAt) }));
          const chunks = exchanges(turns);
          if (chunks.length) docs.push({ key: `${f.path}#${id}`, kind: 'session', title: c.name || firstLine(chunks[0].text), workspace: null, ts: ts(c.createdAt), chunks });
        }
      } finally { cdb.close(); try { rmSync(tmp); } catch {} }
      return docs;
    },
  },
  copilot: {
    label: 'GitHub Copilot (VS Code)', where: 'VS Code’s chat sessions',
    detect: () => existsSync(path.join(APPDATA, 'Code', 'User', 'workspaceStorage')),
    list() {
      const out = [];
      for (const d of dirs(path.join(APPDATA, 'Code', 'User', 'workspaceStorage'))) for (const f of files(path.join(d, 'chatSessions'))) if (/\.jsonl?$/.test(f)) out.push({ path: f, kind: 'session' });
      return out;
    },
    async parse(f) {
      let s;
      const raw = readFileSync(f.path, 'utf8');
      if (f.path.endsWith('.jsonl')) { // a state, then patches: kind 1 sets a path, kind 2 appends to one
        const ls = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        s = ls[0]?.v || {};
        for (const p of ls.slice(1)) {
          const k = p.k || [], parent = k.slice(0, -1).reduce((o, key) => (o ? o[key] : o), s), last = k.at(-1);
          if (!parent) continue;
          if (p.kind === 1) parent[last] = p.v;
          if (p.kind === 2 && Array.isArray(parent[last])) parent[last].push(...(Array.isArray(p.v) ? p.v : [p.v]));
        }
      } else { try { s = JSON.parse(raw); } catch { return []; } }
      let workspace = null;
      try { workspace = decodeURIComponent(JSON.parse(readFileSync(path.join(path.dirname(path.dirname(f.path)), 'workspace.json'), 'utf8')).folder || '').replace(/^file:\/\/\//, '').replace(/\//g, path.sep); } catch {}
      const said = (r) => [r.response].flat().map((x) => (typeof x === 'string' ? x : x?.value ?? x?.content?.value ?? '')).join('');
      const turns = (s.requests || []).flatMap((r) => [{ role: 'user', text: r.message?.text || '', at: ts(r.timestamp || s.creationDate) }, { role: 'assistant', text: said(r), at: ts(r.timestamp) }]);
      const chunks = exchanges(turns);
      return chunks.length ? [{ key: f.path, kind: 'session', title: s.customTitle || firstLine(chunks[0].text), workspace, ts: ts(s.creationDate), chunks }] : [];
    },
  },
  chats: {
    label: 'Chat exports (Claude.ai, ChatGPT)', where: 'Exports you add here',
    detect: () => true,
    list: () => files(IMPORTS).filter((f) => f.endsWith('.json')).map((f) => ({ path: f, kind: 'session' })),
    async parse(f) {
      let data; try { data = JSON.parse(readFileSync(f.path, 'utf8')); } catch { return []; }
      const convs = Array.isArray(data) ? data : data.conversations || [];
      return convs.flatMap((c, i) => {
        let turns = [];
        if (c.chat_messages) turns = c.chat_messages.map((m) => ({ role: m.sender === 'human' ? 'user' : 'assistant', text: m.text || (m.content || []).map((x) => x.text || '').join('\n'), at: ts(m.created_at) })); // Claude.ai
        else if (c.mapping) turns = Object.values(c.mapping).map((n) => n.message).filter((m) => m && ['user', 'assistant'].includes(m.author?.role)).sort((a, b) => (a.create_time || 0) - (b.create_time || 0))
          .map((m) => ({ role: m.author.role, text: (m.content?.parts || []).filter((x) => typeof x === 'string').join('\n'), at: ts(m.create_time) })); // ChatGPT
        const chunks = exchanges(turns);
        return chunks.length ? [{ key: `${f.path}#${c.uuid || c.id || i}`, kind: 'session', title: c.name || c.title || firstLine(chunks[0].text), workspace: null, ts: ts(c.created_at || c.create_time), chunks }] : [];
      });
    },
  },
};

// Folders this AI has worked in (from its own sessions), so their CLAUDE.md / AGENTS.md come along.
function workspaces(adapter) {
  return all("SELECT DISTINCT workspace FROM memory_doc WHERE adapter=? AND workspace IS NOT NULL LIMIT 200", adapter).map((r) => r.workspace).filter((w) => existsSync(w));
}

// ---------- which project a memory belongs to: only by folders, never by guessing ----------
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
function projectFolders() {
  const out = [];
  for (const p of all("SELECT id, folders FROM project WHERE status='active'")) for (const f of p.folders || []) out.push([norm(f), p.id]);
  for (const s of all("SELECT id, project_id, scope, mapping_rules FROM source WHERE tool='folder'")) {
    const filed = !s.project_id && get("SELECT project_id FROM moment WHERE source_id=? AND status='accepted' AND project_id IS NOT NULL GROUP BY project_id ORDER BY COUNT(*) DESC LIMIT 1", s.id)?.project_id; // where you filed this folder's work
    if ((s.project_id || filed) && s.scope?.path) out.push([norm(s.scope.path), s.project_id || filed]);
    for (const r of s.mapping_rules?.paths || []) if (s.scope?.path) out.push([norm(`${s.scope.path}/${r.prefix}`), r.project_id]);
  }
  return out.sort((a, b) => b[0].length - a[0].length); // the deepest folder wins
}
const mapProject = (workspace, folders) => { const w = norm(workspace); return w ? folders.find(([f]) => w === f || w.startsWith(`${f}/`))?.[1] || null : null; };
run("UPDATE memory_doc SET mtime=0 WHERE kind='session' AND id IN (SELECT doc_id FROM memory_chunk WHERE role='exchange' AND text LIKE 'Asked: <task-notification>%')");

export function remap() {
  const folders = projectFolders();
  let changed = 0;
  for (const d of all('SELECT id, workspace, project_id, kind FROM memory_doc WHERE workspace IS NOT NULL')) {
    const p = mapProject(d.workspace, folders);
    if (p === d.project_id) continue;
    update('memory_doc', d.id, { project_id: p, ...(p && d.kind === 'session' ? { mtime: 0 } : {}) }); // read once more to keep the pictures in its prompts
    changed++;
  }
  if (changed) for (const k in state) if (!state[k].running) state[k].at = 0; // the next call reads again
  return changed;
}

// ---------- indexing, only when called ----------
const state = {}; // source id → { running, done, total, at }
export const progress = (id) => state[id] || null;

function store(src, file, st, docs, folders) {
  db.exec('BEGIN');
  try {
    for (const d of all('SELECT id FROM memory_doc WHERE path=? OR path LIKE ?', file.path, `${file.path}#%`)) forget(d.id);
    for (const d of docs) {
      const id = uid('md');
      insert('memory_doc', { id, source_id: src.id, adapter: src.scope.adapter, kind: d.kind, path: d.key, title: redact(d.title || '').slice(0, 200), workspace: d.workspace, project_id: mapProject(d.workspace, folders), ts: d.ts || st.mtimeMs, mtime: Math.floor(st.mtimeMs), size: st.size, chunks: d.chunks.length, indexed_at: now() });
      d.chunks.forEach((c, i) => {
        const r = run('INSERT INTO memory_chunk (doc_id, ord, role, text, ts, meta) VALUES (?,?,?,?,?,?)', id, i, c.role, c.text, c.ts || d.ts, c.meta || null);
        run('INSERT INTO memory_fts (chunk_id, doc_id, title, text) VALUES (?,?,?,?)', Number(r.lastInsertRowid), id, d.title || '', c.text);
      });
    }
    if (!docs.length) insert('memory_doc', { id: uid('md'), source_id: src.id, adapter: src.scope.adapter, kind: 'empty', path: file.path, title: '', mtime: Math.floor(st.mtimeMs), size: st.size, chunks: 0, indexed_at: now() }); // remembered as read
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function forget(docId) {
  run('DELETE FROM memory_fts WHERE doc_id=?', docId);
  run('DELETE FROM memory_chunk WHERE doc_id=?', docId);
  run('DELETE FROM memory_doc WHERE id=?', docId);
}

export async function refresh(src) {
  const ad = ADAPTERS[src.scope?.adapter];
  if (!ad || state[src.id]?.running) return state[src.id];
  const list = ad.list();
  const s = (state[src.id] = { running: true, done: 0, total: list.length, changed: 0, at: now() });
  const folders = projectFolders();
  try {
    const seen = new Set();
    for (const f of list) {
      seen.add(f.path);
      let st; try { st = statSync(f.path); } catch { s.done++; continue; }
      const known = get('SELECT mtime, size FROM memory_doc WHERE path=? OR path LIKE ? LIMIT 1', f.path, `${f.path}#%`);
      if (!known || known.mtime !== Math.floor(st.mtimeMs) || known.size !== st.size) {
        try { store(src, f, st, await ad.parse(f), folders); s.changed++; } catch (e) { console.error('memory', f.path, e.message); }
        await new Promise((r) => setImmediate(r)); // stay responsive while reading gigabytes
      }
      s.done++;
    }
    for (const d of all('SELECT id, path FROM memory_doc WHERE source_id=?', src.id)) if (!seen.has(d.path.split('#')[0])) forget(d.id); // gone from disk
  } finally {
    s.running = false; s.at = now();
    update('source', src.id, { last_sync: now(), health: { ok: true, detail: `${get('SELECT COUNT(*) n FROM memory_doc WHERE source_id=? AND chunks > 0', src.id).n} conversations and files` } });
    broadcast('memory', { source_id: src.id });
  }
  return s;
}

// Called by every read that needs memory: re-reads only what changed, and never makes the caller wait long.
export async function ensureFresh(maxWait = 2500) {
  const jobs = [];
  for (const src of all("SELECT * FROM source WHERE tool='aimem' AND status='active'")) {
    const s = state[src.id];
    if (s?.running || (s && now() - s.at < 60000)) continue;
    jobs.push(refresh(src));
  }
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, maxWait))]);
  return all("SELECT id FROM source WHERE tool='aimem'").map((x) => state[x.id]).filter((x) => x?.running).map((x) => ({ done: x.done, total: x.total }));
}

// ---------- recall ----------
const KIND_BOOST = { note: 1.6, memory: 1.5, instructions: 1.25, session: 1 };
export async function recall({ q, project_id, adapters, since, limit = 8, projects, fresh = true }) {
  const indexing = fresh ? await ensureFresh() : [];
  const words = tokens(q).slice(0, 14);
  if (!words.length) return { results: [], indexing };
  const match = words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR ');
  const rows = all(`SELECT f.chunk_id, f.doc_id, bm25(memory_fts, 0, 0, 2.5, 1) rank FROM memory_fts f WHERE memory_fts MATCH ? ORDER BY rank LIMIT 300`, match);
  const perDoc = {};
  const out = [];
  for (const r of rows) {
    const d = get('SELECT * FROM memory_doc WHERE id=?', r.doc_id);
    if (!d || (adapters?.length && !adapters.includes(d.adapter)) || (since && d.ts < since)) continue;
    if (projects && !projects.includes(d.project_id)) continue; // a project-scoped token only sees its projects' memory
    if ((perDoc[d.id] = (perDoc[d.id] || 0) + 1) > 2) continue;
    const c = get('SELECT * FROM memory_chunk WHERE id=?', r.chunk_id);
    if (project_id && c.role === 'exchange' && get('SELECT rel FROM memory_rel WHERE ts=?', c.ts)?.rel === 0) continue; // filed out of its project
    const age = (now() - (c.ts || d.ts || now())) / 86400000;
    const score = -r.rank * (KIND_BOOST[d.kind] || 1) * (project_id && d.project_id === project_id ? 1.7 : 1) * (1 + 0.5 * Math.exp(-age / 30));
    out.push({ score, d, c });
  }
  out.sort((a, b) => b.score - a.score);
  return {
    indexing,
    results: out.slice(0, limit).map(({ score, d, c }) => ({
      id: c.id, doc: d.id, tool: ADAPTERS[d.adapter]?.label || (d.adapter === 'notes' ? 'Agent notes' : d.adapter), adapter: d.adapter, kind: d.kind, title: d.title, when: c.ts ? new Date(c.ts).toISOString() : null,
      workspace: d.workspace, project_id: d.project_id, file: d.path.split('#')[0], text: cap(c.text, 1400), score: +score.toFixed(2),
    })),
  };
}

// An agent saves something it learned, for the next agent.
export function remember({ project_id, title, text, agent }) {
  const src = get("SELECT * FROM source WHERE tool='agent'");
  const id = uid('md'), body = redact(text);
  insert('memory_doc', { id, source_id: src?.id, adapter: 'notes', kind: 'note', path: `note:${id}`, title: redact(title || body.split('\n')[0]).slice(0, 120), workspace: null, project_id, ts: now(), mtime: now(), size: body.length, chunks: 1, indexed_at: now() });
  const r = run('INSERT INTO memory_chunk (doc_id, ord, role, text, ts) VALUES (?,?,?,?,?)', id, 0, `note from ${agent}`, body, now());
  run('INSERT INTO memory_fts (chunk_id, doc_id, title, text) VALUES (?,?,?,?)', Number(r.lastInsertRowid), id, title || '', body);
  broadcast('memory', { project_id });
  return id;
}

// ---------- connect, import, inspect ----------
export function detected() {
  return Object.entries(ADAPTERS).map(([id, a]) => {
    const src = get("SELECT * FROM source WHERE tool='aimem' AND json_extract(scope,'$.adapter')=?", id);
    return {
      id, label: a.label, where: a.where, found: a.detect(), source: src && { id: src.id, status: src.status, last_sync: src.last_sync },
      docs: src ? get('SELECT COUNT(*) n FROM memory_doc WHERE source_id=? AND chunks > 0', src.id).n : 0,
      progress: src ? progress(src.id) : null,
    };
  });
}
export function connect(adapter, user) {
  if (!ADAPTERS[adapter]) throw Object.assign(new Error('Unknown AI'), { status: 400 });
  let src = get("SELECT * FROM source WHERE tool='aimem' AND json_extract(scope,'$.adapter')=?", adapter);
  if (!src) { insert('source', { id: uid('src'), workspace_id: WS, tool: 'aimem', name: ADAPTERS[adapter].label, scope: { adapter }, status: 'active', created_at: now() }); src = get("SELECT * FROM source WHERE tool='aimem' AND json_extract(scope,'$.adapter')=?", adapter); }
  else update('source', src.id, { status: 'active' });
  audit(user?.name || 'user', 'user', 'memory.connect', src.id, { adapter });
  refresh(src); // first read runs in the background
  return src;
}
export function disconnect(sourceId, user) { // forgets everything indexed from it; the AI's own files are untouched
  for (const d of all('SELECT id FROM memory_doc WHERE source_id=?', sourceId)) forget(d.id);
  run('DELETE FROM source WHERE id=?', sourceId);
  delete state[sourceId];
  audit(user?.name || 'user', 'user', 'memory.disconnect', sourceId);
}
export function importExport(buf, name) {
  mkdirSync(IMPORTS, { recursive: true });
  let json = buf;
  if (buf[0] === 0x50 && buf[1] === 0x4b) json = unzip(buf).find((e) => /conversations\.json$/i.test(e.name))?.data;
  if (!json) throw Object.assign(new Error('That zip has no conversations.json. Use the export from Claude.ai (Settings → Privacy → Export data) or ChatGPT (Settings → Data controls → Export).'), { status: 400 });
  try { JSON.parse(json.toString('utf8')); } catch { throw Object.assign(new Error('That file isn’t a conversations export (it isn’t JSON).'), { status: 400 }); }
  const file = path.join(IMPORTS, `${Date.now()}-${String(name).replace(/[^\w.-]+/g, '_').replace(/\.zip$/i, '')}.json`.replace(/\.json\.json$/, '.json'));
  writeFileSync(file, json);
  return connect('chats');
}
// Every prompt a person gave an AI in this project's folders, newest first: what they asked, the pictures they
// gave, the AI's first reply and its last. The journey is built from these.
// Chats filed out as not about the project are left out (hidden: only those; unjudged: only those not sorted yet).
export function exchangesFor(project_id, { from = 0, to = 8.64e15, limit = 600, hidden = false, unjudged = false, every = false } = {}) {
  const which = every ? '1=1' : unjudged ? 'r.rel IS NULL' : hidden ? 'r.rel=0' : 'COALESCE(r.rel,1)=1';
  return all(`SELECT c.id, c.ts, c.text, c.meta, d.adapter, d.title, d.id doc, r.rel, r.about, r.moment_id moment, r.by FROM memory_chunk c JOIN memory_doc d ON d.id=c.doc_id
    LEFT JOIN memory_rel r ON r.ts=c.ts
    WHERE d.project_id=? AND d.kind='session' AND c.role='exchange' AND c.ts>=? AND c.ts<? AND ${which} ORDER BY c.ts DESC LIMIT ?`, project_id, from, to, limit).filter((c, i, a) => c.ts !== a[i - 1]?.ts).map((c) => { // a resumed session repeats its chats
    const [asked, ...answers] = c.text.replace(/^Asked: /, '').split('\n\nAnswered: '); // chunks read before the journey existed
    const m = c.meta || { asked, first: answers[0] || null, last: answers.length > 1 ? answers.at(-1) : null, images: [] };
    return { id: c.id, ts: c.ts, tool: ADAPTERS[c.adapter]?.label || c.adapter, adapter: c.adapter, doc: c.doc, session: c.title, rel: c.rel, about: c.about, moment: c.moment, sorted_by: c.by, asked: m.asked, first: m.first, last: m.last, images: m.images || [], shot: m.shot || null };
  });
}

// Files a chat in or out of its project. The person's own call (by: 'you') is never overwritten by the AI.
export function judge(ts, { rel, about = null, moment_id = null, by }) { // by time: a session re-read meanwhile keeps it
  if (!ts) return;
  run(`INSERT INTO memory_rel (ts, rel, about, moment_id, by, at) VALUES (?,?,?,?,?,?) ON CONFLICT(ts) DO UPDATE SET rel=excluded.rel, by=excluded.by, at=excluded.at,
    about=COALESCE(excluded.about, about), moment_id=COALESCE(excluded.moment_id, moment_id) WHERE memory_rel.by != 'you' OR excluded.by = 'you'`, ts, rel ? 1 : 0, about, moment_id, by, now());
}
export const sortedCounts = () => get("SELECT COALESCE(SUM(rel=1),0) kept, COALESCE(SUM(rel=0),0) out FROM memory_rel");

export function docsFor(project_id, limit = 50) {
  return all(`SELECT id, adapter, kind, title, workspace, ts, chunks FROM memory_doc WHERE chunks > 0 AND ${project_id ? 'project_id=?' : 'project_id IS NULL'} ORDER BY ts DESC LIMIT ?`, ...(project_id ? [project_id] : []), limit)
    .map((d) => ({ ...d, tool: ADAPTERS[d.adapter]?.label || (d.adapter === 'notes' ? 'Agent notes' : d.adapter) }));
}
export function doc(id) {
  const d = get('SELECT * FROM memory_doc WHERE id=?', id);
  return d && { ...d, tool: ADAPTERS[d.adapter]?.label || d.adapter, chunks: all('SELECT role, text, ts FROM memory_chunk WHERE doc_id=? ORDER BY ord', id) };
}
