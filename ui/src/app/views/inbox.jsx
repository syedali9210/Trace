// Review: what Trace wasn't sure enough to file by itself. Each item is the work and its changelog card,
// with where Trace thinks it goes. One key per action (A accept, M move, E edit, D discard), bulk with X.
import { useState, useEffect, useRef, useMemo, api, useFetch, useMe, Header, Icon, ErrorBox, Menu, ToolChip, plural, toast, fail, useKeys, go, rel, Button, sx, Check } from '../lib.jsx';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { NewProject } from './dialogs.jsx';
import { Changelog, Tile } from './ncs.jsx';

const STAGE = { capturing: 'Capturing', routing: 'Finding its project', describing: 'Writing the changelog', indexing: 'Indexing', ready: 'Ready' };
const GROUPS = [['filed', 'Filed', 'Trace is sure where these go. Accept, or move them.'], ['guess', 'Needs a home', 'Trace’s best guess, waiting for you.'], ['unsorted', 'Unsorted', 'Trace couldn’t tell. Pick a project or make one.'], ['capturing', 'Capturing now', 'Still open; they close when the work pauses.']];
function group(items) {
  const g = { capturing: [], filed: [], guess: [], unsorted: [] };
  for (const m of items) (m.status === 'open' ? g.capturing : m.project_id ? g.filed : (m.route_confidence || 0) >= 0.5 ? g.guess : g.unsorted).push(m);
  return g;
}

function Item({ m, selected, checked, onSelect, onCheck, projects, act, editing, setEditing, newProjectFor, moveRef }) {
  const [form, setForm] = useState({ title: m.title || '', summary: m.summary || '' });
  useEffect(() => setForm({ title: m.title || '', summary: m.summary || '' }), [m.title, m.summary]);
  const save = async () => { try { await api(`/moments/${m.id}`, { method: 'PATCH', body: form }); setEditing(false); toast('Saved'); } catch (e) { fail(e); } };
  const move = async (pid) => {
    if (pid === '__new') return newProjectFor(m.id);
    if (!pid) return;
    try { await api(`/moments/${m.id}`, { method: 'PATCH', body: { project_id: pid } }); toast(`Moved to ${projects.find((p) => p.id === pid)?.name}. Trace will remember.`); } catch (e) { fail(e); }
  };
  const open = m.status === 'open';
  const where = m.project_id ? <>Filed to <b>{m.project_name}</b></> : m.guess_name ? <>{m.route_confidence >= 0.5 ? 'Looks like' : 'Maybe'} <b>{m.guess_name}</b> · {Math.round(m.route_confidence * 100)}%</> : 'No project yet';
  return (<div className="rv" id={`row-${m.id}`} role="option" aria-selected={selected} onClick={onSelect}>
    <Tile img={m.image || m.assets[0]?.after} href={open ? undefined : `#/m/${m.id}`} label={m.title || 'Capturing'} alt={m.title || ''}  />
    <Changelog m={{ ...m, rows: (m.rows || []).slice(0, 3) }} project={{ name: open ? 'Capturing…' : m.project_name || m.guess_name || 'Unsorted' }}
      menu={!open && (<label className="check" onClick={(e) => e.stopPropagation()} title="Select (X)"><Check checked={checked} onChange={onCheck} aria-label={`Select ${m.title}`}  /></label>)}>
      {open ? (<p className="small muted">{plural(m.event_count, 'edit')} from {m.actor_name} so far. It becomes a moment when the work pauses.</p>) : <>{editing && (<div className="col"><Input className="sm" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} autoFocus />
          <Textarea className="sm" rows="2" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} aria-label="Summary"></Textarea>
          <div className="row"><Button variant="primary" size="compact" onClick={save}>Save</Button><Button variant="ghost" size="compact" onClick={() => setEditing(false)}>Cancel</Button></div></div>)}
        <div className="clog-sep"></div>
        <div className="small">{where}<div className="tiny muted">{m.route_reason}{m.stage !== 'ready' ? ` · ${STAGE[m.stage]}…` : ''}</div></div>
        <div className="row" style={sx("gap:6px")}><ToolChip tool={m.tool} short  /><span className="tiny muted trunc">{m.agent || m.actor_name} · {rel(m.end_ts)}{m.asset_count > 1 ? ` · ${m.asset_count} files` : ''}</span></div>
        <div className="rv-actions">
          <label className="sr" htmlFor={`mv-${m.id}`}>File into</label>
          <NativeSelect id={`mv-${m.id}`} ref={selected ? moveRef : undefined} className="sm" style={sx("width:auto;flex:1")} value="" onChange={(e) => move(e.target.value)} onClick={(e) => e.stopPropagation()}>
            <NativeSelectOption value="">{m.project_id || m.guess_name ? 'Move to…' : 'File into…'}</NativeSelectOption>{projects.map((p, ki) => (<NativeSelectOption key={p?.id ?? ki} value={p.id}>{p.name}</NativeSelectOption>))}<NativeSelectOption value="__new">New project…</NativeSelectOption>
          </NativeSelect>
          <Button variant="primary" size="compact" onClick={(e) => { e.stopPropagation(); act(m, 'accept'); }} title="Accept (A)">Accept</Button>
          <Button variant="tertiary" size="compact" onClick={(e) => { e.stopPropagation(); act(m, 'discard'); }} title="Discard (D)">Discard</Button>
          <Menu label="More" btn="ibtn" items={[
            { label: 'Edit the entry', icon: 'pencil-simple', kbd: 'E', onClick: () => setEditing(true) },
            m.asset_count > 1 && { label: 'Split: open it to pick files', icon: 'scissors', onClick: () => go(`/m/${m.id}`) },
            { label: 'Merge with the previous', icon: 'arrows-merge', onClick: () => act(m, 'merge') },
            { label: 'Mute this kind of event', icon: 'bell-slash', onClick: () => act(m, 'mute') }]}  />
        </div></>}
    </Changelog>
  </div>);
}

export function Inbox({ focus }) {
  const { data, error, reload, set } = useFetch('/inbox', ['moment']);
  const me = useMe();
  const [sel, setSel] = useState(focus || null);
  const [checked, setChecked] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [np, setNp] = useState(null);
  const moveRef = useRef();
  const groups = useMemo(() => group(data || []), [data]);
  const flat = useMemo(() => GROUPS.flatMap(([k]) => groups[k]), [groups]);
  useEffect(() => { if (flat.length && !flat.some((m) => m.id === sel)) setSel(flat[0].id); }, [flat]);
  useEffect(() => { if (focus) setTimeout(() => document.getElementById(`row-${focus}`)?.scrollIntoView({ block: 'center' }), 60); }, [focus, !!data]);
  const cur = flat.find((m) => m.id === sel);
  const idx = flat.findIndex((m) => m.id === sel);
  const step = (d) => { const n = flat[Math.max(0, Math.min(flat.length - 1, idx + d))]; if (n) { setSel(n.id); document.getElementById(`row-${n.id}`)?.scrollIntoView({ block: 'nearest' }); } };
  const act = async (m, what) => {
    try {
      const r = await api(`/moments/${m.id}/${what}`, { method: 'POST', body: {} });
      if (what === 'discard') toast('Discarded', { action: { label: 'Undo', fn: () => api(`/moments/${m.id}/restore`, { method: 'POST' }).catch(fail) } });
      if (what === 'merge') toast('Merged with the previous moment');
      if (what === 'mute') toast(`Muted: ${r.muted?.join(', ')}`);
      const next = flat[idx + 1] || flat[idx - 1];
      set((list) => list.filter((x) => x.id !== m.id));
      setSel(next?.id || null);
      reload();
    } catch (e) { fail(e); if (e.status === 400 && what === 'accept') moveRef.current?.focus(); }
  };
  const toggle = (id) => { const s = new Set(checked); s.has(id) ? s.delete(id) : s.add(id); setChecked(s); };
  useKeys({
    j: () => step(1), arrowdown: () => step(1), k: () => step(-1), arrowup: () => step(-1),
    a: () => cur && cur.status !== 'open' && act(cur, 'accept'), d: () => cur && cur.status !== 'open' && act(cur, 'discard'),
    e: () => cur && setEditing(cur.id), m: () => moveRef.current?.focus(), x: () => cur && toggle(cur.id),
    enter: () => cur && go(`/m/${cur.id}`), escape: () => { setChecked(new Set()); setEditing(null); },
  }, [cur?.id, idx, flat, checked]);
  const bulk = async (action, project_id) => {
    try {
      const r = await api('/inbox/bulk', { method: 'POST', body: { ids: [...checked], action, project_id } });
      toast(`${plural(r.done.length, 'moment')} ${action === 'accept' ? 'accepted' : action === 'discard' ? 'discarded' : 'moved'}${r.failed.length ? `; ${r.failed.length} need a project first` : ''}`);
      setChecked(new Set()); reload();
    } catch (e) { fail(e); }
  };
  const projects = me?.projects || [];
  return <><Header actions={(<span className="keys" aria-hidden="true"><span><kbd>J</kbd><kbd>K</kbd> move</span><span><kbd>A</kbd> accept</span><span><kbd>M</kbd> file</span><span><kbd>X</kbd> select</span></span>)}>
      <b>Review</b>{data && (<span className="hd-sub">{data.filter((m) => m.status === 'draft').length} to file</span>)}</Header>
    <div className="content">
      {error && (<ErrorBox error={error} retry={reload}  />)}
      {!data && !error && (<div className="rv"><div className="skeleton" style={sx("height:300px")}></div><div className="skeleton" style={sx("height:300px")}></div></div>)}
      {data && !flat.length && (<div className="empty"><Icon n="check-circle" cls="big"  /><h2>Nothing to review</h2><p>Everything Trace captured found its home. Anything it isn’t sure about waits here.</p></div>)}
      <div className="review" role="listbox" aria-label="Moments to review" aria-multiselectable="true">
        {GROUPS.map(([k, label, hint]) => groups[k].length > 0 && (<section key={k} className="col" style={sx("gap:12px")}>
          <div className="row" style={sx("padding-top:8px")}><h2>{label}</h2><span className="small muted num">{groups[k].length}</span><span className="small muted grow" style={sx("text-align:right")}>{hint}</span></div>
          {groups[k].map((m) => (<Item m={m} key={m.id} selected={m.id === sel} checked={checked.has(m.id)} onSelect={() => setSel(m.id)} onCheck={() => toggle(m.id)} projects={projects} act={act} editing={editing === m.id} setEditing={(v) => setEditing(v ? m.id : null)} newProjectFor={setNp} moveRef={moveRef}  />))}
        </section>))}
      </div>
    </div>
    {checked.size > 0 && (<div className="bulk"><b className="small">{checked.size} selected</b>
      <Button variant="primary" size="compact" onClick={() => bulk('accept')}>Accept</Button>
      <NativeSelect className="sm" style={sx("width:auto")} aria-label="Move selected to" value="" onChange={(e) => e.target.value && bulk('move', e.target.value)}><NativeSelectOption value="">Move to…</NativeSelectOption>{projects.map((p, ki) => (<NativeSelectOption key={p?.id ?? ki} value={p.id}>{p.name}</NativeSelectOption>))}</NativeSelect>
      <Button variant="tertiary" size="compact" onClick={() => bulk('discard')}>Discard</Button>
      <Button variant="ghost" size="compact" onClick={() => setChecked(new Set(flat.filter((m) => m.status !== 'open').map((m) => m.id)))}>All</Button>
      <Button variant="ghost" size="compact" onClick={() => setChecked(new Set())}>Clear</Button></div>)}
    {np && (<NewProject fromMoment={np} onClose={() => setNp(null)} onCreated={() => reload()}  />)}</>;
}
