# Cat's Tower — ChatGPT Project bootstrap

更新日: 2026-08-26

## 採用構成

Cat's Towerの長期開発では、次の三層を使う。

1. **ChatGPT Project** — 複数チャット、画像、参考資料、作業履歴をまとめる作業本部
2. **GitHub `kimi`** — 仕様、コード、データ、品質証拠、進捗の唯一の正本
3. **Custom GPT** — 利用可能な場合だけ、既存Projectチャット内で呼ぶ制作・監査補助役

ProjectやCustom GPTの会話内容を、live GitHub `kimi`より上位の正本にしない。

## 現在のChatGPT製品上の制約

OpenAI公式情報では、2026年8月26日時点でFree、Go、Plus、Proを含む個人アカウントは、新しいCustom GPTを作成・公開できない。既存GPTは条件を満たせば利用・編集できる。新規作成は、許可されたBusiness、Enterprise、Edu workspaceが対象である。

また、GPTの新規作成・編集はWeb版のみで、モバイルアプリは利用のみをサポートする。GPTは保存メモリや過去会話を自動利用しない。

一方、ChatGPT ProjectsはProを含む各プランで利用でき、Project内のファイル、指示、チャットを長期作業の文脈として扱える。Project-only memoryを選ぶと、他Projectや通常チャットから分離できる。

公式参照:

- https://help.openai.com/en/articles/8554397-creating-a-gpt
- https://help.openai.com/en/articles/8554407-gpts-in-chatgpt
- https://help.openai.com/en/articles/10169521-projects-in-chatgpt

したがって、個人Pro・スマートフォン中心の現在は、**Projectを主役にする**。Custom GPTは既存GPTがある場合、または将来対象workspaceを使用する場合だけ追加する。

## Project作成設定

### Project name

`Cat's Tower 開発本部`

### Memory

`Project-only memory`

理由:

- Cat's Tower以外の会話や記憶を混ぜない
- Project内の複数チャットは相互参照できる
- 長期開発の判断と資料を一つの作業空間へ閉じ込める

### Project instructions

`CHATGPT_PROJECT_INSTRUCTIONS.md`の本文をProject instructionsへ設定する。

Project instructionsへ全文が入らない場合は、次の最小指示を設定し、完全版はProjectファイルとして追加する。

> Cat's Tower専任。唯一のrepositoryは2hg7trp7rv-design/cats_tower、書込み可能branchは既存kimiのみ。別branch作成・切替・書込み・PR・merge・rebase・cherry-pick・force-push禁止。毎回live kimiを確認し、MASTER_SPEC.md、QUALITY_GATE.md、AGENTS.md、AI_PROJECT_POLICY.json、PROJECT_STATUS.json、PROJECT_HANDOVER.md、対象quality-reviewsを読む。コード、画像、ファイル、build、test、deploymentが揃っただけでは完成扱いしない。期待定義→制作→最終サイズ実物確認→コード監査→見た目監査→操作感監査→比較→独立批評→修正→回帰→exact commit/deployment証拠の順でG1〜G5を判定し、全PASS時だけ完成報告する。通常の欠陥検品をユーザーへ戻さず、ChatGPT側で修正・再検証する。ユーザーにコードを書かせない。物理iPhone未確認は実機確認済みと断定しない。

## Projectへ入れる資料

### 入れる

- 今回承認する10画面の高解像度画像
- 商人サーガ等の合法的に使用できる参考スクリーンショット
- ユーザーが撮影したVercel Preview動画
- 物理iPhoneテスト動画とスクリーンショット
- 重要な比較資料、調査PDF
- `CHATGPT_PROJECT_INSTRUCTIONS.md`
- `CHATGPT_PROJECT_BOOTSTRAP.md`

### 原則として固定コピーを入れない

- `MASTER_SPEC.md`
- `PROJECT_STATUS.json`
- runtime code
- balance data
- 最新の品質判定ファイル

これらは更新頻度が高く、Project内コピーが古くなるため、GitHub connectorからlive `kimi`を読む。

## 関連チャットの移動

通常ChatGPTチャットはProjectへ移動できる場合がある。Cat's Towerに関する既存チャットのうち、仕様判断、実機フィードバック、画面評価、工程固定を含むものをProjectへ移動する。

Custom GPTから開始したチャットはProjectへ移動できない場合があるため、長期作業はProject内の通常チャットから開始する。

## 推奨チャット構成

### 00_統括・工程管理

用途:

- 現在工程
- PASS / IN_PROGRESS / BLOCKED
- 依存関係
- 重要な方針変更
- 次工程の許可

このチャットだけで制作を行わず、各専門チャットの証拠を統合する。

### 01_正本仕様・市場調査

用途:

- 勇者と商人の統合
- 大型放置ゲーム機能の採否
- 競合調査
- 仕様差分
- Step 1の再封印

### 02_100Fシミュレーション

用途:

- 購入
- 戦闘
- 店舗
- 夜明け
- 24時間放置
- 進行停止とインフレ監査

### 03_3ビルド1000検証

用途:

- 戦闘
- 増援
- 商業
- holdout bank
- 昇格判定

### 04_UIUX・完成見本

用途:

- 主要画面
- 全state
- 情報階層
- 片手操作
- 見た目監査
- 5秒理解

### 05_アート・スプライト

用途:

- art bible
- 猫の同一性
- 敵
- 店舗
- 背景
- animation
- effect
- asset manifest

### 06_1〜10F実装

用途:

- runtime
- data
- save
- input
- battle
- shop
- offline
- screen integration

### 07_自動QA・Vercel検証

用途:

- build
- deterministic tests
- screenshot comparison
- browser verification
- performance
- exact commit/deployment evidence

### 08_iPhone実機検証

用途:

- 3分ボス戦
- 10分連続
- 誤操作
- 触覚
- 音
- 発熱
- 電池
- PWA復帰

### 09_100F量産・運営拡張

用途:

- 1〜10F Gate合格後のみ
- 11〜100F
- シーズン
- guild
- live operations

## 各チャットの開始文

新しい専門チャットでは、次を最初に送る。

> `2hg7trp7rv-design/cats_tower` のlive `kimi`だけを対象にする。最初にbranch、HEAD、正本文書、AI_PROJECT_POLICY.json、現在工程、対象Acceptanceを確認し、別branchを一切使わず、許可された工程だけを進めて。コードや素材が揃ったことを完成条件にせず、実物、見た目、操作感、コード、比較、回帰の内部監査を通してから判定する。

## Custom GPTを使える場合

新規作成が可能なworkspaceまたは編集可能な既存GPTがある場合、`CUSTOM_GPT_CONFIGURATION.md`を使用する。

Projectとの併用時は、Project内に既に存在するチャットでCustom GPTを呼び出す。Custom GPTを最初のメッセージから使うと、Project外のGPTチャットとして始まる場合がある。

スマートフォンアプリ中心ではCustom GPT呼出し機能に制限があるため、Custom GPTへ依存しない。Project instructionsとGitHub policyだけで同じ規則を成立させる。

## ChatGPTが毎回残す引き継ぎ

- repository
- branch
- base commit
- resulting commit
- Vercel URL
- authorized step
- status
- Acceptance
- produced artifacts
- visual audit
- interaction audit
- code audit
- independent critique
- repairs
- regression
- physical-device evidence
- unresolved and excluded items
- next allowed action

重要判断をチャットだけに残さず、`PROJECT_HANDOVER.md`または`quality-reviews`配下へ保存する。
