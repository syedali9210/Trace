// Ask Trace: one chat over every project, its folders, its AIs' memory and connected tools, opened from the dock
// (or Ctrl J), and aware of the page you're on. Trace's AI (Vercel's AI Gateway, your key) works through the same
// tools agents use over MCP. Fluid Functionalism's ThinkingSteps for the tools it runs (they fold away once it
// answers), InputMessage as the box; while it works, a quiet dot and the step it's on; the rest is Trace's own reading layout.
import { useState, useEffect, useRef, api, useFetch, useMe, useAi, Icon, Dialog, toast, fail, copy, Button, Badge, ph, Tip, ErrorBox, rel, plural, sx, cn } from '../lib.jsx';
import { md } from './artifacts.jsx';
import { changeText } from './home.jsx';
import { ThinkingSteps, ThinkingStepsHeader, ThinkingStepsContent, ThinkingStep } from '@/components/ui/thinking-steps';
import { InputMessage } from '@/components/ui/input-message';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { Banner, BannerTitle, BannerActions, BannerAction } from '@/components/ui/banner';

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const q = (a) => (a?.query ? `for “${String(a.query).slice(0, 40)}”` : '');
// Each tool as a step: its label, and the icon slot Fluid Functionalism's ThinkingStep draws for it.
const STEP = {
  search: (a) => ['search', `Searched Trace ${q(a)}`],
  search_files: (a) => ['folder', `Searched the project’s folders ${q(a)}`],
  read_file: (a) => ['square-library', `Read ${a.path}`],
  recall: (a) => ['brain', `Searched what your AIs remember ${q(a)}`],
  get_block: (a) => ['square-library', `Read ${a.block}`],
  get_project_context: () => ['folder', 'Read the project'],
  list_projects: () => ['folder', 'Looked through your projects'],
  get_changes: () => ['clock', 'Read the latest changes'],
  get_moment: () => ['clock', 'Opened a change'],
  get_comments: () => ['message-circle', 'Read the reviews'],
  get_references: () => ['image', 'Read the references'],
  get_decisions: () => ['check', 'Read the decisions'],
  get_design_tokens: () => ['palette', 'Read the design tokens'],
  get_case_study: () => ['square-library', 'Read the case study'],
  add_note: (a) => ['pencil', `Added a note to ${a.kind === 'constraint' ? 'constraints' : a.block || 'brainstorm'}`],
  add_task: (a) => ['check', `Added a task: ${a.title}`],
  answer_case_study: (a) => ['pencil', `Answered “${a.section}” in the case study`],
  add_insight: () => ['lightbulb', 'Saved an insight'],
  post_comment: () => ['message-circle', 'Posted a comment'],
  update_issue: (a) => ['check', `Moved a task to ${String(a.status || '').replace('_', ' ')}`],
  add_artifact: (a) => ['star', `Added an artifact: ${a.title}`],
  remember: () => ['brain', 'Left a note for your agents'],
  propose_file: (a) => ['pencil', `Wants to write ${a.path}`],
};
const WRITES = new Set(['add_note', 'add_task', 'answer_case_study', 'add_insight', 'post_comment', 'update_issue', 'add_artifact', 'remember']);
// Links to this Trace open in place; the rest open a new tab.
const local = (origin) => origin === location.origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
const answer = (text) => md(text).replace(/<a href="(https?:\/\/[^"]+?)\/#([^"]*)" target="_blank" rel="noopener">/g, (m, origin, hash) => (local(origin) ? `<a href="#${hash}">` : m))
  .replace(/\s?\[(mo_[\w-]+)\]/g, ' <a class="cite" href="#/m/$1" title="Open this change">change</a>').replace(/\s?\[(?:p|as|sn|is|iss|ref|dec|ev|md)_[\w-]+\]/g, '')
  .replace(/\s?\((?:id:?\s*)?(?:p|as|sn|is|iss|ref|dec|ev|md)_[A-Za-z0-9-]{6,}\)/g, '').replace(/(?<![/\w"#=])(?:p|as|sn|ev|md)_[A-Za-z0-9-]{8}\b/g, '') // the ids it cites become a link to the change, never a code in the prose (links keep theirs)
  .replace(/(?:(?:the|a)\s+)?(?:moment|change)\s+(?:id\s+)?(?<![/\w"#=])(mo_[A-Za-z0-9-]{6,})\b/gi, '<a class="cite" href="#/m/$1" title="Open this change">change</a>').replace(/(?<![/\w"#=>])(mo_[A-Za-z0-9-]{6,})\b/g, '<a class="cite" href="#/m/$1" title="Open this change">change</a>'); // "moment mo_f1Q…" written into the prose

function Proposal({ s }) {
  const [state, setState] = useState(null);
  const apply = () => api(`/ai/files/${s.proposal}`, { method: 'POST' }).then((r) => { setState('written'); toast(`Wrote ${r.rel}`); }).catch(fail);
  const drop = () => api(`/ai/files/${s.proposal}`, { method: 'DELETE' }).then(() => setState('dropped')).catch(fail);
  return (<div className="proposal">
    <div className="row"><Icon n="file-plus" /><b className="trunc grow">{s.args.path}</b>{state && (<Badge color={state === 'written' ? 'green' : 'gray'}>{state === 'written' ? 'Written' : 'Discarded'}</Badge>)}</div>
    {s.args.why && (<p className="small muted">{s.args.why}</p>)}
    <pre className="code">{String(s.args.content || '').split('\n').slice(0, 24).join('\n')}{String(s.args.content || '').split('\n').length > 24 ? '\n…' : ''}</pre>
    {!state && (<div className="row"><Button variant="primary" size="compact" onClick={apply}>Write the file</Button><Button variant="ghost" size="compact" onClick={drop}>Discard</Button></div>)}
  </div>);
}

// Seconds since the question, ticking while the AI works.
function Elapsed({ from }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t); }, []);
  return (<span className="num">{((Date.now() - from) / 1000).toFixed(1)}s</span>);
}

function Steps({ m }) {
  const steps = m.steps || [];
  const [open, setOpen] = useState(true);
  useEffect(() => { if (!m.pending) setOpen(false); }, [m.pending]); // they fold away once it answers
  if (!steps.length) return null;
  const head = m.pending ? 'Working' : `Worked through ${steps.length} step${steps.length === 1 ? '' : 's'}${m.ms ? ` · ${(m.ms / 1000).toFixed(1)}s` : ''}`;
  return (<ThinkingSteps open={open} onOpenChange={setOpen} className="ai-trace">
    <ThinkingStepsHeader>{head}</ThinkingStepsHeader>
    <ThinkingStepsContent>
      {steps.map((s, i) => { const [icon, label] = (STEP[s.tool] || (() => ['dot', s.tool]))(s.args || {}); return (
        <ThinkingStep key={i} icon={s.state === 'err' ? 'info' : icon} label={label} status={s.state === 'run' ? 'active' : 'complete'} isLast={i === steps.length - 1}
          description={s.state === 'err' ? s.error : s.count != null ? `${s.count} found` : WRITES.has(s.tool) && s.link ? 'Saved' : undefined} />); })}
    </ThinkingStepsContent>
  </ThinkingSteps>);
}

// The Ask button: beside the + in the dock on every page.
export const AskButton = () => (<Tip tip="Ask about your work" kbd="Ctrl J"><Button variant="ghost" className="fab-ask h-[38px] rounded-[10px] text-foreground" leadingIcon={ph('chat-teardrop-dots')} aria-label="Ask Trace" onClick={() => dispatchEvent(new CustomEvent('trace:ask'))}>Ask</Button></Tip>);

// Chats are kept in this browser: the newest 30, each with its project and its last 40 turns.
const CHATS = 'trace.ask.chats';
const titleOf = (msgs) => String(msgs.find((m) => m.role === 'user')?.content || 'New chat').replace(/\s+/g, ' ').slice(0, 80);
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function loadChats() {
  try { const c = JSON.parse(localStorage.getItem(CHATS)); if (Array.isArray(c)) return c; } catch {}
  const old = (() => { try { return JSON.parse(sessionStorage.getItem('trace.ask')) || []; } catch { return []; } })(); // the one chat the old Ask kept
  return old.length ? [{ id: newId(), title: titleOf(old), at: Date.now(), project: null, msgs: old }] : [];
}
const saveChats = (cs) => { try { localStorage.setItem(CHATS, JSON.stringify(cs.slice(0, 30).map((c) => ({ ...c, msgs: c.msgs.slice(-40).map(({ pending, t0, wait, ...m }) => m) })))); } catch {} };
const dayOf = (ts) => { const d = new Date(ts), t = new Date(); const days = Math.round((new Date(t.toDateString()) - new Date(d.toDateString())) / 864e5); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier'; };

// Where to start, from your own work: what changed in the projects you were last in, where one stands, what's open,
// what waits in Review, what your agents did. The page you came from asks its own question first.
function starters(feed, inbox, scope, route) {
  const p = route.split('?')[0].split('/').filter(Boolean);
  const ps = (feed?.projects || []).filter((x) => !scope || x.id === scope);
  const one = scope ? ps[0] : null;
  const out = [];
  if (p[0] === 'm') out.push({ icon: 'question', q: 'Why did this change, and what should I check?', ctx: 'The change you’re looking at' });
  if (p[0] === 'p' && p[2] === 'casestudy') out.push({ icon: 'book-open-text', q: 'Which case-study answers are weakest, and what would make them stronger?', ctx: 'This case study' });
  for (const x of ps.slice(0, one ? 1 : 2)) if (x.latest) out.push({ icon: 'clock-counter-clockwise', q: `What changed in ${x.name} lately, and why?`, ctx: `${changeText(x.latest, x.name)} · ${rel(x.last)}` });
  if (one) out.push({ icon: 'compass', q: `Where does ${one.name} stand, and what should I do next?`, ctx: one.next ? `Next: ${one.next}` : 'Its summary, tasks and reviews' });
  const tasks = ps.reduce((n, x) => n + (x.tasks?.length || 0), 0), reviews = ps.reduce((n, x) => n + (x.open_reviews || 0), 0);
  if (tasks) out.push({ icon: 'check-square', q: one ? `Which tasks are open in ${one.name}, and who has them?` : 'Which tasks are open across my projects, and who has them?', ctx: plural(tasks, 'open task') });
  if (reviews) out.push({ icon: 'chat-circle', q: one ? `What do the open reviews on ${one.name} ask for?` : 'Which reviews are still open, and what do they ask for?', ctx: plural(reviews, 'open review') });
  if (inbox && !one) out.push({ icon: 'tray', q: `What are the ${plural(inbox, 'upload')} waiting in Review, and where should they go?`, ctx: 'Review' });
  out.push({ icon: 'terminal-window', q: one ? `What did my coding agents change in ${one.name} this week?` : 'What did my coding agents do this week?', ctx: 'From Claude Code, Codex and your other AIs’ sessions' });
  if (!one && ps.length > 1) out.push({ icon: 'target', q: 'Which project needs me most right now, and why?', ctx: plural(ps.length, 'project') });
  return out.slice(0, 6);
}

// One turn of the conversation. Your question on the right; Trace's answer as a page to read, the steps it took
// folded above it, and under it: copy, ask again, and what to ask next.
function Turn({ m, prev, onAsk }) {
  if (m.role === 'user') return (<div className="ak-q">{m.content}</div>);
  const running = (m.steps || []).filter((s) => s.state === 'run').pop();
  const waiting = m.pending && !m.content;
  return (<div className="ak-a">
    <div className="ak-who"><span className="ak-mark" aria-hidden="true"><Icon n="chat-teardrop-dots" /></span><b>Trace</b>{!m.pending && m.ms ? (<span className="num">{(m.ms / 1000).toFixed(1)}s</span>) : null}</div>
    <Steps m={m} />
    {waiting && (<div className="ak-wait" role="status"><span className="ak-pulse" aria-hidden="true" /><span>{running ? (STEP[running.tool] || (() => ['', 'Working']))(running.args || {})[1] : m.wait ? `Waiting about ${m.wait}s for a turn (the free model takes 5 a minute)` : (m.steps || []).length ? 'Writing the answer' : 'Reading your work'}</span>{m.t0 && (<span className="num muted"><Elapsed from={m.t0} /></span>)}</div>)}
    {m.steps?.filter((s) => s.tool === 'propose_file' && s.proposal).map((s) => (<Proposal s={s} key={s.proposal} />))}
    {m.steps?.filter((s) => s.link && WRITES.has(s.tool)).map((s, i) => (<a key={i} className="ai-saved" href={s.link.replace(location.origin + '/', '')}><Icon n="arrow-up-right" />{(STEP[s.tool] || (() => ['', s.tool]))(s.args || {})[1]}</a>))}
    {m.content && (<div className="md typeset ak-md" dangerouslySetInnerHTML={{ __html: answer(m.content) }}></div>)}
    {m.error && (<Banner status="error" contrast="high"><BannerTitle>{m.error}</BannerTitle>{/Settings → AI/.test(m.error) ? (<BannerActions><BannerAction href="#/settings/ai">Open Settings → AI</BannerAction></BannerActions>) : prev && (<BannerActions><BannerAction onClick={() => onAsk(prev)}>Try again</BannerAction></BannerActions>)}</Banner>)}
    {!m.pending && m.content && (<div className="ak-acts">
      <Tip tip="Copy the answer"><Button variant="ghost" size="icon-compact" aria-label="Copy the answer" onClick={() => copy(m.content, 'Answer copied')}><Icon n="copy" size={15} /></Button></Tip>
      {prev && (<Tip tip="Ask it again"><Button variant="ghost" size="icon-compact" aria-label="Ask it again" onClick={() => onAsk(prev)}><Icon n="arrow-clockwise" size={15} /></Button></Tip>)}
    </div>)}
    {m.followups?.length > 0 && !m.pending && (<div className="ak-next"><span className="ak-k">Ask next</span>{m.followups.map((f) => (<button key={f} type="button" onClick={() => onAsk(f)}><Icon n="arrow-right" />{f}</button>))}</div>)}
  </div>);
}

// Ask: the whole screen. Chats on the left (kept in this browser), the conversation in a reading column, the box at
// the bottom. Before you ask: where to start, from your own work. The project it reads is picked in the box; the page
// you came from is part of what it knows. Esc closes; Ctrl J opens and closes it from anywhere.
export function Ask({ onClose, project, first }) {
  const me = useMe();
  const ai = useAi();
  const feed = useFetch('/feed');
  const [chats, setChats] = useState(loadChats);
  const [id, setId] = useState(() => { if (first) return null; const c = loadChats().sort((a, b) => b.at - a.at)[0]; return c && Date.now() - c.at < 15 * 60e3 ? c.id : null; }); // the chat from a moment ago carries on
  const cur = chats.find((c) => c.id === id);
  const [text, setText] = useState('');
  const [scope, setScope] = useState(cur?.project ?? project ?? '');
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState(false); // the chats, on a narrow screen
  const [leaving, setLeaving] = useState(false);
  const log = useRef(), box = useRef(), stop = useRef(null), idRef = useRef(id);
  const route = location.hash.slice(1) || '/';
  const msgs = cur?.msgs || [];
  useEffect(() => { saveChats(chats); }, [chats]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: still() ? 'auto' : 'smooth' }); }, [msgs.length, msgs[msgs.length - 1]?.content, msgs[msgs.length - 1]?.steps?.length]);
  useEffect(() => { setTimeout(() => box.current?.querySelector('textarea')?.focus(), 50); if (first) send(first); return () => stop.current?.abort(); }, []);
  useEffect(() => { const away = () => close(true); addEventListener('hashchange', away); return () => removeEventListener('hashchange', away); }, []); // a link in an answer opens its page; the chat waits for next time
  const patch = (cid, fn) => setChats((cs) => cs.map((c) => (c.id === cid ? fn(c) : c)));
  const close = (now) => { stop.current?.abort(); if (now === true || still()) { onClose(); return; } setLeaving(true); setTimeout(onClose, 160); };
  const open = (c) => { stop.current?.abort(); setBusy(false); idRef.current = c?.id || null; setId(c?.id || null); setScope(c ? c.project || '' : scope); setSide(false); setTimeout(() => box.current?.querySelector('textarea')?.focus(), 30); };
  const drop = (c) => { setChats((cs) => cs.filter((x) => x.id !== c.id)); if (c.id === id) open(null); toast('Chat deleted', { action: { label: 'Undo', fn: () => setChats((cs) => [c, ...cs]) } }); };

  async function send(question) {
    question = String(question || '').trim();
    if (!question || busy) return;
    let cid = idRef.current;
    const history = (chats.find((c) => c.id === cid)?.msgs || []).filter((m) => m.content).map(({ role, content }) => ({ role, content }));
    if (!cid) { cid = newId(); const c = { id: cid, title: question.replace(/\s+/g, ' ').slice(0, 80), at: Date.now(), project: scope || null, msgs: [] }; setChats((cs) => [c, ...cs]); idRef.current = cid; setId(cid); }
    patch(cid, (c) => ({ ...c, at: Date.now(), msgs: [...c.msgs, { role: 'user', content: question }, { role: 'assistant', content: '', steps: [], pending: true, t0: Date.now() }] }));
    const last = (fn) => patch(cid, (c) => { const ms = [...c.msgs]; ms[ms.length - 1] = fn(ms[ms.length - 1]); return { ...c, msgs: ms }; });
    setText(''); setBusy(true);
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
  }
  const projects = me?.projects || [];
  const ready = !ai || ai.ready;
  const name = projects.find((p) => p.id === scope)?.name;
  const asked = msgs.filter((m) => m.role === 'user').map((m) => m.content);
  const starts = starters(feed.data, me?.inbox || 0, scope, route);
  const sorted = [...chats].sort((a, b) => b.at - a.at);
  const groups = sorted.reduce((g, c) => { const k = dayOf(c.at); (g[k] ||= []).push(c); return g; }, {});
  const nameOf = (pid) => projects.find((p) => p.id === pid)?.name;
  return (<dialog className={cn('ak', leaving && 'leaving', side && 'side-open')} aria-label="Ask Trace" ref={(d) => d && !d.open && d.showModal()} onClose={() => close(true)} onCancel={(e) => { e.preventDefault(); if (side) setSide(false); else close(); }}>
    <aside className="ak-side" aria-label="Chats">
      <div className="ak-side-h"><Button variant="secondary" className="ak-newb" leadingIcon={ph('note-pencil')} onClick={() => open(null)}>New chat</Button></div>
      <nav className="ak-chats" aria-label="Your chats">
        {!sorted.length && (<p className="ak-none">Your chats show here. They’re kept in this browser.</p>)}
        {Object.entries(groups).map(([k, cs]) => (<div key={k} className="ak-g"><span className="ak-k">{k}</span>
          {cs.map((c) => (<div key={c.id} className={cn('ak-c', c.id === id && 'on')}>
            <button type="button" className="ak-cb" aria-current={c.id === id ? 'true' : undefined} onClick={() => open(c)}><span className="trunc">{c.title}</span><span className="ak-cp trunc">{nameOf(c.project) || 'All projects'}</span></button>
            <Tip tip="Delete this chat"><button type="button" className="ak-del" aria-label={`Delete “${c.title}”`} onClick={() => drop(c)}><Icon n="x" size={13} /></button></Tip>
          </div>))}
        </div>))}
      </nav>
    </aside>
    <button type="button" className="ak-scrim" aria-label="Close the chats" tabIndex={-1} onClick={() => setSide(false)} />
    <section className="ak-main">
      <header className="ak-top">
        <Button variant="ghost" size="icon" className="ak-sideb" aria-label="Your chats" onClick={() => setSide(true)}><Icon n="sidebar-simple" size={17} /></Button>
        <b className="trunc">{cur ? cur.title : 'New chat'}</b>
        <span className="grow"></span>
        {cur && (<Tip tip="New chat"><Button variant="ghost" size="icon" aria-label="New chat" onClick={() => open(null)}><Icon n="note-pencil" size={17} /></Button></Tip>)}
        <Tip tip="Close" kbd="Esc"><Button variant="ghost" size="icon" aria-label="Close" onClick={() => close()}><Icon n="x" size={17} /></Button></Tip>
      </header>
      <div className="ak-log" ref={log}>
        <div className={cn('ak-col', !msgs.length && 'blank')}>
          {msgs.length > 0 ? (<div className="ak-turns" aria-live="polite">{msgs.map((m, i) => (<Turn m={m} key={i} prev={m.role === 'assistant' ? msgs[i - 1]?.content : null} onAsk={send} />))}</div>)
            : (<div className="ak-start">
              <h1>{name ? `Ask about ${name}` : 'Ask about your work'}</h1>
              <p>{name ? `Trace reads ${name}’s changes, its code and docs, its case study and what your AIs remember, and links each thing it used.` : `Trace reads ${projects.length ? plural(projects.length, 'project') : 'your projects'}: their changes, code, case studies and what your AIs remember, and links each thing it used.`}</p>
              {!ready ? (<div className="ak-key"><Icon n="key" /><div className="col" style={sx('gap:4px;min-width:0')}><b>Ask needs your AI Gateway key</b><span className="small ink2">Trace’s AI runs on your Vercel AI Gateway key, kept on this computer. Add it once in Settings.</span></div><Button variant="primary" size="compact" render={<a href="#/settings/ai" onClick={() => close(true)} />}>Add the key</Button></div>)
                : (<><span className="ak-k">Start from your work</span>
                  <div className="ak-cards">{feed.loading && !feed.data ? [1, 2, 3, 4].map((k) => (<span key={k} className="skeleton ak-card-sk" />))
                    : starts.map((s, i) => (<button key={s.q} type="button" className="ak-card" style={sx({ '--i': i })} onClick={() => send(s.q)}><Icon n={s.icon} /><span className="ak-card-q">{s.q}</span><span className="ak-card-c trunc">{s.ctx}</span></button>))}</div></>)}
              {sorted.length > 0 && (<div className="ak-recent"><span className="ak-k">Carry on</span>{sorted.slice(0, 3).map((c) => (<button key={c.id} type="button" onClick={() => open(c)}><Icon n="chat-circle" /><span className="trunc">{c.title}</span><span className="muted small">{rel(c.at)}</span></button>))}</div>)}
            </div>)}
        </div>
      </div>
      <footer className="ak-compose" ref={box}>
        <InputMessage className="ak-box" textareaProps={{ className: 'ak-ta' }} value={text} onValueChange={setText} onSend={(t) => send(t)} minRows={1} maxRows={8}
          placeholder={!ready ? 'Add your AI key in Settings to ask' : name ? `Ask about ${name}…` : 'Ask about your projects…'} status={busy ? 'streaming' : 'idle'} onStop={() => stop.current?.abort()} history={asked} sendLabel="Ask" disabled={!ready}
          leftSlot={(<Select value={scope || 'all'} onValueChange={(v) => setScope(v === 'all' ? '' : v)}>
            <SelectTrigger variant="borderless" icon={ph('folder-simple')} placeholder="All projects" className="ak-scope" />
            <SelectContent>{[{ id: 'all', name: 'All projects' }, ...projects].map((p, i) => (<SelectItem key={p.id} index={i} value={p.id}>{p.name}</SelectItem>))}</SelectContent>
          </Select>)} />
        <p className="ak-hint">Answers come from your work and link what they used. <kbd>Enter</kbd> to ask, <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line.</p>
      </footer>
    </section>
  </dialog>);
}

// A file from a project's folder, opened from search: its text with the matching line in view.
export function FileView({ project, file, onClose }) {
  const full = `${file.root}/${file.rel}`;
  const { data, error } = useFetch(`/projects/${project}/file?path=${encodeURIComponent(full)}`);
  const pre = useRef();
  useEffect(() => { if (data && file.line) pre.current?.querySelector(`[data-l="${file.line}"]`)?.scrollIntoView({ block: 'center' }); }, [data]);
  return (<Dialog title={file.rel} size="lg" onClose={onClose} footer={<><Button variant="ghost" leadingIcon={ph('copy')} onClick={() => copy(full, 'Path copied')}>Copy path</Button><Button variant="primary" leadingIcon={ph('chat-teardrop-dots')} onClick={() => { onClose(); dispatchEvent(new CustomEvent('trace:ask', { detail: { q: `Explain ${file.rel}: what it does and how it relates to the design.`, project } })); }}>Ask about this file</Button></>}>
    {error ? (<ErrorBox error={error} />) : !data ? (<div className="skeleton" style={{ height: 300 }}></div>)
      : <><pre className="code fileview" ref={pre}>{data.text.split('\n').map((l, i) => (<span key={i} data-l={i + 1} className={i + 1 === file.line ? 'hit' : ''}><i>{i + 1}</i>{l || ' '}</span>))}</pre>{data.truncated && (<p className="tiny muted">Showing the first 200 KB.</p>)}</>}
  </Dialog>);
}
