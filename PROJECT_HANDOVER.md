# Cat's Tower 引き継ぎ書

更新日: 2026-08-23

Repository: `2hg7trp7rv-design/cats_tower`

Canonical branch: `main`

文書作業branch: `codex/restart-step-1-round7`

固定Vercel URL: <https://cats-tau-dusky.vercel.app/>

工程状態: 工程1A=PASS / 工程2=PENDING_REVALIDATION / 工程3=PENDING_REVALIDATION / 工程4以降=NOT_STARTED

工程1A正式名称: V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint

工程1A対象外: whole-repository backup / player-save backup / physical-iPhone approval / Production alias switch

## 1. 最初に理解する結論

製品方針は、V0.8.2の10F完結版から「1つの塔・100F」へ変更された。

ただし、100F分の素材やデータを一括生成しない。最初に1〜10Fを完全な商品スライスとして作り、実移動、接敵、複数敵、ショップ選択、猫解放、塔スクロール、夜明け、保存、物理iPhone QAを合格させる。11F以降はその後に10F単位で制作する。

工程1A・V0.8.2 deployed browser-runtime source + deployment-input byte checkpointはRound 6の外部artifact監査でHTTP 415となり、`IN_PROGRESS`へ戻した。その間のゲームruntime変更は0件である。Round 7 completion sealが合格するまで工程2へ進まず、工程2と工程3の旧成果物は`PENDING_REVALIDATION`の候補として保持する。

## 2. 文書の権限

仕様の優先順位:

1. `MASTER_SPEC.md`
2. `QUALITY_GATE.md`
3. `AGENTS.md`
4. `PROJECT_STATUS.json`
5. `PROJECT_HANDOVER.md`
6. `README.md`
7. コード、テスト、コメント

旧文書、現行コード、古いテストに「10F終了」「11F禁止」「3F食堂・5F共同部屋固定」「ショップ不要」と書かれていても、新製品仕様としては失効している。現行V0.8.2の挙動を説明する履歴としてのみ扱う。

## 3. 工程1A・V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint

V0.8.2はコード修正前の検証済み比較・復旧checkpointである。GitHubの現在の`origin/main`、V0.8.2 baseline commit、履歴上のdeployment、現在の固定Productionは別々に扱う。

| 項目 | 値 |
|---|---|
| 工程1A状態 | 冒頭の工程状態を正本とする。Round 7 completion seal前は工程2着手禁止 |
| Round 7開始時の`origin/main` | `88daf9c912fa726e019915e5d7bfed94f0a47158` |
| baseline候補commit | `727b8d00c281e7539117da5ded7309ea01c7e516` |
| baseline GitHub | <https://github.com/2hg7trp7rv-design/cats_tower/commit/727b8d00c281e7539117da5ded7309ea01c7e516> |
| 履歴上のbaseline deployment | `dpl_4YVfqsWrzkSUmzQLZMzcTHLVzTe1` / `727b8d0` / `READY` |
| Round 7開始時の固定Production | `dpl_A2sPMt2c6LHSCMEWZj6jP2Yre4MR` / `88daf9c` / `READY` |
| 固定Production URL | <https://cats-tau-dusky.vercel.app/> |
| runtime照合 | baseline候補と現在の固定Productionがbyte単位で一致 |
| 工程1A再構成によるゲームruntime変更 | 0件 |
| fresh recovery Vercel Preview | `dpl_3qe2uhLnFQ4e9M4UmedQxRGUY3xV` / baseline同一tree / `READY` |
| 物理iPhone / ChatGPT内ブラウザ / standalone PWA | 未検証 |
| player save backup | 利用不可。削除・回復不能に破損した実ユーザー`localStorage`は復元不可 |
| 1〜10F Preview Ready | false |
| 100F Product Production Ready | false |

remote archive branch `archive/v0.8.2-legacy-baseline`はbaseline候補commitを指す。fresh recovery Previewでは非HTML 15経路が直接一致し、各HTMLはbaseline bytesの直後にdeployment-bound Vercel Preview Toolbar suffixが1回だけ追加された。Round 6はC3/main CIまで成功したがexternal audit run `32590920047`がC3 artifact取得時にHTTP 415で失敗したため、Round 6全体は`FAIL`である。Round 7は修正版transportとcompletion sealを別pathで追加し、成功前の`PASS`を禁止する。C1公開後はC1のAcceptance・検証器・workflowを唯一の信頼基点として凍結し、全後続状態をdetached C1検証器から監査する。外部artifact監査は対象main-push runと同じcommitのrelative reusable workflowとして実行し、別のdefault-branch workflowの差替えを完成根拠にしない。

## 4. 新しい製品定義

> 猫を呼んで塔を奪還し、制圧した部屋で猫が暮らし、選んだ店と物資配送が上階の戦闘を支える、スマートフォン縦画面専用の100F放置インクリメンタルRPG。

独自の柱:

- 呼んだ猫が入口から実際に移動する。
- 制圧した階が猫の生活・仕事・回復の場所になる。
- 店舗から前線へ物資が物理的に運ばれる。
- 塔の過去・現在・未来を連続スクロールで見られる。
- 猫、施設、敵の関係を画面上の因果として理解できる。
- 猫は公開条件で解放し、敗北理由から次の改善を選べる。

## 5. 100F構造

| 階 | 地区 | 主な圧力 |
|---:|---|---|
| 1〜10F | 灰かぶり入口市場 | 基礎、店舗、猫救出、夜明け |
| 11〜20F | 焔の大厨房 | 火傷、重装、高火力 |
| 21〜30F | 水没貯水区 | 減速、吸収、盾 |
| 31〜40F | 歯車工房 | 砲台、修理、設備妨害 |
| 41〜50F | 苔庭温室 | 毒、根、回復 |
| 51〜60F | 亡霊書庫 | 呪い、潜伏、施設停止 |
| 61〜70F | 雷鳴鳥舎 | 飛行、雷、レーン移動 |
| 71〜80F | 氷結宝物庫 | 凍結、破砕、盾 |
| 81〜90F | 月鏡宮 | 反射、模倣、構成対策 |
| 91〜100F | 黒羽王座 | 複合ルール、最終試験 |

各地区の用途は、入口1、ショップ4、支援2、猫救出1、遺物1、ボス1を基本にする。100F商品版Ready時の制覇後機能は、記録・収集確認・通常再周回だけとする。追加モードは本編完成後に候補から一つだけ別承認する。

## 6. 1〜10Fの商品スライス

最低完成範囲:

- 名前付き猫4匹。ムギ、ルナ、トト＋条件解放1匹
- 一時増援3役割以上
- 通常敵6種、エリート2種、追加敵種に数えない壁遭遇1件、3段階ボス1体
- ショップ4種、支援施設2種
- 制圧済み・現在・未制圧を自由に見る塔スクロール
- 制圧商業階でのショップ比較、配置、再配置
- 到達＋店舗＋実績による猫解放
- 猫の実移動、接敵、命中、複数敵、階段上昇
- 3択の夜明けと配置図の自動復元
- 戦闘途中を含む保存・再読込

1〜10FがGate Cに合格しても11F制作は始めない。制作へ参加していない初見テスター10人以上を含むGate D1合格後に11〜20Fだけを許可し、以後も地区ごとのGate合格で次の10Fだけを許可する。

## 7. 操作と動きの基準

- タップ直接ダメージ: 0
- 入力の一次反応: 100ms以内を内部目標
- 猫の移動: 戦闘幅の30〜45%、650〜1,000ms目安
- 接敵前・弾着前ダメージ: 0
- 命中、HP、音、反動: ±50ms以内
- ヒットストップ: 50〜80ms目安
- 階移動: 1.6〜2.2秒目安
- 足裏と床、状態切替、影中心: 2 CSS px以内
- 意図しない同役割の体格差: ±15%以内
- 主要tap領域: 44×44pt以上
- 増援50回で誤スクロール0、スクロール50回で誤増援0
- Gate Cでは呼び鈴、足音、命中、被弾、KO、配送、階段、制圧、夜明け、ボスに制作用音が必要。oscillatorだけの仮音は不合格

短押しは増援1回、400ms以上の長押しは任意の連続呼び込み。指を離す、スクロール判定距離を越える、停止画面へ入る、のいずれかで必ず終了する。

個別CSS座標で高低差を隠さず、階側の`floorGroundY`と素材側の`footAnchor`を同じワールド座標へ結びつける。

## 8. ショップと制圧階

最終ショップ10種:

1. 人材受付所
2. 魚食堂
3. 爪工房
4. おもちゃ工房
5. ねこ診療所
6. 配送倉庫
7. 星見観測所
8. 灯火店
9. 昼寝宿
10. 珍品館

支援施設は訓練場、休憩巣、物資昇降機、依頼掲示板。

店の選択は可逆。同一店舗は逓減し、隣接効果を持つ。地区ボス撃破後は地区内を無料再配置できる。夜明け後も店舗種類と配置図を保持し、再制圧時に自動復元する。毎周40店舗を手動で置き直させない。

## 9. 猫と敵

最終目標:

- 名前付き猫は100F商品版で最大12匹、同時編成最大6匹
- 一時増援は画面上12〜16匹を目安にし、超過分は列または`×N`
- 通常敵30種、エリート10種、地区ボス9体、最終ボス1体

猫は個別レベル、役割、固有スキル、施設適性、動作、アンカーを持つ。解放条件は常に公開し、ガチャや隠し乱数にしない。

敵は、突進、盾、遠距離、回復、召喚、飛行、潜伏、分裂、反射、状態異常、自爆、レーン移動、店舗妨害、増援封鎖、模倣を行動群として持つ。色、HP、倍率だけの違いは別種として数えない。

## 10. 夜明けと刺激

夜明け前に失う物、残る物、得る物、前後比較を表示する。

- 失う: 現在階、今周コイン、今周猫レベル、店の今周レベル、一時遺物、今周状態
- 残る: 解放猫、店舗設計図、配置図、ボス遺物、最高階、図鑑、物語、恒久強化

最終的に戦闘・精鋭、増援・数、商業・配送の3ビルドを成立させる。最初の1〜10Fは巨大な恒久ツリーを作らず、違いが分かる3択で検証する。

短期、階、地区、周回、100Fの目標を重ねる。敗北時は火力、回復、前衛、対空、増援、状態異常、施設停止など主因と改善候補を示す。

## 11. 商人サーガとの境界

参考にするのは、入力→増援→戦闘→制圧→経済→再投資の抽象的な因果だけ。

コード、素材、キャラクター、名称、文章、UI配置、色、音、数値、演出時間、広告導線は複製しない。Cat's Towerは猫の生活、店舗隣接、配送、100F閲覧、公開解放、敗因診断を独自価値にする。

## 12. 現行V0.8.2コードの扱い

再利用候補:

- 固定ステップ更新
- イベントバス
- future schema保護
- オフライン上限
- PWAとQAの基礎

置換必須:

- 6枠固定座標
- 単体敵モデル
- 10Fハード上限
- 全猫共通レベル
- 3F食堂・5F共同部屋だけの施設構造
- 常時3層だけの塔UI
- R2/R3素材規格の混在
- CSS末尾へ上書きを積む修正方式

旧版と新版のUI、CSS、通常ロジック、Service Worker cacheを混在させない。旧保存読込は専用migrationへ隔離する。

## 13. 保存の方向

現行は`cats-tower-v080` / `gameplaySchema: 2`。新版は`cats-tower-v100` / schema3として先に設計し、旧キーへ直接書き込まない。

- schema2原文を`cats-tower-v080-schema2-raw-backup`へ移行前にバックアップする。
- 移行はcopy・idempotentとし、失敗時はschema3へ昇格しない。
- 旧10Fクリアを100Fクリアにしない。
- profile、run、tower、runtime、systemを分離する。
- 表示名や配列番号ではなく安定IDを使う。
- 戦闘中のHP、位置、増援、施設、階移動を復元する。
- revisionと保存世代を持ち、古いタブの上書きを防ぐ。
- オフラインで階制圧、ボス、猫解放、店選択を進めない。

詳細フィールドは準備工程8で確定する。コードへ先行追加しない。

## 14. 量産と停止条件

一回の素材batch上限:

- 猫2匹
- 通常敵5種
- エリート2種
- ボス1体
- ショップ2種
- 地区背景1つ

前batchが実機、アンカー、animation、容量に合格するまで次を作らない。

Gate B前の総量上限は、名前付き猫2、一時増援1、通常敵2、エリート1、形態変化試験ボス1、背景1階、ショップ1。Gate B前の第2batchは禁止し、Gate Cまでは1〜10F必須数を総量上限とする。

正本矛盾、保存破損、P0・P1、性能予算超過、実機重大入力不良があれば新規制作を停止し、最後に合格したcommitへ基準を戻して根本原因を直す。

工程状態は`NOT_STARTED`、`PENDING_REVALIDATION`、`IN_PROGRESS`、`BLOCKED`、`PASS`のみ。「ほぼ完成」「実質完成」は使わない。`PENDING_REVALIDATION`は旧成果物を削除せず、新しい完成判定で再評価する状態にだけ使う。

## 15. 現行V0.8.2の既知状態

保存点では次が実装済みだった。

- 3層塔ボード
- 名前付き猫3匹とhelper3種
- 通常敵2種、8F壁、10Fボス
- 直接tap damage 0と満員時号令
- 3F食堂、5F共同部屋
- 勝利、上昇、入階の段階
- 10F完了と11F防止
- schema2保存

当初の保存点判定で確認済みだった範囲:

- Chromium 390×844 / 375×667のsource E2Eと目視証跡
- 猫6種の接地、formation、回復、完了再読込
- 敵のhit、defeat、階遷移
- `PROJECT_STATUS.json` parseとR3画像decode

当初の保存点判定で未確認だった範囲:

- WebKit 390×844 / 375×667
- 通常速度動画
- 物理iPhone Safari、ChatGPT内ブラウザ、PWA
- Service Worker更新
- 精密バランス

工程1A Round 6の封印証拠では、WebKit 390×844 / 375×667の1F〜10F deterministic loopと通常motionの開始・戦闘・再読込、ChromiumのService Worker有効・offline復旧を再実行し、raw reportもrepositoryに保持した。Round 4は外部artifact検証とC1変更境界、Round 5は後発rerunを含む全attempt探索に欠陥が判明したため、CIの成功とは分離して`FAIL`として保持する。ただし通常速度の物理端末録画、物理iPhone Safari、ChatGPT内ブラウザ、standalone PWA、精密バランスは依然として未確認である。

過去のChromium結果を新版100Fの証拠へ流用しない。

## 16. 次に行うこと

工程1Aのdeployed browser-runtime source + deployment-input byte checkpointのlive状態は冒頭の工程状態を正本とする。completion sealが`PASS`するまで工程2へ進まない。物理iPhoneは後続の製品QAまで未検証として分離する。

工程1Aのlive状態は冒頭の工程状態を正本とする。工程2の`MASTER_SPEC.md`と工程3の`FLOORS_1_10_DESIGN.md`は削除せず候補として保持し、工程4以降とゲーム本体コード修正は`NOT_STARTED`のままとする。

## 17. コード修正前の全順序

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

## 18. 完了報告で分離する状態

必ず次を別々に報告する。

- local branch / commit
- GitHub branch / PR / `main`
- Vercel Preview / Production
- deployment READY / runtime一致
- browser自動QA / 通常motion / 物理実機
- 保存移行 / PWA更新
- 1〜10F Preview Ready
- 100F Product Production Ready

HTTP 200、build成功、deployment READYだけでは完成判定にならない。
