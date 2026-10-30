// Dialogs opened from several places: new project, add a link.
import { html, useState, api, go, toast, Dialog, Field, refreshMe } from '../lib.js';

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
  return html`<${Dialog} title="New project" onClose=${onClose}>
    <form class="col" style="gap:16px" onSubmit=${create}>
      ${err && html`<div class="errbox" role="alert">${err}</div>`}
      <${Field} label="Name" hint="What people call this body of work, e.g. Checkout redesign."><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} autofocus /></${Field}>
      <${Field} label="Brief (optional)" hint="Goal, audience, constraints, style. Agents read this first; Trace can draft it later from the work."><textarea class="input" rows="4" value=${brief} onInput=${(e) => setBrief(e.target.value)}></textarea></${Field}>
      <div class="row"><button class="btn primary" type="submit">Create project</button></div>
    </form>
  </${Dialog}>`;
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
  return html`<${Dialog} title=${asReference ? 'Add a reference link' : 'Add a link'} onClose=${onClose}>
    <form class="col" style="gap:16px" onSubmit=${add}>
      ${err && html`<div class="errbox" role="alert">${err}</div>`}
      <${Field} label="Link" hint=${asReference ? 'Dribbble, Behance, YouTube, a live site… Trace keeps a snapshot and tags it.' : 'Figma, Framer, Spline, Rive, Webflow, Adobe, YouTube, Loom, Dribbble, Behance, Google Docs or any page. Trace stores a snapshot and re-checks it every 6 hours.'}>
        <input class="input" type="url" inputmode="url" spellcheck="false" autocapitalize="none" placeholder="https://" value=${url} onInput=${(e) => setUrl(e.target.value)} autofocus /></${Field}>
      <div class="row"><button class="btn primary" type="submit" aria-disabled=${busy}>${busy ? 'Taking a snapshot…' : 'Add link'}</button></div>
    </form>
  </${Dialog}>`;
}
