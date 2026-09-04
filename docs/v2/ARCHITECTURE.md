# V2 Architecture

## Boundaries

- `apps/game`: React application, Phaser renderer and browser adapter
- `packages/domain`: deterministic battle state and events with no DOM or renderer dependency
- `tests/v2`: domain behavior
- `tests/e2e`: browser, viewport, determinism and console checks
- `dist/v2`: static Vercel Preview output

React reads snapshots and issues commands. Phaser advances and renders the same runtime. Neither component owns permanent economy or future server-authoritative transactions.

## Current implementation status

The bootstrap uses local provisional state and geometric entities. This is intentional and visible in the UI. Production assets and authoritative persistence are deferred until the First Playable validates the combat loop.
