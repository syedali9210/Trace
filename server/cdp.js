// One headless browser, driven over the DevTools protocol: open a page, go to a URL, run code in it, click with a real
// pointer, take a picture. Trace uses it to walk an app's screens (server/screens.js). Edge or Chrome, whichever
// media.js finds; Node's own WebSocket, no packages. A page can fork more pages in the same browser, each in its own
// browser context (its own storage), so a walk runs several at once without one forgetting what another remembers.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserPath, browserEnv } from './media.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// When a call is given up on. A page answers within 20 s, but while any page of the browser is being pictured every
// page waits for its frames (one compositor, drawn in software): measured 2–5 s for a 6,500 px page, past 20 s with
// five pages loading a cold dev server. So that time doesn't count, up to 90 s in all, and a picture itself gets 60 s.
export const givesUp = ({ method, waited, drawing, sinceDrawn }) => (method === 'Page.captureScreenshot' ? waited >= 60000 : waited >= 90000 || (waited >= 20000 && !drawing && sinceDrawn >= 5000));
const UA = { phone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', tablet: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };

export async function openBrowser({ width = 1280, height = 800, scale = 1 } = {}) {
  const exe = browserPath();
  if (!exe) throw Object.assign(new Error('No Edge or Chrome found to walk the app with.'), { status: 400 });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'trace-cdp-'));
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${dir}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore', env: browserEnv(), windowsHide: true });
  let port = null, wsPath = null;
  for (let i = 0; i < 80 && !port; i++) { // the browser writes the port it picked here
    await wait(150);
    try { [port, wsPath] = readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n'); } catch {}
  }
  if (!port) { proc.kill(); throw Object.assign(new Error('The headless browser didn’t start.'), { status: 500 }); }
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Couldn’t talk to the headless browser.')); });
  let id = 0;
  const pending = new Map(), handlers = new Set();
  let drawing = 0, drewAt = 0; // pictures being taken in this browser, and when the last one ended
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) handlers.forEach((h) => h(m));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { // a page that hangs is given up on, not waited for
    const i = ++id, t0 = Date.now();
    let t;
    const check = () => { const waited = Date.now() - t0; if (!givesUp({ method, waited, drawing, sinceDrawn: Date.now() - drewAt })) { t = setTimeout(check, 1000); return; } pending.delete(i); rej(new Error(`The page didn’t answer (${method}) within ${Math.round(waited / 1000)} s.`)); };
    t = setTimeout(check, method === 'Page.captureScreenshot' ? 60000 : 20000);
    pending.set(i, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  async function tab(browserContextId) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', ...(browserContextId ? { browserContextId } : {}) });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => send(method, params, sessionId);
    await s('Page.enable'); await s('Runtime.enable'); await s('Page.setLifecycleEventsEnabled', { enabled: true });
    let vp = { width, height, scale, mobile: false };
    const metrics = (v) => s('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.scale, mobile: !!v.mobile });
    await metrics(vp);
    await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] }); // the same light screen every time, whatever this computer is set to
    await s('Network.enable');
    const errors = [], failed = [], asked = new Map(); // script errors, and the data requests that failed (the app's API not running)
    const inflight = new Map(), asks = new Map(); // requests still out (not streams): a picture waits for them to land; how often each address was asked for
    const watch = (m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params;
      if (m.method === 'Network.requestWillBeSent' && /^(Document|Fetch|XHR|Script|Stylesheet|Image|Font)$/.test(p.type || '')) { // what the picture depends on (a video streaming isn't)
        const n = (asks.get(p.request.url) || 0) + 1; // and what the app sends (a POST to its own server) is a write, not something to draw
        asks.set(p.request.url, n);
        if ((n < 3 && p.request.method === 'GET') || p.type === 'Document') inflight.set(p.requestId, { at: Date.now(), url: p.request.url }); // the same address a third time is an app polling its server: never waited on
      }
      if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight.delete(p.requestId);
      if (m.method === 'Page.javascriptDialogOpening') s('Page.handleJavaScriptDialog', { accept: !/confirm|prompt/.test(p.type) }).catch(() => {}); // an alert or "leave this page?" would block every call after it; a confirm is always declined
      if (m.method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description?.split('\n')[0] || 'error');
      if (m.method === 'Network.requestWillBeSent' && /Fetch|XHR|EventSource/.test(p.type)) asked.set(p.requestId, `${p.request.method} ${p.request.url}`);
      if (m.method === 'Network.responseReceived' && asked.has(p.requestId) && p.response.status >= 400) failed.push(`${asked.get(p.requestId)} → ${p.response.status}`);
      if (m.method === 'Network.loadingFailed' && asked.has(p.requestId) && !p.canceled) failed.push(`${asked.get(p.requestId)} → ${p.errorText}`);
    };
    handlers.add(watch);

    const page = {
      errors, failed, cdp: s,
      on(fn) { const h = (m) => { if (m.sessionId === sessionId && m.method) fn(m.method, m.params); }; handlers.add(h); return () => handlers.delete(h); }, // this page's events
      init: (source) => s('Page.addScriptToEvaluateOnNewDocument', { source }), // in every page it opens from now on
      async forget(origin) { // a first visit again: what the app remembered (seen the intro, a theme) is gone. The page leaves first (an open
        // database holds the clearing up until it closes), and a clearing that still hangs is let go after 4 s: a click isn't lost over it
        await s('Page.navigate', { url: 'about:blank' }).catch(() => {});
        await Promise.race([s('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }).catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
      },
      async go(url) { // via blank: a hash-only change wouldn't reload. Then the page's own load (15 s at most), told by its loader: a blank page's load comes after its navigate has answered, so the first load to come is often the blank's
        await s('Page.navigate', { url: 'about:blank' });
        const done = new Set(), off = page.on((m, q) => { if (m === 'Page.lifecycleEvent' && q.name === 'load') done.add(q.loaderId); });
        try { const { loaderId } = await s('Page.navigate', { url }); for (const t0 = Date.now(); loaderId && !done.has(loaderId) && Date.now() - t0 < 15000; ) await wait(50); } finally { off(); }
        await page.settle();
      },
      async settle(extra = 400) { // fonts in (or 3 s at most), the first frames painted, network quiet enough
        await page.eval('Promise.race([document.fonts ? document.fonts.ready.then(() => true) : true, new Promise((r) => setTimeout(r, 3000))])').catch(() => {});
        await page.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))').catch(() => {});
        await wait(extra);
      },
      async idle(quiet = 350, max = 4000) { // the network quiet for a moment (a request out longer than 10 s is a poll, not a wait)
        const t0 = Date.now();
        let calmSince = Date.now();
        while (Date.now() - t0 < max) {
          for (const [id, r] of inflight) if (Date.now() - r.at > 10000) inflight.delete(id);
          if (inflight.size) calmSince = Date.now(); else if (Date.now() - calmSince >= quiet) return true;
          await wait(80);
        }
        return false;
      },
      waiting: () => [...inflight.values()].map((r) => r.url), // what idle() is still waiting on
      async eval(expression) {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || 'Script failed');
        return r.result?.value;
      },
      async click(x, y) { // a real pointer: move, press, release
        await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      },
      async size(v) { // a phone or a tablet from here on: its width, touch, a mobile browser's name (the next load picks it up); or only a new height
        const was = vp.mobile;
        vp = { ...vp, ...v };
        await metrics(vp);
        if (vp.mobile === was) return;
        await s('Emulation.setTouchEmulationEnabled', { enabled: !!vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
        if (vp.mobile) await s('Emulation.setUserAgentOverride', { userAgent: vp.width < 600 ? UA.phone : UA.tablet });
      },
      async shot({ height: h, format = 'png', quality, scale = 1 } = {}) { // the page, as tall as it is (up to h), without resizing it (100vh stays 100vh); webp is encoded by the browser itself
        const full = (h && h > vp.height) || scale !== 1;
        drawing++;
        try {
          const r = await s('Page.captureScreenshot', { format, ...(quality ? { quality } : {}), ...(full ? { clip: { x: 0, y: 0, width: vp.width, height: h || vp.height, scale }, captureBeyondViewport: true } : {}) });
          return Buffer.from(r.data, 'base64');
        } finally { drawing--; drewAt = Date.now(); }
      },
      once: (method, ms = 15000) => new Promise((res) => { const h = (m) => { if (m.sessionId === sessionId && m.method === method) { handlers.delete(h); res(m.params); } }; handlers.add(h); setTimeout(() => { handlers.delete(h); res(null); }, ms); }), // the next event of a kind, or null
      fork: async () => tab((await send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId), // another page, its own storage, same browser
      async close() {
        handlers.delete(watch);
        if (browserContextId) { try { await send('Target.disposeBrowserContext', { browserContextId }); } catch {} return; }
        try { await send('Browser.close'); } catch {}
        try { ws.close(); } catch {}
        await wait(300);
        if (proc.exitCode === null) proc.kill();
        setTimeout(() => { try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {} }, 2000); // the profile is still locked for a moment
      },
    };
    return page;
  }
  return tab();
}
