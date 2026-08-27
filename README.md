# Cat's Tower

猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登り、一つの「塔還り」で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPGです。

## 現在地

- Repository: `2hg7trp7rv-design/cats_tower`
- Writable branch: 既存の`kimi`のみ
- Step 1: **Round 008 final preseal review — IN_PROGRESS**
- Step 2〜6: **BLOCKED**
- 00 Round 006/007: 当時scope限定`SCOPED_PASS`
- repository contradiction inventory: PASS
- competitor/platform/Japan research: PASS
- 1〜10F / stable IDs / S01〜S12 / state transitions / Step 2 closure: PRESEAL complete
- final critics/judge/seal: IN_PROGRESS
- new Step 1 seal: NOT_CREATED
- physical iPhone: `NOT_VERIFIED`
- Production: legacy runtime。今回変更しない

有限100F・非ガチャ設計の旧PASS、旧workflow成功、Vercel `READY`は現行Step 2を許可しません。

## 読む順序

1. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
2. `quality-reviews/step-1-canonical-design/active-change-control.json`
3. 最新addendum / user-decision-lock
4. 有効なStep 1 seal（現在は未作成）
5. `MASTER_SPEC.md`
6. `PROJECT_STATUS.json`
7. `QUALITY_GATE.md`
8. `AGENTS.md`
9. 対象Acceptance/evidence

## PRESEAL canonical set

- `MASTER_SPEC.md`
- `FLOORS_1_10_DESIGN.md`
- `canonical/STABLE_ID_REGISTRY.json`
- `canonical/SCREEN_STATE_REGISTRY.json`
- `canonical/STATE_TRANSITION_CONTRACT.json`
- `canonical/POLICY_RELEASE_GATES.json`
- `canonical/STEP2_DEPENDENCY_CLOSURE.json`

これらは内容が揃っていても、valid live sealが存在するまで単独でStep 2を許可しません。

## 現行製品の要点

- player-visible floor capなし。100Fは最初の大型節目、101F+継続
- 常設4体、一時増援別層、tap direct damage 0、auto/offline基礎
- shop/income/delivery/recruitment/reinvestmentはcombat support
- single reset `reset.tower_return`、Floor 1再開、高速reclear
- uncapped coin level、every-100 ruby evolution
- rarity `N < R < RR < SR < SSR < UR`
- separate character/weapon gacha、100/200 targets、carryover/exchange/history
- first copyで機能完成、20+ duplicateは任意長期熟練
- newcomer/monthly/returner login、payment、rewarded opt-in ads
- S01〜S12、server-authoritative permanent economy
- 3 builds × 5 personas × 1,000 seeds以上＋別枠Monte Carlo/state tests

## Legacy runtime

root HTML/JavaScript/CSS/assets/saveとV1 simulationは比較・復旧baselineです。現行製品の実装済み画面、backend、gacha、paymentを意味しません。

## 次の許可作業

`01_正本仕様・競合調査`のfinal mirror sync、10 independent critics、final judge、exact evidence、Round 008 sealだけ。sealがliveで検証されるまで02を開始しません。
