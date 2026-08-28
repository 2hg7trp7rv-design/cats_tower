#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Verifies immutable Step 1-3 authority and the current Step 4 mockup lifecycle.
const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const ENTRY = '3eefbf6fa7dfcec8b5b093612e8946b43d838bc2';
const STEP4_ENTRY = '245d50b6e80e2783f6aeaab5e50fae217661a3b6';
const STEP3_ADDENDUM = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json';
const STEP4_ADDENDUM = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-017.json';
const STEP3_LIVE = `${STEP3}/live-readback.json`;
const STEP3_FINAL = `${STEP3}/final-judge.json`;
const STEP3_CORRECTION = `${STEP3}/terminal-mirror-correction.json`;
const STEP4_ACCEPTANCE = `${STEP4}/acceptance-matrix.json`;
const STEP4_FINAL = `${STEP4}/final-judge.json`;
const STEP4_LIVE = `${STEP4}/live-readback.json`;
const STEP3_BLOCK_BEGIN = '<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->';
const STEP3_BLOCK_END = '<!-- CATS_TOWER_STEP3_STATUS_END -->';
const STEP4_BLOCK_BEGIN = '<!-- CATS_TOWER_STEP4_STATUS_BEGIN -->';
const STEP4_BLOCK_END = '<!-- CATS_TOWER_STEP4_STATUS_END -->';

const readText = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const blob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
assert.equal(git('replace', '-l'), '');
execFileSync('git', ['merge-base', '--is-ancestor', ENTRY, 'HEAD'], { cwd: ROOT });

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
  [STEP4_ACCEPTANCE]: '7d907578c367ef426e11f97393637f23e14e25c2',
};
for (const [relativePath, expected] of Object.entries(immutable)) {
  assert(existsSync(path.join(ROOT, relativePath)), `${relativePath}: missing immutable authority`);
  assert.equal(blob(relativePath), expected, `${relativePath}: immutable authority blob mismatch`);
}

const step3Final = readJson(STEP3_FINAL);
const step3Live = readJson(STEP3_LIVE);
const step3Correction = readJson(STEP3_CORRECTION);
assert.equal(step3Final.step3Pass, true);
assert.equal(step3Live.verdict, 'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION');
assert.equal(step3Live.governanceDecision.step3, 'PASS');
assert.equal(step3Correction.verdict, 'PASS_STEP3_POST_TERMINAL_MIRROR_CORRECTION');
assert.equal(step3Correction.governanceDecision.unresolvedP0, 0);
assert.equal(step3Correction.governanceDecision.unresolvedP1, 0);

const project = readJson('PROJECT_STATUS.json');
const simulation = readJson('simulation/CURRENT_STATUS.json');
const policy = readJson('AI_PROJECT_POLICY.json');
const active = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
assert.equal(project.canonicalRepository, REPOSITORY);
assert.equal(project.canonicalBranch, BRANCH);
assert.equal(simulation.repository, REPOSITORY);
assert.equal(simulation.branch, BRANCH);
assert.equal(project.physicalIPhoneVerified, false);
assert.equal(simulation.physicalIPhoneVerified, false);
assert.notEqual(project.productionChangedByCurrentWork, true);
assert.notEqual(project.productionAliasChanged, true);
assert.equal(simulation.productionChanged, false);

const step4Active = existsSync(path.join(ROOT, STEP4_ADDENDUM));
if (!step4Active) {
  const step3Addendum = readJson(STEP3_ADDENDUM);
  assert.equal(active.status, 'PASS');
  assert.equal(active.verdict, 'PASS');
  assert.equal(Boolean(active.step4Allowed), true);
  assert.equal(step3Addendum.status, 'PASS');
  assert.equal(Boolean(step3Addendum.step4Allowed), true);
  assert.equal(policy.currentPhase.step, 3);
  assert.equal(policy.currentPhase.status, 'PASS');
  assert.equal(Boolean(policy.currentPhase.step4Allowed), true);
  assert.equal(project.currentStep, 3);
  assert.equal(project.currentStepStatus, 'PASS');
  assert.equal(project.status, 'PASS');
  assert.equal(Boolean(project.step4Allowed), true);
  assert.equal(simulation.currentStep, 3);
  assert.equal(simulation.status, 'PASS');
  assert.equal(Boolean(simulation.step4Allowed), true);
  for (const relativePath of ['QUALITY_GATE.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'PROJECT_HANDOVER.md']) {
    const content = readText(relativePath);
    assert(content.includes(STEP3_BLOCK_BEGIN), `${relativePath}: missing canonical Step 3 status block`);
    assert(content.includes(STEP3_BLOCK_END), `${relativePath}: incomplete canonical Step 3 status block`);
    const block = content.slice(content.indexOf(STEP3_BLOCK_BEGIN), content.indexOf(STEP3_BLOCK_END) + STEP3_BLOCK_END.length);
    assert(block.includes('- Step 3: **PASS**'), `${relativePath}: Step 3 status mismatch`);
    assert(block.includes('- Step 4: **READY_TO_START**'), `${relativePath}: Step 4 status mismatch`);
  }
  console.log(JSON.stringify({ verdict: 'PASS_CURRENT_STEP3_TERMINAL_STEP4_READY', head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), step4AcceptanceFrozen: true }));
  process.exit(0);
}

execFileSync('git', ['merge-base', '--is-ancestor', STEP4_ENTRY, 'HEAD'], { cwd: ROOT });
const step4Addendum = readJson(STEP4_ADDENDUM);
const step4Terminal = existsSync(path.join(ROOT, STEP4_LIVE));
const step4Final = existsSync(path.join(ROOT, STEP4_FINAL)) ? readJson(STEP4_FINAL) : null;
let expectedStatus = 'IN_PROGRESS';
let expectedStep5 = false;
let expectedStep5Label = 'BLOCKED_UNTIL_STEP4_PASS';
if (step4Terminal) {
  const live = readJson(STEP4_LIVE);
  assert(step4Final, 'Step 4 terminal read-back requires final judge');
  expectedStatus = live.governanceDecision?.step4 ?? (step4Final.step4Pass ? 'PASS' : 'FAIL');
  expectedStep5 = live.governanceDecision?.step5 === 'READY_TO_START';
  expectedStep5Label = expectedStep5 ? 'READY_TO_START' : 'BLOCKED_BY_STEP4_FAILURE';
}

assert.equal(active.status, expectedStatus);
assert.equal(active.verdict, expectedStatus === 'IN_PROGRESS' ? 'IN_PROGRESS_STEP4' : expectedStatus);
assert.equal(Boolean(active.step4Allowed), true);
assert.equal(Boolean(active.step5Allowed), expectedStep5);
assert.equal(step4Addendum.status, expectedStatus);
assert.equal(Boolean(step4Addendum.step4Allowed), true);
assert.equal(Boolean(step4Addendum.step5Allowed), expectedStep5);
assert.equal(policy.currentPhase.step, 4);
assert.equal(policy.currentPhase.status, expectedStatus);
assert.equal(Boolean(policy.currentPhase.step4Allowed), true);
assert.equal(Boolean(policy.currentPhase.step5Allowed), expectedStep5);
assert.equal(project.currentStep, 4);
assert.equal(project.currentStepStatus, expectedStatus);
assert.equal(project.status, expectedStatus);
assert.equal(Boolean(project.step4Allowed), true);
assert.equal(Boolean(project.step5Allowed), expectedStep5);
assert.equal(simulation.currentStep, 4);
assert.equal(simulation.status, expectedStatus);
assert.equal(Boolean(simulation.step4Allowed), true);
assert.equal(Boolean(simulation.step5Allowed), expectedStep5);
assert.equal(project.step3.status, 'PASS');
assert.equal(project.step3.liveReadback, 'PASS');
assert.equal(simulation.step3.status, 'PASS');
assert.equal(simulation.step3.liveReadback, 'PASS');

for (const relativePath of ['QUALITY_GATE.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'PROJECT_HANDOVER.md']) {
  const content = readText(relativePath);
  assert(content.includes(STEP4_BLOCK_BEGIN), `${relativePath}: missing canonical Step 4 status block`);
  assert(content.includes(STEP4_BLOCK_END), `${relativePath}: incomplete canonical Step 4 status block`);
  const block = content.slice(content.indexOf(STEP4_BLOCK_BEGIN), content.indexOf(STEP4_BLOCK_END) + STEP4_BLOCK_END.length);
  assert(block.includes(`- Step 4: **${expectedStatus}**`), `${relativePath}: Step 4 status mismatch`);
  assert(block.includes(`- Step 5: **${expectedStep5Label}**`), `${relativePath}: Step 5 status mismatch`);
  assert(block.includes('- Physical iPhone: **NOT_VERIFIED**'));
  assert(block.includes('- Production alias changed: **false**'));
}

for (const relativePath of [
  `${STEP4}/mockups/index.html`,
  `${STEP4}/mockups/styles.css`,
  `${STEP4}/mockups/app.js`,
  `${STEP4}/reference-audit.md`,
  `${STEP4}/design-system.json`,
  `${STEP4}/screen-state-coverage.json`,
  `${STEP4}/source-manifest.json`,
  `${STEP4}/start-evidence.json`,
]) assert(existsSync(path.join(ROOT, relativePath)), `${relativePath}: missing Step 4 source`);

const changedOutput = git('diff', '--name-only', `${STEP4_ENTRY}..HEAD`);
const changed = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
const forbidden = changed.filter((relativePath) => /^(runtime\/|public\/|assets\/|backend\/)/.test(relativePath)
  || /^(vercel\.json|\.vercel\/)/.test(relativePath)
  || /^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/.test(relativePath)
  || /^quality-reviews\/step-3-large-scale-validation\/(gameplay-|high-volume\/|analysis\.json|critic-summary\.json|critics\/|final-judge\.json|completion-evidence\.json|live-readback\.json|execution-gate\.json|execution-live-readback-v2\.json)/.test(relativePath));
assert.deepEqual(forbidden, []);

console.log(JSON.stringify({ verdict: step4Terminal ? 'PASS_CURRENT_STEP4_TERMINAL_STATE' : 'PASS_CURRENT_STEP4_IN_PROGRESS', head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), status: expectedStatus, step5Allowed: expectedStep5, changedPathCount: changed.length }));
