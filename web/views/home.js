// Home: NCS's Latest feed (each project's newest work big beside its changelog card, sides alternating; the tasks
// wait in the expanded view), plus To do (every project's tasks on a board).
import { html, useState, api, useFetch, useMe, refreshMe, Header, Icon, ErrorBox, Seg, Avatar, Dialog, fileUrl, toast, fail, go, plural } from '../lib.js';
import { Changelog, Tile, Sentence, AttrCards, dayLabel, time } from './ncs.js';
import { Todo } from './todo.js';

export function TopActions({ review, view }) {
  return html`
    ${review > 0 && html`<a class="btn sm" href="#/inbox" data-tip="Work Trace wasn’t sure where to file"><${Icon} n="tray" /><span class="label-lg">Review</span><span class="count">${review}</span></a>`}
    <${Seg} label="View" value=${view} onChange=${(v) => go({ projects: '/projects', latest: '/', todo: '/todo' }[v])} options=${[{ value: 'projects', label: 'Projects', icon: 'folder' }, { value: 'latest', label: 'Latest', icon: 'clock-counter-clockwise' }, { value: 'todo', label: 'To do', icon: 'check-square' }]} />`;
}

// The tasks on a project, as the card shows them: who has each one.
const TaskList = ({ tasks, pid }) => tasks?.length > 0 && html`<div class="tasks">
  <h3>Tasks</h3>
  ${tasks.map((t) => html`<a class="task" href=${`#/p/${pid}/b/tasks`}><${Icon} n=${t.status === 'in_progress' ? 'circle-half' : 'circle'} /><span class="grow trunc">${t.title}</span>${t.assignee && html`<span class="who" title=${t.assignee}><${Avatar} name=${t.assignee} agent=${t.assignee_type === 'agent'} /></span>`}</a>`)}
</div>`;

// Expanded: the whole card, big: every change, the tasks, and what's open.
function Expanded({ p, onClose }) {
  const m = p.latest;
  const rows = (m.rows || []).map((c) => ({ ...c, node: c.path.split(' › ')[0].replace(/\s*\([A-Z]+\)$/, '') }));
  return html`<${Dialog} title=${p.name} size="lg" onClose=${onClose} footer=${html`<a class="btn ghost" href=${`#/m/${m.id}`} onClick=${onClose}>Open the change</a><a class="btn primary" href=${`#/p/${p.id}`} onClick=${onClose}>Open the project<${Icon} n="arrow-right" /></a>`}>
    <div class="expanded">
      <div class="fimg span3 big">${m.image && html`<img src=${fileUrl(m.image.image_key || m.image.thumb_key)} alt=${m.title} />`}</div>
      <div class="col" style="gap:10px">
        <article class="clog"><h3>Changes</h3><${Sentence} seg=${m.sentence} text=${m.summary} /><span class="tiny muted">${m.agent || m.actor_name} · ${dayLabel(m.end_ts)} ${time(m.end_ts)} · ${plural(p.iterations, 'iteration')}</span></article>
        <${AttrCards} changes=${rows} />
        ${p.tasks?.length > 0 && html`<article class="clog"><${TaskList} tasks=${p.tasks} pid=${p.id} /></article>`}
        ${p.open_reviews > 0 && html`<a class="clog small" href=${`#/p/${p.id}/b/reviews`} onClick=${onClose}><b>${plural(p.open_reviews, 'open review')}</b><span class="muted">Feedback waiting for an answer</span></a>`}
      </div>
    </div>
  </${Dialog}>`;
}

// One project: its newest work big, its changelog card beside it, sides swapping row by row (NCS's home).
function Row({ p, i, reload, onExpand }) {
  const m = p.latest;
  const again = () => api(`/moments/${m.id}/redescribe`, { method: 'POST' }).then(() => { toast('Writing it again from the diff'); setTimeout(reload, 800); }).catch(fail);
  const clog = html`<div class="feedcard"><${Changelog} m=${m && { ...m, rows: m.rows.slice(0, 8) }} project=${p} menu=${html`${m && html`<button class="ibtn" aria-label="Write the changes again" title="Write again" onClick=${again}><${Icon} n="arrows-clockwise" /></button>`}<a class="ibtn" href=${`#/p/${p.id}`} aria-label=${`Open ${p.name}`} title="Open project"><${Icon} n="dots-three" /></a>`}>
    <button class="ibtn expand" aria-label=${`Expand ${p.name}`} title="Expand" onClick=${() => onExpand(p)}><${Icon} n="arrows-out-simple" /></button>
  </${Changelog}></div>`;
  const pic = html`<${Tile} img=${m?.image} href=${`#/p/${p.id}`} cls="wide" label=${m ? m.title : p.name} alt=${m?.title || p.name} />`;
  return html`<div class=${`frow${i % 2 ? ' flip' : ''}`}>${pic}${clog}</div>`;
}
export function Latest() {
  const { data, error, loading, reload } = useFetch('/feed', ['moment', 'project', 'issue']);
  const me = useMe();
  const [big, setBig] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const seed = async () => { if (seeding) return; setSeeding(true); try { await api('/demo', { method: 'POST' }); await refreshMe(); toast('Loading the sample. Watch it fill in.'); reload(); } catch (e) { fail(e); } setSeeding(false); };
  const rows = data?.projects.filter((p) => p.latest) || [];
  return html`
    <${Header} actions=${html`<${TopActions} review=${me?.inbox} view="latest" />`}><b>Home</b></${Header}>
    <div class="content">
      ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
      ${loading && !data && html`<div class="feed">${[1, 2].map(() => html`<div class="frow"><div class="skeleton" style="height:380px"></div><div class="skeleton" style="height:380px"></div></div>`)}</div>`}
      ${data && !rows.length && html`<div class="empty"><${Icon} n="files" cls="big" /><h2>Drop files here</h2><p>Or use the upload button below. Trace sorts each file into the right project and notes what changed.</p>
        <div class="row wrap" style="margin-top:12px;justify-content:center"><a class="btn sm" href="#/settings/sources">Connect a tool</a><a class="btn sm ghost" href="#/memory">Connect your AIs’ memory</a>${!me?.projects?.length && html`<button class="btn sm ghost" onClick=${seed} aria-disabled=${seeding}>${seeding ? 'Loading…' : 'Load a sample'}</button>`}</div></div>`}
      ${rows.length > 0 && html`<div class="feed">${rows.map((p, i) => html`<${Row} p=${p} i=${i} reload=${reload} key=${p.id} onExpand=${setBig} />`)}</div>`}
    </div>
    ${big && html`<${Expanded} p=${big} onClose=${() => setBig(null)} />`}`;
}

// To do: every project's tasks on the board.
export function TodoHome() {
  const me = useMe();
  return html`<${Header} actions=${html`<${TopActions} review=${me?.inbox} view="todo" />`}><b>Home</b></${Header}>
    <div class="content"><${Todo} /></div>`;
}
