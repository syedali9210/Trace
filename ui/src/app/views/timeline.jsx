// A project, opened, the NCS way: the back arrow and the tick scrubber on the left, every iteration down the
// middle as it looks (newest first, the date floating at the top), and beside it the iteration in view: what
// changed (the sentence, before → after values), why, the notes marked on it, and what you gave your AI for it.
// The pencil turns on annotate (NCS's bar): draw, erase, comment, mark, close, and search.
import { useState, useEffect, useRef, api, useFetch, useAi, Icon, Avatar, Menu, ErrorBox, Loading, fileUrl, toast, fail, copy, go, plural, rel, Button, Tip, sx, Fragment } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { Sentence, AttrCards, dayLabel, time, longDate } from './ncs.jsx';
import { Pics, FiledOut, fileChat } from './journey.jsx';
import { AskButton } from './ask.jsx';

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
  return (<section className={`tlf${tool ? ` tool-${tool}` : ''}`} data-i={i} id={`it-${m.id}`} aria-label={m.title}>
    <div className="tlf-box" ref={box} style={sx({ aspectRatio: String(ratio) })} onPointerDown={down} onPointerMove={move} onPointerUp={up} onDoubleClick={() => !tool && go(`/m/${m.id}`)}>
      {img ? (<img src={fileUrl(img.image_key || img.thumb_key)} alt={m.title} loading={i > 2 ? 'lazy' : 'eager'} decoding="async" draggable="false" onLoad={measure}  />) : (<div className="tlf-none"><Icon n="file"  /><span className="small">{m.title}</span></div>)}
      {rect && (<svg className="anno-ink" style={sx({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden={tool !== 'erase'}>
        {strokes.map((s, ki) => (<path key={s?.id ?? ki} className={`ink c-${s.color || 'red'}`} d={`M${s.meta.points.map((q) => q.join(' ')).join(' L')}`} onClick={() => tool === 'erase' && erase(s)}  />))}
        {line && (<path className="ink c-red live" d={`M${line.map((q) => q.join(' ')).join(' L')}`}  />)}
      </svg>)}
      {rect && markers.map((n, k) => (<button key={n?.id ?? k} className="amark" style={sx(pos(n.anchor.x, n.anchor.y))} aria-label={`Mark ${k + 1}${n.text ? `: ${n.text}` : ''}`} title={n.text || `Mark ${k + 1}`} onClick={(e) => { e.stopPropagation(); if (tool === 'erase') erase(n); else onFocus(n.id); }}>{k + 1}</button>))}
      {rect && pins.map((c, ki) => <Fragment key={c?.id ?? ki}><button className="apin bubble" style={sx(pos(c.region.x + c.region.w / 2, c.region.y + c.region.h / 2))} aria-label={`Comment by ${c.author_name}: ${c.body}`} onClick={(e) => { e.stopPropagation(); setPeek(peek === c.id ? null : c.id); }}><Icon n="chat-circle"  /></button>
        {peek === c.id && (<div className="anno-pop" style={sx(pos(c.region.x + c.region.w / 2, c.region.y + c.region.h))}><b>{c.author_name}</b><p>{c.body}</p><a className="small" href={`#/m/${m.id}/${c.id}`}>Open the thread</a></div>)}</Fragment>)}
      {draft && rect && <><span className={draft.kind === 'mark' ? 'amark draft' : 'apin bubble draft'} style={sx(pos(draft.x, draft.y))}>{draft.kind === 'mark' ? markers.length + 1 : (<Icon n="chat-circle"  />)}</span>
        <form className="acompose" style={sx({ left: `${Math.min(rect.left + draft.x * rect.width, (box.current?.clientWidth || 600) - 270)}px`, top: `${rect.top + draft.y * rect.height + 18}px` })} onSubmit={submit} onPointerDown={(e) => e.stopPropagation()}>
          <Textarea rows="2" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={draft.kind === 'mark' ? 'What’s here? (optional)' : 'What about this spot?'} aria-label={draft.kind === 'mark' ? 'Label for the mark' : 'Comment'} onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); }}></Textarea>
          <div className="row"><Button variant="primary" size="compact">{draft.kind === 'mark' ? 'Mark' : 'Comment'}</Button><Button variant="ghost" size="compact" type="button" onClick={() => setDraft(null)}>Cancel</Button></div>
        </form></>}
      {!tool && (<a className="tlf-cap" href={`#/m/${m.id}`}>{m.title}<span>{dayLabel(m.end_ts)} {time(m.end_ts)}</span></a>)}
    </div>
  </section>);
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
  return (<div className="ctxs" key={m.id}>
    <article className="clog">
      <div className="clog-h"><h3 className="grow">Changes</h3><span className="tools">
        <Button variant="ghost" size="icon-compact" aria-label="Write the changes again" title="Write again" onClick={again}><Icon n="arrows-clockwise" size={15} /></Button>
        <Menu label="Change actions" btn="ibtn" items={[{ label: 'Open the change', icon: 'arrow-up-right', onClick: () => go(`/m/${m.id}`) }, { label: 'Copy a link', icon: 'link', onClick: () => copy(`${location.origin}/#/m/${m.id}`, 'Link copied') }]}  /></span></div>
      <Sentence seg={m.sentence} text={m.summary}  />
      <span className="who"><Avatar name={m.agent || m.actor_name} agent={!!m.agent}  />{m.agent || m.actor_name} · {dayLabel(m.end_ts)} {time(m.end_ts)}</span>
    </article>
    <AttrCards changes={rows}  />
    {(r || m.why) && (<article className="clog why">
      <h3>{r ? 'Why' : 'Note'}</h3>
      {r ? <><p><b>{r.understood || r.asked}</b> {(r.changes || []).map((c) => c.why).join(' ')}</p><a className="tiny" href={`#/m/${m.id}/${r.id}`}>{r.agent}{r.status === 'resolved' ? ' · reviewed' : ' · needs your review'}</a></>
        : (<p><b>{why[0]}</b> {why.slice(1).join(' ')}</p>)}
    </article>)}
    {markers.length > 0 && (<article className="clog"><h3>Marked</h3><ol className="marks">{markers.map((n, k) => (<li key={n?.id ?? k} className={n.id === focusMark ? 'on' : ''}><span className="amark sm">{k + 1}</span><span className="grow">{n.text || (<span className="muted">No label</span>)}</span><span className="tiny muted">{n.author_name}</span></li>))}</ol></article>)}
    {asked && (<article className="clog asked">
      <div className="clog-h"><h3 className="grow">You asked {asked.tool}</h3>{p.can_edit && (<Tip tip="Not about this project"><Button variant="ghost" size="icon-compact" aria-label="Not about this project" onClick={() => fileChat(asked.id, false)}><Icon n="eye-slash" size={15} /></Button></Tip>)}</div>
      {asked.about && (<p className="asked-about">{asked.about}</p>)}
      <p className="clamp4">{asked.asked}</p>
      <Pics items={asked.images} label="Pictures you gave" size="sm"  />
      {it.asked.length > 1 && (<a className="tiny" href={`#/m/${m.id}`}>{plural(it.asked.length - 1, 'earlier prompt')}</a>)}
    </article>)}
    {it.refs.length > 0 && (<article className="clog"><h3>References</h3><Pics items={it.refs} label="References pinned to this change" size="sm"  /></article>)}
  </div>);
}

// Where the project stands, kept current by Trace's AI from the work, the project's folders and its AIs' sessions.
const FROM = { changes: 'change', comments: 'comment', notes: 'note', tasks: 'task', decisions: 'decision', sessions: 'AI session', files: 'file' };
function Digest({ p }) {
  const ai = { data: useAi() };
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const d = p.digest;
  const sync = () => { if (busy) return; setBusy(true); api(`/projects/${p.id}/ai/sync`, { method: 'POST' }).then((r) => toast(r.sorted?.out ? `In sync. Filed out ${plural(r.sorted.out, 'chat')} not about ${p.name}.` : 'In sync with the work, the folders and your AIs')).catch(fail).finally(() => setBusy(false)); };
  if (!d) return ai.data?.ready && p.can_edit ? (<button className="digest-cta" onClick={sync} aria-disabled={busy}><Icon n="compass"  />{busy ? 'Reading the work, the folders and your AIs’ sessions…' : 'Sum up where this stands'}</button>) : null;
  const from = Object.entries(d.from || {}).filter(([k, n]) => n && FROM[k]).map(([k, n]) => plural(n, FROM[k])).join(', ');
  const list = (title, xs) => xs?.length > 0 && (<div><h4>{title}</h4><ul>{xs.map((x, ki) => (<li key={x?.id ?? ki}>{x}</li>))}</ul></div>);
  return (<section className="digest" aria-label="Where it stands">
    <div className="digest-h"><Icon n="compass"  /><b>Where it stands</b><span className="tiny muted" title={from ? `Synced from ${from}` : ''}>{rel(d.at)}</span><span className="grow"></span>
      {p.can_edit && (<Button variant="ghost" size="icon-compact" aria-label="Sync now" title="Sync with the work, the folders and your AIs" onClick={sync}><Icon n="arrows-clockwise" cls={busy ? 'spin' : ''} /></Button>)}</div>
    <p>{d.now}</p>
    {more ? (<div className="digest-more">{list('What changed', d.changed)}{list('Open', d.open)}{list('Next', d.next)}{from && (<p className="tiny muted">Synced from {from} · {d.model?.split('/').pop()}</p>)}</div>)
      : (d.changed?.length || d.open?.length || d.next?.length) > 0 && (<button className="digest-toggle" onClick={() => setMore(true)}>What changed, what’s open, what’s next</button>)}
  </section>);
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
  return (<div className="ptl">
    <aside className="ptl-left">
      <a className="back" href="#/" aria-label="Back to Home" title="Home"><Icon n="arrow-left"  /></a>
      <nav className="scrub" aria-label="Iterations">{its.slice(0, 80).map((it, i) => (<button key={it?.id ?? i} aria-current={i === active} aria-label={`${it.moment.title}, ${longDate(it.moment.end_ts)}`} title={`${it.moment.title} · ${longDate(it.moment.end_ts)}`} onClick={() => jump(i)}></button>))}</nav>
    </aside>
    <main className="ptl-mid">
      <div className="datepill" aria-live="polite">{cur ? longDate(cur.moment.end_ts) : ' '}</div>
      <header className="ptl-head">
        <span className="meta">{plural(data?.total ?? p.counts.timeline, 'Iteration')}{p.latest ? ` · ${time(p.latest.end_ts)}` : ''}</span>
        <h1>{p.name}</h1>
        {desc ? (<p>{desc}</p>) : p.can_edit && (<p className="muted">No description yet. Add one in the project’s settings (⋯).</p>)}
      </header>
      <Digest p={p}  />
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {loading && !data && (<div className="col" style={sx("gap:16px")}><Loading h={300}  /><Loading h={300}  /></div>)}
      {data && !its.length && (<div className="empty"><Icon n="files" cls="big"  /><h2>Drop files here</h2><p>Every iteration of {p.name} lands here, newest first.</p></div>)}
      <div className="tlfs">{its.map((it, i) => (<Frame p={p} it={it} i={i} tool={tool} reload={reload} onFocus={setFocusMark} key={it.moment.id}  />))}</div>
      {data?.hidden > 0 && !canMore && (<FiledOut pid={p.id} n={data.hidden}  />)}
      {canMore && (<div ref={sentinel} className="row" style={sx("justify-content:center;padding:24px")}><Button variant="tertiary" size="compact" onClick={loadMore}>Earlier iterations</Button></div>)}
    </main>
    <aside className="ptl-right">
      <div className="ptl-switch">{switcher}</div>
      {cur && (<Context p={p} it={cur} reload={reload} focusMark={focusMark}  />)}
    </aside>
    {(p.can_edit || p.can_review) && (<div className="fab-bar" role="toolbar" aria-label={tool ? 'Annotate' : 'Project actions'}>
      {tool ? (<div className="anno-bar">{TOOLS.map(([id, icon, label], ki) => (<Tip key={ki} tip={label}><Button variant="ghost" size="icon" active={tool === id} aria-pressed={tool === id} aria-label={label} onClick={() => setTool(id)}><Icon n={icon} size={17} /></Button></Tip>))}<Tip tip="Done" kbd="Esc"><Button variant="ghost" size="icon" aria-label="Stop annotating" onClick={() => setTool(null)}><Icon n="x" size={17} /></Button></Tip></div>)
        : <><button className="fab" onClick={() => dispatchEvent(new Event('trace:upload'))} aria-label={`Upload to ${p.name}`} data-tip={`Upload to ${p.name}`}><Icon n="plus"  /></button><AskButton  /></>}
      <div className="fab-2">{!tool && (<Tip tip="Annotate"><Button variant="ghost" size="icon" aria-label="Annotate the work" onClick={() => setTool('comment')}><Icon n="pencil-simple" size={17} /></Button></Tip>)}<Tip tip="Search" kbd="Ctrl K"><Button variant="ghost" size="icon" aria-label="Search" onClick={() => dispatchEvent(new Event('trace:search'))}><Icon n="magnifying-glass" size={17} /></Button></Tip></div>
    </div>)}
  </div>);
}
