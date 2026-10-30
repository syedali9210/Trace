// Workflow visualizer: draw the process (stages, tools, people, AI agents, arrows). Nodes linked to real
// sources, people and agents light up with today's activity. Trace can draft one from what it observed.
import { useState, useEffect, useRef, api, useFetch, Icon, ErrorBox, Loading, Field, toast, fail, TOOLS, Button, ph, sx } from '../lib.jsx';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

const KINDS = { stage: { icon: 'flag-banner', label: 'Stage' }, tool: { icon: 'wrench', label: 'Tool' }, person: { icon: 'user', label: 'Person' }, agent: { icon: 'sparkle', label: 'AI agent' } };
const uid = () => `n_${Math.random().toString(36).slice(2, 9)}`;

export function Workflow({ p }) {
  const wf = useFetch(`/projects/${p.id}/workflow`);
  const act = useFetch(`/projects/${p.id}/workflow/activity`, ['capture', 'moment', 'artifact', 'reference']);
  const sources = useFetch(p.can_edit ? '/sources' : null);
  const members = useFetch(p.can_edit ? '/members' : null);
  const [g, setG] = useState(null);
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null);
  const [wire, setWire] = useState(null);
  const box = useRef();
  const saveT = useRef();
  useEffect(() => { if (wf.data && !g) setG(wf.data); }, [wf.data]);
  const commit = (next) => { setG(next); if (!p.can_edit) return; clearTimeout(saveT.current); saveT.current = setTimeout(() => api(`/projects/${p.id}/workflow`, { method: 'PUT', body: next }).catch(fail), 500); };
  if (wf.error) return (<ErrorBox error={wf.error} retry={wf.reload}  />);
  if (!g) return (<Loading h={400}  />);
  const live = (n) => {
    const a = act.data, l = n.link;
    if (!a || !l) return 0;
    return l.type === 'source' ? a.source[l.id] || 0 : l.type === 'user' ? a.user?.[l.id] || 0 : l.type === 'person' ? a.person?.[l.id] || 0 : l.type === 'agent' ? a.agent[l.id] || 0 : l.type === 'asks' ? a.asks || 0 : l.type === 'versions' ? a.versions || 0 : l.type === 'inbox' ? a.inbox : l.type === 'project' ? a.project : 0;
  };
  const liveWord = (n) => (n.link?.type === 'inbox' ? 'waiting' : n.link?.type === 'asks' ? 'asks this week' : ['agent', 'person', 'versions'].includes(n.link?.type) ? 'versions this week' : 'this week');
  const add = (kind) => { const n = { id: uid(), kind, label: KINDS[kind].label, x: 40 + g.nodes.length * 24, y: 40 + g.nodes.length * 24 }; commit({ ...g, nodes: [...g.nodes, n] }); setSel(n.id); };
  const draft = async () => {
    try {
      const prev = g;
      const d = await api(`/projects/${p.id}/workflow/draft`, { method: 'POST' });
      commit({ nodes: d.nodes, edges: d.edges });
      toast('Drafted from what Trace saw in this project. Edit anything.', { action: { label: 'Undo', fn: () => commit(prev) } });
    } catch (e) { fail(e); }
  };
  const at = (e) => { const b = box.current.getBoundingClientRect(); return { x: e.clientX - b.left + box.current.scrollLeft, y: e.clientY - b.top + box.current.scrollTop }; };
  const onMove = (e) => {
    if (drag) { const pt = at(e); setG({ ...g, nodes: g.nodes.map((n) => (n.id === drag.id ? { ...n, x: Math.max(0, pt.x - drag.dx), y: Math.max(0, pt.y - drag.dy) } : n)) }); }
    if (wire) setWire({ ...wire, ...at(e) });
  };
  const onUp = (e) => {
    if (drag) { commit(g); setDrag(null); }
    if (wire) {
      const target = e.target.closest?.('.fnode')?.dataset.id;
      if (target && target !== wire.from && !g.edges.some((x) => x.from === wire.from && x.to === target)) commit({ ...g, edges: [...g.edges, { from: wire.from, to: target }] });
      setWire(null);
    }
  };
  const node = g.nodes.find((n) => n.id === sel);
  const patch = (o) => commit({ ...g, nodes: g.nodes.map((n) => (n.id === sel ? { ...n, ...o } : n)) });
  const remove = () => { commit({ nodes: g.nodes.filter((n) => n.id !== sel), edges: g.edges.filter((x) => x.from !== sel && x.to !== sel) }); setSel(null); };
  const W = 168, H = 64;
  const pos = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const curve = (a, b) => { const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, c = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`; };
  const linkOptions = [
    ['', 'Not linked'], ['project', 'This project (references)'], ['inbox', 'Review inbox'],
    ...(sources.data?.sources || []).map((s) => [`source:${s.id}`, `Source: ${s.name}`]),
    ...(members.data?.members || []).concat(members.data?.people?.filter((x) => !x.is_agent) || []).map((m) => [`user:${m.id}`, `Person: ${m.name}`]),
    ...['Claude Code', 'Cursor', 'Trace AI'].map((a) => [`agent:${a}`, `Agent: ${a}`]),
  ];
  return (<div className="col" style={sx("gap:12px;padding-top:16px")}>
    {p.can_edit && (<div className="row wrap">
      {Object.entries(KINDS).map(([k, v], ki) => (<Button key={ki} variant="tertiary" size="compact" leadingIcon={ph(v.icon)} onClick={() => add(k)}>{v.label}</Button>))}
      <span className="grow"></span>
      <Button variant="tertiary" size="compact" leadingIcon={ph("sparkle")} onClick={draft}>Draft from activity</Button>
    </div>)}
    <div style={sx(`display:grid;grid-template-columns:minmax(0,1fr) ${node ? '280px' : '0'};gap:16px`)}>
      <div className="flow" ref={box} onPointerMove={onMove} onPointerUp={onUp} onPointerDown={(e) => { if (e.target === box.current) setSel(null); }}
        onKeyDown={(e) => { if (!node || e.target.closest('input,select')) return; if (e.key === 'Delete' || e.key === 'Backspace') remove(); const d = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key]; if (d) { e.preventDefault(); patch({ x: node.x + d[0], y: node.y + d[1] }); } }}>
        <svg className="edges" width="3000" height="2000" aria-hidden="true">
          {g.edges.map((x, ki) => pos[x.from] && pos[x.to] && (<path key={x?.id ?? ki} d={curve(pos[x.from], pos[x.to])} className={live(pos[x.from]) ? 'live' : ''}  />))}
          {wire && pos[wire.from] && (<path d={curve(pos[wire.from], { x: wire.x, y: wire.y - H / 2 })} className="live"  />)}
        </svg>
        {!g.nodes.length && (<div style={sx("position:absolute;inset:0;display:grid;place-items:center;pointer-events:none")}><div className="empty" style={sx("pointer-events:auto;background:var(--panel)")}><Icon n="flow-arrow" cls="big"  /><h2>Map how this project gets made</h2><p>Add stages, tools, people and agents, then drag from a node’s right edge to connect them. Or let Trace draft it from what it saw.</p>{p.can_edit && (<Button variant="primary" size="default" onClick={draft}>Draft from activity</Button>)}</div></div>)}
        {g.nodes.map((n, ki) => { const c = live(n); return (<div key={n?.id ?? ki} className={`fnode${c ? ' live' : ''}`} data-id={n.id} tabIndex="0" role="button" aria-pressed={n.id === sel} aria-label={`${KINDS[n.kind]?.label}: ${n.label}${c ? `, ${c} ${liveWord(n)}` : ''}`}
            style={sx({ left: `${n.x}px`, top: `${n.y}px` })} onFocus={() => setSel(n.id)}
            onPointerDown={(e) => { if (e.target.classList.contains('port') || !p.can_edit) return setSel(n.id); e.currentTarget.parentElement.setPointerCapture(e.pointerId); const pt = at(e); setDrag({ id: n.id, dx: pt.x - n.x, dy: pt.y - n.y }); setSel(n.id); }}>
          <div className="row" style={sx("gap:6px")}><Icon n={n.tool ? TOOLS[n.tool]?.icon || KINDS[n.kind].icon : KINDS[n.kind]?.icon || 'circle'} cls={n.tool ? `tool-ico k-${n.tool}` : n.kind === 'agent' ? 'tool-ico k-agent' : ''}  /><b className="small trunc">{n.label}</b></div>
          <span className="tiny muted">{KINDS[n.kind]?.label}{n.link ? ' · linked' : ''}</span>
          {c > 0 && (<span className="act">{c} {liveWord(n)}</span>)}
          {p.can_edit && (<span className="port" title="Drag to connect" onPointerDown={(e) => { e.stopPropagation(); box.current.setPointerCapture(e.pointerId); setWire({ from: n.id, ...at(e) }); }}></span>)}
        </div>); })}
      </div>
      {node && (<aside className="panel col" style={sx("gap:12px;align-self:start")} aria-label="Node">
        <div className="row"><span className="caps grow">{KINDS[node.kind]?.label}</span><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={() => setSel(null)}><Icon n="x" size={15} /></Button></div>
        {p.can_edit ? <><Field label="Label"><Input value={node.label} onChange={(e) => patch({ label: e.target.value })} /></Field>
          <Field label="Kind"><NativeSelect value={node.kind} onChange={(e) => patch({ kind: e.target.value })}>{Object.entries(KINDS).map(([k, v], ki) => (<NativeSelectOption key={ki} value={k}>{v.label}</NativeSelectOption>))}</NativeSelect></Field>
          <Field label="Linked to" hint="Linked nodes light up with live activity."><NativeSelect value={node.link ? `${node.link.type}${node.link.id ? `:${node.link.id}` : ''}` : ''} onChange={(e) => { const [type, ...rest] = e.target.value.split(':'); patch({ link: type ? { type, id: rest.join(':') || undefined } : null }); }}>{linkOptions.map(([v, l], ki) => (<NativeSelectOption key={ki} value={v}>{l}</NativeSelectOption>))}</NativeSelect></Field>
          <div className="col" style={sx("gap:4px")}><span className="tiny muted">Arrows out</span>{g.edges.filter((x) => x.from === node.id).map((x, ki) => (<div key={x?.id ?? ki} className="row small"><span className="grow trunc">→ {pos[x.to]?.label}</span><Button variant="ghost" size="compact" onClick={() => commit({ ...g, edges: g.edges.filter((y) => y !== x) })}>Remove</Button></div>))}{!g.edges.some((x) => x.from === node.id) && (<span className="tiny muted">Drag from the dot on its right edge to another node.</span>)}</div>
          <Button variant="tertiary" size="compact" className="text-destructive" leadingIcon={ph("trash")} onClick={remove}>Delete node</Button></>
        : (<b>{node.label}</b>)}
      </aside>)}
    </div>
  </div>);
}
