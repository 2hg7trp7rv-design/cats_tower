# Cat's Tower simulation input contract — current status

Status: **BLOCKED_SUPERSEDED_INPUT — DO NOT RUN V1**  
Updated: **2026-08-27**  
Current: **Step 1 Round 008 final preseal review — IN_PROGRESS**

## V1 disposition

Current live files created for the finite-100F/Dawn/no-gacha/3,000-scenario product are historical implementation evidence only:

- `simulation/candidate-v1.json`
- `simulation/candidate.schema.json`
- `simulation/validate-candidate.mjs`
- old executable seal/result/holdout/workflow contract

They may not authorize current Step 2/3, may not be executed for promotion, may not be extended in place, and observed holdout data may not be reused for new promotion.

## Step 1 semantic authority

Before Step 2, read Project source, active control, valid live Step 1 seal, master/status/gate, and `canonical/STEP2_DEPENDENCY_CLOSURE.json`. If the seal is absent or invalid, abort before V2 file creation or execution.

The dependency closure now defines:

- unbounded tower and arbitrary-precision numbers
- one reset/loss-keep-gain/anti-farm/reclear
- levels/evolution/rarity/characters/weapons
- character/weapon gacha, pity, guarantee, carryover, exchange
- first-copy/practical/20+ mastery/overflow
- wallet/login/payment/ads/entitlements/accounts
- S01-S12 and server state transitions
- fields, enums, units, invariants, fixtures, migrations, validators, output/evidence
- 3 builds × 5 personas × 1,000 seeds plus separate Monte Carlo/state/property tests

## Step 2 required replacement

After a valid Step 1 seal, Step 2 must create new V2 candidate/schema/validator/simulator/result/run-plan/fixtures/migrations/executable-seal artifacts with new candidateId, schemaVersion and algorithmVersion. Missing dependencies and implicit legacy defaults are fatal.

## Current verdict

- V1 preserved: PASS
- V1 usable for current promotion: NO
- dependency closure: PRESEAL complete
- V2 executable artifacts: NOT_CREATED
- Step 2 allowed now: false
- runtime/backend implemented: false
- physical iPhone: NOT_VERIFIED
