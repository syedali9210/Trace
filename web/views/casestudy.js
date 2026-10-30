// The case study: every question a case study needs, answered from the work. Each answer says where it came
// from (the PRD, an iteration, your AI, you) and shows its screens. Edit any answer; ask your coding agent to fill
// the rest (it gets the questions over MCP); download it all as markdown.
import { html, useState, useEffect, api, useFetch, useAi, Icon, ErrorBox, Loading, fileUrl, toast, fail, copy, plural, rel } from '../lib.js';
import { Lightbox } from './journey.js';

const ST = { filled: { label: 'Answered', cls: 'ok' }, partial: { label: 'Thin', cls: 'warn' }, missing: { label: 'Open', cls: 'err' } };
const ORIGIN = { assembled: 'Assembled from the work', agent: 'Written by', you: 'Written by' };

function Section({ p, s, n, reload, focused }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(s.answer || '');
  const [open, setOpen] = useState(null);
  const [more, setMore] = useState(false);
  useEffect(() => setText(s.answer || ''), [s.answer]);
  const save = async (value) => { try { await api(`/projects/${p.id}/case-study/${s.id}`, { method: 'PUT', body: { answer: value } }); setEdit(false); toast(value ? 'Saved' : 'Back to the assembled answer'); reload(); } catch (e) { fail(e); } };
  const images = s.evidence.flatMap((e) => e.images || []);
  const st = ST[s.status];
  return html`<section class=${`cs-sec${focused ? ' focus' : ''}`} id=${`cs-${s.id}`} aria-labelledby=${`csq-${s.id}`}>
    <div class="cs-n">${String(n).padStart(2, '0')}</div>
    <div class="col" style="gap:12px;min-width:0">
      <div class="row wrap" style="gap:8px"><h2 id=${`csq-${s.id}`} class="grow">${s.q}</h2><span class=${`chip ${st.cls}`}>${st.label}</span></div>
      ${edit ? html`<div class="col"><textarea class="input cs-ta" rows="6" autofocus value=${text} onInput=${(e) => setText(e.target.value)} aria-label=${s.q} onKeyDown=${(e) => { if (e.key === 'Escape') setEdit(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(text); }}></textarea>
          <div class="row"><button class="btn sm primary" onClick=${() => save(text)}>Save</button><button class="btn sm ghost" onClick=${() => setEdit(false)}>Cancel</button>${s.origin === 'you' || s.origin === 'agent' ? html`<span class="grow"></span><button class="btn sm ghost" onClick=${() => save('')}>Use the assembled answer</button>` : ''}</div></div>`
        : s.answer ? html`<button class="cs-answer" onClick=${() => setEdit(true)} aria-label=${`Edit the answer to: ${s.q}`}>${s.answer}</button>`
        : html`<button class="cs-answer empty" onClick=${() => setEdit(true)}>Nothing in the work answers this yet. Write it, or ask your agent.</button>`}
      ${s.origin && html`<span class="tiny muted">${ORIGIN[s.origin]}${s.author ? ` ${s.author}` : ''}${s.updated_at ? ` · ${rel(s.updated_at)}` : ''}</span>`}
      ${images.length > 0 && html`<div class="cs-shots">${images.slice(0, 6).map((im) => html`<button class="cs-shot" onClick=${() => setOpen(im)} aria-label=${`Open ${im.title || 'the screen'}`}><img src=${fileUrl(im.thumb_key || im.image_key)} alt=${im.title || ''} loading="lazy" /><span class="trunc">${im.title || ''}</span></button>`)}</div>`}
      ${s.evidence.length > 0 && html`<div class="cs-ev">
        <button class="cs-ev-t" aria-expanded=${more} onClick=${() => setMore(!more)}><${Icon} n=${more ? 'caret-down' : 'caret-right'} />${plural(s.evidence.length, 'source')}: ${[...new Set(s.evidence.map((e) => e.source))].slice(0, 4).join(' · ')}</button>
        ${more && html`<ul>${s.evidence.map((e) => html`<li><span class="src">${e.source}${e.label ? ` · ${e.label}` : ''}</span>${e.href ? html`<a href=${e.href}>${e.text}</a>` : html`<span class="pre">${e.text}</span>`}</li>`)}</ul>`}
      </div>`}
    </div>
    ${open && html`<${Lightbox} item=${{ ...open, file_key: open.image_key || open.thumb_key }} onClose=${() => setOpen(null)} />`}
  </section>`;
}

export function CaseStudy({ p, focus }) {
  const ai = useAi();
  const [drafting, setDrafting] = useState(false);
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/case-study`, ['project', 'moment', 'comment', 'reference', 'issue', 'decision', 'memory'], (t, d) => !d.project_id || d.project_id === p.id);
  useEffect(() => { if (focus && data) setTimeout(() => document.getElementById(`cs-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }, [focus, !!data]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} h=${400} />`;
  const open = data.sections.filter((s) => s.status !== 'filled');
  const draft = () => { if (drafting) return; setDrafting(true); api(`/projects/${p.id}/ai/case-study`, { method: 'POST' }).then((r) => { toast(r.drafted ? `Drafted ${plural(r.drafted, 'answer')} from the work. Each says it’s Trace AI’s; edit any.` : r.note); reload(); }).catch(fail).finally(() => setDrafting(false)); };
  const prompt = `Use Trace's get_case_study for the project "${p.name}", then answer every section that's thin or open with answer_case_study, from what you know of this work (our conversation, the code, the docs). Quote me where you can; never invent numbers or results.`;
  return html`<div class="cs">
    <aside class="cs-nav" aria-label="Case study sections">
      <div class="cs-ready"><div class="cs-bar"><i style=${{ width: `${data.readiness}%` }}></i></div><span class="small"><b>${data.readiness}%</b> answered</span></div>
      <nav>${data.sections.map((s, i) => html`<a href=${`#/p/${p.id}/casestudy/${s.id}`} class=${`st-${s.status}`}><span class="d"></span><span class="trunc">${s.q}</span></a>`)}</nav>
      <div class="col" style="gap:6px">
        ${ai?.ready && p.can_edit && open.length > 0 && html`<button class="btn sm primary" onClick=${draft} aria-disabled=${drafting}><${Icon} n="pen-nib" cls=${drafting ? 'spin' : ''} />${drafting ? 'Drafting from the work…' : `Draft ${plural(open.length, 'open answer')}`}</button>`}
        <button class="btn sm" onClick=${() => copy(prompt, 'Prompt copied: paste it into your coding agent')}><${Icon} n="robot" />Ask your agent</button>
        <a class="btn sm ghost" href=${`/api/projects/${p.id}/case-study.md`} download><${Icon} n="download-simple" />Download .md</a>
      </div>
      ${data.docs.length > 0 && html`<p class="tiny muted">Read ${data.docs.join(', ')}.</p>`}
    </aside>
    <div class="cs-doc">
      <header class="cs-head"><span class="caps-sm">Case study</span><h1>${p.name}</h1>
        <p class="brief">${open.length ? `${plural(open.length, 'question')} still ${open.length === 1 ? 'needs' : 'need'} you or your agent. Click any answer to edit it.` : 'Every question has an answer. Click any to edit it.'}</p></header>
      ${data.sections.map((s, i) => html`<${Section} p=${p} s=${s} n=${i + 1} reload=${reload} focused=${s.id === focus} key=${s.id} />`)}
    </div>
  </div>`;
}
