# Cat's Tower 引き継ぎ書

更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
Branch: **既存の`kimi`のみ**  
現在工程: **Step 1 — IN_PROGRESS**  
現在checkpoint: **Round 008 Route 01-1 completion**  
Step 2〜6: **BLOCKED**  
物理iPhone: **NOT_VERIFIED**

## 1. 完了済み

- 00 Round 006 core authority: `SCOPED_PASS`
- 00 Round 007 entrypoint containment: `SCOPED_PASS`
- Route 01-0 governance recovery: `PASS`
  - content `77df8b720733e4af6e22220e39950d2e9ff25df4`
  - evidence `ea5a060c23b7e4a18bc179b4289beb8f1502f4a6`

過去証拠は現行Step 2を許可しない。

## 2. Route 01-1

exact treeを優先順位付きpath ruleへ分類し、13 familyの旧主張を次へ分離した。

- C1 current authority
- C2 active mirror/guard/evidence
- C3 superseded executable
- C4 legacy runtime/test/assets
- C5 immutable history
- C6 current file内の禁止・失効説明

結果候補:

- unclassified path: `0`
- unclassified match: `0`
- current-authority superseded assertion: `0`
- Route 01-1 P0/P1: `0 / 0`

`checkpoint-c-evidence.json`がexact content commit/tree/Previewへ結合した時点でRoute 01-1 PASS。Step 1全体は引き続き`IN_PROGRESS`。

## 3. 残るStep 1 blocker

- `FLOORS_1_10_DESIGN.md`再設計
- `canonical/POLICY_RELEASE_GATES.json`
- `canonical/STEP2_DEPENDENCY_CLOSURE.json`
- 下位mirror統合
- 11独立criticと修正
- final judge、evidence、seal

## 4. 禁止範囲

runtime、assets、V1 candidate/schema/validator/simulator、backend、payment/ad provider、他branch、PR操作、Production aliasは変更しない。

## 5. 次

`01_正本仕様・競合調査`のRoute 01-2へ進み、2026-08-26基準の競合、Apple、Google、日本国内rule、privacy、未成年者保護を一次資料優先で調査する。

