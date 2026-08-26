# Cat's Tower — 完成判定と工程Gate

更新日: **2026-08-26**  
Repository: `2hg7trp7rv-design/cats_tower`  
書込みbranch: **既存の`kimi`のみ**  
現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**  
次の許可チャット: **`01_正本仕様・競合調査`**  
Step 2〜6: **BLOCKED**  
物理iPhone: **NOT_VERIFIED**

本書は、有限100F・非ガチャ設計に対する旧Gateを現行製品へ流用しないための完成判定正本である。旧Acceptance、旧PASS、旧workflow成功は履歴証拠として保持するが、現在の無制限塔・ガチャ・収益化設計を承認しない。

## 1. 現行製品境界

現行製品は、猫と猫人の4体編成を育成し、店舗・配送の支援を受けながら、プレイヤーから見て上限のない塔を登り、一つの強くてニューゲームで1Fから高速再攻略する放置インクリメンタルRPGである。

現在の必須境界には、少なくとも以下を含む。

- 100Fは終了地点ではなく最初の大型節目。101F以降も継続
- コインレベル無制限、100レベルごとのルビー進化
- `N < R < RR < SR < SSR < UR`
- キャラクターガチャと武器ガチャの分離
- 100回hard pity、200回featured保証の設計目標
- 初回入手で機能完成、20体分以上は任意の長期完全熟練
- 新規・月間・復帰ログイン、課金、リワード広告
- S01〜S12の12画面
- wallet、抽選、pity、取得、重複、進化、ログイン、広告、決済、権利のサーバー権威
- 最低15,000scenarioと別枠Monte Carlo・状態遷移検証

詳細は`MASTER_SPEC.md`、`PROJECT_STATUS.json`、active change-controlを参照する。

## 2. fail-closed規則

以下のどれかを現行工程・現行製品として案内する文書、candidate、schema、validator、workflowは、そのままでは合格証拠に使用できない。

- 1F〜100Fが最終商品
- 101F禁止
- 100Fが製品ending
- ガチャ・有償通貨・ログイン・広告禁止
- Dawnを独立したresetとして維持
- 9画面固定
- 3build×1,000seedの3,000scenarioだけで十分
- localStorageだけで恒久経済を管理
- 旧Step 1 PASSからStep 2開始を許可

過去証拠内の記述は削除しない。ただし、現行entry point、正本、状態mirror、実行入力として参照してはならない。

## 3. 必須の完成ループ

1. **期待定義** — 対象、利用者、比較対象、失敗条件、禁止事項、確認環境、証拠形式をAcceptanceへ固定
2. **制作** — 正本とAcceptanceに沿って成果物を作成
3. **実物自己検収** — ユーザーが見る大きさ、通常導線、通常速度で実物を確認
4. **専門監査** — コード、データ、経済、確率、台帳、privacy、性能、保存、移行を確認
5. **独立批評** — 完成を否定する目的でP0〜P3を付与
6. **修正** — 採用した指摘を直し、影響範囲を再検証
7. **回帰** — 既存の正しい契約、履歴証拠、runtime baselineを壊していないか確認
8. **証拠結合** — exact `kimi` commit、tree、deploymentへ結合
9. **最終判定** — G1〜G5と追加Gateがすべて合格した場合だけPASS

作成、ファイル存在、build、test、Vercel `READY`、決済sandbox応答は単独の完成条件ではない。

## 4. 五つの基本Gate

| Gate | 判定対象 | 最低証拠 |
|---|---|---|
| G1 要求適合 | 最新のユーザー決定、正本、禁止事項への適合 | 要求対照表、差分、未対応0 |
| G2 実物品質 | 最終成果物の欠落・仮物・破綻の有無 | 実物、全state、最終サイズ確認 |
| G3 人間期待 | 5秒理解、魅力、主役、次操作、失敗回復 | 独立UX批評、通常導線 |
| G4 比較・反証 | 強い競合、代替案、失敗仮説に耐えるか | 横比較、P0/P1=0 |
| G5 通常利用 | 起動、進行、失敗、復帰、保存、通信異常 | E2E、異常系、対象環境証拠 |

## 5. 追加Gate

### G6 正本・工程整合

- active change-control、`MASTER_SPEC.md`、`PROJECT_STATUS.json`、本書、`AGENTS.md`、handoverが同じ工程を示す
- 現行権威として残る旧有限100F・非ガチャ主張が0件
- 過去証拠は履歴として保持し、現行許可に使わない

### G7 経済・確率・長期進行

- 広告なしF2Pが本編、reset、必須進化を継続可能
- 初回入手、実用breakpoint、完全熟練を分離
- N・Rが長期的に死なず、URが全役割で無条件最強にならない
- pity、pickup、carryover、交換、overflow、返金後状態を検証
- 1〜10F、100F、1,000F、10,000F相当、複数resetを検証

### G8 サーバー・決済・広告・privacy

- paid/free ruby、ticket、draw、pity、取得、duplicate、evolution、login、ad、payment、entitlementがサーバー権威
- idempotency、retry、race、multi-tab、refund、revocation、restore、guest linkを検証
- 未成年者保護、同意、personalized ad、データ削除をrelease gateへ含める

### G9 mobile・物理端末

- 320×667、375×667、390×844を含む縦画面
- 主要tap領域、safe-area、誤操作、スクロール競合、100連後の密度
- 物理iPhone証拠なしに触覚、発熱、電池、実tap、PWA復帰をPASSにしない

## 6. 現在のStep 1 Gate

Step 1は次をすべて満たした場合だけPASSにできる。

- repository-wide contradiction inventory完成
- 下位正本、入口文書、状態mirrorの統合
- S01〜S12とrequired stateの固定
- stable ID、migration alias、状態遷移、backend trust boundaryの固定
- Step 2 dependency closure完成
- 競合・platform policy・privacy・未成年者保護の調査記録
- 独立批評の未解決P0/P1が0
- exact commit/tree-bound Step 1 seal

現在は上記を満たしていないため、Step 1全体は`IN_PROGRESS`である。

## 7. Step 2以降

1. **Step 2** — 新しいcandidate、schema、validator、simulator、result contractを実行可能化
2. **Step 3** — 3build×5persona×各1,000seed以上と別枠Monte Carlo
3. **Step 4** — S01〜S12の完成見本と全正常・異常state
4. **Step 5** — 1〜10Fと必要backendの実装
5. **Step 6** — physical iPhone、billing、広告、PWA、長時間試験

前工程のPASS前に後工程へ進まない。

## 8. 三役分離

- **Creator** — Acceptanceに沿って作る
- **Independent critic** — 完成を前提にせず拒否理由を探す
- **Final judge** — 努力を無視し、証拠だけで判定する

重大な収益化成果物では、製品・UX、経済・確率、backend・不正、platform policy・privacy、mobile密度の批評を分離する。未解決P0またはP1が一つでもあればPASS禁止。

## 9. 状態語

- `NOT_STARTED` — 未着手
- `PENDING_REVALIDATION` — 旧成果物は存在するが現行製品では未判定
- `IN_PROGRESS` — 制作・再構成中。完成報告禁止
- `BLOCKED` — 制作側だけでは解消不能
- `PASS` — 適用Gateすべて合格

ユーザーが品質を否認した範囲は、以前のPASSを守らず即`IN_PROGRESS`へ戻す。

## 10. 報告

報告にはrepository、branch、content commit、evidence commit、tree、deployment、工程、判定、P0/P1、変更範囲、対象外、Production変更、物理iPhone状態を含める。未完成を完成したように表現しない。
