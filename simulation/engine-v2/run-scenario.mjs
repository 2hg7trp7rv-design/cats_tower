import { DeterministicRng } from './rng.mjs';
import { generateFloor } from './tower.mjs';
import { featuredGuaranteeDay, resetRubyQuote, evolutionCost, masteryOverflow } from './economy.mjs';
import { parseExactDecimal, rational, roundRational, toBigInt } from './numeric.mjs';
import { sha256Canonical } from './hash.mjs';

function clampMinimum(value, minimum) {
  const parsed = toBigInt(value);
  const floor = toBigInt(minimum);
  return (parsed < floor ? floor : parsed).toString();
}

function randomSignedInclusive(rng, minimum, maximum) {
  const min = BigInt(minimum);
  const max = BigInt(maximum);
  if (min > max) throw new RangeError('SIGNED_RANGE_REVERSED');
  return min + rng.nextBelow(max - min + 1n);
}

function divideByMultipliers(base, buildMultiplier, personaMultiplier, jitterBasisPoints, minimumMinutes) {
  const build = parseExactDecimal(buildMultiplier);
  const persona = parseExactDecimal(personaMultiplier);
  const jitter = rational(10000n + BigInt(jitterBasisPoints), 10000n);
  if (jitter.n <= 0n) throw new RangeError('NON_POSITIVE_PROGRESSION_JITTER');
  const effective = { n: build.n * persona.n * jitter.n, d: build.d * persona.d * jitter.d };
  const minutes = roundRational({ n: toBigInt(base) * effective.d, d: effective.n }, 'ceil').toString();
  return clampMinimum(minutes, minimumMinutes);
}

function horizonMetrics(candidate, execution, build, persona, rng, horizon) {
  const progression = execution.model.progression;
  const jitter = randomSignedInclusive(rng, progression.jitterMinimumBasisPoints, progression.jitterMaximumBasisPoints);
  const target = horizon.targetFloor;
  const generated = generateFloor(candidate, target);
  const baseline = progression.baselineMinutesByHorizon[horizon.id];
  if (!baseline) throw new Error(`MISSING_HORIZON_BASELINE:${horizon.id}`);
  const metrics = {
    horizonId: horizon.id,
    targetFloor: target,
    estimatedReachMinutes: divideByMultipliers(baseline, build.powerMultiplier, persona.progressMultiplier, jitter, progression.minimumMinutes),
    targetFloorDigest: sha256Canonical(generated),
    targetFloorRepresentation: generated.hp.representation,
    districtId: generated.districtId,
    cycleId: generated.cycleId,
    bossId: generated.boss.id,
  };
  if (horizon.mode === 'five-resets') {
    const repeated = execution.model.repeatedReset;
    const reclear = parseExactDecimal(build.reclearMultiplier);
    const sequence = [];
    let current = BigInt(execution.model.firstReset.personaBaseMinutes[persona.id]);
    for (let index = 0; index < Number(repeated.runCount); index += 1) {
      sequence.push(clampMinimum(current.toString(), repeated.minimumMinutes));
      current = roundRational({ n: current * reclear.d, d: reclear.n }, 'ceil');
      if (current < BigInt(repeated.minimumMinutes)) current = BigInt(repeated.minimumMinutes);
    }
    metrics.resetMinutes = sequence;
  }
  if (horizon.mode === 'economy-45d') {
    metrics.featuredGuaranteeDay = featuredGuaranteeDay(persona.dailyFeaturedProgress, candidate.gacha.featuredGuarantee.draws);
    metrics.characterDraws45d = (toBigInt(persona.dailyCharacterDraws) * 45n).toString();
    metrics.weaponDraws45d = (toBigInt(persona.dailyWeaponDraws) * 45n).toString();
  }
  return metrics;
}

export function runScenario(candidate, plan, execution, { buildId, personaId, namespace, partition, seed, ordinal }) {
  const build = candidate.builds.find((entry) => entry.id === buildId);
  const persona = candidate.personas.find((entry) => entry.id === personaId);
  if (!build || !persona) throw new Error('UNKNOWN_BUILD_OR_PERSONA');
  if (!namespace || !partition) throw new Error('SCENARIO_NAMESPACE_AND_PARTITION_REQUIRED');
  const rng = new DeterministicRng(seed);
  const resetModel = execution.model.firstReset;
  const resetJitter = randomSignedInclusive(rng, resetModel.jitterMinimumMinutes, resetModel.jitterMaximumMinutes);
  const firstResetRaw = BigInt(resetModel.personaBaseMinutes[persona.id]) + BigInt(resetModel.buildAdjustmentMinutes[build.id]) + resetJitter;
  const firstResetMinutes = clampMinimum(firstResetRaw.toString(), resetModel.minimumMinutes);
  const resetQuote = resetRubyQuote({ previousBest: '0', newBest: '30', firstEffectiveMinimum: candidate.reset.reward.firstEffectiveMinimum });
  const firstEvolutionCost = evolutionCost(candidate, '1');
  const horizons = plan.horizons.map((horizon) => horizonMetrics(candidate, execution, build, persona, rng, horizon));
  const mastery20 = masteryOverflow(candidate.characterMastery, '20');
  const mastery25 = masteryOverflow(candidate.characterMastery, '25');
  const deterministic = {
    scenarioId: `${namespace}|${partition}|${buildId}|${personaId}|${ordinal}`,
    partition,
    scenarioAlgorithmVersion: execution.scenarioAlgorithmVersion,
    executionVersion: execution.executionVersion,
    buildId,
    personaId,
    seed,
    ordinal: String(ordinal),
    firstResetMinutes,
    firstResetRuby: resetQuote.reward,
    firstEvolutionCost,
    firstEvolutionCovered: toBigInt(resetQuote.reward) >= toBigInt(firstEvolutionCost),
    featuredGuaranteeDay: featuredGuaranteeDay(persona.dailyFeaturedProgress, candidate.gacha.featuredGuarantee.draws),
    masteryAt20: mastery20,
    masteryOverflowAt25: mastery25,
    horizons,
  };
  return { ...deterministic, scenarioDigest: sha256Canonical(deterministic) };
}
