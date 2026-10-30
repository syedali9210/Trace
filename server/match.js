// The matcher: a reference (a Figma frame as Trace captures it, or a screen from another walk: an older version, a
// prototype, what was approved) paired with the screen of the running app that draws it, and told apart block by block.
//   Pairing: by the words they share (how much of the reference's words are on the screen), then the reference's name
//   against the screen's name and address, then the device's shape. A frame can be one section of a long page.
//   Inside a pair: each block of words in the reference finds its block on the screen by the same words (the one
//   nearest where the reference puts it, once the pair's offset is known from the blocks that are there only once),
//   then by most words in common nearby; then type (font, size, weight, line height, letter spacing), colour and the
//   box around it (fill, radius, padding, border) are compared. A frame wider than the walk (1440 against 1280) may
//   scale: a size that scaled with it is no difference. Words in the reference that aren't on the screen are reported,
//   and, between two walks, words that are new.
import { oklab, hex } from './check.js';

const norm = (t) => String(t || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const key = (t) => norm(t).replace(/\b\d{1,2}:\d{2}(:\d{2})?(\s*[ap]\.?m\.?)?\b/g, '#:#'); // a live clock reads differently on every walk: not a change
const wordsOf = (t) => new Set(key(t).match(/[a-z0-9][a-z0-9'-]+/g) || []);
const family = (f) => norm(f).replace(/\b(variable|vf|var|fallback)\b/g, '').replace(/[^a-z0-9]/g, '');
const dE = (a, b) => { const x = oklab(a), y = oklab(b); return x && y ? Math.hypot(x.v[0] - y.v[0], x.v[1] - y.v[1], x.v[2] - y.v[2]) + Math.abs(x.alpha - y.alpha) * 100 : null; };
const shape = (w) => (w <= 500 ? 'phone' : w <= 1000 ? 'tablet' : 'desktop');
const BOX = new Set(['fill', 'radius', 'border', 'padding']);
const median = (l) => { if (!l.length) return 0; const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// A Figma frame, from the connector's snapshot ({ root: { w, h }, nodes: { id: normNode } }): its blocks of words, each
// with the smallest filled, round or outlined shape around it as its box.
export function fromFigma(asset) {
  const p = asset.properties || {}, nodes = Object.entries(p.nodes || {}).map(([id, n]) => ({ id, ...n })).filter((n) => n.w > 0 && n.h > 0);
  const shapes = nodes.filter((n) => n.type !== 'TEXT' && (n.fills?.length || n.radius || n.strokes?.length));
  const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const texts = nodes.filter((n) => n.type === 'TEXT' && n.text?.trim()).map((n) => {
    const around = shapes.filter((s) => inside(n, s)).sort((a, c) => a.w * a.h - c.w * c.h), f = around.find((s) => s.fills?.length);
    const b = around.find((s) => !(s.w >= (p.root?.w || 1e9) - 1 && s.h >= (p.root?.h || 1e9) - 1)); // not the frame's own background
    return { id: n.id, t: n.text.replace(/\s+/g, ' ').trim(), r: [n.x, n.y, n.w, n.h], font: n.font?.family || null, size: n.font?.size ?? null, weight: n.font?.weight ?? null, lh: n.font?.lineHeight ?? null, ls: n.font?.letterSpacing ?? null, color: n.fills?.[0] || null,
      box: b && { r: [b.x, b.y, b.w, b.h], fill: b.fills?.[0] || null, radius: b.radius || 0, pad: b.layout?.padding || null, border: b.strokes?.[0] || null }, bg: f ? { c: f.fills[0], r: [f.x, f.y, f.w, f.h] } : null };
  });
  return { kind: 'figma', id: asset.id, name: asset.name, w: p.root?.w || 0, h: p.root?.h || 0, texts };
}
// A walked screen (screens.js keeps `els`, every block of words as drawn).
export const fromScreen = (s) => ({ kind: 'screen', id: s.id, name: s.name, path: s.fp?.path || s.path || '', w: s.w || 0, h: s.h || 0, texts: (s.els || []).map((e) => ({ ...e, color: e.color })) });

// The blocks of words there once on each side, with how far each moved (`k` scales a frame wider than the walk), the
// page's median move, and the screen's blocks by their words.
function anchors(ref, scr) {
  const k = ref.kind === 'figma' && ref.w && scr.w ? scr.w / ref.w : 1, by = new Map(), n = new Map();
  for (const x of scr.texts) { const t = key(x.t); if (!by.has(t)) by.set(t, []); by.get(t).push(x); }
  for (const a of ref.texts) n.set(key(a.t), (n.get(key(a.t)) || 0) + 1);
  const once = ref.texts.filter((a) => n.get(key(a.t)) === 1 && by.get(key(a.t))?.length === 1).map((a) => { const b = by.get(key(a.t))[0]; return [a, b, b.r[0] - a.r[0] * k, b.r[1] - a.r[1] * k]; });
  return { k, by, once, dx: median(once.map((o) => o[2])), dy: median(once.map((o) => o[3])) };
}

// How well a reference and a screen go together, 0–1.
export function pairScore(ref, scr) {
  const F = new Set(ref.texts.flatMap((x) => [...wordsOf(x.t)])), S = new Set(scr.texts.flatMap((x) => [...wordsOf(x.t)]));
  if (F.size < 3) return 0;
  let shared = 0; for (const w of F) if (S.has(w)) shared++;
  const N = [...wordsOf(ref.name)].filter((w) => w.length > 2), on = wordsOf(`${scr.name} ${scr.path.replace(/[/#?=-]/g, ' ')}`);
  const named = N.length ? N.filter((w) => on.has(w)).length / N.length : 0;
  const { once, dx, dy } = anchors(ref, scr), fit = once.length ? once.filter((o) => Math.abs(o[2] - dx) <= 16 && Math.abs(o[3] - dy) <= 16).length / once.length : 0;
  // mostly the reference's words on the screen; then its name; then, for the tabs or dialogs of one page (nearly the
  // same words), whether its blocks sit as they do on the reference, and how little else the screen has
  return (0.8 * shared / F.size) * (shape(ref.w) === shape(scr.w) ? 1 : 0.6) + 0.1 * named + 0.05 * fit + 0.05 * shared / Math.max(1, S.size);
}
// Each reference with the screen it draws. A screen can draw several frames (sections of one page); between two walks
// (`one`) each screen is one screen's only, best pairs first, the screen of the same name and address before any.
export function pairs(refs, screens, { least = 0.4, one = false } = {}) {
  const words = (x) => new Set(x.texts.flatMap((b) => [...wordsOf(b.t)])), R = one ? refs.map(words) : [], S = one ? screens.map(words) : [];
  // between walks, what makes a screen that screen: its words that the one most like it among the others lacks (a
  // tab's panel, a dialog's). The screen that covers it has most of them, or is at the same address (not the root).
  const own = R.map((w, i) => { let sib = null, best = -1; R.forEach((v, j) => { if (j === i) return; let n = 0; for (const t of w) if (v.has(t)) n++; const jac = n / (w.size + v.size - n || 1); if (jac > best) { best = jac; sib = v; } }); return sib ? [...w].filter((t) => !sib.has(t)) : []; });
  // A screen with none of its own (home with a section folded) is covered only by one with nearly all its words.
  const covers = (i, j, v) => (own[i].length ? own[i].filter((t) => S[j].has(t)).length >= own[i].length / 2 : v >= 0.75) || (refs[i].path && refs[i].path !== '/' && refs[i].path === screens[j].path);
  const sc = refs.map((ref, i) => screens.map((s, j) => { if (!one) return pairScore(ref, s); if (s.name === ref.name && s.path === ref.path) return 2; const v = pairScore(ref, s); return covers(i, j, v) ? v : 0; }));
  const out = new Map(), taken = new Set(), top = (i) => +Math.min(1, Math.max(0, ...sc[i])).toFixed(2);
  const cands = sc.flatMap((row, i) => row.map((v, j) => [v, i, j])).filter(([v]) => v >= least).sort((a, b) => b[0] - a[0]);
  for (const [v, i, j] of cands) if (!out.has(i) && !(one && taken.has(j))) { out.set(i, { ref: refs[i], screen: screens[j], score: +Math.min(1, v).toFixed(2) }); taken.add(j); }
  return refs.map((ref, i) => out.get(i) || { ref, screen: null, score: top(i) });
}

// Two blocks of words told apart. `k` is how much the reference scales to the screen (its width against the screen's).
const close = (a, b, k, tol) => Math.abs(a - b) <= tol(b) || (k !== 1 && Math.abs(a * k - b) <= tol(b));
const px = (v) => `${Math.round(v * 10) / 10}px`;
const bgOf = (x) => (x.bg !== undefined ? x.bg : x.box?.fill ? { c: x.box.fill, r: x.box.r } : null); // what the words sit on (walks before it was kept: their box's fill)
function differ(a, b, k) {
  const out = [], put = (prop, ref, now) => out.push({ prop, ref, now });
  if (a.size != null && b.size != null && !close(a.size, b.size, k, (v) => Math.max(0.5, 0.03 * v))) put('size', px(a.size), px(b.size));
  if (a.weight != null && b.weight != null && +a.weight !== +b.weight) put('weight', String(a.weight), String(b.weight));
  if (a.font && b.font && family(a.font) !== family(b.font) && !family(b.font).includes(family(a.font)) && !family(a.font).includes(family(b.font))) put('font', a.font, b.font);
  if (a.lh && b.lh && !close(a.lh, b.lh, k, (v) => Math.max(1, 0.05 * v))) put('line height', px(a.lh), px(b.lh));
  if (a.ls != null && b.ls != null && !close(a.ls, b.ls, k, () => 0.3)) put('letter spacing', px(a.ls), px(b.ls));
  if (a.color && b.color && (dE(a.color, b.color) ?? 0) > 3) put('colour', hex(a.color), hex(b.color));
  const f = bgOf(a), g = bgOf(b); // the colour behind the words, not the box's own: a box that lost its line isn't a new fill
  if (!!f !== !!g || (f && g && (dE(f.c, g.c) ?? 0) > 3)) put('fill', f ? hex(f.c) : 'none', g ? hex(g.c) : 'none');
  const x = a.box, y = b.box;
  if (x || y) {
    const rad = (v) => Math.min(v || 0, 999), radius = (v) => (v >= 999 ? 'full' : px(v || 0)); // a pill's 9999px (Tailwind's rounded-full) is "full"
    // a box found for another reason (it lost its line or fill, so the box around the words is now an element around
    // it) and of another size is another element: its corners and padding aren't this one's
    const other = x && y && (!!x.border !== !!y.border || !!x.fill !== !!y.fill) && !(close(x.r[2], y.r[2], k, (v) => Math.max(4, 0.05 * v)) && close(x.r[3], y.r[3], k, (v) => Math.max(4, 0.05 * v)));
    if (x && y && !other && !close(rad(x.radius), rad(y.radius), k, () => 1)) put('radius', radius(x.radius), radius(y.radius));
    if (!!x?.border !== !!y?.border || (x?.border && y?.border && (dE(x.border, y.border) ?? 0) > 3)) put('border', x?.border ? hex(x.border) : 'none', y?.border ? hex(y.border) : 'none');
    if (x?.pad && y?.pad && !other) { const side = ['top', 'right', 'bottom', 'left'].filter((_, i) => !close(x.pad[i], y.pad[i], k, () => 2)); if (side.length) put('padding', x.pad.map(px).join(' '), y.pad.map(px).join(' ')); }
  }
  return out;
}

// One pair, block by block.
export function compare(ref, scr) {
  const { k, by, once, dx, dy } = anchors(ref, scr);
  // a block goes where the blocks around it went (a section moves when one above it grows): the median shift of the
  // three nearest blocks that are there once on both sides, else the page's
  const shift = new Map(ref.texts.map((a) => { const n = once.map(([x, , ox, oy]) => [Math.hypot(x.r[0] - a.r[0], x.r[1] - a.r[1]), ox, oy]).sort((m, o) => m[0] - o[0]).slice(0, 3); return [a, n.length ? [median(n.map((v) => v[1])), median(n.map((v) => v[2]))] : [dx, dy]]; }));
  const at = (a) => [a.r[0] * k + shift.get(a)[0], a.r[1] * k + shift.get(a)[1]], dist = (a, b) => { const [x, y] = at(a); return Math.hypot(b.r[0] - x, b.r[1] - y); };
  const used = new Set(), diffs = [], missing = [], reworded = [], boxes = new Set();
  let matched = 0;
  for (const a of ref.texts) {
    const same = (by.get(key(a.t)) || []).filter((x) => !used.has(x)), d0 = Math.min(...same.map((x) => dist(a, x)));
    let b = same.filter((x) => dist(a, x) <= d0 + 8).sort((m, n) => differ(a, m, k).length - differ(a, n, k).length || dist(a, m) - dist(a, n))[0]; // the same words twice in one place (a fade-in's layers): the one drawn alike
    if (!b) { // the same place, other words: the most words in common nearby
      const w = wordsOf(a.t), near = scr.texts.filter((x) => !used.has(x) && dist(a, x) < Math.max(80, 0.08 * scr.w)).map((x) => { const v = wordsOf(x.t); let n = 0; for (const t of w) if (v.has(t)) n++; return { x, j: n / Math.max(1, new Set([...w, ...v]).size) }; }).filter((x) => x.j >= 0.4).sort((m, n) => n.j - m.j)[0];
      if (near) { b = near.x; reworded.push({ ref: a.t, now: b.t, c: b.c || null, r: b.r }); }
    }
    if (!b) { missing.push({ t: a.t, r: at(a).concat([a.r[2] * k, a.r[3] * k]).map(Math.round) }); continue; }
    used.add(b); matched++;
    for (const d of differ(a, b, k)) {
      const key = BOX.has(d.prop) && `${d.prop}|${(d.prop === 'fill' ? bgOf(b) : b.box)?.r?.join(',')}`; // a box's difference once, not once per line of words in it
      if (key && boxes.has(key)) continue;
      if (key) boxes.add(key);
      diffs.push({ t: a.t.slice(0, 80), ...d, c: b.c || null, r: b.r, refR: a.r });
    }
  }
  const top = ref.kind === 'screen' ? 0 : dy, bottom = top + (ref.h || 0) * k; // between two walks: words new on the screen (within the frame's part of the page for a frame)
  const added = ref.kind === 'screen' ? scr.texts.filter((x) => !used.has(x) && !ref.texts.some((a) => key(a.t) === key(x.t))).slice(0, 30).map((x) => ({ t: x.t, c: x.c || null, r: x.r })) : [];
  return { matched, of: ref.texts.length, scale: +k.toFixed(3), at: [Math.round(dx), Math.round(top), Math.round(bottom)], diffs, missing, reworded, added };
}
