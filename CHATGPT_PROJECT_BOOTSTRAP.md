# Cat's Tower — ChatGPT Project bootstrap

更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
Writable branch: **existing `kimi` only**

## Live source

Project sourceは`CHATGPT_PROJECT_INSTRUCTIONS1.md`だけを有効にする。旧版を同時に使わず、会話やupload snapshotよりlive `kimi`を優先する。

## Start every chat

1. live `kimi` HEAD/tree
2. Project source
3. active change-control、latest addendum、user-decision-lock
4. valid seal、completion evidence、live read-back
5. `MASTER_SPEC.md`、`PROJECT_STATUS.json`、`QUALITY_GATE.md`、`AGENTS.md`
6. 対象Acceptanceとcontract
7. authorized step/write boundary

存在しないfileを推測しない。

## Current state

- Step 1 Round 008: `PASS`
- Step 2: `READY_TO_START`
- Step 3〜6: prior Gate未通過のため`BLOCKED`
- Step 1 seal: `quality-reviews/step-1-reseal-round-008/seal-round-008.json`
- semantic commit/tree: `4b4d8abb...` / `99084efa...`
- seal commit/tree: `0b17f9b5...` / `9eac6b61...`
- physical iPhone: `NOT_VERIFIED`

## Next authorized chat

`02_無制限塔・経済・リセットシミュレーション`

Step 2では最初のwrite前にAcceptance Matrixを作り、`canonical/STEP2_DEPENDENCY_CLOSURE.json`からnew V2 executable contractを作る。旧V1をcurrent promotionへ実行・延命せず、observed holdoutを再利用しない。Step 2 PASS前に`03`を開始しない。

## Handover minimum

repository、branch、content/evidence commit/tree、deployment binding、Acceptance、critic/judge、P0/P1、changed/forbidden paths、Production change、physical-device state、next authorized workをGitHubへ残す。
