#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Verifies immutable Step 1/2 authority throughout the Step 3 in-progress and terminal PASS lifecycle.
const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const ENTRY = '3eefbf6fa7dfcec8b5b093612e8946b43d838bc2';
const ADDENDUM = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json';
const LIVE = `${STEP3}/live-readback.json`;
const FINAL = `${STEP3}/final-judge.json`;
const BLOCK_BEGIN = '<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->';
const BLOCK_END = '<!-- CATS_TOWER_STEP3_STATUS_END -->';

const readText = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const blob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
assert.equal(git('replace', '-l'), '');
execFileSync('git', ['merge-base', '--is-ancestor', ENTRY, 'HEAD'], { cwd: ROOT });

assert.equal(blob('quality-reviews/step-1-reseal-round-008/seal-round-008.json'), '0a959de0383b57ad6cd1f33c124b398aa51c1e00');
assert.equal(blob('simulation/executable-seal-v2.json'), 'ee3507969c03b08fe27350263cf0bc093a1c18e1');
assert.equal(blob('quality-reviews/step-2-governance-repair-round-001/live-readback.json'), '692434fafd19d1e5470fe58808fd72af7286ec35');

const project = readJson('PROJECT_STATUS.json');
const simulation = readJson('simulation/CURRENT_STATUS.json');
const policy = readJson('AI_PROJECT_POLICY.json');
const control = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
const addendum = existsSync(path.join(ROOT, ADDENDUM)) ? readJson(ADDENDUM) : null;
const finalJudge = existsSync(path.join(ROOT, FINAL)) ? readJson(FINAL) : null;
const live = existsSync(path.join(ROOT, LIVE)) ? readJson(LIVE) : null;

assert.equal(project.canonicalRepository, REPOSITORY);
assert.equal(project.canonicalBranch, BRANCH);
assert.equal(simulation.repository, REPOSITORY);
assert.equal(simulation.branch, BRANCH);
assert.equal(policy.repository, REPOSITORY);
assert.equal(policy.branch, BRANCH);
assert.equal(control.repository, REPOSITORY);
assert.equal(control.branch, BRANCH);

const step3Lifecycle = project.currentStep === 3 || project.step3?.status !== undefined || simulation.currentStep === 3 || addendum !== null || live !== null;
if (!step3Lifecycle) {
  assert.equal(project.currentStep, 2);
  assert.equal(project.currentStepStatus, 'PASS');
  assert.equal(project.step3Allowed, true);
  assert.equal(simulation.currentStep, 2);
  assert.equal(simulation.status, 'PASS');
  assert.equal(simulation.phase, 'SEALED');
  assert.equal(simulation.step3Allowed, true);
  assert.equal(policy.currentPhase.step, 2);
  assert.equal(policy.currentPhase.status, 'PASS');
  assert.equal(policy.currentPhase.step3Allowed, true);
  assert.equal(control.step3Allowed, true);
} else {
  assert(addendum, 'Step 3 lifecycle requires round-015 change control addendum');
  assert.equal(addendum.repository, REPOSITORY);
  assert.equal(addendum.branch, BRANCH);
  assert.equal(addendum.step1Status, 'PASS');
  assert.equal(addendum.step2Status, 'PASS_SEALED');
  assert.equal(addendum.step3Allowed, true);
  assert.equal(control.step3Allowed, true);
  assert.equal(project.currentStep, 3);
  assert.equal(simulation.currentStep, 3);
  assert.equal(policy.currentPhase.step, 3);
  assert.equal(project.step3Allowed, true);
  assert.equal(simulation.step3Allowed, true);
  assert.equal(policy.currentPhase.step3Allowed, true);

  if (live) {
    assert(finalJudge, 'Terminal live read-back requires final judge');
    assert.equal(live.repository, REPOSITORY);
    assert.equal(live.branch, BRANCH);
    assert.equal(live.criticSummary.criticCount, 5);
    assert.equal(live.governanceDecision.unresolvedP0, 0);
    assert.equal(live.governanceDecision.unresolvedP1, 0);
    assert.equal(live.scopeReadback.candidateChanged, false);
    assert.equal(live.scopeReadback.holdoutUsedForTuning, false);
    assert.equal(live.scopeReadback.productionAliasChanged, false);
    assert.equal(live.scopeReadback.physicalIPhoneVerified, false);
    assert.equal(project.currentStepStatus, live.governanceDecision.step3);
    assert.equal(simulation.status, live.governanceDecision.step3);
    assert.equal(policy.currentPhase.status, live.governanceDecision.step3);
    assert.equal(project.step4Allowed, live.governanceDecision.step4 === 'READY_TO_START');
    assert.equal(simulation.step4Allowed, live.governanceDecision.step4 === 'READY_TO_START');
    assert.equal(policy.currentPhase.step4Allowed, live.governanceDecision.step4 === 'READY_TO_START');
    assert.equal(finalJudge.step3Pass, live.governanceDecision.step3 === 'PASS');
  } else {
    assert.equal(project.currentStepStatus, 'IN_PROGRESS');
    assert.equal(simulation.status, 'IN_PROGRESS');
    assert.equal(policy.currentPhase.status, 'IN_PROGRESS');
    assert.equal(project.step4Allowed, false);
    assert.equal(simulation.step4Allowed, false);
    assert.equal(policy.currentPhase.step4Allowed, false);
  }
}

assert.equal(project.physicalIPhoneVerified, false);
assert.equal(simulation.physicalIPhoneVerified, false);
assert.equal(policy.currentPhase.physicalIPhone, 'NOT_VERIFIED');
assert.equal(project.productionAliasChanged ?? false, false);
assert.equal(simulation.productionChanged, false);

const expectedStatus = live ? live.governanceDecision.step3 : (step3Lifecycle ? 'IN_PROGRESS' : 'PASS');
const expectedStep4 = live ? live.governanceDecision.step4 : (step3Lifecycle ? 'BLOCKED_UNTIL_TERMINAL_EVIDENCE' : 'READY_TO_START');
const expectedBalance = live ? live.governanceDecision.balanceVerdict : (step3Lifecycle ? 'PASS_PENDING_EVIDENCE' : 'NOT_EVALUATED_STEP2');
for (const relativePath of ['QUALITY_GATE.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'PROJECT_HANDOVER.md']) {
  const text = readText(relativePath);
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (step3Lifecycle) {
    assert(start >= 0 && end > start, `${relativePath}: missing Step 3 status block`);
    const block = text.slice(start, end + BLOCK_END.length);
    assert(block.includes(`Step 3: **${expectedStatus}**`), `${relativePath}: Step 3 status mismatch`);
    assert(block.includes(`Step 4: **${expectedStep4}**`), `${relativePath}: Step 4 status mismatch`);
    assert(block.includes(`Balance verdict: **${expectedBalance}**`), `${relativePath}: balance verdict mismatch`);
    assert(block.includes('Physical iPhone: **NOT_VERIFIED**'), `${relativePath}: physical iPhone mismatch`);
    assert(block.includes('Production alias changed: **false**'), `${relativePath}: Production mismatch`);
  }
}

console.log(JSON.stringify({
  ok: true,
  repository: REPOSITORY,
  branch: BRANCH,
  step1: 'PASS',
  step2: 'PASS_SEALED',
  step3: step3Lifecycle ? expectedStatus : 'READY_TO_START',
  step4: expectedStep4,
  balanceVerdict: expectedBalance,
  physicalIPhone: 'NOT_VERIFIED',
  productionChanged: false,
}));
