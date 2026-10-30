// Proposal (team review): what's proposed, reviewers and their verdicts, region comments on the moments,
// Accept (it becomes the current direction) or Reject (it stays in history).
import { html, useState, api, useFetch, useMe, Header, Icon, ErrorBox, Loading, Seg, Field, Avatar, rel, stamp, plural, toast, fail } from '../lib.js';
import { MomentCard } from './project.js';
import { Thread, Composer } from './moment.js';

const VERDICT = { approve: ['Approved', 'ok', 'check-circle'], changes: ['Requested changes', 'warn', 'arrow-counter-clockwise'], comment: ['Commented', '', 'chat-circle'] };

export function Proposal({ id }) {
  const { data: p, error, loading, reload } = useFetch(`/proposals/${id}`, ['proposal', 'comment', 'moment'], (t, d) => d.id === id || d.target_id === id || t === 'moment');
  const me = useMe();
  const [verdict, setVerdict] = useState('approve');
  const [body, setBody] = useState('');
  if (error) return html`<${Header}><a href="#/">Home</a></${Header}><div class="content"><${ErrorBox} error=${error} retry=${reload} /></div>`;
  if (loading && !p) return html`<${Header}><span>Loading…</span></${Header}><div class="content"><${Loading} h=${400} /></div>`;
  const role = me?.user.role;
  const canReview = me && !me.user.guest && ['owner', 'editor', 'reviewer'].includes(role);
  const canEdit = me && !me.user.guest && ['owner', 'editor'].includes(role);
  const open = ['open', 'changes_requested'].includes(p.status);
  const review = async (e) => { e.preventDefault(); try { await api(`/proposals/${id}/review`, { method: 'POST', body: { verdict, body } }); setBody(''); toast('Review posted'); reload(); } catch (er) { fail(er); } };
  const decide = async (what) => { try { await api(`/proposals/${id}/${what}`, { method: 'POST' }); toast(what === 'accept' ? 'Accepted: this is now the current direction, pinned on the project.' : 'Rejected. It stays in history.'); reload(); } catch (e) { fail(e); } };
  return html`
    <${Header} actions=${canEdit && open && html`<button class="btn ghost danger" onClick=${() => decide('reject')}>Reject</button><button class="btn primary" onClick=${() => decide('accept')}><${Icon} n="check" />Accept</button>`}>
      <a href=${`#/p/${p.project_id}/proposals`}>Proposals</a><${Icon} n="caret-right" /><b class="trunc">${p.title}</b>
    </${Header}>
    <div class="content"><div class="mdetail">
      <div class="col" style="gap:16px">
        <div class="col" style="gap:8px"><h1>${p.title}</h1>
          <div class="row wrap small muted"><span class=${`chip ${p.status === 'accepted' ? 'ok' : p.status === 'changes_requested' ? 'warn' : p.status === 'rejected' ? 'err' : 'sel'}`}>${p.status.replace('_', ' ')}</span><span>by ${p.author}</span><span>· ${rel(p.created_at)}</span>${p.exploration && html`<span>· from the exploration <b>${p.exploration.name}</b></span>`}</div>
          ${p.description && html`<p class="ink2" style="white-space:pre-wrap">${p.description}</p>`}
        </div>
        <span class="caps">${plural(p.moments.length, 'moment')} proposed · open one to pin comments on regions</span>
        <div class="tl">${p.moments.map((m) => html`<${MomentCard} m=${m} />`)}</div>
      </div>
      <aside aria-label="Review">
        <div class="col" style="gap:8px"><span class="caps">Reviewers</span>
          ${p.reviewer_names.length ? p.reviewer_names.map((r) => { const last = [...p.reviews].reverse().find((x) => x.user_id === r.id); const v = last && VERDICT[last.verdict]; return html`<div class="row small"><${Avatar} name=${r.name} /><span class="grow">${r.name}</span>${v ? html`<span class=${`chip ${v[1]}`}><${Icon} n=${v[2]} />${v[0]}</span>` : html`<span class="tiny muted">Waiting</span>`}</div>`; })
            : html`<p class="small muted">No reviewers asked. Anyone with review access can still review.</p>`}
        </div>
        ${p.reviews.length > 0 && html`<div class="col" style="gap:8px"><span class="caps">Reviews</span>${p.reviews.map((r) => html`<div class="thread"><div class="row small"><b>${r.user}</b><span class=${`chip ${VERDICT[r.verdict][1]}`}>${VERDICT[r.verdict][0]}</span><span class="tiny muted">${stamp(r.ts)}</span></div>${r.body && html`<p class="small" style="white-space:pre-wrap">${r.body}</p>`}</div>`)}</div>`}
        ${canReview && open && html`<form class="panel col" style="gap:12px" onSubmit=${review}>
          <span class="caps">Your review</span>
          <${Seg} label="Verdict" value=${verdict} onChange=${setVerdict} options=${[{ value: 'approve', label: 'Approve' }, { value: 'changes', label: 'Request changes' }, { value: 'comment', label: 'Comment' }]} />
          <textarea class="input" rows="3" value=${body} onInput=${(e) => setBody(e.target.value)} placeholder="What works, what doesn’t…" aria-label="Review"></textarea>
          <div class="row"><button class="btn primary sm">Post review</button></div>
        </form>`}
        <div class="col" style="gap:8px"><span class="caps">Discussion</span>
          ${p.comments.map((c) => html`<${Thread} c=${c} me=${me} onChange=${reload} canEdit=${canEdit} projectId=${p.project_id} />`)}
          <${Composer} target=${{ target_type: 'proposal', target_id: id }} onPosted=${reload} />
        </div>
      </aside>
    </div></div>`;
}
