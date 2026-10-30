// The NCS pieces: the changelog card that sits beside each piece of work, its keyword sentence,
// the red → green value boxes, and the picture tile.
import { Icon, Avatar, fileUrl, rel, plural, Button, sx, Fragment } from '../lib.jsx';

const HEX = /^#[0-9a-f]{3,8}$/i;
const WEIGHT = { 100: 'Thin', 200: 'Extralight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extrabold', 900: 'Black' };
export const time = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '');
export function dayLabel(ts) {
  const d = new Date(ts), t = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Today';
  if (same(d, new Date(t - 86400000))) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
export const longDate = (ts) => { const d = new Date(ts), n = d.getDate(); return `${d.toLocaleDateString(undefined, { month: 'short' })} ${n}${[, 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10] || 'th'}, ${d.getFullYear()}`; };

// A value as people read it: 16 → 16px for sizes, 700 → Bold, colours with a swatch.
export function val(v, attr) {
  const s = String(v ?? '');
  if (!s) return '—';
  if (attr === 'Weight' && WEIGHT[s]) return WEIGHT[s];
  if (/^(Size|Line height|Letter spacing|Radius)$/.test(attr) && /^-?\d+(\.\d+)?$/.test(s)) return `${s}px`;
  return s;
}
const swatched = (s) => String(s).split(', ').map((x, i) => <Fragment key={x?.id ?? i}>{i ? ', ' : ''}{HEX.test(x) ? (<span className="sw" style={sx({ background: x, marginRight: '4px', verticalAlign: '-1px' })}></span>) : ''}{x}</Fragment>);

export const Sentence = ({ seg, text }) => (<p className="sentence">{(seg?.length ? seg : [{ t: text || '' }]).map((s, i) => (s.k ? (<span key={i} className="kw">{s.k}</span>) : s.t))}</p>);

function Rows({ rows, ts }) {
  return (<dl className="clog-rows">{rows.map((c) => {
    const added = c.after === 'added', removed = c.after === 'removed';
    const node = c.path.split(' › ')[0].replace(/\s*\([A-Z]+\)$/, '');
    return <><dt>{c.category}</dt><dd>
      <span className="v"><span className="dot" aria-hidden="true"></span><span className="trunc">{added ? <>Added {node}</> : removed ? <>Removed {node}</> : <>{c.before ? <>{swatched(val(c.before, c.attr))} <span className="arrow">→</span></> : ''}{swatched(val(c.after, c.attr))}</>}</span></span>
      <span className="sub trunc">{added || removed ? 'Layer' : `${c.attr}${node && node !== c.attr ? ` · ${node}` : ''}`} · {time(ts)}</span>
    </dd></>;
  })}</dl>);
}

// NCS's changelog card. `project` shows the project's name at the top (the feed); a moment page omits it.
export function Changelog({ m, project, href, menu, children, rows = true }) {
  if (!m) return (<article className="clog"><h3>Changes</h3><p className="muted small">No accepted changes yet.</p></article>);
  return (<article className="clog">
    {project && (<div className="clog-h"><Avatar name={project.name}  /><b className="trunc">{project.name}</b><span className="tools">{menu}</span></div>)}
    <h3>Changes</h3>
    <Sentence seg={m.sentence} text={m.summary}  />
    {rows && m.rows?.length > 0 && <><div className="clog-sep"></div><h3>{dayLabel(m.end_ts)}</h3><Rows rows={m.rows} ts={m.end_ts}  /></>}
    {children}
    {href && (<Button variant="ghost" size="icon-compact" className="expand absolute right-2.5 bottom-2.5 z-[1]" aria-label={`Open ${m.title}`} title="Open" render={<a href={href} />}><Icon n="arrows-out-simple" size={15} /></Button>)}
  </article>);
}

// A piece of work on its grey well, contained, never cropped.
export function Tile({ img, href, cls = '', label, alt = '', style }) {
  const key = img?.image_key || img?.thumb_key;
  const inner = <>{key ? (<img src={fileUrl(cls.includes('span') || cls.includes('wide') ? img.image_key || img.thumb_key : img.thumb_key || img.image_key)} alt={alt} loading="lazy" decoding="async"  />) : (<div style={sx("position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-3)")}><Icon n="image"  /></div>)}{label && (<span className="cap">{label}</span>)}</>;
  return href ? (<a className={`fimg ${cls}`} style={sx(style)} href={href} aria-label={label || alt}>{inner}</a>) : (<div className={`fimg ${cls}`} style={sx(style)}>{inner}</div>);
}

// The before → after of one attribute, the way NCS's sidebar shows it.
export function BA({ c }) {
  const before = val(c.before, c.attr), after = val(c.after, c.attr);
  const numeric = /\d/.test(before) && /\d/.test(after) && before.length < 16 && after.length < 16;
  if (c.after === 'added' || c.after === 'removed') return (<div className="ba"><span className="plain">{c.path.split(' › ')[0]}</span><i></i><span className={c.after === 'added' ? 'now' : 'was'}>{c.after}</span></div>);
  return numeric || HEX.test(before) ? (<div className="ba"><span className="was">{swatched(before)}</span><Icon n="arrow-right"  /><span className="now">{swatched(after)}</span></div>)
    : (<div className="ba"><span className="plain" title={before}>{before}</span><Icon n="arrow-right"  /><span className="plain after" title={after}>{after}</span></div>);
}

// The changes sidebar: one card per kind of change (Font, Colour, Copy…), each attribute as a before → after.
export function AttrCards({ changes }) {
  const groups = {};
  for (const c of changes) (groups[c.category] ||= []).push(c);
  return Object.entries(groups).map(([cat, list], ki) => (<article key={ki} className="clog">
    <div className="clog-h"><h3>{cat}</h3><span className="tools muted tiny">{plural(list.length, 'change')}</span></div>
    {list.slice(0, 12).map((c) => c.kind.startsWith('node.')
      ? (<div className="ba"><span className="plain" title={c.node}>{c.node}</span><i></i><span className={c.after === 'added' ? 'now' : 'was'}>{c.after}</span></div>)
      : (<div className="attr"><span>{c.attr}{c.node && c.node !== c.attr ? (<span className="muted">· {c.node}</span>) : ''}</span><BA c={c}  /></div>))}
    {list.length > 12 && (<span className="tiny muted">{list.length - 12} more</span>)}
  </article>));
}
