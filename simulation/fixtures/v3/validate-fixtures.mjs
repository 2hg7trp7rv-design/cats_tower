#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { assertSchema } from '../../lib-v2/schema-validator.mjs';

const load = path => readFile(path, 'utf8').then(JSON.parse);
const [catalog, candidate, candidateSchema, execution, executionSchema, plan, planSchema, result, resultSchema] = await Promise.all([
  load('simulation/fixtures/v3/negative.json'),
  load('simulation/candidate-v3.json'), load('simulation/candidate-v3.schema.json'),
  load('simulation/execution-contract-v3.json'), load('simulation/execution-contract-v3.schema.json'),
  load('simulation/run-plan-v3.json'), load('simulation/run-plan-v3.schema.json'),
  load('quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json'), load('simulation/result-v3.schema.json')
]);
const inputs = {
  'candidate-v3': [candidate, candidateSchema],
  'execution-contract-v3': [execution, executionSchema],
  'run-plan-v3': [plan, planSchema],
  'result-v3': [result, resultSchema]
};
for (const [value, schema] of Object.values(inputs)) assertSchema(value, schema);
const mutate = {
  'screen-count-drift': value => { value.screens.count = '11'; },
  'screen-id-drift': value => { value.screens.registry[0].id = 'S99'; },
  'screen-entry-drift': value => { value.screens.registry[1].name = 'invalid'; },
  'global-rules-drift': value => { value.screens.globalRules.combatRemainsPrimary = false; },
  'universal-recovery-drift': value => { value.screens.universalRecovery.pop(); },
  'global-invariants-drift': value => { value.screens.globalInvariants.pop(); },
  'candidate-extra-property': value => { value.__unexpected = true; },
  'execution-contract-id-drift': value => { value.contractId = 'invalid'; },
  'run-plan-id-drift': value => { value.planId = 'invalid'; },
  'result-candidate-digest-drift': value => { value.hashes.candidateSha256 = '0'.repeat(64); },
  'result-false-step3-authorization': value => { value.verdict.step3AuthorizedByThisResult = true; }
};
const results = [];
for (const fixture of catalog.cases) {
  const [base, schema] = inputs[fixture.target];
  const changed = structuredClone(base);
  mutate[fixture.id](changed);
  let rejected = false;
  try { assertSchema(changed, schema); } catch { rejected = true; }
  if (!rejected) throw new Error(`FIXTURE_ACCEPTED:${fixture.id}`);
  results.push({ id: fixture.id, expectedCode: fixture.expectedCode, status: 'PASS_REJECTED' });
}
console.log(JSON.stringify({ ok: true, artifactId: catalog.artifactId, positiveCopies: Object.keys(inputs).length, caseCount: String(results.length), results }));
