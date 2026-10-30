// The tree: every version as a node on a canvas, joined to the one it came from, with what it looks like, when it
// was made and who made it (code saved while an AI was working is the AI's). Whole project: the main line, with
// explorations branching below and "evolved into" links dashed. One component: each drawn version of that file.
import { useState, useEffect, useRef, useMemo, useFetch, Icon, Avatar, ErrorBox, Loading, fileUrl, go, plural, Button, sx } from '../lib.jsx';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Sentence, dayLabel, time } from './ncs.jsx';

const W = 228, H = 214, GX = 64, GY = 76, PAD = 48;

export function Tree({ p }) {
  const [asset, setAsset] = useState('');
  const { data, error, reload } = useFetch(`/projects/${p.id}/tree${asset ? `?asset=${asset}` : ''}`, ['moment', 'project'], (t, d) => !d.project_id || d.project_id === p.id);
  const [view, setView] = useState(null);
  const [sel, setSel] = useState(null);
  const box = useRef(), drag = useRef(null);

  // Layout: one row per lane, columns in time order across all lanes, so branches line up with when they happened.
  const lay = useMemo(() => {
    if (!data) return null;
    const lanes = data.lanes.filter((l) => data.nodes.some((n) => n.lane === l.id));
    const row = Object.fromEntries(lanes.map((l, i) => [l.id, i]));
    const pos = {};
    data.nodes.forEach((n, i) => { pos[n.id] = { x: PAD + i * (W + GX), y: PAD + 26 + (row[n.lane] ?? 0) * (H + GY) }; });
    return { lanes, row, pos, w: PAD * 2 + data.nodes.length * (W + GX), h: PAD * 2 + 26 + lanes.length * (H + GY) };
  }, [data]);
  useEffect(() => { // open on the newest work, like NCS opens on where the project stands now
    if (!lay || !box.current) return;
    const bw = box.current.clientWidth;
    setView({ k: 1, x: Math.min(0, bw - lay.w), y: 0 });
    setSel(null);
  }, [lay]);

  const start = (e) => { if (e.button !== 0 || e.target.closest('.tnode, .tpanel, .zoom')) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, o: view }; };
  const move = (e) => { const d = drag.current; if (d) setView({ ...d.o, x: d.o.x + e.clientX - d.sx, y: d.o.y + e.clientY - d.sy }); };
  const end = () => { drag.current = null; };
  const zoom = (f, e) => { const k = Math.max(0.3, Math.min(1.8, view.k * f)); const b = box.current.getBoundingClientRect(); const cx = e ? e.clientX - b.left : b.width / 2, cy = e ? e.clientY - b.top : b.height / 2; setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k }); };
  const fit = () => { const b = box.current.getBoundingClientRect(); const k = Math.max(0.3, Math.min(1, b.width / lay.w, b.height / lay.h)); setView({ k, x: (b.width - lay.w * k) / 2, y: 0 }); };

  if (error) return (<ErrorBox error={error} retry={reload}  />);
  const node = data && sel && data.nodes.find((n) => n.id === sel);
  const open = (n) => (data.mode === 'asset' ? n.moment && go(`/m/${n.moment}`) : go(`/m/${n.id}`));
  const curve = (a, b) => { const x1 = a.x + W, y1 = a.y + 70, x2 = b.x, y2 = b.y + 70, mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };
  return (<div className="col" style={sx("gap:12px;padding-top:14px")}>
    <div className="row wrap" style={sx("gap:10px")}>
      <label className="row small"><span className="muted">Show</span>
        <NativeSelect className="sm" style={sx("width:auto")} value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="What the tree shows">
          <NativeSelectOption value="">Every change in {p.name}</NativeSelectOption>
          {data?.components.length > 0 && (<optgroup label="One component, every version">{data.components.map((c, ki) => (<NativeSelectOption key={c?.id ?? ki} value={c.id}>{c.name} · {plural(c.versions, 'version')}</NativeSelectOption>))}</optgroup>)}
        </NativeSelect></label>
      <span className="grow"></span>
      <span className="legend small muted"><i className="solid"></i>came from <i className="dash"></i>evolved into</span>
    </div>
    {!data ? (<Loading h={420}  />) : !data.nodes.length ? (<div className="empty"><Icon n="tree-structure" cls="big"  /><h2>No versions yet</h2><p>Every accepted change becomes a node here, joined to the one it came from.</p></div>)
    : (<div className="tree" ref={box} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onWheel={(e) => { if (!view) return; if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e); } else setView({ ...view, x: view.x - (e.shiftKey ? e.deltaY : e.deltaX), y: view.y - (e.shiftKey ? 0 : e.deltaY) }); }}
        aria-label="Version tree: drag to move around, Ctrl + wheel to zoom">
      {view && (<div className="plane" style={sx({ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: `${lay.w}px`, height: `${lay.h}px` })}>
        {lay.lanes.map((l, ki) => (<div key={l?.id ?? ki} className="tlane" style={sx({ top: `${PAD + lay.row[l.id] * (H + GY)}px`, left: `${PAD}px` })}>{l.name}</div>))}
        <svg className="tedges" width={lay.w} height={lay.h} aria-hidden="true">
          {data.nodes.filter((n) => n.parent && lay.pos[n.parent]).map((n, ki) => (<path key={n?.id ?? ki} d={curve(lay.pos[n.parent], lay.pos[n.id])}  />))}
          {data.links.map((l, ki) => lay.pos[l.from_id] && lay.pos[l.to_id] && (<path key={l?.id ?? ki} className="dash" d={curve(lay.pos[l.from_id], lay.pos[l.to_id])}  />))}
        </svg>
        {data.nodes.map((n, ki) => (<button key={n?.id ?? ki} className={`tnode${sel === n.id ? ' sel' : ''}${n.error ? ' undrawn' : ''}`} style={sx({ left: `${lay.pos[n.id].x}px`, top: `${lay.pos[n.id].y}px`, width: `${W}px` })}
            onClick={() => setSel(sel === n.id ? null : n.id)} onDoubleClick={() => open(n)} onKeyDown={(e) => e.key === 'Enter' && e.shiftKey && open(n)} aria-pressed={sel === n.id}
            aria-label={`${n.title}, by ${n.who}, ${dayLabel(n.when)} ${time(n.when)}`}>
          <span className="timg">{n.image ? (<img src={fileUrl(n.image.thumb_key || n.image.image_key)} alt="" loading="lazy" draggable="false"  />) : (<Icon n={n.error ? 'code' : 'image'}  />)}</span>
          <span className="tt clamp2">{n.title}</span>
          <span className="tmeta"><Avatar name={n.who} agent={n.agent}  /><span className="trunc">{n.who}</span><span className="muted">· {dayLabel(n.when)} {time(n.when)}</span></span>
          {n.asked && (<span className="task clamp2">Asked: {n.asked}</span>)}
        </button>))}
      </div>)}
      {node && (<div className="tpanel clog">
        <div className="clog-h"><Avatar name={node.who} agent={node.agent}  /><b className="trunc">{node.who}</b><span className="tools"><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={() => setSel(null)}><Icon n="x" size={15} /></Button></span></div>
        <h3>{node.title}</h3>
        {node.sentence ? (<Sentence seg={node.sentence}  />) : node.moment_title && (<p className="small ink2">Part of “{node.moment_title}”</p>)}
        {node.error && (<p className="small muted">Not drawn: {node.error}</p>)}
        {node.asked && (<p className="small ink2"><span className="muted">You asked {node.who}: </span>{node.asked}</p>)}
        <p className="tiny muted">{dayLabel(node.when)} {time(node.when)}{node.files ? ` · ${plural(node.files, 'file')}` : ''}</p>
        {(data.mode !== 'asset' || node.moment) && (<Button variant="primary" size="compact" onClick={() => open(node)}>Open the change<Icon n="arrow-right" /></Button>)}
      </div>)}
      <div className="zoom row"><Button variant="tertiary" size="icon-compact" aria-label="Zoom out" onClick={() => zoom(0.8)}><Icon n="minus" size={15} /></Button><span className="small num" style={sx("min-width:42px;text-align:center")}>{Math.round((view?.k || 1) * 100)}%</span><Button variant="tertiary" size="icon-compact" aria-label="Zoom in" onClick={() => zoom(1.25)}><Icon n="plus" size={15} /></Button><Button variant="tertiary" size="compact" onClick={fit}>Fit</Button></div>
    </div>)}
    <p className="tiny muted">Click a node for its changes, double-click (or Shift + Enter) to open it. Drag the canvas to move around.</p>
  </div>);
}
