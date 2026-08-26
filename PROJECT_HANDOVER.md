# Cat's Tower 引き継ぎ書

更新日: **2026-08-27**  
Repository: `2hg7trp7rv-design/cats_tower`  
Canonical / writable branch: **既存の`kimi`のみ**  
現在工程: **Step 1 正本統合・再封印 — IN_PROGRESS**  
現在checkpoint: **Round 008 Route 01-0 governance recovery**  
次の許可チャット: **`01_正本仕様・競合調査`の継続**  
Step 2〜6: **BLOCKED**  
物理iPhone: **NOT_VERIFIED**

## 1. 現在の結論

00 Round 006の中核権威同期とRound 007のlive entrypoint containmentは、当時のscopeに限る`SCOPED_PASS`として有効である。00をやり直したり、`6d7724f1f71fa99d0e9b119ef437ebb902187858`以前へrollbackしたりしない。

その後の部分的な01作業で`MASTER_SPEC.md`と3つの`canonical/*`が追加・更新されたが、status mirror、dependency closure、policy gate、独立批評、sealが揃う前にPASS／02導線が記載された。Route 01-0はこのgovernance driftを修復する。

## 2. Route 01-0の変更

- `MASTER_SPEC.md`をStep 1 `IN_PROGRESS`へ戻す。
- `PROJECT_STATUS.json`を`01_正本仕様・競合調査`進行中へ同期する。
- 3つの`canonical/*`を`PRESEAL_DRAFT`へ明示的に降格する。
- 未作成のStep 2 closure、policy gate、sealを存在済み正本として扱わない。
- `AI_PROJECT_POLICY.json`の情報源順位をProject sourceとactive change-control優先へ修正する。
- draft PR #8をstale external non-authorityとしてrepository内に記録し、更新・close・mergeは行わない。
- Acceptance、00 postcheck、外部stale artifact記録をRound 008 evidence directoryへ置く。

exact content commit、tree、Vercel Previewは、このcontent commitの直接子に置く`quality-reviews/step-1-reseal-round-008/checkpoint-a-evidence.json`で記録する。

## 3. 現在の正本候補

- `MASTER_SPEC.md` — `PRESEAL_DRAFT`
- `canonical/STABLE_ID_REGISTRY.json` — `PRESEAL_DRAFT`
- `canonical/SCREEN_STATE_REGISTRY.json` — `PRESEAL_DRAFT`
- `canonical/STATE_TRANSITION_CONTRACT.json` — `PRESEAL_DRAFT`
- `FLOORS_1_10_DESIGN.md` — `PENDING_REVALIDATION`
- `canonical/STEP2_DEPENDENCY_CLOSURE.json` — `PLANNED_NOT_CREATED`
- `canonical/POLICY_RELEASE_GATES.json` — `PLANNED_NOT_CREATED`
- `quality-reviews/step-1-reseal-round-008/seal-round-008.json` — `NOT_CREATED`

## 4. 禁止範囲

Route 01-0ではruntime、asset、V1 candidate、schema、validator、simulator、backend、payment provider、ad network、Production aliasを変更しない。Vercel `READY`はdocumentation deploymentだけを意味する。

## 5. 次の作業

Route 01-0のevidenceが成立した後、同じ`01_正本仕様・競合調査`でRoute 01-1へ進む。

1. Acceptance Matrixをrepository全体scopeへ拡張
2. full treeのcontradiction inventory
3. current authority／mirror／Step 2移行／runtime gap／history／false positiveの分類
4. 未分類0、current-authority contradictionの修正計画
5. Route 01-2の競合・platform・日本国内policy調査へ接続

新Step 1 sealがlive `kimi`に存在し、P0/P1=0とexact commit/tree/deployment bindingを満たすまでStep 2を開始しない。
