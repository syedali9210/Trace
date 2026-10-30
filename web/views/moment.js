// A change in detail, the NCS way: the work on its grey well, and beside it the changes as cards
// (the sentence, then Font / Colour / Copy… with red → green values), a note, and the comments.
import { html, useState, useEffect, useRef, useMemo, api, useFetch, useMe, useAi, Header, Icon, ErrorBox, Loading, ToolChip, Magnitude, Avatar, Seg, Dialog, rel, stamp, plural, toast, fail, copy, fileUrl, useKeys, go, swatchText } from '../lib.js';
import { Sentence, AttrCards, dayLabel, time } from './ncs.js';
import { AskedList, Reasoning, ScriptHint, Pics } from './journey.js';

// Why it changed, found by Trace's AI in the AI sessions and comments around the change. You keep it or not.
function FindWhy({ m, reload }) {
  const ai = useAi();
  const [state, setState] = useState(null); // null | 'reading' | the answer
  if (!ai?.ready) return null;
  const find = () => { setState('reading'); api(`/moments/${m.id}/ai/why`, { method: 'POST' }).then(setState).catch((e) => { fail(e); setState(null); }); };
  const keep = () => api(`/moments/${m.id}`, { method: 'PATCH', body: { why: state.why } }).then(() => { toast('Kept as the why'); reload(); }).catch(fail);
  if (!state || state === 'reading') return html`<button class="ai-cta" onClick=${() => !state && find()} aria-disabled=${!!state}><${Icon} n="question" cls=${state ? 'spin' : ''} />${state ? 'Reading the AI sessions and comments around this change…' : 'Find the why'}<span class="tiny muted">in your AI sessions and comments</span></button>`;
  if (!state.why) return html`<p class="ai-none small"><${Icon} n="chat-teardrop-dots" />${state.note}</p>`;
  return html`<article class="clog ai-found">
    <span class="ai-by"><${Icon} n="chat-teardrop-dots" />Trace’s AI found it in ${state.source.label}</span>
    <p>${state.why}</p>
    <blockquote class="small">${state.source.text}</blockquote>
    <div class="row"><button class="btn sm primary" onClick=${keep}>Keep it</button><button class="btn sm ghost" onClick=${() => setState({ why: null, note: 'Dismissed.' })}>Dismiss</button></div>
  </article>`;
}

// ---------- viewer ----------
const pct = (v) => `${(v * 100).toFixed(3)}%`;
const boxStyle = (r) => ({ left: pct(r.x), top: pct(r.y), width: pct(Math.max(r.w, 0.01)), height: pct(Math.max(r.h, 0.01)) });

function Layer({ regions, pins, onRegion, focusPin }) {
  return html`${regions.map((r, i) => html`<button class=${`rbox${r.attr ? ' attr' : ''}`} style=${boxStyle(r)} aria-label=${r.label || `Changed region ${i + 1}: comment on it`} title=${r.label || 'Changed region: click to comment'} onClick=${(e) => { e.stopPropagation(); onRegion?.(r); }}></button>`)}
    ${pins.map((p) => html`<div class=${`pinbox${p.id === focusPin ? ' focus' : ''}`} style=${boxStyle(p.region)} title=${p.body}><b>${p.n}</b></div>`)}`;
}

export function Viewer({ before, after, regions = [], pins = [], pinning, onPin, onRegion, focusPin }) {
  const [mode, setMode] = useState(before ? 'side' : 'single');
  const [show, setShow] = useState(true);
  const [split, setSplit] = useState(50);
  const [onion, setOnion] = useState(50);
  const [draw, setDraw] = useState(null);
  const stage = useRef();
  useEffect(() => setMode(before ? 'side' : 'single'), [!!before]);
  const at = (e) => { const b = stage.current.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) }; };
  const down = (e) => { if (!pinning) return; e.preventDefault(); stage.current.setPointerCapture(e.pointerId); const p = at(e); setDraw({ x0: p.x, y0: p.y, x: p.x, y: p.y }); };
  const move = (e) => { if (draw) { const p = at(e); setDraw({ ...draw, x: p.x, y: p.y }); } };
  const up = () => {
    if (!draw) return;
    let r = { x: Math.min(draw.x0, draw.x), y: Math.min(draw.y0, draw.y), w: Math.abs(draw.x - draw.x0), h: Math.abs(draw.y - draw.y0) };
    if (r.w < 0.01 && r.h < 0.01) r = { x: Math.max(0, draw.x0 - 0.03), y: Math.max(0, draw.y0 - 0.02), w: 0.06, h: 0.04 }; // a click pins a small box
    setDraw(null); onPin?.(r);
  };
  const img = (s, extra = {}) => html`<img src=${fileUrl(s.image_key || s.thumb_key)} alt="" draggable="false" ...${extra} />`;
  const overlays = show && html`<${Layer} regions=${regions} pins=${pins} onRegion=${onRegion} focusPin=${focusPin} />`;
  const drawing = draw && html`<div class="drawing" style=${boxStyle({ x: Math.min(draw.x0, draw.x), y: Math.min(draw.y0, draw.y), w: Math.abs(draw.x - draw.x0), h: Math.abs(draw.y - draw.y0) })}></div>`;
  const stageProps = { ref: stage, class: 'stage', onPointerDown: down, onPointerMove: move, onPointerUp: up };
  const maxW = Math.min(1000, after?.width ? after.width / (after.width > 1200 ? 2 : 1) : 1000);
  if (!after) return html`<div class="viewer" style="padding:48px;text-align:center"><span class="muted">No preview for this file.</span></div>`;
  return html`<div class="col" style="gap:8px">
    <div class="row wrap between no-print">
      ${before ? html`<${Seg} label="Compare as" value=${mode} onChange=${setMode} options=${[{ value: 'side', label: 'Side by side' }, { value: 'overlay', label: 'Overlay' }, { value: 'swipe', label: 'Swipe' }, { value: 'onion', label: 'Onion skin' }]} />` : html`<span class="caps">New in this moment</span>`}
      <div class="row">
        ${mode === 'onion' && html`<label class="row small muted">Before<input type="range" min="0" max="100" value=${onion} onInput=${(e) => setOnion(+e.target.value)} aria-label="Blend between before and after" />After</label>`}
        ${(regions.length > 0 || pins.length > 0) && html`<label class="check small"><input type="checkbox" class="switch" checked=${show} onChange=${(e) => setShow(e.target.checked)} />Regions</label>`}
      </div>
    </div>
    <div class=${`viewer${pinning ? ' pinning' : ''}`}>
      ${mode === 'side' ? html`<div class="sbs">
          <div><span class="caps">Before</span><div class="stage" style=${{ maxWidth: `${maxW}px`, width: '100%' }}>${img(before)}</div></div>
          <div><span class="caps">After</span><div ...${stageProps} style=${{ maxWidth: `${maxW}px`, width: '100%' }}>${img(after)}${overlays}${drawing}</div></div>
        </div>`
      : html`<div style="padding:16px"><div ...${stageProps} style=${{ maxWidth: `${maxW}px` }}>
          ${mode === 'single' && img(after)}
          ${mode === 'overlay' && html`${img(before)}<div class="over" style="mix-blend-mode:difference">${img(after)}</div>`}
          ${mode === 'onion' && html`${img(before)}<div class="over" style=${{ opacity: onion / 100 }}>${img(after)}</div>`}
          ${mode === 'swipe' && html`${img(before)}<div class="over" style=${{ clipPath: `inset(0 0 0 ${split}%)` }}>${img(after)}</div>
            <div class="swipe-line" role="slider" tabindex="0" aria-label="Swipe between before and after" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(split)} style=${{ left: `calc(${split}% - 1px)` }}
              onPointerDown=${(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove=${(e) => { if (e.buttons) { const b = stage.current.getBoundingClientRect(); setSplit(Math.max(0, Math.min(100, ((e.clientX - b.left) / b.width) * 100))); } }}
              onKeyDown=${(e) => { if (e.key === 'ArrowLeft') setSplit(Math.max(0, split - 5)); if (e.key === 'ArrowRight') setSplit(Math.min(100, split + 5)); }}></div>
            <span class="label" style="left:10px">Before</span><span class="label" style="right:10px">After</span>`}
          ${mode === 'overlay' && html`<span class="label" style="left:10px">Difference: changed pixels light up</span>`}
          ${overlays}${drawing}
        </div></div>`}
    </div>
  </div>`;
}

// Line diff for text and code files (LCS; big files show the new version only).
export function TextDiff({ before = '', after = '' }) {
  const rows = useMemo(() => {
    const lines = (t) => t.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n'); // an invisible BOM or CRLF isn't a change
    const a = lines(before), b = lines(after);
    if (a.length * b.length > 4e6) return b.map((t) => ({ t, k: '' }));
    const n = a.length, m = b.length, L = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * (m + 1) + j] = a[i] === b[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) { out.push({ t: a[i], k: '' }); i++; j++; } else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) out.push({ t: a[i++], k: 'del' }); else out.push({ t: b[j++], k: 'add' }); }
    while (i < n) out.push({ t: a[i++], k: 'del' }); while (j < m) out.push({ t: b[j++], k: 'add' });
    return out;
  }, [before, after]);
  return html`<div class="textdiff viewer" role="region" aria-label="Text changes">${rows.map((r) => html`<div class=${r.k}>${r.k === 'add' ? '+ ' : r.k === 'del' ? '− ' : '  '}${r.t}</div>`)}</div>`;
}

// ---------- comments ----------
const REACT = [['agree', 'Agree'], ['seen', 'Seen'], ['question', 'Question']];
function Comment({ c, me, onChange, small }) {
  const flagged = /\b(ignore (all |the )?(previous|prior) instructions|you are now|system prompt)\b/i.test(c.body);
  const agent = /^(Trace AI|Claude|Cursor|.*·\s*claude)/i.test(c.author_name || '');
  return html`<div class="cmt">
    <${Avatar} name=${c.author_name} agent=${agent} />
    <div class="col" style="gap:2px">
      <div class="row small" style="gap:6px"><b style="font-weight:600">${c.author_name}</b><span class="muted tiny">${rel(c.created_at)}</span>${c.external_url && html`<a class="tiny muted" href=${c.external_url} target="_blank" rel="noopener">Open in ${c.external_ref?.split(':')[0] === 'figma' ? 'Figma' : 'GitHub'} <${Icon} n="arrow-up-right" /></a>`}</div>
      <div class="body">${flagged && html`<span class="flag"><${Icon} n="warning" /> Reads like instructions to an AI. Agents get it marked as data.</span>`}${swatchText(c.body)}</div>
      ${!small && html`<div class="reacts">${REACT.map(([k, label]) => { const who = c.reactions?.[k] || []; return html`<button aria-pressed=${who.includes(me?.user.name)} title=${who.join(', ')} onClick=${() => api(`/comments/${c.id}/react`, { method: 'POST', body: { kind: k } }).then(onChange).catch(fail)}>${label}${who.length ? ` · ${who.length}` : ''}</button>`; })}</div>`}
    </div>
  </div>`;
}

export function Thread({ c, me, onChange, pinNo, focused, canEdit, projectId }) {
  const [reply, setReply] = useState('');
  const [open, setOpen] = useState(false);
  const post = async (e) => { e.preventDefault(); if (!reply.trim()) return; try { await api('/comments', { method: 'POST', body: { parent_id: c.id, body: reply } }); setReply(''); setOpen(false); onChange(); } catch (er) { fail(er); } };
  const resolve = () => api(`/comments/${c.id}`, { method: 'PATCH', body: { status: c.status === 'open' ? 'resolved' : 'open' } }).then(onChange).catch(fail);
  const toIssue = () => api(`/projects/${projectId}/issues`, { method: 'POST', body: { source_comment_id: c.id } }).then(() => toast('Issue created from this comment')).catch(fail);
  const toDecision = () => api(`/projects/${projectId}/decisions`, { method: 'POST', body: { text: c.body, source_type: 'comment', source_id: c.id } }).then(() => toast('Added to the decision log')).catch(fail);
  return html`<div class=${`thread${focused ? ' focus' : ''}${c.status === 'resolved' ? ' resolved' : ''}`} id=${`c-${c.id}`}>
    ${(pinNo || c.status === 'resolved') && html`<div class="row wrap" style="gap:6px">
      ${pinNo && html`<span class="chip">Pin ${pinNo}</span>`}
      ${c.status === 'resolved' && html`<span class="chip ok"><${Icon} n="check" />Resolved</span>`}
    </div>`}
    <${Comment} c=${c} me=${me} onChange=${onChange} />
    ${c.replies?.length > 0 && html`<div class="replies">${c.replies.map((r) => html`<${Comment} c=${r} me=${me} onChange=${onChange} small />`)}</div>`}
    ${open ? html`<form class="col" onSubmit=${post}><textarea class="input" rows="2" value=${reply} onInput=${(e) => setReply(e.target.value)} placeholder="Reply… (@name to mention)" aria-label="Reply" autofocus onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(e); if (e.key === 'Escape') setOpen(false); }}></textarea><div class="row"><button class="btn sm primary">Reply</button><button type="button" class="btn sm ghost" onClick=${() => setOpen(false)}>Cancel</button></div></form>`
      : html`<div class="row wrap" style="gap:4px">
        <button class="btn ghost sm" onClick=${() => setOpen(true)}>Reply</button>
        <button class="btn ghost sm" onClick=${resolve}>${c.status === 'open' ? 'Resolve' : 'Reopen'}</button>
        ${canEdit && html`<${MenuLite} items=${[{ label: 'Make an issue', icon: 'circle-dashed', onClick: toIssue }, { label: 'Add to decisions', icon: 'seal-check', onClick: toDecision }, { label: 'Copy link', icon: 'link', onClick: () => copy(`${location.origin}/#/c/${c.id}`, 'Link copied') }]} />`}
      </div>`}
  </div>`;
}
function MenuLite({ items }) {
  const [open, setOpen] = useState(false);
  return html`<div style="position:relative"><button class="btn ghost sm icon" aria-label="More" aria-expanded=${open} onClick=${() => setOpen(!open)}><${Icon} n="dots-three" /></button>
    ${open && html`<div class="pop" style="right:0;top:calc(100% + 4px);transform-origin:top right" onMouseLeave=${() => setOpen(false)}>${items.map((it) => html`<button onClick=${() => { setOpen(false); it.onClick(); }}><${Icon} n=${it.icon} />${it.label}</button>`)}</div>`}</div>`;
}

export function Composer({ target, region, onPosted, pinning, setPinning, clearRegion }) {
  const [body, setBody] = useState('');
  const ref = useRef();
  useEffect(() => { if (region) ref.current?.focus(); }, [region]);
  const post = async (e) => { e.preventDefault(); if (!body.trim()) return; try { await api('/comments', { method: 'POST', body: { ...target, body, region } }); setBody(''); clearRegion?.(); onPosted(); } catch (er) { fail(er); } };
  return html`<form class="col" onSubmit=${post}>
    ${region && html`<div class="row small"><span class="chip sel"><${Icon} n="push-pin" />Pinned to a region</span><button type="button" class="btn ghost sm" onClick=${clearRegion}>Remove pin</button></div>`}
    <textarea ref=${ref} class="input" rows="3" value=${body} onInput=${(e) => setBody(e.target.value)} placeholder=${region ? 'What about this area?' : 'Comment on this change… (@name to mention)'} aria-label="New comment" onKeyDown=${(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post(e); }}></textarea>
    <div class="row">
      <button class="btn primary sm">Comment</button>
      ${setPinning && html`<button type="button" class="btn sm" aria-pressed=${pinning} onClick=${() => setPinning(!pinning)}><${Icon} n="push-pin" />${pinning ? 'Drag on the image…' : 'Pin to a region'}</button>`}
      <span class="tiny muted grow" style="text-align:right">Ctrl Enter</span>
    </div>
  </form>`;
}

// ---------- the page: the work on the left; beside it the journey of this change ----------
// What you gave (prompts, pictures, references) → what changed → why (the agent's reasoning) → your review.
const FILE_TYPES = ['code', 'doc', 'file', 'font', 'repo', 'pull request'];
const isVisual = (a) => a.after?.properties?.component?.mode || (!FILE_TYPES.includes(a.type) && (a.after?.image_key || a.after?.thumb_key) && !a.after?.properties?.file?.card);
const FILE_ICON = { code: 'file-code', doc: 'file-text', font: 'text-aa', file: 'file', image: 'image', video: 'film-strip', repo: 'git-branch' };

// Many files, grouped by folder: a list you pick from, not a wall of tags.
function FileList({ files, sel, onPick }) {
  const groups = useMemo(() => {
    const g = {};
    for (const f of files) { const d = String(f.path || f.name).replace(/\\/g, '/').split('/').slice(0, -1).join('/') || 'Top level'; (g[d] ||= []).push(f); }
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
  }, [files]);
  const kinds = Object.entries(files.reduce((o, f) => ({ ...o, [f.type]: (o[f.type] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  return html`<section class="flist" aria-label="Files in this change">
    <div class="flist-h"><b>${plural(files.length, 'file')}</b><span class="muted small">${kinds.map(([k, n]) => `${n} ${k}`).join(' · ')}</span></div>
    ${groups.map(([d, fs]) => html`<details open=${groups.length <= 3 || fs.some((f) => f.id === sel)}>
      <summary><${Icon} n="folder-simple" /><span class="trunc grow">${d}</span><span class="n">${fs.length}</span></summary>
      <div class="flist-items">${fs.map((f) => html`<button aria-pressed=${f.id === sel} onClick=${() => onPick(f.id)}><${Icon} n=${FILE_ICON[f.type] || 'file'} /><span class="trunc">${f.name}</span></button>`)}</div>
    </details>`)}
  </section>`;
}

// Both versions running, side by side, each in a sandboxed frame (compiled against the project as it is now).
function LivePair({ a }) {
  const before = useFetch(a.before?.id ? `/snapshots/${a.before.id}/live` : null);
  const after = useFetch(`/snapshots/${a.after.id}/live`);
  const [h, setH] = useState({});
  const box = useRef();
  useEffect(() => { // each frame says how tall its drawing is
    const on = (e) => { if (e.data?.trace !== 'height') return; const i = [...(box.current?.querySelectorAll('iframe') || [])].findIndex((f) => f.contentWindow === e.source); if (i >= 0) setH((o) => ({ ...o, [i]: Math.max(140, Math.min(900, e.data.h + 4)) })); };
    addEventListener('message', on); return () => removeEventListener('message', on);
  }, []);
  let n = -1;
  const frame = (f, label) => html`<div class="col" style="gap:6px;min-width:0"><span class="caps" style="color:var(--ink-3);font-weight:500">${label}</span>${f.error ? html`<p class="small muted">${f.error.message}</p>` : !f.data ? html`<${Loading} h=${360} />` : html`<iframe class="live" title=${`${a.name}, ${label.toLowerCase()}`} sandbox="allow-scripts" srcdoc=${f.data.html} style=${h[++n] ? { height: `${Math.max(...Object.values(h))}px` } : undefined}></iframe>`}</div>`;
  return html`<div ref=${box} class=${`livepair${a.before?.id ? '' : ' one'}`}>${a.before?.id && frame(before, 'Before')}${frame(after, a.before?.id ? 'After' : 'This version')}</div>`;
}

// References pinned to this change: add a picture or video, pin one you already have, or unpin.
function RefsCard({ m, pid, refs, canEdit, reload }) {
  const file = useRef();
  const [pick, setPick] = useState(false);
  const upload = async (files) => {
    const list = [...files];
    for (const f of list) { try { await api(`/projects/${pid}/references/upload?moment=${m.id}`, { method: 'POST', raw: f, headers: { 'x-filename': encodeURIComponent(f.name || 'reference.png') } }); } catch (e) { fail(e); } }
    if (list.length) { toast(`${plural(list.length, 'reference')} pinned to this change`); reload(); }
  };
  const unpin = (r) => api(`/references/${r.id}/links/${m.id}`, { method: 'DELETE' }).then(() => { toast('Unpinned. It stays in References.'); reload(); }).catch(fail);
  return html`<article class="clog">
    <div class="clog-h"><h3 class="grow">References</h3>${canEdit && html`<span class="tools">
      <button class="ibtn" aria-label="Pin a reference you already have" title="Pin one from References" onClick=${() => setPick(true)}><${Icon} n="push-pin" /></button>
      <button class="ibtn" aria-label="Add a picture or video" title="Add a picture or video" onClick=${() => file.current.click()}><${Icon} n="plus" /></button></span>`}</div>
    ${refs.length ? html`<div class="refgrid">${refs.map((r) => html`<figure>
        <${Pics} items=${[r]} label=${r.title} size="lg" />
        <figcaption><span class="trunc">${r.title || r.kind}</span><span class="tiny muted">${r.by === 'prompt' ? 'From your prompt' : r.by === 'you' ? 'Pinned by you' : r.by}</span></figcaption>
        ${canEdit && html`<button class="ibtn unpin" aria-label=${`Unpin ${r.title}`} title="Unpin" onClick=${() => unpin(r)}><${Icon} n="x" /></button>`}
      </figure>`)}</div>`
    : html`<p class="small muted">Pin the pictures and videos that shaped this change. Ones you paste into a prompt to your AI land here by themselves.</p>`}
    <input type="file" hidden multiple accept="image/*,video/*" ref=${file} onChange=${(e) => { upload(e.target.files); e.target.value = ''; }} />
    ${pick && html`<${PinRef} pid=${pid} m=${m} pinned=${refs} onClose=${() => setPick(false)} onDone=${reload} />`}
  </article>`;
}
function PinRef({ pid, m, pinned, onClose, onDone }) {
  const { data } = useFetch(`/projects/${pid}/references`);
  const have = new Set(pinned.map((r) => r.id));
  const list = (data || []).filter((r) => !have.has(r.id) && (r.thumb_key || r.kind === 'note' || r.kind === 'link'));
  const pin = (r) => api(`/references/${r.id}/links`, { method: 'POST', body: { moment_id: m.id } }).then(() => { toast('Pinned to this change'); onDone(); onClose(); }).catch(fail);
  return html`<${Dialog} title="Pin a reference to this change" size="lg" onClose=${onClose}>
    ${!data ? html`<${Loading} h=${200} />` : !list.length ? html`<p class="small muted">Every reference in this project is already pinned here. Add new ones with +.</p>`
    : html`<div class="pickgrid">${list.map((r) => html`<button onClick=${() => pin(r)}>${r.thumb_key ? html`<img src=${fileUrl(r.thumb_key)} alt="" loading="lazy" />` : html`<span class="ph"><${Icon} n=${r.kind === 'link' ? 'link-simple' : 'note'} /></span>`}<span class="trunc small">${r.title || r.kind}</span></button>`)}</div>`}
  </${Dialog}>`;
}

export function Moment({ id, focus }) {
  const { data: m, error, loading, reload } = useFetch(`/moments/${id}`, ['moment', 'comment', 'artifact', 'reference', 'memory'], (t, d) => t === 'memory' || d.id === id || d.target_id === id || d.moment_id === id || t === 'artifact' || t === 'comment' || t === 'reference');
  const me = useMe();
  const [sel, setSel] = useState(null);
  const [view, setView] = useState('picture'); // a drawn component: picture, live or code
  const [region, setRegion] = useState(null);
  const [pinning, setPinning] = useState(false);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({});
  useEffect(() => { if (m) setForm({ title: m.title, summary: m.summary, why: m.why || '' }); }, [m?.id, m?.title, m?.summary, m?.why]);
  useEffect(() => { if (focus && m) setTimeout(() => document.getElementById(`c-${focus}`)?.scrollIntoView({ block: 'center' }), 60); }, [focus, !!m]);
  useKeys({ arrowleft: () => m?.prev && go(`/m/${m.prev.id}`), arrowright: () => m?.next && go(`/m/${m.next.id}`) }, [m?.prev?.id, m?.next?.id]);
  if (error) return html`<${Header}><a href="#/">Home</a></${Header}><div class="content"><${ErrorBox} error=${error} retry=${reload} /></div>`;
  if (loading && !m) return html`<${Header}><span>Loading…</span></${Header}><div class="content"><${Loading} h=${480} /></div>`;
  const visuals = m.assets.filter(isVisual);
  const files = m.assets.filter((x) => !isVisual(x));
  const a = m.assets.find((x) => x.id === sel) || visuals[0] || m.assets[0];
  const pid = m.project_id || m.route_guess;
  const canEdit = me && !me.user.guest && ['owner', 'editor'].includes(me.user.role);
  const canReview = me && !me.user.guest && ['owner', 'editor', 'reviewer'].includes(me.user.role);
  const attr = m.changes.filter((c) => !['region', 'visual'].includes(c.kind) && (m.assets.length < 2 || c.asset_id === a?.id));
  const regions = [...m.changes.filter((c) => c.kind === 'region' && c.asset_id === a?.id).map((c) => ({ ...c.region, id: c.id, change: c })), ...attr.filter((c) => c.region).slice(0, 12).map((c) => ({ ...c.region, id: c.id, change: c, attr: true, label: `${c.path}: ${c.before || '—'} → ${c.after}` }))];
  const pins = m.comments.filter((c) => c.region).map((c, i) => ({ id: c.id, n: i + 1, region: c.region, body: c.body }));
  const comp = a?.after?.properties?.component;
  const drawn = !!comp?.mode;
  const textual = ['code', 'doc'].includes(a?.type) && a.after?.text != null && (!drawn || view === 'code');
  const video = a?.after?.properties?.video && a.after.file_key;
  const save = async () => { try { await api(`/moments/${id}`, { method: 'PATCH', body: form }); setEdit(false); toast('Saved'); reload(); } catch (e) { fail(e); } };
  const j = m.journey || { asked: [], reasoning: [], refs: [] };
  const lineage = [...m.evolved_from.map((x) => ({ ...x, dir: 'from' })), ...m.evolved_into.map((x) => ({ ...x, dir: 'into' }))];
  return html`
    <${Header} actions=${html`
      <button class="ibtn" aria-label="Previous iteration" disabled=${!m.prev} onClick=${() => go(`/m/${m.prev.id}`)} title=${m.prev?.title}><${Icon} n="caret-left" /></button>
      <button class="ibtn" aria-label="Next iteration" disabled=${!m.next} onClick=${() => go(`/m/${m.next.id}`)} title=${m.next?.title}><${Icon} n="caret-right" /></button>
      ${m.status === 'draft' && canEdit && html`<a class="btn sm" href=${`#/inbox/${m.id}`}>Review</a>`}
      ${m.status === 'accepted' && canEdit && html`<button class="btn sm" onClick=${() => api(`/moments/${id}`, { method: 'PATCH', body: { pinned: !m.pinned } }).then(() => { toast(m.pinned ? 'Unpinned' : 'Pinned to the project'); reload(); }).catch(fail)}><${Icon} n="push-pin" /><span class="label-lg">${m.pinned ? 'Unpin' : 'Pin'}</span></button>`}`}>
      ${pid ? html`<a href=${`#/p/${pid}`}>${m.project_name || m.guess_name}</a>` : html`<a href="#/inbox">Review</a>`}<${Icon} n="caret-right" /><b class="trunc">${m.title}</b>
    </${Header}>
    <div class="content wide"><div class="mdetail">
      <div class="col" style="gap:12px">
        ${visuals.length > 1 && html`<div class="vstrip" role="tablist" aria-label="Pictures in this change">${visuals.map((v) => html`<button role="tab" aria-selected=${v.id === a?.id} title=${v.name} onClick=${() => setSel(v.id)}><img src=${fileUrl(v.after.thumb_key || v.after.image_key)} alt=${v.name} loading="lazy" /></button>`)}</div>`}
        ${drawn && html`<div class="row wrap between"><${Seg} label="Show the component" value=${view} onChange=${setView} options=${[{ value: 'picture', label: 'Drawn', icon: 'image' }, { value: 'live', label: 'Live', icon: 'play' }, { value: 'code', label: 'Code', icon: 'code' }]} /><span class="small muted">${comp.mode === 'app' ? 'Drawn inside the app, with this version of the file' : `Drawn from the code: ${comp.names.join(', ')}`}</span></div>`}
        ${comp?.error && html`<p class="note small">Couldn’t draw this component: ${comp.error} The code change is below.</p>`}
        ${a && drawn && view === 'live' ? html`<${LivePair} a=${a} />` : a && (video ? html`<div class="viewer"><video class="vplay" src=${fileUrl(a.after.file_key)} poster=${fileUrl(a.after.image_key)} controls playsinline></video></div>`
          : textual ? html`<div class="col" style="gap:6px"><span class="small muted mono trunc">${a.path || a.name}</span><${TextDiff} before=${a.before?.text || ''} after=${a.after?.text || ''} /></div>`
          : html`<${Viewer} before=${a.before} after=${a.after} regions=${regions} pins=${pins} pinning=${pinning} focusPin=${focus}
              onPin=${(r) => { setRegion(r); setPinning(false); }} onRegion=${(r) => { setRegion({ x: r.x, y: r.y, w: r.w, h: r.h }); toast('Region picked: write your comment beside it.'); }} />`)}
        ${a?.after?.properties?.code && html`<div class="panel col"><span class="caps">Commit</span><code>${a.after.properties.code.sha?.slice(0, 7)}</code><p class="small" style="white-space:pre-wrap">${a.after.properties.code.message}</p></div>`}
        ${a?.after?.properties?.lottie && html`<${Lottie} fileKey=${a.after.file_key} />`}
        <div class="row wrap small muted" style="gap:14px">
          ${a?.after?.properties?.page && html`<a href=${a.after.properties.page.url} target="_blank" rel="noopener" class="trunc">${a.after.properties.page.url}</a>`}
          ${a?.url && !a?.after?.properties?.page && html`<a href=${a.url} target="_blank" rel="noopener">Open in ${a.tool === 'figma' ? 'Figma' : a.tool === 'github' ? 'GitHub' : 'its tool'} <${Icon} n="arrow-up-right" /></a>`}
          ${a?.after?.file_key && html`<a href=${fileUrl(a.after.file_key)} download=${a.name}><${Icon} n="download-simple" /> Download this version</a>`}
          ${a && html`<a href=${`#/asset/${a.id}`}>Every version of ${a.name}</a>`}
        </div>
        ${files.length > 0 && m.assets.length > 1 && html`<${FileList} files=${files} sel=${a?.id} onPick=${setSel} />`}
      </div>

      <aside aria-label="The journey of this change">
        ${(j.asked.length > 0) && html`<div class="col" style="gap:8px"><span class="phase">What you gave</span><${AskedList} list=${j.asked} /></div>`}
        <span class="phase">What changed</span>
        <article class="clog">
          <div class="clog-h">${edit ? html`<input class="input sm" value=${form.title} onInput=${(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" />` : html`<h3 class="grow">Changes</h3>`}
            ${canEdit && !edit && html`<span class="tools"><button class="ibtn" aria-label="Write the changes again from the diff" title="Write again" onClick=${() => api(`/moments/${id}/redescribe`, { method: 'POST' }).then(() => { toast('Writing it again from the diff'); setTimeout(reload, 800); }).catch(fail)}><${Icon} n="arrows-clockwise" /></button><button class="ibtn" aria-label="Edit the entry" title="Edit" onClick=${() => setEdit(true)}><${Icon} n="pencil-simple" /></button></span>`}</div>
          ${edit ? html`<textarea class="input" rows="3" value=${form.summary} onInput=${(e) => setForm({ ...form, summary: e.target.value })} aria-label="Summary"></textarea>
              <textarea class="input" rows="2" value=${form.why} onInput=${(e) => setForm({ ...form, why: e.target.value })} aria-label="Why it changed" placeholder="Why it changed, if you know."></textarea>
              <div class="row"><button class="btn primary sm" onClick=${save}>Save</button><button class="btn ghost sm" onClick=${() => setEdit(false)}>Cancel</button></div>`
            : html`<${Sentence} seg=${m.sentence} text=${m.summary} />${m.why && html`<p class="note-body"><b>${m.why}</b></p>`}`}
          ${lineage.length > 0 && html`<p class="small ink2">${lineage.map((x, i) => html`${i ? ' · ' : ''}${x.dir === 'from' ? 'Evolved from ' : 'Evolved into '}<a href=${`#/m/${x.id}`} class="kw">${x.title}</a>`)}</p>`}
          <div class="row wrap tiny muted" style="gap:6px"><${Avatar} name=${m.agent || m.actor_name} agent=${!!m.agent} /><span>${m.agent || m.actor_name}</span><span>·</span><${ToolChip} tool=${m.tool} short /><span title=${stamp(m.end_ts)}>${dayLabel(m.end_ts)} ${time(m.end_ts)}</span>${m.asset_count > 1 && html`<span>· ${plural(m.asset_count, 'file')}</span>`}<span>·</span><${Magnitude} score=${m.magnitude} bucket=${m.bucket} basis=${m.basis} compact />${m.status !== 'accepted' && html`<span class="chip">${m.status}</span>`}${m.exploration_name && html`<span class="chip">${m.exploration_name}</span>`}</div>
        </article>
        <${AttrCards} changes=${attr} />
        <span class="phase">Why</span>
        ${j.reasoning.length ? j.reasoning.map((r) => html`<${Reasoning} r=${r} canReview=${canReview} onChange=${reload} focused=${r.id === focus} />`) : pid && html`${!m.why && canEdit && html`<${FindWhy} m=${m} reload=${reload} />`}<${ScriptHint} pid=${pid} />`}
        ${pid && html`<${RefsCard} m=${m} pid=${pid} refs=${j.refs} canEdit=${canEdit} reload=${reload} />`}
        ${m.decisions.length > 0 && html`<article class="clog"><h3>Decided here</h3>${m.decisions.map((d) => html`<div class="small row" style="align-items:flex-start"><${Icon} n=${d.status === 'confirmed' ? 'seal-check' : 'seal-question'} /><span>${d.text}</span></div>`)}</article>`}
        ${m.artifacts.length > 0 && html`<article class="clog"><h3>From agents</h3>${m.artifacts.map((x) => html`<a class="small row" href=${`#/p/${pid}/artifacts`}><${Icon} n="sparkle" cls="tool-ico k-agent" />${x.title} <span class="muted">· ${x.status}</span></a>`)}</article>`}
        <span class="phase">Feedback</span>
        <div class="col" style="gap:8px">
          ${m.comments.map((c) => html`<${Thread} c=${c} me=${me} onChange=${reload} pinNo=${pins.find((p) => p.id === c.id)?.n} focused=${c.id === focus} canEdit=${canEdit} projectId=${pid} />`)}
          ${pid ? html`<${Composer} target=${{ target_type: 'moment', target_id: id }} region=${region} clearRegion=${() => setRegion(null)} onPosted=${reload} pinning=${pinning} setPinning=${a?.after?.image_key && !textual && !video ? setPinning : null} />` : html`<p class="small muted">File this into a project to comment on it.</p>`}
          <p class="tiny muted">Agents connected to Trace read open comments when they’re called, and can answer here.</p>
        </div>
      </aside>
    </div></div>`;
}

// Lottie files play right in Trace.
function Lottie({ fileKey }) {
  const box = useRef();
  useEffect(() => {
    let anim;
    import('/vendor/lottie.mjs').then(({ default: lottie }) => {
      anim = lottie.loadAnimation({ container: box.current, renderer: 'svg', loop: true, autoplay: !matchMedia('(prefers-reduced-motion: reduce)').matches, path: fileUrl(fileKey) });
    }).catch(() => {});
    return () => anim?.destroy();
  }, [fileKey]);
  return html`<div class="panel"><span class="caps">Animation preview</span><div ref=${box} style="max-width:420px;margin:8px auto"></div></div>`;
}
