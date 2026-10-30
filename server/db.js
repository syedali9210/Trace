// SQLite store, ids, live events (SSE), audit log and notifications.
// ponytail: one local SQLite file; move to Postgres + pgvector when Trace runs hosted for many workspaces.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA = process.env.TRACE_DATA || path.join(ROOT, 'data');
mkdirSync(path.join(DATA, 'files'), { recursive: true });

export const db = new DatabaseSync(path.join(DATA, 'trace.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000;');

db.exec(`
CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY, name TEXT, mode TEXT DEFAULT 'solo', plan TEXT DEFAULT 'pro', settings TEXT DEFAULT '{}', created_at INTEGER);
CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT, email TEXT, avatar TEXT, is_agent INTEGER DEFAULT 0, external INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS membership (workspace_id TEXT, user_id TEXT, role TEXT, token TEXT UNIQUE, created_at INTEGER, PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, brief TEXT DEFAULT '', status TEXT DEFAULT 'active', centroid TEXT, pinned TEXT DEFAULT '[]', do_not_capture TEXT DEFAULT '[]', workflow TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS project_member (project_id TEXT, user_id TEXT, role TEXT, PRIMARY KEY (project_id, user_id));
CREATE TABLE IF NOT EXISTS source (id TEXT PRIMARY KEY, workspace_id TEXT, tool TEXT, name TEXT, scope TEXT DEFAULT '{}', auth_ref TEXT, status TEXT DEFAULT 'active', project_id TEXT, mapping_rules TEXT DEFAULT '{}', cursor TEXT DEFAULT '{}', auto_accept INTEGER DEFAULT 0, accept_streak INTEGER DEFAULT 0, last_sync INTEGER, error TEXT, health TEXT DEFAULT '{}', created_at INTEGER);
CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, source_id TEXT, tool TEXT, external_id TEXT, version TEXT, type TEXT, actor TEXT, ts INTEGER, payload TEXT, idempotency_key TEXT UNIQUE, created_at INTEGER);
CREATE TABLE IF NOT EXISTS asset (id TEXT PRIMARY KEY, project_id TEXT, source_id TEXT, external_id TEXT, tool TEXT, type TEXT, name TEXT, path TEXT, parent TEXT, url TEXT, latest_snapshot_id TEXT, created_at INTEGER, updated_at INTEGER, UNIQUE (source_id, external_id));
CREATE TABLE IF NOT EXISTS snapshot (id TEXT PRIMARY KEY, asset_id TEXT, event_id TEXT, prev_id TEXT, image_key TEXT, thumb_key TEXT, file_key TEXT, mime TEXT, width INTEGER, height INTEGER, phash TEXT, content_hash TEXT, properties TEXT, text TEXT, embedding TEXT, img_vec TEXT, diff TEXT, flags TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS moment (id TEXT PRIMARY KEY, project_id TEXT, source_id TEXT, actor_id TEXT, actor_name TEXT, tool TEXT, start_ts INTEGER, end_ts INTEGER, title TEXT, summary TEXT, why TEXT, tags TEXT DEFAULT '[]', magnitude INTEGER DEFAULT 0, bucket TEXT DEFAULT 'small', basis TEXT DEFAULT '{}', status TEXT DEFAULT 'open', stage TEXT DEFAULT 'capturing', exploration_id TEXT, route_confidence REAL, route_reason TEXT, route_guess TEXT, event_count INTEGER DEFAULT 0, batch TEXT, agent TEXT, pinned INTEGER DEFAULT 0, embedding TEXT, closing TEXT, edited INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS moment_asset (moment_id TEXT, asset_id TEXT, first_snapshot_id TEXT, last_snapshot_id TEXT, PRIMARY KEY (moment_id, asset_id));
CREATE TABLE IF NOT EXISTS moment_event (moment_id TEXT, event_id TEXT, PRIMARY KEY (moment_id, event_id));
CREATE TABLE IF NOT EXISTS change (id TEXT PRIMARY KEY, moment_id TEXT, asset_id TEXT, kind TEXT, path TEXT, before TEXT, after TEXT, region TEXT, weight REAL, label TEXT);
CREATE TABLE IF NOT EXISTS comment (id TEXT PRIMARY KEY, project_id TEXT, target_type TEXT, target_id TEXT, region TEXT, author_id TEXT, author_name TEXT, body TEXT, parent_id TEXT, sent_to_ai INTEGER DEFAULT 0, ai_status TEXT, status TEXT DEFAULT 'open', reactions TEXT DEFAULT '{}', external_ref TEXT UNIQUE, external_url TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS reference (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, url TEXT, embed_url TEXT, file_key TEXT, thumb_key TEXT, title TEXT, note TEXT, tags TEXT DEFAULT '[]', palette TEXT DEFAULT '[]', embedding TEXT, img_vec TEXT, x REAL, y REAL, w REAL, h REAL, grp TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS decision (id TEXT PRIMARY KEY, project_id TEXT, text TEXT, source_type TEXT, source_id TEXT, confirmed_by TEXT, status TEXT DEFAULT 'suggested', created_at INTEGER);
CREATE TABLE IF NOT EXISTS exploration (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, description TEXT, status TEXT DEFAULT 'open', created_at INTEGER);
CREATE TABLE IF NOT EXISTS proposal (id TEXT PRIMARY KEY, project_id TEXT, exploration_id TEXT, title TEXT, description TEXT, moment_ids TEXT DEFAULT '[]', reviewers TEXT DEFAULT '[]', reviews TEXT DEFAULT '[]', status TEXT DEFAULT 'open', author_id TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS issue (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, body TEXT, assignee_type TEXT, assignee TEXT, labels TEXT DEFAULT '[]', links TEXT DEFAULT '[]', status TEXT DEFAULT 'open', source_comment_id TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS artifact (id TEXT PRIMARY KEY, project_id TEXT, type TEXT, title TEXT, content TEXT, url TEXT, file_key TEXT, prompt TEXT, context_pack TEXT, model TEXT, agent TEXT, source_comment_id TEXT, status TEXT DEFAULT 'proposed', moment_id TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS edge (from_type TEXT, from_id TEXT, rel TEXT, to_type TEXT, to_id TEXT, created_at INTEGER, PRIMARY KEY (from_type, from_id, rel, to_type, to_id));
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, actor TEXT, actor_type TEXT, action TEXT, target TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS job (id INTEGER PRIMARY KEY AUTOINCREMENT, stage TEXT, payload TEXT, status TEXT DEFAULT 'queued', attempts INTEGER DEFAULT 0, run_after INTEGER, error TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS mcp_token (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE, hint TEXT, name TEXT, scopes TEXT DEFAULT 'read', project_ids TEXT, user_id TEXT, created_at INTEGER, last_used INTEGER, revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS route_rule (id TEXT PRIMARY KEY, pattern TEXT, project_id TEXT, hits INTEGER DEFAULT 1, created_at INTEGER, UNIQUE (pattern, project_id));
CREATE TABLE IF NOT EXISTS correction (id INTEGER PRIMARY KEY AUTOINCREMENT, moment_id TEXT, kind TEXT, from_project TEXT, to_project TEXT, confidence REAL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS notification (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, kind TEXT, text TEXT, link TEXT, read INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS deck (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, template TEXT, range TEXT, slides TEXT DEFAULT '[]', created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS guest_link (token TEXT PRIMARY KEY, project_id TEXT, name TEXT, expires_at INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS memory_doc (id TEXT PRIMARY KEY, source_id TEXT, adapter TEXT, kind TEXT, path TEXT UNIQUE, title TEXT, workspace TEXT, project_id TEXT, ts INTEGER, mtime INTEGER, size INTEGER, chunks INTEGER DEFAULT 0, indexed_at INTEGER);
CREATE TABLE IF NOT EXISTS memory_chunk (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, ord INTEGER, role TEXT, text TEXT, ts INTEGER);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(chunk_id UNINDEXED, doc_id UNINDEXED, title, text, tokenize='porter unicode61');
CREATE INDEX IF NOT EXISTS memory_chunk_doc ON memory_chunk (doc_id);
CREATE INDEX IF NOT EXISTS memory_doc_project ON memory_doc (project_id, ts);
CREATE TABLE IF NOT EXISTS summary (project_id TEXT, period TEXT, key TEXT, text TEXT, created_at INTEGER, PRIMARY KEY (project_id, period, key));
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(kind UNINDEXED, ref_id UNINDEXED, project_id UNINDEXED, title, body, tokenize='porter unicode61');
CREATE INDEX IF NOT EXISTS job_q ON job (stage, status, run_after);
CREATE INDEX IF NOT EXISTS moment_p ON moment (project_id, status, end_ts);
CREATE INDEX IF NOT EXISTS snap_a ON snapshot (asset_id, created_at);
CREATE INDEX IF NOT EXISTS comment_t ON comment (target_type, target_id);
CREATE INDEX IF NOT EXISTS edge_to ON edge (to_type, to_id);
`);

// Columns added after the first release.
for (const [t, c] of [['deck', 'accent TEXT'], ['decision', 'governs TEXT'], ['moment', 'sentence TEXT'], ['project', "folders TEXT DEFAULT '[]'"], ['comment', 'kind TEXT'], ['comment', 'meta TEXT'], ['reference', 'origin TEXT'], ['memory_chunk', 'meta TEXT'], ['project', "canvas TEXT DEFAULT '{}'"], ['artifact', 'meta TEXT'], ['project', 'digest TEXT'], ['history_run', 'agent TEXT']]) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch {} // already there
}
// Sticky notes, constraints, ideas and insights people or agents write on the project canvas; and case-study answers.
db.exec(`CREATE TABLE IF NOT EXISTS note (id TEXT PRIMARY KEY, project_id TEXT, block TEXT, kind TEXT DEFAULT 'sticky', text TEXT, color TEXT, anchor TEXT, meta TEXT, author_id TEXT, author_name TEXT, done INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS note_p ON note (project_id, block);
CREATE TABLE IF NOT EXISTS case_answer (project_id TEXT, section TEXT, answer TEXT, origin TEXT, author TEXT, evidence TEXT, updated_at INTEGER, PRIMARY KEY (project_id, section));`);
// A reference pinned to the change it informed (optionally to a spot on its picture).
// Whether an AI chat in a project's folder is about the project (by: rules, ai or you), what it was about, and the change
// it led to. Keyed by the chat's time: re-reading a session gives its chunks new ids, and a resumed session copies its
// chats, times and all, into a new file.
if (db.prepare("SELECT 1 FROM pragma_table_info('memory_rel') WHERE name='path'").get()) db.exec('DROP TABLE memory_rel'); // the first cut keyed by file too
db.exec(`CREATE TABLE IF NOT EXISTS memory_rel (ts INTEGER PRIMARY KEY, rel INTEGER, about TEXT, moment_id TEXT, by TEXT, at INTEGER)`);
db.exec(`CREATE TABLE IF NOT EXISTS ref_link (ref_id TEXT, moment_id TEXT, change_id TEXT, region TEXT, note TEXT, by TEXT, created_at INTEGER, PRIMARY KEY (ref_id, moment_id));
CREATE INDEX IF NOT EXISTS ref_link_m ON ref_link (moment_id);`);
// History: Claude's runs from @claude comments (what it was asked, every step, what it said, the version it made), and
// each version's picture, taken when it ran.
db.exec(`CREATE TABLE IF NOT EXISTS history_run (id TEXT PRIMARY KEY, project_id TEXT, dir TEXT, base TEXT, target TEXT, asked TEXT, by TEXT, agent TEXT, comment_id TEXT, status TEXT, steps TEXT, reply TEXT, title TEXT, why TEXT, sha TEXT, cost REAL, ms INTEGER, session TEXT, error TEXT, created_at INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS history_run_p ON history_run (project_id, sha);
CREATE TABLE IF NOT EXISTS history_shot (project_id TEXT, sha TEXT, image_key TEXT, thumb_key TEXT, created_at INTEGER, PRIMARY KEY (project_id, sha));`);

// Columns stored as JSON text, parsed on the way out.
const JSON_COLS = new Set(['governs', 'steps', 'canvas', 'digest', 'anchor', 'evidence', 'meta', 'sentence', 'folders', 'settings', 'pinned', 'do_not_capture', 'workflow', 'scope', 'mapping_rules', 'cursor', 'health', 'payload', 'properties', 'embedding', 'img_vec', 'diff', 'flags', 'tags', 'basis', 'region', 'reactions', 'palette', 'moment_ids', 'reviewers', 'reviews', 'labels', 'links', 'context_pack', 'detail', 'project_ids', 'slides', 'centroid', 'range']);

const parse = (r) => {
  if (!r) return r;
  for (const k in r) if (JSON_COLS.has(k) && typeof r[k] === 'string') { try { r[k] = JSON.parse(r[k]); } catch {} }
  return r;
};
const enc = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);

const stmts = new Map();
const prep = (sql) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };

export const all = (sql, ...p) => prep(sql).all(...p.map(enc)).map(parse);
export const get = (sql, ...p) => parse(prep(sql).get(...p.map(enc)));
export const run = (sql, ...p) => prep(sql).run(...p.map(enc));

export function insert(table, obj) {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k]));
  return obj;
}
export function update(table, id, obj, key = 'id') {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (keys.length) run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${key}=?`, ...keys.map((k) => obj[k]), id);
}
export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const now = () => Date.now();
export const uid = (p) => `${p}_${randomBytes(6).toString('base64url')}`;
export const token = () => randomBytes(24).toString('base64url');

// ---- workspace bootstrap ----
export const WS = 'ws';
if (!get('SELECT id FROM workspace WHERE id=?', WS)) {
  tx(() => {
    insert('workspace', { id: WS, name: 'My workspace', mode: 'solo', plan: 'pro', settings: JSON.stringify(defaultSettings()), created_at: now() });
    insert('user', { id: 'u_owner', name: process.env.USERNAME || process.env.USER || 'You', email: '', created_at: now() });
    insert('membership', { workspace_id: WS, user_id: 'u_owner', role: 'owner', token: token(), created_at: now() });
  });
}
function defaultSettings() {
  return {
    onboarded: false, paused: false, session_gap_min: 20, file_threshold: 0.85, inbox_threshold: 0.5,
    auto_accept_suggest_after: 20, mute: [],
  };
}
export const settings = () => ({ ...defaultSettings(), ...get('SELECT settings FROM workspace WHERE id=?', WS).settings });
export const workspace = () => get('SELECT * FROM workspace WHERE id=?', WS);
export function setSettings(patch) {
  update('workspace', WS, { settings: JSON.stringify({ ...settings(), ...patch }) });
  return settings();
}

// ---- live events to open browsers (Server-Sent Events) ----
const clients = new Set();
export function addClient(res, user) { clients.add({ res, user }); res.on('close', () => { for (const c of clients) if (c.res === res) clients.delete(c); }); }
export function broadcast(type, data = {}) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.user.guest && data.project_id && data.project_id !== c.user.project_id) continue;
    c.res.write(line);
  }
}

// ---- audit + notifications ----
export function audit(actor, actor_type, action, target, detail = {}) {
  run('INSERT INTO audit_log (ts, actor, actor_type, action, target, detail) VALUES (?,?,?,?,?,?)', now(), actor, actor_type, action, target, detail);
}
export function notify(kind, text, link, user_id = null) {
  const users = user_id ? [user_id] : all("SELECT user_id FROM membership WHERE workspace_id=? AND role != 'guest'", WS).map((r) => r.user_id);
  for (const u of users) run('INSERT INTO notification (user_id, kind, text, link, created_at) VALUES (?,?,?,?,?)', u, kind, text, link, now());
  broadcast('notification', { kind, text, link });
}

export function edge(from_type, from_id, rel, to_type, to_id) {
  if (!from_id || !to_id) return;
  run('INSERT OR IGNORE INTO edge VALUES (?,?,?,?,?,?)', from_type, from_id, rel, to_type, to_id, now());
}

// People: map an external identity (email, handle, OS user) to a Trace user, or keep it as an external person.
export function mapActor(name, email = '') {
  const key = (email || name || 'unknown').trim();
  const u = get("SELECT * FROM user WHERE (email != '' AND lower(email)=lower(?)) OR lower(name)=lower(?)", email || '\u0000', name || '\u0000');
  if (u) return u;
  const user = { id: uid('u'), name: name || key, email, external: 1, created_at: now() };
  insert('user', user);
  return user;
}
