import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import '@phosphor-icons/web/regular';
import './index.css';
import './app/trace.css';
import { FluidRoot } from '@/components/fluid-root';
import { App } from './app/app.jsx';
import { startLive } from './app/lib.jsx';

// Fluid Functionalism's settings (Base UI, rounded, default size, Phosphor icons); motion follows the OS's
// reduced-motion setting everywhere.
startLive();
createRoot(document.getElementById('app')).render(
  <MotionConfig reducedMotion="user">
    <FluidRoot>
      <App />
    </FluidRoot>
  </MotionConfig>
);
