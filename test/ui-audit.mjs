// Every screen, panel, menu and dialog of Trace through one checklist, against the running app (npm start):
// node test/ui-audit.mjs [out.json] [screen filter]. Each check is a count with examples, so a fix shows as a number going to 0.
const { openBrowser } = await import('../server/cdp.js');
const fs = await import('node:fs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const B = 'http://127.0.0.1:4317/#';
const feed = await (await fetch('http://127.0.0.1:4317/api/feed')).json(); // the newest project, and the newest with code for the design canvas
const first = feed.projects.find((x) => x.latest) || feed.projects[0], coded = feed.projects.find((x) => x.code) || first;
const P = `p/${first.id}`, D = `p/${coded.id}`;
const ROUTES = [
  ['Home', '/'], ['Projects', '/projects'], ['To do', '/todo'], ['Review', '/inbox'], ['Activity', '/activity'], ['AI memory', '/memory'],
  ...['sources', 'routing', 'memory', 'mcp', 'ai', 'members', 'privacy', 'engine'].map((t) => [`Settings · ${t}`, `/settings/${t}`]),
  ['Project · timeline', `/${P}`], ['Project · history', `/${P}/history`], ['Project · frames', `/${P}/history/frames`], ['Project · canvas', `/${P}/canvas`],
  ['Project · case study', `/${P}/casestudy`], ['Project · design', `/${D}/design`], ['Project · artifacts', `/${P}/artifacts`], ['Project · references', `/${P}/references`],
  ['Project · to do', `/${P}/issues`], ['Project · tree', `/${P}/tree`], ['Project · AI memory', `/${P}/memory`], ['Project · decisions', `/${P}/decisions`],
  ['Project · proposals', `/${P}/proposals`], ['Project · files', `/${P}/files`], ['Project · decks', `/${P}/decks`],
  ...['overview', 'work', 'reviews', 'brainstorm', 'constraints', 'references', 'tasks', 'decisions', 'casestudy', 'artifacts'].map((b) => [`Block · ${b}`, `/${P}/b/${b}`]),
  ...(first.latest ? [['Moment', `/m/${first.latest.id}`]] : []), ['Onboarding', '/onboarding'],
  // overlays: [name, route, js that opens it]
  ['Search', '/', "document.querySelector('[aria-label^=\"Search\"]')"], ['Ask', '/', "[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Ask')"],
  ['+ menu', '/', "document.querySelector('.rail-btn.plus')"], ['Profile menu', '/', "document.querySelector('.rail [aria-label*=\"ccount\"], .rail .me, .rail-me, .rail button:last-of-type')"],
  ['Project ⋯ menu', `/${P}/canvas`, "document.querySelector('[aria-label=\"More of this project\"]')"],
  ['Home · expanded card', '/', "document.querySelector('[aria-label^=\"Expand \"]')"],
];
const AUDIT = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3; };
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.innerText) || e.innerText || e.getAttribute('placeholder') || (e.id && document.querySelector('label[for="' + e.id + '"]')?.innerText) || e.closest('label')?.innerText || e.value || e.textContent || '').trim(); // textContent: rows that skip rendering off-screen still have their names
  const say = (e) => (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 2).join('.')).replace(/\\s+/g, ' ').trim().slice(0, 40);
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = 'rgba(0,0,0,0)'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; }; // any CSS colour (Trace uses oklch) as rgba
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (e) => { let x = e; while (x) { const c = rgb(getComputedStyle(x).backgroundColor); if (c[3] > 0.9) return c.slice(0, 3); x = x.parentElement; } return [255, 255, 255]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const out = { unlabelled: [], tiny: [], contrast: [], target: [], cut: [], caps: [], native: [], sideways: [], overlap: [], sizes: {} };
  const ctl = [...document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=radio], [role=menuitem], input:not([type=hidden]), select, textarea')].filter(vis);
  for (const e of ctl) {
    if (!name(e)) out.unlabelled.push(e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 3).join('.'));
    const r = e.getBoundingClientRect(); const inline = e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p, li, dd');
    if (!inline && (r.width < 24 || r.height < 24) && !e.closest('.dz-frame')) out.target.push(say(e) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
    if (e.tagName === 'SELECT' || /^(date|time|datetime-local|month|week|color)$/.test(e.type || '')) out.native.push(say(e) + ' (' + (e.tagName === 'SELECT' ? 'select' : e.type) + ')');
  }
  for (let i = 0; i < ctl.length; i++) for (let k = i + 1; k < ctl.length; k++) { const a = ctl[i], b = ctl[k]; if (a.contains(b) || b.contains(a)) continue; const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top); if (w > 4 && h > 4) out.overlap.push(say(a) + ' × ' + say(b)); }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const seen = new Set();
  while (walker.nextNode()) { const t = walker.currentNode; if (!t.textContent.trim()) continue; const e = t.parentElement; if (!e || seen.has(e) || !vis(e) || e.closest('.dz-frame, svg, [aria-hidden=true], .bp, script, style, textarea')) continue; seen.add(e); const s = getComputedStyle(e); const fs = parseFloat(s.fontSize);
    out.sizes[fs] = (out.sizes[fs] || 0) + 1;
    const txt = t.textContent.trim().slice(0, 30);
    if (fs < 11) out.tiny.push(txt + ' ' + fs + 'px');
    if (s.textTransform === 'uppercase' && /[a-z]/i.test(txt)) out.caps.push(txt);
    const c = rgb(s.color); const alpha = c[3]; const bg = bgOf(e); const fg = c.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha)); const cr = ratio(fg, bg);
    if (cr < (fs >= 18.5 || (fs >= 14 && +s.fontWeight >= 700) ? 3 : 4.5) && !e.closest('[aria-disabled=true], :disabled, .disabled')) out.contrast.push(txt + ' ' + cr.toFixed(2));
    if (s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.cut.push(txt);
  }
  if (document.scrollingElement.scrollWidth > innerWidth + 1) out.sideways.push('page ' + document.scrollingElement.scrollWidth);
  for (const e of document.querySelectorAll('*')) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 2 && vis(e) && !e.closest('.dz-frame') && e.tagName !== 'TEXTAREA') out.sideways.push(say(e)); }
  return out;
})()`;
const rows = [];
const only = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
for (const [label, route, open] of ROUTES.filter(([l]) => !only || only.test(l))) { // a fresh browser per screen: one stuck page can't stall the rest
  const p = await openBrowser({ width: 1440, height: 900, scale: 1 });
  try {
    await p.go(B + '/'); await p.eval("localStorage.setItem('trace:theme', 'light')");
    await p.go(B + route); await wait(route.includes('design') || route.includes('history') ? 9000 : 3500);
    if (open) { const at = await p.eval(`(() => { const e = ${open}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!at) { rows.push({ label, missing: true }); continue; } await p.click(at.x, at.y); await wait(1200); }
    const r = await p.eval(AUDIT);
    rows.push({ label, route, ...r, sizes: Object.keys(r.sizes).length, sizeList: Object.keys(r.sizes).map(Number).sort((a, b) => a - b) });
    process.stdout.write('.');
  } catch (e) { rows.push({ label, missing: true, error: e.message }); process.stdout.write('x'); } finally { await p.close(); }
}
fs.writeFileSync(process.argv[2] || 'audit.json', JSON.stringify(rows, null, 1));
const K = ['unlabelled', 'tiny', 'contrast', 'target', 'cut', 'caps', 'native', 'sideways', 'overlap'];
console.log('\n' + ['screen'.padEnd(26), ...K.map((k) => k.slice(0, 6).padStart(7)), ' sizes'].join(''));
for (const r of rows) console.log(r.missing ? r.label.padEnd(26) + ' (could not open)' : [r.label.slice(0, 25).padEnd(26), ...K.map((k) => String(r[k].length).padStart(7)), String(r.sizes).padStart(6)].join(''));
console.log('total'.padEnd(26) + K.map((k) => String(rows.reduce((n, r) => n + (r[k]?.length || 0), 0)).padStart(7)).join(''));
