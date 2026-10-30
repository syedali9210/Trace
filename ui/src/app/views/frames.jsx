// Frames: a version's frontend as it really runs. Trace walks the running app the way a person would (tabs, sheets,
// menus, the theme) and every state it lands in is a screen on the canvas, pictured at its whole length and joined by
// the click that leads there. On top of each screen: Frame by frame (its components one at a time, outermost first,
// each where it drew) and Preview (live, opened in that state). Under it, In this frame: its buttons, inputs, text
// styles and the rest, by kind. The strip says how far it got (packages, the app running, the walk) and what to do
// when a stage fails. Design system: the colours and the rest of the tokens in its CSS, its text styles, and every
// component in a gallery and by kind, buttons first. Packages: what the app needs to run, and installing what's missing.
import { useState, useEffect, useRef, useMemo, Fragment, useFetch, useNarrow, api, onLive, rel, Icon, ErrorBox, Seg, Tip, toast, fail, plural, Button, ph, sx, cn, FluidList, FluidItem, Dialog } from '../lib.jsx';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownTrigger, DropdownContent, DropdownLabel } from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ThinkingIndicator } from '@/components/ui/thinking-indicator';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { FileView, DEVICES, Blueprint } from './history.jsx';

const KINDS = ['Buttons', 'Inputs & controls', 'Overlays', 'Navigation', 'Feedback & status', 'Data display', 'Layout', 'Parts'];
const SHORT = { 'Inputs & controls': 'Inputs', 'Feedback & status': 'Status', 'Data display': 'Data' };
const GICON = { Menu: 'list', Sheet: 'sidebar-simple', Options: 'sliders-horizontal', Theme: 'circle-half' }; // a group of screens: what kind
const KIND_ICON = { Buttons: 'cursor-click', 'Inputs & controls': 'sliders-horizontal', Overlays: 'app-window', Navigation: 'compass', 'Feedback & status': 'info', 'Data display': 'table', Layout: 'layout', Parts: 'puzzle-piece' };
const CW = 400, GX = 208, GY = 64, PAD = 80, TOP = 120, HEAD = 44, SUB = 112, MINK = 0.1, FOLD = 1.25; // a screen card: 1280 wide, shown at 400; a long page folds at 1¼ windows
const CARD = { phone: 300, tablet: 360, desktop: CW }, WIDE = { phone: 390, tablet: 834, desktop: 0 }, VH = { phone: 844, tablet: 1194, desktop: 800 }; // a phone's screen is a phone-shaped card, and its Preview opens phone-wide
const FORM = [{ value: 'phone', label: 'Phone', icon: 'device-mobile' }, { value: 'tablet', label: 'Tablet', icon: 'device-tablet' }, { value: 'desktop', label: 'Desktop', icon: 'desktop' }];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (e = '') => (e.startsWith('linear(') ? 'spring curve (baked into linear())' : e.length > 48 ? `${e.slice(0, 48)}…` : e);
const img = (key) => `/files/${key}`;
const words = (props) => Object.entries(props || {}).map(([k, v]) => (v === true ? k : `${k}: ${v}`)).join(' · ');
const abs = (live) => (live.url.startsWith('/') ? `${location.origin}${live.url}` : live.url);
const partUrl = (live, c, mode = 'frame') => `${live.url}__trace/frame?${new URLSearchParams({ f: c.path, c: c.name, m: mode, k: c.kind })}`;
const screenUrl = (live, s) => { const go = s.steps.find((x) => x.go), rest = s.steps.filter((x) => !x.go); const u = new URL(go ? go.go.replace(/^\//, '') : '', abs(live)); if (rest.length) u.searchParams.set('__trace_steps', JSON.stringify(rest.map(({ sel, label, role, rep }) => ({ sel, label, role, rep })))); return u.href; }; // a page opened by its address opens there
const textOn = (s) => [...new Map((s.text || []).filter((t) => t.tag !== 'text' && /\p{L}{2}/u.test(t.sample || '')).map((t) => [`${t.family}|${Math.round(parseFloat(t.size))}|${t.weight}`, t])).values()].slice(0, 8); // a screen's own text styles: its prices, counts and chart labels left out
const styleKey = (t) => [t.family, t.size, t.weight, t.lh, t.ls, t.tt].join('|');
const px = (v) => (/px$/.test(v) ? String(Math.round(parseFloat(v) * 10) / 10) : v);
const num = (n) => Number(n).toLocaleString();
const walkFailed = (d) => !!d?.lastError && (!d.at || d.lastError.at > d.at); // the last walk broke and found nothing: the screens are from before

export function FramesCanvas({ p, sha, title, live, edit }) {
  const [tab, setTab] = useState('screens');
  const code = useFetch(`/projects/${p.id}/history/${sha}/frames`);
  const shots = useFetch(`/projects/${p.id}/history/${sha}/screens`, ['history'], (t, d) => d.project_id === p.id && d.screens === sha && (!d.walking || /^Found/.test(d.walking.label || ''))); // a first walk's screens come in as they're found
  const pk = useFetch(`/projects/${p.id}/history/packages`, ['history'], (t, d) => d.project_id === p.id && !!d.install && d.install !== 'running');
  const q = useFetch(`/projects/${p.id}/history/${sha}/queue`, ['history', 'decision'], (t, d) => d.project_id === p.id && (t === 'decision' || (d.screens === sha && d.walking === null) || (d.stress === sha && d.stressing === null))); // checked again after a walk, a stress walk or a decision
  const [checks, setChecks] = useState(false);
  const [walking, setWalking] = useState(null);
  const [focus, setFocus] = useState(null); // a component (or the type) to show in the design system
  const [goScreen, setGoScreen] = useState(null);
  const [installing, setInstalling] = useState(false);
  const started = useRef(false), walked = useRef(false), rewalk = useRef(false);
  const kind = code.data?.app?.kind;
  useEffect(() => { if (shots.data) setWalking(shots.data.walking); }, [shots.data]);
  useEffect(() => onLive((t, d) => {
    if (t !== 'history' || d.project_id !== p.id) return;
    if (d.install) setInstalling(d.install === 'running');
    if (d.screens !== sha) return;
    setWalking(d.walking);
    if (d.error) toast('The walk stopped', { error: true, sub: `${d.error} The strip above says what you can do.`, ms: 10000 });
    else if (d.walking === null) toast('Walked', { sub: 'Its screens are on the canvas.' });
  }), [p.id, sha]);
  const d = shots.data;
  const mode = live ? live.mode || '' : d?.mode || ''; // a mode its scripts run it in (replay, demo…); Trace remembers it
  const [want, setWant] = useState(null);
  const run = (m) => api(`/projects/${p.id}/history/${sha}/run`, { method: 'POST', body: { mode: m } }).then((r) => { if (r?.install) setTab('packages'); }).catch(fail);
  const restart = () => api(`/projects/${p.id}/history/${sha}/stop`, { method: 'POST' }).then(() => run(mode || undefined)).catch(fail);
  const install = () => api(`/projects/${p.id}/history/install`, { method: 'POST', body: {} }).then((r) => { setInstalling(true); toast(`Installing with ${r.command || 'its package manager'}…`); }).catch(fail);
  const useMode = (m) => { if (m === (want ?? mode)) return; setWant(m); rewalk.current = true; run(m); };
  const narrow = useNarrow(); // the mode switch is left out on a phone (hidden tabs pick another tab by themselves)
  const cramped = useNarrow('(max-width: 1240px)'); // below this the modes live in the App stage's popover
  useEffect(() => { if (!live && edit && !started.current && kind && d) { started.current = true; run(d.mode ?? undefined); } }, [kind, live, d]); // screens need the version running: start it by itself, in the mode its screens were walked in
  const walk = (force, device, full) => api(`/projects/${p.id}/history/${sha}/screens`, { method: 'POST', body: { force, device, full } }).then((d) => setWalking(d.walking)).catch(fail);
  const walkAs = (v) => edit && (ready ? walk(true, v === d.detected ? 'auto' : v) : toast('Run this version first: Trace walks it while it runs'));
  useEffect(() => {
    if (!edit || live?.status !== 'ready' || !shots.data || shots.data.walking) return;
    if (rewalk.current && (live.mode || '') === want) { rewalk.current = false; setWant(null); walk(true); } // it runs in the mode just picked: walk it again
    else if (!shots.data.screens.length && !walked.current && !walkFailed(shots.data)) { walked.current = true; walk(false); }
  }, [live?.status, live?.mode, shots.data]);
  const modes = code.data?.app?.modes || [];
  const catOf = useMemo(() => { const m = new Map((code.data?.components || []).map((c) => [c.name, c.cat])); return (n) => m.get(n) || 'Parts'; }, [code.data]);
  const ready = live?.status === 'ready';
  const acts = { run, restart, install, walk: () => walk(true), walkAll: () => walk(true, undefined, true), packages: () => setTab('packages'), mode: useMode };

  if (code.error) return (<div className="hx-msg"><ErrorBox error={code.error} retry={code.reload} /></div>);
  return (<div className="fr-root">
    <div className="fr-strip">
      <Seg size="compact" label="Frames" value={tab} onChange={setTab} options={[{ value: 'screens', label: 'Screens', icon: 'browsers' }, { value: 'system', label: 'Design system', icon: 'swatches' }, { value: 'packages', label: 'Packages', icon: 'package' }]} />
      <span className="grow"></span>
      {modes.length > 0 && edit && !cramped && (<Tip tip="Its scripts run it in other modes too; a demo or replay mode often brings its own data"><span className="fr-mode"><Seg size="compact" label="Runs in" value={want ?? mode} onChange={useMode} options={[{ value: '', label: 'Dev' }, ...modes.map((m) => ({ value: m, label: `${m[0].toUpperCase()}${m.slice(1)} mode` }))]} /></span></Tip>)}
      {tab === 'screens' && d?.device && !walking && !cramped && (<FormMenu d={d} edit={edit} onPick={walkAs} />)}
      <Pipeline live={live} d={d} walking={walking} edit={edit} pk={pk.data} installing={installing} narrow={narrow} acts={acts} modes={modes} q={q.data} onChecks={() => setChecks((v) => !v)} />
    </div>
    <div className="fr-body" key={tab}>
      {tab === 'screens' && (<Screens p={p} sha={sha} d={d} live={live} edit={edit} walking={walking} title={title} catOf={catOf} comps={code.data?.components || []} go={goScreen} acts={acts}
        modes={edit && !mode ? modes : []} onMode={useMode} onWalkAs={walkAs} onComp={(name) => { setFocus({ name, at: Date.now() }); setTab('system'); }} />)}
      {tab === 'system' && (<DesignSystem p={p} sha={sha} d={d} code={code.data} live={live} focus={focus} walking={walking} edit={edit}
        onScreen={(s, i) => { setGoScreen({ id: s.id, node: i, at: Date.now() }); setTab('screens'); }} />)}
      {tab === 'packages' && (<Packages p={p} edit={edit} />)}
      {checks && (<Checks p={p} sha={sha} q={q.data} live={live} edit={edit} onReload={q.reload} onClose={() => setChecks(false)} onScreen={(id) => { setGoScreen({ id, at: Date.now() }); setTab('screens'); }} />)}
    </div>
  </div>);
}

// How far it got, as stages: the packages, the app running, the walk, then the checks of what it found. Each says where
// it stands; one that's stuck says why and offers the way out (install, try again, see the log, walk again) right there.
// Checks opens the list of what needs you beside the work.
function Pipeline({ live, d, walking, edit, pk, installing, narrow, acts, modes = [], q, onChecks }) {
  const tight = useNarrow('(max-width: 1240px)'), slim = useNarrow('(max-width: 980px)');
  const failedWalk = walkFailed(d);
  const stages = [
    { id: 'pk', label: 'Packages', ...(installing || pk?.installing ? { st: 'run', note: 'Installing' } : live?.install ? { st: 'fail', note: 'Not installed' } : !pk ? { st: 'idle', note: 'Reading' } : pk.missing ? { st: 'warn', note: `${pk.missing} missing` } : { st: 'ok', note: pk.conflicts?.some((c) => !c.soft) ? plural(pk.conflicts.filter((c) => !c.soft).length, 'conflict') : 'Installed' }) },
    { id: 'app', label: 'App', ...(!live ? { st: 'idle', note: 'Not running' } : live.status === 'starting' ? { st: 'run', note: 'Starting' } : live.status === 'ready' ? { st: 'ok', note: live.mode ? `Running · ${live.mode}` : 'Running' } : { st: 'fail', note: 'Didn’t start' }) },
    { id: 'walk', label: 'Walk', ...(walking ? { st: 'run', note: `${walking.found || 0} found` } : failedWalk ? { st: 'fail', note: 'Stopped' } : d?.stopped ? { st: 'warn', note: `Stopped at ${d.screens.length}` } : d?.screens?.length ? { st: 'ok', note: plural(d.screens.length, 'screen') } : { st: 'idle', note: 'Not yet' }) },
    { id: 'checks', label: 'Checks', ...(!d?.screens?.length ? { st: 'idle', note: 'After the walk' } : !q ? { st: 'run', note: 'Checking' } : q.items.length ? { st: 'warn', note: `${q.items.length} need you` } : { st: 'ok', note: 'All clear' }) },
  ];
  const lead = stages.find((s) => s.st === 'fail') || stages.find((s) => s.st === 'run') || stages.find((s) => s.st === 'warn') || stages[2];
  const show = narrow || slim ? [lead] : stages;
  const ready = live?.status === 'ready';
  const tail = (live?.log || '').split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-8).join('\n');
  const body = {
    pk: (<>
      <b>Packages</b>
      <p className="small ink2">{installing || pk?.installing ? 'Installing them now, with the folder’s own package manager.' : live?.install ? 'Its packages aren’t installed, so the app can’t start.' : pk?.missing ? `${plural(pk.missing, 'package')} the app needs ${pk.missing === 1 ? 'isn’t' : 'aren’t'} installed: it may not start or draw right.` : pk?.conflicts?.length ? 'Everything is installed, with conflicts to look at.' : 'Everything the app needs is installed.'}</p>
      <div className="pl-acts">{edit && (live?.install || pk?.missing > 0) && (<Button variant="primary" size="compact" leadingIcon={ph('download-simple')} onClick={acts.install}>Install what’s missing</Button>)}<Button variant="secondary" size="compact" onClick={acts.packages}>Open Packages</Button></div>
    </>),
    app: (<>
      <b>The app</b>
      <p className="small ink2">{!live ? 'It isn’t running. Screens are walked while it runs.' : live.status === 'starting' ? 'Its own dev server is starting. The first time it can take a minute while it prepares its packages.' : ready ? `Running${live.mode ? ` in ${live.mode} mode` : ''}, on its own dev server.` : live.error || 'Its dev server stopped.'}</p>
      {live?.status === 'failed' && tail && (<pre className="pl-log">{tail}</pre>)}
      {edit && (<div className="pl-acts">
        {live?.status === 'failed' && live.install && (<Button variant="primary" size="compact" leadingIcon={ph('download-simple')} onClick={acts.install}>Install its packages</Button>)}
        {(!live || live.status === 'failed') && (<Button variant={live?.install ? 'secondary' : 'primary'} size="compact" leadingIcon={ph('play')} onClick={() => acts.run()}>{live ? 'Try again' : 'Run it'}</Button>)}
        {ready && (<Button variant="secondary" size="compact" leadingIcon={ph('arrow-clockwise')} onClick={acts.restart}>Restart</Button>)}
        {ready && (<Button variant="secondary" size="compact" leadingIcon={ph('arrow-square-out')} render={<a href={abs(live)} target="_blank" rel="noopener" />}>Open it</Button>)}
      </div>)}
      {edit && modes.length > 0 && (<div className="pl-acts"><span className="tiny muted">Runs in</span>{['', ...modes].map((m) => (<Button key={m || 'dev'} variant={(live?.mode || '') === m ? 'primary' : 'ghost'} size="compact" onClick={() => (live?.mode || '') !== m && acts.mode(m)}>{m ? `${m[0].toUpperCase()}${m.slice(1)} mode` : 'Dev'}</Button>))}</div>)}
    </>),
    walk: (<>
      <b>The walk</b>
      <p className="small ink2">{walking ? `${walking.label}. ${plural(walking.found || 0, 'screen')} so far.` : failedWalk ? `It stopped before finding anything: ${d.lastError.message}${d.screens.length ? ' The screens on the canvas are from the walk before.' : ''}` : d?.stopped ? `It stopped part-way (${d.stopped}); the ${plural(d.screens.length, 'screen')} it found are kept.` : d?.screens?.length ? `${plural(d.screens.length, 'screen')}${d.since ? '' : ` from ${plural(d.clicks || d.screens.length, 'click')}`}, walked ${rel(d.at)}${d.timing?.total && !d.since ? ` in ${Math.max(1, Math.round(d.timing.total / 1000))} s` : ''}.${!d.since ? '' : d.since.redid ? ` ${plural(d.since.changed, 'file')} changed since the walk before, so only the ${plural(d.since.redid, 'screen')} drawing ${d.since.changed > 1 ? 'them' : 'it'} were walked again; the rest are kept.` : ' Nothing on any screen had changed since the walk before.'}` : 'Not walked yet: Trace clicks through the app once it runs.'}</p>
      {!walking && d?.skipped?.length > 0 && (<div className="pl-skip"><span className="tiny muted">{plural(d.skipped.length, 'click')} it couldn’t make</span>{d.skipped.slice(0, 5).map((k, i) => (<span key={i} className="small"><b>“{k.label.slice(0, 32)}”</b>{k.on ? ` on ${k.on}` : ''}: <span className="ink2">{k.why}</span></span>))}</div>)}
      {edit && !walking && (<div className="pl-acts">{ready ? (<Button variant={failedWalk || d?.stopped ? 'primary' : 'secondary'} size="compact" leadingIcon={ph('arrows-clockwise')} onClick={acts.walk}>{d?.screens?.length ? 'Walk again' : 'Walk it'}</Button>) : (<span className="small muted">Run the app first, then walk it.</span>)}{ready && d?.since && (<Tip tip="Every screen, not only the ones a change touched"><Button variant="ghost" size="compact" onClick={acts.walkAll}>Walk all of it</Button></Tip>)}</div>)}
    </>),
  };
  return (<div className="pl" role="group" aria-label="How far it got">
    {show.map((s, i) => (<Fragment key={s.id}>
      {i > 0 && (<span className={cn('pl-join', show[i - 1].st)} aria-hidden="true" />)}
      {s.id === 'checks' ? (<button type="button" className={cn('pl-s', s.st)} aria-label={`${s.label}: ${s.note}`} disabled={!d?.screens?.length} onClick={onChecks}><Dot st={s.st} /><span className="pl-l">{s.label}</span>{(!tight || s.st !== 'ok' || slim || narrow) && (<span className="pl-n num">{s.note}</span>)}</button>) : (<Popover>
        <PopoverTrigger render={<button type="button" className={cn('pl-s', s.st)} aria-label={`${s.label}: ${s.note}`}><Dot st={s.st} /><span className="pl-l">{s.label}</span>{(!tight || s.st !== 'ok' || slim || narrow) && (<span className="pl-n num">{s.note}</span>)}</button>} />
        <PopoverContent align="end" sideOffset={8} className="pl-pop w-80">{body[s.id]}</PopoverContent>
      </Popover>)}
    </Fragment>))}
  </div>);
}
const Dot = ({ st }) => (<span className={cn('pl-d', st)} aria-hidden="true">{st === 'ok' ? (<Icon n="check" />) : st === 'fail' ? (<Icon n="x" />) : st === 'warn' ? '!' : null}</span>);

// What needs you, riskiest first (server/check.js `queue`), each with where it comes from and its way out. "Ask Claude"
// writes the request out for you to read and send; "It's meant" and "Keep …" are decisions, kept, so it doesn't come
// back. States nobody has seen come last, with the stress walk that forces them.
const CK = { scope: 'Changed outside the ask', rule: 'Your rules, broken', broken: 'Decisions the code broke', flip: 'Nobody has decided', design: 'The design and the code apart', figma: 'Figma and the app', stress: 'Breaks', drift: 'Almost the same value' };
const said = (t, n = 90) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t);
function Checks({ p, sha, q, live, edit, onScreen, onReload, onClose }) {
  const [ask, setAsk] = useState(null); // { item, text }: a request being written to Claude
  const [stressing, setStressing] = useState(null);
  const box = useRef(null);
  useEffect(() => onLive((t, d) => { if (t === 'history' && d.project_id === p.id && d.stress === sha) setStressing(d.stressing || null); }), [p.id, sha]);
  useEffect(() => { if (ask) setTimeout(() => box.current?.focus(), 30); }, [ask?.item.key]);
  const [gone, setGone] = useState(() => new Set()); // decided here: off the list at once, not when the check has run again
  const decide = async (it, text, governs) => {
    setGone((g) => new Set(g).add(it.key));
    try {
      const d = await api(`/projects/${p.id}/decisions`, { method: 'POST', body: { text, source_type: 'check', source_id: it.key, governs } });
      onReload();
      toast('Kept as a decision', { sub: said(text, 120), ms: 8000, action: { label: 'Undo', fn: () => { setGone((g) => { const n = new Set(g); n.delete(it.key); return n; }); api(`/decisions/${d.id}`, { method: 'DELETE' }).then(onReload).catch(fail); } } });
    } catch (e) { setGone((g) => { const n = new Set(g); n.delete(it.key); return n; }); fail(e); }
  };
  const send = async () => {
    try {
      const r = await api('/comments', { method: 'POST', body: { target_type: 'version', target_id: `${p.id}:${sha}`, body: ask.text } });
      if (r.claude_error) throw new Error(r.claude_error);
      setAsk(null);
      toast(`${r.agent || 'Claude'} is on it`, { sub: 'It works in the project’s folder and saves it as a new version. Follow it in Versions.' });
    } catch (e) { fail(e); }
  };
  const stress = async () => { setStressing({ done: 0, total: 1, label: 'Opening the pages' }); try { await api(`/projects/${p.id}/history/${sha}/stress`, { method: 'POST' }); } catch (e) { fail(e); } setStressing(null); };
  const where = (it) => it.where && `${it.where.file}${it.where.in ? `, in ${it.where.in.replace(/\s*\{$/, '')}` : ''}`;
  const items = (q?.items || []).filter((x) => !gone.has(x.key));
  const groups = Object.keys(CK).map((k) => [k, items.filter((x) => x.kind === k)]).filter(([, l]) => l.length);
  const ready = live?.status === 'ready';
  return (<aside className="hx-panel ck" aria-label="Checks">
    <div className="hx-ph"><Icon n="seal-check" /><b className="trunc">Checks</b><span className="grow"></span><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={onClose}><Icon n="x" size={15} /></Button></div>
    <div className="hx-pb">
      {!q ? (<p className="small muted">Checking what the walk found…</p>) : (<div className="col" style={sx('gap:4px')}>
        <h2>{items.length ? `${plural(items.length, 'thing')} need${items.length === 1 ? 's' : ''} you` : 'Nothing needs you'}</h2>
        <p className="small muted">Read from the walk {rel(q.at)}{q.ask ? `, against what was asked: “${said(q.ask, 80)}”` : ''}.{q.decided ? ` ${plural(q.decided, 'other')} decided before.` : ''}</p>
      </div>)}
      {groups.map(([k, list]) => (<section key={k} className="col" style={sx('gap:8px')} aria-label={CK[k]}>
        <span className="hx-k">{CK[k]}</span>
        {list.map((it) => (<div key={it.key} className={cn('ck-i', ask?.item.key === it.key && 'on')}>
          <b className="ck-t">{it.title}</b>
          {it.detail && (<p className="small ink2 ck-d">{it.detail}</p>)}
          {it.where && (<><p className="tiny muted ck-from"><Icon n="file-code" />{where(it)}</p><code className="ck-code">{it.where.line}</code></>)}
          {it.history && (<ol className="ck-h">{it.history.map((h, i) => (<li key={i} className="tiny"><span className="num">{h.commit}</span> <b>{h.by}</b> {h.from} → {h.to}<span className="muted"> · “{said(h.said, 70)}”</span></li>))}</ol>)}
          {it.from && !it.history && (<p className="tiny muted ck-from"><Icon n="git-commit" />{it.from.file}{it.from.commit ? ` · ${it.from.commit} by ${it.from.by}` : ''}{it.from.commit ? (it.from.asked ? ` · asked “${said(it.from.asked, 60)}”` : ` · “${said(it.from.title, 60)}”`) : ''}</p>)}
          {edit && (<div className="ck-acts">
            {it.choices ? it.choices.map((v) => (<Button key={v} variant="secondary" size="compact" onClick={() => { decide(it, `Keep ${v} for ${where(it)}.`, { kind: 'value', file: it.where.file, in: it.where.in, value: v }); if (v !== it.now) setAsk({ item: it, text: `@claude Set ${it.now} back to ${v} in ${where(it)}: it has gone back and forth, and ${v} is the one to keep.` }); }}>Keep {v}{v === it.now ? ' (now)' : ''}</Button>))
              : (<>{it.fix && (<Button variant="secondary" size="compact" leadingIcon={ph('at')} onClick={() => setAsk({ item: it, text: `@claude ${it.fix}` })}>Ask Claude</Button>)}
                <Button variant="ghost" size="compact" onClick={() => decide(it, `It’s meant: ${it.title}.${it.detail ? ` ${it.detail}` : ''}`)}>It’s meant</Button></>)}
            {it.screen && (<Button variant="ghost" size="compact" onClick={() => onScreen(it.screen)}>Show it</Button>)}
          </div>)}
        </div>))}
      </section>))}
      {q && (<section className="col" style={sx('gap:8px')} aria-label="States nobody has seen">
        <span className="hx-k">States nobody has seen</span>
        <p className="small ink2">{q.states.n ? `${plural(q.states.n, 'state')} in the code that no walk has seen and no design shows` : 'Every state in the code was seen, designed or forced'}{q.states.forced ? `; the stress walk forced ${q.states.forced}` : ''}.</p>
        {q.states.top.length > 0 && (<ul className="ck-sl">{q.states.top.map((x) => (<li key={x.name} className="small"><b>{x.name}</b> <span className="ink2">{x.states.join(', ')}</span></li>))}</ul>)}
        {edit && (<div className="ck-acts"><Button variant="secondary" size="compact" leadingIcon={ph('lightning')} aria-disabled={!ready || !!stressing} onClick={() => ready && !stressing && stress()}>{stressing ? `Stress walk · ${stressing.done} of ${stressing.total}` : q.stress ? 'Stress walk again' : 'Force them: stress walk'}</Button></div>)}
        <p className="tiny muted">{!ready && edit ? 'Run the app first: the stress walk opens it. ' : ''}{q.stress ? `Last stress walk ${rel(q.stress.at)}: ${plural(q.stress.pages, 'page')} with no data, failing data, slow data and long text${q.stress.data ? '' : ' (this app asks for no data of its own, so only long text could be forced)'}.` : 'It opens each page with no data, failing data, slow data and long text, and checks what breaks.'}</p>
      </section>)}
    </div>
    {ask && (<div className="ck-ask">
      <span className="tiny muted trunc">To Claude, about: {ask.item.title}</span>
      <Textarea ref={box} rows={4} value={ask.text} onChange={(e) => setAsk({ ...ask, text: e.target.value })} aria-label="What to ask Claude" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); if (e.key === 'Escape') setAsk(null); }} />
      <div className="ck-acts"><Button variant="primary" size="compact" onClick={send}>Send to Claude</Button><Button variant="ghost" size="compact" onClick={() => setAsk(null)}>Cancel</Button><span className="tiny muted grow" style={sx('text-align:right')}>Claude Code, on your Claude plan</span></div>
    </div>)}
  </aside>);
}

// What the app is built for (found by itself, and why), and walking it at another size. A quiet menu, not a width
// toggle: it walks the whole app again, so it shouldn't look like a preview size.
const whyOf = (d) => (d.found?.hint ? 'It’s built with a phone framework' : d.detected === 'phone' ? `At desktop width it draws a ${d.found?.span}px column with empty sides` : d.detected === 'tablet' ? `At desktop width it draws a ${d.found?.span}px column with a tab bar along the bottom` : 'It spreads across a desktop-wide window');
function FormMenu({ d, edit, onPick }) {
  const found = d.detected || d.device;
  return (<DropdownMenu>
    <DropdownTrigger render={<Button variant="ghost" size="compact" leadingIcon={ph(FORM.find((f) => f.value === found).icon)} aria-label={`A ${found} app: walk it at another size`}>{`${found[0].toUpperCase()}${found.slice(1)} app`}</Button>} />
    <DropdownContent align="end" className="w-72">
      <DropdownLabel>{whyOf(d)}, so Trace walks it as a {found}.</DropdownLabel>
      {FORM.map((f, i) => (<MenuItem key={f.value} index={i} icon={ph(f.icon)} checked={f.value === d.device} disabled={!edit} label={`Walk it as a ${f.label.toLowerCase()}${f.value === found ? ' (found)' : ''}`} onSelect={() => f.value !== d.device && onPick(f.value)} />))}
    </DropdownContent>
  </DropdownMenu>);
}

// ---------- Screens: the states the walk found, laid out by the clicks that lead from one to the next ----------
// Columns by how many clicks in; under each screen, what it leads to, in the order found. A long page shows its
// first 1¼ windows and unfolds to its whole length.
function layout(list, cw, vh, open) {
  const ids = new Set(list.map((s) => s.id)), kids = new Map();
  for (const s of list) if (s.from && ids.has(s.from)) kids.set(s.from, [...(kids.get(s.from) || []), s]);
  const pos = {}, cols = new Map();
  let right = 0;
  const place = (s, depth, y) => {
    const x = PAD + depth * (cw + GX), k = cw / s.w, full = Math.round(s.h * k), fold = Math.round(vh * k * FOLD), folds = full > fold + 24;
    const pic = folds && !open.has(s.id) ? fold : full;
    pos[s.id] = { x, y, w: cw, h: HEAD + pic + SUB, k, pic, full, folds, depth };
    cols.set(depth, x);
    right = Math.max(right, x + cw);
    let below = y;
    for (const c of kids.get(s.id) || []) below = place(c, depth + 1, below);
    return Math.max(y + pos[s.id].h + GY, below);
  };
  let y = TOP;
  for (const s of list.filter((x) => !x.from || !ids.has(x.from))) y = place(s, 0, y);
  return { pos, w: right + PAD, h: y + PAD, cw, cols: [...cols].sort((a, b) => a[0] - b[0]) };
}

function Screens({ p, sha, d, live, edit, walking, title, catOf, comps, go, acts, modes, onMode, onComp, onWalkAs }) {
  const list = d?.screens || [];
  const [open, setOpen] = useState(() => new Set()); // long pages unfolded to their whole length
  const lay = useMemo(() => layout(list, CARD[d?.device] || CW, VH[d?.device] || 800, open), [d, open]);
  const [view, setView] = useState(null);
  const [glide, setGlide] = useState(false);
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(null);
  const [hl, setHl] = useState(null); // { sid, rs }: parts lit on a screen
  const [assemble, setAssemble] = useState(null); // { s, at }
  const [preview, setPreview] = useState(null);
  const [quiet, setQuiet] = useState(false);
  const box = useRef(), drag = useRef(null), known = useRef(null);
  const ready = live?.status === 'ready';
  // Screens that just arrived (a walk finding them, a page opening) rise in, a beat apart; the ones already there stay put.
  const fresh = known.current ? list.filter((s) => !known.current.has(s.id)).map((s) => s.id) : list.map((s) => s.id);
  useEffect(() => { known.current = new Set(list.map((s) => s.id)); }, [d]);
  useEffect(() => { // open on the first screens, big enough to read
    if (!list.length || view || !box.current) return;
    const b = box.current.getBoundingClientRect();
    setView({ k: clamp(Math.min(1, (b.width - 80) / Math.min(lay.w, lay.cw * 2 + GX + PAD * 2)), 0.35, 1), x: 16, y: below() });
  }, [lay]);
  const below = () => Math.max(0, ...[...(box.current?.querySelectorAll('.sc-legend, .fr-notice') || [])].map((l) => l.offsetTop + l.offsetHeight)); // start under the group chips and a notice, not behind them
  const zoom = (f, e) => { const b = box.current.getBoundingClientRect(); const k = clamp(view.k * f, MINK, 2); const cx = e ? e.clientX - b.left : b.width / 2, cy = e ? e.clientY - b.top : b.height / 2; setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k }); };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e) => { if (e.target.closest('.hx-panel, .sc-mini')) return; e.preventDefault(); setGlide(false); if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.0022), e); else setView((v) => v && ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) })); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const glideFor = () => { setGlide(!still()); setTimeout(() => setGlide(false), 460); };
  const goTo = (id, k) => { const at = lay.pos[id], b = box.current?.getBoundingClientRect(); if (!at || !b) return; setSel(id); glideFor(); setView((v) => { const z = k || v?.k || 1; return { k: z, x: (b.width - (innerWidth > 900 ? 440 : 0)) / 2 - (at.x + at.w / 2) * z, y: Math.min(40, b.height / 2 - (at.y + Math.min(at.h, b.height / z) / 2) * z) }; }); };
  const centre = (x, y) => { const b = box.current.getBoundingClientRect(); setView((v) => ({ ...v, x: b.width / 2 - x * v.k, y: b.height / 2 - y * v.k })); };
  useEffect(() => { if (go && lay.pos[go.id]) { goTo(go.id, Math.max(view?.k || 0.6, 0.6)); if (go.node != null) setAssemble({ s: list.find((s) => s.id === go.id), at: go.node }); } }, [go?.at]);
  // A drag on the ground or a picture pans; a press that doesn't move picks the screen under it.
  const down = (e) => { if (e.button !== 0 || e.target.closest('.hx-panel, .fab-bar, .sc-h, .sc-sub, .fr-notice, .sc-mini, button, a')) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, o: view, moved: false, hit: e.target.closest('.sc')?.dataset.id }; setGlide(false); };
  const move = (e) => { const g = drag.current; if (!g) return; if (Math.abs(e.clientX - g.sx) + Math.abs(e.clientY - g.sy) > 4) g.moved = true; if (g.moved) setView({ ...g.o, x: g.o.x + e.clientX - g.sx, y: g.o.y + e.clientY - g.sy }); };
  const up = () => { const g = drag.current; drag.current = null; if (g && !g.moved) setSel(g.hit && g.hit !== sel ? g.hit : null); };
  const fit = () => { const b = box.current.getBoundingClientRect(), t = below(); const k = clamp(Math.min((b.width - 60) / lay.w, (b.height - 110 - t) / lay.h), MINK, 1); glideFor(); setView({ k, x: (b.width - lay.w * k) / 2, y: t }); };
  // Arrow keys walk the map: → what this screen leads to, ← where it came from, ↑ ↓ the screens beside it.
  useEffect(() => {
    const f = (e) => {
      if (assemble || preview || e.metaKey || e.ctrlKey || e.altKey || !list.length) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable=true], [role=tab], [role=tablist], [role=menu], [role=menuitem], [role=option], [role=slider], [role=dialog]')) return;
      if (e.key === 'Escape' && sel) { setSel(null); return; }
      if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      e.preventDefault();
      const cur = sel && list.find((s) => s.id === sel);
      if (!cur) return goTo(list[0].id);
      const ys = (a, b) => lay.pos[a.id].y - lay.pos[b.id].y;
      let next = null;
      if (e.key === 'ArrowRight') next = list.filter((s) => s.from === cur.id).sort(ys)[0];
      else if (e.key === 'ArrowLeft') next = list.find((s) => s.id === cur.from);
      else { const col = list.filter((s) => lay.pos[s.id]?.depth === lay.pos[cur.id].depth).sort(ys); next = col[col.findIndex((s) => s.id === cur.id) + (e.key === 'ArrowDown' ? 1 : -1)]; }
      if (next) goTo(next.id);
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  });

  if (!list.length && (walking || live?.status === 'starting' || (edit && (!live || (ready && d && !d.at && !walkFailed(d)))))) return (<Gate wide><Blueprint pid={p.id} sha={sha} live={live || { status: 'starting', stage: 'server' }} walking={walking} title={title} /></Gate>); // its blueprint while it starts and until the walk finds its first screen
  if (!list.length) return (<Gate>{live?.status === 'failed' ? (<><Icon n="warning-circle" cls="big" /><h2>{title} didn’t start</h2><p>{live.error}</p>
      {live.log && (<details className="gate-log"><summary className="small">What its dev server said</summary><pre className="pl-log">{live.log.split('\n').filter(Boolean).slice(-12).join('\n')}</pre></details>)}
      {edit && (<div className="row wrap" style={sx('gap:8px;justify-content:center')}>{live.install && (<Button variant="primary" leadingIcon={ph('download-simple')} onClick={acts.install}>Install its packages</Button>)}<Button variant={live.install ? 'secondary' : 'primary'} leadingIcon={ph('play')} onClick={() => acts.run()}>Try again</Button><Button variant="secondary" onClick={acts.packages}>See its packages</Button></div>)}</>)
    : !live ? (<><Icon n="browsers" cls="big" /><h2>Run this version to see its screens</h2><p>Screens come from the app running, clicked through like a person would.</p></>)
    : !d ? (<><ThinkingIndicator /><p>Reading…</p></>)
    : walkFailed(d) ? (<><Icon n="warning-circle" cls="big" /><h2>The walk stopped</h2><p>{d.lastError.message}</p>{edit && (<Button variant="primary" leadingIcon={ph('arrows-clockwise')} onClick={acts.walk}>Walk it again</Button>)}</>)
    : (<><Icon n="browsers" cls="big" /><h2>No screens yet</h2><p>Walk the app: Trace clicks through it and keeps each state it lands in.</p>{edit && ready && (<Button variant="primary" leadingIcon={ph('arrows-clockwise')} onClick={acts.walk}>Walk it</Button>)}</>)}</Gate>);

  const s0 = sel && list.find((s) => s.id === sel);
  const trail = new Set(); for (let s = s0; s; s = list.find((x) => x.id === s.from)) trail.add(s.id); // the clicks that lead to the picked screen
  // A dialog, sheet or menu and every stage of it, framed together under one label ("Dialog opened · How It Works").
  const groups = [...new Map(list.filter((s) => s.group).map((s) => [s.group.id, { ...s.group, ids: list.filter((x) => x.group?.id === s.group.id).map((x) => x.id), stages: s.stages }])).values()].map((g) => {
    const ps = g.ids.map((id) => lay.pos[id]).filter(Boolean);
    return { ...g, x: Math.min(...ps.map((a) => a.x)) - 24, y: Math.min(...ps.map((a) => a.y)) - 52, w: Math.max(...ps.map((a) => a.x)) + lay.cw + 24 - (Math.min(...ps.map((a) => a.x)) - 24), h: Math.max(...ps.map((a) => a.y + a.h)) + 20 - (Math.min(...ps.map((a) => a.y)) - 52) };
  });
  const fitGroup = (g) => { const b = box.current.getBoundingClientRect(); const k = clamp(Math.min((b.width - 80) / g.w, (b.height - 140) / g.h), MINK, 1); glideFor(); setView({ k, x: (b.width - g.w * k) / 2 - g.x * k, y: 56 - g.y * k }); };
  const toggleFold = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const order = list.filter((s) => lay.pos[s.id]);
  return (<>
    <div className="hx-canvas fr-canvas" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Screens: drag to move around, Ctrl + wheel to zoom, arrow keys move between screens">
      {groups.length > 0 && (<div className="sc-legend" role="navigation" aria-label="Groups of screens">
        {groups.map((g) => (<button key={g.id} type="button" className="sc-gchip" onClick={() => fitGroup(g)}><Icon n={GICON[g.kind] || 'app-window'} /><span className="trunc">{g.label}</span><span className="num muted">{g.ids.length}</span></button>))}
      </div>)}
      {view && (<div className={cn('hx-plane', glide && 'glide')} style={sx({ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: `${lay.w}px`, height: `${lay.h}px` })}>
        {lay.cols.map(([dep, x]) => (<span key={dep} className="sc-col" style={sx({ left: `${x}px`, top: `${TOP - 76}px`, width: `${lay.cw}px` })}><b>{dep === 0 ? 'Opens on' : `${dep} click${dep > 1 ? 's' : ''} in`}</b><span>{plural(order.filter((s) => lay.pos[s.id].depth === dep).length, 'screen')}</span></span>))}
        {groups.map((g) => (<div key={g.id} className="sc-group" style={sx({ left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px` })}>
          <span className="sc-glabel"><Icon n={GICON[g.kind] || 'app-window'} /><b>{g.label}</b>{g.stages > 1 && (<span className="muted">· {plural(g.stages, g.kind === 'Options' ? 'view' : g.kind === 'Theme' ? 'theme' : 'stage')}</span>)}</span>
        </div>))}
        <Links list={order} pos={lay.pos} sel={sel} hov={hov} trail={trail} />
        {order.map((s) => (<ScreenCard key={s.id} s={s} at={lay.pos[s.id]} sel={sel === s.id} hl={hl?.sid === s.id ? hl.rs : null} ready={ready} catOf={catOf} enter={fresh.indexOf(s.id)}
          onHover={(on) => setHov(on ? s.id : null)} onFold={() => toggleFold(s.id)}
          onHl={(rs) => setHl(rs ? { sid: s.id, rs } : null)} onComp={onComp} onAssemble={() => setAssemble({ s, at: 0 })} onPreview={() => setPreview(s)} onPick={() => setSel(sel === s.id ? null : s.id)} />))}
      </div>)}
      {d.device && d.detected && d.device !== d.detected ? (<div className="fr-notice small" role="note">
        <Icon n={FORM.find((f) => f.value === d.detected).icon} /><div className="col" style={sx('gap:4px;min-width:0')}><b>Walked as a {d.device}, but it’s built for {d.detected}s</b><span className="ink2">{whyOf(d)}. That’s the app’s own layout, so at this size it looks {d.detected === 'phone' ? 'like a phone column in an empty page' : 'stretched'}.</span>
          {edit && (<div className="row" style={sx('gap:6px;margin-top:6px')}><Button variant="secondary" size="compact" leadingIcon={ph(FORM.find((f) => f.value === d.detected).icon)} onClick={() => onWalkAs(d.detected)}>Walk it as a {d.detected}</Button></div>)}</div>
      </div>) : d.failed?.length > 0 && !quiet && (<div className="fr-notice small" role="note">
        <Icon n="plugs" /><div className="col" style={sx('gap:4px;min-width:0')}><b>It asked for data that didn’t come</b><span className="ink2">Its screens show what it draws without it. {modes.length ? `Its scripts also run it in ${modes.join(' or ')} mode, which may bring its own data.` : 'Start what serves it (its API or backend) and walk again.'}</span>{d.failed.slice(0, 3).map((f) => (<span key={f} className="mono tiny muted trunc">{f}</span>))}
          {modes.length > 0 && (<div className="row" style={sx('gap:6px;margin-top:6px')}>{modes.map((m) => (<Button key={m} variant="secondary" size="compact" leadingIcon={ph('play')} onClick={() => { setQuiet(true); onMode(m); }}>Run in {m} mode</Button>))}</div>)}</div>
        <Button variant="ghost" size="icon-compact" aria-label="Hide" onClick={() => setQuiet(true)}><Icon n="x" size={14} /></Button>
      </div>)}
      {view && order.length > 2 && (<MiniMap lay={lay} list={order} view={view} box={box} sel={sel} onCentre={centre} />)}
      {s0 && (<ScreenPanel s={s0} list={list} live={live} comps={comps} onHl={(rs) => setHl(rs ? { sid: s0.id, rs } : null)} onAssemble={(at = 0) => setAssemble({ s: s0, at })} onPreview={() => setPreview(s0)} onComp={onComp} onGo={goTo} onClose={() => setSel(null)} />)}
    </div>
    <div className="fab-bar hx-dock" role="toolbar" aria-label="Screens">
      <Tip tip="Arrow keys move between screens"><span className="fr-count small">{d.partial && walking ? (<><span className="pl-d run" aria-hidden="true" />{plural(list.length, 'screen')} so far</>) : <>{plural(list.length, 'screen')} · {plural(new Set(list.flatMap((s) => s.tree.map((n) => n.n))).size, 'component')}</>}</span></Tip>
      <div className="fab-2">
        <Tip tip="Zoom out"><Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}><Icon n="minus" size={16} /></Button></Tip>
        <span className="hx-zoom num" style={sx('display:inline-grid;place-items:center')}>{Math.round((view?.k || 1) * 100)}%</span>
        <Tip tip="Zoom in"><Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => zoom(1.25)}><Icon n="plus" size={16} /></Button></Tip>
        <Tip tip="Fit everything"><Button variant="ghost" size="icon" aria-label="Fit everything" onClick={fit}><Icon n="corners-out" size={16} /></Button></Tip>
      </div>
    </div>
    {assemble && (<Assemble key={assemble.s.id} p={p} sha={sha} edit={edit} s={assemble.s} at={assemble.at} list={order} comps={comps} onScreen={(x) => setAssemble({ s: x, at: 0 })} onComp={(n) => { setAssemble(null); onComp(n); }} onClose={() => setAssemble(null)} />)}
    {preview && (<LivePreview key={preview.id} s={preview} list={order} live={live} edit={edit} w0={WIDE[d.device] || 0} acts={acts} onScreen={setPreview} onPicture={() => { setPreview(null); setAssemble({ s: preview, at: 0 }); }} onClose={() => setPreview(null)} />)}
  </>);
}

const Gate = ({ children, wide }) => (<div className="hx-gate"><div className={cn('hx-gate-c', wide && 'bp-gate')}>{children}</div></div>);

// The whole map at a glance, in the corner: every screen, and the part of it in view. Press or drag to go there.
function MiniMap({ lay, list, view, box, sel, onCentre }) {
  const b = box.current?.getBoundingClientRect();
  if (!b) return null;
  const k = Math.min(168 / lay.w, 132 / lay.h), W = Math.round(lay.w * k), H = Math.round(lay.h * k);
  const vx = (-view.x / view.k) * k, vy = (-view.y / view.k) * k, vw = (b.width / view.k) * k, vh = (b.height / view.k) * k;
  if (vx <= 0 && vy <= 0 && vx + vw >= W && vy + vh >= H) return null; // all of it is in view already
  const cx = clamp(vx, 0, W), cy = clamp(vy, 0, H), cw = clamp(vx + vw, 0, W) - cx, ch = clamp(vy + vh, 0, H) - cy;
  const at = (e) => { const r = e.currentTarget.getBoundingClientRect(); onCentre((e.clientX - r.left) / k, (e.clientY - r.top) / k); };
  return (<div className="sc-mini" style={sx({ width: `${W}px`, height: `${H}px` })} aria-hidden="true"
    onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); at(e); }} onPointerMove={(e) => e.buttons === 1 && at(e)}>
    <svg width={W} height={H}>
      {list.map((s) => { const a = lay.pos[s.id]; return (<rect key={s.id} x={a.x * k} y={a.y * k} width={a.w * k} height={a.h * k} rx="1.5" className={cn(sel === s.id && 'on')} />); })}
      {cw > 0 && ch > 0 && (<rect className="vp" x={cx} y={cy} width={cw} height={ch} rx="2" />)}
    </svg>
  </div>);
}

// One screen: its name with Frame by frame and Preview on top, its picture (a long page folded, unfolding to its whole
// length), and what it's made of underneath.
function ScreenCard({ s, at, sel, hl, ready, catOf, enter, onHover, onFold, onHl, onComp, onAssemble, onPreview, onPick }) {
  const k = at.k, slim = at.w < 360; // a phone's card is narrow: its two actions as icons
  const open = at.pic >= at.full;
  return (<div className={cn('sc', sel && 'sel', enter >= 0 && 'enter')} data-id={s.id} style={sx({ left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, ...(enter >= 0 ? { animationDelay: `${Math.min(enter, 10) * 55}ms` } : {}) })} onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}>
    <div className="sc-h">
      {s.group && s.stages > 1 ? (<span className="sc-stage" title={`Stage ${s.stage} of ${s.stages} of ${s.group.name}`}>{s.stage}/{s.stages}</span>) : (<Icon n={s.group ? 'app-window' : s.steps.length ? 'cursor-click' : 'browser'} />)}<b className="trunc" title={s.name}>{s.name}</b><span className="grow"></span>
      {slim ? (<>
        <Tip tip="Frame by frame"><Button variant="secondary" size="icon" aria-label="Frame by frame" onClick={onAssemble}><Icon n="stack" size={16} /></Button></Tip>
        <Tip tip={ready ? 'Preview: live, in this state' : 'Run this version to preview it live'}><Button variant="secondary" size="icon" aria-label="Preview" aria-disabled={!ready} onClick={() => ready && onPreview()}><Icon n="play" size={16} /></Button></Tip>
      </>) : (<>
        <Button variant="secondary" size="compact" leadingIcon={ph('stack')} onClick={onAssemble}>Frame by frame</Button>
        <Tip tip={ready ? 'Live, in this state' : 'Run this version to preview it live'}><Button variant="secondary" size="compact" leadingIcon={ph('play')} aria-disabled={!ready} onClick={() => ready && onPreview()}>Preview</Button></Tip>
      </>)}
    </div>
    <div className="sc-pw">
      <div className="sc-pic" role="button" tabIndex={0} aria-pressed={sel} aria-label={`${s.name}: what it’s made of`} style={sx({ height: `${at.pic}px` })}
        onKeyDown={(e) => { if (e.key === 'Enter') onPick(); if (e.key === ' ') { e.preventDefault(); onAssemble(); } }} onDoubleClick={() => ready && onPreview()}>
        <img src={img(s.thumb)} alt="" draggable="false" loading="lazy" style={sx({ height: `${at.full}px` })} />
        {hl && hl.map((r, i) => (<span key={i} className="sc-hl" style={sx({ left: `${r[0] * k}px`, top: `${r[1] * k}px`, width: `${r[2] * k}px`, height: `${r[3] * k}px` })} />))}
        {(s.sections || []).map((x, i) => x.y * k < at.pic - 24 && (<span key={`sec${i}`} className="sc-sm" style={sx({ top: `${x.y * k}px` })}><b>{x.name}</b></span>))}
        {at.folds && !open && (<span className="sc-fade" aria-hidden="true" />)}
      </div>
      {at.folds && (<button type="button" className={cn('sc-unfold', open && 'open')} onClick={onFold} aria-expanded={open}><Icon n="caret-down" size={13} />{open ? 'Fold it' : `Whole page · ${num(s.h)} px`}</button>)}
    </div>
    <InFrame s={s} catOf={catOf} onHl={onHl} onComp={onComp} />
  </div>);
}

// What a screen is made of, by kind: Buttons 4 · Inputs 2 · Text 6…; a chip lights where that part drew.
function InFrame({ s, catOf, onHl, onComp }) {
  const groups = useMemo(() => {
    const by = new Map();
    for (const n of s.tree) { if (!by.has(n.n)) by.set(n.n, []); by.get(n.n).push(n.r); }
    const cats = new Map();
    for (const [name, rs] of by) { const c = catOf(name); if (!cats.has(c)) cats.set(c, []); cats.get(c).push({ name, rs }); }
    const out = KINDS.filter((k) => cats.has(k) && k !== 'Layout').map((k) => ({ k, label: SHORT[k] || k, items: cats.get(k) }));
    if (textOn(s).length) out.push({ k: 'Text', label: 'Text', items: textOn(s).map((t) => ({ name: `${px(t.size)} · ${t.weight}`, title: `${t.family} ${t.size}/${t.lh}: “${t.sample}”`, rs: [t.r], text: true })) });
    if (cats.has('Layout')) out.push({ k: 'Layout', label: 'Layout', items: cats.get('Layout') });
    return out;
  }, [s, catOf]);
  const [k, setK] = useState(null);
  const cur = groups.find((g) => g.k === k) || groups[0];
  if (!cur) return (<div className="sc-sub"><span className="tiny muted">No components of the app’s own on this screen.</span></div>);
  const shown = cur.items.slice(0, 10);
  return (<div className="sc-sub">
    <span className="sc-k">In this frame</span>
    <div className="sc-tabs" role="tablist" aria-label={`In ${s.name}`}>
      {groups.map((g) => (<button key={g.k} type="button" role="tab" aria-selected={g === cur} className={cn('sc-tab', g === cur && 'on')} onClick={() => setK(g.k)}>{g.label}<span className="num">{g.items.length}</span></button>))}
    </div>
    <div className="sc-chips">
      {shown.map((it) => (<button key={it.name} type="button" className="sc-chip" title={it.title || `${it.name}: in the design system`}
        onPointerEnter={() => onHl(it.rs)} onPointerLeave={() => onHl(null)} onFocus={() => onHl(it.rs)} onBlur={() => onHl(null)} onClick={() => onComp(it.text ? '#type' : it.name)}>
        <span className="trunc">{it.name}</span>{!it.text && it.rs.length > 1 && (<span className="num muted">×{it.rs.length}</span>)}
      </button>))}
      {cur.items.length > shown.length && (<span className="tiny muted sc-more">+{cur.items.length - shown.length} more</span>)}
    </div>
  </div>);
}

// The click that leads from one screen to the next: a ring on what was clicked, and a line with corners from the
// screen's edge to the next one's name, ending in an arrow. Lines leaving one screen share a trunk beside it; the
// click's words sit at the end, by the screen it leads to. Hovering a screen lights its lines; picking one lights
// the whole trail of clicks that gets there.
function Links({ list, pos, sel, hov, trail }) {
  const ps = Object.values(pos), W = Math.max(...ps.map((a) => a.x + a.w)) + PAD, H = Math.max(...ps.map((a) => a.y + a.h)) + PAD;
  const links = list.filter((s) => s.from && pos[s.from] && pos[s.id]).map((s) => {
    const a = pos[s.from], b = pos[s.id], r = s.trigger?.r || [0, 0, 0, 0];
    const tx = a.x + (r[0] + r[2] / 2) * a.k, ty = a.y + HEAD + clamp((r[1] + r[3] / 2) * a.k, 8, a.pic - 8);
    const x0 = a.x + a.w, ex = b.x - 3, ey = b.y + HEAD / 2 - 4, mx = x0 + 36, dy = ey - ty;
    const rr = Math.min(14, Math.abs(dy) / 2), dir = Math.sign(dy);
    const d = Math.abs(dy) < 2 ? `M${x0},${ty} H${ex}` : `M${x0},${ty} H${mx - rr} Q${mx},${ty} ${mx},${ty + dir * rr} V${ey - dir * rr} Q${mx},${ey} ${mx + rr},${ey} H${ex}`;
    const st = trail.has(s.id) ? 'trail' : (hov && (hov === s.id || hov === s.from)) || (sel && (sel === s.id || sel === s.from)) ? 'on' : '';
    const word = s.trigger?.advance ? `Next · “${(s.trigger?.label || '').slice(0, 16)}”` : `${s.trigger?.role === 'tab' ? 'Tab' : s.trigger?.role === 'link' ? 'Link' : 'Click'} “${s.trigger?.label || ''}”`;
    return { s, tx, ty, x0, d, ex, ey, st, word };
  }).sort((a, b) => !!a.st - !!b.st); // lit lines on top
  return (<>
    <svg className="hx-edges sc-links" width={W} height={H} aria-hidden="true">
      <defs>{['', 'on'].map((m) => (<marker key={m} id={`sc-ah${m}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1,1.5 L8.5,5 L1,8.5" className={cn('sc-ah', m)} /></marker>))}</defs>
      {links.map((l) => (<g key={l.s.id} className={cn(l.st)}>
        {l.st && (<path className="sc-tail" d={`M${l.tx},${l.ty} H${l.x0}`} />)}
        <path d={l.d} markerEnd={`url(#sc-ah${l.st ? 'on' : ''})`} /><circle cx={l.tx} cy={l.ty} r="5" />
      </g>))}
    </svg>
    {links.map((l) => (<span key={l.s.id} className={cn('sc-why', l.st)} style={sx({ left: `${l.ex - 10}px`, top: `${l.ey - 7}px` })} title={l.s.trigger?.label}>{l.word}</span>))}
  </>);
}

// A picked screen: how to get there (each step a way back to its screen), every part in it (outermost first) and its text styles.
function ScreenPanel({ s, list, live, comps, onHl, onAssemble, onPreview, onComp, onGo, onClose }) {
  const ready = live?.status === 'ready';
  const path = []; for (let x = list.find((y) => y.id === s.from); x; x = list.find((y) => y.id === x.from)) path.unshift(x);
  return (<aside className="hx-panel" aria-label={s.name}>
    <div className="hx-ph"><Icon n="browser" /><b className="trunc">{s.name}</b><span className="grow"></span><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={onClose}><Icon n="x" size={15} /></Button></div>
    <div className="hx-pb">
      <div className="col" style={sx('gap:4px')}><h2>{s.name}</h2><p className="small muted">{s.sections?.length ? `${plural(s.sections.length, 'section')} · ` : ''}{plural(s.tree.length, 'part')} · {num(s.h)} px long</p></div>
      <div className="hx-acts">
        <Button variant="primary" size="compact" leadingIcon={ph('stack')} onClick={() => onAssemble(0)}>Frame by frame</Button>
        <Button variant="secondary" size="compact" leadingIcon={ph('play')} aria-disabled={!ready} onClick={() => ready && onPreview()}>Preview</Button>
        {ready && (<Button variant="secondary" size="compact" leadingIcon={ph('arrow-square-out')} render={<a href={screenUrl(live, s)} target="_blank" rel="noopener" />}>Open</Button>)}
      </div>
      <div className="col" style={sx('gap:8px')}><span className="hx-k">How to get here</span>
        <ol className="sc-steps small">
          <li>{path[0] ? (<button type="button" className="sc-stepb" onClick={() => onGo(path[0].id)}>Open the app</button>) : 'Open the app'}</li>
          {s.steps.map((st, i) => { const at = path[i + 1]; const w = st.go ? `Go to ${st.go}` : `${st.role === 'tab' ? 'Pick the tab' : st.advance ? 'Next:' : 'Click'} “${st.label}”`; return (<li key={i}>{at ? (<button type="button" className="sc-stepb" onClick={() => onGo(at.id)}>{w}</button>) : w}</li>); })}
        </ol>
      </div>
      {s.sections?.length > 0 && (<div className="col" style={sx('gap:6px')}><span className="hx-k">Sections, top to bottom</span>
        <div className="sc-secs">{s.sections.map((x, i) => (<button key={i} type="button" className="sc-sec" onPointerEnter={() => onHl([[0, x.y, s.w, x.h]])} onPointerLeave={() => onHl(null)} onFocus={() => onHl([[0, x.y, s.w, x.h]])} onBlur={() => onHl(null)}>
          <Crop s={s} r={[0, x.y, s.w, x.h]} maxW={88} maxH={56} pad={0} /><span className="col" style={sx('gap:1px;min-width:0')}><span className="small trunc">{x.name}</span><span className="tiny muted num">{num(x.h)} px</span></span>
        </button>))}</div>
      </div>)}
      <div className="col" style={sx('gap:6px')}><span className="hx-k">Made of, outermost first</span>
        <FluidList className="sc-tree">{s.tree.map((n, i) => (<FluidItem key={i} index={i} className="sc-node" style={sx({ paddingLeft: `${8 + n.d * 14}px` })} title={comps.find((c) => c.name === n.n)?.path}
          onPointerEnter={() => onHl([n.r])} onPointerLeave={() => onHl(null)} onFocus={() => onHl([n.r])} onBlur={() => onHl(null)} onClick={() => onAssemble(i)}>
          <span className="trunc">{n.n}</span><span className="tiny muted trunc">{words(n.props) || n.t}</span>
        </FluidItem>))}</FluidList>
      </div>
      {textOn(s).length > 0 && (<div className="col" style={sx('gap:6px')}><span className="hx-k">Text styles</span>
        {textOn(s).map((t) => (<button key={styleKey(t)} type="button" className="sc-ts" onPointerEnter={() => onHl([t.r])} onPointerLeave={() => onHl(null)} onClick={() => onComp('#type')}>
          <span className="small num">{px(t.size)} / {px(t.lh)} · {t.weight}</span><span className="tiny muted trunc">{t.family} · “{t.sample}”</span>
        </button>))}
      </div>)}
    </div>
  </aside>);
}

// Back and forth between screens from inside a stage (Frame by frame, Preview), without closing it.
function ScreenNav({ list, s, onScreen }) {
  const i = list.findIndex((x) => x.id === s.id), prev = list[i - 1], next = list[i + 1];
  useEffect(() => {
    const f = (e) => { if (e.target.closest?.('input, textarea')) return; const back = e.key === '[' || (e.shiftKey && e.key === 'ArrowLeft'), fwd = e.key === ']' || (e.shiftKey && e.key === 'ArrowRight'); if (back && prev) { e.preventDefault(); e.stopImmediatePropagation(); onScreen(prev); } if (fwd && next) { e.preventDefault(); e.stopImmediatePropagation(); onScreen(next); } };
    addEventListener('keydown', f, true);
    return () => removeEventListener('keydown', f, true);
  }, [i]);
  if (list.length < 2) return null;
  return (<span className="sn" role="group" aria-label="Screens">
    <Tip tip={prev ? `Previous screen: ${prev.name}` : 'The first screen'} kbd="["><Button variant="ghost" size="icon-compact" aria-label="Previous screen" aria-disabled={!prev} onClick={() => prev && onScreen(prev)}><Icon n="caret-left" size={15} /></Button></Tip>
    <span className="small num muted">Screen {i + 1} of {list.length}</span>
    <Tip tip={next ? `Next screen: ${next.name}` : 'The last screen'} kbd="]"><Button variant="ghost" size="icon-compact" aria-label="Next screen" aria-disabled={!next} onClick={() => next && onScreen(next)}><Icon n="caret-right" size={15} /></Button></Tip>
  </span>);
}

// Frame by frame: the screen dimmed, and its parts lit one at a time in the order React built them; the parts already
// shown stay outlined, so the screen's skeleton draws itself.
// Frame by frame: the screen's parts one by one, outermost first. Point at the picture to pick the part under the
// pointer; beside it, why it looks like this (its file's last change and the ask behind it) and a way to change it.
function Assemble({ p, sha, edit, s, at = 0, list, comps, onScreen, onComp, onClose }) {
  const nodes = s.tree;
  const [i, setI] = useState(clamp(at, 0, Math.max(0, nodes.length - 1)));
  const [play, setPlay] = useState(false);
  const [w, setW] = useState(0);
  const stage = useRef(), rows = useRef(), box = useRef();
  const [ask, setAsk] = useState(null); // a request to Claude about the part, being written
  useEffect(() => { const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(stage.current); return () => ro.disconnect(); }, []);
  useEffect(() => { if (!play) return; const t = setInterval(() => setI((x) => { if (x >= nodes.length - 1) { setPlay(false); return x; } return x + 1; }), 700); return () => clearInterval(t); }, [play]);
  const k = w ? Math.min(1, (w - 48) / s.w) : 0.5;
  const n = nodes[i];
  useEffect(() => {
    rows.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
    if (n && stage.current) { const top = n.r[1] * k, st = stage.current; if (top < st.scrollTop + 40 || top > st.scrollTop + st.clientHeight - 80) st.scrollTo({ top: Math.max(0, top - 120), behavior: still() ? 'auto' : 'smooth' }); }
  }, [i, k]);
  useEffect(() => {
    const f = (e) => {
      if (e.target.closest?.('input, textarea') || e.shiftKey) return; // typing a request isn't moving through the parts
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setPlay(false); setI((x) => Math.min(nodes.length - 1, x + 1)); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setPlay(false); setI((x) => Math.max(0, x - 1)); }
      else if (e.key === 'Home') setI(0);
      else if (e.key === 'End') setI(nodes.length - 1);
      else if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); setPlay((v) => !v); }
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, [nodes.length]);
  const trail = []; for (let j = i; j >= 0 && nodes[j]; j = nodes[j].p) trail.unshift(nodes[j].n);
  const comp = n && comps.find((c) => c.name === n.n);
  const why = useFetch(comp?.file && p ? `/projects/${p.id}/history/${sha}/why?file=${encodeURIComponent(comp.file)}` : null);
  const drawn = n ? (s.values || []).filter((v) => v.at.some((a) => a.c === n.n)).slice(0, 8) : []; // what this part draws with
  const skey = (s.steps || []).map((x) => x.go || x.label).join(' › '); // this screen, the same across walks
  const fb = useFetch(n && p ? `/projects/${p.id}/history/${sha}/feedback?key=${encodeURIComponent(skey)}&comp=${encodeURIComponent(n.n)}` : null, ['comment']);
  const [draft, setDraft] = useState('');
  const part = () => (n ? { kind: 'part', screen: s.id, key: skey, comp: n.n, file: comp?.file || null } : null); // a comment pinned here closes when a walk shows the part changed
  const note = async () => {
    try { await api('/comments', { method: 'POST', body: { target_type: 'version', target_id: `${p.id}:${sha}`, body: draft.trim(), region: part() } }); setDraft(''); fb.reload(); toast('Noted on this part', { sub: 'It closes by itself when a walk shows the part changed.' }); } catch (e) { fail(e); }
  };
  const pick = (e) => { // the part under the pointer: the smallest box there
    const b = e.currentTarget.getBoundingClientRect(), x = (e.clientX - b.left) / k, y = (e.clientY - b.top) / k;
    let best = -1;
    nodes.forEach((m, j) => { const [l, t, ww, hh] = m.r; if (x >= l && x <= l + ww && y >= t && y <= t + hh && (best < 0 || ww * hh <= nodes[best].r[2] * nodes[best].r[3])) best = j; });
    if (best >= 0) { setPlay(false); setI(best); }
  };
  useEffect(() => { if (ask !== null) setTimeout(() => box.current?.focus(), 30); }, [ask === null]);
  const send = async () => {
    try {
      const r = await api('/comments', { method: 'POST', body: { target_type: 'version', target_id: `${p.id}:${sha}`, body: ask, region: part() } });
      if (r.claude_error) throw new Error(r.claude_error);
      setAsk(null); fb.reload();
      toast(`${r.agent || 'Claude'} is on it`, { sub: 'It works in the project’s folder and saves it as a new version. Follow it in Versions.' });
    } catch (e) { fail(e); }
  };
  const toggle = () => { if (!play && i >= nodes.length - 1) setI(0); setPlay(!play); };
  return (<div className="hx-stage fp" role="dialog" aria-modal="true" aria-label={`${s.name}, frame by frame`}>
    <div className="hx-stage-bar">
      <b className="trunc">{s.name}</b><span className="small muted fa-sub">Frame by frame</span><span className="grow"></span>
      <ScreenNav list={list} s={s} onScreen={onScreen} />
      <span className="sn-sep" aria-hidden="true" />
      <span className="small muted num">Part {nodes.length ? i + 1 : 0} of {nodes.length}</span>
      <Tip tip="Previous part" kbd="←"><Button variant="ghost" size="icon" aria-label="Previous part" onClick={() => { setPlay(false); setI(Math.max(0, i - 1)); }}><Icon n="arrow-left" size={16} /></Button></Tip>
      <Tip tip={play ? 'Pause' : 'Play it through'} kbd="Space"><Button variant="ghost" size="icon" aria-label={play ? 'Pause' : 'Play'} onClick={toggle}><Icon n={play ? 'pause' : 'play'} swap size={16} /></Button></Tip>
      <Tip tip="Next part" kbd="→"><Button variant="ghost" size="icon" aria-label="Next part" onClick={() => { setPlay(false); setI(Math.min(nodes.length - 1, i + 1)); }}><Icon n="arrow-right" size={16} /></Button></Tip>
      <Tip tip="Close" kbd="Esc"><Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><Icon n="x" size={16} /></Button></Tip>
    </div>
    <div className="fp-body">
      <div className="hx-stage-b fa-stage" ref={stage}>
        <div className="fa-pic fa-pick" style={sx({ width: `${s.w * k}px`, height: `${s.h * k}px` })} onClick={pick} title="Point at a part to see what it is and why">
          <img src={img(s.shot)} alt={s.name} draggable="false" />
          <svg viewBox={`0 0 ${s.w} ${s.h}`} className="fa-svg" aria-hidden="true">
            <defs><mask id="fa-m"><rect width={s.w} height={s.h} fill="white" />{n && (<rect className="fa-hole" x={n.r[0] - 3} y={n.r[1] - 3} width={n.r[2] + 6} height={n.r[3] + 6} rx="6" fill="black" />)}</mask></defs>
            <rect className="fa-dim" width={s.w} height={s.h} mask="url(#fa-m)" />
            {nodes.slice(0, i).map((m, j) => (<rect key={j} className="fa-past" x={m.r[0]} y={m.r[1]} width={m.r[2]} height={m.r[3]} rx="3" vectorEffect="non-scaling-stroke" />))}
            {n && (<rect className="fa-now" x={n.r[0] - 3} y={n.r[1] - 3} width={n.r[2] + 6} height={n.r[3] + 6} rx="6" vectorEffect="non-scaling-stroke" />)}
          </svg>
          {n && (<span className="fa-tag" style={sx({ left: `${Math.max(0, n.r[0] * k - 3)}px`, top: `${Math.max(0, n.r[1] * k - 30)}px` })}>{n.n}</span>)}
        </div>
      </div>
      <aside className="fp-side">
        {n ? (<div className="col" style={sx('gap:6px')}>
          <span className="tiny muted trunc">{trail.slice(0, -1).join(' › ') || 'The screen itself'}</span>
          <h2 className="fa-name">{n.n}</h2>
          {comp && (<span className="small mono muted trunc">{comp.path}{comp.exported ? '' : ' · kept inside the file'}</span>)}
          {words(n.props) && (<span className="small ink2">{words(n.props)}</span>)}
          {n.t && (<span className="small muted">“{n.t}”</span>)}
          <span className="tiny muted num">{n.r[2]} × {n.r[3]} at {n.r[0]}, {n.r[1]}{n.c ? ' · under something else here' : ''}</span>
          <div className="row" style={sx('gap:6px;margin-top:6px')}><Button variant="secondary" size="compact" leadingIcon={ph('swatches')} onClick={() => onComp(n.n)}>In the design system</Button></div>
        </div>) : (<p className="small muted">None of the app’s own components drew on this screen. Its picture is still here, and the next screen may have some: <b>]</b> moves on.</p>)}
        {n && (<div className="col fa-fb" style={sx('gap:8px')}>
          <span className="hx-k">Feedback on this part</span>
          {(fb.data || []).map((c) => { const ev = c.region?.evidence; return (<div key={c.id} className={cn('fa-note', c.status !== 'open' && 'done')}>
            <span className="small"><b>{c.author_name}</b> {said(c.body.replace(/^@(claude|trace)\s*/i, ''), 200)}</span>
            {ev ? (<>
              <span className="tiny ink2">Closed on evidence, walked {rel(ev.at)}: {ev.changed.slice(0, 3).join('; ')}</span>
              <span className="fa-ba"><span className="col" style={sx('gap:2px')}><span className="tiny muted">Before</span><Crop s={{ shot: ev.before.shot, w: ev.before.w, h: ev.before.h }} r={ev.before.r} maxW={130} maxH={70} /></span><span className="col" style={sx('gap:2px')}><span className="tiny muted">After</span><Crop s={{ shot: ev.after.shot, w: ev.after.w, h: ev.after.h }} r={ev.after.r} maxW={130} maxH={70} /></span></span>
            </>) : (<span className="tiny muted">{c.status === 'open' ? 'Open: it closes when a walk shows this part changed' : 'Closed by hand'}</span>)}
          </div>); })}
          {edit && (<form className="row" style={sx('gap:6px')} onSubmit={(e) => { e.preventDefault(); note(); }}><Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`A note on ${n.n}…`} aria-label="A note on this part" /><Button variant="secondary" size="compact" disabled={!draft.trim()}>Note</Button></form>)}
        </div>)}
        {n && comp && (<div className="col fa-why" style={sx('gap:6px')}>
          <span className="hx-k">Why it looks like this</span>
          {why.data?.file !== comp.file ? (<p className="small muted">Looking up its last change…</p>)
            : !why.data.last ? (<p className="small muted">Its file has no saved version yet.</p>)
            : why.data.last.sha === 'now' ? (<p className="small ink2">{comp.path} has edits not saved as a version yet.</p>)
            : (<p className="small ink2"><span className="num">{why.data.last.short}</span> by <b>{why.data.last.agent || why.data.last.who}</b>, {rel(why.data.last.when)}{why.data.last.asked ? <>, asked “{said(why.data.last.asked, 140)}”</> : <>: “{said(why.data.last.title, 100)}”</>}</p>)}
          {drawn.length > 0 && (<div className="fa-vals">{drawn.map((v) => (<span key={`${v.prop}|${v.v}`} className="fa-val tiny" title={`${v.prop} ${v.v}`}>{/^(color|background|border)$/.test(v.prop) ? <i className="fa-sw" style={sx({ background: v.v })} /> : null}{v.prop === 'color' ? 'text' : v.prop === 'background' ? 'fill' : v.prop}{/^(radius|space)$/.test(v.prop) ? ` ${v.v}` : ''}</span>))}</div>)}
          {edit && (<div className="row" style={sx('gap:6px')}><Button variant="secondary" size="compact" leadingIcon={ph('at')} onClick={() => setAsk(`@claude On the screen “${s.name}”, change ${n.n} (${comp.path}${n.t ? `, the part that reads “${said(n.t, 40)}”` : ''}): `)}>Change it</Button></div>)}
        </div>)}
        {ask === null && (<div className="col" style={sx('gap:6px;min-height:0')}>
          <span className="hx-k">How it’s built</span>
          <div ref={rows}><FluidList className="fa-list">{nodes.map((m, j) => (<FluidItem key={j} index={j} aria-current={j === i ? 'step' : undefined} className={cn('fa-row', j < i && 'done', j === i && 'on')} style={sx({ paddingLeft: `${8 + m.d * 14}px` })} onClick={() => { setPlay(false); setI(j); }}>
            <span className="trunc">{m.n}</span>{(words(m.props) || m.t) && (<span className="tiny muted trunc">{words(m.props) || `“${m.t}”`}</span>)}
          </FluidItem>))}</FluidList></div>
        </div>)}
        {ask !== null && (<div className="ck-ask fa-ask">
          <span className="tiny muted trunc">To Claude, about: {n?.n}</span>
          <Textarea ref={box} rows={4} value={ask} onChange={(e) => setAsk(e.target.value)} aria-label="What to ask Claude" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); if (e.key === 'Escape') { e.stopPropagation(); setAsk(null); } }} />
          <div className="ck-acts"><Button variant="primary" size="compact" onClick={send}>Send to Claude</Button><Button variant="ghost" size="compact" onClick={() => setAsk(null)}>Cancel</Button></div>
        </div>)}
      </aside>
    </div>
  </div>);
}

// Preview: the version running, opened in this screen's state (its clicks replayed), live from there. When the
// clicks don't land or the app stops answering, it says so where you're looking and offers the way out.
function LivePreview({ s, list, live, edit, w0, acts, onScreen, onPicture, onClose }) {
  const [w, setW] = useState(w0);
  const [n, setN] = useState(0);
  const [landed, setLanded] = useState(!s.steps.length);
  const [trouble, setTrouble] = useState(null); // 'clicks' | 'slow'
  const frame = useRef();
  const ready = live?.status === 'ready';
  const src = useMemo(() => (ready ? screenUrl(live, s) : null), [s, live?.url, ready]);
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  useEffect(() => {
    if (landed || !ready) return;
    const t = setTimeout(() => { setLanded(true); setTrouble('slow'); }, 9000);
    const f = (e) => { if (e.source === frame.current?.contentWindow && e.data?.trace === 'replayed') { clearTimeout(t); setLanded(true); if (!e.data.ok) setTrouble('clicks'); } };
    addEventListener('message', f);
    return () => { clearTimeout(t); removeEventListener('message', f); };
  }, [n, ready]);
  const again = () => { setTrouble(null); setLanded(!s.steps.length); setN(n + 1); };
  return (<div className="hx-stage" role="dialog" aria-modal="true" aria-label={`${s.name}, live`}>
    <div className="hx-stage-bar">
      <b className="trunc">{s.name}</b><span className={cn('small', landed && ready ? 'lp-live' : 'muted')}>{!ready ? 'Not running' : landed ? 'Live' : `Opening it: ${s.steps.map((x) => `“${x.label}”`).join(', then ')}`}</span><span className="grow"></span>
      <ScreenNav list={list} s={s} onScreen={onScreen} />
      <Seg size="compact" label="Width" value={w} onChange={setW} options={DEVICES} />
      <Tip tip="Start it over"><Button variant="ghost" size="icon" aria-label="Start it over" aria-disabled={!ready} onClick={() => ready && again()}><Icon n="arrow-clockwise" size={16} /></Button></Tip>
      {src && (<Tip tip="Open in a new tab"><Button variant="ghost" size="icon" aria-label="Open in a new tab" render={<a href={src} target="_blank" rel="noopener" />}><Icon n="arrow-square-out" size={16} /></Button></Tip>)}
      <Tip tip="Close" kbd="Esc"><Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><Icon n="x" size={16} /></Button></Tip>
    </div>
    {(trouble || !ready) && (<div className="lp-note small" role="status">
      <Icon n={!ready ? 'plugs' : 'warning-circle'} />
      <span className="grow">{!ready ? (live?.status === 'starting' ? 'The app is starting again; this opens once it runs.' : 'The app stopped running, so there’s nothing live to show.') : trouble === 'clicks' ? 'Some of the clicks that reach this screen didn’t land here (this browser remembers the app differently, an intro it has seen). This is as close as it got.' : 'It’s taking long to open: the app may still be loading.'}</span>
      {!ready ? (edit && live?.status !== 'starting' && (<Button variant="secondary" size="compact" leadingIcon={ph('play')} onClick={() => acts.run()}>Run it again</Button>))
        : (<><Button variant="secondary" size="compact" onClick={again}>Start it over</Button>{src && (<Button variant="ghost" size="compact" render={<a href={src} target="_blank" rel="noopener" />}>New tab</Button>)}</>)}
      <Button variant="ghost" size="compact" onClick={onPicture}>See its picture</Button>
    </div>)}
    <div className="hx-stage-b">{src ? (<iframe key={n} ref={frame} src={src} title={`${s.name}, running`} style={sx({ width: w ? `${w}px` : '100%' })} />) : (<div className="lp-off"><img src={img(s.thumb)} alt={s.name} /></div>)}</div>
  </div>);
}

// ---------- Design system: the colours and the rest of the tokens, text styles, and every component ----------
function Crop({ s, r, maxW = 320, maxH = 140, pad = 8, least = 0 }) { // least: never smaller than this, a long thin part cut at the side instead of shrunk to a sliver
  const x = Math.max(0, r[0] - pad), y = Math.max(0, r[1] - pad), cw = Math.min(s.w - x, r[2] + pad * 2), ch = Math.min(s.h - y, r[3] + pad * 2);
  const k = Math.max(Math.min(1, maxW / cw, maxH / ch), Math.min(least, maxH / ch));
  return (<span className="ds-crop" style={sx({ width: `${Math.round(Math.min(cw * k, maxW))}px`, height: `${Math.round(Math.min(ch * k, maxH))}px`, backgroundImage: `url(${img(s.shot)})`, backgroundSize: `${s.w * k}px ${s.h * k}px`, backgroundPosition: `${-x * k}px ${-y * k}px` })} />);
}

// A colour as #rrggbb (what a person copies), read by drawing it: the browser turns lab(), oklch() and the rest into sRGB.
let pen = null;
const hexOf = (c) => {
  if (!c) return null;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  pen ||= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  pen.clearRect(0, 0, 1, 1); pen.fillStyle = '#000'; pen.fillStyle = c; pen.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b, ...(a < 250 ? [a] : [])].map((x) => x.toString(16).padStart(2, '0')).join('')}`; // see-through: #rrggbbaa
};
const solid = (hex, ground = '#ffffff') => { // a see-through colour as it shows on its ground
  if (!/^#[0-9a-f]{8}$/i.test(hex || '')) return hex;
  const a = parseInt(hex.slice(7, 9), 16) / 255, g = /^#[0-9a-f]{6}/i.test(ground) ? ground : '#ffffff';
  return `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * a + parseInt(g.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
};
const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => { if (!/^#/.test(a || '') || !/^#/.test(b || '')) return null; const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const inkOn = (c, ground) => { c = solid(c, ground); return /^#/.test(c || '') && lum(c) < 0.4 ? '#fff' : '#111'; }; // words that read on a swatch (a see-through one as it sits on its ground)

// One colour you can copy: a click puts its #hex on the clipboard and says so with a tick, then turns back.
function useCopied() {
  const [done, setDone] = useState(null);
  const copyIt = async (key, text) => { try { await navigator.clipboard.writeText(text); setDone(key); setTimeout(() => setDone((d) => (d === key ? null : d)), 1200); } catch { toast('Couldn’t copy; select it by hand.', { error: true }); } };
  return [done, copyIt];
}

// Colours: its scales as ramps (gray 100 → 1000, one strip each), and its named colours (background, primary, border…)
// as cards with their #hex, and how well text reads on them. In its light or its dark theme, on that theme's ground.
function Colours({ ts, hasDark, texts }) {
  const [theme, setTheme] = useState('light');
  const [done, copyIt] = useCopied();
  const val = (t) => hexOf(theme === 'dark' ? t.dark || t.light : t.light);
  const by = useMemo(() => new Map(ts.map((t) => [t.name, t])), [ts]);
  const { scales, named } = useMemo(() => {
    const g = new Map();
    for (const t of ts) { const m = t.name.match(/^--(.+?)-?(\d+)$/); const key = m ? m[1] : null; if (!key) continue; if (!g.has(key)) g.set(key, []); g.get(key).push({ t, step: +m[2] }); }
    const scales = [...g].filter(([, xs]) => xs.length >= 3).map(([k, xs]) => [k, xs.sort((a, b) => a.step - b.step)]);
    const inScale = new Set(scales.flatMap(([, xs]) => xs.map((x) => x.t.name)));
    return { scales, named: ts.filter((t) => !inScale.has(t.name) && !/-foreground$|-fg$/.test(t.name)) };
  }, [ts]);
  const ground = theme === 'dark' ? val(by.get('--background') || by.get('--ds-background-100') || by.get('--bg') || {}) || '#0a0a0a' : val(by.get('--background') || by.get('--ds-background-100') || by.get('--bg') || {}) || '#ffffff';
  const textHex = useMemo(() => new Set((texts || []).map((t) => hexOf(t.color))), [texts]);
  const name = (t) => t.name.replace(/^--/, '');
  return (<section id="ds-colours" className="ds-sec">
    <div className="ds-sh"><h2>Colours <span className="muted num">{ts.length}</span></h2><span className="grow"></span>
      {hasDark && (<Seg size="compact" label="Theme" value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]} />)}</div>
    <p className="small muted">Read from its CSS{hasDark ? `, in its ${theme} theme` : ''}. Click a colour to copy its hex.</p>
    {scales.length > 0 && (<div className={cn('ds-pal', theme)} style={sx({ background: ground })}>
      {scales.map(([k, xs]) => (<div key={k} className="ds-ramp-row">
        <span className="ds-rl mono" style={sx({ color: inkOn(ground) })}>{k}<span>{xs.length} steps</span></span>
        <div className="ds-ramp">{xs.map(({ t, step }) => { const hex = val(t), key = `${theme}${t.name}`; return (
          <button key={t.name} type="button" className={cn('ds-cell', done === key && 'copied')} style={sx({ background: hex, color: inkOn(hex, ground) })} onClick={() => copyIt(key, hex)} aria-label={`${name(t)} ${hex}: copy`}
            title={`${name(t)} · ${hex}${ratio(hex, '#ffffff') ? ` · ${ratio(hex, '#ffffff').toFixed(1)}:1 on white` : ''}`}>
            <span className="ds-step num">{step}</span><span className="ds-hex mono">{done === key ? (<><Icon n="check" size={11} />Copied</>) : hex}</span>
          </button>); })}</div>
      </div>))}
    </div>)}
    {named.length > 0 && (<div className="ds-named">{named.map((t) => {
      const hex = val(t), fg = by.get(`${t.name}-foreground`) || (t.name === '--background' && by.get('--foreground')), fgHex = fg && val(fg), key = `${theme}${t.name}`;
      const on = solid(hex, ground), ink = !fgHex && /^#/.test(on || '') ? (ratio(on, '#ffffff') >= ratio(on, '#111111') ? '#ffffff' : '#111111') : null; // no text colour of its own: the better of white or dark text on it
      const r = fgHex ? ratio(solid(fgHex, on), on) : ink && ratio(ink, on);
      return (<button key={t.name} type="button" className={cn('ds-nc', done === key && 'copied')} onClick={() => copyIt(key, hex)} aria-label={`${name(t)} ${hex}: copy`}>
        <span className="ds-nsw" style={sx({ background: hex, color: fgHex || inkOn(hex, ground) })}>{fgHex ? (<span className="ds-aa2">Aa</span>) : null}{done === key && (<span className="ds-ok"><Icon n="check" size={14} /></span>)}</span>
        <span className="ds-nf"><b className="mono trunc">{name(t)}</b><span className="mono tiny muted">{hex}</span>
          <span className="ds-tags">{r && (<span className={cn('ds-ratio', r >= 4.5 ? 'aa' : r >= 3 ? 'large' : 'low')} title={fgHex ? `${name(fg)} on it` : `${ink === '#ffffff' ? 'White' : 'Dark'} text on it`}>{fgHex ? 'Its text' : ink === '#ffffff' ? 'White text' : 'Dark text'} {r.toFixed(1)}:1 {r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'large only' : 'too low'}</span>)}{textHex.has(hex) && (<span className="ds-used-t">text</span>)}</span>
        </span>
      </button>);
    })}</div>)}
  </section>);
}

// Every component the code defines, as a gallery: each as it shows on its screens, by kind. Pick one for its states,
// its code and where it's used, further down.
function Gallery({ kinds, inst, onOpen }) {
  const [k, setK] = useState('All');
  const all = kinds.flatMap((g) => g.cs.map((c) => ({ c, k: g.k })));
  const shown = k === 'All' ? all : all.filter((x) => x.k === k);
  return (<section id="ds-components" className="ds-sec">
    <div className="ds-sh"><h2>Components <span className="muted num">{all.length}</span></h2></div>
    <p className="small muted">Every component in its code (buttons, navigation, inputs, sliders, overlays…) as it shows on the screens. Pick one for every state, its code and where it’s used.</p>
    <div className="ds-filter" role="tablist" aria-label="Kind">{['All', ...kinds.map((g) => g.k)].map((x) => (<button key={x} type="button" role="tab" aria-selected={x === k} className={cn('sc-tab', x === k && 'on')} onClick={() => setK(x)}>{SHORT[x] || x}<span className="num">{x === 'All' ? all.length : kinds.find((g) => g.k === x).cs.length}</span></button>))}</div>
    <div className="ds-gal">{shown.map(({ c, k: kind }) => {
      const xs = inst.get(c.name) || [], best = xs.find((x) => !x.n.c && x.n.r[2] * x.n.r[3] < 1280 * 700) || xs.find((x) => !x.n.c), on = new Set(xs.map((x) => x.s.id)).size;
      return (<button key={c.id} type="button" className="ds-g" onClick={() => onOpen(c)}>
        <span className="ds-gp">{best ? (<Crop s={best.s} r={best.n.r} maxW={232} maxH={128} pad={6} least={0.55} />) : (<span className="ds-gx"><Icon n={KIND_ICON[kind] || 'cube'} size={22} /></span>)}</span>
        <span className="ds-gf"><b className="trunc">{c.name}</b><span className="tiny muted trunc">{SHORT[kind] || kind} · {on ? `on ${plural(on, 'screen')}` : c.exported ? 'not on a screen' : 'inside its file'}</span></span>
      </button>);
    })}</div>
  </section>);
}

// DESIGN.md and design.tokens.json from what runs (server/check.js `designDoc`), shown before anything is written.
function WriteDoc({ p, sha, onClose }) {
  const [doc, setDoc] = useState(null), [pick, setPick] = useState('DESIGN.md'), [busy, setBusy] = useState(false);
  useEffect(() => { api(`/projects/${p.id}/history/${sha}/design-doc`, { method: 'POST' }).then(setDoc).catch((e) => { fail(e); onClose(); }); }, []);
  const drop = () => { for (const x of doc?.files || []) api(`/ai/files/${x.proposal}`, { method: 'DELETE' }).catch(() => {}); onClose(); };
  const write = async () => { setBusy(true); try { for (const x of doc.files) await api(`/ai/files/${x.proposal}`, { method: 'POST' }); toast('Wrote DESIGN.md and design.tokens.json', { sub: `In ${p.name}’s folder. Agents read them; Trace writes them again when you ask.` }); onClose(); } catch (e) { fail(e); setBusy(false); } };
  const f = doc?.files.find((x) => x.path === pick);
  return (<Dialog title="DESIGN.md and design tokens" size="lg" onClose={drop} footer={<><Button variant="ghost" onClick={drop}>Cancel</Button><Button variant="primary" aria-disabled={!doc || busy} onClick={() => doc && !busy && write()}>{doc?.files.some((x) => x.exists) ? 'Replace both files' : 'Write both files'}</Button></>}>
    {!doc ? (<p className="small muted">Reading the walk and the code…</p>) : (<div className="col" style={sx('gap:12px')}>
      <p className="small ink2">Written from what runs: the colours its own code declares, the type and spacing its screens use, its components and their states, its decisions, and what was tried and undone. Agents read DESIGN.md before they change the app; the tokens are DTCG, for Figma and other tools. Nothing is written until you say so.</p>
      <Seg size="compact" label="File" value={pick} onChange={setPick} options={doc.files.map((x) => ({ value: x.path, label: x.path }))} />
      {f.exists && (<p className="small" style={sx('color:var(--warn)')}>A {f.path} is already in the folder: this replaces it.</p>)}
      <pre className="wd-pre">{f.content}</pre>
    </div>)}
  </Dialog>);
}
function DesignSystem({ p, sha, d, code, live, focus, walking, edit, onScreen }) {
  const [writing, setWriting] = useState(false);
  const list = d?.screens || [];
  const comps = code?.components || [];
  const tokens = d?.tokens?.tokens || [];
  const [preview, setPreview] = useState(null);
  const [codeOf, setCodeOf] = useState(null);
  const [now, setNow] = useState(null); // the section in view, lit in the bar
  const doc = useRef();
  const inst = useMemo(() => { const m = new Map(); for (const s of list) s.tree.forEach((n, i) => { if (!m.has(n.n)) m.set(n.n, []); m.get(n.n).push({ s, n, i }); }); return m; }, [d]);
  const kinds = useMemo(() => KINDS.map((k) => ({ k, cs: comps.filter((c) => c.cat === k).sort((a, b) => (inst.get(b.name)?.length || 0) - (inst.get(a.name)?.length || 0) || a.name.localeCompare(b.name)) })).filter((g) => g.cs.length), [code, inst]);
  const type = useMemo(() => (d?.type || []).map((t) => ({ ...t, s: list.find((x) => x.id === t.s) })).filter((t) => t.s), [d]); // its type scale, read by the server off every screen
  const by = (kind) => tokens.filter((t) => t.kind === kind);
  const scrollTo = (id) => doc.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'start' });
  useEffect(() => { if (focus) setTimeout(() => scrollTo(focus.name === '#type' ? 'ds-type' : `ds-c-${focus.name}`), 60); }, [focus?.at]);
  const canStates = code?.app?.kind === 'vite' && live?.status === 'ready';
  const found = [by('color').length && ['ds-colours', 'Colours'], type.length && ['ds-type', 'Type'], by('radius').length && ['ds-radii', 'Radii'], by('shadow').length && ['ds-shadows', 'Shadows'], by('space').length && ['ds-space', 'Spacing'], by('motion').length && ['ds-motion', 'Motion']].filter(Boolean);
  const parts = [['ds-components', 'All'], ...kinds.map((g) => [`ds-k-${g.k.replace(/\W+/g, '-')}`, SHORT[g.k] || g.k, g.cs.length])];
  useEffect(() => { // which section is in view
    const root = doc.current; if (!root) return;
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setNow(v.target.id); }, { root, rootMargin: '-56px 0px -70% 0px' });
    root.querySelectorAll('.ds-sec[id]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [d, code]);
  const item = ([id, label, n]) => (<button key={id} type="button" className={cn('ds-toc-i', now === id && 'on')} aria-current={now === id ? 'location' : undefined} onClick={() => scrollTo(id)}>{label}{n != null && (<span className="num">{n}</span>)}</button>);
  return (<><div className="ds" ref={doc}>
    <nav className="ds-toc" aria-label="On this page">
      {found.length > 0 && (<span className="ds-toc-g"><span className="ds-toc-k">Foundations</span>{found.map(item)}</span>)}
      {comps.length > 0 && (<span className="ds-toc-g"><span className="ds-toc-k">Components</span>{parts.map(item)}</span>)}
    </nav>
    <div className="ds-in">
      <header className="ds-head"><div className="ds-headrow"><h1>Design system</h1>{edit && d?.screens?.length > 0 && (<Button variant="secondary" size="compact" leadingIcon={ph('file-text')} onClick={() => setWriting(true)}>Write DESIGN.md</Button>)}</div><p className="ink2">Read from {code?.app?.name || 'the app'} as it runs: the tokens in its CSS, the text styles on its screens, and its {plural(comps.length, 'component')}{d?.tokens?.dark ? ', in its light and dark themes' : ''}.</p></header>
      {!tokens.length && !type.length && (<p className="small muted ds-note">{walking ? 'Walking the app for its tokens and text styles…' : 'Walk the app (Screens) to read its tokens and text styles.'}</p>)}
      {by('color').length > 0 && (<Colours ts={by('color')} hasDark={!!d?.tokens?.dark} texts={type} />)}
      {type.length > 0 && (<section id="ds-type" className="ds-sec"><h2>Type <span className="muted num">{type.length}</span></h2><p className="small muted">Its type scale: the styles its screens use again and again, named by what they do. One-off sizes, prices, counts and chart labels aren’t type, and a size that only differs by a fraction (fluid type) is one style.</p>
        <div className="ds-type">{type.map((t) => (<div key={styleKey(t)} className="ds-tr">
          <button type="button" className="ds-fig" onClick={() => onScreen(t.s)} title={`On ${t.s.name}`}><Crop s={t.s} r={t.r} maxW={460} maxH={72} pad={4} /></button>
          <div className="col" style={sx('gap:2px;min-width:0')}><b className="small">{t.role}</b><span className="small num ink2">{px(t.size)} / {px(t.lh)} · {t.weight}{t.tt !== 'none' ? ` · ${t.tt}` : ''}</span><span className="tiny muted trunc">{t.family}{t.ls !== 'normal' ? ` · ${t.ls} tracking` : ''} · used {t.count}×</span></div>
        </div>))}</div>
        {by('font').length > 0 && (<div className="ds-rows">{by('font').map((t) => (<div key={t.name} className="ds-row"><span className="mono small">{t.name}</span><span className="ds-aa" style={sx({ fontFamily: t.value })}>Aa</span><span className="small muted trunc">{t.value}</span></div>))}</div>)}
      </section>)}
      {by('radius').length > 0 && (<section id="ds-radii" className="ds-sec"><h2>Radii</h2><div className="ds-tiles">{by('radius').map((t) => (<span key={t.name} className="ds-tile"><i className="ds-rad" style={sx({ borderRadius: t.value })} /><span className="tiny mono trunc">{t.name.replace(/^--/, '')}</span><span className="tiny muted">{t.value}</span></span>))}</div></section>)}
      {by('shadow').length > 0 && (<section id="ds-shadows" className="ds-sec"><h2>Shadows</h2><div className="ds-tiles">{by('shadow').map((t) => (<span key={t.name} className="ds-tile"><i className="ds-shd" style={sx({ boxShadow: t.value })} /><span className="tiny mono trunc">{t.name.replace(/^--/, '')}</span></span>))}</div></section>)}
      {by('space').length > 0 && (<section id="ds-space" className="ds-sec"><h2>Spacing</h2><div className="ds-rows">{by('space').map((t) => (<div key={t.name} className="ds-row"><span className="mono small trunc">{t.name.replace(/^--/, '')}</span><i className="ds-bar" style={sx({ width: `min(${t.value}, 100%)` })} /><span className="small muted">{t.value}</span></div>))}</div></section>)}
      {by('motion').length > 0 && (<section id="ds-motion" className="ds-sec"><h2>Motion</h2><div className="ds-rows">{by('motion').map((t) => (<div key={t.name} className="ds-row"><span className="mono small trunc">{t.name.replace(/^--/, '')}</span><span className="small muted trunc">{ease(t.value)}</span></div>))}</div></section>)}
      {by('other').length > 0 && (<details className="ds-sec ds-more"><summary className="small">{plural(by('other').length, 'other variable')}</summary><div className="ds-rows">{by('other').map((t) => (<div key={t.name} className="ds-row"><span className="mono small trunc">{t.name}</span><span className="small muted trunc">{t.value}</span></div>))}</div></details>)}
      {kinds.length > 0 && (<Gallery kinds={kinds} inst={inst} onOpen={(c) => scrollTo(`ds-c-${c.name}`)} />)}
      {kinds.map((g) => (<section key={g.k} id={`ds-k-${g.k.replace(/\W+/g, '-')}`} className="ds-sec"><h2>{g.k} <span className="muted num">{g.cs.length}</span></h2>
        {g.cs.map((c) => (<DsComp key={c.id} c={c} inst={inst.get(c.name) || []} live={live} canStates={canStates && c.exported} onScreen={onScreen} onPreview={() => setPreview(c)} onCode={() => setCodeOf(c)} />))}
      </section>))}
    </div></div>
    {codeOf && (<aside className="hx-panel" aria-label={codeOf.name}>
      <div className="hx-ph"><Icon n="code" /><b className="trunc">{codeOf.name}</b><span className="grow"></span><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={() => setCodeOf(null)}><Icon n="x" size={15} /></Button></div>
      <div className="hx-pb"><FileView p={p} sha={sha} path={codeOf.file} onBack={null} /></div>
    </aside>)}
    {preview && live?.status === 'ready' && (<FramePreview f={preview} live={live} onClose={() => setPreview(null)} />)}
    {writing && (<WriteDoc p={p} sha={sha} onClose={() => setWriting(false)} />)}
  </>);
}

// One component: its real appearances on the screens (each distinct set of props once), every state when it can stand
// alone, and where it's used.
function DsComp({ c, inst, live, canStates, onScreen, onPreview, onCode }) {
  const seen = [], keys = new Set();
  for (const x of inst.filter((y) => !y.n.c)) { const key = JSON.stringify(x.n.props) + (Object.keys(x.n.props).length ? '' : x.n.t); if (!keys.has(key) && seen.length < 6) { keys.add(key); seen.push(x); } }
  const screens = [...new Map(inst.map((x) => [x.s.id, x.s])).values()];
  return (<article className="ds-c" id={`ds-c-${c.name}`}>
    <header className="ds-ch"><b>{c.name}</b><span className="tiny mono muted trunc">{c.path}</span><span className="grow"></span>
      {canStates && (<Button variant="ghost" size="compact" leadingIcon={ph('play-circle')} onClick={onPreview}>States and motion</Button>)}
      <Button variant="ghost" size="compact" leadingIcon={ph('code')} onClick={onCode}>Code</Button>
    </header>
    {seen.length > 0 && (<div className="ds-inst">{seen.map((x) => (<button key={`${x.s.id}:${x.i}`} type="button" className="ds-fig" onClick={() => onScreen(x.s, x.i)} title={`On ${x.s.name}: frame by frame`}>
      <Crop s={x.s} r={x.n.r} /><span className="tiny muted trunc">{words(x.n.props) || (x.n.t ? `“${x.n.t}”` : 'as drawn')}</span>
    </button>))}</div>)}
    {canStates && (<StatesFrame live={live} c={c} />)}
    {!c.exported && (<p className="tiny muted">Kept inside {c.path.split('/').pop()}, so it isn’t drawn on its own: {seen.length ? 'these are its real appearances.' : 'it shows on the screens that use it.'}</p>)}
    {!seen.length && (<p className="tiny muted">{inst.length ? 'Under something else (a sheet, a menu) wherever the walk saw it.' : 'Not on a screen the walk reached.'}</p>)}
    {screens.length > 0 && (<div className="ds-used"><span className="tiny muted">Used in</span>{screens.map((s) => (<button key={s.id} type="button" className="hx-pill fr-chip" onClick={() => onScreen(s)}>{s.name}</button>))}</div>)}
  </article>);
}

// Every state of a part, drawn by the version's own dev server when it scrolls near.
function StatesFrame({ live, c }) {
  const ref = useRef(), frame = useRef();
  const [on, setOn] = useState(false);
  const [h, setH] = useState(180);
  const [err, setErr] = useState(null);
  useEffect(() => { const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { rootMargin: '400px' }); io.observe(ref.current); return () => io.disconnect(); }, []);
  useEffect(() => { const f = (e) => { if (e.source !== frame.current?.contentWindow) return; if (e.data?.trace === 'size') setH(Math.min(960, e.data.h + 4)); if (e.data?.trace === 'error') setErr(e.data.message); }; addEventListener('message', f); return () => removeEventListener('message', f); }, []);
  return (<div ref={ref} className="ds-states" style={sx({ height: `${h}px` })}>
    {on ? (<iframe ref={frame} src={partUrl(live, c, 'states')} title={`${c.name}, every state`} />) : (<span className="fr-wait"><ThinkingIndicator /></span>)}
    {err && (<span className="fr-err" title={err}><Icon n="warning-circle" />Needs its app around it</span>)}
  </div>);
}

// Every state at once, and the motion in it: slowed, paused, scrubbed, replayed, the states animating between.
const SPEEDS = [{ value: 0.25, label: '¼×' }, { value: 0.5, label: '½×' }, { value: 1, label: '1×' }];
function FramePreview({ f, live, onClose }) {
  const frame = useRef();
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [cycle, setCycle] = useState(false);
  const [t, setT] = useState(0);
  const [motion, setMotion] = useState([]);
  const send = (cmd, v) => frame.current?.contentWindow?.postMessage({ trace: 'cmd', cmd, v }, '*');
  useEffect(() => { const h = (e) => { if (e.source === frame.current?.contentWindow && e.data?.trace === 'motion') setMotion(e.data.list); }; addEventListener('message', h); return () => removeEventListener('message', h); }, []);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === ' ' && !e.target.closest('input, button')) { e.preventDefault(); toggle(); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); });
  const end = Math.max(600, ...motion.map((m) => (m.delay || 0) + (m.duration || 0) * (typeof m.iterations === 'number' ? Math.min(m.iterations, 3) : 1)));
  const toggle = () => { send(playing ? 'pause' : 'play'); setPlaying(!playing); };
  return (<div className="hx-stage fp" role="dialog" aria-modal="true" aria-label={`${f.name}: states and motion`}>
    <div className="hx-stage-bar">
      <b className="trunc">{f.name}</b><span className="small muted mono trunc">{f.path}</span><span className="grow"></span>
      <Seg size="compact" label="Speed" value={speed} onChange={(v) => { setSpeed(v); send('speed', v); }} options={SPEEDS} />
      <Tip tip={playing ? 'Pause' : 'Play'} kbd="Space"><Button variant="ghost" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}><Icon n={playing ? 'pause' : 'play'} swap size={16} /></Button></Tip>
      <Tip tip="Replay from the start"><Button variant="ghost" size="icon" aria-label="Replay" onClick={() => { send('replay'); setPlaying(true); setT(0); }}><Icon n="arrow-counter-clockwise" size={16} /></Button></Tip>
      <Tip tip="Close" kbd="Esc"><Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><Icon n="x" size={16} /></Button></Tip>
    </div>
    <div className="fp-body">
      <div className="hx-stage-b fp-stage"><iframe ref={frame} src={partUrl(live, f, 'states')} title={`${f.name}, every state`} onLoad={() => { setPlaying(true); setT(0); if (speed !== 1) setTimeout(() => send('speed', speed), 300); if (cycle) setTimeout(() => send('cycle', true), 300); }} /></div>
      <aside className="fp-side">
        <div className="col" style={sx('gap:10px')}>
          <span className="hx-k">Scrub</span>
          <input type="range" className="fp-scrub" min="0" max={end} step="10" value={t} aria-label="Time in the animation" onChange={(e) => { const v = +e.target.value; setT(v); setPlaying(false); send('seek', v); }} />
          <span className="tiny muted num">{Math.round(t)} ms of {Math.round(end)} ms{playing ? '' : ' · paused'}</span>
        </div>
        <label className="row small" style={sx('gap:10px;justify-content:space-between')}><span>Animate between states<span className="block tiny muted">Hover, focus and pressed switch on and off, so their transitions play.</span></span><Switch checked={cycle} onCheckedChange={(v) => { setCycle(v); send('cycle', v); }} /></label>
        <div className="col" style={sx('gap:8px')}>
          <span className="hx-k">Motion · {motion.length}</span>
          {!motion.length && (<p className="small muted">Nothing has moved yet. Hover the Default column, or switch on “Animate between states”.</p>)}
          {motion.map((m, i) => (<div key={i} className="fp-mo">
            <div className="row" style={sx('gap:6px;min-width:0')}><b className="small trunc">{m.name}</b><span className="grow"></span><span className="tiny muted">{m.kind}</span></div>
            <span className="tiny mono ink2">{m.duration} ms{m.delay ? ` · after ${m.delay} ms` : ''}{m.iterations && m.iterations !== 1 ? ` · ×${m.iterations}` : ''} · {ease(m.easing)}</span>
            {m.target && (<span className="tiny muted mono trunc">{m.target}</span>)}
          </div>))}
          <p className="tiny muted">Lists CSS animations, transitions and Web Animations (Motion uses these when it can). Spring motion run in JavaScript slows and pauses with the controls but can’t be scrubbed.</p>
        </div>
      </aside>
    </div>
  </div>);
}

// ---------- Packages: what the app needs to run, and which of it is installed ----------
function Packages({ p, edit }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/history/packages`, ['history'], (t, d) => d.project_id === p.id && !!d.install && d.install !== 'running');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState('');
  const [ask, setAsk] = useState(null); // a fix that changes package.json waits for a yes, in the app's own dialog
  useEffect(() => onLive((t, d) => { if (t === 'history' && d.project_id === p.id && d.install) { setBusy(d.install === 'running'); if (d.step) setLine(d.step); if (d.install === 'done') toast('Packages installed'); if (d.install === 'failed') toast('The install didn’t finish', { error: true, sub: d.log, ms: 12000 }); } }), [p.id]);
  if (error) return (<div className="hx-msg"><ErrorBox error={error} retry={reload} /></div>);
  if (!data) return (<Gate><ThinkingIndicator /><p>Reading its package.json…</p></Gate>);
  const running = busy || data.installing;
  const install = (add) => api(`/projects/${p.id}/history/install`, { method: 'POST', body: add ? { add } : {} }).then((r) => { setBusy(true); setLine(`Starting: ${r.command || data.command}`); }).catch(fail);
  const fix = (c) => (c.fix.action === 'install' ? install() : setAsk(c));
  const last = data.last;
  const hard = data.conflicts.filter((c) => !c.soft), settled = data.conflicts.filter((c) => c.soft);
  return (<div className="ds"><div className="ds-in">
    <header className="ds-head"><h1>Packages</h1>
      <p className="ink2">{data.missing ? `${plural(data.missing, 'package')} the app needs ${data.missing === 1 ? 'isn’t' : 'aren’t'} installed in the folder yet. Running it installs ${data.missing === 1 ? 'it' : 'them'} first, by itself.` : hard.length ? `Everything is installed, with ${plural(hard.length, 'conflict')} to look at.` : 'Everything the app needs is installed in the folder, and nothing stops it running.'}</p>
      {edit && (<div className="row wrap" style={sx('gap:8px;margin-top:4px')}>
        <Button variant={data.missing ? 'primary' : 'secondary'} size="compact" leadingIcon={ph(running ? 'circle-notch' : 'download-simple')} aria-disabled={running} onClick={() => !running && install()}>{running ? 'Installing…' : data.missing ? 'Install what’s missing' : 'Install again'}</Button>
        <span className="small muted">with {data.manager}, into this folder only. Trace’s own toolchain runs it, so nothing installed on this computer changes; a conflict gets the usual fix by itself.</span>
      </div>)}
      {running && (<p className="pk-line small mono" role="status"><ThinkingIndicator />{line || 'Installing…'}</p>)}
    </header>
    {settled.length > 0 && (<details className="ds-sec ds-more"><summary className="small">{plural(settled.length, 'version difference')} settled by itself: the app runs with what’s installed</summary>
      <div className="pk-conf">{settled.map((c, i) => (<div key={`${c.name}${c.by}${i}`} className="pk-c"><Icon n="check-circle" /><div className="col grow" style={sx('gap:2px;min-width:0')}><b className="small mono">{c.name}</b><span className="small ink2">{c.text}</span></div></div>))}</div>
    </details>)}
    {hard.length > 0 && (<section className="ds-sec">
      <h2>Conflicts <span className="muted small">· {hard.length}</span></h2>
      <div className="pk-conf">{hard.map((c, i) => (<div key={`${c.kind}${c.name}${i}`} className="pk-c">
        <Icon n={c.kind === 'peer' ? 'link-break' : c.kind === 'version' && c.have ? 'arrows-left-right' : 'warning-circle'} />
        <div className="col grow" style={sx('gap:2px;min-width:0')}><b className="small mono">{c.name}</b><span className="small ink2">{c.text}</span></div>
        {edit && c.fix && (<Button variant="secondary" size="compact" aria-disabled={running} onClick={() => !running && fix(c)}>{c.fix.label}</Button>)}
      </div>))}</div>
    </section>)}
    {last && !running && (<section className="ds-sec">
      <h2>Last install <span className="muted small">· {last.ok ? 'worked' : 'didn’t finish'} {rel(last.at)}</span></h2>
      <ol className="pk-tries">{last.attempts.map((a, i) => (<li key={i} className={cn(a.ok ? 'ok' : 'no')}>
        <Icon n={a.ok ? 'check-circle' : 'x-circle'} /><div className="col" style={sx('gap:2px;min-width:0')}><span className="small">{a.how}</span><span className="tiny mono muted pk-cmd">{a.command}</span>{a.problems?.length > 0 && (<span className="small ink2">{a.problems.join(' · ')}</span>)}{a.tail && !a.problems?.length && (<span className="tiny mono muted pk-cmd">{a.tail}</span>)}</div>
      </li>))}</ol>
    </section>)}
    {ask && (<Dialog title={ask.fix.action === 'latest' ? `Use the newest ${ask.name}?` : `Install ${ask.name}@${ask.fix.range}?`} onClose={() => setAsk(null)}
      footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button><Button variant="primary" onClick={() => { const c = ask; setAsk(null); install({ name: c.name, dev: c.dev, ...(c.fix.action === 'latest' ? { latest: true } : { range: c.fix.range }) }); }}>Change and install</Button></>}>
      <p className="small">{ask.text}.</p>
      <p className="small muted">This changes {ask.name}’s version in {ask.where === '.' || !ask.where ? 'the repository’s' : `${ask.where}’s`} package.json{ask.fix.action === 'latest' ? ' to the newest published one' : ` to ${ask.fix.range}`}, then installs. It’s a change to the project: History shows it as unsaved, so you can save it as a version or roll it back.</p>
    </Dialog>)}
    {data.groups.map((g) => { const deps = [...g.deps].sort((a, b) => !!a.have - !!b.have || a.dev - b.dev || a.name.localeCompare(b.name)); return (<section key={g.where} className="ds-sec">
      <h2>{g.app ? 'The app' : 'The repository'} <span className="muted small mono">{g.where === '.' ? g.name : g.where}</span></h2>
      <table className="pk"><caption className="sr-only">Packages in {g.where}</caption>
        <thead><tr><th scope="col">Package</th><th scope="col">Wants</th><th scope="col">Installed</th></tr></thead>
        <tbody>{deps.map((x) => (<tr key={x.name}>
          <td className="mono small">{x.name}{x.dev && (<span className="tiny muted"> dev</span>)}</td>
          <td className="mono small muted">{x.want}</td>
          <td className={cn('small mono', !x.have && 'pk-miss')}>{x.have || 'Missing'}</td>
        </tr>))}</tbody>
      </table>
    </section>); })}
  </div></div>);
}
