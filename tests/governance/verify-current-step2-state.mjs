#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const VISUAL_REPAIR_ENTRY = '9495c97232213620346958f271913fd8a585ff50';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const LATEST_ADDENDUM = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-025.json';
const BASE_ACCEPTANCE = `${STEP4}/s02-actual-root-visual-repair-acceptance-round-001.json`;
const RESPONSIVE_ACCEPTANCE = `${STEP4}/s02-actual-root-visual-repair-responsive-acceptance-round-002.json`;
const BLOCKS = [
  ['<!-- CATS_TOWER_STEP4_STATUS_BEGIN -->', '<!-- CATS_TOWER_STEP4_STATUS_END -->'],
  ['<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->', '<!-- CATS_TOWER_STEP3_STATUS_END -->']
];

const abs = relativePath => path.join(ROOT, relativePath);
const readText = relativePath => readFileSync(abs(relativePath), 'utf8');
const readJson = relativePath => JSON.parse(readText(relativePath));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const blob = relativePath => git('rev-parse', `HEAD:${relativePath}`);
const exists = relativePath => existsSync(abs(relativePath));

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
assert.equal(git('replace', '-l'), '');
execFileSync('git', ['merge-base', '--is-ancestor', VISUAL_REPAIR_ENTRY, 'HEAD'], { cwd: ROOT });

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
  [`${STEP3}/terminal-mirror-correction.json`]: '14a9208b49c0b683e215cbefe587fedf67c2cac0'
};

const implementationImmutable = {
  'app.js': '258f8cef77fb37a07d00aaab99ae1e678de764fd',
  'game-core.js': '34471eaa185b2355f17a8e8860261f63ee86bdaf',
  'game-data.js': 'fa01689275f05f1e0879c40586499cc74c337cf9',
  'sw.js': '16aca2f8f94fdfbcf8b228a331e35288fcbc2365',
  'simulation/candidate-v2.json': '1e633de1c6ecb1f98cee262b88575387816cf310',
  'runtime/s02-runtime.css': '6633698d77511d1e0725545e16aec9c2a18ca49c'
};

const repairedRuntime = {
  'runtime/s02-runtime.js': '88ea0bf76bfaf44980bc21cdf8abeaa3b75077f0',
  'runtime/s02-battle-renderer.js': '16e8dfdffaa9beab0723f9be93ad2f467b8d3239',
  'runtime/s02-runtime-fixes.css': '59560b092746b22bf3645ee5f7cbb18f64db07ff'
};

for (const [relativePath, expectedBlob] of Object.entries({ ...sealedImmutable, ...implementationImmutable, ...repairedRuntime })) {
  assert(exists(relativePath), `${relativePath}: missing governed file`);
  assert.equal(blob(relativePath), expectedBlob, `${relativePath}: governed blob mismatch`);
}

for (const required of [LATEST_ADDENDUM, BASE_ACCEPTANCE, RESPONSIVE_ACCEPTANCE]) {
  assert(exists(required), `${required}: missing current visual-repair authority`);
}

const activeRoot = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
const latest = readJson(LATEST_ADDENDUM);
const baseAcceptance = readJson(BASE_ACCEPTANCE);
const responsiveAcceptance = readJson(RESPONSIVE_ACCEPTANCE);
assert.equal(activeRoot.status, 'PASS');
assert.equal(latest.status, 'IN_PROGRESS');
assert.equal(latest.verdict, 'IN_PROGRESS_STEP4_S02_ACTUAL_ROOT_VISUAL_REPAIR');
assert.equal(latest.step4Allowed, true);
assert.equal(latest.step4Pass, false);
assert.equal(latest.step5Allowed, false);
assert.equal(latest.unresolvedP0, 0);
assert.equal(latest.unresolvedP1, 1);
assert.equal(latest.openFinding, 'S4-RECOVERY-VIS-001');
assert.equal(latest.scope.stateAuthority, 'window.__game');
assert.equal(latest.scope.gameplayCoreMutationAllowed, false);
assert.equal(baseAcceptance.status, 'ACTIVE_BEFORE_VISUAL_REPAIR_WRITE');
assert.equal(baseAcceptance.truthfulnessContract.stateSource, 'window.__game');
assert.equal(baseAcceptance.completionBoundary.step5Allowed, false);
assert.equal(responsiveAcceptance.status, 'ACTIVE_BEFORE_RESPONSIVE_REPAIR_WRITE');
assert.equal(responsiveAcceptance.responsiveStrategy.id, 'reference-width-reflow-safe-area');
assert.equal(responsiveAcceptance.responsiveStrategy.referenceWidthCssPx, 390);
assert.equal(responsiveAcceptance.responsiveStrategy.minimumReadableTextCssPx, 11);
assert.equal(responsiveAcceptance.responsiveStrategy.preferredTouchTargetCssPx, 48);
assert.equal(responsiveAcceptance.completionBoundary.s02MayPassAutomatically, false);
assert.equal(responsiveAcceptance.completionBoundary.step5Allowed, false);

const project = readJson('PROJECT_STATUS.json');
const simulation = readJson('simulation/CURRENT_STATUS.json');
const policy = readJson('AI_PROJECT_POLICY.json');
assert.equal(project.canonicalRepository, REPOSITORY);
assert.equal(project.canonicalBranch, BRANCH);
assert.equal(simulation.repository, REPOSITORY);
assert.equal(simulation.branch, BRANCH);
assert.equal(policy.repository.fullName, REPOSITORY);
assert.equal(policy.repository.allowedBranch, BRANCH);
assert.equal(project.activeChangeControl.path, LATEST_ADDENDUM);
assert.equal(simulation.step4.changeControl, LATEST_ADDENDUM);
assert.equal(policy.activeStep4Recovery.changeControl, LATEST_ADDENDUM);
assert.equal(project.currentStep, 4);
assert.equal(simulation.currentStep, 4);
assert.equal(policy.currentPhase.step, 4);
assert.equal(project.currentStepStatus, 'IN_PROGRESS');
assert.equal(project.status, 'IN_PROGRESS');
assert.equal(simulation.status, 'IN_PROGRESS');
assert.equal(policy.currentPhase.status, 'IN_PROGRESS');
assert.equal(project.phase, 'STEP4_S02_ACTUAL_ROOT_VISUAL_REPAIR');
assert.equal(simulation.phase, 'STEP4_S02_ACTUAL_ROOT_VISUAL_REPAIR');
assert.equal(policy.currentPhase.phase, 'STEP4_S02_ACTUAL_ROOT_VISUAL_REPAIR');
assert.equal(Boolean(project.step5Allowed), false);
assert.equal(Boolean(simulation.step5Allowed), false);
assert.equal(Boolean(policy.currentPhase.step5Allowed), false);
assert.equal(project.step4.unresolvedP0, 0);
assert.equal(project.step4.unresolvedP1, 1);
assert.equal(simulation.step4.unresolvedP1, 1);
assert.equal(policy.currentPhase.unresolvedP1, 1);
assert.equal(project.physicalIPhoneVerified, false);
assert.equal(simulation.physicalIPhoneVerified, false);
assert.equal(policy.currentPhase.physicalIPhone, 'NOT_VERIFIED');
assert.equal(project.productionChangedByCurrentWork, false);
assert.equal(project.productionAliasChanged, false);
assert.equal(simulation.productionChanged, false);
assert.equal(simulation.gameplayCoreMutationByCurrentRepair, false);

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
  for (const required of [
    '- Step 1: **PASS**',
    '- Step 2: **PASS / SEALED**',
    '- Step 3: **PASS**',
    '- Step 4: **IN_PROGRESS**',
    '- Step 5: **BLOCKED_UNTIL_STEP4_PASS**',
    '- Unresolved P0/P1: **0 / 1**',
    '- Physical iPhone: **NOT_VERIFIED**',
    '- Production alias changed: **false**'
  ]) assert(block.includes(required), `${relativePath}: status mismatch for ${required}`);
}
assert(readText('AGENTS.md').includes('active-change-control-addendum-round-025.json'));

const allowedPatterns = [
  /^runtime\/s02-runtime\.js$/,
  /^runtime\/s02-battle-renderer\.js$/,
  /^runtime\/s02-runtime-fixes\.css$/,
  /^tests\/step4\/verify-s02-runtime-integration\.mjs$/,
  /^tests\/step4\/s02-runtime-browser-qa\.mjs$/,
  /^tests\/governance\/verify-current-step2-state\.mjs$/,
  /^\.github\/workflows\/verify-step-4-s02-runtime-integration\.yml$/,
  /^quality-reviews\/step-1-canonical-design\/active-change-control-addendum-round-025\.json$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-actual-root-visual-repair-[^/]+\.json$/,
  /^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-actual-root-visual-repair-browser-evidence\//,
  /^(PROJECT_STATUS\.json|AI_PROJECT_POLICY\.json|QUALITY_GATE\.md|PROJECT_HANDOVER\.md|AGENTS\.md)$/,
  /^simulation\/CURRENT_STATUS\.json$/,
  /^\.github\/workflows\/CURRENT_STATUS\.md$/
];
const changedOutput = git('diff', '--name-only', `${VISUAL_REPAIR_ENTRY}..HEAD`);
const changed = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
const forbidden = changed.filter(relativePath => !allowedPatterns.some(pattern => pattern.test(relativePath)));
assert.deepEqual(forbidden, [], `forbidden visual-repair path(s): ${forbidden.join(', ')}`);
assert.deepEqual(changed.filter(relativePath => /^(backend\/|public\/|\.vercel\/|vercel\.json$)/u.test(relativePath)), []);
assert.deepEqual(changed.filter(relativePath => /^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/u.test(relativePath)), []);

git('diff', '--check', `${VISUAL_REPAIR_ENTRY}..HEAD`);

console.log(JSON.stringify({
  verdict: 'PASS_CURRENT_CATS_TOWER_STEP4_S02_VISUAL_REPAIR_GOVERNANCE',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  currentStep: 4,
  status: 'IN_PROGRESS',
  step4: 'IN_PROGRESS',
  step5: 'BLOCKED_UNTIL_STEP4_PASS',
  unresolvedP0: 0,
  unresolvedP1: 1,
  responsiveStrategy: 'reference-width-reflow-safe-area',
  minimumReadableTextCssPx: 11,
  preferredTouchTargetCssPx: 48,
  stateAuthority: 'window.__game',
  gameplayCoreChanged: false,
  changedPathCount: changed.length,
  forbiddenPathCount: forbidden.length,
  physicalIPhone: 'NOT_VERIFIED',
  productionChanged: false
}));
