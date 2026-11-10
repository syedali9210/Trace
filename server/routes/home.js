// Home and the session: who is signed in, the feed (each project’s newest work beside its changelog), activity,
// notifications, search, what became of an upload, onboarding and the sample.
import { all, get, run, update, WS, settings, setSettings, workspace } from '../db.js';
import * as R from '../retrieval.js';
import * as REF from '../refs.js';
import { visualSnap, changelog } from '../blocks.js';
import * as CS from '../casestudy.js';
import * as AI from '../ai.js';
import * as F from '../folders.js';
import { seedDemo } from '../demo.js';
import { categoryOf } from '../category.js';
import * as SC from '../screens.js';
import { r } from '../router.js';
import { projectName, projectCard } from '../shapes.js';

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

// ---- onboarding & demo ----
r('POST', '/api/onboarding', 'admin', ({ body }) => {
  if (body.mode) update('workspace', WS, { mode: body.mode === 'team' ? 'team' : 'solo' });
  if (body.name) update('workspace', WS, { name: body.name });
  if (body.done) setSettings({ onboarded: true });
});
r('POST', '/api/demo', 'admin', async () => seedDemo({ addReference: REF.addReference }));

// ---- the feed (NCS "Latest"): each project's newest iteration, the one before, and its changelog ----
// A project's cover: its first walked screen (the app as it draws, waited for), else its running app's picture, else
// none (the card shows its latest work).
const coverOf = (p, shot) => { try { const w = SC.screens(p, 'now'); const s0 = w.screens?.[0]; if (s0?.thumb) return { thumb_key: s0.thumb, image_key: s0.shot, app: true, form: w.device || 'desktop' }; } catch {} return shot ? { thumb_key: shot.thumb_key, image_key: shot.image_key, app: true } : null; };
r('GET', '/api/feed', 'read', () => {
  const ps = all("SELECT * FROM project WHERE status='active'").map((p) => {
    const ms = all("SELECT * FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC LIMIT 2", p.id);
    const shot = get('SELECT thumb_key, image_key FROM history_shot WHERE project_id=? ORDER BY created_at DESC LIMIT 1', p.id); // the app itself, running: the best cover a code project has
    return { id: p.id, name: p.name, tasks: all("SELECT id, title, status, assignee_type, assignee FROM issue WHERE project_id=? AND status IN ('open','in_progress') ORDER BY status='in_progress' DESC, updated_at DESC LIMIT 4", p.id).map((t) => ({ ...t, assignee: t.assignee_type === 'agent' ? t.assignee : t.assignee && get('SELECT name FROM user WHERE id=?', t.assignee)?.name })), open_reviews: get("SELECT COUNT(*) n FROM comment WHERE project_id=? AND parent_id IS NULL AND status='open'", p.id).n, iterations: get("SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted'", p.id).n, last: ms[0]?.end_ts || p.updated_at, latest: ms[0] && { ...changelog(ms[0]), image: visualSnap(ms[0].id) }, previous: ms[1] && { id: ms[1].id, title: ms[1].title, end_ts: ms[1].end_ts, image: visualSnap(ms[1].id) },
      screens: SC.screenCount(p.id), files: get('SELECT COUNT(*) n FROM asset WHERE project_id=?', p.id).n, // the facts a card shows
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

// What became of an upload: sorted into a project (with Undo), or waiting in review.
r('GET', '/api/batch/:id', 'read', ({ params }) => all("SELECT id, status, stage, project_id, route_guess, route_confidence, title, event_count FROM moment WHERE batch=? AND status != 'discarded'", params.id)
  .map((m) => ({ ...m, project_name: projectName(m.project_id), image: visualSnap(m.id), iterations: get('SELECT COUNT(*) n FROM moment_asset WHERE moment_id=?', m.id).n })));
