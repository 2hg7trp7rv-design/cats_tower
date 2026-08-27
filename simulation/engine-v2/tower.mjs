import { assertUnsigned, toBigInt, exactPowerExpression, evaluatePowerExpression } from './numeric.mjs';
import { sha256Text } from './hash.mjs';

const MODIFIER_PERMUTATION_CACHE = new Map();

function ceilDiv(n, d) {
  if (d <= 0n) throw new RangeError('CEIL_DIVISOR_MUST_BE_POSITIVE');
  return (n + d - 1n) / d;
}

function padMinimum(value, width) {
  return value.toString().padStart(width, '0');
}

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

function combinations(values, count, start = 0, prefix = [], output = []) {
  if (prefix.length === count) {
    output.push(prefix.slice());
    return output;
  }
  for (let index = start; index <= values.length - (count - prefix.length); index += 1) {
    prefix.push(values[index]);
    combinations(values, count, index + 1, prefix, output);
    prefix.pop();
  }
  return output;
}

function modifierBasePermutation(poolIds, count) {
  if (!Array.isArray(poolIds) || new Set(poolIds).size !== poolIds.length) throw new Error('MODIFIER_POOL_IDS_MUST_BE_UNIQUE');
  if (!Number.isInteger(count) || count <= 0 || count > poolIds.length) throw new RangeError('INVALID_MODIFIER_SELECTION_COUNT');
  const cacheKey = `${count}|${poolIds.join('|')}`;
  if (MODIFIER_PERMUTATION_CACHE.has(cacheKey)) return MODIFIER_PERMUTATION_CACHE.get(cacheKey);
  const ordered = combinations(poolIds, count)
    .map((ids) => ({ ids, rank: sha256Text(`tower-modifier-combination-v1|${cacheKey}|${ids.join('|')}`) }))
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.ids.join('|').localeCompare(right.ids.join('|')))
    .map((entry) => Object.freeze(entry.ids.slice()));
  if (ordered.length < 2) throw new Error('MODIFIER_COMBINATION_SPACE_TOO_SMALL');
  const frozen = Object.freeze(ordered);
  MODIFIER_PERMUTATION_CACHE.set(cacheKey, frozen);
  return frozen;
}

export function selectModifiers(floor, poolIds, count = 2) {
  const f = toBigInt(assertUnsigned(floor, 'floor', { positive: true }));
  const base = modifierBasePermutation(poolIds, count);
  const size = BigInt(base.length);
  const zeroBased = f - 1n;
  const block = zeroBased / size;
  const position = zeroBased % size;
  const index = Number((block + position) % size);
  return base[index].slice();
}

export function auditModifierSequence(candidate, startFloor = '1', length = candidate.tower.modifierPools.windowSize) {
  const start = toBigInt(assertUnsigned(startFloor, 'startFloor', { positive: true }));
  const count = Number(toBigInt(assertUnsigned(String(length), 'length', { positive: true })));
  if (!Number.isSafeInteger(count) || count > 10000) throw new RangeError('MODIFIER_AUDIT_LENGTH_UNSAFE');
  const selectionCount = Number(candidate.tower.modifierPools.selectionCount);
  const windowSize = Number(candidate.tower.modifierPools.windowSize);
  const adjacentLimit = Number(candidate.tower.modifierPools.adjacentRepeatMaximum);
  const windowLimit = Number(candidate.tower.modifierPools.windowRepeatMaximum);
  const keys = [];
  let previous = null;
  let adjacentRun = 0;
  let maximumAdjacentRun = 0;
  for (let index = 0; index < count; index += 1) {
    const pair = selectModifiers((start + BigInt(index)).toString(), candidate.tower.modifierPools.poolIds, selectionCount);
    const key = pair.join('|');
    keys.push(key);
    adjacentRun = key === previous ? adjacentRun + 1 : 1;
    if (adjacentRun > maximumAdjacentRun) maximumAdjacentRun = adjacentRun;
    previous = key;
  }
  let maximumWindowOccurrences = 0;
  for (let startIndex = 0; startIndex < keys.length; startIndex += 1) {
    const counts = new Map();
    for (const key of keys.slice(startIndex, startIndex + windowSize)) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const value of counts.values()) if (value > maximumWindowOccurrences) maximumWindowOccurrences = value;
  }
  return {
    startFloor: start.toString(),
    length: String(count),
    adjacentRepeatMaximumConfigured: String(adjacentLimit),
    adjacentRepeatMaximumObserved: String(maximumAdjacentRun),
    windowSize: String(windowSize),
    windowRepeatMaximumConfigured: String(windowLimit),
    windowRepeatMaximumObserved: String(maximumWindowOccurrences),
    passed: maximumAdjacentRun <= adjacentLimit && maximumWindowOccurrences <= windowLimit,
  };
}

export function backgroundForFloor(candidate, floor) {
  const f = toBigInt(assertUnsigned(floor, 'floor', { positive: true }));
  const districtCadence = toBigInt(assertUnsigned(candidate.tower.backgroundCadence.districtChangeEveryFloors, 'districtChangeEveryFloors', { positive: true }));
  const majorCadence = toBigInt(assertUnsigned(candidate.tower.backgroundCadence.majorThemeCycleEveryFloors, 'majorThemeCycleEveryFloors', { positive: true }));
  return {
    districtThemeIndex: ceilDiv(f, districtCadence).toString(),
    majorThemeCycleIndex: ceilDiv(f, majorCadence).toString(),
  };
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
    background: backgroundForFloor(candidate, f),
    hp: stat(generator.hpBase, generator.hpGrowth, f, generator.exactExpansionMaximumFloor),
    attack: stat(generator.attackBase, generator.attackGrowth, f, generator.exactExpansionMaximumFloor),
    coin: stat(generator.coinBase, generator.coinGrowth, f, generator.exactExpansionMaximumFloor),
  };
}
