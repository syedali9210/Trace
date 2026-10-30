// Trace's frame runtime: browser code served inside a project's own Vite (virtual:trace-runtime) and evaluated before
// the component, so it owns the clock. It draws one component (a frame) or every state of it (the preview), shows
// hover / focus / pressed by rewriting the page's own CSS rules onto classes, lists the motion it finds, and takes
// commands from Trace over postMessage: speed, pause, play, seek, replay, cycle the states.

// ---------- the clock: requestAnimationFrame and performance.now run on scaled time; CSS and Web Animations follow ----------
const realNow = performance.now.bind(performance);
const rawRaf = window.requestAnimationFrame.bind(window);
let scale = 1, last = 1, anchorReal = realNow(), anchorVirt = anchorReal;
const vnow = () => anchorVirt + (realNow() - anchorReal) * scale;
performance.now = vnow;
window.requestAnimationFrame = (cb) => rawRaf(() => cb(vnow())); // JS-driven motion (springs) slows and stops with it
const paused = new Set();
function applyRate() {
  for (const a of document.getAnimations()) {
    if (scale === 0) { if (a.playState === 'running') { a.pause(); paused.add(a); } }
    else { if (a.playbackRate !== scale) a.playbackRate = scale; if (paused.has(a)) { a.play(); paused.delete(a); } }
  }
}
function setScale(s) { anchorVirt = vnow(); anchorReal = realNow(); scale = s; applyRate(); }
(function keep() { if (scale !== 1) applyRate(); rawRaf(keep); })(); // animations started since keep the rate

// ---------- states: the page's :hover / :focus / :active rules, copied onto classes a cell can carry ----------
const PSEUDO = [[':hover', '__st-hover'], [':focus-visible', '__st-focus'], [/:focus(?![-\w])/g, '__st-focus'], [':active', '__st-active']];
const splitSel = (s) => { const out = []; let d = 0, cur = ''; for (const c of s) { if (c === '(' || c === '[') d++; if (c === ')' || c === ']') d--; if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur.trim()); return out; };
const nest = (sel, parent) => (parent ? splitSel(sel).map((s) => (s.includes('&') ? s.replaceAll('&', `:is(${parent})`) : `:is(${parent}) ${s}`)).join(', ') : sel);
function rewrite() {
  const out = [];
  const walk = (rules, wrap, parent) => {
    for (const r of rules) {
      if (r instanceof CSSStyleRule) {
        const full = nest(r.selectorText, parent);
        for (const [p, cls] of PSEUDO) {
          const has = (s) => (typeof p === 'string' ? s.includes(p) : s.search(p) >= 0);
          const items = splitSel(full).filter(has);
          if (!items.length) continue;
          const sel = items.map((s) => `.${cls} ${typeof p === 'string' ? s.replaceAll(p, '') : s.replace(p, '')}`.replace(/:is\(\)/g, '*')).join(', ');
          const body = r.cssText.slice(r.cssText.indexOf('{'));
          out.push(wrap.reduceRight((inner, w) => `${w} { ${inner} }`, `${sel} ${body}`));
        }
        if (r.cssRules?.length) walk(r.cssRules, wrap, full);
      } else if (r.cssRules && (r instanceof CSSMediaRule || r instanceof CSSSupportsRule || (window.CSSLayerBlockRule && r instanceof CSSLayerBlockRule) || (window.CSSContainerRule && r instanceof CSSContainerRule))) {
        const w = r instanceof CSSMediaRule ? `@media ${r.conditionText}` : r instanceof CSSSupportsRule ? `@supports ${r.conditionText}` : r.constructor.name === 'CSSLayerBlockRule' ? `@layer ${r.name}` : `@container ${r.conditionText}`;
        walk(r.cssRules, [...wrap, w], parent);
      }
    }
  };
  for (const sheet of document.styleSheets) { if (sheet.ownerNode?.id === '__trace-states') continue; try { walk(sheet.cssRules, [], null); } catch {} } // another origin's sheet: skip
  let el = document.getElementById('__trace-states');
  if (!el) { el = document.createElement('style'); el.id = '__trace-states'; document.head.append(el); }
  el.textContent = out.join('\n');
}
let rewriteT;
new MutationObserver(() => { clearTimeout(rewriteT); rewriteT = setTimeout(rewrite, 60); }).observe(document.head, { childList: true, subtree: true, characterData: true });

// ---------- motion: what moves, how long, how it eases ----------
const seen = new Map();
const describe = (el) => (el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).filter((c) => !c.startsWith('__')).slice(0, 2).join('.')}` : ''}` : '');
function collect() {
  for (const a of document.getAnimations()) {
    const fx = a.effect, tm = fx?.getTiming?.() || {}, target = fx?.target;
    const kind = a.constructor.name === 'CSSAnimation' ? 'CSS animation' : a.constructor.name === 'CSSTransition' ? 'CSS transition' : 'Script (Web Animations)';
    const props = [...new Set((fx?.getKeyframes?.() || []).flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))))];
    const cs = target && getComputedStyle(target);
    const easing = kind === 'CSS animation' ? cs?.animationTimingFunction : tm.easing;
    const name = a.animationName || a.transitionProperty || a.id || props.join(', ') || 'animation';
    const key = `${kind}|${name}|${describe(target)}`;
    if (!seen.has(key)) seen.set(key, { kind, name, props, duration: Math.round(Number(tm.duration) || 0), delay: Math.round(tm.delay || 0), easing, iterations: tm.iterations === Infinity ? 'infinite' : tm.iterations, target: describe(target) });
  }
  parent.postMessage({ trace: 'motion', list: [...seen.values()] }, '*');
}

// ---------- drawing ----------
const label = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const CSS = `
#__trace{font:500 11px/1.3 ui-sans-serif,system-ui,sans-serif}
.__frame{display:inline-block;padding:24px;min-width:40px}
.__frame.__screen{display:block;padding:0}
.__grid{display:grid;gap:0;padding:8px 0 24px;align-items:center}
.__h{color:#8c8c8c;padding:8px 16px;white-space:nowrap;letter-spacing:.01em}
.__cell{padding:20px 24px;border-top:1px solid #0000000f;display:flex;align-items:center;min-height:56px}
.__stack{display:flex;flex-direction:column;padding:8px 0 24px}.__stack section{border-top:1px solid #0000000f}.__stack .__cell{border-top:0;display:block;padding:0 0 16px}
.__err{margin:16px;padding:12px 14px;border-radius:8px;background:#f5f5f5;color:#525252;font:12px/1.5 ui-sans-serif,system-ui;max-width:420px}
.__err b{display:block;color:#171717;margin-bottom:4px}`;

export function mount({ React, createRoot, load, key, name, mode, props, types, wrap, kind, story, sample }) {
  const h = React.createElement;
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.getElementById('__trace');
  const say = (m) => parent.postMessage(m, '*');
  class Guard extends React.Component {
    constructor(p) { super(p); this.state = { e: null }; }
    static getDerivedStateFromError(e) { return { e }; }
    componentDidCatch(e) { say({ trace: 'error', message: String(e?.message || e).slice(0, 300) }); }
    render() { return this.state.e ? h('div', { className: '__err' }, h('b', null, `${label(name)} needs its app to draw`), String(this.state.e.message || this.state.e).slice(0, 240)) : this.props.children; }
  }
  let base = { ...(types.children && !('children' in props) ? { children: label(name) } : {}), ...props };
  const W = wrap || ((n) => n);
  function Cell({ C, p, cls, disable }) { // one instance; a native control gets disabled for real when its prop can't
    const ref = React.useRef();
    React.useEffect(() => { if (disable) ref.current?.querySelectorAll('button,input,select,textarea').forEach((el) => { el.disabled = true; el.setAttribute('aria-disabled', 'true'); }); }, []);
    return h('div', { ref, className: `__cell ${cls || ''}`, 'data-st': cls || '' }, h(Guard, null, h(C, p)));
  }
  function View({ C }) {
    const [wide, setWide] = React.useState(false); // a section, not a control: its states stack instead of sitting side by side
    React.useLayoutEffect(() => { const c = document.querySelector('.__cell > *'); if (c && c.getBoundingClientRect().width > 480) setWide(true); }, []);
    React.useLayoutEffect(() => { // every column in view: a grid wider than the page scales down (to half at most)
      const fit = () => { const g = document.querySelector('.__grid'); if (!g) return; g.style.zoom = ''; const z = (innerWidth - 8) / g.scrollWidth; g.style.zoom = z < 1 ? String(Math.max(0.5, z)) : ''; };
      fit(); addEventListener('resize', fit); return () => removeEventListener('resize', fit);
    });
    if (mode !== 'states' || kind === 'screen') return W(h('div', { className: `__frame${kind === 'screen' ? ' __screen' : ''}` }, h(Guard, null, h(C, base))));
    const variants = Object.entries(types.unions || {});
    const rows = [{ label: 'Default', p: {} }];
    for (const [prop, vals] of variants) for (const v of vals.slice(1)) rows.push({ label: `${prop}: ${v}`, p: { [prop]: v } });
    const cols = [['Default', ''], ['Hover', '__st-hover'], ['Focus', '__st-focus'], ['Pressed', '__st-active'], ...(types.flags || []).map((f) => [label(f), '', { [f]: true }, f === 'disabled'])];
    if (wide) return W(h('div', { className: '__stack' }, rows.slice(0, 16).flatMap((r) => cols.map(([t, cls, extra, disable]) => h('section', { key: `${r.label}-${t}` },
      h('div', { className: '__h' }, r.label === 'Default' ? t : `${r.label} · ${t}`), h(Cell, { C, p: { ...base, ...r.p, ...(extra || {}) }, cls, disable }))))));
    const grid = { gridTemplateColumns: `max-content repeat(${cols.length}, max-content)` };
    return W(h('div', { className: '__grid', style: grid }, [
      h('div', { key: 'c', className: '__h' }), ...cols.map(([t]) => h('div', { key: t, className: '__h' }, t)),
      ...rows.slice(0, 16).flatMap((r) => [h('div', { key: `${r.label}-l`, className: '__h' }, r.label), ...cols.map(([t, cls, extra, disable]) => h(Cell, { key: `${r.label}-${t}`, C, p: { ...base, ...r.p, ...(extra || {}) }, cls, disable }))]),
    ]));
  }
  let n = 0, reactRoot = null, C = null;
  const draw = () => { reactRoot.render(h(View, { C, key: n++ })); setTimeout(() => { rewrite(); collect(); }, 60); setTimeout(collect, 600); };
  load().then(async (M) => {
    C = M[key] || M.default;
    reactRoot = createRoot(root);
    if (!C) { root.innerHTML = `<div class="__err"><b>${label(name)} isn’t exported here</b></div>`; return; }
    let fromStory = null; // its Storybook args, when it has a story: the values its author picked
    if (story) { try { const S = await story(); const own = Object.entries(S).find(([k, v]) => k !== 'default' && v && typeof v === 'object' && v.args)?.[1]; const args = { ...(S.default?.args || {}), ...(own?.args || {}) }; if (Object.keys(args).length) { base = { ...base, ...args }; fromStory = sample?.story; } } catch {} }
    say({ trace: 'sample', files: sample?.files || [], providers: !!sample?.providers, story: fromStory, props: Object.keys(props) });
    draw();
    let sent = '', queued = false;
    const size = () => { if (!queued) { queued = true; rawRaf(() => { queued = false; measure(); }); } }; // once a frame, however much is animating
    const measure = () => { const el = root.firstElementChild; if (!el) return; const s = `${Math.ceil(el.scrollWidth)}x${Math.ceil(el.scrollHeight)}`; if (s !== sent) { sent = s; const [w, h] = s.split('x').map(Number); say({ trace: 'size', w, h }); } };
    new ResizeObserver(size).observe(root);
    new MutationObserver(size).observe(root, { childList: true, subtree: true, attributes: true }); // the frame itself can grow inside an unchanged root
    document.fonts?.ready.then(size); // text set in a web font is wider than its fallback
    [100, 500, 1500, 3000].forEach((t) => setTimeout(size, t));
  }).catch((e) => { root.innerHTML = '<div class="__err"></div>'; root.firstChild.innerHTML = `<b>${label(name)} didn’t load</b>`; root.firstChild.append(String(e?.message || e).slice(0, 300)); say({ trace: 'error', message: String(e?.message || e).slice(0, 300) }); });

  // Trace's controls
  let cycle = null;
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.trace !== 'cmd') return;
    if (d.cmd === 'speed') { last = d.v; if (scale !== 0) setScale(d.v); }
    if (d.cmd === 'pause') setScale(0);
    if (d.cmd === 'play') setScale(last);
    if (d.cmd === 'seek') { setScale(0); for (const a of document.getAnimations()) { const end = a.effect?.getComputedTiming?.().endTime; a.currentTime = Math.max(0, Math.min(d.v, Number.isFinite(end) ? end : d.v)); } }
    if (d.cmd === 'replay') { seen.clear(); draw(); if (scale === 0) setScale(last); }
    if (d.cmd === 'cycle') {
      clearInterval(cycle);
      const cells = () => [...document.querySelectorAll('[data-st]')].filter((c) => c.dataset.st);
      cells().forEach((c) => c.classList.add(c.dataset.st));
      if (d.v) cycle = setInterval(() => { cells().forEach((c) => c.classList.toggle(c.dataset.st)); setTimeout(collect, 50); }, 1400);
    }
  });
  addEventListener('pointerover', () => setTimeout(collect, 50)); // motion that starts under the pointer
  say({ trace: 'hello' });
}
