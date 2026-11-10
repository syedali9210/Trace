// Thinking: the person's own reasons, in their words. "Why I made this change" answers tied to a change, thoughts
// dropped as they come, and the story they add up to. The story is told like a film: the problem is the villain and
// gets 30–40% of the telling (small at first, the world around it, how it grows), then the turn, then the hero (the
// solution, made for this villain), behind the scenes (what went wrong, the wrong calls and their fixes), how it fits
// the way people already work, and the business goal it moves. Trace asks and files; nothing here is written by a
// model, and a beat is only ever a suggestion the person can change.
import { all, get, run, insert, update, now, uid } from './db.js';

export const ACTS = [
  { id: 'villain', name: 'The villain', note: 'The problem. Give it 30–40% of the time.' },
  { id: 'turn', name: 'The turn', note: 'What you tried, and how your thinking changed.' },
  { id: 'hero', name: 'The hero', note: 'The solution, and what it took to build.' },
  { id: 'ending', name: 'Why it matters', note: 'Their day, and the business.' },
];

// share: the part of a talk this beat gets. The villain's three beats add up to 35.
export const BEATS = [
  { id: 'origin', act: 'villain', share: 10, name: 'Where the villain starts', hint: 'The problem while it was still small and easy to ignore.', ask: ['When did you first notice this problem? What did it look like while it was still small?', 'Who did it bother, and in what moment?'] },
  { id: 'world', act: 'villain', share: 12, name: 'The world around it', hint: 'Who lives with it, and what they do instead today.', ask: ['What did people do instead, before this existed?', 'What does their day look like around the problem?'] },
  { id: 'growth', act: 'villain', share: 13, name: 'How it grows', hint: 'Why it gets worse, and what it costs.', ask: ['What made the problem get worse over time?', 'What does it cost: time, money, trust? Any number you actually saw?'] },
  { id: 'turn', act: 'turn', share: 10, name: 'Character development', hint: 'What you tried first, and what changed in how you saw it.', ask: ['What did you try first, and why didn’t it work?', 'What changed in how you saw the problem?'] },
  { id: 'hero', act: 'hero', share: 25, name: 'The hero arrives', hint: 'The one idea that beats this villain, and why it fits.', ask: ['What is the one idea that beats the problem?', 'Why does it fit this problem better than the obvious fix?'] },
  { id: 'scenes', act: 'hero', share: 15, name: 'Behind the scenes', hint: 'What went wrong, the wrong calls, and how you fixed them.', ask: ['What went wrong while you were building it?', 'Which decision did you get wrong first, and what made you change it?'] },
  { id: 'workflow', act: 'ending', share: 7, name: 'Into their day', hint: 'How it fits the way people already work.', ask: ['Where does this sit in the way people already work? What don’t they have to change?'] },
  { id: 'business', act: 'ending', share: 8, name: 'The business win', hint: 'The goal it moves, and the number that would show it.', ask: ['Which business goal does this move?', 'What number would tell you it worked?'] },
];
const BEAT = Object.fromEntries(BEATS.map((b) => [b.id, b]));
export const isBeat = (b) => !!BEAT[b];

// A beat for a thought, by its words alone. Only a suggestion: the person picks the real one.
const CUES = [
  ['scenes', /\b(went wrong|wrong call|mistake|broke|broken|bug|reverted?|rolled back|undid|redo|redid|fix(ed)? it|should have|shouldn.t have|regret)\b/i],
  ['business', /\b(revenue|business|goal|metric|kpi|conversion|retention|churn|cost us|money|arpu|growth|sales|signups?)\b/i],
  ['workflow', /\b(workflow|their day|already (use|do|work)|habit|routine|fits (in|into)|without changing|daily|every day they)\b/i],
  ['turn', /\b(tried|first attempt|first version|changed my mind|realised|realized|turned out|instead i|pivot(ed)?|learned)\b/i],
  ['hero', /\b(the idea|solution|so i built|the bet|what if|decided to|i chose|we chose)\b/i],
  ['growth', /\b(worse|grows?|growing|piles? up|every time|keeps happening|more and more|cost(s|ing)? (me|us|them)|hours|wasted?)\b/i],
  ['world', /\b(people (do|use)|users?|they (do|use)|instead|workaround|today they|team(s)?|clients?)\b/i],
  ['origin', /\b(noticed|started when|first saw|annoying|problem|pain|frustrat\w*|stuck|confus\w*|couldn.t find|can.t find|hidden|pushing|pushed|buried)\b/i],
];
export const guessBeat = (text) => CUES.find(([, re]) => re.test(String(text || '')))?.[0] || null;

// "thought: …" from a chat: keep the words, drop the prefix.
export const clean = (text) => String(text || '').replace(/^\s*(thought|thinking|note to self)\s*[:\-–—]\s*/i, '').trim();

const row = (t) => {
  if (!t) return t;
  const m = t.moment_id ? get('SELECT id, title, end_ts FROM moment WHERE id=?', t.moment_id) : null;
  return { ...t, beat_name: BEAT[t.beat]?.name || null, change: m ? { id: m.id, title: m.title, at: m.end_ts } : null };
};

export function add(project_id, { text, kind, beat, moment_id, question, by = 'you', author }) {
  const body = clean(text).slice(0, 4000);
  if (!body) throw Object.assign(new Error('Write the thought first.'), { status: 400 });
  const m = moment_id ? get('SELECT id, project_id FROM moment WHERE id=?', moment_id) : null;
  if (moment_id && (!m || (m.project_id && m.project_id !== project_id))) throw Object.assign(new Error('That change isn’t in this project.'), { status: 400 });
  const t = {
    id: uid('th'), project_id, kind: kind === 'why' || m ? 'why' : 'thought', text: body,
    beat: isBeat(beat) ? beat : guessBeat(body), beat_by: isBeat(beat) ? by : 'rules', moment_id: m?.id || null,
    question: question ? String(question).slice(0, 400) : null, by, author: author || null, created_at: now(), updated_at: now(),
  };
  insert('thought', t);
  run('UPDATE project SET updated_at=? WHERE id=?', now(), project_id);
  return row(get('SELECT * FROM thought WHERE id=?', t.id));
}

export function edit(id, patch, by = 'you') {
  const t = get('SELECT * FROM thought WHERE id=?', id);
  if (!t) throw Object.assign(new Error('No such thought'), { status: 404 });
  const p = { updated_at: now() };
  if (patch.text !== undefined) { const body = clean(patch.text).slice(0, 4000); if (!body) throw Object.assign(new Error('A thought can’t be empty. Delete it instead.'), { status: 400 }); p.text = body; }
  if (patch.beat !== undefined) { p.beat = isBeat(patch.beat) ? patch.beat : null; p.beat_by = by; }
  update('thought', id, p);
  return row(get('SELECT * FROM thought WHERE id=?', id));
}

export const remove = (id) => run('DELETE FROM thought WHERE id=?', id);
export const list = (project_id) => all('SELECT * FROM thought WHERE project_id=? ORDER BY created_at DESC', project_id).map(row);

// Changes that don't have the person's "why" yet, newest first. A change an agent made still gets asked: the agent's
// reasons are in explain_changes, but why the person asked for it is theirs alone. Trace's guess (moment.why) is shown
// as a hint, never as the answer.
const OPEN_SQL = `FROM moment m WHERE m.project_id=? AND m.status='accepted' AND NOT EXISTS (SELECT 1 FROM thought t WHERE t.moment_id=m.id AND t.kind='why')`;
export function openWhys(project_id, limit = 5) {
  return all(`SELECT m.id, m.title, m.summary, m.why, m.agent, m.end_ts ${OPEN_SQL} ORDER BY m.end_ts DESC LIMIT ?`, project_id, limit)
    .map((m) => ({ id: m.id, title: m.title, summary: m.summary, at: m.end_ts, agent: m.agent || null, guess: m.why || null,
      question: m.agent ? `Why did you ask for “${m.title}”? What were you trying to fix?` : `Why did you make this change: “${m.title}”? Why this way, and not another?` }));
}
const countOpen = (project_id) => get(`SELECT COUNT(*) n ${OPEN_SQL}`, project_id).n;

// The reminder: changes waiting for a why, and how long since the last thought.
export function nudge(project_id) {
  const open = countOpen(project_id);
  const last = get('SELECT MAX(created_at) at FROM thought WHERE project_id=?', project_id)?.at || null;
  const days = last ? Math.floor((now() - last) / 86400000) : null;
  const quiet = last === null || days >= 3;
  const parts = [];
  if (open) parts.push(`${open === 1 ? '1 change is' : `${open} changes are`} waiting for your why`);
  if (quiet) parts.push(last === null ? 'no thoughts dropped yet' : `no thought for ${days} days`);
  return { open, last_thought_at: last, quiet, text: parts.length ? `${parts.join(', and ')}. Drop what you were thinking while it’s fresh.` : null };
}

// Minutes for a beat in a talk of `minutes`, to the half minute.
const mins = (minutes, share) => Math.max(0.5, Math.round((minutes * share) / 50) / 2);

export function story(p, minutes = 10) {
  const ts = list(p.id);
  const beats = BEATS.map((b) => {
    const items = ts.filter((t) => t.beat === b.id).reverse(); // oldest first: a beat reads in the order you thought it
    return { ...b, minutes: mins(minutes, b.share), items, open: items.length ? null : b.ask[0] };
  });
  const filled = beats.filter((b) => b.items.length).length;
  const villain = beats.filter((b) => b.act === 'villain');
  return {
    minutes, acts: ACTS.map((a) => ({ ...a, share: BEATS.filter((b) => b.act === a.id).reduce((s, b) => s + b.share, 0) })),
    beats, filled, of: BEATS.length, unsorted: ts.filter((t) => !t.beat).length,
    villain_ready: villain.every((b) => b.items.length),
    tip: villain.some((b) => !b.items.length) ? 'Build the villain first: the problem gets 30–40% of the story, and the hero only lands if the villain felt real.' : null,
  };
}

// The view in one call: what's open, what you wrote, the story, the reminder.
export function view(p, minutes) {
  const s = story(p, minutes);
  return {
    thoughts: list(p.id), open_whys: openWhys(p.id), nudge: nudge(p.id), story: s,
    questions: [...openWhys(p.id, 3).map((w) => ({ kind: 'why', moment_id: w.id, question: w.question })), ...s.beats.filter((b) => b.open).slice(0, 3).map((b) => ({ kind: 'story', beat: b.id, question: b.open }))],
  };
}

export function markdown(p, minutes = 10) {
  const s = story(p, minutes);
  const out = [`# ${p.name}: the story`, '', `A ${minutes}-minute telling. The problem is the villain and gets ${s.acts[0].share}% of the time; the solution is the hero.`, ''];
  for (const a of s.acts) {
    out.push(`## ${a.name} · ${a.share}%`, '', `_${a.note}_`, '');
    for (const b of s.beats.filter((x) => x.act === a.id)) {
      out.push(`### ${b.name} (about ${b.minutes} min)`, '', `_${b.hint}_`, '');
      if (b.items.length) for (const t of b.items) out.push(`- ${t.text}${t.change ? ` _(on “${t.change.title}”)_` : ''}`);
      else out.push(`- Open: ${b.open}`);
      out.push('');
    }
  }
  return out.join('\n');
}
