// References: pictures, videos, links, notes, colours and fonts, as a grid or a free canvas. Each can be pinned
// to the change it informed; pictures you pasted into a prompt to your AI arrive here pinned already.
import { html, useState, useEffect, useRef, useMemo, api, useFetch, Icon, Empty, ErrorBox, Loading, Seg, Dialog, Field, Menu, fileUrl, toast, fail, plural, rel } from '../lib.js';
import { AddLink } from './dialogs.js';
import { Lightbox } from './journey.js';

function RefBody({ r, onOpen }) {
  if (r.kind === 'color') return html`<div style=${{ height: '120px', background: r.palette[0] }}></div>`;
  if (r.kind === 'font') return html`<div style=${{ padding: '24px 12px', fontFamily: `'${r.title.replace(/\s*\(.*\)/, '')}', serif`, fontSize: '40px', lineHeight: 1.1, background: 'var(--sunken)' }}>Aa Gg<div style="font-size:14px;margin-top:6px">The quick brown fox</div></div>`;
  if (r.kind === 'note' && !r.thumb_key) return html`<div style="padding:16px;background:var(--sunken);white-space:pre-wrap;font-size:13px">${r.note}</div>`;
  if (!r.thumb_key) return html`<div class="thumb" style="height:120px;border:0;border-radius:0"><${Icon} n="link-simple" /></div>`;
  return html`<button class="rimg" onClick=${() => onOpen(r)} aria-label=${`Open ${r.title || 'reference'}`}><img src=${fileUrl(r.thumb_key)} alt="" loading="lazy" draggable="false" />${r.kind === 'video' ? html`<span class="play"><${Icon} n="play" /></span>` : ''}</button>`;
}

function RefCard({ r, onSimilar, onEdit, onDelete, onPin, onOpen, dim, hit, canEdit }) {
  return html`<article class=${`card rcard${dim ? ' dim' : ''}${hit ? ' hit' : ''}`}>
    <${RefBody} r=${r} onOpen=${onOpen} />
    <div class="b">
      <div class="row" style="gap:6px"><b class="small trunc grow" title=${r.title}>${r.title || r.kind}</b>
        <${Menu} label="Reference actions" btn="btn ghost icon sm" items=${[
          canEdit && { label: 'Pin to a change…', icon: 'push-pin', onClick: () => onPin(r) },
          { label: 'Find similar', icon: 'magic-wand', onClick: () => onSimilar(r) },
          r.url && { label: 'Open link', icon: 'arrow-up-right', onClick: () => window.open(r.url, '_blank', 'noopener') },
          r.embed_url && { label: 'Open live embed', icon: 'play', onClick: () => window.open(r.embed_url, '_blank', 'noopener') },
          canEdit && { label: 'Edit', icon: 'pencil-simple', onClick: () => onEdit(r) },
          canEdit && '-', canEdit && { label: 'Delete', icon: 'trash', danger: true, onClick: () => onDelete(r) }]} />
      </div>
      ${r.note && r.kind !== 'note' && html`<p class="tiny muted clamp2">${r.note}</p>`}
      ${r.palette?.length > 0 && r.kind !== 'color' && html`<div class="swatches" aria-label=${`Palette: ${r.palette.join(', ')}`}>${r.palette.slice(0, 6).map((c) => html`<i style=${{ background: c }} title=${c}></i>`)}</div>`}
      ${r.kind === 'color' && html`<code>${r.palette[0]}</code>`}
      ${r.links?.length > 0 && html`<div class="col" style="gap:2px">${r.links.map((l) => html`<a class="pinned trunc" href=${`#/m/${l.moment_id}`}><${Icon} n="push-pin" />${l.title}</a>`)}</div>`}
      ${r.grp && html`<span class="tiny muted"><${Icon} n="folder-simple" /> ${r.grp}</span>`}
    </div>
  </article>`;
}

// Pin a reference to one of the project's changes.
function PinTo({ p, r, onClose, onDone }) {
  const { data } = useFetch(`/projects/${p.id}/timeline?limit=60`);
  const have = new Set((r.links || []).map((l) => l.moment_id));
  const pin = (m) => api(`/references/${r.id}/links`, { method: 'POST', body: { moment_id: m.id } }).then(() => { toast(`Pinned to ${m.title}`); onDone(); onClose(); }).catch(fail);
  const list = (data?.items || []).filter((x) => x.kind === 'moment');
  return html`<${Dialog} title=${`Pin “${r.title || 'this reference'}” to a change`} size="lg" onClose=${onClose}>
    ${!data ? html`<${Loading} h=${200} />` : !list.length ? html`<p class="small muted">${p.name} has no accepted changes yet.</p>`
    : html`<div class="pickgrid">${list.map((m) => html`<button onClick=${() => pin(m)} aria-pressed=${have.has(m.id)} disabled=${have.has(m.id)}>${m.assets[0]?.after?.thumb_key ? html`<img src=${fileUrl(m.assets[0].after.thumb_key)} alt="" loading="lazy" />` : html`<span class="ph"><${Icon} n="file" /></span>`}<span class="trunc small">${m.title}</span><span class="tiny muted">${have.has(m.id) ? 'Pinned already' : rel(m.end_ts)}</span></button>`)}</div>`}
  </${Dialog}>`;
}

function Board({ refs, canEdit, onMove, onDrop, render }) {
  const [view, setView] = useState({ x: 24, y: 24, k: 1 });
  const [drag, setDrag] = useState(null);
  const [local, setLocal] = useState({});
  const box = useRef();
  const pos = (r, i) => local[r.id] || { x: r.x ?? 24 + (i % 5) * 240, y: r.y ?? 24 + Math.floor(i / 5) * 300, w: r.w && r.x != null ? Math.max(140, Math.min(r.w, 560)) : 220 };
  const toWorld = (e) => { const b = box.current.getBoundingClientRect(); return { x: (e.clientX - b.left - view.x) / view.k, y: (e.clientY - b.top - view.y) / view.k }; };
  const start = (e, r, i, mode) => {
    if (!canEdit && mode !== 'pan') return;
    e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: r?.id, mode, sx: e.clientX, sy: e.clientY, o: r ? pos(r, i) : { ...view } });
  };
  const move = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.mode === 'pan') return setView({ ...view, x: drag.o.x + dx, y: drag.o.y + dy });
    if (drag.mode === 'move') setLocal({ ...local, [drag.id]: { ...drag.o, x: drag.o.x + dx / view.k, y: drag.o.y + dy / view.k } });
    if (drag.mode === 'size') setLocal({ ...local, [drag.id]: { ...drag.o, w: Math.max(140, Math.min(560, drag.o.w + dx / view.k)) } });
  };
  const end = () => { if (drag?.id && local[drag.id]) onMove(drag.id, local[drag.id]); setDrag(null); };
  const zoom = (f, e) => { const k = Math.max(0.25, Math.min(2.5, view.k * f)); const b = box.current.getBoundingClientRect(); const cx = e ? e.clientX - b.left : b.width / 2, cy = e ? e.clientY - b.top : b.height / 2; setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k }); };
  const groups = useMemo(() => {
    const g = {};
    refs.forEach((r, i) => { if (!r.grp) return; const p = pos(r, i); g[r.grp] = g[r.grp] ? { x: Math.min(g[r.grp].x, p.x), y: Math.min(g[r.grp].y, p.y) } : { x: p.x, y: p.y }; });
    return g;
  }, [refs, local]);
  return html`<div class="board" ref=${box} data-own-drop
    onPointerDown=${(e) => start(e, null, 0, 'pan')} onPointerMove=${move} onPointerUp=${end}
    onWheel=${(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e); } else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY }); }}
    onDragOver=${(e) => e.preventDefault()} onDrop=${(e) => { e.preventDefault(); onDrop(e.dataTransfer.files, toWorld(e)); }}
    aria-label="Moodboard canvas: drag cards to arrange, drag the background to pan, Ctrl + wheel to zoom">
    <div class="plane" style=${{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
      ${Object.entries(groups).map(([name, p]) => html`<div class="glabel" style=${{ left: `${p.x}px`, top: `${p.y - 22}px` }}>${name}</div>`)}
      ${refs.map((r, i) => { const p = pos(r, i); return html`<div class=${`bitem${drag?.id === r.id ? ' dragging' : ''}`} style=${{ left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px` }} onPointerDown=${(e) => !e.target.closest('button, a') && start(e, r, i, 'move')}>
        ${render(r)}${canEdit && html`<div class="rs" aria-hidden="true" onPointerDown=${(e) => start(e, r, i, 'size')}></div>`}</div>`; })}
    </div>
    <div class="zoom row"><button class="btn sm icon" aria-label="Zoom out" onClick=${() => zoom(0.8)}><${Icon} n="minus" /></button><span class="small num" style="min-width:42px;text-align:center">${Math.round(view.k * 100)}%</span><button class="btn sm icon" aria-label="Zoom in" onClick=${() => zoom(1.25)}><${Icon} n="plus" /></button><button class="btn sm" onClick=${() => setView({ x: 24, y: 24, k: 1 })}>Reset</button></div>
  </div>`;
}

export function References({ p }) {
  const { data, error, reload, set } = useFetch(`/projects/${p.id}/references`, ['reference'], (t, d) => d.project_id === p.id);
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('trace:refs-view') || 'grid'; } catch { return 'grid'; } });
  const [kind, setKind] = useState('all');
  const [pinned, setPinned] = useState('all');
  const [open, setOpen] = useState(null);
  const [similar, setSimilar] = useState(null);
  const [dlg, setDlg] = useState(null);
  const file = useRef();
  useEffect(() => { try { localStorage.setItem('trace:refs-view', mode); } catch {} }, [mode]);
  const upload = async (files, at) => {
    const list = [...files];
    for (const [i, f] of list.entries()) {
      try {
        const r = await api(`/projects/${p.id}/references/upload`, { method: 'POST', raw: f, headers: { 'x-filename': encodeURIComponent(f.name || 'reference.png') } });
        if (at) await api(`/references/${r.id}`, { method: 'PATCH', body: { x: at.x + i * 24, y: at.y + i * 24 } });
      } catch (e) { fail(e); }
    }
    if (list.length) { toast(`${plural(list.length, 'reference')} added`); reload(); }
  };
  const findSimilar = async (r) => { try { const s = await api(`/references/${r.id}/similar`); setSimilar({ of: r.id, ids: new Set([r.id, ...s.filter((x) => x.similarity > 0.15).map((x) => x.id)]) }); toast(`${s.filter((x) => x.similarity > 0.15).length} similar in this project`, { action: { label: 'Clear', fn: () => setSimilar(null) } }); } catch (e) { fail(e); } };
  const del = (r) => api(`/references/${r.id}`, { method: 'DELETE' }).then(() => { set((l) => l.filter((x) => x.id !== r.id)); toast('Reference removed'); }).catch(fail);
  const moveRef = (id, pos) => api(`/references/${id}`, { method: 'PATCH', body: pos }).catch(fail);
  const KINDS = { image: ['image'], video: ['video'], link: ['link', 'embed'], note: ['note', 'color', 'font', 'file'] };
  const list = (data || []).filter((r) => (kind === 'all' || KINDS[kind].includes(r.kind)) && (pinned === 'all' || (pinned === 'yes') === (r.links?.length > 0)));
  const card = (r) => html`<${RefCard} r=${r} canEdit=${p.can_edit} onSimilar=${findSimilar} onEdit=${(x) => setDlg({ edit: x })} onDelete=${del} onPin=${(x) => setDlg({ pin: x })} onOpen=${setOpen} dim=${similar && !similar.ids.has(r.id)} hit=${similar?.of === r.id} />`;
  const count = (k) => (data || []).filter((r) => KINDS[k].includes(r.kind)).length;
  return html`<div class="col" style="gap:12px;padding-top:16px">
    <div class="row wrap">
      <${Seg} label="View" value=${mode} onChange=${setMode} options=${[{ value: 'grid', label: 'Grid', icon: 'squares-four' }, { value: 'canvas', label: 'Canvas', icon: 'frame-corners' }]} />
      <span class="grow"></span>
      ${p.can_edit && html`<button class="btn sm" onClick=${() => file.current.click()}><${Icon} n="image" />Images</button><input type="file" multiple accept="image/*,video/*,.pdf" hidden ref=${file} onChange=${(e) => { upload(e.target.files); e.target.value = ''; }} />
        <button class="btn sm" onClick=${() => setDlg('link')}><${Icon} n="link-simple" />Link</button>
        <button class="btn sm" onClick=${() => setDlg({ kind: 'note' })}><${Icon} n="note" />Note</button>
        <button class="btn sm" onClick=${() => setDlg({ kind: 'color' })}><${Icon} n="palette" />Colour</button>
        <button class="btn sm" onClick=${() => setDlg({ kind: 'font' })}><${Icon} n="text-aa" />Font</button>`}
    </div>
    ${data?.length > 0 && html`<div class="row wrap" style="gap:8px">
      <${Seg} label="Kind" value=${kind} onChange=${setKind} options=${[{ value: 'all', label: `All ${data.length}` }, { value: 'image', label: `Pictures ${count('image')}` }, { value: 'video', label: `Videos ${count('video')}` }, { value: 'link', label: `Links ${count('link')}` }, { value: 'note', label: `Notes ${count('note')}` }]} />
      <${Seg} label="Pinned" value=${pinned} onChange=${setPinned} options=${[{ value: 'all', label: 'Any' }, { value: 'yes', label: 'Pinned to a change' }, { value: 'no', label: 'Not pinned' }]} />
    </div>`}
    ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
    ${!data ? html`<${Loading} h=${300} />` : !data.length && mode === 'grid' ? html`<${Empty} icon="images" title="No references yet">Drop images here, paste a link, or add notes, colours and fonts. Your team and your AI agents see the same references.</${Empty}>`
    : mode === 'grid' ? html`<div class="masonry">${list.map(card)}</div>`
    : html`<${Board} refs=${list} canEdit=${p.can_edit} onMove=${moveRef} onDrop=${upload} render=${card} />`}
    ${dlg === 'link' && html`<${AddLink} asReference project_id=${p.id} onClose=${() => setDlg(null)} onAdded=${reload} />`}
    ${dlg?.kind && html`<${AddRef} p=${p} kind=${dlg.kind} onClose=${() => setDlg(null)} onDone=${reload} />`}
    ${dlg?.edit && html`<${EditRef} r=${dlg.edit} onClose=${() => setDlg(null)} onDone=${reload} />`}
    ${dlg?.pin && html`<${PinTo} p=${p} r=${dlg.pin} onClose=${() => setDlg(null)} onDone=${reload} />`}
    ${open && html`<${Lightbox} item=${open} onClose=${() => setOpen(null)} />`}
  </div>`;
}

function AddRef({ p, kind, onClose, onDone }) {
  const [f, setF] = useState({ value: kind === 'color' ? '#2b59ff' : '' });
  const add = async (e) => {
    e.preventDefault();
    try { await api(`/projects/${p.id}/references`, { method: 'POST', body: { kind, title: f.title, note: f.note, value: f.value } }); onDone(); onClose(); } catch (er) { fail(er); }
  };
  const label = { note: 'Note', color: 'Colour', font: 'Font' }[kind];
  return html`<${Dialog} title=${`Add a ${label.toLowerCase()}`} onClose=${onClose}><form class="col" style="gap:12px" onSubmit=${add}>
    ${kind === 'color' && html`<${Field} label="Colour"><div class="row"><input type="color" value=${f.value} onInput=${(e) => setF({ ...f, value: e.target.value })} aria-label="Pick a colour" /><input class="input mono" value=${f.value} onInput=${(e) => setF({ ...f, value: e.target.value })} /></div></${Field}>`}
    ${kind === 'font' && html`<${Field} label="Font family" hint="As it’s named on your system or in your CSS"><input class="input" value=${f.value} onInput=${(e) => setF({ ...f, value: e.target.value })} autofocus /></${Field}>`}
    <${Field} label=${kind === 'note' ? 'Title' : 'Name (optional)'}><input class="input" value=${f.title || ''} onInput=${(e) => setF({ ...f, title: e.target.value })} autofocus=${kind === 'note'} /></${Field}>
    ${kind === 'note' && html`<${Field} label="Note"><textarea class="input" rows="4" value=${f.note || ''} onInput=${(e) => setF({ ...f, note: e.target.value })}></textarea></${Field}>`}
    <div class="row"><button class="btn primary">Add ${label.toLowerCase()}</button></div></form></${Dialog}>`;
}

function EditRef({ r, onClose, onDone }) {
  const [f, setF] = useState({ title: r.title, note: r.note || '', grp: r.grp || '' });
  const save = async (e) => { e.preventDefault(); try { await api(`/references/${r.id}`, { method: 'PATCH', body: { title: f.title, note: f.note, grp: f.grp || null } }); onDone(); onClose(); } catch (er) { fail(er); } };
  return html`<${Dialog} title="Edit reference" onClose=${onClose}><form class="col" style="gap:12px" onSubmit=${save}>
    <${Field} label="Title"><input class="input" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>
    <${Field} label="Note"><textarea class="input" rows="3" value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })}></textarea></${Field}>
    <${Field} label="Group" hint="Cards with the same group are labelled together on the canvas"><input class="input" value=${f.grp} onInput=${(e) => setF({ ...f, grp: e.target.value })} /></${Field}>
    <div class="row"><button class="btn primary">Save</button></div></form></${Dialog}>`;
}
