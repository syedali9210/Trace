// The stress walk: each page the last walk found, opened again under what nobody designs for, and checked by rule.
//   base:  as it is, to tell what the conditions broke from what was broken already
//   empty: the app's JSON answers come back with every list emptied
//   error: its JSON answers come back as a 500
//   slow:  its JSON answers held back 6 s, and the page pictured while it waits
//   long:  every text ~40% longer, with accents (a translation)
// The rules are walk.js `__tw.rules()`. "Data" is any JSON the page asks for (dev-server traffic aside); an app that asks
// for none has its data built in, so empty, error and slow can't be forced, and the result says so.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA, broadcast } from './db.js';
import { storeFile } from './media.js';
import { openBrowser } from './cdp.js';
import { WALK } from './walk.js';
import { DEVICES, screens } from './screens.js';
import { liveFor } from './history.js';
import { discover } from './frames.js';

const err = (status, message) => Object.assign(new Error(message), { status });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const MODES = ['base', 'empty', 'error', 'slow', 'long'];
const DEV = /\/(@vite|__vite|@react-refresh|_next\/|__nextjs|_nuxt\/|node_modules\/)|hot-update|__webpack|sockjs/;
const fileOf = (pid, sha) => path.join(DATA, 'screens', pid, `${sha}.stress.json`);
export const lastStress = (pid, sha) => { try { return JSON.parse(readFileSync(fileOf(pid, sha), 'utf8')); } catch { return null; } };

// Every list in a JSON answer emptied, the rest kept (an object of lists is still that object).
export const emptied = (v, d = 0) => (Array.isArray(v) ? [] : v && typeof v === 'object' && d < 8 ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, emptied(x, d + 1)])) : v);

async function answer(t, q) {
  const go = () => t.cdp('Fetch.continueRequest', { requestId: q.requestId });
  const type = (q.responseHeaders || []).find((h) => /^content-type$/i.test(h.name))?.value || '';
  if (!/json/i.test(type) || DEV.test(q.request.url)) return go();
  t.data++;
  if (t.mode === 'slow') { await wait(6000); return go(); }
  const send = (code, body, headers) => t.cdp('Fetch.fulfillRequest', { requestId: q.requestId, responseCode: code, responseHeaders: headers, body: Buffer.from(body).toString('base64') });
  if (t.mode === 'error') return send(500, '{"error":"The server failed (Trace stress walk)."}', [{ name: 'content-type', value: 'application/json' }]);
  if (t.mode !== 'empty') return go();
  const { body, base64Encoded } = await t.cdp('Fetch.getResponseBody', { requestId: q.requestId });
  let v; try { v = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body); } catch { return go(); }
  return send(q.responseStatusCode || 200, JSON.stringify(emptied(v)), (q.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name)));
}

async function load(t, origin, url, mode, names) {
  t.mode = mode; t.data = 0;
  const e0 = t.errors.length;
  await t.forget(origin);
  await t.go(url);
  if (mode !== 'slow') { await t.eval('__tw.calm()').catch(() => {}); if (mode === 'long') await t.eval('__tw.stretch()').catch(() => {}); await t.idle(300, 3000); }
  const { found: all = [] } = (await t.eval('__tw.rules()').catch(() => null)) || {};
  const found = mode === 'long' ? all.filter((f) => f.rule !== 'faint') : all; // longer words don't change a colour
  const tree = ((await t.eval(`__tw.tree(${JSON.stringify(names)})`).catch(() => null)) || []).map(({ n, p, props }) => ({ n, p, props })); // the states it forced, for the inventory
  const shot = storeFile(await t.shot({ format: 'webp', quality: 80 }), 'webp');
  return { found, errors: [...new Set(t.errors.slice(e0))].slice(0, 5), data: t.data, shot, tree };
}
// A finding the page had as it is isn't the condition's doing. Long text changes the words (accented, longer), so a
// finding is the same when one's words, unaccented, begin the other's.
const plain = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const sameFinding = (f, g) => f.rule === g.rule && (plain(f.t).startsWith(plain(g.t)) || plain(g.t).startsWith(plain(f.t)));

export async function stressApp(p, sha) {
  const tick = (o) => broadcast('history', { project_id: p.id, stress: sha, stressing: o }); // how far it got, live; null when it's done
  const d = screens(p, sha);
  if (!d.screens.length) throw err(409, 'Walk this version first: the stress walk opens the pages it found.');
  const lv = liveFor(p.id).find((x) => x.sha === sha);
  if (lv?.status !== 'ready') throw err(409, 'Run this version first: the stress walk opens it while it runs.');
  const url = lv.url.startsWith('/') ? `http://127.0.0.1:${process.env.TRACE_PORT || 4317}${lv.url}` : lv.url, origin = new URL(url).origin;
  const pages = new Map(); // a page each (its first screen), not its dialogs or option rows
  for (const s of d.screens) if (!s.fp?.layer && !s.group && !pages.has(s.fp?.path || '/') && pages.size < 8) pages.set(s.fp?.path || '/', s.name);
  const code = await discover(p, sha).catch(() => null), names = [...new Set((code?.components || []).map((c) => c.name))];
  const dev = DEVICES[d.device] || DEVICES.desktop, t0 = Date.now();
  const browser = await openBrowser(dev);
  try {
    const tabs = [browser, ...(await Promise.all([1, 2].map(() => browser.fork().catch(() => null)))).filter(Boolean)];
    for (const t of tabs) {
      await t.init(WALK);
      if (dev.mobile) await t.size(dev);
      await t.cdp('Fetch.enable', { patterns: [{ resourceType: 'XHR', requestStage: 'Response' }, { resourceType: 'Fetch', requestStage: 'Response' }] });
      t.on((method, q) => { if (method === 'Fetch.requestPaused') answer(t, q).catch(() => t.cdp('Fetch.continueRequest', { requestId: q.requestId }).catch(() => {})); });
    }
    const jobs = [...pages].flatMap(([at, name]) => MODES.map((mode) => ({ at, name, mode }))), done = [], total = jobs.length;
    await Promise.all(tabs.map(async (t) => {
      for (let j; (j = jobs.shift()); ) {
        done.push({ ...j, ...(await load(t, origin, origin + j.at, j.mode, names).catch((e) => ({ found: [], errors: [e.message], data: 0, shot: null, tree: [] }))) });
        tick({ done: done.length, total, label: `${j.name}: ${j.mode}` });
      }
    }));
    const out = {
      at: Date.now(), ms: Date.now() - t0, url, device: d.device || 'desktop', data: done.some((r) => r.data > 0),
      pages: [...pages].map(([at, name]) => {
        const of = (m) => done.find((r) => r.at === at && r.mode === m), was = of('base')?.found || [], threw = new Set(of('base')?.errors || []);
        return { at, name, modes: Object.fromEntries(MODES.map((m) => { const r = of(m); return [m, r && { shot: r.shot, data: r.data, tree: r.tree, found: m === 'base' ? r.found : r.found.filter((f) => !was.some((g) => sameFinding(f, g))), errors: m === 'base' ? r.errors : r.errors.filter((e) => !threw.has(e)) }]; })) };
      }),
    };
    mkdirSync(path.dirname(fileOf(p.id, sha)), { recursive: true });
    writeFileSync(fileOf(p.id, sha), JSON.stringify(out));
    return out;
  } finally { await browser.close(); tick(null); }
}
