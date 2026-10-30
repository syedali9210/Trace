// Shared: API client, live events, router, formatting, and the small components every screen uses.
import { h, render, Fragment } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect };

// ---------- API ----------
export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { ...(body !== undefined && raw === undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-trace': '1' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch {}
    throw Object.assign(new Error(msg || `Error ${r.status}`), { status: r.status });
  }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r;
}
export const fileUrl = (key) => (key ? `/files/${key}` : null);

// ---------- live updates (Server-Sent Events) ----------
const listeners = new Set();
export const onLive = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function startLive() {
  const es = new EventSource('/api/events');
  for (const t of ['moment', 'comment', 'capture', 'artifact', 'reference', 'decision', 'issue', 'proposal', 'project', 'source', 'notification', 'paused', 'memory']) {
    es.addEventListener(t, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} listeners.forEach((fn) => fn(t, d)); });
  }
}

export function useFetch(path, topics = [], filter) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const load = useCallback(async (quiet) => {
    if (!path) return;
    const n = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    try { const data = await api(path); if (n === seq.current) setState({ data, error: null, loading: false }); }
    catch (error) { if (n === seq.current) setState((s) => ({ ...s, error, loading: false })); }
  }, [path]);
  useEffect(() => { setState({ data: null, error: null, loading: true }); load(); }, [load]);
  const key = topics.join();
  useEffect(() => {
    if (!topics.length) return;
    let t;
    const off = onLive((topic, d) => { if (topics.includes(topic) && (!filter || filter(topic, d))) { clearTimeout(t); t = setTimeout(() => load(true), 250); } });
    return () => { off(); clearTimeout(t); };
  }, [load, key]);
  return { ...state, reload: () => load(true), set: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}

// ---------- router (hash) ----------
export function useRoute() {
  const [r, set] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const f = () => set(location.hash.slice(1) || '/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (p) => { if (location.hash.slice(1) !== p) location.hash = p; };

// ---------- toasts ----------
export function toast(msg, { error = false, action, ms = 5000, img, sub } = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${error ? ' err' : ''}`;
  el.setAttribute('role', error ? 'alert' : 'status');
  if (img) { const i = document.createElement('img'); i.src = fileUrl(img); i.alt = ''; el.append(i); }
  const words = document.createElement('span');
  words.className = 't2';
  words.append(msg);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; words.append(s); }
  el.append(words);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); el.remove(); };
    el.append(b);
  }
  box.append(el);
  let t = setTimeout(() => el.remove(), ms);
  el.onmouseenter = () => clearTimeout(t);
  el.onmouseleave = () => { t = setTimeout(() => el.remove(), 2000); };
}
export const fail = (e) => toast(e.message || String(e), { error: true, ms: 8000 });

// ---------- format ----------
export function rel(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 2) return 'yesterday';
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export const day = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
export const stamp = (ts) => new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const initials = (n = '?') => n.split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('');

// ---------- components ----------
export const Icon = ({ n, cls = '', label }) => html`<i class=${`ph ph-${n} ${cls}`} aria-hidden=${label ? undefined : 'true'} aria-label=${label} role=${label ? 'img' : undefined}></i>`;

export const TOOLS = {
  figma: { label: 'Figma', icon: 'figma-logo' }, github: { label: 'GitHub', icon: 'github-logo' }, folder: { label: 'Folder', icon: 'folder-simple' },
  upload: { label: 'Upload', icon: 'upload-simple' }, link: { label: 'Link', icon: 'link-simple' }, agent: { label: 'AI agent', icon: 'sparkle' }, demo: { label: 'Sample file', icon: 'squares-four' },
};
export const ToolChip = ({ tool, short }) => {
  const t = TOOLS[tool] || { label: tool, icon: 'circle' };
  return html`<span class=${`chip tool k-${tool}`} title=${t.label}><${Icon} n=${t.icon} />${short ? html`<span class="sr">${t.label}</span>` : t.label}</span>`;
};
export const ToolIcon = ({ tool }) => html`<i class=${`ph ph-${TOOLS[tool]?.icon || 'circle'} tool-ico k-${tool}`} title=${TOOLS[tool]?.label || tool} aria-label=${TOOLS[tool]?.label || tool} role="img"></i>`;

export function Magnitude({ score, bucket, basis, compact }) {
  const on = { small: 1, medium: 2, large: 3 }[bucket] || 0;
  const label = bucket ? `${bucket[0].toUpperCase()}${bucket.slice(1)}` : '—';
  const why = basis ? [basis.pixels != null && `${basis.pixels}% of pixels`, basis.properties ? `${basis.properties} properties` : null, basis.nodes && (basis.nodes.added || basis.nodes.removed) ? `+${basis.nodes.added} −${basis.nodes.removed} layers` : null, basis.type].filter(Boolean).join(' · ') : '';
  return html`<span class="mag" title=${why ? `Magnitude ${score}/100: ${why}` : `Magnitude ${score}/100`}>
    <span class="bars" aria-hidden="true"><i class=${on >= 1 ? 'on' : ''}></i><i class=${on >= 2 ? 'on' : ''}></i><i class=${on >= 3 ? 'on' : ''}></i></span>
    <span>${label}${compact ? '' : html` <span class="muted num">${score}</span>`}</span></span>`;
}

export const Avatar = ({ name, agent, lg }) => html`<span class=${`avatar${agent ? ' agent' : ''}${lg ? ' lg' : ''}`} aria-hidden="true">${agent ? html`<${Icon} n="sparkle" />` : initials(name)}</span>`;

export function Thumb({ snap, alt = '', cls = '', style, big }) {
  const key = big ? snap?.image_key || snap?.thumb_key : snap?.thumb_key || snap?.image_key;
  return html`<div class=${`thumb ${cls}`} style=${style}>${key ? html`<img src=${fileUrl(key)} alt=${alt} loading="lazy" decoding="async" />` : html`<${Icon} n="image" cls="ph-light" /><span class="sr">No preview</span>`}</div>`;
}

const HEX = /^#[0-9a-f]{3,8}$/i;
export function ChangeLine({ c }) {
  const vals = (v) => String(v || '').split(', ').map((x, i) => html`${i ? ', ' : ''}${HEX.test(x.trim()) ? html`<span class="sw" style=${{ background: x.trim() }}></span>${x.trim()}` : x}`);
  const added = c.after === 'added', removed = c.after === 'removed';
  return html`<div class="diffline" title=${`${c.path}: ${c.before || '—'} → ${c.after}`}>
    <span class="path">${c.path}</span>
    <span class="vals">${added ? html`<span style="color:var(--ok)">added</span>` : removed ? html`<span style="color:var(--danger)">removed</span>` : html`${c.before ? html`<s>${vals(c.before)}</s><${Icon} n="arrow-right" />` : null}${vals(c.after)}`}</span>
  </div>`;
}

export function Empty({ icon = 'tray', title, children, actions }) {
  return html`<div class="empty"><${Icon} n=${icon} cls="big" /><h2>${title}</h2>${children && html`<p>${children}</p>`}${actions && html`<div class="row wrap" style="justify-content:center">${actions}</div>`}</div>`;
}
export const ErrorBox = ({ error, retry }) => html`<div class="errbox row between" role="alert"><span>${error.message}</span>${retry && html`<button class="btn sm" onClick=${retry}>Try again</button>`}</div>`;
export const Loading = ({ h: height = 120 }) => html`<div class="skeleton" style=${{ height: `${height}px` }} aria-busy="true" aria-label="Loading"></div>`;

export function Dialog({ title, onClose, children, footer, size = '', labelId }) {
  const ref = useRef();
  const id = useMemo(() => labelId || `dlg-${Math.random().toString(36).slice(2, 8)}`, []);
  useEffect(() => { const d = ref.current; if (!d.open) d.showModal(); return () => { if (d.open) d.close(); }; }, []);
  return html`<dialog ref=${ref} class=${size} aria-labelledby=${id} onClose=${onClose} onClick=${(e) => { if (e.target === ref.current) onClose(); }}>
    <div class="dlg-h"><h2 id=${id} class="grow">${title}</h2><button class="btn ghost icon sm" aria-label="Close" onClick=${onClose}><${Icon} n="x" /></button></div>
    <div class="dlg-b">${children}</div>
    ${footer && html`<div class="dlg-f">${footer}</div>`}
  </dialog>`;
}

// A menu button: a popover list that closes on Escape, outside clicks, or picking an item.
export function Menu({ label, icon = 'dots-three', items, btn = 'btn ghost icon', align = 'right', text }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef();
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); wrap.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc);
    setTimeout(() => wrap.current?.querySelector('.pop button, .pop a')?.focus(), 0);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  return html`<div ref=${wrap} style="position:relative;display:inline-flex">
    <button class=${btn} aria-label=${label} aria-haspopup="true" aria-expanded=${open} onClick=${() => setOpen(!open)}>${icon && html`<${Icon} n=${icon} />`}${text}</button>
    ${open && html`<div class="pop" style=${align === 'right' ? 'right:0;top:calc(100% + 4px);transform-origin:top right' : 'left:0;top:calc(100% + 4px)'}
      onKeyDown=${(e) => { if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return; e.preventDefault(); const list = [...e.currentTarget.querySelectorAll('button,a')]; const i = list.indexOf(document.activeElement); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }}>
      ${items.filter(Boolean).map((it) => it === '-' ? html`<hr />` : it.href ? html`<a href=${it.href} onClick=${() => setOpen(false)}>${it.icon && html`<${Icon} n=${it.icon} />`}${it.label}</a>`
        : html`<button class=${it.danger ? 'btn-danger' : ''} style=${it.danger ? 'color:var(--danger)' : ''} onClick=${() => { setOpen(false); it.onClick(); }}>${it.icon && html`<${Icon} n=${it.icon} />`}${it.label}${it.kbd && html`<kbd style="margin-left:auto">${it.kbd}</kbd>`}</button>`)}
    </div>`}
  </div>`;
}

// Real tablist: arrow keys move between tabs (they're links, so each tab has an address).
export function Tabs({ tabs, current, label }) {
  const onKey = (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const list = [...e.currentTarget.querySelectorAll('[role=tab]')];
    const i = list.indexOf(document.activeElement);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    list[n].focus(); list[n].click(); e.preventDefault();
  };
  return html`<div class="tabs" role="tablist" aria-label=${label} onKeyDown=${onKey}>
    ${tabs.map((t) => html`<a role="tab" href=${t.href} aria-selected=${t.id === current} tabindex=${t.id === current ? 0 : -1}>${t.label}${t.count ? html`<span class="count">${t.count}</span>` : ''}</a>`)}
  </div>`;
}

// Fluid hover (Fluid Functionalism): in a menu, a tab row or a list, one highlight glides between the items under
// the pointer, showing where a click will land. Entering a list it fades in where the pointer is, never sliding over
// from where it was last. Pointer only; touch keeps its pressed states.
const FLUID = '.pop, .tabs, .seg, .ask-quick, .ai-next, nav[aria-label="Settings sections"], .fab-bar';
export function fluidHover() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let box = null, hl = null, at = null;
  const off = () => { hl?.classList.remove('on'); at = null; };
  addEventListener('pointerover', (e) => {
    const c = e.target.closest?.(FLUID);
    if (c !== box) { off(); box = c; hl = null; }
    const it = c && e.target.closest('button, a');
    if (!it || it === at || !c.contains(it)) return;
    if (it.matches('[disabled], [aria-disabled="true"], [aria-checked="true"], .fab')) { off(); return; }
    if (!hl?.isConnected) { hl = c.querySelector(':scope > .fluid-hl'); if (!hl) { hl = document.createElement('span'); hl.className = 'fluid-hl'; hl.setAttribute('aria-hidden', 'true'); c.append(hl); } }
    const r = it.getBoundingClientRect(), b = c.getBoundingClientRect();
    hl.classList.toggle('glide', !!at && hl.classList.contains('on'));
    Object.assign(hl.style, { width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle(it).borderRadius,
      transform: `translate(${r.left - b.left - c.clientLeft + c.scrollLeft}px, ${r.top - b.top - c.clientTop + c.scrollTop}px)` });
    hl.classList.add('on'); at = it;
  });
  addEventListener('pointerout', (e) => { if (box && !box.contains(e.relatedTarget)) { off(); box = null; } });
}

export function Seg({ value, options, onChange, label }) {
  const box = useRef();
  const [thumb, setThumb] = useState(null); // where the selected pill sits; it slides there on change
  const measure = () => { const b = box.current?.querySelector('[aria-checked="true"]'); setThumb(b ? { x: b.offsetLeft, w: b.offsetWidth } : null); };
  useLayoutEffect(measure, [value, options.map((o) => o.label).join()]);
  useEffect(() => { const ro = new ResizeObserver(measure); if (box.current) ro.observe(box.current); return () => ro.disconnect(); }, []);
  return html`<div class=${`seg${thumb ? ' has-thumb' : ''}`} role="radiogroup" aria-label=${label} ref=${box}
    onKeyDown=${(e) => { if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return; const i = options.findIndex((o) => o.value === value); const n = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]; onChange(n.value); e.preventDefault(); setTimeout(() => e.currentTarget?.querySelector('[aria-checked=true]')?.focus(), 0); }}>
    ${thumb && html`<span class="seg-thumb" aria-hidden="true" style=${{ transform: `translateX(${thumb.x}px)`, width: `${thumb.w}px` }}></span>`}
    ${options.map((o) => html`<button role="radio" aria-checked=${o.value === value} tabindex=${o.value === value ? 0 : -1} onClick=${() => onChange(o.value)} title=${o.title}>${o.icon && html`<${Icon} n=${o.icon} />`}${o.label}</button>`)}
  </div>`;
}

// Single-key shortcuts, ignored while typing.
export function useKeys(map, deps = []) {
  useEffect(() => {
    const f = (e) => {
      const t = e.target;
      if (e.defaultPrevented || t.closest?.('input, textarea, select, [contenteditable=true], dialog[open]')) return;
      if ((e.key === 'Enter' || e.key === ' ') && t.closest?.('button, a, [role=slider]')) return; // let the focused control have it
      const k = `${e.shiftKey && e.key.length > 1 ? 'shift+' : ''}${e.key}`;
      const fn = map[k] || map[e.key.toLowerCase()];
      if (fn && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); fn(e); }
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, deps);
}

// Upload many files as one batch, so they land as one moment.
export async function uploadFiles(files, { project_id, exploration_id } = {}) {
  const list = [...files];
  if (!list.length) return;
  const batch = `b_${Math.random().toString(36).slice(2, 10)}`;
  let done = 0, skipped = 0;
  for (const [i, f] of list.entries()) {
    const q = new URLSearchParams({ batch, batch_size: list.length, ...(i === list.length - 1 ? { last: '1' } : {}), ...(project_id ? { project_id } : {}), ...(exploration_id ? { exploration_id } : {}) });
    try {
      const r = await api(`/upload?${q}`, { method: 'POST', raw: f, headers: { 'x-filename': encodeURIComponent(f.name || 'pasted.png') } });
      r.results.every((x) => x.skipped) ? skipped++ : done++;
    } catch (e) { fail(e); }
  }
  if (done) watchBatch(batch);
  else if (skipped) toast('Nothing new: those files haven’t changed since they were captured.');
}

// NCS: no tagging, no confirming. Say where the upload went, with Undo; if Trace isn't sure, say it's waiting.
function watchBatch(batch) {
  let busy = false, shown = false;
  const check = async () => {
    if (busy || shown) return;
    busy = true;
    try {
      const ms = await api(`/batch/${batch}`);
      if (!ms.length || ms.some((m) => m.status === 'open' || m.stage !== 'ready')) return;
      shown = true; off();
      for (const m of ms) {
        if (m.project_id) toast(`Sorted to ${m.project_name}`, { img: m.image?.thumb_key, sub: plural(m.iterations, 'iteration'), ms: 9000, action: { label: 'Undo', fn: () => api(`/moments/${m.id}/unfile`, { method: 'POST' }).then(() => toast('Undone. It’s waiting in review for you to file.')).catch(fail) } });
        else toast('Not sure where this goes', { img: m.image?.thumb_key, sub: 'Waiting in review', ms: 9000, action: { label: 'File it', fn: () => go(`/inbox/${m.id}`) } });
      }
    } catch {} finally { busy = false; }
  };
  const off = onLive((t) => t === 'moment' && check());
  setTimeout(off, 90000);
  toast('Uploading…', { ms: 1800 });
  check();
}

// Who's signed in, the projects list and the inbox count: shared by the shell and every screen.
let meState = null;
const meSubs = new Set();
export async function refreshMe() { meState = await api('/me'); meSubs.forEach((f) => f(meState)); return meState; }
export function useMe() {
  const [m, set] = useState(meState);
  useEffect(() => { meSubs.add(set); if (meState) set(meState); else refreshMe().catch(() => {}); return () => meSubs.delete(set); }, []); // the answer may have landed between render and effect
  return m;
}

// Whether Trace's AI is set up: AI buttons appear only when it is.
let aiState = null;
const aiSubs = new Set();
export async function refreshAi() { aiState = await api('/ai'); aiSubs.forEach((f) => f(aiState)); return aiState; }
export function useAi() {
  const [a, set] = useState(aiState);
  useEffect(() => { aiSubs.add(set); if (aiState) set(aiState); else refreshAi().catch(() => {}); return () => aiSubs.delete(set); }, []);
  return a;
}

export function Header({ children, actions }) {
  return html`<header class="hd">
    <button class="btn ghost icon menu-btn" aria-label="Open menu" onClick=${() => dispatchEvent(new Event('trace:menu'))}><${Icon} n="list" /></button>
    <nav class="crumbs grow" aria-label="Breadcrumb">${children}</nav>
    ${actions && html`<div class="actions">${actions}</div>`}
  </header>`;
}

export function Field({ label, hint, children }) {
  return html`<label class="field"><span>${label}</span>${hint && html`<small>${hint}</small>`}${children}</label>`;
}

// Hex colours inside text render as small swatches beside the code.
export const swatchText = (s) => String(s || '').split(/(#[0-9a-f]{6}\b)/i).map((p) => (HEX.test(p) ? html`<span class="sw" style=${{ background: p, verticalAlign: '-1px', marginRight: '3px' }}></span>${p}` : p));

export function Code({ text }) {
  const m = String(text || '').match(/^```(\w+)?\n([\s\S]*?)```\s*$/);
  return html`<pre class="code"><code>${m ? m[2] : text}</code></pre>`;
}
export const copy = async (text, what = 'Copied') => { try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('Couldn’t copy; select and copy it by hand.', { error: true }); } };
