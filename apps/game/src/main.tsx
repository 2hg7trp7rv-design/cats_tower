import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { battleRuntime } from './game/runtime';
import './styles.css';

window.__CATS_TOWER_V2__ = {
  version: 'v2-bootstrap-2-canonical-binding',
  getSnapshot: battleRuntime.getSnapshot,
  restart: (seed, options) => battleRuntime.restart(seed, options),
  levelUp: () => battleRuntime.levelUp(),
  pause: () => battleRuntime.pause(),
  resume: () => battleRuntime.resume(),
  advanceForTest: (milliseconds: number) =>
    battleRuntime.advanceForTest(milliseconds),
};

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root mount point.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
