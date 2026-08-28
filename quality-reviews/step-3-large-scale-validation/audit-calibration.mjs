#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { deterministicSeed } from '../../simulation/engine-v2/rng.mjs';
import { runScenario } from '../../simulation/engine-v2/run-scenario.mjs';
import { summarizeUnsigned } from '../../simulation/engine-v2/statistics.mjs';
import { masteryOverflow } from '../../simulation/engine-v2/economy.mjs';
import { canonicalJson, sha256Canonical, sha256Text } from '../../simulation/engine-v2/hash.mjs';

const ROOT = process.cwd();
const EXPECTED_REPOSITORY = '2hg7trp7rv-design/cats_tower';
const EXPECTED_BRANCH = 'kimi';
const EXPECTED_CALIBRATION_DIGEST = 'df7cbceb0569f40eefee43dbd81d0b2c4698a44104f88a312ce693471f746e22';
const EXPECTED_SCENARIOS = 12000;

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
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

function decimalPositive(value, label) {
  return exactDecimalParts(value, label).n > 0n;
}

function roleAudit(catalog, requiredRoles) {
  const required = new Set(requiredRoles);
  const deterministic = catalog.filter((entry) => ['N', 'R'].includes(entry.baseRarity) && entry.acquisition === 'DETERMINISTIC_NON_GACHA');
  const deterministicRoles = new Set(deterministic.map((entry) => entry.role));
  const urRoles = new Set(catalog.filter((entry) => entry.baseRarity === 'UR').map((entry) => entry.role));
  return {
    catalogCount: String(catalog.length),
    deterministicNRCount: String(deterministic.length),
    deterministicRoles: [...deterministicRoles].sort(),
    requiredRoles: [...required].sort(),
    deterministicCoversAllRequired: [...required].every((role) => deterministicRoles.has(role)),
    allFirstCopiesFunctional: catalog.every((entry) => entry.firstCopyFunctional === true),
    allCoreProgressionGateFalse: catalog.every((entry) => entry.coreProgressionGate === false),
    urRoles: [...urRoles].sort(),
    urCoversEveryRequiredRole: [...required].every((role) => urRoles.has(role)),
  };
}

function masteryAudit(track, label) {
  const nodes = track.marginalCurve.nodes.map((entry) => ({
    copies: asBigInt(entry.additionalEffectiveCopies, `${label}.copies`),
    power: asBigInt(entry.cumulativePowerBasisPoints, `${label}.power`),
    functionalUnlock: entry.functionalUnlock,
  }));
  let previousCopies = 0n;
  let previousPower = 0n;
  let previousDeltaCopies = null;
  let previousDeltaPower = null;
  let strictlyDiminishingMeasured = true;
  for (const node of nodes) {
    const deltaCopies = node.copies - previousCopies;
    const deltaPower = node.power - previousPower;
    if (deltaCopies <= 0n || deltaPower <= 0n || node.functionalUnlock !== false) strictlyDiminishingMeasured = false;
    if (previousDeltaCopies !== null && previousDeltaPower !== null) {
      if (!(deltaPower * previousDeltaCopies < previousDeltaPower * deltaCopies)) strictlyDiminishingMeasured = false;
    }
    previousCopies = node.copies;
    previousPower = node.power;
    previousDeltaCopies = deltaCopies;
    previousDeltaPower = deltaPower;
  }
  const cap = asBigInt(track.fullMastery.minimumAdditionalEffectiveCopies, `${label}.cap`);
  const overflow = masteryOverflow(track, (cap + 5n).toString());
  return {
    firstCopyFunctional: track.firstCopy.functional === true,
    firstCopyRoleComplete: track.firstCopy.roleComplete === true,
    practicalLatestAdditionalCopies: track.practicalBreakpoints.latestAdditionalCopies,
    practicalBySeven: asBigInt(track.practicalBreakpoints.latestAdditionalCopies, `${label}.practical`) <= 7n,
    fullMasteryCopies: cap.toString(),
    fullMasteryAtLeastTwenty: cap >= 20n,
    normalPvePrerequisite: track.fullMastery.normalPvePrerequisite,
    strictlyDiminishingDeclared: track.marginalCurve.strictlyDiminishingMarginalGain === true,
    strictlyDiminishingMeasured,
    overflowNeverDiscard: track.overflow.neverDiscard === true,
    overflowConversionPerDuplicate: track.overflow.conversionPerDuplicate,
    overflowAtCapPlusFive: overflow,
    overflowPass: overflow.overflowCopies === '5' && asBigInt(overflow.overflowCredit, `${label}.overflowCredit`) > 0n,
  };
}

const resultPath = arg('--result');
const outputPath = arg('--output');
if (!resultPath || !outputPath) throw new Error('--result and --output are required');

const paths = {
  candidate: 'simulation/candidate-v2.json',
  plan: 'simulation/run-plan-v2.json',
  execution: 'simulation/execution-contract-v2.json',
  acceptance: 'quality-reviews/step-3-large-scale-validation/acceptance-matrix.json',
  addendum: 'quality-reviews/step-3-large-scale-validation/acceptance-addendum-calibration-001.json',
  governanceReadback: 'quality-reviews/step-2-governance-repair-round-001/live-readback.json',
};
const [candidateText, planText, executionText, acceptanceText, addendumText, governanceText, resultBuffer] = await Promise.all([
  readFile(resolve(paths.candidate), 'utf8'),
  readFile(resolve(paths.plan), 'utf8'),
  readFile(resolve(paths.execution), 'utf8'),
  readFile(resolve(paths.acceptance), 'utf8'),
  readFile(resolve(paths.addendum), 'utf8'),
  readFile(resolve(paths.governanceReadback), 'utf8'),
  readFile(resolve(resultPath)),
]);
const candidate = JSON.parse(candidateText);
const plan = JSON.parse(planText);
const execution = JSON.parse(executionText);
const acceptance = JSON.parse(acceptanceText);
const addendum = JSON.parse(addendumText);
const governance = JSON.parse(governanceText);
const result = JSON.parse(resultBuffer.toString('utf8'));

assert.equal(candidate.meta.repository, EXPECTED_REPOSITORY);
assert.equal(candidate.meta.branch, EXPECTED_BRANCH);
assert.equal(acceptance.status, 'ACTIVE_BEFORE_STEP3_EXECUTION');
assert.equal(addendum.verdict, 'PASS_CALIBRATION_MEASUREMENT_REPAIR_AUTHORIZED');
assert.equal(governance.governanceDecision.step3, 'READY_TO_START');
assert.equal(governance.governanceDecision.step3Executed, false);
assert.equal(result.deterministicPayload.mode, 'STEP3_GAMEPLAY_PARTITION');
assert.equal(result.deterministicPayload.partition, 'calibration');
assert.equal(result.deterministicPayload.tuningVisible, true);
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
assert.equal(result.evidence.canonicalJsonSha256, sha256Text(canonicalJson(result.deterministicPayload)));
assert.equal(result.hashes.deterministicPayloadSha256, EXPECTED_CALIBRATION_DIGEST);
assert.equal(result.evidence.canonicalJsonSha256, EXPECTED_CALIBRATION_DIGEST);
assert.equal(result.deterministicPayload.cells.length, plan.builds.length * plan.personas.length);
assert.equal(existsSync(resolve('quality-reviews/step-3-large-scale-validation/gameplay-holdout-result.json')), false);

const partition = execution.partitions.calibration;
const seedsPerCell = Number(partition.seedsPerBuildPersona);
assert.equal(seedsPerCell, 800);
const compactCells = new Map(result.deterministicPayload.cells.map((entry) => [entry.cellId, entry]));
assert.equal(compactCells.size, 15);

const findings = [];
const criteria = [];
const allInputDigests = new Set();
const allScenarioDigests = new Set();
let duplicateInputDigests = 0;
let duplicateScenarioDigests = 0;
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
    const cellId = `calibration|${buildId}|${personaId}`;
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
      const scenario = runScenario(candidate, plan, execution, { buildId, personaId, namespace: partition.namespace, partition: 'calibration', seed, ordinal });
      if (compact.scenarioInputDigests[ordinal] !== scenario.inputDigest || compact.scenarioDigests[ordinal] !== scenario.scenarioDigest) replayMismatchCount += 1;
      if (allInputDigests.has(scenario.inputDigest)) duplicateInputDigests += 1;
      if (allScenarioDigests.has(scenario.scenarioDigest)) duplicateScenarioDigests += 1;
      allInputDigests.add(scenario.inputDigest);
      allScenarioDigests.add(scenario.scenarioDigest);
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
    const scaleAwarePass = fastest.value >= 5n ? ratioBasisPointsCeil <= 12000n : absoluteSpreadMinutes <= 1n;
    if (!scaleAwarePass) buildSpreadViolations += 1;
    buildSpread.push({
      personaId,
      horizonId: horizon.id,
      p50ByBuild: values,
      fastestBuild: fastest.buildId,
      fastestMinutes: fastest.value.toString(),
      slowestBuild: slowest.buildId,
      slowestMinutes: slowest.value.toString(),
      ratioBasisPointsCeil: ratioBasisPointsCeil.toString(),
      absoluteSpreadMinutes: absoluteSpreadMinutes.toString(),
      appliedRule: fastest.value >= 5n ? 'RATIO_AT_MOST_1_20' : 'ABSOLUTE_SPREAD_AT_MOST_ONE_MINUTE',
      pass: scaleAwarePass,
    });
  }
}

const characterRoles = roleAudit(candidate.characters.catalog, candidate.characters.requiredCoreRoles);
const weaponRoles = roleAudit(candidate.weapons.catalog, candidate.weapons.requiredCoreRoles);
const characterMastery = masteryAudit(candidate.characterMastery, 'characterMastery');
const weaponMastery = masteryAudit(candidate.weaponMastery, 'weaponMastery');
const noAd = candidate.personas.find((entry) => entry.id === 'no-ad-f2p');
assert(noAd);
const noAdCombinedDailyDraws = asBigInt(noAd.dailyCharacterDraws, 'noAd.dailyCharacterDraws') + asBigInt(noAd.dailyWeaponDraws, 'noAd.dailyWeaponDraws');
const noAdGuaranteeDay = asBigInt(cellAudits.find((entry) => entry.personaId === 'no-ad-f2p').featuredGuaranteeDay.p50, 'noAdGuaranteeDay');
const personaThresholds = {
  'no-ad-f2p': '1.00',
  'rewarded-ad-f2p': '1.25',
  'monthly-pass': '2.00',
  'controlled-payer': '3.00',
  'high-spend-stress': '5.00',
};
const personaAcceleration = candidate.personas.map((persona) => ({
  personaId: persona.id,
  progressMultiplier: persona.progressMultiplier,
  declaredMaximum: persona.accelerationMaximum,
  acceptanceMaximum: personaThresholds[persona.id],
  progressWithinDeclaredMaximum: decimalAtMost(persona.progressMultiplier, persona.accelerationMaximum, `${persona.id}.progressMultiplier`),
  declaredWithinAcceptanceMaximum: decimalAtMost(persona.accelerationMaximum, personaThresholds[persona.id], `${persona.id}.accelerationMaximum`),
}));
const buildDimensions = candidate.builds.map((build) => ({
  buildId: build.id,
  powerMultiplier: build.powerMultiplier,
  economyMultiplier: build.economyMultiplier,
  reclearMultiplier: build.reclearMultiplier,
}));
const bestIds = (field) => {
  let best = null;
  for (const build of candidate.builds) {
    const value = exactDecimalParts(build[field], `${build.id}.${field}`);
    if (best === null || compareDecimal(value, best.value) > 0) best = { value, ids: [build.id] };
    else if (compareDecimal(value, best.value) === 0) best.ids.push(build.id);
  }
  return new Set(best.ids);
};
const powerBest = bestIds('powerMultiplier');
const economyBest = bestIds('economyMultiplier');
const reclearBest = bestIds('reclearMultiplier');
const universalBest = new Set([...powerBest].filter((id) => economyBest.has(id) && reclearBest.has(id)));

function addCriterion(id, severity, pass, detail) {
  criteria.push({ id, severity, status: pass ? 'PASS' : 'FAIL', detail });
  if (!pass) findings.push({ id, severity, detail });
}

addCriterion('CAL-DATA-01', 'P0', result.deterministicPayload.scenarioCount === '12000' && result.deterministicPayload.cells.length === 15 && result.deterministicPayload.complete === true, { scenarioCount: result.deterministicPayload.scenarioCount, cellCount: String(result.deterministicPayload.cells.length), complete: result.deterministicPayload.complete });
addCriterion('CAL-DETERMINISM-01', 'P0', replayMismatchCount === 0 && duplicateInputDigests === 0 && duplicateScenarioDigests === 0 && allInputDigests.size === EXPECTED_SCENARIOS && allScenarioDigests.size === EXPECTED_SCENARIOS, { replayMismatchCount: String(replayMismatchCount), duplicateInputDigests: String(duplicateInputDigests), duplicateScenarioDigests: String(duplicateScenarioDigests), uniqueInputDigests: String(allInputDigests.size), uniqueScenarioDigests: String(allScenarioDigests.size) });
const firstResetSummary = summarizeUnsigned(globalFirstReset);
addCriterion('CAL-RESET-01', 'P0', asBigInt(firstResetSummary.minimum, 'firstReset.minimum') >= 20n && asBigInt(firstResetSummary.maximum, 'firstReset.maximum') <= 35n && cellAudits.every((entry) => asBigInt(entry.firstResetMinutes.p50, `${entry.cellId}.p50`) >= 20n && asBigInt(entry.firstResetMinutes.p50, `${entry.cellId}.p50`) <= 35n), firstResetSummary);
addCriterion('CAL-RESET-02', 'P0', repeatedResetSequenceViolations === 0, { repeatedResetSequenceViolations: String(repeatedResetSequenceViolations), runMinutesByIndex: resetRunMinutesByIndex.map((values, index) => ({ run: String(index + 1), ...summarizeUnsigned(values) })) });
addCriterion('CAL-EVOLUTION-01', 'P0', firstEvolutionUncovered === 0 && candidate.evolution.orderedCatchUp === true && candidate.evolution.nonBlockingContinuation === true && candidate.evolution.firstEvolutionCoverage.adOrPaymentRequired === false && asBigInt(candidate.evolution.firstEvolutionCoverage.firstEffectiveResetMinimumReward, 'firstEffectiveResetMinimumReward') >= asBigInt(candidate.evolution.firstEvolutionCoverage.firstStageCost, 'firstStageCost'), { uncoveredScenarios: String(firstEvolutionUncovered), firstEffectiveResetMinimumReward: candidate.evolution.firstEvolutionCoverage.firstEffectiveResetMinimumReward, firstStageCost: candidate.evolution.firstEvolutionCoverage.firstStageCost, orderedCatchUp: candidate.evolution.orderedCatchUp, nonBlockingContinuation: candidate.evolution.nonBlockingContinuation, adOrPaymentRequired: candidate.evolution.firstEvolutionCoverage.adOrPaymentRequired });
addCriterion('CAL-F2P-01', 'P0', noAdGuaranteeDay >= 30n && noAdGuaranteeDay <= 45n && noAdCombinedDailyDraws >= 40n && noAdCombinedDailyDraws <= 60n && candidate.ads.noAdF2P.progressionContinues === true && candidate.ads.noAdF2P.evolutionCoverage === true, { guaranteeDay: noAdGuaranteeDay.toString(), combinedDailyDraws: noAdCombinedDailyDraws.toString(), progressionContinues: candidate.ads.noAdF2P.progressionContinues, evolutionCoverage: candidate.ads.noAdF2P.evolutionCoverage });
addCriterion('CAL-MONETIZATION-01', 'P0', personaAcceleration.every((entry) => entry.progressWithinDeclaredMaximum && entry.declaredWithinAcceptanceMaximum), { personas: personaAcceleration });
addCriterion('CAL-BUILD-01-R1', 'P1', buildSpreadViolations === 0 && compactCells.size === 15 && universalBest.size === 0 && candidate.builds.every((build) => decimalPositive(build.powerMultiplier, `${build.id}.power`) && decimalPositive(build.economyMultiplier, `${build.id}.economy`) && decimalPositive(build.reclearMultiplier, `${build.id}.reclear`)), { violations: String(buildSpreadViolations), universalBestBuildIds: [...universalBest], bestByDimension: { power: [...powerBest], economy: [...economyBest], reclear: [...reclearBest] }, dimensions: buildDimensions, comparisons: buildSpread });
addCriterion('CAL-RARITY-01', 'P0', characterRoles.deterministicCoversAllRequired && weaponRoles.deterministicCoversAllRequired && characterRoles.allFirstCopiesFunctional && weaponRoles.allFirstCopiesFunctional && characterRoles.allCoreProgressionGateFalse && weaponRoles.allCoreProgressionGateFalse && !characterRoles.urCoversEveryRequiredRole && !weaponRoles.urCoversEveryRequiredRole && candidate.rarities.strengthBoundary.URUnconditionalBestAllRoles === false && candidate.rarities.lowRarityUtility.longTermMeasurable === true, { characters: characterRoles, weapons: weaponRoles, strengthBoundary: candidate.rarities.strengthBoundary, lowRarityUtility: candidate.rarities.lowRarityUtility });
addCriterion('CAL-MASTERY-01', 'P0', masteryReplayMismatchCount === 0 && [characterMastery, weaponMastery].every((entry) => entry.firstCopyFunctional && entry.firstCopyRoleComplete && entry.practicalBySeven && entry.fullMasteryAtLeastTwenty && entry.normalPvePrerequisite === false && entry.strictlyDiminishingDeclared && entry.strictlyDiminishingMeasured && entry.overflowNeverDiscard && entry.overflowPass), { replayMismatchCount: String(masteryReplayMismatchCount), character: characterMastery, weapon: weaponMastery });
addCriterion('CAL-ECONOMY-45D-01', 'P0', economy45dMismatchCount === 0, { mismatchCount: String(economy45dMismatchCount), persona45dDraws: candidate.personas.map((persona) => ({ personaId: persona.id, characterDraws45d: (asBigInt(persona.dailyCharacterDraws, `${persona.id}.character`) * 45n).toString(), weaponDraws45d: (asBigInt(persona.dailyWeaponDraws, `${persona.id}.weapon`) * 45n).toString() })) });
addCriterion('CAL-HOLDOUT-01', 'P0', existsSync(resolve('quality-reviews/step-3-large-scale-validation/gameplay-holdout-result.json')) === false, { holdoutExecuted: false });

const unresolvedP0 = criteria.filter((entry) => entry.severity === 'P0' && entry.status === 'FAIL').length;
const unresolvedP1 = criteria.filter((entry) => entry.severity === 'P1' && entry.status === 'FAIL').length;
const auditPayload = {
  schemaVersion: 1,
  artifactId: 'cats-tower-step3-calibration-audit-v1',
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
  replay: {
    scenarioCount: String(globalFirstReset.length),
    replayMismatchCount: String(replayMismatchCount),
    duplicateInputDigests: String(duplicateInputDigests),
    duplicateScenarioDigests: String(duplicateScenarioDigests),
    uniqueInputDigests: String(allInputDigests.size),
    uniqueScenarioDigests: String(allScenarioDigests.size),
  },
  compactSummary: result.deterministicPayload.summary,
  cells: cellAudits,
  criteria,
  findings,
  unresolvedP0,
  unresolvedP1,
  holdoutExecuted: false,
  verdict: unresolvedP0 === 0 && unresolvedP1 === 0 ? 'PASS_CALIBRATION_GATE_CANDIDATE' : 'FAIL_CALIBRATION_REPAIR_REQUIRED',
};
await writeFile(resolve(outputPath), `${JSON.stringify(auditPayload, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ verdict: auditPayload.verdict, scenarioCount: auditPayload.replay.scenarioCount, unresolvedP0, unresolvedP1, output: outputPath }));
if (unresolvedP0 !== 0 || unresolvedP1 !== 0) process.exit(1);
