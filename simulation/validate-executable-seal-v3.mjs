#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertSchema } from './lib-v2/schema-validator.mjs';
const file = process.argv[2] ?? 'simulation/executable-seal-v3.json';
try {
  const [seal, schema] = await Promise.all([readFile(file, 'utf8').then(JSON.parse), readFile('simulation/executable-seal-v3.schema.json', 'utf8').then(JSON.parse)]);
  assertSchema(seal, schema);
  for (const binding of seal.bindings) if (execFileSync('git', ['rev-parse', `HEAD:${binding.path}`], { encoding: 'utf8' }).trim() !== binding.blob) throw new Error(`BINDING_DRIFT:${binding.path}`);
  console.log(JSON.stringify({ ok: true, artifactId: seal.artifactId, bindingCount: String(seal.bindings.length) }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, artifactId: 'cats-tower-step2-executable-seal-v3-validator', errors: [{ code: 'SEAL', message: error.message }] }));
  process.exit(1);
}
