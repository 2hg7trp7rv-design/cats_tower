# Cat's Tower — ChatGPT Project bootstrap

更新日: **2026-08-26**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**

## 1. 採用構成

Cat's Towerの長期開発は次の三層で運用する。

1. **ChatGPT Project** — 複数チャット、添付画像、参考資料、作業履歴の作業本部
2. **GitHub `kimi`** — 仕様、コード、データ、品質証拠、進捗の唯一のlive正本
3. **Custom GPT** — 利用可能な場合だけ、既存Projectチャット内で呼ぶ補助的な制作・監査役

ProjectやCustom GPTの会話、Knowledge、アップロード済み固定コピーをlive GitHub `kimi`より上位の正本にしない。

## 2. Project source

現行の完全置換版は次の一件だけ。

- `CHATGPT_PROJECT_INSTRUCTIONS1.md`

旧`CHATGPT_PROJECT_INSTRUCTIONS.md`はlive `kimi`から削除済みで、Project内でも同時に有効化しない。

Project instructionsには`CHATGPT_PROJECT_INSTRUCTIONS1.md`の全文を使用する。全文を設定できない場合も、Project sourceとして同ファイルを一件だけ追加し、live `kimi`再読を必須にする。

## 3. Projectへ入れる資料

### 入れる

- `CHATGPT_PROJECT_INSTRUCTIONS1.md`
- `CHATGPT_PROJECT_BOOTSTRAP.md`
- ユーザー提供の画面画像、動画、比較資料
- 物理iPhoneのtest動画・screenshot
- 重要な調査PDF、決定資料

### 原則として固定コピーを入れない

- `MASTER_SPEC.md`
- `PROJECT_STATUS.json`
- `QUALITY_GATE.md`
- candidate、schema、validator
- runtime code
- balance data
- 最新のquality evidence

これらは変更頻度が高いため、GitHub connectorからlive `kimi`を読む。Projectへ一時的に入れた場合も、静的snapshotであることを明示する。

## 4. 現在の製品境界

Cat's Towerは、猫と猫人の4体編成を育成し、店舗・配送の支援を受け、上限のない塔を登り、一つのstrong new gameで1Fから高速再攻略する放置インクリメンタルRPGである。

- 100Fは最初の大型節目。101F以降も継続
- コインlevel無制限、100levelごとのruby進化
- `N < R < RR < SR < SSR < UR`
- character/weapon gacha分離
- 初回入手で機能完成、20体分以上は任意の完全熟練
- login、payment、rewarded opt-in ad
- S01〜S12
- server-authoritative permanent economy

有限100F・非ガチャ設計の旧PASSは履歴証拠であり、現在のStep 2を許可しない。

## 5. 現在の工程

- Step 1: **正本統合・再封印 — IN_PROGRESS**
- Step 2〜6: **BLOCKED**
- 次の許可チャット: **`01_正本仕様・競合調査`**
- runtime / backend / payment / ad network: 未実装
- physical iPhone: `NOT_VERIFIED`

## 6. 推奨チャット構成

### `00_統括・工程管理`

- 工程、依存関係、重大方針変更
- live entry pointと状態mirrorの同期
- 次工程の許可
- 専門チャットの証拠統合

### `01_正本仕様・競合調査`

- repository-wide contradiction inventory
- 下位正本redline
- 競合・platform policy・privacy調査
- stable ID、状態遷移、backend trust boundary
- Step 2 dependency closure
- 独立批評と新Step 1 seal

### `02_無制限塔・経済・リセットシミュレーション`

- 新candidate、schema、validator、simulator
- 無制限塔、大数、reset、ruby、evolution、offline

### `03_3ビルド・ガチャ・重複熟練・進化・課金検証`

- 3build×5persona×各1,000seed以上
- probability、pity、duplicate、F2P、payer、refund、race

### `04_UIUX・12画面完成見本`

- S01〜S12
- 正常・異常state
- mobile density、片手操作、5秒理解

### `05_アート・キャラ・武器制作`

- art bible
- cat/catfolk identity
- character、weapon、enemy、shop、background、effect

### `06_1〜10F・基盤実装`

- battle、tower、shop、character、weapon、evolution、reset、local save

### `07_サーバー・アカウント・課金・広告実装`

- account、wallet、draw、pity、ledger、payment、login、ad、entitlement

### `08_自動QA・Vercel検証`

- build、deterministic test、browser、screenshot、performance、evidence

### `09_iPhone実機検証`

- tap、触覚、発熱、電池、PWA、billing、ad、長時間利用

### `10_無制限塔・コンテンツ量産・ライブ運営拡張`

- 1〜10Fと基盤Gate合格後のみ
- 101F以降のcycle、event、将来live operations

## 7. 新しいチャットの開始手順

専門チャットの最初に次を要求する。

> `2hg7trp7rv-design/cats_tower`のlive `kimi`だけを対象にする。最初にbranch、HEAD、tree、`CHATGPT_PROJECT_INSTRUCTIONS1.md`、active change-control、`MASTER_SPEC.md`、`PROJECT_STATUS.json`、`QUALITY_GATE.md`、`AGENTS.md`、対象Acceptanceを確認する。有限100F・非ガチャの旧PASSを現行許可に使わず、許可された工程だけを進める。別branch、PR、merge、Production変更を行わない。コードやdeploymentが揃っただけで完成とせず、実物、経済、確率、backend、見た目、操作、比較、回帰、exact commit/tree/deployment証拠を通して判定する。

ファイルが見つからない場合は検索し、存在を推測しない。

## 8. Custom GPT

Custom GPTを使う場合は`CUSTOM_GPT_CONFIGURATION.md`を参照する。Custom GPTはProjectの代替ではなく、live `kimi`を毎回再読する補助役とする。

Custom GPTの新規作成可否、編集可否、モバイル対応等はChatGPT製品側で変わり得るため、このbootstrapへ固定断定しない。利用時点の公式案内と実際のworkspace機能を確認する。

## 9. 引き継ぎ

各チャットの終端で、最低限以下をGitHubへ記録する。

- repository、branch
- base/content/evidence commit、tree
- deployment ID、URL、target、commit一致
- authorized step、status
- Acceptance
- produced artifacts
- creator / critic / judge
- repairs、regression
- runtime、asset、candidate、schema、backend、Production変更
- physical-device evidence
- unresolved P0/P1
- next allowed chat/action

重要判断をチャットだけに残さない。
