// The workspace: sources, settings and the engine, people and guest links, MCP tokens and the audit log, export
// and delete everything.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { db, all, get, run, insert, update, tx, now, uid, token as newToken, ROOT, DATA, WS, settings, setSettings, workspace, broadcast, audit } from '../db.js';
import { deleteSecret, hint } from '../secrets.js';
import { readKey, zip } from '../media.js';
import { CATALOG, connect, disconnect, setSourceStatus, pollSource } from '../connectors/index.js';
import { registry } from '../engine.js';
import { hashToken } from '../mcp.js';
import { r, err } from '../router.js';
import { projectName } from '../shapes.js';

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
