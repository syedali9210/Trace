// Dialogs opened from several places: new project, add a link.
import { useState, useRef, api, go, toast, Dialog, Field, refreshMe, Button, sx, ph, addCodeFolder, filesOfPick } from '../lib.jsx';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function NewProject({ onClose, fromMoment, onCreated }) {
  const [name, setName] = useState('');
  const [brief, setBrief] = useState('');
  const [err, setErr] = useState(null);
  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Give the project a name.');
    try {
      const p = await api('/projects', { method: 'POST', body: { name, brief, from_moment: fromMoment } });
      await refreshMe(); onClose(); toast(`Created ${p.name}`);
      onCreated ? onCreated(p) : go(`/p/${p.id}`);
    } catch (e2) { setErr(e2.message); }
  };
  const pick = useRef();
  return (<Dialog title="New project" onClose={onClose}>
    <form className="col" style={sx("gap:16px")} onSubmit={create}>
      {err && (<div className="errbox" role="alert">{err}</div>)}
      {!fromMoment && (<div className="row wrap" style={sx('gap:8px 12px')}>
        <Button variant="secondary" size="default" leadingIcon={ph('folder-simple-plus')} onClick={() => pick.current.click()}>From a code folder</Button>
        <span className="small muted">Its versions, screens and packages; Trace links the folder where it is.</span>
        <input type="file" hidden webkitdirectory="" ref={pick} onChange={(e) => { const list = e.target.files; if (list?.length) { onClose(); addCodeFolder(list[0].webkitRelativePath.split('/')[0], filesOfPick(list)); } e.target.value = ''; }} />
      </div>)}
      <Field label="Name" hint="What people call this body of work, e.g. Checkout redesign."><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Brief (optional)" hint="Goal, audience, constraints, style. Agents read this first; Trace can draft it later from the work."><Textarea rows="4" value={brief} onChange={(e) => setBrief(e.target.value)}></Textarea></Field>
      <div className="row"><Button variant="primary" size="default" type="submit">Create project</Button></div>
    </form>
  </Dialog>);
}

export function AddLink({ onClose, project_id, asReference, onAdded }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const add = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api(asReference ? `/projects/${project_id}/references` : '/links', { method: 'POST', body: asReference ? { kind: 'link', url } : { url, project_id } });
      onClose(); onAdded?.(r);
      toast(asReference ? 'Reference added.' : r.skipped ? 'That link is already tracked and hasn’t changed.' : `Link added${r.tracked_by_figma ? '; Figma will track it as a source' : ''}. Its snapshot will appear in a moment.`);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (<Dialog title={asReference ? 'Add a reference link' : 'Add a link'} onClose={onClose}>
    <form className="col" style={sx("gap:16px")} onSubmit={add}>
      {err && (<div className="errbox" role="alert">{err}</div>)}
      <Field label="Link" hint={asReference ? 'Dribbble, Behance, YouTube, a live site… Trace keeps a snapshot and tags it.' : 'Figma, Framer, Spline, Rive, Webflow, Adobe, YouTube, Loom, Dribbble, Behance, Google Docs or any page. Trace stores a snapshot and re-checks it every 6 hours.'}>
        <Input type="url" inputMode="url" spellCheck="false" autoCapitalize="none" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus /></Field>
      <div className="row"><Button variant="primary" size="default" type="submit" aria-disabled={busy}>{busy ? 'Taking a snapshot…' : 'Add link'}</Button></div>
    </form>
  </Dialog>);
}
