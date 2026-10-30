// Workflow visualizer: draw the process (stages, tools, people, AI agents, arrows). Nodes linked to real
// sources, people and agents light up with today's activity. Trace can draft one from what it observed.
import { html, useState, useEffect, useRef, api, useFetch, Icon, ErrorBox, Loading, Field, toast, fail, TOOLS } from '../lib.js';

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
  if (wf.error) return html`<${ErrorBox} error=${wf.error} retry=${wf.reload} />`;
  if (!g) return html`<${Loading} h=${400} />`;
  const live = (n) => {
    const a = act.data, l = n.link;
    if (!a || !l) return 0;
    return l.type === 'source' ? a.source[l.id] || 0 : l.type === 'user' ? a.user[l.id] || 0 : l.type === 'agent' ? a.agent[l.id] || 0 : l.type === 'inbox' ? a.inbox : l.type === 'project' ? a.project : 0;
  };
  const liveWord = (n) => (n.link?.type === 'inbox' ? 'waiting' : 'today');
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
  return html`<div class="col" style="gap:12px;padding-top:16px">
    ${p.can_edit && html`<div class="row wrap">
      ${Object.entries(KINDS).map(([k, v]) => html`<button class="btn sm" onClick=${() => add(k)}><${Icon} n=${v.icon} />${v.label}</button>`)}
      <span class="grow"></span>
      <button class="btn sm" onClick=${draft}><${Icon} n="sparkle" />Draft from activity</button>
    </div>`}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) ${node ? '280px' : '0'};gap:16px">
      <div class="flow" ref=${box} onPointerMove=${onMove} onPointerUp=${onUp} onPointerDown=${(e) => { if (e.target === box.current) setSel(null); }}
        onKeyDown=${(e) => { if (!node || e.target.closest('input,select')) return; if (e.key === 'Delete' || e.key === 'Backspace') remove(); const d = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key]; if (d) { e.preventDefault(); patch({ x: node.x + d[0], y: node.y + d[1] }); } }}>
        <svg class="edges" width="3000" height="2000" aria-hidden="true">
          ${g.edges.map((x) => pos[x.from] && pos[x.to] && html`<path d=${curve(pos[x.from], pos[x.to])} class=${live(pos[x.from]) ? 'live' : ''} />`)}
          ${wire && pos[wire.from] && html`<path d=${curve(pos[wire.from], { x: wire.x, y: wire.y - H / 2 })} class="live" />`}
        </svg>
        ${!g.nodes.length && html`<div style="position:absolute;inset:0;display:grid;place-items:center;pointer-events:none"><div class="empty" style="pointer-events:auto;background:var(--panel)"><${Icon} n="flow-arrow" cls="big" /><h2>Map how this project gets made</h2><p>Add stages, tools, people and agents, then drag from a node’s right edge to connect them. Or let Trace draft it from what it saw.</p>${p.can_edit && html`<button class="btn primary" onClick=${draft}>Draft from activity</button>`}</div></div>`}
        ${g.nodes.map((n) => { const c = live(n); return html`<div class=${`fnode${c ? ' live' : ''}`} data-id=${n.id} tabindex="0" role="button" aria-pressed=${n.id === sel} aria-label=${`${KINDS[n.kind]?.label}: ${n.label}${c ? `, ${c} ${liveWord(n)}` : ''}`}
            style=${{ left: `${n.x}px`, top: `${n.y}px` }} onFocus=${() => setSel(n.id)}
            onPointerDown=${(e) => { if (e.target.classList.contains('port') || !p.can_edit) return setSel(n.id); e.currentTarget.parentElement.setPointerCapture(e.pointerId); const pt = at(e); setDrag({ id: n.id, dx: pt.x - n.x, dy: pt.y - n.y }); setSel(n.id); }}>
          <div class="row" style="gap:6px"><${Icon} n=${n.tool ? TOOLS[n.tool]?.icon || KINDS[n.kind].icon : KINDS[n.kind]?.icon || 'circle'} cls=${n.tool ? `tool-ico k-${n.tool}` : n.kind === 'agent' ? 'tool-ico k-agent' : ''} /><b class="small trunc">${n.label}</b></div>
          <span class="tiny muted">${KINDS[n.kind]?.label}${n.link ? ' · linked' : ''}</span>
          ${c > 0 && html`<span class="act">${c} ${liveWord(n)}</span>`}
          ${p.can_edit && html`<span class="port" title="Drag to connect" onPointerDown=${(e) => { e.stopPropagation(); box.current.setPointerCapture(e.pointerId); setWire({ from: n.id, ...at(e) }); }}></span>`}
        </div>`; })}
      </div>
      ${node && html`<aside class="panel col" style="gap:12px;align-self:start" aria-label="Node">
        <div class="row"><span class="caps grow">${KINDS[node.kind]?.label}</span><button class="btn ghost icon sm" aria-label="Close" onClick=${() => setSel(null)}><${Icon} n="x" /></button></div>
        ${p.can_edit ? html`
          <${Field} label="Label"><input class="input" value=${node.label} onInput=${(e) => patch({ label: e.target.value })} /></${Field}>
          <${Field} label="Kind"><select class="input" value=${node.kind} onChange=${(e) => patch({ kind: e.target.value })}>${Object.entries(KINDS).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</select></${Field}>
          <${Field} label="Linked to" hint="Linked nodes light up with live activity."><select class="input" value=${node.link ? `${node.link.type}${node.link.id ? `:${node.link.id}` : ''}` : ''} onChange=${(e) => { const [type, ...rest] = e.target.value.split(':'); patch({ link: type ? { type, id: rest.join(':') || undefined } : null }); }}>${linkOptions.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></${Field}>
          <div class="col" style="gap:4px"><span class="tiny muted">Arrows out</span>${g.edges.filter((x) => x.from === node.id).map((x) => html`<div class="row small"><span class="grow trunc">→ ${pos[x.to]?.label}</span><button class="btn ghost sm" onClick=${() => commit({ ...g, edges: g.edges.filter((y) => y !== x) })}>Remove</button></div>`)}${!g.edges.some((x) => x.from === node.id) && html`<span class="tiny muted">Drag from the dot on its right edge to another node.</span>`}</div>
          <button class="btn sm danger" onClick=${remove}><${Icon} n="trash" />Delete node</button>`
        : html`<b>${node.label}</b>`}
      </aside>`}
    </div>
  </div>`;
}
