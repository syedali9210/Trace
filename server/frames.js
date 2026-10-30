// Frames: a version's frontend, found by itself. Every React component the code defines (exported or kept inside its
// file) with what it uses (imports followed through path aliases and index files, and its neighbours in the same file),
// how deep under the screen the entry renders it sits, and which kind of part it is (buttons, inputs, overlays…).
// The screens themselves come from walking the running app (server/screens.js); the parts that can stand alone are
// drawn by the version's own dev server (server/vite-frames.mjs).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { needRepo, git, appOf } from './history.js';
import { componentsIn, importsOf, propTypes, branchesIn } from './props.js';

const NOW = 'now';
const SRC = /\.(tsx|jsx|ts|js|mts|mjs)$/i, UI = /\.(tsx|jsx)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|out|\.next|coverage|__tests__|__mocks__|tests?|e2e|scripts|fixtures)\//i, NOT = /\.(test|spec|stories|story|d)\.[cm]?[jt]sx?$|vite\.config|tailwind\.config|eslint|postcss/i;
const err = (status, message) => Object.assign(new Error(message), { status });
const cache = new Map(); // a saved version never changes

// Every source file of the app in that version, in one git call (or from disk for the unsaved state).
async function sources(root, sha, under) {
  const spec = under || '.';
  const list = (await git(root, sha === NOW ? ['ls-files', '-co', '--exclude-standard', '--', spec] : ['ls-tree', '-r', '--name-only', sha, '--', spec])).split('\n').filter((f) => f && SRC.test(f) && !SKIP.test(f) && !NOT.test(f)).slice(0, 1200);
  if (sha === NOW) return Object.fromEntries(list.map((f) => { try { return [f, readFileSync(path.join(root, f), 'utf8')]; } catch { return null; } }).filter(Boolean));
  const buf = await git(root, ['cat-file', '--batch'], { input: `${list.map((f) => `${sha}:${f}`).join('\n')}\n`, raw: true, timeout: 120000 });
  const out = {};
  let at = 0;
  for (const f of list) { // "<oid> blob <size>\n<bytes>\n" per file, or "<spec> missing\n"
    const nl = buf.indexOf(10, at);
    const head = buf.subarray(at, nl).toString();
    at = nl + 1;
    const size = +head.split(' ')[2];
    if (!Number.isFinite(size)) continue;
    out[f] = buf.subarray(at, at + size).toString('utf8');
    at += size + 1;
  }
  return out;
}

// '@/x' → 'src/x' (and any other tsconfig paths), as repo paths under the app.
function aliasesOf(appDir, rel) {
  const out = [];
  for (const f of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    let j;
    try { j = JSON.parse(readFileSync(path.join(appDir, f), 'utf8').replace(/^﻿/, '').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); } catch { continue; }
    const base = j.compilerOptions?.baseUrl || '.';
    for (const [k, v] of Object.entries(j.compilerOptions?.paths || {})) if (k.endsWith('/*') && v?.[0]?.endsWith('/*')) out.push([k.slice(0, -1), path.posix.join(rel, base, v[0].slice(0, -1)).replace(/^\.\//, '')]);
  }
  if (!out.some(([k]) => k === '@/') && existsSync(path.join(appDir, 'src'))) out.push(['@/', path.posix.join(rel, 'src/')]);
  return out;
}

// Which kind of part a component is, from its name: the design system's sections, buttons first.
export const KINDS = ['Buttons', 'Inputs & controls', 'Overlays', 'Navigation', 'Feedback & status', 'Data display', 'Layout', 'Parts'];
const KIND_OF = [
  ['Buttons', /(Button|Btn|Fab|CTA)s?$|^Button|^Copy[A-Z]|Toggle$/],
  ['Inputs & controls', /Input|Field|Select|Switch(er)?$|Checkbox|Radio|Slider|Textarea|Combobox|Picker|Form|Search|Toggle|Stepper|Upload/],
  ['Overlays', /Sheet|Dialog|Modal|Drawer|Popover|Tooltip|Dropdown|Overlay|Toast|HoverCard|ContextMenu|Lightbox|Portal/],
  ['Navigation', /Nav|Tabs?$|Tab[A-Z]|Menu|Breadcrumb|Sidebar|Header|Footer|Link$|Pagination|Rail|Toolbar|Command|Router/],
  ['Feedback & status', /Badge|Chip|Tag$|Alert|Banner|Empty|Error|Skeleton|Spinner|Loader|Loading|Progress|Status|Indicator|Pill|Notice|Callout/],
  ['Data display', /Table|List|Row|Item|Card|Feed|Chart|Graph|Stat|Metric|Avatar|Code|Text|Label|Title|Heading|Mark|Legend|Diagram|Flow|Anatomy|Timeline|Rate|Id$|Kbd|Image|Icon/],
  ['Layout', /Layout|Page|Screen|View|Section|Container|Grid|Stack|Box|Panel|Shell|^App$|Provider|Root|Frame|Studio|Intro/],
];
export const kindOf = (name) => KIND_OF.find(([, re]) => re.test(name))?.[0] || 'Parts';

// The pages the code names, so a walk reaches the ones no link leads to within a few clicks: Next.js's app and pages
// folders, React Router's paths, and the addresses its links and navigations go to. Only fixed ones (":id", "[slug]"
// need a real id, which a link on a page gives), never the API, files or another site.
export function routesIn(src, rel = '') {
  const out = new Set();
  const add = (r) => { r = `/${String(r).replace(/^\/+|\/+$/g, '')}`.replace(/\/index$/, '') || '/'; if (!/[:*[\]()@]|\/(api|_next|static|assets)(\/|$)|\.\w{2,4}$/.test(r) && r.length < 80) out.add(r); };
  for (const [file, text] of Object.entries(src)) {
    const f = rel ? file.slice(rel.length + 1) : file;
    const next = f.match(/^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/) || f.match(/^(?:src\/)?app\/()page\.[jt]sx?$/);
    if (next) add(next[1].split('/').filter((x) => !/^\(.*\)$/.test(x)).join('/'));
    const page = f.match(/^(?:src\/)?pages\/(.+)\.[jt]sx?$/);
    if (page && !/(^|\/)(_app|_document|_error|404|500)$|^api\//.test(page[1]) && /export\s+default/.test(text)) add(page[1]);
    for (const m of text.matchAll(/(?:<Route\b[^>]*?\spath|\bpath\s*:)\s*=?\s*["'`](\/[\w\-/]*)["'`]/g)) add(m[1]);
    for (const m of text.matchAll(/(?:\b(?:href|to)\s*=\s*\{?\s*|\b(?:navigate|push|replace)\(\s*)["'`](\/[\w\-/]*)["'`]/g)) add(m[1]);
  }
  out.delete('/');
  return [...out].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, 40);
}

export async function discover(p, sha) {
  if (sha !== NOW && !/^[0-9a-f]{7,40}$/i.test(sha)) throw err(400, 'That isn’t a version id.');
  const r = await needRepo(p);
  const key = `${p.id}:${sha}`;
  if (sha !== NOW && cache.has(key)) return cache.get(key);
  const app = appOf(r.root);
  if (!app) throw err(400, 'There’s no app here to draw: no package.json with a dev script.');
  const rel = app.rel.split(path.sep).join('/');
  const src = await sources(r.root, sha, rel);
  const aliases = aliasesOf(app.dir, rel);
  const fromApp = (f) => (rel ? f.slice(rel.length + 1) : f);
  const resolve = (from, spec) => {
    let b = spec.startsWith('.') ? path.posix.join(path.posix.dirname(from), spec) : null;
    if (!b) for (const [a, to] of aliases) if (spec.startsWith(a)) { b = to + spec.slice(a.length); break; }
    if (!b) return null;
    return ['', '.tsx', '.jsx', '.ts', '.js', '/index.tsx', '/index.jsx', '/index.ts', '/index.js'].map((x) => b + x).find((f) => f in src) || null;
  };
  // Each component with its own stretch of the file (from its definition to the next one's), so what it renders is its own.
  const comps = {}, imports = {}, parts = {};
  for (const [f, text] of Object.entries(src)) {
    imports[f] = importsOf(text).map((i) => ({ ...i, file: resolve(f, i.spec) })).filter((i) => i.file);
    if (!UI.test(f)) continue;
    const at = componentsIn(text, { all: true }).map((c) => ({ ...c, at: text.search(new RegExp(`(?:function\\s+${c.name}\\b|(?:const|let)\\s+${c.name}\\b)`)) })).filter((c) => c.at >= 0).sort((a, b) => a.at - b.at);
    const cs = at.map((c, i) => ({ ...c, body: text.slice(c.at, at[i + 1]?.at ?? text.length) })).filter((c) => c.key || /return\s*\(?\s*<|=>\s*\(?\s*<[A-Za-z>]|createElement\(/.test(c.body)); // kept inside the file: only if it draws
    if (cs.length) { comps[f] = cs.map(({ name, key, body }) => { const t = propTypes(text, name); return { name, key, states: { unions: t.unions, flags: t.flags, branches: branchesIn(body) } }; }); parts[f] = cs; } // what each can show
  }
  // A name imported from a file, as a component: in that file, or one index file (barrel) further.
  const find = (file, name, def, hop = 0) => {
    const cs = comps[file];
    if (cs) { const c = def ? cs.find((x) => x.key === 'default') || cs.find((x) => x.key) : cs.find((x) => x.key === name || (x.key && x.name === name)); if (c) return `${file}#${c.name}`; }
    if (hop > 1) return null;
    for (const i of imports[file] || []) if (i.all || i.names.includes(name)) { const hit = find(i.file, name, false, hop + 1); if (hit) return hit; }
    return null;
  };
  // What each component renders: <Tag> as a neighbour in its file, or through the file's imports (<UI.Button> too).
  const edges = new Map();
  for (const [f, cs] of Object.entries(parts)) {
    const local = new Map(imports[f].flatMap((i) => (i.locals || []).map(([l, orig]) => [l, { file: i.file, orig }])));
    for (const c of cs) {
      const from = `${f}#${c.name}`;
      for (const m of c.body.matchAll(/<([A-Z]\w*)(?:\.([A-Z]\w*))?[\s/>]/g)) {
        const [, tag, sub] = m;
        let to = null;
        if (tag !== c.name && cs.some((x) => x.name === tag)) to = `${f}#${tag}`;
        else if (local.has(tag)) { const i = local.get(tag); to = i.orig === '*' ? (sub ? find(i.file, sub, false) : null) : find(i.file, i.orig ?? tag, i.orig === null); }
        if (to && to !== from) { const k = `${from}>${to}`; edges.set(k, { from, to, n: (edges.get(k)?.n || 0) + 1 }); }
      }
    }
  }
  // Depth from what the entry renders (index.html's script, else src/main): the screens first, their parts after.
  let entry = null;
  try { entry = readFileSync(path.join(app.dir, 'index.html'), 'utf8').match(/<script[^>]*type=["']module["'][^>]*src=["']\/?([^"']+)["']/)?.[1]; } catch {}
  entry = [entry && path.posix.join(rel, entry), ...['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx'].map((x) => path.posix.join(rel, x))].find((f) => f && f in src);
  const ids = Object.entries(comps).flatMap(([f, cs]) => cs.map((c) => `${f}#${c.name}`));
  const roots = new Set(entry ? (imports[entry] || []).flatMap((i) => [...i.names, ...(i.def ? [null] : [])].map((n) => find(i.file, n, n === null))).filter(Boolean) : []);
  if (!roots.size) ids.filter((id) => /#App$/.test(id)).forEach((id) => roots.add(id));
  const depth = {}, out = new Map([...edges.values()].reduce((m, e) => m.set(e.from, [...(m.get(e.from) || []), e.to]), new Map()));
  let wave = [...roots];
  wave.forEach((id) => { depth[id] = 0; });
  for (let d = 1; wave.length && d < 12; d++) wave = wave.flatMap((id) => (out.get(id) || []).filter((to) => depth[to] === undefined && (depth[to] = d) !== undefined));
  const SCREEN = /(^|\/)(pages|screens|routes|views|app)\//i;
  const near = (id) => depth[id] ?? 99; // a big app keeps what its entry renders first, nearest first; files nothing reaches come last
  const components = [...ids].sort((a, b) => near(a) - near(b)).slice(0, 400).map((id) => {
    const [file, name] = id.split('#');
    const c = comps[file].find((x) => x.name === name);
    const d = depth[id];
    return { id, file, path: fromApp(file), name, key: c.key, exported: !!c.key, depth: d ?? null, kind: d === 0 || /(Page|Screen|View|Layout)$/.test(name) || (SCREEN.test(file) && c.key === 'default') ? 'screen' : 'component', cat: kindOf(name), states: c.states };
  });
  const keep = new Set(components.map((f) => f.id));
  const result = { app: { rel, kind: app.kind, name: app.name || path.basename(app.dir), modes: app.modes || [] }, entry, components, edges: [...edges.values()].filter((e) => keep.has(e.from) && keep.has(e.to)), routes: routesIn(src, rel),
    imports: Object.fromEntries(Object.entries(imports).map(([f, is]) => [f, [...new Set(is.map((i) => i.file))]])) }; // file → the app's own files it imports (what a change reaches)
  if (sha !== NOW) cache.set(key, result);
  return result;
}
