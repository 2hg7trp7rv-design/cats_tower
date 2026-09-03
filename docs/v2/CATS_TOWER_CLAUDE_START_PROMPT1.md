# Cat's Tower — Claude Code開始用Prompt 1

以下をClaude Codeの最初のメッセージとして、そのまま使用する。

---

## 開始Prompt

あなたはCat's Towerの継続開発を担当する。企画をゼロから作り直さず、repository内のcurrent authority、sealed product canon、V2 handoffを継承すること。

### Repositoryとbranch

- Repository: `2hg7trp7rv-design/cats_tower`
- 現在の作業branch: `task/v2-bootstrap`
- PR base / integration: `kimi`
- Release-history: `main`
- Current Draft PR: `#9`

最初にrepository、branch、HEAD、working treeを確認する。`task/v2-bootstrap`以外にいる場合、working treeがcleanならこのbranchへ移動し、dirtyまたは矛盾があれば書込みをせず状態を報告する。新しいbranchを作らない。`main`または`kimi`へ直接書き込まない。PR #9をmergeしない。force push、merge、rebase、hard resetをしない。

### 最初に読む順番

1. `CURRENT_AUTHORITY_INDEX.json`
2. indexが指すactive change-control
3. `AI_PROJECT_POLICY.json`
4. `CLAUDE.md`
5. `.claude/rules/cats-tower-handoff1.md`
6. `docs/v2/CATS_TOWER_CLAUDE_MASTER_HANDOFF1.md`
7. `docs/v2/CATS_TOWER_SCREEN_VISUAL_BIBLE1.md`
8. `docs/v2/CATS_TOWER_COMPLETION_BLUEPRINT1.md`
9. `docs/v2/CATS_TOWER_VISUAL_REFERENCE_MANIFEST1.json`
10. `docs/v2/CLAUDE_HANDOFF.md`
11. `docs/v2/PRODUCT_AND_SYSTEM_SPEC.md`
12. `docs/v2/VISUAL_DIRECTION.md`
13. `docs/v2/DECISION_REGISTER.json`
14. `MASTER_SPEC.md`
15. `FLOORS_1_10_DESIGN.md`
16. `canonical/**`

旧runtime、旧Step 4表記、旧商人サーガclone framing、既存S02 Golden Master、10枚のreference画像は、上位authorityと衝突する場合は採用しない。

### 現在の任務

現在はV2-0 verified bootstrap closureだけを行う。

- React HUD
- Phaser battlefield
- deterministic domain
- typecheck
- unit tests
- production build
- Playwright Chromium 320×568 / 390×844 / 430×932
- WebKit 390×844
- deterministic snapshot
- enemy defeat → reward → next wave/enemy
- horizontal overflow 0
- uncaught/page/console error 0
- candidate commitに紐づくVercel Previewとbrowser evidence

まず`npm ci --no-audit --no-fund`と`npm run verify:v2`を実行し、失敗を成功扱いせず、実画面、console、trace、screenshot、Previewを確認する。failureがあればV2-0許可範囲内の最小差分で修正する。

### 今回しないこと

- V2-1へのscope拡張
- production asset全量生成
- 参考画像のcomplete-screen raster実装
- S02 Golden Masterの丸ごと移植
- legacy root runtimeの延命
- save/backend/payment/ads/gacha/permanent wallet
- final balance固定
- current authorityやsealed historyの書換え
- Production deployment
- PR #9 merge

### 製品の絶対条件

- 主役は4匹の名前付き猫・猫人、戦闘、無制限塔、育成。
- 常設partyは4体。temporary supportは別layer。
- direct tap damageは0。
- auto battleとoffline progressが基礎。
- 10Fは最初のdistrict boss、100Fはmilestone、endingではない。
- 101F以降も続く。
- shop/deliveryはcombat supportであり、collect-all、manual refill、individual collectionを通常必須にしない。
- Mugiは戦うfrontline character。旧「戦わない商人」はstale。
- character gachaとweapon gachaは分離。
- first copyでcore role完成。
- permanent economyはserver authoritative。localStorageを正本にしない。
- initial versionにforced ads、banner、PvP、guild competition、battle passを入れない。

### Visual referenceの扱い

`docs/v2/visual-reference1/**`は完成品質の方向を示すreference-onlyで、user-approved finalでもruntime assetでもない。wood/brass/premium pixel-chibi、boss spectacle、vertical tower、mobile card qualityは継承する。一方、5体/6枠、merchant chairman主役、有限100F、collect-all、dismantling maze、guild competition、battle-pass-like seasonは修正または不採用とする。Japanese text、number、HP、currency、buttonを画像に焼き込まない。

### 判断責任

code、library、architecture、file placement、test、bug fix、routine refactorをユーザーへ質問しない。内部で反証し、最適案を選ぶ。ユーザーへ戻すのはvisual taste、fun/feel、重大product変更、課金・法務・Production、physical iPhoneだけ。

### 最初の返答

変更前に、次を短くread backする。

- repository / branch / HEAD / working tree
- loaded authorityとcurrent mission
- PR #9 state
- V2-0 acceptance
- forbidden scope
- 実行する最初の一手

### 作業後の報告

- 目的
- branch / HEAD
- 変更ファイル
- player-visible outcome
- 実行したgateとactual result
- browser evidence
- Vercel Preview
- PASS / FAIL / NOT_VERIFIED
- Production state
- physical iPhone state
- user visual approval state
- P0 / P1 / P2
- blocker
- next authorized action one item

不明なことは`UNKNOWN`または`NOT_VERIFIED`と明記する。

---

## 補足

Claude Codeがroot `CLAUDE.md`または`.claude/rules/cats-tower-handoff1.md`を読み込んでいない場合は、作業開始前にcontext/memory設定を確認する。上記instructionを無視してdefault `main`から作業を始めない。
