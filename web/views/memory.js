// AI memory: what Claude Code, Codex, Antigravity, Cursor, Copilot and your chat exports already remember,
// read when asked, searched in one place, and handed to any agent that calls Trace.
import { html, useState, useEffect, useRef, api, useFetch, useMe, Header, Icon, ErrorBox, Loading, Dialog, rel, plural, toast, fail } from '../lib.js';

const ICON = { 'claude-code': 'terminal-window', codex: 'code', antigravity: 'planet', cursor: 'cursor-text', copilot: 'github-logo', chats: 'chats-circle', notes: 'note' };
const KIND = { session: 'conversation', memory: 'memory file', instructions: 'instructions', note: 'agent note' };
const when = (ts) => (ts ? rel(typeof ts === 'string' ? Date.parse(ts) : ts) : '');

function Hit({ r, onOpen }) {
  return html`<button class="mem-hit" style="text-align:left;cursor:pointer;font:inherit;color:inherit" onClick=${() => onOpen(r)}>
    <span class="src"><${Icon} n=${ICON[r.adapter] || 'brain'} /><b style="font-weight:500;color:var(--ink)">${r.tool}</b><span>· ${KIND[r.kind] || r.kind}</span><span class="trunc">· ${r.title}</span><span style="margin-left:auto;white-space:nowrap">${when(r.when)}</span></span>
    ${r.workspace && html`<span class="tiny muted mono trunc">${r.workspace}</span>`}
    <span class="txt">${r.text}</span>
  </button>`;
}

export function DocView({ id, onClose }) {
  const { data, error } = useFetch(`/memory/docs/${id}`);
  return html`<${Dialog} title=${data ? data.title : 'Loading…'} size="lg" onClose=${onClose}>
    ${error && html`<${ErrorBox} error=${error} />`}
    ${data && html`<p class="small muted">${data.tool} · ${KIND[data.kind] || data.kind}${data.workspace ? ` · ${data.workspace}` : ''} · ${when(data.ts)}</p>
      <p class="tiny muted mono" style="word-break:break-all">${data.path.split('#')[0]}</p>
      ${data.chunks.map((c) => html`<div class="note" style="white-space:pre-wrap;color:var(--ink)">${c.text}</div>`)}`}
  </${Dialog}>`;
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
  return html`<div class="col" style="gap:12px">
    <form class="row" onSubmit=${(e) => { e.preventDefault(); run(); }}>
      <label class="searchbar" style="width:100%;max-width:640px;height:44px"><${Icon} n="brain" /><span class="sr">Ask</span><input value=${q} onInput=${(e) => setQ(e.target.value)} placeholder=${project ? `What do your AIs remember about ${project.name}?` : 'What do your AIs remember about…'} /></label>
      <button class="btn" aria-disabled=${busy}>${busy ? 'Reading…' : 'Ask'}</button>
    </form>
    ${res?.indexing?.length > 0 && html`<p class="small muted">Still reading your AIs’ memory for the first time (${res.indexing.map((x) => `${x.done} of ${x.total} files`).join(', ')}). Ask again in a moment for more.</p>`}
    ${res && !res.results.length && html`<p class="small muted">Nothing your AIs remember matches that.</p>`}
    ${res?.results.length > 0 && html`<div class="col" style="gap:10px">${res.results.map((r) => html`<${Hit} r=${r} onOpen=${(x) => setDoc(x.doc)} />`)}</div>`}
    ${doc && html`<${DocView} id=${doc} onClose=${() => setDoc(null)} />`}
  </div>`;
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
  return html`
    <${Header} actions=${html`<button class="btn sm" onClick=${() => api('/memory/refresh', { method: 'POST' }).then(() => { toast('Read again; only what changed was re-read.'); reload(); }).catch(fail)}><${Icon} n="arrows-clockwise" />Read again</button>`}><b>AI memory</b></${Header}>
    <div class="content" style="max-width:1100px">
      <p class="ink2" style="max-width:68ch;margin-bottom:20px">Every AI you work with keeps its own memory: sessions, memory files, CLAUDE.md, AGENTS.md. Trace reads them when it’s asked, here or when an agent calls it, so what one AI learned the others know. Nothing leaves this computer.</p>
      <section class="section"><${Ask} initial=${q} /></section>
      <section class="section"><header><h2 class="grow">Your AIs</h2>${data && html`<span class="small muted">${plural(data.notes, 'note')} left by agents</span>`}</header>
        ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
        ${!data ? html`<${Loading} h=${160} />` : html`<div class="ai-grid">${data.adapters.map((a) => html`<div class="ai-card">
          <div class="row"><${Icon} n=${ICON[a.id]} /><b class="grow">${a.label}</b>${a.source ? html`<span class="row tiny muted" style="gap:4px"><span class=${`dot ${a.progress?.running ? 'warn' : 'on'}`}></span>${a.progress?.running ? 'Reading' : 'Connected'}</span>` : ''}</div>
          <span class="tiny muted">${a.where}</span>
          ${a.source ? html`<span class="small">${a.progress?.running ? `${a.progress.done} of ${a.progress.total} files read…` : `${a.docs} ${a.docs === 1 ? 'conversation or file' : 'conversations and files'}`}${a.source.last_sync ? html` <span class="muted">· read ${rel(a.source.last_sync)}</span>` : ''}</span>` : ''}
          <div class="row wrap" style="margin-top:auto;gap:6px">
            ${a.id === 'chats' && owner && html`<button class="btn sm" onClick=${() => imp.current.click()}><${Icon} n="upload-simple" />Add an export</button><input type="file" accept=".zip,.json" hidden ref=${imp} onChange=${(e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; }} />`}
            ${!a.source && a.id !== 'chats' && (a.found ? owner && html`<button class="btn sm" onClick=${() => connect(a.id)}>Connect</button>` : html`<span class="tiny muted">Not on this computer</span>`)}
            ${a.source && owner && html`<button class="btn ghost sm" onClick=${() => forget(a)}>Disconnect</button>`}
          </div>
          ${a.id === 'chats' && html`<span class="tiny muted">Claude.ai: Settings → Privacy → Export data. ChatGPT: Settings → Data controls → Export. Drop the zip here.</span>`}
        </div>`)}</div>`}
      </section>
      <section class="section"><h2>How agents use it</h2>
        <p class="small ink2" style="max-width:70ch">Any agent connected to Trace over MCP (Settings → MCP & agents) can call <code>recall</code> to search this memory, gets the relevant passages inside <code>get_project_context</code>, and can leave a note for the next agent with <code>remember</code>. Map projects to their folders (project settings) and each AI’s work in those folders counts as that project’s memory.</p>
        <p class="small muted" style="max-width:70ch">Secrets (API keys, tokens, passwords) are removed before anything is indexed. Agents receive these passages marked as quoted data, never as instructions. Disconnecting an AI forgets everything Trace read from it; its own files are never changed.</p>
      </section>
    </div>`;
}

// The project's tab: its folders, what the AIs remember from them, and a search scoped to it.
export function ProjectMemory({ p }) {
  const docs = useFetch(`/memory/docs?project=${p.id}`, ['memory']);
  const [doc, setDoc] = useState(null);
  return html`<div class="col" style="gap:20px;padding-top:12px;max-width:900px">
    <div class="note">${p.folders?.length ? html`AI memory from <b>${p.folders.join(', ')}</b> belongs to ${p.name}.` : html`Add the folders ${p.name} lives in (project settings → Folders) so your AIs’ sessions there count as its memory. Asking still searches everything.`}</div>
    <${Ask} project=${p} />
    <section class="col" style="gap:8px"><h2>From this project’s folders</h2>
      ${!docs.data ? html`<${Loading} h=${120} />` : !docs.data.length ? html`<p class="small muted">Nothing mapped yet.</p>`
      : html`<div class="card list-rows">${docs.data.map((d) => html`<button class="lrow" style="width:100%;border:0;background:none;text-align:left;cursor:pointer" onClick=${() => setDoc(d.id)}>
          <${Icon} n=${ICON[d.adapter] || 'brain'} /><span class="col grow" style="gap:0"><span class="small trunc">${d.title}</span><span class="tiny muted">${d.tool} · ${KIND[d.kind] || d.kind} · ${plural(d.chunks, 'passage')}</span></span><span class="tiny muted">${when(d.ts)}</span></button>`)}</div>`}
    </section>
    ${doc && html`<${DocView} id=${doc} onClose=${() => setDoc(null)} />`}
  </div>`;
}
