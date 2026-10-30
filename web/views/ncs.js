// The NCS pieces: the changelog card that sits beside each piece of work, its keyword sentence,
// the red → green value boxes, and the picture tile.
import { html, Icon, Avatar, fileUrl, rel, plural } from '../lib.js';

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
const swatched = (s) => String(s).split(', ').map((x, i) => html`${i ? ', ' : ''}${HEX.test(x) ? html`<span class="sw" style=${{ background: x, marginRight: '4px', verticalAlign: '-1px' }}></span>` : ''}${x}`);

export const Sentence = ({ seg, text }) => html`<p class="sentence">${(seg?.length ? seg : [{ t: text || '' }]).map((s) => (s.k ? html`<span class="kw">${s.k}</span>` : s.t))}</p>`;

function Rows({ rows, ts }) {
  return html`<dl class="clog-rows">${rows.map((c) => {
    const added = c.after === 'added', removed = c.after === 'removed';
    const node = c.path.split(' › ')[0].replace(/\s*\([A-Z]+\)$/, '');
    return html`<dt>${c.category}</dt><dd>
      <span class="v"><span class="dot" aria-hidden="true"></span><span class="trunc">${added ? html`Added ${node}` : removed ? html`Removed ${node}` : html`${c.before ? html`${swatched(val(c.before, c.attr))} <span class="arrow">→</span> ` : ''}${swatched(val(c.after, c.attr))}`}</span></span>
      <span class="sub trunc">${added || removed ? 'Layer' : `${c.attr}${node && node !== c.attr ? ` · ${node}` : ''}`} · ${time(ts)}</span>
    </dd>`;
  })}</dl>`;
}

// NCS's changelog card. `project` shows the project's name at the top (the feed); a moment page omits it.
export function Changelog({ m, project, href, menu, children, rows = true }) {
  if (!m) return html`<article class="clog"><h3>Changes</h3><p class="muted small">No accepted changes yet.</p></article>`;
  return html`<article class="clog">
    ${project && html`<div class="clog-h"><${Avatar} name=${project.name} /><b class="trunc">${project.name}</b><span class="tools">${menu}</span></div>`}
    <h3>Changes</h3>
    <${Sentence} seg=${m.sentence} text=${m.summary} />
    ${rows && m.rows?.length > 0 && html`<div class="clog-sep"></div><h3>${dayLabel(m.end_ts)}</h3><${Rows} rows=${m.rows} ts=${m.end_ts} />`}
    ${children}
    ${href && html`<a class="ibtn expand" href=${href} aria-label=${`Open ${m.title}`} title="Open"><${Icon} n="arrows-out-simple" /></a>`}
  </article>`;
}

// A piece of work on its grey well, contained, never cropped.
export function Tile({ img, href, cls = '', label, alt = '', style }) {
  const key = img?.image_key || img?.thumb_key;
  const inner = html`${key ? html`<img src=${fileUrl(cls.includes('span') || cls.includes('wide') ? img.image_key || img.thumb_key : img.thumb_key || img.image_key)} alt=${alt} loading="lazy" decoding="async" />` : html`<div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--ink-3)"><${Icon} n="image" /></div>`}${label && html`<span class="cap">${label}</span>`}`;
  return href ? html`<a class=${`fimg ${cls}`} style=${style} href=${href} aria-label=${label || alt}>${inner}</a>` : html`<div class=${`fimg ${cls}`} style=${style}>${inner}</div>`;
}

// The before → after of one attribute, the way NCS's sidebar shows it.
export function BA({ c }) {
  const before = val(c.before, c.attr), after = val(c.after, c.attr);
  const numeric = /\d/.test(before) && /\d/.test(after) && before.length < 16 && after.length < 16;
  if (c.after === 'added' || c.after === 'removed') return html`<div class="ba"><span class="plain">${c.path.split(' › ')[0]}</span><i></i><span class=${c.after === 'added' ? 'now' : 'was'}>${c.after}</span></div>`;
  return numeric || HEX.test(before) ? html`<div class="ba"><span class="was">${swatched(before)}</span><${Icon} n="arrow-right" /><span class="now">${swatched(after)}</span></div>`
    : html`<div class="ba"><span class="plain" title=${before}>${before}</span><${Icon} n="arrow-right" /><span class="plain after" title=${after}>${after}</span></div>`;
}

// The changes sidebar: one card per kind of change (Font, Colour, Copy…), each attribute as a before → after.
export function AttrCards({ changes }) {
  const groups = {};
  for (const c of changes) (groups[c.category] ||= []).push(c);
  return Object.entries(groups).map(([cat, list]) => html`<article class="clog">
    <div class="clog-h"><h3>${cat}</h3><span class="tools muted tiny">${plural(list.length, 'change')}</span></div>
    ${list.slice(0, 12).map((c) => c.kind.startsWith('node.')
      ? html`<div class="ba"><span class="plain" title=${c.node}>${c.node}</span><i></i><span class=${c.after === 'added' ? 'now' : 'was'}>${c.after}</span></div>`
      : html`<div class="attr"><span>${c.attr}${c.node && c.node !== c.attr ? html` <span class="muted">· ${c.node}</span>` : ''}</span><${BA} c=${c} /></div>`)}
    ${list.length > 12 && html`<span class="tiny muted">${list.length - 12} more</span>`}
  </article>`);
}
