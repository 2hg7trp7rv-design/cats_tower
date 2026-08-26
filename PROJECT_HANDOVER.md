# Cat's Tower 引き継ぎ書

更新日: **2026-08-26**  
Repository: `2hg7trp7rv-design/cats_tower`  
Canonical / writable branch: **既存の`kimi`のみ**  
現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**  
次の許可チャット: **`01_正本仕様・競合調査`**  
Step 2〜6: **BLOCKED**  
物理iPhone: **NOT_VERIFIED**

## 1. 最初に理解する結論

有限100F・非ガチャ設計は現行製品ではない。

現在のCat's Towerは、猫と猫人の4体編成を育成し、店舗・配送の支援を受けながら、プレイヤーから見て上限のない塔を登り、一つのstrong new gameで1Fから前回より速く再攻略する放置インクリメンタルRPGである。

100Fは最初の大型節目であり、101F以降も継続する。character/weapon gacha、ruby evolution、duplicate mastery、login、payment、rewarded ads、S01〜S12、server-owned permanent economyを持つ。

## 2. 旧PASSの扱い

2026年8月25日までの有限100F・公開条件のみの猫解放・Dawn・9画面・3,000scenario設計に対する旧PASSは、Git履歴上の不変な証拠として保持する。

ただし、旧PASSは次を許可しない。

- 現在のStep 1 PASS
- Step 2 simulation開始
- S01〜S12 mockup開始
- runtime/backend実装
- Preview Ready / Product Ready

## 3. 00で完了したこと

### 3.1 Project source完全置換

- active: `CHATGPT_PROJECT_INSTRUCTIONS1.md`
- deleted from live `kimi`: `CHATGPT_PROJECT_INSTRUCTIONS.md`
- old/new同時有効化: 禁止

### 3.2 中核権威同期

次の3ファイルは現行製品境界へ同期済み。

- `MASTER_SPEC.md`
- `PROJECT_STATUS.json`
- `quality-reviews/step-1-canonical-design/active-change-control.json`

中核同期の証拠:

- `quality-reviews/step-1-hero-merchant-large-idle-integration/core-authority-sync-evidence-round-006.json`

### 3.3 live entry point止血

旧製品を現行として案内していた入口文書を、現行工程へ同期またはfail-closed化した。

- `QUALITY_GATE.md`
- `AGENTS.md`
- `README.md`
- `PROJECT_HANDOVER.md`
- `CHATGPT_PROJECT_BOOTSTRAP.md`
- `CUSTOM_GPT_CONFIGURATION.md`
- `FLOORS_1_10_DESIGN.md`
- `simulation/INPUT_CONTRACT.md`
- `simulation/CURRENT_STATUS.json`
- `.github/workflows/CURRENT_STATUS.md`

`FLOORS_1_10_DESIGN.md`は完全設計PASSではなく`PENDING_REVALIDATION`へ戻した。旧詳細はGit履歴に保持される。

旧candidate/schema/validator/simulator/workflow YAML自体は、00で新仕様へ作り替えていない。代わりに現行製品の入力・許可として使用できないことをfail-closedで固定した。

## 4. 現行製品の主要決定

- playable: cat / catfolk
- active named party: 4
- merchant mechanics: shop、income、delivery、recruitment、reinvestment。merchant-chairman identityは削除
- tower: player-visible maximumなし
- Floor 100: first major milestone, not ending
- reset: one original system, restart Floor 1, old Dawn merged/renamed/removed
- level: coin level capなし
- evolution: every 100 levels, ruby required, leveling not blocked
- rarity: `N < R < RR < SR < SSR < UR`
- catalog target: 24 characters / 36 weapons / one weapon per active character
- gacha: character and weapon separated
- pity target: hard 100 / featured 200 / compatible carryover
- duplicate mastery: first copy functional, 20-plus effective copies for optional full mastery
- first-day guarantee: SSR character 1 / SR-or-better weapon 1
- no-ad F2P featured UR target: 30〜45日
- ads: rewarded opt-in only initially
- initial deferred: forced ads、banner ads、PvP、competitive rewards、guild competition、battle pass
- screens: S01〜S12
- permanent economy: server authority
- later validation: minimum 15,000 scenarios plus separate Monte Carlo

## 5. 現在の正本順序

1. ユーザーの最新明示決定
2. `CHATGPT_PROJECT_INSTRUCTIONS1.md`
3. active change-control、addendum、decision lock
4. `MASTER_SPEC.md`
5. `PROJECT_STATUS.json`、`QUALITY_GATE.md`、`AGENTS.md`
6. 下位正本、handover、README、bootstrap
7. Step 2 executable contract
8. legacy baseline、過去PASS、参考資料

同一scopeで競合した場合は後工程を停止し、同じ変更管理で解消する。

## 6. 01で残る必須作業

00のentry point同期は、Step 1全体の再封印ではない。01で次を完了する。

- repository-wide contradiction inventory
- 下位正本と状態mirrorのredline
- `FLOORS_1_10_DESIGN.md`の完全再設計
- S01〜S12のrequired state
- stable ID、migration alias、状態遷移
- unbounded tower、大数、reset、ruby、evolution、rarity、gacha、masteryの意味契約
- account、wallet、draw、pity、payment、login、ad、entitlementのbackend trust boundary
- 競合調査、Apple/Google、日本国内rules、privacy、未成年者保護
- candidate/schema/validator/simulator/workflowへのStep 2 dependency closure
- 独立批評のP0/P1解消
- exact commit/tree-bound new Step 1 seal

## 7. simulationとworkflowの現在状態

`simulation/candidate-v1.json`、旧schema、旧validator、旧simulator、旧holdout、旧workflowは歴史的入力である。

- current product promotionに使用: 禁止
- Step 2開始に使用: 禁止
- old holdout reuse: 禁止
- old workflow successからcurrent PASS: 禁止
- new candidateId/schema/algorithm: Step 2で必須

参照:

- `simulation/INPUT_CONTRACT.md`
- `simulation/CURRENT_STATUS.json`
- `.github/workflows/CURRENT_STATUS.md`

## 8. write boundary

現在許可されるのは、Step 1の正本・調査・状態・依存契約・品質証拠である。

現在未許可:

- candidate/schema/validator/simulatorの新実装
- runtime/asset/backendの実装
- payment provider / ad network設定
- Production alias変更
- Step 2以降の実行

## 9. 次の開始条件

`01_正本仕様・競合調査`は、live `kimi`の最新HEAD/treeを再取得し、Acceptance Matrixとrepository-wide contradiction inventoryから開始する。

00完了時のexact content/evidence commitとtreeは、次の証拠ファイルを唯一の参照とする。

- `quality-reviews/step-1-hero-merchant-large-idle-integration/entrypoint-containment-evidence-round-007.json`

Vercel `READY`は文書deploymentの成功だけを意味し、ゲーム品質やStep 1 PASSを意味しない。
