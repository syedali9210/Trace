// The Capture & Curation Engine: raw events in, a few trustworthy moments out.
// ingest → normalize → snapshot → diff → cluster → route → describe → index, each stage a worker on a durable
// queue (the job table), so a slow stage never blocks capture. Inbox corrections flow back into routing.
// ponytail: in-process workers over SQLite; move to Temporal/BullMQ when stages need their own machines.
import { all, get, run, insert, update, now, uid, settings, setSettings, broadcast, audit, notify, edge, mapActor, WS } from './db.js';
import { preview, imageHashes, sha256, textCard } from './media.js';
import { diffSnapshots, bucket } from './diff.js';
import { textVec, cosine, mean } from './vec.js';
import * as words from './words.js';
import path from 'node:path';
import { RENDERABLE, renderVersion } from './render.js';

export const registry = {};
export const registerConnector = (c) => (registry[c.tool] = c);

export function systemSource(tool, name) {
  let s = get('SELECT * FROM source WHERE tool=? AND workspace_id=?', tool, WS);
  if (!s) { insert('source', { id: uid('src'), workspace_id: WS, tool, name, status: 'active', created_at: now() }); s = get('SELECT * FROM source WHERE tool=?', tool); }
  return s;
}

const globHit = (pat, s) => new RegExp(pat.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i').test(s);

// ---------- stage 1: ingest ----------
export function ingest(source, e) {
  const s = settings();
  if (s.paused && source.tool !== 'agent') return { skipped: 'paused' };
  if (source.status !== 'active') return { skipped: source.status };
  if ((s.mute || []).some((m) => m.source_id === source.id && m.type === e.type)) return { skipped: 'muted' };
  const target = `${e.payload?.path || ''} ${e.payload?.name || ''} ${e.external_id}`;
  for (const p of all("SELECT do_not_capture FROM project WHERE do_not_capture != '[]'")) {
    if ((p.do_not_capture || []).some((pat) => pat && globHit(pat, target))) return { skipped: 'do-not-capture' };
  }
  const key = `${source.tool}:${e.external_id}:${e.version}`; // tool + external id + version: retries never double-capture
  if (get('SELECT id FROM event WHERE idempotency_key=?', key)) return { skipped: 'duplicate' };
  const ev = { id: uid('ev'), source_id: source.id, tool: source.tool, external_id: e.external_id, version: String(e.version), type: e.type, actor: e.actor || 'unknown', ts: e.ts || now(), payload: e.payload || {}, idempotency_key: key, created_at: now() };
  insert('event', ev);
  enqueue('normalize', { event_id: ev.id });
  broadcast('capture', { source_id: source.id, type: e.type });
  return { event_id: ev.id };
}

// ---------- queue ----------
const handlers = {};
const busy = {};
// Snapshots (reading a file, drawing a component) run a few at a time, never two of the same file (a file's versions
// keep their order); every other stage runs one job at a time.
const LANES = { snapshot: 3 };
const drawing = new Set();
export function enqueue(stage, payload, delay = 0) {
  run('INSERT INTO job (stage, payload, status, attempts, run_after, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', stage, payload, 'queued', 0, now() + delay, now(), now());
  if (!delay) setImmediate(() => work(stage));
}
async function work(stage) {
  if ((busy[stage] || 0) >= (LANES[stage] || 1)) return;
  busy[stage] = (busy[stage] || 0) + 1;
  if (busy[stage] < (LANES[stage] || 1)) setImmediate(() => work(stage)); // the next lane picks up the next job
  try {
    for (;;) {
      const lanes = LANES[stage] > 1;
      const j = all("SELECT * FROM job WHERE stage=? AND status='queued' AND run_after<=? ORDER BY id LIMIT 30", stage, now()).find((x) => !lanes || !drawing.has(x.payload?.asset_id));
      if (!j) break;
      const asset = lanes && j.payload?.asset_id;
      if (asset) drawing.add(asset);
      update('job', j.id, { status: 'running', attempts: j.attempts + 1, updated_at: now() });
      try {
        await handlers[stage](j.payload);
        update('job', j.id, { status: 'done', updated_at: now() });
      } catch (e) {
        const dead = j.attempts + 1 >= 5; // then the dead-letter queue, visible in Settings → Engine
        update('job', j.id, { status: dead ? 'dead' : 'queued', error: String(e?.stack || e).slice(0, 2000), run_after: now() + 2 ** j.attempts * 2000, updated_at: now() });
        if (dead) audit('engine', 'system', 'job.dead', stage, { job: j.id, error: e?.message });
      } finally { if (asset) drawing.delete(asset); }
    }
  } finally { busy[stage]--; }
}
export const STAGES = ['normalize', 'snapshot', 'diff', 'cluster', 'route', 'describe', 'index', 'render'];

// ---------- stage 2: normalize (tool data → DOM-T assets) ----------
handlers.normalize = async ({ event_id }) => {
  const ev = get('SELECT * FROM event WHERE id=?', event_id);
  const source = ev && get('SELECT * FROM source WHERE id=?', ev.source_id);
  if (!source || !registry[ev.tool]) return; // disconnected since
  const descs = await registry[ev.tool].fetchObject(ev, source);
  for (const d of descs) {
    let a = get('SELECT * FROM asset WHERE source_id=? AND external_id=?', source.id, d.external_id);
    if (!a) {
      a = { id: uid('as'), project_id: null, source_id: source.id, external_id: d.external_id, tool: ev.tool, type: d.type, name: d.name, path: d.path || d.name, parent: d.parent || '', url: d.url || null, created_at: now(), updated_at: now() };
      insert('asset', a);
    } else update('asset', a.id, { name: d.name, path: d.path || a.path, parent: d.parent ?? a.parent, url: d.url || a.url, type: d.type || a.type, updated_at: now() });
    for (const l of d.links || []) edge('asset', a.id, l.rel || 'references', 'asset', l.id); // e.g. a PR that implements a Figma frame
    enqueue('snapshot', { event_id, asset_id: a.id, desc: d });
  }
};

// ---------- stage 3: snapshot ----------
handlers.snapshot = async ({ event_id, asset_id, desc }) => {
  const ev = get('SELECT * FROM event WHERE id=?', event_id);
  const asset = get('SELECT * FROM asset WHERE id=?', asset_id);
  const source = get('SELECT * FROM source WHERE id=?', ev.source_id);
  if (!source) return;
  const out = await registry[ev.tool].renderPreview(ev, asset, desc, source);
  let p;
  if (out.buf) p = await preview(out.buf, out.name || asset.name);
  else if (out.image) { const pi = await preview(out.image, 'render.png'); p = { ...pi, file_key: null, properties: {} }; }
  else p = { ...(await preview(await textCard(out.card || { title: asset.name }), 'card.png')), file_key: null, properties: { file: { card: true } } }; // a generated card isn't the work: no pixel diff, never a cover
  const properties = { ...(p.properties || {}), ...(out.properties || {}) };
  const text = out.text || p.text || '';
  const prev = asset.latest_snapshot_id ? get('SELECT * FROM snapshot WHERE id=?', asset.latest_snapshot_id) : null;
  const content_hash = sha256(JSON.stringify([p.file_key || p.image_key, out.properties || null, out.buf ? null : text.slice(0, 5000)]));
  if (prev && prev.content_hash === content_hash) return enqueue('cluster', { event_id, asset_id, snapshot_id: null, noop: true }); // a no-op save
  const drawn = await drawComponent(asset, source, out.buf ? out.buf.toString('utf8') : text);
  if (drawn) {
    properties.component = drawn.component;
    if (drawn.p) { Object.assign(p, drawn.p); if (properties.file) properties.file = { ...properties.file, card: undefined }; }
    if (drawn.p && prev?.text && !prev.properties?.component?.mode) await redraw(prev, asset, source); // the version before is drawn too, so the change shows
  }
  const hashes = p.image_key ? await imageHashes(p.image_key).catch(() => ({})) : {};
  const snap = {
    id: uid('sn'), asset_id, event_id, prev_id: prev?.id || null, image_key: p.image_key, thumb_key: p.thumb_key, file_key: p.file_key, mime: p.mime,
    width: p.width, height: p.height, phash: hashes.phash, img_vec: hashes.img_vec, content_hash, properties, text: text.slice(0, 200000),
    embedding: textVec(`${asset.name} ${asset.path} ${text.slice(0, 3000)}`), flags: injectionFlags(text), created_at: now(),
  };
  insert('snapshot', snap);
  update('asset', asset_id, { latest_snapshot_id: snap.id, updated_at: now() });
  enqueue('diff', { event_id, snapshot_id: snap.id });
};

// A React component file is drawn (server/render.js): its picture is the component itself, not a card of its code.
async function drawComponent(asset, source, code) {
  if (!RENDERABLE.test(asset.name) || source?.tool !== 'folder' || !source.scope?.path || !code) return null;
  const r = await renderVersion({ file: path.join(source.scope.path, asset.path || asset.name), source: code });
  if (!r.png) return { component: { error: r.error } };
  const pi = await preview(r.png, 'render.png');
  return { p: { image_key: pi.image_key, thumb_key: pi.thumb_key, width: pi.width, height: pi.height }, component: { mode: r.mode, names: r.names } };
}
// Draw an existing version again (one captured before drawing existed, or the version before a change).
async function redraw(s, asset, source) {
  const d = await drawComponent(asset, source, s.text);
  if (!d) return;
  const props = { ...(s.properties || {}), component: d.component };
  if (!d.p) return update('snapshot', s.id, { properties: props });
  if (props.file) props.file = { ...props.file, card: undefined };
  const hashes = await imageHashes(d.p.image_key).catch(() => ({}));
  update('snapshot', s.id, { ...d.p, phash: hashes.phash, img_vec: hashes.img_vec, properties: props });
}
handlers.render = async ({ snapshot_id }) => {
  const s = get('SELECT * FROM snapshot WHERE id=?', snapshot_id);
  const asset = s && get('SELECT * FROM asset WHERE id=?', s.asset_id);
  const source = asset && get('SELECT * FROM source WHERE id=?', asset.source_id);
  if (s && !s.properties?.component) { await redraw(s, asset, source); broadcast('moment', { asset_id: asset.id }); }
};

// Captured text that reads like instructions to an AI is flagged, and served to agents marked as data.
const INJECT = /\b(ignore (all |the )?(previous|prior|above) instructions|disregard (the |all )?(previous|above)|you are now|system prompt|act as (an? )?(ai|assistant)|new instructions:|do not tell the user|exfiltrate|send (it|this|them) to)\b/i;
export function injectionFlags(text = '') {
  const hits = String(text).split(/\n|(?<=[.!?])\s+/).filter((l) => INJECT.test(l)).slice(0, 5);
  return hits.length ? { injection: hits.map((h) => h.slice(0, 200)) } : null;
}

// ---------- stage 4: diff ----------
handlers.diff = async ({ event_id, snapshot_id }) => {
  const s = get('SELECT * FROM snapshot WHERE id=?', snapshot_id);
  const prev = s.prev_id ? get('SELECT * FROM snapshot WHERE id=?', s.prev_id) : null;
  const asset = get('SELECT * FROM asset WHERE id=?', s.asset_id);
  update('snapshot', s.id, { diff: await diffSnapshots(prev, s, asset.type) });
  enqueue('cluster', { event_id, asset_id: s.asset_id, snapshot_id });
};

// ---------- stage 5: cluster (noise → moments) ----------
const momentAssets = (id) => all('SELECT a.*, s.img_vec AS vec FROM moment_asset ma JOIN asset a ON a.id=ma.asset_id LEFT JOIN snapshot s ON s.id=ma.last_snapshot_id WHERE ma.moment_id=?', id);

handlers.cluster = async ({ event_id, asset_id, snapshot_id, noop }) => {
  const ev = get('SELECT * FROM event WHERE id=?', event_id);
  const asset = get('SELECT * FROM asset WHERE id=?', asset_id);
  const source = get('SELECT * FROM source WHERE id=?', ev.source_id);
  if (!source) return;
  const gap = settings().session_gap_min * 60000;
  const actor = mapActor(ev.actor, ev.payload.actor_email);
  const snap = snapshot_id ? get('SELECT * FROM snapshot WHERE id=?', snapshot_id) : null;
  let m = get('SELECT m.* FROM moment_event me JOIN moment m ON m.id=me.moment_id WHERE me.event_id=?', ev.id); // same event, same moment
  if (!m && ev.payload.batch) m = get("SELECT * FROM moment WHERE batch=? AND status='open'", ev.payload.batch);
  if (!m && !ev.payload.batch) {
    const candidates = all("SELECT * FROM moment WHERE status='open' AND closing IS NULL AND batch IS NULL AND source_id=? AND actor_id=? AND updated_at > ? ORDER BY updated_at DESC", source.id, actor.id, now() - gap);
    for (const c of candidates) {
      const list = momentAssets(c.id);
      const related = list.some((a) => a.id === asset.id || (asset.parent && a.parent === asset.parent))
        || (snap?.img_vec && list.some((a) => cosine(a.vec, snap.img_vec) > 0.92)); // similar-looking work counts as related
      if (related) { m = c; break; }
    }
  }
  if (!m) {
    if (noop && !ev.payload.batch) return; // a no-op save outside any session is just noise
    m = { id: uid('mo'), source_id: source.id, actor_id: actor.id, actor_name: actor.name, tool: ev.tool, start_ts: ev.ts, end_ts: ev.ts, status: 'open', stage: 'capturing', event_count: 0, batch: ev.payload.batch || null, agent: ev.payload.agent || null, exploration_id: ev.payload.exploration_id || null, tags: [], basis: {}, created_at: now(), updated_at: now() };
    insert('moment', m);
    // Switching projects closes this person's other open sessions.
    if (asset.project_id) {
      for (const o of all("SELECT DISTINCT m.id FROM moment m JOIN moment_asset ma ON ma.moment_id=m.id JOIN asset a ON a.id=ma.asset_id WHERE m.status='open' AND m.actor_id=? AND m.id != ? AND a.project_id IS NOT NULL AND a.project_id != ?", actor.id, m.id, asset.project_id)) {
        update('moment', o.id, { closing: 'switched project' });
      }
    }
  }
  run('INSERT OR IGNORE INTO moment_event VALUES (?,?)', m.id, ev.id);
  if (snap) {
    if (get('SELECT 1 FROM moment_asset WHERE moment_id=? AND asset_id=?', m.id, asset_id)) run('UPDATE moment_asset SET last_snapshot_id=? WHERE moment_id=? AND asset_id=?', snap.id, m.id, asset_id);
    else run('INSERT INTO moment_asset VALUES (?,?,?,?)', m.id, asset_id, snap.prev_id, snap.id);
  }
  run('UPDATE moment SET event_count=(SELECT COUNT(*) FROM moment_event WHERE moment_id=?), start_ts=min(start_ts, ?), end_ts=max(end_ts, ?), updated_at=? WHERE id=?', m.id, ev.ts, ev.ts, now(), m.id);
  // Boundary signals (named version, commit, PR, export, share link) close the moment once its other jobs finish.
  if (ev.payload.boundary) update('moment', m.id, { closing: String(ev.payload.boundary) });
  broadcast('moment', { id: m.id, stage: 'capturing' });
};

// Closes moments when a boundary arrived, an upload batch is complete, or the session went idle.
const finishedBatches = new Set(); // the uploader says when its last file is in (duplicates never become events)
export const batchDone = (b) => { finishedBatches.add(b); setTimeout(() => finishedBatches.delete(b), 600000); };
export async function sweep() {
  const gap = settings().session_gap_min * 60000;
  for (const m of all("SELECT * FROM moment WHERE status='open'")) {
    let reason = m.closing;
    if (!reason && m.batch) {
      const evs = all("SELECT payload FROM event WHERE json_extract(payload,'$.batch')=?", m.batch);
      if (finishedBatches.has(m.batch) || evs.length >= Math.max(1, ...evs.map((e) => e.payload.batch_size || 1)) || now() - m.updated_at > 60000) reason = 'upload';
    }
    if (!reason && m.updated_at < now() - gap) reason = 'idle';
    if (!reason) continue;
    const pending = get(`SELECT COUNT(*) n FROM job WHERE status IN ('queued','running') AND json_extract(payload,'$.event_id') IN
      (SELECT event_id FROM moment_event WHERE moment_id=? UNION SELECT id FROM event WHERE ? IS NOT NULL AND json_extract(payload,'$.batch')=?)`, m.id, m.batch, m.batch).n;
    if (!pending) await closeMoment(m.id, reason);
  }
}

// Net diff per asset (state before the moment → its last state); intermediate saves stay hidden.
async function computeMoment(id) {
  const mas = all('SELECT * FROM moment_asset WHERE moment_id=?', id);
  run('DELETE FROM change WHERE moment_id=?', id);
  const scored = [];
  for (const ma of mas) {
    const asset = get('SELECT * FROM asset WHERE id=?', ma.asset_id);
    const last = get('SELECT * FROM snapshot WHERE id=?', ma.last_snapshot_id);
    const first = ma.first_snapshot_id ? get('SELECT * FROM snapshot WHERE id=?', ma.first_snapshot_id) : null;
    if (!last) continue;
    const d = last.prev_id === ma.first_snapshot_id && last.diff ? last.diff : await diffSnapshots(first, last, asset.type);
    if (!d) continue;
    for (const c of d.changes) insert('change', { id: uid('ch'), moment_id: id, asset_id: asset.id, kind: c.kind, path: c.path, before: c.before, after: c.after, region: c.region || null, weight: c.weight });
    if (d.visual) {
      insert('change', { id: uid('ch'), moment_id: id, asset_id: asset.id, kind: 'visual', path: `${asset.name} › pixels`, before: '', after: `${d.visual.pct}%`, weight: 0 });
      for (const r of d.visual.regions) insert('change', { id: uid('ch'), moment_id: id, asset_id: asset.id, kind: 'region', path: `${asset.name} › region`, before: '', after: 'changed', region: r, weight: 0 });
    }
    scored.push({ asset, d });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.d.score - a.d.score);
  const top = scored[0];
  const magnitude = Math.min(100, top.d.score + Math.min(15, (scored.length - 1) * 3));
  return { magnitude, bucket: bucket(magnitude), basis: { ...top.d.basis, regions: top.d.visual?.regions || [], shift: top.d.visual?.shift || null, assets: scored.length } };
}

export async function closeMoment(id, reason = 'boundary') {
  const m = get('SELECT * FROM moment WHERE id=?', id);
  if (!m || m.status !== 'open') return;
  const r = await computeMoment(id);
  if (!r) { // nothing but no-op saves: drop it
    run('DELETE FROM moment_event WHERE moment_id=?', id); run('DELETE FROM moment_asset WHERE moment_id=?', id); run('DELETE FROM moment WHERE id=?', id);
    return broadcast('moment', { id, deleted: true });
  }
  update('moment', id, { status: 'draft', stage: 'routing', ...r, basis: { ...r.basis, closed_by: reason }, closing: null, updated_at: now() });
  enqueue('route', { moment_id: id });
}

// ---------- stage 6: route ----------
const ruleHit = (pattern, a) => {
  const [kind, val] = pattern.split(':');
  return kind === 'path' ? `${a.path}`.toLowerCase().startsWith(val) : `${a.name}`.toLowerCase().startsWith(val);
};
const momentText = (m, assets, changes = []) => [m.title, m.summary, ...(m.tags || []), ...assets.map((a) => `${a.name} ${a.path} ${a.parent}`), ...changes.slice(0, 20).map((c) => c.path)].filter(Boolean).join(' ');

handlers.route = async ({ moment_id }) => {
  const m = get('SELECT * FROM moment WHERE id=?', moment_id);
  if (!m) return;
  const s = settings();
  const assets = momentAssets(m.id);
  const events = all('SELECT e.* FROM moment_event me JOIN event e ON e.id=me.event_id WHERE me.moment_id=?', m.id);
  const source = get('SELECT * FROM source WHERE id=?', m.source_id) || {};
  const projects = all("SELECT * FROM project WHERE status='active'");
  let pick = null;
  // 1. explicit mapping
  const explicit = events.map((e) => e.payload.project_id).find((p) => p && projects.some((x) => x.id === p))
    || (m.exploration_id && get('SELECT project_id FROM exploration WHERE id=?', m.exploration_id)?.project_id);
  if (explicit) pick = { project_id: explicit, confidence: 1, reason: 'Added inside this project' };
  if (!pick && source.project_id) pick = { project_id: source.project_id, confidence: 1, reason: `${source.name} is mapped to this project` };
  if (!pick) for (const r of source.mapping_rules?.paths || []) {
    if (assets.some((a) => a.path.toLowerCase().startsWith(r.prefix.toLowerCase()))) { pick = { project_id: r.project_id, confidence: 1, reason: `Folder ${r.prefix} is mapped` }; break; }
  }
  // 2. learned rules
  if (!pick) for (const r of all('SELECT * FROM route_rule ORDER BY hits DESC')) {
    if (projects.some((p) => p.id === r.project_id) && assets.some((a) => ruleHit(r.pattern, a))) { pick = { project_id: r.project_id, confidence: 0.95, reason: `Learned from your corrections (${r.pattern.replace(':', ' starts with ')})` }; break; }
  }
  // 3. link graph
  if (!pick) {
    const known = assets.filter((a) => a.project_id);
    if (known.length) pick = { project_id: known[0].project_id, confidence: 0.9, reason: 'These files are already in this project' };
    else {
      const ids = assets.map((a) => a.id);
      const linked = ids.length && get(`SELECT a2.project_id FROM edge e JOIN asset a2 ON a2.id = CASE WHEN e.from_id IN (${ids.map(() => '?').join(',')}) THEN e.to_id ELSE e.from_id END
        WHERE (e.from_id IN (${ids.map(() => '?').join(',')}) OR e.to_id IN (${ids.map(() => '?').join(',')})) AND a2.project_id IS NOT NULL LIMIT 1`, ...ids, ...ids, ...ids);
      if (linked) pick = { project_id: linked.project_id, confidence: 0.9, reason: 'Linked to work already in this project' };
    }
  }
  // 4. similarity, 5. LLM tie-breaker
  if (!pick && projects.length) {
    const vec = textVec(momentText(m, assets));
    const imgs = assets.map((a) => a.vec).filter(Boolean);
    const ranked = projects.map((p) => {
      let score = cosine(vec, p.centroid || textVec(`${p.name} ${p.brief}`));
      if (imgs.length) { // look-alike snapshots already in the project
        const theirs = all("SELECT s.img_vec FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id WHERE a.project_id=? AND s.img_vec IS NOT NULL ORDER BY s.created_at DESC LIMIT 40", p.id);
        const best = Math.max(0, ...theirs.flatMap((t) => imgs.map((v) => cosine(v, t.img_vec))));
        score = Math.max(score, best > 0.9 ? (best - 0.9) * 6 : 0);
      }
      return { p, score };
    }).sort((a, b) => b.score - a.score);
    const [a, b] = ranked;
    if (!pick && a.score > 0.05) {
      const conf = Math.min(0.92, a.score + (a.score - (b?.score || 0)) * 0.8);
      pick = { project_id: a.p.id, confidence: +conf.toFixed(2), reason: `Looks like ${a.p.name} (${Math.round(a.score * 100)}% similar)` };
    }
  }
  const conf = pick?.confidence || 0;
  const filed = conf >= s.file_threshold;
  update('moment', m.id, { project_id: filed ? pick.project_id : null, route_guess: pick?.project_id || null, route_confidence: conf, route_reason: pick?.reason || 'No project matched yet', stage: 'describing', updated_at: now() });
  if (filed) for (const a of assets) if (!a.project_id) update('asset', a.id, { project_id: pick.project_id });
  enqueue('describe', { moment_id: m.id });
};

// ---------- stage 7: describe ----------
export function momentLinks(m) {
  const events = all('SELECT e.payload FROM moment_event me JOIN event e ON e.id=me.event_id WHERE me.moment_id=?', m.id);
  const links = [];
  for (const { payload: p } of events) {
    if (p.message) links.push(`commit:${p.message}`);
    if (p.label) links.push(`version:${p.label}`);
    if (p.description) links.push(`note:${p.description}`);
    if (p.pr_title) links.push(`pr:${p.pr_title} ${p.pr_body || ''}`.slice(0, 600));
    if (p.note) links.push(`note:${p.note}`);
  }
  for (const c of all("SELECT c.body FROM comment c JOIN moment_asset ma ON c.target_type='asset' AND c.target_id=ma.asset_id WHERE ma.moment_id=? ORDER BY c.created_at DESC LIMIT 5", m.id)) links.push(`comment:${c.body}`);
  return [...new Set(links)];
}

handlers.describe = async ({ moment_id }) => {
  const m = get('SELECT * FROM moment WHERE id=?', moment_id);
  if (!m) return;
  const assets = momentAssets(m.id);
  const changes = all("SELECT * FROM change WHERE moment_id=? AND kind != 'region' ORDER BY weight DESC", m.id);
  const project = get('SELECT name FROM project WHERE id=?', m.project_id || m.route_guess);
  const input = { project: project?.name, source: get('SELECT name FROM source WHERE id=?', m.source_id)?.name, tool: m.tool, actor: m.actor_name, assets, event_count: m.event_count, magnitude: m.magnitude, semantic: m.basis.type, visual: m.basis.pixels != null ? { pixels_changed_pct: m.basis.pixels } : null, changes, links: momentLinks(m) };
  let out = words.describe(input);
  if (m.agent) { // agents write their own entry
    const p = get('SELECT e.payload FROM moment_event me JOIN event e ON e.id=me.event_id WHERE me.moment_id=? LIMIT 1', m.id)?.payload || {};
    out = { ...out, title: (p.title || out.title).split(/\s+/).slice(0, 12).join(' '), summary: p.summary || out.summary, sentence: p.summary ? [{ t: p.summary }] : out.sentence, tags: ['agent', ...(out.tags || [])].slice(0, 5) };
  }
  update('moment', m.id, { title: out.title, summary: out.summary, sentence: out.sentence, why: out.why || '', tags: out.tags || [], stage: 'indexing', updated_at: now() });
  enqueue('index', { moment_id: m.id });
};

// ---------- stage 8: index ----------
export function ftsPut(kind, ref_id, project_id, title, body) {
  run('DELETE FROM search_fts WHERE kind=? AND ref_id=?', kind, ref_id);
  run('INSERT INTO search_fts (kind, ref_id, project_id, title, body) VALUES (?,?,?,?,?)', kind, ref_id, project_id || '', title || '', (body || '').slice(0, 60000));
}
export function updateCentroid(pid) {
  const p = get('SELECT * FROM project WHERE id=?', pid);
  if (!p) return;
  const base = textVec(`${p.name} ${p.name} ${p.brief || ''}`);
  const vecs = all("SELECT embedding FROM moment WHERE project_id=? AND status='accepted' AND embedding IS NOT NULL ORDER BY end_ts DESC LIMIT 50", pid).map((r) => r.embedding);
  const refs = all('SELECT embedding FROM reference WHERE project_id=? AND embedding IS NOT NULL LIMIT 30', pid).map((r) => r.embedding);
  update('project', pid, { centroid: mean([base, base, base, ...vecs, ...refs]) });
}

handlers.index = async ({ moment_id }) => {
  const m = get('SELECT * FROM moment WHERE id=?', moment_id);
  if (!m) return;
  const assets = momentAssets(m.id);
  const changes = all("SELECT * FROM change WHERE moment_id=? AND kind NOT IN ('region','visual')", m.id);
  const pid = m.project_id || m.route_guess;
  update('moment', m.id, { embedding: textVec(momentText(m, assets, changes)), stage: 'ready' });
  ftsPut('moment', m.id, pid, m.title, [m.summary, m.why, (m.tags || []).join(' '), ...assets.map((a) => a.name), ...changes.map((c) => `${c.path} ${c.before} ${c.after}`)].join(' '));
  for (const a of assets) {
    const s = get('SELECT text FROM snapshot WHERE id=?', a.latest_snapshot_id);
    ftsPut('asset', a.id, a.project_id || pid, a.name, `${a.path} ${s?.text || ''}`);
    edge('moment', m.id, 'changed', 'asset', a.id);
  }
  edge('user', m.actor_id, 'authored', 'moment', m.id);
  if (m.project_id) edge('moment', m.id, 'in', 'project', m.project_id);
  // Decisions in commit messages and version notes are suggested; a person confirms them.
  const links = momentLinks(m).filter((l) => !l.startsWith('comment:'));
  for (const d of words.decisions(links.map((text) => ({ id: m.id, text: text.replace(/^\w+:/, '') })))) {
    if (pid && !get('SELECT 1 FROM decision WHERE project_id=? AND text=?', pid, d.text)) insert('decision', { id: uid('de'), project_id: pid, text: d.text, source_type: 'moment', source_id: m.id, status: 'suggested', created_at: now() });
  }
  const source = get('SELECT * FROM source WHERE id=?', m.source_id);
  const preAccepted = get("SELECT 1 FROM moment_event me JOIN event e ON e.id=me.event_id WHERE me.moment_id=? AND json_extract(e.payload,'$.accept')=1", m.id); // a person already accepted it (an AI artifact)
  if (m.project_id && (preAccepted || (source?.auto_accept && m.route_confidence >= settings().file_threshold))) await acceptMoment(m.id, null, 'auto');
  else broadcast('moment', { id: m.id, stage: 'ready', project_id: m.project_id, status: m.status });
  if (m.agent) notify('agent', `${m.agent} logged “${m.title}” for review`, `#/inbox`);
};

// ---------- inbox operations (the human half of the loop) ----------
function learnRule(m, project_id) {
  for (const a of momentAssets(m.id)) {
    const word = a.name.toLowerCase().match(/^[a-z0-9]+/)?.[0];
    const folder = a.path.includes('/') ? a.path.toLowerCase().slice(0, a.path.lastIndexOf('/') + 1) : null;
    const pattern = folder ? `path:${folder}` : word && word.length >= 3 ? `name:${word}` : null;
    if (!pattern) continue;
    run('INSERT INTO route_rule (id, pattern, project_id, hits, created_at) VALUES (?,?,?,1,?) ON CONFLICT(pattern, project_id) DO UPDATE SET hits = hits + 1', uid('rr'), pattern, project_id, now());
    run('DELETE FROM route_rule WHERE pattern=? AND project_id != ?', pattern, project_id); // the newest correction wins
  }
}

export async function acceptMoment(id, user, by = 'user') {
  const m = get('SELECT * FROM moment WHERE id=?', id);
  if (!m || m.status === 'accepted') return m;
  const project_id = m.project_id || m.route_guess;
  if (!project_id) throw Object.assign(new Error('Pick a project for this moment first.'), { status: 400 });
  if (!m.project_id && m.route_guess) { // confirming a guess counts as a lesson too
    run('INSERT INTO correction (moment_id, kind, from_project, to_project, confidence, created_at) VALUES (?,?,?,?,?,?)', id, 'confirm', m.route_guess, project_id, m.route_confidence, now());
    learnRule(m, project_id);
  }
  update('moment', id, { status: 'accepted', project_id, updated_at: now() });
  for (const a of momentAssets(id)) update('asset', a.id, { project_id });
  edge('moment', id, 'in', 'project', project_id);
  ftsPut('moment', id, project_id, m.title, get('SELECT body FROM search_fts WHERE kind=? AND ref_id=?', 'moment', id)?.body || m.summary);
  updateCentroid(project_id);
  if (by === 'user' && m.source_id) {
    const src = get('SELECT * FROM source WHERE id=?', m.source_id);
    const streak = m.edited ? 0 : (src.accept_streak || 0) + 1;
    update('source', src.id, { accept_streak: streak });
    if (streak === settings().auto_accept_suggest_after && !src.auto_accept) notify('suggest', `You accepted ${streak} moments from ${src.name} in a row without edits. Turn on auto-accept for it?`, `#/settings/sources`);
  }
  audit(user?.name || by, by === 'auto' ? 'system' : 'user', 'moment.accept', id);
  broadcast('moment', { id, status: 'accepted', project_id });
  return get('SELECT * FROM moment WHERE id=?', id);
}

export function unfileMoment(id, user) {
  const m = get('SELECT * FROM moment WHERE id=?', id);
  if (!m) return;
  run('INSERT INTO correction (moment_id, kind, from_project, to_project, confidence, created_at) VALUES (?,?,?,?,?,?)', id, 'undo', m.project_id, null, m.route_confidence, now());
  if (m.route_confidence >= settings().file_threshold) setSettings({ file_threshold: Math.min(0.97, +(settings().file_threshold + 0.01).toFixed(2)) });
  update('moment', id, { status: 'draft', project_id: null, route_reason: 'You undid the filing', edited: 1, updated_at: now() });
  audit(user?.name || 'user', 'user', 'moment.unfile', id);
  broadcast('moment', { id, status: 'draft' });
}

export function discardMoment(id, user) {
  update('moment', id, { status: 'discarded', updated_at: now() });
  run("DELETE FROM search_fts WHERE kind='moment' AND ref_id=?", id);
  audit(user?.name || 'user', 'user', 'moment.discard', id);
  broadcast('moment', { id, status: 'discarded' });
}

export function moveMoment(id, project_id, user) {
  const m = get('SELECT * FROM moment WHERE id=?', id);
  const from = m.project_id || m.route_guess;
  if (from !== project_id) {
    run('INSERT INTO correction (moment_id, kind, from_project, to_project, confidence, created_at) VALUES (?,?,?,?,?,?)', id, 'move', from, project_id, m.route_confidence, now());
    learnRule(m, project_id);
    // A filed moment that had to be moved means the filing bar was too low for this workspace.
    if (m.project_id && m.route_confidence >= settings().file_threshold) setSettings({ file_threshold: Math.min(0.97, +(settings().file_threshold + 0.01).toFixed(2)) });
  }
  update('moment', id, { project_id, route_guess: project_id, route_reason: 'Moved by you', route_confidence: 1, edited: 1, updated_at: now() });
  for (const a of momentAssets(id)) update('asset', a.id, { project_id });
  run("UPDATE search_fts SET project_id=? WHERE kind='moment' AND ref_id=?", project_id, id);
  audit(user?.name || 'user', 'user', 'moment.move', id, { from, to: project_id });
  broadcast('moment', { id, project_id });
}

export async function splitMoment(id, asset_ids) {
  const m = get('SELECT * FROM moment WHERE id=?', id);
  const all_ = all('SELECT asset_id FROM moment_asset WHERE moment_id=?', id).map((r) => r.asset_id);
  const moving = asset_ids.filter((a) => all_.includes(a));
  if (!moving.length || moving.length === all_.length) throw Object.assign(new Error('Pick some, but not all, of the files to split off.'), { status: 400 });
  const n = { ...m, id: uid('mo'), title: null, summary: null, status: 'draft', stage: 'routing', created_at: now(), updated_at: now() };
  delete n.embedding;
  insert('moment', n);
  const q = moving.map(() => '?').join(',');
  run(`UPDATE moment_asset SET moment_id=? WHERE moment_id=? AND asset_id IN (${q})`, n.id, id, ...moving);
  run(`UPDATE moment_event SET moment_id=? WHERE moment_id=? AND event_id IN (SELECT event_id FROM snapshot WHERE asset_id IN (${q}))`, n.id, id, ...moving);
  for (const mid of [id, n.id]) {
    const r = await computeMoment(mid);
    run('UPDATE moment SET event_count=(SELECT COUNT(*) FROM moment_event WHERE moment_id=?) WHERE id=?', mid, mid);
    update('moment', mid, { ...r, status: 'draft', stage: 'routing', edited: 1 });
    enqueue('route', { moment_id: mid });
  }
  return n.id;
}

export async function mergeWithPrevious(id) {
  const m = get('SELECT * FROM moment WHERE id=?', id);
  const prev = get("SELECT * FROM moment WHERE id != ? AND status IN ('draft','accepted') AND actor_id=? AND source_id=? AND end_ts <= ? ORDER BY end_ts DESC LIMIT 1", id, m.actor_id, m.source_id, m.end_ts);
  if (!prev) throw Object.assign(new Error('There’s no earlier moment from the same person and tool to merge with.'), { status: 400 });
  for (const ma of all('SELECT * FROM moment_asset WHERE moment_id=?', id)) {
    const existing = get('SELECT * FROM moment_asset WHERE moment_id=? AND asset_id=?', prev.id, ma.asset_id);
    if (existing) run('UPDATE moment_asset SET last_snapshot_id=? WHERE moment_id=? AND asset_id=?', ma.last_snapshot_id, prev.id, ma.asset_id);
    else run('INSERT INTO moment_asset VALUES (?,?,?,?)', prev.id, ma.asset_id, ma.first_snapshot_id, ma.last_snapshot_id);
  }
  run('UPDATE OR IGNORE moment_event SET moment_id=? WHERE moment_id=?', prev.id, id);
  run('UPDATE comment SET target_id=? WHERE target_type=? AND target_id=?', prev.id, 'moment', id);
  for (const t of ['moment_asset', 'moment_event']) run(`DELETE FROM ${t} WHERE moment_id=?`, id);
  run('DELETE FROM moment WHERE id=?', id); run("DELETE FROM search_fts WHERE kind='moment' AND ref_id=?", id);
  const r = await computeMoment(prev.id);
  run('UPDATE moment SET event_count=(SELECT COUNT(*) FROM moment_event WHERE moment_id=?) WHERE id=?', prev.id, prev.id);
  update('moment', prev.id, { ...r, end_ts: Math.max(prev.end_ts, m.end_ts), status: 'draft', stage: 'describing', edited: 1 });
  enqueue('describe', { moment_id: prev.id });
  broadcast('moment', { id, deleted: true });
  return prev.id;
}

export function muteKind(id) {
  const m = get('SELECT * FROM moment WHERE id=?', id);
  const types = [...new Set(all('SELECT e.type FROM moment_event me JOIN event e ON e.id=me.event_id WHERE me.moment_id=?', id).map((r) => r.type))];
  setSettings({ mute: [...(settings().mute || []), ...types.map((type) => ({ source_id: m.source_id, type }))] });
  discardMoment(id);
  return types;
}

// ---------- boot ----------
export function startEngine() {
  run("UPDATE job SET status='queued' WHERE status='running'"); // work interrupted by a restart runs again
  // Component files captured before drawing existed get drawn once, newest version first.
  if (!get("SELECT 1 FROM job WHERE stage='render' AND status='queued' LIMIT 1")) for (const s of all("SELECT s.id FROM asset a JOIN snapshot s ON s.id=a.latest_snapshot_id JOIN source so ON so.id=a.source_id WHERE so.tool='folder' AND (lower(a.name) LIKE '%.tsx' OR lower(a.name) LIKE '%.jsx') AND json_extract(s.properties,'$.component') IS NULL LIMIT 300")) enqueue('render', { snapshot_id: s.id }, 3000);
  for (const s of STAGES) setImmediate(() => work(s));
  setInterval(() => STAGES.forEach((s) => work(s)), 1500);
  setInterval(() => sweep().catch((e) => console.error('sweep', e)), 1500);
  setInterval(() => run("DELETE FROM job WHERE status='done' AND updated_at < ?", now() - 86400000), 3600000);
}
