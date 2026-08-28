#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP3_ENTRY = '3eefbf6fa7dfcec8b5b093612e8946b43d838bc2';
const STEP4_ENTRY = '245d50b6e80e2783f6aeaab5e50fae217661a3b6';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const STEP4_ACCEPTANCE = `${STEP4}/acceptance-matrix.json`;
const STEP4_DRAFT = `${STEP4}/render-manifest.json`;
const STEP4_ACTIVATION = `${STEP4}/draft-activation-evidence.json`;
const STEP4_LIVE = `${STEP4}/draft-live-readback.json`;
const STEP4_FINAL = `${STEP4}/final-judge.json`;
const BLOCKS = [
  ['<!-- CATS_TOWER_STEP4_STATUS_BEGIN -->', '<!-- CATS_TOWER_STEP4_STATUS_END -->'],
  ['<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->', '<!-- CATS_TOWER_STEP3_STATUS_END -->'],
];

const abs = (relativePath) => path.join(ROOT, relativePath);
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const blob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);
const exists = (relativePath) => existsSync(abs(relativePath));

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
assert.equal(git('replace', '-l'), '');
execFileSync('git', ['merge-base', '--is-ancestor', STEP3_ENTRY, 'HEAD'], { cwd: ROOT });
execFileSync('git', ['merge-base', '--is-ancestor', STEP4_ENTRY, 'HEAD'], { cwd: ROOT });

const immutable = {
  'quality-reviews/step-1-reseal-round-008/seal-round-008.json': '0a959de0383b57ad6cd1f33c124b398aa51c1e00',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
  'quality-reviews/step-2-governance-repair-round-001/live-readback.json': '692434fafd19d1e5470fe58808fd72af7286ec35',
  [`${STEP3}/acceptance-matrix.json`]: 'd1392c431282d0faae9e9ad7f1c22161a3c5caad',
  [`${STEP3}/execution-gate.json`]: 'e499cdb421d17a5e1ee79ca4ffff204fed80e60e',
  [`${STEP3}/execution-live-readback-v2.json`]: '073252683f207cf9f42d2f8b2634b10ae36ff8b5',
  [`${STEP3}/critic-summary.json`]: '197f2a0949a8f6eb398f9614f79ab79562471fb2',
  [`${STEP3}/final-judge.json`]: 'a089266f56076a0b2a59b2670188d95ae8eff3d2',
  [`${STEP3}/completion-evidence.json`]: 'bc808fc3129f81000f1c5e755ffb2fc3a05bcf0b',
  [`${STEP3}/live-readback.json`]: 'd0b73af25a8f0d449cfc083b007b84b8ff3fbc9b',
  [`${STEP3}/terminal-mirror-correction.json`]: '14a9208b49c0b683e215cbefe587fedf67c2cac0',
};
for (const [relativePath, expectedBlob] of Object.entries(immutable)) {
  assert(exists(relativePath), `${relativePath}: missing immutable authority`);
  assert.equal(blob(relativePath), expectedBlob, `${relativePath}: immutable authority blob mismatch`);
}

const step3Live = readJson(`${STEP3}/live-readback.json`);
const step3Correction = readJson(`${STEP3}/terminal-mirror-correction.json`);
assert.equal(step3Live.verdict, 'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION');
assert.equal(step3Live.governanceDecision.step3, 'PASS');
assert.equal(step3Live.governanceDecision.step4, 'READY_TO_START');
assert.equal(step3Live.criticSummary.criticCount, 5);
assert.equal(step3Live.governanceDecision.unresolvedP0, 0);
assert.equal(step3Live.governanceDecision.unresolvedP1, 0);
assert.equal(step3Live.scopeReadback.productionAliasChanged, false);
assert.equal(step3Live.scopeReadback.physicalIPhoneVerified, false);
assert.equal(step3Live.scopeReadback.holdoutUsedForTuning, false);
assert.equal(step3Correction.verdict, 'PASS_STEP3_POST_TERMINAL_MIRROR_CORRECTION');
assert.equal(step3Correction.scope.productSemanticsChanged, false);
assert.equal(step3Correction.scope.rawExecutionEvidenceChanged, false);
assert.equal(step3Correction.scope.productionAliasChanged, false);
assert.equal(step3Correction.scope.physicalIPhoneVerified, false);

const project = readJson('PROJECT_STATUS.json');
const simulation = readJson('simulation/CURRENT_STATUS.json');
const policy = readJson('AI_PROJECT_POLICY.json');
const active = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
assert.equal(project.canonicalRepository, REPOSITORY);
assert.equal(project.canonicalBranch, BRANCH);
assert.equal(simulation.repository, REPOSITORY);
assert.equal(simulation.branch, BRANCH);
assert.equal(policy.repository.fullName, REPOSITORY);
assert.equal(policy.repository.allowedBranch, BRANCH);
assert.equal(active.repository, REPOSITORY);
assert.equal(active.branch, BRANCH);
assert.equal(project.physicalIPhoneVerified, false);
assert.equal(simulation.physicalIPhoneVerified, false);
assert.equal(policy.currentPhase.physicalIPhone, 'NOT_VERIFIED');
assert.equal(project.productionChangedByCurrentWork, false);
assert.equal(project.productionAliasChanged, false);
assert.equal(simulation.productionChanged, false);
assert.equal(active.productionAliasChanged, false);

const step4Accepted = exists(STEP4_ACCEPTANCE);
const step4Drafted = exists(STEP4_DRAFT);
const step4Activated = exists(STEP4_ACTIVATION);
const step4Live = exists(STEP4_LIVE) ? readJson(STEP4_LIVE) : null;
const step4Final = exists(STEP4_FINAL) ? readJson(STEP4_FINAL) : null;

let lifecycle;
let expectedCurrentStep;
let expectedStatus;
let expectedStep5Allowed;
let expectedStep4Label;
let expectedStep5Label;

if (!step4Accepted) {
  lifecycle = 'STEP3_TERMINAL_STEP4_READY';
  expectedCurrentStep = 3;
  expectedStatus = 'PASS';
  expectedStep5Allowed = false;
  expectedStep4Label = 'READY_TO_START';
  expectedStep5Label = 'BLOCKED_UNTIL_STEP4_PASS';
} else if (!step4Activated) {
  lifecycle = step4Drafted ? 'STEP4_DRAFT_PRE_ACTIVATION' : 'STEP4_ACCEPTANCE_PRE_DRAFT';
  expectedCurrentStep = 3;
  expectedStatus = 'PASS';
  expectedStep5Allowed = false;
  expectedStep4Label = 'READY_TO_START';
  expectedStep5Label = 'BLOCKED_UNTIL_STEP4_PASS';
  assert.equal(blob(STEP4_ACCEPTANCE), '7d907578c367ef426e11f97393637f23e14e25c2');
} else if (!step4Live) {
  lifecycle = 'STEP4_IN_PROGRESS_PENDING_LIVE_READBACK';
  expectedCurrentStep = 4;
  expectedStatus = 'IN_PROGRESS';
  expectedStep5Allowed = false;
  expectedStep4Label = 'IN_PROGRESS';
  expectedStep5Label = 'BLOCKED_UNTIL_STEP4_PASS';
} else if (!step4Final) {
  lifecycle = 'STEP4_IN_PROGRESS_DRAFT_LIVE';
  expectedCurrentStep = 4;
  expectedStatus = 'IN_PROGRESS';
  expectedStep5Allowed = false;
  expectedStep4Label = 'IN_PROGRESS';
  expectedStep5Label = 'BLOCKED_UNTIL_STEP4_PASS';
  assert.equal(step4Live.governanceDecision.step4, 'IN_PROGRESS');
  assert.equal(step4Live.governanceDecision.step5, 'BLOCKED_UNTIL_STEP4_PASS');
  assert.equal(step4Live.scope.productionAliasChanged, false);
  assert.equal(step4Live.scope.physicalIPhoneVerified, false);
} else {
  lifecycle = step4Final.step4Pass ? 'STEP4_TERMINAL_PASS' : 'STEP4_TERMINAL_FAIL';
  expectedCurrentStep = 4;
  expectedStatus = step4Final.step4Pass ? 'PASS' : 'FAIL';
  expectedStep5Allowed = Boolean(step4Final.step4Pass);
  expectedStep4Label = expectedStatus;
  expectedStep5Label = expectedStep5Allowed ? 'READY_TO_START' : 'BLOCKED_BY_STEP4_FAILURE';
}

assert.equal(project.currentStep, expectedCurrentStep);
assert.equal(simulation.currentStep, expectedCurrentStep);
assert.equal(policy.currentPhase.step, expectedCurrentStep);
assert.equal(project.currentStepStatus, expectedStatus);
assert.equal(project.status, expectedStatus);
assert.equal(simulation.status, expectedStatus);
assert.equal(policy.currentPhase.status, expectedStatus);
assert.equal(active.status, expectedStatus);
assert.equal(active.verdict, expectedStatus);
assert.equal(Boolean(project.step5Allowed), expectedStep5Allowed);
assert.equal(Boolean(simulation.step5Allowed), expectedStep5Allowed);
assert.equal(Boolean(policy.currentPhase.step5Allowed), expectedStep5Allowed);
assert.equal(Boolean(active.step5Allowed), expectedStep5Allowed);

function currentBlock(relativePath) {
  const content = readText(relativePath);
  for (const [begin, end] of BLOCKS) {
    const start = content.indexOf(begin);
    const finish = content.indexOf(end);
    if (start >= 0 && finish > start) return content.slice(start, finish + end.length);
  }
  throw new Error(`${relativePath}: missing current status block`);
}

for (const relativePath of ['QUALITY_GATE.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'PROJECT_HANDOVER.md']) {
  const block = currentBlock(relativePath);
  assert(block.includes('- Step 1: **PASS**'), `${relativePath}: Step 1 mismatch`);
  assert(block.includes('- Step 2: **PASS / SEALED**'), `${relativePath}: Step 2 mismatch`);
  assert(block.includes('- Step 3: **PASS**'), `${relativePath}: Step 3 mismatch`);
  assert(block.includes(`- Step 4: **${expectedStep4Label}**`), `${relativePath}: Step 4 mismatch`);
  if (expectedCurrentStep === 4) assert(block.includes(`- Step 5: **${expectedStep5Label}**`), `${relativePath}: Step 5 mismatch`);
  assert(block.includes('- Physical iPhone: **NOT_VERIFIED**'));
  assert(block.includes('- Production alias changed: **false**'));
}

const changedOutput = git('diff', '--name-only', `${STEP4_ENTRY}..HEAD`);
const changed = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
const allowedExact = new Set([
  'tests/governance/verify-current-step2-state.mjs',
  'PROJECT_STATUS.json',
  'simulation/CURRENT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  '.github/workflows/CURRENT_STATUS.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'README.md',
  'CHATGPT_PROJECT_BOOTSTRAP.md',
  'CUSTOM_GPT_CONFIGURATION.md',
  'simulation/INPUT_CONTRACT.md',
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-017.json',
]);
const allowed = (relativePath) =>
  relativePath.startsWith(`${STEP4}/`) ||
  relativePath.startsWith('tests/step4/') ||
  (relativePath.startsWith('.github/workflows/') && /step-4|step4/u.test(relativePath)) ||
  allowedExact.has(relativePath);
const forbidden = changed.filter((relativePath) => !allowed(relativePath));
assert.deepEqual(forbidden, [], `forbidden current-lifecycle path(s): ${forbidden.join(', ')}`);
assert.deepEqual(changed.filter((relativePath) => /^(runtime\/|assets\/|public\/|backend\/|vercel\.json|\.vercel\/)/u.test(relativePath)), []);
assert.deepEqual(changed.filter((relativePath) => /^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/u.test(relativePath)), []);

git('diff', '--check', `${STEP4_ENTRY}..HEAD`);

console.log(JSON.stringify({
  verdict: 'PASS_CURRENT_CATS_TOWER_LIFECYCLE_GOVERNANCE',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  lifecycle,
  currentStep: expectedCurrentStep,
  status: expectedStatus,
  step4: expectedStep4Label,
  step5: expectedStep5Label,
  changedPathCount: changed.length,
  forbiddenPathCount: forbidden.length,
  physicalIPhone: 'NOT_VERIFIED',
  productionChanged: false,
}));
