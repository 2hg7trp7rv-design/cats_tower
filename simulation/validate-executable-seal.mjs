import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, 'executable-seal.schema.json')));

export const executableSealFieldOrder = [
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

const digestPattern = /^[0-9a-f]{64}$/;
const nodeVersionPattern = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const sameArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function validateExecutableSeal(value, expected = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['seal must be one JSON object'];
  if (!sameArray(Object.keys(value), executableSealFieldOrder)) errors.push('seal fields or field order differ from the strict contract');
  if (value.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  for (const field of executableSealFieldOrder.filter((name) => name.endsWith('Sha256'))) {
    if (typeof value[field] !== 'string' || !digestPattern.test(value[field])) errors.push(`${field} must be lowercase SHA-256 hex`);
  }
  if (!Number.isSafeInteger(value.simulatorSourceFileCount) || value.simulatorSourceFileCount < 1) errors.push('simulatorSourceFileCount must be a positive safe integer');
  if (typeof value.nodeVersion !== 'string' || !nodeVersionPattern.test(value.nodeVersion)) errors.push('nodeVersion must be an exact vMAJOR.MINOR.PATCH string');
  if (value.step2Verdict !== 'PASS') errors.push('step2Verdict must equal PASS');
  for (const key of Object.keys(expected)) {
    if (!executableSealFieldOrder.includes(key)) errors.push(`unknown expected binding ${key}`);
    else if (value[key] !== expected[key]) errors.push(`${key} differs from the expected binding`);
  }
  return errors;
}

export function validateExecutableSealBytes(rawBytes, expected = {}) {
  const errors = [];
  let value;
  try {
    value = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    return { value: null, errors: ['seal is not strict UTF-8 JSON'] };
  }
  errors.push(...validateExecutableSeal(value, expected));
  const canonicalBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (!Buffer.from(rawBytes).equals(canonicalBytes)) errors.push('seal bytes must be two-space JSON, LF-terminated, with the strict field order and no BOM');
  return { value, errors };
}

if (!sameArray(schema.required, executableSealFieldOrder)
  || schema.additionalProperties !== false
  || schema.properties?.schemaVersion?.const !== 1
  || schema.properties?.step2Verdict?.const !== 'PASS') {
  throw new Error('executable-seal.schema.json differs from validator constants');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const d = '0'.repeat(64);
  const valid = {
    schemaVersion: 1,
    candidateRawSha256: d,
    candidateNormalizedExecutableSha256: d,
    simulatorSourceTreeSha256: d,
    simulatorSourceFileCount: 4,
    runPlanRawSha256: d,
    resultSchemaRawSha256: d,
    resultValidatorRawSha256: d,
    nodeVersion: 'v22.0.0',
    step2RawDatasetSha256: d,
    step2SummarySha256: d,
    step2AcceptanceSha256: d,
    step2Verdict: 'PASS'
  };
  const validBytes = Buffer.from(`${JSON.stringify(valid, null, 2)}\n`);
  const checks = [
    validateExecutableSealBytes(validBytes).errors.length === 0,
    validateExecutableSeal({...valid, extra: true}).length > 0,
    validateExecutableSeal({...valid, candidateRawSha256: d.toUpperCase().replaceAll('0', 'A')}).length > 0,
    validateExecutableSeal(valid, {nodeVersion: 'v99.0.0'}).length > 0,
    validateExecutableSealBytes(Buffer.from(`{\n  \"candidateRawSha256\": \"${d}\",\n  \"schemaVersion\": 1\n}\n`)).errors.length > 0,
    validateExecutableSealBytes(Buffer.from(`{\"schemaVersion\":1,\"schemaVersion\":1}\n`)).errors.length > 0
  ];
  if (checks.some((passed) => !passed)) {
    console.error('FAIL: executable seal validator fixture failed');
    process.exit(1);
  }
  console.log('PASS: executable seal schema and validator fixtures');
}
