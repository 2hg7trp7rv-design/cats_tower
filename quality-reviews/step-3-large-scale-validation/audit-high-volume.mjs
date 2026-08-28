#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { sha256Canonical, sha256Text } from '../../simulation/engine-v2/hash.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function asBigInt(value, label) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error(`INVALID_UNSIGNED:${label}:${value}`);
  return BigInt(value);
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function compareSummary(summary, maximum, label) {
  return {
    count: summary.count,
    minimum: summary.minimum,
    p50: summary.p50,
    p90: summary.p90,
    p99: summary.p99,
    maximum: summary.maximum,
    maximumAllowed: maximum,
    pass: asBigInt(summary.maximum, `${label}.maximum`) <= asBigInt(maximum, `${label}.maximumAllowed`),
  };
}

const resultPath = arg('--result');
const suiteId = arg('--suite');
const outputPath = arg('--output');
if (!resultPath || !suiteId || !outputPath) throw new Error('--result, --suite and --output are required');

const [resultBuffer, candidateText, planText, executionText] = await Promise.all([
  readFile(resolve(resultPath)),
  readFile(resolve('simulation/candidate-v2.json'), 'utf8'),
  readFile(resolve('simulation/run-plan-v2.json'), 'utf8'),
  readFile(resolve('simulation/execution-contract-v2.json'), 'utf8'),
]);
const result = JSON.parse(resultBuffer.toString('utf8'));
const candidate = JSON.parse(candidateText);
const execution = JSON.parse(executionText);
const payload = result.deterministicPayload;
const metrics = payload.metrics;
const counters = Object.fromEntries(Object.entries(metrics.counters).map(([key, value]) => [key, asBigInt(value, `counter.${key}`)]));
const suite = execution.highVolumeSuites.find((entry) => entry.id === suiteId);
if (!suite) throw new Error(`UNKNOWN_SUITE:${suiteId}`);
if (payload.suiteId !== suiteId) throw new Error(`SUITE_MISMATCH:${payload.suiteId}:${suiteId}`);
if (payload.mode !== 'STEP3_HIGH_VOLUME_SUITE') throw new Error(`INVALID_MODE:${payload.mode}`);
if (payload.sampleCount !== suite.plannedSamples || payload.expectedSamples !== suite.plannedSamples) throw new Error('SAMPLE_COUNT_MISMATCH');
if (payload.complete !== true || result.verdict.suiteComplete !== true) throw new Error('INCOMPLETE_SUITE');
if (result.verdict.contractValidation !== 'PASS' || result.verdict.balanceQualification !== 'PENDING_STEP3_FINAL_JUDGE' || result.verdict.step3PromotionAllowed !== false || result.verdict.partialResultPromotion !== false) throw new Error('INVALID_RESULT_VERDICT');
if (payload.violations.length !== 0) throw new Error('NONEMPTY_SUITE_VIOLATIONS');
if (result.hashes.candidateSha256 !== sha256Text(candidateText) || result.hashes.runPlanSha256 !== sha256Text(planText) || result.hashes.executionContractSha256 !== sha256Text(executionText)) throw new Error('SOURCE_DIGEST_MISMATCH');
if (result.hashes.deterministicPayloadSha256 !== sha256Canonical(payload) || result.evidence.canonicalJsonSha256 !== result.hashes.deterministicPayloadSha256) throw new Error('PAYLOAD_DIGEST_MISMATCH');
const metricsWithoutDigest = {
  primary: metrics.primary,
  secondary: metrics.secondary,
  ...(metrics.tertiary !== undefined ? { tertiary: metrics.tertiary } : {}),
  ...(metrics.quaternary !== undefined ? { quaternary: metrics.quaternary } : {}),
  counters: metrics.counters,
};
if (metrics.suiteDigest !== sha256Canonical({ suiteId, ...metricsWithoutDigest })) throw new Error('SUITE_DIGEST_MISMATCH');

const criteria = [];
const findings = [];
function criterion(id, severity, pass, detail) {
  criteria.push({ id, severity, status: pass ? 'PASS' : 'FAIL', detail });
  if (!pass) findings.push({ id, severity, detail });
}

const samples = asBigInt(payload.sampleCount, 'sampleCount');
criterion('HV-COMMON-01', 'P0', payload.complete === true && payload.violations.length === 0 && result.verdict.contractValidation === 'PASS', { sampleCount: payload.sampleCount, complete: payload.complete, violationCount: String(payload.violations.length), contractValidation: result.verdict.contractValidation });
criterion('HV-DIGEST-01', 'P0', result.hashes.deterministicPayloadSha256 === result.evidence.canonicalJsonSha256 && metrics.suiteDigest === sha256Canonical({ suiteId, ...metricsWithoutDigest }), { deterministicPayloadSha256: result.hashes.deterministicPayloadSha256, canonicalJsonSha256: result.evidence.canonicalJsonSha256, suiteDigest: metrics.suiteDigest });

if (suiteId === 'gacha-tails') {
  const characterFirstUr = compareSummary(metrics.primary, '100', 'characterFirstUr');
  const characterFeatured = compareSummary(metrics.secondary, '200', 'characterFeatured');
  const weaponFirstUr = compareSummary(metrics.tertiary, '100', 'weaponFirstUr');
  const weaponFeatured = compareSummary(metrics.quaternary, '200', 'weaponFeatured');
  criterion('HV-GACHA-01', 'P0', characterFirstUr.pass && characterFeatured.pass && weaponFirstUr.pass && weaponFeatured.pass && counters.maximumDrawsToFeatured <= 200n && counters.boundaryViolations === 0n, { characterFirstUr, characterFeatured, weaponFirstUr, weaponFeatured, maximumDrawsToFeatured: counters.maximumDrawsToFeatured.toString(), boundaryViolations: counters.boundaryViolations.toString() });
  criterion('HV-GACHA-02', 'P0', counters.characterSamples === samples && counters.weaponSamples === samples && counters.characterFeaturedOutputs === samples && counters.weaponFeaturedOutputs === samples && counters.characterFeaturedItemMismatches === 0n && counters.weaponFeaturedItemMismatches === 0n && counters.characterNonFeaturedUrFeaturedViolations === 0n && counters.weaponNonFeaturedUrFeaturedViolations === 0n, { characterSamples: counters.characterSamples.toString(), weaponSamples: counters.weaponSamples.toString(), characterFeaturedOutputs: counters.characterFeaturedOutputs.toString(), weaponFeaturedOutputs: counters.weaponFeaturedOutputs.toString(), characterFeaturedItemMismatches: counters.characterFeaturedItemMismatches.toString(), weaponFeaturedItemMismatches: counters.weaponFeaturedItemMismatches.toString(), characterNonFeaturedUrFeaturedViolations: counters.characterNonFeaturedUrFeaturedViolations.toString(), weaponNonFeaturedUrFeaturedViolations: counters.weaponNonFeaturedUrFeaturedViolations.toString() });
  criterion('HV-GACHA-03', 'P1', counters.characterUniqueItemsSeen === counters.characterPoolItemCount && counters.weaponUniqueItemsSeen === counters.weaponPoolItemCount && counters.characterPoolItemCount === BigInt(candidate.characters.catalog.length) && counters.weaponPoolItemCount === BigInt(candidate.weapons.catalog.length), { characterUniqueItemsSeen: counters.characterUniqueItemsSeen.toString(), characterPoolItemCount: counters.characterPoolItemCount.toString(), weaponUniqueItemsSeen: counters.weaponUniqueItemsSeen.toString(), weaponPoolItemCount: counters.weaponPoolItemCount.toString() });
}

if (suiteId === 'pity-conformance') {
  criterion('HV-PITY-01', 'P0', counters.boundaryViolations === 0n && counters.hardBoundaryCases === counters.hardBoundaryPass && counters.featuredBoundaryCases === counters.featuredBoundaryPass, { hardBoundaryCases: counters.hardBoundaryCases.toString(), hardBoundaryPass: counters.hardBoundaryPass.toString(), featuredBoundaryCases: counters.featuredBoundaryCases.toString(), featuredBoundaryPass: counters.featuredBoundaryPass.toString(), earlyHardFalse: counters.earlyHardFalse.toString(), earlyFeaturedFalse: counters.earlyFeaturedFalse.toString(), boundaryViolations: counters.boundaryViolations.toString() });
  criterion('HV-PITY-02', 'P0', counters.hardBoundaryCases + counters.earlyHardFalse === samples && counters.featuredBoundaryCases + counters.earlyFeaturedFalse === samples, { samples: samples.toString(), hardCoverage: (counters.hardBoundaryCases + counters.earlyHardFalse).toString(), featuredCoverage: (counters.featuredBoundaryCases + counters.earlyFeaturedFalse).toString() });
}

if (suiteId === 'duplicate-skew-overflow') {
  const characterOverflow = metrics.secondary;
  const weaponOverflow = metrics.quaternary;
  criterion('HV-DUPLICATE-01', 'P0', counters.characterSamples === samples && counters.weaponSamples === samples && counters.characterFeaturedItemMismatches === 0n && counters.weaponFeaturedItemMismatches === 0n && counters.characterNonFeaturedUrFeaturedViolations === 0n && counters.weaponNonFeaturedUrFeaturedViolations === 0n, { characterSamples: counters.characterSamples.toString(), weaponSamples: counters.weaponSamples.toString(), characterFeaturedItemMismatches: counters.characterFeaturedItemMismatches.toString(), weaponFeaturedItemMismatches: counters.weaponFeaturedItemMismatches.toString(), characterNonFeaturedUrFeaturedViolations: counters.characterNonFeaturedUrFeaturedViolations.toString(), weaponNonFeaturedUrFeaturedViolations: counters.weaponNonFeaturedUrFeaturedViolations.toString() });
  criterion('HV-DUPLICATE-02', 'P0', counters.characterItemsAtFullMastery > 0n && counters.weaponItemsAtFullMastery > 0n && counters.characterItemsWithOverflow > 0n && counters.weaponItemsWithOverflow > 0n && counters.characterMaximumCopies > 20n && counters.weaponMaximumCopies > 20n && asBigInt(characterOverflow.maximum, 'characterOverflow.maximum') > 0n && asBigInt(weaponOverflow.maximum, 'weaponOverflow.maximum') > 0n, { characterItemsAtFullMastery: counters.characterItemsAtFullMastery.toString(), weaponItemsAtFullMastery: counters.weaponItemsAtFullMastery.toString(), characterItemsWithOverflow: counters.characterItemsWithOverflow.toString(), weaponItemsWithOverflow: counters.weaponItemsWithOverflow.toString(), characterMaximumCopies: counters.characterMaximumCopies.toString(), weaponMaximumCopies: counters.weaponMaximumCopies.toString(), characterOverflowMaximum: characterOverflow.maximum, weaponOverflowMaximum: weaponOverflow.maximum });
  criterion('HV-DUPLICATE-03', 'P1', counters.characterUniqueItemsSeen === counters.characterCatalogSize && counters.weaponUniqueItemsSeen === counters.weaponCatalogSize && counters.characterCatalogSize === BigInt(candidate.characters.catalog.length) && counters.weaponCatalogSize === BigInt(candidate.weapons.catalog.length), { characterUniqueItemsSeen: counters.characterUniqueItemsSeen.toString(), characterCatalogSize: counters.characterCatalogSize.toString(), weaponUniqueItemsSeen: counters.weaponUniqueItemsSeen.toString(), weaponCatalogSize: counters.weaponCatalogSize.toString() });
}

if (suiteId === 'refund-replay-race') {
  const valid = counters.validRefunds;
  criterion('HV-LEDGER-01', 'P0', valid + counters.invalidSpentRejected === samples && counters.idempotentReplayMatches === valid && counters.exactlyOnceReceiptMatches === valid && counters.outOfOrderRestoreMatches === valid && counters.acceptedVersionRetryMatches === valid && counters.freeLedgerDebitViolations === 0n, { samples: samples.toString(), validRefunds: valid.toString(), invalidSpentRejected: counters.invalidSpentRejected.toString(), idempotentReplayMatches: counters.idempotentReplayMatches.toString(), exactlyOnceReceiptMatches: counters.exactlyOnceReceiptMatches.toString(), outOfOrderRestoreMatches: counters.outOfOrderRestoreMatches.toString(), acceptedVersionRetryMatches: counters.acceptedVersionRetryMatches.toString(), freeLedgerDebitViolations: counters.freeLedgerDebitViolations.toString(), deficitStateCount: counters.deficitStateCount.toString() });
  criterion('HV-LEDGER-02', 'P1', counters.deficitStateCount > 0n, { deficitStateCount: counters.deficitStateCount.toString() });
}

if (suiteId === 'state-machine-model') {
  criterion('HV-STATE-01', 'P0', counters.validAccepted + counters.invalidRejected === samples && counters.unexpectedAccept === 0n && counters.unexpectedReject === 0n && counters.machineCount > 0n, { samples: samples.toString(), validAccepted: counters.validAccepted.toString(), invalidRejected: counters.invalidRejected.toString(), unexpectedAccept: counters.unexpectedAccept.toString(), unexpectedReject: counters.unexpectedReject.toString(), machineCount: counters.machineCount.toString() });
}

if (suiteId === 'large-number-properties') {
  criterion('HV-BIGNUM-01', 'P0', counters.canonicalIdPass === samples && counters.canonicalIdFail === 0n && counters.adjacentModifierRepeatViolations === 0n && counters.windowModifierRepeatViolations === 0n && counters.backgroundDistrictMismatches === 0n && counters.backgroundCycleMismatches === 0n, { samples: samples.toString(), canonicalIdPass: counters.canonicalIdPass.toString(), canonicalIdFail: counters.canonicalIdFail.toString(), adjacentModifierRepeatViolations: counters.adjacentModifierRepeatViolations.toString(), windowModifierRepeatViolations: counters.windowModifierRepeatViolations.toString(), backgroundDistrictMismatches: counters.backgroundDistrictMismatches.toString(), backgroundCycleMismatches: counters.backgroundCycleMismatches.toString() });
  criterion('HV-BIGNUM-02', 'P0', counters.symbolicRepresentations + counters.expandedRepresentations === samples && counters.maximumDigits >= 30n && counters.maximumDigits <= 149n && asBigInt(metrics.primary.minimum, 'floorDigits.minimum') >= 30n && asBigInt(metrics.primary.maximum, 'floorDigits.maximum') <= 149n, { symbolicRepresentations: counters.symbolicRepresentations.toString(), expandedRepresentations: counters.expandedRepresentations.toString(), maximumDigits: counters.maximumDigits.toString(), floorDigits: metrics.primary });
}

const unresolvedP0 = criteria.filter((entry) => entry.severity === 'P0' && entry.status === 'FAIL').length;
const unresolvedP1 = criteria.filter((entry) => entry.severity === 'P1' && entry.status === 'FAIL').length;
const audit = {
  schemaVersion: 1,
  artifactId: `cats-tower-step3-high-volume-${suiteId}-audit-v1`,
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  suiteId,
  result: {
    sourcePath: resultPath,
    fileBytes: String(resultBuffer.length),
    fileSha256: sha256Buffer(resultBuffer),
    deterministicPayloadSha256: result.hashes.deterministicPayloadSha256,
    suiteDigest: metrics.suiteDigest,
    sampleCount: payload.sampleCount,
    executedAt: result.evidence.executedAt,
  },
  percentiles: {
    primary: metrics.primary,
    secondary: metrics.secondary,
    ...(metrics.tertiary !== undefined ? { tertiary: metrics.tertiary } : {}),
    ...(metrics.quaternary !== undefined ? { quaternary: metrics.quaternary } : {}),
  },
  counters: metrics.counters,
  criteria,
  findings,
  unresolvedP0,
  unresolvedP1,
  verdict: unresolvedP0 === 0 && unresolvedP1 === 0 ? 'PASS_HIGH_VOLUME_SUITE_AUDIT' : 'FAIL_HIGH_VOLUME_SUITE_AUDIT',
};
await writeFile(resolve(outputPath), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ suiteId, verdict: audit.verdict, sampleCount: payload.sampleCount, unresolvedP0, unresolvedP1, output: outputPath }));
if (unresolvedP0 !== 0 || unresolvedP1 !== 0) process.exit(1);
