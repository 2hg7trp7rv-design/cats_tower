#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertArtifactArchiveBinding,
  downloadGithubArtifactArchive,
} from './artifact-download-transport.mjs';

const verifierRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

function inspectGitWorktreeRoot(candidate, label) {
  assert.equal(typeof candidate, 'string', `${label} must be a string`);
  assert(path.isAbsolute(candidate), `${label} must be an absolute path`);
  assert(!/[\u0000-\u001f\u007f]/u.test(candidate), `${label} contains control characters`);
  const resolved = realpathSync(candidate);
  assert.equal(path.resolve(candidate), resolved,
    `${label} must use the canonical worktree path without symbolic-link aliases`);
  assert(statSync(resolved).isDirectory(), `${label} must be an existing directory`);
  const run = (args, encoding = 'utf8') => execFileSync('git', args, {
    cwd: resolved,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(run(['rev-parse', '--is-inside-work-tree']).trim(), 'true',
    `${label} must be a Git worktree`);
  assert.equal(run(['rev-parse', '--is-bare-repository']).trim(), 'false',
    `${label} must not be a bare repository`);
  assert.equal(realpathSync(run(['rev-parse', '--show-toplevel']).trim()), resolved,
    `${label} must name the exact Git worktree root`);
  assert.equal(run(['rev-parse', '--is-shallow-repository']).trim(), 'false',
    `${label} must contain full history`);
  assert.equal(run(['replace', '-l']).trim(), '', `${label} must not use Git replace refs`);
  const head = run(['rev-parse', 'HEAD']).trim();
  const tree = run(['rev-parse', 'HEAD^{tree}']).trim();
  assert.match(head, /^[a-f0-9]{40}$/u, `${label} HEAD is not a commit id`);
  assert.match(tree, /^[a-f0-9]{40}$/u, `${label} HEAD tree is not a tree id`);
  return { root: resolved, head, tree, run };
}

const requestedRepoRoot = process.env.CATS_REPO_ROOT;
if (requestedRepoRoot !== undefined) {
  assert(path.isAbsolute(requestedRepoRoot), 'CATS_REPO_ROOT must be an absolute path');
}
const repositoryWorktree = inspectGitWorktreeRoot(
  requestedRepoRoot === undefined ? verifierRoot : requestedRepoRoot,
  'CATS_REPO_ROOT',
);
const verifierWorktree = inspectGitWorktreeRoot(verifierRoot, 'verifier code root');
const repoRoot = repositoryWorktree.root;
const repositoryExpected = '2hg7trp7rv-design/cats_tower';
const workflowId = 335561992;
const workflowName = "Verify Cat's Tower baseline and quality records";
const workflowPath = '.github/workflows/verify-main.yml';
const externalWorkflowPath = '.github/workflows/verify-step-1-artifacts.yml';
const futureProtectedWorkflowPaths = Object.freeze([workflowPath, externalWorkflowPath]);
const reusableAuditRequiredSteps = Object.freeze([
  'Bind same-run primary workflow caller',
  'Initialize sanitized audit records',
  'Assert sanitized verifier result boundary',
  'Resolve Round 7 seal, audit mode, and exact C3 run',
  'Verify Round 7 C3 pull-request artifact',
  'Verify source main artifact',
  'Validate sanitized audit upload boundary',
  'Upload sanitized external audit evidence',
  'Aggregate Round 7 external audit gate',
]);
const acceptancePath = 'quality-reviews/step-1-legacy-baseline-round-007/acceptance-round-007.json';
const sealPath = 'quality-reviews/step-1-legacy-baseline-round-007/round-007.json';
const completionPath = 'quality-reviews/step-1-legacy-baseline-round-007/completion.json';
const initialExternalAuditPath = 'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-initial-external-audit.json';
const round7EvidencePath = 'quality-reviews/step-1-legacy-baseline-round-007';
const browserManifestPath = 'quality-reviews/step-1-legacy-baseline/evidence/browser-qa.json';
const round7BaseCommit = '88daf9c912fa726e019915e5d7bfed94f0a47158';
const round7BaseTree = '1aeba9e915990e56a8d777e7b90cd94d4755c7fb';
const baselineCommit = '727b8d00c281e7539117da5ded7309ea01c7e516';
const baselineTree = 'c508c58b0bb1b3fa591eefe143aab2dd6eac9271';

const roles = new Set([
  'self-test',
  'round6-c3-smoke',
  'round6-main-smoke',
  'round7-c3-pr',
  'initial-main-seal',
  'future-main',
]);

const frozenPathSets = Object.freeze({
  c1AllowedPaths: Object.freeze([
    '.github/workflows/verify-main.yml',
    '.github/workflows/verify-step-1-artifacts.yml',
    'AGENTS.md',
    'BASELINE_V082.md',
    'FLOORS_1_10_DESIGN.md',
    'MASTER_SPEC.md',
    'PROJECT_HANDOVER.md',
    'PROJECT_STATUS.json',
    'QUALITY_GATE.md',
    'README.md',
    'quality-reviews/step-1-legacy-baseline-round-007/acceptance-round-007.json',
    'quality-reviews/step-1-legacy-baseline-round-007/round-006-post-main-failure.json',
    'tests/artifact-download-transport.mjs',
    'tests/artifact-download-transport.test.mjs',
    'tests/verify-ci-artifact.mjs',
    'tests/verify-step-1-baseline.mjs',
  ]),
  c2AllowedPaths: Object.freeze([
    'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-adversarial-critic.json',
    'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-repository-critic.json',
    'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-runtime-critic.json',
    'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-artifact-download-smoke.json',
    'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-c1-ci-run.json',
  ]),
  c3AllowedPaths: Object.freeze([
    'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-final-judge.json',
    'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-c2-ci-run.json',
    'quality-reviews/step-1-legacy-baseline-round-007/round-007.json',
  ]),
  completionAllowedPaths: Object.freeze([
    'AGENTS.md',
    'BASELINE_V082.md',
    'FLOORS_1_10_DESIGN.md',
    'MASTER_SPEC.md',
    'PROJECT_HANDOVER.md',
    'PROJECT_STATUS.json',
    'QUALITY_GATE.md',
    'README.md',
    'quality-reviews/step-1-legacy-baseline-round-007/completion.json',
    'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-initial-external-audit.json',
  ]),
});

const frozenTrustRoot = Object.freeze({
  authorityCommit: 'unique-acceptance-introduction-c1',
  baselineValidator: {
    path: 'tests/verify-step-1-baseline.mjs',
    blobBinding: 'exact-c1-git-blob-and-worktree-bytes',
    targetRepository: 'current-head-via-CATS_REPO_ROOT',
  },
  externalArtifactVerifier: {
    path: 'tests/verify-ci-artifact.mjs',
    transportPath: 'tests/artifact-download-transport.mjs',
    blobBinding: 'exact-c1-git-blobs-and-worktree-bytes',
    targetRepository: 'current-head-via-CATS_REPO_ROOT',
    allRound7Modes: true,
  },
  workflows: {
    primary: {
      path: workflowPath,
      blobBinding: 'exact-c1-git-blob',
      executionAuthority: 'event-time-github-workflow-sha-bound-in-provenance',
    },
    external: {
      path: externalWorkflowPath,
      blobBinding: 'exact-c1-git-blob',
      executionAuthority: 'same-commit-relative-reusable-workflow-call-from-primary',
    },
  },
  postC1VerifierKit: {
    root: '$RUNNER_TEMP',
    mode: 'detached-c1-full-history-no-replace',
    workspaceReuse: false,
  },
  externalSanitizedBoundary: {
    directory: '$RUNNER_TEMP/cats-step1-external-audit-results',
    directoryMode: '0700',
    exactFiles: ['main.json', 'round7-c3-pr.json'],
    regularFilesOnly: true,
    symlinks: false,
  },
});

const frozenExternalAuditProtocol = Object.freeze({
  activeSeal: sealPath,
  triggerAuthority: 'main-push-only reusable audit job invoked after the primary verification job through a relative same-commit workflow_call; a separate default-branch workflow_run cannot authorize completion',
  callerRunState: 'during the reusable audit, the exact caller run may still be in_progress with null conclusion, but its primary verification job must already be completed success and its provider-bound artifact must exist; completion evidence must later re-query the same run as completed success with the reusable audit job completed success',
  initialMode: 'only the exact Round 7 initial merge main-push run; after that same run uploads its primary artifact, execute the detached C1 artifact verifier against the current target repository and verify both the Round 7 C3 PR artifact and the caller run main artifact independently',
  partialFailure: 'attempt both verifications; reconstruct allowlisted result JSON without persisting raw verifier stdout; upload only the two exact regular non-symlink files from the mode-0700 RUNNER_TEMP boundary with if: always(); then fail an aggregate gate unless both passed',
  completionMergeMode: 'the exact completion merge must itself be the head of a completed successful primary main-push run whose same-run reusable future audit job succeeds with the exact C1 step ledger',
  laterDescendantMode: 'before auditing a later main descendant, discover and bind an earlier provider run on the exact completion merge with completed success primary and same-run reusable audit jobs; a descendant run cannot substitute for or bootstrap a missing completion-merge run, and retained artifact bytes are not required',
  futureMode: 'in the current main-push run, requires an earlier provider-bound successful same-run reusable Round 7 initial audit for the exact initial merge, then executes the detached C1 artifact verifier against the current target repository and verifies the caller run main artifact; the immediate completion merge re-queries the unexpired sanitized audit artifact, while later descendants bind its frozen completion identity and provider run/job ledger without requiring the historical C3 or sanitized audit artifact to remain downloadable',
  round6SuccessMayBootstrapRound7: false,
});

const round6 = Object.freeze({
  preMergeMainCommit: '76c49e9fca82a4c0f6922de8f93ea3b4e57289f6',
  c3Commit: '1f552aae0afe3c935a33122b15f85e20708aabc2',
  c3Tree: '1aeba9e915990e56a8d777e7b90cd94d4755c7fb',
  mergeCommit: '88daf9c912fa726e019915e5d7bfed94f0a47158',
  c3Run: Object.freeze({
    runId: 32590094723,
    attempt: 1,
    jobId: 97072452889,
    artifactId: 9480141426,
    artifactSize: 71594452,
    artifactDigest: 'sha256:52ff79cc991857c162545f7a0581d65835afe38b48f00aa6f4d5104d6fd97e4a',
    artifactCreatedAt: '2026-08-22T18:18:33Z',
    artifactExpiresAt: '2026-09-21T18:18:30Z',
  }),
  mainRun: Object.freeze({
    runId: 32590658257,
    attempt: 1,
    jobId: 97073864631,
    artifactId: 9480288219,
    artifactSize: 71609224,
    artifactDigest: 'sha256:93bf04404c93bd131d68e2e39658571a6772eb8778787aae9577c67d7d5149c1',
    artifactCreatedAt: '2026-08-22T18:30:02Z',
    artifactExpiresAt: '2026-09-21T18:29:59Z',
  }),
});

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitPathExists(commit, relativePath) {
  try {
    git(['cat-file', '-e', `${commit}:${relativePath}`]);
    return true;
  } catch {
    return false;
  }
}

function gitIsAncestor(ancestor, descendant) {
  try {
    git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function gitParents(commit) {
  const fields = git(['rev-list', '--parents', '-n', '1', commit]).trim().split(/\s+/u);
  assert.equal(fields[0], commit, `could not resolve exact parents for ${commit}`);
  return fields.slice(1);
}

function gitChangedPaths(parent, commit) {
  const output = git([
    'diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', parent, commit,
  ]).trim();
  return output ? output.split('\n').sort() : [];
}

function parseJsonStrict(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
  let index = 0;
  const fail = message => { throw new Error(`${label}: ${message} at character ${index}`); };
  const whitespace = () => { while (/\s/u.test(text[index] || '')) index += 1; };
  const string = () => {
    const start = index;
    if (text[index] !== '"') fail('expected string');
    index += 1;
    while (index < text.length) {
      if (text[index] === '\\') index += 2;
      else if (text[index] === '"') return JSON.parse(text.slice(start, ++index));
      else index += 1;
    }
    fail('unterminated string');
  };
  const value = location => {
    whitespace();
    if (text[index] === '{') {
      index += 1;
      whitespace();
      const keys = new Set();
      if (text[index] === '}') { index += 1; return; }
      while (index < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)} at ${location}`);
        keys.add(key);
        whitespace();
        if (text[index++] !== ':') fail('expected colon');
        value(`${location}.${key}`);
        whitespace();
        if (text[index] === '}') { index += 1; return; }
        if (text[index++] !== ',') fail('expected comma');
      }
    } else if (text[index] === '[') {
      index += 1;
      whitespace();
      if (text[index] === ']') { index += 1; return; }
      for (let item = 0; index < text.length; item += 1) {
        value(`${location}[${item}]`);
        whitespace();
        if (text[index] === ']') { index += 1; return; }
        if (text[index++] !== ',') fail('expected comma');
      }
    } else if (text[index] === '"') string();
    else {
      const primitive = text.slice(index).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u);
      if (!primitive) fail(`invalid value at ${location}`);
      index += primitive[0].length;
    }
  };
  value('$');
  whitespace();
  if (index !== text.length) fail('trailing content');
  return parsed;
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys differ`);
}

function assertStringArray(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  assert(value.every(item => typeof item === 'string' && item.length > 0 && !/[\r\n]/u.test(item)),
    `${label} must contain safe non-empty path strings`);
  assert.equal(new Set(value).size, value.length, `${label} contains duplicate paths`);
}

function assertExactChangedPaths(parent, commit, expected, label) {
  assertStringArray(expected, `${label} expected paths`);
  assert.deepEqual(gitChangedPaths(parent, commit), [...expected].sort(), `${label} changed paths differ`);
}

function workflowPathMatches(actual, expected) {
  return actual === expected || (
    typeof actual === 'string'
    && actual.startsWith(`${expected}@`)
    && actual.length > expected.length + 1
    && !/[\r\n]/u.test(actual)
  );
}

function requireDate(value, label) {
  assert.equal(typeof value, 'string', `${label} must be an ISO date string`);
  const milliseconds = Date.parse(value);
  assert(Number.isFinite(milliseconds), `${label} is not a valid date`);
  return milliseconds;
}

function exactStepMap(steps, label) {
  assert(Array.isArray(steps), `${label} steps must be an array`);
  const names = steps.map(step => step?.name);
  assert(names.every(name => typeof name === 'string' && name.length > 0),
    `${label} contains a step without a name`);
  assert.equal(new Set(names).size, names.length, `${label} contains duplicate step names`);
  return new Map(steps.map(step => [step.name, step.conclusion]));
}

function assertReusableAuditStepLedger(steps, c3Conclusion, label) {
  assert(['success', 'skipped'].includes(c3Conclusion),
    `${label} has an invalid expected C3 conclusion`);
  const stepMap = exactStepMap(steps, label);
  const names = steps.map(step => step.name);
  let previousIndex = -1;
  for (const stepName of reusableAuditRequiredSteps) {
    const index = names.indexOf(stepName);
    assert(index > previousIndex, `${label} does not preserve the sealed custom-step order`);
    previousIndex = index;
    const expectedConclusion = stepName === 'Verify Round 7 C3 pull-request artifact'
      ? c3Conclusion
      : 'success';
    assert.equal(stepMap.get(stepName), expectedConclusion,
      `${label} has the wrong conclusion for ${stepName}`);
  }
  return stepMap;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedArtifactName(runAttempt) {
  assert(Number.isSafeInteger(runAttempt) && runAttempt > 0,
    'artifact run attempt must be a positive safe integer');
  return `cats-v082-step-1-recovery-evidence-attempt-${runAttempt}`;
}

function expectedSanitizedAuditArtifactName(runId, runAttempt) {
  assert(Number.isSafeInteger(runId) && runId > 0,
    'sanitized audit source run ID must be a positive safe integer');
  assert(Number.isSafeInteger(runAttempt) && runAttempt > 0,
    'sanitized audit source attempt must be a positive safe integer');
  return `cats-step-1-round-7-external-audit-source-${runId}-${runAttempt}-audit-${runAttempt}`;
}

function validateSanitizedAuditArtifactIdentity(value, runId, runAttempt, label) {
  exactKeys(value, ['id', 'name', 'digest', 'sizeBytes'], label);
  assert(Number.isSafeInteger(value.id) && value.id > 0, `${label}.id must be positive`);
  assert.equal(value.name, expectedSanitizedAuditArtifactName(runId, runAttempt),
    `${label}.name differs from the exact same-run audit name`);
  assert.match(value.digest, /^sha256:[a-f0-9]{64}$/u,
    `${label}.digest is not a lowercase SHA-256 digest`);
  assert(Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0,
    `${label}.sizeBytes must be positive`);
  return value;
}

function validateProviderArtifact(artifact, expected) {
  assert(artifact && typeof artifact === 'object' && !Array.isArray(artifact),
    'provider artifact metadata must be an object');
  const expectedName = expected.name || expectedArtifactName(expected.runAttempt);
  assert.equal(artifact.name, expectedName,
    'provider artifact name differs from the exact attempt-scoped name');
  assert.equal(artifact.expired, false, 'provider artifact is marked expired');
  assert(Number.isSafeInteger(artifact.id) && artifact.id > 0,
    'provider artifact id must be a positive safe integer');
  assert(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0,
    'provider artifact size must be a positive safe integer');
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/u);
  assert(artifact.workflow_run && typeof artifact.workflow_run === 'object'
    && !Array.isArray(artifact.workflow_run),
  'provider artifact must contain workflow_run metadata');
  assert.equal(artifact.workflow_run.id, expected.runId,
    'provider artifact workflow_run.id differs from the exact run');
  assert.equal(artifact.workflow_run.head_sha, expected.headSha,
    'provider artifact workflow_run.head_sha differs from the expected head');
  const createdAt = requireDate(artifact.created_at, 'artifact created_at');
  assert(createdAt >= expected.jobStartedAt && createdAt <= expected.jobCompletedAt,
    'provider artifact created_at is outside the exact job interval');
  assert(Date.now() < requireDate(artifact.expires_at, 'artifact expires_at'),
    'provider artifact is expired');
  return artifact;
}

function assertSanitizedArtifactMatchesFrozen(providerArtifact, frozenIdentity) {
  const providerIdentity = {
    id: providerArtifact.id,
    name: providerArtifact.name,
    digest: providerArtifact.digest,
    sizeBytes: providerArtifact.size_in_bytes,
  };
  assert.deepEqual(providerIdentity, frozenIdentity,
    'retained sanitized artifact differs from the frozen completion audit identity');
  return providerIdentity;
}

function assertRound7EvidenceSubtreeBinding(currentTree, completionTree) {
  assert.match(currentTree, /^[a-f0-9]{40}$/u,
    'current Round 7 evidence subtree is not a Git tree id');
  assert.match(completionTree, /^[a-f0-9]{40}$/u,
    'completion Round 7 evidence subtree is not a Git tree id');
  assert.equal(currentTree, completionTree,
    'Round 7 evidence subtree changed after the completion commit');
}

function loadCompletionAuditBinding(completionCommit, initialMerge) {
  const auditBytes = git(['show', `${completionCommit}:${initialExternalAuditPath}`], null);
  const audit = parseJsonStrict(auditBytes.toString('utf8'), 'Round 7 initial external audit');
  exactKeys(audit, [
    'schemaVersion', 'artifactId', 'repository', 'status', 'mode', 'workflowId', 'runId',
    'runAttempt', 'jobId', 'headSha', 'sanitizedArtifact', 'c3', 'initialMain',
    'materialBlockers',
  ], 'Round 7 initial external audit');
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(audit.repository, repositoryExpected);
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.mode, 'initial-main-seal');
  assert.equal(audit.workflowId, workflowId);
  assert(Number.isSafeInteger(audit.runId) && audit.runId > 0,
    'Round 7 initial external audit runId must be positive');
  assert(Number.isSafeInteger(audit.runAttempt) && audit.runAttempt > 0,
    'Round 7 initial external audit runAttempt must be positive');
  assert(Number.isSafeInteger(audit.jobId) && audit.jobId > 0,
    'Round 7 initial external audit jobId must be positive');
  assert.equal(audit.headSha, initialMerge,
    'Round 7 initial external audit head differs from the exact initial merge');
  assert.deepEqual(audit.materialBlockers, []);
  validateSanitizedAuditArtifactIdentity(
    audit.sanitizedArtifact, audit.runId, audit.runAttempt,
    'Round 7 initial external audit sanitizedArtifact',
  );
  exactKeys(audit.initialMain,
    ['status', 'headSha', 'runId', 'runAttempt', 'jobId', 'artifact'],
    'Round 7 initial external audit initialMain');
  assert.equal(audit.initialMain.status, 'PASS');
  assert.equal(audit.initialMain.headSha, initialMerge);
  assert.equal(audit.initialMain.runId, audit.runId);
  assert.equal(audit.initialMain.runAttempt, audit.runAttempt);
  assert(Number.isSafeInteger(audit.initialMain.jobId) && audit.initialMain.jobId > 0);
  assert.notEqual(audit.initialMain.jobId, audit.jobId,
    'Round 7 initial reusable audit and primary job IDs must differ');

  const completion = parseJsonStrict(
    git(['show', `${completionCommit}:${completionPath}`]), 'Round 7 completion',
  );
  exactKeys(completion, [
    'schemaVersion', 'artifactId', 'round', 'status', 'canonicalStatus', 'recordedAt',
    'initialMerge', 'externalAuditRecord',
  ], 'Round 7 completion');
  assert.equal(completion.schemaVersion, 1);
  assert.equal(completion.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(completion.round, 7);
  assert.equal(completion.status, 'PASS');
  assert.equal(completion.canonicalStatus, 'PASS');
  assert.equal(completion.initialMerge, initialMerge);
  exactKeys(completion.externalAuditRecord, ['path', 'sha256'],
    'Round 7 completion externalAuditRecord');
  assert.deepEqual(completion.externalAuditRecord, {
    path: initialExternalAuditPath,
    sha256: sha256(auditBytes),
  }, 'Round 7 completion does not bind the exact initial external audit bytes');
  return {
    runId: audit.runId,
    runAttempt: audit.runAttempt,
    jobId: audit.jobId,
    primaryJobId: audit.initialMain.jobId,
    headSha: audit.headSha,
    sanitizedArtifact: { ...audit.sanitizedArtifact },
  };
}

async function githubApi(repository, token, endpoint) {
  assert.match(endpoint, /^\/[A-Za-z0-9?&=._\/-]+$/u, 'GitHub metadata endpoint is malformed');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${repository}${endpoint}`, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cats-tower-step-1-artifact-verifier',
      },
    });
  } catch {
    throw new Error('GitHub provider metadata request failed');
  } finally {
    clearTimeout(timer);
  }
  assert.equal(response.status, 200, `GitHub provider metadata returned status ${response.status}`);
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error('GitHub provider metadata body could not be read');
  }
  return parseJsonStrict(text, `GitHub provider metadata ${endpoint}`);
}

function validatePaginatedPayloads(payloads, key, endpoint) {
  assert(payloads.length >= 1, `GitHub API ${endpoint} returned no pagination payload`);
  let expectedTotal = null;
  const items = [];
  for (const [index, payload] of payloads.entries()) {
    assert(Array.isArray(payload[key]), `GitHub API ${endpoint} omitted ${key}`);
    assert(Number.isSafeInteger(payload.total_count) && payload.total_count >= 0,
      `GitHub API ${endpoint} omitted a valid total_count`);
    if (expectedTotal === null) expectedTotal = payload.total_count;
    assert.equal(payload.total_count, expectedTotal,
      `GitHub API ${endpoint} changed total_count during pagination`);
    if (index < payloads.length - 1) {
      assert.equal(payload[key].length, 100,
        `GitHub API ${endpoint} ended a page before the final payload`);
    }
    items.push(...payload[key]);
  }
  assert(payloads.at(-1)[key].length < 100,
    `GitHub API pagination reached the explicit safety bound for ${endpoint}`);
  assert.equal(items.length, expectedTotal,
    `GitHub API ${endpoint} returned a truncated or shifting page sequence`);
  const itemIds = items.map(item => item?.id);
  assert(itemIds.every(id => Number.isSafeInteger(id) && id > 0),
    `GitHub API ${endpoint} returned an item without a valid id`);
  assert.equal(new Set(itemIds).size, itemIds.length,
    `GitHub API ${endpoint} returned a duplicate item across pages`);
  return items;
}

async function githubPaginated(repository, token, endpoint, key) {
  const payloads = [];
  for (let page = 1; page <= 1000; page += 1) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const payload = await githubApi(repository, token, `${endpoint}${separator}per_page=100&page=${page}`);
    payloads.push(payload);
    assert(Array.isArray(payload[key]), `GitHub API ${endpoint} omitted ${key}`);
    if (payload[key].length < 100) return validatePaginatedPayloads(payloads, key, endpoint);
  }
  assert.fail(`GitHub API pagination exceeded the safety bound for ${endpoint}`);
}

async function githubAllWorkflowRuns(repository, token, workflowFile) {
  assert.match(workflowFile, /^[A-Za-z0-9._-]+\.ya?ml$/u,
    'workflow-run enumeration requires one protected workflow file name');
  const endpoint = `/actions/workflows/${workflowFile}/runs`;
  const first = await githubPaginated(repository, token, endpoint, 'workflow_runs');
  const second = await githubPaginated(repository, token, endpoint, 'workflow_runs');
  const identity = items => items.map(item => [item.id, item.run_attempt]);
  assert.deepEqual(identity(second), identity(first),
    `GitHub API ${endpoint} changed run identities or attempts between complete snapshots`);
  return first;
}

function revisionRows(head = 'HEAD') {
  return git(['rev-list', '--parents', head]).trim().split('\n').filter(Boolean)
    .map(row => row.split(/\s+/u));
}

function discoverPathIntroductions(rows, relativePath) {
  return rows.filter(([commit, ...parents]) => (
    gitPathExists(commit, relativePath)
    && parents.every(parent => !gitPathExists(parent, relativePath))
  )).map(([commit]) => commit);
}

function loadRound7Acceptance(currentHead) {
  assert(gitPathExists(currentHead, acceptancePath), 'Round 7 acceptance is missing from the current history');
  const acceptance = parseJsonStrict(git(['show', `${currentHead}:${acceptancePath}`]), 'Round 7 acceptance');
  assert.equal(acceptance.schemaVersion, 1);
  assert.equal(acceptance.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(acceptance.acceptanceRevision, 1);
  assert.equal(acceptance.status, 'FROZEN_AT_C1');
  assert.equal(acceptance.baseCommit, round7BaseCommit);
  assert.equal(acceptance.baseTree, round7BaseTree);
  assert.equal(acceptance.predecessor?.round, 6);
  assert.equal(acceptance.predecessor?.overallStatus, 'FAIL');
  assert.deepEqual(acceptance.externalAuditProtocol, frozenExternalAuditProtocol,
    'acceptance.externalAuditProtocol differs from the same-run reusable audit authority');
  assert.deepEqual(acceptance.trustRoot, frozenTrustRoot,
    'acceptance.trustRoot differs from the verifier\'s frozen C1 authority');
  for (const [key, frozenPaths] of Object.entries(frozenPathSets)) {
    assertStringArray(acceptance[key], `acceptance.${key}`);
    assert.deepEqual([...acceptance[key]].sort(), [...frozenPaths].sort(),
      `acceptance.${key} differs from the verifier's frozen path authority`);
  }
  assert.equal(git(['rev-parse', `${round7BaseCommit}^{tree}`]).trim(), round7BaseTree);
  return acceptance;
}

function resolveRound7Topology(currentHead, requireCompletion) {
  const acceptance = loadRound7Acceptance(currentHead);
  const rows = revisionRows(currentHead);
  const sealCommits = discoverPathIntroductions(rows, sealPath);
  assert.equal(sealCommits.length, 1, 'exactly one reachable Round 7 seal introduction is required');
  const c3Commit = sealCommits[0];
  const c3Parents = gitParents(c3Commit);
  assert.equal(c3Parents.length, 1, 'Round 7 C3 must have one parent');
  const c2Commit = c3Parents[0];
  const c2Parents = gitParents(c2Commit);
  assert.equal(c2Parents.length, 1, 'Round 7 C2 must have one parent');
  const c1Commit = c2Parents[0];
  assert.deepEqual(gitParents(c1Commit), [round7BaseCommit],
    'Round 7 C1 is not a direct child of the frozen base');
  assert.deepEqual(
    discoverPathIntroductions(rows, acceptancePath),
    [c1Commit],
    'Round 7 C1 must be the unique acceptance introduction',
  );
  const c1Tree = git(['rev-parse', `${c1Commit}^{tree}`]).trim();
  assertExactChangedPaths(round7BaseCommit, c1Commit, frozenPathSets.c1AllowedPaths, 'Round 7 C1');
  assertExactChangedPaths(c1Commit, c2Commit, frozenPathSets.c2AllowedPaths, 'Round 7 C2');
  assertExactChangedPaths(c2Commit, c3Commit, frozenPathSets.c3AllowedPaths, 'Round 7 C3');
  assert.equal(
    git(['show', `${currentHead}:${acceptancePath}`]),
    git(['show', `${c1Commit}:${acceptancePath}`]),
    'Round 7 acceptance changed after C1',
  );
  parseJsonStrict(git(['show', `${c3Commit}:${sealPath}`]), 'Round 7 seal');
  assert.equal(
    git(['show', `${currentHead}:${sealPath}`]),
    git(['show', `${c3Commit}:${sealPath}`]),
    'Round 7 seal changed after C3',
  );

  const c3Tree = git(['rev-parse', `${c3Commit}^{tree}`]).trim();
  const initialMerges = rows.filter(([commit, ...parents]) => (
    parents.length === 2
    && parents[0] === round7BaseCommit
    && parents[1] === c3Commit
    && git(['rev-parse', `${commit}^{tree}`]).trim() === c3Tree
  )).map(([commit]) => commit);
  assert.equal(initialMerges.length, 1,
    'exactly one proper Round 7 [base,C3] initial merge with the C3 tree is required');
  const initialMerge = initialMerges[0];
  assert(gitIsAncestor(initialMerge, currentHead), 'Round 7 initial merge is not an ancestor of current head');

  let completionCommit = null;
  let completionTree = null;
  let completionMerge = null;
  let completionAudit = null;
  if (requireCompletion) {
    const completionCommits = discoverPathIntroductions(rows, completionPath);
    assert.equal(completionCommits.length, 1,
      'future-main requires exactly one reachable Round 7 completion introduction');
    [completionCommit] = completionCommits;
    assert.deepEqual(gitParents(completionCommit), [initialMerge],
      'Round 7 completion must be a direct child of the initial merge');
    assertExactChangedPaths(initialMerge, completionCommit, frozenPathSets.completionAllowedPaths,
      'Round 7 completion');
    parseJsonStrict(git(['show', `${completionCommit}:${completionPath}`]), 'Round 7 completion');
    assert.equal(
      git(['show', `${currentHead}:${completionPath}`]),
      git(['show', `${completionCommit}:${completionPath}`]),
      'Round 7 completion record changed after introduction',
    );
    completionTree = git(['rev-parse', `${completionCommit}^{tree}`]).trim();
    const completionMerges = rows.filter(([commit, ...parents]) => (
      parents.length === 2
      && parents[0] === initialMerge
      && parents[1] === completionCommit
      && git(['rev-parse', `${commit}^{tree}`]).trim() === completionTree
    )).map(([commit]) => commit);
    assert.equal(completionMerges.length, 1,
      'future-main requires exactly one proper [initial,completion] merge with the completion tree');
    [completionMerge] = completionMerges;
    assert(gitIsAncestor(completionMerge, currentHead), 'completion merge is not an ancestor of current head');
    assertRound7EvidenceSubtreeBinding(
      git(['rev-parse', `${currentHead}:${round7EvidencePath}`]).trim(),
      git(['rev-parse', `${completionCommit}:${round7EvidencePath}`]).trim(),
    );
    completionAudit = loadCompletionAuditBinding(completionCommit, initialMerge);
  }
  return {
    c1Commit,
    c1Tree,
    c2Commit,
    c3Commit,
    c3Tree,
    initialMerge,
    completionCommit,
    completionTree,
    completionMerge,
    completionAudit,
  };
}

function resolveRoleContext(role, currentHead, currentTree, runId, attempt) {
  assert(gitIsAncestor(round6.mergeCommit, currentHead), 'current checkout must retain the failed Round 6 merge');
  if (role === 'round6-c3-smoke' || role === 'round6-main-smoke') {
    const fixed = role === 'round6-c3-smoke' ? round6.c3Run : round6.mainRun;
    assert.equal(runId, fixed.runId, `${role} run ID is frozen`);
    assert.equal(attempt, fixed.attempt, `${role} run attempt is frozen`);
    assert.equal(git(['rev-parse', `${round6.c3Commit}^{tree}`]).trim(), round6.c3Tree);
    assert.deepEqual(gitParents(round6.mergeCommit), [round6.preMergeMainCommit, round6.c3Commit]);
    assert.equal(git(['rev-parse', `${round6.mergeCommit}^{tree}`]).trim(), round6.c3Tree);
    const pullRequest = role === 'round6-c3-smoke';
    return {
      fixed,
      pullRequest,
      targetHead: pullRequest ? round6.c3Commit : round6.mergeCommit,
      targetTree: round6.c3Tree,
      expectedBaseOrBefore: round6.preMergeMainCommit,
      workflowAuthority: round6.c3Commit,
      verificationKit: pullRequest
        ? { mode: 'current-head', sha: round6.c3Commit, tree: round6.c3Tree }
        : { mode: 'historical-seal', sha: round6.c3Commit, tree: round6.c3Tree },
      servedRuntime: pullRequest
        ? { mode: 'immutable-baseline-checkout', sha: baselineCommit, tree: baselineTree }
        : { mode: 'sealed-c3-runtime', sha: round6.c3Commit, tree: round6.c3Tree },
      cleanCheckout: pullRequest ? 'success' : 'skipped',
      requireRound6SmokeStep: false,
      expectRound6SmokeSkipped: false,
      initialExternalAudit: null,
      completionMergeAudit: null,
    };
  }

  const topology = resolveRound7Topology(currentHead, role === 'future-main');
  if (role === 'round7-c3-pr' || role === 'initial-main-seal') {
    assert.equal(currentHead, topology.initialMerge, `${role} requires the exact Round 7 initial merge`);
  } else {
    assert.notEqual(currentHead, topology.initialMerge, 'future-main must not relabel the initial merge');
  }
  if (role === 'round7-c3-pr') {
    return {
      fixed: null,
      pullRequest: true,
      targetHead: topology.c3Commit,
      targetTree: topology.c3Tree,
      expectedBaseOrBefore: round7BaseCommit,
      workflowAuthority: topology.c3Commit,
      verificationKit: { mode: 'sealed-round7-c1', sha: topology.c1Commit, tree: topology.c1Tree },
      servedRuntime: { mode: 'immutable-baseline-checkout', sha: baselineCommit, tree: baselineTree },
      cleanCheckout: 'success',
      requireRound6SmokeStep: true,
      expectRound6SmokeSkipped: false,
      initialExternalAudit: null,
      completionMergeAudit: null,
      topology,
    };
  }
  if (role === 'initial-main-seal') {
    return {
      fixed: null,
      pullRequest: false,
      targetHead: topology.initialMerge,
      targetTree: topology.c3Tree,
      expectedBaseOrBefore: round7BaseCommit,
      workflowAuthority: topology.initialMerge,
      verificationKit: { mode: 'sealed-round7-c1', sha: topology.c1Commit, tree: topology.c1Tree },
      servedRuntime: { mode: 'immutable-baseline-checkout', sha: baselineCommit, tree: baselineTree },
      cleanCheckout: 'success',
      requireRound6SmokeStep: true,
      expectRound6SmokeSkipped: false,
      initialExternalAudit: null,
      completionMergeAudit: null,
      topology,
    };
  }
  const historical = currentHead !== topology.completionMerge;
  return {
    fixed: null,
    pullRequest: false,
    targetHead: currentHead,
    targetTree: currentTree,
    expectedBaseOrBefore: historical ? null : topology.initialMerge,
    workflowAuthority: currentHead,
    verificationKit: { mode: 'sealed-round7-c1', sha: topology.c1Commit, tree: topology.c1Tree },
    servedRuntime: historical
      ? { mode: 'sealed-round7-completion-runtime', sha: topology.completionCommit, tree: topology.completionTree }
      : { mode: 'immutable-baseline-checkout', sha: baselineCommit, tree: baselineTree },
    cleanCheckout: historical ? 'skipped' : 'success',
    requireRound6SmokeStep: !historical,
    expectRound6SmokeSkipped: historical,
    initialExternalAudit: null,
    completionMergeAudit: null,
    topology,
  };
}

function assertVerifierExecutionAuthority(role, context, currentHead, currentTree) {
  assert.equal(repositoryWorktree.head, currentHead,
    'CATS_REPO_ROOT changed after repository worktree validation');
  assert.equal(repositoryWorktree.tree, currentTree,
    'CATS_REPO_ROOT tree changed after repository worktree validation');
  if (['round7-c3-pr', 'initial-main-seal', 'future-main'].includes(role)) {
    assert.notEqual(verifierWorktree.root, repositoryWorktree.root,
      `${role} must not execute the mutable current verifier`);
    assert.equal(verifierWorktree.head, context.topology.c1Commit,
      `${role} verifier code must come from the exact C1 authority`);
    assert.equal(verifierWorktree.tree, context.topology.c1Tree,
      `${role} verifier code tree must equal the exact C1 tree`);
    const runnerTemp = process.env.RUNNER_TEMP;
    assert.equal(typeof runnerTemp, 'string', `${role} requires RUNNER_TEMP`);
    assert(path.isAbsolute(runnerTemp), `${role} RUNNER_TEMP must be absolute`);
    const canonicalRunnerTemp = realpathSync(runnerTemp);
    assert.equal(path.resolve(runnerTemp), canonicalRunnerTemp,
      `${role} RUNNER_TEMP must use its canonical path`);
    assert.equal(path.dirname(verifierWorktree.root), canonicalRunnerTemp,
      `${role} C1 verifier worktree must be a direct child of RUNNER_TEMP`);
    assert.equal(
      verifierWorktree.run(['status', '--porcelain', '--untracked-files=all']).trim(),
      '',
      `${role} C1 verifier worktree must not be reused or modified`,
    );
    assertSameRunInvocationFixture({
      sourceRunId: Number(process.env.CATS_CALLER_RUN_ID),
      currentRunId: Number(process.env.GITHUB_RUN_ID),
      sourceRunAttempt: Number(process.env.CATS_CALLER_RUN_ATTEMPT),
      currentRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      sourceHeadSha: process.env.CATS_CALLER_HEAD_SHA,
      currentHeadSha: currentHead,
      sourceEvent: process.env.CATS_CALLER_EVENT,
      sourceRef: process.env.CATS_CALLER_REF,
      callerWorkflowSha: process.env.CATS_CALLER_WORKFLOW_SHA,
      callerWorkflowRef: process.env.CATS_CALLER_WORKFLOW_REF,
    });
    let symbolicRef = '';
    try {
      symbolicRef = verifierWorktree.run(['symbolic-ref', '-q', 'HEAD']).trim();
    } catch {
      // The expected detached C1 verifier worktree has no symbolic HEAD.
    }
    assert.equal(symbolicRef, '', `${role} C1 verifier worktree must be detached`);
    const currentWorkflowBlobs = futureProtectedWorkflowPaths.map(relativePath => (
      git(['rev-parse', `${currentHead}:${relativePath}`]).trim()
    ));
    const c1WorkflowBlobs = futureProtectedWorkflowPaths.map(relativePath => (
      verifierWorktree.run(['rev-parse', `${context.topology.c1Commit}:${relativePath}`]).trim()
    ));
    assert.deepEqual(
      currentWorkflowBlobs,
      c1WorkflowBlobs,
      `${role} changed a C1-sealed workflow blob`,
    );
    return { sha: verifierWorktree.head, tree: verifierWorktree.tree };
  }
  assert.equal(verifierWorktree.root, repositoryWorktree.root,
    `${role} must execute the verifier from the current checked-out authority`);
  assert.equal(verifierWorktree.head, currentHead,
    `${role} verifier code commit differs from the current checkout`);
  assert.equal(verifierWorktree.tree, currentTree,
    `${role} verifier code tree differs from the current checkout`);
  return { sha: verifierWorktree.head, tree: verifierWorktree.tree };
}

function selectAuditVerifierPath(role, currentVerifier, c1Verifier) {
  assert.equal(typeof currentVerifier, 'string');
  assert.equal(typeof c1Verifier, 'string');
  if (['round7-c3-pr', 'initial-main-seal', 'future-main'].includes(role)) {
    assert(c1Verifier.length > 0, `${role} requires a sealed C1 verifier path`);
    return c1Verifier;
  }
  return currentVerifier;
}

function assertProtectedWorkflowBlobFixture(currentBlobs, c1Blobs) {
  assert.deepEqual(currentBlobs, c1Blobs,
    'Round 7 changed a C1-sealed workflow blob');
}

function assertSameRunInvocationFixture(fixture) {
  assert(Number.isSafeInteger(fixture.sourceRunId) && fixture.sourceRunId > 0,
    'same-run source run ID must be positive');
  assert.equal(fixture.sourceRunId, fixture.currentRunId,
    'a separate workflow run cannot authorize the reusable audit');
  assert(Number.isSafeInteger(fixture.sourceRunAttempt) && fixture.sourceRunAttempt > 0,
    'same-run source attempt must be positive');
  assert.equal(fixture.sourceRunAttempt, fixture.currentRunAttempt,
    'reusable audit attempt differs from the primary attempt');
  assert.match(fixture.sourceHeadSha || '', /^[a-f0-9]{40}$/u,
    'same-run source head must be a commit id');
  assert.equal(fixture.sourceHeadSha, fixture.currentHeadSha,
    'reusable audit checkout differs from the caller head');
  assert.equal(fixture.sourceEvent, 'push', 'reusable audit must be called by a push run');
  assert.equal(fixture.sourceRef, 'refs/heads/main',
    'reusable audit must be called by the protected main ref');
  assert.equal(fixture.callerWorkflowSha, fixture.currentHeadSha,
    'relative reusable audit must use the caller commit');
  assert.equal(
    fixture.callerWorkflowRef,
    `${repositoryExpected}/${workflowPath}@refs/heads/main`,
    'reusable audit caller workflow ref differs from protected main',
  );
}

function assertPrimaryRunLifecycle(role, status, conclusion) {
  if (role === 'initial-main-seal' || role === 'future-main') {
    assert.equal(status, 'in_progress', `${role} same-run caller must still be in progress`);
    assert.equal(conclusion, null, `${role} same-run caller must not have a conclusion yet`);
    return;
  }
  assert.equal(status, 'completed', `${role} historical run must be completed`);
  assert.equal(conclusion, 'success', `${role} historical run must have succeeded`);
}

function requiresLiveSanitizedAuditArtifact(currentHead, topology) {
  assert.match(currentHead, /^[a-f0-9]{40}$/u,
    'current head for sanitized audit retention must be a commit id');
  assert.match(topology.completionCommit || '', /^[a-f0-9]{40}$/u,
    'sanitized audit retention requires the completion commit');
  assert.match(topology.completionMerge || '', /^[a-f0-9]{40}$/u,
    'sanitized audit retention requires the completion merge');
  return currentHead === topology.completionCommit || currentHead === topology.completionMerge;
}

function requiresHistoricalCompletionMergeAudit(currentHead, topology) {
  assert.match(currentHead, /^[a-f0-9]{40}$/u,
    'current head for completion-merge audit lookup must be a commit id');
  assert.match(topology.completionMerge || '', /^[a-f0-9]{40}$/u,
    'historical completion-merge audit lookup requires the completion merge');
  return currentHead !== topology.completionMerge;
}

async function findInitialExternalAudit(repository, token, context, primaryRun) {
  const initialMerge = context.topology.initialMerge;
  const sealedAudit = context.topology.completionAudit;
  assert(sealedAudit && typeof sealedAudit === 'object',
    'future-main requires the frozen completion audit binding');
  const requireLiveSanitizedArtifact = requiresLiveSanitizedAuditArtifact(
    context.targetHead, context.topology,
  );
  const workflowRuns = await githubAllWorkflowRuns(repository, token, 'verify-main.yml');
  const candidates = workflowRuns.filter(candidate => (
    candidate.id === sealedAudit.runId
    && candidate.workflow_id === workflowId
    && candidate.event === 'push'
    && candidate.head_sha === initialMerge
    && candidate.head_branch === 'main'
    && candidate.name === workflowName
    && workflowPathMatches(candidate.path, workflowPath)
  )).sort((left, right) => left.id - right.id);
  const verified = [];
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.run_attempt)
      || candidate.run_attempt < sealedAudit.runAttempt) continue;
    for (const candidateAttempt of [sealedAudit.runAttempt]) {
      const exactRun = await githubApi(repository, token,
        `/actions/runs/${candidate.id}/attempts/${candidateAttempt}`);
      if (
        exactRun.id !== candidate.id
        || exactRun.run_attempt !== candidateAttempt
        || exactRun.workflow_id !== workflowId
        || exactRun.event !== 'push'
        || exactRun.head_sha !== initialMerge
        || exactRun.head_branch !== 'main'
        || exactRun.status !== 'completed'
        || exactRun.conclusion !== 'success'
        || exactRun.name !== workflowName
        || !workflowPathMatches(exactRun.path, workflowPath)
      ) continue;
      const candidateJobs = await githubPaginated(repository, token,
        `/actions/runs/${candidate.id}/attempts/${candidateAttempt}/jobs`, 'jobs');
      const primaryJobs = candidateJobs.filter(item => (
        item.id === sealedAudit.primaryJobId
        && item.name === 'vertical-tower-qa'
        && item.run_id === candidate.id
        && item.run_attempt === candidateAttempt
        && item.head_sha === initialMerge
        && item.status === 'completed'
        && item.conclusion === 'success'
        && requireDate(item.started_at, 'initial primary job started_at')
          < requireDate(item.completed_at, 'initial primary job completed_at')
      ));
      if (primaryJobs.length !== 1) continue;
      const auditJobs = candidateJobs.filter(item => (
        item.id === sealedAudit.jobId
        && item.name === 'round7-external-artifact-audit / round7-external-artifact-audit'
        && item.run_id === candidate.id
        && item.run_attempt === candidateAttempt
        && item.head_sha === initialMerge
        && item.status === 'completed'
        && item.conclusion === 'success'
        && requireDate(item.started_at, 'initial reusable audit job started_at')
          <= requireDate(item.completed_at, 'initial reusable audit job completed_at')
        && requireDate(primaryJobs[0].completed_at, 'initial primary job completed_at')
          <= requireDate(item.started_at, 'initial reusable audit job started_at')
        && requireDate(item.completed_at, 'initial reusable audit job completed_at')
          < requireDate(primaryRun.run_started_at, 'current primary run started_at')
      ));
      if (auditJobs.length !== 1) continue;
      assertReusableAuditStepLedger(
        auditJobs[0].steps, 'success', 'initial same-run reusable audit job',
      );
      if (requireLiveSanitizedArtifact) {
        const candidateArtifacts = await githubPaginated(repository, token,
          `/actions/runs/${exactRun.id}/artifacts`, 'artifacts');
        const sanitizedArtifacts = candidateArtifacts.filter(item => (
          item.name === sealedAudit.sanitizedArtifact.name
        ));
        assert.equal(sanitizedArtifacts.length, 1,
          'completion-merge audit requires one exact retained sanitized artifact');
        const sanitizedExpectation = {
          name: sealedAudit.sanitizedArtifact.name,
          runId: exactRun.id,
          runAttempt: exactRun.run_attempt,
          headSha: initialMerge,
          jobStartedAt: requireDate(auditJobs[0].started_at,
            'initial reusable audit job started_at'),
          jobCompletedAt: requireDate(auditJobs[0].completed_at,
            'initial reusable audit job completed_at'),
        };
        const sanitizedArtifact = validateProviderArtifact(
          sanitizedArtifacts[0], sanitizedExpectation,
        );
        const exactSanitizedArtifact = await githubApi(repository, token,
          `/actions/artifacts/${sanitizedArtifact.id}`);
        validateProviderArtifact(exactSanitizedArtifact, sanitizedExpectation);
        for (const key of [
          'id', 'name', 'size_in_bytes', 'digest', 'expired', 'created_at', 'expires_at',
        ]) {
          assert.deepEqual(exactSanitizedArtifact[key], sanitizedArtifact[key],
            `initial sanitized audit artifact metadata disagrees on ${key}`);
        }
        assert.deepEqual(exactSanitizedArtifact.workflow_run, sanitizedArtifact.workflow_run,
          'initial sanitized audit artifact requery workflow_run metadata differs');
        assertSanitizedArtifactMatchesFrozen(
          exactSanitizedArtifact, sealedAudit.sanitizedArtifact,
        );
      }
      verified.push({
        runId: exactRun.id,
        runAttempt: exactRun.run_attempt,
        jobId: auditJobs[0].id,
        headSha: exactRun.head_sha,
        completedAt: auditJobs[0].completed_at,
        sanitizedArtifact: { ...sealedAudit.sanitizedArtifact },
      });
    }
  }
  assert.equal(verified.length, 1,
    'future-main requires the exact frozen successful initial audit run and jobs');
  return verified[0];
}

async function findCompletionMergeAudit(repository, token, context, primaryRun) {
  const completionMerge = context.topology.completionMerge;
  assert(requiresHistoricalCompletionMergeAudit(context.targetHead, context.topology),
    'the exact completion merge uses its current same-run reusable audit');
  const currentRunStartedAt = requireDate(primaryRun.run_started_at,
    'current descendant primary run started_at');
  const workflowRuns = await githubAllWorkflowRuns(repository, token, 'verify-main.yml');
  const candidates = workflowRuns.filter(candidate => (
    candidate.workflow_id === workflowId
    && candidate.event === 'push'
    && candidate.head_sha === completionMerge
    && candidate.head_branch === 'main'
    && candidate.name === workflowName
    && workflowPathMatches(candidate.path, workflowPath)
  )).sort((left, right) => left.id - right.id);
  const verified = [];
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.run_attempt) || candidate.run_attempt < 1) continue;
    for (let candidateAttempt = 1; candidateAttempt <= candidate.run_attempt; candidateAttempt += 1) {
      const exactRun = await githubApi(repository, token,
        `/actions/runs/${candidate.id}/attempts/${candidateAttempt}`);
      if (
        exactRun.id !== candidate.id
        || exactRun.run_attempt !== candidateAttempt
        || exactRun.workflow_id !== workflowId
        || exactRun.event !== 'push'
        || exactRun.head_sha !== completionMerge
        || exactRun.head_branch !== 'main'
        || exactRun.status !== 'completed'
        || exactRun.conclusion !== 'success'
        || exactRun.name !== workflowName
        || !workflowPathMatches(exactRun.path, workflowPath)
      ) continue;
      const runStartedAt = requireDate(exactRun.run_started_at,
        'completion-merge primary run started_at');
      const runUpdatedAt = requireDate(exactRun.updated_at,
        'completion-merge primary run updated_at');
      if (!(runStartedAt < runUpdatedAt && runUpdatedAt < currentRunStartedAt)) continue;
      const candidateJobs = await githubPaginated(repository, token,
        `/actions/runs/${candidate.id}/attempts/${candidateAttempt}/jobs`, 'jobs');
      const primaryJobs = candidateJobs.filter(item => (
        item.name === 'vertical-tower-qa'
        && item.run_id === candidate.id
        && item.run_attempt === candidateAttempt
        && item.head_sha === completionMerge
        && item.status === 'completed'
        && item.conclusion === 'success'
      ));
      if (primaryJobs.length !== 1) continue;
      const primaryStartedAt = requireDate(primaryJobs[0].started_at,
        'completion-merge primary job started_at');
      const primaryCompletedAt = requireDate(primaryJobs[0].completed_at,
        'completion-merge primary job completed_at');
      if (!(runStartedAt <= primaryStartedAt && primaryStartedAt < primaryCompletedAt)) continue;
      const auditJobs = candidateJobs.filter(item => (
        item.name === 'round7-external-artifact-audit / round7-external-artifact-audit'
        && item.run_id === candidate.id
        && item.run_attempt === candidateAttempt
        && item.head_sha === completionMerge
        && item.status === 'completed'
        && item.conclusion === 'success'
      ));
      if (auditJobs.length !== 1) continue;
      const auditStartedAt = requireDate(auditJobs[0].started_at,
        'completion-merge reusable audit job started_at');
      const auditCompletedAt = requireDate(auditJobs[0].completed_at,
        'completion-merge reusable audit job completed_at');
      if (!(primaryCompletedAt <= auditStartedAt
        && auditStartedAt <= auditCompletedAt
        && auditCompletedAt <= runUpdatedAt
        && auditCompletedAt < currentRunStartedAt)) continue;
      assertReusableAuditStepLedger(
        auditJobs[0].steps, 'skipped', 'completion-merge same-run reusable audit job',
      );
      verified.push({
        runId: exactRun.id,
        runAttempt: exactRun.run_attempt,
        jobId: auditJobs[0].id,
        headSha: exactRun.head_sha,
        completedAt: auditJobs[0].completed_at,
      });
    }
  }
  assert(verified.length >= 1,
    'later future-main requires an earlier successful exact completion-merge primary and reusable audit');
  verified.sort((left, right) => left.runId - right.runId || left.runAttempt - right.runAttempt);
  return verified[0];
}

function loadSealedRawReportManifest() {
  const manifest = parseJsonStrict(
    git(['show', `${round6.c3Commit}:${browserManifestPath}`]),
    'sealed browser-qa.json',
  );
  assert(Array.isArray(manifest.rawReports), 'sealed browser-qa.json rawReports must be an array');
  assert.equal(manifest.rawReports.length, 10, 'sealed browser-qa.json must list ten raw reports');
  assert.equal(new Set(manifest.rawReports.map(item => item.artifactMember)).size, 10,
    'sealed raw report artifact members must be unique');
  assert.equal(new Set(manifest.rawReports.map(item => item.path)).size, 10,
    'sealed raw report paths must be unique');
  for (const item of manifest.rawReports) {
    exactKeys(item, ['path', 'sha256', 'artifactMember'], 'sealed raw report binding');
    assert.match(item.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(typeof item.path, 'string');
    assert.equal(typeof item.artifactMember, 'string');
    const sealedBytes = git(['show', `${round6.c3Commit}:${item.path}`], null);
    assert.equal(sha256(sealedBytes), item.sha256,
      `sealed local raw report differs from browser manifest: ${item.path}`);
    validatePassReport(sealedBytes.toString('utf8'), item.artifactMember);
  }
  return manifest.rawReports;
}

function validateArchiveInventory(archiveNames, reportBindings) {
  assert(Array.isArray(archiveNames), 'ZIP member list must be an array');
  assert.equal(archiveNames.length, 95, 'artifact must contain exactly 95 ZIP members');
  assert.equal(new Set(archiveNames).size, archiveNames.length, 'artifact has duplicate member names');
  for (const name of archiveNames) {
    assert.equal(typeof name, 'string', 'ZIP member name must be a string');
    const normalized = path.posix.normalize(name);
    assert(
      name.length > 0
      && !name.startsWith('/')
      && !name.endsWith('/')
      && !name.includes('\\')
      && !name.includes('//')
      && !/[\u0000-\u001f\u007f]/u.test(name),
      `unsafe ZIP member name: ${JSON.stringify(name)}`,
    );
    assert(
      normalized === name
      && !normalized.startsWith('../')
      && normalized !== '..'
      && normalized !== '.',
      `unsafe ZIP member path: ${JSON.stringify(name)}`,
    );
  }
  assert.equal(archiveNames.filter(name => name === 'ci-provenance.json').length, 1,
    'artifact must contain exactly one ci-provenance.json');
  const reportNames = archiveNames.filter(name => name.endsWith('/report.json')).sort();
  assert.deepEqual(reportNames, reportBindings.map(item => item.artifactMember).sort(),
    'artifact report members differ from the sealed ten-member manifest');
}

function validatePassReport(text, label) {
  const report = parseJsonStrict(text, label);
  assert.equal(report.passed, true, `${label} is not a PASS report`);
  let match = label.match(/^v082-(chromium|webkit)-(375x667|390x844)\/report\.json$/u);
  if (match) {
    const [, browserName, viewportText] = match;
    const [width, height] = viewportText.split('x').map(Number);
    exactKeys(report, [
      'passed', 'browserName', 'targetUrl', 'version', 'gameplaySchema', 'viewport',
      'japaneseFont', 'v082Assets', 'modalPause', 'rules', 'recoveryRosterContract',
      'roleTargetContract', 'loop', 'save', 'evidence', 'errors', 'badResponses',
      'failedRequests',
    ], `${label} living report`);
    assert.equal(report.browserName, browserName);
    assert.equal(report.targetUrl, 'http://127.0.0.1:4173/');
    assert.equal(report.version, '0.8.2');
    assert.equal(report.gameplaySchema, 2);
    assert.equal(report.viewport?.width, width);
    assert.equal(report.viewport?.height, height);
    assert.equal(report.viewport?.deviceScaleFactor, 3);
    assert.equal(report.viewport?.reducedMotion, 'reduce');
    assert.equal(report.japaneseFont?.status, 'loaded');
    assert.equal(report.japaneseFont?.checked, true);
    assert.equal(report.japaneseFont?.fontHttpStatus, 200);
    assert.equal(report.japaneseFont?.fontSignature, 'wOF2');
    assert.equal(report.v082Assets?.length, 2);
    assert(report.v082Assets.every(item => item.status === 200 && item.bytes > 500_000));
    assert.equal(report.modalPause?.playTimeMs, 0);
    assert.equal(report.modalPause?.enemyDamage, 0);
    assert.equal(report.modalPause?.floorBefore, report.modalPause?.floorAfter);
    assert.equal(report.rules?.wallFloor, 8);
    assert.equal(report.rules?.firstBossFloor, 10);
    assert.equal(report.loop?.rally?.unitCount, 6);
    assert.equal(report.loop?.wall?.floor, 8);
    assert.equal(report.loop?.firstNightCleared, true);
    assert.equal(report.loop?.firstNightCompleted, true);
    assert.equal(report.loop?.completedFloor, 10);
    assert.equal(report.loop?.completedImmediateRoster?.unitCount, 6);
    assert.equal(report.save?.newSchemaReload, true);
    assert.equal(report.save?.migrations?.length, 6);
    assert(report.save.migrations.every(item => item.passed === true && item.gameplaySchema === 2));
    assert.equal(report.evidence?.length, 18);
    assert(report.evidence.every(item => (
      typeof item.name === 'string' && /^[a-f0-9]{64}$/u.test(item.sha256)
    )));
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.badResponses, []);
    assert.deepEqual(report.failedRequests, []);
    return report;
  }

  match = label.match(/^step-1-normal-(chromium|webkit)-(375x667|390x844)\/report\.json$/u);
  if (match) {
    const [, browserName, viewportText] = match;
    const [width, height] = viewportText.split('x').map(Number);
    exactKeys(report, [
      'passed', 'browserName', 'targetUrl', 'viewport', 'deviceScaleFactor', 'qaMode',
      'reducedMotion', 'serviceWorkers', 'initial', 'active', 'durableReload',
      'reloaded', 'screenshots', 'errors', 'failedRequests',
    ], `${label} normal-flow report`);
    assert.equal(report.browserName, browserName);
    assert.equal(report.targetUrl, 'http://127.0.0.1:4173/');
    assert.deepEqual(report.viewport, { width, height });
    assert.equal(report.deviceScaleFactor, 1);
    assert.equal(report.qaMode, false);
    assert.equal(report.reducedMotion, false);
    assert.equal(report.serviceWorkers, 'enabled');
    assert.equal(report.active?.gameVisible, true);
    assert.equal(report.active?.titleHidden, true);
    assert.equal(report.active?.serviceWorkerSupported, true);
    assert.equal(report.active?.serviceWorkerControlled, true);
    assert.equal(report.durableReload?.preserved, true);
    assert.equal(report.durableReload?.before?.rawPresent, true);
    assert.equal(report.durableReload?.after?.rawPresent, true);
    assert.deepEqual(report.durableReload?.after?.durable, report.durableReload?.before?.durable);
    assert.equal(report.durableReload?.after?.durable?.gameplaySchema, 2);
    assert.equal(report.reloaded?.gameVisible, true);
    assert.equal(report.reloaded?.serviceWorkerControlled, true);
    assert.equal(report.screenshots?.length, 3);
    assert(report.screenshots.every(item => (
      typeof item.name === 'string'
      && Number.isSafeInteger(item.bytes)
      && item.bytes > 0
      && /^[a-f0-9]{64}$/u.test(item.sha256)
    )));
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.failedRequests, []);
    return report;
  }

  match = label.match(/^step-1-sw-chromium-(375x667|390x844)\/report\.json$/u);
  if (match) {
    const [width, height] = match[1].split('x').map(Number);
    exactKeys(report, [
      'passed', 'browserName', 'targetUrl', 'viewport', 'runtimeVersion', 'gameplaySchema',
      'saveKey', 'cacheState', 'schema2Reload', 'midCombatKnownDefect',
      'cacheEntrySetVerified', 'cachedResponseHashesVerified', 'futureSchemaPreserved',
      'futureSchemaRawBytesUnchanged', 'obsoleteCacheRemoved', 'offline', 'errors',
    ], `${label} service-worker report`);
    assert.equal(report.browserName, 'chromium');
    assert.equal(report.targetUrl, 'http://127.0.0.1:4173/');
    assert.deepEqual(report.viewport, { width, height });
    assert.equal(report.runtimeVersion, '0.8.2');
    assert.equal(report.gameplaySchema, 2);
    assert.equal(report.saveKey, 'cats-tower-v080');
    assert.deepEqual(report.cacheState?.cacheNames, ['cats-tower-v082-pixel-tower-r3']);
    assert.equal(report.cacheState?.expectedName, 'cats-tower-v082-pixel-tower-r3');
    assert.equal(report.cacheState?.controlled, true);
    assert.equal(report.cacheState?.actualEntryCount, 15);
    assert.equal(report.cacheState?.expectedEntryCount, 15);
    assert.equal(report.cacheState?.keys?.length, 15);
    assert.equal(report.cacheState?.paths?.length, 15);
    assert.equal(new Set(report.cacheState?.keys).size, 15);
    assert.equal(new Set(report.cacheState?.paths).size, 15);
    assert.deepEqual(report.schema2Reload, {
      currentFloor: 5,
      bestFloor: 5,
      coins: 4321,
      fish: 17,
    });
    assert.equal(report.cacheEntrySetVerified, true);
    assert.equal(report.cachedResponseHashesVerified, 15);
    assert.equal(report.futureSchemaPreserved, true);
    assert.equal(report.futureSchemaRawBytesUnchanged, true);
    assert.equal(report.obsoleteCacheRemoved, true);
    assert.equal(report.offline?.version, '0.8.2');
    assert.equal(report.offline?.controlled, true);
    assert.deepEqual(report.offline?.cacheNames, ['cats-tower-v082-pixel-tower-r3']);
    assert.equal(report.midCombatKnownDefect?.durableFieldsPreserved, true);
    assert.deepEqual(report.errors, []);
    return report;
  }
  assert.fail(`${label} is not one of the sealed report member families`);
  return report;
}

function validateProvenanceIdentity(provenance, expected) {
  assert.equal(provenance.runId, expected.runId, 'provenance runId differs from provider run');
  assert.equal(provenance.runAttempt, expected.runAttempt,
    'provenance runAttempt differs from provider attempt');
  assert.equal(provenance.event, expected.event, 'provenance event differs from provider run');
  assert.equal(provenance.invocationCheckout?.sha, expected.headSha,
    'provenance checkout differs from provider head');
}

function runPureAdversarialSelfTests(reportBindings) {
  const mutablePassStub = '/current-descendant/tests/verify-ci-artifact.mjs';
  const sealedC1Verifier = '/sealed-c1/tests/verify-ci-artifact.mjs';
  assert.equal(
    selectAuditVerifierPath('future-main', mutablePassStub, sealedC1Verifier),
    sealedC1Verifier,
    'future-main selected a mutable current-descendant PASS stub',
  );
  assert.equal(
    selectAuditVerifierPath('initial-main-seal', mutablePassStub, sealedC1Verifier),
    sealedC1Verifier,
    'initial mode selected the mutable current verifier instead of C1',
  );
  assert.equal(
    selectAuditVerifierPath('round7-c3-pr', mutablePassStub, sealedC1Verifier),
    sealedC1Verifier,
    'C3 audit selected the mutable current verifier instead of C1',
  );
  assert.throws(
    () => selectAuditVerifierPath('future-main', mutablePassStub, ''),
    /sealed C1 verifier/u,
  );
  const sealedWorkflowBlobs = ['a'.repeat(40), 'b'.repeat(40)];
  assertProtectedWorkflowBlobFixture([...sealedWorkflowBlobs], sealedWorkflowBlobs);
  assert.throws(
    () => assertProtectedWorkflowBlobFixture(
      ['c'.repeat(40), sealedWorkflowBlobs[1]], sealedWorkflowBlobs,
    ),
    /C1-sealed workflow blob/u,
  );
  const sameRunFixture = {
    sourceRunId: 41,
    currentRunId: 41,
    sourceRunAttempt: 2,
    currentRunAttempt: 2,
    sourceHeadSha: 'd'.repeat(40),
    currentHeadSha: 'd'.repeat(40),
    sourceEvent: 'push',
    sourceRef: 'refs/heads/main',
    callerWorkflowSha: 'd'.repeat(40),
    callerWorkflowRef: `${repositoryExpected}/${workflowPath}@refs/heads/main`,
  };
  assertSameRunInvocationFixture(sameRunFixture);
  assert.throws(
    () => assertSameRunInvocationFixture({
      ...sameRunFixture,
      sourceRunId: 40,
      sourceEvent: 'workflow_run',
    }),
    /separate workflow run/u,
  );
  assertPrimaryRunLifecycle('initial-main-seal', 'in_progress', null);
  assertPrimaryRunLifecycle('future-main', 'in_progress', null);
  assertPrimaryRunLifecycle('round7-c3-pr', 'completed', 'success');
  assert.throws(
    () => assertPrimaryRunLifecycle('future-main', 'completed', 'success'),
    /still be in progress/u,
  );
  const retentionTopology = {
    completionCommit: 'e'.repeat(40),
    completionMerge: 'f'.repeat(40),
  };
  assert.equal(requiresLiveSanitizedAuditArtifact(
    retentionTopology.completionCommit, retentionTopology,
  ), true);
  assert.equal(requiresLiveSanitizedAuditArtifact(
    retentionTopology.completionMerge, retentionTopology,
  ), true);
  assert.equal(requiresLiveSanitizedAuditArtifact('1'.repeat(40), retentionTopology), false,
    'later descendants must not depend on retained sanitized audit bytes');
  assert.equal(requiresHistoricalCompletionMergeAudit(
    retentionTopology.completionMerge, retentionTopology,
  ), false);
  assert.equal(requiresHistoricalCompletionMergeAudit(
    '1'.repeat(40), retentionTopology,
  ), true, 'later descendants must not bootstrap a skipped completion-merge audit');
  const completionAuditSteps = reusableAuditRequiredSteps.map(name => ({
    name,
    conclusion: name === 'Verify Round 7 C3 pull-request artifact' ? 'skipped' : 'success',
  }));
  assertReusableAuditStepLedger(
    completionAuditSteps, 'skipped', 'completion-merge audit self-test',
  );
  const reorderedCompletionAuditSteps = [...completionAuditSteps];
  [reorderedCompletionAuditSteps[4], reorderedCompletionAuditSteps[5]] = [
    reorderedCompletionAuditSteps[5], reorderedCompletionAuditSteps[4],
  ];
  assert.throws(() => assertReusableAuditStepLedger(
    reorderedCompletionAuditSteps, 'skipped', 'reordered completion-merge audit attack',
  ), /custom-step order/u);
  assert.throws(() => parseJsonStrict('{"passed":true,"passed":false}', 'duplicate report'),
    /duplicate object key/u);
  assert.throws(() => validatePassReport(
    '{"passed":true}', 'v082-chromium-390x844/report.json',
  ), /keys differ/u);
  assert.throws(() => validatePassReport(
    '{"passed":false}', 'v082-chromium-390x844/report.json',
  ), /not a PASS/u);
  const reports = reportBindings.map(item => item.artifactMember);
  const filler = Array.from({ length: 84 }, (_, index) => `screens/filler-${index}.png`);
  const valid = ['ci-provenance.json', ...reports, ...filler];
  assert.equal(valid.length, 95);
  validateArchiveInventory(valid, reportBindings);
  assert.throws(() => validateArchiveInventory([...valid.slice(0, -1), reports[0]], reportBindings),
    /duplicate member/u);
  assert.throws(() => validateArchiveInventory(
    ['screens/no-provenance.png', ...valid.slice(1)], reportBindings,
  ), /ci-provenance/u);
  assert.throws(() => validateArchiveInventory([...valid.slice(0, -1), '../escape'], reportBindings),
    /unsafe ZIP member/u);
  assert.throws(() => validateArchiveInventory(
    valid.map(name => name === reports[0] ? 'screens/no-report.png' : name), reportBindings,
  ), /report members/u);
  assert.throws(() => validateArchiveInventory(
    [...valid.slice(0, -1), 'ci-provenance.json'], reportBindings,
  ), /duplicate member/u);
  const expectedIdentity = {
    runId: 7,
    runAttempt: 1,
    event: 'push',
    headSha: 'a'.repeat(40),
  };
  assert.throws(() => validateProvenanceIdentity({
    runId: 8,
    runAttempt: 1,
    event: 'push',
    invocationCheckout: { sha: 'a'.repeat(40) },
  }, expectedIdentity), /runId differs/u);
  const providerArtifactFixture = {
    id: 91,
    name: expectedArtifactName(1),
    size_in_bytes: 123,
    digest: `sha256:${'b'.repeat(64)}`,
    expired: false,
    created_at: '2026-08-23T00:00:05Z',
    expires_at: '2099-08-23T00:00:05Z',
    workflow_run: {
      id: 77,
      head_sha: 'c'.repeat(40),
    },
  };
  const providerArtifactExpected = {
    runId: 77,
    runAttempt: 1,
    headSha: 'c'.repeat(40),
    jobStartedAt: Date.parse('2026-08-23T00:00:00Z'),
    jobCompletedAt: Date.parse('2026-08-23T00:00:10Z'),
  };
  validateProviderArtifact(providerArtifactFixture, providerArtifactExpected);
  assert.throws(() => validateProviderArtifact({
    ...providerArtifactFixture,
    name: 'wrong-artifact-from-the-same-run',
  }, providerArtifactExpected), /exact attempt-scoped name/u);
  const sanitizedName = expectedSanitizedAuditArtifactName(77, 1);
  validateSanitizedAuditArtifactIdentity({
    id: 91,
    name: sanitizedName,
    digest: `sha256:${'b'.repeat(64)}`,
    sizeBytes: 123,
  }, 77, 1, 'sanitized audit artifact self-test');
  assert.throws(() => validateSanitizedAuditArtifactIdentity({
    id: 91,
    name: expectedSanitizedAuditArtifactName(77, 2),
    digest: `sha256:${'b'.repeat(64)}`,
    sizeBytes: 123,
  }, 77, 1, 'sanitized audit artifact substitution self-test'), /exact same-run audit name/u);
  validateProviderArtifact({
    ...providerArtifactFixture,
    name: sanitizedName,
  }, {
    ...providerArtifactExpected,
    name: sanitizedName,
  });
  const frozenSanitizedIdentity = {
    id: providerArtifactFixture.id,
    name: sanitizedName,
    digest: providerArtifactFixture.digest,
    sizeBytes: providerArtifactFixture.size_in_bytes,
  };
  assertSanitizedArtifactMatchesFrozen({
    ...providerArtifactFixture,
    name: sanitizedName,
  }, frozenSanitizedIdentity);
  assert.throws(() => assertSanitizedArtifactMatchesFrozen({
    ...providerArtifactFixture,
    name: sanitizedName,
    digest: `sha256:${'9'.repeat(64)}`,
  }, frozenSanitizedIdentity), /frozen completion audit identity/u);
  assert.throws(
    () => validateProviderArtifact({
      ...providerArtifactFixture,
      name: expectedSanitizedAuditArtifactName(77, 2),
    }, {
      ...providerArtifactExpected,
      name: sanitizedName,
    }),
    /exact attempt-scoped name/u,
  );
  assert.throws(() => assertRound7EvidenceSubtreeBinding(
    'd'.repeat(40),
    'e'.repeat(40),
  ), /changed after the completion/u);
}

async function verifyArchive({ archiveBytes, repository, token, run, attempt, context, artifact, reportBindings }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'cats-step1-artifact-'));
  try {
    const archivePath = path.join(temporary, 'artifact.zip');
    await writeFile(archivePath, archiveBytes);
    const archiveNames = parseJsonStrict(execFileSync('python3', ['-c', [
      'import json,sys,zipfile',
      'with zipfile.ZipFile(sys.argv[1]) as z:',
      ' print(json.dumps(z.namelist()))',
    ].join('\n'), archivePath], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }), 'ZIP member list');
    validateArchiveInventory(archiveNames, reportBindings);
    for (const binding of reportBindings) {
      const reportBytes = execFileSync('unzip', ['-p', archivePath, binding.artifactMember], {
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
      });
      validatePassReport(reportBytes.toString('utf8'), binding.artifactMember);
    }

    const provenanceBytes = execFileSync('unzip', ['-p', archivePath, 'ci-provenance.json'], {
      encoding: null,
      maxBuffer: 16 * 1024 * 1024,
    });
    const provenance = parseJsonStrict(provenanceBytes.toString('utf8'), 'ci-provenance.json');
    exactKeys(provenance, [
      'schemaVersion', 'repository', 'workflowName', 'workflowPath', 'workflowRef', 'workflowCommitSha',
      'workflowBlobSha', 'generator', 'sourceBoundary', 'event', 'eventContext', 'runId', 'runNumber',
      'runAttempt', 'jobName', 'invocationCheckout', 'verificationKit', 'servedRuntime',
    ], 'provenance');
    exactKeys(provenance.eventContext, ['kind', 'pullRequest', 'push', 'workflowDispatch'], 'eventContext');
    exactKeys(provenance.invocationCheckout, ['sha', 'tree', 'ref'], 'invocationCheckout');
    exactKeys(provenance.verificationKit, ['mode', 'sha', 'tree'], 'verificationKit');
    exactKeys(provenance.servedRuntime, ['mode', 'sha', 'tree'], 'servedRuntime');
    assert.equal(provenance.schemaVersion, 1);
    assert.equal(provenance.repository, repository);
    assert.equal(provenance.workflowName, run.name);
    assert.equal(provenance.workflowPath, workflowPath);
    assert.match(provenance.workflowCommitSha, /^[a-f0-9]{40}$/u);
    assert.match(provenance.workflowBlobSha, /^[a-f0-9]{40}$/u);
    assert.equal(provenance.generator,
      'workflow-steps:Capture immutable invocation provenance+Finalize event-time CI provenance');
    assert.equal(provenance.sourceBoundary,
      'frozen-workflow-generated record; not a GitHub-signed attestation');
    assert.equal(provenance.event, run.event);
    assert.equal(provenance.runId, run.id);
    assert.equal(provenance.runNumber, run.run_number);
    assert.equal(provenance.runAttempt, attempt);
    assert.equal(provenance.jobName, 'vertical-tower-qa');
    assert.deepEqual(provenance.invocationCheckout, {
      sha: context.targetHead,
      tree: context.targetTree,
      ref: context.targetHead,
    });
    validateProvenanceIdentity(provenance, {
      runId: run.id,
      runAttempt: attempt,
      event: run.event,
      headSha: context.targetHead,
    });

    const workflowCommit = await githubApi(repository, token, `/git/commits/${provenance.workflowCommitSha}`);
    assert.equal(workflowCommit.sha, provenance.workflowCommitSha);
    const workflowTree = await githubApi(repository, token,
      `/git/trees/${workflowCommit.tree.sha}?recursive=1`);
    assert.equal(workflowTree.truncated, false);
    const workflowEntries = workflowTree.tree.filter(entry => (
      entry.path === workflowPath && entry.type === 'blob'
    ));
    assert.equal(workflowEntries.length, 1);
    assert.equal(workflowEntries[0].sha, provenance.workflowBlobSha);
    assert.equal(provenance.workflowBlobSha,
      git(['rev-parse', `${context.workflowAuthority}:${workflowPath}`]).trim(),
      'workflow blob must match the role-authoritative repository tree');

    if (context.pullRequest) {
      exactKeys(provenance.eventContext.pullRequest,
        ['number', 'baseBranch', 'baseSha', 'headBranch', 'headSha'], 'pullRequest');
      assert.equal(provenance.eventContext.kind, 'pull_request');
      assert.equal(provenance.eventContext.push, null);
      assert.equal(provenance.eventContext.workflowDispatch, null);
      const pullRequestNumber = provenance.eventContext.pullRequest.number;
      assert(Number.isSafeInteger(pullRequestNumber) && pullRequestNumber > 0,
        'pull-request number must be positive');
      assert.equal(provenance.workflowRef,
        `${repository}/${workflowPath}@refs/pull/${pullRequestNumber}/merge`);
      assert.equal(provenance.eventContext.pullRequest.baseBranch, 'main');
      assert.equal(provenance.eventContext.pullRequest.baseSha, context.expectedBaseOrBefore);
      assert.equal(provenance.eventContext.pullRequest.headBranch, run.head_branch);
      assert.equal(provenance.eventContext.pullRequest.headSha, context.targetHead);
      const eventBaseCommit = await githubApi(repository, token,
        `/git/commits/${provenance.eventContext.pullRequest.baseSha}`);
      assert.equal(eventBaseCommit.sha, provenance.eventContext.pullRequest.baseSha);
      assert.match(eventBaseCommit.tree.sha, /^[a-f0-9]{40}$/u);
    } else {
      assert.equal(provenance.workflowCommitSha, context.targetHead,
        'push workflow commit SHA must equal the exact target head');
      assert.equal(provenance.workflowRef, `${repository}/${workflowPath}@refs/heads/main`);
      exactKeys(provenance.eventContext.push, ['ref', 'before', 'after'], 'push');
      assert.equal(provenance.eventContext.kind, 'push');
      assert.equal(provenance.eventContext.pullRequest, null);
      assert.equal(provenance.eventContext.workflowDispatch, null);
      assert.equal(provenance.eventContext.push.ref, 'refs/heads/main');
      assert.equal(provenance.eventContext.push.after, context.targetHead);
      if (context.expectedBaseOrBefore) {
        assert.equal(provenance.eventContext.push.before, context.expectedBaseOrBefore);
      } else {
        assert.match(provenance.eventContext.push.before, /^[a-f0-9]{40}$/u);
        assert.notEqual(provenance.eventContext.push.before, context.targetHead);
        assert(gitIsAncestor(provenance.eventContext.push.before, context.targetHead),
          'future-main push.before must be an ancestor of push.after');
      }
    }
    assert.deepEqual(provenance.verificationKit, context.verificationKit);
    assert.deepEqual(provenance.servedRuntime, context.servedRuntime);
    return {
      artifactDigest: artifact.digest,
      provenanceSha256: sha256(provenanceBytes),
      verificationKit: provenance.verificationKit,
      servedRuntime: provenance.servedRuntime,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const [role, runIdText, attemptText] = process.argv.slice(2);
  assert(roles.has(role), `role must be one of: ${[...roles].join(', ')}`);
  assert.throws(() => parseJsonStrict('{"x":1,"x":2}', 'strict-parser-self-test'),
    /duplicate object key/u);
  const paginationFixture = Array.from({ length: 101 }, (_, index) => ({ id: index + 1 }));
  assert.equal(validatePaginatedPayloads([
    { total_count: 101, fixture: paginationFixture.slice(0, 100) },
    { total_count: 101, fixture: paginationFixture.slice(100) },
  ], 'fixture', 'pagination-self-test').length, 101);
  assert.throws(() => validatePaginatedPayloads([
    { total_count: 2, fixture: [{ id: 1 }, { id: 1 }] },
  ], 'fixture', 'duplicate-self-test'), /duplicate/u);
  const reportBindings = loadSealedRawReportManifest();
  runPureAdversarialSelfTests(reportBindings);
  if (role === 'self-test') {
    console.log(JSON.stringify({
      status: 'PASS',
      role,
      sealedReportBindings: reportBindings.length,
      adversarialFixtures: [
        'duplicate-json-key',
        'non-pass-report',
        'duplicate-zip-member',
        'missing-provenance',
        'unsafe-zip-member',
        'missing-report',
        'modified-provenance-binding',
        'wrong-artifact-from-same-run',
        'post-completion-evidence-modification',
        'mutable-current-verifier-pass-stub',
        'round7-workflow-blob-substitution-after-c1',
        'separate-workflow-run-cannot-bootstrap-round7',
        'historical-sanitized-audit-artifact-provider-binding',
        'completion-merge-skip-before-descendant',
      ],
    }, null, 2));
    return;
  }
  const runId = Number(runIdText);
  assert(Number.isSafeInteger(runId) && runId > 0, 'run ID must be a positive safe integer');
  const attempt = Number(attemptText);
  assert(Number.isSafeInteger(attempt) && attempt > 0, 'run attempt must be a positive safe integer');
  if (role === 'initial-main-seal' || role === 'future-main') {
    assert.equal(runId, Number(process.env.CATS_CALLER_RUN_ID),
      `${role} must verify the exact same-run caller ID`);
    assert.equal(attempt, Number(process.env.CATS_CALLER_RUN_ATTEMPT),
      `${role} must verify the exact same-run caller attempt`);
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  assert.equal(typeof token, 'string', 'GH_TOKEN or GITHUB_TOKEN is required');
  assert(token.length > 0 && !/[\u0000-\u001f\u007f]/u.test(token),
    'GH_TOKEN or GITHUB_TOKEN must be HTTP-header-safe');
  const repository = process.env.GITHUB_REPOSITORY || repositoryExpected;
  assert.equal(repository, repositoryExpected);

  const currentHead = git(['rev-parse', 'HEAD']).trim();
  const currentTree = git(['rev-parse', 'HEAD^{tree}']).trim();
  const context = resolveRoleContext(role, currentHead, currentTree, runId, attempt);
  const auditVerifierKit = assertVerifierExecutionAuthority(
    role, context, currentHead, currentTree,
  );

  const run = await githubApi(repository, token, `/actions/runs/${runId}/attempts/${attempt}`);
  assert.equal(run.id, runId);
  assert.equal(run.run_attempt, attempt);
  assert.equal(run.workflow_id, workflowId);
  assert.equal(run.name, workflowName);
  assert(workflowPathMatches(run.path, workflowPath),
    'workflow run path differs from the protected primary workflow path');
  assertPrimaryRunLifecycle(role, run.status, run.conclusion);
  assert.equal(run.event, context.pullRequest ? 'pull_request' : 'push');
  assert.equal(run.head_sha, context.targetHead);
  if (context.pullRequest) assert.equal(typeof run.head_branch, 'string');
  else assert.equal(run.head_branch, 'main');
  requireDate(run.run_started_at, 'primary run started_at');

  if (role === 'future-main') {
    context.initialExternalAudit = await findInitialExternalAudit(repository, token, context, run);
    if (requiresHistoricalCompletionMergeAudit(currentHead, context.topology)) {
      context.completionMergeAudit = await findCompletionMergeAudit(
        repository, token, context, run,
      );
    }
  }

  const jobsPayload = await githubPaginated(repository, token,
    `/actions/runs/${runId}/attempts/${attempt}/jobs`, 'jobs');
  const jobs = jobsPayload.filter(candidate => candidate.name === 'vertical-tower-qa');
  assert.equal(jobs.length, 1, 'exactly one matched vertical-tower-qa job is required');
  const job = jobs[0];
  assert.equal(job.run_id, runId);
  assert.equal(job.run_attempt, attempt);
  assert.equal(job.head_sha, run.head_sha);
  assert.equal(job.status, 'completed');
  assert.equal(job.conclusion, 'success');
  const jobStartedAt = requireDate(job.started_at, 'primary job started_at');
  const jobCompletedAt = requireDate(job.completed_at, 'primary job completed_at');
  assert(jobStartedAt < jobCompletedAt, 'primary job interval is invalid');
  if (context.fixed) assert.equal(job.id, context.fixed.jobId, `${role} job ID is frozen`);
  const stepMap = exactStepMap(job.steps, 'primary artifact job');
  const requiredSteps = [
    'Assert primary checkout provenance',
    'Capture immutable invocation provenance',
    'Resolve immutable Step 1 verification kit',
    'Finalize event-time CI provenance',
    'Repository handover and source contracts',
    'Vertical tower source and raster contracts',
    'Bind unexpired CI records and downloaded artifacts before seal',
    'GitHub recovery ref and live runtime manifest',
    'Chromium and WebKit vertical tower loop QA',
    'Attach captured CI provenance',
    'Upload V0.8.2 vertical tower evidence',
  ];
  if (context.requireRound6SmokeStep) {
    requiredSteps.push('Exercise repaired artifact transport against Round 6 provider artifacts');
  }
  for (const stepName of requiredSteps) {
    assert.equal(stepMap.get(stepName), 'success', `missing successful step: ${stepName}`);
  }
  if (context.expectRound6SmokeSkipped) {
    assert.equal(
      stepMap.get('Exercise repaired artifact transport against Round 6 provider artifacts'),
      'skipped',
      'historical future-main must skip the expiring Round 6 provider smoke',
    );
  }
  assert.equal(stepMap.get('Clean checkout of the immutable V0.8.2 commit'), context.cleanCheckout,
    'baseline checkout conclusion differs from role-specific expectation');

  const artifactsPayload = await githubPaginated(repository, token,
    `/actions/runs/${runId}/artifacts`, 'artifacts');
  const artifactName = expectedArtifactName(attempt);
  const artifacts = artifactsPayload.filter(candidate => candidate.name === artifactName);
  assert.equal(artifacts.length, 1,
    'exactly one artifact with the exact attempt-scoped name is required');
  const artifactExpectation = {
    runId,
    runAttempt: attempt,
    headSha: context.targetHead,
    jobStartedAt,
    jobCompletedAt,
  };
  const artifact = validateProviderArtifact(artifacts[0], artifactExpectation);
  if (context.fixed) {
    assert.equal(artifact.id, context.fixed.artifactId, `${role} artifact ID is frozen`);
    assert.equal(artifact.size_in_bytes, context.fixed.artifactSize, `${role} artifact size is frozen`);
    assert.equal(artifact.digest, context.fixed.artifactDigest, `${role} artifact digest is frozen`);
    assert.equal(artifact.created_at, context.fixed.artifactCreatedAt, `${role} artifact created_at is frozen`);
    assert.equal(artifact.expires_at, context.fixed.artifactExpiresAt, `${role} artifact expires_at is frozen`);
  }

  const exactArtifact = await githubApi(repository, token, `/actions/artifacts/${artifact.id}`);
  validateProviderArtifact(exactArtifact, artifactExpectation);
  for (const key of ['id', 'name', 'size_in_bytes', 'digest', 'expired', 'created_at', 'expires_at']) {
    assert.deepEqual(exactArtifact[key], artifact[key], `artifact metadata disagrees on ${key}`);
  }
  assert.deepEqual(exactArtifact.workflow_run, artifact.workflow_run,
    'artifact requery workflow_run metadata differs from the run artifact listing');

  const archiveBytes = assertArtifactArchiveBinding(
    await downloadGithubArtifactArchive({
      repository,
      artifactId: artifact.id,
      token,
      timeoutMs: 120_000,
    }),
    { expectedSize: artifact.size_in_bytes, expectedDigest: artifact.digest },
  );
  const archiveResult = await verifyArchive({
    archiveBytes,
    repository,
    token,
    run,
    attempt,
    context,
    artifact,
    reportBindings,
  });
  console.log(JSON.stringify({
    status: 'PASS',
    role,
    runId: run.id,
    runAttempt: attempt,
    jobId: job.id,
    artifactId: artifact.id,
    event: run.event,
    headSha: run.head_sha,
    artifactDigest: archiveResult.artifactDigest,
    provenanceSha256: archiveResult.provenanceSha256,
    verificationKit: archiveResult.verificationKit,
    servedRuntime: archiveResult.servedRuntime,
    auditVerifierKit,
    initialExternalAudit: context.initialExternalAudit,
    completionMergeAudit: context.completionMergeAudit,
  }, null, 2));
}

function sanitizedFailure(error) {
  const requestedRole = process.argv[2];
  const role = roles.has(requestedRole) ? requestedRole : null;
  const parsedRunId = Number(process.argv[3]);
  const parsedAttempt = Number(process.argv[4]);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  let message = error instanceof Error ? error.message : 'Artifact verification failed';
  if (token) message = message.split(token).join('[REDACTED]');
  message = message
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[REDACTED_URL]')
    .replace(/(?:authorization|bearer|token)\s*[:=]?\s*[^\s,;]+/giu, '[REDACTED_CREDENTIAL]')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .slice(0, 320);
  const rawCode = error && typeof error === 'object' ? error.code : null;
  const errorCode = typeof rawCode === 'string' && /^[A-Z0-9_]{1,64}$/u.test(rawCode)
    ? rawCode
    : 'VERIFICATION_FAILED';
  return {
    status: 'FAIL',
    role,
    runId: Number.isSafeInteger(parsedRunId) && parsedRunId > 0 ? parsedRunId : null,
    runAttempt: Number.isSafeInteger(parsedAttempt) && parsedAttempt > 0 ? parsedAttempt : null,
    errorCode,
    message,
  };
}

main().catch(error => {
  console.log(JSON.stringify(sanitizedFailure(error), null, 2));
  process.exitCode = 1;
});
