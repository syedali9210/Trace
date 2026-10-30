// Proposal (team review): what's proposed, reviewers and their verdicts, region comments on the moments,
// Accept (it becomes the current direction) or Reject (it stays in history).
import { useState, api, useFetch, useMe, Header, Icon, ErrorBox, Loading, Seg, Field, Avatar, rel, stamp, plural, toast, fail, Button, ph, sx } from '../lib.jsx';
import { Textarea } from '@/components/ui/textarea';
import { MomentCard } from './project.jsx';
import { Thread, Composer } from './moment.jsx';

const VERDICT = { approve: ['Approved', 'ok', 'check-circle'], changes: ['Requested changes', 'warn', 'arrow-counter-clockwise'], comment: ['Commented', '', 'chat-circle'] };

export function Proposal({ id }) {
  const { data: p, error, loading, reload } = useFetch(`/proposals/${id}`, ['proposal', 'comment', 'moment'], (t, d) => d.id === id || d.target_id === id || t === 'moment');
  const me = useMe();
  const [verdict, setVerdict] = useState('approve');
  const [body, setBody] = useState('');
  if (error) return <><Header><a href="#/">Home</a></Header><div className="content"><ErrorBox error={error} retry={reload}  /></div></>;
  if (loading && !p) return <><Header><span>Loading…</span></Header><div className="content"><Loading h={400}  /></div></>;
  const role = me?.user.role;
  const canReview = me && !me.user.guest && ['owner', 'editor', 'reviewer'].includes(role);
  const canEdit = me && !me.user.guest && ['owner', 'editor'].includes(role);
  const open = ['open', 'changes_requested'].includes(p.status);
  const review = async (e) => { e.preventDefault(); try { await api(`/proposals/${id}/review`, { method: 'POST', body: { verdict, body } }); setBody(''); toast('Review posted'); reload(); } catch (er) { fail(er); } };
  const decide = async (what) => { try { await api(`/proposals/${id}/${what}`, { method: 'POST' }); toast(what === 'accept' ? 'Accepted: this is now the current direction, pinned on the project.' : 'Rejected. It stays in history.'); reload(); } catch (e) { fail(e); } };
  return <><Header actions={canEdit && open && <><Button variant="ghost" size="default" className="text-destructive" onClick={() => decide('reject')}>Reject</Button><Button variant="primary" size="default" leadingIcon={ph("check")} onClick={() => decide('accept')}>Accept</Button></>}>
      <a href={`#/p/${p.project_id}/proposals`}>Proposals</a><Icon n="caret-right"  /><b className="trunc">{p.title}</b>
    </Header>
    <div className="content"><div className="mdetail">
      <div className="col" style={sx("gap:16px")}>
        <div className="col" style={sx("gap:8px")}><h1>{p.title}</h1>
          <div className="row wrap small muted"><span className={`chip ${p.status === 'accepted' ? 'ok' : p.status === 'changes_requested' ? 'warn' : p.status === 'rejected' ? 'err' : 'sel'}`}>{p.status.replace('_', ' ')}</span><span>by {p.author}</span><span>· {rel(p.created_at)}</span>{p.exploration && (<span>· from the exploration <b>{p.exploration.name}</b></span>)}</div>
          {p.description && (<p className="ink2" style={sx("white-space:pre-wrap")}>{p.description}</p>)}
        </div>
        <span className="caps">{plural(p.moments.length, 'moment')} proposed · open one to pin comments on regions</span>
        <div className="tl">{p.moments.map((m, ki) => (<MomentCard key={m?.id ?? ki} m={m}  />))}</div>
      </div>
      <aside aria-label="Review">
        <div className="col" style={sx("gap:8px")}><span className="caps">Reviewers</span>
          {p.reviewer_names.length ? p.reviewer_names.map((r, ki) => { const last = [...p.reviews].reverse().find((x) => x.user_id === r.id); const v = last && VERDICT[last.verdict]; return (<div key={r?.id ?? ki} className="row small"><Avatar name={r.name}  /><span className="grow">{r.name}</span>{v ? (<span className={`chip ${v[1]}`}><Icon n={v[2]}  />{v[0]}</span>) : (<span className="tiny muted">Waiting</span>)}</div>); })
            : (<p className="small muted">No reviewers asked. Anyone with review access can still review.</p>)}
        </div>
        {p.reviews.length > 0 && (<div className="col" style={sx("gap:8px")}><span className="caps">Reviews</span>{p.reviews.map((r, ki) => (<div key={r?.id ?? ki} className="thread"><div className="row small"><b>{r.user}</b><span className={`chip ${VERDICT[r.verdict][1]}`}>{VERDICT[r.verdict][0]}</span><span className="tiny muted">{stamp(r.ts)}</span></div>{r.body && (<p className="small" style={sx("white-space:pre-wrap")}>{r.body}</p>)}</div>))}</div>)}
        {canReview && open && (<form className="panel col" style={sx("gap:12px")} onSubmit={review}>
          <span className="caps">Your review</span>
          <Seg label="Verdict" value={verdict} onChange={setVerdict} options={[{ value: 'approve', label: 'Approve' }, { value: 'changes', label: 'Request changes' }, { value: 'comment', label: 'Comment' }]}  />
          <Textarea rows="3" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What works, what doesn’t…" aria-label="Review"></Textarea>
          <div className="row"><Button variant="primary" size="compact">Post review</Button></div>
        </form>)}
        <div className="col" style={sx("gap:8px")}><span className="caps">Discussion</span>
          {p.comments.map((c, ki) => (<Thread key={c?.id ?? ki} c={c} me={me} onChange={reload} canEdit={canEdit} projectId={p.project_id}  />))}
          <Composer target={{ target_type: 'proposal', target_id: id }} onPosted={reload}  />
        </div>
      </aside>
    </div></div></>;
}
