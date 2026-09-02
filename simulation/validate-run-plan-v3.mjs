#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';

const dataPath = resolve(process.argv[2] ?? 'simulation/run-plan-v3.json');
const schemaPath = resolve('simulation/run-plan-v3.schema.json');
try {
  const [data, schema] = await Promise.all([
    readFile(dataPath, 'utf8').then(JSON.parse),
    readFile(schemaPath, 'utf8').then(JSON.parse)
  ]);
  assertSchema(data, schema);
  console.log(JSON.stringify({ ok: true, artifactId: 'cats-tower-run-plan-v3-validator' }));
} catch (error) {
  const details = error.errors ?? [{ path: '#', keyword: 'runtime', message: error.message }];
  console.error(JSON.stringify({
    ok: false,
    artifactId: 'cats-tower-run-plan-v3-validator',
    errors: [{ code: 'SCHEMA', message: JSON.stringify(details) }]
  }));
  process.exitCode = 1;
}
