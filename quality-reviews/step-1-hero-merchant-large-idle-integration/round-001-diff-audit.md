# Step 1 差分監査 Round 001 — 勇者×商人・大型放置ゲーム統合

文書状態: **IN_PROGRESS**

監査日: 2026-08-26  
Repository: `2hg7trp7rv-design/cats_tower`  
Branch: `kimi`  
監査基準commit: `49f9414524e320d08a2b4515506504d82138205f`  
監査基準tree: `d2a213fb1c88b409e4d1b1eadf217dd89b2ca562`  
旧Step 1完成証拠: `quality-reviews/step-1-canonical-design/acceptance-round-005.json`

## 1. 結論

今回の提案は、既存正本へそのまま「機能を足す」案件ではない。現正本はすでに次を備えている。

- 100Fの大型放置進行
- 戦闘・増援・商業の3ビルド
- 制圧階の店舗と配送が前線を支援する商人ループ
- 戦う猫、公開条件の猫救出、塔内生活
- 10Fごとの地区ボスとDawn周回
- 9画面へ責務を圧縮したスマホ縦画面設計

したがって価値がある差分は、機能総量ではなく、**「勇者として冒険する手応え」と「商人として戦況を作る手応えを、同じ猫の塔ループで明確にすること」**である。

一方、添付案のガチャ、装備在庫、ランダム追加効果、プレミアム通貨、時間短縮、日課、ログインボーナス、シーズン、ランキング、別建て王国復興は、現正本の禁止事項または現行6工程の範囲と衝突する。これらを採用すると大型化ではなく、焦点の分裂、経済の不透明化、画面過密、コンテンツ制作量の暴騰を起こす。

**Round 001判定は`IN_PROGRESS`。Step 2への進行は禁止する。**

## 2. 中核統合案

### 2.1 推奨する一文

> プレイヤーは猫の冒険商会を率い、戦う猫たちを派遣し、制圧した塔内店舗と配送網を運営して、100Fを取り戻す大型放置RPG。

この一文なら、次を同時に満たす。

- **勇者性**: 名前付き猫が冒険者・戦士として走り、接敵し、攻略する。
- **商人性**: プレイヤーは冒険商会長として、店舗、配送、編成、武装、資源配分を決める。
- **Cat's Tower固有性**: 人間勇者や別王国を追加せず、猫と塔が主役のまま残る。
- **放置性**: 基本進行は自動、能動操作は構成判断と一時最適化に限定できる。

### 2.2 否定検証

「人間の勇者を追加した方が勇者商人を分かりやすくできる」という反論は成立する。しかし、その案は猫を補助役へ落とし、既存の呼び鈴、猫救出、猫部屋、生活する塔、12匹上限の正本を大規模に壊す。別主人公を追加する費用に対し、得られるのは一般的なファンタジーRPGらしさであり、Cat's Tower固有性は弱くなる。

よって、現時点の最適解は **「プレイヤー＝冒険商会長」「猫＝可視化された勇者・冒険者」** である。これは最終PASSではなく、正本redlineの第一候補とする。

## 3. 添付20画像の扱い

添付画像は、完成見本ではなく以下の監査入力として扱った。

- 10種類のゲーム画面コンセプト
- 各コンセプトの狙い・機能を説明する10枚の記述スクリーンショット

画像自体はrepositoryへ移していない。出典・利用許諾・最終採用が未確定であり、現段階でproduction assetまたはStep 4完成見本とみなす根拠がないためである。

## 4. 差分判定表

| 提案領域 | 判定 | 既存正本との関係 | 統合規則 |
|---|---|---|---|
| 勇者×商人の明示 | **採用候補** | 現正本の戦闘・商業ループを言語化できる | プレイヤーを冒険商会長、猫を可視戦闘主体とする |
| 戦闘とショップを同時に見せる主画面 | **変換採用** | 配送の因果可視化と一致するが、常時二分割は過密 | S02は戦闘主体。配送・店舗支援は小さな状態表示と実物到着で示す |
| 冒険ロビー | **統合** | 独立画面にすると10枚目になる | S01のresume状態またはS09の次回出発状態へ吸収 |
| 5人編成・役割相性 | **変換採用** | S06と役割設計に近い | 第1地区4匹＋一時増援3役を維持。40人収集へ拡張しない |
| 100F攻略マップ | **変換採用** | 100F目標の把握には有効。node mapは連続塔と衝突 | S03の地区圧縮overviewとして使用し、床単位の連続塔を置換しない |
| 10Fごとのボス・break・phase | **採用候補** | 現10F三形態bossと強く整合 | breakは既存telegraph・形態・相性表示を補強する場合のみ導入 |
| 商会支店・生産・連携 | **変換採用** | 商業buildとショップ配置に近い | 自動稼働、決定論、配送可視化、配置・level・隣接に限定 |
| 在庫、補充、個別timer、全回収 | **不採用** | 店舗再開・個別回収禁止と衝突 | 放置中も自動稼働。回収操作を進行条件にしない |
| 冒険者紹介所、10連、天井 | **不採用** | gacha禁止と直接衝突 | 猫は公開条件、確定救出、物語進行で解放 |
| レアリティ星・重複欠片 | **不採用** | 収集経済と第三通貨を生む | 固有猫の役割・習熟・公開tierへ置換する場合のみ再検討 |
| 鍛冶工房 | **変換採用** | S07の塔共通武装3系統と整合可能 | 1系統のみ装着、確定tier、予測TTK・生存差を表示 |
| 装備在庫、ランダム追加効果、分解 | **不採用** | random-stat equipment禁止と衝突 | item inventoryを作らない |
| 王国復興広場 | **変換または延期** | 塔内生活の視覚復興とは親和。別町経済は衝突 | 制圧階・地区の復興演出へ統合。別建てtown metaは現行範囲外 |
| 放置帰還summary | **採用候補** | 24時間放置・停止理由表示と整合 | S01 resumeまたはS09結果variantへ吸収 |
| デイリー、ログボ、season、ranking | **不採用** | core completion前のlive-ops禁止と衝突 | Gate F後も別Acceptanceとユーザー承認が必要 |
| coin＋gem＋reputation等の多通貨 | **不採用** | spendable currency 2種契約と衝突 | coin＋Dawn shardのみ。評判は非消費の進捗表示なら可 |
| premium timer acceleration | **不採用** | 公平性、放置式、検証再現性を破壊 | 時間短縮課金を現在のcoreへ入れない |
| 5本の常設bottom navigation | **不採用寄りの再設計** | 9画面の責務は覆えるが、常時5系統はiPhoneで競合 | 戦闘、塔、管理の3つ以下の主要遷移へ圧縮し、状態別に必要操作だけ出す |
| 大量サイドボタン・通知badge | **不採用** | 5秒理解とsafe-areaを悪化 | 現在の目標、次操作、報酬、敗因に直結するものだけ表示 |
| 催事・social拡張 | **延期** | 長期運営候補ではあるが現行6工程外 | 100F product ready後に新Acceptanceで判断 |

## 5. 9画面への責務統合

| 添付案の責務 | 統合先 | 新規screenを作らない理由 |
|---|---|---|
| 冒険開始・再開・放置帰還 | `S01 title / resume` | 起動時判断として同一責務 |
| 自動戦闘＋配送・商業支援 | `S02 battle / follow` | 戦況理解に必要な最小状態だけ表示 |
| 100F地図・地区進捗 | `S03 tower browse` | 連続塔の圧縮表示variant |
| 勝利報酬・空き店舗 | `S04 floor clear / shop slot` | 制圧直後の次判断 |
| 商会支店・店舗配置・連携 | `S05 shop reconfigure` | 詳細管理を戦闘面から分離 |
| 仲間・編成・役割 | `S06 cat roster` | 猫の解放・編成・成長を集約 |
| 鍛冶・build・武装・敗北診断 | `S07 upgrades / build / armament` | 強化判断を一箇所へ統合 |
| boss phase・break・最大効果密度 | `S08 F10 boss` | 通常戦闘のboss variant |
| 地区復興・Dawn・次遠征 | `S09 district result / Dawn` | 地区単位の完了・再出発判断 |

この割当で責務は覆える。したがって、現段階で第10画面を追加する合理性はない。

## 6. 経済・放置の監査

### 維持する正本

- 今周coin: 猫、店舗、増援、今周強化に使う。
- Dawn shard: 新しい最高到達・一度限りreward IDから得る恒久通貨。
- blueprint、地区章、実績、評判、復興率: 非消費のflagまたはprogress。
- 放置上限24時間。
- 初周放置では未見boss、猫解放、店舗選択、遺物選択、Dawnを自動確定しない。
- 店舗は再開tap、個別回収、広告を要求しない。

### 添付案から採用しないもの

- premium gem
- stamina/energy
- 生産枠の時間短縮
- 在庫上限を解消する頻繁な回収
- daily/season通貨
- duplicate shard
- 装備分解素材の多層通貨

理由は単純で、これらは機能量を増やすが、100F攻略の因果を薄め、Step 2の決定論的simulationを複雑にし、初期プロダクトの検証可能性を下げる。

## 7. UI密度監査

添付案は視覚的には完成度が高い。しかしスマホ縦画面で同時に扱っている情報が多い。

- 上部にplayer level、複数通貨、設定
- 左右に複数の機能button
- 中央に戦闘
- 下半分に店舗管理
- 最下部に5tab
- 通知badge、timer、event導線

この構造をそのまま採用すると、主役、現在地、次操作、報酬を5秒で理解する条件を落とす可能性が高い。また、戦闘中に必要なtap領域、Dynamic Island、ホームインジケータ、Safari chromeの余白を圧迫する。

統合時は次を固定する。

1. 戦闘中の主役は猫と敵。
2. 主要操作は呼び鈴または現在の戦術判断の一つ。
3. 商業は「支援がどこから来て何を変えたか」を短く見せる。
4. 詳細管理はS05/S07へ送る。
5. 常設bottom navigationは3根以下を第一候補とする。
6. 未解放、催事、ランキングのbadgeを初期画面へ並べない。

## 8. 直接影響する正本・機械契約

### 直接redline対象

- `MASTER_SPEC.md`
  - 一文説明
  - player role
  - hero/merchant dual fantasy
  - world boundary
  - forbidden systems
  - navigation and screen responsibilities
- `FLOORS_1_10_DESIGN.md`
  - first-session wording
  - S01/S02/S03/S05/S06/S07/S09 states
  - district restoration presentation
- `PROJECT_STATUS.json`
  - approvedRequirements.oneLine
  - active Step 1 status and next action
  - canonical screen summaries if state responsibility changes
- `QUALITY_GATE.md`
  - active integration revalidation state
- `PROJECT_HANDOVER.md`
  - exact commit, unresolved items, next authorized phase

### 条件付きで更新する機械契約

以下は、redlineで実行意味が変わる場合だけ更新する。

- `simulation/candidate-v1.json`
- `simulation/candidate.schema.json`
- `simulation/validate-candidate.mjs`
- `simulation/INPUT_CONTRACT.md`
- `PROJECT_STATUS.json.canonicalScreens`
- `PROJECT_STATUS.json.stableIdRegistry`
- `PROJECT_STATUS.json.stableIdMigrationAliases`

画面上の名称変更だけでcandidateを無意味に変更してはならない。逆に、shop state、resource flow、build effect、offline rule、Dawn rule、armament ruleが変わるなら、文書だけ変えてcandidateを据え置くことも禁止する。

## 9. 重大リスク

| 重大度 | リスク | 現在判定 | 閉じ方 |
|---|---|---|---|
| P1 | `PROJECT_STATUS.json`と旧Round 5はStep 2進行可能を示すが、新しい意味変更が開始された | 未解決 | active change controlを全workflow mirrorへ反映 |
| P1 | 勇者を別主人公として追加すると猫主役が崩れる | 暫定解あり | player-role contractを正本へ固定し独立批評 |
| P1 | battle＋merchant dashboard常設で画面が過密化する | 暫定解あり | S02/S05/S07へ責務分割し390×844/320×667で比較 |
| P1 | 多通貨・ガチャ・装備・live-opsを「大型」の条件として混入させる | 不採用方針 | canonical exclusionsへ明記しrepository検索 |
| P1 | 100F node mapが連続塔を置換する | 暫定解あり | S03 overview variantに限定 |
| P2 | 商業buildが最適解になり、戦闘・増援buildを駆逐する | 未検証 | 新Step 1 seal後のStep 2/3 simulation |
| P2 | 復興演出が別town metaへ膨張する | 暫定解あり | tower district restorationに限定 |
| P2 | 「勇者商人」の名称だけ追加し、実際の判断が変わらない | 未解決 | first-five-minute decision sequenceを再設計 |

P0は現時点で0件。ただしP1が残っているためPASSは禁止する。

## 10. 外部比較の位置づけ

2026-08-26時点で次を再確認した。

- GameAnalyticsの2026 benchmark: 初期価値、短session、継続の弱さを比較材料にする。
- Apple Game Controls: safe area、親指到達、主要controlの寸法、不要controlを隠す原則を使う。
- 商人サーガの現行ストア説明: 仲間雇用、店舗、武器・道具、魔王城攻略という抽象ループを確認する。
- Tap Titans 2の公式prestige説明: 高い到達ほど恒久報酬が増え、再攻略が速くなる構造を比較する。

参照URL:

- https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks
- https://developer.apple.com/design/human-interface-guidelines/game-controls
- https://apps.apple.com/jp/app/id1198096385
- https://play.google.com/store/apps/details?id=com.cyberxgames.akindosaga
- https://gamehive.helpshift.com/hc/en/3-tap-titans-2/faq/75-should-i-prestige-when/

これらは設計原則の参考であり、Cat's Towerの係数、継続率、収益性、画面構成を証明しない。広告、課金、live-opsを含む他作品の現在機能も、自動的な採用根拠にはならない。

## 11. Round 001で変更しないもの

- runtime code
- `assets/`
- service worker
- Vercel設定・deployment・production alias
- `simulation/candidate-v1.json`
- schema・validator
- stable ID registry
- 旧Round 5証拠
- branch構成

このroundは差分の分類と進行停止を固定する文書監査であり、正本統合の完了ではない。

## 12. 次の許可工程

次に許可するのは、Step 1内の以下だけである。

1. 一文説明、player role、hero/cat boundaryのredline
2. S01-S09への機能責務の正式割当
3. economy、shop、armament、restoration、offlineの採否境界
4. candidate/schema/validatorへの意味影響一覧
5. workflow mirrorの`IN_PROGRESS`統一
6. product、economy、mobile UIの独立3批評
7. 指摘修正後の新Step 1封印

上記がPASSするまで、100F simulation、3×1,000検証、完成見本、実装、Vercel、物理iPhone試験へ進まない。
