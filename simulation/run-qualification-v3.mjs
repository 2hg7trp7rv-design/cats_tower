#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runQualification } from './engine-v2/run-plan.mjs';

const canonicalOutput = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json';
const outputIndex = process.argv.indexOf('--output');
if (process.argv.length !== (outputIndex >= 0 ? 4 : 2) || (outputIndex >= 0 && outputIndex !== 2)) throw new Error('USAGE: node simulation/run-qualification-v3.mjs [--output <path>]');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : canonicalOutput;
if (!output) throw new Error('V3_QUALIFICATION_OUTPUT_REQUIRED');
const result = await runQualification({
  candidatePath: 'simulation/candidate-v3.json',
  planPath: 'simulation/run-plan-v3.json',
  executionPath: 'simulation/execution-contract-v3.json'
});
result.evidence.reproductionCommand = 'node simulation/run-qualification-v3.mjs';
await writeFile(resolve(output), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, mode: 'qualification-v3', output, digest: result.hashes.deterministicPayloadSha256, scenarioCount: result.deterministicPayload.scenarioCount }));
