// Trace’s own AI (the person’s Vercel AI Gateway key): Ask, the files it proposes, its jobs on a project; and
// AI memory, what each AI already remembers.
import { get, now, settings, setSettings, broadcast, audit } from '../db.js';
import { setSecret, deleteSecret, hint } from '../secrets.js';
import * as MEM from '../memory.js';
import { aiTools, proposals } from '../mcp.js';
import * as AI from '../ai.js';
import * as F from '../folders.js';
import { r, err, can } from '../router.js';
import { projectOr404 } from '../shapes.js';

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
