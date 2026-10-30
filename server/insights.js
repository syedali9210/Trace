// Linking two blocks on the canvas asks: what does one say about the other? Rules over what each block holds
// (no model inside Trace): reviews no task covers, ideas never acted on, constraints the latest design breaks,
// references the work echoes, decisions the design keeps or drops, the case study gaps a block can fill, and the
// subjects both keep coming back to. Agents add their own over MCP (add_insight); people can write one too.
import { all, get } from './db.js';
import { tokens, cosine } from './vec.js';
import { tokensFor } from './casestudy.js';

const STOP = new Set('you your it its we our this that there their they them have has had will would could should can make made also just like into about more some need needs want wants use used using new one two get got add added change changed changes design screen page app trace project work file files thing things'.split(' '));
const terms = (t) => new Set(tokens(t).filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)));
const short = (t, n = 90) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s; };
const ref = (block, x) => ({ block, id: x.id, title: short(['sticky', 'comment', 'prompt', 'reasoning'].includes(x.kind) ? x.text : x.title || x.text, 60), href: x.href || null }); // what was said, not who said it
const overlap = (a, b) => { let n = 0; const hit = []; for (const w of a) if (b.has(w)) { n++; hit.push(w); } return { n, hit }; };
const say = (x) => (['sticky', 'comment', 'prompt', 'reasoning'].includes(x.kind) ? x.text : `${x.title} ${x.text}`); // a note's title is its author, not its subject
const pair = (a, b, x, y) => (a === x && b === y) || (a === y && b === x);

export function insights(p, a, b, itemsOf) {
  const A = itemsOf(a), B = itemsOf(b);
  const by = (id) => (id === a ? A : B);
  const out = [];
  const real = (list) => list.filter((x) => x.kind !== 'sticky' || x.text);

  // Reviews, ideas and stickies against tasks: what has a task, and what doesn't yet.
  for (const [src, label] of [['reviews', 'review'], ['brainstorm', 'idea']]) {
    if (!pair(a, b, src, 'tasks')) continue;
    const tasks = by('tasks').filter((t) => t.kind === 'task').map((t) => ({ t, w: terms(`${t.title} ${t.text}`) }));
    for (const x of by(src).filter((x) => (x.kind === 'comment' && x.status === 'open') || x.kind === 'sticky').slice(0, 12)) {
      const w = terms(x.text);
      const best = tasks.map((t) => ({ ...t, o: overlap(w, t.w) })).sort((m, n) => n.o.n - m.o.n)[0];
      if (best && best.o.n >= 2) out.push({ kind: 'support', text: `The ${label} “${short(x.text, 70)}” is covered by the task “${short(best.t.title, 60)}” (both about ${best.o.hit.slice(0, 3).join(', ')}).`, evidence: [ref(src, x), ref('tasks', best.t)] });
      else out.push({ kind: 'gap', text: `No task covers the ${label} “${short(x.text, 80)}”. Make one?`, evidence: [ref(src, x)], action: { type: 'task', title: short(x.text, 80) } });
    }
  }
  // Constraints against the work: kept, broken, or never checked.
  if (pair(a, b, 'constraints', 'work') || pair(a, b, 'constraints', 'overview')) {
    for (const c of by('constraints').filter((c) => c.kind === 'constraint')) {
      if (c.status === 'conflict') out.push({ kind: 'conflict', text: `The latest design breaks “${short(c.text, 80)}”: ${c.context[0]?.text}.`, evidence: [ref('constraints', c)] });
      else if (c.status === 'met') out.push({ kind: 'support', text: `“${short(c.text, 80)}” holds: ${c.context[0]?.text}.`, evidence: [ref('constraints', c)] });
    }
    const work = (by('work').length ? by('work') : []).filter((x) => x.kind === 'iteration').slice(0, 30).map((m) => ({ m, w: terms(`${m.title} ${m.text}`) }));
    for (const c of by('constraints').filter((c) => c.kind === 'constraint' && c.status === 'unchecked').slice(0, 20)) {
      const w = terms(c.text);
      const hit = work.map((x) => ({ ...x, o: overlap(w, x.w) })).filter((x) => x.o.n >= 2)[0];
      if (hit) out.push({ kind: 'match', text: `“${short(c.text, 70)}” bears on “${short(hit.m.title, 60)}” (${hit.o.hit.slice(0, 3).join(', ')}); worth a look.`, evidence: [ref('constraints', c), ref('work', hit.m)] });
    }
  }
  // References against the work: which pictures the work looks like.
  if (pair(a, b, 'references', 'work')) {
    const recent = by('work').filter((x) => x.kind === 'iteration' && x.image?.id).slice(0, 12).map((m) => ({ m, v: get('SELECT img_vec FROM snapshot WHERE id=?', m.image.id)?.img_vec }));
    for (const r of by('references').filter((r) => r.kind === 'reference').slice(0, 30)) {
      const rv = get('SELECT img_vec FROM reference WHERE id=?', r.id)?.img_vec;
      const best = recent.map((x) => ({ ...x, s: cosine(rv, x.v) })).sort((m, n) => n.s - m.s)[0];
      if (best && best.s > 0.86) out.push({ kind: 'match', text: `“${short(best.m.title, 60)}” looks like the reference “${short(r.title, 50)}” (${Math.round(best.s * 100)}% alike in colour and layout).`, evidence: [ref('references', r), ref('work', best.m)] });
    }
    const pinned = by('references').filter((r) => r.kind === 'reference' && r.context.some((c) => c.title === 'Pinned to'));
    if (pinned.length) out.push({ kind: 'support', text: `${pinned.length} reference${pinned.length > 1 ? 's are' : ' is'} pinned to the changes they shaped.`, evidence: pinned.slice(0, 4).map((r) => ref('references', r)) });
  }
  // Decisions against the work and the constraints.
  if (pair(a, b, 'decisions', 'work') || pair(a, b, 'decisions', 'constraints')) {
    const tk = tokensFor(p.id);
    const used = new Set([...tk.colors.map((c) => String(c.value).toLowerCase()), ...Object.values(tk.declared || {}).map((v) => String(v).toLowerCase())]);
    for (const d of by('decisions').filter((d) => d.kind === 'decision' && d.status === 'confirmed')) {
      for (const h of String(d.text).match(/#[0-9a-f]{6}\b/gi) || []) {
        const kept = [...used].some((u) => u.includes(h.toLowerCase())) || tk.codeHas(h);
        out.push({ kind: kept ? 'support' : 'conflict', text: kept ? `The decision “${short(d.text, 70)}” is kept: ${h} is in the latest design.` : `The latest design doesn’t use ${h} from the decision “${short(d.text, 70)}”.`, evidence: [ref('decisions', d)] });
      }
    }
  }
  // Reviews against the work: feedback that a later change probably answered.
  if (pair(a, b, 'reviews', 'work')) {
    for (const c of by('reviews').filter((c) => c.kind === 'comment').slice(0, 30)) {
      const on = c.context.find((x) => x.title === 'On');
      if (!on?.href) continue;
      const mid = on.href.split('/').pop();
      const later = get(`SELECT m2.id, m2.title FROM moment m2 JOIN moment_asset ma2 ON ma2.moment_id=m2.id WHERE m2.project_id=? AND m2.status='accepted' AND m2.end_ts > ? AND ma2.asset_id IN (SELECT asset_id FROM moment_asset WHERE moment_id=?) ORDER BY m2.end_ts LIMIT 1`, p.id, c.ts, mid);
      if (later) out.push({ kind: c.status === 'resolved' ? 'support' : 'match', text: `“${short(c.text, 70)}” was followed by “${short(later.title, 60)}”, which changed the same screen${c.status === 'open' ? '; the comment is still open' : ''}.`, evidence: [ref('reviews', c), { block: 'work', id: later.id, title: later.title, href: `#/m/${later.id}` }] });
    }
  }
  // The case study against any block: answers that block can fill.
  for (const [cs, other] of [[a, b], [b, a]]) {
    if (cs !== 'casestudy') continue;
    const fills = { references: 'research', reviews: 'validation', decisions: 'decisions', constraints: 'constraints', work: 'process', tasks: 'reflection', brainstorm: 'process', artifacts: 'solution' }[other];
    const sec = by(cs).find((x) => x.section === fills);
    if (sec && sec.status !== 'filled' && by(other).length) out.push({ kind: 'gap', text: `“${sec.title}” is ${sec.status === 'missing' ? 'unanswered' : 'thin'}; ${by(other).length} item${by(other).length > 1 ? 's' : ''} here can answer it.`, evidence: [ref(cs, sec), ...by(other).slice(0, 3).map((x) => ref(other, x))], action: { type: 'casestudy', section: fills } });
  }
  // Any two blocks: the subjects both keep coming back to.
  const df = (list) => { const m = new Map(); for (const x of real(list)) for (const w of terms(say(x))) m.set(w, (m.get(w) || 0) + 1); return m; };
  const da = df(A), db_ = df(B);
  const shared = [...da.keys()].filter((w) => db_.has(w)).map((w) => ({ w, s: Math.min(da.get(w), db_.get(w)) })).sort((x, y) => y.s - x.s).slice(0, 4);
  if (shared.length) {
    const has = (x) => { const t = terms(say(x)); return shared.some((s) => t.has(s.w)); };
    out.push({ kind: 'match', text: `Both come back to ${shared.map((s) => `“${s.w}”`).join(', ')}.`, evidence: [...real(A).filter(has).slice(0, 2).map((x) => ref(a, x)), ...real(B).filter(has).slice(0, 2).map((x) => ref(b, x))] });
  }
  // Insights people and agents wrote for this pair.
  for (const n of all("SELECT * FROM note WHERE project_id=? AND kind='insight'", p.id)) {
    if (pair(a, b, n.meta?.a, n.meta?.b)) out.unshift({ kind: ['gap', 'conflict', 'match'].includes(n.meta?.kind) ? n.meta.kind : 'note', text: n.text, by: n.author_name, evidence: (n.meta?.evidence || []).map((e) => ({ block: n.meta.a, title: short(e, 60) })), id: n.id }); // written by a person, an agent or Trace's AI (which cites the items it read)
  }
  const rank = { conflict: 0, gap: 1, note: 2, match: 3, support: 4 };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind]).slice(0, 14);
}
