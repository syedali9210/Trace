// Files, previews, thumbnails, hashes, palettes, zip in/out and the headless-browser render service.
import sharp from 'sharp';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { DATA } from './db.js';

sharp.cache(false);
const FILES = path.join(DATA, 'files');

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export function storeFile(buf, ext = 'bin') {
  const h = sha256(buf);
  const key = `${h.slice(0, 2)}/${h}.${ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin'}`;
  const p = path.join(FILES, key);
  if (!existsSync(p)) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, buf); }
  return key;
}
export const filePath = (key) => {
  const p = path.join(FILES, key);
  if (!p.startsWith(FILES)) throw new Error('bad key');
  return p;
};
export const readKey = (key) => readFileSync(filePath(key));
export const extOf = (name = '') => (path.extname(name).slice(1) || '').toLowerCase();

const K = {
  image: 'png jpg jpeg webp gif avif tif tiff bmp heic heif',
  svg: 'svg',
  video: 'mp4 mov webm m4v avi mkv',
  pdf: 'pdf ai eps',
  font: 'ttf otf woff woff2',
  text: 'md markdown txt csv rtf',
  code: 'js mjs cjs ts tsx jsx css scss less html htm json yml yaml py swift kt java go rs rb php vue svelte xml sql sh',
  docx: 'docx',
  zip: 'zip',
  design: 'psd sketch xd fig riv rev splinecode aep prproj indd afdesign afphoto',
};
const KIND = {};
for (const [k, list] of Object.entries(K)) for (const e of list.split(' ')) KIND[e] = k;
export const kindOf = (name) => KIND[extOf(name)] || 'other';
export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4', pdf: 'application/pdf', ai: 'application/pdf', json: 'application/json', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', css: 'text/css', html: 'text/html', js: 'text/javascript', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', zip: 'application/zip' };
export const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

// A preview card for files with no picture of their own (code, docs, fonts, binaries), drawn as SVG.
export async function textCard({ title = '', label = '', lines = [], mono = true, big = '' }) {
  const body = big
    ? `<text x="40" y="260" font-family="Georgia, serif" font-size="150" fill="#18181b">${esc(big)}</text>`
    : lines.slice(0, 14).map((l, i) => `<text x="40" y="${118 + i * 24}" font-family="${mono ? 'Consolas, monospace' : 'Segoe UI, Arial, sans-serif'}" font-size="15" fill="#3f3f46" xml:space="preserve">${esc(String(l).slice(0, 78))}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#fafaf9"/>
    <rect x="0.5" y="0.5" width="799" height="499" fill="none" stroke="#e4e4e7"/>
    <text x="40" y="58" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" fill="#18181b">${esc(String(title).slice(0, 52))}</text>
    <text x="760" y="58" text-anchor="end" font-family="Consolas, monospace" font-size="14" fill="#71717a">${esc(label)}</text>
    <line x1="40" y1="80" x2="760" y2="80" stroke="#e4e4e7"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function fromImage(buf) {
  const img = sharp(buf, { animated: false, limitInputPixels: 2e8 }).rotate();
  const meta = await img.metadata();
  const full = await img.clone().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const thumb = await sharp(full).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const m2 = await sharp(full).metadata();
  return { image_key: storeFile(full, 'png'), thumb_key: storeFile(thumb, 'webp'), width: m2.width, height: m2.height, orig: { width: meta.width, height: meta.height, format: meta.format } };
}

let hasFfmpeg;
function videoFrame(file) {
  if (hasFfmpeg === undefined) hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  if (!hasFfmpeg) return null;
  const out = path.join(os.tmpdir(), `trace-${randomBytes(4).toString('hex')}.png`);
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', out], { timeout: 30000 });
  if (!existsSync(out)) spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-frames:v', '1', out], { timeout: 30000 });
  if (!existsSync(out)) return null;
  const buf = readFileSync(out);
  try { rmSync(out); } catch {}
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return { buf, duration: parseFloat(probe.stdout) || null };
}

// PDF text, good enough for search: inflate content streams and read the strings shown with Tj/TJ.
function pdfText(buf) {
  const s = buf.toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  let text = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s)) && text.length < 20000) {
    const end = s.indexOf('endstream', m.index);
    if (end < 0) break;
    const raw = buf.subarray(m.index + m[0].length, end);
    let out;
    try { out = zlib.inflateSync(raw).toString('latin1'); } catch { continue; }
    for (const t of out.matchAll(/\(((?:\\.|[^\\)])*)\)\s*T[jJ]|\[((?:[^\]])*)\]\s*TJ/g)) {
      const str = t[1] ?? (t[2] || '').replace(/\)\s*-?\d+(\.\d+)?\s*\(/g, '').replace(/^\(|\)$/g, '');
      text += str.replace(/\\(.)/g, '$1') + ' ';
    }
    re.lastIndex = end;
  }
  return { pages, text: text.replace(/\s+/g, ' ').trim() };
}

// CSS custom properties and design-token JSON become structured properties, so tokens can be diffed and served.
function tokensFrom(name, text) {
  const tokens = {};
  if (/\.(css|scss|less)$/i.test(name)) for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)/g)) tokens[m[1]] = m[2].trim();
  if (/\.json$/i.test(name)) {
    try {
      const walk = (o, p) => { for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object' && ('$value' in v || 'value' in v)) tokens[p + k] = String(v.$value ?? v.value); else if (v && typeof v === 'object') walk(v, `${p}${k}.`); } };
      walk(JSON.parse(text), '');
    } catch {}
  }
  return tokens;
}

// One entry point: any file in, a preview, thumbnail, text and structured properties out.
export async function preview(buf, name) {
  const ext = extOf(name), kind = kindOf(name);
  const file_key = storeFile(buf, ext);
  const base = { file_key, kind, mime: mimeOf(name), text: '', properties: { file: { name, size: buf.length, ext } } };
  const card = async (opts) => { base.properties.file.card = true; return { ...base, ...(await fromImage(await textCard({ title: name, label: ext.toUpperCase(), ...opts }))) }; };
  try {
    if (kind === 'image' || kind === 'svg') {
      const r = await fromImage(buf);
      if (kind === 'svg') base.text = buf.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
      return { ...base, ...r, properties: { ...base.properties, image: r.orig } };
    }
    if (kind === 'video') {
      const f = videoFrame(filePath(file_key));
      if (f) return { ...base, ...(await fromImage(f.buf)), properties: { ...base.properties, video: { duration: f.duration } } };
      return card({ lines: ['Video', `${(buf.length / 1e6).toFixed(1)} MB`, 'Install ffmpeg for a keyframe preview'] });
    }
    if (kind === 'pdf') {
      const p = pdfText(buf);
      return { ...(await card({ lines: (p.text || 'No extractable text').match(/.{1,70}(\s|$)/g)?.slice(0, 12) || [], mono: false })), text: p.text, properties: { ...base.properties, pdf: { pages: p.pages } } };
    }
    if (kind === 'docx') {
      const doc = unzip(buf).find((e) => e.name === 'word/document.xml');
      const text = doc ? doc.data.toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').trim() : '';
      return { ...(await card({ lines: text.split('\n').filter(Boolean), mono: false })), text };
    }
    if (kind === 'text' || kind === 'code') {
      const text = buf.toString('utf8').slice(0, 200000);
      const props = { ...base.properties };
      const tokens = tokensFrom(name, text);
      if (Object.keys(tokens).length) props.tokens = tokens;
      if (ext === 'json') {
        try { const j = JSON.parse(text); if (j && j.layers && j.v) props.lottie = { w: j.w, h: j.h, fr: j.fr, frames: j.op - j.ip, layers: j.layers.length, name: j.nm }; } catch {}
      }
      const lines = props.lottie ? ['Lottie animation', `${props.lottie.w}×${props.lottie.h} · ${props.lottie.fr} fps`, `${props.lottie.layers} layers · ${props.lottie.frames} frames`] : text.split(/\r?\n/);
      return { ...(await card({ lines, mono: !props.lottie })), text, properties: props };
    }
    if (kind === 'font') return card({ big: 'Aa', lines: [] });
    if (kind === 'design') {
      // .sketch, .xd and newer .fig files are zips that carry their own preview picture.
      if (buf[0] === 0x50 && buf[1] === 0x4b) {
        const thumb = unzip(buf).find((e) => /(^|\/)(preview|thumbnail)[^/]*\.png$/i.test(e.name));
        if (thumb) return { ...base, ...(await fromImage(thumb.data)) };
      }
      return card({ lines: [`${ext.toUpperCase()} file`, `${(buf.length / 1e6).toFixed(2)} MB`, 'Stored and versioned; open it in its app', 'Visual diff needs an exported preview'] });
    }
  } catch (e) {
    return { ...(await card({ lines: ['No preview for this file', String(e.message).slice(0, 70)] })), error: e.message };
  }
  return card({ lines: ['Stored and searchable by name'] });
}

// dHash (64-bit) and a small colour/layout vector: the image "embedding" used for similarity and routing.
// ponytail: tiny pixel descriptor; swap for CLIP-style embeddings (e.g. Voyage multimodal) when similarity needs semantics.
export async function imageHashes(imageKey) {
  const g = await sharp(filePath(imageKey)).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
  const phash = BigInt('0b' + bits).toString(16).padStart(16, '0');
  const rgb = await sharp(filePath(imageKey)).resize(8, 8, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const v = Array.from(rgb, (n) => n / 255);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const c = v.map((n) => n - mean);
  const norm = Math.hypot(...c) || 1;
  return { phash, img_vec: c.map((n) => +(n / norm).toFixed(4)) };
}
export const hamming = (a, b) => { let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

export async function palette(imageKey, count = 6) {
  const { data, info } = await sharp(filePath(imageKey)).resize(48, 48, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const k = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
    const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(k, b);
  }
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0');
  return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count).map((b) => `#${hex(b.r / b.n)}${hex(b.g / b.n)}${hex(b.b / b.n)}`);
}

export async function crop(imageKey, r) {
  const img = sharp(filePath(imageKey));
  const { width, height } = await img.metadata();
  const left = Math.max(0, Math.round(r.x * width)), top = Math.max(0, Math.round(r.y * height));
  return img.extract({ left, top, width: Math.max(1, Math.min(width - left, Math.round(r.w * width))), height: Math.max(1, Math.min(height - top, Math.round(r.h * height))) }).png().toBuffer();
}

// ---- zip read / write (stored + deflate; no zip64) ----
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    try { out.push({ name, data: method === 0 ? raw : zlib.inflateRawSync(raw) }); } catch {}
  }
  return out;
}
export function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(h, n, comp); central.push(c, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

// ---- render service: a headless Edge/Chrome screenshot of any web page (Framer, Spline, Rive, live sites) ----
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
export const browserPath = () => process.env.TRACE_BROWSER || BROWSERS.find((b) => existsSync(b));
// A Windows app-compatibility layer some parents pass down (__COMPAT_LAYER=DetectorsAppHealth) stops headless Edge drawing.
export const browserEnv = () => { const e = { ...process.env }; delete e.__COMPAT_LAYER; return e; };
export function screenshot(url, width = 1440, height = 900) {
  const exe = browserPath();
  if (!exe || !/^https?:\/\//.test(url)) return null;
  const profile = mkdtempSync(path.join(os.tmpdir(), 'trace-render-'));
  const out = path.join(profile, 'shot.png');
  spawnSync(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--virtual-time-budget=9000', `--screenshot=${out}`, url], { timeout: 45000, env: browserEnv() });
  const buf = existsSync(out) ? readFileSync(out) : null;
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 3000);
  return buf;
}
