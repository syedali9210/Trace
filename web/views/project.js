// Project page: brief, pins, and the tabs. Timeline newest first, newest at double size.
import { html, useState, useEffect, useRef, useMemo, api, useFetch, useMe, refreshMe, Header, Icon, Empty, ErrorBox, Loading, Tabs, Seg, Dialog, Field, Menu, ToolChip, ToolIcon, Magnitude, ChangeLine, Avatar, Thumb, Code, rel, day, stamp, plural, toast, fail, copy, go, uploadFiles, fileUrl, TOOLS } from '../lib.js';
import { AddLink } from './dialogs.js';
import { Tile, Sentence, longDate, time, dayLabel } from './ncs.js';
import { ProjectMemory } from './memory.js';
import { Journey, AgentScript } from './journey.js';
import { Tree } from './tree.js';
import { ProjectCanvas } from './canvas.js';
import { ProjectTimeline } from './timeline.js';
import { BlockView } from './block.js';
import { CaseStudy } from './casestudy.js';
import { Artifacts } from './artifacts.js';
import { References } from './refs.js';
import { Workflow } from './workflow.js';
import { Todo } from './todo.js';

export function MomentCard({ m, hero }) {
  const a = m.assets[0];
  const pair = a?.before && a?.after;
  return html`<article class=${`card mcard${hero ? ' hero' : ''}`}>
    <div class=${`shots${pair ? ' pair' : ''}`}>
      ${pair && html`<div class="shot"><${Thumb} snap=${a.before} big=${hero} /><span class="shot-label">Before</span></div>`}
      <div class="shot"><${Thumb} snap=${a?.after} big=${hero} />${pair && html`<span class="shot-label">After</span>`}</div>
    </div>
    <div class="col" style="gap:8px;min-width:0">
      <a class="t" href=${`#/m/${m.id}`}>${m.title}</a>
      <p class=${`small ink2 ${hero ? 'clamp3' : 'clamp2'}`}>${m.summary}</p>
      <div class="meta row wrap small muted" style="gap:6px">
        <${Avatar} name=${m.agent || m.actor_name} agent=${!!m.agent} /><span>${m.agent || m.actor_name}</span><${ToolChip} tool=${m.tool} short /><span>${rel(m.end_ts)}</span>
        <${Magnitude} score=${m.magnitude} bucket=${m.bucket} basis=${m.basis} compact />
        ${m.event_count > 1 && html`<span>· ${m.event_count} edits</span>`}${m.asset_count > 1 && html`<span>· ${m.asset_count} files</span>`}
        ${m.comments > 0 && html`<span class="row" style="gap:2px"><${Icon} n="chat-circle" />${m.comments}</span>`}
      </div>
      ${m.top?.length > 0 && html`<div class="meta">${m.top.map((c) => html`<${ChangeLine} c=${c} />`)}</div>`}
      ${hero && m.why && html`<p class="small muted"><b style="font-weight:500">Probably why:</b> ${m.why}</p>`}
    </div>
  </article>`;
}

function ArtifactRow({ a, pid }) {
  return html`<a class="card acard" href=${`#/p/${pid}/artifacts`} style="text-decoration:none"><${Icon} n="sparkle" cls="tool-ico k-agent" />
    <div class="col grow" style="gap:2px"><b class="small">${a.title}</b><span class="tiny muted">${a.type} from ${a.agent}${a.model ? ` · ${a.model}` : ''} · ${rel(a.created_at)}</span></div><span class=${`chip ${a.status === 'accepted' ? 'ok' : a.status === 'failed' ? 'err' : ''}`}>${a.status}</span></a>`;
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
  return html`<div class="tl-wrap">
    <nav class="scrub" aria-label="Iterations">${iters.slice(0, 60).map((m, i) => html`<button aria-current=${i === active} aria-label=${`${m.title}, ${longDate(m.ts)}`} title=${`${m.title} · ${longDate(m.ts)}`} onClick=${() => jump(i)}></button>`)}</nav>
    <div class="col" style="gap:0;min-width:0">
      ${iters.length > 0 && html`<div class="datepill" aria-live="polite">${longDate(iters[Math.min(active, iters.length - 1)].ts)}</div>`}
      <div class="row" style="padding-bottom:10px">
        <button class="btn ghost sm" aria-expanded=${showFilters} onClick=${() => setShowFilters(!showFilters)}><${Icon} n="funnel-simple" />${filtered ? 'Filtered' : 'Filter'}</button>
        ${filtered && html`<button class="btn ghost sm" onClick=${() => setF({})}>Clear</button>`}
      </div>
      ${showFilters && html`<div class="filters" role="group" aria-label="Filter the timeline" style="padding-top:0">
        ${p.explorations.length > 0 && html`<select class="input sm" aria-label="Timeline" value=${f.exploration || ''} onChange=${(e) => setF({ ...f, exploration: e.target.value })}><option value="">Main timeline</option>${p.explorations.map((x) => html`<option value=${x.id}>Exploration: ${x.name}${x.status !== 'open' ? ` (${x.status})` : ''}</option>`)}</select>`}
        <select class="input sm" aria-label="Tool" value=${f.tool || ''} onChange=${(e) => setF({ ...f, tool: e.target.value })}><option value="">All tools</option>${data?.filters.tools.map((t) => html`<option value=${t}>${TOOLS[t]?.label || t}</option>`)}</select>
        <select class="input sm" aria-label="Person" value=${f.person || ''} onChange=${(e) => setF({ ...f, person: e.target.value })}><option value="">Everyone</option>${data?.filters.people.map((t) => html`<option value=${t}>${t}</option>`)}</select>
        <select class="input sm" aria-label="Change type" value=${f.type || ''} onChange=${(e) => setF({ ...f, type: e.target.value })}><option value="">All change types</option>${data?.filters.types.map((t) => html`<option value=${t}>${t}</option>`)}</select>
        <label class="row small muted">From <input class="input sm" type="date" value=${f.from ? new Date(+f.from).toISOString().slice(0, 10) : ''} onChange=${(e) => setF({ ...f, from: e.target.value ? Date.parse(e.target.value) : '' })} /></label>
        <label class="row small muted">to <input class="input sm" type="date" value=${f.to ? new Date(+f.to).toISOString().slice(0, 10) : ''} onChange=${(e) => setF({ ...f, to: e.target.value ? Date.parse(e.target.value) + 86399999 : '' })} /></label>
        ${f.exploration && p.can_edit && html`<button class="btn sm" onClick=${() => upl.current.click()}><${Icon} n="upload-simple" />Upload into this exploration</button><input type="file" multiple hidden ref=${upl} onChange=${(e) => { uploadFiles(e.target.files, { project_id: p.id, exploration_id: f.exploration }); e.target.value = ''; }} />`}
      </div>`}
      ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
      ${loading && !data && html`<div class="tl"><${Loading} h=${440} /><${Loading} h=${440} /></div>`}
      ${data && !items.length && html`<div class="empty"><${Icon} n="files" cls="big" /><h2>${filtered ? 'Nothing matches those filters' : 'Drop files here'}</h2><p>${filtered ? 'Try fewer filters.' : `Or use the upload button below. Every iteration of ${p.name} lands here, newest first.`}</p></div>`}
      <div class="tl">
        ${items.map((it) => {
          if (it.kind === 'artifact') return html`<${ArtifactRow} a=${it} pid=${p.id} />`;
          n++;
          const a = it.assets[0];
          return html`<article class="iter" data-i=${n} key=${it.id} aria-label=${it.title}>
            <${Tile} img=${a?.after} href=${`#/m/${it.id}`} cls="span3" label=${it.title} alt=${it.title} />
            <div class="line"><${Sentence} seg=${it.sentence} text=${it.summary} /><span class="when">${it.agent || it.actor_name} · ${dayLabel(it.ts)} ${time(it.ts)}${it.comments ? html` · <${Icon} n="chat-circle" /> ${it.comments}` : ''}</span></div>
          </article>`;
        })}
      </div>
      ${canMore && html`<div ref=${sentinel} class="row" style="justify-content:center;padding:24px"><button class="btn" onClick=${loadMore} aria-disabled=${busy}>${busy ? 'Loading…' : 'Older iterations'}</button></div>`}
    </div>
  </div>`;
}

function Files({ p }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/files`, ['moment']);
  const file = useRef();
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data) return html`<div class="files">${[1, 2, 3, 4].map(() => html`<${Loading} h=${200} />`)}</div>`;
  return html`<div class="col" style="gap:16px;padding-top:16px">
    <div class="row"><span class="small muted grow">${plural(data.length, 'file')} across ${plural(new Set(data.map((a) => a.tool)).size, 'tool')}. Every version is kept.</span>
      <button class="btn sm" onClick=${() => file.current.click()}><${Icon} n="upload-simple" />Upload</button><input type="file" multiple hidden ref=${file} onChange=${(e) => { uploadFiles(e.target.files, { project_id: p.id }); e.target.value = ''; }} /></div>
    ${!data.length ? html`<${Empty} icon="files" title="No files yet">Drop files on this page, add a link, or connect a tool and map it to ${p.name}.</${Empty}>`
    : html`<div class="files">${data.map((a) => html`<article class="card fcard">
        <${Thumb} snap=${a} />
        <div class="b"><a class="n trunc" href=${`#/asset/${a.id}`}>${a.name}</a>
          <div class="row tiny muted" style="gap:6px"><${ToolIcon} tool=${a.tool} /><span>${a.type}</span><span>· ${plural(a.versions, 'version')}</span><span>· ${rel(a.updated_at)}</span></div></div>
      </article>`)}</div>`}
  </div>`;
}

function Decisions({ p }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/decisions`, ['decision', 'comment', 'moment'], (t, d) => !d.project_id || d.project_id === p.id);
  const [text, setText] = useState('');
  const add = async (e) => { e.preventDefault(); if (!text.trim()) return; try { await api(`/projects/${p.id}/decisions`, { method: 'POST', body: { text } }); setText(''); reload(); } catch (er) { fail(er); } };
  const set = (d, body) => api(`/decisions/${d.id}`, { method: 'PATCH', body }).then(reload).catch(fail);
  const del = (d) => api(`/decisions/${d.id}`, { method: 'DELETE' }).then(reload).catch(fail);
  const src = (d) => (d.source_type === 'moment' ? `#/m/${d.source_id}` : d.source_type === 'comment' ? `#/c/${d.source_id}` : null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const suggested = data?.filter((d) => d.status !== 'confirmed') || [];
  const confirmed = data?.filter((d) => d.status === 'confirmed') || [];
  return html`<div class="col" style="gap:24px;padding-top:16px;max-width:820px">
    ${p.can_edit && html`<form class="row" onSubmit=${add}><input class="input" placeholder="Record a decision, e.g. “Primary buttons use #2b59ff with 12px corners.”" value=${text} onInput=${(e) => setText(e.target.value)} aria-label="New decision" /><button class="btn primary">Add</button></form>`}
    ${suggested.length > 0 && html`<section class="col"><span class="caps">Suggested · from comments, versions and commits</span><div class="card list-rows">${suggested.map((d) => html`<div class="lrow"><${Icon} n="seal-question" cls="muted" /><div class="col grow" style="gap:2px"><span>${d.text}</span>${src(d) && html`<a class="tiny muted" href=${src(d)}>Where it came from</a>`}</div>
      ${p.can_edit && html`<button class="btn sm" onClick=${() => set(d, { status: 'confirmed' })}>Confirm</button><button class="btn ghost sm" onClick=${() => del(d)}>Dismiss</button>`}</div>`)}</div></section>`}
    <section class="col"><span class="caps">Decision log</span>
      ${!data ? html`<${Loading} />` : !confirmed.length ? html`<p class="small muted">No confirmed decisions yet. Decisions people make in comments, versions and commits are suggested here; agents read the confirmed ones.</p>`
      : html`<div class="card list-rows">${confirmed.map((d) => html`<div class="lrow"><${Icon} n="seal-check" /><div class="col grow" style="gap:2px"><span>${d.text}</span><span class="tiny muted">${d.confirmed_by ? `Confirmed by ${d.confirmed_by} · ` : ''}${rel(d.created_at)}${src(d) ? html` · <a href=${src(d)}>source</a>` : ''}</span></div>${p.can_edit && html`<${Menu} label="Decision actions" items=${[{ label: 'Move back to suggested', icon: 'arrow-counter-clockwise', onClick: () => set(d, { status: 'suggested' }) }, { label: 'Delete', icon: 'trash', danger: true, onClick: () => del(d) }]} />`}</div>`)}</div>`}
    </section>
  </div>`;
}

function Proposals({ p }) {
  const me = useMe();
  const { data, error, reload } = useFetch(`/projects/${p.id}/proposals`, ['proposal'], (t, d) => d.project_id === p.id);
  const [dlg, setDlg] = useState(null);
  return html`<div class="col" style="gap:24px;padding-top:16px;max-width:920px">
    <section class="col"><div class="row"><span class="caps grow">Explorations · parallel directions, kept apart from the main timeline</span>${p.can_edit && html`<button class="btn sm" onClick=${() => setDlg('exploration')}><${Icon} n="git-branch" />New exploration</button>`}</div>
      ${p.explorations.length ? html`<div class="card list-rows">${p.explorations.map((x) => html`<div class="lrow"><${Icon} n="git-branch" /><div class="col grow" style="gap:2px"><b class="small">${x.name}</b><span class="tiny muted">${x.description || ''} · ${x.status}</span></div>
        <a class="btn sm ghost" href=${`#/p/${p.id}/timeline/${x.id}`}>Timeline</a>
        ${x.status === 'open' && p.can_edit && html`<button class="btn sm" onClick=${() => setDlg({ exploration: x })}>Propose</button>`}</div>`)}</div>`
      : html`<p class="small muted">Try a direction without touching the main timeline: create an exploration, then upload into it or move moments there. Nothing to merge; propose it when it’s ready.</p>`}
    </section>
    <section class="col"><div class="row"><span class="caps grow">Proposals · ask for review</span>${p.can_edit && html`<button class="btn primary sm" onClick=${() => setDlg({})}><${Icon} n="git-pull-request" />New proposal</button>`}</div>
      ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
      ${!data ? html`<${Loading} />` : !data.length ? html`<p class="small muted">No proposals yet. A proposal bundles moments (or an exploration) for review; accepting it marks the current direction.</p>`
      : html`<div class="card list-rows">${data.map((x) => html`<a class="lrow" href=${`#/proposal/${x.id}`} style="text-decoration:none"><${Icon} n="git-pull-request" /><div class="col grow" style="gap:2px"><b class="small">${x.title}</b><span class="tiny muted">${plural(x.moment_ids.length, 'moment')} · ${plural(x.reviews.length, 'review')} · ${rel(x.updated_at)}</span></div><span class=${`chip ${x.status === 'accepted' ? 'ok' : x.status === 'changes_requested' ? 'warn' : x.status === 'rejected' ? 'err' : 'sel'}`}>${x.status.replace('_', ' ')}</span></a>`)}</div>`}
    </section>
    ${dlg === 'exploration' && html`<${NewExploration} p=${p} onClose=${() => setDlg(null)} />`}
    ${dlg && dlg !== 'exploration' && html`<${NewProposal} p=${p} exploration=${dlg.exploration} onClose=${() => { setDlg(null); reload(); }} />`}
  </div>`;
}

function NewExploration({ p, onClose }) {
  const [f, setF] = useState({});
  const go_ = async (e) => { e.preventDefault(); try { await api(`/projects/${p.id}/explorations`, { method: 'POST', body: f }); toast('Exploration created. Upload into it from the timeline filter, or move moments there.'); onClose(); } catch (er) { fail(er); } };
  return html`<${Dialog} title="New exploration" onClose=${onClose}><form class="col" style="gap:12px" onSubmit=${go_}>
    <${Field} label="Name" hint="e.g. Dark theme try"><input class="input" value=${f.name || ''} onInput=${(e) => setF({ ...f, name: e.target.value })} autofocus /></${Field}>
    <${Field} label="What you’re trying"><textarea class="input" rows="2" value=${f.description || ''} onInput=${(e) => setF({ ...f, description: e.target.value })}></textarea></${Field}>
    <div class="row"><button class="btn primary">Create exploration</button></div></form></${Dialog}>`;
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
  return html`<${Dialog} title="New proposal" size="lg" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${submit}>Request review</button>`}>
    <${Field} label="Title"><input class="input" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>
    <${Field} label="Description" hint="What changed, and what you want reviewers to look at."><textarea class="input" rows="3" value=${f.description} onInput=${(e) => setF({ ...f, description: e.target.value })}></textarea></${Field}>
    ${exploration ? html`<div class="note">Proposes everything in the exploration <b>${exploration.name}</b>.</div>`
    : html`<div class="col"><span class="caps">Moments to include</span><div class="col" style="gap:4px;max-height:260px;overflow:auto">${tl.data?.items.filter((x) => x.kind === 'moment').map((m) => html`<label class="check small"><input type="checkbox" checked=${f.moments.has(m.id)} onChange=${() => toggle('moments', m.id)} /><${Thumb} snap=${m.assets[0]?.after} style="width:48px;height:36px" /><span class="trunc">${m.title}</span><span class="muted tiny">${rel(m.end_ts)}</span></label>`)}</div></div>`}
    <div class="col"><span class="caps">Reviewers</span><div class="row wrap">${members.data?.members.map((m) => html`<label class="check small"><input type="checkbox" checked=${f.reviewers.has(m.id)} onChange=${() => toggle('reviewers', m.id)} />${m.name} <span class="muted">(${m.role})</span></label>`)}</div>
      ${members.data?.members.length === 1 && html`<p class="tiny muted">Solo mode: invite reviewers in Settings → Members, or review it yourself.</p>`}</div>
  </${Dialog}>`;
}

// Decks made from this project (Make a deck, at the top).
function Decks({ p }) {
  const decks = useFetch(`/projects/${p.id}/decks`);
  return html`<div class="col" style="gap:12px;padding-top:16px;max-width:820px">
    ${!decks.data ? html`<${Loading} />` : decks.data.length ? html`<div class="card list-rows">${decks.data.map((d) => html`<a class="lrow" href=${`#/deck/${d.id}`} style="text-decoration:none"><${Icon} n="presentation" /><span class="grow small">${d.title}</span><span class="tiny muted">${rel(d.updated_at)}</span></a>`)}</div>`
      : html`<p class="small muted">Turn this project’s work into a presentation with “Make a deck” at the top.</p>`}
  </div>`;
}

function DeckDialog({ p, onClose }) {
  const [f, setF] = useState({ template: 'design-review', from: '', to: '' });
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { const d = await api(`/projects/${p.id}/decks`, { method: 'POST', body: { template: f.template, from: f.from ? Date.parse(f.from) : undefined, to: f.to ? Date.parse(f.to) + 86399999 : undefined } }); onClose(); go(`/deck/${d.id}`); } catch (e) { fail(e); setBusy(false); }
  };
  return html`<${Dialog} title="Make a deck" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${make} aria-disabled=${busy}>${busy ? 'Writing the story…' : 'Build the deck'}</button>`}>
    <p class="small muted">Trace builds the story from the real work: problem, references, iterations, key decisions, where it stands, next. Everything stays editable.</p>
    <div class="col"><span class="caps">Template</span><${Seg} label="Template" value=${f.template} onChange=${(v) => setF({ ...f, template: v })} options=${[{ value: 'client-update', label: 'Client update' }, { value: 'design-review', label: 'Design review' }, { value: 'case-study', label: 'Case study' }]} /></div>
    <div class="form-grid"><${Field} label="From (optional)"><input class="input" type="date" value=${f.from} onInput=${(e) => setF({ ...f, from: e.target.value })} /></${Field}><${Field} label="To (optional)"><input class="input" type="date" value=${f.to} onInput=${(e) => setF({ ...f, to: e.target.value })} /></${Field}></div>
  </${Dialog}>`;
}

function ProjectSettings({ p, onClose, reload }) {
  const me = useMe();
  const [f, setF] = useState({ name: p.name, brief: p.brief, dnc: (p.do_not_capture || []).join('\n'), folders: (p.folders || []).join('\n') });
  const [guest, setGuest] = useState(null);
  const [confirm, setConfirm] = useState('');
  const save = async () => { try { await api(`/projects/${p.id}`, { method: 'PATCH', body: { name: f.name, brief: f.brief, do_not_capture: f.dnc.split('\n').map((x) => x.trim()).filter(Boolean), folders: f.folders.split('\n').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean) } }); await refreshMe(); reload(); onClose(); toast('Saved'); } catch (e) { fail(e); } };
  const owner = me?.user.role === 'owner';
  return html`<${Dialog} title=${`${p.name} settings`} size="lg" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${save}>Save</button>`}>
    <${Field} label="Name"><input class="input" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></${Field}>
    <${Field} label="Brief" hint="Goal, audience, constraints, style. AI agents read this first."><textarea class="input" rows="5" value=${f.brief} onInput=${(e) => setF({ ...f, brief: e.target.value })}></textarea></${Field}>
    <${Field} label="Folders this project lives in" hint="Full paths, one per line (its code repo, its design folder). What Claude Code, Codex and other AIs remember from work in these folders belongs to this project."><textarea class="input mono" rows="2" value=${f.folders} onInput=${(e) => setF({ ...f, folders: e.target.value })} spellcheck="false"></textarea></${Field}>
    <${Field} label="Do not capture" hint="One pattern per line; * matches anything. e.g. *client-nda*, Drafts/*. Matching files are never read."><textarea class="input mono" rows="3" value=${f.dnc} onInput=${(e) => setF({ ...f, dnc: e.target.value })}></textarea></${Field}>
    ${owner && html`<div class="col"><span class="caps">Guest client link · view and comment only, expires</span>
      <div class="row"><button class="btn sm" onClick=${async () => { try { const r = await api(`/projects/${p.id}/guest-links`, { method: 'POST', body: { days: 14, name: 'Client' } }); setGuest(r.link); } catch (e) { fail(e); } }}>Create a 14-day link</button></div>
      ${guest && html`<div class="secret"><span class="grow">${guest}</span><button class="btn sm" onClick=${() => copy(guest, 'Guest link copied')}>Copy</button></div>`}</div>`}
    ${owner && html`<div class="col"><span class="caps">Archive or delete</span>
      <div class="row wrap"><button class="btn sm" onClick=${() => api(`/projects/${p.id}`, { method: 'PATCH', body: { status: p.status === 'archived' ? 'active' : 'archived' } }).then(() => { refreshMe(); reload(); onClose(); }).catch(fail)}>${p.status === 'archived' ? 'Restore project' : 'Archive project'}</button></div>
      <p class="small muted">Deleting removes the project, everything captured into it and its stored files, now and for good. Type the project’s name to confirm.</p>
      <div class="row"><input class="input sm" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} aria-label="Type the project name to confirm" placeholder=${p.name} /><button class="btn sm danger" aria-disabled=${confirm !== p.name} onClick=${() => confirm === p.name && api(`/projects/${p.id}`, { method: 'DELETE' }).then(() => { refreshMe(); go('/'); toast(`${p.name} deleted`); }).catch(fail)}>Delete project</button></div></div>`}
  </${Dialog}>`;
}

// A project opens on its timeline (NCS). The other views (the canvas of blocks, the case study, and the rest in
// ⋯) share one quiet bar: back, the project's name, and the view switcher.
const VIEWS = [['timeline', 'Timeline', 'rows'], ['canvas', 'Canvas', 'squares-four'], ['casestudy', 'Case study', 'book-open-text']];
const MORE = [['artifacts', 'Artifacts', 'sparkle'], ['references', 'References', 'images'], ['issues', 'To do', 'check-square'], ['tree', 'Tree', 'tree-structure'], ['memory', 'AI memory', 'brain'], ['decisions', 'Decisions', 'seal-check'], ['proposals', 'Proposals', 'git-pull-request'], ['files', 'Files', 'files'], ['decks', 'Decks', 'presentation'], ['workflow', 'Workflow', 'flow-arrow']];

export function Project({ id, tab, sub }) {
  const { data: p, error, loading, reload } = useFetch(`/projects/${id}`, ['project', 'moment', 'decision', 'issue', 'proposal', 'artifact', 'reference'], (t, d) => !d.project_id || d.project_id === id || d.id === id);
  const [dlg, setDlg] = useState(() => (location.hash.includes('settings=1') ? 'settings' : null));
  if (error) return html`<${Header}><a href="#/projects">Projects</a></${Header}><div class="content"><${ErrorBox} error=${error} retry=${reload} /></div>`;
  if (loading && !p) return html`<div class="content" style="padding-top:60px"><${Loading} h=${300} /></div>`;
  if (tab === 'b' && sub !== 'tasks') return html`<${BlockView} p=${p} block=${sub} key=${sub} />`; // a block, opened from the canvas
  const view = tab === 'journey' ? 'timeline' : tab === 'b' ? 'issues' : tab; // the Tasks block opens the to-do board
  const draft = async () => { try { const r = await api(`/projects/${id}/brief/draft`, { method: 'POST' }); await api(`/projects/${id}`, { method: 'PATCH', body: { brief: r.brief } }); reload(); toast('Started a brief from the work. Edit it in project settings.'); } catch (e) { fail(e); } };
  const more = MORE.find((m) => m[0] === view);
  const switcher = html`<div class="pswitch">
    <${Seg} label="View" value=${VIEWS.some((v) => v[0] === view) ? view : null} onChange=${(v) => go(`/p/${id}/${v}`)} options=${VIEWS.map(([value, label, icon]) => ({ value, label, icon }))} />
    <${Menu} label="More of this project" btn="ibtn" text=${more ? html`<span class="small">${more[1]}</span>` : null} items=${[
      ...MORE.map(([tid, label, icon]) => ({ label: `${label}${tid === 'artifacts' && p.counts.artifacts ? ` · ${p.counts.artifacts}` : tid === 'issues' && p.counts.issues ? ` · ${p.counts.issues}` : ''}`, icon, onClick: () => go(`/p/${id}/${tid}`) })),
      p.can_edit && '-',
      p.can_edit && { label: 'Project settings', icon: 'gear-six', onClick: () => setDlg('settings') },
      p.can_edit && { label: 'Make a deck', icon: 'presentation', onClick: () => setDlg('deck') },
      p.can_edit && { label: 'Add a link', icon: 'link-simple', onClick: () => setDlg('link') },
      p.can_edit && !p.brief && { label: 'Start the brief from the work', icon: 'note-pencil', onClick: draft },
      { label: 'Copy MCP resource', icon: 'brackets-curly', onClick: () => copy(`trace://project/${id}/brief`, 'Resource URI copied') }]} />
  </div>`;
  const dialogs = html`${dlg === 'link' && html`<${AddLink} project_id=${id} onClose=${() => setDlg(null)} />`}
    ${dlg === 'deck' && html`<${DeckDialog} p=${p} onClose=${() => setDlg(null)} />`}
    ${dlg === 'settings' && html`<${ProjectSettings} p=${p} reload=${reload} onClose=${() => setDlg(null)} />`}`;
  if (view === 'timeline' && !sub) return html`<${ProjectTimeline} p=${p} switcher=${switcher} />${dialogs}`;
  const label = [...VIEWS, ...MORE].find((v) => v[0] === view)?.[1] || 'Timeline';
  return html`<div class="pview">
    <div class="pbar">
      <a class="back" href=${`#/p/${id}`} aria-label=${`Back to ${p.name}`} title="Timeline"><${Icon} n="arrow-left" /></a>
      <div class="pbar-t"><span class="meta">${plural(p.counts.timeline, 'iteration')}${p.status === 'archived' ? ' · archived' : ''}</span><b class="trunc">${p.name}</b></div>
      <span class="grow"></span>${switcher}
    </div>
    <div class="content" role="region" aria-label=${label}>
      ${view === 'timeline' && html`<${Timeline} p=${p} exploration=${sub} key=${sub} />`}
      ${view === 'canvas' && html`<${ProjectCanvas} p=${p} />`}
      ${view === 'casestudy' && html`<${CaseStudy} p=${p} focus=${sub} />`}
      ${view === 'artifacts' && html`<${Artifacts} p=${p} sub=${sub} />`}
      ${view === 'decks' && html`<${Decks} p=${p} />`}
      ${view === 'tree' && html`<${Tree} p=${p} />`}
      ${view === 'references' && html`<${References} p=${p} />`}
      ${view === 'memory' && html`<div class="col" style="gap:32px"><${ProjectMemory} p=${p} onFolders=${reload} />${p.can_edit && html`<div style="max-width:900px"><${AgentScript} p=${p} /></div>`}</div>`}
      ${view === 'files' && html`<${Files} p=${p} />`}
      ${view === 'decisions' && html`<${Decisions} p=${p} />`}
      ${view === 'issues' && html`<${Todo} project=${p} />`}
      ${view === 'proposals' && html`<${Proposals} p=${p} />`}
      ${view === 'workflow' && html`<${Workflow} p=${p} />`}
    </div>
  </div>${dialogs}`;
}
