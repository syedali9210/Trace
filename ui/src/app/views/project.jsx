// Project page: brief, pins, and the tabs. Timeline newest first, newest at double size.
import { useState, useEffect, useRef, useMemo, api, useFetch, useNarrow, useMe, refreshMe, Header, Icon, Empty, ErrorBox, Loading, Seg, Dialog, Field, Menu, ToolChip, ToolIcon, Magnitude, ChangeLine, Avatar, Thumb, Code, rel, day, stamp, plural, toast, fail, copy, go, uploadFiles, fileUrl, TOOLS, Button, ph, sx, Check } from '../lib.jsx';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { AddLink } from './dialogs.jsx';
import { Tile, Sentence, longDate, time, dayLabel } from './ncs.jsx';
import { ProjectMemory } from './memory.jsx';
import { Journey, AgentScript } from './journey.jsx';
import { Tree } from './tree.jsx';
import { History } from './history.jsx';
import { DesignCanvas } from './design.jsx';
import { ProjectCanvas } from './canvas.jsx';
import { ProjectTimeline } from './timeline.jsx';
import { BlockView } from './block.jsx';
import { CaseStudy } from './casestudy.jsx';
import { Artifacts } from './artifacts.jsx';
import { References } from './refs.jsx';
import { Workflow } from './workflow.jsx';
import { Todo } from './todo.jsx';

export function MomentCard({ m, hero }) {
  const a = m.assets[0];
  const pair = a?.before && a?.after;
  return (<article className={`card mcard${hero ? ' hero' : ''}`}>
    <div className={`shots${pair ? ' pair' : ''}`}>
      {pair && (<div className="shot"><Thumb snap={a.before} big={hero}  /><span className="shot-label">Before</span></div>)}
      <div className="shot"><Thumb snap={a?.after} big={hero}  />{pair && (<span className="shot-label">After</span>)}</div>
    </div>
    <div className="col" style={sx("gap:8px;min-width:0")}>
      <a className="t" href={`#/m/${m.id}`}>{m.title}</a>
      <p className={`small ink2 ${hero ? 'clamp3' : 'clamp2'}`}>{m.summary}</p>
      <div className="meta row wrap small muted" style={sx("gap:6px")}>
        <Avatar name={m.agent || m.actor_name} agent={!!m.agent}  /><span>{m.agent || m.actor_name}</span><ToolChip tool={m.tool} short  /><span>{rel(m.end_ts)}</span>
        <Magnitude score={m.magnitude} bucket={m.bucket} basis={m.basis} compact  />
        {m.event_count > 1 && (<span>· {m.event_count} edits</span>)}{m.asset_count > 1 && (<span>· {m.asset_count} files</span>)}
        {m.comments > 0 && (<span className="row" style={sx("gap:2px")}><Icon n="chat-circle"  />{m.comments}</span>)}
      </div>
      {m.top?.length > 0 && (<div className="meta">{m.top.map((c, ki) => (<ChangeLine key={c?.id ?? ki} c={c}  />))}</div>)}
      {hero && m.why && (<p className="small muted"><b style={sx("font-weight:500")}>Probably why:</b> {m.why}</p>)}
    </div>
  </article>);
}

function ArtifactRow({ a, pid }) {
  return (<a className="card acard" href={`#/p/${pid}/artifacts`} style={sx("text-decoration:none")}><Icon n="sparkle" cls="tool-ico k-agent"  />
    <div className="col grow" style={sx("gap:2px")}><b className="small">{a.title}</b><span className="tiny muted">{a.type} from {a.agent}{a.model ? ` · ${a.model}` : ''} · {rel(a.created_at)}</span></div><span className={`chip ${a.status === 'accepted' ? 'ok' : a.status === 'failed' ? 'err' : ''}`}>{a.status}</span></a>);
}

function Timeline({ p, exploration }) {
  const [f, setF] = useState(exploration ? { exploration } : {});
  const [showFilters, setShowFilters] = useState(!!exploration);
  const upl = useRef();
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/timeline?${q}`, ['moment', 'artifact'], (t, d) => !d.project_id || d.project_id === p.id);
  const [more, setMore] = useState([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => setMore([]), [q, data]);
  const items = [...(data?.items || []), ...more];
  const iters = items.filter((x) => x.kind === 'moment');
  const sentinel = useRef();
  const canMore = more.length ? more._more : data?.more;
  const loadMore = async () => {
    if (busy || !canMore) return;
    setBusy(true);
    const last = iters.at(-1);
    try { const r = await api(`/projects/${p.id}/timeline?${q}&before=${last.ts}`); const next = [...more, ...r.items]; next._more = r.more; setMore(next); } catch (e) { fail(e); }
    setBusy(false);
  };
  useEffect(() => { // infinite scroll
    if (!sentinel.current) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && loadMore(), { rootMargin: '600px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  });
  useEffect(() => { // which iteration is in view drives the scrubber and the date
    const els = [...document.querySelectorAll('.iter[data-i]')];
    if (!els.length) return;
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).map((e) => +e.target.dataset.i);
      if (vis.length) setActive(Math.min(...vis));
    }, { rootMargin: '-120px 0px -55% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [iters.length]);
  const jump = (i) => document.querySelector(`.iter[data-i="${i}"]`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const filtered = Object.values(f).some(Boolean);
  let n = -1;
  return (<div className="tl-wrap">
    <nav className="scrub" aria-label="Iterations">{iters.slice(0, 60).map((m, i) => (<button key={m?.id ?? i} aria-current={i === active} aria-label={`${m.title}, ${longDate(m.ts)}`} title={`${m.title} · ${longDate(m.ts)}`} onClick={() => jump(i)}></button>))}</nav>
    <div className="col" style={sx("gap:0;min-width:0")}>
      {iters.length > 0 && (<div className="datepill" aria-live="polite">{longDate(iters[Math.min(active, iters.length - 1)].ts)}</div>)}
      <div className="row" style={sx("padding-bottom:10px")}>
        <Button variant="ghost" size="compact" leadingIcon={ph("funnel-simple")} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>{filtered ? 'Filtered' : 'Filter'}</Button>
        {filtered && (<Button variant="ghost" size="compact" onClick={() => setF({})}>Clear</Button>)}
      </div>
      {showFilters && (<div className="filters" role="group" aria-label="Filter the timeline" style={sx("padding-top:0")}>
        {p.explorations.length > 0 && (<NativeSelect className="sm" aria-label="Timeline" value={f.exploration || ''} onChange={(e) => setF({ ...f, exploration: e.target.value })}><NativeSelectOption value="">Main timeline</NativeSelectOption>{p.explorations.map((x, ki) => (<NativeSelectOption key={x?.id ?? ki} value={x.id}>Exploration: {x.name}{x.status !== 'open' ? ` (${x.status})` : ''}</NativeSelectOption>))}</NativeSelect>)}
        <NativeSelect className="sm" aria-label="Tool" value={f.tool || ''} onChange={(e) => setF({ ...f, tool: e.target.value })}><NativeSelectOption value="">All tools</NativeSelectOption>{data?.filters.tools.map((t, ki) => (<NativeSelectOption key={t?.id ?? ki} value={t}>{TOOLS[t]?.label || t}</NativeSelectOption>))}</NativeSelect>
        <NativeSelect className="sm" aria-label="Person" value={f.person || ''} onChange={(e) => setF({ ...f, person: e.target.value })}><NativeSelectOption value="">Everyone</NativeSelectOption>{data?.filters.people.map((t, ki) => (<NativeSelectOption key={t?.id ?? ki} value={t}>{t}</NativeSelectOption>))}</NativeSelect>
        <NativeSelect className="sm" aria-label="Change type" value={f.type || ''} onChange={(e) => setF({ ...f, type: e.target.value })}><NativeSelectOption value="">All change types</NativeSelectOption>{data?.filters.types.map((t, ki) => (<NativeSelectOption key={t?.id ?? ki} value={t}>{t}</NativeSelectOption>))}</NativeSelect>
        <label className="row small muted">From <Input className="sm" type="date" value={f.from ? new Date(+f.from).toISOString().slice(0, 10) : ''} onChange={(e) => setF({ ...f, from: e.target.value ? Date.parse(e.target.value) : '' })} /></label>
        <label className="row small muted">to <Input className="sm" type="date" value={f.to ? new Date(+f.to).toISOString().slice(0, 10) : ''} onChange={(e) => setF({ ...f, to: e.target.value ? Date.parse(e.target.value) + 86399999 : '' })} /></label>
        {f.exploration && p.can_edit && <><Button variant="tertiary" size="compact" leadingIcon={ph("upload-simple")} onClick={() => upl.current.click()}>Upload into this exploration</Button><input type="file" multiple hidden ref={upl} onChange={(e) => { uploadFiles(e.target.files, { project_id: p.id, exploration_id: f.exploration }); e.target.value = ''; }}  /></>}
      </div>)}
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {loading && !data && (<div className="tl"><Loading h={440}  /><Loading h={440}  /></div>)}
      {data && !items.length && (<div className="empty"><Icon n="files" cls="big"  /><h2>{filtered ? 'Nothing matches those filters' : 'Drop files here'}</h2><p>{filtered ? 'Try fewer filters.' : `Or use the upload button below. Every iteration of ${p.name} lands here, newest first.`}</p></div>)}
      <div className="tl">
        {items.map((it, ki) => {
          if (it.kind === 'artifact') return (<ArtifactRow key={it?.id ?? ki} a={it} pid={p.id}  />);
          n++;
          const a = it.assets[0];
          return (<article className="iter" data-i={n} key={it.id} aria-label={it.title}>
            <Tile img={a?.after} href={`#/m/${it.id}`} cls="span3" label={it.title} alt={it.title}  />
            <div className="line"><Sentence seg={it.sentence} text={it.summary}  /><span className="when">{it.agent || it.actor_name} · {dayLabel(it.ts)} {time(it.ts)}{it.comments ? <>· <Icon n="chat-circle"  /> {it.comments}</> : ''}</span></div>
          </article>);
        })}
      </div>
      {canMore && (<div ref={sentinel} className="row" style={sx("justify-content:center;padding:24px")}><Button variant="tertiary" size="default" onClick={loadMore} aria-disabled={busy}>{busy ? 'Loading…' : 'Older iterations'}</Button></div>)}
    </div>
  </div>);
}

// Files, by what they are to you (server/relevance.js): the design and docs first, then the UI's code, then the app's
// own pictures (folded after a dozen). What isn't relevant here (exports, build output, config, fonts, icons, the same
// file twice) is hidden behind one line that says how many and why; one click shows them.
const FGROUPS = [['design', 'Design and docs'], ['code', 'UI code'], ['assets', 'The app’s own pictures and media']];
function Files({ p }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/files`, ['moment']);
  const [hidden, setHidden] = useState(false), [every, setEvery] = useState(false);
  const file = useRef();
  if (error) return (<ErrorBox error={error} retry={reload} />);
  if (!data) return (<div className="files">{[1, 2, 3, 4].map((_, ki) => (<Loading key={ki} h={200} />))}</div>);
  const out = data.filter((a) => a.group === 'hidden'), why = out.reduce((m, a) => m.set(a.why, (m.get(a.why) || 0) + 1), new Map());
  const card = (a, ki) => (<article key={a?.id ?? ki} className="card fcard">
    <Thumb snap={a} />
    <div className="b"><a className="n trunc" href={`#/asset/${a.id}`} title={a.path || a.name}>{a.name}</a>
      <div className="row tiny muted" style={sx('gap:6px')}><ToolIcon tool={a.tool} /><span className="trunc">{a.why || (a.path && a.path !== a.name ? a.path.replace(/\/[^/]*$/, '') : a.type)}</span><span>· {rel(a.updated_at)}</span></div></div>
  </article>);
  return (<div className="col" style={sx('gap:24px;padding-top:16px')}>
    <div className="row"><span className="small muted grow">{plural(data.length - out.length, 'file')} that matter here{out.length ? `, ${out.length} hidden` : ''}. Every version is kept.</span>
      <Button variant="tertiary" size="compact" leadingIcon={ph('upload-simple')} onClick={() => file.current.click()}>Upload</Button><input type="file" multiple hidden ref={file} onChange={(e) => { uploadFiles(e.target.files, { project_id: p.id }); e.target.value = ''; }} /></div>
    {!data.length && (<Empty icon="files" title="No files yet">Drop files on this page, add a link, or connect a tool and map it to {p.name}.</Empty>)}
    {FGROUPS.map(([g, label]) => { const list = data.filter((x) => x.group === g); if (!list.length) return null; const cut = g === 'assets' && !every ? 12 : list.length;
      return (<section key={g} className="col" style={sx('gap:10px')} aria-label={label}><h3 className="fg-h">{label}<span className="num">{list.length}</span></h3>
        <div className="files">{list.slice(0, cut).map(card)}</div>
        {list.length > cut && (<div><Button variant="ghost" size="compact" onClick={() => setEvery(true)}>Show all {list.length}</Button></div>)}</section>); })}
    {out.length > 0 && (<section className="col" style={sx('gap:10px')} aria-label="Not relevant here">
      <button type="button" className="fg-hid" aria-expanded={hidden} onClick={() => setHidden((v) => !v)}><Icon n={hidden ? 'caret-down' : 'caret-right'} size={14} /><span>{hidden ? 'Hide' : 'Show'} the {out.length} not relevant here</span>
        <span className="muted">{[...why].sort((x, y) => y[1] - x[1]).map(([w, n]) => `${n} ${w.replace(/ \(.*\)$/, '').toLowerCase()}`).join(' · ')}</span></button>
      {hidden && (<div className="files dim">{out.map(card)}</div>)}</section>)}
  </div>);
}

function Decisions({ p }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/decisions`, ['decision', 'comment', 'moment'], (t, d) => !d.project_id || d.project_id === p.id);
  const [text, setText] = useState('');
  const add = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api(`/projects/${p.id}/decisions`, { method: 'POST', body: { text } }); setText(''); reload(); } catch (er) { fail(er); } };
  const set = (d, body) => api(`/decisions/${d.id}`, { method: 'PATCH', body }).then(reload).catch(fail);
  const del = (d) => set(d, { status: 'dismissed' }); // kept as a no, so it isn't suggested again
  const src = (d) => (d.source_type === 'moment' ? `#/m/${d.source_id}` : d.source_type === 'comment' ? `#/c/${d.source_id}` : d.source_type === 'chat' ? `#/p/${p.id}/memory` : null);
  const checks = (d) => (d.governs?.kind === 'avoid' ? `Trace checks every change for ${d.governs.label}` : d.governs?.kind === 'protect' ? `Trace checks every change to ${d.governs.label}` : null); // a rule, not only a note
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  const suggested = data?.filter((d) => d.status === 'suggested') || [];
  const confirmed = data?.filter((d) => d.status === 'confirmed') || [];
  return (<div className="col" style={sx("gap:24px;padding-top:16px;max-width:820px")}>
    {p.can_edit && (<form className="row" onSubmit={add}><Input placeholder="Record a decision, e.g. “Primary buttons use #2b59ff with 12px corners.”" value={text} onChange={(e) => setText(e.target.value)} aria-label="New decision" /><Button variant="primary" size="default">Add</Button></form>)}
    {suggested.length > 0 && (<section className="col"><span className="caps">Suggested · from your chats with your AIs, comments and commits</span><div className="card list-rows">{suggested.map((d, ki) => (<div key={d?.id ?? ki} className="lrow"><Icon n="seal-question" cls="muted"  /><div className="col grow" style={sx("gap:2px")}><span>{d.text}</span>{checks(d) && (<span className="tiny muted">{checks(d)}, once you confirm it</span>)}{src(d) && (<a className="tiny muted" href={src(d)}>Where it came from</a>)}</div>
      {p.can_edit && <><Button variant="tertiary" size="compact" onClick={() => set(d, { status: 'confirmed' })}>Confirm</Button><Button variant="ghost" size="compact" onClick={() => del(d)}>Dismiss</Button></>}</div>))}</div></section>)}
    <section className="col"><span className="caps">Decision log</span>
      {!data ? (<Loading  />) : !confirmed.length ? (<p className="small muted">No confirmed decisions yet. Decisions people make in comments, versions and commits are suggested here; agents read the confirmed ones.</p>)
      : (<div className="card list-rows">{confirmed.map((d, ki) => (<div key={d?.id ?? ki} className="lrow"><Icon n="seal-check"  /><div className="col grow" style={sx("gap:2px")}><span>{d.text}</span><span className="tiny muted">{checks(d) ? `${checks(d)} · ` : ''}{d.confirmed_by ? `Confirmed by ${d.confirmed_by} · ` : ''}{rel(d.created_at)}{src(d) ? <>· <a href={src(d)}>source</a></> : ''}</span></div>{p.can_edit && (<Menu label="Decision actions" items={[{ label: 'Move back to suggested', icon: 'arrow-counter-clockwise', onClick: () => set(d, { status: 'suggested' }) }, { label: 'Delete', icon: 'trash', danger: true, onClick: () => del(d) }]}  />)}</div>))}</div>)}
    </section>
  </div>);
}

function Proposals({ p }) {
  const me = useMe();
  const { data, error, reload } = useFetch(`/projects/${p.id}/proposals`, ['proposal'], (t, d) => d.project_id === p.id);
  const br = useFetch(`/projects/${p.id}/branches`);
  const [dlg, setDlg] = useState(null);
  const said = (t) => String(t || '').replace(/\s+/g, ' ').replace(/^(?:(?:bro|broski)[,! ]+)+/i, '').slice(0, 140);
  return (<div className="col" style={sx("gap:24px;padding-top:16px;max-width:920px")}>
    {br.data?.length > 0 && (<section className="col" aria-label="Branches not merged yet"><span className="caps">In git · branches not merged into {br.data[0].base} yet</span>
      <div className="card list-rows">{br.data.map((b) => (<div key={b.name} className="lrow" style={sx('align-items:flex-start')}><Icon n="git-branch" />
        <div className="col grow" style={sx('gap:3px;min-width:0')}><b className="trunc">{b.name}</b>
          <span className="tiny muted">{plural(b.ahead, 'version')} ahead{b.behind ? ` · ${b.behind} behind` : ''} · {plural(b.files, 'file')} changed{b.last ? ` · last: “${b.last.title}” by ${b.last.who}, ${rel(b.last.when)}` : ''}</span>
          {b.asked.length > 0 && (<span className="small" style={sx('overflow-wrap:anywhere')}>Asked: {b.asked.map((a) => `“${said(a)}”`).join(' · ')}</span>)}</div>
        <Button variant="ghost" size="compact" render={<a href={`#/p/${p.id}/history/${b.head}`} />}>See in History</Button></div>))}</div>
      <p className="tiny muted">Trace doesn’t merge: decide in History, or in git.</p></section>)}
    <section className="col"><div className="row"><span className="caps grow">Explorations · parallel directions, kept apart from the main timeline</span>{p.can_edit && (<Button variant="tertiary" size="compact" leadingIcon={ph("git-branch")} onClick={() => setDlg('exploration')}>New exploration</Button>)}</div>
      {p.explorations.length ? (<div className="card list-rows">{p.explorations.map((x, ki) => (<div key={x?.id ?? ki} className="lrow"><Icon n="git-branch"  /><div className="col grow" style={sx("gap:2px")}><b className="small">{x.name}</b><span className="tiny muted">{x.description || ''} · {x.status}</span></div>
        <Button variant="ghost" size="compact" render={<a href={`#/p/${p.id}/timeline/${x.id}`} />}>Timeline</Button>
        {x.status === 'open' && p.can_edit && (<Button variant="tertiary" size="compact" onClick={() => setDlg({ exploration: x })}>Propose</Button>)}</div>))}</div>)
      : (<p className="small muted">Try a direction without touching the main timeline: create an exploration, then upload into it or move moments there. Nothing to merge; propose it when it’s ready.</p>)}
    </section>
    <section className="col"><div className="row"><span className="caps grow">Proposals · ask for review</span>{p.can_edit && (<Button variant="primary" size="compact" leadingIcon={ph("git-pull-request")} onClick={() => setDlg({})}>New proposal</Button>)}</div>
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {!data ? (<Loading  />) : !data.length ? (<p className="small muted">No proposals yet. A proposal bundles moments (or an exploration) for review; accepting it marks the current direction.</p>)
      : (<div className="card list-rows">{data.map((x, ki) => (<a key={x?.id ?? ki} className="lrow" href={`#/proposal/${x.id}`} style={sx("text-decoration:none")}><Icon n="git-pull-request"  /><div className="col grow" style={sx("gap:2px")}><b className="small">{x.title}</b><span className="tiny muted">{plural(x.moment_ids.length, 'moment')} · {plural(x.reviews.length, 'review')} · {rel(x.updated_at)}</span></div><span className={`chip ${x.status === 'accepted' ? 'ok' : x.status === 'changes_requested' ? 'warn' : x.status === 'rejected' ? 'err' : 'sel'}`}>{x.status.replace('_', ' ')}</span></a>))}</div>)}
    </section>
    {dlg === 'exploration' && (<NewExploration p={p} onClose={() => setDlg(null)}  />)}
    {dlg && dlg !== 'exploration' && (<NewProposal p={p} exploration={dlg.exploration} onClose={() => { setDlg(null); reload(); }}  />)}
  </div>);
}

function NewExploration({ p, onClose }) {
  const [f, setF] = useState({});
  const go_ = async (e) => { e.preventDefault(); try { await api(`/projects/${p.id}/explorations`, { method: 'POST', body: f }); toast('Exploration created. Upload into it from the timeline filter, or move moments there.'); onClose(); } catch (er) { fail(er); } };
  return (<Dialog title="New exploration" onClose={onClose}><form className="col" style={sx("gap:12px")} onSubmit={go_}>
    <Field label="Name" hint="e.g. Dark theme try"><Input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
    <Field label="What you’re trying"><Textarea rows="2" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })}></Textarea></Field>
    <div className="row"><Button variant="primary" size="default">Create exploration</Button></div></form></Dialog>);
}

function NewProposal({ p, exploration, onClose }) {
  const tl = useFetch(exploration ? null : `/projects/${p.id}/timeline?limit=40`);
  const members = useFetch('/members');
  const [f, setF] = useState({ title: exploration ? `Adopt ${exploration.name}` : '', description: exploration?.description || '', moments: new Set(), reviewers: new Set() });
  const toggle = (k, id) => { const s = new Set(f[k]); s.has(id) ? s.delete(id) : s.add(id); setF({ ...f, [k]: s }); };
  const submit = async (e) => {
    e.preventDefault();
    try { const r = await api(`/projects/${p.id}/proposals`, { method: 'POST', body: { title: f.title, description: f.description, exploration_id: exploration?.id, moment_ids: [...f.moments], reviewers: [...f.reviewers] } }); onClose(); go(`/proposal/${r.id}`); } catch (er) { fail(er); }
  };
  return (<Dialog title="New proposal" size="lg" onClose={onClose} footer={<><Button variant="ghost" size="default" onClick={onClose}>Cancel</Button><Button variant="primary" size="default" onClick={submit}>Request review</Button></>}>
    <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
    <Field label="Description" hint="What changed, and what you want reviewers to look at."><Textarea rows="3" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}></Textarea></Field>
    {exploration ? (<div className="note">Proposes everything in the exploration <b>{exploration.name}</b>.</div>)
    : (<div className="col"><span className="caps">Moments to include</span><div className="col" style={sx("gap:4px;max-height:260px;overflow:auto")}>{tl.data?.items.filter((x) => x.kind === 'moment').map((m, ki) => (<label key={m?.id ?? ki} className="check small"><Check checked={f.moments.has(m.id)} onChange={() => toggle('moments', m.id)}  /><Thumb snap={m.assets[0]?.after} style={sx("width:48px;height:36px")}  /><span className="trunc">{m.title}</span><span className="muted tiny">{rel(m.end_ts)}</span></label>))}</div></div>)}
    <div className="col"><span className="caps">Reviewers</span><div className="row wrap">{members.data?.members.map((m, ki) => (<label key={m?.id ?? ki} className="check small"><Check checked={f.reviewers.has(m.id)} onChange={() => toggle('reviewers', m.id)}  />{m.name} <span className="muted">({m.role})</span></label>))}</div>
      {members.data?.members.length === 1 && (<p className="tiny muted">Solo mode: invite reviewers in Settings → Members, or review it yourself.</p>)}</div>
  </Dialog>);
}

// Decks made from this project (Make a deck, at the top).
function Decks({ p }) {
  const decks = useFetch(`/projects/${p.id}/decks`);
  return (<div className="col" style={sx("gap:12px;padding-top:16px;max-width:820px")}>
    {!decks.data ? (<Loading  />) : decks.data.length ? (<div className="card list-rows">{decks.data.map((d, ki) => (<a key={d?.id ?? ki} className="lrow" href={`#/deck/${d.id}`} style={sx("text-decoration:none")}><Icon n="presentation"  /><span className="grow small">{d.title}</span><span className="tiny muted">{rel(d.updated_at)}</span></a>))}</div>)
      : (<p className="small muted">Turn this project’s work into a presentation with “Make a deck” at the top.</p>)}
  </div>);
}

function DeckDialog({ p, onClose }) {
  const [f, setF] = useState({ template: 'case-study', from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { const d = await api(`/projects/${p.id}/decks`, { method: 'POST', body: { template: f.template, from: f.from ? Date.parse(f.from) : undefined, to: f.to ? Date.parse(f.to) + 86399999 : undefined } }); onClose(); go(`/deck/${d.id}`); } catch (e) { fail(e); setBusy(false); }
  };
  return (<Dialog title="Make a deck" onClose={onClose} footer={<><Button variant="ghost" size="default" onClick={onClose}>Cancel</Button><Button variant="primary" size="default" onClick={make} aria-disabled={busy}>{busy ? 'Writing the story…' : 'Build the deck'}</Button></>}>
    <p className="small muted">Trace tells the story from the real work: the versions and what each was asked for, what you said no to and liked in your chats with Claude, the causes it found and the results in numbers, your screenshots beside the app as it runs now, decisions and what’s next. Nothing is invented: each slide says where it comes from in its notes, and everything stays editable.</p>
    <div className="col"><span className="caps">Template</span><Seg label="Template" value={f.template} onChange={(v) => setF({ ...f, template: v })} options={[{ value: 'case-study', label: 'Case study' }, { value: 'design-review', label: 'Design review' }, { value: 'client-update', label: 'Client update' }]}  /></div>
    <div className="form-grid"><Field label="From (optional)"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field><Field label="To (optional)"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
  </Dialog>);
}

function ProjectSettings({ p, onClose, reload }) {
  const me = useMe();
  const [f, setF] = useState({ name: p.name, brief: p.brief, dnc: (p.do_not_capture || []).join('\n'), folders: (p.folders || []).join('\n') });
  const [guest, setGuest] = useState(null);
  const [confirm, setConfirm] = useState('');
  const save = async () => { try { await api(`/projects/${p.id}`, { method: 'PATCH', body: { name: f.name, brief: f.brief, do_not_capture: f.dnc.split('\n').map((x) => x.trim()).filter(Boolean), folders: f.folders.split('\n').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean) } }); await refreshMe(); reload(); onClose(); toast('Saved'); } catch (e) { fail(e); } };
  const owner = me?.user.role === 'owner';
  return (<Dialog title={`${p.name} settings`} size="lg" onClose={onClose} footer={<><Button variant="ghost" size="default" onClick={onClose}>Cancel</Button><Button variant="primary" size="default" onClick={save}>Save</Button></>}>
    <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Brief" hint="Goal, audience, constraints, style. AI agents read this first."><Textarea rows="5" value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })}></Textarea></Field>
    <Field label="Folders this project lives in" hint="Full paths, one per line (its code repo, its design folder). What Claude Code, Codex and other AIs remember from work in these folders belongs to this project."><Textarea className="mono" rows="2" value={f.folders} onChange={(e) => setF({ ...f, folders: e.target.value })} spellCheck="false"></Textarea></Field>
    <Field label="Do not capture" hint="One pattern per line; * matches anything. e.g. *client-nda*, Drafts/*. Matching files are never read."><Textarea className="mono" rows="3" value={f.dnc} onChange={(e) => setF({ ...f, dnc: e.target.value })}></Textarea></Field>
    {owner && (<div className="col"><span className="caps">Guest client link · view and comment only, expires</span>
      <div className="row"><Button variant="tertiary" size="compact" onClick={async () => { try { const r = await api(`/projects/${p.id}/guest-links`, { method: 'POST', body: { days: 14, name: 'Client' } }); setGuest(r.link); } catch (e) { fail(e); } }}>Create a 14-day link</Button></div>
      {guest && (<div className="secret"><span className="grow">{guest}</span><Button variant="tertiary" size="compact" onClick={() => copy(guest, 'Guest link copied')}>Copy</Button></div>)}</div>)}
    {owner && (<div className="col"><span className="caps">Archive or delete</span>
      <div className="row wrap"><Button variant="tertiary" size="compact" onClick={() => api(`/projects/${p.id}`, { method: 'PATCH', body: { status: p.status === 'archived' ? 'active' : 'archived' } }).then(() => { refreshMe(); reload(); onClose(); }).catch(fail)}>{p.status === 'archived' ? 'Restore project' : 'Archive project'}</Button></div>
      <p className="small muted">Deleting removes the project, everything captured into it and its stored files, now and for good. Type the project’s name to confirm.</p>
      <div className="row"><Input className="sm" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type the project name to confirm" placeholder={p.name} /><Button variant="tertiary" size="compact" className="text-destructive" aria-disabled={confirm !== p.name} onClick={() => confirm === p.name && api(`/projects/${p.id}`, { method: 'DELETE' }).then(() => { refreshMe(); go('/'); toast(`${p.name} deleted`); }).catch(fail)}>Delete project</Button></div></div>)}
  </Dialog>);
}

// A project opens on its timeline (NCS). History (every version on a canvas) fills the window like it; the other
// views (the canvas of blocks, the case study, and the rest in ⋯) share one quiet bar: back, the name, the switcher.
const VIEWS = [['timeline', 'Timeline', 'rows'], ['history', 'History', 'git-commit'], ['canvas', 'Canvas', 'squares-four'], ['casestudy', 'Case study', 'book-open-text']];
const MORE = [['design', 'Design', 'cursor-click'], ['artifacts', 'Artifacts', 'sparkle'], ['references', 'References', 'images'], ['issues', 'To do', 'check-square'], ['tree', 'Tree', 'tree-structure'], ['memory', 'AI memory', 'brain'], ['decisions', 'Decisions', 'seal-check'], ['proposals', 'Proposals', 'git-pull-request'], ['files', 'Files', 'files'], ['decks', 'Decks', 'presentation'], ['workflow', 'Workflow', 'flow-arrow']];

export function Project({ id, tab, sub }) {
  const { data: p, error, loading, reload } = useFetch(`/projects/${id}`, ['project', 'moment', 'decision', 'issue', 'proposal', 'artifact', 'reference'], (t, d) => !d.project_id || d.project_id === id || d.id === id);
  const [dlg, setDlg] = useState(() => (location.hash.includes('settings=1') ? 'settings' : null));
  const narrow = useNarrow(); // on a phone the view switch is icons only: it fits, nothing scrolls sideways
  if (error) return <><Header><a href="#/projects">Projects</a></Header><div className="content"><ErrorBox error={error} retry={reload}  /></div></>;
  if (loading && !p) return (<div className="content" style={sx("padding-top:60px")}><Loading h={300}  /></div>);
  if (tab === 'b' && sub !== 'tasks') return (<BlockView p={p} block={sub} key={sub}  />); // a block, opened from the canvas
  const view = tab === 'journey' ? 'timeline' : tab === 'b' ? 'issues' : tab; // the Tasks block opens the to-do board
  const draft = async () => { try { const r = await api(`/projects/${id}/brief/draft`, { method: 'POST' }); await api(`/projects/${id}`, { method: 'PATCH', body: { brief: r.brief } }); reload(); toast('Started a brief from the work. Edit it in project settings.'); } catch (e) { fail(e); } };
  const more = MORE.find((m) => m[0] === view);
  const switcher = (<div className="pswitch">
    <Seg size="compact" label="View" value={VIEWS.some((v) => v[0] === view) ? view : null} onChange={(v) => go(`/p/${id}/${v}`)} options={VIEWS.map(([value, label, icon]) => ({ value, label, ...(narrow ? { icon } : {}) }))}  />
    <Menu label="More of this project" btn="ibtn" text={more ? (<span className="small">{more[1]}</span>) : null} items={[
      ...MORE.map(([tid, label, icon]) => ({ label: `${label}${tid === 'artifacts' && p.counts.artifacts ? ` · ${p.counts.artifacts}` : tid === 'issues' && p.counts.issues ? ` · ${p.counts.issues}` : ''}`, icon, onClick: () => go(`/p/${id}/${tid}`) })),
      p.can_edit && '-',
      p.can_edit && { label: 'Project settings', icon: 'gear-six', onClick: () => setDlg('settings') },
      p.can_edit && { label: 'Make a deck', icon: 'presentation', onClick: () => setDlg('deck') },
      p.can_edit && { label: 'Add a link', icon: 'link-simple', onClick: () => setDlg('link') },
      p.can_edit && !p.brief && { label: 'Start the brief from the work', icon: 'note-pencil', onClick: draft },
      { label: 'Copy MCP resource', icon: 'brackets-curly', onClick: () => copy(`trace://project/${id}/brief`, 'Resource URI copied') }]}  />
  </div>);
  const dialogs = <>{dlg === 'link' && (<AddLink project_id={id} onClose={() => setDlg(null)}  />)}
    {dlg === 'deck' && (<DeckDialog p={p} onClose={() => setDlg(null)}  />)}
    {dlg === 'settings' && (<ProjectSettings p={p} reload={reload} onClose={() => setDlg(null)}  />)}</>;
  if (view === 'timeline' && !sub) return <><ProjectTimeline p={p} switcher={switcher}  />{dialogs}</>;
  if (view === 'design') return <><DesignCanvas p={p} switcher={switcher} key={p.id} />{dialogs}</>;
  if (view === 'history') return <><History p={p} switcher={switcher} sub={sub} key={p.id} onSettings={() => setDlg('settings')}  />{dialogs}</>;
  const label = [...VIEWS, ...MORE].find((v) => v[0] === view)?.[1] || 'Timeline';
  return <><div className="pview">
    <div className="pbar">
      <a className="back" href={`#/p/${id}`} aria-label={`Back to ${p.name}`} title="Timeline"><Icon n="arrow-left"  /></a>
      <div className="pbar-t"><span className="meta">{plural(p.counts.timeline, 'iteration')}{p.status === 'archived' ? ' · archived' : ''}</span><b className="trunc">{p.name}</b></div>
      <span className="grow"></span>{switcher}
    </div>
    <div className="content" role="region" aria-label={label}>
      {view === 'timeline' && (<Timeline p={p} exploration={sub} key={sub}  />)}
      {view === 'canvas' && (<ProjectCanvas p={p}  />)}
      {view === 'casestudy' && (<CaseStudy p={p} focus={sub}  />)}
      {view === 'artifacts' && (<Artifacts p={p} sub={sub}  />)}
      {view === 'decks' && (<Decks p={p}  />)}
      {view === 'tree' && (<Tree p={p}  />)}
      {view === 'references' && (<References p={p}  />)}
      {view === 'memory' && (<div className="col" style={sx("gap:32px")}><ProjectMemory p={p} onFolders={reload}  />{p.can_edit && (<div style={sx("max-width:900px")}><AgentScript p={p}  /></div>)}</div>)}
      {view === 'files' && (<Files p={p}  />)}
      {view === 'decisions' && (<Decisions p={p}  />)}
      {view === 'issues' && (<Todo project={p}  />)}
      {view === 'proposals' && (<Proposals p={p}  />)}
      {view === 'workflow' && (<Workflow p={p}  />)}
    </div>
  </div>{dialogs}</>;
}
