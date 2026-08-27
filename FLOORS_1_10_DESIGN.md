# Cat's Tower — 1〜10F canonical slice

文書状態: **ROUND 008 PRESEAL CANONICAL DRAFT**  
更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
Branch: `kimi`  
上位権威: `CHATGPT_PROJECT_INSTRUCTIONS1.md`、active change-control、`MASTER_SPEC.md`、`PROJECT_STATUS.json`

この文書は最初の実装sliceを定義する。塔全体はプレイヤーから見て上限なしであり、10Fも100Fもendingではない。数値曲線、抽選確率、報酬量、reset unlockのexact値はStep 2 simulationで決定する。

## 1. Sliceの製品役割

1〜10Fは、課金・ガチャ画面より先に次を理解させる。

1. 猫と猫人が移動・接敵・射程・攻撃・弾着を伴って自動戦闘する。
2. 常設の名前付き4体を今周coinで育てる。
3. 店舗・配送・一時増援が戦闘を支援する。
4. 10Fの地区boss後も11Fへ上がり、100F以降も続く。
5. 行き詰まり後は一つの`reset.tower_return`で1Fから高速再攻略する。

Tapによる敵への直接damageは0。通常進行にcollect-all、個別回収、在庫補充、長押し連打を要求しない。

## 2. Stable IDs

### Tower and encounter

- district: `tower.district.001`
- cycle: `tower.cycle.000001`
- Floor 10 boss: `tower.boss.d01.kagetsubasa`
- first 100F milestone: `tower.milestone.floor.0000000100`
- normal enemies: `enemy.normal.001`〜`enemy.normal.006`
- elites: `enemy.elite.001`〜`enemy.elite.002`
- district wall: `enemy.wall.001`

### Characters and weapons

- deterministic core: `character.launch.001`〜`character.launch.004`
- slice higher-rarity examples: `character.launch.005`〜`character.launch.006`
- slice weapons: `weapon.launch.001`〜`weapon.launch.006`

### Shops and support

- selectable shops: `shop.launch.001`〜`shop.launch.004`
- temporary support: `support.launch.001`〜`support.launch.003`
- build axes: `build.combat`, `build.reinforcement`, `build.commerce`

### Reset

- canonical reset ID: `reset.tower_return`
- display name candidate: 「塔還り」

旧`cat.mugi`、`cat.luna`、`cat.toto`、`cat.kohaku`、`dawn*`等はread-only migration aliasであり、新規writeに使用しない。表示名は永続IDにしない。

## 3. 1〜10F roster truth

| ID | 表示名 | 基礎rarity | 役割 | 確定経路 | 初回入手で使える機能 |
|---|---|---|---|---|---|
| `character.launch.001` | ムギ | N | 前衛・制御 | 開始時 | 接敵、挑発、短い防御 |
| `character.launch.002` | ルナ | R | 遠距離・対空 | 3F救出 | 対空、単体射撃 |
| `character.launch.003` | トト | N | 支援・回復 | 5F救出 | 基本回復、状態解除1種 |
| `character.launch.004` | コハク | R | 走者・後衛妨害 | 8F救援 | 後衛接近、短い妨害 |
| `character.launch.005` | 未命名 | SR候補 | slice追加戦術 | newcomer選択箱候補 | 広告どおりの基本skill |
| `character.launch.006` | 未命名 | SSR候補 | 初日保証枠 | 明示されたnewcomer保証 | 広告どおりの基本skill |

N/Rだけで前衛、対空、回復、後衛干渉を満たす。SR/SSRは速度と戦術選択を増やすが、本編、進化、reset、必須戦闘機能を解除する鍵にしない。常設戦闘編成は4体、一時増援は別層。

`weapon.launch.001`〜`weapon.launch.004`はN/Rの確定入手で4役を覆う。`weapon.launch.005`〜`weapon.launch.006`はslice内の上位選択肢。各常設characterは1本だけ装備する。初期sliceにrandom substat、装備分解迷路、基本役割のduplicate人質化を入れない。

## 4. Floor progression

| Floor | 主目的 | 戦闘・敵 | 解放・報酬 | 必須screen/state |
|---|---|---|---|---|
| 1F | auto battleの価値を5秒で理解 | `enemy.normal.001`。ムギが移動・接敵・攻撃 | ムギ、`weapon.launch.001`、coin level | S02 tutorial/normal battle |
| 2F | 強化の因果 | 近接＋小型遠距離 | coin level、bulk purchase preview | S06 coin-level |
| 3F | 遠距離・対空 | 飛行敵を混ぜる | ルナ救出、最初のshop選択 | S04 rescue、S05 placement |
| 4F | shop→delivery→combat | 配送到着で一時buff | `weapon.launch.002`、delivery forecast | S02/S05 delivery |
| 5F | 最初の節目boss | 予告→攻撃→break | トト救出、N/R core 3役 | S08 intro/telegraph/reward |
| 6F | recruitmentは補助 | 複数敵と役割比較 | S10解放、newcomer保証進捗、無料ticket | S10 odds/pity/exchange/history |
| 7F | first copyとmasteryを分離 | 同一役割の別解を提示 | mastery tutorial、universal fragment preview | S06/S07 mastery |
| 8F | deliveryとrunner統合 | 前衛＋後衛支援＋`enemy.wall.001` | コハク救援、`weapon.launch.004` | S04 rescue、S05 reconfigure |
| 9F | build選択 | modifier 1つを選択、後から変更可 | combat/reinforcement/commerce比較 | S07 build comparison |
| 10F | 地区bossと次地区接続 | `tower.boss.d01.kagetsubasa` 3 phase | district clear、11F解放、S09 forecast | S08 phases/failure/reward、S03 next district |

10F後は11Fへ通常進行する。S09はloss/keep/gainと予測再攻略時間を表示するが、10F到達だけで意味のないresetを強制しない。最初の有効resetの階・報酬式は20〜35分目標に合わせてStep 2で決める。

## 5. Shop, delivery and support

店舗は戦闘の主役を奪わず、制圧済み階から上階へ支援を送る。

- `shop.launch.001`〜`004`は前線damage、生存、coin flow、再攻略速度の異なる支援を持つ。
- `support.launch.001`〜`003`は一時増援で、常設4体枠を増やさない。
- placement/reconfigureは無料または事前表示されたcost。誤tapで恒久損失を作らない。
- deliveryは自動。collect-allや在庫補充を通常必須作業にしない。
- communication failureではserver確定前のrewardをpendingとし、clientが恒久報酬を発行しない。
- offline中は既知設定で進むが、未見story choice、gacha、evolution、reset、purchaseを自動決定しない。

## 6. Combat causality and failure diagnosis

攻撃は予備動作→接触/弾着→damage表示→HP減少→hit reaction→復帰の順。遠距離は弾着前にHPを減らさない。active inputは編成、強化、任意skill timing、店舗最適化に限定する。

敗北時は推奨戦力だけで済ませず、前衛崩壊、対空不足、回復不足、時間切れ、配送未着、装備不一致を診断する。特定RR〜URの取得を固定解決策として表示しない。

## 7. Gacha and newcomer guarantee

S10は6F以降に解放し、猫・戦闘・塔の価値を先に見せる。character/weapon bannerは分離する。draw前に確率、hard pity、featured guarantee、carryover family、exchange、duplicate conversion、ending rule、historyを表示する。

最初の10分50〜100draw等はsimulation候補であり、この文書で確定しない。初日SSR character 1体とSR以上weapon 1本の保証は、課金・広告なしで完了可能にする。

First copyだけでadvertised core roleを使用できる。初期〜中期duplicateは実用育成、20体分以上は任意の長期完全熟練。後半ほど限界効用を逓減し、cap後duplicateはoverflowへ変換する。

## 8. Level, evolution and tower return

coin levelは上限なし。100 levelごとにruby evolution資格を得るが、未進化でも101、201、301以降へ進める。未購入stageは後から順番にcatch upできる。最初の進化費用は最初の有効塔還りの無料rubyで賄える設計とする。

`reset.tower_return`は一つだけ。Floor 1へ戻る。保存済み編成、shop設定、automation、bulk purchase、known-floor accelerationを残す。同じ最高階を繰り返しただけでは新しいreset由来rubyを得ない。

## 9. Authority and recovery

Server authority:

- ruby sub-ledgers、tickets
- draw、RNG audit ID、pity、history
- character/weapon acquisition、mastery、overflow
- evolution、reset、highest floor
- login claim、ad receipt
- purchase、refund、revocation、restore、entitlement

Local authority:

- preferences、accessibility
- temporary render cache
- acknowledged run snapshot

retry/reload/multiple tabではserver transaction IDとidempotency keyで収束する。partial completionはpending、result recovery、history reconciliationのいずれかへ遷移し、reroll・double grantを起こさない。

## 10. Step 2 parameters not sealed here

Step 2で決めるもの:

- HP/ATK/coin/cost curves
- exact gacha odds、soft pity、ticket supply
- mastery coefficients、ruby reset formula
- offline cap、reset unlock floor/time
- modifier weights、boss timing
- N/R utility and UR dominance thresholds
- paid acceleration distributions

すべてcanonical decimal stringまたは明示任意精度型、rounding rule、seed、fixture、result schemaを持つ。

## 11. Slice acceptance

- 10Fと100Fをendingにしない。
- 常設4体と一時増援を混同しない。
- N/Rだけで主要役割を完結する。
- tap damage 0、auto battle/offlineを基礎とする。
- shop/deliveryはcombat supportであり、会社経営を主役にしない。
- S01〜S12とnormal/error/recovery stateへ接続する。
- server-owned permanent economyをlocalStorageで代替しない。
- persistent IDは`canonical/STABLE_ID_REGISTRY.json`へ登録する。
- Step 2は`canonical/STEP2_DEPENDENCY_CLOSURE.json`から推測なしで実装する。
