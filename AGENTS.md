<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->
## 現在の正式Gate

- Step 1: **PASS**
- Step 2: **PASS / SEALED**
- Step 3: **PASS**
- Step 4: **READY_TO_START**
- Balance verdict: **PASS_STEP3_LARGE_SCALE_VALIDATION**
- Physical iPhone: **NOT_VERIFIED**
- Production alias changed: **false**
<!-- CATS_TOWER_STEP3_STATUS_END -->

# Cat's Tower repository instructions

更新日: **2026-08-28**
Repository: `2hg7trp7rv-design/cats_tower`
書込みbranch: **既存の`kimi`のみ**

## Branch hard lock

- 書込みは既存`kimi`のみ。毎回live HEAD/treeを取得する。
- branch作成・切替・書込み・削除、PR、merge、rebase、cherry-pick、force-pushは禁止。
- Production alias、課金商品公開、広告network有効化、data deletionは明示承認なしに実行しない。

## Authority order

1. 最新のユーザー明示決定
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. active change-controlと最新addendum
4. Step 1 Round 008 seal
5. Step 2 executable sealとcompletion/read-back chain
6. Step 3 acceptance、execution gate、analysis、5 critics、final judge、completion、terminal read-back、mirror correction
7. `PROJECT_STATUS.json`、`simulation/CURRENT_STATUS.json`、`QUALITY_GATE.md`
8. historical PASS、legacy、参考資料

過去証拠は改変しない。旧Round 7 current markerや旧Step 2 READY文言を現行状態へ復元しない。

## Sealed checkpoints

### Step 1

- status: `PASS`
- unresolved P0/P1: `0 / 0`

### Step 2

- status: `PASS_SEALED`
- executable seal blob: `ee3507969c03b08fe27350263cf0bc093a1c18e1`
- critics: `5`
- unresolved P0/P1: `0 / 0`

### Step 3

- status: `PASS`
- gameplay: `15,000`
- high-volume: `1,700,000`
- critics: `5`
- unresolved P0/P1: `0 / 0`
- terminal verdict: `PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION`
- holdout reused for tuning: `false`
- candidate mutation: `false`

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

## Current write boundary

Allowed next: **Step 4 twelve-screen final mockups**.

Forbidden: runtime、assets、backend、payment provider、ad network、Production alias、physical-iPhone PASS claim、Step 2 executable mutation。

## Completion rule

files、build、tests、deployment READYだけで完成判定しない。Acceptance、意味対応、決定論、確率・経済、台帳・race、独立批評、修正、回帰、exact commit/tree/evidence、P0/P1=0を必要とする。physical iPhone証拠なしに実機確認済みとしない。
