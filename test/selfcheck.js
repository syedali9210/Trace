// npm test: the smallest checks that fail if the engine's logic breaks. Runs in a throwaway data folder.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TRACE_DATA = mkdtempSync(path.join(os.tmpdir(), 'trace-test-'));
process.env.TRACE_KEY_DIR = mkdtempSync(path.join(os.tmpdir(), 'trace-key-'));

const { structuralDiff, regionsFrom, magnitude, bucket } = await import('../server/diff.js');
const { describe, sentence, plain } = await import('../server/words.js');
const { redact } = await import('../server/memory.js');

// structural diff: attribute changes, copy, added/removed nodes, id moves matched by name + type
const before = { root: { w: 100, h: 100 }, nodes: { 1: { name: 'Body', type: 'TEXT', x: 0, y: 0, w: 10, h: 10, font: { family: 'Inter', size: 16, weight: 400 }, text: 'Hi', fills: ['#111111'] }, 2: { name: 'Promo', type: 'FRAME' }, 4: { name: 'Card', type: 'FRAME', x: 0, y: 50, w: 50, h: 20 } } };
const after = { root: { w: 100, h: 100 }, nodes: { 1: { name: 'Body', type: 'TEXT', x: 0, y: 0, w: 10, h: 10, font: { family: 'Inter', size: 14, weight: 400 }, text: 'Hello', fills: ['#2b59ff'] }, 3: { name: 'Apple Pay', type: 'FRAME' }, 9: { name: 'Card', type: 'FRAME', x: 0, y: 70, w: 50, h: 20 } } };
const ch = structuralDiff(before, after);
assert.ok(ch.some((c) => c.path === 'Body › font.size' && c.before === '16' && c.after === '14'), 'font size change');
assert.ok(ch.some((c) => c.kind === 'color' && c.after === '#2b59ff'), 'fill change, shown as a plain value');
assert.ok(ch.some((c) => c.kind === 'copy' && c.after === 'Hello'), 'copy change');
assert.ok(ch.some((c) => c.kind === 'node.added' && c.path.startsWith('Apple Pay')), 'added node');
assert.ok(ch.some((c) => c.kind === 'node.removed' && c.path.startsWith('Promo')), 'removed node');
assert.ok(ch.some((c) => c.path === 'Card › position'), 'moved node matched by name though its id changed');
assert.ok(!ch.some((c) => c.path.startsWith('Card') && c.kind.startsWith('node.')), 'a re-id’d node is not added + removed');

// changed regions: one blob → one box in the right place
const W = 64, H = 64, mask = new Uint8Array(W * H);
for (let y = 10; y < 20; y++) for (let x = 10; x < 22; x++) mask[y * W + x] = 1;
const rg = regionsFrom(mask, W, H);
assert.equal(rg.length, 1);
assert.ok(Math.abs(rg[0].x - 10 / 64) < 0.04 && Math.abs(rg[0].y - 10 / 64) < 0.04, `region at ${JSON.stringify(rg[0])}`);

// magnitude buckets and the basis
assert.equal(bucket(14), 'small'); assert.equal(bucket(15), 'medium'); assert.equal(bucket(50), 'medium'); assert.equal(bucket(51), 'large');
assert.ok(magnitude({ visual: { pct: 0.01 }, changes: [], semantic: { type: 'no change' }, hasStructure: false }).score < 15);
const big = magnitude({ visual: { pct: 40 }, changes: Array.from({ length: 10 }, () => ({ kind: 'layout', weight: 1 })), semantic: { type: 'layout' }, hasStructure: true });
assert.equal(big.bucket, 'large');
assert.equal(big.basis.layers, 4);

// the changelog sentence says only what the diff proves, NCS-style: verbs grouped, keywords as chips
const seg = sentence({ changes: ch });
assert.equal(plain(seg), 'Decreased font size. Changed colours. Edited copy. Added Apple Pay.', plain(seg)); // four verbs at most: a glance, not a report
assert.ok(seg.some((x) => x.k === 'font size'), 'keywords are marked for chips');
const d = describe({ changes: ch, assets: [{ name: 'checkout-v2.png' }], semantic: 'typography', event_count: 14, links: ['note:Body 16 to 14 because it wrapped on small phones'] });
assert.ok(d.title.split(' ').length <= 9 && d.summary.includes('14 edits grouped') && d.why.includes('because'), JSON.stringify(d));
// reading component code: what a file exports, and sample props from its own types (optional ones left out)
const { componentsIn, propsFor } = await import('../server/render.js');
const tsx = `type Size = 'md' | 'lg'\ninterface CardProps { title: string; items: string[]; onOpen: () => void; dense?: boolean }\nexport function PayButton({ label, size }: { label: string; size: Size }) { return null }\nexport const Card = ({ title }: CardProps) => null\nexport default function Page() { return null }\nexport function useThing() {}`;
assert.deepEqual(componentsIn(tsx).map((c) => `${c.name}:${c.key}`), ['PayButton:PayButton', 'Card:Card', 'Page:default'], JSON.stringify(componentsIn(tsx)));
assert.equal(propsFor(tsx, 'PayButton'), '{ "label": "Label", "size": \'md\' }', propsFor(tsx, 'PayButton'));
assert.equal(propsFor(tsx, 'Card'), '{ "title": "Title", "items": [], "onOpen": () => {} }', propsFor(tsx, 'Card'));
// constraints come from the brief and from bulleted rules in the docs, and are checked against the design
const { constraintsOf, checkConstraint, sectionsOf } = await import('../server/casestudy.js');
const prd = { name: 'PRD.md', text: '# Shop\nA faster checkout.\n## Constraints\n- Buttons must be at least 44px tall\n- Use the brand teal #0f766e\n## Notes\n- just a thought\n' };
const cons = constraintsOf({ id: 'p_test', brief: 'Constraints: no new fonts this quarter; unknown' }, [prd]);
assert.deepEqual(cons.map((c) => c.text), ['no new fonts this quarter', 'Buttons must be at least 44px tall', 'Use the brand teal #0f766e'], JSON.stringify(cons));
assert.equal(checkConstraint(cons[2], { colors: [], declared: {}, typography: [], codeHas: (h) => h === '#0f766e' }).status, 'met');
assert.equal(checkConstraint(cons[2], { colors: [], declared: {}, typography: [], codeHas: () => false }).status, 'unseen');
assert.equal(sectionsOf(prd)[0].level, 1, 'the title paragraph is found');
// a code folder is files, named after where it lives, not "LICENSE: added 3 screens"
const code = describe({ assets: [{ name: 'LICENSE', path: 'LICENSE', type: 'file' }, { name: 'a.ts', path: 'src/a.ts', type: 'code' }, { name: 'b.ts', path: 'src/b.ts', type: 'code' }], semantic: 'new screen', source: 'Vercel PRD', tool: 'folder' });
assert.equal(code.title, 'Vercel PRD: added 3 files', code.title);
// and its pictures are the site's images, not screens
const site = describe({ assets: [{ name: 'App.tsx', path: 'src/App.tsx', type: 'code' }, { name: 'hero.webp', path: 'public/hero.webp', type: 'image' }, { name: 'ball.svg', path: '_figma/ball.svg', type: 'image' }], semantic: 'new screen', source: 'Running store website', tool: 'folder' });
assert.equal(site.title, 'Running store website: added 1 code file and 2 images', site.title);
// a big code folder's first import: git's own list (what .gitignore leaves out isn't the work, its docs still are),
// outputs left out, docs first, its UI next
{
  const { mkdtempSync: mk, mkdirSync: mkd, writeFileSync: w } = await import('node:fs');
  const dir = mk(path.join(os.tmpdir(), 'trace-pick-'));
  for (const [f, t] of [['package.json', '{}'], ['.gitignore', 'clips\nCONTEXT.md\n'], ['README.md', '# x'], ['CONTEXT.md', '# local'], ['src/App.tsx', 'x'], ['src/util.ts', 'x'], ['clips/0001.jpg', 'x'], ['engine-exports/film.mp4', 'x']]) { mkd(path.dirname(path.join(dir, f)), { recursive: true }); w(path.join(dir, f), t); }
  (await import('node:child_process')).spawnSync('git', ['init', '-q'], { cwd: dir });
  const { pickFiles } = await import('../server/connectors/local.js');
  assert.deepEqual(pickFiles(dir).files, ['CONTEXT.md', 'package.json', 'README.md', 'src/App.tsx', 'src/util.ts']);
}

// AI memory is served to other agents, so secrets never get indexed
const r = redact('key sk-ant-api03-abcdefghijklmnopqrstuv and ghp_abcdefghijklmnopqrstuvwxyz12 and password: hunter22hunter and token=abcd1234efgh');
assert.ok(!/sk-ant-api03|ghp_abc|hunter22|abcd1234/.test(r), r);
const r2 = redact('vck_abcdefghijklmnopqrstuvwxyz0123 MY_SERVICE_API_KEY=abcdef123456 Authorization: Bearer abcdefghijklmnop1234 postgres://me:s3cretpass@db.host/x sk_live_abcdefghijklmnop1234');
assert.ok(!/vck_abc|abcdef123456|abcdefghijklmnop1234|s3cretpass|sk_live_abc/.test(r2) && /me:\[redacted\]@db\.host/.test(r2), r2);
assert.equal(redact('the token is in the header'), 'the token is in the header');

// end to end: two versions of one upload → two moments, the second with a visual diff and a region
const sharp = (await import('sharp')).default;
const { insert, get, all, now } = await import('../server/db.js');
const { startEngine, systemSource } = await import('../server/engine.js');
await import('../server/connectors/index.js');
const { captureUpload } = await import('../server/connectors/local.js');
startEngine();
insert('project', { id: 'p_test', workspace_id: 'ws', name: 'Checkout', brief: '', status: 'active', created_at: now(), updated_at: now() });
const png = (x) => sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).composite([{ input: { create: { width: 40, height: 40, channels: 3, background: '#000000' } }, left: x, top: 80 }]).png().toBuffer();
const up = systemSource('upload', 'Uploads');
const wait = async () => { for (let i = 0; i < 120; i++) { if (!get("SELECT COUNT(*) n FROM job WHERE status IN ('queued','running')").n && !get("SELECT COUNT(*) n FROM moment WHERE status='open'").n) return; await new Promise((r) => setTimeout(r, 250)); } throw new Error('engine never went idle'); };
captureUpload(up, { buf: await png(20), name: 'card.png', project_id: 'p_test', batch: 'b1', batch_size: 1, actor: 'tester' });
await wait();
captureUpload(up, { buf: await png(120), name: 'card.png', project_id: 'p_test', batch: 'b2', batch_size: 1, actor: 'tester' });
const dup = captureUpload(up, { buf: await png(120), name: 'card.png', project_id: 'p_test', batch: 'b3', batch_size: 1, actor: 'tester' });
assert.equal(dup[0].skipped, 'duplicate', 'same content twice is captured once');
await wait();
const ms = all("SELECT * FROM moment WHERE project_id='p_test' ORDER BY end_ts, created_at");
assert.equal(ms.length, 2, `moments: ${ms.map((m) => m.title).join(' / ')}`);
assert.ok(ms[1].basis.pixels > 1 && ms[1].basis.regions.length >= 1, JSON.stringify(ms[1].basis));
assert.ok(ms.every((m) => m.stage === 'ready' && m.route_confidence === 1 && m.title), 'routed and described');
assert.equal(get("SELECT COUNT(*) n FROM job WHERE status='dead'").n, 0, 'no dead jobs');

// the AI: JSON from a model that wraps it in fences or prose; no key means a plain message, not a call
const { parseJson, complete, personal, followUps, overlap, voice } = await import('../server/ai.js');
// case study: one answer repeating another is caught; the portfolio voice is first person, with no word of its sources
assert.ok(overlap('built with React three and gsap for the studio', 'the studio is built with React three and gsap') > 0.3 && overlap('a bottom glass bar for places', 'exports render from one clock') === 0);
assert.equal(voice('The team learned that budgets matter. It came from working notes. Fixes landed; the designer also adjusted it.'), 'I learned that budgets matter. Fixes landed; I also adjusted it.');
assert.equal(voice('The team compared films.', { solo: false }), 'The team compared films.');
assert.deepEqual(followUps('The pay button is teal.\n\n**Follow-ups:** Who reviewed it? | What is left?'), { text: 'The pay button is teal.', followups: ['Who reviewed it?', 'What is left?'] }, 'follow-ups split off the answer');
assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 }, 'fenced JSON');
assert.deepEqual(parseJson('Sure! {"insights":[]} hope that helps'), { insights: [] }, 'JSON inside prose');
assert.equal(parseJson('{"a":'), null, 'broken JSON is null, not a throw');
delete process.env.AI_GATEWAY_API_KEY;
await assert.rejects(complete({ messages: [] }), /Settings → AI/, 'no key: says where to add one');
assert.ok(personal('shorten this message for my landlord: rent is late') && personal('rewrite this email to my boss'), 'personal writing asks are filed out');
assert.ok(personal('bro how should we post our vercel thing') && !personal('post this comment on the issue'), 'social posts out, issue comments stay');
assert.ok(personal('tailor my resume to the jd') && !personal('tailor the resume page layout', { name: 'Resume builder' }), 'career asks are filed out, unless the project is about them');
assert.ok(!personal('shorten the button label copy on checkout') && !personal('rewrite PayButton.tsx') && !personal('make the pay button sticky'), 'work asks stay');

// a project's folders: search inside them, never secrets, never outside
const { writeFileSync: wf, mkdirSync: md } = await import('node:fs');
const { searchFiles, readFile, roots, SECRET } = await import('../server/folders.js');
const { update } = await import('../server/db.js');
const dir = mkdtempSync(path.join(os.tmpdir(), 'trace-folder-'));
md(path.join(dir, 'src')); md(path.join(dir, 'node_modules'));
wf(path.join(dir, 'src', 'PayButton.tsx'), 'export const PayButton = () => <button>Pay now</button>;\n');
wf(path.join(dir, '.env'), 'SECRET=pay now');
wf(path.join(dir, 'node_modules', 'x.js'), 'pay now');
update('project', 'p_test', { folders: [dir] });
const fp = get("SELECT * FROM project WHERE id='p_test'");
const found = searchFiles(fp, 'pay now');
assert.deepEqual(found.map((h) => h.rel), ['src/PayButton.tsx'], 'finds code, skips .env and node_modules');
assert.equal(found[0].line, 1);
assert.ok(SECRET.test(path.join(dir, '.env.local')) && SECRET.test('C:\\keys\\id_rsa') && !SECRET.test('src/env.ts'), 'secret file names');
assert.throws(() => readFile(fp, path.join(os.tmpdir(), 'elsewhere.txt')), /outside/, 'no reading outside the folders');
assert.throws(() => readFile(fp, '.env'), /secrets/, 'no reading secrets');
assert.throws(() => roots(fp, os.tmpdir()), /isn’t one of this project’s folders/, 'a folder scope stays inside');
assert.match(readFile(fp, 'src/PayButton.tsx').text, /Pay now/);

// history: a folder becomes versions; what was asked and why ride in the message; rolling back is a new version
const HX = await import('../server/history.js');
const st = HX.story('Asked by Syed: make the button blue\nWhy: the black one competed\nwith the title.\n\nTrace-Run: hr_1\nCo-Authored-By: Claude <noreply@anthropic.com>');
assert.equal(st.asked, 'make the button blue'); assert.equal(st.asker, 'Syed'); assert.equal(st.why, 'the black one competed with the title.');
// a project's own code never sees your keys; key files never go into a version; Trace answers only to its local name
process.env.SOME_API_KEY = 'x'; process.env.GH_TOKEN = 'x';
const pe = HX.projectEnv({ PORT: '1' });
assert.ok(!pe.SOME_API_KEY && !pe.GH_TOKEN && pe.PORT === '1' && pe.PATH === process.env.PATH);
assert.deepEqual(['.env', 'app/.env.local', 'id_rsa', 'cert.pem', '.env.example', 'src/env.ts'].map((f) => SECRET.test(f)), [true, true, true, true, false, false]);
const { hostOk } = await import('../server/api.js');
assert.deepEqual(['127.0.0.1:4317', 'localhost:4317', '[::1]:4317', 'evil.com', 'evil.com:4317', '127.0.0.1.nip.io:4317'].map(hostOk), [true, true, true, false, false, false]);
assert.equal(st.trailers['trace-run'][0], 'hr_1');
const repoDir = mkdtempSync(path.join(os.tmpdir(), 'trace-history-'));
wf(path.join(repoDir, 'index.html'), '<h1>One</h1>');
update('project', 'p_test', { folders: [repoDir] });
const hp = get("SELECT * FROM project WHERE id='p_test'");
const me = { name: 'Tester', email: 'tester@example.com' };
await HX.start(hp, me);
wf(path.join(repoDir, 'index.html'), '<h1>Two</h1>'); wf(path.join(repoDir, 'extra.css'), 'h1{}');
await HX.save(hp, { message: 'Second\n\nAsked: say two\nWhy: it is the second', user: me });
let hv = await HX.history(hp);
assert.equal(hv.versions.length, 2); assert.equal(hv.versions[0].asked, 'say two'); assert.equal(hv.versions[0].files, 2);
const lc = await HX.lastChanges(hp, ['index.html', 'extra.css', 'missing.txt']); // where a file comes from: its last commit and the ask
assert.equal(lc['index.html'].sha, hv.versions[0].sha); assert.equal(lc['index.html'].asked, 'say two'); assert.equal(lc['index.html'].asked_in, 'commit'); assert.ok(!lc['missing.txt']);
await HX.rollback(hp, hv.versions[1].sha, me);
hv = await HX.history(hp);
assert.equal(hv.versions.length, 3, 'rolling back adds a version'); assert.equal(hv.versions[0].rolled_back_to, hv.versions[2].sha);
const rj = await HX.rejected(hp); // the "no" list: a rollback undid "Second", which was asked for as "say two"
assert.equal(rj.length, 1); assert.equal(rj[0].tried[0].title, 'Second'); assert.equal(rj[0].tried[0].asked, 'say two');
assert.equal((await HX.file(hp, 'now', 'index.html')).text, '<h1>One</h1>');
assert.ok(!(await HX.files(hp, 'now')).includes('extra.css'), 'files added after the version are gone again');
assert.equal(HX.appOf(repoDir).kind, 'static');
// a new .env never goes into a version, a key in the ask never goes into git, and a site never serves its keys or .git
wf(path.join(repoDir, '.env'), 'SECRET=1'); wf(path.join(repoDir, 'note.txt'), 'n');
assert.equal((await HX.lastChanges(hp, ['note.txt']))['note.txt'].sha, 'now'); // not saved yet: changed now
await HX.save(hp, { message: 'Third\n\nAsked: use sk-ant-api03-abcdefghijklmnopqrstuv', user: me });
hv = await HX.history(hp);
assert.ok(!(await HX.files(hp, hv.versions[0].sha)).includes('.env') && (await HX.files(hp, hv.versions[0].sha)).includes('note.txt'), '.env stays out');
assert.ok(!/sk-ant-api03/.test(hv.versions[0].asked), hv.versions[0].asked);
await assert.rejects(HX.site(hp, 'now', '.env'), /No such file/); await assert.rejects(HX.site(hp, 'now', '.git/config'), /No such file/);

// frames: components found by themselves, joined through @/ aliases and index files, with the states they can show
const P = await import('../server/props.js');
const FR = await import('../server/frames.js');
const btnSrc = `import { cva, type VariantProps } from 'class-variance-authority';\nexport const buttonVariants = cva('x', { variants: { variant: { default: 'a', ghost: 'b' }, size: { sm: 'c', lg: 'd' } }, defaultVariants: { variant: 'default', size: 'lg' } });\nexport function Button({ variant, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) { return <button {...props} />; }\n`;
const bt = P.propTypes(btnSrc, 'Button');
assert.deepEqual(bt.unions, { variant: ['default', 'ghost'], size: ['lg', 'sm'] }, JSON.stringify(bt.unions));
assert.ok(bt.flags.includes('disabled') && bt.children, 'a native button can be disabled and takes a label');
assert.equal(P.propsFor('export function Badge({ children }: { children: React.ReactNode }) { return null }', 'Badge'), '{ "children": "Badge" }');
const appDir = mkdtempSync(path.join(os.tmpdir(), 'trace-frames-'));
md(path.join(appDir, 'src', 'ui'), { recursive: true });
wf(path.join(appDir, 'package.json'), '{ "scripts": { "dev": "vite" } }');
wf(path.join(appDir, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
wf(path.join(appDir, 'src', 'main.tsx'), "import App from './App';\n");
wf(path.join(appDir, 'src', 'App.tsx'), "import { Button as B } from '@/ui';\nfunction Toolbar() { return <B />; }\nexport default function App() { return <><Toolbar /><B /></>; }\n");
wf(path.join(appDir, 'src', 'ui', 'index.ts'), "export * from './button';\n");
wf(path.join(appDir, 'src', 'ui', 'button.tsx'), btnSrc);
update('project', 'p_test', { folders: [appDir] });
const ap = get("SELECT * FROM project WHERE id='p_test'");
await HX.start(ap, me);
const fd = await FR.discover(ap, 'now');
assert.deepEqual(fd.components.map((f) => `${f.name}:${f.depth}:${f.kind}:${f.exported}:${f.cat}`).sort(), ['App:0:screen:true:Layout', 'Button:1:component:true:Buttons', 'Toolbar:1:component:false:Navigation'], JSON.stringify(fd.components));
assert.deepEqual(fd.edges.map((e) => `${e.from.split('#')[1]}>${e.to.split('#')[1]}`).sort(), ['App>Button', 'App>Toolbar', 'Toolbar>Button'], 'per component: a neighbour in the file, an import alias, the @/ path and the index file');
assert.deepEqual(P.propTypes("type P = Omit<X, 'a'> & {\n  tone?: 'calm' | 'loud'\n  open?: boolean\n}\nexport function T({ tone }: P) { return null }", 'T').unions, { tone: ['calm', 'loud'] }, 'a props alias joined with &');
assert.deepEqual(P.importsOf("const Studio = lazy(() => import('./Studio'));")[0].locals, [], 'a lazy route has no local names (the Animation Engine crashed Frames)');
// packages: the range check behind the conflict list
for (const [have, range, ok] of [['1.2.3', '^1.0.0', true], ['2.0.0', '^1.0.0', false], ['0.2.5', '^0.2.1', true], ['0.3.0', '^0.2.1', false], ['1.2.9', '~1.2.0', true], ['1.3.0', '~1.2.0', false],
  ['18.3.1', '^18 || ^19', true], ['17.0.2', '>=16.8 <18', true], ['1.5.0', '1.0.0 - 1.4.0', false], ['3.1.0', 'workspace:*', true], ['', '^1', false]])
  assert.equal(HX.satisfies(have, range), ok, `${have} vs ${range}`);
// screens: what an app is built for, from how it lays out at desktop width
const { deviceOf } = await import('../server/screens.js');
assert.deepEqual([{ span: 560, bar: true }, { span: 600, bar: false }, { span: 900, bar: true }, { span: 900, bar: false }, { span: 1184, bar: false }].map(deviceOf), ['phone', 'phone', 'tablet', 'desktop', 'desktop']);
// the type scale: fluid sizes a fraction apart are one style, prices and chart labels aren't type, roles are named
const { typeScale } = await import('../server/screens.js');
const ts = (size, weight, sample, count = 5, tag = 'p', family = 'Inter') => ({ family, size: `${size}px`, weight: String(weight), lh: '20px', ls: 'normal', tt: 'none', tag, count, sample, r: [0, 0, 10, 10] });
const scale = typeScale([{ id: 's0', text: [ts(48, 700, 'Run further', 1, 'h1'), ts(17.2064, 400, 'Body copy here', 40), ts(17.2057, 400, 'More body copy', 12), ts(30, 900, '₹150', 1), ts(13, 500, 'Small print', 9), ts(12, 400, '', 8, 'text'), ts(14, 400, 'const x', 6, 'code', 'Geist Mono')] }]);
assert.deepEqual(scale.map((t) => `${t.role} ${t.size}`), ['Display 48px', 'Body 17px', 'Small 13px', 'Mono 14px'].sort((a, b) => parseFloat(b.split(' ').pop()) - parseFloat(a.split(' ').pop())));
assert.equal(scale.find((t) => t.role === 'Body').count, 52);
// pages the code names: Next's folders, React Router's paths, links; never dynamic ones, the API or files
const { routesIn } = await import('../server/frames.js');
assert.deepEqual(routesIn({ 'app/page.tsx': '', 'app/(shop)/cart/page.tsx': '', 'app/blog/[slug]/page.tsx': '', 'src/pages/about.tsx': 'export default 1', 'src/pages/_app.tsx': 'export default 1', 'src/App.jsx': '<Route path="/settings" /> { path: "/users/:id" } <Link to="/pricing">x</Link> fetch("/api/x") <a href="/logo.svg">' }), ['/about', '/cart', '/pricing', '/settings']);
// a range with a space after its operator is still that range: React 19 meets ">= 16.8"
assert.ok(HX.satisfies('19.3.0', '>= 16.8') && !HX.satisfies('19.3.0', '>= 17 < 19') && HX.satisfies('9.1.0', '^9 || ^10'));
// a project's kind, for its card's background
const { categoryOf } = await import('../server/category.js');
assert.deepEqual([{ name: 'swiggy clone' }, { name: 'running club site' }, { name: 'provider-guard', brief: 'An AI gateway dashboard' }, { name: 'portfolio v2' }, { name: 'Notes' }].map(categoryOf), ['Food & delivery', 'Sport & events', 'Tools & AI', 'Portfolio', 'Product']);
// a dropped folder: found where it is by its files, else copied in, and a copy never writes outside data/folders
const FO = await import('../server/folders.js');
const near = path.join(process.env.TRACE_DATA, 'code');
md(path.join(near, 'Shop-App', 'src'), { recursive: true }); wf(path.join(near, 'Shop-App', 'package.json'), '{"name":"shop"}'); wf(path.join(near, 'Shop-App', 'src', 'a.ts'), 'x');
assert.equal(FO.findOnDisk('shop-app', [{ path: 'package.json', size: 15 }, { path: 'src/a.ts', size: 1 }], [path.join(near, 'other')]), path.join(near, 'Shop-App'));
const copy = FO.newCopy('My App');
assert.equal(path.basename(copy), 'My-App');
assert.throws(() => FO.copyInto(copy, '../../escape.txt', Buffer.from('x')), /inside the copy/);
FO.copyInto(copy, 'src/b.ts', Buffer.from('y'));

// A page waiting for frames while another page is pictured isn't hung (cold walk: five clicks lost at 20 s); one that
// hangs with nothing being pictured still is, and nothing waits past 90 s.
const { givesUp } = await import('../server/cdp.js');
const ev = (waited, drawing, sinceDrawn) => givesUp({ method: 'Runtime.evaluate', waited, drawing, sinceDrawn });
assert.ok(ev(20000, 0, 1e9) && !ev(19000, 0, 1e9), 'a hang with nothing pictured: 20 s');
assert.ok(!ev(20000, 1, 0) && !ev(24000, 0, 2000), 'while a picture is drawn, and a moment after: still waited on');
assert.ok(ev(26000, 0, 6000) && ev(90000, 1, 0), 'once the picture is in, or 90 s in all: given up');
assert.ok(!givesUp({ method: 'Page.captureScreenshot', waited: 30000, drawing: 1, sinceDrawn: 0 }) && givesUp({ method: 'Page.captureScreenshot', waited: 60000, drawing: 1, sinceDrawn: 0 }), 'a long page’s picture gets 60 s');

// A tab click that didn't take (a slow dev server): checked again once the page settles, clicked once more, else not
// kept (false). A click on what isn't an option is one click and nothing read after it.
const { press } = await import('../server/screens.js');
const fakePage = (picks) => { const log = []; return { log, clicks: () => log.filter((x) => x === 'click').length, click: async () => { log.push('click'); }, eval: async (q) => { log.push(q.slice(0, q.indexOf('('))); return q.startsWith('__tw.picked') ? picks.shift() : q.startsWith('__tw.find') ? { x: 5, y: 5, on: false } : { fp: { tabs: [] } }; } }; };
const sideQuests = { role: 'tab', label: 'Side quests', set: 'x' }, unpicked = { x: 5, y: 5, on: false };
let pg = fakePage([false, false, false]);
assert.equal(await press(pg, sideQuests, unpicked, () => pg.eval('__tw.calm()')), false, 'never picked: not kept');
assert.equal(pg.clicks(), 2, 'clicked once more, not more');
pg = fakePage([false, true]);
assert.ok(await press(pg, sideQuests, unpicked, () => pg.eval('__tw.calm()')), 'picked once the page settled');
assert.equal(pg.clicks(), 1, 'a late pick is not clicked again (it would toggle a chip back)');
pg = fakePage([false, false, true]);
assert.ok(await press(pg, sideQuests, unpicked, () => pg.eval('__tw.calm()')), 'picked by the second click');
pg = fakePage([]);
assert.ok(await press(pg, { role: 'button', label: 'Menu' }, { x: 5, y: 5, on: null }, () => pg.eval('__tw.calm()')));
assert.deepEqual(pg.log, ['click', '__tw.calm'], 'not an option: nothing checked');

// Walking again after a change: only the screens that drew what changed (directly, or through a helper they use).
const { touched, changedIn } = await import('../server/screens.js');
const app = { entry: 'src/main.jsx', components: [{ file: 'src/App.jsx', name: 'App' }, { file: 'src/Card.jsx', name: 'Card' }, { file: 'src/Nav.jsx', name: 'Nav' }],
  imports: { 'src/main.jsx': ['src/App.jsx'], 'src/App.jsx': ['src/Card.jsx', 'src/Nav.jsx'], 'src/Card.jsx': ['src/price.js'], 'src/Nav.jsx': [], 'src/price.js': [] } };
const walked = [{ id: 's0', tree: [{ n: 'App' }, { n: 'Nav' }] }, { id: 's1', tree: [{ n: 'App' }, { n: 'Nav' }, { n: 'Card' }] }];
assert.deepEqual(touched(app, ['src/Card.jsx'], walked), ['s1']);
assert.deepEqual(touched(app, ['src/price.js'], walked), ['s1']); // a helper reaches the screen that draws its user
assert.deepEqual(touched(app, ['README.md', 'src/Card.test.jsx'], walked), []);
assert.equal(touched(app, ['src/index.css'], walked), null); // shared by every screen: all of them
assert.equal(touched(app, ['src/main.jsx'], walked), null);
assert.equal(touched(app, ['public/logo.png'], walked), null); // outside the code it read: can't tell, so all
assert.equal(touched(app, ['src/Card.jsx'], [{ id: 's0', tree: [] }]), null);
assert.deepEqual(changedIn({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' }).sort(), ['b', 'c', 'd']);

// Checks: colours compare across the ways Chrome writes them; a near miss is flagged, an exact or far value isn't;
// scope flags moved screens the ask doesn't name, and skips an ask that names nothing.
const CHK = await import('../server/check.js');
const dE = (a, b) => { const x = CHK.oklab(a).v, y = CHK.oklab(b).v; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
assert.ok(dE('lab(54.1736% 13.3368 -74.6839)', 'oklch(0.623 0.214 259.815)') < 0.1); // Tailwind's blue-500, two ways
assert.ok(dE('rgb(255, 255, 255)', 'color(srgb 1 1 1)') < 0.01);
assert.equal(CHK.oklab('rgba(0, 0, 0, 0.5)').alpha, 0.5);
const v = (prop, val, n, c = 'Card') => ({ prop, v: val, n, at: [{ c, r: [0, 0, 10, 10], t: 'x' }] });
const dr = CHK.drift([{ id: 's0', name: 'Home', values: [v('background', 'rgb(59, 130, 246)', 12), v('background', 'rgb(59, 131, 246)', 1, 'Promo'), v('background', 'rgb(200, 30, 30)', 1), v('radius', '8px', 9), v('radius', '7px', 1), v('space', '15.36px', 1), v('space', '16px', 8)], text: [] }]);
assert.deepEqual(dr.map((x) => [x.kind, x.value, x.near]), [['colour', '#3b83f6', '#3b82f6'], ['radius', '7px', '8px']]);
assert.equal(dr.find((x) => x.kind === 'colour').at[0].component, 'Promo');
const walkedS = [{ id: 's0', name: 'Home', tree: [{ n: 'Header' }, { n: 'Hero' }] }, { id: 's1', name: 'Pricing', from: 's0', tree: [{ n: 'Header' }, { n: 'PriceTable' }] }, { id: 's2', name: 'Checkout', from: 's1', tree: [{ n: 'Header' }, { n: 'CheckoutForm' }] }];
assert.deepEqual(CHK.scope('make the price table clearer', walkedS, ['s1', 's2']).outside.map((x) => x.name), ['Checkout']);
assert.deepEqual(CHK.scope('fix the hero spacing', walkedS, ['s0']).outside, []);
assert.ok(CHK.scope('make it pop', walkedS, ['s0']).skipped);
assert.ok(CHK.scope('price table', walkedS, null).skipped);
// The design against what runs: hex as Figma writes it; a value the design uses that the app draws almost, a token named
// on both sides with different values; rem and px are one length. Design values come from captured Figma frames.
assert.ok(dE('#3b82f6', 'rgb(59, 130, 246)') < 0.01); assert.equal(CHK.oklab('#00000080').alpha.toFixed(2), '0.50');
const usedD = CHK.usedOf([{ id: 's0', name: 'Home', values: [v('background', 'rgb(59, 130, 246)', 12), v('background', 'rgb(59, 131, 246)', 3, 'Promo'), v('radius', '7px', 2), v('space', '8px', 4)], text: [] }]);
const designD = [{ kind: 'colour', value: '#3b82f6', n: 6, when: 1 }, { kind: 'radius', value: '8px', n: 3, when: 1 }, { kind: 'colour', value: '#ff0000', name: 'color/brand', n: 0, when: 1 }, { kind: 'space', value: '0.5rem', name: 'spacing.sm', n: 0, when: 1 }];
const ag = CHK.against(designD, usedD, [{ name: '--color-brand', kind: 'color', value: '#fe0000', light: 'rgb(254, 0, 0)' }, { name: '--spacing-sm', kind: 'space', value: '8px' }]);
assert.deepEqual(ag.map((x) => [x.by, x.kind, x.code.value, x.design.value]), [['name', 'colour', '#fe0000', '#ff0000'], ['value', 'colour', '#3b83f6', '#3b82f6'], ['value', 'radius', '7px', '8px']]);
insert('asset', { id: 'as_fig', project_id: 'p_test', tool: 'figma', name: 'Home', latest_snapshot_id: 'sn_fig', created_at: 1000 });
insert('snapshot', { id: 'sn_fig', asset_id: 'as_fig', properties: JSON.stringify({ nodes: { a: { name: 'Button', fills: ['#3b82f6'], radius: 8 }, b: { name: 'Link', fills: ['#3b82f6'], layout: { gap: 12, padding: [8, 16, 8, 16] } } }, variables: { 'color/brand': '#ff0000' } }), created_at: 1000 });
insert('moment', { id: 'mo_fig', project_id: 'p_test', end_ts: 5000 }); insert('change', { id: 'ch_fig', moment_id: 'mo_fig', asset_id: 'as_fig', path: 'Button › fills', after: '#3b82f6' });
const dz = CHK.designOf('p_test'), dv = (kind, value) => dz.find((x) => x.kind === kind && x.value === value);
assert.equal(dv('colour', '#3b82f6').n, 2); assert.equal(dv('colour', '#3b82f6').when, 5000); // the change that set it
assert.equal(dv('colour', '#ff0000').name, 'color/brand'); assert.equal(dv('colour', '#ff0000').when, 1000); // never changed since captured
assert.ok(dv('space', '12px') && dv('space', '16px') && dv('radius', '8px'));
// States inventory: branches read from a component's own conditions; a state is seen when a walk drew it (a prop set, or
// an Empty/Problem/Skeleton inside it), designed when a Figma name has the component's name and the state's.
const PR = await import('../server/props.js');
assert.deepEqual(PR.branchesIn('if (loading) return <Spin/>; return error ? <Problem/> : items.length === 0 ? <Empty/> : <List/>'), ['loading', 'error', 'empty']);
assert.deepEqual(PR.branchesIn('fetch(u).catch((err) => log(err)); return <img loading="lazy" alt={a?.b} />'), []);
const inv = CHK.inventory([{ name: 'Checkout', file: 'src/Checkout.tsx', states: { branches: ['loading', 'error', 'empty'], flags: ['disabled'], unions: { size: ['md', 'lg'] } } }],
  [{ name: 'Checkout', tree: [{ n: 'Checkout', p: -1, props: {} }, { n: 'Empty', p: 0, props: {} }] }], ['Checkout / Loading']);
const stOf = (k) => inv[0].states.find((x) => x.state === k);
assert.ok(stOf('empty').seen && !stOf('error').seen && stOf('loading').designed && !stOf('error').designed);
assert.ok(!stOf('disabled').seen && stOf('size: md').seen && !stOf('size: lg').seen && !stOf('size: lg').designed); // the first variant is the default
// Flip-flops: a value put back at the same place (a size and a colour changing on one line are told apart; a CSS line
// starting "--" is content, not a diff header); by two hands it's undecided; a revert isn't a flip.
const gc = (sha, an, subject, body, patch) => `\x1e${sha.repeat(40)}\x1f${an}\x1f${an}@x.com\x1f1700000000\x1f${subject}\x1f${body}\x1d\n\n${patch}`;
const gp = (file, a, b) => `diff --git a/${file} b/${file}\nindex 1..2 100644\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-${a}\n+${b}\n`;
const gl = (size, colour) => `<p className="${size} font-medium ${colour}">Syed Ali</p>`;
const fl = CHK.flips([
  gc('a', 'Syed', 'Bigger name', '', gp('src/Hero.tsx', gl('text-xl', 'text-[#979797]'), gl('text-2xl', 'text-[#979797]')) + gp('src/x.css', '--gap: 12px;', '--gap: 16px;')),
  gc('b', 'Syed', 'Rework nav', 'Co-Authored-By: Claude <noreply@anthropic.com>', gp('src/Hero.tsx', gl('text-2xl', 'text-[#979797]'), gl('text-xl', 'text-foreground'))),
  gc('d', 'Syed', 'Tighter', '', gp('src/x.css', '--gap: 16px;', '--gap: 12px;')),
  gc('c', 'Syed', 'Revert "Rework nav"', '', gp('src/Hero.tsx', gl('text-xl', 'text-foreground'), gl('text-2xl', 'text-[#979797]'))),
].join(''), { agentOf: (an, ae, s) => ((s.trailers['co-authored-by'] || []).length ? 'Claude' : null) });
assert.deepEqual(fl.map((x) => [x.file, x.values.join(' '), x.undecided]), [['src/Hero.tsx', 'text-xl text-2xl text-xl', true], ['src/x.css', '12px 16px 12px', false]]);
// check_change, as an agent (or Trace AI) calls it: the walk's near miss comes back with a fix written out; once a person
// marks it as meant, it doesn't come back.
md(path.join(process.env.TRACE_DATA, 'screens', 'p_test'), { recursive: true });
wf(path.join(process.env.TRACE_DATA, 'screens', 'p_test', 'now.json'), JSON.stringify({ at: Date.now(), screens: [{ id: 's0', name: 'Home', fp: { path: '/' }, steps: [], tree: [], text: [], values: [v('background', 'rgb(59, 130, 246)', 12), v('background', 'rgb(59, 131, 246)', 1, 'Promo')] }] }));
const { aiTools } = await import('../server/mcp.js');
const ccall = async () => JSON.parse(await aiTools({ token: { name: 'test' }, origin: '', canWrite: false }).call('check_change', { project: 'p_test', ask: 'make the hero bigger' }));
let cc = await ccall();
assert.equal(cc.verdict, 'needs a look'); assert.match(cc.findings.find((x) => x.kind === 'drift').fix, /#3b82f6 instead of #3b83f6/);
assert.ok(cc.findings.findIndex((x) => x.kind === 'design') < cc.findings.findIndex((x) => x.kind === 'drift')); // the Figma frame captured above disagrees too, and comes first
const ckq = await CHK.queue(get("SELECT * FROM project WHERE id='p_test'"), 'now');
insert('decision', { id: 'de_meant', project_id: 'p_test', text: 'It’s meant', source_type: 'check', source_id: ckq.items.find((x) => x.kind === 'drift').key, status: 'confirmed', created_at: now() });
cc = await ccall();
assert.ok(!cc.findings.some((x) => x.kind === 'drift')); assert.equal(cc.decided_by_people, 1);
// DESIGN.md and DTCG tokens from the walk: the colours drawn, most first, and the decisions.
const dd = await CHK.designDoc(get("SELECT * FROM project WHERE id='p_test'"), 'now');
assert.match(dd.files[0].content, /^# Design: Checkout/); assert.match(dd.files[0].content, /#3b82f6 \(12×\), #3b83f6 \(1×\)/); assert.match(dd.files[0].content, /## Decisions\n\n- It’s meant/);
assert.equal(JSON.parse(dd.files[1].content).$description.includes('DTCG 2025.10'), true);
// A decision that knows what it governs: "keep text-2xl" there is broken by the flip back to text-xl; "keep text-xl" isn't.
const keep = (value) => ({ id: `de_${value}`, text: `Keep ${value}`, governs: { kind: 'value', file: 'src/Hero.tsx', in: null, value } });
assert.deepEqual(CHK.broken([keep('text-2xl'), keep('text-xl'), { id: 'de_x', text: 'plain words' }], fl).map((b) => [b.decision.id, b.nowIs]), [['de_text-2xl', 'text-xl']]);
// The insight engine over the chats: a no with what it was said to, a yes, a rule for good, causes from the reply and
// from the reasoning (not a guess), a result in numbers; a pasted error isn't a rule and "bro" isn't shouting.
const CH = await import('../server/chats.js');
const ex = (at, ask, replies = [], thinking = [], files = []) => ({ at, ask, replies, thinking, files: new Set(files) });
const ins = CH.insightsOf([
  ex(1, 'make the hero name bigger', ['Done. The hero name is now 48px.'], ['The issue is that Hero.tsx sets text-2xl on mobile.', 'It is probably the wrapper, I think.'], ['C:/app/src/Hero.tsx']),
  ex(2, 'bro its still bad, why is the name cut on mobile', ['The root cause was overflow: hidden on the wrapper. Load time went from 4.8 s to 1.2 s.']),
  ex(3, 'bro its good now, dont use strokes anywhere in the site. Error: Scripts are never executed in "Hero.tsx"'),
], 'test');
const kinds = (k) => ins.filter((x) => x.kind === k).map((x) => x.text);
assert.deepEqual(kinds('correction'), ['bro its still bad, why is the name cut on mobile']);
assert.equal(ins.find((x) => x.kind === 'correction').of, 'Done. The hero name is now 48px.');
assert.equal(kinds('approval').length, 1); assert.deepEqual(kinds('rule'), ['bro its good now, dont use strokes anywhere in the site.']);
assert.deepEqual(kinds('cause'), ['The issue is that Hero.tsx sets text-2xl on mobile.', 'The root cause was overflow: hidden on the wrapper.']);
assert.deepEqual(kinds('result'), ['Load time went from 4.8 s to 1.2 s.']);
assert.ok(ins.every((x) => x.score < 4)); // nothing here was said loudly
// Files: what each one is to the person (the real cases that crowded the list), and the same file twice shown once.
const { roleOf, sortFiles } = await import('../server/relevance.js');
const role = (path, type = 'image', extra = {}) => { const r = roleOf({ path, name: path.split('/').pop(), type, tool: 'folder', ...extra }); return r.group === 'hidden' ? r.why : r.group; };
assert.equal(role('_figma/shadow/node-1422.svg'), 'A tool’s export or build output');
assert.equal(role('src/Home.tsx', 'code'), 'code'); assert.equal(role('src/lib/utils.ts', 'code'), 'Code that draws nothing (helpers, data, scripts)');
assert.equal(role('src/app/favicon.ico'), 'assets'); assert.equal(role('src/assets/shoe.png', 'image', { width: 1200, height: 900 }), 'assets');
assert.equal(role('.mise.toml', 'file'), 'Setup and config'); assert.equal(role('b6485ebf48065bc42988648c0a1283f50084c30dc5f518d655a3cece5379e365.png'), 'A generated file');
assert.equal(role('public/anim/fonts/i7dPIFZ9Zz-WBtRtedDbUEY.ttf', 'font'), 'A font file (its type is in the design system)'); assert.equal(role('assets/index-CoEQLbP2.js', 'code'), 'A generated file'); assert.equal(role('src/icons/x.png', 'image', { width: 24, height: 24 }), 'An icon or small graphic');
assert.equal(role('design/hero-v2.png', 'image', { width: 1440, height: 900 }), 'design'); assert.equal(role('docs/brief.md', 'doc'), 'design');
assert.deepEqual(sortFiles([{ name: 'a.png', path: 'a.png', type: 'image', tool: 'upload', file_key: 'k', updated_at: 2 }, { name: 'b.png', path: 'b.png', type: 'image', tool: 'upload', file_key: 'k', updated_at: 1 }]).map((x) => x.group), ['design', 'hidden']);
// A deck's numbers, from the real sentences: a result, a setting that changed (not a result), and the size of a
// problem a fix removed (which would read backwards as before → after).
const DK = await import('../server/deck.js');
const st1 = DK.stat("It now loads one icon at a time, which cut the app's code from 26.9 MB to 9.8 MB.");
assert.deepEqual([st1.from, st1.to, st1.weight], ['26.9 MB', '9.8 MB', 2]);
assert.equal(DK.stat('the logo fills the box, and scale went 5 → 8, so it reads'), null);
assert.equal(DK.stat('In one test, moving a frame dropped the editor from 144 to 19 fps, and this layer fixed it.'), null);
assert.equal(DK.stat('Result: the cut score on invented films went from 46 to 92, with zero abrupt cuts.').to, '92');
// The matcher: a Figma frame as the connector keeps it (1440 wide) against a walked screen (1280): it pairs by shared
// words; a size that scaled with the width is no difference, a weight and the corners are; reworded and missing words.
const MT = await import('../server/match.js');
const fig = MT.fromFigma({ id: 'as_hero', name: 'Hero', properties: { root: { w: 1440, h: 900 }, nodes: {
  bg: { name: 'Hero', type: 'FRAME', x: 0, y: 0, w: 1440, h: 900, fills: ['#000000'] },
  card: { name: 'Card', type: 'RECTANGLE', x: 100, y: 100, w: 500, h: 260, fills: ['#ffffff'], radius: 12 },
  t1: { name: 'Title', type: 'TEXT', x: 124, y: 124, w: 400, h: 52, text: 'Every match an episode', font: { family: 'Barlow Condensed', size: 48, weight: 700, lineHeight: 52 }, fills: ['#111111'] },
  t2: { name: 'Body', type: 'TEXT', x: 124, y: 200, w: 300, h: 24, text: 'Shop the line-up today', font: { family: 'Inter', size: 16, weight: 400 }, fills: ['#444444'] },
  t3: { name: 'Note', type: 'TEXT', x: 124, y: 300, w: 300, h: 24, text: 'Free delivery over 999', font: { family: 'Inter', size: 14, weight: 400 }, fills: ['#444444'] } } } });
const el = (t, r, o = {}) => ({ t, r, font: 'Inter', size: 16, weight: 400, lh: null, ls: 0, color: 'rgb(68, 68, 68)', c: 'Hero', box: { r: [89, 1089, 444, 231], fill: 'rgb(255, 255, 255)', radius: 8, pad: [0, 0, 0, 0] }, ...o });
const scr = MT.fromScreen({ id: 's0', name: 'Home', fp: { path: '/' }, w: 1280, h: 4000, els: [
  el('Every match an episode', [110, 1110, 356, 46], { font: 'Barlow Condensed Variable', size: 42.67, weight: 600, lh: 46.2, color: 'rgb(17, 17, 17)' }),
  el('Shop the lineup today', [110, 1178, 267, 21]), el('Our story', [110, 2400, 100, 20], { box: null })] });
const other = MT.fromScreen({ id: 's1', name: 'Cart', fp: { path: '/cart' }, w: 1280, h: 900, els: [el('Your cart is empty', [10, 10, 100, 20])] });
assert.deepEqual(MT.pairs([fig], [other, scr]).map((x) => x.screen?.id), ['s0']);
const cmp = MT.compare(fig, scr);
assert.deepEqual(cmp.diffs.map((d) => [d.t.split(' ')[0], d.prop, d.ref, d.now]), [['Every', 'weight', '700', '600'], ['Every', 'radius', '12px', '8px']]);
assert.deepEqual(cmp.reworded.map((x) => x.now), ['Shop the lineup today']); assert.deepEqual(cmp.missing.map((x) => x.t), ['Free delivery over 999']);
assert.equal(cmp.at[1], 1000); // the frame is the part of the page that starts 1,000 px down
const was = MT.fromScreen({ id: 's0', name: 'Home', fp: { path: '/' }, w: 1280, h: 4000, els: [el('Every match an episode', [110, 1110, 356, 46], { size: 40 })] });
const vs = MT.compare(was, scr); // two walks: the same words, a size that changed, words that are new
assert.ok(vs.diffs.some((d) => d.prop === 'size' && d.ref === '40px' && d.now === '42.7px')); assert.deepEqual(vs.added.map((x) => x.t), ['Shop the lineup today', 'Our story']);
// From the portfolio's real walks: tabs of one page pair with their own state, not the first screen at that address; a
// clock is no change; a panel that moved down keeps its two same-named rows apart; the header's row losing its line is
// told as the line, and its new colour as the header's (what the words sit on), not as a fill the row gained.
const nav = (o) => ('line' in o
  ? { box: { r: [0, 0, 1280, 64], fill: 'rgb(3, 3, 3)', radius: 0, pad: [0, 0, 0, 0], border: null }, bg: { c: 'rgb(3, 3, 3)', r: [0, 0, 1280, 64] } }
  : { box: { r: [220, 0, 840, 64], fill: null, radius: 0, pad: [12, 20, 12, 20], border: 'rgb(57, 57, 61)' }, bg: { c: 'rgb(9, 9, 11)', r: [0, 0, 1280, 64] } });
const page = (name, extra, o = {}) => MT.fromScreen({ id: name, name, fp: { path: '/' }, w: 1280, h: 3000, els: [el('Syed Ali portfolio home', [240, 20, 300, 30], nav(o)), el(o.clock || '5:54 PM IST', [1100, 20, 90, 20]), el('Projects about work', [40, 400, 300, 30]), ...extra] });
const row = (y, w, a) => [el('Manage webhooks', [1070, y, 136, 38], { weight: w, color: `rgba(255, 255, 255, ${a})` }), el(`Settings ${y}`, [1070, y + 60, 136, 38])];
const base = [page('Home', []), page('Inside my brain', [el('Notes and references', [40, 900, 300, 30])])];
const head = [page('Home', [], { line: null, clock: '5:52 PM IST' }), page('Inside my brain dialog', [el('Notes and references', [40, 900, 300, 30])], { line: null, clock: '5:52 PM IST' })];
assert.deepEqual(MT.pairs(base, head).map((x) => x.screen.id), ['Home', 'Inside my brain dialog']);
assert.deepEqual(MT.pairs(base, [head[0]], { one: true }).map((x) => x.screen?.id || null), ['Home', null]); // between walks one to one: a state the other walk lacks isn't covered by home
// The prototype as the acceptance test: production's other pages share the header and hero words with the prototype's
// tab states, but not what makes each state that state (its panel's words), so they don't cover them.
const tabState = (name, words) => page(name, [el(words, [40, 900, 300, 30])]);
const cov = MT.pairs([page('Home', []), tabState('Experience dialog', 'Experience timeline coming soon'), tabState('Side quests dialog', 'Side projects coming soon')],
  [page('Home', []), tabState('Chill', 'Chill vibes coming soon'), tabState('Music', 'Music playlist coming soon'), tabState('Experience', 'My experience timeline coming soon')], { one: true });
assert.deepEqual(cov.map((x) => x.screen?.id || null), ['Home', 'Experience', null]);
const tab = MT.compare(base[1], head[1]);
assert.deepEqual(tab.diffs.map((d) => [d.prop, d.ref, d.now]), [['fill', '#09090b', '#030303'], ['border', '#39393d', 'none']]); assert.deepEqual([tab.reworded.length, tab.missing.length, tab.added.length], [0, 0, 0]);
const moved = MT.compare(page('P', [...row(1496, 400, 0.5), ...row(1222, 500, 1)]), page('P', [...row(2097, 400, 0.5), ...row(1823, 500, 1)].map((x) => ({ ...x, t: x.t.replace(/\d+$/, (n) => +n - 601) }))));
assert.deepEqual([moved.matched, moved.diffs.length], [7, 0]);
const dlg = page('Settings dialog', []); dlg.texts = dlg.texts.map((x, i) => (i ? { ...x, r: [x.r[0], x.r[1] + 911, x.r[2], x.r[3]] } : x)); // the same words, the page scrolled under its fixed header
assert.equal(MT.pairs([page('Hero', [])], [dlg, page('Home', [])])[0].screen.id, 'Home');
// The stress walk's "no data": every list in a JSON answer emptied, everything else kept.
const ST = await import('../server/stress.js');
assert.deepEqual(ST.emptied({ items: [1, 2], meta: { tags: ['a'], total: 2 }, name: 'x' }), { items: [], meta: { tags: [], total: 2 }, name: 'x' });
assert.deepEqual(ST.emptied([{ a: 1 }]), []);

// Rules from what a person said no to: a look as a code pattern, a thing not to touch as its words; checked against
// the lines a change adds and the files it changes, and allowed when the ask names it.
{
  const R = await import('../server/check.js');
  assert.deepEqual(R.ruleOf('bro no gradients anywhere'), { kind: 'avoid', id: 'gradient', label: 'gradients' });
  assert.deepEqual(R.ruleOf("don't use glass or gloss effects"), { kind: 'avoid', id: 'glass', label: 'glass and blur' });
  assert.equal(R.ruleOf('add a gradient behind the hero'), null); // a look asked for, not said no to
  assert.deepEqual(R.ruleOf("don't change the nav bar icons (you, 28 Oct)"), { kind: 'protect', words: ['nav', 'bar', 'icons'], label: 'nav bar icons' });
  assert.equal(R.ruleOf("don't change anything"), null);
  assert.equal(R.ruleKey({ kind: 'protect', words: ['icons', 'nav'] }), 'protect|icon nav');
  const rules = [{ id: 'de1', text: 'No gradients', governs: { kind: 'avoid', id: 'gradient', label: 'gradients' } }, { id: 'de2', text: "Don't change the nav icons", governs: { kind: 'protect', words: ['nav', 'icons'], label: 'nav icons' } }];
  const change = { added: [{ file: 'src/Hero.tsx', line: '<div className="bg-linear-to-r from-sky-500 to-indigo-500">' }, { file: 'src/Hero.tsx', line: '<h1>Hi</h1>' }], changed: ['src/Hero.tsx', 'src/components/NavRail.tsx'] };
  const comps = [{ file: 'src/components/NavRail.tsx', name: 'NavIcon' }];
  const out = R.ruleBreaks(rules, change, 'make the hero brighter', comps);
  assert.deepEqual(out.map((x) => [x.kind, x.files]), [['avoid', ['src/Hero.tsx']], ['protect', ['src/components/NavRail.tsx']]]);
  assert.equal(out[0].n, 1);
  const gloss = [{ id: 'g', text: 'No glow', governs: { kind: 'avoid', id: 'gloss', label: 'gloss and glow' } }];
  assert.equal(R.ruleBreaks(gloss, { added: [{ file: 'a.css', line: 'box-shadow: 0 0 24px rgba(99,102,241,.6);' }], changed: ['a.css'] }).length, 1);
  assert.equal(R.ruleBreaks(gloss, { added: [{ file: 'a.ts', line: 'const p = { glow: 0 };' }, { file: 'a.css', line: 'box-shadow: 0 2px 8px rgba(0,0,0,.1);' }, { file: 'a.css', line: '// the glow layer' }], changed: ['a.css'] }).length, 0);
  assert.deepEqual(R.ruleBreaks(rules, change, 'swap the nav icons for outlined ones', comps).map((x) => x.kind), ['avoid']); // asked for: allowed
}

// The design canvas: a property change becomes the Tailwind class that gives it and the ones it replaces (a project
// token by name when one matches), or CSS when the element isn't drawn with utility classes.
{
  const D = await import('../server/design.js');
  assert.deepEqual(D.codeFor('padding-top', '16px', 'flex items-center py-3 px-4'), { css: 'padding-top: 16px', tw: { add: 'pt-4 pb-3', replace: ['py-3'] } });
  assert.deepEqual(D.codeFor('font-size', '28px', 'text-xl font-medium text-foreground').tw, { add: 'text-[28px]', replace: ['text-xl'] });
  assert.deepEqual(D.codeFor('color', 'rgb(59, 130, 246)', 'text-sm text-muted-foreground').tw, { add: 'text-[#3b82f6]', replace: ['text-muted-foreground'] }); // the size class stays
  assert.deepEqual(D.codeFor('background-color', 'rgb(59, 130, 246)', 'bg-card p-4', [{ name: '--color-brand', kind: 'color', value: '#3b82f6' }]).tw, { add: 'bg-brand', replace: ['bg-card'] });
  assert.deepEqual(D.codeFor('border-radius', '12px', 'rounded-full border').tw, { add: 'rounded-xl', replace: ['rounded-full'] });
  assert.deepEqual(D.codeFor('gap', '24px', 'nav-link'), { css: 'gap: 24px' }); // a class of its own, not a utility
  assert.deepEqual(D.codeFor('font-size', '16px', 'text-base', [], 14).tw, { add: 'text-[16px]', replace: ['text-base'] }); // a 14px rem: text-base is 14px there
  assert.deepEqual(D.codeFor('padding-top', '14px', 'py-3', [], 14).tw, { add: 'pt-4 pb-3', replace: ['py-3'] });
  assert.match(D.briefOf([{ comp: 'Hero', tag: 'p', text: 'Syed Ali', file: 'src/Hero.tsx', line: 95, prop: 'font-size', from: '20px', to: '28px', tw: { add: 'text-[28px]', replace: ['text-xl'] } }]), /Hero \(“Syed Ali”\) in src\/Hero\.tsx:95: font-size 20px → 28px\. Tailwind: use text-\[28px\] instead of text-xl\./);
}

// Feedback that closes on evidence: a part on a screen, before and after, and what changed in words. Nothing changed:
// nothing to say, so the comment stays open.
{
  const EV = await import('../server/evidence.js');
  const screen = (size, text) => ({ id: 's0', steps: [{ label: 'Projects' }], w: 1280, h: 900, shot: 'f1', tree: [{ n: 'Hero', r: [10, 20, 200, 40], t: text, props: { tone: 'calm' } }, { n: 'Nav', r: [0, 0, 1280, 60], t: 'Home', props: {} }], values: [{ prop: 'space', v: size, n: 2, at: [{ c: 'Hero' }] }, { prop: 'color', v: 'rgb(0, 0, 0)', n: 9, at: [{ c: 'Nav' }] }] });
  assert.equal(EV.keyOf(screen()), 'Projects');
  const a = EV.snapOf(screen('16px', 'Syed Ali'), 'Hero'), b = EV.snapOf(screen('24px', 'Syed Ali'), 'Hero');
  assert.deepEqual(a.values, { space: ['16px'] }); // the Nav's colour isn't the Hero's
  assert.deepEqual(EV.diffOf(a, b), ['space 16px → 24px']);
  assert.deepEqual(EV.diffOf(a, EV.snapOf(screen('16px', 'Syed Ali'), 'Hero')), []);
  assert.deepEqual(EV.diffOf(a, EV.snapOf(screen('16px', 'Syed'), 'Hero')), ['text “Syed Ali” → “Syed”']);
  assert.equal(EV.snapOf(screen(), 'Footer'), null); // not on this screen: no evidence either way
}

// Writing a canvas edit into its line: classes swapped (a shorthand's other side and a variant kept), words replaced
// once; any other line is left alone.
{
  const D = await import('../server/design.js');
  const pad = { prop: 'padding-top', cls: 'flex py-3 px-4', tw: D.codeFor('padding-top', '16px', 'flex py-3 px-4').tw };
  assert.deepEqual(pad.tw, { add: 'pt-4 pb-3', replace: ['py-3'] });
  assert.equal(D.rewrite('<div className="flex py-3 px-4">', pad), '<div className="flex pt-4 pb-3 px-4">');
  assert.equal(D.rewrite('<p className="md:text-sm">', { prop: 'font-size', cls: 'md:text-sm', tw: { add: 'text-[15px]', replace: ['md:text-sm'] } }), '<p className="md:text-[15px]">');
  assert.equal(D.rewrite('<p className="a">Syed Ali</p>', { prop: 'text', from: 'Syed Ali', to: 'Syed W. Ali' }), '<p className="a">Syed W. Ali</p>');
  assert.equal(D.rewrite('<p>Hi</p><p>Hi</p>', { prop: 'text', from: 'Hi', to: 'Hey' }), null); // twice on the line: not sure which
  assert.equal(D.rewrite('<p className="text-xl">Hi</p>', { prop: 'font-size', cls: 'text-lg', tw: { add: 'text-2xl', replace: ['text-lg'] } }), null);
}

console.log('selfcheck: all good');
process.exit(0);
