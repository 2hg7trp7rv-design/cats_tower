#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';

const contractPath = resolve(process.argv[2] ?? 'simulation/execution-contract-v2.json');
const schemaPath = resolve('simulation/execution-contract-v2.schema.json');
const candidatePath = resolve('simulation/candidate-v2.json');
const planPath = resolve('simulation/run-plan-v2.json');
const [contract, schema, candidate, plan] = await Promise.all([
  readFile(contractPath, 'utf8').then(JSON.parse),
  readFile(schemaPath, 'utf8').then(JSON.parse),
  readFile(candidatePath, 'utf8').then(JSON.parse),
  readFile(planPath, 'utf8').then(JSON.parse),
]);

const errors = [];
const check = (condition, code, message) => { if (!condition) errors.push({ code, message }); };
const eq = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exactKeys = (value, expected, path) => {
  check(value && typeof value === 'object' && !Array.isArray(value), 'EXEC_OBJECT', `${path} must be an object`);
  if (value && typeof value === 'object' && !Array.isArray(value)) check(eq(Object.keys(value), expected), 'EXEC_FIELDS', `${path} fields or ordering differ`);
};
const unsigned = (value, path, { positive = false } = {}) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'EXEC_UNSIGNED', `${path} must be a canonical unsigned integer string`);
  if (!(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) return 0n;
  const parsed = BigInt(value);
  if (positive) check(parsed > 0n, 'EXEC_POSITIVE', `${path} must be positive`);
  return parsed;
};
const signed = (value, path) => {
  check(typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value) && value !== '-0', 'EXEC_SIGNED', `${path} must be a canonical signed integer string`);
  return typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value) && value !== '-0' ? BigInt(value) : 0n;
};

try { assertSchema(contract, schema); } catch (error) {
  for (const detail of error.errors ?? [{ path: '#', keyword: 'schema', message: error.message }]) errors.push({ code: 'SCHEMA', message: `${detail.path} ${detail.keyword}: ${detail.message}` });
}

exactKeys(contract, ['schemaVersion','contractId','candidateId','scenarioAlgorithmVersion','executionVersion','roundingVersion','sourcePaths','model','statistics','partitions','highVolumeSuites','resultContracts','executionGuard'], '#');
check(contract.candidateId === candidate.meta.candidateId, 'EXEC_CANDIDATE_ID', 'candidateId differs from candidate-v2');
check(contract.roundingVersion === candidate.meta.roundingVersion && contract.roundingVersion === plan.roundingVersion, 'EXEC_ROUNDING', 'rounding version mismatch');
check(contract.sourcePaths?.candidate === 'simulation/candidate-v2.json' && contract.sourcePaths?.runPlan === 'simulation/run-plan-v2.json' && contract.sourcePaths?.acceptance === 'quality-reviews/step-2-executable-contract-v2/acceptance-matrix.json', 'EXEC_SOURCE_PATHS', 'source paths mismatch');

const builds = ['build.combat','build.reinforcement','build.commerce'];
const personas = ['no-ad-f2p','rewarded-ad-f2p','monthly-pass','controlled-payer','high-spend-stress'];
const horizons = ['1-10F','100F','1000F','10000F-or-equivalent','repeated-resets','30-45-day-economy'];
check(eq(plan.builds, builds) && eq(candidate.builds.map((entry) => entry.id), builds), 'EXEC_BUILDS', 'build set mismatch');
check(eq(plan.personas, personas) && eq(candidate.personas.map((entry) => entry.id), personas), 'EXEC_PERSONAS', 'persona set mismatch');
check(eq(plan.horizons.map((entry) => entry.id), horizons), 'EXEC_HORIZONS', 'horizon set mismatch');

const firstReset = contract.model?.firstReset;
exactKeys(firstReset, ['personaBaseMinutes','buildAdjustmentMinutes','jitterMinimumMinutes','jitterMaximumMinutes','minimumMinutes'], '#/model/firstReset');
check(eq(Object.keys(firstReset?.personaBaseMinutes ?? {}), personas), 'EXEC_PERSONA_BASE_KEYS', 'first reset persona keys mismatch');
check(eq(Object.keys(firstReset?.buildAdjustmentMinutes ?? {}), builds), 'EXEC_BUILD_ADJUST_KEYS', 'first reset build keys mismatch');
for (const persona of personas) unsigned(firstReset?.personaBaseMinutes?.[persona], `#/model/firstReset/personaBaseMinutes/${persona}`, { positive: true });
for (const build of builds) signed(firstReset?.buildAdjustmentMinutes?.[build], `#/model/firstReset/buildAdjustmentMinutes/${build}`);
const resetJitterMin = signed(firstReset?.jitterMinimumMinutes, '#/model/firstReset/jitterMinimumMinutes');
const resetJitterMax = signed(firstReset?.jitterMaximumMinutes, '#/model/firstReset/jitterMaximumMinutes');
const resetMinimum = unsigned(firstReset?.minimumMinutes, '#/model/firstReset/minimumMinutes', { positive: true });
check(resetJitterMin <= resetJitterMax, 'EXEC_RESET_JITTER_ORDER', 'first reset jitter minimum exceeds maximum');
for (const persona of personas) for (const build of builds) {
  const lower = BigInt(firstReset.personaBaseMinutes[persona]) + BigInt(firstReset.buildAdjustmentMinutes[build]) + resetJitterMin;
  check(lower >= resetMinimum, 'EXEC_RESET_UNDERFLOW', `${persona}/${build} may fall below minimum`);
}

const progression = contract.model?.progression;
exactKeys(progression, ['baselineMinutesByHorizon','jitterMinimumBasisPoints','jitterMaximumBasisPoints','minimumMinutes'], '#/model/progression');
check(eq(Object.keys(progression?.baselineMinutesByHorizon ?? {}), horizons), 'EXEC_HORIZON_BASE_KEYS', 'progression horizon keys mismatch');
for (const horizon of horizons) unsigned(progression?.baselineMinutesByHorizon?.[horizon], `#/model/progression/baselineMinutesByHorizon/${horizon}`, { positive: true });
const progressionJitterMin = signed(progression?.jitterMinimumBasisPoints, '#/model/progression/jitterMinimumBasisPoints');
const progressionJitterMax = signed(progression?.jitterMaximumBasisPoints, '#/model/progression/jitterMaximumBasisPoints');
check(progressionJitterMin <= progressionJitterMax && progressionJitterMin > -10000n, 'EXEC_PROGRESSION_JITTER', 'progression jitter range is invalid or permits a non-positive multiplier');
unsigned(progression?.minimumMinutes, '#/model/progression/minimumMinutes', { positive: true });

exactKeys(contract.model?.repeatedReset, ['runCount','minimumMinutes','usesBuildReclearMultiplier'], '#/model/repeatedReset');
check(unsigned(contract.model?.repeatedReset?.runCount, '#/model/repeatedReset/runCount', { positive: true }) === 5n, 'EXEC_RESET_RUN_COUNT', 'repeated reset runCount must be five');
check(unsigned(contract.model?.repeatedReset?.minimumMinutes, '#/model/repeatedReset/minimumMinutes', { positive: true }) === 6n, 'EXEC_RESET_MINIMUM', 'repeated reset minimum must be six minutes');
check(contract.model?.repeatedReset?.usesBuildReclearMultiplier === true, 'EXEC_RECLEAR_BINDING', 'repeated reset must use the candidate build reclear multiplier');

exactKeys(contract.statistics, ['method','percentiles','sort','emptyInput'], '#/statistics');
check(contract.statistics?.method === 'nearest-rank-v1' && eq(contract.statistics?.percentiles, ['0.50','0.90','0.99']) && contract.statistics?.sort === 'unsigned-decimal-ascending' && contract.statistics?.emptyInput === 'FAIL_CLOSED', 'EXEC_STATISTICS', 'statistics contract mismatch');

const expectedPartitions = {
  qualification: ['cats-tower-v2-qualification','2','STEP2',true,false],
  calibration: ['cats-tower-v2-calibration','800','STEP3',true,false],
  holdout: ['cats-tower-v2-holdout-unseen','200','STEP3',false,true],
};
exactKeys(contract.partitions, ['qualification','calibration','holdout'], '#/partitions');
for (const [name, expected] of Object.entries(expectedPartitions)) {
  const partition = contract.partitions?.[name];
  exactKeys(partition, ['namespace','seedsPerBuildPersona','owner','tuningVisible','promotionEligible'], `#/partitions/${name}`);
  check(eq([partition?.namespace, partition?.seedsPerBuildPersona, partition?.owner, partition?.tuningVisible, partition?.promotionEligible], expected), 'EXEC_PARTITION', `${name} partition mismatch`);
}
check(contract.partitions.qualification.namespace === plan.seeds.qualificationNamespace && contract.partitions.qualification.seedsPerBuildPersona === plan.seeds.qualificationPerCell, 'EXEC_QUALIFICATION_BINDING', 'qualification partition differs from run plan');
check(contract.partitions.calibration.namespace === plan.seeds.calibrationNamespace && contract.partitions.calibration.seedsPerBuildPersona === plan.seeds.calibrationPerCell, 'EXEC_CALIBRATION_BINDING', 'calibration partition differs from run plan');
check(contract.partitions.holdout.namespace === plan.seeds.holdoutNamespace && contract.partitions.holdout.seedsPerBuildPersona === plan.seeds.holdoutPerCell, 'EXEC_HOLDOUT_BINDING', 'holdout partition differs from run plan');
check(new Set(Object.values(contract.partitions).map((entry) => entry.namespace)).size === 3, 'EXEC_NAMESPACE_OVERLAP', 'partition namespaces overlap');

const suiteIds = ['gacha-tails','pity-conformance','duplicate-skew-overflow','refund-replay-race','state-machine-model','large-number-properties'];
check(eq(contract.highVolumeSuites?.map((entry) => entry.id), suiteIds), 'EXEC_SUITE_ORDER', 'high-volume suite set or order mismatch');
for (const [index, id] of suiteIds.entries()) {
  const suite = contract.highVolumeSuites?.[index];
  const planned = unsigned(suite?.plannedSamples, `#/highVolumeSuites/${index}/plannedSamples`, { positive: true });
  const smoke = unsigned(suite?.contractSmokeSamples, `#/highVolumeSuites/${index}/contractSmokeSamples`, { positive: true });
  check(suite?.plannedSamples === plan.highVolumeSuites?.[index]?.plannedSamples, 'EXEC_SUITE_PLAN_BINDING', `${id} planned samples differ from run plan`);
  check(smoke < planned, 'EXEC_SUITE_SMOKE_BOUND', `${id} contract smoke must be smaller than the Step 3 sample count`);
  check(suite?.implementationVersion === `${id}-v1`, 'EXEC_SUITE_VERSION', `${id} implementation version mismatch`);
}

exactKeys(contract.resultContracts, ['qualificationSchema','qualificationValidator','gameplaySchema','gameplayValidator','highVolumeSchema','highVolumeValidator'], '#/resultContracts');
for (const path of Object.values(contract.resultContracts ?? {})) {
  try { await access(resolve(path)); } catch { errors.push({ code: 'EXEC_RESULT_DEPENDENCY', message: `missing result dependency ${path}` }); }
}
exactKeys(contract.executionGuard, ['fullExecutionOwner','requiredOwnerArgument','requiredEnvironment','contractSmokeOwner','partialResultPromotionForbidden','holdoutMayNotEnterTuningOutput'], '#/executionGuard');
check(contract.executionGuard?.fullExecutionOwner === 'STEP3' && contract.executionGuard?.requiredOwnerArgument === 'STEP3' && contract.executionGuard?.requiredEnvironment === 'CT_STEP3_AUTHORIZED=1' && contract.executionGuard?.contractSmokeOwner === 'STEP2' && contract.executionGuard?.partialResultPromotionForbidden === true && contract.executionGuard?.holdoutMayNotEnterTuningOutput === true, 'EXEC_GUARD', 'execution guard mismatch');

if (errors.length) {
  console.error(JSON.stringify({ ok: false, executionContract: contractPath, errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, executionContract: contractPath, scenarioAlgorithmVersion: contract.scenarioAlgorithmVersion, executionVersion: contract.executionVersion, partitionCounts: Object.fromEntries(Object.entries(contract.partitions).map(([key, value]) => [key, value.seedsPerBuildPersona])), suiteCount: String(contract.highVolumeSuites.length) }));
