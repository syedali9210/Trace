// Deck builder: the generated story, editable slide by slide; present, or export PPTX / PDF / Google Slides.
import { html, useState, useEffect, useRef, api, useFetch, Header, Icon, ErrorBox, Loading, Dialog, Menu, fileUrl, toast, fail, go } from '../lib.js';

function Slide({ s, mini, edit, onChange }) {
  const imgs = (s.images || []).slice(0, 6);
  const cls = `slide${s.kind === 'title' ? ' title-slide' : ''}${!imgs.length || s.kind === 'title' ? ' noimg' : ''}${mini ? ' mini' : ''}`;
  const field = (k, tag) => edit
    ? html`<${tag} class=${k === 'title' ? '' : 'sbody'} contenteditable="true" spellcheck="true" aria-label=${k === 'title' ? 'Slide title' : 'Slide text'} onBlur=${(e) => onChange({ [k]: e.currentTarget.innerText })} dangerouslySetInnerHTML=${{ __html: (s[k] || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]) }}></${tag}>`
    : html`<${tag} class=${k === 'title' ? '' : 'sbody'}>${s[k]}</${tag}>`;
  return html`<div class=${cls}>
    <div style="min-width:0">${field('title', 'h2')}${s.body && field('body', 'div')}${edit && !s.body && field('body', 'div')}</div>
    ${imgs.length > 0 && s.kind !== 'title' && html`<div class="imgs" style=${{ '--cols': imgs.length > 2 ? 2 : 1 }}>${imgs.map((im, i) => html`<figure>
      <img src=${fileUrl(im.key)} alt=${im.caption || ''} />${im.caption && html`<figcaption>${im.caption}</figcaption>`}
      ${edit && html`<button class="btn sm ghost no-print" style="color:#45454b" onClick=${() => onChange({ images: imgs.filter((_, j) => j !== i) })}>Remove picture</button>`}
    </figure>`)}</div>`}
  </div>`;
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
  if (error) return html`<${Header}><a href="#/">Home</a></${Header}><div class="content"><${ErrorBox} error=${error} retry=${reload} /></div>`;
  if (loading || !deck) return html`<${Header}><span>Loading…</span></${Header}><div class="content"><${Loading} h=${420} /></div>`;
  const save = (next) => { setDeck(next); clearTimeout(t.current); t.current = setTimeout(() => api(`/decks/${id}`, { method: 'PUT', body: { title: next.title, slides: next.slides } }).catch(fail), 600); };
  const patch = (o) => save({ ...deck, slides: deck.slides.map((s, n) => (n === i ? { ...s, ...o } : s)) });
  const move = (d) => { const s = [...deck.slides]; const j = i + d; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; save({ ...deck, slides: s }); setI(j); };
  const del = () => { if (deck.slides.length < 2) return; const prev = deck; save({ ...deck, slides: deck.slides.filter((_, n) => n !== i) }); setI(Math.max(0, i - 1)); toast('Slide removed', { action: { label: 'Undo', fn: () => save(prev) } }); };
  const add = () => { const s = [...deck.slides]; s.splice(i + 1, 0, { id: `sl_${Date.now()}`, kind: 'iteration', title: 'New slide', body: '', images: [] }); save({ ...deck, slides: s }); setI(i + 1); };
  const cur = deck.slides[i];
  if (present) return html`<div class="presenting" onClick=${() => setI(Math.min(deck.slides.length - 1, i + 1))}><${Slide} s=${cur} /><span class="sr" aria-live="polite">Slide ${i + 1} of ${deck.slides.length}</span></div>`;
  return html`
    <${Header} actions=${html`
      <button class="btn" onClick=${() => { setI(0); setPresent(true); }}><${Icon} n="play" /><span class="label-lg">Present</span></button>
      <${Menu} label="Export" btn="btn primary" icon="export" text=${html`<span class="label-lg">Export</span>`} items=${[
        { label: 'PowerPoint (.pptx)', icon: 'file-ppt', onClick: () => { location.href = `/api/decks/${id}/pptx`; } },
        { label: 'PDF (print)', icon: 'file-pdf', onClick: () => window.print() },
        { label: 'Google Slides', icon: 'presentation-chart', onClick: () => setGs(true) }]} />`}>
      <a href=${`#/p/${deck.project_id}/artifacts`}>Decks</a><${Icon} n="caret-right" />
      <input class="input sm" style="max-width:420px;font-weight:600" value=${deck.title} aria-label="Deck title" onInput=${(e) => save({ ...deck, title: e.target.value })} />
    </${Header}>
    <div class="content wide screen-only"><div class="deck">
      <div class="strip" role="listbox" aria-label="Slides">${deck.slides.map((s, n) => html`<button role="option" aria-current=${n === i} aria-selected=${n === i} onClick=${() => setI(n)} aria-label=${`Slide ${n + 1}: ${s.title}`}><${Slide} s=${s} mini /></button>`)}
        <button class="btn ghost" style="border:1px dashed var(--line-2)" onClick=${add}><${Icon} n="plus" />Add slide</button></div>
      <div class="col" style="gap:12px">
        <div class="row wrap"><span class="caps grow">Slide ${i + 1} of ${deck.slides.length} · ${cur.kind}</span>
          <button class="btn sm ghost icon" aria-label="Move slide up" onClick=${() => move(-1)} disabled=${i === 0}><${Icon} n="arrow-up" /></button>
          <button class="btn sm ghost icon" aria-label="Move slide down" onClick=${() => move(1)} disabled=${i === deck.slides.length - 1}><${Icon} n="arrow-down" /></button>
          <button class="btn sm ghost danger" onClick=${del} disabled=${deck.slides.length < 2}>Delete slide</button></div>
        <${Slide} s=${cur} edit onChange=${patch} key=${cur.id} />
        <label class="field"><span>Speaker notes</span><textarea class="input" rows="3" value=${cur.notes || ''} onInput=${(e) => patch({ notes: e.target.value })}></textarea></label>
        ${cur.moment_ids?.length > 0 && html`<p class="small muted">From ${cur.moment_ids.map((m, n) => html`${n ? ', ' : ''}<a href=${`#/m/${m}`}>this moment</a>`)}. Click any text on the slide to edit it.</p>`}
        ${deck.range?.model && html`<p class="tiny muted">Story written by ${deck.range.model} from the project’s moments.</p>`}
      </div>
    </div></div>
    <div class="print-only print-deck">${deck.slides.map((s) => html`<${Slide} s=${s} />`)}</div>
    ${gs && html`<${Dialog} title="Open in Google Slides" onClose=${() => setGs(false)} footer=${html`<button class="btn" onClick=${() => setGs(false)}>Close</button><a class="btn primary" href=${`/api/decks/${id}/pptx`}>Download .pptx</a>`}>
      <p>Google Slides opens PowerPoint files directly:</p>
      <ol class="small" style="margin:0;padding-left:20px;line-height:1.8"><li>Download the .pptx.</li><li>In Google Slides: File → Import slides → Upload, and pick it. Or drop it into Google Drive and open it with Slides.</li></ol>
      <p class="small muted">Trace doesn’t ask for access to your Google account to do this.</p>
    </${Dialog}>`}`;
}
