#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';

const contractPath = resolve(process.argv[2] ?? 'simulation/execution-contract-v2.json');
const [contract, schema, candidate, plan] = await Promise.all([
  readFile(contractPath, 'utf8').then(JSON.parse),
  readFile(resolve('simulation/execution-contract-v2.schema.json'), 'utf8').then(JSON.parse),
  readFile(resolve('simulation/candidate-v2.json'), 'utf8').then(JSON.parse),
  readFile(resolve('simulation/run-plan-v2.json'), 'utf8').then(JSON.parse),
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
  const valid = typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value) && value !== '-0';
  check(valid, 'EXEC_SIGNED', `${path} must be a canonical signed integer string`);
  return valid ? BigInt(value) : 0n;
};

try {
  assertSchema(contract, schema);
} catch (error) {
  for (const detail of error.errors ?? [{ path: '#', keyword: 'schema', message: error.message }]) errors.push({ code: 'SCHEMA', message: `${detail.path} ${detail.keyword}: ${detail.message}` });
}

exactKeys(contract, ['schemaVersion','contractId','candidateId','scenarioAlgorithmVersion','executionVersion','roundingVersion','sourcePaths','model','statistics','partitions','highVolumeSuites','resultContracts','executionGuard'], '#');
check(contract.schemaVersion === '2.1.0' && plan.schemaVersion === '2.1.0', 'EXEC_SCHEMA_VERSION', 'execution contract and run plan must both be 2.1.0');
check(contract.candidateId === candidate.meta.candidateId && contract.candidateId === plan.candidateId, 'EXEC_CANDIDATE_ID', 'candidateId binding mismatch');
check(contract.scenarioAlgorithmVersion === plan.scenarioAlgorithmVersion, 'EXEC_SCENARIO_VERSION', 'scenario algorithm differs from run plan');
check(contract.executionVersion === plan.executionVersion, 'EXEC_EXECUTION_VERSION', 'execution version differs from run plan');
check(contract.roundingVersion === candidate.meta.roundingVersion && contract.roundingVersion === plan.roundingVersion, 'EXEC_ROUNDING', 'rounding version mismatch');
exactKeys(contract.sourcePaths, ['candidate','runPlan','acceptance'], '#/sourcePaths');
check(eq(contract.sourcePaths, { candidate: 'simulation/candidate-v2.json', runPlan: 'simulation/run-plan-v2.json', acceptance: 'quality-reviews/step-2-executable-contract-v2/acceptance-matrix.json' }), 'EXEC_SOURCE_PATHS', 'source paths mismatch');
check(eq(plan.executionContract, { path: 'simulation/execution-contract-v2.json', schemaPath: 'simulation/execution-contract-v2.schema.json', validatorPath: 'simulation/validate-execution-contract-v2.mjs' }), 'EXEC_PLAN_BINDING', 'run-plan executionContract binding mismatch');

const builds = ['build.combat','build.reinforcement','build.commerce'];
const personas = ['no-ad-f2p','rewarded-ad-f2p','monthly-pass','controlled-payer','high-spend-stress'];
const horizons = ['1-10F','100F','1000F','10000F-or-equivalent','repeated-resets','30-45-day-economy'];
check(eq(plan.builds, builds) && eq(candidate.builds.map((entry) => entry.id), builds), 'EXEC_BUILDS', 'build set mismatch');
check(eq(plan.personas, personas) && eq(candidate.personas.map((entry) => entry.id), personas), 'EXEC_PERSONAS', 'persona set mismatch');
check(eq(plan.horizons.map((entry) => entry.id), horizons), 'EXEC_HORIZONS', 'horizon set mismatch');

exactKeys(contract.model, ['firstReset','progression','repeatedReset','gachaItemSelection'], '#/model');
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

const gachaSelection = contract.model?.gachaItemSelection;
exactKeys(gachaSelection, ['catalogEligibility','acquisitionFieldSemantics','selectionWithinRarity','nonFeaturedUrExcludesFeatured','character','weapon'], '#/model/gachaItemSelection');
check(gachaSelection?.catalogEligibility === 'all-catalog-items-by-rarity-v1' && gachaSelection?.acquisitionFieldSemantics === 'guaranteed-route-not-exclusive-v1' && gachaSelection?.selectionWithinRarity === 'uniform-stable-id-v1' && gachaSelection?.nonFeaturedUrExcludesFeatured === true, 'EXEC_GACHA_SELECTION_POLICY', 'gacha item-selection policy mismatch');
const allBanners = [...candidate.gacha.characterPools, ...candidate.gacha.weaponPools];
const gachaKinds = {
  character: {
    catalog: candidate.characters.catalog,
    banners: candidate.gacha.characterPools,
    expected: ['characters.catalog','banner.character.standard','banner.character.featured','character.launch.024'],
  },
  weapon: {
    catalog: candidate.weapons.catalog,
    banners: candidate.gacha.weaponPools,
    expected: ['weapons.catalog','banner.weapon.standard','banner.weapon.featured','weapon.launch.036'],
  },
};
for (const [kind, binding] of Object.entries(gachaKinds)) {
  const config = gachaSelection?.[kind];
  exactKeys(config, ['catalogPath','standardBannerId','featuredBannerId','featuredItemId'], `#/model/gachaItemSelection/${kind}`);
  check(eq([config?.catalogPath, config?.standardBannerId, config?.featuredBannerId, config?.featuredItemId], binding.expected), 'EXEC_GACHA_SELECTION_POLICY', `${kind} gacha item-selection binding mismatch`);
  const standardBanner = allBanners.find((entry) => entry.id === config?.standardBannerId);
  const featuredBanner = allBanners.find((entry) => entry.id === config?.featuredBannerId);
  check(Boolean(standardBanner) && Boolean(featuredBanner) && binding.banners.some((entry) => entry.id === config?.standardBannerId) && binding.banners.some((entry) => entry.id === config?.featuredBannerId), 'EXEC_GACHA_BANNER', `${kind} standard or featured banner is missing from its pool`);
  check(standardBanner?.kind === kind && featuredBanner?.kind === kind, 'EXEC_GACHA_BANNER_KIND', `${kind} banner kind mismatch`);
  const featuredItem = binding.catalog.find((entry) => entry.id === config?.featuredItemId);
  check(Boolean(featuredItem) && featuredItem?.baseRarity === 'UR', 'EXEC_GACHA_FEATURED_ITEM', `${kind} featured item must exist and be UR`);
  const rateTable = candidate.gacha.rates.find((entry) => entry.id === featuredBanner?.rateTable);
  check(Boolean(rateTable), 'EXEC_GACHA_RATE_TABLE', `${kind} featured banner rate table is missing`);
  const rarities = rateTable?.entries?.map((entry) => entry.rarity) ?? [];
  for (const rarity of rarities) {
    check(binding.catalog.some((entry) => entry.baseRarity === rarity), 'EXEC_GACHA_RARITY_COVERAGE', `${kind} has no item for rarity ${rarity}`);
  }
  const nonFeaturedUr = binding.catalog.filter((entry) => entry.baseRarity === 'UR' && entry.id !== config?.featuredItemId);
  check(nonFeaturedUr.length > 0, 'EXEC_GACHA_NONFEATURED_UR_POOL', `${kind} requires at least one non-featured UR item`);
}

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
check(BigInt(plan.scenarioCount.calibration) === 15n * BigInt(contract.partitions.calibration.seedsPerBuildPersona), 'EXEC_CALIBRATION_COUNT', 'calibration scenario count differs from partition contract');
check(BigInt(plan.scenarioCount.holdout) === 15n * BigInt(contract.partitions.holdout.seedsPerBuildPersona), 'EXEC_HOLDOUT_COUNT', 'holdout scenario count differs from partition contract');
check(new Set(Object.values(contract.partitions).map((entry) => entry.namespace)).size === 3, 'EXEC_NAMESPACE_OVERLAP', 'partition namespaces overlap');

const suiteIds = ['gacha-tails','pity-conformance','duplicate-skew-overflow','refund-replay-race','state-machine-model','large-number-properties'];
const expectedSuiteVersions = {
  'gacha-tails': 'gacha-tails-v3',
  'pity-conformance': 'pity-conformance-v1',
  'duplicate-skew-overflow': 'duplicate-skew-overflow-v3',
  'refund-replay-race': 'refund-replay-race-v2',
  'state-machine-model': 'state-machine-model-v1',
  'large-number-properties': 'large-number-properties-v1',
};
check(eq(contract.highVolumeSuites?.map((entry) => entry.id), suiteIds), 'EXEC_SUITE_ORDER', 'high-volume suite set or order mismatch');
for (const [index, id] of suiteIds.entries()) {
  const suite = contract.highVolumeSuites?.[index];
  const planned = unsigned(suite?.plannedSamples, `#/highVolumeSuites/${index}/plannedSamples`, { positive: true });
  const smoke = unsigned(suite?.contractSmokeSamples, `#/highVolumeSuites/${index}/contractSmokeSamples`, { positive: true });
  check(suite?.plannedSamples === plan.highVolumeSuites?.[index]?.plannedSamples, 'EXEC_SUITE_PLAN_BINDING', `${id} planned samples differ from run plan`);
  check(smoke < planned, 'EXEC_SUITE_SMOKE_BOUND', `${id} contract smoke must be smaller than the Step 3 sample count`);
  check(suite?.implementationVersion === expectedSuiteVersions[id], 'EXEC_SUITE_VERSION', `${id} implementation version mismatch`);
}

exactKeys(contract.resultContracts, ['qualificationSchema','qualificationValidator','gameplaySchema','gameplayValidator','highVolumeSchema','highVolumeValidator'], '#/resultContracts');
check(contract.resultContracts.qualificationSchema === plan.output.qualificationSchemaPath && contract.resultContracts.gameplaySchema === plan.output.gameplaySchemaPath && contract.resultContracts.highVolumeSchema === plan.output.highVolumeSchemaPath, 'EXEC_RESULT_PLAN_BINDING', 'result schemas differ from run plan');
for (const path of Object.values(contract.resultContracts ?? {})) {
  try { await access(resolve(path)); } catch { errors.push({ code: 'EXEC_RESULT_DEPENDENCY', message: `missing result dependency ${path}` }); }
}
exactKeys(contract.executionGuard, ['fullExecutionOwner','requiredOwnerArgument','requiredEnvironment','contractSmokeOwner','partialResultPromotionForbidden','holdoutMayNotEnterTuningOutput'], '#/executionGuard');
check(contract.executionGuard?.fullExecutionOwner === plan.fullExecutionOwner && contract.executionGuard?.requiredOwnerArgument === 'STEP3' && contract.executionGuard?.requiredEnvironment === 'CT_STEP3_AUTHORIZED=1' && contract.executionGuard?.contractSmokeOwner === 'STEP2' && contract.executionGuard?.partialResultPromotionForbidden === true && contract.executionGuard?.holdoutMayNotEnterTuningOutput === true, 'EXEC_GUARD', 'execution guard mismatch');

if (errors.length) {
  console.error(JSON.stringify({ ok: false, executionContract: contractPath, errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, executionContract: contractPath, scenarioAlgorithmVersion: contract.scenarioAlgorithmVersion, executionVersion: contract.executionVersion, partitionCounts: Object.fromEntries(Object.entries(contract.partitions).map(([key, value]) => [key, value.seedsPerBuildPersona])), suiteCount: String(contract.highVolumeSuites.length) }));
