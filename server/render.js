// Code → pictures. A changed React component file is compiled with esbuild against its own project (its own
// react, its CSS, its tsconfig paths), rendered in a headless browser, and kept as that version's picture, so a
// code change shows visually wherever a design change does. Before and after are the same file at two versions
// (the other files as they are now). Each exported component is drawn as a labelled frame, with sample props
// read from its own type annotations; if none can render without real data, the whole app is drawn instead.
import { build } from 'esbuild';
import { openBrowser } from './cdp.js';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { browserPath } from './media.js';

export const RENDERABLE = /^(?!.*\.(test|spec|stories)\.[jt]sx$).*\.(tsx|jsx)$/i; // components, not their tests or stories

// The nearest package that depends on React (a monorepo package, not its root).
function pkgOf(file) {
  for (let d = path.dirname(file), i = 0; i < 14; i++) {
    const f = path.join(d, 'package.json');
    if (existsSync(f)) { try { const j = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); const deps = { ...j.dependencies, ...j.devDependencies, ...j.peerDependencies }; if (deps.react) return { dir: d, react: parseInt(String(deps.react).replace(/[^\d]/, '')) || 18 }; } catch {} } // a Windows editor may add a BOM
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return null;
}
// The app's entry (from index.html, else src/main|index), and the CSS it imports for every screen.
function entryOf(pkg) {
  let id = 'root', src = null;
  try {
    const html = readFileSync(path.join(pkg.dir, 'index.html'), 'utf8');
    id = html.match(/<div[^>]*\bid=["']([\w-]+)["']/)?.[1] || id;
    src = html.match(/<script[^>]*type=["']module["'][^>]*src=["']\/?([^"']+)["']/)?.[1];
  } catch {}
  const file = src ? path.join(pkg.dir, src) : ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx'].map((f) => path.join(pkg.dir, f)).find(existsSync);
  const css = file && existsSync(file) ? [...readFileSync(file, 'utf8').matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map((m) => path.resolve(path.dirname(file), m[1])).filter(existsSync) : [];
  return { file: file && existsSync(file) ? file : null, id, css };
}

// ---------- reading the component code (server/props.js: also used inside a project's own Vite for frames) ----------
import { componentsIn, propsFor } from './props.js';
export { componentsIn, propsFor };

// ---------- compiling ----------
const SHEET_CSS = `html,body{margin:0}body{padding:32px;font-family:system-ui,sans-serif}#__sheet{display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start}
.__t{display:flex;flex-direction:column;gap:10px;max-width:1180px}.__l{font:500 11px/1.2 ui-monospace,Consolas,monospace;color:#8c8c8c;letter-spacing:.02em}
.__c{position:relative;min-width:24px}.__t:has(>.__c:empty){display:none}`;
async function bundle({ file, source, mode, pkg }) {
  const entry = entryOf(pkg);
  const target = path.resolve(file);
  const ext = path.extname(file).slice(1);
  const names = componentsIn(source);
  if (mode === 'components' && !names.length) return null;
  const rd = pkg.react >= 18 ? `import { createRoot } from 'react-dom/client'; const mount = (el, node) => createRoot(el).render(node);` : `import { render } from 'react-dom'; const mount = (el, node) => render(node, el);`;
  const code = mode === 'components'
    ? `${entry.css.map((c) => `import ${JSON.stringify(c)};`).join('\n')}
import * as React from 'react';
import * as M from ${JSON.stringify(target)};
${rd}
class Guard extends React.Component { constructor(p) { super(p); this.state = { e: null }; } static getDerivedStateFromError(e) { return { e }; } componentDidCatch() {} render() { return this.state.e ? null : this.props.children; } }
const list = [${names.map((c) => `[${JSON.stringify(c.name)}, M[${JSON.stringify(c.key)}], ${propsFor(source, c.name)}]`).join(', ')}];
const h = React.createElement;
mount(document.getElementById('${entry.id}'), h('div', { id: '__sheet' }, list.filter(([, C]) => C).map(([n, C, p]) => h('section', { key: n, className: '__t' }, h('div', { className: '__l' }, n), h('div', { className: '__c' }, h(Guard, null, h(C, p)))))));`
    : `import ${JSON.stringify(entry.file)};`;
  if (mode === 'app' && !entry.file) return null;
  const globals = {};
  for (const m of source.matchAll(/\b__[A-Z][A-Z0-9_]*__\b/g)) globals[m[0]] = 'false'; // build-time flags (Vite define)
  try { if (entry.file) for (const m of readFileSync(entry.file, 'utf8').matchAll(/\b__[A-Z][A-Z0-9_]*__\b/g)) globals[m[0]] = 'false'; } catch {}
  const out = await build({
    stdin: { contents: code, resolveDir: path.dirname(target), sourcefile: 'trace-render.jsx', loader: 'jsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', minify: true, outdir: 'out', logLevel: 'silent', absWorkingDir: pkg.dir,
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"MODE":"production","DEV":false,"PROD":true,"SSR":false,"BASE_URL":"/"}', ...globals },
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.otf': 'dataurl' },
    plugins: [{ name: 'trace-version', setup(b) {
      b.onResolve({ filter: /.*/ }, async (a) => { // a font or picture behind a bundler alias: draw without it
        if ((a.kind !== 'url-token' && a.kind !== 'import-rule') || a.pluginData?.trace) return undefined;
        const r = await b.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: { trace: 1 } });
        return r.errors.length ? { path: a.path, external: true } : r;
      });
      b.onResolve({ filter: /\?(raw|url|inline)$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.split('?')[0]), namespace: a.path.endsWith('?raw') ? 'raw' : 'file' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: `export default ${JSON.stringify(readFileSync(a.path, 'utf8'))}`, loader: 'js' }));
      b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (a) => (path.resolve(a.path) === target ? { contents: source, loader: ext } : undefined)); // this version of the file
    } }],
  });
  const js = out.outputFiles.find((f) => f.path.endsWith('.js'))?.text || '';
  const css = out.outputFiles.filter((f) => f.path.endsWith('.css')).map((f) => f.text).join('\n');
  const mountHtml = `<div id="${entry.id}"></div>`;
  return { names: mode === 'components' ? names.map((c) => c.name) : [], html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style>${mode === 'components' ? `<style>${SHEET_CSS}</style>` : '<style>html,body{margin:0}</style>'}</head><body>${mountHtml}<script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>` };
}

// ---------- drawing: a headless browser screenshot of the page, trimmed to what was drawn ----------
// One long-lived browser (cdp.js) with up to PAGES pages drawing at once, closed after a minute with nothing to draw.
// (Virtual time would run entrances ahead instantly, but a page paused by it never paints a frame again for the
// screenshot.) Each drawing waits for its load, fonts and running animations instead, 1.5 s at most.
const PAGES = 3;
let browser = null, idle = null;
const free = [], waiting = [];
let open = 0;
async function borrow() {
  clearTimeout(idle);
  if (free.length) return free.pop();
  if (open >= PAGES) return new Promise((r) => waiting.push(r));
  open++;
  try {
    browser ||= openBrowser({ width: 1280, height: 900, scale: 1 }).catch((e) => { browser = null; throw e; });
    const main = await browser;
    return main.used ? await main.fork() : Object.assign(main, { used: true });
  } catch (e) { open--; throw e; }
}
const reset = async () => { const b = browser; browser = null; free.length = 0; open = 0; waiting.splice(0).forEach((r) => r(null)); (await b?.catch(() => null))?.close(); };
function giveBack(page, broken) {
  if (broken) return reset(); // a page that hung or a browser that died: start over with a fresh one next time
  if (waiting.length) return waiting.shift()(page);
  free.push(page);
  if (free.length === open) idle = setTimeout(reset, 60000);
}
async function shoot(html, width = 1280, height = 900, url = null) {
  if (!browserPath()) return null;
  let page;
  try { page = await borrow(); } catch { return null; }
  if (!page) return null;
  let dir = null, broken = false;
  try {
    if (!url) { dir = mkdtempSync(path.join(os.tmpdir(), 'trace-render-')); writeFileSync(path.join(dir, 'page.html'), html); }
    await page.size({ width, height });
    await page.go(url || `file:///${path.join(dir, 'page.html').replace(/\\/g, '/')}`); // loaded, fonts in, painted
    await page.eval(`Promise.race([Promise.all(document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming?.().endTime)).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, ${url ? 2500 : 1500}))])`).catch(() => {}); // entrances finished
    return await page.shot();
  } catch { broken = true; return null; }
  finally {
    giveBack(page, broken);
    if (dir) setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }, 2000);
  }
}
async function trimmed(png) {
  const img = sharp(png).flatten({ background: '#ffffff' });
  let out;
  try { out = await img.trim({ threshold: 6 }).toBuffer({ resolveWithObject: true }); } catch { return null; } // one flat colour: nothing rendered
  if (out.info.width < 12 || out.info.height < 12) return null;
  if ((await sharp(out.data).stats()).channels.slice(0, 3).every((c) => c.stdev < 4)) return null; // a near-blank page (white text on white, a faint line): nothing worth a picture
  const { data } = await sharp(png).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true }); // pad with the page's own colour
  return sharp(out.data).extend({ top: 28, bottom: 28, left: 28, right: 28, background: { r: data[0], g: data[1], b: data[2] } }).png().toBuffer();
}

// A running app as a picture: a version's node on the History canvas.
export const shootUrl = (url, width = 1280, height = 800) => shoot(null, width, height, url);

// One version of a component file → { png, mode, names } or { error }. Components first; the app if none draw.
export async function renderVersion({ file, source }) {
  if (!RENDERABLE.test(file)) return { error: 'Only .tsx and .jsx files are drawn.' };
  const pkg = pkgOf(file);
  if (!pkg) return { error: 'No React project around this file (no package.json with react).' };
  let lastError = null;
  for (const mode of ['components', 'app']) {
    let b;
    try { b = await bundle({ file, source, mode, pkg }); } catch (e) { lastError = (e.errors?.[0]?.text || e.message || String(e)).slice(0, 300); continue; }
    if (!b) continue;
    const shot = await shoot(b.html, mode === 'app' ? 1280 : 1280, mode === 'app' ? 820 : 900);
    const png = shot && (mode === 'app' ? await sharp(shot).png().toBuffer() : await trimmed(shot));
    if (png) return { png, mode, names: b.names };
    lastError = mode === 'components' ? 'Its components need real data to draw.' : 'The app drew nothing without its data.';
  }
  return { error: lastError || 'Nothing to draw.' };
}
// ---------- an artifact (a single file an AI wrote, or you pasted) as a page for a sandboxed iframe ----------
// React/JSX is compiled here; its packages (React, icons, charts…) load from esm.sh in the frame, one React for all;
// Tailwind classes work, since AI-made artifacts lean on them. HTML runs as it is; SVG is shown as a picture.
export function artifactKind(a) {
  const c = String(a.content || '').trim();
  if (a.type === 'image' || a.file_key && /^image\//.test(a.meta?.mime || '')) return 'image';
  if (/^<svg[\s>]/i.test(c)) return 'svg';
  if (/^(<!doctype html|<html)/i.test(c) || (/<(div|body|section|main|style|script)[\s>]/i.test(c) && !/\bimport\s.+from\s/.test(c))) return 'html';
  if (/\bfrom\s+['"]react['"]|export\s+default\s+(function|\(|\w)|=>\s*\(?\s*</.test(c) && /<\w/.test(c)) return 'react';
  if (/^#{1,3}\s|\n#{1,3}\s|\n[-*]\s/.test(c) && !/[{};]\s*$/.test(c)) return 'markdown';
  if (a.url && !c) return 'link';
  return c ? 'code' : a.url ? 'link' : 'empty';
}
const TW = '<script src="https://cdn.tailwindcss.com/3.4.17"></script>';
const R = 'react@18.3.1', RD = 'react-dom@18.3.1';
export async function artifactPage(a) {
  const kind = artifactKind(a), c = String(a.content || '');
  const shell = (head, body) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${head}<style>html,body{margin:0}</style></head><body>${body}<script>addEventListener("error",(e)=>{document.body.insertAdjacentHTML("afterbegin",'<pre style="margin:0;padding:12px;background:#fde8e8;color:#7a2121;font:12px ui-monospace,monospace;white-space:pre-wrap">'+String(e.message).replace(/</g,"&lt;")+'</pre>')})</script></body></html>`;
  if (kind === 'html') return { kind, html: /^(<!doctype|<html)/i.test(c.trim()) ? c : shell(TW, c) };
  if (kind === 'svg') return { kind, html: shell('', `<div style="display:grid;place-items:center;min-height:100vh">${c}</div>`) };
  if (kind !== 'react') return { kind, html: null };
  const out = await build({
    stdin: { contents: "import * as M from 'trace:artifact'; import { createElement } from 'react'; import { createRoot } from 'react-dom/client'; const App = M.default || Object.values(M).find((v) => typeof v === 'function'); createRoot(document.getElementById('root')).render(createElement(App));", resolveDir: os.tmpdir(), loader: 'jsx', sourcefile: 'entry.jsx' },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', metafile: true, logLevel: 'silent', outdir: 'out',
    plugins: [{ name: 'artifact', setup(b) {
      b.onResolve({ filter: /^trace:artifact$/ }, () => ({ path: 'artifact.tsx', namespace: 'art' }));
      b.onLoad({ filter: /.*/, namespace: 'art' }, () => ({ contents: c, loader: 'tsx', resolveDir: os.tmpdir() }));
      b.onResolve({ filter: /^[^./]/ }, (x) => (x.namespace === 'art' || x.importer.endsWith('entry.jsx') || x.importer === '<stdin>' ? { path: x.path, external: true } : undefined));
    } }],
  });
  const js = out.outputFiles.find((f) => f.path.endsWith('.js'))?.text || '';
  const bare = new Set(Object.values(out.metafile.outputs).flatMap((o) => o.imports.filter((i) => i.external).map((i) => i.path)));
  const map = { react: `https://esm.sh/${R}`, 'react/jsx-runtime': `https://esm.sh/${R}/jsx-runtime`, 'react-dom': `https://esm.sh/${RD}?deps=${R}`, 'react-dom/client': `https://esm.sh/${RD}/client?deps=${R}` };
  for (const m of bare) if (!map[m]) map[m] = `https://esm.sh/${m}?external=react,react-dom&deps=${R},${RD}`;
  return { kind, html: shell(`<script type="importmap">${JSON.stringify({ imports: map })}</script>${TW}`, `<div id="root"></div><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`) };
}

// The same, as a live page for an iframe (no screenshot).
export async function livePage({ file, source }) {
  const pkg = pkgOf(file);
  if (!pkg) return null;
  const fit = '<script>addEventListener("load",()=>setTimeout(()=>parent.postMessage({trace:"height",h:Math.ceil(document.body.getBoundingClientRect().height)},"*"),250))</script>'; // the frame fits what was drawn
  for (const mode of ['components', 'app']) { try { const b = await bundle({ file, source, mode, pkg }); if (b) { const at = b.html.lastIndexOf('</body>'); return { html: b.html.slice(0, at) + fit + b.html.slice(at), mode }; } } catch {} } // the last </body>: the bundle may contain the text too
  return null;
}
