#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { DeterministicRng } from './rng.mjs';
import { parseExactDecimal, normalizeUnsigned } from './numeric.mjs';
import { pityOutcome, masteryOverflow, applyPaidRubyRefund } from './economy.mjs';
import { idempotentResult, replaySequence, TRANSITIONS, exactlyOnceReceipt, acceptedVersionRetry } from './state-machines.mjs';
import { generateFloor, isCanonicalDistrictId, isCanonicalCycleId, auditModifierSequence } from './tower.mjs';
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

const RARITIES = ['N','R','RR','SR','SSR','UR'];

function gachaItemContext(candidate, execution, kind) {
  const selection = execution.model?.gachaItemSelection?.[kind];
  if (!selection) throw new Error(`MISSING_GACHA_ITEM_SELECTION:${kind}`);
  const catalog = (kind === 'character' ? candidate.characters.catalog : candidate.weapons.catalog).slice().sort((left, right) => left.id.localeCompare(right.id));
  const banners = kind === 'character' ? candidate.gacha.characterPools : candidate.gacha.weaponPools;
  const standardBanner = banners.find((entry) => entry.id === selection.standardBannerId);
  const featuredBanner = banners.find((entry) => entry.id === selection.featuredBannerId);
  const featuredItem = catalog.find((entry) => entry.id === selection.featuredItemId);
  if (!standardBanner || !featuredBanner || standardBanner.kind !== kind || featuredBanner.kind !== kind) throw new Error(`INVALID_GACHA_BANNER_BINDING:${kind}`);
  if (!featuredItem || featuredItem.baseRarity !== 'UR') throw new Error(`INVALID_GACHA_FEATURED_ITEM:${kind}`);
  const rateTable = candidate.gacha.rates.find((entry) => entry.id === featuredBanner.rateTable);
  if (!rateTable) throw new Error(`MISSING_GACHA_RATE_TABLE:${featuredBanner.rateTable}`);
  const byRarity = new Map(RARITIES.map((rarity) => [rarity, catalog.filter((entry) => entry.baseRarity === rarity)]));
  for (const rarity of rateTable.entries.map((entry) => entry.rarity)) {
    if ((byRarity.get(rarity) ?? []).length === 0) throw new Error(`EMPTY_GACHA_RARITY_POOL:${kind}:${rarity}`);
  }
  if (selection.nonFeaturedUrExcludesFeatured !== undefined) throw new Error(`UNEXPECTED_KIND_LEVEL_SELECTION_POLICY:${kind}`);
  const nonFeaturedUr = (byRarity.get('UR') ?? []).filter((entry) => entry.id !== featuredItem.id);
  if (execution.model.gachaItemSelection.nonFeaturedUrExcludesFeatured && nonFeaturedUr.length === 0) throw new Error(`EMPTY_NONFEATURED_UR_POOL:${kind}`);
  return {
    kind,
    selection,
    catalog,
    byRarity,
    featuredItem,
    featuredBanner,
    rateTable,
    rateDistribution: distribution(rateTable.entries),
  };
}

function selectGachaItem(rng, execution, context, rarity, featured) {
  if (featured) {
    if (rarity !== 'UR') throw new Error(`FEATURED_NON_UR_RESULT:${context.kind}:${rarity}`);
    return context.featuredItem;
  }
  let pool = context.byRarity.get(rarity) ?? [];
  if (rarity === 'UR' && execution.model.gachaItemSelection.nonFeaturedUrExcludesFeatured) pool = pool.filter((entry) => entry.id !== context.featuredItem.id);
  if (pool.length === 0) throw new Error(`EMPTY_GACHA_ITEM_POOL:${context.kind}:${rarity}:${featured}`);
  return pool[Number(rng.nextBelow(BigInt(pool.length)))];
}

function drawGachaItem(candidate, execution, context, rng, drawsSinceUR, featuredProgress) {
  const naturalRarity = sampleDistribution(rng, context.rateDistribution);
  const nextDraw = BigInt(drawsSinceUR) + 1n;
  const nextFeatured = BigInt(featuredProgress) + 1n;
  const willBeUR = naturalRarity === 'UR' || nextDraw >= BigInt(candidate.gacha.hardPity.draws) || nextFeatured >= BigInt(candidate.gacha.featuredGuarantee.draws);
  const featuredRollHit = willBeUR && nextFeatured < BigInt(candidate.gacha.featuredGuarantee.draws) && sampleProbability(rng, candidate.gacha.featuredGuarantee.featuredShareWithinUR);
  const outcome = pityOutcome({
    drawsSinceUR,
    featuredProgress,
    naturalRarity,
    featuredRollHit,
    hardPity: candidate.gacha.hardPity.draws,
    featuredGuarantee: candidate.gacha.featuredGuarantee.draws,
  });
  const item = selectGachaItem(rng, execution, context, outcome.rarity, outcome.featured);
  return { naturalRarity, featuredRollHit, outcome, item };
}

function zeroRarityCounts() {
  return Object.fromEntries(RARITIES.map((rarity) => [rarity, 0n]));
}

function simulateGachaPool(candidate, execution, samples, namespace, poolKind) {
  const context = gachaItemContext(candidate, execution, poolKind);
  const firstUr = new UnsignedHistogram();
  const firstFeatured = new UnsignedHistogram();
  const seen = new Set();
  const rarityCounts = zeroRarityCounts();
  const counters = {
    totalDraws: 0n,
    featuredOutputs: 0n,
    featuredItemMismatches: 0n,
    nonFeaturedUrFeaturedViolations: 0n,
    hardPityTriggered: 0n,
    featuredGuaranteeTriggered: 0n,
    featuredRollHits: 0n,
    maximumDrawsToFeatured: 0n,
    boundaryViolations: 0n,
  };
  const hardPity = candidate.gacha.hardPity.draws;
  const featuredGuarantee = candidate.gacha.featuredGuarantee.draws;
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${poolKind}|${sample}`);
    let drawsSinceUR = '0';
    let featuredProgress = '0';
    let firstUrDraw = 0n;
    let featuredDraw = 0n;
    for (let draw = 1n; draw <= BigInt(featuredGuarantee); draw += 1n) {
      const result = drawGachaItem(candidate, execution, context, rng, drawsSinceUR, featuredProgress);
      const { outcome, item, featuredRollHit } = result;
      counters.totalDraws += 1n;
      rarityCounts[outcome.rarity] += 1n;
      seen.add(item.id);
      if (outcome.hardPityTriggered) counters.hardPityTriggered += 1n;
      if (outcome.featuredGuaranteeTriggered) counters.featuredGuaranteeTriggered += 1n;
      if (featuredRollHit && outcome.featured) counters.featuredRollHits += 1n;
      if (outcome.featured) {
        counters.featuredOutputs += 1n;
        if (item.id !== context.featuredItem.id) counters.featuredItemMismatches += 1n;
      }
      if (outcome.rarity === 'UR' && !outcome.featured && item.id === context.featuredItem.id) counters.nonFeaturedUrFeaturedViolations += 1n;
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
  return { context, firstUr: firstUr.summary(), firstFeatured: firstFeatured.summary(), seen, rarityCounts, counters };
}

function gachaPoolCounters(prefix, result, samples) {
  return {
    [`${prefix}Samples`]: BigInt(samples),
    [`${prefix}PoolItemCount`]: BigInt(result.context.catalog.length),
    [`${prefix}TotalDraws`]: result.counters.totalDraws,
    [`${prefix}UniqueItemsSeen`]: BigInt(result.seen.size),
    [`${prefix}FeaturedOutputs`]: result.counters.featuredOutputs,
    [`${prefix}FeaturedItemMismatches`]: result.counters.featuredItemMismatches,
    [`${prefix}NonFeaturedUrFeaturedViolations`]: result.counters.nonFeaturedUrFeaturedViolations,
    [`${prefix}HardPityTriggered`]: result.counters.hardPityTriggered,
    [`${prefix}FeaturedGuaranteeTriggered`]: result.counters.featuredGuaranteeTriggered,
    [`${prefix}FeaturedRollHits`]: result.counters.featuredRollHits,
    [`${prefix}MaximumDrawsToFeatured`]: result.counters.maximumDrawsToFeatured,
    [`${prefix}RarityNDraws`]: result.rarityCounts.N,
    [`${prefix}RarityRDraws`]: result.rarityCounts.R,
    [`${prefix}RarityRRDraws`]: result.rarityCounts.RR,
    [`${prefix}RaritySRDraws`]: result.rarityCounts.SR,
    [`${prefix}RaritySSRDraws`]: result.rarityCounts.SSR,
    [`${prefix}RarityURDraws`]: result.rarityCounts.UR,
  };
}

function gachaTails(candidate, execution, samples, namespace) {
  const character = simulateGachaPool(candidate, execution, samples, namespace, 'character');
  const weapon = simulateGachaPool(candidate, execution, samples, namespace, 'weapon');
  return {
    primary: character.firstUr,
    secondary: character.firstFeatured,
    tertiary: weapon.firstUr,
    quaternary: weapon.firstFeatured,
    counters: {
      ...gachaPoolCounters('character', character, samples),
      ...gachaPoolCounters('weapon', weapon, samples),
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

function simulateDuplicateTrack(candidate, execution, track, samples, namespace, kind) {
  const context = gachaItemContext(candidate, execution, kind);
  const copies = new Map(context.catalog.map((entry) => [entry.id, 0n]));
  const effectiveCopies = new UnsignedHistogram();
  const overflowCredit = new UnsignedHistogram();
  const rarityCounts = zeroRarityCounts();
  let drawsSinceUR = '0';
  let featuredProgress = '0';
  let featuredCopies = 0n;
  let featuredItemMismatches = 0n;
  let nonFeaturedUrFeaturedViolations = 0n;
  let hardPityTriggered = 0n;
  let featuredGuaranteeTriggered = 0n;
  let featuredRollHits = 0n;
  const rng = new DeterministicRng(`${namespace}|${kind}|draw-stream`);
  for (let sample = 0; sample < samples; sample += 1) {
    const result = drawGachaItem(candidate, execution, context, rng, drawsSinceUR, featuredProgress);
    const { outcome, item, featuredRollHit } = result;
    rarityCounts[outcome.rarity] += 1n;
    if (outcome.hardPityTriggered) hardPityTriggered += 1n;
    if (outcome.featuredGuaranteeTriggered) featuredGuaranteeTriggered += 1n;
    if (featuredRollHit && outcome.featured) featuredRollHits += 1n;
    if (outcome.featured) {
      featuredCopies += 1n;
      if (item.id !== context.featuredItem.id) featuredItemMismatches += 1n;
    }
    if (outcome.rarity === 'UR' && !outcome.featured && item.id === context.featuredItem.id) nonFeaturedUrFeaturedViolations += 1n;
    drawsSinceUR = outcome.nextDrawsSinceUR;
    featuredProgress = outcome.nextFeaturedProgress;
    const nextCopies = (copies.get(item.id) ?? 0n) + 1n;
    copies.set(item.id, nextCopies);
    const overflow = masteryOverflow(track, (nextCopies - 1n).toString());
    effectiveCopies.add(overflow.masteredCopies);
    overflowCredit.add(overflow.overflowCredit);
  }
  const full = BigInt(track.fullMastery.minimumAdditionalEffectiveCopies);
  return {
    context,
    mastered: effectiveCopies.summary(),
    overflow: overflowCredit.summary(),
    rarityCounts,
    counters: {
      samples: BigInt(samples),
      catalogSize: BigInt(context.catalog.length),
      poolItemCount: BigInt(context.catalog.length),
      uniqueItemsSeen: BigInt([...copies.values()].filter((value) => value > 0n).length),
      itemsAtFullMastery: BigInt([...copies.values()].filter((value) => value > full).length),
      itemsWithOverflow: BigInt([...copies.values()].filter((value) => value - 1n > full).length),
      maximumCopies: [...copies.values()].reduce((maximum, value) => value > maximum ? value : maximum, 0n),
      featuredCopies,
      featuredItemMismatches,
      nonFeaturedUrFeaturedViolations,
      hardPityTriggered,
      featuredGuaranteeTriggered,
      featuredRollHits,
    },
  };
}

function duplicateTrackCounters(prefix, result) {
  return {
    [`${prefix}Samples`]: result.counters.samples,
    [`${prefix}CatalogSize`]: result.counters.catalogSize,
    [`${prefix}PoolItemCount`]: result.counters.poolItemCount,
    [`${prefix}UniqueItemsSeen`]: result.counters.uniqueItemsSeen,
    [`${prefix}ItemsAtFullMastery`]: result.counters.itemsAtFullMastery,
    [`${prefix}ItemsWithOverflow`]: result.counters.itemsWithOverflow,
    [`${prefix}MaximumCopies`]: result.counters.maximumCopies,
    [`${prefix}FeaturedCopies`]: result.counters.featuredCopies,
    [`${prefix}FeaturedItemMismatches`]: result.counters.featuredItemMismatches,
    [`${prefix}NonFeaturedUrFeaturedViolations`]: result.counters.nonFeaturedUrFeaturedViolations,
    [`${prefix}HardPityTriggered`]: result.counters.hardPityTriggered,
    [`${prefix}FeaturedGuaranteeTriggered`]: result.counters.featuredGuaranteeTriggered,
    [`${prefix}FeaturedRollHits`]: result.counters.featuredRollHits,
    [`${prefix}RarityNDraws`]: result.rarityCounts.N,
    [`${prefix}RarityRDraws`]: result.rarityCounts.R,
    [`${prefix}RarityRRDraws`]: result.rarityCounts.RR,
    [`${prefix}RaritySRDraws`]: result.rarityCounts.SR,
    [`${prefix}RaritySSRDraws`]: result.rarityCounts.SSR,
    [`${prefix}RarityURDraws`]: result.rarityCounts.UR,
  };
}

function duplicateSkew(candidate, execution, samples, namespace) {
  const character = simulateDuplicateTrack(candidate, execution, candidate.characterMastery, samples, namespace, 'character');
  const weapon = simulateDuplicateTrack(candidate, execution, candidate.weaponMastery, samples, namespace, 'weapon');
  return {
    primary: character.mastered,
    secondary: character.overflow,
    tertiary: weapon.mastered,
    quaternary: weapon.overflow,
    counters: {
      ...duplicateTrackCounters('character', character),
      ...duplicateTrackCounters('weapon', weapon),
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
  const counters = { symbolicRepresentations: 0n, expandedRepresentations: 0n, canonicalIdPass: 0n, canonicalIdFail: 0n, adjacentModifierRepeatViolations: 0n, windowModifierRepeatViolations: 0n, backgroundDistrictMismatches: 0n, backgroundCycleMismatches: 0n, maximumDigits: 0n };
  for (let sample = 0; sample < samples; sample += 1) {
    const rng = new DeterministicRng(`${namespace}|${sample}`);
    const length = Number(rng.nextBelow(120n)) + 30;
    let floor = String(rng.nextBelow(9n) + 1n);
    for (let index = 1; index < length; index += 1) floor += String(rng.nextBelow(10n));
    const generated = generateFloor(candidate, floor);
    if (generated.hp.representation === 'exact-symbolic-power') counters.symbolicRepresentations += 1n; else counters.expandedRepresentations += 1n;
    if (isCanonicalDistrictId(generated.districtId) && isCanonicalCycleId(generated.cycleId)) counters.canonicalIdPass += 1n; else counters.canonicalIdFail += 1n;
    const audit = auditModifierSequence(candidate, floor, candidate.tower.modifierPools.windowSize);
    if (BigInt(audit.adjacentRepeatMaximumObserved) > BigInt(audit.adjacentRepeatMaximumConfigured)) counters.adjacentModifierRepeatViolations += 1n;
    if (BigInt(audit.windowRepeatMaximumObserved) > BigInt(audit.windowRepeatMaximumConfigured)) counters.windowModifierRepeatViolations += 1n;
    const f = BigInt(floor);
    const expectedDistrict = ((f - 1n) / BigInt(candidate.tower.backgroundCadence.districtChangeEveryFloors) + 1n).toString();
    const expectedCycle = ((f - 1n) / BigInt(candidate.tower.backgroundCadence.majorThemeCycleEveryFloors) + 1n).toString();
    if (generated.background.districtThemeIndex !== expectedDistrict) counters.backgroundDistrictMismatches += 1n;
    if (generated.background.majorThemeCycleIndex !== expectedCycle) counters.backgroundCycleMismatches += 1n;
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
