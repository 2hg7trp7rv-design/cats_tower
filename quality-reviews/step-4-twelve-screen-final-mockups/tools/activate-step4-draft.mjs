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
const STEP4_ENTRY = '245d50b6e80e2783f6aeaab5e50fae217661a3b6';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const ACCEPTANCE = `${STEP4}/acceptance-matrix.json`;
const MANIFEST = `${STEP4}/render-manifest.json`;
const ENTRY_READBACK = `${STEP4}/entry-readback.json`;
const ACTIVATION = `${STEP4}/draft-activation-evidence.json`;
const DRAFT_LIVE = `${STEP4}/draft-live-readback.json`;
const V3_VERIFIER = 'tests/step4/verify-step4-mockups-v3.mjs';
const ACTIVE = 'quality-reviews/step-1-canonical-design/active-change-control.json';
const ROUND17 = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-017.json';
const WORKFLOW_MIRROR = '.github/workflows/CURRENT_STATUS.md';
const STATUS_FILES = [
  ACTIVE,
  ROUND17,
  'AI_PROJECT_POLICY.json',
  'PROJECT_STATUS.json',
  'simulation/CURRENT_STATUS.json',
  'QUALITY_GATE.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'README.md',
  'CHATGPT_PROJECT_BOOTSTRAP.md',
  'CUSTOM_GPT_CONFIGURATION.md',
  'simulation/INPUT_CONTRACT.md',
];
const TEXT_FILES = [
  'QUALITY_GATE.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'README.md',
  'CHATGPT_PROJECT_BOOTSTRAP.md',
  'CUSTOM_GPT_CONFIGURATION.md',
  'simulation/INPUT_CONTRACT.md',
];

const abs = (relativePath) => path.join(ROOT, relativePath);
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const writeText = (relativePath, value) => writeFileSync(abs(relativePath), `${String(value).replace(/[ \t]+$/gm, '').trim()}\n`, 'utf8');
const writeJson = (relativePath, value) => writeText(relativePath, JSON.stringify(value, null, 2));
const exists = (relativePath) => existsSync(abs(relativePath));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);
const workingBlob = (relativePath) => {
  const body = readFileSync(abs(relativePath));
  return createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
};
const isoNow = () => new Date().toISOString();

function statusBlock() {
  return `<!-- CATS_TOWER_STEP4_STATUS_BEGIN -->
## 現在の正式Gate

- Step 1: **PASS**
- Step 2: **PASS / SEALED**
- Step 3: **PASS**
- Step 4: **IN_PROGRESS**
- Step 5: **BLOCKED_UNTIL_STEP4_PASS**
- Step 4 draft: **12 screens / 3 viewports / 36 XML-valid SVG**
- Step 4 independent critics: **0 / required 5**
- Physical iPhone: **NOT_VERIFIED**
- Production alias changed: **false**
<!-- CATS_TOWER_STEP4_STATUS_END -->`;
}

function qualityGateDocument() {
  return `${statusBlock()}

# Cat's Tower — 完成判定と工程Gate

更新日: **2026-08-28**

現在工程: **Step 4 — IN_PROGRESS / TWELVE_SCREEN_FINAL_MOCKUPS**

## 完了済みGate

- Step 1 Round 008: 正本意味・ID・状態・画面・禁止事項を封印済み
- Step 2: executable contract / simulationを封印済み
- Step 3: 15,000 gameplay、1,700,000 high-volume、5 critics、P0/P1=0でPASS

## Step 4現在地

- Acceptance: \`${ACCEPTANCE}\`
- design system: \`${STEP4}/design-system.json\`
- screen specs: \`${STEP4}/screen-specs.json\`
- responsive gallery: \`${STEP4}/mockup-gallery.html\`
- render manifest: \`${MANIFEST}\`
- 12 screens × 3 viewports = 36 SVG
- normal stateと各画面の重要recovery stateを表示
- XML strict parse: PASS

## Step 4で未完了

- 実ブラウザでの全viewport screenshot比較
- large text / reduced motionの実表示確認
- 5つの独立critic
- 指摘修正と再生成
- final judge、completion evidence、terminal live read-back

これらが揃うまでStep 4をPASSにしない。Step 5も開始しない。

## 後工程境界

runtime、product assets、backend、payment provider、ad network、Production alias、physical iPhoneは未変更。Step 4 draftは製品runtimeではない。`;
}

function agentsDocument() {
  return `${statusBlock()}

# Cat's Tower repository instructions

Repository: \`2hg7trp7rv-design/cats_tower\`
Writable branch: **existing \`kimi\` only**

## Hard lock

- branch作成・切替・書込み・削除、PR、merge、rebase、cherry-pick、force-pushは禁止
- Step 4中は\`${STEP4}/**\`、Step 4 tests、current status mirrorsだけを変更する
- runtime、product assets、backend、provider、Production aliasへ進まない
- 物理iPhone証拠なしに実機確認済みとしない

## Current authority

1. 最新ユーザー明示決定
2. \`CHATGPT_PROJECT_INSTRUCTIONS1.md\`
3. active change-controlとlatest addendum
4. Step 1 Round 008 seal
5. Step 2 executable seal
6. Step 3 terminal read-backとmirror correction
7. Step 4 Acceptance、design system、screen specs、render manifest、critic/judge/evidence
8. current status mirrors

## Step 4 completion rule

36ファイルが存在するだけでは不十分。3 viewport実表示、state coverage、safe area、large text、reduced motion、5 critics、P0/P1=0、final judge、completion/read-backまで必要。`;
}

function handoverDocument() {
  return `${statusBlock()}

# Cat's Tower 引き継ぎ書

更新日: **2026-08-28**
Repository: \`2hg7trp7rv-design/cats_tower\`
Branch: existing \`kimi\` only
Current: **Step 4 — IN_PROGRESS**
Next Gate: **browser render audit / five critics / final judge**
Physical iPhone: **NOT_VERIFIED**
Production: **変更なし**

## 完了済み

Step 1〜3は正式PASS。Step 4のAcceptanceは最初のwrite前に固定済み。オリジナルデザインシステム、S01〜S12 screen specs、state coverage、320×667 / 375×667 / 390×844の36 SVG、review galleryを生成済み。

## 現在の成果物

- \`${ACCEPTANCE}\`
- \`${STEP4}/reference-audit.json\`
- \`${STEP4}/design-system.json\`
- \`${STEP4}/screen-specs.json\`
- \`${STEP4}/state-coverage.json\`
- \`${STEP4}/mockup-gallery.html\`
- \`${MANIFEST}\`

## 未完了

- browser screenshot evidence
- large text / reduced motion render evidence
- five independent critics
- defect repair and regeneration
- final judge / completion / terminal read-back

Step 5へ進めてはならない。`;
}

function readmeDocument() {
  return `# Cat's Tower

猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登り、一つの「塔還り」で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPGです。

## 現在地

- Step 1: **PASS**
- Step 2: **PASS / SEALED**
- Step 3: **PASS / LARGE_SCALE_VALIDATION_COMPLETE**
- Step 4: **IN_PROGRESS / TWELVE_SCREEN_FINAL_MOCKUPS**
- Step 5: **BLOCKED_UNTIL_STEP4_PASS**
- Step 4 draft: 12 screens / 3 viewports / 36 XML-valid SVG
- Step 4 critics: 0 / required 5
- physical iPhone: \`NOT_VERIFIED\`
- Production alias変更: なし

## Step 4 review entry

\`${STEP4}/mockup-gallery.html\`

Step 4 draftは製品runtimeではありません。critic、実render、final judge完了前に完成扱いしません。`;
}

function bootstrapDocument() {
  return `# Cat's Tower — ChatGPT Project bootstrap

Repository: \`2hg7trp7rv-design/cats_tower\`
Writable branch: existing \`kimi\` only

## Start every chat

1. live \`kimi\` HEAD/tree
2. project instructions
3. active change-controlとlatest addendum
4. Step 1/2 sealsとStep 3 terminal read-back
5. Step 4 Acceptance / render manifest / current evidence
6. status mirrorsとwrite boundary

## Current state

- Step 1: PASS
- Step 2: PASS_SEALED
- Step 3: PASS
- Step 4: IN_PROGRESS
- Step 5: BLOCKED_UNTIL_STEP4_PASS
- physical iPhone: NOT_VERIFIED
- Production: unchanged

Current chat: \`04_12画面完成見本\`.`;
}

function customGptDocument() {
  return `# Cat's Tower 制作監督GPT — optional configuration

## Repository lock

- existing \`kimi\` only
- no branch creation, PR, merge, rebase, cherry-pick or force-push
- no Production/provider/public changes without explicit approval

## Current phase

- Step 1: PASS
- Step 2: PASS_SEALED
- Step 3: PASS
- Step 4: IN_PROGRESS
- Step 5: BLOCKED_UNTIL_STEP4_PASS
- physical iPhone: NOT_VERIFIED

## Current allowed work

Step 4 twelve-screen final mockups, render evidence, critic review and Step 4 completion evidence only. runtime、product assets、backend、provider、Production、physical-iPhone PASSは禁止。`;
}

function inputContractDocument() {
  return `# Cat's Tower simulation input contract — current status

Status: **STEP 2 SEALED / STEP 3 PASS / STEP 4 IN_PROGRESS**
Updated: **2026-08-28**

## Immutable execution authority

- candidate: \`simulation/candidate-v2.json\`
- run plan: \`simulation/run-plan-v2.json\`
- executable seal blob: \`ee3507969c03b08fe27350263cf0bc093a1c18e1\`
- Step 3: 15,000 gameplay + 1,700,000 high-volume PASS
- holdout tuning reuse: false
- candidate mutation: false

## Step 4 consumption rule

Step 4 may consume sealed Step 3 results for screen hierarchy, economy states, pity, mastery, evolution, reset and wallet presentation. Step 2/3 inputs may not be silently changed.

## Current boundary

Step 4 mockups and evidence only. runtime/backend/provider/Production/physical-iPhone PASS remain later gates.`;
}

function prepare() {
  assert(!exists(ACTIVATION), 'Step 4 draft activation evidence already exists');
  assert(!exists(ROUND17), 'Round 017 addendum already exists');
  const runId = process.env.STEP4_RUN_ID;
  const jobId = process.env.STEP4_JOB_ID;
  const runCommit = process.env.STEP4_RUN_COMMIT;
  const runTree = process.env.STEP4_RUN_TREE;
  assert(runId && jobId && runCommit && runTree, 'STEP4 workflow binding env is required');
  assert.equal(process.env.STEP4_RUN_CONCLUSION, 'success');
  execFileSync('git', ['merge-base', '--is-ancestor', runCommit, 'HEAD'], { cwd: ROOT });

  const verifierOutput = execFileSync('node', [V3_VERIFIER], { cwd: ROOT, encoding: 'utf8' }).trim();
  const verifier = JSON.parse(verifierOutput.split('\n').at(-1));
  assert.equal(verifier.verdict, 'PASS_STEP4_MOCKUP_DRAFT_VALIDATION_V3');
  assert.equal(verifier.renderCount, 36);
  assert.equal(verifier.forbiddenPathCount, 0);

  const manifest = readJson(MANIFEST);
  const entry = readJson(ENTRY_READBACK);
  assert.equal(manifest.renderCount, 36);
  assert.equal(manifest.xmlVerdict, 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_XML_VALID_V3');
  assert.equal(entry.xmlVerdict, 'PASS_STEP4_ENTRY_AND_XML_VALID_DRAFT_GENERATION_READBACK_V3');

  const round17 = {
    schemaVersion: 1,
    artifactId: 'step-1-canonical-design-active-change-control-addendum-round-017',
    createdAt: '2026-08-28',
    repository: REPOSITORY,
    branch: BRANCH,
    previousAddendum: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-016.json',
    trigger: 'Activate Step 4 after the first-write-frozen Acceptance and the deterministic XML-valid 12-screen, 3-viewport draft passed dedicated validation. Step 5 remains blocked until independent critics, repair, final judge, completion evidence and terminal read-back pass.',
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE) },
    draftManifest: { path: MANIFEST, blob: gitBlob(MANIFEST), renderCount: 36, xmlVerdict: manifest.xmlVerdict },
    draftWorkflow: { runId, jobId, commit: runCommit, tree: runTree, conclusion: 'SUCCESS' },
    step1Status: 'PASS',
    step2Status: 'PASS_SEALED',
    step3Status: 'PASS',
    step4Status: 'IN_PROGRESS',
    step5Status: 'BLOCKED_UNTIL_STEP4_PASS',
    step4Allowed: true,
    step5Allowed: false,
    physicalIPhoneVerified: false,
    productionAliasChanged: false,
    nextAuthorizedAction: 'Continue Step 4 browser rendering, accessibility review, five critics and finalization.',
    verdict: 'PASS_STEP4_DRAFT_ACTIVATION_AUTHORIZED',
  };
  writeJson(ROUND17, round17);

  const active = readJson(ACTIVE);
  active.revision = Math.max(Number(active.revision ?? 9), 10);
  active.updatedAt = '2026-08-28';
  active.status = 'IN_PROGRESS';
  active.verdict = 'IN_PROGRESS';
  active.advanceAllowed = false;
  active.step4Allowed = true;
  active.step5Allowed = false;
  active.activationEvidence = {
    ...(active.activationEvidence ?? {}),
    latestAddendum: ROUND17,
    step4Acceptance: ACCEPTANCE,
    step4DraftManifest: MANIFEST,
    step4EntryReadback: ENTRY_READBACK,
    step4DraftActivationEvidence: ACTIVATION,
    step4DraftLiveReadback: DRAFT_LIVE,
  };
  active.authorizedExecutionSequence = active.authorizedExecutionSequence.map((item) => item.order === 4 ? { ...item, status: 'IN_PROGRESS' } : item.order === 5 ? { ...item, status: 'BLOCKED_UNTIL_STEP4_PASS' } : item);
  active.currentWriteBoundary = {
    allowed: ['Step 4 twelve-screen final mockups, render evidence, critics and completion evidence'],
    forbidden: ['runtime', 'product assets', 'backend', 'payment provider', 'ad network', 'PR operation', 'Production alias', 'Step 2/3 executable mutation', 'physical-iPhone PASS claim'],
  };
  active.nextAuthorizedChat = '04_12画面完成見本';
  active.nextAuthorizedAction = 'Continue Step 4 browser rendering, accessibility review, five critics and finalization.';
  writeJson(ACTIVE, active);

  const project = readJson('PROJECT_STATUS.json');
  project.statusDocumentSchemaVersion = Math.max(Number(project.statusDocumentSchemaVersion ?? 15), 16);
  project.updatedDate = '2026-08-28';
  project.currentChat = '04_12画面完成見本';
  project.currentStep = 4;
  project.currentStepName = 'twelve-screen-final-mockups';
  project.currentStepStatus = 'IN_PROGRESS';
  project.currentCheckpoint = 'step4-draft-activation-pending-workflow-mirror';
  project.status = 'IN_PROGRESS';
  project.phase = 'TWELVE_SCREEN_FINAL_MOCKUPS_IN_PROGRESS';
  project.advanceAllowed = false;
  project.step4Allowed = true;
  project.step5Allowed = false;
  project.authorizedExecutionSequence = project.authorizedExecutionSequence.map((item) => item.order === 4 ? { ...item, status: 'IN_PROGRESS' } : item.order === 5 ? { ...item, status: 'BLOCKED_UNTIL_STEP4_PASS' } : item);
  project.writeBoundary = {
    allowedNext: ['Step 4 mockups, render evidence, critics and Step 4 completion evidence'],
    forbiddenUntilLaterGates: ['runtime', 'product assets', 'backend', 'payment provider', 'ad network', 'Production alias', 'physical-iPhone PASS claim'],
  };
  project.step4 = {
    status: 'IN_PROGRESS',
    acceptance: ACCEPTANCE,
    referenceAudit: `${STEP4}/reference-audit.json`,
    designSystem: `${STEP4}/design-system.json`,
    screenSpecs: `${STEP4}/screen-specs.json`,
    stateCoverage: `${STEP4}/state-coverage.json`,
    gallery: `${STEP4}/mockup-gallery.html`,
    renderManifest: MANIFEST,
    screenCount: 12,
    viewportCount: 3,
    renderCount: 36,
    xmlValidation: 'PASS',
    browserRenderEvidence: 'PENDING',
    independentCritics: '0_OF_5',
    finalJudge: 'PENDING',
    completionEvidence: 'PENDING',
    liveReadback: 'PENDING',
  };
  project.nextAuthorizedChat = '04_12画面完成見本';
  project.nextAction = 'Continue Step 4 browser rendering, accessibility review, five critics and finalization.';
  writeJson('PROJECT_STATUS.json', project);

  const simulation = readJson('simulation/CURRENT_STATUS.json');
  simulation.schemaVersion = Math.max(Number(simulation.schemaVersion ?? 8), 9);
  simulation.updatedDate = '2026-08-28';
  simulation.currentStep = 4;
  simulation.status = 'IN_PROGRESS';
  simulation.phase = 'TWELVE_SCREEN_FINAL_MOCKUPS_IN_PROGRESS';
  simulation.step4Allowed = true;
  simulation.step5Allowed = false;
  simulation.step3BalanceVerdict = 'PASS_STEP3_LARGE_SCALE_VALIDATION';
  simulation.step4VisualVerdict = 'NOT_EVALUATED_PENDING_CRITICS';
  simulation.writeBoundary = {
    allowed: ['Step 4 mockups, render evidence, critics and completion evidence'],
    runtimeChanged: false,
    assetChanged: false,
    backendChanged: false,
    paymentProviderChanged: false,
    adNetworkChanged: false,
    productionChanged: false,
    step4MayContinue: true,
    step5MayStart: false,
  };
  simulation.step4 = { status: 'IN_PROGRESS', acceptance: ACCEPTANCE, renderManifest: MANIFEST, screenCount: 12, viewportCount: 3, renderCount: 36, critics: '0_OF_5', finalJudge: 'PENDING' };
  simulation.nextAuthorizedWork = 'Continue Step 4 only; do not mutate sealed Step 2/3 executable evidence.';
  writeJson('simulation/CURRENT_STATUS.json', simulation);

  const policy = readJson('AI_PROJECT_POLICY.json');
  policy.schemaVersion = Math.max(Number(policy.schemaVersion ?? 7), 8);
  policy.updatedDate = '2026-08-28';
  policy.currentPhase = {
    step: 4,
    name: 'twelve-screen-final-mockups',
    status: 'IN_PROGRESS',
    phase: 'TWELVE_SCREEN_FINAL_MOCKUPS_IN_PROGRESS',
    step1Status: 'PASS',
    step2Status: 'PASS_SEALED',
    step3Status: 'PASS',
    step4Allowed: true,
    step5Allowed: false,
    balanceVerdict: 'PASS_STEP3_LARGE_SCALE_VALIDATION',
    visualVerdict: 'NOT_EVALUATED_PENDING_CRITICS',
    physicalIPhone: 'NOT_VERIFIED',
  };
  policy.activeStep4Design = { status: 'IN_PROGRESS', acceptance: ACCEPTANCE, renderManifest: MANIFEST, screenCount: 12, viewportCount: 3, renderCount: 36, browserRenderEvidence: 'PENDING', criticCount: 0, requiredCriticCount: 5, finalJudge: 'PENDING' };
  policy.writeBoundary.currentAllowed = ['Step 4 mockups, render evidence, critics and completion evidence'];
  policy.writeBoundary.currentForbidden = ['runtime', 'product assets', 'backend', 'payment provider', 'ad network', 'PR operation', 'Production alias', 'Step 2/3 executable mutation', 'physical-iPhone PASS claim'];
  writeJson('AI_PROJECT_POLICY.json', policy);

  writeText('QUALITY_GATE.md', qualityGateDocument());
  writeText('AGENTS.md', agentsDocument());
  writeText('PROJECT_HANDOVER.md', handoverDocument());
  writeText('README.md', readmeDocument());
  writeText('CHATGPT_PROJECT_BOOTSTRAP.md', bootstrapDocument());
  writeText('CUSTOM_GPT_CONFIGURATION.md', customGptDocument());
  writeText('simulation/INPUT_CONTRACT.md', inputContractDocument());

  const activation = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-draft-activation-evidence-v1',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    observedLiveBeforeActivation: { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') },
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE) },
    draftManifest: { path: MANIFEST, blob: gitBlob(MANIFEST), renderCount: 36, xmlVerdict: manifest.xmlVerdict },
    draftWorkflow: { runId, jobId, commit: runCommit, tree: runTree, conclusion: 'SUCCESS' },
    draftVerifier: verifier,
    synchronizedMirrorBlobs: Object.fromEntries(STATUS_FILES.map((relativePath) => [relativePath, workingBlob(relativePath)])),
    workflowMirror: { path: WORKFLOW_MIRROR, beforeBlob: gitBlob(WORKFLOW_MIRROR), pendingUpdate: true },
    governanceDecision: { step1: 'PASS', step2: 'PASS_SEALED', step3: 'PASS', step4: 'IN_PROGRESS', step5: 'BLOCKED_UNTIL_STEP4_PASS', unresolvedP0: null, unresolvedP1: null },
    scope: { runtimeChanged: false, productAssetsChanged: false, backendChanged: false, paymentProviderChanged: false, adNetworkChanged: false, productionAliasChanged: false, physicalIPhoneVerified: false, otherBranchWritten: false, pullRequestOperationPerformed: false },
    nextRequired: ['synchronize workflow status mirror', 'browser render evidence', 'five independent critics', 'repair', 'final judge', 'completion evidence', 'terminal live read-back'],
    verdict: 'PASS_STEP4_DRAFT_ACTIVATION_PENDING_WORKFLOW_MIRROR',
  };
  writeJson(ACTIVATION, activation);
  verify();
  console.log(JSON.stringify({ verdict: activation.verdict, mirrorCount: STATUS_FILES.length, workflowMirrorPending: true }));
}

function verify() {
  const verifierOutput = execFileSync('node', [V3_VERIFIER], { cwd: ROOT, encoding: 'utf8' }).trim();
  const verifier = JSON.parse(verifierOutput.split('\n').at(-1));
  assert.equal(verifier.verdict, 'PASS_STEP4_MOCKUP_DRAFT_VALIDATION_V3');
  assert(exists(ROUND17));
  assert(exists(ACTIVATION));
  const activation = readJson(ACTIVATION);
  const round17 = readJson(ROUND17);
  const active = readJson(ACTIVE);
  const project = readJson('PROJECT_STATUS.json');
  const simulation = readJson('simulation/CURRENT_STATUS.json');
  const policy = readJson('AI_PROJECT_POLICY.json');
  assert.equal(activation.verdict, 'PASS_STEP4_DRAFT_ACTIVATION_PENDING_WORKFLOW_MIRROR');
  assert.equal(round17.verdict, 'PASS_STEP4_DRAFT_ACTIVATION_AUTHORIZED');
  assert.equal(active.status, 'IN_PROGRESS');
  assert.equal(active.step5Allowed, false);
  assert.equal(project.currentStep, 4);
  assert.equal(project.currentStepStatus, 'IN_PROGRESS');
  assert.equal(project.step5Allowed, false);
  assert.equal(simulation.currentStep, 4);
  assert.equal(simulation.status, 'IN_PROGRESS');
  assert.equal(simulation.step5Allowed, false);
  assert.equal(policy.currentPhase.step, 4);
  assert.equal(policy.currentPhase.status, 'IN_PROGRESS');
  assert.equal(policy.currentPhase.step5Allowed, false);
  for (const [relativePath, expectedBlob] of Object.entries(activation.synchronizedMirrorBlobs)) {
    assert.equal(workingBlob(relativePath), expectedBlob, `${relativePath}: synchronized mirror blob mismatch`);
  }
  for (const relativePath of TEXT_FILES) {
    const text = readText(relativePath);
    assert(text.includes('Step 4: **IN_PROGRESS**') || text.includes('Step 4: **IN_PROGRESS / TWELVE_SCREEN_FINAL_MOCKUPS**') || text.includes('Step 4: IN_PROGRESS'));
    assert(!text.includes('Step 4: **READY_TO_START**'));
    assert(!text.includes('Step 4: `READY_TO_START`'));
  }
  assert.equal(activation.scope.runtimeChanged, false);
  assert.equal(activation.scope.productAssetsChanged, false);
  assert.equal(activation.scope.backendChanged, false);
  assert.equal(activation.scope.productionAliasChanged, false);
  assert.equal(activation.scope.physicalIPhoneVerified, false);
  console.log(JSON.stringify({ verdict: 'PASS_STEP4_DRAFT_ACTIVATION_CONTENT_VERIFICATION', workflowMirrorPending: activation.workflowMirror.pendingUpdate, renderCount: 36 }));
}

const command = process.argv[2] ?? 'verify';
if (command === 'prepare') prepare();
else if (command === 'verify') verify();
else throw new Error(`UNKNOWN_COMMAND:${command}`);
