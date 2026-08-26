# Cat's Tower repository instructions

更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込み可能branch: **既存の`kimi`のみ**  
現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**  
現在checkpoint: **Round 008 Route 01-1 completion / checkpoint-c evidence**  
Step 2〜6: **BLOCKED**

## 1. hard lock

- 書込みは既存`kimi`だけ。全writeで`branch=kimi`を明示
- branch作成、別branch切替・書込み・削除、PR運用、merge、rebase、cherry-pick、force-pushは禁止
- Production alias、課金商品公開、広告network有効化、データ削除は明示承認なしに実行しない
- repository、branch、HEAD/tree、Acceptanceを確認できなければ`BLOCKED`

## 2. 情報源順位

1. ユーザーの最新明示決定
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. active change-control、最新addendum、user-decision-lock
4. liveで検証済みの新Step 1 seal
5. seal対象の`MASTER_SPEC.md`、`PROJECT_STATUS.json`、`canonical/*`
6. Acceptance、critic、judge、handover、deployment evidence
7. 下位正本、Step 2 contract、runtime
8. 過去PASS、legacy、会話、参考資料

過去証拠は改変しない。未封印draftや存在しないファイルを権威として扱わない。

## 3. 作業開始

1. live `kimi` HEAD/tree
2. Project source
3. active controlと最新addendum/decision/evidence
4. `MASTER_SPEC.md`、`PROJECT_STATUS.json`、`QUALITY_GATE.md`、本書
5. 対象の下位正本、schema、validator、workflow、runtime
6. 許可工程とwrite boundary
7. Acceptance
8. 変更対象・依存・失敗条件・証拠形式

## 4. 現行製品境界

- 猫/catfolk、常設4体、一時増援は別layer
- 店舗・収益・配送・募集・再投資は戦闘支援。商会会長を主役にしない
- 上限なし。100Fは最初の大型節目、101F以降も継続
- tap damage 0、auto battle/offlineが基礎
- resetは一つ、1Fから高速再攻略、旧Dawnはmigration-only
- coin level上限なし、100levelごとのruby進化、未進化でもlevel継続
- `N < R < RR < SR < SSR < UR`
- N/R確定経路と長期用途
- character/weapon gacha分離、100 hard pity/200 featured保証目標
- first copy機能完成、20体分以上は任意長期熟練
- login、payment、rewarded opt-in ad
- S01〜S12
- 恒久経済はserver authority
- 15,000scenario以上＋別枠Monte Carlo/state tests

## 5. 現在のartifact状態

`PRESEAL_DRAFT`:

- `MASTER_SPEC.md`
- `canonical/STABLE_ID_REGISTRY.json`
- `canonical/SCREEN_STATE_REGISTRY.json`
- `canonical/STATE_TRANSITION_CONTRACT.json`

`PENDING_REVALIDATION`:

- `FLOORS_1_10_DESIGN.md`

`PLANNED_NOT_CREATED`:

- `canonical/STEP2_DEPENDENCY_CLOSURE.json`
- `canonical/POLICY_RELEASE_GATES.json`

`NOT_CREATED`:

- `quality-reviews/step-1-reseal-round-008/seal-round-008.json`

## 6. Route 01-1

全path分類、claim match register、current-authority zero proofは以下を使う。

- `quality-reviews/step-1-reseal-round-008/path-classification.json`
- `quality-reviews/step-1-reseal-round-008/claim-match-register.json`
- `quality-reviews/step-1-reseal-round-008/current-authority-zero-proof.json`
- `quality-reviews/step-1-reseal-round-008/contradiction-inventory.json`

Route 01-1がPASSしてもStep 1全体は`IN_PROGRESS`、Step 2は`BLOCKED`。

## 7. legacy境界

- old candidate/schema/validator/workflow: C3、実行・昇格禁止
- runtime/test/scripts/assets: C4、Step 5以降の実装差分
- historical Acceptance/PASS/audits/baselines: C5、byte保持
- current docs内の旧主張引用: C6、禁止・失効説明のみ

## 8. 完成判定

`QUALITY_GATE.md`のG1〜G9、11独立批評、P0/P1=0、exact commit/tree/deployment/evidence/sealを必要とする。Vercel `READY`だけで完成にしない。物理iPhone証拠なしに実tap、haptics、thermal、battery、PWA復帰をPASSにしない。

