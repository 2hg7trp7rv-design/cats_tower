# Cat's Tower 引き継ぎ書

更新日: 2026-08-25

Repository: `2hg7trp7rv-design/cats_tower`

Canonical branch: `kimi`

変更・文書branch: `kimi`（他ブランチの作成・切替・書込み、PR作成は禁止）

固定Vercel URL: <https://cats-tau-dusky.vercel.app/>

工程状態: 工程1A=PASS / 正本仕様固定=PASS / 100Fシミュレーション以降=NOT_STARTED

工程1A正式名称: V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint

工程1A対象外: whole-repository backup / player-save backup / physical-iPhone approval / Production alias switch

## 1. 最初に理解する結論

製品方針は、V0.8.2の10F完結版から「1つの塔・100F」へ変更された。

ただし、100F分の素材やデータを一括生成しない。最初に1〜10Fを完全な商品スライスとして作り、実移動、接敵、複数敵、ショップ選択、猫解放、塔スクロール、夜明け、保存、物理iPhone QAを合格させる。今回承認された6工程の実装対象は1〜10Fだけであり、11F以降の制作は現在の許可に含まれない。

工程1A・V0.8.2 deployed browser-runtime source + deployment-input byte checkpointはRound 7 completion sealまで合格し、`PASS`である。6工程中のStep 1「修正版の正本仕様固定」も、`quality-reviews/step-1-canonical-design/acceptance-round-003.json`の条件、3者独立反証、機械封印に合格し`PASS`となった。完成証跡は`acceptance-round-005.json`である。Round 4で見逃した`QUALITY_GATE.md`の状態矛盾と観測済みholdoutの再利用余地をRound 5で是正し、Round 1・2の不合格記録とRound 4を上書きせず履歴として残す。この工程でのゲームruntime変更は0件である。

## 2. 文書の権限

一列の曖昧な優先順位は使わず、対象scopeごとに権限を固定する。

| scope | 唯一の権威 | 下位資料の扱い |
|---|---|---|
| 製品境界、状態遷移、操作・保存・表示・禁止事項 | `MASTER_SPEC.md` | 全文書・実装はこれに従う |
| 1〜10Fの階別・敵別・施設別詳細 | `FLOORS_1_10_DESIGN.md` | `MASTER_SPEC.md`へ従う下位正本。競合時は停止 |
| 安定IDと読取専用alias | `PROJECT_STATUS.json.stableIdRegistry` / `stableIdMigrationAliases` | 本文のID表は説明用参照 |
| S01〜S09と各required stateの完全な集合 | `PROJECT_STATUS.json.canonicalScreens` | 他文書の画面表は要約であり、状態を削れない |
| 工程1の合否条件・完成証跡 | `quality-reviews/step-1-canonical-design/acceptance-round-003.json` / `acceptance-round-005.json` | Round 1・2は不合格履歴、Round 4は是正前履歴 |
| 工程2・3の数値・式・実行入力 | `simulation/candidate-v1.json` | schemaとvalidatorに合格した同一digestだけを使用 |
| candidateの構造・事前検査 | `simulation/candidate.schema.json` / `simulation/validate-candidate.mjs` | 未検証入力でsimulationを開始しない |
| QA gateと端末判定 | `QUALITY_GATE.md` | 物理iPhoneは工程6だけが判定可能 |
| repository作業規則 | `AGENTS.md` | 製品仕様や数値を上書きしない |
| 進捗案内 | 本書 / `README.md` | 上記権威を要約し、独自仕様を追加しない |

scope内で権威同士が競合した場合は、都合のよい方を選ばず後工程を停止して同じ変更で解消する。現行コード、古いテスト、コメントは正本ではない。

旧文書、現行コード、古いテストに「10F終了」「11F禁止」「3F食堂・5F共同部屋固定」「ショップ不要」と書かれていても、新製品仕様としては失効している。現行V0.8.2の挙動を説明する履歴としてのみ扱う。

## 3. 工程1A・V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint

V0.8.2はコード修正前の検証済み比較・復旧checkpointである。GitHubの現在の`origin/kimi`、V0.8.2 baseline commit、履歴上のdeployment、現在の固定Productionは別々に扱う。

| 項目 | 値 |
|---|---|
| 工程1A状態 | `PASS`（Round 7 completion seal合格済み） |
| 正本仕様固定開始時の`origin/kimi` | `212151b16af957d198c013aa0917014611712760` |
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

remote archive branch `archive/v0.8.2-legacy-baseline`はbaseline候補commitを指す読取り専用の履歴参照であり、作成・更新・削除対象ではない。fresh recovery Previewでは非HTML 15経路が直接一致し、各HTMLはbaseline bytesの直後にdeployment-bound Vercel Preview Toolbar suffixが1回だけ追加された。Round 6は統合CIまで成功したがexternal audit run `32590920047`がC3 artifact取得時にHTTP 415で失敗したため、Round 6全体は`FAIL`である。Round 7は修正版transportとcompletion sealを別pathで追加し、成功前の`PASS`を禁止し、最終的に合格した。C1公開後はC1のAcceptance・検証器・workflowを唯一の信頼基点として凍結し、全後続状態をdetached C1検証器から監査する。外部artifact監査は対象push runと同じcommitのrelative reusable workflowとして実行し、別のworkflowへの差替えを完成根拠にしない。

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

1〜10FがGate Cに合格しても、今回の6工程から11F以降へ進まない。将来の拡張は本工程完了後の別Acceptanceと別承認を必要とし、現時点の制作許可として扱わない。

## 7. 操作と動きの基準

- タップ直接ダメージ: 0
- 入力の一次反応: 100ms以内を内部目標
- 猫の移動: 戦闘幅の30〜45%、650〜1,000ms目安
- 接敵前・弾着前ダメージ: 0
- 命中、HP、音、反動: ±50ms以内
- ヒットストップ: 50〜80ms目安
- 階移動: 1.6〜2.0秒
- 足裏と床、状態切替、影中心: 2 CSS px以内
- 意図しない同役割の体格差: ±15%以内
- 主要tap領域: 48×48 CSS px以上、重要操作56×56 CSS px以上、隣接間隔8 CSS px以上
- 増援50回で誤スクロール0、スクロール50回で誤増援0
- Gate Cでは呼び鈴、足音、命中、被弾、KO、配送、階段、制圧、夜明け、ボスに制作用音が必要。oscillatorだけの仮音は不合格

短押しは増援1回、400〜450msで長押しを開始し、その後150〜200ms間隔で任意の連続呼び込み。指を離す、スクロール判定距離を越える、停止画面へ入る、のいずれかで必ず終了する。

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

店の選択は可逆。同一店舗は逓減し、隣接効果を持つ。地区ボスを今周撃破してから次の夜明けまでは地区内を無料再配置でき、変更配置の今周レベルは0へ戻る。夜明け後も店舗種類と配置図を保持し、再制圧時に自動復元する。毎周40店舗を手動で置き直させない。

保存と仕様の正規安定IDは`PROJECT_STATUS.json.stableIdRegistry`だけを機械可読正本とし、旧IDの読込み変換は`PROJECT_STATUS.json.stableIdMigrationAliases`だけを権威とする。registry内の`shops`と`supportFacilities`を含む全namespaceで、登録外IDを新規保存へ書かない。区切りはregistry規則どおりハイフンで統一し、旧候補の下線付きIDや用途名IDは読込み時だけ単方向変換する。

| 旧候補ID | 正規ID |
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

## 9. 猫と敵

最終目標:

- 名前付き猫は100F商品版で最大12匹、同時編成最大6匹
- 一時増援は画面上12〜16匹を目安にし、超過分は列または`×N`
- 通常敵30種、エリート10種、地区ボス9体、最終ボス1体

猫は個別レベル、役割、固有スキル、施設適性、動作、アンカーを持つ。解放条件は常に公開し、ガチャや隠し乱数にしない。

敵は、突進、盾、遠距離、回復、召喚、飛行、潜伏、分裂、反射、状態異常、自爆、レーン移動、店舗妨害、増援封鎖、模倣を行動群として持つ。色、HP、倍率だけの違いは別種として数えない。

1〜10Fの猫、一時増援、通常敵、エリート、ボス、壁遭遇、塔共通武装、Dawn branchを含む全namespaceの正規IDは、`PROJECT_STATUS.json.stableIdRegistry`だけを機械可読の権威とする。`FLOORS_1_10_DESIGN.md`の各見出しは役割・表示・挙動を説明する人間向け参照である。新規保存・event・telemetryは登録済み正規IDだけを書き、表示名や配列位置をIDにしない。

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
- 安全な放置収益は24時間を上限とする。初周オフラインで未見階制圧、ボス、猫解放、店選択を進めない。
- 夜明け後だけ既知階の再制圧を圧縮できる。上限は、前回最高階の90%、次の未解決X9、未選択分岐、未見ボス境界のうち最も低い地点で、結果と停止理由を復帰時に表示する。

詳細フィールドはStep 5の実装開始前に、正本仕様と実装Acceptanceの一部として確定する。コードへ先行追加しない。

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

次は全100Fの購入・戦闘・夜明け・24時間放置シミュレーションを開始する。実行前に`simulation/validate-candidate.mjs`を通し、同一digestの`simulation/candidate-v1.json`だけを使用する。工程2のcalibration seedだけが候補調整に使え、工程2の合格前に3ビルド各1,000パターン検証へ進まない。工程2合格時はcandidate、`simulation/engine`の完全file closure、run plan、result schema・validator、Node version、raw dataset、summary、Acceptance digestをstrict schemaの一方向sealへ固定する。工程3のholdout bankは未観測の一回限りとし、canonical JSONL追記専用ledgerで全bank IDのseed range使用履歴をpreflightする。出力を見た再調整、使用済みまたは重複rangeをbank名だけ変えた再昇格、最初の有効判定の差替えを禁止し、部分出力後に有効判定を作れない場合も同じbankを再開しない。不合格またはcandidate・simulator semantics変更時はStep 1へ戻り、calibrationと全履歴に非交差の未観測bankを登録して再封印し、Step 2を全件再実行する。工程状態を示すworkflow mirrorの更新だけではcandidateとStep 2結果を失効させない。

物理iPhone試験は第6工程であり、それまでは`NOT_VERIFIED`とする。ゲーム本体コード修正も第5工程まで`NOT_STARTED`とする。

## 17. 承認済み実行順序

前提checkpoint: V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — `PASS`

1. 上記修正版を正本仕様へ固定 — `PASS`
2. 全100Fの購入・戦闘・夜明け・24時間放置シミュレーション — `NOT_STARTED`
3. 戦闘・増援・商業の3ビルドを各1,000パターン検証 — `NOT_STARTED`
4. 合格仕様を9画面の完成見本へ反映 — `NOT_STARTED`
5. 1〜10Fだけ実装 — `NOT_STARTED`。非物理端末の実装Acceptanceを対象とし、この時点ではGate CまたはPreview Readyを合格扱いにしない
6. 物理iPhoneで3分（180秒）ボス戦と10分（600秒）連続試験 — `NOT_STARTED`。同一commit・対象Vercel URLで物理端末要件を完了して初めてGate Cを判定できる

順序の入替え、後工程の先行実施、11F以降の実装は不可。動きの絵コンテ、アートバイブル、試験素材、保存設計、QA合格表は、対応する工程の受入条件と成果物へ統合する。

### 17.1 正本9画面

次表は人間向けの状態要約である。required stateの完全かつ順序付きの集合は`PROJECT_STATUS.json.canonicalScreens`だけを権威とし、表に省略されたstateも工程4の完成見本から削除しない。

| ID | 画面 | 同一画面に含める状態の要約 |
|---|---|---|
| `S01` | title / resume | 新規開始、保存再開、音、縦画面safe-area |
| `S02` | battle / follow | 1F tutorial、通常戦闘、複数敵、配送、戦闘復帰 |
| `S03` | tower browse | 制圧済み・現在・未見、地区rail、戦闘継続、virtualize |
| `S04` | floor clear / slot variant | KO、報酬、階段、商業階の空きslot・今決める／後で決める、支援階clear、猫救出clear |
| `S05` | shop reconfigure | 4候補、予測効果、配送、重複逓減、変更前比較 |
| `S06` | cat roster | 4匹の公開条件、進捗、編成、役割、一括level購入、生活preview |
| `S07` | upgrades / build / armament | 3build、3武装、予測TTK・生存・収益、推薦購入、敗北診断sheet |
| `S08` | F10 boss variant | 3形態HP、予告、撃破数、現在／最大HP、最大効果密度、対空判断 |
| `S09` | district result / Dawn | 10F結果、無料再配置、失う／残る／得る、3branch、前後比較、100F完了状態 |

S08はS02のボスvariantだが性能・可読性の完成見本として1画面を割り当てる。S09は地区結果、Dawn確認、100F完了を同一責務の状態として持ち、暗黙の10枚目を追加しない。

## 18. 完了報告で分離する状態

必ず次を別々に報告する。

- local `kimi` / commit
- GitHub `origin/kimi`（PRなし）
- Vercel Preview / Production
- deployment READY / runtime一致
- browser自動QA / 通常motion / 物理実機
- 保存移行 / PWA更新
- 1〜10F Preview Ready
- 100F Product Production Ready

HTTP 200、build成功、deployment READYだけでは完成判定にならない。
