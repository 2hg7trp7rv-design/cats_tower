import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const inputDir = path.resolve(root, arg('--input-dir', 'quality-reviews/step-3-large-scale-validation'));
const outputPath = path.resolve(root, arg('--output', path.join(inputDir, 'analysis.json')));
const calibrationPath = path.join(inputDir, 'gameplay-calibration-result.json');
const holdoutPath = path.join(inputDir, 'gameplay-holdout-result.json');
const highDir = path.join(inputDir, 'high-volume');
const suiteCounts = new Map([
  ['gacha-tails', 200000n],
  ['pity-conformance', 1000000n],
  ['duplicate-skew-overflow', 200000n],
  ['refund-replay-race', 100000n],
  ['state-machine-model', 100000n],
  ['large-number-properties', 100000n],
]);
const builds = ['build.combat', 'build.reinforcement', 'build.commerce'];
const personas = ['no-ad-f2p', 'rewarded-ad-f2p', 'monthly-pass', 'controlled-payer', 'high-spend-stress'];
const horizons = ['1-10F', '100F', '1000F', '10000F-or-equivalent', 'repeated-resets', '30-45-day-economy'];

function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function sha256File(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function stableStringify(value) { return JSON.stringify(canonical(value)); }
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function pathTokens(p) { return p.map(norm).filter(Boolean); }
function flatten(value, p = [], out = []) {
  if (Array.isArray(value)) {
    out.push({ path: p, value, kind: 'array', length: value.length });
    for (let i = 0; i < value.length; i += 1) flatten(value[i], [...p, String(i)], out);
  } else if (value && typeof value === 'object') {
    out.push({ path: p, value, kind: 'object', keys: Object.keys(value).length });
    for (const [k, v] of Object.entries(value)) flatten(v, [...p, k], out);
  } else out.push({ path: p, value, kind: typeof value });
  return out;
}
function parseNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s); return Number.isFinite(n) ? n : null;
  }
  if (/^-?\d+\/-?\d+$/.test(s)) {
    const [a,b] = s.split('/').map(Number); return b && Number.isFinite(a/b) ? a/b : null;
  }
  return null;
}
function parseBig(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  return null;
}
function quantile(xs, q) {
  if (!xs.length) return null;
  const a = [...xs].sort((x,y) => x-y);
  return a[Math.max(0, Math.ceil(q*a.length)-1)];
}
function findLargestScenarioArray(result, expected) {
  const arrays = flatten(result).filter(x => x.kind === 'array' && x.length === expected && x.value.every(v => v && typeof v === 'object' && !Array.isArray(v)));
  arrays.sort((a,b) => b.path.length - a.path.length);
  return arrays[0]?.value ?? null;
}
function findValues(obj, tokenGroups, predicate = () => true) {
  return flatten(obj).filter(x => x.kind !== 'array' && x.kind !== 'object').filter(x => {
    const joined = pathTokens(x.path).join('');
    return tokenGroups.every(group => group.some(t => joined.includes(norm(t)))) && predicate(x.value, x.path);
  });
}
function uniqueStrings(obj, keyTokens) {
  const found = new Set();
  for (const x of flatten(obj)) {
    if (x.kind === 'array' || x.kind === 'object' || typeof x.value !== 'string') continue;
    const key = norm(x.path.at(-1) ?? '');
    if (keyTokens.some(t => key.includes(norm(t)))) found.add(x.value);
  }
  return found;
}
function extractDigestSet(scenarios, kind) {
  const result = new Set();
  const wanted = kind === 'input' ? ['inputdigest','scenarioinputdigest'] : ['scenariodigest','digest'];
  for (const s of scenarios) {
    const leaves = flatten(s);
    const exact = leaves.filter(x => typeof x.value === 'string' && /^[a-f0-9]{64}$/.test(x.value) && wanted.includes(norm(x.path.at(-1) ?? '')));
    const preferred = exact.find(x => kind === 'input' ? norm(x.path.at(-1)).includes('input') : !norm(x.path.at(-1)).includes('input')) ?? exact[0];
    if (preferred) result.add(preferred.value);
  }
  return result;
}
function addFinding(list, id, pass, severity, summary, evidence = {}) {
  list.push({ id, status: pass ? 'PASS' : 'FAIL', severity, summary, evidence });
}
function zeroLike(v) {
  if (v === false || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return v === 0;
  if (typeof v === 'string') return v === '' || /^0+(?:\.0+)?$/.test(v) || /^(PASS|SUCCESS|NONE|NO_VIOLATION)$/i.test(v);
  return false;
}
function scanExplicitFailures(obj, label) {
  const bad = [];
  const suspicious = /(violation|breach|mismatch|collision|doublegrant|duplicategrant|negativebalance|nonfinite|nan|infinity|unsafeinteger|replayaccepted|raceaccepted|idempotencyfailure|invalidtransition|pityfailure|carryoverfailure|overflowloss|ledgerdrift|refunddeficituntracked|errorcount|failurecount)/;
  for (const x of flatten(obj)) {
    if (x.kind === 'array' || x.kind === 'object') continue;
    const key = norm(x.path.at(-1) ?? '');
    if (!suspicious.test(key)) continue;
    if (/expected|allowed|fixture|negativecases|invalidcases|errormessage|failuremode/.test(key)) continue;
    if (!zeroLike(x.value)) bad.push({ label, path: x.path.join('.'), value: x.value });
  }
  for (const x of flatten(obj)) {
    if (x.kind === 'array' || x.kind === 'object') continue;
    const key = norm(x.path.at(-1) ?? '');
    if (['status','verdict','conclusion'].includes(key) && typeof x.value === 'string' && /FAIL|ERROR|INVALID|REJECT/i.test(x.value) && !/EXPECTED/.test(x.path.join('.').toUpperCase())) bad.push({ label, path: x.path.join('.'), value: x.value });
  }
  return bad;
}
function coverageEvidence(scenarios) {
  const observedBuilds = uniqueStrings(scenarios, ['build','buildid']);
  const observedPersonas = uniqueStrings(scenarios, ['persona','personaid']);
  const observedHorizons = uniqueStrings(scenarios, ['horizon','horizonid']);
  return {
    builds: [...observedBuilds].filter(x => builds.includes(x)).sort(),
    personas: [...observedPersonas].filter(x => personas.includes(x)).sort(),
    horizons: [...observedHorizons].filter(x => horizons.includes(x)).sort(),
  };
}
function metricInventory(obj) {
  const terms = /(reset|ruby|evolution|mastery|duplicate|featured|guarantee|pity|multiplier|rarity|utility|dominance|floor|day|minute|progress|coverage|afford)/;
  return flatten(obj).filter(x => x.kind !== 'array' && x.kind !== 'object' && terms.test(norm(x.path.join('.')))).slice(0, 5000).map(x => ({ path: x.path.join('.'), value: x.value }));
}

const calibration = readJson(calibrationPath);
const holdout = readJson(holdoutPath);
const calCount = Number(parseBig(calibration.scenarioCount));
const holdCount = Number(parseBig(holdout.scenarioCount));
const calScenarios = findLargestScenarioArray(calibration, calCount);
const holdScenarios = findLargestScenarioArray(holdout, holdCount);
const findings = [];

addFinding(findings, 'S3-01',
  calibration.scenarioAlgorithmVersion === 'cats-tower-scenario-v2.2.0' && holdout.scenarioAlgorithmVersion === 'cats-tower-scenario-v2.2.0' &&
  calibration.executionVersion === 'cats-tower-step3-executor-v1.1.0' && holdout.executionVersion === 'cats-tower-step3-executor-v1.1.0',
  'P0', 'Sealed algorithm and execution versions are used.', {
    calibrationScenarioAlgorithmVersion: calibration.scenarioAlgorithmVersion,
    holdoutScenarioAlgorithmVersion: holdout.scenarioAlgorithmVersion,
    calibrationExecutionVersion: calibration.executionVersion,
    holdoutExecutionVersion: holdout.executionVersion,
  });

const coverageCal = calScenarios ? coverageEvidence(calScenarios) : { builds: [], personas: [], horizons: [] };
const coverageHold = holdScenarios ? coverageEvidence(holdScenarios) : { builds: [], personas: [], horizons: [] };
const countsAndCoverage = calCount === 12000 && holdCount === 3000 && calScenarios && holdScenarios &&
  builds.every(x => coverageCal.builds.includes(x) && coverageHold.builds.includes(x)) &&
  personas.every(x => coverageCal.personas.includes(x) && coverageHold.personas.includes(x)) &&
  horizons.every(x => coverageCal.horizons.includes(x) && coverageHold.horizons.includes(x));
addFinding(findings, 'S3-02', Boolean(countsAndCoverage), 'P0', 'Full gameplay partitions and matrix coverage are present.', { calCount, holdCount, coverageCal, coverageHold, scenarioArrayLocated: Boolean(calScenarios && holdScenarios) });

const calScenarioDigests = calScenarios ? extractDigestSet(calScenarios, 'scenario') : new Set();
const holdScenarioDigests = holdScenarios ? extractDigestSet(holdScenarios, 'scenario') : new Set();
const calInputDigests = calScenarios ? extractDigestSet(calScenarios, 'input') : new Set();
const holdInputDigests = holdScenarios ? extractDigestSet(holdScenarios, 'input') : new Set();
const overlap = (a,b) => [...a].filter(x => b.has(x));
const scenarioOverlap = overlap(calScenarioDigests, holdScenarioDigests);
const inputOverlap = overlap(calInputDigests, holdInputDigests);
const disjointPass = calScenarioDigests.size === 12000 && holdScenarioDigests.size === 3000 && calInputDigests.size === 12000 && holdInputDigests.size === 3000 && scenarioOverlap.length === 0 && inputOverlap.length === 0;
addFinding(findings, 'S3-03', disjointPass, 'P0', 'Calibration and unseen holdout digests are disjoint.', { calibrationScenarioDigests: calScenarioDigests.size, holdoutScenarioDigests: holdScenarioDigests.size, calibrationInputDigests: calInputDigests.size, holdoutInputDigests: holdInputDigests.size, scenarioOverlap: scenarioOverlap.length, inputOverlap: inputOverlap.length });

const highVolume = {};
let highPass = true;
const highEvidence = [];
for (const [suite, expected] of suiteCounts) {
  const file = path.join(highDir, `${suite}.json`);
  const result = readJson(file);
  highVolume[suite] = result;
  const count = parseBig(result.sampleCount);
  const explicitFailures = scanExplicitFailures(result, suite);
  const digest = result.digest ?? result.resultDigest ?? null;
  const suitePass = result.suiteId === suite && count !== null && count >= expected && typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest) && explicitFailures.length === 0;
  if (!suitePass) highPass = false;
  highEvidence.push({ suite, expected: expected.toString(), actual: count?.toString() ?? null, digest, explicitFailures });
}
addFinding(findings, 'S3-04', highPass, 'P0', 'All high-volume suites meet sample and invariant requirements.', { suites: highEvidence });

const gameplayFailures = [...scanExplicitFailures(calibration, 'calibration'), ...scanExplicitFailures(holdout, 'holdout')];
const combined = { calibration, holdout };
const firstResetLeaves = findValues(combined, [['first'], ['reset'], ['minute','minutes','time']], v => parseNumber(v) !== null);
const firstResetMinutes = firstResetLeaves.map(x => parseNumber(x.value)).filter(x => x !== null && x >= 0 && x < 10000);
const firstResetP50 = quantile(firstResetMinutes, 0.5);
const repeatedRubyLeaves = findValues(combined, [['repeat','repeated'], ['best','highest'], ['ruby','reward']], v => parseNumber(v) !== null);
const repeatedRubyValues = repeatedRubyLeaves.map(x => parseNumber(x.value)).filter(x => x !== null);
const horizonCoverage = horizons.every(h => stableStringify(combined).includes(h));
const progressionPass = gameplayFailures.length === 0 && horizonCoverage && firstResetMinutes.length > 0 && firstResetP50 >= 20 && firstResetP50 <= 35 && repeatedRubyValues.length > 0 && repeatedRubyValues.every(x => x === 0);
addFinding(findings, 'S3-05', progressionPass, 'P0', 'Progression, reset, ruby and long-horizon targets are explicitly measured.', { gameplayFailures: gameplayFailures.slice(0,100), horizonCoverage, firstResetMetricCount: firstResetMinutes.length, firstResetP50Minutes: firstResetP50, firstResetPaths: [...new Set(firstResetLeaves.map(x => x.path.join('.')))].slice(0,30), repeatedBestRubyMetricCount: repeatedRubyValues.length, repeatedBestRubyMax: repeatedRubyValues.length ? Math.max(...repeatedRubyValues) : null, repeatedBestRubyPaths: [...new Set(repeatedRubyLeaves.map(x => x.path.join('.')))].slice(0,30) });

const gachaText = stableStringify(highVolume['gacha-tails']) + stableStringify(highVolume['pity-conformance']);
const gachaSeparate = /character/i.test(gachaText) && /weapon/i.test(gachaText);
const hasP50 = /p50/i.test(gachaText), hasP90 = /p90/i.test(gachaText), hasP99 = /p99/i.test(gachaText);
const hardPity = /100/.test(gachaText) && /pity/i.test(gachaText);
const featureGuarantee = /200/.test(gachaText) && /(featured|pickup)/i.test(gachaText);
const carryover = /carryover/i.test(gachaText), exchange = /exchange/i.test(gachaText), overflow = /overflow/i.test(gachaText);
addFinding(findings, 'S3-06', highPass && gachaSeparate && hasP50 && hasP90 && hasP99 && hardPity && featureGuarantee && carryover && exchange && overflow, 'P0', 'Gacha distribution, guarantees and recovery mechanisms are measured.', { gachaSeparate, hasP50, hasP90, hasP99, hardPity, featureGuarantee, carryover, exchange, overflow });

const duplicateText = stableStringify(highVolume['duplicate-skew-overflow']);
const firstCopy = /(firstcopy|first-copy)/i.test(duplicateText);
const practical = /(practical|breakpoint)/i.test(duplicateText);
const fullMastery = /(fullmastery|full-mastery)/i.test(duplicateText) && /(20|twenty)/i.test(duplicateText);
const postMastery = /(overflow|postmastery|post-mastery)/i.test(duplicateText);
addFinding(findings, 'S3-07', highPass && firstCopy && practical && fullMastery && postMastery, 'P0', 'Duplicate mastery stages and overflow are measured separately.', { firstCopy, practical, fullMastery, postMastery });

const noAdLeaves = findValues(combined, [['noad','no-ad'], ['evolution'], ['coverage','afford','fund']], () => true);
const guaranteeDayLeaves = findValues(combined, [['noad','no-ad'], ['featured','pickup'], ['guarantee','pity'], ['day','days']], v => parseNumber(v) !== null);
const monthlyLeaves = findValues(combined, [['monthly'], ['multiplier','ratio','speed']], v => parseNumber(v) !== null);
const highSpendLeaves = findValues(combined, [['highspend','high-spend'], ['multiplier','ratio','speed']], v => parseNumber(v) !== null);
const boolPass = v => v === true || (typeof v === 'string' && /^(PASS|TRUE|FULL|COVERED|AFFORDABLE)$/i.test(v));
const noAdCoveragePass = noAdLeaves.length > 0 && noAdLeaves.every(x => typeof x.value === 'boolean' || typeof x.value === 'string' ? boolPass(x.value) : (parseNumber(x.value) ?? 0) >= 1);
const guaranteeDays = guaranteeDayLeaves.map(x => parseNumber(x.value)).filter(x => x !== null);
const monthly = monthlyLeaves.map(x => parseNumber(x.value)).filter(x => x !== null);
const highSpend = highSpendLeaves.map(x => parseNumber(x.value)).filter(x => x !== null);
const monetizationPass = noAdCoveragePass && guaranteeDays.length > 0 && Math.max(...guaranteeDays) <= 45 && monthly.length > 0 && Math.max(...monthly) <= 2 && Math.min(...monthly) >= 1 && highSpend.length > 0 && Math.max(...highSpend) <= 5 && Math.min(...highSpend) >= 1;
addFinding(findings, 'S3-08', monetizationPass, 'P0', 'F2P evolution/guarantee and paid progression caps are explicitly evaluated.', { noAdCoverageMetricCount: noAdLeaves.length, noAdCoveragePass, guaranteeDayMetricCount: guaranteeDays.length, guaranteeDayMax: guaranteeDays.length ? Math.max(...guaranteeDays) : null, monthlyMetricCount: monthly.length, monthlyRange: monthly.length ? [Math.min(...monthly), Math.max(...monthly)] : null, highSpendMetricCount: highSpend.length, highSpendRange: highSpend.length ? [Math.min(...highSpend), Math.max(...highSpend)] : null, paths: { noAd: [...new Set(noAdLeaves.map(x => x.path.join('.')))].slice(0,30), guarantee: [...new Set(guaranteeDayLeaves.map(x => x.path.join('.')))].slice(0,30), monthly: [...new Set(monthlyLeaves.map(x => x.path.join('.')))].slice(0,30), highSpend: [...new Set(highSpendLeaves.map(x => x.path.join('.')))].slice(0,30) } });

const rarityLeaves = findValues(combined, [['rarity','n','r'], ['utility','viable','role']], () => true);
const urLeaves = findValues(combined, [['ur'], ['dominance','dominant','nondominance','non-dominance']], () => true);
const rarityPassValue = v => v === true || (typeof v === 'string' && /PASS|VIABLE|UTILITY|ROLE|NON.?ZERO/i.test(v)) || ((parseNumber(v) ?? 0) > 0);
const urPassValue = v => v === false || (typeof v === 'string' && /PASS|NON.?DOMINANT|FALSE/i.test(v));
const rarityPass = rarityLeaves.length > 0 && rarityLeaves.every(x => rarityPassValue(x.value)) && urLeaves.length > 0 && urLeaves.every(x => urPassValue(x.value));
addFinding(findings, 'S3-09', rarityPass, 'P0', 'N/R utility and UR non-dominance are explicitly evaluated.', { rarityMetricCount: rarityLeaves.length, urMetricCount: urLeaves.length, rarityPaths: [...new Set(rarityLeaves.map(x => x.path.join('.')))].slice(0,50), urPaths: [...new Set(urLeaves.map(x => x.path.join('.')))].slice(0,50) });

const invariantPass = findings.slice(0,9).every(x => x.status === 'PASS');
addFinding(findings, 'S3-10', invariantPass, 'P0', 'Analysis is eligible for independent critics only when all measured domains pass.', { prerequisiteFindings: findings.slice(0,9).map(x => ({ id: x.id, status: x.status })) });
addFinding(findings, 'S3-11', false, 'P0', 'Completion evidence is created only after critics, final judge and exact CI binding.', { deferred: true });
addFinding(findings, 'S3-12', false, 'P0', 'Terminal live read-back is created after completion evidence and later CI.', { deferred: true });

const preReviewFindings = findings.filter(x => !['S3-10','S3-11','S3-12'].includes(x.id));
const preReviewVerdict = preReviewFindings.every(x => x.status === 'PASS') ? 'PASS_ANALYSIS_ELIGIBLE_FOR_CRITICS' : 'FAIL_SEALED_CANDIDATE_ANALYSIS';
const output = {
  schemaVersion: 1,
  artifactId: 'cats-tower-step3-large-scale-validation-analysis',
  recordedAt: new Date().toISOString(),
  repository: '2hg7trp7rv-design/cats_tower',
  branch: 'kimi',
  source: {
    scenarioAlgorithmVersion: calibration.scenarioAlgorithmVersion,
    executionVersion: calibration.executionVersion,
    calibration: { path: path.relative(root, calibrationPath), sha256: sha256File(calibrationPath), scenarioCount: String(calCount), digest: calibration.digest ?? null },
    holdout: { path: path.relative(root, holdoutPath), sha256: sha256File(holdoutPath), scenarioCount: String(holdCount), digest: holdout.digest ?? null },
    highVolume: Object.fromEntries([...suiteCounts.keys()].map(suite => [suite, { path: path.relative(root, path.join(highDir, `${suite}.json`)), sha256: sha256File(path.join(highDir, `${suite}.json`)), sampleCount: highVolume[suite].sampleCount, digest: highVolume[suite].digest ?? highVolume[suite].resultDigest ?? null }])),
  },
  findings,
  unresolvedP0: preReviewFindings.filter(x => x.status === 'FAIL' && x.severity === 'P0').length,
  unresolvedP1: 0,
  preReviewVerdict,
  metricInventory: metricInventory(combined),
  highVolumeMetricInventory: Object.fromEntries([...suiteCounts.keys()].map(suite => [suite, metricInventory(highVolume[suite])])),
};
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ preReviewVerdict, unresolvedP0: output.unresolvedP0, output: path.relative(root, outputPath) }));
