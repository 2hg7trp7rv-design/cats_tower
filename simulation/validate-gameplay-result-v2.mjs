#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';
import { sha256Canonical, sha256Text } from './engine-v2/hash.mjs';
import { runGameplayPartition } from './engine-v2/run-plan.mjs';

const resultPath = resolve(process.argv[2] ?? 'quality-reviews/step-2-executable-contract-v2/gameplay-contract-smoke.json');
const allowSmoke = process.argv.includes('--allow-contract-smoke');
const reproduce = process.argv.includes('--reproduce');
const [schema, result, candidateText, planText, executionText] = await Promise.all([
  readFile(resolve('simulation/gameplay-result-v2.schema.json'), 'utf8').then(JSON.parse),
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
const toUnsigned = (value, path) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'GAMEPLAY_UNSIGNED', `${path} is not canonical unsigned decimal`);
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : 0n;
};
const checkSummary = (summary, expectedCount, path) => {
  const count = toUnsigned(summary?.count, `${path}/count`);
  const values = ['minimum','p50','p90','p99','maximum'].map((key) => toUnsigned(summary?.[key], `${path}/${key}`));
  check(count === expectedCount, 'GAMEPLAY_SUMMARY_COUNT', `${path} expected count ${expectedCount} got ${count}`);
  check(values.every((value, index) => index === 0 || values[index - 1] <= value), 'GAMEPLAY_SUMMARY_ORDER', `${path} percentile order is invalid`);
};

try { assertSchema(result, schema); } catch (error) {
  for (const detail of error.errors ?? [{ path: '#', keyword: 'schema', message: error.message }]) errors.push({ code: 'SCHEMA', message: `${detail.path} ${detail.keyword}: ${detail.message}` });
}

const payload = result.deterministicPayload;
check(result.hashes.candidateSha256 === sha256Text(candidateText), 'GAMEPLAY_CANDIDATE_DIGEST', 'candidate digest mismatch');
check(result.hashes.runPlanSha256 === sha256Text(planText), 'GAMEPLAY_PLAN_DIGEST', 'run-plan digest mismatch');
check(result.hashes.executionContractSha256 === sha256Text(executionText), 'GAMEPLAY_EXECUTION_DIGEST', 'execution contract digest mismatch');
check(result.hashes.deterministicPayloadSha256 === sha256Canonical(payload), 'GAMEPLAY_PAYLOAD_DIGEST', 'deterministic payload digest mismatch');
check(result.evidence.canonicalJsonSha256 === result.hashes.deterministicPayloadSha256, 'GAMEPLAY_CANONICAL_DIGEST', 'canonical JSON digest mismatch');
const executedAt = Date.parse(result.evidence.executedAt);
check(Number.isFinite(executedAt) && executedAt <= Date.now() + 5 * 60 * 1000, 'GAMEPLAY_EXECUTED_AT', 'executedAt is invalid or in the future');
check(payload.candidateId === candidate.meta.candidateId, 'GAMEPLAY_CANDIDATE_ID', 'candidateId mismatch');
check(payload.scenarioAlgorithmVersion === execution.scenarioAlgorithmVersion && payload.executionVersion === execution.executionVersion, 'GAMEPLAY_VERSION', 'execution version mismatch');
check(payload.roundingVersion === candidate.meta.roundingVersion, 'GAMEPLAY_ROUNDING', 'rounding version mismatch');

const partition = execution.partitions[payload.partition];
check(Boolean(partition) && ['calibration','holdout'].includes(payload.partition), 'GAMEPLAY_PARTITION', 'unknown gameplay partition');
if (partition) {
  check(payload.seedNamespace === partition.namespace, 'GAMEPLAY_NAMESPACE', 'partition namespace mismatch');
  check(payload.tuningVisible === partition.tuningVisible, 'GAMEPLAY_TUNING_VISIBILITY', 'partition tuning visibility mismatch');
}
const seedsPerCell = toUnsigned(payload.seedsPerCell, '#/deterministicPayload/seedsPerCell');
const expectedScenarioCount = toUnsigned(payload.expectedScenarioCount, '#/deterministicPayload/expectedScenarioCount');
const scenarioCount = toUnsigned(payload.scenarioCount, '#/deterministicPayload/scenarioCount');
check(expectedScenarioCount === seedsPerCell * 15n && scenarioCount === expectedScenarioCount, 'GAMEPLAY_SCENARIO_COUNT', 'scenario counts must equal 3x5xseedsPerCell');

const smoke = payload.mode === 'STEP2_STEP3_CONTRACT_SMOKE';
if (smoke) {
  check(allowSmoke, 'GAMEPLAY_SMOKE_NOT_ALLOWED', 'contract smoke requires --allow-contract-smoke');
  check(payload.complete === false && result.verdict.partitionComplete === false, 'GAMEPLAY_SMOKE_COMPLETE', 'contract smoke may not claim completeness');
  check(result.verdict.balanceQualification === 'NOT_EVALUATED_CONTRACT_SMOKE', 'GAMEPLAY_SMOKE_BALANCE', 'contract smoke may not claim a balance verdict');
  check(partition && seedsPerCell > 0n && seedsPerCell < BigInt(partition.seedsPerBuildPersona), 'GAMEPLAY_SMOKE_SIZE', 'contract smoke must be non-zero and smaller than the partition');
  check(result.resultId === `cats-tower-step2-contract-smoke-${payload.partition}-001`, 'GAMEPLAY_SMOKE_ID', 'contract smoke resultId mismatch');
} else {
  check(payload.mode === 'STEP3_GAMEPLAY_PARTITION', 'GAMEPLAY_MODE', 'unknown gameplay mode');
  check(payload.complete === true && result.verdict.partitionComplete === true, 'GAMEPLAY_FULL_COMPLETE', 'full partition must be complete');
  check(result.verdict.balanceQualification === 'PENDING_STEP3_FINAL_JUDGE', 'GAMEPLAY_FULL_BALANCE', 'partition result cannot pre-judge balance');
  check(partition && seedsPerCell === BigInt(partition.seedsPerBuildPersona), 'GAMEPLAY_FULL_SIZE', 'full partition seed count differs from sealed contract');
  check(result.resultId === `cats-tower-step3-${payload.partition}-001`, 'GAMEPLAY_FULL_ID', 'full partition resultId mismatch');
}
check(result.verdict.step3PromotionAllowed === false && result.verdict.partialResultPromotion === false, 'GAMEPLAY_PROMOTION', 'a partition result may not authorize promotion');

const builds = ['build.combat','build.reinforcement','build.commerce'];
const personas = ['no-ad-f2p','rewarded-ad-f2p','monthly-pass','controlled-payer','high-spend-stress'];
const horizons = ['1-10F','100F','1000F','10000F-or-equivalent','repeated-resets','30-45-day-economy'];
const expectedCells = new Set();
for (const build of builds) for (const persona of personas) expectedCells.add(`${build}|${persona}`);
const allDigests = new Set();
for (const [index, cell] of (payload.cells ?? []).entries()) {
  const identity = `${cell.buildId}|${cell.personaId}`;
  check(expectedCells.delete(identity), 'GAMEPLAY_CELL_IDENTITY', `duplicate or unknown cell ${identity}`);
  check(cell.cellId === `${payload.partition}|${identity}`, 'GAMEPLAY_CELL_ID', `cellId mismatch at ${index}`);
  check(BigInt(cell.seedCount) === seedsPerCell, 'GAMEPLAY_CELL_SEEDS', `seedCount mismatch for ${identity}`);
  check(cell.scenarioDigests.length === Number(seedsPerCell), 'GAMEPLAY_DIGEST_COUNT', `scenario digest count mismatch for ${identity}`);
  for (const digest of cell.scenarioDigests) check(!allDigests.has(digest) && allDigests.add(digest), 'GAMEPLAY_DIGEST_UNIQUE', `duplicate scenario digest ${digest}`);
  checkSummary(cell.metrics.firstResetMinutes, seedsPerCell, `#/cells/${index}/metrics/firstResetMinutes`);
  checkSummary(cell.metrics.featuredGuaranteeDay, seedsPerCell, `#/cells/${index}/metrics/featuredGuaranteeDay`);
  check(eq(cell.metrics.horizons.map((entry) => entry.horizonId), horizons), 'GAMEPLAY_HORIZON_ORDER', `horizon order mismatch for ${identity}`);
  for (const [horizonIndex, horizon] of cell.metrics.horizons.entries()) checkSummary(horizon.estimatedReachMinutes, seedsPerCell, `#/cells/${index}/metrics/horizons/${horizonIndex}/estimatedReachMinutes`);
  const resetP50 = BigInt(cell.metrics.firstResetMinutes.p50);
  check(resetP50 >= 20n && resetP50 <= 35n, 'GAMEPLAY_RESET_P50', `${identity} first-reset p50 ${resetP50} is outside 20-35 minutes`);
  if (cell.personaId === 'no-ad-f2p') {
    const dayP50 = BigInt(cell.metrics.featuredGuaranteeDay.p50);
    check(dayP50 >= 30n && dayP50 <= 45n, 'GAMEPLAY_NO_AD_FEATURED_P50', `${identity} featured guarantee p50 ${dayP50} is outside 30-45 days`);
  }
}
check(expectedCells.size === 0, 'GAMEPLAY_CELL_COVERAGE', `missing cells: ${[...expectedCells].join(',')}`);
check(allDigests.size === Number(scenarioCount), 'GAMEPLAY_GLOBAL_DIGEST_COUNT', 'global scenario digest count mismatch');
checkSummary(payload.summary.firstResetMinutes, scenarioCount, '#/deterministicPayload/summary/firstResetMinutes');
checkSummary(payload.summary.featuredGuaranteeDay, scenarioCount, '#/deterministicPayload/summary/featuredGuaranteeDay');
check(payload.violations.length === 0, 'GAMEPLAY_VIOLATIONS', 'gameplay result contains contract violations');

if (reproduce && (smoke || process.env.CT_STEP3_AUTHORIZED === '1')) {
  const rerun = await runGameplayPartition({
    partition: payload.partition,
    contractSmoke: smoke,
    smokeSeedsPerCell: smoke ? payload.seedsPerCell : undefined,
    owner: smoke ? 'STEP2' : 'STEP3',
  });
  check(rerun.hashes.deterministicPayloadSha256 === result.hashes.deterministicPayloadSha256, 'GAMEPLAY_REPRODUCTION_DIGEST', 'reproduction digest mismatch');
  check(eq(rerun.deterministicPayload, payload), 'GAMEPLAY_REPRODUCTION_BYTES', 'reproduction payload mismatch');
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, result: resultPath, errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, result: resultPath, mode: payload.mode, partition: payload.partition, scenarioCount: payload.scenarioCount, digest: result.hashes.deterministicPayloadSha256, reproduced: reproduce }));
