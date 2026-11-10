// The shapes the UI reads, shared by more than one area of routes: a change and a project as cards, a comment with
// its replies, which project a thing belongs to, and the journey (asked → made → why → review).
import { all, get, now } from './db.js';
import * as MEM from './memory.js';
import * as REF from './refs.js';
import { visualSnap, changelog } from './blocks.js';
import * as CS from './casestudy.js';
import { err } from './router.js';

export const strip = (o) => { if (o) { delete o.embedding; delete o.centroid; delete o.img_vec; } return o; };
export const snapThumb = (id) => id && get('SELECT id, thumb_key, image_key, width, height, mime, file_key FROM snapshot WHERE id=?', id);
export const projectName = (id) => id && get('SELECT name FROM project WHERE id=?', id)?.name;
export const momentProject = (id) => { const m = get('SELECT project_id, route_guess FROM moment WHERE id=?', id); return m?.project_id || m?.route_guess; };

export function momentCard(m) { // its pictures first, biggest first (a screen or a hero, not an icon), cards for code and docs after
  const assets = all(`SELECT a.id, a.name, a.type, a.tool, a.url, ma.first_snapshot_id, ma.last_snapshot_id FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id LEFT JOIN snapshot s ON s.id=ma.last_snapshot_id WHERE ma.moment_id=?
    ORDER BY (a.type IN ('code','doc','font','repo','pull request') OR json_extract(s.properties,'$.file.card') IS NOT NULL), COALESCE(s.width, 0) * COALESCE(s.height, 0) DESC`, m.id);
  return {
    ...strip({ ...m }),
    project_name: projectName(m.project_id), guess_name: projectName(m.route_guess),
    exploration_name: m.exploration_id && get('SELECT name FROM exploration WHERE id=?', m.exploration_id)?.name,
    asset_count: assets.length,
    assets: assets.slice(0, 8).map((a) => ({ id: a.id, name: a.name, type: a.type, tool: a.tool, url: a.url, after: snapThumb(a.last_snapshot_id), before: snapThumb(a.first_snapshot_id) })),
    top: all("SELECT kind, path, before, after FROM change WHERE moment_id=? AND kind NOT IN ('region','visual') ORDER BY weight DESC LIMIT 3", m.id),
    comments: get("SELECT COUNT(*) n FROM comment WHERE status='open' AND ((target_type='moment' AND target_id=?) OR (target_type='change' AND target_id IN (SELECT id FROM change WHERE moment_id=?)))", m.id, m.id).n,
  };
}

export function projectCard(p) {
  const latest = get("SELECT * FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC LIMIT 1", p.id);
  // The cover is the app's first screen when Frames has walked it, else the newest work's biggest real picture (a
  // screen or a hero, not an icon), never a generated card for code, notes or agent logs.
  const visual = "a.tool != 'agent' AND a.type NOT IN ('repo','pull request','code','doc','font') AND json_extract(s.properties,'$.file.card') IS NULL";
  const screen = CS.walkedScreens(p.id)[0];
  const cover = !screen && latest && get(`SELECT ma.last_snapshot_id FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id JOIN snapshot s ON s.id=ma.last_snapshot_id WHERE ma.moment_id=? AND ${visual} ORDER BY COALESCE(s.width, 0) * COALESCE(s.height, 0) DESC LIMIT 1`, latest.id);
  const fallback = !screen && !cover && (get(`SELECT s.id FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND ${visual} ORDER BY a.updated_at DESC LIMIT 1`, p.id) || get('SELECT latest_snapshot_id id FROM asset WHERE project_id=? AND latest_snapshot_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1', p.id));
  return {
    ...strip({ ...p }),
    cover: screen ? { thumb_key: screen.thumb_key, image_key: screen.image_key, width: screen.width, height: screen.height } : snapThumb(cover?.last_snapshot_id || fallback?.id),
    tools: all('SELECT DISTINCT tool FROM asset WHERE project_id=?', p.id).map((x) => x.tool),
    moments: get("SELECT COUNT(*) n FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL", p.id).n,
    open_comments: get("SELECT COUNT(*) n FROM comment WHERE project_id=? AND status='open' AND parent_id IS NULL", p.id).n,
    last_activity: latest?.end_ts || p.updated_at,
    latest: latest && { id: latest.id, title: latest.title, actor_name: latest.actor_name, agent: latest.agent, end_ts: latest.end_ts, tool: latest.tool, magnitude: latest.magnitude, bucket: latest.bucket, basis: { type: latest.basis?.type, pixels: latest.basis?.pixels, properties: latest.basis?.properties }, event_count: latest.event_count, top: all("SELECT kind, path, before, after FROM change WHERE moment_id=? AND kind NOT IN ('region','visual') ORDER BY weight DESC LIMIT 3", latest.id) },
  };
}

export const commentRow = (c) => ({ ...c, replies: all('SELECT * FROM comment WHERE parent_id=? ORDER BY created_at', c.id) });
export function resolveTarget(type, id) {
  switch (type) {
    case 'moment': return momentProject(id);
    case 'change': { const c = get('SELECT moment_id FROM change WHERE id=?', id); return c && momentProject(c.moment_id); }
    case 'asset': return get('SELECT project_id FROM asset WHERE id=?', id)?.project_id;
    case 'reference': return get('SELECT project_id FROM reference WHERE id=?', id)?.project_id;
    case 'proposal': return get('SELECT project_id FROM proposal WHERE id=?', id)?.project_id;
    case 'issue': return get('SELECT project_id FROM issue WHERE id=?', id)?.project_id;
    case 'artifact': return get('SELECT project_id FROM artifact WHERE id=?', id)?.project_id;
    case 'project': return get('SELECT id FROM project WHERE id=?', id)?.id;
    case 'version': return get('SELECT id FROM project WHERE id=?', String(id).split(':')[0])?.id; // `${project}:${sha}`
  }
}
export const projectOr404 = (id) => { const p = get('SELECT * FROM project WHERE id=?', id); if (!p) throw err(404, 'No such project'); return p; };

// ---- the journey: what the person gave and asked, what the AI understood and made, why, and the review ----
// Each iteration (an accepted change) gathers the prompts given since the one before it (from the AIs' own
// memory), the reasoning agents logged with explain_changes, and the references pinned to it.
const reasoningRow = (c) => ({ id: c.id, ts: c.created_at, agent: c.author_name, status: c.status, reactions: c.reactions || {}, ...(c.meta || {}), refs: (c.meta?.refs || []).map((id) => get('SELECT id, title, thumb_key, file_key, kind, url FROM reference WHERE id=?', id)).filter(Boolean), replies: all('SELECT id, author_name, body, created_at FROM comment WHERE parent_id=? ORDER BY created_at', c.id) });
const iterCard = (m) => { const c = changelog(m); return { ...c, start_ts: m.start_ts, status: m.status, project_id: m.project_id, image: visualSnap(m.id), files: get('SELECT COUNT(*) n FROM moment_asset WHERE moment_id=?', m.id).n, comments: get("SELECT COUNT(*) n FROM comment WHERE target_type='moment' AND target_id=? AND parent_id IS NULL AND COALESCE(kind,'') != 'reasoning'", m.id).n }; };
let remapped = 0;
export function journey(project_id, { before, limit = 10, moment } = {}) {
  if (now() - remapped > 30000) { MEM.remap(); remapped = now(); } // folders learned from where you filed work
  MEM.ensureFresh(0); // reads what changed in the background; the page updates when it lands
  REF.syncPromptRefs(project_id);
  const accepted = all("SELECT id, end_ts FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC", project_id);
  const ex = MEM.exchangesFor(project_id);
  const reasons = all("SELECT * FROM comment WHERE project_id=? AND kind='reasoning' AND parent_id IS NULL ORDER BY created_at", project_id);
  const ids = new Set(accepted.map((x) => x.id)), led = (e) => e.moment && ids.has(e.moment);
  const iteration = (m) => {
    const prev = accepted.find((x) => x.end_ts < m.end_ts && x.id !== m.id)?.end_ts ?? 0;
    const inside = (ts) => ts > prev && ts <= m.end_ts;
    return {
      moment: iterCard(m),
      asked: ex.filter((e) => (led(e) ? e.moment === m.id : inside(e.ts))).reverse(),
      reasoning: reasons.filter((c) => (c.target_type === 'moment' && c.target_id === m.id) || (c.target_type === 'project' && inside(c.created_at))).map(reasoningRow),
      refs: REF.refsFor(m.id),
      pins: all("SELECT id, region, body, author_name, created_at FROM comment WHERE target_type='moment' AND target_id=? AND parent_id IS NULL AND region IS NOT NULL AND COALESCE(kind,'') != 'reasoning' ORDER BY created_at", m.id),
      marks: all("SELECT id, kind, text, color, anchor, meta, author_name, created_at FROM note WHERE project_id=? AND kind IN ('marker','stroke') AND json_extract(anchor,'$.moment')=? ORDER BY created_at", project_id, m.id), // drawn on the picture
    };
  };
  if (moment) return iteration(moment);
  const start = before ? accepted.findIndex((x) => x.end_ts < +before) : 0;
  const page = start < 0 ? [] : accepted.slice(start, start + limit);
  const newest = accepted[0]?.end_ts ?? 0;
  return {
    total: accepted.length, more: start >= 0 && start + limit < accepted.length,
    hidden: before ? undefined : MEM.exchangesFor(project_id, { hidden: true, limit: 100 }).length,
    now: before ? null : { asked: ex.filter((e) => !led(e) && e.ts > newest).reverse(), reasoning: reasons.filter((c) => c.target_type === 'project' && c.created_at > newest).map(reasoningRow) }, // asked, nothing captured yet
    iterations: page.map((x) => iteration(get('SELECT * FROM moment WHERE id=?', x.id))),
  };
}
