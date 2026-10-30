// Embed links: Figma, Framer, Spline, Rive, Illustrator (Creative Cloud), Webflow, YouTube, Loom, Vimeo,
// Dribbble, Behance, GitHub, Google Docs, any page. A live embed where the site allows one, a stored snapshot
// always (oEmbed thumbnail → og:image → headless-browser screenshot), and a re-snapshot every few hours so the
// link becomes a source. If the link dies, the last snapshot stays.
import { all } from '../db.js';
import { storeFile, readKey, sha256, screenshot } from '../media.js';
import { ingest } from '../engine.js';

const PROVIDERS = [
  { id: 'figma', name: 'Figma', re: /figma\.com\/(file|design|proto|board|slides)\/([A-Za-z0-9]+)/, embed: (u) => `https://www.figma.com/embed?embed_host=trace&url=${encodeURIComponent(u)}`, oembed: (u) => `https://www.figma.com/api/oembed?url=${encodeURIComponent(u)}` },
  { id: 'youtube', name: 'YouTube', re: /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/, embed: (u, m) => `https://www.youtube.com/embed/${m[1]}`, thumb: (m) => `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`, oembed: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}` },
  { id: 'loom', name: 'Loom', re: /loom\.com\/(?:share|embed)\/(\w+)/, embed: (u, m) => `https://www.loom.com/embed/${m[1]}`, oembed: (u) => `https://www.loom.com/v1/oembed?url=${encodeURIComponent(u)}` },
  { id: 'vimeo', name: 'Vimeo', re: /vimeo\.com\/(\d+)/, embed: (u, m) => `https://player.vimeo.com/video/${m[1]}`, oembed: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}` },
  { id: 'framer', name: 'Framer', re: /(framer\.(com|website|app|ai|media)|\.framer\.)/, embed: (u) => u, shot: true },
  { id: 'spline', name: 'Spline', re: /spline\.design/, embed: (u) => u, shot: true },
  { id: 'rive', name: 'Rive', re: /rive\.app/, embed: (u) => u, shot: true },
  { id: 'webflow', name: 'Webflow', re: /webflow\.(io|com)/, embed: (u) => u, shot: true },
  { id: 'illustrator', name: 'Adobe', re: /(adobe\.com|adobe\.ly|acrobat\.adobe|express\.adobe)/, embed: null },
  { id: 'gdocs', name: 'Google Docs', re: /docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([\w-]+)/, embed: (u) => u.replace(/\/(edit|view|pub)[^/]*$/, '/preview'), shot: true },
  { id: 'dribbble', name: 'Dribbble', re: /dribbble\.com/, embed: null },
  { id: 'behance', name: 'Behance', re: /behance\.net/, embed: null },
  { id: 'github', name: 'GitHub', re: /github\.com/, embed: null },
  { id: 'web', name: 'Web page', re: /./, embed: (u) => u, shot: true },
];

export function resolve(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(u)) throw Object.assign(new Error('Paste a full link starting with https://'), { status: 400 });
  for (const p of PROVIDERS) { const m = u.match(p.re); if (m) return { provider: p.id, provider_name: p.name, url: u, embed_url: p.embed ? p.embed(u, m) : null, p, m }; }
}

async function get_(url, ms = 12000) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Trace design memory; link preview)', accept: 'text/html,application/json,image/*;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return r;
}
async function image(url) {
  const r = await get_(url, 20000);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 25e6 || !/^image\//.test(r.headers.get('content-type') || 'image/')) throw new Error('not an image');
  return buf;
}

// The picture and words for a link, trying the cheapest honest source first.
export async function snapshotLink(url) {
  const r = resolve(url);
  let title = '', description = '', img = null;
  if (r.p.oembed) {
    try { const o = await (await get_(r.p.oembed(url))).json(); title = o.title || ''; if (o.thumbnail_url) img = await image(o.thumbnail_url); } catch {}
  }
  if (!img && r.p.thumb) { try { img = await image(r.p.thumb(r.m)); } catch {} }
  if (!title || (!img && !r.p.shot)) {
    try {
      const html = (await (await get_(url)).text()).slice(0, 1_500_000);
      const meta = (k) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']+)`, 'i'))?.[1] || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`, 'i'))?.[1];
      title = title || meta('og:title') || html.match(/<title[^>]*>([^<]{1,200})/i)?.[1] || '';
      description = meta('og:description') || meta('description') || '';
      const og = meta('og:image') || meta('twitter:image');
      if (!img && og && !r.p.shot) img = await image(new URL(og.replace(/&amp;/g, '&'), url).href).catch(() => null);
    } catch {}
  }
  if (!img) img = screenshot(r.embed_url && r.provider === 'gdocs' ? r.embed_url : url); // the render service
  title = title.replace(/&amp;/g, '&').replace(/&#39;/g, '’').replace(/&quot;/g, '"').trim();
  return { ...r, p: undefined, m: undefined, title: title || new URL(url).hostname + new URL(url).pathname.replace(/\/$/, ''), description, image: img };
}

export async function captureLink(source, url, extra = {}) {
  const s = await snapshotLink(url);
  if (!s.image) throw Object.assign(new Error(`Couldn’t get a picture of ${new URL(url).hostname}. The link is saved; the snapshot will be retried.`), { status: 502, saved: true });
  const image_key = storeFile(s.image, 'png');
  return ingest(source, {
    external_id: url, version: sha256(s.image), type: extra.type || 'link.snapshot', actor: extra.actor,
    payload: { url, provider: s.provider, provider_name: s.provider_name, embed_url: s.embed_url, title: s.title, description: s.description, image_key, project_id: extra.project_id, name: s.title, path: url, boundary: 'link' },
  });
}

export const link = {
  tool: 'link', label: 'Embed links', interval: 6 * 3600000,
  fetchObject(ev) {
    const p = ev.payload;
    return [{ external_id: ev.external_id, type: 'embed', name: p.title, path: p.url, parent: p.provider, url: p.url }];
  },
  renderPreview(ev) {
    const p = ev.payload;
    return { image: readKey(p.image_key), text: `${p.title}\n${p.description || ''}\n${p.url}`, properties: { page: { url: p.url, provider: p.provider, provider_name: p.provider_name, embed_url: p.embed_url, title: p.title } } };
  },
  // Re-snapshot every tracked link; a changed picture becomes a new version with a visual diff.
  async poll(source) {
    for (const a of all('SELECT * FROM asset WHERE source_id=? AND url IS NOT NULL', source.id)) {
      try { await captureLink(source, a.url, { project_id: a.project_id, type: 'link.resnapshot', actor: 'Trace' }); } catch {}
    }
  },
  health() { return { ok: true, detail: 'Links are re-snapshotted every 6 hours' }; },
};
