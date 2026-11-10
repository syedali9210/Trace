// Home: NCS's Latest feed. The two newest projects stand big beside their cards, sides alternating; the ones before
// them stand two to a row, so every project is within two screens (the tasks wait in the expanded view). Plus To do
// (every project's tasks on a board). The project card Projects and Ask use lives here too.
import { useState, api, useFetch, useMe, refreshMe, Header, Icon, ErrorBox, Seg, Avatar, Dialog, fileUrl, toast, fail, go, plural, rel, initials, Button, ph, Tip, sx, cn } from '../lib.jsx';
import { Rows, Sentence, AttrCards, dayLabel, time } from './ncs.jsx';
import { Todo } from './todo.jsx';
import { Backdrop, effectFor } from '../effects/index.jsx';

export function TopActions({ review, view }) {
  return <>{review > 0 && (<Tip tip="Work Trace wasn’t sure where to file"><Button variant="tertiary" size="compact" leadingIcon={ph("tray")} render={<a href="#/inbox" />}><span className="label-lg">Review</span><span className="count">{review}</span></Button></Tip>)}
    <Seg label="View" value={view} onChange={(v) => go({ projects: '/projects', latest: '/', todo: '/todo' }[v])} options={[{ value: 'latest', label: 'Home', icon: 'house' }, { value: 'projects', label: 'Projects', icon: 'folder' }, { value: 'todo', label: 'To do', icon: 'check-square' }]}  /></>;
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

// A project's card on Home: NCS's changelog (what changed last, in a sentence, with its values when it has them),
// then where the project stands and what's next, which an import of files alone can't say. `small`: the card of an
// earlier project beside its smaller picture: where it stands, or its last change when nothing is written yet.
function FeedCard({ p, small, reload, onExpand }) {
  const m = p.latest, open = p.open_reviews || 0, tasks = p.tasks?.length || 0;
  const again = () => api(`/moments/${m.id}/redescribe`, { method: 'POST' }).then(() => { toast('Writing it again from the diff'); setTimeout(reload, 800); }).catch(fail);
  const facts = [p.screens > 0 && plural(p.screens, 'screen'), p.files > 0 && plural(p.files, 'file'), p.iterations > 0 && plural(p.iterations, 'change'), rel(p.last)].filter(Boolean).join(' · ');
  const change = m && (<Sentence seg={m.sentence} text={m.summary} />);
  const stands = p.stands && (<p className="clog-stands">{p.stands}</p>);
  return (<div className="feedcard"><article className={cn('clog', small && 'sm')}>
    <div className="clog-h"><Avatar name={p.name} /><b className="trunc">{p.name}</b>{m && !small && (<span className="tools"><Button variant="ghost" size="icon-compact" aria-label="Write the changes again" title="Write again" onClick={again}><Icon n="arrows-clockwise" size={15} /></Button></span>)}</div>
    <span className="clog-sub">{facts}</span>
    {open + tasks > 0 && (<a className="clog-need" href={`#/p/${p.id}/b/${open > 0 ? 'reviews' : 'tasks'}`}>{open > 0 && (<span className="pc-flag">{plural(open, 'review')}</span>)}{tasks > 0 && (<span className="pc-flag">{plural(tasks, 'task')}</span>)}<span className="pc-need-l">{open + tasks === 1 ? 'needs you' : 'need you'}</span></a>)}
    {small ? (stands || change || (<p className="clog-stands">Nothing accepted yet.</p>))
      : <>{m && (<section className="clog-sec"><h3>Changes</h3>{change}{m.rows?.length > 0 && (<Rows rows={m.rows.slice(0, 3)} ts={m.end_ts} />)}</section>)}
        {stands && (<section className="clog-sec"><h3>Where it stands</h3>{stands}</section>)}
        {!m && !stands && (<p className="clog-stands">Nothing accepted yet.</p>)}</>}
    {p.next && !small && (<div className="clog-next"><span>Next</span><p>{p.next}</p></div>)}
    <div className="clog-foot">{/* where to go from here, named */}
      <Button variant="tertiary" size="compact" render={<a href={`#/p/${p.id}`} />}>Open</Button>
      {p.code && (<Button variant="ghost" size="compact" render={<a href={`#/p/${p.id}/history`} />}>Versions</Button>)}
      {p.code && (<Button variant="ghost" size="compact" render={<a href={`#/p/${p.id}/design`} />}>Design</Button>)}
      <span className="grow"></span>
      {m && (<Button variant="ghost" size="icon-compact" aria-label={`Expand ${p.name}`} title="Expand" onClick={() => onExpand(p)}><Icon n="arrows-out-simple" size={15} /></Button>)}
    </div>
  </article></div>);
}

// One of the newest projects: its main page big, standing on its effect, its card beside it, sides swapping row by
// row (NCS's home). `n`: which of its kind it is (the same background as on its Projects card).
function Row({ p, i, n, reload, onExpand }) {
  return (<div className={`frow${i % 2 ? ' flip' : ''}`}>
    <a className="fimg wide fstage" href={`#/p/${p.id}`} aria-label={`Open ${p.name}`}><Cover p={p} n={n} /><span className="cap">{p.name}</span></a>
    <FeedCard p={p} reload={reload} onExpand={onExpand} />
  </div>);
}
// An earlier project: the same pair, smaller, two to a row.
function Brick({ p, n, reload, onExpand }) {
  return (<div className="brick">
    <a className="brick-pic pc-pic" href={`#/p/${p.id}`} aria-label={`Open ${p.name}`}><Cover p={p} n={n} /></a>
    <FeedCard p={p} small reload={reload} onExpand={onExpand} />
  </div>);
}
const LEAD = 2; // how many of the newest keep the big row, once there are more projects than fit as big rows
export function Latest() {
  const { data, error, loading, reload } = useFetch('/feed', ['moment', 'project', 'issue']);
  const me = useMe();
  const [big, setBig] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const seed = async () => { if (seeding) return; setSeeding(true); try { await api('/demo', { method: 'POST' }); await refreshMe(); toast('Loading the sample. Watch it fill in.'); reload(); } catch (e) { fail(e); } setSeeding(false); };
  const feed = data?.projects.filter((p) => p.latest || p.files > 0) || []; // every project with something in it, newest first
  const lead = feed.length > LEAD + 1 ? feed.slice(0, LEAD) : feed, rest = feed.slice(lead.length);
  const need = data?.projects.filter((p) => (p.open_reviews || 0) + (p.tasks?.length || 0) > 0) || []; // what needs you, before what's new
  return <><Header actions={(<TopActions review={me?.inbox} view="latest"  />)}><b>Home</b>{feed.length > 0 && (<span className="hd-sub">{plural(feed.length, 'project')} · last change {rel(feed[0].last)}</span>)}</Header>
    <div className="content">
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {loading && !data && (<div className="feed">{[1, 2].map((_, ki) => (<div key={ki} className="frow"><div className="skeleton" style={sx("height:380px")}></div><div className="skeleton" style={sx("height:380px")}></div></div>))}</div>)}
      {data && !feed.length && (<div className="empty"><Icon n="files" cls="big"  /><h2>Drop files here</h2><p>Or use the upload button below. Trace sorts each file into the right project and notes what changed.</p>
        <div className="row wrap" style={sx("margin-top:12px;justify-content:center")}><Button variant="tertiary" size="compact" render={<a href="#/settings/sources" />}>Connect a tool</Button><Button variant="ghost" size="compact" render={<a href="#/memory" />}>Connect your AIs’ memory</Button>{!me?.projects?.length && (<Button variant="ghost" size="compact" onClick={seed} aria-disabled={seeding}>{seeding ? 'Loading…' : 'Load a sample'}</Button>)}</div></div>)}
      {need.length > 0 && (<nav className="needs-line" aria-label="Needs you"><span>Needs you</span>{need.map((p) => (<a key={p.id} className="needs-item" href={`#/p/${p.id}`}><b>{p.name}</b>{p.open_reviews > 0 && (<span className="pc-flag">{plural(p.open_reviews, 'review')}</span>)}{p.tasks?.length > 0 && (<span className="pc-flag">{plural(p.tasks.length, 'task')}</span>)}<Icon n="arrow-right" /></a>))}</nav>)}
      {feed.length > 0 && (<div className="feed">
        {lead.map((p, i) => (<Row p={p} i={i} n={kindIndex(data.projects, p)} reload={reload} key={p.id} onExpand={setBig}  />))}
        {rest.length > 0 && <>
          <h2 className="feed-h">Earlier<span>{plural(rest.length, 'project')}</span></h2>
          <div className="bricks">{rest.map((p) => (<Brick p={p} n={kindIndex(data.projects, p)} reload={reload} key={p.id} onExpand={setBig} />))}</div>
        </>}
      </div>)}
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
  return (<a className={cn('pc', wide && 'wide', open + tasks > 0 && 'needs')} href={`#/p/${p.id}`}>
    <span className="pc-pic"><Cover p={p} n={n} /></span>
    <span className="pc-b">
      {open + tasks > 0 && (<span className="pc-need">{open > 0 && (<span className="pc-flag">{plural(open, 'review')}</span>)}{tasks > 0 && (<span className="pc-flag">{plural(tasks, 'task')}</span>)}<span className="pc-need-l">need you</span></span>)}
      <span className="pc-t"><b className="trunc">{p.name}</b>{p.code && (<Icon n="code" cls="pc-ico" label="A code folder" />)}</span>
      {wide ? <>
        <span className="pc-facts">{[p.screens > 0 && plural(p.screens, 'screen'), p.files > 0 && plural(p.files, 'file'), p.iterations > 0 && plural(p.iterations, 'change')].filter(Boolean).join(' · ') || 'Nothing captured yet'}</span>
        {p.latest && (<span className="pc-l pc-last">{changeText(p.latest, p.name)}</span>)}
      </> : (<span className="pc-l">{p.latest ? changeText(p.latest, p.name) : 'Nothing captured yet'}</span>)}
      <span className="pc-m">{p.category && <><span>{p.category}</span><span aria-hidden="true">·</span></>}<span>{rel(p.last)}</span>{!wide && <><span aria-hidden="true">·</span><span>{plural(p.iterations, 'change')}</span></>}</span>
    </span>
  </a>);
}
