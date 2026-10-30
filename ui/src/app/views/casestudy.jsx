// The case study: every question a case study needs, answered from the work. Each answer says where it came
// from (the PRD, an iteration, your AI, you) and shows its screens. Edit any answer; ask your coding agent to fill
// the rest (it gets the questions over MCP); download it all as markdown.
import { useState, useEffect, api, useFetch, useAi, Icon, ErrorBox, Loading, fileUrl, toast, fail, copy, plural, rel, Button, ph, sx } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { ThinkingIndicator } from '@/components/ui/thinking-indicator';
import { Lightbox } from './journey.jsx';

const ST = { filled: { label: 'Answered', cls: 'ok' }, partial: { label: 'Thin', cls: 'warn' }, missing: { label: 'Open', cls: 'err' } };
const ORIGIN = { assembled: 'From the docs', agent: 'Written by', you: 'Written by' };

function Section({ p, s, n, reload, focused }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(s.answer || '');
  const [open, setOpen] = useState(null);
  const [more, setMore] = useState(false);
  useEffect(() => setText(s.answer || ''), [s.answer]);
  const save = async (value) => { try { await api(`/projects/${p.id}/case-study/${s.id}`, { method: 'PUT', body: { answer: value } }); setEdit(false); toast(value ? 'Saved' : 'Cleared'); reload(); } catch (e) { fail(e); } };
  const images = s.evidence.flatMap((e) => e.images || []);
  const st = ST[s.status];
  return (<section className={`cs-sec${focused ? ' focus' : ''}`} id={`cs-${s.id}`} aria-labelledby={`csq-${s.id}`}>
    <div className="cs-n">{String(n).padStart(2, '0')}</div>
    <div className="col" style={sx("gap:12px;min-width:0")}>
      <div className="row wrap" style={sx("gap:8px")}><h2 id={`csq-${s.id}`} className="grow">{s.q}</h2><span className={`chip ${st.cls}`}>{st.label}</span></div>
      {edit ? (<div className="col"><Textarea className="cs-ta" rows="6" autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label={s.q} onKeyDown={(e) => { if (e.key === 'Escape') setEdit(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(text); }}></Textarea>
          <div className="row"><Button variant="primary" size="compact" onClick={() => save(text)}>Save</Button><Button variant="ghost" size="compact" onClick={() => setEdit(false)}>Cancel</Button>{s.origin === 'you' || s.origin === 'agent' ? <><span className="grow"></span><Button variant="ghost" size="compact" onClick={() => save('')}>Clear my answer</Button></> : ''}</div></div>)
        : s.answer ? (<button className="cs-answer" onClick={() => setEdit(true)} aria-label={`Edit the answer to: ${s.q}`}>{s.answer}</button>)
        : (<button className="cs-answer empty" onClick={() => setEdit(true)}>Nothing in the work answers this yet. Write it, or ask your agent.</button>)}
      {s.origin && (<span className="tiny muted">{ORIGIN[s.origin]}{s.author ? ` ${s.author}` : ''}{s.updated_at ? ` · ${rel(s.updated_at)}` : ''}</span>)}
      {images.length > 0 && (<div className="cs-shots">{images.slice(0, 6).map((im, ki) => (<button key={im?.id ?? ki} className="cs-shot" onClick={() => setOpen(im)} aria-label={`Open ${im.title || 'the screen'}`}><img src={fileUrl(im.thumb_key || im.image_key)} alt={im.title || ''} loading="lazy"  /><span className="trunc">{im.title || ''}</span></button>))}</div>)}
      {s.evidence.length > 0 && (<div className="cs-ev">
        <button className="cs-ev-t" aria-expanded={more} onClick={() => setMore(!more)}><Icon n={more ? 'caret-down' : 'caret-right'} swap  />{plural(s.evidence.length, 'source')}: {[...new Set(s.evidence.map((e) => e.source))].slice(0, 4).join(' · ')}</button>
        {more && (<ul>{s.evidence.map((e, ki) => (<li key={e?.id ?? ki}><span className="src">{e.source}{e.label ? ` · ${e.label}` : ''}</span>{e.href ? (<a href={e.href}>{e.text}</a>) : (<span className="pre">{e.text}</span>)}</li>))}</ul>)}
      </div>)}
    </div>
    {open && (<Lightbox item={{ ...open, file_key: open.image_key || open.thumb_key }} onClose={() => setOpen(null)}  />)}
  </section>);
}

export function CaseStudy({ p, focus }) {
  const ai = useAi();
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/case-study`, ['project', 'moment', 'comment', 'reference', 'issue', 'decision', 'memory'], (t, d) => !d.project_id || d.project_id === p.id);
  useEffect(() => { if (focus && data) setTimeout(() => document.getElementById(`cs-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }, [focus, !!data]);
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (loading && !data) return (<Loading h={400}  />);
  const open = data.sections.filter((s) => s.status !== 'filled');
  const drafting = busy || data.drafting; // Trace AI writes it by itself when the work changed; this is the same, on demand
  const draft = () => { if (drafting) return; setBusy(true); api(`/projects/${p.id}/ai/case-study`, { method: 'POST' }).then((r) => { toast(r.drafted ? `Trace AI wrote ${plural(r.drafted, 'answer')} from the work. Edit any.` : r.note || 'Nothing new to write from the work'); reload(); }).catch(fail).finally(() => setBusy(false)); };
  const prompt = `Use Trace's get_case_study for the project "${p.name}", then answer every section that's thin or open with answer_case_study, from what you know of this work (our conversation, the code, the docs). Quote me where you can; never invent numbers or results.`;
  return (<div className="cs">
    <aside className="cs-nav" aria-label="Case study sections">
      <div className="cs-ready"><div className="cs-bar"><i style={sx({ width: `${data.readiness}%` })}></i></div><span className="small"><b>{data.readiness}%</b> answered</span></div>
      <nav>{data.sections.map((s, i) => (<a key={s?.id ?? i} href={`#/p/${p.id}/casestudy/${s.id}`} className={`st-${s.status}`}><span className="d"></span><span className="trunc">{s.q}</span></a>))}</nav>
      <div className="col" style={sx("gap:6px")}>
        {ai?.ready && p.can_edit && (<Button variant="secondary" size="compact" leadingIcon={ph('pen-nib')} onClick={draft} aria-disabled={drafting}>{drafting ? 'Writing from the work…' : 'Write it again from the work'}</Button>)}
        <Button variant="tertiary" size="compact" leadingIcon={ph("robot")} onClick={() => copy(prompt, 'Prompt copied: paste it into your coding agent')}>Ask your agent</Button>
        <Button variant="ghost" size="compact" leadingIcon={ph("download-simple")} render={<a href={`/api/projects/${p.id}/case-study.md`} download />}>Download .md</Button>
      </div>
      {data.docs.length > 0 && (<p className="tiny muted">Read {data.docs.join(', ')}.</p>)}
    </aside>
    <div className="cs-doc">
      <header className="cs-head"><span className="caps-sm">Case study</span><h1>{p.name}</h1>
        <p className="brief">{open.length ? `${plural(open.length, 'question')} the work doesn’t answer yet: write ${open.length === 1 ? 'it' : 'them'}, or ask your agent. Click any answer to edit it.` : 'Every question has an answer. Click any to edit it.'}</p>
        {drafting && (<div className="cs-writing" role="status"><ThinkingIndicator /><span>Trace AI is writing the answers from the docs, the screens and how the work went. Yours stay as you wrote them.</span></div>)}</header>
      {data.sections.map((s, i) => (<Section p={p} s={s} n={i + 1} reload={reload} focused={s.id === focus} key={s.id}  />))}
    </div>
  </div>);
}
