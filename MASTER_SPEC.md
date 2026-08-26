# Cat's Tower 統合正本仕様書

文書状態: **STEP 1 IN_PROGRESS — ROUND 008 PRESEAL**  
更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**  
現在チャット: **`01_正本仕様・競合調査`**  
次に許可されるチャット: **`01_正本仕様・競合調査`の継続**  
Step 2〜6: **BLOCKED**  
最初の実装slice: **1F〜10F**  
塔の高さ: **プレイヤーから見て上限なし**  
物理iPhone: **NOT_VERIFIED**

本書はCat's Towerの製品境界、用語、状態遷移、画面責務、経済・確率・保存・サーバー権威、品質工程を定義するStep 1正本候補である。有限100F・非ガチャ・独立Dawn・9画面・localStorage恒久経済を前提にした旧仕様と旧PASSはGit履歴上の過去証拠であり、現行製品やStep 2開始を承認しない。

## 0. 権威、00の扱い、Round 008封印

同一scopeで競合する場合は、次の順で解決する。

1. ユーザーの最新の明示的な製品決定
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. live `kimi`のactive change-control、最新addendum、user-decision-lock
4. live `kimi`に存在し、exact commit/tree/deployment/evidenceへ結合された新Step 1 seal
5. seal対象の本書、`PROJECT_STATUS.json`、`canonical/*`
6. 現行Acceptance、critic、judge、handover、deployment evidence
7. 下位正本、Step 2契約、runtime
8. 過去の正本、旧PASS、参考資料

00 Round 006の中核3ファイル同期とRound 007のlive entrypoint containmentは、それぞれの当時scopeに限る履歴`SCOPED_PASS`として維持する。00の証拠は現在の未封印Round 008ファイルを承認しない。

現在の`canonical/STABLE_ID_REGISTRY.json`、`canonical/SCREEN_STATE_REGISTRY.json`、`canonical/STATE_TRANSITION_CONTRACT.json`は**PRESEAL_DRAFT**である。内部内容は独立批評とrepository-wide矛盾監査の対象であり、新Step 1 sealが存在するまでStep 2を許可しない。

次は未作成であり、存在済み正本として参照してはならない。

- `canonical/STEP2_DEPENDENCY_CLOSURE.json` — `PLANNED_NOT_CREATED`
- `canonical/POLICY_RELEASE_GATES.json` — `PLANNED_NOT_CREATED`
- `quality-reviews/step-1-reseal-round-008/seal-round-008.json` — `NOT_CREATED`

seal前のcontent commitを`PASS`または`PRESEAL_PASS`とは呼ばない。状態語は`IN_PROGRESS`とする。

## 1. 製品定義

> 猫と猫人の冒険者を育て、制圧した塔内の店舗と配送網から戦闘支援を受け、上限のない塔を自動戦闘で登り、行き詰まったら一つの「塔還り」で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPG。

- 最初に見せるのは猫、戦闘、塔、育成。
- 常設の名前付き編成は4体。一時増援は別の支援層。
- 店舗、収益、配送、仲間募集、再投資は戦闘支援として残す。
- 商会会長、会社経営、企業ロビーをプレイヤー主体にしない。
- tapによる敵への直接damageは0。
- auto battleとoffline progressを基礎とする。
- collect-all、在庫補充、個別回収、強制連打を通常進行の必須作業にしない。

初期版へPvP、競争報酬、guild競争、battle pass、密集した限定event、強制interstitial、常設banner、random substat迷路、大量分解作業、本編を止めるstaminaを入れない。

## 2. 無制限塔と大数

- プレイヤーから見える最大階を設定しない。
- 100Fは終了地点ではなく最初の大型節目。
- 101F以降も通常進行する。
- 10F地区、100F大サイクル、節目boss、modifier pool、背景変化、反復抑制をデータ駆動で構成する。
- 最初の実装sliceは1〜10Fであり、無制限塔全体の完成を意味しない。
- 同一背景・敵編成・modifierの連続利用には上限を持たせる。

階数、HP、攻撃力、coin、費用、reset回数、offline報酬はJavaScript `Number`の安全整数を超える前提とする。canonical valueは符号なし正規化10進文字列または任意精度整数とし、`NaN`、`Infinity`、指数表記、先頭ゼロ、暗黙丸めを永続化しない。表示短縮値と内部値を分離し、client/server/simulation/analyticsで同一表現を用いる。

## 3. 戦闘、編成、商人要素

- 常設4体は各1本の武器を装備する。
- プレイアブルは猫と猫人。
- 一時増援は4体編成を増やす恒久枠ではない。
- 猫は移動、接敵または射程、攻撃、弾着、damage、hit reactionの因果を読める。
- 敵は複数同時出現可能。
- bossはphase、telegraph、break、失敗原因、再挑戦導線を持つ。
- 店舗・配送は前線DPS、生存、収益、再攻略速度へ届く。
- 毎階の手動再配置や在庫連打を要求せず、保存設定と自動化を持つ。

## 4. 一つの強くてニューゲーム「塔還り」

canonical ID候補は`reset.tower_return`。表示名「塔還り」とIDは**PRESEAL_DRAFT**であり、Step 1批評とrelease前の商標・類似名称確認を通す。

- reset systemは一つだけ。旧Dawnは統合・改名・廃止し、新規writeでは使用しない。
- reset後は1Fから開始。
- 保存済み編成、店舗設定、自動化、一括購入、既知階層高速化で再攻略を速める。
- 最初の有効resetは開始後20〜35分が目標候補。
- 同じ最高階を繰り返すだけでは新しいrubyを得られない。
- confirm前に失う物、残る物、獲得物、予測再攻略時間を完全表示する。
- requestはidempotency keyを持ち、retry/reload/multiple tabで二重reset・二重rubyを起こさない。

## 5. level、進化、rarity

- characterは今周coinでlevel upし、level上限なし。
- 100 levelごとに進化資格を得てrubyを使う。
- 未進化でも101、201、301以降へ進行可能で、未購入進化は後から順番に追いつける。
- 最初の進化は最初の有効塔還りで得る無料rubyから支払う。課金・広告を必須にしない。
- 100 levelごとにFX、UI、軽微な外見変化。大幅専用artは大節目だけ。
- 基礎rarityと進化は別軸。

固定順は`N < R < RR < SR < SSR < UR`。N/Rには確定非ガチャ入手経路と主要役割を用意し、序盤だけの捨て枠にしない。RR〜URはgacha routeを持つが、特定高rarityなしで本編、進化、reset、必須戦闘機能を停止しない。URは概して強いが全役割で無条件最強にしない。初期フル製品目標は24 characters / 36 weapons。1〜10Fは正直なsubsetとする。

## 6. gachaと重複熟練

- character gachaとweapon gachaを分離。
- 日常大量drawはcharacter ticketとweapon ticketを主力にし、必須進化rubyと予算を分離。
- hard pity目標100回、featured pickup保証目標200回、対応する同系統bannerへcarryover。
- 抽選前に確率、pity、pickup、交換、重複変換、終了規則、履歴を表示。
- 限定戦力には復刻、確定交換、選択、同系統pity引継ぎを用意。
- comp gacha / card matchingは禁止。
- 初日中にSSR character 1体とSR以上weapon 1本を確定保証。

masteryは、初回入手だけで役割・基本skillを使える機能完成、初期〜中期重複の実用育成、初回後20体分以上の有効重複または同等資源による任意の完全熟練に分ける。最大の機能的強化は前半、後半は限界効用を逓減。通常PvEは完全熟練を前提にしない。selector、exchange、universal fragment、rerun、pity carryover、overflowを用意し、完全熟練後の重複を消滅させない。

## 7. ruby、login、課金、広告

ruby sourceは課金、新記録または一度限り節目を伴う塔還り、任意rewarded ad。内部ledgerはpaid、reset free、ad free、other freeを分離する。有償rubyは失効させず、返金、取消、復元、消費順序を監査可能にする。

必須surfaceはcharacter gacha、weapon gacha、newcomer/monthly/returner login、payment、rewarded opt-in ad。初期広告はrewarded adだけで、強制interstitialと常設bannerを入れない。

広告なしF2Pでも本編継続、塔還り、必須進化、30〜45日でfeatured UR保証1回を成立させる。paid acceleration目標はmonthly約1.5〜2倍、高額stress persona約3〜5倍。無制限倍率は禁止。

報酬テンポ候補は、最初の10分50〜100draw、最初の1時間150〜250draw、最初の7日500〜800draw、通常期no-ad F2P 40〜60draw/day、optional ad +20 target/hard cap 40、bulk 10/50/100、newcomer visible upgrade ≤45秒、normal session ≤120秒。これらはStep 2/3で合否を決める候補値である。

## 8. server authority

localStorageを正本にしないものは、paid/free ruby、product catalog、payment receipt/webhook/refund/revocation/restore、gacha result/RNG audit ID/pity/exchange/history、character/weapon acquisition/duplicates/mastery/overflow、evolution、reset reward/best floor、login claim、ad receipt、entitlementである。

server writeは`transaction.*`と`audit.*`を持ち、before/after、source/reason、catalog/banner/rule version、idempotency keyを監査できる。clientはpending表示と再照会を行い、失敗時に恒久値を推測しない。

## 9. canonical screens S01〜S12

| ID | 主責務 |
|---|---|
| S01 | title / resume / account recovery / migration |
| S02 | battle follow / auto / support arrival |
| S03 | unbounded tower / district / 100F cycle / best floor / next milestone |
| S04 | floor clear / reward / room or support choice |
| S05 | shop / income / delivery / automation / reconfigure |
| S06 | character / rarity / coin level / evolution / character mastery / party |
| S07 | weapon / rarity / equip / weapon mastery / build |
| S08 | boss phase / telegraph / break / failure / retry |
| S09 | 塔還り / lose-keep-gain / ruby / re-clear forecast / confirm |
| S10 | character+weapon gacha / odds / pity / exchange / history |
| S11 | ruby store / products / payment / rewarded ads / entitlement |
| S12 | newcomer+monthly+returner login / inbox / claim history |

required state候補は`canonical/SCREEN_STATE_REGISTRY.json`へ置くが、Round 008 sealまではPRESEAL_DRAFTである。purchase、draw、claim、ad、resetはnormal、loading、pending、success、failure、retry、reload recovery、multiple-tab conflict、refund/revocation/restoreを必要に応じて持つ。

## 10. stable ID、migration、状態遷移

`canonical/STABLE_ID_REGISTRY.json`と`canonical/STATE_TRANSITION_CONTRACT.json`はPRESEAL_DRAFTである。IDはlowercase ASCII namespace + stable slug/serial。display nameをpersistence keyにせず、aliasはread-only migration input。旧`dawn.*`は新規write不可。character 24枠、weapon 36枠はstable IDを予約し、表示名未確定でも再利用しない。

少なくともdraw、payment、ad reward、login claim、reset、evolution、mastery/exchange、account linkについて正常系、retry、reload、multiple tab、通信失敗、partial completion、refund、revocation、restoreを定義する。timeoutは失敗確定ではなく`PENDING_RECONCILIATION`、partial completionはtransaction IDでresume/compensateし、RNGをrerollしない。

## 11. 1〜10F slice

`FLOORS_1_10_DESIGN.md`は現在`PENDING_REVALIDATION`であり、まだ下位正本へ再昇格していない。最低scopeは無料確定4 characters、一時支援3 role以上、normal enemy 6、elite 2、district wall 1、3-phase boss 1、selectable shop 4、support 2、movement/contact/multiple enemies/hit sync/stair、coin level、最初の塔還り、最初のruby進化、beginner character/weapon gacha surface、mid-battle/placement/party/pity/claimの復旧境界である。

## 12. Step 1 / Step 2責務境界

Step 1はproduct boundary、ID、state、screen、trust boundary、prohibition、policy gates、field/enum/invariant/fixture/migration/validator requirements、Acceptance Matrix、contradiction inventory、independent critiquesを固定する。

Step 2はnew candidate/schema/validator/simulator/result schema/run plan/fixtures/executable sealとexact HP/damage/cost/drop/rate/soft pity/exchange/evolution/mastery/offline/reset formulas、deterministic PRNG/keying、large-number arithmeticを実装する。既存V1 candidate/schema/validator/simulatorを現行入力として実行しない。

`canonical/STEP2_DEPENDENCY_CLOSURE.json`はRoute 01-5で作成する予定であり、現在は存在しない。存在するまでStep 2は開始禁止。

validation minimumは`3 gameplay builds × 5 personas × 1,000 seeds = 15,000 scenarios以上`。personasはno-ad F2P、rewarded-ad F2P、monthly、controlled payer、high-spend stress。horizonsは1〜10F、first 100F、1,000F、10,000F相当、repeated resets。別枠でgacha/mastery Monte Carlo、transaction state、large-number serializationを行う。

## 13. platform・国内release gate

`canonical/POLICY_RELEASE_GATES.json`はRoute 01-2〜01-3で作成する予定であり、現在は存在しない。Apple/Googleのdigital goods payment、random item odds、restore/refund/revocation、account deletion、privacy/data safety、ads/tracking、日本のcard matching禁止、前払式支払手段該当性、未成年購入保護、個人情報・SDK・国外移転を調査対象とする。Step 1はlegal conclusionを出さず、release前に専門家確認する。

## 14. quality gateと現在工程

Step 1 PASS条件は、current authorityの旧有限100F・非ガチャ主張0、canonical/mirror一致、S01〜S12/stable IDs/state transitions/Step2 closure完成、policy gates記録、11独立批評のunresolved P0/P1=0、history不変、runtime/assets/V1/backend/Production不変、exact content commit/tree/deployment/evidence commitのseal結合である。

Vercel `READY`はbuild/deploymentだけを意味し、runtime品質、経済、policy適合、physical iPhoneを証明しない。

1. Step 1 正本統合・再封印 — **IN_PROGRESS**
2. Step 2 実行可能contractとsimulation — **BLOCKED**
3. Step 3 大量検証 — **BLOCKED**
4. Step 4 S01〜S12完成見本 — **BLOCKED**
5. Step 5 1〜10F + backend実装 — **BLOCKED**
6. Step 6 physical iPhone / billing / ad / PWA検証 — **BLOCKED**

次に許可されるのは`01_正本仕様・競合調査`の継続である。Route 01-0完了後はRoute 01-1のAcceptance Matrix拡張とrepository-wide contradiction inventoryへ進む。新Step 1 sealがlive `kimi`に存在し検証されるまで、`02`を開始しない。
