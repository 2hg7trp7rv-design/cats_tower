# Cat's Tower — Product and System Specification for Claude

Prepared: 2026-09-03 JST  
Scope: sealed product meaning + V2 implementation boundaries  
This document does not reopen sealed product decisions.

## 0. Status vocabulary

- **LOCKED**: Claude may not alter without a new user decision and authority update.
- **CANONICAL TARGET**: required product behavior; exact implementation may evolve.
- **SIMULATION TARGET**: numeric target that requires model/runtime validation before final lock.
- **DEFERRED**: intentionally outside the current bootstrap/first-playable scope.
- **PROHIBITED**: must not be implemented or represented as product behavior.
- **REFERENCE ONLY**: useful evidence, not executable authority.

## 1. Product definition — LOCKED

Cat's Tower is a **portrait-mobile idle/incremental RPG** in which named cats and cat-people fight automatically, climb an unbounded tower, receive support from shops and delivery routes established on conquered floors, grow with current-run coin, and eventually use one reset system to return to Floor 1 and reclear faster.

The protagonist is the four-cat party and its combat progression. The player is not primarily a company president, store clerk, warehouse operator, or human hero.

### Core promise

Within five seconds the player should understand:

1. cats are fighting an enemy automatically;
2. the party is climbing upward through a tower;
3. combat produces progression and reward;
4. the next meaningful intervention is formation/growth, not tap damage;
5. shops and delivery support combat rather than replace it.

## 2. Product pillars — LOCKED

1. **Cats first** — identities, roles, motion, equipment, growth.
2. **Readable auto battle** — movement, range, anticipation, contact/projectile, damage, hit reaction.
3. **Unbounded ascent** — no player-visible final floor.
4. **Compounding growth** — coin level, equipment, evolution, shop/delivery support, reset acceleration.
5. **Low-friction play** — no mandatory collect-all, restocking, individual revenue collection, or mass tapping.
6. **Truthful state** — provisional, pending, confirmed, failed, restored, refunded and revoked states are not conflated.
7. **Mobile evidence** — browser viewport evidence and later physical-iPhone evidence are release gates, not assumptions.

## 3. Core loop — CANONICAL TARGET

1. four permanent party members enter or continue auto battle;
2. cats move to engagement or range;
3. attack anticipation communicates source and target;
4. melee contact or projectile arrival occurs;
5. authoritative damage changes HP and triggers hit reaction;
6. enemy defeat is resolved;
7. reward is granted once;
8. current-run coin strengthens the party;
9. the party advances to the next enemy, wave, floor or district;
10. shops/delivery improve DPS, survival, coin flow or reclear speed;
11. at a meaningful wall, one Tower Return resets the run to Floor 1 with retained acceleration.

### Causal order — LOCKED

`movement → engagement/range → anticipation → release/contact → arrival/impact → damage/HP change → hit reaction → defeat → reward → next encounter/floor`

Animation timers, CSS, fixtures and screenshots never create permanent reward or server state.

## 4. Input model — LOCKED

- Direct tap damage to enemies: **0**.
- Auto battle and offline progress are foundational.
- Active input may cover formation, growth, optional timing decisions, shop optimization and build choices.
- Mandatory repetitive tapping, manual stock refill, per-floor placement, per-shop collection and long-press spam are prohibited as normal progression requirements.

## 5. Permanent launch party — LOCKED

Permanent battle slots: **4**. Temporary support is a separate layer and never becomes an unlabeled fifth permanent slot.

| Stable ID | Name | Base rarity | Canonical role | Deterministic acquisition | Five-second visual read |
|---|---|---:|---|---|---|
| `character.launch.001` | ムギ | N | frontline-control | start | low stance, shield, short sword, contact point |
| `character.launch.002` | ルナ | R | ranged / anti-air | rescue on 3F | long bow, quiver, upward aim |
| `character.launch.003` | トト | N | healing-support | rescue on 5F | medicine satchel, bell, ally-facing support |
| `character.launch.004` | コハク | R | runner / backline disruption | rescue on 8F | forward lean, light boots, hook blades, dash path |

N/R units provide frontline, anti-air, healing and backline disruption without gacha dependency. Higher rarity expands speed and tactical choice but does not gate the main story, reset, evolution or mandatory combat functions.

### Conflict resolution

The legacy line that Mugi does not fight is stale. Mugi is a frontline combatant.

## 6. Tower model — LOCKED

- No player-visible maximum floor.
- 10F: first district boss, not ending.
- 100F: first large milestone, not ending.
- 101F and beyond: normal progression continues.
- Districts, 100-floor cycles, milestone bosses, modifier pools and environment variation are data driven.
- Floor, HP, attack, coin, cost, reset count and offline reward must safely exceed JavaScript safe integer limits.

### Numeric authority — LOCKED

Canonical unbounded integers use normalized decimal strings or an explicitly versioned arbitrary-precision representation. `NaN`, `Infinity`, unsafe implicit rounding and unbounded permanent values stored as JavaScript `Number` are prohibited.

## 7. Floors 1–10 slice — LOCKED PRODUCT ORDER

Exact balance remains model/runtime work, but the teaching order is fixed.

| Floor | Player lesson | Combat / unlock |
|---|---|---|
| 1F | understand auto battle within five seconds | Mugi, first weapon, coin level |
| 2F | understand growth causality | melee + small ranged enemy, level improvement |
| 3F | understand range and anti-air | flying enemy, rescue Luna, first shop choice |
| 4F | understand shop → delivery → combat | delivery forecast and temporary buff |
| 5F | first combat milestone | mid-boss telegraph/break, rescue Toto |
| 6F | recruitment is secondary | gacha screen unlock after core value is shown |
| 7F | first copy and mastery are separate | mastery tutorial and universal fragment preview |
| 8F | integrate delivery and runner role | wall/backline enemy, rescue Kohaku |
| 9F | choose a build axis | combat / reinforcement / commerce comparison |
| 10F | district boss and continuation | three-phase boss, clear district, unlock 11F |

10F completion must visibly continue to 11F. It must not force a meaningless reset.

## 8. Shops, delivery and temporary support — LOCKED ROLE

Shops occupy conquered floors and send support upward. They may improve:

- frontline damage;
- survival;
- coin flow;
- known-floor reclear speed;
- temporary support arrival.

They do not become the largest or most important surface during normal battle. Delivery is automatic. Communication failure leaves permanent reward pending until authority confirms it.

Offline automation does not make unseen story choices, gacha draws, evolution, reset or purchases for the player.

## 9. Growth systems

### Coin level — LOCKED

- current-run coin levels have no finite cap;
- growth must work with arbitrary-precision values;
- visual causality must show why the party became stronger.

### Evolution — LOCKED STRUCTURE

- evolution eligibility every 100 levels;
- the character may continue to level 101, 201, 301 and beyond without purchasing the corresponding evolution immediately;
- missed evolution stages can be purchased later in order;
- first meaningful Tower Return should fund the first evolution;
- large unique art is reserved for major milestones, not every 100 levels.

### Rarity — LOCKED

`N < R < RR < SR < SSR < UR`

Base rarity and evolution are separate axes. Initial full-product content target is 24 characters and 36 weapons, but V2 bootstrap and First Playable do not mass-produce them.

## 10. One reset system — LOCKED

Canonical ID: `reset.tower_return`  
Display-name candidate: `塔還り` — requires pre-release naming/trademark review.

- only one reset system;
- returns to Floor 1;
- retains formation, shop settings, automation, bulk purchase and known-floor acceleration as specified by authority;
- repeated reset at the same highest floor does not farm new reset ruby;
- confirmation shows loss, keep, gain and reclear forecast;
- quote/commit and idempotency prevent duplicate reset and duplicate reward.

First meaningful reset timing: **20–35 minutes, SIMULATION TARGET**, not a runtime truth until validated.

## 11. Gacha, duplicates and guarantees — LOCKED STRUCTURE / TARGET VALUES

- character and weapon gacha are separate;
- compound gacha / card matching is prohibited;
- first copy is functionally usable;
- normal PvE does not require full duplicate mastery;
- duplicate value has diminishing returns;
- selector, exchange, universal fragments, reruns and overflow are required fairness tools;
- day one guarantees one SSR character and one SR-or-higher weapon without payment or ads.

Targets requiring validation:

- hard pity: 100;
- featured guarantee: 200;
- compatible banner-family carryover;
- 30–45 day no-ad F2P path to one featured UR guarantee;
- monthly acceleration approximately 1.5–2x;
- high-spend stress persona approximately 3–5x upper target, never unlimited.

Gacha, payment and permanent wallet are **DEFERRED** from V2-0 and V2-1.

## 12. Ads and monetization — LOCKED BOUNDARY

Initial ads are rewarded and opt-in only. Do not place ads during battle, boss, draw result, purchase or save recovery. Forced interstitials and permanent banner ads are excluded from the initial version.

Offer/version, reward, eligibility and daily cap are fixed before opt-in. Retry does not silently substitute a new offer.

## 13. Authority boundary — LOCKED

Permanent economy and trust-sensitive actions are server authoritative, including:

- paid/free ruby sub-ledgers and refund deficit;
- tickets;
- purchase, receipt, refund, revocation, restore and entitlement;
- draw result, RNG audit ID, pity, exchange and history;
- acquisition, duplicates, mastery and overflow;
- evolution, reset reward and highest floor;
- login claim and ad receipt;
- account link and deletion.

Local authority is limited to preferences, accessibility, temporary render cache and acknowledged snapshots. `localStorage` is never permanent economy authority.

Timeout is pending reconciliation, not confirmed failure. All permanent operations require transaction ID, idempotency key and audit/version evidence.

## 14. Canonical screen responsibilities — LOCKED

| ID | Responsibility |
|---|---|
| S01 | title, resume, account link, migration, deletion |
| S02 | battle follow, auto state, support, offline reconciliation |
| S03 | unbounded tower, district, 100F cycle, best floor, next milestone |
| S04 | floor clear, reward, choice |
| S05 | shop, income, delivery, automation, reconfigure |
| S06 | character, rarity, coin level, evolution, mastery, party |
| S07 | weapon, equip, mastery, build, diagnosis |
| S08 | boss phase, telegraph, break, failure, retry |
| S09 | Tower Return, loss/keep/gain, ruby, reclear forecast |
| S10 | character/weapon gacha, odds, pity, exchange, history |
| S11 | wallet, store, payment, rewarded ads, entitlement |
| S12 | newcomer/monthly/returner login, inbox, history |

A single normal-state mockup does not complete a screen. Loading, error, retry, reload, multi-tab, pending, refund/revocation/restore and accessibility states must follow the canonical registries.

## 15. Initial-version exclusions — PROHIBITED OR DEFERRED

Do not add to the initial scope without explicit authority:

- PvP or competitive rewards;
- guild competition;
- battle pass;
- dense limited-event schedule;
- forced interstitial ads;
- permanent ad banners;
- random-substat maze;
- mass equipment dismantling;
- tap-spam combat;
- finite 100F ending;
- human lead replacing the cats;
- manual store collection/stock chores;
- live backend/payment/ad/gacha in bootstrap;
- client-authoritative permanent economy.

## 16. Current V2 architecture — LOCKED FOR BOOTSTRAP

- React owns HUD and controls.
- Phaser owns battle rendering.
- `packages/domain` owns deterministic state progression and events.
- React and Phaser consume the same runtime state; neither owns permanent economy.
- build output is `dist/v2`.
- Node major is 24.

Current geometric entities and provisional local values are acceptable only while visibly labeled as bootstrap/not production.

## 17. Current and next scope

### V2-0 current

Prove the pipeline, deterministic loop scaffold, tests, browser viewports and Vercel Preview. No production asset migration.

### V2-1 next, not yet authorized by this handoff

Prove the first playable three-minute battle loop with representative art, four readable roles, reward and level-up causality.

### V2-2 later

Build the 1–10F Vertical Slice after representative proof passes.

## 18. Acceptance mindset

Claude must try to disprove a proposed implementation before declaring it correct:

- Can the same evidence be produced by a fake fixture?
- Can reward be duplicated?
- Can a non-owned character appear as active?
- Can large values overflow?
- Can narrow/short viewports make the game unreadable?
- Can shop UI replace battle as protagonist?
- Can a test pass while the deployed page differs?
- Can browser evidence be mistaken for physical-device evidence?

If any answer is yes, the implementation is not complete.
