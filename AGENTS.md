# Cat's Tower repository instructions

更新日: **2026-08-26**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込み可能branch: **既存の`kimi`のみ**  
現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**  
次の許可チャット: **`01_正本仕様・競合調査`**  
Step 2〜6: **BLOCKED**

このファイルはrepository全体に適用する。会話履歴、旧PASS、legacy runtime、古いcandidate、古いworkflow成功を現行製品の許可として扱わない。

## 1. branch hard lock

- 書込みは既存の`kimi`だけ
- branch作成、別branch切替・書込み・削除、PR、merge、rebase、cherry-pick、force-pushは禁止
- 書込みツールでは毎回`branch=kimi`を明示
- repositoryまたはlive `kimi`を確認できない場合は`BLOCKED`
- Production alias、課金商品公開、広告network有効化、データ削除等はユーザーの明示承認なしに実行しない

## 2. 情報源の優先順位

同一scopeで競合した場合は次の順で扱う。

1. ユーザーの最新の明示的な製品決定
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. active change-control、最新addendum、user-decision-lock
4. `MASTER_SPEC.md`
5. `PROJECT_STATUS.json`、`QUALITY_GATE.md`、本書
6. 下位正本、handover、README、bootstrap
7. Step 2以降のcandidate、schema、validator、workflow
8. 過去PASS、legacy runtime、過去チャット、参考画像

過去証拠は改変しない。ただし、現行工程・現行製品を許可しない。

## 3. 作業開始手順

1. live `kimi`のHEADとtreeを取得
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`を読む
3. active change-controlと最新のdecision・handover・evidenceを読む
4. `MASTER_SPEC.md`、`PROJECT_STATUS.json`、`QUALITY_GATE.md`、本書を読む
5. 対象の下位正本、schema、validator、workflow、runtimeを読む
6. 現在許可された工程とwrite boundaryを確認
7. Acceptance Matrixを作成
8. 変更対象、依存先、失敗条件、証拠形式を固定

矛盾を見つけた場合、都合のよい方を選ばず後工程を停止し、同じ変更管理で解消する。

## 4. 現行製品の非交渉条件

- プレイアブルは猫と猫人
- 常設の名前付き編成は4体。一時増援は別layer
- 商人要素は店舗、収益、配送、募集、再投資として戦闘を支援し、商会会長を主役にしない
- 塔はプレイヤーから見て上限なし
- 100Fは最初の大型節目。101F以降も継続
- tapによる直接damageは0
- auto battleとoffline progressを基礎にする
- resetは一つだけ。旧Dawnは統合・改名・廃止
- reset後は1Fから高速再攻略
- コインlevelは無制限、100levelごとにruby進化資格
- 進化しなくてもlevelを継続可能
- rarityは`N < R < RR < SR < SSR < UR`
- N・Rは確定非ガチャ経路と長期用途を持つ
- character gachaとweapon gachaを分離
- routine mass drawはcharacter/weapon ticket主体
- 100 hard pity、200 featured guaranteeを設計目標とする
- 初回入手で機能完成。20体分以上は任意の長期完全熟練
- 新規・月間・復帰login、payment、rewarded opt-in adを持つ
- 初期版にforced interstitial、banner ad、PvP、競争報酬、guild競争、battle passを入れない
- canonical screenはS01〜S12
- 恒久wallet、draw、pity、取得、duplicate、evolution、login、ad、payment、entitlementはserver authority
- 最低検証は3build×5persona×各1,000seed以上と別枠Monte Carlo

## 5. 旧仕様の扱い

次を現行要件として案内してはならない。

- 1F〜100Fが最終商品
- 101F禁止
- ガチャ・有償通貨・login・広告禁止
- Dawnを独立resetとして維持
- 9画面固定
- 3,000scenarioだけで十分
- localStorageだけで恒久経済を管理
- 旧Step 1 PASSからStep 2開始を許可

これらが残るファイルは、明示的にhistory、legacy、superseded、または`PENDING_REVALIDATION`と分類する。

## 6. 現在許可される作業

### 00で許可

- live entry pointの現行化
- 旧仕様を現行権威から外すfail-closed処理
- 状態mirror、handover、bootstrap、quality gateの同期
- 監査証拠の作成

### 01で許可

- repository-wide contradiction inventory
- 下位正本redline
- 競合・platform policy調査
- stable ID、状態遷移、backend trust boundary
- Step 2 dependency closure
- 独立批評と新Step 1 seal

### 現在禁止

- 旧candidateでsimulationを開始
- candidate、schema、validator、simulatorを現行製品の実行契約として昇格
- runtime、asset、backend、payment provider、ad networkの実装開始
- Production alias変更
- Step 2以降のPASS宣言

## 7. legacy simulationとworkflow

`simulation/candidate-v1.json`、`candidate.schema.json`、`validate-candidate.mjs`、旧run plan、旧workflowは、有限100F・Dawn・3,000scenario契約を含む歴史的入力である。

- 01が意味仕様とdependency closureを固定するまで実行禁止
- 旧workflowが成功しても現行Step 1またはStep 2を許可しない
- 新しいcandidateは新candidateIdと新digestを必要とする
- 旧holdout bank、旧seal、旧resultは新製品の昇格判定に再利用しない

## 8. 完成判定

`QUALITY_GATE.md`のG1〜G9、独立批評、回帰、exact commit/tree/deployment証拠を通す。build、test、Vercel `READY`だけで完成にしない。未解決P0/P1が一つでもあれば`IN_PROGRESS`。

## 9. 実物・コード・経済監査

最低限、以下を確認する。

- 320×667、375×667、390×844のmobile density
- 猫の移動、接敵、弾着、damage、hit reactionの因果
- 戦闘、塔、店舗、編成、キャラ、武器、進化、reset、gacha、store、loginの通常・異常導線
- 大数、rounding、serialize、save migration
- paid/free ruby、transaction ID、idempotency、race、refund、restore
- probability、pity、carryover、duplicate、overflow
- no-ad F2P、ad F2P、monthly、payer、high-spend stress
- privacy、未成年者保護、広告同意、account deletion

物理iPhone証拠なしに触覚、発熱、電池、実tap、PWA復帰を確認済みとしない。

## 10. ユーザー境界

通常の欠陥発見、修正、比較、コード作業をユーザーへ戻さない。ユーザー確認は、製品方針を大きく変える同等案、固有権限、外部契約、破壊的操作、物理端末証拠に限定する。

## 11. 報告

repository、branch、base/content/evidence commit、tree、changed paths、deployment、工程、判定、P0/P1、Production変更、物理iPhone状態、次の許可工程を記録する。
