#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { deterministicSeed } from '../../simulation/engine-v2/rng.mjs';
import { runScenario } from '../../simulation/engine-v2/run-scenario.mjs';
import { summarizeUnsigned } from '../../simulation/engine-v2/statistics.mjs';
import { sha256Canonical, sha256Text } from '../../simulation/engine-v2/hash.mjs';

const ROOT = process.cwd();
const EXPECTED_REPOSITORY = '2hg7trp7rv-design/cats_tower';
const EXPECTED_BRANCH = 'kimi';
const EXPECTED_SCENARIOS = 3000;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function asBigInt(value, label) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`INVALID_UNSIGNED:${label}:${value}`);
  return BigInt(value);
}

function exactDecimalParts(value, label) {
  const text = String(value);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(text);
  if (!match) throw new Error(`INVALID_DECIMAL:${label}:${text}`);
  const fraction = match[2] ?? '';
  return { n: BigInt(`${match[1]}${fraction}`), d: 10n ** BigInt(fraction.length) };
}

function compareDecimal(left, right) {
  return left.n * right.d < right.n * left.d ? -1 : left.n * right.d > right.n * left.d ? 1 : 0;
}

function decimalAtMost(value, maximum, label) {
  return compareDecimal(exactDecimalParts(value, label), exactDecimalParts(maximum, `${label}.maximum`)) <= 0;
}

function staticRoleAudit(catalog, requiredRoles) {
  const required = new Set(requiredRoles);
  const deterministic = catalog.filter((entry) => ['N', 'R'].includes(entry.baseRarity) && entry.acquisition === 'DETERMINISTIC_NON_GACHA');
  const deterministicRoles = new Set(deterministic.map((entry) => entry.role));
  const urRoles = new Set(catalog.filter((entry) => entry.baseRarity === 'UR').map((entry) => entry.role));
  return {
    deterministicCoversAllRequired: [...required].every((role) => deterministicRoles.has(role)),
    allFirstCopiesFunctional: catalog.every((entry) => entry.firstCopyFunctional === true),
    allCoreProgressionGateFalse: catalog.every((entry) => entry.coreProgressionGate === false),
    urCoversEveryRequiredRole: [...required].every((role) => urRoles.has(role)),
    deterministicRoles: [...deterministicRoles].sort(),
    urRoles: [...urRoles].sort(),
  };
}

const resultPath = arg('--result');
const outputPath = arg('--output');
if (!resultPath || !outputPath) throw new Error('--result and --output are required');

const paths = {
  candidate: 'simulation/candidate-v2.json',
  plan: 'simulation/run-plan-v2.json',
  execution: 'simulation/execution-contract-v2.json',
  calibrationResult: 'quality-reviews/step-3-large-scale-validation/gameplay-calibration-result.json',
  calibrationAudit: 'quality-reviews/step-3-large-scale-validation/calibration-audit.json',
  calibrationGate: 'quality-reviews/step-3-large-scale-validation/calibration-gate.json',
  calibrationReadback: 'quality-reviews/step-3-large-scale-validation/calibration-live-readback.json',
  acceptance: 'quality-reviews/step-3-large-scale-validation/acceptance-matrix.json',
  calibrationAddendum: 'quality-reviews/step-3-large-scale-validation/acceptance-addendum-calibration-001.json',
};
const [candidateText, planText, executionText, calibrationText, calibrationAuditText, calibrationGateText, readbackText, acceptanceText, addendumText, resultBuffer] = await Promise.all([
  readFile(resolve(paths.candidate), 'utf8'),
  readFile(resolve(paths.plan), 'utf8'),
  readFile(resolve(paths.execution), 'utf8'),
  readFile(resolve(paths.calibrationResult), 'utf8'),
  readFile(resolve(paths.calibrationAudit), 'utf8'),
  readFile(resolve(paths.calibrationGate), 'utf8'),
  readFile(resolve(paths.calibrationReadback), 'utf8'),
  readFile(resolve(paths.acceptance), 'utf8'),
  readFile(resolve(paths.calibrationAddendum), 'utf8'),
  readFile(resolve(resultPath)),
]);
const candidate = JSON.parse(candidateText);
const plan = JSON.parse(planText);
const execution = JSON.parse(executionText);
const calibration = JSON.parse(calibrationText);
const calibrationAudit = JSON.parse(calibrationAuditText);
const calibrationGate = JSON.parse(calibrationGateText);
const readback = JSON.parse(readbackText);
const acceptance = JSON.parse(acceptanceText);
const addendum = JSON.parse(addendumText);
const result = JSON.parse(resultBuffer.toString('utf8'));

assert.equal(candidate.meta.repository, EXPECTED_REPOSITORY);
assert.equal(candidate.meta.branch, EXPECTED_BRANCH);
assert.equal(acceptance.status, 'ACTIVE_BEFORE_STEP3_EXECUTION');
assert.equal(addendum.verdict, 'PASS_CALIBRATION_MEASUREMENT_REPAIR_AUTHORIZED');
assert.equal(calibrationGate.verdict, 'PASS_CALIBRATION_GATE_HOLDOUT_AUTHORIZED');
assert.equal(calibrationGate.holdout.authorized, true);
assert.equal(calibrationGate.holdout.executed, false);
assert.equal(readback.verdict, 'PASS_FINAL_CALIBRATION_READBACK_HOLDOUT_AUTHORIZED');
assert.equal(readback.holdout.authorized, true);
assert.equal(readback.holdout.executed, false);
assert.equal(calibrationAudit.verdict, 'PASS_CALIBRATION_GATE_CANDIDATE');
assert.equal(calibrationAudit.unresolvedP0, 0);
assert.equal(calibrationAudit.unresolvedP1, 0);
assert.ok(calibrationAudit.criteria.every((entry) => entry.status === 'PASS'));
assert.equal(result.deterministicPayload.mode, 'STEP3_GAMEPLAY_PARTITION');
assert.equal(result.deterministicPayload.partition, 'holdout');
assert.equal(result.deterministicPayload.tuningVisible, false);
assert.equal(result.deterministicPayload.complete, true);
assert.equal(result.deterministicPayload.scenarioCount, String(EXPECTED_SCENARIOS));
assert.equal(result.deterministicPayload.expectedScenarioCount, String(EXPECTED_SCENARIOS));
assert.equal(result.verdict.contractValidation, 'PASS');
assert.equal(result.verdict.partitionComplete, true);
assert.equal(result.verdict.partialResultPromotion, false);
assert.deepEqual(result.deterministicPayload.violations, []);
assert.equal(result.hashes.candidateSha256, sha256Text(candidateText));
assert.equal(result.hashes.runPlanSha256, sha256Text(planText));
assert.equal(result.hashes.executionContractSha256, sha256Text(executionText));
assert.equal(result.hashes.deterministicPayloadSha256, sha256Canonical(result.deterministicPayload));
assert.equal(result.evidence.canonicalJsonSha256, result.hashes.deterministicPayloadSha256);
assert.equal(result.deterministicPayload.cells.length, 15);

const calibrationInputDigests = new Set();
const calibrationScenarioDigests = new Set();
for (const cell of calibration.deterministicPayload.cells) {
  for (const digest of cell.scenarioInputDigests) calibrationInputDigests.add(digest);
  for (const digest of cell.scenarioDigests) calibrationScenarioDigests.add(digest);
}
assert.equal(calibrationInputDigests.size, 12000);
assert.equal(calibrationScenarioDigests.size, 12000);

const partition = execution.partitions.holdout;
const seedsPerCell = Number(partition.seedsPerBuildPersona);
assert.equal(seedsPerCell, 200);
const compactCells = new Map(result.deterministicPayload.cells.map((entry) => [entry.cellId, entry]));
assert.equal(compactCells.size, 15);

const inputDigests = new Set();
const scenarioDigests = new Set();
let duplicateInputDigests = 0;
let duplicateScenarioDigests = 0;
let calibrationInputOverlap = 0;
let calibrationScenarioOverlap = 0;
let replayMismatchCount = 0;
let firstEvolutionUncovered = 0;
let repeatedResetSequenceViolations = 0;
let economy45dMismatchCount = 0;
let masteryReplayMismatchCount = 0;
const globalFirstReset = [];
const globalGuarantee = [];
const resetRunMinutesByIndex = Array.from({ length: Number(execution.model.repeatedReset.runCount) }, () => []);
const cellAudits = [];

for (const buildId of plan.builds) {
  for (const personaId of plan.personas) {
    const cellId = `holdout|${buildId}|${personaId}`;
    const compact = compactCells.get(cellId);
    assert(compact, `MISSING_COMPACT_CELL:${cellId}`);
    assert.equal(compact.seedCount, String(seedsPerCell));
    assert.equal(compact.scenarioInputDigests.length, seedsPerCell);
    assert.equal(compact.scenarioDigests.length, seedsPerCell);
    const firstResetValues = [];
    const guaranteeValues = [];
    const horizonValues = new Map(plan.horizons.map((horizon) => [horizon.id, []]));
    let cellEvolutionUncovered = 0;
    let cellResetSequenceViolations = 0;
    for (let ordinal = 0; ordinal < seedsPerCell; ordinal += 1) {
      const seed = deterministicSeed(partition.namespace, buildId, personaId, ordinal);
      const scenario = runScenario(candidate, plan, execution, { buildId, personaId, namespace: partition.namespace, partition: 'holdout', seed, ordinal });
      if (compact.scenarioInputDigests[ordinal] !== scenario.inputDigest || compact.scenarioDigests[ordinal] !== scenario.scenarioDigest) replayMismatchCount += 1;
      if (inputDigests.has(scenario.inputDigest)) duplicateInputDigests += 1;
      if (scenarioDigests.has(scenario.scenarioDigest)) duplicateScenarioDigests += 1;
      if (calibrationInputDigests.has(scenario.inputDigest)) calibrationInputOverlap += 1;
      if (calibrationScenarioDigests.has(scenario.scenarioDigest)) calibrationScenarioOverlap += 1;
      inputDigests.add(scenario.inputDigest);
      scenarioDigests.add(scenario.scenarioDigest);
      firstResetValues.push(scenario.firstResetMinutes);
      guaranteeValues.push(scenario.featuredGuaranteeDay);
      globalFirstReset.push(scenario.firstResetMinutes);
      globalGuarantee.push(scenario.featuredGuaranteeDay);
      if (!scenario.firstEvolutionCovered || asBigInt(scenario.firstResetRuby, 'firstResetRuby') < asBigInt(scenario.firstEvolutionCost, 'firstEvolutionCost')) {
        firstEvolutionUncovered += 1;
        cellEvolutionUncovered += 1;
      }
      const repeated = scenario.horizons.find((entry) => entry.horizonId === 'repeated-resets');
      assert(repeated && Array.isArray(repeated.resetMinutes));
      if (repeated.resetMinutes.length !== resetRunMinutesByIndex.length) {
        repeatedResetSequenceViolations += 1;
        cellResetSequenceViolations += 1;
      } else {
        for (let index = 0; index < repeated.resetMinutes.length; index += 1) {
          const value = asBigInt(repeated.resetMinutes[index], `resetMinutes[${index}]`);
          resetRunMinutesByIndex[index].push(value.toString());
          if (value < asBigInt(execution.model.repeatedReset.minimumMinutes, 'repeatedReset.minimumMinutes')) {
            repeatedResetSequenceViolations += 1;
            cellResetSequenceViolations += 1;
          }
          if (index > 0 && value > asBigInt(repeated.resetMinutes[index - 1], `resetMinutes[${index - 1}]`)) {
            repeatedResetSequenceViolations += 1;
            cellResetSequenceViolations += 1;
          }
        }
      }
      const economy = scenario.horizons.find((entry) => entry.horizonId === '30-45-day-economy');
      const persona = candidate.personas.find((entry) => entry.id === personaId);
      assert(economy && persona);
      const expectedCharacter45d = (asBigInt(persona.dailyCharacterDraws, 'dailyCharacterDraws') * 45n).toString();
      const expectedWeapon45d = (asBigInt(persona.dailyWeaponDraws, 'dailyWeaponDraws') * 45n).toString();
      if (economy.characterDraws45d !== expectedCharacter45d || economy.weaponDraws45d !== expectedWeapon45d || economy.featuredGuaranteeDay !== scenario.featuredGuaranteeDay) economy45dMismatchCount += 1;
      if (scenario.masteryAt20.masteredCopies !== '20' || scenario.masteryAt20.overflowCopies !== '0' || scenario.masteryAt20.overflowCredit !== '0' || scenario.masteryOverflowAt25.masteredCopies !== '20' || scenario.masteryOverflowAt25.overflowCopies !== '5' || scenario.masteryOverflowAt25.overflowCredit !== '500') masteryReplayMismatchCount += 1;
      for (const horizon of scenario.horizons) horizonValues.get(horizon.horizonId).push(horizon.estimatedReachMinutes);
    }
    assert.deepEqual(summarizeUnsigned(firstResetValues), compact.metrics.firstResetMinutes);
    assert.deepEqual(summarizeUnsigned(guaranteeValues), compact.metrics.featuredGuaranteeDay);
    for (const horizonMetric of compact.metrics.horizons) assert.deepEqual(summarizeUnsigned(horizonValues.get(horizonMetric.horizonId)), horizonMetric.estimatedReachMinutes);
    cellAudits.push({
      cellId,
      buildId,
      personaId,
      seedCount: String(seedsPerCell),
      firstResetMinutes: summarizeUnsigned(firstResetValues),
      featuredGuaranteeDay: summarizeUnsigned(guaranteeValues),
      firstEvolutionUncovered: String(cellEvolutionUncovered),
      repeatedResetSequenceViolations: String(cellResetSequenceViolations),
      horizonP50: Object.fromEntries(compact.metrics.horizons.map((entry) => [entry.horizonId, entry.estimatedReachMinutes.p50])),
    });
  }
}

assert.equal(globalFirstReset.length, EXPECTED_SCENARIOS);
assert.equal(globalGuarantee.length, EXPECTED_SCENARIOS);
assert.deepEqual(summarizeUnsigned(globalFirstReset), result.deterministicPayload.summary.firstResetMinutes);
assert.deepEqual(summarizeUnsigned(globalGuarantee), result.deterministicPayload.summary.featuredGuaranteeDay);

const buildSpread = [];
let buildSpreadViolations = 0;
for (const personaId of plan.personas) {
  for (const horizon of plan.horizons) {
    const values = Object.fromEntries(cellAudits.filter((entry) => entry.personaId === personaId).map((entry) => [entry.buildId, entry.horizonP50[horizon.id]]));
    const numeric = Object.entries(values).map(([buildId, value]) => ({ buildId, value: asBigInt(value, `${personaId}.${horizon.id}.${buildId}`) }));
    const fastest = numeric.reduce((left, right) => right.value < left.value ? right : left);
    const slowest = numeric.reduce((left, right) => right.value > left.value ? right : left);
    const ratioBasisPointsCeil = ((slowest.value * 10000n) + fastest.value - 1n) / fastest.value;
    const absoluteSpreadMinutes = slowest.value - fastest.value;
    const pass = fastest.value >= 5n ? ratioBasisPointsCeil <= 12000n : absoluteSpreadMinutes <= 1n;
    if (!pass) buildSpreadViolations += 1;
    buildSpread.push({ personaId, horizonId: horizon.id, p50ByBuild: values, fastestBuild: fastest.buildId, fastestMinutes: fastest.value.toString(), slowestBuild: slowest.buildId, slowestMinutes: slowest.value.toString(), ratioBasisPointsCeil: ratioBasisPointsCeil.toString(), absoluteSpreadMinutes: absoluteSpreadMinutes.toString(), appliedRule: fastest.value >= 5n ? 'RATIO_AT_MOST_1_20' : 'ABSOLUTE_SPREAD_AT_MOST_ONE_MINUTE', pass });
  }
}

const noAd = candidate.personas.find((entry) => entry.id === 'no-ad-f2p');
assert(noAd);
const noAdCell = cellAudits.find((entry) => entry.personaId === 'no-ad-f2p');
assert(noAdCell);
const noAdGuaranteeDay = asBigInt(noAdCell.featuredGuaranteeDay.p50, 'noAdGuaranteeDay');
const noAdCombinedDailyDraws = asBigInt(noAd.dailyCharacterDraws, 'dailyCharacterDraws') + asBigInt(noAd.dailyWeaponDraws, 'dailyWeaponDraws');
const personaThresholds = { 'no-ad-f2p': '1.00', 'rewarded-ad-f2p': '1.25', 'monthly-pass': '2.00', 'controlled-payer': '3.00', 'high-spend-stress': '5.00' };
const personaAccelerationPass = candidate.personas.every((persona) => decimalAtMost(persona.progressMultiplier, persona.accelerationMaximum, `${persona.id}.progressMultiplier`) && decimalAtMost(persona.accelerationMaximum, personaThresholds[persona.id], `${persona.id}.accelerationMaximum`));
const characterRoles = staticRoleAudit(candidate.characters.catalog, candidate.characters.requiredCoreRoles);
const weaponRoles = staticRoleAudit(candidate.weapons.catalog, candidate.weapons.requiredCoreRoles);

const criteria = [];
const findings = [];
function addCriterion(id, severity, pass, detail) {
  criteria.push({ id, severity, status: pass ? 'PASS' : 'FAIL', detail });
  if (!pass) findings.push({ id, severity, detail });
}

addCriterion('HOLD-DATA-01', 'P0', result.deterministicPayload.scenarioCount === '3000' && result.deterministicPayload.cells.length === 15 && result.deterministicPayload.complete === true && result.deterministicPayload.tuningVisible === false, { scenarioCount: result.deterministicPayload.scenarioCount, cellCount: String(result.deterministicPayload.cells.length), complete: result.deterministicPayload.complete, tuningVisible: result.deterministicPayload.tuningVisible });
addCriterion('HOLD-DISJOINT-01', 'P0', calibrationInputOverlap === 0 && calibrationScenarioOverlap === 0 && duplicateInputDigests === 0 && duplicateScenarioDigests === 0 && inputDigests.size === EXPECTED_SCENARIOS && scenarioDigests.size === EXPECTED_SCENARIOS, { calibrationInputOverlap: String(calibrationInputOverlap), calibrationScenarioOverlap: String(calibrationScenarioOverlap), duplicateInputDigests: String(duplicateInputDigests), duplicateScenarioDigests: String(duplicateScenarioDigests), uniqueInputDigests: String(inputDigests.size), uniqueScenarioDigests: String(scenarioDigests.size) });
addCriterion('HOLD-DETERMINISM-01', 'P0', replayMismatchCount === 0, { replayMismatchCount: String(replayMismatchCount) });
const firstResetSummary = summarizeUnsigned(globalFirstReset);
addCriterion('HOLD-RESET-01', 'P0', asBigInt(firstResetSummary.minimum, 'firstReset.minimum') >= 20n && asBigInt(firstResetSummary.maximum, 'firstReset.maximum') <= 35n && cellAudits.every((entry) => asBigInt(entry.firstResetMinutes.p50, `${entry.cellId}.p50`) >= 20n && asBigInt(entry.firstResetMinutes.p50, `${entry.cellId}.p50`) <= 35n), firstResetSummary);
addCriterion('HOLD-RESET-02', 'P0', repeatedResetSequenceViolations === 0, { repeatedResetSequenceViolations: String(repeatedResetSequenceViolations), runMinutesByIndex: resetRunMinutesByIndex.map((values, index) => ({ run: String(index + 1), ...summarizeUnsigned(values) })) });
addCriterion('HOLD-EVOLUTION-01', 'P0', firstEvolutionUncovered === 0 && candidate.evolution.orderedCatchUp === true && candidate.evolution.nonBlockingContinuation === true && candidate.evolution.firstEvolutionCoverage.adOrPaymentRequired === false, { uncoveredScenarios: String(firstEvolutionUncovered), orderedCatchUp: candidate.evolution.orderedCatchUp, nonBlockingContinuation: candidate.evolution.nonBlockingContinuation, adOrPaymentRequired: candidate.evolution.firstEvolutionCoverage.adOrPaymentRequired });
addCriterion('HOLD-F2P-01', 'P0', noAdGuaranteeDay >= 30n && noAdGuaranteeDay <= 45n && noAdCombinedDailyDraws >= 40n && noAdCombinedDailyDraws <= 60n && candidate.ads.noAdF2P.progressionContinues === true && candidate.ads.noAdF2P.evolutionCoverage === true, { guaranteeDay: noAdGuaranteeDay.toString(), combinedDailyDraws: noAdCombinedDailyDraws.toString(), progressionContinues: candidate.ads.noAdF2P.progressionContinues, evolutionCoverage: candidate.ads.noAdF2P.evolutionCoverage });
addCriterion('HOLD-MONETIZATION-01', 'P0', personaAccelerationPass, { personas: candidate.personas.map((persona) => ({ id: persona.id, progressMultiplier: persona.progressMultiplier, declaredMaximum: persona.accelerationMaximum, acceptanceMaximum: personaThresholds[persona.id] })) });
addCriterion('HOLD-BUILD-01-R1', 'P1', buildSpreadViolations === 0, { violations: String(buildSpreadViolations), comparisons: buildSpread });
addCriterion('HOLD-RARITY-01', 'P0', characterRoles.deterministicCoversAllRequired && weaponRoles.deterministicCoversAllRequired && characterRoles.allFirstCopiesFunctional && weaponRoles.allFirstCopiesFunctional && characterRoles.allCoreProgressionGateFalse && weaponRoles.allCoreProgressionGateFalse && !characterRoles.urCoversEveryRequiredRole && !weaponRoles.urCoversEveryRequiredRole && candidate.rarities.strengthBoundary.URUnconditionalBestAllRoles === false, { characters: characterRoles, weapons: weaponRoles, strengthBoundary: candidate.rarities.strengthBoundary });
addCriterion('HOLD-MASTERY-01', 'P0', masteryReplayMismatchCount === 0, { masteryReplayMismatchCount: String(masteryReplayMismatchCount) });
addCriterion('HOLD-ECONOMY-45D-01', 'P0', economy45dMismatchCount === 0, { mismatchCount: String(economy45dMismatchCount) });
addCriterion('HOLD-CALIBRATION-GATE-01', 'P0', calibrationAudit.criteria.every((entry) => entry.status === 'PASS') && calibrationGate.quality.unresolvedP0 === 0 && calibrationGate.quality.unresolvedP1 === 0 && readback.holdout.reuseForTuningForbidden === true, { calibrationAuditVerdict: calibrationAudit.verdict, calibrationGateVerdict: calibrationGate.verdict, tuningReuseForbidden: readback.holdout.reuseForTuningForbidden });

const unresolvedP0 = criteria.filter((entry) => entry.severity === 'P0' && entry.status === 'FAIL').length;
const unresolvedP1 = criteria.filter((entry) => entry.severity === 'P1' && entry.status === 'FAIL').length;
const audit = {
  schemaVersion: 1,
  artifactId: 'cats-tower-step3-holdout-audit-v1',
  repository: EXPECTED_REPOSITORY,
  branch: EXPECTED_BRANCH,
  auditHead: git('rev-parse', 'HEAD'),
  auditTree: git('rev-parse', 'HEAD^{tree}'),
  sourceBlobs: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, blob: git('rev-parse', `HEAD:${path}`) }])),
  result: {
    sourcePath: resultPath,
    fileBytes: String(resultBuffer.length),
    fileSha256: sha256Buffer(resultBuffer),
    deterministicPayloadSha256: result.hashes.deterministicPayloadSha256,
    canonicalJsonSha256: result.evidence.canonicalJsonSha256,
    scenarioCount: result.deterministicPayload.scenarioCount,
    cellCount: String(result.deterministicPayload.cells.length),
    executedAt: result.evidence.executedAt,
  },
  separation: {
    calibrationScenarios: '12000',
    holdoutScenarios: '3000',
    calibrationInputOverlap: String(calibrationInputOverlap),
    calibrationScenarioOverlap: String(calibrationScenarioOverlap),
    duplicateHoldoutInputDigests: String(duplicateInputDigests),
    duplicateHoldoutScenarioDigests: String(duplicateScenarioDigests),
    tuningVisible: result.deterministicPayload.tuningVisible,
    tuningReuseForbidden: true,
  },
  replay: {
    scenarioCount: String(globalFirstReset.length),
    replayMismatchCount: String(replayMismatchCount),
    uniqueInputDigests: String(inputDigests.size),
    uniqueScenarioDigests: String(scenarioDigests.size),
  },
  compactSummary: result.deterministicPayload.summary,
  cells: cellAudits,
  criteria,
  findings,
  unresolvedP0,
  unresolvedP1,
  verdict: unresolvedP0 === 0 && unresolvedP1 === 0 ? 'PASS_UNSEEN_HOLDOUT_GATE_CANDIDATE' : 'FAIL_UNSEEN_HOLDOUT_NO_TUNING_ALLOWED',
};
await writeFile(resolve(outputPath), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ verdict: audit.verdict, scenarioCount: audit.replay.scenarioCount, unresolvedP0, unresolvedP1, output: outputPath }));
if (unresolvedP0 !== 0 || unresolvedP1 !== 0) process.exit(1);
