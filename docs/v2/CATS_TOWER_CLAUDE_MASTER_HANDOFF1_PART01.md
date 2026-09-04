# Cat's Tower — Claude向け総合引き継ぎ正本補足 1

文書状態: **CURRENT HANDOFF SUPPLEMENT / LIVE AUTHORITYより下位 / DESIGN・PRODUCT作業前に必読**  
作成日: **2026-09-04 JST**  
Repository: `2hg7trp7rv-design/cats_tower`  
現在の作業branch: `task/v2-bootstrap`  
統合先: `kimi`  
Release-history branch: `main`  
Current Draft PR: `#9` (`task/v2-bootstrap` → `kimi`)

---

## 0. この文書の目的

この文書は、ClaudeがCat's Towerを引き継いだ際に、次の事故を起こさないための総合説明書である。

- 旧runtimeを正本だと思って継ぎ足す
- 旧「商人サーガの猫版」方針へ戻す
- 5体編成、有限100F、連打、collect-all、会社経営主役へ戻す
- 参考画像をそのまま本番画面・runtime assetとして使う
- CI成功だけでゲーム品質をPASS扱いする
- `main`または`kimi`へ直接書き込む
- 現在のV2-0を飛ばして、ガチャ、課金、全画面、全assetを作り始める
- browser emulationを物理iPhone確認済みと表現する

Claudeはこの文書だけを孤立した正本にしてはならない。毎回live repositoryを確認し、上位authorityが変化していた場合は新しいauthorityへ従う。

---

## 1. 最初に理解する一文

> Cat's Towerは、4匹の名前付き猫・猫人が自動戦闘で上限のない塔を登り、制圧した階の店舗と配送から戦闘支援を受け、今周coin・装備・進化・一つの塔還りで複利成長する、スマートフォン縦画面向け放置インクリメンタルRPGである。

主人公は**猫4体、戦闘、塔、育成**である。商会、店舗、配送、募集、再投資は戦闘を支えるが、会社経営や商会会長が主役ではない。

---

## 2. Authorityと現状

### 2.1 衝突時の優先順位

1. 現在のClaudeセッションでユーザーが明示した最新決定
2. live `CURRENT_AUTHORITY_INDEX.json`
3. そのindexが指すactive change-control
4. `AI_PROJECT_POLICY.json`
5. root `CLAUDE.md`、`.claude/rules/**`、`docs/v2/DECISION_REGISTER.json`
6. `MASTER_SPEC.md`
7. `FLOORS_1_10_DESIGN.md`
8. sealed `canonical/**`
9. Step 2 executable contract、candidate、fixture、validator
10. Step 3 model evidence
11. current V2 code、tests、docs
12. S02 Golden Masterと今回の10枚の参考画像 — **REFERENCE ONLY**
13. legacy root runtime、旧instructions、旧PR説明、古い会話の完了報告 — **HISTORY ONLY**

上位と下位が衝突した場合、平均を取らず、上位を採用する。

### 2.2 2026-09-04時点で観測したlive状態

| 項目 | 観測値 |
|---|---|
| `kimi` HEAD | `64b5e3bff2af776c10bb8b1e854a180c2a894a6d` |
| `kimi` tree | `b5506ec1ea4f65932ecfa0b35910a2527d9f510e` |
| active change-control | `active-change-control-addendum-round-035.json` |
| pipeline | `AI_NATIVE_V2` |
| stage | `V2-0 BOOTSTRAP` |
| work branch | `task/v2-bootstrap` |
| preparation base HEAD | `d70953fd873f5e46f1e9b38c6c318d114eca9016` |
| preparation base tree | `3210d035420d6cdbf9588047ee66827d4ef8c82b` |
| Draft PR | `#9`, open, base `kimi` |
| PR #8 | closed, not merged |
| Step 1 | `PASS_CANONICAL` |
| Step 2 | `PASS_CONTRACT` |
| Step 3 | `PASS_MODEL` |
| current runtime-connected | bootstrap proof only; complete product runtimeではない |
| server-connected | false |
| Production Ready | false |
| existing S02 user visual approval | false |
| physical iPhone | `NOT_VERIFIED` |

上のSHAは**作成時点の観測値**であり、reset先ではない。Claudeは開始時にHEADを再取得し、異なる場合は差分を読む。古いSHAへ巻き戻してはならない。

### 2.3 現在のbranch規則

- 現在の作業は`task/v2-bootstrap`だけ。
- PR baseは`kimi`。
- `main`はrelease-historyとして凍結。
- `main`と`kimi`へ直接pushしない。
- 新しいbranchを作らない。
- force push、merge、rebase、hard resetをしない。
- PR #9を自動mergeしない。
- branch、authority、working treeに不整合があれば書込みを停止してread backする。

旧文書の「`kimi`だけ書込み可能」はV2移行前の運用であり、現在の作業規則ではない。

### 2.4 現在のP1について

live indexは移行時点のP1として次を記録している。

- `V2-PR8-STALE-001`
- `V2-KIMI-PROTECTION-001`
- `V2-BOOTSTRAP-001`

ただしPR #8は現在すでにclosed / not mergedと観測済みである。この事実だけでauthority fileを勝手に書き換えない。次の正式なauthority更新またはV2-0 closureで、stale mirrorを整合させる。

---

## 3. Cat's Towerが目指す完成体

### 3.1 完成時の最初の5秒

プレイヤーは説明を読まなくても、次を理解できなければならない。

1. 猫たちが敵と自動戦闘している。
2. ここは上へ続く塔で、現在の階を攻略中である。
3. 攻撃、命中、HP低下、撃破、報酬がつながっている。
4. 自分が次に行うのは、連打ではなく強化、編成、装備、支援最適化である。
5. 店舗と配送は戦闘を助けるが、戦闘の主役ではない。

### 3.2 完成時の感情曲線

- **開始直後:** 猫の見た目と動きで惹きつける。
- **45秒以内:** coin強化で攻撃速度・damage・撃破速度が変わったと分かる。
- **3分以内:** 四つの役割、撃破報酬、次wave、成長の複利を体感する。
- **10分以内:** 救出、店舗、配送、boss、ガチャ解放の予告により次の目標が見える。
- **20〜35分付近:** 最初の意味ある塔還り候補へ到達し、次周が速くなる期待を持つ。これはsimulation targetであり、runtime実測で再検証する。
- **数日〜数週間:** 編成、武器、進化、build、店舗支援、重複熟練を組み合わせる。
- **長期:** 100Fを終点にせず、地区、cycle、milestone boss、modifier、背景変化によって上限なく登る。

### 3.3 完成時の見た目

- premium pixel-art chibi。
- 猫の輪郭、毛色、装備、役割が小さいスマホでも判別できる。
- 古い石造塔を猫たちが木材、真鍮、布、昇降機、配送棚で修復・活用している。
- 味方側は温かい木と灯り、敵側は冷たい鉄・石と紫の脅威rimで分離する。
- UIは木枠、真鍮、羊皮紙、えんじ布で世界に属する。
- ただし文字、数値、HP、通貨、buttonは画像に焼き込まず、独立したdata-bound UIにする。
- normal battleでは戦場が390×844の主表示のおよそ45〜52%を占める。
- game screenは完成イラスト1枚ではなく、背景、sprite、VFX、component、runtime textへ分解され、実stateで動く。

### 3.4 完成時に絶対に違っていてはならないもの

- 商会経営dashboardが画面の主役になる。
