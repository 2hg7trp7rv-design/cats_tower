# Cat's Tower — Canonical Runtime Correction Rule 1

This rule supplements, and does not outrank, the latest explicit user decision, `CURRENT_AUTHORITY_INDEX.json`, active change-control, or `CLAUDE.md`.

## Superseded bootstrap assumptions

Do not restore the former `packages/domain/src/battle.ts` behavior that used:

- 100 ms ticks;
- `guardian`, `striker`, `ranger`, `support` as product roles;
- Mugi as support or Toto as guardian;
- `number` for HP, coin, level, floor or reward;
- an invented wave-only arena and `42 + wave * 11` enemy HP;
- automatic level-up every three kills.

## Required current binding

The V2 bootstrap must retain its React, Phaser, Vite, CI, Playwright and Vercel scaffold while binding runtime domain code directly to:

- `simulation/candidate-v3.json`;
- `simulation/engine-v2/numeric.mjs`;
- `simulation/engine-v2/rng.mjs`;
- `simulation/engine-v2/tower.mjs`.

Canonical launch roles are:

- `character.launch.001` Mugi — `frontline-control`;
- `character.launch.002` Luna — `ranged-anti-air`;
- `character.launch.003` Toto — `healing-support`;
- `character.launch.004` Kohaku — `runner-backline-disruption`.

Fixed tick is 50 ms. Canonical unbounded gameplay quantities are normalized decimal strings externally and BigInt/exact-rational values internally. Floor 10 must progress to Floor 11. A player-visible final floor must not be introduced.

## Evidence boundary

This correction proves source binding for numeric, RNG, floor generation, roles, tick, reward and floor progression. It does not convert Step 3 model evidence into browser-runtime proof, and it does not claim the provisional bootstrap cat combat values are simulation-sealed. Read `docs/v2/CANONICAL_RUNTIME_BINDING1.md` and `docs/v2/HANDOFF_VALIDATION2.json` before extending combat.

## Lost round-036 material

Do not invent `SPEC_V2_ADDITIONS.md`, `SCREENS_V2_TARGET.md`, S13, town, combo or portable-supply contracts from their names. Their exact source was not found in the live repository, current delivery inputs or accessible file library. Read `docs/v2/ROUND_036_RECOVERY_STATUS1.md`.

## Legacy boundary

Legacy root files remain physically in place because sealed history and references depend on stable paths. They are logically isolated and excluded from the V2 build. Do not extend them. Read `legacy/LEGACY_PATH_MANIFEST1.json`.
