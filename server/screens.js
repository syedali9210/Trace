// Screens: a running version, walked the way a person would use it. Trace opens it in a headless browser and clicks
// what can be clicked (tabs, buttons, menus, sheets, the theme switch, links within the app, never anything that
// deletes, pays, sends or saves), one and two clicks deep. Every different state it lands in is a screen: its picture,
// the clicks that reach it, the app's components that drew it and where (from React's own tree), and the text styles
// on it. The first screen also gives the design tokens in the app's CSS. Kept per version in data/screens.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DATA, broadcast } from './db.js';
import { storeFile } from './media.js';
import { openBrowser } from './cdp.js';
import { liveFor, needRepo, git } from './history.js';
import { discover } from './frames.js';
import { WALK } from './walk.js';

const MAX_SCREENS = 48, MAX_CLICKS = 120, DEEP = 3, STAGES = 14; // stages of one dialog don't count against DEEP
// What it's walked on: the device it's built for. Found by itself (how it lays out in a desktop-wide window, or a
// phone framework in its packages), or picked by the person.
export const DEVICES = { desktop: { width: 1280, height: 800, scale: 2, thumb: 800 }, tablet: { width: 834, height: 1194, scale: 2, mobile: true, thumb: 640 }, phone: { width: 390, height: 844, scale: 2, mobile: true, thumb: 560 } };
export const deviceOf = (f) => (f.span <= 640 ? 'phone' : f.bar && f.span <= 1100 ? 'tablet' : 'desktop');
const err = (status, message) => Object.assign(new Error(message), { status });
const jobs = new Map(); // `${pid}:${sha}` → { done, total, label } while a walk runs
const fileOf = (pid, sha) => { if (!/^(now|[0-9a-f]{7,40})$/i.test(sha)) throw err(400, 'That isn’t a version id.'); return path.join(DATA, 'screens', pid, `${sha === 'now' ? 'now' : sha.slice(0, 12)}.json`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function screens(p, sha) {
  let data = null;
  try { data = JSON.parse(readFileSync(fileOf(p.id, sha), 'utf8')); } catch {}
  const job = jobs.get(`${p.id}:${sha}`);
  const { out, ...walking } = job || {};
  const live = out?.length && !data?.screens?.length ? { screens: shaped(out), partial: true } : {}; // a first walk shows its screens as it finds them
  return { ...(data || { screens: [] }), ...live, type: typeScale(live.screens || data?.screens || []), walking: job ? walking : null };
}
// A screen as it's kept: what it was told apart by (its fingerprint, which the next walk starts from), and each group's
// stage count ("2 of 6").
function shaped(out) {
  const sizes = new Map();
  for (const s of out) if (s.group) sizes.set(s.group.id, Math.max(sizes.get(s.group.id) || 0, s.stage));
  return out.map(({ fp, ...s }) => ({ ...s, fp, ...(s.group ? { stages: sizes.get(s.group.id) } : {}), tabs: fp.tabs, dialogs: fp.dialogs, layer: fp.layer, path: fp.path }));
}

// A screen's name, from what changed to reach it. On a stage of a dialog (an intro's "2 of 6"), the stage's own heading.
const short = (s) => (s.length > 32 ? `${s.slice(0, 30).trim()}…` : s);
const tidy = (s) => String(s || '').replace(/^[\s*•·]+|[\s+*›→»>←‹«<×✕]+$/g, '').trim() || String(s || ''); // "Product Clarity +" is "Product Clarity"
const titleOf = (t) => tidy(String(t || '').split(/\s+[|–—·-]\s+/)[0]); // "Kodex — Syed Ali" → "Kodex"
const pathName = (p) => [...p.split(/[?#]/)[0].split('/'), ...[...new URLSearchParams(p.split('?')[1]?.split('#')[0] || '').values()]].filter(Boolean).map((x) => decodeURIComponent(x).replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).join(' / ') || 'Home'; // "/projects/kodex" → "Projects / Kodex", "/?tab=providers" → "Providers"
function nameOf(st, from, step) {
  const home = st.fp.h1 || titleOf(st.title) || st.fp.tabs[0] || 'First screen';
  const L = st.fp.layer;
  if (L && L.stage && (!from || from.fp.layer?.name === L.name)) return short(L.stage.split(' · ')[0] || L.name) + (L.count ? ` (${L.count})` : '');
  if (!from) return L ? L.name : short(home);
  const was = from.fp, label = short(tidy(step.label));
  if (st.fp.path !== was.path) return short(st.fp.tabs.find((t) => !was.tabs.includes(t)) || (st.fp.h1 && st.fp.h1 !== was.h1 ? st.fp.h1 : st.title && st.title !== from.title ? titleOf(st.title) : pathName(st.fp.path))); // another page: the tab it picked, its heading, its title, else its address
  if (L && was.layer?.name !== L.name) return L.name === L.kind ? `${label} ${L.kind.toLowerCase()}` : L.name;
  const newDialog = st.fp.dialogs.find((d) => !was.dialogs.includes(d));
  if (newDialog) return newDialog === 'Dialog' ? `${label} sheet` : newDialog;
  if (st.fp.menus.length > was.menus.length) return `${label} menu`;
  if (st.fp.theme !== was.theme) return /dark/i.test(st.fp.theme) ? 'Dark theme' : /light/i.test(st.fp.theme) ? 'Light theme' : `${label} theme`;
  const tab = st.fp.tabs.find((t) => !was.tabs.includes(t));
  if (tab) return tab.replace(/(\D)\s+\d+$/, '$1'); // "All 42" is the tab "All": its count changes
  if (st.fp.h1 && st.fp.h1 !== was.h1 && !L) return short(st.fp.h1); // another view at the same address (an app that switches pages in place)
  const picked = (st.fp.on || []).find((x) => !(was.on || []).includes(x));
  if (picked && !/#/.test(picked)) return short(picked);
  if (st.fp.dialogs.length < was.dialogs.length) return `${short(home)}, ${was.dialogs.find((d) => !st.fp.dialogs.includes(d))} closed`;
  if (st.fp.open > was.open) return `${label}, expanded`;
  return `After “${label}”`;
}

// What a screen is clubbed with: the dialog, sheet or menu it's a stage of; the row of options (filters, chips, tabs)
// it's one view of; or its page in the other theme.
function groupOf(st, from, step) {
  const L = st.fp.layer;
  if (L) return { id: `${L.kind}:${L.name}`, label: `${L.kind} opened · ${L.name}`, kind: L.kind, name: L.name };
  if (!from || !step || st.fp.path !== from.fp.path || from.fp.layer) return null;
  if (st.fp.theme !== from.fp.theme) return { id: `theme:${st.fp.path}`, label: `${from.name} · themes`, kind: 'Theme', name: from.name };
  if (step.set && st.fp.h1 === from.fp.h1) { const name = step.setName || from.name; return { id: `set:${st.fp.path}:${step.set}`, label: `${name} · options`, kind: 'Options', name }; }
  return null;
}

// The type scale: the text styles a person would name (Display, Heading, Body, Caption…), not every size a page happens
// to draw. Fluid sizes a fraction apart are one style; a price, a count or an SVG label isn't type; a style a page uses
// once in its copy isn't a style; each keeps its most common line height and tracking, and one example on a screen.
const MONO = /mono|code|courier|consolas|menlo/i;
export function typeScale(list) {
  const m = new Map();
  for (const s of list) for (const t of s.text || []) {
    if (t.tag === 'text' || t.tag === 'tspan' || !/\p{L}{2}/u.test(t.sample || '')) continue;
    const size = Math.round(parseFloat(t.size) * 2) / 2, weight = Math.round((+t.weight || 400) / 100) * 100, upper = t.tt === 'uppercase';
    const key = [t.family, size, weight, upper].join('|');
    if (!m.has(key)) m.set(key, { family: t.family, size, weight, tt: t.tt, count: 0, seen: { lh: new Map(), ls: new Map(), tag: new Map() }, ex: null });
    const g = m.get(key);
    g.count += t.count;
    for (const k of ['lh', 'ls', 'tag']) g.seen[k].set(t[k], (g.seen[k].get(t[k]) || 0) + t.count);
    const shows = !s.group && !!t.r && t.r[2] > 0 && t.r[1] + t.r[3] <= (s.h || Infinity); // its example on a page, inside the picture (not behind a dialog)
    if (!g.ex || (shows && !g.ex.shows) || (shows === g.ex.shows && t.count > g.ex.count)) g.ex = { ...t, s: s.id, shows };
  }
  const most = (x) => [...x.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let out = [...m.values()].map(({ seen, ex, ...g }) => ({ ...g, lh: most(seen.lh), ls: most(seen.ls), tag: most(seen.tag), color: ex.color, sample: ex.sample, r: ex.r, s: ex.s }))
    .filter((g) => g.count >= 3 || /^h[1-3]$/.test(g.tag) || g.size >= 28);
  out.sort((a, b) => b.count - a.count);
  const kept = [];
  for (const g of out) { // within 4% of one kept already, same family, weight and case: the same style, drawn fluid
    const twin = kept.find((k) => k.family === g.family && k.weight === g.weight && k.tt === g.tt && Math.abs(k.size - g.size) / k.size <= 0.04);
    if (twin) twin.count += g.count; else kept.push(g);
  }
  out = kept.slice(0, 12).sort((a, b) => b.size - a.size || b.count - a.count);
  // Roles from the body (the most used size between 12 and 20 px): a heading is a step up from it (a fifth bigger at
  // least; the first, if it's huge, the display), just above it is the body, larger, and below it small, caption and
  // micro by size. Small capitals are labels; monospace is mono. Two styles of one role tell apart by weight, size, then font.
  const label = (g) => g.tt === 'uppercase' && g.size <= 18, plain = out.filter((g) => !MONO.test(g.family) && !label(g));
  const body = [...plain].filter((g) => g.size >= 12 && g.size <= 20).sort((a, b) => b.count - a.count)[0] || [...plain].sort((a, b) => b.count - a.count)[0];
  const heads = [...new Set(plain.filter((g) => body && g.size >= body.size * 1.2).map((g) => g.size))].sort((a, b) => b - a);
  const display = heads[0] >= 28 && heads[0] >= body.size * 1.8;
  const smaller = [...new Set(plain.filter((g) => body && g.size < body.size - 0.5).map((g) => g.size))].sort((a, b) => b - a);
  for (const g of out) {
    const i = heads.indexOf(g.size);
    g.role = MONO.test(g.family) ? 'Mono' : label(g) ? 'Label' : !body || Math.abs(g.size - body.size) <= 0.5 ? 'Body'
      : i >= 0 ? (display && i === 0 ? 'Display' : `Heading ${i + (display ? 0 : 1)}`)
      : g.size > body.size ? 'Body large' : ['Small', 'Caption', 'Micro'][Math.min(2, Math.max(0, smaller.indexOf(g.size)))];
  }
  const WEIGHT = { 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'heavy', 900: 'black' };
  const twins = (k) => { const n = new Map(); for (const g of out) n.set(k(g), (n.get(k(g)) || 0) + 1); return (g) => n.get(k(g)) > 1; };
  const sameRole = twins((g) => g.role);
  for (const g of out) g.name = sameRole(g) ? `${g.role} · ${WEIGHT[g.weight] || g.weight}` : g.role;
  for (const add of [(g) => `${g.size}px`, (g) => g.family]) { const same = twins((g) => g.name); for (const g of out) if (same(g)) g.name = `${g.name} · ${add(g)}`; } // then by size, then font
  return out.map(({ role, name, ...g }) => ({ role: name, ...g, size: `${g.size}px` }));
}

// The screens a change can have touched: those that drew a component from a changed file, or from a file using a changed
// helper, hook or data file (followed up through files that draw nothing, to the ones that do). A change to what every
// screen shares (styles, config, packages, the entry, a file outside the code) touches them all: null. So do screens
// whose components weren't read. Notes and tests touch none.
// ponytail: a file that both draws and exports a helper only counts as drawing; follow its importers if that misses.
const SHARED = /\.(css|scss|sass|less|styl)$|(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|index\.html|[\w.-]*\.config\.[cm]?[jt]s|tsconfig[\w.-]*\.json|\.env[\w.-]*)$/;
const INERT = /\.(md|txt)$|(^|\/)(__tests__|tests?|docs?|\.github|\.vscode)\/|\.(test|spec|stories)\.[jt]sx?$|(^|\/)(LICENSE|\.gitignore)$/i;
export function touched(code, changed, list) {
  const files = changed.filter((f) => !INERT.test(f));
  if (!files.length) return [];
  if (!code?.imports || list.some((s) => !s.tree?.length) || files.some((f) => SHARED.test(f) || f === code.entry || !(f in code.imports))) return null;
  const drawn = new Map(), by = new Map();
  for (const c of code.components) drawn.set(c.file, [...(drawn.get(c.file) || []), c.name]);
  for (const [f, deps] of Object.entries(code.imports)) for (const d of deps) by.set(d, [...(by.get(d) || []), f]);
  const names = new Set(), seen = new Set(files), wave = [...files];
  while (wave.length) { const f = wave.pop(); if (drawn.has(f)) drawn.get(f).forEach((n) => names.add(n)); else for (const g of by.get(f) || []) if (!seen.has(g)) { seen.add(g); wave.push(g); } }
  return list.filter((s) => s.tree.some((t) => names.has(t.n))).map((s) => s.id);
}
// What a version's files are, to tell what changed between two walks: git's id for each file of a commit, size and
// time for the working copy.
async function filesOf(root, sha) {
  if (sha !== 'now') return Object.fromEntries((await git(root, ['ls-tree', '-r', sha])).split('\n').filter(Boolean).map((l) => { const [meta, f] = l.split('\t'); return [f, meta.split(' ')[2].slice(0, 12)]; }));
  const list = (await git(root, ['ls-files', '-co', '--exclude-standard'])).split('\n').filter(Boolean);
  return Object.fromEntries(list.map((f) => { try { const s = statSync(path.join(root, f)); return [f, `${s.size}:${Math.round(s.mtimeMs)}`]; } catch { return [f, 'gone']; } }));
}
export const changedIn = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]);
// The walk a new one can start from: this version's last, else its parent commit's.
async function baseFor(p, sha, before, root) {
  if (before.screens.length) return before;
  if (sha === 'now') return null;
  const parent = (await git(root, ['rev-parse', `${sha}^`]).catch(() => '')).trim();
  return parent ? screens(p, parent) : null;
}

export async function walkApp(p, sha, { force, device, full } = {}) {
  const key = `${p.id}:${sha}`;
  if (jobs.has(key)) return screens(p, sha);
  const before = screens(p, sha);
  if (!force && before.screens.length) return before;
  const chosen = device === 'auto' ? null : DEVICES[device] ? device : before.chosen || null; // a pick stays for the next walk; "auto" goes back to finding it
  const lv = liveFor(p.id).find((x) => x.sha === sha);
  if (lv?.status !== 'ready') throw err(409, 'Run this version first: Trace walks it while it runs.');
  const url = lv.url.startsWith('/') ? `http://127.0.0.1:${process.env.TRACE_PORT || 4317}${lv.url}` : lv.url;
  const job = { done: 0, total: MAX_CLICKS, label: 'Opening the app', found: 0 };
  jobs.set(key, job);
  const tick = (o) => { Object.assign(job, o); if (/^Skipped/.test(o.label || '')) console.log(`walk ${p.name}: ${o.label}`); broadcast('history', { project_id: p.id, screens: sha, walking: { ...job } }); };
  tick({});
  (async () => {
    const code = await discover(p, sha).catch(() => null);
    const names = [...new Set((code?.components || []).map((c) => c.name))].filter((n) => !/^(Svg|Icon)$|Icon$/.test(n)); // an icon drawn inside a button is the button's
    // A walk to start from (this version's last, or its parent commit's): the screens the change since didn't touch are
    // kept, the touched ones gone to again. A new device, another mode, or a change to what every screen shares: all of it.
    const repo = await needRepo(p).catch(() => null);
    const files = repo && (await filesOf(repo.root, sha).catch(() => null));
    const base = !full && !device && files && code ? await baseFor(p, sha, before, repo.root) : null;
    let plan = null;
    if (base?.files && base.routes && base.screens.length && base.screens.every((s) => s.fp) && (base.mode || null) === (lv.mode || null)) {
      const changed = changedIn(base.files, files), redo = touched(code, changed, base.screens);
      if (redo) plan = { changed: changed.length, list: changed.slice(0, 200), redo, routes: code.routes.filter((r) => !base.routes.includes(r)) };
    }
    mkdirSync(path.dirname(fileOf(p.id, sha)), { recursive: true });
    let data;
    try {
      const since = plan && { changed: plan.changed, files: plan.list, redid: plan.redo.length, of: base.screens.length, from: base.at };
      if (plan && !plan.redo.length && !plan.routes.length) { const { walking, type, partial, ...was } = base; data = { ...was, at: Date.now(), files, since }; } // nothing on any screen changed
      else data = { ...(await walkUrl(url, names, tick, { device: plan ? base.device : chosen, hint: lv.device, routes: plan ? plan.routes : code?.routes || [], found: plan ? null : (out) => { job.out = out; }, keep: plan ? base.screens : null, redo: plan?.redo })),
        mode: lv.mode || null, chosen: plan ? base.chosen ?? null : chosen, files, routes: code?.routes || [] };
      if (since) { data.since = { ...since, moved: data.moved || [] }; delete data.moved; }
    }
    catch (e) { // nothing found this time: the screens from before stay, with what went wrong
      job.error = e.message;
      const { walking, ...was } = screens(p, sha);
      writeFileSync(fileOf(p.id, sha), JSON.stringify({ ...was, lastError: { message: e.message, at: Date.now() } }));
      throw e;
    }
    writeFileSync(fileOf(p.id, sha), JSON.stringify(data));
    import('./evidence.js').then((m) => { const n = m.closeOnEvidence(p, sha).length; if (n) console.log(`walk ${p.name}: ${n} comment${n === 1 ? '' : 's'} closed on evidence`); }).catch((e) => console.error('evidence', e.message)); // feedback the walk shows was acted on
  })().catch((e) => { console.error('screens walk', e); job.error = e.message; }).finally(() => {
    jobs.delete(key);
    broadcast('history', { project_id: p.id, screens: sha, walking: null, error: job.error });
  });
  return screens(p, sha);
}

// The walk itself: a URL and the names of the app's components in, its screens and tokens out. Three steps, run at once:
// 1. Explore. EXPLORERS pages (one browser, a storage of their own each) click through the app and only tell its states
//    apart (a fingerprint and what can be clicked there): no pictures, so a click costs a click. Every click a state
//    offers is a task in the batch of the first click that led there (one of the first screen's links, tabs, or a page
//    the code names), and a page keeps to its batch, so it's mostly on the screen its next click starts from already.
// 2. Picture. As states are found, PAINTERS pages take each one's whole-length picture, its React tree, text styles and
//    sections: one click from the state they're on when they can, else by its clicks from a fresh load. Explorers that
//    run out of clicks join them.
// 3. Assemble. When both are done the screens are put in order (shallowest first, then as found), numbered and clubbed
//    (a dialog's stages, a row of options, a theme), the same whichever page happened to find them first.
const CORES = os.cpus().length;
const EXPLORERS = Math.max(2, Math.min(5, Math.floor(CORES / 3))), PAINTERS = Math.max(1, Math.min(3, Math.floor(CORES / 5)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pageKey = (fp) => JSON.stringify(['page', fp.path, fp.theme]);
// A click and the state once it has landed (`settle`). A click on an option (a tab, a chip, a radio) has to pick it: on a
// slow dev server one can land before the page listens while the page changes some other way (a bar shown once scrolled
// to), and that state isn't the option's. Still unpicked once the page settles: clicked once more, then given up (false).
// `at.on`: whether it was picked before the click (null: not an option, or one with no mark to read).
export async function press(page, s, at, settle) {
  await page.click(at.x, at.y);
  let now = await settle();
  if (at.on !== false) return now;
  const picked = async () => (await page.eval(`__tw.picked(${JSON.stringify(s)})`).catch(() => null)) !== false;
  if (await picked()) return now;
  now = await page.eval('__tw.calm()');
  if (await picked()) return now; // it took, late
  const again = await page.eval(`__tw.find(${JSON.stringify(s)})`).catch(() => null);
  if (!again) return false;
  await page.click(again.x, again.y);
  now = await settle();
  return (await picked()) ? now : false;
}
export async function walkUrl(url, names, tick = () => {}, { device: want, hint, found, routes = [], keep = null, redo = [] } = {}) {
  const t0 = Date.now(), timing = { loads: 0 };
  const main = await openBrowser(DEVICES.desktop);
  const pages = [main], recs = [], queue = [], out = [], seen = new Map(), origin = new URL(url).origin, skipped = [];
  found?.(out);
  const skip = (c, from, why) => { if (skipped.length < 40) skipped.push({ label: c.label, on: from?.name || null, why }); tick({ label: `Skipped “${c.label}”: ${why}` }); };
  let clicks = 0, dev = DEVICES.desktop, exploring = true, batches = 0;
  try {
    // Where a step's element is: if it isn't drawn yet, after the page is drawn whole once (a list that draws its rows as
    // they're scrolled to, a card that fades in on view).
    const locate = async (page, s) => { const q = `__tw.find(${JSON.stringify(s)})`; return (await page.eval(q)) || ((await page.eval('__tw.whole()').catch(() => null)) && (await page.eval(q))); };
    const reach = async (page, steps) => { // from a fresh load, the clicks that lead to a state
      timing.loads++;
      await page.forget(origin);
      await page.go(url);
      await page.eval('__tw.calm()');
      for (const s of steps) {
        if (s.go) { await page.go(origin + s.go); await page.eval(`__tw.arrive(${JSON.stringify(s.go)})`); continue; } // a page the code names: by its address
        const at = await locate(page, s); if (!at) return false;
        if ((await press(page, s, at, () => page.eval(s.to ? `__tw.arrive(${JSON.stringify(s.to)})` : '__tw.calm()'))) === false) return false; // a link's step waits for its page; a tab that won't be picked doesn't lead there
      }
      return true;
    };
    const crewOf = (page) => ({ page, at: null, batch: null, trail: null }); // `at`: the state the page is on, when it's sure; `trail`: the clicks it made since it last loaded
    const go = async (w, steps) => { w.trail = null; const ok = await reach(w.page, steps); if (ok) w.trail = [...steps]; return ok; };
    // A state found on a page whose clicks since it loaded are exactly the state's own can be gone to again by them, so
    // a painter pictures it; one found after clicks that changed nothing the fingerprint sees may not be: pictured here.
    const clean = (w, steps) => !!w.trail && w.trail.length === steps.length && w.trail.every((x, i) => x === steps[i]);
    // A state's picture: the whole length of the page, drawn as it is once scrolled to (its data landed, what waits
    // to be seen shown, late pictures in), its React tree, text styles and sections. A picture's longest side stops
    // at 15,600 px (WebP can't go past 16,383).
    const picture = async (w, r) => {
      if (w.at !== r.key) {
        let there = false;
        if (w.at && w.at === r.from?.key && !r.step.go) { // one click from where it is
          const at = await w.page.eval(`__tw.find(${JSON.stringify(r.step)})`);
          if (at) { const now = await press(w.page, r.step, at, () => w.page.eval(r.step.to ? `__tw.arrive(${JSON.stringify(r.step.to)})` : '__tw.calm()').catch(() => null)); there = !!now && same(now.fp, r.fp); }
        }
        w.at = null;
        if (!there && !(await go(w, r.steps))) { skip(r.step || { label: r.name }, r.from, 'its clicks no longer led there'); return; }
      }
      w.at = null; // picturing resizes and scrolls the page
      const L = r.fp.layer;
      await w.page.idle();
      const len = await w.page.eval('__tw.whole()').catch(() => ({ doc: dev.height, inner: 0 }));
      const cap = Math.floor(15600 / dev.scale);
      let h = dev.mobile && L ? dev.height : Math.min(cap, Math.max(dev.height, len.doc + (L ? 0 : len.inner))); // on a phone, a sheet is the screen it's on (and resizing could close it)
      // The window is made as tall as the page while it's pictured and read when the page can't be pictured past the
      // window by itself: a phone (its tab bar fixed to the bottom of the frame) or an app shell whose content scrolls
      // inside a window-high frame (the frame grows, the content with it). Then back to its height to click.
      const tall = h > dev.height && (dev.mobile || (len.inner > 0 && !L));
      if (tall) { await w.page.size({ height: h }); await w.page.settle(250); await w.page.idle(250, 2500); h = Math.min(cap, Math.max(h, (await w.page.eval('__tw.length()')).doc)); }
      const png = await w.page.shot({ height: h, format: 'webp', quality: 88, scale: h > 4000 ? 0.75 : 1 }); // the browser encodes it; a very long page at 1.5× instead of 2× (still sharp, a third the pixels)
      const tree = await w.page.eval(`__tw.tree(${JSON.stringify(names)})`), text = await w.page.eval('__tw.text()');
      const sections = L ? [] : await w.page.eval(`__tw.sections(${dev.height})`).catch(() => []);
      const values = await w.page.eval(`__tw.values(${JSON.stringify(names)})`).catch(() => []);
      const els = await w.page.eval(`__tw.els(${JSON.stringify(names)})`).catch(() => []); // every block of words as drawn, for matching a design
      if (tall) { await w.page.size({ height: dev.height }); await w.page.settle(150); }
      const thumb = await sharp(png, { limitInputPixels: false }).resize({ width: dev.thumb }).webp({ quality: 80 }).toBuffer(); // drawn at 2×: crops stay sharp
      r.pic = { w: dev.width, h, shot: storeFile(png, 'webp'), thumb: storeFile(thumb, 'webp'), tree, text, sections, values, els, sig: sigOf(tree, text, values) };
      out.push(screenOf(r, r.key, r.from?.key ?? null)); // shown as found during a first walk; numbered when it's all in
      w.at = r.key;
      tick({ found: recs.length, pictured: out.length, label: `Pictured “${r.name}”` });
    };
    const paint = async (w) => {
      for (;;) {
        if (!queue.length) { if (!exploring) return; await wait(150); continue; }
        const r = queue.find((x) => x.from && x.from.key === w.at) || queue.reduce((b, x) => (x.steps.length < b.steps.length ? x : b));
        queue.splice(queue.indexOf(r), 1);
        try { await picture(w, r); } catch (e) { w.at = null; if (!r.again) { r.again = 1; queue.push(r); } else skip(r.step || { label: r.name }, r.from, e.message); }
      }
    };

    // A state, unless it's one found already. Its name and club come from what changed to reach it; its picture later.
    const look = async (w, steps, from, step, batch) => {
      const st = await w.page.eval('__tw.state()');
      const keys = [JSON.stringify(st.fp), ...(!from || st.fp.path !== from.fp.path ? [pageKey(st.fp)] : [])]; // arriving at a page by another link (or the logo, home again) is that page, whatever is open on it
      if (keys.some((k) => seen.has(k))) return null;
      keys.forEach((k) => seen.set(k, null)); // claimed now: another page reaching it meanwhile doesn't keep it twice
      const clickables = await w.page.eval('__tw.clickables()');
      const group = groupOf(st, from, step);
      const r = { key: `k${recs.length}`, seq: recs.length, fp: st.fp, title: st.title, steps, from, step, batch, clickables, group,
        name: group?.kind === 'Options' ? short(tidy(step.label).replace(/\s+\d+$/, '')) : nameOf(st, from, step) };
      keys.forEach((k) => seen.set(k, r)); recs.push(r);
      if (clean(w, steps)) queue.push(r); else { w.at = r.key; await picture(w, r); }
      tick({ found: recs.length, label: `Found “${r.name}”` });
      return r;
    };
    const stagesFrom = async (w, s) => { // a dialog with a Next: every stage, one after another, from where the page is now
      let cur = s;
      for (let n = 0; n < STAGES && recs.length < MAX_SCREENS && clicks < MAX_CLICKS; n++) {
        const adv = cur.clickables.find((c) => c.advance);
        if (!adv) return;
        const at = await w.page.eval(`__tw.find(${JSON.stringify(adv)})`);
        if (!at) return;
        clicks++;
        tick({ done: clicks, label: `Next stage of “${cur.group?.name || cur.name}”` });
        await w.page.click(at.x, at.y); w.trail?.push(adv);
        const now = await w.page.eval('__tw.calm()').catch(() => null);
        if (!now || same(now.fp, cur.fp)) return;
        const next = await look(w, [...cur.steps, adv], cur, adv, cur.batch);
        if (!next) return; // a stage seen before: it loops back
        w.at = next.key;
        offer(next);
        cur = next;
      }
    };

    // Every click a new state offers is a task: what it added over the state it came from (a row's "5s ago" ticking
    // on isn't new), not its Next (stepped through already), and only while it isn't too deep.
    const tasks = [];
    const depthOf = (s) => s.steps.filter((x) => !x.advance && !x.go).length; // stepping through a dialog isn't going deeper, nor is a page opened by its address
    const offer = (from) => {
      if (depthOf(from) >= DEEP) return;
      const known = new Set((from.from?.clickables || []).flatMap((c) => [c.sel, c.label]));
      for (const c of from.clickables) if (!c.advance && !known.has(c.sel) && !known.has(c.label)) tasks.push({ from, c, batch: from.batch ?? batches++ }); // the first screen's clicks each start a batch
    };
    const one = crewOf(main);
    await main.init(WALK);
    await reach(main, []);
    for (let i = 0; i < 4 && !(await main.eval('__tw.drawn()').catch(() => false)); i++) { tick({ label: 'Waiting for the app to draw itself' }); await wait(2000); await reach(main, []); } // a dev server's first load: packages prepared, the page reloaded
    let form = await main.eval('__tw.form()'); // what it's built for, from how it lays out at desktop width
    for (let i = 0; i < 2 && form.span < 240; i++) { await wait(1500); form = await main.eval('__tw.form()'); } // a loader or an intro still on: look again
    const detected = hint || (form.span < 240 ? 'desktop' : deviceOf(form)), device = want || detected;
    if (device !== 'desktop') { dev = DEVICES[device]; tick({ label: `Opening it as a ${device}` }); await main.size(dev); await reach(main, []); }
    // Walking again after a change: the screens from before are kept as they were, and the ones the change touched are
    // gone to again (what they are now, their picture, what's new to click on them).
    const again = [];
    let first;
    if (keep?.length) {
      const redoing = new Set(redo), byId = new Map();
      for (const s of keep) {
        const from = byId.get(s.from) || null, pic = { w: s.w, h: s.h, shot: s.shot, thumb: s.thumb, tree: s.tree, text: s.text, sections: s.sections, values: s.values, els: s.els, sig: s.sig };
        const r = { key: `k${recs.length}`, seq: recs.length, kept: 1, fp: s.fp, title: s.title, steps: s.steps, from, step: s.steps.at(-1) || null, batch: null, clickables: s.clickables || [], group: s.group, name: s.name, ...(redoing.has(s.id) ? { pic: null, old: pic } : { pic }) };
        byId.set(s.id, r); recs.push(r); if (!r.pic) again.push(r);
        seen.set(JSON.stringify(s.fp), r); if (!from || s.fp.path !== from.fp.path) seen.set(pageKey(s.fp), r);
      }
      first = recs[0];
    } else {
      one.trail = [];
      first = await look(one, [], null, null, null);
      one.at = first.key;
    }
    const tokens = await main.eval('__tw.tokens()');
    if (!keep) offer(first);
    // Every page the code names, by its address: a page no link reaches within a few clicks is still a page. Under the
    // address the app opened on when it lives below one (a Vite base, a #/ router).
    const p0 = first.fp.path, base = p0.includes('#/') ? '/#' : p0 === '/' || routes.includes(p0) ? '' : p0.replace(/\/[^/]*$/, '');
    for (const r of routes.slice(0, 24)) { const to = (base && r.startsWith(`${base}/`) ? r : base + r).replace(/\/{2,}/g, '/'); if (to !== p0 && to !== `${p0}/` && `${to}/` !== p0) tasks.push({ from: first, c: { label: pathName(r) || r, role: 'link', to, go: to }, batch: batches++ }); }
    if (first.group && !keep) await stagesFrom(one, first);

    const more = await Promise.all(Array.from({ length: EXPLORERS - 1 + PAINTERS }, () => main.fork().catch(() => null)));
    const ready = [];
    for (const p of more) { if (!p) continue; pages.push(p); ready.push((async () => { await p.init(WALK); if (dev !== DEVICES.desktop) await p.size(dev); })()); }
    await Promise.all(ready);
    const forks = pages.slice(1).map(crewOf);
    const explorers = [one, ...forks.slice(0, EXPLORERS - 1)], painters = forks.slice(EXPLORERS - 1);

    let busy = 0;
    const run = async (w, { from, c, batch }) => {
      tick({ done: clicks, label: c.go ? `Opening ${c.go}` : `Clicking “${c.label}”${from.steps.length ? ` on ${from.name}` : ''}` });
      const settle = async () => { // a link: once its page has come; a whole new page loaded under it: ask that one
        const now = await w.page.eval(!c.go && c.to && c.to !== from.fp.path ? `__tw.arrive(${JSON.stringify(c.to)})` : '__tw.calm()').catch(() => null);
        if (now) return now;
        await wait(1500); return w.page.eval('__tw.calm()').catch(() => null);
      };
      let now;
      if (c.go) { w.at = null; if (!(await go(w, [...from.steps, c]))) return; now = await settle(); } // a page the code names: by its address
      else {
        const reused = w.at === from.key; // already on that state (the last click changed nothing): no reload
        if (!reused) { w.at = null; if (!(await go(w, from.steps))) return; w.at = from.key; }
        const at = reused ? await w.page.eval(`__tw.find(${JSON.stringify(c)})`) : await locate(w.page, c);
        if (!at) { // the page may have changed in a way the state doesn't show (a panel left open by the last click): a fresh load next time
          w.at = null;
          if (reused && !c.again) throw new Error('not on screen on a reused page'); // tried again from a fresh load
          skip(c, from, 'it wasn’t on screen there'); return;
        }
        w.trail?.push(c);
        now = await press(w.page, c, at, settle);
        if (now === false) { w.at = null; throw new Error('it wasn’t picked, clicked twice'); } // tried again from a fresh load, then skipped: not kept under its name
      }
      if (!now || !(await w.page.eval('location.origin')).startsWith(origin)) { w.at = null; return; } // left the app
      if (same(now.fp, from.fp)) return; // nothing a person would call another screen
      w.at = null;
      const s = await look(w, [...from.steps, c], from, c, batch);
      if (s) { w.at = s.key; offer(s); if (s.group && s.group.id !== from.group?.id) { await stagesFrom(w, s); return; } } // a dialog just opened: through its stages now
      else w.at = seen.get(JSON.stringify(now.fp))?.key ?? null; // on a state found before: its clicks need no reload, which in a heavy app is most of the time
    };
    // The next click for a page: one on the state it's on; else from its own batch; else from the batch with the most
    // left. Within those, from the shallowest state, and what leads somewhere (a link, a tab) before an editor's small
    // controls and "more" menus.
    const score = (t) => depthOf(t.from) * 10 + (t.c.to || /^(tab|link|menuitem)/.test(t.c.role) ? 0 : /\b(more|options|settings)\b/i.test(t.c.label) ? 2 : 1);
    const best = (list) => list.reduce((b, t) => (!b || score(t) < score(b) ? t : b), null);
    const nextFor = (w) => {
      let t = tasks.find((x) => x.from.key === w.at) || best(tasks.filter((x) => x.batch === w.batch));
      if (!t) { const left = new Map(); for (const x of tasks) left.set(x.batch, (left.get(x.batch) || 0) + 1); const b = [...left].sort((a, z) => z[1] - a[1])[0][0]; t = best(tasks.filter((x) => x.batch === b)); }
      w.batch = t.batch;
      return tasks.splice(tasks.indexOf(t), 1)[0];
    };
    const revisit = async (w, r) => { // a screen the change touched, gone to again: what it is now and what's new on it
      if (!(await go(w, r.steps))) { r.gone = true; tick({ label: `“${r.name}” isn’t where its clicks lead any more` }); return; }
      const st = await w.page.eval('__tw.state()'), had = new Set(r.clickables.flatMap((c) => [c.sel, c.label]));
      Object.assign(r, { fp: st.fp, title: st.title, clickables: await w.page.eval('__tw.clickables()'), group: groupOf(st, r.from, r.step) });
      if (r.group?.kind !== 'Options') r.name = nameOf(st, r.from, r.step);
      seen.set(JSON.stringify(st.fp), r);
      w.at = r.key; queue.push(r);
      if (depthOf(r) < DEEP) for (const c of r.clickables) if (!c.advance && !had.has(c.sel) && !had.has(c.label)) tasks.push({ from: r, c, batch: r.batch ?? batches++ });
    };
    const explore = async (w) => {
      for (let r; (r = again.shift()); ) { busy++; try { await revisit(w, r); } catch (e) { w.at = null; skip(r.step || { label: r.name }, r.from, e.message); } finally { busy--; } } // kept as it was if it can't be gone to now
      for (;;) {
        if (recs.length >= MAX_SCREENS || clicks >= MAX_CLICKS) return;
        if (!tasks.length) { if (!busy) return; await wait(150); continue; }
        const t = nextFor(w), { from, c } = t;
        if (c.to && seen.has(pageKey({ path: c.to, theme: from.fp.theme }))) continue; // a link to a page already walked: we know where it leads
        if (c.set && recs.filter((x) => x.group?.id === `set:${from.fp.path}:${c.set}`).length >= 6) continue; // six views of one row of filters show what it does
        clicks++; busy++;
        try { await run(w, t); } catch (e) { w.at = null; if (!c.again) tasks.push({ ...t, c: { ...c, again: 1 } }); else skip(c, from, e.message); } finally { busy--; } // a click that breaks the page is tried once more later, then loses that click, not the walk. A page frozen for 20 s too: a dev server just started freezes the pages loading from it, mostly before the click is made (a cold walk lost 5 of 6 states that way)
      }
    };

    let stopped = null; // a walk that breaks part-way keeps what it found
    const explored = Promise.all(explorers.map(explore)).catch((e) => { stopped = e.message; }).finally(() => { exploring = false; timing.explore = Date.now() - t0; });
    try { await Promise.all([explored, ...painters.map(paint), ...explorers.map(async (w) => { await explored; w.at = null; await paint(w); })]); } catch (e) { stopped = e.message; }
    timing.total = Date.now() - t0;

    // Assemble: shallowest first, then in the order found; a screen whose picture failed hands its place to the one
    // before it. Stages count in that order, so "2 of 6" is the same on every walk.
    const lost = (r) => { for (let x = r; x; x = x.from) if (x.gone) return true; return false; }; // its clicks lead nowhere now, or through one that doesn't
    for (const r of recs) if (!r.pic && r.old) r.pic = r.old; // gone to again but not pictured this time: the picture from before
    const done = recs.filter((r) => r.pic && !lost(r)).sort((a, b) => a.steps.length - b.steps.length || a.seq - b.seq);
    const id = new Map(done.map((r, i) => [r, `s${i}`]));
    const up = (r) => { for (let x = r.from; x; x = x.from) if (id.has(x)) return x; return null; };
    const list = [];
    for (const r of done) {
      const from = up(r), g = r.group;
      r.stage = !g ? null : r.fp.layer ? (from?.group?.id === g.id ? (from.stage || 1) + 1 : 1) : list.filter((x) => x.group?.id === g.id).length + 1;
      list.push(screenOf(r, id.get(r), from ? id.get(from) : null));
    }
    const moved = keep ? done.filter((r) => !r.kept || (r.old && r.pic !== r.old && r.pic.sig !== r.old.sig)).map((r) => id.get(r)) : null; // after a change: the screens it moved, and the new ones
    const all = (k) => [...new Set(pages.flatMap((p) => p[k]))];
    return { ...(moved ? { moved } : {}), at: Date.now(), url, device, detected, found: { span: form.span, bar: form.bar, hint: hint || null }, screens: shaped(list), tokens, errors: all('errors').slice(0, 8), failed: all('failed').map((f) => f.replace(origin, '')).filter((f, i, a) => a.indexOf(f) === i).slice(0, 8), names: names.length, skipped, stopped, clicks, timing: { ...timing, pages: pages.length, states: recs.length } };
  } finally { await Promise.all(pages.slice(1).map((p) => p.close().catch(() => {}))); await main.close(); }
}
// What a screen is, to tell whether a change moved it: the components it draws with their props, its text styles and
// the values it draws with (not its words: a clock or a count changes on its own).
const sigOf = (tree, text, values) => createHash('sha1').update(JSON.stringify([tree.map((t) => [t.n, t.props]), text.map((t) => [t.family, t.size, t.weight, t.color]), values.map((v) => [v.prop, v.v, v.n])])).digest('hex').slice(0, 12);
// A screen as the walk keeps it, from a state that has its picture.
const screenOf = (r, id, from) => ({
  id, name: r.name, title: r.title, steps: r.steps, from, trigger: r.step ? { label: r.step.label, role: r.step.role, r: [r.step.x, r.step.y, r.step.w, r.step.h], ...(r.step.advance ? { advance: 1 } : {}) } : null,
  group: r.group, stage: r.stage ?? null, fp: r.fp, ...r.pic, clickables: r.clickables,
});
