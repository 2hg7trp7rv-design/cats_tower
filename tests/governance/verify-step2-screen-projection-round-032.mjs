#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const load = path => readFile(path, 'utf8').then(JSON.parse);
const normalize = value => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(normalize) : Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
const digest = value => createHash('sha256').update(JSON.stringify(normalize(value)), 'utf8').digest('hex');
const [canonical, v2, v3, coverage, impact] = await Promise.all([
  load('canonical/SCREEN_STATE_REGISTRY.json'), load('simulation/candidate-v2.json'), load('simulation/candidate-v3.json'),
  load('quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/screen-projection-coverage-ledger.json'), load('quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/numeric-non-impact.json')
]);
const expected = { count: String(canonical.screenCount), registry: canonical.screens, globalRules: canonical.globalRules, universalRecovery: canonical.universalRecovery, globalInvariants: canonical.globalInvariants };
if (JSON.stringify(v3) !== JSON.stringify({ ...v2, screens: expected })) throw new Error('LOSSLESS_PROJECTION_FAILED');
if (digest(expected) !== coverage.projectionSha256 || coverage.screenCoverage.length !== 12) throw new Error('COVERAGE_BINDING_FAILED');
if (impact.engineConsumerCount !== 0 || impact.runtimeOrS02Changed !== false) throw new Error('NON_IMPACT_FAILED');
console.log(JSON.stringify({ ok: true, artifactId: 'cats-tower-step2-screen-projection-round-032-verifier', verdict: 'PASS_LOSSLESS_CANONICAL_SCREEN_PROJECTION', screenCount: String(canonical.screenCount) }));
