# Cat's Tower — Claude Code 引き継ぎ正本

Prepared: 2026-09-03 JST  
Repository: `2hg7trp7rv-design/cats_tower`  
Active work branch: `task/v2-bootstrap`  
Integration branch: `kimi`  
Release-history branch: `main`  
Current PR: Draft PR #9 (`task/v2-bootstrap` → `kimi`)

## 1. 引き継ぎ目的

この文書は、Claude CodeがCat's Towerを「旧runtimeの継ぎ足し」や「仕様を作り直す企画会議」として扱わず、既に封印された製品意味とV2開発方針を維持したまま、検証可能なVertical Sliceへ進めるための作業正本である。

現在はゲーム完成工程ではない。**V2-0 bootstrapを閉じる工程**である。見た目が仮であることは許容されるが、仮の見た目を本番品質と呼ぶこと、bootstrapを完成ゲームと呼ぶことは許容されない。

## 2. Authority precedence

衝突時は次の順に従う。

1. このセッションでユーザーが明示した最新決定
2. `CURRENT_AUTHORITY_INDEX.json`
3. `quality-reviews/step-1-canonical-design/active-change-control-addendum-round-035.json`
4. `AI_PROJECT_POLICY.json`
5. `CLAUDE.md` と `docs/v2/DECISION_REGISTER.json`
6. `MASTER_SPEC.md`
7. `FLOORS_1_10_DESIGN.md`
8. `canonical/**` のsealed contract・registry
9. `docs/v2/**`、`apps/game/**`、`packages/**`、`tests/v2/**`、`tests/e2e/**`
10. S02 Golden Masterとそのdesign contract — **REFERENCE ONLY**
11. legacy root runtime、旧instruction、過去review、archive — **HISTORY/REFERENCE ONLY**

上位authorityと衝突する下位文書の表記を、平均化・多数決・都合のよい選択で解決しない。

## 3. 既知の衝突と正しい解決

### 3.1 Branch

旧`CHATGPT_PROJECT_INSTRUCTIONS1.md`やsealed Step 1文書には「`kimi`のみ書込み」と残る。これはV2移行前の運用であり、現行authorityではない。

現行:

- work: `task/v2-bootstrap`
- integration/base: `kimi`
- release history: `main`
- direct write to `kimi`: forbidden
- direct write to `main`: forbidden
- new branch creation: forbidden for this handoff

### 3.2 現在工程

旧文書の「正式工程Step 4」「S02-P1作業中」は履歴である。現行pipelineは `AI_NATIVE_V2`、stageは `V2-0 bootstrap`。

S02 Golden Masterはvisual/reference evidenceとして残すが、root runtime差替え許可、user visual approval、production readinessを意味しない。

### 3.3 ムギの役割

legacy introにある「ムギは戦わない」はstale。現行canonicalではムギは `character.launch.001`、前衛・制御であり、戦場へ参加する。

### 3.4 塔の終点

10Fは最初の地区boss、100Fは最初の大型節目。どちらもendingではない。101F以降も進行する。

## 4. Repository snapshot

Handoff preparation base HEAD:

- branch: `task/v2-bootstrap`
- commit: `fe71c68895bd5755967827adb47740a64e807bd1`
- base `kimi`: `64b5e3bff2af776c10bb8b1e854a180c2a894a6d`
- PR: #9, Draft, open

Claudeはセッション開始時に現在HEADを再取得し、上記と違う場合は差分を確認する。上記SHAへresetしてはいけない。SHAは引き継ぎ作成時点の基準であり、巻き戻し命令ではない。

## 5. 現在の実装状態

V2 bootstrapには次が存在する。

- React 19 HUD
- Phaser 4 renderer
- TypeScript deterministic domain
- Vitest unit tests
- Playwright Chromium/WebKit checks
- Vite build to `dist/v2`
- Vercel Preview integration

現在の画面は「FIRST PLAYABLE BOOTSTRAP」「仮図形・仮数値 / NOT PRODUCTION」と明示されたgeometric proofである。これは意図されたbootstrapで、production visualではない。

## 6. 現在の任務 — V2-0 closure

Claudeが最初に行うべき仕事は、機能を広げることではなく次を閉じることである。

1. 正しいbranch、clean working tree、authorityを確認
2. dependency lockとNode 24条件を確認
3. `npm run verify:v2` を実行
4. failureがあればV2許可領域内の最小差分で修正
5. deterministic behavior、reward/wave進行、viewport、console、overflowを証拠化
6. Vercel Previewが対象commitをbuildしていることを確認
7. PR #9へ、成功・失敗・未確認を区別したreadbackを残す
8. userまたはauthorityの許可なしにmergeしない

### V2-0でしてはいけないこと

- production assetの一括生成・一括投入
- S02 Golden Masterをruntimeへ丸ごと移植
- legacy `game-core.js`等を新基盤として延命
- save/backend/payment/ads/gacha/wallet実装
- final balance確定
- V2-1 First Playableへscopeを広げる
- PR #9 merge
- `main`/`kimi`への直接push

## 7. V2-0 acceptance

全て満たして初めて `V2-0 VERIFIED` と表現できる。

| Gate | Required evidence |
|---|---|
| Repository | repo、branch、HEAD、clean/dirty readback |
| Type | `npm run typecheck` exit 0 |
| Unit | `npm run test:unit` exit 0 |
| Build | `npm run build` exit 0、`dist/v2`生成 |
| Browser | Chromium 320x568 / 390x844 / 430x932 |
| Browser | WebKit 390x844 |
| Runtime | uncaught exception 0、console error 0 |
| Layout | horizontal overflow 0 |
| Determinism | same seed + elapsed time = same snapshot |
| Loop | enemy defeat → reward → wave/next enemy |
| Preview | Vercel deployment URL、commit、READY/ERROR |
| Human device | physical iPhoneは別gate。未実施ならNOT_VERIFIED |

一つでも不明なら全体をPASS扱いしない。Vercel `READY`だけでもPASSではない。

## 8. V2-1への移行条件

V2-1 First Playableへ進めるのは、次の全てを満たした後だけ。

- V2-0 acceptanceが証拠付きで閉じる
- PR #9の扱いが決まる
- `CURRENT_AUTHORITY_INDEX.json` または後続active roundがV2-1を明示する
- 新しいtask branch名とPR baseがauthorityで固定される

この引き継ぎのbranch lockを次工程へ流用しない。

## 9. V2-1で将来証明する価値

V2-1の製品価値は次の3分間loopである。

- 常設4体の猫が動く
- 接敵または射程へ入る
- 予備動作を行う
- 攻撃が接触または弾着する
- damage、HP低下、hit reactionが同期する
- 敵を倒す
- coin/rewardを得る
- coin levelで強くなる
- 次の敵・waveへ進む
- 同じseedと入力なら再現できる

ただし、この節は現在の実装許可ではなく次工程の価値定義である。

## 10. Claudeの意思決定責任

ユーザーはcodeを書かない。Claudeは次をユーザーへ丸投げしない。

- component/library選択
- file placement
- state architecture
- test strategy
- migration strategy
- build/deploy修正
- routine refactor判断

Claudeは複数案を内部比較し、目的・失敗条件・既存contractとの整合から一案を選ぶ。ユーザーに求めるのは、見た目の最終承認、product scope変更、課金・法務・production accountなどの事業判断だけ。

## 11. 証拠と表現

使用可能なstatus:

- `VERIFIED`: 対象HEADで実行証拠あり
- `READY_FOR_REVIEW`: 自動gateは通ったが人間確認待ち
- `IMPLEMENTED_NOT_VERIFIED`: 実装済みだが検証未完了
- `NOT_VERIFIED`: 未確認
- `BLOCKED`: 外部条件またはgateで停止
- `REFERENCE_ONLY`: runtime採用を許可しない参考
- `STALE`: 現行authorityと衝突する旧情報

使用禁止:

- screenshotを見ず「実機表示OK」
- emulatorを「物理iPhone確認済み」
- Vercel READYを「ゲーム品質PASS」
- test fixtureを「server実データ」
- geometric bootstrapを「本番ビジュアル」

## 12. 完了報告テンプレート

```
目的:
対象branch / HEAD:
変更ファイル:
実行したgate:
PASS:
FAIL:
Vercel Preview:
Browser確認:
物理iPhone:
未確認・blocker:
Cat's Tower完成へ向けた次工程:
```

## 13. この引き継ぎの失効条件

次のいずれかでbranch lockとcurrent missionは失効する。

- PR #9がmergeまたはcloseされる
- `task/v2-bootstrap`が削除される
- active authorityがV2-1以降へ更新される
- ユーザーが明示的に別branchまたは別工程を決定する

失効後は推測でbranchを選ばず、新しいauthorityを確認する。
