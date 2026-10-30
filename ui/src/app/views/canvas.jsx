// A project as a canvas of blocks: overview, iterations, reviews, brainstorming, constraints, references, tasks,
// decisions, case study, artifacts, and blocks you make. Click to select, again for a peek (jot a sticky there),
// double-click to open. Drag from a block's dots to another to link them: Trace reads both and says what one
// means for the other. Replay rewinds the canvas so you can watch the project fill in.
import { useState, useEffect, useRef, api, useFetch, useAi, Icon, Avatar, ErrorBox, Loading, fileUrl, toast, fail, go, plural, Button, ph, Chip, sx } from '../lib.jsx';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Bento } from './bento.jsx';
import { longDate } from './ncs.jsx';

const KIND = { conflict: { label: 'Conflict', icon: 'warning-circle' }, gap: { label: 'Gap', icon: 'circle-dashed' }, note: { label: 'Note', icon: 'note' }, match: { label: 'Connection', icon: 'link-simple' }, support: { label: 'Holds', icon: 'check-circle' } };
const worst = (kinds = []) => ['conflict', 'gap', 'note', 'match', 'support'].find((k) => kinds.includes(k)) || 'match';

function Ring({ value, size = 44 }) { // case-study readiness
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  return (<svg className="cs-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value}% answered`}>
    <circle cx={size / 2} cy={size / 2} r={r} className="track"  /><circle cx={size / 2} cy={size / 2} r={r} className="fill" style={sx({ strokeDasharray: `${(c * value) / 100} ${c}` })}  />
    <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle">{value}</text></svg>);
}

function BlockCard({ b, at }) {
  const s = b.summary;
  const n = s.count == null ? null : at ? s.ts.filter((t) => t <= at).length + (s.count - s.ts.length) : s.count;
  const pics = s.images.slice(0, b.size === '2x2' || b.size === '2x1' ? 4 : 2);
  const foot = s.stat || (s.count ? plural(s.count, b.id === 'work' ? 'iteration' : 'item') : s.stickies ? plural(s.stickies, 'note') : s.count === 0 ? 'Empty so far' : b.hint);
  if (b.id === 'overview') return <><div className="blk-h"><span className="blk-ico"><Icon n={b.icon}  /></span><span className="blk-t trunc">{b.title}</span></div>
    <div className="ov">{pics[0] && (<div className="ov-shot"><img src={fileUrl(pics[0].image_key || pics[0].thumb_key)} alt="" draggable="false"  /></div>)}
      <ul className="blk-lines">{s.lines.map((l, ki) => (<li key={l?.id ?? ki} className="clamp2">{l}</li>))}</ul></div>
    <div className="blk-f"><span className="trunc">{b.hint}</span></div></>;
  return <><div className="blk-h"><span className="blk-ico"><Icon n={b.icon}  /></span><span className="blk-t trunc">{b.title}</span>{n != null && n > 0 && (<span className="blk-n">{n}</span>)}</div>
    <div className={`blk-body${pics.length && b.id !== 'casestudy' ? ' has-pics' : ''}`}>
      {b.id === 'casestudy' && s.readiness != null ? (<div className="blk-ring"><Ring value={s.readiness} size={b.size === '1x1' ? 46 : 64}  /><span className="small ink2">{s.stat}</span></div>)
      : pics.length ? (<div className={`collage n${pics.length}`}>{pics.map((im, ki) => (<span key={im?.id ?? ki}><img src={fileUrl(im.thumb_key || im.image_key)} alt="" loading="lazy" draggable="false"  /></span>))}</div>)
      : s.lines.length ? (<ul className="blk-lines">{s.lines.map((l, ki) => (<li key={l?.id ?? ki} className="clamp2">{l}</li>))}</ul>)
      : (<p className="blk-empty">{b.hint}</p>)}
    </div>
    <div className="blk-f"><span className="trunc">{foot}</span>{s.stickies > 0 && (<span className="blk-sticky" title={plural(s.stickies, 'sticky note')}><Icon n="note"  />{s.stickies}</span>)}</div></>;
}

// A peek at a block: its first things, and a sticky you can jot right there.
function Peek({ p, b, close, reload }) {
  const [text, setText] = useState('');
  const add = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api(`/projects/${p.id}/notes`, { method: 'POST', body: { block: b.id, text } }); setText(''); toast('Stuck to the block'); reload(); } catch (er) { fail(er); } };
  return (<article className="clog peek">
    <div className="clog-h"><span className="blk-ico"><Icon n={b.icon}  /></span><b className="trunc">{b.title}</b><span className="tools"><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={close}><Icon n="x" size={15} /></Button></span></div>
    <p className="small muted">{b.hint}</p>
    {b.summary.lines.length > 0 && (<ul className="blk-lines">{b.summary.lines.map((l, ki) => (<li key={l?.id ?? ki}>{l}</li>))}</ul>)}
    <form className="jot" onSubmit={add}><Input className="sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Jot a thought on this block…" aria-label={`A sticky note on ${b.title}`} /><Button variant="tertiary" size="compact" leadingIcon={ph("note")} aria-label="Add the sticky"></Button></form>
    <Button variant="primary" size="compact" render={<a href={`#/p/${p.id}/b/${b.id}`} />}>Open {b.title}<Icon n="arrow-right" /></Button>
  </article>);
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
  return (<aside className="drawer" role="dialog" aria-label={`What ${name(link.from)} and ${name(link.to)} say about each other`}>
    <div className="drawer-h"><span className="pair"><b>{name(link.from)}</b><Icon n="arrows-left-right"  /><b>{name(link.to)}</b></span><Button variant="ghost" size="icon-compact" aria-label="Close" onClick={onClose}><Icon n="x" size={15} /></Button></div>
    <div className="row"><p className="small muted grow">Trace read both blocks. Here’s what one says about the other.</p>{ai?.ready && p.can_edit && (<Button variant="tertiary" size="compact" leadingIcon={ph("lightbulb")} onClick={() => !reading && askAi()} aria-disabled={reading}>{reading ? 'Reading…' : 'Ask AI'}</Button>)}</div>
    {error && (<ErrorBox error={error} retry={again}  />)}
    {!data ? (<Loading h={160}  />) : !data.insights.length ? (<p className="small ink2">Nothing connects them yet. Add a few items to either block, or write what you see below.</p>)
    : (<ol className="ins">{data.insights.map((i, ki) => (<li key={i?.id ?? ki} className={`ins-${i.kind}`}>
        <span className="ins-k"><Icon n={KIND[i.kind].icon}  />{KIND[i.kind].label}{i.by ? <>· {i.by}</> : ''}</span>
        <p>{i.text}</p>
        {i.evidence?.length > 0 && (<div className="row wrap" style={sx("gap:4px")}>{i.evidence.map((e) => (e.href ? (<a className="chip" href={e.href}>{e.title}</a>) : (<a className="chip" href={`#/p/${p.id}/b/${e.block}`}>{e.title}</a>)))}</div>)}
        {i.action?.type === 'task' && (<Button variant="tertiary" size="compact" leadingIcon={ph("plus")} onClick={() => task(i.action.title)}>Make it a task</Button>)}
        {i.action?.type === 'casestudy' && (<Button variant="tertiary" size="compact" render={<a href={`#/p/${p.id}/casestudy/${i.action.section}`} />}>Answer it</Button>)}
      </li>))}</ol>)}
    <form className="col" onSubmit={write}><Textarea rows="2" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write what you see between them…" aria-label="Your insight"></Textarea><div className="row"><Button variant="primary" size="compact">Add insight</Button><span className="grow"></span><Button variant="ghost" size="compact" className="text-destructive" type="button" onClick={unlink}>Unlink</Button></div></form>
    <p className="tiny muted">Agents connected to Trace can add theirs with add_insight. Trace’s AI keeps an insight only if the items it cites are in these blocks.</p>
  </aside>);
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
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (loading && !data) return (<div className="bento canvas">{[1, 2, 3, 4, 5, 6].map((_, ki) => (<div key={ki} className="skeleton" style={sx("height:150px")}></div>))}</div>);
  const blocks = data.blocks.map((b) => ({ ...b, cls: `k-${b.custom ? 'custom' : b.id}`, label: b.title }));
  const links = data.links.map((l) => ({ ...l, cls: `lk-${worst(l.kinds)}` }));
  const name = (id) => blocks.find((b) => b.id === id)?.title;
  return (<div className="col canvas-wrap" style={sx("gap:12px")}>
    <div className="row wrap canvas-bar">
      <span className="board-hint" style={sx("margin:0")}>Click to select · double-click to open · drag from dots to link two blocks</span>
      <span className="grow"></span>
      {links.length > 0 && (<Chip tone="ok">{plural(links.length, 'link')} · {links.reduce((n, l) => n + l.count, 0)} insights</Chip>)}
      {ai?.ready && p.can_edit && naming == null && (<Button variant="tertiary" size="compact" leadingIcon={ph("lightbulb")} onClick={() => !reading && findAi()} aria-disabled={reading} title="Trace’s AI reads every block and links the ones that say something about each other">{reading ? 'Reading the blocks…' : 'Find insights with AI'}</Button>)}
      {naming != null ? (<form className="row" onSubmit={addBlock}><Input className="sm" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name the block, e.g. Research" aria-label="New block name" onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} /><Button variant="primary" size="compact">Add</Button></form>)
        : p.can_edit && (<Button variant="tertiary" size="compact" leadingIcon={ph("plus")} onClick={() => setNaming('')}>Block</Button>)}
    </div>
    <Bento cls="canvas" items={blocks} links={links} onSave={save}
      onLink={p.can_edit ? (from, to) => save({ link: { from, to } }).then(() => { reload(); setLink({ from, to }); }) : null}
      onKnot={setLink} knot={(l) => l.count} linkLabel={(l) => `${name(l.from)} and ${name(l.to)}: ${plural(l.count, 'insight')}`}
      onOpen={(b) => go(`/p/${p.id}/b/${b.id}`)}
      dimmed={(b) => at && b.summary.count != null && b.summary.ts.length && !b.summary.ts.some((t) => t <= at)}
      renderCard={(b) => (<BlockCard b={b} at={at}  />)}
      renderPanel={(b, close) => (<Peek p={p} b={b} close={close} reload={reload}  />)}
      toolbar={(b) => <><button onClick={() => go(`/p/${p.id}/b/${b.id}`)} title="Open" aria-label={`Open ${b.title}`}><Icon n="arrow-up-right"  /></button>
        {b.custom && p.can_edit && (<button className="danger" onClick={() => save({ remove_block: b.id }).then(() => { reload(); toast('Block removed'); })} title="Remove the block" aria-label="Remove the block"><Icon n="trash"  /></button>)}</>}  />
    {range && (<div className="replay" role="group" aria-label="Replay the project">
      <Button variant="ghost" size="icon-compact" aria-label={playing ? 'Pause' : 'Replay how the project filled in'} title={playing ? 'Pause' : 'Replay'} onClick={play}><Icon n={playing ? 'pause' : 'play'} swap size={15} /></Button>
      <Slider size="compact" showValue={false} label="Show the canvas as it was on" min={range.from} max={range.to} step={Math.max(1, Math.round((range.to - range.from) / 400))} value={at ?? range.to} onChange={(v) => { cancelAnimationFrame(raf.current); setPlaying(false); setAt(v >= range.to ? null : v); }} />
      <span className="small num replay-at">{at ? longDate(at) : 'Now'}</span>
    </div>)}
    {link && (<Insights p={p} link={link} blocks={blocks} reload={reload} onClose={() => setLink(null)}  />)}
  </div>);
}
