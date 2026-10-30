// What kind of product a project is, for its card's background (an effect from the Animation Engine picked for the
// kind): read off its name, brief and digest, its package.json and the start of its README. Plain keyword scores, the
// name counting most. ponytail: guessed only; a picker on the card when a guess is wrong.
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const KINDS = [
  ['Food & delivery', /\b(food|restaurants?|deliver(y|ies)|swiggy|zomato|menus?|recipes?|caf[eé]s?|kitchens?|grocer(y|ies)|dishes|dosa|biryani)\b/gi],
  ['Sport & events', /\b(sports?|league|running|runners?|fitness|athletes?|matches|tournaments?|events?|festivals?|marathons?|cricket|football)\b/gi],
  ['Commerce', /\b(shop|store|e-?commerce|cart|checkout|retail|catalog(ue)?|fashion|products? page|pricing)\b/gi],
  ['Tools & AI', /\b(ai|llms?|agents?|models?|api|sdk|developers?|dev tools?|dashboards?|gateway|providers?|cli|mcp|analytics|vercel|prd)\b/gi],
  ['Motion & film', /\b(animations?|motion|films?|videos?|render(s|ing)?|studio|canvas|three|gsap|remotion|lottie)\b/gi],
  ['Portfolio', /\b(portfolio|resume|cv|about me|case stud(y|ies)|personal site|designer)\b/gi],
];

const read = (f, n = 1200) => { try { return readFileSync(f, 'utf8').slice(0, n); } catch { return ''; } };

export function categoryOf(p) {
  const dir = (p.folders || [])[0];
  const pkg = dir ? (() => { try { return JSON.parse(read(path.join(dir, 'package.json'), 200000)); } catch { return {}; } })() : {};
  const sources = [
    [p.name, 4],
    [`${p.brief || ''} ${p.digest?.now || ''}`, 2],
    [`${pkg.name || ''} ${pkg.description || ''} ${(pkg.keywords || []).join(' ')}`, 2],
    [Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ').replace(/[@/-]/g, ' '), 1],
    [dir ? read(path.join(dir, 'README.md'), 800) : '', 1],
  ];
  let best = ['Product', 0];
  for (const [kind, re] of KINDS) {
    const score = sources.reduce((n, [text, w]) => n + (String(text || '').match(re)?.length || 0) * w, 0);
    if (score > best[1]) best = [kind, score];
  }
  return best[0];
}
