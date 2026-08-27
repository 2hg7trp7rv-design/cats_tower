# Cat's Tower

猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登り、一つの「塔還り」で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPGです。

## 現在地

- Repository: `2hg7trp7rv-design/cats_tower`
- Writable branch: 既存の`kimi`のみ
- Step 1: **Round 008 — PASS**
- Step 2: **READY_TO_START**
- Step 3〜6: **BLOCKED BY PRIOR GATES**
- semantic commit/tree: `4b4d8abb...` / `99084efa...`
- Step 1 seal commit/tree: `0b17f9b5...` / `9eac6b61...`
- unresolved P0/P1: `0 / 0`
- physical iPhone: `NOT_VERIFIED`
- Production alias変更: なし

有限100F・非ガチャ設計の旧PASS、旧workflow成功、Vercel `READY`は履歴証拠であり、現行製品やStep 2/3を単独承認しません。

## 読む順序

1. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
2. `quality-reviews/step-1-canonical-design/active-change-control.json`
3. 最新addendum / user-decision-lock
4. `quality-reviews/step-1-reseal-round-008/seal-round-008.json`
5. `MASTER_SPEC.md`
6. `PROJECT_STATUS.json`
7. `QUALITY_GATE.md`
8. `AGENTS.md`
9. 対象Acceptance/evidence

## Sealed Step 1 set

- `MASTER_SPEC.md`
- `FLOORS_1_10_DESIGN.md`
- `canonical/STABLE_ID_REGISTRY.json`
- `canonical/SCREEN_STATE_REGISTRY.json`
- `canonical/STATE_TRANSITION_CONTRACT.json`
- `canonical/POLICY_RELEASE_GATES.json`
- `canonical/STEP2_DEPENDENCY_CLOSURE.json`
- `quality-reviews/step-1-reseal-round-008/seal-round-008.json`

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
- newcomer/monthly/returner login、payment、rewarded opt-in ads
- S01〜S12、server-authoritative permanent economy
- 3 builds × 5 personas × 1,000 seeds以上＋別枠Monte Carlo/state/property tests

## Legacy runtime

root HTML/JavaScript/CSS/assets/saveとV1 simulationは比較・復旧baselineです。現行製品の実装済み画面、backend、gacha、paymentを意味しません。V1はcurrent promotionへ実行・延命・holdout再利用しません。

## 次の許可作業

`02_無制限塔・経済・リセットシミュレーション`

Step 2専用Acceptance Matrixを変更前に作り、`canonical/STEP2_DEPENDENCY_CLOSURE.json`からnew V2 candidate/schema/validator/simulator/result/run-plan/fixtures/migrations/executable-sealを実装します。Step 2 PASS前に`03`を開始しません。
