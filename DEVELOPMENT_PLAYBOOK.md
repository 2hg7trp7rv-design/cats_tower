# Cat's Tower — Low-Rework Development Playbook

更新日: **2026-09-02**  
Repository: `2hg7trp7rv-design/cats_tower`  
Branch: existing `kimi` only

この文書は「途中では動くが後工程で使えない」「見本画像は良いが実装できない」「modelはPASSしたがruntimeが別物」「正常画面だけ完成し、通信失敗で作り直す」という失敗を防ぐための制作方法を固定する。

目的は制作物を増やすことではない。**最終releaseで必要なartifact chainを、廃棄と再実装が最小になる順に作ること**である。

---

## 1. 完成から逆算する

最終的な`PASS_RELEASE`には、少なくとも次が必要である。

1. 封印済みの製品正本
2. 実行可能なschema・validator・domain contract
3. runtimeと同じengineを使うmodel検証
4. 12 screen familyと全重要state
5. production assetとanimation
6. 1〜10Fのend-to-end vertical slice
7. server-authoritative account、wallet、gacha、reset、offline、login、payment、ad
8. browser、server、failure、security、performance、accessibility QA
9. physical iPhone QA
10. policy、privacy、未成年保護、返金・復元、support audit
11. commit、tree、run、artifact、deploymentへ結合したevidence
12. unresolved P0/P1=0

上流成果物は、このいずれかの下流消費者へ直接接続しなければならない。接続先がない文書、画像、コードは作らない。

---

## 2. Artifact chain

正しい順序:

```text
User decision
  -> Change control
  -> Canonical product meaning
  -> Executable contract
  -> Model validation
  -> Golden Master
  -> UI / Asset / Animation / Binding / Responsive contracts
  -> Representative in-engine proof
  -> 12 screen families
  -> Client + Server architecture gate
  -> 1-10F end-to-end slice
  -> Runtime-driven model revalidation
  -> Payment / Ad / Login failure recovery
  -> Physical device
  -> Release evidence
```

飛ばしてはいけない接続:

- Golden Masterからasset decomposition
- assetからin-engine animation proof
- UIからdata bindingとerror state
- simulationからshared domain engine
- gacha画面からatomic server transaction
- tower-return画面からquote/commit/idempotency
- offline画面からprovisional/confirmed reconciliation
- payment画面からreceipt/refund/restore ledger

---

## 3. Downstream Usability Contract

すべてのtaskで、制作前Acceptanceに次を記入する。

### 3.1 必須項目

| 項目 | 記載内容 |
|---|---|
| Artifact ID | 永続的に参照できるID |
| Player outcome | playerが理解・実行・感じること |
| Downstream consumer | 次工程のcomponent、service、担当役割 |
| Canonical inputs | path、version、seal、stable ID |
| Output | path、format、schema、dimension、naming |
| State family | normal、loading、empty、locked、pending、error、retry、recovery |
| Data authority | local、derived、server、provisional、confirmed |
| Responsive | required viewportとreflow |
| Accessibility | target、text、contrast、label、motion |
| Asset contract | layer、anchor、bounds、clip、socket |
| Performance budget | bytes、memory、entity、DOM、FPS |
| Security | transaction、idempotency、audit、permission |
| Failure behavior | timeout、stale、partial、reload、multi-tab |
| Acceptance | 測定可能な合格条件 |
| Auto-fail | 一つで失格になる条件 |
| Verification | static、unit、browser、visual、server、device |
| Evidence | commit、tree、run、artifact、deployment |
| Change impact | 同時更新する文書、test、migration、mirror |

### 3.2 制作開始禁止条件

次が未定なら作らない。

- 次工程でどう使うか
- textとstateをどう差し替えるか
- viewportが変わったときどうなるか
- error/pendingがどう見えるか
- source of truthがどこか
- 何を見てPASSを否定するか

---

## 4. Representative proof before volume

全量生産より先に代表例を実装サイズで通す。

### 4.1 Art

全24キャラの前に:

- 近接猫1体
- 遠距離猫1体
- 通常敵1体
- boss1体
- 1地区背景
- attack/hit/defeat/reward VFX

一体についてidle、walk、anticipation、attack、impact、hit、defeat、reward reactionをengine内で確認する。

### 4.2 UI

全12画面の前に:

- S02: 日常戦闘
- S01: 起動・account・recovery
- S08: boss・telegraph・failure
- S10: odds・pity・history・pending

この4 anchorでdesign token、component、text、long number、error、responsiveを固める。

### 4.3 Server

全APIの前に:

- guest session
- versioned snapshot
- append-only ledger
- idempotent command
- timeout後のresult recovery
- one gacha transaction
- one tower-return quote/commit

### 4.4 禁止

- style検証前に24キャラ全量生成
- state設計前に12枚の完成画像を生成
- server contract前にwallet UIを実装
- shared engine前にruntimeとsimulationへ同じ数式を二重実装

---

## 5. Current Phase 0

Phase 0はrepository Stepではない。Step 4の誤進行を防ぐgovernance recoveryである。

### 5.1 完了条件

- current authorityが一意
- mirrorが同じauthorityを参照
- obsolete live root documentsが削除
- Project sourceが完全置換
- low-rework playbookが追加
- history verifierとcurrent verifierが分離
- old Step 4 write workflowsが削除
- legacy runtimeが非正本として分類
- P0/P1=0
- critic、judge、completion evidence、live read-back

### 5.2 Phase 0で触らないもの

- sealed Step 1/2/3 evidence
- gameplay runtime
- economy
- save schema
- asset production
- backend/payment/ads
- Production

---

## 6. S02-P1 Golden Master

Phase 0後の最初の製品作業。品質を下げず、範囲をS02へ絞る。

### 6.1 A — Competitive research

6〜10作品を現在の一次資料中心に確認する。

各作品で記録:

- first 5 seconds
- battle readability
- character scale
- causality
- idle/offline presentation
- commerce placement
- one-handed route
- strength
- weakness
- adopt
- reject
- Cat's Tower transformation
- copy boundary

調査結果は必ずS02の寸法、優先度、動作、componentへ変換する。

### 6.2 B — Player experience

5秒以内に理解させる順:

1. 猫4体がparty
2. 敵とauto battle
3. 現在階
4. 現在目標・危険
5. 攻撃から報酬までの因果
6. 次の主操作
7. shop/delivery支援

### 6.3 C — Information priority

- P0: 猫、敵、HP/進捗、階、危険、主操作
- P1: 4 slot、auto、報酬因果、支援状態
- P2: 条件付き詳細、通知、補助説明
- P3: separate screenまたは削除

monetization/eventはcombatを上回らない。

### 6.4 D — Art direction

固定:

- world periodとmood
- wood/brass/metal/cloth/stone
- light、shadow、depth、fog
- foreground/mid/far
- cat/enemy silhouette
- character-to-screen ratio
- floor and contact plane
- effect density
- rarity effect ceiling
- UI/world integration
- reject examples

### 6.5 E — GM01〜GM08

| GM | 必須状態 |
|---|---|
| GM01 | 390×844 normal |
| GM02 | 320×667 compact reflow |
| GM03 | 375×667 short-standard |
| GM04 | 320×568 stress |
| GM05 | 430×932 tall expansion |
| GM06 | anticipation→attack→impact→damage→defeat→reward |
| GM07 | offline provisional/confirmed reconciliation |
| GM08 | on-field/owned-reserve/joinable/locked |

各GMを独立表示する。Japanese text、numbers、HP、currencyはtext layer。full-screen imageをruntimeへ置かない。

### 6.6 F — UI system

最低component:

- primary/secondary/icon button
- tab/bottom nav
- resource chip
- HP/progress
- character card
- enemy threat
- reward feedback
- modal/toast/tooltip/badge

最低state:

- normal
- pressed
- selected
- disabled
- locked
- loading
- error
- cooldown

### 6.7 G — Asset/animation

Background:

- far
- mid
- combat floor
- foreground
- ambient/fog
- district grading

Character/enemy:

- model sheet
- visible/collision bounds
- foot/weapon/projectile/VFX anchor
- scale reference
- shadow

Clips:

- idle
- walk
- anticipation
- attack
- projectile/contact
- impact
- hit
- skill
- defeat
- reward

### 6.8 H — Data binding

各visible valueに次を持つ。

- component ID
- canonical source
- authority
- type
- formatter
- empty/loading/pending/error
- stale behavior
- optimistic update可否
- reconciliation
- accessibility label

fake wallet、fake skill、fake reward、fake server confirmationを描かない。

### 6.9 I — Responsive

必須viewport:

- 320×568
- 320×667
- 375×667
- 360×800
- 390×844
- 412×915
- 430×932

componentごとにpreserve、shrink、reflow、collapse、hide、expandを定義する。

下限:

- battlefield: short 300 / standard 352 / tall 404 CSS px
- critical text 12px
- supporting text 11px
- target 44px、推奨48px
- character 54px
- enemy 68px

### 6.10 J — Feasibility

監査:

- hidden background不足
- crop/parallax seam
- sprite scale
- animation consistency
- alpha edge
- frame/atlas
- baked text
- number overflow
- Japanese wrapping
- VFX occlusion
- decoded memory
- DOM/entity growth
- reduced motion
- color-only state
- provenance/license

### 6.11 P1完了判定

ユーザー承認前の最大判定:

`READY_FOR_USER_VISUAL_REVIEW`

ユーザー承認後:

`READY_FOR_S02_P2_ASSET_PRODUCTION`

まだS02 complete、Step 4 PASS、Step 5 allowedではない。

---

## 7. S02-P2 Production Asset Proof

### 7.1 Asset manifest

必須field:

- assetId
- source/output path
- dimensions
- alpha/color space
- visible/collision bounds
- anchors/sockets
- clips/fps/loop/interrupt
- compressed bytes
- decoded memory estimate
- atlas
- provenance/license
- fallback
- reduced-motion alternative

### 7.2 In-engine proof

- actual viewport scale
- actual floor alignment
- movement/range
- attack causality
- damage timing
- reward path
- 10-minute soak
- resize/background/foreground
- no leak

代表セットがPASS_ASSETになるまで全量生産しない。

---

## 8. 12 Screen Families

12画面は12枚ではなくstate familyである。

| Screen | Core states |
|---|---|
| S01 | new/resume/guest/link/migration/conflict/delete/pending/result |
| S02 | normal/compact/causality/offline/party/network |
| S03 | district/cycle/best/milestone/huge-number/stale |
| S04 | clear/reward/choice/rescue/pending/retry |
| S05 | shop/delivery/automation/reconfigure/insufficient/conflict |
| S06 | party/level/evolution/catch-up/mastery/locked |
| S07 | equip/compare/build/diagnosis/mastery/conflict |
| S08 | phase/telegraph/break/failure/retry/reconnect |
| S09 | quote/loss-keep-gain/repeat-best/pending/commit/recovery |
| S10 | banners/odds/pity/carryover/exchange/history/result/duplicate/recovery |
| S11 | wallet/catalog/purchase/restore/refund/revocation/deficit/ad |
| S12 | newcomer/monthly/returner/claim/missed-day/inbox/history/time-error |

各screen familyへnormal、loading、empty、locked、disabled、pending、error、retry、stale、large-number、large-text、reduced-motionを適用する。

---

## 9. Architecture Gate before Step 5

### 9.1 Client layers

```text
platform adapters
api client
application commands
headless domain engine
versioned content data
render/event projection
UI components
screen state machines
```

### 9.2 Rules

- TypeScript strict
- no UI direct mutation of wallet/ownership
- fixed timestep
- deterministic QA replay
- production RNG separate
- canonical decimal strings/arbitrary precision
- explicit rounding
- event log for diagnosis
- versioned save/cache/migration
- error boundary
- localization-ready text
- feature flags

### 9.3 Legacy replacement

旧rootを少しずつ現行化しない。Step 4で画面・binding・asset contractが確定した後、新architectureのvertical sliceへ置換する。旧rootは比較とrollback historyに限定する。

---

## 10. Server architecture

### 10.1 Commands

- session/start
- account/link
- account/delete
- snapshot/read
- progress/commit
- offline/quote
- offline/commit
- tower-return/quote
- tower-return/commit
- gacha/draw
- gacha/history
- exchange/commit
- evolution/commit
- login/claim
- ad/offer
- ad/reward/verify
- purchase/catalog
- purchase/verify
- purchase/restore
- entitlement/read

### 10.2 Common write contract

- transaction ID
- idempotency key
- expected state version
- immutable catalog/offer/campaign version
- server timestamp
- audit ID
- atomic transaction
- unique constraint
- repeated request same result
- timeout recovery
- multi-tab convergence

### 10.3 Ledger

Append-only records for:

- paid ruby
- free-reset ruby
- free-ad ruby
- free-other ruby
- character tickets
- weapon tickets
- source/reason
- before/after projection
- refund/revocation
- deficit

### 10.4 Atomic gacha

1. verify banner version
2. verify wallet source
3. lock pity
4. server RNG
5. create result
6. update pity
7. update ownership
8. duplicate/mastery/overflow
9. consume wallet
10. history/audit
11. commit

partial grantは禁止。

---

## 11. 1〜10F Vertical Slice

画面別ではなくplayer journeyで縦に通す。

### Slice A — Boot to 1F

- guest session
- snapshot
- S01
- S02 auto battle
- coin reward
- S06 level
- reload recovery

### Slice B — 2F to 3F

- ranged/air role
- rescue
- party update
- shop choice
- transaction retry

### Slice C — 4F to 5F

- delivery
- mid-boss
- telegraph/break
- failure diagnosis
- reward

### Slice D — 6F to 8F

- gacha unlock
- separate ticket pools
- first-copy functional
- duplicate/mastery
- fourth core member

### Slice E — 9F to 10F

- 3 build axes
- district boss phases
- 11F continuation
- next milestone
- tower-return forecast

### Slice F — Tower return and offline

- quote/commit
- repeat-best ruby 0
- reclear acceleration
- offline provisional/confirmed
- timeout/reload/multi-tab

Acceptance:

- current stable IDs only
- N/R major roles complete
- no tap direct damage
- no mandatory collect-all
- no client permanent grant
- 10F is not ending
- first meaningful tower return 20〜35 runtime minutes
- P0/P1=0

---

## 12. Runtime-driven model validation

実装後、Step 3 modelをshared domain engineで再実行する。

### Required

- same content data
- same formulas
- same rounding
- same large-number type
- same state machine
- same runtime action cadence
- calibration/holdout split
- deterministic fixtures

### Matrix

- 3 builds
- 5 personas
- 1,000 seeds each
- 1〜10F
- 100F
- 1,000F
- 10,000F equivalent
- repeated tower return
- 30〜45 days
- no-ad/ad/monthly/managed/stress
- N/R/mixed/UR compositions
- evolution immediate/delayed/catch-up
- gacha p50/p90/p99
- pity/carryover/exchange
- duplicate/overflow
- refund/replay/race

結果はreal playtest event logとの差も記録する。

---

## 13. QA strategy

### Code

- unit
- schema
- property
- replay
- migration
- boundary
- leak
- disposal

### Server

- repeat idempotency
- concurrent write
- stale version
- timeout
- partial network
- rollback
- duplicate webhook
- refund after spend
- restore
- link conflict
- deletion

### Browser

- seven viewports
- safe area
- large text
- reduced motion
- zoom
- background/foreground
- PWA update
- offline/online
- long number

### Gameplay

- 5-second comprehension
- first action
- 3-minute boss
- 10-minute soak
- 100 draws
- 1h/24h offline
- tower return
- reclear
- failure diagnosis

### Visual

- exact screenshot
- reference overlay
- hierarchy
- character identity
- causality
- text clipping
- number overflow
- competitor comparison
- independent critic

### Device

- tap
- haptic
- audio interruption
- heat
- battery
- memory pressure
- network switch
- PWA restore
- native purchase/ad sandbox

---

## 14. Evidence chain

### Content commit

含める:

- actual deliverable
- source/schema
- tests
- route
- manifest

### Evidence commit

含める:

- hash
- critic
- final judge
- workflow run/job/artifact
- deployment metadata
- content commit/tree
- P0/P1
- Production/device state
- live read-back

### Rules

- content作成者の自己申告は証拠ではない
- evidenceが別commitへずれていないか検証
- screenshotが対象commitのrenderか検証
- Vercel commit/branch/target一致
- Production alias変更を別欄で明示
- PASS後にcontentを変えたら再検証

---

## 15. Change impact matrix

変更種別ごとに追従対象を固定する。

| Change | Required follow-up |
|---|---|
| Product meaning | canonical、IDs、screens、contract、simulation、UI、handover |
| Formula | candidate、schema、engine、fixtures、results、runtime |
| Stable ID | registry、migration、server、analytics、UI |
| Screen state | registry、binding、component、browser QA |
| Asset scale | model sheet、anchor、collision、layout、performance |
| Wallet rule | ledger、UI、purchase、refund、simulation |
| Gacha rule | catalog、RNG、pity、history、odds UI、tests |
| Tower return | quote/commit、loss/keep/gain、simulation、UI |
| Offline | snapshot、quote、reconciliation、UI、tests |
| Current phase | change-control、authority index、all mirrors、workflow |

一つでも追従漏れがあればsealしない。

---

## 16. Anti-patterns

禁止:

- low-fidelity mockを作って後からproduction qualityへする
- flattened screenshotをruntime foundationにする
- old runtimeをCSSで延命する
- happy pathだけ作る
- 画面ごとに独自componentを作る
- 画面とserver transactionを別々に設計する
- simulationとruntimeへ別数式を書く
- asset production前にanchor/boundsを省く
- production provenanceを後回しにする
- build greenを品質PASSにする
- userへ欠陥探索を丸投げする
- P0/P1が残る候補を完成として提示する
- static statusを複数ファイルへ手書きする
- obsolete instructionsを「LEGACY」の一文だけ付けてlive rootへ残す

---

## 17. Progress reporting

進捗率をcommit数、file数、Step番号の単純割合で示さない。

毎回報告:

- current authority
- acceptance IDs passed/total
- user-visible artifacts
- implementation-ready artifacts
- runtime-connected artifacts
- server-connected artifacts
- required states passed/total
- viewports passed/total
- P0/P1/P2
- content/evidence commit/tree
- workflow/deployment
- physical device
- next authorized action one item

例:

```text
S02-P1 deliverables: 4/10
Golden Masters: 1/8
Required viewports: 1/7
P0/P1: 0/3
User review: NOT_READY
Step 4: IN_PROGRESS
```

---

## 18. Current exact route

Phase 0を閉じた後、既存S02-P1成果を捨てて同じものを再制作しない。次の順で**監査して不足分だけ直す**。

1. live HEAD/treeとS02-P1 content commitを固定
2. A〜Jのartifact inventoryを作る
3. competitive researchの一次資料、調査日、decision mapping、copy boundaryを監査
4. experience / priority / art directionの相互整合を監査
5. UI / asset / animation / binding / responsive contractを監査
6. GM01〜GM08が独立表示され、stateとviewportがAcceptanceどおりか監査
7. 7 viewport、large text、reduced motion、safe area、44px targetを実browserで確認
8. flattened art、baked text、fake state、placeholder、emoji icon、実装不能assetを監査
9. implementation feasibilityとperformance budgetを監査
10. independent criticsを実行
11. P0/P1を修正
12. content/evidence commit、workflow、artifact、deploymentを結合
13. `READY_FOR_USER_VISUAL_REVIEW`
14. explicit visual preference
15. representative production assets
16. S02 interactive proof
17. S01/S08/S10 anchors
18. remaining screen families
19. Step 4 final seal
20. Architecture Gate
21. 1〜10F vertical slice
22. runtime-driven model revalidation
23. payment/ad/login recovery
24. physical iPhone
25. release

既存成果がAcceptanceを満たさない場合だけ作り直す。既存成果が満たす場合は証拠化して再利用する。この順序を変更する場合は、先にchange-controlで再作業が減る根拠を示す。
