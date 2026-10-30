// One block, opened: its things as frames down the middle (pictures on their grey well, text as quiet cards),
// small context cards beside each frame (the NCS changes sidebar, generalised), a tick scrubber, find-in-block,
// comment pins dropped on pictures, and sticky notes: loose ones at the top, or stuck beside a frame.
import { useState, useEffect, useRef, useMemo, api, useFetch, useMe, Header, Icon, Avatar, ErrorBox, Loading, fileUrl, toast, fail, go, plural, rel, Button, btnProps, ph, Chip, sx, Fragment } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { Sentence, BA, Tile, dayLabel, time, longDate } from './ncs.jsx';
import { AnnotTile, Pics, Lightbox } from './journey.jsx';

const COLORS = ['yellow', 'pink', 'green', 'blue', 'violet'];
const KINDS = { iteration: 'Iteration', comment: 'Review', reasoning: 'AI reasoning', reference: 'Reference', task: 'Task', decision: 'Decision', constraint: 'Constraint', prompt: 'Prompt', exploration: 'Exploration', answer: 'Case study', artifact: 'Artifact', stat: 'At a glance', sticky: 'Note' };
const STATUS = { met: 'ok', filled: 'ok', resolved: 'ok', done: 'ok', confirmed: 'ok', accepted: 'ok', conflict: 'err', missing: 'err', unseen: 'warn', partial: 'warn', open: '', in_progress: 'sel', suggested: '', unchecked: '' };
const TARGET = { iteration: 'moment', reference: 'reference', task: 'issue' }; // what a comment on the frame is about

// Text with the search term marked.
function Hl({ text, q }) {
  const s = String(text ?? '');
  if (!q || q.length < 2) return s;
  const parts = s.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((x, i) => (i % 2 ? (<mark>{x}</mark>) : x));
}

export function Sticky({ n, reload, small }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(n.text);
  const patch = (body) => api(`/notes/${n.id}`, { method: 'PATCH', body }).then(reload).catch(fail);
  const del = () => api(`/notes/${n.id}`, { method: 'DELETE' }).then(() => { reload(); toast('Note removed'); }).catch(fail);
  return (<div className={`stickynote c-${n.color || 'yellow'}${n.done ? ' done' : ''}${small ? ' sm' : ''}`}>
    {edit ? (<textarea className="sticky-ta" autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit the note" onBlur={() => { setEdit(false); if (text.trim() && text !== n.text) patch({ text }); }} onKeyDown={(e) => { if (e.key === 'Escape') { setText(n.text); setEdit(false); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.target.blur(); }}></textarea>)
      : (<button className="sticky-text" onClick={() => setEdit(true)} aria-label="Edit the note">{n.text}</button>)}
    <div className="sticky-f">
      <span className="tiny trunc">{n.who || n.title} · {rel(n.ts)}</span>
      <span className="grow"></span>
      {COLORS.map((c, ki) => (<button key={c?.id ?? ki} className={`dotc c-${c}`} aria-label={`Make it ${c}`} aria-pressed={n.color === c} onClick={() => patch({ color: c })}></button>))}
      <Button variant="ghost" size="icon-compact" aria-label={n.done ? 'Mark not done' : 'Mark done'} title={n.done ? 'Not done' : 'Done'} onClick={() => patch({ done: !n.done })}><Icon n={n.done ? 'check-square' : 'square'} size={15} /></Button>
      <Button variant="ghost" size="icon-compact" aria-label="Remove the note" title="Remove" onClick={del}><Icon n="trash" size={15} /></Button>
    </div>
  </div>);
}

function NewSticky({ pid, block, anchor, onDone, placeholder = 'A quick thought…' }) {
  const [text, setText] = useState('');
  const [color, setColor] = useState('yellow');
  const add = async (e) => { e?.preventDefault(); if (!text.trim()) return onDone(); try { await api(`/projects/${pid}/notes`, { method: 'POST', body: { block, text, color, anchor } }); setText(''); onDone(true); } catch (er) { fail(er); } };
  return (<form className={`stickynote c-${color} new`} onSubmit={add}>
    <textarea className="sticky-ta" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="New sticky note" onKeyDown={(e) => { if (e.key === 'Escape') onDone(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(e); }}></textarea>
    <div className="sticky-f">{COLORS.map((c, ki) => (<button key={c?.id ?? ki} type="button" className={`dotc c-${c}`} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}></button>))}<span className="grow"></span><Button variant="ghost" size="compact" type="button" onClick={() => onDone()}>Cancel</Button><Button variant="primary" size="compact">Stick</Button></div>
  </form>);
}

// A context card beside a frame.
function Ctx({ c, q }) {
  if (c.sentence) return (<article className="clog"><h3>{c.title}</h3><Sentence seg={c.sentence}  /></article>);
  if (c.changes) return (<article className="clog"><div className="clog-h"><h3 className="grow">{c.title}</h3><span className="tiny muted">{plural(c.changes.length, 'change')}</span></div>
    {c.changes.slice(0, 6).map((x, ki) => (<div key={x?.id ?? ki} className="attr"><span>{x.label}</span><BA c={{ before: x.before, after: x.after, attr: x.label, path: x.label }}  /></div>))}</article>);
  return (<article className="clog ctx">
    <div className="clog-h"><h3 className="grow">{c.title}</h3>{c.status && STATUS[c.status] !== undefined && (<span className={`chip ${STATUS[c.status]}`}>{c.status.replace('_', ' ')}</span>)}</div>
    {c.sub && (<span className="tiny muted">{c.sub}</span>)}
    {c.text && (c.href ? (<a className="small" href={c.href}><Hl text={c.text} q={q}  /></a>) : (<p className="small ink2 pre"><Hl text={c.text} q={q}  /></p>))}
    {c.rows && (<dl className="ctx-rows">{c.rows.map((r, ki) => <Fragment key={r?.id ?? ki}><dt>{r.href ? (<a href={r.href}>{r.label}</a>) : r.label}</dt>{r.value && (<dd><Hl text={r.value} q={q}  /></dd>)}</Fragment>)}</dl>)}
    {c.chips && (<div className="row wrap" style={sx("gap:4px")}>{c.chips.map((x) => (/^#[0-9a-f]{3,8}$/i.test(x) ? (<Chip><span className="sw" style={sx({ background: x })}></span>{x}</Chip>) : (<Chip>{x}</Chip>)))}</div>)}
  </article>);
}

function Comment({ pid, it, onDone }) {
  const [text, setText] = useState('');
  const post = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api('/comments', { method: 'POST', body: { target_type: TARGET[it.kind], target_id: it.id, body: text } }); setText(''); toast('Comment added'); onDone(true); } catch (er) { fail(er); } };
  return (<form className="clog col" onSubmit={post}><Textarea rows="2" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Comment on this…" aria-label={`Comment on ${it.title}`} onKeyDown={(e) => e.key === 'Escape' && onDone()}></Textarea><div className="row"><Button variant="primary" size="compact">Comment</Button><Button variant="ghost" size="compact" type="button" onClick={() => onDone()}>Cancel</Button></div></form>);
}

// The frame: the thing itself.
function Frame({ it, q, annotating, reload, onOpen }) {
  if (it.kind === 'iteration' && it.image) return (<AnnotTile m={{ id: it.id, title: it.title }} img={it.image} pins={it.pins || []} annotating={annotating} onPinned={reload}  />);
  if (it.kind === 'stat') return (<a className="tframe stat" href={it.href}><span className="kindl">{it.title}</span><span className="big">{it.value != null ? (it.title === 'Case study' ? `${it.value}%` : it.value) : ''}</span><p className="clamp3"><Hl text={it.text} q={q}  /></p></a>);
  if (it.image && (it.image.thumb_key || it.image.image_key) && it.kind !== 'prompt') {
    const big = it.kind === 'reference';
    return (<div className="fimg span3 framed">
      <button className="frame-open" onClick={() => onOpen(it)} aria-label={`Open ${it.title}`}><img src={fileUrl(it.image.image_key || it.image.thumb_key)} alt={it.title} loading="lazy"  />{it.image.kind === 'video' ? (<span className="play"><Icon n="play"  /></span>) : ''}</button>
      {!big && (<div className="frame-cap"><span className="kindl">{KINDS[it.kind]}</span><p className="clamp3"><Hl text={it.text} q={q}  /></p></div>)}
    </div>);
  }
  return (<div className={`tframe k-${it.kind}`}>
    <span className="kindl">{KINDS[it.kind] || it.kind}{it.status && <>· <span className={`st ${STATUS[it.status] || ''}`}>{it.status.replace('_', ' ')}</span></>}</span>
    <h3><Hl text={it.title} q={q}  /></h3>
    {it.text && (<p className={`said ${it.kind === 'answer' || it.kind === 'prompt' ? '' : 'clamp6'}`}><Hl text={it.text} q={q}  /></p>)}
    {it.images?.length > 0 && (<Pics items={it.images} label="Pictures given"  />)}
    {it.url && (<a className="small" href={it.url} target="_blank" rel="noopener">{it.url}</a>)}
  </div>);
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
  return <><Header actions={<><label className="findbar"><Icon n="magnifying-glass"  /><input ref={find} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in this block" aria-label="Find in this block" onKeyDown={(e) => { if (e.key === 'Enter') next(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setQ(''); }}  />{q.length >= 2 && <><span className="tiny muted num">{matches.length ? `${hit + 1}/${matches.length}` : '0'}</span><Button variant="ghost" size="icon-compact" aria-label="Previous match" onClick={() => next(-1)}><Icon n="caret-up" size={15} /></Button><Button variant="ghost" size="icon-compact" aria-label="Next match" onClick={() => next(1)}><Icon n="caret-down" size={15} /></Button></>}</label>
      {canEdit && <><Button {...btnProps(`btn sm${annotating ? ' on' : ''}`)} leadingIcon={ph("pencil-simple")} aria-pressed={annotating} onClick={() => setAnnotating(!annotating)} title="Drop comment pins on pictures"><span className="label-lg">Annotate</span></Button>
      <Button variant="tertiary" size="compact" leadingIcon={ph("note")} onClick={() => setNewNote('top')}><span className="label-lg">Sticky</span></Button></>}</>}>
      <a href={`#/p/${p.id}`}>{p.name}</a><Icon n="caret-right"  /><b className="trunc">{b?.title || 'Block'}</b>
    </Header>
    <div className="content">
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {loading && !data && (<Loading h={400}  />)}
      {data && (<div className="bview">
        <nav className="scrub" aria-label="Frames">{frames.slice(0, 80).map((x, i) => (<button key={x?.id ?? i} aria-current={i === active} aria-label={x.title} title={x.title} onClick={() => jump(x.id)}></button>))}</nav>
        <div className="bv-main">
          {cur?.ts > 0 && (<div className="datepill" aria-live="polite">{longDate(cur.ts)}</div>)}
          <header className="bv-head">
            <a className="back" href={`#/p/${p.id}`} aria-label="Back to the canvas"><Icon n="arrow-left"  /></a>
            <span className="meta">{plural(frames.length, KINDS[frames[0]?.kind] ? 'item' : 'item')}{last ? ` · ${dayLabel(last)} ${time(last)}` : ''}{notes.length ? ` · ${plural(notes.length, 'note')}` : ''}</span>
            <h1><span className="blk-ico"><Icon n={b.icon}  /></span>{b.title}</h1>
            <p className="brief">{b.hint}</p>
          </header>
          {annotating && (<div className="annot-bar" role="status"><Icon n="pencil-simple"  /><span className="grow">Annotating: click a picture to pin a comment on that spot.</span><Button variant="tertiary" size="compact" onClick={() => setAnnotating(false)}>Done</Button></div>)}
          {(loose.length > 0 || newNote === 'top') && (<div className="stickies">
            {newNote === 'top' && (<NewSticky pid={p.id} block={block} onDone={done}  />)}
            {loose.map((n) => (<Sticky n={n} reload={reload} key={n.id}  />))}
          </div>)}
          {!frames.length && !loose.length && newNote !== 'top' && (<div className="empty"><Icon n={b.icon} cls="big"  /><h2>{b.custom ? 'An empty block' : `Nothing in ${b.title} yet`}</h2><p>{b.custom ? 'Stick your notes here: quick thoughts, research, anything.' : b.hint}</p>{canEdit && (<Button variant="tertiary" size="compact" leadingIcon={ph("note")} style={sx("margin-top:10px")} onClick={() => setNewNote('top')}>Add a sticky</Button>)}</div>)}
          <div className="bv-list">{frames.map((it, i) => {
            const stuck = notes.filter((n) => n.anchor?.item === it.id);
            return (<section className={`brow${matches.includes(it.id) ? ' found' : ''}${matches[hit] === it.id ? ' here' : ''}`} id={`it-${it.id}`} data-i={i} key={it.id}>
              <div className="bframe">
                <Frame it={it} q={q} annotating={annotating && it.kind === 'iteration'} reload={reload} onOpen={(x) => (x.image?.kind === 'video' || x.kind === 'reference' ? setLightbox({ ...x.image, title: x.title, note: x.text, file_key: x.image.file_key || x.image.image_key, kind: x.image.kind || x.refKind }) : x.href && go(x.href.slice(1)))}  />
                <div className="frame-meta">{it.who && <><Avatar name={it.who} agent={it.agent}  /><span>{it.who}</span></>}{it.ts > 0 && (<span className="muted">{dayLabel(it.ts)} {time(it.ts)}</span>)}<span className="grow"></span>
                  {it.href && (<Button variant="ghost" size="icon-compact" aria-label={`Open ${it.title}`} title="Open" render={<a href={it.href} />}><Icon n="arrow-up-right" size={15} /></Button>)}</div>
              </div>
              <aside className="bctx" aria-label={`About ${it.title}`}>
                {(it.context || []).map((c, ki) => (<Ctx key={c?.id ?? ki} c={c} q={q}  />))}
                {stuck.map((n) => (<Sticky n={n} reload={reload} small key={n.id}  />))}
                {newNote === it.id && (<NewSticky pid={p.id} block={block} anchor={{ item: it.id }} onDone={done} placeholder="A note on this…"  />)}
                {commenting === it.id && (<Comment pid={p.id} it={it} onDone={done}  />)}
                {canEdit && newNote !== it.id && commenting !== it.id && (<div className="ctx-add">
                  <Button variant="ghost" size="compact" leadingIcon={ph("note")} onClick={() => setNewNote(it.id)}>Note</Button>
                  {TARGET[it.kind] && (<Button variant="ghost" size="compact" leadingIcon={ph("chat-circle")} onClick={() => setCommenting(it.id)}>Comment</Button>)}
                </div>)}
              </aside>
            </section>);
          })}</div>
        </div>
      </div>)}
    </div>
    {lightbox && (<Lightbox item={lightbox} onClose={() => setLightbox(null)}  />)}</>;
}
