# Cat's Tower

Cat's Towerは、猫と猫人の冒険者を育て、塔内の店舗と配送から戦闘支援を受け、プレイヤーから見て上限のない塔を登り、一つの強くてニューゲームで1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPGです。

## 現在地

- Repository: `2hg7trp7rv-design/cats_tower`
- 書込み可能branch: 既存の`kimi`のみ
- 現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**
- 現在checkpoint: **Round 008 Route 01-0**
- 00中核権威同期: **SCOPED_PASS**
- 00 live entrypoint containment: **SCOPED_PASS**
- 新Step 1 seal: **NOT_CREATED**
- Step 2〜6: **BLOCKED**
- 最初の実装slice: 1F〜10F
- 1〜10F Preview Ready: `false`
- 無制限塔Product Ready: `false`
- 物理iPhone: `NOT_VERIFIED`
- Production: legacy runtime。Route 01-0で変更しない

有限100F・非ガチャ設計に対する旧PASSはGit履歴上の証拠です。現在の無制限塔・ガチャ・収益化設計を承認せず、Step 2開始も許可しません。

## 情報源の順序

1. ユーザーの最新明示決定
2. [`CHATGPT_PROJECT_INSTRUCTIONS1.md`](./CHATGPT_PROJECT_INSTRUCTIONS1.md)
3. [`quality-reviews/step-1-canonical-design/active-change-control.json`](./quality-reviews/step-1-canonical-design/active-change-control.json)
4. 最新のactive-change-control addendumとuser-decision-lock
5. liveで検証済みの新Step 1 seal
6. [`MASTER_SPEC.md`](./MASTER_SPEC.md)、[`PROJECT_STATUS.json`](./PROJECT_STATUS.json)、[`QUALITY_GATE.md`](./QUALITY_GATE.md)、[`AGENTS.md`](./AGENTS.md)
7. 下位正本、Step 2契約、runtime
8. 過去PASS、legacy資料、参考資料

## PRESEAL artifacts

現在の以下3ファイルはRound 008 seal前のdraftです。

- [`canonical/STABLE_ID_REGISTRY.json`](./canonical/STABLE_ID_REGISTRY.json)
- [`canonical/SCREEN_STATE_REGISTRY.json`](./canonical/SCREEN_STATE_REGISTRY.json)
- [`canonical/STATE_TRANSITION_CONTRACT.json`](./canonical/STATE_TRANSITION_CONTRACT.json)

以下はまだ存在しません。

- `canonical/STEP2_DEPENDENCY_CLOSURE.json`
- `canonical/POLICY_RELEASE_GATES.json`
- `quality-reviews/step-1-reseal-round-008/seal-round-008.json`

存在しないファイルやPRESEAL_DRAFTはStep 2を許可しません。

## 現行製品の要点

- 塔はプレイヤーから見て上限なし
- 100Fは最初の大型節目。101F以降も継続
- プレイアブルは猫と猫人、常設4体編成
- 店舗・収益・配送・募集・再投資は戦闘支援
- tapによる直接damageは0
- 一つのCat's Tower独自reset。旧Dawnは統合・改名・廃止
- コインlevel無制限、100levelごとのruby進化
- rarityは`N < R < RR < SR < SSR < UR`
- character gachaとweapon gachaを分離
- 初回入手で機能完成、20体分以上は任意の長期完全熟練
- 新規・月間・復帰login、payment、rewarded opt-in ad
- canonical screenはS01〜S12
- 恒久経済と権利はserver authority
- 最低15,000scenarioと別枠Monte Carloを後続検証基準とする

## 現在の実行順序

1. **Step 1 — 正本統合・再封印 — IN_PROGRESS**
2. **Step 2 — 実行可能contractとsimulation — BLOCKED**
3. **Step 3 — 大量検証 — BLOCKED**
4. **Step 4 — S01〜S12完成見本 — BLOCKED**
5. **Step 5 — 1〜10Fと必要backend実装 — BLOCKED**
6. **Step 6 — physical iPhone検証 — BLOCKED**

## stale external artifact

draft PR #8は、失効した「商人サーガ1:1忠実版」説明を持つ外部stale artifactです。現行正本、作業経路、完成証拠として使いません。Route 01-0では更新、close、mergeを行いません。

## legacy runtimeとsimulation

現在のHTML、JavaScript、CSS、asset、saveはV0.8.2由来の比較・復旧baselineです。旧candidate/schema/validator/workflowも歴史的入力です。起動、test、Vercel `READY`だけで現在のStep 1、Preview Ready、Product ReadyをPASSにできません。

## 次の作業

次に許可されるのは **`01_正本仕様・競合調査`の継続** です。Route 01-0のevidence成立後、repository-wide Acceptanceとcontradiction inventoryへ進みます。

## 開発ルール

- 変更対象は既存の`kimi`だけ
- 別branch、PR、merge、rebase、cherry-pick、force-pushは禁止
- build・test・deploymentだけで完成扱いしない
- Production変更、課金商品公開、広告network有効化等は明示承認なしに行わない
- 物理iPhone未確認を実機確認済みと表現しない
