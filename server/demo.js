// Sample workspace. Everything goes through the real engine: a structured sample design file (frames with
// node properties, like Figma gives), uploads with and without a project, token files; then comments,
// decisions, references, an issue, an exploration with a proposal and an agent's artifact on top.
import sharp from 'sharp';
import { get, insert, update, now, uid, mapActor } from './db.js';
import { registerConnector, systemSource, ingest, ftsPut, updateCentroid } from './engine.js';
import { captureUpload } from './connectors/local.js';

const day = 86400000;
const T = (o) => ({ type: 'TEXT', ...o });
const F = (o) => ({ type: 'FRAME', ...o });

function checkout(v) {
  const head = { family: v >= 3 ? 'Georgia' : 'Segoe UI', size: 28, weight: v >= 2 ? 700 : 600 };
  const body = v >= 2 ? 14 : 16;
  const cardY = v >= 3 ? 112 : 124;
  const nodes = {
    '1:2': T({ name: 'Title', x: 24, y: 64, w: 260, h: 36, text: 'Checkout', font: head, fills: ['#111113'] }),
    '1:3': F({ name: 'Order summary', x: 24, y: cardY, w: 342, h: 200, fills: ['#f4f4f5'], radius: 12 }),
    '1:4': T({ name: 'Item 1', x: 40, y: cardY + 24, w: 200, h: 22, text: 'Linen shirt', font: { family: 'Segoe UI', size: body, weight: 400 }, fills: ['#111113'] }),
    '1:5': T({ name: 'Price 1', x: 290, y: cardY + 24, w: 60, h: 22, text: '$32.00', font: { family: 'Segoe UI', size: body, weight: 400 }, fills: ['#111113'] }),
    '1:6': T({ name: 'Item 2', x: 40, y: cardY + 64, w: 200, h: 22, text: 'Canvas tote', font: { family: 'Segoe UI', size: body, weight: 400 }, fills: ['#111113'] }),
    '1:7': T({ name: 'Price 2', x: 290, y: cardY + 64, w: 60, h: 22, text: '$10.00', font: { family: 'Segoe UI', size: body, weight: 400 }, fills: ['#111113'] }),
    '1:8': T({ name: 'Total', x: 40, y: cardY + 150, w: 300, h: 24, text: 'Total   $42.00', font: { family: 'Segoe UI', size: body + 2, weight: 600 }, fills: ['#111113'] }),
    '1:11': T({ name: 'Body', x: 24, y: v >= 3 ? 340 : 430, w: 342, h: 22, text: v >= 2 ? 'Pay securely with card, Apple Pay or wallet.' : 'Pay securely with card or wallet.', font: { family: 'Segoe UI', size: body, weight: 400 }, fills: ['#52525b'] }),
    '1:12': F({ name: 'Pay button', x: 24, y: 740, w: 342, h: 56, fills: [v >= 2 ? '#2b59ff' : '#111113'], radius: v >= 2 ? 12 : 8 }),
    '1:13': T({ name: 'Pay button label', x: 24, y: 755, w: 342, h: 24, text: v >= 2 ? 'Pay $42.00' : 'Pay now', font: { family: 'Segoe UI', size: 17, weight: 600 }, fills: ['#ffffff'], center: true }),
  };
  if (v < 3) {
    nodes['1:9'] = F({ name: 'Promo banner', x: 24, y: 344, w: 342, h: 56, fills: ['#fef3c7'], radius: 8 });
    nodes['1:10'] = T({ name: 'Promo text', x: 40, y: 361, w: 300, h: 20, text: 'Free shipping over $50', font: { family: 'Segoe UI', size: 14, weight: 500 }, fills: ['#92400e'] });
  } else {
    nodes['1:14'] = F({ name: 'Apple Pay button', x: 24, y: 668, w: 342, h: 56, fills: ['#000000'], radius: 12 });
    nodes['1:15'] = T({ name: 'Apple Pay label', x: 24, y: 683, w: 342, h: 24, text: 'Apple Pay', font: { family: 'Segoe UI', size: 17, weight: 600 }, fills: ['#ffffff'], center: true });
  }
  return { w: 390, h: 844, bg: '#ffffff', nodes };
}

function onboarding(v) {
  const dark = v >= 3;
  const ink = dark ? '#f2f2f3' : '#111113';
  return {
    w: 390, h: 844, bg: dark ? '#0d0d0e' : '#ffffff',
    nodes: {
      '2:2': F({ name: 'Illustration', x: 95, y: 150, w: 200, h: 200, fills: [v >= 2 ? (dark ? '#4c3d0a' : '#fde68a') : '#c7d2fe'], radius: 100 }),
      '2:3': T({ name: 'Headline', x: 24, y: 400, w: 342, h: 34, text: 'Welcome to Fieldnote', font: { family: 'Segoe UI', size: 26, weight: 600 }, fills: [ink] }),
      '2:4': T({ name: 'Body', x: 24, y: 450, w: 342, h: 22, text: v >= 2 ? 'Your notes, decisions and files, together.' : 'Keep every idea in one place.', font: { family: 'Segoe UI', size: 16, weight: 400 }, fills: [dark ? '#b4b4ba' : '#52525b'] }),
      '2:5': F({ name: 'CTA', x: 24, y: 740, w: 342, h: 56, fills: [dark ? '#f2f2f3' : '#111113'], radius: 8 }),
      '2:6': T({ name: 'CTA label', x: 24, y: 755, w: 342, h: 24, text: v >= 2 ? 'Create your account' : 'Get started', font: { family: 'Segoe UI', size: 17, weight: 600 }, fills: [dark ? '#111113' : '#ffffff'], center: true }),
    },
  };
}

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
function svgOf(frame) {
  const els = Object.values(frame.nodes).map((n) => {
    if (n.type === 'TEXT') {
      const x = n.center ? n.x + n.w / 2 : n.x;
      return `<text x="${x}" y="${n.y + n.font.size}" ${n.center ? 'text-anchor="middle"' : ''} font-family="${n.font.family}, Arial, sans-serif" font-size="${n.font.size}" font-weight="${n.font.weight}" fill="${n.fills[0]}">${esc(n.text)}</text>`;
    }
    return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.radius || 0}" fill="${n.fills[0]}"/>`;
  });
  // shapes first, then text, the way a designer layers them
  els.sort((a, b) => (a.startsWith('<text') ? 1 : 0) - (b.startsWith('<text') ? 1 : 0));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.w}" height="${frame.h}"><rect width="100%" height="100%" fill="${frame.bg}"/>${els.join('')}</svg>`;
}
const png = (frame, scale = 2) => sharp(Buffer.from(svgOf(frame)), { density: 72 * scale }).png().toBuffer();
const props = (frame) => ({ root: { w: frame.w, h: frame.h }, nodes: Object.fromEntries(Object.entries(frame.nodes).map(([id, { center, ...n }]) => [id, n])) });
const FRAMES = { checkout, onboarding };

// A structured source behaving like Figma (frames with node trees), so the sample shows attribute diffs.
registerConnector({
  tool: 'demo', label: 'Sample design file',
  fetchObject(ev) {
    const p = ev.payload, f = FRAMES[p.frame](p.v);
    return [{ external_id: p.frame, type: 'frame', name: p.frame === 'checkout' ? 'Checkout' : 'Onboarding / Welcome', path: `Fieldnote app/${p.frame === 'checkout' ? 'Checkout' : 'Onboarding'}`, parent: 'fieldnote-app', properties: props(f) }];
  },
  async renderPreview(ev, asset, desc) {
    const f = FRAMES[ev.payload.frame](ev.payload.v);
    return { image: await png(f), properties: desc.properties, text: Object.values(f.nodes).filter((n) => n.text).map((n) => n.text).join('\n') };
  },
});

async function poster(colors, label, kind = 'grid') {
  const [a, b, c] = colors;
  const shapes = kind === 'grid'
    ? Array.from({ length: 12 }, (_, i) => `<rect x="${40 + (i % 4) * 140}" y="${120 + Math.floor(i / 4) * 140}" width="120" height="120" rx="${i % 3 ? 16 : 60}" fill="${[a, b, c][i % 3]}"/>`).join('')
    : `<circle cx="300" cy="320" r="200" fill="${b}"/><rect x="80" y="420" width="440" height="160" rx="24" fill="${c}"/>`;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="640"><rect width="600" height="640" fill="${a}"/>${shapes}<text x="40" y="80" font-family="Georgia, serif" font-size="34" fill="${c}">${esc(label)}</text></svg>`)).png().toBuffer();
}

const idle = async (ms = 90000) => {
  const t = now();
  while (now() - t < ms) {
    const busy = get("SELECT COUNT(*) n FROM job WHERE status IN ('queued','running')").n + get("SELECT COUNT(*) n FROM moment WHERE status='open'").n;
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 500));
  }
};

export async function seedDemo({ addReference }) {
  if (get("SELECT 1 FROM project WHERE name='Checkout redesign'")) return { ok: true, note: 'The sample is already loaded.' };
  const mk = (name, brief) => { const p = { id: uid('p'), workspace_id: 'ws', name, brief, status: 'active', pinned: [], do_not_capture: [], created_at: now() - 10 * day, updated_at: now() }; insert('project', p); ftsPut('project', p.id, p.id, name, brief); updateCentroid(p.id); return p; };
  const checkoutP = mk('Checkout redesign', 'Goal: cut drop-off on the mobile checkout of the Fieldnote shop.\nAudience: returning customers on phones.\nConstraints: must ship with Apple Pay; WCAG AA.\nStyle: calm, one accent colour, generous spacing.');
  const onboardP = mk('Onboarding flow', 'Goal: get new Fieldnote users to their first note in under a minute.\nAudience: first-time users on mobile.\nConstraints: three screens at most.\nStyle: friendly illustration, plain words.');
  const ex = { id: uid('ex'), project_id: onboardP.id, name: 'Dark theme try', description: 'What the welcome screen looks like in the dark theme.', status: 'open', created_at: now() - 2 * day };
  insert('exploration', ex);

  const demo = systemSource('demo', 'Sample design file');
  update('source', demo.id, { auto_accept: 1 });
  const src = get('SELECT * FROM source WHERE id=?', demo.id);
  const ver = (frame, v, ts, actor, label, project_id, extra = {}) => ingest(src, { external_id: frame, version: `v${v}`, type: 'version.named', actor, ts, payload: { frame, v, label, description: extra.description, project_id, boundary: 'named version', ...extra } });
  ver('checkout', 1, now() - 9 * day, 'Maya Chen', 'First pass', checkoutP.id);
  ver('onboarding', 1, now() - 8 * day, 'Leo Park', 'Welcome v1', onboardP.id);
  ver('checkout', 2, now() - 5 * day, 'Maya Chen', 'Tighter type, brand blue CTA', checkoutP.id, { description: 'Body 16 to 14 because the order summary wrapped on small phones, per Leo’s feedback.' });
  ver('onboarding', 2, now() - 3 * day, 'Leo Park', 'Plainer CTA copy', onboardP.id);
  ver('checkout', 3, now() - 2 * day, 'Maya Chen', 'Apple Pay + new layout', checkoutP.id, { description: 'Decided: headings in Georgia. Removed the promo banner; added Apple Pay.' });
  ver('onboarding', 3, now() - 1 * day, 'Leo Park', 'Dark theme try', onboardP.id, { exploration_id: ex.id });

  // Uploads: token files into the project, and two loose screens with no project (they wait in the inbox).
  const up = systemSource('upload', 'Uploads');
  const tokens = (primary, radius) => Buffer.from(JSON.stringify({ color: { primary: { $value: primary }, ink: { $value: '#111113' }, surface: { $value: '#f4f4f5' } }, radius: { button: { $value: `${radius}px` } }, type: { body: { $value: '14px' } } }, null, 2));
  captureUpload(up, { buf: tokens('#111113', 8), name: 'tokens.json', project_id: checkoutP.id, batch: uid('b'), batch_size: 1, actor: 'Maya Chen' });
  await idle(30000);
  captureUpload(up, { buf: tokens('#2b59ff', 12), name: 'tokens.json', project_id: checkoutP.id, batch: uid('b'), batch_size: 1, actor: 'Maya Chen' });
  const confirm = checkout(3);
  confirm.nodes['1:2'] = { ...confirm.nodes['1:2'], text: 'Order confirmed' };
  captureUpload(up, { buf: await png(confirm), name: 'checkout-confirmation.png', batch: uid('b'), batch_size: 1, actor: 'Maya Chen' });
  captureUpload(up, { buf: await poster(['#fafaf9', '#e4e4e7', '#18181b'], 'scratch', 'blob'), name: 'Screenshot 2026-10-12 at 18.04.png', batch: uid('b'), batch_size: 1, actor: 'Leo Park' });

  // The rest needs the moments, so it waits for the engine (in the background; the UI updates live).
  (async () => {
    await idle();
    const owner = get("SELECT u.* FROM membership m JOIN user u ON u.id=m.user_id WHERE m.role='owner'");
    const maya = mapActor('Maya Chen'), leo = mapActor('Leo Park');
    const latest = (pid, offset = 0) => get(`SELECT * FROM moment WHERE project_id=? AND status='accepted' AND exploration_id IS NULL ORDER BY end_ts DESC LIMIT 1 OFFSET ${offset}`, pid);
    const c3 = latest(checkoutP.id), c2 = latest(checkoutP.id, 1), o2 = latest(onboardP.id);
    const comment = (o) => { const c = { id: uid('cm'), status: 'open', reactions: {}, created_at: now() - (o.ago || 0), updated_at: now(), ...o }; delete c.ago; insert('comment', c); ftsPut('comment', c.id, c.project_id, c.author_name, c.body); return c; };
    if (c2) {
      const a = comment({ project_id: checkoutP.id, target_type: 'moment', target_id: c2.id, author_id: leo.id, author_name: 'Leo Park', body: 'The blue button feels heavier than the rest of the page. Can we soften it a touch?', ago: 4 * day });
      comment({ project_id: checkoutP.id, target_type: 'moment', target_id: c2.id, parent_id: a.id, author_id: maya.id, author_name: 'Maya Chen', body: 'Agreed. Keeping #2b59ff but going to 12px corners so it reads softer.', ago: 4 * day - 3600000, reactions: { agree: ['Leo Park'] } });
    }
    let cta;
    if (o2) cta = comment({ project_id: onboardP.id, target_type: 'moment', target_id: o2.id, region: { x: 0.06, y: 0.87, w: 0.88, h: 0.07 }, author_id: owner.id, author_name: owner.name, body: 'Make this CTA match the new button style from checkout.', ago: 2 * day });
    if (c3) comment({ project_id: checkoutP.id, target_type: 'moment', target_id: c3.id, author_id: leo.id, author_name: 'Leo Park', body: 'Love the Apple Pay placement. Let’s go with Georgia for headings across the shop.', ago: day });
    const dec = (pid, text, status, source_type, source_id, by) => { const d = { id: uid('de'), project_id: pid, text, status, source_type, source_id, confirmed_by: by, created_at: now() - 3 * day }; insert('decision', d); ftsPut('decision', d.id, pid, text.slice(0, 80), text); return d; };
    const d1 = dec(checkoutP.id, 'Primary buttons use the brand blue #2b59ff with 12px corners.', 'confirmed', 'moment', c2?.id, 'Maya Chen');
    dec(checkoutP.id, 'Let’s go with Georgia for headings across the shop.', 'suggested', 'comment', null, null);
    dec(onboardP.id, 'Onboarding stays at three screens or fewer.', 'confirmed', 'manual', null, owner.name);
    const issue = { id: uid('is'), project_id: checkoutP.id, title: 'Apple Pay button needs a dark-mode variant', body: 'The black Apple Pay button disappears on the dark theme. Follow Apple’s guidance: white button on dark.', assignee_type: 'agent', assignee: 'Claude Code', labels: ['checkout', 'dark-mode'], links: c3 ? [{ type: 'moment', id: c3.id }] : [], status: 'open', created_at: now() - day, updated_at: now() - day };
    insert('issue', issue); ftsPut('issue', issue.id, checkoutP.id, issue.title, issue.body);
    if (cta) {
      update('comment', cta.id, { sent_to_ai: 1, ai_status: 'returned' });
      const art = { id: uid('ar'), project_id: onboardP.id, type: 'code', title: 'Onboarding CTA in the checkout button style', content: "```tsx\nexport function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {\n  return (\n    <button\n      {...props}\n      className=\"h-14 w-full rounded-[12px] bg-[#2b59ff] text-[17px] font-semibold text-white active:scale-[.97] transition-transform\"\n    >\n      {children}\n    </button>\n  );\n}\n\n// Onboarding / Welcome\n<PrimaryButton>Create your account</PrimaryButton>\n```", prompt: cta.body, model: 'claude-opus-5-5', agent: 'Claude Code', source_comment_id: cta.id, status: 'proposed', created_at: now() - day };
      insert('artifact', art); ftsPut('artifact', art.id, onboardP.id, art.title, art.content);
      comment({ project_id: onboardP.id, target_type: 'moment', target_id: o2.id, parent_id: cta.id, author_id: mapActor('Claude Code').id, author_name: 'Claude Code · claude-opus-5-5', body: 'Returned an artifact: Onboarding CTA in the checkout button style', ago: day });
    }
    const dark = get('SELECT id FROM moment WHERE exploration_id=?', ex.id);
    if (dark) insert('proposal', { id: uid('pr'), project_id: onboardP.id, exploration_id: ex.id, title: 'Adopt the dark welcome screen', description: 'Leo’s dark-theme try for the welcome screen. Contrast checked: headline 16:1, body 9:1.', moment_ids: [dark.id], reviewers: [owner.id], reviews: [], status: 'open', author_id: leo.id, created_at: now() - day / 2, updated_at: now() - day / 2 });
    update('project', checkoutP.id, { pinned: [{ type: 'decision', id: d1.id, title: d1.text, label: 'Key decision' }, ...(c3 ? [{ type: 'moment', id: c3.id, title: c3.title, label: 'Current direction' }] : [])] });
    // References: generated swatches/posters, a colour and a font.
    const refs = [
      [checkoutP.id, ['#f5f3ee', '#2b59ff', '#111113'], 'Calm commerce', 'grid'], [checkoutP.id, ['#0d0d0e', '#2b59ff', '#f2f2f3'], 'Night checkout', 'blob'], [checkoutP.id, ['#fffbeb', '#f59e0b', '#1c1917'], 'Warm receipts', 'grid'],
      [onboardP.id, ['#eef2ff', '#c7d2fe', '#312e81'], 'Soft welcome', 'blob'], [onboardP.id, ['#fefce8', '#fde68a', '#422006'], 'Sunny start', 'blob'],
    ];
    for (const [pid, colors, label, kind] of refs) { try { await addReference({ project_id: pid, buf: await poster(colors, label, kind), name: `${label}.png`, title: label }); } catch (e) { console.error('demo ref', e.message); } }
    await addReference({ project_id: checkoutP.id, kind: 'color', value: '#2b59ff', title: 'Brand blue' });
    await addReference({ project_id: checkoutP.id, kind: 'font', value: 'Georgia', title: 'Georgia (headings)' });
  })().catch((e) => console.error('demo follow-up', e));
  return { ok: true, projects: [checkoutP.id, onboardP.id] };
}
