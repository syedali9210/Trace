// References: pictures, videos, links, notes, colours and fonts, each one pinnable to the change it informed.
// Pictures a person pasted into a prompt to their AI are references too ("what the human gave"); they are
// picked up from the AI's own memory and pinned to the iteration that prompt led to.
import { all, get, run, insert, update, now, uid, broadcast } from './db.js';
import { preview, palette, imageHashes } from './media.js';
import { snapshotLink } from './connectors/link.js';
import { textVec } from './vec.js';
import { ftsPut, updateCentroid } from './engine.js';
import { exchangesFor } from './memory.js';

const strip = (o) => { if (o) { delete o.embedding; delete o.img_vec; } return o; };

export async function addReference({ project_id, kind, url, title, note, buf, name, value, origin, created_at }) {
  const ref = { id: uid('rf'), project_id, kind, url: url || null, title: title || name || '', note: note || null, tags: [], palette: [], x: null, y: null, w: null, h: null, origin: origin || null, created_at: created_at || now() };
  if (buf) {
    const p = await preview(buf, name);
    Object.assign(ref, { kind: p.kind === 'video' ? 'video' : p.kind === 'image' || p.kind === 'svg' ? 'image' : 'file', file_key: p.file_key, thumb_key: p.thumb_key, w: p.width, h: p.height });
    ref.note = ref.note || (p.text ? p.text.slice(0, 500) : null);
    if (p.image_key && p.kind !== 'pdf') { ref.palette = await palette(p.image_key); ref.img_vec = (await imageHashes(p.image_key)).img_vec; }
  } else if (kind === 'link' || kind === 'embed') {
    const s = await snapshotLink(url);
    ref.kind = s.embed_url && ['figma', 'youtube', 'loom', 'vimeo', 'spline', 'rive', 'framer'].includes(s.provider) ? 'embed' : 'link';
    ref.embed_url = s.embed_url; ref.title = ref.title || s.title; ref.note = ref.note || s.description || null;
    if (s.image) { const p = await preview(s.image, 'link.png'); Object.assign(ref, { file_key: p.image_key, thumb_key: p.thumb_key, w: p.width, h: p.height, palette: await palette(p.image_key), img_vec: (await imageHashes(p.image_key)).img_vec }); }
  } else if (kind === 'color') { ref.palette = [String(value || '').trim()]; ref.title = title || value; }
  else if (kind === 'font') { ref.title = title || value; ref.note = note || `Font: ${value}`; }
  ref.embedding = textVec(`${ref.title} ${ref.note || ''} ${ref.url || ''}`);
  insert('reference', ref);
  ftsPut('reference', ref.id, project_id, ref.title, `${ref.note || ''} ${ref.url || ''}`);
  updateCentroid(project_id);
  broadcast('reference', { id: ref.id, project_id });
  return strip(ref);
}

// Pin a reference to a change (an iteration), optionally to one attribute and a spot on its picture.
export function linkRef(ref_id, moment_id, { change_id = null, region = null, note = null, by = 'you' } = {}) {
  run(`INSERT INTO ref_link (ref_id, moment_id, change_id, region, note, by, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT (ref_id, moment_id) DO UPDATE SET change_id=excluded.change_id, region=excluded.region, note=COALESCE(excluded.note, ref_link.note), by=excluded.by`, ref_id, moment_id, change_id, region, note, by, now());
  const r = get('SELECT project_id FROM reference WHERE id=?', ref_id);
  broadcast('reference', { id: ref_id, project_id: r?.project_id, moment_id });
}
// Unpinning keeps a marker so an automatic pin isn't put back.
export const unlinkRef = (ref_id, moment_id) => run("UPDATE ref_link SET by='removed' WHERE ref_id=? AND moment_id=?", ref_id, moment_id);

export const refsFor = (moment_id) => all(`SELECT r.id, r.kind, r.title, r.note, r.url, r.embed_url, r.file_key, r.thumb_key, r.w, r.h, r.palette, r.origin, l.change_id, l.region, l.note link_note, l.by
  FROM ref_link l JOIN reference r ON r.id=l.ref_id WHERE l.moment_id=? AND l.by != 'removed' AND COALESCE(r.origin,'') != 'removed' ORDER BY r.created_at`, moment_id);

// The iteration a prompt led to: the first accepted change that finished after it.
export const iterationAfter = (moments, ts) => { let hit = null; for (const m of moments) if (m.end_ts >= ts && (!hit || m.end_ts < hit.end_ts)) hit = m; return hit; };

// Pictures pasted into prompts become references, pinned to the iteration that prompt led to.
const synced = {};
export function syncPromptRefs(project_id) {
  if (now() - (synced[project_id] || 0) < 15000) return;
  synced[project_id] = now();
  const moments = all("SELECT id, end_ts FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL", project_id);
  for (const ex of exchangesFor(project_id).filter((e) => e.images.length)) {
    const m = iterationAfter(moments, ex.ts);
    ex.images.forEach((img, i) => {
      let r = get('SELECT id FROM reference WHERE project_id=? AND (file_key=? OR file_key=?)', project_id, img.file_key, img.image_key);
      if (!r) {
        r = { id: uid('rf'), project_id, kind: 'image', title: `From your prompt to ${ex.tool}${ex.images.length > 1 ? ` (${i + 1})` : ''}`, note: ex.asked.slice(0, 400), url: null, file_key: img.file_key, thumb_key: img.thumb_key, w: img.w, h: img.h, tags: [], palette: [], origin: `prompt:${ex.adapter}`, created_at: ex.ts };
        insert('reference', r);
        ftsPut('reference', r.id, project_id, r.title, r.note);
      }
      if (m && !get('SELECT 1 FROM ref_link WHERE ref_id=? AND moment_id=?', r.id, m.id)) run('INSERT INTO ref_link (ref_id, moment_id, by, created_at) VALUES (?,?,?,?)', r.id, m.id, 'prompt', ex.ts);
    });
  }
}

export function projectRefs(project_id) {
  syncPromptRefs(project_id);
  return all("SELECT * FROM reference WHERE project_id=? AND COALESCE(origin,'') != 'removed' ORDER BY created_at DESC", project_id).map((r) => ({
    ...strip(r),
    links: all(`SELECT l.moment_id, l.change_id, l.region, l.by, m.title FROM ref_link l JOIN moment m ON m.id=l.moment_id WHERE l.ref_id=? AND l.by != 'removed' AND m.status != 'discarded'`, r.id),
  }));
}

export function deleteRef(ref) {
  if (String(ref.origin || '').startsWith('prompt')) update('reference', ref.id, { origin: 'removed' }); // remembered, so it isn't picked up again
  else { run('DELETE FROM reference WHERE id=?', ref.id); run('DELETE FROM ref_link WHERE ref_id=?', ref.id); }
  run("DELETE FROM search_fts WHERE kind='reference' AND ref_id=?", ref.id);
  broadcast('reference', { id: ref.id, project_id: ref.project_id });
}
