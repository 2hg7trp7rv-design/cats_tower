#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { deterministicSeed } from '../../engine-v2/rng.mjs';
import { runScenario } from '../../engine-v2/run-scenario.mjs';
import { runGameplayPartition } from '../../engine-v2/run-plan.mjs';
import { runHighVolumeSuite } from '../../engine-v2/high-volume.mjs';

const root = resolve('.');
const load = async (path) => JSON.parse(await readFile(resolve(path), 'utf8'));
const candidate = await load('simulation/candidate-v2.json');
const plan = await load('simulation/run-plan-v2.json');
const execution = await load('simulation/execution-contract-v2.json');
const executionNegative = await load('simulation/fixtures/v2/execution-contract-negative.json');
const errors = [];
const check = (condition, code, message) => { if (!condition) errors.push({ code, message }); };

function decodePointer(path) {
  if (path === '') return [];
  return path.split('/').slice(1).map((value) => value.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function mutate(base, mutation) {
  const copy = structuredClone(base);
  const parts = decodePointer(mutation.path);
  if (!parts.length) throw new Error('ROOT_MUTATION_FORBIDDEN');
  let node = copy;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = Array.isArray(node) ? Number(parts[index]) : parts[index];
    node = node[part];
  }
  const key = Array.isArray(node) ? Number(parts.at(-1)) : parts.at(-1);
  if (mutation.op === 'set') node[key] = structuredClone(mutation.value);
  else if (mutation.op === 'delete') {
    if (Array.isArray(node)) node.splice(key, 1);
    else delete node[key];
  } else throw new Error(`UNKNOWN_MUTATION:${mutation.op}`);
  return copy;
}

function mutateMany(base, mutations) {
  return mutations.reduce((current, mutation) => mutate(current, mutation), base);
}

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function hasCode(stderr, code) {
  return stderr.includes(`\"code\": \"${code}\"`) || stderr.includes(`\"code\":\"${code}\"`);
}

async function expectRejected(temp, group, id, value, validatorArgs, expectedCodes) {
  const path = join(temp, `${group}-${id}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const run = runNode([validatorArgs[0], path, ...validatorArgs.slice(1)]);
  check(run.status !== 0, `${group.toUpperCase()}_NEGATIVE_ACCEPTED`, id);
  check(expectedCodes.some((code) => hasCode(run.stderr ?? '', code)), `${group.toUpperCase()}_NEGATIVE_WRONG_REASON`, `${id}:${expectedCodes.join('|')}:${(run.stderr ?? '').slice(0, 1000)}`);
}

check(executionNegative.cases.length.toString() === executionNegative.caseCount, 'EXECUTION_NEGATIVE_COUNT', 'execution contract negative case count mismatch');

const seed = deterministicSeed(execution.partitions.qualification.namespace, 'build.combat', 'no-ad-f2p', 0);
const scenarioInput = {
  buildId: 'build.combat',
  personaId: 'no-ad-f2p',
  namespace: execution.partitions.qualification.namespace,
  partition: 'qualification',
  seed,
  ordinal: 0,
};
const baseScenario = runScenario(candidate, plan, execution, scenarioInput);
const resetChanged = structuredClone(execution);
resetChanged.model.firstReset.personaBaseMinutes['no-ad-f2p'] = (BigInt(resetChanged.model.firstReset.personaBaseMinutes['no-ad-f2p']) + 5n).toString();
const resetScenario = runScenario(candidate, plan, resetChanged, scenarioInput);
check(baseScenario.firstResetMinutes !== resetScenario.firstResetMinutes, 'EXECUTION_MODEL_RESET_BINDING', 'changing sealed first-reset input did not change scenario output');
check(baseScenario.scenarioDigest !== resetScenario.scenarioDigest, 'EXECUTION_MODEL_RESET_DIGEST', 'changing sealed first-reset input did not change scenario digest');

const horizonChanged = structuredClone(execution);
horizonChanged.model.progression.baselineMinutesByHorizon['100F'] = (BigInt(horizonChanged.model.progression.baselineMinutesByHorizon['100F']) + 1000n).toString();
const horizonScenario = runScenario(candidate, plan, horizonChanged, scenarioInput);
const base100 = baseScenario.horizons.find((entry) => entry.horizonId === '100F').estimatedReachMinutes;
const changed100 = horizonScenario.horizons.find((entry) => entry.horizonId === '100F').estimatedReachMinutes;
check(base100 !== changed100, 'EXECUTION_MODEL_HORIZON_BINDING', 'changing sealed 100F baseline did not change scenario output');
check(baseScenario.scenarioDigest !== horizonScenario.scenarioDigest, 'EXECUTION_MODEL_HORIZON_DIGEST', 'changing sealed horizon input did not change scenario digest');

const identityScenario = runScenario(candidate, plan, execution, { ...scenarioInput, namespace: execution.partitions.holdout.namespace, partition: 'holdout' });
check(baseScenario.scenarioId !== identityScenario.scenarioId, 'EXECUTION_PARTITION_IDENTITY', 'partition change did not change scenarioId');
check(baseScenario.scenarioDigest !== identityScenario.scenarioDigest, 'EXECUTION_PARTITION_DIGEST', 'partition change did not change scenario digest');
let missingIdentityRejected = false;
try { runScenario(candidate, plan, execution, { ...scenarioInput, namespace: undefined }); } catch (error) { missingIdentityRejected = error.message === 'SCENARIO_NAMESPACE_AND_PARTITION_REQUIRED'; }
check(missingIdentityRejected, 'EXECUTION_PARTITION_REQUIRED', 'scenario accepted missing namespace');

const temp = await mkdtemp(join(tmpdir(), 'cats-tower-v2-execution-negative-'));
try {
  for (const test of executionNegative.cases) {
    await expectRejected(temp, 'execution', test.id, mutate(execution, test.mutation), ['simulation/validate-execution-contract-v2.mjs'], test.expectedCodes);
  }

  const gameplayBase = await runGameplayPartition({ partition: 'calibration', contractSmoke: true, smokeSeedsPerCell: '2', owner: 'STEP2' });
  const gameplayPositivePath = join(temp, 'gameplay-positive.json');
  await writeFile(gameplayPositivePath, `${JSON.stringify(gameplayBase, null, 2)}\n`, 'utf8');
  const gameplayPositive = runNode(['simulation/validate-gameplay-result-v2.mjs', gameplayPositivePath, '--allow-contract-smoke', '--reproduce']);
  check(gameplayPositive.status === 0, 'GAMEPLAY_POSITIVE_REJECTED', (gameplayPositive.stderr ?? '').slice(0, 1000));

  const gameplayCases = [
    {
      id: 'candidate-digest-tamper',
      mutations: [{ op: 'set', path: '/hashes/candidateSha256', value: '0'.repeat(64) }],
      expectedCodes: ['GAMEPLAY_CANDIDATE_DIGEST'],
    },
    {
      id: 'smoke-claims-full-mode',
      mutations: [{ op: 'set', path: '/deterministicPayload/mode', value: 'STEP3_GAMEPLAY_PARTITION' }],
      expectedCodes: ['GAMEPLAY_FULL_COMPLETE', 'GAMEPLAY_FULL_SIZE', 'GAMEPLAY_FULL_ID'],
    },
    {
      id: 'smoke-claims-complete',
      mutations: [{ op: 'set', path: '/deterministicPayload/complete', value: true }],
      expectedCodes: ['GAMEPLAY_SMOKE_COMPLETE'],
    },
    {
      id: 'partition-namespace-mismatch',
      mutations: [{ op: 'set', path: '/deterministicPayload/partition', value: 'holdout' }],
      expectedCodes: ['GAMEPLAY_NAMESPACE', 'GAMEPLAY_TUNING_VISIBILITY'],
    },
    {
      id: 'duplicate-cell-identity',
      mutations: [
        { op: 'set', path: '/deterministicPayload/cells/1/cellId', value: gameplayBase.deterministicPayload.cells[0].cellId },
        { op: 'set', path: '/deterministicPayload/cells/1/buildId', value: gameplayBase.deterministicPayload.cells[0].buildId },
        { op: 'set', path: '/deterministicPayload/cells/1/personaId', value: gameplayBase.deterministicPayload.cells[0].personaId },
      ],
      expectedCodes: ['GAMEPLAY_CELL_IDENTITY'],
    },
    {
      id: 'scenario-count-mismatch',
      mutations: [{ op: 'set', path: '/deterministicPayload/scenarioCount', value: '29' }],
      expectedCodes: ['GAMEPLAY_SCENARIO_COUNT', 'GAMEPLAY_GLOBAL_DIGEST_COUNT'],
    },
    {
      id: 'percentile-order-invalid',
      mutations: [{ op: 'set', path: '/deterministicPayload/cells/0/metrics/firstResetMinutes/p50', value: '9999' }],
      expectedCodes: ['GAMEPLAY_SUMMARY_ORDER'],
    },
    {
      id: 'partition-authorizes-promotion',
      mutations: [{ op: 'set', path: '/verdict/step3PromotionAllowed', value: true }],
      expectedCodes: ['SCHEMA', 'GAMEPLAY_PROMOTION'],
    },
    {
      id: 'contract-violation-hidden',
      mutations: [{ op: 'set', path: '/deterministicPayload/violations/0', value: { code: 'HIDDEN' } }],
      expectedCodes: ['GAMEPLAY_VIOLATIONS'],
    },
    {
      id: 'duplicate-scenario-digest',
      mutations: [{ op: 'set', path: '/deterministicPayload/cells/0/scenarioDigests/1', value: gameplayBase.deterministicPayload.cells[0].scenarioDigests[0] }],
      expectedCodes: ['GAMEPLAY_DIGEST_UNIQUE'],
    },
  ];
  for (const test of gameplayCases) {
    await expectRejected(temp, 'gameplay', test.id, mutateMany(gameplayBase, test.mutations), ['simulation/validate-gameplay-result-v2.mjs', '--allow-contract-smoke'], test.expectedCodes);
  }

  const highVolumeBase = await runHighVolumeSuite({ suiteId: 'gacha-tails', contractSmoke: true, owner: 'STEP2' });
  const highVolumePositivePath = join(temp, 'high-volume-positive.json');
  await writeFile(highVolumePositivePath, `${JSON.stringify(highVolumeBase, null, 2)}\n`, 'utf8');
  const highVolumePositive = runNode(['simulation/validate-high-volume-result-v2.mjs', highVolumePositivePath, '--allow-contract-smoke', '--reproduce']);
  check(highVolumePositive.status === 0, 'HIGH_VOLUME_POSITIVE_REJECTED', (highVolumePositive.stderr ?? '').slice(0, 1000));

  const highVolumeCases = [
    {
      id: 'candidate-digest-tamper',
      mutations: [{ op: 'set', path: '/hashes/candidateSha256', value: '0'.repeat(64) }],
      expectedCodes: ['HV_CANDIDATE_DIGEST'],
    },
    {
      id: 'sample-count-mismatch',
      mutations: [{ op: 'set', path: '/deterministicPayload/expectedSamples', value: '999' }],
      expectedCodes: ['HV_SAMPLE_COUNT', 'HV_SMOKE_SIZE'],
    },
    {
      id: 'smoke-claims-complete',
      mutations: [{ op: 'set', path: '/deterministicPayload/complete', value: true }],
      expectedCodes: ['HV_SMOKE_COMPLETE'],
    },
    {
      id: 'suite-digest-tamper',
      mutations: [{ op: 'set', path: '/deterministicPayload/metrics/suiteDigest', value: '0'.repeat(64) }],
      expectedCodes: ['HV_SUITE_DIGEST'],
    },
    {
      id: 'percentile-order-invalid',
      mutations: [{ op: 'set', path: '/deterministicPayload/metrics/primary/p50', value: '9999' }],
      expectedCodes: ['HV_SUMMARY_ORDER'],
    },
    {
      id: 'suite-authorizes-promotion',
      mutations: [{ op: 'set', path: '/verdict/step3PromotionAllowed', value: true }],
      expectedCodes: ['SCHEMA', 'HV_PROMOTION'],
    },
    {
      id: 'contract-violation-hidden',
      mutations: [{ op: 'set', path: '/deterministicPayload/violations/0', value: { code: 'HIDDEN' } }],
      expectedCodes: ['HV_VIOLATIONS'],
    },
    {
      id: 'gacha-boundary-counter-tamper',
      mutations: [{ op: 'set', path: '/deterministicPayload/metrics/counters/maximumDrawsToFeatured', value: '201' }],
      expectedCodes: ['HV_GACHA_BOUNDARY'],
    },
    {
      id: 'gacha-summary-crosses-guarantee',
      mutations: [{ op: 'set', path: '/deterministicPayload/metrics/secondary/maximum', value: '201' }],
      expectedCodes: ['HV_GACHA_MAXIMUM'],
    },
    {
      id: 'weapon-gacha-boundary-counter-tamper',
      mutations: [{ op: 'set', path: '/deterministicPayload/metrics/counters/weaponMaximumDrawsToFeatured', value: '201' }],
      expectedCodes: ['HV_GACHA_BOUNDARY'],
    },
    {
      id: 'weapon-gacha-summary-crosses-guarantee',
      mutations: [{ op: 'set', path: '/deterministicPayload/metrics/quaternary/maximum', value: '201' }],
      expectedCodes: ['HV_GACHA_MAXIMUM'],
    },
    {
      id: 'character-featured-item-mapping-tamper',
      mutations: [{ op: 'set', path: '/deterministicPayload/metrics/counters/characterFeaturedItemMismatches', value: '1' }],
      expectedCodes: ['HV_GACHA_ITEM_MAPPING'],
    },
    {
      id: 'wrong-result-id',
      mutations: [{ op: 'set', path: '/resultId', value: 'cats-tower-step3-high-volume-gacha-tails-001' }],
      expectedCodes: ['HV_SMOKE_ID'],
    },
  ];
  for (const test of highVolumeCases) {
  await expectRejected(temp, 'high-volume', test.id, mutateMany(highVolumeBase, test.mutations), ['simulation/validate-high-volume-result-v2.mjs', '--allow-contract-smoke'], test.expectedCodes);
}

const duplicateBase = await runHighVolumeSuite({ suiteId: 'duplicate-skew-overflow', contractSmoke: true, owner: 'STEP2' });
const duplicatePositivePath = join(temp, 'duplicate-positive.json');
await writeFile(duplicatePositivePath, `${JSON.stringify(duplicateBase, null, 2)}
`, 'utf8');
const duplicatePositive = runNode(['simulation/validate-high-volume-result-v2.mjs', duplicatePositivePath, '--allow-contract-smoke', '--reproduce']);
check(duplicatePositive.status === 0, 'DUPLICATE_POSITIVE_REJECTED', (duplicatePositive.stderr ?? '').slice(0, 1000));
const duplicateCases = [
  {
    id: 'character-rarity-count-sum-mismatch',
    mutations: [{ op: 'set', path: '/deterministicPayload/metrics/counters/characterRarityNDraws', value: (BigInt(duplicateBase.deterministicPayload.metrics.counters.characterRarityNDraws) + 1n).toString() }],
    expectedCodes: ['HV_DUPLICATE_RARITY_COVERAGE'],
  },
  {
    id: 'weapon-featured-item-mapping-tamper',
    mutations: [{ op: 'set', path: '/deterministicPayload/metrics/counters/weaponFeaturedItemMismatches', value: '1' }],
    expectedCodes: ['HV_DUPLICATE_ITEM_MAPPING'],
  },
];
for (const test of duplicateCases) {
  await expectRejected(temp, 'duplicate', test.id, mutateMany(duplicateBase, test.mutations), ['simulation/validate-high-volume-result-v2.mjs', '--allow-contract-smoke'], test.expectedCodes);
}
} finally {
  await rm(temp, { recursive: true, force: true });
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errorCount: errors.length, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  executionContractNegativeCases: executionNegative.cases.length,
  gameplayResultNegativeCases: 10,
  highVolumeResultNegativeCases: 15,
  modelBindingCases: 7,
  totalNewNegativeCases: executionNegative.cases.length + 25,
}));
