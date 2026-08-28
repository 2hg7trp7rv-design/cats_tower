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

# Cat's Tower repository instructions

更新日: **2026-08-28**
Repository: `2hg7trp7rv-design/cats_tower`
書込みbranch: **既存の`kimi`のみ**
Step 1 Round 008: **PASS**
Step 2: **PASS — SEALED**
Step 3: **IN_PROGRESS**
Step 4〜6: **BLOCKED BY PRIOR GATES**

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
6. `PROJECT_STATUS.json`、`simulation/CURRENT_STATUS.json`、`QUALITY_GATE.md`、Acceptance、critics、judge、handover、completion/read-back evidence
7. Step 2 executable seal
8. historical PASS、legacy、参考資料

過去証拠は改変しない。旧Round 7のcurrent-status markerをRound 008以降の現行文書へ偽装復元してはならない。

## Step 1 seal

- semantic commit/tree: `4b4d8abbf5388637101f7c5634d1ce5d60413fce` / `99084efa0e6055977b01cf507d7d7e2a391c74ce`
- seal commit/tree: `0b17f9b5b8decdab8ce329287a4dc073790c4bf7` / `9eac6b6103d65cf8bcb13859d00e43cd3389fa8a`
- unresolved P0/P1: `0 / 0`

## Step 2 sealed checkpoint

- semantic commit/tree: `724d04940f9f3794b993cddbc5af3a7163a0395b` / `3552f5820681bd1fe037ac637fafc96b485e35f6`
- executable seal: `simulation/executable-seal-v2.json`
- seal blob: `ee3507969c03b08fe27350263cf0bc093a1c18e1`
- seal activation commit/tree: `89174eeebb033fe807a0592c8df0279c2a7b9a6f` / `ccf444df436d63d86fd4da0355f20349753b0546`
- dedicated CI run/job: `33104391753` / `98630217077`
- CI conclusion: `SUCCESS`
- seal validator: `PASS_EXECUTABLE_SEAL_V2`
- independent critics: `5`
- unresolved P0/P1: `0 / 0`
- tracked P2: `6`
- final judge: `PASS_STEP2_QUALITY_REVIEW_PENDING_SEAL_ACTIVATION`
- completion evidence: `quality-reviews/step-2-executable-contract-v2/completion-evidence.json`
- live read-back gate: `quality-reviews/step-2-executable-contract-v2/live-readback.json`
- qualification: `30` scenarios
- qualification digest: `a24fa5a4a12cf132ac477c80e77431cd0b97ab070bbbef83c3881c160f42562c`
- balance verdict: `NOT_EVALUATED_STEP2`
- physical iPhone: `NOT_VERIFIED`
- Production: unchanged

Step 2 PASSは実行契約の封印を意味する。ゲームバランス合格、production backend完成、実機品質確認を意味しない。

## Product non-negotiables

- cat/catfolk、常設4体、一時増援別層
- unbounded visible tower、100F milestone、101F+
- tap direct damage 0、auto/offline基礎
- one reset `reset.tower_return`、Floor 1、高速reclear、repeat-best ruby 0
- uncapped coin level、every-100 ruby evolution、evolution非gate
- rarity `N < R < RR < SR < SSR < UR`
- separate character/weapon gacha、100/200 guarantees、carryover/exchange/history
- first copy functional、20+ optional full mastery、diminishing returns、overflow
- paid/free ruby provenance、explicit spent-grant refund deficit
- S01〜S12、server-authoritative permanent economy
- arbitrary-precision numeric contract

## Step 3 authorization

Step 3で初めて、sealed run planに従って次を実行する。

- 3 builds × 5 personas × 1,000 seeds = minimum `15,000` gameplay scenarios
- calibration `12,000` / unseen holdout `3,000`
- gacha tails / pity / duplicate skew / refund-replay-race / state machine / large-number high-volume suites
- 1〜10F、100F、1,000F、10,000F相当、repeated reset、30〜45日経済
- p50/p90/p99、F2P保証到達、build格差、課金倍率を実測判定

Step 3ではholdoutを調整に再利用しない。Step 2の30件qualificationをバランス合格として扱わない。

## Legacy workflow discrepancy

`.github/workflows/verify-main.yml`には旧Round 7 current-marker assertionが残り、Round 008以降の現行status modelと不整合である。旧markerを復元して通してはならない。historical Round 7 evidence validationとcurrent status validationを将来のgovernance repairで分離する。このP2は専用Step 2 executable contractのPASSを否定しない。

## Current write boundary

Allowed next: Step 3 large-scale validation artifacts and evidence only.
Forbidden until later gates: runtime、assets、backend、payment provider、ad network、Production alias、physical-iPhone PASS claim。

## Completion rule

files、build、tests、deployment `READY`だけで完成判定しない。Acceptance、意味対応、決定論、確率・経済、台帳・race、独立批評、修正、回帰、exact commit/tree/evidence、P0/P1=0を必要とする。physical iPhone証拠なしに実機確認済みとしない。
