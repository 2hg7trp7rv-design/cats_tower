#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';
import { sha256Canonical, sha256Text } from './engine-v2/hash.mjs';
import { deterministicSeed } from './engine-v2/rng.mjs';
import { runQualification } from './engine-v2/run-plan.mjs';

const resultPath = resolve(process.argv[2] ?? 'quality-reviews/step-2-executable-contract-v2/qualification-result.json');
const reproduce = process.argv.includes('--reproduce');
const [schema, result, candidateText, planText, executionText] = await Promise.all([
  readFile(resolve('simulation/result-v2.schema.json'), 'utf8').then(JSON.parse),
  readFile(resultPath, 'utf8').then(JSON.parse),
  readFile(resolve('simulation/candidate-v2.json'), 'utf8'),
  readFile(resolve('simulation/run-plan-v2.json'), 'utf8'),
  readFile(resolve('simulation/execution-contract-v2.json'), 'utf8'),
]);
const candidate = JSON.parse(candidateText);
const plan = JSON.parse(planText);
const execution = JSON.parse(executionText);
const errors = [];
const check = (condition, code, message) => { if (!condition) errors.push({ code, message }); };
const eq = (left, right) => JSON.stringify(left) === JSON.stringify(right);

try {
  assertSchema(result, schema);
} catch (error) {
  for (const detail of error.errors ?? [{ path: '#', keyword: 'schema', message: error.message }]) {
    errors.push({ code: 'SCHEMA', message: `${detail.path} ${detail.keyword}: ${detail.message}` });
  }
}

const payload = result.deterministicPayload;
check(result.schemaVersion === '2.1.0', 'RESULT_VERSION', 'qualification result schemaVersion must be 2.1.0');
check(payload.candidateId === candidate.meta.candidateId, 'CANDIDATE_ID', 'candidateId mismatch');
check(payload.scenarioAlgorithmVersion === execution.scenarioAlgorithmVersion, 'SCENARIO_ALGORITHM_VERSION', 'scenario algorithm version mismatch');
check(payload.executionVersion === execution.executionVersion, 'EXECUTION_VERSION', 'execution version mismatch');
check(payload.roundingVersion === execution.roundingVersion && payload.roundingVersion === candidate.meta.roundingVersion, 'ROUNDING_VERSION', 'rounding version mismatch');
check(payload.seedNamespace === execution.partitions.qualification.namespace, 'QUALIFICATION_NAMESPACE', 'qualification namespace mismatch');
check(result.hashes.candidateSha256 === sha256Text(candidateText), 'CANDIDATE_DIGEST', 'candidate digest mismatch');
check(result.hashes.runPlanSha256 === sha256Text(planText), 'RUN_PLAN_DIGEST', 'run-plan digest mismatch');
check(result.hashes.executionContractSha256 === sha256Text(executionText), 'EXECUTION_CONTRACT_DIGEST', 'execution contract digest mismatch');
check(result.hashes.deterministicPayloadSha256 === sha256Canonical(payload), 'PAYLOAD_DIGEST', 'deterministic payload digest mismatch');
check(result.evidence.canonicalJsonSha256 === result.hashes.deterministicPayloadSha256, 'CANONICAL_DIGEST', 'canonical JSON digest mismatch');
const executedAtMs = Date.parse(result.evidence.executedAt);
check(Number.isFinite(executedAtMs), 'EVIDENCE_TIME', 'executedAt must be a valid UTC timestamp');
check(executedAtMs <= Date.now() + 5 * 60 * 1000, 'EVIDENCE_TIME_FUTURE', 'executedAt is implausibly in the future');
check(result.evidence.reproductionCommand === 'node simulation/engine-v2/run-plan.mjs --mode qualification --output quality-reviews/step-2-executable-contract-v2/qualification-result.json', 'REPRODUCTION_COMMAND', 'unexpected reproduction command');

const scenarios = payload.scenarios ?? [];
check(BigInt(payload.scenarioCount) === BigInt(scenarios.length), 'SCENARIO_COUNT', 'scenario count field mismatch');
check(scenarios.length === 30, 'QUALIFICATION_MATRIX', 'qualification must contain 3x5x2=30 scenarios');
check(new Set(scenarios.map((entry) => entry.scenarioId)).size === scenarios.length, 'SCENARIO_ID', 'scenario IDs are not unique');
check(new Set(scenarios.map((entry) => entry.scenarioDigest)).size === scenarios.length, 'SCENARIO_DIGEST_UNIQUE', 'scenario digests are not unique');

const expectedCells = new Set();
for (const build of plan.builds) for (const persona of plan.personas) for (let ordinal = 0; ordinal < Number(execution.partitions.qualification.seedsPerBuildPersona); ordinal += 1) {
  expectedCells.add(`${build}|${persona}|${ordinal}`);
}
const horizonOrder = plan.horizons.map((entry) => entry.id);
for (const scenario of scenarios) {
  const { scenarioDigest, ...scenarioPayload } = scenario;
  check(scenarioDigest === sha256Canonical(scenarioPayload), 'SCENARIO_DIGEST', scenario.scenarioId);
  check(scenario.partition === 'qualification', 'SCENARIO_PARTITION', scenario.scenarioId);
  check(scenario.scenarioAlgorithmVersion === execution.scenarioAlgorithmVersion && scenario.executionVersion === execution.executionVersion, 'SCENARIO_VERSION', scenario.scenarioId);
  const identity = `${scenario.buildId}|${scenario.personaId}|${scenario.ordinal}`;
  check(expectedCells.delete(identity), 'MATRIX_DUPLICATE_OR_UNKNOWN', identity);
  const expectedSeed = deterministicSeed(execution.partitions.qualification.namespace, scenario.buildId, scenario.personaId, Number(scenario.ordinal));
  check(scenario.seed === expectedSeed, 'SCENARIO_SEED', scenario.scenarioId);
  check(scenario.scenarioId === `${execution.partitions.qualification.namespace}|qualification|${scenario.buildId}|${scenario.personaId}|${scenario.ordinal}`, 'SCENARIO_ID_FORMAT', scenario.scenarioId);
  const minutes = BigInt(scenario.firstResetMinutes);
  check(minutes >= 20n && minutes <= 35n, 'FIRST_RESET_WINDOW', `${scenario.scenarioId}=${minutes}`);
  check(scenario.firstEvolutionCovered === true && BigInt(scenario.firstResetRuby) >= BigInt(scenario.firstEvolutionCost), 'FIRST_EVOLUTION_COVERAGE', scenario.scenarioId);
  check(scenario.masteryAt20.masteredCopies === '20' && scenario.masteryAt20.overflowCopies === '0', 'MASTERY_20', scenario.scenarioId);
  check(scenario.masteryOverflowAt25.masteredCopies === '20' && scenario.masteryOverflowAt25.overflowCopies === '5' && scenario.masteryOverflowAt25.overflowCredit === '500', 'MASTERY_OVERFLOW', scenario.scenarioId);
  check(eq(scenario.horizons.map((entry) => entry.horizonId), horizonOrder), 'HORIZONS', scenario.scenarioId);
  const floor10000 = scenario.horizons.find((entry) => entry.horizonId === '10000F-or-equivalent');
  check(floor10000?.targetFloorRepresentation === 'exact-symbolic-power', 'LARGE_FLOOR_REPRESENTATION', scenario.scenarioId);
  if (scenario.personaId === 'no-ad-f2p') {
    const day = BigInt(scenario.featuredGuaranteeDay);
    check(day >= 30n && day <= 45n, 'NO_AD_FEATURED_WINDOW', `${scenario.scenarioId}=${day}`);
  }
}
check(expectedCells.size === 0, 'MATRIX_COVERAGE', `missing ${[...expectedCells].join(',')}`);
check(payload.summary.buildCount === '3' && payload.summary.personaCount === '5' && payload.summary.seedsPerCell === '2', 'SUMMARY_AXES', 'qualification summary axes mismatch');
check(payload.summary.balanceVerdict === 'NOT_EVALUATED_STEP2', 'BALANCE_SCOPE', 'Step 2 issued a balance verdict');
check(result.verdict.contractQualification === 'PASS' && result.verdict.balanceQualification === 'NOT_RUN_STEP3_REQUIRED' && result.verdict.step3AuthorizedByThisResult === false, 'STEP3_SCOPE', 'qualification improperly authorizes Step 3 or claims balance');
check(payload.violations.length === 0, 'VIOLATIONS', 'qualification contains violations');

if (reproduce) {
  const rerun = await runQualification();
  check(rerun.hashes.deterministicPayloadSha256 === result.hashes.deterministicPayloadSha256, 'REPRODUCTION', 'rerun digest differs');
  check(eq(rerun.deterministicPayload, payload), 'BYTE_REPRODUCTION', 'normalized deterministic payload differs');
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, result: resultPath, errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, result: resultPath, scenarioCount: String(scenarios.length), digest: result.hashes.deterministicPayloadSha256, scenarioAlgorithmVersion: payload.scenarioAlgorithmVersion, executionVersion: payload.executionVersion, reproduced: reproduce, balanceVerdict: 'NOT_EVALUATED_STEP2' }));
