// Reading React component code without running it: which components a file exports, the props they take (sample
// values from their own types), the variants and on/off flags worth showing as states, and what each file imports.
// No dependencies: the server uses it to find frames, and the frame plugin uses it inside a project's own Vite.

export function componentsIn(src, { all = false } = {}) { // [{ name, key }]: key is how the module exports it (null: it doesn't)
  const out = new Map();
  if (all) for (const m of src.matchAll(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\s+([A-Z]\w*)\s*[(<]|(?:const|let)\s+([A-Z]\w*)\s*(?::[^=]{0,80})?=\s*(?:\(|function\b|(?:React\.)?memo\(|(?:React\.)?forwardRef))/gm)) { const n = m[1] || m[2]; if (!/^[A-Z][A-Z0-9_]+$/.test(n)) out.set(n, null); } // top-level ones too, in source order
  for (const m of src.matchAll(/export\s+(default\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*(?::[^=]{0,80})?=\s*(?:\(|function|React\.memo|memo\(|forwardRef))/g)) { const n = m[2] || m[3]; out.set(n, m[1] ? 'default' : n); }
  const def = src.match(/export\s+default\s+([A-Z]\w*)\s*;?\s*$/m)?.[1];
  if (def) out.set(def, 'default');
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { // export { Button, buttonVariants }
    const [a, b] = part.trim().split(/\s+as\s+/);
    const n = (b || a || '').trim();
    if (/^[A-Z]\w*$/.test(n) && new RegExp(`(?:function|const|class)\\s+${a.trim()}\\b`).test(src)) out.set(n, n === 'default' ? 'default' : n);
  }
  return [...out].map(([name, key]) => ({ name, key })).filter((c) => !/^(use|Icon)/.test(c.name)).slice(0, all ? 40 : 12); // hooks aren't components; a sheet of icons says little
}
const split = (s) => { // split a type body at top-level ; , and newlines
  const out = []; let depth = 0, cur = '';
  for (const ch of s) { if ('{(<['.includes(ch)) depth++; if ('})>]'.includes(ch)) depth--; if (!depth && (ch === ';' || ch === ',' || ch === '\n')) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const block = (s, from) => { let depth = 0; for (let i = from; i < s.length; i++) { if (s[i] === '{') depth++; if (s[i] === '}' && !--depth) return s.slice(from + 1, i); } return ''; };
function typeBody(src, t, hop = 0) { // an inline { … } type, or a named type/interface in this file (intersections merged)
  return t.split('&').map((part) => {
    part = part.trim();
    if (part.startsWith('{')) return block(part, 0);
    const name = part.match(/^\w+/)?.[0];
    if (!name) return '';
    const at = src.search(new RegExp(`(?:type\\s+${name}\\s*=|interface\\s+${name}\\b[^{]*)\\s*\\{`));
    if (at >= 0) return block(src, src.indexOf('{', at));
    const alias = src.match(new RegExp(`type\\s+${name}\\s*(?:<[^=]*>)?\\s*=\\s*`)); // type ButtonProps = Omit<…> & { variant… }
    if (!alias || hop > 2) return '';
    let d = 0, i = alias.index + alias[0].length;
    for (; i < src.length; i++) { const c = src[i]; if ('{(<['.includes(c)) d++; else if ('})>]'.includes(c) && !(c === '>' && src[i - 1] === '=')) d--; else if (!d && (c === ';' || (c === '\n' && !/^\s*[&|]/.test(src.slice(i + 1, i + 40))))) break; }
    return typeBody(src, src.slice(alias.index + alias[0].length, i), hop + 1);
  }).join('\n');
}
export const word = (n) => n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
function sample(name, type, src) {
  const t = type.replace(/\s+/g, ' ').trim();
  const opts = t.split('|').map((x) => x.trim()).filter((x) => x && x !== 'undefined');
  if (/=>/.test(t)) return '() => {}';
  if (opts.length > 1 && opts.every((o) => /^['"`]/.test(o))) return opts[0];
  const one = opts.find((o) => o !== 'null') || 'null';
  if (one === 'null') return 'null';
  if (/\[\]$|^(Readonly)?Array</.test(one)) return '[]'; // before string: string[] is a list
  if (/^(string|`)/.test(one)) return JSON.stringify(word(name));
  if (one === 'number') return /width|height|size/i.test(name) ? '120' : '3';
  if (one === 'boolean') return 'false';
  if (/\[\]$|^(Readonly)?Array</.test(one)) return '[]';
  if (/^(React\.)?(ReactNode|ReactElement)|JSX\.Element/.test(one)) return JSON.stringify(word(name));
  if (/^Date$/.test(one)) return 'new Date()';
  const alias = src.match(new RegExp(`type\\s+${one}\\s*=\\s*([^;\\n]+)`))?.[1]; // a union alias in this file: its first member
  if (alias && /^\s*['"]/.test(alias)) return alias.split('|')[0].trim();
  if (/^['"]/.test(one) || /^\d/.test(one)) return one;
  return '{}';
}
// The type annotation on a component's first parameter ('' when it has none).
function paramType(src, comp) {
  const at = src.search(new RegExp(`(?:function\\s+${comp}\\s*(?:<[^>]*>)?\\s*\\(|const\\s+${comp}\\s*(?::[^=]+)?=\\s*(?:\\w+(?:\\.\\w+)?(?:<[^>]*>)?\\()?\\s*\\()`));
  if (at < 0) return '';
  const open = src.indexOf('(', at + comp.length);
  let depth = 0, end = open;
  for (let i = open; i < src.length; i++) { if (src[i] === '(') depth++; if (src[i] === ')' && !--depth) { end = i; break; } }
  const param = src.slice(open + 1, end);
  const colon = param.startsWith('{') ? param.indexOf(':', param.indexOf('}', 0)) : param.indexOf(':');
  return colon < 0 ? '' : param.slice(colon + 1).trim();
}
const fieldsOf = (src, t) => split(typeBody(src, t)).map((f) => f.match(/^(?:readonly\s+)?(['"]?[\w-]+['"]?)(\?)?\s*:\s*([\s\S]+)$/)).filter(Boolean).map((m) => ({ name: m[1].replace(/['"]/g, ''), optional: !!m[2], type: m[3].replace(/\s+/g, ' ').trim() }));

// Sample props for a component, from the annotation on its first parameter. Optional props are left out.
export function propsFor(src, comp) {
  const out = fieldsOf(src, paramType(src, comp)).filter((f) => !f.optional).map((f) => `${JSON.stringify(f.name)}: ${f.name === 'children' && /ReactNode|string/.test(f.type) ? JSON.stringify(word(comp)) : sample(f.name, f.type, src)}`); // a Badge says "Badge"
  return `{ ${out.join(', ')} }`;
}

// cva()/tv() variants: { variant: ['default', 'ghost'], size: ['sm', 'lg'] }, defaults first.
function cvaVariants(src, name) {
  const at = src.search(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*(?:cva|tv)\\s*\\(`));
  if (at < 0) return {};
  const v = src.slice(at).search(/\bvariants\s*:\s*\{/);
  if (v < 0) return {};
  const body = block(src, src.indexOf('{', at + v));
  const defaults = block(src, Math.max(0, src.indexOf('{', at + src.slice(at).search(/\bdefaultVariants\s*:\s*\{/))));
  const keysAt = (s) => { const keys = []; let depth = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '{' || c === '[' || c === '(') depth++; else if (c === '}' || c === ']' || c === ')') depth--; else if (depth === 0) { const m = s.slice(i).match(/^\s*(["']?)([\w-]+)\1\s*:/); if (m && (i === 0 || /[\s,{]/.test(s[i - 1]))) { keys.push({ key: m[2], at: i + m[0].length }); i += m[0].length - 1; } } if (c === '"' || c === "'" || c === '`') { const e = s.indexOf(c, i + 1); if (e > 0) i = e; } } return keys; };
  const out = {};
  for (const k of keysAt(body)) {
    const open = body.indexOf('{', k.at);
    if (open < 0 || body.slice(k.at, open).trim()) continue; // not an object of options
    const opts = keysAt(block(body, open)).map((x) => x.key);
    const def = defaults.match(new RegExp(`\\b${k.key}\\s*:\\s*["']([\\w-]+)["']`))?.[1];
    if (opts.length > 1) out[k.key] = def && opts.includes(def) ? [def, ...opts.filter((o) => o !== def)] : opts;
  }
  return out;
}
const FLAG = /^(disabled|loading|isLoading|pending|checked|selected|active|isActive|open|expanded|pressed|error|invalid|busy|destructive)$/;
// What a component can show as states: its variant unions (from its type or cva), its on/off flags, and whether it
// takes children (so a Button gets a label) or is a native control (so it can be disabled).
export function propTypes(src, comp) {
  const t = paramType(src, comp);
  const unions = {}, flags = [];
  for (const f of fieldsOf(src, t)) {
    const opts = f.type.split('|').map((x) => x.trim()).filter((x) => x && x !== 'undefined');
    if (opts.length > 1 && opts.every((o) => /^['"]/.test(o))) unions[f.name] = opts.map((o) => o.slice(1, -1));
    else if (f.type === 'boolean') flags.push(f.name);
  }
  flags.sort((a, b) => FLAG.test(b) - FLAG.test(a)); // the usual states first (disabled, loading…), then the component's own
  for (const m of t.matchAll(/VariantProps<\s*typeof\s+(\w+)\s*>/g)) Object.assign(unions, cvaVariants(src, m[1]));
  const native = /ComponentProps(?:WithoutRef)?<\s*["'](button|input|select|textarea)["']|(Button|Input|Select|TextArea)HTMLAttributes|HTML(Button|Input|Select|TextArea)Element/.test(t + src.slice(0, 4000));
  if (native && !flags.includes('disabled')) flags.unshift('disabled');
  const children = /\bchildren\b/.test(t) || /\{\s*children\s*\}|props\.children|\.\.\.props\s*\}?\s*\/?>|\{\.\.\.props\}/.test(src);
  return { unions, flags: flags.slice(0, 5), children, native };
}

// The states a component's own code branches on: loading, error and empty (what it draws while data comes, when it
// fails, when there's none). Read from its conditions (`if (loading)`, `error && …`, `items.length === 0`), so a value it
// only passes on doesn't count.
const cond = (x) => new RegExp(`if\\s*\\(\\s*!?\\s*(?:[\\w$]+\\.)?${x}\\b|\\b${x}\\s*(?:\\?(?![.?])|&&)`, 'i');
const BRANCH = {
  loading: cond('(?:is)?(?:loading|pending|fetching|submitting|busy)'),
  error: cond('(?:is)?(?:error|err|failed|failure)'),
  empty: /\.length\s*(?:===?\s*0|<\s*1|\?(?![.?])|&&)|!\s*[\w$.?]+\.length\b|\bisEmpty\b|\b(?:is)?empty\s*(?:\?(?![.?])|&&)/i,
};
export const branchesIn = (body) => Object.keys(BRANCH).filter((k) => BRANCH[k].test(body));

// ---------- sample data: full values from the props' own types, followed across files, real records where the repo has them ----------
// makeSampler({ read(abs) → text, resolve(fromAbs, spec) → abs | null, json: [{ file, value }] }).props(abs, comp) →
// { code: '{ "call": {…}, "now": Date.now() }', used: ['replay/x.json'] }. Types are read, not checked: interfaces and
// aliases (with extends, generics, unions, arrays, Record, Partial, Pick…), enums, imports and re-exports, tsconfig
// paths. An object type whose fields match objects in the repo's JSON (fixtures, replays, mocks) takes those real
// objects; everything else gets a plain value shaped by the field's name (a duration in ms, a date, a url, a label).
// ponytail: a reader, not a type checker; conditional and mapped types fall back to {}.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const topSplit = (s, sep) => { const out = []; let d = 0, cur = '', q = null; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { cur += c; if (c === q && s[i - 1] !== '\\') q = null; continue; } if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; } if ('{([<'.includes(c)) d++; else if ('})]>'.includes(c) && !(c === '>' && s[i - 1] === '=')) d--; if (!d && c === sep) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()).filter((x) => x !== ''); };
const wrapped = (t) => { if (!t.startsWith('(') || !t.endsWith(')')) return false; let d = 0; for (let i = 0; i < t.length; i++) { if (t[i] === '(') d++; else if (t[i] === ')' && !--d && i < t.length - 1) return false; } return true; };
const genericOf = (t) => { const m = t.match(/^([\w.]+)\s*</); if (!m || !t.endsWith('>')) return null; const inner = t.slice(m[0].length, -1); return topSplit(inner, ',').length ? { name: m[1], args: topSplit(inner, ',') } : null; };
const IMG = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%23e5e5e5%22/%3E%3C/svg%3E';
function prim(kind, key = '', i = 0) { // a plain value, shaped by the field's name
  const k = key.toLowerCase();
  if (kind === 'string') {
    if (/(^|_)id$|id$/.test(k) && k.length <= 16) return JSON.stringify(`${key}-${i + 1}`);
    if (/url|href|link|website/.test(k)) return '"https://example.com"';
    if (/email/.test(k)) return '"name@example.com"';
    if (/^(ts|date|time|at)$|(date|time|at|on)$|^(created|updated|started|ended|start|end)/.test(k)) return 'new Date(Date.now() - 3600e3).toISOString()';
    if (/colou?r|hex/.test(k)) return '"#4f46e5"';
    if (/src|image|img|avatar|photo|logo|thumbnail|cover/.test(k)) return JSON.stringify(IMG);
    return JSON.stringify(`${word(key || 'text')}${i ? ` ${i + 1}` : ''}`);
  }
  if (kind === 'number') {
    if (/^(ts|time|now|at|timestamp)$|(at|time|ts)$/.test(k) && !/ms$/.test(k)) return 'Date.now()';
    if (/ms$|duration|latency|elapsed|delay/.test(k)) return String(840 + i * 120);
    if (/price|cost|amount|fee|total.*usd/.test(k)) return String(29 + i * 10);
    if (/percent|pct/.test(k)) return String(42 + i);
    if (/ratio|rate|share|probability|^p$|score.*norm/.test(k)) return String(0.42 + i * 0.1);
    if (/year/.test(k)) return '2026';
    if (/index|idx|^i$/.test(k)) return String(i);
    if (/width|height|size/.test(k)) return String(120 + i * 20);
    return String(128 + i * 37);
  }
  if (kind === 'boolean') return 'false';
  return 'null';
}
export function makeSampler({ read, resolve, json = [] }) {
  const files = new Map();
  const fileOf = (abs) => {
    if (files.has(abs)) return files.get(abs);
    const src = stripComments(read(abs) || '');
    const f = { abs, src, imports: {}, stars: [] };
    for (const m of src.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) for (const part of m[1].split(',')) { const [orig, alias] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/); if (orig) f.imports[(alias || orig).trim()] = { name: orig.trim(), spec: m[2] }; }
    for (const m of src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) f.stars.push(m[1]);
    files.set(abs, f);
    return f;
  };
  const statementEnd = (src, from) => { let d = 0, q = null; for (let i = from; i < src.length; i++) { const c = src[i]; if (q) { if (c === q && src[i - 1] !== '\\') q = null; continue; } if (c === '"' || c === "'" || c === '`') { q = c; continue; } if ('{([<'.includes(c)) d++; else if ('})]>'.includes(c) && !(c === '>' && src[i - 1] === '=')) d--; if (d <= 0 && (c === ';' || (c === '\n' && /^\s*(export|type|interface|const|let|var|function|import|enum|declare|class|@|$)/.test(src.slice(i + 1, i + 40)) && !/[|&=,(<:]\s*$/.test(src.slice(from, i))))) return i; } return src.length; };
  // A named type's declaration: { kind, abs, params, body | value }
  const decl = (abs, name, hop = 0) => {
    if (!abs || hop > 4) return null;
    const f = fileOf(abs), src = f.src;
    let m = src.match(new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:declare\\s+)?interface\\s+${name}\\b\\s*(<[^{]*?>)?\\s*(?:extends\\s+([^{]+?))?\\s*\\{`));
    if (m) { const open = m.index + m[0].length - 1; return { kind: 'interface', abs, params: (m[1] || '').replace(/^<|>$/g, ''), body: `{${block(src, open)}}`, ext: m[2] ? topSplit(m[2], ',') : [] }; }
    m = src.match(new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:declare\\s+)?type\\s+${name}\\b\\s*(<[^=]*?>)?\\s*=`));
    if (m) { const from = m.index + m[0].length; return { kind: 'alias', abs, params: (m[1] || '').replace(/^<|>$/g, ''), body: src.slice(from, statementEnd(src, from)).trim().replace(/;$/, '') }; }
    m = src.match(new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:declare\\s+)?(?:const\\s+)?enum\\s+${name}\\s*\\{`));
    if (m) { const first = block(src, m.index + m[0].length - 1).split(',')[0] || ''; const v = first.split('=')[1]?.trim(); return { kind: 'enum', abs, value: v || '0' }; }
    const imp = f.imports[name];
    if (imp) return decl(resolve(abs, imp.spec), imp.name, hop + 1);
    for (const s of f.stars) { const d = decl(resolve(abs, s), name, hop + 1); if (d) return d; }
    return null;
  };
  const subst = (body, params, args) => { // type Box<T> = { v: T } with Box<string>
    if (!params) return body;
    topSplit(params, ',').forEach((p, i) => { const [n, def] = p.split('='); const name = n.replace(/\s+extends[\s\S]*$/, '').trim(); const to = args?.[i] ?? def?.trim() ?? 'unknown'; body = body.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${to})`); });
    return body;
  };
  // The fields of an object type (interfaces with extends, intersections, Partial/Pick/Omit), or null when it isn't one.
  const fields = (t, ctx, depth = 0) => {
    t = t.trim();
    if (depth > 6) return null;
    if (wrapped(t)) return fields(t.slice(1, -1), ctx, depth + 1);
    const parts = topSplit(t, '&');
    if (parts.length > 1) { const all = parts.map((p) => fields(p, ctx, depth + 1)); return all.some(Boolean) ? all.filter(Boolean).flat() : null; }
    if (t.startsWith('{')) {
      return split(block(t, 0).replace(/:\s*\n\s*/g, ': ').replace(/\n\s*([|&])/g, ' $1')).flatMap((f) => { // a union on the lines below its field stays with it
        const mm = f.match(/^(?:readonly\s+)?(['"]?[\w$-]+['"]?)(\?)?\s*(\([^)]*\))?\s*:\s*([\s\S]+)$/);
        if (!mm) { const idx = f.match(/^\[\s*\w+\s*:\s*[^\]]+\]\s*:\s*([\s\S]+)$/); return idx ? [{ name: 'key', optional: false, type: idx[1], abs: ctx.abs }] : []; }
        return [{ name: mm[1].replace(/['"]/g, ''), optional: !!mm[2], type: mm[3] ? '() => void' : mm[4], abs: ctx.abs }];
      });
    }
    const g = genericOf(t);
    if (g && /^(Partial|Required|Readonly)$/.test(g.name)) return fields(g.args[0], ctx, depth + 1)?.map((f) => ({ ...f, optional: g.name === 'Partial' ? true : g.name === 'Required' ? false : f.optional }));
    if (g && /^(Pick|Omit)$/.test(g.name)) { const keys = [...(g.args[1] || '').matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]); const fs = fields(g.args[0], ctx, depth + 1); return fs && fs.filter((f) => (g.name === 'Pick') === keys.includes(f.name)); }
    const name = g ? g.name : /^[A-Z][\w.]*$/.test(t) ? t : null;
    if (!name || /^(Array|ReadonlyArray|Promise|Record|Set|Map|Date|React\.|JSX\.)/.test(name)) return null;
    const d = decl(ctx.abs, name.split('.').pop());
    if (!d || d.kind === 'enum') return null;
    const body = subst(d.body, d.params, g?.args);
    const own = fields(body, { ...ctx, abs: d.abs }, depth + 1);
    if (d.kind === 'interface') return [...(d.ext || []).flatMap((e) => fields(e, { ...ctx, abs: d.abs }, depth + 1) || []), ...(own || [])];
    return own;
  };
  const used = new Set(), hits = new Map();
  // Real objects from the repo's JSON whose keys match the type's required fields (most filled-in first).
  const fromJson = (fs) => {
    const want = fs.filter((f) => !f.optional).map((f) => f.name);
    if (want.length < 2) return null;
    const tight = want.length === 2; // two fields match only an object of about that shape
    const sig = want.join(',');
    if (hits.has(sig)) { const h = hits.get(sig); if (h) used.add(h.file); return h; }
    let best = null;
    const fits = (o) => o && typeof o === 'object' && !Array.isArray(o) && want.filter((k) => k in o).length / want.length >= 0.85 && (!tight || Object.keys(o).length <= 3);
    const score = (o) => Object.values(o).filter((v) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)).length;
    const walk = (v, file, d) => {
      if (d > 5 || !v || typeof v !== 'object') return;
      if (Array.isArray(v)) { const hits = v.filter(fits); if (hits.length) { const top = [...hits].sort((a, b) => score(b) - score(a)); if (!best || score(top[0]) > score(best.items[0])) best = { file, items: top.slice(0, 3) }; } v.slice(0, 50).forEach((x) => walk(x, file, d + 1)); return; }
      if (fits(v) && (!best || score(v) > score(best.items[0]))) best = { file, items: [v] };
      for (const x of Object.values(v)) walk(x, file, d + 1);
    };
    for (const j of json) walk(j.value, j.file, 0);
    if (best) used.add(best.file);
    hits.set(sig, best);
    return best;
  };
  // A value for a type, as JavaScript source.
  const gen = (t, ctx) => {
    t = String(t || '').trim().replace(/^[|&]\s*/, '');
    const { key = '', i = 0, depth = 0 } = ctx;
    if (!t || depth > 8) return 'undefined';
    if (wrapped(t)) return gen(t.slice(1, -1), ctx);
    const u = topSplit(t, '|');
    if (u.length > 1) {
      if (/^(error|err|failure|warning|exception|problem)s?$/i.test(key) && u.some((x) => /^(null|undefined)$/.test(x))) return 'null'; // the working state, not the failure
      const opts = u.filter((x) => !/^(null|undefined|void|never)$/.test(x));
      if (!opts.length) return 'null';
      const lits = opts.every((o) => /^['"`\d-]/.test(o));
      const happy = lits && i === 0 && opts.find((o) => /^['"`](ready|success|succeeded|done|loaded|complete|completed|ok|idle|active|open|live|delivered)['"`]$/i.test(o)); // a screen with its content, not its spinner
      return gen(happy || opts[lits ? Math.min(i, opts.length - 1) : 0], ctx);
    }
    if (/\bextends\b[\s\S]*\?[\s\S]*:/.test(t) && !t.startsWith('{')) return gen(t.split('?')[1].split(':')[0], ctx); // A extends B ? C : D → C
    if (topSplit(t, '=').length > 1 && /=>/.test(t) && !t.startsWith('{')) return '() => {}';
    if (/^keyof\b/.test(t)) return '"key"';
    if (/^typeof\b|^unique symbol/.test(t)) return 'undefined';
    if (t.endsWith('[]')) return depth > 5 ? '[]' : `[${[0, 1].map((n) => gen(t.slice(0, -2), { ...ctx, i: n, depth: depth + 1 })).join(', ')}]`;
    if (t.startsWith('[')) return `[${topSplit(t.slice(1, -1), ',').map((x, n) => gen(x.replace(/^\.\.\.|\w+\??:\s*/g, ''), { ...ctx, i: n, depth: depth + 1 })).join(', ')}]`;
    if (/^['"`]/.test(t)) return JSON.stringify(t.slice(1, -1));
    if (/^-?\d/.test(t)) return t;
    if (/^(true|false)$/.test(t)) return t;
    if (/^(string|number|boolean|bigint)$/.test(t)) return t === 'bigint' ? '0n' : prim(t, key, i);
    if (/^(null|undefined|void|never)$/.test(t)) return 'null';
    if (/^(any|unknown|object|\{\s*\})$/.test(t)) return '{}';
    if (/^(Date)$/.test(t)) return 'new Date(Date.now() - 3600e3)';
    if (/^(React\.)?(ReactNode|ReactElement|ReactChild)\b|^JSX\.Element$/.test(t)) return JSON.stringify(word(key || 'content'));
    if (/^(React\.)?(ComponentType|FC|FunctionComponent|ElementType)\b/.test(t)) return 'undefined';
    if (/^(HTML\w*Element|Element|Node|\w*Event|EventTarget|Window|Document|RefObject|MutableRefObject|React\.\w*Ref\w*)\b/.test(t)) return 'null';
    if (/^(RegExp)$/.test(t)) return '/x/';
    const g = genericOf(t);
    if (g) {
      if (/^(Array|ReadonlyArray)$/.test(g.name)) return gen(`(${g.args[0]})[]`, ctx);
      if (g.name === 'Promise') return `Promise.resolve(${gen(g.args[0], { ...ctx, depth: depth + 1 })})`;
      if (/^(ReadonlySet|Set)$/.test(g.name)) return 'new Set()';
      if (/^(ReadonlyMap|Map|WeakMap)$/.test(g.name)) return 'new Map()';
      if (g.name === 'Record') { const k = g.args[0].match(/^['"]([^'"]+)['"]/)?.[1] || 'key'; return `{ ${JSON.stringify(k)}: ${gen(g.args[1], { ...ctx, key: k, depth: depth + 1 })} }`; }
      if (/^(NonNullable|Readonly|Awaited)$/.test(g.name)) return gen(g.args[0], ctx);
      if (/^(React\.)?(ComponentProps|ComponentPropsWithoutRef|ComponentPropsWithRef|HTMLAttributes|\w+HTMLAttributes)$/.test(g.name)) return '{}';
      if (/^(Dispatch|SetStateAction)$/.test(g.name) || /^React\.Dispatch/.test(g.name)) return '() => {}';
    }
    const fs = fields(t, ctx);
    if (fs) { // an object: real records when the repo has them, else built field by field
      const hit = depth > 0 || ctx.real ? fromJson(fs) : null;
      if (hit) return JSON.stringify(hit.items[Math.min(i, hit.items.length - 1)]);
      if (depth > 6) return '{}';
      const keep = fs.filter((f) => depth > 0 || !f.optional);
      return `{ ${keep.map((f) => `${JSON.stringify(f.name)}: ${gen(f.type, { abs: f.abs, key: f.name, i, depth: depth + 1 })}`).join(', ')} }`;
    }
    const ix = t.match(/^([\w.]+(?:<[\s\S]*>)?)\[\s*['"]([\w$-]+)['"]\s*\]$/); // Options['reasoning']
    if (ix) { const f = fields(ix[1], ctx)?.find((x) => x.name === ix[2]); return f ? gen(f.type, { ...ctx, abs: f.abs, key: ix[2] }) : 'null'; }
    const name = g ? g.name : t;
    if (/^[A-Z][\w.]*$/.test(name)) {
      const d = decl(ctx.abs, name.split('.').pop());
      if (d?.kind === 'enum') return d.value;
      if (d?.kind === 'alias') return gen(subst(d.body, d.params, g?.args), { ...ctx, abs: d.abs, depth: depth + 1 });
    }
    return 'null'; // a type it can't read: null is what UI code most often guards against
  };
  // A component's props: required fields of its first parameter's type (or React.FC<Props>), with full nested values.
  return {
    props(abs, comp) {
      used.clear();
      const src = fileOf(abs).src;
      let t = paramType(src, comp);
      if (!t) t = src.match(new RegExp(`const\\s+${comp}\\s*:\\s*(?:React\\.)?(?:FC|FunctionComponent|VFC)\\s*<\\s*([^>]+)>`))?.[1] || '';
      if (!t) return { code: '{}', used: [] };
      const fs = fields(t, { abs }) || [];
      const code = `{ ${fs.filter((f) => !f.optional).map((f) => {
        const ft = f.type.trim(), arr = ft.endsWith('[]') || /^(Readonly)?Array</.test(ft);
        const v = f.name === 'children' && /ReactNode|string/.test(ft) ? JSON.stringify(word(comp)) : arr ? genArray(ft, f) : gen(ft, { abs: f.abs, key: f.name, depth: 1, real: true });
        return `${JSON.stringify(f.name)}: ${v}`;
      }).join(', ')} }`;
      return { code, used: [...used] };
    },
  };
  function genArray(t, f) { // a list prop: real records when the repo has a list of them
    const item = t.endsWith('[]') ? t.slice(0, -2) : genericOf(t)?.args[0];
    const fs = item && fields(item.replace(/^\((.*)\)$/, '$1'), { abs: f.abs });
    const hit = fs && fromJson(fs);
    if (hit) return JSON.stringify(hit.items);
    return gen(t, { abs: f.abs, key: f.name, depth: 1 });
  }
}

// What a file imports: [{ spec, names, def, locals }] (names as exported by the other file; def = its default export;
// locals = [name in this file, name in that one | null for its default | '*' for the whole module]).
export function importsOf(src) {
  const out = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const clause = m[1].trim();
    const pairs = (clause.match(/\{([^}]*)\}/)?.[1] || '').split(',').map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/).map((s) => s.trim())).filter(([a]) => /^\w+$/.test(a));
    const def = /^\w+/.test(clause) && !clause.startsWith('{'), ns = clause.match(/\*\s+as\s+(\w+)/)?.[1];
    const locals = [...pairs.map(([a, b]) => [b || a, a]), ...(def ? [[clause.match(/^\w+/)[0], null]] : []), ...(ns ? [[ns, '*']] : [])];
    out.push({ spec: m[2], names: pairs.map(([a]) => a), def, all: clause.startsWith('*'), locals });
  }
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1], names: [], def: true, all: false, locals: [] }); // lazy routes (lazy(() => import('./Studio'))): no local names, its default is the component
  return out;
}
