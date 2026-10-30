// Tokens and API keys live here, never in the main database: an AES-256-GCM file whose key sits in the
// user's profile (~/.trace/key), apart from the data folder.
// ponytail: file vault with a profile-held key; use the OS keychain (DPAPI / Keychain) or a cloud KMS when hosted.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA } from './db.js';

const keyDir = process.env.TRACE_KEY_DIR || path.join(os.homedir(), '.trace');
const keyFile = path.join(keyDir, 'key');
const vault = path.join(DATA, 'secrets.enc');

function key() {
  if (!existsSync(keyFile)) { mkdirSync(keyDir, { recursive: true }); writeFileSync(keyFile, randomBytes(32), { mode: 0o600 }); }
  return readFileSync(keyFile);
}
function load() {
  if (!existsSync(vault)) return {};
  const buf = readFileSync(vault);
  const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString());
}
function save(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  writeFileSync(vault, Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 });
}

export const getSecret = (ref) => (ref ? load()[ref] : undefined);
export function setSecret(ref, value) { const s = load(); s[ref] = value; save(s); return ref; }
export function deleteSecret(ref) { const s = load(); delete s[ref]; save(s); }
export const hint = (ref) => { const v = getSecret(ref); return v ? `…${String(v).slice(-4)}` : null; };
