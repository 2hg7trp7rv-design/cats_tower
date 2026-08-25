# Cat's Tower 1〜10F 完全設計

文書状態: **PASS — STEP1_CANONICAL_FREEZE（数値係数は`SIMULATION_CANDIDATE`）**

更新日: 2026-08-25

作業branch: **`kimi`のみ**。別branchを作成・使用しない。

ユーザー承認済みの実行順:

1. 本書と`MASTER_SPEC.md`の修正版を正本仕様へ固定
2. 全100Fの購入・戦闘・夜明け・24時間放置シミュレーション
3. 戦闘・増援・商業の3ビルドを各1,000パターン検証
4. 9画面完成見本へ反映
5. 1〜10Fだけ実装し、自動test・browser・Vercelの非物理受入まで完了。物理証拠なしにGate Cを`PASS`にしない
6. 同一commit・deploymentを物理iPhoneで180秒boss戦と600秒連続試験。全条件合格時だけGate Cを`PASS`にし、失敗時は工程5へ戻す

11〜20Fはこの6工程に含めない。工程6合格後も自動着手せず、将来ユーザーの別途明示承認を必要とする。

対象地区: 第1地区「灰かぶり入口市場」

上位正本: `MASTER_SPEC.md`

次判定: 本書の製品契約を入力として100Fシミュレーションを行う。`SIMULATION_CANDIDATE`は工程2・3の合格値で置換するまで実装定数にしない。

## 0. この文書の役割

この文書は、最初に商品品質まで作る1F〜10Fについて、各階の目的、敵、猫、施設、解放条件、初回導線、戦闘の読み方、制圧後の生活、失敗時の改善案、音と動き、保存境界を実装可能な粒度で固定する。

本書の役割、状態遷移、公開条件、安定ID、操作契約、画面責務、禁止事項は正本として固定する。一方、HP、攻撃、価格、報酬、時間、放置収益、恒久倍率の初期値は`SIMULATION_CANDIDATE`であり、工程2・3の再現可能な出力なしに最終値と呼ばない。

本書と`MASTER_SPEC.md`が競合した場合は`MASTER_SPEC.md`を優先し、競合を解消するまで実装を止める。V0.8.2のruntime、過去のモック、旧文書は参考資料であり、正本へ逆流させない。

### 0.1 今回固定するもの

- 1F〜10Fの用途と体験順序
- 名前付き猫4匹と公開解放条件
- 一時増援3役割
- 通常敵6種、エリート2種、壁遭遇1件、3段階ボス1体
- 選べるショップ4種、支援施設2種
- 初回チュートリアル、敗北診断、夜明け導線
- 制圧前・制圧中・制圧後の状態遷移
- 制圧後の部屋で何が動き続けるか
- 3系統の武装選択と敗北診断
- タップ、長押し、自動出撃、満員時変換の入力契約
- 放置、店舗、夜明けで自動化してよい境界
- 正本となる9画面と各画面の状態責務

### 0.2 後で決めるもの

- `SIMULATION_CANDIDATE`と記したHP、攻撃力、防御力、DPS、価格、収益の最終値
- ウェーブ数と敵数の微調整
- 恒久祝福の倍率
- 1周の最終所要時間と放置収益
- 各ビルドの最終均衡

候補値はデータ定義へ一元化し、UI文言、CSS、animation、個別floorロジックへ埋め込まない。工程2・3の出力にはseed、入力build、購入履歴、夜明け履歴、放置時間、クリア時間、失敗理由を残す。

## 1. 設計判断の根拠

### 1.1 比較から採用する範囲

2026-08-25に再確認した外部資料とユーザー提供動画は`quality-reviews/step-1-canonical-design/research-evidence.md`へ根拠と限界を分離した。GameAnalyticsの短session・初期価値benchmarks、Kongregateの指数成長・bulk buy・prestige anti-farm、Tap Titans 2の新最高stageに連動する周回価値、Idle Minerの早期自動化を設計仮説へ使う。ただし、他作品の係数、継続率、収益性はCat's Towerの証明ではない。

Cat's Towerで採用するのは次の抽象的な設計原則である。

1. 主操作の結果を即座に見せる。
2. 戦闘、雇用、商売を同じ進行へ結びつける。
3. 次の目標階を常に見せる。
4. 強化の結果を戦闘画面で読めるようにする。
5. 難しい説明より先に一回成功させる。
6. 基本進行は早く自動化し、能動操作は任意の最適化にする。
7. 周回報酬は新しい最高到達と結び、同地点reset farmを作らない。
8. bulk/recommended purchaseで大量level連打をなくす。

複製しないもの:

- 画面レイアウト、画像、キャラクター、名称、文章、音
- 固有の数値、出現順、演出時間、課金構成
- ソースコード、データ、UI部品
- スクリーンショットのトレースや色替え
- 強制広告、ガチャ依存、店舗の再開・個別回収、説明されない倍率、一撃死前提、同じ操作の大量反復

Cat's Towerは、制圧階の生活、階をまたぐ配送、公開条件での猫救出、100F連続閲覧を独自の中心体験にする。

### 1.2 モバイル操作の根拠

- Appleのゲームコントロール指針に従い、押下中も指の外側から見える発光・沈み込みを出し、音を同期する。
- 主要操作は48×48 CSS px以上、呼び鈴などの中核操作は56×56 CSS px以上を設計基準とする。WCAG 2.2 AAの24×24 CSS pxは例外的な最低線であり、中核操作へ適用しない。
- 塔閲覧面は`touch-action: pan-y`を前提とし、縦スクロールと呼び鈴操作を別領域にする。
- 100Fを全描画せず、表示中と前後だけを描画する。画面外の生活アニメーションは停止する。
- 触覚は対応環境だけの補助であり、視覚と音なしでは成立しない情報に使わない。

### 1.3 参考資料

- 2026 Mobile & PC Gaming Benchmarks: <https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks>
- The Math of Idle Games Part I: <https://www.kongregate.com/en/pages/the-math-of-idle-games-part-i>
- The Math of Idle Games Part III: <https://www.kongregate.com/en/pages/the-math-of-idle-games-part-iii>
- Tap Titans 2 official prestige help: <https://gamehive.helpshift.com/hc/en/3-tap-titans-2/faq/75-should-i-prestige-when/>
- Idle Miner Tycoon official product page: <https://idleminertycoon.com/>
- 商人サーガ App Store: <https://apps.apple.com/jp/app/id1198096385>
- 商人サーガ Google Play: <https://play.google.com/store/apps/details?id=com.cyberxgames.akindosaga>
- Apple Game controls: <https://developer.apple.com/design/human-interface-guidelines/game-controls>
- Apple Playing haptics: <https://developer.apple.com/design/human-interface-guidelines/playing-haptics>
- W3C Target Size Minimum: <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum>
- W3C Target Size Enhanced: <https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced>
- MDN touch-action: <https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action>
- web.dev Virtualize large lists: <https://web.dev/articles/virtualize-long-lists-react-window>
- web.dev Optimize INP: <https://web.dev/articles/optimize-inp>

## 2. 第1地区の物語と到達目標

### 2.1 地区の状況

塔の入口市場は黒羽軍に封鎖され、店主と配達猫は散り散りになっている。ムギは壊れた呼び鈴を見つけ、プレイヤーと一緒に市場を一階ずつ再開する。店が開くたびに看板、灯り、客、配送箱が増え、灰色の塔が暖色の生活空間へ変わる。

### 2.2 10F到達時にプレイヤーが理解していること

1. 呼び鈴は敵への直接攻撃ではなく、猫を入口から呼ぶ操作である。
2. 猫は走り、接敵してから攻撃する。
3. 店舗はどれを置くか選べ、戦闘の弱点を補える。
4. 制圧済み階を見返すと、猫と配送が働いている。
5. 猫の解放条件は公開され、行動すれば確実に達成できる。
6. 敗北画面は原因と次に触る場所を示す。
7. 8Fの壁を越えるには、単純な火力以外の対策も必要である。
8. 9Fの遺物で周回中の方針を選べる。
9. 10F後も塔は100Fまで続く。
10. 夜明けを使えば一部を保持して再挑戦できる。

## 3. 1〜10Fの全体表

| 階 | 制圧前の役割 | 主な相手 | 新しく教えること | 制圧後 | 固定報酬 |
|---:|---|---|---|---|---|
| 1F | 入口・補給 | 灰ネズミ | 呼び鈴、走行、接敵、命中 | 灰鈴補給所 | ムギ、基礎補給 |
| 2F | 商業階A | 灰ネズミ＋すすイタチ | 店舗を比較して選ぶ | 選択ショップ | ルナ条件の表示 |
| 3F | 支援階A | 袋モグラ | 盾と配送到着 | 物資昇降機 | 配送路、ルナ |
| 4F | 商業階B | くず鉄カラス＋灰ネズミ | 遠距離・対空の読み | 選択ショップ | 第2店舗枠 |
| 5F | 猫救出 | 煙コウモリ＋すすイタチ | 救出、編成、役割相性 | トトの猫部屋 | トト |
| 6F | 商業階C・複数波 | 通常敵の2ウェーブ | 次の波、回復持越し | 選択ショップ | 第3店舗枠 |
| 7F | 支援階B・依頼 | 火花ヤモリ＋袋モグラ | 公開実績、条件追跡 | 依頼掲示板 | コハク条件開始 |
| 8F | 商業階D・地区の壁 | 黒羽封鎖隊 | 敵役割の組合せ、夜明け予告 | 選択ショップ | 第4店舗枠 |
| 9F | エリート・遺物 | 帳場フクロウまたは黒羽番兵 | 優先標的、遺物3択 | 市場記念室 | 周回遺物1個、コハク判定 |
| 10F | 地区ボス | 黒羽代官カゲツバサ | 3形態、構成変更、地区制覇 | 灰鈴大広間 | 地区章、配置無料期間 |

敵編成の最終数、HP、報酬量は`SIMULATION_CANDIDATE`である。表の「新しく教えること」と制圧後用途は固定する。

### 3.1 役割密度と目標時間

1〜7Fは一つずつ因果を教える早期学習、8Fは構成を見直す最初の壁、9Fはボス前のエリート判断、10Fは3形態の地区ボスとする。HPだけを増やした同型戦闘で時間を埋めない。

`SIMULATION_CANDIDATE`の初回frontier p50目標:

| 対象 | 戦闘時間 | 失敗条件 |
|---|---:|---|
| 1〜7F通常 | 20〜35秒 | 最適でない一案でも90秒以内に勝敗または改善診断へ到達しない |
| 8F壁 | 45〜60秒 | 帳簿係、補充、門の因果が読めないままHPだけを削る |
| 9Fエリート | 40〜55秒 | 入階前に敵役割と推奨対策を確認できない |
| 10Fボス | 50〜75秒 | 初見即死、形態を読む前の撃破、90秒超の無変化 |
| 1〜10F初回foreground合計 | 6〜8分 | p90が10分を超える、または強制待機、広告、同じlevel操作の連打で時間を作る |

これらは工程2・3で分布を検証する目標であり、1〜10F総所要はp50 `6〜8分`、p90 `10分以内`とする。各floorの`combatSeconds`、階段・結果の`transitionSeconds`、店・編成・物語の`firstTimeDecisionSeconds`を重複なく分離し、その合計を初回foreground所要として出す。中央値だけを合わせて裾の失敗を隠さない。

時間計測は非永続の`scenarioResultClock`、永続する`gameplayClock`、`touchClock`、runtimeの`hostWallClock`を分ける。Step 2/3のforegroundとwallの合否・停止上限は0起点で実際に消費した`scenario.resultForegroundElapsedMs`と`scenario.resultWallElapsedMs`だけを使い、最終transactionが棄却されても巻き戻さない。`system.foregroundClockMs`と`system.monotonicClockMs`はevent・入力phase・保存用で、draft成功時だけ公開する。初回総所要はcombat・transition・simulationを止める必須初回判断へ分割する。touchは受理したpointer downからup/cancelまでと受理input件数だけを数え、scrollへ取消した長押しや背景中の合成eventを含めない。runtimeのhost wallは端末sleep・backgroundを含む放置精算用で、端末時計巻戻しで増やさない。foreground/backgroundの復帰列と診断clone固有の0起点horizonはmanifestの`returnSchedules`と`clockModel`から読む。

### 3.2 初期成長式

工程2・3が読む唯一の候補入力は、現存する版付きmanifest [`simulation/candidate-v1.json`](./simulation/candidate-v1.json) とする。工程2開始前にparse、schema、状態を検証して凍結し、不存在、parse失敗、未凍結、schema不一致ならシミュレーションを開始しない。本書へ係数や基礎値を複製せず、結果へ`candidateId`と入力file hashを残す。

manifestは少なくとも`schemaVersion`、`candidateId`、`status`、`createdAt`、`clockModel`、`returnSchedules`、`personas`、`seedPolicy`、`rounding`、`formulaRules`、`initialState`、`stopPolicy`、`curves`、`floorRoleModifiers`、`floorOverrides`、`districtProgression`、`catBaselines`、`helperBaselines`、`enemyModel`、`combatRules`、`shopModel`、`supportModel`、`relicModel`、`effectComposition`、`weapons`、`survival`、`timingTargets`、`dawn`、`offline`、`builds`、`decisionPolicies`、`driftMeasurement`、`acceptance`をtop-level fieldとして持つ。

敵攻撃階倍率`1.105〜1.115`は探索priorであって採用帯ではない。推奨帯の前衛が通常攻撃6〜10回、後衛が3〜5回、予告付きboss強攻撃が前衛最大HP35〜55%となる生存結果を優先し、全HPからの一撃KOが出ればprior内でも不採用とする。

```text
D10_pre(F) = enemyEhp(F + 10) / enemyEhp(F)
             / districtPurchasePower(F → F + 10)
Net10(F)    = enemyEhp(F + 10) / enemyEhp(F)
             / totalPowerIncludingDistrictPersistentAndUnlocks(F → F + 10)
```

同じ相対floorどうしを比較し、`D10_pre`は同一runの地区内coin購入だけを分母へ含め、目標`1.35〜1.55`、絶対上限`1.60`とする。`Net10`は地区内の恒久取得と公開解放を含め、目標`0.95〜1.10`とする。X8と次地区X1のような用途違いを混ぜない。

猫価格fieldは`nextCost(catId, L)`、すなわち現在level `L`から`L + 1`への1回分価格とする。10level節目は到達後levelが10の倍数になった時だけ能力へ適用し、価格indexへ二重適用しない。丸め順はmanifestの`rounding`を唯一の正本とする。

### 3.3 1〜10F用の候補基礎値

ムギ、ルナ、トト、コハクの基礎attack、HP、攻撃間隔、射程、移動、回復、`nextCost`は`candidate-v1.json.catBaselines`だけに置く。表示DPSと内部DPSを一致させ、攻撃間隔、移動、射程外時間、盾、回復を含む実効DPSを別列で出す。`攻撃力`だけで優劣を説明しない。

## 4. 名前付き猫4匹

### 4.1 ムギ `cat.mugi`

- 役割: 前衛・足止め
- 初期状態: 1F開始時から編成済み
- 見た目の読み: 小さな木盾、低い重心、短い突進
- 通常行動: 最も近い地上敵へ走り、接触後に短い爪攻撃
- 固有行動: 一定間隔で盾を構え、次の強攻撃を軽減
- 苦手: 飛行、後列支援、包囲
- 生活行動: 補給箱を運ぶ、看板を直す
- 教えること: 接敵前に攻撃しない、前衛が戦線を止める

### 4.2 ルナ `cat.luna`

- 役割: 遠距離・対空
- 公開条件: 2Fを制圧し、3Fの物資昇降機へ補給箱を3回到着させる
- 条件表示開始: 2F制圧直後
- 条件進捗: `補給箱 0/3`を猫名簿と3Fカードに同時表示
- 解放演出: 3個目の箱からルナが飛び出し、4Fのカラスを一度だけ撃ち落とす
- 通常行動: 射程内の飛行敵を優先し、弾着時にダメージ
- 固有行動: 同じ標的へ連続命中すると照準が安定
- 苦手: 近距離での集中攻撃、重い盾
- 生活行動: 高所の看板を整える、配送を見張る
- 教えること: 条件達成型の確実な解放、飛行対策

### 4.3 トト `cat.toto`

- 役割: 支援・回復
- 公開条件: 5Fの救出戦を制圧する
- 救出中の表示: 檻の耐久値ではなく、残る敵とトトの安全状態を示す
- 通常行動: 最もHP割合が低い味方へ回復包帯を投げる
- 固有行動: ウェーブ間に一度、味方全体へ小回復
- 苦手: 単独戦闘、敵の突進
- 生活行動: 診療所で薬を調合、休む猫へ毛布を掛ける
- 教えること: 複数ウェーブでは回復と継戦が重要

### 4.4 コハク `cat.kohaku`

- 役割: 走者・後列妨害
- 条件表示開始: 7Fの依頼掲示板を開いた時
- 公開条件は次の3つをすべて満たす。
  1. 異なる種類のショップを2種類以上配置する。
  2. 物資昇降機から前線へ補給箱を合計5回到着させる。
  3. 8Fの黒羽封鎖隊で「帳簿係」を最初に倒して制圧する。
- 失敗しても条件を隠さず、8F再戦時に`帳簿係を先に倒す`と表示する
- 解放判定: 8F制圧後。条件不足なら達成済み項目を保持し、再戦可能
- 加入演出: 封鎖門の裏から飛び出し、配送路を開通する
- 通常行動: 前衛をすり抜け、最も危険度の高い後列敵へ走る
- 固有行動: 後列の詠唱・配送妨害を短時間止める
- 苦手: 密集した地上前衛、長時間の殴り合い
- 生活行動: 店と昇降機の間を走り、伝票を届ける
- 教えること: 公開条件、優先標的、店舗と戦闘の結合

条件は乱数、広告、課金、時刻限定にしない。解放前も名前、姿、役割、未達項目を表示する。

### 4.5 塔共通武装3系統

武装は猫ごとの装備inventoryではなく、塔全体へ一つだけ装着する公開選択とする。drop、ランダム能力、重複合成、ガチャ、装備枠整理は作らない。目的は「敵を見て乗り換える判断」であり、所持品管理ではない。

| 安定ID | 系統 | 有利 | 不利 | 1〜10Fで読む相手 |
|---|---|---|---|---|
| `armament.breaker` | 破砕爪 | 盾、門、重装 | 飛行、俊足 | 袋モグラ、封鎖門、黒羽番兵 |
| `armament.hunter` | 狩猟鈴 | 飛行、後列 | 重装 | カラス、コウモリ、帳場フクロウ、ボス第2形態 |
| `armament.guardian` | 守護帯 | 被害軽減、回復効率 | 短期火力 | 複数wave、ボス第1・第3形態 |

- 3F復旧後に3系統の基礎版を同時解放する。優劣を隠して一つを恒久選択させない。
- 装着変更はfloor入場前、制圧直後、敗北診断から行える。live戦闘中の無制限切替は不可。
- 選択前に、直前構成と候補構成の予測TTK、盾への有効度、生存余裕を同じ単位で表示する。
- 相性倍率とfavorable、neutral、resistantのboss p50 TTK帯は`candidate-v1.json.weapons`だけに置き、同じ推奨構成・敵・seedで比較する。敵ごとの例外倍率を増やさない。
- 地区ボス初回撃破で上位tierの設計図を確定解放する。設計図はunlock flagであり通貨ではない。
- 新tierの装着直後の実効改善値はmanifest候補とし、予測値と実測値を同じ式で出す。
- 保存はprofileへ解放tier・習熟、runへ装着系統を持つ。3系統を同時乗算しない。

守護帯は隠れattack倍率を持たない。`guardianRawDamageBudget = (baseMaxHp + healingDuringFight × healingMultiplier) / incomingDamageMultiplier`、`survivalMargin = guardianRawDamageBudget - predictedRawIncomingDamage`で生存差を表示し、2倍率はmanifestから読む。

単一系統の選択shareが`weapons.rejection.maximumSingleFamilySelectionShare`超、100Fまでの乗換え回数中央値がmanifest下限未満または上限超、一系統が全遭遇で最速、通常推薦の予測TTK改善が`minimumPredictedTtkImprovementForRoutineSwitch`未満、複合脅威でTTKと生存のtrade-off消失、耐性だけを理由に90秒超・停止・推奨帯一撃KO、予測と実測の生存可否逆転、のいずれかなら武装候補を不合格にする。

## 5. 一時増援3役割

呼び鈴で出る一時増援は名前付き猫とは別枠で、同じシルエットの数値違いにしない。

| ID | 役割 | 見た目 | 優先行動 | 満員時の変換 |
|---|---|---|---|---|
| `helper.guard` | 前衛 | 丸盾・低姿勢 | 地上前衛を止める | 次の前衛へ小盾付与 |
| `helper.slinger` | 遠距離 | 投石器・高い構え | 飛行、後列 | 次の弾を予約 |
| `helper.runner` | 走者 | 配送鞄・前傾 | 妨害役へ接近 | 配送速度の一時号令 |

- 1Fの最初の短押しを完了した直後から、基本の自動出撃を開始する。自動化の解禁を5Fや夜明けまで待たせない。
- 短押し1回で自動出撃とは別の追加要求1件を受付し、敵への直接ダメージは発生させない。
- 自動出撃間隔0.9〜1.2秒は`SIMULATION_CANDIDATE`とする。400〜450msの長押し判定と150〜200msのrepeat間隔は入力契約として固定し、balance結果で変更しない。
- 指を離す、scroll判定距離を越える、visibilityを失う、modalへ入る、戦闘が停止する、のいずれかで長押しを必ず終了する。
- 出撃不能時は要求を捨てず、表の号令へ変換する。
- 満員時に既存猫を削除・置換しない。予約列が満杯なら次の攻撃、盾、配送の公開号令へ変換する。
- どの役割が出るかは現在編成と選択店舗で重みが変わるが、結果は出撃前アイコンで見せる。
- ランダム結果を攻略の唯一条件にしない。
- 3分平均の能動操作効果は放置時の`×1.25〜1.40`、瞬間burstは`×2〜3`を候補域とする。30秒以上の連続保持を攻略条件にしない。
- `+10`購入は初回60〜90秒内、`節目まで`は5F、`MAX・おすすめ購入`は初回夜明け、20F以降の自動配分は将来解禁とする。夜明け後も最後の購入方式を保持する。

## 6. 通常敵6種

### 6.1 灰ネズミ `enemy.ash_mouse`

- 役割: 基礎近接
- 予告: 身を縮め、尻尾を一度振ってから噛む
- 対策: ムギまたはガードで止める
- 初出: 1F
- 学習目的: 走行→接敵→攻撃→反動の基本因果

### 6.2 すすイタチ `enemy.soot_weasel`

- 役割: 俊足・すり抜け
- 予告: 低姿勢になり、白い速度線を出す
- 行動: 前衛の横を抜けて後列へ向かう
- 対策: 走者、再標的、早めの増援
- 初出: 2F

### 6.3 袋モグラ `enemy.sack_mole`

- 役割: 盾・前衛保護
- 予告: 袋盾を正面へ立て、足を止める
- 行動: 正面からの連続攻撃を軽減
- 対策: 後列妨害、爪工房の破砕、複数方向
- 初出: 3F

### 6.4 くず鉄カラス `enemy.scrap_crow`

- 役割: 飛行・遠距離
- 予告: 高度を上げ、光る金属片を構える
- 行動: 前衛を越えて後列を狙う
- 対策: ルナ、スリンガー
- 初出: 4F

### 6.5 煙コウモリ `enemy.smoke_bat`

- 役割: 飛行・命中妨害
- 予告: 羽を閉じ、煙輪を作る
- 行動: 短時間だけ味方の照準を乱す
- 対策: 早い対空、魚食堂の速度支援
- 初出: 5F

### 6.6 火花ヤモリ `enemy.spark_gecko`

- 役割: 後列支援・強化
- 予告: 背中の火花が3回点滅
- 行動: 最も近い敵1体の次の強攻撃を強化
- 対策: コハク、遠距離優先、強化前の集中攻撃
- 初出: 7F

## 7. エリート2種と壁遭遇

### 7.1 帳場フクロウ `elite.ledger_owl`

- 役割: 指揮・増援召集
- 予告: 帳簿を開き、ページを3枚めくる
- 行動: 通常敵の再出現を予約し、店舗支援の到着表示を一時遅らせる
- 対策: 後列優先、コハク、爪工房の短期火力
- 初出候補: 8Fの帳簿係、9F単体エリート

### 7.2 黒羽番兵 `elite.blackwing_guard`

- 役割: 重装・範囲押し戻し
- 予告: 大盾を床へ打ち、赤い扇形を表示
- 行動: 前線を押し戻し、入口へ近づく
- 対策: ガード、回復、破砕、予告中の号令
- 初出: 8F、9F分岐

### 7.3 8F「黒羽封鎖隊」`encounter.d01.wall`

壁遭遇は追加敵種ではない。袋モグラ、帳場フクロウ、黒羽番兵と環境オブジェクト「封鎖門」を組み合わせる。

固定進行:

1. 封鎖門の前に袋モグラ、後ろに帳簿係を置く。
2. 帳簿係が一定間隔で補充を予約する。
3. 帳簿係を先に倒すと門の補充が止まり、コハク条件を達成する。
4. 前衛だけを殴ると長期化し、火力不足ではなく「後列への到達不足」と診断する。
5. 一度敗北したら夜明けの説明を解禁するが、夜明けを強制しない。
6. 店舗変更、猫編成変更、過去階閲覧、再挑戦を同じ敗北画面から選べる。

封鎖門は敵HPを隠す壁ではなく、補充状態、残り部隊、帳簿係の詠唱を常時表示する。

## 8. 10F地区ボス

ボス名: **黒羽代官カゲツバサ** `boss.d01.kagetsubasa`

100F最終ボス「クロバネ」とは別個体である。10Fで黒羽軍そのものを倒したように見せない。

### 8.1 第1形態「徴収」

- 地上で大鎌を使い、最前列を狙う。
- 強攻撃前に帳簿印と床の赤線を表示する。
- 店舗支援箱を一つ没収しようとする。
- 対策: 前衛維持、配送到着の前に号令、予告回避ではなく軽減準備。
- 形態終了: HP境界到達後、即座に次へ飛ばず、着地会話とカメラ保持を入れる。

### 8.2 第2形態「黒羽旋回」

- 飛行し、地上前衛の射程外へ移る。
- くず鉄カラスを呼び、後列へ金属片を落とす。
- 対空役がいない場合も詰みではなく、短時間の着地窓を作る。
- 対策: ルナ、スリンガー、魚食堂の行動支援。
- 診断候補: 対空不足、後列保護不足。

### 8.3 第3形態「封鎖命令」

- 地上へ戻り、黒羽番兵の盾行動と火花強化を組み合わせる。
- 一定間隔で入口を封じ、増援列を停止しようとする。
- コハクがいれば詠唱停止、いなくても帳簿係優先で解除できる。
- 最後の一撃前に短い静止、命中、反動、KO、勝利保持を順に見せる。
- 診断候補: 後列到達不足、増援回転不足、回復不足。

### 8.4 ボス初回保証

- 各形態の代表行動を最低1回見せるまで次形態へ進めない。
- 初見即死を禁止し、最初の強攻撃はチュートリアル用の猶予を持つ。
- リトライでは説明を短縮できる。
- 勝利時はカゲツバサが上階へ退却し、100Fまで続く黒羽軍の存在を示す。

### 8.5 予告・HP・報酬の同期契約

- HP barは3形態を区切り線と名称で常時示し、現在形態を色だけで伝えない。
- 強攻撃は400〜800ms前から床形状、敵姿勢、役割icon、短い動詞を併用して予告する。
- 攻撃判定は武器・爪・投射物が接触したframeに発生し、被弾flash、HP変化、damage数値、音、反動を±50ms以内へ揃える。
- 数値はbitmapの拡大画像にせず、device scaleで描画するtextまたはvector glyphとする。撃破数、形態名、現在HP、最大HPを別レイヤーの重なりで潰さない。
- 各形態終了は`攻撃命中 → HP 0/境界 → hit stop → 行動停止 → 次形態演出`の順とし、撃破報酬は最終KO確認後だけ付与する。
- 中断・復帰、background復帰、二重tapで形態報酬や地区章を重複付与しない。
- 3分ボス試験では最大同時猫、damage数値、配送、形態演出を有効にし、入力p95、frame time、同期ずれ、重複報酬を記録する。

### 8.6 推奨帯と一撃KO

推奨帯は`candidate-v1.json.survival.recommendedBandDefinition`に従い、検査対象floorで同じpersona、build、購入policyが通常報酬だけから到達できるlevel・編成集合とする。debug grant、結果を見た追加coin、別personaの購入履歴を混ぜない。

- 一撃KOは、全HPから一つの原子的damage eventだけでHP 0以下になることとする。表示だけ分割した同一hitを複数hitに数えない。
- 推奨帯の前衛は同格通常攻撃6〜10回、後衛は3〜5回をp50の生存目標とする。
- 予告付きboss強攻撃は推奨帯前衛の最大HP35〜55%を目標とする。
- 推奨帯では通常、飛び道具、boss強攻撃の全HPからの一撃KOを0件にする。推奨帯外も急な境界を記録し、「強化不足」だけで説明を終えない。

## 9. ショップ4種

商業階2F、4F、6F、8Fでは、制圧直後に店舗候補を比較して一つ配置する。同じ店舗の重複は許すが効果は逓減し、未配置の種類を選ぶ理由を残す。

### 9.1 人材受付所 `shop.staff-reception`

- 戦闘効果: 増援枠、予約列、役割候補を改善
- 見える配送: 募集札を持つ猫が前線入口へ走る
- 向く敗因: 前線維持不足、増援回転不足
- 生活: 面接、名札渡し、掲示物更新

### 9.2 魚食堂 `shop.fish-diner`

- 戦闘効果: 一定間隔で回復または短い行動速度支援
- 見える配送: 湯気の立つ魚皿を運ぶ
- 向く敗因: 回復不足、長期戦、飛行敵への手数不足
- 生活: 調理、配膳、食事、皿洗い

### 9.3 爪工房 `shop.claw-forge`

- 戦闘効果: 近接命中と盾破砕を支援
- 見える配送: 爪カバー入りの小箱を運ぶ
- 向く敗因: 盾突破不足、ボス第3形態
- 生活: 研磨、火花、試し振り

### 9.4 ねこ診療所 `shop.cat-clinic`

- 戦闘効果: 出撃猫の回復、負傷復帰を支援
- 見える配送: 包帯箱をトトまたは配達猫が運ぶ
- 向く敗因: 回復不足、複数ウェーブ
- 生活: 診察、薬棚整理、昼寝中の見守り

### 9.5 選択画面の必須比較

各候補カードに次を同じ順で表示する。

1. 店名と役割アイコン
2. 「何が強くなるか」一文
3. 現在の敗因に合う場合の`おすすめ`表示
4. 配送物の絵
5. 現配置との重複・隣接効果
6. 配置後に起きる戦闘画面の変化
7. `ここに置く`ボタン

「おすすめ」は選択を強制しない。閉じても階は制圧済みのまま、空き店舗として後から選べる。

### 9.6 再配置

- 店舗カードから詳細を開き、別店舗へ変更できる。地区ボスを今周まだ倒していない間は、対象配置階の報酬基準値×0.5を四捨五入したコインを支払う。
- 変更すると対象店舗の今周レベルは0へ戻る。確定前に失う今周レベル、維持する配置階の設計図枠、変更後効果を表示する。
- 10Fボス撃破後は夜明けまで、1〜10F内の再配置費用を無料とする。夜明け後は10Fを今周再制圧するまで有料へ戻る。
- 夜明け後は配置図を保持し、未制圧階では半透明の予定店舗として表示する。

### 9.7 正規ID registryと移行alias

正規shop IDは次の10件だけとする。1〜10Fの選択肢は太字の4件で、残り6件は後続地区向けに予約する。

1. **`shop.staff-reception`**
2. **`shop.fish-diner`**
3. **`shop.claw-forge`**
4. `shop.toy-workshop`
5. **`shop.cat-clinic`**
6. `shop.delivery-warehouse`
7. `shop.observatory`
8. `shop.lantern-store`
9. `shop.nap-inn`
10. `shop.curio-gallery`

正規support IDは`support.training-ground`、`support.rest-nest`、`support.supply-lift`、`support.request-board`の4件だけとし、第1地区は後二つを使う。

全namespaceの機械可読な権威registryは`PROJECT_STATUS.json.stableIdRegistry`だけとする。そこには12猫、10boss、10地区、10shop、4support、3遺物系統、3武装、3Dawn branch、33Dawn reward IDを登録する。本文やmanifestの一覧はその参照・効果定義であり、新しい正規IDを別表だけへ追加しない。11F以降の中立猫・boss IDは100F数値simulation用で、表示名・素材・runtime制作を許可するものではない。

schema2・旧mock・旧文書から読む時だけ次のaliasを許可する。保存・event・telemetry・UIの出力は必ず右側の正規IDへ書き換え、aliasと正規IDを同時保存しない。

| 読取専用alias | 正規ID |
|---|---|
| `shop.guild`, `shop.staff_reception` | `shop.staff-reception` |
| `shop.fish_diner` | `shop.fish-diner` |
| `shop.claw_forge` | `shop.claw-forge` |
| `shop.toy_workshop` | `shop.toy-workshop` |
| `shop.clinic`, `shop.cat_clinic` | `shop.cat-clinic` |
| `shop.delivery_warehouse` | `shop.delivery-warehouse` |
| `shop.lantern_store` | `shop.lantern-store` |
| `shop.nap_inn` | `shop.nap-inn` |
| `shop.curio_gallery` | `shop.curio-gallery` |
| `support.training_ground` | `support.training-ground` |
| `support.rest_nest` | `support.rest-nest` |
| `support.freight_lift`, `support.supply_lift` | `support.supply-lift` |
| `support.request_board` | `support.request-board` |

### 9.8 通貨、店舗収益、24時間放置の境界

- spend可能な通貨は今周coinと恒久Dawn shardの2種だけとする。設計図、地区章、実績はunlock flagであり通貨にしない。
- 店舗は一度配置すれば常時稼働し、再開tap、個別回収、広告視聴を要求しない。
- 放置基準価格`U`は`candidate-v1.json.offline.uIndex`に固定した`fixedCombatReference`、`fixedReinforcementReference`、`fixedCommerceReference`を、`highestReachedFloor`と、新規reward IDを伴った`rewardingDawnCount`で決定論的に投影した3値の中央値とする。変動するplayer state入力はこの2つだけで、現在coin、装着build・武装、開いているmenu、推薦表示、購入可否、logout直前操作、報酬0の回復Dawn回数を使わない。
- `U`はfloor roleを除いた報酬曲線でclampし、正当な進行で低下させない。clamp前後、3つの固定reference keyと値、`highestReachedFloor`、`rewardingDawnCount`、policy versionをsnapshotする。放置式とbuild係数は`candidate-v1.json.offline`だけから読み、上限24時間は固定する。
- 目標は8時間復帰で標準1〜2回、24時間で標準4〜5回、商業5〜6回の意味ある購入である。24時間放置だけで2地区以上を無操作skipできたら不合格。
- 初周の放置はcoinと既知店舗の支援準備だけを進める。未見floor制圧、boss撃破、猫解放、店舗選択、遺物選択、Dawn実行を自動化しない。
- Dawn後だけ、既知floorの再制圧を圧縮してよい。clear可能な最終階は`min(floor(前回最高階×0.90), 次の未解決X9-1, 次の未選択分岐-1, 次の未見boss-1)`とし、存在しないblockerは`null`として除外する。blocker階そのものを越えず、到達結果と停止理由を復帰画面に示す。
- snapshotは購入、level、floor、Dawn、解放など経済commitごとと、`visibilitychange` hidden、`pagehide`で保存する。復帰時は最後に正常commitしたsnapshotだけを使う。進行なしの同一saveへ24時間復帰を反復し、`U`と1回分報酬が増えず、二重精算0件であることを検査する。

## 10. 支援施設2種

### 10.1 3F 物資昇降機 `support.supply-lift`

- 役割: 制圧階の店舗から現在戦闘階へ配送を集約する
- 表示: 待機箱、昇降中、前線移送、到着の4状態
- 初回: 補給箱3回でルナを解放
- 閲覧中: 箱が3Fを出て上へ移る様子を見られる
- 戦闘HUD: 次の到着物、出発階、到着までの進行を表示
- 禁止: タイマーだけが減り、箱が瞬間移動する表現

### 10.2 7F 依頼掲示板 `support.request-board`

- 役割: 猫解放、地区実績、次の狙いを公開する
- 初回依頼: コハクの3条件
- 表示: 達成済み、進行中、次に操作する画面
- 完了時: 報酬を自動で隠さず、受取演出後に記録へ残す
- 禁止: 条件未公開、ランダム日替わり、広告による条件短縮

## 11. 各階の完全進行

### 11.1 1F「灰鈴の入口」

開始状態:

- 画面中央にムギ、右側に灰ネズミ1体、下部に壊れた呼び鈴。
- 操作可能になるまで敵は攻撃しない。
- 文章は`呼び鈴を押して、助っ人を呼ぼう`の一文だけ。

成功順序:

1. 押下開始で鈴が沈み、外周が光る。
2. 100ms以内に鈴音と入口の砂煙を返す。
3. ガード増援が入口から走る。
4. 敵と接触して停止する。
5. 予備動作、命中、HP、音、反動を同期する。
6. 敵撃破後にコインが猫側へ飛ぶ。
7. 制圧札を掲げ、猫が階段を上がる。

制圧後は補給箱、直した呼び鈴、案内矢印が残る。再訪時にムギが鈴を磨く。

### 11.2 2F「空き店舗」

- すすイタチが後列へ抜けるため、増援を早めに呼ぶ意味を教える。
- 制圧後に人材受付所と魚食堂を最初の候補として提示する。
- どちらを選んでも3Fを突破できる。
- ルナの姿と条件`補給箱を3回届ける`を公開する。
- 店舗決定後、看板設置→店員入場→最初の商品準備を見せる。

### 11.3 3F「止まった昇降機」

- 袋モグラの盾で正面連打だけでは遅いことを見せる。
- 制圧後、ムギが歯車を回し物資昇降機を復旧する。
- 復旧箱から塔共通武装3系統を同時解放し、対盾の`armament.breaker`を一度だけ試着案内する。
- 2F店舗から3回配送し、到着ごとに進捗を更新する。
- 3回目でルナを解放し、その場で編成案内を一度だけ表示する。

### 11.4 4F「空の番台」

- くず鉄カラスを初登場させ、ルナまたはスリンガーの対空を成功させる。
- ルナ未解放でもスリンガーで突破可能。
- 入階前比較で`armament.hunter`の予測TTK改善を示すが、変更を強制しない。
- 制圧後、4ショップすべてを候補へ解禁する。
- 敗因履歴があれば対応店舗をおすすめする。

### 11.5 5F「閉じ込められた診療猫」

- トトを背後に置き、煙コウモリとすすイタチから守る。
- 敵の攻撃がトトへ直接当たる理不尽な護衛HP方式にはしない。
- 戦線がトト位置まで後退した時だけ危険表示を出す。
- 制圧後にトト加入、猫部屋、休息動作を解禁する。
- トトを編成すると6Fの複数ウェーブが明確に楽になる。

### 11.6 6F「二度鳴る鐘」

- ウェーブ1撃破後に次の敵影と到着時間を表示する。
- 味方HP、増援列、店舗支援はウェーブ間で持ち越す。
- トトのウェーブ間回復を一度見せる。
- 制圧後に第3店舗枠を選ぶ。

### 11.7 7F「煤けた掲示板」

- 火花ヤモリが袋モグラを強化し、後列優先の意味を教える。
- 制圧後、依頼掲示板を復旧しコハクの全条件を公開する。
- 条件カードから店舗、3F配送、8F戦闘へ直接移動できる。
- 未達でも次の階へ進める。

### 11.8 8F「黒羽封鎖門」

- 初回入階時に門、帳簿係、補充の関係を短いカメラ移動で示す。
- 戦闘HUDへ`帳簿係が補充を手配中`を表示する。
- 勝利後、第4店舗を選び、コハク条件を判定する。
- 敗北後は後列到達不足を第一候補として診断する。
- 初回敗北または一定時間停滞で夜明け説明を解禁する。
- 敗北診断は装着武装が原因候補なら`armament.breaker`との予測差を表示し、単に「攻撃力不足」と書かない。

### 11.9 9F「市場の記録係」

- プレイヤーの直近構成に応じて帳場フクロウまたは黒羽番兵を主敵にする。
- これは完全ランダムにせず、入階前に相手と推奨対策を表示する。
- 制圧後、周回中だけ有効な遺物を3択から一つ選ぶ。
- 遺物候補は戦闘、増援、商業を1つずつ提示する。
- コハク未解放なら達成済み条件と再挑戦導線を残す。

`SIMULATION_CANDIDATE`の遺物名:

- `煤払いの爪`: 盾への対処を強める
- `共鳴する呼び鈴`: 増援列を強める
- `温かな配達箱`: 店舗支援を強める

倍率は`SIMULATION_CANDIDATE`として工程2・3で決定する。

### 11.10 10F「灰鈴大広間」

- 入階前に3形態と主な必要役割を図で予告する。
- 装着武装ごとに有利な形態と全戦予測を示し、一つの武装だけが唯一解にならないようにする。
- 戦闘中のショップ変更は不可。敗北後は即変更できる。
- 3形態の間で味方位置を維持し、瞬間的な全回復はしない。
- 勝利後、猫全員が階段を上がるのではなく、大広間へ集まって市場再開を祝う。
- カゲツバサは上階へ退却し、画面を引いて11〜100Fの未制圧輪郭を見せる。
- 1〜10Fの配置無料期間、地区章、夜明け、記録画面を解禁する。
- 11Fは未制作表示とし、プレイ可能にしない。

## 12. 塔スクロールと閲覧

### 12.1 3つの階状態

- 制圧済み: 暖色、生活アニメーション、施設情報、再配置操作
- 現在戦闘中: 強い枠、戦闘音、敵編成、戦闘HUD
- 未制圧: 低彩度の輪郭、階番号、用途の予告、敵詳細は未発見表示

### 12.2 閲覧操作

- 戦闘画面を縦にドラッグすると塔閲覧へ移行する。
- 閲覧中も戦闘シミュレーションは継続する。
- 閲覧中に現在階へ強制スナップしない。
- 固定ボタン`戦闘へ戻る・現在○F`で復帰する。
- 右端の地区レールは1〜10、11〜20…91〜100を示す。
- 未制作の11〜100Fも輪郭と地区名は閲覧できるが、入階できない。
- 初期描画は現在階と前後を合わせ9〜13階以内にする。

### 12.3 戦闘とスクロールの誤操作防止

- 呼び鈴は固定下部領域、塔スクロールは塔面に限定する。
- 呼び鈴上で始まった短押しだけを増援と判定する。
- 移動量がスクロール閾値を越えたら長押しを必ず解除する。
- 増援50回で誤スクロール0、スクロール50回で誤増援0をQA条件にする。

## 13. 制圧階の生活設計

各制圧階は「背景だけ変わる部屋」にしない。最低2つの生活行動を持つ。

| 階種 | 常時行動 | 低頻度行動 | 戦闘との接続 |
|---|---|---|---|
| 補給 | 箱整理 | 鈴磨き | 増援出発 |
| 店舗 | 製造・接客 | 休憩・看板交換 | 商品配送 |
| 昇降機 | 箱積載 | 到着ベル | 前線支援到着 |
| 猫部屋 | 睡眠・手入れ | 他猫との会話 | 回復復帰 |
| 掲示板 | 依頼確認 | 達成印 | 解放条件更新 |
| 記念室 | 遺物展示 | 戦績閲覧 | 今周効果確認 |
| 大広間 | 集会・配達分岐 | 地区祝賀 | 地区配置管理 |

同時に全階を動かさず、表示階だけ高品質動作、近傍階は低頻度、画面外は論理更新だけにする。

## 14. フィードバックと触り心地

### 14.1 呼び鈴

1. 指が触れる: p95 100ms以内で沈み込み、輪郭発光
2. 出撃受付: 鈴音、入口アイコン点灯
3. 猫出現: 砂煙、足音開始
4. 出撃不可: 赤く振るのではなく理由ラベルと代替号令

### 14.2 命中

- 予備動作→接触/弾着→HP→音→反動を±50ms以内へ揃える。
- ヒットストップは50〜80ms目安。
- 弱攻撃と強攻撃で反動、音量、画面揺れを分ける。
- 画面揺れは設定で減らせる。reduced-motionでは位置移動を抑え、発光と音で補う。

### 14.3 キャラクターの高低ずれ防止

- 全階は共通`floorGroundY`を持つ。
- 全キャラ素材は`footX/footY`、可視境界、影中心、表示倍率をmanifestへ持つ。
- 状態変更で足裏が2 CSS pxを超えて跳ねない。
- 階段は床Yを補間し、画像の`top`を個別調整しない。
- 空中敵は地面影との距離で高度を表し、素材の透明余白で浮かせない。
- ボスだけの体格差は意図として記録し、通常敵の意図しない差は±15%以内。

### 14.4 画面座標、safe-area、browser chrome

- app shellは`100dvh`と`env(safe-area-inset-top/bottom)`を基準にし、`100vh`固定や負のtop補正でSafari barの高さを推測しない。
- title、HUD、modalの最初の情報は上safe-areaより下へ置き、下部主要操作は下safe-areaより上へ置く。
- title画面の背景cover位置とpanel位置を分離する。背景を中央cropしてもtitle文字や開始buttonがviewport上端から欠けない。
- combat world座標、HUD座標、塔scroll座標を分離し、browser bar開閉で`floorGroundY`や接敵点が動かない。
- modalはvisual viewport中央を基準にするが、内容が667px高で収まらない場合はmodal内部scrollを許可し、上端をviewport外へ押し出さない。
- 確認対象は320×667、375×667、390×844、430×932 CSS px、Safari通常tab、ホーム追加PWA、ChatGPT内browserとする。simulation/emulationを物理iPhone確認として扱わない。

### 14.5 可読性とaccessibility

- 呼び鈴、主要購入、再戦は56×56 CSS px以上、その他の操作は48×48 CSS px以上、隣接操作間隔は8 CSS px以上を標準とする。
- textと数値はbitmapを拡大せず、device pixel ratioに追従するHTML/SVG/Canvas textで描画する。撃破数、boss HP、現在/最大値は1px単位の縮小transformを禁止する。
- boss HPは`現在値 / 最大値`、形態、減少barを同時表示し、色だけに依存しない。桁が増えたら単位省略規則を一元化し、数字同士を重ねない。
- 本文、補助文、使用不可状態は背景とのcontrastを測定し、装飾背景には半透明plateまたはoutlineを置く。
- `prefers-reduced-motion`ではcamera shake、parallax、長距離移動を減らすが、命中順序と状態変化は消さない。
- muteでもtelegraph、命中、報酬、失敗理由が分かり、色覚差があっても形・icon・labelで区別できる。

### 14.6 物理・性能budget

- 猫の接敵移動650〜1,000ms、階移動1.6〜2.0秒は動作契約として固定し、balance候補へ戻さない。
- damage判定、HP、数字、音、反動の同期は±50ms、hit stopは50〜80ms。
- 通常play中央値55fps以上、p95 frame time 32ms以下、100ms超停止0を物理端末Gateとする。
- 表示外floorのanimation、timer、observer、listenerを停止し、同時描画floorを9〜13に制限する。
- 10分連続試験ではframe、memory増加、二重event、音ずれ、入力取りこぼし、safe-area移動、復帰後のsimulation catch-upを記録する。

## 15. 敗北診断

敗北画面は`もっと強くしよう`だけで終わらせない。直前の戦闘ログから主因を最大2件まで提示する。

| 診断 | 判定の例 | 提案する操作 |
|---|---|---|
| 前線維持不足 | 敵が入口へ到達、前衛不在時間が長い | ムギ、ガード、人材受付所 |
| 対空不足 | 飛行敵の生存時間と被害が高い | ルナ、スリンガー、魚食堂 |
| 盾突破不足 | 盾中の無効・軽減割合が高い | 爪工房、後列優先 |
| 後列到達不足 | 支援敵の詠唱成功回数が多い | コハク、走者、標的変更 |
| 回復不足 | 回復可能だった損失が大きい | トト、診療所、魚食堂 |
| 増援回転不足 | 空き枠時間、予約切れが長い | 人材受付所、長押し補助 |
| 配送不足 | 支援到着前に敗北、昇降停止 | 3F確認、店舗配置確認 |

ボタンは`編成を直す`、`店舗を直す`、`対象階を見る`、`すぐ再戦`、解禁後の`夜明けを確認`を出す。提案から該当画面へ一回で移動できる。

## 16. 夜明けの第1地区仕様

### 16.1 解禁

- 8Fで初回敗北、または進行停滞条件を満たすと説明を解禁。
- 実行は任意。敗北直後に強制しない。
- 10F制圧後はいつでも確認できる。
- 最初の自然な実行目標は12〜20分、壁18〜22F付近を`SIMULATION_CANDIDATE`とする。1〜10Fで実行しなくても10Fを突破できる余地を残す。
- 同じ最高階かどうかではなく未請求の新規reward IDの差集合で判定し、差集合が空の再実行は恒久shardを0として10F周回を最適解にしない。

夜明け判断は`candidate-v1.json.dawn.decisionPolicy`の決定論的policyで検証する。敗北、予測TTKが壁閾値へ到達、foreground停滞、任意の比較画面表示を別triggerとして記録するが、triggerだけで夜明けを実行しない。実行は失う・残る・得るものを表示した明示確認だけで行い、階またはwall clockで強制しない。

### 16.2 実行前表示

失うもの:

- 現在階、今周コイン、今周猫レベル
- 店舗の今周レベル、9Fの一時遺物、今周戦闘状態

残るもの:

- 解放猫、店舗設計図、配置図
- 地区章、最高階、図鑑、物語、恒久祝福

得るもの:

- 新しい5F節目、地区boss初回、初回実績から得たDawn shard
- capped branchへの配分または無料respec
- 前回最高階までの再攻略補助
- 前後比較記録

恒久報酬は`newRewardIds = reachedEligibleRewardIds - profile.claimedDawnRewardIds`の差集合だけから計算し、`dawnShards = sum(rewardLedger[id].shards for id in newRewardIds)`、commit後はclaimed集合との和集合を保存する。manifestの`sameMaximumFloorContribution`と`noNewRewardIdsPermanentCurrency`は0とする。同じ最高階でも未請求の一度限りachievement IDは一度だけ報酬になり得るが、差集合が空ならshardは0で、preview、再読込、複数tab、再送でも同じIDを二重加算しない。

同じ最高階でshardが0でも、非stackの1周catch-upと無料respecは与えてよいが、値はmanifest候補とする。新最高階へ達した時点でcatch-upを解除し、同じ場所の再夜明けで積み上げない。

### 16.3 恒久branch 3系統

| ID | 名称 | 方針 | 見える変化 |
|---|---|---|---|
| `dawn.combat` | 鋭爪の朝 | 戦闘 | 命中時の爪光、盾への手応え |
| `dawn.reinforcement` | にぎやかな朝 | 増援 | 呼び鈴の共鳴、入口の出撃列 |
| `dawn.commerce` | 実りの朝 | 商業 | 配送箱の印、店からの出荷頻度 |

各branch上限は`candidate-v1.json.dawn`だけに置く。商業の購入効果を含む実効戦力も比較し、表示倍率だけを揃えない。

`T[b,i,s]`をbuild `b`、seed `i`、schedule `s`の100F wall-clock到達時間とし、未完走は除外せず`+Infinity`とする。

```text
medianSpread  = max_b(P50_i(T[b,i,baseline])) / min_b(P50_i(T[b,i,baseline]))
robustSpread  = max_b(P90_i(T[b,i,baseline])) / min_b(P10_i(T[b,i,baseline]))
extremeSpread = max_b(
                  P50_i(T[b,passivePersona,i,standardSchedule])
                  / P50_i(T[b,activePersona,i,standardSchedule])
                )
```

工程3の合格条件は`medianSpread <= 1.25`、`robustSpread <= 1.35`、`extremeSpread <= 1.60`とする。extreme比較は同じ`standardSchedule`を用いて任意入力差だけを測り、active/passive固有scheduleは別のstress reportへ出す。baseline、persona、scheduleはmanifestで先に固定し、結果を見て入れ替えない。

選択カードには次周の最初の3分、前回最高階への予測復帰時間、変化する購入候補を文章と短いpreviewで示す。最初のDawn後の前回最高階復帰は前周foreground時間の35〜50%、scenarioごとの厳密な逆数で合成再制圧速度`2.00〜2.857142857142857倍`、表示上限`2.86`を目標とする。再制圧短縮、経済、設計図復元、操作補助を合わせ、生の攻撃力、HP、収益のどれか一つへ`×2`以上を直接与えない。

## 17. 保存・復元境界

schema3の完全field定義は工程5の実装開始前に独立reviewする。本書では1〜10Fの復元要件を固定する。

保存必須イベント:

- 敵出現、命中、KO、ウェーブ開始・終了
- 増援要求、出撃、予約列変更
- 階制圧、階段遷移開始・完了
- 店舗候補表示、配置確定、再配置
- 配送出発、到着、ルナ進捗
- 猫条件進捗、猫解放、編成変更
- 遺物選択、ボス形態変更
- 夜明け確認、祝福選択、実行完了
- 武装解放、装着変更、tier更新
- logout時の`U`、放置開始時刻、放置cap、復帰精算

復元時の必須結果:

- 猫、敵、HP、位置、標的、増援列が同じ意味状態へ戻る。
- 階段途中なら重複報酬なしで遷移を完了する。
- 店舗選択途中なら未確定のまま候補へ戻る。
- 解放条件の加算を二重に行わない。
- ボス形態を巻き戻して報酬を重複させない。
- オフライン中に階制圧、猫解放、店舗選択、ボス撃破を自動確定しない。
- profileへ猫・店舗・武装の解放、Dawn branch、最高階を保存し、runへcoin、猫level、店舗level、装着武装、現在戦闘を保存する。
- 旧underscore IDは9.7の移行aliasで一度だけ正規hyphen IDへ変換し、future schemaを古いruntimeで上書きしない。

## 18. 正本となる9画面

工程2・3の合格値を反映して、工程4では次の9画面だけを完成見本にする。状態差を別screenとして数えず、同じ責務のvariantとして一枚へ併記する。次表は人間向けの判断要約であり、required stateの完全かつ順序付きの集合は`PROJECT_STATUS.json.canonicalScreens`だけを権威とする。要約に省略されたstateも完成見本から削除しない。

| ID | 正本画面 | 状態・判断の要約 |
|---|---|---|
| `S01` | title / resume | 新規開始、保存再開、音、縦画面、safe-area。titleと開始buttonをbrowser barで欠けさせない |
| `S02` | battle / follow | 1Ftutorialと通常戦闘variant、自動出撃、短押し、長押し、複数敵、配送、戦闘へ戻る |
| `S03` | tower browse | 制圧済み・現在・未制圧、地区rail、戦闘継続、9〜13floor virtualize |
| `S04` | floor clear / shop slot | KO、報酬、階段、空きslot、候補比較へ進む/後で決める |
| `S05` | shop reconfigure | 4候補比較、予測効果、配送、重複逓減、再配置、失う値/残る値 |
| `S06` | cat roster | 4匹の公開条件、進捗、編成、役割、level一括購入、生活preview |
| `S07` | upgrades / build / armament | 3build、3武装、予測TTK・生存・収益、推薦購入。敗北診断は同画面の状態sheet |
| `S08` | F10 boss variant | 3形態HP、telegraph、撃破数、現在/最大HP、最大効果密度、第2形態の対空判断 |
| `S09` | district result / Dawn | 10F結果、配置無料、失う/残る/得る、shard 0理由、3branch、実行前後比較 |

各見本は390×844 CSS pxを基準に、320×667、375×667、430×932でも情報が欠けないようにする。通常、押下、使用不可、loading、empty、error、scroll位置、safe-area、reduced-motionを明記する。S07の診断sheet、S08の各形態、S09の地区結果とDawn確認は別screenを追加する理由にしない。

## 19. 現行受入条件

本書の現行受入条件は`quality-reviews/step-1-canonical-design/acceptance-round-003.json`、最終完成証跡は`quality-reviews/step-1-canonical-design/acceptance-round-005.json`とし、Round 1・2の不合格記録と、状態表記・holdout封印範囲の見落としを記録したRound 4を履歴として保持する。外部比較の根拠と限界は`quality-reviews/step-1-canonical-design/research-evidence.md`に分離し、資料を引用しただけで数値を合格にしない。

### 19.1 工程1で固定する契約

- 1〜10Fすべての用途、新規学習、制圧後用途が一意で、F5救出、F8壁、F9エリート、F10三形態bossが倍率だけの差ではない。
- 猫4匹、一時増援3役、通常敵6種、エリート2種、壁1件、boss1体の役割が見た目、行動、対策で区別できる。
- 最初のtutorial短押しが受理された直後に基礎自動出撃を開始し、初撃・初撃破を解禁条件にしない。30秒以上の連打・保持を必須にしない。
- 接敵・弾着前damage禁止、命中同期、clock区分、推奨帯、一撃KO、Dawn ledger、`U` snapshotの計測定義が一意である。
- `simulation/candidate-v1.json`の必須schema、Gate Sの式、失敗時に候補へ戻す規則が一意である。
- Dawnの`newRewardIds`が空なら恒久通貨0、放置で未見boss・選択を越えない、店舗再開作業0、武装random stat 0である。
- 正規hyphen IDだけを保存・出力し、旧IDは読取migrationだけである。
- 9画面が中核判断をすべて覆い、暗黙の10枚目へ逃がさない。

工程1の`PASS`は文書契約の一致だけを意味する。応答p95、命中±50ms、所要時間、HP、価格、報酬、build差、武装相性、放置収益、Dawn復帰を合格済みにしない。

### 19.2 後工程でのみ合格させる項目

- 工程2・3では`SIMULATION_CANDIDATE`を検証済みと表示せず、100F、8・24時間放置、3build各1,000件で範囲外とexploitを記録する。Gate S全条件を満たした同一candidateだけを採用する。
- 工程4では採用candidateを9画面へ反映し、実装済みとは表示しない。
- 工程5では1〜10F runtimeとassetを実装し、自動test、browser、Vercelの非物理受入を完了するが、物理証拠なしにGate Cを`PASS`またはPreview Readyにしない。
- 工程6では同一commit・deploymentの物理iPhoneで180秒bossと600秒連続を実行し、入力p95、命中同期、frame、memory、safe-area、保存復帰を含む全Gate C条件が合格した時だけGate Cを`PASS`にする。失敗したら工程5へ戻す。
- 11〜20Fは現行6工程の範囲外であり、工程6合格後も自動着手しない。将来の別ユーザー承認を必要とする。

停止条件は、正本間矛盾、保存破損、請求済みreward IDからの恒久通貨再獲得、2地区skip、単一buildの恒常最適、90秒超の無変化、推奨帯の全HP一撃KO、入力/命中同期の基準超過、別branchへの変更である。一件でも該当したら次工程へ進めず、原因と再現seedを残す。

## 20. 工程2・3へ渡す未確定値

| 項目 | 現在 | 決定証拠 |
|---|---|---|
| HP・攻撃・価格・報酬曲線 | `SIMULATION_CANDIDATE` | 100F購入・戦闘simulation |
| 敵攻撃とsurvival | `SIMULATION_CANDIDATE` | 役割別被弾回数、初見即死率 |
| 24時間放置収益 | `SIMULATION_CANDIDATE` | 0/8/24時間、build別購入数、停止境界 |
| Dawn時期・回数・復帰 | `SIMULATION_CANDIDATE` | 100F到達までのDawn履歴と同地点farm検査 |
| 3build差 | `SIMULATION_CANDIDATE` | 各1,000seedの中央値、p10/p90、最速/最遅 |
| 武装相性 | `SIMULATION_CANDIDATE` | 敵role別switch率、恒常最適の有無 |
| 9画面具体layout | 未制作 | 工程2・3合格後の工程4 visual review |
| 1〜10F runtime | 未実装 | 工程4合格後の工程5 |
| 物理iPhone | `NOT_VERIFIED` | 工程6のSafari/PWA/in-app 3分+10分記録 |

工程2は購入を含む100F state machineとして実行し、calibration seedだけで候補係数を変更する。工程2合格時はcandidate、`simulation/engine`全regular fileの完全集合、run plan、result schema・validator、Node version、raw・summary・Acceptanceのdigestをstrict schemaの一方向sealへ固定する。工程3は戦闘、増援、商業の各buildについて、そのsealと一致し、candidateから未観測の一回限りのholdout bankを各1,000 seedで実行し、購入方針と最初の有効なAcceptance判定を保存する。seed単位結果、集計、判定または診断を一つでもprocess外へ実体化したbankは使用済みとなる。同じ登録済みsessionは完走してよいが、部分出力後のcrash・欠落・invalid result・判定未生成から同じbankを再開しない。期待した3,000 identityの完全一致、strict schema、独立再集計、dataset・summary・Acceptance digestの一致がない判定は無効である。中央値が合っていてもp10/p90、停止率、操作回数、同じ選択への収束、放置境界違反が不合格ならStep 1へ戻り、calibrationと全bank履歴に非交差の未観測bankで再封印し、更新candidateのStep 2を全件再実行する。bank名だけを変えた同一・重複rangeの再利用、使用済みbankを見た係数調整や昇格判定のやり直しは禁止し、そのbankは診断専用とする。同一digestのbyte-equivalence検査、または結果を一切露出しなかった基盤障害の復旧だけを例外とする。bank lifecycleはcanonical JSONL追記専用ledgerでpreflightする。
