// The project canvas and what its blocks hold: notes, references, decisions, artifacts, the case study and
// thinking.
import { all, get, run, insert, update, now, uid, broadcast, audit, edge } from '../db.js';
import { storeFile, extOf, MIME } from '../media.js';
import { textVec, cosine } from '../vec.js';
import * as E from '../engine.js';
import * as REF from '../refs.js';
import { artifactPage, artifactKind } from '../render.js';
import { blockList, items as blockItems, summary as blockSummary, saveCanvas, canvasOf } from '../blocks.js';
import { insights } from '../insights.js';
import * as CS from '../casestudy.js';
import * as AI from '../ai.js';
import * as TH from '../thinking.js';
import { r, err, can, sandboxed } from '../router.js';
import { strip, momentProject, projectOr404 } from '../shapes.js';

// ---- the project canvas: blocks, their contents, links between them and what the links reveal ----
const memoItems = (p) => { const memo = {}; return (b) => (memo[b] ||= blockItems(p, b)); };

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
r('GET', '/api/projects/:id/decisions', 'read', async ({ params, need }) => { need('read', params.id); await (await import('../chats.js')).suggestDecisions(get('SELECT * FROM project WHERE id=?', params.id)).catch(() => 0); return all("SELECT * FROM decision WHERE project_id=? ORDER BY status='confirmed' DESC, created_at DESC", params.id); }, { guest: true });
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

// ---- thinking: your reasons, in your words, and the story they make (server/thinking.js) ----
const talkMinutes = (v) => Math.min(60, Math.max(3, parseInt(v, 10) || 10));
const thoughtOr404 = (id) => { const t = get('SELECT * FROM thought WHERE id=?', id); if (!t) throw err(404, 'No such thought'); return t; };
r('GET', '/api/projects/:id/thinking', 'read', ({ params, query, need }) => { need('read', params.id); return TH.view(projectOr404(params.id), talkMinutes(query.minutes)); }, { guest: true });
r('POST', '/api/projects/:id/thoughts', 'edit', ({ params, body, user, need }) => {
  need('edit', params.id); projectOr404(params.id);
  const t = TH.add(params.id, { text: body.text, kind: body.kind, beat: body.beat, moment_id: body.moment_id, question: body.question, by: 'you', author: user.name });
  broadcast('thought', { id: t.id, project_id: params.id });
  return t;
});
r('PATCH', '/api/thoughts/:id', 'edit', ({ params, body, need }) => { const t = thoughtOr404(params.id); need('edit', t.project_id); const out = TH.edit(t.id, body, 'you'); broadcast('thought', { id: t.id, project_id: t.project_id }); return out; });
r('DELETE', '/api/thoughts/:id', 'edit', ({ params, need }) => { const t = thoughtOr404(params.id); need('edit', t.project_id); TH.remove(t.id); broadcast('thought', { id: t.id, project_id: t.project_id }); });
r('GET', '/api/projects/:id/story.md', 'read', ({ params, query, need, res }) => {
  need('read', params.id);
  const p = projectOr404(params.id);
  res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${p.name.replace(/[^\w.-]+/g, '-')}-story.md"` });
  res.end(TH.markdown(p, talkMinutes(query.minutes)));
}, { guest: true });
