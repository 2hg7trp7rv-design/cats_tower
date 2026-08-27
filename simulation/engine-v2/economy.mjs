import { assertUnsigned, toBigInt, parseExactDecimal, add, compare, rational, roundRational, canonicalSigned } from './numeric.mjs';

export function sumProbabilities(entries) {
  return entries.reduce((total, entry) => add(total, parseExactDecimal(entry.probability, `probability:${entry.rarity}`)), rational(0n));
}

export function assertProbabilityTable(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.rarity)) throw new Error(`duplicate rarity ${entry.rarity}`);
    seen.add(entry.rarity);
    const value = parseExactDecimal(entry.probability);
    if (compare(value, rational(0n)) < 0 || compare(value, rational(1n)) > 0) throw new Error(`probability out of range ${entry.rarity}`);
  }
  if (compare(sumProbabilities(entries), rational(1n)) !== 0) throw new Error('probability table must sum exactly to 1');
}

export function pityOutcome({ drawsSinceUR, featuredProgress, naturalRarity = 'N', naturalFeatured = false, hardPity = '100', featuredGuarantee = '200' }) {
  const nextDraw = toBigInt(assertUnsigned(drawsSinceUR)) + 1n;
  const nextFeatured = toBigInt(assertUnsigned(featuredProgress)) + 1n;
  const forcedUR = nextDraw >= toBigInt(hardPity);
  const forcedFeatured = nextFeatured >= toBigInt(featuredGuarantee);
  const rarity = forcedUR || forcedFeatured ? 'UR' : naturalRarity;
  const featured = rarity === 'UR' && (forcedFeatured || naturalFeatured);
  return {
    rarity,
    featured,
    hardPityTriggered: forcedUR,
    featuredGuaranteeTriggered: forcedFeatured,
    nextDrawsSinceUR: rarity === 'UR' ? '0' : nextDraw.toString(),
    nextFeaturedProgress: featured ? '0' : nextFeatured.toString(),
  };
}

export function resetRubyQuote({ previousBest, newBest, firstEffectiveMinimum = '15' }) {
  const previous = toBigInt(assertUnsigned(previousBest));
  const next = toBigInt(assertUnsigned(newBest));
  if (next <= previous) return { eligible: false, reward: '0', reason: 'NO_NEW_RECORD' };
  if (next < 30n) return { eligible: false, reward: '0', reason: 'MINIMUM_NEW_BEST_NOT_REACHED' };
  const crossed = (next / 10n) - (previous / 10n);
  let reward = crossed * 3n + (next / 100n - previous / 100n) * 5n;
  if (previous === 0n && reward < toBigInt(firstEffectiveMinimum)) reward = toBigInt(firstEffectiveMinimum);
  return { eligible: true, reward: reward.toString(), reason: 'NEW_RECORD' };
}

export function evolutionEligibility(level, purchasedStages) {
  const l = toBigInt(assertUnsigned(level));
  const purchased = toBigInt(assertUnsigned(purchasedStages));
  const eligibleStages = l / 100n;
  return {
    level: l.toString(),
    purchasedStages: purchased.toString(),
    eligibleStages: eligibleStages.toString(),
    nextMissingStage: purchased < eligibleStages ? (purchased + 1n).toString() : 'NONE',
    levelContinuationBlocked: false,
  };
}

export function evolutionCost(candidate, stage) {
  const s = toBigInt(assertUnsigned(stage, 'stage', { positive: true }));
  const listed = candidate.evolution.costCurve.stageCosts;
  if (s <= BigInt(listed.length)) return listed[Number(s - 1n)];
  return (toBigInt(candidate.evolution.costCurve.afterListed.base) + (s - BigInt(listed.length)) * toBigInt(candidate.evolution.costCurve.afterListed.perStage)).toString();
}

export function masteryPowerBasisPoints(nodes, copies) {
  const c = toBigInt(assertUnsigned(copies));
  let value = 0n;
  for (const node of nodes) if (c >= toBigInt(node.additionalEffectiveCopies)) value = toBigInt(node.cumulativePowerBasisPoints);
  return value.toString();
}

export function masteryOverflow(track, copies) {
  const c = toBigInt(assertUnsigned(copies));
  const cap = toBigInt(track.fullMastery.minimumAdditionalEffectiveCopies);
  if (c <= cap) return { masteredCopies: c.toString(), overflowCopies: '0', overflowCredit: '0' };
  const overflow = c - cap;
  return { masteredCopies: cap.toString(), overflowCopies: overflow.toString(), overflowCredit: (overflow * toBigInt(track.overflow.conversionPerDuplicate)).toString() };
}

export function applyRubyDebit(wallet, amount, order) {
  let remaining = toBigInt(assertUnsigned(amount));
  const next = structuredClone(wallet);
  const debits = [];
  for (const ledger of order) {
    const available = toBigInt(assertUnsigned(next[ledger] ?? '0'));
    const debit = available < remaining ? available : remaining;
    next[ledger] = (available - debit).toString();
    debits.push({ ledger, amount: debit.toString() });
    remaining -= debit;
    if (remaining === 0n) break;
  }
  if (remaining !== 0n) throw new Error('INSUFFICIENT_RUBY');
  return { wallet: next, debits };
}

export function applyPaidRubyRefund({ paidBalance, affectedGrant, alreadySpent, transactionId, policyVersion }) {
  const balance = toBigInt(assertUnsigned(paidBalance));
  const grant = toBigInt(assertUnsigned(affectedGrant));
  const spent = toBigInt(assertUnsigned(alreadySpent));
  if (spent > grant) throw new RangeError('ALREADY_SPENT_EXCEEDS_AFFECTED_GRANT');
  const reversible = grant > spent ? grant - spent : 0n;
  const debit = reversible < balance ? reversible : balance;
  const deficit = grant - debit;
  return {
    paidBalance: (balance - debit).toString(),
    freeLedgersDebited: false,
    deficit: deficit === 0n ? canonicalSigned('zero', '0') : canonicalSigned('negative', deficit),
    state: deficit === 0n ? 'none' : 'paid-ruby-deficit',
    sourceTransactionId: transactionId,
    policyVersion,
    auditRequired: true,
  };
}

export function featuredGuaranteeDay(dailyProgress, guaranteeDraws = '200') {
  const daily = toBigInt(assertUnsigned(dailyProgress, 'dailyProgress', { positive: true }));
  const target = toBigInt(assertUnsigned(guaranteeDraws, 'guaranteeDraws', { positive: true }));
  return ((target + daily - 1n) / daily).toString();
}

export function accelerationRatio(multiplier) {
  return parseExactDecimal(multiplier);
}

export function scaledMinutes(baseMinutes, buildMultiplier, personaMultiplier, jitterBasisPoints) {
  const base = toBigInt(assertUnsigned(baseMinutes));
  const build = parseExactDecimal(buildMultiplier);
  const persona = parseExactDecimal(personaMultiplier);
  const jitter = rational(BigInt(jitterBasisPoints), 10000n);
  const denominator = add(rational(1n), jitter);
  const effective = { n: build.n * persona.n * denominator.n, d: build.d * persona.d * denominator.d };
  return roundRational({ n: base * effective.d, d: effective.n }, 'ceil').toString();
}
