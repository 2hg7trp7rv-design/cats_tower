#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';
import { sha256Canonical, sha256Text } from './engine-v2/hash.mjs';
import { runHighVolumeSuite } from './engine-v2/high-volume.mjs';

const resultPath = resolve(process.argv[2] ?? 'quality-reviews/step-2-executable-contract-v2/high-volume-contract-smoke.json');
const allowSmoke = process.argv.includes('--allow-contract-smoke');
const reproduce = process.argv.includes('--reproduce');
const [schema, result, candidateText, planText, executionText] = await Promise.all([
  readFile(resolve('simulation/high-volume-result-v2.schema.json'), 'utf8').then(JSON.parse),
  readFile(resultPath, 'utf8').then(JSON.parse),
  readFile(resolve('simulation/candidate-v2.json'), 'utf8'),
  readFile(resolve('simulation/run-plan-v2.json'), 'utf8'),
  readFile(resolve('simulation/execution-contract-v2.json'), 'utf8'),
]);
const candidate = JSON.parse(candidateText);
const execution = JSON.parse(executionText);
const errors = [];
const check = (condition, code, message) => { if (!condition) errors.push({ code, message }); };
const eq = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const unsigned = (value, path) => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'HV_UNSIGNED', `${path} is not canonical unsigned decimal`);
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : 0n;
};
const summary = (value, expectedCount, path) => {
  const count = unsigned(value?.count, `${path}/count`);
  const ordered = ['minimum','p50','p90','p99','maximum'].map((key) => unsigned(value?.[key], `${path}/${key}`));
  check(count === expectedCount, 'HV_SUMMARY_COUNT', `${path} expected ${expectedCount} values, got ${count}`);
  check(ordered.every((entry, index) => index === 0 || ordered[index - 1] <= entry), 'HV_SUMMARY_ORDER', `${path} percentile order is invalid`);
};

try { assertSchema(result, schema); } catch (error) {
  for (const detail of error.errors ?? [{ path: '#', keyword: 'schema', message: error.message }]) errors.push({ code: 'SCHEMA', message: `${detail.path} ${detail.keyword}: ${detail.message}` });
}
const payload = result.deterministicPayload;
const suite = execution.highVolumeSuites.find((entry) => entry.id === payload.suiteId);
check(Boolean(suite), 'HV_SUITE', 'suite is not present in the execution contract');
check(payload.candidateId === candidate.meta.candidateId, 'HV_CANDIDATE_ID', 'candidateId mismatch');
check(payload.scenarioAlgorithmVersion === execution.scenarioAlgorithmVersion && payload.executionVersion === execution.executionVersion && payload.roundingVersion === execution.roundingVersion, 'HV_VERSION', 'execution version mismatch');
const implementationVersion = suite?.implementationVersion?.match(/-(v[0-9]+)$/)?.[1];
check(Boolean(implementationVersion) && payload.metricContract === `${payload.suiteId}-metrics-${implementationVersion}`, 'HV_METRIC_CONTRACT', 'metric contract mismatch');
check(payload.seedNamespace === `cats-tower-v2-high-volume|${payload.suiteId}`, 'HV_NAMESPACE', 'seed namespace mismatch');
check(result.hashes.candidateSha256 === sha256Text(candidateText), 'HV_CANDIDATE_DIGEST', 'candidate digest mismatch');
check(result.hashes.runPlanSha256 === sha256Text(planText), 'HV_PLAN_DIGEST', 'run-plan digest mismatch');
check(result.hashes.executionContractSha256 === sha256Text(executionText), 'HV_EXECUTION_DIGEST', 'execution contract digest mismatch');
check(result.hashes.deterministicPayloadSha256 === sha256Canonical(payload), 'HV_PAYLOAD_DIGEST', 'deterministic payload digest mismatch');
check(result.evidence.canonicalJsonSha256 === result.hashes.deterministicPayloadSha256, 'HV_CANONICAL_DIGEST', 'canonical JSON digest mismatch');
const executedAt = Date.parse(result.evidence.executedAt);
check(Number.isFinite(executedAt) && executedAt <= Date.now() + 5 * 60 * 1000, 'HV_EXECUTED_AT', 'executedAt is invalid or in the future');

const sampleCount = unsigned(payload.sampleCount, '#/deterministicPayload/sampleCount');
const expectedSamples = unsigned(payload.expectedSamples, '#/deterministicPayload/expectedSamples');
check(sampleCount === expectedSamples, 'HV_SAMPLE_COUNT', 'sampleCount must equal expectedSamples');
const smoke = payload.mode === 'STEP2_STEP3_CONTRACT_SMOKE';
if (smoke) {
  check(allowSmoke, 'HV_SMOKE_NOT_ALLOWED', 'contract smoke requires --allow-contract-smoke');
  check(suite && payload.sampleCount === suite.contractSmokeSamples, 'HV_SMOKE_SIZE', 'contract smoke sample count differs from the sealed suite contract');
  check(payload.complete === false && result.verdict.suiteComplete === false, 'HV_SMOKE_COMPLETE', 'contract smoke may not claim completeness');
  check(result.verdict.balanceQualification === 'NOT_EVALUATED_CONTRACT_SMOKE', 'HV_SMOKE_BALANCE', 'contract smoke may not claim balance qualification');
  check(result.resultId === `cats-tower-step2-contract-smoke-high-volume-${payload.suiteId}-001`, 'HV_SMOKE_ID', 'contract smoke resultId mismatch');
} else {
  check(payload.mode === 'STEP3_HIGH_VOLUME_SUITE', 'HV_MODE', 'unknown high-volume mode');
  check(suite && payload.sampleCount === suite.plannedSamples, 'HV_FULL_SIZE', 'full suite sample count differs from the sealed plan');
  check(payload.complete === true && result.verdict.suiteComplete === true, 'HV_FULL_COMPLETE', 'full suite must claim completeness');
  check(result.verdict.balanceQualification === 'PENDING_STEP3_FINAL_JUDGE', 'HV_FULL_BALANCE', 'suite result cannot pre-judge balance');
  check(result.resultId === `cats-tower-step3-high-volume-${payload.suiteId}-001`, 'HV_FULL_ID', 'full suite resultId mismatch');
}
check(result.verdict.contractValidation === 'PASS' && result.verdict.step3PromotionAllowed === false && result.verdict.partialResultPromotion === false, 'HV_PROMOTION', 'suite result may not authorize promotion');
summary(payload.metrics.primary, sampleCount, '#/deterministicPayload/metrics/primary');
summary(payload.metrics.secondary, sampleCount, '#/deterministicPayload/metrics/secondary');
if (payload.metrics.tertiary !== undefined) summary(payload.metrics.tertiary, sampleCount, '#/deterministicPayload/metrics/tertiary');
if (payload.metrics.quaternary !== undefined) summary(payload.metrics.quaternary, sampleCount, '#/deterministicPayload/metrics/quaternary');
const counters = Object.fromEntries(Object.entries(payload.metrics.counters ?? {}).map(([key, value]) => [key, unsigned(value, `#/deterministicPayload/metrics/counters/${key}`)]));
const metricsWithoutDigest = {
  primary: payload.metrics.primary,
  secondary: payload.metrics.secondary,
  ...(payload.metrics.tertiary !== undefined ? { tertiary: payload.metrics.tertiary } : {}),
  ...(payload.metrics.quaternary !== undefined ? { quaternary: payload.metrics.quaternary } : {}),
  counters: payload.metrics.counters,
};
check(payload.metrics.suiteDigest === sha256Canonical({ suiteId: payload.suiteId, ...metricsWithoutDigest }), 'HV_SUITE_DIGEST', 'suite metrics digest mismatch');
check(payload.violations.length === 0, 'HV_VIOLATIONS', 'suite contains invariant violations');

const expectedCounterKeys = {
  'gacha-tails': ['characterSamples','characterPoolItemCount','characterTotalDraws','characterUniqueItemsSeen','characterFeaturedOutputs','characterFeaturedItemMismatches','characterNonFeaturedUrFeaturedViolations','characterHardPityTriggered','characterFeaturedGuaranteeTriggered','characterFeaturedRollHits','characterMaximumDrawsToFeatured','characterRarityNDraws','characterRarityRDraws','characterRarityRRDraws','characterRaritySRDraws','characterRaritySSRDraws','characterRarityURDraws','weaponSamples','weaponPoolItemCount','weaponTotalDraws','weaponUniqueItemsSeen','weaponFeaturedOutputs','weaponFeaturedItemMismatches','weaponNonFeaturedUrFeaturedViolations','weaponHardPityTriggered','weaponFeaturedGuaranteeTriggered','weaponFeaturedRollHits','weaponMaximumDrawsToFeatured','weaponRarityNDraws','weaponRarityRDraws','weaponRarityRRDraws','weaponRaritySRDraws','weaponRaritySSRDraws','weaponRarityURDraws','maximumDrawsToFeatured','boundaryViolations'],
  'pity-conformance': ['hardBoundaryCases','hardBoundaryPass','featuredBoundaryCases','featuredBoundaryPass','earlyHardFalse','earlyFeaturedFalse','boundaryViolations'],
  'duplicate-skew-overflow': ['characterSamples','characterCatalogSize','characterPoolItemCount','characterUniqueItemsSeen','characterItemsAtFullMastery','characterItemsWithOverflow','characterMaximumCopies','characterFeaturedCopies','characterFeaturedItemMismatches','characterNonFeaturedUrFeaturedViolations','characterHardPityTriggered','characterFeaturedGuaranteeTriggered','characterFeaturedRollHits','characterRarityNDraws','characterRarityRDraws','characterRarityRRDraws','characterRaritySRDraws','characterRaritySSRDraws','characterRarityURDraws','weaponSamples','weaponCatalogSize','weaponPoolItemCount','weaponUniqueItemsSeen','weaponItemsAtFullMastery','weaponItemsWithOverflow','weaponMaximumCopies','weaponFeaturedCopies','weaponFeaturedItemMismatches','weaponNonFeaturedUrFeaturedViolations','weaponHardPityTriggered','weaponFeaturedGuaranteeTriggered','weaponFeaturedRollHits','weaponRarityNDraws','weaponRarityRDraws','weaponRarityRRDraws','weaponRaritySRDraws','weaponRaritySSRDraws','weaponRarityURDraws'],
  'refund-replay-race': ['validRefunds','invalidSpentRejected','idempotentReplayMatches','exactlyOnceReceiptMatches','outOfOrderRestoreMatches','acceptedVersionRetryMatches','freeLedgerDebitViolations','deficitStateCount'],
  'state-machine-model': ['validAccepted','invalidRejected','unexpectedAccept','unexpectedReject','machineCount'],
  'large-number-properties': ['symbolicRepresentations','expandedRepresentations','canonicalIdPass','canonicalIdFail','adjacentModifierRepeatViolations','windowModifierRepeatViolations','backgroundDistrictMismatches','backgroundCycleMismatches','maximumDigits'],
};
check(eq(Object.keys(payload.metrics.counters ?? {}), expectedCounterKeys[payload.suiteId]), 'HV_COUNTER_FIELDS', 'suite counter fields or order mismatch');
const rarityDrawSum = (prefix) => ['N','R','RR','SR','SSR','UR'].reduce((sum, rarity) => sum + (counters[`${prefix}Rarity${rarity}Draws`] ?? 0n), 0n);
if (payload.suiteId === 'gacha-tails') {
  check(payload.metrics.tertiary !== undefined && payload.metrics.quaternary !== undefined, 'HV_GACHA_POOL_COVERAGE', 'gacha tails must independently represent character and weapon results');
  check(counters.characterSamples === sampleCount && counters.weaponSamples === sampleCount, 'HV_GACHA_SAMPLE_COVERAGE', 'gacha pool sample counts differ from sealed sampleCount');
  check(counters.characterPoolItemCount === BigInt(candidate.characters.catalog.length) && counters.weaponPoolItemCount === BigInt(candidate.weapons.catalog.length), 'HV_GACHA_CATALOG_BINDING', 'gacha pool item count differs from candidate catalog');
  check(counters.characterUniqueItemsSeen <= counters.characterPoolItemCount && counters.weaponUniqueItemsSeen <= counters.weaponPoolItemCount, 'HV_GACHA_UNIQUE_ITEM_COVERAGE', 'gacha unique item count exceeds its pool');
  check(counters.characterFeaturedOutputs === sampleCount && counters.weaponFeaturedOutputs === sampleCount, 'HV_GACHA_FEATURED_OUTPUTS', 'each gacha-tail sample must terminate on one featured item');
  check(counters.characterFeaturedItemMismatches === 0n && counters.weaponFeaturedItemMismatches === 0n && counters.characterNonFeaturedUrFeaturedViolations === 0n && counters.weaponNonFeaturedUrFeaturedViolations === 0n, 'HV_GACHA_ITEM_MAPPING', 'featured or non-featured UR mapped to the wrong stable item ID');
  check(rarityDrawSum('character') === counters.characterTotalDraws && rarityDrawSum('weapon') === counters.weaponTotalDraws, 'HV_GACHA_RARITY_COVERAGE', 'gacha rarity counts do not cover every concrete item result');
  check(counters.characterTotalDraws >= sampleCount && counters.characterTotalDraws <= sampleCount * 200n && counters.weaponTotalDraws >= sampleCount && counters.weaponTotalDraws <= sampleCount * 200n, 'HV_GACHA_DRAW_COVERAGE', 'gacha total draws are outside sealed tail bounds');
  check(counters.characterRarityURDraws >= counters.characterFeaturedOutputs && counters.weaponRarityURDraws >= counters.weaponFeaturedOutputs, 'HV_GACHA_UR_FEATURED_COVERAGE', 'featured output count exceeds UR results');
  check(counters.boundaryViolations === 0n && counters.characterMaximumDrawsToFeatured <= 200n && counters.weaponMaximumDrawsToFeatured <= 200n && counters.maximumDrawsToFeatured <= 200n, 'HV_GACHA_BOUNDARY', 'character or weapon gacha tail crossed a sealed pity boundary');
  check(BigInt(payload.metrics.primary.maximum) <= 100n && BigInt(payload.metrics.secondary.maximum) <= 200n && BigInt(payload.metrics.tertiary.maximum) <= 100n && BigInt(payload.metrics.quaternary.maximum) <= 200n, 'HV_GACHA_MAXIMUM', 'character or weapon gacha percentile input crossed pity bounds');
}
if (payload.suiteId === 'pity-conformance') {
  check(counters.boundaryViolations === 0n, 'HV_PITY_BOUNDARY', 'pity boundary conformance failed');
  check(counters.hardBoundaryPass === counters.hardBoundaryCases && counters.featuredBoundaryPass === counters.featuredBoundaryCases, 'HV_PITY_PASS_COUNT', 'pity boundary pass counts differ from cases');
}
if (payload.suiteId === 'duplicate-skew-overflow') {
  check(payload.metrics.tertiary !== undefined && payload.metrics.quaternary !== undefined, 'HV_DUPLICATE_POOL_COVERAGE', 'duplicate skew must independently represent character and weapon mastery');
  check(counters.characterSamples === sampleCount && counters.weaponSamples === sampleCount, 'HV_DUPLICATE_SAMPLE_COVERAGE', 'duplicate sample counts differ from sealed sampleCount');
  check(counters.characterCatalogSize === BigInt(candidate.characters.catalog.length) && counters.characterPoolItemCount === counters.characterCatalogSize && counters.characterUniqueItemsSeen <= counters.characterPoolItemCount && counters.characterItemsWithOverflow <= counters.characterItemsAtFullMastery, 'HV_CHARACTER_DUPLICATE_COUNTERS', 'character duplicate counters violate catalog, pool or mastery ordering');
  check(counters.weaponCatalogSize === BigInt(candidate.weapons.catalog.length) && counters.weaponPoolItemCount === counters.weaponCatalogSize && counters.weaponUniqueItemsSeen <= counters.weaponPoolItemCount && counters.weaponItemsWithOverflow <= counters.weaponItemsAtFullMastery, 'HV_WEAPON_DUPLICATE_COUNTERS', 'weapon duplicate counters violate catalog, pool or mastery ordering');
  check(rarityDrawSum('character') === sampleCount && rarityDrawSum('weapon') === sampleCount, 'HV_DUPLICATE_RARITY_COVERAGE', 'duplicate rarity counts do not cover the sealed draw count');
  check(counters.characterFeaturedCopies <= counters.characterRarityURDraws && counters.weaponFeaturedCopies <= counters.weaponRarityURDraws, 'HV_DUPLICATE_FEATURED_UR_COVERAGE', 'featured copies exceed UR results');
  check(counters.characterFeaturedItemMismatches === 0n && counters.weaponFeaturedItemMismatches === 0n && counters.characterNonFeaturedUrFeaturedViolations === 0n && counters.weaponNonFeaturedUrFeaturedViolations === 0n, 'HV_DUPLICATE_ITEM_MAPPING', 'duplicate stream mapped a featured or non-featured UR to the wrong stable item ID');
}
if (payload.suiteId === 'refund-replay-race') {
  check(counters.validRefunds + counters.invalidSpentRejected === sampleCount, 'HV_REFUND_COVERAGE', 'refund valid/rejected counts do not cover all samples');
  check(counters.idempotentReplayMatches === counters.validRefunds && counters.exactlyOnceReceiptMatches === counters.validRefunds && counters.outOfOrderRestoreMatches === counters.validRefunds && counters.acceptedVersionRetryMatches === counters.validRefunds && counters.freeLedgerDebitViolations === 0n, 'HV_REFUND_INVARIANT', 'refund replay, receipt, out-of-order restore, version binding or free-ledger invariant failed');
}
if (payload.suiteId === 'state-machine-model') {
  check(counters.validAccepted + counters.invalidRejected === sampleCount && counters.unexpectedAccept === 0n && counters.unexpectedReject === 0n, 'HV_STATE_MODEL', 'state-machine model accepted or rejected an unexpected transition');
}
if (!['gacha-tails','duplicate-skew-overflow'].includes(payload.suiteId)) check(payload.metrics.tertiary === undefined && payload.metrics.quaternary === undefined, 'HV_METRIC_SHAPE', 'suite contains unexpected tertiary or quaternary metrics');
if (payload.suiteId === 'large-number-properties') {
  check(counters.symbolicRepresentations === sampleCount && counters.expandedRepresentations === 0n && counters.canonicalIdPass === sampleCount && counters.canonicalIdFail === 0n && counters.adjacentModifierRepeatViolations === 0n && counters.windowModifierRepeatViolations === 0n && counters.backgroundDistrictMismatches === 0n && counters.backgroundCycleMismatches === 0n, 'HV_LARGE_NUMBER', 'large-number representation, generated ID, modifier repetition or background cadence invariant failed');
}

if (reproduce && (smoke || process.env.CT_STEP3_AUTHORIZED === '1')) {
  const rerun = await runHighVolumeSuite({ suiteId: payload.suiteId, contractSmoke: smoke, owner: smoke ? 'STEP2' : 'STEP3' });
  check(rerun.hashes.deterministicPayloadSha256 === result.hashes.deterministicPayloadSha256, 'HV_REPRODUCTION_DIGEST', 'reproduction digest mismatch');
  check(eq(rerun.deterministicPayload, payload), 'HV_REPRODUCTION_BYTES', 'reproduction payload mismatch');
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, result: resultPath, errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, result: resultPath, mode: payload.mode, suiteId: payload.suiteId, sampleCount: payload.sampleCount, digest: result.hashes.deterministicPayloadSha256, reproduced: reproduce }));
