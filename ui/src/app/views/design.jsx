// Design: the project's working copy running, to pick anything on screen and change how it's drawn (layout, type, fill,
// corners, border) like in Figma, drawn at once. Every change is kept with where it lives in the code and the code it
// needs; Claude Code takes them (the trace-design skill, MCP get_design_changes) and writes them, and the canvas shows
// the code's own result as the dev server reloads. Beside it: the changes, what you and Claude are asking and
// reasoning in the session right now, and Trace's AI answering with all of that.
import { useState, useEffect, useRef, api, useFetch, Icon, Button, Seg, Tip, toast, fail, rel, plural, ph, sx, cn } from '../lib.jsx';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const DEVICES = { desktop: 1280, tablet: 834, phone: 390 };
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const pxOf = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? +n.toFixed(2) : ''; };
const ink = typeof document !== 'undefined' && Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
const hexOf = (v) => { // any colour Chrome computes (rgb, lab, oklch…) as the sRGB hex a colour input takes: drawn to one pixel and read back
  if (!ink || !v) return '#000000';
  ink.clearRect(0, 0, 1, 1); ink.fillStyle = '#000'; ink.fillStyle = v; ink.fillRect(0, 0, 1, 1);
  return `#${[...ink.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};
const clear = (v) => !v || v === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(v);
const said = (t, n = 160) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || '');

export function DesignCanvas({ p, switcher }) {
  const d = useFetch(`/projects/${p.id}/design`, ['design']);
  const code = useFetch(`/projects/${p.id}/history/now/frames`);
  const [device, setDevice] = useState('desktop');
  const [picking, setPicking] = useState(true);
  const [el, setEl] = useState(null); // what's picked, as the page reports it
  const [where, setWhere] = useState(null); // where it lives in the code
  const [tab, setTab] = useState('props');
  const [edits, setEdits] = useState([]);
  const [w, setW] = useState(0);
  const frame = useRef(), stage = useRef(), timers = useRef({}), firsts = useRef({}); // firsts: each property as it was before it was first changed
  const status = d.data?.status, url = d.data?.url, appOrigin = url ? new URL(url).origin : null;
  useEffect(() => { if (d.data?.edits) setEdits(d.data.edits); }, [d.data]);
  useEffect(() => { if (status && status !== 'ready' && status !== 'failed' && status !== 'stopped') { const t = setTimeout(d.reload, 2000); return () => clearTimeout(t); } }, [status, d.data]);
  useEffect(() => { const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); if (stage.current) ro.observe(stage.current); return () => ro.disconnect(); }, [status]);
  const send = (m) => frame.current?.contentWindow?.postMessage({ trace: 'design', ...m }, appOrigin || '*');
  useEffect(() => {
    const f = (e) => {
      if (e.origin !== appOrigin || e.data?.trace !== 'design') return;
      if (e.data.type === 'ready') { send({ type: 'names', names: [...new Set((code.data?.components || []).map((c) => c.name))] }); send({ type: 'mode', select: picking }); }
      else if (e.data.type === 'selected') setEl(e.data.el);
    };
    addEventListener('message', f);
    return () => removeEventListener('message', f);
  }, [appOrigin, picking, code.data]);
  useEffect(() => { send({ type: 'mode', select: picking }); }, [picking]);
  useEffect(() => { // where the picked element lives in the code
    if (!el) { setWhere(null); return; }
    let off = false;
    api(`/projects/${p.id}/design/locate`, { method: 'POST', body: { comp: el.comp, chain: el.chain, cls: el.cls, text: el.text, tag: el.tag, own: el.own } }).then((x) => !off && setWhere(x)).catch(() => !off && setWhere(null));
    return () => { off = true; };
  }, [el?.path, el?.comp]);
  const open = () => api(`/projects/${p.id}/design/open`, { method: 'POST' }).then(d.reload).catch(fail);
  // A property (or the words) changed: drawn in the page at once, on every step; kept as an edit, from where it
  // started, once it settles. With "Write to code" on, Trace writes it into the file itself when it can do so exactly;
  // the page then lets go of its own drawing so the app's reload shows the code's result.
  const SIDE = { borderWidth: 'borderTopWidth', borderColor: 'borderTopColor', borderStyle: 'borderTopStyle' }; // the page reports the top side
  const [writing, setWriting] = useState(() => { try { return localStorage.getItem('trace.dz.write') === '1'; } catch { return false; } });
  const toggleWrite = () => { const v = !writing; setWriting(v); try { localStorage.setItem('trace.dz.write', v ? '1' : '0'); } catch {} };
  const record = (at, prop, value) => {
    const key = `${at.path}|${prop}`;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => api(`/projects/${p.id}/design/edits`, { method: 'POST', body: { path: at.path, url: at.url, comp: at.comp, chain: at.chain, rem: at.rem, tag: at.tag, cls: at.cls, text: at.text, own: at.own, prop, from: firsts.current[key], to: value, write: writing } })
      .then((r) => { setEdits(r.edits); if (r.edit?.status === 'written' && prop !== 'text') setTimeout(() => send({ type: 'unset', path: at.path, prop }), 1500); }).catch(fail), 400);
  };
  const paint = (at, prop, value) => { // one value on the page: its own again when it's where it started
    const key = `${at.path}|${prop}`;
    if (prop === 'text') send({ type: 'settext', path: at.path, text: value });
    else if (value === firsts.current[key]) send({ type: 'unset', path: at.path, prop });
    else send({ type: 'set', path: at.path, prop, value });
    record(at, prop, value);
  };
  // Undo and redo: each change a step; a drag or a run of typing on one property is one step.
  const hist = useRef({ steps: [], at: 0 }), [, bump] = useState(0);
  const remember = (at, prop, before, after) => {
    const h = hist.current, last = h.steps[h.at - 1];
    if (last && h.at === h.steps.length && last.at.path === at.path && last.prop === prop && Date.now() - last.t < 900) { last.after = after; last.t = Date.now(); }
    else { h.steps.splice(h.at); h.steps.push({ at, prop, before, after, t: Date.now() }); h.at = h.steps.length; }
    bump((n) => n + 1);
  };
  const undo = () => { const h = hist.current; if (!h.at) return; const st = h.steps[--h.at]; st.t = 0; paint(st.at, st.prop, st.before); bump((n) => n + 1); };
  const redo = () => { const h = hist.current; if (h.at >= h.steps.length) return; const st = h.steps[h.at++]; paint(st.at, st.prop, st.after); bump((n) => n + 1); };
  const change = (k, value) => {
    if (!el) return;
    const prop = kebab(k), key = `${el.path}|${prop}`, now = el.style[k] ?? el.style[SIDE[k]] ?? '';
    if (!(key in firsts.current)) firsts.current[key] = now;
    remember(el, prop, now, value);
    paint(el, prop, value);
  };
  const changeText = (value, at = el, before = at?.content) => { // its words, from the panel or typed on the page
    if (!at) return;
    const key = `${at.path}|text`;
    if (!(key in firsts.current)) firsts.current[key] = before ?? '';
    remember(at, 'text', before ?? '', value);
    if (at === el) paint(at, 'text', value); else record(at, 'text', value); // typed on the page: it shows already
  };
  useEffect(() => { // the page's own words edit, and ⌘Z / Ctrl+Z while the canvas has the keys
    const f = (e) => {
      if (e.origin !== appOrigin || e.data?.trace !== 'design') return;
      if (e.data.type === 'text') changeText(e.data.to, e.data.el, e.data.from);
      else if (e.data.type === 'key') (e.data.redo ? redo : undo)();
    };
    addEventListener('message', f);
    return () => removeEventListener('message', f);
  });
  useEffect(() => {
    const f = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.target.closest?.('input, textarea, select, [contenteditable]')) return; // a field's own undo
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  });
  const drop = (x) => { if (x.prop === 'text') send({ type: 'settext', path: x.path, text: x.from }); else send({ type: 'unset', path: x.path, prop: x.prop }); api(`/projects/${p.id}/design/edits/${x.id}`, { method: 'DELETE' }).then((r) => setEdits(r.edits)).catch(fail); };
  const drafts = edits.filter((x) => x.status === 'draft'), wrote = edits.filter((x) => x.status === 'written');
  const reset = (prop) => { // one property back to how it was: on the page, off the list, out of the code
    if (!el) return;
    const key = `${el.path}|${prop}`, x = [...drafts, ...wrote].find((e) => e.path === el.path && e.prop === prop);
    clearTimeout(timers.current[key]);
    if (key in firsts.current) remember(el, prop, prop === 'text' ? el.content : el.style[Object.keys(el.style).find((s) => kebab(s) === prop)] ?? '', firsts.current[key]);
    if (x) drop(x); else if (prop === 'text') send({ type: 'settext', path: el.path, text: firsts.current[key] }); else send({ type: 'unset', path: el.path, prop });
  };
  const mine = new Set([...drafts, ...wrote].filter((x) => el && x.path === el.path).map((x) => x.prop)); // changed and kept (firsts stay all session: undo and redo need where each started)
  const h = hist.current;
  const k = w ? Math.min(1, (w - 48) / DEVICES[device]) : 1;
  return (<div className="dz">
    <div className="dz-bar">
      {switcher}
      <span className="grow"></span>
      <span className="dz-hist">
        <Tip tip="Undo" kbd="Ctrl Z"><Button variant="ghost" size="icon-compact" aria-label="Undo" aria-disabled={!h.at} onClick={undo}><Icon n="arrow-u-up-left" size={16} /></Button></Tip>
        <Tip tip="Redo" kbd="Ctrl ⇧ Z"><Button variant="ghost" size="icon-compact" aria-label="Redo" aria-disabled={h.at >= h.steps.length} onClick={redo}><Icon n="arrow-u-up-right" size={16} /></Button></Tip>
      </span>
      {p.can_edit && (<Tip tip={writing ? 'On: each change goes into the file as you make it, when Trace can write it exactly. The rest wait for Claude.' : 'Off: changes wait on the list for Claude to write.'}><Button variant={writing ? 'secondary' : 'ghost'} size="compact" aria-pressed={writing} leadingIcon={ph('code')} onClick={toggleWrite}>Write to code{writing ? ': on' : ''}</Button></Tip>)}
      <Seg label="Device" value={device} onChange={setDevice} options={[{ value: 'desktop', label: 'Desktop', icon: 'desktop' }, { value: 'tablet', label: 'Tablet', icon: 'device-tablet' }, { value: 'phone', label: 'Phone', icon: 'device-mobile' }]} />
      <Seg label="Mode" value={picking ? 'pick' : 'use'} onChange={(v) => setPicking(v === 'pick')} options={[{ value: 'pick', label: 'Pick', icon: 'cursor-click' }, { value: 'use', label: 'Use the app', icon: 'hand-pointing' }]} />
    </div>
    <div className="dz-body">
      <div className="dz-stage" ref={stage}>
        {status === 'ready' && url ? (<div className="dz-frame" style={sx({ width: `${DEVICES[device] * k}px`, height: `calc(100% - 24px)` })}>
          <iframe ref={frame} title={`${p.name}, running`} src={url} style={sx({ width: `${DEVICES[device]}px`, height: `${100 / k}%`, transform: `scale(${k})` })} />
        </div>)
          : !d.data && !d.error ? (<p className="small muted dz-gate">Opening the canvas…</p>) : (<div className="dz-gate"><Icon n="cursor-click" cls="big" /><h2>{status === 'starting' ? 'Starting the app…' : status === 'failed' ? 'It didn’t start' : 'Design on the running app'}</h2>
            <p className="small muted">{status === 'starting' ? 'Its own dev server is getting ready. The first time can take a minute.' : status === 'failed' ? (d.data?.error || 'Its dev server stopped.') : 'Trace runs your working copy, and you pick anything on it and change how it’s drawn. Claude writes your changes into the code.'}</p>
            {p.can_edit && status !== 'starting' && (<Button variant="primary" size="default" leadingIcon={ph('play')} onClick={open}>{status === 'failed' ? 'Try again' : 'Run it'}</Button>)}</div>)}
      </div>
      <aside className="dz-side" aria-label="Design">
        <Seg label="Panel" value={tab} onChange={setTab} options={[{ value: 'props', label: 'Design' }, { value: 'code', label: 'Code' }, { value: 'changes', label: drafts.length + wrote.length ? `Changes ${drafts.length + wrote.length}` : 'Changes' }, { value: 'context', label: 'Context' }]} />
        {tab === 'props' && (<Props el={el} where={where} edit={p.can_edit} changed={mine} onChange={change} onText={changeText} onEditText={() => el && send({ type: 'edittext', path: el.path })} onReset={reset} onParent={() => send({ type: 'parent' })} />)}
        {tab === 'code' && (<Code p={p} where={where} edit={p.can_edit} stamp={wrote.map((x) => x.wrote?.at).join()} />)}
        {tab === 'changes' && (<Changes p={p} edits={edits} edit={p.can_edit} onDrop={drop} onSent={setEdits} />)}
        {tab === 'context' && (<Context p={p} el={el && { ...el, ...(where ? { file: where.file, line: where.line } : {}) }} edits={drafts} />)}
      </aside>
    </div>
  </div>);

}

// ---- the inspector: Figma's sections in Trace's rows (a grey label column, filled fields with units, sections that fold
// and remember it). Everything changes live: typing, ↑/↓ (Shift for ten), or dragging a field's label sideways. ----
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? +n.toFixed(2) : null; };
const NUMERIC = /^-?\d*\.?\d+\s*(px|%)?$/;
// A number that changes the page as it changes. What you're typing isn't overwritten while you're in the field.
function Num({ label, icon, value, unit = 'px', step = 1, min = 0, max, onLive, changed, title }) {
  const [txt, setTxt] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!busy) setTxt(value ?? ''); }, [value, busy]);
  const fit = (n) => +Math.max(min, max != null ? Math.min(max, n) : n).toFixed(2);
  const put = (n) => { if (!Number.isFinite(n)) return; n = fit(n); setTxt(String(n)); onLive(n); };
  const scrub = (e) => { // Figma's drag on a label: two pixels a step
    if (e.button !== 0) return;
    e.preventDefault();
    const t = e.currentTarget, x0 = e.clientX, v0 = num(txt) ?? 0;
    t.setPointerCapture(e.pointerId); setBusy(true);
    const move = (m) => put(v0 + Math.round((m.clientX - x0) / 2) * step * (m.shiftKey ? 10 : 1));
    const up = () => { t.removeEventListener('pointermove', move); t.removeEventListener('pointerup', up); t.removeEventListener('pointercancel', up); setBusy(false); };
    t.addEventListener('pointermove', move); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
  };
  return (<label className={cn('dz-fld', changed && 'on')} title={title || label}>
    <span className="dz-lead" onPointerDown={scrub} aria-hidden="true">{icon ? (<Icon n={icon} size={13} />) : label}</span>
    <input type="text" inputMode="decimal" value={txt} aria-label={title || label} spellCheck="false"
      onFocus={(e) => { setBusy(true); e.target.select(); }} onBlur={() => setBusy(false)}
      onChange={(e) => { setTxt(e.target.value); if (NUMERIC.test(e.target.value.trim())) onLive(fit(num(e.target.value))); }}
      onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); put((num(txt) ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)); } else if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />
    {unit && (<span className="dz-unit">{unit}</span>)}
  </label>);
}
// A colour: its swatch opens the picker; its hex can be typed. Changes the page as it changes.
function Colour({ label, value, onLive, changed }) {
  const empty = clear(value), h = empty ? '' : hexOf(value);
  const [txt, setTxt] = useState(h);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!busy) setTxt(h); }, [h, busy]);
  return (<div className={cn('dz-fld dz-colour', changed && 'on')}>
    <label className={cn('dz-sw', empty && 'none')} style={sx(empty ? {} : { background: h })} title={`${label}: pick a colour`}><input type="color" value={h || '#ffffff'} onChange={(e) => { setTxt(e.target.value); onLive(e.target.value); }} aria-label={`${label}, pick a colour`} /></label>
    <input type="text" value={busy || !empty ? txt : 'None'} aria-label={label} spellCheck="false"
      onFocus={(e) => { setBusy(true); if (empty) setTxt('#'); setTimeout(() => e.target.select(), 0); }} onBlur={() => setBusy(false)}
      onChange={(e) => { setTxt(e.target.value); const v = e.target.value.trim().replace(/^#?/, '#'); if (/^#[0-9a-f]{6}$/i.test(v)) onLive(v.toLowerCase()); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />
  </div>);
}
// A few choices as icons in an inset well, the picked one raised.
const Pick = ({ label, value, options, onLive, changed }) => (<div className={cn('dz-pick', changed && 'on')} role="radiogroup" aria-label={label}>
  {options.map(([v, icon, tip]) => (<button key={v} type="button" role="radio" aria-checked={value === v} title={tip} className={cn(value === v && 'on')} onClick={() => onLive(v)}><Icon n={icon} size={14} /></button>))}
</div>);
// A row: its label in the grey column (dark when changed, with the way back) and its controls.
const Row = ({ label, changed, onReset, children }) => (<div className="dz-row">
  <span className={cn('dz-lab', changed && 'on')}>{label}{changed && onReset && (<button type="button" className="dz-reset" title="Back to how it was" aria-label={`${label}: back to how it was`} onClick={onReset}><Icon n="arrow-counter-clockwise" size={12} /></button>)}</span>
  <div className="dz-ctl">{children}</div>
</div>);
// A section that folds and remembers it; the rarer ones start folded.
function Sec({ id, title, open = true, changed = 0, children }) {
  const key = `trace.dz.${id}`;
  const [shut, setShut] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? !open : v === '1'; } catch { return !open; } });
  const toggle = () => { const next = !shut; setShut(next); try { localStorage.setItem(key, next ? '1' : '0'); } catch {} };
  return (<section className="dz-sec">
    <button type="button" className="dz-sh" aria-expanded={!shut} onClick={toggle}><Icon n="caret-down" size={12} cls={cn('dz-caret', shut && 'shut')} /><b>{title}</b>{changed > 0 && (<span className="dz-dot" title={`${changed} changed`} />)}</button>
    {!shut && (<div className="dz-sb">{children}</div>)}
  </section>);
}
const WEIGHTS = [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold']];
function Props({ el, where, edit, changed, onChange, onText, onEditText, onReset, onParent }) {
  const [sides, setSides] = useState(false);
  if (!el) return (<p className="small muted">Pick anything on the app to see how it’s drawn and change it. Switch to <b>Use the app</b> to click through it as a person would.</p>);
  const s = el.style, flex = /flex/.test(s.display), grid = /grid/.test(s.display), column = /column/.test(s.flexDirection);
  const on = (...ks) => ks.some((k) => changed.has(kebab(k))), count = (...ks) => ks.filter((k) => changed.has(kebab(k))).length;
  const back = (...ks) => () => ks.forEach((k) => onReset(kebab(k)));
  const px = (k) => (v) => onChange(k, `${v}px`), both = (a, b) => (v) => { onChange(a, `${v}px`); onChange(b, `${v}px`); };
  const ro = !edit; // read only: the fields show, nothing changes
  const live = (f) => (ro ? () => {} : f);
  const evenSides = num(s.paddingTop) === num(s.paddingBottom) && num(s.paddingLeft) === num(s.paddingRight);
  const PAD = [['paddingTop', 'Top', 'T'], ['paddingRight', 'Right', 'R'], ['paddingBottom', 'Bottom', 'B'], ['paddingLeft', 'Left', 'L']];
  return (<div className="col dz-insp">
    <div className="dz-head">
      <div className="row" style={sx('gap:6px;align-items:center;min-width:0')}>
        <b className="dz-name trunc">{el.comp || `<${el.tag}>`}</b>{el.comp && (<span className="dz-tag">{el.tag}</span>)}<span className="grow"></span>
        <Button variant="ghost" size="icon-compact" aria-label="Pick what holds it" title="Pick what holds it" onClick={onParent}><Icon n="arrow-elbow-left-up" size={15} /></Button>
      </div>
      {el.text && (<span className="small muted trunc">“{el.text}”</span>)}
      <span className="tiny muted mono trunc" title={where?.code || ''}>{where?.file ? `${where.file}${where.line ? `:${where.line}` : ''}` : 'Finding it in the code…'}</span>
    </div>
    {(flex || grid) && (<Sec id="layout" title="Auto layout" changed={count('flexDirection', 'gap', 'alignItems', 'justifyContent')}>
      {flex && (<Row label="Direction" changed={on('flexDirection')} onReset={back('flexDirection')}><Pick label="Direction" value={column ? 'column' : 'row'} options={[['row', 'arrow-right', 'In a row'], ['column', 'arrow-down', 'In a column']]} onLive={live((v) => onChange('flexDirection', v))} /></Row>)}
      <Row label="Gap" changed={on('gap')} onReset={back('gap')}><Num label="Gap" icon="arrows-in-line-horizontal" value={num(s.gap)} changed={on('gap')} onLive={live(px('gap'))} /></Row>
      <Row label="Align" changed={on('alignItems')} onReset={back('alignItems')}><Pick label="Align" value={s.alignItems === 'normal' ? 'stretch' : s.alignItems.replace(/^(start|end)$/, 'flex-$1')} onLive={live((v) => onChange('alignItems', v))}
        options={column ? [['flex-start', 'align-left', 'Left'], ['center', 'align-center-horizontal', 'Centre'], ['flex-end', 'align-right', 'Right'], ['stretch', 'arrows-horizontal', 'Stretch']] : [['flex-start', 'align-top', 'Top'], ['center', 'align-center-vertical', 'Middle'], ['flex-end', 'align-bottom', 'Bottom'], ['stretch', 'arrows-vertical', 'Stretch']]} /></Row>
      {flex && (<Row label="Justify" changed={on('justifyContent')} onReset={back('justifyContent')}><Pick label="Justify" value={s.justifyContent === 'normal' ? 'flex-start' : s.justifyContent.replace(/^(start|end)$/, 'flex-$1')} onLive={live((v) => onChange('justifyContent', v))}
        options={column ? [['flex-start', 'align-top', 'Top'], ['center', 'align-center-vertical', 'Middle'], ['flex-end', 'align-bottom', 'Bottom'], ['space-between', 'arrows-out-line-vertical', 'Space between']] : [['flex-start', 'align-left', 'Start'], ['center', 'align-center-horizontal', 'Centre'], ['flex-end', 'align-right', 'End'], ['space-between', 'arrows-out-line-horizontal', 'Space between']]} /></Row>)}
    </Sec>)}
    <Sec id="size" title="Size" changed={count('width', 'height')}>
      <Row label="Size" changed={on('width', 'height')} onReset={back('width', 'height')}><div className="dz-two"><Num label="W" value={num(s.width)} changed={on('width')} onLive={live(px('width'))} title="Width" /><Num label="H" value={num(s.height)} changed={on('height')} onLive={live(px('height'))} title="Height" /></div></Row>
    </Sec>
    <Sec id="padding" title="Padding" changed={count(...PAD.map((x) => x[0]))}>
      {sides || !evenSides ? PAD.map(([k, label, l]) => (<Row key={k} label={label} changed={on(k)} onReset={back(k)}><Num label={l} value={num(s[k])} changed={on(k)} onLive={live(px(k))} title={`Padding, ${label.toLowerCase()}`} /></Row>))
        : (<Row label="Padding" changed={on(...PAD.map((x) => x[0]))} onReset={back(...PAD.map((x) => x[0]))}><div className="dz-two">
          <Num icon="arrows-horizontal" value={num(s.paddingLeft)} changed={on('paddingLeft', 'paddingRight')} onLive={live(both('paddingLeft', 'paddingRight'))} title="Padding, left and right" />
          <Num icon="arrows-vertical" value={num(s.paddingTop)} changed={on('paddingTop', 'paddingBottom')} onLive={live(both('paddingTop', 'paddingBottom'))} title="Padding, top and bottom" />
        </div></Row>)}
      {evenSides && (<button type="button" className="dz-more" onClick={() => setSides(!sides)}>{sides ? 'Sides together' : 'Each side'}</button>)}
    </Sec>
    {el.editable && (<Sec id="words" title="Text" changed={changed.has('text') ? 1 : 0}>
      <Row label="Words" changed={changed.has('text')} onReset={() => onReset('text')}><Words value={el.content} changed={changed.has('text')} onLive={ro ? () => {} : onText} /></Row>
      {edit && (<button type="button" className="dz-more" onClick={onEditText}>Edit it on the page (or double-click it there)</button>)}
    </Sec>)}
    {el.own && (<Sec id="type" title="Type" changed={count('fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'color')}>
      <Row label="Font"><span className="small trunc" title={s.fontFamily}>{s.fontFamily.split(',')[0].replace(/["']/g, '')}</span></Row>
      <Row label="Size" changed={on('fontSize', 'fontWeight')} onReset={back('fontSize', 'fontWeight')}><div className="dz-two">
        <Num label="Size" icon="text-aa" value={num(s.fontSize)} changed={on('fontSize')} min={1} onLive={live(px('fontSize'))} title="Font size" />
        <label className={cn('dz-fld', on('fontWeight') && 'on')}><select value={String(Math.round(+s.fontWeight / 100) * 100)} disabled={ro} onChange={(e) => onChange('fontWeight', e.target.value)} aria-label="Weight">{!WEIGHTS.some(([v]) => v === String(Math.round(+s.fontWeight / 100) * 100)) && (<option value={s.fontWeight}>{s.fontWeight}</option>)}{WEIGHTS.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}</select></label>
      </div></Row>
      <Row label="Spacing" changed={on('lineHeight', 'letterSpacing')} onReset={back('lineHeight', 'letterSpacing')}><div className="dz-two">
        <Num label="Line" icon="text-align-justify" value={num(s.lineHeight) ?? ''} changed={on('lineHeight')} onLive={live(px('lineHeight'))} title="Line height" />
        <Num label="Letter" icon="arrows-out-line-horizontal" value={num(s.letterSpacing) ?? 0} changed={on('letterSpacing')} min={-20} step={0.1} onLive={live(px('letterSpacing'))} title="Letter spacing" />
      </div></Row>
      <Row label="Align" changed={on('textAlign')} onReset={back('textAlign')}><Pick label="Text align" value={s.textAlign === 'start' ? 'left' : s.textAlign === 'end' ? 'right' : s.textAlign} onLive={live((v) => onChange('textAlign', v))} options={[['left', 'text-align-left', 'Left'], ['center', 'text-align-center', 'Centre'], ['right', 'text-align-right', 'Right'], ['justify', 'text-align-justify', 'Justified']]} /></Row>
      <Row label="Colour" changed={on('color')} onReset={back('color')}><Colour label="Text colour" value={s.color} changed={on('color')} onLive={live((v) => onChange('color', v))} /></Row>
    </Sec>)}
    <Sec id="fill" title="Fill" changed={count('backgroundColor')}>
      <Row label="Fill" changed={on('backgroundColor')} onReset={back('backgroundColor')}><Colour label="Fill" value={s.backgroundColor} changed={on('backgroundColor')} onLive={live((v) => onChange('backgroundColor', v))} /></Row>
    </Sec>
    <Sec id="stroke" title="Stroke" open={parseFloat(s.borderTopWidth) > 0} changed={count('borderWidth', 'borderColor')}>
      <Row label="Width" changed={on('borderWidth')} onReset={back('borderWidth', 'borderStyle')}><Num label="Width" icon="square" value={num(s.borderTopWidth)} changed={on('borderWidth')} onLive={live((v) => { if (s.borderTopStyle === 'none') onChange('borderStyle', 'solid'); onChange('borderWidth', `${v}px`); })} title="Stroke width" /></Row>
      <Row label="Colour" changed={on('borderColor')} onReset={back('borderColor')}><Colour label="Stroke colour" value={parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : ''} changed={on('borderColor')} onLive={live((v) => onChange('borderColor', v))} /></Row>
    </Sec>
    <Sec id="corners" title="Corners" changed={count('borderRadius')}>
      <Row label="Radius" changed={on('borderRadius')} onReset={back('borderRadius')}><Num label="Radius" icon="corners-out" value={num(s.borderRadius)} changed={on('borderRadius')} onLive={live(px('borderRadius'))} title="Corner radius" /></Row>
    </Sec>
    <Sec id="opacity" title="Opacity" open={+s.opacity < 1} changed={count('opacity')}>
      <Row label="Opacity" changed={on('opacity')} onReset={back('opacity')}><Num label="Opacity" icon="drop-half" value={Math.round((+s.opacity || 0) * 100)} unit="%" max={100} changed={on('opacity')} onLive={live((v) => onChange('opacity', String(+(v / 100).toFixed(2))))} /></Row>
    </Sec>
  </div>);
}

// The code of what's picked: its file, opened at its line, to read and change. Saved, the app reloads and the canvas
// shows it. A save never overwrites what changed since it was opened (Claude, the canvas writing, another editor).
function Code({ p, where, edit, stamp }) {
  const file = where?.file;
  const c = useFetch(file ? `/projects/${p.id}/design/code?file=${encodeURIComponent(file)}` : null);
  const [txt, setTxt] = useState(null);
  const box = useRef();
  const dirty = !!c.data && txt !== null && txt !== c.data.text;
  useEffect(() => { if (c.data?.file === file) setTxt(c.data.text); }, [c.data]);
  useEffect(() => { if (!dirty) c.reload(); }, [stamp]); // written to by the canvas: the file as it is now
  useEffect(() => { // open at its line
    const t = box.current;
    if (!t || !c.data || !where?.line) return;
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 18;
    t.scrollTop = Math.max(0, (where.line - 6) * lh);
  }, [c.data?.hash, where?.line, txt === null]); // once the editor is on screen
  const saveIt = async () => {
    try { const r = await api(`/projects/${p.id}/design/code`, { method: 'POST', body: { file, text: txt, hash: c.data.hash } }); c.set({ ...c.data, text: txt, hash: r.hash }); toast('Saved', { sub: `${file}: the canvas shows it as the app reloads.` }); }
    catch (e) { fail(e); }
  };
  if (!file) return (<p className="small muted">Pick something on the app to open its code here.</p>);
  const lines = (txt ?? '').split('\n').length;
  return (<div className="col dz-codewrap">
    <div className="row" style={sx('gap:6px;align-items:center;min-width:0')}>
      <span className="tiny muted mono trunc grow" title={file}>{file}{where.line ? `:${where.line}` : ''}</span>
      {dirty && (<span className="tiny">Not saved</span>)}
      <Button variant="ghost" size="compact" onClick={() => { setTxt(null); c.reload(); }} title="The file as it is on disk">Reload</Button>
      {edit && (<Button variant="primary" size="compact" aria-disabled={!dirty} onClick={() => dirty && saveIt()}>Save</Button>)}
    </div>
    {c.error ? (<p className="small muted">{c.error.message}</p>) : txt === null ? (<p className="small muted">Opening {file}…</p>) : (<div className="dz-code">
      <pre className="dz-gut" aria-hidden="true">{Array.from({ length: lines }, (_, i) => (<span key={i} className={cn(i + 1 === where.line && 'on')}>{i + 1}</span>))}</pre>
      <textarea ref={box} value={txt} spellCheck="false" readOnly={!edit} aria-label={`${file}, its code`} wrap="off"
        onScroll={(e) => { const g = e.currentTarget.previousSibling; if (g) g.scrollTop = e.currentTarget.scrollTop; }}
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) saveIt(); }
          else if (e.key === 'Tab') { e.preventDefault(); const t = e.currentTarget, a = t.selectionStart; t.setRangeText('  ', a, t.selectionEnd, 'end'); setTxt(t.value); }
        }} />
    </div>)}
    <span className="tiny muted">Ctrl S saves. The canvas follows the file: what you save here, and what Claude changes, shows on it as the app reloads.</span>
  </div>);
}
// The words of what's picked, as a field: changes the page as you type.
function Words({ value, onLive, changed }) {
  const [txt, setTxt] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!busy) setTxt(value ?? ''); }, [value, busy]);
  return (<textarea className={cn('dz-fld dz-words', changed && 'on')} rows={Math.min(4, Math.max(1, Math.ceil((txt.length || 1) / 28)))} value={txt} aria-label="Its words" spellCheck="true"
    onFocus={() => setBusy(true)} onBlur={() => setBusy(false)} onChange={(e) => { setTxt(e.target.value); onLive(e.target.value); }} onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }} />);
}

function Changes({ p, edits, edit, onDrop, onSent }) {
  const [note, setNote] = useState('');
  const drafts = edits.filter((x) => x.status === 'draft'), inCode = edits.filter((x) => x.status === 'written'), rest = edits.filter((x) => x.status !== 'draft' && x.status !== 'written').slice(-12).reverse();
  const sendIt = async (now) => {
    try {
      const r = await api(`/projects/${p.id}/design/send`, { method: 'POST', body: { note } });
      if (now) { const c = await api('/comments', { method: 'POST', body: { target_type: 'version', target_id: `${p.id}:now`, body: `@claude ${r.brief}` } }); if (c.claude_error) throw new Error(c.claude_error); }
      const d = await api(`/projects/${p.id}/design`);
      onSent(d.edits); setNote('');
      toast(now ? 'Claude is on it' : 'Ready for Claude Code', { sub: now ? 'It writes them in the project’s folder; the canvas shows the result as it reloads.' : 'In your Claude Code session, say “apply my canvas changes”: it takes them with the trace-design skill.' });
    } catch (e) { fail(e); }
  };
  const line = (x) => (<div key={x.id} className="dz-ch">
    <span className="col grow" style={sx('gap:2px;min-width:0')}>
      <span className="small"><b>{x.comp || `<${x.tag}>`}</b> {x.prop === 'text' ? (<>words <span className="mono">“{said(x.from, 30)}” → “{said(x.to, 30)}”</span></>) : (<>{x.prop} <span className="mono">{x.from} → {x.to}</span></>)}</span>
      <span className="tiny muted mono trunc">{x.file ? `${x.file}${x.line ? `:${x.line}` : ''}` : 'not found in the code'}{x.tw ? ` · ${x.tw.replace.length ? `${x.tw.replace.join(' ')} → ` : '+ '}${x.tw.add}` : ''}</span>
    </span>
    {x.status === 'draft' || x.status === 'written' ? (edit && (<Button variant="ghost" size="icon-compact" aria-label={x.status === 'written' ? 'Take it back out of the code' : 'Undo this change'} title={x.status === 'written' ? 'Take it back out of the code' : 'Undo this change'} onClick={() => onDrop(x)}><Icon n="x" size={14} /></Button>)) : (<span className="tiny muted">{x.status === 'sent' ? 'waiting for Claude' : x.status === 'taken' ? 'Claude is on it' : 'in the code'}</span>)}
  </div>);
  return (<div className="col" style={sx('gap:12px')}>
    {drafts.length ? drafts.map(line) : (<p className="small muted">Nothing changed yet. What you change in Design shows here with where it lives in the code.</p>)}
    {edit && drafts.length > 0 && (<div className="col" style={sx('gap:8px')}>
      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it’s for (optional), e.g. “calmer header”" aria-label="What the changes are for" />
      <div className="row wrap" style={sx('gap:6px')}><Button variant="primary" size="compact" onClick={() => sendIt(false)}>Send to Claude Code</Button><Button variant="ghost" size="compact" onClick={() => sendIt(true)}>Have Claude apply them now</Button></div>
    </div>)}
    {inCode.length > 0 && (<section className="col" style={sx('gap:6px')}><span className="hx-k">Written to the code by Trace</span>{inCode.map(line)}</section>)}
    {rest.length > 0 && (<section className="col" style={sx('gap:6px')}><span className="hx-k">Sent</span>{rest.map(line)}</section>)}
  </div>);
}

function Context({ p, el, edits }) {
  const s = useFetch(`/projects/${p.id}/design/session`);
  useEffect(() => { const t = setInterval(() => s.reload(), 4000); return () => clearInterval(t); }, []);
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState([]);
  const [busy, setBusy] = useState(false);
  const ask = async (e) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    try { const r = await api(`/projects/${p.id}/design/ask`, { method: 'POST', body: { q, el, edits } }); setAnswers((a) => [{ q, a: r.text }, ...a].slice(0, 6)); setQ(''); } catch (er) { fail(er); }
    setBusy(false);
  };
  const turns = [...(s.data?.turns || [])].reverse();
  return (<div className="col" style={sx('gap:16px')}>
    <form className="col" style={sx('gap:6px')} onSubmit={ask}>
      <span className="hx-k">Ask Trace</span>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={el ? `About ${el.comp || el.tag}, your changes, the session…` : 'About the app, your changes, the session…'} aria-label="Ask Trace" disabled={busy} />
      {busy && (<span className="tiny muted">Thinking with the canvas and the session…</span>)}
      {answers.map((x, i) => (<div key={i} className="dz-ans"><span className="tiny muted">{x.q}</span><p className="small" style={sx('white-space:pre-wrap')}>{x.a}</p></div>))}
    </form>
    <section className="col" style={sx('gap:8px')}><span className="hx-k">The session now{s.data?.at ? ` · ${rel(s.data.at)}` : ''}</span>
      {!turns.length ? (<p className="small muted">No Claude Code session in this project’s folder yet.</p>) : turns.map((t, i) => (<div key={i} className="dz-turn">
        <span className="small"><b>You</b> {said(t.ask, 200)}</span>
        {t.thinking && (<span className="small muted"><b>Claude thought</b> {said(t.thinking, 240)}</span>)}
        {t.reply && (<span className="small ink2"><b>Claude</b> {said(t.reply, 240)}</span>)}
        {t.files.length > 0 && (<span className="tiny muted mono trunc">{plural(t.files.length, 'file')}: {t.files.join(', ')}</span>)}
      </div>))}
    </section>
  </div>);
}
