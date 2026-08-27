# Cat's Tower 競合構造調査 — Route 01-2

調査cutoff: **2026-08-26 23:59:59 JST**  
観測日: **2026-08-27**  
状態: **COMPLETE_PRESEAL**  
Repository: `2hg7trp7rv-design/cats_tower` / branch: `kimi`

本調査は、公式・store listing・platform policy・user review・推論を分離する。user reviewは不満仮説であり、mechanicの再現済み事実ではない。競合のUI、名称、画像、演出、exact数式、exact確率、商品価格をproduction specificationへコピーしない。

## 1. 商人サーガ

### STORE_LISTING
仲間を雇い、塔内で店を開き、商売・仕入れで仲間を支援する構造が明示されている。IAPと定期購読があり、2026年8月のversion historyにはlogin bonus更新とdata transfer追加がある。

### USER_REVIEW signal
高階層と転生を反復する継続性を評価する声がある一方、大量交換・level上げの手動負荷、広告割込み、強さの因果が読みづらいという不満仮説がある。

### Cat's Tower inference
**採用:** 店舗→収益/配送→戦闘支援、停滞→単一reset→高速再攻略。  
**変換:** 主人公は猫と猫人。店舗はS05で戦闘を支援し、商会会長・会社経営を主役にしない。  
**不採用:** 大量tap、個別回収、強制広告、競合固有の商人オヤジ・UI・価格・式。

## 2. 魔王「世界の半分あげるって言っちゃった」

### STORE_LISTING
放置型の勇者育成、継続追加、class upやdaily報酬の存在が読み取れる。exact reset式・広告倍率・確率は`NOT_PUBLICLY_VERIFIED`。

### USER_REVIEW signal
reset効果が見えにくい、広告収益が通常進行より強い、reset損失を誤解したという不満仮説がある。

### Cat's Tower inference
**採用:** 停滞点をreset判断へ変換し、前回最高階まで速く戻す。  
**変換:** S09でloss/keep/gainと再攻略予測を完全表示。same-best repeat rubyは0。  
**不採用:** 広告を実質必須収益にする、全損範囲を曖昧にする、回数だけ増えて効果が読めないreset。

## 3. キノコ伝説

### STORE_LISTING
大量ガチャ訴求、放置RPG、仲間募集、guild・共闘・競争を重ねた高密度live serviceである。

### USER_REVIEW signal
大量抽選がmission進行に分割される、抽選levelで上位レアが実質lockされる、chat・課金圧が強いという不満仮説がある。個別reviewであり、全serverの確率事実ではない。

### Cat's Tower inference
**採用:** 次の10連が遠過ぎない、短時間で可視強化、duplicateが長期進捗へ変換される体感。  
**変換:** 日常大量drawはcharacter/weapon ticket主体。first copyで機能完成し、20+ duplicateは任意熟練。  
**不採用:** 回数水増し、hidden 0% rarity lock、初期PvP/guild競争、密集event、必須進化rubyとの恒常競合。

## 4. AFK Journey

### OFFICIAL / STORE_LISTING
hero recruitment、idle rewards、auto battle、formation strategy、shared levels、seasonal contentが確認できる。exact pity・duplicate curve・paid accelerationは`NOT_PUBLICLY_VERIFIED`。

### Cat's Tower inference
**採用:** offline資源→復帰直後の成長、戦闘前の編成判断、取得後すぐ役割を試せる育成。  
**変換:** 無制限塔の4体編成・武器1本・店舗支援へ縮約。  
**不採用:** 1〜10Fへopen-world探索、season、guild、territoryを同時投入し、猫・塔・戦闘の主役性を薄めること。

## 5. Go Go Muffin

### STORE_LISTING
idle battler、auto mode、class progression、pet、guild・協力dungeon/raidが確認できる。exact daily時間・gacha条件は`NOT_PUBLICLY_VERIFIED`。

### USER_REVIEW signal
広告なし・auto modeへの評価と、必須協力contentや長いdaily拘束が「idle/cozy」期待と衝突するという不満仮説がある。

### Cat's Tower inference
**採用:** auto進行中もbuild準備が効く、任意manual timing、仲間の役割差。  
**不採用:** 毎日長時間のgroup拘束、初期guild競争、solo放置進行を止めるmatchmaking。

## 6. Capybara Go

### STORE_LISTING
text-based roguelike、random events、gear、animal companions、PVE expansion、pet growthが確認できる。

### USER_REVIEW signal
任意広告と少操作を評価する声がある一方、数日後の進行鈍化・購入促進、system理解負荷への不満仮説がある。

### Cat's Tower inference
**採用:** 1run中の少数で読めるmodifier選択、選択直後に違いが見える構造。  
**変換:** tower district modifier poolへ組み込み、恒久collectionの代替にはしない。  
**不採用:** exact skill/UI/演出/確率/商品価格、staminaで本編を止める設計。

## 7. 横断matrix

| 比較軸 | 支持された強い構造 | 失敗仮説 | Cat's Tower規則 |
|---|---|---|---|
| reset | 停滞から再始動し、前回より速く戻る | 全損不明、効果不明、同じ地点反復 | 単一reset、loss/keep/gain、20〜35分初回候補、same-best ruby 0 |
| mass draw | 次の抽選が近く、結果が成長へ変わる | 数だけ水増し、上位0% lock | tickets主体、10/50/100 bulk、初日SSR+SR武器保証 |
| premium currency | 使途と台帳が明確 | 必須進化と日常gachaが競合 | rubyは進化優先、ledger origin分離 |
| duplicate | 推しの長期目標 | first copy未完成、通常PvE人質 | first-copy functional、前半強化、後半逓減、overflow |
| low rarity | specialist・低cost・reclear用途 | onboarding後に死ぬ | N/Rだけで主要役、終盤utilityをStep 3検証 |
| ads | opt-inで目的と報酬が明確 | 強制・割込み・通常収益を圧倒 | initial rewarded only、no-ad F2P成立 |
| paid acceleration | 時間短縮・明示商品 | paywall、fake discount、無制限倍率 | monthly 1.5〜2x、高額stress 3〜5x候補 |
| daily/live ops | permanent coreと少数event | 赤点・期限・group拘束の密集 | permanent/pickup/login中心、PvP等延期 |
| UI density | 主目的と次行動が即読 | battleをshop/event/menuが覆う | S01〜S12分離、battleは猫・敵・因果を主役 |
| churn | automation、bulk、透明な目標 | 手動反復、曖昧reset、FOMO | auto/bulk、敗因診断、見える節目 |

## 8. Evidence gaps

次は競合について公開情報から確定しない。

- exact HP/cost/drop/reset formulas
- exact gacha rates, soft pity, hard pity, pickup guarantee, carryover
- exact paid acceleration
- complete duplicate/mastery curves
- cohort retention/churn causality
- current ad frequency for every build and region

これらを推測してCat's Towerへコピーしない。Cat's Towerの値はStep 2/3の独自candidateとsimulationで決める。

## 9. Copy-prohibited boundary

競合の画面配置、固有名称、character/weapon、画像、animation、音、story beat、exact式、確率、商品価格、広告文言をコピーしない。採用するのは「再投資」「reset後高速再攻略」「frequent free draw」「duplicateが長期熟練へ変換」等の抽象構造だけ。
