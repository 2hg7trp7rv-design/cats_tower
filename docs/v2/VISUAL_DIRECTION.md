# Cat's Tower — Visual Direction and Production Contract

Prepared: 2026-09-03 JST  
Current status: **WORKING DIRECTION — NOT USER-VISUALLY-APPROVED — NOT RUNTIME AUTHORIZATION**

## 0. Critical distinction

The following visual direction is operationally fixed for Claude: do not invent a different art direction or dilute it into generic fantasy. However, the existing S02 Golden Master has not received final user visual approval and is not authorized as production runtime art.

Therefore:

- **use this direction to evaluate and design representative assets;**
- **do not claim final visual approval;**
- **do not copy a complete S02 reference image into runtime;**
- **do not mass-produce the full asset library before a representative proof is accepted.**

## 1. North-star read

Working title for the visual direction: **塔内工房の四猫行軍**.

The player should first see four distinct cats advancing through a warm, hand-built tower workshop corridor. Their side is wood, brass, cloth and warm light. The enemy is separated by colder iron/stone light and a violet threat rim. Shops and delivery exist in the architecture, but battle remains central.

### The visual must not read as

- a store-management dashboard;
- a human-hero RPG with cats as mascots;
- a giant-fortress boss screen during normal battle;
- realistic dark catfolk horror;
- a flat operating-system UI over unrelated background art;
- an ad, notification or gacha surface with a tiny battle strip;
- a single AI-generated screenshot being used as the actual game runtime.

## 2. Art style — WORKING DIRECTION

- premium pixel-art chibi;
- logical pixel grid;
- integer-scale exports where applicable;
- crisp silhouette and equipment reads;
- no filtered high-resolution illustration pretending to be pixel art;
- no image-baked Japanese text, number, HP, currency, button or label;
- stable model identity across portrait, field sprite, animation and state.

### Character proportion

- approximately 2.2–2.7 heads tall;
- compact silhouette with role-readable equipment;
- face and primary equipment remain readable on required mobile viewports;
- no frame-to-frame mutation of fur pattern, face, body mass, equipment count or handedness.

## 3. World construction — WORKING DIRECTION

The tower is an old stone structure gradually adapted by cat merchants and adventurers.

Recurring architecture:

- stone walls and vertical shafts;
- wood floors, braces and work platforms;
- brass rails, fasteners and route markers;
- iron lift components, chains and repaired machinery;
- burgundy cloth banners and practical covers;
- delivery shelves, crates and routes that imply commerce without becoming the main screen;
- upper openings, shafts and receding structure that imply no final floor.

The environment should feel inhabited and repaired, not clean fantasy-palace decoration and not generic black dungeon wallpaper.

## 4. Canonical four-cat identity — LOCKED

### Mugi / ムギ

- ID: `character.launch.001`
- role: frontline-control
- fur: cream–ginger
- clothing: burgundy scarf
- equipment: round shield, short sword
- posture: low center of gravity, short step and brace
- must not read as a non-combat merchant

### Luna / ルナ

- ID: `character.launch.002`
- role: ranged anti-air
- fur: russet
- clothing: moss-green hood
- equipment: long bow and quiver
- posture: readable aim including upward targets, clear release
- must not read as a generic mage

### Toto / トト

- ID: `character.launch.003`
- role: healing-support
- fur: silver-white
- clothing: teal coat
- equipment: medicine satchel and small brass bell
- posture: anticipates toward allies; short heal arc
- must not read as an attack mage

### Kohaku / コハク

- ID: `character.launch.004`
- role: runner / backline disruption
- fur: charcoal
- clothing: plum mantle and light boots
- equipment: hook blades
- anatomy cue: long tail
- posture: low forward lean, short dash, readable return path
- must not read as a healer or temporary support

## 5. Enemy direction — WORKING DIRECTION

Normal enemies should be original tower creatures carrying soot, scrap iron or broken lift parts.

- normal enemy scale: approximately 1.2–1.5x a cat;
- elite: approximately 1.5–1.9x;
- over 2.5x, full-width HP and phase spectacle belong to S08 boss responsibility;
- normal enemies do not reduce the cats to side characters;
- silhouette uses high shoulder, lower head or attack limb and threat-facing equipment;
- cold/violet edge separation from warm ally lighting;
- avoid traced or genre-default slime, mushroom, fortress or competitor hero/enemy designs.

Required production states when the representative enemy is authorized:

`idle`, `move`, `threat`, `attack`, `recovery`, `hit`, `low_hp`, `defeat`.

## 6. Palette and semantic color — WORKING DIRECTION

### Core palette

| Token | Value | Purpose |
|---|---:|---|
| ink primary | `#241711` | primary dark text/line |
| ink secondary | `#5E493B` | secondary text |
| ink inverse | `#FFF7E8` | text on dark material |
| wood deep | `#2B1712` | deep frame/shadow |
| wood | `#4A2A1E` | primary wood |
| wood light | `#714733` | raised/high wood |
| parchment | `#F4E5C5` | readable light surface |
| parchment shadow | `#D8C29C` | parchment depth |
| brass | `#C99A4A` | selected/current/primary trim |
| brass highlight | `#F3D58A` | restrained highlight |
| iron | `#56606A` | locked/structural metal |
| stone | `#59606A` | tower structure |
| velvet | `#6B2730` | burgundy cloth/accent |
| healthy | `#5C9762` | health/recovery |
| danger | `#B94E45` | threat/damage/error |
| information | `#4E7E9D` | neutral information/ally cue |
| magic | `#8062A6` | enemy/magic cue |
| reward | `#DDAE43` | actual reward event |
| focus | `#F7E49C` | keyboard focus |

### Semantic restrictions

- brass is reserved for primary, selected, current and actual reward emphasis;
- red communicates danger, damage or error, not generic decoration;
- green communicates health/recovery;
- blue communicates information or ally utility;
- violet communicates enemy/magic separation;
- reward gold appears only for a real reward event;
- fur color never substitutes for ownership, selection, lock or combat state;
- total brass emphasis must remain restrained; the S02 working budget is roughly 18% or less of visible UI material.

## 7. Lighting and depth — WORKING DIRECTION

- ally key light: warm, primarily left/top;
- enemy separation: cooler rim, colder stone/iron region;
- contact shadows tie every entity to the floor;
- fog and particles establish depth but never obscure causality;
- reward light appears at the defeat/reward source only when reward exists;
- shadows and highlights stay consistent across panels and sprites.

### Background layer order

1. sky/opening/upper air
2. far shafts, beams, lifts and depth
3. mid stone, wood, brass and delivery architecture
4. ground and foot anchors
5. restrained foreground beams/rail/chain
6. light separation
7. fog/depth
8. soot, wood dust or sparks

Foreground and particles are the first decoration removed on compact/reduced-motion states.

## 8. Composition and hierarchy — LOCKED WORKING RULE

Global visual order:

1. four cats and current enemy;
2. current floor;
3. current objective or enemy threat;
4. movement/attack/hit/defeat/reward causality;
5. next meaningful action;
6. four-slot party state;
7. shop/delivery support summary;
8. secondary event/commercial navigation.

At the 390x844 reference viewport, battle should occupy roughly 45–52% of the main visible composition. Combatants must not collapse into a tiny row while shop UI dominates.

### Battlefield arrangement

- frontline sits lower and forms the contact point;
- ranged/support sit a step higher/back;
- runner has a readable dash/backline path;
- current enemy remains on the opposing side;
- source, path and target are visible in one field;
- cats do not stand in a single ambiguous line;
- effects do not cover faces, party state or enemy HP for sustained periods.

## 9. UI material and component direction — WORKING DIRECTION

UI belongs to the same world through wood frames, brass fasteners, parchment and cloth, but exact state, text, HP and numbers remain independent DOM/vector layers.

### Required implementation model

- reusable components;
- vector/original pixel icons;
- 9-slice or equivalent scalable frames;
- independent text and number layers;
- data-bound HP/progress/reward;
- state variants rather than one raster panel per screen.

### Prohibited

- complete-screen raster runtime;
- baked text/numbers/currency/HP in generated images;
- emoji, Unicode symbols, OS glyphs, font icons and placeholder icons as production icons;
- copied competitor icons or exact UI;
- meaningless gradients;
- stacked opaque black boxes used to repair every readability failure;
- one-off panel images that cannot reflow or represent loading/error/disabled states.

## 10. Grid, type and interaction — WORKING CONTRACT

### Layout

- base grid: 4 CSS px;
- gutters: 12px at compact 320 width, 16px at 360–390, 20px at 412–430;
- target gap: at least 8px;
- no device-name breakpoints; use viewport dimensions.

### Typography

- meaningful text: minimum 14 CSS px;
- metadata only: minimum 12 CSS px;
- floor reference: 22px / weight about 850;
- screen heading: 18px / about 800;
- component heading: 15px / about 750;
- body, state, button and navigation: 14px;
- damage: 24px target;
- reward: 18px target;
- tabular lining numbers for HP, resources and progress;
- canonical decimal strings are formatted without first coercing unbounded values to `Number`.

System Japanese fallback remains acceptable until an approved, licensed font subset is intentionally introduced.

### Contrast

- normal text: at least 4.5:1;
- 3:1 is allowed only for qualifying large text;
- state boundaries/graphics target 3:1 where required;
- measure final rendered foreground/background pairs, not averaged textured panels.

### Targets

- primary target: 48x48 CSS px minimum;
- other important targets: 44x44 minimum;
- one primary action per state;
- primary S02 intervention is formation adjustment, not direct damage;
- visible press and focus states are required;
- focus outline target: 3px with 2px offset.

## 11. S02 normal-battle information contract — WORKING DIRECTION

Always required in normal battle:

- field-active cats only;
- current normal enemy;
- opposing direction/contact or range path;
- current unbounded floor;
- encounter identity;
- enemy HP with bar and exact text;
- one current objective/threat;
- AUTO state as a status, not a fake active skill;
- one next meaningful action;
- four-slot party dock and truthful state;
- safe-bottom navigation.

Always visible at P1 priority where authoritative data exists:

- encounter progress;
- bound primary resource;
- ally HP;
- shop/delivery support summary;
- upward continuation of the tower.

Conditional only when real event/state exists:

- attack anticipation;
- projectile/contact;
- damage number;
- hit reaction;
- critical;
- heal;
- defeat;
- reward;
- floor transition;
- temporary support;
- offline reconciliation;
- tutorial/loading/error/toast/badge/tooltip/cooldown.

Never fabricate a condition to make the screenshot look richer.

## 12. Party-state truth — LOCKED

- `field`: owned, assigned to slot and has active field entity; label 戦場参加中.
- `owned`: owned but no active field entity; label 所有済み.
- `available`: unowned but canonical eligibility true; label 加入可能.
- `locked`: unowned and canonical requirement locked; label 未解放.
- `unknown`: missing/conflicting source; label 状態確認中 and disable interaction.

State requires at least two non-color channels among label, frame shape, edge/icon and position. An unowned/available/locked cat must not appear as active on the battlefield.

## 13. AUTO and skills — LOCKED

AUTO is persistent battle-mode status. It is not an active-skill button. Do not invent a manual skill row in S02. A cooldown indicator only exists when bound to a real automatic action or support state.

## 14. Navigation — WORKING CONTRACT

Review labels:

`戦闘`, `編成`, `商会`, `塔記録`, `その他`

Only destinations bound to the canonical route registry are enabled. An unbound review label does not create a real route. The selected state uses more than color and exposes appropriate accessibility state.

## 15. Responsive contract — WORKING DIRECTION

Required evidence viewports:

- 320x568
- 320x667
- 375x667
- 360x800
- 390x844
- 412x915
- 430x932

### Global minimums

- battlefield height: short 300px, standard 352px, tall 404px working minimum;
- cat visible-alpha height: at least 60px on all required viewports, 68px at 390x844;
- enemy visible-alpha height: at least 80px on all required viewports, 96px at 390x844;
- primary target: 48px;
- important target: 44px;
- meaningful text: 14px;
- metadata: 12px.

### Reflow rules

- never uniformly shrink the whole screen;
- never non-uniformly stretch art;
- preserve art aspect ratio and crop by anchors;
- reflow UI;
- collapse or hide secondary explanation/decor before shrinking text, targets or combatants;
- short screens keep floor and battlefield in the initial viewport, moving support/secondary content into continued document flow;
- tall screens expand tower depth and movement space, not UI chrome;
- party dock remains four slots, no horizontal carousel;
- at 200% text, party may become 2x2 while DOM order remains stable.

## 16. Effects and motion — WORKING DIRECTION

Normal-state effect budget is restrained. High contrast concentrates at the contact event for approximately 0.2–0.8 seconds.

- attack: direction line/contact spark;
- critical: thicker dual shape and short readable label;
- heal: ally-opening arc and HP recovery segment;
- hit stop: local pose hold only; UI/simulation does not freeze;
- defeat: silhouette collapse, soot and contact-shadow loss;
- reward: one trail from actual defeat/reward anchor to the bound resource;
- floor transition: ground, far structure and floor marker move upward coherently.

Reduced motion removes ambient particles and nonessential travel first while preserving state causality.

## 17. Existing S02 reference assets — REFERENCE ONLY

Primary reference paths:

- `step4/s02/golden-master-p1/golden-master-spec.json`
- `step4/s02/golden-master-p1/asset-manifest.json`
- `step4/s02/golden-master-p1/review-manifest.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-art-direction.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-ui-design-system.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-information-priority.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-player-experience.json`
- `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json`

These assets/contracts may inform representative proof. They do not authorize:

- direct production use;
- full-screen flattening;
- runtime replacement;
- claims of user visual approval;
- copying baked text from prior reference images;
- skipping provenance and runtime-fit review.

## 18. Representative-proof gate before mass production

Before creating the full production asset library, prove at least:

1. one approved field model for each of the four cats;
2. idle/move/anticipation/attack/hit readability for representative roles;
3. one normal enemy with the required state sequence;
4. one layered corridor background with compact/standard/expanded crops;
5. one original icon family and one reusable frame family;
6. accurate text/HP/resource layers independent from generated art;
7. the full movement → hit → defeat → reward loop at required viewports;
8. user visual review of real browser output.

Failure of identity, silhouette, causality, crop or material consistency blocks mass production.

## 19. Automatic rejection criteria

Reject the implementation or asset when any applies:

- commerce/event is visually stronger than cats, enemy, floor and objective;
- Japanese text, number, HP, currency or button is baked into generated art;
- unowned/available/locked cat appears on the battlefield;
- premium pixel-art chibi becomes generic dark fantasy;
- model identity mutates between frames;
- cats or enemy fall below readability thresholds;
- normal enemy is boss-sized;
- material, metal color, light direction, radius or stroke changes arbitrarily by component;
- emoji, Unicode, font icon, OS glyph or placeholder reaches production UI;
- art cannot crop/reflow because hidden extent and anchors are absent;
- 320 width is merely a scaled-down 390 layout;
- attack/contact/hit/damage/defeat/reward anchors disagree;
- competitor character, exact UI, icon, background or effect is copied;
- complete screen raster is used as runtime;
- Claude calls the visual approved without user review.

## 20. Current bootstrap visual status

The current V2 bootstrap uses dark geometric/provisional shapes and is explicitly labeled not production. That is acceptable for V2-0 pipeline proof, but it is not the final visual direction and must not become the default art system by inertia.

Do not spend V2-0 time polishing the provisional bootstrap into a false final screen. Close the engineering gate first; then build a representative V2-1 visual proof against this contract.
