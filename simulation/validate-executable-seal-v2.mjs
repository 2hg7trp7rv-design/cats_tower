import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sealPath = 'simulation/executable-seal-v2.json';
const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));

function fail(message) {
  throw new Error(`STEP2_SEAL_INVALID:${message}`);
}
function blobAt(path) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path}`], { encoding: 'utf8' }).trim();
  } catch {
    fail(`MISSING_BOUND_PATH:${path}`);
  }
}
function requireBinding(binding, label) {
  if (!binding || typeof binding.path !== 'string' || !/^[a-f0-9]{40}$/.test(binding.blob || '')) fail(`BAD_BINDING:${label}`);
  const actual = blobAt(binding.path);
  if (actual !== binding.blob) fail(`BLOB_MISMATCH:${binding.path}:${binding.blob}:${actual}`);
}
if (seal.schemaVersion !== 1) fail('SCHEMA_VERSION');
if (seal.repository !== '2hg7trp7rv-design/cats_tower') fail('REPOSITORY');
if (seal.branch !== 'kimi') fail('BRANCH');
if (!/^[a-f0-9]{40}$/.test(seal.semanticCommit || '')) fail('SEMANTIC_COMMIT');
if (!/^[a-f0-9]{40}$/.test(seal.semanticTree || '')) fail('SEMANTIC_TREE');
const semanticTree = execFileSync('git', ['rev-parse', `${seal.semanticCommit}^{tree}`], { encoding: 'utf8' }).trim();
if (semanticTree !== seal.semanticTree) fail('SEMANTIC_TREE_MISMATCH');
execFileSync('git', ['merge-base', '--is-ancestor', seal.semanticCommit, 'HEAD']);
requireBinding(seal.acceptance, 'acceptance');
requireBinding(seal.qualification, 'qualification');
requireBinding(seal.critics?.summary, 'critic-summary');
requireBinding(seal.finalJudge, 'final-judge');
if (!Number.isInteger(seal.critics?.count) || seal.critics.count < 5) fail('CRITIC_COUNT');
if (seal.critics.unresolvedP0 !== 0 || seal.critics.unresolvedP1 !== 0) fail('BLOCKING_CRITIC_FINDINGS');
if (seal.qualification.scenarioCount !== '30') fail('QUALIFICATION_SCOPE');
if (seal.qualification.balanceVerdict !== 'NOT_EVALUATED_STEP2') fail('BALANCE_SCOPE');
if (!/^[a-f0-9]{64}$/.test(seal.qualification.digest || '')) fail('QUALIFICATION_DIGEST');
if (!Array.isArray(seal.bindings) || seal.bindings.length < 12) fail('BINDING_COUNT');
const seen = new Set();
for (const binding of seal.bindings) {
  requireBinding(binding, 'bindings');
  if (seen.has(binding.path)) fail(`DUPLICATE_BINDING:${binding.path}`);
  seen.add(binding.path);
}
const required = [
  'canonical/STEP2_DEPENDENCY_CLOSURE.json',
  'simulation/candidate-v2.json',
  'simulation/candidate-v2.schema.json',
  'simulation/validate-candidate-v2.mjs',
  'simulation/run-plan-v2.json',
  'simulation/execution-contract-v2.json',
  'simulation/result-v2.schema.json',
  'simulation/validate-result-v2.mjs',
  'simulation/engine-v2/run-scenario.mjs',
  'simulation/engine-v2/high-volume.mjs',
  'simulation/fixtures/v2/manifest.json',
  'simulation/migrations/v1-to-v2/migration-map.json',
  'quality-reviews/step-2-executable-contract-v2/critic-summary.json',
  'quality-reviews/step-2-executable-contract-v2/final-judge.json'
];
for (const path of required) if (!seen.has(path)) fail(`REQUIRED_BINDING_MISSING:${path}`);
const summary = JSON.parse(fs.readFileSync(seal.critics.summary.path, 'utf8'));
if (summary.criticCount < 5 || summary.unresolved?.P0 !== 0 || summary.unresolved?.P1 !== 0 || summary.verdict !== 'PASS_CRITIC_GATE_P0_P1_ZERO') fail('CRITIC_SUMMARY_CONTENT');
const judge = JSON.parse(fs.readFileSync(seal.finalJudge.path, 'utf8'));
if (judge.unresolved?.P0 !== 0 || judge.unresolved?.P1 !== 0 || judge.verdict !== 'PASS_STEP2_QUALITY_REVIEW_PENDING_SEAL_ACTIVATION') fail('FINAL_JUDGE_CONTENT');
if (seal.verdict !== 'SEALED_STEP2_EXECUTABLE_CONTRACT') fail('VERDICT');
console.log(JSON.stringify({ verdict: 'PASS_EXECUTABLE_SEAL_V2', semanticCommit: seal.semanticCommit, semanticTree: seal.semanticTree, bindingCount: seal.bindings.length, unresolvedP0: 0, unresolvedP1: 0 }, null, 2));
