// What Trace runs inside a running app's page: what can be clicked, which state the page is in, which of the app's
// components drew it and where (read off React's own tree), the text styles in use and the design tokens in its CSS.
// No dependencies and nothing from outside the function: screens.js puts it in the headless browser's pages, and
// vite-frames.mjs puts it in a running version's page so a Preview opens on a state the walk found.
function walk() {
  if (window.__tw) return;
  // What waits to be scrolled to (a picture loaded late, a section that fades in when it's seen) watches through an
  // IntersectionObserver: each one is kept, so a whole-page picture can tell them all they're in view at once.
  const watched = new Set(), IO = window.IntersectionObserver;
  if (IO) window.IntersectionObserver = class extends IO {
    constructor(cb, opts) { super(cb, opts); this.__cb = cb; this.__t = new Set(); watched.add(this); }
    observe(t) { this.__t.add(t); return super.observe(t); }
    unobserve(t) { this.__t.delete(t); return super.unobserve(t); }
    disconnect() { this.__t.clear(); watched.delete(this); return super.disconnect(); }
  };
  const DANGER = /\b(delete|remove|reset|clear|erase|wipe|destroy|discard|sign ?out|log ?out|pay|buy|purchase|checkout|send|submit|publish|deploy|save|upload|download|print|install|uninstall|archive|revoke|unsubscribe)\b/i;
  const CLICK = 'button, [role=button], [role=tab], [role=switch], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option], [role=checkbox], [role=radio], [role=combobox], a[href], summary, [aria-haspopup]:not(input), label:has(> input[type=radio]), label:has(> input[type=checkbox])';
  const MODAL = '[aria-modal=true], dialog[open], [role=alertdialog]';
  const LAYER = '[role=dialog], [aria-modal=true], dialog[open], [role=alertdialog], [role=menu], [role=listbox], [popover]';
  const NEXT = /^(next( step)?|continue|forward|get started|start|begin|let'?s go|proceed|show me|take the tour|→|›|>|»)\b/i, BACKWARD = /^(back|previous|prev|←|‹|<|«)$/i;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const route = (u) => u.pathname + u.search + (/^#[/!]/.test(u.hash) ? u.hash : ''); // a #/route is a page; a #section is a place on the same page
  const FILE = /\.(png|jpe?g|webp|avif|gif|svg|ico|pdf|zip|mp4|webm|mov|mp3|wav|woff2?|ttf|otf|json|txt|csv)$/i; // a link to a file is an asset, not a screen
  const labelOf = (el) => clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || (el.tagName === 'LABEL' && el.querySelector('input')?.getAttribute('aria-label')) || '').slice(0, 60);
  const shown = (el) => { // drawn, and on the page: a sheet slid out of view (still mounted) is closed
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.right <= 1 || r.left >= innerWidth - 1 || r.bottom + scrollY <= 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && !el.closest('[inert], [aria-hidden=true]'); };
  const q = (v) => v.replace(/["\\]/g, '\\$&');
  const selOf = (el) => { // short when the element names itself, else its path from <body>
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll(`#${el.id}`).length === 1) return `#${el.id}`;
    for (const a of ['data-testid', 'data-test', 'aria-label', 'name']) { const v = el.getAttribute(a); if (v) { const s = `${el.tagName.toLowerCase()}[${a}="${q(v)}"]`; try { if (document.querySelectorAll(s).length === 1) return s; } catch {} } }
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 14; e = e.parentElement) { const p = e.parentElement; parts.unshift(`${e.tagName.toLowerCase()}:nth-of-type(${p ? [...p.children].filter((c) => c.tagName === e.tagName).indexOf(e) + 1 : 1})`); }
    return `body > ${parts.join(' > ')}`;
  };
  const roleOf = (el) => el.getAttribute('role') || (el.tagName === 'A' ? 'link' : el.tagName === 'SUMMARY' ? 'disclosure' : el.tagName === 'LABEL' ? el.querySelector('input')?.type || 'radio' : 'button');
  const onTop = (el) => { // nothing covers its middle (a sheet over the page, an overlay); below the fold counts as clear
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;
    const hit = document.elementFromPoint(x, y);
    return !hit || el.contains(hit) || hit.contains(el) || hit.closest('label') === el;
  };
  const covered = (x, y, els) => { // the point (in the window) lands on something that isn't these or around them
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && !els.some((el) => el.contains(hit) || hit.contains(el));
  };
  const sigOf = (el) => { const bits = []; for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) bits.push(`${e.tagName}.${[...e.classList].sort().slice(0, 4).join('.')}`); return bits.join('<'); };
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  // What a row of options is called: its group's own label, else a heading right above it ("Templates"), else the
  // options themselves ("Me in wild · Chill · Music"), never a heading from further up the page.
  const setNameOf = (el, sibs) => {
    const box = el.closest('[role=tablist], [role=radiogroup], [role=group], [role=toolbar], [role=menubar], nav, fieldset');
    const own = box && clean(box.getAttribute('aria-label') || (box.getAttribute('aria-labelledby') && document.getElementById(box.getAttribute('aria-labelledby'))?.innerText) || box.querySelector(':scope > legend')?.innerText || '');
    if (own) return own.slice(0, 40);
    const y = el.getBoundingClientRect().top;
    const near = [...document.querySelectorAll('h1, h2, h3, h4, [role=heading]')].filter((h) => shown(h) && h.getBoundingClientRect().bottom <= y + 4 && y - h.getBoundingClientRect().bottom < 120).pop();
    if (near) return clean(near.innerText).replace(/\s+\d+$/, '').slice(0, 40);
    return sibs.map((e) => labelOf(e).replace(/\s+\d+$/, '')).filter(Boolean).slice(0, 3).join(' · ').slice(0, 60);
  };
  // A React click handler on something that isn't a button (a card, a chip drawn as a div): clickable too.
  const handler = (el) => { const k = Object.keys(el).find((x) => x.startsWith('__reactProps$')); const p = k && el[k]; return !!p && !!(p.onClick || p.onPointerDown || p.onMouseDown); };

  // The layers open over the page, last on top: dialogs, sheets (modal or not), menus, popovers, and any fixed panel
  // a portal put over the page. Each with a name, its kind, and its stage (its heading and a "2 of 6" counter), so
  // a dialog that steps through stages is a screen per stage.
  function layers() {
    const vw = innerWidth, vh = innerHeight;
    const found = new Set([...document.querySelectorAll(LAYER)].filter((el) => shown(el) && (!el.matches('[popover]') || el.matches(':popover-open'))));
    for (const el of document.body.children) { // a portal's panel: fixed, over the page, a real share of the window
      if (el.contains(document.querySelector('#root, #app, #__next, [data-reactroot]')) || found.has(el)) continue;
      const box = [el, ...el.querySelectorAll(':scope > *, :scope > * > *')].find((e) => { const s = getComputedStyle(e); if (s.position !== 'fixed' && s.position !== 'absolute') return false; const r = e.getBoundingClientRect(); return shown(e) && (r.width * r.height) / (vw * vh) > 0.08; });
      if (box) found.add(box);
    }
    const top = [...found].filter((el) => ![...found].some((o) => o !== el && o.contains(el))); // the outermost of nested ones
    return top.map((el) => {
      const r = el.getBoundingClientRect(), role = el.getAttribute('role') || '';
      const kind = /menu|listbox/.test(role) ? 'Menu' : el.matches('[popover]') ? 'Popover' : el.matches(MODAL) && el.getAttribute('aria-modal') !== 'false' ? 'Modal'
        : (r.right >= vw - 2 || r.left <= 2 || r.bottom >= vh - 2) && r.width < vw * 0.9 ? 'Sheet' : 'Dialog';
      const named = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText) || el.querySelector('h1, h2, [class*=title i]')?.innerText || el.querySelector('h3')?.innerText;
      const heads = [...el.querySelectorAll('h1, h2, h3, h4, [role=heading]')].filter(shown).map((h) => clean(h.innerText)).filter(Boolean);
      const own = [...el.querySelectorAll('span, p, div, small, li, output')].find((e) => !e.children.length && /^\s*(?:step\s*)?\d{1,2}\s*(?:of|\/)\s*\d{1,2}\s*$/i.test(e.textContent)); // the counter itself ("3 of 5"), not a figure in the copy
      const count = clean(own?.textContent || (clean(el.innerText).match(/\bstep\s*\d{1,2}\s*(?:of|\/)\s*\d{1,2}\b|\bstep\s*\d{1,2}\b/i) || [''])[0]);
      const picked = [...el.querySelectorAll('[aria-current=step], [aria-current=true], [role=tab][aria-selected=true]')].filter(shown).map(labelOf);
      return { el, kind, name: clean(named || (kind === 'Menu' ? 'Menu' : kind)).slice(0, 40), stage: clean([heads.filter((h) => h !== clean(named)).slice(0, 2).join(' / '), count, picked.join(' ')].filter(Boolean).join(' · ')).slice(0, 90), heads, count };
    }).filter((l) => onTop(l.el) || l.kind === 'Menu');
  }
  const topLayer = () => layers().pop() || null;

  // What a person could click here: visible, enabled, on this site, nothing that deletes, pays or sends. With a layer
  // open (a modal, a sheet, a menu, an intro), only what's in it: a person deals with it first. Its Next (and the
  // like) is marked, so the walk steps through every stage; Back is left out (it only leads to stages already seen).
  // A long list of look-alike rows counts once (one opened row shows them all).
  function clickables() {
    const modal = topLayer()?.el;
    const scope = modal || document, base = [...scope.querySelectorAll(CLICK)];
    const extra = [...scope.querySelectorAll('div, li, span, img, article, section, [tabindex="0"], [onclick]')].filter((el) => (el.hasAttribute('onclick') || el.getAttribute('tabindex') === '0' || handler(el)) && !el.closest(CLICK) && !el.querySelector(CLICK) && !(el.parentElement && handler(el.parentElement)) && (() => { const r = el.getBoundingClientRect(); return r.width * r.height < innerWidth * innerHeight * 0.4; })()); // a dialog's backdrop isn't a thing to click
    const els = [...base, ...extra.slice(0, 40)].filter((el) => {
      if (modal && BACKWARD.test(labelOf(el))) return false;
      if (!shown(el) || el.disabled || el.getAttribute('aria-disabled') === 'true' || !onTop(el)) return false;
      if (el.tagName === 'A') { const u = new URL(el.href, location.href); if (u.origin !== location.origin || el.target === '_blank' || el.hasAttribute('download') || FILE.test(u.pathname) || route(u) === route(location)) return false; } // another site, a file, or a jump to a section of this same page
      return !DANGER.test(labelOf(el)) && !el.closest('[contenteditable=true]');
    });
    const n = new Map(), out = [];
    for (const el of els) { const s = sigOf(el); n.set(s, (n.get(s) || 0) + 1); }
    const kept = new Map();
    for (const el of els) {
      const s = sigOf(el), role = roleOf(el);
      const many = n.get(s) >= 4 && !/tab|radio|menuitem|option/.test(role) && !el.getAttribute('aria-label');
      if (many) { if (kept.get(s)) continue; kept.set(s, 1); }
      const r = el.getBoundingClientRect(), label = labelOf(el) || role;
      const set = !many && n.get(s) >= 2 && el.tagName !== 'A' && !el.closest('nav, [role=navigation], aside, header') ? { set: hash(s), setN: n.get(s), setName: setNameOf(el, els.filter((e) => sigOf(e) === s)) } : {}; // one of a row of options (filters, chips, tabs): its screens are clubbed together. A nav's buttons open pages
      out.push({ sel: selOf(el), label, role, ...(many ? { rep: 1 } : {}), ...set, ...(el.tagName === 'A' ? { to: route(new URL(el.href, location.href)) } : {}), x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height), ...(modal && (NEXT.test(label) || /\bnext\b/i.test(el.getAttribute('aria-label') || '')) ? { advance: 1 } : {}) });
      if (out.length >= 48) break;
    }
    return out.sort((a, b) => (b.advance || 0) - (a.advance || 0)); // the way forward first
  }
  // The element a recorded step meant: its selector when it still says the same thing, else the one with its label.
  const same = (a, b) => String(a).replace(/\d+/g, '#') === String(b).replace(/\d+/g, '#'); // a row's "0s ago" is "2s ago" a moment later
  function element(step) {
    let el = null; try { el = document.querySelector(step.sel); } catch {}
    if (el && shown(el) && (!step.label || step.rep || same(labelOf(el), step.label) || step.label === roleOf(el))) return el; // one row standing for a list: whichever row is there now
    return [...document.querySelectorAll(CLICK)].find((e) => shown(e) && same(labelOf(e), step.label)) || null;
  }
  // Whether the option a step clicks is the one picked: a tab, an option, a radio, one of a row of options (a chip), by
  // its own mark (aria-selected, data-state=active, a radio's checked). null: not an option, or one with no mark to read.
  function picked(step) {
    const el = element(step);
    if (!el || !(step.set || /^(tab|option|radio|menuitemradio)$/.test(step.role))) return null;
    const input = el.matches('input') ? el : el.tagName === 'LABEL' ? el.querySelector('input') : null;
    if (input) return input.checked;
    for (const a of ['aria-selected', 'aria-checked', 'aria-pressed', 'aria-current']) { const v = el.getAttribute(a); if (v !== null) return v !== 'false'; }
    const st = el.getAttribute('data-state') || '';
    return /^(active|on|checked)$/.test(st) ? true : /^(inactive|off|unchecked)$/.test(st) ? false : null;
  }
  async function find(step) { // in view and still: a smooth scroller (Lenis) glides it there, so its place is read once it stops moving
    const el = element(step); if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    for (let i = 0, last = ''; i < 24; i++) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      const b = el.getBoundingClientRect(), at = `${Math.round(b.top)},${Math.round(b.left)}`;
      if (at === last) break;
      last = at;
    }
    if (!onTop(el)) return null;
    const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), on: picked(step) }; // `on`: picked before the click
  }
  async function calm(max = 1800) { // the state once it stops changing (a sheet's way in or out, data landing)
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // A page drawn on the server (Next.js) shows its buttons before React has taken them over, and a click then does
    // nothing; with many pages loading at once that can take seconds. Wait for React to own them.
    const ssr = !!(window.__NEXT_DATA__ || window.__next_f || document.querySelector('script[src*="/_next/"]'));
    const wired = () => { const el = document.querySelector('button, a[href], [role=button], input') || document.body.firstElementChild; return !el || Object.keys(el).some((k) => k.startsWith('__reactFiber$')); };
    for (let t = 0; ssr && !wired() && t < 10000; t += 100) await wait(100);
    let last = JSON.stringify(state().fp);
    for (let t = 200; t <= max; t += 200) { await wait(200); const now = JSON.stringify(state().fp); if (now === last && t >= 400) break; last = now; }
    const moving = document.getAnimations?.().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming?.().endTime)) || []; // and once what's sliding in has landed
    await Promise.race([Promise.all(moving.map((a) => a.finished.catch(() => {}))), wait(1500)]);
    return state();
  }
  function drawn() { // the app has drawn itself: not a blank root, a dev server's error overlay, or the page it reloads after preparing its packages
    const root = document.querySelector('#root, #app, #__next, [data-reactroot]') || document.body;
    return !document.querySelector('vite-error-overlay') && root.getBoundingClientRect().height > 40 && (clean(root.innerText).length > 20 || !!root.querySelector('img, svg, canvas, video'));
  }
  async function arrive(to, max = 8000) { // a link's page, once the app has gone there (a dev server compiles a route the first time it's asked for)
    const t0 = Date.now();
    while (route(location) !== to && Date.now() - t0 < max) await new Promise((r) => setTimeout(r, 100));
    return calm();
  }
  function tap(el) { // what a pointer sends, for the libraries that act on press (Radix tabs) and the ones that wait for click
    const r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o)); el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o)); el.dispatchEvent(new MouseEvent('click', o));
  }
  async function replay(steps) { // a Preview opening on a state: the app first, then each click, given time to land
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 60 && !document.querySelector('body *:not(script)'); i++) await wait(100);
    await wait(700);
    let all = true;
    for (const s of steps) {
      let el = null; for (let i = 0; i < 20 && !(el = element(s)); i++) await wait(150); if (!el) { all = false; continue; } // gone (an intro this browser already saw): the next one may still be there
      const was = picked(s); tap(el); await calm();
      if (was === false && picked(s) === false) { await calm(); const again = picked(s) === false && element(s); if (again) { tap(again); await calm(); } if (picked(s) === false) all = false; } // a tab that didn't take (the page wasn't listening yet): once more
    }
    return all;
  }

  // Which state the page is in: where it is, its theme, what's open, which tabs are picked. Equal = the same screen.
  function state() {
    const de = document.documentElement, u = new URL(location.href);
    u.searchParams.delete('__trace_steps');
    const dialogs = [...document.querySelectorAll(`${MODAL}, [role=dialog]`)].filter(shown).map((d) => clean(d.getAttribute('aria-label') || (d.getAttribute('aria-labelledby') && document.getElementById(d.getAttribute('aria-labelledby'))?.innerText) || d.querySelector('h1, h2, h3, [class*=title]')?.innerText || 'Dialog').slice(0, 40));
    const menus = [...document.querySelectorAll('[role=menu], [role=listbox]')].filter(shown).map((m) => clean(m.getAttribute('aria-label') || '') || 'menu');
    const top = topLayer();
    const fp = {
      path: route(u),
      theme: [[...de.classList].filter((c) => /dark|light|theme/i.test(c)).join(' '), de.getAttribute('data-theme') || '', document.body.getAttribute('data-theme') || '', de.style.colorScheme || ''].join('|'),
      dialogs, menus,
      layer: top ? { kind: top.kind, name: top.name, stage: top.stage, count: top.count } : null, // a dialog's next stage is another screen
      layers: layers().length,
      tabs: [...document.querySelectorAll('[role=tab][aria-selected=true], [role=tab][data-selected], [role=tab][data-active]')].filter(shown).map(labelOf),
      open: [...document.querySelectorAll('[aria-expanded=true]')].filter(shown).length,
      on: [...new Set([...document.querySelectorAll('[aria-pressed=true], [aria-current]:not([aria-current=false]), [data-state=on], [data-active=true], [data-selected=true], [aria-checked=true]:not(input)')].filter(shown).map((e) => labelOf(e).replace(/\d+/g, '#').slice(0, 30)).filter(Boolean))].sort().slice(0, 8), // the chip, filter or nav item picked: another view of the page
      h1: clean(document.querySelector('h1')?.innerText).slice(0, 60),
    };
    return { fp, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), title: document.title };
  }

  // The app's own components on the page, outermost first, each with where it drew and what it was given. Read from
  // React's fibers (development builds keep the names); `names` are the components the code defines, so library
  // internals stay out. Portals (sheets, menus) belong to the component that opened them.
  function tree(names) {
    const want = new Set(names || []);
    const host = [document, document.documentElement, document.body, ...document.querySelectorAll('body *')].find((e) => e && (e._reactRootContainer || Object.keys(e).some((k) => k.startsWith('__reactContainer$')))); // Next.js hands React the whole document
    if (!host) return [];
    const first = host._reactRootContainer?._internalRoot?.current || host[Object.keys(host).find((k) => k.startsWith('__reactContainer$'))];
    const rootFiber = first?.stateNode?.current || first; // the tree as committed now, not the one it started with
    if (!rootFiber) return [];
    const nameOf = (f) => { if (![0, 1, 11, 14, 15].includes(f.tag)) return null; let t = f.type; if (!t) return null; if (t.displayName) return t.displayName; if (t.render) t = t.render; if (t.type) t = t.type.render || t.type; return t.displayName || t.name || null; };
    const rectOf = (f) => { // the union of the DOM nodes it drew, and whether something else sits over its middle (a sheet)
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
      const els = [];
      const visit = (c) => { for (; c && n < 60; c = c.sibling) { if (c.tag === 5 && c.stateNode?.getBoundingClientRect) { n++; const el = c.stateNode; const r = el.getBoundingClientRect(); if (r.width * r.height > 1 && getComputedStyle(el).display !== 'none') { els.push(el); x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom); } } else visit(c.child); } };
      visit(f.child);
      if (!(x2 > x1 && y2 > y1)) return null;
      return { r: [Math.round(x1 + scrollX), Math.round(y1 + scrollY), Math.round(x2 - x1), Math.round(y2 - y1)], covered: covered((x1 + x2) / 2, (y1 + y2) / 2, els) };
    };
    const firstEl = (f) => { for (let c = f.child; c; c = c.child) if (c.tag === 5) return c.stateNode; return null; };
    const propsOf = (p) => { const o = {}; let n = 0; for (const [k, v] of Object.entries(p || {})) { if (n >= 6 || /^(children|className|style|key|ref|on[A-Z]\w*|render|as|asChild|id|data-.*|aria-.*)$/.test(k)) continue; if (typeof v === 'string' && v.length <= 28) o[k] = v; else if (typeof v === 'number' || typeof v === 'boolean') o[k] = v; else continue; n++; } return o; };
    const out = [], many = new Map();
    const go = (f, parent, depth) => {
      for (; f && out.length < 320; f = f.sibling) {
        const name = nameOf(f);
        let me = parent;
        if (name && (want.size ? want.has(name) : /^[A-Z]/.test(name)) && !(out[parent]?.n === name && f.return && nameOf(f.return) === name)) {
          const k = `${parent}|${name}`; // a long list shows its first rows; the rest are the same parts again
          many.set(k, (many.get(k) || 0) + 1);
          if (many.get(k) > 6) continue;
          const at = rectOf(f);
          if (at) { const el = firstEl(f); out.push({ n: name, p: parent, d: depth, r: at.r, t: clean(el?.innerText || '').slice(0, 48), props: propsOf(f.memoizedProps), ...(at.covered ? { c: 1 } : {}) }); me = out.length - 1; }
        }
        go(f.child, me, me === parent ? depth : depth + 1);
      }
    };
    go(rootFiber.child || rootFiber, -1, 0);
    return out;
  }

  // The text styles in use: family, size, weight, line height and tracking, each with how often and an example.
  function text() {
    const m = new Map();
    for (const el of document.querySelectorAll('body *')) {
      if (!el.childNodes.length || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      if (!shown(el) || el.closest('svg')) continue; // a chart's label isn't type
      const s = getComputedStyle(el), k = [s.fontFamily.split(',')[0].replace(/["']/g, ''), s.fontSize, s.fontWeight, s.lineHeight, s.letterSpacing, s.textTransform].join('|');
      const r = el.getBoundingClientRect(), hidden = covered(r.left + r.width / 2, r.top + r.height / 2, [el]);
      if (m.has(k) && m.get(k).hidden && !hidden) Object.assign(m.get(k), { hidden, tag: el.tagName.toLowerCase(), sample: clean(el.innerText).slice(0, 48), r: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)] }); // its example: one a person can see
      if (!m.has(k)) m.set(k, { hidden, family: s.fontFamily.split(',')[0].replace(/["']/g, ''), size: s.fontSize, weight: s.fontWeight, lh: s.lineHeight, ls: s.letterSpacing, tt: s.textTransform, color: s.color, tag: el.tagName.toLowerCase(), sample: clean(el.innerText).slice(0, 48), r: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)], count: 0 });
      m.get(k).count++;
    }
    return [...m.values()].sort((a, b) => parseFloat(b.size) - parseFloat(a.size) || b.count - a.count).slice(0, 30).map(({ hidden, ...t }) => t);
  }

  // The design tokens: custom properties set on the root (and for its dark theme), resolved, sorted into kinds.
  // The values the page draws with and where: colours (text, fill, border), corner radii and spacing (padding, gap), each
  // with how often it's used and up to three places (the component drawing it, its box, a little of its text).
  const ownerOf = (el, own) => { for (let x = el; x; x = x.parentElement) { const k = Object.keys(x).find((q) => q.startsWith('__reactFiber$')); if (!k) continue; let first = null; for (let f = x[k]; f; f = f.return) { const t = f.type, n = typeof t === 'function' ? t.displayName || t.name : t?.render ? t.displayName || t.render.name : null; if (n && own.has(n)) return n; if (n && /^[A-Z]/.test(n)) first ||= n; } return first; } return null; }; // the app's own component, else the nearest library one
  const clear = (c) => !c || c === 'transparent' || /,\s*0\)$|\/\s*0\)$/.test(c);
  const lineOf = (q) => ['Top', 'Right', 'Bottom', 'Left'].find((k) => parseFloat(q[`border${k}Width`]) > 0 && q[`border${k}Style`] !== 'none' && !clear(q[`border${k}Color`])); // the first side with a line (a header's is at its bottom)
  // Every block of words on the page as it's drawn, for matching against a design: its words (as a paragraph, the way a
  // design tool holds them, not word by word), box, font, size, weight, line height, letter spacing and colour, the box
  // around it (the nearest element with a fill, a border or round corners: its fill, radius, padding and line), what
  // it sits on (the nearest fill behind it, the page's too), and the app's component that draws it. At most 600.
  function els(names) {
    const own = new Set(names || []), out = [], seen = new Set();
    const px = (r) => [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
    for (const el of document.querySelectorAll('body *')) {
      if (out.length >= 600) break;
      if (!shown(el) || el.closest('svg, script, style') || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      let b = el; while (b.parentElement && b.parentElement !== document.body && getComputedStyle(b).display === 'inline') b = b.parentElement; // the block that holds this run of words
      if (seen.has(b)) continue;
      seen.add(b);
      const t = clean(b.innerText || '');
      if (!t || t.length > 400) continue;
      const s = getComputedStyle(b);
      let box = null, bg = null;
      for (let x = b; x && !(box && bg); x = x.parentElement) {
        const q = getComputedStyle(x), side = lineOf(q), fill = clear(q.backgroundColor) ? null : q.backgroundColor;
        if (!bg && fill) bg = { c: fill, r: px(x.getBoundingClientRect()) };
        if (!box && x !== document.body && x !== document.documentElement && (fill || side || parseFloat(q.borderTopLeftRadius) > 0)) box = { r: px(x.getBoundingClientRect()), fill, radius: parseFloat(q.borderTopLeftRadius) || 0, pad: [q.paddingTop, q.paddingRight, q.paddingBottom, q.paddingLeft].map((v) => Math.round(parseFloat(v) || 0)), border: side ? q[`border${side}Color`] : null };
      }
      out.push({ t: t.slice(0, 160), r: px(b.getBoundingClientRect()), font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: parseFloat(s.fontSize), weight: +s.fontWeight || 400, lh: parseFloat(s.lineHeight) || null, ls: s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing) || 0, tt: s.textTransform, color: s.color, c: ownerOf(b, own), box, bg });
    }
    return out;
  }
  function values(names) {
    const own = new Set(names || []), m = new Map();
    const comp = (el) => ownerOf(el, own);
    const add = (prop, v, el) => {
      const k = `${prop}|${v}`; let e = m.get(k);
      if (!e) m.set(k, (e = { prop, v, n: 0, at: [] }));
      e.n++;
      if (e.at.length < 3) { const r = el.getBoundingClientRect(); e.at.push({ c: comp(el), r: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)], t: clean(el.innerText || '').slice(0, 32) }); }
    };
    let n = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (n > 4000) break;
      if (!shown(el) || el.closest('svg')) continue;
      n++;
      const s = getComputedStyle(el);
      if ([...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) add('color', s.color, el);
      if (!clear(s.backgroundColor)) add('background', s.backgroundColor, el);
      const side = lineOf(s); if (side) add('border', s[`border${side}Color`], el);
      const rad = s.borderTopLeftRadius; if (rad && rad !== '0px' && !rad.includes('%') && parseFloat(rad) < 999) add('radius', rad, el);
      for (const p of ['paddingTop', 'paddingLeft', 'columnGap']) { const v = s[p]; if (parseFloat(v) > 0) add('space', v, el); }
    }
    return [...m.values()];
  }
  function tokens() {
    const de = document.documentElement, found = new Map();
    const ROOT = /^(:root|html|:host|body)\b|^:root\s*,|^html\s*,/, DARK = /\.dark\b|\[data-theme=["']?dark|\.theme-dark|\[data-mode=["']?dark|\[class~=["']?dark/;
    let darkSel = null;
    const visit = (rules, media) => {
      for (const r of rules) {
        if (r.cssRules && !r.selectorText) { visit(r.cssRules, r.media?.mediaText || media); continue; }
        if (!r.style || !r.selectorText) continue;
        const dark = DARK.test(r.selectorText) || /prefers-color-scheme:\s*dark/.test(media || '');
        if (!dark && !ROOT.test(r.selectorText.trim())) continue;
        if (dark && !darkSel) darkSel = r.selectorText;
        for (let i = 0; i < r.style.length; i++) { const k = r.style[i]; if (!k.startsWith('--') || k.startsWith('--tw-')) continue; if (!found.has(k)) found.set(k, { name: k, raw: r.style.getPropertyValue(k).trim() }); }
      }
    };
    for (const sh of document.styleSheets) { try { visit(sh.cssRules); } catch {} }
    const probe = document.createElement('i'); document.body.appendChild(probe);
    const color = (v) => { if (!v || /^-?[\d.]+(px|rem|em|%|ms|s)?$/.test(v)) return null; for (const c of [v, `hsl(${v})`]) if (CSS.supports('color', c)) { probe.style.color = ''; probe.style.color = c; return getComputedStyle(probe).color; } return null; };
    const read = () => { const s = getComputedStyle(de); return Object.fromEntries([...found.keys()].map((k) => [k, s.getPropertyValue(k).trim()])); };
    const was = { cls: de.className, theme: de.getAttribute('data-theme') };
    const setDark = (on) => { // the way the stylesheet switches: a class or a data-theme
      if (darkSel?.includes('data-theme')) on ? de.setAttribute('data-theme', 'dark') : de.setAttribute('data-theme', 'light');
      else { de.classList.toggle('dark', on); de.classList.toggle('light', !on); }
    };
    setDark(false); const light = read();
    let dark = null; if (darkSel) { setDark(true); dark = read(); }
    de.className = was.cls; was.theme === null ? de.removeAttribute('data-theme') : de.setAttribute('data-theme', was.theme);
    const kindOf = (n, v) => {
      if (/shadow|elevation/.test(n) || /\d+px\s+[\d-]+px[^,]*(rgb|hsl|oklch|#|transparent)/.test(v)) return 'shadow';
      if (/radius|rounded/.test(n)) return 'radius';
      if (/duration|ease|easing|motion|transition|animation|spring|delay/.test(n) || /^-?[\d.]+m?s$|cubic-bezier|^linear\(/.test(v)) return 'motion';
      if (/font-?family|^--font-(sans|serif|mono|heading|body|display)$|--family/.test(n)) return 'font';
      if (/font-?size|text-|leading|line-height|tracking|letter|font-?weight/.test(n)) return 'type';
      if (color(v)) return 'color';
      if (/space|spacing|gap|gutter|pad|inset|margin|size|width|height|^--\d/.test(n) && /^-?[\d.]+(px|rem|em)$/.test(v)) return 'space';
      return 'other';
    };
    const out = [];
    for (const k of found.keys()) {
      const v = light[k] || found.get(k).raw, kind = kindOf(k, v);
      out.push({ name: k, kind, value: v, ...(kind === 'color' ? { light: color(v), dark: dark && dark[k] && dark[k] !== v ? color(dark[k]) : null } : dark && dark[k] && dark[k] !== v ? { dark: dark[k] } : {}) });
      if (out.length >= 500) break;
    }
    probe.remove();
    return { tokens: out, dark: !!darkSel };
  }

  // The whole page drawn as a person scrolling it would see it: everything that waits to be scrolled to is told it's in
  // view (sections that fade or slide in, pictures that load late), lazy pictures load now, and then it waits for the
  // pictures to arrive and the motion to land. Nothing scrolls, so nothing scrolled away hides itself again.
  async function whole() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const o of watched) {
      const entries = [...o.__t].filter((t) => t.isConnected).map((target) => { const r = target.getBoundingClientRect(); return { target, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r, intersectionRect: r, rootBounds: null, time: performance.now() }; });
      if (entries.length) try { o.__cb(entries, o); } catch {}
    }
    document.querySelectorAll('img[loading=lazy], iframe[loading=lazy]').forEach((el) => { el.loading = 'eager'; });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const late = [...document.images].filter((i) => i.src && !i.complete);
    await Promise.race([Promise.all(late.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))), wait(2500)]);
    const moving = document.getAnimations?.().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming?.().endTime)) || [];
    await Promise.race([Promise.all(moving.map((a) => a.finished.catch(() => {}))), wait(1500)]);
    return length();
  }
  // How long the page is: the document, and the hidden rest of the scroller an app shell keeps its content in (a header
  // and a sidebar that stay, the main column scrolling inside a window-high frame).
  function length() {
    const doc = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    let best = null, area = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (el.scrollHeight - el.clientHeight < 40 || el.clientHeight < innerHeight * 0.35 || el.clientWidth < innerWidth * 0.3) continue;
      if (!/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) || !shown(el) || el.closest(LAYER)) continue;
      if (el.clientWidth * el.clientHeight > area) { best = el; area = el.clientWidth * el.clientHeight; }
    }
    return { doc, inner: best ? best.scrollHeight - best.clientHeight : 0 };
  }

  // What it's built for, read off how it lays out in a desktop-wide window: rows across the window, and where something
  // narrower than the window is drawn (a band across the whole width is the page, not the app). An app drawn in a
  // phone-wide column with the sides empty is a phone app; a column up to tablet width with a tab bar along the bottom
  // is a tablet app; anything spread across the window is desktop.
  function form() {
    const vw = innerWidth, vh = innerHeight, xs = [];
    const page = (el) => !el || el === document.documentElement || el === document.body || el.getBoundingClientRect().width >= vw * 0.9;
    for (let y = 6; y < vh; y += Math.round(vh / 24)) for (let x = 2; x < vw; x += 8) if (!page(document.elementFromPoint(x, y))) xs.push(x);
    xs.sort((a, b) => a - b);
    const at = (f) => xs[Math.min(xs.length - 1, Math.floor(xs.length * f))] ?? 0;
    const span = xs.length ? at(0.97) - at(0.03) + 8 : vw; // a chat bubble in a corner doesn't widen it
    const bar = [...document.querySelectorAll('body *')].some((el) => { const s = getComputedStyle(el); if (s.position !== 'fixed' && s.position !== 'sticky') return false; const r = el.getBoundingClientRect(); return r.bottom >= vh - 4 && r.height >= 40 && r.height <= 130 && el.querySelectorAll(CLICK).length >= 3; });
    return { span: Math.round(span), bar, at: vw };
  }

  // The page's sections, top to bottom: the blocks a person scrolls through (a hero, "What's on your mind?", the footer),
  // each named by its own label or heading, where it sits on the page. A wrapper holding one big block is gone through;
  // one holding several, taller than two windows, is opened into them. Bars fixed to the window aren't sections. `vh`:
  // the device's window height (the walk stretches the window to the page's length while it pictures it).
  function sections(vh = innerHeight) {
    const min = Math.max(96, vh * 0.12);
    const block = (el) => shown(el) && !el.closest(LAYER) && !/fixed|sticky/.test(getComputedStyle(el).position) && el.getBoundingClientRect().height >= min;
    const kids = (el) => { // the blocks stacked down the page: a centred column's count, a sidebar beside a wider block doesn't
      const cs = [...el.children].filter((k) => block(k) && k.getBoundingClientRect().width >= 240), box = (k) => k.getBoundingClientRect();
      return cs.filter((k) => { const a = box(k); return !cs.some((o) => { if (o === k) return false; const b = box(o); return b.width > a.width && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) * 0.5; }); });
    };
    let box = document.body;
    const inner = (el) => { let x = el; for (let i = 0; i < 10; i++) { const k = kids(x); if (k.length !== 1) return k; x = k[0]; } return []; }; // through wrappers that hold one block
    let parts = inner(document.body);
    for (let pass = 0; pass < 3; pass++) parts = parts.flatMap((el) => { const k = inner(el); return k.length >= 2 && el.getBoundingClientRect().height > vh * 2 && !/^(HEADER|FOOTER|NAV)$/.test(el.tagName) ? k : [el]; });
    const LAND = { HEADER: 'Header', FOOTER: 'Footer', NAV: 'Navigation', ASIDE: 'Sidebar', FORM: 'Form' };
    const heads = (el) => [...el.querySelectorAll('h1, h2, h3, h4, [role=heading]')].filter(shown);
    const top = (el) => { const y = el.getBoundingClientRect().top; return heads(el).find((h) => h.getBoundingClientRect().top - y < 140)?.innerText; }; // its own title, at its top, not the first card's in it
    const named = (el, i) => clean(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText) || top(el) || LAND[el.tagName] || (el.id && el.id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())) || heads(el)[0]?.innerText || String(el.innerText || '').split('\n').map(clean).find((s) => s.length > 1) || (el.querySelector('img, video, canvas, picture') ? 'Picture' : `Section ${i + 1}`)).slice(0, 48);
    const out = parts.map((el, i) => { const r = el.getBoundingClientRect(); return { name: named(el, i), y: Math.round(r.top + scrollY), h: Math.round(r.height) }; }).sort((a, b) => a.y - b.y);
    return out.length >= 2 ? out.slice(0, 24) : [];
  }

  // What a person would call broken, by rule: text cut off by its own box (an ellipsis or a line clamp is meant), a page
  // wider than the window, text drawn over other text (in the window, where what's on top can be asked), text too faint
  // to read (WCAG: 4.5:1, or 3:1 from 24px, or 18.66px bold; disabled controls are exempt), a page with nothing on it.
  function rules() {
    const all = document.createElement('style'); // an overlay that lets clicks through (a gradient over a photo) is still painted: ask about it too
    all.textContent = '* { pointer-events: auto !important; }';
    document.head.appendChild(all);
    try { return check(); } finally { all.remove(); }
  }
  function check() {
    const out = [], count = {}, leaves = [];
    const at = (r) => [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
    const say = (rule, el, extra = {}) => { count[rule] = (count[rule] || 0) + 1; if (count[rule] <= 60) out.push({ rule, r: at(el.getBoundingClientRect()), t: clean(el.innerText || '').slice(0, 40), ...extra }); };
    const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3])); // a colour laid on another
    // What's painted at a point, top first, from an element down (in the window: what really lies under it, a picture or
    // a card laid over it included; elsewhere: its parents).
    const below = (el, b) => { if (b && b.top >= 0 && b.bottom <= innerHeight) { const st = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2), i = st.findIndex((e) => e === el || el.contains(e)); if (i >= 0) return st.slice(i); } const up = []; for (let x = el; x; x = x.parentElement) up.push(x); return up; };
    const solid = (e) => { const s = getComputedStyle(e); return /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(e.tagName) || s.backgroundImage !== 'none' ? 'picture' : rgba(s.backgroundColor); };
    const behind = (el, b) => { // the solid colour behind an element's text; null over a picture or a gradient
      const layers = [];
      for (const x of below(el, b)) { const c = solid(x); if (c === 'picture') return null; if (c[3] > 0) layers.push(c); if (c[3] >= 0.99) break; }
      return layers.reverse().reduce((under, c) => over(c, under), [255, 255, 255]);
    };
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const textBox = (el) => { const rg = document.createRange(), boxes = []; for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { rg.selectNodeContents(n); boxes.push(rg.getBoundingClientRect()); } return boxes; };
    if (document.scrollingElement.scrollWidth > innerWidth + 1) out.push({ rule: 'sideways', by: document.scrollingElement.scrollWidth - innerWidth });
    const faded = (el) => { for (let x = el.parentElement; x; x = x.parentElement) if (+getComputedStyle(x).opacity <= 0.05) return true; return false; }; // inside a panel faded out (still mounted)
    for (const el of document.querySelectorAll('body *')) {
      if (leaves.length > 600) break;
      if (!shown(el) || el.closest('svg') || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) || faded(el)) continue;
      leaves.push(el);
      const s = getComputedStyle(el);
      const meant = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none');
      if (!meant && ((el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(s.overflowX)) || (el.scrollHeight > el.clientHeight + 1 && /hidden|clip/.test(s.overflowY)))) say('cut', el);
      if (el.closest(':disabled, [aria-disabled="true"]')) continue;
      const bg = behind(el, textBox(el)[0]), fg = rgba(s.color);
      if (!bg || fg[3] === 0) continue;
      const a = lum(over(fg, bg)), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), size = parseFloat(s.fontSize);
      const need = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700) ? 3 : 4.5;
      if (ratio < need) say('faint', el, { ratio: +ratio.toFixed(2), need });
    }
    const near = leaves.flatMap((el) => textBox(el).filter((b) => b.bottom > 0 && b.top < innerHeight && b.height > 4).map((b) => ({ el, b }))).slice(0, 300);
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const A = near[i], B = near[j];
      if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const w = Math.min(A.b.right, B.b.right) - Math.max(A.b.left, B.b.left), h = Math.min(A.b.bottom, B.b.bottom) - Math.max(A.b.top, B.b.top);
      if (w <= 0 || h <= 0 || w * h < 0.2 * Math.min(A.b.width * A.b.height, B.b.width * B.b.height)) continue;
      // Both showing: nothing solid painted between the upper text and the lower one (a card laid over another hides it).
      const st = document.elementsFromPoint(Math.max(A.b.left, B.b.left) + w / 2, Math.max(A.b.top, B.b.top) + h / 2);
      const ia = st.findIndex((e) => e === A.el || A.el.contains(e)), ib = st.findIndex((e) => e === B.el || B.el.contains(e));
      if (ia < 0 || ib < 0) continue;
      const lower = ia < ib ? B.el : A.el;
      if (st.slice(Math.min(ia, ib) + 1, Math.max(ia, ib)).some((e) => !e.contains(lower) && (() => { const c = solid(e); return c === 'picture' || c[3] >= 0.99; })())) continue;
      say('over', A.el, { with: clean(B.el.innerText || '').slice(0, 40) });
    }
    if (!leaves.length && !document.querySelector('img, canvas, video')) out.push({ rule: 'blank' });
    return { found: out, count };
  }
  // Every text about 40% longer, with accents, the way a translation runs long (German, Finnish): what breaks shows.
  function stretch() {
    const A = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', s: 'š', y: 'ý', A: 'Å', E: 'É', O: 'Ö', U: 'Ü' };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('script, style, noscript, svg, code, pre') ? 1 : 2) });
    const all = []; for (let n; (n = w.nextNode()); ) all.push(n);
    for (const n of all) { const t = n.textContent, more = t.trim().slice(0, Math.ceil(t.trim().length * 0.4)); n.textContent = (t + (/\s$/.test(t) ? '' : ' ') + more).replace(/[aeioucnsyAEOU]/g, (c) => A[c]); }
    return all.length;
  }

  window.__tw = { clickables, find, picked, tap, replay, state, calm, arrive, drawn, whole, length, tree, text, values, els, tokens, form, sections, rules, stretch, layers: () => layers().map(({ el, ...l }) => l) };
}
export const WALK = `(${walk})();`;
