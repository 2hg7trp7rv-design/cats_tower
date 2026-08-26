# Cat's Tower 統合正本仕様書

文書状態: **CORE_AUTHORITY_SYNC_PASS — STEP1_RESEAL_IN_PROGRESS**  
更新日: **2026-08-26**  
作業branch: **既存の`kimi`のみ**  
対象: スマートフォン縦持ち Web / PWA。将来のiOS・Android billing / advertisement adapterを含む。  
最初の実装slice: **1F〜10F**  
最終的な塔の高さ: **プレイヤーから見て上限なし**  
数値状態: 明示的に固定した境界以外は`SIMULATION_CANDIDATE`。  
現在工程: **Step 1 正本統合・再封印**。Step 2以降は未許可。

本書はCat's Towerの製品境界、状態遷移、画面責務、経済境界、保存境界、禁止事項を定義する最上位正本である。2026年8月25日までの有限100F・非ガチャ仕様に対する旧PASSはGit履歴上の証拠として保持するが、現在の製品を承認しない。

---

## 0. 権威、変更管理、文書状態

### 0.1 情報源の優先順位

同一scopeで内容が競合する場合は、次の順で解決する。

1. ユーザーの最新の明示的な製品決定
2. live `kimi`上の有効な`active-change-control`、addendum、`user-decision-lock`
3. 新しいStep 1 sealで封印された本書と状態mirror
4. 現行Acceptance、監査round、handover、deployment evidence
5. 下位正本、simulation contract、runtime
6. 過去の有限100F正本、過去PASS、参考画像、競合作品

下位文書が本書と競合する場合は、本書を優先し、下位文書を`PENDING_REVALIDATION`として扱う。競合箇所を実装やsimulationへ持ち込んではならない。

### 0.2 本書の今回の判定

`00_統括・工程管理`で、次の三つの中核権威を現行方針へ同期する。

- `MASTER_SPEC.md`
- `PROJECT_STATUS.json`
- `quality-reviews/step-1-canonical-design/active-change-control.json`

この三文件の同期がPASSしても、Step 1全体の再封印が完了したことにはならない。`FLOORS_1_10_DESIGN.md`、`QUALITY_GATE.md`、`PROJECT_HANDOVER.md`、`README.md`、`AGENTS.md`、`AI_PROJECT_POLICY.json`、simulation契約、schema、validator、workflow等の全面統合は`01_正本仕様・競合調査`で行う。

### 0.3 旧仕様の扱い

次の旧契約は現行製品境界として失効する。

- 塔は1F〜100Fで終了する
- 101F以降を禁止する
- 100F到達を製品エンディングとする
- 猫はすべて公開条件だけで取得し、ガチャを持たない
- 有償通貨、ログインボーナス、課金、広告を禁止する
- 通貨をコインと夜明けの欠片だけに限定する
- Dawnを独立したリセットとして維持する
- 画面数をS01〜S09の9画面に固定する
- 3build×1,000seedの3,000scenarioだけで十分とする
- localStorageだけで恒久通貨、抽選、権利を管理できるとする

過去のAcceptance、監査、commit、deployment evidence自体は書き換えない。

---

## 1. 製品定義

### 1.1 一文で言うと

> 猫と猫人の冒険者を育て、制圧した塔内の店と配送網から支援を受け、上限のない塔を自動戦闘で登り、行き詰まったら一つの強くてニューゲームで恒久成長して前回より高く進む、スマートフォン縦画面専用の放置インクリメンタルRPG。

### 1.2 プレイヤーへ提供する中核感情

1. 猫が実際に入口から走り、接敵または射程へ入り、攻撃が当たる因果を読める。
2. 短い間隔でコイン、レベル、装備、抽選、熟練、進化のいずれかが進む。
3. 行き詰まりは失敗ではなく、リセットして前回より速く再攻略する転換点になる。
4. 店舗と配送は別ゲームではなく、前線のDPS、生存、収益、再攻略速度へ届く。
5. N・Rにも終盤用途があり、URだけを並べる一択にならない。
6. 大量ガチャを引けるが、回数だけを水増しした無価値抽選にはしない。
7. 推しキャラ・推し武器は20体分以上の長期熟練で育て続けられる。

### 1.3 独自の柱

- **生きた猫の塔**: 制圧階が生活・店舗・配送の空間として残る。
- **配置が戦闘へ届く**: 店舗や配送物が前線支援へ変換される。
- **上限のない登攀**: 10F地区と100F大サイクルを反復・変化させる。
- **高速な再攻略**: リセット後は1Fから始め、既知部分を前回より大幅に速く登る。
- **大量抽選と長期熟練**: 入手機会は多く、初回入手、実用breakpoint、完全熟練を分離する。
- **猫主役**: 商人要素、課金、ガチャは猫・戦闘・塔の価値提案を奪わない。

### 1.4 初期製品の非目標

次は初期製品へ入れない。

- 商会会長、会社経営、企業ロビーを主役にする構造
- 強制interstitial広告、常設banner広告
- PvP、競争報酬、guild競争
- battle pass、密集した限定event
- random substat装備迷路、膨大な手動分解
- stamina / energyによる本編停止
- 完全熟練を通常PvEの前提にする設計

---

## 2. 対象端末と操作原則

- スマートフォン縦持ちを主対象とする。
- iPhone Safari、PWA standalone、ChatGPT内ブラウザ、Android Chromeを確認対象とする。
- PC、横画面、キーボードを前提にしない。
- 主要操作は片手親指の到達範囲へ置く。
- 主要tap領域は48×48 CSS px以上、購入・リセット・消費確定等は56×56 CSS px以上を基本とする。
- 隣接する重要操作の間隔は8 CSS px以上を基本とする。
- 色、細線、振動だけを情報伝達に使わない。
- `100vh`固定だけに依存せず、dynamic viewportとsafe-areaを扱う。
- tapは敵へ直接damageを与えない。
- active inputは最適化、編成、支援選択、skill timing等に限定し、連打を基礎進行条件にしない。
- auto battleとoffline progressを基礎とし、個別回収、補充連打、毎階の手動再配置を通常作業にしない。

---

## 3. 無制限の塔

### 3.1 高さの契約

- プレイヤーから見える最大階を設定しない。
- 100Fは最初の大型物語・進行節目であり、終了地点ではない。
- 101F以降も通常進行として継続する。
- 無限数の固有背景、敵、物語を事前に手作業で用意したように見せない。
- 塔はデータ駆動のdistrict、cycle、modifier、boss、reward bandで構成する。

### 3.2 構成単位

| 単位 | 固定責務 |
|---|---|
| 1F | 一つの戦闘・イベント・施設・選択単位 |
| 10F | 一地区。通常階、商業、支援、救出、壁、elite、bossを構成 |
| 100F | 一つの大サイクル。大型boss、背景・modifier・報酬帯を更新 |
| 1000F等 | 長期記録・演出候補。最終値はStep 2以降で検証 |

### 3.3 反復制御

- 同一敵編成、同一背景、同一modifierの連続回数へ上限を設ける。
- 10F内の役割patternは認知可能にしつつ、敵、modifier、店舗支援、報酬で変化させる。
- 100Fごとに新しい脅威、組合せ、演出、報酬帯の少なくとも一つを更新する。
- 長期階層では全戦闘を逐次renderする必要はないが、結果は同一seed・同一入力から再現可能にする。

### 3.4 大数契約

階数、敵HP、damage、coin、cost、reset count、offline rewardは、JavaScript `Number`の安全整数を超えることを前提とする。

- 永続化値は任意精度整数または正規化した10進文字列で保持する。
- `NaN`、`Infinity`、暗黙の浮動小数丸めを保存しない。
- 表示短縮と内部値を分離する。
- 丸め方向、比較、加算、乗算、上限処理をschemaとvalidatorで固定する。
- save、network、analytics、simulationで同一表現を使用する。

---

## 4. 戦闘と増援

### 4.1 戦闘の可読性

- 猫は画面上を移動し、接敵または射程へ入って攻撃する。
- 敵は複数同時出現可能とする。
- 攻撃予告、弾着、damage、hit reaction、hit stopを同期させる。
- 前衛、対空、回復、後列妨害、盾破壊、範囲攻撃等の役割差を見た目と結果で理解できるようにする。
- bossはphase、break、危険予告、失敗原因を表示する。
- 敗北後は火力不足、生存不足、対空不足、後列処理不足、経済不足等の改善候補を提示する。

### 4.2 常設編成と一時増援

- 常設の名前付き編成は4体。
- プレイアブル種族は猫と猫人。
- 一時増援は常設4体とは別の支援layerとする。
- 増援は前衛、遠隔、runner等の明確な役割差を持つ。
- 常設編成人数を増援で恒久的に偽装しない。

### 4.3 戦略軸

Step 2・3では少なくとも三つの戦略軸を検証する。現行候補は次とする。

- combat / 直接戦闘
- reinforcement / 増援・召喚
- commerce / 店舗・配送

名称や内部構造を変更する場合も、三つ以上の意味の異なるbuildが一強化しないことを検証する。

---

## 5. 店舗、配送、生きた塔

### 5.1 商人要素の境界

残す要素:

- 店舗配置
- 自動収益
- 配送
- 仲間募集
- 再投資
- 店舗相性、隣接、支援効果
- リセット後の自動復元・高速再構築

削除または主役にしない要素:

- 商会会長というプレイヤー肩書
- 会社経営を中心にした物語
- 独立した企業ロビー
- 在庫補充、個別回収、全回収の反復作業
- 戦闘と因果のない店舗管理

### 5.2 配送の可視化

- 店舗の生産物または支援効果が前線へ届く因果を表示する。
- 戦闘画面では詳細管理を常設せず、到着・効果・次回予定を簡潔に示す。
- 詳細な配置、比較、再構成は専用画面で行う。
- リセット後は、許可された範囲で保存済み店舗設定を自動復元する。

---

## 6. キャラクター、武器、収集規模

### 6.1 初期フル製品目標

- キャラクター: 24体
- 武器: 36本
- 常設編成: 4体
- 装備: アクティブキャラクター1体につき武器1本

1F〜10Fでは縮小subsetを実装し、24体・36本が完成したように表示しない。

### 6.2 物語必須キャラクター

- 第1地区の主要役割を担う物語必須キャラクターは、購入や有償ランダムだけに依存させない。
- ムギ、ルナ、トト、コハクを含む第1地区core rosterには、明示された無料・確定経路を用意する。
- 初日保証のSSRキャラクターはcore rosterを置換する必須条件ではなく、選択肢と爽快感を増やす。

### 6.3 武器

- キャラクターガチャと武器ガチャを分離する。
- 初期版ではrandom substatを導入しない。
- 武器は役割、相性、skillを持つ。
- 旧「塔全体で一つの三系統武装」は、個別武器システムへ統合・再設計する対象であり、並行する独立強化系として残さない。

---

## 7. レベル、進化、基礎レアリティ

### 7.1 コインレベル

- キャラクターは今周coinでレベルアップする。
- レベル上限を設けない。
- 強くてニューゲームで今周レベルを失う候補とする。
- `×10`、`×100`、`節目まで`、`MAX`、`おすすめ`の一括購入を用意する。

### 7.2 100レベルごとの進化

- レベル100ごとに進化資格を一段得る。
- 進化にはrubyを使用する。
- 進化していなくても101、201、301以降へレベルアップできる。
- 未購入の進化段階は後から順番に追いついて購入できる。
- 最初の進化は、最初の有効リセットで得る無料rubyから支払えるようにする。
- 購入または広告視聴を最初の進化条件にしない。
- 100レベルごとにFX、UI、軽微な見た目変化を付ける。
- 専用の大幅アート変更は大節目へ限定する。

進化可能段階数の基礎式:

`eligibleEvolutionStages = floor(highestQualifiedLevel / 100)`

リセット後に今周levelが下がっても、一度正当に獲得した進化資格と購入済み進化を巻き戻さない。

### 7.3 基礎レアリティ

固定順序:

`N < R < RR < SR < SSR < UR`

- 基礎レアリティは固定identityとする。
- Nが進化してUR表記になる設計にはしない。
- 進化、level、skill熟練、武器、店舗支援は別軸で予算化する。
- URは概して強いが、すべての役割、敵相性、リセット立ち上がり、店舗・配送価値で常に最強にしない。

### 7.4 入手境界

- N・Rのキャラクターと武器には、物語、塔報酬、交換、店舗、ログイン等の確定非ガチャ経路を用意する。
- 通常攻略に必要な主要役割はN・Rだけでも構成できる。
- N・Rは相性特化、低cost、リセット直後、店舗・配送、skill完成容易性で終盤用途を持つ。
- RR〜URはガチャ入手routeを持つ。
- 特定RR〜URを本編、進化、リセット、必須戦闘機能の鍵にしない。

---

## 8. ガチャ、天井、限定、初日保証

### 8.1 ガチャsurface

- character bannerとweapon bannerを分離する。
- 通常の同一poolへキャラクターと武器を混在させない。
- 特別mixed bannerを将来検討する場合は、別Acceptanceを必要とする。

### 8.2 抽選資源

- 日常の大量character drawはcharacter ticketを主力にする。
- 日常の大量weapon drawはweapon ticketを主力にする。
- pickup ticketを別classとして持てる。
- rubyは進化を優先し、pickup ticketまたは選択的なpremium drawの補助に使用できる。
- 日常大量drawと必須進化が同一ruby予算を恒常的に奪い合う設計は禁止する。

### 8.3 天井と保証

現行固定目標:

- hard rarity pity: 100 draw
- featured pickup guarantee: 200 draw
- 対応する同banner classへのcarryover: 必須
- visible counter: 必須
- deterministic exchange: 必須

排出率、soft pity、10連保証、交換rateは`SIMULATION_CANDIDATE`とし、Step 2・3で確率適合性を検証する。

### 8.4 開示

抽選前に次を表示する。

- itemまたは曖昧さのないtypeごとの確率
- hard pityとfeatured保証の現在値
- carryover対象
- 重複変換
- 交換point
- banner終了後の扱い
- draw履歴
- 有償・無料資源の消費順序

### 8.5 限定戦力

戦闘性能を持つ限定character・weaponは、少なくとも次を満たす。

- 復刻
- 確定交換または選択
- compatible bannerへのpity carryover
- paid pityの消失禁止
- 永久入手不能状態の禁止

外見のみの限定は別途設計できる。

### 8.6 初日保証

初日中に、明示された確定経路で次を保証する。

- SSR character 1体
- SR以上weapon 1本

保証characterとweaponは役割が著しく噛み合わない組合せにしない。

---

## 9. 重複skill熟練

characterとweaponの重複は、それぞれ固有のskill熟練または等価な確定資源へ変換する。

### 9.1 三つの完成line

1. **機能完成**: 初回入手だけで広告どおりの役割と基本skillを使える。
2. **実用育成**: 初期〜中期重複で主力として十分な性能へ到達する。
3. **完全熟練**: 初回後20体分以上の有効重複または同等資源で到達する長期やり込み。

### 9.2 固定条件

- 20体以上は任意のendgame masteryであり、通常所有の未完成表示にしない。
- 回復、挑発、対空、範囲攻撃等の基本機能を重複で人質にしない。
- 最大の機能的強化は前半に置き、後半ほど限界効用を逓減させる。
- 通常PvEを完全熟練前提にしない。
- 本編、リセット、進化を完全熟練でlockしない。
- 選択箱、交換通貨、汎用欠片、復刻、pity carryover等の確定進行を用意する。
- 最大後の重複を消滅させない。
- UIでは「未完成」ではなく「長期熟練」と表示する。

### 9.3 検証breakpoint

Step 2・3では少なくとも次を別々に測定する。

- 初回入手
- 追加1体
- 追加3体
- 追加5体
- 追加10体
- 追加15体
- 追加20体
- 最終上限

最終上限は20未満へ下げない。20を超える値、各段階効果、汎用欠片価値はsimulationで決める。

---

## 10. Ruby、通貨、商品

### 10.1 通貨registry

| 種別 | lifetime | 主用途 | 権威 |
|---|---|---|---|
| coin | run | 今周level、店舗、短期強化 | serverまたは検証可能なrun authority |
| paid ruby | profile | 進化、選択的premium用途 | server |
| free ruby from reset | profile | 進化、選択的premium用途 | server |
| free ruby from ads | profile | 進化、選択的premium用途 | server |
| other free ruby | profile | event、login等 | server |
| character ticket | profile | character draw | server |
| weapon ticket | profile | weapon draw | server |
| pickup ticket | profile | pickup banner | server |
| exchange / mastery resource | profile | 確定交換・熟練catch-up | server |

UIでrubyを一つの残高に見せる場合も、内部台帳では有償・無料・取得元を分離する。

### 10.2 Ruby入手経路

- purchase
- 新最高階または一度限り節目を伴う強くてニューゲーム
- 任意のrewarded advertisement
- 明示されたlogin、event、achievement等の無料配布

同じ最高階へ繰り返し到達するだけで、新しいreset rubyを発行しない。

### 10.3 有償ruby

- 失効させない。
- refund、revocation、restore、chargeback、消費順序を監査可能にする。
- clientから新規発行できない。

### 10.4 初期商品catalog

初期候補:

- ruby pack
- one-time starter pack
- monthly pass
- cosmetic / style pack
- 内容が明示されたticket pack

fake discount、曖昧なvalue、購入後に内容が変わるofferを禁止する。

### 10.5 課金加速境界

- monthly pass persona: 約1.5〜2倍を目標上限
- high-spend stress persona: 約3〜5倍を目標上限
- 課金でしか解放できない本編階、戦闘rule、reset機能を作らない。
- 課金が塔・reset progressionから独立した無制限powerを生まないようにする。

---

## 11. 強くてニューゲーム

### 11.1 単一system

- reset systemは一つだけ。
- 旧Dawnは統合、改名、または削除する。
- 二つのprestige、通貨、確認画面を併存させない。
- 正式名称はCat's Tower独自名とする。名称は`01`で決定・封印する。

### 11.2 起動条件と周期

- 最初の有効resetはforeground 20〜35分を目標とする。
- reset後は1Fから開始する。
- saved formation、shop配置、automation、bulk purchase、known-floor fast-forwardを復元する。
- 前回最高階までの再到達時間を大幅に短縮する。
- 成熟後reset cycleは5〜25分、target 12分を候補とする。

### 11.3 失う、残る、得る

原則として失う:

- current floor
- run coin
- run character levels
- run shop levels
- temporary relic / effect
- current battle、delivery、temporary state

原則として残る:

- acquired characters and weapons
- base rarity
- evolution stages and eligibility
- character / weapon mastery
- ruby、tickets、exchange resources
- pity、draw history、exchange progress
- purchases、monthly entitlement
- collection、achievements、highest floor、permanent unlocks
- allowed automation and saved configuration

得る:

- new-record / one-time milestoneに基づくfree ruby
- permanent acceleration / unlock候補
- known-floor re-clear speed

### 11.4 reset preview

確定前に、失う物、残る物、獲得ruby、次周の予測短縮、未保存設定を表示する。通信再送、multiple tap、reloadで二重rewardを発行しない。

---

## 12. Login bonus、広告、live operations

### 12.1 Login bonus

- newcomer track
- monthly track
- returner track

server timeを使用し、同日二重受取を防止する。1日逃しただけで月間進捗全体を0へ戻さない。

### 12.2 広告

初期製品はrewarded advertisementのみ。

- userの明示opt-in
- 視聴前に報酬、上限、残回数を表示
- battle、boss、gacha result、purchase、save recoveryを中断しない
- forced interstitial、bannerを初期製品へ入れない
- server callbackまたは検証可能なreceiptで一度だけ付与
- 広告なしplayerも本編、進化、reset、save、floor clearを継続可能
- 強制広告がない状態で実質価値のない「広告削除商品」を販売しない

### 12.3 初期live operations

- permanent content
- pickup banner
- login event

battle pass、重複する多数の限定event、PvP、ranking reward、guild competitionは延期する。

### 12.4 未成年、privacy、policy

release前に次をgate化する。

- age rating
- minors purchase protection
- parental control
- consent
- personalized ad restrictions
- privacy disclosure
- inappropriate-ad reporting
- platform billing、random-item odds、refund、restore
- 日本国内の有償通貨・ランダム型販売・コンプリートガチャ禁止への適合

---

## 13. 大量ガチャと報酬テンポ

「キノコ伝説と同程度」は、変動するlive serviceのruby個数、確率、UIをコピーする意味ではない。入手努力、抽選頻度、保証到達、成長実感をCat's Tower独自の設計で比較する。

### 13.1 現行検証候補

| 期間 | character + weapon合計draw |
|---|---:|
| 最初の10分 | 50〜100 |
| 最初の1時間 | 150〜250 |
| 最初の7日 | 500〜800 |
| steady no-ad F2P / day | 40〜60 |
| optional ads additional / day | target 20、hard cap 40 |

- bulk draw: 10、50、100
- 初回演出後はskip可能
- new player visible power gain: 最大45秒目標
- steady session visible power gain: 最大120秒目標
- 10連でR以上または等価な熟練progressを最低一つ保証する候補
- 50連でRR以上、選択、pity milestone等の明確なprogressを保証する候補

これらは`SIMULATION_CANDIDATE`であり、回数だけを満たして価値を失う場合は不合格とする。

### 13.2 F2P保証

- no-ad F2Pが必須core rosterの進化費用を受け入れた速度で100%賄えること。
- no-ad F2Pが30〜45日でfeatured UR guarantee 1回へ到達できる目標を持つ。
- 30〜45日はUR完全熟練の保証ではなく、featured UR初回入手保証である。

---

## 14. Offline progress

- offline progressは放置ゲームの基礎とする。
- offline capの現行候補は24時間。最終値はsimulationで確認する。
- 未見のstory choice、shop choice、relic choice、reset confirmationをofflineで自動決定しない。
- 初回runの未見bossをofflineだけで突破させない。
- reset後の既知階層は、明示したguard内で高速再攻略可能とする。
- offline reward、広告倍率、monthly pass倍率を分離表示する。
- client clock変更だけでrewardを増やせないようにする。

---

## 15. Save、account、server authority

### 15.1 authority分離

local clientが保持できるもの:

- presentation cache
- current animation state
- recoverable run snapshot
- user preferences
- serverから取得したread cache

serverを正本とするもの:

- account / guest linking
- paid / free ruby
- tickets、exchange resources
- product catalog version
- receipt、webhook、refund、revocation、restore
- gacha result、random audit ID、pity、history、exchange
- acquired characters / weapons
- duplicates、mastery、overflow
- evolution stages
- reset reward、highest floor
- login claims
- ad reward receipts
- monthly and other entitlements

### 15.2 transaction contract

purchase、draw、evolution、duplicate conversion、reset、login、ad、refundは、すべて次を持つ。

- immutable transaction ID
- idempotency key
- server timestamp
- before / after balance
- source and reason
- catalog / banner / rule version
- support lookup ID

retry、reload、multiple tabs、raceで二重付与・二重消費しない。

### 15.3 migration

- 旧local saveをraw backupしてからmigrationする。
- local gameplay stateとserver-owned economyを分離する。
- guestからaccount linkingでduplicate grantを発生させない。
- rollback、older client、future schemaから恒久資源を巻き戻せないようにする。
- migration失敗時は破損状態を上書きせず、復旧・問い合わせ導線を表示する。

---

## 16. 12画面の責務

| ID | 画面 | 主責務 |
|---|---|---|
| S01 | title / resume / account | 新規、resume、account link、migration recovery |
| S02 | battle follow | 猫・敵・攻撃予告・主要skill・支援到着 |
| S03 | unbounded tower | current / best floor、10F district、100F cycle、次節目、browse |
| S04 | floor clear / placement | reward、stair、shop / support / rescue choice |
| S05 | shop / delivery | placement、adjacency、reconfigure、delivery予測 |
| S06 | character | rarity、coin level、evolution、character mastery、party |
| S07 | weapon / build | equipment、weapon mastery、build比較、defeat diagnosis |
| S08 | boss variant | phase、telegraph、break、failure、reward |
| S09 | strong new game | lose / keep / gain、ruby、re-clear予測、confirm |
| S10 | recruit / gacha | character / weapon banner、odds、pity、exchange、history |
| S11 | store / ruby / ads | paid/free display、products、rewarded ads、entitlements |
| S12 | login / inbox | newcomer、monthly、returner、claims、history |

### 16.1 mobile密度

- 320×667、375×667、390×844で確認する。
- 戦闘画面へshop、gacha、storeの詳細を常設しない。
- 5秒で主役、現在階、次の操作、報酬、危険を理解できること。
- gacha・purchase・resetは確認、通信中、成功、失敗、復旧状態を持つ。

---

## 17. 1F〜10F first production slice

1F〜10Fの詳細は`FLOORS_1_10_DESIGN.md`を下位正本とする。ただし、有限100F、非ガチャ、Dawn独立等の競合部分は本書で上書きし、`01`で正式redlineする。

最低scope:

| 分類 | 必須内容 |
|---|---|
| core cats | ムギ、ルナ、トト、コハクを含む4体の無料・確定導線 |
| temporary support | 3role以上 |
| enemies | normal 6、elite 2、district wall 1 |
| boss | 3phase boss 1体 |
| shops | selectable 4種 |
| support | 2種 |
| tower | conquered / current / unseenをbrowse可能 |
| battle | actual movement、contact、multiple enemies、hit sync、stair climb |
| progression | coin level、初回reset、最初のruby進化 |
| gacha | beginner character / weapon surface、初日保証の検証可能状態 |
| save | mid-battle、placement、party、pity、claimsの復旧境界 |

1F〜10Fだけで無制限塔全体の完成を主張しない。

---

## 18. Stable ID方針

- persistence、server、simulation、analyticsでdisplay nameをIDに使わない。
- canonical IDはlowercase ASCII namespaceとslugを使用する。
- aliasはread-only migration inputとする。
- 新しいnamespace候補: `cat`、`weapon`、`enemy`、`elite`、`boss`、`shop`、`support`、`currency`、`ticket`、`rarity`、`banner`、`product`、`entitlement`、`reward`、`event`、`district`、`cycle`、`reset`、`mastery`。
- 旧`dawn.*` IDはmigration aliasとして保持可能だが、新規writeでは単一reset namespaceへ移行する。
- 24character、36weaponの全IDは`01`でregistryを確定する。

---

## 19. Simulationと合否

### 19.1 検証horizon

- 1〜10F初回
- 初回100F milestone
- 1,000F
- 10,000Fまたは数学的に同等なlong horizon
- repeated reset cycles

### 19.2 persona matrix

最低基準:

`3 gameplay builds × 5 personas × 1,000 seeds = 15,000 scenarios以上`

personas:

1. no-ad F2P
2. rewarded-ad F2P
3. monthly pass
4. controlled payer
5. high-spend stress

### 19.3 別枠検証

- gacha probability conformance
- p50 / p90 / p99 first copy
- 100 hard pity
- 200 featured guarantee
- pity carryover
- duplicate distribution
- first copy / useful breakpoint / full mastery
- selector / exchange / universal fragment supply
- refund、revocation、restore
- retry、replay、race、multiple tabs
- ad callback idempotency
- login claim idempotency
- large-number serialization

### 19.4 固定と候補

Step 1で固定する:

- product boundary
- state machine
- authority boundary
- screen responsibilities
- currency / item roles
- prohibitions
- acceptance formula

Step 2・3で決める:

- HP、damage、cost、drop、ruby amount
- exact rates、soft pity、exchange rate
- evolution cost curve
- mastery power curve
- offline amount
- reset reward formula
- build balance
- draw cadenceの最終値

Step 1の文書一致だけで数値balanceをPASSにしない。

---

## 20. 品質、性能、accessibility

最低確認:

- 320×667、375×667、390×844、430×932
- normal motion / reduced motion
- primary input p95 100ms以下目標
- median 55fps以上目標
- p95 frame time 32ms以下目標
- 100ms超stall 0件目標
- 3分boss、10分continuous、100連bulk draw
- maximum rendered floor shellsを制限し、全階をDOMへ常駐させない
- offscreen animation停止
- district asset lazy loading
- safe-area、browser bar、Dynamic Island、home indicator
- purchase、gacha、resetの誤操作防止
- screen reader用label、color-only情報禁止、文字可読性

物理iPhoneでしか確認できない実tap、触覚、発熱、電池、PWA復帰、native billing / ad挙動は、証拠がない限り`NOT_VERIFIED`とする。

---

## 21. 六段階の工程

1. **Step 1 — 正本統合・再封印**
2. **Step 2 — 実行可能contractとsimulation**
3. **Step 3 — 大量検証**
4. **Step 4 — 12画面完成見本**
5. **Step 5 — 1〜10Fと必要backendの実装**
6. **Step 6 — physical iPhone検証**

Step 1の新しいexact commit / tree-bound PASS sealがない限り、Step 2以降へ進まない。

### 21.1 `00`と`01`の境界

`00_統括・工程管理`で行う:

- Project instructions完全置換
- 本書、`PROJECT_STATUS.json`、active change-controlの中核同期
- 旧PASSの権威失効を明示
- 次工程を`01`へ固定

`01_正本仕様・競合調査`で行う:

- repository全体の矛盾inventory
- 下位正本とstatus mirrorの全面redline
- 競合・policy調査
- backend trust boundaryの詳細化
- Step 2 dependency closure
- 独立批評
- 新Step 1 seal

---

## 22. 明示的禁止事項

- 100Fを最終上限として扱う
- 101F以降を禁止する
- 100Fだけのsimulationで無制限塔を合格にする
- Dawnと新resetを併存させる
- 商会会長を主役へ戻す
- characterとweaponを通常同一poolへ混在させる
- 日常大量drawで必須進化rubyを恒常的に枯渇させる
- 初回入手では役割が未完成なcharacter / weaponを販売する
- 20体以上の熟練を通常PvEの前提にする
- N・Rを序盤だけの無価値枠にする
- URを全役割で無条件最強にする
- 限定戦力を永久入手不能にする
- compatible bannerのpaid pityを消す
- 初期製品へ強制広告、banner、PvP、競争報酬、guild competitionを入れる
- 有償通貨、抽選、権利、login、ad rewardをclient authorityにする
- Vercel `READY`だけで品質PASSを出す
- 実機未確認を実機確認済みと表現する
- 競合作品のUI、固有名称、画像、exact確率表をコピーする

---

## 23. 現在の判定と次の許可工程

| 項目 | 判定 |
|---|---|
| Project instructions完全置換 | PASS |
| `MASTER_SPEC.md`現行製品境界同期 | PASS |
| `PROJECT_STATUS.json`現行状態同期 | PASS |
| active change-control現行状態同期 | PASS |
| `00_統括・工程管理`中核権威同期 | PASS |
| repository全下位文書の統合 | IN_PROGRESS / `01`で実施 |
| Step 1最終seal | IN_PROGRESS |
| Step 2以降 | BLOCKED |
| runtime / asset / candidate / schema / backend | 未変更 |
| physical iPhone | NOT_VERIFIED |
| Production | 未変更 |

次に許可されるチャットは **`01_正本仕様・競合調査`** である。
