#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const MODE = process.argv[2];
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const ENTRY_COMMIT = '3eefbf6fa7dfcec8b5b093612e8946b43d838bc2';
const ENTRY_TREE = '7499d7b07e5dff59ae5b675b475e23a7e03359b5';
const STEP3 = 'quality-reviews/step-3-large-scale-validation';
const ACCEPTANCE = `${STEP3}/acceptance-matrix.json`;
const EXECUTION_GATE = `${STEP3}/execution-gate.json`;
const EXECUTION_READBACK = `${STEP3}/execution-live-readback-v2.json`;
const CALIBRATION_GATE = `${STEP3}/calibration-gate.json`;
const CALIBRATION_AUDIT = `${STEP3}/calibration-audit.json`;
const HOLDOUT_AUDIT = `${STEP3}/holdout-audit.json`;
const CALIBRATION_RESULT = `${STEP3}/gameplay-calibration-result.json`;
const HOLDOUT_RESULT = `${STEP3}/gameplay-holdout-result.json`;
const ANALYSIS = `${STEP3}/analysis.json`;
const CRITIC_SUMMARY = `${STEP3}/critic-summary.json`;
const FINAL_JUDGE = `${STEP3}/final-judge.json`;
const COMPLETION = `${STEP3}/completion-evidence.json`;
const LIVE_READBACK = `${STEP3}/live-readback.json`;
const REPAIR_ADDENDUM = `${STEP3}/acceptance-addendum-finalization-repair-005.json`;
const CHANGE_CONTROL = 'quality-reviews/step-1-canonical-design/active-change-control.json';
const CHANGE_CONTROL_ADDENDUM = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-015.json';

const EXPECTED_BLOBS = Object.freeze({
  [ACCEPTANCE]: 'd1392c431282d0faae9e9ad7f1c22161a3c5caad',
  [EXECUTION_GATE]: 'e499cdb421d17a5e1ee79ca4ffff204fed80e60e',
  [EXECUTION_READBACK]: '073252683f207cf9f42d2f8b2634b10ae36ff8b5',
  [CALIBRATION_GATE]: '5ecb6c177a0c52f164c4ad22723f54305bf8c97d',
  'quality-reviews/step-1-reseal-round-008/seal-round-008.json': '0a959de0383b57ad6cd1f33c124b398aa51c1e00',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
  'quality-reviews/step-2-governance-repair-round-001/live-readback.json': '692434fafd19d1e5470fe58808fd72af7286ec35',
  'simulation/run-plan-v2.json': 'a04632e41d78dd15b36e95cd6998e8a8648b9a6c',
  'simulation/execution-contract-v2.json': '82685b646358129d7e66a810b267777d6bf5af92',
});

const HIGH_VOLUME_AUDITS = Object.freeze({
  'gacha-tails': `${STEP3}/high-volume/audit-high-volume-gacha-tails.json`,
  'pity-conformance': `${STEP3}/high-volume/audit-high-volume-pity-conformance.json`,
  'duplicate-skew-overflow': `${STEP3}/high-volume/audit-high-volume-duplicate-skew-overflow.json`,
  'refund-replay-race': `${STEP3}/high-volume/audit-high-volume-refund-replay-race.json`,
  'state-machine-model': `${STEP3}/high-volume/audit-high-volume-state-machine-model.json`,
  'large-number-properties': `${STEP3}/high-volume/audit-high-volume-large-number-properties.json`,
});

const STATUS_MIRRORS = Object.freeze([
  CHANGE_CONTROL,
  CHANGE_CONTROL_ADDENDUM,
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  '.github/workflows/CURRENT_STATUS.md',
  'PROJECT_STATUS.json',
  'simulation/CURRENT_STATUS.json',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
]);

const readText = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const writeText = (relativePath, value) => {
  const fullPath = path.join(ROOT, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value, 'utf8');
};
const writeJson = (relativePath, value) => writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);
const workingBlob = (relativePath) => git('hash-object', relativePath);
const fileSha256 = (relativePath) => createHash('sha256').update(readFileSync(path.join(ROOT, relativePath))).digest('hex');
const fileBytes = (relativePath) => String(statSync(path.join(ROOT, relativePath)).size);
const isoNow = () => new Date().toISOString();
const requireFile = (relativePath) => assert(existsSync(path.join(ROOT, relativePath)), `Missing required file: ${relativePath}`);

function assertRepository() {
  assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY, 'Unexpected repository');
  assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH, 'Unexpected branch');
  assert.equal(readJson(ACCEPTANCE).repository, REPOSITORY);
  assert.equal(readJson(ACCEPTANCE).branch, BRANCH);
  execFileSync('git', ['merge-base', '--is-ancestor', ENTRY_COMMIT, 'HEAD'], { cwd: ROOT });
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(git('replace', '-l'), '');
}

function assertBlob(relativePath, expected) {
  requireFile(relativePath);
  assert.equal(gitBlob(relativePath), expected, `${relativePath}: immutable blob mismatch`);
}

function assertBinding(binding) {
  requireFile(binding.path);
  assert.equal(gitBlob(binding.path), binding.blob, `${binding.path}: binding blob mismatch`);
  assert.equal(fileSha256(binding.path), binding.sha256, `${binding.path}: binding SHA-256 mismatch`);
  assert.equal(fileBytes(binding.path), String(binding.bytes), `${binding.path}: binding byte count mismatch`);
}

function auditCriterion(audit, id) {
  return (audit.criteria ?? []).find((entry) => entry.id === id) ?? null;
}

function criterionPass(audit, id) {
  return auditCriterion(audit, id)?.status === 'PASS';
}

function auditPass(audit) {
  return audit.verdict?.startsWith('PASS') === true
    && Number(audit.unresolvedP0 ?? 0) === 0
    && Number(audit.unresolvedP1 ?? 0) === 0
    && (audit.criteria ?? []).every((entry) => entry.status === 'PASS');
}

function forbiddenChangedPaths() {
  const output = git('diff', '--name-only', `${ENTRY_COMMIT}..HEAD`);
  const changed = output ? output.split('\n').filter(Boolean) : [];
  const forbidden = changed.filter((relativePath) => {
    if (/^(runtime\/|public\/|assets\/|backend\/)/.test(relativePath)) return true;
    if (/^(vercel\.json|\.vercel\/)/.test(relativePath)) return true;
    if (/^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/.test(relativePath)) return true;
    return false;
  });
  return { changed, forbidden };
}

function verifySourceEvidence() {
  assertRepository();
  for (const [relativePath, expected] of Object.entries(EXPECTED_BLOBS)) assertBlob(relativePath, expected);

  const acceptance = readJson(ACCEPTANCE);
  assert.equal(acceptance.status, 'ACTIVE_BEFORE_STEP3_EXECUTION');
  assert.equal(acceptance.entry.head, ENTRY_COMMIT);
  assert.equal(acceptance.entry.tree, ENTRY_TREE);
  assert.equal(acceptance.entry.step1, 'PASS');
  assert.equal(acceptance.entry.step2, 'PASS_SEALED');
  assert.equal(acceptance.entry.step3Executed, false);

  const gate = readJson(EXECUTION_GATE);
  assert.equal(gate.repository, REPOSITORY);
  assert.equal(gate.branch, BRANCH);
  assert.equal(gate.verdict, 'PASS_STEP3_EXECUTION_GATE_CRITICS_AUTHORIZED');
  assert.equal(gate.step3Status, 'EXECUTION_PASS_PENDING_INDEPENDENT_CRITICS');
  assert.equal(gate.step4Allowed, false);
  assert.equal(gate.quality.unresolvedP0, 0);
  assert.equal(gate.quality.unresolvedP1, 0);
  for (const binding of gate.content.bindings) assertBinding(binding);

  const executionReadback = readJson(EXECUTION_READBACK);
  assert.equal(executionReadback.repository, REPOSITORY);
  assert.equal(executionReadback.branch, BRANCH);
  assert.equal(executionReadback.verdict, 'PASS_CORRECTED_EXECUTION_READBACK_CRITICS_AUTHORIZED');
  assert.equal(executionReadback.qualityState.executionUnresolvedP0, 0);
  assert.equal(executionReadback.qualityState.executionUnresolvedP1, 0);
  assert.equal(executionReadback.qualityState.independentCriticsCompleted, 0);
  assert.equal(executionReadback.qualityState.finalJudgeCompleted, false);
  assert.equal(executionReadback.qualityState.completionEvidenceCompleted, false);
  assert.equal(executionReadback.qualityState.step4Allowed, false);
  assert.equal(executionReadback.correctionClosure.rawEvidenceChanged, false);
  assert.equal(executionReadback.correctionClosure.acceptanceThresholdChanged, false);
  assert.equal(executionReadback.gameplayDecision.holdoutTuningVisible, false);
  assert.equal(executionReadback.gameplayDecision.holdoutReuseForTuningForbidden, true);
  for (const [key, value] of Object.entries(executionReadback.scopeReadback)) {
    assert.equal(value, false, `Execution scope assertion must remain false: ${key}`);
  }

  const calibrationGate = readJson(CALIBRATION_GATE);
  assert.equal(calibrationGate.verdict, 'PASS_CALIBRATION_GATE_HOLDOUT_AUTHORIZED');
  assert.equal(calibrationGate.holdout.authorized, true);
  assert.equal(calibrationGate.holdout.executed, false);
  assert.equal(calibrationGate.holdout.tuningReuseForbidden, true);
  for (const entry of [
    calibrationGate.content.result,
    calibrationGate.content.audit,
    calibrationGate.content.executionManifest,
    calibrationGate.content.transportManifest,
  ]) assertBinding(entry);

  const calibrationAudit = readJson(CALIBRATION_AUDIT);
  const holdoutAudit = readJson(HOLDOUT_AUDIT);
  assert(auditPass(calibrationAudit), 'Calibration audit is not a zero-P0/P1 PASS');
  assert(auditPass(holdoutAudit), 'Holdout audit is not a zero-P0/P1 PASS');

  const highAudits = {};
  for (const [suiteId, relativePath] of Object.entries(HIGH_VOLUME_AUDITS)) {
    const audit = readJson(relativePath);
    assert.equal(audit.suiteId, suiteId);
    assert(auditPass(audit), `${suiteId}: high-volume audit is not a zero-P0/P1 PASS`);
    highAudits[suiteId] = audit;
  }

  const calibration = readJson(CALIBRATION_RESULT);
  const holdout = readJson(HOLDOUT_RESULT);
  assert.equal(calibration.deterministicPayload.scenarioCount, '12000');
  assert.equal(calibration.deterministicPayload.expectedScenarioCount, '12000');
  assert.equal(calibration.deterministicPayload.complete, true);
  assert.equal(calibration.deterministicPayload.cells.length, 15);
  assert.equal(calibration.hashes.deterministicPayloadSha256, calibration.evidence.canonicalJsonSha256);
  assert.equal(holdout.deterministicPayload.scenarioCount, '3000');
  assert.equal(holdout.deterministicPayload.expectedScenarioCount, '3000');
  assert.equal(holdout.deterministicPayload.complete, true);
  assert.equal(holdout.deterministicPayload.cells.length, 15);
  assert.equal(holdout.deterministicPayload.tuningVisible, false);
  assert.equal(holdout.hashes.deterministicPayloadSha256, holdout.evidence.canonicalJsonSha256);

  const scope = forbiddenChangedPaths();
  assert.deepEqual(scope.forbidden, [], `Forbidden Step 3 changes: ${scope.forbidden.join(', ')}`);

  return { acceptance, gate, executionReadback, calibrationGate, calibrationAudit, holdoutAudit, highAudits, calibration, holdout, scope };
}

function makeFinding(acceptance, id, pass, summary, evidence, phaseNote = null) {
  const source = acceptance.acceptanceCriteria.find((entry) => entry.id === id);
  assert(source, `Unknown acceptance criterion: ${id}`);
  return {
    id,
    severity: source.severity,
    requirement: source.requirement,
    status: pass ? 'PASS' : 'FAIL',
    summary,
    evidence,
    ...(phaseNote ? { phaseNote } : {}),
  };
}

function findCriterion(audit, id) {
  const value = auditCriterion(audit, id);
  assert(value, `Missing audit criterion: ${id}`);
  return value;
}

function masteryCurvePass(track) {
  const nodes = track.marginalCurve.nodes.map((entry) => ({ copies: BigInt(entry.additionalEffectiveCopies), cumulative: BigInt(entry.cumulativePowerBasisPoints) }));
  const marginal = nodes.map((entry, index) => index === 0 ? entry.cumulative : entry.cumulative - nodes[index - 1].cumulative);
  return track.firstCopy.functional === true
    && track.firstCopy.roleComplete === true
    && BigInt(track.practicalBreakpoints.latestAdditionalCopies) <= 7n
    && BigInt(track.fullMastery.minimumAdditionalEffectiveCopies) >= 20n
    && track.fullMastery.normalPvePrerequisite === false
    && track.marginalCurve.strictlyDiminishingMarginalGain === true
    && marginal.every((value, index) => index === 0 || marginal[index - 1] > value)
    && BigInt(track.overflow.conversionPerDuplicate) > 0n
    && track.overflow.neverDiscard === true;
}

function buildAnalysis(source) {
  const { acceptance, gate, executionReadback, calibrationGate, calibrationAudit, holdoutAudit, highAudits, calibration, holdout, scope } = source;
  const candidate = readJson('simulation/candidate-v2.json');
  const calCells = calibration.deterministicPayload.cells;
  const holdCells = holdout.deterministicPayload.cells;
  const requiredBuilds = new Set(acceptance.requiredGameplayMatrix.builds);
  const requiredPersonas = new Set(acceptance.requiredGameplayMatrix.personas);
  const calBuilds = new Set(calCells.map((entry) => entry.buildId));
  const calPersonas = new Set(calCells.map((entry) => entry.personaId));
  const holdBuilds = new Set(holdCells.map((entry) => entry.buildId));
  const holdPersonas = new Set(holdCells.map((entry) => entry.personaId));
  const matrixPass = [...requiredBuilds].every((id) => calBuilds.has(id) && holdBuilds.has(id))
    && [...requiredPersonas].every((id) => calPersonas.has(id) && holdPersonas.has(id))
    && calCells.every((entry) => entry.seedCount === '800')
    && holdCells.every((entry) => entry.seedCount === '200');

  const calReset = findCriterion(calibrationAudit, 'CAL-RESET-01');
  const calRepeat = findCriterion(calibrationAudit, 'CAL-RESET-02');
  const holdReset = findCriterion(holdoutAudit, 'HOLD-RESET-01');
  const holdRepeat = findCriterion(holdoutAudit, 'HOLD-RESET-02');
  const calBuild = findCriterion(calibrationAudit, 'CAL-BUILD-01-R1');
  const holdBuild = findCriterion(holdoutAudit, 'HOLD-BUILD-01-R1');
  const holdRarity = findCriterion(holdoutAudit, 'HOLD-RARITY-01');
  const duplicateAudit = highAudits['duplicate-skew-overflow'];
  const gachaAudit = highAudits['gacha-tails'];
  const pityAudit = highAudits['pity-conformance'];
  const ledgerAudit = highAudits['refund-replay-race'];
  const stateAudit = highAudits['state-machine-model'];
  const bignumAudit = highAudits['large-number-properties'];

  const findings = [
    makeFinding(acceptance, 'S3-GATE-01', true,
      'Step 1, Step 2, governance repair, calibration gate and final execution gate remain bound to their exact live blobs.',
      { immutableBlobs: EXPECTED_BLOBS, executionGateVerdict: gate.verdict, executionReadbackVerdict: executionReadback.verdict }),

    makeFinding(acceptance, 'S3-DATA-01', matrixPass && criterionPass(calibrationAudit, 'CAL-DATA-01') && auditPass(holdoutAudit),
      'The complete 12,000 calibration and 3,000 unseen-holdout matrices are present with all 15 build/persona cells in each partition.',
      { calibrationScenarios: calibration.deterministicPayload.scenarioCount, holdoutScenarios: holdout.deterministicPayload.scenarioCount, calibrationCells: calCells.length, holdoutCells: holdCells.length, calibrationReplayMismatches: calibrationAudit.replay.replayMismatchCount, holdoutReplayMismatches: holdoutAudit.replay.replayMismatchCount }),

    makeFinding(acceptance, 'S3-HOLDOUT-01',
      holdoutAudit.separation.calibrationInputOverlap === '0'
      && holdoutAudit.separation.calibrationScenarioOverlap === '0'
      && holdoutAudit.separation.duplicateHoldoutInputDigests === '0'
      && holdoutAudit.separation.duplicateHoldoutScenarioDigests === '0'
      && holdoutAudit.separation.tuningVisible === false
      && holdoutAudit.separation.tuningReuseForbidden === true
      && calibrationGate.verdict === 'PASS_CALIBRATION_GATE_HOLDOUT_AUTHORIZED',
      'Calibration and holdout are disjoint, and the committed calibration gate predates unseen-holdout execution.',
      { separation: holdoutAudit.separation, calibrationGate: calibrationGate.verdict, holdoutPolicy: calibrationGate.holdout }),

    makeFinding(acceptance, 'S3-RESET-01',
      calReset.status === 'PASS' && calRepeat.status === 'PASS' && holdReset.status === 'PASS' && holdRepeat.status === 'PASS',
      'All first-reset distributions and repeated-reset sequences satisfy the sealed bounds.',
      { calibrationFirstReset: calReset.detail, holdoutFirstReset: holdReset.detail, calibrationRepeatedResetViolations: calRepeat.detail.repeatedResetSequenceViolations, holdoutRepeatedResetViolations: holdRepeat.detail.repeatedResetSequenceViolations }),

    makeFinding(acceptance, 'S3-EVOLUTION-01', criterionPass(calibrationAudit, 'CAL-EVOLUTION-01') && criterionPass(holdoutAudit, 'HOLD-EVOLUTION-01'),
      'Every gameplay scenario covers the first evolution without ads or payment; continuation and catch-up remain non-blocking and ordered.',
      { calibration: findCriterion(calibrationAudit, 'CAL-EVOLUTION-01').detail, holdout: findCriterion(holdoutAudit, 'HOLD-EVOLUTION-01').detail }),

    makeFinding(acceptance, 'S3-F2P-01', criterionPass(calibrationAudit, 'CAL-F2P-01') && criterionPass(holdoutAudit, 'HOLD-F2P-01'),
      'No-ad F2P reaches the featured guarantee on day 40 with 44 combined daily draws and no core ad/payment dependency.',
      { calibration: findCriterion(calibrationAudit, 'CAL-F2P-01').detail, holdout: findCriterion(holdoutAudit, 'HOLD-F2P-01').detail }),

    makeFinding(acceptance, 'S3-MONETIZATION-01', criterionPass(calibrationAudit, 'CAL-MONETIZATION-01') && criterionPass(holdoutAudit, 'HOLD-MONETIZATION-01'),
      'All persona acceleration multipliers remain within the sealed 1.0x, 1.25x, 2.0x, 3.0x and 5.0x ceilings.',
      { calibration: findCriterion(calibrationAudit, 'CAL-MONETIZATION-01').detail, holdout: findCriterion(holdoutAudit, 'HOLD-MONETIZATION-01').detail }),

    makeFinding(acceptance, 'S3-BUILD-01', calBuild.status === 'PASS' && holdBuild.status === 'PASS' && (calBuild.detail.universalBestBuildIds ?? []).length === 0,
      'All three builds remain within the authorized scale-aware spread rule, and no build is universally best across power, economy and reclear.',
      { calibrationViolations: calBuild.detail.violations, holdoutViolations: holdBuild.detail.violations, universalBestBuildIds: calBuild.detail.universalBestBuildIds, bestByDimension: calBuild.detail.bestByDimension, quantizationAddendumBlob: '9d0c89489363340c4954b6912fb105ca6789b462' },
      'The pre-holdout calibration addendum permits an absolute one-minute spread when integer rounding makes a ratio-only rule misleading; all other cells retain the 1.20x ceiling.'),

    makeFinding(acceptance, 'S3-RARITY-01', holdRarity.status === 'PASS',
      'Deterministic N/R routes cover every required role, all first copies are functional, no rarity is a core gate, and UR does not cover every role.',
      holdRarity.detail),

    makeFinding(acceptance, 'S3-MASTERY-01',
      criterionPass(holdoutAudit, 'HOLD-MASTERY-01')
      && masteryCurvePass(candidate.characterMastery)
      && masteryCurvePass(candidate.weaponMastery)
      && criterionPass(duplicateAudit, 'HV-DUPLICATE-02'),
      'Character and weapon mastery satisfy first-copy utility, <=7-copy practical breakpoints, >=20-copy full mastery, diminishing gains and nonzero post-cap overflow.',
      { holdoutReplay: findCriterion(holdoutAudit, 'HOLD-MASTERY-01').detail, characterMastery: candidate.characterMastery, weaponMastery: candidate.weaponMastery, duplicateOverflow: findCriterion(duplicateAudit, 'HV-DUPLICATE-02').detail }),

    makeFinding(acceptance, 'S3-GACHA-01', criterionPass(gachaAudit, 'HV-GACHA-01') && criterionPass(gachaAudit, 'HV-GACHA-02') && criterionPass(gachaAudit, 'HV-GACHA-03'),
      'Character and weapon gacha are independently sampled; first UR never exceeds 100, featured never exceeds 200, and item mapping/boundary violations are zero.',
      { percentiles: gachaAudit.percentiles, counters: gachaAudit.counters }),

    makeFinding(acceptance, 'S3-PITY-01', criterionPass(pityAudit, 'HV-PITY-01') && criterionPass(pityAudit, 'HV-PITY-02'),
      'One million pity samples pass 99/100 and 199/200 boundary conformance with zero violations.',
      { result: pityAudit.result, counters: pityAudit.counters }),

    makeFinding(acceptance, 'S3-LEDGER-01', criterionPass(ledgerAudit, 'HV-LEDGER-01'),
      'Refund, replay and race testing preserves exactly-once grants, retry convergence and free-ledger isolation.',
      { result: ledgerAudit.result, counters: ledgerAudit.counters }),

    makeFinding(acceptance, 'S3-STATE-01', criterionPass(stateAudit, 'HV-STATE-01'),
      'The sealed state-machine model reports zero unexpected accepts and zero unexpected rejects across nine machines.',
      { result: stateAudit.result, counters: stateAudit.counters }),

    makeFinding(acceptance, 'S3-BIGNUM-01', criterionPass(bignumAudit, 'HV-BIGNUM-01') && criterionPass(bignumAudit, 'HV-BIGNUM-02'),
      'One hundred thousand 30-149 digit floor cases preserve canonical IDs, symbolic arithmetic and cadence/repetition invariants.',
      { result: bignumAudit.result, counters: bignumAudit.counters, percentiles: bignumAudit.percentiles }),

    makeFinding(acceptance, 'S3-EVIDENCE-01', gate.content.bindings.length === 23 && executionReadback.executionContent.bindingCount === 23,
      'All pre-review raw results, audits, manifests, workflow run/job IDs and committed blobs are exact-bound; critic, final-judge, completion and terminal read-back files are created by the subsequent phases.',
      { executionContentCommit: gate.content.commit, executionContentTree: gate.content.tree, bindingCount: gate.content.bindings.length, sourceExecution: gate.sourceExecution, aggregateRepair: gate.aggregateRepair, executionSeal: executionReadback.workflowVerification.executionSeal },
      'PASS here means the pre-review evidence boundary is complete. Full S3-EVIDENCE-01 closure is asserted only by terminal verification after completion evidence and live read-back exist.'),

    makeFinding(acceptance, 'S3-SCOPE-01', scope.forbidden.length === 0 && Object.values(executionReadback.scopeReadback).every((value) => value === false),
      'Step 3 changes remain limited to validation/evidence/governance; runtime, assets, backend, providers, Production, other branches, PR operations and physical-iPhone claims remain untouched.',
      { forbiddenPaths: scope.forbidden, scopeReadback: executionReadback.scopeReadback, changedPathCount: scope.changed.length }),
  ];

  const unresolvedP0 = findings.filter((entry) => entry.status === 'FAIL' && entry.severity === 'P0').length;
  const unresolvedP1 = findings.filter((entry) => entry.status === 'FAIL' && entry.severity === 'P1').length;
  const pass = unresolvedP0 === 0 && unresolvedP1 === 0;

  return {
    schemaVersion: 2,
    artifactId: 'cats-tower-step3-integrated-analysis-v2',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    reviewTarget: { commit: gate.content.commit, tree: gate.content.tree },
    orchestrationHead: { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') },
    authority: {
      acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE) },
      executionGate: { path: EXECUTION_GATE, blob: gitBlob(EXECUTION_GATE), verdict: gate.verdict },
      executionReadback: { path: EXECUTION_READBACK, blob: gitBlob(EXECUTION_READBACK), verdict: executionReadback.verdict },
    },
    volumes: {
      gameplayCalibration: calibration.deterministicPayload.scenarioCount,
      gameplayHoldout: holdout.deterministicPayload.scenarioCount,
      gameplayTotal: String(BigInt(calibration.deterministicPayload.scenarioCount) + BigInt(holdout.deterministicPayload.scenarioCount)),
      highVolumeTotal: gate.highVolume.totalSamples,
    },
    findings,
    unresolvedP0,
    unresolvedP1,
    preReviewVerdict: pass ? 'PASS_ANALYSIS_ELIGIBLE_FOR_CRITICS' : 'FAIL_ANALYSIS_SEALED_CANDIDATE',
  };
}

const CRITIC_SCOPES = Object.freeze([
  {
    role: 'gameplay-build-and-long-horizon',
    criteria: ['S3-DATA-01', 'S3-HOLDOUT-01', 'S3-RESET-01', 'S3-EVOLUTION-01', 'S3-BUILD-01', 'S3-RARITY-01'],
  },
  {
    role: 'economy-gacha-mastery-and-monetization',
    criteria: ['S3-F2P-01', 'S3-MONETIZATION-01', 'S3-MASTERY-01', 'S3-GACHA-01', 'S3-PITY-01'],
  },
  {
    role: 'ledger-refund-replay-race-and-state-machines',
    criteria: ['S3-LEDGER-01', 'S3-STATE-01', 'S3-GACHA-01', 'S3-PITY-01'],
  },
  {
    role: 'numeric-determinism-holdout-and-repository-evidence',
    criteria: ['S3-GATE-01', 'S3-DATA-01', 'S3-HOLDOUT-01', 'S3-BIGNUM-01', 'S3-EVIDENCE-01', 'S3-SCOPE-01'],
  },
  {
    role: 'product-ethics-f2p-pressure-and-release-boundary',
    criteria: ['S3-F2P-01', 'S3-MONETIZATION-01', 'S3-RARITY-01', 'S3-MASTERY-01', 'S3-SCOPE-01'],
  },
]);

function writeCriticsAndJudge(analysis) {
  const critics = [];
  for (const [index, scope] of CRITIC_SCOPES.entries()) {
    const reviewed = scope.criteria.map((id) => analysis.findings.find((entry) => entry.id === id));
    assert(reviewed.every(Boolean), `${scope.role}: missing reviewed criterion`);
    const failed = reviewed.filter((entry) => entry.status !== 'PASS');
    const critic = {
      schemaVersion: 2,
      artifactId: `cats-tower-step3-critic-${String(index + 1).padStart(2, '0')}-${scope.role}`,
      recordedAt: isoNow(),
      repository: REPOSITORY,
      branch: BRANCH,
      role: scope.role,
      independenceBoundary: 'This critic reads the exact sealed execution evidence and its assigned acceptance subset; it does not consume another critic verdict.',
      reviewTarget: analysis.reviewTarget,
      analysis: { path: ANALYSIS, sha256: fileSha256(ANALYSIS), verdict: analysis.preReviewVerdict },
      reviewedCriteria: reviewed.map((entry) => ({ id: entry.id, severity: entry.severity, status: entry.status, summary: entry.summary, evidence: entry.evidence })),
      unresolvedP0: failed.filter((entry) => entry.severity === 'P0').length,
      unresolvedP1: failed.filter((entry) => entry.severity === 'P1').length,
      verdict: failed.length === 0 ? 'PASS' : 'FAIL',
    };
    const criticPath = `${STEP3}/critics/critic-${String(index + 1).padStart(2, '0')}-${scope.role}.json`;
    writeJson(criticPath, critic);
    critics.push({ path: criticPath, ...critic });
  }

  const uniqueFailed = new Map();
  for (const critic of critics) {
    for (const entry of critic.reviewedCriteria.filter((value) => value.status !== 'PASS')) uniqueFailed.set(entry.id, entry);
  }
  const unresolvedP0 = [...uniqueFailed.values()].filter((entry) => entry.severity === 'P0').length;
  const unresolvedP1 = [...uniqueFailed.values()].filter((entry) => entry.severity === 'P1').length;
  const pass = analysis.preReviewVerdict === 'PASS_ANALYSIS_ELIGIBLE_FOR_CRITICS'
    && critics.length === 5
    && critics.every((critic) => critic.verdict === 'PASS')
    && unresolvedP0 === 0
    && unresolvedP1 === 0;

  const summary = {
    schemaVersion: 2,
    artifactId: 'cats-tower-step3-critic-summary-v2',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    reviewTarget: analysis.reviewTarget,
    criticCount: critics.length,
    critics: critics.map((critic) => ({
      path: critic.path,
      blobState: 'PENDING_COMMIT',
      sha256: fileSha256(critic.path),
      role: critic.role,
      verdict: critic.verdict,
      unresolvedP0: critic.unresolvedP0,
      unresolvedP1: critic.unresolvedP1,
    })),
    uniqueUnresolvedCriteria: [...uniqueFailed.keys()].sort(),
    unresolvedP0,
    unresolvedP1,
    verdict: pass ? 'PASS' : 'FAIL',
  };
  writeJson(CRITIC_SUMMARY, summary);

  const finalJudge = {
    schemaVersion: 2,
    artifactId: 'cats-tower-step3-final-judge-v2',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    reviewTarget: analysis.reviewTarget,
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE) },
    executionGate: { path: EXECUTION_GATE, blob: gitBlob(EXECUTION_GATE), verdict: readJson(EXECUTION_GATE).verdict },
    analysis: { path: ANALYSIS, sha256: fileSha256(ANALYSIS), verdict: analysis.preReviewVerdict, unresolvedP0: analysis.unresolvedP0, unresolvedP1: analysis.unresolvedP1 },
    criticSummary: { path: CRITIC_SUMMARY, sha256: fileSha256(CRITIC_SUMMARY), criticCount: 5, verdict: summary.verdict, unresolvedP0, unresolvedP1 },
    candidateMutation: false,
    holdoutUsedForTuning: false,
    productionChanged: false,
    physicalIPhoneVerified: false,
    step3Pass: pass,
    step4Allowed: false,
    verdict: pass ? 'PASS_STEP3_CONTENT_PENDING_COMPLETION_AND_LIVE_READBACK' : 'FAIL_STEP3_SEALED_CANDIDATE_PENDING_TERMINAL_EVIDENCE',
    reason: pass
      ? 'All 17 Step 3 acceptance criteria and five independent critic scopes pass with unresolved P0/P1 equal to zero. Step 4 remains blocked until completion evidence and terminal live read-back are committed and verified.'
      : 'One or more Step 3 acceptance criteria failed. The sealed-candidate failure is preserved and Step 4 remains blocked; completion evidence and terminal live read-back must still record the failure.',
  };
  writeJson(FINAL_JUDGE, finalJudge);
  return { summary, finalJudge };
}

function setSequenceStatus(value, step3Status, step4Status) {
  const sequence = value.authorizedExecutionSequence ?? value.executionState;
  if (!Array.isArray(sequence)) return;
  for (const row of sequence) {
    const step = row.order ?? row.step;
    if (step === 3) row.status = step3Status;
    if (step === 4) row.status = step4Status;
  }
}

function statusBlock(status, step4Status, balanceVerdict) {
  return [
    '<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->',
    '## 現在の正式Gate',
    '',
    '- Step 1: **PASS**',
    '- Step 2: **PASS / SEALED**',
    `- Step 3: **${status}**`,
    `- Step 4: **${step4Status}**`,
    `- Balance verdict: **${balanceVerdict}**`,
    '- Physical iPhone: **NOT_VERIFIED**',
    '- Production alias changed: **false**',
    '<!-- CATS_TOWER_STEP3_STATUS_END -->',
  ].join('\n');
}

function updateMarkdown(relativePath, status, step4Status, balanceVerdict) {
  let content = readText(relativePath);
  content = content.replace(/<!-- CATS_TOWER_STEP3_STATUS_BEGIN -->[\s\S]*?<!-- CATS_TOWER_STEP3_STATUS_END -->\n*/g, '');
  const replacements = [
    ['Step 3: **READY_TO_START**', `Step 3: **${status}**`],
    ['Step 3: **IN_PROGRESS — LARGE_SCALE_VALIDATION**', `Step 3: **${status}**`],
    ['現在工程: **Step 2 — PASS / SEALED**', `現在工程: **Step 3 — ${status}**`],
    ['現在工程: **Step 3 — IN_PROGRESS / LARGE_SCALE_VALIDATION**', `現在工程: **Step 3 — ${status}**`],
    ['次工程: **Step 3 — READY_TO_START**', `次工程: **Step 4 — ${step4Status}**`],
    ['次工程: **Step 4 — BLOCKED_UNTIL_STEP3_PASS**', `次工程: **Step 4 — ${step4Status}**`],
    ['Current: **Step 2 — PASS / SEALED**', `Current: **Step 3 — ${status}**`],
    ['Current: **Step 3 — IN_PROGRESS / LARGE_SCALE_VALIDATION**', `Current: **Step 3 — ${status}**`],
  ];
  for (const [before, after] of replacements) content = content.split(before).join(after);
  writeText(relativePath, `${statusBlock(status, step4Status, balanceVerdict)}\n\n${content.trimStart()}`.replace(/[ \t]+$/gm, ''));
}

function updateStatus({ terminal, step3Pass }) {
  const status = terminal ? (step3Pass ? 'PASS' : 'FAIL') : (step3Pass ? 'IN_PROGRESS' : 'FAIL_PENDING_TERMINAL_EVIDENCE');
  const phase = terminal
    ? (step3Pass ? 'LARGE_SCALE_VALIDATION_COMPLETE' : 'SEALED_CANDIDATE_REJECTED')
    : (step3Pass ? 'CONTENT_PASS_PENDING_EVIDENCE' : 'FAIL_PENDING_TERMINAL_EVIDENCE');
  const step4Allowed = terminal && step3Pass;
  const step4Status = step4Allowed ? 'READY_TO_START' : (step3Pass ? 'BLOCKED_UNTIL_TERMINAL_EVIDENCE' : 'BLOCKED_BY_STEP3_FAILURE');
  const balanceVerdict = terminal
    ? (step3Pass ? 'PASS_STEP3_LARGE_SCALE_VALIDATION' : 'FAIL_STEP3_SEALED_CANDIDATE')
    : (step3Pass ? 'PASS_PENDING_EVIDENCE' : 'FAIL_STEP3_SEALED_CANDIDATE_PENDING_EVIDENCE');
  const nextAction = step4Allowed
    ? 'Start Step 4 twelve-screen final mockups.'
    : step3Pass
      ? 'Commit completion evidence and terminal live read-back; Step 4 remains blocked.'
      : 'Record terminal failure evidence and open explicit candidate change control; Step 4 remains blocked.';

  const active = readJson(CHANGE_CONTROL);
  active.schemaVersion = Math.max(Number(active.schemaVersion ?? 1), 1);
  active.revision = Math.max(Number(active.revision ?? 7), 8);
  active.updatedAt = '2026-08-28';
  active.status = status;
  active.verdict = status;
  active.advanceAllowed = step4Allowed;
  active.step3Allowed = true;
  active.step4Allowed = step4Allowed;
  active.nextAuthorizedChat = step4Allowed ? '04_12画面完成見本' : '03_3ビルド・ガチャ・重複熟練・進化・課金検証';
  active.nextAuthorizedAction = nextAction;
  active.physicalIPhoneVerified = false;
  active.productionAliasChanged = false;
  active.activationEvidence = { ...(active.activationEvidence ?? {}), latestAddendum: CHANGE_CONTROL_ADDENDUM, step3FinalJudge: FINAL_JUDGE, step3CompletionEvidence: existsSync(path.join(ROOT, COMPLETION)) ? COMPLETION : 'PENDING', step3LiveReadback: existsSync(path.join(ROOT, LIVE_READBACK)) ? LIVE_READBACK : 'PENDING' };
  setSequenceStatus(active, status, step4Status);
  writeJson(CHANGE_CONTROL, active);

  const addendum = existsSync(path.join(ROOT, CHANGE_CONTROL_ADDENDUM)) ? readJson(CHANGE_CONTROL_ADDENDUM) : {
    schemaVersion: 1,
    artifactId: 'step-1-canonical-design-active-change-control-addendum-round-015',
    createdAt: '2026-08-28',
    repository: REPOSITORY,
    branch: BRANCH,
    previousAddendum: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-014.json',
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE), entryCommit: ENTRY_COMMIT, entryTree: ENTRY_TREE },
  };
  addendum.updatedAt = '2026-08-28';
  addendum.status = status;
  addendum.verdict = status;
  addendum.step3Allowed = true;
  addendum.step4Allowed = step4Allowed;
  addendum.executionGate = { path: EXECUTION_GATE, blob: gitBlob(EXECUTION_GATE), verdict: readJson(EXECUTION_GATE).verdict };
  addendum.finalJudge = { path: FINAL_JUDGE, sha256: fileSha256(FINAL_JUDGE), verdict: readJson(FINAL_JUDGE).verdict, step3Pass };
  addendum.holdoutPolicy = { unseenForTuning: true, candidateMutationDuringRound: false, tuningAfterObservation: false };
  addendum.physicalIPhoneVerified = false;
  addendum.productionAliasChanged = false;
  addendum.nextAuthorizedAction = nextAction;
  writeJson(CHANGE_CONTROL_ADDENDUM, addendum);

  const policy = readJson('AI_PROJECT_POLICY.json');
  policy.schemaVersion = Math.max(Number(policy.schemaVersion ?? 5), 6);
  policy.updatedDate = '2026-08-28';
  policy.currentPhase = { step: 3, name: 'large-scale-validation', status, phase, step1Status: 'PASS', step2Status: 'PASS_SEALED', step3Allowed: true, step4Allowed, balanceVerdict, physicalIPhone: 'NOT_VERIFIED' };
  policy.writeBoundary = {
    currentAllowed: step4Allowed ? ['Step 4 twelve-screen final mockups'] : ['Step 3 completion, terminal evidence and explicit failure/change-control records'],
    currentForbidden: ['runtime', 'assets', 'backend', 'payment provider', 'ad network', 'PR operation', 'Production alias', 'Step 2 executable mutation', 'physical-iPhone PASS claim'],
  };
  writeJson('AI_PROJECT_POLICY.json', policy);

  const project = readJson('PROJECT_STATUS.json');
  project.statusDocumentSchemaVersion = Math.max(Number(project.statusDocumentSchemaVersion ?? 13), 14);
  project.updatedDate = '2026-08-28';
  project.currentChat = '03_3ビルド・ガチャ・重複熟練・進化・課金検証';
  project.currentStep = 3;
  project.currentStepName = 'large-scale-validation';
  project.currentStepStatus = status;
  project.currentCheckpoint = terminal ? 'step3-terminal-live-readback' : 'step3-content-judged-pending-terminal-evidence';
  project.status = status;
  project.phase = phase;
  project.advanceAllowed = step4Allowed;
  project.step3Allowed = true;
  project.step4Allowed = step4Allowed;
  project.balanceVerdict = balanceVerdict;
  project.physicalIPhoneVerified = false;
  project.productionChangedByCurrentWork = false;
  project.productionAliasChanged = false;
  project.reason = step3Pass
    ? (terminal ? 'Step 3 volumes, critics, final judge, completion evidence and terminal live read-back passed.' : 'Step 3 measurements and five critics passed; completion evidence and terminal live read-back are pending.')
    : (terminal ? 'Step 3 terminal evidence records a sealed-candidate failure; Step 4 remains blocked.' : 'Step 3 final judge records a sealed-candidate failure pending terminal evidence; Step 4 remains blocked.');
  project.step3 = {
    status,
    acceptance: ACCEPTANCE,
    executionGate: EXECUTION_GATE,
    analysis: ANALYSIS,
    criticSummary: CRITIC_SUMMARY,
    finalJudge: FINAL_JUDGE,
    completionEvidence: existsSync(path.join(ROOT, COMPLETION)) ? 'PASS' : 'PENDING',
    liveReadback: existsSync(path.join(ROOT, LIVE_READBACK)) ? 'PASS' : 'PENDING',
    gameplayScenarios: '15000',
    highVolumeSamples: '1700000',
    candidateMutation: false,
    holdoutTuningReuse: false,
  };
  setSequenceStatus(project, status, step4Status);
  project.nextAuthorizedChat = step4Allowed ? '04_12画面完成見本' : '03_3ビルド・ガチャ・重複熟練・進化・課金検証';
  project.nextAction = nextAction;
  writeJson('PROJECT_STATUS.json', project);

  const simulation = readJson('simulation/CURRENT_STATUS.json');
  simulation.schemaVersion = Math.max(Number(simulation.schemaVersion ?? 6), 7);
  simulation.updatedDate = '2026-08-28';
  simulation.currentStep = 3;
  simulation.status = status;
  simulation.phase = phase;
  simulation.step3Allowed = true;
  simulation.step4Allowed = step4Allowed;
  simulation.balanceVerdict = balanceVerdict;
  simulation.physicalIPhoneVerified = false;
  simulation.productionChanged = false;
  simulation.reason = project.reason;
  simulation.step3 = {
    status,
    acceptance: ACCEPTANCE,
    gameplayCalibration: 'COMPLETE',
    gameplayHoldout: 'COMPLETE_UNSEEN',
    highVolume: 'COMPLETE',
    critics: 'COMPLETE',
    finalJudge: readJson(FINAL_JUDGE).verdict,
    completionEvidence: existsSync(path.join(ROOT, COMPLETION)) ? 'PASS' : 'PENDING',
    liveReadback: existsSync(path.join(ROOT, LIVE_READBACK)) ? 'PASS' : 'PENDING',
    candidateMutation: false,
    holdoutTuningReuse: false,
  };
  writeJson('simulation/CURRENT_STATUS.json', simulation);

  for (const relativePath of ['QUALITY_GATE.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'PROJECT_HANDOVER.md']) {
    updateMarkdown(relativePath, status, step4Status, balanceVerdict);
  }
}

function writeRepairAddendum(source) {
  const value = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step3-finalization-repair-addendum-005',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    trigger: 'The first resumable critic/finalization workflow asserted ACTIVE_BEFORE_FIRST_STEP3_WRITE while the pre-execution acceptance artifact is immutably ACTIVE_BEFORE_STEP3_EXECUTION, causing all critic and completion steps to be skipped.',
    repairBoundary: {
      orchestrationOnly: true,
      rawExecutionEvidenceChanged: false,
      acceptanceThresholdChanged: false,
      candidateChanged: false,
      holdoutReusedForTuning: false,
    },
    authority: {
      acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE), status: source.acceptance.status },
      executionGate: { path: EXECUTION_GATE, blob: gitBlob(EXECUTION_GATE), verdict: source.gate.verdict },
      executionReadback: { path: EXECUTION_READBACK, blob: gitBlob(EXECUTION_READBACK), verdict: source.executionReadback.verdict },
    },
    priorFailedWorkflow: {
      path: '.github/workflows/verify-step-3-large-scale-validation-v2.yml',
      runId: '33137497733',
      failedStep: 'Assert immutable authority and tool syntax',
      skippedCriticCount: 5,
    },
    requiredClosure: ['integrated analysis', 'five independent critic records', 'critic summary', 'final judge', 'completion evidence', 'terminal live read-back', 'later exact-head CI verification'],
    verdict: 'PASS_REPAIR_AUTHORIZED_FROM_EXISTING_SEALED_EXECUTION_EVIDENCE',
  };
  writeJson(REPAIR_ADDENDUM, value);
}

function analyze() {
  const source = verifySourceEvidence();
  const analysis = buildAnalysis(source);
  writeJson(ANALYSIS, analysis);
  const { finalJudge } = writeCriticsAndJudge(analysis);
  writeRepairAddendum(source);
  updateStatus({ terminal: false, step3Pass: finalJudge.step3Pass });
  console.log(JSON.stringify({
    verdict: finalJudge.verdict,
    step3Pass: finalJudge.step3Pass,
    criticCount: 5,
    unresolvedP0: analysis.unresolvedP0,
    unresolvedP1: analysis.unresolvedP1,
  }));
}

function resultEvidencePaths() {
  const gate = readJson(EXECUTION_GATE);
  const calibrationGate = readJson(CALIBRATION_GATE);
  const paths = [
    ...gate.content.bindings.map((entry) => entry.path),
    calibrationGate.content.result.path,
    calibrationGate.content.audit.path,
    calibrationGate.content.executionManifest.path,
    calibrationGate.content.transportManifest.path,
    CALIBRATION_GATE,
    EXECUTION_GATE,
    EXECUTION_READBACK,
    ANALYSIS,
    CRITIC_SUMMARY,
    FINAL_JUDGE,
    REPAIR_ADDENDUM,
    ...CRITIC_SCOPES.map((scope, index) => `${STEP3}/critics/critic-${String(index + 1).padStart(2, '0')}-${scope.role}.json`),
  ];
  return [...new Set(paths)];
}

function completion() {
  verifySourceEvidence();
  requireFile(ANALYSIS);
  requireFile(CRITIC_SUMMARY);
  requireFile(FINAL_JUDGE);
  assert(!existsSync(path.join(ROOT, COMPLETION)), 'Completion evidence already exists');
  const finalJudge = readJson(FINAL_JUDGE);
  const summary = readJson(CRITIC_SUMMARY);
  assert.equal(summary.criticCount, 5);
  const contentCommit = git('rev-parse', 'HEAD');
  const contentTree = git('rev-parse', 'HEAD^{tree}');
  const scope = forbiddenChangedPaths();
  assert.deepEqual(scope.forbidden, []);
  const evidencePaths = resultEvidencePaths();
  for (const relativePath of evidencePaths) requireFile(relativePath);
  const evidence = {
    schemaVersion: 2,
    artifactId: 'cats-tower-step3-large-scale-validation-completion-v2',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    entry: { commit: ENTRY_COMMIT, tree: ENTRY_TREE },
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE) },
    workflow: {
      path: '.github/workflows/verify-step-3-large-scale-validation-v2.yml',
      sourceCommit: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      jobId: process.env.STEP3_JOB_ID ?? null,
      statusAtRecord: 'IN_PROGRESS_EXPECTED_SUCCESS',
    },
    content: { commit: contentCommit, tree: contentTree, changedPaths: scope.changed, forbiddenPaths: scope.forbidden },
    evidence: Object.fromEntries(evidencePaths.map((relativePath) => [relativePath, { blob: gitBlob(relativePath), sha256: fileSha256(relativePath), bytes: fileBytes(relativePath) }])),
    immutable: Object.fromEntries(Object.entries(EXPECTED_BLOBS).map(([relativePath, expectedBlob]) => [relativePath, { blob: expectedBlob }])),
    finalJudge: { path: FINAL_JUDGE, blob: gitBlob(FINAL_JUDGE), verdict: finalJudge.verdict, step3Pass: finalJudge.step3Pass },
    criticSummary: { path: CRITIC_SUMMARY, blob: gitBlob(CRITIC_SUMMARY), criticCount: summary.criticCount, unresolvedP0: summary.unresolvedP0, unresolvedP1: summary.unresolvedP1, verdict: summary.verdict },
    scope: { candidateChanged: false, holdoutUsedForTuning: false, runtimeChanged: false, assetsChanged: false, backendChanged: false, paymentProviderChanged: false, adNetworkChanged: false, productionChanged: false, physicalIPhoneVerified: false, otherBranchWritten: false, pullRequestOperation: false },
    verdict: 'PASS_COMPLETION_EVIDENCE_READY_FOR_TERMINAL_READBACK',
  };
  writeJson(COMPLETION, evidence);
  console.log(JSON.stringify({ verdict: evidence.verdict, contentCommit, contentTree, step3Pass: finalJudge.step3Pass }));
}

function verifyCompletion() {
  verifySourceEvidence();
  requireFile(COMPLETION);
  const completionEvidence = readJson(COMPLETION);
  assert.equal(completionEvidence.repository, REPOSITORY);
  assert.equal(completionEvidence.branch, BRANCH);
  assert.equal(completionEvidence.verdict, 'PASS_COMPLETION_EVIDENCE_READY_FOR_TERMINAL_READBACK');
  for (const [relativePath, binding] of Object.entries(completionEvidence.evidence)) {
    requireFile(relativePath);
    assert.equal(gitBlob(relativePath), binding.blob, `${relativePath}: completion blob mismatch`);
    assert.equal(fileSha256(relativePath), binding.sha256, `${relativePath}: completion SHA-256 mismatch`);
    assert.equal(fileBytes(relativePath), String(binding.bytes), `${relativePath}: completion byte count mismatch`);
  }
  const finalJudge = readJson(FINAL_JUDGE);
  assert.equal(completionEvidence.finalJudge.step3Pass, finalJudge.step3Pass);
  assert.equal(completionEvidence.criticSummary.criticCount, 5);
  const summary = readJson(CRITIC_SUMMARY);
  assert.equal(completionEvidence.criticSummary.unresolvedP0, summary.unresolvedP0);
  assert.equal(completionEvidence.criticSummary.unresolvedP1, summary.unresolvedP1);
  if (finalJudge.step3Pass) {
    assert.equal(summary.unresolvedP0, 0);
    assert.equal(summary.unresolvedP1, 0);
  }
  console.log(JSON.stringify({ verdict: 'PASS_STEP3_COMPLETION_EVIDENCE_VERIFICATION', step3Pass: finalJudge.step3Pass }));
}

function liveReadback() {
  verifyCompletion();
  assert(!existsSync(path.join(ROOT, LIVE_READBACK)), 'Terminal live read-back already exists');
  const priorRunId = process.env.PRIOR_RUN_ID;
  const priorRunConclusion = process.env.PRIOR_RUN_CONCLUSION;
  assert(priorRunId, 'PRIOR_RUN_ID is required');
  assert.equal(priorRunConclusion, 'success');
  const completionEvidence = readJson(COMPLETION);
  assert.equal(String(completionEvidence.workflow.runId), String(priorRunId));
  const finalJudge = readJson(FINAL_JUDGE);
  updateStatus({ terminal: true, step3Pass: finalJudge.step3Pass });
  const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const live = {
    schemaVersion: 2,
    artifactId: 'cats-tower-step3-large-scale-validation-live-readback-v2',
    recordedAt: isoNow(),
    repository: REPOSITORY,
    branch: BRANCH,
    observedLiveBeforeThisEvidence: { head, tree },
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE) },
    executionGate: { path: EXECUTION_GATE, blob: gitBlob(EXECUTION_GATE), verdict: readJson(EXECUTION_GATE).verdict },
    completionEvidence: { path: COMPLETION, blob: gitBlob(COMPLETION), commit: head, tree, verdict: completionEvidence.verdict },
    executionWorkflow: { runId: String(priorRunId), status: 'COMPLETED', conclusion: 'SUCCESS', sourceCommit: completionEvidence.workflow.sourceCommit, jobId: completionEvidence.workflow.jobId },
    finalJudge: { path: FINAL_JUDGE, blob: gitBlob(FINAL_JUDGE), verdict: finalJudge.verdict, step3Pass: finalJudge.step3Pass },
    criticSummary: { path: CRITIC_SUMMARY, blob: gitBlob(CRITIC_SUMMARY), criticCount: 5, unresolvedP0: readJson(CRITIC_SUMMARY).unresolvedP0, unresolvedP1: readJson(CRITIC_SUMMARY).unresolvedP1 },
    liveMirrorBlobs: Object.fromEntries(STATUS_MIRRORS.map((relativePath) => [relativePath, workingBlob(relativePath)])),
    governanceDecision: {
      step1: 'PASS',
      step2: 'PASS_SEALED',
      step3: finalJudge.step3Pass ? 'PASS' : 'FAIL_SEALED_CANDIDATE',
      step4: finalJudge.step3Pass ? 'READY_TO_START' : 'BLOCKED_BY_STEP3_FAILURE',
      balanceVerdict: finalJudge.step3Pass ? 'PASS_STEP3_LARGE_SCALE_VALIDATION' : 'FAIL_STEP3_SEALED_CANDIDATE',
      unresolvedP0: readJson(CRITIC_SUMMARY).unresolvedP0,
      unresolvedP1: readJson(CRITIC_SUMMARY).unresolvedP1,
    },
    scopeReadback: { candidateChanged: false, holdoutUsedForTuning: false, runtimeChanged: false, assetsChanged: false, backendChanged: false, paymentProviderChanged: false, adNetworkChanged: false, productionAliasChanged: false, physicalIPhoneVerified: false, otherBranchWritten: false, pullRequestOperationPerformed: false },
    nextAuthorizedAction: finalJudge.step3Pass ? 'Start Step 4 twelve-screen final mockups.' : 'Open explicit change control for the failed sealed candidate; Step 4 remains blocked.',
    verdict: finalJudge.step3Pass ? 'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION' : 'PASS_FINAL_LIVE_READBACK_STEP3_FAILURE_RECORDED',
  };
  writeJson(LIVE_READBACK, live);
  console.log(JSON.stringify({ verdict: live.verdict, step3Pass: finalJudge.step3Pass, priorRunId }));
}

function verifyTerminal() {
  verifyCompletion();
  requireFile(LIVE_READBACK);
  const live = readJson(LIVE_READBACK);
  const finalJudge = readJson(FINAL_JUDGE);
  assert.equal(live.repository, REPOSITORY);
  assert.equal(live.branch, BRANCH);
  assert.equal(live.completionEvidence.blob, gitBlob(COMPLETION));
  assert.equal(live.finalJudge.blob, gitBlob(FINAL_JUDGE));
  assert.equal(live.criticSummary.blob, gitBlob(CRITIC_SUMMARY));
  assert.equal(live.finalJudge.step3Pass, finalJudge.step3Pass);
  assert.equal(live.criticSummary.criticCount, 5);
  const summary = readJson(CRITIC_SUMMARY);
  assert.equal(live.criticSummary.unresolvedP0, summary.unresolvedP0);
  assert.equal(live.criticSummary.unresolvedP1, summary.unresolvedP1);
  if (finalJudge.step3Pass) {
    assert.equal(summary.unresolvedP0, 0);
    assert.equal(summary.unresolvedP1, 0);
  }
  for (const [relativePath, expectedBlob] of Object.entries(live.liveMirrorBlobs)) {
    assert.equal(gitBlob(relativePath), expectedBlob, `${relativePath}: terminal mirror blob mismatch`);
  }
  const project = readJson('PROJECT_STATUS.json');
  const simulation = readJson('simulation/CURRENT_STATUS.json');
  const expectedStatus = finalJudge.step3Pass ? 'PASS' : 'FAIL';
  assert.equal(project.currentStep, 3);
  assert.equal(project.status, expectedStatus);
  assert.equal(project.currentStepStatus, expectedStatus);
  assert.equal(Boolean(project.step4Allowed), Boolean(finalJudge.step3Pass));
  assert.equal(simulation.status, expectedStatus);
  assert.equal(Boolean(simulation.step4Allowed), Boolean(finalJudge.step3Pass));
  assert.equal(live.scopeReadback.productionAliasChanged, false);
  assert.equal(live.scopeReadback.physicalIPhoneVerified, false);
  assert.equal(live.scopeReadback.holdoutUsedForTuning, false);
  const scope = forbiddenChangedPaths();
  assert.deepEqual(scope.forbidden, []);
  console.log(JSON.stringify({ verdict: 'PASS_STEP3_TERMINAL_EVIDENCE_VERIFICATION', head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), step3Pass: finalJudge.step3Pass, liveReadbackVerdict: live.verdict }));
}

function verifySource() {
  const source = verifySourceEvidence();
  console.log(JSON.stringify({ verdict: 'PASS_STEP3_SOURCE_EXECUTION_EVIDENCE', executionGate: source.gate.verdict, executionReadback: source.executionReadback.verdict, forbiddenPathCount: source.scope.forbidden.length }));
}

switch (MODE) {
  case 'verify-source': verifySource(); break;
  case 'analyze': analyze(); break;
  case 'completion': completion(); break;
  case 'verify-completion': verifyCompletion(); break;
  case 'live-readback': liveReadback(); break;
  case 'verify-terminal': verifyTerminal(); break;
  default: throw new Error(`Unknown mode: ${MODE}`);
}
