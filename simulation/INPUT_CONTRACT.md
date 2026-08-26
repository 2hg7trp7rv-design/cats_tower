# Cat's Tower simulation input contract — current status

Status: **BLOCKED_SUPERSEDED_INPUT — DO NOT RUN**  
Date: **2026-08-26**  
Current phase: **Step 1 canonical integration and reseal — IN_PROGRESS**  
Next authorized chat: **`01_正本仕様・競合調査`**

## 1. Fail-closed declaration

The following existing files were created for the superseded finite-100F, Dawn, nine-screen, three-build-only product and are **not executable authority for the current product**.

- `simulation/candidate-v1.json`
- `simulation/candidate.schema.json`
- `simulation/validate-candidate.mjs`
- the existing simulator, run plan, result schema, executable seal and holdout-bank contract
- workflow mirrors that validate or promote the old contract

They may be read as historical implementation evidence only. They may not authorize Step 2, Step 3, UI production, runtime implementation or Product Ready.

The exact previous contract remains available in Git history at commit `d3f617fcd9b992a83ec95214a93ad2ce1a2682af` and earlier. This live file intentionally replaces its active routing role without rewriting historical commits.

## 2. Why the old input is invalid

The old contract assumes one or more of the following superseded semantics.

- 1F〜100F is the final product
- Floor 101 does not exist
- Dawn is the active independent prestige system
- two currencies and no gacha
- nine canonical screens
- twelve deterministic cats and fixed 100F content closure
- exactly 3,000 build-by-seed identities are sufficient
- local clock and local save boundaries designed before server-owned monetized economy

The current product instead requires an unbounded player-visible tower, one original strong-new-game reset, ruby evolution, character and weapon gacha, duplicate mastery, login, payments, rewarded ads, twelve screens and server-authoritative permanent economy.

## 3. Current authoritative inputs

Before Step 2, read in this order.

1. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
2. active change-control and latest decision/evidence files
3. `MASTER_SPEC.md`
4. `PROJECT_STATUS.json`
5. `QUALITY_GATE.md`
6. `AGENTS.md`
7. the Step 1 seal created by `01_正本仕様・競合調査`
8. the Step 2 dependency closure produced by that seal

If the new Step 1 seal is absent, abort before candidate validation or scenario execution.

## 4. Step 1 responsibility

01 must freeze the meaning contract needed by Step 2 without pretending to have executed the new simulator.

At minimum, Step 1 must define:

- unbounded tower cycle, district, milestone and repetition-control semantics
- large-number representation, canonical serialization and rounding
- one reset system, loss/keep/gain, anti-farm and re-clear rules
- coin level, every-100-level ruby evolution and delayed catch-up
- rarity registry `N/R/RR/SR/SSR/UR`
- character and weapon registries, one weapon per active character
- first-copy, useful-breakpoint and 20-plus-copy full-mastery semantics
- character ticket, weapon ticket, pickup ticket and ruby routing
- 100 hard pity, 200 featured guarantee, carryover, exchange and overflow
- login, payment, advertisement and entitlement state machines
- server trust boundary, transaction ID and idempotency rules
- S01〜S12 and every required normal/error/refund/restore state
- personas, horizons, acceptance metrics and evidence closure

## 5. Step 2 required replacement

Step 2 must create a new executable contract. It may not mutate the old candidate in place and call it compatible.

Required outcomes include:

- a new `candidateId`
- a new schema version and algorithm version
- a new complete candidate whose fields cover all Step 1 semantics
- strict schema and project-specific validator
- deterministic simulator and complete source-tree closure
- result schema, validator, run plan and exact dependency digests
- calibration and holdout rules that include build and monetization personas
- safe large-number serialization across candidate, simulator and result
- state-transition fixtures for retries, duplicate callbacks, multi-tab, refund and restore
- exact executable seal before Step 3

Unknown or missing fields are fatal. Defaulting absent monetization, reset, gacha or large-number semantics to old behavior is prohibited.

## 6. Minimum validation matrix

The baseline matrix for later validation is:

`3 gameplay builds × 5 personas × 1,000 seeds = 15,000 scenarios or more`

Personas:

1. no-ad F2P
2. rewarded-ad F2P
3. monthly pass
4. controlled payer
5. high-spend stress

Required horizons include 1〜10F, the first 100F milestone, 1,000F, 10,000F or mathematical equivalent and repeated resets.

Separate high-volume Monte Carlo and state-transition tests are required for probability conformance, pity, featured guarantee, duplicates, full mastery, overflow, refund, replay, race and idempotency.

## 7. Historical holdout and result policy

Old holdout banks, old executable seals and old Step 2/3 results belong to the superseded product.

- do not use them to promote the new candidate
- do not reinterpret 3,000 old identities as the new 15,000-plus matrix
- do not reuse observed banks for new product promotion
- preserve them as immutable historical evidence
- create a new disjoint promotion contract after the new candidate is sealed

## 8. Workflow boundary

Existing workflow success may prove only that historical baseline or repository checks passed. Until 01 updates workflow mirrors and creates a new Step 1 seal, no workflow result may set current Step 1 or Step 2 to PASS.

See:

- `simulation/CURRENT_STATUS.json`
- `.github/workflows/CURRENT_STATUS.md`
- `quality-reviews/step-1-canonical-design/active-change-control.json`

## 9. Current verdict

- old input preserved in Git history: **PASS**
- old input usable for current product: **NO**
- new executable candidate: **NOT_CREATED**
- Step 2 allowed: **false**
- runtime implemented: **false**
- physical iPhone verified: **false**
