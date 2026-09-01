import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = p => path.join(root, p);
const exists = p => fs.existsSync(rel(p));
const text = p => fs.readFileSync(rel(p), 'utf8');
const json = p => JSON.parse(text(p));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function globMatch(pattern, file) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const source = '^' + escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$';
  return new RegExp(source).test(file);
}

function changedPaths(base, head) {
  const output = git(['diff', '--name-only', base, head]);
  return output ? output.split('\n').filter(Boolean) : [];
}

function assertBoundary(paths, control, label) {
  for (const file of paths) {
    assert(control.allowedWrites.some(pattern => globMatch(pattern, file)), `${label}: changed path outside allowlist: ${file}`);
    assert(!control.forbiddenWrites.some(pattern => globMatch(pattern, file)), `${label}: forbidden path changed: ${file}`);
  }
}

function assertDeleted(paths, label) {
  for (const p of paths) assert(!exists(p), `${label}: obsolete live path remains: ${p}`);
}

const authority = json('CURRENT_AUTHORITY_INDEX.json');
const status = json('PROJECT_STATUS.json');
const policy = json('AI_PROJECT_POLICY.json');
const sim = json('simulation/CURRENT_STATUS.json');
const dispatcher = json('quality-reviews/step-1-canonical-design/active-change-control.json');
const rootControl = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-028.json');
const correction = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-029.json');
const attemptedClosure = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json');
const reopen = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json');
const productControl = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json');
const acceptanceAddendum = json('quality-reviews/phase-0-governance-recovery/acceptance-addendum-round-001.json');
const active = json(authority.activeChangeControl);

assert(authority.repository === '2hg7trp7rv-design/cats_tower', 'authority repository mismatch');
assert(authority.branch === 'kimi', 'authority branch mismatch');
assert(status.authorityIndex === 'CURRENT_AUTHORITY_INDEX.json', 'PROJECT_STATUS must use authority index');
assert(policy.authority.index === 'CURRENT_AUTHORITY_INDEX.json', 'AI policy must use authority index');
assert(sim.authorityIndex === 'CURRENT_AUTHORITY_INDEX.json', 'simulation mirror must use authority index');
assert(dispatcher.currentAuthorityIndex === 'CURRENT_AUTHORITY_INDEX.json', 'dispatcher must use authority index');
assert(dispatcher.currentAddendum === authority.activeChangeControl, 'dispatcher and authority active addendum differ');
assert(status.activeChangeControl === authority.activeChangeControl, 'PROJECT_STATUS active addendum differs');
assert(policy.authority.activeChangeControl === authority.activeChangeControl, 'AI policy active addendum differs');

assert(authority.canonicalProduct.step1Status === 'PASS_CANONICAL', 'Step 1 scope label wrong');
assert(authority.executableContract.step2Status === 'IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED', 'Step 2 screen-projection correction status missing');
assert(authority.modelValidation.step3Status === 'PASS_MODEL', 'Step 3 scope label wrong');
assert(authority.currentProductWork.step4Pass === false, 'Step 4 must not pass');
assert(authority.currentProductWork.step5Allowed === false, 'Step 5 must remain blocked');
assert(authority.legacyRuntime.status === 'LEGACY_RUNTIME_NOT_CANONICAL', 'legacy runtime truth missing');
assert(authority.modelValidation.limitation.toLowerCase().includes('not evidence'), 'Step 3 runtime limitation missing');
assert(status.truthBoundaries.canonicalOneToTenRuntimeImplemented === false, 'canonical runtime must be false');
assert(status.truthBoundaries.backendImplemented === false, 'backend must be false');
assert(status.truthBoundaries.productionReady === false, 'Production Ready must be false');
assert(status.truthBoundaries.physicalIPhoneVerified === false, 'physical iPhone must be false');
assert(policy.forbiddenUnscopedVerdict === 'PASS', 'unscoped PASS prohibition missing');

const fixedHistoricalBlobs = {
  'quality-reviews/step-1-reseal-round-008/seal-round-008.json': '0a959de0383b57ad6cd1f33c124b398aa51c1e00',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
  'quality-reviews/step-3-large-scale-validation/final-judge.json': 'a089266f56076a0b2a59b2670188d95ae8eff3d2',
  'quality-reviews/step-3-large-scale-validation/completion-evidence.json': 'bc808fc3129f81000f1c5e755ffb2fc3a05bcf0b'
};
for (const [p, expectedBlob] of Object.entries(fixedHistoricalBlobs)) {
  assert(exists(p), `sealed evidence missing: ${p}`);
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `sealed evidence blob changed: ${p}`);
}

const frozenAttemptedClosureBlobs = {
  'quality-reviews/phase-0-governance-recovery/critic-summary.json': 'bc411bd18ab7ef12825f463ed4486f370ff9d85e',
  'quality-reviews/phase-0-governance-recovery/final-judge.json': '7af39af4b1e40255a38421e0606766e086d1f29f',
  'quality-reviews/phase-0-governance-recovery/completion-evidence.json': 'd1bdb3eb93734d3cd758c50355793d857f915c56',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json': '20011a1007dd9795486b870293d2aeac89909fb1'
};
for (const [p, expectedBlob] of Object.entries(frozenAttemptedClosureBlobs)) {
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `superseded Phase 0 evidence changed again: ${p}`);
}

const step2Seal = json('simulation/executable-seal-v2.json');
for (const binding of step2Seal.bindings) {
  assert(exists(binding.path), `Step 2 seal binding missing: ${binding.path}`);
  assert(git(['rev-parse', `HEAD:${binding.path}`]) === binding.blob, `Step 2 seal binding changed: ${binding.path}`);
}
const oldInstructionBlob = '2b42e9907bf19724dd5eb3342872aaa931424be9';
assert(git(['rev-parse', `${rootControl.entry.head}:CHATGPT_PROJECT_INSTRUCTIONS1.md`]) === oldInstructionBlob, 'historical worktree no longer contains Step 2-bound Project instructions');
assert(git(['rev-parse', 'HEAD:CHATGPT_PROJECT_INSTRUCTIONS1.md']) !== oldInstructionBlob, 'Project instructions replacement did not occur');

for (const p of ['CHATGPT_PROJECT_INSTRUCTIONS1.md', 'DEVELOPMENT_PLAYBOOK.md', 'PROJECT_SOURCE_MANIFEST.md']) {
  assert(exists(p), `missing Project source: ${p}`);
}
const instructions = text('CHATGPT_PROJECT_INSTRUCTIONS1.md');
const playbook = text('DEVELOPMENT_PLAYBOOK.md');
assert(!instructions.includes('simulation/candidate-v1.json'), 'Project instructions still activate candidate-v1');
assert(!instructions.includes('Step 4: **READY_TO_START**'), 'Project instructions contain stale Step 4 status');
for (const required of ['Downstream Usability Contract', 'Representative proof before volume', 'PASS_RUNTIME']) {
  assert(instructions.includes(required) || playbook.includes(required), `missing methodology marker: ${required}`);
}
for (const required of ['Downstream consumer', 'State family', 'Data authority', 'Performance budget', 'Failure behavior', 'Evidence']) {
  assert(playbook.includes(required), `playbook missing downstream field: ${required}`);
}

assertDeleted(rootControl.deleteFromLiveKimi, 'round 028 deletion');
assertDeleted(correction.deleteFromLiveKimi, 'round 029 deletion');
for (const p of [
  '.github/workflows/verify-current-governance.yml',
  '.github/workflows/verify-history-round7.yml',
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  'quality-reviews/phase-0-governance-recovery/acceptance-matrix.json',
  'step4/s02/golden-master-p1/index.html'
]) {
  assert(exists(p), `required current verifier or preserved product path missing: ${p}`);
}
for (const p of ['index.html', 'game-core.js']) assert(exists(p), `required legacy history path missing: ${p}`);

const currentDocs = [
  'PROJECT_STATUS.json', 'AI_PROJECT_POLICY.json', 'QUALITY_GATE.md', 'PROJECT_HANDOVER.md',
  'AGENTS.md', 'simulation/CURRENT_STATUS.json', '.github/workflows/CURRENT_STATUS.md'
].map(text).join('\n');
assert(!currentDocs.includes('IN_PROGRESS_S02_ACTUAL_ROOT_VISUAL_REPAIR'), 'stale actual-root verdict remains in current mirrors');
assert(!currentDocs.includes('active-change-control-addendum-round-025.json'), 'round 025 remains current in mirrors');
assert(!currentDocs.includes('active-change-control-addendum-round-024.json'), 'round 024 remains current in mirrors');
assert(!currentDocs.includes('Step 4: `READY_TO_START`'), 'stale Step 4 ready state remains in current mirrors');

assertBoundary(changedPaths(rootControl.entry.head, correction.entry.head), rootControl, 'round 028 content');
assert(acceptanceAddendum.parentAcceptance === 'quality-reviews/phase-0-governance-recovery/acceptance-matrix.json', 'Phase 0 acceptance addendum parent mismatch');
assert(acceptanceAddendum.correction.step2Correction.endsWith('round-032.json'), 'Step 2 correction lineage missing');
assert(acceptanceAddendum.correction.authoritativeClosure.endsWith('round-033.json'), 'corrected Phase 0 closure lineage missing');
assert(attemptedClosure.status === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'attempted round 030 closure history changed');

const closurePath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json';
const closureEvidence = [
  'quality-reviews/phase-0-governance-recovery/step2-source-compatibility.json',
  'quality-reviews/phase-0-governance-recovery/critic-summary-round-003.json',
  'quality-reviews/phase-0-governance-recovery/final-judge-round-002.json',
  'quality-reviews/phase-0-governance-recovery/completion-evidence-round-002.json',
  'quality-reviews/phase-0-governance-recovery/live-readback-round-002.json'
];

if (authority.activeChangeControl.endsWith('round-031.json')) {
  assert(active.status === 'IN_PROGRESS', 'round 031 must be in progress');
  assert(status.currentInternalPhase === 'PHASE0-GOVERNANCE-RECOVERY', 'Phase 0 mirror mismatch');
  assertBoundary(changedPaths(reopen.entry.head, 'HEAD'), reopen, 'round 031 closure-integrity repair');
  assert(!exists(closurePath), 'round 033 must not exist before corrected Phase 0 closure');
} else {
  assert(authority.activeChangeControl.endsWith('round-026.json'), 'post-Phase0 authority must return to round 026');
  assert(exists(closurePath), 'corrected Phase 0 closure addendum missing');
  const closure = json(closurePath);
  assert(closure.status === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'round 033 must close corrected Phase 0');
  assert(authority.governanceRecovery?.closure === closurePath, 'authority must bind Phase 0 closure');
  assert(dispatcher.governanceRecoveryClosure === closurePath, 'dispatcher must bind Phase 0 closure');
  assert(status.currentInternalPhase === 'S02-P1-GOLDEN-MASTER', 'post-Phase0 phase mismatch');
  for (const p of closureEvidence) assert(exists(p), `Phase 0 closure evidence missing: ${p}`);
  const compatibility = json(closureEvidence[0]);
  assert(compatibility.verdict === 'COMPATIBLE_GOVERNANCE_REPLACEMENT_DOES_NOT_RESEAL_STEP2', 'Step 2 source compatibility verdict wrong');
  const judge = json(closureEvidence[2]);
  assert(judge.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'Phase 0 judge did not pass');
  assert(judge.unresolved.P0 === 0 && judge.unresolved.P1 === 0, 'Phase 0 P0/P1 must be zero');
  const closureCommit = git(['log', '--diff-filter=A', '--format=%H', '--', closurePath]).split('\n').filter(Boolean).at(-1);
  assert(closureCommit, 'cannot resolve Phase 0 closure commit');
  assert(git(['merge-base', '--is-ancestor', reopen.entry.head, closureCommit]) === '', 'round 033 closure is not descended from round 031 entry');
  assertBoundary(changedPaths(reopen.entry.head, closureCommit), reopen, 'round 031 corrected closure');
  assertBoundary(changedPaths(closureCommit, 'HEAD'), productControl, 'post-Phase0 S02-P1 product work');
}

console.log(JSON.stringify({
  verdict: 'PASS_CURRENT_AUTHORITY_GOVERNANCE',
  activeChangeControl: authority.activeChangeControl,
  governanceRecoveryClosure: authority.governanceRecovery?.closure || null,
  step2BindingCount: step2Seal.bindings.length,
  step4Pass: false,
  step5Allowed: false,
  physicalIPhoneVerified: false,
  productionAliasChanged: false
}, null, 2));
