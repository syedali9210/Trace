// Trace's frames, served by a project's own Vite dev server (added through the config Trace starts it with, never
// written into the project). GET /__trace/frame?f=<file from the app root>&c=<component>&m=frame|states&k=screen|component
// returns a page that imports the app's global CSS, its fonts from index.html, and that one component, drawn by
// server/frame-runtime.js. So Tailwind, path aliases, CSS modules and motion libraries all work as they do in the app.
// A part is drawn the way its app would hold it: inside the providers the entry wraps the app in, with sample props
// built from its own types, real records from the repo's JSON where they fit, and its Storybook args when it has a story.
// The app's own page opened with ?__trace_steps=[…] replays the clicks the screens walk recorded, so a Preview opens on
// that screen (the Sheet open, the Providers tab picked) and stays live from there.
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { componentsIn, propTypes, makeSampler } from './props.js';
import { WALK } from './walk.js';

const posix = (p) => p.split(path.sep).join('/');
const SCROLLBARS = '::-webkit-scrollbar{width:10px;height:10px;background:transparent}::-webkit-scrollbar-button{display:none;width:0;height:0}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:999px;background-clip:padding-box;background-color:transparent}:hover::-webkit-scrollbar-thumb{background-color:rgba(128,128,128,.45)}';
const JSON_DIRS = /^(fixtures?|__fixtures__|replays?|mocks?|__mocks__|data|samples?|seeds?|demo|examples?|tests?|__tests__|e2e|stories)$/i;

// Reading the project: files, import specs (relative, tsconfig paths, package types) and the JSON it keeps as data.
export function projectIO(root) {
  const cache = new Map();
  const read = (f) => { if (cache.has(f)) return cache.get(f); let t = ''; try { t = readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch {} cache.set(f, t); return t; };
  const exists = (f) => { try { return statSync(f).isFile(); } catch { return false; } };
  let top = root; // the repository (a monorepo's root holds the shared fixtures)
  for (let d = root, i = 0; i < 5; i++, d = path.dirname(d)) { if (existsSync(path.join(d, '.git')) || existsSync(path.join(d, 'pnpm-workspace.yaml'))) { top = d; break; } if (path.dirname(d) === d) break; }
  const aliases = [];
  for (const f of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    let j; try { j = JSON.parse(read(path.join(root, f)).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')); } catch { continue; }
    const base = path.join(root, j?.compilerOptions?.baseUrl || '.');
    for (const [k, v] of Object.entries(j?.compilerOptions?.paths || {})) if (k.endsWith('*') && v?.[0]?.endsWith('*')) aliases.push([k.slice(0, -1), path.join(base, v[0].slice(0, -1))]);
  }
  if (!aliases.some(([k]) => k === '@/') && existsSync(path.join(root, 'src'))) aliases.push(['@/', path.join(root, 'src')]);
  const EXT = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '/index.ts', '/index.tsx', '/index.d.ts', '/index.js'];
  const pick = (b) => EXT.map((x) => b + x).find(exists) || null;
  const resolve = (from, spec) => {
    if (spec.startsWith('.')) return pick(path.resolve(path.dirname(from), spec));
    for (const [a, to] of aliases) if (spec.startsWith(a)) return pick(path.join(to, spec.slice(a.length)));
    const parts = spec.split('/'), name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0], sub = parts.slice(spec.startsWith('@') ? 2 : 1).join('/');
    for (let d = path.dirname(from), i = 0; i < 8; i++, d = path.dirname(d)) { // a package's own type declarations
      const dir = path.join(d, 'node_modules', name);
      if (existsSync(dir)) {
        let real = dir; try { real = realpathSync(dir); } catch {}
        if (sub) return pick(path.join(real, sub));
        let pj = {}; try { pj = JSON.parse(read(path.join(real, 'package.json'))); } catch {}
        return [pj.types, pj.typings, pj.source, pj.exports?.['.']?.types, pj.exports?.['.']?.import, pj.module, pj.main, 'src/index'].filter((x) => typeof x === 'string').map((x) => pick(path.join(real, x))).find(Boolean) || null;
      }
      if (path.dirname(d) === d) break;
    }
    return null;
  };
  const json = [];
  const walk = (dir, depth, inData) => {
    if (depth > 4 || json.length >= 60) return;
    let ents = []; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (/^(node_modules|dist|build|\.git|\.next|coverage|\.vite|\.turbo)$/.test(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1, inData || JSON_DIRS.test(e.name));
      else if (inData && e.name.endsWith('.json') && !/^(package|package-lock|tsconfig[\w.-]*|jsconfig|components|vercel|turbo|biome|renovate|lerna|nx|project)\.json$/.test(e.name)) {
        try { const st = statSync(p); if (st.size < 3e6) json.push({ file: posix(path.relative(top, p)), value: JSON.parse(read(p)) }); } catch {}
      }
    }
  };
  walk(top, 0, false);
  if (top !== root) walk(root, 0, false);
  return { read, resolve, json, top };
}

export default function traceFrames({ root, runtime }) {
  const io = projectIO(root);
  const read = (f) => io.read(f);
  const pkg = (() => { try { return JSON.parse(read(path.join(root, 'package.json'))); } catch { return {}; } })();
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const html = read(path.join(root, 'index.html'));
  const entry = html.match(/<script[^>]*type=["']module["'][^>]*src=["']\/?([^"']+)["']/)?.[1] || ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx'].find((f) => existsSync(path.join(root, f)));
  const mountId = html.match(/<div[^>]*\bid=["']([\w-]+)["']/)?.[1] || 'root';
  const cssOf = (file) => [...read(path.join(root, file)).matchAll(/^\s*import\s+['"]([^'"]+\.(?:css|scss|sass|less|pcss))['"]/gm)].map((m) => (m[1].startsWith('.') ? `/${path.posix.join(path.posix.dirname(file), m[1])}` : m[1]));
  const appFile = entry && read(path.join(root, entry)).match(/import\s+\{?\s*(\w+)\s*\}?\s+from\s+['"](\.[^'"]+)['"]/)?.[2]; // the App the entry renders: its CSS is global too
  const appPath = appFile && ['', '.tsx', '.jsx', '.ts', '.js'].map((x) => path.posix.join(path.posix.dirname(entry), appFile) + x).find((f) => existsSync(path.join(root, f)));
  const globalCss = [...new Set([...(entry ? cssOf(entry) : []), ...(appPath ? cssOf(appPath) : [])])];
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const extras = (head.match(/<link[^>]*>|<style[\s\S]*?<\/style>/gi) || []).filter((l) => !/rel=["']?(icon|manifest|apple-touch-icon|shortcut)/i.test(l)).join('\n');
  const htmlAttrs = html.match(/<html([^>]*)>/i)?.[1] || ' lang="en"', bodyAttrs = html.match(/<body([^>]*)>/i)?.[1] || '';
  const router = deps['react-router-dom'] ? 'react-router-dom' : deps['react-router'] ? 'react-router' : null;

  // The entry with its render call turned into a wrapper: export const __traceWrap = (child) => <Providers…>{child}</Providers…>.
  // Its other top-level code runs as it does in the app (a query client, i18n, a theme), so parts get their context.
  const wrapId = entry && posix(path.join(root, path.posix.dirname(entry), `__trace_entry${path.extname(entry)}`));
  const wrapCode = (() => {
    if (!entry) return null;
    const src = read(path.join(root, entry));
    const at = src.search(/\.render\(\s*</);
    if (at < 0) return null;
    const open = src.indexOf('(', at);
    let d = 0, end = -1;
    for (let i = open; i < src.length; i++) { if (src[i] === '(') d++; else if (src[i] === ')' && !--d) { end = i; break; } }
    if (end < 0) return null;
    const arg = src.slice(open + 1, end).trim().replace(/,\s*$/, '');
    let s = at, depth = 0;
    for (; s > 0; s--) { const c = src[s - 1]; if (c === ')') depth++; else if (c === '(') depth--; else if (c === '\n' && depth === 0) break; }
    let e = end + 1;
    if (src[e] === ';') e++;
    const local = new Set([...src.matchAll(/import\s+(\w+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s+['"](?:\.|@\/|~\/)[^'"]*['"]/g)].flatMap((m) => [m[1], ...(m[2] || '').split(',').map((x) => x.trim().split(/\s+as\s+/).pop())]).filter(Boolean));
    const tag = [...arg.matchAll(/<([A-Z][\w.]*)/g)].map((m) => m[1]).find((n) => local.has(n) && !/Provider|Router|StrictMode|Suspense|Boundary/.test(n));
    if (!tag) return null;
    const re = new RegExp(`<${tag}\\b[^>]*?\\/>|<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`);
    if (!re.test(arg)) return null;
    return { code: `${src.slice(0, s)}\nexport const __traceWrap = (__traceChild) => (${arg.replace(re, '{__traceChild}')});\n${src.slice(e)}`, router: /Router/.test(arg) };
  })();
  const sampler = () => makeSampler(io); // fresh per frame, so edits to types show on the next load
  const story = (file) => { // X.tsx → X.stories.tsx beside it, or in a stories folder
    const base = file.replace(/\.[jt]sx?$/, ''), dir = path.posix.dirname(file), name = path.posix.basename(base);
    return [`${base}.stories`, `${dir}/stories/${name}.stories`, `${dir}/__stories__/${name}.stories`].flatMap((b) => ['.tsx', '.jsx', '.ts', '.js'].map((x) => b + x)).find((f) => existsSync(path.join(root, f)));
  };

  return {
    name: 'trace-frames',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__trace/frame')) return next();
        const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        const page = `<!doctype html><html${htmlAttrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${extras}<style>html,body{margin:0}</style></head><body${bodyAttrs}><div id="${mountId}" hidden></div><div id="__trace"></div><script type="module" src="/@id/virtual:trace-frame${q}"></script></body></html>`;
        try { res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(await server.transformIndexHtml(req.url, page)); } catch (e) { next(e); }
      });
    },
    transformIndexHtml(html, ctx) { // pages shown inside Trace get its quiet scrollbars (only on servers Trace starts)
      const bars = { tag: 'style', attrs: { id: '__trace-scrollbars' }, children: SCROLLBARS, injectTo: 'head' };
      if (!/[?&]__trace_steps=/.test(ctx?.originalUrl || '')) return { html, tags: [bars] };
      const boot = `${WALK}
addEventListener('load', async () => { let steps = []; try { steps = JSON.parse(new URLSearchParams(location.search).get('__trace_steps')) || []; } catch {} const ok = await __tw.replay(steps); parent.postMessage({ trace: 'replayed', ok }, '*'); });`;
      return { html, tags: [bars, { tag: 'script', children: boot, injectTo: 'head-prepend' }] };
    },
    resolveId(id) {
      if (id.startsWith('virtual:trace-')) return `\0${id}`;
      if (wrapId && id.includes('__trace_entry')) return wrapId;
    },
    load(id) {
      if (id === '\0virtual:trace-runtime') return readFileSync(runtime, 'utf8'); // read fresh, so the runtime can change while Vite runs
      if (wrapId && posix(id.split('?')[0]) === wrapId) return wrapCode?.code;
      if (!id.startsWith('\0virtual:trace-frame')) return;
      const q = new URLSearchParams(id.split('?')[1] || '');
      const file = (q.get('f') || '').replace(/\\/g, '/').replace(/^\/+/, ''), name = q.get('c') || '', mode = q.get('m') === 'states' ? 'states' : 'frame';
      if (!file || file.includes('..')) return 'document.body.textContent = "No such file"';
      const abs = path.join(root, file), src = readFileSync(abs, 'utf8');
      const comp = componentsIn(src).find((c) => c.name === name) || { name, key: name };
      let sample = { code: '{}', used: [] };
      try { sample = sampler().props(abs, name); new Function(`return (${sample.code})`); } catch { sample = { code: '{}', used: [] }; } // a sample the reader got wrong: draw it bare
      const st = story(file);
      const wrapRouter = router && !wrapCode?.router;
      return [
        "import { mount } from 'virtual:trace-runtime';", // first: it owns the clock before anything animates
        ...globalCss.map((c) => `import ${JSON.stringify(c)};`),
        "import * as React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        wrapRouter ? `import { MemoryRouter } from ${JSON.stringify(router)};` : '',
        wrapCode ? `import { __traceWrap } from ${JSON.stringify(`/${path.posix.dirname(entry)}/__trace_entry${path.extname(entry)}`)};` : 'const __traceWrap = null;',
        `const wraps = [${wrapRouter ? '(n) => React.createElement(MemoryRouter, null, n)' : ''}].concat(__traceWrap ? [__traceWrap] : []);`,
        `mount({ React, createRoot, load: () => import(${JSON.stringify(`/${file}`)}), key: ${JSON.stringify(comp.key)}, name: ${JSON.stringify(name)}, mode: ${JSON.stringify(mode)}, kind: ${JSON.stringify(q.get('k') || 'component')},`,
        `  props: ${sample.code}, types: ${JSON.stringify(propTypes(src, name))}, wrap: wraps.length ? (n) => wraps.reduce((x, w) => w(x), n) : null,`,
        `  story: ${st ? `() => import(${JSON.stringify(`/${st}`)})` : 'null'}, sample: ${JSON.stringify({ files: sample.used, providers: !!wrapCode, story: st || null })} });`,
      ].join('\n');
    },
  };
}
