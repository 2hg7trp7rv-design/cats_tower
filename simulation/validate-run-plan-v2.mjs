#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { deterministicSeed } from './engine-v2/rng.mjs';

const planPath = resolve(process.argv[2] ?? 'simulation/run-plan-v2.json');
const plan = JSON.parse(await readFile(planPath, 'utf8'));
const errors = [];
const check = (condition, code, message) => { if (!condition) errors.push({ code, message }); };
const eq = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exactKeys = (value, expected, path) => {
  check(value && typeof value === 'object' && !Array.isArray(value), 'RUN_PLAN_OBJECT', `${path} must be an object`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  check(eq(Object.keys(value), expected), 'RUN_PLAN_FIELDS', `${path} fields or ordering differ: ${JSON.stringify(Object.keys(value))}`);
};
const unsigned = (value, path, { positive = false } = {}) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'RUN_PLAN_UNSIGNED', `${path} must be a canonical unsigned integer string`);
  if (!(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) return 0n;
  const parsed = BigInt(value);
  if (positive) check(parsed > 0n, 'RUN_PLAN_POSITIVE', `${path} must be positive`);
  return parsed;
};

const top = ['schemaVersion','planId','candidateId','scenarioAlgorithmVersion','executionVersion','roundingVersion','step2Mode','fullExecutionOwner','executionContract','builds','personas','seeds','scenarioCount','horizons','qualificationHorizons','highVolumeSuites','holdoutPolicy','output'];
exactKeys(plan, top, '#');
check(plan.schemaVersion === '2.1.0', 'RUN_PLAN_SCHEMA_VERSION', 'schemaVersion must be 2.1.0');
check(plan.planId === 'cats-tower-run-plan-v2', 'RUN_PLAN_ID', 'unexpected planId');
check(plan.candidateId === 'cats-tower-v2-candidate-001', 'RUN_PLAN_CANDIDATE', 'candidateId mismatch');
check(plan.scenarioAlgorithmVersion === 'cats-tower-scenario-v2.2.0', 'RUN_PLAN_SCENARIO_ALGORITHM', 'scenarioAlgorithmVersion mismatch');
check(plan.executionVersion === 'cats-tower-step3-executor-v1.1.0', 'RUN_PLAN_EXECUTION_VERSION', 'executionVersion mismatch');
check(plan.roundingVersion === 'ct-rational-half-even-v1', 'RUN_PLAN_ROUNDING', 'roundingVersion mismatch');
check(plan.step2Mode === 'QUALIFICATION_ONLY', 'RUN_PLAN_STEP2_SCOPE', 'Step 2 balance execution must remain qualification only');
check(plan.fullExecutionOwner === 'STEP3', 'RUN_PLAN_STEP3_OWNER', 'full execution must belong to Step 3');

exactKeys(plan.executionContract, ['path','schemaPath','validatorPath'], '#/executionContract');
check(eq(plan.executionContract, {
  path: 'simulation/execution-contract-v2.json',
  schemaPath: 'simulation/execution-contract-v2.schema.json',
  validatorPath: 'simulation/validate-execution-contract-v2.mjs',
}), 'RUN_PLAN_EXECUTION_CONTRACT', 'execution contract binding mismatch');
for (const path of Object.values(plan.executionContract ?? {})) {
  try { await access(resolve(path)); } catch { errors.push({ code: 'RUN_PLAN_EXECUTION_DEPENDENCY', message: `missing ${path}` }); }
}

const builds = ['build.combat','build.reinforcement','build.commerce'];
const personas = ['no-ad-f2p','rewarded-ad-f2p','monthly-pass','controlled-payer','high-spend-stress'];
check(eq(plan.builds, builds), 'RUN_PLAN_BUILDS', 'build axis must be the sealed three-build set');
check(eq(plan.personas, personas), 'RUN_PLAN_PERSONAS', 'persona axis must be the sealed five-persona set');

exactKeys(plan.seeds, ['perBuildPersona','calibrationPerCell','holdoutPerCell','qualificationPerCell','calibrationNamespace','holdoutNamespace','qualificationNamespace','generation','v1ObservedReuse'], '#/seeds');
const perCell = unsigned(plan.seeds?.perBuildPersona, '#/seeds/perBuildPersona', { positive: true });
const calibration = unsigned(plan.seeds?.calibrationPerCell, '#/seeds/calibrationPerCell', { positive: true });
const holdout = unsigned(plan.seeds?.holdoutPerCell, '#/seeds/holdoutPerCell', { positive: true });
const qualification = unsigned(plan.seeds?.qualificationPerCell, '#/seeds/qualificationPerCell', { positive: true });
check(perCell === 1000n, 'RUN_PLAN_SEEDS_PER_CELL', 'full matrix requires 1000 seeds per build/persona');
check(calibration === 800n && holdout === 200n && calibration + holdout === perCell, 'RUN_PLAN_SEED_PARTITION', 'seed partition must be 800 calibration + 200 holdout = 1000');
check(qualification === 2n, 'RUN_PLAN_QUALIFICATION_SEEDS', 'qualification must use exactly two seeds per cell');
check(plan.seeds?.generation === 'sha256(namespace|build|persona|ordinal)', 'RUN_PLAN_SEED_GENERATION', 'seed generation rule mismatch');
check(plan.seeds?.v1ObservedReuse === false, 'RUN_PLAN_V1_REUSE', 'V1 observed seeds may not be reused');
const namespaces = [plan.seeds?.calibrationNamespace, plan.seeds?.holdoutNamespace, plan.seeds?.qualificationNamespace];
check(eq(namespaces, ['cats-tower-v2-calibration','cats-tower-v2-holdout-unseen','cats-tower-v2-qualification']), 'RUN_PLAN_NAMESPACES', 'seed namespaces mismatch');
check(new Set(namespaces).size === 3, 'RUN_PLAN_NAMESPACE_OVERLAP', 'calibration, holdout and qualification namespaces must be disjoint');

exactKeys(plan.scenarioCount, ['fullGameplayMatrix','calibration','holdout','qualification'], '#/scenarioCount');
const fullCount = unsigned(plan.scenarioCount?.fullGameplayMatrix, '#/scenarioCount/fullGameplayMatrix', { positive: true });
const calibrationCount = unsigned(plan.scenarioCount?.calibration, '#/scenarioCount/calibration', { positive: true });
const holdoutCount = unsigned(plan.scenarioCount?.holdout, '#/scenarioCount/holdout', { positive: true });
const qualificationCount = unsigned(plan.scenarioCount?.qualification, '#/scenarioCount/qualification', { positive: true });
const cellCount = BigInt(builds.length * personas.length);
check(fullCount === cellCount * perCell && fullCount === 15000n, 'RUN_PLAN_FULL_COUNT', 'full matrix must be 3x5x1000=15000');
check(calibrationCount === cellCount * calibration && calibrationCount === 12000n, 'RUN_PLAN_CALIBRATION_COUNT', 'calibration must be 3x5x800=12000');
check(holdoutCount === cellCount * holdout && holdoutCount === 3000n, 'RUN_PLAN_HOLDOUT_COUNT', 'holdout must be 3x5x200=3000');
check(calibrationCount + holdoutCount === fullCount, 'RUN_PLAN_PARTITION_TOTAL', 'calibration and holdout must exactly cover the gameplay matrix');
check(qualificationCount === cellCount * qualification && qualificationCount === 30n, 'RUN_PLAN_QUALIFICATION_COUNT', 'qualification must be 3x5x2=30');

const expectedHorizons = [
  { id: '1-10F', targetFloor: '10', mode: 'progression' },
  { id: '100F', targetFloor: '100', mode: 'progression' },
  { id: '1000F', targetFloor: '1000', mode: 'progression' },
  { id: '10000F-or-equivalent', targetFloor: '10000', mode: 'progression' },
  { id: 'repeated-resets', targetFloor: '1000', mode: 'five-resets' },
  { id: '30-45-day-economy', targetFloor: '1000', mode: 'economy-45d' },
];
check(Array.isArray(plan.horizons) && plan.horizons.length === expectedHorizons.length, 'RUN_PLAN_HORIZON_COUNT', 'six exact horizons are required');
for (const [index, expected] of expectedHorizons.entries()) {
  const actual = plan.horizons?.[index];
  exactKeys(actual, ['id','targetFloor','mode'], `#/horizons/${index}`);
  check(eq(actual, expected), 'RUN_PLAN_HORIZON', `horizon ${index} mismatch`);
}
check(eq(plan.qualificationHorizons, expectedHorizons.map((entry) => entry.id)), 'RUN_PLAN_QUALIFICATION_HORIZONS', 'qualification horizon order or coverage mismatch');

const expectedSuites = [
  ['gacha-tails','200000'],
  ['pity-conformance','1000000'],
  ['duplicate-skew-overflow','200000'],
  ['refund-replay-race','100000'],
  ['state-machine-model','100000'],
  ['large-number-properties','100000'],
];
check(Array.isArray(plan.highVolumeSuites) && plan.highVolumeSuites.length === expectedSuites.length, 'RUN_PLAN_SUITE_COUNT', 'all six high-volume suites are required');
for (const [index, [id, plannedSamples]] of expectedSuites.entries()) {
  const suite = plan.highVolumeSuites?.[index];
  exactKeys(suite, ['id','plannedSamples','execution'], `#/highVolumeSuites/${index}`);
  check(suite?.id === id && suite?.plannedSamples === plannedSamples && suite?.execution === 'STEP3_ONLY', 'RUN_PLAN_SUITE', `suite ${id} mismatch or not Step3-only`);
  unsigned(suite?.plannedSamples, `#/highVolumeSuites/${index}/plannedSamples`, { positive: true });
}

exactKeys(plan.holdoutPolicy, ['disjoint','tuningOutputContainsHoldout','unsealRequiresFinalJudge'], '#/holdoutPolicy');
check(plan.holdoutPolicy?.disjoint === true, 'RUN_PLAN_HOLDOUT_DISJOINT', 'holdout must be disjoint');
check(plan.holdoutPolicy?.tuningOutputContainsHoldout === false, 'RUN_PLAN_HOLDOUT_TUNING', 'holdout may not be exposed to tuning output');
check(plan.holdoutPolicy?.unsealRequiresFinalJudge === true, 'RUN_PLAN_HOLDOUT_UNSEAL', 'holdout unseal must require final judge');

exactKeys(plan.output, ['qualificationPath','calibrationPath','holdoutPath','highVolumeDirectory','qualificationSchemaPath','gameplaySchemaPath','highVolumeSchemaPath','canonicalJson','hashEachScenario'], '#/output');
check(plan.output?.qualificationPath === 'quality-reviews/step-2-executable-contract-v2/qualification-result.json', 'RUN_PLAN_QUALIFICATION_PATH', 'qualification output path mismatch');
check(plan.output?.calibrationPath === 'quality-reviews/step-3-large-scale-validation/gameplay-calibration-result.json', 'RUN_PLAN_CALIBRATION_PATH', 'calibration output path mismatch');
check(plan.output?.holdoutPath === 'quality-reviews/step-3-large-scale-validation/gameplay-holdout-result.json', 'RUN_PLAN_HOLDOUT_PATH', 'holdout output path mismatch');
check(plan.output?.highVolumeDirectory === 'quality-reviews/step-3-large-scale-validation/high-volume', 'RUN_PLAN_HIGH_VOLUME_PATH', 'high-volume output directory mismatch');
check(plan.output?.qualificationSchemaPath === 'simulation/result-v2.schema.json' && plan.output?.gameplaySchemaPath === 'simulation/gameplay-result-v2.schema.json' && plan.output?.highVolumeSchemaPath === 'simulation/high-volume-result-v2.schema.json', 'RUN_PLAN_RESULT_SCHEMAS', 'result schema paths mismatch');
check(plan.output?.canonicalJson === true && plan.output?.hashEachScenario === true, 'RUN_PLAN_OUTPUT_HASHING', 'canonical JSON and per-scenario hash are mandatory');
for (const path of [plan.output?.qualificationSchemaPath, plan.output?.gameplaySchemaPath, plan.output?.highVolumeSchemaPath]) {
  try { await access(resolve(path)); } catch { errors.push({ code: 'RUN_PLAN_RESULT_SCHEMA_DEPENDENCY', message: `missing ${path}` }); }
}

const sampledSeeds = new Map();
for (const namespace of namespaces) {
  if (typeof namespace !== 'string') continue;
  for (const build of builds) for (const persona of personas) for (const ordinal of [0,1,199,200,799,800,999]) {
    const seed = deterministicSeed(namespace, build, persona, ordinal);
    check(/^[a-f0-9]{64}$/.test(seed), 'RUN_PLAN_SEED_FORMAT', `${namespace}|${build}|${persona}|${ordinal}`);
    const identity = `${namespace}|${build}|${persona}|${ordinal}`;
    check(!sampledSeeds.has(seed), 'RUN_PLAN_SEED_COLLISION', `${identity} collides with ${sampledSeeds.get(seed)}`);
    sampledSeeds.set(seed, identity);
    check(seed === deterministicSeed(namespace, build, persona, ordinal), 'RUN_PLAN_SEED_NONDETERMINISTIC', identity);
  }
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, runPlan: planPath, errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, runPlan: planPath, fullScenarioCount: fullCount.toString(), calibrationScenarioCount: calibrationCount.toString(), holdoutScenarioCount: holdoutCount.toString(), qualificationScenarioCount: qualificationCount.toString(), sampledSeedCount: String(sampledSeeds.size), scenarioAlgorithmVersion: plan.scenarioAlgorithmVersion, executionVersion: plan.executionVersion, step2Mode: plan.step2Mode, fullExecutionOwner: plan.fullExecutionOwner }));
