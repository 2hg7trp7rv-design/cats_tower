# Cat's Tower 統合正本仕様書

文書状態: **STEP 1 IN_PROGRESS — ROUND 008 FINAL PRESEAL REVIEW**  
更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**  
現在チャット: **`01_正本仕様・競合調査`**  
Step 2〜6: **BLOCKED UNTIL LIVE ROUND 008 SEAL**  
物理iPhone: **NOT_VERIFIED**

本書は、猫・戦闘・無制限塔・育成を主役とするCat's TowerのStep 1正本候補である。有限100F、非ガチャ、独立Dawn、9画面、localStorage恒久経済を前提とした旧仕様・旧PASSは履歴証拠であり、現行製品やStep 2を承認しない。

## 0. 権威と封印

競合時の順序は、最新ユーザー決定、`CHATGPT_PROJECT_INSTRUCTIONS1.md`、live active change-control/addendum/decision lock、liveで検証されたRound 008 seal、seal対象正本、現行Acceptance/critic/judge/evidence、下位契約、過去証拠とする。

現在の正本候補はすべて`PRESEAL_DRAFT`である。内容完成やVercel `READY`だけではStep 2を許可しない。`quality-reviews/step-1-reseal-round-008/seal-round-008.json`がexact content commit/tree、critic/judge、Preview、completion evidenceへ一致した場合だけStep 1 PASSが有効になる。

## 1. 製品定義

> 猫と猫人の冒険者を育て、制圧した塔内の店舗と配送網から戦闘支援を受け、上限のない塔を自動戦闘で登り、行き詰まったら一つの「塔還り」で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPG。

- 常設の名前付き編成は4体。一時増援は別支援層。
- 最初の価値は猫、戦闘、塔、育成。商会会長・会社経営を主役にしない。
- 店舗、収益、配送、募集、再投資は戦闘支援として残す。
- tapによる敵への直接damageは0。
- auto battleとoffline progressを基礎にする。
- collect-all、在庫補充、個別回収、強制連打を通常進行の必須作業にしない。
- 初期版へPvP、競争報酬、guild競争、battle pass、密集限定event、強制interstitial、常設banner、random substat迷路、大量分解作業を入れない。

## 2. 無制限塔・大数

- プレイヤーから見える最大階を設定しない。
- 10Fは最初の地区boss、100Fは最初の大型節目でありendingではない。
- 101F以降も通常進行する。
- 10F地区、100F cycle、milestone boss、modifier pool、背景変化、反復抑制をデータ駆動にする。
- 階数、HP、攻撃力、coin、cost、reset count、offline報酬は安全整数限界を超える前提とする。
- canonical integerは正規化10進文字列またはversioned arbitrary-precision型。`NaN`、`Infinity`、暗黙丸め、unsafe JavaScript `Number`を正本にしない。
- district/cycleのminimum-width decimal IDとmilestoneのleading-zeroなし正規化IDは`canonical/STABLE_ID_REGISTRY.json`へ一意に固定し、別表記をcanonical writeとして受理しない。

詳細な数値型、operation、rounding、cross-runtime fixtureは`canonical/STEP2_DEPENDENCY_CLOSURE.json`に固定する。

## 3. 戦闘・編成・商人要素

- 常設4体は各1本のweaponを装備する。
- 猫は移動、接敵/射程、予備動作、弾着、damage、hit reactionの因果を持つ。
- bossはphase、telegraph、break、failure diagnosis、retryを持つ。
- shop/deliveryはDPS、生存、coin flow、reclear速度へ届くが、毎階の手動配置・補充・回収を要求しない。
- 失敗診断は前衛崩壊、対空、回復、時間切れ、配送、装備等を示し、特定高rarityを固定解にしない。

最初のsliceは`FLOORS_1_10_DESIGN.md`に固定する。

## 4. 一つの強くてニューゲーム「塔還り」

canonical IDは`reset.tower_return`。表示名「塔還り」はrelease前の商標・類似名称確認対象。

- reset systemは一つだけ。旧Dawnはmigration aliasで、新規write不可。
- reset後は1Fから開始。
- 保存済み編成、shop設定、automation、bulk purchase、known-floor accelerationで再攻略を高速化する。
- 最初の有効resetは開始20〜35分をsimulation目標とする。
- 同じ最高階の反復だけでは新しいreset由来rubyを得ない。
- confirm前にloss/keep/gainとreclear forecastを完全表示する。
- server quote/commitとidempotencyで二重reset・二重rubyを防ぐ。

## 5. Level・進化・rarity

- characterは今周coinでlevel upし、level capなし。
- 100 levelごとにruby evolution資格を得る。
- 未進化でも101、201、301以降へ進み、未購入stageは順番にcatch up可能。
- 最初の進化は最初の有効塔還りの無料rubyで支払える。
- 100 levelごとにFX/UI/軽微な外見変化、大幅専用artは大節目のみ。
- base rarityとevolutionは別軸。

rarityは`N < R < RR < SR < SSR < UR`。N/Rには確定非ガチャ経路と主要役を用意し、終盤も相性、低cost、reset直後、shop/delivery utility、育成容易性で価値を持たせる。特定RR〜URが本編、evolution、reset、必須戦闘をgateしない。初期フル製品目標は24 characters / 36 weapons。

## 6. Gacha・重複熟練

- character gachaとweapon gachaを分離。
- 日常大量drawはcharacter/weapon ticket主体で、必須進化rubyと予算を分離。
- hard pity目標100、featured guarantee目標200、compatible banner familyへcarryover。
- draw前にodds、pity、pickup、exchange、duplicate conversion、ending rule、historyを表示。
- 限定戦力にはrerun、deterministic exchange/selection、carryoverを用意。
- comp gacha/card matchingは禁止。
- 初日中にSSR character 1体とSR以上weapon 1本を確定保証。

masteryは、first-copy機能完成、初期〜中期duplicateの実用育成、初回後20体分以上または同等資源による任意の完全熟練に分ける。最大の機能強化は前半、後半は限界効用逓減。通常PvEを完全熟練前提にせず、selector、exchange、universal fragment、rerun、overflowを持つ。

## 7. Ruby・login・課金・広告

ruby sourceは課金、新記録/一度限り節目を伴う塔還り、任意rewarded ad。server ledgerはpaid、free-reset、free-ad、free-otherを分離し、有償rubyを失効させない。

必須surfaceはcharacter/weapon gacha、newcomer/monthly/returner login、payment、rewarded opt-in ad。初期広告はrewardedのみで、battle、boss、draw result、purchase、save recovery中に出さない。

- purchase、banner/rate、rewarded-ad offer、login campaignはそれぞれimmutableなcatalog/versionを持つ。
- adはopt-in前にoffer ID/version、報酬、eligibility、daily capを固定し、受諾後のretryで新しいofferへ再評価しない。
- login claimはcampaign ID/version、server period、報酬、missed-day ruleを固定し、受諾後のretryで新しいcampaignへ再評価しない。
- 使用済み有償rubyの返金・取消で直接reverseできない場合は、source transaction、policy version、監査IDを持つ明示的なpaid-ruby deficitまたは購入制限状態をserverに記録する。free-reset、free-ad、free-otherを黙って削らず、unsigned underflowやclient-only負残高を作らない。

広告なしF2Pでも本編、塔還り、必須進化を継続し、30〜45日でfeatured UR保証1回へ到達する目標を持つ。monthly accelerationは約1.5〜2倍、高額stress personaは約3〜5倍を目標上限とし、無制限倍率を禁止する。

報酬テンポ候補は最初の10分50〜100draw、1時間150〜250、7日500〜800、通常no-ad 40〜60/day、optional ad +20 target/hard cap 40、bulk 10/50/100、newcomer visible upgrade ≤45秒、normal session ≤120秒。これらはStep 2/3で合否を決める候補値であり確定値ではない。

## 8. Server authority

localStorageを正本にしない対象:

- paid/free ruby、refund deficit、tickets、product/rate/banner/ad-offer/login-campaign catalog
- receipt、webhook/RTDN、refund、revocation、restore
- draw result、RNG audit ID、pity、exchange、history
- character/weapon acquisition、duplicate、mastery、overflow
- evolution、reset reward、highest floor
- login claim、ad receipt、entitlement、account link/deletion

server operationはtransaction ID、idempotency key、audit ID、accepted catalog/offer/campaign versionを持つ。client timeoutは失敗確定ではなくpending reconciliation。詳細は`canonical/STATE_TRANSITION_CONTRACT.json`。

## 9. Canonical screens S01〜S12

- S01: title/resume/account link/migration/deletion
- S02: battle follow/auto/support/offline reconciliation
- S03: unbounded tower/district/100F cycle/best floor/next milestone
- S04: floor clear/reward/choice
- S05: shop/income/delivery/automation/reconfigure
- S06: character/rarity/coin level/evolution/mastery/party
- S07: weapon/equip/mastery/build/diagnosis
- S08: boss phase/telegraph/break/failure/retry
- S09: tower return/loss-keep-gain/ruby/reclear forecast
- S10: character+weapon gacha/odds/pity/exchange/history
- S11: wallet/store/payment/rewarded ads/entitlement
- S12: newcomer/monthly/returner login/inbox/history

required state、authority、normal/error/retry/reload/multi-tab/refund/revocation/restoreは`canonical/SCREEN_STATE_REGISTRY.json`に固定する。

## 10. Stable ID・migration・状態遷移

`canonical/STABLE_ID_REGISTRY.json`、`canonical/SCREEN_STATE_REGISTRY.json`、`canonical/STATE_TRANSITION_CONTRACT.json`をseal対象とする。IDはlowercase namespaceとstable segmentを使い、display nameをpersistence keyにしない。aliasはread-only migration input。旧Dawn/cat/shop IDはcanonical outputへ一度だけnormalizeし、raw backupとprovenanceを保持する。

## 11. Platform・Japan release gate

`canonical/POLICY_RELEASE_GATES.json`をseal対象とする。Apple/Google digital goods、randomized-item odds、restore/refund/revocation、account deletion、privacy/Data Safety、ads/tracking、日本のcard matching、前払式支払手段、未成年購入保護、個人情報・国外移転をrelease blockerとして記録する。法的結論やstore approval保証は出さず、submission直前policy refreshと日本法専門家確認を必須にする。

## 12. Step 1 / Step 2 boundary

Step 1はproduct meaning、ID、state、screen、trust boundary、prohibition、policy gates、field/enum/unit/invariant/fixture/migration/validator/result requirementsを固定する。Step 2は`canonical/STEP2_DEPENDENCY_CLOSURE.json`に従い、new candidate/schema/validator/simulator/result/run plan/fixtures/executable sealを実装する。

旧V1 candidate/schema/validator/workflowは`BLOCKED_SUPERSEDED_INPUT`で、in-place延命、promotion実行、old observed holdout再利用を禁止する。

Step 2最低検証設計は3 builds × 5 personas × 1,000 seeds = 15,000 scenarios以上。horizonsは1〜10F、100F、1,000F、10,000F相当、repeated resets、30〜45日経済。別枠でgacha/mastery tails、pity、refund/replay/race、state-machine、large-number property testsを行う。

## 13. Step 1 PASS条件

- repository-wide current-authority旧主張0、未分類path/match 0
- active canon/mirror一致
- 1〜10F、S01〜S12、stable IDs、state transitions、policy gates、Step 2 closure完成
- 競合調査とcopy boundary記録
- 10独立critic＋final judgeのunresolved P0/P1=0
- 過去証拠不変
- runtime、asset、V1 executable、backend、provider、Production不変
- exact frozen content commit/tree、critic/judge evidence、matching `kimi` Preview、seal、activation evidenceの結合

現在はfinal mirror syncとcritic/judge/seal中であり、Step 1は`IN_PROGRESS`、Step 2は`BLOCKED`。Vercel `READY`はbuild/deployment証拠だけである。
