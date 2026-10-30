// History: every version of the product on an endless canvas, oldest on the left, branches below the main line. A
// node is the version as it looks (its screenshot, or the app itself running in it), what was asked and who made it.
// Pick one and the panel beside it tells why it was made (Claude's reasoning and every step it took), shows what
// changed and every file as it was, and holds its thread: tag @claude there and Claude Code makes the change in the
// project's folder, live on the canvas, and lands as the next version. Run, download, roll back and push from here.
import { useState, useEffect, useRef, useMemo, useCallback, api, useFetch, onLive, Icon, Avatar, ErrorBox, Loading, Dialog, Field, Seg, Menu, Tip, toast, fail, copy, go, plural, rel, Button, ph, sx, cn } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ThinkingSteps, ThinkingStepsHeader, ThinkingStepsContent, ThinkingStep } from '@/components/ui/thinking-steps';
import { ThinkingIndicator } from '@/components/ui/thinking-indicator';
import { dayLabel, time, longDate } from './ncs.jsx';
import { FramesCanvas } from './frames.jsx';
import { AskButton } from './ask.jsx';

const W = 288, PH = 180, H = 316, GX = 72, GY = 84, PAD = 72, TOP = 32; // a node, the gaps, the margins
const FRAME = 1280; // the width a running version is drawn at inside its node
const MINK = 0.08; // zoomed this far out the whole history fits: a map of it
const NOW = 'now';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isAgent = (v) => !!v.agent;
const firstSentence = (s = '') => { const m = s.match(/^(.+?[.!?])(\s|$)([\s\S]*)$/); return m ? [m[1], m[3]] : [s, '']; };
const Ink = ({ t }) => String(t || '').split(/`([^`\n]+)`/).map((s, i) => (i % 2 ? (<code key={i} className="hx-ic">{s}</code>) : s)); // `code` the way the AI wrote it
const STEP_ICON = { read: 'square-library', edit: 'pencil', search: 'search', run: 'corner-down-right', say: 'message-circle', think: 'brain', tool: 'dot' };

// ---------- the canvas ----------
export function History({ p, switcher, sub, onSettings }) {
  const quiet = (d) => d.project_id === p.id && d.run?.status !== 'running'; // Claude's steps patch in place, not a reload
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/history`, ['history'], (t, d) => quiet(d));
  const [runs, setRuns] = useState({}); // Claude's runs in progress, patched from live events
  const [sel, setSel] = useState(sub && sub !== 'frames' ? sub : null);
  const [mode, setMode] = useState(sub === 'frames' ? 'frames' : 'versions'); // the versions, or one version's frontend as frames
  const [framesOf, setFramesOf] = useState(NOW);
  const [view, setView] = useState(null);
  const [glide, setGlide] = useState(false);
  const [fresh, setFresh] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [stage, setStage] = useState(null); // a running version, full screen
  const [composeFor, setComposeFor] = useState(0); // bumped to focus the thread's box with "@claude "
  const box = useRef(), drag = useRef(null), first = useRef(true);
  const edit = p.can_edit;

  useEffect(() => { if (data) setRuns(Object.fromEntries(data.runs.map((r) => [r.id, r]))); }, [data]);
  useEffect(() => onLive((t, d) => {
    if (t !== 'history' || d.project_id !== p.id) return;
    if (d.run?.steps) setRuns((rs) => ({ ...rs, [d.run.id]: { ...(rs[d.run.id] || { status: 'running', created_at: Date.now() }), ...d.run } }));
    if (d.run?.status && d.run.status !== 'running') {
      setRuns((rs) => { const n = { ...rs }; delete n[d.run.id]; return n; });
      const who = d.run.agent || 'Claude';
      if (d.run.status === 'failed') toast(`${who} couldn’t finish: ${d.run.error || 'it stopped.'}`, { error: true, ms: 12000 });
      if (d.run.sha) { setFresh(d.run.sha); setSel(d.run.sha); toast(`${who} saved a new version`, { sub: 'It’s on the canvas, with what you asked and why.' }); }
      else if (d.run.status === 'done') { setSel((s) => (s === d.run.id ? d.run.target : s)); toast(`${who} answered without changing any files`, { sub: d.run.reply || 'Its answer is in the thread.', ms: 9000 }); }
    }
    if (d.sha && !d.run) setFresh(d.sha);
    if (d.install === 'done') toast('Packages installed. Run a version now.');
    if (d.install === 'failed') toast('Installing the packages failed', { error: true, sub: d.log?.split('\n').filter(Boolean).slice(-2).join(' '), ms: 12000 });
  }), [p.id]);
  useEffect(() => { if (fresh) { const t = setTimeout(() => setFresh(null), 1600); return () => clearTimeout(t); } }, [fresh]);
  useEffect(() => { const h = `/p/${p.id}/history${mode === 'frames' ? '/frames' : sel ? `/${sel}` : ''}`; if (location.hash.slice(1) !== h) history.replaceState(null, '', `#${h}`); }, [sel, mode]);

  // Layout: one column per version in time order across every lane, so branches line up with when they happened.
  const lay = useMemo(() => {
    if (!data?.git) return null;
    const vs = [...data.versions].reverse();
    const pos = {}, col = {};
    vs.forEach((v, i) => { col[v.sha] = i; pos[v.sha] = { x: PAD + i * (W + GX), y: TOP + PAD + v.lane * (H + GY) }; });
    const headLane = vs.find((v) => v.sha === data.head)?.lane ?? 0;
    let n = vs.length;
    const extra = [];
    if (data.changes.length) { pos[NOW] = { x: PAD + n * (W + GX), y: TOP + PAD + headLane * (H + GY) }; extra.push(NOW); n++; }
    const pending = Object.values(runs).filter((r) => r.status === 'running');
    pending.forEach((r) => { pos[r.id] = { x: PAD + n * (W + GX), y: TOP + PAD + headLane * (H + GY) }; n++; });
    const lanes = data.lanes.filter((l) => vs.some((v) => v.lane === l.id));
    const days = vs.filter((v, i) => i === 0 || new Date(v.when).toDateString() !== new Date(vs[i - 1].when).toDateString()).map((v) => ({ sha: v.sha, x: pos[v.sha].x, label: longDate(v.when) }));
    return { vs, pos, lanes, days, pending, headLane, w: PAD * 2 + n * (W + GX), h: TOP + PAD * 2 + Math.max(1, lanes.length) * (H + GY) };
  }, [data, runs]);

  const panelW = (open = sel) => (open && innerWidth > 900 ? 440 : 0);
  const centerOn = useCallback((id, k) => { // the panel is open whenever something is picked, so centre in what's left
    const b = box.current?.getBoundingClientRect(), at = lay?.pos[id];
    if (!b || !at) return;
    setView((v) => { const z = k || v?.k || 1; return { k: z, x: (b.width - panelW(true)) / 2 - (at.x + W / 2) * z, y: b.height / 2 - 40 - (at.y + H / 2) * z }; });
  }, [lay]);
  const smooth = (fn) => { if (!still()) { setGlide(true); clearTimeout(smooth.t); smooth.t = setTimeout(() => setGlide(false), 460); } fn(); };
  useEffect(() => { // open on where the product stands now (or on the version in the link)
    if (!lay || !box.current || !first.current) return;
    first.current = false;
    const b = box.current.getBoundingClientRect();
    const target = (sub && lay.pos[sub]) ? sub : null;
    if (target) return centerOn(target, 1);
    const last = lay.pos[order.at(-1)] || { x: 0 };
    const x = b.width < 600 ? (b.width - W) / 2 - last.x : Math.min(PAD / 2, b.width - 48 - (last.x + W));
    setView({ k: 1, x, y: Math.max(0, (b.height - 140 - lay.h) / 2) });
  }, [lay]);
  useEffect(() => { if (fresh && lay?.pos[fresh]) smooth(() => centerOn(fresh)); }, [fresh, lay]);
  const newest = lay?.pending.at(-1)?.id;
  useEffect(() => { if (newest) smooth(() => centerOn(newest)); }, [newest]); // Claude started: bring its node into view

  // Pan by dragging the ground or with the wheel; Ctrl + wheel, or two fingers pinching, zooms where they are.
  const fingers = useRef(new Map());
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('.hx-panel, .fab-bar, a, button') || (e.pointerType === 'mouse' && e.target.closest('.vnode'))) return;
    fingers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (!e.target.closest('.vnode')) e.currentTarget.setPointerCapture(e.pointerId); // on a node, its tap must still reach it
    setGlide(false);
    if (fingers.current.size === 2) { const [a, b] = [...fingers.current.values()]; drag.current = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), o: view, moved: true }; }
    else drag.current = { sx: e.clientX, sy: e.clientY, o: view, moved: false, on: e.target.closest('.vnode') };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || !fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (d.pinch) { // zoom about the middle of the two fingers
      const [a, b] = [...fingers.current.values()], r = box.current.getBoundingClientRect();
      const k = Math.max(MINK, Math.min(2, d.o.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / d.pinch)), cx = (a[0] + b[0]) / 2 - r.left, cy = (a[1] + b[1]) / 2 - r.top;
      return setView({ k, x: cx - ((cx - d.o.x) * k) / d.o.k, y: cy - ((cy - d.o.y) * k) / d.o.k });
    }
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 6) d.moved = true;
    if (d.moved) setView({ ...d.o, x: d.o.x + e.clientX - d.sx, y: d.o.y + e.clientY - d.sy });
  };
  const up = (e) => {
    fingers.current.delete(e.pointerId);
    const d = drag.current;
    if (d && !d.moved && !d.on) setSel(null); // a tap on the ground lets go; a tap on a node picks it (its own click)
    if (d?.moved) panned.current = true; // and a drag that began on a node doesn't pick it
    if (!fingers.current.size) drag.current = null;
  };
  const panned = useRef(false);
  const swallow = (e) => { if (panned.current) { panned.current = false; if (e.target.closest('.vnode')) e.stopPropagation(); } };
  const zoom = (f, e) => {
    if (!view) return;
    const k = Math.max(MINK, Math.min(2, view.k * f)), b = box.current.getBoundingClientRect();
    const cx = e ? e.clientX - b.left : (b.width - panelW()) / 2, cy = e ? e.clientY - b.top : b.height / 2;
    setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k });
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e) => { if (e.target.closest('.hx-panel, .hx-stage, iframe')) return; e.preventDefault(); setGlide(false); if (e.ctrlKey || e.metaKey) zoom(Math.exp(-e.deltaY * 0.0022), e); else setView((v) => v && ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) })); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const fit = () => smooth(() => { const b = box.current.getBoundingClientRect(); const k = Math.max(MINK, Math.min(1, (b.width - panelW() - 40) / lay.w, (b.height - 120) / lay.h)); setView({ k, x: (b.width - panelW() - lay.w * k) / 2, y: (b.height - 60 - lay.h * k) / 2 }); });

  // Arrows walk the versions in time order; Esc lets go; F fits; + and − zoom.
  const order = useMemo(() => (lay ? [...lay.vs.map((v) => v.sha), ...(lay.pos[NOW] ? [NOW] : []), ...lay.pending.map((r) => r.id)] : []), [lay]);
  useEffect(() => {
    const f = (e) => {
      if (e.target.closest?.('input, textarea, select, [role=dialog], .hx-stage') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { if (stage) setStage(null); else setSel(null); return; }
      if (!lay) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = order.indexOf(sel), j = sel == null ? order.length - 1 : Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
        setSel(order[j]); smooth(() => centerOn(order[j]));
      }
      if (e.key === 'f' || e.key === 'F') fit();
      if (e.key === '+' || e.key === '=') zoom(1.2);
      if (e.key === '-') zoom(1 / 1.2);
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  });

  const live = Object.fromEntries((data?.live || []).map((l) => [l.sha, l]));
  const runOne = async (sha) => {
    try {
      const r = await api(`/projects/${p.id}/history/${sha}/run`, { method: 'POST' });
      if (r?.install) setDlg({ kind: 'install' });
      reload();
    } catch (e) { fail(e); }
  };
  const stopOne = (sha) => api(`/projects/${p.id}/history/${sha}/stop`, { method: 'POST' }).then(reload).catch(fail);
  const askClaude = () => { const target = sel && !lay?.pending.some((r) => r.id === sel) ? sel : data.changes.length ? NOW : data.head; setSel(target); smooth(() => centerOn(target)); setComposeFor((n) => n + 1); };
  const pick = (id) => { // picking a node the panel would cover (or that's off screen) brings it into view
    if (id === sel) return setSel(null);
    setSel(id);
    const b = box.current.getBoundingClientRect(), at = lay.pos[id];
    const x = view.x + at.x * view.k, y = view.y + at.y * view.k;
    if (view.k < 0.6) smooth(() => centerOn(id, 1)); // picked from the map: go to it
    else if (x < 8 || x + W * view.k > b.width - panelW(true) - 16 || y < 8 || y + H * view.k > b.height - 90) smooth(() => centerOn(id));
  };

  const head = (<header className="hx-bar">
    <a className="back" href={`#/p/${p.id}`} aria-label={`Back to ${p.name}`} title="Timeline"><Icon n="arrow-left" /></a>
    <div className="pbar-t"><span className="meta">{data?.git ? plural(data.versions.length, 'version') : 'History'}</span><b className="trunc">{p.name}</b></div>
    {data?.git && (<div className="hx-mode"><Seg size="compact" label="Show" value={mode} onChange={setMode} options={[{ value: 'versions', label: 'Versions', icon: 'git-commit' }, { value: 'frames', label: 'Frames', icon: 'frame-corners' }]} /></div>)}
    {data?.git && mode === 'frames' && (<div className="hx-where"><span className="hx-pill"><Icon n="clock-counter-clockwise" />{framesOf === NOW ? 'The files as they are now' : `Version ${framesOf.slice(0, 7)} · ${data.versions.find((v) => v.sha === framesOf)?.title || ''}`}</span>{framesOf !== NOW && (<Button variant="ghost" size="compact" onClick={() => setFramesOf(NOW)}>Show now</Button>)}</div>)}
    {data?.git && mode === 'versions' && (<div className="hx-where">
      <span className="hx-pill" title={data.root}><Icon n="folder-simple" />{data.root?.split(/[\\/]/).pop()}</span>
      {data.branch && (<span className="hx-pill"><Icon n="git-branch" />{data.branch}</span>)}
      {data.remote ? (<span className={cn('hx-pill', data.ahead > 0 && 'warn')} title={data.url}>{data.ahead > 0 ? `${plural(data.ahead, 'version')} not pushed` : data.behind > 0 ? `${data.behind} behind ${data.upstream}` : `Up to date with ${data.upstream || data.remote}`}</span>)
        : (<span className="hx-pill muted">Not on a remote yet</span>)}
    </div>)}
    <span className="grow"></span>{switcher}
  </header>);

  if (error) return (<div className="hx">{head}<div className="hx-msg"><ErrorBox error={error} retry={reload} /></div></div>);
  if (loading && !data) return (<div className="hx">{head}<div className="hx-msg"><Loading h={320} /></div></div>);
  if (!data.dir) return (<div className="hx">{head}<Gate icon="folder-simple-plus" title="Link the project’s folder" body={`History reads the folder ${p.name}’s code lives in: every version, who made it, what they were asked and why.`} action={edit && (<Button variant="primary" onClick={onSettings}>Add the folder</Button>)} /></div>);
  if (!data.git) return (<div className="hx">{head}<StartGate p={p} data={data} edit={edit} reload={reload} /></div>);
  if (mode === 'frames') return (<div className="hx">{head}<FramesCanvas key={framesOf} p={p} sha={framesOf} edit={edit} live={live[framesOf]}
    title={framesOf === NOW ? p.name : data.versions.find((v) => v.sha === framesOf)?.title || framesOf.slice(0, 7)} /></div>);

  const node = sel && (sel === NOW ? { sha: NOW } : data.versions.find((v) => v.sha === sel));
  const pendingSel = sel && runs[sel];
  const curve = (a, b) => { const x1 = a.x + W, y1 = a.y + PH / 2, x2 = b.x, y2 = b.y + PH / 2, mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };
  const headPos = lay.pos[data.head];
  return (<div className="hx">
    {head}
    <div className="hx-canvas" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={swallow} aria-label="Versions: drag to move around, Ctrl + wheel to zoom, arrows to walk through versions">
      {!data.versions.length && !data.changes.length ? (<Gate icon="git-commit" title="No versions yet" body="Save what’s in the folder now as the first version." action={edit && (<Button variant="primary" onClick={() => setDlg({ kind: 'save' })}>Save the first version</Button>)} />) : view && (
      <div className={cn('hx-plane', glide && 'glide')} style={sx({ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: `${lay.w}px`, height: `${lay.h}px` })}>
        {lay.days.map((d) => (<span key={d.sha} className="hx-day" style={sx({ left: `${d.x}px`, top: `${TOP + PAD - 46}px` })}>{d.label}</span>))}
        <svg className="hx-edges" width={lay.w} height={lay.h} aria-hidden="true">
          {lay.vs.flatMap((v) => v.parents.filter((q) => lay.pos[q]).map((q, i) => (<path key={`${v.sha}${q}`} className={cn(i > 0 && 'merge', fresh === v.sha && 'enter')} pathLength="1" d={curve(lay.pos[q], lay.pos[v.sha])} />)))}
          {lay.pos[NOW] && headPos && (<path className="wip" d={curve(headPos, lay.pos[NOW])} />)}
          {lay.pending.map((r) => { const from = lay.pos[NOW] || headPos; return from && (<path key={r.id} className="wip go" d={curve(from, lay.pos[r.id])} />); })}
        </svg>
        {lay.vs.map((v) => (<VNode key={v.sha} pid={p.id} v={v} at={lay.pos[v.sha]} sel={sel === v.sha} head={v.sha === data.head} fresh={fresh === v.sha} live={live[v.sha]} onPick={() => pick(v.sha)} />))}
        {lay.pos[NOW] && (<NowNode pid={p.id} at={lay.pos[NOW]} n={data.changes.length} changes={data.changes} shot={data.nowShot} live={live[NOW]} sel={sel === NOW} onPick={() => pick(NOW)} />)}
        {lay.pending.map((r) => (<RunNode key={r.id} r={r} at={lay.pos[r.id]} sel={sel === r.id} onPick={() => pick(r.id)} />))}
      </div>)}
      {view && lay.lanes.length > 1 && lay.lanes.map((l) => { const y = view.y + (TOP + PAD + l.id * (H + GY) - 30) * view.k; return y > -20 && (<span key={l.id} className="hx-lane" style={sx({ top: `${y}px` })}><Icon n="git-branch" />{l.name}</span>); })}
      {node && (<Panel key={node.sha} p={p} data={data} v={node} live={live[node.sha]} edit={edit} compose={composeFor} onClose={() => setSel(null)} onRun={() => runOne(node.sha)} onStop={() => stopOne(node.sha)} onOpen={() => setStage(node.sha)} onFrames={() => { setFramesOf(node.sha); setMode('frames'); }} onDlg={setDlg} />)}
      {pendingSel && (<RunPanel p={p} r={pendingSel} edit={edit} onClose={() => setSel(null)} />)}
    </div>
    <div className="fab-bar hx-dock" role="toolbar" aria-label="History">
      {edit && (<button className="fab" onClick={askClaude} data-tip="Tag @claude on a version to change it"><Icon n="at" />Ask Claude</button>)}
      <AskButton />
      {edit && data.changes.length > 0 && (<Button variant="ghost" size="default" leadingIcon={ph('floppy-disk')} aria-label={`Save version: ${plural(data.changes.length, 'changed file')}`} onClick={() => setDlg({ kind: 'save' })}><span className="lbl">Save version</span><span className="hx-count">{data.changes.length}</span></Button>)}
      {edit && data.head && (<Button variant="ghost" size="default" leadingIcon={ph('cloud-arrow-up')} aria-label={data.ahead ? `Push ${plural(data.ahead, 'version')}` : 'Push'} onClick={() => setDlg({ kind: 'push' })}><span className="lbl">Push</span>{data.ahead > 0 && (<span className="hx-count">{data.ahead}</span>)}</Button>)}
      <div className="fab-2">
        <Tip tip="Zoom out" kbd="−"><Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => smooth(() => zoom(1 / 1.25))}><Icon n="minus" size={16} /></Button></Tip>
        <button className="hx-zoom num" onClick={() => smooth(() => zoom(1 / (view?.k || 1)))} aria-label="Zoom to 100%" data-tip="Zoom to 100%">{Math.round((view?.k || 1) * 100)}%</button>
        <Tip tip="Zoom in" kbd="+"><Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => smooth(() => zoom(1.25))}><Icon n="plus" size={16} /></Button></Tip>
        <Tip tip="Fit everything" kbd="F"><Button variant="ghost" size="icon" aria-label="Fit everything" onClick={fit}><Icon n="corners-out" size={16} /></Button></Tip>
      </div>
    </div>
    {stage && (<Stage p={p} sha={stage} v={stage === NOW ? { title: 'Not saved yet', short: 'now' } : data.versions.find((v) => v.sha === stage)} live={live[stage]} onClose={() => setStage(null)} />)}
    {dlg?.kind === 'save' && (<SaveDialog p={p} n={data.changes.length} onClose={() => setDlg(null)} onDone={(sha) => { setDlg(null); setFresh(sha); setSel(sha); reload(); }} />)}
    {dlg?.kind === 'push' && (<PushDialog p={p} data={data} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); }} />)}
    {dlg?.kind === 'rollback' && (<RollbackDialog p={p} v={dlg.v} dirty={data.changes.length} onClose={() => setDlg(null)} onDone={(sha) => { setDlg(null); setFresh(sha); setSel(sha); reload(); }} />)}
    {dlg?.kind === 'install' && (<InstallDialog p={p} onClose={() => setDlg(null)} />)}
  </div>);
}

// A version as a card on the canvas: how it looks, what it is, what was asked, who and when.
function VNode({ pid, v, at, sel, head, fresh, live, onPick }) {
  const asked = v.asked && v.asked.replace(/\s+/g, ' ');
  return (<div role="button" tabIndex={0} className={cn('vnode', sel && 'sel', fresh && 'enter', head && 'head')} style={sx({ left: `${at.x}px`, top: `${at.y}px`, width: `${W}px` })}
    onClick={onPick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())} aria-pressed={sel}
    aria-label={`${v.title}, by ${v.who}, ${dayLabel(v.when)} ${time(v.when)}${asked ? `. Asked: ${asked}` : ''}`}>
    <Preview pid={pid} sha={v.sha} live={live} shot={v.shot} v={v} />
    <span className="vbody">
      <span className="vt clamp2">{v.title}</span>
      {asked && (<span className="vasked clamp2"><Icon n="quotes" />{asked}</span>)}
      <span className="vmeta"><Avatar name={v.who} agent={isAgent(v)} /><span className="trunc">{v.agent || v.who}</span><span className="muted nowrap">· {dayLabel(v.when)} {time(v.when)}</span>
        <span className="grow"></span>{(v.add > 0 || v.del > 0) && (<span className="num vdelta"><span className="add">+{v.add}</span> <span className="del">−{v.del}</span></span>)}</span>
    </span>
    {(head || v.refs.length > 0 || v.comments > 0) && (<span className="vflags">{head && (<span className="vflag here">You’re here</span>)}{v.refs.filter((r) => !head || !/^(main|master)$/.test(r)).slice(0, 2).map((r) => (<span key={r} className="vflag"><Icon n={r.includes('/') ? 'cloud' : 'git-branch'} />{r}</span>))}{v.comments > 0 && (<span className="vflag"><Icon n="chat-circle" />{v.comments}</span>)}</span>)}
  </div>);
}
function NowNode({ pid, at, n, changes, shot, live, sel, onPick }) {
  return (<div role="button" tabIndex={0} className={cn('vnode now', sel && 'sel')} style={sx({ left: `${at.x}px`, top: `${at.y}px`, width: `${W}px` })} onClick={onPick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick())} aria-pressed={sel} aria-label={`Not saved yet: ${plural(n, 'changed file')}`}>
    <Preview pid={pid} sha={NOW} live={live} shot={shot} v={{ files: n, top: changes.slice(0, 4).map((c) => ({ path: c.path })) }} />
    <span className="vbody"><span className="vt">Not saved yet</span><span className="vmeta muted">{plural(n, 'file')} changed on disk since the last version</span></span>
  </div>);
}
// Claude at work: the node it will become, with what it's doing right now.
function RunNode({ r, at, sel, onPick }) {
  const last = (r.steps || []).filter((s) => s.kind !== 'think').at(-1);
  return (<div role="button" tabIndex={0} className={cn('vnode run', sel && 'sel')} style={sx({ left: `${at.x}px`, top: `${at.y}px`, width: `${W}px` })} onClick={onPick} onKeyDown={(e) => e.key === 'Enter' && onPick()} aria-pressed={sel} aria-label={`${r.agent || 'Claude'} is working: ${r.asked}`}>
    <span className="vprev run"><span className="hx-working" role="status"><ThinkingIndicator /><Elapsed from={r.created_at} /></span><span className="hx-now-step shimmer-text">{last ? last.text : 'Reading the project'}</span></span>
    <span className="vbody"><span className="vt clamp2">{r.agent || 'Claude'} is working</span><span className="vasked clamp2"><Icon n="quotes" />{r.asked}</span><span className="vmeta"><Avatar name={r.agent || 'Claude'} agent /><span>{r.agent || 'Claude'}</span><span className="muted">· {plural((r.steps || []).length, 'step')}</span></span></span>
  </div>);
}
function Elapsed({ from }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((Date.now() - from) / 1000));
  return (<span className="num muted">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>);
}
// The picture on a node: the version running live, its screenshot, or what changed when it has neither. While it
// starts, its blueprint; once its page has loaded, the blueprint wipes away over it.
function Preview({ pid, sha, live, shot, v }) {
  const st = live?.status;
  const [boot, setBoot] = useState(st === 'starting');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (st === 'starting') { setBoot(true); setLoaded(false); } else if (st !== 'ready') setBoot(false); }, [st]);
  if (st === 'ready' || boot) return (<span className="vprev">
    {st === 'ready' && (<iframe src={live.url} title="This version, running" tabIndex={-1} loading="lazy" onLoad={() => setTimeout(() => setLoaded(true), 700)} style={sx({ width: `${FRAME}px`, height: `${FRAME * PH / W}px`, transform: `scale(${W / FRAME})` })} />)}
    {boot && (<Blueprint pid={pid} sha={sha} live={live} compact out={st === 'ready' && loaded} onOut={() => setBoot(false)} />)}
    {st === 'ready' && !boot && (<span className="vlive"><i></i>Live</span>)}
  </span>);
  if (shot) return (<span className="vprev"><img src={`/files/${shot.thumb_key || shot.image_key}`} alt="" loading="lazy" draggable="false" /></span>);
  const top = v.top || [];
  return (<span className="vprev code">
    {top.map((f) => { const i = f.path.lastIndexOf('/'); return (<span key={f.path} className="vfile"><span className="trunc"><span className="muted">{f.path.slice(0, i + 1)}</span>{f.path.slice(i + 1)}</span>{f.add != null && (<span className="num"><span className="add">+{f.add}</span> <span className="del">−{f.del}</span></span>)}</span>); })}
    {(v.files || 0) > top.length && (<span className="vfile muted">{top.length ? `and ${plural(v.files - top.length, 'more file')}` : plural(v.files || 0, 'file')}</span>)}
    {!top.length && !v.files && (<span className="vfile muted">No file changes</span>)}
    <span className="vrun muted"><Icon n="play" />Run it to see it</span>
  </span>);
}

// ---------- while a version starts: its blueprint ----------
// Syed's reference film explains a screen by turning it into its blueprint, top to bottom: every part a hairline box
// with its words tinted inside, one region at a time framed with corner marks and named with its count, and a numbered
// caption below saying what's going on, its answer in the blueprint's colour once there is one. While a version starts
// (and while its first walk has found nothing yet) Trace draws the app's blueprint the same way, from its last walk:
// the first screen's lines of text and its components, real sizes and names. When the app has loaded, the blueprint
// wipes away over it, top to bottom. Nothing is invented: no walk yet, no boxes, just the frame and the caption.
const BP = { step: 3480, out: 750 }; // ms: a part's step = the film's blueprint hold (3.1 s) + its focus dim (380 ms); the wipe away (trace.css .bp)
const STAGES = { install: ['01', 'Packages', 'Installing its packages first'], server: ['02', 'Dev server', 'Its own dev server is starting'], page: ['03', 'First page', 'It’s up, and its first page is building'], walk: ['04', 'Walk'] };
const VIEW = { phone: [390, 844], tablet: [834, 1194], desktop: [1280, 800] };
export function Blueprint({ pid, sha, live, walking, title, compact, out, onOut }) {
  const [d, setD] = useState(null);
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });
  const [f, setF] = useState(0); // the part in focus
  const box = useRef();
  useEffect(() => { // this version's last walk, else the files-as-they-are-now walk: it's the same app, near enough
    let on = true;
    (async () => {
      let x = await api(`/projects/${pid}/history/${sha}/screens`).catch(() => null);
      if (!x?.screens?.length && sha !== NOW) { const y = await api(`/projects/${pid}/history/${NOW}/screens`).catch(() => null); if (y?.screens?.length) x = { ...y, other: true }; }
      if (on) setD(x || { screens: [] });
    })();
    return () => { on = false; };
  }, [pid, sha]);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(el); return () => ro.disconnect(); }, []);
  const s = d?.screens?.[0];
  const [VW, VH0] = VIEW[d?.device] || VIEW.desktop, vw = s?.w || VW, vh = Math.min(s?.h || VH0, VH0);
  const clip = ([x, y, ww, hh]) => { const x1 = Math.max(0, x), y1 = Math.max(0, y); return [x1, y1, Math.min(x + ww, vw) - x1, Math.min(y + hh, vh) - y1]; }; // to the first window
  const els = useMemo(() => (s?.els || []).filter((e) => e.t?.trim()).map((e) => ({ ...e, r: clip(e.r) })).filter((e) => e.r[2] > 2 && e.r[3] > 2).slice(0, 160), [s, vh, vw]);
  const parts = useMemo(() => { // the outermost components on the first window, one outline each (the walk's tree, clipped to the window)
    const all = (s?.tree || []).filter((n) => !n.c && n.r[1] < vh - 40).map((n) => ({ ...n, r: clip(n.r) }))
      .filter((n) => n.r[2] >= 48 && n.r[3] >= 24 && n.r[2] * n.r[3] < vw * vh * 0.85);
    const top = Math.min(...all.map((n) => n.d)), kept = [];
    const iou = (a, b) => { const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return w > 0 && h > 0 ? (w * h) / (a[2] * a[3] + b[2] * b[3] - w * h) : 0; };
    for (const n of all.filter((x) => x.d <= top + 1).sort((a, b) => a.r[1] - b.r[1] || a.r[0] - b.r[0])) if (!kept.some((k) => iou(k.r, n.r) > 0.6)) kept.push(n);
    return kept.slice(0, 6);
  }, [s, vh, vw]);
  const focus = !compact && parts.length > 0; // a node is too small for it: the blueprint alone
  useEffect(() => { if (!focus || still() || parts.length < 2 || out) return; const t = setInterval(() => setF((i) => (i + 1) % parts.length), BP.step); return () => clearInterval(t); }, [focus, parts.length, out]);
  const pad = compact ? 8 : 20, head = compact ? 0 : 18, foot = compact ? 0 : 28; // the drawing sits inside the card: room for a label over the top part, the width line under it
  const k = Math.max(0, compact ? Math.min((w - 2 * pad) / vw, (h - 2 * pad) / vh) : (w - 2 * pad) / vw);
  const ox = compact ? (w - vw * k) / 2 : pad, oy = pad + head;
  const at = ([x, y, ww, hh], o = 0) => ({ left: `${ox + x * k - o}px`, top: `${oy + y * k - o}px`, width: `${ww * k + 2 * o}px`, height: `${hh * k + 2 * o}px` });
  const fp = focus ? parts[f % parts.length] : null;
  const inside = (r) => fp && r[0] >= fp.r[0] - 1 && r[1] >= fp.r[1] - 1 && r[0] + r[2] <= fp.r[0] + fp.r[2] + 1 && r[1] + r[3] <= fp.r[1] + fp.r[3] + 1;
  const lines = fp ? els.filter((e) => inside(e.r)).length : 0;
  const stage = walking ? 'walk' : live?.status === 'starting' ? live.stage || 'server' : null;
  const [n, label, says] = STAGES[stage] || [];
  const done = !walking && live?.status === 'ready' && live.took != null;
  const cardH = compact ? h : vh * k + 2 * pad + head + foot;
  const walkSays = (t = 'opening its first page') => `Walking it: ${t[0].toLowerCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`;
  useEffect(() => { if (!out) return; const t = setTimeout(() => onOut?.(), still() ? 320 : BP.out + 80); return () => clearTimeout(t); }, [out]); // the app has wiped in over it
  return (<div className={cn('bp', compact && 'compact', out && 'out', s?.thumb && 'ghosted')}>
    <div className="bp-card" ref={box} style={sx(compact ? {} : { '--ar': vw / vh, height: w ? `${cardH}px` : undefined, aspectRatio: w ? undefined : `${vw} / ${vh}` })} aria-hidden="true">
      {s?.thumb && w > 0 && (<span className="bp-ghost" style={sx(at([0, 0, vw, vh]))}><img src={`/files/${s.thumb}`} alt="" draggable="false" /></span>)}
      {w > 0 && d && (<div className={cn('bp-ink', fp && 'focusing')} key={s?.id || 'none'}>
        <span className="bp-frame" style={sx(at([0, 0, vw, vh]))} />
        {parts.map((p) => { const pw = p.r[2] * k, ph = p.r[3] * k; return (<svg key={`${p.n}${p.r}`} className={cn('bp-part', p === fp && 'on')} style={sx(at(p.r))} width={pw} height={ph}><rect x=".5" y=".5" width={Math.max(0, pw - 1)} height={Math.max(0, ph - 1)} rx="6" /></svg>); })}
        {els.map((e, i) => (<span key={i} className={cn('bp-el', inside(e.r) && 'on')} style={sx({ ...at(e.r), fontSize: `${Math.max(1, parseFloat(e.size) * k)}px` })}>{compact ? '' : e.t}</span>))}
        {fp && (<span className={cn('bp-focus', fp.r[0] + fp.r[2] / 2 > vw / 2 && 'end')} key={f} style={sx(at(fp.r, 6))}>
          <i className="tl" /><i className="tr" /><i className="bl" /><i className="br" />
          <span className="bp-tag">{fp.n} · {Math.round(fp.r[2])} × {Math.round(fp.r[3])}{lines ? ` · ${plural(lines, 'line')}` : ''}</span>
        </span>)}
        {!compact && (<span className="bp-dim" style={sx({ left: `${ox}px`, top: `${oy + vh * k + 12}px`, width: `${vw * k}px` })}><i /><span>{s ? `${s.name || 'First screen'} · ${vw} × ${vh}` : `Not walked yet · ${vw} × ${vh}`}</span></span>)}
      </div>)}
      {w > 0 && d && (<i className="bp-scan" style={sx({ '--travel': `${cardH}px` })} />)}
    </div>
    {compact ? (stage ? (<span className="bp-cap1"><b className="bp-n">{n}</b><span className="trunc">{label}</span><Elapsed from={live?.since || Date.now()} /></span>)
      : done && (<span className="bp-cap1" key="done"><b className="bp-n"><Icon n="check" /></b><span className="bp-a trunc">Running, in {Math.max(1, Math.round(live.took / 1000))} s</span></span>))
      : (<div className="bp-cap" aria-live="polite">
        <span className="bp-step" key={stage || 'done'}>{n ? (<><b className="bp-n">{n}</b>{label}</>) : (<><b className="bp-n"><Icon n="check" /></b>Running</>)}</span>
        <div className="col" style={sx('gap:4px;min-width:0')}>
          <p className="bp-says" key={stage || 'done'}>{stage === 'walk' ? walkSays(walking.label || undefined) : says ? `${says}.` : `${title} runs.`}
            {done && (<span className="bp-a"> {`Running, in ${Math.max(1, Math.round(live.took / 1000))} s.`}</span>)}</p>
          <p className="small muted">{stage === 'walk' ? 'It clicks what a person would, never anything that deletes, pays, sends or saves. Screens show here as they’re found.' : stage ? (<><Elapsed from={live?.since || Date.now()} /> · the first start can take a minute.</>) : null}
            {d && (<span className="bp-src"> {s ? (d.other ? 'The blueprint is from the walk of the files as they are now.' : 'The blueprint is from its last walk.') : 'Its blueprint draws once it has been walked.'}</span>)}</p>
        </div>
      </div>)}
  </div>);
}

function Gate({ icon, title, body, action }) {
  return (<div className="hx-gate"><div className="hx-gate-c"><Icon n={icon} cls="big" /><h2>{title}</h2><p>{body}</p>{action}</div></div>);
}
function StartGate({ p, data, edit, reload }) {
  const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); try { await api(`/projects/${p.id}/history/start`, { method: 'POST' }); toast('History started: what’s in the folder now is the first version.'); reload(); } catch (e) { fail(e); setBusy(false); } };
  return (<Gate icon="git-commit" title="Start the version history" body={`Trace keeps every version of ${data.dir.split(/[\\/]/).pop()} with git: each save, each change Claude makes, with what was asked and why. It adds a .git folder there (and a .gitignore if there isn’t one) and saves what’s in it now as the first version.`}
    action={edit && (<Button variant="primary" onClick={start} aria-disabled={busy}>{busy ? 'Starting…' : 'Start version history'}</Button>)} />);
}

// ---------- the panel: why a version was made, what changed, every file, and its thread ----------
function Panel({ p, data, v, live, edit, compose, onClose, onRun, onStop, onOpen, onFrames, onDlg }) {
  const now = v.sha === NOW;
  const { data: d, error, reload } = useFetch(`/projects/${p.id}/history/${v.sha}`, ['comment', 'history'], (t, x) => x.project_id === p.id && x.run?.status !== 'running');
  const [tab, setTab] = useState(() => (drafts.has(`${p.id}:${v.sha}`) ? 'thread' : 'changes')); // back to an unsent comment
  useEffect(() => { if (compose) setTab('thread'); }, [compose]);
  const steps = d?.run?.steps || [];
  const isHead = v.sha === data.head;
  const askedBy = v.asker || d?.run?.by || d?.asker;
  const asked = v.asked || d?.asked;
  const why = v.why || d?.why;
  const [w1, w2] = firstSentence(why || '');
  const files = d?.files || [];
  const comments = d?.comments || [];
  return (<aside className="hx-panel" aria-label={now ? 'Not saved yet' : v.title}>
    <div className="hx-ph">
      {now ? (<><Icon n="pencil-simple-line" /><b>On disk, not saved</b></>) : (<><Avatar name={v.who} agent={isAgent(v)} /><b className="trunc">{v.agent || v.who}</b><button className="hx-sha num" onClick={() => copy(v.sha, 'Version id copied')} data-tip="Copy the version id">{v.short}</button></>)}
      <span className="grow"></span><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={onClose}><Icon n="x" size={15} /></Button>
    </div>
    <div className="hx-pb">
      <div className="col" style={sx('gap:4px')}>
        <h2>{now ? 'Not saved yet' : v.title}</h2>
        <p className="small muted">{now ? `${plural(data.changes.length, 'file')} changed since ${data.versions.find((x) => x.sha === data.head)?.title || 'the last version'}` : `${longDate(v.when)}, ${time(v.when)}${isHead ? ' · the version you’re on' : ''}${v.rolled_back_to ? ` · rolled back to ${v.rolled_back_to.slice(0, 7)}` : ''}`}</p>
      </div>
      <div className="hx-acts">
        {edit && (live && live.status !== 'failed' ? <Button variant="secondary" size="compact" leadingIcon={ph('stop')} onClick={onStop}>Stop</Button> : <Button variant="primary" size="compact" leadingIcon={ph('play')} onClick={onRun}>Run it</Button>)}
        {live?.status === 'ready' && (<Button variant="secondary" size="compact" leadingIcon={ph('arrows-out')} onClick={onOpen}>Open</Button>)}
        <Button variant="secondary" size="compact" leadingIcon={ph('frame-corners')} onClick={onFrames}>See its frames</Button>
        {now && edit && (<Button variant="secondary" size="compact" leadingIcon={ph('floppy-disk')} onClick={() => onDlg({ kind: 'save' })}>Save version</Button>)}
        {/* one primary action in sight; the rarer ones wait one click away */}
        <Menu label="More for this version" btn="btn secondary sm icon" items={[
          { label: 'Download as a .zip', icon: 'download-simple', onClick: () => { location.href = `/api/projects/${p.id}/history/${v.sha}/zip`; } },
          !now && !isHead && edit && { label: 'Roll back to this', icon: 'arrow-counter-clockwise', onClick: () => onDlg({ kind: 'rollback', v }) },
        ]} />
      </div>
      {live?.status === 'failed' && (<p className="hx-err small">{live.error}{live.log && (<code className="block mono tiny">{live.log.split('\n').filter(Boolean).slice(-4).join('\n')}</code>)}</p>)}
      {(asked || why || steps.length > 0) && (<div className="hx-story">
        {asked && (<div className="clog asked"><span className="hx-k">{askedBy ? `${askedBy} asked${v.agent ? ` ${v.agent}` : ''}` : v.agent ? `What ${v.agent} was asked` : 'What was asked'}{v.asked_in && v.asked_in !== 'Trace' ? ` · in ${v.asked_in}` : ''}</span><p><Ink t={asked} /></p></div>)}
        {why && (<div className="clog why"><span className="hx-k">Why{v.agent ? `, in ${v.agent}’s words` : ''}</span><p><b><Ink t={w1} /></b>{w2 && <> <Ink t={w2} /></>}</p></div>)}
        {steps.length > 0 && (<Steps r={d.run} />)}
      </div>)}
      {d?.note && !now && (<p className="small ink2 hx-note">{d.note.replace(/([^\n])\n(?=[^\n\-*\d])/g, '$1 ')}</p>)}
      <Seg size="compact" label="Show" value={tab} onChange={setTab} options={[{ value: 'changes', label: `Changes${files.length ? ` · ${files.length}` : ''}` }, { value: 'files', label: 'Files' }, { value: 'thread', label: `Thread${comments.length ? ` · ${comments.length}` : ''}` }]} />
      {error && (<ErrorBox error={error} retry={reload} />)}
      {tab === 'changes' && (!d ? (<Loading h={120} />) : !files.length ? (<p className="small muted">No file changes in this version.</p>) : (<div className="hx-files">{files.map((f) => (<FileDiff key={f.path} p={p} sha={v.sha} f={f} open={files.length === 1} />))}</div>))}
      {tab === 'files' && (<FileBrowser p={p} sha={v.sha} />)}
      {tab === 'thread' && (<Thread p={p} v={v} comments={comments} edit={edit} focus={compose} reload={reload} />)}
    </div>
  </aside>);
}

function Steps({ r }) {
  const [open, setOpen] = useState(r.status === 'running');
  const steps = (r.steps || []).filter((s) => s.kind !== 'think' || s.text);
  const head = r.status === 'running' ? 'Working' : `Worked through ${plural(steps.length, 'step')}${r.ms ? ` · ${(r.ms / 1000).toFixed(0)}s` : ''}`;
  return (<ThinkingSteps open={open} onOpenChange={setOpen} className="ai-trace hx-steps">
    <ThinkingStepsHeader>{head}</ThinkingStepsHeader>
    <ThinkingStepsContent>{steps.map((s, i) => (<ThinkingStep key={i} icon={STEP_ICON[s.kind] || 'dot'} label={s.kind === 'say' || s.kind === 'think' ? (s.kind === 'think' ? 'Thought it through' : 'Said') : s.text} description={s.kind === 'say' || s.kind === 'think' ? s.text : undefined} status={r.status === 'running' && i === steps.length - 1 ? 'active' : 'complete'} isLast={i === steps.length - 1} />))}</ThinkingStepsContent>
  </ThinkingSteps>);
}

// Claude at work, opened: every step as it happens, and Stop.
function RunPanel({ p, r, edit, onClose }) {
  const who = r.agent || 'Claude';
  const stop = () => api(`/projects/${p.id}/history/claude/stop`, { method: 'POST' }).then(() => toast(`Stopped ${who}. Nothing was saved.`)).catch(fail);
  return (<aside className="hx-panel" aria-label={`${who} is working`}>
    <div className="hx-ph"><Avatar name={who} agent /><b>{who}</b>{who === 'Trace AI' && (<span className="hx-pill muted">Free model</span>)}<span className="grow"></span><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={onClose}><Icon n="x" size={15} /></Button></div>
    <div className="hx-pb">
      <div className="col" style={sx('gap:4px')}><h2>{who} is working</h2><p className="small muted">Started <Elapsed from={r.created_at} /> ago in the project’s folder. It lands here as a new version when it’s done.</p></div>
      <div className="clog asked"><span className="hx-k">{r.by ? `${r.by} asked` : 'Asked'}</span><p>{r.asked}</p></div>
      <Steps r={{ ...r, status: 'running' }} />
      {edit && (<div className="hx-acts"><Button variant="secondary" size="compact" leadingIcon={ph('stop')} onClick={stop}>Stop {who}</Button></div>)}
    </div>
  </aside>);
}

// One changed file, folded; open it for its lines.
function FileDiff({ p, sha, f, open: start }) {
  const [open, setOpen] = useState(start);
  const [patch, setPatch] = useState(null);
  useEffect(() => { if (open && patch == null) api(`/projects/${p.id}/history/${sha}/diff?path=${encodeURIComponent(f.path)}`).then((r) => setPatch(r.patch)).catch((e) => setPatch(`!${e.message}`)); }, [open]);
  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
  return (<div className={cn('hx-file', open && 'open')}>
    <button className="hx-fh" onClick={() => setOpen(!open)} aria-expanded={open}>
      <Icon n={open ? 'caret-down' : 'caret-right'} swap /><span className={cn('hx-st', `st-${f.status}`)} title={{ A: 'Added', M: 'Changed', D: 'Deleted', R: 'Renamed' }[f.status]}>{f.status}</span>
      <span className="trunc"><span className="muted">{dir}</span>{f.path.slice(dir.length)}</span><span className="grow"></span>
      {f.binary ? (<span className="tiny muted">binary</span>) : (<span className="num tiny"><span className="add">+{f.add}</span> <span className="del">−{f.del}</span></span>)}
    </button>
    {open && (patch == null ? (<Loading h={60} />) : patch.startsWith('!') ? (<p className="small hx-err">{patch.slice(1)}</p>) : (<DiffLines patch={patch} />))}
  </div>);
}
function DiffLines({ patch }) {
  const rows = [];
  let a = 0, b = 0;
  for (const line of patch.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|\\ No newline)/.test(line)) continue;
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) { a = +h[1]; b = +h[2]; rows.push({ k: 'hunk', t: h[3].trim() || '' }); continue; }
    if (line.startsWith('+')) rows.push({ k: 'add', b: b++, t: line.slice(1) });
    else if (line.startsWith('-')) rows.push({ k: 'del', a: a++, t: line.slice(1) });
    else if (line.length || rows.length) rows.push({ k: 'ctx', a: a++, b: b++, t: line.slice(1) });
    if (rows.length > 4000) break;
  }
  if (!rows.length) return (<p className="small muted" style={sx('padding:8px 12px')}>No line changes to show.</p>);
  return (<div className="hx-code diff" role="table" aria-label="Line changes">{rows.map((r, i) => (r.k === 'hunk'
    ? (<div key={i} className="ln hunk"><span className="no"></span><span className="no"></span><span className="tx">{r.t || '⋯'}</span></div>)
    : (<div key={i} className={cn('ln', r.k)}><span className="no">{r.a ?? ''}</span><span className="no">{r.b ?? ''}</span><span className="tx">{r.t || ' '}</span></div>)))}</div>);
}

// Every file as it was in this version: a filter, the list, and a file opened in place.
function FileBrowser({ p, sha }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/history/${sha}/files`);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  if (error) return (<ErrorBox error={error} retry={reload} />);
  if (!data) return (<Loading h={160} />);
  if (open) return (<FileView p={p} sha={sha} path={open} onBack={() => setOpen(null)} />);
  const hits = data.filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()));
  return (<div className="col" style={sx('gap:8px')}>
    <Input className="sm" placeholder={`Filter ${plural(data.length, 'file')}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter the files" />
    <div className="hx-list">{hits.slice(0, 400).map((f) => { const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : ''; return (<button key={f} className="hx-li" onClick={() => setOpen(f)}><Icon n={/\.(png|jpe?g|svg|webp|gif)$/i.test(f) ? 'image' : /\.(tsx?|jsx?|css|html|json|mjs)$/i.test(f) ? 'file-code' : 'file'} /><span className="trunc"><span className="muted">{dir}</span>{f.slice(dir.length)}</span></button>); })}
      {hits.length > 400 && (<p className="tiny muted" style={sx('padding:6px 8px')}>{hits.length - 400} more; filter to find them.</p>)}
      {!hits.length && (<p className="small muted" style={sx('padding:8px')}>No file matches “{q}”.</p>)}</div>
  </div>);
}
export function FileView({ p, sha, path, onBack }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/history/${sha}/file?path=${encodeURIComponent(path)}`);
  return (<div className="col" style={sx('gap:8px')}>
    <div className="row" style={sx('gap:6px;min-width:0')}>{onBack && (<Button variant="ghost" size="icon-compact" aria-label="Back to the files" onClick={onBack}><Icon n="arrow-left" size={15} /></Button>)}<span className="small trunc grow mono">{path}</span>{data?.text != null && (<Button variant="ghost" size="icon-compact" aria-label="Copy the file" onClick={() => copy(data.text, 'File copied')}><Icon n="copy" size={15} /></Button>)}</div>
    {error ? (<ErrorBox error={error} retry={reload} />) : !data ? (<Loading h={200} />)
      : data.image ? (<img className="hx-img" src={data.image} alt={path} />)
      : data.binary ? (<p className="small muted">A binary file ({Math.round(data.size / 1024)} KB); download the version to open it.</p>)
      : (<div className="hx-code" role="table" aria-label={path}>{data.text.split('\n').slice(0, 5000).map((l, i) => (<div key={i} className="ln"><span className="no">{i + 1}</span><span className="tx">{l || ' '}</span></div>))}{data.cut && (<p className="tiny muted" style={sx('padding:8px')}>Cut at 600 KB.</p>)}</div>)}
  </div>);
}

// The version's thread. Tag @claude (Claude Code, on your Claude plan) or @trace (Trace's AI, the free model on your
// AI Gateway key) and it makes the change in the project's folder.
const AGENTS = { claude: { tag: '@claude', who: 'Claude', note: 'Claude Code makes it in the project’s folder and saves it as a new version. It uses your Claude plan, not money.' }, trace: { tag: '@trace', who: 'Trace AI', note: 'Trace AI makes it on the free model: $0, slower (5 requests a minute) and simpler than Claude.' } };
const tagOf = (t) => (/@trace\b/i.test(t) ? 'trace' : /@claude\b/i.test(t) ? 'claude' : null);
const drafts = new Map(); // a thread's unsent words outlive the panel closing or another tab opening
function Thread({ p, v, comments, edit, focus, reload }) {
  const key = `${p.id}:${v.sha}`;
  const [text, setTextRaw] = useState(() => drafts.get(key) || '');
  const setText = (t) => setTextRaw((o) => { const n = typeof t === 'function' ? t(o) : t; n ? drafts.set(key, n) : drafts.delete(key); return n; });
  const [busy, setBusy] = useState(false);
  const ta = useRef();
  useEffect(() => { if (focus && ta.current) { setText((t) => (tagOf(t) ? t : `@claude ${t}`)); setTimeout(() => { ta.current?.focus(); const n = ta.current?.value.length || 0; ta.current?.setSelectionRange(n, n); }, 30); } }, [focus]);
  const tag = tagOf(text), A = tag && AGENTS[tag];
  const retag = (k) => { setText((t) => `${AGENTS[k].tag} ${t.replace(/@(claude|trace)\b\s*/gi, '')}`); ta.current?.focus(); };
  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const c = await api('/comments', { method: 'POST', body: { target_type: 'version', target_id: `${p.id}:${v.sha}`, body: text } });
      setText('');
      reload();
      if (c.claude_error) toast(c.claude_error, { error: true, ms: 12000 });
      else if (c.run) toast(`${c.agent || 'Claude'} is on it`, { sub: 'Watch it work on the canvas. It lands as a new version.' });
    } catch (er) { fail(er); }
    setBusy(false);
  };
  return (<div className="col" style={sx('gap:12px')}>
    {!comments.length && (<p className="small muted">Nothing said about this version yet. Comment, or tag <b>@claude</b> (your Claude plan) or <b>@trace</b> (free) to ask for a change; they get this version and what was asked before.</p>)}
    {comments.map((c) => (<div key={c.id} className="hx-msgs">
      <Msg c={c} />
      {c.replies.map((r) => (<Msg key={r.id} c={r} reply />))}
    </div>))}
    {edit && (<form className="hx-compose" onSubmit={send}>
      <Textarea ref={ta} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Comment, or tag @claude or @trace (free) to change it" aria-label="Comment on this version"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }} />
      <div className="row" style={sx('gap:6px')}>
        <Button type="button" variant={tag === 'claude' ? 'secondary' : 'ghost'} size="compact" leadingIcon={ph('at')} aria-pressed={tag === 'claude'} onClick={() => retag('claude')}>Claude</Button>
        <Button type="button" variant={tag === 'trace' ? 'secondary' : 'ghost'} size="compact" leadingIcon={ph('at')} aria-pressed={tag === 'trace'} onClick={() => retag('trace')}>Trace AI · free</Button>
        <span className="grow"></span>
        <Button variant="primary" size="compact" aria-disabled={busy || !text.trim()} leadingIcon={ph(tag ? 'at' : 'paper-plane-right')} onClick={send}>{A ? `Ask ${A.who}` : 'Comment'}</Button>
      </div>
      <span className="tiny muted">{A ? A.note : 'Ctrl Enter sends'}</span>
    </form>)}
  </div>);
}
function Msg({ c, reply }) {
  const claude = c.kind === 'claude' || c.author_name === 'Claude';
  const parts = String(c.body).split(/(@claude\b|@trace\b)/i);
  return (<div className={cn('hx-m', reply && 'reply', claude && 'claude')}>
    <div className="row" style={sx('gap:6px')}><Avatar name={c.author_name} agent={claude} /><b className="small">{c.author_name}</b><span className="tiny muted">{rel(c.created_at)}</span>
      {claude && c.meta?.sha && (<a className="tiny" href={`#/p/${c.project_id}/history/${c.meta.sha}`}>Open the version</a>)}</div>
    <p className="small">{parts.map((s, i) => (/^@(claude|trace)$/i.test(s) ? (<span key={i} className="hx-tag">{s.toLowerCase()}</span>) : (<Ink key={i} t={s} />)))}</p>
  </div>);
}

// ---------- a running version, full screen, at a device's width ----------
export const DEVICES = [{ value: 0, label: 'Desktop', icon: 'desktop' }, { value: 834, label: 'Tablet', icon: 'device-tablet' }, { value: 390, label: 'Phone', icon: 'device-mobile' }];
function Stage({ p, sha, v, live, onClose }) {
  const [w, setW] = useState(0);
  const [n, setN] = useState(0);
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  return (<div className="hx-stage" role="dialog" aria-modal="true" aria-label={`${v?.title} running`}>
    <div className="hx-stage-bar">
      <b className="trunc">{v?.title}</b><span className="num muted small">{v?.short}</span><span className="grow"></span>
      <Seg size="compact" label="Width" value={w} onChange={setW} options={DEVICES} />
      <Tip tip="Reload"><Button variant="ghost" size="icon" aria-label="Reload" onClick={() => setN(n + 1)}><Icon n="arrow-clockwise" size={16} /></Button></Tip>
      <Tip tip="Open in a new tab"><Button variant="ghost" size="icon" aria-label="Open in a new tab" render={<a href={live?.url} target="_blank" rel="noopener" />}><Icon n="arrow-square-out" size={16} /></Button></Tip>
      <Tip tip="Close" kbd="Esc"><Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><Icon n="x" size={16} /></Button></Tip>
    </div>
    <div className="hx-stage-b">{live?.status === 'ready' ? (<iframe key={n} src={live.url} title={`${v?.title}, running`} style={sx({ width: w ? `${w}px` : '100%' })} />) : (<p className="muted">It stopped running. Run it again from its panel.</p>)}</div>
  </div>);
}

// ---------- dialogs ----------
function SaveDialog({ p, n, onClose, onDone }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => { e?.preventDefault(); setBusy(true); try { const r = await api(`/projects/${p.id}/history/save`, { method: 'POST', body: { message: msg.trim() || 'Saved a version' } }); toast('Saved as a version'); onDone(r.sha); } catch (er) { fail(er); setBusy(false); } };
  return (<Dialog title="Save a version" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} aria-disabled={busy}>{busy ? 'Saving…' : 'Save version'}</Button></>}>
    <form onSubmit={save} className="col" style={sx('gap:12px')}>
      <p className="small muted">Saves the {plural(n, 'changed file')} on disk as the next version, so you can come back to it, run it or roll back to it.</p>
      <Field label="What changed" hint="One line, the way you’d tell a teammate."><Input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Tightened the hero spacing" /></Field>
    </form>
  </Dialog>);
}
function PushDialog({ p, data, onClose, onDone }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const chain = [];
  for (let s = data.head, i = 0; s && i < Math.min(data.ahead, 8); i++) { const v = data.versions.find((x) => x.sha === s); if (!v) break; chain.push(v); s = v.parents[0]; }
  const go_ = async () => { setBusy(true); setOut(null); try { const r = await api(`/projects/${p.id}/history/push`, { method: 'POST', body: { remote_url: url } }); toast(`Pushed to ${r.upstream || r.remote}`); onDone(); } catch (e) { setOut(e.message); setBusy(false); } };
  return (<Dialog title={data.remote ? `Push to ${data.remote}` : 'Push to a repository'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" leadingIcon={ph('cloud-arrow-up')} onClick={go_} aria-disabled={busy || (!data.remote && !url.trim()) || (data.remote && !data.ahead)}>{busy ? 'Pushing…' : data.ahead ? `Push ${plural(data.ahead, 'version')}` : 'Nothing to push'}</Button></>}>
    <div className="col" style={sx('gap:12px')}>
      {data.remote ? (<p className="small muted">{data.ahead ? <>These go to <b className="mono">{data.url}</b>{data.branch ? <> on <b>{data.branch}</b></> : null}. Anyone who pulls gets them.</> : <>Everything on <b>{data.branch}</b> is already on {data.upstream || data.remote}.</>}</p>)
        : (<Field label="Repository address" hint="Where the versions go, e.g. a new empty repository on GitHub."><Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/project.git" spellCheck="false" /></Field>)}
      {chain.length > 0 && (<div className="hx-chain">{chain.map((v) => (<div key={v.sha} className="row small" style={sx('gap:8px;min-width:0')}><Avatar name={v.who} agent={isAgent(v)} /><span className="trunc grow">{v.title}</span><span className="num tiny muted">{v.short}</span></div>))}{data.ahead > chain.length && (<span className="tiny muted">and {data.ahead - chain.length} more</span>)}</div>)}
      {out && (<pre className="hx-err tiny mono">{out}</pre>)}
    </div>
  </Dialog>);
}
function RollbackDialog({ p, v, dirty, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const go_ = async () => { setBusy(true); try { const r = await api(`/projects/${p.id}/history/${v.sha}/rollback`, { method: 'POST' }); toast(`Rolled back to “${v.title}”`, { sub: 'Saved as a new version; the ones after it are still in the history.' }); onDone(r.sha); } catch (e) { fail(e); setBusy(false); } };
  return (<Dialog title={`Roll back to “${v.title}”?`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" leadingIcon={ph('arrow-counter-clockwise')} onClick={go_} aria-disabled={busy}>{busy ? 'Rolling back…' : 'Roll back'}</Button></>}>
    <p className="small">Every file in the folder goes back to how it was on {longDate(v.when)} at {time(v.when)}, saved as a new version. Nothing is lost: the versions after it stay in the history, and you can roll forward to any of them.</p>
    {dirty > 0 && (<p className="small muted">The {plural(dirty, 'unsaved change')} on disk {dirty === 1 ? 'is' : 'are'} saved as a version first.</p>)}
  </Dialog>);
}
function InstallDialog({ p, onClose }) {
  const [busy, setBusy] = useState(false);
  const go_ = async () => { setBusy(true); try { const r = await api(`/projects/${p.id}/history/install`, { method: 'POST' }); toast(`Installing with ${r.command || 'the package manager'}…`, { sub: 'Run the version again when it’s done.' }); onClose(); } catch (e) { fail(e); setBusy(false); } };
  return (<Dialog title="Install the packages first" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Not now</Button><Button variant="primary" onClick={go_} aria-disabled={busy}>Install packages</Button></>}>
    <p className="small">This project’s packages aren’t installed, so its dev server can’t start. Trace can install them in the folder with its own package manager (pnpm, yarn or npm, from its lockfile). It takes a minute or two.</p>
  </Dialog>);
}
