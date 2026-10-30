// The design journey: what the person gave and asked, what the AI replied and made, its reasoning for each
// change (with the references it used), and the person's review. Prompts and pictures come from the AIs' own
// memory; reasoning comes from agents that follow the Trace script (explain_changes).
import { useState, useEffect, useRef, useMemo, api, useFetch, Icon, Avatar, Dialog, ErrorBox, Loading, fileUrl, toast, fail, plural, copy, rel, Button, ph, Tip, sx } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { Tile, Sentence, Changelog, AttrCards, dayLabel, time, longDate } from './ncs.jsx';

export const when = (ts) => `${dayLabel(ts)} ${time(ts)}`;
const unfence = (t) => String(t || '').replace(/```[\w-]*\n?/g, '').trim(); // replies read as prose, not markdown source
const isVideo = (x) => x.kind === 'video' || /\.(mp4|mov|webm)$/i.test(x.title || '');

// A picture or video, opened big.
export function Lightbox({ item, onClose }) {
  return (<Dialog title={item.title || 'Reference'} size="lg" onClose={onClose}>
    {isVideo(item) && item.file_key ? (<video className="lb-media" src={fileUrl(item.file_key)} poster={fileUrl(item.thumb_key)} controls playsInline></video>)
      : (<img className="lb-media" src={fileUrl(item.file_key || item.image_key || item.thumb_key)} alt={item.title || ''}  />)}
    {item.note && (<p className="small ink2" style={sx("white-space:pre-wrap")}>{item.note}</p>)}
    {item.url && (<a className="small" href={item.url} target="_blank" rel="noopener">{item.url}</a>)}
  </Dialog>);
}

// Small pictures in a row; each opens big.
export function Pics({ items, label, size }) {
  const [open, setOpen] = useState(null);
  if (!items?.length) return null;
  return (<div className={`pics${size ? ` ${size}` : ''}`} role="list" aria-label={label}>
    {items.map((x, i) => (<button key={x?.id ?? i} role="listitem" className="pic" onClick={() => setOpen(x)} aria-label={`Open ${x.title || `picture ${i + 1}`}`} title={x.title || ''}>
      <img src={fileUrl(x.thumb_key || x.image_key)} alt="" loading="lazy" decoding="async"  />{isVideo(x) ? (<span className="play"><Icon n="play"  /></span>) : ''}</button>))}
    {open && (<Lightbox item={open} onClose={() => setOpen(null)}  />)}
  </div>);
}

// Files an AI chat in or out of its project, by hand (the AI's sorting never overrules this).
export const fileChat = (id, relevant) => api(`/memory/exchanges/${id}/relevance`, { method: 'PUT', body: { relevant } })
  .then(() => toast(relevant ? 'Back in this project' : 'Filed out of this project', relevant ? {} : { action: { label: 'Undo', fn: () => fileChat(id, true) } })).catch(fail);

// One prompt: what the person asked and gave, then how the AI replied (its first reply and its wrap-up).
export function Asked({ e }) {
  const [more, setMore] = useState(false);
  const file = (relevant) => fileChat(e.id, relevant);
  const long = e.asked.length > 240 || (e.first || '').length > 160 || e.last;
  return (<article className="step group/step">
    <div className="step-h"><Avatar name="You"  /><b>You</b><span className="muted trunc grow">asked {e.tool} · {when(e.ts)}</span>
      {e.hidden ? (<Button variant="tertiary" size="compact" onClick={() => file(true)}>Bring back</Button>) : (<Tip tip="Not about this project"><Button variant="ghost" size="icon-compact" className="step-out -my-1 -mr-1.5 opacity-0 transition-opacity duration-150 group-hover/step:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label="Not about this project" onClick={() => file(false)}><Icon n="eye-slash" size={15} /></Button></Tip>)}</div>
    {e.about && (<p className="step-about">{e.about}</p>)}
    <p className={`said${more ? '' : ' clamp4'}`}>{e.asked}</p>
    <Pics items={e.images} label="Pictures you gave"  />
    {(e.first || e.shot) && (<div className="ai-said">
      <div className="step-h"><Avatar agent  /><b>{e.tool}</b><span className="muted">{e.last ? 'replied, then wrapped up' : 'replied'}</span></div>
      {e.first && (<p className={more ? 'pre' : 'clamp2'}>{unfence(e.first)}</p>)}
      {more && e.last && (<p className="pre"><span className="muted">Wrapped up: </span>{unfence(e.last)}</p>)}
      {e.shot && (<Pics items={[{ ...e.shot, title: `Screenshot ${e.tool} took` }]} label={`What ${e.tool} saw`}  />)}
    </div>)}
    {long && (<button className="more" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Less' : 'More'}</button>)}
  </article>);
}

export function AskedList({ list, show = 2 }) {
  const [every, setEvery] = useState(false);
  if (!list?.length) return null;
  const vis = every ? list : list.slice(-show);
  return (<div className="steps">
    {list.length > show && (<button className="earlier" onClick={() => setEvery(!every)} aria-expanded={every}><Icon n={every ? 'caret-up' : 'caret-down'} swap  />{every ? 'Show the last two' : plural(list.length - show, 'earlier prompt')}</button>)}
    {vis.map((e) => (<Asked e={e} key={e.id}  />))}
  </div>);
}

// Chats the AI (or you) filed out as not about this project, to look over and bring back.
export function FiledOut({ pid, n }) {
  const [list, setList] = useState(null);
  const load = () => api(`/projects/${pid}/exchanges/hidden`).then(setList).catch(fail);
  useEffect(() => { if (list) load(); }, [n]);
  return (<section className="filed-out">
    <button className="earlier" onClick={() => (list ? setList(null) : load())} aria-expanded={!!list}><Icon n={list ? 'caret-up' : 'eye-slash'} swap  />{plural(n, 'chat')} filed out as not about this project</button>
    {list && (<div className="steps">{list.map((e) => (<Asked e={{ ...e, hidden: true }} key={e.id}  />))}</div>)}
  </section>);
}

// What an agent logged with explain_changes, and the person's review of it.
export function Reasoning({ r, canReview, onChange, focused }) {
  const [reply, setReply] = useState(null);
  const reviewed = r.status === 'resolved';
  const set = (body) => api(`/comments/${r.id}`, { method: 'PATCH', body }).then(() => { toast(body.status === 'resolved' ? 'Marked as reviewed' : 'Reopened'); onChange(); }).catch(fail);
  const send = async (e) => { e.preventDefault(); if (!reply?.trim()) return; try { await api('/comments', { method: 'POST', body: { parent_id: r.id, body: reply } }); setReply(null); toast('Sent. The agent reads it the next time it’s called.'); onChange(); } catch (er) { fail(er); } };
  return (<article className={`clog reason${reviewed ? ' done' : ''}${focused ? ' focus' : ''}`} id={`c-${r.id}`}>
    <div className="clog-h"><Avatar agent  /><b className="trunc">{r.agent}</b><span className="tools"><span className={`chip${reviewed ? ' ok' : ''}`}>{reviewed ? <><Icon n="check"  />Reviewed</> : 'Needs your review'}</span></span></div>
    <div className="why"><span className="lbl">You asked</span><p className="quote">{r.asked}</p></div>
    {r.understood && (<div className="why"><span className="lbl">It understood</span><p>{r.understood}</p></div>)}
    <div className="why"><span className="lbl">Why each change</span>
      <ol className="whys">{(r.changes || []).map((c, ki) => (<li key={c?.id ?? ki}><b>{c.what}</b><span>{c.why}</span>{c.files?.length ? (<span className="files mono trunc" title={c.files.join('\n')}>{c.files.map((f) => f.split(/[\\/]/).pop()).join(', ')}</span>) : ''}</li>))}</ol></div>
    {r.refs?.length > 0 && (<div className="why"><span className="lbl">References it used</span><Pics items={r.refs} label="References the AI used"  /></div>)}
    <div className="why"><span className="lbl">Its own review</span><p>{r.review}</p></div>
    {r.replies?.length > 0 && (<div className="replies">{r.replies.map((x, ki) => (<div key={x?.id ?? ki} className="cmt"><Avatar name={x.author_name}  /><div className="col" style={sx("gap:0")}><span className="tiny"><b style={sx("font-weight:600")}>{x.author_name}</b> <span className="muted">{rel(x.created_at)}</span></span><span className="body">{x.body}</span></div></div>))}</div>)}
    {canReview && (reply !== null
      ? (<form className="col" onSubmit={send}><Textarea rows="2" value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply to the agent" placeholder="What should change? The agent reads this next time." autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); if (e.key === 'Escape') setReply(null); }}></Textarea><div className="row"><Button variant="primary" size="compact">Send</Button><Button variant="ghost" size="compact" type="button" onClick={() => setReply(null)}>Cancel</Button></div></form>)
      : (<div className="row" style={sx("gap:6px")}>{reviewed ? (<Button variant="ghost" size="compact" onClick={() => set({ status: 'open' })}>Reopen</Button>) : (<Button variant="primary" size="compact" leadingIcon={ph("check")} onClick={() => set({ status: 'resolved' })}>Looks right</Button>)}<Button variant="tertiary" size="compact" onClick={() => setReply('')}>Reply</Button></div>))}
  </article>);
}

// A one-line pointer to the reasoning, for the journey's column.
const ReasonLine = ({ r, href }) => (<a className="reason-line" href={href}><Avatar agent  /><span className="grow trunc"><b>{r.agent}</b> explained {plural(r.changes?.length || 0, 'change')}{r.understood ? (<span className="muted"> · {r.understood}</span>) : ''}</span><span className={`chip${r.status === 'resolved' ? ' ok' : ''}`}>{r.status === 'resolved' ? 'Reviewed' : 'Needs your review'}</span></a>);

export const ScriptHint = ({ pid }) => (<article className="clog hint">
  <h3>No reasoning logged for this change</h3>
  <p className="small muted">Agents that follow the Trace script explain each change here: what you asked, what they understood, why they did each thing, and their own review of it.</p>
  <Button variant="tertiary" size="compact" leadingIcon={ph("scroll")} render={<a href={`#/p/${pid}/memory`} />}>Set up the script</Button>
</article>);

// The script agents follow, and adding it to the project's own instruction files.
export function AgentScript({ p }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/agent-script`);
  const [busy, setBusy] = useState(null);
  const add = async (f) => {
    setBusy(f.id);
    try { const r = await api(`/projects/${p.id}/agent-script`, { method: 'POST', body: { file: f.id } }); toast(`${f.added.length ? 'Updated' : 'Added to'} ${plural(r.written.length, 'file')}: ${r.written.map((x) => x.split(/[\\/]/).slice(-2).join('/')).join(', ')}`); reload(); } catch (e) { fail(e); }
    setBusy(null);
  };
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  return (<section className="col" id="script" style={sx("gap:10px")}>
    <h2>The script your AIs follow</h2>
    <p className="small ink2" style={sx("max-width:68ch")}>Agents connected to Trace get this before they work. It asks them to explain every set of changes: what you asked, what they understood, why each change, the references you gave them, and their own review. It shows up on each change for you to review. Add it to {p.name}’s own instruction file too, so it’s there in every session.</p>
    {!data ? (<Loading h={160}  />) : <><pre className="code script">{data.text}</pre>
      <div className="row wrap" style={sx("gap:6px")}>
        {data.files.map((f, ki) => (<Button key={f?.id ?? ki} variant="tertiary" size="compact" onClick={() => add(f)} aria-disabled={!data.dirs.length || busy === f.id}>{f.added.length ? <><Icon n="check" />Update {f.file.split(/[\\/]/).pop()}</> : `Add to ${f.file.split(/[\\/]/).pop()}`}</Button>))}
        <Button variant="ghost" size="compact" leadingIcon={ph("copy")} onClick={() => copy(data.text, 'Script copied')}>Copy</Button>
      </div>
      <p className="tiny muted">{data.dirs.length ? `Writes into ${data.dirs.join(', ')}. Trace only ever replaces its own marked block.` : `Add the folder ${p.name} lives in first (project settings → Folders).`}</p></>}
  </section>);
}

// ---------- annotate (NCS's timeline pencil): numbered pins with comments, right on the work ----------
// Pins are placed on the picture as drawn (contained in its box), so they land on the same spot at any size.
export function AnnotTile({ m, img, pins, annotating, onPinned }) {
  const box = useRef();
  const [rect, setRect] = useState(null); // where the picture is drawn inside its box
  const [draft, setDraft] = useState(null);
  const [text, setText] = useState('');
  const measure = () => {
    const el = box.current?.querySelector('img');
    if (!el?.naturalWidth) return;
    const b = box.current.getBoundingClientRect(), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const pl = parseFloat(cs.paddingLeft), pt = parseFloat(cs.paddingTop), cw = r.width - pl * 2, ch = r.height - pt * 2;
    const k = Math.min(cw / el.naturalWidth, ch / el.naturalHeight), w = el.naturalWidth * k, h = el.naturalHeight * k;
    setRect({ left: r.left - b.left + pl + (cw - w) / 2, top: r.top - b.top + pt + (ch - h) / 2, width: w, height: h });
  };
  useEffect(() => { measure(); const ro = new ResizeObserver(measure); if (box.current) ro.observe(box.current); return () => ro.disconnect(); }, [img?.image_key || img?.thumb_key]);
  const key = img?.image_key || img?.thumb_key;
  const mine = pins.filter((p) => !p.region?.snap || p.region.snap === img?.id);
  const place = (e) => {
    if (!annotating || !rect || e.target.closest('.apin, .acompose')) return;
    e.preventDefault();
    const b = box.current.getBoundingClientRect();
    const x = (e.clientX - b.left - rect.left) / rect.width, y = (e.clientY - b.top - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setDraft({ x, y }); setText('');
  };
  const save = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try { await api('/comments', { method: 'POST', body: { target_type: 'moment', target_id: m.id, body: text, region: { x: Math.max(0, draft.x - 0.03), y: Math.max(0, draft.y - 0.02), w: 0.06, h: 0.04, snap: img?.id } } }); setDraft(null); toast('Pinned'); onPinned(); } catch (er) { fail(er); }
  };
  const at = (r) => rect && { left: `${rect.left + (r.x + r.w / 2) * rect.width}px`, top: `${rect.top + (r.y + r.h / 2) * rect.height}px` };
  const inner = <>{key ? (<img src={fileUrl(img.image_key || img.thumb_key)} alt={m.title} loading="lazy" decoding="async" onLoad={measure} draggable="false"  />) : (<div style={sx("position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-3)")}><Icon n="image"  /></div>)}
    {mine.map((p, n) => rect && (<a key={p?.id ?? n} className="apin" style={sx(at(p.region))} href={`#/m/${m.id}/${p.id}`} title={`${p.author_name}: ${p.body}`} aria-label={`Pin ${n + 1}: ${p.body}`}>{n + 1}</a>))}
    {draft && rect && <><span className="apin draft" style={sx(at({ x: draft.x, y: draft.y, w: 0, h: 0 }))}>{mine.length + 1}</span>
      <form className="acompose" style={sx({ left: `${Math.min(rect.left + draft.x * rect.width, (box.current?.clientWidth || 600) - 280)}px`, top: `${rect.top + draft.y * rect.height + 16}px` })} onSubmit={save}>
        <Textarea rows="2" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What about this spot?" aria-label="Comment for this pin" onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(e); }}></Textarea>
        <div className="row"><Button variant="primary" size="compact">Pin</Button><Button variant="ghost" size="compact" type="button" onClick={() => setDraft(null)}>Cancel</Button></div>
      </form></>}
    {!annotating && (<span className="cap">{m.title}</span>)}</>;
  return annotating
    ? (<div ref={box} className="fimg span3 annotating" onClick={place} role="application" aria-label={`${m.title}: click to pin a comment`}>{inner}</div>)
    : (<a ref={box} className="fimg span3" href={`#/m/${m.id}`} aria-label={m.title}>{inner}</a>);
}

// ---------- the project's journey: iterations newest first, each told as a story ----------
function Iteration({ it, i, pid, annotating, reload }) {
  const m = it.moment;
  const shot = [...it.asked].reverse().find((a) => a.shot)?.shot;
  return (<section className="iter" data-i={i} aria-label={m.title}>
    <AskedList list={it.asked}  />
    {it.reasoning.map((r, ki) => (<ReasonLine key={r?.id ?? ki} r={r} href={`#/m/${m.id}/${r.id}`}  />))}
    <AnnotTile m={m} img={m.image || shot} pins={it.pins || []} annotating={annotating} onPinned={reload}  />
    <div className="line"><Sentence seg={m.sentence} text={m.summary}  /><span className="when">{m.agent || m.actor_name} · {when(m.end_ts)}{m.comments ? <>· <Icon n="chat-circle"  /> {m.comments}</> : ''}</span></div>
    {it.refs.length > 0 && (<div className="row" style={sx("gap:8px")}><span className="tiny muted">References</span><Pics items={it.refs} label="References pinned to this change" size="sm"  /></div>)}
  </section>);
}

export function Journey({ p }) {
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/journey`, ['moment', 'comment', 'memory', 'reference'], (t, d) => t === 'memory' || !d.project_id || d.project_id === p.id);
  const [older, setOlder] = useState([]);
  const [more, setMore] = useState(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [annotating, setAnnotating] = useState(false);
  useEffect(() => { // the pencil next to + (and Esc) toggles annotate mode
    const t = () => setAnnotating((v) => !v), esc = (e) => e.key === 'Escape' && !e.target.closest('textarea') && setAnnotating(false);
    addEventListener('trace:annotate', t); addEventListener('keydown', esc);
    return () => { removeEventListener('trace:annotate', t); removeEventListener('keydown', esc); };
  }, []);
  useEffect(() => { document.body.dataset.annotating = annotating ? '1' : ''; return () => { document.body.dataset.annotating = ''; }; }, [annotating]);
  useEffect(() => { setOlder([]); setMore(null); }, [data]);
  const its = [...(data?.iterations || []), ...older];
  const canMore = more ?? data?.more;
  const loadMore = async () => {
    if (busy || !canMore) return;
    setBusy(true);
    try { const r = await api(`/projects/${p.id}/journey?before=${its.at(-1).moment.end_ts}`); setOlder([...older, ...r.iterations]); setMore(r.more); } catch (e) { fail(e); }
    setBusy(false);
  };
  useEffect(() => { // which iteration is in view drives the scrubber, the date and the changes beside it
    const els = [...document.querySelectorAll('.iter[data-i]')];
    if (!els.length) return;
    const io = new IntersectionObserver((es) => { const vis = es.filter((e) => e.isIntersecting).map((e) => +e.target.dataset.i); if (vis.length) setActive(Math.min(...vis)); }, { rootMargin: '-120px 0px -55% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [its.length]);
  const jump = (i) => document.querySelector(`.iter[data-i="${i}"]`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const cur = its[Math.min(active, its.length - 1)];
  const rows = (cur?.moment.rows || []).map((c) => ({ ...c, node: c.path.split(' › ')[0].replace(/\s*\([A-Z]+\)$/, '') }));
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  return (<div className="tl-wrap jr">
    <nav className="scrub" aria-label="Iterations">{its.slice(0, 60).map((it, i) => (<button key={it?.id ?? i} aria-current={i === active} aria-label={`${it.moment.title}, ${longDate(it.moment.end_ts)}`} title={`${it.moment.title} · ${longDate(it.moment.end_ts)}`} onClick={() => jump(i)}></button>))}</nav>
    <div className="col" style={sx("gap:0;min-width:0")}>
      {cur && (<div className="datepill" aria-live="polite">{longDate(cur.moment.end_ts)}</div>)}
      {loading && !data && (<div className="tl"><Loading h={160}  /><Loading h={420}  /></div>)}
      {data?.now && (data.now.asked.length > 0 || data.now.reasoning.length > 0) && (<section className="iter now" aria-label="In progress">
        <span className="caps">In progress · asked, nothing captured yet</span>
        <AskedList list={data.now.asked}  />
        {data.now.reasoning.map((r, ki) => (<Reasoning key={r?.id ?? ki} r={r} canReview={p.can_review} onChange={reload}  />))}
      </section>)}
      {data && !its.length && !data.now?.asked.length && (<div className="empty"><Icon n="path" cls="big"  /><h2>The journey starts with your first change</h2><p>Drop files, connect a tool, or add the folder {p.name} lives in (project settings) so your prompts to Claude Code, Codex and the rest show up here beside what they made.</p></div>)}
      {annotating && (<div className="annot-bar" role="status"><Icon n="pencil-simple"  /><span className="grow">Annotating: click a picture to pin a comment on that spot.</span><Button variant="tertiary" size="compact" onClick={() => setAnnotating(false)}>Done</Button></div>)}
      <div className="tl">{its.map((it, i) => (<Iteration it={it} i={i} pid={p.id} key={it.moment.id} annotating={annotating && p.can_review !== false} reload={reload}  />))}</div>
      {data?.hidden > 0 && (<FiledOut pid={p.id} n={data.hidden}  />)}
      {canMore && (<div className="row" style={sx("justify-content:center;padding:24px")}><Button variant="tertiary" size="default" onClick={loadMore} aria-disabled={busy}>{busy ? 'Loading…' : 'Earlier iterations'}</Button></div>)}
    </div>
    <aside className="jr-side" aria-label="Changes in view">{cur && <><Changelog m={{ ...cur.moment, rows: [] }} href={`#/m/${cur.moment.id}`}  /><AttrCards changes={rows}  /></>}</aside>
  </div>);
}
