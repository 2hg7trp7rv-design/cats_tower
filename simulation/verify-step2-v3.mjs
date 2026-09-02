#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertSchema } from './lib-v2/schema-validator.mjs';
const loadText = path => readFile(path, 'utf8');
const load = async path => JSON.parse(await loadText(path));
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const normalize = value => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(normalize) : Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
const canonicalSha = value => sha(JSON.stringify(normalize(value)));

const pairs = [
  ['simulation/candidate-v3.json','simulation/candidate-v3.schema.json'],
  ['simulation/execution-contract-v3.json','simulation/execution-contract-v3.schema.json'],
  ['simulation/run-plan-v3.json','simulation/run-plan-v3.schema.json'],
  ['quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json','simulation/result-v3.schema.json']
];
for (const [dataPath, schemaPath] of pairs) assertSchema(await load(dataPath), await load(schemaPath));
const result = await load('quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json');
if (result.hashes.deterministicPayloadSha256 !== canonicalSha(result.deterministicPayload)) throw new Error('DETERMINISTIC_PAYLOAD_DIGEST_MISMATCH');
if (result.hashes.deterministicPayloadSha256 !== 'a24fa5a4a12cf132ac477c80e77431cd0b97ab070bbbef83c3881c160f42562c') throw new Error('FROZEN_PAYLOAD_CHANGED');
console.log(JSON.stringify({ ok: true, artifactId: 'cats-tower-step2-v3-complete-verifier', verdict: 'PASS_STEP2_V3_CONTRACT', scenarioCount: result.deterministicPayload.scenarioCount }));
