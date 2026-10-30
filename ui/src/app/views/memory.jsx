// AI memory: what Claude Code, Codex, Antigravity, Cursor, Copilot and your chat exports already remember,
// read when asked, searched in one place, and handed to any agent that calls Trace.
import { useState, useEffect, useRef, api, useFetch, useMe, Header, Icon, ErrorBox, Loading, Dialog, Seg, rel, plural, toast, fail, Button, ph, sx } from '../lib.jsx';

const ICON = { 'claude-code': 'terminal-window', codex: 'code', antigravity: 'planet', cursor: 'cursor-text', copilot: 'github-logo', chats: 'chats-circle', notes: 'note' };
const KIND = { session: 'conversation', memory: 'memory file', instructions: 'instructions', note: 'agent note' };
const when = (ts) => (ts ? rel(typeof ts === 'string' ? Date.parse(ts) : ts) : '');

function Hit({ r, onOpen }) {
  return (<button className="mem-hit" style={sx("text-align:left;cursor:pointer;font:inherit;color:inherit")} onClick={() => onOpen(r)}>
    <span className="src"><Icon n={ICON[r.adapter] || 'brain'}  /><b style={sx("font-weight:500;color:var(--ink)")}>{r.tool}</b><span>· {KIND[r.kind] || r.kind}</span><span className="trunc">· {r.title}</span><span style={sx("margin-left:auto;white-space:nowrap")}>{when(r.when)}</span></span>
    {r.workspace && (<span className="tiny muted mono trunc">{r.workspace}</span>)}
    <span className="txt">{r.text}</span>
  </button>);
}

export function DocView({ id, onClose }) {
  const { data, error } = useFetch(`/memory/docs/${id}`);
  return (<Dialog title={data ? data.title : 'Loading…'} size="lg" onClose={onClose}>
    {error && (<ErrorBox error={error}  />)}
    {data && <><p className="small muted">{data.tool} · {KIND[data.kind] || data.kind}{data.workspace ? ` · ${data.workspace}` : ''} · {when(data.ts)}</p>
      <p className="tiny muted mono" style={sx("word-break:break-all")}>{data.path.split('#')[0]}</p>
      {data.chunks.map((c, ki) => (<div key={c?.id ?? ki} className="note" style={sx("white-space:pre-wrap;color:var(--ink)")}>{c.text}</div>))}</>}
  </Dialog>);
}

function Ask({ project, initial = '' }) {
  const [q, setQ] = useState(initial);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState(null);
  const run = async (query = q) => {
    if (query.trim().length < 2) return;
    setBusy(true);
    try { setRes(await api(`/memory/search?q=${encodeURIComponent(query)}${project ? `&project=${project.id}` : ''}&limit=12`)); } catch (e) { fail(e); }
    setBusy(false);
  };
  useEffect(() => { if (initial) run(initial); }, [initial]);
  return (<div className="col" style={sx("gap:12px")}>
    <form className="row" onSubmit={(e) => { e.preventDefault(); run(); }}>
      <label className="searchbar" style={sx("width:100%;max-width:640px;height:44px")}><Icon n="brain"  /><span className="sr">Ask</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={project ? `What do your AIs remember about ${project.name}?` : 'What do your AIs remember about…'}  /></label>
      <Button variant="tertiary" size="default" aria-disabled={busy}>{busy ? 'Reading…' : 'Ask'}</Button>
    </form>
    {res?.indexing?.length > 0 && (<p className="small muted">Still reading your AIs’ memory for the first time ({res.indexing.map((x) => `${x.done} of ${x.total} files`).join(', ')}). Ask again in a moment for more.</p>)}
    {res && !res.results.length && (<p className="small muted">Nothing your AIs remember matches that.</p>)}
    {res?.results.length > 0 && (<div className="col" style={sx("gap:10px")}>{res.results.map((r, ki) => (<Hit key={r?.id ?? ki} r={r} onOpen={(x) => setDoc(x.doc)}  />))}</div>)}
    {doc && (<DocView id={doc} onClose={() => setDoc(null)}  />)}
  </div>);
}
export function Memory() {
  const me = useMe();
  const { data, error, reload } = useFetch('/memory', ['memory', 'source']);
  const imp = useRef();
  const q = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  useEffect(() => { // while a first read is running, keep the counts moving
    if (!data?.adapters.some((a) => a.progress?.running)) return;
    const t = setTimeout(reload, 1500);
    return () => clearTimeout(t);
  }, [data]);
  const owner = me?.user.role === 'owner';
  const connect = (id) => api('/memory/connect', { method: 'POST', body: { adapter: id } }).then(() => { toast('Connected. Reading its memory now.'); reload(); }).catch(fail);
  const forget = (a) => api(`/memory/${a.source.id}`, { method: 'DELETE' }).then(() => { toast(`Disconnected ${a.label}. Trace forgot what it had read; its own files are untouched.`); reload(); }).catch(fail);
  const importFile = async (f) => { try { await api('/memory/import', { method: 'POST', raw: f, headers: { 'x-filename': encodeURIComponent(f.name) } }); toast('Export added. Reading the conversations now.'); reload(); } catch (e) { fail(e); } };
  return <><Header actions={(<Button variant="tertiary" size="compact" leadingIcon={ph("arrows-clockwise")} onClick={() => api('/memory/refresh', { method: 'POST' }).then(() => { toast('Read again; only what changed was re-read.'); reload(); }).catch(fail)}>Read again</Button>)}><b>AI memory</b><span className="hd-sub">what your AIs know, read on this computer</span></Header>
    <div className="content" style={sx("max-width:1100px")}>
      <p className="ink2" style={sx("max-width:68ch;margin-bottom:20px")}>Every AI you work with keeps its own memory: sessions, memory files, CLAUDE.md, AGENTS.md. Trace reads them when it’s asked, here or when an agent calls it, so what one AI learned the others know. Nothing leaves this computer.</p>
      <section className="section"><Ask initial={q}  /></section>
      <section className="section"><header><h2 className="grow">Your AIs</h2>{data && (<span className="small muted">{plural(data.notes, 'note')} left by agents</span>)}</header>
        {error && (<ErrorBox error={error} retry={reload}  />)}
        {!data ? (<Loading h={160}  />) : (<div className="ai-grid">{data.adapters.map((a, ki) => (<div key={a?.id ?? ki} className="ai-card">
          <div className="row"><Icon n={ICON[a.id]}  /><b className="grow">{a.label}</b>{a.source ? (<span className="row tiny muted" style={sx("gap:4px")}><span className={`dot ${a.progress?.running ? 'warn' : 'on'}`}></span>{a.progress?.running ? 'Reading' : 'Connected'}</span>) : ''}</div>
          <span className="tiny muted">{a.where}</span>
          {a.source ? (<span className="small">{a.progress?.running ? `${a.progress.done} of ${a.progress.total} files read…` : `${a.docs} ${a.docs === 1 ? 'conversation or file' : 'conversations and files'}`}{a.source.last_sync ? (<span className="muted">· read {rel(a.source.last_sync)}</span>) : ''}</span>) : ''}
          <div className="row wrap" style={sx("margin-top:auto;gap:6px")}>
            {a.id === 'chats' && owner && <><Button variant="tertiary" size="compact" leadingIcon={ph("upload-simple")} onClick={() => imp.current.click()}>Add an export</Button><input type="file" accept=".zip,.json" hidden ref={imp} onChange={(e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; }}  /></>}
            {!a.source && a.id !== 'chats' && (a.found ? owner && (<Button variant="tertiary" size="compact" onClick={() => connect(a.id)}>Connect</Button>) : (<span className="tiny muted">Not on this computer</span>))}
            {a.source && owner && (<Button variant="ghost" size="compact" onClick={() => forget(a)}>Disconnect</Button>)}
          </div>
          {a.id === 'chats' && (<span className="tiny muted">Claude.ai: Settings → Privacy → Export data. ChatGPT: Settings → Data controls → Export. Drop the zip here.</span>)}
        </div>))}</div>)}
      </section>
      <section className="section"><h2>How agents use it</h2>
        <p className="small ink2" style={sx("max-width:70ch")}>Any agent connected to Trace over MCP (Settings → MCP & agents) can call <code>recall</code> to search this memory, gets the relevant passages inside <code>get_project_context</code>, and can leave a note for the next agent with <code>remember</code>. Map projects to their folders (project settings) and each AI’s work in those folders counts as that project’s memory.</p>
        <p className="small muted" style={sx("max-width:70ch")}>Secrets (API keys, tokens, passwords) are removed before anything is indexed. Agents receive these passages marked as quoted data, never as instructions. Disconnecting an AI forgets everything Trace read from it; its own files are never changed.</p>
      </section>
    </div></>;
}

// What the project's chats with its AIs say, by rules (server/chats.js): the rules the person set, what they said no
// to and what it was about, what they kept, why things broke (Claude's words, from its replies and its reasoning), and
// the results in numbers. Each with its day and its chat; the strongest first.
const SAYS = [['rules', 'Rules you set'], ['corrections', 'What you said no to'], ['approvals', 'What you kept'], ['causes', 'Why things broke'], ['results', 'Results, in numbers']];
function ChatsSay({ p }) {
  const { data } = useFetch(`/projects/${p.id}/insights/chats`);
  const [open, setOpen] = useState('rules');
  if (!data) return (<Loading h={120} />);
  if (!data.sessions) return null;
  const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const tabs = SAYS.filter(([k]) => data[k]?.length);
  const list = data[open]?.length ? data[open] : data[tabs[0]?.[0]] || [];
  return (<section className="col" style={sx('gap:10px')} aria-label="What your chats say">
    <h2>What your chats say</h2>
    <p className="small muted">{plural(data.sessions, 'chat')} · {plural(data.asks, 'ask')}{data.from ? ` · ${when(data.from)} – ${when(data.to)}` : ''}{data.themes.length ? ` · mostly about ${data.themes.slice(0, 5).map((t) => t.word).join(', ')}` : ''}. Read by rules, not a model; each line is in its chat as written.</p>
    {tabs.length > 0 && (<Seg size="compact" label="Kind" value={data[open]?.length ? open : tabs[0][0]} onChange={setOpen} options={tabs.map(([k, label]) => ({ value: k, label: `${label} · ${data[k].length}` }))} />)}
    <div className="card list-rows">{list.slice(0, 12).map((x, i) => (<div key={i} className="lrow" style={sx('align-items:flex-start')}>
      <div className="col grow" style={sx('gap:3px;min-width:0')}><span className="small" style={sx('overflow-wrap:anywhere')}>{x.text}</span>
        {x.of && (<span className="tiny muted" style={sx('overflow-wrap:anywhere')}>About: {x.of}</span>)}
        <span className="tiny muted">{when(x.at)} · {x.session}{x.reasoning ? ' · from Claude’s reasoning' : ''}{x.files?.length ? ` · ${x.files.slice(0, 3).join(', ')}` : ''}</span></div></div>))}</div>
  </section>);
}

// The project's tab: its folders, what the AIs remember from them, and a search scoped to it.
export function ProjectMemory({ p }) {
  const docs = useFetch(`/memory/docs?project=${p.id}`, ['memory']);
  const [doc, setDoc] = useState(null);
  return (<div className="col" style={sx("gap:20px;padding-top:12px;max-width:900px")}>
    <div className="note">{p.folders?.length ? <>AI memory from <b>{p.folders.join(', ')}</b> belongs to {p.name}.</> : <>Add the folders {p.name} lives in (project settings → Folders) so your AIs’ sessions there count as its memory. Asking still searches everything.</>}</div>
    <Ask project={p}  />
    <ChatsSay p={p} />
    <section className="col" style={sx("gap:8px")}><h2>From this project’s folders</h2>
      {!docs.data ? (<Loading h={120}  />) : !docs.data.length ? (<p className="small muted">Nothing mapped yet.</p>)
      : (<div className="card list-rows">{docs.data.map((d, ki) => (<button key={d?.id ?? ki} className="lrow" style={sx("width:100%;border:0;background:none;text-align:left;cursor:pointer")} onClick={() => setDoc(d.id)}>
          <Icon n={ICON[d.adapter] || 'brain'}  /><span className="col grow" style={sx("gap:0")}><span className="small trunc">{d.title}</span><span className="tiny muted">{d.tool} · {KIND[d.kind] || d.kind} · {plural(d.chunks, 'passage')}</span></span><span className="tiny muted">{when(d.ts)}</span></button>))}</div>)}
    </section>
    {doc && (<DocView id={doc} onClose={() => setDoc(null)}  />)}
  </div>);
}
