# Cat's Tower simulation input contract — current status

Status: **STEP 2 READY_TO_START — CREATE NEW V2 ONLY**  
Updated: **2026-08-27**  
Step 1 Round 008: **PASS**

## Required authority before work

1. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
2. active change-control and latest addendum
3. `quality-reviews/step-1-reseal-round-008/seal-round-008.json`
4. activation completion and live read-back
5. `MASTER_SPEC.md`、`PROJECT_STATUS.json`、`QUALITY_GATE.md`
6. `canonical/STEP2_DEPENDENCY_CLOSURE.json`
7. Step 2専用Acceptance Matrix

Step 1 semantic commit/tree: `4b4d8abbf5388637101f7c5634d1ce5d60413fce` / `99084efa0e6055977b01cf507d7d7e2a391c74ce`  
Step 1 seal commit/tree: `0b17f9b5b8decdab8ce329287a4dc073790c4bf7` / `9eac6b6103d65cf8bcb13859d00e43cd3389fa8a`

## V1 disposition

次はhistorical implementation evidenceだけである。

- `simulation/candidate-v1.json`
- `simulation/candidate.schema.json`
- `simulation/validate-candidate.mjs`
- old executable seal/result/holdout/workflow contract

Current promotionへ実行しない、in-place延命しない、observed holdoutを再利用しない。

## Step 2 required replacement

最初のwrite前にAcceptanceを固定し、次を新規作成する。

- `simulation/candidate-v2.json`
- `simulation/candidate-v2.schema.json`
- `simulation/validate-candidate-v2.mjs`
- `simulation/run-plan-v2.json`
- `simulation/result-v2.schema.json`
- `simulation/validate-result-v2.mjs`
- `simulation/engine-v2/**`
- `simulation/fixtures/v2/**`
- `simulation/migrations/v1-to-v2/**`
- `simulation/executable-seal-v2.json`
- `simulation/executable-seal-v2.schema.json`
- `simulation/validate-executable-seal-v2.mjs`

## Mandatory V2 domains

- unbounded tower and arbitrary-precision numbers
- unique generated IDs、one reset、loss/keep/gain、anti-farm、reclear
- levels/evolution/rarity/characters/weapons
- separate character/weapon gacha、pity、guarantee、carryover、exchange
- first-copy/practical/20+ mastery/overflow
- paid/free wallet、explicit refund deficit
- immutable ad-offer/login-campaign versions
- payment/refund/revocation/restore、ads、login、entitlements、accounts
- S01-S12 and server state transitions
- fields、enums、units、invariants、fixtures、migrations、validators、output/evidence
- 3 builds × 5 personas × 1,000 seeds plus separate Monte Carlo/state/property tests

## Current verdict

- Step 1: `PASS`
- Step 2: `READY_TO_START`
- V2 executable artifacts: `NOT_CREATED`
- Step 3 allowed: `false`
- runtime/backend implemented: `false`
- physical iPhone: `NOT_VERIFIED`
