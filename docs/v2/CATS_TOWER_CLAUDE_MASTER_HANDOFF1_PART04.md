Gold/brassはactual reward、selected、current、primaryだけに使う。redは危険、greenは回復、violetは敵・魔法。色だけでstateを区別しない。

### 15.3 UI system

- 4px base grid
- reusable components
- 9-slice/scalable frame
- original vector/pixel icons
- independent runtime text/number/HP/resource
- primary target 48×48 CSS px minimum
- other important target 44×44 minimum
- meaningful text 14px minimum
- metadata 12px minimum
- normal text contrast 4.5:1 target
- one primary action per state
- emoji、Unicode icon、OS glyph、font icon、placeholderをproductionへ残さない

### 15.4 Responsive

Required evidence:

- 320×568
- 320×667
- 375×667
- 360×800
- 390×844
- 412×915
- 430×932

Rules:

- 全画面uniform scaling禁止。
- artの縦横比を維持し、anchor cropする。
- UIはreflowする。
- short screenではdecorとsecondary説明を先にcollapse。
- floorとbattlefieldはinitial viewportに残す。
- tall screenではUI chromeではなく塔の深さと移動空間を増やす。
- party dockは4枠を維持し、horizontal carouselにしない。
- 200% textでは2×2 reflow可、DOM順は維持。

### 15.5 Production asset prerequisites

各assetに最低限必要:

- stable ID
- source/provenance/license status
- source/output dimensions
- alpha/color space
- visible bounds/collision bounds
- foot/weapon/projectile/VFX anchors
- clips、frames、FPS、loop、interrupt
- atlas group
- compressed bytes/decoded memory
- safe crop
- fallback/reduced-motion alternative
- consumer screen/version

---

## 16. 今回の10枚の参考画像の位置付け

格納先: `docs/v2/visual-reference1/**`  
詳細: `docs/v2/CATS_TOWER_SCREEN_VISUAL_BIBLE1.md`

10枚は、次の意味で有用である。

- 暖色pixel mobile RPGの品質水準
- 木、金、紫、石のmaterial感
- 日本向けスマホRPGのinformation density
- lobby、boss、tower map、shop、formation、gacha、forge、long-term meta、login/eventの画面category
- button、card、tab、resource HUD、large bossの視覚語彙

一方、そのまま正本にすると重大な矛盾がある。

- 5体/6枠編成表現
- merchant/chairman主役化
- normal battleでactive catが1体だけ
- shop panelがbattleより強い
- 有限「100階」
- collect-all、manual production chores
- dismantling maze
- guild/friend/competitionの初期導入
- battle-pass-like season track
- image-baked Japanese text/number/UI

結論: **完成像のvisual moodboardであって、canonical layout、runtime asset、user-approved final screenではない。**

---

## 17. Technical architecture

### 17.1 Current V2-0 architecture

- React 19: HUD、controls、accessible UI
- Phaser 4: battlefield renderer
- `packages/domain`: DOM/renderer非依存のdeterministic battle state/event
- Vitest: domain/unit
- Playwright: Chromium/WebKit、viewport、determinism、console、overflow
- Vite build output: `dist/v2`
- Node major: 24

ReactとPhaserは同じdomain stateを読む。どちらもpermanent economy authorityではない。

### 17.2 Long-term package boundary

- `apps/game`
- `packages/domain`
- `packages/content`
- `packages/numeric`
- `packages/contracts`
- future authoritative server app/service
- `tools/simulation`
- shared fixtures/tests

runtimeとsimulationへ別々のformulaを書かない。

### 17.3 Data authority

Server authoritative before production:

- paid/free ruby sub-ledger
- tickets
- purchase/receipt/webhook/refund/revocation/restore/entitlement
- gacha RNG/result/pity/exchange/history
- character/weapon acquisition、duplicate、mastery、overflow
- evolution
- tower return reward
- highest floor
- login claim/ad receipt
- account link/deletion

Local authority:

- preferences
- accessibility
- temporary render cache
- acknowledged snapshot

`localStorage`を恒久経済の正本にしない。

### 17.4 Transaction contract

Permanent commandは原則として次を持つ。

- transaction/command ID
- idempotency key
- expected state version
- catalog/offer/campaign version
- server timestamp
- audit ID
- atomic mutation
- timeout recovery
- duplicate callback behavior
- multi-tab convergence

Timeoutはconfirmed failureではなくpending reconciliation。

---

## 18. 現在実装されているものと、されていないもの

### 18.1 現在あるV2 bootstrap

- typed React shell
- Phaser battlefield
- deterministic domain scaffold
- geometric/provisional cats and enemy
- attack、hit、HP、defeat、coin、level-up、next waveのproof
- pause/resume、same-seed restart
- unit/e2e tests
- Preview build configuration
- explicit `NOT PRODUCTION` labeling

### 18.2 現在まだ完成していないもの

- production-quality four-cat sprites
- final corridor background
- final UI component family
- final S02 visual approval
- canonical 1〜10F end-to-end slice
- save/migration V2 runtime
- authoritative backend
- live gacha/wallet/payment/ads
- final balance in runtime
- all S01〜S12 screen families
- sound/music/haptics final design
- physical iPhone evidence
- Production deployment/release readiness

Bootstrapのgeometric artを磨き続けて偽のfinal screenにしない。

---

## 19. 開発順序

### V2-0 — 現在

目的: pipelineとtyped deterministic shellを閉じる。

Exit evidence:

- typecheck PASS
- unit PASS
- production build PASS
- Chromium 320×568 / 390×844 / 430×932
- WebKit 390×844
- horizontal overflow 0
- uncaught/page/console error 0
- same seed + elapsed time = same snapshot
- defeat → reward → next wave/enemy
- Vercel Previewがcandidate commitに紐づく
- PR #9の成功・失敗・未確認を分離したreadback

禁止:

- V2-1へscope拡張
- production asset量産
- save/backend/gacha/payment/ads
- PR #9自動merge
- Production変更

### V2-1 — authority更新後

目的: 3分間の本物のFirst Playable。

- four cats are role-readable
- move/telegraph/attack/hit/damage/defeat/reward/level-up/next enemy
- one representative enemy family
- one representative corridor
- representative UI/VFX
- deterministic replay
- 3-minute soak
- 320×568 readability
- browser visual critic
- physical iPhoneで理解、hit feel、reward clarity、続けたい感を確認

### V2-2 — First Playable approval後

目的: launchから10F boss、11F connection、recovery、saveまでのVertical Slice。

- canonical加入順
- shop/delivery
- boss 5F/10F
- build choice
- tower return forecast/commit
- offline reconciliation
- representative production assets
- reload、timeout、multi-tab

### その後

1. screen families S01〜S12
2. content expansion
3. shared runtime-driven balance
4. server authority
5. gacha/commerce/recovery hardening
6. policy/legal refresh
7. physical device/performance/battery/heat
8. release candidate/rollback/Production approval

---

## 20. Minimal-rework development rule

- Consumer-first: 次工程の利用方法を先に固定。
