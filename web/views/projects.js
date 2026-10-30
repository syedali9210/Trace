// Projects (NCS): every project on one page. Count and last upload, name, one line of brief, its tools,
// then its work in a row, newest first, each piece as wide as its own shape (portrait narrow, screens wide).
import { html, useState, useFetch, useMe, Header, Icon, ErrorBox, ToolIcon, Menu, rel, plural, go } from '../lib.js';
import { Tile } from './ncs.js';
import { TopActions } from './home.js';

export function Projects() {
  const [q, setQ] = useState('');
  const { data, error, reload } = useFetch(`/projects-overview${q ? `?q=${encodeURIComponent(q)}` : ''}`, ['moment', 'project']);
  const me = useMe();
  return html`
    <${Header} actions=${html`<${TopActions} review=${me?.inbox} view="projects" />`}>
      <b>Projects</b>
      <label class="searchbar" style="margin-left:auto;margin-right:auto"><${Icon} n="magnifying-glass" /><span class="sr">Search projects</span><input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder="Search projects…" /></label>
    </${Header}>
    <div class="content">
      ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
      ${data && !data.length && html`<div class="empty"><${Icon} n="folder" cls="big" /><h2>${q ? 'No project matches' : 'No projects yet'}</h2><p>${q ? 'Try another word.' : 'Drop files anywhere and Trace starts one, or make one yourself.'}</p>${!q && html`<button class="btn sm" style="margin-top:12px" onClick=${() => dispatchEvent(new Event('trace:new-project'))}>New project</button>`}</div>`}
      ${data?.map((p) => html`<section class="proj" key=${p.id} aria-labelledby=${`pn-${p.id}`}>
        <div class="proj-h"><a class="name" id=${`pn-${p.id}`} href=${`#/p/${p.id}`}>${p.name}</a>${p.tools.map((t) => html`<${ToolIcon} tool=${t} />`)}<span class="grow"></span>
          <${Menu} label=${`${p.name} actions`} btn="ibtn" items=${[{ label: 'Open', icon: 'arrow-right', onClick: () => go(`/p/${p.id}`) }, { label: 'Settings', icon: 'gear-six', onClick: () => go(`/p/${p.id}/timeline?settings=1`) }, { label: 'Make a deck', icon: 'presentation', onClick: () => go(`/p/${p.id}/artifacts`) }]} /></div>
        <div class="meta"><span>${plural(p.iterations, 'iteration')}</span><span>·</span><span>last uploaded ${rel(p.last)}</span></div>
        ${p.brief && html`<p class="desc">${p.brief}</p>`}
        ${p.items.length ? html`<div class="strip" role="list">${p.items.map((it, i) => html`<div role="listitem"><${Tile} img=${it.image} href=${`#/m/${it.id}`} cls=${i === 0 ? 'wide' : ''} style=${{ width: `${Math.round(Math.max(170, Math.min(i === 0 ? 560 : 420, 240 * ((it.image?.width || 4) / (it.image?.height || 3)) + 36)))}px` }} label=${it.title} alt=${it.title} /></div>`)}</div>`
          : html`<p class="small muted">No accepted work yet.</p>`}
      </section>`)}
    </div>`;
}
