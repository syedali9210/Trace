// Deck builder: the generated story, editable slide by slide; present, or export PPTX / PDF / Google Slides.
import { useState, useEffect, useRef, api, useFetch, Header, Icon, ErrorBox, Loading, Dialog, Menu, fileUrl, toast, fail, go, Button, ph, sx, Fragment } from '../lib.jsx';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

// One slide, drawn like its PPTX: a layout per kind. Its title and text are edited in place; the rest is the work's own.
function Slide({ s, mini, edit, onChange, accent }) {
  const imgs = (s.images || []).slice(0, s.kind === 'screens' || s.kind === 'beforeafter' ? 4 : 6);
  const field = (k, tag, cls) => { const T = tag; return edit
    ? (<T className={cls} contentEditable="true" suppressContentEditableWarning spellCheck="true" aria-label={k === 'title' ? 'Slide title' : 'Slide text'} onBlur={(e) => onChange({ [k]: e.currentTarget.innerText })}>{s[k] || ''}</T>)
    : (<T className={cls}>{s[k]}</T>); };
  const pic = (im, i) => (<figure key={im.key || i}><img src={fileUrl(im.key)} alt={im.caption || ''} />{im.caption && (<figcaption>{im.caption}</figcaption>)}
    {edit && (<Button variant="ghost" size="compact" className="no-print" onClick={() => onChange({ images: (s.images || []).filter((_, j) => j !== i) })}>Remove picture</Button>)}</figure>);
  const style = { '--acc': accent && accent !== '111113' ? `#${accent}` : '#171717' };
  const k = s.kind, base = `slide${mini ? ' mini' : ''}`;
  if (k === 'title') return (<div className={`${base} title-slide${imgs.length ? ' with-cover' : ''}`} style={style}>
    <div style={sx('min-width:0')}>{field('title', 'h2')}<span className="sl-bar" />{field('body', 'div', 'sbody')}{s.notes && !mini && (<p className="sl-note">{s.notes}</p>)}</div>
    {imgs[0] && !mini && (<div className="imgs">{pic(imgs[0], 0)}</div>)}</div>);
  if (k === 'statement') return (<div className={`${base} noimg sl-statement`} style={style}>{s.label && (<span className="sl-lbl">{s.label}</span>)}{field('title', 'h3', 'sl-kicker')}{field('body', 'p', 'sl-big')}</div>);
  if (k === 'stats') return (<div className={`${base} noimg sl-stats`} style={style}>{field('title', 'h2')}
    <div className="sl-cards" style={sx({ '--n': (s.stats || []).length || 1 })}>{(s.stats || []).map((x, i) => (<div key={i} className="sl-card">{x.from && (<s className="sl-from">{x.from}</s>)}<b className="sl-to">{x.to}</b><span className="sl-lab">{x.label}</span></div>))}</div></div>);
  if (k === 'quote') return (<div className={`${base}${imgs.length ? '' : ' noimg'} sl-quote`} style={style}>
    <div style={sx('min-width:0')}>{field('title', 'h3', 'sl-kicker')}<blockquote>{s.quote}</blockquote><p className="sl-by">{s.by}</p>{s.of && (<p className="sl-of">{s.of}</p>)}</div>
    {imgs.length > 0 && (<div className="imgs">{imgs.slice(0, 1).map(pic)}</div>)}</div>);
  if (k === 'beforeafter' || k === 'screens') return (<div className={`${base} noimg sl-row`} style={style}>{field('title', 'h2')}<div className="sl-pics" style={sx({ '--n': imgs.length || 1 })}>{imgs.map(pic)}</div></div>);
  if (k === 'timeline') return (<div className={`${base} noimg sl-time`} style={style}>{field('title', 'h2')}
    <ol className="sl-line" style={sx({ '--n': (s.points || []).length || 1 })}>{(s.points || []).map((pt, i) => (<li key={i}><b>{pt.date}</b><i aria-hidden="true" /><span className="sl-n">{pt.n} {pt.n === 1 ? 'ask' : 'asks'}</span><span className="sl-t">{pt.text}</span></li>))}</ol></div>);
  return (<div className={`${base}${imgs.length ? '' : ' noimg'}`} style={style}>
    <div style={sx('min-width:0')}>{field('title', 'h2')}{(s.body || edit) && field('body', 'div', 'sbody')}</div>
    {imgs.length > 0 && (<div className="imgs" style={sx({ '--cols': imgs.length > 2 ? 2 : 1 })}>{imgs.map(pic)}</div>)}
  </div>);
}

export function Deck({ id }) {
  const { data, error, loading, reload } = useFetch(`/decks/${id}`);
  const [deck, setDeck] = useState(null);
  const [i, setI] = useState(0);
  const [present, setPresent] = useState(false);
  const [gs, setGs] = useState(false);
  const t = useRef();
  useEffect(() => { if (data) setDeck(data); }, [data]);
  useEffect(() => {
    if (!present) return;
    const k = (e) => { if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) setI((n) => Math.min(deck.slides.length - 1, n + 1)); if (['ArrowLeft', 'PageUp'].includes(e.key)) setI((n) => Math.max(0, n - 1)); if (e.key === 'Escape') setPresent(false); };
    addEventListener('keydown', k);
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => { removeEventListener('keydown', k); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, [present]);
  if (error) return <><Header><a href="#/">Home</a></Header><div className="content"><ErrorBox error={error} retry={reload}  /></div></>;
  if (loading || !deck) return <><Header><span>Loading…</span></Header><div className="content"><Loading h={420}  /></div></>;
  const save = (next) => { setDeck(next); clearTimeout(t.current); t.current = setTimeout(() => api(`/decks/${id}`, { method: 'PUT', body: { title: next.title, slides: next.slides } }).catch(fail), 600); };
  const patch = (o) => save({ ...deck, slides: deck.slides.map((s, n) => (n === i ? { ...s, ...o } : s)) });
  const move = (d) => { const s = [...deck.slides]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; save({ ...deck, slides: s }); setI(j); };
  const del = () => { if (deck.slides.length < 2) return; const prev = deck; save({ ...deck, slides: deck.slides.filter((_, n) => n !== i) }); setI(Math.max(0, i - 1)); toast('Slide removed', { action: { label: 'Undo', fn: () => save(prev) } }); };
  const add = () => { const s = [...deck.slides]; s.splice(i + 1, 0, { id: `sl_${Date.now()}`, kind: 'iteration', title: 'New slide', body: '', images: [] }); save({ ...deck, slides: s }); setI(i + 1); };
  const cur = deck.slides[i];
  if (present) return (<div className="presenting" onClick={() => setI(Math.min(deck.slides.length - 1, i + 1))}><Slide s={cur} accent={deck.accent} /><span className="sr" aria-live="polite">Slide {i + 1} of {deck.slides.length}</span></div>);
  return <><Header actions={<><Button variant="tertiary" size="default" leadingIcon={ph("play")} onClick={() => { setI(0); setPresent(true); }}><span className="label-lg">Present</span></Button>
      <Menu label="Export" btn="btn primary" icon="export" text={(<span className="label-lg">Export</span>)} items={[
        { label: 'PowerPoint (.pptx)', icon: 'file-ppt', onClick: () => { location.href = `/api/decks/${id}/pptx`; } },
        { label: 'PDF (print)', icon: 'file-pdf', onClick: () => window.print() },
        { label: 'Google Slides', icon: 'presentation-chart', onClick: () => setGs(true) }]}  /></>}>
      <a href={`#/p/${deck.project_id}/artifacts`}>Decks</a><Icon n="caret-right"  />
      <Input className="sm" style={sx("max-width:420px;font-weight:600")} value={deck.title} aria-label="Deck title" onChange={(e) => save({ ...deck, title: e.target.value })} />
    </Header>
    <div className="content wide screen-only"><div className="deck">
      <div className="strip" role="listbox" aria-label="Slides">{deck.slides.map((s, n) => (<button key={s?.id ?? n} role="option" aria-current={n === i} aria-selected={n === i} onClick={() => setI(n)} aria-label={`Slide ${n + 1}: ${s.title}`}><Slide s={s} mini  /></button>))}
        <Button variant="ghost" size="default" leadingIcon={ph("plus")} style={sx("border:1px dashed var(--line-2)")} onClick={add}>Add slide</Button></div>
      <div className="col" style={sx("gap:12px")}>
        <div className="row wrap"><span className="caps grow">Slide {i + 1} of {deck.slides.length} · {cur.kind}</span>
          <Button variant="ghost" size="icon-compact" aria-label="Move slide up" onClick={() => move(-1)} disabled={i === 0}><Icon n="arrow-up" size={15} /></Button>
          <Button variant="ghost" size="icon-compact" aria-label="Move slide down" onClick={() => move(1)} disabled={i === deck.slides.length - 1}><Icon n="arrow-down" size={15} /></Button>
          <Button variant="ghost" size="compact" className="text-destructive" onClick={del} disabled={deck.slides.length < 2}>Delete slide</Button></div>
        <Slide s={cur} accent={deck.accent} edit onChange={patch} key={cur.id} />
        <label className="field"><span>Speaker notes · where this slide comes from</span><Textarea rows="3" value={cur.notes || ''} onChange={(e) => patch({ notes: e.target.value })}></Textarea></label>
        {cur.moment_ids?.length > 0 && (<p className="small muted">From {cur.moment_ids.map((m, n) => <Fragment key={m?.id ?? n}>{n ? ', ' : ''}<a href={`#/m/${m}`}>this moment</a></Fragment>)}. Click any text on the slide to edit it.</p>)}
        {deck.range?.model && (<p className="tiny muted">Story written by {deck.range.model} from the project’s moments.</p>)}
      </div>
    </div></div>
    <div className="print-only print-deck">{deck.slides.map((s, ki) => (<Slide key={s?.id ?? ki} s={s} accent={deck.accent} />))}</div>
    {gs && (<Dialog title="Open in Google Slides" onClose={() => setGs(false)} footer={<><Button variant="tertiary" size="default" onClick={() => setGs(false)}>Close</Button><Button variant="primary" size="default" render={<a href={`/api/decks/${id}/pptx`} />}>Download .pptx</Button></>}>
      <p>Google Slides opens PowerPoint files directly:</p>
      <ol className="small" style={sx("margin:0;padding-left:20px;line-height:1.8")}><li>Download the .pptx.</li><li>In Google Slides: File → Import slides → Upload, and pick it. Or drop it into Google Drive and open it with Slides.</li></ol>
      <p className="small muted">Trace doesn’t ask for access to your Google account to do this.</p>
    </Dialog>)}</>;
}
