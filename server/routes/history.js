// A code project’s versions: its folder as git (run, read, download, roll back, push, @claude), packages, the
// walk of the running app (screens, frames), checks, stress, matching, and the design canvas.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { all, get, now, uid, audit } from '../db.js';
import { projectDirs } from '../casestudy.js';
import { proposals } from '../mcp.js';
import * as HX from '../history.js';
import * as FR from '../frames.js';
import * as SC from '../screens.js';
import * as CHK from '../check.js';
import * as DS from '../design.js';
import * as STRESS from '../stress.js';
import { r, err } from '../router.js';
import { commentRow } from '../shapes.js';

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
r('GET', '/api/projects/:id/insights/chats', 'read', async ({ params, need }) => (await import('../chats.js')).chatInsights(hxProject(params.id, need)), { guest: true });
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
r('GET', '/api/projects/:id/history/:sha/feedback', 'read', async ({ params, query, need }) => (await import('../evidence.js')).partComments(hxProject(params.id, need), params.sha, query.key || null, query.comp || null), { guest: true });
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
