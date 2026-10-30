// Activity feed: accepted moments, comments, proposals and AI artifacts across the workspace.
import { useFetch, Header, Icon, ErrorBox, Loading, Empty, rel, day, sx, Fragment } from '../lib.jsx';

const KIND = { moment: ['git-commit', 'logged', (x) => `#/m/${x.id}`], comment: ['chat-circle', 'commented', (x) => `#/c/${x.id}`], proposal: ['git-pull-request', 'proposed', (x) => `#/proposal/${x.id}`], artifact: ['sparkle', 'returned', (x) => `#/p/${x.project_id}/artifacts`] };

export function Activity() {
  const { data, error, reload } = useFetch('/activity', ['moment', 'comment', 'proposal', 'artifact']);
  let last = '';
  return <><Header><b>Activity</b><span className="hd-sub">everything that happened, newest first</span></Header>
    <div className="content" style={sx("max-width:860px")}>
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {!data ? (<Loading h={300}  />) : !data.length ? (<Empty icon="pulse" title="Quiet so far">Accepted moments, comments, proposals and AI results show up here as they happen.</Empty>)
      : (<div className="col" style={sx("gap:0")}>{data.map((x, ki) => {
          const d = day(x.ts); const head = d !== last ? ((last = d), (<h3 key={x?.id ?? ki} className="caps" style={sx("padding:16px 0 8px")}>{d}</h3>)) : null;
          const [icon, verb, href] = KIND[x.kind];
          return <Fragment key={x?.id ?? ki}>{head}<a className="lrow card" style={sx("text-decoration:none;margin-bottom:6px")} href={href(x)}>
            <Icon n={icon} cls={x.kind === 'artifact' ? 'tool-ico k-agent' : 'muted'}  />
            <div className="col grow" style={sx("gap:2px")}><span className="small"><b style={sx("font-weight:500")}>{x.who || 'Someone'}</b> {verb} {x.kind === 'comment' ? 'on' : ''} <span className="muted">{x.project_name || ''}</span></span><span className="small ink2 clamp2">{x.text}</span></div>
            <span className="tiny muted">{rel(x.ts)}</span></a></Fragment>;
        })}</div>)}
    </div></>;
}
