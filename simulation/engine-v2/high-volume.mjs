#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { DeterministicRng } from './rng.mjs';
import { parseExactDecimal, normalizeUnsigned } from './numeric.mjs';
import { pityOutcome, masteryOverflow, applyPaidRubyRefund } from './economy.mjs';
import { idempotentResult, replaySequence, TRANSITIONS, exactlyOnceReceipt, acceptedVersionRetry } from './state-machines.mjs';
import { generateFloor, isCanonicalDistrictId, isCanonicalCycleId } from './tower.mjs';
import { UnsignedHistogram } from './statistics.mjs';
import { canonicalJson, sha256Canonical, sha256Text } from './hash.mjs';

const loadText = (path) => readFile(resolve(path), 'utf8');
const gcd = (left, right) => { let a = left < 0n ? -left : left; let b = right < 0n ? -right : right; while (b) [a, b] = [b, a % b]; return a; };
const lcm = (left, right) => left / gcd(left, right) * right;

function distribution(entries) {
  const rationals = entries.map((entry) => ({ value: entry.rarity, probability: parseExactDecimal(entry.probability, `probability:${entry.rarity}`) }));
  const denominator = rationals.reduce((current, entry) => lcm(current, entry.probability.d), 1n);
  const weighted = rationals.map((entry) => ({ value: entry.value, weight: entry.probability.n * (denominator / entry.probability.d) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0n);
  if (total !== denominator) throw new Error('HIGH_VOLUME_RATE_TABLE_NOT_EXACT_ONE');
  return { weighted, total };
}

function sampleDistribution(rng, table) {
  const draw = rng.nextBelow(table.total);
  let cumulative = 0n;
  for (const entry of table.weighted) {
    cumulative += entry.weight;
    if (draw < cumulative) return entry.value;
  }
  throw new Error('HIGH_VOLUME_DISTRIBUTION_UNREACHABLE');
}

function sampleProbability(rng, decimal) {
  const probability = parseExactDecimal(decimal, 'probability');
  return rng.nextBelow(probability.d) < probability.n;
}

function simulateGachaPool(candidate, samples, namespace, poolKind) {
  const tableId = poolKind === 'character' ? 'catalog.rate_table.character.v2' : 'catalog.rate_table.weapon.v2';
  const rateTable = candidate.gacha.rates.find((entry) => entry.id === tableId);
  if (!rateTable) throw new Error(`MISSING_GACHA_RATE_TABLE:${tableId}`);
  const table = distribution(rateTable.entries);
  const firstUr = new UnsignedHistogram();
  const firstFeatured = new UnsignedHistogram();
  const counters = { hardPityTriggered: 0n, featuredGuaranteeTriggered: 0n, featuredRollHits: 0n, maximumDrawsToFeatured: 0n, boundaryViolations: 0n };
  const hardPity = candidate.gacha.hardPity.draws;
  const featuredGuarantee = candidate.gacha.featuredGuarantee.draws;
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${poolKind}|${sample}`);
    let drawsSinceUR = '0';
    let featuredProgress = '0';
    let firstUrDraw = 0n;
    let featuredDraw = 0n;
    for (let draw = 1n; draw <= BigInt(featuredGuarantee); draw += 1n) {
      const naturalRarity = sampleDistribution(rng, table);
      const nextDraw = BigInt(drawsSinceUR) + 1n;
      const nextFeatured = BigInt(featuredProgress) + 1n;
      const willBeUR = naturalRarity === 'UR' || nextDraw >= BigInt(hardPity) || nextFeatured >= BigInt(featuredGuarantee);
      const featuredRollHit = willBeUR && nextFeatured < BigInt(featuredGuarantee) && sampleProbability(rng, candidate.gacha.featuredGuarantee.featuredShareWithinUR);
      const outcome = pityOutcome({ drawsSinceUR, featuredProgress, naturalRarity, featuredRollHit, hardPity, featuredGuarantee });
      if (outcome.hardPityTriggered) counters.hardPityTriggered += 1n;
      if (outcome.featuredGuaranteeTriggered) counters.featuredGuaranteeTriggered += 1n;
      if (featuredRollHit && outcome.featured) counters.featuredRollHits += 1n;
      if (outcome.rarity === 'UR' && firstUrDraw === 0n) firstUrDraw = draw;
      drawsSinceUR = outcome.nextDrawsSinceUR;
      featuredProgress = outcome.nextFeaturedProgress;
      if (outcome.featured) { featuredDraw = draw; break; }
    }
    if (firstUrDraw === 0n || firstUrDraw > BigInt(hardPity) || featuredDraw === 0n || featuredDraw > BigInt(featuredGuarantee)) counters.boundaryViolations += 1n;
    if (featuredDraw > counters.maximumDrawsToFeatured) counters.maximumDrawsToFeatured = featuredDraw;
    firstUr.add(firstUrDraw.toString());
    firstFeatured.add(featuredDraw.toString());
  }
  return { firstUr: firstUr.summary(), firstFeatured: firstFeatured.summary(), counters };
}

function gachaTails(candidate, _execution, samples, namespace) {
  const character = simulateGachaPool(candidate, samples, namespace, 'character');
  const weapon = simulateGachaPool(candidate, samples, namespace, 'weapon');
  return {
    primary: character.firstUr,
    secondary: character.firstFeatured,
    tertiary: weapon.firstUr,
    quaternary: weapon.firstFeatured,
    counters: {
      characterSamples: BigInt(samples),
      characterHardPityTriggered: character.counters.hardPityTriggered,
      characterFeaturedGuaranteeTriggered: character.counters.featuredGuaranteeTriggered,
      characterFeaturedRollHits: character.counters.featuredRollHits,
      characterMaximumDrawsToFeatured: character.counters.maximumDrawsToFeatured,
      weaponSamples: BigInt(samples),
      weaponHardPityTriggered: weapon.counters.hardPityTriggered,
      weaponFeaturedGuaranteeTriggered: weapon.counters.featuredGuaranteeTriggered,
      weaponFeaturedRollHits: weapon.counters.featuredRollHits,
      weaponMaximumDrawsToFeatured: weapon.counters.maximumDrawsToFeatured,
      maximumDrawsToFeatured: character.counters.maximumDrawsToFeatured > weapon.counters.maximumDrawsToFeatured ? character.counters.maximumDrawsToFeatured : weapon.counters.maximumDrawsToFeatured,
      boundaryViolations: character.counters.boundaryViolations + weapon.counters.boundaryViolations,
    },
  };
}

function pityConformance(candidate, _execution, samples, namespace) {
  const hardRemaining = new UnsignedHistogram();
  const featuredRemaining = new UnsignedHistogram();
  const counters = { hardBoundaryCases: 0n, hardBoundaryPass: 0n, featuredBoundaryCases: 0n, featuredBoundaryPass: 0n, earlyHardFalse: 0n, earlyFeaturedFalse: 0n, boundaryViolations: 0n };
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${sample}`);
    const drawsSinceUR = rng.nextBelow(100n);
    const featuredProgress = rng.nextBelow(200n);
    const outcome = pityOutcome({ drawsSinceUR: drawsSinceUR.toString(), featuredProgress: featuredProgress.toString(), naturalRarity: 'N', naturalFeatured: false, hardPity: candidate.gacha.hardPity.draws, featuredGuarantee: candidate.gacha.featuredGuarantee.draws });
    const hardBoundary = drawsSinceUR === 99n;
    const featuredBoundary = featuredProgress === 199n;
    if (hardBoundary) { counters.hardBoundaryCases += 1n; if (outcome.hardPityTriggered && outcome.rarity === 'UR') counters.hardBoundaryPass += 1n; else counters.boundaryViolations += 1n; }
    else if (!outcome.hardPityTriggered) counters.earlyHardFalse += 1n; else counters.boundaryViolations += 1n;
    if (featuredBoundary) { counters.featuredBoundaryCases += 1n; if (outcome.featuredGuaranteeTriggered && outcome.rarity === 'UR' && outcome.featured) counters.featuredBoundaryPass += 1n; else counters.boundaryViolations += 1n; }
    else if (!outcome.featuredGuaranteeTriggered) counters.earlyFeaturedFalse += 1n; else counters.boundaryViolations += 1n;
    hardRemaining.add((100n - drawsSinceUR).toString());
    featuredRemaining.add((200n - featuredProgress).toString());
  }
  const fixedHardFeatured = pityOutcome({ drawsSinceUR: '99', featuredProgress: '0', naturalRarity: 'N', featuredRollHit: true });
  const fixedHardNonFeatured = pityOutcome({ drawsSinceUR: '99', featuredProgress: '0', naturalRarity: 'N', featuredRollHit: false });
  const fixedFeatured = pityOutcome({ drawsSinceUR: '0', featuredProgress: '199', naturalRarity: 'N', featuredRollHit: false });
  if (!(fixedHardFeatured.hardPityTriggered && fixedHardFeatured.rarity === 'UR' && fixedHardFeatured.featured)) counters.boundaryViolations += 1n;
  if (!(fixedHardNonFeatured.hardPityTriggered && fixedHardNonFeatured.rarity === 'UR' && !fixedHardNonFeatured.featured)) counters.boundaryViolations += 1n;
  if (!(fixedFeatured.featuredGuaranteeTriggered && fixedFeatured.rarity === 'UR' && fixedFeatured.featured)) counters.boundaryViolations += 1n;
  return { primary: hardRemaining.summary(), secondary: featuredRemaining.summary(), counters };
}

function simulateDuplicateTrack(catalog, track, samples, namespace, kind) {
  const catalogSize = catalog.length;
  const copies = Array.from({ length: catalogSize }, () => 0n);
  const effectiveCopies = new UnsignedHistogram();
  const overflowCredit = new UnsignedHistogram();
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${kind}|${sample}`);
    const index = Number(rng.nextBelow(BigInt(catalogSize)));
    copies[index] += 1n;
    const additional = copies[index] > 0n ? copies[index] - 1n : 0n;
    const overflow = masteryOverflow(track, additional.toString());
    effectiveCopies.add(overflow.masteredCopies);
    overflowCredit.add(overflow.overflowCredit);
  }
  const full = BigInt(track.fullMastery.minimumAdditionalEffectiveCopies);
  return {
    mastered: effectiveCopies.summary(),
    overflow: overflowCredit.summary(),
    counters: {
      samples: BigInt(samples),
      catalogSize: BigInt(catalogSize),
      uniqueItemsSeen: BigInt(copies.filter((value) => value > 0n).length),
      itemsAtFullMastery: BigInt(copies.filter((value) => value > full).length),
      itemsWithOverflow: BigInt(copies.filter((value) => value - 1n > full).length),
      maximumCopies: copies.reduce((maximum, value) => value > maximum ? value : maximum, 0n),
    },
  };
}

function duplicateSkew(candidate, _execution, samples, namespace) {
  const character = simulateDuplicateTrack(candidate.characters.catalog, candidate.characterMastery, samples, namespace, 'character');
  const weapon = simulateDuplicateTrack(candidate.weapons.catalog, candidate.weaponMastery, samples, namespace, 'weapon');
  return {
    primary: character.mastered,
    secondary: character.overflow,
    tertiary: weapon.mastered,
    quaternary: weapon.overflow,
    counters: {
      characterSamples: character.counters.samples,
      characterCatalogSize: character.counters.catalogSize,
      characterUniqueItemsSeen: character.counters.uniqueItemsSeen,
      characterItemsAtFullMastery: character.counters.itemsAtFullMastery,
      characterItemsWithOverflow: character.counters.itemsWithOverflow,
      characterMaximumCopies: character.counters.maximumCopies,
      weaponSamples: weapon.counters.samples,
      weaponCatalogSize: weapon.counters.catalogSize,
      weaponUniqueItemsSeen: weapon.counters.uniqueItemsSeen,
      weaponItemsAtFullMastery: weapon.counters.itemsAtFullMastery,
      weaponItemsWithOverflow: weapon.counters.itemsWithOverflow,
      weaponMaximumCopies: weapon.counters.maximumCopies,
    },
  };
}

function refundReplay(samples, namespace) {
  const deficits = new UnsignedHistogram();
  const paidAfter = new UnsignedHistogram();
  const counters = { validRefunds: 0n, invalidSpentRejected: 0n, idempotentReplayMatches: 0n, exactlyOnceReceiptMatches: 0n, outOfOrderRestoreMatches: 0n, acceptedVersionRetryMatches: 0n, freeLedgerDebitViolations: 0n, deficitStateCount: 0n };
  const store = new Map();
  const receiptStore = new Map();
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${sample}`);
    const grant = rng.nextBelow(1000n) + 1n;
    const invalid = rng.nextBelow(10n) === 0n;
    const spent = invalid ? grant + rng.nextBelow(10n) + 1n : rng.nextBelow(grant + 1n);
    const balance = rng.nextBelow(grant + 501n);
    if (invalid) {
      try { applyPaidRubyRefund({ paidBalance: balance.toString(), affectedGrant: grant.toString(), alreadySpent: spent.toString(), transactionId: `tx-${sample}`, policyVersion: 'refund-deficit-v2' }); counters.freeLedgerDebitViolations += 1n; }
      catch (error) { if (error.message === 'ALREADY_SPENT_EXCEEDS_AFFECTED_GRANT') counters.invalidSpentRejected += 1n; else throw error; }
      deficits.add('0');
      paidAfter.add(balance.toString());
      continue;
    }
    const operation = () => applyPaidRubyRefund({ paidBalance: balance.toString(), affectedGrant: grant.toString(), alreadySpent: spent.toString(), transactionId: `tx-${sample}`, policyVersion: 'refund-deficit-v2' });
    const first = idempotentResult(store, `refund-${sample}`, operation);
    const replay = idempotentResult(store, `refund-${sample}`, operation);
    counters.validRefunds += 1n;
    if (replay.replayed && JSON.stringify(first.result) === JSON.stringify(replay.result)) counters.idempotentReplayMatches += 1n;
    const receiptFirst = exactlyOnceReceipt(receiptStore, `receipt-${sample}`, first.result);
    const receiptReplay = exactlyOnceReceipt(receiptStore, `receipt-${sample}`, { forbidden: true });
    if (!receiptFirst.duplicate && receiptReplay.duplicate && JSON.stringify(receiptReplay.grant) === JSON.stringify(first.result)) counters.exactlyOnceReceiptMatches += 1n;
    const sequence = sample % 2 === 0
      ? ['STORE_PURCHASED', 'REFUNDED', 'RESTORED']
      : ['STORE_PURCHASED', 'REVOKED', 'RESTORED'];
    if (replaySequence('transition.payment.v2', sequence).finalState === 'RESTORED') counters.outOfOrderRestoreMatches += 1n;
    const version = acceptedVersionRetry({ acceptedVersion: 'catalog.v1', currentVersion: 'catalog.v2', accepted: true });
    if (version.outcome === 'RECONCILE_ACCEPTED_VERSION' && version.version === 'catalog.v1') counters.acceptedVersionRetryMatches += 1n;
    if (first.result.freeLedgersDebited) counters.freeLedgerDebitViolations += 1n;
    if (first.result.state === 'paid-ruby-deficit') counters.deficitStateCount += 1n;
    deficits.add(first.result.deficit.magnitude);
    paidAfter.add(first.result.paidBalance);
  }
  return { primary: deficits.summary(), secondary: paidAfter.summary(), counters };
}

function stateMachineModel(samples, namespace) {
  const sequenceLength = new UnsignedHistogram();
  const accepted = new UnsignedHistogram();
  const machineIds = Object.keys(TRANSITIONS);
  const counters = { validAccepted: 0n, invalidRejected: 0n, unexpectedAccept: 0n, unexpectedReject: 0n, machineCount: BigInt(machineIds.length) };
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${sample}`);
    const machineId = rng.choose(machineIds);
    const fromStates = Object.keys(TRANSITIONS[machineId]);
    const from = rng.choose(fromStates);
    const valid = rng.nextBelow(2n) === 0n;
    const to = valid ? rng.choose(TRANSITIONS[machineId][from]) : '__INVALID_STATE__';
    let passed = false;
    try { replaySequence(machineId, [from, to]); passed = true; } catch { passed = false; }
    if (valid && passed) counters.validAccepted += 1n;
    else if (valid) counters.unexpectedReject += 1n;
    else if (!passed) counters.invalidRejected += 1n;
    else counters.unexpectedAccept += 1n;
    sequenceLength.add('2');
    accepted.add(passed ? '1' : '0');
  }
  return { primary: sequenceLength.summary(), secondary: accepted.summary(), counters };
}

function largeNumberProperties(candidate, samples, namespace) {
  const floorDigits = new UnsignedHistogram();
  const districtDigits = new UnsignedHistogram();
  const counters = { symbolicRepresentations: 0n, expandedRepresentations: 0n, canonicalIdPass: 0n, canonicalIdFail: 0n, maximumDigits: 0n };
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${sample}`);
    const length = Number(rng.nextBelow(120n)) + 30;
    let floor = String(rng.nextBelow(9n) + 1n);
    for (let index = 1; index < length; index += 1) floor += String(rng.nextBelow(10n));
    const generated = generateFloor(candidate, floor);
    if (generated.hp.representation === 'exact-symbolic-power') counters.symbolicRepresentations += 1n; else counters.expandedRepresentations += 1n;
    if (isCanonicalDistrictId(generated.districtId) && isCanonicalCycleId(generated.cycleId)) counters.canonicalIdPass += 1n; else counters.canonicalIdFail += 1n;
    const digits = BigInt(floor.length);
    if (digits > counters.maximumDigits) counters.maximumDigits = digits;
    floorDigits.add(digits.toString());
    districtDigits.add(generated.district.length.toString());
  }
  return { primary: floorDigits.summary(), secondary: districtDigits.summary(), counters };
}

const SUITES = {
  'gacha-tails': gachaTails,
  'pity-conformance': pityConformance,
  'duplicate-skew-overflow': duplicateSkew,
  'refund-replay-race': (_candidate, _execution, samples, namespace) => refundReplay(samples, namespace),
  'state-machine-model': (_candidate, _execution, samples, namespace) => stateMachineModel(samples, namespace),
  'large-number-properties': (candidate, _execution, samples, namespace) => largeNumberProperties(candidate, samples, namespace),
};

export async function runHighVolumeSuite({ suiteId, contractSmoke = false, owner = 'STEP2' } = {}) {
  const [candidateText, planText, executionText] = await Promise.all([loadText('simulation/candidate-v2.json'), loadText('simulation/run-plan-v2.json'), loadText('simulation/execution-contract-v2.json')]);
  const candidate = JSON.parse(candidateText);
  const execution = JSON.parse(executionText);
  const suite = execution.highVolumeSuites.find((entry) => entry.id === suiteId);
  if (!suite || !SUITES[suiteId]) throw new Error(`UNKNOWN_HIGH_VOLUME_SUITE:${suiteId}`);
  const implementationVersion = suite.implementationVersion.match(/-(v[0-9]+)$/)?.[1];
  if (!implementationVersion) throw new Error(`INVALID_HIGH_VOLUME_IMPLEMENTATION_VERSION:${suite.implementationVersion}`);
  if (!contractSmoke && (owner !== 'STEP3' || process.env.CT_STEP3_AUTHORIZED !== '1')) throw new Error('STEP3_HIGH_VOLUME_EXECUTION_NOT_AUTHORIZED');
  const expectedSamples = contractSmoke ? suite.contractSmokeSamples : suite.plannedSamples;
  const sampleCount = Number(expectedSamples);
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) throw new Error('HIGH_VOLUME_SAMPLE_COUNT_UNSAFE');
  const namespace = `cats-tower-v2-high-volume|${suiteId}`;
  const rawMetrics = SUITES[suiteId](candidate, execution, sampleCount, namespace);
  const counters = Object.fromEntries(Object.entries(rawMetrics.counters).map(([key, value]) => [key, normalizeUnsigned(value)]));
  const metricsWithoutDigest = {
    primary: rawMetrics.primary,
    secondary: rawMetrics.secondary,
    ...(rawMetrics.tertiary ? { tertiary: rawMetrics.tertiary } : {}),
    ...(rawMetrics.quaternary ? { quaternary: rawMetrics.quaternary } : {}),
    counters,
  };
  const metrics = { ...metricsWithoutDigest, suiteDigest: sha256Canonical({ suiteId, ...metricsWithoutDigest }) };
  const violations = [];
  if (counters.boundaryViolations && counters.boundaryViolations !== '0') violations.push({ code: 'PITY_BOUNDARY', count: counters.boundaryViolations });
  if (counters.freeLedgerDebitViolations && counters.freeLedgerDebitViolations !== '0') violations.push({ code: 'FREE_LEDGER_DEBIT', count: counters.freeLedgerDebitViolations });
  if (counters.unexpectedAccept && counters.unexpectedAccept !== '0') violations.push({ code: 'INVALID_TRANSITION_ACCEPTED', count: counters.unexpectedAccept });
  if (counters.unexpectedReject && counters.unexpectedReject !== '0') violations.push({ code: 'VALID_TRANSITION_REJECTED', count: counters.unexpectedReject });
  if (counters.canonicalIdFail && counters.canonicalIdFail !== '0') violations.push({ code: 'NON_CANONICAL_GENERATED_ID', count: counters.canonicalIdFail });
  const mode = contractSmoke ? 'STEP2_STEP3_CONTRACT_SMOKE' : 'STEP3_HIGH_VOLUME_SUITE';
  const deterministicPayload = {
    mode,
    suiteId,
    metricContract: `${suiteId}-metrics-${implementationVersion}`,
    candidateId: candidate.meta.candidateId,
    scenarioAlgorithmVersion: execution.scenarioAlgorithmVersion,
    executionVersion: execution.executionVersion,
    roundingVersion: execution.roundingVersion,
    seedNamespace: namespace,
    expectedSamples,
    sampleCount: expectedSamples,
    complete: !contractSmoke,
    metrics,
    violations,
  };
  const prefix = contractSmoke ? 'cats-tower-step2-contract-smoke' : 'cats-tower-step3';
  const reproductionCommand = contractSmoke
    ? `node simulation/engine-v2/high-volume.mjs --mode contract-smoke --suite ${suiteId} --output <path>`
    : `CT_STEP3_AUTHORIZED=1 node simulation/engine-v2/high-volume.mjs --mode full --owner STEP3 --suite ${suiteId} --output <path>`;
  return {
    schemaVersion: '2.1.0',
    resultId: `${prefix}-high-volume-${suiteId}-001`,
    deterministicPayload,
    hashes: { candidateSha256: sha256Text(candidateText), runPlanSha256: sha256Text(planText), executionContractSha256: sha256Text(executionText), deterministicPayloadSha256: sha256Canonical(deterministicPayload) },
    evidence: { runtimeVersion: process.version, executedAt: new Date().toISOString(), reproductionCommand, canonicalJsonSha256: sha256Text(canonicalJson(deterministicPayload)) },
    verdict: { contractValidation: violations.length ? 'FAIL' : 'PASS', balanceQualification: contractSmoke ? 'NOT_EVALUATED_CONTRACT_SMOKE' : 'PENDING_STEP3_FINAL_JUDGE', suiteComplete: !contractSmoke, step3PromotionAllowed: false, partialResultPromotion: false },
  };
}

function arg(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = arg('--mode', 'contract-smoke');
  if (!['contract-smoke','full'].includes(mode)) throw new Error(`UNKNOWN_HIGH_VOLUME_MODE:${mode}`);
  const suiteId = arg('--suite');
  const output = arg('--output');
  if (!suiteId || !output) throw new Error('--suite and --output are required');
  const result = await runHighVolumeSuite({ suiteId, contractSmoke: mode === 'contract-smoke', owner: arg('--owner', 'STEP2') });
  await writeFile(resolve(output), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: result.verdict.contractValidation === 'PASS', mode, suiteId, sampleCount: result.deterministicPayload.sampleCount, output, digest: result.hashes.deterministicPayloadSha256 }));
  if (result.verdict.contractValidation !== 'PASS') process.exit(1);
}
