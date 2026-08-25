# Cat's Tower Step 1 canonical design — external evidence ledger

Checked: 2026-08-25

This ledger records what the references can support and, equally importantly, what they cannot prove. It is evidence for design hypotheses, not a substitute for the 100F simulation or player telemetry.

## 1. 2026 mobile engagement benchmark

Source: https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks

- Dataset: 16,000+ mobile games with at least 1,000 MAU, covering the 2025 calendar year.
- Reported mobile medians: about 22% D1 retention, just under 4% D7, roughly 0.7–0.8% D30, about 12 minutes daily playtime, 3.1–3.5 minutes per session, and about 3.8 sessions per day.
- Reported P75 daily playtime: roughly 22–24 minutes.
- The report explicitly emphasizes the first five minutes and first 10–15 minutes as decisive early-value windows.
- Cat's Tower implication: the first useful action must be immediate; one complete first-district arc belongs inside six to eight active minutes; return sessions must have a meaningful action inside roughly three minutes.
- Boundary: this is cross-genre market telemetry. It does not validate Cat's Tower coefficients or predict its retention.

## 2. Exponential idle-economy model

Source: https://www.kongregate.com/en/pages/the-math-of-idle-games-part-i

- The source models exponential next-cost growth, production growth, multiplier milestones, generator choice, and exact bulk-buy formulas.
- It warns that a newer generator dominating forever removes meaningful investment decisions and that mathematically optimal one-by-one purchase sequences become excessive micromanagement for humans.
- Cat's Tower implication: compare power gained per wait time, introduce bounded milestone bumps, retain more than one viable investment path, and provide bulk/recommended purchases.
- Boundary: the cited AdVenture Capitalist values are examples, not values to copy.

## 3. Prestige behavior and exploit risk

Source: https://www.kongregate.com/en/pages/the-math-of-idle-games-part-iii

- The source distinguishes lifetime/max-based prestige from since-reset systems and shows that some formulas reward repeated resets at the same point.
- It states that same-point repeat rewards can create strategies that do not require further progress.
- Cat's Tower implication: Dawn permanent currency comes only from new maximum milestones, first district-boss clears, and first achievements; resetting at the same maximum gives zero permanent currency.
- Boundary: the article recommends iterative modeling and explicitly says a spreadsheet model is not an exact player simulation.

## 4. Stage-dependent prestige and faster re-clear

Source: https://gamehive.helpshift.com/hc/en/3-tap-titans-2/faq/75-should-i-prestige-when/

- Tap Titans 2's official help states that prestige reward rises with stage progress and permanent artifact power allows players to reach and exceed the previous maximum faster.
- It also documents a starting-stage/re-clear acceleration mechanism.
- Cat's Tower implication: new maximum depth must matter, re-clear must be visibly faster, and permanent reward cannot be flat at an old wall.
- Boundary: Cat's Tower will not copy Tap Titans 2's relic economy, clan dependencies, or content scale.

## 5. Automation and flexible session length

Source: https://idleminertycoon.com/

- The official product page describes manager-based automation, progress while away, and play that supports short or long sessions.
- Cat's Tower implication: base combat automation starts in the first encounter, shops remain operational without reopen chores, and active input is an optional optimization layer rather than a requirement for basic progress.
- Boundary: the source is a product page, not an economy disclosure. It supports the automation pattern only.

## 6. User-supplied reference recording

Source file: `/workspace/scratch/42d75b643cef/upload/copy_9D342B56-42D5-44E6-B02C-60B21AB39EA2.mp4`

- Inspected metadata: 39.078 seconds, 510×1108, approximately 30 fps, H.264 video with AAC audio.
- Sampled states show Floors 21–25, a continuously occupied combat lane, weapon/tool/pet/personnel shops, several upgrade modals, randomized ticket exchange, multiple currencies, timer/reopen UI, and a persistent advertisement area.
- Useful reference: simultaneous character density, combat continuing behind management decisions, compact shop comparison, and visible before/after stats.
- Rejected reference: persistent advertising, modal and currency overload, random-ticket dependency, individual reopen chores, and repeated single-level actions.
- Boundary: this short recording is qualitative evidence. It cannot establish the reference game's complete economy, retention, or long-session frame pacing.

## Decisions that survive the comparison

1. Copy response quality, not monetization pressure.
2. Use one short combat loop, one same-day progression loop, and several multi-day goals.
3. Preserve meaningful armament and build choices, but remove random-stat inventory and gacha dependence.
4. Make all important multipliers and expected outcomes visible before purchase.
5. Make Dawn require new progress and make the return journey substantially faster.
6. Cap offline gains by useful purchases and known content, not by an arbitrary multiplier that can skip unseen decisions.

## Hypotheses still requiring rejection tests

- EHP, reward, cat cost, attack, HP, and milestone coefficients.
- First Dawn timing and number of Dawns to 100F.
- Whether all three builds stay within the completion-time spread limits.
- Whether 24-hour offline value is useful without crossing unseen boss or choice boundaries.
- Whether three armament families produce real switching decisions instead of a permanent best choice.
