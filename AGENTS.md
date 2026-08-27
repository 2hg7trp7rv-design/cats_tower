# Cat's Tower repository instructions

更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**  
Step 1 Round 008: **PASS**  
Step 2: **READY_TO_START**  
Step 3〜6: **BLOCKED BY PRIOR GATES**

## Branch hard lock

- 書込みは既存`kimi`のみ。毎回live HEAD/treeを再取得する。
- branch作成・切替・書込み・削除、PR、merge、rebase、cherry-pick、force-pushは禁止。
- Production alias、課金商品公開、広告network有効化、data deletionは明示承認なしに実行しない。

## Authority order

1. 最新のユーザー明示決定
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. active change-control、最新addendum、user-decision-lock
4. `quality-reviews/step-1-reseal-round-008/seal-round-008.json`
5. seal対象`MASTER_SPEC.md`と`canonical/*`
6. `PROJECT_STATUS.json`、`QUALITY_GATE.md`、Acceptance、critics、judge、handover、deployment/completion evidence
7. Step 2 executable contract
8. historical PASS、legacy、参考資料

過去証拠は改変しないが、現行許可に使わない。

## Step 1 seal

- semantic commit/tree: `4b4d8abbf5388637101f7c5634d1ce5d60413fce` / `99084efa0e6055977b01cf507d7d7e2a391c74ce`
- seal commit/tree: `0b17f9b5b8decdab8ce329287a4dc073790c4bf7` / `9eac6b6103d65cf8bcb13859d00e43cd3389fa8a`
- final unresolved P0/P1: `0 / 0`
- physical iPhone: `NOT_VERIFIED`

## Product non-negotiables

- cat/catfolk、常設4体、一時増援別層
- shop/income/delivery/recruitment/reinvestmentはcombat support
- unbounded visible tower、100F milestone、101F+
- tap direct damage 0、auto/offline基礎、mandatory collection/refill tappingなし
- one reset `reset.tower_return`、Floor 1、高速reclear、repeat-best ruby 0
- uncapped coin level、every-100 ruby evolution、evolution非gate
- rarity `N < R < RR < SR < SSR < UR`、N/R deterministic/long-term utility
- separate character/weapon gacha、100/200 targets、carryover/exchange/history
- first copy functional、20+ optional full mastery、diminishing returns、overflow
- paid/free ruby provenance、explicit spent-grant refund deficit
- login/payment/rewarded opt-in ads、immutable accepted configuration versions
- S01〜S12、server-authoritative permanent economy
- arbitrary-precision numeric contract

## Step 2 preflight

1. live HEAD/tree、seal、completion/read-backを確認する。
2. Step 2専用Acceptance Matrixを最初のwrite前に固定する。
3. `canonical/STEP2_DEPENDENCY_CLOSURE.json`と全source blob/digestを固定する。
4. new V2 candidate/schema/validator/simulator/result/run-plan/fixtures/migrations/executable-seal chainを作る。
5. calibrationとholdoutを分離する。
6. Step 2 critic、final judge、completion evidenceまでPASSさせる。
7. Step 2 PASS前にStep 3を開始しない。

## Legacy simulation and workflow

V1 candidate/schema/validator、旧workflow、legacy runtimeはhistorical/implementation gap。current promotion実行、in-place延命、old observed holdout再利用を禁止する。

## Current write boundary

Allowed: Step 2 V2 executable contract、validator、simulator、result schema、run plan、fixtures、migrations、専用workflow、quality evidence。  
Forbidden: runtime、assets、backend、payment provider、ad network、PR、Production alias、Step 3 simulation before Step 2 PASS。

## Completion

files、build、tests、deployment `READY`だけでPASSにしない。Acceptance、実物、意味対応、決定論、確率・経済、台帳・race、批評、修正、回帰、exact commit/tree/deployment/evidence、P0/P1=0を必要とする。physical iPhone証拠なしに実機確認済みとしない。
