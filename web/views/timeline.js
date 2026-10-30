// A project, opened, the NCS way: the back arrow and the tick scrubber on the left, every iteration down the
// middle as it looks (newest first, the date floating at the top), and beside it the iteration in view: what
// changed (the sentence, before → after values), why, the notes marked on it, and what you gave your AI for it.
// The pencil turns on annotate (NCS's bar): draw, erase, comment, mark, close, and search.
import { html, useState, useEffect, useRef, api, useFetch, useAi, Icon, Avatar, Menu, ErrorBox, Loading, fileUrl, toast, fail, copy, go, plural, rel } from '../lib.js';
import { Sentence, AttrCards, dayLabel, time, longDate } from './ncs.js';
import { Pics, FiledOut, fileChat } from './journey.js';
import { AskButton } from './ask.js';

const TOOLS = [['draw', 'pencil-simple', 'Draw'], ['erase', 'eraser', 'Erase'], ['comment', 'chat-circle', 'Comment'], ['mark', 'crosshair', 'Mark a spot']];
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// One iteration, as it looks, with what's been drawn and said on it.
function Frame({ p, it, i, tool, reload, onFocus }) {
  const m = it.moment, img = m.image;
  const box = useRef();
  const [rect, setRect] = useState(null); // where the picture is drawn inside its frame
  const [line, setLine] = useState(null); // a stroke being drawn
  const [draft, setDraft] = useState(null); // a comment or mark being written
  const [text, setText] = useState('');
  const [peek, setPeek] = useState(null);
  const measure = () => {
    const el = box.current?.querySelector('img');
    if (!el?.naturalWidth) return;
    const b = box.current.getBoundingClientRect(), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const px = parseFloat(cs.paddingLeft), py = parseFloat(cs.paddingTop), cw = r.width - px * 2, ch = r.height - py * 2;
    const k = Math.min(cw / el.naturalWidth, ch / el.naturalHeight), w = el.naturalWidth * k, h = el.naturalHeight * k;
    setRect({ left: r.left - b.left + px + (cw - w) / 2, top: r.top - b.top + py + (ch - h) / 2, width: w, height: h });
  };
  useEffect(() => { measure(); const ro = new ResizeObserver(measure); if (box.current) ro.observe(box.current); return () => ro.disconnect(); }, [img?.image_key]);
  const at = (e) => { const b = box.current.getBoundingClientRect(); return [(e.clientX - b.left - rect.left) / rect.width, (e.clientY - b.top - rect.top) / rect.height]; };
  const inside = ([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
  const strokes = (it.marks || []).filter((x) => x.kind === 'stroke');
  const markers = (it.marks || []).filter((x) => x.kind === 'marker');
  const pins = (it.pins || []).filter((x) => !x.region?.snap || x.region.snap === img?.id);
  const save = (body) => api(`/projects/${p.id}/notes`, { method: 'POST', body: { ...body, anchor: { moment: m.id, snap: img?.id, ...(body.anchor || {}) } } }).then(reload).catch(fail);
  const erase = (n) => api(`/notes/${n.id}`, { method: 'DELETE' }).then(() => { reload(); toast('Erased'); }).catch(fail);

  const down = (e) => {
    if (!tool || !rect || e.button !== 0 || e.target.closest('.anno-pop, .apin, .amark, .acompose')) return;
    const q = at(e);
    if (!inside(q)) return;
    e.preventDefault();
    if (tool === 'draw') { box.current.setPointerCapture(e.pointerId); setLine([q]); }
    if (tool === 'comment' || tool === 'mark') { setDraft({ kind: tool, x: q[0], y: q[1] }); setText(''); }
  };
  const move = (e) => { if (line) setLine((l) => [...l, at(e).map((v) => Math.max(0, Math.min(1, v)))]); };
  const up = () => { if (line?.length > 2) save({ kind: 'stroke', meta: { points: line } }); setLine(null); };
  const submit = async (e) => {
    e.preventDefault();
    if (draft.kind === 'comment') {
      if (!text.trim()) return;
      try { await api('/comments', { method: 'POST', body: { target_type: 'moment', target_id: m.id, body: text, region: { x: Math.max(0, draft.x - 0.03), y: Math.max(0, draft.y - 0.02), w: 0.06, h: 0.04, snap: img?.id } } }); setDraft(null); toast('Comment pinned'); reload(); } catch (er) { fail(er); }
    } else { await save({ kind: 'marker', text, anchor: { x: draft.x, y: draft.y } }); setDraft(null); }
  };
  const pos = (x, y) => ({ left: `${rect.left + x * rect.width}px`, top: `${rect.top + y * rect.height}px` });
  const ratio = img?.width && img?.height ? Math.max(1.15, Math.min(2.4, img.width / img.height)) : 1.6;
  return html`<section class=${`tlf${tool ? ` tool-${tool}` : ''}`} data-i=${i} id=${`it-${m.id}`} aria-label=${m.title}>
    <div class="tlf-box" ref=${box} style=${{ aspectRatio: String(ratio) }} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onDblClick=${() => !tool && go(`/m/${m.id}`)}>
      ${img ? html`<img src=${fileUrl(img.image_key || img.thumb_key)} alt=${m.title} loading=${i > 2 ? 'lazy' : 'eager'} decoding="async" draggable="false" onLoad=${measure} />` : html`<div class="tlf-none"><${Icon} n="file" /><span class="small">${m.title}</span></div>`}
      ${rect && html`<svg class="anno-ink" style=${{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden=${tool !== 'erase'}>
        ${strokes.map((s) => html`<path class=${`ink c-${s.color || 'red'}`} d=${`M${s.meta.points.map((q) => q.join(' ')).join(' L')}`} onClick=${() => tool === 'erase' && erase(s)} />`)}
        ${line && html`<path class="ink c-red live" d=${`M${line.map((q) => q.join(' ')).join(' L')}`} />`}
      </svg>`}
      ${rect && markers.map((n, k) => html`<button class="amark" style=${pos(n.anchor.x, n.anchor.y)} aria-label=${`Mark ${k + 1}${n.text ? `: ${n.text}` : ''}`} title=${n.text || `Mark ${k + 1}`} onClick=${(e) => { e.stopPropagation(); if (tool === 'erase') erase(n); else onFocus(n.id); }}>${k + 1}</button>`)}
      ${rect && pins.map((c) => html`<button class="apin bubble" style=${pos(c.region.x + c.region.w / 2, c.region.y + c.region.h / 2)} aria-label=${`Comment by ${c.author_name}: ${c.body}`} onClick=${(e) => { e.stopPropagation(); setPeek(peek === c.id ? null : c.id); }}><${Icon} n="chat-circle" /></button>
        ${peek === c.id && html`<div class="anno-pop" style=${pos(c.region.x + c.region.w / 2, c.region.y + c.region.h)}><b>${c.author_name}</b><p>${c.body}</p><a class="small" href=${`#/m/${m.id}/${c.id}`}>Open the thread</a></div>`}`)}
      ${draft && rect && html`<span class=${draft.kind === 'mark' ? 'amark draft' : 'apin bubble draft'} style=${pos(draft.x, draft.y)}>${draft.kind === 'mark' ? markers.length + 1 : html`<${Icon} n="chat-circle" />`}</span>
        <form class="acompose" style=${{ left: `${Math.min(rect.left + draft.x * rect.width, (box.current?.clientWidth || 600) - 270)}px`, top: `${rect.top + draft.y * rect.height + 18}px` }} onSubmit=${submit} onPointerDown=${(e) => e.stopPropagation()}>
          <textarea class="input" rows="2" autofocus value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${draft.kind === 'mark' ? 'What’s here? (optional)' : 'What about this spot?'} aria-label=${draft.kind === 'mark' ? 'Label for the mark' : 'Comment'} onKeyDown=${(e) => { if (e.key === 'Escape') setDraft(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }}></textarea>
          <div class="row"><button class="btn primary sm">${draft.kind === 'mark' ? 'Mark' : 'Comment'}</button><button type="button" class="btn ghost sm" onClick=${() => setDraft(null)}>Cancel</button></div>
        </form>`}
      ${!tool && html`<a class="tlf-cap" href=${`#/m/${m.id}`}>${m.title}<span>${dayLabel(m.end_ts)} ${time(m.end_ts)}</span></a>`}
    </div>
  </section>`;
}

// The iteration in view: what changed, why, the marks on it, and what you gave your AI for it.
function Context({ p, it, reload, focusMark }) {
  const m = it.moment;
  const rows = (m.rows || []).map((c) => ({ ...c, node: c.path.split(' › ')[0].replace(/\s*\([A-Z]+\)$/, '') }));
  const r = it.reasoning[0];
  const why = (m.why || '').split(/(?<=[.!?])\s+/);
  const markers = (it.marks || []).filter((x) => x.kind === 'marker');
  const asked = it.asked.at(-1);
  const again = () => api(`/moments/${m.id}/redescribe`, { method: 'POST' }).then(() => { toast('Writing it again from the diff'); setTimeout(reload, 800); }).catch(fail);
  return html`<div class="ctxs" key=${m.id}>
    <article class="clog">
      <div class="clog-h"><h3 class="grow">Changes</h3><span class="tools">
        <button class="ibtn" aria-label="Write the changes again" title="Write again" onClick=${again}><${Icon} n="arrows-clockwise" /></button>
        <${Menu} label="Change actions" btn="ibtn" items=${[{ label: 'Open the change', icon: 'arrow-up-right', onClick: () => go(`/m/${m.id}`) }, { label: 'Copy a link', icon: 'link', onClick: () => copy(`${location.origin}/#/m/${m.id}`, 'Link copied') }]} /></span></div>
      <${Sentence} seg=${m.sentence} text=${m.summary} />
      <span class="who"><${Avatar} name=${m.agent || m.actor_name} agent=${!!m.agent} />${m.agent || m.actor_name} · ${dayLabel(m.end_ts)} ${time(m.end_ts)}</span>
    </article>
    <${AttrCards} changes=${rows} />
    ${(r || m.why) && html`<article class="clog why">
      <h3>${r ? 'Why' : 'Note'}</h3>
      ${r ? html`<p><b>${r.understood || r.asked}</b> ${(r.changes || []).map((c) => c.why).join(' ')}</p><a class="tiny" href=${`#/m/${m.id}/${r.id}`}>${r.agent}${r.status === 'resolved' ? ' · reviewed' : ' · needs your review'}</a>`
        : html`<p><b>${why[0]}</b> ${why.slice(1).join(' ')}</p>`}
    </article>`}
    ${markers.length > 0 && html`<article class="clog"><h3>Marked</h3><ol class="marks">${markers.map((n, k) => html`<li class=${n.id === focusMark ? 'on' : ''}><span class="amark sm">${k + 1}</span><span class="grow">${n.text || html`<span class="muted">No label</span>`}</span><span class="tiny muted">${n.author_name}</span></li>`)}</ol></article>`}
    ${asked && html`<article class="clog asked">
      <div class="clog-h"><h3 class="grow">You asked ${asked.tool}</h3>${p.can_edit && html`<button class="ibtn" aria-label="Not about this project" data-tip="Not about this project" onClick=${() => fileChat(asked.id, false)}><${Icon} n="eye-slash" /></button>`}</div>
      ${asked.about && html`<p class="asked-about">${asked.about}</p>`}
      <p class="clamp4">${asked.asked}</p>
      <${Pics} items=${asked.images} label="Pictures you gave" size="sm" />
      ${it.asked.length > 1 && html`<a class="tiny" href=${`#/m/${m.id}`}>${plural(it.asked.length - 1, 'earlier prompt')}</a>`}
    </article>`}
    ${it.refs.length > 0 && html`<article class="clog"><h3>References</h3><${Pics} items=${it.refs} label="References pinned to this change" size="sm" /></article>`}
  </div>`;
}

// Where the project stands, kept current by Trace's AI from the work, the project's folders and its AIs' sessions.
const FROM = { changes: 'change', comments: 'comment', notes: 'note', tasks: 'task', decisions: 'decision', sessions: 'AI session', files: 'file' };
function Digest({ p }) {
  const ai = { data: useAi() };
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const d = p.digest;
  const sync = () => { if (busy) return; setBusy(true); api(`/projects/${p.id}/ai/sync`, { method: 'POST' }).then((r) => toast(r.sorted?.out ? `In sync. Filed out ${plural(r.sorted.out, 'chat')} not about ${p.name}.` : 'In sync with the work, the folders and your AIs')).catch(fail).finally(() => setBusy(false)); };
  if (!d) return ai.data?.ready && p.can_edit ? html`<button class="digest-cta" onClick=${sync} aria-disabled=${busy}><${Icon} n="compass" />${busy ? 'Reading the work, the folders and your AIs’ sessions…' : 'Sum up where this stands'}</button>` : null;
  const from = Object.entries(d.from || {}).filter(([k, n]) => n && FROM[k]).map(([k, n]) => plural(n, FROM[k])).join(', ');
  const list = (title, xs) => xs?.length > 0 && html`<div><h4>${title}</h4><ul>${xs.map((x) => html`<li>${x}</li>`)}</ul></div>`;
  return html`<section class="digest" aria-label="Where it stands">
    <div class="digest-h"><${Icon} n="compass" /><b>Where it stands</b><span class="tiny muted" title=${from ? `Synced from ${from}` : ''}>${rel(d.at)}</span><span class="grow"></span>
      ${p.can_edit && html`<button class="ibtn" aria-label="Sync now" title="Sync with the work, the folders and your AIs" onClick=${sync}><${Icon} n="arrows-clockwise" cls=${busy ? 'spin' : ''} /></button>`}</div>
    <p>${d.now}</p>
    ${more ? html`<div class="digest-more">${list('What changed', d.changed)}${list('Open', d.open)}${list('Next', d.next)}${from && html`<p class="tiny muted">Synced from ${from} · ${d.model?.split('/').pop()}</p>`}</div>`
      : (d.changed?.length || d.open?.length || d.next?.length) > 0 && html`<button class="digest-toggle" onClick=${() => setMore(true)}>What changed, what’s open, what’s next</button>`}
  </section>`;
}

export function ProjectTimeline({ p, switcher }) {
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/journey?limit=20`, ['moment', 'comment', 'memory', 'reference', 'project'], (t, d) => t === 'memory' || !d.project_id || d.project_id === p.id);
  const [older, setOlder] = useState([]);
  const [more, setMore] = useState(null);
  const [active, setActive] = useState(0);
  const [tool, setTool] = useState(null);
  const [focusMark, setFocusMark] = useState(null);
  const sentinel = useRef();
  useEffect(() => { setOlder([]); setMore(null); }, [data]);
  const its = [...(data?.iterations || []), ...older];
  const canMore = more ?? data?.more;
  const loadMore = async () => { if (!canMore || !its.length) return; try { const r = await api(`/projects/${p.id}/journey?limit=20&before=${its.at(-1).moment.end_ts}`); setOlder((o) => [...o, ...r.iterations]); setMore(r.more); } catch (e) { fail(e); } };
  useEffect(() => { if (!sentinel.current) return; const io = new IntersectionObserver((es) => es[0].isIntersecting && loadMore(), { rootMargin: '800px' }); io.observe(sentinel.current); return () => io.disconnect(); });
  useEffect(() => { // which iteration is in view drives the scrubber, the date and the cards beside it
    const els = [...document.querySelectorAll('.tlf[data-i]')];
    if (!els.length) return;
    const io = new IntersectionObserver((es) => { const vis = es.filter((e) => e.isIntersecting).map((e) => +e.target.dataset.i); if (vis.length) setActive(Math.min(...vis)); }, { rootMargin: '-30% 0px -50% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [its.length]);
  useEffect(() => { const esc = (e) => { if (e.key === 'Escape' && !e.target.closest('input, textarea')) setTool(null); }; addEventListener('keydown', esc); return () => removeEventListener('keydown', esc); }, []);
  useEffect(() => { document.body.dataset.annotating = tool ? '1' : ''; return () => { document.body.dataset.annotating = ''; }; }, [tool]);
  const jump = (i) => document.querySelector(`.tlf[data-i="${i}"]`)?.scrollIntoView({ behavior: still() ? 'auto' : 'smooth', block: 'center' });
  const cur = its[Math.min(active, its.length - 1)];
  const desc = (p.brief || '').split('\n').map((l) => l.replace(/^goal:\s*/i, '')).find(Boolean);
  return html`<div class="ptl">
    <aside class="ptl-left">
      <a class="back" href="#/" aria-label="Back to Home" title="Home"><${Icon} n="arrow-left" /></a>
      <nav class="scrub" aria-label="Iterations">${its.slice(0, 80).map((it, i) => html`<button aria-current=${i === active} aria-label=${`${it.moment.title}, ${longDate(it.moment.end_ts)}`} title=${`${it.moment.title} · ${longDate(it.moment.end_ts)}`} onClick=${() => jump(i)}></button>`)}</nav>
    </aside>
    <main class="ptl-mid">
      <div class="datepill" aria-live="polite">${cur ? longDate(cur.moment.end_ts) : ' '}</div>
      <header class="ptl-head">
        <span class="meta">${plural(data?.total ?? p.counts.timeline, 'Iteration')}${p.latest ? ` · ${time(p.latest.end_ts)}` : ''}</span>
        <h1>${p.name}</h1>
        ${desc ? html`<p>${desc}</p>` : p.can_edit && html`<p class="muted">No description yet. Add one in the project’s settings (⋯).</p>`}
      </header>
      <${Digest} p=${p} />
      ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
      ${loading && !data && html`<div class="col" style="gap:16px"><${Loading} h=${300} /><${Loading} h=${300} /></div>`}
      ${data && !its.length && html`<div class="empty"><${Icon} n="files" cls="big" /><h2>Drop files here</h2><p>Every iteration of ${p.name} lands here, newest first.</p></div>`}
      <div class="tlfs">${its.map((it, i) => html`<${Frame} p=${p} it=${it} i=${i} tool=${tool} reload=${reload} onFocus=${setFocusMark} key=${it.moment.id} />`)}</div>
      ${data?.hidden > 0 && !canMore && html`<${FiledOut} pid=${p.id} n=${data.hidden} />`}
      ${canMore && html`<div ref=${sentinel} class="row" style="justify-content:center;padding:24px"><button class="btn sm" onClick=${loadMore}>Earlier iterations</button></div>`}
    </main>
    <aside class="ptl-right">
      <div class="ptl-switch">${switcher}</div>
      ${cur && html`<${Context} p=${p} it=${cur} reload=${reload} focusMark=${focusMark} />`}
    </aside>
    ${(p.can_edit || p.can_review) && html`<div class="fab-bar" role="toolbar" aria-label=${tool ? 'Annotate' : 'Project actions'}>
      ${tool ? html`<div class="anno-bar">${TOOLS.map(([id, icon, label]) => html`<button class="ibtn" aria-pressed=${tool === id} aria-label=${label} data-tip=${label} onClick=${() => setTool(id)}><${Icon} n=${icon} /></button>`)}<button class="ibtn" aria-label="Stop annotating" data-tip="Done" data-kbd="Esc" onClick=${() => setTool(null)}><${Icon} n="x" /></button></div>`
        : html`<button class="fab" onClick=${() => dispatchEvent(new Event('trace:upload'))} aria-label=${`Upload to ${p.name}`} data-tip=${`Upload to ${p.name}`}><${Icon} n="plus" /></button><${AskButton} />`}
      <div class="fab-2">${!tool && html`<button class="ibtn" aria-label="Annotate the work" data-tip="Annotate" onClick=${() => setTool('comment')}><${Icon} n="pencil-simple" /></button>`}<button class="ibtn" aria-label="Search" data-tip="Search" data-kbd="Ctrl K" onClick=${() => dispatchEvent(new Event('trace:search'))}><${Icon} n="magnifying-glass" /></button></div>
    </div>`}
  </div>`;
}
