// The case study, assembled from everything Trace holds: the brief, the project's own docs (PRD, README, DESIGN,
// NOTES…), every iteration and screen, decisions, references, reviews, tasks, AI sessions and agent reasoning.
// Rules answer only what reads as an answer (the brief, a doc's prose, the timeline's facts); everything else is
// evidence. Trace AI writes the rest from a dossier of it all (ai.js draftCaseStudy), agents over MCP
// (answer_case_study); an answer you write always wins.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { all, get, run, now, DATA } from './db.js';
import { exchangesFor } from './memory.js';
import { designTokens } from './retrieval.js';

// ---------- where a project lives, and its own docs ----------
export function projectDirs(p) { // set by hand, or folder sources filed into it
  const out = new Set(p.folders || []);
  for (const s of all("SELECT id, project_id, scope FROM source WHERE tool='folder'")) {
    const filed = s.project_id || get("SELECT project_id FROM moment WHERE source_id=? AND status='accepted' AND project_id IS NOT NULL GROUP BY project_id ORDER BY COUNT(*) DESC LIMIT 1", s.id)?.project_id;
    if (filed === p.id && s.scope?.path) out.add(s.scope.path);
  }
  return [...out].filter((d) => existsSync(d) && statSync(d).isDirectory());
}
const SKIP_DOC = /^(LICENSE|CHANGELOG|CODE_OF_CONDUCT|SECURITY|CONTRIBUTING|CLAUDE|AGENTS|GEMINI)\b/i; // AI instructions aren't the story
export function projectDocs(p) {
  const out = [];
  for (const d of projectDirs(p)) for (const sub of ['', 'docs', 'doc', 'design']) {
    let names = [];
    try { names = readdirSync(path.join(d, sub)); } catch { continue; }
    for (const n of names) {
      if (!DOC_OK(n) || SKIP_DOC.test(n)) continue;
      const f = path.join(d, sub, n);
      try { const st = statSync(f); if (st.isFile() && st.size < 400000) out.push({ name: [sub, n].filter(Boolean).join('/'), text: readFileSync(f, 'utf8').replace(/^﻿/, ''), ts: st.mtimeMs }); } catch {}
    }
  }
  for (const a of all("SELECT a.name, s.text, s.created_at FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND a.type='doc' AND s.text IS NOT NULL", p.id)) {
    if (DOC_OK(a.name) && !SKIP_DOC.test(a.name) && !out.some((d) => d.name.endsWith(a.name))) out.push({ name: a.name, text: a.text, ts: a.created_at });
  }
  return out.sort((x, y) => RANK(x.name) - RANK(y.name)).slice(0, 30); // the README and the PRD speak for the project first
}
// Prose docs only (markdown, or notes/brief/PRD as text); test fixtures and logs aren't the story.
const DOC_OK = (n) => /\.(md|mdx)$/i.test(n) || /^(notes|brief|prd|readme|research|spec)[\w-]*\.txt$/i.test(n.split(/[\\/]/).pop());
const RANK = (n) => { const b = n.split('/').pop(); return /^readme/i.test(b) ? 0 : /^(prd|brief|spec|requirements)/i.test(b) ? 1 : /^(notes|research)/i.test(b) ? 2 : 3; };
const REQ_DOC = (n) => RANK(n) <= 1; // where a loose "must" line is a requirement, not a style rule
// A markdown doc split at its headings: [{ doc, heading, text }].
export function sectionsOf(doc) {
  const parts = [];
  let cur = { heading: '', text: '' };
  for (const line of doc.text.split(/\r?\n/)) {
    const m = line.match(/^(#{1,4})\s+(.+)/);
    if (m) { parts.push(cur); cur = { heading: m[2].replace(/[*_`#]/g, '').trim(), level: m[1].length, text: '' }; } else cur.text += `${line}\n`;
  }
  parts.push(cur);
  return parts.map((s) => ({ ...s, doc: doc.name, text: s.text.trim() })).filter((s) => s.text.length > 8);
}
// Markdown read as prose: badges and tables out, links as their words, quote and emphasis marks off.
const tidy = (t) => String(t || '').replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\|.*\|\s*$/gm, '').replace(/^\s*>\s?/gm, '').replace(/\*\*|__/g, '').replace(/^\s*-{3,}\s*$/gm, '').replace(/[ \t]*·[ \t]*\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const clip = (t, n = 560) => { const s = String(t || '').replace(/\n{3,}/g, '\n\n').trim(); return s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s; };
// What reads as an answer: whole sentences, not code, commands, file lists or a line ending in a colon. Null when a
// doc section has none (its words stay evidence for the AI to read).
const prose = (t, n = 560) => {
  const paras = tidy(String(t || '').replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1')).split(/\n\s*\n/)
    .map((x) => x.replace(/^\s*(?:[-*•+]|\d+[.)])\s+/gm, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter((x) => x.split(/\s+/).length >= 8 && /[a-z]/.test(x) && !/:$/.test(x) && !/^(npm|pnpm|yarn|npx|cd|git)\s/.test(x));
  return paras.length ? clip(paras.slice(0, 2).join('\n\n'), n) : null;
};
const GENERIC_REF = /^from your prompt|^pasted|^screenshot|^image\b|^untitled/i; // a picture pasted into a chat isn't research by its title

// ---------- constraints: what it must and must not do, from the brief and the docs, checked against the work ----------
const MUST = /\b(must(?: not)?|mustn't|should(?: not)?|shouldn't|can(?:no|')t|cannot|needs? to|has to|required?|requirement|at least|at most|no more than|maximum|minimum|only|never|always|deadline|budget|WCAG|accessib\w*|contrast|tap target|offline|load (?:in|time)|under \d)\b/i;
export function constraintsOf(p, docs = projectDocs(p)) {
  const out = [];
  const add = (text, source) => {
    const t = text.replace(/^\s*(?:[-*•+]|\d+[.)])\s*/, '').replace(/\*\*|__|`/g, '').trim();
    if (t.length < 14 || t.length > 260 || out.some((o) => o.text.toLowerCase() === t.toLowerCase())) return;
    out.push({ text: t, source });
  };
  for (const l of (p.brief || '').split('\n')) if (/^constraints?:/i.test(l)) l.replace(/^constraints?:\s*/i, '').split(/;\s*/).forEach((x) => x && !/^unknown$/i.test(x.trim()) && add(x, 'Brief'));
  for (const d of docs) for (const s of sectionsOf(d)) {
    const inSection = /(constraint|requirement|non.?goal|scope|limit|must|rule|principle)/i.test(s.heading);
    for (const line of s.text.split('\n')) if (/^\s*(?:[-*•+]|\d+[.)])\s+/.test(line) && (inSection || (REQ_DOC(d.name) && MUST.test(line)))) add(line, `${d.name}${s.heading ? ` · ${s.heading}` : ''}`);
  }
  for (const n of all("SELECT id, text, author_name FROM note WHERE project_id=? AND kind='constraint' ORDER BY created_at", p.id)) out.unshift({ id: n.id, text: n.text, source: `Added by ${n.author_name || 'you'}` });
  return out.slice(0, 40);
}
// A constraint checked against the latest design, where it names something measurable (a colour, a font, a size).
// The design's tokens, plus a look into the latest code, since a component's colours often live in its source.
export function tokensFor(project_id) {
  return { ...designTokens(project_id), codeHas: (s) => !!get("SELECT 1 FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND a.type IN ('code','doc') AND lower(s.text) LIKE ? LIMIT 1", project_id, `%${s.toLowerCase()}%`) };
}
export function checkConstraint(c, tokens) {
  const t = c.text;
  const colors = new Set([...tokens.colors.map((x) => String(x.value).toLowerCase()), ...Object.values(tokens.declared || {}).map((v) => String(v).toLowerCase())]);
  const hexes = [...t.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)].map((m) => m[0].toLowerCase());
  if (hexes.length) {
    const missing = hexes.filter((h) => ![...colors].some((x) => x.includes(h)) && !tokens.codeHas?.(h));
    return missing.length ? { status: 'unseen', note: `${missing.join(', ')} isn’t in the latest design` } : { status: 'met', note: `${hexes.join(', ')} is used in the latest design` };
  }
  const fams = tokens.typography.map((x) => x.family).filter(Boolean);
  const font = fams.find((f) => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
  if (font) return { status: 'met', note: `${font} is the type in the latest design` };
  const min = t.match(/(?:at least|minimum|min\.?|no smaller than)\s*(\d+)\s*(?:px|pt)/i);
  if (min && /font|text|type/i.test(t) && tokens.typography.length) {
    const small = Math.min(...tokens.typography.map((x) => x.size).filter(Boolean));
    return small < +min[1] ? { status: 'conflict', note: `The latest design has ${small}px text` } : { status: 'met', note: `The smallest text is ${small}px` };
  }
  return { status: 'unchecked', note: null };
}

// ---------- the questions ----------
export const SECTIONS = [
  { id: 'overview', q: 'What is it, in one line?', heads: /^(overview|summary|tl;?dr|about|introduction|what is|elevator)/i },
  { id: 'problem', q: 'What problem does it solve?', heads: /(problem|why|pain|motivation|background|context|opportunity|the job|jtbd)/i },
  { id: 'users', q: 'Who is it for?', heads: /(user|persona|audience|customer|who )/i },
  { id: 'goals', q: 'What were the goals and principles?', heads: /(goal|objective|principle|success|metric|kpi|outcome)/i },
  { id: 'constraints', q: 'What were the constraints?' },
  { id: 'research', q: 'What did you learn before designing?', heads: /(research|insight|interview|finding|competit|benchmark|discovery|inspiration)/i },
  { id: 'process', q: 'How did the design evolve?' },
  { id: 'decisions', q: 'What were the key decisions, and why?', heads: /(decision|trade.?off|rationale|approach)/i },
  { id: 'solution', q: 'What is the final solution?', heads: /^(solution|features?|how it works|the product|design)$/i },
  { id: 'implementation', q: 'How was it built?', heads: /(architecture|stack|tech|implementation|engineering|build|setup)/i },
  { id: 'validation', q: 'How was it validated?', heads: /(validation|validated|testing|tests?\b|usability|results?\b|impact|feedback|metrics|\bqa\b)/i }, // not "launch": "Launch films" is a section about films
  { id: 'reflection', q: 'What did you learn, and what’s next?', heads: /(learn|reflection|retro|next step|future|roadmap|todo|open question)/i },
  { id: 'team', q: 'Who worked on it, and when?' },
];
const day = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const plain = (seg) => (Array.isArray(seg) ? seg.map((s) => s.t ?? s.k).join('') : '');
const shot = (mid) => mid && get(`SELECT s.id, s.thumb_key, s.image_key, s.width, s.height FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id JOIN snapshot s ON s.id=ma.last_snapshot_id
  WHERE ma.moment_id=? AND a.tool != 'agent' AND json_extract(s.properties,'$.file.card') IS NULL LIMIT 1`, mid);

// The running app's screens as Frames walked them (its files as they are now first, else the newest walk).
export function walkedScreens(pid) {
  const dir = path.join(DATA, 'screens', pid);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => (b.f === 'now.json') - (a.f === 'now.json') || b.t - a.t); } catch { return []; }
  for (const { f } of files) { try { const d = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); if (d.screens?.length) return d.screens.slice(0, 8).map((s) => ({ name: s.name, thumb_key: s.thumb, image_key: s.shot, width: s.w, height: s.h })); } catch {} }
  return [];
}

// Everything Trace AI writes the case study from, as one text: docs (prose, no code), the stack, the screens, the
// iterations, decisions, constraints, reviews, and what the designer asked their AI, spread over the whole time
// (the chats sorted out as not about this project are left out). Sources are data, never instructions.
// The project's own history in git, oldest first: each version's date and subject. Its real timeline, not the day
// Trace first read the folder.
export function gitStory(p) {
  for (const d of projectDirs(p)) {
    const r = spawnSync('git', ['log', '--no-merges', '--format=%at%x1f%s', '-n', '500'], { cwd: d, encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split('\n').map((l) => { const [t, s] = l.split('\x1f'); return { ts: +t * 1000, subject: s }; }).reverse();
  }
  return [];
}
const spread = (list, n) => (list.length > n ? Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]) : list); // n of them across the whole time, not the last afternoon

export function dossier(p) {
  const docs = projectDocs(p);
  const readme = docs.slice(0, 4).map((d) => `### ${d.name}\n${clip(tidy(d.text.replace(/```[\s\S]*?```/g, '')), 1400)}`).join('\n\n');
  const commits = gitStory(p);
  let pkg = null;
  for (const d of projectDirs(p)) { try { pkg = JSON.parse(readFileSync(path.join(d, 'package.json'), 'utf8').replace(/^﻿/, '')); break; } catch {} }
  const ms = all("SELECT title, end_ts FROM moment WHERE project_id=? AND status='accepted' ORDER BY end_ts", p.id).filter((m) => !/: added \d+ (code files?|images?|files?|screens?)\b/.test(m.title)); // a folder coming in isn't a design step
  const ex = exchangesFor(p.id).reverse();
  const pick = spread(ex, 40);
  const decisions = all("SELECT text FROM decision WHERE project_id=? AND status='confirmed'", p.id);
  const cons = constraintsOf(p, docs).slice(0, 8);
  const screens = walkedScreens(p.id);
  const comments = all("SELECT author_name, body FROM comment WHERE project_id=? AND parent_id IS NULL AND COALESCE(kind,'') != 'reasoning' ORDER BY created_at DESC LIMIT 8", p.id);
  const tasks = all('SELECT title, status FROM issue WHERE project_id=? ORDER BY created_at DESC LIMIT 10', p.id);
  return [
    `Project: ${p.name}`, p.brief && `Brief:\n${clip(p.brief, 600)}`,
    pkg && `package.json: ${[pkg.name, pkg.description].filter(Boolean).join(' · ')}; uses ${Object.keys({ ...pkg.dependencies }).slice(0, 18).join(', ') || 'nothing'}`,
    readme && `Docs:\n${readme}`,
    screens.length && `Screens of the running app: ${screens.map((s) => s.name).join(' · ')}`,
    commits.length && `Versions in git (${commits.length}, ${day(commits[0].ts)} to ${day(commits.at(-1).ts)}), oldest first:\n${spread(commits, 25).map((c) => `- ${day(c.ts)}: ${clip(c.subject, 140)}`).join('\n')}`,
    ms.length && `Iterations (${ms.length}, ${day(ms[0].end_ts)} to ${day(ms.at(-1).end_ts)}):\n${ms.slice(-15).map((m) => `- ${day(m.end_ts)}: ${m.title}`).join('\n')}`,
    decisions.length && `Decisions:\n${decisions.map((d) => `- ${clip(d.text, 200)}`).join('\n')}`,
    cons.length && `Constraints:\n${cons.map((c) => `- ${c.text}`).join('\n')}`,
    pick.length && `The designer's working notes while making it, oldest first (casual wording: read them for what was made, why and in what order; never quote them or say where they came from):\n${pick.map((e) => `- ${day(e.ts)}: ${clip(String(e.asked || '').replace(/\s+/g, ' '), 220)}`).join('\n')}`,
    comments.length && `Review comments:\n${comments.map((c) => `- ${c.author_name}: ${clip(c.body, 160)}`).join('\n')}`,
    tasks.length && `Tasks:\n${tasks.map((t) => `- ${t.title} (${t.status})`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}
// When the work last changed: an iteration, a prompt, a decision. Trace AI drafts again after that.
export const changedAt = (pid) => Math.max(0, ...[get("SELECT MAX(end_ts) t FROM moment WHERE project_id=? AND status='accepted'", pid)?.t, exchangesFor(pid, { limit: 1 })[0]?.ts, get('SELECT MAX(created_at) t FROM decision WHERE project_id=?', pid)?.t].filter(Boolean));

// Assemble every answer with its evidence. Answers people or agents wrote replace the assembled ones.
export function assemble(p) {
  const docs = projectDocs(p);
  const secs = docs.flatMap(sectionsOf);
  const ms = all("SELECT * FROM moment WHERE project_id=? AND status='accepted' ORDER BY end_ts", p.id);
  const ex = exchangesFor(p.id).reverse();
  const decisions = all("SELECT * FROM decision WHERE project_id=? ORDER BY status='confirmed' DESC, created_at", p.id);
  const refs = all("SELECT id, title, kind, thumb_key, note FROM reference WHERE project_id=? AND COALESCE(origin,'') != 'removed' ORDER BY created_at DESC", p.id);
  const comments = all("SELECT * FROM comment WHERE project_id=? AND parent_id IS NULL ORDER BY created_at", p.id);
  const tasks = all('SELECT * FROM issue WHERE project_id=? ORDER BY created_at', p.id);
  const brief = (p.brief || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const briefLine = (re) => brief.find((l) => re.test(l))?.replace(/^[^:]+:\s*/, '');
  const fromDocs = (re) => secs.filter((s) => re && re.test(s.heading)).slice(0, 3).map((s) => { const a = prose(s.text); return { source: s.doc, label: s.heading, text: a || clip(tidy(s.text)), ...(a ? { answer: a } : {}) }; });
  const tokens = tokensFor(p.id);
  const ev = {}, answer = {};
  const put = (id, list) => (ev[id] = [...(ev[id] || []), ...list.filter(Boolean)]);
  const fromBrief = (label, t) => t && { source: 'Brief', label, text: t, answer: t };

  // overview first: the brief, then the paragraph under the README's or PRD's title, then any "Overview" section
  const intro = secs.find((s) => (!s.heading || s.level === 1) && prose(s.text, 320)) || secs.find((s) => /^(readme|overview)$/i.test(s.heading) && prose(s.text, 320));
  put('overview', [fromBrief('Goal', brief[0]?.replace(/^goal:\s*/i, '')), intro && { source: intro.doc, label: 'Intro', text: prose(intro.text, 320), answer: prose(intro.text, 320) }]);
  for (const s of SECTIONS) put(s.id, fromDocs(s.heads));
  // problem and audience: the brief (what you told your AI is read by Trace AI when it drafts, not quoted here)
  put('problem', [fromBrief('Goal', briefLine(/^(problem|goal):/i))]);
  put('users', [!/unknown/i.test(briefLine(/^(audience|users?|persona):/i) || '') && fromBrief('Audience', briefLine(/^(audience|users?|persona):/i))]);
  // constraints
  const cons = constraintsOf(p, docs);
  put('constraints', cons.slice(0, 8).map((c) => ({ source: c.source, label: checkConstraint(c, tokens).status === 'met' ? 'Kept' : 'Constraint', text: c.text })));
  if (cons.length) answer.constraints = cons.slice(0, 8).map((c) => `- ${c.text}`).join('\n');
  // research: references and notes agents left
  const named = refs.filter((r) => r.title && !GENERIC_REF.test(r.title));
  if (refs.length) put('research', [{ source: 'References', label: plural(refs.length, 'reference'), text: named.length ? named.slice(0, 6).map((r) => r.title).join(' · ') : `${plural(refs.length, 'picture')} kept as references`, images: refs.filter((r) => r.thumb_key).slice(0, 6).map((r) => ({ thumb_key: r.thumb_key, title: GENERIC_REF.test(r.title || '') ? '' : r.title })) }]);
  for (const n of all("SELECT d.title, c.text FROM memory_doc d JOIN memory_chunk c ON c.doc_id=d.id WHERE d.project_id=? AND d.kind IN ('note','memory') LIMIT 3", p.id)) put('research', [{ source: 'AI memory', label: n.title, text: clip(n.text.replace(/^---[\s\S]*?---\s*/, ''), 300) }]); // without the file's front matter
  // process: the timeline told as a story; git's own versions when there are some (Trace's import day isn't when it was made)
  const commits = gitStory(p);
  if (commits.length > 1) {
    const mid = commits[Math.floor(commits.length / 2)];
    answer.process = `${plural(commits.length, 'version')} from ${day(commits[0].ts)} to ${day(commits.at(-1).ts)}: it began as “${commits[0].subject}”${commits.length > 2 ? `, then “${mid.subject}”` : ''}, and stands at “${commits.at(-1).subject}”.`;
    put('process', spread(commits, 6).map((c) => ({ source: 'Git', label: day(c.ts), text: c.subject })));
  } else if (ms.length) {
    const people = [...new Set(ms.map((m) => m.agent || m.actor_name))];
    const big = [...ms].sort((a, b) => b.magnitude - a.magnitude).slice(0, 2);
    const explore = all('SELECT name, status FROM exploration WHERE project_id=?', p.id);
    const steps = [ms[0], ...big, ms.at(-1)].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).sort((a, b) => a.end_ts - b.end_ts);
    answer.process = `${plural(ms.length, 'iteration')} from ${day(ms[0].end_ts)} to ${day(ms.at(-1).end_ts)} by ${people.join(', ')}${ex.length ? `, with ${plural(ex.length, 'prompt')} to AI` : ''}. It started with “${ms[0].title}”${big[0] && big[0].id !== ms[0].id ? `; the biggest turn was “${big[0].title}” (${day(big[0].end_ts)})` : ''}${explore.length ? `; ${plural(explore.length, 'direction')} explored on the side (${explore.map((x) => x.name).join(', ')})` : ''}; it stands at “${ms.at(-1).title}”.`;
    put('process', steps.map((m) => ({ source: 'Iteration', label: day(m.end_ts), text: `${m.title}: ${plain(m.sentence) || m.summary || ''}`, href: `#/m/${m.id}`, images: [shot(m.id)].filter(Boolean) })));
  }
  if (ex.length) put('process', [{ source: [...new Set(ex.map((e) => e.tool))].join(' and '), label: plural(ex.length, 'prompt'), text: 'What you asked your AI while making it. Trace AI reads them when it writes these answers; they aren’t quoted here.' }]);
  // decisions and the reasoning agents gave
  put('decisions', decisions.filter((d) => d.status === 'confirmed').slice(0, 6).map((d) => ({ source: 'Decision log', label: 'Decided', text: d.text })));
  for (const c of comments.filter((c) => c.kind === 'reasoning').slice(-4)) put('decisions', (c.meta?.changes || []).slice(0, 2).map((x) => ({ source: c.author_name, label: x.what, text: x.why })));
  // solution: the screens of the running app (Frames walks it), else its drawn components, else the latest pictures
  const walked = walkedScreens(p.id);
  const code = !walked.length && all("SELECT a.name, s.thumb_key, s.image_key, s.width, s.height FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND json_extract(s.properties,'$.component.mode') IS NOT NULL AND s.image_key IS NOT NULL ORDER BY a.updated_at DESC LIMIT 8", p.id);
  const latestScreens = walked.length ? walked : code?.length ? code : all(`SELECT a.name, s.thumb_key, s.image_key, s.width, s.height FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id
    WHERE a.project_id=? AND a.type NOT IN ('code','doc','font') AND s.image_key IS NOT NULL AND json_extract(s.properties,'$.file.card') IS NULL ORDER BY a.updated_at DESC LIMIT 8`, p.id);
  if (latestScreens.length) put('solution', [{ source: walked.length ? 'Screens of the running app' : code?.length ? 'Components drawn from the code' : 'Latest work', label: plural(latestScreens.length, walked.length ? 'screen' : code?.length ? 'component' : 'picture'), text: latestScreens.map((s) => (/^[0-9a-f]{16,}/i.test(s.name) ? 'Screen' : s.name.replace(/\.(tsx|jsx|png|jpe?g|webp|svg)$/i, ''))).join(' · '), images: latestScreens.map((s) => ({ thumb_key: s.thumb_key, image_key: s.image_key, title: s.name, width: s.width, height: s.height })) }]);
  // implementation: the stack and the code that changed
  for (const d of projectDirs(p)) {
    try { const j = JSON.parse(readFileSync(path.join(d, 'package.json'), 'utf8').replace(/^﻿/, '')); const deps = Object.keys({ ...j.dependencies, ...j.devDependencies }); if (deps.length) put('implementation', [{ source: 'package.json', label: 'Stack', text: deps.slice(0, 14).join(', ') }]); } catch {}
  }
  const drawn = get("SELECT COUNT(*) n FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND json_extract(s.properties,'$.component.mode') IS NOT NULL", p.id).n;
  const files = all('SELECT type, COUNT(*) n FROM asset WHERE project_id=? GROUP BY type ORDER BY n DESC', p.id);
  if (files.length) put('implementation', [{ source: 'Files', label: 'What was made', text: `${files.map((f) => `${f.n} ${f.type}`).join(', ')}${drawn ? `; ${plural(drawn, 'component')} drawn from the code` : ''}.` }]);
  // validation: reviews and what came of them
  const resolved = comments.filter((c) => c.status === 'resolved');
  const reviewed = comments.filter((c) => c.kind === 'reasoning' && c.status === 'resolved');
  const proposals = all("SELECT title, status FROM proposal WHERE project_id=? AND status IN ('accepted','rejected')", p.id);
  if (comments.length) put('validation', [{ source: 'Reviews', label: plural(comments.length, 'comment'), text: `${resolved.length} resolved${reviewed.length ? `, ${plural(reviewed.length, 'agent explanation')} reviewed` : ''}${proposals.length ? `, ${proposals.map((x) => `“${x.title}” ${x.status}`).join(', ')}` : ''}.` }, ...comments.filter((c) => c.kind !== 'reasoning').slice(-2).map((c) => ({ source: c.author_name, label: 'Said', text: clip(c.body, 240) }))]);
  // reflection: what's still open
  const open = tasks.filter((t) => ['open', 'in_progress'].includes(t.status));
  if (open.length) put('reflection', [{ source: 'Tasks', label: `${open.length} still open`, text: open.slice(0, 5).map((t) => t.title).join(' · ') }]);
  // team
  if (ms.length || ex.length || commits.length) {
    const by = {};
    for (const m of ms) by[m.agent || m.actor_name] = (by[m.agent || m.actor_name] || 0) + 1;
    const tools = [...new Set(ex.map((e) => e.tool))];
    const times = [...commits.map((c) => c.ts), ...ms.flatMap((m) => [m.start_ts, m.end_ts]), ...ex.map((e) => e.ts)].filter(Boolean); // from the first trace of the work to the last
    const who = Object.keys(by).length > 1 ? Object.entries(by).map(([w, n]) => `${w} (${plural(n, 'iteration')})`).join(', ') : 'Solo: design and code'; // one person: no login name in a portfolio
    answer.team = `${who}${tools.length ? `, working with ${tools.join(' and ')}` : ''}. ${times.length ? `${day(Math.min(...times))} – ${day(Math.max(...times))}.` : ''}`.trim();
  }

  const saved = Object.fromEntries(all('SELECT * FROM case_answer WHERE project_id=?', p.id).map((r) => [r.section, r]));
  const sections = SECTIONS.map(({ id, q }) => {
    const list = (ev[id] || []).slice(0, 8);
    const own = saved[id];
    const built = answer[id] || list.find((e) => e.answer)?.answer || (id === 'decisions' && list.filter((e) => e.source === 'Decision log').map((e) => `- ${e.text}`).join('\n')) || ''; // only what reads as an answer: prompts, file names and stacks stay evidence
    const strong = !!built;
    return {
      id, q, evidence: list, answer: own?.answer || built,
      origin: own ? own.origin : built ? 'assembled' : null, author: own?.author || null, updated_at: own?.updated_at || null,
      status: own ? 'filled' : !list.length && !built ? 'missing' : strong ? 'filled' : 'partial',
    };
  });
  const filled = sections.filter((s) => s.status === 'filled').length;
  return { project: { id: p.id, name: p.name }, sections, readiness: Math.round((filled / sections.length) * 100), docs: docs.map((d) => d.name), constraints: cons.length, generated_at: now() };
}

export function answer(project_id, section, text, origin, author, evidence) {
  if (!SECTIONS.some((s) => s.id === section)) throw Object.assign(new Error(`No section “${section}”. Sections: ${SECTIONS.map((s) => s.id).join(', ')}`), { status: 400 });
  if (!String(text || '').trim()) { run('DELETE FROM case_answer WHERE project_id=? AND section=?', project_id, section); return; } // clearing goes back to the assembled answer
  run('INSERT OR REPLACE INTO case_answer (project_id, section, answer, origin, author, evidence, updated_at) VALUES (?,?,?,?,?,?,?)', project_id, section, String(text).trim().slice(0, 6000), origin, author, evidence || null, now());
}

// The whole case study as markdown, pictures linked from this Trace.
export function markdown(cs, origin = '') {
  const img = (i) => `![${i.title || ''}](${origin}/files/${i.image_key || i.thumb_key})`;
  return [`# ${cs.project.name}`, '', `_Assembled by Trace on ${day(cs.generated_at)} · ${cs.readiness}% answered_`, '',
    ...cs.sections.flatMap((s) => [`## ${s.q}`, '', s.answer || '_Not answered yet._', '',
      ...s.evidence.flatMap((e) => (e.images || []).slice(0, 4).map(img)), ...(s.evidence.some((e) => e.images?.length) ? [''] : []),
      ...(s.evidence.length ? [`<sub>Sources: ${[...new Set(s.evidence.map((e) => e.source))].join(', ')}</sub>`, ''] : [])])].join('\n');
}
