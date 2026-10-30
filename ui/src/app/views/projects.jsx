// Projects: every project as a card (how it looks now, where it stands, how alive it is), searchable, and a card to
// start a new one.
import { useState, useFetch, useMe, Header, Icon, ErrorBox, Button, sx } from '../lib.jsx';
import { ProjectCard, TopActions, kindIndex } from './home.jsx';

const NewCard = () => (<button type="button" className="pc pc-new" onClick={() => dispatchEvent(new Event('trace:new-project'))}>
  <span className="pc-pic"><Icon n="plus" /></span>
  <span className="pc-b"><span className="pc-t"><b>New project</b></span><span className="pc-l">Or drop a code folder anywhere: it becomes a project of its own.</span></span>
</button>);

export function Projects() {
  const [q, setQ] = useState('');
  const { data, error, reload } = useFetch('/feed', ['moment', 'project', 'issue']);
  const me = useMe();
  const all = data?.projects || [];
  const ps = all.filter((p) => !q || `${p.name} ${p.stands || ''}`.toLowerCase().includes(q.toLowerCase()));
  return <><Header actions={(<TopActions review={me?.inbox} view="projects" />)}>
      <b>Projects</b>{all.length > 0 && (<span className="hd-sub">{all.length}</span>)}
      <label className="searchbar" style={sx('margin-left:auto;margin-right:auto')}><Icon n="magnifying-glass" /><span className="sr">Search projects</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" /></label>
    </Header>
    <div className="content">
      {error && (<ErrorBox error={error} retry={reload} />)}
      {!data && !error && (<div className="pc-grid wide">{[1, 2, 3].map((k) => (<div key={k} className="skeleton" style={sx('height:300px')}></div>))}</div>)}
      {data && q && !ps.length && (<div className="empty"><Icon n="folder" cls="big" /><h2>No project matches</h2><p>Try another word.</p></div>)}
      {data && (ps.length > 0 || !q) && (<div className="pc-grid wide">{ps.map((p) => (<ProjectCard p={p} key={p.id} n={kindIndex(all, p)} wide />))}{!q && (<NewCard />)}</div>)}
    </div></>;
}
