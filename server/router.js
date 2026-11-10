// The route table every routes/*.js file adds to, and what a handler needs to answer: an error with a status, who
// may do what, and a page that runs at its own address.
import { get } from './db.js';

export const err = (status, message) => Object.assign(new Error(message), { status });
export const LEVEL = { read: 0, comment: 1, review: 2, edit: 3, admin: 4 };
export const ROLE = { viewer: 0, guest: 1, reviewer: 2, editor: 3, owner: 4 };
export function can(user, level, project_id) {
  if (user.guest) return project_id === user.project_id && LEVEL[level] <= LEVEL.comment;
  let role = user.role;
  if (project_id && role !== 'owner') role = get('SELECT role FROM project_member WHERE project_id=? AND user_id=?', project_id, user.id)?.role || role;
  return ROLE[role] >= LEVEL[level];
}

// r(method, pattern, level, handler, { guest, raw }): level is the least a role must be allowed (read … admin);
// guest lets a guest link in; raw hands the handler the body as bytes (uploads).
export const routes = [];
export const r = (method, pattern, level, fn, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), level, fn, ...opts });

// Untrusted HTML (an agent's artifact, a component drawn live) runs at its own address with no origin of its own: it can't
// read Trace, its cookies or its API, even opened in a new window.
export const sandboxed = (res, html) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); res.end(html); };
