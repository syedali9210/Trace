// Thinking: your reasons, in your words. Trace asks "why did you make this change?" after each change and keeps the
// thoughts you drop (here, or "thought: …" to your agent). Story lays them out like a film: the problem is the villain
// and gets 30–40% of the telling, then the turn, the hero, behind the scenes, their day and the business win.
import { useState, useEffect, useRef, api, useFetch, Icon, Empty, ErrorBox, Loading, Seg, toast, fail, copy, plural, rel, go, Button, ph, sx } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

function BeatPick({ beats, value, onChange, label = 'Part of the story' }) {
  return (<NativeSelect className="sm" aria-label={label} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
    <NativeSelectOption value="">No part yet</NativeSelectOption>
    {beats.map((b) => (<NativeSelectOption key={b.id} value={b.id}>{b.name}</NativeSelectOption>))}
  </NativeSelect>);
}

// One box for a thought, at the top of both tabs. A question from the story or a change can seed it.
function Capture({ p, beats, reload, seed, clearSeed }) {
  const [text, setText] = useState('');
  const [beat, setBeat] = useState(null);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  useEffect(() => { if (seed) { setBeat(seed.beat || null); box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); box.current?.querySelector('textarea')?.focus(); } }, [seed]);
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const t = await api(`/projects/${p.id}/thoughts`, { method: 'POST', body: { text, beat, question: seed?.question } });
      setText(''); setBeat(null); clearSeed();
      toast(t.beat_name ? `Saved under ${t.beat_name}${t.beat_by === 'rules' ? ' (a guess: change it below)' : ''}` : 'Saved');
      reload();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (<div className="card th-cap" ref={box}>
    {seed?.question && (<div className="row" style={sx("gap:8px")}><Icon n="question"  /><b className="small grow">{seed.question}</b><Button variant="ghost" size="compact" onClick={clearSeed}>Not now</Button></div>)}
    <Textarea rows="3" value={text} placeholder="Drop a thought: what you noticed, a doubt, a wrong turn, why you chose this…" aria-label="A thought" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}></Textarea>
    <div className="row wrap" style={sx("gap:8px")}>
      <BeatPick beats={beats} value={beat} onChange={setBeat}  />
      <span className="grow"></span>
      <span className="tiny muted">Ctrl Enter saves · or tell your agent “thought: …”</span>
      <Button variant="primary" size="compact" onClick={save} aria-disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
    </div>
  </div>);
}

// A change still waiting for your why.
function WhyCard({ p, w, reload }) {
  const [text, setText] = useState('');
  const save = async () => {
    if (!text.trim()) return;
    try { await api(`/projects/${p.id}/thoughts`, { method: 'POST', body: { text, kind: 'why', moment_id: w.id, question: w.question } }); toast('Saved your why'); reload(); } catch (e) { fail(e); }
  };
  return (<div className="card th-why">
    <div className="row" style={sx("gap:8px;min-width:0")}><a className="t trunc grow" href={`#/m/${w.id}`}>{w.title}</a><span className="tiny muted">{rel(w.at)}{w.agent ? ` · made by ${w.agent}` : ''}</span></div>
    <p className="small">{w.question}</p>
    {w.guess && (<p className="tiny muted">Trace’s guess: {w.guess} Your own words beat a guess.</p>)}
    <Textarea rows="2" value={text} placeholder="Because…" aria-label={w.question} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }}></Textarea>
    <div className="row"><Button variant="secondary" size="compact" onClick={save} aria-disabled={!text.trim()}>Save my why</Button></div>
  </div>);
}

function ThoughtRow({ t, beats, reload, canEdit }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(t.text);
  useEffect(() => setText(t.text), [t.text]);
  const patch = (body) => api(`/thoughts/${t.id}`, { method: 'PATCH', body }).then(() => { setEdit(false); reload(); }).catch(fail);
  const del = () => api(`/thoughts/${t.id}`, { method: 'DELETE' }).then(() => { toast('Deleted'); reload(); }).catch(fail);
  return (<li className="th-row">
    <span className={`chip ${t.kind === 'why' ? 'ok' : ''}`}>{t.kind === 'why' ? 'Why' : 'Thought'}</span>
    <div className="col grow" style={sx("gap:6px;min-width:0")}>
      {edit ? (<div className="col" style={sx("gap:8px")}><Textarea rows="3" autoFocus value={text} aria-label="Edit the thought" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEdit(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) patch({ text }); }}></Textarea>
        <div className="row"><Button variant="primary" size="compact" onClick={() => patch({ text })}>Save</Button><Button variant="ghost" size="compact" onClick={() => setEdit(false)}>Cancel</Button></div></div>)
        : (<p className="th-text">{t.text}</p>)}
      <div className="row wrap tiny muted" style={sx("gap:8px")}>
        {t.change && (<a href={`#/m/${t.change.id}`}>on “{t.change.title}”</a>)}
        {!t.change && t.question && (<span>answering “{t.question}”</span>)}
        <span>{t.by === 'agent' ? `filed by ${t.author || 'an agent'}, in your words` : 'you'} · {rel(t.created_at)}</span>
        {t.beat && t.beat_by === 'rules' && (<span>part guessed from the words</span>)}
      </div>
    </div>
    {canEdit && (<div className="row th-acts">
      <BeatPick beats={beats} value={t.beat} onChange={(b) => patch({ beat: b })}  />
      {!edit && (<Button variant="ghost" size="compact" onClick={() => setEdit(true)}>Edit</Button>)}
      <Button variant="ghost" size="compact" onClick={del}>Delete</Button>
    </div>)}
  </li>);
}

function Story({ p, s, minutes, setMinutes, onAnswer, canEdit }) {
  return (<div className="col" style={sx("gap:24px")}>
    <div className="row wrap" style={sx("gap:12px")}>
      <span className="caps-sm">Talk length</span>
      <Seg size="compact" label="Talk length" value={minutes} onChange={setMinutes} options={[5, 10, 15, 20].map((m) => ({ value: m, label: `${m} min` }))}  />
      <span className="grow"></span>
      <Button variant="ghost" size="compact" leadingIcon={ph('download-simple')} render={<a href={`/api/projects/${p.id}/story.md?minutes=${minutes}`} download />}>Download .md</Button>
    </div>
    <div className="col" style={sx("gap:8px")}>
      <div className="th-arc" role="img" aria-label={s.acts.map((a) => `${a.name} ${a.share}%`).join(', ')}>{s.beats.map((b) => (<i key={b.id} className={`a-${b.act}`} style={sx({ flex: b.share })} title={`${b.name}: about ${b.minutes} min`}></i>))}</div>
      <div className="row wrap tiny muted th-legend">{s.acts.map((a) => (<span key={a.id}><i className={`d a-${a.id}`}></i>{a.name} · {a.share}%</span>))}</div>
    </div>
    {s.tip && (<p className="small th-tip">{s.tip}</p>)}
    {s.acts.map((a) => (<section key={a.id} className="th-act" aria-label={a.name}>
      <header><span className="caps-sm">{a.name} · {a.share}% of the talk</span><span className="tiny muted">{a.note}</span></header>
      {s.beats.filter((b) => b.act === a.id).map((b) => (<div key={b.id} className={`th-beat a-${a.id}`}>
        <div className="row" style={sx("gap:8px")}><b className="small">{b.name}</b><span className="grow"></span><span className="tiny muted">about {b.minutes} min</span></div>
        <p className="tiny muted">{b.hint}</p>
        {b.items.length > 0 && (<ul>{b.items.map((t) => (<li key={t.id}>{t.text}{t.change && (<span className="tiny muted"> · on “{t.change.title}”</span>)}</li>))}</ul>)}
        {b.items.length === 0 && (canEdit ? (<button className="cs-answer empty" onClick={() => onAnswer({ beat: b.id, question: b.open })}>{b.open}</button>) : (<p className="small muted">{b.open}</p>))}
        {b.items.length > 0 && canEdit && (<button className="th-more" onClick={() => onAnswer({ beat: b.id, question: b.ask[1] || b.ask[0] })}>Add to this part: {b.ask[1] || b.ask[0]}</button>)}
      </div>))}
    </section>))}
  </div>);
}

export function Thinking({ p, sub }) {
  const [minutes, setMinutes] = useState(10);
  const [seed, setSeed] = useState(null);
  const tab = sub === 'story' ? 'story' : 'why';
  const { data, error, loading, reload } = useFetch(`/projects/${p.id}/thinking?minutes=${minutes}`, ['thought', 'moment', 'project'], (t, d) => !d.project_id || d.project_id === p.id);
  if (error) return (<ErrorBox error={error} retry={reload}  />);
  if (loading && !data) return (<Loading h={400}  />);
  const s = data.story, beats = s.beats;
  const prompt = `Use Trace's get_thinking for the project "${p.name}". Ask me the open questions one or two at a time, and file each answer with add_thought in my own words. Don't fill anything in with your own guesses.`;
  return (<div className="cs th">
    <aside className="cs-nav" aria-label="Thinking">
      <div className="cs-ready"><div className="cs-bar"><i style={sx({ width: `${Math.round((100 * s.filled) / s.of)}%` })}></i></div><span className="small"><b>{s.filled} of {s.of}</b> story parts have your words</span></div>
      <div className="col tiny muted" style={sx("gap:6px")}>
        <span><b className="ink2">{plural(data.thoughts.filter((t) => t.kind === 'why').length, 'why')}</b> answered, <b className="ink2">{plural(data.thoughts.filter((t) => t.kind !== 'why').length, 'thought')}</b> dropped</span>
        {data.nudge.open > 0 && (<span>{plural(data.nudge.open, 'change')} waiting for your why</span>)}
        {s.unsorted > 0 && (<span>{plural(s.unsorted, 'thought')} not in a part of the story yet</span>)}
      </div>
      <div className="col" style={sx("gap:6px")}>
        <Button variant="tertiary" size="compact" leadingIcon={ph('robot')} onClick={() => copy(prompt, 'Prompt copied: paste it into your coding agent')}>Ask me through my agent</Button>
      </div>
      <p className="tiny muted">Nothing here is written by AI. Trace asks, you answer, and a part of the story is only a guess until you pick it.</p>
    </aside>
    <div className="cs-doc">
      <header className="cs-head"><span className="caps-sm">Thinking</span><h1>{p.name}</h1>
        <p className="brief">Your reasons, in your words. They become the story you tell: the problem is the villain, the solution is the hero.</p>
        {data.nudge.text && (<div className="cs-writing" role="status"><Icon n="lightbulb"  /><span>{data.nudge.text}</span></div>)}
        <div><Seg size="compact" label="Thinking view" value={tab} onChange={(v) => go(v === 'story' ? `/p/${p.id}/thinking/story` : `/p/${p.id}/thinking`)} options={[{ value: 'why', label: 'Why & thoughts' }, { value: 'story', label: 'Story' }]}  /></div>
      </header>
      {p.can_edit && (<Capture p={p} beats={beats} reload={reload} seed={seed} clearSeed={() => setSeed(null)}  />)}
      {tab === 'story' ? (<Story p={p} s={s} minutes={minutes} setMinutes={setMinutes} onAnswer={(q) => setSeed({ ...q, at: Date.now() })} canEdit={p.can_edit}  />) : (<>
        {data.open_whys.length > 0 && (<section className="th-sec" aria-labelledby="th-why-h">
          <h2 id="th-why-h">Why did you make these changes?</h2>
          <p className="small muted">Answer while it’s fresh. One or two sentences is plenty: what you were trying to fix, and why this way.</p>
          {data.open_whys.map((w) => (<WhyCard p={p} w={w} reload={reload} key={w.id}  />))}
        </section>)}
        <section className="th-sec" aria-labelledby="th-list-h">
          <h2 id="th-list-h">Your thoughts</h2>
          {data.thoughts.length ? (<ul className="th-list">{data.thoughts.map((t) => (<ThoughtRow t={t} beats={beats} reload={reload} canEdit={p.can_edit} key={t.id}  />))}</ul>)
            : (<Empty icon="lightbulb" title="No thoughts yet">Drop the first one above: what you noticed, a doubt, a wrong turn. Or tell your agent “thought: …” and it lands here.</Empty>)}
        </section>
      </>)}
    </div>
  </div>);
}
