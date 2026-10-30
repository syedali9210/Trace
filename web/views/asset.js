// A file's history: every version kept, any two compared, comments on the file itself.
import { html, useState, useEffect, api, useFetch, useMe, Header, Icon, ErrorBox, Loading, ToolChip, Magnitude, ChangeLine, Thumb, rel, stamp, plural, fileUrl, fail } from '../lib.js';
import { Viewer, TextDiff, Thread, Composer } from './moment.js';

export function Asset({ id }) {
  const { data: a, error, loading, reload } = useFetch(`/assets/${id}`, ['moment', 'comment'], (t, d) => t === 'moment' || d.target_id === id);
  const me = useMe();
  const [pair, setPair] = useState(null);
  const [cmp, setCmp] = useState(null);
  const [region, setRegion] = useState(null);
  const [pinning, setPinning] = useState(false);
  useEffect(() => { if (a && !pair) setPair({ a: a.versions[1]?.id, b: a.versions[0]?.id }); }, [a]);
  useEffect(() => {
    if (!pair?.a || !pair?.b) return setCmp(null);
    api(`/compare?a=${pair.a}&b=${pair.b}`).then(setCmp).catch(fail);
  }, [pair?.a, pair?.b]);
  if (error) return html`<${Header}><a href="#/">Home</a></${Header}><div class="content"><${ErrorBox} error=${error} retry=${reload} /></div>`;
  if (loading && !a) return html`<${Header}><span>Loading…</span></${Header}><div class="content"><${Loading} h=${400} /></div>`;
  const vB = a.versions.find((v) => v.id === pair?.b) || a.versions[0];
  const vA = a.versions.find((v) => v.id === pair?.a);
  const textual = ['code', 'doc'].includes(a.type);
  const canEdit = me && !me.user.guest && ['owner', 'editor'].includes(me.user.role);
  const regions = cmp ? [...(cmp.diff.visual?.regions || []), ...cmp.diff.changes.filter((c) => c.region).slice(0, 12).map((c) => ({ ...c.region, attr: true, label: `${c.path}: ${c.before || '—'} → ${c.after}` }))] : [];
  const pins = a.comments.filter((c) => c.region).map((c, i) => ({ id: c.id, n: i + 1, region: c.region, body: c.body }));
  return html`
    <${Header} actions=${html`${a.url && html`<a class="btn" href=${a.url} target="_blank" rel="noopener">Open in ${a.tool === 'figma' ? 'Figma' : a.tool === 'github' ? 'GitHub' : 'source'} <${Icon} n="arrow-up-right" /></a>`}${vB?.file_key && html`<a class="btn" href=${fileUrl(vB.file_key)} download=${a.name}><${Icon} n="download-simple" /><span class="label-lg">Download</span></a>`}`}>
      ${a.project_id ? html`<a href=${`#/p/${a.project_id}/files`}>${a.project_name}</a>` : html`<a href="#/inbox">Inbox</a>`}<${Icon} n="caret-right" /><b class="trunc">${a.name}</b>
    </${Header}>
    <div class="content wide"><div class="mdetail">
      <div class="col" style="gap:16px">
        <div class="row wrap small muted"><${ToolChip} tool=${a.tool} /><span>${a.type}</span><span>· ${a.path}</span><span>· ${plural(a.versions.length, 'version')}</span></div>
        ${textual && vA ? html`<${TextVersions} a=${pair.a} b=${pair.b} />`
          : html`<${Viewer} before=${vA} after=${vB} regions=${regions} pins=${pins} pinning=${pinning} onPin=${(r) => { setRegion(r); setPinning(false); }} onRegion=${(r) => setRegion({ x: r.x, y: r.y, w: r.w, h: r.h })} />`}
        ${cmp && html`<div class="panel col" style="gap:8px">
          <div class="row between"><span class="caps">${vA ? `${stamp(vA.created_at)} → ${stamp(vB.created_at)}` : 'First version'}</span><${Magnitude} score=${cmp.diff.score} bucket=${cmp.diff.bucket} basis=${cmp.diff.basis} /></div>
          ${cmp.diff.changes.length ? cmp.diff.changes.slice(0, 30).map((c) => html`<${ChangeLine} c=${c} />`) : html`<p class="small muted">${cmp.diff.visual ? `${cmp.diff.visual.pct}% of pixels changed; no structured properties to compare for this file type.` : 'No differences found.'}</p>`}
        </div>`}
      </div>
      <aside aria-label="Versions and comments">
        <div class="col" style="gap:4px"><span class="caps">Versions · pick two to compare</span>
          <div class="card list-rows" style="max-height:420px;overflow:auto">${a.versions.map((v, i) => html`<div class="lrow" style=${{ padding: '8px 12px', background: v.id === pair?.b || v.id === pair?.a ? 'var(--sel-bg)' : '' }}>
            <${Thumb} snap=${v} style="width:56px;height:42px;flex:none" />
            <div class="col grow" style="gap:0"><span class="small">${v.payload?.label || v.payload?.message?.split('\n')[0] || (i === 0 ? 'Latest' : `Version ${a.versions.length - i}`)}</span><span class="tiny muted">${v.actor ? `${v.actor} · ` : ''}${rel(v.created_at)}${v.flags?.injection ? ' · flagged text' : ''}</span></div>
            <div class="row" style="gap:2px"><button class="btn sm ghost" aria-pressed=${v.id === pair?.a} onClick=${() => setPair({ ...pair, a: v.id })} title="Compare from this version">A</button><button class="btn sm ghost" aria-pressed=${v.id === pair?.b} onClick=${() => setPair({ ...pair, b: v.id })} title="Compare to this version">B</button></div>
          </div>`)}</div>
        </div>
        ${a.moments.length > 0 && html`<div class="col" style="gap:4px"><span class="caps">Moments that changed it</span>${a.moments.map((m) => html`<a class="row small" href=${`#/m/${m.id}`}><${Magnitude} score=${m.magnitude} bucket=${m.bucket} compact /><span class="trunc grow">${m.title}</span><span class="tiny muted">${rel(m.end_ts)}</span></a>`)}</div>`}
        <div class="col" style="gap:8px"><span class="caps">Comments on this file</span>
          ${a.comments.map((c) => html`<${Thread} c=${c} me=${me} onChange=${reload} pinNo=${pins.find((p) => p.id === c.id)?.n} canEdit=${canEdit} projectId=${a.project_id} />`)}
          ${a.project_id ? html`<${Composer} target=${{ target_type: 'asset', target_id: id }} region=${region} clearRegion=${() => setRegion(null)} onPosted=${reload} pinning=${pinning} setPinning=${!textual && vB?.image_key ? setPinning : null} />` : html`<p class="small muted">File this into a project to comment.</p>`}
        </div>
      </aside>
    </div></div>`;
}

function TextVersions({ a, b }) {
  const [t, setT] = useState(null);
  useEffect(() => { Promise.all([fetchText(a), fetchText(b)]).then(setT).catch(fail); }, [a, b]);
  return t ? html`<${TextDiff} before=${t[0]} after=${t[1]} />` : html`<${Loading} h=${300} />`;
}
const fetchText = async (snapId) => (await api(`/snapshots/${snapId}/text`)).text;
