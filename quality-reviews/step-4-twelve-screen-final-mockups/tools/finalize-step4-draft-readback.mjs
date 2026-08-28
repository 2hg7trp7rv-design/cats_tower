#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const REPOSITORY = '2hg7trp7rv-design/cats_tower';
const BRANCH = 'kimi';
const STEP4_ENTRY = '245d50b6e80e2783f6aeaab5e50fae217661a3b6';
const STEP4 = 'quality-reviews/step-4-twelve-screen-final-mockups';
const ACCEPTANCE = `${STEP4}/acceptance-matrix.json`;
const REFERENCE = `${STEP4}/reference-audit.json`;
const DESIGN = `${STEP4}/design-system.json`;
const SPECS = `${STEP4}/screen-specs.json`;
const COVERAGE = `${STEP4}/state-coverage.json`;
const GALLERY = `${STEP4}/mockup-gallery.html`;
const MANIFEST = `${STEP4}/render-manifest.json`;
const ENTRY_READBACK = `${STEP4}/entry-readback.json`;
const ACTIVATION = `${STEP4}/draft-activation-evidence.json`;
const ROUND17 = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-017.json';
const LIVE = `${STEP4}/draft-live-readback.json`;
const STEP3_LIVE = 'quality-reviews/step-3-large-scale-validation/live-readback.json';
const V3_VERIFIER = 'tests/step4/verify-step4-mockups-v3.mjs';
const GOVERNANCE_VERIFIER = 'tests/governance/verify-current-step2-state.mjs';

const MIRRORS = [
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  ROUND17,
  'AI_PROJECT_POLICY.json',
  'PROJECT_STATUS.json',
  'simulation/CURRENT_STATUS.json',
  'QUALITY_GATE.md',
  '.github/workflows/CURRENT_STATUS.md',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'README.md',
  'CHATGPT_PROJECT_BOOTSTRAP.md',
  'CUSTOM_GPT_CONFIGURATION.md',
  'simulation/INPUT_CONTRACT.md',
];

const REQUIRED_DRAFT = [ACCEPTANCE, REFERENCE, DESIGN, SPECS, COVERAGE, GALLERY, MANIFEST, ENTRY_READBACK, ACTIVATION, ROUND17];

const abs = (relativePath) => path.join(ROOT, relativePath);
const exists = (relativePath) => existsSync(abs(relativePath));
const readText = (relativePath) => readFileSync(abs(relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(readText(relativePath));
const writeJson = (relativePath, value) => writeFileSync(abs(relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBlob = (relativePath) => git('rev-parse', `HEAD:${relativePath}`);
const runJson = (relativePath) => {
  const output = execFileSync('node', [relativePath], { cwd: ROOT, encoding: 'utf8' }).trim();
  return JSON.parse(output.split('\n').at(-1));
};

function verifyAuthority() {
  assert.equal(process.env.GITHUB_REPOSITORY ?? REPOSITORY, REPOSITORY);
  assert.equal(process.env.GITHUB_REF_NAME ?? BRANCH, BRANCH);
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(git('replace', '-l'), '');
  execFileSync('git', ['merge-base', '--is-ancestor', STEP4_ENTRY, 'HEAD'], { cwd: ROOT });

  const immutable = {
    'quality-reviews/step-1-reseal-round-008/seal-round-008.json': '0a959de0383b57ad6cd1f33c124b398aa51c1e00',
    'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
    [STEP3_LIVE]: 'd0b73af25a8f0d449cfc083b007b84b8ff3fbc9b',
    [ACCEPTANCE]: '7d907578c367ef426e11f97393637f23e14e25c2',
  };
  for (const [relativePath, expectedBlob] of Object.entries(immutable)) {
    assert(exists(relativePath), `${relativePath}: missing immutable authority`);
    assert.equal(gitBlob(relativePath), expectedBlob, `${relativePath}: immutable authority blob mismatch`);
  }
  for (const relativePath of REQUIRED_DRAFT) assert(exists(relativePath), `${relativePath}: missing Step 4 draft authority`);

  const draft = runJson(V3_VERIFIER);
  assert.equal(draft.verdict, 'PASS_STEP4_MOCKUP_DRAFT_VALIDATION_V3');
  assert.equal(draft.screenCount, 12);
  assert.equal(draft.viewportCount, 3);
  assert.equal(draft.renderCount, 36);
  assert.equal(draft.xmlParsed, true);
  assert.equal(draft.v1Compatibility, true);
  assert.equal(draft.forbiddenPathCount, 0);

  const governance = runJson(GOVERNANCE_VERIFIER);
  assert.equal(governance.verdict, 'PASS_CURRENT_CATS_TOWER_LIFECYCLE_GOVERNANCE');
  assert.equal(governance.currentStep, 4);
  assert.equal(governance.status, 'IN_PROGRESS');
  assert.equal(governance.step4, 'IN_PROGRESS');
  assert.equal(governance.step5, 'BLOCKED_UNTIL_STEP4_PASS');
  assert.equal(governance.forbiddenPathCount, 0);

  const manifest = readJson(MANIFEST);
  const activation = readJson(ACTIVATION);
  const round17 = readJson(ROUND17);
  const step3Live = readJson(STEP3_LIVE);
  assert.equal(manifest.renderCount, 36);
  assert.equal(manifest.xmlVerdict, 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_XML_VALID_V3');
  assert.equal(manifest.xmlValidation.result, 'PASS');
  assert.equal(activation.verdict, 'PASS_STEP4_DRAFT_ACTIVATION_PENDING_WORKFLOW_MIRROR');
  assert.equal(activation.draftManifest.renderCount, 36);
  assert.equal(activation.scope.productionAliasChanged, false);
  assert.equal(activation.scope.physicalIPhoneVerified, false);
  assert.equal(round17.verdict, 'PASS_STEP4_DRAFT_ACTIVATION_AUTHORIZED');
  assert.equal(round17.step4Status, 'IN_PROGRESS');
  assert.equal(round17.step5Allowed, false);
  assert.equal(step3Live.verdict, 'PASS_FINAL_LIVE_READBACK_STEP3_LARGE_SCALE_VALIDATION');
  assert.equal(step3Live.governanceDecision.step3, 'PASS');

  const project = readJson('PROJECT_STATUS.json');
  const simulation = readJson('simulation/CURRENT_STATUS.json');
  const policy = readJson('AI_PROJECT_POLICY.json');
  const active = readJson('quality-reviews/step-1-canonical-design/active-change-control.json');
  assert.equal(project.currentStep, 4);
  assert.equal(project.currentStepStatus, 'IN_PROGRESS');
  assert.equal(project.step5Allowed, false);
  assert.equal(project.step4.renderCount, 36);
  assert.equal(project.step4.independentCritics, '0_OF_5');
  assert.equal(simulation.currentStep, 4);
  assert.equal(simulation.status, 'IN_PROGRESS');
  assert.equal(simulation.step5Allowed, false);
  assert.equal(policy.currentPhase.step, 4);
  assert.equal(policy.currentPhase.status, 'IN_PROGRESS');
  assert.equal(policy.currentPhase.step5Allowed, false);
  assert.equal(active.status, 'IN_PROGRESS');
  assert.equal(active.step5Allowed, false);

  return { draft, governance, manifest, activation, round17, step3Live };
}

function forbiddenChangedPaths() {
  const output = git('diff', '--name-only', `${STEP4_ENTRY}..HEAD`);
  const changed = output ? output.split('\n').filter(Boolean) : [];
  const allowedExact = new Set([
    'tests/governance/verify-current-step2-state.mjs',
    'PROJECT_STATUS.json',
    'simulation/CURRENT_STATUS.json',
    'AI_PROJECT_POLICY.json',
    'QUALITY_GATE.md',
    '.github/workflows/CURRENT_STATUS.md',
    'AGENTS.md',
    'PROJECT_HANDOVER.md',
    'README.md',
    'CHATGPT_PROJECT_BOOTSTRAP.md',
    'CUSTOM_GPT_CONFIGURATION.md',
    'simulation/INPUT_CONTRACT.md',
    'quality-reviews/step-1-canonical-design/active-change-control.json',
    ROUND17,
  ]);
  const allowed = (relativePath) => relativePath.startsWith(`${STEP4}/`) || relativePath.startsWith('tests/step4/') || (relativePath.startsWith('.github/workflows/') && /step-4|step4/u.test(relativePath)) || allowedExact.has(relativePath);
  const forbidden = changed.filter((relativePath) => !allowed(relativePath));
  const productForbidden = changed.filter((relativePath) => /^(runtime\/|assets\/|public\/|backend\/|vercel\.json|\.vercel\/)/u.test(relativePath));
  const executableForbidden = changed.filter((relativePath) => /^simulation\/(candidate-v2\.json|candidate-v2\.schema\.json|run-plan-v2\.json|execution-contract-v2\.json|executable-seal-v2\.json|engine-v2\/|fixtures\/v2\/|migrations\/v1-to-v2\/)/u.test(relativePath));
  assert.deepEqual(forbidden, []);
  assert.deepEqual(productForbidden, []);
  assert.deepEqual(executableForbidden, []);
  return { changed, forbidden, productForbidden, executableForbidden };
}

function createLiveReadback() {
  const authority = verifyAuthority();
  const scope = forbiddenChangedPaths();
  assert(!exists(LIVE), 'Step 4 draft live read-back already exists');

  const finalizerRunId = process.env.FINALIZER_RUN_ID;
  const finalizerJobId = process.env.FINALIZER_JOB_ID;
  const finalizerSourceCommit = process.env.FINALIZER_SOURCE_COMMIT;
  const draftRunId = process.env.DRAFT_RUN_ID;
  const draftJobId = process.env.DRAFT_JOB_ID;
  const activationRunId = process.env.ACTIVATION_RUN_ID;
  const activationJobId = process.env.ACTIVATION_JOB_ID;
  for (const [name, value] of Object.entries({ finalizerRunId, finalizerJobId, finalizerSourceCommit, draftRunId, draftJobId, activationRunId, activationJobId })) assert(value, `${name} is required`);
  assert.equal(finalizerSourceCommit, git('rev-parse', 'HEAD'));

  const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  const live = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step4-draft-live-readback-v1',
    recordedAt: new Date().toISOString(),
    repository: REPOSITORY,
    branch: BRANCH,
    observedLiveBeforeThisEvidence: { head, tree },
    acceptance: { path: ACCEPTANCE, blob: gitBlob(ACCEPTANCE), status: 'ACTIVE_BEFORE_FIRST_STEP4_WRITE' },
    step3TerminalAuthority: { path: STEP3_LIVE, blob: gitBlob(STEP3_LIVE), verdict: authority.step3Live.verdict },
    draft: {
      referenceAudit: { path: REFERENCE, blob: gitBlob(REFERENCE) },
      designSystem: { path: DESIGN, blob: gitBlob(DESIGN) },
      screenSpecs: { path: SPECS, blob: gitBlob(SPECS), screenCount: 12 },
      stateCoverage: { path: COVERAGE, blob: gitBlob(COVERAGE) },
      gallery: { path: GALLERY, blob: gitBlob(GALLERY) },
      renderManifest: { path: MANIFEST, blob: gitBlob(MANIFEST), renderCount: 36, viewportCount: 3, xmlVerdict: authority.manifest.xmlVerdict },
      entryReadback: { path: ENTRY_READBACK, blob: gitBlob(ENTRY_READBACK) },
      verifier: authority.draft,
    },
    activation: {
      evidence: { path: ACTIVATION, blob: gitBlob(ACTIVATION), verdict: authority.activation.verdict },
      changeControl: { path: ROUND17, blob: gitBlob(ROUND17), verdict: authority.round17.verdict },
    },
    workflows: {
      draftV3: { runId: String(draftRunId), jobId: String(draftJobId), conclusion: 'SUCCESS' },
      activation: { runId: String(activationRunId), jobId: String(activationJobId), conclusion: 'SUCCESS' },
      finalizerSource: { runId: String(finalizerRunId), jobId: String(finalizerJobId), sourceCommit: finalizerSourceCommit, statusAtRecord: 'IN_PROGRESS_EXPECTED_SUCCESS' },
    },
    currentMirrorBlobs: Object.fromEntries(MIRRORS.map((relativePath) => [relativePath, gitBlob(relativePath)])),
    governanceDecision: {
      step1: 'PASS',
      step2: 'PASS_SEALED',
      step3: 'PASS',
      step4: 'IN_PROGRESS',
      step5: 'BLOCKED_UNTIL_STEP4_PASS',
      draftScreenCount: 12,
      draftViewportCount: 3,
      draftRenderCount: 36,
      draftXmlValidation: 'PASS',
      completedIndependentCritics: 0,
      requiredIndependentCritics: 5,
      unresolvedP0: null,
      unresolvedP1: null,
      finalJudge: 'PENDING',
      completionEvidence: 'PENDING',
    },
    remainingGates: [
      'actual browser render and screenshot comparison',
      'large-text presentation evidence',
      'reduced-motion presentation evidence',
      'five independent critics',
      'defect repair and deterministic regeneration',
      'final judge',
      'completion evidence',
      'terminal Step 4 live read-back',
    ],
    scope: {
      changedPaths: scope.changed,
      forbiddenPaths: scope.forbidden,
      productRuntimeChanged: false,
      productAssetsChanged: false,
      backendChanged: false,
      paymentProviderChanged: false,
      adNetworkChanged: false,
      productionAliasChanged: false,
      physicalIPhoneVerified: false,
      otherBranchWritten: false,
      pullRequestOperationPerformed: false,
      step2OrStep3ExecutableChanged: false,
    },
    nextAuthorizedAction: 'Continue Step 4 browser rendering, accessibility review, five independent critics, repair and finalization. Step 5 remains blocked.',
    verdict: 'PASS_STEP4_DRAFT_LIVE_READBACK_IN_PROGRESS',
  };
  writeJson(LIVE, live);
  console.log(JSON.stringify({ verdict: live.verdict, sourceHead: head, sourceTree: tree, renderCount: 36, criticsCompleted: 0, step5Allowed: false }));
}

function verifyLiveReadback() {
  const authority = verifyAuthority();
  const scope = forbiddenChangedPaths();
  assert(exists(LIVE), 'Step 4 draft live read-back is missing');
  const live = readJson(LIVE);
  assert.equal(live.repository, REPOSITORY);
  assert.equal(live.branch, BRANCH);
  assert.equal(live.verdict, 'PASS_STEP4_DRAFT_LIVE_READBACK_IN_PROGRESS');
  assert.equal(live.acceptance.blob, gitBlob(ACCEPTANCE));
  assert.equal(live.step3TerminalAuthority.blob, gitBlob(STEP3_LIVE));
  assert.equal(live.draft.referenceAudit.blob, gitBlob(REFERENCE));
  assert.equal(live.draft.designSystem.blob, gitBlob(DESIGN));
  assert.equal(live.draft.screenSpecs.blob, gitBlob(SPECS));
  assert.equal(live.draft.stateCoverage.blob, gitBlob(COVERAGE));
  assert.equal(live.draft.gallery.blob, gitBlob(GALLERY));
  assert.equal(live.draft.renderManifest.blob, gitBlob(MANIFEST));
  assert.equal(live.draft.renderManifest.renderCount, 36);
  assert.equal(live.draft.renderManifest.viewportCount, 3);
  assert.equal(live.draft.renderManifest.xmlVerdict, 'PASS_DETERMINISTIC_STEP4_DRAFT_RENDERS_XML_VALID_V3');
  assert.equal(live.activation.evidence.blob, gitBlob(ACTIVATION));
  assert.equal(live.activation.changeControl.blob, gitBlob(ROUND17));
  for (const [relativePath, expectedBlob] of Object.entries(live.currentMirrorBlobs)) assert.equal(gitBlob(relativePath), expectedBlob, `${relativePath}: Step 4 draft live mirror blob mismatch`);
  assert.equal(live.governanceDecision.step4, 'IN_PROGRESS');
  assert.equal(live.governanceDecision.step5, 'BLOCKED_UNTIL_STEP4_PASS');
  assert.equal(live.governanceDecision.draftRenderCount, 36);
  assert.equal(live.governanceDecision.completedIndependentCritics, 0);
  assert.equal(live.governanceDecision.requiredIndependentCritics, 5);
  assert.equal(live.governanceDecision.finalJudge, 'PENDING');
  assert.equal(live.scope.forbiddenPaths.length, 0);
  assert.equal(live.scope.productRuntimeChanged, false);
  assert.equal(live.scope.productAssetsChanged, false);
  assert.equal(live.scope.backendChanged, false);
  assert.equal(live.scope.paymentProviderChanged, false);
  assert.equal(live.scope.adNetworkChanged, false);
  assert.equal(live.scope.productionAliasChanged, false);
  assert.equal(live.scope.physicalIPhoneVerified, false);
  assert.equal(live.scope.step2OrStep3ExecutableChanged, false);
  assert.equal(scope.forbidden.length, 0);
  assert.equal(authority.governance.lifecycle, 'STEP4_IN_PROGRESS_DRAFT_LIVE');
  console.log(JSON.stringify({ verdict: 'PASS_STEP4_DRAFT_LIVE_READBACK_VERIFICATION', head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), sourceRunId: live.workflows.finalizerSource.runId, renderCount: 36, step4: 'IN_PROGRESS', step5: 'BLOCKED_UNTIL_STEP4_PASS' }));
}

const command = process.argv[2] ?? 'verify';
if (command === 'create') createLiveReadback();
else if (command === 'verify') verifyLiveReadback();
else throw new Error(`UNKNOWN_COMMAND:${command}`);
