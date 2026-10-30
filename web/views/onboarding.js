// First run: solo or team → connect a first tool → watch the first moment appear. Goal: under 10 minutes.
import { html, useState, useEffect, api, onLive, refreshMe, Icon, Field, Thumb, toast, fail, go, plural } from '../lib.js';

const Mark = () => html`<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--ink)"/><path d="M7 21c4 0 5-10 9-10s5 10 9 10" fill="none" stroke="var(--inv)" stroke-width="2.4" stroke-linecap="round"/><circle cx="7" cy="21" r="2.4" fill="var(--inv)"/><circle cx="25" cy="21" r="2.4" fill="var(--inv)"/></svg>`;

export function Onboarding() {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState('solo');
  const [name, setName] = useState('');
  const [tool, setTool] = useState('figma');
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [feed, setFeed] = useState([]);
  const [first, setFirst] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  useEffect(() => { // step 3: the live feed
    if (step !== 3) return;
    let captures = 0;
    const off = onLive(async (t, d) => {
      if (t === 'capture') { captures++; setFeed((x) => [{ id: Math.random(), text: `Captured: ${d.type?.replace('.', ' ')}`, n: captures }, ...x].slice(0, 6)); }
      if (t === 'moment' && d.stage === 'ready' && !first) {
        try { const m = await api(`/moments/${d.id}`); setFirst(m); } catch {}
      }
    });
    return off;
  }, [step, first]);

  const finish = async (to = '/') => { try { await api('/onboarding', { method: 'POST', body: { mode, name: name || undefined, done: true } }); await refreshMe(); go(to); } catch (e) { fail(e); } };
  const connect = async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      if (tool === 'sample') await api('/demo', { method: 'POST' });
      else if (tool === 'memory') { const { adapters } = await api('/memory'); for (const a of adapters.filter((x) => x.found && x.id !== 'chats' && !x.source)) await api('/memory/connect', { method: 'POST', body: { adapter: a.id } }); return finish('/memory'); }
      else await api('/sources', { method: 'POST', body: { tool, ...f, import: true } });
      setStep(3);
    } catch (er) { setErr(er.message); }
    setBusy(false);
  };
  const TOOL = [
    ['figma', 'figma-logo', 'Figma', 'Recommended. Versions, frames, comments.'], ['folder', 'folder-simple', 'A folder', 'Any file you save: exports, .ai, .psd, .riv.'],
    ['github', 'github-logo', 'GitHub', 'Commits and pull requests, linked to designs.'], ['memory', 'brain', 'Your AIs’ memory', 'What Claude Code, Codex, Cursor and Copilot already remember, read when asked.'], ['sample', 'squares-four', 'Sample project', 'See Trace working before you connect anything.'],
  ];
  return html`<main class="onb"><div class="box">
    <div class="row" style="gap:12px"><${Mark} /><div class="col" style="gap:0"><b style="font-size:16px">Trace</b><span class="small muted">Your design process, captured and remembered, for your team and your AI agents.</span></div></div>
    <div class="steps" aria-label=${`Step ${step} of 3`}>${['How you work', 'Connect a tool', 'First moment'].map((s, i) => html`${i ? html`<span>·</span>` : ''}${i + 1 === step ? html`<b>${s}</b>` : html`<span>${s}</span>`}`)}</div>

    ${step === 1 && html`<div class="col" style="gap:16px">
      <h1>How will you use Trace?</h1>
      <div class="choice" role="radiogroup" aria-label="Mode">
        <button role="radio" aria-checked=${mode === 'solo'} onClick=${() => setMode('solo')}><${Icon} n="user" /><b>Solo</b><span class="small muted">Private, no review gates. Everything files itself; you confirm what it isn’t sure of.</span></button>
        <button role="radio" aria-checked=${mode === 'team'} onClick=${() => setMode('team')}><${Icon} n="users-three" /><b>Team</b><span class="small muted">Roles, reviews, proposals and guest links for clients. Switch any time; history is kept.</span></button>
      </div>
      <${Field} label="Workspace name (optional)"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. Studio North" /></${Field}>
      <div class="row"><button class="btn primary" onClick=${() => setStep(2)}>Continue</button></div>
    </div>`}

    ${step === 2 && html`<form class="col" style="gap:16px" onSubmit=${connect}>
      <h1>Connect your first tool</h1>
      <div class="choice" role="radiogroup" aria-label="First tool">${TOOL.map(([id, icon, label, hint]) => html`<button type="button" role="radio" aria-checked=${tool === id} onClick=${() => { setTool(id); setErr(null); }}><${Icon} n=${icon} cls=${id !== 'sample' ? `tool-ico k-${id}` : ''} /><b>${label}</b><span class="small muted">${hint}</span></button>`)}</div>
      ${err && html`<div class="errbox" role="alert">${err}</div>`}
      ${tool === 'figma' && html`
        <${Field} label="Figma personal access token" hint="Figma → Settings → Security → Personal access tokens."><input class="input" type="password" autocomplete="off" spellcheck="false" value=${f.token || ''} onInput=${set('token')} /></${Field}>
        <${Field} label="A file to watch" hint="Paste its link; add more later. Saving a named version makes a moment."><input class="input" value=${f.files || ''} onInput=${set('files')} placeholder="https://www.figma.com/design/…" /></${Field}>`}
      ${tool === 'folder' && html`<${Field} label="Folder on this computer" hint="Full path. Files already there come in as one moment; every save after that is captured."><input class="input mono" value=${f.path || ''} onInput=${set('path')} spellcheck="false" /></${Field}>`}
      ${tool === 'github' && html`
        <label class="check"><input type="checkbox" checked=${!!f.use_cli} onChange=${set('use_cli')} />Use my GitHub CLI login</label>
        ${!f.use_cli && html`<${Field} label="GitHub token" hint="Fine-grained, read access to contents and pull requests."><input class="input" type="password" autocomplete="off" value=${f.token || ''} onInput=${set('token')} /></${Field}>`}
        <${Field} label="Repository" hint="owner/name"><input class="input mono" value=${f.repos || ''} onInput=${set('repos')} /></${Field}>`}
      ${tool === 'memory' && html`<p class="note">Trace reads each AI’s own sessions and memory files on this computer, with secrets removed, and only when it’s asked. Your agents can then recall what any of them learned.</p>`}
      ${tool === 'sample' && html`<p class="note">Two projects (a checkout and an onboarding flow) with versions, comments, decisions, references, an exploration, a proposal and an AI artifact, pushed through the real engine.</p>`}
      <div class="row"><button class="btn primary" aria-disabled=${busy}>${busy ? 'Connecting…' : tool === 'sample' ? 'Load the sample' : tool === 'memory' ? 'Connect them' : 'Connect'}</button><button type="button" class="btn ghost" onClick=${() => setStep(1)}>Back</button><span class="grow"></span><button type="button" class="btn ghost" onClick=${() => finish('/')}>Skip for now</button></div>
    </form>`}

    ${step === 3 && html`<div class="col" style="gap:16px">
      <h1>${first ? 'Your first moment' : 'Watching for your first moment…'}</h1>
      ${!first && html`<p class="muted">${tool === 'figma' ? 'Save a named version in Figma (or wait for the next autosave), and it shows up here.' : tool === 'folder' ? 'Save or export something into that folder.' : tool === 'github' ? 'The latest commits are coming in now.' : 'The sample is going through the engine now.'}</p>`}
      <div class="livefeed" aria-live="polite">${feed.map((x) => html`<div key=${x.id}><span class="dot on"></span><span class="grow">${x.text}</span><span class="tiny muted">${plural(x.n, 'event')}</span></div>`)}</div>
      ${first && html`<div class="card" style="padding:16px;display:grid;grid-template-columns:160px 1fr;gap:16px">
        <${Thumb} snap=${first.assets[0]?.after} style="aspect-ratio:4/3" />
        <div class="col" style="gap:6px"><b>${first.title}</b><p class="small ink2">${first.summary}</p><span class="tiny muted">${first.project_name ? `Filed to ${first.project_name}` : first.guess_name && first.route_confidence >= 0.5 ? `Looks like ${first.guess_name}: it waits in the inbox for you to confirm` : 'No project matched yet: it waits in the inbox for you to pick one'}</span></div>
      </div>`}
      <div class="row"><button class="btn primary" onClick=${() => finish(first && first.status === 'draft' ? '/inbox' : '/')}>${first ? (first.status === 'draft' ? 'Review it' : 'Go to Trace') : 'Go to Trace'}</button>${!first && html`<span class="small muted">You can leave; capture keeps running.</span>`}</div>
    </div>`}
  </div></main>`;
}
