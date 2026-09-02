#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const continuity = JSON.parse(await readFile('quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/step3-continuity-bridge.json', 'utf8'));
const seal = JSON.parse(await readFile('simulation/executable-seal-v3.json', 'utf8'));
if (continuity.verdict !== 'PASS_STEP3_NUMERIC_MODEL_CONTINUITY_NO_EXECUTION_RERUN_REQUIRED') throw new Error('CONTINUITY_VERDICT_INVALID');
if (continuity.qualification.deepEqual !== true || continuity.qualification.beforeDeterministicPayloadSha256 !== continuity.qualification.afterDeterministicPayloadSha256) throw new Error('NUMERIC_CONTINUITY_FAILED');
if (continuity.runtimeOrS02Changed !== false || continuity.step3Status !== 'PASS_MODEL') throw new Error('BOUNDARY_OVERCLAIM');
if (continuity.v3Seal.blob !== execFileSync('git', ['rev-parse', 'HEAD:simulation/executable-seal-v3.json'], { encoding: 'utf8' }).trim()) throw new Error('SEAL_BINDING_DRIFT');
if (seal.semanticCommit.length !== 40) throw new Error('SEMANTIC_COMMIT_INVALID');
console.log(JSON.stringify({ ok: true, artifactId: continuity.artifactId, verdict: continuity.verdict }));
