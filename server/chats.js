// The insight engine over the agent chats. Every session of a project is read whole: what the person asked (and how
// they said it), what Claude replied, what it reasoned, and which files it changed for each ask. Rules (no model) turn
// that into what matters, each with its words as evidence and a score:
//   rule        what the person set for good: "always…", "never…", "don't…", "make sure…"
//   correction  what they said no to ("still bad", "revert it", "why is…"), with what Claude had just said it made
//   approval    what they liked ("perfect", "this is it"), with what it was
//   cause       why something was wrong, as Claude found it (in its replies or its reasoning)
//   result      what changed, in numbers ("15 min → 2 min 47 s", "3× faster")
//   decision    what Claude chose and why ("went with X instead of Y")
// A session is streamed once and its insights cached by its size and time, so a 500 MB chat costs its first read only.
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { discover } from './frames.js';
import { all, insert, update, uid, DATA } from './db.js';
import { ruleOf, ruleKey, AVOID } from './check.js';
import { rejected, needRepo, git } from './history.js';
import { projectDirs } from './casestudy.js';
import { clean, exchangesFor } from './memory.js';

const CACHE = path.join(DATA, 'chats');
const VERSION = 14; // bump when the rules change: cached sessions are read again
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit|str_replace_based_edit_tool|apply_patch)$/;

// How the person says no, yes, and for good. Read on their own words, sentence by sentence.
const CORRECT = /\b(revert|undo|roll ?back|still (?:bad|wrong|broken|not|the same|looks?)|not (?:working|right|good|what i|like this)|does ?n[o']?t (?:work|look|feel|show|load)|is ?n[o']?t (?:working|right|showing)|did ?n[o']?t (?:work|fix|change)|wrong|ugly|shit+y?|slop+y?|worse|broken|bug(?:gy)?|glitch\w*|why (?:is|are|did|does|do)|too (?:much|big|small|slow|fast|heavy|busy|many)|nope|disgusting|horrible|terrible|bad (?:ux|ui)|very bad|not (?:smooth|aligned|centered|visible))\b/i;
const APPROVE = /^(?:(?:bro|ok(?:ay)?|yes+|wow|yeah|nice)[,!. ]+)*(?:(?:it'?s|its|this is|this looks|looks|that'?s|now it'?s|now its|it looks)\s+)?(?:(?:very|really|so|much|pretty)\s+)?(?:perfect|great|good|nice|awesome|amazing|beautiful|exactly|better|love (?:it|this|the)|good job|well done|works(?: now)?|it works|sick|fire|brilliant|cool)\b/i;
const RULE = /(?:^|[,;:]\s*)(?:(?:and|also|but|so|please|pls|bro|plus)[, ]+)*(?:always|never|don'?t|do not|make sure|avoid|stop (?:using|doing|adding|making)|no more|only use)\b|\b(?:from now on|every ?time|always|never|for every|across the (?:app|site|whole)|anywhere (?:in|on|across|else))\b/i;
const PASTED = /<[A-Za-z]|\.[jt]sx?:\d|\bat \S+\.js|\b(?:Error|Warning|TypeError|Uncaught)\b|["”]\s*$/; // an error or code he pasted
const NARRATIVE = /\b(?:I (?:was|am|realized|have|had|started|joined|led|worked)|my (?:first|second|third|journey|career|role)|we (?:were|had))\b/i; // copy he pasted, not an instruction
const CAUSE = /\b(root cause|the (?:real )?(?:cause|culprit|issue|problem|bug) (?:was|is|here is)|turned out|was caused by|caused by|it was because|it's because|that's why|this happens because|the reason (?:is|was))\b/i;
const NUM = '\\d[\\d.,]*\\s?(?:ms|s|sec|secs|seconds|min|mins|minutes|h|%|px|mb|kb|gb|fps|×|x|screens?|files?|lines?|kb|requests?)?';
const RESULT = new RegExp(`(${NUM})\\s*(?:→|->|⇒|to)\\s*(${NUM})|\\b\\d+(?:\\.\\d+)?\\s?[×x] (?:faster|smaller|lighter|fewer|quicker|less)\\b|\\b(?:from|down from|cut from|up from) ${NUM} to ${NUM}`, 'i');
const BETTER = /\b(?:faster|slower|cut|down|reduced|dropped|saved|smaller|lighter|fewer|widened|narrowed|raised|lowered|improved|shrank|grew|now|went from)\b/i;
const DECIDE = /\b(?:I (?:chose|went with|picked|opted for|decided to|switched to)|instead of|rather than)\b/i;
const SETUP = /\b(?:dev server|port \d+|localhost|lint\w*|preview pane|browser pane|npm|pnpm|yarn|node_modules|install\w*|hot reload|HMR|cache[ds]?|session|worktree|git (?:push|commit)|permission)\b/i; // the machine, not the product
const HEDGE = /\b(?:probably|maybe|might|perhaps|likely|I think|I guess|I suspect|could be|seems)\b/i;
const LOUD = /!{2,}|\b(?:shit\w*|fuck\w*|wtf|worst|slop+y?|ugly|disgusting|horrible)\b/i;
const STOP = new Set('design page pages section sections screen screens site website app apps project projects user users remove these those across making create build component components feature features option options bottom top left right show showing working work like the and for with this that from into your you are was were have has had but not its it’s it\'s can could should would will just also like then than them they what when where which while there here make made more less some all any get got use used using need want wants add added change changed fix fixed now new one two very much bit lot really please thing things stuff okay ok yes bro also only same way look looks good better still other each about over under after before again them our out how why who did does done been being able let lets'.split(' '));
const unwrap = (t) => { const x = String(t || '').replace(/<preview-annotation-context>[\s\S]*?<\/preview-annotation-context>/g, ''); const fb = [...x.matchAll(/\*\*(?:Feedback|Comment):?\*\*:?\s*([^\n]+)/gi)].map((m) => m[1]); return fb.length ? fb.join(' · ') : x; }; // a page-feedback paste is its feedback lines
const plain = (t) => String(t || '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/\[pointed at an element on the page\]/g, '').replace(/\s+/g, ' ').trim();
const sentences = (t) => plain(t).split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])|\s+[-•·]\s+/).map((s) => s.trim()).filter((s) => s.length >= 12 && s.length <= 320);
const words = (t) => [...new Set((String(t).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter((w) => !STOP.has(w)))];
// His words in a list: without the "bro" or a pasted path at their start (a quote keeps them as said).
export const said = (t, n = 160) => short(String(t || '').replace(/^\s*(?:"?[A-Za-z]:\\[^\s"]+"?|\/\S+)\s+/, '').replace(/^(?:(?:bro|broski|bruh|ok|okay|so|and)[,!. ]+)+/i, '').replace(/^\w/, (c) => c.toUpperCase()), n);
const short = (t, n = 220) => { const s = plain(t); return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s; };

// One session, read whole: its exchanges (an ask, Claude's replies and reasoning, the files it edited), in order.
async function readSession(file) {
  const ex = [];
  let cur = null, title = null;
  await new Promise((resolve) => {
    const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    rl.on('line', (l) => {
      if (l.includes('"type":"custom-title"')) { try { title = JSON.parse(l).customTitle || title; } catch {} return; }
      const user = l.startsWith('{"') && l.includes('"type":"user"'), asst = l.includes('"type":"assistant"');
      if (!user && !asst) return;
      if (user && l.includes('"tool_use_id"')) return; // a tool's answer, not the person
      if (asst && !l.includes('"type":"text"') && !l.includes('"type":"thinking"') && !l.includes('"type":"tool_use"')) return;
      let o; try { o = JSON.parse(l); } catch { return; }
      if (o.isSidechain || o.isMeta || o.isCompactSummary) return;
      const c = o.message?.content, at = Date.parse(o.timestamp) || null;
      if (user) {
        const text = clean(typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '');
        if (!text || /^(Caveat:|\[Request interrupted|<local-command|<command-)/.test(text)) return;
        cur = { at, ask: text.slice(0, 4000), pics: Array.isArray(c) ? c.filter((b) => b.type === 'image').length : 0, replies: [], thinking: [], files: new Set() };
        ex.push(cur);
        return;
      }
      if (!cur || !Array.isArray(c)) return;
      for (const b of c) {
        if (b.type === 'text' && b.text?.trim()) cur.replies.push(clean(b.text).slice(0, 6000));
        else if (b.type === 'thinking' && b.thinking?.trim()) cur.thinking.push(clean(b.thinking).slice(0, 6000));
        else if (b.type === 'tool_use' && EDITS.test(b.name)) { const f = b.input?.file_path || b.input?.path; if (f) cur.files.add(String(f)); }
      }
    });
    rl.on('close', resolve);
    rl.on('error', resolve);
  });
  return { title, ex };
}

// What one session says, by the rules above. `prev` is what Claude said it had made when the person answered.
export function insightsOf(ex, session = '') {
  const out = [];
  const add = (kind, text, x, extra = {}) => out.push({ kind, text: short(text), at: x.at, session, files: [...x.files].map((f) => f.replace(/\\/g, '/')).filter((f) => !/\/AppData\/|\/\.claude\/|\/tmp\//i.test(f)).slice(0, 6).map((f) => f.replace(/^.*?\/(src|app|server|ui|components|pages|lib|styles)\//, '$1/')), ...extra });
  ex.forEach((x, i) => {
    const prev = ex[i - 1], said = prev && (prev.replies.at(-1) || ''), loud = LOUD.test(x.ask), ask = plain(unwrap(x.ask));
    const yes = APPROVE.test(ask), but = ask.match(/\bbut\b\s*(.+)$/i)?.[1];
    if (yes && prev) add('approval', ask.length < 200 ? ask : ask.split(/\bbut\b/i)[0], x, { of: short(said, 200), score: 2 });
    if (prev && (yes ? but && CORRECT.test(but) : CORRECT.test(ask))) add('correction', yes ? but : ask, x, { of: short(said, 200), score: 3 + (loud ? 1 : 0) });
    for (const s of sentences(unwrap(x.ask))) if (RULE.test(s) && !/\?$/.test(s) && !/^(?:(?:bro|broski)[, ]+)?why\b/i.test(s) && s.length <= 200 && !NARRATIVE.test(s) && !PASTED.test(s) && !SETUP.test(s) && !/https?:\/\/|\bglobally\b|\bplugin\b/i.test(s)) add('rule', s, x, { score: 3 + (loud ? 1 : 0) }); // about the product, not the machine
    const last = x.replies.at(-1) || '';
    for (const s of sentences(last)) {
      if (RESULT.test(s) && BETTER.test(s) && (s.match(/→|->|⇒/g) || []).length <= 1 && !/\bmeasured\b|offsets?\b|\bx\s?[−-]?\d/i.test(s)) add('result', s, x, { score: 3 });
      else if (CAUSE.test(s) && !HEDGE.test(s) && !SETUP.test(s)) add('cause', s, x, { score: 2 + (x.files.size ? 1 : 0) });
      else if (DECIDE.test(s) && /\b(because|so that|to keep|which keeps)\b/i.test(s) && !/\b(you|can'?t|if )\b/i.test(s)) add('decision', s, x, { score: 2 });
    }
    let n = 0;
    for (const t of x.thinking) for (const s of sentences(t)) if (n < 2 && CAUSE.test(s) && !HEDGE.test(s) && !SETUP.test(s) && /[`'"\w]+\.(?:tsx?|jsx?|css|json)|\b[A-Z][a-z]+[A-Z]\w*|\d/.test(s)) { add('cause', s, x, { score: 2, reasoning: true }); n++; }
  });
  return out;
}

// What Claude said it made: the files it linked in a reply that are things to look at, not source.
const MADE = /\.(mp4|mov|webm|gif|png|jpe?g|webp|svg|pdf|pptx|key|html?|md|docx|zip|fig|riv|lottie|json)$/i;
const linksIn = (t) => [...String(t || '').matchAll(/\[([^\]]{1,120})\]\(<?([^)\s>]+)>?\)/g)].map((m) => ({ label: m[1], path: (() => { try { return decodeURIComponent(m[2]); } catch { return m[2]; } })().replace(/\\/g, '/').replace(/^file:\/+/, '').replace(/#.*$/, '') }))
  .filter((l) => MADE.test(l.path) && !/^https?:/.test(l.path) && !(/\.json$/i.test(l.path) && !/lottie|anim/i.test(l.path))); // a .json is config unless it's an animation

// One session's asks and insights, from the cache when the file hasn't changed.
async function session(doc) {
  if (!doc.path || !existsSync(doc.path)) return null;
  const st = statSync(doc.path), key = createHash('sha1').update(doc.path).digest('hex').slice(0, 16), at = path.join(CACHE, `${key}.json`);
  try { const c = JSON.parse(readFileSync(at, 'utf8')); if (c.v === VERSION && c.size === st.size && c.mtime === Math.round(st.mtimeMs)) return c; } catch {}
  const { title, ex } = await readSession(doc.path);
  const c = { v: VERSION, size: st.size, mtime: Math.round(st.mtimeMs), title: title || doc.title, from: ex[0]?.at || null, to: ex.at(-1)?.at || null,
    made: ex.flatMap((x) => linksIn(x.replies.at(-1)).map((l) => ({ ...l, at: x.at, asked: short(unwrap(x.ask), 160) }))),
    asks: ex.map((x) => ({ at: x.at, ask: short(unwrap(x.ask), 300), pics: x.pics, files: x.files.size, loud: LOUD.test(x.ask) })), insights: insightsOf(ex, title || doc.title) };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(at, JSON.stringify(c));
  return c;
}

// A project's chats, all of them: insights ranked (score, then how often the same words came back across sessions),
// near-duplicates folded, the themes the person kept asking about, and the asks day by day. Sessions from tools that
// aren't read whole (Codex, Cursor…) bring their asks and Claude's last word from the memory index.
export async function chatInsights(p, { limit = 120 } = {}) {
  const docs = all("SELECT id, adapter, path, title FROM memory_doc WHERE project_id=? AND kind='session'", p.id);
  const sessions = [];
  for (const d of docs) if (d.adapter === 'claude-code') { const s = await session(d).catch(() => null); if (s?.asks.length) sessions.push(s); }
  if (docs.some((d) => d.adapter !== 'claude-code')) { // the other tools: what the memory index kept of them
    const ex = exchangesFor(p.id, { limit: 2000 }).filter((e) => e.adapter !== 'claude-code').reverse().map((e) => ({ at: e.ts, ask: e.asked || '', pics: e.images?.length || 0, replies: [e.last || e.first || ''].filter(Boolean), thinking: [], files: new Set() }));
    if (ex.length) sessions.push({ title: 'Other agents', from: ex[0].at, to: ex.at(-1).at, asks: ex.map((x) => ({ at: x.at, ask: short(unwrap(x.ask), 300), pics: x.pics, files: 0, loud: LOUD.test(x.ask) })), insights: insightsOf(ex, 'Other agents') });
  }
  const asks = sessions.flatMap((s) => s.asks.map((a) => ({ ...a, session: s.title }))).sort((a, b) => a.at - b.at);
  const df = new Map(); // in how many sessions a word comes up: a theme, not a one-off
  for (const s of sessions) for (const w of new Set(s.asks.flatMap((a) => words(a.ask)))) df.set(w, (df.get(w) || 0) + 1);
  const dirs = projectDirs(p).map((d) => `${d.replace(/\\/g, '/').replace(/\/$/, '')}/`.toLowerCase());
  const rel = (f) => { const d = dirs.find((x) => f.toLowerCase().startsWith(x)); return d ? f.slice(d.length) : f; }; // a path in the project, from its folder
  const all_ = sessions.flatMap((s) => s.insights).map((x) => ({ ...x, files: (x.files || []).map(rel), score: x.score + Math.min(2, words(x.text).filter((w) => (df.get(w) || 0) >= 3).length / 3) }));
  const kept = [];
  for (const x of all_.sort((a, b) => b.score - a.score || b.at - a.at)) { // fold near-duplicates: most words shared
    const w = new Set(words(x.text));
    if (kept.some((k) => k.kind === x.kind && (() => { const v = words(k.text), n = v.filter((t) => w.has(t)).length; return n >= Math.max(3, 0.6 * Math.min(w.size, v.length)); })())) continue;
    kept.push({ ...x, score: +x.score.toFixed(2) });
    if (kept.length >= limit) break;
  }
  for (const [w, n] of [...df]) if (w.endsWith('s') && df.has(w.slice(0, -1))) { df.set(w.slice(0, -1), Math.max(n, df.get(w.slice(0, -1)))); df.delete(w); } // card and cards: one theme
  const themes = [...df.entries()].filter(([w, n]) => n >= 2 && w.length > 3).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => ({ word: w, sessions: n }));
  const by = (k) => kept.filter((x) => x.kind === k);
  const made = new Map(); // the newest mention of each file that is still there
  for (const s of sessions) for (const m of s.made || []) {
    const r = rel(m.path), abs = dirs.map((d) => `${d}${r}`).find((x) => existsSync(x)) || (existsSync(m.path) ? m.path : null);
    if (abs && (!made.has(r) || made.get(r).at < m.at)) made.set(r, { ...m, path: r, session: s.title });
  }
  const assets = new Map(all('SELECT id, path FROM asset WHERE project_id=?', p.id).map((a) => [String(a.path || '').toLowerCase(), a.id]));
  return { made: [...made.values()].sort((a, b) => b.at - a.at).slice(0, 40).map((m) => ({ ...m, asset: assets.get(m.path.toLowerCase()) || null })), sessions: sessions.length, asks: asks.length, from: asks[0]?.at || null, to: asks.at(-1)?.at || null, loud: asks.filter((a) => a.loud).length, themes,
    insights: kept, rules: by('rule'), corrections: by('correction'), approvals: by('approval'), causes: by('cause'), results: by('result'), decisions: by('decision'),
    days: [...asks.reduce((m, a) => { const d = new Date(a.at).toISOString().slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(a); return m; }, new Map())].map(([day, l]) => ({ day, asks: l.length, top: [...l].sort((a, b) => b.ask.length - a.ask.length)[0]?.ask })) };
}

// Rules worth checking, learned from what the person said no to: a rule they set in so many words is one already (it
// gets what it governs above); the same look said no to twice or more, in their corrections or in versions they had
// undone whose code added it, is suggested too. Confirmed ones are checked on every change (check.js ruleBreaks).
const UI = ['*.css', '*.scss', '*.less', '*.tsx', '*.jsx', '*.ts', '*.js', '*.vue', '*.svelte', '*.html'];
export async function learnRules(p, c) {
  const hit = learned.get(p.id);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.list; // it reads big files and git: once in ten minutes
  const ev = new Map();
  const note = (g, e) => { if (!g) return; const k = ruleKey(g); if (!ev.has(k)) ev.set(k, { governs: g, said: [] }); ev.get(k).said.push(e); };
  for (const x of c?.corrections || []) note(ruleOf(x.text), { how: 'correction', text: x.text, at: x.at });
  // The rules written down: the project's instruction and memory files, the ones for every project, and the markdown
  // files those point to ("read TASTE.md before UI work"). One sentence there is enough.
  const docs = all("SELECT path FROM memory_doc WHERE (project_id=? AND kind IN ('instructions','memory')) OR (project_id IS NULL AND kind='instructions')", p.id).map((d) => d.path);
  const read = (f) => { try { return statSync(f).size < 400e3 ? readFileSync(f, 'utf8') : ''; } catch { return ''; } };
  const files = new Map(docs.map((f) => [f, read(f)]));
  for (const t of [...files.values()]) for (const m of t.matchAll(/(?:[A-Za-z]:\\|~[\\/])[^`*"'\n<>|]*?\.md\b/g)) { const f = m[0].replace(/^~/, os.homedir()); if (!files.has(f)) files.set(f, read(f)); }
  for (const [f, t] of files) for (const s of t.split(/\n|(?<=[.!?])\s+/)) { const g = ruleOf(s); if (g) note(g, { how: 'file', text: clauseOf(s, g), at: null, file: path.basename(f) }); }
  const undone = await rejected(p).catch(() => []), r = undone.length ? await needRepo(p).catch(() => null) : null;
  for (const u of r ? undone.slice(0, 20) : []) for (const t of u.tried.slice(0, 3)) {
    const added = (await git(r.root, ['show', '-U0', '--no-color', '--format=', t.sha, '--', ...UI]).catch(() => '')).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    for (const a of AVOID) if (added.some((l) => a.code.test(l))) note({ kind: 'avoid', id: a.id, label: a.label }, { how: 'undone', text: `${t.title} (undone by “${u.undone_by.title}”)`, at: u.undone_by.when });
  }
  // Something not to touch is only a rule here if it names something in this project's code.
  const code = await discover(p, 'now').catch(() => null);
  const names = (code?.components || []).map((x) => new Set([...words(x.file.replace(/[/\\._-]+/g, ' ')), ...words(x.name.replace(/([a-z])([A-Z])/g, '$1 $2'))].map(stemOf)));
  const inCode = (g) => g.kind !== 'protect' || names.some((n) => g.words.map(stemOf).filter((w) => n.has(w)).length >= Math.min(2, g.words.length));
  const list = [...ev.entries()].filter(([, x]) => (x.said.length >= 2 || x.said.some((s) => s.how === 'file')) && inCode(x.governs)).map(([key, x]) => ({ key, ...x, said: [...x.said.filter((s) => s.how === 'file').sort((m, n) => rank(m) - rank(n)), ...x.said.filter((s) => s.how !== 'file')] }));
  learned.set(p.id, { at: Date.now(), list });
  return list;
}
const learned = new Map();
// The part of a long line that says it: from the clause the look's word sits in, a little either side.
const clauseOf = (s, g) => {
  const t = s.replace(/[*_`]+/g, '').replace(/^[\s>|#-]+|[\s|]+$/g, '').trim(), m = g.kind === 'avoid' ? t.match(AVOID.find((a) => a.id === g.id).said) : null;
  if (!m || t.length <= 110) return t;
  const from = Math.max(0, ...['. ', '; ', ': ', ' | ', ' — ', '(', '“', '"'].map((x) => t.lastIndexOf(x, m.index) + x.length).filter((i) => i > 0 && i > m.index - 70));
  return `${from ? '…' : ''}${t.slice(from, m.index + 70).trim()}${m.index + 70 < t.length ? '…' : ''}`;
};
const rank = (s) => (/^(?:no|never|don'?t|do not|avoid)\b/i.test(s.text) ? 0 : 1000) + s.text.length; // the plainest way it was put: a sentence that starts with the no, short
const stemOf = (w) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''));
const asSaid = (t) => String(t || '').replace(/\s*\((?:you|Claude),[^)]*\)\s*$/, ''); // a suggestion's words without "(you, 28 Oct)"

// Decisions the chats hold, suggested once each for the person to confirm or dismiss (a dismissed one stays dismissed):
// the rules they set, what they kept when they said it was good, and the choices Claude made with a reason.
export async function suggestDecisions(p) {
  const c = await chatInsights(p).catch(() => null);
  if (!c) return 0;
  const have = new Set(all("SELECT source_id FROM decision WHERE project_id=? AND source_type='chat'", p.id).map((x) => x.source_id));
  const when = (at) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let n = 0;
  for (const x of [...c.rules.slice(0, 12), ...c.approvals.filter((a) => a.of).slice(0, 5), ...c.decisions.slice(0, 6)]) {
    const id = `${x.kind}|${x.session}|${x.at}`;
    if (have.has(id)) continue;
    const of = String(x.of || '').replace(/^(?:(?:Clean|Done|All done|Both done[^.]*|Committed[^.]*|Pushed[^.]*|Verified[^.]*)[.!:—–-]\s*)+/i, '').replace(/^(?:Here'?s what shipped|Summary)\s*[:—–-]?\s*/i, '');
    const text = x.kind === 'rule' ? `${said(x.text, 200)} (you, ${when(x.at)})` : x.kind === 'approval' ? `Keep: ${said(of, 170)} (you said “${said(x.text, 50)}”, ${when(x.at)})` : `${said(x.text, 200)} (Claude, ${when(x.at)})`;
    const g = x.kind === 'rule' ? ruleOf(x.text) : null; // a rule a check can hold the code to
    insert('decision', { id: uid('de'), project_id: p.id, text, source_type: 'chat', source_id: id, status: 'suggested', created_at: x.at || Date.now(), ...(g ? { governs: g } : {}) });
    n++;
  }
  for (const d of all("SELECT id, text FROM decision WHERE project_id=? AND source_type='chat' AND source_id LIKE 'rule|%' AND governs IS NULL", p.id)) { const g = ruleOf(asSaid(d.text)); if (g) update('decision', d.id, { governs: g }); } // suggested before rules could be checked
  const held = new Set(all("SELECT governs FROM decision WHERE project_id=? AND governs IS NOT NULL", p.id).map((d) => d.governs && /^(avoid|protect)$/.test(d.governs.kind) && ruleKey(d.governs)).filter(Boolean));
  for (const x of await learnRules(p, c)) {
    if (held.has(x.key)) continue;
    const first = x.said[0], times = x.said.length;
    const why = first.how === 'file' ? `your rules say so (“${said(first.text, 90)}”, ${first.file})` : `you said no to it ${times} times (“${said(first.text, 70)}”, ${when(first.at)})`;
    const text = x.governs.kind === 'avoid' ? `No ${x.governs.label} unless asked: ${why}` : `Don’t change ${x.governs.label} unless asked: ${why}`;
    insert('decision', { id: uid('de'), project_id: p.id, text, source_type: 'rule', source_id: `rule|${x.key}`, status: 'suggested', created_at: Date.now(), governs: x.governs });
    n++;
  }
  return n;
}
