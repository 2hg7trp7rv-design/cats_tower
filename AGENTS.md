<!-- CATS_TOWER_STEP4_STATUS_BEGIN -->
## 現在の正式Gate

- Step 1: **PASS**
- Step 2: **PASS / SEALED**
- Step 3: **PASS**
- Step 4: **IN_PROGRESS**
- Step 5: **BLOCKED_UNTIL_STEP4_PASS**
- Unresolved P0/P1: **0 / 1**
- Physical iPhone: **NOT_VERIFIED**
- Production alias changed: **false**
<!-- CATS_TOWER_STEP4_STATUS_END -->

# Cat's Tower repository instructions

更新日: **2026-08-31**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**

## Branch hard lock

- 他branchの作成、切替、書込み、削除は禁止
- PR、merge、rebase、cherry-pick、force-pushは禁止
- GitHub書込みでは常に`branch=kimi`を明示する
- Production aliasはユーザーの明示承認なしに変更しない

## Current authority

1. 最新のユーザー決定
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. `quality-reviews/step-1-canonical-design/active-change-control-addendum-round-025.json`
4. Round 008 Step 1 seal
5. Step 2 executable seal
6. Step 3 terminal evidence
7. S02 actual-root visual-repair acceptance
8. S02 governance recovery critic / judge / evidence
9. current status mirrors

旧Step 4 draft、失敗したv2 execute / terminal、Vercel `READY`は現在の完成認可に使わない。

## Current work boundary

現在許可されるのは、S02 root実画面のStep 4ビジュアル修復、実ブラウザ画像、アクセシビリティ、批評、回帰、status同期だけである。

表示の正本は`window.__game`であり、戦場の実体は`game.fieldCats`と`game.enemies`だけを使用する。4枠編成表示は、所有・戦場・加入可能・未解放を区別し、未所有キャラクターを戦闘中として見せてはならない。攻撃・被弾・撃破・報酬演出は実state、実timer、または`game.emit`の非消費観測へ結合する。

次は禁止。

- `game-core.js`、`game-data.js`、`app.js`、経済値、保存schemaの変更
- Step 5 gameplay expansion
- backend
- payment provider
- ad network
- Production alias
- physical-iPhone PASS claim
- sealed Step 2 / Step 3 mutation
- user approvalの推定

## Completion rule

コード、画像、build、test、Vercel、スクリーンショットの存在だけでは完成ではない。実物比較、操作、異常状態、critic、P0/P1ゼロ、ユーザー視覚承認、exact commit/tree/evidenceが必要。

`S4-RECOVERY-VIS-001`は、修復後の実ブラウザ画像を完成画面基準と横比較し、独立批評で残存P0/P1がないと確認するまで未解決である。画面品質PASS、Step 4 PASS、Step 5認可を先に出してはならない。

## Baseline technical evidence

- commit/tree: `32675a7f268e1da20552c26a19b8d5d50b0c8400` / `bb0a010fe7ddebe4530029f66f1f2f6d6f137821`
- run/job: `33338326176` / `99329176306`
- artifact: `9739733397`
- Chromium viewports: 320×667、375×667、390×844
- console/page errors: `0 / 0`
- source of truth: `window.__game`

## Current required sequence

1. Round 025 acceptanceに従い実root表示を修復する
2. 4枠編成、敵脅威、接敵、攻撃、被弾、撃破、報酬因果を実stateへ結合する
3. 320幅の資源可読性と下部情報階層を修正する
4. 3 viewport、actual summon interaction、large text、reduced motionを再実行する
5. 完成画面基準と横比較し、弱い場合は再修正する
6. 実root画面をユーザーへ提示する
7. P1とユーザー視覚判断が解決した後だけ次アンカーを検討する
