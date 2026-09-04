# Cat's Tower — Corrective Audit 2

Prepared: 2026-09-04 JST  
Delivery target: `cats4.zip`

## Verdict

The prior chat delivery report was not a reliable manifest. It named files and locations that did not match the delivered archive. The repository itself and machine-readable manifests must take precedence over a prose completion report.

The bootstrap pipeline was worth preserving, but its domain implementation was not acceptable as the base for First Playable work.

## Confirmed defects and disposition

| Finding | Confirmed | Disposition |
|---|---:|---|
| Runtime did not import candidate-v3/engine-v2 | Yes | Direct typed adapter now imports candidate, numeric, RNG and tower sources |
| HP/coin/level used `number` | Yes | Canonical gameplay quantities now use BigInt internally and decimal strings externally |
| Mugi/Toto roles were wrong | Yes | Exact candidate-v3 IDs/names/roles are asserted at load time |
| Tick was 100 ms | Yes | Tick comes from candidate-v3 and equals 50 ms |
| Arena used invented wave curve | Yes | Wave model removed; canonical floor descriptor, reward and next-floor progression used |
| Reported round-036 work absent | Yes | Marked `BLOCKED_SOURCE_NOT_FOUND`; no invented reconstruction |
| Legacy root still present | Yes | Kept physically stable, logically isolated and excluded from V2 build |

## Preserved assets

- Vite and TypeScript workspace;
- React HUD;
- Phaser canvas renderer;
- Vitest and Playwright structure;
- Chromium and WebKit mobile projects;
- Vercel `dist/v2` routing;
- PR-based workflow;
- existing handoff and visual-reference package.

## Rejected shortcut

Moving `step4/**`, `quality-reviews/**` or other sealed history into a new `legacy/` tree was rejected. Those paths are immutable historical evidence and reference inputs. A physical relocation would break stable paths and downstream evidence. Logical isolation is used instead.

## Remaining high-risk gap

The current simulation engine does not yet expose a complete real-time shared combat operation. The correction shares candidate/tower/numeric/RNG truth, but provisional cat combat values remain. V2-1 must close that gap before any claim of runtime/model equivalence or before extending the current battle into production content.
