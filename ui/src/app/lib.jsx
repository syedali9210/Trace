// Shared: API client, live events, router, formatting, and the small components every screen uses, built on
// shadcn/ui and Fluid Functionalism (components/ui). Screens import from here, so a control looks and moves the
// same everywhere.
import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Fragment, forwardRef, createContext, useContext } from 'react';
import { toast as sonner } from 'sonner';
import { cn } from '@/lib/utils';
import { SVG } from './icons.js';
import { Button } from '@/components/ui/button';
import { Dialog as UiDialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownTrigger, DropdownContent, DropdownSeparator } from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import { Tabs as UiTabs, TabsList, TabItem } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner, BannerTitle, BannerActions, BannerAction } from '@/components/ui/banner';
import { Tooltip } from '@/components/ui/tooltip';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Switch } from '@/components/ui/switch';
import { useFluidHover, useRegisterFluidHoverItem } from '@/hooks/use-fluid-hover';
import { FluidHoverHighlight } from '@/components/fluid-hover-highlight';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty as UiEmpty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from '@/components/ui/empty';

export { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Fragment, forwardRef, Button, Badge, Tooltip, cn };

// A CSS declaration string ("left:0;top:4px") as a React style object; objects pass through.
export function sx(s) {
  if (!s || typeof s === 'object') return s || undefined;
  const o = {};
  for (const d of String(s).split(';')) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const k = d.slice(0, i).trim();
    if (k) o[k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = d.slice(i + 1).trim();
  }
  return o;
}

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
  const mine = document.querySelector('script[type=module][src*="assets/index-"]')?.src.split('/').pop(); // the UI build this tab runs (none in dev)
  es.addEventListener('build', (e) => { let id = ''; try { id = JSON.parse(e.data).id; } catch {} if (mine && id && id !== mine) toast('Trace was updated', { id: 'build', ms: Infinity, sub: 'Reload to use the new version.', action: { label: 'Reload', fn: () => location.reload() } }); });
  for (const t of ['history', 'moment', 'comment', 'capture', 'artifact', 'reference', 'decision', 'issue', 'proposal', 'project', 'source', 'notification', 'paused', 'memory']) {
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
const follow = (href) => (/^https?:/.test(href) ? window.open(href, '_blank', 'noopener') : (location.hash = href.replace(/^#/, '')));

// ---------- toasts (Sonner, shadcn's) ----------
export function toast(msg, { error = false, action, ms = 5000, img, sub, id } = {}) {
  const o = { description: sub, duration: ms, ...(id ? { id } : {}), ...(img ? { icon: <img src={fileUrl(img)} alt="" className="size-7 rounded-md object-cover bg-white" /> } : {}), ...(action ? { action: { label: action.label, onClick: action.fn } } : {}) };
  return error ? sonner.error(msg, o) : sonner(msg, o);
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

// ---------- icons: Phosphor, the same set as the nav rail ----------
// Drawn as Phosphor's SVG of the same glyph (icons.js) inside the <i> every style rule sizes and colours, so each kind
// of icon can answer its control with a small motion of its own (trace.css: an arrow leans, a refresh turns) and a
// changed icon can crossfade in (`swap`). A name icons.js doesn't have is the font glyph.
function Glyph({ n, swap }) {
  const d = SVG[n];
  return d ? (<svg key={swap ? n : undefined} viewBox="0 0 256 256" fill="currentColor" className={cn(swap && 'swap')}><path d={d} /></svg>) : null;
}
export const Icon = ({ n, cls = '', className, label, size, swap, draw: rise }) => { // `draw` (old name): a hero icon that rises in once
  const a11y = { 'aria-hidden': label ? undefined : true, 'aria-label': label, role: label ? 'img' : undefined };
  if (!SVG[n]) return (<i className={cn('ph', `ph-${n}`, cls, className)} style={size ? { fontSize: size } : undefined} {...a11y}></i>);
  return (<i className={cn('ico', `ico-${n}`, cls, className, rise && 'rise')} style={size ? { fontSize: size } : undefined} {...a11y}><Glyph n={n} swap={swap} /></i>);
};
// The same glyph as an icon component, for the props that take one (leadingIcon, icon…).
const PH = new Map();
export function ph(n) {
  if (!n || typeof n !== 'string') return n || undefined;
  if (!PH.has(n)) {
    const C = SVG[n] ? ({ size = 16, className }) => (<i className={cn('ico', `ico-${n}`, 'inline-flex shrink-0', className)} style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true"><Glyph n={n} /></i>)
      : ({ size = 16, className }) => <i className={cn('ph', `ph-${n}`, 'inline-flex shrink-0', className)} style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true" />;
    C.displayName = `Ph(${n})`; PH.set(n, C);
  }
  return PH.get(n);
}

// ---------- controls ----------
// Old class names ("btn sm primary", "ibtn") as Fluid Functionalism button props.
export function btnProps(cls = '') {
  const c = new Set(String(cls).split(/\s+/));
  const icon = c.has('icon') || c.has('ibtn');
  const small = c.has('sm') || c.has('ibtn');
  const variant = c.has('primary') ? 'primary' : c.has('secondary') ? 'secondary' : c.has('ghost') || c.has('ibtn') ? 'ghost' : 'tertiary';
  return { variant, size: icon ? (small ? 'icon-compact' : 'icon') : small ? 'compact' : 'default', active: c.has('on') || undefined, className: cn(c.has('danger') && 'text-destructive', [...c].filter((x) => !['btn', 'sm', 'icon', 'ibtn', 'primary', 'secondary', 'ghost', 'danger', 'on', ''].includes(x)).join(' ')) || undefined };
}

// A tooltip that names the action and its shortcut (Linear's way).
export function Tip({ tip, kbd, side, children }) {
  if (!tip) return children;
  return (<Tooltip side={side} content={<span className="inline-flex items-center gap-2">{tip}{kbd && (<KbdGroup>{String(kbd).split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}</KbdGroup>)}</span>}>{children}</Tooltip>);
}

export const TOOLS = {
  figma: { label: 'Figma', icon: 'figma-logo', color: 'violet' }, github: { label: 'GitHub', icon: 'github-logo', color: 'teal' }, folder: { label: 'Folder', icon: 'folder-simple', color: 'amber' },
  upload: { label: 'Upload', icon: 'upload-simple', color: 'green' }, link: { label: 'Link', icon: 'link-simple', color: 'cyan' }, agent: { label: 'AI agent', icon: 'sparkle', color: 'purple' }, demo: { label: 'Sample file', icon: 'squares-four', color: 'gray' },
};
export const ToolChip = ({ tool, short }) => {
  const t = TOOLS[tool] || { label: tool, icon: 'circle', color: 'gray' };
  return (<Badge color={t.color} title={t.label}><Icon n={t.icon} className="mr-1" />{short ? (<span className="sr">{t.label}</span>) : t.label}</Badge>);
};
export const ToolIcon = ({ tool }) => (<i className={`ph ph-${TOOLS[tool]?.icon || 'circle'} tool-ico k-${tool}`} title={TOOLS[tool]?.label || tool} aria-label={TOOLS[tool]?.label || tool} role="img"></i>);
// Status words as badges: soft tints, always with their word.
export const Chip = ({ tone, children, className, title }) => (<Badge color={{ ok: 'green', warn: 'amber', err: 'red', sel: 'blue' }[tone] || 'gray'} className={className} title={title}>{children}</Badge>);

export function Magnitude({ score, bucket, basis, compact }) {
  const on = { small: 1, medium: 2, large: 3 }[bucket] || 0;
  const label = bucket ? `${bucket[0].toUpperCase()}${bucket.slice(1)}` : '—';
  const why = basis ? [basis.pixels != null && `${basis.pixels}% of pixels`, basis.properties ? `${basis.properties} properties` : null, basis.nodes && (basis.nodes.added || basis.nodes.removed) ? `+${basis.nodes.added} −${basis.nodes.removed} layers` : null, basis.type].filter(Boolean).join(' · ') : '';
  return (<span className="mag" title={why ? `Magnitude ${score}/100: ${why}` : `Magnitude ${score}/100`}>
    <span className="bars" aria-hidden="true"><i className={on >= 1 ? 'on' : ''}></i><i className={on >= 2 ? 'on' : ''}></i><i className={on >= 3 ? 'on' : ''}></i></span>
    <span>{label}{compact ? '' : (<span className="muted num"> {score}</span>)}</span></span>);
}

export const Avatar = ({ name, agent, lg }) => (<span className={cn('avatar', agent && 'agent', lg && 'lg')} aria-hidden="true">{agent ? (<Icon n="sparkle" />) : initials(name)}</span>);

export function Thumb({ snap, alt = '', cls = '', style, big }) {
  const key = big ? snap?.image_key || snap?.thumb_key : snap?.thumb_key || snap?.image_key;
  return (<div className={`thumb ${cls}`} style={sx(style)}>{key ? (<img src={fileUrl(key)} alt={alt} loading="lazy" decoding="async" />) : <><Icon n="image" cls="ph-light" /><span className="sr">No preview</span></>}</div>);
}

const HEX = /^#[0-9a-f]{3,8}$/i;
export function ChangeLine({ c }) {
  const vals = (v) => String(v || '').split(', ').map((x, i) => <Fragment key={i}>{i ? ', ' : ''}{HEX.test(x.trim()) ? <><span className="sw" style={{ background: x.trim() }}></span>{x.trim()}</> : x}</Fragment>);
  const added = c.after === 'added', removed = c.after === 'removed';
  return (<div className="diffline" title={`${c.path}: ${c.before || '—'} → ${c.after}`}>
    <span className="path">{c.path}</span>
    <span className="vals">{added ? (<span className="text-[color:var(--ok)]">added</span>) : removed ? (<span className="text-destructive">removed</span>) : <>{c.before ? <><s>{vals(c.before)}</s><Icon n="arrow-right" /></> : null}{vals(c.after)}</>}</span>
  </div>);
}

// shadcn's Empty.
export function Empty({ icon = 'tray', title, children, actions }) {
  return (<UiEmpty className="py-20"><EmptyHeader><EmptyMedia variant="icon"><Icon n={icon} size={22} /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{children && (<EmptyDescription>{children}</EmptyDescription>)}</EmptyHeader>{actions && (<EmptyContent><div className="flex flex-wrap justify-center gap-2">{actions}</div></EmptyContent>)}</UiEmpty>);
}
// Fluid Functionalism's Banner, for errors.
export const ErrorBox = ({ error, retry }) => (<Banner status="error" contrast="high"><BannerTitle>{error.message}</BannerTitle>{retry && (<BannerActions><BannerAction onClick={retry}>Try again</BannerAction></BannerActions>)}</Banner>);
export const Loading = ({ h: height = 120 }) => (<Skeleton className="w-full rounded-xl" style={{ height }} aria-busy="true" aria-label="Loading" />);

// Fluid Functionalism's Dialog, with the old props: a title, the body, an optional footer of buttons.
export function Dialog({ title, onClose, children, footer, size = '' }) {
  return (<UiDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
    <DialogContent size={size === 'lg' ? 'xl' : 'lg'} className="tdlg">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="dlg-b">{children}</div>
      {footer && (<DialogFooter>{footer}</DialogFooter>)}
    </DialogContent>
  </UiDialog>);
}

// A menu button: Fluid Functionalism's Dropdown (the highlight glides between rows; it closes on pick or Escape).
export function Menu({ label, icon = 'dots-three', items, btn = 'btn ghost icon', align = 'right', text, side }) {
  const rows = items.filter(Boolean);
  let n = 0;
  const b = btnProps(btn);
  return (<DropdownMenu>
    <DropdownTrigger render={<Button {...b} size={text ? (b.size.startsWith('icon') ? (b.size === 'icon' ? 'default' : 'compact') : b.size) : b.size} aria-label={label} leadingIcon={text && icon ? ph(icon) : undefined}>{text || <Icon n={icon} size={b.size === 'icon-compact' ? 15 : 17} />}</Button>} />
    <DropdownContent align={align === 'right' ? 'end' : 'start'} side={side}>
      {rows.map((it, i) => (it === '-' ? <DropdownSeparator key={`s${i}`} /> : (
        <MenuItem key={i} index={n++} icon={ph(it.icon)} label={it.kbd ? `${it.label}  ·  ${it.kbd}` : it.label} className={it.danger ? 'text-destructive' : undefined} onSelect={() => (it.href ? follow(it.href) : it.onClick())} />
      )))}
    </DropdownContent>
  </DropdownMenu>);
}

// True on a phone-width screen.
export function useNarrow(q = '(max-width: 720px)') {
  const [n, set] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q); const f = () => set(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, [q]);
  return n;
}

// A segmented control: Fluid Functionalism's Tabs (the selected pill travels, a hover pill previews the next pick).
// On a phone, options with icons show only their icons (the label stays as the accessible name).
export function Seg({ value, options, onChange, label, size }) {
  const key = (v) => String(v);
  const iconsOnly = useNarrow() && options.every((o) => o.icon);
  return (<UiTabs value={key(value)} onValueChange={(v) => onChange(options.find((o) => key(o.value) === v)?.value)} size={size}>
    <TabsList aria-label={label} className="seg-ff">{options.map((o) => (<TabItem key={key(o.value)} value={key(o.value)} icon={ph(o.icon)} label={iconsOnly ? '' : o.label} aria-label={iconsOnly ? o.label : undefined} title={o.title || (iconsOnly ? o.label : undefined)} />))}</TabsList>
  </UiTabs>);
}

// Fluid Functionalism's fluid hover for Trace's own lists: one highlight glides to the row nearest the pointer, so what
// is lit is what a click hits. <FluidList axis="y"> around <FluidItem index={i} …> rows (buttons or links).
const FluidCtx = createContext(null);
export function FluidList({ as: Tag = 'div', axis = 'y', radius = 'rounded-md', className, children, ...rest }) {
  const ref = useRef(null);
  const hover = useFluidHover(ref, { axis });
  return (<FluidCtx.Provider value={hover.registerItem}><Tag ref={ref} {...hover.handlers} className={cn('relative', className)} {...rest}><FluidHoverHighlight hover={hover} className={radius} />{children}</Tag></FluidCtx.Provider>);
}
export function FluidItem({ as: Tag = 'button', index, className, ...rest }) {
  const ref = useRef(null);
  useRegisterFluidHoverItem(useContext(FluidCtx), index, ref);
  return (<Tag ref={ref} className={cn('relative', className)} {...(Tag === 'button' && !rest.type ? { type: 'button' } : {})} {...rest} />);
}

// Single-key shortcuts, ignored while typing.
export function useKeys(map, deps = []) {
  useEffect(() => {
    const f = (e) => {
      const t = e.target;
      if (e.defaultPrevented || t.closest?.('input, textarea, select, [contenteditable=true], dialog[open], [role=dialog]')) return;
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
  else if (skipped) toast('Those files are already in Trace, unchanged', { sub: 'To bring in a whole code folder as a project, use + → A code folder, or drop the folder itself.', ms: 9000 });
}

// A code folder, dropped or picked: its files (not dependencies, git or build output) as { path, size, file }.
const JUNK = /^(node_modules|\.git|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.turbo|\.vercel|\.cache|\.parcel-cache|__pycache__|\.?venv|target|Pods|DerivedData)$/;
export async function filesOfEntry(dir) { // a dropped folder (webkitGetAsEntry)
  const out = [];
  const go = async (d, pre) => {
    const r = d.createReader();
    for (let batch; (batch = await new Promise((res, rej) => r.readEntries(res, rej))).length;) { // a reader hands entries over ~100 at a time
      for (const e of batch) {
        if (e.isDirectory) { if (!JUNK.test(e.name)) await go(e, `${pre}${e.name}/`); }
        else { const file = await new Promise((res, rej) => e.file(res, rej)); out.push({ path: pre + e.name, size: file.size, file }); }
      }
    }
  };
  await go(dir, '');
  return out;
}
export const filesOfPick = (list) => [...list].map((f) => ({ path: f.webkitRelativePath.split('/').slice(1).join('/'), size: f.size, file: f })).filter((f) => !f.path.split('/').slice(0, -1).some((s) => JUNK.test(s))); // <input webkitdirectory>

// Trace finds where the folder lives on this computer and links that one (a browser never says where a folder is);
// when it isn't here, it copies the folder in. Either way it becomes a project, or the one that already has it.
export async function addCodeFolder(name, files) {
  const id = `folder-${name}`;
  try {
    if (!files.length) throw new Error(`${name} has no files Trace can read (dependencies and build output are left out).`);
    toast(`Finding ${name} on this computer…`, { id, ms: Infinity });
    const step = Math.max(1, Math.floor(files.length / 36));
    const sample = [...files.filter((f) => /^(package\.json|[^/]*lock[^/]*|index\.html)$/.test(f.path)), ...files.filter((_, i) => i % step === 0)].slice(0, 40).map(({ path, size }) => ({ path, size }));
    const where = await api('/folders/find', { method: 'POST', body: { name, files: sample } });
    let dir = where.dir;
    if (!dir) {
      dir = where.copy;
      for (const [i, f] of files.entries()) {
        if (i % 20 === 0) toast(`Copying ${name} into Trace`, { id, ms: Infinity, sub: `It isn’t in your usual folders, so Trace keeps a copy · ${i} of ${files.length} files` });
        await api(`/folders/copy?${new URLSearchParams({ dir, path: f.path })}`, { method: 'POST', raw: f.file });
      }
    }
    const a = await api('/assemble', { method: 'POST', body: { dir, name, script: false } });
    await refreshMe();
    const had = a.steps[0]?.startsWith('Found');
    toast(had ? `${name} is already a project: ${a.project.name}` : `Made the project ${a.project.name}`, { id, ms: 8000, sub: had ? `Opened it. Its folder: ${dir}` : where.dir ? `Linked to the folder where it is: ${dir}` : `It isn’t in your usual folders, so Trace keeps a copy: ${dir}` });
    go(`/p/${a.project.id}`);
  } catch (e) { toast(`${name} didn’t come in`, { id, error: true, sub: e.message, ms: 10000 }); }
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
  return (<header className="hd">
    <Button variant="ghost" size="icon" className="menu-btn hidden" aria-label="Open menu" onClick={() => dispatchEvent(new Event('trace:menu'))}><Icon n="list" size={17} /></Button>
    <nav className="crumbs grow" aria-label="Breadcrumb">{children}</nav>
    {actions && (<div className="actions">{actions}</div>)}
  </header>);
}

// A labelled field (shadcn's Field anatomy): the label, the hint between it and the control, then the control.
export function Field({ label, hint, children }) {
  return (<label className="field flex flex-col gap-2"><span className="text-[13px] leading-none font-medium text-foreground">{label}</span>{hint && (<small className="-mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</small>)}{children}</label>);
}

// A setting that's on or off: Fluid Functionalism's Switch row (the thumb stretches under the pointer), with its
// hint under it. onChange gets an event-like { target: { checked } }, as the old checkbox's did.
export function SwitchField({ label, hint, checked, onChange, className }) {
  return (<div className={cn('flex flex-col gap-1', className)}><Switch label={label} checked={!!checked} onToggle={() => onChange?.({ target: { checked: !checked } })} />{hint && (<small className="pl-0.5 text-xs leading-snug text-muted-foreground">{hint}</small>)}</div>);
}
// shadcn's Checkbox with the old checkbox's onChange.
export const Check = ({ checked, onChange, ...rest }) => (<Checkbox checked={!!checked} onCheckedChange={(v) => onChange?.({ target: { checked: v }, stopPropagation() {} })} {...rest} />);

// Hex colours inside text render as small swatches beside the code.
export const swatchText = (s) => String(s || '').split(/(#[0-9a-f]{6}\b)/i).map((p, i) => (HEX.test(p) ? <Fragment key={i}><span className="sw" style={{ background: p, verticalAlign: '-1px', marginRight: '3px' }}></span>{p}</Fragment> : p));

export function Code({ text }) {
  const m = String(text || '').match(/^```(\w+)?\n([\s\S]*?)```\s*$/);
  return (<pre className="code"><code>{m ? m[2] : text}</code></pre>);
}
export const copy = async (text, what = 'Copied') => { try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('Couldn’t copy; select and copy it by hand.', { error: true }); } };
