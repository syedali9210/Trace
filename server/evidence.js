// Feedback that closes on evidence. A comment pinned to a part of a walked screen (its component on that screen) keeps
// what the part was when it was written: its size, its text, its props and the values it draws with. After every walk,
// each open one is looked at again on the same screen; when the part has changed, the comment closes itself with what
// changed and both pictures (the screen then, the screen now, the part's box on each), and says so in its thread. A
// screen the walk didn't reach, or a part it can't find, leaves the comment open: no evidence, no closing.
import { all, get, update, insert, uid, now, broadcast } from './db.js';
import { screens } from './screens.js';

export const keyOf = (s) => (s.steps || []).map((x) => x.go || x.label).join(' › '); // a screen, the same across walks: the clicks that reach it
// What a part is on a screen: the component's boxes there (its first, by size), its text, its props, and the values it
// draws with.
export function snapOf(s, comp) {
  const nodes = (s.tree || []).filter((t) => t.n === comp);
  if (!nodes.length) return null;
  const n = nodes[0], values = {};
  for (const v of s.values || []) if (v.at.some((a) => a.c === comp)) (values[v.prop] ||= []).push(v.v);
  for (const k of Object.keys(values)) values[k] = [...new Set(values[k])].sort();
  return { r: n.r, w: n.r[2], h: n.r[3], text: n.t || '', props: n.props || {}, values, count: nodes.length, shot: s.shot, sw: s.w, sh: s.h };
}
// What changed between two snaps, in words a person reads.
export function diffOf(a, b) {
  const out = [];
  for (const k of [...new Set([...Object.keys(a.values || {}), ...Object.keys(b.values || {})])]) {
    const x = a.values[k] || [], y = b.values[k] || [], gone = x.filter((v) => !y.includes(v)), added = y.filter((v) => !x.includes(v));
    if (gone.length === 1 && added.length === 1) out.push(`${k} ${gone[0]} → ${added[0]}`); // one value for another: say just that
    else { if (added.length) out.push(`${k} now also ${added.join(', ')}`); if (gone.length) out.push(`${k} no longer ${gone.join(', ')}`); }
  }
  if (Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1) out.push(`size ${a.w}×${a.h} → ${b.w}×${b.h}`);
  if (a.text !== b.text) out.push(`text “${a.text.slice(0, 40)}” → “${b.text.slice(0, 40)}”`);
  for (const k of [...new Set([...Object.keys(a.props), ...Object.keys(b.props)])]) if (String(a.props[k]) !== String(b.props[k])) out.push(`${k} ${a.props[k] ?? '–'} → ${b.props[k] ?? '–'}`);
  return out;
}
// A part comment as it's written: its screen and component, and the part as the last walk drew it.
export function partOf(p, sha, region) {
  const d = screens(p, sha), s = d.screens.find((x) => x.id === region.screen) || d.screens.find((x) => keyOf(x) === region.key);
  if (!s || !region.comp) return null;
  const snap = snapOf(s, region.comp);
  return snap && { kind: 'part', key: keyOf(s), screen: s.name, comp: region.comp, file: region.file || null, line: region.line || null, sha, at: d.at, snap };
}
// After a walk: every open part comment on this version, against the part as it's drawn now.
export function closeOnEvidence(p, sha) {
  const d = screens(p, sha), closed = [];
  for (const c of all("SELECT * FROM comment WHERE project_id=? AND status='open' AND target_type='version' AND target_id=?", p.id, `${p.id}:${sha}`)) {
    const g = c.region;
    if (g?.kind !== 'part' || !g.snap || (g.at && d.at <= g.at)) continue; // only a walk after it was written counts
    const s = d.screens.find((x) => keyOf(x) === g.key);
    const now2 = s && snapOf(s, g.comp);
    if (!now2) continue;
    const changed = diffOf(g.snap, now2);
    if (!changed.length) continue;
    const evidence = { at: d.at, changed, before: { shot: g.snap.shot, r: g.snap.r, w: g.snap.sw, h: g.snap.sh }, after: { shot: now2.shot, r: now2.r, w: now2.sw, h: now2.sh } };
    update('comment', c.id, { status: 'resolved', region: { ...g, evidence }, updated_at: now() });
    insert('comment', { id: uid('cm'), project_id: p.id, target_type: c.target_type, target_id: c.target_id, region: null, author_id: null, author_name: 'Trace', body: `Closed on evidence: the walk ${new Date(d.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} shows ${g.comp} on “${g.screen}” changed: ${changed.slice(0, 4).join('; ')}.`, parent_id: c.id, status: 'open', reactions: {}, created_at: now(), updated_at: now() });
    broadcast('comment', { id: c.id, project_id: p.id, target_type: c.target_type, target_id: c.target_id });
    closed.push(c.id);
  }
  return closed;
}
// The part comments of a version, for a screen and part when given: open first, then closed with their evidence.
export const partComments = (p, sha, key, comp) => all("SELECT id, body, author_name, status, region, created_at, updated_at FROM comment WHERE project_id=? AND target_type='version' AND target_id=? AND parent_id IS NULL ORDER BY status='open' DESC, created_at DESC", p.id, `${p.id}:${sha}`)
  .filter((c) => c.region?.kind === 'part' && (!key || c.region.key === key) && (!comp || c.region.comp === comp));
