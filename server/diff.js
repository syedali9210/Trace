// Stage 4: what changed and by how much. Structural (property tree), visual (pixels, SSIM, regions) and a
// rule-based semantic label (refined by AI in the engine when a key is set), combined into a 0–100 magnitude.
import sharp from 'sharp';
import { filePath } from './media.js';

const clamp = (n) => Math.max(0, Math.min(1, n));
const short = (v) => (v == null ? '' : Array.isArray(v) && v.every((x) => typeof x !== 'object') ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 160);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- structural ----------
const ATTRS = [
  ['font.family', 'typography', 1.2], ['font.size', 'typography', 1.5], ['font.weight', 'typography', 1],
  ['font.lineHeight', 'typography', 0.6], ['font.letterSpacing', 'typography', 0.5],
  ['fills', 'color', 1], ['strokes', 'color', 0.6], ['text', 'copy', 1], ['component', 'component', 2],
  ['effects', 'effect', 0.6], ['radius', 'shape', 0.4], ['opacity', 'color', 0.4],
  ['layout.gap', 'spacing', 0.6], ['layout.padding', 'spacing', 0.6], ['layout.mode', 'layout', 0.8],
];
const pick = (o, p) => p.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

function matchNodes(a = {}, b = {}) {
  const pairs = [], added = [], removed = [];
  const leftover = new Map();
  for (const [id, n] of Object.entries(a)) (b[id] ? pairs.push([n, b[id]]) : leftover.set(id, n));
  const byName = new Map();
  for (const [id, n] of leftover) { const k = `${n.type}|${n.name}`; byName.has(k) ? byName.set(k, null) : byName.set(k, n); }
  for (const [id, n] of Object.entries(b)) {
    if (a[id]) continue;
    const k = `${n.type}|${n.name}`, m = byName.get(k); // fall back to name + type when ids moved
    if (m) { pairs.push([m, n]); byName.delete(k); leftover.delete([...leftover].find(([, v]) => v === m)?.[0]); }
    else added.push(n);
  }
  for (const [, n] of leftover) removed.push(n);
  return { pairs, added, removed };
}

export function structuralDiff(before = {}, after = {}) {
  const changes = [];
  const root = after.root || before.root || null;
  const region = (n) => (root && n && n.w ? { x: clamp(n.x / root.w), y: clamp(n.y / root.h), w: clamp(n.w / root.w), h: clamp(n.h / root.h) } : null);
  const { pairs, added, removed } = matchNodes(before.nodes, after.nodes);
  for (const [x, y] of pairs) {
    for (const [p, kind, w] of ATTRS) {
      const va = pick(x, p), vb = pick(y, p);
      if ((va != null || vb != null) && !same(va, vb)) changes.push({ kind, path: `${y.name} › ${p}`, before: short(va), after: short(vb), weight: w, region: region(y) });
    }
    const moved = Math.abs((x.x ?? 0) - (y.x ?? 0)) > 1 || Math.abs((x.y ?? 0) - (y.y ?? 0)) > 1;
    const resized = Math.abs((x.w ?? 0) - (y.w ?? 0)) > 1 || Math.abs((x.h ?? 0) - (y.h ?? 0)) > 1;
    if (moved) changes.push({ kind: 'layout', path: `${y.name} › position`, before: `${Math.round(x.x)}, ${Math.round(x.y)}`, after: `${Math.round(y.x)}, ${Math.round(y.y)}`, weight: 0.5, region: region(y) });
    if (resized) changes.push({ kind: 'layout', path: `${y.name} › size`, before: `${Math.round(x.w)}×${Math.round(x.h)}`, after: `${Math.round(y.w)}×${Math.round(y.h)}`, weight: 0.6, region: region(y) });
  }
  for (const n of added) changes.push({ kind: 'node.added', path: `${n.name} (${n.type})`, before: '', after: 'added', weight: 1, region: region(n) });
  for (const n of removed) changes.push({ kind: 'node.removed', path: `${n.name} (${n.type})`, before: 'present', after: 'removed', weight: 1, region: null });

  const tok = (x) => ({ ...x.tokens, ...x.variables }); // token files, and Figma's variables
  for (const k of new Set([...Object.keys(tok(before)), ...Object.keys(tok(after))])) {
    const va = tok(before)[k], vb = tok(after)[k];
    if (va !== vb) changes.push({ kind: 'token', path: k, before: short(va ?? '—'), after: short(vb ?? 'removed'), weight: 1 });
  }
  for (const [file, f] of Object.entries(after.code?.files || {})) {
    changes.push({ kind: f.status === 'added' ? 'node.added' : f.status === 'removed' ? 'node.removed' : 'code', path: file, before: '', after: `+${f.additions} −${f.deletions}${f.status !== 'modified' ? ` (${f.status})` : ''}`, weight: Math.min(3, (f.additions + f.deletions) / 40 + 0.5) });
  }
  if (before.lottie && after.lottie) for (const k of ['w', 'h', 'fr', 'frames', 'layers']) {
    if (before.lottie[k] !== after.lottie[k]) changes.push({ kind: 'motion', path: `animation › ${k}`, before: short(before.lottie[k]), after: short(after.lottie[k]), weight: 1 });
  }
  changes.sort((p, q) => q.weight - p.weight);
  return changes.slice(0, 200);
}

// ---------- visual ----------
async function grey(key, w, h) { return sharp(filePath(key)).resize(w, h, { fit: 'fill' }).flatten({ background: '#fff' }).greyscale().raw().toBuffer(); }

// Best small translation between two frames, searched at quarter scale, so a nudged canvas isn't "everything changed".
function align(a, b, w, h) {
  const s = 4, sw = Math.floor(w / s), sh = Math.floor(h / s);
  const down = (buf) => { const o = new Float32Array(sw * sh); for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) o[y * sw + x] = buf[(y * s) * w + x * s]; return o; };
  const A = down(a), B = down(b);
  let best = { dx: 0, dy: 0, e: Infinity };
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    let e = 0, n = 0;
    for (let y = 3; y < sh - 3; y += 2) for (let x = 3; x < sw - 3; x += 2) { e += Math.abs(A[y * sw + x] - B[(y + dy) * sw + x + dx]); n++; }
    e /= n || 1;
    if (e < best.e - 0.01 || (Math.abs(e - best.e) < 0.01 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx, dy, e };
  }
  return { dx: best.dx * s, dy: best.dy * s };
}

export async function visualDiff(beforeKey, afterKey) {
  const meta = await sharp(filePath(afterKey)).metadata();
  const mb = await sharp(filePath(beforeKey)).metadata();
  const W = 256, H = Math.max(16, Math.min(768, Math.round((W * meta.height) / meta.width)));
  const [a, b] = await Promise.all([grey(beforeKey, W, H), grey(afterKey, W, H)]);
  const { dx, dy } = align(a, b, W, H);
  const mask = new Uint8Array(W * H);
  let changed = 0, total = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bx = x + dx, by = y + dy;
    if (bx < 0 || by < 0 || bx >= W || by >= H) continue;
    total++;
    if (Math.abs(a[y * W + x] - b[by * W + bx]) > 20) { mask[y * W + x] = 1; changed++; }
  }
  // Mean SSIM over 8×8 windows.
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ssim = 0, wins = 0;
  for (let y = 0; y + 8 <= H; y += 8) for (let x = 0; x + 8 <= W; x += 8) {
    let ma = 0, mb2 = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { ma += a[(y + j) * W + x + i]; mb2 += b[(y + j) * W + x + i]; }
    ma /= 64; mb2 /= 64;
    let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const p = a[(y + j) * W + x + i] - ma, q = b[(y + j) * W + x + i] - mb2; va += p * p; vb += q * q; cov += p * q; }
    va /= 63; vb /= 63; cov /= 63;
    ssim += ((2 * ma * mb2 + C1) * (2 * cov + C2)) / ((ma * ma + mb2 * mb2 + C1) * (va + vb + C2));
    wins++;
  }
  return {
    pct: +((changed / (total || 1)) * 100).toFixed(2),
    ssim: +(ssim / (wins || 1)).toFixed(3),
    regions: regionsFrom(mask, W, H),
    resized: Math.abs(meta.width / meta.height - mb.width / mb.height) > 0.02 || meta.width !== mb.width,
    shift: dx || dy ? { dx, dy } : null,
  };
}

// Changed-region boxes: connected components of the diff mask on a coarse grid, normalised to 0..1.
export function regionsFrom(mask, W, H, cols = 32) {
  const cell = W / cols, rows = Math.ceil(H / cell);
  const grid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let n = 0, t = 0;
    for (let y = Math.floor(r * cell); y < Math.min(H, Math.floor((r + 1) * cell)); y++) for (let x = Math.floor(c * cell); x < Math.min(W, Math.floor((c + 1) * cell)); x++) { t++; n += mask[y * W + x]; }
    if (t && n / t > 0.03) grid[r * cols + c] = 1;
  }
  const seen = new Uint8Array(grid.length), boxes = [];
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue;
    let minx = cols, miny = rows, maxx = 0, maxy = 0, n = 0;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % cols, y = (k / cols) | 0;
      n++; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { // 8-neighbour, so diagonal strokes join
        const nx = x + dx, ny = y + dy, nk = ny * cols + nx;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && grid[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
      }
    }
    boxes.push({ x: minx / cols, y: (miny * cell) / H, w: (maxx - minx + 1) / cols, h: Math.min(1, ((maxy - miny + 1) * cell) / H), cells: n });
  }
  return boxes.filter((b) => b.w * b.h > 0.002).sort((p, q) => q.w * q.h - p.w * p.h).slice(0, 10)
    .map(({ cells, ...b }) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +v.toFixed(4)])));
}

// ---------- semantic (rules) + magnitude ----------
export const TYPE_WEIGHT = { 'new screen': 1, 'component swap': 0.7, layout: 0.6, 'code change': 0.5, 'asset added': 0.5, 'motion change': 0.5, copy: 0.4, typography: 0.4, color: 0.3, visual: 0.3, 'no change': 0 };
const GROUP = { typography: 'typography', color: 'color', copy: 'copy', layout: 'layout', spacing: 'layout', shape: 'layout', effect: 'color', component: 'component swap', token: 'color', code: 'code change', motion: 'motion change', 'node.added': 'layout', 'node.removed': 'layout' };

export function semanticLabel({ changes, visual, hasBefore, assetType }) {
  if (!hasBefore) return { type: ['frame', 'image', 'page', 'screen', 'artboard'].includes(assetType) ? 'new screen' : 'asset added', by: 'rules' };
  if (!changes.length && visual && visual.pct < 0.05) return { type: 'no change', by: 'rules' };
  const tally = {};
  for (const c of changes) { const g = GROUP[c.kind] || 'visual'; tally[g] = (tally[g] || 0) + c.weight; }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (top) return { type: top[0], by: 'rules' };
  if (visual?.resized) return { type: 'layout', by: 'rules' };
  return { type: 'visual', by: 'rules' };
}

export function magnitude({ visual, changes = [], semantic, hasStructure }) {
  const attrW = changes.filter((c) => !c.kind.startsWith('node.')).reduce((s, c) => s + c.weight, 0);
  const added = changes.filter((c) => c.kind === 'node.added').length, removed = changes.filter((c) => c.kind === 'node.removed').length;
  const parts = [
    [0.4, visual ? clamp(visual.pct / 35) : null],
    [0.35, hasStructure ? clamp(attrW / 8) : null],
    [0.15, hasStructure ? clamp((added + removed) / 6) : null],
    [0.1, TYPE_WEIGHT[semantic?.type] ?? 0.3],
  ].filter(([, v]) => v != null);
  const wsum = parts.reduce((s, [w]) => s + w, 0);
  const score = Math.round((100 * parts.reduce((s, [w, v]) => s + w * v, 0)) / wsum);
  return {
    score, bucket: bucket(score),
    basis: { pixels: visual ? visual.pct : null, ssim: visual?.ssim ?? null, properties: changes.filter((c) => !c.kind.startsWith('node.')).length, nodes: { added, removed }, type: semantic?.type, layers: parts.length },
  };
}
export const bucket = (s) => (s < 15 ? 'small' : s <= 50 ? 'medium' : 'large');

// Full diff between two snapshot rows (either may be null for "new").
export async function diffSnapshots(before, after, assetType) {
  if (!after) return null;
  const hasBefore = !!before;
  const hasStructure = !!(after.properties?.nodes || after.properties?.tokens || after.properties?.code || after.properties?.lottie);
  const changes = hasBefore || after.properties?.code ? structuralDiff(before?.properties || {}, after.properties || {}) : [];
  let visual = null;
  if (hasBefore && before.image_key && after.image_key && !after.properties?.code && !after.properties?.file?.card && !before.properties?.file?.card) { // generated cards aren't the work
    try { visual = await visualDiff(before.image_key, after.image_key); } catch { visual = null; }
  }
  const semantic = semanticLabel({ changes, visual, hasBefore, assetType });
  const mag = magnitude({ visual, changes, semantic, hasStructure: hasStructure && hasBefore });
  return { changes, visual, semantic, ...mag };
}
