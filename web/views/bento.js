// The bento canvas, shared by Home's board and each project's canvas: cards in a dense grid you can select, drag to
// reorder, resize, and link by dragging from a card's dots to another card. Drag feel from Syed's reference: 5px
// threshold, tilt from speed (max 6°, lerp .18, decay .92), lifted ×1.05 with a 70px / y36 / 20% shadow, 500ms settle.
// Reduced motion: no tilt, no lift, no settle. Keyboard: Enter selects / opens, Alt + arrows move, Escape lets go.
import { html, useState, useEffect, useRef, useLayoutEffect, Icon, Menu } from '../lib.js';

export const SIZES = ['1x1', '2x1', '1x2', '2x2'];
const T = { threshold: 5, maxTilt: 6, lerp: 0.18, decay: 0.92, settle: 500 };
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Bento({ items, links = [], onSave, onLink, onKnot, knot, renderCard, renderPanel, toolbar, onOpen, linkLabel, dimmed, cls = '' }) {
  const [order, setOrder] = useState([]);
  const [size, setSize] = useState({});
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(null);
  const [geo, setGeo] = useState({});
  const [draw, setDraw] = useState(null); // a link being drawn
  const [lifted, setLifted] = useState(null);
  const grid = useRef(), drag = useRef(null), prev = useRef({});
  const sig = items.map((i) => `${i.id}:${i.size}`).join();
  useEffect(() => { setOrder(items.map((i) => i.id)); setSize(Object.fromEntries(items.map((i) => [i.id, i.size || '1x1']))); }, [sig]);
  const byId = Object.fromEntries(items.map((i) => [i.id, { ...i, size: size[i.id] || i.size || '1x1' }]));
  const cards = order.map((id) => byId[id]).filter(Boolean);

  useLayoutEffect(() => { // the others glide to their new places (FLIP); links follow the cards
    const next = {};
    for (const el of grid.current?.querySelectorAll(':scope > .bcard') || []) {
      const id = el.dataset.id, p = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      next[id] = p;
      const o = prev.current[id];
      if (o && (o.x !== p.x || o.y !== p.y) && drag.current?.id !== id && !still()) {
        el.style.transition = 'none'; el.style.transform = `translate(${o.x - p.x}px, ${o.y - p.y}px)`;
        el.getBoundingClientRect();
        el.style.transition = 'transform 320ms cubic-bezier(.23,1,.32,1)'; el.style.transform = '';
      }
    }
    prev.current = next;
    setGeo(next);
  }, [order.join(), JSON.stringify(size), cards.length]);
  useEffect(() => { const ro = new ResizeObserver(() => { prev.current = {}; setOrder((o) => [...o]); }); if (grid.current) ro.observe(grid.current); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !e.target.closest('input, textarea')) { setSel(null); setOpen(null); } };
    const off = (e) => { if (!e.target.closest('.bcard, .pop, dialog, .bknot, .drawer')) { setSel(null); setOpen(null); } };
    addEventListener('keydown', esc); document.addEventListener('pointerdown', off);
    return () => { removeEventListener('keydown', esc); document.removeEventListener('pointerdown', off); };
  }, []);

  const down = (e, c) => {
    if (e.button !== 0 || e.target.closest('.btool, .bdot, .bpanel a, .bpanel button, .bpanel input, .bpanel textarea, .bpanel select, a, input, textarea, [data-nodrag]')) return;
    const el = e.currentTarget, g = grid.current.getBoundingClientRect();
    drag.current = { id: c.id, el, pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, gx: e.clientX - g.left - el.offsetLeft, gy: e.clientY - g.top - el.offsetTop, vx: 0, tilt: 0, t: performance.now(), on: false };
    el.setPointerCapture(e.pointerId);
  };
  useEffect(() => {
    let raf;
    const frame = () => {
      const d = drag.current;
      if (d?.on) {
        const g = grid.current.getBoundingClientRect();
        const tx = d.x - g.left - d.gx - d.el.offsetLeft, ty = d.y - g.top - d.gy - d.el.offsetTop;
        d.vx *= T.decay;
        d.tilt += (Math.max(-T.maxTilt, Math.min(T.maxTilt, d.vx * 6)) - d.tilt) * T.lerp;
        d.el.style.transform = still() ? `translate(${tx}px, ${ty}px)` : `translate(${tx}px, ${ty}px) rotate(${d.tilt.toFixed(2)}deg) scale(1.05)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const mv = (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pid) return;
      const t = performance.now();
      d.vx = (e.clientX - d.x) / Math.max(8, t - d.t); d.t = t;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.on && Math.hypot(d.x - d.sx, d.y - d.sy) > T.threshold) { d.on = true; setLifted(d.id); d.el.style.transition = 'none'; setSel(d.id); setOpen(null); }
      if (!d.on) return;
      const over = document.elementsFromPoint(e.clientX, e.clientY).map((x) => x.closest?.('.bcard')).find((x) => x && x.dataset.id !== d.id && grid.current.contains(x));
      if (over) setOrder((o) => { const to = o.indexOf(over.dataset.id); if (to < 0 || o[to] === d.id) return o; const n = o.filter((x) => x !== d.id); n.splice(to, 0, d.id); return n; });
    };
    const up = (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pid) return;
      drag.current = null;
      if (e.type === 'pointercancel' && !d.on) return; // the page scrolled instead (touch)
      if (!d.on) { setOpen((o) => (sel === d.id ? (o === d.id ? null : d.id) : null)); setSel(d.id); return; } // click: select; again: open
      setLifted(null);
      d.el.style.transition = still() ? 'none' : `transform ${T.settle}ms cubic-bezier(.23,1,.32,1)`;
      d.el.style.transform = '';
      setOrder((o) => { onSave?.({ order: o }); return o; });
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    return () => { cancelAnimationFrame(raf); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  }, [sel]);

  const dot = (e, c) => { // drag from a dot to another card to link them
    e.stopPropagation(); e.preventDefault();
    const g = grid.current.getBoundingClientRect(), b = e.currentTarget.getBoundingClientRect();
    const s = { x: b.left + b.width / 2 - g.left, y: b.top + b.height / 2 - g.top };
    setDraw({ x0: s.x, y0: s.y, x: s.x, y: s.y });
    const mv = (ev) => setDraw((l) => l && { ...l, x: ev.clientX - g.left, y: ev.clientY - g.top });
    const up = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      setDraw(null);
      const to = document.elementsFromPoint(ev.clientX, ev.clientY).map((x) => x.closest?.('.bcard')).find((x) => x && x.dataset.id !== c.id)?.dataset.id;
      if (to) onLink?.(c.id, to);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  const resize = (c) => { const s = SIZES[(SIZES.indexOf(c.size) + 1) % SIZES.length]; setSize({ ...size, [c.id]: s }); onSave?.({ size: { [c.id]: s } }); };
  const key = (e, c, i) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (sel !== c.id) setSel(c.id); else if (onOpen && open === c.id) onOpen(c); else setOpen(open === c.id ? null : c.id); }
    if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      setOrder((o) => { const n = o.filter((x) => x !== c.id); n.splice(Math.max(0, Math.min(n.length, i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1))), 0, c.id); onSave?.({ order: n }); return n; });
      setTimeout(() => grid.current.querySelector(`[data-id="${c.id}"]`)?.focus(), 0);
    }
  };
  const center = (id) => geo[id] && { x: geo[id].x + geo[id].w / 2, y: geo[id].y + geo[id].h / 2 };
  // A link runs from one card's edge to the other's, so its line and its count sit in the gap, never on content.
  const edge = (id, to) => { const g = geo[id], c = center(id), dx = to.x - c.x, dy = to.y - c.y; const k = Math.min(Math.abs(g.w / 2 / (dx || 1e-9)), Math.abs(g.h / 2 / (dy || 1e-9)), 1); return { x: c.x + dx * k, y: c.y + dy * k }; };
  const span = (l) => { const a = center(l.from), b = center(l.to); return a && b && [edge(l.from, b), edge(l.to, a)]; };
  const api = { resize, open: (c) => setOpen(c.id), close: () => setOpen(null), select: setSel };
  return html`<div class=${`bento ${cls}`} ref=${grid}>
    <svg class="blinks" aria-hidden="true">
      ${links.map((l) => { const s = span(l); return s && html`<line class=${l.cls || ''} x1=${s[0].x} y1=${s[0].y} x2=${s[1].x} y2=${s[1].y} />`; })}
      ${draw && html`<line class="drawing" x1=${draw.x0} y1=${draw.y0} x2=${draw.x} y2=${draw.y} />`}
    </svg>
    ${links.map((l) => { const s = span(l); return s && html`<button class=${`bknot${knot?.(l) ? ' big' : ''} ${l.cls || ''}`} style=${{ left: `${(s[0].x + s[1].x) / 2}px`, top: `${(s[0].y + s[1].y) / 2}px` }} aria-label=${linkLabel?.(l) || 'Link'} data-tip=${linkLabel?.(l) || 'Link'} onClick=${() => onKnot?.(l)}>${knot?.(l) || ''}</button>`; })}
    ${cards.map((c, i) => html`<div key=${c.id} class=${`bcard ${c.cls || ''} s-${c.size}${sel === c.id ? ' sel' : ''}${lifted === c.id ? ' lifted' : ''}${dimmed?.(c) ? ' dim' : ''}`} data-id=${c.id} role="button" tabindex="0" aria-pressed=${sel === c.id}
        aria-label=${`${c.label || c.id}${sel === c.id ? ', selected' : ''}`} onPointerDown=${(e) => down(e, c)} onKeyDown=${(e) => key(e, c, i)} onDblClick=${() => onOpen?.(c)}>
      ${renderCard(c, { sel: sel === c.id, open: open === c.id })}
      ${sel === c.id && onLink && ['r', 'b', 'l'].map((s) => html`<button class=${`bdot ${s}`} aria-label="Drag to another card to link them" tabindex="-1" onPointerDown=${(e) => dot(e, c)}></button>`)}
      ${sel === c.id && open !== c.id && toolbar && html`<div class="btool" role="toolbar" aria-label=${`${c.label} actions`}>
        <button onClick=${() => resize(c)} title="Change size" aria-label=${`Size ${c.size.replace('x', ' by ')}; change`}><${Icon} n="arrows-out-simple" />${c.size.replace('x', '×')}</button>
        ${toolbar(c, api)}
        ${onLink && html`<${Menu} label="Link to another card" icon="share-network" btn="" items=${cards.filter((x) => x.id !== c.id).map((x) => ({ label: x.label, onClick: () => onLink(c.id, x.id) }))} />`}
      </div>`}
      ${open === c.id && renderPanel && html`<div class="bpanel">${renderPanel(c, () => setOpen(null))}</div>`}
    </div>`)}
  </div>`;
}
