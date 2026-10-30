// A project as a canvas of blocks: overview, iterations, reviews, brainstorming, constraints, references, tasks,
// decisions, case study, artifacts, and blocks you make. Click to select, again for a peek (jot a sticky there),
// double-click to open. Drag from a block's dots to another to link them: Trace reads both and says what one
// means for the other. Replay rewinds the canvas so you can watch the project fill in.
import { html, useState, useEffect, useRef, api, useFetch, useAi, Icon, Avatar, ErrorBox, Loading, fileUrl, toast, fail, go, plural } from '../lib.js';
import { Bento } from './bento.js';
import { longDate } from './ncs.js';

const KIND = { conflict: { label: 'Conflict', icon: 'warning-circle' }, gap: { label: 'Gap', icon: 'circle-dashed' }, note: { label: 'Note', icon: 'note' }, match: { label: 'Connection', icon: 'link-simple' }, support: { label: 'Holds', icon: 'check-circle' } };
const worst = (kinds = []) => ['conflict', 'gap', 'note', 'match', 'support'].find((k) => kinds.includes(k)) || 'match';

function Ring({ value, size = 44 }) { // case-study readiness
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  return html`<svg class="ring" width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} role="img" aria-label=${`${value}% answered`}>
    <circle cx=${size / 2} cy=${size / 2} r=${r} class="track" /><circle cx=${size / 2} cy=${size / 2} r=${r} class="fill" style=${{ strokeDasharray: `${(c * value) / 100} ${c}` }} />
    <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle">${value}</text></svg>`;
}

function BlockCard({ b, at }) {
  const s = b.summary;
  const n = s.count == null ? null : at ? s.ts.filter((t) => t <= at).length + (s.count - s.ts.length) : s.count;
  const pics = s.images.slice(0, b.size === '2x2' || b.size === '2x1' ? 4 : 2);
  const foot = s.stat || (s.count ? plural(s.count, b.id === 'work' ? 'iteration' : 'item') : s.stickies ? plural(s.stickies, 'note') : s.count === 0 ? 'Empty so far' : b.hint);
  if (b.id === 'overview') return html`<div class="blk-h"><span class="blk-ico"><${Icon} n=${b.icon} /></span><span class="blk-t trunc">${b.title}</span></div>
    <div class="ov">${pics[0] && html`<div class="ov-shot"><img src=${fileUrl(pics[0].image_key || pics[0].thumb_key)} alt="" draggable="false" /></div>`}
      <ul class="blk-lines">${s.lines.map((l) => html`<li class="clamp2">${l}</li>`)}</ul></div>
    <div class="blk-f"><span class="trunc">${b.hint}</span></div>`;
  return html`<div class="blk-h"><span class="blk-ico"><${Icon} n=${b.icon} /></span><span class="blk-t trunc">${b.title}</span>${n != null && n > 0 && html`<span class="blk-n">${n}</span>`}</div>
    <div class=${`blk-body${pics.length && b.id !== 'casestudy' ? ' has-pics' : ''}`}>
      ${b.id === 'casestudy' && s.readiness != null ? html`<div class="blk-ring"><${Ring} value=${s.readiness} size=${b.size === '1x1' ? 46 : 64} /><span class="small ink2">${s.stat}</span></div>`
      : pics.length ? html`<div class=${`collage n${pics.length}`}>${pics.map((im) => html`<span><img src=${fileUrl(im.thumb_key || im.image_key)} alt="" loading="lazy" draggable="false" /></span>`)}</div>`
      : s.lines.length ? html`<ul class="blk-lines">${s.lines.map((l) => html`<li class="clamp2">${l}</li>`)}</ul>`
      : html`<p class="blk-empty">${b.hint}</p>`}
    </div>
    <div class="blk-f"><span class="trunc">${foot}</span>${s.stickies > 0 && html`<span class="blk-sticky" title=${plural(s.stickies, 'sticky note')}><${Icon} n="note" />${s.stickies}</span>`}</div>`;
}

// A peek at a block: its first things, and a sticky you can jot right there.
function Peek({ p, b, close, reload }) {
  const [text, setText] = useState('');
  const add = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api(`/projects/${p.id}/notes`, { method: 'POST', body: { block: b.id, text } }); setText(''); toast('Stuck to the block'); reload(); } catch (er) { fail(er); } };
  return html`<article class="clog peek">
    <div class="clog-h"><span class="blk-ico"><${Icon} n=${b.icon} /></span><b class="trunc">${b.title}</b><span class="tools"><button class="ibtn" aria-label="Close" onClick=${close}><${Icon} n="x" /></button></span></div>
    <p class="small muted">${b.hint}</p>
    ${b.summary.lines.length > 0 && html`<ul class="blk-lines">${b.summary.lines.map((l) => html`<li>${l}</li>`)}</ul>`}
    <form class="jot" onSubmit=${add}><input class="input sm" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Jot a thought on this block…" aria-label=${`A sticky note on ${b.title}`} /><button class="btn sm" aria-label="Add the sticky"><${Icon} n="note" /></button></form>
    <a class="btn sm primary" href=${`#/p/${p.id}/b/${b.id}`}>Open ${b.title}<${Icon} n="arrow-right" /></a>
  </article>`;
}

// What a link between two blocks reveals.
function Insights({ p, link, blocks, onClose, reload }) {
  const { data, error, reload: again } = useFetch(`/projects/${p.id}/insights?a=${link.from}&b=${link.to}`, ['project']);
  const [text, setText] = useState('');
  const name = (id) => blocks.find((b) => b.id === id)?.title || id;
  const task = (t) => api(`/projects/${p.id}/issues`, { method: 'POST', body: { title: t } }).then(() => { toast('Task made'); again(); reload(); }).catch(fail);
  const write = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api(`/projects/${p.id}/insights`, { method: 'POST', body: { a: link.from, b: link.to, text } }); setText(''); again(); reload(); } catch (er) { fail(er); } };
  const unlink = () => api(`/projects/${p.id}/canvas`, { method: 'PUT', body: { unlink: { from: link.from, to: link.to } } }).then(() => { onClose(); reload(); toast('Unlinked'); }).catch(fail);
  const [reading, setReading] = useState(false);
  const ai = useAi();
  const askAi = () => { setReading(true); api(`/projects/${p.id}/ai/insights`, { method: 'POST', body: { a: link.from, b: link.to } }).then((r) => { toast(r.saved ? `Trace’s AI found ${plural(r.saved, 'insight')}` : 'Trace’s AI found nothing new between them'); again(); reload(); }).catch(fail).finally(() => setReading(false)); };
  return html`<aside class="drawer" role="dialog" aria-label=${`What ${name(link.from)} and ${name(link.to)} say about each other`}>
    <div class="drawer-h"><span class="pair"><b>${name(link.from)}</b><${Icon} n="arrows-left-right" /><b>${name(link.to)}</b></span><button class="ibtn" aria-label="Close" onClick=${onClose}><${Icon} n="x" /></button></div>
    <div class="row"><p class="small muted grow">Trace read both blocks. Here’s what one says about the other.</p>${ai?.ready && p.can_edit && html`<button class="btn sm" onClick=${() => !reading && askAi()} aria-disabled=${reading}><${Icon} n="lightbulb" />${reading ? 'Reading…' : 'Ask AI'}</button>`}</div>
    ${error && html`<${ErrorBox} error=${error} retry=${again} />`}
    ${!data ? html`<${Loading} h=${160} />` : !data.insights.length ? html`<p class="small ink2">Nothing connects them yet. Add a few items to either block, or write what you see below.</p>`
    : html`<ol class="ins">${data.insights.map((i) => html`<li class=${`ins-${i.kind}`}>
        <span class="ins-k"><${Icon} n=${KIND[i.kind].icon} />${KIND[i.kind].label}${i.by ? html` · ${i.by}` : ''}</span>
        <p>${i.text}</p>
        ${i.evidence?.length > 0 && html`<div class="row wrap" style="gap:4px">${i.evidence.map((e) => (e.href ? html`<a class="chip" href=${e.href}>${e.title}</a>` : html`<a class="chip" href=${`#/p/${p.id}/b/${e.block}`}>${e.title}</a>`))}</div>`}
        ${i.action?.type === 'task' && html`<button class="btn sm" onClick=${() => task(i.action.title)}><${Icon} n="plus" />Make it a task</button>`}
        ${i.action?.type === 'casestudy' && html`<a class="btn sm" href=${`#/p/${p.id}/casestudy/${i.action.section}`}>Answer it</a>`}
      </li>`)}</ol>`}
    <form class="col" onSubmit=${write}><textarea class="input" rows="2" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Write what you see between them…" aria-label="Your insight"></textarea><div class="row"><button class="btn sm primary">Add insight</button><span class="grow"></span><button type="button" class="btn sm ghost danger" onClick=${unlink}>Unlink</button></div></form>
    <p class="tiny muted">Agents connected to Trace can add theirs with add_insight. Trace’s AI keeps an insight only if the items it cites are in these blocks.</p>
  </aside>`;
}

export function ProjectCanvas({ p }) {
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/canvas`, ['project', 'moment', 'comment', 'reference', 'issue', 'decision', 'artifact', 'memory'], (t, d) => !d.project_id || d.project_id === p.id);
  const [link, setLink] = useState(null);
  const [at, setAt] = useState(null); // replay: the moment in time shown
  const [playing, setPlaying] = useState(false);
  const [naming, setNaming] = useState(null);
  const ai = useAi();
  const [reading, setReading] = useState(false);
  const findAi = () => { setReading(true); api(`/projects/${p.id}/ai/insights`, { method: 'POST', body: {} }).then((r) => { toast(r.saved ? `${plural(r.saved, 'new insight')} on the links between blocks` : 'Nothing new between the blocks this time'); reload(); }).catch(fail).finally(() => setReading(false)); };
  const raf = useRef();
  const save = (body) => api(`/projects/${p.id}/canvas`, { method: 'PUT', body }).catch(fail);
  const range = data?.range;
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const play = () => {
    if (!range) return;
    if (playing) { cancelAnimationFrame(raf.current); setPlaying(false); return; }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setAt(null); return; }
    const start = performance.now(), dur = 6000;
    setPlaying(true);
    const step = (t) => { const k = Math.min(1, (t - start) / dur); setAt(range.from + (range.to - range.from) * k); if (k < 1) raf.current = requestAnimationFrame(step); else { setPlaying(false); setTimeout(() => setAt(null), 900); } };
    raf.current = requestAnimationFrame(step);
  };
  const addBlock = async (e) => { e.preventDefault(); if (!naming?.trim()) return; await save({ add_block: naming }); setNaming(null); reload(); toast('Block added'); };
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<div class="bento canvas">${[1, 2, 3, 4, 5, 6].map(() => html`<div class="skeleton" style="height:150px"></div>`)}</div>`;
  const blocks = data.blocks.map((b) => ({ ...b, cls: `k-${b.custom ? 'custom' : b.id}`, label: b.title }));
  const links = data.links.map((l) => ({ ...l, cls: `lk-${worst(l.kinds)}` }));
  const name = (id) => blocks.find((b) => b.id === id)?.title;
  return html`<div class="col canvas-wrap" style="gap:12px">
    <div class="row wrap canvas-bar">
      <span class="board-hint" style="margin:0">Click to select · double-click to open · drag from dots to link two blocks</span>
      <span class="grow"></span>
      ${links.length > 0 && html`<span class="chip ok">${plural(links.length, 'link')} · ${links.reduce((n, l) => n + l.count, 0)} insights</span>`}
      ${ai?.ready && p.can_edit && naming == null && html`<button class="btn sm" onClick=${() => !reading && findAi()} aria-disabled=${reading} title="Trace’s AI reads every block and links the ones that say something about each other"><${Icon} n="lightbulb" />${reading ? 'Reading the blocks…' : 'Find insights with AI'}</button>`}
      ${naming != null ? html`<form class="row" onSubmit=${addBlock}><input class="input sm" autofocus value=${naming} onInput=${(e) => setNaming(e.target.value)} placeholder="Name the block, e.g. Research" aria-label="New block name" onKeyDown=${(e) => e.key === 'Escape' && setNaming(null)} /><button class="btn sm primary">Add</button></form>`
        : p.can_edit && html`<button class="btn sm" onClick=${() => setNaming('')}><${Icon} n="plus" />Block</button>`}
    </div>
    <${Bento} cls="canvas" items=${blocks} links=${links} onSave=${save}
      onLink=${p.can_edit ? (from, to) => save({ link: { from, to } }).then(() => { reload(); setLink({ from, to }); }) : null}
      onKnot=${setLink} knot=${(l) => l.count} linkLabel=${(l) => `${name(l.from)} and ${name(l.to)}: ${plural(l.count, 'insight')}`}
      onOpen=${(b) => go(`/p/${p.id}/b/${b.id}`)}
      dimmed=${(b) => at && b.summary.count != null && b.summary.ts.length && !b.summary.ts.some((t) => t <= at)}
      renderCard=${(b) => html`<${BlockCard} b=${b} at=${at} />`}
      renderPanel=${(b, close) => html`<${Peek} p=${p} b=${b} close=${close} reload=${reload} />`}
      toolbar=${(b) => html`<button onClick=${() => go(`/p/${p.id}/b/${b.id}`)} title="Open" aria-label=${`Open ${b.title}`}><${Icon} n="arrow-up-right" /></button>
        ${b.custom && p.can_edit && html`<button class="danger" onClick=${() => save({ remove_block: b.id }).then(() => { reload(); toast('Block removed'); })} title="Remove the block" aria-label="Remove the block"><${Icon} n="trash" /></button>`}`} />
    ${range && html`<div class="replay" role="group" aria-label="Replay the project">
      <button class="ibtn" aria-label=${playing ? 'Pause' : 'Replay how the project filled in'} title=${playing ? 'Pause' : 'Replay'} onClick=${play}><${Icon} n=${playing ? 'pause' : 'play'} /></button>
      <input type="range" min=${range.from} max=${range.to} step=${Math.max(1, Math.round((range.to - range.from) / 400))} value=${at ?? range.to} onInput=${(e) => { cancelAnimationFrame(raf.current); setPlaying(false); setAt(+e.target.value >= range.to ? null : +e.target.value); }} aria-label="Show the canvas as it was on" />
      <span class="small num replay-at">${at ? longDate(at) : 'Now'}</span>
    </div>`}
    ${link && html`<${Insights} p=${p} link=${link} blocks=${blocks} reload=${reload} onClose=${() => setLink(null)} />`}
  </div>`;
}
