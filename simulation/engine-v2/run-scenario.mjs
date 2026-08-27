import { DeterministicRng } from './rng.mjs';
import { generateFloor } from './tower.mjs';
import { featuredGuaranteeDay, resetRubyQuote, evolutionCost, masteryOverflow } from './economy.mjs';
import { parseExactDecimal, rational, roundRational, toBigInt } from './numeric.mjs';
import { sha256Canonical } from './hash.mjs';

const FIRST_RESET_BASE = {
  'no-ad-f2p':'27','rewarded-ad-f2p':'26','monthly-pass':'24','controlled-payer':'23','high-spend-stress':'22'
};
const BUILD_RESET_ADJUST = {'build.combat':'0','build.reinforcement':'-1','build.commerce':'1'};

function signedAddUnsigned(base, signedSmall) {
  const result = BigInt(base) + BigInt(signedSmall);
  if (result < 1n) throw new RangeError('minutes underflow');
  return result.toString();
}

function progressionBaseMinutes(targetFloor) {
  const floor = toBigInt(targetFloor);
  if (floor <= 10n) return 8n;
  if (floor <= 100n) return 115n;
  if (floor <= 1000n) return 2400n;
  if (floor <= 10000n) return 42000n;
  return 42000n + ((floor - 10000n) / 10n);
}

function divideByMultipliers(base, buildMultiplier, personaMultiplier, jitterBasisPoints) {
  const build = parseExactDecimal(buildMultiplier);
  const persona = parseExactDecimal(personaMultiplier);
  const jitter = rational(10000n + BigInt(jitterBasisPoints), 10000n);
  const effective = { n: build.n * persona.n * jitter.n, d: build.d * persona.d * jitter.d };
  return roundRational({ n: base * effective.d, d: effective.n }, 'ceil').toString();
}

function horizonMetrics(candidate, build, persona, rng, horizon) {
  const jitter = Number(rng.nextBelow(801n)) - 400;
  const target = horizon.targetFloor;
  const generated = generateFloor(candidate, target);
  const minutes = divideByMultipliers(progressionBaseMinutes(target), build.powerMultiplier, persona.progressMultiplier, jitter);
  const metrics = {
    horizonId:horizon.id,
    targetFloor:target,
    estimatedReachMinutes:minutes,
    targetFloorDigest:sha256Canonical(generated),
    targetFloorRepresentation:generated.hp.representation,
    districtId:generated.districtId,
    cycleId:generated.cycleId,
    bossId:generated.boss.id,
  };
  if (horizon.mode === 'five-resets') {
    const first = BigInt(FIRST_RESET_BASE[persona.id]);
    const reclear = parseExactDecimal(build.reclearMultiplier);
    const sequence=[];
    let current=first;
    for (let i=0;i<5;i+=1) {
      sequence.push(current.toString());
      current = roundRational({n:current*reclear.d,d:reclear.n},'ceil');
      if (current < 6n) current=6n;
    }
    metrics.resetMinutes=sequence;
  }
  if (horizon.mode === 'economy-45d') {
    metrics.featuredGuaranteeDay=featuredGuaranteeDay(persona.dailyFeaturedProgress, candidate.gacha.featuredGuarantee.draws);
    metrics.characterDraws45d=(toBigInt(persona.dailyCharacterDraws)*45n).toString();
    metrics.weaponDraws45d=(toBigInt(persona.dailyWeaponDraws)*45n).toString();
  }
  return metrics;
}

export function runScenario(candidate, plan, { buildId, personaId, seed, ordinal }) {
  const build = candidate.builds.find((x)=>x.id===buildId);
  const persona = candidate.personas.find((x)=>x.id===personaId);
  if (!build || !persona) throw new Error('unknown build or persona');
  const rng = new DeterministicRng(seed);
  const resetAdjustment = BUILD_RESET_ADJUST[build.id];
  const resetJitter = Number(rng.nextBelow(3n))-1;
  const firstResetMinutes=signedAddUnsigned(FIRST_RESET_BASE[persona.id], String(BigInt(resetAdjustment)+BigInt(resetJitter)));
  const resetQuote=resetRubyQuote({previousBest:'0',newBest:'30',firstEffectiveMinimum:candidate.reset.reward.firstEffectiveMinimum});
  const firstEvolutionCost=evolutionCost(candidate,'1');
  const horizons=plan.horizons.map((h)=>horizonMetrics(candidate,build,persona,rng,h));
  const mastery20=masteryOverflow(candidate.characterMastery,'20');
  const mastery25=masteryOverflow(candidate.characterMastery,'25');
  const deterministic={
    scenarioId:`${plan.seeds.qualificationNamespace}|${buildId}|${personaId}|${ordinal}`,
    buildId,personaId,seed,ordinal:String(ordinal),
    firstResetMinutes,
    firstResetRuby:resetQuote.reward,
    firstEvolutionCost,
    firstEvolutionCovered:toBigInt(resetQuote.reward)>=toBigInt(firstEvolutionCost),
    featuredGuaranteeDay:featuredGuaranteeDay(persona.dailyFeaturedProgress,candidate.gacha.featuredGuarantee.draws),
    masteryAt20:mastery20,
    masteryOverflowAt25:mastery25,
    horizons,
  };
  return {...deterministic,scenarioDigest:sha256Canonical(deterministic)};
}
