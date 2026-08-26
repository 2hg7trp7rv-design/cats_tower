# Cat's Tower — 完成判定と工程Gate

更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**  
現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**  
現在checkpoint: **Round 008 Route 01-1 — PASS after checkpoint-c evidence**  
次の許可チャット: **`01_正本仕様・競合調査`の継続**  
Step 2〜6: **BLOCKED**  
物理iPhone: **NOT_VERIFIED**

本書は現行製品と工程の完成判定正本である。有限100F・非ガチャ・独立Dawn・9画面・3,000scenario・local-only恒久経済に対する旧Acceptance、旧PASS、旧workflow成功は履歴証拠として保持するが、現行Step 1またはStep 2を承認しない。

## 1. 現在の権威とpreseal

情報源は、ユーザーの最新決定、`CHATGPT_PROJECT_INSTRUCTIONS1.md`、active change-controlと最新addendum/decision lock、検証済みStep 1 seal、seal対象正本、現行Acceptance/critic/judge/evidence、下位正本、旧証拠の順。

現在の以下は`PRESEAL_DRAFT`であり、内部内容だけでStep 2を許可しない。

- `MASTER_SPEC.md`
- `canonical/STABLE_ID_REGISTRY.json`
- `canonical/SCREEN_STATE_REGISTRY.json`
- `canonical/STATE_TRANSITION_CONTRACT.json`

未作成:

- `canonical/STEP2_DEPENDENCY_CLOSURE.json`
- `canonical/POLICY_RELEASE_GATES.json`
- `quality-reviews/step-1-reseal-round-008/seal-round-008.json`

## 2. fail-closed旧主張

次を現行要件・許可として扱う成果物は不合格。

- 1F〜100Fが最終商品、101F禁止、100F ending
- gacha、有償ruby、login、payment、ads禁止
- 通貨は二種類だけ
- Dawnを独立resetとして維持
- 9画面固定
- character/weapon gachaなし、duplicate masteryなし
- 3build×1,000seedの3,000scenarioだけで十分
- localStorageだけで恒久経済を管理
- 商会会長・会社経営をプレイヤーの主役にする
- 旧PASSやVercel `READY`からStep 2/Product Readyを許可する

過去証拠内の同文は削除せずC5履歴として保持する。旧candidate/schema/validator/workflowはC3、legacy runtime/test/assetsはC4、現在文書内の禁止・失効説明はC6とする。

## 3. 完成ループ

1. Acceptance固定
2. 制作
3. 実物自己検収
4. コード・データ・経済・確率・台帳・privacy監査
5. 独立批評
6. 修正
7. 回帰
8. exact `kimi` commit/tree/deployment結合
9. final judge
10. seal

ファイル存在、build、test、Vercel `READY`、sandbox応答は単独の完成証拠ではない。

## 4. Gate

| Gate | 判定対象 | 最低証拠 |
|---|---|---|
| G1 | 最新決定・正本・禁止事項 | Acceptance、対照表、未対応0 |
| G2 | 実物品質 | 全state、最終サイズ、仮物0 |
| G3 | 人間期待 | 5秒理解、次操作、失敗回復 |
| G4 | 比較・反証 | 競合比較、独立critic、P0/P1=0 |
| G5 | 通常利用 | E2E、異常、resume、save |
| G6 | 正本・工程 | current-authority旧主張0、mirror一致 |
| G7 | 経済・確率 | F2P、pity、duplicate、長期階層 |
| G8 | server/policy | idempotency、refund、privacy、未成年 |
| G9 | mobile/実機 | 320/375/390px、safe-area、実機境界 |

## 5. Route 01-1 Gate

Route 01-1は次がすべて成立し、`checkpoint-c-evidence.json`へ結合された場合だけPASS。

- exact recursive treeを基準に全pathへC1〜C5を割当
- current file内の旧主張引用をC6へ分類
- claim-family 13種の全matchへpath-ruleを適用
- unclassified path 0
- unclassified match 0
- current-authority superseded assertion 0
- historical evidence byte変更0
- runtime/assets/V1/backend/provider/Production/PR操作0
- exact content/evidence commit-tree-deployment

参照:

- `quality-reviews/step-1-reseal-round-008/path-classification.json`
- `quality-reviews/step-1-reseal-round-008/claim-match-register.json`
- `quality-reviews/step-1-reseal-round-008/current-authority-zero-proof.json`
- `quality-reviews/step-1-reseal-round-008/contradiction-inventory.json`

Route 01-1 PASSはStep 1全体のPASSではない。`FLOORS_1_10_DESIGN.md`、policy gate、Step 2 closure、critic、sealは後続RouteのP1 blockerとして残る。

## 6. Step 1最終Gate

- repository-wide contradiction inventory完成
- 下位正本・入口・mirror統合
- S01〜S12、stable ID、migration、state transition完成
- `FLOORS_1_10_DESIGN.md`再封印
- Step 2 dependency closure完成
- 競合・Apple/Google/日本国内policy、privacy、未成年者保護記録
- 11独立批評の未解決P0/P1=0
- history不変
- runtime/assets/V1/backend/Production無断変更0
- exact content commit/tree/Preview/evidence commit/seal

現在は`IN_PROGRESS`。Step 2開始は`false`。

## 7. 状態語と報告

- `NOT_STARTED`
- `PENDING_REVALIDATION`
- `IN_PROGRESS`
- `BLOCKED`
- `PASS`

報告にはrepository、branch、base/content/evidence commit、tree、changed paths、deployment ID/URL/state/target/commit一致、工程、P0/P1、変更境界、Production変更、物理iPhone状態を含める。

