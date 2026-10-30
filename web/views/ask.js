// Ask Trace: one chat over every project, its folders, its AIs' memory and connected tools, opened beside the + at
// the bottom (or Ctrl J), and aware of the page you're on. Trace's AI (Vercel's AI
// Gateway, your key) works through the same tools agents use over MCP; each tool shows as a quiet step as it runs,
// links in the answer open the work they cite, and a file it wants to write waits for your Apply.
import { html, useState, useEffect, useRef, api, useFetch, useMe, useAi, Icon, Dialog, toast, fail, copy } from '../lib.js';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
import { md } from './artifacts.js';

const q = (a) => (a?.query ? `for “${String(a.query).slice(0, 40)}”` : '');
const STEP = {
  search: (a) => ['magnifying-glass', `Searched Trace ${q(a)}`],
  search_files: (a) => ['folder-open', `Searched the project’s folders ${q(a)}`],
  read_file: (a) => ['file-text', `Read ${a.path}`],
  recall: (a) => ['brain', `Searched what your AIs remember ${q(a)}`],
  get_block: (a) => ['squares-four', `Read ${a.block}`],
  get_project_context: () => ['folder', 'Read the project'],
  list_projects: () => ['folders', 'Looked through your projects'],
  get_changes: () => ['git-commit', 'Read the latest changes'],
  get_moment: () => ['git-commit', 'Opened a change'],
  get_comments: () => ['chat-circle', 'Read the reviews'],
  get_references: () => ['images', 'Read the references'],
  get_decisions: () => ['seal-check', 'Read the decisions'],
  get_design_tokens: () => ['palette', 'Read the design tokens'],
  get_case_study: () => ['book-open-text', 'Read the case study'],
  add_note: (a) => ['note', `Added a note to ${a.kind === 'constraint' ? 'constraints' : a.block || 'brainstorm'}`],
  add_task: (a) => ['check-square', `Added a task: ${a.title}`],
  answer_case_study: (a) => ['book-open-text', `Answered “${a.section}” in the case study`],
  add_insight: () => ['lightbulb', 'Saved an insight'],
  post_comment: () => ['chat-circle', 'Posted a comment'],
  update_issue: (a) => ['check-square', `Moved a task to ${String(a.status || '').replace('_', ' ')}`],
  add_artifact: (a) => ['sparkle', `Added an artifact: ${a.title}`],
  remember: () => ['brain', 'Left a note for your agents'],
  propose_file: (a) => ['file-plus', `Wants to write ${a.path}`],
};
const WRITES = new Set(['add_note', 'add_task', 'answer_case_study', 'add_insight', 'post_comment', 'update_issue', 'add_artifact', 'remember']);
const SUGGEST = { all: ['What changed across my projects this week?', 'Which tasks are still open, and who has them?', 'What do my AIs remember about the design system?'], one: ['Where does this project stand?', 'Find gaps between the reviews and the tasks', 'What did my coding agent change in the code lately?', 'File the open review points as tasks'] };
// Links to this Trace open in place; the rest open a new tab.
const local = (origin) => origin === location.origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
const answer = (text) => md(text).replace(/<a href="(https?:\/\/[^"]+?)\/#([^"]*)" target="_blank" rel="noopener">/g, (m, origin, hash) => (local(origin) ? `<a href="#${hash}">` : m));
const KEY = 'trace.ask';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { return []; } };

function Proposal({ s }) {
  const [state, setState] = useState(null);
  const apply = () => api(`/ai/files/${s.proposal}`, { method: 'POST' }).then((r) => { setState('written'); toast(`Wrote ${r.rel}`); }).catch(fail);
  const drop = () => api(`/ai/files/${s.proposal}`, { method: 'DELETE' }).then(() => setState('dropped')).catch(fail);
  return html`<div class="proposal">
    <div class="row"><${Icon} n="file-plus" /><b class="trunc grow">${s.args.path}</b>${state && html`<span class="chip ${state === 'written' ? 'ok' : ''}">${state === 'written' ? 'Written' : 'Discarded'}</span>`}</div>
    ${s.args.why && html`<p class="small muted">${s.args.why}</p>`}
    <pre class="code">${String(s.args.content || '').split('\n').slice(0, 24).join('\n')}${String(s.args.content || '').split('\n').length > 24 ? '\n…' : ''}</pre>
    ${!state && html`<div class="row"><button class="btn sm primary" onClick=${apply}>Write the file</button><button class="btn sm ghost" onClick=${drop}>Discard</button></div>`}
  </div>`;
}

// Seconds since the question, ticking while the AI works.
function Elapsed({ from }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t); }, []);
  return html`<span class="num">${((Date.now() - from) / 1000).toFixed(1)}s</span>`;
}

function Turn({ m, onAsk }) {
  const [open, setOpen] = useState(false);
  if (m.role === 'user') return html`<div class="msg ask-q">${m.content}</div>`;
  const steps = m.steps || [], now = steps.findLast?.((s) => s.state === 'run');
  const label = now ? (STEP[now.tool] || (() => ['', 'Working']))(now.args || {})[1] : 'Thinking';
  const fold = !m.pending && steps.length > 0;
  return html`<div class="msg ask-a">
    ${m.pending && !m.content && html`<div class="ai-now" role="status"><span class="shimmer trunc">${m.wait ? `Waiting ${m.wait}s for a turn (5 requests a minute on the free model)` : label}</span><span class="muted">${m.t0 && html`<${Elapsed} from=${m.t0} />`}</span></div>`}
    ${fold && html`<button class="ai-fold" aria-expanded=${open} onClick=${() => setOpen(!open)}><${Icon} n="list-magnifying-glass" />Worked through ${steps.length} step${steps.length === 1 ? '' : 's'}${m.ms ? ` · ${(m.ms / 1000).toFixed(1)}s` : ''}<${Icon} n=${open ? 'caret-up' : 'caret-down'} /></button>`}
    ${steps.length > 0 && (!fold || open) && html`<ol class="ai-steps">${m.steps.map((s) => { const [icon, label] = (STEP[s.tool] || (() => ['wrench', s.tool]))(s.args || {}); return html`<li class=${`ai-step ${s.state}${WRITES.has(s.tool) ? ' write' : ''}`}>
      <${Icon} n=${s.state === 'err' ? 'warning-circle' : icon} /><span class="trunc">${label}${s.count != null ? html` <span class="muted">· ${s.count}</span>` : ''}</span>
      ${s.link && WRITES.has(s.tool) && html`<a class="tiny" href=${s.link.replace(location.origin + '/', '')}>Open</a>`}
      ${s.state === 'err' && html`<span class="tiny muted trunc" title=${s.error}>${s.error}</span>`}
    </li>`; })}</ol>`}
    ${m.steps?.filter((s) => s.tool === 'propose_file' && s.proposal).map((s) => html`<${Proposal} s=${s} key=${s.proposal} />`)}
    ${m.content && html`<div class="md" dangerouslySetInnerHTML=${{ __html: answer(m.content) }}></div>`}
    ${m.followups?.length > 0 && html`<div class="ai-next" aria-label="Ask next">${m.followups.map((f) => html`<button onClick=${() => onAsk(f)}><${Icon} n="arrow-bend-down-right" />${f}</button>`)}</div>`}
    ${m.error && html`<div class="errbox small" role="alert">${m.error}${/Settings → AI/.test(m.error) ? html` <a href="#/settings/ai">Open Settings → AI</a>` : ''}</div>`}
  </div>`;
}

// The Ask button: beside the + at the bottom of every page.
export const AskButton = () => html`<button class="fab-ask" aria-label="Ask Trace" data-tip="Ask about your work" data-kbd="Ctrl J" onClick=${() => dispatchEvent(new CustomEvent('trace:ask'))}><${Icon} n="chat-teardrop-dots" /><span>Ask</span></button>`;

// Quick actions: small tabs above the box, the page's own question first.
function quick(route, scoped) {
  const p = route.split('?')[0].split('/').filter(Boolean);
  const one = scoped || p[0] === 'p' || p[0] === 'm';
  const page = p[0] === 'm' ? ['question', 'Why this changed', 'Why did this change, and what should I check?']
    : p[0] === 'p' && p[2] === 'casestudy' ? ['book-open-text', 'Weak answers', 'Which case-study answers are weakest, and what would make them stronger?']
    : (p[0] === 'p' && (p[2] === 'issues' || p[3] === 'tasks')) || p[0] === 'todo' ? ['list-checks', 'What first', 'What should I do first, and why?']
    : p[0] === 'p' && p[2] === 'canvas' ? ['lightbulb', 'Find gaps', 'What do the reviews and the tasks disagree on?']
    : null;
  const base = one
    ? [['clock-counter-clockwise', 'Recent changes', 'What changed recently in this project, and why?'], ['compass', 'Where it stands', 'Where does this project stand right now?'], ['check-square', 'Open tasks', 'Which tasks are open, and who has them?'], ['chat-circle', 'Open reviews', 'What do the open reviews ask for?'], ['terminal-window', 'Agent work', 'What did my coding agents change lately?']]
    : [['clock-counter-clockwise', 'Recent changes', 'What changed across my projects this week?'], ['check-square', 'Open tasks', 'Which tasks are open across my projects, and who has them?'], ['chat-circle', 'Open reviews', 'Which reviews are still open, and where?'], ['terminal-window', 'Agent work', 'What did my coding agents do this week?'], ['target', 'Needs me', 'Which project needs me most right now?']];
  return (page ? [page, ...base] : base).slice(0, 6);
}

// Ask takes the whole screen: an aurora glows down from the top (Vercel's colours), and in the middle there's only
// the box, with quick actions as small tabs above it. Answers stack above the box once you ask. Esc closes.
export function Ask({ onClose, project, first }) {
  const me = useMe();
  const ai = useAi();
  const [msgs, setMsgs] = useState(load);
  const [text, setText] = useState('');
  const [scope, setScope] = useState(project || '');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const log = useRef(), inp = useRef(), stop = useRef(null);
  const route = location.hash.slice(1) || '/';
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40).map(({ pending, ...m }) => m))); } catch {} log.current?.scrollTo({ top: log.current.scrollHeight, behavior: still() ? 'auto' : 'smooth' }); }, [msgs]);
  useEffect(() => { inp.current?.focus(); if (first) send(first); return () => stop.current?.abort(); }, []);
  useEffect(() => { setScope(project || ''); }, [project]);
  useEffect(() => { const away = () => close(true); addEventListener('hashchange', away); return () => removeEventListener('hashchange', away); }, []); // a link in an answer opens its page; the chat waits for next time
  const last = (fn) => setMsgs((ms) => { const c = [...ms]; c[c.length - 1] = fn(c[c.length - 1]); return c; });
  const close = (now) => { stop.current?.abort(); if (now === true || still()) { onClose(); return; } setLeaving(true); setTimeout(onClose, 180); };

  async function send(question) {
    question = String(question || '').trim();
    if (!question || busy) return;
    const history = load().filter((m) => m.content).map(({ role, content }) => ({ role, content }));
    setMsgs((ms) => [...ms, { role: 'user', content: question }, { role: 'assistant', content: '', steps: [], pending: true, t0: Date.now() }]);
    setText(''); setBusy(true);
    if (inp.current) inp.current.style.height = 'auto';
    const ac = (stop.current = new AbortController());
    try {
      const r = await fetch('/api/ai/chat', { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', 'x-trace': '1' }, body: JSON.stringify({ question, history, project: scope || null, context: route }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const l of lines.filter(Boolean)) {
          const ev = JSON.parse(l);
          if (ev.type === 'wait') last((m) => ({ ...m, wait: ev.seconds }));
          if (ev.type === 'step' && !ev.done) last((m) => ({ ...m, wait: null, steps: [...m.steps, { tool: ev.tool, args: ev.args, state: 'run' }] }));
          if (ev.type === 'step' && ev.done) last((m) => { const steps = [...m.steps]; const i = steps.map((x) => x.tool).lastIndexOf(ev.tool); const st = { ...(steps[i] || { tool: ev.tool, args: ev.args }), state: ev.error ? 'err' : 'ok', error: ev.error, link: ev.link, proposal: ev.proposal, count: ev.count }; if (i >= 0) steps[i] = st; else steps.push(st); return { ...m, steps }; });
          if (ev.type === 'answer') last((m) => ({ ...m, content: ev.text, followups: ev.followups || [], pending: false, ms: Date.now() - (m.t0 || Date.now()) }));
          if (ev.type === 'error') last((m) => ({ ...m, error: ev.error, pending: false }));
        }
      }
    } catch (e) { last((m) => ({ ...m, error: e.name === 'AbortError' ? 'Stopped.' : e.message, pending: false })); }
    last((m) => ({ ...m, pending: false, steps: (m.steps || []).map((x) => (x.state === 'run' ? { ...x, state: 'ok' } : x)) }));
    setBusy(false);
    setTimeout(() => inp.current?.focus(), 0);
  }
  const projects = me?.projects || [];
  const ready = ai?.ready;
  const name = projects.find((p) => p.id === scope)?.name;
  return html`<dialog class=${`askm${leaving ? ' leaving' : ''}`} aria-label="Ask Trace" ref=${(d) => d && !d.open && d.showModal()} onClose=${() => close(true)} onCancel=${(e) => { e.preventDefault(); close(); }}>
    <div class="aurora" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="askm-in">
      <header class="askm-top">
        ${msgs.length > 0 && html`<button class="btn sm ghost" onClick=${() => { stop.current?.abort(); setMsgs([]); inp.current?.focus(); }}><${Icon} n="note-pencil" />New chat</button>`}
        <button class="ibtn askm-x" aria-label="Close" data-tip="Close" data-kbd="Esc" onClick=${() => close()}><${Icon} n="x" /></button>
      </header>
      <div class="askm-main" ref=${log}>${msgs.length > 0 && html`<div class="ask-log" aria-live="polite">${msgs.map((m, i) => html`<${Turn} m=${m} key=${i} onAsk=${send} />`)}</div>`}</div>
      <div class="askm-compose">
        <div class="ask-quick" role="group" aria-label="Quick actions">${ai && !ready ? html`<a class="ask-setup" href="#/settings/ai" onClick=${() => close(true)}><${Icon} n="key" />Add your AI Gateway key to start</a>`
          : quick(route, !!scope).map(([icon, label, q], i) => html`<button style=${{ '--i': i }} onClick=${() => send(q)} disabled=${busy} data-tip=${q}><${Icon} n=${icon} />${label}</button>`)}</div>
        <form class="ask-in" onSubmit=${(e) => { e.preventDefault(); send(text); }}>
          <textarea ref=${inp} rows="1" value=${text} placeholder=${name ? `Ask about ${name}…` : 'Ask about your projects…'} aria-label="Your question"
            onInput=${(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`; }}
            onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}></textarea>
          <div class="ask-in-row">
            <label class="ask-scope-w"><${Icon} n="folder-simple" /><select class="ask-scope" value=${scope} onChange=${(e) => setScope(e.target.value)} aria-label="Ask about">
              <option value="">All projects</option>${projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select></label>
            <span class="grow"></span>
            ${busy ? html`<button type="button" class="ask-send" aria-label="Stop" data-tip="Stop" onClick=${() => stop.current?.abort()}><${Icon} n="stop" /></button>`
              : html`<button class="ask-send" aria-label="Send" data-tip="Send" data-kbd="↵" disabled=${!text.trim()}><${Icon} n="arrow-up" /></button>`}
          </div>
        </form>
      </div>
    </div>
  </dialog>`;
}

// A file from a project's folder, opened from search: its text with the matching line in view.
export function FileView({ project, file, onClose }) {
  const full = `${file.root}/${file.rel}`;
  const { data, error } = useFetch(`/projects/${project}/file?path=${encodeURIComponent(full)}`);
  const pre = useRef();
  useEffect(() => { if (data && file.line) pre.current?.querySelector(`[data-l="${file.line}"]`)?.scrollIntoView({ block: 'center' }); }, [data]);
  return html`<${Dialog} title=${file.rel} size="lg" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${() => copy(full, 'Path copied')}><${Icon} n="copy" />Copy path</button><button class="btn primary" onClick=${() => { onClose(); dispatchEvent(new CustomEvent('trace:ask', { detail: { q: `Explain ${file.rel}: what it does and how it relates to the design.`, project } })); }}><${Icon} n="chat-teardrop-dots" />Ask about this file</button>`}>
    ${error ? html`<div class="errbox">${error.message}</div>` : !data ? html`<div class="skeleton" style="height:300px"></div>`
      : html`<pre class="code fileview" ref=${pre}>${data.text.split('\n').map((l, i) => html`<span data-l=${i + 1} class=${i + 1 === file.line ? 'hit' : ''}><i>${i + 1}</i>${l || ' '}</span>`)}</pre>${data.truncated && html`<p class="tiny muted">Showing the first 200 KB.</p>`}`}
  </${Dialog}>`;
}
