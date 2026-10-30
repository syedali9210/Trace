// GitHub: commits, pull requests and their comments, polled with a token (or the GitHub CLI's login).
// A commit is a boundary (its own moment); changed images in a commit get real before/after snapshots;
// Figma links in commit messages and PR bodies become "implements" edges, which routing then follows.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { get, update, insert, uid, now, mapActor } from '../db.js';
import { getSecret, setSecret } from '../secrets.js';
import { ingest } from '../engine.js';
import { fileKeyOf } from './figma.js';

const API = 'https://api.github.com';
const IMG = /\.(png|jpe?g|webp|gif|svg)$/i;

async function gh(source, p, accept = 'application/vnd.github+json') {
  const r = await fetch(API + p, { headers: { authorization: `Bearer ${getSecret(source.auth_ref)}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'trace-design-memory' }, signal: AbortSignal.timeout(30000) });
  const rate = { remaining: +r.headers.get('x-ratelimit-remaining'), limit: +r.headers.get('x-ratelimit-limit'), reset: +r.headers.get('x-ratelimit-reset') * 1000 };
  if (rate.limit && source.id) update('source', source.id, { health: { ...source.health, rate } });
  if ((r.status === 403 || r.status === 429) && rate.remaining === 0) throw Object.assign(new Error('GitHub rate limit reached'), { status: 429, retryAfter: Math.max(60, (rate.reset - now()) / 1000) });
  if (r.status === 401) throw Object.assign(new Error('GitHub rejected the token. Reconnect GitHub in Settings → Sources.'), { status: 401 });
  if (!r.ok) throw Object.assign(new Error(`GitHub said ${r.status} for ${p.split('?')[0]}`), { status: r.status });
  return accept.includes('raw') ? Buffer.from(await r.arrayBuffer()) : r.json();
}

const designLinks = (text = '') => [...String(text).matchAll(/https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/[A-Za-z0-9]+[^\s)>\]]*/g)].map((m) => m[0]);

export const github = {
  tool: 'github', label: 'GitHub', interval: 60000,
  async authorize({ token, use_cli, repos }) {
    let t = token;
    if (!t && use_cli) {
      const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
      t = r.status === 0 ? r.stdout.trim() : null;
      if (!t) throw Object.assign(new Error('The GitHub CLI isn’t signed in here. Run `gh auth login`, or paste a token.'), { status: 400 });
    }
    if (!t) throw Object.assign(new Error('Paste a GitHub token (github.com → Settings → Developer settings → Fine-grained tokens, read access to contents, pull requests and issues).'), { status: 400 });
    const ref = setSecret(uid('sec'), t);
    const me = await gh({ auth_ref: ref }, '/user');
    const list = String(repos || '').split(/[\s,]+/).map((r) => r.replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '')).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
    return { name: `GitHub · ${me.login}`, auth_ref: ref, scope: { repos: list } };
  },
  async listScopes(source) {
    return (await gh(source, '/user/repos?per_page=100&sort=updated')).map((r) => ({ id: r.full_name, name: r.full_name, kind: 'repo', private: r.private }));
  },
  async poll(source) {
    const cursor = { repos: {}, ...source.cursor };
    for (const repo of source.scope.repos || []) {
      const c = cursor.repos[repo] || {};
      const commits = await gh(source, `/repos/${repo}/commits?per_page=${c.last ? 30 : 5}`);
      const fresh = [];
      for (const cm of commits) { if (cm.sha === c.last) break; fresh.push(cm); }
      for (const cm of fresh.reverse()) {
        const d = await gh(source, `/repos/${repo}/commits/${cm.sha}`);
        ingest(source, {
          external_id: repo, version: cm.sha, type: 'commit', actor: d.commit.author?.name, ts: Date.parse(d.commit.committer?.date || d.commit.author?.date),
          payload: { repo, sha: cm.sha, message: d.commit.message, url: d.html_url, actor_email: d.commit.author?.email, boundary: 'commit', files: (d.files || []).slice(0, 300).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch?.slice(0, 2500) })), design_links: designLinks(d.commit.message) },
        });
      }
      if (commits[0]) c.last = commits[0].sha;
      for (const pr of await gh(source, `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=15`)) {
        const state = pr.merged_at ? 'merged' : pr.state;
        if (c.prs?.[pr.number] === state || (!c.last_pr_sync && state !== 'open')) continue; // history before connecting stays history
        ingest(source, {
          external_id: `${repo}#${pr.number}`, version: state, type: `pr.${state === 'open' ? 'opened' : state}`, actor: pr.user?.login, ts: Date.parse(pr.updated_at),
          payload: { repo, number: pr.number, pr_title: pr.title, pr_body: (pr.body || '').slice(0, 4000), url: pr.html_url, state, boundary: 'pull request', design_links: designLinks(pr.body) },
        });
        c.prs = { ...c.prs, [pr.number]: state };
      }
      c.last_pr_sync = now();
      await mirrorComments(source, repo, c);
      cursor.repos[repo] = c;
    }
    update('source', source.id, { cursor });
  },
  fetchObject(ev, source) {
    const p = ev.payload;
    const links = (p.design_links || []).flatMap((u) => {
      const key = fileKeyOf(u), node = u.match(/node-id=([\d-:]+)/)?.[1]?.replace('-', ':');
      const a = key && (get("SELECT id FROM asset WHERE tool='figma' AND external_id=?", `${key}:${node}`) || get("SELECT id FROM asset WHERE tool='figma' AND parent=? ORDER BY updated_at DESC LIMIT 1", key));
      return a ? [{ rel: 'implements', id: a.id }] : [];
    });
    if (ev.type === 'commit') {
      const descs = [{ external_id: p.repo, type: 'repo', name: p.repo, path: p.repo, parent: p.repo, url: `https://github.com/${p.repo}`, links }];
      for (const f of p.files.filter((f) => IMG.test(f.filename) && f.status !== 'removed').slice(0, 4)) {
        descs.push({ external_id: `${p.repo}:${f.filename}`, type: 'image', name: path.posix.basename(f.filename), path: `${p.repo}/${f.filename}`, parent: `${p.repo}/${path.posix.dirname(f.filename)}`, url: `https://github.com/${p.repo}/blob/${p.sha}/${f.filename}`, file: f.filename });
      }
      return descs;
    }
    return [{ external_id: ev.external_id, type: 'pull request', name: `#${p.number} ${p.pr_title}`, path: `${p.repo}/pull/${p.number}`, parent: p.repo, url: p.url, links }];
  },
  async renderPreview(ev, asset, desc, source) {
    const p = ev.payload;
    if (desc.file) return { buf: await gh(source, `/repos/${p.repo}/contents/${encodeURI(desc.file)}?ref=${p.sha}`, 'application/vnd.github.raw'), name: desc.name };
    if (ev.type === 'commit') {
      const files = Object.fromEntries(p.files.map((f) => [f.filename, { status: f.status, additions: f.additions, deletions: f.deletions }]));
      const card = { title: p.message.split('\n')[0], label: p.sha.slice(0, 7), lines: p.files.slice(0, 14).map((f) => `${f.status[0].toUpperCase()}  ${f.filename}  +${f.additions} −${f.deletions}`) };
      return { card, properties: { code: { files, message: p.message, sha: p.sha } }, text: `${p.message}\n${p.files.map((f) => `${f.filename}\n${f.patch || ''}`).join('\n')}` };
    }
    const card = { title: `#${p.number} ${p.pr_title}`, label: p.state.toUpperCase(), lines: (p.pr_body || '').split('\n'), mono: false };
    return { card, properties: { pr: { number: p.number, state: p.state, url: p.url } }, text: `${p.pr_title}\n${p.pr_body}` };
  },
  mapActor: (name, email) => mapActor(name, email),
  async health(source) {
    try { const me = await gh(source, '/user'); return { ok: true, detail: `Signed in as ${me.login}` }; } catch (e) { return { ok: false, detail: e.message }; }
  },
};

// Issue/PR conversation comments and review comments mirror in, on the PR's asset (or the repo's).
async function mirrorComments(source, repo, c) {
  const since = new Date(c.comments_since || now() - 7 * 86400000).toISOString();
  const lists = [await gh(source, `/repos/${repo}/issues/comments?since=${since}&per_page=50`), await gh(source, `/repos/${repo}/pulls/comments?since=${since}&per_page=50`)];
  for (const cm of lists.flat()) {
    const ref = `github:${cm.id}`;
    if (get('SELECT 1 FROM comment WHERE external_ref=?', ref)) continue;
    const num = (cm.issue_url || cm.pull_request_url || '').match(/\/(\d+)$/)?.[1];
    const asset = (num && get('SELECT * FROM asset WHERE source_id=? AND external_id=?', source.id, `${repo}#${num}`)) || get('SELECT * FROM asset WHERE source_id=? AND external_id=?', source.id, repo);
    if (!asset?.project_id) continue;
    const author = mapActor(cm.user?.login);
    insert('comment', { id: uid('cm'), project_id: asset.project_id, target_type: 'asset', target_id: asset.id, author_id: author.id, author_name: author.name, body: cm.body, status: 'open', external_ref: ref, external_url: cm.html_url, created_at: Date.parse(cm.created_at), updated_at: now() });
  }
  c.comments_since = now();
}
