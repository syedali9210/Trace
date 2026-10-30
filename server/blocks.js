// The project canvas: blocks that hold everything about a project, and what is inside each one. A block opens as
// a stream of frames (pictures or text) with small context cards beside each frame, NCS-style; sticky notes can
// sit in any block or on any frame. Blocks you make yourself hold your own notes.
import { all, get, run, insert, update, now, uid } from './db.js';
import * as W from './words.js';
import { exchangesFor } from './memory.js';
import { projectRefs } from './refs.js';
import { constraintsOf, checkConstraint, projectDocs, assemble, tokensFor } from './casestudy.js';

export const BLOCKS = [
  { id: 'overview', title: 'Overview', icon: 'compass', hint: 'The most important things, at a glance', size: '2x2' },
  { id: 'work', title: 'Iterations', icon: 'stack', hint: 'Every change to the work, newest first', size: '2x1' },
  { id: 'reviews', title: 'Reviews', icon: 'chats-circle', hint: 'Feedback, and the AI reasoning you reviewed' },
  { id: 'brainstorm', title: 'Brainstorming', icon: 'lightbulb', hint: 'Ideas, your prompts to AI, directions explored' },
  { id: 'constraints', title: 'Constraints', icon: 'ruler', hint: 'What it must and mustn’t do, checked against the work' },
  { id: 'references', title: 'Design references', icon: 'images', hint: 'Pictures, videos and links that shaped it', size: '2x1' },
  { id: 'tasks', title: 'Tasks', icon: 'check-square', hint: 'Assigned to people and to AI agents' },
  { id: 'decisions', title: 'Decisions', icon: 'seal-check', hint: 'What was decided, and where' },
  { id: 'casestudy', title: 'Case study', icon: 'book-open-text', hint: 'Every case-study question, answered from the work', size: '1x2' },
  { id: 'artifacts', title: 'Artifacts', icon: 'sparkle', hint: 'What your AIs made, and what you added' },
];

// ---------- shapes shared with the API ----------
// A change's picture: its biggest real one (a screen or a hero, not an icon or a logo), a component drawn from code after that.
export const visualSnap = (mid) => mid && (get(`SELECT s.id, s.thumb_key, s.image_key, s.width, s.height FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id JOIN snapshot s ON s.id=ma.last_snapshot_id
  WHERE ma.moment_id=? AND a.tool != 'agent' AND json_extract(s.properties,'$.file.card') IS NULL ORDER BY a.type IN ('code','doc','font'), COALESCE(s.width, 0) * COALESCE(s.height, 0) DESC LIMIT 1`, mid) || get('SELECT s.id, s.thumb_key, s.image_key, s.width, s.height FROM moment_asset ma JOIN snapshot s ON s.id=ma.last_snapshot_id WHERE ma.moment_id=? LIMIT 1', mid));
export function changelog(m) {
  return m && {
    id: m.id, title: m.title, summary: m.summary, sentence: m.sentence || [{ t: m.summary || '' }], why: m.why, end_ts: m.end_ts, actor_name: m.actor_name, agent: m.agent, tool: m.tool, magnitude: m.magnitude, bucket: m.bucket, event_count: m.event_count,
    rows: all("SELECT kind, path, before, after FROM change WHERE moment_id=? AND kind NOT IN ('region','visual') ORDER BY weight DESC LIMIT 6", m.id).map((c) => ({ ...c, category: W.category(c), attr: W.attrName(c) })),
  };
}
const plain = (seg) => (Array.isArray(seg) ? seg.map((s) => s.t ?? s.k).join('') : '');
const clip = (t, n) => { const s = String(t || '').trim(); return s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s; };

export const canvasOf = (p) => ({ order: [], size: {}, custom: [], links: [], ...(p.canvas || {}) });
export function blockList(p) {
  const c = canvasOf(p);
  return [...BLOCKS, ...c.custom.map((b) => ({ ...b, icon: b.icon || 'note', hint: 'Your notes', custom: true }))];
}

// ---------- what is inside a block ----------
// An item: { id, kind, ts, title, text, image?, who, agent?, href?, status?, context: [{ title, rows?, text?, chips? }] }
const stickies = (p, block) => all('SELECT * FROM note WHERE project_id=? AND block=? AND kind=? ORDER BY created_at DESC', p.id, block, 'sticky')
  .map((n) => ({ id: n.id, kind: 'sticky', ts: n.created_at, title: n.author_name || 'Note', text: n.text, color: n.color || 'yellow', who: n.author_name, anchor: n.anchor, done: !!n.done }));

export function items(p, block) {
  const own = stickies(p, block);
  switch (block) {
    case 'work': return [...all("SELECT * FROM moment WHERE project_id=? AND status='accepted' ORDER BY end_ts DESC LIMIT 200", p.id).map((m) => {
      const cl = changelog(m);
      return { id: m.id, kind: 'iteration', ts: m.end_ts, title: m.title, text: plain(cl.sentence), image: visualSnap(m.id), who: m.agent || m.actor_name, agent: !!m.agent, href: `#/m/${m.id}`, sentence: cl.sentence,
        pins: all("SELECT id, region, body, author_name FROM comment WHERE target_type='moment' AND target_id=? AND parent_id IS NULL AND region IS NOT NULL AND COALESCE(kind,'') != 'reasoning' ORDER BY created_at", m.id),
        context: [{ title: 'Changes', sentence: cl.sentence }, ...groupRows(cl.rows)], exploration: m.exploration_id };
    }), ...own];
    case 'reviews': {
      const cs = all("SELECT * FROM comment WHERE project_id=? AND parent_id IS NULL ORDER BY created_at DESC LIMIT 200", p.id);
      return [...cs.map((c) => {
        const replies = all('SELECT author_name, body FROM comment WHERE parent_id=? ORDER BY created_at', c.id);
        const m = c.target_type === 'moment' ? get('SELECT id, title FROM moment WHERE id=?', c.target_id) : null;
        if (c.kind === 'reasoning') return { id: c.id, kind: 'reasoning', ts: c.created_at, title: c.author_name, text: c.meta?.understood || c.meta?.asked || c.body, who: c.author_name, agent: true, status: c.status, href: `#/c/${c.id}`, image: m && visualSnap(m.id),
          context: [{ title: 'You asked', text: c.meta?.asked }, { title: 'Why each change', rows: (c.meta?.changes || []).map((x) => ({ label: x.what, value: x.why })) }, { title: 'Its own review', text: c.meta?.review }] };
        return { id: c.id, kind: 'comment', ts: c.created_at, title: c.author_name, text: c.body, who: c.author_name, status: c.status, href: `#/c/${c.id}`, image: m && visualSnap(m.id), region: c.region,
          context: [m && { title: 'On', text: m.title, href: `#/m/${m.id}` }, replies.length && { title: `${replies.length} repl${replies.length > 1 ? 'ies' : 'y'}`, rows: replies.slice(-3).map((r) => ({ label: r.author_name, value: r.body })) }].filter(Boolean) };
      }), ...own];
    }
    case 'brainstorm': return [
      ...own,
      ...all("SELECT * FROM note WHERE project_id=? AND kind='idea' ORDER BY created_at DESC", p.id).map((n) => ({ id: n.id, kind: 'sticky', ts: n.created_at, title: n.author_name, text: n.text, color: 'blue', who: n.author_name })),
      ...all('SELECT * FROM exploration WHERE project_id=? ORDER BY created_at DESC', p.id).map((x) => ({ id: x.id, kind: 'exploration', ts: x.created_at, title: x.name, text: x.description || 'A direction tried beside the main line', status: x.status, href: `#/p/${p.id}/timeline/${x.id}`, image: visualSnap(get("SELECT id FROM moment WHERE exploration_id=? AND status='accepted' ORDER BY end_ts DESC LIMIT 1", x.id)?.id), context: [{ title: 'Status', text: x.status }] })),
      ...exchangesFor(p.id).slice(0, 40).map((e) => ({ id: `ex_${e.id}`, kind: 'prompt', ts: e.ts, title: `You asked ${e.tool}`, text: e.asked, who: 'You', images: e.images, image: e.images[0] || e.shot || null,
        context: [e.first && { title: `${e.tool} replied`, text: clip(e.first, 400) }, e.last && { title: 'It wrapped up', text: clip(e.last, 400) }].filter(Boolean) })),
    ].sort((a, b) => b.ts - a.ts);
    case 'constraints': {
      const tokens = tokensFor(p.id);
      return [...constraintsOf(p).map((c, i) => { const ck = checkConstraint(c, tokens); return { id: c.id || `cons_${i}`, kind: 'constraint', ts: 0, title: c.source, text: c.text, status: ck.status, editable: !!c.id, context: [{ title: 'Checked against the latest design', text: ck.note || 'Nothing measurable to check; review it by eye.', status: ck.status }, { title: 'Source', text: c.source }] }; }), ...own];
    }
    case 'references': return [...projectRefs(p.id).map((r) => ({ id: r.id, kind: 'reference', ts: r.created_at, title: r.title || r.kind, text: r.note || r.url || '', image: r.thumb_key ? { thumb_key: r.thumb_key, image_key: r.file_key || r.thumb_key, file_key: r.file_key, kind: r.kind } : null, url: r.url, refKind: r.kind, palette: r.palette,
      context: [r.palette?.length && { title: 'Colours', chips: r.palette.slice(0, 6) }, r.links.length && { title: 'Pinned to', rows: r.links.map((l) => ({ label: l.title, href: `#/m/${l.moment_id}` })) }, r.note && { title: 'Note', text: clip(r.note, 300) }].filter(Boolean) })), ...own];
    case 'tasks': return [...all('SELECT * FROM issue WHERE project_id=? ORDER BY CASE status WHEN \'in_progress\' THEN 0 WHEN \'open\' THEN 1 ELSE 2 END, updated_at DESC', p.id).map((t) => ({ id: t.id, kind: 'task', ts: t.created_at, title: t.title, text: t.body || '', status: t.status, who: t.assignee_type === 'agent' ? t.assignee : (t.assignee && get('SELECT name FROM user WHERE id=?', t.assignee)?.name) || null, agent: t.assignee_type === 'agent', href: `#/p/${p.id}/issues`,
      context: [{ title: 'Status', text: t.status.replace('_', ' '), status: t.status }, t.labels?.length && { title: 'Labels', chips: t.labels }].filter(Boolean) })), ...own];
    case 'decisions': return [...all('SELECT * FROM decision WHERE project_id=? ORDER BY status=\'confirmed\' DESC, created_at DESC', p.id).map((d) => ({ id: d.id, kind: 'decision', ts: d.created_at, title: d.status === 'confirmed' ? 'Decided' : 'Suggested', text: d.text, status: d.status, who: d.confirmed_by,
      href: d.source_type === 'moment' ? `#/m/${d.source_id}` : d.source_type === 'comment' ? `#/c/${d.source_id}` : null, context: [{ title: 'From', text: d.source_type || 'Added by hand' }] })), ...own];
    case 'casestudy': return [...assemble(p).sections.map((s) => ({ id: `cs_${s.id}`, kind: 'answer', ts: s.updated_at || 0, title: s.q, text: s.answer || 'Not answered yet.', status: s.status, section: s.id, image: s.evidence.flatMap((e) => e.images || [])[0] || null,
      context: s.evidence.slice(0, 4).map((e) => ({ title: e.source, text: clip(e.text, 220), sub: e.label })) })), ...own];
    case 'artifacts': return [...all("SELECT * FROM artifact WHERE project_id=? AND status != 'discarded' ORDER BY created_at DESC", p.id).map((a) => ({ id: a.id, kind: 'artifact', ts: a.created_at, title: a.title, text: a.prompt || clip(a.content, 300) || a.url || '', who: a.agent, agent: a.agent !== 'you', status: a.status, href: `#/p/${p.id}/artifacts/${a.id}`,
      context: [{ title: 'Made by', text: `${a.agent || 'you'}${a.model ? ` · ${a.model}` : ''}` }, { title: 'Type', text: a.type }] })), ...own];
    case 'overview': return overview(p);
    default: return own; // a block you made
  }
}
function groupRows(rows) { // the NCS sidebar: one card per kind of change, before → after
  const g = {};
  for (const r of rows) (g[r.category] ||= []).push({ label: r.attr, before: r.before, after: r.after });
  return Object.entries(g).map(([title, list]) => ({ title, changes: list }));
}

// The overview: the few things that matter most right now.
function overview(p) {
  const latest = get("SELECT * FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC LIMIT 1", p.id);
  const cs = assemble(p);
  const open = all("SELECT title, assignee_type, assignee FROM issue WHERE project_id=? AND status IN ('open','in_progress') ORDER BY updated_at DESC LIMIT 4", p.id);
  const review = get("SELECT author_name, body, created_at FROM comment WHERE project_id=? AND parent_id IS NULL AND COALESCE(kind,'') != 'reasoning' AND status='open' ORDER BY created_at DESC LIMIT 1", p.id);
  const decision = get("SELECT text FROM decision WHERE project_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1", p.id);
  const tokens = tokensFor(p.id);
  const broken = constraintsOf(p).map((c) => ({ c, k: checkConstraint(c, tokens) })).filter((x) => x.k.status === 'conflict');
  const problem = cs.sections.find((s) => s.id === 'problem');
  return [
    latest && { id: `ov_latest`, kind: 'iteration', ts: latest.end_ts, title: 'Where it stands', text: latest.title, image: visualSnap(latest.id), href: `#/m/${latest.id}`, context: [{ title: 'Changes', sentence: changelog(latest).sentence }] },
    { id: 'ov_problem', kind: 'answer', ts: 0, title: 'The problem', text: problem?.answer || 'Not written yet: add a brief, or ask your agent to answer the case study.', status: problem?.status, href: `#/p/${p.id}/casestudy` },
    { id: 'ov_ready', kind: 'stat', ts: 0, title: 'Case study', text: `${cs.readiness}% answered`, value: cs.readiness, href: `#/p/${p.id}/casestudy`, context: [{ title: 'Still open', chips: cs.sections.filter((s) => s.status !== 'filled').map((s) => s.q) }] },
    open.length && { id: 'ov_tasks', kind: 'stat', ts: 0, title: 'Open tasks', text: open.map((t) => t.title).join(' · '), value: open.length, href: `#/p/${p.id}/b/tasks` },
    review && { id: 'ov_review', kind: 'comment', ts: review.created_at, title: `${review.author_name} said`, text: review.body, href: `#/p/${p.id}/b/reviews` },
    decision && { id: 'ov_decision', kind: 'decision', ts: 0, title: 'Latest decision', text: decision.text, href: `#/p/${p.id}/b/decisions` },
    broken.length && { id: 'ov_conflicts', kind: 'constraint', ts: 0, title: `${broken.length} constraint${broken.length > 1 ? 's' : ''} broken`, text: broken.map((x) => `${x.c.text} (${x.k.note})`).join(' · '), status: 'conflict', href: `#/p/${p.id}/b/constraints` },
  ].filter(Boolean);
}

// ---------- the canvas: every block with a preview, its size and order, the links and their insights ----------
export function summary(p, b, list) {
  const real = list.filter((x) => x.kind !== 'sticky');
  const images = list.map((x) => x.image).filter((x) => x && (x.thumb_key || x.image_key)).slice(0, 4);
  const count = b.id === 'overview' ? null : real.length;
  const lines = b.id === 'overview' ? list.filter((x) => x.kind !== 'iteration').slice(0, 4).map((x) => clip(`${x.title}: ${x.text}`, 110)) : list.slice(0, 3).map((x) => clip(['task', 'artifact', 'reference', 'iteration', 'answer', 'exploration'].includes(x.kind) ? x.title : x.text || x.title, 90)); // a title where the text is code or long
  const stat = { tasks: () => `${real.filter((x) => ['open', 'in_progress'].includes(x.status)).length} open`, reviews: () => `${real.filter((x) => x.status === 'open').length} open`, constraints: () => { const c = real.filter((x) => x.status === 'conflict').length; return c ? `${c} broken` : `${real.filter((x) => x.status === 'met').length} kept`; }, casestudy: () => `${list.filter((x) => x.status === 'filled').length}/${list.filter((x) => x.kind === 'answer').length} answered` }[b.id]?.() || null;
  const readiness = b.id === 'casestudy' ? Math.round((list.filter((x) => x.status === 'filled').length / Math.max(1, list.filter((x) => x.kind === 'answer').length)) * 100) : null;
  return { count, images, lines, stat, readiness, stickies: list.filter((x) => x.kind === 'sticky').length, ts: real.map((x) => x.ts).filter(Boolean) };
}

export function saveCanvas(p, patch) {
  const c = canvasOf(p);
  const ok = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string');
  if (ok(patch.order)) c.order = patch.order.slice(0, 100);
  if (patch.size) c.size = Object.fromEntries(Object.entries({ ...c.size, ...patch.size }).filter(([, v]) => ['1x1', '2x1', '1x2', '2x2'].includes(v)));
  if (patch.add_block) c.custom = [...c.custom, { id: `c_${uid('b').slice(2)}`, title: String(patch.add_block).slice(0, 60) }];
  if (patch.rename) c.custom = c.custom.map((b) => (b.id === patch.rename.id ? { ...b, title: String(patch.rename.title).slice(0, 60) } : b));
  if (patch.remove_block) { c.custom = c.custom.filter((b) => b.id !== patch.remove_block); c.links = c.links.filter((l) => l.from !== patch.remove_block && l.to !== patch.remove_block); }
  if (patch.link) { const { from, to } = patch.link; if (from && to && from !== to && !c.links.some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from))) c.links.push({ from, to, at: now() }); }
  if (patch.unlink) c.links = c.links.filter((l) => !((l.from === patch.unlink.from && l.to === patch.unlink.to) || (l.from === patch.unlink.to && l.to === patch.unlink.from)));
  update('project', p.id, { canvas: c, updated_at: now() });
  return c;
}
