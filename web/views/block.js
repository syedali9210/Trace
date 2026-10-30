// One block, opened: its things as frames down the middle (pictures on their grey well, text as quiet cards),
// small context cards beside each frame (the NCS changes sidebar, generalised), a tick scrubber, find-in-block,
// comment pins dropped on pictures, and sticky notes: loose ones at the top, or stuck beside a frame.
import { html, useState, useEffect, useRef, useMemo, api, useFetch, useMe, Header, Icon, Avatar, ErrorBox, Loading, fileUrl, toast, fail, go, plural, rel } from '../lib.js';
import { Sentence, BA, Tile, dayLabel, time, longDate } from './ncs.js';
import { AnnotTile, Pics, Lightbox } from './journey.js';

const COLORS = ['yellow', 'pink', 'green', 'blue', 'violet'];
const KINDS = { iteration: 'Iteration', comment: 'Review', reasoning: 'AI reasoning', reference: 'Reference', task: 'Task', decision: 'Decision', constraint: 'Constraint', prompt: 'Prompt', exploration: 'Exploration', answer: 'Case study', artifact: 'Artifact', stat: 'At a glance', sticky: 'Note' };
const STATUS = { met: 'ok', filled: 'ok', resolved: 'ok', done: 'ok', confirmed: 'ok', accepted: 'ok', conflict: 'err', missing: 'err', unseen: 'warn', partial: 'warn', open: '', in_progress: 'sel', suggested: '', unchecked: '' };
const TARGET = { iteration: 'moment', reference: 'reference', task: 'issue' }; // what a comment on the frame is about

// Text with the search term marked.
function Hl({ text, q }) {
  const s = String(text ?? '');
  if (!q || q.length < 2) return s;
  const parts = s.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((x, i) => (i % 2 ? html`<mark>${x}</mark>` : x));
}

export function Sticky({ n, reload, small }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(n.text);
  const patch = (body) => api(`/notes/${n.id}`, { method: 'PATCH', body }).then(reload).catch(fail);
  const del = () => api(`/notes/${n.id}`, { method: 'DELETE' }).then(() => { reload(); toast('Note removed'); }).catch(fail);
  return html`<div class=${`sticky c-${n.color || 'yellow'}${n.done ? ' done' : ''}${small ? ' sm' : ''}`}>
    ${edit ? html`<textarea class="sticky-ta" autofocus value=${text} onInput=${(e) => setText(e.target.value)} aria-label="Edit the note" onBlur=${() => { setEdit(false); if (text.trim() && text !== n.text) patch({ text }); }} onKeyDown=${(e) => { if (e.key === 'Escape') { setText(n.text); setEdit(false); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.target.blur(); }}></textarea>`
      : html`<button class="sticky-text" onClick=${() => setEdit(true)} aria-label="Edit the note">${n.text}</button>`}
    <div class="sticky-f">
      <span class="tiny trunc">${n.who || n.title} · ${rel(n.ts)}</span>
      <span class="grow"></span>
      ${COLORS.map((c) => html`<button class=${`dotc c-${c}`} aria-label=${`Make it ${c}`} aria-pressed=${n.color === c} onClick=${() => patch({ color: c })}></button>`)}
      <button class="ibtn sm" aria-label=${n.done ? 'Mark not done' : 'Mark done'} title=${n.done ? 'Not done' : 'Done'} onClick=${() => patch({ done: !n.done })}><${Icon} n=${n.done ? 'check-square' : 'square'} /></button>
      <button class="ibtn sm" aria-label="Remove the note" title="Remove" onClick=${del}><${Icon} n="trash" /></button>
    </div>
  </div>`;
}

function NewSticky({ pid, block, anchor, onDone, placeholder = 'A quick thought…' }) {
  const [text, setText] = useState('');
  const [color, setColor] = useState('yellow');
  const add = async (e) => { e?.preventDefault(); if (!text.trim()) return onDone(); try { await api(`/projects/${pid}/notes`, { method: 'POST', body: { block, text, color, anchor } }); setText(''); onDone(true); } catch (er) { fail(er); } };
  return html`<form class=${`sticky c-${color} new`} onSubmit=${add}>
    <textarea class="sticky-ta" autofocus value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${placeholder} aria-label="New sticky note" onKeyDown=${(e) => { if (e.key === 'Escape') onDone(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(e); }}></textarea>
    <div class="sticky-f">${COLORS.map((c) => html`<button type="button" class=${`dotc c-${c}`} aria-label=${c} aria-pressed=${color === c} onClick=${() => setColor(c)}></button>`)}<span class="grow"></span><button type="button" class="btn sm ghost" onClick=${() => onDone()}>Cancel</button><button class="btn sm primary">Stick</button></div>
  </form>`;
}

// A context card beside a frame.
function Ctx({ c, q }) {
  if (c.sentence) return html`<article class="clog"><h3>${c.title}</h3><${Sentence} seg=${c.sentence} /></article>`;
  if (c.changes) return html`<article class="clog"><div class="clog-h"><h3 class="grow">${c.title}</h3><span class="tiny muted">${plural(c.changes.length, 'change')}</span></div>
    ${c.changes.slice(0, 6).map((x) => html`<div class="attr"><span>${x.label}</span><${BA} c=${{ before: x.before, after: x.after, attr: x.label, path: x.label }} /></div>`)}</article>`;
  return html`<article class="clog ctx">
    <div class="clog-h"><h3 class="grow">${c.title}</h3>${c.status && STATUS[c.status] !== undefined && html`<span class=${`chip ${STATUS[c.status]}`}>${c.status.replace('_', ' ')}</span>`}</div>
    ${c.sub && html`<span class="tiny muted">${c.sub}</span>`}
    ${c.text && (c.href ? html`<a class="small" href=${c.href}><${Hl} text=${c.text} q=${q} /></a>` : html`<p class="small ink2 pre"><${Hl} text=${c.text} q=${q} /></p>`)}
    ${c.rows && html`<dl class="ctx-rows">${c.rows.map((r) => html`<dt>${r.href ? html`<a href=${r.href}>${r.label}</a>` : r.label}</dt>${r.value && html`<dd><${Hl} text=${r.value} q=${q} /></dd>`}`)}</dl>`}
    ${c.chips && html`<div class="row wrap" style="gap:4px">${c.chips.map((x) => (/^#[0-9a-f]{3,8}$/i.test(x) ? html`<span class="chip"><span class="sw" style=${{ background: x }}></span>${x}</span>` : html`<span class="chip">${x}</span>`))}</div>`}
  </article>`;
}

function Comment({ pid, it, onDone }) {
  const [text, setText] = useState('');
  const post = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api('/comments', { method: 'POST', body: { target_type: TARGET[it.kind], target_id: it.id, body: text } }); setText(''); toast('Comment added'); onDone(true); } catch (er) { fail(er); } };
  return html`<form class="clog col" onSubmit=${post}><textarea class="input" rows="2" autofocus value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Comment on this…" aria-label=${`Comment on ${it.title}`} onKeyDown=${(e) => e.key === 'Escape' && onDone()}></textarea><div class="row"><button class="btn sm primary">Comment</button><button type="button" class="btn sm ghost" onClick=${() => onDone()}>Cancel</button></div></form>`;
}

// The frame: the thing itself.
function Frame({ it, q, annotating, reload, onOpen }) {
  if (it.kind === 'iteration' && it.image) return html`<${AnnotTile} m=${{ id: it.id, title: it.title }} img=${it.image} pins=${it.pins || []} annotating=${annotating} onPinned=${reload} />`;
  if (it.kind === 'stat') return html`<a class="tframe stat" href=${it.href}><span class="kindl">${it.title}</span><span class="big">${it.value != null ? (it.title === 'Case study' ? `${it.value}%` : it.value) : ''}</span><p class="clamp3"><${Hl} text=${it.text} q=${q} /></p></a>`;
  if (it.image && (it.image.thumb_key || it.image.image_key) && it.kind !== 'prompt') {
    const big = it.kind === 'reference';
    return html`<div class="fimg span3 framed">
      <button class="frame-open" onClick=${() => onOpen(it)} aria-label=${`Open ${it.title}`}><img src=${fileUrl(it.image.image_key || it.image.thumb_key)} alt=${it.title} loading="lazy" />${it.image.kind === 'video' ? html`<span class="play"><${Icon} n="play" /></span>` : ''}</button>
      ${!big && html`<div class="frame-cap"><span class="kindl">${KINDS[it.kind]}</span><p class="clamp3"><${Hl} text=${it.text} q=${q} /></p></div>`}
    </div>`;
  }
  return html`<div class=${`tframe k-${it.kind}`}>
    <span class="kindl">${KINDS[it.kind] || it.kind}${it.status && html` · <span class=${`st ${STATUS[it.status] || ''}`}>${it.status.replace('_', ' ')}</span>`}</span>
    <h3><${Hl} text=${it.title} q=${q} /></h3>
    ${it.text && html`<p class=${`said ${it.kind === 'answer' || it.kind === 'prompt' ? '' : 'clamp6'}`}><${Hl} text=${it.text} q=${q} /></p>`}
    ${it.images?.length > 0 && html`<${Pics} items=${it.images} label="Pictures given" />`}
    ${it.url && html`<a class="small" href=${it.url} target="_blank" rel="noopener">${it.url}</a>`}
  </div>`;
}

export function BlockView({ p, block }) {
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/blocks/${block}`, ['project', 'moment', 'comment', 'reference', 'issue', 'decision', 'artifact', 'memory'], (t, d) => !d.project_id || d.project_id === p.id);
  const me = useMe();
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [active, setActive] = useState(0);
  const [annotating, setAnnotating] = useState(false);
  const [newNote, setNewNote] = useState(null); // null, 'top', or an item id
  const [commenting, setCommenting] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const find = useRef();
  const items = data?.items || [];
  const notes = items.filter((x) => x.kind === 'sticky');
  const loose = notes.filter((n) => !n.anchor?.item || !items.some((x) => x.id === n.anchor.item));
  const frames = items.filter((x) => x.kind !== 'sticky');
  const textOf = (x) => [x.title, x.text, ...(x.context || []).flatMap((c) => [c.title, c.text, ...(c.rows || []).flatMap((r) => [r.label, r.value])])].join(' ').toLowerCase();
  const matches = useMemo(() => (q.length < 2 ? [] : frames.filter((x) => textOf(x).includes(q.toLowerCase())).map((x) => x.id)), [q, data]);
  const jump = (id) => document.getElementById(`it-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  useEffect(() => { setHit(0); if (matches[0]) jump(matches[0]); }, [matches.join()]);
  useEffect(() => { // Ctrl+F finds in the block; Esc leaves modes
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && find.current) { e.preventDefault(); find.current.focus(); find.current.select(); }
      if (e.key === 'Escape' && !e.target.closest('input, textarea')) { setAnnotating(false); setNewNote(null); }
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  useEffect(() => { const t = () => setAnnotating((v) => !v); addEventListener('trace:annotate', t); return () => removeEventListener('trace:annotate', t); }, []);
  useEffect(() => { document.body.dataset.annotating = annotating ? '1' : ''; return () => { document.body.dataset.annotating = ''; }; }, [annotating]);
  useEffect(() => { // which frame is in view drives the scrubber and the date
    const els = [...document.querySelectorAll('.brow[data-i]')];
    if (!els.length) return;
    const io = new IntersectionObserver((es) => { const vis = es.filter((e) => e.isIntersecting).map((e) => +e.target.dataset.i); if (vis.length) setActive(Math.min(...vis)); }, { rootMargin: '-140px 0px -55% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [frames.length]);
  const next = (d) => { if (!matches.length) return; const n = (hit + d + matches.length) % matches.length; setHit(n); jump(matches[n]); };
  const canEdit = me && !me.user.guest;
  const b = data?.block;
  const cur = frames[Math.min(active, frames.length - 1)];
  const last = frames.map((x) => x.ts).filter(Boolean).sort((a, b_) => b_ - a)[0];
  const done = (refresh) => { setNewNote(null); setCommenting(null); if (refresh) reload(); };
  return html`
    <${Header} actions=${html`
      <label class="findbar"><${Icon} n="magnifying-glass" /><input ref=${find} value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Find in this block" aria-label="Find in this block" onKeyDown=${(e) => { if (e.key === 'Enter') next(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setQ(''); }} />${q.length >= 2 && html`<span class="tiny muted num">${matches.length ? `${hit + 1}/${matches.length}` : '0'}</span><button class="ibtn sm" aria-label="Previous match" onClick=${() => next(-1)}><${Icon} n="caret-up" /></button><button class="ibtn sm" aria-label="Next match" onClick=${() => next(1)}><${Icon} n="caret-down" /></button>`}</label>
      ${canEdit && html`<button class=${`btn sm${annotating ? ' on' : ''}`} aria-pressed=${annotating} onClick=${() => setAnnotating(!annotating)} title="Drop comment pins on pictures"><${Icon} n="pencil-simple" /><span class="label-lg">Annotate</span></button>
      <button class="btn sm" onClick=${() => setNewNote('top')}><${Icon} n="note" /><span class="label-lg">Sticky</span></button>`}`}>
      <a href=${`#/p/${p.id}`}>${p.name}</a><${Icon} n="caret-right" /><b class="trunc">${b?.title || 'Block'}</b>
    </${Header}>
    <div class="content">
      ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
      ${loading && !data && html`<${Loading} h=${400} />`}
      ${data && html`<div class="bview">
        <nav class="scrub" aria-label="Frames">${frames.slice(0, 80).map((x, i) => html`<button aria-current=${i === active} aria-label=${x.title} title=${x.title} onClick=${() => jump(x.id)}></button>`)}</nav>
        <div class="bv-main">
          ${cur?.ts > 0 && html`<div class="datepill" aria-live="polite">${longDate(cur.ts)}</div>`}
          <header class="bv-head">
            <a class="back" href=${`#/p/${p.id}`} aria-label="Back to the canvas"><${Icon} n="arrow-left" /></a>
            <span class="meta">${plural(frames.length, KINDS[frames[0]?.kind] ? 'item' : 'item')}${last ? ` · ${dayLabel(last)} ${time(last)}` : ''}${notes.length ? ` · ${plural(notes.length, 'note')}` : ''}</span>
            <h1><span class="blk-ico"><${Icon} n=${b.icon} /></span>${b.title}</h1>
            <p class="brief">${b.hint}</p>
          </header>
          ${annotating && html`<div class="annot-bar" role="status"><${Icon} n="pencil-simple" /><span class="grow">Annotating: click a picture to pin a comment on that spot.</span><button class="btn sm" onClick=${() => setAnnotating(false)}>Done</button></div>`}
          ${(loose.length > 0 || newNote === 'top') && html`<div class="stickies">
            ${newNote === 'top' && html`<${NewSticky} pid=${p.id} block=${block} onDone=${done} />`}
            ${loose.map((n) => html`<${Sticky} n=${n} reload=${reload} key=${n.id} />`)}
          </div>`}
          ${!frames.length && !loose.length && newNote !== 'top' && html`<div class="empty"><${Icon} n=${b.icon} cls="big" /><h2>${b.custom ? 'An empty block' : `Nothing in ${b.title} yet`}</h2><p>${b.custom ? 'Stick your notes here: quick thoughts, research, anything.' : b.hint}</p>${canEdit && html`<button class="btn sm" style="margin-top:10px" onClick=${() => setNewNote('top')}><${Icon} n="note" />Add a sticky</button>`}</div>`}
          <div class="bv-list">${frames.map((it, i) => {
            const stuck = notes.filter((n) => n.anchor?.item === it.id);
            return html`<section class=${`brow${matches.includes(it.id) ? ' found' : ''}${matches[hit] === it.id ? ' here' : ''}`} id=${`it-${it.id}`} data-i=${i} key=${it.id}>
              <div class="bframe">
                <${Frame} it=${it} q=${q} annotating=${annotating && it.kind === 'iteration'} reload=${reload} onOpen=${(x) => (x.image?.kind === 'video' || x.kind === 'reference' ? setLightbox({ ...x.image, title: x.title, note: x.text, file_key: x.image.file_key || x.image.image_key, kind: x.image.kind || x.refKind }) : x.href && go(x.href.slice(1)))} />
                <div class="frame-meta">${it.who && html`<${Avatar} name=${it.who} agent=${it.agent} /><span>${it.who}</span>`}${it.ts > 0 && html`<span class="muted">${dayLabel(it.ts)} ${time(it.ts)}</span>`}<span class="grow"></span>
                  ${it.href && html`<a class="ibtn sm" href=${it.href} aria-label=${`Open ${it.title}`} title="Open"><${Icon} n="arrow-up-right" /></a>`}</div>
              </div>
              <aside class="bctx" aria-label=${`About ${it.title}`}>
                ${(it.context || []).map((c) => html`<${Ctx} c=${c} q=${q} />`)}
                ${stuck.map((n) => html`<${Sticky} n=${n} reload=${reload} small key=${n.id} />`)}
                ${newNote === it.id && html`<${NewSticky} pid=${p.id} block=${block} anchor=${{ item: it.id }} onDone=${done} placeholder="A note on this…" />`}
                ${commenting === it.id && html`<${Comment} pid=${p.id} it=${it} onDone=${done} />`}
                ${canEdit && newNote !== it.id && commenting !== it.id && html`<div class="ctx-add">
                  <button class="btn sm ghost" onClick=${() => setNewNote(it.id)}><${Icon} n="note" />Note</button>
                  ${TARGET[it.kind] && html`<button class="btn sm ghost" onClick=${() => setCommenting(it.id)}><${Icon} n="chat-circle" />Comment</button>`}
                </div>`}
              </aside>
            </section>`;
          })}</div>
        </div>
      </div>`}
    </div>
    ${lightbox && html`<${Lightbox} item=${lightbox} onClose=${() => setLightbox(null)} />`}`;
}
