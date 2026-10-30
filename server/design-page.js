// The design canvas inside the running app (served to the page by design.js's proxy, never imported by the server).
// It outlines what the pointer is over and, on a click, picks it: what it is (its component from React's own tree, its
// classes, its text) and how it's drawn (the computed styles a designer edits). Trace's canvas sends back property
// changes, drawn at once as inline styles; the code changes later, from the edits. It talks only to Trace's own origin.
(() => {
  if (window.__traceDesign) return;
  window.__traceDesign = true;
  const TRACE = document.currentScript?.dataset.trace || '';
  if (!TRACE || window.parent === window) return;
  let selecting = true, sel = null, selPath = null, names = new Set(), hov = null, on = null;
  const post = (m) => parent.postMessage({ trace: 'design', ...m }, TRACE);
  const BLUE = '#2b6cff';
  const box = (w) => {
    const d = document.createElement('div');
    d.setAttribute('data-trace-ui', '');
    d.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;border:${w}px solid ${BLUE};border-radius:2px;display:none;box-sizing:border-box`;
    const t = document.createElement('span');
    t.style.cssText = `position:absolute;left:-${w}px;font:500 11px/18px system-ui,sans-serif;padding:0 6px;background:${BLUE};color:#fff;border-radius:3px;white-space:nowrap`;
    d.append(t);
    document.documentElement.append(d);
    return d;
  };
  const fiberOf = (el) => { const k = Object.keys(el).find((q) => q.startsWith('__reactFiber$')); return k ? el[k] : null; };
  const nameOf = (t) => (typeof t === 'function' ? t.displayName || t.name : t?.render ? t.displayName || t.render.name : t?.type ? nameOf(t.type) : null);
  const compOf = (el) => { // the app's own component whose code wrote it (React's owner, in a dev build), else the one that drew it
    for (let x = el; x; x = x.parentElement) {
      const f0 = fiberOf(x);
      if (!f0) continue;
      let first = null;
      for (let o = f0._debugOwner; o; o = o._debugOwner) { const n = nameOf(o.type) || o.name; if (n && names.has(n)) return n; if (n && /^[A-Z]/.test(n)) first ||= n; } // "<p>" written in Hero, drawn inside FadeIn: Hero (a Next.js server component is an owner by name only)
      for (let f = f0.return; f; f = f.return) { const n = nameOf(f.type); if (n && names.has(n)) return n; if (n && /^[A-Z]/.test(n)) first ||= n; }
      return first;
    }
    return null;
  };
  const label = (el) => compOf(el) || el.tagName.toLowerCase();
  const chainOf = (el) => { // the components between it and the page, nearest first: its class or text may be written in any of them
    const out = [];
    for (let x = el; x && out.length < 8; x = x.parentElement) {
      const f0 = fiberOf(x);
      if (!f0) continue;
      for (let o = f0._debugOwner; o && out.length < 8; o = o._debugOwner) { const n = nameOf(o.type) || o.name; if (n && (names.size ? names.has(n) : /^[A-Z]/.test(n)) && !out.includes(n)) out.push(n); } // who wrote it first
      for (let f = f0.return; f && out.length < 8; f = f.return) { const n = nameOf(f.type); if (n && (names.size ? names.has(n) : /^[A-Z]/.test(n)) && !out.includes(n)) out.push(n); }
      break;
    }
    return out;
  };
  const place = (d, el) => {
    if (!d) return;
    if (!el || !el.isConnected) { d.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(d.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    d.firstChild.textContent = label(el);
    d.firstChild.style.top = r.top < 22 ? `${r.height + 2}px` : '-20px';
  };
  const pathOf = (el) => {
    const p = [];
    for (let x = el; x && x.parentElement && x !== document.body; x = x.parentElement) p.unshift(`${x.tagName.toLowerCase()}:nth-child(${[...x.parentElement.children].indexOf(x) + 1})`);
    return `body > ${p.join(' > ')}`;
  };
  const find = (path) => { try { return document.querySelector(path); } catch { return null; } };
  const PROPS = ['display', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'color', 'backgroundColor', 'borderRadius', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'opacity', 'boxShadow'];
  const info = (el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return { path: pathOf(el), tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className : el.getAttribute('class') || '', text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      own: [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()), comp: compOf(el), chain: chainOf(el), rect: [r.left, r.top, r.width, r.height].map(Math.round),
      style: Object.fromEntries(PROPS.map((k) => [k, s[k]])), inline: el.getAttribute('style') || '', url: location.pathname + location.search,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16, // what 1rem is here: Tailwind's scale is in rem
      editable: wordsOnly(el), content: wordsOnly(el) ? el.textContent.slice(0, 2000) : null };
  };
  const pick = (el) => { sel = el; selPath = pathOf(el); on ||= box(2); place(on, el); place(hov, null); post({ type: 'selected', el: info(el) }); };
  const ours = (el) => !!el?.closest?.('[data-trace-ui]');
  // Its words, edited where they are: only an element of words alone (no parts inside), changed in its own text node so
  // React keeps it. Double-click to start; Enter keeps it (Shift+Enter a new line), Escape puts it back.
  let editing = null;
  function wordsOnly(el) { return !!el && el.children.length === 0 && !!el.textContent.trim() && !/^(input|textarea|select|svg|script|style)$/i.test(el.tagName); }
  const setWords = (el, text) => { const t = [...el.childNodes].filter((c) => c.nodeType === 3); if (!t.length) { el.textContent = text; return; } t[0].nodeValue = text; t.slice(1).forEach((x) => x.remove()); };
  const startEdit = (el) => {
    if (!wordsOnly(el) || editing) return;
    editing = { el, before: el.textContent };
    el.setAttribute('contenteditable', 'plaintext-only');
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r);
    on ||= box(2); on.style.borderStyle = 'dashed'; pick(el);
  };
  const stopEdit = (keep) => {
    if (!editing) return;
    const { el, before } = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    if (on) on.style.borderStyle = 'solid';
    const to = el.textContent;
    if (!keep) setWords(el, before); else { setWords(el, to); if (to !== before) post({ type: 'text', path: pathOf(el), from: before, to, el: info(el) }); }
    getSelection()?.removeAllRanges();
    pick(el);
  };
  addEventListener('keydown', (e) => {
    if (!editing) { // ⌘Z / Ctrl+Z here is the canvas's undo, not the app's
      const k = e.key.toLowerCase();
      if (selecting && (e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y') && !e.target.closest?.('input, textarea, [contenteditable]')) { e.preventDefault(); post({ type: 'key', redo: k === 'y' || e.shiftKey }); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopEdit(true); } else if (e.key === 'Escape') { e.preventDefault(); stopEdit(false); }
  }, true);
  addEventListener('focusout', (e) => { if (editing && e.target === editing.el) stopEdit(true); }, true);
  addEventListener('pointermove', (e) => { if (!selecting || ours(e.target)) return; hov ||= box(1); place(hov, e.target === sel ? null : e.target); }, true);
  addEventListener('pointerleave', () => place(hov, null), true);
  for (const t of ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'contextmenu']) addEventListener(t, (e) => {
    if (!selecting || ours(e.target) || (editing && editing.el.contains(e.target))) return; // typing in the words being edited
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); // picking, not using the app
    if (t === 'click') pick(e.target);
    else if (t === 'dblclick') startEdit(e.target);
  }, true);
  const follow = () => { place(on, sel); place(hov, null); };
  addEventListener('scroll', follow, true);
  addEventListener('resize', follow);
  setInterval(() => { // the app redrew (hot reload, state): find the picked element again by where it was
    if (sel && !sel.isConnected && selPath) { const el = find(selPath); if (el) { sel = el; post({ type: 'selected', el: info(el) }); } }
    place(on, sel);
  }, 400);
  addEventListener('message', (e) => {
    if (e.origin !== TRACE) return;
    const m = e.data || {};
    if (m.trace !== 'design') return;
    if (m.type === 'mode') { selecting = !!m.select; if (!selecting) place(hov, null); }
    else if (m.type === 'names') names = new Set(m.names || []);
    else if (m.type === 'set' || m.type === 'unset') {
      const el = find(m.path);
      if (!el) return;
      if (m.type === 'set') el.style.setProperty(m.prop, m.value, 'important'); else el.style.removeProperty(m.prop);
      if (el === sel || m.path === selPath) { sel = el; place(on, el); post({ type: 'selected', el: info(el) }); }
    } else if (m.type === 'select') { const el = find(m.path); if (el) { el.scrollIntoView({ block: 'nearest' }); pick(el); } }
    else if (m.type === 'parent') { const up = sel?.parentElement; if (up && up !== document.body && up !== document.documentElement) pick(up); }
    else if (m.type === 'clear') { sel = null; selPath = null; place(on, null); }
    else if (m.type === 'settext') { const el = find(m.path); if (el && wordsOnly(el) && !editing) { setWords(el, m.text); if (m.path === selPath) post({ type: 'selected', el: info(el) }); } }
    else if (m.type === 'edittext') { const el = find(m.path); if (el) startEdit(el); }
  });
  const hello = () => post({ type: 'ready', url: location.pathname + location.search, title: document.title });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', hello); else hello();
})();
