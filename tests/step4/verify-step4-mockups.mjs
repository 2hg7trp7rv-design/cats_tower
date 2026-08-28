#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP3_ENTRY = '245d50b6e80e2783f6aeaab5e50fae217661a3b6';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const ACCEPTANCE = `${STEP4}/acceptance-matrix.json`;
const ACCEPTANCE_BLOB = '7d907578c367ef426e11f97393637f23e14e25c2';
const REGISTRY = 'canonical/SCREEN_STATE_REGISTRY.json';
const STEP3_LIVE = 'quality-reviews/step-3-large-scale-validation/live-readback.json';
const GENERATOR = `${STEP4}/tools/build-step4-draft.mjs`;
const VIEWPORTS = ['320x667', '375x667', '390x844'];
const SCREEN_IDS = ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12'];

const abs = (relativePath) => path.join(ROOT, relativePath);
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);
const sha256File = (relativePath) => createHash('sha256').update(readFileSync(abs(relativePath))).digest('hex');
const requireFile = (relativePath) => assert(existsSync(abs(relativePath)), `${relativePath}: missing`);

assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
assert.equal(git('replace', '-l'), '');
execFileSync('git', ['merge-base', '--is-ancestor', STEP3_ENTRY, 'HEAD'], { cwd: ROOT });
assert.equal(gitBlob(ACCEPTANCE), ACCEPTANCE_BLOB, 'Step 4 Acceptance changed after first-write freeze');
assert.equal(gitBlob('quality-reviews/step-1-reseal-round-008/seal-round-008.json'), '0a959de0383b57ad6cd1f33c124b398aa51c1e00');
assert.equal(gitBlob('simulation/executable-seal-v2.json'), 'ee3507969c03b08fe27350263cf0bc093a1c18e1');
assert.equal(gitBlob(STEP3_LIVE), 'd0b73af25a8f0d449cfc083b007b84b8ff3fbc9b');

for (const relativePath of [
  GENERATOR,
  `${STEP4}/reference-audit.json`,
  `${STEP4}/design-system.json`,
  `${STEP4}/component-inventory.json`,
  `${STEP4}/screen-specs.json`,
  `${STEP4}/state-coverage.json`,
  `${STEP4}/render-manifest.json`,
  `${STEP4}/design-decision-log.json`,
  `${STEP4}/entry-readback.json`,
  `${STEP4}/mockup-gallery.html`,
]) requireFile(relativePath);

const acceptance = readJson(ACCEPTANCE);
const registry = readJson(REGISTRY);
const step3Live = readJson(STEP3_LIVE);
const referenceAudit = readJson(`${STEP4}/reference-audit.json`);
const design = readJson(`${STEP4}/design-system.json`);
const components = readJson(`${STEP4}/component-inventory.json`);
const specs = readJson(`${STEP4}/screen-specs.json`);
const coverage = readJson(`${STEP4}/state-coverage.json`);
const manifest = readJson(`${STEP4}/render-manifest.json`);
const decisions = readJson(`${STEP4}/design-decision-log.json`);
const entry = readJson(`${STEP4}/entry-readback.json`);
const gallery = readText(`${STEP4}/mockup-gallery.html`);

assert.equal(registry.screenCount, 12);
assert.deepEqual(registry.globalRules.screenIds, SCREEN_IDS);
assert.equal(step3Live.governanceDecision.step3, 'PASS');
assert.equal(step3Live.governanceDecision.step4, 'READY_TO_START');
assert.equal(step3Live.scopeReadback.productionAliasChanged, false);
assert.equal(step3Live.scopeReadback.physicalIPhoneVerified, false);
assert.equal(acceptance.repository, REPOSITORY);
assert.equal(acceptance.branch, BRANCH);

assert.equal(referenceAudit.referenceSet.itemCount, 20);
assert.equal(referenceAudit.referenceSet.byteCopiesCommitted, false);
assert.equal(referenceAudit.referenceSet.redistribution, false);
assert.match(referenceAudit.referenceSet.purpose, /no tracing|principle-level/i);
assert(referenceAudit.adoptedPrinciples.length >= 6);
assert(referenceAudit.rejectedPrinciples.length >= 6);
assert.equal(referenceAudit.verdict, 'PASS_REFERENCE_PRINCIPLE_AUDIT_READY_FOR_ORIGINAL_MOCKUPS');

assert.deepEqual(design.responsive.viewports.map((viewport) => `${viewport.width}x${viewport.height}`), VIEWPORTS);
assert.equal(design.interaction.minimumTouchTarget, 44);
assert(design.interaction.preferredPrimaryTarget >= 48);
assert.equal(design.interaction.onePrimaryActionPerState, true);
assert.equal(design.interaction.economicTimeoutMeansFailure, false);
assert.equal(design.interaction.pendingAndReconciliationVisible, true);
assert.equal(design.accessibility.colorOnlyEncodingForbidden, true);
assert.equal(design.motion.monetizationPulseAllowed, false);
assert.equal(design.verdict, 'PASS_STEP4_DESIGN_SYSTEM_DRAFT');

const componentIds = components.components.map((component) => component.id);
for (const id of ['app-header','compact-hud','scene-stage','state-card','primary-action','recovery-panel','bottom-navigation','progress-meter','ledger-row','confirmation-sheet']) assert(componentIds.includes(id), `missing component ${id}`);
assert.equal(components.components.find((component) => component.id === 'bottom-navigation').itemCount, 5);
assert.equal(components.components.find((component) => component.id === 'compact-hud').maximumCurrencyCount, 3);
assert(components.forbiddenPatterns.includes('tap damage CTA'));

assert.equal(specs.screens.length, 12);
assert.deepEqual(specs.screens.map((screen) => screen.id), SCREEN_IDS);
assert.equal(specs.sourceRegistry.blob, gitBlob(REGISTRY));
assert.equal(specs.verdict, 'PASS_ALL_TWELVE_SCREEN_SPECS_DRAFTED');

for (const source of registry.screens) {
  const screen = specs.screens.find((item) => item.id === source.id);
  assert(screen, `${source.id}: missing screen spec`);
  assert.deepEqual(screen.responsibilities, source.responsibilities);
  assert.equal(screen.authority, source.authority);
  assert.deepEqual(screen.requiredState, source.requiredState);
  assert.deepEqual(screen.serverOwnedState, source.serverOwnedState);
  assert.deepEqual(screen.canonicalUiStates, source.uiStates);
  assert.equal(screen.viewportFiles.length, 3);
  assert(source.uiStates.includes(screen.showcasedCriticalState), `${source.id}: showcased critical state is not canonical`);
  assert(screen.showcasedRecoveryAction.length >= 8);
}

assert.equal(coverage.screenCount, 12);
assert.equal(coverage.screens.length, 12);
assert.equal(coverage.verdict, 'PASS_CANONICAL_STATE_VISUAL_MAPPING_DRAFT');
for (const source of registry.screens) {
  const mapped = coverage.screens.find((screen) => screen.id === source.id);
  assert(mapped, `${source.id}: missing state coverage`);
  assert.equal(mapped.canonicalStateCount, source.uiStates.length);
  assert.deepEqual(mapped.mapping.map((item) => item.state), source.uiStates);
  assert(mapped.mapping.every((item) => ['resolved-or-normal','pending','recovery-or-reconciliation','blocked-or-terminal','contextual'].includes(item.visualPattern)));
}

assert.equal(manifest.screenCount, 12);
assert.equal(manifest.viewportCount, 3);
assert.equal(manifest.renderCount, 36);
assert.equal(manifest.renders.length, 36);
assert.equal(manifest.limitations.physicalIPhoneVerified, false);
assert.equal(manifest.limitations.runtimeInteractionVerified, false);
assert.equal(manifest.limitations.productionChanged, false);
assert.equal(manifest.limitations.finalArtAssets, false);
assert.equal(manifest.limitations.browserScreenshotEvidence, false);
assert.equal(manifest.verdict, 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_GENERATED');

const seen = new Set();
for (const render of manifest.renders) {
  const key = `${render.screenId}-${render.viewport}`;
  assert(!seen.has(key), `duplicate render ${key}`);
  seen.add(key);
  assert(SCREEN_IDS.includes(render.screenId));
  assert(VIEWPORTS.includes(render.viewport));
  requireFile(render.path);
  const svg = readText(render.path);
  const [width, height] = render.viewport.split('x').map(Number);
  assert(svg.includes(`width="${width}"`));
  assert(svg.includes(`height="${height}"`));
  assert(svg.includes('role="img"'));
  assert(svg.includes('<title'));
  assert(svg.includes('<desc'));
  assert(svg.includes(render.criticalStateShown));
  assert(!/<script\b/i.test(svg), `${render.path}: script forbidden`);
  assert(!/<image\b/i.test(svg), `${render.path}: external raster/image forbidden`);
  assert(!/\bhref\s*=/i.test(svg), `${render.path}: external href forbidden`);
  assert.equal(sha256File(render.path), render.sha256, `${render.path}: sha256 mismatch`);
  assert.equal(readFileSync(abs(render.path)).length, render.bytes, `${render.path}: byte count mismatch`);
}
assert.equal(seen.size, 36);

assert.equal(manifest.gallery.sha256, sha256File(manifest.gallery.path));
assert.equal(manifest.gallery.bytes, readFileSync(abs(manifest.gallery.path)).length);
for (const id of SCREEN_IDS) {
  assert(gallery.includes(`data-screen-card="${id}"`));
  for (const viewport of VIEWPORTS) assert(gallery.includes(`mockups/${id}-${viewport}.svg`));
}
assert(gallery.includes('@media(prefers-reduced-motion:reduce)'));
assert(gallery.includes('viewport-fit=cover'));
assert(gallery.includes('これは製品runtimeではありません'));

assert(decisions.decisions.length >= 7);
assert(decisions.openUntilCriticReview.includes('physical-device safe-area proof'));
assert.equal(entry.repository, REPOSITORY);
assert.equal(entry.branch, BRANCH);
assert.equal(entry.acceptance.blob, ACCEPTANCE_BLOB);
assert.equal(entry.screenRegistry.blob, gitBlob(REGISTRY));
assert.equal(entry.step3TerminalReadback.blob, gitBlob(STEP3_LIVE));
assert.equal(entry.scope.runtimeChanged, false);
assert.equal(entry.scope.productAssetsChanged, false);
assert.equal(entry.scope.backendChanged, false);
assert.equal(entry.scope.paymentProviderChanged, false);
assert.equal(entry.scope.adNetworkChanged, false);
assert.equal(entry.scope.productionAliasChanged, false);
assert.equal(entry.scope.physicalIPhoneVerified, false);
assert.equal(entry.verdict, 'PASS_STEP4_ENTRY_AND_DRAFT_GENERATION_READBACK');

const changedOutput = git('diff', '--name-only', `${STEP3_ENTRY}..HEAD`);
const changed = changedOutput ? changedOutput.split('\n').filter(Boolean) : [];
const allowed = changed.filter((relativePath) =>
  relativePath.startsWith(`${STEP4}/`) ||
  relativePath.startsWith('tests/step4/') ||
  relativePath === 'tests/governance/verify-current-step2-state.mjs' ||
  ['.github/workflows/execute-step-4-twelve-screen-mockups.yml', '.github/workflows/execute-step-4-twelve-screen-mockups-v3.yml', '.github/workflows/repair-step-4-verifier-allowlist.yml'].includes(relativePath)
);
const forbidden = changed.filter((relativePath) => !allowed.includes(relativePath));
assert.deepEqual(forbidden, [], `forbidden Step 4 draft paths: ${forbidden.join(', ')}`);
assert.deepEqual(changed.filter((relativePath) => /^(runtime\/|assets\/|public\/|backend\/|vercel\.json|\.vercel\/)/.test(relativePath)), []);
assert.deepEqual(changed.filter((relativePath) => /^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/.test(relativePath)), []);

git('diff', '--check', `${STEP3_ENTRY}..HEAD`);

console.log(JSON.stringify({
  verdict: 'PASS_STEP4_MOCKUP_DRAFT_VALIDATION',
  head: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  screenCount: specs.screens.length,
  viewportCount: VIEWPORTS.length,
  renderCount: manifest.renderCount,
  canonicalStateCount: coverage.screens.reduce((sum, screen) => sum + screen.canonicalStateCount, 0),
  changedPathCount: changed.length,
  forbiddenPathCount: forbidden.length,
  physicalIPhone: 'NOT_VERIFIED',
  productionChanged: false,
}));
