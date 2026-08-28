# Cat's Tower

猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登り、一つの「塔還り」で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPGです。

## 現在地

- Repository: `2hg7trp7rv-design/cats_tower`
- Writable branch: 既存の`kimi`のみ
- Step 1: **Round 008 — PASS**
- Step 2: **PASS / SEALED**
- Step 3: **PASS / LARGE_SCALE_VALIDATION_COMPLETE**
- Step 4: **READY_TO_START**
- unresolved P0/P1: `0 / 0`
- balance verdict: `PASS_STEP3_LARGE_SCALE_VALIDATION`
- physical iPhone: `NOT_VERIFIED`
- Production alias変更: なし

## 読む順序

1. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
2. active change-controlと最新addendum
3. Step 1 / Step 2 seals
4. Step 3 terminal read-backとmirror correction
5. `PROJECT_STATUS.json`
6. `QUALITY_GATE.md`
7. `AGENTS.md`
8. 対象Acceptance/evidence

## 現行製品の要点

- player-visible floor capなし。100Fは最初の大型節目、101F+継続
- 常設4体、一時増援別層、tap direct damage 0、auto/offline基礎
- shop/income/delivery/recruitment/reinvestmentはcombat support
- single reset `reset.tower_return`、Floor 1再開、高速reclear、repeat-best ruby 0
- uncapped coin level、every-100 ruby evolution
- rarity `N < R < RR < SR < SSR < UR`
- separate character/weapon gacha、100/200 targets、carryover/exchange/history
- first copyで機能完成、20+ duplicateは任意長期熟練、post-cap overflow
- paid/free ruby provenance、explicit refund deficit、immutable ad/login versions
- S01〜S12、server-authoritative permanent economy

## Step 3 result

- gameplay scenarios: `15,000`
- high-volume samples: `1,700,000`
- independent critics: `5`
- unresolved P0/P1: `0 / 0`
- terminal verdict: `PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION`

Step 3 PASSはruntime、backend、payment、ads、Production、物理iPhone完成を意味しません。

## 次の許可作業

`04_12画面完成見本`

12画面の完成見本とスマホ閲覧・操作要件を固定します。
