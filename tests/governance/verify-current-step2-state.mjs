#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Verifies immutable Step 1/2 authority throughout the Step 3 in-progress and terminal lifecycle.
const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const ENTRY = '3eefbf6fa7dfcec8b5b093612e8946b43d838bc2';
const ADDENDUM = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json';
const LIVE = `${STEP3}/live-readback.json`;
const FINAL = `${STEP3}/final-judge.json`;
const MIRROR_CORRECTION = `${STEP3}/terminal-mirror-correction.json`;
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
assert.equal(blob(`${STEP3}/acceptance-matrix.json`), 'd1392c431282d0faae9e9ad7f1c22161a3c5caad');
assert.equal(blob(`${STEP3}/execution-gate.json`), 'e499cdb421d17a5e1ee79ca4ffff204fed80e60e');
assert.equal(blob(`${STEP3}/execution-live-readback-v2.json`), '073252683f207cf9f42d2f8b2634b10ae36ff8b5');

const project = readJson('PROJECT_STATUS.json');
const simulation = readJson('simulation/CURRENT_STATUS.json');
assert.equal(project.canonicalRepository, REPOSITORY);
assert.equal(project.canonicalBranch, BRANCH);
assert.equal(simulation.repository, REPOSITORY);
assert.equal(simulation.branch, BRANCH);
assert.equal(project.physicalIPhoneVerified, false);
assert.equal(simulation.physicalIPhoneVerified, false);
assert.notEqual(project.productionChangedByCurrentWork, true);
assert.notEqual(project.productionAliasChanged, true);
assert.equal(simulation.productionChanged, false);

const step3Activated = existsSync(path.join(ROOT, ADDENDUM));
const terminal = existsSync(path.join(ROOT, LIVE));

if (!step3Activated) {
  assert.equal(project.currentStep, 2);
  assert.equal(project.currentStepStatus ?? project.status, 'PASS');
  assert.equal(project.step3Allowed, true);
  assert.notEqual(project.step4Allowed, true);
  assert.equal(simulation.currentStep, 2);
  assert.equal(simulation.status, 'PASS');
  assert.equal(simulation.step3Allowed, true);
  assert.notEqual(simulation.step4Allowed, true);
  console.log(JSON.stringify({ verdict: 'PASS_CURRENT_STEP2_SEALED_STEP3_EXECUTION_EVIDENCE_PENDING_CRITICS', head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') }));
  process.exit(0);
}

const active = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
const addendum = readJson(ADDENDUM);
const policy = readJson('AI_PROJECT_POLICY.json');
const finalJudge = existsSync(path.join(ROOT, FINAL)) ? readJson(FINAL) : null;

let expectedStatus;
let expectedStep4;
if (terminal) {
  assert(finalJudge, 'Terminal state requires final judge');
  expectedStatus = finalJudge.step3Pass ? 'PASS' : 'FAIL';
  expectedStep4 = Boolean(finalJudge.step3Pass);
} else if (finalJudge?.step3Pass === false) {
  expectedStatus = 'FAIL_PENDING_TERMINAL_EVIDENCE';
  expectedStep4 = false;
} else {
  expectedStatus = 'IN_PROGRESS';
  expectedStep4 = false;
}

assert.equal(active.status, expectedStatus);
assert.equal(active.verdict, expectedStatus);
assert.equal(Boolean(active.step4Allowed), expectedStep4);
assert.equal(addendum.status, expectedStatus);
assert.equal(Boolean(addendum.step4Allowed), expectedStep4);
assert.equal(policy.currentPhase.step, 3);
assert.equal(policy.currentPhase.status, expectedStatus);
assert.equal(Boolean(policy.currentPhase.step4Allowed), expectedStep4);
assert.equal(project.currentStep, 3);
assert.equal(project.currentStepStatus, expectedStatus);
assert.equal(project.status, expectedStatus);
assert.equal(Boolean(project.step4Allowed), expectedStep4);
assert.equal(simulation.currentStep, 3);
assert.equal(simulation.status, expectedStatus);
assert.equal(Boolean(simulation.step4Allowed), expectedStep4);

for (const relativePath of ['QUALITY_GATE.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'PROJECT_HANDOVER.md']) {
  const content = readText(relativePath);
  assert(content.includes(BLOCK_BEGIN), `${relativePath}: missing canonical Step 3 status block`);
  assert(content.includes(BLOCK_END), `${relativePath}: incomplete canonical Step 3 status block`);
  const block = content.slice(content.indexOf(BLOCK_BEGIN), content.indexOf(BLOCK_END) + BLOCK_END.length);
  assert(block.includes(`- Step 3: **${expectedStatus}**`), `${relativePath}: Step 3 status mismatch`);
  assert(block.includes(`- Step 4: **${expectedStep4 ? 'READY_TO_START' : (finalJudge?.step3Pass === false ? 'BLOCKED_BY_STEP3_FAILURE' : 'BLOCKED_UNTIL_TERMINAL_EVIDENCE')}**`), `${relativePath}: Step 4 status mismatch`);
  assert(block.includes('- Physical iPhone: **NOT_VERIFIED**'));
  assert(block.includes('- Production alias changed: **false**'));
}

const changedOutput = git('diff', '--name-only', `${ENTRY}..HEAD`);
const changed = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
const forbidden = changed.filter((relativePath) => /^(runtime\/|public\/|assets\/|backend\/)/.test(relativePath)
  || /^(vercel\.json|\.vercel\/)/.test(relativePath)
  || /^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/.test(relativePath));
assert.deepEqual(forbidden, []);

if (existsSync(path.join(ROOT, MIRROR_CORRECTION))) {
  const correction = readJson(MIRROR_CORRECTION);
  assert.equal(correction.repository, REPOSITORY);
  assert.equal(correction.branch, BRANCH);
  assert.equal(correction.verdict, 'PASS_STEP3_POST_TERMINAL_MIRROR_CORRECTION');
  assert.equal(correction.governanceDecision.step3, 'PASS');
  assert.equal(correction.governanceDecision.step4, 'READY_TO_START');
  assert.equal(correction.governanceDecision.unresolvedP0, 0);
  assert.equal(correction.governanceDecision.unresolvedP1, 0);
  for (const [relativePath, expectedBlob] of Object.entries(correction.mirrorBlobs)) {
    assert.equal(blob(relativePath), expectedBlob, `${relativePath}: post-terminal mirror correction blob mismatch`);
  }
  assert.equal(project.step3.liveReadback, 'PASS');
  assert.equal(project.step3.terminalMirrorCorrection, MIRROR_CORRECTION);
  assert.equal(simulation.step3.liveReadback, 'PASS');
  assert.equal(simulation.step3.terminalMirrorCorrection, MIRROR_CORRECTION);
  assert.equal(active.activationEvidence.step3LiveReadback, LIVE);
  assert.equal(active.activationEvidence.step3TerminalMirrorCorrection, MIRROR_CORRECTION);
}

console.log(JSON.stringify({ verdict: terminal ? 'PASS_CURRENT_STEP3_TERMINAL_STATE' : 'PASS_CURRENT_STEP3_PENDING_TERMINAL_STATE', head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), status: expectedStatus, step4Allowed: expectedStep4, changedPathCount: changed.length, mirrorCorrection: existsSync(path.join(ROOT, MIRROR_CORRECTION)) }));
