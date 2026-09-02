# Cat's Tower — Claude Code Project Contract

@AGENTS.md
@docs/v2/CLAUDE_HANDOFF.md
@docs/v2/PRODUCT_AND_SYSTEM_SPEC.md
@docs/v2/VISUAL_DIRECTION.md
@docs/v2/DECISION_REGISTER.json

## このファイルの効力

この `CLAUDE.md` はCat's TowerでClaude Codeが最初に読む作業契約である。旧文書内のbranch、工程、PASS表記が本書または上位authorityと衝突する場合、旧表記を採用しない。

## 絶対条件

- Repositoryは `2hg7trp7rv-design/cats_tower` のみ。
- 現在の作業branchは **`task/v2-bootstrap` のみ**。
- 統合先は `kimi`。PR baseも `kimi`。
- `main` はrelease-history branchとして凍結。直接編集、merge、push、force pushをしない。
- 新しいbranchを作らない。`kimi`へ直接commitしない。
- 現在のDraft PRは **#9**。このPRを勝手にmergeしない。
- branchが違う、working treeがdirty、authorityが矛盾する場合は変更を開始しない。
- current authorityを更新せず、V2-1以降へ勝手に進まない。

## 現在の任務

**V2-0 bootstrapを検証可能な状態で閉じること。**

対象は、React HUD、Phaser battle renderer、deterministic domain、unit/e2e test、Vercel Preview、browser evidence、PR #9の品質ゲートである。production asset量産、最終balance、save/backend/payment/ads/gacha、legacy runtimeの延命は対象外。

## 作業開始時に必ず行うこと

1. `git branch --show-current`
2. `git rev-parse HEAD`
3. `git status --short`
4. `CURRENT_AUTHORITY_INDEX.json` とactive round 035を確認
5. `docs/v2/DECISION_REGISTER.json` のbranch lockとcurrent missionを確認
6. `npm ci --no-audit --no-fund`
7. `npm run verify:v2`

確認結果を短くread backしてから変更する。失敗を成功扱いしない。

## 実装責務

- `apps/game`: React UI、Phaser integration、browser adapter。
- `packages/domain`: DOMやrendererへ依存しないdeterministic battle state/event。
- `tests/v2`: domain behavior。
- `tests/e2e`: browser、viewport、determinism、console error。
- `dist/v2`: Vercel Preview用の静的build output。
- permanent economyや将来のserver transactionをReact、Phaser、localStorageのいずれにも持たせない。

## 変更禁止領域

明示的なauthority更新がない限り、次を変更しない。

- `main`
- `canonical/**`
- `simulation/**`
- `quality-reviews/**`
- `step4/**`
- `MASTER_SPEC.md`
- `FLOORS_1_10_DESIGN.md`
- `CURRENT_AUTHORITY_INDEX.json`
- `AI_PROJECT_POLICY.json`
- legacy root runtime: `index.html`, `app.js`, `game-core.js`, `game-data.js`, `styles.css`, `sw.js`

これらは読むことはできるが、現在のV2-0で書き換えない。

## 品質判定

「完了」「PASS」「production-ready」「実機確認済み」は証拠が揃った場合だけ使う。

最低限の証拠:

- typecheck PASS
- unit tests PASS
- production build PASS
- Playwright Chromium: 320x568、390x844、430x932
- Playwright WebKit: 390x844
- horizontal overflowなし
- uncaught browser errorなし
- 同一seedとelapsed timeが同一snapshotを返す
- defeat後にrewardとwaveが進む
- Vercel Previewの対象commit/URL

物理iPhoneは現時点で **NOT_VERIFIED**。browser emulationを物理iPhone確認と表現しない。

## ユーザーへの質問範囲

ユーザーへcode、library、file location、test command、architectureの選択を委ねない。Claudeが根拠を持って決定する。質問してよいのは、純粋な好み、visual approval、product scope変更、課金・法務・production accountのような不可逆または事業判断だけ。

## 報告形式

各作業の最後に必ず次を報告する。

1. 目的
2. 変更したもの
3. 実行した検証と結果
4. Vercel/browser/物理実機の確認範囲
5. 未完了・blocker
6. Cat's Tower完成へ向けた次の一手

不明な項目は `UNKNOWN` または `NOT_VERIFIED` と明記する。
