// Shell, the NCS way: a quiet icon rail (kept exactly as it was), the page, one floating dock with + and Ask.
// ⌘K opens Fluid Functionalism's command menu; drop and paste work anywhere.
import { useState, useEffect, useRef, api, useRoute, go, toast, fail, onLive, Icon, uploadFiles, filesOfEntry, filesOfPick, addCodeFolder, useMe, refreshMe, rel, initials, ph, Button, Tip } from './lib.jsx';
import { Toaster } from '@/components/ui/sonner';
import { DropdownMenu, DropdownTrigger, DropdownContent, DropdownSeparator, DropdownLabel } from '@/components/ui/dropdown';
import { MenuItem } from '@/components/ui/menu-item';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { CommandMenu, CommandMenuDialog, CommandMenuInput, CommandMenuTabs, CommandMenuList, CommandMenuEmpty } from '@/components/ui/command-menu';
import { Latest, TodoHome } from './views/home.jsx';
import { Ask, AskButton, FileView } from './views/ask.jsx';
import { Projects } from './views/projects.jsx';
import { Inbox } from './views/inbox.jsx';
import { Project } from './views/project.jsx';
import { Moment } from './views/moment.jsx';
import { Asset } from './views/asset.jsx';
import { Proposal } from './views/proposal.jsx';
import { Deck } from './views/deck.jsx';
import { Settings } from './views/settings.jsx';
import { Activity } from './views/activity.jsx';
import { Memory } from './views/memory.jsx';
import { Onboarding } from './views/onboarding.jsx';
import { NewProject, AddLink } from './views/dialogs.jsx';

function route(r) {
  const [path] = r.split('?');
  const p = path.split('/').filter(Boolean);
  if (!p.length) return (<Latest />); // NCS's home: each project's newest work beside its changes
  switch (p[0]) {
    case 'projects': return (<Projects />);
    case 'latest': return (<Latest />);
    case 'todo': return (<TodoHome />);
    case 'inbox': return (<Inbox focus={p[1]} />);
    case 'p': return (<Project id={p[1]} key={p[1]} tab={p[2] || 'timeline'} sub={p[3]} />);
    case 'm': return (<Moment id={p[1]} key={p[1]} focus={p[2]} />);
    case 'asset': return (<Asset id={p[1]} key={p[1]} />);
    case 'c': return (<CommentJump id={p[1]} />);
    case 'proposal': return (<Proposal id={p[1]} key={p[1]} />);
    case 'deck': return (<Deck id={p[1]} key={p[1]} />);
    case 'settings': return (<Settings tab={p[1] || 'sources'} />);
    case 'memory': return (<Memory />);
    case 'activity': return (<Activity />);
    case 'onboarding': return (<Onboarding />);
  }
  return (<div className="content"><h1>Not found</h1><p className="muted">Nothing lives at this address. <a href="#/">Go home</a>.</p></div>);
}

// #/c/<id> → the moment or file the comment is on, with that thread in focus.
function CommentJump({ id }) {
  useEffect(() => {
    api(`/comments/${id}`).then((c) => {
      if (c.moment_id) location.replace(`#/m/${c.moment_id}/${id}`);
      else if (c.target_type === 'asset') location.replace(`#/asset/${c.target_id}`);
      else if (c.target_type === 'proposal') location.replace(`#/proposal/${c.target_id}`);
      else if (c.target_type === 'version') location.replace(`#/p/${c.project_id}/history/${c.target_id.split(':')[1]}`);
      else location.replace(`#/p/${c.project_id}`);
    }).catch(fail);
  }, [id]);
  return (<div className="content muted">Opening the comment…</div>);
}

// ---------- theme: light (NCS white), dark, or the system's, as shadcn's .dark class ----------
const THEME_Q = '(prefers-color-scheme: dark)';
const saved = () => { try { return localStorage.getItem('trace:theme'); } catch { return null; } };
export function applyTheme(t = saved()) {
  document.documentElement.classList.toggle('dark', t === 'dark' || (t === 'system' && matchMedia(THEME_Q).matches));
  return t || 'light';
}
function useTheme() {
  const [t, set] = useState(() => applyTheme());
  useEffect(() => { const m = matchMedia(THEME_Q); const f = () => set(applyTheme()); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const choose = (next) => { try { next === 'light' ? localStorage.removeItem('trace:theme') : localStorage.setItem('trace:theme', next); } catch {} set(applyTheme(next === 'light' ? null : next)); };
  return [t, choose];
}

// ---------- the rail (unchanged) ----------
const RailLink = ({ href, icon, label, current, badge, onClick, kbd, ...rest }) => {
  const inner = <><Icon n={icon} />{badge ? (<span className="badge">{badge > 99 ? '99+' : badge}</span>) : ''}</>;
  return !href ? (<button className="rail-btn" aria-label={label} data-tip={label} data-kbd={kbd} data-side="right" onClick={onClick} {...rest}>{inner}</button>)
    : (<a className="rail-btn" href={href} aria-label={label} data-tip={label} data-kbd={kbd} data-side="right" aria-current={current ? 'page' : undefined}>{inner}</a>);
};

// The rail's own tooltips (name and shortcut): a beat before the first one, then they follow the pointer at once.
function Tips() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer, cur = null, warmUntil = 0;
    const place = (el) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect(), side = el.dataset.side || (r.top < 70 ? 'bottom' : 'top');
      setTip({ text: el.dataset.tip, kbd: el.dataset.kbd, side, x: side === 'right' ? r.right + 8 : r.left + r.width / 2, y: side === 'right' ? r.top + r.height / 2 : side === 'bottom' ? r.bottom + 8 : r.top - 8 });
    };
    const enter = (el) => {
      if (el === cur) return;
      clearTimeout(timer); cur = el;
      if (!el) { setTip((t) => { if (t) warmUntil = performance.now() + 400; return null; }); return; }
      const warm = performance.now() < warmUntil || !!document.querySelector('.tip');
      timer = setTimeout(() => place(el), warm ? 0 : 450);
    };
    const over = (e) => enter(e.target.closest?.('[data-tip]') || null);
    const focus = (e) => { if (e.target.dataset?.tip && e.target.matches(':focus-visible')) enter(e.target); };
    const off = () => { clearTimeout(timer); cur = null; setTip(null); };
    document.addEventListener('pointerover', over); document.addEventListener('focusin', focus); document.addEventListener('focusout', off);
    document.addEventListener('pointerdown', off, true); addEventListener('scroll', off, true); addEventListener('keydown', off, true);
    return () => { clearTimeout(timer); document.removeEventListener('pointerover', over); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', off); document.removeEventListener('pointerdown', off, true); removeEventListener('scroll', off, true); removeEventListener('keydown', off, true); };
  }, []);
  return tip && (<div className="tip" data-side={tip.side} role="tooltip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>{tip.text}{tip.kbd && (<span className="tip-k">{tip.kbd.split(' ').map((k) => (<kbd key={k}>{k}</kbd>))}</span>)}</div>);
}

// The +: files into the open project (or wherever they belong), a whole code folder as a project of its own (a
// file picker can't pick a folder), a link, a new project.
function AddMenu({ trigger, side, align, into, add }) {
  return (<DropdownMenu>
    <DropdownTrigger render={trigger} />
    <DropdownContent side={side} align={align}>
      <MenuItem index={0} icon={ph('upload-simple')} label={into ? `Files, into ${into}` : 'Files'} onSelect={() => add('files')} />
      <MenuItem index={1} icon={ph('folder-simple-plus')} label="A code folder, as a project" onSelect={() => add('folder')} />
      <MenuItem index={2} icon={ph('link-simple')} label="A link" onSelect={() => add('link')} />
      <DropdownSeparator />
      <MenuItem index={3} icon={ph('plus')} label="New project" onSelect={() => add('project')} />
    </DropdownContent>
  </DropdownMenu>);
}

function Rail({ me, r, openPalette, upload, theme, setTheme }) {
  const [notes, setNotes] = useState(null);
  const at = (x) => r === x || r.startsWith(`${x}/`);
  const guest = me?.user.guest;
  const togglePause = async () => { try { await api('/settings', { method: 'PATCH', body: { paused: !me.paused } }); await refreshMe(); toast(me.paused ? 'Capture resumed' : 'Capture paused. Nothing is read from your tools until you resume.'); } catch (e) { fail(e); } };
  const openNotes = async (open) => { if (!open) return; setNotes(await api('/notifications')); await api('/notifications/read', { method: 'POST' }); refreshMe(); };
  const inner = !['/', '/latest', '/todo', '/projects'].includes(r);
  const THEMES = [['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'circle-half', 'Follow the system']];
  const account = !guest ? [['Review', 'lightning', () => go('/inbox'), me?.inbox], ['Activity', 'pulse', () => go('/activity')], ['Settings', 'gear-six', () => go('/settings')], [me?.paused ? 'Resume capture' : 'Pause all capture', me?.paused ? 'play' : 'pause', togglePause]] : [];
  return (<nav className="rail" aria-label="Main">
    <div className="top">{inner ? (<RailLink icon="arrow-u-up-left" label="Back" onClick={() => (history.length > 1 ? history.back() : go('/'))} />) : ''}</div>
    <div className="mid">
      {!guest && (<RailLink href="#/" icon="house" label="Home" current={['/', '/latest', '/todo'].includes(r)} />)}
      <RailLink icon="magnifying-glass" label="Search" kbd="Ctrl K" onClick={openPalette} />
      {!guest && (<AddMenu side="right" align="start" add={upload} trigger={<button className="rail-btn plus" aria-label="Add files, a code folder or a link" data-tip="Add files, a code folder or a link" data-side="right"><Icon n="plus" /></button>} />)}
      <RailLink href={guest ? `#/p/${me?.user.project_id}` : '#/projects'} icon="folder" label="Projects" current={at('/projects') || at('/p')} />
      {!guest && (<RailLink href="#/memory" icon="brain" label="AI memory" current={at('/memory')} />)}
      {!guest && (<Popover onOpenChange={openNotes}>
        <PopoverTrigger render={<RailLink icon="bell" label="Notifications" badge={me?.unread} />} />
        <PopoverContent side="right" align="end" sideOffset={8} className="w-80 max-h-96 overflow-auto p-1.5 gap-0">
          {notes?.length ? notes.map((n, i) => (<a key={i} className="note-row" href={n.link || '#/'}><span>{n.text}</span><span className="tiny muted">{rel(n.created_at)}</span></a>)) : (<p className="small muted px-2.5 py-2">{notes ? 'Nothing new.' : 'Loading…'}</p>)}
        </PopoverContent>
      </Popover>)}
    </div>
    <DropdownMenu>
      <DropdownTrigger render={<button className="me" aria-label="Account and settings">{initials(me?.user.name || '?')}</button>} />
      <DropdownContent side="right" align="end" sideOffset={8}>
        <DropdownLabel>{me?.user.name} · {me?.workspace.name} ({me?.user.role})</DropdownLabel>
        {account.map(([label, icon, fn, n], i) => (<MenuItem key={label} index={i} icon={ph(icon)} label={n ? `${label} · ${n}` : label} onSelect={fn} />))}
        {account.length > 0 && <DropdownSeparator />}
        {THEMES.map(([v, icon, label], i) => (<MenuItem key={v} index={account.length + i} icon={ph(icon)} label={label} checked={theme === v} onSelect={() => setTheme(v)} />))}
      </DropdownContent>
    </DropdownMenu>
  </nav>);
}

// ⌘K: search everything (the work, every block's notes, case-study answers, a project's folders on disk, and what
// your AIs remember), ask Trace's AI, or run a command, scoped to a project and one of its folders.
// Fluid Functionalism's CommandMenu.
const here = () => location.hash.match(/^#\/p\/([^/?]+)/)?.[1] || null;
const ICON = { moment: 'git-commit', asset: 'file', comment: 'chat-circle', reference: 'images', decision: 'seal-check', artifact: 'sparkle', issue: 'check-square', proposal: 'git-pull-request', project: 'folder', sticky: 'note', idea: 'lightbulb', constraint: 'warning-diamond', insight: 'lightbulb', marker: 'map-pin', answer: 'book-open-text' };
const base = (d) => d.split(/[\\/]/).filter(Boolean).pop();
const THUMBS = new Map();
const thumbIcon = (key) => { if (!THUMBS.has(key)) { const C = ({ size = 16 }) => <img src={`/files/${key}`} alt="" className="shrink-0 rounded-[3px] bg-muted object-cover" style={{ width: size + 8, height: size + 2 }} />; THUMBS.set(key, C); } return THUMBS.get(key); };
function Palette({ open, setOpen, newProject, addLink }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState(here() || '');
  const [folder, setFolder] = useState('');
  const [res, setRes] = useState({ results: [], related: [], memory: [], notes: [], files: [], folders: [] });
  const me = useMe();
  useEffect(() => { if (open) { setScope(here() || ''); setFolder(''); } else setQ(''); }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes((r) => ({ results: [], related: [], memory: [], notes: [], files: [], folders: r.folders })); return; }
    const t = setTimeout(async () => {
      const qs = `q=${encodeURIComponent(q)}${scope ? `&project=${scope}` : ''}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`;
      const [s, m] = await Promise.all([api(`/search?${qs}`).catch(() => ({ results: [], related: [] })), me?.user.guest ? { results: [] } : api(`/memory/search?q=${encodeURIComponent(q)}&limit=4${scope ? `&project=${scope}` : ''}`).catch(() => ({ results: [] }))]);
      setRes({ notes: [], files: [], folders: [], ...s, memory: m.results });
    }, 160);
    return () => clearTimeout(t);
  }, [q, scope, folder]);
  const sub = (it) => (it.mem ? `${it.tool} · ${it.kind}${it.workspace ? ` · ${it.workspace}` : ''}` : it.related ? `Related: ${it.via}` : it.file ? [base(it.root), it.line && `line ${it.line}`, it.text].filter(Boolean).join(' · ') : [it.kind, it.project_name, it.when || it.text].filter(Boolean).join(' · '));
  const commands = [
    ['Go home', 'house', () => go('/')], ['To do', 'check-square', () => go('/todo')], ['Review what Trace wasn’t sure about', 'lightning', () => go('/inbox')],
    ['Ask your AI memory', 'brain', () => go('/memory')], ['New project', 'plus', newProject], ['Add a link (Figma, Framer, Spline…)', 'link-simple', addLink], ['Connect a tool', 'plugs-connected', () => go('/settings/sources')],
    ...(me?.projects || []).map((p) => [`Open ${p.name}`, 'folder', () => go(`/p/${p.id}`)]),
  ].filter(([label]) => !q || label.toLowerCase().includes(q.toLowerCase()));
  const row = (it, i, group, run) => ({ value: `${group}-${it.id || it.rel || it.title}-${i}`, label: it.title || '(untitled)', description: sub(it), icon: it.thumb_key ? thumbIcon(it.thumb_key) : ph(it.mem ? 'brain' : it.file ? 'file-code' : ICON[it.kind] || 'circle'), group, onSelect: run });
  const items = [
    ...(q.trim().length >= 2 && !me?.user.guest ? [{ value: 'ask', label: `Ask Trace: “${q.trim()}”`, icon: ph('chat-teardrop-dots'), group: 'Ask', action: 'Ask', onSelect: () => dispatchEvent(new CustomEvent('trace:ask', { detail: { q, project: scope || null } })) }] : []),
    ...res.results.map((r, i) => row(r, i, 'Your work', () => (location.hash = r.link))),
    ...res.notes.map((r, i) => row(r, i, 'Notes and answers', () => (location.hash = r.link))),
    ...res.files.map((r, i) => row({ ...r, file: true, title: r.rel }, i, 'In the folders', () => dispatchEvent(new CustomEvent('trace:file', { detail: { project: scope, file: r } })))),
    ...res.memory.map((r, i) => row({ ...r, mem: true }, i, 'What your AIs remember', () => go(`/memory?q=${encodeURIComponent(q)}`))),
    ...res.related.map((r, i) => row({ ...r, related: true }, i, 'Related', () => (location.hash = r.link))),
    ...commands.map(([label, icon, run]) => ({ value: `go-${label}`, label, icon: ph(icon), group: 'Go to', onSelect: run })),
  ];
  const tabs = [{ value: 'all', label: 'Everywhere' }, ...(me?.projects || []).filter((p) => p.id === scope || p.id === here()).map((p) => ({ value: p.id, label: p.name, icon: ph('folder') })), ...(scope ? (res.folders || []).map((d) => ({ value: `dir:${d}`, label: base(d), icon: ph('folder-open') })) : [])];
  const tab = folder ? `dir:${folder}` : scope || 'all';
  return (<CommandMenuDialog open={open} onOpenChange={setOpen} title="Search" description="Search your work, its folders and what your AIs remember, or run a command.">
    <CommandMenu items={items} query={q} onQueryChange={setQ} filter={() => true}>
      <CommandMenuInput placeholder={scope ? `Search ${me?.projects.find((p) => p.id === scope)?.name || 'this project'}: its work, notes and files…` : 'Search your work, notes and what your AIs remember…'} />
      {tabs.length > 1 && (<CommandMenuTabs tabs={tabs} value={tab} onValueChange={(v) => { if (v.startsWith('dir:')) setFolder(v.slice(4)); else { setScope(v === 'all' ? '' : v); setFolder(''); } }} />)}
      <CommandMenuList>
        <CommandMenuEmpty>Nothing matches yet.{!scope ? ' Pick a project to search its folders too.' : ''}</CommandMenuEmpty>
      </CommandMenuList>
    </CommandMenu>
  </CommandMenuDialog>);
}

export function App() {
  const r = useRoute();
  const me = useMe();
  const [theme, setTheme] = useTheme();
  const [pal, setPal] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [drag, setDrag] = useState(false);
  const [ask, setAsk] = useState(null); // the Ask panel: { project, q, n }
  const [view, setView] = useState(null); // a file from search
  const file = useRef(), folder = useRef();
  const add = (what) => (what === 'folder' ? folder.current?.click() : what === 'link' ? setDlg('link') : what === 'project' ? setDlg('project') : file.current?.click());
  const projectId = r.match(/^\/p\/([^/]+)/)?.[1];
  const projectName = me?.projects.find((p) => p.id === projectId)?.name;

  useEffect(() => { window.scrollTo(0, 0); }, [r.split('/').slice(0, 3).join('/')]);
  useEffect(() => { // shared counts stay live
    let t;
    return onLive((topic) => { if (['moment', 'project', 'notification', 'paused'].includes(topic)) { clearTimeout(t); t = setTimeout(() => refreshMe().catch(() => {}), 400); } });
  }, []);
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setAsk((v) => (v ? null : { project: here(), n: Date.now() })); }
      if (e.key === '/' && !e.target.closest('input, textarea, [contenteditable=true], [role=dialog]')) { e.preventDefault(); setPal(true); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  // Drop anywhere, paste anywhere: files are sorted into the open project (or wherever they belong); links become embeds.
  useEffect(() => {
    if (me?.user.guest) return;
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => { if (!hasFiles(e) || e.target.closest?.('[data-own-drop]')) return; depth++; setDrag(true); };
    const leave = (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDrag(false); };
    const over = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e) => {
      if (!hasFiles(e) || e.target.closest?.('[data-own-drop]')) return;
      e.preventDefault(); depth = 0; setDrag(false);
      const entries = [...e.dataTransfer.items].filter((it) => it.kind === 'file').map((it) => it.webkitGetAsEntry?.()), dirs = entries.filter((x) => x?.isDirectory); // a folder is a code folder: a project of its own
      for (const d of dirs) filesOfEntry(d).then((fs) => addCodeFolder(d.name, fs)).catch(fail);
      const files = [...e.dataTransfer.files].filter((_, i) => !entries[i]?.isDirectory);
      if (files.length) uploadFiles(files, { project_id: projectId });
    };
    const paste = (e) => {
      if (e.target.closest('input, textarea, [contenteditable=true]')) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); return uploadFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `Pasted ${new Date().toISOString().slice(0, 16).replace('T', ' ')}${i ? ` ${i + 1}` : ''}.png`, { type: f.type }))), { project_id: projectId }); }
      const text = e.clipboardData?.getData('text')?.trim();
      if (/^https?:\/\/\S+$/.test(text || '')) { e.preventDefault(); api('/links', { method: 'POST', body: { url: text, project_id: projectId } }).then(() => toast('Link added; snapshot on its way.')).catch(fail); }
    };
    addEventListener('dragenter', enter); addEventListener('dragleave', leave); addEventListener('dragover', over); addEventListener('drop', drop); addEventListener('paste', paste);
    return () => { removeEventListener('dragenter', enter); removeEventListener('dragleave', leave); removeEventListener('dragover', over); removeEventListener('drop', drop); removeEventListener('paste', paste); };
  }, [projectId, me?.user.guest]);
  useEffect(() => { // first run goes through onboarding
    if (me && !me.onboarded && me.user.role === 'owner' && r !== '/onboarding') go('/onboarding');
  }, [me?.onboarded, r]);
  useEffect(() => { // pages can open the shared upload / link / new-project actions
    const up = () => file.current?.click(), link = () => setDlg('link'), np = () => setDlg('project'), find = () => setPal(true);
    const asked = (e) => setAsk({ project: e.detail?.project !== undefined ? e.detail.project : here(), q: e.detail?.q, n: Date.now() }), open = (e) => setView(e.detail);
    addEventListener('trace:upload', up); addEventListener('trace:link', link); addEventListener('trace:new-project', np); addEventListener('trace:search', find); addEventListener('trace:ask', asked); addEventListener('trace:file', open);
    return () => { removeEventListener('trace:upload', up); removeEventListener('trace:link', link); removeEventListener('trace:new-project', np); removeEventListener('trace:search', find); removeEventListener('trace:ask', asked); removeEventListener('trace:file', open); };
  }, []);

  const toaster = (<Toaster theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'} position="bottom-center" offset={92} />);
  if (r === '/onboarding') return <>{route(r)}{toaster}</>;
  const fab = !me?.user.guest && !/^\/p\/[^/]+(\/(timeline|journey|design|history(\/\w+)?))?$/.test(r); // a project's timeline, history and design have their own bars
  const focus = /^\/p\//.test(r); // a project fills the window, like NCS: back arrow, no rail
  return (<div className={`shell${focus ? ' focus' : ''}`}>
    <Rail me={me} r={r} openPalette={() => setPal(true)} upload={add} theme={theme} setTheme={setTheme} />
    <main className="main" id="main"><div className="page" key={r.split('/').slice(0, 3).join('/')}>{route(r)}</div></main>{/* another page fades in; a project's own tabs don't */}
    <input type="file" multiple hidden ref={file} onChange={(e) => { uploadFiles(e.target.files, { project_id: projectId }); e.target.value = ''; }} />
    <input type="file" hidden webkitdirectory="" ref={folder} onChange={(e) => { const list = e.target.files; if (list?.length) addCodeFolder(list[0].webkitRelativePath.split('/')[0], filesOfPick(list)); e.target.value = ''; }} />
    {fab && (<div className="fab-bar">
      <AddMenu side="top" align="center" into={projectName} add={add} trigger={<Button variant="primary" size="icon" className="fab h-[38px] w-[58px] rounded-[10px]" aria-label="Add files, a code folder or a link" data-tip="Add files, a code folder or a link"><Icon n="plus" size={18} /></Button>} />
      <AskButton />
    </div>)}
    <Tips />
    {!me?.user.guest && (<Palette open={pal} setOpen={setPal} newProject={() => setDlg('project')} addLink={() => setDlg('link')} />)}
    {ask && (<Ask key={ask.n} project={ask.project} first={ask.q} onClose={() => setAsk(null)} />)}
    {view && (<FileView project={view.project} file={view.file} onClose={() => setView(null)} />)}
    {dlg === 'project' && (<NewProject onClose={() => setDlg(null)} />)}
    {dlg === 'link' && (<AddLink project_id={projectId} onClose={() => setDlg(null)} />)}
    {drag && (<div className="drop-veil" aria-hidden="true"><div><Icon n="files" /><span>Drop files or a code folder</span><span className="small muted">{projectName ? `Files go into ${projectName}; a folder becomes its own project` : 'Trace sorts files into the right project; a folder becomes its own project'}</span></div></div>)}
    {toaster}
  </div>);
}
