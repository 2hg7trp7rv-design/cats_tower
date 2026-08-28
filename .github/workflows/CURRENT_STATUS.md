<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->
## 現在の正式Gate

- Step 1: **PASS**
- Step 2: **PASS / SEALED**
- Step 3: **IN_PROGRESS**
- Step 4: **BLOCKED_UNTIL_TERMINAL_EVIDENCE**
- Balance verdict: **PASS_PENDING_EVIDENCE**
- Physical iPhone: **NOT_VERIFIED**
- Production alias changed: **false**
<!-- CATS_TOWER_STEP3_STATUS_END -->

# Cat's Tower workflow status

Updated: **2026-08-28**

## Current verdict

- Step 1 Round 008: `PASS`
- Step 2: `PASS — SEALED`
- Step 3: `READY_TO_START`
- Step 4〜6: `BLOCKED BY PRIOR GATES`
- Step 2 balance verdict: `NOT_EVALUATED_STEP2`
- physical iPhone: `NOT_VERIFIED`
- Production change: `false`

Active Step 1 seal: `quality-reviews/step-1-reseal-round-008/seal-round-008.json`

Active Step 2 seal: `simulation/executable-seal-v2.json`

Step 2 terminal read-back: `quality-reviews/step-2-executable-contract-v2/final-live-readback.json`

## Workflow responsibility split

`.github/workflows/verify-main.yml` uses two independent jobs.

### `historical-round7-evidence`

- Validates the legacy Round 7 acceptance, seal and completion only from immutable historical worktrees.
- The legacy validator receives the historical repository root.
- It must not require Round 7 current-state marker lines in live Round 008/Step 2 files.
- It must not authorize the current product, Step 2 or Step 3.

### `current-governance`

- Validates the live Round 008 Step 1 seal and Step 2 executable seal.
- Validates `active-change-control`, latest addendum, `AI_PROJECT_POLICY.json`, `QUALITY_GATE.md`, `PROJECT_STATUS.json`, `simulation/CURRENT_STATUS.json`, `AGENTS.md`, `PROJECT_HANDOVER.md` and this workflow mirror.
- Runs `simulation/verify-step2-v2.mjs` on the exact checked-out commit.
- Rejects changes outside the governance-repair allowlist relative to repair entry HEAD `510157c97e7e94456df8d45c3af20082e71aced6`.

Restoring an obsolete Step 1A marker to live `AGENTS.md` or another current mirror in order to satisfy a historical assertion is forbidden.

## Step 2 evidence

- semantic commit/tree: `724d04940f9f3794b993cddbc5af3a7163a0395b` / `3552f5820681bd1fe037ac637fafc96b485e35f6`
- executable seal blob: `ee3507969c03b08fe27350263cf0bc093a1c18e1`
- dedicated workflow: `.github/workflows/verify-step-2-v2.yml`
- run/job: `33104391753` / `98630217077`
- conclusion: `SUCCESS`
- seal validator: `PASS_EXECUTABLE_SEAL_V2`
- independent critics: `5`
- unresolved P0/P1: `0 / 0`
- qualification: `30` scenarios
- balance verdict: `NOT_EVALUATED_STEP2`

## Current execution boundary

Allowed after governance repair completion and terminal read-back:

- Step 3 large-scale validation artifacts and evidence
- 15,000 gameplay scenarios
- calibration 12,000 / unseen holdout 3,000
- separate gacha-tail, pity, duplicate, refund/replay/race, state-machine and large-number suites

Forbidden until later gates:

- runtime
- assets
- backend
- payment provider
- ad network
- Production alias
- physical-iPhone PASS claim

The 30-scenario Step 2 qualification is an executable-chain qualification, not a game-balance PASS.
