// Settings: sources and scopes, routing, AI memory, MCP tokens, the AI (your AI Gateway key), members, privacy, engine.
import { html, useState, useEffect, api, useFetch, useMe, refreshMe, refreshAi, Header, Icon, ErrorBox, Loading, Seg, Dialog, Field, Menu, rel, stamp, plural, toast, fail, copy, TOOLS } from '../lib.js';
import { AddLink } from './dialogs.js';

const TABS = [['sources', 'Sources', 'plugs-connected'], ['routing', 'Routing', 'arrows-split'], ['memory', 'AI memory', 'brain'], ['mcp', 'MCP & agents', 'terminal-window'], ['ai', 'AI', 'chat-teardrop-dots'], ['members', 'Members', 'users'], ['privacy', 'Privacy & data', 'shield-check'], ['engine', 'Engine', 'gauge']];

export function Settings({ tab }) {
  const me = useMe();
  return html`<${Header}><b>Settings</b></${Header}>
    <div class="content"><div class="settings">
      <nav aria-label="Settings sections">${TABS.map(([id, label, icon]) => html`<a class="snav" href=${id === 'memory' ? '#/memory' : `#/settings/${id}`} aria-current=${tab === id ? 'page' : undefined}><${Icon} n=${icon} />${label}</a>`)}</nav>
      <div class="col" style="gap:24px;min-width:0">
        ${me && me.user.role !== 'owner' && !['sources', 'engine'].includes(tab) && html`<div class="note">Only the workspace owner can change these.</div>`}
        ${tab === 'sources' && html`<${Sources} />`}
        ${tab === 'routing' && html`<${Routing} />`}
        ${tab === 'mcp' && html`<${Mcp} />`}
        ${tab === 'ai' && html`<${Ai} />`}
        ${tab === 'members' && html`<${Members} />`}
        ${tab === 'privacy' && html`<${Privacy} />`}
        ${tab === 'engine' && html`<${Engine} />`}
      </div>
    </div></div>`;
}

// ---------- the AI: Vercel's AI Gateway with the person's own key ----------
function Ai() {
  const { data, error, reload } = useFetch('/ai');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(null);
  const [test, setTest] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const save = (body) => api('/ai', { method: 'PUT', body }).then(() => { reload(); refreshAi(); });
  const check = async () => { setTest({ busy: true }); try { setTest(await api('/ai/test', { method: 'POST' })); } catch (e) { setTest({ error: e.message }); } };
  const addKey = async (e) => { e.preventDefault(); try { await save({ key }); setKey(''); toast('Key saved'); check(); } catch (er) { fail(er); } };
  return html`<section class="section"><h1>AI</h1>
    <p class="small muted">It runs on Vercel’s AI Gateway with your key, through the same tools your agents use over MCP. Nothing is sent anywhere until you add one. With a key, it:</p>
    <ul class="ai-uses small"><li><b>Ask</b> (beside the + at the bottom, or Ctrl J): answers from every project, its folders and code, and your AIs’ memory, aware of the page you’re on</li><li><b>Where it stands</b>: keeps each project’s summary in sync with its work, folders and agent sessions</li><li><b>Find the why</b> on a change, from the AI sessions and comments around it</li><li><b>Draft open answers</b> in the case study, from their evidence</li><li><b>Suggest tasks</b> from open reviews, on the to-do board</li><li><b>Find insights</b> between a project’s blocks on the canvas</li><li><b>Draft the brief</b> from the project’s docs and work</li></ul>
    <div class="ai-state"><span class=${`dot ${data.ready ? 'on' : ''}`}></span><b class="small">${data.ready ? `Connected · key ${data.hint}${data.from_env ? ' (from AI_GATEWAY_API_KEY)' : ''}` : 'Not connected yet'}</b><span class="grow"></span>${data.ready && html`<button class="btn sm" onClick=${check} aria-disabled=${test?.busy}>${test?.busy ? 'Testing…' : 'Test the connection'}</button>`}</div>
    ${test && !test.busy && html`<div class=${test.error ? 'errbox small' : 'note small'} role="status">${test.error || `Answered “${test.reply}” in ${(test.ms / 1000).toFixed(1)}s from ${test.model}.`}</div>`}
    <form class="col" onSubmit=${addKey}>
      <${Field} label="Vercel AI Gateway API key" hint="vercel.com → AI Gateway → API keys. Stored encrypted on this computer, apart from your data. Free keys get new credits every 30 days."><div class="row"><input class="input grow" type="password" autocomplete="off" spellcheck="false" aria-label="API key" placeholder=${data.hint && !data.from_env ? `Replace the key (${data.hint})` : 'Paste the key'} value=${key} onInput=${(e) => setKey(e.target.value)} /><button class="btn primary sm" disabled=${!key.trim()}>Save the key</button></div></${Field}>
    </form>
    ${data.hint && !data.from_env && html`<button class="btn ghost sm" style="align-self:flex-start" onClick=${() => save({ key: '' }).then(() => toast('Key removed. The AI features are off.')).catch(fail)}>Remove the key</button>`}
    <${Field} label="Model" hint=${`Any model on the AI Gateway, as provider/model. Default: ${data.default_model} (free).`}><div class="row"><input class="input mono grow" value=${model ?? data.model} onInput=${(e) => setModel(e.target.value)} aria-label="Model" spellcheck="false" /><button class="btn sm" disabled=${model == null || model === data.model} onClick=${() => save({ model }).then(() => { setModel(null); toast('Model changed'); }).catch(fail)}>Use it</button></div></${Field}>
    <label class="field"><span>Keep projects in sync</span><small>Every 10 minutes, Trace sorts each project’s new AI chats (personal asks like “shorten this message” are filed out, the rest noted with what they were about and the change they led to), then refreshes its “Where it stands”.</small><input type="checkbox" class="switch" checked=${data.sync} onChange=${(e) => save({ sync: e.target.checked }).catch(fail)} /></label>
    ${data.sorted?.kept + data.sorted?.out > 0 && html`<p class="small muted">Sorted so far: ${plural(data.sorted.kept, 'chat')} about your projects, ${data.sorted.out} filed out. Bring one back from the end of a project’s journey.</p>`}
    <p class="tiny muted">The model’s provider may keep prompts to improve it. Trace never reads secrets (.env files, keys), and treats text from your files and tools as data, never as instructions. A file the AI wants to write waits for you to approve it.</p>
  </section>`;
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
  return html`<${Dialog} title=${`Connect ${t.label}`} onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${submit} aria-disabled=${busy}>${busy ? 'Connecting…' : 'Connect'}</button>`}>
    <form class="col" style="gap:16px" onSubmit=${submit}>
      ${err && html`<div class="errbox" role="alert">${err}</div>`}
      ${tool === 'figma' && html`
        <${Field} label="Figma personal access token" hint="Figma → Settings → Security → Personal access tokens. Give it read access to files and comments. It’s stored encrypted, apart from your data, and wiped when you disconnect."><input class="input" type="password" autocomplete="off" spellcheck="false" value=${f.token || ''} onInput=${set('token')} /></${Field}>
        <${Field} label="Files to watch" hint="Paste Figma file links, one per line. Only these are read."><textarea class="input" rows="3" value=${f.files || ''} onInput=${set('files')} placeholder="https://www.figma.com/design/…"></textarea></${Field}>
        <${Field} label="Teams (optional)" hint="Team links or IDs: every file in the team is watched."><input class="input" value=${f.teams || ''} onInput=${set('teams')} /></${Field}>`}
      ${tool === 'github' && html`
        <label class="check"><input type="checkbox" checked=${!!f.use_cli} onChange=${set('use_cli')} />Use my GitHub CLI login on this computer (gh auth token)</label>
        ${!f.use_cli && html`<${Field} label="GitHub token" hint="github.com → Settings → Developer settings → Fine-grained tokens: read access to contents, pull requests and issues on the repos below."><input class="input" type="password" autocomplete="off" spellcheck="false" value=${f.token || ''} onInput=${set('token')} /></${Field}>`}
        <${Field} label="Repositories" hint="owner/name, one per line"><textarea class="input mono" rows="3" value=${f.repos || ''} onInput=${set('repos')}></textarea></${Field}>`}
      ${tool === 'folder' && html`
        <${Field} label="Folder" hint="The full path on this computer, e.g. C:\\Users\\you\\Designs. Trace notices every save inside it (screenshots, exports, .ai, .psd, .riv, .sketch, video)."><input class="input mono" value=${f.path || ''} onInput=${set('path')} spellcheck="false" /></${Field}>
        <label class="check"><input type="checkbox" checked=${f.import} onChange=${set('import')} />Bring in the files already there (as one moment, up to 300 files)</label>`}
      <${Field} label="Map to a project (optional)" hint="Everything from this source goes there. Leave empty and Trace files work by itself, asking when it isn’t sure."><select class="input" value=${f.project_id || ''} onChange=${set('project_id')}><option value="">Let Trace decide</option>${projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select></${Field}>
    </form>
  </${Dialog}>`;
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
  return html`<div class=${`card src k-${s.tool}`}>
    <span class="ico"><${Icon} n=${TOOLS[s.tool]?.icon || 'plug'} /></span>
    <div class="col" style="gap:4px">
      <div class="row wrap" style="gap:8px"><b>${s.name}</b><span class="row tiny muted" style="gap:4px"><span class=${`dot ${state[0]}`}></span>${state[1]}</span>${s.token_hint && html`<span class="tiny muted mono">token ${s.token_hint}</span>`}</div>
      <span class="small muted">${s.events_24h} events today · ${s.events} total${s.last_sync ? ` · synced ${rel(s.last_sync)}` : ''}${s.health?.rate?.limit ? ` · API ${s.health.rate.remaining}/${s.health.rate.limit} left` : ''}${s.cursor?.backoff_until > Date.now() ? ` · backing off until ${stamp(s.cursor.backoff_until)}` : ''}</span>
      ${s.error && html`<span class="small" style="color:var(--danger)">${s.error}</span>`}
      ${s.tool === 'folder' && html`<code class="tiny muted">${s.scope.path}</code>`}
      ${s.tool === 'figma' && html`<span class="tiny muted">${plural((s.scope.files || []).length, 'file')}${s.scope.teams?.length ? ` · ${plural(s.scope.teams.length, 'team')}` : ''}</span>`}
      ${s.tool === 'github' && html`<span class="tiny muted">${(s.scope.repos || []).join(', ') || 'No repositories yet'}</span>`}
      ${open && html`<div class="col" style="gap:12px;margin-top:8px">
        <div class="form-grid">
          <${Field} label="Project" hint="Explicit mapping: confidence 1.0"><select class="input sm" value=${s.project_id || ''} onChange=${(e) => patch({ project_id: e.target.value || null }, 'Mapping saved')}><option value="">Let Trace decide</option>${projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select></${Field}>
          <label class="field"><span>Auto-accept</span><small>Skip the inbox when Trace is sure (${s.accept_streak || 0} accepted in a row without edits).</small><input type="checkbox" class="switch" checked=${!!s.auto_accept} onChange=${(e) => patch({ auto_accept: e.target.checked ? 1 : 0 }, e.target.checked ? 'Auto-accept on' : 'Auto-accept off')} /></label>
        </div>
        ${s.tool === 'folder' && html`<div class="col" style="gap:6px"><span class="tiny muted">Subfolders mapped to projects</span>
          ${rules.map((r, i) => html`<div class="row small"><code class="grow">${r.prefix}</code><span>→ ${projects.find((p) => p.id === r.project_id)?.name || 'deleted project'}</span><button class="btn ghost sm" onClick=${() => patch({ mapping_rules: { ...s.mapping_rules, paths: rules.filter((_, j) => j !== i) } })}>Remove</button></div>`)}
          ${scopes ? html`<${FolderRule} scopes=${scopes} projects=${projects} onAdd=${(r) => patch({ mapping_rules: { ...s.mapping_rules, paths: [...rules, r] } }, 'Folder mapped')} />` : html`<button class="btn sm" style="align-self:flex-start" onClick=${loadScopes}>Map a subfolder…</button>`}</div>`}
        ${s.tool === 'figma' && html`<${Field} label="Watched files" hint="Links or keys, one per line"><textarea class="input sm mono" rows="3" defaultValue=${(s.scope.files || []).join('\n')} onChange=${(e) => patch({ scope: { files: e.target.value.split(/\s+/).map((x) => x.match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/)?.[1] || x).filter(Boolean) } }, 'Scope saved')}></textarea></${Field}>`}
        ${s.tool === 'github' && html`<div class="col"><${Field} label="Repositories" hint="owner/name, one per line"><textarea class="input sm mono" rows="3" defaultValue=${(s.scope.repos || []).join('\n')} onChange=${(e) => patch({ scope: { repos: e.target.value.split(/\s+/).filter(Boolean) } }, 'Scope saved')}></textarea></${Field}>
          ${scopes ? html`<div class="row wrap" style="gap:4px">${scopes.slice(0, 30).map((r) => html`<button class="chip" style="cursor:pointer" onClick=${() => !s.scope.repos?.includes(r.id) && patch({ scope: { repos: [...(s.scope.repos || []), r.id] } }, `Watching ${r.id}`)}>${r.name}</button>`)}</div>` : html`<button class="btn sm" style="align-self:flex-start" onClick=${loadScopes}>Pick from my repositories…</button>`}</div>`}
      </div>`}
    </div>
    <div class="row" style="gap:4px">
      ${!builtin || s.tool === 'link' ? html`<button class="btn sm" onClick=${() => setOpen(!open)} aria-expanded=${open}>${open ? 'Done' : 'Manage'}</button>` : ''}
      <${Menu} label=${`${s.name} actions`} items=${[
        s.tool !== 'upload' && s.tool !== 'agent' && { label: 'Sync now', icon: 'arrows-clockwise', onClick: sync },
        { label: s.status === 'active' ? 'Pause capture' : 'Resume capture', icon: s.status === 'active' ? 'pause' : 'play', onClick: () => patch({ status: s.status === 'active' ? 'paused' : 'active' }, s.status === 'active' ? 'Paused' : 'Resumed') },
        !builtin && { label: 'Check health', icon: 'heartbeat', onClick: health },
        !builtin && '-', !builtin && { label: 'Disconnect', icon: 'plugs', danger: true, onClick: () => setConfirm(true) }]} />
    </div>
    ${confirm && html`<${Dialog} title=${`Disconnect ${s.name}?`} onClose=${() => setConfirm(false)} footer=${html`<button class="btn ghost" onClick=${() => setConfirm(false)}>Keep it</button><button class="btn primary" onClick=${() => api(`/sources/${s.id}`, { method: 'DELETE' }).then(() => { toast(`Disconnected ${s.name}; its token is deleted.`); reload(); }).catch(fail)}>Disconnect</button>`}>
      <p>Capture stops at once and the stored token is deleted. Everything already captured stays in your projects.</p></${Dialog}>`}
  </div>`;
}
function FolderRule({ scopes, projects, onAdd }) {
  const [r, setR] = useState({ prefix: scopes[0]?.id || '', project_id: projects[0]?.id || '' });
  return html`<div class="row"><select class="input sm" value=${r.prefix} onChange=${(e) => setR({ ...r, prefix: e.target.value })} aria-label="Subfolder">${scopes.map((s) => html`<option value=${s.id}>${s.name}/</option>`)}</select><span>→</span>
    <select class="input sm" value=${r.project_id} onChange=${(e) => setR({ ...r, project_id: e.target.value })} aria-label="Project">${projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select><button class="btn sm" onClick=${() => r.prefix && r.project_id && onAdd(r)}>Map</button></div>`;
}

function Sources() {
  const { data, error, reload } = useFetch('/sources', ['source', 'capture']);
  const [connect, setConnect] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} h=${300} />`;
  return html`<section class="section"><header><h1 class="grow">Sources</h1></header>
      <p class="small muted">Connect a tool once and Trace captures in the background. Only the files, repos and folders you pick are read. Pause anything with one click.</p>
      <div class="connect-grid">${data.catalog.map((c) => html`<div class=${`card src k-${c.tool}`} style="grid-template-columns:auto 1fr">
        <span class="ico"><${Icon} n=${TOOLS[c.tool]?.icon} /></span>
        <div class="col" style="gap:4px"><b>${c.label}</b><span class="tiny muted">${c.how}</span><span class="tiny">${c.gets}</span><span class="tiny muted">Fidelity: ${c.fidelity}</span>
          ${['figma', 'github', 'folder'].includes(c.tool) && html`<button class="btn sm" style="align-self:flex-start;margin-top:4px" onClick=${() => setConnect(c.tool)}>Connect</button>`}
          ${c.tool === 'link' && html`<button class="btn sm" style="align-self:flex-start;margin-top:4px" onClick=${() => setConnect('link')}>Add a link</button>`}
          ${c.tool === 'agent' && html`<a class="btn sm" style="align-self:flex-start;margin-top:4px" href="#/settings/mcp">Get a token</a>`}
          ${c.tool === 'upload' && html`<span class="tiny muted" style="margin-top:4px">Always on: drop or paste anywhere.</span>`}
        </div></div>`)}</div>
    </section>
    <section class="section"><header><h2 class="grow">Connected</h2></header>
      <div class="col">${data.sources.filter((s) => s.tool !== 'aimem').map((s) => html`<${SourceRow} s=${s} projects=${data.projects} reload=${reload} key=${s.id} />`)}</div>
    </section>
    ${connect === 'link' && html`<${AddLink} onClose=${() => setConnect(null)} />`}
    ${connect && connect !== 'link' && html`<${ConnectForm} tool=${connect} projects=${data.projects} onClose=${() => setConnect(null)} onDone=${() => { reload(); refreshMe(); }} />`}`;
}

// ---------- routing ----------
function Routing() {
  const { data, error, reload } = useFetch('/settings');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const s = data.settings;
  const save = (body) => api('/settings', { method: 'PATCH', body }).then(reload).catch(fail);
  const owner = data.role === 'owner';
  return html`<section class="section"><h1>Routing</h1>
      <p class="small muted">How Trace decides where work belongs: your mappings first, then rules it learned from your corrections, links between files, look-alike work, and an AI tie-break when two projects are close.</p>
      <div class="form-grid">
        <${Field} label=${`File directly at ${Math.round(s.file_threshold * 100)}% sure`} hint="Above this, moments go straight into their project (still shown in the inbox as filed). Trace nudges it up when you move filed work."><input type="range" min="0.6" max="0.97" step="0.01" value=${s.file_threshold} disabled=${!owner} onChange=${(e) => save({ file_threshold: +e.target.value })} /></${Field}>
        <${Field} label=${`Guess from ${Math.round(s.inbox_threshold * 100)}% sure`} hint="Below this, moments go to Unsorted instead of showing a guess."><input type="range" min="0.2" max="0.8" step="0.01" value=${s.inbox_threshold} disabled=${!owner} onChange=${(e) => save({ inbox_threshold: +e.target.value })} /></${Field}>
        <${Field} label="A session ends after" hint="Minutes without activity before a moment closes on its own."><select class="input" value=${s.session_gap_min} disabled=${!owner} onChange=${(e) => save({ session_gap_min: +e.target.value })}>${[5, 10, 20, 30, 45, 60, 120].map((m) => html`<option value=${m}>${m} minutes</option>`)}</select></${Field}>
      </div>
    </section>
    <section class="section"><h2>Learned from your corrections</h2>
      ${data.rules.length ? html`<table class="t"><thead><tr><th>When</th><th>File into</th><th class="num">Times used</th><th></th></tr></thead><tbody>${data.rules.map((r) => html`<tr><td><code>${r.pattern.replace(/^name:/, 'name starts with ').replace(/^path:/, 'in folder ')}</code></td><td>${r.project_name || '—'}</td><td class="num">${r.hits}</td><td>${owner && html`<button class="btn ghost sm" onClick=${() => api(`/rules/${r.id}`, { method: 'DELETE' }).then(reload).catch(fail)}>Forget</button>`}</td></tr>`)}</tbody></table>`
        : html`<p class="small muted">Nothing yet. Each time you move or confirm a moment in the inbox, Trace learns a rule and files that kind of work itself next time.</p>`}
    </section>
    <section class="section"><h2>Muted</h2>
      ${s.mute?.length ? html`<div class="col">${s.mute.map((m, i) => html`<div class="row small"><code class="grow">${m.type}</code><span class="muted">from a source</span>${owner && html`<button class="btn ghost sm" onClick=${() => save({ mute: s.mute.filter((_, j) => j !== i) })}>Unmute</button>`}</div>`)}</div>` : html`<p class="small muted">Nothing muted. “Mute this kind” in the inbox hides an event type from a source.</p>`}
    </section>`;
}

// ---------- MCP ----------
// The skill a coding agent uses in any project folder: one word ("trace") and Trace assembles that project.
function SkillCard() {
  const { data, reload } = useFetch('/skill');
  const [open, setOpen] = useState(false);
  const install = () => api('/skill/install', { method: 'POST' }).then((r) => { toast(`Installed: ${r.path}`); reload(); }).catch(fail);
  if (!data) return null;
  return html`<section class="panel col skillcard" style="gap:10px">
    <div class="row"><span class="src-ico"><${Icon} n="magic-wand" /></span><div class="col grow" style="gap:2px"><b>The Trace skill for coding agents</b><span class="small muted">In any project folder, ask Claude Code to “use trace” (or “assemble the case study”). It points Trace at that folder (project, capture, AI memory, the reasoning script) and answers the case-study questions only it knows.</span></div>
      ${data.installed ? html`<span class="chip ok"><${Icon} n="check" />Installed</span>` : html`<button class="btn primary sm" onClick=${install}>Install for Claude Code</button>`}</div>
    <span class="tiny muted">${data.installed ? 'At' : 'Goes to'} ${data.path}. Other agents (Codex, Cursor) can run the same command:</span>
    <div class="secret"><span class="grow">${data.cli}</span><button class="btn sm" onClick=${() => copy(data.cli, 'Command copied')}>Copy</button></div>
    <button class="cs-ev-t" aria-expanded=${open} onClick=${() => setOpen(!open)}><${Icon} n=${open ? 'caret-down' : 'caret-right'} />What the skill tells the agent</button>
    ${open && html`<pre class="code script">${data.text}</pre>`}
  </section>`;
}

function Mcp() {
  const me = useMe();
  const { data, error, reload } = useFetch('/mcp-tokens');
  const [f, setF] = useState({ name: 'Claude Code', write: false, projects: new Set() });
  const [made, setMade] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const create = async (e) => { e.preventDefault(); try { setMade(await api('/mcp-tokens', { method: 'POST', body: { name: f.name, write: f.write, project_ids: [...f.projects] } })); reload(); } catch (er) { fail(er); } };
  return html`<section class="section"><h1>MCP & agents</h1>
      <p class="small muted">Your agents call Trace when they need context; Trace doesn’t push anything at them. Any MCP client (Claude Code, Claude, Cursor) can read the design memory (context packs, latest screens with images, what changed, references, decisions, tokens, open comments), use <code>recall</code> to search what your other AIs remember, and leave notes for the next agent with <code>remember</code>. Tokens are read-only unless you grant writes; every call is in the log below. Captured text and quoted AI memory are marked as data for agents.</p>
      <div class="secret"><span class="grow">${data.url}</span><button class="btn sm" onClick=${() => copy(data.url, 'Endpoint copied')}>Copy</button></div>
    </section>
    <${SkillCard} />
    ${made && html`<section class="panel col" style="gap:12px;border-color:var(--sel-line)">
      <b>Copy this token now: it won’t be shown again.</b>
      <div class="secret"><span class="grow">${made.token}</span><button class="btn sm" onClick=${() => copy(made.token, 'Token copied')}>Copy</button></div>
      <span class="small">Claude Code:</span><div class="secret"><span class="grow">${made.claude_code}</span><button class="btn sm" onClick=${() => copy(made.claude_code, 'Command copied')}>Copy</button></div>
      <span class="small">Other clients (JSON config):</span><pre class="code">${JSON.stringify(made.json, null, 2)}</pre>
      <span class="small">Clients that only speak stdio:</span><div class="secret"><span class="grow">${made.stdio}</span><button class="btn sm" onClick=${() => copy(made.stdio)}>Copy</button></div>
      <p class="small muted">Then ask your agent: “What changed in the checkout design this week?” or use the prompts “Build this screen from the latest design” and “Review my implementation against the design”.</p>
    </section>`}
    <section class="section"><h2>New token</h2>
      <form class="panel col" style="gap:12px" onSubmit=${create}>
        <div class="form-grid"><${Field} label="Name" hint="Who uses it, e.g. Claude Code on my laptop"><input class="input" value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></${Field}>
          <label class="field"><span>Allow writes</span><small>Post comments, add artifacts and moments, update issues. Writes land as drafts.</small><input type="checkbox" class="switch" checked=${f.write} onChange=${(e) => setF({ ...f, write: e.target.checked })} /></label></div>
        <div class="col" style="gap:4px"><span class="small" style="font-weight:500">Projects</span><span class="tiny muted">None ticked = all projects.</span>
          <div class="row wrap">${me?.projects.map((p) => html`<label class="check small"><input type="checkbox" checked=${f.projects.has(p.id)} onChange=${() => { const s = new Set(f.projects); s.has(p.id) ? s.delete(p.id) : s.add(p.id); setF({ ...f, projects: s }); }} />${p.name}</label>`)}</div></div>
        <div class="row"><button class="btn primary">Create token</button></div>
      </form>
    </section>
    <section class="section"><h2>Tokens</h2>
      ${data.tokens.length ? html`<table class="t"><thead><tr><th>Name</th><th>Access</th><th>Projects</th><th>Last used</th><th></th></tr></thead><tbody>${data.tokens.map((t) => html`<tr style=${t.revoked ? 'opacity:.5' : ''}><td>${t.name} <code class="muted">${t.hint}</code></td><td>${t.scopes.includes('write') ? 'Read + write' : 'Read only'}</td><td class="small">${t.project_ids ? plural(t.project_ids.length, 'project') : 'All'}</td><td class="small muted">${t.last_used ? rel(t.last_used) : 'Never'}</td><td>${t.revoked ? html`<span class="chip">Revoked</span>` : html`<button class="btn ghost sm danger" onClick=${() => api(`/mcp-tokens/${t.id}`, { method: 'DELETE' }).then(() => { toast('Revoked'); reload(); }).catch(fail)}>Revoke</button>`}</td></tr>`)}</tbody></table>` : html`<p class="small muted">No tokens yet.</p>`}
    </section>
    <section class="section"><h2>Agent activity</h2>
      ${data.reads.length ? html`<table class="t"><thead><tr><th>When</th><th>Token</th><th>Call</th><th>Client</th></tr></thead><tbody>${data.reads.map((r) => html`<tr><td class="small muted">${stamp(r.ts)}</td><td class="small">${r.actor}</td><td><code>${r.target}</code> <span class="tiny muted">${r.action.replace('mcp.', '')}</span></td><td class="small muted">${r.detail?.client?.name || r.detail?.client || ''}</td></tr>`)}</tbody></table>` : html`<p class="small muted">No agent has called Trace yet.</p>`}
    </section>`;
}

// ---------- members ----------
function Members() {
  const { data, error, reload } = useFetch('/members');
  const settings = useFetch('/settings');
  const [f, setF] = useState({ role: 'editor' });
  const [made, setMade] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data || !settings.data) return html`<${Loading} />`;
  const mode = settings.data.workspace.mode;
  const invite = async (e) => { e.preventDefault(); try { setMade(await api('/members', { method: 'POST', body: f })); setF({ role: 'editor' }); reload(); settings.reload(); } catch (er) { fail(er); } };
  return html`<section class="section"><h1>Members</h1>
      <div class="row"><${Seg} label="Workspace mode" value=${mode} onChange=${(v) => api('/settings', { method: 'PATCH', body: { mode: v } }).then(() => { settings.reload(); refreshMe(); toast(v === 'team' ? 'Team mode: roles, reviews and guests. History is kept.' : 'Solo mode'); }).catch(fail)} options=${[{ value: 'solo', label: 'Solo' }, { value: 'team', label: 'Team' }]} /></div>
      <p class="small muted">${mode === 'solo' ? 'Solo: private, no review gates. Switching to team keeps everything.' : 'Team: owner, editor, reviewer, viewer and guest client roles; per-project roles in project settings. Teammates on your network open their invite link (start Trace with TRACE_HOST=0.0.0.0 to share it).'}</p>
    </section>
    <section class="section"><h2>Invite</h2>
      <form class="panel col" style="gap:12px" onSubmit=${invite}>
        <div class="form-grid"><${Field} label="Name"><input class="input" value=${f.name || ''} onInput=${(e) => setF({ ...f, name: e.target.value })} autocomplete="name" /></${Field}>
          <${Field} label="Email (optional)"><input class="input" type="email" value=${f.email || ''} onInput=${(e) => setF({ ...f, email: e.target.value })} autocomplete="email" spellcheck="false" autocapitalize="none" /></${Field}>
          <${Field} label="Role"><select class="input" value=${f.role} onChange=${(e) => setF({ ...f, role: e.target.value })}><option value="editor">Editor: everything but settings</option><option value="reviewer">Reviewer: comment and review</option><option value="viewer">Viewer: read only</option></select></${Field}></div>
        <div class="row"><button class="btn primary">Create invite link</button></div>
      </form>
      ${made && html`<div class="col"><span class="small">Send ${made.name} this link (it signs them in on this Trace):</span><div class="secret"><span class="grow">${made.invite}</span><button class="btn sm" onClick=${() => copy(made.invite, 'Invite link copied')}>Copy</button></div></div>`}
    </section>
    <section class="section"><h2>People</h2>
      <table class="t"><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>${data.members.map((m) => html`<tr><td>${m.name}${m.email && html` <span class="muted small">${m.email}</span>`}</td>
        <td>${m.role === 'owner' ? 'Owner' : html`<select class="input sm" style="width:auto" value=${m.role} aria-label=${`Role for ${m.name}`} onChange=${(e) => api(`/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }).then(reload).catch(fail)}><option value="editor">Editor</option><option value="reviewer">Reviewer</option><option value="viewer">Viewer</option></select>`}</td>
        <td class="row" style="justify-content:flex-end">${m.invite && html`<button class="btn ghost sm" onClick=${() => copy(m.invite, 'Invite link copied')}>Copy invite</button><button class="btn ghost sm danger" onClick=${() => api(`/members/${m.id}`, { method: 'DELETE' }).then(reload).catch(fail)}>Remove</button>`}</td></tr>`)}</tbody></table>
    </section>
    <section class="section"><h2>Guest client links</h2>
      ${data.guests.length ? html`<table class="t"><thead><tr><th>Project</th><th>For</th><th>Expires</th><th></th></tr></thead><tbody>${data.guests.map((g) => html`<tr><td>${g.project_name}</td><td>${g.name}</td><td class="small muted">${stamp(g.expires_at)}</td><td class="row" style="justify-content:flex-end">${g.link && html`<button class="btn ghost sm" onClick=${() => copy(g.link, 'Guest link copied')}>Copy</button>`}<button class="btn ghost sm danger" onClick=${() => api(`/guest-links/${g.token}`, { method: 'DELETE' }).then(reload).catch(fail)}>Revoke</button></td></tr>`)}</tbody></table>`
        : html`<p class="small muted">Make a view-and-comment link for a client from a project’s settings. Links expire.</p>`}
    </section>
    ${data.people.length > 0 && html`<section class="section"><h2>Seen in your tools</h2><p class="small muted">People and agents Trace met in Figma, GitHub and MCP, kept as external people until you invite them.</p><div class="row wrap">${data.people.map((p) => html`<span class="chip">${p.is_agent ? html`<${Icon} n="sparkle" />` : ''}${p.name}</span>`)}</div></section>`}`;
}

// ---------- privacy ----------
function Privacy() {
  const me = useMe();
  const settings = useFetch('/settings');
  const [confirm, setConfirm] = useState('');
  const [dnc, setDnc] = useState({});
  if (!settings.data) return html`<${Loading} />`;
  const owner = settings.data.role === 'owner';
  const saveDnc = (p) => api(`/projects/${p.id}`, { method: 'PATCH', body: { do_not_capture: (dnc[p.id] ?? (p.do_not_capture || []).join('\n')).split('\n').map((x) => x.trim()).filter(Boolean) } }).then(() => toast('Saved')).catch(fail);
  return html`<section class="section"><h1>Privacy & data</h1>
      <div class="panel col" style="gap:8px">
        <div class="row"><span class=${`dot ${me?.paused ? 'warn' : 'on'}`}></span><b class="grow">${me?.paused ? 'All capture is paused' : 'Capture is on'}</b><button class="btn" disabled=${!owner} onClick=${() => api('/settings', { method: 'PATCH', body: { paused: !me.paused } }).then(refreshMe).catch(fail)}>${me?.paused ? 'Resume capture' : 'Pause all capture'}</button></div>
        <p class="small muted">Paused, Trace reads nothing from your tools or folders. Agents can still read what’s already here.</p>
      </div>
      <ul class="small" style="margin:0;padding-left:18px;line-height:1.8;color:var(--ink-2)">
        <li>Only the files, repos and folders you pick are watched.</li>
        <li>Everything lives on this computer (<code>data/</code>). Tokens and API keys are AES-256 encrypted in a separate vault whose key is in your user profile, and wiped when you disconnect.</li>
        <li>Trace runs no AI of its own and sends nothing to any AI service. Your agents read from it when you use them.</li>
        <li>AI memory (your AIs’ sessions and memory files) is read on this computer when asked, with secrets removed first.</li>
        <li>Agents get read-only access unless you grant writes; every call is logged.</li>
      </ul>
    </section>
    <section class="section"><h2>Do-not-capture lists</h2>
      ${settings.data.projects.map((p) => html`<${Field} label=${p.name} hint="One pattern per line; * matches anything"><div class="row" style="align-items:flex-start"><textarea class="input mono" rows="2" value=${dnc[p.id] ?? (p.do_not_capture || []).join('\n')} onInput=${(e) => setDnc({ ...dnc, [p.id]: e.target.value })}></textarea><button class="btn sm" disabled=${!owner} onClick=${() => saveDnc(p)}>Save</button></div></${Field}>`)}
    </section>
    <section class="section"><h2>Export everything</h2>
      <p class="small muted">A zip with every record as JSON and every captured file. Tokens are never included.</p>
      <div class="row"><a class="btn" href="/api/export" aria-disabled=${!owner}><${Icon} n="download-simple" />Download export</a></div>
    </section>
    ${owner && html`<section class="section"><h2>Delete the workspace</h2>
      <p class="small muted">Deletes every project, moment, file, comment, token and key, now. To delete one project, use its settings. Type “delete everything” to confirm.</p>
      <div class="row"><input class="input" value=${confirm} onInput=${(e) => setConfirm(e.target.value)} aria-label="Type delete everything to confirm" /><button class="btn danger" aria-disabled=${confirm !== 'delete everything'} onClick=${() => confirm === 'delete everything' && api('/workspace', { method: 'DELETE', body: { confirm } }).then(() => { refreshMe(); location.hash = '#/onboarding'; }).catch(fail)}>Delete everything</button></div>
    </section>`}`;
}

// ---------- engine ----------
function Engine() {
  const { data, error, reload } = useFetch('/settings', ['moment', 'capture']);
  const audit = useFetch('/audit?limit=80');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} />`;
  const e = data.engine;
  const stages = ['normalize', 'snapshot', 'diff', 'cluster', 'route', 'describe', 'index'];
  const q = (st, status) => e.queue.find((x) => x.stage === st && x.status === status)?.n || 0;
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  return html`<section class="section"><h1>Engine</h1>
      <div class="stats">
        <div class="stat"><span class="small muted">Raw events</span><b>${e.events.toLocaleString()}</b></div>
        <div class="stat"><span class="small muted">Moments</span><b>${e.moments.toLocaleString()}</b></div>
        <div class="stat"><span class="small muted">Events per moment</span><b>${e.noise_ratio ?? '—'}</b><span class="tiny muted">Goal: 20 or more</span></div>
        <div class="stat"><span class="small muted">Filed right first time</span><b>${pct(e.capture_accuracy)}</b><span class="tiny muted">Goal: 90%</span></div>
        <div class="stat"><span class="small muted">Accepted without edits</span><b>${pct(e.accepted_without_edit)}</b><span class="tiny muted">Goal: 75%</span></div>
      </div>
    </section>
    <section class="section"><h2>Pipeline</h2>
      <table class="t"><thead><tr><th>Stage</th><th class="num">Waiting</th><th class="num">Running</th><th class="num">Done (24 h)</th><th class="num">Dead</th></tr></thead>
        <tbody>${stages.map((s) => html`<tr><td>${s}</td><td class="num">${q(s, 'queued')}</td><td class="num">${q(s, 'running')}</td><td class="num">${q(s, 'done')}</td><td class="num" style=${q(s, 'dead') ? 'color:var(--danger)' : ''}>${q(s, 'dead')}</td></tr>`)}</tbody></table>
    </section>
    ${e.dead.length > 0 && html`<section class="section"><h2>Failed jobs</h2>${e.dead.map((j) => html`<div class="panel col" style="gap:6px"><div class="row"><b class="grow">${j.stage}</b><span class="tiny muted">${rel(j.updated_at)}</span><button class="btn sm" onClick=${() => api(`/jobs/${j.id}/retry`, { method: 'POST' }).then(() => { toast('Retrying'); reload(); }).catch(fail)}>Retry</button></div><pre class="code" style="max-height:140px">${j.error}</pre></div>`)}</section>`}
    <section class="section"><h2>Audit log</h2>
      ${audit.data ? html`<table class="t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th></tr></thead><tbody>${audit.data.map((a) => html`<tr><td class="small muted">${stamp(a.ts)}</td><td class="small">${a.actor} <span class="tiny muted">${a.actor_type}</span></td><td><code>${a.action}</code></td><td class="small muted trunc" style="max-width:260px">${a.target}</td></tr>`)}</tbody></table>` : audit.error ? html`<p class="small muted">Only the owner can see the audit log.</p>` : html`<${Loading} />`}
    </section>`;
}
