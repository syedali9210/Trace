// Planning: to-do (tasks as a board, linked “do this, then that”), explorations and proposals, the workflow
// map, and decks.
import { all, get, run, insert, update, tx, now, uid, settings, setSettings, broadcast, audit, notify, edge } from '../db.js';
import * as E from '../engine.js';
import * as MEM from '../memory.js';
import { buildDeck, pptx, TEMPLATES } from '../deck.js';
import * as HX from '../history.js';
import { r, err } from '../router.js';
import { momentCard, commentRow } from '../shapes.js';

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
