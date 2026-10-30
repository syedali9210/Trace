// Settings: sources and scopes, routing, AI memory, MCP tokens, the AI (your AI Gateway key), members, privacy, engine.
import { useState, useEffect, api, useFetch, useMe, refreshMe, refreshAi, Header, Icon, ErrorBox, Loading, Seg, Dialog, Field, Menu, rel, stamp, plural, toast, fail, copy, TOOLS, Button, ph, Chip, sx, SwitchField, Check, FluidList, FluidItem } from '../lib.jsx';
import { Slider } from '@/components/ui/slider';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { AddLink } from './dialogs.jsx';

const TABS = [['sources', 'Sources', 'plugs-connected'], ['routing', 'Routing', 'arrows-split'], ['memory', 'AI memory', 'brain'], ['mcp', 'MCP & agents', 'terminal-window'], ['ai', 'AI', 'chat-teardrop-dots'], ['members', 'Members', 'users'], ['privacy', 'Privacy & data', 'shield-check'], ['engine', 'Engine', 'gauge']];

export function Settings({ tab }) {
  const me = useMe();
  return <><Header><b>Settings</b><span className="hd-sub">{TABS.find(([id]) => id === tab)?.[1]}</span></Header>
    <div className="content"><div className="settings">
      <FluidList as="nav" aria-label="Settings sections">{TABS.map(([id, label, icon], i) => (<FluidItem as="a" key={id} index={i} className="snav" href={id === 'memory' ? '#/memory' : `#/settings/${id}`} aria-current={tab === id ? 'page' : undefined}><Icon n={icon} />{label}</FluidItem>))}</FluidList>
      <div className="col" style={sx("gap:24px;min-width:0")}>
        {me && me.user.role !== 'owner' && !['sources', 'engine'].includes(tab) && (<div className="note">Only the workspace owner can change these.</div>)}
        {tab === 'sources' && (<Sources  />)}
        {tab === 'routing' && (<Routing  />)}
        {tab === 'mcp' && (<Mcp  />)}
        {tab === 'ai' && (<Ai  />)}
        {tab === 'members' && (<Members  />)}
        {tab === 'privacy' && (<Privacy  />)}
        {tab === 'engine' && (<Engine  />)}
      </div>
    </div></div></>;
}

// ---------- the AI: Vercel's AI Gateway with the person's own key ----------
function Ai() {
  const { data, error, reload } = useFetch('/ai');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(null);
  const [test, setTest] = useState(null);
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (!data) return (<Loading  />);
  const save = (body) => api('/ai', { method: 'PUT', body }).then(() => { reload(); refreshAi(); });
  const check = async () => { setTest({ busy: true }); try { setTest(await api('/ai/test', { method: 'POST' })); } catch (e) { setTest({ error: e.message }); } };
  const addKey = async (e) => { e.preventDefault(); try { await save({ key }); setKey(''); toast('Key saved'); check(); } catch (er) { fail(er); } };
  return (<section className="section"><h1>AI</h1>
    <p className="small muted">It runs on Vercel’s AI Gateway with your key, through the same tools your agents use over MCP. Nothing is sent anywhere until you add one. With a key, it:</p>
    <ul className="ai-uses small"><li><b>Ask</b> (beside the + at the bottom, or Ctrl J): answers from every project, its folders and code, and your AIs’ memory, aware of the page you’re on</li><li><b>Where it stands</b>: keeps each project’s summary in sync with its work, folders and agent sessions</li><li><b>Find the why</b> on a change, from the AI sessions and comments around it</li><li><b>Draft open answers</b> in the case study, from their evidence</li><li><b>Suggest tasks</b> from open reviews, on the to-do board</li><li><b>Find insights</b> between a project’s blocks on the canvas</li><li><b>Draft the brief</b> from the project’s docs and work</li></ul>
    <div className="ai-state"><span className={`dot ${data.ready ? 'on' : ''}`}></span><b className="small">{data.ready ? `Connected · key ${data.hint}${data.from_env ? ' (from AI_GATEWAY_API_KEY)' : ''}` : 'Not connected yet'}</b><span className="grow"></span>{data.ready && (<Button variant="tertiary" size="compact" onClick={check} aria-disabled={test?.busy}>{test?.busy ? 'Testing…' : 'Test the connection'}</Button>)}</div>
    {test && !test.busy && (<div className={test.error ? 'errbox small' : 'note small'} role="status">{test.error || `Answered “${test.reply}” in ${(test.ms / 1000).toFixed(1)}s from ${test.model}.`}</div>)}
    <form className="col" onSubmit={addKey}>
      <Field label="Vercel AI Gateway API key" hint="vercel.com → AI Gateway → API keys. Stored encrypted on this computer, apart from your data. Free keys get new credits every 30 days."><div className="row"><Input className="grow" type="password" autoComplete="off" spellCheck="false" aria-label="API key" placeholder={data.hint && !data.from_env ? `Replace the key (${data.hint})` : 'Paste the key'} value={key} onChange={(e) => setKey(e.target.value)} /><Button variant="primary" size="compact" disabled={!key.trim()}>Save the key</Button></div></Field>
    </form>
    {data.hint && !data.from_env && (<Button variant="ghost" size="compact" style={sx("align-self:flex-start")} onClick={() => save({ key: '' }).then(() => toast('Key removed. The AI features are off.')).catch(fail)}>Remove the key</Button>)}
    <Field label="Model" hint={`Any model on the AI Gateway, as provider/model. Default: ${data.default_model} (free).`}><div className="row"><Input className="mono grow" value={model ?? data.model} onChange={(e) => setModel(e.target.value)} aria-label="Model" spellCheck="false" /><Button variant="tertiary" size="compact" disabled={model == null || model === data.model} onClick={() => save({ model }).then(() => { setModel(null); toast('Model changed'); }).catch(fail)}>Use it</Button></div></Field>
    <SwitchField label="Keep projects in sync" hint={"Every 10 minutes, Trace sorts each project’s new AI chats (personal asks like “shorten this message” are filed out, the rest noted with what they were about and the change they led to), then refreshes its “Where it stands”."} checked={data.sync} onChange={(e) => save({ sync: e.target.checked }).catch(fail)} />
    {data.sorted?.kept + data.sorted?.out > 0 && (<p className="small muted">Sorted so far: {plural(data.sorted.kept, 'chat')} about your projects, {data.sorted.out} filed out. Bring one back from the end of a project’s journey.</p>)}
    <p className="tiny muted">The model’s provider may keep prompts to improve it. Trace never reads secrets (.env files, keys), and treats text from your files and tools as data, never as instructions. A file the AI wants to write waits for you to approve it.</p>
  </section>);
}

// ---------- sources ----------
function ConnectForm({ tool, projects, onClose, onDone }) {
  const [f, setF] = useState({ import: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const s = await api('/sources', { method: 'POST', body: { tool, ...f } }); toast(`Connected ${s.name}. Trace is capturing.`); onDone(); onClose(); } catch (er) { setErr(er.message); setBusy(false); }
  };
  const t = TOOLS[tool];
  return (<Dialog title={`Connect ${t.label}`} onClose={onClose} footer={<><Button variant="ghost" size="default" onClick={onClose}>Cancel</Button><Button variant="primary" size="default" onClick={submit} aria-disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</Button></>}>
    <form className="col" style={sx("gap:16px")} onSubmit={submit}>
      {err && (<div className="errbox" role="alert">{err}</div>)}
      {tool === 'figma' && <><Field label="Figma personal access token" hint="Figma → Settings → Security → Personal access tokens. Give it read access to files and comments. It’s stored encrypted, apart from your data, and wiped when you disconnect."><Input type="password" autoComplete="off" spellCheck="false" value={f.token || ''} onChange={set('token')} /></Field>
        <Field label="Files to watch" hint="Paste Figma file links, one per line. Only these are read."><Textarea rows="3" value={f.files || ''} onChange={set('files')} placeholder="https://www.figma.com/design/…"></Textarea></Field>
        <Field label="Teams (optional)" hint="Team links or IDs: every file in the team is watched."><Input value={f.teams || ''} onChange={set('teams')} /></Field></>}
      {tool === 'github' && <><label className="check"><Check checked={!!f.use_cli} onChange={set('use_cli')}  />Use my GitHub CLI login on this computer (gh auth token)</label>
        {!f.use_cli && (<Field label="GitHub token" hint="github.com → Settings → Developer settings → Fine-grained tokens: read access to contents, pull requests and issues on the repos below."><Input type="password" autoComplete="off" spellCheck="false" value={f.token || ''} onChange={set('token')} /></Field>)}
        <Field label="Repositories" hint="owner/name, one per line"><Textarea className="mono" rows="3" value={f.repos || ''} onChange={set('repos')}></Textarea></Field></>}
      {tool === 'folder' && <><Field label="Folder" hint={"The full path on this computer, e.g. C:\\\\Users\\\\you\\\\Designs. Trace notices every save inside it (screenshots, exports, .ai, .psd, .riv, .sketch, video)."}><Input className="mono" value={f.path || ''} onChange={set('path')} spellCheck="false" /></Field>
        <label className="check"><Check checked={f.import} onChange={set('import')}  />Bring in the files already there (as one moment, up to 300 files)</label></>}
      <Field label="Map to a project (optional)" hint="Everything from this source goes there. Leave empty and Trace files work by itself, asking when it isn’t sure."><NativeSelect value={f.project_id || ''} onChange={set('project_id')}><NativeSelectOption value="">Let Trace decide</NativeSelectOption>{projects.map((p, ki) => (<NativeSelectOption key={p?.id ?? ki} value={p.id}>{p.name}</NativeSelectOption>))}</NativeSelect></Field>
    </form>
  </Dialog>);
}

function SourceRow({ s, projects, reload }) {
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const builtin = ['upload', 'agent', 'link', 'demo'].includes(s.tool);
  const patch = (body, msg) => api(`/sources/${s.id}`, { method: 'PATCH', body }).then(() => { msg && toast(msg); reload(); }).catch(fail);
  const sync = () => api(`/sources/${s.id}/sync`, { method: 'POST' }).then((r) => { toast(r.error ? `Sync failed: ${r.error}` : 'Synced'); reload(); }).catch(fail);
  const health = () => api(`/sources/${s.id}/health`).then((h) => toast(`${h.ok ? 'Healthy' : 'Problem'}: ${h.detail || ''}`, { error: !h.ok })).catch(fail);
  const loadScopes = () => api(`/sources/${s.id}/scopes`).then(setScopes).catch(fail);
  const rules = s.mapping_rules?.paths || [];
  const state = s.status !== 'active' ? ['warn', 'Paused'] : s.error ? ['err', 'Error'] : ['on', 'Active'];
  return (<div className={`card src k-${s.tool}`}>
    <span className="ico"><Icon n={TOOLS[s.tool]?.icon || 'plug'}  /></span>
    <div className="col" style={sx("gap:4px")}>
      <div className="row wrap" style={sx("gap:8px")}><b>{s.name}</b><span className="row tiny muted" style={sx("gap:4px")}><span className={`dot ${state[0]}`}></span>{state[1]}</span>{s.token_hint && (<span className="tiny muted mono">token {s.token_hint}</span>)}</div>
      <span className="small muted">{s.events_24h} events today · {s.events} total{s.last_sync ? ` · synced ${rel(s.last_sync)}` : ''}{s.health?.rate?.limit ? ` · API ${s.health.rate.remaining}/${s.health.rate.limit} left` : ''}{s.cursor?.backoff_until > Date.now() ? ` · backing off until ${stamp(s.cursor.backoff_until)}` : ''}</span>
      {s.error && (<span className="small" style={sx("color:var(--danger)")}>{s.error}</span>)}
      {s.tool === 'folder' && (<code className="tiny muted">{s.scope.path}</code>)}
      {s.tool === 'figma' && (<span className="tiny muted">{plural((s.scope.files || []).length, 'file')}{s.scope.teams?.length ? ` · ${plural(s.scope.teams.length, 'team')}` : ''}</span>)}
      {s.tool === 'github' && (<span className="tiny muted">{(s.scope.repos || []).join(', ') || 'No repositories yet'}</span>)}
      {open && (<div className="col" style={sx("gap:12px;margin-top:8px")}>
        <div className="form-grid">
          <Field label="Project" hint="Explicit mapping: confidence 1.0"><NativeSelect className="sm" value={s.project_id || ''} onChange={(e) => patch({ project_id: e.target.value || null }, 'Mapping saved')}><NativeSelectOption value="">Let Trace decide</NativeSelectOption>{projects.map((p, ki) => (<NativeSelectOption key={p?.id ?? ki} value={p.id}>{p.name}</NativeSelectOption>))}</NativeSelect></Field>
          <SwitchField label="Auto-accept" hint={"Skip the inbox when Trace is sure ({s.accept_streak || 0} accepted in a row without edits)."} checked={!!s.auto_accept} onChange={(e) => patch({ auto_accept: e.target.checked ? 1 : 0 }, e.target.checked ? 'Auto-accept on' : 'Auto-accept off')} />
        </div>
        {s.tool === 'folder' && (<div className="col" style={sx("gap:6px")}><span className="tiny muted">Subfolders mapped to projects</span>
          {rules.map((r, i) => (<div key={r?.id ?? i} className="row small"><code className="grow">{r.prefix}</code><span>→ {projects.find((p) => p.id === r.project_id)?.name || 'deleted project'}</span><Button variant="ghost" size="compact" onClick={() => patch({ mapping_rules: { ...s.mapping_rules, paths: rules.filter((_, j) => j !== i) } })}>Remove</Button></div>))}
          {scopes ? (<FolderRule scopes={scopes} projects={projects} onAdd={(r) => patch({ mapping_rules: { ...s.mapping_rules, paths: [...rules, r] } }, 'Folder mapped')}  />) : (<Button variant="tertiary" size="compact" style={sx("align-self:flex-start")} onClick={loadScopes}>Map a subfolder…</Button>)}</div>)}
        {s.tool === 'figma' && (<Field label="Watched files" hint="Links or keys, one per line"><Textarea className="sm mono" rows="3" defaultValue={(s.scope.files || []).join('\n')} onChange={(e) => patch({ scope: { files: e.target.value.split(/\s+/).map((x) => x.match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/)?.[1] || x).filter(Boolean) } }, 'Scope saved')}></Textarea></Field>)}
        {s.tool === 'github' && (<div className="col"><Field label="Repositories" hint="owner/name, one per line"><Textarea className="sm mono" rows="3" defaultValue={(s.scope.repos || []).join('\n')} onChange={(e) => patch({ scope: { repos: e.target.value.split(/\s+/).filter(Boolean) } }, 'Scope saved')}></Textarea></Field>
          {scopes ? (<div className="row wrap" style={sx("gap:4px")}>{scopes.slice(0, 30).map((r, ki) => (<button key={r?.id ?? ki} className="chip" style={sx("cursor:pointer")} onClick={() => !s.scope.repos?.includes(r.id) && patch({ scope: { repos: [...(s.scope.repos || []), r.id] } }, `Watching ${r.id}`)}>{r.name}</button>))}</div>) : (<Button variant="tertiary" size="compact" style={sx("align-self:flex-start")} onClick={loadScopes}>Pick from my repositories…</Button>)}</div>)}
      </div>)}
    </div>
    <div className="row" style={sx("gap:4px")}>
      {!builtin || s.tool === 'link' ? (<Button variant="tertiary" size="compact" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Done' : 'Manage'}</Button>) : ''}
      <Menu label={`${s.name} actions`} items={[
        s.tool !== 'upload' && s.tool !== 'agent' && { label: 'Sync now', icon: 'arrows-clockwise', onClick: sync },
        { label: s.status === 'active' ? 'Pause capture' : 'Resume capture', icon: s.status === 'active' ? 'pause' : 'play', onClick: () => patch({ status: s.status === 'active' ? 'paused' : 'active' }, s.status === 'active' ? 'Paused' : 'Resumed') },
        !builtin && { label: 'Check health', icon: 'heartbeat', onClick: health },
        !builtin && '-', !builtin && { label: 'Disconnect', icon: 'plugs', danger: true, onClick: () => setConfirm(true) }]}  />
    </div>
    {confirm && (<Dialog title={`Disconnect ${s.name}?`} onClose={() => setConfirm(false)} footer={<><Button variant="ghost" size="default" onClick={() => setConfirm(false)}>Keep it</Button><Button variant="primary" size="default" onClick={() => api(`/sources/${s.id}`, { method: 'DELETE' }).then(() => { toast(`Disconnected ${s.name}; its token is deleted.`); reload(); }).catch(fail)}>Disconnect</Button></>}>
      <p>Capture stops at once and the stored token is deleted. Everything already captured stays in your projects.</p></Dialog>)}
  </div>);
}
function FolderRule({ scopes, projects, onAdd }) {
  const [r, setR] = useState({ prefix: scopes[0]?.id || '', project_id: projects[0]?.id || '' });
  return (<div className="row"><NativeSelect className="sm" value={r.prefix} onChange={(e) => setR({ ...r, prefix: e.target.value })} aria-label="Subfolder">{scopes.map((s, ki) => (<NativeSelectOption key={s?.id ?? ki} value={s.id}>{s.name}/</NativeSelectOption>))}</NativeSelect><span>→</span>
    <NativeSelect className="sm" value={r.project_id} onChange={(e) => setR({ ...r, project_id: e.target.value })} aria-label="Project">{projects.map((p, ki) => (<NativeSelectOption key={p?.id ?? ki} value={p.id}>{p.name}</NativeSelectOption>))}</NativeSelect><Button variant="tertiary" size="compact" onClick={() => r.prefix && r.project_id && onAdd(r)}>Map</Button></div>);
}

function Sources() {
  const { data, error, reload } = useFetch('/sources', ['source', 'capture']);
  const [connect, setConnect] = useState(null);
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (!data) return (<Loading h={300}  />);
  return <><section className="section"><header><h1 className="grow">Sources</h1></header>
      <p className="small muted">Connect a tool once and Trace captures in the background. Only the files, repos and folders you pick are read. Pause anything with one click.</p>
      <div className="connect-grid">{data.catalog.map((c, ki) => (<div key={c?.id ?? ki} className={`card src k-${c.tool}`} style={sx("grid-template-columns:auto 1fr")}>
        <span className="ico"><Icon n={TOOLS[c.tool]?.icon}  /></span>
        <div className="col" style={sx("gap:4px")}><b>{c.label}</b><span className="tiny muted">{c.how}</span><span className="tiny">{c.gets}</span><span className="tiny muted">Fidelity: {c.fidelity}</span>
          {['figma', 'github', 'folder'].includes(c.tool) && (<Button variant="tertiary" size="compact" style={sx("align-self:flex-start;margin-top:4px")} onClick={() => setConnect(c.tool)}>Connect</Button>)}
          {c.tool === 'link' && (<Button variant="tertiary" size="compact" style={sx("align-self:flex-start;margin-top:4px")} onClick={() => setConnect('link')}>Add a link</Button>)}
          {c.tool === 'agent' && (<Button variant="tertiary" size="compact" style={sx("align-self:flex-start;margin-top:4px")} render={<a href="#/settings/mcp" />}>Get a token</Button>)}
          {c.tool === 'upload' && (<span className="tiny muted" style={sx("margin-top:4px")}>Always on: drop or paste anywhere.</span>)}
        </div></div>))}</div>
    </section>
    <section className="section"><header><h2 className="grow">Connected</h2></header>
      <div className="col">{data.sources.filter((s) => s.tool !== 'aimem').map((s) => (<SourceRow s={s} projects={data.projects} reload={reload} key={s.id}  />))}</div>
    </section>
    {connect === 'link' && (<AddLink onClose={() => setConnect(null)}  />)}
    {connect && connect !== 'link' && (<ConnectForm tool={connect} projects={data.projects} onClose={() => setConnect(null)} onDone={() => { reload(); refreshMe(); }}  />)}</>;
}

// ---------- routing ----------
function Routing() {
  const { data, error, reload } = useFetch('/settings');
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (!data) return (<Loading  />);
  const s = data.settings;
  const save = (body) => api('/settings', { method: 'PATCH', body }).then(reload).catch(fail);
  const owner = data.role === 'owner';
  return <><section className="section"><h1>Routing</h1>
      <p className="small muted">How Trace decides where work belongs: your mappings first, then rules it learned from your corrections, links between files, look-alike work, and an AI tie-break when two projects are close.</p>
      <div className="form-grid">
        <Field label={`File directly at ${Math.round(s.file_threshold * 100)}% sure`} hint="Above this, moments go straight into their project (still shown in the inbox as filed). Trace nudges it up when you move filed work."><Slider variant="scrubber" label="Sure" min={0.6} max={0.97} step={0.01} value={s.file_threshold} formatValue={(v) => `${Math.round(v * 100)}%`} disabled={!owner} onChange={(v) => save({ file_threshold: v })} /></Field>
        <Field label={`Guess from ${Math.round(s.inbox_threshold * 100)}% sure`} hint="Below this, moments go to Unsorted instead of showing a guess."><Slider variant="scrubber" label="Sure" min={0.2} max={0.8} step={0.01} value={s.inbox_threshold} formatValue={(v) => `${Math.round(v * 100)}%`} disabled={!owner} onChange={(v) => save({ inbox_threshold: v })} /></Field>
        <Field label="A session ends after" hint="Minutes without activity before a moment closes on its own."><NativeSelect value={s.session_gap_min} disabled={!owner} onChange={(e) => save({ session_gap_min: +e.target.value })}>{[5, 10, 20, 30, 45, 60, 120].map((m, ki) => (<NativeSelectOption key={m?.id ?? ki} value={m}>{m} minutes</NativeSelectOption>))}</NativeSelect></Field>
      </div>
    </section>
    <section className="section"><h2>Learned from your corrections</h2>
      {data.rules.length ? (<Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>File into</TableHead><TableHead className="num">Times used</TableHead><TableHead></TableHead></TableRow></TableHeader><TableBody>{data.rules.map((r, i) => (<TableRow key={i} index={i}><TableCell><code>{r.pattern.replace(/^name:/, 'name starts with ').replace(/^path:/, 'in folder ')}</code></TableCell><TableCell>{r.project_name || '—'}</TableCell><TableCell className="num">{r.hits}</TableCell><TableCell>{owner && (<Button variant="ghost" size="compact" onClick={() => api(`/rules/${r.id}`, { method: 'DELETE' }).then(reload).catch(fail)}>Forget</Button>)}</TableCell></TableRow>))}</TableBody></Table>)
        : (<p className="small muted">Nothing yet. Each time you move or confirm a moment in the inbox, Trace learns a rule and files that kind of work itself next time.</p>)}
    </section>
    <section className="section"><h2>Muted</h2>
      {s.mute?.length ? (<div className="col">{s.mute.map((m, i) => (<div key={m?.id ?? i} className="row small"><code className="grow">{m.type}</code><span className="muted">from a source</span>{owner && (<Button variant="ghost" size="compact" onClick={() => save({ mute: s.mute.filter((_, j) => j !== i) })}>Unmute</Button>)}</div>))}</div>) : (<p className="small muted">Nothing muted. “Mute this kind” in the inbox hides an event type from a source.</p>)}
    </section></>;
}

// ---------- MCP ----------
// The skill a coding agent uses in any project folder: one word ("trace") and Trace assembles that project.
function SkillCard() {
  const { data, reload } = useFetch('/skill');
  const [open, setOpen] = useState(false);
  const install = () => api('/skill/install', { method: 'POST' }).then((r) => { toast(`Installed: ${r.path}`); reload(); }).catch(fail);
  if (!data) return null;
  return (<section className="panel col skillcard" style={sx("gap:10px")}>
    <div className="row"><span className="src-ico"><Icon n="magic-wand"  /></span><div className="col grow" style={sx("gap:2px")}><b>The Trace skill for coding agents</b><span className="small muted">In any project folder, ask Claude Code to “use trace” (or “assemble the case study”). It points Trace at that folder (project, capture, AI memory, the reasoning script) and answers the case-study questions only it knows.</span></div>
      {data.installed ? (<Chip tone="ok"><Icon n="check"  />Installed</Chip>) : (<Button variant="primary" size="compact" onClick={install}>Install for Claude Code</Button>)}</div>
    <span className="tiny muted">{data.installed ? 'At' : 'Goes to'} {data.path}. Other agents (Codex, Cursor) can run the same command:</span>
    <div className="secret"><span className="grow">{data.cli}</span><Button variant="tertiary" size="compact" onClick={() => copy(data.cli, 'Command copied')}>Copy</Button></div>
    <button className="cs-ev-t" aria-expanded={open} onClick={() => setOpen(!open)}><Icon n={open ? 'caret-down' : 'caret-right'} swap  />What the skill tells the agent</button>
    {open && (<pre className="code script">{data.text}</pre>)}
  </section>);
}

function Mcp() {
  const me = useMe();
  const { data, error, reload } = useFetch('/mcp-tokens');
  const [f, setF] = useState({ name: 'Claude Code', write: false, projects: new Set() });
  const [made, setMade] = useState(null);
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (!data) return (<Loading  />);
  const create = async (e) => { e.preventDefault(); try { setMade(await api('/mcp-tokens', { method: 'POST', body: { name: f.name, write: f.write, project_ids: [...f.projects] } })); reload(); } catch (er) { fail(er); } };
  return <><section className="section"><h1>MCP & agents</h1>
      <p className="small muted">Your agents call Trace when they need context; Trace doesn’t push anything at them. Any MCP client (Claude Code, Claude, Cursor) can read the design memory (context packs, latest screens with images, what changed, references, decisions, tokens, open comments), use <code>recall</code> to search what your other AIs remember, and leave notes for the next agent with <code>remember</code>. Tokens are read-only unless you grant writes; every call is in the log below. Captured text and quoted AI memory are marked as data for agents.</p>
      <div className="secret"><span className="grow">{data.url}</span><Button variant="tertiary" size="compact" onClick={() => copy(data.url, 'Endpoint copied')}>Copy</Button></div>
    </section>
    <SkillCard  />
    {made && (<section className="panel col" style={sx("gap:12px;border-color:var(--sel-line)")}>
      <b>Copy this token now: it won’t be shown again.</b>
      <div className="secret"><span className="grow">{made.token}</span><Button variant="tertiary" size="compact" onClick={() => copy(made.token, 'Token copied')}>Copy</Button></div>
      <span className="small">Claude Code:</span><div className="secret"><span className="grow">{made.claude_code}</span><Button variant="tertiary" size="compact" onClick={() => copy(made.claude_code, 'Command copied')}>Copy</Button></div>
      <span className="small">Other clients (JSON config):</span><pre className="code">{JSON.stringify(made.json, null, 2)}</pre>
      <span className="small">Clients that only speak stdio:</span><div className="secret"><span className="grow">{made.stdio}</span><Button variant="tertiary" size="compact" onClick={() => copy(made.stdio)}>Copy</Button></div>
      <p className="small muted">Then ask your agent: “What changed in the checkout design this week?” or use the prompts “Build this screen from the latest design” and “Review my implementation against the design”.</p>
    </section>)}
    <section className="section"><h2>New token</h2>
      <form className="panel col" style={sx("gap:12px")} onSubmit={create}>
        <div className="form-grid"><Field label="Name" hint="Who uses it, e.g. Claude Code on my laptop"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <SwitchField label="Allow writes" hint={"Post comments, add artifacts and moments, update issues. Writes land as drafts."} checked={f.write} onChange={(e) => setF({ ...f, write: e.target.checked })} /></div>
        <div className="col" style={sx("gap:4px")}><span className="small" style={sx("font-weight:500")}>Projects</span><span className="tiny muted">None ticked = all projects.</span>
          <div className="row wrap">{me?.projects.map((p, ki) => (<label key={p?.id ?? ki} className="check small"><Check checked={f.projects.has(p.id)} onChange={() => { const s = new Set(f.projects); s.has(p.id) ? s.delete(p.id) : s.add(p.id); setF({ ...f, projects: s }); }}  />{p.name}</label>))}</div></div>
        <div className="row"><Button variant="primary" size="default">Create token</Button></div>
      </form>
    </section>
    <section className="section"><h2>Tokens</h2>
      {data.tokens.length ? (<Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Access</TableHead><TableHead>Projects</TableHead><TableHead>Last used</TableHead><TableHead></TableHead></TableRow></TableHeader><TableBody>{data.tokens.map((t, i) => (<TableRow key={i} index={i} className={t.revoked ? 'opacity-50' : undefined}><TableCell>{t.name} <code className="muted">{t.hint}</code></TableCell><TableCell>{t.scopes.includes('write') ? 'Read + write' : 'Read only'}</TableCell><TableCell className="small">{t.project_ids ? plural(t.project_ids.length, 'project') : 'All'}</TableCell><TableCell className="small muted">{t.last_used ? rel(t.last_used) : 'Never'}</TableCell><TableCell>{t.revoked ? (<Chip>Revoked</Chip>) : (<Button variant="ghost" size="compact" className="text-destructive" onClick={() => api(`/mcp-tokens/${t.id}`, { method: 'DELETE' }).then(() => { toast('Revoked'); reload(); }).catch(fail)}>Revoke</Button>)}</TableCell></TableRow>))}</TableBody></Table>) : (<p className="small muted">No tokens yet.</p>)}
    </section>
    <section className="section"><h2>Agent activity</h2>
      {data.reads.length ? (<Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Token</TableHead><TableHead>Call</TableHead><TableHead>Client</TableHead></TableRow></TableHeader><TableBody>{data.reads.map((r, i) => (<TableRow key={i} index={i}><TableCell className="small muted">{stamp(r.ts)}</TableCell><TableCell className="small">{r.actor}</TableCell><TableCell><code>{r.target}</code> <span className="tiny muted">{r.action.replace('mcp.', '')}</span></TableCell><TableCell className="small muted">{r.detail?.client?.name || r.detail?.client || ''}</TableCell></TableRow>))}</TableBody></Table>) : (<p className="small muted">No agent has called Trace yet.</p>)}
    </section></>;
}

// ---------- members ----------
function Members() {
  const { data, error, reload } = useFetch('/members');
  const settings = useFetch('/settings');
  const [f, setF] = useState({ role: 'editor' });
  const [made, setMade] = useState(null);
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (!data || !settings.data) return (<Loading  />);
  const mode = settings.data.workspace.mode;
  const invite = async (e) => { e.preventDefault(); try { setMade(await api('/members', { method: 'POST', body: f })); setF({ role: 'editor' }); reload(); settings.reload(); } catch (er) { fail(er); } };
  return <><section className="section"><h1>Members</h1>
      <div className="row"><Seg label="Workspace mode" value={mode} onChange={(v) => api('/settings', { method: 'PATCH', body: { mode: v } }).then(() => { settings.reload(); refreshMe(); toast(v === 'team' ? 'Team mode: roles, reviews and guests. History is kept.' : 'Solo mode'); }).catch(fail)} options={[{ value: 'solo', label: 'Solo' }, { value: 'team', label: 'Team' }]}  /></div>
      <p className="small muted">{mode === 'solo' ? 'Solo: private, no review gates. Switching to team keeps everything.' : 'Team: owner, editor, reviewer, viewer and guest client roles; per-project roles in project settings. Teammates on your network open their invite link (start Trace with TRACE_HOST=0.0.0.0 to share it).'}</p>
    </section>
    <section className="section"><h2>Invite</h2>
      <form className="panel col" style={sx("gap:12px")} onSubmit={invite}>
        <div className="form-grid"><Field label="Name"><Input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
          <Field label="Email (optional)"><Input type="email" value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" spellCheck="false" autoCapitalize="none" /></Field>
          <Field label="Role"><NativeSelect value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><NativeSelectOption value="editor">Editor: everything but settings</NativeSelectOption><NativeSelectOption value="reviewer">Reviewer: comment and review</NativeSelectOption><NativeSelectOption value="viewer">Viewer: read only</NativeSelectOption></NativeSelect></Field></div>
        <div className="row"><Button variant="primary" size="default">Create invite link</Button></div>
      </form>
      {made && (<div className="col"><span className="small">Send {made.name} this link (it signs them in on this Trace):</span><div className="secret"><span className="grow">{made.invite}</span><Button variant="tertiary" size="compact" onClick={() => copy(made.invite, 'Invite link copied')}>Copy</Button></div></div>)}
    </section>
    <section className="section"><h2>People</h2>
      <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead></TableHead></TableRow></TableHeader><TableBody>{data.members.map((m, i) => (<TableRow key={i} index={i}><TableCell>{m.name}{m.email && (<span className="muted small">{m.email}</span>)}</TableCell>
        <TableCell>{m.role === 'owner' ? 'Owner' : (<NativeSelect className="sm" style={sx("width:auto")} value={m.role} aria-label={`Role for ${m.name}`} onChange={(e) => api(`/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }).then(reload).catch(fail)}><NativeSelectOption value="editor">Editor</NativeSelectOption><NativeSelectOption value="reviewer">Reviewer</NativeSelectOption><NativeSelectOption value="viewer">Viewer</NativeSelectOption></NativeSelect>)}</TableCell>
        <TableCell className="row" style={sx("justify-content:flex-end")}>{m.invite && <><Button variant="ghost" size="compact" onClick={() => copy(m.invite, 'Invite link copied')}>Copy invite</Button><Button variant="ghost" size="compact" className="text-destructive" onClick={() => api(`/members/${m.id}`, { method: 'DELETE' }).then(reload).catch(fail)}>Remove</Button></>}</TableCell></TableRow>))}</TableBody></Table>
    </section>
    <section className="section"><h2>Guest client links</h2>
      {data.guests.length ? (<Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead>For</TableHead><TableHead>Expires</TableHead><TableHead></TableHead></TableRow></TableHeader><TableBody>{data.guests.map((g, i) => (<TableRow key={i} index={i}><TableCell>{g.project_name}</TableCell><TableCell>{g.name}</TableCell><TableCell className="small muted">{stamp(g.expires_at)}</TableCell><TableCell className="row" style={sx("justify-content:flex-end")}>{g.link && (<Button variant="ghost" size="compact" onClick={() => copy(g.link, 'Guest link copied')}>Copy</Button>)}<Button variant="ghost" size="compact" className="text-destructive" onClick={() => api(`/guest-links/${g.token}`, { method: 'DELETE' }).then(reload).catch(fail)}>Revoke</Button></TableCell></TableRow>))}</TableBody></Table>)
        : (<p className="small muted">Make a view-and-comment link for a client from a project’s settings. Links expire.</p>)}
    </section>
    {data.people.length > 0 && (<section className="section"><h2>Seen in your tools</h2><p className="small muted">People and agents Trace met in Figma, GitHub and MCP, kept as external people until you invite them.</p><div className="row wrap">{data.people.map((p, ki) => (<Chip key={p?.id ?? ki}>{p.is_agent ? (<Icon n="sparkle"  />) : ''}{p.name}</Chip>))}</div></section>)}</>;
}

// ---------- privacy ----------
function Privacy() {
  const me = useMe();
  const settings = useFetch('/settings');
  const [confirm, setConfirm] = useState('');
  const [dnc, setDnc] = useState({});
  if (!settings.data) return (<Loading  />);
  const owner = settings.data.role === 'owner';
  const saveDnc = (p) => api(`/projects/${p.id}`, { method: 'PATCH', body: { do_not_capture: (dnc[p.id] ?? (p.do_not_capture || []).join('\n')).split('\n').map((x) => x.trim()).filter(Boolean) } }).then(() => toast('Saved')).catch(fail);
  return <><section className="section"><h1>Privacy & data</h1>
      <div className="panel col" style={sx("gap:8px")}>
        <div className="row"><span className={`dot ${me?.paused ? 'warn' : 'on'}`}></span><b className="grow">{me?.paused ? 'All capture is paused' : 'Capture is on'}</b><Button variant="tertiary" size="default" disabled={!owner} onClick={() => api('/settings', { method: 'PATCH', body: { paused: !me.paused } }).then(refreshMe).catch(fail)}>{me?.paused ? 'Resume capture' : 'Pause all capture'}</Button></div>
        <p className="small muted">Paused, Trace reads nothing from your tools or folders. Agents can still read what’s already here.</p>
      </div>
      <ul className="small" style={sx("margin:0;padding-left:18px;line-height:1.8;color:var(--ink-2)")}>
        <li>Only the files, repos and folders you pick are watched.</li>
        <li>Everything lives on this computer (<code>data/</code>). Tokens and API keys are AES-256 encrypted in a separate vault whose key is in your user profile, and wiped when you disconnect.</li>
        <li>Trace runs no AI of its own and sends nothing to any AI service. Your agents read from it when you use them.</li>
        <li>AI memory (your AIs’ sessions and memory files) is read on this computer when asked, with secrets removed first.</li>
        <li>Agents get read-only access unless you grant writes; every call is logged.</li>
      </ul>
    </section>
    <section className="section"><h2>Do-not-capture lists</h2>
      {settings.data.projects.map((p, ki) => (<Field key={p?.id ?? ki} label={p.name} hint="One pattern per line; * matches anything"><div className="row" style={sx("align-items:flex-start")}><Textarea className="mono" rows="2" value={dnc[p.id] ?? (p.do_not_capture || []).join('\n')} onChange={(e) => setDnc({ ...dnc, [p.id]: e.target.value })}></Textarea><Button variant="tertiary" size="compact" disabled={!owner} onClick={() => saveDnc(p)}>Save</Button></div></Field>))}
    </section>
    <section className="section"><h2>Export everything</h2>
      <p className="small muted">A zip with every record as JSON and every captured file. Tokens are never included.</p>
      <div className="row"><Button variant="tertiary" size="default" leadingIcon={ph("download-simple")} aria-disabled={!owner} render={<a href="/api/export" />}>Download export</Button></div>
    </section>
    {owner && (<section className="section"><h2>Delete the workspace</h2>
      <p className="small muted">Deletes every project, moment, file, comment, token and key, now. To delete one project, use its settings. Type “delete everything” to confirm.</p>
      <div className="row"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Type delete everything to confirm" /><Button variant="tertiary" size="default" className="text-destructive" aria-disabled={confirm !== 'delete everything'} onClick={() => confirm === 'delete everything' && api('/workspace', { method: 'DELETE', body: { confirm } }).then(() => { refreshMe(); location.hash = '#/onboarding'; }).catch(fail)}>Delete everything</Button></div>
    </section>)}</>;
}

// ---------- engine ----------
function Engine() {
  const { data, error, reload } = useFetch('/settings', ['moment', 'capture']);
  const audit = useFetch('/audit?limit=80');
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (!data) return (<Loading  />);
  const e = data.engine;
  const stages = ['normalize', 'snapshot', 'diff', 'cluster', 'route', 'describe', 'index'];
  const q = (st, status) => e.queue.find((x) => x.stage === st && x.status === status)?.n || 0;
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  return <><section className="section"><h1>Engine</h1>
      <div className="stats">
        <div className="stat"><span className="small muted">Raw events</span><b>{e.events.toLocaleString()}</b></div>
        <div className="stat"><span className="small muted">Moments</span><b>{e.moments.toLocaleString()}</b></div>
        <div className="stat"><span className="small muted">Events per moment</span><b>{e.noise_ratio ?? '—'}</b><span className="tiny muted">Goal: 20 or more</span></div>
        <div className="stat"><span className="small muted">Filed right first time</span><b>{pct(e.capture_accuracy)}</b><span className="tiny muted">Goal: 90%</span></div>
        <div className="stat"><span className="small muted">Accepted without edits</span><b>{pct(e.accepted_without_edit)}</b><span className="tiny muted">Goal: 75%</span></div>
      </div>
    </section>
    <section className="section"><h2>Pipeline</h2>
      <Table><TableHeader><TableRow><TableHead>Stage</TableHead><TableHead className="num">Waiting</TableHead><TableHead className="num">Running</TableHead><TableHead className="num">Done (24 h)</TableHead><TableHead className="num">Dead</TableHead></TableRow></TableHeader>
        <TableBody>{stages.map((s, i) => (<TableRow key={i} index={i}><TableCell>{s}</TableCell><TableCell className="num">{q(s, 'queued')}</TableCell><TableCell className="num">{q(s, 'running')}</TableCell><TableCell className="num">{q(s, 'done')}</TableCell><TableCell className="num" style={sx(q(s, 'dead') ? 'color:var(--danger)' : '')}>{q(s, 'dead')}</TableCell></TableRow>))}</TableBody></Table>
    </section>
    {e.dead.length > 0 && (<section className="section"><h2>Failed jobs</h2>{e.dead.map((j, ki) => (<div key={j?.id ?? ki} className="panel col" style={sx("gap:6px")}><div className="row"><b className="grow">{j.stage}</b><span className="tiny muted">{rel(j.updated_at)}</span><Button variant="tertiary" size="compact" onClick={() => api(`/jobs/${j.id}/retry`, { method: 'POST' }).then(() => { toast('Retrying'); reload(); }).catch(fail)}>Retry</Button></div><pre className="code" style={sx("max-height:140px")}>{j.error}</pre></div>))}</section>)}
    <section className="section"><h2>Audit log</h2>
      {audit.data ? (<Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>What</TableHead><TableHead>Target</TableHead></TableRow></TableHeader><TableBody>{audit.data.map((a, i) => (<TableRow key={i} index={i}><TableCell className="small muted">{stamp(a.ts)}</TableCell><TableCell className="small">{a.actor} <span className="tiny muted">{a.actor_type}</span></TableCell><TableCell><code>{a.action}</code></TableCell><TableCell className="small muted trunc" style={sx("max-width:260px")}>{a.target}</TableCell></TableRow>))}</TableBody></Table>) : audit.error ? (<p className="small muted">Only the owner can see the audit log.</p>) : (<Loading  />)}
    </section></>;
}
