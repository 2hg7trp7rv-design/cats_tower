# Cat's Tower simulation candidate input contract

Status: **SIMULATION_CANDIDATE — not validated balance**

Date: 2026-08-25

Canonical input: [`candidate-v1.json`](./candidate-v1.json)

Schema: [`candidate.schema.json`](./candidate.schema.json). A run is invalid unless the manifest parses, satisfies this schema, passes the cross-field assertions below, and records its own SHA-256 digest, every declared raw executable dependency digest, and every declared canonical JSON semantic-selection digest.

Validator: `node simulation/validate-candidate.mjs`. It first evaluates every JSON Schema keyword used by `candidate.schema.json` (including local `$ref`, type, required, const, enum, pattern, item/property counts, bounds and date shape), then runs the project-specific cross-field assertions. A top-level-field-only parse is not a schema pass.

The validator also checks a sealed executable-contract digest across the entire manifest. Object keys, array order and length, primitive types, strings, booleans, nulls and every immutable numeric value are exact. Only numeric leaves accepted by `allowedNumericPointerPatterns` and rejected by none of `immutableNumericPointerPatterns` are normalized as calibratable; `candidateId`, `createdAt`, raw executable dependency digest values, and canonical JSON semantic-selection digest values are the only normalized strings. Built-in positive and negative mutations prove that an allowed coefficient can change while a missing dynamic field, acceptance threshold or stop limit cannot pass.

## Purpose

This manifest supplies every initial value needed by the next two authorized phases. It is not game runtime and it does not make any coefficient final.

- Step 2 may use calibration seeds `1–200` to reject or revise the candidate while running purchases, combat, survival, Dawn, re-clear, and 0/8/24-hour offline progress through 100F.
- Step 3 must use the same untouched paired holdout bank `holdout-bank-001`, seeds `100000–100999`, for combat, reinforcement, and commerce: 1,000 seeds per build, 3,000 scenarios total.
- Before Step 3, every seeded fixture, probe, or diagnostic is confined to calibration seeds `1–200`. The holdout range must be disjoint from calibration and from every observed, finalized, or unresolved range in the complete lifecycle history, regardless of bank ID. A historical bank ID may not be rebound to another range, and a historical range may not be renamed to another bank ID.
- A bank becomes observed and spent when any seed-level result, aggregate statistic, acceptance verdict, or diagnostic derived from one or more bank seeds is materialized outside the running process. The first valid acceptance verdict is authoritative. A spent bank may be used only for diagnostics, never to tune or promote a candidate.
- One registered immutable-candidate consumption session may continue to completion after its first output spends the bank. It may not be resumed or rerun after partial output, a crash, an invalid dataset, or failure to create a valid verdict. Those cases spend the bank and require a disjoint bank.
- A valid verdict requires one candidate raw digest, one simulator raw digest, exactly 3,000 expected build-by-seed identities with no missing or duplicate record, strict result-schema success, independent aggregate recomputation, and one final acceptance record binding the raw dataset, summary, and verdict digests.
- Any manifest byte or simulator-semantics change invalidates every earlier Step 2 and Step 3 result. If a Step 3 verdict fails, partial materialization does not produce a valid verdict, or the candidate or simulator semantics changes after the bank is observed, return to Step 1, register a disjoint unobserved bank, re-seal, rerun all of Step 2, and only then run Step 3. Do not rerun the spent bank for promotion. A same-digest rerun is limited to byte-equivalence verification or infrastructure recovery that exposed no output.
- Step 2 PASS must atomically create `simulation/results/step-2/executable-seal.json`, which must pass [`executable-seal.schema.json`](./executable-seal.schema.json) and `node simulation/validate-executable-seal.mjs`. It binds the candidate, complete fixed-root simulator source tree, run plan, result schema and validator, exact Node version, raw dataset, summary, and acceptance digests. `simulation/run-plan.json#/simulatorSourceFiles` must equal the recursive regular non-symlink file closure under `simulation/engine`; computed dynamic imports and unlisted local code/data are forbidden. Step 3 verifies the strict raw seal and recomputes the complete tree before its first holdout draw. Workflow-status documents do not rewrite it.
- Step 3 records `CONSUMPTION_STARTED`, `NO_OUTPUT_INFRASTRUCTURE_FAILURE`, `OUTPUT_OBSERVED`, and `VERDICT_FINALIZED` transitions in the hash-chained append-only `simulation/results/step-3/holdout-bank-ledger.jsonl`. Records use the manifest's exact field order, UTF-8 `JSON.stringify` payload, `recordSha256` exclusion rule, sequence 1, all-zero genesis, prior-record-hash link, final LF, and raw-ledger SHA-256 revision. Preflight plus the start append is one exclusive compare-and-append operation. A prior intersecting observed/finalized range, intersecting unresolved start, range/ID reassignment, concurrent start, deletion, rewrite, truncation, broken chain, noncanonical line, duplicate record, or duplicate finalization aborts before promotion.

## Individual-actor atomic combat model

The simulator is a deterministic event model, not a visual-frame emulator.

1. A floor's EHP is the total damage required across its ordered waves or boss phases.
2. EHP is distributed by the declared `waveEhpShares`.
3. Every named cat and live helper has its own HP, timers, target, projectiles, skills and event IDs. Allied HP is never pooled.
4. Damage, healing, finite charges, KO, enemy EHP, wave transitions and the 90-second limit resolve in the manifest's fixed-step event order.
5. A floor succeeds only when the exact event trace reduces the final enemy EHP to zero while at least one selected named cat remains alive and every mandatory one-hit check passes.
6. Projected TTK, collapse time, survival margin and `effectivePowerScalar` are finite decision and diagnosis metrics only; they never award a floor clear.

The visual runtime later must still simulate actual entities, contact and synchronized feedback. Passing this simulation cannot prove motion or device quality.

## Purchase model

At each declared evaluation point, the simulator compares legal cat, helper, and shop upgrades using the same displayed before/after effective-power calculation. It buys positive-utility options atomically while respecting the coin reserve and loop bound. Every purchase, price, effect, and reason is logged.

The three builds differ by weights and preferred shops, not by hidden rules. They use the same floors, prices, wall-clock schedule, random distribution, and acceptance formulas.

## Dawn integrity

Permanent shards are the set difference between newly eligible milestones, district bosses, and one-time achievements and their claimed ledgers. Repeating a Dawn at the same maximum produces exactly zero permanent currency when `newRewardIds` is empty; a newly completed, still-unclaimed one-time achievement may enter that set once even when the maximum floor is unchanged. The non-stacking catch-up multiplier and free respec are recovery tools, not shard farms.

The expected 35–50% return time is paired per scenario with the exact reciprocal composite re-clear speed `2.00–2.857142857142857×`; `2.86×` is display rounding only. Raw attack alone may not supply that range.

## Offline integrity

The offline reference `U` depends only on highest reached floor, rewarding Dawn count (a Dawn with at least one new reward ID), and three fixed reference categories. A zero-reward recovery Dawn cannot raise it. It cannot read the equipped build, current coins, open menu, or last-second loadout. Its clamp uses the role-neutral reward curve, and it is persisted on every economy mutation and visibility transition and capped at 24 hours.

Step 2 must test seven repeated 24-hour cycles as well as isolated 0/8/24-hour returns. First-run offline progress awards coins only. Post-Dawn compression may re-clear known content only up to the lowest guarded boundary.

## Required result fields

Every scenario must record at least:

- manifest digest, simulator version, build, persona, and seed;
- every floor attempt, TTK, survival margin, weapon, waves, and failure reasons;
- every purchase and rejected purchase with before/after values;
- shop placements, live income, `U`, offline duration, offline coins, and guarded stop;
- permanent-award ledger, Dawn decision, shard delta, branch spend, and return time;
- combat, transition, first-time decision, touch-active, foreground, offline, and wall-clock time;
- D10_pre, Net10, build percentile inputs, switch count, dominant weapon share, and all acceptance failures.

Median-only reports are invalid. Step 3 reports p10, p50, p90, completion rate, stop rate, and raw seed-level evidence.

## Pre-run cross-field assertions

Schema validation alone is not enough. Before every Step 2 or Step 3 run, abort unless all of these pass:

- active, standard, and passive foreground/offline segments each sum to exactly 86,400 seconds;
- the current unobserved holdout bank is exactly `holdout-bank-001`, seeds `100000–100999`, and is paired across all three builds; no candidate or simulator decision has read a result derived from that bank;
- every wave or phase EHP share and every build utility-weight vector sums to `1` within `0.000001`;
- all 12 cat IDs, 10 boss IDs, 10 district IDs, 10 shop IDs, 4 support IDs, 3 relic IDs, 3 armaments, 3 Dawn branches, and 33 Dawn reward IDs used by the manifest exist in `PROJECT_STATUS.json.stableIdRegistry`;
- the Dawn ledger contains 20 milestone IDs, 10 boss IDs, and 3 one-time achievement IDs, totaling at most 43 shards;
- zero-reward Dawn never increments `rewardingDawnCount`, and `U(f+1,d) >= U(f,d)` plus `U(f,d+1) >= U(f,d)` for all floors `0–100` and Dawn counts `0–10`;
- F1 resolves to one enemy, F100 resolves to four phases, and no formula ID lacks an operand declaration;
- the candidate digest, every `sourceDependencyDigests.rawFiles` digest, and every declared canonical JSON selection digest match; before Step 3, every field in the Step 2 executable seal also matches and the holdout lifecycle ledger proves that the selected bank is unobserved.
