import { assertUnsigned, toBigInt, exactPowerExpression, evaluatePowerExpression } from './numeric.mjs';
import { sha256Text } from './hash.mjs';

function ceilDiv(n, d) { return (n + d - 1n) / d; }
function padMinimum(value, width) { return value.toString().padStart(width, '0'); }

export function districtForFloor(floor) {
  const f = toBigInt(assertUnsigned(floor, 'floor', { positive: true }));
  return ceilDiv(f, 10n).toString();
}

export function cycleForFloor(floor) {
  const f = toBigInt(assertUnsigned(floor, 'floor', { positive: true }));
  return ceilDiv(f, 100n).toString();
}

export function districtId(district) {
  const d = toBigInt(assertUnsigned(district, 'district', { positive: true }));
  return `tower.district.${padMinimum(d, 3)}`;
}

export function cycleId(cycle) {
  const c = toBigInt(assertUnsigned(cycle, 'cycle', { positive: true }));
  return `tower.cycle.${padMinimum(c, 6)}`;
}

export function milestoneId(floor) {
  const f = assertUnsigned(floor, 'floor', { positive: true });
  return `tower.milestone.floor.${f}`;
}

export function isCanonicalDistrictId(id) {
  const match = /^tower\.district\.([0-9]+)$/.exec(id);
  if (!match) return false;
  const normalized = BigInt(match[1]).toString();
  return match[1] === normalized.padStart(3, '0');
}

export function isCanonicalCycleId(id) {
  const match = /^tower\.cycle\.([0-9]+)$/.exec(id);
  if (!match) return false;
  const normalized = BigInt(match[1]).toString();
  return match[1] === normalized.padStart(6, '0');
}

export function isCanonicalMilestoneId(id) {
  const match = /^tower\.milestone\.floor\.(0|[1-9][0-9]*)$/.exec(id);
  return Boolean(match && match[1] !== '0');
}

export function bossForFloor(floor) {
  const f = toBigInt(assertUnsigned(floor, 'floor', { positive: true }));
  const district = ceilDiv(f, 10n);
  if (f % 10n === 0n) {
    if (district === 1n) return { kind: 'district', id: 'tower.boss.d01.kagetsubasa' };
    return { kind: 'district', id: `tower.boss.d${padMinimum(district, 2)}.end.001` };
  }
  if (f % 5n === 0n) return { kind: 'mid', id: `tower.boss.d${padMinimum(district, 2)}.mid.001` };
  return { kind: 'none', id: 'NONE' };
}

function growthExpression(base, growth, floor) {
  const exponent = (toBigInt(floor) - 1n).toString();
  return exactPowerExpression(base, growth.numerator, growth.denominator, exponent);
}

function stat(base, growth, floor, exactMaximum) {
  const expression = growthExpression(base, growth, floor);
  if (toBigInt(floor) <= toBigInt(exactMaximum)) {
    return { representation: 'expanded-integer', value: evaluatePowerExpression(expression, 'ceil'), expression };
  }
  return { representation: 'exact-symbolic-power', value: 'SYMBOLIC', expression };
}

export function selectModifiers(floor, poolIds, count = 2) {
  const f = assertUnsigned(floor, 'floor', { positive: true });
  const ranked = poolIds.map((id) => ({ id, key: sha256Text(`${f}|${id}`) })).sort((a, b) => a.key.localeCompare(b.key));
  return ranked.slice(0, count).map((x) => x.id);
}

export function generateFloor(candidate, floor) {
  const f = assertUnsigned(floor, 'floor', { positive: true });
  const district = districtForFloor(f);
  const cycle = cycleForFloor(f);
  const generator = candidate.tower.floorGenerator;
  const modifiers = selectModifiers(f, candidate.tower.modifierPools.poolIds, Number(candidate.tower.modifierPools.selectionCount));
  return {
    floor: f,
    district,
    districtId: districtId(district),
    cycle,
    cycleId: cycleId(cycle),
    milestoneId: candidate.tower.milestones.includes(f) ? milestoneId(f) : 'NONE',
    boss: bossForFloor(f),
    modifiers,
    hp: stat(generator.hpBase, generator.hpGrowth, f, generator.exactExpansionMaximumFloor),
    attack: stat(generator.attackBase, generator.attackGrowth, f, generator.exactExpansionMaximumFloor),
    coin: stat(generator.coinBase, generator.coinGrowth, f, generator.exactExpansionMaximumFloor),
  };
}
