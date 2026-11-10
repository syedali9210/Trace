// The captured work: files and their versions, changes (review and what you can do to one), uploads and links,
// and comments.
import path from 'node:path';
import { all, get, run, insert, update, now, uid, broadcast, notify, edge } from '../db.js';
import { diffSnapshots } from '../diff.js';
import * as E from '../engine.js';
import * as W from '../words.js';
import * as REF from '../refs.js';
import { RENDERABLE, livePage } from '../render.js';
import { visualSnap, changelog } from '../blocks.js';
import { pollSource } from '../connectors/index.js';
import { captureUpload } from '../connectors/local.js';
import { captureLink, resolve as resolveLink } from '../connectors/link.js';
import { fileKeyOf } from '../connectors/figma.js';
import * as HX from '../history.js';
import { r, err, can, sandboxed } from '../router.js';
import { strip, snapThumb, projectName, momentProject, momentCard, commentRow, resolveTarget, journey } from '../shapes.js';

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

r('GET', '/api/moments/:id/changelog', 'read', ({ params, need }) => { const m = get('SELECT * FROM moment WHERE id=?', params.id); need('read', m.project_id || m.route_guess); return changelog(m); }, { guest: true });

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
  if (region?.kind === 'part' && target_type === 'version') region = (await import('../evidence.js')).partOf(get('SELECT * FROM project WHERE id=?', pid), target_id.split(':')[1], region) || null; // pinned to a part: what it is now, so a later walk can show it changed
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
