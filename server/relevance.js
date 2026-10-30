// What a project's file is to the person looking at it: the design (pictures, mockups, references, docs, design files),
// the UI's code (components, pages, styles), the app's own pictures and media (what it ships), or not relevant here —
// a tool's export or build output, setup and config, a generated file, a font, an icon, the same file twice. Each
// hidden one says why, so nothing disappears without a reason.
const DUMP = /(^|\/)(_figma|dist[\w-]*|__snapshots__|__tests__|test-results|playwright-report|build|\.next|out|coverage|node_modules|\.git|\.cache|\.design-sync|\.vercel|\.turbo|storybook-static|\.output|\.svelte-kit|target|__pycache__)\//i;
const SETUP = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|tsconfig[\w.-]*\.json|jsconfig\.json|[\w.-]*\.config\.[cm]?[jt]s|\.eslintrc[\w.]*|\.prettierrc[\w.]*|\.editorconfig|next-env\.d\.ts|\.gitignore|\.gitattributes|\.npmrc|\.nvmrc|vercel\.json|netlify\.toml|components\.json|manifest\.json|robots\.txt|sitemap\.xml|LICENSE[\w.]*)$|\.d\.ts$|\.(lock|map|json5|toml|ya?ml|ini)$|\.alt\.txt$|(^|\/)\.[\w.-]+$/i; // and dotfiles, config formats, a picture's alt text
const SCRATCH = /(^|\/)(scratch|tmp|temp|untitled|test)[\w-]*\.\w+$/i;
const NAMED_BY_HASH = /^[0-9a-f]{24,}\.\w+$/i;
const APP_ICONS = /(^|\/)(favicon|apple-icon|apple-touch-icon|icon|opengraph-image|twitter-image|og-image|og|logo\d*)[\w.-]*\.(png|ico|jpe?g|svg|webp)$/i; // the app's own icons and share pictures
const HASHED = /[-._](?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{8,}\.(m?js|css|ttf|otf|woff2?|png|jpe?g|webp|svg)$/;
const SHIPPED = /(^|\/)(public|static|assets|src\/assets|app\/assets|images|img|media|fonts)\//i; // what the app ships, beside its code
const UI = /\.(tsx|jsx|vue|svelte|astro|html|css|scss|sass|less|styl|wgsl|glsl|frag|vert)$|(^|\/)(components?|pages?|routes|views|screens|sections|layouts?|ui|styles?|theme)\//i; // a file that draws, wherever it lives
const FIGMA_NODE = /(^|\/)(node-\d+|frame\d+|root\d*|group\d*|vector\d*|rectangle\d*)\.(svg|png)$/i;

export function roleOf(a, twinOf) {
  const p = String(a.path || a.name || ''), ext = (p.split('.').pop() || '').toLowerCase(), w = a.width || 0, h = a.height || 0, size = a.properties?.file?.size || 0;
  if (twinOf) return { group: 'hidden', why: 'Same file as another here' };
  if (DUMP.test(p) || FIGMA_NODE.test(p)) return { group: 'hidden', why: 'A tool’s export or build output' };
  if (SETUP.test(p)) return { group: 'hidden', why: 'Setup and config' };
  const base = p.split('/').pop();
  if (HASHED.test(base) || NAMED_BY_HASH.test(base)) return { group: 'hidden', why: 'A generated file' };
  if (SCRATCH.test(p)) return { group: 'hidden', why: 'A scratch file' };
  if (a.type === 'font') return { group: 'hidden', why: 'A font file (its type is in the design system)' };
  if (a.type === 'image' && ((w && h && Math.max(w, h) <= 96) || (ext === 'svg' && size && size < 3000))) return { group: 'hidden', why: 'An icon or small graphic' };
  if (a.tool !== 'folder') return { group: 'design' }; // uploaded, or from Figma or another tool: put here on purpose
  if (a.type === 'code' || /\.(wgsl|glsl|frag|vert|html?)$/i.test(p)) return UI.test(p) ? { group: 'code' } : { group: 'hidden', why: 'Code that draws nothing (helpers, data, scripts)' };
  if (['image', 'video', 'file'].includes(a.type) && (SHIPPED.test(p) || APP_ICONS.test(p))) return { group: 'assets' };
  return { group: 'design' }; // screenshots, mockups, references and docs kept beside the code
}

// Every file with its role; of two with the same content, the newer one stays.
export function sortFiles(list) {
  const seen = new Map();
  return [...list].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).map((a) => {
    const k = a.file_key || a.image_key, twin = k && seen.get(k);
    if (k && !twin) seen.set(k, a.name);
    return { ...a, ...roleOf(a, twin) };
  });
}
