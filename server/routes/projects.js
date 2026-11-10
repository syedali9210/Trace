// A project: made, read, changed, deleted; its timeline, files, tree and journey; the script its agents get,
// assemble (point Trace at a folder), a folder dropped in the browser, and the coding-agent skills.
import { readFileSync, existsSync, statSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { all, get, run, insert, update, tx, now, uid, ROOT, WS, broadcast, audit } from '../db.js';
import { filePath } from '../media.js';
import * as E from '../engine.js';
import * as R from '../retrieval.js';
import * as W from '../words.js';
import * as MEM from '../memory.js';
import { visualSnap } from '../blocks.js';
import * as CS from '../casestudy.js';
import { projectDirs } from '../casestudy.js';
import { connect, disconnect } from '../connectors/index.js';
import { sortFiles } from '../relevance.js';
import { AGENT_SCRIPT } from '../mcp.js';
import * as AI from '../ai.js';
import * as F from '../folders.js';
import * as TH from '../thinking.js';
import { r, err, can } from '../router.js';
import { strip, momentCard, projectCard, projectOr404, journey } from '../shapes.js';

// ---- projects ----
r('POST', '/api/projects', 'edit', ({ body, user }) => {
  const name = String(body.name || '').trim();
  if (!name) throw err(400, 'Give the project a name.');
  const p = { id: uid('p'), workspace_id: WS, name, brief: body.brief || '', status: 'active', pinned: [], do_not_capture: [], created_at: now(), updated_at: now() };
  insert('project', p);
  E.updateCentroid(p.id);
  E.ftsPut('project', p.id, p.id, name, p.brief);
  if (body.from_moment) { E.moveMoment(body.from_moment, p.id, user); }
  audit(user.name, 'user', 'project.create', p.id);
  broadcast('project', { id: p.id });
  return p;
});

r('GET', '/api/projects/:id', 'read', async ({ params, need, user }) => {
  need('read', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  if (!p) throw err(404, 'No such project');
  const counts = {};
  for (const [k, sql] of Object.entries({ timeline: "SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL", references: 'SELECT COUNT(*) n FROM reference WHERE project_id=?', files: 'SELECT COUNT(*) n FROM asset WHERE project_id=?', decisions: 'SELECT COUNT(*) n FROM decision WHERE project_id=?', issues: "SELECT COUNT(*) n FROM issue WHERE project_id=? AND status IN ('open','in_progress')", proposals: "SELECT COUNT(*) n FROM proposal WHERE project_id=? AND status IN ('open','changes_requested')", artifacts: "SELECT COUNT(*) n FROM artifact WHERE project_id=? AND status IN ('proposed','working','queued')", explorations: "SELECT COUNT(*) n FROM exploration WHERE project_id=? AND status='open'" })) counts[k] = get(sql, p.id).n;
  counts.why_open = TH.nudge(p.id).open; // changes waiting for your why (the Thinking view)
  return {
    ...projectCard(p), counts,
    people: all('SELECT DISTINCT actor_name name, agent FROM moment WHERE project_id=? AND status=? LIMIT 30', p.id, 'accepted'),
    members: all('SELECT pm.user_id, pm.role, u.name FROM project_member pm JOIN user u ON u.id=pm.user_id WHERE pm.project_id=?', p.id),
    explorations: all('SELECT * FROM exploration WHERE project_id=? ORDER BY created_at DESC', p.id),
    can_edit: can(user, 'edit', p.id), can_review: can(user, 'review', p.id),
  };
}, { guest: true });

r('PATCH', '/api/projects/:id', 'edit', ({ params, body, need, user }) => {
  need('edit', params.id);
  const patch = {};
  for (const k of ['name', 'brief', 'status', 'pinned', 'do_not_capture', 'folders']) if (body[k] !== undefined) patch[k] = body[k];
  update('project', params.id, { ...patch, updated_at: now() });
  if (patch.name || patch.brief !== undefined) { E.updateCentroid(params.id); const p = get('SELECT * FROM project WHERE id=?', params.id); E.ftsPut('project', p.id, p.id, p.name, p.brief); }
  if (patch.folders) MEM.remap(); // AI memory from these folders now belongs to this project
  audit(user.name, 'user', 'project.update', params.id, Object.keys(patch));
  broadcast('project', { id: params.id, project_id: params.id });
  return strip(get('SELECT * FROM project WHERE id=?', params.id));
});

// Hard delete: the project, everything captured into it, and stored files nothing else uses.
r('DELETE', '/api/projects/:id', 'admin', ({ params, user }) => {
  const id = params.id;
  const keys = new Set(all('SELECT s.image_key, s.thumb_key, s.file_key FROM snapshot s JOIN asset a ON a.id=s.asset_id WHERE a.project_id=?', id).flatMap((s) => [s.image_key, s.thumb_key, s.file_key]).concat(all('SELECT file_key, thumb_key FROM reference WHERE project_id=?', id).flatMap((x) => [x.file_key, x.thumb_key])).filter(Boolean));
  const copies = (get('SELECT folders FROM project WHERE id=?', id)?.folders || []).filter((d) => path.resolve(d).startsWith(F.DATA_FOLDERS + path.sep)); // a folder Trace copied in goes with it; a linked one stays where it is
  for (const s of all("SELECT id FROM source WHERE tool='folder' AND project_id=?", id)) disconnect(s.id, user); // and nothing keeps watching for it
  tx(() => {
    const mids = all('SELECT id FROM moment WHERE project_id=? OR (project_id IS NULL AND route_guess=?)', id, id).map((m) => m.id);
    for (const m of mids) for (const t of ['change', 'moment_asset', 'moment_event']) run(`DELETE FROM ${t} WHERE moment_id=?`, m);
    run('DELETE FROM moment WHERE project_id=? OR (project_id IS NULL AND route_guess=?)', id, id);
    run('DELETE FROM snapshot WHERE asset_id IN (SELECT id FROM asset WHERE project_id=?)', id);
    run('DELETE FROM ref_link WHERE ref_id IN (SELECT id FROM reference WHERE project_id=?)', id);
    for (const t of ['asset', 'comment', 'reference', 'decision', 'exploration', 'proposal', 'issue', 'artifact', 'deck', 'guest_link', 'summary', 'project_member', 'route_rule', 'thought']) run(`DELETE FROM ${t} WHERE project_id=?`, id);
    run('DELETE FROM search_fts WHERE project_id=?', id);
    run("DELETE FROM edge WHERE (to_type='project' AND to_id=?)", id);
    run('DELETE FROM project WHERE id=?', id);
  });
  let removed = 0;
  for (const k of keys) {
    const used = get('SELECT 1 FROM snapshot WHERE ? IN (image_key, thumb_key, file_key) UNION SELECT 1 FROM reference WHERE ? IN (file_key, thumb_key) LIMIT 1', k, k);
    if (!used) { try { rmSync(filePath(k)); removed++; } catch {} }
  }
  for (const d of copies) rmSync(d, { recursive: true, force: true });
  audit(user.name, 'user', 'project.delete', id, { files_removed: removed });
  broadcast('project', { id, deleted: true });
  return { ok: true, files_removed: removed };
});

r('POST', '/api/projects/:id/brief/draft', 'edit', async ({ params, need }) => {
  need('edit', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  if (AI.aiKey()) return { brief: await AI.draftBrief(p), by: 'ai' }; // read from the docs and the work; the rules' version is a template
  const recent = all("SELECT title, summary, tags FROM moment WHERE project_id=? AND status='accepted' ORDER BY end_ts DESC LIMIT 25", p.id);
  return { brief: W.draftBrief(p, recent) };
});
r('GET', '/api/projects/:id/summary', 'read', async ({ params, need }) => { need('read', params.id); return R.summaries(get('SELECT * FROM project WHERE id=?', params.id)); }, { guest: true });

r('GET', '/api/projects/:id/timeline', 'read', ({ params, query, need }) => {
  need('read', params.id);
  const where = ["m.project_id=?", "m.status='accepted'"], args = [params.id];
  if (query.exploration) { where.push('m.exploration_id=?'); args.push(query.exploration); } else where.push('m.exploration_id IS NULL');
  if (query.tool) { where.push('m.tool=?'); args.push(query.tool); }
  if (query.person) { where.push('(m.actor_name=? OR m.agent=?)'); args.push(query.person, query.person); }
  if (query.type) { where.push("json_extract(m.basis,'$.type')=?"); args.push(query.type); }
  if (query.from) { where.push('m.end_ts>=?'); args.push(+query.from); }
  if (query.to) { where.push('m.end_ts<=?'); args.push(+query.to); }
  if (query.before) { where.push('m.end_ts<?'); args.push(+query.before); }
  const limit = Math.min(100, +query.limit || 30);
  const moments = all(`SELECT m.* FROM moment m WHERE ${where.join(' AND ')} ORDER BY m.end_ts DESC LIMIT ?`, ...args, limit).map((m) => ({ kind: 'moment', ts: m.end_ts, ...momentCard(m) }));
  const lo = moments.at(-1)?.ts ?? 0, hi = query.before ? +query.before : Infinity;
  const artifacts = query.exploration || query.tool || query.person || query.type ? [] : all("SELECT * FROM artifact WHERE project_id=? AND status != 'discarded' AND created_at < ? AND created_at >= ?", params.id, hi === Infinity ? now() + 1 : hi, moments.length === limit ? lo : 0).map((a) => ({ kind: 'artifact', ts: a.created_at, ...a, context_pack: undefined }));
  return { items: [...moments, ...artifacts].sort((a, b) => b.ts - a.ts), more: moments.length === limit, filters: { tools: all("SELECT DISTINCT tool FROM moment WHERE project_id=? AND status='accepted'", params.id).map((x) => x.tool), people: all("SELECT DISTINCT actor_name FROM moment WHERE project_id=? AND status='accepted'", params.id).map((x) => x.actor_name), types: all("SELECT DISTINCT json_extract(basis,'$.type') t FROM moment WHERE project_id=? AND status='accepted'", params.id).map((x) => x.t).filter(Boolean) } };
}, { guest: true });

r('GET', '/api/projects/:id/files', 'read', ({ params, need }) => {
  need('read', params.id);
  return sortFiles(all('SELECT a.*, s.thumb_key, s.image_key, s.mime, s.file_key, s.width, s.height, s.properties, (SELECT COUNT(*) FROM snapshot WHERE asset_id=a.id) versions FROM asset a LEFT JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? ORDER BY a.updated_at DESC', params.id)
    .map((a) => ({ ...a, properties: { file: a.properties?.file, page: a.properties?.page, lottie: a.properties?.lottie, video: a.properties?.video, pdf: a.properties?.pdf } }))); // each with its role: design, UI code, the app's pictures, or hidden and why
}, { guest: true });

r('PUT', '/api/projects/:id/members', 'admin', ({ params, body }) => {
  run('DELETE FROM project_member WHERE project_id=?', params.id);
  for (const m of body.members || []) insert('project_member', { project_id: params.id, user_id: m.user_id, role: m.role });
});

r('GET', '/api/projects/:id/file', 'read', ({ params, query, need }) => { need('read', params.id); return F.readFile(projectOr404(params.id), String(query.path || '')); });

// ---- the tree: every version as a node, joined to the one it came from, with when and who ----
// Project: accepted changes (explorations branch off the main line; "evolved into" links drawn dashed).
// One component: each version of that file, drawn. Code saved while an AI was working counts as the AI's.
r('GET', '/api/projects/:id/tree', 'read', ({ params, query, need }) => {
  need('read', params.id);
  const ex = MEM.exchangesFor(params.id).reverse(); // oldest first
  const aiAt = (ts) => { let hit = null; for (const e of ex) { if (e.ts > ts) break; if (ts - e.ts < 30 * 60000) hit = e; } return hit && { tool: hit.tool, asked: hit.asked.slice(0, 160) }; };
  const components = all("SELECT a.id, a.name, a.path, (SELECT COUNT(*) FROM snapshot WHERE asset_id=a.id) versions FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND json_extract(s.properties,'$.component.mode') IS NOT NULL ORDER BY a.updated_at DESC", params.id);
  if (query.asset) {
    const a = get('SELECT * FROM asset WHERE id=? AND project_id=?', query.asset, params.id);
    if (!a) throw err(404, 'No such file in this project');
    const snaps = all('SELECT s.id, s.prev_id, s.image_key, s.thumb_key, s.width, s.height, s.created_at, s.properties, e.actor, e.ts FROM snapshot s LEFT JOIN event e ON e.id=s.event_id WHERE s.asset_id=? ORDER BY s.created_at', a.id);
    return {
      mode: 'asset', asset: { id: a.id, name: a.name, path: a.path }, components, lanes: [{ id: 'main', name: a.name }], links: [],
      nodes: snaps.map((s, i) => {
        const ai = aiAt(s.ts || s.created_at);
        const m = get("SELECT m.id, m.title, m.agent, m.actor_name FROM moment_asset ma JOIN moment m ON m.id=ma.moment_id WHERE ma.last_snapshot_id=? AND m.status != 'discarded' LIMIT 1", s.id);
        return { id: s.id, parent: s.prev_id, lane: 'main', title: `Version ${i + 1}`, when: s.ts || s.created_at, who: m?.agent || (ai ? ai.tool : s.actor || m?.actor_name || 'Someone'), agent: !!(m?.agent || ai), asked: ai?.asked, image: s.image_key ? { image_key: s.image_key, thumb_key: s.thumb_key, width: s.width, height: s.height } : null, drawn: !!s.properties?.component?.mode, error: s.properties?.component?.error, moment: m?.id, moment_title: m?.title };
      }),
    };
  }
  const ms = all("SELECT * FROM moment WHERE project_id=? AND status='accepted' ORDER BY end_ts", params.id);
  const lanes = [{ id: 'main', name: 'Main line' }, ...all('SELECT id, name FROM exploration WHERE project_id=? ORDER BY created_at', params.id)];
  const last = {};
  const nodes = ms.map((m) => {
    const lane = m.exploration_id || 'main';
    const parent = last[lane] || (lane !== 'main' ? [...ms].reverse().find((x) => !x.exploration_id && x.end_ts <= m.end_ts)?.id : null) || null;
    last[lane] = m.id;
    const ai = !m.agent && aiAt(m.start_ts);
    return { id: m.id, parent, lane, title: m.title, when: m.end_ts, who: m.agent || (ai ? ai.tool : m.actor_name), agent: !!(m.agent || ai), asked: ai?.asked, tool: m.tool, sentence: m.sentence || [{ t: m.summary || '' }], image: visualSnap(m.id), files: get('SELECT COUNT(*) n FROM moment_asset WHERE moment_id=?', m.id).n };
  });
  const ids = new Set(nodes.map((n) => n.id));
  return { mode: 'project', components, lanes, nodes, links: all("SELECT from_id, to_id FROM edge WHERE rel='evolved-into' AND from_type='moment'").filter((l) => ids.has(l.from_id) && ids.has(l.to_id)) };
}, { guest: true });

r('GET', '/api/projects/:id/journey', 'read', ({ params, query, need }) => { need('read', params.id); return journey(params.id, { before: query.before, limit: Math.min(30, +query.limit || 10) }); }, { guest: true });

// ---- the script agents get before they work, and adding it to the project's own instruction files ----
const SCRIPT_FILES = { claude: 'CLAUDE.md', agents: 'AGENTS.md', gemini: 'GEMINI.md', cursor: path.join('.cursor', 'rules', 'trace.mdc') };
r('GET', '/api/projects/:id/agent-script', 'read', ({ params, need }) => {
  need('read', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  const dirs = projectDirs(p);
  return { text: AGENT_SCRIPT, dirs, files: Object.entries(SCRIPT_FILES).map(([k, f]) => ({ id: k, file: f, added: dirs.filter((d) => { try { return readFileSync(path.join(d, f), 'utf8').includes('<!-- trace:start'); } catch { return false; } }) })) };
});
// Write the script into a project's instruction files (CLAUDE.md, AGENTS.md…), replacing Trace's own block only.
function writeScript(p, file) {
  const rel_ = SCRIPT_FILES[file];
  if (!rel_) throw err(400, 'Pick CLAUDE.md, AGENTS.md, GEMINI.md or Cursor rules.');
  const dirs = projectDirs(p);
  if (!dirs.length) throw err(400, `Tell Trace which folder ${p.name} lives in first (project settings → Folders).`);
  const block = `<!-- trace:start · added by Trace; Trace replaces this block when you add it again -->\n${AGENT_SCRIPT}\n<!-- trace:end -->`;
  const written = [];
  for (const d of dirs) {
    const f = path.join(d, rel_);
    let text = existsSync(f) ? readFileSync(f, 'utf8') : '';
    if (file === 'cursor' && !text) text = '---\ndescription: Explain each set of changes in Trace\nalwaysApply: true\n---\n';
    text = /<!-- trace:start[\s\S]*?<!-- trace:end -->/.test(text) ? text.replace(/<!-- trace:start[\s\S]*?<!-- trace:end -->/, () => block) : `${text}${text && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : ''}${block}\n`;
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    written.push(f);
  }
  return written;
}
r('POST', '/api/projects/:id/agent-script', 'edit', ({ params, body, need, user }) => {
  need('edit', params.id);
  const p = get('SELECT * FROM project WHERE id=?', params.id);
  const written = writeScript(p, body.file);
  audit(user.name, 'user', 'agent-script.add', p.id, { files: written });
  return { written };
});

// ---- assemble: point Trace at a folder (what the coding-agent skill runs) ----
// The project for the folder (found or made), the folder watched, the AI memory read, the script in CLAUDE.md,
// and the case study assembled, with what's still open.
r('POST', '/api/assemble', 'edit', async ({ body, user, origin }) => {
  const dir = path.resolve(String(body.dir || '').trim().replace(/^"|"$/g, ''));
  if (!body.dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw err(400, `“${body.dir}” isn’t a folder on this computer.`);
  const key = (x) => path.resolve(x).toLowerCase();
  const within = (d) => key(dir) === key(d) || key(dir).startsWith(key(d) + path.sep);
  const steps = [];
  let p = all("SELECT * FROM project WHERE status='active'").find((x) => projectDirs(x).some(within));
  if (!p) {
    p = { id: uid('p'), workspace_id: WS, name: String(body.name || path.basename(dir)).slice(0, 80), brief: '', status: 'active', pinned: [], do_not_capture: [], folders: [dir], created_at: now(), updated_at: now() };
    insert('project', p); E.updateCentroid(p.id); E.ftsPut('project', p.id, p.id, p.name, '');
    p = get('SELECT * FROM project WHERE id=?', p.id);
    if (!body.quiet) steps.push(`Made the project “${p.name}”`);
  } else if (!body.quiet) steps.push(`Found the project “${p.name}”`);
  if (!(p.folders || []).some((f) => key(f) === key(dir)) && !projectDirs(p).some((d) => key(d) === key(dir))) update('project', p.id, { folders: [...(p.folders || []), dir] });
  if (!body.quiet) {
    const src = all("SELECT * FROM source WHERE tool='folder'").find((s) => s.scope?.path && within(s.scope.path));
    if (!src) { await connect('folder', { path: dir, project_id: p.id }, user); steps.push('Watching the folder: its screens, docs and component code are being captured and drawn'); }
    else { if (!src.project_id) update('source', src.id, { project_id: p.id }); steps.push('Already watching the folder'); }
    for (const d of MEM.detected().filter((x) => ['claude-code', 'codex'].includes(x.id) && x.found && !x.source)) { MEM.connect(d.id, user); steps.push(`Reading ${d.label}’s memory of this folder`); }
    MEM.remap(); MEM.ensureFresh(0);
    if (body.script !== false) try { const w = writeScript(get('SELECT * FROM project WHERE id=?', p.id), 'claude'); steps.push(`Added the Trace script to ${w.map((f) => path.basename(f)).join(', ')}`); } catch (e) { steps.push(`Couldn’t add the script: ${e.message}`); }
    broadcast('project', { id: p.id, project_id: p.id });
    audit(user.name, 'user', 'assemble', p.id, { dir });
  }
  p = get('SELECT * FROM project WHERE id=?', p.id);
  const cs = CS.assemble(p);
  const count = (sql) => get(sql, p.id).n;
  return {
    project: { id: p.id, name: p.name }, link: `${origin}/#/p/${p.id}`, steps,
    counts: { iterations: count("SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted'"), files: count('SELECT COUNT(*) n FROM asset WHERE project_id=?'), docs: cs.docs.length, prompts: MEM.exchangesFor(p.id).length, references: count('SELECT COUNT(*) n FROM reference WHERE project_id=?'), decisions: count('SELECT COUNT(*) n FROM decision WHERE project_id=?'), constraints: cs.constraints },
    case_study: { readiness: cs.readiness, open: cs.sections.filter((s) => s.status !== 'filled').map((s) => ({ id: s.id, q: s.q, status: s.status })) },
  };
});

// ---- a code folder dropped or picked in the browser: its real place on this computer, else a copy Trace keeps ----
r('POST', '/api/folders/find', 'edit', ({ body }) => {
  const name = String(body.name || '').trim();
  if (!name || /[\\/]/.test(name)) throw err(400, 'That isn’t a folder name.');
  const sample = (body.files || []).slice(0, 40).map((f) => ({ path: String(f.path || ''), size: Number(f.size) })).filter((f) => f.path && !f.path.split(/[\\/]/).includes('..'));
  const dir = F.findOnDisk(name, sample, all("SELECT * FROM project WHERE status='active'").flatMap(projectDirs));
  return dir ? { dir } : { copy: F.newCopy(name) };
});
r('POST', '/api/folders/copy', 'edit', ({ raw, query }) => { F.copyInto(String(query.dir || ''), String(query.path || ''), raw || Buffer.alloc(0)); return { ok: true }; }, { raw: true });

// ---- the coding-agent skills: install them for Claude Code (trace: assemble and the case study; trace-design: the canvas) ----
const SKILLS = ['trace', 'trace-design'];
const skillSrc = (n) => path.join(ROOT, 'skills', n, 'SKILL.md');
const skillDst = (n) => path.join(process.env.USERPROFILE || process.env.HOME || '.', '.claude', 'skills', n, 'SKILL.md');
const SKILL_DST = skillDst('trace');
const skillText = (origin, n = 'trace') => readFileSync(skillSrc(n), 'utf8').replaceAll('{{TRACE_DIR}}', ROOT.replace(/\\/g, '/')).replaceAll('{{TRACE_URL}}', origin);
const skillIn = (origin, n) => existsSync(skillDst(n)) && readFileSync(skillDst(n), 'utf8') === skillText(origin, n);
r('GET', '/api/skill', 'read', ({ origin }) => ({ text: skillText(origin), path: SKILL_DST, installed: SKILLS.every((n) => skillIn(origin, n)), skills: SKILLS.map((n) => ({ name: n, path: skillDst(n), installed: skillIn(origin, n) })), cli: `node "${ROOT.replace(/\\/g, '/')}/bin/trace.js" assemble` }));
r('POST', '/api/skill/install', 'admin', ({ origin, user }) => { for (const n of SKILLS) { mkdirSync(path.dirname(skillDst(n)), { recursive: true }); writeFileSync(skillDst(n), skillText(origin, n)); audit(user.name, 'user', 'skill.install', skillDst(n)); } return { path: SKILL_DST, paths: SKILLS.map(skillDst) }; });
