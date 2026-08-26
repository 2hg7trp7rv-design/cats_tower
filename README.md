# Cat's Tower

Cat's Towerは、猫と猫人の冒険者を育て、塔内の店舗と配送から支援を受け、プレイヤーから見て上限のない塔を登り、行き詰まったら一つの強くてニューゲームで1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPGです。

## 現在地

- Repository: `2hg7trp7rv-design/cats_tower`
- 書込み可能branch: 既存の`kimi`のみ
- 現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**
- 00中核権威同期: **PASS**
- 00 live entry point同期: **PASS**
- Step 2〜6: **BLOCKED**
- 最初の実装slice: 1F〜10F
- 1〜10F Preview Ready: `false`
- 無制限塔Product Ready: `false`
- 物理iPhone: `NOT_VERIFIED`
- Production: 現行legacy runtime。今回の正本同期で変更しない

有限100F・非ガチャ設計に対する旧PASSはGit履歴上の証拠です。現在の無制限塔・ガチャ・収益化設計を承認せず、Step 2開始も許可しません。

## 現行製品の要点

- 塔はプレイヤーから見て上限なし
- 100Fは最初の大型節目。101F以降も継続
- プレイアブルは猫と猫人、常設4体編成
- 店舗・収益・配送・募集・再投資は戦闘支援として残し、商会会長を主役にしない
- 一つのCat's Tower独自reset。旧Dawnは統合・改名・廃止
- コインlevel無制限、100levelごとのruby進化
- rarityは`N < R < RR < SR < SSR < UR`
- character gachaとweapon gachaを分離
- 初回入手で機能完成、20体分以上は任意の長期完全熟練
- 新規・月間・復帰login、payment、rewarded opt-in ad
- canonical screenはS01〜S12
- 恒久経済と権利はserver authority
- 最低15,000scenarioと別枠Monte Carloを後続検証基準とする

## 正本と入口文書

作業開始時は次の順で確認します。

1. [`CHATGPT_PROJECT_INSTRUCTIONS1.md`](./CHATGPT_PROJECT_INSTRUCTIONS1.md)
2. [`quality-reviews/step-1-canonical-design/active-change-control.json`](./quality-reviews/step-1-canonical-design/active-change-control.json)
3. [`MASTER_SPEC.md`](./MASTER_SPEC.md)
4. [`PROJECT_STATUS.json`](./PROJECT_STATUS.json)
5. [`QUALITY_GATE.md`](./QUALITY_GATE.md)
6. [`AGENTS.md`](./AGENTS.md)
7. [`PROJECT_HANDOVER.md`](./PROJECT_HANDOVER.md)
8. 対象のAcceptance、decision lock、handover、evidence

旧`CHATGPT_PROJECT_INSTRUCTIONS.md`はlive `kimi`から削除済みで、現行Project sourceではありません。

## 現在の実行順序

1. **Step 1 — 正本統合・再封印**
2. **Step 2 — 実行可能contractとsimulation**
3. **Step 3 — 3build・5persona・確率・長期進行の大量検証**
4. **Step 4 — S01〜S12の完成見本**
5. **Step 5 — 1〜10Fと必要backendの実装**
6. **Step 6 — physical iPhone、billing、広告、PWA、長時間検証**

前工程のPASS前に後工程へ進みません。

## 12画面

| ID | 主責務 |
|---|---|
| S01 | title / resume / account recovery |
| S02 | battle follow |
| S03 | unbounded tower browse / cycle / milestone |
| S04 | floor clear / reward / room choice |
| S05 | shop placement / delivery / reconfigure |
| S06 | character / level / evolution / mastery |
| S07 | weapon / equipment / weapon mastery / build |
| S08 | boss variant / telegraph / break / failure |
| S09 | strong new game / lose-keep-gain / ruby |
| S10 | character and weapon gacha / odds / pity / exchange / history |
| S11 | store / ruby / rewarded ads / entitlements |
| S12 | newcomer / monthly / returner login / inbox / claim history |

required stateの完全な集合は`PROJECT_STATUS.json.canonicalScreens`と新しいStep 1 sealで固定します。

## legacy runtime

現在のHTML、JavaScript、CSS、asset、saveはV0.8.2由来の比較・復旧baselineです。現行正本の実装済み画面、経済、ガチャ、backendを意味しません。

- legacy runtimeが起動すること
- GitHub Actionsが旧contractで成功すること
- Vercelが`READY`になること

これらだけでは現在のStep 1、Preview Ready、Product ReadyをPASSにできません。

## simulationの現在状態

`simulation/candidate-v1.json`、旧schema、旧validator、旧run planは有限100F・Dawn・3,000scenario契約を含む歴史的入力です。`simulation/INPUT_CONTRACT.md`と`simulation/CURRENT_STATUS.json`のfail-closed判定に従い、01のdependency closureと新Step 1 sealが完成するまで実行しません。

## 次のチャット

次に許可されるのは **`01_正本仕様・競合調査`** です。

01ではrepository-wide contradiction inventory、下位正本redline、競合・platform policy調査、stable ID、状態遷移、backend trust boundary、Step 2 dependency closure、独立批評、新Step 1 sealを完成させます。

## 開発ルール

- 変更対象は既存の`kimi`だけ
- 別branch、PR、merge、rebase、cherry-pick、force-pushは禁止
- build・test・deploymentだけで完成扱いしない
- 通常の欠陥発見、修正、再検証をユーザーへ丸投げしない
- Production変更、課金商品公開、広告network有効化等は明示承認なしに行わない
- 物理iPhone未確認を実機確認済みと表現しない
