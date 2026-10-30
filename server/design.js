// The design canvas: the project's working copy running on its own dev server, opened through a small proxy that adds
// design-page.js to its pages, so a person can pick anything on screen and change how it's drawn, Figma-style, and see
// it at once. Each change is kept as an edit with where it lives in the code (file and line, from its classes and its
// component) and the code change it needs (Tailwind classes when the element uses them, else CSS). Claude Code takes
// the edits (MCP get_design_changes, `trace changes`) and writes them; the dev server reloads and the canvas shows the
// code's own result. Beside it, what the person and Claude are saying and reasoning in the session right now, and
// Trace's AI (the person's own key) answering with all of that as context.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DATA, all, uid } from './db.js';
import { SECRET } from './folders.js';
import { liveFor, startLive, needRepo, git } from './history.js';
import { discover } from './frames.js';
import { hex, oklab } from './check.js';
import { projectDirs } from './casestudy.js';
import * as AI from './ai.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const PAGE = path.join(import.meta.dirname, 'design-page.js');

// ---- the proxy: the app as it runs, with the canvas script added to each page and its hot reload passed through ----
const proxies = new Map(); // project → { server, port, target }
async function proxyFor(pid, target, origin) {
  const was = proxies.get(pid);
  if (was?.target === target) return was;
  was?.server.close();
  const t = new URL(target);
  const fix = (h) => { const o = { ...h, host: t.host }; if (o.origin) o.origin = t.origin; if (o.referer) o.referer = o.referer.replace(/^https?:\/\/[^/]+/, t.origin); return o; }; // the dev server sees its own address
  const server = http.createServer((req, res) => {
    if (req.url === '/__trace_design.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); return res.end(readFileSync(PAGE)); }
    const headers = fix(req.headers);
    delete headers['accept-encoding']; // plain bytes, so a page can have the script added
    const up = http.request({ hostname: t.hostname, port: t.port, path: req.url, method: req.method, headers }, (r) => {
      if (!/text\/html/i.test(r.headers['content-type'] || '')) { res.writeHead(r.statusCode, r.headers); return r.pipe(res); }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const tag = `<script src="/__trace_design.js" data-trace="${origin}"></script>`;
        let html = Buffer.concat(chunks).toString('utf8');
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
        const h = { ...r.headers };
        delete h['content-length']; delete h['content-security-policy']; delete h['x-frame-options']; // it's shown inside Trace
        res.writeHead(r.statusCode, h);
        res.end(html);
      });
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('The app stopped answering. Start it again in Trace.'); });
    req.pipe(up);
  });
  server.on('upgrade', (req, sock, head) => { // the dev server's hot reload
    const up = net.connect(+t.port || 80, t.hostname, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(fix(req.headers)).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`)).join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    up.on('error', () => sock.destroy());
    sock.on('error', () => up.destroy());
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const px = { server, port: server.address().port, target };
  proxies.set(pid, px);
  return px;
}
export function stopDesign(pid) { proxies.get(pid)?.server.close(); proxies.delete(pid); }

// The canvas for a project: its working copy running (started if it isn't), through the proxy.
export async function design(p, origin, { start = false } = {}) {
  let lv = liveFor(p.id).find((x) => x.sha === 'now');
  if (start && (!lv || lv.status === 'failed')) lv = await startLive(p, 'now');
  if (lv?.status !== 'ready') return { status: lv?.status || 'stopped', error: lv?.error || null, edits: editsOf(p.id) };
  const target = lv.url.startsWith('/') ? `${origin}${lv.url}` : lv.url;
  const px = await proxyFor(p.id, target, origin);
  return { status: 'ready', url: `http://127.0.0.1:${px.port}${new URL(target).pathname}${new URL(target).search}`, edits: editsOf(p.id) };
}

// ---- the edits: what was changed on the canvas, where it lives in the code, and the code it needs ----
const fileOf = (pid) => path.join(DATA, 'design', `${pid}.json`);
export const editsOf = (pid) => { try { return JSON.parse(readFileSync(fileOf(pid), 'utf8')).edits || []; } catch { return []; } };
const save = (pid, edits) => { mkdirSync(path.dirname(fileOf(pid)), { recursive: true }); writeFileSync(fileOf(pid), JSON.stringify({ edits })); return edits; };

const UI = ['*.tsx', '*.jsx', '*.ts', '*.js', '*.vue', '*.svelte', '*.html', '*.astro'];
const bare = (c) => c.replace(/^(?:[\w-]+:)+/, ''); // "md:hover:px-4" is px-4
// Where an element lives in the code: its class string exactly, if it's written once; else the line of its component's
// file most like it (its classes, its text, its tag).
export async function locate(p, el) {
  const r = await needRepo(p);
  const cls = String(el.cls || '').trim().replace(/\s+/g, ' ');
  const code = await discover(p, 'now').catch(() => null);
  const chain = [...new Set([el.comp, ...(Array.isArray(el.chain) ? el.chain : [])].filter(Boolean))].slice(0, 8); // nearest first
  const files = [...new Set(chain.flatMap((n) => (code?.components || []).filter((c) => c.name === n).map((c) => c.file)))];
  if (cls.length >= 8) {
    const hits = (await git(r.root, ['grep', '-n', '-F', '-e', cls, '--', ...UI]).catch(() => '')).split('\n').filter(Boolean).map((h) => { const m = h.match(/^(.+?):(\d+):(.*)$/); return m && { file: m[1], line: +m[2], code: m[3].trim().slice(0, 240) }; }).filter(Boolean);
    const hit = hits.length === 1 ? hits[0] : hits.find((h) => files.includes(h.file));
    if (hit) return { ...hit, by: 'classes' };
  }
  const want = cls.split(' ').map(bare).filter((c) => c.length > 1), text = el.own && el.text ? el.text.slice(0, 24) : '';
  let best = null;
  for (const f of files) {
    let lines; try { lines = readFileSync(path.join(r.root, f), 'utf8').split('\n'); } catch { continue; }
    lines.forEach((l, i) => {
      const words = new Set(l.split(/[\s"'`{}()[\],]+/).map(bare));
      const sc = want.filter((c) => words.has(c)).length + (text && l.includes(text) ? 3 : 0) + (l.includes(`<${el.tag}`) ? 1 : 0);
      if (sc > (best?.sc || 0)) best = { file: f, line: i + 1, code: l.trim().slice(0, 240), sc };
    });
  }
  if (best && best.sc >= 2) { const { sc, ...b } = best; return { ...b, by: 'component' }; }
  return files[0] ? { file: files[0], line: null, code: null, by: 'component' } : null;
}

// The code a property change needs. When the element is drawn with Tailwind: the class that gives the new value and
// the ones of the same kind it replaces (a project colour token by name when one matches); else the CSS.
const SPACE = { 'padding-top': ['pt', 'py', 'p'], 'padding-bottom': ['pb', 'py', 'p'], 'padding-left': ['pl', 'px', 'p'], 'padding-right': ['pr', 'px', 'p'], 'margin-top': ['mt', 'my', 'm'], 'margin-bottom': ['mb', 'my', 'm'], 'margin-left': ['ml', 'mx', 'm'], 'margin-right': ['mr', 'mx', 'm'], gap: ['gap'], width: ['w'], height: ['h'] };
const SIZE = { 12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl', 72: '7xl', 96: '8xl', 128: '9xl' };
const WEIGHT = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
const RADIUS = { 0: 'none', 2: 'xs', 4: 'sm', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl' };
const TW = /^-?(?:p[trblxy]?|m[trblxy]?|gap(?:-[xy])?|[wh]|size|min-[wh]|max-[wh]|text|font|leading|tracking|rounded(?:-[trblse]{1,2})?|bg|border(?:-[trblxy])?|flex|grid|items|justify|self|place|inset|top|left|right|bottom|z|opacity|shadow|ring|space-[xy]|overflow|cursor|transition|duration|ease|translate-[xy]|scale|rotate|aspect|object|whitespace|line-clamp|underline|decoration|outline|backdrop|blur|col-span|row-span)-|^(?:flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|truncate|uppercase|italic)$/; // Tailwind's own prefixes: "nav-link" isn't one
const TEXT_SIZE = /^text-(?:xs|sm|base|lg|\d?xl|\[[\d.]+(?:px|rem)\])$/, TEXT_ALIGN = /^text-(?:left|center|right|justify|start|end)$/;
export function codeFor(prop, value, cls = '', tokens = [], rem = 16) { // rem: the page's 1rem in px (Tailwind's scale is in rem)
  const css = `${prop}: ${value}`, mine = String(cls).split(/\s+/).filter(Boolean);
  const of = (re) => mine.filter((c) => re.test(bare(c)));
  if (!mine.some((c) => TW.test(bare(c)))) return { css }; // not drawn with utility classes
  const px = parseFloat(value), whole = Number.isFinite(px) && Math.abs(px - Math.round(px)) < 0.01;
  const units = px / (rem / 4), at16 = Math.round((px * 16) / rem * 100) / 100; // in Tailwind's spacing steps; as px at a 16px rem
  const len = (pre) => (whole && Number.isInteger(units * 2) ? `${pre}-${units}` : `${pre}-[${+px.toFixed(2)}px]`);
  const colour = (pre) => {
    const h = hex(value), c = oklab(value);
    if (!c) return null;
    const t = tokens.find((x) => x.kind === 'color' && [x.value, x.light].filter(Boolean).some((v) => hex(v) === h));
    const six = h.split(' ')[0];
    return t ? `${pre}-${t.name.replace(/^--(?:color-)?/, '')}` : c.alpha < 1 ? `${pre}-[${six}]/${Math.round(c.alpha * 100)}` : `${pre}-[${six}]`;
  };
  let add = null, replace = [];
  if (SPACE[prop]) {
    const [own, pair, every] = SPACE[prop], other = { pt: 'pb', pb: 'pt', pl: 'pr', pr: 'pl', mt: 'mb', mb: 'mt', ml: 'mr', mr: 'ml' }[own], cross = { pt: 'px', pb: 'px', pl: 'py', pr: 'py', mt: 'mx', mb: 'mx', ml: 'my', mr: 'my' }[own];
    replace = of(new RegExp(`^-?(?:${SPACE[prop].join('|')})-`));
    const keep = replace.flatMap((r) => { const b = bare(r), v = b.replace(/^-?[a-z]+-/, ''); return pair && b.startsWith(`${pair}-`) ? [`${other}-${v}`] : every && b.startsWith(`${every}-`) ? [`${other}-${v}`, `${cross}-${v}`] : []; }); // py-3 → its bottom stays 3
    add = [len(own), ...keep].join(' ');
  }
  else if (prop === 'font-size') { add = SIZE[at16] ? `text-${SIZE[at16]}` : `text-[${+px.toFixed(2)}px]`; replace = of(TEXT_SIZE); }
  else if (prop === 'font-weight') { add = WEIGHT[Math.round(px / 100) * 100] ? `font-${WEIGHT[Math.round(px / 100) * 100]}` : null; replace = of(/^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/); }
  else if (prop === 'line-height') { add = Number.isFinite(px) && /px$/.test(value) ? `leading-[${+px.toFixed(2)}px]` : `leading-[${value}]`; replace = of(/^leading-/); }
  else if (prop === 'letter-spacing') { add = `tracking-[${value}]`; replace = of(/^tracking-/); }
  else if (prop === 'border-radius') { add = RADIUS[at16] !== undefined && whole ? `rounded-${RADIUS[at16]}` : px >= 999 ? 'rounded-full' : `rounded-[${+px.toFixed(2)}px]`; replace = of(/^rounded(?:-(?:none|xs|sm|md|lg|xl|\dxl|full|\[.+\]))?$/); }
  else if (prop === 'color') { add = colour('text'); replace = of(/^text-/).filter((c) => !TEXT_SIZE.test(bare(c)) && !TEXT_ALIGN.test(bare(c))); }
  else if (prop === 'background-color') { add = colour('bg'); replace = of(/^bg-/).filter((c) => !/^bg-(?:clip|origin|fixed|local|scroll|repeat|no-repeat|cover|contain|auto|center|top|bottom|left|right|none|blend|linear|radial|conic|gradient)/.test(bare(c))); }
  else if (prop === 'border-color') { add = colour('border'); replace = of(/^border-(?!\d|x|y|t|r|b|l|s|e|solid|dashed|dotted|none|\[\d)/); }
  else if (prop === 'border-width') { add = whole && Math.round(px) === 1 ? 'border' : whole && [0, 2, 4, 8].includes(Math.round(px)) ? `border-${Math.round(px)}` : `border-[${+px.toFixed(2)}px]`; replace = of(/^border(?:-(?:0|2|4|8|\[[\d.]+px\]))?$/); }
  else if (prop === 'border-style') { add = `border-${value}`; replace = of(/^border-(?:solid|dashed|dotted|double|none)$/); }
  else if (prop === 'opacity') { add = `opacity-${Math.round(px * 100)}`; replace = of(/^opacity-/); }
  else if (prop === 'text-align') { add = `text-${value}`; replace = of(TEXT_ALIGN); }
  if (add && replace.includes(add)) add = add.replace(/-[^-]+$/, `-[${value.replace(/s+/g, '_')}]`); // it has that class and draws otherwise (a stronger rule): say the value itself
  return add ? { css, tw: { add, replace } } : { css };
}

// One edit, kept or updated: the same property of the same element changed again keeps where it started. Changed back
// to where it started, it's gone (and taken out of the code, if Trace wrote it there). With `write`, Trace writes it
// into the code itself when it can do so exactly (classes swapped on its line, its words replaced); else it stays a
// draft for Claude.
export async function putEdit(p, e, tokens = [], { write = false } = {}) {
  const edits = editsOf(p.id);
  const i = edits.findIndex((x) => (x.status === 'draft' || x.status === 'written') && x.path === e.path && x.url === e.url && x.prop === e.prop);
  const was = i >= 0 ? edits[i] : null, from = was ? was.from : e.from;
  if (from === undefined || from === null) throw err(400, 'Where it started is missing: pick it again and change it.');
  if (String(e.to).trim() === String(from).trim()) {
    const reverted = was?.wrote ? await revertEdit(p, was).catch(() => false) : false;
    if (i >= 0) edits.splice(i, 1);
    return { edits: save(p.id, edits), gone: true, reverted };
  }
  if (was?.wrote) await revertEdit(p, was).catch(() => false); // a written change changed again: back to the original line first
  const where = was?.file !== undefined ? { file: was.file, line: was.wrote?.line ?? was.line, code: was.code, by: was.by } : (await locate(p, e).catch(() => null)) || { file: null, line: null, code: null };
  const cls = was ? was.cls : e.cls || ''; // the classes as they were: after a write and a reload the page has the new ones
  let x = { id: was?.id || uid('ed'), at: Date.now(), status: 'draft', path: e.path, url: e.url, comp: e.comp || null, tag: e.tag, cls, text: was ? was.text : e.text || '', prop: e.prop, from, to: String(e.to), ...where,
    ...(e.prop === 'text' ? { css: null, words: true } : codeFor(e.prop, String(e.to), cls, tokens, +e.rem || 16)), rem: +e.rem || 16 };
  if (write) { const w = await writeEdit(p, x).catch(() => null); if (w) x = { ...x, status: 'written', wrote: w, line: w.line }; }
  if (i >= 0) edits[i] = x; else edits.push(x);
  return { edits: save(p.id, edits), edit: x };
}
export async function dropEdit(p, id) {
  const x = editsOf(p.id).find((e) => e.id === id);
  if (x?.wrote && x.status === 'written') await revertEdit(p, x).catch(() => false);
  return save(p.id, editsOf(p.id).filter((e) => e.id !== id));
}

// The line an edit changes, changed: its words replaced (once on the line, or it isn't the place), or its classes
// swapped (a shorthand's other side kept: py-3 for a top of 16px is "pt-4 pb-3"; a variant kept: md:text-sm is
// md:text-[15px]). Null when the line isn't the element's.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const token = (t) => new RegExp(`(^|[\\s"'\`{(])${esc(t)}(?=$|[\\s"'\`})])`);
export function rewrite(line, e) {
  if (e.prop === 'text') return e.from && line.split(e.from).length === 2 ? line.replace(e.from, () => e.to) : null;
  if (!e.tw?.add) return null;
  const { add, replace } = e.tw;
  if (!replace.length) { // nothing of its kind yet: after one of its classes on this line
    const c = String(e.cls || '').split(/\s+/).find((k) => k && token(k).test(line));
    return c ? line.replace(token(c), (m) => `${m} ${add}`) : null;
  }
  let out = line, first = true;
  for (const r of replace) {
    if (!token(r).test(out)) return null;
    const variant = r.slice(0, r.length - bare(r).length);
    out = out.replace(token(r), (m, pre) => { if (!first) return pre === ' ' ? '' : pre; first = false; return `${pre}${add.split(' ').map((a) => variant + a).join(' ')}`; });
  }
  return out;
}
async function codeFile(p, file) { // a file of the project's code, never outside it, never a secret
  const r = await needRepo(p), rel = String(file || '').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || /^[a-z]:/i.test(rel) || /(^|\/)\.\.(\/|$)/.test(rel) || !/\.(tsx?|jsx?|mjs|cjs|css|scss|sass|less|vue|svelte|html|astro|mdx?)$/i.test(rel) || SECRET.test(rel)) throw err(400, 'That file can’t be opened here.');
  const f = path.resolve(r.root, rel);
  if (!f.startsWith(path.resolve(r.root) + path.sep) || !existsSync(f)) throw err(404, 'No such file in the project.');
  if (statSync(f).size > 500e3) throw err(413, 'That file is too big to edit here.');
  return f;
}
async function writeEdit(p, x) {
  if (!x.file) return null;
  const f = await codeFile(p, x.file), lines = readFileSync(f, 'utf8').split('\n'); // a line keeps its \r on a CRLF file
  const at = x.line ? [x.line - 1, ...Array.from({ length: 20 }, (_, k) => [x.line - 2 - k, x.line + k]).flat()] : lines.map((_, k) => k); // its line first, then nearest
  for (const k of at) {
    if (k < 0 || k >= lines.length) continue;
    const next = rewrite(lines[k], x);
    if (next && next !== lines[k]) { const before = lines[k]; lines[k] = next; writeFileSync(f, lines.join('\n')); return { line: k + 1, before, after: next, at: Date.now() }; }
  }
  return null;
}
async function revertEdit(p, x) { // a written change taken out, only if its line is still as Trace wrote it
  const f = await codeFile(p, x.file), lines = readFileSync(f, 'utf8').split('\n');
  const k = lines[x.wrote.line - 1] === x.wrote.after ? x.wrote.line - 1 : lines.indexOf(x.wrote.after);
  if (k < 0) return false;
  lines[k] = x.wrote.before;
  writeFileSync(f, lines.join('\n'));
  return true;
}
// The Code tab: a file as it is (with a hash, so a save never overwrites what changed since), and saved.
const sha = (t) => createHash('sha1').update(t).digest('hex').slice(0, 16);
export async function readCode(p, file) { const f = await codeFile(p, file), text = readFileSync(f, 'utf8'); return { file, text, hash: sha(text) }; }
export async function writeCode(p, file, text, hash) {
  const f = await codeFile(p, file), cur = readFileSync(f, 'utf8');
  if (sha(cur) !== hash) throw err(409, 'It changed since you opened it (Claude, or another editor). Reload it, then make your change again.');
  if (typeof text !== 'string' || text.length > 500e3) throw err(400, 'That isn’t the file’s text.');
  writeFileSync(f, text);
  return { file, hash: sha(text) };
}

// The edits as a request a coding agent can follow without the canvas: each one's place, what changes, and the code.
export const briefOf = (edits, note = '') => [
  `Apply these design changes, made on Trace's canvas, in the code. Keep everything else as it is.${note ? ` The person says: “${note}”.` : ''}`,
  ...edits.map((e) => `- ${e.comp || `<${e.tag}>`}${e.text && e.text.length < 40 && e.prop !== 'text' ? ` (“${e.text}”)` : ''}${e.file ? ` in ${e.file}${e.line ? `:${e.line}` : ''}` : ''}: ${e.prop === 'text' ? `change the text “${e.from}” to “${e.to}”.` : `${e.prop} ${e.from} → ${e.to}.${e.tw ? ` Tailwind: use ${e.tw.add}${e.tw.replace.length ? ` instead of ${e.tw.replace.join(' ')}` : ''}.` : ` CSS: ${e.css}.`}`}`),
].join('\n');
// Sent: the drafts are ready for Claude (with what the person said about them); taken: an agent has read them.
export function sendEdits(p, note = '') {
  const edits = editsOf(p.id), out = edits.filter((x) => x.status === 'draft');
  for (const x of out) { x.status = 'sent'; x.note = note || null; x.sent = Date.now(); }
  save(p.id, edits);
  return { edits: out, brief: briefOf(out, note) };
}
export function takeEdits(p) {
  const edits = editsOf(p.id), out = edits.filter((x) => x.status === 'sent' || x.status === 'draft');
  for (const x of out) { x.status = 'taken'; x.taken = Date.now(); }
  save(p.id, edits);
  return { edits: out, brief: out.length ? briefOf(out, out.find((x) => x.note)?.note) : null };
}
export function doneEdits(p, ids) {
  const edits = editsOf(p.id);
  for (const x of edits) if (x.status === 'taken' && (!ids?.length || ids.includes(x.id))) { x.status = 'applied'; x.applied = Date.now(); }
  return save(p.id, edits.filter((x) => x.status !== 'applied' || Date.now() - x.applied < 7 * 864e5)); // a week of what was applied
}

// ---- what the person and Claude Code are doing now: the newest session in the project's folder ----
const enc = (d) => d.replace(/[^a-zA-Z0-9]/g, '-'); // how Claude Code names a folder's sessions
const tails = new Map();
const unwrap = (t) => String(t || '').replace(/<(system-reminder|ide_[a-z_]+|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g, '').replace(/\s+/g, ' ').trim();
const cut = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
export function sessionNow(p, n = 4) {
  const base = path.join(os.homedir(), '.claude', 'projects'), files = [];
  for (const d of projectDirs(p)) {
    const dir = path.join(base, enc(path.resolve(d)));
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) { const st = statSync(path.join(dir, f)); files.push({ file: path.join(dir, f), mtime: st.mtimeMs, size: st.size }); }
  }
  for (const s of files.sort((a, b) => b.mtime - a.mtime).slice(0, 3)) { // the newest that has a person in it (one just opened may not yet)
    const out = tailOf(s, n);
    if (out.turns.length) return out;
  }
  return { turns: [], at: null };
}
function tailOf(s, n) {
  const c = tails.get(s.file);
  if (c && c.size === s.size) return c.out;
  const fd = openSync(s.file, 'r'), len = Math.min(s.size, 2e6), buf = Buffer.alloc(len); // the end of it is enough
  readSync(fd, buf, 0, len, s.size - len); closeSync(fd);
  const turns = [];
  for (const l of buf.toString('utf8').split('\n').slice(s.size > len ? 1 : 0)) {
    const user = l.includes('"type":"user"') && !l.includes('"tool_use_id"'), asst = l.includes('"type":"assistant"');
    if (!user && !asst) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.isSidechain || o.isMeta) continue;
    const content = o.message?.content;
    if (user) {
      const text = unwrap(typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join(' ') : '');
      if (text && !/^(Caveat:|\[Request interrupted)/.test(text)) turns.push({ at: Date.parse(o.timestamp) || null, ask: cut(text, 400), reply: '', thinking: '', files: [] });
      continue;
    }
    const t = turns.at(-1);
    if (!t || !Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) t.reply = cut(b.text.trim().replace(/\s+/g, ' '), 600);
      else if (b.type === 'thinking' && b.thinking?.trim()) t.thinking = cut(b.thinking.trim().replace(/\s+/g, ' '), 600);
      else if (b.type === 'tool_use' && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name)) { const f = b.input?.file_path; if (f && !t.files.includes(path.basename(f))) t.files.push(path.basename(f)); }
    }
  }
  const out = { turns: turns.slice(-n), at: s.mtime, session: path.basename(s.file, '.jsonl') };
  tails.set(s.file, { size: s.size, out });
  return out;
}

// ---- Trace's AI on the canvas: answers with the canvas, the project's decisions and the session as context ----
const SYSTEM = `You help a person designing a running app in Trace's canvas, beside their Claude Code session. Use only the context given: the element they picked (what draws it, where it lives in the code, how it's drawn), the changes they made on the canvas, the project's decisions and rules, and what they and Claude are asking and reasoning right now. Be brief and concrete: name values (px, hex, weights) and places (file and line). When they ask for a feel ("calmer", "more premium"), answer with the property changes to try, as a short list they can make on the canvas. When the context doesn't say, say so; never invent.`;
export async function askDesign(p, { q, el, edits = [] }) {
  if (!String(q || '').trim()) throw err(400, 'Ask something.');
  const s = sessionNow(p), rules = all("SELECT text FROM decision WHERE project_id=? AND status='confirmed' ORDER BY created_at DESC", p.id).slice(0, 20);
  const ctx = [
    `Project: ${p.name}.`,
    el && `Picked: <${el.tag}>${el.comp ? `, drawn by ${el.comp}` : ''}${el.file ? `, in ${el.file}${el.line ? `:${el.line}` : ''}` : ''}${el.text ? `, reading “${el.text.slice(0, 60)}”` : ''}. Classes: ${el.cls || 'none'}. Drawn with: ${Object.entries(el.style || {}).filter(([, v]) => v && v !== 'none' && v !== 'normal' && v !== '0px').map(([k, v]) => `${k} ${v}`).join('; ')}.`,
    edits.length && `Changed on the canvas so far:\n${edits.map((e) => `- ${e.comp || e.tag}: ${e.prop} ${e.from} → ${e.to}${e.file ? ` (${e.file}${e.line ? `:${e.line}` : ''})` : ''}`).join('\n')}`,
    rules.length && `The project's decisions and rules:\n${rules.map((x) => `- ${x.text}`).join('\n')}`,
    s.turns.length && `The person and Claude Code right now, oldest first:\n${s.turns.map((t) => `- They asked: “${t.ask}”${t.thinking ? `\n  Claude reasoned: ${t.thinking}` : ''}${t.reply ? `\n  Claude said: ${t.reply}` : ''}${t.files.length ? `\n  Claude edited: ${t.files.join(', ')}` : ''}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
  const m = await AI.complete({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${ctx}\n\nThey ask: ${q}` }], max_tokens: 1200 });
  return { text: String(m.content || '').trim() || 'No answer came back. Try asking another way.' };
}
