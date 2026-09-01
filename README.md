# Cat's Tower

猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登り、一つの`reset.tower_return`で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPG。

## Current truth

| Scope | Status |
|---|---|
| Step 1 canonical | `PASS_CANONICAL` |
| Step 2 executable contract | `PASS_CONTRACT` |
| Step 3 model validation | `PASS_MODEL` |
| Step 4 screen families | `IN_PROGRESS` |
| S02-P1 review route | present; 8 states claimed for audit |
| S02-P1 accepted Golden Masters | `0 / 8` |
| Step 5 canonical runtime/server | `BLOCKED` |
| Physical iPhone | `NOT_VERIFIED` |
| Production Ready | `false` |

The existing root browser game is **legacy technical history, not the canonical 1〜10F implementation**. Step 3 validates the sealed model; it does not mean that the legacy browser runtime was playtested 15,000 times.

## Read order

1. `CURRENT_AUTHORITY_INDEX.json`
2. the active change-control named by the index
3. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
4. `DEVELOPMENT_PLAYBOOK.md`
5. Step 1/2 seals and Step 3 evidence
6. current task Acceptance/evidence
7. status mirrors

## Current work

Phase 0 is repairing governance and Project sources. S02-P1 review content and eight GM states were written concurrently and are preserved, but they are not Phase 0 evidence and are not accepted yet. After Phase 0 passes, that content must be audited against A〜J before any further product write. The actual root, gameplay core, economy, backend, Production and physical-device verdict remain unchanged.

## Product invariants

- no player-visible floor cap; 100F is a milestone, not ending
- four named permanent party members; temporary support separate
- tap direct damage 0; auto/offline foundation
- shop/delivery support combat
- one tower return system
- uncapped coin levels and every-100 ruby evolution
- rarity `N < R < RR < SR < SSR < UR`
- separate character/weapon gacha
- first copy functional; 20+ duplicate is optional long mastery
- paid/free ruby provenance
- S01〜S12
- server-authoritative permanent economy

## PASS vocabulary

Use `PASS_CANONICAL`, `PASS_CONTRACT`, `PASS_MODEL`, `PASS_VISUAL`, `PASS_ASSET`, `PASS_RUNTIME`, `PASS_SERVER`, `PASS_DEVICE` or `PASS_RELEASE`. Build, CI or Vercel READY alone is not a quality verdict.
