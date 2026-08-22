# Cat's Tower

猫を呼んで塔を奪還し、制圧した部屋で猫が暮らし、選んだ店と配送が上階の戦闘を支える、スマートフォン縦画面専用の100F放置インクリメンタルRPGです。

工程状態: 工程1A=PASS / 工程2=PENDING_REVALIDATION / 工程3=PENDING_REVALIDATION / 工程4以降=NOT_STARTED

工程1A正式名称: V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint

工程1A対象外: whole-repository backup / player-save backup / physical-iPhone approval / Production alias switch

## 現在の結論

最終仕様は「1つの塔・100F」に決定しました。ただし100F分を一括制作せず、まず1〜10Fを商用品質の縦切りとして完成させます。

| 対象 | 状態 |
|---|---|
| 100F方針 | `PASS` |
| 工程1A・V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint | 冒頭の工程状態を正本とする |
| 工程2・100F正本仕様書 | `PENDING_REVALIDATION` — 旧成果を候補として保持 |
| 工程3・1〜10F完全設計 | `PENDING_REVALIDATION` — 旧成果を候補として保持 |
| 工程4〜9 | `NOT_STARTED` |
| コード修正 | `NOT_STARTED` |
| 現行公開版 | V0.8.2 legacy baseline |
| 1〜10F Preview Ready | `false` |
| 100F Product Production Ready | `false` |

100Fの最上位仕様候補は[`MASTER_SPEC.md`](./MASTER_SPEC.md)、1〜10Fの詳細候補は[`FLOORS_1_10_DESIGN.md`](./FLOORS_1_10_DESIGN.md)です。どちらも現在は`PENDING_REVALIDATION`であり、現行Gateの再合格前は完成成果として扱いません。

## 工程1AのV0.8.2配信runtime checkpoint

コード修正前の復旧基準は、V0.8.2のcommit `727b8d0`です。GitHub `origin/main`のRound 7開始点はRound 6 merge `88daf9c`であり、両者を同じcommitとして扱いません。

| 役割 | commit / deployment | 状態 |
|---|---|---|
| Round 7開始時の`origin/main` | `88daf9c912fa726e019915e5d7bfed94f0a47158` | Round 6の内部sealを含むが、外部監査は失敗 |
| V0.8.2 baseline checkpoint | [`727b8d00c281e7539117da5ded7309ea01c7e516`](https://github.com/2hg7trp7rv-design/cats_tower/commit/727b8d00c281e7539117da5ded7309ea01c7e516) | 比較・復旧用checkpointとして検証済み |
| 履歴上のbaseline deployment | `dpl_4YVfqsWrzkSUmzQLZMzcTHLVzTe1` / `727b8d0` | `READY`。現在の固定URLの配信先ではない |
| Round 7開始時の固定Production | `dpl_A2sPMt2c6LHSCMEWZj6jP2Yre4MR` / `88daf9c` | `READY`。<https://cats-tau-dusky.vercel.app/> |

現在の固定Productionに配信されるゲームruntimeはbaseline checkpointとbyte単位で一致し、工程1Aのやり直しによるゲームruntime変更は0件です。ただしRound 6のpost-main外部監査は、GitHub artifact APIへ誤った`Accept`を送ってHTTP 415となったため、Round 6終了時点で工程1Aを`IN_PROGRESS`へ戻しました。byte一致やmain CI成功だけを完成判定へ代用しません。

現時点の制約:

- 実ユーザーのplayer saveを復元するserver backupやexportはありません。削除済み・回復不能に破損した`localStorage`は復旧できません。
- 物理iPhone Safari、ChatGPT内ブラウザ、standalone PWAは未検証です。
- baselineと同一treeのfresh recovery Vercel Preview `dpl_3qe2uhLnFQ4e9M4UmedQxRGUY3xV`は`READY`です。非HTML 15経路は直接一致し、各HTMLはbaseline bytesの直後にdeployment-bound Vercel Preview Toolbar suffixが1回だけ追加されたことを確認しました。
- Round 6はC1/C2/C3、C3 PR CI、main CIまで成功しましたが、external audit run `32590920047`がC3 artifact取得時のHTTP 415で失敗しました。内部sealの`PASS`記録はその境界を残したまま、Round 6全体は`FAIL`、Round 6終了時点の工程1Aは`IN_PROGRESS`です。
- Round 7では修正版transportをC1で凍結し、C3時点でも`PASS`にしません。main merge後のC3/main両artifact監査成功を記録するcompletion sealを追加してからだけ`PASS`へ移します。
- C1公開後はC1自身のAcceptance・検証器・workflowを信頼基点として凍結し、C2以降の現在repositoryをdetached C1検証器で監査します。外部artifact監査も対象main-push run内で同じcommitのrelative reusable workflowとして実行し、別のdefault-branch workflowによる差替えを認めません。
- 旧成果物は削除せず、再検証対象の候補として保持します。

## 新しい中核体験

1. 呼び鈴で猫を呼ぶ。タップ直接ダメージは0。
2. 猫が入口から戦線まで実際に走る。
3. 接敵または弾着後に攻撃が当たり、敵が反応する。
4. 制圧後、猫が階段を登って次階へ進む。
5. 制圧階が店、休憩、猫部屋、補給所として塔に残る。
6. 商業階ではプレイヤーが店を選び、配置を後から変更できる。
7. 店舗の物資が前線へ運ばれ、戦闘結果へつながる。
8. 制圧済み・未制圧階を自由にスクロールできる。
9. 猫は公開条件で解放する。ガチャにはしない。
10. 夜明けで構成を変え、前回より速く100Fを目指す。

## 100Fの構造

10地区×10Fで構成します。

| 階 | 地区 |
|---:|---|
| 1〜10F | 灰かぶり入口市場 |
| 11〜20F | 焔の大厨房 |
| 21〜30F | 水没貯水区 |
| 31〜40F | 歯車工房 |
| 41〜50F | 苔庭温室 |
| 51〜60F | 亡霊書庫 |
| 61〜70F | 雷鳴鳥舎 |
| 71〜80F | 氷結宝物庫 |
| 81〜90F | 月鏡宮 |
| 91〜100F | 黒羽王座 |

各地区は入口、ショップ4階、支援2階、猫救出1階、遺物1階、ボス1階を基本にします。

## 最初に完成させる1〜10F

- 名前付き猫4匹。ムギ、ルナ、トト＋条件解放1匹
- 一時増援3役割以上
- 通常敵6種、エリート2種、追加敵種に数えない壁遭遇1件、3段階ボス1体
- 選択可能なショップ4種、支援施設2種
- 猫の実移動、複数敵、命中同期、階段上昇
- 制圧済み・未制圧階の連続スクロール
- ショップ選択、配置、隣接、配送
- 公開条件による猫解放
- 夜明けと店舗配置図の復元
- 戦闘途中を含む保存・再読込

この範囲が物理iPhoneを含むGate Cに合格しても、11F制作は始めません。制作へ参加していない初見テスター10人以上を含むGate D1合格後に11〜20Fだけを許可し、以後も地区ごとのGate合格で次の10Fだけを制作します。

## 商人サーガとの関係

参考にするのは、入力が増援へ変わり、戦闘が制圧と経済へつながり、投資が次の攻略へ返る因果です。

コード、素材、キャラクター、名称、文章、UI配置、色、音、数値、演出時間は複製しません。Cat's Towerは、猫の生活、店舗隣接、物理配送、100F閲覧、公開解放条件、敗北診断で独自化します。

## コード修正前の順序

1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — `PASS`
2. 100F正本仕様書 — `PENDING_REVALIDATION`
3. 1〜10F完全設計 — `PENDING_REVALIDATION`
4. 9画面の完成見本 — `NOT_STARTED`
5. 動きの絵コンテ — `NOT_STARTED`
6. アートバイブル — `NOT_STARTED`
7. 少数の試験素材 — `NOT_STARTED`
8. 保存・100Fデータ設計 — `NOT_STARTED`
9. QA合格表 — `NOT_STARTED`
10. コード修正 — `NOT_STARTED`

## 開発を再開する時

次の順で確認してください。

1. [`MASTER_SPEC.md`](./MASTER_SPEC.md)
2. [`QUALITY_GATE.md`](./QUALITY_GATE.md)
3. [`BASELINE_V082.md`](./BASELINE_V082.md)
4. [`FLOORS_1_10_DESIGN.md`](./FLOORS_1_10_DESIGN.md)
5. [`AGENTS.md`](./AGENTS.md)
6. [`PROJECT_STATUS.json`](./PROJECT_STATUS.json)
7. [`PROJECT_HANDOVER.md`](./PROJECT_HANDOVER.md)
8. 現在の作業ツリー、GitHub `main`、固定Vercel Production

`main`、Vercel deployment、1〜10F Preview Ready、100F Product Production Readyは別の状態です。ページが開く、buildが通る、deploymentがREADYというだけではProduction Readyにしません。
