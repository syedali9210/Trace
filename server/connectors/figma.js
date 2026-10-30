// Figma: a personal access token + the REST API, polled (webhooks need a public URL, which a local Trace
// doesn't have). Each file's versions become events; each changed top-level frame is an asset whose node tree
// is normalised to DOM-T, so diffs say "Body 16 to 14pt", not just "pixels moved". Comments mirror in.
// API shapes re-checked against developers.figma.com before relying on them; variables need an Enterprise plan.
import { get, update, insert, uid, now, mapActor } from '../db.js';
import { sha256 } from '../media.js';
import { getSecret, setSecret } from '../secrets.js';
import { ingest } from '../engine.js';

const API = 'https://api.figma.com/v1';
export const fileKeyOf = (s) => String(s).match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/)?.[1] || (/^[A-Za-z0-9]{10,40}$/.test(String(s).trim()) ? String(s).trim() : null);

async function fx(token, path) {
  const r = await fetch(API + path, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(60000) });
  if (r.status === 429) throw Object.assign(new Error('Figma is rate-limiting this token'), { status: 429, retryAfter: +r.headers.get('retry-after') || 60 });
  if (r.status === 403) throw Object.assign(new Error('Figma refused the token for this (403). Check its scopes or that the file is shared with you.'), { status: 403 });
  if (!r.ok) throw Object.assign(new Error(`Figma said ${r.status} for ${path.split('?')[0]}`), { status: r.status });
  return r.json();
}
const tok = (source) => getSecret(source.auth_ref);

const hex = (c, o = 1) => {
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  const a = (c.a ?? 1) * o;
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${a < 1 ? h(a) : ''}`;
};

// DOM-T node: geometry relative to its frame, solid fills, type, copy, component, effects, auto-layout.
function normNode(n, root, components) {
  const b = n.absoluteBoundingBox;
  const o = { name: n.name, type: n.type };
  if (b && root) { o.x = Math.round(b.x - root.x); o.y = Math.round(b.y - root.y); o.w = Math.round(b.width); o.h = Math.round(b.height); }
  const solid = (list) => (list || []).filter((f) => f.visible !== false && f.type === 'SOLID').map((f) => hex(f.color, f.opacity ?? 1));
  if (solid(n.fills).length) o.fills = solid(n.fills);
  if (solid(n.strokes).length) o.strokes = solid(n.strokes);
  if (n.type === 'TEXT') {
    const s = n.style || {};
    o.text = n.characters;
    o.font = { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeightPx ? Math.round(s.lineHeightPx * 10) / 10 : undefined, letterSpacing: s.letterSpacing || 0 };
  }
  if (n.componentId) o.component = components?.[n.componentId]?.name || n.componentId;
  const fx_ = (n.effects || []).filter((e) => e.visible !== false).map((e) => `${e.type.toLowerCase().replace('_', ' ')}${e.radius ? ` ${e.radius}` : ''}`);
  if (fx_.length) o.effects = fx_;
  if (n.cornerRadius) o.radius = n.cornerRadius;
  if (n.opacity != null && n.opacity !== 1) o.opacity = +n.opacity.toFixed(2);
  if (n.layoutMode && n.layoutMode !== 'NONE') o.layout = { mode: n.layoutMode.toLowerCase(), gap: n.itemSpacing, padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => v || 0) };
  return o;
}

function frameProps(frame, components, cap = 1500) {
  const root = frame.absoluteBoundingBox;
  const nodes = {};
  const walk = (n) => {
    if (Object.keys(nodes).length >= cap || n.visible === false) return;
    nodes[n.id] = normNode(n, root, components);
    for (const c of n.children || []) walk(c);
  };
  for (const c of frame.children || []) walk(c);
  return { root: { w: root?.width || 0, h: root?.height || 0 }, nodes };
}

async function variables(token, key) {
  try {
    const v = await fx(token, `/files/${key}/variables/local`);
    const out = {};
    for (const x of Object.values(v.meta?.variables || {})) {
      const val = Object.values(x.valuesByMode || {})[0];
      out[x.name] = val && typeof val === 'object' && 'r' in val ? hex(val) : val && typeof val === 'object' ? `alias:${val.id}` : val;
    }
    return out;
  } catch { return null; } // Enterprise-only; fine without
}

const changedOnly = (asset, hash) => !asset || get('SELECT properties FROM snapshot WHERE id=?', asset.latest_snapshot_id)?.properties?.hash !== hash;

export const figma = {
  tool: 'figma', label: 'Figma', interval: 60000,
  async authorize({ token, files, teams }) {
    if (!token) throw Object.assign(new Error('Paste a Figma personal access token (Figma → Settings → Security → Personal access tokens).'), { status: 400 });
    const me = await fx(token, '/me');
    const fileKeys = String(files || '').split(/[\s,]+/).map(fileKeyOf).filter(Boolean);
    const teamIds = String(teams || '').split(/[\s,]+/).map((t) => t.match(/team\/(\d+)/)?.[1] || (/^\d+$/.test(t) ? t : null)).filter(Boolean);
    return { name: `Figma · ${me.handle}`, auth_ref: setSecret(uid('sec'), token), scope: { files: fileKeys, teams: teamIds } };
  },
  async listScopes(source) {
    const t = tok(source), out = [];
    for (const team of source.scope.teams || []) {
      const { projects = [] } = await fx(t, `/teams/${team}/projects`);
      for (const p of projects) for (const f of (await fx(t, `/projects/${p.id}/files`)).files || []) out.push({ id: f.key, name: f.name, kind: 'file', group: p.name, thumbnail: f.thumbnail_url });
    }
    for (const k of source.scope.files || []) if (!out.some((o) => o.id === k)) out.push({ id: k, name: k, kind: 'file' });
    return out;
  },
  async poll(source) {
    const t = tok(source);
    const cursor = { files: {}, ...source.cursor };
    let keys = [...(source.scope.files || [])];
    if ((source.scope.teams || []).length) {
      if (!cursor.team_files || now() - (cursor.team_files_at || 0) > 3600000) { cursor.team_files = (await this.listScopes(source)).map((f) => f.id); cursor.team_files_at = now(); }
      keys = [...new Set([...keys, ...cursor.team_files])];
    }
    for (const key of keys) {
      const c = cursor.files[key] || {};
      const { versions = [] } = await fx(t, `/files/${key}/versions`);
      if (!versions.length) continue;
      const fresh = [];
      for (const v of versions) { if (v.id === c.last) break; fresh.push(v); }
      const take = c.last ? fresh.reverse() : [versions[0]]; // first sync: the current version is the baseline
      const meta = c.name ? null : await fx(t, `/files/${key}?depth=1`);
      c.name = c.name || meta?.name || key;
      for (const v of take) {
        ingest(source, {
          external_id: key, version: v.id, type: v.label ? 'version.named' : 'version.created', actor: v.user?.handle, ts: Date.parse(v.created_at),
          payload: { file_key: key, file_name: c.name, version_id: v.id, label: v.label || undefined, description: v.description || undefined, actor_img: v.user?.img_url, boundary: v.label ? 'named version' : undefined },
        });
      }
      c.last = versions[0].id;
      await mirrorComments(source, t, key, c);
      cursor.files[key] = c;
    }
    update('source', source.id, { cursor });
  },
  // Normalize: fetch the file at that version, keep the top-level frames whose subtree changed, render them.
  async fetchObject(ev, source) {
    const t = tok(source), p = ev.payload;
    const doc = await fx(t, `/files/${p.file_key}?version=${p.version_id}`);
    const descs = [];
    for (const page of doc.document?.children || []) {
      for (const frame of page.children || []) {
        if (!['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION', 'INSTANCE'].includes(frame.type) || descs.length >= 40) continue;
        const props = frameProps(frame, doc.components);
        props.hash = sha256(JSON.stringify(props.nodes));
        const external_id = `${p.file_key}:${frame.id}`;
        const asset = get('SELECT * FROM asset WHERE source_id=? AND external_id=?', source.id, external_id);
        if (!changedOnly(asset, props.hash)) continue;
        descs.push({ external_id, type: 'frame', name: frame.name, path: `${doc.name}/${page.name}/${frame.name}`, parent: p.file_key, url: `https://www.figma.com/design/${p.file_key}?node-id=${frame.id.replace(':', '-')}`, properties: props, node_id: frame.id, scale: Math.min(2, 1600 / Math.max(1, props.root.w)) });
      }
    }
    if (descs.length) {
      const vars = await variables(t, p.file_key);
      if (vars) descs[0].properties.variables = vars;
      // One render call for every changed frame of this version.
      const scale = Math.max(0.1, Math.min(...descs.map((d) => d.scale))).toFixed(2);
      const r = await fx(t, `/images/${p.file_key}?ids=${encodeURIComponent(descs.map((d) => d.node_id).join(','))}&format=png&scale=${scale}&version=${p.version_id}`);
      for (const d of descs) d.image_url = r.images?.[d.node_id] || null;
    }
    return descs;
  },
  async renderPreview(ev, asset, desc) {
    const texts = Object.values(desc.properties.nodes).filter((n) => n.text).map((n) => n.text).join('\n');
    if (!desc.image_url) return { card: { title: desc.name, label: 'FIGMA', lines: ['Figma didn’t render this frame', texts.slice(0, 400)] }, properties: desc.properties, text: texts };
    const r = await fetch(desc.image_url, { signal: AbortSignal.timeout(60000) });
    return { image: Buffer.from(await r.arrayBuffer()), properties: desc.properties, text: texts };
  },
  mapActor: (handle) => mapActor(handle),
  async health(source) {
    try { const me = await fx(tok(source), '/me'); return { ok: true, detail: `Signed in as ${me.handle}` }; } catch (e) { return { ok: false, detail: e.message }; }
  },
};

// Figma comments come into Trace, linked to the frame they're pinned on and back to Figma.
async function mirrorComments(source, t, key, c) {
  const { comments = [] } = await fx(t, `/files/${key}/comments`);
  for (const cm of comments) {
    if (get('SELECT 1 FROM comment WHERE external_ref=?', `figma:${cm.id}`)) continue;
    const node = cm.client_meta?.node_id;
    const asset = (node && get('SELECT * FROM asset WHERE source_id=? AND external_id=?', source.id, `${key}:${node}`)) || get('SELECT * FROM asset WHERE source_id=? AND parent=? AND project_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1', source.id, key);
    if (!asset?.project_id) continue; // retried next poll, once the file is filed in a project
    const parent = cm.parent_id ? get('SELECT id FROM comment WHERE external_ref=?', `figma:${cm.parent_id}`)?.id : null;
    const author = mapActor(cm.user?.handle);
    insert('comment', { id: uid('cm'), project_id: asset.project_id, target_type: 'asset', target_id: asset.id, author_id: author.id, author_name: author.name, body: cm.message, parent_id: parent, status: cm.resolved_at ? 'resolved' : 'open', external_ref: `figma:${cm.id}`, external_url: `https://www.figma.com/design/${key}?node-id=${(node || '').replace(':', '-')}#${cm.id}`, created_at: Date.parse(cm.created_at), updated_at: now() });
  }
}
