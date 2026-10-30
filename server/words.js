// The changelog, in words, from the diff alone: no model inside Trace. Agents bring their own intelligence
// and memory; Trace writes only what the diff proves ("Decreased font size. Changed typeface family.").

const num = (v) => { const m = String(v ?? '').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
const nice = (n = '') => n.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
const node = (path = '') => path.split(' › ')[0].replace(/\s*\((FRAME|TEXT|GROUP|INSTANCE|COMPONENT|RECTANGLE|VECTOR|ELLIPSE)\)$/i, '');
const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

// Each change becomes [verb, keyword]; the sentence groups keywords by verb, in the order they matter.
function phrases(changes) {
  const out = [];
  const add = (verb, key) => { if (!out.some((p) => p[0] === verb && p[1] === key)) out.push([verb, key]); };
  const by = (pred) => changes.filter(pred);
  const dir = (cs, word) => {
    const up = cs.filter((c) => num(c.after) > num(c.before)).length, down = cs.filter((c) => num(c.after) < num(c.before)).length;
    if (up && !down) add('Increased', word); else if (down && !up) add('Decreased', word); else if (cs.length) add('Changed', word);
  };
  dir(by((c) => c.path.endsWith('font.size')), 'font size');
  if (by((c) => c.path.endsWith('font.family')).length) add('Changed', 'typeface family');
  dir(by((c) => c.path.endsWith('font.weight')), 'font weight');
  if (by((c) => /font\.(lineHeight|letterSpacing)$/.test(c.path)).length) add('Adjusted', 'line spacing');
  if (by((c) => c.kind === 'color' && /fills|opacity/.test(c.path)).length) add('Changed', 'colours');
  if (by((c) => c.path.endsWith('strokes')).length) add('Changed', 'strokes');
  if (by((c) => c.kind === 'copy').length) add('Edited', 'copy');
  dir(by((c) => c.path.endsWith('radius')), 'corner radius');
  if (by((c) => c.kind === 'effect').length) add('Changed', 'effects');
  if (by((c) => c.kind === 'spacing' || c.path.endsWith('layout.mode')).length) add('Adjusted', 'spacing');
  for (const c of by((c) => c.kind === 'node.added').slice(0, 2)) add('Added', node(c.path));
  for (const c of by((c) => c.kind === 'node.removed').slice(0, 2)) add('Removed', node(c.path));
  const moved = [...new Set(by((c) => c.path.endsWith('› position')).map((c) => node(c.path)))];
  if (moved.length) add('Moved', moved.length > 2 ? `${moved.length} layers` : list(moved));
  const resized = [...new Set(by((c) => c.path.endsWith('› size')).map((c) => node(c.path)))];
  if (resized.length) add('Resized', resized.length > 2 ? `${resized.length} layers` : list(resized));
  if (by((c) => c.kind === 'component').length) add('Swapped', 'components');
  for (const c of by((c) => c.kind === 'token').slice(0, 3)) add('Updated', c.path);
  if (by((c) => c.kind === 'motion').length) add('Changed', 'animation');
  const code = by((c) => c.kind === 'code');
  if (code.length) add('Changed', `${code.length} file${code.length > 1 ? 's' : ''}`);
  return out;
}

// Sentence as segments: plain text and {k} keywords (shown as chips), e.g. NCS's "Decreased [font size]."
const FILE_TYPES = ['code', 'doc', 'file', 'font', 'repo', 'pull request'];
export function sentence({ changes = [], semantic, assets = [], visual }) {
  const ps = phrases(changes.filter((c) => !['region', 'visual'].includes(c.kind)));
  if (!ps.length) {
    const screens = assets.filter((a) => !FILE_TYPES.includes(a.type)).length;
    if (semantic === 'new screen' && assets.length > 1 && (assets.some((a) => a.type === 'code') || screens < assets.length / 2)) { // a code folder: its pictures are the site's images, not screens (its screens come from walking it)
      const n = (t) => assets.filter((a) => a.type === t).length;
      if (!n('image')) return [{ t: 'Added ' }, { k: `${assets.length} files` }, { t: '.' }];
      const parts = [[n('code'), 'code file'], [n('image'), 'image'], [assets.length - n('code') - n('image'), 'other file']].filter(([k]) => k).slice(0, 2).map(([k, w]) => `${k} ${w}${k > 1 ? 's' : ''}`); // two kinds fit a title; the summary counts every file
      return [{ t: 'Added ' }, ...parts.flatMap((p, i) => [...(i ? [{ t: i === parts.length - 1 ? ' and ' : ', ' }] : []), { k: p }]), { t: '.' }];
    }
    if (semantic === 'new screen') return [{ t: 'Added ' }, { k: assets.length > 1 ? `${assets.length} screens` : 'a new screen' }, { t: '.' }];
    if (semantic === 'asset added') return [{ t: 'Added ' }, { k: assets.length > 1 ? `${assets.length} files` : nice(assets[0]?.name || 'a file') }, { t: '.' }];
    if (visual) return [{ t: 'Changed ' }, { k: `${+visual < 10 ? (+visual).toFixed(1) : Math.round(visual)}% of the pixels` }, { t: '.' }];
    return [{ t: 'Saved with no visible change.' }];
  }
  const verbs = [...new Set(ps.map((p) => p[0]))].slice(0, 4);
  const seg = [];
  verbs.forEach((v, i) => {
    const keys = ps.filter((p) => p[0] === v).map((p) => p[1]).slice(0, 3);
    seg.push({ t: `${i ? ' ' : ''}${v} ` });
    keys.forEach((k, j) => { if (j) seg.push({ t: j === keys.length - 1 ? ' and ' : ', ' }); seg.push({ k }); });
    seg.push({ t: '.' });
  });
  return seg;
}
export const plain = (seg) => seg.map((s) => s.t ?? s.k).join('');

const CATEGORY = { typography: 'Font', color: 'Colour', copy: 'Copy', layout: 'Layout', spacing: 'Spacing', shape: 'Shape', effect: 'Effect', component: 'Component', token: 'Token', code: 'Code', motion: 'Motion', 'node.added': 'Layer', 'node.removed': 'Layer' };
const ATTR = { 'font.size': 'Size', 'font.family': 'Style', 'font.weight': 'Weight', 'font.lineHeight': 'Line height', 'font.letterSpacing': 'Letter spacing', fills: 'Fill', strokes: 'Stroke', text: 'Text', radius: 'Radius', position: 'Position', size: 'Size', effects: 'Effects', opacity: 'Opacity' };
export const category = (c) => CATEGORY[c.kind] || 'Change';
export const attrName = (c) => ATTR[c.path.split(' › ')[1]] || c.path.split(' › ')[1] || c.path;

// The moment's title, summary and grounded "why" (only when a note, commit or comment gives a reason).
const WEIGHT = { 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extrabold', 300: 'Light' };
export const weightName = (v) => WEIGHT[num(v)] || v;

// The folder many files share ("packages/studio"), so a big change is named after where it happened.
const commonDir = (assets) => {
  const parts = assets.map((a) => String(a.path || a.name || '').replace(/\\/g, '/').split('/').slice(0, -1));
  const out = [];
  for (let i = 0; parts.every((p) => p.length > i && p[i] === parts[0][i]); i++) out.push(parts[0][i]);
  return out.at(-1) || '';
};

export function describe({ changes = [], assets = [], semantic, event_count, links = [], visual, source, tool }) {
  const seg = sentence({ changes, semantic, assets, visual: visual?.pixels_changed_pct });
  const commit = links.find((l) => l.startsWith('commit:'))?.slice(7);
  const label = links.find((l) => l.startsWith('version:'))?.slice(8);
  const one = nice(assets[0]?.name || 'Project');
  const area = assets.length > 1 ? nice(commonDir(assets)) || (tool !== 'upload' && source) || '' : /^[0-9a-f]{16,}$/i.test(one) ? '' : one; // a hash-named file says nothing
  const first = seg.find((s) => s.k);
  const what = plain(seg).split(/\.(?:\s|$)/)[0]; // a sentence ends at ". ", not inside "4.9%"
  let title = commit ? commit.split('\n')[0] : label ? `${area || 'Version'}: ${label}` : first ? (area ? `${area}: ${what.toLowerCase()}` : what) : area || 'Saved';
  title = title.split(/\s+/).slice(0, 12).join(' '); // "Animation engine mobile: added 172 code files and 111 images" whole
  const why = links.find((l) => /^(comment|issue|commit|note|pr):/.test(l) && /\b(because|so that|so it|to fix|feedback|per |asked)\b/i.test(l))?.replace(/^\w+:/, '') || '';
  const summary = `${plain(seg)}${assets.length > 1 ? ` ${assets.length} files.` : ''}${event_count > 1 ? ` ${event_count} edits grouped.` : ''}`;
  const tags = [semantic, ...new Set(changes.map((c) => c.kind.split('.')[0]))].filter(Boolean).slice(0, 5);
  return { title, summary, why: why.slice(0, 240), tags, sentence: seg, type: semantic };
}

// Decisions people state in commits, version notes and comments are suggested; a person confirms them.
const DECIDE = /\b(we('ll| will)? (go|went) with|decided|decision:|let'?s (use|go with|keep)|agreed|final(ly)?:|going with|ship (it|this) with)\b/i;
export function decisions(texts) {
  return texts.flatMap(({ id, text }) => String(text).split(/(?<=[.!?\n])\s+/).filter((s) => DECIDE.test(s)).map((s) => ({ text: s.trim().slice(0, 300), source_id: id })));
}

export function summarize(moments, period) {
  if (!moments.length) return '';
  return `${moments.length} moment${moments.length > 1 ? 's' : ''} this ${period}: ${moments.slice(0, 5).map((m) => m.title).join('; ')}.`;
}

export function draftBrief(project, recent) {
  const tags = [...new Set(recent.flatMap((m) => m.tags || []))].slice(0, 6).join(', ');
  return `Goal: ${project.name} (edit me)\nAudience: unknown\nConstraints: unknown\nStyle: ${tags || 'unknown'}`;
}
