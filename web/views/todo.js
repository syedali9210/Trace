// To do: tasks as cards on Home's board, with the same feel. Click to select, click again to edit, drag to reorder,
// resize, and drag from a card's dots to another to say "do this, then that". The round button on a card marks it
// done. Home → To do shows every project's tasks, tinted by project; a project's Tasks show just its own.
import { html, useState, api, useFetch, useMe, useAi, Icon, Avatar, Seg, Empty, ErrorBox, toast, fail, go, plural, rel } from '../lib.js';
import { Bento } from './bento.js';

const STATUS = { open: ['circle', 'To do'], in_progress: ['circle-half', 'Doing'], done: ['check-circle', 'Done'] };
const AGENTS = ['Claude Code', 'Cursor', 'Codex', 'Trace AI'];

function Card({ t, toggle }) {
  const [icon, label] = STATUS[t.status] || STATUS.open;
  return html`<div class="tc-top"><span class="blabel trunc">${t.project_name}</span><span class=${`tc-st st-${t.status}`}>${label}</span></div>
    <div class="tc-main">
      <button class="tc-check" data-nodrag aria-label=${t.status === 'done' ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`} title=${t.status === 'done' ? 'Not done' : 'Done'} onClick=${(e) => { e.stopPropagation(); toggle(t); }}><${Icon} n=${t.status === 'done' ? 'check-circle' : icon} /></button>
      <div class="tc-text"><p class="tc-title">${t.title}</p>${t.body && html`<p class="tc-body">${t.body}</p>`}</div>
    </div>
    <div class="tc-foot">${t.assignee_name ? html`<span class="tc-who"><${Avatar} name=${t.assignee_name} agent=${t.assignee_type === 'agent'} /><span class="trunc">${t.assignee_name}</span></span>` : html`<span class="tc-who muted">Nobody yet</span>`}
      <span class="grow"></span>${t.comments > 0 && html`<span class="tc-n"><${Icon} n="chat-circle" />${t.comments}</span>`}<span>${rel(t.updated_at)}</span></div>`;
}

// Click a selected card again: edit it in place.
function Edit({ t, patch, close, people }) {
  const [title, setTitle] = useState(t.title), [body, setBody] = useState(t.body || '');
  const who = t.assignee ? `${t.assignee_type}:${t.assignee}` : '';
  return html`<article class="clog tpanel">
    <div class="clog-h"><span class="blabel trunc">${t.project_name}</span><span class="tools"><button class="ibtn" aria-label="Close" title="Close" onClick=${close}><${Icon} n="x" /></button></span></div>
    <textarea class="input tp-title" rows="2" value=${title} aria-label="Task" onInput=${(e) => setTitle(e.target.value)} onBlur=${() => title.trim() && title !== t.title && patch(t, { title: title.trim() })}></textarea>
    <textarea class="input" rows="3" value=${body} placeholder="Details, links, what done looks like…" aria-label="Details" onInput=${(e) => setBody(e.target.value)} onBlur=${() => body !== (t.body || '') && patch(t, { body })}></textarea>
    <${Seg} label="Status" value=${t.status} onChange=${(v) => patch(t, { status: v })} options=${Object.entries(STATUS).map(([value, [icon, label]]) => ({ value, label, icon }))} />
    <label class="field"><span>Who’s on it</span><select class="input sm" value=${who} onChange=${(e) => { const [type, id] = e.target.value.split(/:(.+)/); patch(t, { assignee_type: type || null, assignee: id || null }); }}>
      <option value="">Nobody yet</option>
      <optgroup label="People">${people.map((m) => html`<option value=${`user:${m.id}`}>${m.name}</option>`)}</optgroup>
      <optgroup label="AI agents">${AGENTS.map((a) => html`<option value=${`agent:${a}`}>${a}</option>`)}</optgroup>
    </select></label>
    <a class="small" href=${`#/p/${t.project_id}`}>Open ${t.project_name}<${Icon} n="arrow-right" /></a>
  </article>`;
}

// Tasks Trace's AI found in the open reviews: add the ones you want.
function Suggested({ list, into, onDone, onClose }) {
  const [added, setAdded] = useState({});
  const add = (t) => api(`/projects/${into}/issues`, { method: 'POST', body: { title: t.title, body: [t.why, t.from && `From ${t.from.who}: “${t.from.text}”`].filter(Boolean).join('\n\n'), source_comment_id: t.from?.id } }).then(() => { setAdded((a) => ({ ...a, [t.title]: true })); onDone(); }).catch(fail);
  const left = list.filter((t) => !added[t.title]);
  return html`<section class="suggested" aria-label="Suggested tasks">
    <div class="row"><${Icon} n="list-checks" /><b class="small grow">${list.length ? `${plural(list.length, 'task')} in the open reviews` : 'Nothing new to do'}</b>
      ${left.length > 1 && html`<button class="btn sm" onClick=${() => left.reduce((p, t) => p.then(() => add(t)), Promise.resolve())}>Add all</button>`}
      <button class="ibtn" aria-label="Close the suggestions" data-tip="Close" onClick=${onClose}><${Icon} n="x" /></button></div>
    ${list.map((t) => html`<div class=${`sg${added[t.title] ? ' on' : ''}`}>
      <div class="grow"><p class="small"><b>${t.title}</b></p>${t.why && html`<p class="tiny muted">${t.why}${t.from ? ` · from ${t.from.who}` : ''}</p>`}</div>
      ${added[t.title] ? html`<span class="chip ok"><${Icon} n="check" />Added</span>` : html`<button class="btn sm" onClick=${() => add(t)}><${Icon} n="plus" />Add</button>`}
    </div>`)}
  </section>`;
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
  return html`<div class="todo-wrap">
    <div class="todo-bar">
      ${canEdit && html`<form class="todo-add" onSubmit=${add}>
        <${Icon} n="plus" />
        <input class="grow" value=${draft} onInput=${(e) => setDraft(e.target.value)} placeholder=${project ? `Add a task to ${project.name}…` : 'Add a task…'} aria-label="New task" />
        ${!project && projects.length > 1 && html`<select class="input sm" value=${into} onChange=${(e) => setPid(e.target.value)} aria-label="Project">${projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>`}
        <button class="btn sm primary" disabled=${!draft.trim()}>Add</button>
      </form>`}
      ${ai?.ready && canEdit && into && html`<button class="btn sm" onClick=${suggest} aria-disabled=${sugg === 'reading'} data-tip=${`Read ${project?.name || projects.find((x) => x.id === into)?.name || 'the project'}’s open reviews for things to do`}><${Icon} n="list-checks" cls=${sugg === 'reading' ? 'spin' : ''} />${sugg === 'reading' ? 'Reading the reviews…' : 'Suggest tasks'}</button>`}
      <span class="grow"></span>
      ${links.length > 0 && html`<span class="chip ok">${plural(links.length, 'link')}</span>`}
      <${Seg} label="Show" value=${show} onChange=${setShow} options=${[{ value: 'open', label: `To do${open ? ` · ${open}` : ''}` }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />
    </div>
    ${sugg?.tasks?.length > 0 && html`<${Suggested} list=${sugg.tasks} into=${into} onDone=${reload} onClose=${() => setSugg(null)} />`}
    ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
    ${loading && !data && html`<div class="bento">${[1, 2, 3, 4, 5, 6].map(() => html`<div class="skeleton" style="height:132px"></div>`)}</div>`}
    ${data && !cards.length && html`<${Empty} icon="check-square" title=${show === 'done' ? 'Nothing done yet' : all.length ? 'All done' : 'No tasks yet'}>${show === 'done' ? 'Tasks you tick off land here.' : 'Add one above, make one from any comment, or ask Trace’s AI to file tasks from a review.'}</${Empty}>`}
    ${cards.length > 0 && html`<p class="board-hint">Click to select · click again to edit · drag to reorder · drag from dots to say “this, then that”</p>
    <${Bento} cls="todo-board" items=${cards} links=${links} onSave=${save} onLink=${canEdit ? connect : null} onKnot=${canEdit ? unlink : null}
      onOpen=${project ? null : (t) => go(`/p/${t.project_id}/issues`)}
      linkLabel=${(l) => `Remove link: ${byId[l.from]?.title}, then ${byId[l.to]?.title}`}
      renderCard=${(t) => html`<${Card} t=${t} toggle=${canEdit ? toggle : () => {}} />`}
      renderPanel=${canEdit ? (t, close) => html`<${Edit} t=${t} patch=${patch} close=${close} people=${members.data?.members || []} key=${t.id} />` : null}
      toolbar=${canEdit ? (t, b) => html`<button onClick=${() => toggle(t)} title=${t.status === 'done' ? 'Not done' : 'Done'} aria-label=${t.status === 'done' ? 'Mark not done' : 'Mark done'}><${Icon} n="check" /></button>
        ${t.status === 'open' && html`<button onClick=${() => patch(t, { status: 'in_progress' })} title="Start it" aria-label="Start it"><${Icon} n="play" /></button>`}
        <button onClick=${() => b.open(t)} title="Edit" aria-label="Edit"><${Icon} n="pencil-simple" /></button>
        <button class="danger" onClick=${() => remove(t)} title="Remove" aria-label="Remove the task"><${Icon} n="trash" /></button>` : null} />`}
  </div>`;
}
