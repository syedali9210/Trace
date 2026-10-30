#!/usr/bin/env node
// The Trace command line, for coding agents and people:
//   node bin/trace.js assemble [folder]   point Trace at a folder: project, capture, AI memory, script, case study
//   node bin/trace.js case-study [folder] print the case study of the folder's project as markdown
//   node bin/trace.js check [folder] [--ask "what was asked"] [--stress] [--proto <commit, branch or folder>]
//                                         walk the running app again (only what changed) and check it: values that
//                                         almost match the app's own (drift), screens moved that the ask didn't name
//                                         (scope), the captured design against what runs and which side moved,
//                                         values changed and changed back (flip-flops), states nobody has seen.
//                                         Each finding says its file, last commit and ask. Exits 1 when a change
//                                         went outside what was asked. --stress also opens every page with no data,
//                                         failing or slow data and long text, and checks them by rule. --proto takes
//                                         a prototype (an old branch, or another project's folder, walked in Trace)
//                                         as the acceptance test: how many of its screens this has and how each
//                                         differs; exits 1 when one is missing.
//   node bin/trace.js canvas [folder] [--no-open]
//                                         open the design canvas: the app running, to pick anything and change how
//                                         it's drawn like in Figma. Prints the link (and opens it in the browser).
//   node bin/trace.js changes [folder] [--done]
//                                         the changes made on the canvas, each with its file and line and the code it
//                                         needs, as a brief to apply; --done says they're in the code now.
// Talks to the Trace running on this machine (TRACE_URL, default http://127.0.0.1:4317).
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const base = (process.env.TRACE_URL || 'http://127.0.0.1:4317').replace(/\/$/, '');
const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(k); return i < 0 ? null : argv.splice(i, 2)[1] ?? ''; };
const sw = (k) => argv.includes(k) && !!argv.splice(argv.indexOf(k), 1); // a switch with no value
const ask = flag('--ask'), proto = flag('--proto'), stress = sw('--stress'), noOpen = sw('--no-open'), done = sw('--done');
const [cmd = 'help', dir = process.cwd()] = argv;
const call = async (p, opts = {}) => {
  let r;
  try { r = await fetch(base + p, { ...opts, headers: { 'content-type': 'application/json', 'x-trace': '1', ...(opts.headers || {}) } }); }
  catch { console.error(`Trace isn't running at ${base}. Start it: cd "${path.resolve(import.meta.dirname, '..')}" && npm start`); process.exit(2); }
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { console.error(body.error || body); process.exit(1); }
  return body;
};

if (cmd === 'assemble') {
  const r = await call('/api/assemble', { method: 'POST', body: JSON.stringify({ dir: path.resolve(dir) }) });
  console.log(`Trace · ${r.project.name}\n${r.link}\n`);
  for (const s of r.steps) console.log(`  ✓ ${s}`);
  console.log(`\nFound: ${Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  console.log(`Case study: ${r.case_study.readiness}% answered`);
  if (r.case_study.open.length) {
    console.log('Still open (answer these with answer_case_study, or in Trace):');
    for (const s of r.case_study.open) console.log(`  · [${s.id}] ${s.q} (${s.status})`);
  }
} else if (cmd === 'case-study') {
  const r = await call('/api/assemble', { method: 'POST', body: JSON.stringify({ dir: path.resolve(dir), quiet: true }) });
  process.stdout.write(await call(`/api/projects/${r.project.id}/case-study.md`));
} else if (cmd === 'check') {
  const r = await call('/api/assemble', { method: 'POST', body: JSON.stringify({ dir: path.resolve(dir), quiet: true }) });
  const B = `/api/projects/${r.project.id}/history/now`, wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const live = (await call(`/api/projects/${r.project.id}/history`)).live?.find((x) => x.sha === 'now');
  if (live?.status === 'ready') { // walk it again first: only the screens a change touched, so it's quick
    let w = await call(`${B}/screens`, { method: 'POST', headers: { origin: base }, body: JSON.stringify({ force: true }) });
    for (let i = 0; i < 1200 && w.walking; i++) { await wait(1000); w = await call(`${B}/screens`); }
    if (stress) { console.log('Stress walk: every page with no data, failing data, slow data and long text…\n'); await call(`${B}/stress`, { method: 'POST', headers: { origin: base } }); }
  } else console.log('The app isn’t running in Trace, so this checks its last walk. Run it in Trace to check what it draws now.\n');
  const c = await call(`${B}/check${ask ? `?ask=${encodeURIComponent(ask)}` : ''}`);
  const ago = Math.round((Date.now() - c.at) / 60000), s = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  console.log(`Trace check · ${r.project.name} · ${s(c.screens, 'screen')}, walked ${ago < 1 ? 'just now' : `${ago} min ago`}${c.since ? ` (${c.since.redid ? `${c.since.redid} walked again after ${s(c.since.changed, 'changed file')}` : 'nothing on screen had changed'})` : ''}\n`);
  let bad = false;
  const clip = (t, n = 70) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const from = (f) => { const ch = c.changes?.[f]; return `${f}${!ch ? '' : ch.sha === 'now' ? ', unsaved edits' : `, last changed in ${ch.short}${ch.agent ? ` by ${ch.agent}` : ''}: ${ch.asked ? `asked “${clip(ch.asked)}”` : `“${clip(ch.title)}”`}`}`; };
  if (c.scope) {
    console.log(`Scope · asked: “${c.scope.ask}”`);
    if (c.scope.skipped) console.log(`  – not checked: ${c.scope.skipped}`);
    else if (c.scope.outside.length) {
      bad = true;
      console.log(`  ✗ moved, but the ask doesn't name them: ${c.scope.outside.map((x) => x.name).join(', ')}\n    the ask names: ${c.scope.targets.map((x) => x.name).join(', ')}`);
      for (const o of c.scope.outside) if (o.because?.length) console.log(`    ${o.name} moved because of ${o.because.map(from).join('; ')}`);
    }
    else console.log(`  ✓ ${c.scope.moved.length ? `every screen it moved (${c.scope.moved.map((x) => x.name).join(', ')}) is one the ask names` : 'it moved no screen'}`);
  } else console.log('Scope · not checked: no ask given (--ask "…") and no "Asked:" line on the last commit.');
  if (c.rules?.length) { // a rule the person confirmed, broken by this change: as serious as going outside the ask
    bad = true;
    console.log(`\nYour rules · ${c.rules.length} broken by this change`);
    for (const b of c.rules) console.log(b.kind === 'avoid' ? `  ✗ ${b.label} came back: ${b.n} new line${b.n === 1 ? '' : 's'}, e.g. ${b.hits[0].file}: ${b.hits[0].line.slice(0, 80)}\n    rule: “${b.rule.text}”` : `  ✗ ${b.files.join(', ')} changed: you said not to touch ${b.label}\n    rule: “${b.rule.text}”`);
  }
  console.log(`\nDrift · ${c.drift.length ? `${s(c.drift.length, 'value')} almost match one the app uses everywhere else` : 'every value matches the app’s own scale, or is clearly its own'}`);
  for (const x of c.drift.slice(0, 20)) { const a = x.at[0] || {}; console.log(`  · ${x.kind} ${x.value} → ${x.near}${x.token ? ` (${x.token})` : x.uses ? ` (used ${x.uses}×)` : ''}, off by ${x.d}${x.kind === 'colour' ? '' : 'px'} · ${x.n}× · on ${a.name}${a.component ? `, in ${a.component}` : ''}${a.text ? ` “${a.text}”` : ''}${a.file ? `\n      ${from(a.file)}` : ''}`); }
  if (c.drift.length > 20) console.log(`  … and ${c.drift.length - 20} more in Trace`);
  // The design against what runs: the side that changed last moved, so the other follows.
  const ACT = { code: 'the code follows the design', design: 'update the design, or put the code back', person: 'an agent changed it without being asked: a person decides' };
  if (!c.design) console.log('\nDesign · not checked: no Figma frames or design-token files captured for this project.');
  else {
    console.log(`\nDesign · ${c.design.length ? `${s(c.design.length, 'value')} disagree with the captured Figma frames and token files` : 'what runs agrees with the captured design'}`);
    for (const x of c.design.slice(0, 20)) {
      const w = x.design.where || {}, a = x.code.at[0] || {};
      console.log(x.by === 'name' ? `  · ${x.name}: code ${x.code.value}, design ${x.design.value} (${x.design.name} in ${w.file})`
        : `  · ${x.kind} ${x.code.value} → the design's ${x.design.value}${x.design.name ? ` (${x.design.name})` : ` (used ${x.design.n}× in ${w.file})`} · ${x.code.n}× · on ${a.name}${a.component ? `, in ${a.component}` : ''}`);
      console.log(`      ${x.moved ? `${x.moved === 'code' ? 'the code' : 'the design'} changed last → ${ACT[x.acts]}` : 'can’t tell which side changed last'}${x.code.last ? ` · ${from(x.code.last)}` : ''}`);
    }
    if (c.design.length > 20) console.log(`  … and ${c.design.length - 20} more in Trace`);
  }
  if (c.flips) { // values put back to what they were: an open question
    const und = c.flips.filter((x) => x.undecided).length;
    console.log(`\nFlip-flops · ${c.flips.length ? `${s(c.flips.length, 'value')} changed and changed back${und ? `; ${und} by different hands or more than once: nobody has decided ${und === 1 ? 'it' : 'them'}` : ''}` : 'no value in the code has gone back to what it was'}`);
    for (const x of c.flips.slice(0, 10)) {
      console.log(`  ${x.undecided ? '?' : '·'} ${x.values.join(' → ')} · ${x.file}${x.in ? `, in ${clip(x.in.replace(/\s*\{$/, ''), 50)}` : ''}\n      ${x.line}`);
      for (const ch of x.changes) console.log(`      ${ch.short} ${ch.agent || ch.who}: ${ch.from} → ${ch.to} · ${ch.asked ? `asked “${clip(ch.asked)}”` : `“${clip(ch.title)}”`}`);
    }
  }
  if (c.states) { // what the code can show that nobody has looked at
    const open = c.states.map((x) => ({ ...x, un: x.states.filter((u) => !u.seen && !u.designed && !u.forced) }));
    const n = open.reduce((k, x) => k + x.un.length, 0), forced = c.states.flatMap((x) => x.states.filter((u) => u.forced && !u.seen).map((u) => `${x.name} ${u.state}`));
    if (forced.length) console.log(`\nForced by the stress walk, never seen in a walk: ${forced.slice(0, 8).join(', ')}${forced.length > 8 ? ` and ${forced.length - 8} more` : ''}`);
    console.log(`\nStates · ${n ? `${s(n, 'state')} in the code that no walk has seen and no design shows` : 'every state in the code was seen or designed'}`);
    for (const x of open.slice(0, 12)) {
      const by = (f) => x.un.filter((u) => u.from === f).map((u) => u.state);
      const parts = [by('code').length && `${by('code').join(', ')} in its code`, by('prop').length && `${by('prop').join(', ')} (props)`, by('variant').length && s(by('variant').length, 'variant')].filter(Boolean);
      console.log(`  · ${x.name} (${x.on.length ? `on ${s(x.on.length, 'screen')}` : 'on no walked screen'}): ${parts.join('; ')} · ${x.file}`);
    }
    if (open.length > 12) console.log(`  … and ${open.length - 12} more components in Trace`);
  }
  const RULE = { cut: 'text cut off', sideways: 'wider than the window', over: 'text over text', faint: 'text too faint', blank: 'nothing on the page' };
  const MODE = { base: 'as it is', empty: 'no data', error: 'data failing', slow: 'data slow', long: 'long text' };
  if (c.stress?.pages?.length) { // what broke under conditions nobody designs for (and what was broken already)
    const st = c.stress, mins = Math.round((Date.now() - st.at) / 60000);
    console.log(`\nStress · ${s(st.pages.length, 'page')} with no data, failing and slow data, and long text, ${mins < 1 ? 'just now' : `${mins} min ago`}${st.data ? '' : '. This app asks for no data of its own, so only long text could be forced'}`);
    const tell = (r) => { const by = {}; for (const f of r.found) (by[f.rule] ||= []).push(f); return [...Object.entries(by).map(([k, v]) => `${RULE[k] || k}${v.length > 1 ? ` ×${v.length}` : ''}${v[0].t ? ` “${clip(v[0].t, 30)}”` : ''}${v[0].ratio ? ` (${v[0].ratio}:1)` : ''}`), ...r.errors.map((e) => `threw “${clip(e, 60)}”`)]; };
    for (const pg of st.pages) for (const m of ['empty', 'error', 'slow', 'long', 'base']) {
      const said = pg.modes[m] ? tell(pg.modes[m]) : [];
      if (said.length) console.log(`  · ${pg.name}, ${MODE[m]}: ${said.join('; ')}`);
    }
  } else console.log('\nStress · not walked yet: add --stress while the app runs in Trace.');
  if (proto) { // the prototype as the acceptance test: how many of its screens this walk has, and how each differs
    const git = !proto.startsWith('-') && spawnSync('git', ['rev-parse', '--verify', '-q', `${proto}^{commit}`], { cwd: path.resolve(dir), encoding: 'utf8' }).stdout?.trim(); // never an option to git
    const other = !git && (await call('/api/assemble', { method: 'POST', body: JSON.stringify({ dir: path.resolve(proto), quiet: true }) })).project;
    const m = await call(`${B}/match?with=${git || other.id}`), by = (l) => Object.entries(l.reduce((o, d) => ({ ...o, [d.prop]: (o[d.prop] || 0) + 1 }), {})).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(', ');
    console.log(`\nPrototype · ${other ? other.name : `${proto} (${git.slice(0, 7)})`} · this has ${m.covered} of its ${s(m.refs, 'screen')}`);
    for (const x of m.pairs) {
      if (!x.screen) { bad = true; console.log(`  ✗ ${x.ref.name}: not here`); continue; }
      const n = x.diffs.length + x.reworded.length + x.missing.length;
      console.log(`  ${n ? '·' : '✓'} ${x.ref.name}${x.screen.name !== x.ref.name ? ` → ${x.screen.name}` : ''}: ${n ? [x.diffs.length && `${by(x.diffs)}`, x.reworded.length && `${s(x.reworded.length, 'reworded text')}`, x.missing.length && `${x.missing.length} missing (“${clip(x.missing[0].t, 40)}”)`].filter(Boolean).join('; ') : 'the same'}`);
      for (const d of x.diffs.slice(0, 3)) console.log(`      ${d.prop} ${d.ref} → ${d.now} on “${clip(d.t, 40)}”${d.c ? ` (${d.c})` : ''}`);
    }
    if (m.extra.length) console.log(`  + not in the prototype: ${m.extra.map((x) => x.name).join(', ')}`);
  }
  process.exit(bad ? 1 : 0);
} else if (cmd === 'canvas') {
  const r = await call('/api/assemble', { method: 'POST', body: JSON.stringify({ dir: path.resolve(dir), quiet: true }) });
  const d = await call(`/api/projects/${r.project.id}/design/open`, { method: 'POST', headers: { origin: base } });
  const link = `${base}/#/p/${r.project.id}/design`;
  console.log(`Trace canvas · ${r.project.name}\n${link}\n`);
  console.log(d.status === 'ready' ? 'The app is running in it: pick anything and change how it’s drawn.' : 'The app is starting (its own dev server); the canvas shows it as soon as it runs.');
  console.log('Your code changes show on it as you make them. Take what the person changed with: node bin/trace.js changes');
  if (!noOpen) { const [c, a] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [link]]; spawn(c, a, { detached: true, stdio: 'ignore' }).unref(); }
} else if (cmd === 'changes') {
  const r = await call('/api/assemble', { method: 'POST', body: JSON.stringify({ dir: path.resolve(dir), quiet: true }) });
  if (done) { await call(`/api/projects/${r.project.id}/design/done`, { method: 'POST', headers: { origin: base }, body: '{}' }); console.log('Marked as in the code.'); process.exit(0); }
  const t = await call(`/api/projects/${r.project.id}/design/take`, { method: 'POST', headers: { origin: base } });
  if (!t.edits.length) { console.log('Nothing changed on the canvas yet.'); process.exit(0); }
  console.log(`${t.brief}\n`);
  for (const e of t.edits) console.log(`  ${e.file ? `${e.file}${e.line ? `:${e.line}` : ''}` : '(not found in the code: find it by its text and classes)'}\n    now:  ${e.code || e.cls || ''}\n    make: ${e.tw ? `${e.tw.replace.length ? `${e.tw.replace.join(' ')} → ` : 'add '}${e.tw.add}` : e.css}`);
  console.log('\nWhen they are in the code: node bin/trace.js changes --done');
} else {
  console.log('Usage: node bin/trace.js assemble [folder]\n       node bin/trace.js case-study [folder]\n       node bin/trace.js check [folder] [--ask "what was asked"] [--stress] [--proto <commit, branch or folder>]\n       node bin/trace.js canvas [folder] [--no-open]\n       node bin/trace.js changes [folder] [--done]');
}
