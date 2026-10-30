// A project's folders on disk (its codebase, docs and design files): list, search, read and write, never outside
// them, never secrets (.env, keys), never dependencies or build output.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectDirs } from './casestudy.js';
import { DATA } from './db.js';

const SKIP_DIR = /^(node_modules|dist|build|out|coverage|__pycache__|venv|target|vendor|Pods|DerivedData|storybook-static)([-_.].*)?$/; // dependencies and build output, dist-replay too
const TEXT = /\.(md|mdx|txt|json|jsx?|tsx?|mjs|cjs|css|scss|less|html?|svelte|vue|astro|py|go|rs|java|kt|swift|rb|php|ya?ml|toml|sql|sh|ps1|xml|csv|graphql|prisma)$/i;
export const SECRET = /(^|[\\/])(\.env(?!\.(example|sample|template)$)[^\\/]*|[^\\/]*\.(pem|key|p12|pfx|keystore)|id_(rsa|ed25519)[^\\/]*|\.npmrc|\.netrc|secrets?\.[a-z]+|credentials[^\\/]*)$/i;
const err = (status, message) => Object.assign(new Error(message), { status });

// The folders a search or read may touch: the project's own, or one folder inside them.
export function roots(p, folder) {
  const dirs = projectDirs(p);
  if (!folder) return dirs.map((d) => ({ root: d, dir: d }));
  const f = path.resolve(folder), root = dirs.find((d) => f === d || f.startsWith(d + path.sep));
  if (!root) throw err(400, 'That folder isn’t one of this project’s folders.');
  return [{ root, dir: f }];
}

export function walk(p, { folder, max = 4000 } = {}) {
  const out = [];
  const go = (root, dir) => {
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= max) return;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && !e.name.startsWith('.')) go(root, f); continue; }
      if (/\.min\.(js|css)$|\.map$/.test(e.name)) continue; // minified bundles and source maps aren't the work
      if (!e.isFile() || SECRET.test(f)) continue;
      try { const st = statSync(f); out.push({ root, path: f, rel: path.relative(root, f).replace(/\\/g, '/'), size: st.size, mtime: st.mtimeMs }); } catch {}
    }
  };
  for (const r of roots(p, folder)) go(r.root, r.dir);
  return out;
}

// Files whose name or text has the words: name hits first, then lines with every word.
// ponytail: a plain scan capped at 3000 files and 1.5s; index file contents if folders grow past that.
export function searchFiles(p, q, { folder, limit = 20 } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const hits = [], end = Date.now() + 1500;
  for (const f of walk(p, { folder, max: 3000 })) {
    if (hits.length >= limit * 3 || Date.now() > end) break;
    const name = f.rel.toLowerCase();
    if (words.every((w) => name.includes(w))) { hits.push({ ...f, score: 3, line: null, text: null }); continue; }
    if (!TEXT.test(f.rel) || f.size > 300000) continue;
    let text; try { text = readFileSync(f.path, 'utf8'); } catch { continue; }
    const low = text.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue;
    const lines = text.split('\n'), i = lines.findIndex((l) => { const x = l.toLowerCase(); return words.every((w) => x.includes(w)); });
    const at = i >= 0 ? i : lines.findIndex((l) => l.toLowerCase().includes(words[0]));
    hits.push({ ...f, score: i >= 0 ? 2 : 1, line: at + 1, text: lines[at]?.trim().slice(0, 200) || null });
  }
  return hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, limit).map(({ path: _, ...h }) => h);
}

// A file inside the project's folders, by its path relative to one of them (or absolute inside one).
function resolve(p, rel) {
  const dirs = projectDirs(p);
  if (!dirs.length) throw err(400, `${p.name} has no folder on this computer. Add one in the project’s settings.`);
  const tries = path.isAbsolute(rel) ? [path.resolve(rel)] : dirs.map((d) => path.resolve(d, rel));
  for (const f of tries) {
    const root = dirs.find((d) => f === d || f.startsWith(d + path.sep));
    if (!root) continue;
    if (SECRET.test(f) || f.split(path.sep).some((s) => s === 'node_modules' || s === '.git')) throw err(403, 'Trace doesn’t read or write secrets, dependencies or git internals.');
    return { root, file: f };
  }
  throw err(400, 'That path is outside this project’s folders.');
}

export function readFile(p, rel, max = 200000) {
  const { file, root } = resolve(p, rel);
  let st; try { st = statSync(file); } catch { throw err(404, `No file at ${rel}`); }
  if (!st.isFile()) throw err(400, `${rel} is a folder`);
  const text = readFileSync(file, 'utf8');
  return { root, rel: path.relative(root, file).replace(/\\/g, '/'), text: text.slice(0, max), truncated: text.length > max, mtime: st.mtimeMs };
}

export function writeFile(p, rel, content) {
  const { file, root } = resolve(p, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, String(content));
  return { root, rel: path.relative(root, file).replace(/\\/g, '/') };
}

export const changedSince = (p, ts, limit = 40) => walk(p).filter((f) => f.mtime > ts).sort((a, b) => b.mtime - a.mtime).slice(0, limit);

// A folder dropped in the browser arrives as its name and its files, never where it is. Find it on this computer: the
// places people keep code (and next to the folders of projects already here), four levels deep, where every sampled
// file is there at its size. The newest match wins; null when it isn't here (then it's copied in).
export function findOnDisk(name, sample, near = []) {
  if (!sample.length) return null;
  const home = os.homedir(), want = String(name).toLowerCase(), t0 = Date.now(), seen = new Set(), hits = [];
  const isDir = (d) => { try { return statSync(d).isDirectory(); } catch { return false; } };
  const fits = (dir) => sample.filter((f) => { try { return statSync(path.join(dir, f.path)).size === f.size; } catch { return false; } }).length >= Math.ceil(sample.length * 0.9);
  const go = (dir, depth) => {
    if (seen.size > 40000 || Date.now() - t0 > 5000) return; // ponytail: bounded scan of the usual places, not the whole disk
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIR.test(e.name) || /^(AppData|Library|Application Data|\$Recycle\.Bin)$/i.test(e.name)) continue;
      const f = path.join(dir, e.name);
      if (seen.has(f.toLowerCase())) continue;
      seen.add(f.toLowerCase());
      if (e.name.toLowerCase() === want && fits(f)) hits.push(f);
      if (depth < 4) go(f, depth + 1);
    }
  };
  const starts = [...near.map((d) => path.dirname(d)), DATA_FOLDERS, ...['Desktop', 'Documents', 'Downloads', 'OneDrive/Desktop', 'OneDrive/Documents', 'source/repos', 'Projects', 'code', 'dev', 'repos', 'GitHub'].map((d) => path.join(home, d))];
  for (const s of [...new Set(starts)].filter(isDir)) go(s, 0);
  go(home, 3); // straight under the home folder too
  return hits.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
}

// When it isn't on this computer, Trace keeps a copy of it in data/folders/<name> (or <name>-2…), and the project works on that.
export const DATA_FOLDERS = path.join(DATA, 'folders');
export function newCopy(name) {
  const base = String(name).replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'folder';
  let dir = path.join(DATA_FOLDERS, base);
  for (let i = 2; existsSync(dir); i++) dir = path.join(DATA_FOLDERS, `${base}-${i}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function copyInto(dir, rel, buf) {
  const root = path.resolve(dir), file = path.resolve(root, String(rel).replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!root.startsWith(path.resolve(DATA_FOLDERS) + path.sep) || !file.startsWith(root + path.sep)) throw err(400, 'That path isn’t inside the copy.');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
}
