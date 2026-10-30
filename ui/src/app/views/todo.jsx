// To do: tasks as cards on Home's board, with the same feel. Click to select, click again to edit, drag to reorder,
// resize, and drag from a card's dots to another to say "do this, then that". The round button on a card marks it
// done. Home → To do shows every project's tasks, tinted by project; a project's Tasks show just its own.
import { useState, api, useFetch, useMe, useAi, Icon, Avatar, Seg, Empty, ErrorBox, toast, fail, go, plural, rel, Button, ph, Tip, Chip, sx } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Bento } from './bento.jsx';

const STATUS = { open: ['circle', 'To do'], in_progress: ['circle-half', 'Doing'], done: ['check-circle', 'Done'] };
const AGENTS = ['Claude Code', 'Cursor', 'Codex', 'Trace AI'];

function Card({ t, toggle }) {
  const [icon, label] = STATUS[t.status] || STATUS.open;
  return <><div className="tc-top"><span className="blabel trunc">{t.project_name}</span><span className={`tc-st st-${t.status}`}>{label}</span></div>
    <div className="tc-main">
      <button className="tc-check" data-nodrag aria-label={t.status === 'done' ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`} title={t.status === 'done' ? 'Not done' : 'Done'} onClick={(e) => { e.stopPropagation(); toggle(t); }}><Icon n={t.status === 'done' ? 'check-circle' : icon}  /></button>
      <div className="tc-text"><p className="tc-title">{t.title}</p>{t.body && (<p className="tc-body">{t.body}</p>)}</div>
    </div>
    <div className="tc-foot">{t.assignee_name ? (<span className="tc-who"><Avatar name={t.assignee_name} agent={t.assignee_type === 'agent'}  /><span className="trunc">{t.assignee_name}</span></span>) : (<span className="tc-who muted">Nobody yet</span>)}
      <span className="grow"></span>{t.comments > 0 && (<span className="tc-n"><Icon n="chat-circle"  />{t.comments}</span>)}<span>{rel(t.updated_at)}</span></div></>;
}

// Click a selected card again: edit it in place.
function Edit({ t, patch, close, people }) {
  const [title, setTitle] = useState(t.title), [body, setBody] = useState(t.body || '');
  const who = t.assignee ? `${t.assignee_type}:${t.assignee}` : '';
  return (<article className="clog tpanel">
    <div className="clog-h"><span className="blabel trunc">{t.project_name}</span><span className="tools"><Button variant="ghost" size="icon-compact" aria-label="Close" title="Close" onClick={close}><Icon n="x" size={15} /></Button></span></div>
    <Textarea className="tp-title" rows="2" value={title} aria-label="Task" onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== t.title && patch(t, { title: title.trim() })}></Textarea>
    <Textarea rows="3" value={body} placeholder="Details, links, what done looks like…" aria-label="Details" onChange={(e) => setBody(e.target.value)} onBlur={() => body !== (t.body || '') && patch(t, { body })}></Textarea>
    <Seg label="Status" value={t.status} onChange={(v) => patch(t, { status: v })} options={Object.entries(STATUS).map(([value, [icon, label]]) => ({ value, label, icon }))}  />
    <label className="field"><span>Who’s on it</span><NativeSelect className="sm" value={who} onChange={(e) => { const [type, id] = e.target.value.split(/:(.+)/); patch(t, { assignee_type: type || null, assignee: id || null }); }}>
      <NativeSelectOption value="">Nobody yet</NativeSelectOption>
      <optgroup label="People">{people.map((m, ki) => (<NativeSelectOption key={m?.id ?? ki} value={`user:${m.id}`}>{m.name}</NativeSelectOption>))}</optgroup>
      <optgroup label="AI agents">{AGENTS.map((a, ki) => (<NativeSelectOption key={a?.id ?? ki} value={`agent:${a}`}>{a}</NativeSelectOption>))}</optgroup>
    </NativeSelect></label>
    <a className="small" href={`#/p/${t.project_id}`}>Open {t.project_name}<Icon n="arrow-right"  /></a>
  </article>);
}

// Tasks Trace's AI found in the open reviews: add the ones you want.
function Suggested({ list, into, onDone, onClose }) {
  const [added, setAdded] = useState({});
  const add = (t) => api(`/projects/${into}/issues`, { method: 'POST', body: { title: t.title, body: [t.why, t.from && `From ${t.from.who}: “${t.from.text}”`].filter(Boolean).join('\n\n'), source_comment_id: t.from?.id } }).then(() => { setAdded((a) => ({ ...a, [t.title]: true })); onDone(); }).catch(fail);
  const left = list.filter((t) => !added[t.title]);
  return (<section className="suggested" aria-label="Suggested tasks">
    <div className="row"><Icon n="list-checks"  /><b className="small grow">{list.length ? `${plural(list.length, 'task')} in the open reviews` : 'Nothing new to do'}</b>
      {left.length > 1 && (<Button variant="tertiary" size="compact" onClick={() => left.reduce((p, t) => p.then(() => add(t)), Promise.resolve())}>Add all</Button>)}
      <Tip tip="Close"><Button variant="ghost" size="icon-compact" aria-label="Close the suggestions" onClick={onClose}><Icon n="x" size={15} /></Button></Tip></div>
    {list.map((t, ki) => (<div key={t?.id ?? ki} className={`sg${added[t.title] ? ' on' : ''}`}>
      <div className="grow"><p className="small"><b>{t.title}</b></p>{t.why && (<p className="tiny muted">{t.why}{t.from ? ` · from ${t.from.who}` : ''}</p>)}</div>
      {added[t.title] ? (<Chip tone="ok"><Icon n="check"  />Added</Chip>) : (<Button variant="tertiary" size="compact" leadingIcon={ph("plus")} onClick={() => add(t)}>Add</Button>)}
    </div>))}
  </section>);
}

export function Todo({ project }) {
  const me = useMe();
  const ai = useAi();
  const [sugg, setSugg] = useState(null); // null | 'reading' | { tasks, note }
  const suggest = () => { if (sugg === 'reading') return; setSugg('reading'); api(`/projects/${into}/ai/tasks`, { method: 'POST' }).then((r) => { setSugg(r); if (!r.tasks.length) toast(r.note || 'Nothing new to do in the reviews'); }).catch((e) => { fail(e); setSugg(null); }); };
  const { data, error, loading, reload } = useFetch(`/todo${project ? `?project=${project.id}` : ''}`, ['issue', 'project'], (t, d) => !project || !d.project_id || d.project_id === project.id);
  const members = useFetch('/members');
  const [show, setShow] = useState('open');
  const [draft, setDraft] = useState('');
  const [pid, setPid] = useState('');
  const projects = me?.projects || [];
  const into = project?.id || pid || projects[0]?.id;
  const save = (body) => api('/todo', { method: 'PUT', body }).catch(fail);
  const patch = (t, body) => api(`/issues/${t.id}`, { method: 'PATCH', body }).then(reload).catch(fail);
  const [just, setJust] = useState(null); // the card you just ticked: its check pops
  const toggle = (t) => { setJust(t.status === 'done' ? null : t.id); return patch(t, { status: t.status === 'done' ? 'open' : 'done' }).then(() => t.status !== 'done' && toast(`Done: ${t.title}`, { action: { label: 'Undo', fn: () => patch(t, { status: t.status }) } })); };
  const remove = (t) => patch(t, { status: 'closed' }).then(() => toast('Task removed', { action: { label: 'Undo', fn: () => patch(t, { status: t.status }) } }));
  const add = async (e) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    if (!into) { toast('Make a project first, then add its tasks.'); return; }
    try { await api(`/projects/${into}/issues`, { method: 'POST', body: { title } }); setDraft(''); setShow((s) => (s === 'done' ? 'open' : s)); reload(); } catch (er) { fail(er); }
  };
  const all = data?.tasks || [];
  const tasks = all.filter((t) => show === 'all' || (show === 'done' ? t.status === 'done' : t.status !== 'done'));
  const cards = tasks.map((t) => ({ ...t, cls: `tint-${t.tint} todo${t.status === 'done' ? ' is-done' : ''}${t.id === just ? ' just' : ''}`, label: `${t.title}, ${STATUS[t.status]?.[1] || t.status}` }));
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  const shown = new Set(cards.map((c) => c.id));
  const links = (data?.links || []).map((l) => ({ from: l.from_id, to: l.to_id })).filter((l) => shown.has(l.from) && shown.has(l.to));
  const connect = (from, to) => api('/todo/links', { method: 'POST', body: { from, to } }).then(() => { toast(`${byId[from].title}, then ${byId[to].title}`); reload(); }).catch(fail);
  const unlink = (l) => api('/todo/links', { method: 'DELETE', body: l }).then(() => { reload(); toast('Link removed', { action: { label: 'Undo', fn: () => connect(l.from, l.to) } }); }).catch(fail);
  const open = all.filter((t) => t.status !== 'done').length;
  const canEdit = project ? project.can_edit : me?.user.role !== 'viewer';
  return (<div className="todo-wrap">
    <div className="todo-bar">
      {canEdit && (<form className="todo-add" onSubmit={add}>
        <Icon n="plus"  />
        <input className="grow" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={project ? `Add a task to ${project.name}…` : 'Add a task…'} aria-label="New task"  />
        {!project && projects.length > 1 && (<NativeSelect className="sm" value={into} onChange={(e) => setPid(e.target.value)} aria-label="Project">{projects.map((p, ki) => (<NativeSelectOption key={p?.id ?? ki} value={p.id}>{p.name}</NativeSelectOption>))}</NativeSelect>)}
        <Button variant="primary" size="compact" disabled={!draft.trim()}>Add</Button>
      </form>)}
      {ai?.ready && canEdit && into && (<Tip tip={`Read ${project?.name || projects.find((x) => x.id === into)?.name || 'the project'}’s open reviews for things to do`}><Button variant="tertiary" size="compact" onClick={suggest} aria-disabled={sugg === 'reading'}><Icon n="list-checks" cls={sugg === 'reading' ? 'spin' : ''} />{sugg === 'reading' ? 'Reading the reviews…' : 'Suggest tasks'}</Button></Tip>)}
      <span className="grow"></span>
      {links.length > 0 && (<Chip tone="ok">{plural(links.length, 'link')}</Chip>)}
      <Seg label="Show" value={show} onChange={setShow} options={[{ value: 'open', label: `To do${open ? ` · ${open}` : ''}` }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]}  />
    </div>
    {sugg?.tasks?.length > 0 && (<Suggested list={sugg.tasks} into={into} onDone={reload} onClose={() => setSugg(null)}  />)}
    {error && (<ErrorBox error={error} retry={reload}  />)}
    {loading && !data && (<div className="bento">{[1, 2, 3, 4, 5, 6].map((_, ki) => (<div key={ki} className="skeleton" style={sx("height:132px")}></div>))}</div>)}
    {data && !cards.length && (<Empty icon="check-square" title={show === 'done' ? 'Nothing done yet' : all.length ? 'All done' : 'No tasks yet'}>{show === 'done' ? 'Tasks you tick off land here.' : 'Add one above, make one from any comment, or ask Trace’s AI to file tasks from a review.'}</Empty>)}
    {cards.length > 0 && <><p className="board-hint">Click to select · click again to edit · drag to reorder · drag from dots to say “this, then that”</p>
    <Bento cls="todo-board" items={cards} links={links} onSave={save} onLink={canEdit ? connect : null} onKnot={canEdit ? unlink : null}
      onOpen={project ? null : (t) => go(`/p/${t.project_id}/issues`)}
      linkLabel={(l) => `Remove link: ${byId[l.from]?.title}, then ${byId[l.to]?.title}`}
      renderCard={(t) => (<Card t={t} toggle={canEdit ? toggle : () => {}}  />)}
      renderPanel={canEdit ? (t, close) => (<Edit t={t} patch={patch} close={close} people={members.data?.members || []} key={t.id}  />) : null}
      toolbar={canEdit ? (t, b) => <><button onClick={() => toggle(t)} title={t.status === 'done' ? 'Not done' : 'Done'} aria-label={t.status === 'done' ? 'Mark not done' : 'Mark done'}><Icon n="check"  /></button>
        {t.status === 'open' && (<button onClick={() => patch(t, { status: 'in_progress' })} title="Start it" aria-label="Start it"><Icon n="play"  /></button>)}
        <button onClick={() => b.open(t)} title="Edit" aria-label="Edit"><Icon n="pencil-simple"  /></button>
        <button className="danger" onClick={() => remove(t)} title="Remove" aria-label="Remove the task"><Icon n="trash"  /></button></> : null}  /></>}
  </div>);
}
