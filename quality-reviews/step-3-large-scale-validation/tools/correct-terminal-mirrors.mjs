#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const ENTRY = '3eefbf6fa7dfcec8b5b093612e8946b43d838bc2';
const ACTIVE = 'quality-reviews/step-1-canonical-design/active-change-control.json';
const ROUND16 = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-016.json';
const LIVE = `${STEP3}/live-readback.json`;
const COMPLETION = `${STEP3}/completion-evidence.json`;
const FINAL = `${STEP3}/final-judge.json`;
const CRITIC_SUMMARY = `${STEP3}/critic-summary.json`;
const CORRECTION = `${STEP3}/terminal-mirror-correction.json`;

const EXPECTED = {
  [LIVE]: 'd0b73af25a8f0d449cfc083b007b84b8ff3fbc9b',
  [COMPLETION]: 'bc808fc3129f81000f1c5e755ffb2fc3a05bcf0b',
  [FINAL]: 'a089266f56076a0b2a59b2670188d95ae8eff3d2',
  [CRITIC_SUMMARY]: '197f2a0949a8f6eb398f9614f79ab79562471fb2',
  'quality-reviews/step-1-reseal-round-008/seal-round-008.json': '0a959de0383b57ad6cd1f33c124b398aa51c1e00',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
  'quality-reviews/step-2-governance-repair-round-001/live-readback.json': '692434fafd19d1e5470fe58808fd72af7286ec35',
};

const MIRRORS = [
  ACTIVE,
  ROUND16,
  'AI_PROJECT_POLICY.json',
  'PROJECT_STATUS.json',
  'simulation/CURRENT_STATUS.json',
  'QUALITY_GATE.md',
  '.github/workflows/CURRENT_STATUS.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'README.md',
  'CHATGPT_PROJECT_BOOTSTRAP.md',
  'CUSTOM_GPT_CONFIGURATION.md',
  'simulation/INPUT_CONTRACT.md',
];

const TEXT_MIRRORS = [
  'QUALITY_GATE.md',
  '.github/workflows/CURRENT_STATUS.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'README.md',
  'CHATGPT_PROJECT_BOOTSTRAP.md',
  'CUSTOM_GPT_CONFIGURATION.md',
  'simulation/INPUT_CONTRACT.md',
];

const STALE_MARKERS = [
  'Step 2: **READY_TO_START**',
  'Step 3: **IN_PROGRESS**',
  'Step 3: `READY_TO_START`',
  'Current: **Step 3 — IN_PROGRESS**',
  '現在工程: **Step 3 — IN_PROGRESS**',
  'Status: **STEP 2 READY_TO_START',
  '`02_無制限塔・経済・リセットシミュレーション`',
  'Allowed next: Step 3 large-scale validation artifacts and evidence only.',
  '## Step 3で必須の検証',
  'STEP 3実測待ち',
  'GOVERNANCE REPAIR IN PROGRESS',
];

const abs = (relativePath) => path.join(ROOT, relativePath);
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const writeText = (relativePath, value) => writeFileSync(abs(relativePath), `${value.replace(/[ \t]+$/gm, '').trim()}\n`, 'utf8');
const writeJson = (relativePath, value) => writeFileSync(abs(relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);
const workingBlob = (relativePath) => {
  const body = Buffer.from(readFileSync(abs(relativePath)));
  return createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
};
const isoNow = () => new Date().toISOString();

function requireFile(relativePath) {
  assert(existsSync(abs(relativePath)), `${relativePath}: missing`);
}

function verifyAuthority() {
  assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
  assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(git('replace', '-l'), '');
  execFileSync('git', ['merge-base', '--is-ancestor', ENTRY, 'HEAD'], { cwd: ROOT });
  for (const [relativePath, expectedBlob] of Object.entries(EXPECTED)) {
    requireFile(relativePath);
    assert.equal(gitBlob(relativePath), expectedBlob, `${relativePath}: immutable authority blob mismatch`);
  }
  const live = readJson(LIVE);
  const finalJudge = readJson(FINAL);
  const summary = readJson(CRITIC_SUMMARY);
  assert.equal(live.verdict, 'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION');
  assert.equal(live.governanceDecision.step3, 'PASS');
  assert.equal(live.governanceDecision.step4, 'READY_TO_START');
  assert.equal(finalJudge.step3Pass, true);
  assert.equal(summary.criticCount, 5);
  assert.equal(summary.unresolvedP0, 0);
  assert.equal(summary.unresolvedP1, 0);
  assert.equal(live.scopeReadback.productionAliasChanged, false);
  assert.equal(live.scopeReadback.physicalIPhoneVerified, false);
  assert.equal(live.scopeReadback.holdoutUsedForTuning, false);
  return { live, finalJudge, summary };
}

function gateBlock() {
  return `<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->
## 現在の正式Gate

- Step 1: **PASS**
- Step 2: **PASS / SEALED**
- Step 3: **PASS**
- Step 4: **READY_TO_START**
- Balance verdict: **PASS_STEP3_LARGE_SCALE_VALIDATION**
- Physical iPhone: **NOT_VERIFIED**
- Production alias changed: **false**
<!-- CATS_TOWER_STEP3_STATUS_END -->`;
}

function qualityGateDocument() {
  return `${gateBlock()}

# Cat's Tower — 完成判定と工程Gate

更新日: **2026-08-28**

現在工程: **Step 3 — PASS / LARGE_SCALE_VALIDATION_COMPLETE**

次工程: **Step 4 — READY_TO_START**

Step 5〜6: **BLOCKED BY PRIOR GATES**

物理iPhone: **NOT_VERIFIED**

Production変更: **なし**

## G1 正本・branch — PASS

- Repository: \`2hg7trp7rv-design/cats_tower\`
- 書込み可能branch: 既存の\`kimi\`のみ
- branch作成・PR・merge・rebase・cherry-pick・force-pushは禁止
- Step 1 Round 008 sealとStep 2 executable sealは不変

## G2 Step 2 executable contract — PASS / SEALED

- executable seal: \`simulation/executable-seal-v2.json\`
- seal blob: \`ee3507969c03b08fe27350263cf0bc093a1c18e1\`
- dedicated CI run/job: \`33104391753\` / \`98630217077\` — \`SUCCESS\`
- Step 2 critics: \`5\`、unresolved P0/P1: \`0 / 0\`
- 30件qualificationは実行契約の確認であり、Step 3以前のbalance PASSではない

## G3 Step 3 large-scale validation — PASS

- gameplay calibration: \`12,000\`
- unseen holdout: \`3,000\`
- gameplay total: \`15,000\`
- high-volume total: \`1,700,000\`
- independent critics: \`5\`
- unresolved P0/P1: \`0 / 0\`
- final judge: \`PASS_STEP3_CONTENT_PENDING_COMPLETION_AND_LIVE_READBACK\`
- completion evidence: \`quality-reviews/step-3-large-scale-validation/completion-evidence.json\`
- terminal read-back: \`quality-reviews/step-3-large-scale-validation/live-readback.json\`
- terminal verdict: \`PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION\`
- holdout tuning reuse: \`false\`
- candidate mutation: \`false\`

## G4 実測結果 — PASS

- first reset: min \`20\` / p50 \`24\` / p90 \`27\` / p99 \`29\` / max \`29\` minutes
- no-ad F2P: featured guarantee day \`40\`、combined daily draws \`44\`
- repeated-reset violations: \`0\`
- first-evolution uncovered scenarios: \`0\`
- build-spread violations: \`0\`
- gacha/pity boundary violations: \`0\`
- refund free-ledger debit violations: \`0\`
- state-machine unexpected accept/reject: \`0 / 0\`
- large-number canonical ID/background/modifier violations: \`0\`

## G5 Step 4 gate — READY_TO_START

Step 4は12画面完成見本を作る工程である。Step 3 PASSは、runtime、backend、課金provider、広告network、Production、物理iPhoneが完成したことを意味しない。

Step 4で最低限、S01〜S12、320×667、375×667、390×844、safe area、large text、reduced motion、情報階層、視認性、操作導線を完成見本として固定する。

## G6 後工程の未完了境界

- runtime / assets: 現行再設計版として未実装
- backend / payment / ads: 未実装
- Production alias: 未変更
- physical iPhone: 未検証
- release policy / privacy / minors / receipt / webhook: 後工程Gate

## G7 Evidence authority

最新のcurrent-state authorityは、Step 3 terminal read-backとpost-terminal mirror correctionである。旧Step 2 READY、Step 3未実行、旧Round 7 current markerは履歴以外の認可に使わない。`;
}

function workflowStatusDocument() {
  return `${gateBlock()}

# Cat's Tower workflow status

Updated: **2026-08-28**

## Current verdict

- Step 1 Round 008: \`PASS\`
- Step 2: \`PASS — SEALED\`
- Step 3: \`PASS — LARGE_SCALE_VALIDATION_COMPLETE\`
- Step 4: \`READY_TO_START\`
- Step 5〜6: \`BLOCKED BY PRIOR GATES\`
- balance verdict: \`PASS_STEP3_LARGE_SCALE_VALIDATION\`
- physical iPhone: \`NOT_VERIFIED\`
- Production change: \`false\`

## Current workflow evidence

- Step 3 execution workflow: \`33143714589\` / job \`98760057075\` — \`SUCCESS\`
- exact-head Step 3 terminal verifier: \`33144127951\` / job \`98761329925\` — \`SUCCESS\`
- exact-head repository governance: \`33144127913\`
  - \`current-governance\`: \`SUCCESS\`
  - \`historical-round7-evidence\`: \`SUCCESS\`

## Responsibility split

- historical Round 7 validation runs only against immutable historical worktrees
- current governance validates Round 008, Step 2 seal, Step 3 terminal evidence and live mirrors
- Step 2 executable verifier is rerun on the checked-out commit
- obsolete current-state markers may not be restored to satisfy historical assertions

## Current execution boundary

Allowed next:

- Step 4 twelve-screen final mockups

Forbidden until later gates:

- runtime
- assets
- backend
- payment provider
- ad network
- Production alias
- physical-iPhone PASS claim`;
}

function agentsDocument() {
  return `${gateBlock()}

# Cat's Tower repository instructions

更新日: **2026-08-28**
Repository: \`2hg7trp7rv-design/cats_tower\`
書込みbranch: **既存の\`kimi\`のみ**

## Branch hard lock

- 書込みは既存\`kimi\`のみ。毎回live HEAD/treeを取得する。
- branch作成・切替・書込み・削除、PR、merge、rebase、cherry-pick、force-pushは禁止。
- Production alias、課金商品公開、広告network有効化、data deletionは明示承認なしに実行しない。

## Authority order

1. 最新のユーザー明示決定
2. \`CHATGPT_PROJECT_INSTRUCTIONS1.md\`
3. active change-controlと最新addendum
4. Step 1 Round 008 seal
5. Step 2 executable sealとcompletion/read-back chain
6. Step 3 acceptance、execution gate、analysis、5 critics、final judge、completion、terminal read-back、mirror correction
7. \`PROJECT_STATUS.json\`、\`simulation/CURRENT_STATUS.json\`、\`QUALITY_GATE.md\`
8. historical PASS、legacy、参考資料

過去証拠は改変しない。旧Round 7 current markerや旧Step 2 READY文言を現行状態へ復元しない。

## Sealed checkpoints

### Step 1

- status: \`PASS\`
- unresolved P0/P1: \`0 / 0\`

### Step 2

- status: \`PASS_SEALED\`
- executable seal blob: \`ee3507969c03b08fe27350263cf0bc093a1c18e1\`
- critics: \`5\`
- unresolved P0/P1: \`0 / 0\`

### Step 3

- status: \`PASS\`
- gameplay: \`15,000\`
- high-volume: \`1,700,000\`
- critics: \`5\`
- unresolved P0/P1: \`0 / 0\`
- terminal verdict: \`PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION\`
- holdout reused for tuning: \`false\`
- candidate mutation: \`false\`

## Product non-negotiables

- cat/catfolk、常設4体、一時増援別層
- unbounded visible tower、100F milestone、101F+
- tap direct damage 0、auto/offline基礎
- one reset \`reset.tower_return\`、Floor 1、高速reclear、repeat-best ruby 0
- uncapped coin level、every-100 ruby evolution、evolution非gate
- rarity \`N < R < RR < SR < SSR < UR\`
- separate character/weapon gacha、100/200 guarantees、carryover/exchange/history
- first copy functional、20+ optional full mastery、diminishing returns、overflow
- paid/free ruby provenance、explicit spent-grant refund deficit
- S01〜S12、server-authoritative permanent economy
- arbitrary-precision numeric contract

## Current write boundary

Allowed next: **Step 4 twelve-screen final mockups**.

Forbidden: runtime、assets、backend、payment provider、ad network、Production alias、physical-iPhone PASS claim、Step 2 executable mutation。

## Completion rule

files、build、tests、deployment READYだけで完成判定しない。Acceptance、意味対応、決定論、確率・経済、台帳・race、独立批評、修正、回帰、exact commit/tree/evidence、P0/P1=0を必要とする。physical iPhone証拠なしに実機確認済みとしない。`;
}

function handoverDocument() {
  return `${gateBlock()}

# Cat's Tower 引き継ぎ書

更新日: **2026-08-28**
Repository: \`2hg7trp7rv-design/cats_tower\`
Branch: existing \`kimi\` only
Current: **Step 3 — PASS**
Next: **Step 4 — READY_TO_START**
Physical iPhone: **NOT_VERIFIED**
Production: **変更なし**

## 結論

Step 3「3ビルド・ガチャ・重複熟練・進化・課金検証」は、実行、holdout分離、6 high-volume suites、5独立critic、final judge、completion evidence、terminal live read-backまでPASSした。Step 4の12画面完成見本へ移行できる。

## Step 3 evidence

- acceptance: \`quality-reviews/step-3-large-scale-validation/acceptance-matrix.json\`
- execution gate: \`quality-reviews/step-3-large-scale-validation/execution-gate.json\`
- analysis: \`quality-reviews/step-3-large-scale-validation/analysis.json\`
- critic summary: \`quality-reviews/step-3-large-scale-validation/critic-summary.json\`
- final judge: \`quality-reviews/step-3-large-scale-validation/final-judge.json\`
- completion evidence: \`quality-reviews/step-3-large-scale-validation/completion-evidence.json\`
- terminal read-back: \`quality-reviews/step-3-large-scale-validation/live-readback.json\`
- post-terminal mirror correction: \`quality-reviews/step-3-large-scale-validation/terminal-mirror-correction.json\`

## Volumes and verdicts

- calibration: \`12,000\`
- unseen holdout: \`3,000\`
- gameplay total: \`15,000\`
- high-volume total: \`1,700,000\`
- critic count: \`5\`
- unresolved P0/P1: \`0 / 0\`
- balance verdict: \`PASS_STEP3_LARGE_SCALE_VALIDATION\`

## Key measured results

- first reset: 20〜29分、p50 24分
- no-ad F2P featured guarantee: day 40
- no-ad F2P combined daily draws: 44
- build spread violations: 0
- repeated-reset sequence violations: 0
- first-evolution uncovered scenarios: 0
- pity/gacha boundary violations: 0
- free-ledger refund violations: 0
- state-machine unexpected transitions: 0
- large-number canonical/background/modifier violations: 0

## Scope unchanged

- runtime: unchanged
- assets: unchanged
- backend: unchanged
- payment provider: unchanged
- ad network: unchanged
- Production alias: unchanged
- physical iPhone: not verified
- other branch / PR: none

## Next authorized work

\`04_12画面完成見本\`

S01〜S12の完成見本、スマホ3 viewport、safe area、large text、reduced motion、視認性、情報階層、操作導線を固定する。runtime/backend/Productionへはまだ進まない。`;
}

function readmeDocument() {
  return `# Cat's Tower

猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登り、一つの「塔還り」で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPGです。

## 現在地

- Repository: \`2hg7trp7rv-design/cats_tower\`
- Writable branch: 既存の\`kimi\`のみ
- Step 1: **Round 008 — PASS**
- Step 2: **PASS / SEALED**
- Step 3: **PASS / LARGE_SCALE_VALIDATION_COMPLETE**
- Step 4: **READY_TO_START**
- unresolved P0/P1: \`0 / 0\`
- balance verdict: \`PASS_STEP3_LARGE_SCALE_VALIDATION\`
- physical iPhone: \`NOT_VERIFIED\`
- Production alias変更: なし

## 読む順序

1. \`CHATGPT_PROJECT_INSTRUCTIONS1.md\`
2. active change-controlと最新addendum
3. Step 1 / Step 2 seals
4. Step 3 terminal read-backとmirror correction
5. \`PROJECT_STATUS.json\`
6. \`QUALITY_GATE.md\`
7. \`AGENTS.md\`
8. 対象Acceptance/evidence

## 現行製品の要点

- player-visible floor capなし。100Fは最初の大型節目、101F+継続
- 常設4体、一時増援別層、tap direct damage 0、auto/offline基礎
- shop/income/delivery/recruitment/reinvestmentはcombat support
- single reset \`reset.tower_return\`、Floor 1再開、高速reclear、repeat-best ruby 0
- uncapped coin level、every-100 ruby evolution
- rarity \`N < R < RR < SR < SSR < UR\`
- separate character/weapon gacha、100/200 targets、carryover/exchange/history
- first copyで機能完成、20+ duplicateは任意長期熟練、post-cap overflow
- paid/free ruby provenance、explicit refund deficit、immutable ad/login versions
- S01〜S12、server-authoritative permanent economy

## Step 3 result

- gameplay scenarios: \`15,000\`
- high-volume samples: \`1,700,000\`
- independent critics: \`5\`
- unresolved P0/P1: \`0 / 0\`
- terminal verdict: \`PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION\`

Step 3 PASSはruntime、backend、payment、ads、Production、物理iPhone完成を意味しません。

## 次の許可作業

\`04_12画面完成見本\`

12画面の完成見本とスマホ閲覧・操作要件を固定します。`;
}

function bootstrapDocument() {
  return `# Cat's Tower — ChatGPT Project bootstrap

更新日: **2026-08-28**
Repository: \`2hg7trp7rv-design/cats_tower\`
Writable branch: **existing \`kimi\` only**

## Start every chat

1. live \`kimi\` HEAD/tree
2. \`CHATGPT_PROJECT_INSTRUCTIONS1.md\`
3. active change-controlとlatest addendum
4. Step 1/2 seals
5. Step 3 terminal read-backとmirror correction
6. project/status/gate/agents
7. 対象Acceptanceとwrite boundary

## Current state

- Step 1: \`PASS\`
- Step 2: \`PASS_SEALED\`
- Step 3: \`PASS\`
- Step 4: \`READY_TO_START\`
- balance: \`PASS_STEP3_LARGE_SCALE_VALIDATION\`
- physical iPhone: \`NOT_VERIFIED\`
- Production: unchanged

## Next authorized chat

\`04_12画面完成見本\`

Step 4ではS01〜S12の完成見本を作る。runtime、backend、provider、Production、physical-iPhone PASSへ先行しない。

## Handover minimum

repository、branch、content/evidence commit/tree、Acceptance、critic/judge、P0/P1、changed/forbidden paths、Production change、physical-device state、next authorized workをGitHubへ残す。`;
}

function customGptDocument() {
  return `# Cat's Tower 制作監督GPT — optional configuration

更新日: **2026-08-28**

このCustom GPTはProjectの代替ではなく、live \`2hg7trp7rv-design/cats_tower\` / existing \`kimi\`を毎回再読する補助役である。

## Repository lock

- existing \`kimi\` only
- no branch creation/switch/write/delete, PR, merge, rebase, cherry-pick, force-push
- no Production/provider/public changes without approval

## Current phase

- Step 1: \`PASS\`
- Step 2: \`PASS_SEALED\`
- Step 3: \`PASS\`
- Step 4: \`READY_TO_START\`
- balance: \`PASS_STEP3_LARGE_SCALE_VALIDATION\`
- physical iPhone: \`NOT_VERIFIED\`

## Product boundary

unbounded visible tower、100F milestone/101F+、cat/catfolk four-member party、temporary support separate、tap damage 0、auto/offline、shop/delivery combat support、single Floor-1 reset、uncapped coin levels/every-100 ruby evolution、N<R<RR<SR<SSR<UR、separate character/weapon gacha、first-copy functional/20+ optional mastery、paid/free ruby provenance、explicit refund deficit、S01-S12、server-authoritative permanent economy。

## Current allowed work

Step 4 twelve-screen final mockups only. runtime、assets、backend、payment/ad provider、PR、Production、physical-iPhone PASS claimは禁止。`;
}

function inputContractDocument() {
  return `# Cat's Tower simulation input contract — current status

Status: **STEP 2 SEALED / STEP 3 PASS**
Updated: **2026-08-28**

## Current authority

- Step 1 Round 008: \`PASS\`
- Step 2 executable seal: \`PASS_SEALED\`
- Step 3 large-scale validation: \`PASS\`
- Step 4: \`READY_TO_START\`
- candidate: \`simulation/candidate-v2.json\` — immutable for this completed Step 3 round
- run plan: \`simulation/run-plan-v2.json\`
- execution contract: \`simulation/execution-contract-v2.json\`
- executable seal blob: \`ee3507969c03b08fe27350263cf0bc093a1c18e1\`

## V1 disposition

V1 candidate/schema/executable evidenceはhistorical comparisonだけに使用する。current promotionへ実行、in-place延命、observed holdout再利用をしない。

## V2 sealed domains

- unbounded tower and arbitrary-precision numbers
- reset、loss/keep/gain、anti-farm、reclear
- levels/evolution/rarity/characters/weapons
- separate character/weapon gacha、pity、guarantee、carryover、exchange
- first-copy/practical/20+ mastery/overflow
- paid/free wallet、refund deficit、payment/refund/revocation/restore
- ads、login、entitlements、accounts、S01-S12 state transitions

## Step 3 execution result

- calibration: \`12,000\`
- unseen holdout: \`3,000\`
- gameplay total: \`15,000\`
- high-volume total: \`1,700,000\`
- holdout tuning reuse: \`false\`
- candidate mutation: \`false\`
- critics: \`5\`
- unresolved P0/P1: \`0 / 0\`
- balance verdict: \`PASS_STEP3_LARGE_SCALE_VALIDATION\`

## Current boundary

Step 4 may consume the sealed Step 3 result for twelve-screen mockups. Step 2/3 executable inputs may not be silently mutated. runtime/backend/provider/Production/physical-iPhone PASS remain later gates.`;
}

function prepare() {
  const { live } = verifyAuthority();
  assert(!existsSync(abs(CORRECTION)), 'terminal mirror correction already exists');
  assert(!existsSync(abs(ROUND16)), 'round-016 addendum already exists');

  const active = readJson(ACTIVE);
  active.revision = Math.max(Number(active.revision ?? 8), 9);
  active.updatedAt = '2026-08-28';
  active.status = 'PASS';
  active.verdict = 'PASS';
  active.advanceAllowed = true;
  active.step3Allowed = true;
  active.step4Allowed = true;
  active.activationEvidence = {
    ...(active.activationEvidence ?? {}),
    latestAddendum: ROUND16,
    step3FinalJudge: FINAL,
    step3CompletionEvidence: COMPLETION,
    step3LiveReadback: LIVE,
    step3TerminalMirrorCorrection: CORRECTION,
  };
  active.completedCheckpoints = {
    ...(active.completedCheckpoints ?? {}),
    step3LargeScaleValidation: {
      status: 'PASS',
      gameplayScenarios: 15000,
      highVolumeSamples: 1700000,
      criticCount: 5,
      unresolvedP0: 0,
      unresolvedP1: 0,
      balanceVerdict: 'PASS_STEP3_LARGE_SCALE_VALIDATION',
    },
  };
  active.currentWriteBoundary = {
    allowed: ['Step 4 twelve-screen final mockups'],
    forbidden: ['runtime', 'assets', 'backend', 'payment provider', 'ad network', 'PR operation', 'Production alias', 'Step 2 executable mutation', 'physical-iPhone PASS claim'],
  };
  active.nextAuthorizedChat = '04_12画面完成見本';
  active.nextAuthorizedAction = 'Start Step 4 twelve-screen final mockups.';
  writeJson(ACTIVE, active);

  const round16 = {
    schemaVersion: 1,
    artifactId: 'step-1-canonical-design-active-change-control-addendum-round-016',
    createdAt: '2026-08-28',
    repository: REPOSITORY,
    branch: BRANCH,
    previousAddendum: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json',
    trigger: 'Post-terminal read-back found stale Step 2/Step 3 lifecycle wording inside current authority mirrors even though the canonical status blocks and terminal verdict were PASS. Correct mirrors without changing product semantics, sealed inputs, raw execution evidence or the immutable v2 terminal read-back.',
    sourceTerminalReadback: { path: LIVE, blob: EXPECTED[LIVE], verdict: live.verdict },
    sourceCompletionEvidence: { path: COMPLETION, blob: EXPECTED[COMPLETION] },
    correctedMirrorEvidence: CORRECTION,
    step1Status: 'PASS',
    step2Status: 'PASS_SEALED',
    step3Status: 'PASS',
    step4Status: 'READY_TO_START',
    balanceVerdict: 'PASS_STEP3_LARGE_SCALE_VALIDATION',
    unresolvedP0: 0,
    unresolvedP1: 0,
    physicalIPhoneVerified: false,
    productionAliasChanged: false,
    nextAuthorizedAction: 'Start Step 4 twelve-screen final mockups.',
    verdict: 'PASS_POST_TERMINAL_MIRROR_CORRECTION_AUTHORIZED',
  };
  writeJson(ROUND16, round16);

  const policy = readJson('AI_PROJECT_POLICY.json');
  policy.schemaVersion = Math.max(Number(policy.schemaVersion ?? 6), 7);
  policy.updatedDate = '2026-08-28';
  if (!policy.sourceOfTruthOrder.includes(CORRECTION)) {
    const index = policy.sourceOfTruthOrder.findIndex((entry) => entry.includes('PROJECT_STATUS.json'));
    policy.sourceOfTruthOrder.splice(index < 0 ? policy.sourceOfTruthOrder.length : index, 0, CORRECTION);
  }
  policy.currentPhase = { step: 3, name: 'large-scale-validation', status: 'PASS', phase: 'LARGE_SCALE_VALIDATION_COMPLETE', step1Status: 'PASS', step2Status: 'PASS_SEALED', step3Allowed: true, step4Allowed: true, balanceVerdict: 'PASS_STEP3_LARGE_SCALE_VALIDATION', physicalIPhone: 'NOT_VERIFIED' };
  policy.activeStep3Validation = {
    status: 'PASS',
    acceptance: `${STEP3}/acceptance-matrix.json`,
    executionGate: `${STEP3}/execution-gate.json`,
    criticSummary: CRITIC_SUMMARY,
    finalJudge: FINAL,
    completionEvidence: COMPLETION,
    terminalReadback: LIVE,
    terminalMirrorCorrection: CORRECTION,
    gameplayScenarios: 15000,
    highVolumeSamples: 1700000,
    unresolvedP0: 0,
    unresolvedP1: 0,
  };
  policy.writeBoundary.currentAllowed = ['Step 4 twelve-screen final mockups'];
  writeJson('AI_PROJECT_POLICY.json', policy);

  const project = readJson('PROJECT_STATUS.json');
  project.statusDocumentSchemaVersion = Math.max(Number(project.statusDocumentSchemaVersion ?? 14), 15);
  project.updatedDate = '2026-08-28';
  project.currentChat = '03_3ビルド・ガチャ・重複熟練・進化・課金検証';
  project.currentStep = 3;
  project.currentStepName = 'large-scale-validation';
  project.currentStepStatus = 'PASS';
  project.currentCheckpoint = 'step3-post-terminal-mirror-correction';
  project.status = 'PASS';
  project.phase = 'LARGE_SCALE_VALIDATION_COMPLETE';
  project.advanceAllowed = true;
  project.step4Allowed = true;
  project.balanceVerdict = 'PASS_STEP3_LARGE_SCALE_VALIDATION';
  project.writeBoundary = {
    allowedNext: ['Step 4 twelve-screen final mockups'],
    forbiddenUntilLaterGates: ['runtime', 'assets', 'backend', 'payment provider', 'ad network', 'Production alias', 'physical-iPhone PASS claim'],
  };
  delete project.knownCiDiscrepancy;
  project.resolvedCiHistory = {
    workflow: '.github/workflows/verify-main.yml',
    status: 'RESOLVED',
    resolution: 'Historical Round 7 and current governance are separate jobs.',
    verifiedRunId: '33144127913',
    conclusion: 'SUCCESS',
  };
  project.step3 = {
    ...(project.step3 ?? {}),
    status: 'PASS',
    finalJudge: 'PASS',
    finalJudgeVerdict: 'PASS_STEP3_CONTENT_PENDING_COMPLETION_AND_LIVE_READBACK',
    completionEvidence: 'PASS',
    liveReadback: 'PASS',
    liveReadbackVerdict: 'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION',
    terminalMirrorCorrection: CORRECTION,
    gameplayScenarios: '15000',
    highVolumeSamples: '1700000',
    candidateMutation: false,
    holdoutTuningReuse: false,
  };
  project.nextAuthorizedChat = '04_12画面完成見本';
  project.nextAction = 'Start Step 4 twelve-screen final mockups.';
  writeJson('PROJECT_STATUS.json', project);

  const simulation = readJson('simulation/CURRENT_STATUS.json');
  simulation.schemaVersion = Math.max(Number(simulation.schemaVersion ?? 7), 8);
  simulation.updatedDate = '2026-08-28';
  simulation.currentStep = 3;
  simulation.status = 'PASS';
  simulation.phase = 'LARGE_SCALE_VALIDATION_COMPLETE';
  simulation.step4Allowed = true;
  simulation.balanceVerdict = 'PASS_STEP3_LARGE_SCALE_VALIDATION';
  simulation.writeBoundary = {
    allowed: ['Step 4 twelve-screen final mockups'],
    runtimeChanged: false,
    assetChanged: false,
    v1Changed: false,
    backendChanged: false,
    paymentProviderChanged: false,
    adNetworkChanged: false,
    productionChanged: false,
    step3MayRun: false,
    step4MayStart: true,
  };
  simulation.nextAuthorizedWork = 'Start Step 4 twelve-screen final mockups. Do not mutate the sealed Step 2/3 executable evidence.';
  delete simulation.knownCiDiscrepancy;
  simulation.resolvedCiHistory = {
    workflow: '.github/workflows/verify-main.yml',
    status: 'RESOLVED',
    verifiedRunId: '33144127913',
    conclusion: 'SUCCESS',
  };
  simulation.step3 = {
    ...(simulation.step3 ?? {}),
    status: 'PASS',
    finalJudge: 'PASS',
    finalJudgeVerdict: 'PASS_STEP3_CONTENT_PENDING_COMPLETION_AND_LIVE_READBACK',
    completionEvidence: 'PASS',
    liveReadback: 'PASS',
    liveReadbackVerdict: 'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION',
    terminalMirrorCorrection: CORRECTION,
    candidateMutation: false,
    holdoutTuningReuse: false,
  };
  writeJson('simulation/CURRENT_STATUS.json', simulation);

  writeText('QUALITY_GATE.md', qualityGateDocument());
  writeText('.github/workflows/CURRENT_STATUS.md', workflowStatusDocument());
  writeText('AGENTS.md', agentsDocument());
  writeText('PROJECT_HANDOVER.md', handoverDocument());
  writeText('README.md', readmeDocument());
  writeText('CHATGPT_PROJECT_BOOTSTRAP.md', bootstrapDocument());
  writeText('CUSTOM_GPT_CONFIGURATION.md', customGptDocument());
  writeText('simulation/INPUT_CONTRACT.md', inputContractDocument());

  const correction = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step3-post-terminal-mirror-correction-v1',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    observedLiveBeforeCorrection: { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') },
    sourceTerminalReadback: { path: LIVE, blob: EXPECTED[LIVE], verdict: live.verdict },
    sourceCompletionEvidence: { path: COMPLETION, blob: EXPECTED[COMPLETION] },
    sourceFinalJudge: { path: FINAL, blob: EXPECTED[FINAL], step3Pass: true },
    sourceCriticSummary: { path: CRITIC_SUMMARY, blob: EXPECTED[CRITIC_SUMMARY], criticCount: 5, unresolvedP0: 0, unresolvedP1: 0 },
    correctedFields: [
      'active-change-control activationEvidence.step3LiveReadback',
      'active-change-control latest addendum and Step 3 completed checkpoint',
      'PROJECT_STATUS step3.liveReadback, next boundary and resolved CI history',
      'simulation/CURRENT_STATUS step3.liveReadback, next boundary and resolved CI history',
      'current Markdown authority documents containing stale Step 2/Step 3 lifecycle prose',
    ],
    mirrorBlobs: Object.fromEntries(MIRRORS.map((relativePath) => [relativePath, workingBlob(relativePath)])),
    governanceDecision: { step1: 'PASS', step2: 'PASS_SEALED', step3: 'PASS', step4: 'READY_TO_START', balanceVerdict: 'PASS_STEP3_LARGE_SCALE_VALIDATION', unresolvedP0: 0, unresolvedP1: 0 },
    scope: { productSemanticsChanged: false, candidateChanged: false, rawExecutionEvidenceChanged: false, holdoutUsedForTuning: false, runtimeChanged: false, assetsChanged: false, backendChanged: false, paymentProviderChanged: false, adNetworkChanged: false, productionAliasChanged: false, physicalIPhoneVerified: false, otherBranchWritten: false, pullRequestOperationPerformed: false },
    nextAuthorizedAction: 'Start Step 4 twelve-screen final mockups.',
    verdict: 'PASS_STEP3_POST_TERMINAL_MIRROR_CORRECTION',
  };
  writeJson(CORRECTION, correction);
  verify();
  console.log(JSON.stringify({ verdict: correction.verdict, mirrorCount: MIRRORS.length }));
}

function verify() {
  verifyAuthority();
  requireFile(ROUND16);
  requireFile(CORRECTION);
  const correction = readJson(CORRECTION);
  assert.equal(correction.repository, REPOSITORY);
  assert.equal(correction.branch, BRANCH);
  assert.equal(correction.verdict, 'PASS_STEP3_POST_TERMINAL_MIRROR_CORRECTION');
  assert.equal(correction.governanceDecision.step3, 'PASS');
  assert.equal(correction.governanceDecision.step4, 'READY_TO_START');
  assert.equal(correction.governanceDecision.unresolvedP0, 0);
  assert.equal(correction.governanceDecision.unresolvedP1, 0);
  for (const [relativePath, expectedBlob] of Object.entries(correction.mirrorBlobs)) {
    requireFile(relativePath);
    assert.equal(workingBlob(relativePath), expectedBlob, `${relativePath}: correction working blob mismatch`);
  }
  const active = readJson(ACTIVE);
  const project = readJson('PROJECT_STATUS.json');
  const simulation = readJson('simulation/CURRENT_STATUS.json');
  assert.equal(active.activationEvidence.latestAddendum, ROUND16);
  assert.equal(active.activationEvidence.step3LiveReadback, LIVE);
  assert.equal(active.activationEvidence.step3TerminalMirrorCorrection, CORRECTION);
  assert.equal(project.step3.liveReadback, 'PASS');
  assert.equal(project.step3.terminalMirrorCorrection, CORRECTION);
  assert.deepEqual(project.writeBoundary.allowedNext, ['Step 4 twelve-screen final mockups']);
  assert.equal(simulation.step3.liveReadback, 'PASS');
  assert.equal(simulation.step3.terminalMirrorCorrection, CORRECTION);
  assert.deepEqual(simulation.writeBoundary.allowed, ['Step 4 twelve-screen final mockups']);
  assert.equal(simulation.writeBoundary.step3MayRun, false);
  assert.equal(simulation.writeBoundary.step4MayStart, true);
  for (const relativePath of TEXT_MIRRORS) {
    const text = readText(relativePath);
    for (const marker of STALE_MARKERS) assert(!text.includes(marker), `${relativePath}: stale marker remains: ${marker}`);
  }
  assert.equal(correction.scope.productSemanticsChanged, false);
  assert.equal(correction.scope.rawExecutionEvidenceChanged, false);
  assert.equal(correction.scope.productionAliasChanged, false);
  assert.equal(correction.scope.physicalIPhoneVerified, false);
  console.log(JSON.stringify({ verdict: 'PASS_STEP3_POST_TERMINAL_MIRROR_CORRECTION_VERIFICATION', mirrorCount: Object.keys(correction.mirrorBlobs).length }));
}

const command = process.argv[2] ?? 'verify';
if (command === 'prepare') prepare();
else if (command === 'verify') verify();
else throw new Error(`UNKNOWN_COMMAND:${command}`);
