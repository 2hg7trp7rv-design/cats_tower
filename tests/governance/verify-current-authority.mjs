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
  const output = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], { cwd: root, encoding: 'utf8' });
  return output ? output.split('\0').filter(Boolean) : [];
}

function firstAddCommit(file) {
  const output = git(['log', '--diff-filter=A', '--format=%H', '--', file]);
  const commits = output ? output.split('\n').filter(Boolean) : [];
  return commits.at(-1) ?? null;
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function assertAddedOnceAndUnchanged(file, addCommit) {
  const firstBlob = git(['rev-parse', `${addCommit}:${file}`]);
  const currentBlob = git(['rev-parse', `HEAD:${file}`]);
  assert(firstBlob === currentBlob, `numbered evidence changed after first addition: ${file}`);
  assertNoPathChangesSince(addCommit, 'HEAD', [file], 'numbered evidence immutability');
  const priorObjects = git(['rev-list', '--objects', `${addCommit}^`]);
  assert(!priorObjects.split('\n').some(line => line.split(' ')[0] === firstBlob), `numbered evidence blob existed before its authoritative path: ${file}`);
  return currentBlob;
}

function assertBoundary(paths, control, label) {
  for (const file of paths) {
    assert(control.allowedWrites.some(pattern => globMatch(pattern, file)), `${label}: changed path outside allowlist: ${file}`);
    assert(!control.forbiddenWrites.some(pattern => globMatch(pattern, file)), `${label}: forbidden path changed: ${file}`);
  }
}

function assertBoundaryHistory(base, head, control, label) {
  const output = git(['rev-list', '--reverse', `${base}..${head}`]);
  const commits = output ? output.split('\n').filter(Boolean) : [];
  let expectedParent = base;
  for (const commit of commits) {
    const [resolvedCommit, ...parents] = git(['rev-list', '--parents', '-n', '1', commit]).split(' ');
    assert(resolvedCommit === commit, `${label}: failed to resolve commit ${commit}`);
    assert(parents.length === 1 && parents[0] === expectedParent, `${label}: merge, branch splice or non-linear commit detected at ${commit}`);
    assertBoundary(changedPaths(expectedParent, commit), control, `${label} commit ${commit}`);
    expectedParent = commit;
  }
  assert(expectedParent === head || (commits.length === 0 && base === head), `${label}: commit chain does not end at ${head}`);
}

function assertNoPathChangesSince(base, head, paths, label) {
  for (const file of paths) {
    const output = git(['log', '--format=%H', `${base}..${head}`, '--', file]);
    assert(output === '', `${label}: frozen path changed after baseline: ${file}`);
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
const step2CorrectionPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-032.json';
const step2Correction = exists(step2CorrectionPath) ? json(step2CorrectionPath) : null;
const step2ContinuityPath = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/step3-continuity-bridge.json';
// Round 032 opening must replace this null with the immutable blob created for the new control.
const expectedStep2CorrectionControlBlob = null;
const productControl = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json');
const acceptanceAddendum = json('quality-reviews/phase-0-governance-recovery/acceptance-addendum-round-001.json');
const active = json(authority.activeChangeControl);

if (step2Correction) {
  assert(typeof expectedStep2CorrectionControlBlob === 'string' && /^[a-f0-9]{40}$/.test(expectedStep2CorrectionControlBlob), 'round 032 control blob was not frozen at opening');
  assert(git(['rev-parse', `HEAD:${step2CorrectionPath}`]) === expectedStep2CorrectionControlBlob, 'round 032 change-control mutated or self-expanded');
}

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
assert(['IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED', 'PASS_CONTRACT'].includes(authority.executableContract.step2Status), 'Step 2 screen-projection status is invalid');
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
  'quality-reviews/phase-0-governance-recovery/acceptance-matrix.json': '66b243ce69e976913413a944e3fd1290072c304f',
  'quality-reviews/phase-0-governance-recovery/change-manifest.json': '1bcd8add6fc463922bd4fbd652e83601f1f5aa7d',
  'quality-reviews/phase-0-governance-recovery/step2-source-compatibility.json': 'efeeea2a33e77bff8822b8c3aa4743f7448b1641',
  'quality-reviews/phase-0-governance-recovery/critic-summary.json': 'bc411bd18ab7ef12825f463ed4486f370ff9d85e',
  'quality-reviews/phase-0-governance-recovery/final-judge.json': '7af39af4b1e40255a38421e0606766e086d1f29f',
  'quality-reviews/phase-0-governance-recovery/completion-evidence.json': 'd1bdb3eb93734d3cd758c50355793d857f915c56',
  'quality-reviews/phase-0-governance-recovery/live-readback.json': 'dd045fc9526bde19c561412da11a67761afd13b5',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json': '20011a1007dd9795486b870293d2aeac89909fb1'
};
for (const [p, expectedBlob] of Object.entries(frozenAttemptedClosureBlobs)) {
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `superseded Phase 0 evidence changed again: ${p}`);
}

const frozenCorrectionBlobs = {
  'quality-reviews/phase-0-governance-recovery/acceptance-addendum-round-001.json': '15001d7dcf998008be3f049dbdb34d9621142309',
  'quality-reviews/phase-0-governance-recovery/critic-summary-round-002.json': '8acef973ee08cfdca45de8a4c790a626af002acc',
  'quality-reviews/phase-0-governance-recovery/evidence-supersession-register.json': '4fa508cf4f6206b15022b09d54cac41617548c74',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json': '7f7337a9954f1a2c0229b681a53091fa2e349489',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-027.json': 'b05545d5a768ec1e3001c10633a98209f672c646',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-028.json': '073e83818b88b5d8b808c65859540adaada10f19',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-029.json': 'e42b0afa3494427d5dd34e6c8777a7aecbedf102',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json': 'fbbd5c4baecac4b1ef5e9b8e741338acd50f1c97'
};
for (const [p, expectedBlob] of Object.entries(frozenCorrectionBlobs)) {
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `Phase 0 correction history or boundary control changed: ${p}`);
}
assert(exists('quality-reviews/phase-0-governance-recovery/evidence-supersession-register-round-002.json'), 'complete evidence supersession register missing');
const closureIntegrityFreezeBaseline = '52261184fe895bf17c01a8cc5bc55ccf561064da';
assertNoPathChangesSince(
  closureIntegrityFreezeBaseline,
  'HEAD',
  [...Object.keys(fixedHistoricalBlobs), ...Object.keys(frozenAttemptedClosureBlobs), ...Object.keys(frozenCorrectionBlobs)],
  'immutable governance history'
);

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
assert(!currentDocs.includes('found three closure-integrity P1'), 'incorrect Phase 0 finding count remains in current mirrors');
assert(!currentDocs.includes('found three P1 closure-integrity'), 'incorrect Phase 0 finding count remains in current mirrors');
const currentWorkflow = text('.github/workflows/verify-current-governance.yml');
assert(!/^\s+paths(?:-ignore)?:/m.test(currentWorkflow), 'current governance push trigger must not be path-filtered');

const closureRepairCriticPath = 'quality-reviews/phase-0-governance-recovery/closure-integrity-critic-round-001.json';
const closureRepairCriticComplete = exists(closureRepairCriticPath);
const closureRepairCritic = closureRepairCriticComplete ? json(closureRepairCriticPath) : null;
if (closureRepairCritic) {
  assert(closureRepairCritic.verdict === 'PASS_PHASE0_CLOSURE_INTEGRITY_REPAIR', 'closure-integrity critic verdict is not a scoped pass');
  assert(closureRepairCritic.unresolved?.P0 === 0 && closureRepairCritic.unresolved?.P1 === 0, 'closure-integrity critic P0/P1 must be zero');
  assert(closureRepairCritic.maximumVerdict === 'READY_FOR_STEP2_SCREEN_PROJECTION_CORRECTION', 'closure-integrity critic maximum verdict is wrong');
  const repairTarget = closureRepairCritic.auditTarget?.commit;
  assert(repairTarget && closureRepairCritic.auditTarget?.tree === git(['rev-parse', `${repairTarget}^{tree}`]), 'closure-integrity critic target commit/tree mismatch');
  const repairCriticCommit = firstAddCommit(closureRepairCriticPath);
  assert(repairCriticCommit && repairCriticCommit !== repairTarget && isAncestor(repairTarget, repairCriticCommit), 'closure-integrity critic commit must follow its audit target');
  assert(closureRepairCritic.workflow?.commit === repairTarget && closureRepairCritic.workflow?.tree === closureRepairCritic.auditTarget.tree, 'closure-integrity critic workflow target mismatch');
  assert(closureRepairCritic.workflow?.conclusion === 'SUCCESS', 'closure-integrity critic workflow was not successful');
  assert(Number.isInteger(closureRepairCritic.workflow?.runId) && Number.isInteger(closureRepairCritic.workflow?.jobId), 'closure-integrity critic run/job binding missing');
  assert(Number.isInteger(closureRepairCritic.workflow?.artifactId) && /^sha256:[a-f0-9]{64}$/.test(closureRepairCritic.workflow?.artifactDigest ?? ''), 'closure-integrity critic artifact binding missing');
  const requiredFindingIds = [
    'PHASE0-POST-CLOSURE-BOUNDARY-001',
    'PHASE0-ACCEPTANCE-CLOSURE-ID-001',
    'PHASE0-PREMATURE-EVIDENCE-001',
    'PHASE0-IMMUTABLE-EVIDENCE-OVERWRITE-001'
  ];
  assert(JSON.stringify(closureRepairCritic.findings?.map(entry => entry.id)) === JSON.stringify(requiredFindingIds), 'closure-integrity critic finding set mismatch');
  assert(closureRepairCritic.findings.every(entry => entry.resolved === true), 'closure-integrity critic contains an unresolved finding');
}
const expectedPhase0P1 = closureRepairCriticComplete ? 0 : 4;
const step2ProjectionOpen = authority.executableContract.step2Status !== 'PASS_CONTRACT';
if (authority.activeChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json') {
  assert(step2ProjectionOpen, 'Step 2 cannot pass while round 031 is still active');
}
if (!step2ProjectionOpen) {
  assert(step2Correction, 'Step 2 PASS requires the frozen round 032 correction control');
  assert(authority.executableContract.seal === 'simulation/executable-seal-v3.json', 'Step 2 PASS requires the v3 seal authority pointer');
  assert(exists('simulation/executable-seal-v3.json'), 'Step 2 PASS requires a v3 seal');
  const currentV3Seal = json('simulation/executable-seal-v3.json');
  assert(currentV3Seal.verdict === 'SEALED_STEP2_EXECUTABLE_CONTRACT_SCREEN_PROJECTION_CORRECTED', 'Step 2 PASS v3 seal verdict mismatch');
  assert(exists(step2ContinuityPath), 'Step 2 PASS requires continuity evidence');
}
const expectedOpenFindings = [
  ...(step2ProjectionOpen ? ['S2-P0-SCREEN-PROJECTION-001'] : []),
  'S4-RECOVERY-VIS-001',
  ...(!closureRepairCriticComplete ? [
    'PHASE0-POST-CLOSURE-BOUNDARY-001',
    'PHASE0-ACCEPTANCE-CLOSURE-ID-001',
    'PHASE0-PREMATURE-EVIDENCE-001',
    'PHASE0-IMMUTABLE-EVIDENCE-OVERWRITE-001'
  ] : []),
  'PHASE0-P2-PR8-STALE-METADATA',
  'PHASE0-P2-KIMI-UNPROTECTED-EXTERNAL-ENFORCEMENT'
];
assert(authority.governanceRecovery.phase0P1 === expectedPhase0P1, 'authority Phase 0 P1 count mismatch');
assert(status.governanceRecovery.phase0P1 === expectedPhase0P1, 'PROJECT_STATUS Phase 0 P1 count mismatch');
assert(authority.globalGate.unresolvedP0 === (step2ProjectionOpen ? 1 : 0), 'authority global P0 mismatch');
assert(status.openFindings.P0 === (step2ProjectionOpen ? 1 : 0), 'PROJECT_STATUS global P0 mismatch');
assert(authority.globalGate.unresolvedP1 === expectedPhase0P1 + 1, 'global P1 must equal Phase 0 P1 plus S4 product P1');
assert(status.openFindings.P1 === expectedPhase0P1 + 1, 'PROJECT_STATUS global P1 mismatch');
assert(authority.governanceRecovery.phase0P2 === 2 && authority.globalGate.unresolvedP2 === 2, 'authority Phase 0/global P2 mismatch');
assert(status.governanceRecovery.phase0P2 === 2 && status.openFindings.P2 === 2, 'PROJECT_STATUS Phase 0/global P2 mismatch');
assert(JSON.stringify(authority.globalGate.openFindings) === JSON.stringify(expectedOpenFindings), 'authority open-finding IDs or order mismatch');
assert(JSON.stringify(status.openFindings.items) === JSON.stringify(expectedOpenFindings), 'PROJECT_STATUS open-finding IDs or order mismatch');
assert(sim.governanceRecovery.step2Correction === step2CorrectionPath, 'simulation Step 2 correction lineage mismatch');
assert(sim.governanceRecovery.plannedCorrectedClosure.endsWith('round-033.json'), 'simulation corrected closure must be round 033');
assert(dispatcher.step2ScreenProjectionCorrection === step2CorrectionPath, 'dispatcher Step 2 correction lineage mismatch');
assert(dispatcher.plannedGovernanceRecoveryClosure.endsWith('round-033.json'), 'dispatcher corrected closure must be round 033');
assert(authority.governanceRecovery.step2Correction === step2CorrectionPath, 'authority Step 2 correction lineage mismatch');
assert(authority.governanceRecovery.plannedCorrectedClosure.endsWith('round-033.json'), 'authority corrected closure must be round 033');
assert(status.scopedPasses.step2 === authority.executableContract.step2Status, 'Step 2 status differs between authority and PROJECT_STATUS');
assert(sim.step2.status === authority.executableContract.step2Status, 'Step 2 status differs between authority and simulation mirror');
const gateText = text('QUALITY_GATE.md');
const handoverText = text('PROJECT_HANDOVER.md');
if (closureRepairCriticComplete) {
  assert(gateText.includes('Current Phase 0 P0/P1: `0 / 0`'), 'QUALITY_GATE does not show resolved Phase 0 P0/P1');
  assert(handoverText.includes('Current Phase 0 unresolved') && handoverText.includes('`0 / 0`'), 'handover does not show resolved Phase 0 P0/P1');
} else {
  assert(gateText.includes('Current Phase 0 P0/P1: `0 / 4`'), 'QUALITY_GATE does not show pending Phase 0 P0/P1');
  assert(handoverText.includes('`0 / 4`'), 'handover does not show pending Phase 0 P0/P1');
}

assertBoundaryHistory(rootControl.entry.head, correction.entry.head, rootControl, 'round 028 content');
assert(acceptanceAddendum.parentAcceptance === 'quality-reviews/phase-0-governance-recovery/acceptance-matrix.json', 'Phase 0 acceptance addendum parent mismatch');
assert(acceptanceAddendum.correction.step2Correction.endsWith('round-032.json'), 'Step 2 correction lineage missing');
assert(acceptanceAddendum.correction.authoritativeClosure.endsWith('round-033.json'), 'corrected Phase 0 closure lineage missing');
assert(attemptedClosure.status === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'attempted round 030 closure history changed');

const supersessionRound2 = json('quality-reviews/phase-0-governance-recovery/evidence-supersession-register-round-002.json');
const registeredFrozen = new Map([
  ...supersessionRound2.frozenAttemptedClosureHistory,
  ...supersessionRound2.frozenCorrectionHistory,
  ...supersessionRound2.frozenBoundaryControls
].map(entry => [entry.path, entry.blob]));
for (const [p, expectedBlob] of Object.entries({ ...frozenAttemptedClosureBlobs, ...frozenCorrectionBlobs })) {
  assert(registeredFrozen.get(p) === expectedBlob, `complete supersession register missing or misbinding ${p}`);
}

const closurePath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json';
const closureEvidence = {
  step2Continuity: step2ContinuityPath,
  critic: 'quality-reviews/phase-0-governance-recovery/critic-summary-round-003.json',
  finalJudge: 'quality-reviews/phase-0-governance-recovery/final-judge-round-002.json',
  completion: 'quality-reviews/phase-0-governance-recovery/completion-evidence-round-002.json',
  liveReadback: 'quality-reviews/phase-0-governance-recovery/live-readback-round-002.json'
};

if (authority.activeChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json') {
  assert(active.status === 'IN_PROGRESS', 'round 031 must be in progress');
  assert(status.currentInternalPhase === 'PHASE0-GOVERNANCE-RECOVERY', 'Phase 0 mirror mismatch');
  assertBoundaryHistory(reopen.entry.head, git(['rev-parse', 'HEAD']), reopen, 'round 031 closure-integrity repair');
  assert(!step2Correction, 'round 032 must not exist while round 031 is active');
  assert(!exists(closurePath), 'round 033 must not exist before corrected Phase 0 closure');
} else if (authority.activeChangeControl === step2CorrectionPath) {
  assert(step2Correction, 'active round 032 change-control missing');
  assert(active.status === 'IN_PROGRESS', 'round 032 must remain in progress before corrected closure');
  assert(status.currentInternalPhase === 'STEP2-SCREEN-PROJECTION-CORRECTION', 'round 032 phase mirror mismatch');
  assertBoundaryHistory(reopen.entry.head, step2Correction.entry.head, reopen, 'completed round 031 repair range');
  assertBoundaryHistory(step2Correction.entry.head, git(['rev-parse', 'HEAD']), step2Correction, 'round 032 Step 2 correction range');
  assert(!exists(closurePath), 'round 033 must not exist while round 032 is active');
} else {
  assert(authority.activeChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json', 'post-Phase0 authority must return exactly to round 026');
  assert(step2Correction, 'round 032 correction control missing after closure');
  assert(exists(closurePath), 'corrected Phase 0 closure addendum missing');
  const closure = json(closurePath);
  assert(closure.status === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'round 033 must close corrected Phase 0');
  assert(authority.governanceRecovery?.closure === closurePath, 'authority must bind Phase 0 closure');
  assert(dispatcher.governanceRecoveryClosure === closurePath, 'dispatcher must bind Phase 0 closure');
  assert(status.currentInternalPhase === 'S02-P1-GOLDEN-MASTER', 'post-Phase0 phase mismatch');
  assert(authority.executableContract.step2Status === 'PASS_CONTRACT', 'round 033 may not close while Step 2 P0 remains open');
  assert(authority.executableContract.seal === 'simulation/executable-seal-v3.json', 'current Step 2 seal must be v3 after correction');
  assert(exists('simulation/executable-seal-v3.json'), 'corrected v3 Step 2 seal missing');
  const v3Seal = json('simulation/executable-seal-v3.json');
  assert(v3Seal.verdict === 'SEALED_STEP2_EXECUTABLE_CONTRACT_SCREEN_PROJECTION_CORRECTED', 'v3 Step 2 seal verdict wrong');
  for (const p of Object.values(closureEvidence)) assert(exists(p), `Phase 0 closure evidence missing: ${p}`);
  for (const [key, p] of Object.entries(closureEvidence)) assert(closure.evidence?.[key] === p, `round 033 does not exactly bind numbered ${key} evidence`);
  const continuity = json(closureEvidence.step2Continuity);
  assert(continuity.verdict === 'PASS_STEP3_NUMERIC_MODEL_CONTINUITY_NO_EXECUTION_RERUN_REQUIRED', 'Step 3 continuity bridge verdict wrong');
  assert(continuity.changedJsonPointers?.length === 1 && continuity.changedJsonPointers[0] === '/screens', 'Step 3 continuity bridge does not prove a screens-only change');
  assert(continuity.candidateOutsideScreens?.beforeSha256 === continuity.candidateOutsideScreens?.afterSha256, 'non-screen candidate content changed');
  assert(continuity.qualification?.beforeDeterministicPayloadSha256 === continuity.qualification?.afterDeterministicPayloadSha256, 'qualification deterministic payload changed');
  assert(continuity.qualification?.deepEqual === true, 'qualification payload deep equality missing');
  assert(continuity.v3Seal?.path === 'simulation/executable-seal-v3.json', 'continuity bridge does not bind v3 seal path');
  assert(continuity.v3Seal?.blob === git(['rev-parse', 'HEAD:simulation/executable-seal-v3.json']), 'continuity bridge v3 seal blob mismatch');
  const critic = json(closureEvidence.critic);
  const judge = json(closureEvidence.finalJudge);
  const completion = json(closureEvidence.completion);
  const readback = json(closureEvidence.liveReadback);
  assert(critic.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY_INDEPENDENT_CRITIC', 'Phase 0 independent critic did not pass');
  assert(critic.unresolved.P0 === 0 && critic.unresolved.P1 === 0, 'Phase 0 critic P0/P1 must be zero');
  assert(judge.critic === closureEvidence.critic, 'Phase 0 judge does not bind numbered critic');
  assert(judge.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'Phase 0 judge did not pass');
  assert(judge.unresolved.P0 === 0 && judge.unresolved.P1 === 0, 'Phase 0 P0/P1 must be zero');
  assert(completion.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'Phase 0 completion evidence did not pass');
  assert(completion.phase0Unresolved.P0 === 0 && completion.phase0Unresolved.P1 === 0, 'Phase 0 completion P0/P1 must be zero');
  assert(readback.verdict === 'READY_TO_CLOSE_PHASE0_GOVERNANCE_RECOVERY', 'Phase 0 live readback did not authorize closure');
  assert(readback.phase0Unresolved.P0 === 0 && readback.phase0Unresolved.P1 === 0, 'Phase 0 readback P0/P1 must be zero');
  const closureCommit = firstAddCommit(closurePath);
  const criticCommit = firstAddCommit(closureEvidence.critic);
  const judgeCommit = firstAddCommit(closureEvidence.finalJudge);
  const completionCommit = firstAddCommit(closureEvidence.completion);
  const readbackCommit = firstAddCommit(closureEvidence.liveReadback);
  assert(closureCommit, 'cannot resolve Phase 0 closure commit');
  assert(criticCommit && judgeCommit && completionCommit && readbackCommit, 'cannot resolve numbered Phase 0 evidence commits');
  assert(new Set([criticCommit, judgeCommit, completionCommit, readbackCommit, closureCommit]).size === 5, 'critic, judge, completion, readback and closure must be distinct commits');
  assert(isAncestor(step2Correction.entry.head, criticCommit), 'Phase 0 critic predates round 032 correction entry');
  assert(isAncestor(criticCommit, judgeCommit), 'Phase 0 judge must follow the independent critic');
  assert(isAncestor(judgeCommit, completionCommit), 'Phase 0 completion must follow the final judge');
  assert(isAncestor(completionCommit, readbackCommit), 'Phase 0 live readback must follow completion evidence');
  assert(isAncestor(readbackCommit, closureCommit), 'round 033 closure must follow live readback');
  for (const [key, file] of Object.entries(closureEvidence)) {
    const addCommit = firstAddCommit(file);
    const currentBlob = assertAddedOnceAndUnchanged(file, addCommit);
    assert(closure.evidenceBlobs?.[key] === currentBlob, `round 033 does not bind immutable ${key} evidence blob`);
  }
  const targetCommit = critic.auditTarget?.commit;
  const targetTree = critic.auditTarget?.tree;
  assert(targetCommit && targetTree === git(['rev-parse', `${targetCommit}^{tree}`]), 'critic target commit/tree binding is invalid');
  assert(targetCommit !== step2Correction.entry.head && isAncestor(step2Correction.entry.head, targetCommit), 'critic target must be a corrected round 032 descendant, not its entry');
  assert(targetCommit !== criticCommit, 'independent critic must be committed after its audited target');
  const v3SealCommit = firstAddCommit('simulation/executable-seal-v3.json');
  assert(v3SealCommit && isAncestor(v3SealCommit, targetCommit), 'critic target does not contain the v3 correction seal');
  assert(isAncestor(targetCommit, criticCommit), 'critic evidence must follow its target commit');
  assert(judge.target?.commit === targetCommit && judge.target?.tree === targetTree, 'judge target differs from critic target');
  assert(completion.verifiedContent?.commit === targetCommit && completion.verifiedContent?.tree === targetTree, 'completion target differs from critic target');
  assert(readback.readbackTarget?.commit === targetCommit && readback.readbackTarget?.tree === targetTree, 'readback target differs from critic target');
  const evidenceParent = git(['rev-parse', `${closureCommit}^`]);
  assert(closure.content?.verifiedTipCommit === targetCommit && closure.content?.verifiedTipTree === targetTree, 'round 033 target differs from numbered evidence');
  assert(closure.content?.evidenceCommit === evidenceParent && closure.content?.evidenceTree === git(['rev-parse', `${evidenceParent}^{tree}`]), 'round 033 does not bind its evidence parent commit/tree');
  for (const workflow of [completion.workflowEvidence, readback.workflow]) {
    assert(workflow?.commit === targetCommit && workflow?.tree === targetTree, 'workflow evidence target differs from corrected content');
    assert(workflow?.conclusion === 'SUCCESS', 'workflow evidence is not successful');
    assert(Number.isInteger(workflow?.runId) && Number.isInteger(workflow?.jobId), 'workflow run/job binding missing');
    assert(Number.isInteger(workflow?.artifactId) && /^sha256:[a-f0-9]{64}$/.test(workflow?.artifactDigest ?? ''), 'workflow artifact binding missing');
  }
  assert(Array.isArray(step2Correction.evidenceOnlyWrites) && step2Correction.evidenceOnlyWrites.length > 0, 'round 032 evidence-only boundary missing');
  const evidenceOnlyControl = { allowedWrites: step2Correction.evidenceOnlyWrites, forbiddenWrites: step2Correction.forbiddenWrites };
  assertBoundaryHistory(targetCommit, closureCommit, evidenceOnlyControl, 'post-target evidence-only range');
  const boundContentPaths = (v3Seal.bindings ?? []).map(binding => binding.path);
  assert(boundContentPaths.length > 0, 'v3 seal has no bound content paths');
  for (const binding of v3Seal.bindings) {
    assert(git(['rev-parse', `${targetCommit}:${binding.path}`]) === binding.blob, `critic target differs from v3 seal binding: ${binding.path}`);
    assert(git(['rev-parse', `HEAD:${binding.path}`]) === binding.blob, `v3 seal binding changed after criticism: ${binding.path}`);
  }
  assertNoPathChangesSince(targetCommit, closureCommit, boundContentPaths, 'post-critic v3 content freeze');
  assert(isAncestor(reopen.entry.head, closureCommit), 'round 033 closure is not descended from round 031 entry');
  assertBoundaryHistory(reopen.entry.head, step2Correction.entry.head, reopen, 'completed round 031 repair range');
  assertBoundaryHistory(step2Correction.entry.head, closureCommit, step2Correction, 'round 032 correction and round 033 closure range');
  assertBoundaryHistory(closureCommit, git(['rev-parse', 'HEAD']), productControl, 'post-Phase0 S02-P1 product work');
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
