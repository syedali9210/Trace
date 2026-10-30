// Home: NCS's Latest feed (each project's newest work big beside its changelog card, sides alternating; the tasks
// wait in the expanded view), plus To do (every project's tasks on a board). The project card Projects and Ask use
// lives here too.
import { useState, api, useFetch, useMe, refreshMe, Header, Icon, ErrorBox, Seg, Avatar, Dialog, fileUrl, toast, fail, go, plural, rel, initials, Button, ph, Tip, sx, cn } from '../lib.jsx';
import { Changelog, Sentence, AttrCards, dayLabel, time } from './ncs.jsx';
import { Todo } from './todo.jsx';
import { Backdrop, effectFor } from '../effects/index.jsx';

export function TopActions({ review, view }) {
  return <>{review > 0 && (<Tip tip="Work Trace wasn’t sure where to file"><Button variant="tertiary" size="compact" leadingIcon={ph("tray")} render={<a href="#/inbox" />}><span className="label-lg">Review</span><span className="count">{review}</span></Button></Tip>)}
    <Seg label="View" value={view} onChange={(v) => go({ projects: '/projects', latest: '/', todo: '/todo' }[v])} options={[{ value: 'projects', label: 'Projects', icon: 'folder' }, { value: 'latest', label: 'Latest', icon: 'clock-counter-clockwise' }, { value: 'todo', label: 'To do', icon: 'check-square' }]}  /></>;
}

// The tasks on a project, as the card shows them: who has each one.
const TaskList = ({ tasks, pid }) => tasks?.length > 0 && (<div className="tasks">
  <h3>Tasks</h3>
  {tasks.map((t, ki) => (<a key={t?.id ?? ki} className="task" href={`#/p/${pid}/b/tasks`}><Icon n={t.status === 'in_progress' ? 'circle-half' : 'circle'}  /><span className="grow trunc">{t.title}</span>{t.assignee && (<span className="who" title={t.assignee}><Avatar name={t.assignee} agent={t.assignee_type === 'agent'}  /></span>)}</a>))}
</div>);

// Expanded: the whole card, big: every change, the tasks, and what's open.
function Expanded({ p, onClose }) {
  const m = p.latest;
  const rows = (m.rows || []).map((c) => ({ ...c, node: c.path.split(' › ')[0].replace(/\s*\([A-Z]+\)$/, '') }));
  return (<Dialog title={p.name} size="lg" onClose={onClose} footer={<><Button variant="ghost" size="default" onClick={onClose} render={<a href={`#/m/${m.id}`} />}>Open the change</Button><Button variant="primary" size="default" onClick={onClose} render={<a href={`#/p/${p.id}`} />}>Open the project<Icon n="arrow-right" /></Button></>}>
    <div className="expanded">
      <div className="fimg span3 big">{m.image && (<img src={fileUrl(m.image.image_key || m.image.thumb_key)} alt={m.title}  />)}</div>
      <div className="col" style={sx("gap:10px")}>
        <article className="clog"><h3>Changes</h3><Sentence seg={m.sentence} text={m.summary}  /><span className="tiny muted">{m.agent || m.actor_name} · {dayLabel(m.end_ts)} {time(m.end_ts)} · {plural(p.iterations, 'iteration')}</span></article>
        <AttrCards changes={rows}  />
        {p.tasks?.length > 0 && (<article className="clog"><TaskList tasks={p.tasks} pid={p.id}  /></article>)}
        {p.open_reviews > 0 && (<a className="clog small" href={`#/p/${p.id}/b/reviews`} onClick={onClose}><b>{plural(p.open_reviews, 'open review')}</b><span className="muted">Feedback waiting for an answer</span></a>)}
      </div>
    </div>
  </Dialog>);
}

// One project: its newest work big, its changelog card beside it, sides swapping row by row (NCS's home).
// The project's main page standing on its effect, as on its card. `n`: which of its kind it is (the same background).
function Row({ p, i, n, reload, onExpand }) {
  const m = p.latest;
  const again = () => api(`/moments/${m.id}/redescribe`, { method: 'POST' }).then(() => { toast('Writing it again from the diff'); setTimeout(reload, 800); }).catch(fail);
  const clog = (<div className="feedcard"><Changelog m={m && { ...m, rows: m.rows.slice(0, 8) }} project={p} menu={<>{m && (<Button variant="ghost" size="icon-compact" aria-label="Write the changes again" title="Write again" onClick={again}><Icon n="arrows-clockwise" size={15} /></Button>)}<Button variant="ghost" size="icon-compact" aria-label={`Open ${p.name}`} title="Open project" render={<a href={`#/p/${p.id}`} />}><Icon n="dots-three" size={15} /></Button></>}>
    <Button variant="ghost" size="icon-compact" className="expand absolute right-2.5 bottom-2.5 z-[1]" aria-label={`Expand ${p.name}`} title="Expand" onClick={() => onExpand(p)}><Icon n="arrows-out-simple" size={15} /></Button>
  </Changelog></div>);
  const pic = (<a className="fimg wide fstage" href={`#/p/${p.id}`} aria-label={`Open ${p.name}`}><Cover p={p} n={n} /><span className="cap">{p.name}</span></a>);
  return (<div className={`frow${i % 2 ? ' flip' : ''}`}>{pic}{clog}</div>);
}
export function Latest() {
  const { data, error, loading, reload } = useFetch('/feed', ['moment', 'project', 'issue']);
  const me = useMe();
  const [big, setBig] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const seed = async () => { if (seeding) return; setSeeding(true); try { await api('/demo', { method: 'POST' }); await refreshMe(); toast('Loading the sample. Watch it fill in.'); reload(); } catch (e) { fail(e); } setSeeding(false); };
  const rows = data?.projects.filter((p) => p.latest) || [];
  return <><Header actions={(<TopActions review={me?.inbox} view="latest"  />)}><b>Home</b></Header>
    <div className="content">
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {loading && !data && (<div className="feed">{[1, 2].map((_, ki) => (<div key={ki} className="frow"><div className="skeleton" style={sx("height:380px")}></div><div className="skeleton" style={sx("height:380px")}></div></div>))}</div>)}
      {data && !rows.length && (<div className="empty"><Icon n="files" cls="big"  /><h2>Drop files here</h2><p>Or use the upload button below. Trace sorts each file into the right project and notes what changed.</p>
        <div className="row wrap" style={sx("margin-top:12px;justify-content:center")}><Button variant="tertiary" size="compact" render={<a href="#/settings/sources" />}>Connect a tool</Button><Button variant="ghost" size="compact" render={<a href="#/memory" />}>Connect your AIs’ memory</Button>{!me?.projects?.length && (<Button variant="ghost" size="compact" onClick={seed} aria-disabled={seeding}>{seeding ? 'Loading…' : 'Load a sample'}</Button>)}</div></div>)}
      {rows.length > 0 && (<div className="feed">{rows.map((p, i) => (<Row p={p} i={i} n={kindIndex(data.projects, p)} reload={reload} key={p.id} onExpand={setBig}  />))}</div>)}
    </div>
    {big && (<Expanded p={big} onClose={() => setBig(null)}  />)}</>;
}

// To do: every project's tasks on the board.
export function TodoHome() {
  const me = useMe();
  return <><Header actions={(<TopActions review={me?.inbox} view="todo"  />)}><b>To do</b><span className="hd-sub">every project’s tasks</span></Header>
    <div className="content"><Todo  /></div></>;
}

// ---------- the project card (Projects; Ask's starting points read its words) ----------
// A change in a few words: "Added 95 code files and 77 images", not "portfolio v2: added 95…".
export const changeText = (m, name) => { const t = String(m?.title || m?.summary || '').replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:·—-]\\s*`, 'i'), ''); return t.charAt(0).toUpperCase() + t.slice(1); };
const coverOf = (p) => p.cover || p.latest?.image || p.previous?.image || null;

// Which of its kind a project is: its background among its kind's, the same on Home and Projects, whatever the order.
export const kindIndex = (all, p) => all.filter((x) => x.category === p.category).map((x) => x.id).sort().indexOf(p.id);

// A project's picture: its main frame (the app's first screen as it opens, in the shape it's built for: a window, a
// phone, a tablet) standing on an effect from Syed's Figma for its kind of product; its latest work when it has no app
// walked yet; a monogram when there's nothing to show.
function Cover({ p, n }) {
  const img = coverOf(p), form = img?.app ? img.form || 'desktop' : 'work';
  return <>
    <Backdrop preset={effectFor(p.category, n)} className="pc-fx" />
    {img ? (<span className={cn('pc-frame', form)}><img src={fileUrl(img.thumb_key || img.image_key)} alt="" loading="lazy" decoding="async" /></span>)
      : (<span className="pc-mono" aria-hidden="true">{initials(p.name)}</span>)}
  </>;
}

// One project as a card: its picture, its name, where it stands (or its latest change), and how alive it is. `n`: which
// of its kind it is, so projects of one kind wear different backgrounds.
export function ProjectCard({ p, wide, n = 0 }) {
  const open = p.open_reviews || 0, tasks = p.tasks?.length || 0;
  return (<a className={cn('pc', wide && 'wide')} href={`#/p/${p.id}`}>
    <span className="pc-pic"><Cover p={p} n={n} /></span>
    <span className="pc-b">
      <span className="pc-t"><b className="trunc">{p.name}</b>{p.code && (<Icon n="code" cls="pc-ico" label="A code folder" />)}</span>
      <span className="pc-l">{(wide && p.stands) || (p.latest ? changeText(p.latest, p.name) : 'Nothing captured yet')}</span>
      <span className="pc-m">{p.category && <><span>{p.category}</span><span aria-hidden="true">·</span></>}<span>{rel(p.last)}</span><span aria-hidden="true">·</span><span>{plural(p.iterations, 'change')}</span>
        {open > 0 && (<span className="pc-flag">{plural(open, 'review')}</span>)}{tasks > 0 && (<span className="pc-flag">{plural(tasks, 'task')}</span>)}</span>
    </span>
  </a>);
}
