// Artifacts, laid out like Claude's: the artifact's story on the left (what was asked, who made it, its code), and
// the artifact itself on the right, running: HTML, React/JSX (compiled by Trace, its packages from esm.sh), SVG,
// pictures and markdown. Agents add theirs over MCP (add_artifact); you can paste, upload or link your own.
import { html, useState, useEffect, useRef, api, useFetch, Icon, Avatar, Dialog, Field, Seg, ErrorBox, Loading, Empty, fileUrl, toast, fail, copy, go, rel, stamp } from '../lib.js';

// Markdown to safe HTML: escaped first, then headings, lists, code, tables, emphasis and links.
export function md(src = '') {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [], lines = String(src).replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]); out.push(`<pre class="code">${esc(buf.join('\n'))}</pre>`); continue; }
    if (/^#{1,4}\s/.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n + 1}>${inline(l.replace(/^#+\s*/, ''))}</h${n + 1}>`); continue; }
    if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = row(l); i++; const body = [];
      while (i + 1 < lines.length && /^\|.*\|\s*$/.test(lines[i + 1])) body.push(row(lines[++i]));
      out.push(`<table class="t"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    if (/^\s*([-*+]|\d+\.)\s/.test(l)) { const ord = /^\s*\d+\./.test(l), buf = []; i--; while (++i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i])) buf.push(`<li>${inline(lines[i].replace(/^\s*([-*+]|\d+\.)\s/, ''))}</li>`); i--; out.push(`<${ord ? 'ol' : 'ul'}>${buf.join('')}</${ord ? 'ol' : 'ul'}>`); continue; }
    if (l.trim()) { const buf = [l]; while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\s*[-*+]\s|\|)/.test(lines[i + 1])) buf.push(lines[++i]); out.push(`<p>${inline(buf.join(' '))}</p>`); }
  }
  return out.join('\n');
}

const KIND = { react: 'JSX', html: 'HTML', svg: 'SVG', markdown: 'Markdown', image: 'Image', link: 'Link', code: 'Code', empty: '' };
const guess = (a) => { const c = String(a.content || '').trim(); return a.type === 'image' || a.file_key ? 'image' : /^<svg/i.test(c) ? 'svg' : /^(<!doctype|<html)|<(div|body|section)[\s>]/i.test(c) && !/\bimport\s/.test(c) ? 'html' : /from\s+['"]react['"]|export\s+default/.test(c) ? 'react' : /^#{1,3}\s|\n[-*]\s/.test(c) ? 'markdown' : a.url && !c ? 'link' : c ? 'code' : 'empty'; };

function Preview({ a, onClose }) {
  const kind = guess(a);
  const live = ['react', 'html', 'svg'].includes(kind);
  const { data, error, reload } = useFetch(live ? `/artifacts/${a.id}/preview` : null);
  const [n, setN] = useState(0); // a remount runs it fresh
  const openWindow = () => { const w = window.open('', '_blank', 'noopener'); if (w && data?.html) { w.document.write(data.html); w.document.close(); } };
  return html`<section class="art-pre" aria-label=${`${a.title}, running`}>
    <div class="art-bar">
      <span class="row" style="gap:6px;min-width:0"><${Icon} n=${live ? 'play-circle' : 'file'} /><b class="trunc">${a.title}</b><span class="muted small">· ${KIND[kind]}</span></span>
      <span class="grow"></span>
      ${a.content && html`<button class="btn sm ghost" onClick=${() => copy(a.content, 'Copied')}><${Icon} n="copy" />Copy</button>`}
      ${live && html`<button class="ibtn" aria-label="Run it again" title="Run again" onClick=${() => { setN(n + 1); reload(); }}><${Icon} n="arrow-clockwise" /></button>
        <button class="ibtn" aria-label="Open in a new window" title="Open in a new window" onClick=${openWindow}><${Icon} n="arrow-square-out" /></button>`}
      <button class="ibtn" aria-label="Close" title="Close" onClick=${onClose}><${Icon} n="x" /></button>
    </div>
    <div class="art-stage">
      ${live ? (error ? html`<p class="small muted pad">${error.message}</p>` : !data ? html`<div class="pad"><${Loading} h=${320} /></div>` : data.error ? html`<div class="pad"><p class="small"><b>It doesn’t compile:</b></p><pre class="code">${data.error}</pre></div>` : html`<iframe key=${n} class="art-frame" title=${a.title} sandbox="allow-scripts allow-forms allow-popups allow-modals" srcdoc=${data.html}></iframe>`)
      : kind === 'image' ? html`<div class="art-img"><img src=${fileUrl(a.file_key)} alt=${a.title} /></div>`
      : kind === 'markdown' ? html`<article class="art-md" dangerouslySetInnerHTML=${{ __html: md(a.content) }}></article>`
      : kind === 'link' ? html`<div class="pad col"><a class="btn" href=${a.url} target="_blank" rel="noopener"><${Icon} n="arrow-up-right" />Open ${a.url}</a></div>`
      : html`<pre class="code art-code">${a.content}</pre>`}
    </div>
  </section>`;
}

function AddArtifact({ p, onClose, onAdded }) {
  const [how, setHow] = useState('paste');
  const [f, setF] = useState({ title: '', content: '', url: '', note: '' });
  const [busy, setBusy] = useState(false);
  const file = useRef();
  const add = async () => {
    setBusy(true);
    try {
      let a;
      if (how === 'upload') { const fl = file.current.files[0]; if (!fl) throw new Error('Pick a file first.'); a = await api(`/projects/${p.id}/artifacts/upload`, { method: 'POST', raw: fl, headers: { 'x-filename': encodeURIComponent(fl.name) } }); }
      else a = await api(`/projects/${p.id}/artifacts`, { method: 'POST', body: { title: f.title, content: how === 'paste' ? f.content : '', url: how === 'link' ? f.url : null, note: f.note } });
      onAdded(a); onClose(); toast('Artifact added');
    } catch (e) { fail(e); }
    setBusy(false);
  };
  return html`<${Dialog} title="Add an artifact" size="lg" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn primary" onClick=${add} aria-disabled=${busy}>${busy ? 'Adding…' : 'Add'}</button>`}>
    <${Seg} label="How" value=${how} onChange=${setHow} options=${[{ value: 'paste', label: 'Paste', icon: 'clipboard-text' }, { value: 'upload', label: 'Upload', icon: 'upload-simple' }, { value: 'link', label: 'Link', icon: 'link-simple' }]} />
    ${how !== 'upload' && html`<${Field} label="Title" hint="Optional: Trace names it from the code"><input class="input" value=${f.title} onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>`}
    ${how === 'paste' && html`<${Field} label="The artifact" hint="React/JSX (like Claude makes), HTML, SVG or markdown. It runs on the right."><textarea class="input mono" rows="12" value=${f.content} onInput=${(e) => setF({ ...f, content: e.target.value })} spellcheck="false" autofocus></textarea></${Field}>`}
    ${how === 'upload' && html`<${Field} label="File" hint=".jsx, .tsx, .html, .svg, .md, or a picture"><input type="file" ref=${file} accept=".jsx,.tsx,.js,.html,.htm,.svg,.md,.mdx,.txt,image/*" /></${Field}>`}
    ${how === 'link' && html`<${Field} label="Link" hint="A prototype, a Claude artifact link, a deploy preview"><input class="input" type="url" value=${f.url} onInput=${(e) => setF({ ...f, url: e.target.value })} placeholder="https://" autofocus /></${Field}>`}
    ${how !== 'upload' && html`<${Field} label="Note" hint="What it is, or what you asked for"><textarea class="input" rows="2" value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })}></textarea></${Field}>`}
  </${Dialog}>`;
}

export function Artifacts({ p, sub }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/artifacts`, ['artifact'], (t, d) => d.project_id === p.id);
  const [adding, setAdding] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [again, setAgain] = useState('');
  const list = (data || []).filter((a) => a.status !== 'discarded');
  const a = list.find((x) => x.id === sub);
  useEffect(() => { if (!sub && list.length && matchMedia('(min-width: 900px)').matches) go(`/p/${p.id}/artifacts/${list[0].id}`); }, [!!data, sub]);
  const decide = (body) => api(`/artifacts/${a.id}`, { method: 'PATCH', body }).then(() => { toast(body.status === 'accepted' ? 'Accepted: it’s now on the timeline.' : body.request_changes ? 'Sent back with your note' : 'Discarded'); setAgain(''); reload(); }).catch(fail);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (!data) return html`<${Loading} h=${420} />`;
  return html`<div class=${`arts${a ? ' has' : ''}`}>
    <aside class="art-side">
      <div class="row"><b class="grow">${list.length} artifact${list.length === 1 ? '' : 's'}</b>${p.can_edit && html`<button class="btn sm" onClick=${() => setAdding(true)}><${Icon} n="plus" />Add</button>`}</div>
      ${!list.length ? html`<${Empty} icon="sparkle" title="No artifacts yet">What your AIs make (prototypes, components, copy, specs) lands here when they use Trace’s add_artifact. Or add your own: paste a Claude artifact and it runs here.</${Empty}>`
      : html`<nav class="art-list">${list.map((x) => html`<a href=${`#/p/${p.id}/artifacts/${x.id}`} aria-current=${x.id === sub ? 'page' : undefined} class="art-item">
          <span class="art-ico"><${Icon} n=${{ react: 'atom', html: 'browser', svg: 'shapes', markdown: 'article', image: 'image', link: 'link-simple' }[guess(x)] || 'code'} /></span>
          <span class="col grow" style="gap:0;min-width:0"><span class="trunc small" style="font-weight:500">${x.title}</span><span class="tiny muted trunc">${x.agent === 'you' ? 'Added by you' : x.agent}${x.model ? ` · ${x.model}` : ''} · ${rel(x.created_at)}</span></span>
          ${x.status === 'proposed' && html`<span class="chip sel">new</span>`}</a>`)}</nav>`}
      ${a && html`<article class="art-doc">
        <h2>${a.title}</h2>
        <div class="row wrap tiny muted" style="gap:6px"><${Avatar} name=${a.agent} agent=${a.agent !== 'you'} /><span>${a.agent === 'you' ? 'Added by you' : a.agent}${a.model ? ` · ${a.model}` : ''}</span><span>· ${stamp(a.created_at)}</span><span class=${`chip ${a.status === 'accepted' ? 'ok' : a.status === 'proposed' ? 'sel' : ''}`}>${a.status}</span></div>
        ${a.prompt && html`<div class="why"><span class="lbl">${a.agent === 'you' ? 'Note' : 'Asked'}</span><p class="small">${a.prompt}</p></div>`}
        ${a.source_comment_id && html`<a class="small" href=${`#/c/${a.source_comment_id}`}>From a comment</a>`}
        ${a.url && html`<a class="small trunc" href=${a.url} target="_blank" rel="noopener">${a.url}</a>`}
        ${guess(a) === 'markdown' ? html`<div class="art-md sm" dangerouslySetInnerHTML=${{ __html: md(a.content) }}></div>`
          : a.content && html`<div class="why"><button class="cs-ev-t" aria-expanded=${codeOpen} onClick=${() => setCodeOpen(!codeOpen)}><${Icon} n=${codeOpen ? 'caret-down' : 'caret-right'} />The code · ${a.content.split('\n').length} lines</button>${codeOpen && html`<pre class="code">${a.content}</pre>`}</div>`}
        ${a.status === 'proposed' && p.can_edit && html`<div class="col" style="gap:8px"><div class="row"><button class="btn sm primary" onClick=${() => decide({ status: 'accepted' })}>Accept</button><button class="btn sm ghost danger" onClick=${() => decide({ status: 'discarded' })}>Discard</button></div>
          ${a.source_comment_id && html`<div class="row"><input class="input sm" value=${again} onInput=${(e) => setAgain(e.target.value)} placeholder="Ask for changes…" aria-label="Ask for changes" /><button class="btn sm" onClick=${() => again.trim() && decide({ request_changes: again })}>Send back</button></div>`}</div>`}
        ${a.status !== 'proposed' && p.can_edit && html`<button class="btn sm ghost danger" style="align-self:flex-start" onClick=${() => decide({ status: 'discarded' })}><${Icon} n="trash" />Remove</button>`}
      </article>`}
    </aside>
    ${a ? html`<${Preview} a=${a} key=${a.id} onClose=${() => go(`/p/${p.id}/artifacts`)} />` : list.length > 0 && html`<div class="art-pre empty-pre"><p class="muted small">Pick an artifact to see it running.</p></div>`}
    ${adding && html`<${AddArtifact} p=${p} onClose=${() => setAdding(false)} onAdded=${(x) => { reload(); go(`/p/${p.id}/artifacts/${x.id}`); }} />`}
  </div>`;
}
