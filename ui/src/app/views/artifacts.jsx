// Artifacts, laid out like Claude's: the artifact's story on the left (what was asked, who made it, its code), and
// the artifact itself on the right, running: HTML, React/JSX (compiled by Trace, its packages from esm.sh), SVG,
// pictures and markdown. Agents add theirs over MCP (add_artifact); you can paste, upload or link your own.
import { useState, useEffect, useRef, api, useFetch, Icon, Avatar, Dialog, Field, Seg, ErrorBox, Loading, Empty, fileUrl, toast, fail, copy, go, rel, stamp, Button, ph, Chip, sx } from '../lib.jsx';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

// Markdown to safe HTML: escaped first, then headings, lists, code, tables, emphasis and links.
export function md(src = '') {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); // quotes too: a link's URL lands in an attribute
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
  const page = `/api/artifacts/${a.id}/preview?page=1&n=${n}`; // its own sandboxed address: never Trace's origin, even in a new window
  const openWindow = () => window.open(page, '_blank', 'noopener');
  return (<section className="art-pre" aria-label={`${a.title}, running`}>
    <div className="art-bar">
      <span className="row" style={sx("gap:6px;min-width:0")}><Icon n={live ? 'play-circle' : 'file'}  /><b className="trunc">{a.title}</b><span className="muted small">· {KIND[kind]}</span></span>
      <span className="grow"></span>
      {a.content && (<Button variant="ghost" size="compact" leadingIcon={ph("copy")} onClick={() => copy(a.content, 'Copied')}>Copy</Button>)}
      {live && <><Button variant="ghost" size="icon-compact" aria-label="Run it again" title="Run again" onClick={() => { setN(n + 1); reload(); }}><Icon n="arrow-clockwise" size={15} /></Button>
        <Button variant="ghost" size="icon-compact" aria-label="Open in a new window" title="Open in a new window" onClick={openWindow}><Icon n="arrow-square-out" size={15} /></Button></>}
      <Button variant="ghost" size="icon-compact" aria-label="Close" title="Close" onClick={onClose}><Icon n="x" size={15} /></Button>
    </div>
    <div className="art-stage">
      {live ? (error ? (<p className="small muted pad">{error.message}</p>) : !data ? (<div className="pad"><Loading h={320}  /></div>) : data.error ? (<div className="pad"><p className="small"><b>It doesn’t compile:</b></p><pre className="code">{data.error}</pre></div>) : (<iframe key={n} className="art-frame" title={a.title} sandbox="allow-scripts allow-forms allow-popups allow-modals" src={page}></iframe>))
      : kind === 'image' ? (<div className="art-img"><img src={fileUrl(a.file_key)} alt={a.title}  /></div>)
      : kind === 'markdown' ? (<article className="art-md" dangerouslySetInnerHTML={{ __html: md(a.content) }}></article>)
      : kind === 'link' ? (<div className="pad col"><Button variant="tertiary" size="default" leadingIcon={ph("arrow-up-right")} render={<a href={a.url} target="_blank" rel="noopener" />}>Open {a.url}</Button></div>)
      : (<pre className="code art-code">{a.content}</pre>)}
    </div>
  </section>);
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
  return (<Dialog title="Add an artifact" size="lg" onClose={onClose} footer={<><Button variant="ghost" size="default" onClick={onClose}>Cancel</Button><Button variant="primary" size="default" onClick={add} aria-disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button></>}>
    <Seg label="How" value={how} onChange={setHow} options={[{ value: 'paste', label: 'Paste', icon: 'clipboard-text' }, { value: 'upload', label: 'Upload', icon: 'upload-simple' }, { value: 'link', label: 'Link', icon: 'link-simple' }]}  />
    {how !== 'upload' && (<Field label="Title" hint="Optional: Trace names it from the code"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>)}
    {how === 'paste' && (<Field label="The artifact" hint="React/JSX (like Claude makes), HTML, SVG or markdown. It runs on the right."><Textarea className="mono" rows="12" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} spellCheck="false" autoFocus></Textarea></Field>)}
    {how === 'upload' && (<Field label="File" hint=".jsx, .tsx, .html, .svg, .md, or a picture"><input type="file" ref={file} accept=".jsx,.tsx,.js,.html,.htm,.svg,.md,.mdx,.txt,image/*"  /></Field>)}
    {how === 'link' && (<Field label="Link" hint="A prototype, a Claude artifact link, a deploy preview"><Input type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" autoFocus /></Field>)}
    {how !== 'upload' && (<Field label="Note" hint="What it is, or what you asked for"><Textarea rows="2" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })}></Textarea></Field>)}
  </Dialog>);
}

export function Artifacts({ p, sub }) {
  const { data, error, reload } = useFetch(`/projects/${p.id}/artifacts`, ['artifact'], (t, d) => d.project_id === p.id);
  const chats = useFetch(`/projects/${p.id}/insights/chats`); // what Claude said it made, in the chats
  const [adding, setAdding] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [again, setAgain] = useState('');
  const list = (data || []).filter((a) => a.status !== 'discarded');
  const a = list.find((x) => x.id === sub);
  useEffect(() => { if (!sub && list.length && matchMedia('(min-width: 900px)').matches) go(`/p/${p.id}/artifacts/${list[0].id}`); }, [!!data, sub]);
  const decide = (body) => api(`/artifacts/${a.id}`, { method: 'PATCH', body }).then(() => { toast(body.status === 'accepted' ? 'Accepted: it’s now on the timeline.' : body.request_changes ? 'Sent back with your note' : 'Discarded'); setAgain(''); reload(); }).catch(fail);
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (!data) return (<Loading h={420}  />);
  return (<div className={`arts${a ? ' has' : ''}`}>
    <aside className="art-side">
      <div className="row"><b className="grow">{list.length} artifact{list.length === 1 ? '' : 's'}</b>{p.can_edit && (<Button variant="tertiary" size="compact" leadingIcon={ph("plus")} onClick={() => setAdding(true)}>Add</Button>)}</div>
      {!list.length ? (<Empty icon="sparkle" title={chats.data?.made?.length ? 'Nothing added yet' : 'No artifacts yet'}>What your AIs make (prototypes, components, copy, specs) lands here when they use Trace’s add_artifact. Or add your own: paste a Claude artifact and it runs here.</Empty>)
      : (<nav className="art-list">{list.map((x, ki) => (<a key={x?.id ?? ki} href={`#/p/${p.id}/artifacts/${x.id}`} aria-current={x.id === sub ? 'page' : undefined} className="art-item">
          <span className="art-ico"><Icon n={{ react: 'atom', html: 'browser', svg: 'shapes', markdown: 'article', image: 'image', link: 'link-simple' }[guess(x)] || 'code'}  /></span>
          <span className="col grow" style={sx("gap:0;min-width:0")}><span className="trunc small" style={sx("font-weight:500")}>{x.title}</span><span className="tiny muted trunc">{x.agent === 'you' ? 'Added by you' : x.agent}{x.model ? ` · ${x.model}` : ''} · {rel(x.created_at)}</span></span>
          {x.status === 'proposed' && (<Chip tone="sel">new</Chip>)}</a>))}</nav>)}
      {chats.data?.made?.length > 0 && (<section className="col" style={sx('gap:6px;margin-top:16px')} aria-label="Made in your chats"><span className="caps">Made in your chats · {chats.data.made.length}</span>
        <nav className="art-list">{chats.data.made.map((m) => { const Tag = m.asset ? 'a' : 'div'; return (<Tag key={m.path} {...(m.asset ? { href: `#/asset/${m.asset}` } : {})} className="art-item" title={`Asked: ${m.asked}`}>
          <span className="art-ico"><Icon n={/\.(mp4|mov|webm|gif)$/i.test(m.path) ? 'film-strip' : /\.(png|jpe?g|webp|svg)$/i.test(m.path) ? 'image' : /\.pdf$/i.test(m.path) ? 'file-pdf' : /\.html?$/i.test(m.path) ? 'browser' : 'article'} /></span>
          <span className="col grow" style={sx('gap:0;min-width:0')}><span className="trunc small" style={sx('font-weight:500')}>{m.label}</span><span className="tiny muted trunc">{m.path} · {new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></span></Tag>); })}</nav></section>)}
      {a && (<article className="art-doc">
        <h2>{a.title}</h2>
        <div className="row wrap tiny muted" style={sx("gap:6px")}><Avatar name={a.agent} agent={a.agent !== 'you'}  /><span>{a.agent === 'you' ? 'Added by you' : a.agent}{a.model ? ` · ${a.model}` : ''}</span><span>· {stamp(a.created_at)}</span><span className={`chip ${a.status === 'accepted' ? 'ok' : a.status === 'proposed' ? 'sel' : ''}`}>{a.status}</span></div>
        {a.prompt && (<div className="why"><span className="lbl">{a.agent === 'you' ? 'Note' : 'Asked'}</span><p className="small">{a.prompt}</p></div>)}
        {a.source_comment_id && (<a className="small" href={`#/c/${a.source_comment_id}`}>From a comment</a>)}
        {a.url && (<a className="small trunc" href={a.url} target="_blank" rel="noopener">{a.url}</a>)}
        {guess(a) === 'markdown' ? (<div className="art-md sm" dangerouslySetInnerHTML={{ __html: md(a.content) }}></div>)
          : a.content && (<div className="why"><button className="cs-ev-t" aria-expanded={codeOpen} onClick={() => setCodeOpen(!codeOpen)}><Icon n={codeOpen ? 'caret-down' : 'caret-right'} swap  />The code · {a.content.split('\n').length} lines</button>{codeOpen && (<pre className="code">{a.content}</pre>)}</div>)}
        {a.status === 'proposed' && p.can_edit && (<div className="col" style={sx("gap:8px")}><div className="row"><Button variant="primary" size="compact" onClick={() => decide({ status: 'accepted' })}>Accept</Button><Button variant="ghost" size="compact" className="text-destructive" onClick={() => decide({ status: 'discarded' })}>Discard</Button></div>
          {a.source_comment_id && (<div className="row"><Input className="sm" value={again} onChange={(e) => setAgain(e.target.value)} placeholder="Ask for changes…" aria-label="Ask for changes" /><Button variant="tertiary" size="compact" onClick={() => again.trim() && decide({ request_changes: again })}>Send back</Button></div>)}</div>)}
        {a.status !== 'proposed' && p.can_edit && (<Button variant="ghost" size="compact" className="text-destructive" leadingIcon={ph("trash")} style={sx("align-self:flex-start")} onClick={() => decide({ status: 'discarded' })}>Remove</Button>)}
      </article>)}
    </aside>
    {a ? (<Preview a={a} key={a.id} onClose={() => go(`/p/${p.id}/artifacts`)}  />) : list.length > 0 && (<div className="art-pre empty-pre"><p className="muted small">Pick an artifact to see it running.</p></div>)}
    {adding && (<AddArtifact p={p} onClose={() => setAdding(false)} onAdded={(x) => { reload(); go(`/p/${p.id}/artifacts/${x.id}`); }}  />)}
  </div>);
}
