// The effects from Syed's Figma (made in the Animation Engine), as backgrounds: each kind of project has its own few,
// and projects of one kind take them in turn, so two food apps don't wear the same one.
import { useEffect, useRef } from 'react';
import { effect } from './runtime.js';
import PRESETS from './presets.json';

const BY_KIND = {
  'Food & delivery': ['retro-circles', 'groovy', 'oil-coast'],
  'Sport & events': ['neon-tunnel', 'contour-blocks', 'bauhaus-tiles'],
  Commerce: ['contour-blocks', 'bauhaus-tiles', 'retro-circles'],
  'Tools & AI': ['crt-mesh', 'blue-signal', 'electric-cloud'],
  'Motion & film': ['crt-coast', 'electric-cloud', 'neon-tunnel'],
  Portfolio: ['quiet-horizon', 'ink-coast', 'soft-afterglow'],
  Product: ['soft-afterglow', 'quiet-horizon', 'groovy'],
};
export const effectFor = (kind, n = 0) => { const ids = BY_KIND[kind] || BY_KIND.Product; return PRESETS.find((p) => p.id === ids[n % ids.length]); };

// One effect drawn behind whatever sits on it, moving while it's on screen (still under reduced motion). `frame`: the
// width its cells are sized for, so a card's cells stay as fine as the engine's at full size.
export function Backdrop({ preset, frame = 660, className }) {
  const el = useRef(null);
  useEffect(() => {
    if (!preset || !el.current) return;
    const fx = effect(el.current, preset.effect, { frame, fps: 30 });
    return () => fx.destroy();
  }, [preset?.id, frame]);
  return (<span ref={el} className={className} aria-hidden="true" style={{ background: preset?.effect.colors[0] }} />);
}
