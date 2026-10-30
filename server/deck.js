// A deck from the real work, told as a story. It reads everything Trace knows about the project and keeps only what
// it can show: the versions in git and what each was asked for, the chats (what the person asked for, said no to and
// liked, the causes Claude found, the results in numbers; chats.js), the screens the walk pictured, the person's own
// screenshots from the chats, decisions, what was tried and undone, and what still needs a look. Each template is an
// arc (case study, design review, client update); each slide uses the layout that suits what it says (a statement,
// numbers, the person's words, before and now, screens, a timeline, a list); a slide with nothing true to say is left
// out. Every slide's sources are in its notes. The accent is the app's own colour. Editable, and exported as PPTX.
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import { all, get, now, uid } from './db.js';
import { filePath, storeFile } from './media.js';
import { history } from './history.js';
import { screens } from './screens.js';
import { chatInsights, said } from './chats.js';
import { noList, queue, usedOf, oklab, hex } from './check.js';

export const TEMPLATES = { 'case-study': 'Case study', 'design-review': 'Design review', 'client-update': 'Client update' };
const fmt = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const day = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const short = (t, n = 160) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s; };
const gist = (t) => { const x = String(t || ''); const fb = x.match(/\*\*(?:Feedback|Comment):?\*\*:?\s*(.+)/i)?.[1]; return short((fb || x.split('\n').map((l) => l.trim()).find((l) => l && !/^(#|\[|\*\*|<|```)/.test(l)) || '').replace(/\[pointed at an element on the page\]\s*/g, ''), 140); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const CHORE = /^\W*(?:(?:please|now|ok|okay|just|bro|so)[,\s]+)*(?:(?:git\s+)?(?:push|commit|pull|merge)\b|continue\b|go ahead\b|keep going\b|resume\b|i hit my usage limit)/i; // saving or resuming, not an ask
const asking = (t) => (t && !CHORE.test(t) && !PROFANE.test(t) ? t : null); // an ask worth quoting on a slide
const PROFANE = /\b(?:fuck\w*|shit\w*|wtf|crap\w*|bullshit|ass(?:hole)?)\b/i; // his words are quoted as said, so a deck picks another

// A screen's top, as a window shows it (a walked screen is pictured whole: thousands of pixels long).
const crops = new Map();
async function top(key, ratio = 0.625) {
  if (!key) return null;
  if (crops.has(key)) return crops.get(key);
  try { const m = await sharp(filePath(key), { limitInputPixels: false }).metadata(); const h = Math.min(m.height, Math.round(m.width * ratio)); const buf = await sharp(filePath(key), { limitInputPixels: false }).extract({ left: 0, top: 0, width: m.width, height: h }).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 86 }).toBuffer(); const k = storeFile(buf, 'webp'); crops.set(key, k); return k; } catch { return null; }
}
// The app's own colour: the most drawn colour that is a colour (not a grey).
function accent(list) {
  const c = usedOf(list).filter((e) => e.kind === 'colour').map((e) => ({ e, o: oklab(e.value) })).filter((x) => x.o && x.o.alpha > 0.9 && Math.hypot(x.o.v[1], x.o.v[2]) > 6 && x.o.v[0] > 25 && x.o.v[0] < 85).sort((a, b) => b.e.n - a.e.n)[0];
  return c ? hex(c.e.value).slice(1, 7).toUpperCase() : '111113';
}
// "from 26.9 MB to 9.8 MB" / "144 → 19 fps" as two big numbers and what they measure.
export function stat(text) {
  const n = '(\\d[\\d.]*(?:,\\d{3})*\\s?(?:–\\s?\\d[\\d.]*\\s?)?(?:(?:ms|s|sec|min|minutes|px|MB|KB|GB|fps)\\b|%|×)?)';
  const m = text.match(new RegExp(`from (?:about )?${n} to (?:about )?${n}`, 'i')) || text.match(new RegExp(`${n}\\s*(?:→|->)\\s*${n}`));
  if (!m || /\b(?:dropped|fell|slowed|regressed|broke)\b[^.]*\b(?:fixed|fixes)\b/i.test(text)) return null; // the size of the problem a fix removed, not what changed
  const label = short(text.replace(m[0], '…').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), 90);
  const a = m[1].trim(), b = m[2].trim(), unit = /[a-z%×]/i.test(a + b), big = /(?:ms|s|sec|min|minutes|MB|KB|GB|fps|%|×)$/i.test(b);
  if (!unit && (parseFloat(a) < 10 && parseFloat(b) < 10)) return null; // 0 → 1, 5 → 8: a setting, not a result
  return { from: a, to: b, label, weight: big ? 2 : unit ? 1 : 0 };
}

export async function buildDeck({ project_id, template = 'case-study', from, to, title }) {
  const p = get('SELECT * FROM project WHERE id=?', project_id);
  if (!TEMPLATES[template]) template = 'case-study';
  const lo = from || 0, hi = to || now(), inR = (t) => t >= lo && t <= hi;
  const [h, chats, no, q] = await Promise.all([history(p).catch(() => ({ versions: [] })), chatInsights(p).catch(() => null), noList(p).catch(() => ({ versions: [], values: [] })), queue(p, 'now').catch(() => null)]);
  const versions = (h.versions || []).filter((v) => inR(v.when)).reverse();
  const ins = (chats?.insights || []).filter((x) => inR(x.at));
  const by = (k, n) => ins.filter((x) => x.kind === k).slice(0, n);
  const walk = screens(p, 'now'), list = walk.screens || [];
  const moments = all("SELECT * FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL AND end_ts BETWEEN ? AND ? ORDER BY end_ts LIMIT 60", project_id, lo, hi);
  const decisions = all("SELECT text FROM decision WHERE project_id=? AND status='confirmed' AND source_type != 'check' ORDER BY created_at DESC LIMIT 8", project_id);
  const issues = all("SELECT title FROM issue WHERE project_id=? AND status IN ('open','in_progress') LIMIT 6", project_id);
  if (!versions.length && !ins.length && !moments.length) throw Object.assign(new Error('Nothing in that range: no versions, chats or accepted changes. Widen the dates.'), { status: 400 });
  const span = [versions[0]?.when, ins.length ? Math.min(...ins.map((x) => x.at)) : null, moments[0]?.start_ts].filter(Boolean), end = [versions.at(-1)?.when, chats?.to, moments.at(-1)?.end_ts].filter(Boolean);
  const range = span.length ? `${fmt(Math.max(lo, Math.min(...span)))} – ${fmt(Math.min(hi, Math.max(...end)))}` : '';
  // The person's screenshots from the chats, by the time of the ask they came with.
  const pics = new Map();
  for (const r of all("SELECT c.ts, c.meta FROM memory_chunk c JOIN memory_doc d ON d.id=c.doc_id WHERE d.project_id=? AND c.role='exchange' AND c.meta LIKE '%image_key%'", project_id)) { try { const m = typeof r.meta === 'string' ? JSON.parse(r.meta) : r.meta; if (m?.images?.length) pics.set(r.ts, m.images); } catch {} }
  const picOf = (at) => { for (const [ts, im] of pics) if (Math.abs(ts - at) < 2000) return im[0]; return null; };
  // The walked screen that draws the files an insight names (its components live there), else the first.
  const screenFor = (files = []) => list.find((s) => files.some((f) => { const n = f.split('/').pop().replace(/\.[jt]sx?$/, ''); return s.tree?.some((t) => t.n === n); })) || null;
  const pages = []; for (const s of list) if (!s.fp?.layer && !pages.some((x) => (x.fp?.path || x.name) === (s.fp?.path || s.name) || (s.group && x.group?.id === s.group.id))) pages.push(s); // each page's first screen (the home first), one per row of options, not its dialogs // a page's first screen (the home first), not its dialogs
  const shotOf = async (s, caption) => { const k = await top(s?.shot); return k && { key: k, caption: caption ?? s.name }; };
  const cover = await shotOf(pages[0] || list[0], '');
  const asks = chats?.asks || 0, ink = accent(list);

  const S = []; // the slides, each with its sources in its notes
  const add = (s) => s && S.push({ notes: '', images: [], ...s });
  const counts = [versions.length && plural(versions.length, 'version'), asks && plural(asks, 'ask'), chats?.sessions && plural(chats.sessions, 'chat'), list.length && plural(list.length, 'screen')].filter(Boolean).join(' · ');
  add({ kind: 'title', title: p.name, body: `${TEMPLATES[template]}${range ? ` · ${range}` : ''}`, images: cover ? [cover] : [], notes: counts });

  const brief = (p.brief || '').split('\n').map((l) => l.replace(/^goal:\s*/i, '').trim()).find(Boolean);
  const themes = (chats?.themes || []).slice(0, 6).map((t) => t.word);
  const loudest = [...ins.filter((x) => (x.kind === 'correction' || x.kind === 'rule') && !PROFANE.test(x.text))].sort((a, b) => b.score - a.score);
  const clean = (k, n) => ins.filter((x) => x.kind === k && !PROFANE.test(x.text)).slice(0, n);
  const corrections = clean('correction', 6), approvals = clean('approval', 8).filter((x) => x.of && !/^(?:you'?re right|i can|here are|would you|do you|should i|want me)/i.test(x.of)).slice(0, 4), rules = clean('rule', 5), causes = clean('cause', 5); // approvals: a yes to something made, not to a reply
  const stats = by('result', 20).map((x) => ({ ...stat(x.text), x })).filter((x) => x.from).sort((a, b) => b.weight - a.weight).slice(0, 4);
  const big = [...versions].sort((a, b) => b.add + b.del - (a.add + a.del)).slice(0, 6).sort((a, b) => a.when - b.when);
  const undone = (no.versions || []).filter((v) => inR(v.undone_by.when)).slice(0, 4);
  const open = (q?.items || []).slice(0, 5);
  const ev = (x) => `${x.kind} · ${x.session || 'chat'} · ${day(x.at)}: “${x.text}”`;

  const slide = {
    brief: () => (brief || themes.length) && { kind: 'statement', title: brief ? 'What it set out to do' : 'What it kept coming back to', body: brief || themes.join(' · '), label: counts, notes: brief ? 'From the project brief.' : `Words that came up in ${themes.length ? 'most' : ''} chats: ${themes.join(', ')}.` },
    problem: async () => { const x = corrections[0] || loudest[0]; if (!x) return null; const im = picOf(x.at); return { kind: 'quote', title: 'The problem, in your words', quote: said(x.text, 260), by: `You, ${day(x.at)}`, of: x.of ? `After: “${short(x.of, 140)}”` : '', images: im ? [{ key: im.image_key || im.file_key, caption: 'Your screenshot' }] : [], notes: ev(x) }; },
    timeline: () => { const d = chats?.days || []; if (d.length < 2) return null; const step = Math.max(1, Math.ceil(d.length / 7)); const pts = d.filter((_, i) => i % step === 0 || i === d.length - 1).slice(0, 8); return { kind: 'timeline', title: 'How it went', points: pts.map((x) => ({ date: day(Date.parse(x.day)), n: x.asks, text: said(gist(x.top), 110) })), notes: `${d.length} days with chats; each point is that day's longest ask.` }; },
    tried: () => { const items = [...undone.map((v) => (v.tried[0] ? `Tried “${short(v.tried[0].title, 70)}”, undone: “${gist(v.undone_by.asked) || short(v.undone_by.title, 70)}”` : `Undone: “${short(v.undone_by.title, 90)}”`)), ...corrections.slice(0, 5 - Math.min(2, undone.length)).map((x) => `“${said(x.text, 110)}”`)].slice(0, 5); return items.length && { kind: 'list', title: 'What didn’t work', body: items.map((t) => `• ${t}`).join('\n'), notes: [...undone.map((v) => `undone · ${v.undone_by.sha} ${v.undone_by.title}`), ...corrections.map(ev)].join('\n') }; },
    beforeafter: async () => { const x = corrections.find((c) => picOf(c.at)); if (!x) return null; const im = picOf(x.at), s = screenFor(x.files) || pages[0]; const now_ = await shotOf(s, `Now · ${s?.name || ''}`); return now_ && { kind: 'beforeafter', title: said(x.text, 90), images: [{ key: im.image_key || im.file_key, caption: `Before · your screenshot, ${day(x.at)}` }, now_], notes: ev(x) }; },
    worked: () => approvals.length && { kind: 'list', title: 'What worked', body: approvals.map((x) => `• ${x.of ? `${short(x.of, 100)} → ` : ''}“${said(x.text, 60)}”`).join('\n'), notes: approvals.map(ev).join('\n') },
    found: () => causes.length && { kind: 'list', title: 'Why things broke', body: causes.map((x) => `• ${short(x.text, 150)}`).join('\n'), notes: causes.map((x) => `${ev(x)}${x.reasoning ? ' (from Claude’s reasoning)' : ''}${x.files?.length ? ` · ${x.files.join(', ')}` : ''}`).join('\n') },
    numbers: () => (stats.some((x) => x.weight === 2) || stats.length >= 2) && { kind: 'stats', title: 'By the numbers', stats: stats.map(({ from: a, to: b, label }) => ({ from: a, to: b, label })), notes: stats.map((s) => ev(s.x)).join('\n') },
    rules: () => { const items = [...rules.map((x) => said(x.text, 120)), ...decisions.map((d) => short(d.text, 120))].slice(0, 6); return items.length && { kind: 'list', title: 'What it follows now', body: items.map((t) => `• ${t}`).join('\n'), notes: [...rules.map(ev), ...decisions.map((d) => `decision · ${d.text}`)].join('\n') }; },
    changed: () => big.length && { kind: 'list', title: 'What changed', body: big.map((v) => `• ${short(v.title, 90)}${asking(v.asked) ? `: “${gist(v.asked)}”` : ''}`).join('\n'), notes: big.map((v) => `${v.short} · ${day(v.when)} · ${v.agent || v.who} · +${v.add} −${v.del}`).join('\n') },
    screens: async () => { const picks = (await Promise.all(pages.slice(0, 4).map((s) => shotOf(s)))).filter(Boolean); return picks.length && { kind: 'screens', title: 'Where it stands', images: picks, notes: `The running app, walked ${walk.at ? day(walk.at) : ''}: ${pages.slice(0, 4).map((s) => s.name).join(', ')}.` }; },
    next: () => { const items = [...open.map((x) => x.title), ...issues.map((i) => i.title)].slice(0, 6); return items.length && { kind: 'list', title: 'What’s next', body: items.map((t) => `• ${short(t, 110)}`).join('\n'), notes: open.map((x) => `${x.kind} · ${x.title}`).join('\n') }; },
    made: () => { const m = (chats?.made || []).filter((x) => inR(x.at)).slice(0, 6); if (!m.length) return null;
      const pics = m.filter((x) => x.asset).map((x) => ({ key: get('SELECT s.image_key FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.id=?', x.asset)?.image_key, caption: x.label })).filter((x) => x.key).slice(0, 2); // the captured file's picture
      return { kind: 'list', title: 'What came out of it', body: m.map((x) => `• ${short(x.label, 60)}${asking(x.asked) ? `: for “${said(x.asked, 90)}”` : ''}`).join('\n'), images: pics, notes: m.map((x) => `${x.path} · ${day(x.at)} · ${x.session}`).join('\n') }; },
    period: () => ({ kind: 'stats', title: 'This period', stats: [versions.length && { from: '', to: String(versions.length), label: 'versions saved' }, asks && { from: '', to: String(asks), label: 'asks in the chats' }, list.length && { from: '', to: String(list.length), label: 'screens walked' }].filter(Boolean), notes: counts }),
    moments: () => moments.length > 1 && { kind: 'list', title: 'The iterations', body: [...moments].sort((a, b) => b.magnitude - a.magnitude).slice(0, 5).map((m) => `• ${short(m.title, 90)}`).join('\n'), moment_ids: moments.slice(0, 5).map((m) => m.id), notes: 'From the timeline’s accepted changes.' },
  };
  const ARC = {
    'case-study': ['brief', 'problem', 'timeline', 'tried', 'beforeafter', 'found', 'numbers', 'made', 'rules', 'moments', 'screens', 'next'],
    'design-review': ['brief', 'screens', 'beforeafter', 'tried', 'worked', 'found', 'rules', 'next'],
    'client-update': ['period', 'changed', 'made', 'screens', 'numbers', 'worked', 'next'],
  };
  for (const k of ARC[template]) add(await slide[k]());
  const slides = S.map((s) => ({ id: uid('sl'), ...s }));
  return { id: uid('dk'), project_id, title: title || `${p.name} · ${TEMPLATES[template]}`, template, accent: ink, range: { from: lo, to: hi }, slides, created_at: now(), updated_at: now() };
}

// 13.33 × 7.5 in slides, one layout per kind. Pictures are fitted inside their box, never stretched.
const FONT = 'Arial', INK = '111113', MUTED = '6B6B72', BODY = '3F3F46';
async function picture(slide, key, box, caption) {
  try {
    const buf = await sharp(filePath(key), { limitInputPixels: false }).resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const m = await sharp(buf).metadata(), room = caption ? 0.34 : 0, k = Math.min(box.w / m.width, (box.h - room) / m.height), w = m.width * k, h = m.height * k;
    const x = box.x + (box.w - w) / 2;
    slide.addImage({ data: `image/png;base64,${buf.toString('base64')}`, x, y: box.y, w, h });
    slide.addShape('rect', { x, y: box.y, w, h, line: { color: 'E4E4E7', width: 0.75 }, fill: { type: 'none' } });
    if (caption) slide.addText(caption, { x: box.x, y: box.y + h + 0.06, w: box.w, h: 0.28, fontFace: FONT, fontSize: 11, color: MUTED, align: 'center' });
  } catch {}
}
export async function pptx(deck) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = deck.title;
  const A = deck.accent || INK;
  for (const s of deck.slides) {
    const sl = pres.addSlide();
    const dark = s.kind === 'title';
    sl.background = { color: dark ? '111113' : 'FFFFFF' };
    const heading = (y = 0.55, w = 12.1) => sl.addText(s.title || '', { x: 0.6, y, w, h: 0.9, fontFace: FONT, fontSize: 26, bold: true, color: INK });
    if (s.notes) sl.addNotes(s.notes);
    if (s.kind === 'title') {
      const img = s.images?.[0];
      sl.addText(s.title || '', { x: 0.6, y: 2.4, w: img ? 5.6 : 12, h: 1.4, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF' });
      sl.addShape('rect', { x: 0.62, y: 3.85, w: 0.6, h: 0.06, fill: { color: A === INK ? 'FFFFFF' : A }, line: { color: A === INK ? 'FFFFFF' : A } });
      if (s.body) sl.addText(s.body, { x: 0.6, y: 4.05, w: img ? 5.6 : 12, h: 0.6, fontFace: FONT, fontSize: 18, color: 'B4B4BA' });
      if (s.notes) sl.addText(s.notes, { x: 0.6, y: 6.5, w: 6, h: 0.4, fontFace: FONT, fontSize: 12, color: '8A8A92' });
      if (img) await picture(sl, img.key, { x: 6.7, y: 1.1, w: 6.1, h: 5.4 });
    } else if (s.kind === 'statement') {
      if (s.label) sl.addText(s.label.toUpperCase(), { x: 0.6, y: 0.7, w: 12, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: A === INK ? MUTED : A, charSpacing: 2 });
      sl.addText(s.title || '', { x: 0.6, y: 1.3, w: 12, h: 0.6, fontFace: FONT, fontSize: 18, color: MUTED });
      sl.addText(s.body || '', { x: 0.6, y: 2.0, w: 11.6, h: 4.4, fontFace: FONT, fontSize: 34, bold: true, color: INK, valign: 'top' });
    } else if (s.kind === 'stats') {
      heading();
      const st = (s.stats || []).slice(0, 4), w = (12.1 - (st.length - 1) * 0.3) / Math.max(1, st.length);
      st.forEach((x, i) => {
        const X = 0.6 + i * (w + 0.3);
        sl.addShape('roundRect', { x: X, y: 1.9, w, h: 4.4, rectRadius: 0.12, fill: { color: 'F6F6F7' }, line: { color: 'F6F6F7' } });
        if (x.from) sl.addText(x.from, { x: X + 0.3, y: 2.2, w: w - 0.6, h: 0.7, fontFace: FONT, fontSize: 22, color: MUTED, strike: 'sngStrike' });
        sl.addText(x.to, { x: X + 0.3, y: x.from ? 2.9 : 2.5, w: w - 0.6, h: 1.3, fontFace: FONT, fontSize: st.length > 2 ? 40 : 54, bold: true, color: A });
        sl.addText(x.label || '', { x: X + 0.3, y: 4.3, w: w - 0.6, h: 1.8, fontFace: FONT, fontSize: 14, color: BODY, valign: 'top' });
      });
    } else if (s.kind === 'quote') {
      const img = s.images?.[0], w = img ? 6.4 : 11.6;
      sl.addText(s.title || '', { x: 0.6, y: 0.55, w: 12, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: A === INK ? MUTED : A });
      sl.addText('“', { x: 0.5, y: 1.0, w: 1, h: 1.2, fontFace: 'Georgia', fontSize: 80, color: A === INK ? 'D4D4D8' : A });
      sl.addText(s.quote || '', { x: 0.6, y: 1.9, w, h: 3.4, fontFace: FONT, fontSize: 24, color: INK, valign: 'top' });
      sl.addText(s.by || '', { x: 0.6, y: 5.4, w, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: BODY });
      if (s.of) sl.addText(s.of, { x: 0.6, y: 5.85, w, h: 0.9, fontFace: FONT, fontSize: 12, color: MUTED, valign: 'top' });
      if (img) await picture(sl, img.key, { x: 7.4, y: 1.0, w: 5.4, h: 5.6 }, img.caption);
    } else if (s.kind === 'beforeafter' || s.kind === 'screens') {
      heading(0.5);
      const imgs = (s.images || []).slice(0, 4), n = imgs.length, w = (12.1 - (n - 1) * 0.3) / Math.max(1, n);
      for (let i = 0; i < n; i++) await picture(sl, imgs[i].key, { x: 0.6 + i * (w + 0.3), y: 1.6, w, h: 5.4 }, imgs[i].caption);
    } else if (s.kind === 'timeline') {
      heading();
      const pts = (s.points || []).slice(0, 8), n = pts.length, step = 12.1 / Math.max(1, n);
      sl.addShape('line', { x: 0.6, y: 3.0, w: 12.1, h: 0, line: { color: 'D4D4D8', width: 1.5 } });
      pts.forEach((pt, i) => {
        const X = 0.6 + i * step;
        sl.addShape('ellipse', { x: X, y: 2.88, w: 0.24, h: 0.24, fill: { color: A }, line: { color: A } });
        sl.addText(pt.date, { x: X - 0.05, y: 2.3, w: step, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: INK });
        sl.addText(`${plural(pt.n, 'ask')}`, { x: X - 0.05, y: 3.25, w: step, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED });
        sl.addText(pt.text || '', { x: X - 0.05, y: 3.6, w: step - 0.15, h: 3, fontFace: FONT, fontSize: 10.5, color: BODY, valign: 'top' });
      });
    } else { // a list, with pictures on the right when it has them
      const imgs = (s.images || []).slice(0, 4), textW = imgs.length ? 5.6 : 12.1;
      heading(0.55, textW);
      if (s.body) sl.addText(s.body, { x: 0.6, y: 1.6, w: textW, h: 5.3, fontFace: FONT, fontSize: 16, color: BODY, valign: 'top', paraSpaceAfter: 10 });
      for (let i = 0; i < imgs.length; i++) await picture(sl, imgs[i].key, { x: 6.6, y: 0.7 + i * (6.2 / imgs.length), w: 6.2, h: 6.2 / imgs.length - 0.2 }, imgs[i].caption);
    }
  }
  return pres.write({ outputType: 'nodebuffer' });
}
