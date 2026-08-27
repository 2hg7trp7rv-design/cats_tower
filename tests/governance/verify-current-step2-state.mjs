import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const repairBase = '510157c97e7e94456df8d45c3af20082e71aced6';
const expectedRepository = '2hg7trp7rv-design/cats_tower';

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function blob(relativePath) {
  return git('rev-parse', `HEAD:${relativePath}`);
}

function assertContains(text, expected, label) {
  assert.ok(text.includes(expected), `${label} must contain ${JSON.stringify(expected)}`);
}

if (process.env.GITHUB_REPOSITORY) {
  assert.equal(process.env.GITHUB_REPOSITORY, expectedRepository, 'workflow repository');
}
if (process.env.GITHUB_REF_NAME) {
  assert.equal(process.env.GITHUB_REF_NAME, 'kimi', 'workflow branch');
}

assert.equal(blob('CHATGPT_PROJECT_INSTRUCTIONS1.md'), '2b42e9907bf19724dd5eb3342872aaa931424be9', 'project instructions blob');
assert.equal(blob('MASTER_SPEC.md'), '5d1e5ff37ba8d79f4c23e6051740c4c6957f1dbc', 'sealed master-spec blob');
assert.equal(blob('quality-reviews/step-1-reseal-round-008/seal-round-008.json'), '0a959de0383b57ad6cd1f33c124b398aa51c1e00', 'Step 1 seal blob');
assert.equal(blob('simulation/executable-seal-v2.json'), 'ee3507969c03b08fe27350263cf0bc093a1c18e1', 'Step 2 executable seal blob');
assert.equal(blob('quality-reviews/step-2-executable-contract-v2/final-live-readback.json'), '4d26695cc6359ad933249ac6fdf2eddca9be9c6f', 'Step 2 final live-readback blob');
assert.equal(blob('PROJECT_STATUS.json'), 'bec2334e9fd1da7e0760a06545094fbe538ef8be', 'project-status mirror blob');
assert.equal(blob('simulation/CURRENT_STATUS.json'), '9a853ea7edccda91ea52525392389a37a913d6d6', 'simulation-status mirror blob');
assert.equal(blob('AGENTS.md'), 'c502319772187da75f1920bc7ef864fa5ebe61fb', 'AGENTS mirror blob');
assert.equal(blob('PROJECT_HANDOVER.md'), '34369dc1bdcaa46f08880cec0434d4a5c1ecb654', 'handover mirror blob');

const allowedExactPaths = new Set([
  '.github/workflows/CURRENT_STATUS.md',
  '.github/workflows/verify-main.yml',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-014.json',
  'tests/governance/verify-current-step2-state.mjs',
]);
const allowedPrefixes = [
  'quality-reviews/step-2-governance-repair-round-001/',
];
const changedPaths = git('diff', '--name-only', repairBase, 'HEAD')
  .split('\n')
  .map((value) => value.trim())
  .filter(Boolean);
for (const changedPath of changedPaths) {
  const allowed = allowedExactPaths.has(changedPath) || allowedPrefixes.some((prefix) => changedPath.startsWith(prefix));
  assert.ok(allowed, `forbidden repair-scope path changed: ${changedPath}`);
}

const acceptance = readJson('quality-reviews/step-2-governance-repair-round-001/acceptance-matrix.json');
assert.equal(acceptance.repository, expectedRepository);
assert.equal(acceptance.branch, 'kimi');
assert.equal(acceptance.entry.head, repairBase);
assert.equal(acceptance.authority.step1Seal.blob, '0a959de0383b57ad6cd1f33c124b398aa51c1e00');
assert.equal(acceptance.authority.step2Seal.blob, 'ee3507969c03b08fe27350263cf0bc093a1c18e1');

const active = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
assert.equal(active.revision, 7);
assert.equal(active.status, 'PASS');
assert.equal(active.verdict, 'PASS');
assert.equal(active.step2Allowed, true);
assert.equal(active.step3Allowed, true);
assert.equal(active.activationEvidence.latestAddendum, 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-014.json');
assert.equal(active.activeSeal.blob, '0a959de0383b57ad6cd1f33c124b398aa51c1e00');
assert.equal(active.activeStep2Seal.blob, 'ee3507969c03b08fe27350263cf0bc093a1c18e1');
assert.equal(active.activeStep2Seal.balanceVerdict, 'NOT_EVALUATED_STEP2');
assert.equal(active.authorizedExecutionSequence[0].status, 'PASS');
assert.equal(active.authorizedExecutionSequence[1].status, 'PASS');
assert.equal(active.authorizedExecutionSequence[2].status, 'READY_TO_START');
assert.equal(active.physicalIPhoneVerified, false);
assert.equal(active.productionAliasChanged, false);

const addendum = readJson('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-014.json');
assert.equal(addendum.status, 'PASS');
assert.equal(addendum.verdict, 'PASS');
assert.equal(addendum.step2Allowed, true);
assert.equal(addendum.step3Allowed, true);
assert.equal(addendum.executionState[0].status, 'PASS');
assert.equal(addendum.executionState[1].status, 'PASS');
assert.equal(addendum.executionState[2].status, 'READY_TO_START');
assert.equal(addendum.step2Evidence.executableSeal.blob, 'ee3507969c03b08fe27350263cf0bc093a1c18e1');
assert.equal(addendum.step2Evidence.balanceVerdict, 'NOT_EVALUATED_STEP2');
assert.equal(addendum.step3Executed, false);
assert.equal(addendum.physicalIPhoneVerified, false);
assert.equal(addendum.productionChanged, false);

const policy = readJson('AI_PROJECT_POLICY.json');
assert.equal(policy.repository.fullName, expectedRepository);
assert.equal(policy.repository.allowedBranch, 'kimi');
assert.equal(policy.currentPhase.step, 2);
assert.equal(policy.currentPhase.status, 'PASS');
assert.equal(policy.currentPhase.phase, 'SEALED');
assert.equal(policy.currentPhase.step1Status, 'PASS');
assert.equal(policy.currentPhase.step3Allowed, true);
assert.equal(policy.activeStep2Seal.blob, 'ee3507969c03b08fe27350263cf0bc093a1c18e1');
assert.equal(policy.activeStep2Seal.balanceVerdict, 'NOT_EVALUATED_STEP2');
assert.equal(policy.writeBoundary.step3MayRun, true);
assert.equal(policy.writeBoundary.productionChanged, false);

const projectStatus = readJson('PROJECT_STATUS.json');
assert.equal(projectStatus.canonicalRepository, expectedRepository);
assert.equal(projectStatus.canonicalBranch, 'kimi');
assert.equal(projectStatus.currentStep, 2);
assert.equal(projectStatus.currentStepStatus, 'PASS');
assert.equal(projectStatus.step3Allowed, true);
assert.equal(projectStatus.step2Evidence.balanceVerdict, 'NOT_EVALUATED_STEP2');
assert.equal(projectStatus.step2Evidence.step3Authorized, true);
assert.equal(projectStatus.physicalIPhoneVerified, false);
assert.equal(projectStatus.productionChangedByCurrentWork, false);
assert.equal(projectStatus.authorizedExecutionSequence[1].status, 'PASS');
assert.equal(projectStatus.authorizedExecutionSequence[2].status, 'READY_TO_START');

const simulationStatus = readJson('simulation/CURRENT_STATUS.json');
assert.equal(simulationStatus.currentStep, 2);
assert.equal(simulationStatus.status, 'PASS');
assert.equal(simulationStatus.phase, 'SEALED');
assert.equal(simulationStatus.step3Allowed, true);
assert.equal(simulationStatus.qualificationScope.balanceVerdict, 'NOT_EVALUATED_STEP2');
assert.equal(simulationStatus.qualificationScope.step3Authorized, true);
assert.equal(simulationStatus.physicalIPhoneVerified, false);
assert.equal(simulationStatus.productionChanged, false);

const step2Readback = readJson('quality-reviews/step-2-executable-contract-v2/final-live-readback.json');
assert.equal(step2Readback.verdict, 'PASS_FINAL_LIVE_READBACK_STEP2_SEALED');
assert.equal(step2Readback.status.step2, 'PASS');
assert.equal(step2Readback.status.step3, 'READY_TO_START');
assert.equal(step2Readback.status.step3Executed, false);
assert.equal(step2Readback.status.physicalIPhoneVerified, false);
assert.equal(step2Readback.status.productionChanged, false);

const qualityGate = readText('QUALITY_GATE.md');
assertContains(qualityGate, '現在工程: **Step 2 — PASS / SEALED**', 'QUALITY_GATE.md');
assertContains(qualityGate, '次工程: **Step 3 — READY_TO_START**', 'QUALITY_GATE.md');
assertContains(qualityGate, 'balance verdict: `NOT_EVALUATED_STEP2`', 'QUALITY_GATE.md');
assert.ok(!qualityGate.includes('現在はStep 1のみ`PASS`'), 'QUALITY_GATE.md must not retain the obsolete current-state conclusion');

const workflowStatus = readText('.github/workflows/CURRENT_STATUS.md');
assertContains(workflowStatus, 'Step 2: `PASS — SEALED`', 'workflow CURRENT_STATUS.md');
assertContains(workflowStatus, 'Step 3: `READY_TO_START`', 'workflow CURRENT_STATUS.md');
assertContains(workflowStatus, 'historical-round7-evidence', 'workflow CURRENT_STATUS.md');
assertContains(workflowStatus, 'current-governance', 'workflow CURRENT_STATUS.md');

const agents = readText('AGENTS.md');
assertContains(agents, 'Step 2: **PASS — SEALED**', 'AGENTS.md');
assertContains(agents, 'Step 3: **READY_TO_START**', 'AGENTS.md');

const handover = readText('PROJECT_HANDOVER.md');
assertContains(handover, 'Current: **Step 2 — PASS / SEALED**', 'PROJECT_HANDOVER.md');
assertContains(handover, 'Step 3: **READY_TO_START**', 'PROJECT_HANDOVER.md');

const workflow = readText('.github/workflows/verify-main.yml');
assertContains(workflow, 'historical-round7-evidence:', 'verify-main.yml');
assertContains(workflow, 'current-governance:', 'verify-main.yml');
assert.ok(!workflow.includes('\n  pull_request:'), 'verify-main.yml must not operate through PR workflow');
assertContains(workflow, 'node tests/governance/verify-current-step2-state.mjs', 'verify-main.yml');
assertContains(workflow, 'node simulation/verify-step2-v2.mjs', 'verify-main.yml');

console.log(JSON.stringify({
  verdict: 'PASS_CURRENT_STEP2_GOVERNANCE',
  repository: expectedRepository,
  branch: 'kimi',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  changedPaths,
  state: {
    step1: 'PASS',
    step2: 'PASS_SEALED',
    step3: 'READY_TO_START',
    balance: 'NOT_EVALUATED_STEP2',
    physicalIPhone: 'NOT_VERIFIED',
    productionChanged: false,
  },
}, null, 2));
