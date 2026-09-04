import candidateDocument from '../../../simulation/candidate-v3.json';

// The sealed simulation engine is JavaScript. This typed adapter imports the
// exact repository implementation rather than copying its formulas.
// @ts-expect-error The sealed engine currently has no TypeScript declarations.
import * as numericEngine from '../../../simulation/engine-v2/numeric.mjs';
// @ts-expect-error The sealed engine currently has no TypeScript declarations.
import * as randomEngine from '../../../simulation/engine-v2/rng.mjs';
// @ts-expect-error The sealed engine currently has no TypeScript declarations.
import * as towerEngine from '../../../simulation/engine-v2/tower.mjs';

export type UnsignedDecimalString = string;
export type CanonicalCatRole =
  | 'frontline-control'
  | 'ranged-anti-air'
  | 'healing-support'
  | 'runner-backline-disruption';

interface ExactRatioDocument {
  readonly numerator: UnsignedDecimalString;
  readonly denominator: UnsignedDecimalString;
}

interface CandidateCharacterDocument {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
}

interface CandidateV3Document {
  readonly meta: {
    readonly candidateId: string;
    readonly schemaVersion: string;
    readonly algorithmVersion: string;
  };
  readonly numeric: {
    readonly representation: string;
    readonly roundingModes: readonly string[];
  };
  readonly tower: {
    readonly playerVisibleMaximum: string;
    readonly districtSize: UnsignedDecimalString;
    readonly cycleSize: UnsignedDecimalString;
    readonly floorGenerator: {
      readonly version: string;
      readonly exactExpansionMaximumFloor: UnsignedDecimalString;
    };
  };
  readonly combat: {
    readonly tickRate: {
      readonly milliseconds: UnsignedDecimalString;
      readonly version: string;
    };
    readonly formationSize: UnsignedDecimalString;
    readonly movement: {
      readonly directTapDamage: UnsignedDecimalString;
    };
    readonly damage: {
      readonly formulaVersion: string;
      readonly minimumDamage: UnsignedDecimalString;
    };
  };
  readonly characters: {
    readonly catalog: readonly CandidateCharacterDocument[];
  };
  readonly levels: {
    readonly costCurve: {
      readonly version: string;
      readonly baseCost: UnsignedDecimalString;
      readonly growth: ExactRatioDocument;
      readonly rounding: 'floor' | 'ceil' | 'half-even';
    };
  };
}

interface ExactPowerExpression {
  readonly kind: 'exact-symbolic-power-v1';
  readonly coefficient: UnsignedDecimalString;
  readonly numerator: UnsignedDecimalString;
  readonly denominator: UnsignedDecimalString;
  readonly exponent: UnsignedDecimalString;
}

export interface CanonicalGeneratedStat {
  readonly representation: 'expanded-integer' | 'exact-symbolic-power';
  readonly value: UnsignedDecimalString | 'SYMBOLIC';
  readonly expression: ExactPowerExpression;
}

export interface CanonicalFloorDescriptor {
  readonly floor: UnsignedDecimalString;
  readonly district: UnsignedDecimalString;
  readonly districtId: string;
  readonly cycle: UnsignedDecimalString;
  readonly cycleId: string;
  readonly milestoneId: string;
  readonly boss: {
    readonly kind: 'none' | 'mid' | 'district';
    readonly id: string;
  };
  readonly modifiers: readonly string[];
  readonly background: {
    readonly districtThemeIndex: UnsignedDecimalString;
    readonly majorThemeCycleIndex: UnsignedDecimalString;
  };
  readonly hp: CanonicalGeneratedStat;
  readonly attack: CanonicalGeneratedStat;
  readonly coin: CanonicalGeneratedStat;
}

interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

interface CanonicalRng {
  nextBelow(maxExclusive: bigint): bigint;
  snapshot(): string;
}

const candidate = candidateDocument as unknown as CandidateV3Document;

const coreCharacterIds = [
  'character.launch.001',
  'character.launch.002',
  'character.launch.003',
  'character.launch.004',
] as const;

const expectedRoles: Record<(typeof coreCharacterIds)[number], CanonicalCatRole> = {
  'character.launch.001': 'frontline-control',
  'character.launch.002': 'ranged-anti-air',
  'character.launch.003': 'healing-support',
  'character.launch.004': 'runner-backline-disruption',
};

const launchParty = coreCharacterIds.map((id) => {
  const document = candidate.characters.catalog.find((entry) => entry.id === id);

  if (!document) {
    throw new Error(`CANONICAL_CHARACTER_MISSING:${id}`);
  }

  const expectedRole = expectedRoles[id];
  if (document.role !== expectedRole) {
    throw new Error(
      `CANONICAL_CHARACTER_ROLE_MISMATCH:${id}:${document.role}:${expectedRole}`,
    );
  }

  return Object.freeze({
    id: document.id,
    name: document.displayName,
    role: expectedRole,
  });
});

const fixedStepMs = Number(candidate.combat.tickRate.milliseconds);
if (!Number.isSafeInteger(fixedStepMs) || fixedStepMs <= 0) {
  throw new Error('CANONICAL_TICK_RATE_INVALID');
}

if (candidate.combat.formationSize !== '4') {
  throw new Error('CANONICAL_FORMATION_SIZE_MISMATCH');
}

if (candidate.combat.movement.directTapDamage !== '0') {
  throw new Error('CANONICAL_TAP_DAMAGE_MISMATCH');
}

export const CANONICAL_BINDING = Object.freeze({
  candidatePath: 'simulation/candidate-v3.json',
  numericEnginePath: 'simulation/engine-v2/numeric.mjs',
  randomEnginePath: 'simulation/engine-v2/rng.mjs',
  towerEnginePath: 'simulation/engine-v2/tower.mjs',
  candidateId: candidate.meta.candidateId,
  candidateSchemaVersion: candidate.meta.schemaVersion,
  algorithmVersion: candidate.meta.algorithmVersion,
  numericRepresentation: candidate.numeric.representation,
  tickVersion: candidate.combat.tickRate.version,
  fixedStepMs,
  floorGeneratorVersion: candidate.tower.floorGenerator.version,
  exactExpansionMaximumFloor:
    candidate.tower.floorGenerator.exactExpansionMaximumFloor,
  playerVisibleMaximum: candidate.tower.playerVisibleMaximum,
  damageFormulaVersion: candidate.combat.damage.formulaVersion,
  damageFormulaRuntimeStatus: 'BOOTSTRAP_PROVISIONAL_NOT_MODEL_RESEALED',
  levelCostVersion: candidate.levels.costCurve.version,
});

export const getCanonicalLaunchParty = () =>
  launchParty.map((cat) => ({ ...cat }));

export const assertUnsigned = (
  value: UnsignedDecimalString,
  label = 'value',
  options: { readonly positive?: boolean } = {},
): UnsignedDecimalString =>
  numericEngine.assertUnsigned(value, label, options) as UnsignedDecimalString;

export const toBigInt = (
  value: UnsignedDecimalString,
  label = 'value',
): bigint => numericEngine.toBigInt(value, label) as bigint;

export const addUnsigned = (
  left: UnsignedDecimalString,
  right: UnsignedDecimalString,
): UnsignedDecimalString =>
  numericEngine.addUnsigned(left, right) as UnsignedDecimalString;

export const subtractUnsigned = (
  left: UnsignedDecimalString,
  right: UnsignedDecimalString,
): UnsignedDecimalString =>
  numericEngine.subtractUnsigned(left, right) as UnsignedDecimalString;

export const generateCanonicalFloor = (
  floor: UnsignedDecimalString,
): CanonicalFloorDescriptor =>
  towerEngine.generateFloor(
    candidate,
    assertUnsigned(floor, 'floor', { positive: true }),
  ) as CanonicalFloorDescriptor;

export const expandedStatValue = (
  stat: CanonicalGeneratedStat,
  label: string,
): UnsignedDecimalString => {
  if (stat.representation !== 'expanded-integer' || stat.value === 'SYMBOLIC') {
    throw new RangeError(
      `${label} is symbolic at this floor. V2-0 combat is fail-closed above the candidate's expanded-integer boundary.`,
    );
  }

  return assertUnsigned(stat.value, label);
};

export const levelCost = (
  level: UnsignedDecimalString,
): UnsignedDecimalString => {
  const normalizedLevel = assertUnsigned(level, 'level', { positive: true });
  const exponent = (toBigInt(normalizedLevel, 'level') - 1n).toString();
  const curve = candidate.levels.costCurve;
  const expression = numericEngine.exactPowerExpression(
    curve.baseCost,
    curve.growth.numerator,
    curve.growth.denominator,
    exponent,
  ) as ExactPowerExpression;

  return numericEngine.evaluatePowerExpression(
    expression,
    curve.rounding,
  ) as UnsignedDecimalString;
};

export const createCanonicalRng = (seed: string | bigint): CanonicalRng =>
  new randomEngine.DeterministicRng(seed) as CanonicalRng;

export const randomSignedUnit = (rng: CanonicalRng): bigint =>
  rng.nextBelow(3n) - 1n;

export const displayInteger = (value: UnsignedDecimalString): string =>
  numericEngine.displayAbbreviation(assertUnsigned(value), 4) as string;

export const ratioForDisplay = (
  current: UnsignedDecimalString,
  maximum: UnsignedDecimalString,
): number => {
  const currentValue = toBigInt(current, 'current');
  const maximumValue = toBigInt(maximum, 'maximum');

  if (maximumValue <= 0n) {
    return 0;
  }

  const clamped = currentValue > maximumValue ? maximumValue : currentValue;
  const basisPoints = (clamped * 10_000n) / maximumValue;
  return Number(basisPoints) / 10_000;
};

export const ceilPercent = (
  value: UnsignedDecimalString,
  percent: bigint,
): UnsignedDecimalString => {
  if (percent < 0n) {
    throw new RangeError('percent must be non-negative');
  }

  const amount = toBigInt(value) * percent;
  return ((amount + 99n) / 100n).toString();
};

// Reach the exact-rational functions through the same adapter so later combat
// work does not create a second rounding implementation.
export const exactRational = Object.freeze({
  rational: numericEngine.rational as (
    numerator: bigint,
    denominator?: bigint,
  ) => Rational,
  parseRatioObject: numericEngine.parseRatioObject as (
    ratio: ExactRatioDocument,
    label?: string,
  ) => Rational,
  compare: numericEngine.compare as (left: Rational, right: Rational) => number,
  round: numericEngine.roundRational as (
    value: Rational,
    mode?: 'floor' | 'ceil' | 'half-even',
  ) => bigint,
});
