// Shell, the NCS way: a quiet icon rail, the page, one floating + button. Plus ⌘K, drop and paste anywhere.
import { html, render, useState, useEffect, useRef, api, useRoute, go, toast, fail, onLive, startLive, Icon, uploadFiles, useMe, refreshMe, rel, Thumb, initials, fluidHover } from './lib.js';
import { Latest, TodoHome } from './views/home.js';
import { Ask, AskButton, FileView } from './views/ask.js';
import { Projects } from './views/projects.js';
import { Inbox } from './views/inbox.js';
import { Project } from './views/project.js';
import { Moment } from './views/moment.js';
import { Asset } from './views/asset.js';
import { Proposal } from './views/proposal.js';
import { Deck } from './views/deck.js';
import { Settings } from './views/settings.js';
import { Activity } from './views/activity.js';
import { Memory } from './views/memory.js';
import { Onboarding } from './views/onboarding.js';
import { NewProject, AddLink } from './views/dialogs.js';

function route(r) {
  const [path] = r.split('?');
  const p = path.split('/').filter(Boolean);
  if (!p.length) return html`<${Latest} />`; // NCS's home: each project's newest work beside its changes
  switch (p[0]) {
    case 'projects': return html`<${Projects} />`;
    case 'latest': return html`<${Latest} />`;
    case 'todo': return html`<${TodoHome} />`;
    case 'inbox': return html`<${Inbox} focus=${p[1]} />`;
    case 'p': return html`<${Project} id=${p[1]} key=${p[1]} tab=${p[2] || 'timeline'} sub=${p[3]} />`;
    case 'm': return html`<${Moment} id=${p[1]} key=${p[1]} focus=${p[2]} />`;
    case 'asset': return html`<${Asset} id=${p[1]} key=${p[1]} />`;
    case 'c': return html`<${CommentJump} id=${p[1]} />`;
    case 'proposal': return html`<${Proposal} id=${p[1]} key=${p[1]} />`;
    case 'deck': return html`<${Deck} id=${p[1]} key=${p[1]} />`;
    case 'settings': return html`<${Settings} tab=${p[1] || 'sources'} />`;
    case 'memory': return html`<${Memory} />`;
    case 'activity': return html`<${Activity} />`;
    case 'onboarding': return html`<${Onboarding} />`;
  }
  return html`<div class="content"><h1>Not found</h1><p class="muted">Nothing lives at this address. <a href="#/">Go home</a>.</p></div>`;
}

// #/c/<id> → the moment or file the comment is on, with that thread in focus.
function CommentJump({ id }) {
  useEffect(() => {
    api(`/comments/${id}`).then((c) => {
      if (c.moment_id) location.replace(`#/m/${c.moment_id}/${id}`);
      else if (c.target_type === 'asset') location.replace(`#/asset/${c.target_id}`);
      else if (c.target_type === 'proposal') location.replace(`#/proposal/${c.target_id}`);
      else location.replace(`#/p/${c.project_id}`);
    }).catch(fail);
  }, [id]);
  return html`<div class="content muted">Opening the comment…</div>`;
}

function RailLink({ href, icon, label, current, badge, onClick, kbd }) {
  const inner = html`<${Icon} n=${icon} />${badge ? html`<span class="badge">${badge > 99 ? '99+' : badge}</span>` : ''}`;
  return onClick ? html`<button class="rail-btn" aria-label=${label} data-tip=${label} data-kbd=${kbd} data-side="right" onClick=${onClick}>${inner}</button>`
    : html`<a class="rail-btn" href=${href} aria-label=${label} data-tip=${label} data-kbd=${kbd} data-side="right" aria-current=${current ? 'page' : undefined}>${inner}</a>`;
}

// Tooltips that name the shortcut (Linear's way): a beat before the first one, then they follow the pointer from
// button to button at once. Keyboard focus shows them too.
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
  return tip && html`<div class="tip" data-side=${tip.side} role="tooltip" style=${{ left: `${tip.x}px`, top: `${tip.y}px` }}>${tip.text}${tip.kbd && html`<span class="tip-k">${tip.kbd.split(' ').map((k) => html`<kbd>${k}</kbd>`)}</span>`}</div>`;
}

function Rail({ me, r, openPalette, upload }) {
  const [menu, setMenu] = useState(null);
  const wrap = useRef();
  useEffect(() => {
    if (!menu) return;
    const off = (e) => { if (!wrap.current?.contains(e.target)) setMenu(null); };
    const esc = (e) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const at = (x) => r === x || r.startsWith(`${x}/`);
  const guest = me?.user.guest;
  const cycleTheme = () => {
    const cur = document.documentElement.dataset.theme;
    const next = !cur ? 'dark' : cur === 'dark' ? 'system' : '';
    if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
    try { next ? localStorage.setItem('trace:theme', next) : localStorage.removeItem('trace:theme'); } catch {}
    toast(`Theme: ${next === 'system' ? 'follows your system' : next || 'light'}`);
  };
  const togglePause = async () => { try { await api('/settings', { method: 'PATCH', body: { paused: !me.paused } }); await refreshMe(); toast(me.paused ? 'Capture resumed' : 'Capture paused. Nothing is read from your tools until you resume.'); } catch (e) { fail(e); } };
  const showNotes = async () => { if (menu?.notes) return setMenu(null); const n = await api('/notifications'); setMenu({ notes: n }); await api('/notifications/read', { method: 'POST' }); refreshMe(); };
  const inner = !['/', '/latest', '/todo', '/projects'].includes(r);
  return html`<nav class="rail" aria-label="Main" ref=${wrap}>
    <div class="top">${inner ? html`<${RailLink} icon="arrow-u-up-left" label="Back" onClick=${() => (history.length > 1 ? history.back() : go('/'))} />` : ''}</div>
    <div class="mid">
      ${!guest && html`<${RailLink} href="#/" icon="house" label="Home" current=${['/', '/latest', '/todo'].includes(r)} />`}
      <${RailLink} icon="magnifying-glass" label="Search" kbd="Ctrl K" onClick=${openPalette} />
      ${!guest && html`<button class="rail-btn plus" aria-label="Upload files" data-tip="Upload files" data-side="right" onClick=${upload}><${Icon} n="plus" /></button>`}
      <${RailLink} href=${guest ? `#/p/${me?.user.project_id}` : '#/projects'} icon="folder" label="Projects" current=${at('/projects') || at('/p')} />
      ${!guest && html`<${RailLink} href="#/memory" icon="brain" label="AI memory" current=${at('/memory')} />`}
      ${!guest && html`<div style="position:relative"><${RailLink} icon="bell" label="Notifications" badge=${me?.unread} onClick=${showNotes} />
        ${menu?.notes && html`<div class="pop" style="left:calc(100% + 8px);bottom:0;width:300px;max-height:360px;overflow:auto;transform-origin:bottom left">
          ${menu.notes.length ? menu.notes.map((n) => html`<a href=${n.link || '#/'} onClick=${() => setMenu(null)} style="flex-direction:column;align-items:flex-start;padding:8px 10px;height:auto"><span class="small">${n.text}</span><span class="tiny muted">${rel(n.created_at)}</span></a>`) : html`<p class="small muted" style="padding:8px 10px">Nothing new.</p>`}
        </div>`}</div>`}
    </div>
    <div style="position:relative">
      <button class="me" aria-label="Account and settings" aria-expanded=${menu === 'me'} onClick=${() => setMenu(menu === 'me' ? null : 'me')}>${initials(me?.user.name || '?')}</button>
      ${menu === 'me' && html`<div class="pop" style="left:calc(100% + 8px);bottom:0;transform-origin:bottom left">
        <div class="small" style="padding:6px 10px 8px"><b>${me?.user.name}</b><div class="tiny muted">${me?.workspace.name} · ${me?.user.role}</div></div>
        ${!guest && html`<a href="#/inbox" onClick=${() => setMenu(null)}><${Icon} n="lightning" />Review${me?.inbox ? html`<span class="muted" style="margin-left:auto">${me.inbox}</span>` : ''}</a>
        <a href="#/activity" onClick=${() => setMenu(null)}><${Icon} n="pulse" />Activity</a>
        <a href="#/settings" onClick=${() => setMenu(null)}><${Icon} n="gear-six" />Settings</a>
        <button onClick=${() => { setMenu(null); togglePause(); }}><span class=${`dot ${me?.paused ? 'warn' : 'on'}`} style="margin:0 3px"></span>${me?.paused ? 'Resume capture' : 'Pause all capture'}</button>`}
        <button onClick=${() => { setMenu(null); cycleTheme(); }}><${Icon} n="circle-half" />Theme</button>
      </div>`}
    </div>
  </nav>`;
}

// ⌘K: search everything (the work, every block's notes, case-study answers, a project's folders on disk, and what
// your AIs remember), ask Trace's AI, or run a command. Scope it to a project and one of its folders. No open/close animation.
const here = () => location.hash.match(/^#\/p\/([^/?]+)/)?.[1] || null;
function Palette({ onClose, newProject, addLink }) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState(here() || '');
  const [folder, setFolder] = useState('');
  const [res, setRes] = useState({ results: [], related: [], memory: [], notes: [], files: [], folders: [] });
  const [i, setI] = useState(0);
  const inp = useRef();
  const me = useMe();
  useEffect(() => { inp.current?.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes((r) => ({ results: [], related: [], memory: [], notes: [], files: [], folders: r.folders })); return; }
    const t = setTimeout(async () => {
      const qs = `q=${encodeURIComponent(q)}${scope ? `&project=${scope}` : ''}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`;
      const [s, m] = await Promise.all([api(`/search?${qs}`).catch(() => ({ results: [], related: [] })), me?.user.guest ? { results: [] } : api(`/memory/search?q=${encodeURIComponent(q)}&limit=4${scope ? `&project=${scope}` : ''}`).catch(() => ({ results: [] }))]);
      setRes({ notes: [], files: [], folders: [], ...s, memory: m.results });
    }, 160);
    return () => clearTimeout(t);
  }, [q, scope, folder]);
  const commands = [
    { label: 'Go home', icon: 'house', run: () => go('/') }, { label: 'To do', icon: 'check-square', run: () => go('/todo') }, { label: 'Review what Trace wasn’t sure about', icon: 'lightning', run: () => go('/inbox') },
    { label: 'Ask your AI memory', icon: 'brain', run: () => go('/memory') }, { label: 'New project', icon: 'plus', run: newProject },
    { label: 'Add a link (Figma, Framer, Spline…)', icon: 'link-simple', run: addLink }, { label: 'Connect a tool', icon: 'plugs-connected', run: () => go('/settings/sources') },
    ...(me?.projects || []).map((p) => ({ label: `Open ${p.name}`, icon: 'folder', run: () => go(`/p/${p.id}`) })),
  ].filter((c) => !q || c.label.toLowerCase().includes(q.toLowerCase()));
  const ask = () => dispatchEvent(new CustomEvent('trace:ask', { detail: { q, project: scope || null } }));
  const items = [
    ...(q.trim().length >= 2 && !me?.user.guest ? [{ cmd: true, icon: 'chat-teardrop-dots', label: `Ask Trace: “${q.trim()}”`, group: 'Ask', run: ask }] : []),
    ...res.results.map((r) => ({ ...r, group: 'Your work', run: () => (location.hash = r.link) })),
    ...res.notes.map((r) => ({ ...r, group: 'Notes and answers', run: () => (location.hash = r.link) })),
    ...res.files.map((r) => ({ ...r, file: true, title: r.rel, group: 'In the folders', run: () => dispatchEvent(new CustomEvent('trace:file', { detail: { project: scope, file: r } })) })),
    ...res.memory.map((r) => ({ ...r, mem: true, group: 'What your AIs remember', run: () => go(`/memory?q=${encodeURIComponent(q)}`) })),
    ...res.related.map((r) => ({ ...r, related: true, group: 'Related', run: () => (location.hash = r.link) })),
    ...commands.map((c) => ({ ...c, cmd: true, group: 'Go to' })),
  ];
  const pick = (it) => { onClose(); it.run(); };
  const ICON = { moment: 'git-commit', asset: 'file', comment: 'chat-circle', reference: 'images', decision: 'seal-check', artifact: 'sparkle', issue: 'check-square', proposal: 'git-pull-request', project: 'folder', sticky: 'note', idea: 'lightbulb', constraint: 'warning-diamond', insight: 'lightbulb', marker: 'map-pin', answer: 'book-open-text' };
  const base = (d) => d.split(/[\\/]/).filter(Boolean).pop();
  const sub = (it) => (it.mem ? `${it.tool} · ${it.kind}${it.workspace ? ` · ${it.workspace}` : ''}` : it.related ? `Related: ${it.via}` : it.file ? [base(it.root), it.line && `line ${it.line}`, it.text].filter(Boolean).join(' · ') : [it.kind, it.project_name, it.when || it.text].filter(Boolean).join(' · '));
  let lastGroup = '';
  return html`<dialog class="palette" ref=${(d) => d && !d.open && d.showModal()} onClose=${onClose} aria-label="Search" onClick=${(e) => e.target.tagName === 'DIALOG' && onClose()}>
    <input ref=${inp} value=${q} placeholder=${scope ? `Search ${me?.projects.find((p) => p.id === scope)?.name || 'this project'}: its work, notes and files…` : 'Search your work, notes and what your AIs remember…'} aria-label="Search" role="combobox" aria-expanded="true" aria-controls="pal-res" aria-activedescendant=${`pal-${i}`}
      onInput=${(e) => { setQ(e.target.value); setI(0); }}
      onKeyDown=${(e) => { if (e.key === 'ArrowDown') { setI(Math.min(items.length - 1, i + 1)); e.preventDefault(); } if (e.key === 'ArrowUp') { setI(Math.max(0, i - 1)); e.preventDefault(); } if (e.key === 'Enter' && items[i]) pick(items[i]); }} />
    ${!me?.user.guest && html`<div class="pal-scope" role="group" aria-label="Search in">
      <button aria-pressed=${!scope} onClick=${() => { setScope(''); setFolder(''); }}>Everywhere</button>
      ${(me?.projects || []).filter((p) => p.id === scope || p.id === here()).map((p) => html`<button aria-pressed=${scope === p.id && !folder} onClick=${() => { setScope(p.id); setFolder(''); }}><${Icon} n="folder" />${p.name}</button>`)}
      ${!scope && (me?.projects || []).length > 0 && html`<select aria-label="Pick a project" value="" onChange=${(e) => e.target.value && setScope(e.target.value)}><option value="">A project…</option>${me.projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}</select>`}
      ${scope && res.folders.map((d) => html`<button aria-pressed=${folder === d} title=${d} onClick=${() => setFolder(folder === d ? '' : d)}><${Icon} n="folder-open" />${base(d)}</button>`)}
    </div>`}
    <div class="res" id="pal-res" role="listbox">
      ${q.trim().length >= 2 && items.length <= 1 + commands.length && html`<p class="small muted" style="padding:8px 10px">Nothing matches yet.${!scope ? ' Pick a project to search its folders too.' : ''}</p>`}
      ${items.map((it, n) => { const head = it.group !== lastGroup ? ((lastGroup = it.group), html`<div class="group">${it.group}</div>`) : null; return html`${head}<div id=${`pal-${n}`} class=${`item${it.group === 'Ask' ? ' ask-row' : ''}`} role="option" aria-selected=${n === i} onMouseMove=${() => setI(n)} onClick=${() => pick(it)}>
        ${it.thumb_key ? html`<${Thumb} snap=${it} />` : html`<${Icon} n=${it.cmd ? it.icon : it.mem ? 'brain' : it.file ? 'file-code' : ICON[it.kind] || 'circle'} />`}
        <div class="grow"><div class="trunc small">${it.cmd ? it.label : it.title}</div>${!it.cmd && html`<div class="tiny muted trunc">${sub(it)}</div>`}</div>
      </div>`; })}
    </div>
  </dialog>`;
}

function App() {
  const r = useRoute();
  const me = useMe();
  const [pal, setPal] = useState(false);
  const [dlg, setDlg] = useState(null);
  const [drag, setDrag] = useState(false);
  const [ask, setAsk] = useState(null); // the Ask panel: { project, q, n }
  const [view, setView] = useState(null); // a file from search
  const file = useRef();
  const projectId = r.match(/^\/p\/([^/]+)/)?.[1];
  const projectName = me?.projects.find((p) => p.id === projectId)?.name;

  useEffect(() => { window.scrollTo(0, 0); }, [r.split('/').slice(0, 3).join('/')]);
  useEffect(() => { // shared counts stay live
    let t;
    return onLive((topic) => { if (['moment', 'project', 'notification', 'paused'].includes(topic)) { clearTimeout(t); t = setTimeout(() => refreshMe().catch(() => {}), 400); } });
  }, []);
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((v) => !v); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setAsk((v) => (v ? null : { project: here(), n: Date.now() })); }
      if (e.key === '/' && !e.target.closest('input, textarea, [contenteditable=true], dialog[open]')) { e.preventDefault(); setPal(true); }
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
    const drop = (e) => { if (!hasFiles(e) || e.target.closest?.('[data-own-drop]')) return; e.preventDefault(); depth = 0; setDrag(false); uploadFiles(e.dataTransfer.files, { project_id: projectId }); };
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

  if (r === '/onboarding') return route(r);
  const fab = !me?.user.guest && !/^\/p\/[^/]+(\/(timeline|journey))?$/.test(r); // a project's timeline has its own bar, with the annotate tools
  const focus = /^\/p\//.test(r); // a project fills the window, like NCS: back arrow, no rail
  return html`<div class=${`shell${focus ? ' focus' : ''}`}>
    <${Rail} me=${me} r=${r} openPalette=${() => setPal(true)} upload=${() => file.current?.click()} />
    <main class="main" id="main">${route(r)}</main>
    <input type="file" multiple hidden ref=${file} onChange=${(e) => { uploadFiles(e.target.files, { project_id: projectId }); e.target.value = ''; }} />
    ${fab && html`<div class="fab-bar">
      <button class="fab" onClick=${() => file.current?.click()} aria-label=${projectName ? `Upload to ${projectName}` : 'Upload files'} data-tip=${projectName ? `Upload to ${projectName}` : 'Upload files'}><${Icon} n="plus" /></button>
      <${AskButton} />
    </div>`}
    <${Tips} />
    ${pal && html`<${Palette} onClose=${() => setPal(false)} newProject=${() => setDlg('project')} addLink=${() => setDlg('link')} />`}
    ${ask && html`<${Ask} key=${ask.n} project=${ask.project} first=${ask.q} onClose=${() => setAsk(null)} />`}
    ${view && html`<${FileView} project=${view.project} file=${view.file} onClose=${() => setView(null)} />`}
    ${dlg === 'project' && html`<${NewProject} onClose=${() => setDlg(null)} />`}
    ${dlg === 'link' && html`<${AddLink} project_id=${projectId} onClose=${() => setDlg(null)} />`}
    ${drag && html`<div class="drop-veil" aria-hidden="true"><div><${Icon} n="files" /><span>Drop files here</span><span class="small muted">${projectName ? `They go into ${projectName}` : 'Trace sorts them into the right project'}</span></div></div>`}
  </div>`;
}

startLive();
render(html`<${App} />`, document.getElementById('app'));
fluidHover();
