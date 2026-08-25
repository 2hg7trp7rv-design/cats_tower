import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const candidatePath = resolve(here, 'candidate-v1.json');
const schemaPath = resolve(here, 'candidate.schema.json');
const statusPath = resolve(root, 'PROJECT_STATUS.json');

const candidateBytes = readFileSync(candidatePath);
const schemaBytes = readFileSync(schemaPath);
const statusBytes = readFileSync(statusPath);
const candidate = JSON.parse(candidateBytes);
const schema = JSON.parse(schemaBytes);
const status = JSON.parse(statusBytes);
const failures = [];

const fail = (message) => failures.push(message);
const near = (actual, expected, epsilon = 1e-6) => Math.abs(actual - expected) <= epsilon;
const roundSixDecimals = (value) => Math.sign(value) * Math.floor(Math.abs(value) * 1e6 + 0.5) / 1e6;
const microUnit = 1000000;
const exactPositiveMicroShareVector = (values) => values.length > 0
  && values.every((value) => Number.isFinite(value) && value > 0 && Number.isSafeInteger(value * microUnit))
  && values.reduce((sum, value) => sum + value * microUnit, 0) === microUnit;
function scheduleProjectileFixture(currentSchedulingTimestampMs, waveOrPhaseStart, desiredImpactMs, projectileTravelMs, fixedStepMs) {
  const rawLaunch = Math.max(currentSchedulingTimestampMs, waveOrPhaseStart, desiredImpactMs - projectileTravelMs);
  const launchMs = Math.ceil(rawLaunch / fixedStepMs) * fixedStepMs;
  const impactMs = Math.ceil((launchMs + projectileTravelMs) / fixedStepMs) * fixedStepMs;
  return { launchMs, impactMs };
}

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exactSortedKeys = (value) => Object.keys(value).sort();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const allowedMutationPatterns = candidate.calibrationMutationPolicy.allowedNumericPointerPatterns.map((pattern) => new RegExp(pattern));
const immutableMutationPatterns = candidate.calibrationMutationPolicy.immutableNumericPointerPatterns.map((pattern) => new RegExp(pattern));
const canCalibrate = (pointer) => allowedMutationPatterns.some((pattern) => pattern.test(pointer)) && !immutableMutationPatterns.some((pattern) => pattern.test(pointer));
const rfc6901Pointer = (path) => `/${path.map((token) => token.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
const normalizeExecutableContract = (value, path = []) => {
  if (typeof value === 'number') return canCalibrate(rfc6901Pointer(path)) ? '<calibratable-number>' : value;
  if (typeof value === 'string') {
    if (path.length === 1 && (path[0] === 'candidateId' || path[0] === 'createdAt')) return `<${path[0]}>`;
    if (path[0] === 'sourceDependencyDigests' && path[1] === 'rawFiles' && path.length === 3) return '<sha256>';
    if (path[0] === 'sourceDependencyDigests' && path[1] === 'jsonSelections' && path.length === 4 && path[3] === 'digest') return '<sha256>';
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry, index) => normalizeExecutableContract(entry, [...path, String(index)]));
  const normalized = {};
  for (const key of Object.keys(value).sort()) normalized[key] = normalizeExecutableContract(value[key], [...path, key]);
  return normalized;
};
const executableContractDigest = (value) => sha256(Buffer.from(JSON.stringify(normalizeExecutableContract(value))));
const expectedExecutableContractDigest = '1f490f9ddec31c8ea699baff81ae4aec95e4c5127396d66e6319fc0d0089a379';
const resolveLocalRef = (ref) => {
  if (!ref.startsWith('#/')) throw new Error(`unsupported non-local schema ref: ${ref}`);
  return ref.slice(2).split('/').reduce(
    (value, token) => value[token.replaceAll('~1', '/').replaceAll('~0', '~')],
    schema
  );
};
const validateSchema = (value, rule, path = '$') => {
  if (rule.$ref) return validateSchema(value, resolveLocalRef(rule.$ref), path);
  if (Object.hasOwn(rule, 'const') && !sameJson(value, rule.const)) fail(`${path} does not match schema const`);
  if (rule.enum && !rule.enum.some((entry) => sameJson(value, entry))) fail(`${path} is outside schema enum`);

  if (rule.type) {
    const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
    const typeMatches = rule.type === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : rule.type === 'integer'
        ? Number.isInteger(value)
        : actualType === rule.type;
    if (!typeMatches) {
      fail(`${path} must be schema type ${rule.type}`);
      return;
    }
  }

  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) fail(`${path} is shorter than schema minLength`);
    if (rule.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${path} is not an ISO date`);
    if (rule.pattern !== undefined && !(new RegExp(rule.pattern)).test(value)) fail(`${path} does not match schema pattern`);
  }
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) fail(`${path} is below schema minimum`);
    if (rule.maximum !== undefined && value > rule.maximum) fail(`${path} is above schema maximum`);
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) fail(`${path} has fewer than schema minItems`);
    if (rule.maxItems !== undefined && value.length > rule.maxItems) fail(`${path} has more than schema maxItems`);
    if (rule.items) value.forEach((entry, index) => validateSchema(entry, rule.items, `${path}[${index}]`));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (rule.minProperties !== undefined && Object.keys(value).length < rule.minProperties) fail(`${path} has fewer than schema minProperties`);
    if (rule.maxProperties !== undefined && Object.keys(value).length > rule.maxProperties) fail(`${path} has more than schema maxProperties`);
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`${path} is missing schema-required field ${key}`);
    for (const [key, childRule] of Object.entries(rule.properties ?? {})) {
      if (Object.hasOwn(value, key)) validateSchema(value[key], childRule, `${path}.${key}`);
    }
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(rule.properties ?? {}, key)) fail(`${path} has unknown field ${key}`);
    }
  }
};

validateSchema(candidate, schema);

const actualExecutableContractDigest = executableContractDigest(candidate);
if (actualExecutableContractDigest !== expectedExecutableContractDigest) fail('candidate executable shape or immutable nonnumeric contract differs from the sealed contract');
const missingDynamicFieldFixture = structuredClone(candidate);
delete missingDynamicFieldFixture.weapons['armament.breaker'].incomingDamageMultiplier;
if (executableContractDigest(missingDynamicFieldFixture) === expectedExecutableContractDigest) fail('negative fixture did not reject a missing dynamic-collection field');
const immutableAcceptanceFixture = structuredClone(candidate);
immutableAcceptanceFixture.acceptance.d10Pre.range[0] += 0.01;
if (executableContractDigest(immutableAcceptanceFixture) === expectedExecutableContractDigest) fail('negative fixture did not reject an immutable acceptance threshold mutation');
const immutableStopFixture = structuredClone(candidate);
immutableStopFixture.stopPolicy.maximumForegroundSeconds += 1;
if (executableContractDigest(immutableStopFixture) === expectedExecutableContractDigest) fail('negative fixture did not reject an immutable stop-limit mutation');
const calibratableNumericFixture = structuredClone(candidate);
calibratableNumericFixture.catBaselines['cat.mugi'].baseAttack += 0.01;
if (executableContractDigest(calibratableNumericFixture) !== expectedExecutableContractDigest) fail('positive fixture rejected an allowed numeric calibration without a shape change');
const integerCalibrationFixture = structuredClone(candidate);
integerCalibrationFixture.catBaselines['cat.luna'].skill.hitsToMaximum += 1;
if (executableContractDigest(integerCalibrationFixture) !== expectedExecutableContractDigest) fail('positive fixture rejected an allowed integer calibration without a shape change');
const rangedTravelCalibrationFixture = structuredClone(candidate);
rangedTravelCalibrationFixture.combatRules.rangedContactTravelMultiplier += 0.01;
if (!canCalibrate('/combatRules/rangedContactTravelMultiplier') || executableContractDigest(rangedTravelCalibrationFixture) !== expectedExecutableContractDigest) fail('positive fixture rejected the explicitly allowed ranged-contact travel calibration');
const immutablePendingArrivalFixture = structuredClone(candidate);
immutablePendingArrivalFixture.floorOverrides['8'].reinforcementReservation.maximumPendingArrivals = 2;
if (executableContractDigest(immutablePendingArrivalFixture) === expectedExecutableContractDigest) fail('negative fixture did not reject the immutable single pending-arrival slot');
const immutableFifthHitFixture = structuredClone(candidate);
immutableFifthHitFixture.catBaselines['cat.d02.rescued'].skill.hitCycleLength = 6;
if (executableContractDigest(immutableFifthHitFixture) === expectedExecutableContractDigest) fail('negative fixture did not reject the canonical every-fifth-hit count');
const immutablePhaseOneRepeatFixture = structuredClone(candidate);
immutablePhaseOneRepeatFixture.floorOverrides['10'].firstDistrictBossMechanics.phaseOne.repeatIntervalMs = 50;
if (executableContractDigest(immutablePhaseOneRepeatFixture) === expectedExecutableContractDigest) fail('negative fixture did not reject the single-use phase-one repeat sentinel');

const compiledCalibrationDomainRules = candidate.calibrationMutationPolicy.calibratableNumericDomainRules.map((rule) => ({
  ...rule,
  patterns: rule.pointerPatterns.map((pattern) => new RegExp(pattern))
}));
const numericLeaves = (rootValue) => {
  const leaves = [];
  const visit = (value, path = []) => {
    if (typeof value === 'number') {
      leaves.push({ pointer: rfc6901Pointer(path), value });
      return;
    }
    if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, [...path, String(index)]));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(rootValue);
  return leaves;
};
const calibrationDomainErrors = (rootValue) => {
  const errors = [];
  for (const { pointer, value } of numericLeaves(rootValue)) {
    if (!canCalibrate(pointer)) continue;
    const rule = compiledCalibrationDomainRules.find((entry) => entry.patterns.some((pattern) => pattern.test(pointer)));
    if (!rule) {
      errors.push(pointer + ' has no calibratable numeric domain');
      continue;
    }
    if (!Number.isFinite(value) || Math.abs(value) > candidate.formulaRules.maximumAbsoluteInteger) errors.push(pointer + ' is outside the finite safe numeric domain');
    if (rule.numberType === 'integer' && !Number.isSafeInteger(value)) errors.push(pointer + ' must be a safe integer under ' + rule.domainKey);
    if (rule.minimumInclusive !== undefined && value < rule.minimumInclusive) errors.push(pointer + ' is below ' + rule.domainKey + ' inclusive minimum');
    if (rule.minimumExclusive !== undefined && value <= rule.minimumExclusive) errors.push(pointer + ' is not above ' + rule.domainKey + ' exclusive minimum');
    if (rule.maximumInclusive !== undefined && value > rule.maximumInclusive) errors.push(pointer + ' exceeds ' + rule.domainKey + ' inclusive maximum');
  }
  return errors;
};
if (new Set(compiledCalibrationDomainRules.map((rule) => rule.domainKey)).size !== compiledCalibrationDomainRules.length) fail('calibratable numeric domain keys must be unique');
for (const rule of compiledCalibrationDomainRules) {
  if ((rule.minimumInclusive !== undefined) === (rule.minimumExclusive !== undefined)) fail(rule.domainKey + ' must declare exactly one minimum');
  if (rule.maximumInclusive !== undefined) {
    const minimum = rule.minimumInclusive ?? rule.minimumExclusive;
    if (!(rule.maximumInclusive > minimum)) fail(rule.domainKey + ' maximum must be greater than its minimum');
  }
}
for (const error of calibrationDomainErrors(candidate)) fail(error);
const fractionalDiscreteFixture = structuredClone(candidate);
fractionalDiscreteFixture.catBaselines['cat.luna'].skill.hitsToMaximum = 4.5;
if (calibrationDomainErrors(fractionalDiscreteFixture).length === 0) fail('negative fixture did not reject a fractional discrete count');
const fractionalMillisecondsFixture = structuredClone(candidate);
fractionalMillisecondsFixture.helperBaselines.autoDispatch.intervalMsInitial = 1050.5;
if (calibrationDomainErrors(fractionalMillisecondsFixture).length === 0) fail('negative fixture did not reject fractional milliseconds');
const negativeCurveFixture = structuredClone(candidate);
negativeCurveFixture.curves.enemyEhp.baseInitial = -1;
if (calibrationDomainErrors(negativeCurveFixture).length === 0) fail('negative fixture did not reject negative base enemy EHP');
const zeroRetryHealFixture = structuredClone(candidate);
zeroRetryHealFixture.combatRules.retryFullHealFraction = 0;
if (calibrationDomainErrors(zeroRetryHealFixture).length === 0) fail('negative fixture did not reject a zero-HP retry');
const zeroAttackerFactorFixture = structuredClone(candidate);
zeroAttackerFactorFixture.enemyModel.simultaneousAttackerFactorBase = 0;
if (calibrationDomainErrors(zeroAttackerFactorFixture).length === 0) fail('negative fixture did not reject a zero attacker-factor divisor');
const zeroRoleWaveShareFixture = structuredClone(candidate);
zeroRoleWaveShareFixture.floorRoleModifiers['0'].waveEhpShares[0] = 0;
if (calibrationDomainErrors(zeroRoleWaveShareFixture).length === 0) fail('negative fixture did not reject a zero-EHP role wave');
const zeroFloor100WaveShareFixture = structuredClone(candidate);
zeroFloor100WaveShareFixture.floorOverrides['100'].waveEhpShares[0] = 0;
if (calibrationDomainErrors(zeroFloor100WaveShareFixture).length === 0) fail('negative fixture did not reject a zero-EHP F100 phase');
const zeroBossPhaseShareFixture = structuredClone(candidate);
zeroBossPhaseShareFixture.enemyModel.bossPhaseOverrides.standardThreePhase[0].ehpShare = 0;
if (calibrationDomainErrors(zeroBossPhaseShareFixture).length === 0) fail('negative fixture did not reject a zero-EHP boss phase');
const zeroF8NamedShareFixture = structuredClone(candidate);
zeroF8NamedShareFixture.floorOverrides['8'].namedObjectiveWaveEntities[0].withinWaveEhpShare = 0;
if (calibrationDomainErrors(zeroF8NamedShareFixture).length === 0) fail('negative fixture did not reject a zero-EHP F8 named objective');
const zeroF8RestoreFixture = structuredClone(candidate);
zeroF8RestoreFixture.floorOverrides['8'].reinforcementReservation.restoreInitialWaveEhpFraction = 0;
if (calibrationDomainErrors(zeroF8RestoreFixture).length === 0) fail('negative fixture did not reject a zero-effect F8 reinforcement restore');
if (calibrationDomainErrors(calibratableNumericFixture).length !== 0 || calibrationDomainErrors(integerCalibrationFixture).length !== 0) fail('positive fixture violated a calibratable numeric domain');
const setPointer = (rootValue, pointer, replacement) => {
  const tokens = pointer.slice(1).split('/').map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
  const last = tokens.pop();
  const parent = tokens.reduce((value, key) => value[key], rootValue);
  parent[last] = replacement;
};
const calibratableLeaves = numericLeaves(candidate).filter((entry) => canCalibrate(entry.pointer));
if (calibratableLeaves.length !== 501) fail('calibratable numeric leaf set differs from the sealed 501-leaf surface');
const integerCalibratableLeaves = calibratableLeaves.filter(({ pointer }) => {
  const rule = compiledCalibrationDomainRules.find((entry) => entry.patterns.some((pattern) => pattern.test(pointer)));
  return rule?.numberType === 'integer';
});
if (integerCalibratableLeaves.length !== 88) fail('integer calibration surface differs from the sealed 88-leaf set');
for (const { pointer, value } of integerCalibratableLeaves) {
  const rule = compiledCalibrationDomainRules.find((entry) => entry.patterns.some((pattern) => pattern.test(pointer)));
  const fractionalFixture = structuredClone(candidate);
  setPointer(fractionalFixture, pointer, value + 0.5);
  if (calibrationDomainErrors(fractionalFixture).length === 0) fail('integer-domain fractional fixture passed: ' + pointer);
  const belowMinimum = rule.minimumInclusive !== undefined ? rule.minimumInclusive - 1 : rule.minimumExclusive;
  const minimumFixture = structuredClone(candidate);
  setPointer(minimumFixture, pointer, belowMinimum);
  if (calibrationDomainErrors(minimumFixture).length === 0) fail('integer-domain minimum fixture passed: ' + pointer);
}
for (const { pointer } of calibratableLeaves) {
  const rule = compiledCalibrationDomainRules.find((entry) => entry.patterns.some((pattern) => pattern.test(pointer)));
  if (rule?.maximumInclusive === undefined) continue;
  const upperFixture = structuredClone(candidate);
  setPointer(upperFixture, pointer, rule.maximumInclusive + (rule.numberType === 'integer' ? 1 : 0.01));
  if (calibrationDomainErrors(upperFixture).length === 0) fail('numeric-domain maximum fixture passed: ' + pointer);
}

const resolvePointer = (rootValue, pointer) => {
  if (!/^\/(?:[^/]+(?:\/[^/]+)*)?$/.test(pointer)) return undefined;
  return pointer.slice(1).split('/').filter((token) => token.length > 0).reduce((value, token) => {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    return value && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
  }, rootValue);
};
const rangeBindingErrors = (rootValue) => {
  const errors = [];
  const seenValues = new Set();
  const seenRanges = new Set();
  for (const binding of candidate.calibrationMutationPolicy.inclusiveRangeBindings) {
    if (seenValues.has(binding.valuePointer)) errors.push('duplicate bound value pointer ' + binding.valuePointer);
    if (seenRanges.has(binding.rangePointer)) errors.push('duplicate bound range pointer ' + binding.rangePointer);
    seenValues.add(binding.valuePointer);
    seenRanges.add(binding.rangePointer);
    const value = resolvePointer(rootValue, binding.valuePointer);
    const range = resolvePointer(rootValue, binding.rangePointer);
    if (!canCalibrate(binding.valuePointer)) errors.push('bound value is not calibratable ' + binding.valuePointer);
    if (canCalibrate(binding.rangePointer)) errors.push('bound range is calibratable ' + binding.rangePointer);
    if (!Number.isFinite(value)) errors.push('bound value is not finite ' + binding.valuePointer);
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] >= range[1]) {
      errors.push('bound range is not a finite strictly ascending pair ' + binding.rangePointer);
      continue;
    }
    if (value < range[0] || value > range[1]) errors.push('bound value lies outside inclusive range ' + binding.valuePointer);
  }
  return errors;
};
for (const error of rangeBindingErrors(candidate)) fail(error);
if (candidate.calibrationMutationPolicy.inclusiveRangeBindings.length !== 38) fail('inclusive range binding set must contain the exact 38 adopted-value pairs');
if (!sameJson(candidate.calibrationMutationPolicy.nonBindingPriorRangeRules, [{
  valuePointer: '/curves/enemyAttack/attackGrowthInitial',
  rangePointer: '/curves/enemyAttack/attackGrowthPriorRange',
  rule: 'this pair is an exploration prior only and is not an admissible-value bound; survival acceptance and the numeric domain decide admissibility even outside it'
}])) fail('enemy attack growth prior must be the sole explicit nonbinding range');
const discoverCalibratableRangePairs = (rootValue) => {
  const pairs = [];
  const specialValueKeys = {
    bossUnavoidableHeavyHitMultiplierRange: 'bossUnavoidableHeavyHitNormalHitMultiplierInitial'
  };
  const visit = (value, path = []) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [rangeKey, rangeValue] of Object.entries(value)) {
      if (!Array.isArray(rangeValue) || rangeValue.length !== 2 || !rangeValue.every(Number.isFinite)) continue;
      const candidates = [];
      if (specialValueKeys[rangeKey]) candidates.push(specialValueKeys[rangeKey]);
      if (rangeKey === 'range') {
        if (sameJson(path, ['dawn', 'sameMaximumCatchup'])) candidates.push('oneRunPowerMultiplierInitial');
        candidates.push('initial');
      }
      else if (rangeKey.endsWith('PriorRange')) candidates.push(rangeKey.slice(0, -'PriorRange'.length) + 'Initial');
      else if (rangeKey.endsWith('RangeSeconds')) {
        const prefix = rangeKey.slice(0, -'RangeSeconds'.length);
        candidates.push(prefix + 'SecondsInitial', prefix + 'Seconds');
      } else if (rangeKey.endsWith('RangeMs')) {
        const prefix = rangeKey.slice(0, -'RangeMs'.length);
        candidates.push(prefix + 'Ms', prefix + 'MsInitial');
      } else if (rangeKey.endsWith('Range')) {
        const prefix = rangeKey.slice(0, -'Range'.length);
        candidates.push(prefix + 'Initial', prefix);
      }
      const valueKey = candidates.find((key) => typeof value[key] === 'number');
      if (!valueKey) continue;
      const valuePointer = rfc6901Pointer([...path, valueKey]);
      if (canCalibrate(valuePointer)) pairs.push({
        valuePointer,
        rangePointer: rfc6901Pointer([...path, rangeKey])
      });
    }
    for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
  };
  visit(rootValue);
  return pairs;
};
const pairKey = (pair) => pair.valuePointer + '|' + pair.rangePointer;
const discoveredRangePairKeys = discoverCalibratableRangePairs(candidate).map(pairKey).sort();
const declaredRangePairKeys = [
  ...candidate.calibrationMutationPolicy.inclusiveRangeBindings,
  ...candidate.calibrationMutationPolicy.nonBindingPriorRangeRules
].map(pairKey).sort();
if (!sameJson(discoveredRangePairKeys, declaredRangePairKeys)) fail('calibratable adopted-value/range naming closure differs from the explicit binding and prior sets');
const outsideRangeFixture = structuredClone(candidate);
outsideRangeFixture.catBaselines['cat.mugi'].attackIntervalMs = candidate.catBaselines['cat.mugi'].attackIntervalRangeMs[1] + 1;
if (rangeBindingErrors(outsideRangeFixture).length === 0) fail('negative fixture did not reject a cat interval outside its immutable range');
const outsideCurveRangeFixture = structuredClone(candidate);
outsideCurveRangeFixture.curves.enemyEhp.baseInitial = candidate.curves.enemyEhp.baseRange[1] + 1;
if (rangeBindingErrors(outsideCurveRangeFixture).length === 0) fail('negative fixture did not reject enemy EHP outside its immutable range');
const nonbindingPriorFixture = structuredClone(candidate);
nonbindingPriorFixture.curves.enemyAttack.attackGrowthInitial = candidate.curves.enemyAttack.attackGrowthPriorRange[1] + 0.25;
if (rangeBindingErrors(nonbindingPriorFixture).length !== 0 || calibrationDomainErrors(nonbindingPriorFixture).length !== 0) fail('positive fixture incorrectly treated the documented exploration prior as an admissible-value bound');
const inRangeGuardianFixture = structuredClone(candidate);
inRangeGuardianFixture.weapons['armament.guardian'].incomingDamageMultiplier = 0.75;
if (rangeBindingErrors(inRangeGuardianFixture).length !== 0 || calibrationDomainErrors(inRangeGuardianFixture).length !== 0) fail('positive fixture rejected an in-range guardian calibration');

const nonIncreasing = (values) => values.every((value, index) => index === 0 || value <= values[index - 1]);
const crossFieldInvariantErrors = (rootValue) => {
  const errors = [];
  const auto = rootValue.helperBaselines.autoDispatch;
  if (auto.maximumUpgradedConcurrentCap < auto.baseConcurrentCapInitial) errors.push('maximum upgraded concurrent cap is below initial cap');
  const maximumDispatchReduction = Math.min(
    rootValue.helperBaselines.helperUpgrade.dispatchIntervalReductionCap,
    rootValue.helperBaselines.helperUpgrade.maximumLevel * rootValue.helperBaselines.helperUpgrade.dispatchIntervalReductionPerLevel
  );
  if (!(rootValue.helperBaselines.autoDispatch.intervalMsInitial * (1 - maximumDispatchReduction) > 0)) errors.push('maximum helper dispatch reduction produces a nonpositive recurrence interval');
  const supplyLiftActivationCount = rootValue.districtProgression.districts.flatMap((district) => district.supportActivations).filter((entry) => entry.id === 'support.supply-lift').length;
  const supplyLift = rootValue.supportModel['support.supply-lift'];
  const maximumDeliveryReduction = Math.min(supplyLift.deliveryIntervalReductionCap, supplyLiftActivationCount * supplyLift.deliveryIntervalReductionPerActivation);
  if (!(supplyLift.baseDeliveryIntervalMs * (1 - maximumDeliveryReduction) > 0)) errors.push('maximum supply-lift reduction produces nonpositive delivery work');
  const duplicates = [...rootValue.shopModel.duplicateEffectFactors, rootValue.shopModel.duplicateEffectFactorForFifthAndLater];
  if (!nonIncreasing(duplicates)) errors.push('shop duplicate factors must be nonincreasing');
  if (!nonIncreasing(rootValue.relicModel.stackFactorsByOrdinal)) errors.push('relic stack factors must be nonincreasing');
  const reclearClamp = rootValue.offline.postDawnKnownFloorReclear.powerRatioClamp;
  if (reclearClamp[0] > reclearClamp[1]) errors.push('re-clear power-ratio clamp is inverted');
  if (rootValue.offline.uIndex.clampLowerMultiplier > rootValue.offline.uIndex.clampUpperMultiplier) errors.push('U clamp multipliers are inverted');
  if (rootValue.enemyModel.simultaneousAttackerFactorBase > rootValue.enemyModel.simultaneousAttackerFactorMaximum) errors.push('simultaneous attacker base exceeds maximum');
  if (rootValue.catBaselines['cat.luna'].skill.targetResetGapMs < rootValue.catBaselines['cat.luna'].attackIntervalMs) errors.push('Luna target-reset gap is shorter than her base attack interval');
  if (rootValue.catBaselines['cat.mugi'].frontlineShare < rootValue.combatRules.partyRequiredFrontlineShareThreshold) errors.push('initial Mugi no longer satisfies the mandatory frontliner threshold');
  if (rootValue.enemyModel.bossHeavyFirstImpactMs < rootValue.enemyModel.bossTelegraphMsInitial) errors.push('generic boss heavy telegraph would begin before the phase');
  if (rootValue.enemyModel.eliteHeavyFirstImpactMs < rootValue.enemyModel.eliteTelegraphMs) errors.push('elite heavy telegraph would begin before the wave');
  if (rootValue.floorOverrides['100'].bossHeavyFirstImpactMs < rootValue.floorOverrides['100'].bossTelegraphMs) errors.push('F100 heavy telegraph would begin before the phase');
  const phaseThree = rootValue.floorOverrides['10'].firstDistrictBossMechanics.phaseThree;
  if (phaseThree.blockDurationMs > phaseThree.repeatBlockStartIntervalMs) errors.push('F10 shop blocks overlap without a declared union rule');
  for (const [variantId, variant] of Object.entries(rootValue.floorOverrides['9'].variants)) {
    if (variant.armorShare + variant.flyingShare > 1) errors.push('F9 ' + variantId + ' threat shares exceed one');
  }
  for (const [roleId, role] of Object.entries(rootValue.floorRoleModifiers)) {
    if (role.armorShare + role.flyingShare > 1) errors.push('floor role ' + roleId + ' threat shares exceed one');
    if (!exactPositiveMicroShareVector(role.waveEhpShares)) errors.push('floor role ' + roleId + ' wave shares are not exact positive micro-shares');
  }
  for (const [phaseId, phases] of Object.entries(rootValue.enemyModel.bossPhaseOverrides)) {
    for (const phase of phases) if (phase.armorShare + phase.flyingShare > 1) errors.push(phaseId + ' boss phase threat shares exceed one');
    if (!exactPositiveMicroShareVector(phases.map((phase) => phase.ehpShare))) errors.push(phaseId + ' boss phase EHP shares are not exact positive micro-shares');
  }
  if (!exactPositiveMicroShareVector(rootValue.floorOverrides['100'].waveEhpShares)) errors.push('F100 wave shares are not exact positive micro-shares');
  if (!exactPositiveMicroShareVector(rootValue.floorOverrides['8'].namedObjectiveWaveEntities.map((entry) => entry.withinWaveEhpShare))) errors.push('F8 named objective shares are not exact positive micro-shares');
  if (rootValue.floorOverrides['8'].reinforcementReservation.deliveryWorkDelayPerSuccessfulArrivalMs > rootValue.floorOverrides['8'].reinforcementReservation.deliveryWorkDelayCapMs) errors.push('delivery delay per arrival exceeds its cap');
  if (rootValue.combatRules.floorClearSurvivorHealMaxHpFraction > rootValue.combatRules.floorClearSurvivorHealMaximumWithShop) errors.push('base floor-clear recovery exceeds the with-shop maximum');
  const standardShares = rootValue.enemyModel.bossPhaseOverrides.standardThreePhase.map((phase) => phase.ehpShare);
  if (!sameJson(rootValue.floorRoleModifiers['0'].waveEhpShares, standardShares)) errors.push('standard boss phase EHP authority differs from relative X0 shares');
  const floor100Shares = rootValue.enemyModel.bossPhaseOverrides.floor100FourPhase.map((phase) => phase.ehpShare);
  if (!sameJson(rootValue.floorOverrides['100'].waveEhpShares, floor100Shares)) errors.push('F100 boss phase EHP authority differs from its floor override');
  for (const [buildId, weights] of Object.entries(auto.dispatchBaseWeightsByBuild)) {
    if (!near(Object.values(weights).reduce((sum, value) => sum + value, 0), 1)) errors.push(buildId + ' helper dispatch weights do not sum to one');
  }
  return errors;
};
for (const error of crossFieldInvariantErrors(candidate)) fail(error);
for (const [label, mutate] of [
  ['shop duplicate factor inversion', (value) => { value.shopModel.duplicateEffectFactors[1] = value.shopModel.duplicateEffectFactors[0] + 0.01; }],
  ['relic factor inversion', (value) => { value.relicModel.stackFactorsByOrdinal[1] = value.relicModel.stackFactorsByOrdinal[0] + 0.01; }],
  ['re-clear clamp inversion', (value) => { value.offline.postDawnKnownFloorReclear.powerRatioClamp[0] = value.offline.postDawnKnownFloorReclear.powerRatioClamp[1] + 0.01; }],
  ['U clamp inversion', (value) => { value.offline.uIndex.clampLowerMultiplier = value.offline.uIndex.clampUpperMultiplier + 0.01; }],
  ['attacker-factor inversion', (value) => { value.enemyModel.simultaneousAttackerFactorBase = value.enemyModel.simultaneousAttackerFactorMaximum + 0.01; }],
  ['Luna reset gap below attack interval', (value) => { value.catBaselines['cat.luna'].skill.targetResetGapMs = value.catBaselines['cat.luna'].attackIntervalMs - 1; }],
  ['Mugi below mandatory frontliner threshold', (value) => { value.catBaselines['cat.mugi'].frontlineShare = value.combatRules.partyRequiredFrontlineShareThreshold - 0.01; }],
  ['zero helper dispatch interval at maximum reduction', (value) => {
    value.helperBaselines.helperUpgrade.dispatchIntervalReductionCap = 1;
    value.helperBaselines.helperUpgrade.dispatchIntervalReductionPerLevel = 1;
  }],
  ['zero supply-lift delivery work', (value) => {
    value.supportModel['support.supply-lift'].deliveryIntervalReductionCap = 1;
    value.supportModel['support.supply-lift'].deliveryIntervalReductionPerActivation = 1;
  }],
  ['F9 ledger negative neutral share', (value) => {
    value.floorOverrides['9'].variants.ledger.armorShare = 0.6;
    value.floorOverrides['9'].variants.ledger.flyingShare = 0.6;
  }],
  ['floor-role microscopic negative neutral share', (value) => {
    value.floorRoleModifiers['1'].armorShare = 0.5000003;
    value.floorRoleModifiers['1'].flyingShare = 0.5000002;
  }],
  ['boss-phase microscopic negative neutral share', (value) => {
    value.enemyModel.bossPhaseOverrides.standardThreePhase[0].armorShare = 0.5000003;
    value.enemyModel.bossPhaseOverrides.standardThreePhase[0].flyingShare = 0.5000002;
  }],
  ['F8 near-one but nonconserving named EHP shares', (value) => {
    value.floorOverrides['8'].namedObjectiveWaveEntities[2].withinWaveEhpShare = 0.2999995;
  }],
  ['generic boss negative telegraph time', (value) => { value.enemyModel.bossHeavyFirstImpactMs = value.enemyModel.bossTelegraphMsInitial - 1; }],
  ['elite negative telegraph time', (value) => { value.enemyModel.eliteHeavyFirstImpactMs = value.enemyModel.eliteTelegraphMs - 1; }],
  ['F100 negative telegraph time', (value) => { value.floorOverrides['100'].bossHeavyFirstImpactMs = value.floorOverrides['100'].bossTelegraphMs - 1; }],
  ['overlapping F10 shop blocks', (value) => { value.floorOverrides['10'].firstDistrictBossMechanics.phaseThree.blockDurationMs = value.floorOverrides['10'].firstDistrictBossMechanics.phaseThree.repeatBlockStartIntervalMs + 1; }],
  ['standard boss EHP authority split', (value) => {
    value.floorRoleModifiers['0'].waveEhpShares[0] -= 0.01;
    value.floorRoleModifiers['0'].waveEhpShares[1] += 0.01;
  }],
  ['F100 boss EHP authority split', (value) => {
    value.floorOverrides['100'].waveEhpShares[0] -= 0.01;
    value.floorOverrides['100'].waveEhpShares[1] += 0.01;
  }]
]) {
  const fixture = structuredClone(candidate);
  mutate(fixture);
  if (crossFieldInvariantErrors(fixture).length === 0) fail('negative fixture did not reject ' + label);
}
if (candidate.helperBaselines.autoDispatch.maximumUpgradedConcurrentCap < candidate.helperBaselines.autoDispatch.baseConcurrentCapInitial) fail('maximum upgraded concurrent cap is below the initial cap');
if (candidate.floorOverrides['8'].reinforcementReservation.maximumPendingArrivals !== 1) fail('F8 pending-arrival state is a single immutable slot');
if (candidate.catBaselines['cat.d02.rescued'].skill.hitCycleLength !== 5) fail('the canonical every-fifth-hit skill must keep hitCycleLength five');
if (candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseOne.repeatIntervalMs !== 0) fail('F10 phase-one single-use repeat sentinel must remain zero');
for (const token of ['repeatIntervalMs=0 is the immutable one-shot sentinel', 'exactly once at firstResolutionMs', 'resolve that event once', 'schedule no successor event']) {
  if (!candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseOne.repeatSentinelRule.includes(token)) fail('F10 phase-one repeat sentinel omits: ' + token);
}
const f10PhaseOneResolutionCountFixture = candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseOne.repeatIntervalMs === 0 ? 1 : Number.POSITIVE_INFINITY;
if (f10PhaseOneResolutionCountFixture !== 1) fail('F10 phase-one zero repeat sentinel did not produce exactly one resolution');
const f10LandingRule = candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseTwo.landingWindows;
for (const token of ['for every nonnegative integer k while phase two is active', 'intersect it with the actual half-open phase-active interval [0,actualPhaseEndMs)', 'ignore an empty intersection', 'start endpoint is included', 'end endpoint and actualPhaseEndMs are excluded']) {
  if (!f10LandingRule.includes(token)) fail('F10 phase-two landing-window rule omits: ' + token);
}
const f10LandingFactor = (phaseTimeMs, actualPhaseEndMs) => {
  if (!Number.isSafeInteger(phaseTimeMs) || !Number.isSafeInteger(actualPhaseEndMs) || phaseTimeMs < 0 || actualPhaseEndMs < 0 || phaseTimeMs >= actualPhaseEndMs) return null;
  if (phaseTimeMs < 5000) return 0.45;
  const k = Math.floor((phaseTimeMs - 5000) / 7000);
  const start = 5000 + 7000 * k;
  const end = 7000 + 7000 * k;
  return phaseTimeMs >= start && phaseTimeMs < end ? 1 : 0.45;
};
if (f10LandingFactor(4999, 20000) !== 0.45 || f10LandingFactor(5000, 20000) !== 1 || f10LandingFactor(6999, 20000) !== 1 || f10LandingFactor(7000, 20000) !== 0.45
  || f10LandingFactor(11999, 20000) !== 0.45 || f10LandingFactor(12000, 20000) !== 1 || f10LandingFactor(13999, 20000) !== 1 || f10LandingFactor(14000, 20000) !== 0.45
  || f10LandingFactor(12000, 12000) !== null || f10LandingFactor(-1, 20000) !== null || f10LandingFactor(5000.5, 20000) !== null) fail('F10 phase-two landing-window boundary fixture is not half-open or accepts an invalid k/time domain');
const f10PhaseTwo = candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseTwo;
for (const token of ['f10-crow|A', 'system.floorAttemptOrdinal zero-padded to 12 decimal digits', 'attempt.f10CrowProjectileOrdinal=0', 'immutable source-local correlation key', 'correlation key is not a combat event ID', 'only through combatRules.helperLifecycle.combatEventIdentity', 'paired events store the same correlation key', 'normal-projectile atomic enemy event', 'curves.enemyAttack.formulaId evaluated for floor 10', 'floorRoleModifiers.0.attack', 'event multiplier 1', 'effectComposition.incomingAtomicDamageOrder exactly once', 'effectComposition.enemyProjectileDamageSnapshotRule', 'not an actor', 'correlation keys are unique within an attempt']) {
  if (!f10PhaseTwo.sourceAndDamageRule.includes(token)) fail('F10 crow source/damage rule omits: ' + token);
}
if (f10PhaseTwo.sourceAndDamageRule.includes('construct event ID as source key')) fail('F10 crow source-local correlation key overrides the global combat-event identity');
if (f10PhaseTwo.sourceAndDamageRule.includes('combatRules.incomingAtomicDamageOrder')) fail('F10 crow source/damage rule references a nonexistent incoming-damage path');
for (const token of ['independent of enemyModel.normalAttackScheduleRule', 'pending-normal slot and attackKindCycle cursor', 'consumes none of them', 'only attempt.f10CrowProjectileTargetCarry', 'do not read or mutate the normal projectile carry map', 'Phase-two end cancels']) {
  if (!f10PhaseTwo.cadenceOwnershipRule.includes(token)) fail('F10 crow cadence ownership omits: ' + token);
}
for (const token of ['first desired impact at phaseTwo.firstDesiredImpactMs', 'enemyModel.enemyProjectileTravelMs', 'locked living target', 'legally expire for zero damage with no retarget', 'only if phase two remains active', 'phaseTwo.repeatImpactIntervalMs']) {
  if (!f10PhaseTwo.projectileRule.includes(token)) fail('F10 crow projectile rule omits: ' + token);
}
const f10CrowSourceKey = (attemptOrdinal) => `f10-crow|A${String(attemptOrdinal).padStart(12, '0')}`;
const f10CrowCorrelationKey = (attemptOrdinal, projectileOrdinal) => `${f10CrowSourceKey(attemptOrdinal)}|P${String(projectileOrdinal).padStart(12, '0')}`;
if (f10CrowSourceKey(12) === f10CrowSourceKey(13) || f10CrowCorrelationKey(12, 1) === f10CrowCorrelationKey(12, 2) || f10CrowCorrelationKey(12, 1) === f10CrowCorrelationKey(13, 1)) fail('F10 crow source or correlation identity collides across attempts/ordinals');
const syntheticCrowFirst = scheduleProjectileFixture(0, 0, 2800, 350, 50);
const syntheticCrowRepeat = scheduleProjectileFixture(syntheticCrowFirst.impactMs, 0, syntheticCrowFirst.impactMs + 5000, 350, 50);
const syntheticNormalCursor = 7;
const syntheticNormalCursorAfterCrow = syntheticNormalCursor;
if (syntheticCrowFirst.launchMs !== 2450 || syntheticCrowFirst.impactMs !== 2800 || syntheticCrowRepeat.launchMs !== 7450 || syntheticCrowRepeat.impactMs !== 7800 || syntheticNormalCursorAfterCrow !== syntheticNormalCursor) fail('F10 crow first/repeat cadence changed the normal attack cursor or missed its synthetic impact times');
const nonnegativeDynamicRoots = new Set(['catBaselines', 'helperBaselines', 'weapons', 'shopModel', 'supportModel', 'relicModel', 'floorRoleModifiers', 'enemyModel', 'builds']);
const inspectNumericLeaves = (value, path = '$', requireNonnegative = false) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > candidate.formulaRules.maximumAbsoluteInteger) fail(`${path} is outside the finite safe numeric domain`);
    if (requireNonnegative && value < 0) fail(`${path} is negative inside a nonnegative dynamic collection`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) value.forEach((entry, index) => inspectNumericLeaves(entry, `${path}[${index}]`, requireNonnegative));
  else for (const [key, child] of Object.entries(value)) inspectNumericLeaves(child, `${path}.${key}`, requireNonnegative || (path === '$' && nonnegativeDynamicRoots.has(key)));
};
inspectNumericLeaves(candidate);

const rawDependencyPaths = [
  'simulation/candidate.schema.json',
  'simulation/executable-seal.schema.json',
  'simulation/validate-candidate.mjs',
  'simulation/validate-executable-seal.mjs'
];
const declaredRawDependencies = candidate.sourceDependencyDigests?.rawFiles ?? {};
if (!sameJson(exactSortedKeys(declaredRawDependencies), [...rawDependencyPaths].sort())) fail('raw executable dependency file set must be exact');
for (const dependencyPath of rawDependencyPaths) {
  const declaredDigest = declaredRawDependencies[dependencyPath];
  if (typeof declaredDigest !== 'string' || !/^[0-9a-f]{64}$/.test(declaredDigest)) {
    fail(`raw executable dependency digest is not lowercase raw-byte SHA-256: ${dependencyPath}`);
    continue;
  }
  const actualDigest = sha256(readFileSync(resolve(root, dependencyPath)));
  if (declaredDigest !== actualDigest) fail(`raw executable dependency digest mismatch: ${dependencyPath}`);
}
const expectedExecutableSealFields = [
  'schemaVersion',
  'candidateRawSha256',
  'candidateNormalizedExecutableSha256',
  'simulatorSourceTreeSha256',
  'simulatorSourceFileCount',
  'runPlanRawSha256',
  'resultSchemaRawSha256',
  'resultValidatorRawSha256',
  'nodeVersion',
  'step2RawDatasetSha256',
  'step2SummarySha256',
  'step2AcceptanceSha256',
  'step2Verdict'
];
const executableSealContract = candidate.manifestChangePolicy.step2ToStep3ExecutableSealContract;
if (executableSealContract.path !== 'simulation/results/step-2/executable-seal.json'
  || executableSealContract.schemaPath !== 'simulation/executable-seal.schema.json'
  || executableSealContract.validatorPath !== 'simulation/validate-executable-seal.mjs'
  || !sameJson(executableSealContract.requiredFields, expectedExecutableSealFields)) fail('Step 2 executable seal paths or strict field set differ from the sealed contract');
const sourceTreeContract = executableSealContract.sourceTreeContract;
if (sourceTreeContract.sourceListLocation !== 'simulation/run-plan.json#/simulatorSourceFiles'
  || !sameJson(sourceTreeContract.fixedSourceRoots, ['simulation/engine'])
  || sourceTreeContract.sourcePathPattern !== '^[A-Za-z0-9._/-]+$'
  || sourceTreeContract.treeDigestAlgorithm !== 'sha256-utf8-json-stringify-array-of-path-and-raw-sha256'
  || !sourceTreeContract.coverageRule.includes('require exact set equality with simulatorSourceFiles')
  || !sourceTreeContract.moduleLoadingRule.includes('dynamic import with a computed specifier')
  || !sourceTreeContract.externalLocalInputRule.includes('result validation code and every helper it imports live under fixedSourceRoots')
  || !sourceTreeContract.holdoutSimulatorDigestRule.includes("simulatorRawSha256 equals this seal's simulatorSourceTreeSha256 exactly")) fail('simulator source-tree or holdout digest identity contract differs from the sealed rule');
const sourceTreeDigestFixture = (entries) => {
  const errors = [];
  const seen = new Set();
  let previousPath = null;
  for (const [path, digest] of entries) {
    if (!/^[A-Za-z0-9._/-]+$/.test(path)
      || path.startsWith('/')
      || !path.startsWith('simulation/engine/')
      || path.includes('\\')
      || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      || path.startsWith('simulation/results/')) errors.push('invalid-path');
    if (seen.has(path)) errors.push('duplicate-path');
    if (previousPath !== null && !(Buffer.compare(Buffer.from(previousPath), Buffer.from(path)) < 0)) errors.push('unsorted-path');
    if (!/^[0-9a-f]{64}$/.test(digest)) errors.push('invalid-digest');
    seen.add(path);
    previousPath = path;
  }
  if (entries.length === 0) errors.push('empty-source-tree');
  return {errors, digest: sha256(Buffer.from(JSON.stringify(entries), 'utf8'))};
};
const sourceEntryA = ['simulation/engine/a.mjs', '1'.repeat(64)];
const sourceEntryB = ['simulation/engine/b.mjs', '2'.repeat(64)];
const validSourceTree = sourceTreeDigestFixture([sourceEntryA, sourceEntryB]);
const sourceTreeCoverageFixture = (actualEntries, declaredEntries) => {
  const actualPaths = actualEntries.filter((entry) => entry.kind === 'regular' && !entry.symlink).map((entry) => entry.path).sort();
  if (actualEntries.some((entry) => entry.symlink || entry.kind !== 'regular')) return false;
  return sameJson(actualPaths, [...declaredEntries].sort());
};
if (validSourceTree.errors.length !== 0
  || validSourceTree.digest !== sha256(Buffer.from(JSON.stringify([sourceEntryA, sourceEntryB]), 'utf8'))
  || sourceTreeDigestFixture([sourceEntryB, sourceEntryA]).errors.length === 0
  || sourceTreeDigestFixture([['simulation/engine/../escape.mjs', '1'.repeat(64)]]).errors.length === 0
  || sourceTreeDigestFixture([sourceEntryA, sourceEntryA]).errors.length === 0
  || sourceTreeDigestFixture([]).errors.length === 0
  || sourceTreeDigestFixture([sourceEntryA, ['simulation/engine/b.mjs', '3'.repeat(64)]]).digest === validSourceTree.digest
  || !sourceTreeCoverageFixture([{path: sourceEntryA[0], kind: 'regular', symlink: false}, {path: sourceEntryB[0], kind: 'regular', symlink: false}], [sourceEntryA[0], sourceEntryB[0]])
  || sourceTreeCoverageFixture([{path: sourceEntryA[0], kind: 'regular', symlink: false}, {path: sourceEntryB[0], kind: 'regular', symlink: false}], [sourceEntryA[0]])
  || sourceTreeCoverageFixture([{path: sourceEntryA[0], kind: 'regular', symlink: true}], [sourceEntryA[0]])) fail('simulator source-tree fixtures do not uniquely bind paths, ordering, coverage and raw-byte digests');
const expectedSourceSpecs = [
  'MASTER_SPEC.md',
  'FLOORS_1_10_DESIGN.md',
  'PROJECT_STATUS.json',
  'quality-reviews/step-1-canonical-design/acceptance.json',
  'quality-reviews/step-1-canonical-design/acceptance-round-002.json',
  'quality-reviews/step-1-canonical-design/acceptance-round-003.json'
];
if (!sameJson(candidate.sourceSpecs, expectedSourceSpecs)) fail('sourceSpecs must be the exact canonical product and transitive acceptance provenance sources');
const expectedWorkflowMirrors = [
  'MASTER_SPEC.md',
  'FLOORS_1_10_DESIGN.md',
  'PROJECT_STATUS.json outside selectedTopLevelKeys',
  'quality-reviews/step-1-canonical-design/acceptance.json',
  'quality-reviews/step-1-canonical-design/acceptance-round-002.json',
  'quality-reviews/step-1-canonical-design/acceptance-round-003.json',
  'QUALITY_GATE.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'README.md',
  'simulation/INPUT_CONTRACT.md'
];
if (!sameJson(candidate.sourceDependencyDigests.workflowMirrorsExcludedFromBalanceResultInvalidation, expectedWorkflowMirrors)) fail('workflow-mirror exclusion set differs from the sealed one-way dependency boundary');
const statusSelectionContract = candidate.sourceDependencyDigests?.jsonSelections?.['PROJECT_STATUS.json'];
const expectedStatusSelectionKeys = ['canonicalScreens', 'stableIdMigrationAliases', 'stableIdRegistry'];
if (!sameJson(exactSortedKeys(candidate.sourceDependencyDigests?.jsonSelections ?? {}), ['PROJECT_STATUS.json'])) fail('canonical JSON selection dependency file set must be exact');
if (!sameJson(statusSelectionContract?.selectedTopLevelKeys, expectedStatusSelectionKeys)) fail('PROJECT_STATUS semantic selection keys differ from the sealed set');
const selectStatusSemantics = (source) => Object.fromEntries(expectedStatusSelectionKeys.map((key) => [key, source[key]]));
const statusSelectionDigest = sha256(Buffer.from(JSON.stringify(selectStatusSemantics(status))));
if (statusSelectionContract?.digest !== statusSelectionDigest) fail('PROJECT_STATUS selected semantic digest mismatch');
const workflowStatusFixture = structuredClone(status);
workflowStatusFixture.currentCanonicalization.status = workflowStatusFixture.currentCanonicalization.status === 'PASS' ? 'IN_PROGRESS' : 'PASS';
if (sha256(Buffer.from(JSON.stringify(selectStatusSemantics(workflowStatusFixture)))) !== statusSelectionDigest) fail('workflow status mutation unexpectedly changed the selected semantic registry digest');
const semanticStatusFixture = structuredClone(status);
semanticStatusFixture.canonicalScreens[0].id = 'S00';
if (sha256(Buffer.from(JSON.stringify(selectStatusSemantics(semanticStatusFixture)))) === statusSelectionDigest) fail('selected semantic registry mutation did not invalidate its digest');

if (new Set(candidate.fixedProductContractPointers ?? []).size !== (candidate.fixedProductContractPointers ?? []).length) fail('fixed product contract pointers must be unique');
for (const pointer of candidate.fixedProductContractPointers ?? []) {
  if (!/^\$(?:\.[A-Za-z0-9_-]+)+$/.test(pointer)) {
    fail(`fixed product contract pointer is not an exact supported path: ${pointer}`);
    continue;
  }
  let value = candidate;
  for (const key of pointer.slice(2).split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      fail(`fixed product contract pointer does not resolve: ${pointer}`);
      value = undefined;
      break;
    }
    value = value[key];
  }
}

for (const key of schema.required) {
  if (!Object.hasOwn(candidate, key)) fail(`missing top-level field: ${key}`);
}
if (candidate.schemaVersion !== 4) fail('schemaVersion must equal 4');
if (candidate.status !== 'SIMULATION_CANDIDATE') fail('status must remain SIMULATION_CANDIDATE before Step 2 and Step 3 pass');
if (candidate.offline.capSeconds !== 86400) fail('offline cap must equal 86400 seconds');
if (!candidate.stopPolicy.economyTransactionCountingRule.includes('do not count it') || !candidate.stopPolicy.economyTransactionCountingRule.includes('It never triggers a purchase by itself')) fail('live-income fixed steps must not exhaust the bounded economy-transaction counter');
if (!candidate.decisionPolicies.purchase.defeatEmergencyReserveOverride.includes('only when the current evaluation point is after-defeat-diagnosis') || !candidate.decisionPolicies.purchase.defeatEmergencyReserveOverride.includes('after-offline-settlement never use this override')) fail('defeat emergency reserve override is not restricted to its exact evaluation point');
if (!candidate.decisionPolicies.shopReconfiguration.selection.includes('filter to candidates') || !candidate.decisionPolicies.shopReconfiguration.selection.includes('unaffordable higher-scoring transition never blocks')) fail('shop reconfiguration does not rank only its affordable positive candidates');

for (const scheduleId of ['active', 'standard', 'passive']) {
  const schedule = candidate.returnSchedules[scheduleId];
  const total = schedule.segments.reduce((sum, segment) => sum + segment.seconds, 0);
  if (total !== 86400 || schedule.assertTotalSeconds !== 86400) fail(`${scheduleId} schedule must total 86400 seconds`);
}

for (const [role, value] of Object.entries(candidate.floorRoleModifiers)) {
  if (!exactPositiveMicroShareVector(value.waveEhpShares)) fail(`floor role ${role} wave EHP shares must be positive integer micro-shares summing exactly to 1`);
  if (value.armorShare + value.flyingShare > 1) fail(`floor role ${role} threat shares exceed 1`);
}
for (const [buildId, value] of Object.entries(candidate.builds)) {
  if (buildId === 'comparison') continue;
  const total = Object.values(value.purchaseUtilityWeights).reduce((sum, weight) => sum + weight, 0);
  if (!near(total, 1)) fail(`${buildId} purchase weights must sum to 1`);
}

const expectedCatIds = ['cat.mugi', 'cat.luna', 'cat.toto', 'cat.kohaku', 'cat.d02.rescued', 'cat.d03.rescued', 'cat.d04.rescued', 'cat.d05.rescued', 'cat.d06.rescued', 'cat.d07.rescued', 'cat.d08.rescued', 'cat.d09.rescued'];
const commonCatKeys = ['attackDelivery', 'attackIntervalMs', 'attackIntervalRangeMs', 'attackMultiplierByThreat', 'baseAttack', 'baseCost', 'baseHp', 'contactTravelMs', 'frontlineShare', 'skill', 'targetPriority', 'unlockCondition', 'unlockFloor'];
const skillKeysByKind = {
  'shield-next-heavy-hit': ['damageReductionInitial', 'damageReductionRange', 'intervalMs', 'skillKind'],
  'consecutive-targeting': ['hitsToMaximum', 'maximumDamageMultiplierInitial', 'maximumDamageMultiplierRange', 'skillKind', 'targetResetGapMs'],
  'lowest-ratio-heal': ['baseHealInitial', 'baseHealRange', 'healFormulaId', 'healIntervalMs', 'skillKind', 'waveHealMaxHpFractionInitial', 'waveHealMaxHpFractionRange'],
  'backline-interrupt': ['enemyAttackSuppressionRangeSeconds', 'enemyAttackSuppressionSecondsInitial', 'intervalMs', 'skillKind'],
  'armor-break-every-fifth-hit': ['cycleHitDamageMultiplier', 'hitCycleLength', 'skillKind'],
  'periodic-party-heal': ['healOwnMaxHpFraction', 'intervalMs', 'skillKind'],
  'slow-next-enemy-event': ['delayMs', 'intervalMs', 'skillKind'],
  'flying-chain-hit': ['everyAttackCount', 'secondaryDamageFraction', 'skillKind'],
  'frontline-guard': ['damageReduction', 'intervalMs', 'protectedHitCount', 'skillKind'],
  'helper-rally': ['durationMs', 'helperDamageMultiplier', 'intervalMs', 'skillKind', 'stacking'],
  'low-ehp-execute': ['damageMultiplier', 'skillKind', 'thresholdFraction'],
  'boss-phase-focus': ['bossDamageMultiplier', 'normalDamageMultiplier', 'skillKind']
};
const catShapeErrors = (catBaselines) => {
  const errors = [];
  if (!sameJson(Object.keys(catBaselines), expectedCatIds)) errors.push('named-cat IDs/order differ from the exact 12-cat contract');
  for (const catId of expectedCatIds) {
    const cat = catBaselines[catId];
    if (!cat || typeof cat !== 'object') {
      errors.push(`${catId} is missing`);
      continue;
    }
    const expectedKeys = cat.attackDelivery === 'projectile' ? [...commonCatKeys, 'projectileTravelMs'].sort() : [...commonCatKeys].sort();
    if (!sameJson(exactSortedKeys(cat), expectedKeys)) errors.push(`${catId} fields differ from its delivery-specific exact shape`);
    const expectedSkillKeys = skillKeysByKind[cat.skill?.skillKind];
    if (!expectedSkillKeys || !sameJson(exactSortedKeys(cat.skill ?? {}), [...(expectedSkillKeys ?? [])].sort())) errors.push(`${catId} skill fields differ from its exact skill-kind shape`);
    if (new Set(cat.targetPriority ?? []).size !== 3) errors.push(`${catId} target priority must contain three unique threat buckets`);
  }
  return errors;
};
for (const error of catShapeErrors(candidate.catBaselines)) fail(error);
const missingCatFieldFixture = structuredClone(candidate.catBaselines);
delete missingCatFieldFixture['cat.d02.rescued'].baseAttack;
if (catShapeErrors(missingCatFieldFixture).length === 0) fail('negative fixture did not reject a missing required cat field');
if (candidate.districtProgression.districts.length !== 10) fail('candidate must contain exactly 10 districts');
if (Object.keys(candidate.shopModel.shops).length !== 10) fail('candidate must contain exactly 10 shops');
if (Object.keys(candidate.relicModel.relics).length !== 3) fail('candidate must contain exactly 3 reusable relic families');
if (candidate.floorOverrides['1'].enemyCount !== 1) fail('F1 must contain one tutorial enemy');
if (candidate.floorOverrides['100'].waves !== 4 || candidate.floorOverrides['100'].waveEhpShares.length !== 4) fail('F100 must contain four phases');

const coveredFloors = candidate.districtProgression.districts.flatMap((district) => {
  const [start, end] = district.floorRange;
  if (end - start !== 9) fail(`${district.id} must contain exactly ten floors`);
  for (const unlock of district.catUnlocks) if (unlock.floor < start || unlock.floor > end) fail(`${unlock.id} unlock is outside ${district.id}`);
  for (const unlock of district.shopUnlocks) if (unlock.floor < start || unlock.floor > end) fail(`${district.id} shop unlock is outside its district`);
  for (const activation of district.supportActivations) if (activation.floor < start || activation.floor > end) fail(`${activation.id} activation is outside ${district.id}`);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
});
if (!sameJson(coveredFloors, Array.from({ length: 100 }, (_, index) => index + 1))) fail('district floor ranges must cover 1-100 exactly once in order');
if (candidate.districtProgression.districts.flatMap((district) => district.supportActivations).length !== 20) fail('100F model must contain exactly twenty support activations');
for (const [shopId, shop] of Object.entries(candidate.shopModel.shops)) {
  const declaredUnlocks = candidate.districtProgression.districts.flatMap((district) => district.shopUnlocks).flatMap((unlock) => unlock.ids.map((id) => ({ id, floor: unlock.floor }))).filter((entry) => entry.id === shopId);
  if (declaredUnlocks.length !== 1 || declaredUnlocks[0].floor !== shop.unlockFloor) fail(`${shopId} unlock floor differs between shop and district models`);
  for (const key of Object.keys(shop)) {
    if ((key.endsWith('PerLevel') || key.endsWith('AtLevels')) && !Object.hasOwn(candidate.shopModel.effectChannelSemantics, key)) fail(`${shopId}.${key} lacks effect-channel semantics`);
  }
}
for (const [role, value] of Object.entries(candidate.floorRoleModifiers)) {
  if (value.waves !== value.waveEhpShares.length) fail(`floor role ${role} wave count differs from its EHP-share count`);
}
for (const [phaseId, phases] of Object.entries(candidate.enemyModel.bossPhaseOverrides)) {
  if (!exactPositiveMicroShareVector(phases.map((phase) => phase.ehpShare))) fail(`${phaseId} boss phase EHP shares must be positive integer micro-shares summing exactly to 1`);
  for (const phase of phases) if (phase.armorShare + phase.flyingShare > 1) fail(`${phaseId} boss phase threat shares exceed 1`);
}

for (const [actorId, actor] of [
  ...Object.entries(candidate.catBaselines),
  ...Object.entries(candidate.helperBaselines).filter(([id]) => id.startsWith('helper.'))
]) {
  if (!['melee', 'projectile'].includes(actor.attackDelivery)) fail(`${actorId} must declare melee or projectile attackDelivery`);
  if (actor.attackDelivery === 'projectile' && !(actor.projectileTravelMs > 0)) fail(`${actorId} projectile attack must declare positive projectileTravelMs`);
  if (actor.attackDelivery === 'melee' && actor.projectileTravelMs !== undefined) fail(`${actorId} melee attack must not declare projectileTravelMs`);
}
if (!(candidate.enemyModel.enemyProjectileTravelMs > 0)) fail('enemy projectile travel must be positive');
if (!(candidate.enemyModel.bossTelegraphMsInitial > 0)) fail('boss telegraph duration must be positive');
for (const token of ["every tested floor variant/phase", "compose that phase's authoritative full maximum HP and always-on mitigation", 'For F100 phase 3', 'phaseThreeShopLockdown', 'exclude every shop-derived maximum-HP and mitigation field', 'shop-free full HP', 'shop-free incoming damage', "Never reuse another phase's shop-active HP or mitigation"]) {
  if (!candidate.survival.oneHitCheck.includes(token)) fail('phase-authoritative one-hit rule omits: ' + token);
}
const oneHitSurvives = (maximumHp, rawDamage, mitigationMultiplier) => maximumHp - rawDamage * mitigationMultiplier > 0;
const shopActiveOneHitPass = oneHitSurvives(200, 150, 0.5);
const phaseThreeShopFreeOneHitPass = oneHitSurvives(100, 150, 1);
if (!shopActiveOneHitPass || phaseThreeShopFreeOneHitPass) fail('F100 phase-three one-hit fixture did not reject a cat that survives only with suspended shop effects');
if (candidate.combatRules.floorClearSurvivorHealMaxHpFraction > candidate.combatRules.floorClearSurvivorHealMaximumWithShop) fail('base floor-clear heal exceeds its shop-augmented cap');
if (candidate.combatRules.floorClearKoReviveMaxHpFraction <= 0 || candidate.combatRules.floorClearKoReviveMaxHpFraction > 1) fail('KO revive fraction must be in (0,1]');
if (candidate.combatRules.partyMaximumNamedCats !== candidate.initialState.run.maximumNamedCatsInParty) fail('party maximum differs between initial state and combat rules');
if (!sameJson(candidate.dawn.reset.supportActivationLevels, candidate.initialState.run.supportActivationLevels)) fail('Dawn support reset differs from initial run state');
if (!sameJson(candidate.dawn.reset.storedHelperConversionCharges, candidate.initialState.run.storedHelperConversionCharges)) fail('Dawn helper-charge reset differs from initial run state');
if (candidate.initialState.run.armamentLockRemainingClears !== 0 || candidate.dawn.reset.armamentLockRemainingClears !== 0) fail('armament lock must initialize and Dawn-reset to zero');
if (candidate.initialState.run.foregroundStagnationMs !== 0 || candidate.dawn.reset.foregroundStagnationMs !== 0) fail('foreground stagnation must initialize and Dawn-reset to zero');
if (candidate.initialState.run.sameCauseDefeatCount !== 0 || candidate.dawn.reset.sameCauseDefeatCount !== 0) fail('same-cause count must initialize and Dawn-reset to zero');
for (const stateKey of ['run', 'profile', 'system']) {
  const stateRule = schema.properties.initialState.properties[stateKey];
  if (!sameJson(exactSortedKeys(candidate.initialState[stateKey]), [...stateRule.required].sort())) fail(`initialState.${stateKey} key set differs from its closed schema`);
}
if (!sameJson(candidate.initialState.run.party, ['cat.mugi'])) fail('initial party must contain only cat.mugi');
if (!sameJson(candidate.initialState.run.catLevels, {'cat.mugi': 1})) fail('initial cat levels must contain only cat.mugi at level 1');
if (!sameJson(candidate.initialState.profile.completedArmamentTutorialFloors, [])) fail('initial armament tutorial completion ledger must be empty');
const supportIds = ['support.request-board', 'support.rest-nest', 'support.supply-lift', 'support.training-ground'].sort();
if (!sameJson(exactSortedKeys(candidate.initialState.run.supportActivationLevels), supportIds)) fail('initial support level key set is not exact');
if (Object.values(candidate.initialState.run.supportActivationLevels).some((value) => value !== 0)) fail('initial support levels must all be zero');
const helperIds = ['helper.guard', 'helper.runner', 'helper.slinger'].sort();
if (!sameJson(exactSortedKeys(candidate.initialState.run.storedHelperConversionCharges), helperIds)) fail('initial helper-charge key set is not exact');
if (Object.values(candidate.initialState.run.storedHelperConversionCharges).some((value) => value !== 0)) fail('initial helper charges must all be zero');
const dawnBranchIds = ['dawn.combat', 'dawn.reinforcement', 'dawn.commerce'].sort();
if (!sameJson(exactSortedKeys(candidate.initialState.profile.dawnBranchLevels), dawnBranchIds)) fail('initial Dawn branch key set is not exact');
if (Object.values(candidate.initialState.profile.dawnBranchLevels).some((value) => value !== 0)) fail('initial Dawn branch levels must all be zero');
const initialSnapshot = candidate.initialState.profile.lastPersistedUSnapshot;
if (candidate.initialState.profile.lastPersistedU !== initialSnapshot.clampedU) fail('initial U scalar mirror differs from snapshot');
if (initialSnapshot.policyVersion !== candidate.offline.uIndex.policyVersion) fail('initial U snapshot policy differs from uIndex');
for (const [role, field] of [['combat', 'fixedCombatReference'], ['reinforcement', 'fixedReinforcementReference'], ['commerce', 'fixedCommerceReference']]) {
  if (initialSnapshot.fixedReferences[role].key !== field || initialSnapshot.fixedReferences[role].value !== candidate.offline.uIndex[field]) fail(`initial U fixed ${role} reference differs from uIndex`);
}
const uSnapshotCommitRule = candidate.offline.uIndex.snapshotCommitRule;
if (!uSnapshotCommitRule.includes('formulaRules.primitiveDefinitions.roundSixDecimals') || uSnapshotCommitRule.includes('rounding.primitiveDefinitions.roundSixDecimals')) fail('U snapshot commit references a nonexistent rounding authority');
if (candidate.initialState.system.lastCommittedOfflineSequence > candidate.initialState.system.monotonicHiddenSequence) fail('initial offline committed sequence exceeds hidden sequence');
const expectedSimulationScheduleKeys = ['active', 'standard', 'passive', 'continuousFirstTen', 'drift', 'offlineAcceptance', 'reclearNormal', 'reclearBoss', 'counterfactual'];
if (!sameJson(candidate.clockModel.simulationScheduleKeys, expectedSimulationScheduleKeys)) fail('simulation schedule identity keys are not exact');
const simulationSaveIdRegex = new RegExp(candidate.clockModel.simulationSaveIdRegex);
const makeSimulationSaveId = (seed, build, persona, schedule, instance) => `sim|S${String(seed).padStart(6, '0')}|B${build}|P${persona}|R${schedule}|X${instance}`;
const makeOfflineEventId = (saveId, hiddenSequence, monotonicMs) => `offline|${saveId}|H${String(hiddenSequence).padStart(12, '0')}|T${String(monotonicMs).padStart(16, '0')}`;
const ordinarySaveId = makeSimulationSaveId(1, 'combat', 'persona.baseline', 'standard', 'base');
if (!simulationSaveIdRegex.test(ordinarySaveId)
  || simulationSaveIdRegex.test('sim|S000001|Bcombat|Ppersona.baseline|Rstandard')
  || simulationSaveIdRegex.test(makeSimulationSaveId(1, 'combat', 'persona.baseline', 'unboundDiagnostic', 'base'))
  || !simulationSaveIdRegex.test('runtime|0123456789abcdef0123456789abcdef')) fail('simulation/runtime save-ID grammar accepts an unbound identity or rejects a valid one');
const explicitCaseSaveIds = candidate.returnSchedules.explicitOfflineCases.map((entry) => makeSimulationSaveId(7, 'commerce', 'persona.baseline', 'offlineAcceptance', entry.caseKey));
const clonedSnapshotSaveIds = Array.from({length: candidate.offline.repeatedTwentyFourHourCyclesToTest}, (_, index) => makeSimulationSaveId(7, 'commerce', 'persona.baseline', 'offlineAcceptance', `cloned-c${String(index + 1).padStart(2, '0')}`));
const reclearFixtureSaveIds = ['normal', 'boss'].flatMap((fixtureKind) => {
  const schedule = fixtureKind === 'normal' ? 'reclearNormal' : 'reclearBoss';
  return [
    makeSimulationSaveId(7, 'commerce', 'persona.baseline', schedule, `${fixtureKind}-idempotency`),
    ...Array.from({length: candidate.offline.repeatedTwentyFourHourCyclesToTest}, (_, index) => makeSimulationSaveId(7, 'commerce', 'persona.baseline', schedule, `${fixtureKind}-cloned-c${String(index + 1).padStart(2, '0')}`)),
    makeSimulationSaveId(7, 'commerce', 'persona.baseline', schedule, `${fixtureKind}-sequential`)
  ];
});
const counterfactualSaveIds = [10, 20, 30, 40, 50, 60, 70, 80].map((boundary) => makeSimulationSaveId(7, 'commerce', 'persona.baseline', 'counterfactual', `b${String(boundary).padStart(3, '0')}`));
const diagnosticSaveIds = [...explicitCaseSaveIds, ...clonedSnapshotSaveIds, ...reclearFixtureSaveIds, ...counterfactualSaveIds];
if (diagnosticSaveIds.some((saveId) => !simulationSaveIdRegex.test(saveId)) || new Set(diagnosticSaveIds).size !== diagnosticSaveIds.length) fail('diagnostic fixture save IDs are invalid or collide across case/cycle/boundary identities');
const sequentialSaveId = makeSimulationSaveId(7, 'commerce', 'persona.baseline', 'offlineAcceptance', 'sequential');
const sequentialEventIds = Array.from({length: candidate.offline.repeatedTwentyFourHourCyclesToTest}, (_, index) => makeOfflineEventId(sequentialSaveId, index + 1, 1000 + index));
if (new Set(sequentialEventIds).size !== candidate.offline.repeatedTwentyFourHourCyclesToTest) fail('sequential offline cycle event IDs collide');
const idempotencySaveId = makeSimulationSaveId(7, 'commerce', 'persona.baseline', 'offlineAcceptance', 'idempotency');
const idempotencyEventId = makeOfflineEventId(idempotencySaveId, 1, 1000);
if (new Set(Array(7).fill(idempotencyEventId)).size !== 1) fail('idempotency fixture does not retry one exact offline event ID');
for (const fixtureKind of ['normal', 'boss']) {
  const schedule = fixtureKind === 'normal' ? 'reclearNormal' : 'reclearBoss';
  const reclearIdempotencySaveId = makeSimulationSaveId(7, 'commerce', 'persona.baseline', schedule, `${fixtureKind}-idempotency`);
  const reclearIdempotencyEventId = makeOfflineEventId(reclearIdempotencySaveId, 1, 1000);
  const reclearClonedEventIds = Array.from({length: 7}, (_, index) => makeOfflineEventId(makeSimulationSaveId(7, 'commerce', 'persona.baseline', schedule, `${fixtureKind}-cloned-c${String(index + 1).padStart(2, '0')}`), 1, 1000));
  const reclearSequentialSaveId = makeSimulationSaveId(7, 'commerce', 'persona.baseline', schedule, `${fixtureKind}-sequential`);
  const reclearSequentialEventIds = Array.from({length: 7}, (_, index) => makeOfflineEventId(reclearSequentialSaveId, index + 1, 1000 + index));
  if (new Set(Array(7).fill(reclearIdempotencyEventId)).size !== 1 || new Set(reclearClonedEventIds).size !== 7 || new Set(reclearSequentialEventIds).size !== 7) fail('re-clear ' + fixtureKind + ' repeated-cycle identities do not preserve idempotency/cloned/sequential semantics');
}
for (const token of ['clockModel.simulationScheduleKeys', 'clockModel.scenarioIdentityBindings', 'clockModel.simulationSaveIdRegex', 'no diagnostic may borrow another schedule label']) {
  if (!candidate.clockModel.saveIdConstruction.includes(token)) fail('save-ID construction omits: ' + token);
}
for (const [label, token] of [
  ['acceptance reference', 'clockModel.scenarioIdentityBindings.offlineExplicitCase'],
  ['repeated cycle', 'exact idempotency, cloned-snapshot or sequential clockModel.scenarioIdentityBindings'],
  ['counterfactual', 'clockModel.scenarioIdentityBindings.counterfactualAnchor'],
  ['re-clear cohort', 'clockModel.scenarioIdentityBindings.reclearBandFixture']
]) {
  const text = label === 'acceptance reference' ? candidate.offline.acceptanceReferenceSnapshot
    : label === 'repeated cycle' ? candidate.offline.repeatedCycleAnchorRule
      : label === 'counterfactual' ? candidate.offline.counterfactualAnchorConstruction
        : candidate.timingTargets.reclearBandCohort;
  if (!text.includes(token)) fail(label + ' does not bind a unique diagnostic scenario identity');
}
for (const token of ['idempotency reuses one event seven times', 'clonedSnapshot uses seven independent identities', 'sequential uses one saveId with seven increasing hiddenSequence values']) {
  if (!candidate.timingTargets.reclearBandCohort.includes(token)) fail('re-clear cohort identity composition omits: ' + token);
}
if (candidate.returnSchedules.continuousFirstTen.stopAt !== 'floor-10-complete-post-clear-boundary-before-transition-or-600-foreground-seconds') fail('continuous first-ten stop boundary must be the complete persisted F10 post-clear boundary');
if (!candidate.returnSchedules.continuousFirstTen.timeoutResult.includes('positive-infinity')) fail('continuous first-ten timeout must fail rather than cap a successful sample');
if (candidate.decisionPolicies.shopReconfiguration.maximumAcceptedTransitionsPerEvaluation !== 1) fail('shop reconfiguration must commit one reranked transition per evaluation');
if (candidate.shopModel.liveIncomeAccrualFormulaId !== 'foreground-live-income-over-fixed-step') fail('live-income accumulator formula is not bound');
if (candidate.offline.offlineCoinDeltaFormulaId !== 'round-standard-coins-per-second-times-elapsed-times-base-efficiency-times-commerce-multiplier') fail('offline coin formula is not bound');
if (candidate.decisionPolicies.shopReconfiguration.preBossCostFormulaId !== 'round-placement-floor-reward-times-reconfiguration-cost-multiplier') fail('reconfiguration cost formula is not bound');
const f8NamedShares = candidate.floorOverrides['8'].namedObjectiveWaveEntities.map((entry) => entry.withinWaveEhpShare);
if (!exactPositiveMicroShareVector(f8NamedShares)) fail('F8 named objective shares must be positive integer micro-shares summing exactly to one');
const allocateF8NamedMicroEhp = (waveEhp, entries) => {
  const shares = entries.map((entry) => entry.withinWaveEhpShare);
  if (!exactPositiveMicroShareVector(shares)) return null;
  const waveMicroEhp = Math.floor(waveEhp * microUnit + 0.5);
  const allocations = [];
  let allocated = 0;
  for (let index = 0; index < entries.length - 1; index += 1) {
    const entityMicroEhp = Math.floor(waveMicroEhp * shares[index] + 0.5);
    allocations.push(entityMicroEhp);
    allocated += entityMicroEhp;
  }
  const residual = waveMicroEhp - allocated;
  if (residual < 0) return null;
  allocations.push(residual);
  return { waveMicroEhp, allocations };
};
const f8AllocationFixture = allocateF8NamedMicroEhp(2.000001, candidate.floorOverrides['8'].namedObjectiveWaveEntities);
if (!f8AllocationFixture
  || f8AllocationFixture.allocations.reduce((sum, value) => sum + value, 0) !== f8AllocationFixture.waveMicroEhp
  || f8AllocationFixture.allocations.some((value) => value < 0)) fail('F8 named objective micro-EHP residual allocation does not exactly conserve wave EHP');
for (const token of ['field value multiplied by 1000000 must be a positive safe integer called the micro-share', 'sum to exactly 1000000', 'final listed entity the exact nonnegative residual', 'equal wave-3 EHP exactly in micro-EHP arithmetic']) {
  if (!candidate.floorOverrides['8'].namedObjectiveAllocationRule.includes(token)) fail('F8 named objective allocation omits: ' + token);
}
for (const token of ['immutable attempt.f8NamedTargetMode=ledger-first', 'regardless of actor targetPriority', 'never invokes a prediction, reference trace or recursive target comparison', 'never changes before ledger KO']) {
  if (!candidate.combatRules.namedObjectiveTargetRule.includes(token)) fail('F8 named target rule omits: ' + token);
}
for (const token of ['unconditionally freeze attempt.f8NamedTargetMode to ledger-first', 'not an armament forecast', 'no predicted-survival test', 'same frozen targeting rule']) {
  if (!candidate.decisionPolicies.armament.floorEightDisclosedTargetRule.includes(token)) fail('F8 disclosed targeting rule omits: ' + token);
}
if (candidate.decisionPolicies.armament.floorEightDisclosedTargetRule.includes('doing so does not make predicted survival fail')) fail('F8 target policy still depends on recursive predicted survival');
const resolveF8NamedTargetFixture = (actor, currentEhpById) => {
  const entries = candidate.floorOverrides['8'].namedObjectiveWaveEntities;
  const ledger = entries.find((entry) => entry.id === 'elite.ledger_owl');
  if (currentEhpById[ledger.id] > 0 && actor.attackMultiplierByThreat[ledger.threat] > 0) return ledger.id;
  for (const threat of actor.targetPriority) {
    const target = entries.find((entry) => entry.threat === threat && currentEhpById[entry.id] > 0);
    if (target) return target.id;
  }
  return null;
};
const f8AllAlive = Object.fromEntries(candidate.floorOverrides['8'].namedObjectiveWaveEntities.map((entry) => [entry.id, 1]));
const f8AfterLedgerKo = { ...f8AllAlive, 'elite.ledger_owl': 0 };
if (resolveF8NamedTargetFixture(candidate.catBaselines['cat.mugi'], f8AllAlive) !== 'elite.ledger_owl'
  || resolveF8NamedTargetFixture(candidate.catBaselines['cat.mugi'], f8AfterLedgerKo) !== 'encounter.d01.wall') fail('F8 frozen ledger-first target fixture does not resolve before and after ledger KO');
const compositionException = candidate.seedPolicy.scenarioVariance.compositionExceptionRule;
if (!compositionException.includes('absolute F1') || !/(?:absolute F8|and F8)/.test(compositionException)) fail('F1 tutorial and F8 named encounter must both disable composition shifts');
const allocateWaveCounts = (total, shares) => {
  if (total < shares.length) return null;
  const counts = shares.map(() => 1);
  let remaining = total - shares.length;
  const idealRemaining = shares.map((share) => share * remaining);
  for (let index = 0; index < shares.length; index += 1) counts[index] += Math.floor(idealRemaining[index]);
  remaining = total - counts.reduce((sum, value) => sum + value, 0);
  const order = shares.map((_, index) => index).sort((left, right) => {
    const leftRemainder = idealRemaining[left] - Math.floor(idealRemaining[left]);
    const rightRemainder = idealRemaining[right] - Math.floor(idealRemaining[right]);
    return rightRemainder - leftRemainder || left - right;
  });
  for (let index = 0; index < remaining; index += 1) counts[order[index]] += 1;
  return counts;
};
const rosterWaveCounts = (waves) => waves.map((wave) => wave.reduce((sum, entry) => sum + entry.count, 0));
for (let floor = 1; floor <= 9; floor += 1) {
  const role = candidate.floorRoleModifiers[String(floor % 10)];
  const override = candidate.floorOverrides[String(floor)] ?? {};
  const expected = allocateWaveCounts(override.enemyCount ?? role.enemyCount, override.waveEhpShares ?? role.waveEhpShares);
  const rosters = floor === 9
    ? Object.entries(candidate.enemyModel.firstDistrictWaveRosters['9'])
    : [['default', candidate.enemyModel.firstDistrictWaveRosters[String(floor)]]];
  for (const [variant, waves] of rosters) {
    if (!sameJson(rosterWaveCounts(waves), expected)) fail(`F${floor} ${variant} roster count differs from largest-remainder wave allocation`);
  }
}
for (const wave of candidate.enemyModel.firstDistrictWaveRosters['10']) {
  if (!sameJson(wave, [{enemy: 'boss.d01.kagetsubasa', count: 1}])) fail('F10 phases must reference one persistent district boss');
}
if (candidate.enemyModel.genericFirstClearBossPhaseGate.standardThreePhaseRepresentatives.length !== 3) fail('generic first-clear standard boss gate must have three representative actions');
if (candidate.enemyModel.genericFirstClearBossPhaseGate.floor100FourPhaseRepresentatives.length !== 4) fail('F100 first-clear gate must have four representative actions');
if (!sameJson(candidate.floorOverrides['100'].fourPhaseMechanics.phaseLabels, ['ground', 'flying', 'shop-lockdown', 'berserk'])) fail('F100 phase labels are not exact');
const expectedFloorClearCommitOrder = [
  'commit-final-combat-deltas-and-objective-events',
  'apply-floor-clear-recovery-once-and-remove-transient-combat-state',
  'add-floor-to-run-cleared-set',
  'credit-floor-reward-once-and-add-to-run-rewarded-set',
  'update-run-and-profile-highest-floor',
  'stage-complete-U-snapshot-for-post-clear-decisions',
  'record-first-clear-effective-power-if-absent',
  'record-first-boss-clear-if-applicable',
  'apply-support-shop-and-armament-unlocks',
  'apply-district-seal-and-dawn-unlock',
  'run-required-first-time-delay',
  'commit-commercial-slot-or-relic-choice',
  'evaluate-cat-unlock-checkpoint',
  'commit-newly-completed-achievement-IDs',
  'update-armament-lock-and-failure-progress-counters',
  'if-boss-evaluate-one-free-shop-reconfiguration',
  'run-post-clear-purchase-policy',
  'persist-complete-post-clear-boundary',
  'create-and-evaluate-post-clear-dawn-checkpoint',
  'schedule-floor-transition-or-floor-100-stop'
];
if (!sameJson(candidate.combatRules.floorClearCommitOrder, expectedFloorClearCommitOrder)) fail('floor-clear commit order differs from the exact canonical transaction order');
if (candidate.combatRules.floorClearCommitOrder.filter((step) => step.includes('floor-clear-recovery')).length !== 1) fail('floor-clear recovery appears more than once in commit order');
for (const token of ['staged new profile.highestReachedFloor', 'before any first-time delay, choice, reconfiguration, utility preview or post-clear purchase', 'Every later decision and purchase in this boundary reads exactly that staged clampedU', 'persists it even when no purchase commits', 'profile.lastPersistedUSnapshot.highestReachedFloor equals the newly committed highest floor']) {
  if (!candidate.combatRules.floorClearUSnapshotRule.includes(token)) fail('floor-clear U snapshot rule omits: ' + token);
}
for (const token of ['immediately after supply-lift activation', 'before any required first-time delay', 'No fixed step or ordinary delivery-work progress may interleave']) {
  if (!candidate.supportModel.firstDistrictScriptedDelivery.includes(token)) fail('F3 scripted delivery ordering omits: ' + token);
}
for (const token of ['Eligible phases are active combat, wave gap and floor transition only', 'mandatory first-time or later blocking decision', 'defeat presentation', 'bounded decision projection']) {
  if (!candidate.supportModel['support.supply-lift'].deliveryWorkProgress.includes(token)) fail('delivery-work phase rule omits: ' + token);
}
for (const token of ['F3 scripted delivery commits synchronously', 'pause combat, enemy, helper, delivery-work, cooldown, transition, purchase and Dawn clocks', 'advance only clockModel foreground/monotonic clocks plus shopModel.liveIncomeAccrual']) {
  if (!candidate.timingTargets.firstTimeDecisionDraw.includes(token)) fail('first-time decision clock rule omits: ' + token);
}
const f3Supply = candidate.supportModel['support.supply-lift'];
const f3DeliveryRequiredMs = roundSixDecimals(f3Supply.baseDeliveryIntervalMs * (1 - Math.min(f3Supply.deliveryIntervalReductionCap, f3Supply.deliveryIntervalReductionPerActivation)));
const f3AfterScriptedDelivery = { deliveryCount: 3, deliveryWorkRemainingMs: f3DeliveryRequiredMs };
const f3MaximumDecisionDelayMs = candidate.timingTargets.firstTimeDecisionSecondsByRelativeFloor['3'][1]
  * candidate.personas['persona.passive'].shopAndRelicDecisionDelayMultiplier * 1000;
const f3AfterPausedDecision = { ...f3AfterScriptedDelivery };
if (!(f3MaximumDecisionDelayMs > 0)
  || f3AfterPausedDecision.deliveryCount !== 3
  || !near(f3AfterPausedDecision.deliveryWorkRemainingMs, f3DeliveryRequiredMs)) fail('F3 scripted deliveries or paused maximum first-time decision changed the delivery count/work before cat unlock');
for (const token of ['sole exceptions', 'six-decimal work-unit accumulators', 'one work unit equals one base millisecond', 'not timestamps or durations']) {
  if (!candidate.rounding.timeInternalMilliseconds.includes(token)) fail('integer-time rule omits the delivery-work accumulator exception: ' + token);
}
for (const token of ['six-decimal delivery-work units', 'legacy Ms suffix', 'not clock timestamps, delays or durations']) {
  if (!f3Supply.deliveryWorkUnitRule.includes(token)) fail('delivery-work unit rule omits: ' + token);
}
for (const token of ['workDelta=roundSixDecimals', 'remaining=roundSixDecimalsSigned(oldRemaining-workDelta)', 'remaining=roundSixDecimalsSigned(remaining+current roundSixDecimals deliveryWorkRequiredMs)', 'persist that exact six-decimal remainder']) {
  if (!f3Supply.deliveryWorkProgress.includes(token)) fail('delivery-work progress rounding omits: ' + token);
}
const syntheticDeliveryDelta = roundSixDecimals(50 * 1.03 ** 2);
const syntheticDeliveryRemaining = roundSixDecimals(100 - syntheticDeliveryDelta);
const syntheticActivationRequired = roundSixDecimals(15000 * (1 - 0.1));
const syntheticActivationRemaining = roundSixDecimals(syntheticActivationRequired * Math.min(1, Math.max(0, 7125 / 14250)));
if (!near(syntheticDeliveryDelta, 53.045) || !near(syntheticDeliveryRemaining, 46.955) || !near(syntheticActivationRequired, 13500) || !near(syntheticActivationRemaining, 6750)) fail('delivery-work six-decimal progress or activation-ratio fixture differs from the canonical rounding order');
let multiArrivalRemaining = roundSixDecimals(20 - syntheticDeliveryDelta);
let multiArrivalCount = 0;
while (multiArrivalRemaining <= 0) {
  multiArrivalCount += 1;
  multiArrivalRemaining = roundSixDecimals(multiArrivalRemaining + 15);
}
if (multiArrivalCount !== 3 || !near(multiArrivalRemaining, 11.955)) fail('signed delivery-work overshoot did not preserve all same-step arrivals and the positive remainder');
for (const token of ['source actor key `system|A`', 'eventTargetKey=`none`', 'event kind `delivery-arrival`', 'emissionIndex 0 through N-1', 'combatEventIdentity']) {
  if (!f3Supply.deliveryWorkProgress.includes(token)) fail('ordinary delivery event identity omits: ' + token);
}
for (const token of ['eventTargetKey=`none`', 'event kind `delivery-arrival`', 'emissionIndex exactly 0,1,2', 'combatEventIdentity']) {
  if (!candidate.supportModel.firstDistrictScriptedDelivery.includes(token)) fail('F3 scripted delivery event identity omits: ' + token);
}
if (!candidate.supportModel.activationRule.includes('six-decimal work units') || !candidate.supportModel.activationRule.includes('newRemainingMs=roundSixDecimals(newRequiredMs*clamp(oldRemainingMs/oldRequiredMs,0,1))')) fail('supply-lift activation does not preserve the six-decimal work ratio');
for (const token of ['roundSixDecimals result', 'deliveryWorkRemainingMs=roundSixDecimals(maximum(0,old deliveryWorkRemainingMs*runner result)) exactly once']) {
  if (!candidate.combatRules.helperLifecycle.runnerChargeConsumption.includes(token) || !f3Supply.fullQueueRunnerConversion.includes(token)) fail('runner stored-charge conversion omits its exact six-decimal write: ' + token);
}
if (!candidate.shopModel.commandPowerComposition.runner.includes('roundSixDecimals(maximum(0.50')) fail('runner command-power result is not rounded before delivery-work use');
const syntheticRunnerResult = roundSixDecimals(Math.max(0.5, 1 - (1 - 0.731111) * (1 + 0.234567)));
const syntheticRunnerRemaining = roundSixDecimals(Math.max(0, 1234.567891 * syntheticRunnerResult));
if (syntheticRunnerResult.toString().split('.')[1]?.length > 6 || syntheticRunnerRemaining.toString().split('.')[1]?.length > 6 || !Number.isFinite(syntheticRunnerRemaining)) fail('runner conversion fixture did not produce one finite six-decimal accumulator write');
if (!candidate.combatRules.helperLifecycle.manualDispatch.includes('same input transaction')) fail('manual guard conversion behavior is not explicit');
if (!candidate.combatRules.alliedKoLifecycle.includes('projectile already launched')) fail('allied KO lifecycle must explicitly preserve in-flight projectiles');
const expectedSkillCategoryMapping = {
  'arm-defensive-skills': ['shield-next-heavy-hit', 'frontline-guard'],
  'resolve-healing': ['lowest-ratio-heal', 'periodic-party-heal'],
  'resolve-control-and-rally-skills': ['backline-interrupt', 'slow-next-enemy-event', 'helper-rally'],
  'impact-owned': ['consecutive-targeting', 'armor-break-every-fifth-hit', 'flying-chain-hit', 'low-ehp-execute', 'boss-phase-focus']
};
if (!sameJson(candidate.combatRules.skillCategoryMapping, expectedSkillCategoryMapping)) fail('skill-to-simultaneous-category mapping is not exact');
const controlSkillCategoryIndex = candidate.combatRules.simultaneousEventOrder.indexOf('resolve-control-and-rally-skills');
for (const laterCategory of ['emit-heavy-telegraphs', 'helper-melee-impacts', 'outgoing-projectile-launches', 'outgoing-projectile-impacts', 'enemy-non-damage-caster-events', 'enemy-normal-melee-impacts', 'enemy-projectile-launches']) {
  if (controlSkillCategoryIndex < 0 || controlSkillCategoryIndex >= candidate.combatRules.simultaneousEventOrder.indexOf(laterCategory)) fail('control/rally skill category does not precede same-timestamp ' + laterCategory);
}
for (const token of ['source cat canonical ID then global combat event ID', 'apply their timer/status/event-schedule mutations sequentially', "later trigger reads the earlier trigger's updated", 'before every heavy telegraph, allied/enemy attack launch or impact and enemy caster category']) {
  if (!candidate.combatRules.controlAndRallySkillOrderRule.includes(token)) fail('control/rally skill order omits: ' + token);
}
for (const token of ['including one already due at the current timestamp', 'earliest final due timestamp', 'source actor key', 'eventTargetKey using exact `none` for a targetless caster', 'global combat event ID', 'already committed event']) {
  if (!candidate.combatRules.skillResolution['backline-interrupt'].includes(token)) fail('Kohaku backline-interrupt tie/timestamp rule omits: ' + token);
}
if (!candidate.combatRules.helperLifecycle.eventTargetKey.includes('targetless event uses exact nonempty sentinel `none`') || !candidate.combatRules.helperLifecycle.eventTargetKey.includes('empty string is forbidden')) fail('targetless combat events do not use one nonempty target-key sentinel');
for (const token of ['including one already due at the current timestamp', 'before enemy normal melee impacts and enemy projectile launches', 'global combat event ID']) {
  if (!candidate.combatRules.skillResolution['slow-next-enemy-event'].includes(token)) fail('d04 slow same-timestamp rule omits: ' + token);
}
for (const token of ['before helper melee impacts, outgoing projectile launches and outgoing projectile impacts', 'current timestamp', 'including a projectile launched earlier']) {
  if (!candidate.combatRules.skillResolution['helper-rally'].includes(token)) fail('d07 rally same-timestamp rule omits: ' + token);
}
const casterTieFixture = [
  { due: 6000, source: 'source-b', target: 'none', eventId: 'event-2' },
  { due: 6000, source: 'source-a', target: 'cat.mugi', eventId: 'event-3' },
  { due: 6000, source: 'source-a', target: 'none', eventId: 'event-1' }
].sort((left, right) => left.due - right.due || left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.eventId.localeCompare(right.eventId));
const kohakuDelayedDue = casterTieFixture[0].due + 1500;
const d04DelayedDue = 6500 + 900;
const rallyActiveAtHelperImpact = 6000 <= 6000;
if (casterTieFixture[0].eventId !== 'event-3' || kohakuDelayedDue !== 7500 || d04DelayedDue !== 7400 || !rallyActiveAtHelperImpact) fail('same-timestamp Kohaku/d04/d07 fixture did not delay/activate before the due caster or attack event');
if (!candidate.floorOverrides['100'].fourPhaseMechanics.phaseThreeEntryExitTimerAndCapacityTransaction.includes('preserve every already scheduled')) fail('F100 lockdown timer transaction is not explicit');
if (!candidate.driftMeasurement.anchorState.includes('only purchase evaluation') || !candidate.driftMeasurement.totalExit.includes('never invoke a second purchase evaluation')) fail('drift replay must execute exactly one embedded post-clear purchase loop');
if (!candidate.timingTargets.floorCombatBandCohort.includes('every absolute floor F1-F100')) fail('floor combat target cohorts must quantify every absolute floor');
if (!candidate.timingTargets.reclearBandCohort.includes('known F10 boss cohort')) fail('re-clear timing must include a legal known-boss cohort');
for (const field of ['completedEventIds', 'completedFirstTimeDecisionFloors', 'completedArmamentTutorialFloors', 'lastPersistedU', 'completedDawnCount', 'rewardingDawnCount']) {
  if (!candidate.dawn.reset.profileFieldsRetained.includes(field)) fail(`Dawn profile retention omits ${field}`);
}

if (candidate.dawn.nodeCostsByLevel.length !== candidate.dawn.maximumBranchLevel) fail('Dawn node-cost length differs from maximum branch level');
for (const [branchId, field, maximumField] of [
  ['dawn.combat', 'effectiveDpsGainByLevel', 'maximumEffectiveDpsGain'],
  ['dawn.reinforcement', 'effectiveDpsGainByLevel', 'maximumEffectiveDpsGain'],
  ['dawn.commerce', 'revenueGainByLevel', 'maximumRevenueGain']
]) {
  const branch = candidate.dawn.branches[branchId];
  if (branch[field].length !== candidate.dawn.maximumBranchLevel) fail(`${branchId} gain-array length differs from maximum branch level`);
  if (branch[field].some((value) => !Number.isFinite(value) || value < 0)) fail(`${branchId} contains an invalid gain`);
  const sum = Math.round(branch[field].reduce((total, value) => total + value, 0) * 1e6) / 1e6;
  if (!near(sum, branch[maximumField])) fail(`${branchId} maximum differs from summed per-level gains`);
}

for (const pointer of [
  '/catBaselines/cat.mugi/baseAttack',
  '/helperBaselines/helper.guard/baseHp',
  '/weapons/armament.breaker/attackMultiplierByThreat/armor',
  '/dawn/branches/dawn.combat/effectiveDpsGainByLevel/0',
  '/builds/combat/purchaseUtilityWeights/catPower',
  '/floorOverrides/8/reinforcementReservation/restoreInitialWaveEhpFraction',
  '/floorOverrides/10/firstDistrictBossMechanics/phaseThree/blockDurationMs'
]) if (!canCalibrate(pointer)) fail(`declared positive calibration fixture is blocked: ${pointer}`);
for (const pointer of [
  '/acceptance/d10Pre/range/0',
  '/enemyModel/failureTimeLimitSeconds',
  '/floorRoleModifiers/8/waves',
  '/floorOverrides/8/enemyCount',
  '/catBaselines/cat.mugi/unlockFloor',
  '/catBaselines/cat.kohaku/skill/enemyAttackSuppressionRangeSeconds/0',
  '/enemyModel/normalAttackIntervalMsRange/0',
  '/curves/catLevel/milestoneAppliesOnLevels/0',
  '/curves/catLevel/maximumLevel',
  '/curves/catLevel/attackGrowthRange/0',
  '/offline/settlement/eventAlreadyInProfileSettledIdsPays',
  '/shopModel/adjacency/commercialSlotsAreAdjacentWhenFloorDifference',
  '/helperBaselines/helper.guard/fullQueueConversion/maximumStoredCharges'
]) if (canCalibrate(pointer)) fail(`declared immutable calibration fixture is mutable: ${pointer}`);

if (!candidate.enemyModel.normalAttackScheduleRule.includes('immutable reserved attack kind') || !candidate.enemyModel.normalAttackScheduleRule.includes('Never schedule the successor before the rebuild decision')) fail('normal attack scheduling does not bind its pending cycle slot across threat rebuilds');
if (!candidate.enemyModel.attackKindCycleRebuild.includes('never retag, move, cancel or reschedule') || !candidate.enemyModel.attackKindCycleRebuild.includes('consume its old slot first and then rebuild immediately at cursor zero')) fail('attack-kind rebuild lacks exact pending-event and same-batch ordering');
for (const token of ['maximum(currentSchedulingTimestampMs,waveOrPhaseStart,I-enemyProjectileTravelMs)', 'may never be scheduled before currentSchedulingTimestampMs', 'travel exceeds the desired recurrence', 'delayed rather than backdated', 'actual prior impact or legal expiry commit']) {
  if (!candidate.enemyModel.normalProjectileLaunchRule.includes(token) && !candidate.enemyModel.normalAttackScheduleRule.includes(token)) fail('normal projectile scheduling omits: ' + token);
}
for (const token of ['snapshot only the source/base/class/phase operands', 'do not reserve or consume an owned charge until legal impact', 'effectComposition.enemyProjectileDamageSnapshotRule']) {
  if (!candidate.enemyModel.normalProjectileLaunchRule.includes(token)) fail('enemy projectile launch snapshot lifecycle omits: ' + token);
}
for (const token of ['Store its source-side damage payload only through effectComposition.enemyProjectileDamageSnapshotRule', 'consumes no target-side mitigation charge or shield']) {
  if (!candidate.enemyModel.projectileTargetLock.includes(token)) fail('enemy projectile target-lock lifecycle omits: ' + token);
}
const longTravelProjectile = scheduleProjectileFixture(5000, 0, 5200, 1000, 50);
if (longTravelProjectile.launchMs !== 5000 || longTravelProjectile.impactMs !== 6000 || longTravelProjectile.launchMs < 5000) fail('long-travel projectile fixture backdated a successor launch');
for (const token of ['adding phaseTwo.repeatImpactIntervalMs to that actual commit timestamp', 'delays rather than backdates the successor']) {
  if (!candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseTwo.projectileRule.includes(token)) fail('F10 crow projectile scheduling omits: ' + token);
}
if (!candidate.survival.mandatoryOneHitGateTiming.includes('local combat t=0') || !candidate.survival.mandatoryOneHitGateTiming.includes('combatSeconds=0') || !candidate.survival.mandatoryOneHitGateTiming.includes('enter combatRules.failureBoundaryOrder')) fail('mandatory one-hit rejection lacks an exact t=0 attempt transition');
if (!candidate.combatRules.failureBoundaryOrder.includes('only shopModel.liveIncomeAccrual advances') || !candidate.combatRules.failureBoundaryOrder.includes('After it ends, apply retryState once') || !candidate.decisionPolicies.failure.shortCircuitRetryTransaction.includes('execute only through combatRules.failureBoundaryOrder')) fail('defeat presentation, retry preparation and concrete-change evaluation are not in one exact order');
if (!candidate.combatRules.failureBoundaryOrder.includes('restart the Dawn suffix at progress-Dawn') || !candidate.decisionPolicies.failure.failureAchievementCommit.includes('discard its old progress/zero classification')) fail('failure achievement does not reclassify a Dawn suggestion from the new reward ledger');
if (!candidate.combatRules.retryState.includes('preserve coins including presentation live income') || !candidate.combatRules.retryState.includes('run.deliveryWorkRemainingMs and run.pendingInitialTutorialGuard exactly') || !candidate.combatRules.retryState.includes('Never clear or restart persistent support delivery work')) fail('retry state does not preserve persistent delivery/tutorial progress');
if (!candidate.combatRules.floorAttemptStart.includes('preserve exactly the HP prepared by retryState and partySelectionHpTransaction')
  || !candidate.combatRules.floorAttemptStart.includes('including retryFullHealFraction below 1')
  || !candidate.combatRules.floorAttemptStart.includes('must not overwrite it to full')) fail('defeat retry HP can be overwritten after a legal retryFullHealFraction calibration');
if (!candidate.decisionPolicies.failure.suggestionProbeRule.includes('prospectiveOrdinal=system.purchaseEvaluationOrdinal+1') || !candidate.decisionPolicies.failure.suggestionProbeRule.includes('actual purchase evaluation increments it exactly once') || !candidate.decisionPolicies.failure.suggestionProbeRule.includes('restart concreteChangeEvaluationOrder from purchase')) fail('failure suggestion probe does not bind purchase randomness and stale-state recovery');
const partySelectionRule = candidate.combatRules.partySelectionEvaluationRule;
for (const token of ['comparisonFloor=min(100,clearedFloor+1)', 'comparisonFloor=1 after Dawn', 'comparisonFloor=the failed run.currentFloor after defeat', 'effectComposition.effectivePowerReferenceTrace', 'survival.oneHitCheck', 'survivalMarginScalar>0', 'Freeze current-party and candidate-party scalar/pass results before any selection mutation']) {
  if (!partySelectionRule.includes(token)) fail('party selection evaluation omits: ' + token);
}
const partyComparisonFloor = (trigger, floor) => trigger === 'unlock' ? Math.min(100, floor + 1) : trigger === 'dawn' ? 1 : floor;
if (partyComparisonFloor('unlock', 11) !== 12 || partyComparisonFloor('unlock', 100) !== 100 || partyComparisonFloor('dawn', 87) !== 1 || partyComparisonFloor('defeat', 8) !== 8) fail('party selection trigger does not resolve one explicit comparison floor');
const acceptsPartyChange = (sameIds, current, next) => !sameIds
  && [current.effectivePower, next.effectivePower].every(Number.isFinite)
  && (next.effectivePower > current.effectivePower + candidate.decisionPolicies.purchase.ratioEpsilon || (!current.survivalPass && next.survivalPass));
if (!acceptsPartyChange(false, {effectivePower: 10, survivalPass: false}, {effectivePower: 10, survivalPass: true})
  || !acceptsPartyChange(false, {effectivePower: 10, survivalPass: true}, {effectivePower: 10 + candidate.decisionPolicies.purchase.ratioEpsilon * 2, survivalPass: true})
  || acceptsPartyChange(true, {effectivePower: 10, survivalPass: false}, {effectivePower: 20, survivalPass: true})
  || acceptsPartyChange(false, {effectivePower: 10, survivalPass: true}, {effectivePower: 10 + candidate.decisionPolicies.purchase.ratioEpsilon, survivalPass: true})
  || acceptsPartyChange(false, {effectivePower: Number.NaN, survivalPass: false}, {effectivePower: 20, survivalPass: true})) fail('failure party-change exact predicate accepts an unchanged, epsilon-boundary or non-finite option, or rejects a legal improvement');
for (const token of ['same failed run.currentFloor', 'current equipped armament', 'identical keyed stream', 'strictly greater than current effectivePowerScalar by more than decisionPolicies.purchase.ratioEpsilon', 'oneHitCheck-plus-positive-survivalMarginScalar']) {
  if (!candidate.decisionPolicies.failure.partyChangeRule.includes(token)) fail('failure party-change rule omits: ' + token);
}
const interruptionRule = candidate.returnSchedules.foregroundInterruptionResumeRule;
for (const token of ['active-combat', 'wave-gap', 'defeat-presentation', 'blocking-post-clear-boundary', 'blocking-other-decision', 'floor-transition', 'durablePhase', 'owningCompletedDawnCount', 'postSettlementAttemptEntryRule', 'timingTargets.f1TutorialDecisionCommit', 'one interruption-atomic transaction', 'On a gate pass', 'exactly one forced guard request/spawn preserved', 'On a gate rejection', 'helperRequestOrdinal=helperSpawnOrdinal=combatEventOrdinal=0', 'A2 is never created merely by return', 'may execute twice']) {
  if (!interruptionRule.includes(token)) fail('foreground interruption rule omits: ' + token);
}
const deferredBoundaryRule = candidate.returnSchedules.deferredOfflineSettlementBoundaryRule;
for (const token of ['commit exactly one complete post-clear boundary', 'pause before its post-clear Dawn checkpoint and transition', 'postSettlementAttemptEntryRule classifies the old context stale', 'cancels the original post-clear checkpoint and transition', 'complete non-mutating concreteChangeEvaluationOrder', 'keep the suggested change uncommitted', 'replaces frozenForegroundContext.sourceStateRevision and pendingOfflineEvent.sourceStateRevision', 'later Dawn checkpoint sees the achievement reward', 'settlement committed no purchase and no Dawn', 'satisfies the one required concrete change', 'achievement is already completed', 'each presentation, probe, achievement, settlement, checkpoint and retry executes at most once']) {
  if (!deferredBoundaryRule.includes(token)) fail('deferred offline boundary rule omits: ' + token);
}
const deferredFailureSettlementFixture = ({probeSuggestion, settlementPurchase, settlementDawn, stale}) => {
  const achievementAfterProbe = probeSuggestion;
  if (stale) return {achievement: achievementAfterProbe, cancelOld: true, restart: false, retry: false};
  if (settlementPurchase || settlementDawn) return {achievement: achievementAfterProbe, cancelOld: true, restart: false, retry: false};
  return {achievement: achievementAfterProbe, cancelOld: false, restart: true, retry: true};
};
if (!sameJson(deferredFailureSettlementFixture({probeSuggestion: true, settlementPurchase: true, settlementDawn: false, stale: false}), {achievement: true, cancelOld: true, restart: false, retry: false})
  || !sameJson(deferredFailureSettlementFixture({probeSuggestion: true, settlementPurchase: false, settlementDawn: false, stale: false}), {achievement: true, cancelOld: false, restart: true, retry: true})
  || !sameJson(deferredFailureSettlementFixture({probeSuggestion: false, settlementPurchase: false, settlementDawn: false, stale: false}), {achievement: false, cancelOld: false, restart: true, retry: true})) fail('deferred defeat settlement fixture lost achievement state or reused a held suggestion');
const postSettlementEntryRule = candidate.returnSchedules.postSettlementAttemptEntryRule;
for (const token of ['branch on system.frozenForegroundContext', 'A null context means exactly a stable state', 'an active or otherwise incomplete state may never be represented by null', 'terminal F100 success', 'system.floorAttemptOrdinal=0', 'sets the pending initial guard', 'helper materialization remains gated by survival.mandatoryOneHitGateTiming', 'owningCompletedDawnCount, owningFloor and owningFloorAttemptOrdinal', 'cancel the entire old context', 'every old post-clear checkpoint, transition, defeat suggestion, concrete-change traversal and retry', 'preserve the exact existing run.party and its HP with zero party reranks', 'compressed re-clear, ordinary floor entry, shop restoration and offline purchases are not party-selection triggers', 'exactly one floor-entry Dawn checkpoint', 'without decrement or rewind', 'dawn.reset.postExecutionF1EntryRule']) {
  if (!postSettlementEntryRule.includes(token)) fail('post-settlement attempt-entry rule omits: ' + token);
}
const postSettlementEntryFixture = ({ contextKind = null, owningDawn = 0, owningFloor = 1, owningAttempt = 0, resultingDawn = 0, resultingFloor = 1, resultingAttempt = 0, offlineDawn = false, entryDawn = false, initialTutorial = false, tutorialGatePass = true, terminal = false }) => {
  if (terminal) return { cancelOld: false, resumed: false, partySelections: 0, armamentEvaluations: 0, floorEntryCheckpoints: 0, attemptStarts: 0, startedFloor: null };
  if (initialTutorial) return { cancelOld: false, resumed: false, preTapAttemptStarts: 0, acceptedTaps: 1, forcedGuardRequests: tutorialGatePass ? 1 : 0, autoDispatchUnlocked: true, pendingInitialTutorialGuard: !tutorialGatePass, requestOrdinal: tutorialGatePass ? 1 : 0, spawnOrdinal: tutorialGatePass ? 1 : 0, combatEventOrdinal: 0, contextKind: tutorialGatePass ? 'active-combat' : 'defeat-presentation', floorEntryCheckpoints: 0, attemptStarts: 1, startedFloor: 1 };
  const hasContext = contextKind !== null;
  const stale = hasContext && (offlineDawn || owningDawn !== resultingDawn || owningFloor !== resultingFloor || owningAttempt !== resultingAttempt);
  if (offlineDawn) return { cancelOld: hasContext, resumed: false, partySelections: 1, armamentEvaluations: 1, floorEntryCheckpoints: 0, attemptStarts: 1, startedFloor: 1 };
  if (hasContext && !stale) return { cancelOld: false, resumed: true, partySelections: 0, armamentEvaluations: 0, floorEntryCheckpoints: 0, attemptStarts: 0, startedFloor: null };
  return { cancelOld: stale, resumed: false, partySelections: entryDawn ? 1 : 0, armamentEvaluations: entryDawn ? 2 : 1, floorEntryCheckpoints: 1, attemptStarts: 1, startedFloor: entryDawn ? 1 : resultingFloor };
};
for (const contextKind of ['active-combat', 'wave-gap', 'blocking-post-clear-boundary', 'defeat-presentation']) {
  const advanced = postSettlementEntryFixture({ contextKind, owningFloor: contextKind === 'blocking-post-clear-boundary' ? 2 : 8, owningAttempt: 4, resultingFloor: 9, resultingAttempt: 4 });
  if (!advanced.cancelOld || advanced.resumed || advanced.partySelections !== 0 || advanced.armamentEvaluations !== 1 || advanced.floorEntryCheckpoints !== 1 || advanced.attemptStarts !== 1 || advanced.startedFloor !== 9) fail(contextKind + ' compressed re-clear fixture did not cancel the old suffix and enter the committed advanced floor once');
}
const unchangedCombat = postSettlementEntryFixture({ contextKind: 'active-combat', owningDawn: 2, owningFloor: 7, owningAttempt: 13, resultingDawn: 2, resultingFloor: 7, resultingAttempt: 13 });
if (!unchangedCombat.resumed || unchangedCombat.cancelOld || unchangedCombat.attemptStarts !== 0 || unchangedCombat.floorEntryCheckpoints !== 0) fail('unchanged active-combat settlement did not resume byte-exactly');
for (const floor of [1, 10, 21]) {
  const stable = postSettlementEntryFixture({ resultingFloor: floor });
  if (stable.resumed || stable.partySelections !== 0 || stable.armamentEvaluations !== 1 || stable.floorEntryCheckpoints !== 1 || stable.attemptStarts !== 1 || stable.startedFloor !== floor) fail('null stable-context fixture did not enter F' + floor + ' exactly once without a party rerank');
}
const offlineDawnEntry = postSettlementEntryFixture({ contextKind: 'wave-gap', owningDawn: 1, owningFloor: 20, owningAttempt: 30, resultingDawn: 2, resultingFloor: 1, resultingAttempt: 30, offlineDawn: true });
if (!offlineDawnEntry.cancelOld || offlineDawnEntry.partySelections !== 1 || offlineDawnEntry.armamentEvaluations !== 1 || offlineDawnEntry.floorEntryCheckpoints !== 0 || offlineDawnEntry.attemptStarts !== 1 || offlineDawnEntry.startedFloor !== 1) fail('offline-Dawn exit did not select party and armament once and start F1 without a second checkpoint');
const initialTutorialReturn = postSettlementEntryFixture({ initialTutorial: true });
if (initialTutorialReturn.preTapAttemptStarts !== 0 || initialTutorialReturn.acceptedTaps !== 1 || initialTutorialReturn.forcedGuardRequests !== 1 || initialTutorialReturn.pendingInitialTutorialGuard || !initialTutorialReturn.autoDispatchUnlocked || initialTutorialReturn.floorEntryCheckpoints !== 0 || initialTutorialReturn.attemptStarts !== 1 || initialTutorialReturn.startedFloor !== 1) fail('passing initial null-context tutorial skipped or duplicated the F1 tap, gated guard or A1');
const rejectedTutorial = postSettlementEntryFixture({ initialTutorial: true, tutorialGatePass: false });
if (rejectedTutorial.acceptedTaps !== 1 || rejectedTutorial.forcedGuardRequests !== 0 || !rejectedTutorial.pendingInitialTutorialGuard || rejectedTutorial.requestOrdinal !== 0 || rejectedTutorial.spawnOrdinal !== 0 || rejectedTutorial.combatEventOrdinal !== 0 || rejectedTutorial.contextKind !== 'defeat-presentation') fail('rejected F1 one-hit gate created a helper/event or lost its pending tutorial guard');
const retryTutorialPass = { ...rejectedTutorial, forcedGuardRequests: 1, pendingInitialTutorialGuard: false, requestOrdinal: 1, spawnOrdinal: 1, contextKind: 'active-combat', attemptStarts: 2 };
if (retryTutorialPass.acceptedTaps !== 1 || retryTutorialPass.forcedGuardRequests !== 1 || retryTutorialPass.pendingInitialTutorialGuard || retryTutorialPass.requestOrdinal !== 1 || retryTutorialPass.spawnOrdinal !== 1 || retryTutorialPass.contextKind !== 'active-combat' || retryTutorialPass.attemptStarts !== 2) fail('later passing F1 retry did not materialize the pending guard exactly once without repeating the tutorial tap');
for (const token of ['combatRules.partySelectionEvaluationRule exactly once', 'comparisonFloor=1', 'no post-reset caller may select the party again', 'no pre-Dawn cat level, shop, relic, support, coins, party or HP is visible', 'activeCatchupForMaximumFloor result']) {
  if (!candidate.dawn.reset.party.toLowerCase().includes(token.toLowerCase())) fail('Dawn reset party ownership omits: ' + token);
}
for (const token of ['do not rerun party selection', 'decisionPolicies.armament exactly once for F1', 'no F4 tutorial exemption', 'floorAttemptStart for F1 exactly once', 'no additional floor-entry Dawn checkpoint']) {
  if (!candidate.dawn.reset.postExecutionF1EntryRule.includes(token)) fail('Dawn post-execution F1 suffix omits: ' + token);
}
const durablePhaseRule = candidate.returnSchedules.interruptionDurablePhaseRule;
for (const token of ['boundary-committed-awaiting-settlement', 'retry-prepared-awaiting-suggestion-probe', 'retry-probed-awaiting-settlement', 'settlement-committed-awaiting-context-validation', 'settlement-committed-awaiting-original-checkpoint', 'settlement-committed-awaiting-failure-resolution', 'awaiting-result-floor-entry', 'awaiting-transition', 'reload dispatches only from the stored phase', 'CAS failure leaves the prior awaiting-settlement phase']) {
  if (!durablePhaseRule.includes(token)) fail('interruption durable-phase rule omits: ' + token);
}
const deferredClockRule = candidate.returnSchedules.deferredSettlementClockRule;
for (const token of ['on a legal return read returnWallClockUnixMs exactly once', 'offline return beyond maximumWallClockSeconds is not synthesized', 'deferredLogicalBaseMs=maximum(preReturnMonotonicClockMs,monotonicReturnBaseMs)', 'independently advances the scenario measurement clocks', 'computed from scenario.resultWallElapsedMs and scenario.resultForegroundElapsedMs', 'Equality is legal', 'advance only the applicable scenario result clock or clocks to the earliest exact maximum', 'leave system.monotonicClockMs and system.foregroundClockMs at the last durable hide/boundary state', 'preserve the armed pending event and last durable context', 'full final-batch rollback', 'system.monotonicClockMs=deferredLogicalBaseMs+resumedForegroundMs', 'preserves the current logical clock', 'Any committed gameplay clock result below either the pre-return logical clock']) {
  if (!deferredClockRule.includes(token)) fail('deferred settlement clock rule omits: ' + token);
}
const deferredClockFixture = (preReturnMs, returnBaseMs, resumedForegroundMs) => Math.max(preReturnMs, returnBaseMs) + resumedForegroundMs;
if (deferredClockFixture(1000, 5000, 300) !== 5300 || deferredClockFixture(6000, 5000, 300) !== 6300) fail('deferred settlement clock fixture is not monotonic');
for (const token of ['persisted nonnegative safe-integer gameplay logical wall clock', 'active gameplay execution owner', 'scenario result time continues only under scenarioMeasurementClockRule', 'pending.hiddenAtMonotonicMs is the active gameplay execution owner', 'transactionDraft value that may be later than the externally visible boundary-base', 'For authoritative Step 2/3 execution', 'set injected hiddenAtWallClockUnixMs=scenario.resultWallElapsedMs', 'secondary-branch standard-schedule diagnostic is the sole Step 2/3 exception', 'diagnosticWallClockBaseMs+diagnosticElapsedWallMs', 'never reads scenario.resultWallElapsedMs', 'return later than the scenario maximum is never synthesized', 'scenario.resultWallElapsedMs advances only to the exact maximum', 'system.monotonicClockMs remains at the hide boundary', 'pending event/context remains unsettled', 'Runtime is not subject to the simulation\'s 30-day stop', '24-hour reward cap']) {
  if (!candidate.clockModel.monotonicClockLifecycle.includes(token)) fail('monotonic clock lifecycle omits simulation segment clipping: ' + token);
}
const requiredClockModelFields = ['scenarioMeasurementClockInitialState', 'scenarioMeasurementClockRule', 'gameplayExecutionClockRule', 'diagnosticHorizonClockRule', 'foregroundProgressionTime', 'wallClockElapsedTime'];
for (const field of requiredClockModelFields) {
  if (!schema.properties?.clockModel?.required?.includes(field)) fail('schema negative fixture would accept a missing clock-model field: ' + field);
}
if (!sameJson(candidate.clockModel.scenarioMeasurementClockInitialState, {resultWallElapsedMs: 0, resultForegroundElapsedMs: 0})) fail('scenario measurement clocks do not initialize exactly at zero');
for (const token of ['simulator-owned non-persisted scenario envelope', 'scenario.resultWallElapsedMs and scenario.resultForegroundElapsedMs', 'sole authoritative operands for maximumWallClockSeconds and maximumForegroundSeconds', 'TransactionDraft, deferred-suffix, settlement or other gameplay rollback never rewinds them', 'earliest exact inclusive maximum', 'Non-mutating diagnostic clones', 'neither read nor mutate these counters', 'equality is not required after an atomic rollback']) {
  if (!candidate.clockModel.scenarioMeasurementClockRule.includes(token)) fail('scenario measurement clock rule omits: ' + token);
}
for (const token of ['innermost transactionDraft or deferred transaction clone', 'externally visible system state', 'successful owner commit publishes both', 'rejection discards both back to the last durable boundary', 'Preserve manualCommandAnchorForegroundMs', 'pending.hiddenAtMonotonicMs is copied from the transactionDraft', 'pair it with injected hiddenAtWallClockUnixMs=scenario.resultWallElapsedMs', 'pair it instead with diagnosticWallClockBaseMs+diagnosticElapsedWallMs', 'externally visible gameplay clocks remain at boundaryBaseGameplay']) {
  if (!candidate.clockModel.gameplayExecutionClockRule.includes(token)) fail('gameplay execution clock rule omits: ' + token);
}
const diagnosticClockRule = candidate.clockModel.diagnosticHorizonClockRule;
for (const token of ['effectComposition.boundedDecisionProjectionProcedure', 'dawn.decisionPolicy.projectionProcedure', 'dawn.branchSpendPolicy.afterPrimaryCapChooseHighestMarginalEffectivePower', 'dawn.firstReturnToPriorMaximumEvaluationProcedure', 'acceptance.activeToPassiveThreeMinuteProcedure', 'retains the source\'s absolute system.monotonicClockMs', 'system.foregroundClockMs', 'system.manualCommandAnchorForegroundMs', 'system.floorAttemptOrdinal', 'diagnosticElapsedWallMs=0', 'diagnosticElapsedForegroundMs=0', 'diagnosticAttemptCount=0', 'diagnosticWallClockBaseMs=maximum(source.system.monotonicClockMs,source.system.lastAcceptedWallClockUnixMs when non-null else 0)', 'sole injected hide/return host-wall timestamp within the clone', 'compares rollback quarantine only with the clone\'s high-water mark', 'source pending/high-water state', 'never read as diagnostic elapsed', '300000ms wall and foreground', 'active-to-passive comparison runs 180000ms wall and foreground', '86400000ms wall and 720000ms foreground', 'maximumForegroundSeconds*1000 local wall and foreground', 'diagnosticAttemptCount, not the retained source system.floorAttemptOrdinal', 'isolated clone-local counters from stopCounterLifecycleRule', 'identical diagnosticWallClockBaseMs and zero local counters', 'dawn.branchSpendPolicy.secondaryBranchEarlyTerminalRule and acceptance.activeToPassiveEarlyTerminalRule', 'only cases that pad diagnostic local clocks after an early atomic F100 success', 'gameplay time, completion metrics and the terminal snapshot frozen', 'successful endpoint rather than INCOMPLETE', 'final offline return exactly at diagnosticElapsedWallMs=86400000', 'resumedForegroundMs>0', 'pendingOfflineEvent, frozenForegroundContext or transactionDraft remains', 'do not score the durable pre-return or partially settled state', 'mark only that candidate\'s marginal score non-finite', 'loop stops with shards unspent']) {
  if (!diagnosticClockRule.includes(token)) fail('diagnostic horizon clock rule omits: ' + token);
}
for (const [label, text, tokens] of [
  ['bounded utility', candidate.effectComposition.boundedDecisionProjectionProcedure, ['clockModel.diagnosticHorizonClockRule', 'full local 300000ms horizon', 'regardless of authoritative scenario time remaining']],
  ['Dawn projection', candidate.dawn.decisionPolicy.projectionProcedure, ['clockModel.diagnosticHorizonClockRule', 'full local 300000ms wall/foreground horizon', 'regardless of authoritative scenario time or floor-attempt budget already consumed', 'apply projectionUnresolvedChoiceRule exactly', 'do not select it, retain a partial floor-clear draft or invent a purchase checkpoint', 'resulting durable ending clone']],
  ['Dawn secondary branch', candidate.dawn.branchSpendPolicy.afterPrimaryCapChooseHighestMarginalEffectivePower, ['clockModel.diagnosticHorizonClockRule', 'all 86400000ms wall and 720000ms foreground', 'regardless of authoritative scenario time or floor-attempt budget already consumed', 'apply secondaryBranchEarlyTerminalRule', 'complete return/settlement/disabled-Dawn/context-validation fixed point needs zero positive foreground time', 'leaves no pending event, frozen context or transaction draft', 'non-finite marginal score', 'never extend the schedule', 'never score a pre-return or partially settled state', 'valid settled or early-terminal-padded schedule']],
  ['Dawn first return', candidate.dawn.firstReturnToPriorMaximumEvaluationProcedure, ['clockModel.diagnosticHorizonClockRule', 'local diagnostic clocks start at 0', 'exact local inclusive horizon', 'independent of authoritative scenario time or floor-attempt budget already consumed']],
  ['active/passive comparison', candidate.acceptance.activeToPassiveThreeMinuteProcedure, ['clockModel.diagnosticHorizonClockRule', 'exactly the first 180 foreground seconds', 'apply activeToPassiveEarlyTerminalRule', 'any other incomplete/error clone fails its pair']]
]) {
  for (const token of tokens) if (!text.includes(token)) fail(label + ' does not bind diagnostic clock semantics: ' + token);
}
if (!schema.properties?.dawn?.properties?.branchSpendPolicy?.required?.includes('secondaryBranchEarlyTerminalRule')) fail('schema negative fixture would accept a missing Dawn secondary early-terminal rule');
const secondaryBranchEarlyTerminalRule = candidate.dawn.branchSpendPolicy.secondaryBranchEarlyTerminalRule;
for (const token of ['only when the secondary-branch standard-schedule diagnostic atomically latches valid F100 success', 'diagnosticElapsedWallMs=86400000', 'byte-exact terminal gameplay snapshot and its original completion timestamp', 'pendingOfflineEvent=null, frozenForegroundContext=null and transactionDraft=null', 'Freeze all run, profile and system fields', 'system.monotonicClockMs, system.foregroundClockMs, coins, U snapshots, levels, HP, event queue, counters, ordinals, stateRevision and completion metrics', 'schedule and mutate no event, hide, return, settlement, income, purchase, Dawn, transition or postgame action', 'type-aware padding', 'remaining declared foreground millisecond', 'remaining offline millisecond only to diagnosticElapsedWallMs', 'including the unconsumed suffix of the segment containing the latch', 'equal exactly 86400000 and 720000', 'not simulation time', 'does not alter the frozen F100 completion timestamp or source', 'finite ending effectivePowerScalar from the frozen terminal gameplay snapshot', 'do not invoke the secondary final-offline return rule']) {
  if (!secondaryBranchEarlyTerminalRule.includes(token)) fail('Dawn secondary early-terminal rule omits: ' + token);
}
const secondaryEarlyF100PaddingFixture = ({latchDiagnosticWallMs, latchDiagnosticForegroundMs, terminal}) => ({
  diagnosticElapsedWallMs: 86400000,
  diagnosticElapsedForegroundMs: 720000,
  paddedWallMs: 86400000 - latchDiagnosticWallMs,
  paddedForegroundMs: 720000 - latchDiagnosticForegroundMs,
  terminal,
  completionWallMs: latchDiagnosticWallMs,
  gameplayMutationCountAfterLatch: 0,
  hideReturnSettlementCountAfterLatch: 0,
  incomePurchaseDawnCountAfterLatch: 0,
  finiteScore: true,
  sourceUnchanged: true
});
const earlyF100BeforeFirstOffline = secondaryEarlyF100PaddingFixture({latchDiagnosticWallMs: 300000, latchDiagnosticForegroundMs: 300000, terminal: {systemMonotonicClockMs: 4300000, systemForegroundClockMs: 2300000, coins: 123, u: 2.5, combatCount: 777, economyCount: 88, completionTimestampMs: 300000, pending: null, frozen: null, draft: null}});
const earlyF100BetweenSessions = secondaryEarlyF100PaddingFixture({latchDiagnosticWallMs: 29160000, latchDiagnosticForegroundMs: 360000, terminal: {systemMonotonicClockMs: 33160000, systemForegroundClockMs: 2360000, coins: 456, u: 3.5, combatCount: 888, economyCount: 99, completionTimestampMs: 29160000, pending: null, frozen: null, draft: null}});
if (!sameJson(earlyF100BeforeFirstOffline, {diagnosticElapsedWallMs: 86400000, diagnosticElapsedForegroundMs: 720000, paddedWallMs: 86100000, paddedForegroundMs: 420000, terminal: {systemMonotonicClockMs: 4300000, systemForegroundClockMs: 2300000, coins: 123, u: 2.5, combatCount: 777, economyCount: 88, completionTimestampMs: 300000, pending: null, frozen: null, draft: null}, completionWallMs: 300000, gameplayMutationCountAfterLatch: 0, hideReturnSettlementCountAfterLatch: 0, incomePurchaseDawnCountAfterLatch: 0, finiteScore: true, sourceUnchanged: true})
  || !sameJson(earlyF100BetweenSessions, {diagnosticElapsedWallMs: 86400000, diagnosticElapsedForegroundMs: 720000, paddedWallMs: 57240000, paddedForegroundMs: 360000, terminal: {systemMonotonicClockMs: 33160000, systemForegroundClockMs: 2360000, coins: 456, u: 3.5, combatCount: 888, economyCount: 99, completionTimestampMs: 29160000, pending: null, frozen: null, draft: null}, completionWallMs: 29160000, gameplayMutationCountAfterLatch: 0, hideReturnSettlementCountAfterLatch: 0, incomePurchaseDawnCountAfterLatch: 0, finiteScore: true, sourceUnchanged: true})) fail('Dawn secondary early-F100 padding mutated the terminal snapshot/metric, failed exact type-aware horizon padding or rejected a finite strong candidate');
if (!schema.properties?.acceptance?.required?.includes('activeToPassiveEarlyTerminalRule')) fail('schema negative fixture would accept a missing active/passive early-terminal rule');
const activeToPassiveEarlyTerminalRule = candidate.acceptance.activeToPassiveEarlyTerminalRule;
for (const token of ['either active/passive diagnostic clone atomically latches valid F100 success', 'diagnosticElapsedForegroundMs=180000', 'byte-exact terminal gameplay snapshot and completion timestamp', 'pendingOfflineEvent=null, frozenForegroundContext=null and transactionDraft=null', 'Freeze every run, profile and system field, gameplay clock, completion metric, coin, U, level, HP, event, counter, ordinal and revision', 'schedule and mutate no income, combat, event, purchase, Dawn, transition, hide, return, settlement or postgame action', 'only that clone\'s diagnosticElapsedWallMs and diagnosticElapsedForegroundMs', 'each equals exactly 180000', 'finite endpoint effectivePowerScalar from the frozen terminal state', 'paired nonterminal clone continues normally', 'neither source clone nor the other pair member is altered']) {
  if (!activeToPassiveEarlyTerminalRule.includes(token)) fail('active/passive early-terminal rule omits: ' + token);
}
const activePassiveEarlyTerminalFixture = ({terminalAtMs, terminalState, nonterminalEndpointPower}) => ({
  active: {diagnosticElapsedWallMs: 180000, diagnosticElapsedForegroundMs: 180000, paddedMs: 180000 - terminalAtMs, terminalState, gameplayMutationCountAfterLatch: 0, incomeAfterLatch: 0, finitePower: terminalState.power},
  passive: {diagnosticElapsedWallMs: 180000, diagnosticElapsedForegroundMs: 180000, finitePower: nonterminalEndpointPower},
  comparisonFloor: 100,
  pairValid: true,
  sourcesUnchanged: true
});
if (!sameJson(activePassiveEarlyTerminalFixture({terminalAtMs: 150000, terminalState: {power: 200, coins: 50, completionTimestampMs: 150000, systemForegroundClockMs: 150000, pending: null, frozen: null, draft: null}, nonterminalEndpointPower: 150}), {
  active: {diagnosticElapsedWallMs: 180000, diagnosticElapsedForegroundMs: 180000, paddedMs: 30000, terminalState: {power: 200, coins: 50, completionTimestampMs: 150000, systemForegroundClockMs: 150000, pending: null, frozen: null, draft: null}, gameplayMutationCountAfterLatch: 0, incomeAfterLatch: 0, finitePower: 200},
  passive: {diagnosticElapsedWallMs: 180000, diagnosticElapsedForegroundMs: 180000, finitePower: 150},
  comparisonFloor: 100,
  pairValid: true,
  sourcesUnchanged: true
})) fail('active/passive early-F100 padding mutated terminal income/gameplay/metric, altered its pair or failed the exact 180-second finite endpoint');
if (!schema.properties?.dawn?.properties?.decisionPolicy?.required?.includes('projectionUnresolvedChoiceRule')) fail('schema negative fixture would accept a missing Dawn projection unresolved-choice rule');
const projectionUnresolvedChoiceRule = candidate.dawn.decisionPolicy.projectionUnresolvedChoiceRule;
for (const token of ['sole 300-second Dawn-projection exception', 'before drawing or consuming its decision delay, contact or option', 'require the open transactionDraft owned by clockModel.postClearDraftRevisionRule', 'discard it atomically to boundaryBaseGameplay', 'restore the pre-final-batch enemy EHP, party HP, event queue, timers, currentFloor, highest floors, coins and liveIncomeAccruedFraction', 'remove the final batch, clear/reward/U/unlock/seal/boss/cat/achievement/armament/reconfiguration/purchase deltas, logs, ordinals and contacts', 'restore system.stateRevision, committedCombatEventCount and committedEconomyCount exactly', 'diagnosticElapsedWallMs and diagnosticElapsedForegroundMs already consumed before the checkpoint do not rewind', 'accrue only shopModel.liveIncomeAccrual from the boundary-base shop state', 'execute no purchase policy because no after-floor-reward evaluation point committed', 'transactionDraft=null, pendingOfflineEvent=null and frozenForegroundContext=null', 'purchaseEvaluationOrdinal and both clone-local committed counters equal their boundary-base values', 'durable income-only endpoint']) {
  if (!projectionUnresolvedChoiceRule.includes(token)) fail('Dawn projection unresolved-choice rule omits: ' + token);
}
const projectionChoiceRollbackFixture = ({boundaryBase, stagedDraft, diagnosticElapsedBeforeMs, remainingMs, liveIncomePerMs}) => ({
  enemyEhp: boundaryBase.enemyEhp,
  partyHp: boundaryBase.partyHp,
  eventQueue: boundaryBase.eventQueue,
  currentFloor: boundaryBase.currentFloor,
  highestFloor: boundaryBase.highestFloor,
  coins: boundaryBase.coins + remainingMs * liveIncomePerMs,
  u: boundaryBase.u,
  reward: false,
  choice: false,
  unlock: boundaryBase.unlock,
  stateRevision: boundaryBase.stateRevision,
  committedCombatEventCount: boundaryBase.committedCombatEventCount,
  committedEconomyCount: boundaryBase.committedEconomyCount,
  purchaseEvaluationOrdinal: boundaryBase.purchaseEvaluationOrdinal,
  eventOrdinal: boundaryBase.eventOrdinal,
  transactionDraft: null,
  pendingOfflineEvent: null,
  frozenForegroundContext: null,
  diagnosticElapsedWallMs: diagnosticElapsedBeforeMs + remainingMs,
  diagnosticElapsedForegroundMs: diagnosticElapsedBeforeMs + remainingMs,
  stagedDraftWasScored: false,
  purchasePolicyRanAfterRollback: false,
  ignoredStagedReward: stagedDraft.reward
});
const rolledBackF9Projection = projectionChoiceRollbackFixture({
  boundaryBase: {enemyEhp: 5, partyHp: 40, eventQueue: ['final-impact'], currentFloor: 9, highestFloor: 8, coins: 100, u: 1, unlock: false, stateRevision: 12, committedCombatEventCount: 90, committedEconomyCount: 20, purchaseEvaluationOrdinal: 7, eventOrdinal: 500},
  stagedDraft: {enemyEhp: 0, partyHp: 35, eventQueue: [], currentFloor: 9, highestFloor: 9, coins: 130, u: 1.2, reward: true, unlock: true, committedCombatEventCount: 92, committedEconomyCount: 21, purchaseEvaluationOrdinal: 8, eventOrdinal: 502},
  diagnosticElapsedBeforeMs: 200000,
  remainingMs: 100000,
  liveIncomePerMs: 0.00005
});
if (!sameJson(rolledBackF9Projection, {enemyEhp: 5, partyHp: 40, eventQueue: ['final-impact'], currentFloor: 9, highestFloor: 8, coins: 105, u: 1, reward: false, choice: false, unlock: false, stateRevision: 12, committedCombatEventCount: 90, committedEconomyCount: 20, purchaseEvaluationOrdinal: 7, eventOrdinal: 500, transactionDraft: null, pendingOfflineEvent: null, frozenForegroundContext: null, diagnosticElapsedWallMs: 300000, diagnosticElapsedForegroundMs: 300000, stagedDraftWasScored: false, purchasePolicyRanAfterRollback: false, ignoredStagedReward: true})) fail('Dawn F9 projection choice blocker exposed a partial clear draft, rewound diagnostic time, ran a nonexistent purchase checkpoint or failed to accrue boundary-base live income');
const scheduleSegmentRule = candidate.stopPolicy.scheduleSegmentBoundaryRule;
for (const token of ['Step 2/3 authoritative scenario execution alone applies this rule', 'five non-mutating consumers named by clockModel.diagnosticHorizonClockRule', 'remainingWallMs=maximumWallClockSeconds*1000-scenario.resultWallElapsedMs', 'remainingForegroundMs=maximumForegroundSeconds*1000-scenario.resultForegroundElapsedMs', 'clockModel.scenarioMeasurementClockRule and clockModel.foregroundProgressionTime are the sole metric mappings', 'If remainingWallMs=0', 'do not start the segment, do not arm a hide', 'execute only minimum(requestedSegmentMs,remainingWallMs,remainingForegroundMs)', 'If requestedSegmentMs>remainingWallMs', 'leave the persisted or diagnostic-clone system.monotonicClockMs at the hide boundary', 'do not synthesize returnWallClockUnixMs or monotonicReturnTimestampMs', 'preserve the armed pending event and frozen context byte-exactly', 'If requestedSegmentMs=remainingWallMs', 'complete zero-time return/settlement/Dawn/context fixed point', 'deferredSettlementClockRule preflights its complete positive resumedForegroundMs', 'leaves gameplay system clocks at the last durable state', 'rolls back the owning uncommitted suffix', 'never earns partial offline credit']) {
  if (!scheduleSegmentRule.includes(token)) fail('schedule segment stop-boundary rule omits: ' + token);
}
if (typeof candidate.clockModel.foregroundProgressionTime !== 'string') fail('foreground progression metric mapping must be a required string');
else for (const token of ['foregroundProgressionSeconds=scenario.resultForegroundElapsedMs/1000 exactly', 'remains advanced through a discarded gameplay draft', 'sole authoritative operand for stopPolicy.maximumForegroundSeconds', 'system.foregroundClockMs is the persisted gameplay and command-phase clock', 'not the scenario reporting or stop-budget operand']) {
  if (!candidate.clockModel.foregroundProgressionTime.includes(token)) fail('foreground progression metric mapping omits: ' + token);
}
if (typeof candidate.clockModel.wallClockElapsedTime !== 'string') fail('wall-clock elapsed metric mapping must be a required string');
else for (const token of ['wallClockElapsedSeconds=scenario.resultWallElapsedMs/1000 exactly', 'rolled-back terminal elapsed time', 'system.monotonicClockMs remains the persisted gameplay logical clock', 'not the scenario reporting or stop-budget operand']) {
  if (!candidate.clockModel.wallClockElapsedTime.includes(token)) fail('wall-clock elapsed metric mapping omits: ' + token);
}
const gameplayClockRollbackFixture = ({systemWallMs, systemForegroundMs, resultWallMs, resultForegroundMs, requestedForegroundMs, maximumWallMs, maximumForegroundMs}) => {
  const legalMs = Math.min(maximumWallMs - resultWallMs, maximumForegroundMs - resultForegroundMs);
  if (requestedForegroundMs > legalMs) return {systemWallMs, systemForegroundMs, resultWallMs: resultWallMs + legalMs, resultForegroundMs: resultForegroundMs + legalMs, reportWallSeconds: (resultWallMs + legalMs) / 1000, reportForegroundSeconds: (resultForegroundMs + legalMs) / 1000, committed: false};
  return {systemWallMs: systemWallMs + requestedForegroundMs, systemForegroundMs: systemForegroundMs + requestedForegroundMs, resultWallMs: resultWallMs + requestedForegroundMs, resultForegroundMs: resultForegroundMs + requestedForegroundMs, reportWallSeconds: (resultWallMs + requestedForegroundMs) / 1000, reportForegroundSeconds: (resultForegroundMs + requestedForegroundMs) / 1000, committed: true};
};
const rejectedClockSuffix = gameplayClockRollbackFixture({systemWallMs: 21599000, systemForegroundMs: 21599000, resultWallMs: 21599000, resultForegroundMs: 21599000, requestedForegroundMs: 2000, maximumWallMs: 21600000, maximumForegroundMs: 21600000});
const acceptedClockSuffix = gameplayClockRollbackFixture({systemWallMs: 900, systemForegroundMs: 900, resultWallMs: 900, resultForegroundMs: 900, requestedForegroundMs: 100, maximumWallMs: 1000, maximumForegroundMs: 1000});
if (!sameJson(rejectedClockSuffix, {systemWallMs: 21599000, systemForegroundMs: 21599000, resultWallMs: 21600000, resultForegroundMs: 21600000, reportWallSeconds: 21600, reportForegroundSeconds: 21600, committed: false})
  || !sameJson(acceptedClockSuffix, {systemWallMs: 1000, systemForegroundMs: 1000, resultWallMs: 1000, resultForegroundMs: 1000, reportWallSeconds: 1, reportForegroundSeconds: 1, committed: true})) fail('scenario result clocks rewound with a rejected gameplay draft or diverged on a successful exact-boundary commit');
const diagnosticHorizonFixture = ({sourceWallMs, sourceForegroundMs, sourceAttemptOrdinal, localWallMs, localForegroundMs, localAttempts}) => ({
  sourceWallMs,
  sourceForegroundMs,
  sourceAttemptOrdinal,
  diagnosticElapsedWallMs: localWallMs,
  diagnosticElapsedForegroundMs: localForegroundMs,
  diagnosticAttemptCount: localAttempts,
  cloneAttemptOrdinal: sourceAttemptOrdinal + localAttempts
});
const lateUtilityDiagnostic = diagnosticHorizonFixture({sourceWallMs: 2591999999, sourceForegroundMs: 21599999, sourceAttemptOrdinal: 4999, localWallMs: 300000, localForegroundMs: 300000, localAttempts: 2});
const lateStandardDiagnostic = diagnosticHorizonFixture({sourceWallMs: 2591999999, sourceForegroundMs: 21599999, sourceAttemptOrdinal: 4999, localWallMs: 86400000, localForegroundMs: 720000, localAttempts: 8});
if (!sameJson(lateUtilityDiagnostic, {sourceWallMs: 2591999999, sourceForegroundMs: 21599999, sourceAttemptOrdinal: 4999, diagnosticElapsedWallMs: 300000, diagnosticElapsedForegroundMs: 300000, diagnosticAttemptCount: 2, cloneAttemptOrdinal: 5001})
  || !sameJson(lateStandardDiagnostic, {sourceWallMs: 2591999999, sourceForegroundMs: 21599999, sourceAttemptOrdinal: 4999, diagnosticElapsedWallMs: 86400000, diagnosticElapsedForegroundMs: 720000, diagnosticAttemptCount: 8, cloneAttemptOrdinal: 5007})
  || Math.min(300000, 2592000000 - lateUtilityDiagnostic.sourceWallMs, 21600000 - lateUtilityDiagnostic.sourceForegroundMs) !== 1) fail('diagnostic horizon inherited source time/attempt budget or authoritative execution failed to clip from the same late source');
const diagnosticOfflineClockFixture = ({sourceMonotonicMs, sourceLastAcceptedWallMs}) => {
  const diagnosticWallClockBaseMs = Math.max(sourceMonotonicMs, sourceLastAcceptedWallMs ?? 0);
  const firstHideMs = diagnosticWallClockBaseMs + 360000;
  const firstReturnMs = firstHideMs + 28800000;
  const firstRollbackQuarantined = firstHideMs < sourceLastAcceptedWallMs;
  const cloneHighWaterAfterFirst = firstReturnMs;
  const secondHideMs = diagnosticWallClockBaseMs + 29520000;
  const secondReturnMs = secondHideMs + 56880000;
  const secondRollbackQuarantined = secondHideMs < cloneHighWaterAfterFirst;
  return {diagnosticWallClockBaseMs, firstHideMs, firstReturnMs, firstElapsedMs: firstReturnMs - firstHideMs, firstRollbackQuarantined, secondHideMs, secondReturnMs, secondElapsedMs: secondReturnMs - secondHideMs, secondRollbackQuarantined, sourceMonotonicMs, sourceLastAcceptedWallMs};
};
if (!sameJson(diagnosticOfflineClockFixture({sourceMonotonicMs: 2591999999, sourceLastAcceptedWallMs: 2591999500}), {
  diagnosticWallClockBaseMs: 2591999999,
  firstHideMs: 2592359999,
  firstReturnMs: 2621159999,
  firstElapsedMs: 28800000,
  firstRollbackQuarantined: false,
  secondHideMs: 2621519999,
  secondReturnMs: 2678399999,
  secondElapsedMs: 56880000,
  secondRollbackQuarantined: false,
  sourceMonotonicMs: 2591999999,
  sourceLastAcceptedWallMs: 2591999500
})) fail('diagnostic standard schedule used authoritative result time, quarantined a legal local offline interval, lost elapsed credit or mutated source high-water state');
const secondaryDiagnosticFinalReturnFixture = ({requiredResumeMs, pendingAfterZeroTime, frozenAfterZeroTime, draftAfterZeroTime}) => {
  const valid = requiredResumeMs === 0 && !pendingAfterZeroTime && !frozenAfterZeroTime && !draftAfterZeroTime;
  return {diagnosticWallMs: 86400000, diagnosticForegroundMs: 720000, scheduleExtended: false, settlementScored: valid, preReturnScored: false, marginalScore: valid ? 'finite' : 'non-finite'};
};
const settledFinalDiagnostic = secondaryDiagnosticFinalReturnFixture({requiredResumeMs: 0, pendingAfterZeroTime: false, frozenAfterZeroTime: false, draftAfterZeroTime: false});
const blockedFinalDiagnostic = secondaryDiagnosticFinalReturnFixture({requiredResumeMs: 1, pendingAfterZeroTime: true, frozenAfterZeroTime: true, draftAfterZeroTime: true});
const residualZeroTimeDiagnostic = secondaryDiagnosticFinalReturnFixture({requiredResumeMs: 0, pendingAfterZeroTime: true, frozenAfterZeroTime: false, draftAfterZeroTime: false});
if (!sameJson(settledFinalDiagnostic, {diagnosticWallMs: 86400000, diagnosticForegroundMs: 720000, scheduleExtended: false, settlementScored: true, preReturnScored: false, marginalScore: 'finite'})
  || !sameJson(blockedFinalDiagnostic, {diagnosticWallMs: 86400000, diagnosticForegroundMs: 720000, scheduleExtended: false, settlementScored: false, preReturnScored: false, marginalScore: 'non-finite'})
  || !sameJson(residualZeroTimeDiagnostic, {diagnosticWallMs: 86400000, diagnosticForegroundMs: 720000, scheduleExtended: false, settlementScored: false, preReturnScored: false, marginalScore: 'non-finite'})) fail('secondary-branch final return extended the exact day, scored a blocked/partial endpoint or rejected a complete zero-time settlement');
const offlineSegmentBoundaryFixture = ({startSystemWallMs, startResultWallMs, requestedOfflineMs, maximumWallMs, deferredResumeMs = 0, remainingForegroundMs = Number.MAX_SAFE_INTEGER}) => {
  const remainingWallMs = maximumWallMs - startResultWallMs;
  if (remainingWallMs === 0) return {systemWallMs: startSystemWallMs, resultWallMs: maximumWallMs, hideArmed: false, returnSynthesized: false, settlementCommitted: false, pendingPreserved: false, suffixCommitted: false, rollback: false, creditedOfflineMs: 0};
  if (requestedOfflineMs > remainingWallMs) return {systemWallMs: startSystemWallMs, resultWallMs: maximumWallMs, hideArmed: true, returnSynthesized: false, settlementCommitted: false, pendingPreserved: true, suffixCommitted: false, rollback: false, creditedOfflineMs: 0};
  const returnWallMs = startResultWallMs + requestedOfflineMs;
  const wallAfterReturnRemaining = maximumWallMs - returnWallMs;
  if (deferredResumeMs > Math.min(wallAfterReturnRemaining, remainingForegroundMs)) return {systemWallMs: startSystemWallMs, resultWallMs: maximumWallMs, hideArmed: true, returnSynthesized: true, settlementCommitted: false, pendingPreserved: true, suffixCommitted: false, rollback: true, creditedOfflineMs: 0};
  return {systemWallMs: returnWallMs + deferredResumeMs, resultWallMs: returnWallMs + deferredResumeMs, hideArmed: true, returnSynthesized: true, settlementCommitted: true, pendingPreserved: false, suffixCommitted: deferredResumeMs > 0, rollback: false, creditedOfflineMs: requestedOfflineMs};
};
const startAtMaximum = offlineSegmentBoundaryFixture({startSystemWallMs: 100000, startResultWallMs: 100000, requestedOfflineMs: 10000, maximumWallMs: 100000});
const crossingOfflineStop = offlineSegmentBoundaryFixture({startSystemWallMs: 90000, startResultWallMs: 90000, requestedOfflineMs: 20000, maximumWallMs: 100000});
const exactOfflineReturn = offlineSegmentBoundaryFixture({startSystemWallMs: 90000, startResultWallMs: 90000, requestedOfflineMs: 10000, maximumWallMs: 100000});
const deferredResumeCrossing = offlineSegmentBoundaryFixture({startSystemWallMs: 80000, startResultWallMs: 80000, requestedOfflineMs: 10000, maximumWallMs: 100000, deferredResumeMs: 15000, remainingForegroundMs: 20000});
const deferredResumeExact = offlineSegmentBoundaryFixture({startSystemWallMs: 80000, startResultWallMs: 80000, requestedOfflineMs: 10000, maximumWallMs: 100000, deferredResumeMs: 10000, remainingForegroundMs: 10000});
if (!sameJson(startAtMaximum, {systemWallMs: 100000, resultWallMs: 100000, hideArmed: false, returnSynthesized: false, settlementCommitted: false, pendingPreserved: false, suffixCommitted: false, rollback: false, creditedOfflineMs: 0})
  || !sameJson(crossingOfflineStop, {systemWallMs: 90000, resultWallMs: 100000, hideArmed: true, returnSynthesized: false, settlementCommitted: false, pendingPreserved: true, suffixCommitted: false, rollback: false, creditedOfflineMs: 0})
  || !sameJson(exactOfflineReturn, {systemWallMs: 100000, resultWallMs: 100000, hideArmed: true, returnSynthesized: true, settlementCommitted: true, pendingPreserved: false, suffixCommitted: false, rollback: false, creditedOfflineMs: 10000})
  || !sameJson(deferredResumeCrossing, {systemWallMs: 80000, resultWallMs: 100000, hideArmed: true, returnSynthesized: true, settlementCommitted: false, pendingPreserved: true, suffixCommitted: false, rollback: true, creditedOfflineMs: 0})
  || !sameJson(deferredResumeExact, {systemWallMs: 100000, resultWallMs: 100000, hideArmed: true, returnSynthesized: true, settlementCommitted: true, pendingPreserved: false, suffixCommitted: true, rollback: false, creditedOfflineMs: 10000})) fail('offline/deferred schedule boundary fixture armed at a spent cap, settled a clipped prefix, rewound scenario result time, exposed a rolled-back gameplay clock, overshot a maximum or rejected exact equality');
for (const token of ['postClearDraftRevisionRule is the sole exception', 'standalone single-level/bulk purchase commit', 'exposes only its one final increment']) {
  if (!candidate.clockModel.persistedStateRevisionRule.includes(token)) fail('persisted revision ownership omits: ' + token);
}
const postClearDraftRevisionRule = candidate.clockModel.postClearDraftRevisionRule;
for (const token of ['boundaryBaseRevision=system.stateRevision', 'boundaryBaseGameplay equal to the exact authoritative pre-final-batch state', 'sameTimestampCombatLimitPreflightRule supplies its fully resolved clone and exactFinalBatchCount without mutating real state', 'none mutates externally visible run/profile fields or system.stateRevision', 'writes the entire draft plus committedCombatEventCount=base+draftCombatEventDelta', 'committedEconomyCount=base+draftEconomyDelta', 'stateRevision=boundaryBaseRevision+1', 'sets frozenForegroundContext.sourceStateRevision and pending.sourceStateRevision to r+1', 'final boundary CAS exposes all gameplay deltas and writes exactly current revision+1', 'nested subtransactions never consume additional state revisions']) {
  if (!postClearDraftRevisionRule.includes(token)) fail('post-clear draft revision rule omits: ' + token);
}
for (const token of ['Maintain draftEconomyDelta from zero and initialize draftCombatEventDelta=exactFinalBatchCount', 'final-batch events, HP/EHP, KOs, objective state, counters, logs, ordinals and post-clear gameplay clock advances remain draft-only', 'scenario measurement clocks advance independently and are never transactional', 'committedEconomyCount+draftEconomyDelta+1', 'committedCombatEventCount+draftCombatEventDelta+exactly 3', 'discard the entire transactionDraft', 'leave externally visible gameplay, HP/EHP, event queue and both committed counts at boundaryBaseGameplay', 'never persist a final-kill or other prefix']) {
  if (!postClearDraftRevisionRule.includes(token)) fail('post-clear draft economy-limit ownership omits: ' + token);
}
for (const token of ['For F1-F99, before every positive-time advance inside the draft', 'complete final boundary CAS is legal', 'Leave system.monotonicClockMs and system.foregroundClockMs at boundaryBaseGameplay', 'scenario.resultWallElapsedMs and scenario.resultForegroundElapsedMs', 'earliest exact time maximum', 'do not expose a gameplay clock, event-queue or counter prefix', 'F100 uses stopPolicy.floor100TerminalRule instead']) {
  if (!postClearDraftRevisionRule.includes(token)) fail('post-clear draft time-limit ownership omits: ' + token);
}
for (const token of ['preflight every nested counted economy unit', "F3 scripted delivery's inseparable three combat arrivals", 'discard the entire draft back to the externally visible boundary-base snapshot', 'F1-F99 final-wave/phase kill', 'discards the entire transactionDraft to boundaryBaseGameplay', 'terminal result records the exact reached clock maximum separately', 'suffix that completes at the exact maximum', 'F100 is the sole override', 'Never partially commit a purchase, Dawn, floor-clear draft']) {
  if (!candidate.stopPolicy.limitBoundaryRule.includes(token)) fail('stop-policy floor-clear atomic limit rule omits: ' + token);
}
const postClearEconomyPreflightFixture = (committedCount, maximumCount, nestedUnits) => {
  let draftEconomyDelta = 0;
  const stagedLogs = [];
  for (const unit of nestedUnits) {
    if (committedCount + draftEconomyDelta + 1 > maximumCount) return { committedCount, visibleState: 'boundary-base', persistedLogs: [], persistedOrdinals: 0, incomplete: true };
    draftEconomyDelta += 1;
    stagedLogs.push(unit);
  }
  return { committedCount: committedCount + draftEconomyDelta, visibleState: 'complete-boundary', persistedLogs: stagedLogs, persistedOrdinals: nestedUnits.length, incomplete: false };
};
const rejectedPostClearAtPurchase = postClearEconomyPreflightFixture(3, 5, ['floor-reward', 'purchase-1', 'purchase-2']);
const exactCapPostClear = postClearEconomyPreflightFixture(3, 5, ['floor-reward', 'purchase-1']);
if (!rejectedPostClearAtPurchase.incomplete || rejectedPostClearAtPurchase.committedCount !== 3 || rejectedPostClearAtPurchase.visibleState !== 'boundary-base' || rejectedPostClearAtPurchase.persistedLogs.length !== 0 || rejectedPostClearAtPurchase.persistedOrdinals !== 0
  || exactCapPostClear.incomplete || exactCapPostClear.committedCount !== 5 || exactCapPostClear.visibleState !== 'complete-boundary' || exactCapPostClear.persistedLogs.length !== 2) fail('post-clear nested economy-limit fixture persisted a prefix or rejected an exact-cap boundary');
const finalClearDraftFixture = ({baseCombat, finalBatch, combatMaximum, baseEconomy, economyUnits, economyMaximum, scriptedArrivals = 0, suffixTiming = 'within', floor = 3}) => {
  const draftCombat = finalBatch + scriptedArrivals;
  const combatFits = baseCombat + draftCombat <= combatMaximum;
  const economyFits = baseEconomy + economyUnits.length <= economyMaximum;
  const timeFits = floor === 100 || suffixTiming === 'within' || suffixTiming === 'exact-boundary';
  if (!combatFits || !economyFits || !timeFits) {
    return {visibleState: 'pre-final-batch', combatCommitted: baseCombat, economyCommitted: baseEconomy, enemyEhp: 5, partyHp: 40, eventOrdinal: 900, reward: false, arrivals: 0, resultClock: suffixTiming === 'within' ? 'unchanged' : 'exact-maximum'};
  }
  return {visibleState: floor === 100 ? 'terminal-success' : 'complete-boundary', combatCommitted: baseCombat + draftCombat, economyCommitted: baseEconomy + economyUnits.length, enemyEhp: 0, partyHp: 35, eventOrdinal: 900 + draftCombat, reward: economyUnits.includes('reward'), arrivals: scriptedArrivals, resultClock: suffixTiming === 'exact-boundary' ? 'exact-maximum' : 'within'};
};
const exactF3CombatDraft = finalClearDraftFixture({baseCombat: 90, finalBatch: 2, combatMaximum: 95, baseEconomy: 9, economyUnits: ['reward'], economyMaximum: 10, scriptedArrivals: 3});
const rejectedEconomyAfterKill = finalClearDraftFixture({baseCombat: 90, finalBatch: 2, combatMaximum: 95, baseEconomy: 9, economyUnits: ['reward'], economyMaximum: 9, scriptedArrivals: 0});
const rejectedF3CombatDraft = finalClearDraftFixture({baseCombat: 90, finalBatch: 2, combatMaximum: 94, baseEconomy: 9, economyUnits: ['reward'], economyMaximum: 10, scriptedArrivals: 3});
const rejectedPostClearTimeDraft = finalClearDraftFixture({baseCombat: 90, finalBatch: 2, combatMaximum: 95, baseEconomy: 9, economyUnits: ['reward'], economyMaximum: 10, suffixTiming: 'later'});
const exactTimePostClearDraft = finalClearDraftFixture({baseCombat: 90, finalBatch: 2, combatMaximum: 95, baseEconomy: 9, economyUnits: ['reward'], economyMaximum: 10, suffixTiming: 'exact-boundary'});
const f100BoundarySuccess = finalClearDraftFixture({baseCombat: 90, finalBatch: 2, combatMaximum: 92, baseEconomy: 8, economyUnits: ['reward'], economyMaximum: 9, suffixTiming: 'exact-boundary', floor: 100});
const f100RewardOverCap = finalClearDraftFixture({baseCombat: 90, finalBatch: 2, combatMaximum: 92, baseEconomy: 9, economyUnits: ['reward'], economyMaximum: 9, suffixTiming: 'exact-boundary', floor: 100});
if (!sameJson(exactF3CombatDraft, {visibleState: 'complete-boundary', combatCommitted: 95, economyCommitted: 10, enemyEhp: 0, partyHp: 35, eventOrdinal: 905, reward: true, arrivals: 3, resultClock: 'within'})
  || !sameJson(rejectedEconomyAfterKill, {visibleState: 'pre-final-batch', combatCommitted: 90, economyCommitted: 9, enemyEhp: 5, partyHp: 40, eventOrdinal: 900, reward: false, arrivals: 0, resultClock: 'unchanged'})
  || !sameJson(rejectedF3CombatDraft, {visibleState: 'pre-final-batch', combatCommitted: 90, economyCommitted: 9, enemyEhp: 5, partyHp: 40, eventOrdinal: 900, reward: false, arrivals: 0, resultClock: 'unchanged'})
  || !sameJson(rejectedPostClearTimeDraft, {visibleState: 'pre-final-batch', combatCommitted: 90, economyCommitted: 9, enemyEhp: 5, partyHp: 40, eventOrdinal: 900, reward: false, arrivals: 0, resultClock: 'exact-maximum'})
  || !sameJson(exactTimePostClearDraft, {visibleState: 'complete-boundary', combatCommitted: 92, economyCommitted: 10, enemyEhp: 0, partyHp: 35, eventOrdinal: 902, reward: true, arrivals: 0, resultClock: 'exact-maximum'})
  || !sameJson(f100BoundarySuccess, {visibleState: 'terminal-success', combatCommitted: 92, economyCommitted: 9, enemyEhp: 0, partyHp: 35, eventOrdinal: 902, reward: true, arrivals: 0, resultClock: 'exact-maximum'})
  || !sameJson(f100RewardOverCap, {visibleState: 'pre-final-batch', combatCommitted: 90, economyCommitted: 9, enemyEhp: 5, partyHp: 40, eventOrdinal: 900, reward: false, arrivals: 0, resultClock: 'exact-maximum'})) fail('final-clear draft fixture exposed a kill/prefix, skipped F100 reward/count, rejected exact caps, or failed the F100 boundary override');
for (const token of ['mandatory floor-reward credit must fit as exactly one economy transaction', 'If either preflight rejects', 'exception covers only the positive-time/generic post-clear suffix', 'never a combat event, reward, U write or economy count', 'The only non-gameplay exceptions are', 'dawn.branchSpendPolicy.secondaryBranchEarlyTerminalRule', 'acceptance.activeToPassiveEarlyTerminalRule', 'pad only its discarded clone\'s diagnosticElapsedWallMs and diagnosticElapsedForegroundMs', 'every gameplay field, system clock and completion metric remains byte-frozen']) {
  if (!candidate.stopPolicy.floor100TerminalRule.includes(token)) fail('F100 terminal count ownership omits: ' + token);
}
for (const token of ['mandatory floor reward with its one economy count', 'skips only the generic suffix', 'does not exempt the final combat batch or reward from their atomic count preflights']) {
  if (!candidate.combatRules.floor100TerminalOverride.includes(token)) fail('F100 terminal override omits: ' + token);
}
for (const [label, ruleText] of [
  ['shop placement', candidate.shopModel.selection.commit],
  ['relic selection', candidate.relicModel.selectionCommit],
  ['purchase', candidate.decisionPolicies.purchase.transaction],
  ['shop reconfiguration', candidate.decisionPolicies.shopReconfiguration.commit]
]) {
  const delegatesWithoutOwnRevision = ruleText.includes('no individual stateRevision increment') || ruleText.includes('persist only with that boundary');
  if (!ruleText.includes('postClearDraftRevisionRule') || !delegatesWithoutOwnRevision) fail(label + ' does not delegate revision ownership to the post-clear draft');
}
const armamentCommitRule = candidate.decisionPolicies.armament.acceptedFamilyChangeCommit;
for (const token of ['weapons.automaticInitialEquipAtUnlock during the F3 post-clear unlock', 'stage it under clockModel.postClearDraftRevisionRule', 'persist only with that F3 boundary', 'one-time F4 tutorial is a standalone pre-F4-wave floor-entry commit', 'before the F4 floor-entry Dawn checkpoint', 'never belongs to an F3 or F4 floorClearCommitOrder draft', 'Every F4 tutorial marker commit and every two-non-null change persists all fields in one standalone stateRevision compare-and-swap']) {
  if (!armamentCommitRule.includes(token)) fail('armament revision ownership omits: ' + token);
}
for (const token of ['blocking-post-clear-boundary', 'hiddenAtWallClockUnixMs', 'equals scenario.resultWallElapsedMs at the segment start', 'diagnosticWallClockBaseMs+diagnosticElapsedWallMs', 'neither reads nor mutates authoritative scenario result time', 'hiddenAtMonotonicMs from the active gameplay execution owner', 'transactionDraft staged system.monotonicClockMs at the hide timestamp', 'not the externally visible boundary-base clock', 'pending anchor may therefore be later than visible system.monotonicClockMs', 'execution owner\'s system.lastAcceptedWallClockUnixMs', 'diagnostic pending, settlement and high-water updates remain inside the discarded clone', 'complete staged U snapshot', 'transactionDraft at the hide timestamp', 'pending.sourceStateRevision and context.sourceStateRevision equal the persisted post-hide revision', 'visible gameplay run/profile and gameplay clocks remain at the boundary-base snapshot']) {
  if (!candidate.offline.settlement.hideTransaction.includes(token)) fail('post-clear hide transaction omits: ' + token);
}
const postClearHideClockFixture = ({boundarySystemMonotonicMs, stagedDraftMonotonicMs, scenarioResultWallElapsedMs}) => ({
  visibleSystemMonotonicMs: boundarySystemMonotonicMs,
  pendingHiddenAtMonotonicMs: stagedDraftMonotonicMs,
  pendingHiddenAtWallClockUnixMs: scenarioResultWallElapsedMs
});
if (!sameJson(postClearHideClockFixture({boundarySystemMonotonicMs: 1000, stagedDraftMonotonicMs: 5400, scenarioResultWallElapsedMs: 5400}), {
  visibleSystemMonotonicMs: 1000,
  pendingHiddenAtMonotonicMs: 5400,
  pendingHiddenAtWallClockUnixMs: 5400
})) fail('mid-delay post-clear hide anchored the pending event to the rolled-back boundary clock instead of the staged hide instant');
const interruptedPostClearFixture = (floor, sourceRevision, purchaseCount) => {
  const relativeKey = String(floor % 10);
  const maximumDelayMs = candidate.timingTargets.firstTimeDecisionSecondsByRelativeFloor[relativeKey][1]
    * candidate.personas['persona.passive'].shopAndRelicDecisionDelayMultiplier * 1000;
  const stagedEconomyCount = 2 + purchaseCount;
  const beforeHide = { stateRevision: sourceRevision, visibleGameplay: 'boundary-base', stagedPurchaseCount: purchaseCount, stagedEconomyCount };
  const afterHide = { ...beforeHide, stateRevision: sourceRevision + 1, contextSourceStateRevision: sourceRevision + 1, pendingSourceStateRevision: sourceRevision + 1 };
  const afterResumeBoundaryCommit = { ...afterHide, stateRevision: afterHide.stateRevision + 1, visibleGameplay: 'complete-boundary' };
  return { maximumDelayMs, beforeHide, afterHide, afterResumeBoundaryCommit };
};
for (const [floor, sourceRevision, purchaseCount] of [[2, 40, 2], [10, 90, 3]]) {
  const fixture = interruptedPostClearFixture(floor, sourceRevision, purchaseCount);
  if (fixture.maximumDelayMs !== candidate.returnSchedules.maximumDeferredForegroundResumeMs
    || fixture.beforeHide.stateRevision !== sourceRevision
    || fixture.beforeHide.visibleGameplay !== 'boundary-base'
    || fixture.afterHide.visibleGameplay !== 'boundary-base'
    || fixture.afterHide.contextSourceStateRevision !== fixture.afterHide.stateRevision
    || fixture.afterHide.pendingSourceStateRevision !== fixture.afterHide.stateRevision
    || fixture.afterResumeBoundaryCommit.stateRevision !== fixture.afterHide.stateRevision + 1
    || fixture.afterResumeBoundaryCommit.stagedPurchaseCount !== purchaseCount
    || fixture.afterResumeBoundaryCommit.stagedEconomyCount !== 2 + purchaseCount
    || fixture.afterResumeBoundaryCommit.visibleGameplay !== 'complete-boundary') fail('F' + floor + ' interrupted maximum-delay post-clear fixture violated atomic revision or staged economy ownership');
}
const maxPersonaDecisionMultiplier = Math.max(...['persona.active', 'persona.baseline', 'persona.passive'].map((id) => candidate.personas[id].shopAndRelicDecisionDelayMultiplier));
const maxDecisionSeconds = Math.max(
  ...Object.values(candidate.timingTargets.firstTimeDecisionSecondsByRelativeFloor).map((range) => range[1]),
  ...Object.values(candidate.timingTargets.laterChoiceDecisionSeconds).map((range) => range[1])
);
const computedMaximumDeferredForegroundResumeMs = Math.max(
  Math.ceil((maxDecisionSeconds * maxPersonaDecisionMultiplier * 1000) / candidate.clockModel.fixedStepMs) * candidate.clockModel.fixedStepMs,
  candidate.combatRules.defeatPresentationMs,
  candidate.clockModel.floorTransitionMs.range[1]
);
const computedMinimumFollowingForegroundBudgetMs = Math.min(
  candidate.returnSchedules.active.foregroundSecondsPerSession,
  candidate.returnSchedules.standard.foregroundSecondsPerSession,
  candidate.returnSchedules.passive.foregroundSecondsPerSession
) * 1000;
if (candidate.returnSchedules.maximumDeferredForegroundResumeMs !== computedMaximumDeferredForegroundResumeMs
  || candidate.returnSchedules.minimumFollowingForegroundBudgetMs !== computedMinimumFollowingForegroundBudgetMs
  || computedMaximumDeferredForegroundResumeMs > computedMinimumFollowingForegroundBudgetMs) fail('deferred foreground resume bound differs from the declared decision/presentation/transition maxima or next-session minimum');
const resumeConsumptionFixture = (declaredSessionMs, resumedMs) => declaredSessionMs - resumedMs;
if (resumeConsumptionFixture(360000, candidate.returnSchedules.maximumDeferredForegroundResumeMs) !== 343200) fail('deferred foreground resume does not consume the legal maximum from the following session one-for-one');
for (const token of ['consume resumedForegroundMs one-for-one from the beginning', 'declaredSegmentMs-resumedForegroundMs', 'day remains exactly dayLengthSeconds', 'rather than extending the day', '16800ms resumed from a 360000ms session leaves exactly 343200ms']) {
  if (!candidate.returnSchedules.deferredResumeConsumesFollowingForegroundRule.includes(token)) fail('deferred foreground budget rule omits: ' + token);
}
if (candidate.initialState.system.frozenForegroundContext !== null) fail('initial frozen foreground context must be null');
if (!candidate.offline.settlement.atomicCommitRule.includes('under returnSchedules.deferredSettlementClockRule preserve the already advanced current logical clock')) fail('offline atomic commit can overwrite a deferred logical clock');
const frozenRecompositionRule = candidate.returnSchedules.offlineResumeCombatRecompositionRule;
for (const token of ['maximumHpMutationRule', 'Preserve every already scheduled', 'schedule its next recurrence from that resolution using the new composition', 'Preserve existing live helpers and queued requests', 'block direct spawn and queue release', 'do not spawn immediately', 'allied in-flight projectile preserves its launch-time source/configuration slots', 'enemy in-flight projectile preserves only its source/raw/event-class/phase operands', 'reads the then-current eligible source-owned charge', 'offline defensive purchase can affect that future impact', 'rewrite its declared immutable launch payload, target, due timestamp or correlation', 'cancel the frozen context instead']) {
  if (!frozenRecompositionRule.includes(token)) fail('frozen-combat effect recomposition rule omits: ' + token);
}
const expectedShopTargetStatFields = {
  namedCatOutgoingNonArmor: ['catDamagePerLevel', 'effectiveDpsPerLevel', 'allEffectivePowerPerLevel'],
  namedCatOutgoingArmor: ['catDamagePerLevel', 'armoredEffectBonusPerLevel', 'effectiveDpsPerLevel', 'allEffectivePowerPerLevel'],
  helperOutgoingNonArmor: ['reinforcementPowerPerLevel', 'helperPowerPerLevel', 'effectiveDpsPerLevel', 'allEffectivePowerPerLevel'],
  helperOutgoingArmor: ['reinforcementPowerPerLevel', 'armoredEffectBonusPerLevel', 'helperPowerPerLevel', 'effectiveDpsPerLevel', 'allEffectivePowerPerLevel'],
  namedCatMaximumHp: ['catHpPerLevel', 'allEffectivePowerPerLevel'],
  helperMaximumHp: ['reinforcementPowerPerLevel', 'helperPowerPerLevel', 'allEffectivePowerPerLevel'],
  healing: ['healingPerLevel'],
  attackSpeed: ['attackSpeedPerLevel']
};
if (!sameJson(candidate.shopModel.shopStatComposition.targetStatFields, expectedShopTargetStatFields)) fail('shop target-stat field mapping is not exact');
if (!sameJson(candidate.shopModel.shopStatComposition.fieldSpecificCaps, { allEffectivePowerPerLevel: '/shopModel/shops/shop.curio-gallery/allEffectivePowerCap' })) fail('shop field-specific cap mapping is not exact');
const expectedShopSpecialChannels = {
  liveIncomePerLevel: 'placement-local through effectChannelSemantics.liveIncomePerLevel',
  offlineIncomePerLevel: 'aggregate once and cap at /shopModel/shops/shop.delivery-warehouse/offlineIncomeShopCap',
  commandPowerPerLevel: 'aggregate once and cap at /shopModel/commandPowerComposition/commandPowerBonusCap',
  recoveryPerLevel: 'add aggregate once to /combatRules/floorClearSurvivorHealMaxHpFraction and cap total at /combatRules/floorClearSurvivorHealMaximumWithShop',
  targetingLossReductionPerLevel: 'aggregate once and cap at /combatRules/targetingLossReductionCap',
  enemyAttackSuppressionPerLevel: 'aggregate once and cap at /shopModel/shops/shop.lantern-store/suppressionCap before one subtraction',
  waveRecoveryPerLevel: 'aggregate once and cap at /shopModel/shops/shop.nap-inn/waveRecoveryCap',
  helperCapAtLevels: 'sum discrete reached-threshold slots once and cap at /helperBaselines/autoDispatch/maximumUpgradedConcurrentCap'
};
if (!sameJson(candidate.shopModel.shopStatComposition.specialChannelRules, expectedShopSpecialChannels)) fail('shop special-channel cap mapping is not exact');
for (const token of ['apply shopStatComposition in its declared order', 'clamp that target-stat sum once', 'exactly one 1+targetStatBonus multiplier', 'Never cap each uncapped input field separately', 'Never multiply reinforcementPowerPerLevel, helperPowerPerLevel, effectiveDpsPerLevel and allEffectivePowerPerLevel as separate helper-power multipliers']) {
  if (!candidate.shopModel.continuousEffectCapRule.includes(token)) fail('shop target-stat cap rule omits: ' + token);
}
for (const token of ['reads exactly one already-composed target-stat value', 'applies it once', 'never reads or multiplies individual shop fields']) {
  if (!candidate.effectComposition.shopAdditiveBonusSlotRule.includes(token)) fail('effect-composition shop slot omits: ' + token);
}
const composeShopTargetStat = (fieldTotals, fields, cap) => Math.min(cap, fields.reduce((sum, field) => sum + (fieldTotals[field] ?? 0), 0));
const shopStatCapFixture = 1.5;
const helperFieldTotals = { reinforcementPowerPerLevel: 0.6, helperPowerPerLevel: 0.5, effectiveDpsPerLevel: 0.4, allEffectivePowerPerLevel: 0.25 };
const helperBonus = composeShopTargetStat(helperFieldTotals, expectedShopTargetStatFields.helperOutgoingNonArmor, shopStatCapFixture);
const helperMultiplier = 1 + helperBonus;
const illegalPerFieldProduct = (1 + helperFieldTotals.reinforcementPowerPerLevel) * (1 + helperFieldTotals.helperPowerPerLevel) * (1 + helperFieldTotals.effectiveDpsPerLevel) * (1 + helperFieldTotals.allEffectivePowerPerLevel);
if (!near(helperBonus, shopStatCapFixture) || near(helperMultiplier, illegalPerFieldProduct)) fail('helper shop fields are not summed and capped once before one multiplier');
if (!candidate.shopModel.effectChannelSemantics.recoveryPerLevel.includes('combatRules.floorClearSurvivorHealMaxHpFraction')
  || !candidate.shopModel.effectChannelSemantics.recoveryPerLevel.includes('combatRules.floorClearSurvivorHealMaximumWithShop')
  || candidate.shopModel.effectChannelSemantics.recoveryPerLevel.includes('0.20')
  || candidate.shopModel.effectChannelSemantics.recoveryPerLevel.includes('0.50')) fail('recovery shop semantics hard-code calibratable caps');
if (!candidate.shopModel.effectChannelSemantics.targetingLossReductionPerLevel.includes('combatRules.targetingLossReductionCap')
  || candidate.shopModel.effectChannelSemantics.targetingLossReductionPerLevel.includes('0.30')) fail('targeting-loss shop semantics hard-code a calibratable cap');
if (!candidate.shopModel.effectChannelSemantics.waveRecoveryPerLevel.includes('shopModel.shops.shop.nap-inn.waveRecoveryCap')
  || candidate.shopModel.effectChannelSemantics.waveRecoveryPerLevel.includes('0.30')) fail('wave-recovery shop semantics hard-code its cap');
if (candidate.enemyModel.enemyMeleeImpactDelayMs !== 0 || canCalibrate('/enemyModel/enemyMeleeImpactDelayMs')) fail('unused enemy melee impact delay must remain the immutable zero sentinel');
if (!sameJson(candidate.weapons.tutorialSwitchExemptions.map((entry) => entry.floor), [4])
  || !candidate.weapons.tutorialSwitchExemptions[0].eligibility.includes('4 is absent from profile.completedArmamentTutorialFloors')
  || !candidate.weapons.tutorialSwitchExemptions[0].consume.includes('whether the recommendation switches family or keeps the current family')
  || !candidate.weapons.normalSwitchLockMeaning.includes('F3 performs only automaticInitialEquipAtUnlock')
  || !candidate.weapons.normalSwitchLockMeaning.includes('every later F4 evaluation uses routine or defeat rules')
  || !candidate.decisionPolicies.armament.overrideAcceptance.includes('F3 is automatic equip only')
  || !candidate.decisionPolicies.armament.overrideAcceptance.includes('Once 4 is recorded, every later F4 pre-wave evaluation uses routine rules, including after Dawn')) fail('armament tutorial switching is not restricted to one lifetime F4 checkpoint');
const f4TutorialEligibility = (completedArmamentTutorialFloors) => !completedArmamentTutorialFloors.includes(4);
if (!f4TutorialEligibility([]) || f4TutorialEligibility([4])) fail('F4 tutorial exemption is reusable after its first evaluation');
for (const token of ['atomically add 4 to profile.completedArmamentTutorialFloors whether the recommended family equals old or differs', 'commit only that consumed marker and emit no switch event, armament contact or pending achievement', 'standalone pre-F4-wave floor-entry commit', 'before the F4 floor-entry Dawn checkpoint']) {
  if (!candidate.decisionPolicies.armament.acceptedFamilyChangeCommit.includes(token)) fail('F4 one-time armament tutorial commit omits: ' + token);
}
if (candidate.districtProgression.districts[0].armamentBaseUnlockFloor !== candidate.weapons.baseFamiliesUnlockFloor
  || !candidate.districtProgression.armamentUnlockAndTierRule.includes('weapons.baseFamiliesUnlockFloor')
  || !candidate.districtProgression.armamentUnlockAndTierRule.includes('districtProgression.armamentBaseUnlockSetsTier')) fail('F3 base-armament unlock authority differs between district and weapon models');
if (!candidate.dawn.reset.pendingArmamentSwitchAchievementFamily.includes('retain that exact family across Dawn')
  || !candidate.decisionPolicies.armament.acceptedFamilyChangeCommit.includes('dawn.reset retains the matching pending family')) fail('a pre-wave Dawn can lose the pending armament-switch achievement');
if (!candidate.floorOverrides['8'].namedObjectiveAllocationRule.includes('Derive each backing threat total by summing')
  || candidate.floorOverrides['8'].namedObjectiveAllocationRule.includes('armor 0.75')) fail('F8 named objective threat totals are not derived from calibratable shares');
if (!candidate.combatRules.skillResolution['consecutive-targeting'].includes('strictly greater than targetResetGapMs')
  || !candidate.combatRules.skillResolution['consecutive-targeting'].includes('equality does not reset')) fail('Luna reset boundary is not the exact strict comparison');

const expectedOutgoingAtomicDamageOrder = [
  'declared-namedCatAttackOrder-or-helperAttackOrder-exactly-once',
  'skill-primary-hit-multiplier',
  'encounter-delivery-modifier',
  'stored-projectile-charge',
  'impact-time-helper-rally',
  'scenario-execution-power-multiplier',
  'roundSixDecimals-once'
];
if (!sameJson(candidate.effectComposition.outgoingAtomicDamageOrder, expectedOutgoingAtomicDamageOrder)) fail('outgoing atomic damage order does not expose every combinable mechanic slot');
for (const token of ['enemy.sack_mole', 'landingWindows', 'mutually exclusive', 'stored-projectile-charge', 'launch-time snapshot', 'impact-time-helper-rally', 'charged helper.slinger projectile impacting during rally']) {
  if (!candidate.effectComposition.outgoingAtomicDamageMechanicBindings.includes(token)) fail('outgoing damage mechanic binding omits: ' + token);
}
const syntheticOutgoingWithChargeAndRally = roundSixDecimals(10 * 1.2 * 0.9 * 1.4 * 1.15 * 1.05);
const syntheticOutgoingMissingCharge = roundSixDecimals(10 * 1.2 * 0.9 * 1.15 * 1.05);
if (!near(syntheticOutgoingWithChargeAndRally, 18.2574) || near(syntheticOutgoingWithChargeAndRally, syntheticOutgoingMissingCharge)) fail('simultaneous stored slinger charge and impact-time rally are not both applied exactly once');
for (const token of ['snapshot', 'immutable correlation state', 'impact', 'later helper-rally state neither replaces nor re-snapshots']) {
  if (!candidate.combatRules.helperLifecycle.slingerChargeConsumption.includes(token)) fail('slinger charge lifecycle omits: ' + token);
}
const projectileSnapshotRule = candidate.effectComposition.projectileDamageSnapshotRule;
for (const token of ['complete declared namedCatAttackOrder or helperAttackOrder', 'finite unrounded launchSourceDamage', 'Never recompute any of those source slots at impact', 'source KO/helper expiry', 'impact-counter ledger', 'do not increment a counter at launch', 'impact pre-commit EHP', 'immutable launch-time stored-projectile-charge', 'actual impact-time helper-rally', 'sole roundSixDecimals']) {
  if (!projectileSnapshotRule.includes(token)) fail('allied projectile damage snapshot omits: ' + token);
}
const projectileDamageFixture = ({launchSourceDamage, mutatedSourceDamage, skill, encounter, charge, rally, scenario}) => ({
  legal: roundSixDecimals(launchSourceDamage * skill * encounter * charge * rally * scenario),
  illegal: roundSixDecimals(mutatedSourceDamage * skill * encounter * charge * rally * scenario)
});
const midflightPurchaseFixture = projectileDamageFixture({launchSourceDamage: 10, mutatedSourceDamage: 20, skill: 1.2, encounter: 0.9, charge: 1.5, rally: 1.1, scenario: 1.05});
if (!near(midflightPurchaseFixture.legal, 18.711) || near(midflightPurchaseFixture.legal, midflightPurchaseFixture.illegal)) fail('an in-flight projectile recomputed source damage after a purchase instead of using its launch snapshot');

const expectedIncomingAtomicDamageOrder = [
  'enemy-base-hit-and-floor-role',
  'event-class-multiplier',
  'owned-charge-multiplier',
  'phase-execution-multiplier',
  'shop-and-support-suppression',
  'armament-incoming-damage-multiplier',
  'conditional-Mugi-or-frontline-guard-reduction-multipliers',
  'clamp-composed-damage-multiplier-to-incomingDamageMultiplierMinimum',
  'roundSixDecimals-once',
  'absorb-with-helper-guard-shield-HP'
];
if (!sameJson(candidate.effectComposition.incomingAtomicDamageOrder, expectedIncomingAtomicDamageOrder)) fail('incoming atomic damage order does not expose class, charge and phase slots separately');
for (const token of ['event-class-multiplier', 'owned-charge-multiplier', 'phase-execution-multiplier', 'elite heavy with a gecko charge', 'F10 boss heavy with fire charge', 'F100 phase-four boss event', 'No charge or phase multiplier replaces']) {
  if (!candidate.effectComposition.incomingAtomicDamageMechanicBindings.includes(token)) fail('incoming damage mechanic binding omits: ' + token);
}
const syntheticEliteGecko = roundSixDecimals(10 * 1.5 * 1.35);
const syntheticBossFire = roundSixDecimals(10 * 1.8 * 1.2);
const syntheticBossBerserk = roundSixDecimals(10 * 1.8 * 1.2);
if (!near(syntheticEliteGecko, 20.25) || !near(syntheticBossFire, 21.6) || !near(syntheticBossBerserk, 21.6)) fail('incoming class plus owned/phase mechanic fixture differs from the exhaustive order');
const enemyProjectileSnapshotRule = candidate.effectComposition.enemyProjectileDamageSnapshotRule;
for (const token of ['store them separately as finite unrounded launchEnemyBaseDamage, launchEventClassMultiplier and launchPhaseExecutionMultiplier', 'Do not select or consume an owned charge', 'reserve and consume the then-current eligible source-owned charge through finiteChargeAndCounterReservation', 'using identity 1 if an earlier melee/heavy consumed it or its owner was defeated', 'then-current committed shop-and-support suppression and armament incoming multiplier', 'clamp that complete composed multiplier exactly once', 'sole roundSixDecimals', 'expire for zero damage and consume no source-owned charge', 'offline defensive purchase during flight affects the later impact', 'charge eligibility is deliberately impact-time']) {
  if (!enemyProjectileSnapshotRule.includes(token)) fail('enemy projectile damage snapshot omits: ' + token);
}
const enemyProjectileImpactFixture = ({launchBase, eventClass, phase, chargeEligible, charge, shopSupport, armament, mugi, frontline, shield = 0, targetAlive = true}) => {
  if (!targetAlive) return {damageToHp: 0, chargeConsumed: false, targetChargesConsumed: false, shieldAfter: shield};
  const ownedCharge = chargeEligible ? charge : 1;
  const composedMultiplier = Math.max(candidate.effectComposition.incomingDamageMultiplierMinimum, eventClass * ownedCharge * phase * shopSupport * armament * mugi * frontline);
  const rounded = roundSixDecimals(launchBase * composedMultiplier);
  return {damageToHp: roundSixDecimals(Math.max(0, rounded - shield)), chargeConsumed: chargeEligible, targetChargesConsumed: true, shieldAfter: roundSixDecimals(Math.max(0, shield - rounded))};
};
const projectileChargeStillArmed = enemyProjectileImpactFixture({launchBase: 10, eventClass: 1.2, phase: 1.1, chargeEligible: true, charge: 1.35, shopSupport: 0.8, armament: 0.9, mugi: 0.7, frontline: 0.8});
const projectileChargeConsumedByEarlierMelee = enemyProjectileImpactFixture({launchBase: 10, eventClass: 1.2, phase: 1.1, chargeEligible: false, charge: 1.35, shopSupport: 0.8, armament: 0.9, mugi: 0.7, frontline: 0.8});
const projectileChargeOwnerDefeated = enemyProjectileImpactFixture({launchBase: 10, eventClass: 1.2, phase: 1.1, chargeEligible: false, charge: 1.35, shopSupport: 0.8, armament: 0.9, mugi: 0.7, frontline: 0.8});
const projectileExpiredTarget = enemyProjectileImpactFixture({launchBase: 10, eventClass: 1.2, phase: 1.1, chargeEligible: true, charge: 1.35, shopSupport: 0.8, armament: 0.9, mugi: 0.7, frontline: 0.8, shield: 4, targetAlive: false});
const projectileBeforeOfflineDefensePurchase = enemyProjectileImpactFixture({launchBase: 10, eventClass: 1.2, phase: 1.1, chargeEligible: false, charge: 1.35, shopSupport: 1, armament: 1, mugi: 1, frontline: 1});
const projectileAfterOfflineDefensePurchase = enemyProjectileImpactFixture({launchBase: 10, eventClass: 1.2, phase: 1.1, chargeEligible: false, charge: 1.35, shopSupport: 0.8, armament: 0.9, mugi: 1, frontline: 1});
if (!near(projectileChargeStillArmed.damageToHp, 7.185024) || !projectileChargeStillArmed.chargeConsumed
  || !near(projectileChargeConsumedByEarlierMelee.damageToHp, 5.32224) || projectileChargeConsumedByEarlierMelee.chargeConsumed
  || !sameJson(projectileChargeOwnerDefeated, projectileChargeConsumedByEarlierMelee)
  || !sameJson(projectileExpiredTarget, {damageToHp: 0, chargeConsumed: false, targetChargesConsumed: false, shieldAfter: 4})
  || !near(projectileBeforeOfflineDefensePurchase.damageToHp, 13.2)
  || !near(projectileAfterOfflineDefensePurchase.damageToHp, 9.504)
  || !(projectileAfterOfflineDefensePurchase.damageToHp < projectileBeforeOfflineDefensePurchase.damageToHp)) fail('enemy in-flight projectile used launch-time charge/mitigation, consumed on expiry, or recomposed its launch source operands');

const totoHealFormulaId = 'cat-base-heal-times-hp-growth-times-capped-ten-level-milestones';
if (candidate.catBaselines['cat.toto'].skill.healFormulaId !== totoHealFormulaId) fail('Toto interval heal is not bound to its exact level-growth formula');
const totoHealOperands = ['runtime.cat.skill.baseHealInitial', '$.curves.catLevel.hpGrowthInitial', '$.curves.catLevel.milestoneInitial', '$.curves.catLevel.milestoneAppliesOnLevels', 'runtime.level'];
if (!sameJson(candidate.formulaRules.algorithmOperands[totoHealFormulaId], totoHealOperands)
  || !candidate.formulaRules.algorithmDefinitions[totoHealFormulaId].includes('roundSixDecimals(cat.skill.baseHealInitial')
  || !candidate.formulaRules.algorithmDefinitions[totoHealFormulaId].includes('milestoneAppliesOnLevels values <= level')) fail('Toto heal formula lacks exact growth, milestone or rounding authority');
const totoFixtureLevel = 10;
const totoMilestones = candidate.curves.catLevel.milestoneAppliesOnLevels.filter((level) => level <= totoFixtureLevel).length;
const totoHealAtTen = roundSixDecimals(candidate.catBaselines['cat.toto'].skill.baseHealInitial
  * candidate.curves.catLevel.hpGrowthInitial ** (totoFixtureLevel - 1)
  * candidate.curves.catLevel.milestoneInitial ** totoMilestones);
const illegalTotoHealWithoutMilestone = roundSixDecimals(candidate.catBaselines['cat.toto'].skill.baseHealInitial
  * candidate.curves.catLevel.hpGrowthInitial ** (totoFixtureLevel - 1));
if (!Number.isFinite(totoHealAtTen) || near(totoHealAtTen, illegalTotoHealWithoutMilestone)) fail('Toto level-10 heal fixture omitted its capped milestone');
for (const token of ['cat.toto.skill.healFormulaId', 'Nap-inn wave recovery', 'already aggregated and waveRecoveryCap-clamped', 'periodic-party-heal', 'floorClearRecovery is a distinct', 'roundSixDecimals-once']) {
  if (!candidate.effectComposition.healingAtomicRule.includes(token) && !candidate.effectComposition.healingOrder.includes(token)) fail('healing composition omits: ' + token);
}

const supportSemantics = candidate.supportModel.effectChannelSemantics;
for (const [supportId, support] of Object.entries(candidate.supportModel).filter(([key]) => key.startsWith('support.'))) {
  for (const key of Object.keys(support).filter((field) => field.endsWith('PerActivation'))) {
    const channel = key.slice(0, -'PerActivation'.length);
    if (!Object.hasOwn(support, channel + 'Cap')) fail(`${supportId}.${key} lacks its matching cap`);
    if (!supportSemantics.includes(channel)) fail(`${supportId}.${key} lacks an exact support consumer`);
  }
}
for (const token of ['roundSixDecimals(minimum', 'never compound activations or facilities separately', 'catDamage maps only to named-cat outgoing', 'catHp maps only to named-cat maximum HP', 'healing maps to every healingAtomicRule event', 'helperPower maps to both helper outgoing primary damage and helper maximum HP', 'liveIncome maps to foreground live income', 'offlineIncome maps to offline commerceMultiplierSnapshot']) {
  if (!supportSemantics.includes(token)) fail('support effect-channel semantics omit: ' + token);
}
const syntheticSupportCatDamage = roundSixDecimals(Math.min(0.15, 7 * 0.025));
const syntheticSupportHelperPower = roundSixDecimals(Math.min(0.12, 8 * 0.02));
if (!near(syntheticSupportCatDamage, 0.15) || !near(syntheticSupportHelperPower, 0.12)) fail('support activation bonus fixture does not cap one additive field before its one multiplier');
const relicSemantics = candidate.relicModel.effectChannelSemantics;
for (const relic of Object.values(candidate.relicModel.relics)) {
  for (const key of Object.keys(relic).filter((field) => field.endsWith('PerBaseStack'))) {
    const channel = key.slice(0, -'PerBaseStack'.length);
    if (!relicSemantics.includes(channel)) fail(`relic ${channel} lacks an exact effect consumer`);
  }
}
for (const token of ['ascending sourceFloor order', 'never multiply individual instances', 'catDamage maps only to named-cat outgoing', 'helperPower maps to both helper outgoing primary damage and helper maximum HP', 'liveAndOfflineIncome maps once to foreground live income and once to offline commerceMultiplierSnapshot']) {
  if (!relicSemantics.includes(token)) fail('relic effect-channel semantics omit: ' + token);
}
const syntheticBellBonus = roundSixDecimals(0.06 * 1 + 0.06 * 0.9);
if (!near(syntheticBellBonus, 0.114) || !near(10 * (1 + syntheticBellBonus), 11.14) || !near(20 * (1 + syntheticBellBonus), 22.28)) fail('relic helperPower fixture is not routed identically to helper attack and maximum HP');

for (const token of ['elapsed=0', 'firstDueMs=rounding.derivedEventTime(intervalMs)', 'never t=0', 'actualCommitMs+intervalMs', 'coalesces to one latch', 'Hide/resume preserves exact due/latch state']) {
  if (!candidate.combatRules.skillTimerScheduleRule.includes(token)) fail('skill timer schedule omits: ' + token);
}
for (const token of ['arm-defensive-skills and resolve-healing', 'latch exactly one ready state', 'bank no additional activations', 'first active fixed tick after next-wave initialization', 'anchors its next interval to that release commit', 'impact-owned skills have no independent gap clock']) {
  if (!candidate.combatRules.waveGapSkillLifecycle.includes(token)) fail('wave-gap skill lifecycle omits: ' + token);
}
const skillFirstDueFixture = Math.ceil(1800 / candidate.clockModel.fixedStepMs) * candidate.clockModel.fixedStepMs;
const skillNextDueFixture = Math.ceil((1850 + 1800) / candidate.clockModel.fixedStepMs) * candidate.clockModel.fixedStepMs;
const coalescedGapActivations = Math.min(1, 3);
if (skillFirstDueFixture !== 1800 || skillNextDueFixture !== 3650 || coalescedGapActivations !== 1) fail('skill first-due, recurrence or wave-gap coalescing fixture differs from the canonical timer lifecycle');

const roundedSwrr = (weightEntries, steps) => {
  const entries = weightEntries.map(([key, weight]) => [key, roundSixDecimals(weight)]).sort(([left], [right]) => left.localeCompare(right));
  const carries = Object.fromEntries(entries.map(([key]) => [key, 0]));
  const total = roundSixDecimals(entries.reduce((sum, [, weight]) => sum + weight, 0));
  const selections = [];
  for (let index = 0; index < steps; index += 1) {
    for (const [key, weight] of entries) carries[key] = roundSixDecimals(carries[key] + weight);
    const selected = entries.map(([key]) => key).reduce((best, key) => carries[key] > carries[best] ? key : best);
    carries[selected] = roundSixDecimals(carries[selected] - total);
    selections.push(selected);
  }
  return { carries, selections };
};
const helperSwrrFixture = roundedSwrr([['guard', 0.43], ['slinger', 0.45], ['runner', 0.20]], 54);
if (helperSwrrFixture.selections[53] !== 'guard' || !near(helperSwrrFixture.carries.guard, -0.54) || !near(helperSwrrFixture.carries.runner, 0) || !near(helperSwrrFixture.carries.slinger, 0.54)) fail('six-decimal SWRR fixture drifted at its exact-tie boundary');
for (const rule of [candidate.helperBaselines.autoDispatch.dispatchWeightSelection, candidate.enemyModel.targeting.smoothWeightedRoundRobinStep]) {
  for (const token of ['roundSixDecimals', 'roundSixDecimalsSigned', 'exact rounded', 'binary floating-point residues']) if (!rule.toLowerCase().includes(token.toLowerCase())) fail('smooth-WRR numeric rule omits: ' + token);
}

const alliedTargetLifecycle = candidate.combatRules.alliedPrimaryTargetLifecycleRule;
for (const token of ['actorFocusTargetKey=`none`', 'concrete targetless event', 'same immutable pre-commit enemy EHP snapshot', 'legal overkill is possible', 'resolvedDamageTargetKey', 'Never rewrite the shell ID', 'separately identified impact', 'delay that same targetless shell without reissuing its ID']) {
  if (!alliedTargetLifecycle.includes(token)) fail('allied primary target lifecycle omits: ' + token);
}
const alliedSameSnapshotFixture = ({ targets, attacks }) => attacks.map((attack) => ({
  shellId: attack.shellId,
  target: targets.find((target) => target.ehp > 0)?.key ?? null,
  requestedDamage: attack.damage
}));
const alliedOverkillFixture = alliedSameSnapshotFixture({
  targets: [{key: 'enemy-a', ehp: 5}, {key: 'enemy-b', ehp: 9}],
  attacks: [{shellId: 'event-1', damage: 8}, {shellId: 'event-2', damage: 4}]
});
if (alliedOverkillFixture[0].target !== 'enemy-a' || alliedOverkillFixture[1].target !== 'enemy-a'
  || alliedOverkillFixture[0].shellId !== 'event-1' || alliedOverkillFixture[1].shellId !== 'event-2') fail('same-timestamp allied attacks did not select from one immutable pre-commit target snapshot');
for (const token of ['eventTargetKey=`none`', 'resolvedDamageTargetKey', 'global ID and attack-kind reservation never change', 'Same-timestamp newly spawned helpers']) {
  if (!candidate.enemyModel.normalAttackTargetLifecycle.includes(token)) fail('enemy normal target lifecycle omits: ' + token);
}
if (!candidate.combatRules.helperLifecycle.eventTargetKey.includes('enemy normal or allied primary')
  || !candidate.combatRules.helperLifecycle.combatEventIdentity.includes('enemy normal or allied primary')) fail('targetless enemy/allied shells are not both bound to immutable event identity');

const referenceTrace = candidate.effectComposition.effectivePowerReferenceTrace;
const referenceBoundary = candidate.effectComposition.effectivePowerReferenceSegmentBoundaryRule;
for (const token of ['Every intermediate segment is the half-open interval', 'final segment is closed', 'complete simultaneousEventOrder fixed point', 'include its damage/healing/KO', 'only then sample the endpoint']) {
  if (!referenceTrace.includes(token)) fail('reference trace boundary ownership omits: ' + token);
}
for (const token of ['only to an intermediate boundary', 'cancel every old-segment pending allied melee shell', 'in-flight allied projectile', 'cancel every enemy normal shell', 'consumes no hit counter', 'clear actorFocusTargetKey', 'new global event ID', 'persistent boss actor key cannot carry a projectile']) {
  if (!referenceBoundary.includes(token)) fail('reference segment-boundary lifecycle omits: ' + token);
}
const referenceBoundaryFixture = (dueMs, boundaryMs, finalHorizon) => finalHorizon ? dueMs <= boundaryMs : dueMs < boundaryMs;
if (referenceBoundaryFixture(30000, 30000, false) || !referenceBoundaryFixture(90000, 90000, true)
  || referenceBoundaryFixture(90001, 90000, true)) fail('reference trace did not cancel an intermediate-boundary event or include an exact final-horizon event');
const reservoirRule = candidate.effectComposition.effectivePowerReferenceEnemyReservoirRule;
for (const token of ['complete exact initial enemy EHP state', 'every entity cell and backing bucket', 'replace the entire mutable enemy EHP state', 'record no durable enemy KO', 'pending/future cadence is never cancelled', 'No epsilon clamp']) {
  if (!reservoirRule.includes(token)) fail('reference enemy reservoir omits: ' + token);
}
const reservoirFixture = (initial, damageSequence) => {
  let state = [...initial];
  let refills = 0;
  let hitCounter = 0;
  for (const damage of damageSequence) {
    hitCounter += 1;
    let remainingDamage = damage;
    for (let index = 0; index < state.length && remainingDamage > 0; index += 1) {
      const applied = Math.min(state[index], remainingDamage);
      state[index] -= applied;
      remainingDamage -= applied;
    }
    if (state.every((value) => value === 0)) {
      state = [...initial];
      refills += 1;
    }
  }
  return {state, refills, hitCounter};
};
const reservoirResult = reservoirFixture([3, 2], [4, 1]);
if (!sameJson(reservoirResult.state, [3, 2]) || reservoirResult.refills !== 1 || reservoirResult.hitCounter !== 2) fail('reference reservoir refilled early or reset a carried hit counter');

for (const token of ['left endpoint', 'credit its whole coins/fraction before', 'right-end mutations affect only the next complete interval', 't=0 and partial visible intervals accrue zero', 'On hide at t']) {
  if (!candidate.clockModel.foregroundFixedStepIncomeCommitRule.includes(token)) fail('foreground live-income right-edge rule omits: ' + token);
}
const liveIncomeLeftEdgeFixture = (fraction, leftRate, rightRate, stepMs) => {
  const accrued = fraction + leftRate * stepMs / 1000;
  return {coins: Math.floor(accrued), fraction: roundSixDecimals(accrued - Math.floor(accrued)), ignoredRightRate: rightRate};
};
const incomeEdge = liveIncomeLeftEdgeFixture(0.9, 2.5, 10, 50);
if (incomeEdge.coins !== 1 || !near(incomeEdge.fraction, 0.025) || incomeEdge.ignoredRightRate !== 10) fail('live-income fixture used a right-edge mutation for the interval ending there');

const positiveEhpRule = candidate.combatRules.positiveEhpDeltaReservation;
for (const token of ['owner-survival predicate', 'preCommit reserve-target missing EHP', 'namedTargetEhp=clamp', 'backingArmorEhp=clamp', 'add reservedRestore once to each view', 'post-damage missing capacity']) {
  if (!positiveEhpRule.includes(token)) fail('positive-EHP reservation omits: ' + token);
}
const f8ArrivalFixture = ({ownerSurvives, preTarget, preArmor, targetInitial, armorInitial, fraction, damage}) => {
  const restore = ownerSurvives ? roundSixDecimals(Math.min(targetInitial - preTarget, armorInitial * fraction)) : 0;
  return {
    target: Math.min(targetInitial, Math.max(0, preTarget + restore - damage)),
    armor: Math.min(armorInitial, Math.max(0, preArmor + restore - damage)),
    restore
  };
};
const f8ArrivalSurvives = f8ArrivalFixture({ownerSurvives: true, preTarget: 20, preArmor: 50, targetInitial: 100, armorInitial: 100, fraction: 0.08, damage: 25});
const f8ArrivalDiscarded = f8ArrivalFixture({ownerSurvives: false, preTarget: 20, preArmor: 50, targetInitial: 100, armorInitial: 100, fraction: 0.08, damage: 25});
if (!near(f8ArrivalSurvives.restore, 8) || !near(f8ArrivalSurvives.target, 3) || !near(f8ArrivalSurvives.armor, 33)
  || f8ArrivalDiscarded.restore !== 0 || f8ArrivalDiscarded.target !== 0 || f8ArrivalDiscarded.armor !== 25) fail('F8 same-timestamp reinforcement reservation used post-damage capacity or survived a caster KO');

const purchaseReferenceFloorRule = candidate.decisionPolicies.purchase.purchaseReferenceFloorRule;
for (const token of ['before incrementing purchaseEvaluationOrdinal', 'At after-floor-reward-and-unlocks', 'comparisonFloor=minimum(100,clearedFloor+1)', 'do not read the still-untransitioned run.currentFloor', 'At after-offline-settlement', "staged settlement clone's resulting run.currentFloor", 'At after-defeat-diagnosis', 'immutable failure diagnosis failedFloor', 'both before/after endpoints', 'no caller fallback']) {
  if (!purchaseReferenceFloorRule.includes(token)) fail('purchase reference-floor binding omits: ' + token);
}
const purchaseReferenceFloorFixture = ({point, clearedFloor, resultingFloor, failedFloor}) => {
  if (point === 'after-floor-reward-and-unlocks') return Math.min(100, clearedFloor + 1);
  if (point === 'after-offline-settlement') return resultingFloor;
  if (point === 'after-defeat-diagnosis') return failedFloor;
  return null;
};
if (purchaseReferenceFloorFixture({point: 'after-floor-reward-and-unlocks', clearedFloor: 8, resultingFloor: 8}) !== 9
  || purchaseReferenceFloorFixture({point: 'after-floor-reward-and-unlocks', clearedFloor: 100, resultingFloor: 100}) !== 100
  || purchaseReferenceFloorFixture({point: 'after-offline-settlement', resultingFloor: 21}) !== 21
  || purchaseReferenceFloorFixture({point: 'after-defeat-diagnosis', failedFloor: 9}) !== 9) fail('purchase reference-floor fixture fell back to the wrong current/highest/transition floor');
const purchaseOperands = candidate.decisionPolicies.purchase.purchaseUtilityOperandRule;
for (const token of ['purchaseReferenceFloorRule', 'same explicit comparisonFloor', 'scenario build key', 'identical pre-candidate state', 'categoryBefore', 'categoryAfter', 'exact next-level cost', 'pre-candidate run.coins before reserve filtering or cost deduction', 'pre-candidate fully composed foreground live coins per second', 'waitSeconds=0', 'purchaseUtilityNoiseApplication once']) {
  if (!purchaseOperands.includes(token)) fail('purchase utility operand binding omits: ' + token);
}
const waitSecondsFixture = (cost, coins, income, epsilon) => Math.max(0, cost - coins) / Math.max(epsilon, income);
if (!near(waitSecondsFixture(110, 100, 2, candidate.decisionPolicies.purchase.ratioEpsilon), 5)
  || waitSecondsFixture(90, 100, 2, candidate.decisionPolicies.purchase.ratioEpsilon) !== 0
  || near(waitSecondsFixture(110, 90, 2, candidate.decisionPolicies.purchase.ratioEpsilon), 5)) fail('purchase wait-time fixture used reserve-adjusted or post-purchase coins');

const placementRewardRule = candidate.shopModel.placementFloorRewardOperandRule;
for (const token of ['immutable absolute placement floor is p', 'roleKey=String(p % 10)', 'floorOverrides[String(p)].reward', 'runtime.floor=p', 'exact nonnegative integer', 'after Dawn blueprint restoration', 'never use run.currentFloor', 'do not change when the shop family changes']) {
  if (!placementRewardRule.includes(token)) fail('placement-floor reward operand rule omits: ' + token);
}
const placementRewardFixture = (floor) => {
  const roleKey = floor % 10 === 0 ? '0' : String(floor % 10);
  const override = typeof candidate.floorOverrides[String(floor)]?.reward === 'number' ? candidate.floorOverrides[String(floor)].reward : 1;
  return Math.floor(candidate.curves.enemyReward.baseInitial * candidate.curves.enemyReward.floorGrowthInitial ** (floor - 1)
    * candidate.floorRoleModifiers[roleKey].reward * override + 0.5);
};
const placementF2Reward = placementRewardFixture(2);
const illegalCurrentF9Reward = placementRewardFixture(9);
if (!Number.isSafeInteger(placementF2Reward) || placementF2Reward < 0 || placementF2Reward === illegalCurrentF9Reward) fail('placement-floor reward fixture did not remain bound to the immutable placement floor');

const rankMandatoryRelic = (entries) => {
  const finite = entries.filter((entry) => Number.isFinite(entry.score) && Number.isFinite(entry.delta));
  const positive = finite.filter((entry) => entry.score > 0);
  return (positive.length ? positive : finite).sort((left, right) => right.score - left.score || right.delta - left.delta || left.id.localeCompare(right.id))[0]?.id ?? null;
};
for (const token of ['finite score strictly greater than 0', 'rank only that positive set', 'greatest candidate effectivePowerScalar minus control effectivePowerScalar', 'If no score is positive', 'rank every finite candidate', 'If no finite candidate exists, fail']) {
  if (!candidate.relicModel.selectionPolicy.includes(token)) fail('relic mandatory-ranking rule omits: ' + token);
}
if (rankMandatoryRelic([{id: 'a', score: -1, delta: 10}, {id: 'b', score: -1, delta: 11}]) !== 'b'
  || rankMandatoryRelic([{id: 'a', score: 0.1, delta: 1}, {id: 'b', score: -0.1, delta: 100}]) !== 'a'
  || rankMandatoryRelic([{id: 'a', score: Number.NaN, delta: 1}]) !== null) fail('mandatory relic ranking did not filter finite/positive candidates before exact ties');
const rankReconfiguration = (entries) => entries
  .filter((entry) => Number.isFinite(entry.score) && entry.score > 0 && entry.cost <= entry.coins)
  .sort((left, right) => right.score - left.score || right.delta - left.delta || left.preference - right.preference || left.floor - right.floor || left.id.localeCompare(right.id))[0]?.id ?? null;
for (const token of ['score is strictly positive and finite', 'cost is <= current run.coins', 'greatest candidate effectivePowerScalar minus control effectivePowerScalar', 'selected-build shopPreference rank', 'lowest placement floor', 'canonical shop ID']) {
  if (!candidate.decisionPolicies.shopReconfiguration.selection.includes(token)) fail('shop-reconfiguration ranking omits: ' + token);
}
if (rankReconfiguration([
  {id: 'unaffordable', score: 9, delta: 9, preference: 0, floor: 2, cost: 101, coins: 100},
  {id: 'legal', score: 1, delta: 1, preference: 2, floor: 4, cost: 90, coins: 100}
]) !== 'legal') fail('shop reconfiguration let an unaffordable higher score block a legal positive transition');

for (const token of ['survivorRecoveryFraction=roundSixDecimals', 'requestedHeal=roundSixDecimals', 'currentHp=roundSixDecimals', 'KO selected named cat', 'roundSixDecimals(clamp', 'never enters healingOrder']) {
  if (!candidate.combatRules.floorClearRecovery.includes(token)) fail('floor-clear recovery rounding omits: ' + token);
}
for (const token of ['currentHp=roundSixDecimals(clamp', 'every allied and enemy combat timer', 'all enemy entities/buckets/EHP', 'current wave/phase', 'wave/phase 1 at full initial enemy EHP']) {
  if (!candidate.combatRules.retryState.includes(token)) fail('retry reset/rounding omits: ' + token);
}
for (const token of ['set wave/phase index to 1', 'authoritative full initial wave-1 enemy state', 'selected F9 variant', 'No failed wave/phase index', 'using the new attempt ordinal']) {
  if (!candidate.combatRules.floorAttemptStart.includes(token)) fail('floor-attempt enemy reconstruction omits: ' + token);
}
const recoveryFixture = (oldHp, maxHp, baseFraction, shopFraction, maximumFraction) => {
  const fraction = roundSixDecimals(Math.min(maximumFraction, baseFraction + shopFraction));
  const requested = roundSixDecimals(maxHp * fraction);
  return roundSixDecimals(Math.min(maxHp, oldHp + requested));
};
if (!near(recoveryFixture(70, 100, 0.2, 0.1, 0.5), 100)
  || !near(roundSixDecimals(Math.min(83.333333, 83.333333 * 0.8)), 66.666666)) fail('floor-clear or retry HP fixture differs from exact six-decimal assignment');

const secondaryRule = candidate.combatRules.secondaryTargetRule;
for (const token of ['other than its locked primary bucket', 'same pre-commit state', 'lowest expanded instance ordinal', 'namedObjectiveWaveEntities listed entity', 'same persistent boss actor', 'never retarget it', 'discard excess']) {
  if (!secondaryRule.includes(token)) fail('secondary target lifecycle omits: ' + token);
}
const secondaryTargetFixture = (primaryBucket, priority, candidates) => {
  const bucket = priority.find((key) => key !== primaryBucket && candidates.some((entry) => entry.bucket === key && entry.ehp > 0));
  return candidates.filter((entry) => entry.bucket === bucket && entry.ehp > 0).sort((left, right) => left.ordinal - right.ordinal)[0]?.key ?? null;
};
if (secondaryTargetFixture('flying', ['flying', 'armor', 'neutral'], [
  {key: 'armor-2', bucket: 'armor', ordinal: 2, ehp: 5},
  {key: 'armor-1', bucket: 'armor', ordinal: 1, ehp: 4},
  {key: 'neutral-1', bucket: 'neutral', ordinal: 1, ehp: 9}
]) !== 'armor-1') fail('secondary chain fixture reused the primary focus or skipped the lowest legal instance');

const mutualZeroRule = candidate.combatRules.mutualZeroResolutionRule;
for (const token of ['selectedCatsAllKo', 'attempt failure wins even when enemy EHP also became zero', 'do not latch wave clear', 'final boss KO', 'F100 success', 'before resolve-attempt-deadline', 'permits no draw state']) {
  if (!mutualZeroRule.includes(token)) fail('mutual-zero resolution omits: ' + token);
}
const mutualZeroFixture = ({allCatsKo, enemyZero, final}) => allCatsKo
  ? {outcome: 'failure', clear: false, success: false}
  : enemyZero
    ? {outcome: final ? 'floor-clear' : 'wave-clear', clear: true, success: final}
    : {outcome: 'continue', clear: false, success: false};
for (const final of [false, true]) {
  const result = mutualZeroFixture({allCatsKo: true, enemyZero: true, final});
  if (result.outcome !== 'failure' || result.clear || result.success) fail('mutual-zero fixture allowed a nonfinal/final clear while every selected cat was KO');
}
const koRule = candidate.combatRules.koEventIdentityRule;
for (const token of ['F11-F99 nonboss aggregate', 'F10,F20,...,F100', 'mutualZeroResolutionRule authorizes', 'provenanceDamageEventIds', 'do not allocate the target\'s capped EHP', 'earliest KO timestamp', 'immutable delivery kind is enemy-projectile']) {
  if (!koRule.includes(token)) fail('KO identity/provenance rule omits: ' + token);
}
const enemyKoProvenanceFixture = [
  {id: 'event-0001', requested: 15, preEhp: 10},
  {id: 'event-0002', requested: 1, preEhp: 10}
].filter((event) => event.requested > 0 && event.preEhp > 0).map((event) => event.id).sort();
if (!sameJson(enemyKoProvenanceFixture, ['event-0001', 'event-0002'])) fail('enemy KO provenance allocated capped EHP and dropped a simultaneous overkill contributor');
const firstKoFixture = [
  {timestamp: 4000, koId: 'event-9', actor: 'cat.z'},
  {timestamp: 4000, koId: 'event-8', actor: 'cat.y'},
  {timestamp: 4500, koId: 'event-1', actor: 'cat.a'}
].sort((left, right) => left.timestamp - right.timestamp || left.koId.localeCompare(right.koId) || left.actor.localeCompare(right.actor))[0];
if (firstKoFixture.actor !== 'cat.y') fail('first selected-cat KO fixture ignored the timestamp/event-ID/actor-key ordering');

const healingDeficitRule = candidate.decisionPolicies.failure.healingDeficitCounterfactualRule;
for (const token of ['immediately before commit-same-timestamp-deltas', 'koTimestampMs<d<=koTimestampMs+1000', 'lower endpoint is exclusive', 'upper endpoint inclusive', 'source to remain alive', 'target-eligible at ratio 0', 'periodic-party-heal counts', 'Exclude Toto wave heal']) {
  if (!healingDeficitRule.includes(token)) fail('healing-deficit counterfactual omits: ' + token);
}
const healingDeficitDueFixture = (koMs, dueMs, sourceAlive) => sourceAlive && dueMs > koMs && dueMs <= koMs + 1000;
if (!healingDeficitDueFixture(5000, 6000, true) || healingDeficitDueFixture(5000, 5000, true)
  || healingDeficitDueFixture(5000, 6001, true) || healingDeficitDueFixture(5000, 5500, false)) fail('healing-deficit counterfactual accepted a wrong endpoint or dead source');

const stopCounterRule = candidate.stopPolicy.stopCounterLifecycleRule;
if (candidate.initialState.system.committedEconomyCount !== 0 || candidate.initialState.system.committedCombatEventCount !== 0) fail('scenario stop counters do not initialize to zero');
for (const token of ['scenario-lifetime monotonic counters', 'Increment only for events/transactions that commit', 'CAS failure, rejected preflight and discarded draft expose no increment', 'Dawn preserve both counters exactly', 'isolated clone-local counters initialized to 0', 'local counts never propagate back', 'No diagnostic clone inherits']) {
  if (!stopCounterRule.includes(token)) fail('stop-counter lifecycle omits: ' + token);
}
if (!candidate.dawn.reset.committedEconomyCount.includes('Dawn never resets it') || !candidate.dawn.reset.committedCombatEventCount.includes('Dawn never resets it')) fail('Dawn reset would clear scenario-lifetime stop counters');
const isolatedCounterFixture = (outer, localEvents, maximum) => ({outerAfter: outer, localAfter: localEvents, localFailed: localEvents > maximum});
const isolatedCounter = isolatedCounterFixture(4999999, 3, 5000000);
if (isolatedCounter.outerAfter !== 4999999 || isolatedCounter.localAfter !== 3 || isolatedCounter.localFailed) fail('diagnostic clone inherited or mutated the authoritative combat-event count');

const shieldCountRule = candidate.stopPolicy.shieldAndChargeEventCountingRule;
for (const token of ['creates zero additional combat events', 'frontline-guard activation may arm protectedHitCount charges', 'damage event is counted once', 'Full-queue conversion with no spawn creates zero combat events', 'direct manual guard spawn', 'counts exactly one helper-spawn event', 'slinger launch', 'runner charge consumption']) {
  if (!shieldCountRule.includes(token)) fail('shield/charge event-counting rule omits: ' + token);
}
const shieldCountFixture = {directGuardSpawnWithCharge: 1, fullQueueConversion: 0, slingerLaunchWithCharge: 1, runnerConsumeWithoutArrival: 0};
if (!sameJson(shieldCountFixture, {directGuardSpawnWithCharge: 1, fullQueueConversion: 0, slingerLaunchWithCharge: 1, runnerConsumeWithoutArrival: 0})) fail('shield/charge event-counting fixture drifted');
for (const token of ['complete simultaneousEventOrder', 'deterministic fixed point', 'exactBatchCount', 'mutate no state/carry/counter/ordinal/event queue', 'atomically replace the real state', 'Sole exception', 'do not replace real state or increment the authoritative count yet', 'boundaryBaseGameplay', 'exactFinalBatchCount', 'stages and either commits or rolls back the whole final batch']) {
  if (!candidate.stopPolicy.sameTimestampCombatLimitPreflightRule.includes(token)) fail('same-timestamp combat-limit preflight omits: ' + token);
}
for (const token of ['clone the complete post-batch state', 'exactInputEventCount', 'do not count the contact', 'request/spawn/combat ordinals', 'equality is legal']) {
  if (!candidate.stopPolicy.playerInputCombatLimitPreflightRule.includes(token)) fail('manual-input combat-limit preflight omits: ' + token);
}
const atomicLimitFixture = (committed, generated, maximum) => committed + generated > maximum
  ? {committed, applied: 0, incomplete: true}
  : {committed: committed + generated, applied: generated, incomplete: false};
if (!sameJson(atomicLimitFixture(8, 3, 10), {committed: 8, applied: 0, incomplete: true})
  || !sameJson(atomicLimitFixture(7, 3, 10), {committed: 10, applied: 3, incomplete: false})) fail('combat-limit fixture persisted a generated prefix or rejected an exact-cap batch');

const transitionRule = candidate.returnSchedules.floorTransitionInterruptionRule;
for (const token of ['keep run.currentFloor=s', 'transitionTargetFloor=s+1', 'before offline settlement', 'run.currentFloor=transitionTargetFloor', 'rewrites context.owningFloor', 'this commit creates no attempt', 'ordinary stale branch owns entry', 'null non-Dawn entry suffix exactly once', 'Never apply nextFloorCommit after settlement']) {
  if (!transitionRule.includes(token)) fail('floor-transition interruption lifecycle omits: ' + token);
}
const transitionHideFixture = {source: 8, target: 9, beforeSettlementCurrent: 9, owningFloorAfterDelay: 9, attemptsBeforeSettlement: 0, validSuffixAttempts: 1};
if (transitionHideFixture.target !== transitionHideFixture.source + 1
  || transitionHideFixture.beforeSettlementCurrent !== transitionHideFixture.target
  || transitionHideFixture.owningFloorAfterDelay !== transitionHideFixture.target
  || transitionHideFixture.attemptsBeforeSettlement !== 0
  || transitionHideFixture.validSuffixAttempts !== 1) fail('F8-to-F9 interrupted transition fixture duplicated or delayed nextFloorCommit');

const supplySeizure = candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseOne.effect;
for (const token of ['eventTargetKey=`none`', 'event kind `supply-seizure`', 'nested same-timestamp helper-expiry event', 'same persistent boss actor key as source', 'event kind `forced-helper-expiry`', 'cancel its previously scheduled future lifetime-expiry event', 'do not rerun the already-passed release-helper-queue category', 'counts exactly two combat events', 'counts only the one supply-seizure event']) {
  if (!supplySeizure.includes(token)) fail('F10 supply-seizure forced-expiry rule omits: ' + token);
}
const supplySeizureCountFixture = (runnerAlive) => 1 + (runnerAlive ? 1 : 0);
if (supplySeizureCountFixture(true) !== 2 || supplySeizureCountFixture(false) !== 1) fail('F10 supply seizure has ambiguous forced-expiry cardinality');
const entranceBlock = candidate.floorOverrides['10'].firstDistrictBossMechanics.phaseThree.entranceBlockRule;
for (const token of ['already earlier expire-statuses-and-helper-lifetimes', 'start-timestamp earlier actions remain legal', 'strictly less than end', 'At exact end', 'first removes the block', 'release-helper-queue then runs once', 'end-timestamp request is never blocked']) {
  if (!entranceBlock.includes(token)) fail('F10 entrance-block edge ordering omits: ' + token);
}
const entranceBlockFixture = (time, start, end, categoryBeforeCaster) => time > start && time < end || (time === start && !categoryBeforeCaster);
if (entranceBlockFixture(5000, 5000, 7000, true) || !entranceBlockFixture(5000, 5000, 7000, false)
  || entranceBlockFixture(7000, 5000, 7000, false)) fail('F10 entrance block includes an already-committed start category or the excluded end endpoint');

for (const token of ['stage every non-party reset field', 'post-spend branch levels', 'activeCatchupForMaximumFloor result', 'catLevels for every profile-unlocked cat are 1', 'no pre-Dawn cat level, shop, relic, support, coins, party or HP is visible', 'full composed maximum HP']) {
  if (!candidate.dawn.reset.party.includes(token)) fail('Dawn post-reset party source omits: ' + token);
}
const preDawnScores = {a: 100, b: 50};
const postResetScores = {a: 2, b: 3};
const bestScoreKey = (scores) => Object.entries(scores).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
if (bestScoreKey(preDawnScores) !== 'a' || bestScoreKey(postResetScores) !== 'b') fail('Dawn party-source negative fixture cannot distinguish pre-Dawn from staged post-reset ranking');

for (const token of ['F100 phase 2 to 3', 'phaseThreeShopLockdown', 'shop-free composition', 'phase 3 to 4', 'phase-three exit restoration', 'phaseFourBerserk', 'normalAttackScheduleRule', 'phaseFourBerserkHeavyIntervalMultiplier', 'override the generic next-segment cadence initialization']) {
  if (!candidate.effectComposition.effectivePowerReferenceSegmentBoundaryRule.includes(token)) fail('F100 reference phase-boundary import omits: ' + token);
}

const formulaIds = new Set();
const collectFormulaIds = (value) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'formulaId' || key.endsWith('FormulaId')) && typeof child === 'string') formulaIds.add(child);
    collectFormulaIds(child);
  }
};
collectFormulaIds(candidate);
for (const formulaId of formulaIds) {
  if (!Object.hasOwn(candidate.formulaRules.algorithmOperands, formulaId)) fail(`formula lacks operands: ${formulaId}`);
  if (!Object.hasOwn(candidate.formulaRules.algorithmDefinitions, formulaId)) fail(`formula lacks algorithm definition: ${formulaId}`);
}
for (const formulaId of Object.keys(candidate.formulaRules.algorithmOperands)) {
  if (!formulaIds.has(formulaId)) fail(`unused formula operand declaration: ${formulaId}`);
}
for (const formulaId of Object.keys(candidate.formulaRules.algorithmDefinitions)) {
  if (!formulaIds.has(formulaId)) fail(`unused formula algorithm definition: ${formulaId}`);
}
const operandFormulaIds = Object.keys(candidate.formulaRules.algorithmOperands).sort();
const definitionFormulaIds = Object.keys(candidate.formulaRules.algorithmDefinitions).sort();
if (!sameJson(operandFormulaIds, definitionFormulaIds)) fail('formula operand and algorithm-definition key sets differ');
const exactFormulaOperands = {
  'initial-dispatch-interval-times-one-minus-capped-level-reduction': ['$.helperBaselines.autoDispatch.intervalMsInitial', '$.helperBaselines.helperUpgrade.dispatchIntervalReductionPerLevel', '$.helperBaselines.helperUpgrade.dispatchIntervalReductionCap', 'runtime.currentHelperLevel', '$.rounding.derivedEventTime'],
  'normal-interval-divided-by-clamped-simultaneous-attacker-factor': ['$.enemyModel.normalAttackIntervalMsInitial', '$.enemyModel.simultaneousAttackerFactorBase', '$.enemyModel.simultaneousAttackerFactorPerAliveEnemy', '$.enemyModel.simultaneousAttackerFactorMaximum', 'runtime.aliveEnemyCount', '$.rounding.derivedEventTime'],
  'placement-link-multiplier': ['runtime.differentAdjacentShopTypeCount', 'runtime.sameAdjacentShopTypeCount', 'runtime.activeSupportLinkCount', '$.shopModel.adjacency.differentShopTypeBonusPerLink', '$.shopModel.adjacency.sameShopTypeBonusPerLink', '$.shopModel.adjacency.supportLinkBonusPerLink', '$.shopModel.adjacency.maximumLinksPerPlacement', '$.shopModel.adjacency.maximumSupportLinksPerPlacement'],
  'placement-floor-reward-times-income-weight-times-duplicate-factor-divided-by-income-period-seconds': ['runtime.placementFloorReward', 'runtime.shop.incomeWeight', 'runtime.duplicateFactor', 'runtime.placementLinkMultiplier', '$.shopModel.incomePeriodSeconds'],
  'per-level-effect-times-effective-level-times-duplicate-factor': ['runtime.shopEffectPerLevel', 'runtime.effectivePlacementLevel', 'runtime.duplicateFactor', 'runtime.placementLinkMultiplier'],
  'base-seconds-divided-by-clamped-current-effective-power-over-recorded-first-clear-effective-power': ['runtime.floorBaseSeconds', 'runtime.currentEffectivePower', 'runtime.recordedFirstClearEffectivePower', '$.offline.postDawnKnownFloorReclear.powerRatioClamp', '$.offline.postDawnKnownFloorReclear.minimumSecondsPerFloor', '$.rounding.derivedEventTime'],
  'first-selected-cat-ko-seconds-or-projection-horizon-plus-one-fixed-step': ['runtime.firstSelectedCatKoMs', '$.effectComposition.utilityProjectionWindowSeconds', '$.clockModel.fixedStepMs', '$.decisionPolicies.purchase.ratioEpsilon'],
  'guardian-raw-damage-budget': ['runtime.baseMaxHp', 'runtime.healingDuringFight', 'runtime.healingMultiplier', 'runtime.incomingDamageMultiplier', '$.decisionPolicies.purchase.ratioEpsilon']
};
for (const [formulaId, operands] of Object.entries(exactFormulaOperands)) {
  if (!sameJson(candidate.formulaRules.algorithmOperands[formulaId], operands)) fail(`formula has incomplete or reordered exact operands: ${formulaId}`);
}
const exactAdjacencyDefinitions = {
  'placement-link-multiplier': 'require differentAdjacentShopTypeCount, sameAdjacentShopTypeCount and activeSupportLinkCount to be nonnegative safe integers, require differentAdjacentShopTypeCount+sameAdjacentShopTypeCount<=adjacency.maximumLinksPerPlacement and activeSupportLinkCount<=adjacency.maximumSupportLinksPerPlacement, then return roundSixDecimals(1 + differentAdjacentShopTypeCount*adjacency.differentShopTypeBonusPerLink + sameAdjacentShopTypeCount*adjacency.sameShopTypeBonusPerLink + activeSupportLinkCount*adjacency.supportLinkBonusPerLink)',
  'placement-floor-reward-times-income-weight-times-duplicate-factor-divided-by-income-period-seconds': 'roundSixDecimals(placementFloorReward * shop.incomeWeight * duplicateFactor * placementLinkMultiplier / shopModel.incomePeriodSeconds)',
  'per-level-effect-times-effective-level-times-duplicate-factor': 'roundSixDecimals(shopEffectPerLevel * effectivePlacementLevel * duplicateFactor * placementLinkMultiplier)'
};
for (const [formulaId, definition] of Object.entries(exactAdjacencyDefinitions)) {
  if (candidate.formulaRules.algorithmDefinitions[formulaId] !== definition) fail('adjacency formula definition differs from its sealed algorithm: ' + formulaId);
}
const placementLinkMultiplier = (differentCount, sameCount, supportCount, adjacency) => {
  if (![differentCount, sameCount, supportCount].every(Number.isSafeInteger)
    || Math.min(differentCount, sameCount, supportCount) < 0
    || differentCount + sameCount > adjacency.maximumLinksPerPlacement
    || supportCount > adjacency.maximumSupportLinksPerPlacement) return null;
  return roundSixDecimals(1
    + differentCount * adjacency.differentShopTypeBonusPerLink
    + sameCount * adjacency.sameShopTypeBonusPerLink
    + supportCount * adjacency.supportLinkBonusPerLink);
};
const syntheticAdjacency = { differentShopTypeBonusPerLink: 0.03, sameShopTypeBonusPerLink: 0.01, supportLinkBonusPerLink: 0.02, maximumLinksPerPlacement: 2, maximumSupportLinksPerPlacement: 2 };
const linkedMultiplierFixture = placementLinkMultiplier(1, 0, 1, syntheticAdjacency);
const unlinkedMultiplierFixture = placementLinkMultiplier(0, 0, 0, syntheticAdjacency);
if (!near(linkedMultiplierFixture, 1.05) || !near(unlinkedMultiplierFixture, 1)) fail('adjacency multiplier fixture differs from the canonical one-link composition');
if (placementLinkMultiplier(syntheticAdjacency.maximumLinksPerPlacement + 1, 0, 0, syntheticAdjacency) !== null
  || placementLinkMultiplier(0, 0, syntheticAdjacency.maximumSupportLinksPerPlacement + 1, syntheticAdjacency) !== null) fail('adjacency multiplier accepted an over-cap count');
const baseIncomeWithoutLink = roundSixDecimals(120 * 0.5 * 0.8 / 20);
const baseIncomeWithLink = roundSixDecimals(120 * 0.5 * 0.8 * linkedMultiplierFixture / 20);
const levelEffectWithoutLink = roundSixDecimals(0.02 * 10 * 0.8);
const levelEffectWithLink = roundSixDecimals(0.02 * 10 * 0.8 * linkedMultiplierFixture);
if (!near(baseIncomeWithLink / baseIncomeWithoutLink, linkedMultiplierFixture)
  || !near(levelEffectWithLink / levelEffectWithoutLink, linkedMultiplierFixture)
  || near(baseIncomeWithLink, baseIncomeWithoutLink)
  || near(levelEffectWithLink, levelEffectWithoutLink)
  || near(baseIncomeWithLink, roundSixDecimals(baseIncomeWithoutLink * linkedMultiplierFixture * linkedMultiplierFixture))
  || near(levelEffectWithLink, roundSixDecimals(levelEffectWithoutLink * linkedMultiplierFixture * linkedMultiplierFixture))) fail('adjacency link is not applied exactly once to base income and continuous level effects');
if (!sameJson(candidate.effectComposition.incomeOrder, [
  'sum-each-placement-base-income-with-link-multiplier-already-applied-once',
  'apply-each-placement-level-income-with-link-multiplier-already-applied-once',
  'support-additive-bonus',
  'relic-additive-bonus',
  'dawn-commerce-multiplier'
])) fail('income composition order could apply the placement-link multiplier outside its exact formulas');
for (const token of ['already link-composed liveIncomeFormulaId', 'duplicateFactor and placementLinkMultiplier are already inside', 'must not be applied again']) {
  if (!candidate.shopModel.effectChannelSemantics.liveIncomePerLevel.includes(token)) fail('live-income level composition omits: ' + token);
}
const placementLocalLiveIncomeFixture = (placements, cap) => placements.reduce((sum, placement) => sum + placement.baseIncome * (1 + Math.min(cap, placement.localLevelBonus)), 0);
const twoPlacementLocalIncome = placementLocalLiveIncomeFixture([{baseIncome: 10, localLevelBonus: 0.2}, {baseIncome: 20, localLevelBonus: 0.3}], 1.5);
const illegalPooledIncome = (10 + 20) * (1 + 0.2 + 0.3);
if (!near(twoPlacementLocalIncome, 38) || near(twoPlacementLocalIncome, illegalPooledIncome)) fail('live-income level bonuses are pooled across placements instead of applied placement-locally');
const liveAccrualDefinition = candidate.formulaRules.algorithmDefinitions['foreground-live-income-over-fixed-step'];
if (!liveAccrualDefinition.includes('creditedWholeCoins') || !liveAccrualDefinition.includes('retainedFraction') || liveAccrualDefinition.includes('returnedFraction')
  || !candidate.shopModel.liveIncomeAccrual.includes('creditedWholeCoins') || !candidate.shopModel.liveIncomeAccrual.includes('retainedFraction') || candidate.shopModel.liveIncomeAccrual.includes('returnedFraction')) fail('live-income accumulator producer and consumer disagree on output field names');
if (!candidate.formulaRules.algorithmDefinitions['reciprocal-of-sum-of-positive-threat-share-divided-by-selected-weapon-threat-multiplier'].includes('threatShares[bucket]')) fail('mixed-threat formula definition does not use its declared plural runtime operand');
const utilitySurvival = (firstKoMs) => firstKoMs === null
  ? candidate.effectComposition.utilityProjectionWindowSeconds + candidate.clockModel.fixedStepMs / 1000
  : Math.max(candidate.decisionPolicies.purchase.ratioEpsilon, firstKoMs / 1000);
const projectionBoundaryMs = candidate.effectComposition.utilityProjectionWindowSeconds * 1000;
if (!(utilitySurvival(null) > utilitySurvival(projectionBoundaryMs)
  && utilitySurvival(projectionBoundaryMs) > utilitySurvival(projectionBoundaryMs - candidate.clockModel.fixedStepMs)
  && utilitySurvival(projectionBoundaryMs - candidate.clockModel.fixedStepMs) > utilitySurvival(0))) fail('utility survival ordering does not make no-KO strictly best across the projection boundary');
if (!candidate.effectComposition.utilityCategoryDefinitions.survival.includes('utilitySurvivalFormulaId')
  || !candidate.effectComposition.utilityCategoryDefinitions.survival.includes('never reads collapseSecondsForScalarDefinition')
  || !candidate.effectComposition.utilityCategoryDefinitions.survival.includes('no-KO trace is strictly better')) fail('utility survival definition is not separated from the 90-second effective-power sentinel');
const reclearSeconds = (baseSeconds, powerRatio, reclear, fixedStepMs) => {
  const clampedRatio = Math.min(reclear.powerRatioClamp[1], Math.max(reclear.powerRatioClamp[0], powerRatio));
  const quantizedMs = Math.ceil((baseSeconds / clampedRatio * 1000) / fixedStepMs) * fixedStepMs;
  return Math.max(reclear.minimumSecondsPerFloor * 1000, quantizedMs) / 1000;
};
const syntheticReclear = { powerRatioClamp: [0.5, 3], minimumSecondsPerFloor: 1 };
if (!near(reclearSeconds(6.5, 1, syntheticReclear, 50), 6.5) || !near(reclearSeconds(16, 1, syntheticReclear, 50), 16)) fail('known-floor re-clear formula does not return the synthetic baseline values in seconds');
const currentPowerRule = candidate.offline.postDawnKnownFloorReclear.currentEffectivePowerOperandRule;
for (const token of ["before that floor's recovery", 'explicit comparison floor n', 'exact current HP', 'profile.recordedFirstClearEffectivePowerByFloor[String(n)]', 'finite strictly positive scalar', 'n mod 10 equals 0']) {
  if (!currentPowerRule.includes(token)) fail('known-floor current-effective-power operand rule omits: ' + token);
}

const registryIdList = [];
for (const value of Object.values(status.stableIdRegistry)) {
  if (!Array.isArray(value)) continue;
  for (const entry of value) registryIdList.push(typeof entry === 'string' ? entry : entry.id);
}
const registryIds = new Set(registryIdList);
if (registryIds.size !== registryIdList.length) fail('stable registry contains duplicate IDs');
const canonicalIdRegex = new RegExp(status.stableIdRegistry.namespaceRules.canonicalIdRegex);
for (const id of registryIds) if (!canonicalIdRegex.test(id)) fail(`stable registry ID violates canonical regex: ${id}`);
const expectedRegistryCounts = {
  cats: 12,
  helpers: 3,
  normalEnemies: 6,
  eliteEnemies: 2,
  bosses: 10,
  districts: 10,
  relics: 3,
  shops: 10,
  supportFacilities: 4,
  encounters: 1,
  armaments: 3,
  dawnBranches: 3,
  currencies: 2,
  firstAchievements: 3,
  events: 1,
  dawnRewardIds: 33
};
for (const [collection, count] of Object.entries(expectedRegistryCounts)) {
  if (status.stableIdRegistry[collection].length !== count) fail(`stable registry ${collection} count differs from ${count}`);
}
for (const [alias, target] of Object.entries(status.stableIdMigrationAliases)) {
  if (registryIds.has(alias)) fail(`migration alias is also a canonical registered ID: ${alias}`);
  if (!registryIds.has(target)) fail(`migration alias target is unregistered: ${alias} -> ${target}`);
  if (alias === target) fail(`migration alias is self-referential: ${alias}`);
}
const requiredIds = new Set([
  ...Object.keys(candidate.catBaselines),
  ...Object.keys(candidate.shopModel.shops),
  ...Object.keys(candidate.supportModel).filter((id) => id.startsWith('support.')),
  ...Object.keys(candidate.relicModel.relics),
  ...Object.keys(candidate.weapons).filter((id) => id.startsWith('armament.')),
  ...candidate.districtProgression.districts.flatMap((district) => [
    district.id,
    district.bossId,
    ...district.catUnlocks.map((unlock) => unlock.id),
    ...district.shopUnlocks.flatMap((unlock) => unlock.ids),
    ...district.supportActivations.map((activation) => activation.id)
  ]),
  ...candidate.districtProgression.relicChoicesPerX9,
  candidate.floorOverrides['8'].encounterId,
  ...candidate.floorOverrides['8'].namedObjectiveWaveEntities.map((entry) => entry.id),
  candidate.floorOverrides['8'].objectiveSuccessEventId,
  ...Object.values(candidate.floorOverrides['9'].variants).map((entry) => entry.leadEnemyId),
  ...candidate.dawn.rewardLedger.milestones.entries.map((entry) => entry.id),
  ...candidate.dawn.rewardLedger.bosses.entries.flatMap((entry) => [entry.id, entry.bossId]),
  ...Object.keys(candidate.dawn.rewardLedger.achievements),
  ...Object.values(candidate.dawn.rewardLedger.achievements).map((entry) => entry.sourceAchievementId),
  candidate.dawn.permanentCurrencyId
]);
for (const id of requiredIds) if (!registryIds.has(id)) fail(`unregistered canonical ID: ${id}`);

const manifestIdFields = [];
const collectManifestIdFields = (value, path = '$') => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id' && typeof child === 'string') manifestIdFields.push({ path: `${path}.id`, id: child });
    collectManifestIdFields(child, `${path}.${key}`);
  }
};
collectManifestIdFields(candidate);
for (const entry of manifestIdFields) if (!registryIds.has(entry.id)) fail(`unregistered manifest id field at ${entry.path}: ${entry.id}`);

const canonicalTokens = [];
const collectCanonicalTokens = (value, path = '$') => {
  if (typeof value === 'string') {
    if (canonicalIdRegex.test(value)) canonicalTokens.push({path, id: value});
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (canonicalIdRegex.test(key)) canonicalTokens.push({path: `${path}{key}`, id: key});
    collectCanonicalTokens(child, `${path}.${key}`);
  }
};
collectCanonicalTokens(candidate);
for (const token of canonicalTokens) if (!registryIds.has(token.id)) fail(`unregistered canonical token at ${token.path}: ${token.id}`);

const expectedScreenStates = {
  S01: ['new-game', 'saved-resume', 'audio-and-portrait-safe-area', 'migration-failure-recovery'],
  S02: ['first-floor-tutorial', 'normal-battle', 'multiple-enemies', 'elite-battle', 'delivery-and-return-to-battle'],
  S03: ['conquered-current-unseen', 'district-rail', 'battle-continues', 'combat-warning-and-return', 'virtualized-nine-to-thirteen-floors'],
  S04: ['ko-reward-and-stair', 'empty-slot', 'choose-now-or-later', 'support-floor-clear-variant', 'cat-rescue-clear-variant'],
  S05: ['initial-placement', 'four-candidate-comparison', 'predicted-effect-and-delivery', 'adjacency-effect', 'diminishing-duplicates', 'loss-and-retention-before-reconfigure'],
  S06: ['four-public-unlock-conditions', 'unlock-animation', 'progress-and-party', 'roles-and-bulk-level-purchase', 'living-preview'],
  S07: ['three-builds', 'three-armaments', 'predicted-ttk-survival-and-income', 'bulk-level-purchase', 'recommended-purchase', 'defeat-diagnosis-sheet'],
  S08: ['boss-intro', 'three-phase-hp', 'telegraph', 'kill-count', 'current-and-maximum-hp', 'maximum-effect-density', 'phase-two-anti-air-decision', 'failure-and-defeat'],
  S09: ['floor-10-result', 'free-reconfiguration', 'lose-keep-gain', 'zero-shard-reason', 'three-dawn-branches', 'before-and-after-comparison', 'hundred-floor-completion-record']
};
if (!sameJson(status.canonicalScreens.map((screen) => screen.id), Object.keys(expectedScreenStates))) fail('canonical screen IDs must be exactly S01-S09 in order');
for (const screen of status.canonicalScreens) {
  if (!sameJson(screen.requiredStates, expectedScreenStates[screen.id])) fail(`${screen.id} required states differ from the exact screen contract`);
}

const rewardEntries = [
  ...candidate.dawn.rewardLedger.milestones.entries,
  ...candidate.dawn.rewardLedger.bosses.entries,
  ...Object.entries(candidate.dawn.rewardLedger.achievements).map(([id, value]) => ({ id, shards: value.shards }))
];
if (rewardEntries.length !== 33) fail('Dawn reward ledger must contain 33 unique IDs');
if (new Set(rewardEntries.map((entry) => entry.id)).size !== 33) fail('Dawn reward ledger IDs must be unique');
if (rewardEntries.reduce((sum, entry) => sum + entry.shards, 0) !== 43) fail('Dawn reward ledger must total 43 shards');

const [holdoutStart, holdoutEnd] = candidate.seedPolicy.holdoutCommonSeedsInclusive;
const [calibrationStart, calibrationEnd] = candidate.seedPolicy.calibrationSeedsInclusive;
if (holdoutStart !== 100000 || holdoutEnd !== 100999 || holdoutEnd - holdoutStart + 1 !== 1000) fail('holdout seed range must be paired 100000-100999');
if (!(calibrationEnd < holdoutStart || holdoutEnd < calibrationStart)) fail('holdout seed range intersects calibration seeds');
if (!candidate.seedPolicy.preHoldoutDiagnosticSeedRule.includes('every seeded scenario, fixture, probe and diagnostic must use only calibrationSeedsInclusive')
  || !candidate.seedPolicy.holdoutRangeDisjointRule.includes('regardless of bankId')) fail('pre-holdout diagnostic or disjoint-range rule differs from the sealed contract');
if (!candidate.seedPolicy.commonRandomNumbersAcrossBuilds) fail('holdout builds must use common random numbers');
if (candidate.seedPolicy.holdoutSeedsMayTuneManifest !== false) fail('holdout seeds may not tune the manifest');
const expectedHoldoutReusePolicy = {
  bankId: 'holdout-bank-001',
  seedRangePath: '$.seedPolicy.holdoutCommonSeedsInclusive',
  observationDefinition: 'the bank becomes observed when any seed-level result, aggregate statistic, acceptance verdict or diagnostic derived from one or more bank seeds is materialized outside the running process',
  observationMakesBankSpent: true,
  sameDigestRerunPurposes: ['byte-equivalence', 'no-output-infrastructure-recovery'],
  singleConsumptionSessionMayContinueAfterBankBecomesSpent: true,
  candidateMutationInsideConsumptionSessionAllowed: false,
  firstValidAcceptanceVerdictIsAuthoritative: true,
  acceptanceVerdictValidityRule: 'a verdict is valid only when one immutable candidate raw digest and one immutable simulator raw digest produced the exact 3000 expected build-by-seed scenario identities, every seed-level record passes the sealed result schema with no missing or duplicate identity, aggregate values are independently recomputed from that exact raw dataset, and one acceptance record containing the dataset, summary and verdict digests is finalized exactly once',
  observedBankMayTuneManifest: false,
  changedCandidateMayReuseSpentBankForPromotion: false,
  failureAction: 'return-to-step-1-with-disjoint-unobserved-bank-and-rerun-step-2-before-step-3',
  partialMaterializationWithoutValidVerdictAction: 'mark-bank-spent-and-return-to-step-1-with-disjoint-unobserved-bank-and-rerun-step-2-before-step-3',
  spentBankUse: 'diagnostic-only-never-promotion',
  expectedScenarioIdentityContract: {
    buildOrderPath: '$.seedPolicy.holdoutBuilds',
    seedRangePath: '$.seedPolicy.holdoutCommonSeedsInclusive',
    identityFieldOrder: ['build', 'seed'],
    enumerationRule: 'enumerate every build in holdoutBuilds order and, within each build, every integer seed from the inclusive start through end in ascending order, producing exactly the object {build,seed} with fields in identityFieldOrder and no other field',
    preimageRule: 'UTF-8 JSON.stringify of the exact 3000-element identity array with no whitespace, BOM or trailing LF',
    digestAlgorithm: 'sha256-utf8-json-stringify-identity-array',
    expectedDigestForCurrentBank: '78700a7b086ce1e8e2edbbfb99cb2ea2fc7f8ab66f7419eaf37d4506849a11c6'
  },
  lifecycleLedgerContract: {
    path: 'simulation/results/step-3/holdout-bank-ledger.jsonl',
    format: 'append-only-one-strict-json-object-per-line',
    bankIdentityFields: ['bankId', 'seedStartInclusive', 'seedEndInclusive'],
    recordTypes: ['CONSUMPTION_STARTED', 'NO_OUTPUT_INFRASTRUCTURE_FAILURE', 'OUTPUT_OBSERVED', 'VERDICT_FINALIZED'],
    hashAlgorithm: 'sha256-utf8-canonical-payload-lowercase-hex',
    sequenceStartsAt: 1,
    sequenceIncrement: 1,
    genesisPreviousRecordSha256: '0'.repeat(64),
    emptyLedgerRevisionSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    canonicalPayloadFieldOrder: ['sequence', 'type', 'attemptId', 'bankId', 'seedStartInclusive', 'seedEndInclusive', 'candidateRawSha256', 'simulatorRawSha256', 'step2ExecutableSealRawSha256', 'expectedScenarioIdentitySha256', 'expectedScenarioCount', 'exposedDerivedOutputCount', 'failureCode', 'firstOutputKind', 'rawDatasetSha256', 'summarySha256', 'acceptanceSha256', 'verdict', 'eventAt', 'previousRecordSha256'],
    recordContracts: {
      CONSUMPTION_STARTED: {exactFields: ['sequence', 'type', 'attemptId', 'bankId', 'seedStartInclusive', 'seedEndInclusive', 'candidateRawSha256', 'simulatorRawSha256', 'step2ExecutableSealRawSha256', 'expectedScenarioIdentitySha256', 'expectedScenarioCount', 'eventAt', 'previousRecordSha256', 'recordSha256']},
      NO_OUTPUT_INFRASTRUCTURE_FAILURE: {exactFields: ['sequence', 'type', 'attemptId', 'bankId', 'seedStartInclusive', 'seedEndInclusive', 'candidateRawSha256', 'simulatorRawSha256', 'step2ExecutableSealRawSha256', 'exposedDerivedOutputCount', 'failureCode', 'eventAt', 'previousRecordSha256', 'recordSha256']},
      OUTPUT_OBSERVED: {exactFields: ['sequence', 'type', 'attemptId', 'bankId', 'seedStartInclusive', 'seedEndInclusive', 'candidateRawSha256', 'simulatorRawSha256', 'step2ExecutableSealRawSha256', 'exposedDerivedOutputCount', 'firstOutputKind', 'eventAt', 'previousRecordSha256', 'recordSha256']},
      VERDICT_FINALIZED: {exactFields: ['sequence', 'type', 'attemptId', 'bankId', 'seedStartInclusive', 'seedEndInclusive', 'candidateRawSha256', 'simulatorRawSha256', 'step2ExecutableSealRawSha256', 'rawDatasetSha256', 'summarySha256', 'acceptanceSha256', 'verdict', 'eventAt', 'previousRecordSha256', 'recordSha256']}
    },
    valueDomainRule: 'sequence, seed bounds, expectedScenarioCount and exposedDerivedOutputCount are safe nonnegative integers; every Sha256 field is 64 lowercase hexadecimal characters; attemptId matches ^holdout-bank-[0-9]{3}-attempt-[0-9]{6}$; eventAt is canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ; failureCode is infrastructure-zero-derived-output; firstOutputKind is one of seed-record, aggregate, diagnostic or verdict; verdict is PASS or FAIL; bank identity, candidate digest, simulator digest and Step 2 seal digest remain byte-identical throughout one attempt',
    canonicalizationRule: "select the record type's exactFields except recordSha256, require those fields and no others, then create a new object by taking present names in canonicalPayloadFieldOrder order; encode exactly UTF-8 JSON.stringify of that object with no whitespace, BOM or trailing LF; all strings are already restricted by valueDomainRule so no implementation-specific normalization is allowed",
    recordHashPayloadRule: 'recordSha256 is excluded from its own payload and equals lowercase SHA-256 of the exact canonical payload bytes; previousRecordSha256 remains included in that payload',
    physicalLineRule: 'the physical record is UTF-8 JSON.stringify of a new object containing the canonical payload fields in order followed by recordSha256 as the final field, then exactly one LF; blank lines, CR, BOM, duplicate keys, alternate key order, whitespace and an unterminated last line are invalid',
    previousLinkRule: 'the first record has sequence=1 and previousRecordSha256=genesisPreviousRecordSha256; each later record has sequence exactly prior sequence+1 and previousRecordSha256 exactly equal to the immediately prior record\'s recordSha256, never a raw-line digest',
    ledgerRevisionRule: 'the compare-and-append revision is lowercase SHA-256 of all current raw ledger bytes; an absent or zero-byte ledger has emptyLedgerRevisionSha256; an append must atomically compare the previously read revision and replace it with exactly prior bytes plus one validated physicalLineRule record',
    concurrencyRule: 'preflight and the CONSUMPTION_STARTED append form one exclusive compare-and-append transaction using ledgerRevisionRule; a concurrent start or revision mismatch fails before any holdout draw',
    preflightRule: 'before the first holdout draw, validate every historical record and scan the entire ledger across all bank IDs; reject if the requested inclusive seed range intersects any range with OUTPUT_OBSERVED or VERDICT_FINALIZED, intersects any unresolved CONSUMPTION_STARTED range, reassigns a historical bankId to different bounds, or assigns any historical bounds to another bankId; allow retry of the exact same bank identity only after its matching NO_OUTPUT_INFRASTRUCTURE_FAILURE proves zero derived outputs were exposed and candidateRawSha256, simulatorRawSha256 and step2ExecutableSealRawSha256 are unchanged; adjacent non-overlapping ranges are disjoint and allowed',
    startRule: 'append CONSUMPTION_STARTED before the first holdout draw with its exact record contract; candidateRawSha256 equals the preflighted candidate raw digest, simulatorRawSha256 equals the Step 2 executable seal simulatorSourceTreeSha256, step2ExecutableSealRawSha256 equals the raw seal file digest, expectedScenarioIdentitySha256 follows expectedScenarioIdentityContract, expectedScenarioCount=3000 and eventAt is the append timestamp; the candidate is immutable for the entire attempt',
    observationRule: 'append exactly one OUTPUT_OBSERVED atomically no later than the first external materialization of any seed-derived value with exposedDerivedOutputCount>=1; that record spends the entire bank while allowing only the same registered consumption session to finish',
    verdictRule: 'append exactly one VERDICT_FINALIZED after strict validation of all 3000 identities and independent aggregate recomputation, recording rawDatasetSha256, summarySha256, acceptanceSha256 and verdict',
    crashRule: 'after OUTPUT_OBSERVED, any crash, partial dataset, invalid dataset or missing valid verdict permanently bars that bank from promotion and invokes partialMaterializationWithoutValidVerdictAction',
    tamperRule: 'deletion, rewrite, truncation, broken sequence or hash link, duplicate record type within an attempt, duplicate finalization, bankId reassignment, overlapping observed or unresolved seed range, identity mismatch or non-append mutation is a fatal acceptance failure'
  }
};
if (!sameJson(candidate.seedPolicy.holdoutReusePolicy, expectedHoldoutReusePolicy)) fail('holdout bank reuse policy differs from the sealed one-use contract');
const spentBankMutationFixture = structuredClone(candidate);
spentBankMutationFixture.seedPolicy.holdoutReusePolicy.changedCandidateMayReuseSpentBankForPromotion = true;
if (executableContractDigest(spentBankMutationFixture) === expectedExecutableContractDigest) fail('negative fixture did not reject spent holdout-bank reuse');
const ledgerContract = candidate.seedPolicy.holdoutReusePolicy.lifecycleLedgerContract;
const canonicalLedgerPayload = (record) => {
  const exactFields = ledgerContract.recordContracts[record.type]?.exactFields;
  if (!exactFields || !sameJson(Object.keys(record), exactFields)) return null;
  const payload = {};
  for (const field of ledgerContract.canonicalPayloadFieldOrder) if (field !== 'recordSha256' && Object.hasOwn(record, field)) payload[field] = record[field];
  return payload;
};
const ledgerRecordErrors = (record, index, previousRecord) => {
  const errors = [];
  const payload = canonicalLedgerPayload(record);
  if (!payload) return ['field-set-or-order'];
  if (record.sequence !== index + ledgerContract.sequenceStartsAt) errors.push('sequence');
  const expectedPrevious = previousRecord?.recordSha256 ?? ledgerContract.genesisPreviousRecordSha256;
  if (record.previousRecordSha256 !== expectedPrevious) errors.push('previous-link');
  if (record.recordSha256 !== sha256(Buffer.from(JSON.stringify(payload), 'utf8'))) errors.push('record-hash');
  if (!/^holdout-bank-[0-9]{3}-attempt-[0-9]{6}$/.test(record.attemptId)) errors.push('attempt-id');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.eventAt)) errors.push('event-at');
  for (const [key, value] of Object.entries(record)) if (key.endsWith('Sha256') && !/^[0-9a-f]{64}$/.test(value)) errors.push('digest');
  if (record.type === 'CONSUMPTION_STARTED' && record.expectedScenarioCount !== 3000) errors.push('scenario-count');
  if (record.type === 'NO_OUTPUT_INFRASTRUCTURE_FAILURE' && (record.exposedDerivedOutputCount !== 0 || record.failureCode !== 'infrastructure-zero-derived-output')) errors.push('invalid-zero-output-failure');
  if (record.type === 'OUTPUT_OBSERVED' && (!(record.exposedDerivedOutputCount >= 1) || !['seed-record', 'aggregate', 'diagnostic', 'verdict'].includes(record.firstOutputKind))) errors.push('invalid-observation');
  if (record.type === 'VERDICT_FINALIZED' && !['PASS', 'FAIL'].includes(record.verdict)) errors.push('invalid-verdict');
  return errors;
};
const ledgerPhysicalLine = (record) => `${JSON.stringify(record)}\n`;
const ledgerLifecycleErrors = (records) => {
  const errors = [];
  const attempts = new Map();
  for (const record of records) {
    if (record.type === 'CONSUMPTION_STARTED') {
      if (attempts.has(record.attemptId)) {
        errors.push('duplicate-start');
        continue;
      }
      attempts.set(record.attemptId, {state: 'started', seenTypes: new Set([record.type]), identity: [record.bankId, record.seedStartInclusive, record.seedEndInclusive, record.candidateRawSha256, record.simulatorRawSha256, record.step2ExecutableSealRawSha256]});
      continue;
    }
    const attempt = attempts.get(record.attemptId);
    if (!attempt) {
      errors.push('event-before-start');
      continue;
    }
    const identity = [record.bankId, record.seedStartInclusive, record.seedEndInclusive, record.candidateRawSha256, record.simulatorRawSha256, record.step2ExecutableSealRawSha256];
    if (!sameJson(identity, attempt.identity)) errors.push('attempt-identity-drift');
    if (attempt.seenTypes.has(record.type)) errors.push('duplicate-record-type');
    attempt.seenTypes.add(record.type);
    if (record.type === 'NO_OUTPUT_INFRASTRUCTURE_FAILURE') {
      if (attempt.state !== 'started') errors.push('invalid-zero-output-transition');
      attempt.state = 'closed-zero-output';
    } else if (record.type === 'OUTPUT_OBSERVED') {
      if (attempt.state !== 'started') errors.push('invalid-observation-transition');
      attempt.state = 'observed';
    } else if (record.type === 'VERDICT_FINALIZED') {
      if (attempt.state !== 'observed') errors.push('invalid-verdict-transition');
      attempt.state = 'finalized';
    }
  }
  return errors;
};
const validateLedgerBytesFixture = (bytes) => {
  if (bytes.length === 0) return [];
  if (!bytes.endsWith('\n') || bytes.includes('\r') || bytes.startsWith('\uFEFF')) return ['physical-format'];
  const lines = bytes.slice(0, -1).split('\n');
  const errors = [];
  const records = [];
  let previous = null;
  lines.forEach((line, index) => {
    let record;
    try { record = JSON.parse(line); } catch { errors.push('json'); return; }
    if (ledgerPhysicalLine(record) !== `${line}\n`) errors.push('noncanonical-line');
    errors.push(...ledgerRecordErrors(record, index, previous));
    records.push(record);
    previous = record;
  });
  errors.push(...ledgerLifecycleErrors(records));
  return errors;
};
const baseLedgerFields = {
  attemptId: 'holdout-bank-001-attempt-000001',
  bankId: 'holdout-bank-001',
  seedStartInclusive: 100000,
  seedEndInclusive: 100999,
  candidateRawSha256: '1'.repeat(64),
  simulatorRawSha256: '2'.repeat(64),
  step2ExecutableSealRawSha256: '3'.repeat(64)
};
const makeLedgerRecord = (type, sequence, previousRecord, typeFields) => {
  const unordered = {...baseLedgerFields, ...typeFields, sequence, type, eventAt: `2026-08-25T00:00:0${sequence}.000Z`, previousRecordSha256: previousRecord?.recordSha256 ?? '0'.repeat(64)};
  const payload = {};
  for (const field of ledgerContract.canonicalPayloadFieldOrder) if (Object.hasOwn(unordered, field)) payload[field] = unordered[field];
  const record = {...payload, recordSha256: sha256(Buffer.from(JSON.stringify(payload), 'utf8'))};
  return record;
};
const chainStart = makeLedgerRecord('CONSUMPTION_STARTED', 1, null, {expectedScenarioIdentitySha256: '4'.repeat(64), expectedScenarioCount: 3000});
const chainObserved = makeLedgerRecord('OUTPUT_OBSERVED', 2, chainStart, {exposedDerivedOutputCount: 1, firstOutputKind: 'seed-record'});
const chainFinal = makeLedgerRecord('VERDICT_FINALIZED', 3, chainObserved, {rawDatasetSha256: '5'.repeat(64), summarySha256: '6'.repeat(64), acceptanceSha256: '7'.repeat(64), verdict: 'PASS'});
const chainNoOutput = makeLedgerRecord('NO_OUTPUT_INFRASTRUCTURE_FAILURE', 2, chainStart, {exposedDerivedOutputCount: 0, failureCode: 'infrastructure-zero-derived-output'});
const validLedgerBytes = ledgerPhysicalLine(chainStart) + ledgerPhysicalLine(chainObserved) + ledgerPhysicalLine(chainFinal);
const validZeroOutputLedgerBytes = ledgerPhysicalLine(chainStart) + ledgerPhysicalLine(chainNoOutput);
const sequenceGap = structuredClone(chainObserved);
sequenceGap.sequence = 3;
const wrongPrevious = structuredClone(chainObserved);
wrongPrevious.previousRecordSha256 = '9'.repeat(64);
const payloadTamper = structuredClone(chainObserved);
payloadTamper.exposedDerivedOutputCount = 2;
const unknownField = {...chainObserved, unknown: true};
const duplicateJsonKeyLine = ledgerPhysicalLine(chainStart) + `{"sequence":2,"sequence":2}\n`;
if (validateLedgerBytesFixture(validLedgerBytes).length !== 0
  || validateLedgerBytesFixture(validZeroOutputLedgerBytes).length !== 0
  || ledgerRecordErrors(sequenceGap, 1, chainStart).length === 0
  || ledgerRecordErrors(wrongPrevious, 1, chainStart).length === 0
  || ledgerRecordErrors(payloadTamper, 1, chainStart).length === 0
  || ledgerRecordErrors(unknownField, 1, chainStart).length === 0
  || ledgerLifecycleErrors([chainStart, chainObserved, chainObserved]).length === 0
  || ledgerLifecycleErrors([chainStart, chainFinal]).length === 0
  || ledgerLifecycleErrors([chainStart, chainNoOutput, chainObserved]).length === 0
  || validateLedgerBytesFixture(duplicateJsonKeyLine).length === 0
  || validateLedgerBytesFixture(validLedgerBytes.slice(0, -1)).length === 0) fail('holdout ledger canonical bytes, sequence, hash link or tamper fixtures are not strict');
const rangesIntersect = (left, right) => left[0] <= right[1] && right[0] <= left[1];
const holdoutPreflightFixture = (history, request) => {
  if (rangesIntersect([calibrationStart, calibrationEnd], request.range)) return false;
  const sameBankRecords = history.filter((entry) => entry.bankId === request.bankId);
  if (sameBankRecords.some((entry) => !sameJson(entry.range, request.range))) return false;
  for (const entry of history) {
    if (!rangesIntersect(entry.range, request.range)) continue;
    if (entry.state === 'observed' || entry.state === 'finalized' || entry.state === 'unresolved') return false;
    if (entry.state === 'zero-output-failure' && (entry.bankId !== request.bankId || !sameJson(entry.range, request.range)
      || entry.candidateRawSha256 !== request.candidateRawSha256 || entry.simulatorRawSha256 !== request.simulatorRawSha256
      || entry.step2ExecutableSealRawSha256 !== request.step2ExecutableSealRawSha256)) return false;
  }
  return true;
};
const requestBank1 = {bankId: 'holdout-bank-001', range: [100000, 100999], candidateRawSha256: '1', simulatorRawSha256: '2', step2ExecutableSealRawSha256: '3'};
const spentHistory = [{...requestBank1, state: 'finalized'}];
const failedHistory = [{...requestBank1, state: 'zero-output-failure'}];
if (holdoutPreflightFixture(spentHistory, {...requestBank1, bankId: 'holdout-bank-002'})
  || holdoutPreflightFixture(spentHistory, {...requestBank1, bankId: 'holdout-bank-002', range: [100999, 101998]})
  || !holdoutPreflightFixture(spentHistory, {...requestBank1, bankId: 'holdout-bank-002', range: [101000, 101999]})
  || holdoutPreflightFixture([{...requestBank1, state: 'unresolved'}], {...requestBank1, bankId: 'holdout-bank-002'})
  || holdoutPreflightFixture(failedHistory, {...requestBank1, simulatorRawSha256: 'changed'})
  || !holdoutPreflightFixture(failedHistory, requestBank1)
  || holdoutPreflightFixture([], {...requestBank1, bankId: 'holdout-bank-002', range: [200, 1199]})) fail('holdout preflight permits calibration, spent, overlapping, reassigned or mismatched zero-output seed reuse');
const expectedScenarioIdentities = candidate.seedPolicy.holdoutBuilds.flatMap((build) => Array.from(
  {length: holdoutEnd - holdoutStart + 1},
  (_, index) => ({build, seed: holdoutStart + index})
));
const expectedScenarioIdentitySha256 = sha256(Buffer.from(JSON.stringify(expectedScenarioIdentities), 'utf8'));
if (expectedScenarioIdentities.length !== 3000
  || expectedScenarioIdentitySha256 !== candidate.seedPolicy.holdoutReusePolicy.expectedScenarioIdentityContract.expectedDigestForCurrentBank) fail('holdout expected scenario identity digest is not the exact paired 3000-scenario set');

const uFor = (floor, rewardingDawns) => {
  if (floor === 0) return 0;
  const u = candidate.offline.uIndex;
  const reward = candidate.curves.enemyReward;
  const refs = [u.fixedCombatReference, u.fixedReinforcementReference, u.fixedCommerceReference]
    .map((base) => base * reward.floorGrowthInitial ** (floor - 1) * u.rewardingDawnGrowth ** rewardingDawns)
    .sort((a, b) => a - b);
  const neutral = reward.baseInitial * reward.floorGrowthInitial ** (floor - 1);
  return Math.min(neutral * u.clampUpperMultiplier, Math.max(neutral * u.clampLowerMultiplier, refs[1]));
};
const stagedF1USnapshotFixture = {
  highestReachedFloor: 1,
  rewardingDawnCount: 0,
  clampedU: uFor(1, 0)
};
if (!(stagedF1USnapshotFixture.clampedU > 0)
  || stagedF1USnapshotFixture.highestReachedFloor !== 1
  || !near(stagedF1USnapshotFixture.clampedU, uFor(stagedF1USnapshotFixture.highestReachedFloor, stagedF1USnapshotFixture.rewardingDawnCount))) fail('normal F1 clear does not stage U from the newly committed highest floor');
for (let dawn = 0; dawn <= 10; dawn += 1) {
  for (let floor = 0; floor < 100; floor += 1) {
    if (uFor(floor + 1, dawn) + 1e-9 < uFor(floor, dawn)) fail(`U decreased from F${floor} to F${floor + 1} at Dawn ${dawn}`);
  }
}
for (let floor = 0; floor <= 100; floor += 1) {
  for (let dawn = 0; dawn < 10; dawn += 1) {
    if (uFor(floor, dawn + 1) + 1e-9 < uFor(floor, dawn)) fail(`U decreased at F${floor} from rewarding Dawn ${dawn} to ${dawn + 1}`);
  }
}

const mugi = candidate.catBaselines['cat.mugi'];
const luna = candidate.catBaselines['cat.luna'];
for (const hit of candidate.curves.enemyAttack.baseHitDamageRange) {
  const mugiHits = mugi.baseHp / hit;
  const lunaHits = luna.baseHp / hit;
  if (mugiHits < 6 || mugiHits > 10) fail(`F1 Mugi hit count ${mugiHits} is outside 6-10`);
  if (lunaHits < 3 || lunaHits > 5) fail(`F1 Luna hit count ${lunaHits} is outside 3-5`);
}

if (candidate.dawn.reset.rewardingDawnCountIncrement !== '1 only when newRewardIds is nonempty; otherwise 0') fail('zero-gain Dawn must not increment rewardingDawnCount');
const [returnFractionLower, returnFractionUpper] = candidate.dawn.firstReturnToPriorMaximumTimeFractionTarget;
const [reclearSpeedLower, reclearSpeedUpper] = candidate.dawn.compositeReclearSpeedTargetDerived.range;
if (!near(reclearSpeedLower, 1 / returnFractionUpper) || !near(reclearSpeedUpper, 1 / returnFractionLower)) fail('Dawn re-clear speed range must be the exact reciprocal of the return-time fraction range');
if (!candidate.dawn.firstReturnToPriorMaximumEvaluationProcedure.includes('first executed progress Dawn') || !candidate.dawn.firstReturnToPriorMaximumEvaluationProcedure.includes('positive infinity') || !candidate.dawn.firstReturnToPriorMaximumEvaluationProcedure.includes('nearest-rank p50') || !candidate.dawn.firstReturnToPriorMaximumEvaluationProcedure.includes('at or before the local maximumForegroundSeconds')) fail('Dawn return-time target lacks an exact cohort, inclusive local boundary and non-return procedure');
if (!candidate.dawn.dawnCountToFloor100Procedure.includes('profile.completedDawnCount') || !candidate.dawn.dawnCountToFloor100Procedure.includes('zero-gain recovery Dawn counts once') || !candidate.dawn.dawnCountToFloor100Procedure.includes('p50 exactly standardDawnsToFloor100')) fail('Dawn-count target lacks an exact counter and aggregation');
if (!candidate.timingTargets.firstDawnMeasurementProcedure.includes('pre-Dawn profile.highestReachedFloor') || !candidate.timingTargets.firstDawnMeasurementProcedure.includes('never use run.currentFloor') || !candidate.timingTargets.firstDawnMeasurementProcedure.includes('foregroundProgressionSeconds/60')) fail('first-Dawn timing target lacks exact time and floor operands');
const wallClockTarget = candidate.timingTargets.firstHundredWallClockDays;
if (wallClockTarget.hardCalendarGate !== false || wallClockTarget.simulationP50Gate !== true || wallClockTarget.passive !== 'diagnostic-only-no-hard-range') fail('100F wall-clock target confuses runtime calendar locking with the simulation median gate');
for (const token of ['hardCalendarGate=false means no runtime date, login-day or elapsed-time unlock', 'does not disable balance validation', 'simulationP50Gate=true', 'hard Step 2/Step 3 natural-progression p50 acceptance ranges', 'passive remains diagnostic-only']) {
  if (!candidate.timingTargets.progressionTimingCohorts.includes(token)) fail('100F wall-clock cohort rule omits: ' + token);
}
for (const token of ['compare active and standard nearest-rank p50', 'simulationP50Gate=true', 'report passive p10/p50/p90 without a comparison', 'hardCalendarGate=false affects runtime unlocks only']) {
  if (!candidate.timingTargets.distributionStatisticRules.includes(token)) fail('100F wall-clock statistic rule omits: ' + token);
}
const wallClockGateFixture = (schedule, p50Days) => {
  const range = wallClockTarget[schedule];
  const simulationPass = schedule === 'passive' ? true : Array.isArray(range) && p50Days >= range[0] && p50Days <= range[1];
  return {simulationPass, runtimeCalendarBlocked: wallClockTarget.hardCalendarGate};
};
if (!sameJson(wallClockGateFixture('active', 9), {simulationPass: true, runtimeCalendarBlocked: false})
  || !sameJson(wallClockGateFixture('active', 30), {simulationPass: false, runtimeCalendarBlocked: false})
  || !sameJson(wallClockGateFixture('standard', 14), {simulationPass: true, runtimeCalendarBlocked: false})
  || !sameJson(wallClockGateFixture('passive', 100), {simulationPass: true, runtimeCalendarBlocked: false})) fail('100F wall-clock fixture failed to separate natural-progression acceptance from forbidden runtime gating');
for (const field of ['maximumRecommendationDirectionInversions', 'maximumDisplayedTtkDirectionInversions', 'maximumStateFaithfulSurvivalSignInversions']) {
if (candidate.weapons.rejection[field] !== 0) fail(`weapon prediction gate ${field} must reject every inversion`);
}
for (const field of [
  'fullHpToZeroFromAnyAtomicNormalHitAllowed',
  'fullHpToZeroFromAnyAtomicProjectileHitAllowed',
  'fullHpToZeroFromAnyAtomicEliteHeavyHitAllowed',
  'fullHpToZeroFromAnyAtomicBossHeavyHitAllowed'
]) {
  if (candidate.enemyModel.recommendedBandSurvival[field] !== 0) fail(`atomic one-hit survival gate must be zero: ${field}`);
}
for (const eventClass of ['normal melee', 'normal projectile', 'elite heavy', 'boss heavy']) {
  if (!candidate.survival.oneHitCheck.includes(eventClass)) fail(`one-hit check omits atomic event class: ${eventClass}`);
}
if (!candidate.builds.comparison.medianSpreadFormula.includes('maximum build p50 by the minimum build p50')) fail('median build-spread formula differs from the canonical ratio of build percentiles');
if (!candidate.builds.comparison.robustSpreadFormula.includes('maximum build p90 by the minimum build p10')) fail('robust build-spread formula differs from the canonical ratio of build percentiles');
if (!candidate.builds.comparison.extremeSpreadFormula.includes('divide nearest-rank p50 completion time')) fail('extreme build-spread formula differs from the canonical ratio of persona percentiles');
if (!candidate.clockModel.persistedStateRevisionRule.includes('compare-and-swap')) fail('persisted state revision rule must use compare-and-swap');
if (!candidate.offline.settlement.atomicCommitRule.includes('stateRevision=expectedRevision+1')) fail('offline settlement must commit exactly one next revision');
if (!candidate.dawn.decisionPolicy.manualComparisonCheckpoint.includes('never executes Dawn')) fail('manual Dawn comparison must be non-mutating');

const digest = createHash('sha256').update(candidateBytes).digest('hex');
if (failures.length) {
  console.error(JSON.stringify({ verdict: 'FAIL', digest, normalizedExecutableDigest: actualExecutableContractDigest, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  verdict: 'PASS',
  candidateId: candidate.candidateId,
  digest,
  normalizedExecutableDigest: actualExecutableContractDigest,
  counts: { cats: 12, districts: 10, shops: 10, relics: 3, dawnRewardIds: 33, holdoutPerBuild: 1000 }
}, null, 2));
