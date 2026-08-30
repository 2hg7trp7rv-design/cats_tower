#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const RECOVERY_ENTRY = '3ccff631e9e9174a69ec4e5e904c4dfbc552dbe9';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const LATEST_ADDENDUM = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-024.json';
const CRITIC = `${STEP4}/s02-main-entry-governance-recovery-critic-summary.json`;
const JUDGE = `${STEP4}/s02-main-entry-governance-recovery-final-judge.json`;
const COMPLETION = `${STEP4}/s02-main-entry-governance-recovery-completion-evidence.json`;
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
execFileSync('git', ['merge-base', '--is-ancestor', RECOVERY_ENTRY, 'HEAD'], { cwd: ROOT });

const sealedImmutable = {
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
for (const [relativePath, expectedBlob] of Object.entries(sealedImmutable)) {
  assert(exists(relativePath), `${relativePath}: missing immutable authority`);
  assert.equal(blob(relativePath), expectedBlob, `${relativePath}: immutable authority blob mismatch`);
}

const recoveredRuntimeImmutable = {
  'game-core.js': '34471eaa185b2355f17a8e8860261f63ee86bdaf',
  'game-data.js': 'fa01689275f05f1e0879c40586499cc74c337cf9',
  'sw.js': '16aca2f8f94fdfbcf8b228a331e35288fcbc2365',
  'simulation/candidate-v2.json': '1e633de1c6ecb1f98cee262b88575387816cf310',
  'runtime/s02-runtime.css': '6633698d77511d1e0725545e16aec9c2a18ca49c',
  'runtime/s02-runtime-fixes.css': 'fcbbeba2d8541691dbdd11c96c7c8817b1e6842b',
  'runtime/s02-runtime.js': 'fb03de942075ec05bcab476234205288688d639d',
  'runtime/s02-battle-renderer.js': 'de2f6fbfe1f316d6bc15081088bab6b0179344ff',
};
for (const [relativePath, expectedBlob] of Object.entries(recoveredRuntimeImmutable)) {
  assert(exists(relativePath), `${relativePath}: missing recovery-bound runtime file`);
  assert.equal(blob(relativePath), expectedBlob, `${relativePath}: recovery-bound runtime changed`);
}

for (const required of [LATEST_ADDENDUM, CRITIC, JUDGE, COMPLETION]) {
  assert(exists(required), `${required}: missing current recovery authority`);
}
const activeRoot = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
const latest = readJson(LATEST_ADDENDUM);
const critic = readJson(CRITIC);
const judge = readJson(JUDGE);
const completion = readJson(COMPLETION);
assert.equal(activeRoot.status, 'PASS');
assert.equal(latest.status, 'IN_PROGRESS');
assert.equal(latest.verdict, 'IN_PROGRESS_STEP4_S02_GOVERNANCE_VERIFIER_AND_MIRROR_SYNC');
assert.equal(latest.step5Allowed, false);
assert.equal(critic.verdict, 'IN_PROGRESS_S02_RECOVERY_TECHNICAL_PASS_VISUAL_P1_OPEN');
assert.equal(critic.unresolved.P0, 0);
assert.equal(critic.unresolved.P1, 1);
assert.equal(critic.step4Pass, false);
assert.equal(critic.step5Allowed, false);
assert.equal(judge.verdict, 'IN_PROGRESS_S02_RECOVERY_TECHNICAL_PASS_VISUAL_P1_OPEN');
assert.equal(judge.unresolvedP0, 0);
assert.equal(judge.unresolvedP1, 1);
assert.equal(judge.step4Pass, false);
assert.equal(judge.step5Allowed, false);
assert.equal(completion.recoveryCompletionClaimed, false);
assert.equal(completion.step4Pass, false);
assert.equal(completion.step5Allowed, false);

const project = readJson('PROJECT_STATUS.json');
const simulation = readJson('simulation/CURRENT_STATUS.json');
const policy = readJson('AI_PROJECT_POLICY.json');
assert.equal(project.canonicalRepository, REPOSITORY);
assert.equal(project.canonicalBranch, BRANCH);
assert.equal(simulation.repository, REPOSITORY);
assert.equal(simulation.branch, BRANCH);
assert.equal(policy.repository.fullName, REPOSITORY);
assert.equal(policy.repository.allowedBranch, BRANCH);
assert.equal(project.currentStep, 4);
assert.equal(simulation.currentStep, 4);
assert.equal(policy.currentPhase.step, 4);
assert.equal(project.currentStepStatus, 'IN_PROGRESS');
assert.equal(project.status, 'IN_PROGRESS');
assert.equal(simulation.status, 'IN_PROGRESS');
assert.equal(policy.currentPhase.status, 'IN_PROGRESS');
assert.equal(Boolean(project.step5Allowed), false);
assert.equal(Boolean(simulation.step5Allowed), false);
assert.equal(Boolean(policy.currentPhase.step5Allowed), false);
assert.equal(project.physicalIPhoneVerified, false);
assert.equal(simulation.physicalIPhoneVerified, false);
assert.equal(policy.currentPhase.physicalIPhone, 'NOT_VERIFIED');
assert.equal(project.productionChangedByCurrentWork, false);
assert.equal(project.productionAliasChanged, false);
assert.equal(simulation.productionChanged, false);

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
  assert(block.includes('- Step 4: **IN_PROGRESS**'), `${relativePath}: Step 4 mismatch`);
  assert(block.includes('- Step 5: **BLOCKED_UNTIL_STEP4_PASS**'), `${relativePath}: Step 5 mismatch`);
  assert(block.includes('- Unresolved P0/P1: **0 / 1**'), `${relativePath}: P0/P1 mismatch`);
  assert(block.includes('- Physical iPhone: **NOT_VERIFIED**'), `${relativePath}: physical iPhone mismatch`);
  assert(block.includes('- Production alias changed: **false**'), `${relativePath}: Production mismatch`);
}

const allowedExact = new Set([
  'index.html',
  'step4/s02/index.html',
  'tests/step4/verify-s02-runtime-integration.mjs',
  'tests/step4/s02-runtime-browser-qa.mjs',
  'tests/governance/verify-current-step2-state.mjs',
  '.github/workflows/verify-step-4-s02-runtime-integration.yml',
  '.github/workflows/execute-step-4-s02-main-entry-v2.yml',
  '.github/workflows/terminalize-step-4-s02-main-entry-v2.yml',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-023.json',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-024.json',
  'PROJECT_STATUS.json',
  'simulation/CURRENT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  '.github/workflows/CURRENT_STATUS.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
]);
const allowedRecoveryEvidence = (relativePath) =>
  relativePath.startsWith(`${STEP4}/s02-main-entry-governance-recovery-`);
const changedOutput = git('diff', '--name-only', `${RECOVERY_ENTRY}..HEAD`);
const changed = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
const forbidden = changed.filter((relativePath) => !allowedExact.has(relativePath) && !allowedRecoveryEvidence(relativePath));
assert.deepEqual(forbidden, [], `forbidden recovery path(s): ${forbidden.join(', ')}`);
assert.deepEqual(changed.filter((relativePath) => /^(backend\/|public\/|\.vercel\/|vercel\.json$)/u.test(relativePath)), []);
assert.deepEqual(changed.filter((relativePath) => /^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/u.test(relativePath)), []);

git('diff', '--check', `${RECOVERY_ENTRY}..HEAD`);

console.log(JSON.stringify({
  verdict: 'PASS_CURRENT_CATS_TOWER_STEP4_RECOVERY_GOVERNANCE',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  currentStep: 4,
  status: 'IN_PROGRESS',
  step4: 'IN_PROGRESS',
  step5: 'BLOCKED_UNTIL_STEP4_PASS',
  unresolvedP0: 0,
  unresolvedP1: 1,
  changedPathCount: changed.length,
  forbiddenPathCount: forbidden.length,
  physicalIPhone: 'NOT_VERIFIED',
  productionChanged: false,
}));
