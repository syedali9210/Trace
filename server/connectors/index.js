// Connector SDK registry + scheduler. Every connector implements the same shape:
//   authorize(input) → { name, scope, auth_ref }   listScopes(source)   subscribe/unsubscribe(source) or poll(source)
//   fetchObject(event, source) → DOM-T assets      renderPreview(event, asset, desc, source) → picture/props
//   mapActor(external)                             health(source)
import { all, get, insert, update, run, uid, now, audit, broadcast, WS } from '../db.js';
import { deleteSecret } from '../secrets.js';
import { registerConnector, registry, systemSource } from '../engine.js';
import { upload, folder, agent } from './local.js';
import { link } from './link.js';
import { figma } from './figma.js';
import { github } from './github.js';

for (const c of [upload, folder, agent, link, figma, github]) registerConnector(c);

export const CATALOG = [
  { tool: 'figma', label: 'Figma', how: 'Personal access token + REST API, checked every minute', gets: 'Frames and their properties, named versions, comments, renders, variables (Enterprise)', fidelity: 'High' },
  { tool: 'github', label: 'GitHub', how: 'Token or GitHub CLI login, checked every minute', gets: 'Commits, diffs, pull requests, review comments, links between code and design', fidelity: 'High' },
  { tool: 'folder', label: 'Watched folder', how: 'Watches a folder on this computer for saves', gets: 'Any file: screenshots, exports, .ai, .psd, .riv, .sketch, video', fidelity: 'Medium (visual diff)' },
  { tool: 'link', label: 'Embed links', how: 'Paste a link; snapshotted now and every 6 hours', gets: 'Framer, Spline, Rive, Webflow, Adobe, YouTube, Loom, Dribbble, Behance, Google Docs, any page', fidelity: 'Low to medium' },
  { tool: 'upload', label: 'Drop & paste', how: 'Drag files anywhere, paste, or use Upload', gets: 'Any file; zips are unpacked', fidelity: 'Medium' },
  { tool: 'agent', label: 'AI agents (MCP)', how: 'Claude, Cursor or any MCP client, with a Trace token', gets: 'Work agents log, artifacts, comments', fidelity: 'Medium' },
];

export async function connect(tool, input = {}, user) {
  const c = registry[tool];
  if (!c?.authorize) throw Object.assign(new Error(`${tool} can’t be connected that way`), { status: 400 });
  const auth = await c.authorize(input);
  const src = { id: uid('src'), workspace_id: WS, tool, name: input.label || auth.name, scope: auth.scope || {}, auth_ref: auth.auth_ref || null, status: 'active', project_id: input.project_id || null, mapping_rules: {}, cursor: {}, health: {}, created_at: now() };
  insert('source', src);
  const s = get('SELECT * FROM source WHERE id=?', src.id);
  c.subscribe?.(s);
  if (tool === 'folder' && input.import !== false) c.initialScan(s);
  if (c.poll) pollSource(s);
  audit(user?.name || 'user', 'user', 'source.connect', s.id, { tool, name: s.name });
  return s;
}

// Disconnect wipes the stored token at once and stops capture; captured history stays.
export function disconnect(id, user) {
  const s = get('SELECT * FROM source WHERE id=?', id);
  if (!s) return;
  if (['upload', 'agent', 'link'].includes(s.tool)) throw Object.assign(new Error('Built-in sources can be paused, not disconnected.'), { status: 400 });
  registry[s.tool]?.unsubscribe?.(s);
  if (s.auth_ref) deleteSecret(s.auth_ref);
  run('DELETE FROM source WHERE id=?', id);
  run("UPDATE job SET status='dead', error='source disconnected' WHERE status='queued' AND json_extract(payload,'$.event_id') IN (SELECT id FROM event WHERE source_id=?)", id);
  audit(user?.name || 'user', 'user', 'source.disconnect', id, { tool: s.tool, name: s.name });
}

export function setSourceStatus(id, status) {
  const s = get('SELECT * FROM source WHERE id=?', id);
  update('source', id, { status });
  if (status === 'active') registry[s.tool]?.subscribe?.({ ...s, status });
  else registry[s.tool]?.unsubscribe?.(s);
}

const polling = new Set();
export async function pollSource(s) {
  if (polling.has(s.id) || !registry[s.tool]?.poll) return;
  if (s.cursor?.backoff_until > now()) return;
  polling.add(s.id);
  try {
    await registry[s.tool].poll(get('SELECT * FROM source WHERE id=?', s.id));
    const fresh = get('SELECT * FROM source WHERE id=?', s.id);
    if (fresh) update('source', s.id, { last_sync: now(), error: null, health: { ...fresh.health, ok: true } });
  } catch (e) {
    const fresh = get('SELECT * FROM source WHERE id=?', s.id);
    if (fresh) update('source', s.id, { last_sync: now(), error: e.message, health: { ...fresh.health, ok: false }, cursor: e.retryAfter ? { ...fresh.cursor, backoff_until: now() + e.retryAfter * 1000 } : fresh.cursor });
  } finally {
    polling.delete(s.id);
    broadcast('source', { id: s.id });
  }
}

export function startConnectors() {
  systemSource('upload', 'Uploads');
  systemSource('agent', 'AI agents (MCP)');
  const l = systemSource('link', 'Links');
  if (!l.last_sync) update('source', l.id, { last_sync: now() });
  for (const s of all("SELECT * FROM source WHERE status='active'")) registry[s.tool]?.subscribe?.(s);
  setInterval(() => {
    for (const s of all("SELECT * FROM source WHERE status='active'")) {
      const c = registry[s.tool];
      if (c?.poll && c.interval && now() - (s.last_sync || 0) > c.interval) pollSource(s);
    }
  }, 15000);
}
