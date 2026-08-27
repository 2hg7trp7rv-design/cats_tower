#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { deterministicSeed } from './rng.mjs';
import { runScenario } from './run-scenario.mjs';
import { summarizeUnsigned } from './statistics.mjs';
import { sha256Canonical, sha256Text, canonicalJson } from './hash.mjs';

async function loadText(path) { return readFile(resolve(path), 'utf8'); }
async function loadInputs({ candidatePath = 'simulation/candidate-v2.json', planPath = 'simulation/run-plan-v2.json', executionPath = 'simulation/execution-contract-v2.json' } = {}) {
  const [candidateText, planText, executionText] = await Promise.all([loadText(candidatePath), loadText(planPath), loadText(executionPath)]);
  return { candidatePath, planPath, executionPath, candidateText, planText, executionText, candidate: JSON.parse(candidateText), plan: JSON.parse(planText), execution: JSON.parse(executionText) };
}

function resultHashes(inputs, deterministicPayload) {
  return {
    candidateSha256: sha256Text(inputs.candidateText),
    runPlanSha256: sha256Text(inputs.planText),
    executionContractSha256: sha256Text(inputs.executionText),
    deterministicPayloadSha256: sha256Canonical(deterministicPayload),
  };
}

function evidence(deterministicPayload, reproductionCommand) {
  return {
    runtimeVersion: process.version,
    executedAt: new Date().toISOString(),
    reproductionCommand,
    canonicalJsonSha256: sha256Text(canonicalJson(deterministicPayload)),
  };
}

export async function runQualification(options = {}) {
  const inputs = await loadInputs(options);
  const { candidate, plan, execution } = inputs;
  const partition = execution.partitions.qualification;
  const scenarios = [];
  const count = Number(partition.seedsPerBuildPersona);
  for (const buildId of plan.builds) for (const personaId of plan.personas) for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const seed = deterministicSeed(partition.namespace, buildId, personaId, ordinal);
    scenarios.push(runScenario(candidate, plan, execution, { buildId, personaId, namespace: partition.namespace, partition: 'qualification', seed, ordinal }));
  }
  const firstReset = scenarios.map((entry) => entry.firstResetMinutes);
  const guaranteeDays = scenarios.map((entry) => entry.featuredGuaranteeDay);
  const deterministicPayload = {
    mode: 'STEP2_QUALIFICATION_ONLY',
    candidateId: candidate.meta.candidateId,
    scenarioAlgorithmVersion: execution.scenarioAlgorithmVersion,
    executionVersion: execution.executionVersion,
    roundingVersion: candidate.meta.roundingVersion,
    seedNamespace: partition.namespace,
    scenarioCount: String(scenarios.length),
    scenarios,
    summary: {
      buildCount: String(plan.builds.length),
      personaCount: String(plan.personas.length),
      seedsPerCell: partition.seedsPerBuildPersona,
      firstResetMinutesMinimum: summarizeUnsigned(firstReset).minimum,
      firstResetMinutesMaximum: summarizeUnsigned(firstReset).maximum,
      featuredGuaranteeDayMinimum: summarizeUnsigned(guaranteeDays).minimum,
      featuredGuaranteeDayMaximum: summarizeUnsigned(guaranteeDays).maximum,
      allFirstEvolutionsCovered: scenarios.every((entry) => entry.firstEvolutionCovered),
      balanceVerdict: 'NOT_EVALUATED_STEP2',
    },
    violations: [],
  };
  return {
    schemaVersion: '2.1.0',
    resultId: 'cats-tower-step2-v2-qualification-001',
    deterministicPayload,
    hashes: resultHashes(inputs, deterministicPayload),
    evidence: evidence(deterministicPayload, 'node simulation/engine-v2/run-plan.mjs --mode qualification --output quality-reviews/step-2-executable-contract-v2/qualification-result.json'),
    verdict: { contractQualification: 'PASS', balanceQualification: 'NOT_RUN_STEP3_REQUIRED', step3AuthorizedByThisResult: false },
  };
}

function summarizeCell(partitionName, buildId, personaId, scenarios, horizons) {
  return {
    cellId: `${partitionName}|${buildId}|${personaId}`,
    buildId,
    personaId,
    seedCount: String(scenarios.length),
    scenarioDigests: scenarios.map((entry) => entry.scenarioDigest),
    metrics: {
      firstResetMinutes: summarizeUnsigned(scenarios.map((entry) => entry.firstResetMinutes)),
      featuredGuaranteeDay: summarizeUnsigned(scenarios.map((entry) => entry.featuredGuaranteeDay)),
      horizons: horizons.map((horizon) => ({
        horizonId: horizon.id,
        estimatedReachMinutes: summarizeUnsigned(scenarios.map((entry) => entry.horizons.find((metric) => metric.horizonId === horizon.id).estimatedReachMinutes)),
      })),
    },
  };
}

export async function runGameplayPartition({ partition: partitionName, contractSmoke = false, smokeSeedsPerCell = '2', owner = 'STEP2', ...options } = {}) {
  const inputs = await loadInputs(options);
  const { candidate, plan, execution } = inputs;
  if (!['calibration','holdout'].includes(partitionName)) throw new Error(`UNKNOWN_GAMEPLAY_PARTITION:${partitionName}`);
  const partition = execution.partitions[partitionName];
  if (!contractSmoke && (owner !== execution.executionGuard.requiredOwnerArgument || process.env.CT_STEP3_AUTHORIZED !== '1')) throw new Error('STEP3_GAMEPLAY_EXECUTION_NOT_AUTHORIZED');
  const seedsPerCell = contractSmoke ? BigInt(smokeSeedsPerCell) : BigInt(partition.seedsPerBuildPersona);
  if (seedsPerCell <= 0n || seedsPerCell > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GAMEPLAY_SEED_COUNT_UNSAFE');
  if (contractSmoke && seedsPerCell >= BigInt(partition.seedsPerBuildPersona)) throw new Error('CONTRACT_SMOKE_MUST_BE_SMALLER_THAN_PARTITION');
  const cells = [];
  const allScenarios = [];
  for (const buildId of plan.builds) for (const personaId of plan.personas) {
    const scenarios = [];
    for (let ordinal = 0; ordinal < Number(seedsPerCell); ordinal += 1) {
      const seed = deterministicSeed(partition.namespace, buildId, personaId, ordinal);
      scenarios.push(runScenario(candidate, plan, execution, { buildId, personaId, namespace: partition.namespace, partition: partitionName, seed, ordinal }));
    }
    cells.push(summarizeCell(partitionName, buildId, personaId, scenarios, plan.horizons));
    allScenarios.push(...scenarios);
  }
  const expectedScenarioCount = (seedsPerCell * BigInt(plan.builds.length * plan.personas.length)).toString();
  const mode = contractSmoke ? 'STEP2_STEP3_CONTRACT_SMOKE' : 'STEP3_GAMEPLAY_PARTITION';
  const deterministicPayload = {
    mode,
    partition: partitionName,
    tuningVisible: partition.tuningVisible,
    candidateId: candidate.meta.candidateId,
    scenarioAlgorithmVersion: execution.scenarioAlgorithmVersion,
    executionVersion: execution.executionVersion,
    roundingVersion: execution.roundingVersion,
    seedNamespace: partition.namespace,
    seedsPerCell: seedsPerCell.toString(),
    expectedScenarioCount,
    scenarioCount: String(allScenarios.length),
    complete: !contractSmoke,
    cells,
    summary: {
      buildCount: String(plan.builds.length),
      personaCount: String(plan.personas.length),
      cellCount: String(cells.length),
      firstResetMinutes: summarizeUnsigned(allScenarios.map((entry) => entry.firstResetMinutes)),
      featuredGuaranteeDay: summarizeUnsigned(allScenarios.map((entry) => entry.featuredGuaranteeDay)),
    },
    violations: [],
  };
  const resultPrefix = contractSmoke ? 'cats-tower-step2-contract-smoke' : 'cats-tower-step3';
  const reproductionCommand = contractSmoke
    ? `node simulation/engine-v2/run-plan.mjs --mode contract-smoke --partition ${partitionName} --seeds-per-cell ${seedsPerCell} --output <path>`
    : `CT_STEP3_AUTHORIZED=1 node simulation/engine-v2/run-plan.mjs --mode gameplay --owner STEP3 --partition ${partitionName} --output <path>`;
  return {
    schemaVersion: '2.1.0',
    resultId: `${resultPrefix}-${partitionName}-001`,
    deterministicPayload,
    hashes: resultHashes(inputs, deterministicPayload),
    evidence: evidence(deterministicPayload, reproductionCommand),
    verdict: {
      contractValidation: 'PASS',
      balanceQualification: contractSmoke ? 'NOT_EVALUATED_CONTRACT_SMOKE' : 'PENDING_STEP3_FINAL_JUDGE',
      partitionComplete: !contractSmoke,
      step3PromotionAllowed: false,
      partialResultPromotion: false,
    },
  };
}

function arg(name, fallback) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = arg('--mode', 'qualification');
  const output = arg('--output', mode === 'qualification' ? 'quality-reviews/step-2-executable-contract-v2/qualification-result.json' : undefined);
  if (!output) throw new Error('--output is required for gameplay and contract-smoke modes');
  let result;
  if (mode === 'qualification') result = await runQualification({ candidatePath: arg('--candidate', 'simulation/candidate-v2.json'), planPath: arg('--plan', 'simulation/run-plan-v2.json'), executionPath: arg('--execution', 'simulation/execution-contract-v2.json') });
  else if (mode === 'contract-smoke') result = await runGameplayPartition({ partition: arg('--partition'), contractSmoke: true, smokeSeedsPerCell: arg('--seeds-per-cell', '2'), owner: 'STEP2' });
  else if (mode === 'gameplay') result = await runGameplayPartition({ partition: arg('--partition'), contractSmoke: false, owner: arg('--owner', 'STEP2') });
  else throw new Error(`UNKNOWN_RUN_MODE:${mode}`);
  await writeFile(resolve(output), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, mode, output, digest: result.hashes.deterministicPayloadSha256, scenarioCount: result.deterministicPayload.scenarioCount }));
}
