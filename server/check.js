// Checks over a walk: Trace measures what a running version draws and says where it disagrees with itself, or with
// what was asked for. Rules, not a model: every finding says what was measured and where.
//   drift: a colour, radius, spacing or text size that is almost, but not exactly, one the app uses everywhere else or
//          declares as a token. Most likely a slip; exact matches and far-off values aren't flagged.
//   scope: the screens a change moved against the screens the ask names. Moved but not named is flagged; an ask that
//          names nothing on a screen is skipped, never guessed.
//   design: what the captured Figma frames and token files say against what runs, and which side changed last.
//   states: what the code can show (loading, error, empty, flags, variants) that no walk has seen and no design shows.
//   stress: the last stress walk (stress.js), when there is one.
//   rules: what the person said no to (a look, or something not to touch) and confirmed as a rule, against the change.
import { screens, touched } from './screens.js';
import { git, needRepo, lastChanges, story, agentOf, rejected } from './history.js';
import { discover } from './frames.js';
import { lastStress } from './stress.js';
import { fromFigma, fromScreen, pairs as pairUp, compare } from './match.js';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { all, get, DATA } from './db.js';

const err = (status, message) => Object.assign(new Error(message), { status });

// Any colour Chrome computes, in OKLab ×100 (a step of 1 is about the smallest a person sees side by side), with its alpha.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLms = (l, m, s) => { [l, m, s] = [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]; return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s].map((x) => x * 100); };
const fromRgb = (r, g, b) => { [r, g, b] = [r, g, b].map(lin); return fromLms(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); };
const fromXyz = (x, y, z) => fromLms(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z, 0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z, 0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z);
const fromLab = (L, a, b) => { // CIE Lab is D50: to XYZ, then to D65 (Bradford)
  const e = 216 / 24389, k = 24389 / 27, fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, f = (t) => (t ** 3 > e ? t ** 3 : (116 * t - 16) / k);
  const X = f(fx) * 0.96422, Y = L > k * e ? fy ** 3 : L / k, Z = f(fz) * 0.82521;
  return fromXyz(0.9554734527 * X - 0.0230985369 * Y + 0.0632593087 * Z, -0.028369707 * X + 1.009995458 * Y + 0.021041399 * Z, 0.012314002 * X - 0.020507696 * Y + 1.330365937 * Z);
};
export function oklab(css) {
  const h = String(css || '').trim().toLowerCase().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)?.[1]; // Figma writes hex
  if (h) { const x = h.length <= 4 ? [...h].map((c) => c + c) : h.match(/../g); return oklab(`rgba(${x.slice(0, 3).map((c) => parseInt(c, 16)).join(',')},${x[3] ? parseInt(x[3], 16) / 255 : 1})`); }
  const m = String(css || '').trim().toLowerCase().match(/^(rgba?|lab|oklab|oklch|color)\((.*)\)$/);
  if (!m) return null;
  const p = m[2].replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean), num = (x, full) => (String(x).endsWith('%') ? (parseFloat(x) / 100) * full : parseFloat(x));
  if (m[1] === 'color') { if (p[0] !== 'srgb') return null; p.shift(); }
  const alpha = p[3] === undefined ? 1 : num(p[3], 1);
  const v = m[1].startsWith('rgb') ? fromRgb(...p.slice(0, 3).map((x) => num(x, 255) / 255))
    : m[1] === 'color' ? fromRgb(...p.slice(0, 3).map((x) => num(x, 1)))
    : m[1] === 'lab' ? fromLab(num(p[0], 100), num(p[1], 125), num(p[2], 125))
    : m[1] === 'oklab' ? [num(p[0], 1) * 100, num(p[1], 0.4) * 100, num(p[2], 0.4) * 100]
    : [num(p[0], 1) * 100, num(p[1], 0.4) * 100 * Math.cos((parseFloat(p[2]) * Math.PI) / 180), num(p[1], 0.4) * 100 * Math.sin((parseFloat(p[2]) * Math.PI) / 180)];
  return v.every(Number.isFinite) ? { v, alpha } : null;
}
// Back to a hex a person reads ("#8b8b8b · 15%"); out-of-gamut channels are clipped.
export function hex(css) {
  const c = oklab(css); if (!c) return css;
  const [L, A, B] = c.v.map((x) => x / 100), cube = (x) => x * x * x;
  const l = cube(L + 0.3963377774 * A + 0.2158037573 * B), m = cube(L - 0.1055613458 * A - 0.0638541728 * B), q = cube(L - 0.0894841775 * A - 1.291485548 * B);
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q]
    .map((x) => Math.round(Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)) * 255).toString(16).padStart(2, '0')).join('');
  return `#${rgb}${c.alpha < 1 ? ` · ${Math.round(c.alpha * 100)}%` : ''}`;
}
const deltaE = (a, b) => Math.hypot(a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2]);

// Near enough to be meant as the same and not the same: colours 0.05–3 apart in OKLab×100 with the same alpha; whole-pixel
// lengths a pixel or 4% apart (fluid sizes, which land on fractions, are left alone).
const FREQ = 5; // used this often across the screens: part of the app's own scale, token or not
const px = (v) => (/rem$/.test(String(v).trim()) ? parseFloat(v) * 16 : parseFloat(v)); // a token's 0.5rem is the 8px Chrome computes
function near(kind, a, b) {
  if (kind === 'colour') { const x = oklab(a), y = oklab(b); if (!x || !y || Math.abs(x.alpha - y.alpha) > 0.02) return null; const d = deltaE(x, y); return d > 0.05 && d <= 3 ? +d.toFixed(2) : null; }
  const x = px(a), y = px(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - Math.round(x)) > 0.001) return null; // 20.9988px is a fluid size that came close to 21, not a 21 typed in
  const d = Math.abs(x - y);
  return d > 0.25 && d <= Math.max(1, 0.04 * y) ? +d.toFixed(2) : null;
}
const same = (kind, a, b) => { // one value written two ways (a token's lab() and the rgb() Chrome computes)
  if (a === b) return true;
  if (kind !== 'colour') return px(a) === px(b);
  const x = oklab(a), y = oklab(b);
  return !!x && !!y && Math.abs(x.alpha - y.alpha) <= 0.02 && deltaE(x, y) <= 0.05;
};
const KIND = { color: 'colour', background: 'colour', border: 'colour', radius: 'radius', space: 'space' };
// Every value the screens draw with, by kind, with how often and up to four places.
export function usedOf(list) {
  const used = new Map();
  const add = (kind, v, n, at) => { const k = `${kind}|${v}`; let e = used.get(k); if (!e) used.set(k, (e = { kind, value: v, n: 0, at: [] })); e.n += n; for (const a of at) if (e.at.length < 4) e.at.push(a); };
  for (const s of list) {
    for (const x of s.values || []) add(KIND[x.prop] || x.prop, x.v, x.n, x.at.map((a) => ({ screen: s.id, name: s.name, component: a.c, r: a.r, text: a.t })));
    for (const t of s.text || []) if (!/^(text|tspan)$/.test(t.tag)) add('size', t.size, t.count, [{ screen: s.id, name: s.name, r: t.r, text: t.sample }]);
  }
  return [...used.values()];
}
export function drift(list, tokens = [], used = usedOf(list)) {
  const declared = tokens.filter((t) => t.kind === 'color').flatMap((t) => [t.value, t.light, t.dark].filter(Boolean).map((v) => ({ v, token: t.name })));
  const out = [];
  for (const kind of ['colour', 'radius', 'space', 'size']) {
    const these = used.filter((e) => e.kind === kind);
    const scale = [...these.filter((e) => e.n >= FREQ).map((e) => ({ v: e.value, n: e.n })), ...(kind === 'colour' ? declared : [])];
    for (const e of these) {
      if (e.n >= FREQ || scale.some((x) => same(kind, x.v, e.value))) continue;
      let best = null;
      for (const x of scale) { const d = near(kind, e.value, x.v); if (d !== null && (!best || d < best.d)) best = { ...x, d }; }
      if (best) out.push({ kind, value: kind === 'colour' ? hex(e.value) : e.value, near: kind === 'colour' ? hex(best.v) : best.v, css: e.value, token: best.token || null, uses: best.n || null, d: best.d, n: e.n, at: e.at });
    }
  }
  return out.sort((a, b) => a.n - b.n || a.d - b.d);
}

// Words of the ask a screen could be named by, and what a screen is named by: its name, title, sections and components
// (CamelCase split, so "ChatQuiz" answers to "chat" and "quiz").
const STOP = new Set('the and for with make made this that from into more less than then them they its page screen app some all can should please just also bit lot very much like want need use using add added change changed fix fixed update updated new old get got does did done have has had are was were been being one two three it\'s don\'t'.split(' '));
const wordsOf = (s) => [...new Set(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])];
export function scope(ask, list, moved) {
  const words = wordsOf(ask).filter((w) => !STOP.has(w));
  if (!words.length) return { skipped: 'The ask has no words that could name a screen.' };
  if (!moved) return { skipped: 'There was no walk before this one to compare with.' };
  const named = (s) => new Set(wordsOf([s.name, s.title, ...(s.sections || []).map((x) => x.name), ...(s.tree || []).map((t) => t.n)].join(' ')));
  const targets = list.filter((s) => { const n = named(s); return words.some((w) => n.has(w)); });
  if (!targets.length) return { skipped: `Nothing on any screen is named by “${words.join(', ')}”.`, words };
  // A target's own dialog stages and row of options, and the screen it opens from, are part of asking for it; the screens
  // it leads to aren't.
  const ok = new Set(targets.flatMap((s) => [s.id, s.from, ...list.filter((x) => s.group && x.group?.id === s.group.id).map((x) => x.id)]));
  const name = (id) => list.find((s) => s.id === id)?.name || id;
  return { words, targets: targets.map((s) => ({ id: s.id, name: s.name })), moved: moved.map((id) => ({ id, name: name(id) })), outside: moved.filter((id) => !ok.has(id)).map((id) => ({ id, name: name(id) })) };
}

// What the design says, from the project's captured Figma frames and design-token files (Tokens Studio, Figma variables
// exported as JSON): each colour, radius, spacing and text size with how often it's used, where, and when the design took
// it (the latest captured change that set it, else when that file was first captured). Tokens stay one entry each.
const tokenKind = (name, v) => (oklab(v) ? 'colour' : !/^-?[\d.]+(px|rem)?$/.test(String(v).trim()) ? null : /radius|rounded/i.test(name) ? 'radius' : /space|spacing|gap|pad|margin|inset/i.test(name) ? 'space' : /font|text|size/i.test(name) ? 'size' : null);
export function designOf(pid) {
  const out = [], byValue = new Map();
  const rows = all("SELECT a.id, a.name, a.tool, a.created_at, s.properties FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND (a.tool='figma' OR lower(a.name) LIKE '%.json')", pid);
  for (const r of rows) {
    const p = r.properties || {}, sets = all('SELECT c.path, c.after, m.end_ts FROM change c JOIN moment m ON m.id=c.moment_id WHERE c.asset_id=? ORDER BY m.end_ts DESC LIMIT 3000', r.id);
    const when = (path, v) => sets.find((c) => c.path === path && String(c.after).includes(String(v)))?.end_ts || r.created_at;
    for (const [name, v] of Object.entries({ ...p.tokens, ...p.variables })) { const kind = tokenKind(name, v); if (kind) out.push({ kind, value: String(v), name, n: 0, where: { file: r.name, token: name }, when: when(name, v) }); }
    for (const n of Object.values(p.nodes || {})) {
      const add = (kind, v, prop) => {
        if (v == null || v === 0) return;
        const k = `${kind}|${v}`, t = when(`${n.name} › ${prop}`, v);
        let e = byValue.get(k); if (!e) byValue.set(k, (e = { kind, value: typeof v === 'number' ? `${v}px` : v, n: 0, where: { file: r.name, node: n.name }, when: t }));
        e.n++; e.when = Math.max(e.when || 0, t || 0);
      };
      for (const c of [...(n.fills || []), ...(n.strokes || [])]) add('colour', c, n.fills?.includes(c) ? 'fills' : 'strokes');
      add('radius', n.radius, 'radius'); add('size', n.font?.size, 'font.size');
      add('space', n.layout?.gap, 'layout.gap'); for (const v of new Set(n.layout?.padding || [])) add('space', v, 'layout.padding');
    }
  }
  return [...out, ...byValue.values()];
}

// The design against what runs: a value the design uses (twice or more, or as a token) that the app draws almost but not
// exactly, and a token both sides name ("color/primary", "color.primary", "--color-primary") with different values.
const tidy = (n) => String(n).toLowerCase().replace(/^--/, '').replace(/[^a-z0-9]+/g, '-');
const show = (kind, v) => (kind === 'colour' ? hex(v) : v);
export function against(design, used, tokens = []) {
  const out = [];
  for (const kind of ['colour', 'radius', 'space', 'size']) {
    const ds = design.filter((d) => d.kind === kind && (d.n >= 2 || d.name));
    for (const e of used.filter((x) => x.kind === kind)) {
      if (design.some((d) => d.kind === kind && same(kind, d.value, e.value))) continue; // the design has it too
      let best = null;
      for (const d of ds) { const dd = near(kind, e.value, d.value); if (dd !== null && (!best || dd < best.d)) best = { ...d, d: dd }; }
      if (best) out.push({ by: 'value', kind, d: best.d, code: { value: show(kind, e.value), n: e.n, at: e.at }, design: { value: show(kind, best.value), name: best.name || null, n: best.n, where: best.where, when: best.when } });
    }
  }
  const named = new Map(design.filter((d) => d.name).map((d) => [tidy(d.name), d]));
  for (const t of tokens) {
    const d = named.get(tidy(t.name)), v = d && (d.kind === 'colour' ? t.light || t.value : t.value);
    if (d && v && !same(d.kind, d.value, v)) out.push({ by: 'name', kind: d.kind, name: t.name, code: { value: show(d.kind, v), token: t.name, at: [] }, design: { value: show(d.kind, d.value), name: d.name, where: d.where, when: d.when } });
  }
  return out.sort((a, b) => (a.by === 'name' ? -1 : 0) - (b.by === 'name' ? -1 : 0) || (b.code.n || 0) - (a.code.n || 0));
}
// An agent's change to a value its ask didn't mention is a person's call, not the design's or the code's.
const ABOUT = { colour: /colou?r|tint|shade|brand|theme|palette/i, radius: /radius|round|corner/i, space: /spac|gap|padding|margin|dense|tight|airy/i, size: /size|font|text|type|bigger|smaller|larger/i };
const mentions = (ask, x) => !!ask && (ABOUT[x.kind].test(ask) || wordsOf(x.name || x.design.name || '').some((w) => !STOP.has(w) && ask.toLowerCase().includes(w)));

// What the code can show that nobody has seen or designed. Each component's states (loading, error and empty branches in
// its own code; on/off flags and variants from its props) are seen when a walked screen drew it that way, and designed
// when a captured Figma name has both its name and the state ("Checkout / Loading", "Button State=Disabled"), and forced
// when the stress walk drew it (`stressed`: its pages with no data, failing data, slow data).
const SHOWS = { loading: /Skeleton|Spinner|Load|Shimmer|Pending|Progress/, error: /Error|Problem|Fail|Alert|Oops/, empty: /Empty|Blank|Nothing|NoResults|Zero/ };
export function inventory(components = [], list = [], names = [], stressed = []) {
  const byName = new Map(components.map((c) => [c.name, c]));
  const look = (screens) => {
    const drawn = new Map(), shown = new Set();
    for (const s of screens) {
      const tree = s.tree || [];
      for (const t of tree) { if (!drawn.has(t.n)) drawn.set(t.n, { props: [], on: new Set() }); drawn.get(t.n).props.push(t.props || {}); drawn.get(t.n).on.add(s.name); }
      // An Empty, Problem or Skeleton drawn inside a component that branches that way: that branch was on screen.
      for (const t of tree) for (const [b, re] of Object.entries(SHOWS)) if (re.test(t.n)) for (let a = tree[t.p], i = 0; a && i < 30; a = tree[a.p], i++) if (byName.get(a.n)?.states?.branches.includes(b)) { shown.add(`${a.n}|${b}`); break; }
    }
    return { drawn, shown };
  };
  const { drawn, shown } = look(list), forced = look(stressed);
  const toks = (x) => (String(x || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !/^(is|has|show)$/.test(w));
  const design = [...new Set(names)].map((n) => new Set(toks(n)));
  const designed = (comp, state) => { const w = [...toks(comp), ...toks(state)]; return design.some((d) => w.every((x) => d.has(x))); };
  const out = [];
  for (const c of components) {
    const st = c.states, seen = drawn.get(c.name);
    if (!st) continue;
    const has = (where, k, test) => !!where?.props.some((p) => Object.entries(p).some(([x, v]) => (k ? x === k : true) && test(x, v)));
    const states = [
      ...st.branches.filter((b) => !st.flags.some((f) => wordsOf(f).some((w) => w.startsWith(b.slice(0, 4))))) // a prop of the same name says it better
        .map((b) => ({ state: b, from: 'code', seen: shown.has(`${c.name}|${b}`), forced: forced.shown.has(`${c.name}|${b}`) })),
      ...st.flags.map((f) => ({ state: f, from: 'prop', seen: has(seen, f, (x, v) => v === true), forced: has(forced.drawn.get(c.name), f, (x, v) => v === true) })),
      ...Object.entries(st.unions).flatMap(([k, opts]) => opts.map((o, i) => ({ state: `${k}: ${o}`, from: 'variant', seen: has(seen, k, (x, v) => v === o) || (i === 0 && !!seen?.props.some((p) => p[k] === undefined)), forced: false }))),
    ].map((x) => ({ ...x, designed: designed(c.name, x.state.split(': ').pop()) }));
    if (states.some((x) => !x.seen && !x.designed)) out.push({ name: c.name, file: c.file, on: seen ? [...seen.on] : [], states });
  }
  const open = (x, from) => x.states.filter((s) => s.from === from && !s.seen && !s.designed && !s.forced).length;
  const weight = (x) => (x.on.length ? 100 : 0) + open(x, 'code') * 10 + open(x, 'prop');
  return out.sort((a, b) => weight(b) - weight(a));
}
const designNames = (pid) => all("SELECT a.name, s.properties FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND a.tool='figma'", pid)
  .flatMap((r) => [r.name, ...Object.values(r.properties?.nodes || {}).map((n) => `${r.name} ${n.name} ${n.component || ''}`)]);

// Flip-flops: a value in the code (a colour, a length, a Tailwind class) that a later commit puts back to what it was:
// A → B → A at the same place. Two flips, or flips by different people or agents, mean nobody has decided it. A place is
// one kind of value (`rounded`, a `text` size, a number) on one line: its file, the function or CSS rule around it (git's
// hunk context) and the line's other words, followed as the line's other values change. A line whose words changed,
// or where two values of one kind changed (which became which?), starts afresh: precise, not complete. Reverts and Trace
// rollbacks are decisions, not flips. `log` is flipLog()'s `git log --reverse -p -U0`.
export const FLIP_FORMAT = '%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1d';
const VALUE = /^(#[0-9a-f]{3,8}|-?\d*\.?\d+(px|rem|em|%|vh|vw|ms|s|deg)?|(?:[\w-]+:)*-?[a-z]+(?:-[\w./%#[\]]+)+)$/i;
const bits = (line) => line.trim().split(/[\s"'`{}();,<>]+/).filter(Boolean);
const family = (x) => { // `text-2xl` and `text-[#979797]` are two kinds: a size and a colour
  if (/^#|^-?[\d.]/.test(x)) return 'value';
  const m = x.match(/^((?:[\w-]+:)*-?[a-z]+)-(.+)$/i);
  return !m ? x : `${m[1]}:${/^(xs|sm|base|md|lg|xl|\dxl|\[[\d.]+(px|rem|em)\])$/.test(m[2]) ? 'size' : /^-?[\d.]+(\/\d+)?$/.test(m[2]) ? 'number' : 'name'}`;
};
export function flips(log, { agentOf = () => null } = {}) {
  const places = new Map();
  const blank = (t, f) => t.map((x) => (VALUE.test(x) && family(x) === f ? '_' : x)).join(' ');
  const record = (file, ctx, c, a, b) => {
    const ta = bits(a), tb = bits(b), A = new Set(ta), B = new Set(tb);
    const gone = [...new Set(ta.filter((x) => !B.has(x)))], came = [...new Set(tb.filter((x) => !A.has(x)))];
    if (!gone.length || gone.length > 3 || came.length > 3 || ![...gone, ...came].every((x) => VALUE.test(x))) return;
    if (tb.every((x) => VALUE.test(x))) return; // a line of values alone could be any line
    const of = (list, f) => list.filter((x) => family(x) === f);
    for (const f of new Set(ta.filter((x) => VALUE.test(x)).map(family))) { // each kind of value on the line keeps its place as the line changes
      const was = `${file}|${ctx}|${f}|${blank(ta, f)}`, now = `${file}|${ctx}|${f}|${blank(tb, f)}`, g = of(gone, f), to = of(came, f), moved = g.length === 1 && to.length === 1;
      if (!moved && !places.has(was)) continue;
      const place = places.get(was) || { file, ctx, line: '', changes: [] };
      places.delete(was); places.set(now, place); place.line = b.trim().slice(0, 100); // as it reads now
      if (moved && place.changes.at(-1)?.sha !== c.sha) place.changes.push({ ...c, from: g[0], to: to[0] });
    }
  };
  for (const rec of log.split('\x1e').slice(1)) {
    const [head, patch = ''] = rec.split('\x1d'), [sha, an, ae, ts, subject = '', body = ''] = head.split('\x1f');
    if (/^Revert\b/.test(subject) || /^Trace-Rolled-Back-To:/im.test(body)) continue;
    const s = story(body), c = { sha, short: sha.slice(0, 7), when: +ts * 1000, who: an, agent: agentOf(an, ae, s), asked: s.asked, title: subject };
    let file = null, hunk = false, ctx = '', minus = [], plus = [];
    const flush = () => { // pair each removed line with the added line most like it: half its words or more the same
      for (const a of minus) {
        let best = null, score = 0.49;
        for (const b of plus) { const x = new Set(bits(a)), y = bits(b), j = y.filter((t) => x.has(t)).length / Math.max(x.size, y.length); if (j > score) { best = b; score = j; } }
        if (best) { record(file, ctx, c, a, best); plus = plus.filter((b) => b !== best); }
      }
      minus = []; plus = [];
    };
    for (const line of patch.split('\n')) {
      if (line.startsWith('diff --git')) { flush(); hunk = false; file = null; }
      else if (!hunk && line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
      else if (line.startsWith('@@')) { flush(); hunk = true; ctx = line.replace(/^@@[^@]*@@\s*/, '').trim(); }
      else if (hunk && file && line[0] === '-') minus.push(line.slice(1));
      else if (hunk && file && line[0] === '+') plus.push(line.slice(1));
    }
    flush();
  }
  const out = [];
  for (const p of places.values()) {
    const seen = new Set([p.changes[0].from]), back = [];
    p.changes.forEach((ch, i) => { if (i && ch.from === p.changes[i - 1].to && seen.has(ch.to)) back.push(ch); seen.add(ch.to); }); // back to a value it had, from the one it had last
    if (!back.length) continue;
    const by = new Set(p.changes.map((x) => x.agent || x.who));
    out.push({ file: p.file, in: p.ctx || null, line: p.line, values: [p.changes[0].from, ...p.changes.map((x) => x.to)], changes: p.changes, flips: back.length, undecided: back.length >= 2 || by.size >= 2 });
  }
  return out.sort((a, b) => b.undecided - a.undecided || b.flips - a.flips || b.changes.at(-1).when - a.changes.at(-1).when).slice(0, 30);
}
// The last 300 commits' changes to the app's code, oldest first, each hunk headed by the function or CSS rule around it
// (git's css and html drivers, switched on for this call only; a CSS rule may be indented, inside @layer or @media).
const UI_FILES = ['*.tsx', '*.jsx', '*.ts', '*.js', '*.css', '*.scss', '*.less', '*.vue', '*.svelte', '*.html'];
export async function flipLog(root, sha = 'now') {
  const attrs = path.join(DATA, 'flip.gitattributes');
  if (!existsSync(attrs)) writeFileSync(attrs, '*.css diff=css\n*.scss diff=css\n*.less diff=css\n*.html diff=html\n*.vue diff=html\n*.svelte diff=html\n');
  return git(root, ['-c', `core.attributesFile=${attrs}`, '-c', 'diff.css.xfuncname=^[[:space:]]*([^[:space:]@/;}][^;{}]*[{])[[:space:]]*$',
    'log', '--reverse', '-n', '300', '--no-merges', '-p', '-U0', '--no-color', `--format=${FLIP_FORMAT}`, sha === 'now' ? 'HEAD' : sha, '--', ...UI_FILES]).catch(() => '');
}

// The checks on a walked version, each finding traced to where it comes from: the file of the component drawing it, the
// last commit that changed that file and what was asked for it. The ask is the one given, else the commit's "Asked:" line.
// Rules a person set, as checks. A look they said no to ("no gradients", "never glass") is a pattern in the code a
// change adds; something they said not to touch ("don't change the nav icons") is the words naming it, found in the
// changed files' paths and components. ruleOf() reads a sentence; learnRules() (chats.js) finds them; ruleBreaks() checks.
export const AVOID = [
  { id: 'gradient', label: 'gradients', said: /\bgradients?\b/i, code: /\b(?:linear|radial|conic)-gradient\(|\bbg-(?:linear|radial|conic)-|\bbg-gradient-to-/ },
  { id: 'glass', label: 'glass and blur', said: /\b(?:glass(?:y|morphism)?|frosted|blur(?:red|s)?)\b/i, code: /\bbackdrop-filter\s*:|\bbackdrop-blur\b|\bfilter\s*:\s*blur\(/ },
  { id: 'gloss', label: 'gloss and glow', said: /\b(?:gloss(?:y)?|glow(?:s|ing|y)?|shiny)\b/i, code: /\b(?:box|text)-shadow\s*:\s*(?:inset\s+)?0(?:px)?\s+0(?:px)?\s+[1-9]|\bdrop-shadow\(\s*0(?:px)?\s+0(?:px)?\s+[1-9]|\b(?:shadow|drop-shadow)-\[0_0_[1-9]/ }, // a glow: a shadow with no offset, only blur
  { id: 'emoji', label: 'emoji', said: /\bemojis?\b/i, code: /\p{Extended_Pictographic}/u },
  { id: 'caps', label: 'all caps', said: /\b(?:all[- ]?caps|uppercase|capital letters)\b/i, code: /\btext-transform\s*:\s*uppercase|(?:^|["'`\s])uppercase(?=["'`\s]|$)/ },
  { id: 'italic', label: 'italics', said: /\bitalics?\b/i, code: /\bfont-style\s*:\s*italic|(?:^|["'`\s])italic(?=["'`\s]|$)/ },
  { id: 'sparkle', label: 'sparkle icons', said: /\bsparkles?\b/i, code: /\bsparkle/i },
];
const NO = /\b(?:no|not|never|don'?t|dont|do not|stop|avoid|without|remove|removed|get rid of|kill|ditch|hate|zero)\b/i;
const KEEP_OFF = /\b(?:don'?t|dont|do not|never|stop)\s+(?:ever\s+)?(?:change|changing|touch|touching|move|moving|modify|edit|editing|redesign|mess with)\s+(?:the\s+|my\s+|our\s+|any\s+)?([a-z][\w\s'-]{2,40}?)(?=[.,;:!?)]|\s*\(|\s+(?:again|anymore|ever|unless|without|while|because|and|or|but|until)\b|$)/i;
const GENERIC = /^(anything|everything|something|thing|things|stuff|code|design|layout|files?|pages?|apps?|bro|broski|padding|margins?|spacing|gaps?|colou?rs?|typography|fonts?|sizes?|radius|radii|styles?|styling|horizontal|vertical|weights?|individually|while|this|that)$/; // a property or filler, not a thing in the app
const stem = (w) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : ''));
export function ruleOf(text) {
  const t = String(text || '');
  const keep = t.match(KEEP_OFF);
  if (keep) { const words = wordsOf(keep[1]).filter((w) => !STOP.has(w) && !GENERIC.test(w)); if (words.length) return { kind: 'protect', words, label: keep[1].trim().replace(/\s+/g, ' ') }; }
  for (const a of AVOID) { const m = t.match(a.said); if (m && NO.test(t.slice(Math.max(0, m.index - 40), m.index).split(/[.;:|(—]/).at(-1))) return { kind: 'avoid', id: a.id, label: a.label }; } // the no just before the look, in its clause ("a gradient, not a cut" prefers one)
  return null;
}
export const ruleKey = (g) => (g.kind === 'avoid' ? `avoid|${g.id}` : `protect|${[...g.words].map(stem).sort().join(' ')}`);
// The change a check looks at: the edits not saved as a version yet, else the last version (for a version, that one).
export async function changeOf(root, sha) {
  const dirty = sha === 'now' && !!(await git(root, ['status', '--porcelain']).catch(() => '')).trim();
  const range = sha !== 'now' ? [`${sha}~1`, sha] : dirty ? ['HEAD'] : ['HEAD~1', 'HEAD'];
  const added = [], changed = new Set();
  let file = null;
  for (const l of (await git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', ...range, '--', ...UI_FILES]).catch(() => '')).split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); if (file !== '/dev/null') changed.add(file); }
    else if (l.startsWith('--- a/')) changed.add(l.slice(6));
    else if (l.startsWith('+') && file && added.length < 5000) added.push({ file, line: l.slice(1).trim() });
  }
  if (dirty) for (const f of (await git(root, ['ls-files', '-o', '--exclude-standard', '--', ...UI_FILES]).catch(() => '')).split('\n').filter(Boolean).slice(0, 30)) { // a new file: all of it is added
    changed.add(f);
    try { for (const line of readFileSync(path.join(root, f), 'utf8').split('\n').slice(0, 2000)) added.push({ file: f, line: line.trim() }); } catch {}
  }
  return { added, changed: [...changed], range: dirty ? 'unsaved edits' : range.join('..') };
}
export function ruleBreaks(rules, { added = [], changed = [] } = {}, ask = '', components = []) {
  const out = [], asked = new Set(wordsOf(ask).map(stem));
  for (const r of rules) {
    const g = r.governs;
    if (g?.kind === 'avoid') {
      const a = AVOID.find((x) => x.id === g.id);
      if (!a || a.said.test(ask)) continue; // "unless asked": the ask names the look
      const hits = added.filter((l) => l.line && !/^(?:\/\/|\/\*|\*|<!--|#)/.test(l.line) && a.code.test(l.line)); // not a comment about it
      if (hits.length) out.push({ rule: r, kind: 'avoid', label: a.label, n: hits.length, hits: hits.slice(0, 5), files: [...new Set(hits.map((h) => h.file))] });
    } else if (g?.kind === 'protect') {
      const want = g.words.map(stem);
      if (want.some((w) => asked.has(w))) continue; // the ask names it: allowed this time
      const named = (f) => { const ws = new Set([...wordsOf(f.replace(/[/\\._-]+/g, ' ')), ...components.filter((c) => c.file === f).flatMap((c) => wordsOf(c.name))].map(stem)); return want.filter((w) => ws.has(w)).length >= Math.min(2, want.length); };
      const files = changed.filter(named);
      if (files.length) out.push({ rule: r, kind: 'protect', label: g.label, files: files.slice(0, 5) });
    }
  }
  return out;
}

export async function check(p, sha, { ask } = {}) {
  const d = screens(p, sha);
  if (!d.screens.length) throw err(409, 'Walk this version first: the checks read what it draws.');
  const r = await needRepo(p).catch(() => null);
  let asked = ask || null;
  if (!asked && r) asked = (await git(r.root, ['log', '-1', '--format=%B', sha === 'now' ? 'HEAD' : sha]).catch(() => '')).match(/^Asked:\s*(.+)$/m)?.[1] || null;
  const code = await discover(p, sha).catch(() => null), fileOf = new Map();
  for (const c of code?.components || []) if (!fileOf.has(c.name)) fileOf.set(c.name, c.file); // nearest the entry first
  const used = usedOf(d.screens), tokens = d.tokens?.tokens || [];
  for (const e of used) for (const a of e.at) a.file = fileOf.get(a.component) || null;
  const dr = drift(d.screens, tokens, used);
  const design = designOf(p.id), pairs = design.length ? against(design, used, tokens) : null;
  const sc = asked ? { ask: asked, ...scope(asked, d.screens, d.since?.moved) } : null;
  if (sc?.outside && code) for (const o of sc.outside) { // why it moved: the changed files that reach it
    const s = d.screens.find((x) => x.id === o.id);
    o.because = s ? (d.since?.files || []).filter((f) => { const t = touched(code, [f], [s]); return t === null || t.length; }).slice(0, 5) : [];
  }
  for (const x of (pairs || []).filter((x) => x.by === 'name' && r)) // the stylesheet that sets the token
    x.code.file = (await git(r.root, ['grep', '-l', '-F', '-e', `${x.name}:`, ...(sha === 'now' ? [] : [sha]), '--', '*.css', '*.scss', '*.less', '*.sass']).catch(() => '')).split('\n')[0].replace(/^[0-9a-f]{7,40}:/, '') || null;
  const rules = all("SELECT id, text, governs FROM decision WHERE project_id=? AND status='confirmed' AND governs IS NOT NULL", p.id).filter((x) => /^(avoid|protect)$/.test(x.governs?.kind));
  const ruled = rules.length && r ? ruleBreaks(rules, await changeOf(r.root, sha), asked || '', code?.components || []) : [];
  const filesOf = (x) => (x.code.file ? [x.code.file] : [...new Set(x.code.at.map((a) => a.file).filter(Boolean))]);
  const want = [...ruled.flatMap((x) => x.files),...dr.flatMap((x) => x.at.map((a) => a.file)), ...(pairs || []).flatMap(filesOf), ...(sc?.outside || []).flatMap((o) => o.because || [])].filter(Boolean);
  const changes = r && want.length ? await lastChanges(p, want, sha).catch(() => ({})) : {};
  // Which side moved: the one that changed last. The other side follows; an agent's unasked change goes to a person.
  for (const x of pairs || []) {
    const last = filesOf(x).map((f) => changes[f] && { ...changes[f], file: f }).filter(Boolean).sort((a, b) => b.when - a.when)[0];
    x.code.last = last ? last.file : null;
    x.moved = !last || !x.design.when ? null : last.when > x.design.when ? 'code' : 'design';
    x.acts = !x.moved ? null : x.moved === 'design' ? 'code' : last.agent && !mentions(last.asked, x) ? 'person' : 'design';
  }
  const log = r ? await flipLog(r.root, sha) : '';
  const st = lastStress(p.id, sha), stressed = (st?.pages || []).flatMap((pg) => ['empty', 'error', 'slow'].map((m) => ({ name: `${pg.name} (${m})`, tree: pg.modes[m]?.tree || [] })));
  const stress = st && { ...st, pages: st.pages.map((pg) => ({ ...pg, modes: Object.fromEntries(Object.entries(pg.modes).map(([m, x]) => [m, x && (({ tree, ...rest }) => rest)(x)])) })) }; // the trees went into the inventory
  return { at: d.at, screens: d.screens.length, since: d.since || null, drift: dr, scope: sc, design: pairs, changes, flips: flips(log, { agentOf: (an, ae, s) => agentOf(an, ae, s, null) }), states: code ? inventory(code.components, d.screens, designNames(p.id), stressed) : null, stress, rules: ruled };
}

// One list of what needs a person, riskiest first: a change outside its ask, a value nobody has decided, the design and
// the code apart, what broke under stress, near-miss values. States nobody has seen come after, as a summary. Each item
// has a stable key, where it comes from (file, commit, ask), and its ways out: a request for an agent, written out for
// the person to send, or a decision ("it's meant", "keep this one") that takes it off the list for good.
const UNDER = { empty: 'no data', error: 'its data failing', slow: 'its data slow', long: 'long text' };
const RULED = { cut: 'text is cut off', sideways: 'it scrolls sideways', over: 'text runs over text', faint: 'text is too faint', blank: 'nothing shows' };
const RISK = ['scope', 'rule', 'broken', 'flip', 'design', 'figma', 'stress', 'drift'];
// A decision that settles a value at a place ("Keep text-2xl in Hero()") whose place in the code now has another value.
export const broken = (decisions, flipList) => decisions.flatMap((x) => {
  const g = x.governs;
  if (g?.kind !== 'value') return [];
  const at = flipList.find((f) => f.file === g.file && (f.in || null) === (g.in || null) && f.values.includes(g.value)), nowIs = at?.values.at(-1);
  return at && nowIs !== g.value ? [{ decision: x, at, nowIs }] : [];
});
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const cut = (t) => (t && t.length >= 40 ? `${t}…` : t); // the walker keeps a text's first 40 characters
// Figma's frames, or another walk's screens (an older version, a prototype, what was approved: a version of this project,
// or `other`, another project's walk), against this walk (match.js): each paired with the screen that draws it, then
// told apart block by block. Between two walks pairs are one to one, so `covered` says how many of the reference's
// screens this walk has (the prototype as the acceptance test); `lacking` are the reference's screens it hasn't, `extra`
// its screens the reference never had.
export async function matchProject(p, sha, { against = 'figma', other = null } = {}) {
  const now = screens(p, sha).screens.filter((s) => s.els?.length).map(fromScreen);
  const why = 'matching reads every block of words on each screen, which walks keep from 29 Oct 2026';
  if (!now.length) throw err(409, `Walk this version again: ${why}.`);
  const figma = against === 'figma' && !other;
  const refs = figma
    ? all("SELECT a.id, a.name, a.updated_at, s.properties FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND a.tool='figma'", p.id).map((a) => ({ ...fromFigma(a), updated_at: a.updated_at })).filter((x) => x.texts.length)
    : screens(other || p, against).screens.filter((x) => x.els?.length).map(fromScreen);
  if (!figma && !refs.length) throw err(409, `Walk ${other ? `“${other.name}”` : 'that version'} again: ${why}.`);
  const paired = pairUp(refs, now, { one: !figma }), seen = new Set(paired.map((x) => x.screen?.id));
  return { against, of: other ? { id: other.id, name: other.name } : null, refs: refs.length, screens: now.length,
    ...(figma ? {} : { covered: paired.filter((x) => x.screen).length, lacking: paired.filter((x) => !x.screen).map((x) => ({ id: x.ref.id, name: x.ref.name, path: x.ref.path })), extra: now.filter((s) => !seen.has(s.id)).map((s) => ({ id: s.id, name: s.name, path: s.path })) }),
    pairs: paired.map(({ ref, screen, score }) => ({ ref: { kind: ref.kind, id: ref.id, name: ref.name, updated_at: ref.updated_at || null }, screen: screen && { id: screen.id, name: screen.name }, score, ...(screen ? compare(ref, screen) : {}) })) };
}

export async function queue(p, sha, { ask } = {}) {
  const c = await check(p, sha, { ask });
  const confirmed = all("SELECT id, text, source_id, source_type, governs FROM decision WHERE project_id=? AND status='confirmed'", p.id);
  const decided = new Set(confirmed.filter((x) => x.source_type === 'check').map((x) => x.source_id));
  const from = (file) => { const ch = file && c.changes[file]; return file ? { file, ...(ch ? { commit: ch.short, by: ch.agent || ch.who, asked: ch.asked, title: ch.title, when: ch.when } : {}) } : null; };
  const items = [];
  for (const o of c.scope?.outside || []) items.push({ key: `scope|${c.scope.ask}|${o.name}`, kind: 'scope', title: `${o.name} changed, but the ask didn’t name it`, detail: `Asked: “${c.scope.ask}”${o.because?.length ? `. It changed because ${o.because.join(', ')} did.` : ''}`, from: from(o.because?.[0]), screen: o.id,
    fix: `Put the screen “${o.name}” back as it was: it changed in the last change, but the ask (“${c.scope.ask}”) didn’t name it.` });
  for (const b of c.rules || []) { // a rule the person set, broken by the change
    const x = b.rule, f0 = b.files[0], many = b.files.length === 1 ? f0 : `${b.files.length} files`;
    items.push(b.kind === 'avoid'
      ? { key: `rule|${x.id}|${b.hits.map((h) => h.file + h.line).join('|').slice(0, 200)}`, kind: 'rule', title: `${cap(b.label)} came back: you said no to ${b.label}`, detail: `${b.n} new line${b.n === 1 ? '' : 's'}, e.g. ${b.hits[0].file}: “${b.hits[0].line.slice(0, 90)}”. Your rule: “${x.text}”`, from: from(f0), where: { file: f0 },
        fix: `Take the ${b.label} out again (${b.files.join(', ')}). The rule is “${x.text}”; the change added ${b.n} line${b.n === 1 ? '' : 's'} like “${b.hits[0].line.slice(0, 90)}”.` }
      : { key: `rule|${x.id}|${b.files.join('|')}`, kind: 'rule', title: `${many} changed: you said not to touch ${b.label}`, detail: `${b.files.join(', ')}. Your rule: “${x.text}”${c.scope?.ask ? `, and the ask (“${c.scope.ask}”) didn’t name it` : ''}.`, from: from(f0), where: { file: f0 },
        fix: `Put ${b.files.join(', ')} back as ${b.files.length === 1 ? 'it was' : 'they were'}: the rule is “${x.text}”, and this change wasn’t asked to touch ${b.label}.` });
  }
  for (const { decision: x, at, nowIs } of broken(confirmed, c.flips || [])) {
    const g = x.governs, last = at.changes.at(-1);
    items.push({ key: `broken|${x.id}|${nowIs}`, kind: 'broken', title: `Decided “${g.value}”, and it’s ${nowIs} again`, detail: `${x.text} Changed back in ${last.short} by ${last.agent || last.who}${last.asked ? `, asked “${String(last.asked).slice(0, 80)}”` : ` (“${last.title}”)`}.`,
      from: from(g.file), where: { file: g.file, in: g.in || null, line: at.line }, fix: `Set ${nowIs} back to ${g.value} in ${g.file}${g.in ? `, in ${g.in.replace(/\s*\{$/, '')}` : ''}: it was decided (“${x.text}”).` });
  }
  for (const f of c.flips || []) {
    if (!f.undecided) continue;
    const values = [...new Set(f.values)];
    items.push({ key: `flip|${f.file}|${f.in}|${[...values].sort().join(',')}`, kind: 'flip', title: `${values.join(' or ')}? It keeps changing back`, detail: null, from: from(f.file), choices: values, now: f.values.at(-1),
      history: f.changes.map((x) => ({ commit: x.short, by: x.agent || x.who, from: x.from, to: x.to, said: x.asked || x.title, when: x.when })), where: { file: f.file, in: f.in || null, line: f.line } });
  }
  for (const x of c.design || []) {
    const what = x.by === 'name' ? x.name : `${x.kind} ${x.code.value}`;
    items.push({ key: `design|${x.by}|${x.name || x.code.value}|${x.design.value}`, kind: 'design', title: x.by === 'name' ? `${x.name} is ${x.code.value} in the code and ${x.design.value} in the design` : `${x.code.value} is drawn where the design uses ${x.design.value}`,
      detail: !x.moved ? 'Can’t tell which side changed last.' : x.acts === 'person' ? 'An agent changed it without being asked: your call.' : x.moved === 'code' ? 'The code changed last: update the design, or put the code back.' : 'The design changed last: the code should follow.',
      from: from(x.code.last), fix: x.acts === 'design' ? null : `Change ${what}${x.code.at?.[0]?.component ? ` (in ${x.code.at[0].component})` : ''} to ${x.design.value}, as the design has it${x.design.name ? ` (${x.design.name})` : ''}.` });
  }
  const base = new Map(); // what the pages already have, as they are: one item per rule, however many pages
  for (const pg of c.stress?.pages || []) for (const f of pg.modes.base?.found || []) { if (!base.has(f.rule)) base.set(f.rule, { pages: new Set(), found: [] }); base.get(f.rule).pages.add(pg.name); base.get(f.rule).found.push(f); }
  for (const [rule, b] of base) {
    const worst = rule === 'faint' ? [...b.found].sort((x, y) => x.ratio - y.ratio)[0] : b.found[0];
    items.push({ key: `stress|base|${rule}`, kind: 'stress', title: `${cap(RULED[rule] || rule)}, as it is, on ${b.pages.size === 1 ? [...b.pages][0] : `${b.pages.size} pages`}`, detail: `${b.found.length}× · ${worst.t ? `“${cut(worst.t)}”` : ''}${worst.ratio ? ` at ${worst.ratio}:1 (needs ${worst.need}:1)` : ''}`,
      fix: `${cap(RULED[rule] || rule)} on ${[...b.pages].join(', ')}${worst.t ? `, for example “${worst.t}”` : ''}${worst.ratio ? ` (${worst.ratio}:1; WCAG needs ${worst.need}:1)` : ''}. Fix it everywhere it happens.` });
  }
  for (const pg of c.stress?.pages || []) for (const m of ['empty', 'error', 'slow', 'long']) {
    const r = pg.modes[m];
    if (!r || (!r.found.length && !r.errors.length)) continue;
    const rules = [...new Set(r.found.map((f) => f.rule))], said = [...rules.map((k) => RULED[k] || k), ...(r.errors.length ? [`it throws “${r.errors[0]}”`] : [])].join(', ');
    items.push({ key: `stress|${pg.at}|${m}|${rules.sort().join(',')}|${r.errors.length}`, kind: 'stress', title: `${pg.name}, with ${UNDER[m]}: ${said}`, detail: r.found.slice(0, 3).map((f) => f.t).filter(Boolean).map((t) => `“${cut(t)}”`).join(', '), shot: r.shot,
      fix: `On ${pg.at}, with ${UNDER[m]}, ${said}${r.found[0]?.t ? ` (for example “${r.found[0].t}”)` : ''}. Make it hold up in that state.` });
  }
  for (const x of c.drift) {
    const a = x.at[0] || {};
    items.push({ key: `drift|${x.kind}|${x.css}|${x.near}`, kind: 'drift', screen: a.screen, title: `${x.kind[0].toUpperCase()}${x.kind.slice(1)} ${x.value} is almost ${x.near}`, detail: `${x.n}× on ${a.name}${a.component ? `, in ${a.component}` : ''}${a.text ? ` (“${a.text}”)` : ''}. ${x.token ? `${x.near} is the token ${x.token}` : `${x.near} is used ${x.uses}× elsewhere`}.`, from: from(a.file),
      fix: `Use ${x.near}${x.token ? ` (${x.token})` : ''} instead of ${x.value} for the ${x.kind === 'space' ? 'spacing' : x.kind === 'size' ? 'text size' : x.kind}${a.component ? ` in ${a.component}` : ''}${a.file ? ` (${a.file})` : ''}.` });
  }
  // Figma's frames against what runs: one item a frame, what differs, and which side changed last (that side moved; the
  // other follows, as with the design's values above).
  if (get("SELECT 1 x FROM asset WHERE project_id=? AND tool='figma' LIMIT 1", p.id)) {
    const fm = await matchProject(p, sha).catch(() => null), code = fm && await discover(p, sha).catch(() => null);
    const fileOf = new Map((code?.components || []).map((x) => [x.name, x.file]));
    for (const x of fm?.pairs || []) {
      if (!x.screen || (!x.diffs.length && !x.missing.length && !x.reworded.length)) continue;
      const files = [...new Set(x.diffs.map((d) => fileOf.get(d.c)).filter(Boolean))], ch = files.length ? await lastChanges(p, files, sha).catch(() => ({})) : {};
      const last = Object.values(ch).sort((a, b) => b.when - a.when)[0], moved = last && x.ref.updated_at ? (last.when > x.ref.updated_at ? 'code' : 'design') : null;
      const lines = [...x.diffs.map((d) => `${d.prop} ${d.ref} → ${d.now} on “${d.t.slice(0, 40)}”${d.c ? ` (${d.c})` : ''}`), ...x.reworded.map((w) => `words “${w.ref.slice(0, 50)}” → “${w.now.slice(0, 50)}”`), ...x.missing.map((m) => `“${m.t.slice(0, 50)}” isn't on the screen`)];
      items.push({ key: `figma|${x.ref.id}|${lines.length}|${x.diffs.map((d) => d.prop + d.now).join(',')}`, kind: 'figma', title: `“${x.ref.name}” in Figma and “${x.screen.name}”: ${lines.length} ${lines.length === 1 ? 'difference' : 'differences'}`,
        detail: `${lines.slice(0, 3).join(' · ')}${lines.length > 3 ? ` · and ${lines.length - 3} more` : ''}. ${moved === 'code' ? 'The code changed last: update Figma, or put the code back.' : moved === 'design' ? 'Figma changed last: the code should follow.' : `${x.matched} of ${x.of} blocks of words matched.`}`,
        from: from(files[0]), screen: x.screen.id, fix: moved === 'code' ? null : `Make “${x.screen.name}” match the Figma frame “${x.ref.name}”: ${lines.slice(0, 12).join('; ')}.` });
    }
  }
  const open = items.filter((x) => !decided.has(x.key)).sort((a, b) => RISK.indexOf(a.kind) - RISK.indexOf(b.kind));
  const unseen = (c.states || []).map((x) => ({ name: x.name, file: x.file, on: x.on.length, states: x.states.filter((s) => !s.seen && !s.designed && !s.forced).map((s) => s.state) })).filter((x) => x.states.length);
  return { at: c.at, sha, ask: c.scope?.ask || null, items: open, decided: items.length - open.length, stress: c.stress ? { at: c.stress.at, data: c.stress.data, pages: c.stress.pages.length } : null,
    states: { n: unseen.reduce((k, x) => k + x.states.length, 0), top: unseen.slice(0, 6), forced: (c.states || []).reduce((k, x) => k + x.states.filter((s) => s.forced && !s.seen).length, 0) } };
}

// The "no" list for agents: versions undone (history.js `rejected`) and values tried and dropped (a flip-flop by one hand:
// B tried, then back to A). Undecided flip-flops aren't here: nobody has said no to either side yet.
export async function noList(p) {
  const r = await needRepo(p).catch(() => null);
  const [undone, log] = await Promise.all([rejected(p).catch(() => []), r ? flipLog(r.root) : '']);
  const values = flips(log, { agentOf: (an, ae, s) => agentOf(an, ae, s, null) }).filter((f) => !f.undecided).flatMap((f) => f.changes.filter((c, i) => i && c.from === f.changes[i - 1].to && f.values.slice(0, i + 1).includes(c.to))
    .map((c) => ({ tried: c.from, went_back_to: c.to, where: `${f.file}${f.in ? `, in ${f.in.replace(/\s*\{$/, '')}` : ''}`, line: f.line, when: c.when, by: c.agent || c.who, said: c.asked || c.title })));
  return { versions: undone, values };
}

// DESIGN.md and design.tokens.json, written from what runs: the colours the app draws (its own tokens, and a library's
// palette only where a screen uses it), the type scale measured on its screens, the radii and spacing it uses often
// enough to be its scale, its components with their states, its decisions and what was tried and undone. Tokens follow
// DTCG 2025.10 (colour objects, dimension objects, typography composites); dark values ride in $extensions. Nothing is
// written here: the API proposes both files and the person writes them.
const PALETTE = /^--color-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(-\d+)?$/;
const dim = (v) => { const n = px(v); return Number.isFinite(n) ? { value: +n.toFixed(2), unit: 'px' } : null; };
const rgbOf = (h) => { const m = String(h).match(/^#([0-9a-f]{6})/i); return m ? m[1].match(/../g).map((x) => +(parseInt(x, 16) / 255).toFixed(4)) : null; };
// An ask as one line: a page-feedback paste ("## Page Feedback … **Feedback:** make it…") by its feedback, else its first
// plain sentence.
const gist = (t) => { const x = String(t || ''); const fb = x.match(/\*\*(?:Feedback|Comment):?\*\*:?\s*(.+)/i)?.[1]; const line = fb || x.split('\n').map((l) => l.trim()).find((l) => l && !/^(#|\[|\*\*|<|```|-{3})/.test(l)) || ''; return line.length > 120 ? `${line.slice(0, 119)}…` : line; };
const colourValue = (css) => { const h = hex(css), a = oklab(css)?.alpha ?? 1, c = rgbOf(h); return c && { colorSpace: 'srgb', components: c, ...(a < 1 ? { alpha: +a.toFixed(3) } : {}), hex: h.slice(0, 7) }; };
export async function designDoc(p, sha) {
  const d = screens(p, sha);
  if (!d.screens.length) throw err(409, 'Walk this version first: DESIGN.md is written from what it draws.');
  const code = await discover(p, sha).catch(() => null), used = usedOf(d.screens), tokens = d.tokens?.tokens || [];
  const byHex = new Map(); // one colour Chrome writes two ways (rgb, lab) is one colour
  for (const e of used.filter((x) => x.kind === 'colour')) { const h = hex(e.value), was = byHex.get(h); byHex.set(h, { value: e.value, n: (was?.n || 0) + e.n }); }
  const colours = [...byHex.values()].sort((a, b) => b.n - a.n);
  const drawn = (v) => colours.some((e) => same('colour', e.value, v));
  // The app's own colours: the tokens its own code declares (a dev tool's, from its package, aren't), and a library's
  // palette only where a screen draws it.
  const r = await needRepo(p).catch(() => null), names = tokens.filter((t) => t.kind === 'color').map((t) => t.name);
  const declared = new Set(r && names.length ? (await git(r.root, ['grep', '-o', '-h', '-I', '-F', ...names.flatMap((n) => ['-e', `${n}:`]), ...(sha === 'now' ? [] : [sha]), '--', '.', ':!node_modules', ':!dist', ':!.next']).catch(() => '')).split('\n').map((l) => l.trim().replace(/:$/, '')) : []);
  const colourTokens = tokens.filter((t) => t.kind === 'color' && t.light && (PALETTE.test(t.name) ? drawn(t.light) : declared.has(t.name)));
  const scale = (kind) => used.filter((e) => e.kind === kind && e.n >= FREQ && Math.abs(px(e.value) - Math.round(px(e.value))) < 0.001).sort((a, b) => px(a.value) - px(b.value));
  const decisions = all("SELECT text, source_type FROM decision WHERE project_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 40", p.id);
  const no = await noList(p).catch(() => ({ versions: [], values: [] }));
  const comps = (code?.components || []).filter((c) => c.kind === 'component' && !/(^|\/)\.[^/]+\/|\.(stories|preview)\.[jt]sx?$/.test(c.path)).slice(0, 80); // not a tool's previews or stories
  const cats = [...new Set(comps.map((c) => c.cat))];
  const statesOf = (c) => { const st = c.states || {}; return [...Object.entries(st.unions || {}).map(([k, o]) => `${k}: ${o.join(' / ')}`), ...(st.flags || []), ...(st.branches || []).map((b) => `${b} (in its code)`)].join('; '); };
  const name = (t) => t.replace(/^--/, '');
  const md = [
    `# Design: ${p.name}`, '',
    `Written by Trace from the running app (${d.screens.length} screens, walked ${new Date(d.at).toISOString().slice(0, 10)}) and its code. Use these values; a value that's almost one of them is drift, and Trace's \`check_change\` flags it. Tokens: \`design.tokens.json\` (DTCG).`, '',
    '## Colours', '',
    ...(colourTokens.length ? ['| Token | Light | Dark |', '|---|---|---|', ...colourTokens.map((t) => `| \`${t.name}\` | ${hex(t.light)} | ${t.dark ? hex(t.dark) : '·'} |`), ''] : []),
    `Most drawn on screen: ${colours.slice(0, 10).map((e) => `${hex(e.value)} (${e.n}×)`).join(', ')}.`, '',
    '## Type', '',
    '| Role | Size / line height | Weight | Font | Used |', '|---|---|---|---|---|',
    ...(d.type || []).map((t) => `| ${t.role} | ${t.size} / ${t.lh} | ${t.weight} | ${t.family} | ${t.count}× |`), '',
    '## Shape and space', '',
    `Radius: ${scale('radius').map((e) => `${e.value} (${e.n}×)`).join(', ') || 'none used often'}.`,
    `Spacing: ${scale('space').map((e) => `${e.value} (${e.n}×)`).join(', ') || 'none used often'}.`,
    ...(tokens.some((t) => t.kind === 'shadow') ? [`Shadows: ${tokens.filter((t) => t.kind === 'shadow').slice(0, 8).map((t) => `\`${t.name}\``).join(', ')}.`] : []),
    ...tokens.filter((t) => t.kind === 'motion').slice(0, 8).map((t) => `- Motion \`${t.name}\`: ${t.value}`), '',
    '## Components', '',
    ...cats.flatMap((k) => [`### ${k}`, '', ...comps.filter((c) => c.cat === k).map((c) => `- **${c.name}** (\`${c.path}\`)${statesOf(c) ? `: ${statesOf(c)}` : ''}`), '']),
    ...(decisions.length ? ['## Decisions', '', ...decisions.map((x) => `- ${x.text}`), ''] : []),
    ...(no.versions.length || no.values.length ? ['## Tried and undone (don\'t bring these back unless asked)', '',
      ...no.versions.map((v) => `- ${v.tried.length ? v.tried.map((t) => `“${t.title}”${gist(t.asked) ? ` (asked: “${gist(t.asked)}”)` : ''}`).join('; ') : 'An earlier change'}, undone by “${v.undone_by.title}”${gist(v.undone_by.asked) ? ` (asked: “${gist(v.undone_by.asked)}”)` : ''}.`),
      ...no.values.map((v) => `- ${v.tried} in ${v.where}, back to ${v.went_back_to}.`), ''] : []),
  ].join('\n');
  const group = (list, key, val) => Object.fromEntries(list.map((x) => [key(x), val(x)]).filter(([, v]) => v));
  const json = {
    $description: `${p.name}, as Trace measured it running (${new Date(d.at).toISOString().slice(0, 10)}). DTCG 2025.10.`,
    color: group(colourTokens, (t) => name(t.name).replace(/^color-/, ''), (t) => { const v = colourValue(t.light); return v && { $type: 'color', $value: v, ...(t.dark ? { $extensions: { 'app.trace': { dark: colourValue(t.dark), css: t.name } } } : { $extensions: { 'app.trace': { css: t.name } } }) }; }),
    radius: group(scale('radius'), (e) => String(px(e.value)), (e) => ({ $type: 'dimension', $value: dim(e.value), $description: `used ${e.n}×` })),
    space: group(scale('space'), (e) => String(px(e.value)), (e) => ({ $type: 'dimension', $value: dim(e.value), $description: `used ${e.n}×` })),
    type: group(d.type || [], (t) => t.role.toLowerCase().replace(/[^a-z0-9]+/g, '-'), (t) => ({ $type: 'typography', $value: { fontFamily: t.family, fontSize: dim(t.size), fontWeight: t.weight, lineHeight: +(px(t.lh) / px(t.size)).toFixed(3) || 1.2, letterSpacing: t.ls === 'normal' ? { value: 0, unit: 'px' } : dim(t.ls) } })),
  };
  return { files: [{ path: 'DESIGN.md', content: `${md}\n` }, { path: 'design.tokens.json', content: `${JSON.stringify(json, null, 2)}\n` }] };
}
