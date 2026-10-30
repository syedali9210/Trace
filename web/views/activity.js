// Activity feed: accepted moments, comments, proposals and AI artifacts across the workspace.
import { html, useFetch, Header, Icon, ErrorBox, Loading, Empty, rel, day } from '../lib.js';

const KIND = { moment: ['git-commit', 'logged', (x) => `#/m/${x.id}`], comment: ['chat-circle', 'commented', (x) => `#/c/${x.id}`], proposal: ['git-pull-request', 'proposed', (x) => `#/proposal/${x.id}`], artifact: ['sparkle', 'returned', (x) => `#/p/${x.project_id}/artifacts`] };

export function Activity() {
  const { data, error, reload } = useFetch('/activity', ['moment', 'comment', 'proposal', 'artifact']);
  let last = '';
  return html`<${Header}><b>Activity</b></${Header}>
    <div class="content" style="max-width:860px">
      ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
      ${!data ? html`<${Loading} h=${300} />` : !data.length ? html`<${Empty} icon="pulse" title="Quiet so far">Accepted moments, comments, proposals and AI results show up here as they happen.</${Empty}>`
      : html`<div class="col" style="gap:0">${data.map((x) => {
          const d = day(x.ts); const head = d !== last ? ((last = d), html`<h3 class="caps" style="padding:16px 0 8px">${d}</h3>`) : null;
          const [icon, verb, href] = KIND[x.kind];
          return html`${head}<a class="lrow card" style="text-decoration:none;margin-bottom:6px" href=${href(x)}>
            <${Icon} n=${icon} cls=${x.kind === 'artifact' ? 'tool-ico k-agent' : 'muted'} />
            <div class="col grow" style="gap:2px"><span class="small"><b style="font-weight:500">${x.who || 'Someone'}</b> ${verb} ${x.kind === 'comment' ? 'on' : ''} <span class="muted">${x.project_name || ''}</span></span><span class="small ink2 clamp2">${x.text}</span></div>
            <span class="tiny muted">${rel(x.ts)}</span></a>`;
        })}</div>`}
    </div>`;
}
