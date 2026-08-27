#!/usr/bin/env node
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { gitBlobSha, sha256Text } from './engine-v2/hash.mjs';

const root = resolve('.');
const report = {
  schemaVersion: '2.1.0',
  verificationId: 'cats-tower-step2-v2-verification',
  runtimeVersion: process.version,
  sourceReadbackMode: process.env.CT_DEV_SOURCE_MANIFEST_ONLY === '1' ? 'DEVELOPMENT_MANIFEST_ONLY' : 'FULL_GIT_BLOB_READBACK',
  checks: [],
  verdict: 'PENDING',
};
const fail = (name, detail) => { report.checks.push({ name, status: 'FAIL', detail }); };
const pass = (name, detail) => { report.checks.push({ name, status: 'PASS', detail }); };
const note = (name, status, detail) => { report.checks.push({ name, status, detail }); };
const exists = async (path) => { try { await access(resolve(path)); return true; } catch { return false; } };
const loadJson = async (path) => JSON.parse(await readFile(resolve(path), 'utf8'));

async function collectMjs(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectMjs(path));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(path);
  }
  return files.sort();
}

async function verifySyntax() {
  const files = await collectMjs(resolve('simulation'));
  const failures = [];
  for (const path of files) {
    const child = spawnSync(process.execPath, ['--check', path], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    if (child.status !== 0) failures.push({ path: relative(root, path), exitCode: child.status, stderr: (child.stderr ?? '').trim().slice(-1000) });
  }
  if (failures.length) fail('all-simulation-mjs-syntax', { fileCount: String(files.length), failures });
  else pass('all-simulation-mjs-syntax', { fileCount: String(files.length) });
}

async function verifyLegacyLock() {
  const lock = await loadJson('simulation/legacy-v1-lock.json');
  const mismatches = [];
  const development = process.env.CT_DEV_SOURCE_MANIFEST_ONLY === '1';
  let developmentSkipped = 0;
  for (const entry of lock.files) {
    try {
      const actual = gitBlobSha(await readFile(resolve(entry.path)));
      if (actual !== entry.gitBlob) mismatches.push({ path: entry.path, expected: entry.gitBlob, actual });
    } catch (error) {
      if (development) developmentSkipped += 1;
      else mismatches.push({ path: entry.path, error: error.message });
    }
  }
  if (lock.mayExecuteForV2Promotion || lock.mayExtendInPlace || lock.mayReuseObservedHoldout) mismatches.push({ path: 'lock', error: 'legacy disposition permits forbidden reuse' });
  if (mismatches.length) fail('legacy-v1-byte-lock', mismatches);
  else pass('legacy-v1-byte-lock', { files: String(lock.files.length), disposition: lock.disposition, developmentSkipped: String(developmentSkipped) });
}

function runNode(name, args, env = {}, timeout = 180000) {
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout,
    maxBuffer: 30 * 1024 * 1024,
  });
  const detail = {
    command: `node ${args.join(' ')}`,
    exitCode: child.status,
    signal: child.signal,
    stdoutSha256: sha256Text(child.stdout ?? ''),
    stderrSha256: sha256Text(child.stderr ?? ''),
    stdout: (child.stdout ?? '').trim().slice(-1500),
    stderr: (child.stderr ?? '').trim().slice(-2500),
  };
  if (child.status === 0) pass(name, detail);
  else fail(name, detail);
  return child;
}

function expectNodeFailure(name, args, expectedError, env = {}) {
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const stderr = child.stderr ?? '';
  const detail = {
    command: `node ${args.join(' ')}`,
    exitCode: child.status,
    expectedError,
    observed: stderr.trim().slice(-1500),
  };
  if (child.status !== 0 && stderr.includes(expectedError)) pass(name, detail);
  else fail(name, detail);
  return child;
}

const required = [
  'simulation/candidate-v2.json',
  'simulation/candidate-v2.schema.json',
  'simulation/validate-candidate-v2.mjs',
  'simulation/execution-contract-v2.json',
  'simulation/execution-contract-v2.schema.json',
  'simulation/validate-execution-contract-v2.mjs',
  'simulation/run-plan-v2.json',
  'simulation/validate-run-plan-v2.mjs',
  'simulation/result-v2.schema.json',
  'simulation/validate-result-v2.mjs',
  'simulation/gameplay-result-v2.schema.json',
  'simulation/validate-gameplay-result-v2.mjs',
  'simulation/high-volume-result-v2.schema.json',
  'simulation/validate-high-volume-result-v2.mjs',
  'simulation/engine-v2/index.mjs',
  'simulation/engine-v2/numeric.mjs',
  'simulation/engine-v2/rng.mjs',
  'simulation/engine-v2/tower.mjs',
  'simulation/engine-v2/economy.mjs',
  'simulation/engine-v2/state-machines.mjs',
  'simulation/engine-v2/hash.mjs',
  'simulation/engine-v2/statistics.mjs',
  'simulation/engine-v2/run-scenario.mjs',
  'simulation/engine-v2/run-plan.mjs',
  'simulation/engine-v2/high-volume.mjs',
  'simulation/fixtures/v2/manifest.json',
  'simulation/fixtures/v2/positive.json',
  'simulation/fixtures/v2/boundary.json',
  'simulation/fixtures/v2/negative.json',
  'simulation/fixtures/v2/run-plan-negative.json',
  'simulation/fixtures/v2/execution-contract-negative.json',
  'simulation/fixtures/v2/state-transitions.json',
  'simulation/fixtures/v2/cross-runtime-golden.json',
  'simulation/fixtures/v2/validate-fixtures.mjs',
  'simulation/fixtures/v2/validate-execution-fixtures.mjs',
  'simulation/migrations/v1-to-v2/migration-map.json',
  'simulation/migrations/v1-to-v2/migrate.mjs',
  'simulation/migrations/v1-to-v2/fixtures.json',
  'simulation/migrations/v1-to-v2/validate-migration.mjs',
  'simulation/CURRENT_STATUS.json',
  'PROJECT_STATUS.json',
  'quality-reviews/step-2-executable-contract-v2/acceptance-matrix.json',
  'quality-reviews/step-2-executable-contract-v2/qualification-result.json',
];
const missing = [];
for (const path of required) if (!(await exists(path))) missing.push(path);
if (missing.length) fail('required-content-paths', missing);
else pass('required-content-paths', { count: String(required.length) });

await verifySyntax();
await verifyLegacyLock();
const sourceEnv = process.env.CT_DEV_SOURCE_MANIFEST_ONLY === '1' ? { CT_DEV_SOURCE_MANIFEST_ONLY: '1' } : {};
runNode('candidate-schema-semantics-and-full-source-readback', ['simulation/validate-candidate-v2.mjs'], sourceEnv);
runNode('run-plan-semantics-and-partition-contract', ['simulation/validate-run-plan-v2.mjs']);
runNode('execution-contract-schema-semantics-and-result-bindings', ['simulation/validate-execution-contract-v2.mjs']);
runNode('nearest-rank-and-high-volume-statistics', ['simulation/engine-v2/statistics.mjs']);
runNode('legacy-positive-boundary-negative-state-golden-fixtures', ['simulation/fixtures/v2/validate-fixtures.mjs'], sourceEnv);
runNode('execution-and-result-adversarial-fixtures', ['simulation/fixtures/v2/validate-execution-fixtures.mjs']);
runNode('v1-to-v2-migration-contract', ['simulation/migrations/v1-to-v2/validate-migration.mjs']);
runNode('committed-qualification-schema-and-reproduction', ['simulation/validate-result-v2.mjs', 'quality-reviews/step-2-executable-contract-v2/qualification-result.json', '--reproduce']);

const temp = await mkdtemp(join(tmpdir(), 'cats-tower-step2-v2-verification-'));
try {
  const qualificationOutput = join(temp, 'qualification.json');
  const qualification = runNode('engine-qualification-rerun', ['simulation/engine-v2/run-plan.mjs', '--mode', 'qualification', '--output', qualificationOutput]);
  if (qualification.status === 0) {
    runNode('generated-qualification-schema-and-reproduction', ['simulation/validate-result-v2.mjs', qualificationOutput, '--reproduce']);
    const committed = await loadJson('quality-reviews/step-2-executable-contract-v2/qualification-result.json');
    const rerun = JSON.parse(await readFile(qualificationOutput, 'utf8'));
    if (committed.hashes.deterministicPayloadSha256 === rerun.hashes.deterministicPayloadSha256 && JSON.stringify(committed.deterministicPayload) === JSON.stringify(rerun.deterministicPayload)) {
      pass('qualification-byte-determinism', { digest: rerun.hashes.deterministicPayloadSha256, scenarioCount: rerun.deterministicPayload.scenarioCount });
    } else {
      fail('qualification-byte-determinism', { committed: committed.hashes.deterministicPayloadSha256, rerun: rerun.hashes.deterministicPayloadSha256 });
    }
  }

  const gameplayResults = {};
  for (const partition of ['calibration', 'holdout']) {
    const output = join(temp, `gameplay-${partition}.json`);
    const generated = runNode(`gameplay-${partition}-contract-smoke`, ['simulation/engine-v2/run-plan.mjs', '--mode', 'contract-smoke', '--partition', partition, '--seeds-per-cell', '2', '--output', output]);
    if (generated.status === 0) {
      const validated = runNode(`gameplay-${partition}-smoke-schema-and-reproduction`, ['simulation/validate-gameplay-result-v2.mjs', output, '--allow-contract-smoke', '--reproduce']);
      if (validated.status === 0) gameplayResults[partition] = JSON.parse(await readFile(output, 'utf8'));
    }
  }
  if (gameplayResults.calibration && gameplayResults.holdout) {
    const flatten = (result) => result.deterministicPayload.cells.flatMap((cell) => cell.scenarioDigests);
    const calibrationDigests = new Set(flatten(gameplayResults.calibration));
    const holdoutDigests = flatten(gameplayResults.holdout);
    const overlap = holdoutDigests.filter((digest) => calibrationDigests.has(digest));
    if (overlap.length === 0 && gameplayResults.calibration.deterministicPayload.seedNamespace !== gameplayResults.holdout.deterministicPayload.seedNamespace) {
      pass('calibration-holdout-smoke-disjointness', { calibrationScenarios: gameplayResults.calibration.deterministicPayload.scenarioCount, holdoutScenarios: gameplayResults.holdout.deterministicPayload.scenarioCount, overlap: '0' });
    } else {
      fail('calibration-holdout-smoke-disjointness', { namespaceOverlap: gameplayResults.calibration.deterministicPayload.seedNamespace === gameplayResults.holdout.deterministicPayload.seedNamespace, digestOverlap: overlap.slice(0, 20) });
    }
  }

  const suites = ['gacha-tails', 'pity-conformance', 'duplicate-skew-overflow', 'refund-replay-race', 'state-machine-model', 'large-number-properties'];
  for (const suite of suites) {
    const output = join(temp, `high-volume-${suite}.json`);
    const generated = runNode(`high-volume-${suite}-contract-smoke`, ['simulation/engine-v2/high-volume.mjs', '--mode', 'contract-smoke', '--suite', suite, '--output', output]);
    if (generated.status === 0) runNode(`high-volume-${suite}-smoke-schema-and-reproduction`, ['simulation/validate-high-volume-result-v2.mjs', output, '--allow-contract-smoke', '--reproduce']);
  }

  expectNodeFailure('gameplay-full-execution-requires-step3-environment', ['simulation/engine-v2/run-plan.mjs', '--mode', 'gameplay', '--owner', 'STEP3', '--partition', 'calibration', '--output', join(temp, 'forbidden-gameplay-no-env.json')], 'STEP3_GAMEPLAY_EXECUTION_NOT_AUTHORIZED');
  expectNodeFailure('gameplay-full-execution-requires-step3-owner', ['simulation/engine-v2/run-plan.mjs', '--mode', 'gameplay', '--owner', 'STEP2', '--partition', 'calibration', '--output', join(temp, 'forbidden-gameplay-wrong-owner.json')], 'STEP3_GAMEPLAY_EXECUTION_NOT_AUTHORIZED', { CT_STEP3_AUTHORIZED: '1' });
  expectNodeFailure('high-volume-full-execution-requires-step3-environment', ['simulation/engine-v2/high-volume.mjs', '--mode', 'full', '--owner', 'STEP3', '--suite', 'gacha-tails', '--output', join(temp, 'forbidden-high-volume-no-env.json')], 'STEP3_HIGH_VOLUME_EXECUTION_NOT_AUTHORIZED');
  expectNodeFailure('high-volume-full-execution-requires-step3-owner', ['simulation/engine-v2/high-volume.mjs', '--mode', 'full', '--owner', 'STEP2', '--suite', 'gacha-tails', '--output', join(temp, 'forbidden-high-volume-wrong-owner.json')], 'STEP3_HIGH_VOLUME_EXECUTION_NOT_AUTHORIZED', { CT_STEP3_AUTHORIZED: '1' });
  expectNodeFailure('contract-smoke-cannot-equal-full-partition', ['simulation/engine-v2/run-plan.mjs', '--mode', 'contract-smoke', '--partition', 'calibration', '--seeds-per-cell', '800', '--output', join(temp, 'forbidden-full-sized-smoke.json')], 'CONTRACT_SMOKE_MUST_BE_SMALLER_THAN_PARTITION');
} finally {
  await rm(temp, { recursive: true, force: true });
}

const sealPath = 'simulation/executable-seal-v2.json';
const sealSchemaPath = 'simulation/executable-seal-v2.schema.json';
const sealValidatorPath = 'simulation/validate-executable-seal-v2.mjs';
const finalJudgePath = 'quality-reviews/step-2-executable-contract-v2/final-judge.json';
const completionEvidencePath = 'quality-reviews/step-2-executable-contract-v2/completion-evidence.json';
const liveReadbackPath = 'quality-reviews/step-2-executable-contract-v2/live-readback.json';
const sealPresent = await exists(sealPath);
const sealSchemaPresent = await exists(sealSchemaPath);
const sealValidatorPresent = await exists(sealValidatorPath);
const finalJudgePresent = await exists(finalJudgePath);
const completionEvidencePresent = await exists(completionEvidencePath);
const liveReadbackPresent = await exists(liveReadbackPath);
if (sealPresent) {
  if (!sealSchemaPresent || !sealValidatorPresent) fail('executable-seal-v2-dependencies', { sealSchemaPresent, sealValidatorPresent });
  else runNode('executable-seal-v2', [sealValidatorPath, sealPath]);
} else {
  note('executable-seal-v2', 'NOT_PRESENT_CONTENT_PHASE', 'Step 2 remains IN_PROGRESS; content verification cannot authorize Step 3.');
}

const simulationStatus = await loadJson('simulation/CURRENT_STATUS.json');
const projectStatus = await loadJson('PROJECT_STATUS.json');
const completionChainComplete = sealPresent && finalJudgePresent && completionEvidencePresent && liveReadbackPresent;
const premature = [];
if (!completionChainComplete) {
  if (simulationStatus.status === 'PASS') premature.push('simulation/CURRENT_STATUS.json status=PASS before completion chain');
  if (simulationStatus.step3Allowed === true) premature.push('simulation/CURRENT_STATUS.json step3Allowed=true before completion chain');
  if (simulationStatus.qualificationScope?.step3Authorized === true) premature.push('qualificationScope.step3Authorized=true');
  if (projectStatus.step3Allowed === true) premature.push('PROJECT_STATUS.json step3Allowed=true before completion chain');
  const step3Sequence = projectStatus.authorizedExecutionSequence?.find((entry) => entry.order === 3);
  if (step3Sequence && !String(step3Sequence.status).includes('BLOCKED')) premature.push(`PROJECT_STATUS.json Step3 sequence=${step3Sequence.status}`);
}
if (premature.length) fail('status-mirrors-block-premature-step3', premature);
else pass('status-mirrors-block-premature-step3', { simulationStatus: simulationStatus.status, simulationStep3Allowed: simulationStatus.step3Allowed, projectStep3Allowed: projectStatus.step3Allowed, completionChainComplete });

const failed = report.checks.filter((entry) => entry.status === 'FAIL');
if (failed.length) report.verdict = 'FAIL';
else if (completionChainComplete && simulationStatus.status === 'PASS' && simulationStatus.step3Allowed === true && projectStatus.step3Allowed === true) report.verdict = 'PASS';
else if (sealPresent) report.verdict = 'QUALITY_PHASE_PASS_STEP2_IN_PROGRESS';
else report.verdict = 'CONTENT_PHASE_PASS_STEP2_IN_PROGRESS';
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
