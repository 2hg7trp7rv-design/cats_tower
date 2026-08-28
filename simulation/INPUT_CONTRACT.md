# Cat's Tower simulation input contract — current status

Status: **STEP 2 SEALED / STEP 3 PASS**
Updated: **2026-08-28**

## Current authority

- Step 1 Round 008: `PASS`
- Step 2 executable seal: `PASS_SEALED`
- Step 3 large-scale validation: `PASS`
- Step 4: `READY_TO_START`
- candidate: `simulation/candidate-v2.json` — immutable for this completed Step 3 round
- run plan: `simulation/run-plan-v2.json`
- execution contract: `simulation/execution-contract-v2.json`
- executable seal blob: `ee3507969c03b08fe27350263cf0bc093a1c18e1`

## V1 disposition

V1 candidate/schema/executable evidenceはhistorical comparisonだけに使用する。current promotionへ実行、in-place延命、observed holdout再利用をしない。

## V2 sealed domains

- unbounded tower and arbitrary-precision numbers
- reset、loss/keep/gain、anti-farm、reclear
- levels/evolution/rarity/characters/weapons
- separate character/weapon gacha、pity、guarantee、carryover、exchange
- first-copy/practical/20+ mastery/overflow
- paid/free wallet、refund deficit、payment/refund/revocation/restore
- ads、login、entitlements、accounts、S01-S12 state transitions

## Step 3 execution result

- calibration: `12,000`
- unseen holdout: `3,000`
- gameplay total: `15,000`
- high-volume total: `1,700,000`
- holdout tuning reuse: `false`
- candidate mutation: `false`
- critics: `5`
- unresolved P0/P1: `0 / 0`
- balance verdict: `PASS_STEP3_LARGE_SCALE_VALIDATION`

## Current boundary

Step 4 may consume the sealed Step 3 result for twelve-screen mockups. Step 2/3 executable inputs may not be silently mutated. runtime/backend/provider/Production/physical-iPhone PASS remain later gates.
