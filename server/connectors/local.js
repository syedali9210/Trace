// Connectors that need no account: uploads (drop / paste / button), watched folders (the desktop agent's file
// watcher, run in-process since Trace runs on your machine) and AI agents writing through MCP.
import { watch, statSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { get, all, now, uid } from '../db.js';
import { storeFile, readKey, kindOf, extOf, sha256, unzip } from '../media.js';
import { ingest, batchDone } from '../engine.js';
import { SECRET } from '../folders.js';

export const assetType = (name) => ({ image: 'image', svg: 'image', video: 'video', pdf: 'document', docx: 'document', text: 'doc', code: 'code', font: 'font', design: 'design file' })[kindOf(name)] || 'file';
const OS_USER = os.userInfo().username;

// ---------- uploads ----------
export const upload = {
  tool: 'upload', label: 'Uploads',
  fetchObject(ev) {
    const p = ev.payload;
    return [{ external_id: ev.external_id, type: assetType(p.name), name: p.name, path: p.path || p.name, parent: p.parent || '' }];
  },
  renderPreview(ev) { return { buf: readKey(ev.payload.file_key), name: ev.payload.name }; },
};

// One file (or a zip, unpacked) dropped into Trace. Re-uploading a file with the same name in the same
// project makes a new version of that asset, so it gets a diff.
export function captureUpload(source, { buf, name, project_id, batch, batch_size, actor, exploration_id }) {
  const files = extOf(name) === 'zip' ? unzip(buf).filter((e) => !/(^|\/)(__MACOSX|\.)/.test(e.name)).map((e) => ({ buf: e.data, name: e.name })) : [{ buf, name }];
  const size = batch_size + files.length - 1;
  const results = [];
  for (const f of files) {
    const base = path.posix.basename(f.name);
    const scope = project_id || 'unsorted';
    results.push(ingest(source, {
      external_id: `${scope}/${f.name}`, version: sha256(f.buf), type: 'file.uploaded', actor,
      payload: { name: base, path: f.name, parent: path.posix.dirname(f.name) === '.' ? scope : path.posix.dirname(f.name), file_key: storeFile(f.buf, extOf(base)), size: f.buf.length, project_id, exploration_id, batch, batch_size: size },
    }));
  }
  return results;
}

// ---------- watched folders ----------
const watchers = new Map();
const timers = new Map();
const IGNORE = /(^|[\\/])(\.|~\$|node_modules[\\/]|\.git[\\/])|\.(tmp|temp|crdownload|part|swp|lock|ds_store|ini)$|Thumbs\.db$/i;
// In a code folder, what the build makes from the work isn't the work: dist/ holds every image again under a hashed
// name. Lockfiles and build info change with every install. (A folder of designs keeps its build/ or out/.)
const BUILT = /(^|\/)(dist|build|out|\.next|\.nuxt|\.svelte-kit|\.turbo|\.vercel|\.output|coverage|storybook-static)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|[^/]*\.tsbuildinfo|next-env\.d\.ts)$/i;
// Nor is what the app makes when it runs (exported films, renders, generated thumbnails, caches, logs), nor anything
// over 25 MB (a 96 MB exported film): Trace keeps a copy of every file it captures.
const OUTPUT = /(^|\/)([\w-]*exports?|renders?|outputs?|thumbs|thumbnails|\.?cache|tmp|temp|logs?)(\/|$)/i;
const BIG = 25e6;
const codeRoot = new Map();
const isCode = (root) => { if (!codeRoot.has(root)) codeRoot.set(root, existsSync(path.join(root, 'package.json'))); return codeRoot.get(root); };
const skip = (root, r) => IGNORE.test(r) || SECRET.test(r) || (isCode(root) && (BUILT.test(r) || OUTPUT.test(r)));
// In a git repo, the project says what its work is: what .gitignore leaves out (frame captures, exports, local caches)
// isn't. Its docs still come in (a context doc kept off a public repo is still the story). No git, no repo: the rules above.
const DOC = /\.mdx?$/i;
const isRepo = (root) => existsSync(path.join(root, '.git'));
function gitFiles(root) {
  if (!isRepo(root)) return null;
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64e6 });
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null;
}
function gitIgnored(root, rels) { // which of these git ignores, in one call
  if (!rels.length || !isRepo(root)) return new Set();
  const r = spawnSync('git', ['check-ignore', '--stdin', '-z'], { cwd: root, input: `${rels.join('\0')}\0`, encoding: 'utf8', windowsHide: true, maxBuffer: 16e6 });
  return new Set(r.status === 0 ? r.stdout.split('\0').filter(Boolean) : []); // 1: none ignored; anything else: git unusable, so nothing is
}
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

function captureFile(source, abs, extra = {}) {
  let st;
  try { st = statSync(abs); } catch { return; } // deleted again
  const root = source.scope.path, r = rel(root, abs);
  if (!st.isFile() || st.size > (isCode(root) ? BIG : 200e6) || skip(root, r)) return;
  const buf = readFileSync(abs);
  return ingest(get('SELECT * FROM source WHERE id=?', source.id) || source, {
    external_id: r, version: sha256(buf), type: extra.type || 'file.saved', actor: OS_USER, ts: extra.ts || now(),
    payload: { name: path.basename(abs), path: r, parent: path.posix.dirname(r), file_key: storeFile(buf, extOf(abs)), size: st.size, boundary: /(^|\/)exports?\//i.test(r) ? 'export' : undefined, ...extra.payload },
  });
}

// Which files of a folder its first import takes (paths relative to it), and how many it could have taken.
export function pickFiles(root, limit = 600) {
  const code = isCode(root), found = [];
  const tracked = gitFiles(root), work = tracked && new Set(tracked), dirs = tracked && new Set(tracked.flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  const walk = (dir, depth) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of ents) {
      if (found.length >= 20000) return; // ponytail: a folder past 20,000 files is read in part
      const abs = path.join(dir, d.name), r = rel(root, abs);
      if (skip(root, r)) continue;
      if (d.isDirectory()) { if (depth < 12 && (!dirs || dirs.has(r))) walk(abs, depth + 1); continue; } // a folder git ignores whole isn't walked
      if (work && !work.has(r) && !DOC.test(r)) continue;
      let size = 0; try { size = statSync(abs).size; } catch { continue; }
      if (size <= (code ? BIG : 200e6)) found.push(r);
    }
  };
  walk(root, 0);
  const rank = code
    ? (r) => (/^[^/]+\.mdx?$|^package\.json$/i.test(r) ? 0 : /\.mdx?$/i.test(r) ? 1 : /\.(tsx|jsx|vue|svelte|astro)$/i.test(r) ? 2 : /\.(ts|js|mjs|cjs|css|scss|html?)$/i.test(r) ? 3 : /(^|\/)\d{3,}\.\w+$/.test(r) ? 6 : /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(r) ? 4 : 5) // a numbered frame of a sequence (0004.jpg) last
    : (r) => (/\.(fig|sketch|xd|pen|riv|psd|ai|png|jpe?g|webp|svg|pdf|mp4|mov)$/i.test(r) ? 0 : /\.(mdx?|txt)$/i.test(r) ? 1 : 2);
  const files = found.map((r) => ({ r, k: rank(r), d: r.split('/').length })).sort((a, b) => a.k - b.k || a.d - b.d || a.r.localeCompare(b.r)).slice(0, limit).map((x) => x.r);
  return { files, of: found.length };
}

export const folder = {
  tool: 'folder', label: 'Watched folder', interval: null,
  authorize({ path: p }) {
    const abs = path.resolve(String(p || '').trim().replace(/^"|"$/g, ''));
    if (!p || !existsSync(abs) || !statSync(abs).isDirectory()) throw Object.assign(new Error(`“${p}” isn’t a folder on this computer. Paste the full path, e.g. C:\\Users\\you\\Designs`), { status: 400 });
    return { name: path.basename(abs) || abs, scope: { path: abs } };
  },
  listScopes(source) {
    try { return readdirSync(source.scope.path, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip(source.scope.path, d.name)).map((d) => ({ id: `${d.name}/`, name: d.name, kind: 'folder' })); } catch { return []; }
  },
  subscribe(source) {
    if (watchers.has(source.id) || !existsSync(source.scope.path)) return;
    // Saves gather for 1.5 s (a save finishing, or a checkout writing 700 files at once), then git says which it ignores, in one call.
    const root = source.scope.path, pending = new Set();
    const flush = () => {
      timers.delete(source.id);
      const files = [...pending].filter((abs) => !skip(root, rel(root, abs)));
      pending.clear();
      const ignored = gitIgnored(root, files.map((abs) => rel(root, abs)));
      for (const abs of files) if (!ignored.has(rel(root, abs)) || DOC.test(abs)) try { captureFile(source, abs); } catch (e) { console.error('folder capture', e.message); }
    };
    const w = watch(root, { recursive: true }, (_, file) => {
      if (!file) return;
      pending.add(path.join(root, file));
      clearTimeout(timers.get(source.id));
      timers.set(source.id, setTimeout(flush, 1500));
    });
    w.on('error', () => watchers.delete(source.id));
    watchers.set(source.id, w);
  },
  unsubscribe(source) { watchers.get(source.id)?.close(); watchers.delete(source.id); },
  // Existing files come in once, as one "imported" moment, so the project doesn't start empty. A big folder holds
  // thousands of files: the whole tree is read first (dependencies, builds and outputs left out), then what tells the
  // work comes in first, up to `limit`: in code, its docs, its screens and components, its other code, its pictures;
  // in a folder of designs, its designs. The first import of a project's own folder is the person's: it's accepted.
  initialScan(source, limit = 600) {
    const { files, of } = pickFiles(source.scope.path, limit);
    const batch = uid('b');
    for (const f of files) captureFile(source, path.join(source.scope.path, f), { type: 'file.imported', payload: { batch, batch_size: files.length, ...(source.project_id ? { accept: 1 } : {}) } });
    batchDone(batch); // every file is in: the import closes as soon as they're processed, not a minute later
    return { files: files.length, of };
  },
  fetchObject(ev) {
    const p = ev.payload;
    return [{ external_id: ev.external_id, type: assetType(p.name), name: p.name, path: p.path, parent: p.parent }];
  },
  renderPreview(ev) { return { buf: readKey(ev.payload.file_key), name: ev.payload.name }; },
  health(source) { return { ok: existsSync(source.scope.path), detail: watchers.has(source.id) ? 'Watching for saves' : 'Not watching', }; },
};

// ---------- AI agents (writes through MCP) ----------
export const agent = {
  tool: 'agent', label: 'AI agents (MCP)',
  fetchObject(ev) {
    const p = ev.payload;
    return [{ external_id: ev.external_id, type: p.artifact_type || 'agent log', name: p.title || 'Agent work', path: `agents/${p.agent}/${p.title || ''}`, parent: `agents/${p.agent}`, url: p.links?.[0] }];
  },
  renderPreview(ev) {
    const p = ev.payload;
    if (p.image_key) return { image: readKey(p.image_key), text: `${p.title}\n${p.summary}` };
    return { card: { title: p.title || 'Agent work', label: (p.agent || 'agent').toUpperCase(), lines: [p.summary || '', '', ...(p.links || []), ...(p.content ? String(p.content).split('\n') : [])], mono: !!p.content }, text: `${p.title}\n${p.summary}\n${p.content || ''}\n${(p.links || []).join('\n')}`, properties: p.content ? { artifact: { type: p.artifact_type, length: p.content.length } } : undefined };
  },
};

export const watchedFolders = () => all("SELECT * FROM source WHERE tool='folder'");
