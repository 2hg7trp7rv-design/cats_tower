# Cat's Tower — 完成定義と実装ロードマップ 1

文書状態: **DOWNSTREAM COMPLETION CONTRACT / LIVE AUTHORITYより下位**  
作成日: **2026-09-04 JST**

---

## 1. 完成とは何か

Cat's Towerは、ファイル、画面画像、build、CI、Vercel Previewが存在するだけでは完成しない。完成は次の七層が一つのplayer journeyとして接続された状態である。

1. **Product:** 猫4体、auto battle、無制限塔、育成、shop/delivery support、tower returnが一貫している。
2. **Visual:** 役割が読めるproduction assetとresponsive UIが実browserで動く。
3. **Runtime:** movementからreward、floor progression、offline/reloadまでactual stateで動く。
4. **Data:** large number、save、migration、versioningが安全。
5. **Server:** wallet、gacha、ownership、reset、purchaseがauthoritativeかつidempotent。
6. **Quality:** failure/retry/recovery、performance、accessibility、securityを証拠化する。
7. **Release:** physical iPhone、policy、store、rollback、Production承認を満たす。

どれかが欠ける場合は、完成ではなく`IN_PROGRESS`またはscope限定の`VERIFIED`である。

---

## 2. 最終player journey

1. S01で起動、resume、guest/account、migration/offline状態を確認する。
2. S02で猫が自動戦闘し、攻撃→命中→撃破→coinを理解する。
3. coin levelで強化し、同じ敵を速く倒せる。
4. 3Fでルナ、5Fでトト、8Fでコハクを救出する。
5. 制圧階のshopとdeliveryが戦闘を支援する。
6. 5F mid-bossと10F district bossでtelegraph、break、failure diagnosisを体験する。
7. 10F後に11Fへ進み、towerが終わらないと理解する。
8. character/weapon、mastery、buildを調整する。
9. wallに到達したらloss/keep/gain/reclear forecastを見てtower returnする。
10. 1Fから前回より速く進み、district、100F cycle、milestoneを登り続ける。
11. gacha、login、rewarded ad、storeは透明なrate、pity、ledger、recoveryを持つ。
12. offline復帰、reload、timeout、multi-tabでもrewardやownershipが壊れない。

---

## 3. Gate plan

### Gate V2-0 — Verified Bootstrap

Deliverable:

- React HUD
- Phaser renderer
- deterministic domain
- unit/e2e
- mobile viewport proof
- candidate-bound Vercel Preview

Exit:

- `npm run verify:v2`の全required項目
- browser screenshot/trace inspection
- exact commit evidence
- PR #9 readback

Not included:

- production asset
- final visual approval
- save/server/gacha/payment

### Gate V2-1 — Three-minute First Playable

Deliverable:

- 4 role-readable cats
- one enemy family
- one layered tower corridor
- real movement/range/anticipation/impact/damage/hit/defeat/reward/level-up/next enemy
- pause/resume/determinism
- 3-minute soak

Exit:

- no P0/P1 in scoped critic
- 320×568 readability
- reward duplicated zero
- exact event order
- browser output reviewed
- physical iPhone feel is separately recorded

Auto-fail:

- static animation without domain state
- damage before contact/arrival
- defeat without reward/progression
- same seed diverges
- cats unreadable
- shop UI dominates
- placeholder called production

### Gate V2-2 — Floors 1–10 Vertical Slice

Deliverable:

- S01 launch to 11F connection
- canonical rescue order
- shop/delivery
- 5F/10F bosses
- build choice
- offline reconciliation
- save/migration
- tower-return quote/commit or fully specified representative server contract
- representative production assets

Exit:

- browser end-to-end
- reload/timeout/multi-tab recovery
- shared domain operations
- no false local authority
- player understands continuation after 10F

### Gate V2-3 — Screen Families

Deliverable:

- S01〜S12 responsibility-complete screens
- normal/loading/empty/locked/pending/error/retry/recovery
- large text/reduced motion/safe area
- route registry binding

Exit:

- no screen is only a normal mock
- no fake wallet/ownership/reward
- required viewports and visual critic

### Gate V2-4 — Runtime-driven Balance

Deliverable:

- runtime and simulation share formulas/types/rounding
- 3 builds × 5 personas × 1,000 seeds minimum
- 1〜10F、100F、1,000F、10,000F equivalent
- repeated tower returns
- 30〜45 day economy
- gacha p50/p90/p99 and pity/mastery/overflow

Exit:

- cadence targets met without N/R death or unlimited paid acceleration
- model/runtime discrepancy explained and repaired
- actual playtest overrides unfelt model assumptions

### Gate V2-5 — Server and Commerce

Deliverable:

- account/guest link/deletion
- authoritative wallet and sub-ledgers
- character/weapon gacha
- pity/exchange/history
- acquisition/mastery/overflow
- evolution/tower return/highest floor
- purchase/restore/refund/revocation
- rewarded ad/login claim

Exit:

- atomic transactions
- idempotency
- duplicate callback protection
- timeout recovery
- multi-tab convergence
- audit/support recovery

### Gate V2-6 — Content Expansion

Deliverable:

- production-approved asset pipeline
- initial 24 characters / 36 weapons target
- districts, enemies, bosses, backgrounds, modifier variation
- localization-ready runtime text
- audio/VFX/haptic system

Exit:

- representative proof constraints remain intact
- memory/download/performance budgets
- no mass-produced inconsistent AI assets

### Gate V2-7 — Physical Device and Release

Deliverable:

- physical iPhone test
- touch/safe area/text scale
- performance/FPS/memory/leak
- heat/battery/network resume
- policy/legal refresh
- store metadata/privacy/account deletion
- rollback and support plan

Exit:

- `PASS_DEVICE`
- `PASS_RELEASE`
- user Production approval

---

## 4. Evidence required at every gate

- purpose and player value
- allowed/forbidden scope
- exact branch/HEAD/tree
- acceptance IDs
- actual artifact
- automated checks
- browser/render evidence
- failure/recovery evidence
- independent critic
- P0/P1/P2
- Vercel/deployment identity where relevant
- user visual approval where required
- Production and physical-device state
- next authorized action one item

---

## 5. Work that must not be parallelized prematurely

Do not start these in bulk before their prerequisites pass.

| Premature work | Why it causes rework | Required proof first |
|---|---|---|
| 24 characters | identity/animation may fail | four-cat representative proof |
| 36 weapons | equip/build contract may change | one weapon family in runtime |
| all 12 final screens | state/data/route mismatch | First Playable + UI system |
| backend/payment | product transaction contracts may drift | authoritative command design |
| final balance | runtime feel unknown | shared engine and playtest |
| entire background catalog | crop/parallax budget unknown | one layered corridor |
| season/guild/event content | initial scope conflict | explicit later authority |

---

## 6. Final Definition of Done

Cat's Tower release candidate is complete only when all apply.

- product canon preserved
- 4-cat party truth preserved
- unbounded tower preserved
- direct tap damage remains zero
- core loop and 1〜10F are playable
- tower return works without duplication
- offline/reload/multi-tab converge
- production visual assets approved in browser
- all required screen states exist
- arbitrary-precision values are safe
- permanent economy is server authoritative
- gacha/payment/ads are transparent and recoverable
- forced ads/PvP/battle pass remain outside initial scope
- accessibility and reduced motion pass
- performance and memory pass
- physical iPhone evidence exists
- policy/legal/store checks refreshed
- rollback/support evidence exists
- user has explicitly approved final visual and Production action

---

## 7. Immediate next action

Current authorized outcome is still V2-0 closure. Claude must not begin the later gates merely because this roadmap exists.

Immediate sequence:

1. re-read live authority and current branch/HEAD;
2. verify PR #9 candidate;
3. run and inspect V2 checks;
4. repair only demonstrated V2-0 defects;
5. bind Preview/browser evidence;
6. report without auto-merge;
7. wait for explicit authority update before V2-1.
