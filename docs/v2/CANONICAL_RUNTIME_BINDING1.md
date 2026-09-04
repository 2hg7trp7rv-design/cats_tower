# Cat's Tower — Canonical Runtime Binding 1

Status: **IMPLEMENTED — AUTOMATED VERIFICATION RECORDED SEPARATELY**  
Scope: V2-0 bootstrap domain correction  
Production: **NOT AUTHORIZED**  
Physical iPhone: **NOT VERIFIED**

## 1. Why this correction exists

The first V2 bootstrap correctly proved the React/Phaser/Vite/Playwright/Vercel pipeline, but its battle domain was an independent throwaway model. It used a 100 ms tick, JavaScript `number` gameplay values, non-canonical role names and a wave-only enemy curve. Building V2-1 on that model would have made the existing Step 2 and Step 3 evidence irrelevant to runtime behavior.

The scaffold is retained. The incorrect domain assumptions are superseded.

## 2. Direct source bindings

`packages/domain/src/canonical.ts` imports the exact repository sources below rather than retyping their formulas:

- `simulation/candidate-v3.json`
- `simulation/engine-v2/numeric.mjs`
- `simulation/engine-v2/rng.mjs`
- `simulation/engine-v2/tower.mjs`

The runtime therefore receives the candidate's:

- 50 ms fixed tick;
- normalized decimal-string and exact-rational numeric operations;
- deterministic RNG seed behavior;
- district, cycle, boss and modifier generation;
- Floor HP, attack and coin reward curves;
- no-visible-maximum tower rule;
- canonical launch character IDs and roles;
- coin-level cost curve.

The browser build aliases only Node platform primitives used by the sealed engine. The SHA-256 compatibility bridge is checked against Node's SHA-256 implementation. The simulation engine source itself is not copied or edited.

## 3. Runtime state corrections

The V2 snapshot schema is now version 2.

Canonical gameplay quantities are serialized as normalized unsigned decimal strings:

- floor;
- party level;
- run coin;
- kill count;
- character HP, maximum HP and attack;
- enemy HP, maximum HP, attack and reward;
- event amounts.

BigInt is used for state mutation. Bounded renderer/timer values such as animation milliseconds and HP display ratios may use `number`, but they are derived and are not persistence or economic authority.

The former `wave` field is removed. Enemy defeat grants the current canonical floor's coin value exactly once, then progresses to the next floor. Floor 10 continues to Floor 11.

## 4. Canonical launch party

| Stable ID | Name | Canonical role |
|---|---|---|
| `character.launch.001` | ムギ | `frontline-control` |
| `character.launch.002` | ルナ | `ranged-anti-air` |
| `character.launch.003` | トト | `healing-support` |
| `character.launch.004` | コハク | `runner-backline-disruption` |

These values are read and asserted from `candidate-v3`. A mismatch fails module initialization instead of silently substituting another vocabulary.

## 5. What is still provisional

The correction does **not** claim that a complete shared combat formula already exists in `simulation/engine-v2`. That engine currently exposes the canonical numeric, RNG, tower, economy and state-machine operations, but it does not expose a finished real-time four-character combat operation with per-character base HP, per-character attack and animation timing.

Accordingly:

- the four bootstrap cats' base HP, base attack and attack interval remain explicitly provisional;
- the current attack variance, healing amount and realtime cooldowns remain bootstrap behavior;
- `combat.damage.formulaVersion` is reported, but runtime status is `BOOTSTRAP_PROVISIONAL_NOT_MODEL_RESEALED`;
- Step 3's 15,000 scenarios and high-volume model evidence remain model evidence, not runtime playtest evidence;
- V2-1 must either add a shared combat operation consumed by both runtime and simulation or reseal the model against the actual shared domain.

This distinction is mandatory. Source binding is real; full combat-model equivalence is not yet proven.

## 6. Large-number boundary

`candidate-v3` expands generated floor values through Floor 1000 and returns exact symbolic-power expressions above that boundary. V2-0 combat fails closed when asked to instantiate a symbolic-stat enemy. It does not coerce `SYMBOLIC`, a huge decimal string or BigInt into an unsafe JavaScript `Number`.

This is not a finite-tower product limit. The product's player-visible maximum remains `NONE`. Symbolic combat arithmetic is a later runtime requirement and remains unresolved.

## 7. Acceptance covered here

- direct candidate-v3 and engine-v2 imports;
- tick 50 ms;
- exact launch IDs and roles;
- canonical floor 1/10/100/1000 parity tests;
- normalized decimal-string snapshots;
- deterministic replay;
- defeat → canonical reward → next floor;
- manual coin level purchase from the candidate cost curve;
- Floor 10 → Floor 11;
- symbolic-stat fail-closed behavior;
- browser SHA-256 parity;
- existing mobile viewport, render, error and overflow checks.

The actual result of each gate belongs in `docs/v2/HANDOFF_VALIDATION2.json`; this document must not be used as evidence by itself.
