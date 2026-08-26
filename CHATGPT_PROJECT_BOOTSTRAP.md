# Cat's Tower — ChatGPT Project bootstrap

更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**

## 1. 構成

- ChatGPT Project: 複数チャットと参考資料の作業本部
- GitHub `kimi`: 仕様、状態、code、data、evidenceの唯一のlive正本
- Custom GPT: live `kimi`を再読する補助役

現行Project sourceは`CHATGPT_PROJECT_INSTRUCTIONS1.md`だけ。旧`CHATGPT_PROJECT_INSTRUCTIONS.md`を同時に有効化しない。

## 2. 現在地

- Step 1: `IN_PROGRESS`
- Route 01-0: `PASS`
- Route 01-1: content complete、`checkpoint-c-evidence.json`結合後にPASS
- Step 2〜6: `BLOCKED`
- physical iPhone: `NOT_VERIFIED`

現在の3 registryは`PRESEAL_DRAFT`。`FLOORS_1_10_DESIGN.md`は`PENDING_REVALIDATION`。Step 2 closure、policy gate、Step 1 sealは未作成。

## 3. 新チャット開始手順

1. live repository、既存`kimi`、HEAD、tree
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. active change-control、最新addendum、decision lock、handover、checkpoint evidence
4. `MASTER_SPEC.md`、`PROJECT_STATUS.json`、`QUALITY_GATE.md`、`AGENTS.md`
5. 対象の下位正本、schema、validator、workflow、runtime
6. 許可工程とwrite boundary
7. Acceptance Matrix
8. exact commit/tree/deployment証拠形式

未作成ファイルを推測せず、旧PASSやVercel `READY`を現行許可に使わない。

## 4. 現在読むRound 008 artifact

- `quality-reviews/step-1-reseal-round-008/checkpoint-a-evidence.json`
- `quality-reviews/step-1-reseal-round-008/checkpoint-b-evidence.json`
- `quality-reviews/step-1-reseal-round-008/route-01-1-acceptance.json`
- `quality-reviews/step-1-reseal-round-008/path-classification.json`
- `quality-reviews/step-1-reseal-round-008/claim-match-register.json`
- `quality-reviews/step-1-reseal-round-008/current-authority-zero-proof.json`
- `quality-reviews/step-1-reseal-round-008/contradiction-inventory.json`

## 5. 工程別チャット

- `00_統括・工程管理`
- `01_正本仕様・競合調査`
- `02_無制限塔・経済・リセットシミュレーション`
- `03_3ビルド・ガチャ・重複熟練・進化・課金検証`
- `04_UIUX・12画面完成見本`
- `05_アート・キャラ・武器制作`
- `06_1〜10F・基盤実装`
- `07_サーバー・アカウント・課金・広告実装`
- `08_自動QA・Vercel検証`
- `09_iPhone実機検証`
- `10_無制限塔・コンテンツ量産・ライブ運営拡張`

新Step 1 sealがPASSするまで`02`以降を開始しない。

## 6. 引き継ぎ

各checkpointでrepository、branch、base/content/evidence commit、tree、changed paths、deployment ID/URL/target/commit一致、P0/P1、禁止範囲、Production変更、物理端末状態、次actionをGitHubへ記録する。重要判断をチャットだけに残さない。

