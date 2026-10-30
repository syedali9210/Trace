// Text vectors for the vector index and routing similarity: hashed bag of words (+ word pairs), L2-normalised.
// ponytail: feature hashing works offline with no model; swap textVec for a real embeddings API (e.g. Voyage) when recall matters.
const DIM = 384;

const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const STOP = new Set('the a an and or of to in on for with is are was be by at it this that from as into its'.split(' '));

export function tokens(text = '') {
  return String(text)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9#]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function textVec(text) {
  const v = new Float32Array(DIM);
  const t = tokens(text);
  const add = (s, w) => { const h = fnv(s); v[h % DIM] += h & 0x80000000 ? -w : w; };
  for (let i = 0; i < t.length; i++) {
    add(t[i], 1);
    if (t[i].length > 4) add(t[i].slice(0, 4), 0.5); // a cheap stem: "checkout" ~ "checkouts"
    if (i) add(`${t[i - 1]} ${t[i]}`, 0.5);
  }
  const n = Math.hypot(...v) || 1;
  return Array.from(v, (x) => +(x / n).toFixed(4));
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function mean(vecs) {
  const list = vecs.filter((v) => v && v.length);
  if (!list.length) return null;
  const out = new Array(list[0].length).fill(0);
  for (const v of list) for (let i = 0; i < v.length; i++) out[i] += v[i];
  const n = Math.hypot(...out) || 1;
  return out.map((x) => +(x / n).toFixed(4));
}
