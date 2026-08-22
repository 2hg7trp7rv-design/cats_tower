#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(process.env.CATS_REPO_ROOT || kitRoot);
const targetRoot = path.resolve(process.env.CATS_BASELINE_DIR || kitRoot);
const baselineCommit = '727b8d00c281e7539117da5ded7309ea01c7e516';
const baselineTree = 'c508c58b0bb1b3fa591eefe143aab2dd6eac9271';
const archiveRef = 'refs/heads/archive/v0.8.2-legacy-baseline';
const failedRoundThreeCommit = '830b32d4b0d26abebe7354b8db9d8dd3b21c203f';
const failedRoundThreeTree = 'e45815ef4f17496019a2442ef5dbe958ecdb2768';
const failedRoundThreeAcceptancePath = 'quality-reviews/step-1-legacy-baseline/acceptance-round-003.json';
const failedRoundThreeAcceptanceBlob = '347ddd8cae160364835a043a45376b6ac6b97888';
const failedRoundThreeAcceptanceSha256 = '1c7bcb9f2e71f27e3a03de2e85ef3ea16e89be0f736a4e6aa52842c66f0d4100';
const failedRoundThreePath = 'quality-reviews/step-1-legacy-baseline/round-003.json';
const failedRoundFourCommit = '44696c97be9d6206775cbf317a5b3d28fdeff37b';
const failedRoundFourTree = '0e7022e0ea1ae4f5c47560ae2177344049dc8e0b';
const failedRoundFourAcceptancePath = 'quality-reviews/step-1-legacy-baseline/acceptance-round-004.json';
const failedRoundFourAcceptanceBlob = '0f0f0427aac16ce615ed33317504b9912e8d7f81';
const failedRoundFourAcceptanceSha256 = '9336daac146f2d03dc590137c5c0504e8ca188ffbfa7d5edf54bcac5d36fe055';
const failedRoundFourPath = 'quality-reviews/step-1-legacy-baseline/round-004.json';
const failedRoundFourSha256 = '21146088494f258a12ca5fb1e0229c0cd0a9c2791545dcd8f9f203423cdf4898';
const failedRoundFiveCommit = 'cfebec0c546478f8dc7a6af9476d795205e52002';
const failedRoundFiveTree = '8c2a7bce08f1dcb69298a664534cddd69e3543ef';
const failedRoundFiveAcceptancePath = 'quality-reviews/step-1-legacy-baseline/acceptance-round-005.json';
const failedRoundFiveAcceptanceBlob = '4542c9f40bb273f62c70b06a262732c8e6639710';
const failedRoundFiveAcceptanceSha256 = 'fd99d20bd74ebe0a6e1addc3ecd2c40df85e7825ed5e73c5747c27d14868f14c';
const failedRoundFivePath = 'quality-reviews/step-1-legacy-baseline/round-005.json';
const sealRoundPath = 'quality-reviews/step-1-legacy-baseline/round-006.json';
const futureImmutablePaths = [
  '.github/baselines/v0.8.2',
  'quality-reviews/step-1-legacy-baseline',
];
const futureRequiredQualityGateClaims = [
  'この規則は、仕様書、調査、画像、画面、コード、QA、配信など、ユーザーへ成果として渡す全作業へ適用する。',
  '3. **実物を自己検収する**',
  '4. **反証する**',
  '一つでも不合格なら`IN_PROGRESS`へ戻し、失敗原因を次のAcceptanceへ加えて手順1から再構成する。',
  '`PASS`時だけ完成報告する。未完成時は完成したように表現しない。',
  'それ以外は内部で①〜④を繰り返し、合格後にまとめて報告する。',
  'ユーザーが品質を否認した場合は旧判定を守らず、直ちに`IN_PROGRESS`へ戻して次roundの失敗条件へ反映する。',
];
const futureCanonicalPaths = [
  'README.md', 'AGENTS.md', 'MASTER_SPEC.md', 'FLOORS_1_10_DESIGN.md', 'PROJECT_HANDOVER.md', 'BASELINE_V082.md',
];
const live = process.argv.includes('--live');
const remote = process.argv.includes('--remote');
const preflight = process.argv.includes('--preflight');

function parseJsonStrict(text, label = 'JSON') {
  assert.equal(typeof text, 'string', `${label} must be UTF-8 text`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }

  let index = 0;
  const fail = message => {
    throw new Error(`${label} has an ambiguous JSON representation at byte ${Buffer.byteLength(text.slice(0, index), 'utf8')}: ${message}`);
  };
  const skipWhitespace = () => {
    while (index < text.length && /\s/u.test(text[index])) index += 1;
  };
  const consume = expected => {
    if (text[index] !== expected) fail(`expected ${JSON.stringify(expected)}`);
    index += 1;
  };
  const scanString = () => {
    const start = index;
    consume('"');
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      index += 1;
    }
    fail('unterminated string');
  };
  const scanValue = location => {
    skipWhitespace();
    const token = text[index];
    if (token === '{') {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      while (index < text.length) {
        skipWhitespace();
        if (text[index] !== '"') fail(`expected an object key at ${location}`);
        const key = scanString();
        if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)} at ${location}`);
        keys.add(key);
        skipWhitespace();
        consume(':');
        scanValue(`${location}.${key}`);
        skipWhitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        consume(',');
      }
      fail(`unterminated object at ${location}`);
    }
    if (token === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      let arrayIndex = 0;
      while (index < text.length) {
        scanValue(`${location}[${arrayIndex}]`);
        arrayIndex += 1;
        skipWhitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        consume(',');
      }
      fail(`unterminated array at ${location}`);
    }
    if (token === '"') {
      scanString();
      return;
    }
    const primitive = text.slice(index).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/u);
    if (!primitive) fail(`invalid value at ${location}`);
    index += primitive[0].length;
  };

  scanValue('$');
  skipWhitespace();
  if (index !== text.length) fail('trailing content');
  return parsed;
}

assert.deepEqual(parseJsonStrict('{"outer":{"key":1},"items":[true,null]}', 'strict JSON self-test'), {
  outer: { key: 1 },
  items: [true, null],
});
assert.throws(
  () => parseJsonStrict('{"key":1,"key":2}', 'strict JSON duplicate-key self-test'),
  /duplicate object key/u,
);
assert.throws(
  () => parseJsonStrict('{"key":1,"\\u006bey":2}', 'strict JSON escaped-key self-test'),
  /duplicate object key/u,
);

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: targetRoot,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function kitGit(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function pathIntroductionCommits(commitRows, pathExistsAtCommit) {
  return commitRows
    .filter(([commit, ...parents]) => pathExistsAtCommit(commit) && parents.every(parent => !pathExistsAtCommit(parent)))
    .map(([commit]) => commit)
    .sort();
}

function reachablePathIntroductions(relativePath) {
  const commitRows = kitGit(['rev-list', '--parents', 'HEAD']).trim().split('\n').filter(Boolean)
    .map(row => row.trim().split(/\s+/u));
  return pathIntroductionCommits(commitRows, commit => gitPathExists(commit, relativePath));
}

// Round 7 deliberately supersedes the current-status authority of Round 6
// without rewriting a byte of the sealed Round 6 evidence.  Keep this layer
// ahead of the historical Round 6 descendant guard below.  The historical
// verifier is still executed, but only from the exact Round 6 C3 bytes and
// against the exact Round 6 merge context; it must never evaluate a Round 7
// descendant with Round 6's obsolete immutable-status policy.
const round7AcceptancePath = 'quality-reviews/step-1-legacy-baseline-round-007/acceptance-round-007.json';
const round7EvidenceRoot = 'quality-reviews/step-1-legacy-baseline-round-007';
const round7FailurePath = 'quality-reviews/step-1-legacy-baseline-round-007/round-006-post-main-failure.json';
const round7RecordPath = 'quality-reviews/step-1-legacy-baseline-round-007/round-007.json';
const round7CompletionPath = 'quality-reviews/step-1-legacy-baseline-round-007/completion.json';
const round7ExternalAuditPath = 'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-initial-external-audit.json';
const round7BaseCommit = '88daf9c912fa726e019915e5d7bfed94f0a47158';
const round7BaseTree = '1aeba9e915990e56a8d777e7b90cd94d4755c7fb';
const round6C3Commit = '1f552aae0afe3c935a33122b15f85e20708aabc2';
const round6EvidencePath = 'quality-reviews/step-1-legacy-baseline';
const round6EvidenceTree = 'c0a5b81aeca8ec1f034b920774321f4728caac4e';
const baselineSnapshotPath = '.github/baselines/v0.8.2';
const baselineSnapshotTree = 'c59e35e51ad2d35ae8304bb9d5e5b921101911c3';
const round7CanonicalMarkdownPaths = [
  'AGENTS.md',
  'README.md',
  'BASELINE_V082.md',
  'MASTER_SPEC.md',
  'FLOORS_1_10_DESIGN.md',
  'PROJECT_HANDOVER.md',
  'QUALITY_GATE.md',
];
const round7Repository = '2hg7trp7rv-design/cats_tower';
const round7PrimaryWorkflowId = 335561992;
const round7ReusableAuditJobName = 'round7-external-artifact-audit / round7-external-artifact-audit';
const round7ReusableAuditRequiredSteps = [
  'Bind same-run primary workflow caller',
  'Initialize sanitized audit records',
  'Assert sanitized verifier result boundary',
  'Resolve Round 7 seal, audit mode, and exact C3 run',
  'Verify Round 7 C3 pull-request artifact',
  'Verify source main artifact',
  'Validate sanitized audit upload boundary',
  'Upload sanitized external audit evidence',
  'Aggregate Round 7 external audit gate',
];
const round7WorkflowPaths = [
  '.github/workflows/verify-main.yml',
  '.github/workflows/verify-step-1-artifacts.yml',
];
const round7SealedValidatorDependencyPaths = [
  'tests/verify-step-1-baseline.mjs',
];
const round7ExternalVerifierDependencyPaths = [
  'tests/verify-ci-artifact.mjs',
  'tests/artifact-download-transport.mjs',
];
const round7C1TrustRootBlobPaths = [
  ...round7WorkflowPaths,
  ...round7SealedValidatorDependencyPaths,
  ...round7ExternalVerifierDependencyPaths,
];
const round7NextActionByStatus = {
  IN_PROGRESS: 'complete-step-1-round-7-external-audit-and-completion-seal',
  PASS: 'revalidate-100f-master-specification',
};
const round7ExpectedC1Paths = [
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
  round7AcceptancePath,
  round7FailurePath,
  'tests/artifact-download-transport.mjs',
  'tests/artifact-download-transport.test.mjs',
  'tests/verify-ci-artifact.mjs',
  'tests/verify-step-1-baseline.mjs',
];
const round7ExpectedC2Paths = [
  'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-adversarial-critic.json',
  'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-repository-critic.json',
  'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-runtime-critic.json',
  'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-artifact-download-smoke.json',
  'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-c1-ci-run.json',
];
const round7ExpectedC3Paths = [
  'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-final-judge.json',
  'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-c2-ci-run.json',
  round7RecordPath,
];
const round7ExpectedCompletionPaths = [
  'AGENTS.md',
  'BASELINE_V082.md',
  'FLOORS_1_10_DESIGN.md',
  'MASTER_SPEC.md',
  'PROJECT_HANDOVER.md',
  'PROJECT_STATUS.json',
  'QUALITY_GATE.md',
  'README.md',
  round7CompletionPath,
  round7ExternalAuditPath,
];
const round7ExpectedCompletionTransforms = {
  canonicalMarkdown: {
    paths: [
      'AGENTS.md',
      'BASELINE_V082.md',
      'FLOORS_1_10_DESIGN.md',
      'MASTER_SPEC.md',
      'PROJECT_HANDOVER.md',
      'QUALITY_GATE.md',
      'README.md',
    ],
    exactReplacements: [
      {
        from: '工程状態: 工程1A=IN_PROGRESS / 工程2=PENDING_REVALIDATION / 工程3=PENDING_REVALIDATION / 工程4以降=NOT_STARTED',
        to: '工程状態: 工程1A=PASS / 工程2=PENDING_REVALIDATION / 工程3=PENDING_REVALIDATION / 工程4以降=NOT_STARTED',
        requiredCount: 1,
      },
      {
        from: '1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — `IN_PROGRESS`',
        to: '1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — `PASS`',
        requiredCount: 1,
      },
    ],
    result: 'full-byte-equality-with-c3-after-only-the-exact-replacements',
  },
  projectStatus: [
    {
      pointer: '/documentationBranch',
      from: 'codex/restart-step-1-round7',
      to: 'main',
    },
    {
      pointer: '/preparation/0/status',
      from: 'IN_PROGRESS',
      to: 'PASS',
    },
    {
      pointer: '/step1Round7/status',
      from: 'IN_PROGRESS',
      to: 'PASS',
    },
    {
      pointer: '/step1Round7/externalAudit/state',
      from: 'PENDING',
      to: 'PASS',
    },
    {
      pointer: '/step1Round7/completionSeal/state',
      from: 'PENDING',
      to: 'PASS',
    },
    {
      pointer: '/nextAction',
      from: 'complete-step-1-round-7-external-audit-and-completion-seal',
      to: 'revalidate-100f-master-specification',
    },
  ],
  projectStatusResult: 'deep-equality-with-c3-after-only-the-exact-json-pointer-transforms',
  completionReportAllowedAtCommit: false,
  allOtherCanonicalBytes: 'unchanged-from-c3',
};
const round7ExpectedCommitProtocol = {
  c1: 'single-parent direct child of baseCommit; exact c1AllowedPaths; canonical Step 1A status is IN_PROGRESS; this final Acceptance and its validator and workflow blobs become the immutable Round 7 trust root',
  c2: 'single-parent direct child of C1; exact c2AllowedPaths; records exact-head C1 CI, real-provider transport smoke, and three independent critics; status remains IN_PROGRESS',
  c3: 'single-parent direct child of C2; exact c3AllowedPaths; records exact-head C2 CI and a separate final judge; round status is EXTERNAL_PENDING and canonical status remains IN_PROGRESS',
  initialMerge: 'exact two-parent [baseCommit,C3] merge whose tree equals C3; squash and rebase are forbidden',
  completion: 'after a successful provider-bound Round 7 initial external audit, a single-parent commit on the exact initial merge may add the two completion records and apply only completionTransforms to the canonical documents; every other canonical byte remains equal to C3',
  completionMerge: 'exact two-parent [initialMerge,completion] merge whose tree equals the completion commit; final reporting additionally requires its main CI and future-main external audit to succeed',
};
const round7ArtifactKeys = ['id', 'name', 'digest', 'sizeBytes'];
const round7CiRecordKeys = [
  'schemaVersion', 'artifactId', 'role', 'repository', 'workflowId', 'runId', 'runAttempt',
  'jobId', 'headSha', 'headTree', 'status', 'conclusion', 'artifact', 'materialBlockers',
];
const round7CriticRecordKeys = [
  'schemaVersion', 'artifactId', 'role', 'reviewTargetCommit', 'reviewTargetTree',
  'reviewedAcceptanceSha256', 'reviewedCiRunId', 'reviewedCiRunAttempt', 'reviewedCiJobId',
  'reviewedCiArtifact', 'verdict', 'materialBlockers', 'method', 'findings',
];
const round7SmokeTargetKeys = [
  'role', 'runId', 'runAttempt', 'jobId', 'artifact', 'firstHopStatus', 'secondHopStatus',
  'storageAuthorizationSent', 'archiveMemberCount', 'provenanceMemberCount',
  'passReportCount', 'result',
];
const round7KnownSmokeTargets = {
  'round6-c3': {
    runId: 32590094723,
    runAttempt: 1,
    jobId: 97072452889,
    artifact: {
      id: 9480141426,
      name: 'cats-v082-step-1-recovery-evidence-attempt-1',
      digest: 'sha256:52ff79cc991857c162545f7a0581d65835afe38b48f00aa6f4d5104d6fd97e4a',
      sizeBytes: 71594452,
    },
  },
  'round6-main': {
    runId: 32590658257,
    runAttempt: 1,
    jobId: 97073864631,
    artifact: {
      id: 9480288219,
      name: 'cats-v082-step-1-recovery-evidence-attempt-1',
      digest: 'sha256:93bf04404c93bd131d68e2e39658571a6772eb8778787aae9577c67d7d5149c1',
      sizeBytes: 71609224,
    },
  },
};

function round7Git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function round7GitPathExists(commit, relativePath) {
  try {
    round7Git(['cat-file', '-e', `${commit}:${relativePath}`]);
    return true;
  } catch {
    return false;
  }
}

function round7CommitRows(head = 'HEAD') {
  return round7Git(['rev-list', '--parents', head]).trim().split('\n').filter(Boolean)
    .map(row => row.trim().split(/\s+/u));
}

function round7Introductions(relativePath, head = 'HEAD') {
  return pathIntroductionCommits(
    round7CommitRows(head),
    commit => round7GitPathExists(commit, relativePath),
  );
}

function round7SingleParent(commit, label) {
  const row = round7Git(['rev-list', '--parents', '-n', '1', commit]).trim().split(/\s+/u);
  assert.equal(row.length, 2, `${label} must be a single-parent commit`);
  return row[1];
}

function round7ChangedEntries(parent, child) {
  const fields = round7Git([
    'diff-tree', '--no-commit-id', '-r', '--name-status', '--no-renames', '-z', parent, child,
  ], null).toString('utf8').split('\0').filter(Boolean);
  assert.equal(fields.length % 2, 0, 'Round 7 name-status output has an unexpected shape');
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    entries.push({ status: fields[index], path: fields[index + 1] });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function round7ExpectedEntries(parent, paths) {
  return [...paths].map(relativePath => ({
    status: round7GitPathExists(parent, relativePath) ? 'M' : 'A',
    path: relativePath,
  })).sort((left, right) => left.path.localeCompare(right.path));
}

function round7AssertExactEntryContract(actualEntries, expectedEntries, label) {
  assert.deepEqual(
    actualEntries,
    expectedEntries,
    `${label} differs from its exact path/addition-modification contract`,
  );
}

function round7AssertExactEdge(parent, child, paths, label) {
  round7AssertExactEntryContract(
    round7ChangedEntries(parent, child),
    round7ExpectedEntries(parent, paths),
    label,
  );
  for (const relativePath of paths) {
    const row = round7Git(['ls-tree', child, '--', relativePath]).trim().split(/\s+/u);
    assert.equal(row[0], '100644', `${label} does not contain a regular file at ${relativePath}`);
  }
}

function round7GitAt(root, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function round7BlobBindingsAt(root, commit, relativePaths) {
  return relativePaths.map(relativePath => ({
    path: relativePath,
    blob: round7GitAt(root, ['rev-parse', `${commit}:${relativePath}`]).trim(),
  }));
}

function round7AssertFrozenBlobBindings(commit, expectedBindings, currentBindings, label) {
  assert.deepEqual(
    currentBindings,
    expectedBindings,
    `${commit} changed the C1-sealed ${label} blobs`,
  );
}

function round7AssertTrustRootBlobsFrozen(c1, commit) {
  round7AssertFrozenBlobBindings(
    commit,
    round7BlobBindingsAt(repoRoot, c1, round7C1TrustRootBlobPaths),
    round7BlobBindingsAt(repoRoot, commit, round7C1TrustRootBlobPaths),
    'validator/workflow trust-root',
  );
}

function round7AssertPrimaryWorkflowTrustContract(c1 = null) {
  const workflow = c1
    ? round7Git(['show', `${c1}:.github/workflows/verify-main.yml`], 'utf8')
    : readFileSync(path.join(repoRoot, '.github/workflows/verify-main.yml'), 'utf8');
  assert.deepEqual(
    [...workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length).matchAll(/^  ([a-z0-9-]+):\s*$/gmu)].map(match => match[1]),
    ['vertical-tower-qa', 'round7-external-audit'],
    'C1 primary workflow must contain exactly the primary and same-run reusable audit jobs',
  );
  const orderedMarkers = [
    '      - name: Resolve immutable Step 1 verification kit',
    '      - name: Clean checkout of the immutable V0.8.2 commit',
    '      - uses: actions/setup-node@v4',
    '      - name: GitHub recovery ref and live runtime manifest',
    '      - uses: actions/setup-python@v5',
    '      - name: Repository handover and source contracts',
    '      - name: Exercise repaired artifact transport against Round 6 provider artifacts',
  ];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    assert.equal(round7ExactLineCount(workflow, marker), 1, `C1 primary workflow must contain exactly one ${marker.trim()} marker`);
    const markerIndex = workflow.indexOf(marker);
    assert(markerIndex > previousIndex, `C1 primary workflow trust-root step order is invalid at ${marker.trim()}`);
    previousIndex = markerIndex;
  }
  for (const token of [
    'CI_WORKFLOW_COMMIT_SHA: ${{ github.workflow_sha }}',
    'WORKFLOW_BLOB_SHA=$(git rev-parse "$CI_WORKFLOW_COMMIT_SHA:.github/workflows/verify-main.yml")',
    '  vertical-tower-qa:\n    name: vertical-tower-qa',
    '  round7-external-audit:\n    name: round7-external-artifact-audit',
    '    needs: vertical-tower-qa',
    "    if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && needs['vertical-tower-qa'].result == 'success' }}",
    '    uses: ./.github/workflows/verify-step-1-artifacts.yml',
    '      source_run_id: ${{ fromJSON(github.run_id) }}',
    '      source_run_attempt: ${{ fromJSON(github.run_attempt) }}',
    '      source_head_sha: ${{ github.sha }}',
    '      source_event: ${{ github.event_name }}',
    '      source_ref: ${{ github.ref }}',
    'BASE=88daf9c912fa726e019915e5d7bfed94f0a47158',
    'VALIDATOR_PATH="$RUNNER_TEMP/sealed-step1-round7-c1"',
    'KIT="$RUNNER_TEMP/sealed-step1-round7-completion"',
    'KIT_MODE=current-round7-c1',
    'KIT_MODE=sealed-round7-c1',
    'RUNTIME_MODE=immutable-baseline-checkout',
    'RUNTIME_MODE=sealed-round7-completion-runtime',
    '          if [ "$HISTORICAL_STEP1_MODE" = "true" ]; then\n            env "${VALIDATOR_ENV[@]}" node tests/verify-step-1-baseline.mjs --remote\n          else\n            env "${VALIDATOR_ENV[@]}" node tests/verify-step-1-baseline.mjs --remote --live\n          fi',
  ]) {
    assert(workflow.includes(token), `C1 primary workflow is missing trust-root token: ${token}`);
  }
  assert.equal(
    workflow.includes('$GITHUB_WORKSPACE/sealed-step1-round7'),
    false,
    'C1 primary workflow may not create sealed Step 1 worktrees inside the mutable target workspace',
  );

  const externalWorkflow = c1
    ? round7Git(['show', `${c1}:.github/workflows/verify-step-1-artifacts.yml`], 'utf8')
    : readFileSync(path.join(repoRoot, '.github/workflows/verify-step-1-artifacts.yml'), 'utf8');
  assert.deepEqual(
    [...externalWorkflow.slice(externalWorkflow.indexOf('\njobs:\n') + '\njobs:\n'.length).matchAll(/^  ([a-z0-9-]+):\s*$/gmu)].map(match => match[1]),
    ['verify-sealed-artifacts'],
    'C1 reusable audit workflow must contain exactly one sealed artifact verification job',
  );
  const externalMarkers = [
    '      - name: Bind same-run primary workflow caller',
    '      - name: Initialize sanitized audit records',
    '      - name: Assert sanitized verifier result boundary',
    '      - name: Resolve Round 7 seal, audit mode, and exact C3 run',
    '      - name: Verify Round 7 C3 pull-request artifact',
    '      - name: Verify source main artifact',
    '      - name: Validate sanitized audit upload boundary',
    '      - name: Upload sanitized external audit evidence',
    '      - name: Aggregate Round 7 external audit gate',
  ];
  let previousExternalIndex = -1;
  for (const marker of externalMarkers) {
    assert.equal(round7ExactLineCount(externalWorkflow, marker), 1, `C1 external workflow must contain exactly one ${marker.trim()} marker`);
    const markerIndex = externalWorkflow.indexOf(marker);
    assert(markerIndex > previousExternalIndex, `C1 external workflow trust-root step order is invalid at ${marker.trim()}`);
    previousExternalIndex = markerIndex;
  }
  assert.deepEqual(
    [...externalWorkflow.matchAll(/^      - name: (.+)$/gmu)].map(match => match[1]),
    round7ReusableAuditRequiredSteps,
    'C1 reusable audit workflow named steps differ from the exact provider ledger contract',
  );
  assert.equal(
    [...externalWorkflow.matchAll(/^      - (?:name:|uses:)/gmu)].length,
    round7ReusableAuditRequiredSteps.length + 2,
    'C1 reusable audit workflow must contain exactly checkout, setup-node, and the nine named audit steps',
  );
  const workflowCallStart = externalWorkflow.indexOf('  workflow_call:\n');
  const inputsStart = externalWorkflow.indexOf('    inputs:\n', workflowCallStart);
  const outputsStart = externalWorkflow.indexOf('    outputs:\n', inputsStart);
  const permissionsStart = externalWorkflow.indexOf('\npermissions:\n', outputsStart);
  assert(workflowCallStart >= 0 && inputsStart > workflowCallStart && outputsStart > inputsStart && permissionsStart > outputsStart);
  const workflowCallInputKeys = [
    ...externalWorkflow.slice(inputsStart, outputsStart).matchAll(/^      ([a-z0-9_]+):$/gmu),
  ].map(match => match[1]);
  const workflowCallOutputKeys = [
    ...externalWorkflow.slice(outputsStart, permissionsStart).matchAll(/^      ([a-z0-9_]+):$/gmu),
  ].map(match => match[1]);
  assert.deepEqual(workflowCallInputKeys, [
    'source_run_id', 'source_run_attempt', 'source_head_sha', 'source_event', 'source_ref',
  ], 'C1 reusable audit workflow_call inputs differ from the exact source-bound interface');
  assert.deepEqual(workflowCallOutputKeys, [
    'audit_mode', 'source_run_id', 'source_run_attempt', 'source_head_sha', 'source_event', 'source_ref',
    'sanitized_artifact_name', 'sanitized_artifact_id', 'sanitized_artifact_digest',
  ], 'C1 reusable audit workflow_call outputs differ from the exact sanitized interface');
  const reusableJobStart = externalWorkflow.indexOf('  verify-sealed-artifacts:\n');
  const reusableOutputsStart = externalWorkflow.indexOf('    outputs:\n', reusableJobStart);
  const reusableStepsStart = externalWorkflow.indexOf('    steps:\n', reusableOutputsStart);
  assert(reusableJobStart >= 0 && reusableOutputsStart > reusableJobStart && reusableStepsStart > reusableOutputsStart);
  assert.deepEqual(
    [...externalWorkflow.slice(reusableOutputsStart, reusableStepsStart).matchAll(/^      ([a-z0-9_]+):/gmu)]
      .map(match => match[1]),
    workflowCallOutputKeys,
    'C1 reusable audit job outputs differ from the workflow_call output interface',
  );
  const callerWithStart = workflow.indexOf('    with:\n', workflow.indexOf('  round7-external-audit:\n'));
  assert(callerWithStart >= 0, 'C1 primary reusable caller has no with interface');
  assert.deepEqual(
    [...workflow.slice(callerWithStart).matchAll(/^      ([a-z0-9_]+):/gmu)].map(match => match[1]),
    ['source_run_id', 'source_run_attempt', 'source_head_sha', 'source_event', 'source_ref'],
    'C1 primary reusable caller inputs differ from the exact source-bound interface',
  );
  for (const token of [
    '  workflow_call:',
    '      source_run_id:',
    '      source_run_attempt:',
    '      source_head_sha:',
    '      source_event:',
    '      source_ref:',
    '    name: round7-external-artifact-audit',
    'CALLER_WORKFLOW_SHA: ${{ github.workflow_sha }}',
    'C1_WORKTREE="$RUNNER_TEMP/cats-round7-c1-verifier"',
    'RESULT_DIR="$RUNNER_TEMP/cats-step1-external-audit-results"',
  ]) {
    assert(externalWorkflow.includes(token), `C1 external workflow is missing trust-root token: ${token}`);
  }
  assert.equal(round7ExactLineCount(externalWorkflow, '  workflow_run:'), 0, 'C1 external authority may not use a separate workflow_run trigger');
}

function round7AssertSealedValidatorInvocation(head, c1) {
  const c1Tree = round7Git(['rev-parse', `${c1}^{tree}`]).trim();
  const resolvedKitRoot = realpathSync(kitRoot);
  const resolvedRepoRoot = realpathSync(repoRoot);
  const kitHead = round7GitAt(resolvedKitRoot, ['rev-parse', 'HEAD']).trim();
  const kitTree = round7GitAt(resolvedKitRoot, ['rev-parse', 'HEAD^{tree}']).trim();
  assert.equal(round7GitAt(resolvedKitRoot, ['rev-parse', '--is-shallow-repository']).trim(), 'false', 'C1 sealed validator kit requires full Git history');
  assert.equal(round7GitAt(resolvedKitRoot, ['replace', '-l']).trim(), '', 'C1 sealed validator kit forbids Git replace refs');
  assert.equal(kitHead, c1, 'C1 sealed validator kit HEAD does not equal the unique C1 authority');
  assert.equal(kitTree, c1Tree, 'C1 sealed validator kit tree does not equal the unique C1 authority tree');
  if (head === c1) {
    assert.equal(resolvedKitRoot, resolvedRepoRoot, 'C1 itself must run the validator from the current exact checkout');
  } else {
    assert.notEqual(resolvedKitRoot, resolvedRepoRoot, 'post-C1 validation must run from a separate sealed C1 worktree');
    assert.throws(
      () => round7GitAt(resolvedKitRoot, ['symbolic-ref', '-q', 'HEAD']),
      'post-C1 sealed validator worktree must be detached',
    );
  }
  for (const relativePath of round7SealedValidatorDependencyPaths) {
    const expectedBlob = round7Git(['rev-parse', `${c1}:${relativePath}`]).trim();
    assert.equal(
      round7GitAt(resolvedKitRoot, ['rev-parse', `HEAD:${relativePath}`]).trim(),
      expectedBlob,
      `sealed validator dependency Git blob differs from C1: ${relativePath}`,
    );
    assert.equal(
      round7GitAt(resolvedKitRoot, ['hash-object', relativePath]).trim(),
      expectedBlob,
      `sealed validator dependency worktree bytes differ from C1: ${relativePath}`,
    );
  }
}

function round7ReadCommitJson(commit, relativePath, label = relativePath) {
  return parseJsonStrict(round7Git(['show', `${commit}:${relativePath}`], 'utf8'), label);
}

function round7ReadCommitJsonAt(root, commit, relativePath, label = relativePath) {
  return parseJsonStrict(round7GitAt(root, ['show', `${commit}:${relativePath}`], 'utf8'), label);
}

function round7AssertExactKeys(value, expectedKeys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort(), `${label} keys differ from the frozen Round 7 schema`);
}

function round7AssertAcceptanceFrozen(c1Bytes, headBytes) {
  assert(Buffer.isBuffer(c1Bytes), 'Round 7 C1 Acceptance authority must be raw bytes');
  assert(Buffer.isBuffer(headBytes), 'Round 7 HEAD Acceptance must be raw bytes');
  assert.equal(
    headBytes.equals(c1Bytes),
    true,
    `Round 7 Acceptance raw bytes changed after C1: C1=${createHash('sha256').update(c1Bytes).digest('hex')} HEAD=${createHash('sha256').update(headBytes).digest('hex')}`,
  );
}

function round7AssertEvidenceTreeFrozen(completionTree, headTree) {
  assert.match(completionTree, /^[a-f0-9]{40}$/u, 'Round 7 completion evidence tree is not a Git SHA-1');
  assert.match(headTree, /^[a-f0-9]{40}$/u, 'Round 7 HEAD evidence tree is not a Git SHA-1');
  assert.equal(headTree, completionTree, 'Round 7 evidence subtree changed after completion');
}

function round7AssertFrozenPathLists(authority) {
  assert.deepEqual([...authority.c1AllowedPaths].sort(), [...round7ExpectedC1Paths].sort(), 'Round 7 C1 path authority differs from the validator kernel');
  assert.deepEqual([...authority.c2AllowedPaths].sort(), [...round7ExpectedC2Paths].sort(), 'Round 7 C2 path authority differs from the validator kernel');
  assert.deepEqual([...authority.c3AllowedPaths].sort(), [...round7ExpectedC3Paths].sort(), 'Round 7 C3 path authority differs from the validator kernel');
  assert.deepEqual([...authority.completionAllowedPaths].sort(), [...round7ExpectedCompletionPaths].sort(), 'Round 7 completion path authority differs from the validator kernel');
}

function round7AssertArtifact(artifact, label) {
  round7AssertExactKeys(artifact, round7ArtifactKeys, label);
  assert(Number.isSafeInteger(artifact.id) && artifact.id > 0, `${label}.id must be a positive safe integer`);
  assert.equal(typeof artifact.name, 'string', `${label}.name must be a string`);
  assert(artifact.name.length > 0, `${label}.name must not be empty`);
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/u, `${label}.digest is not a lowercase SHA-256 digest`);
  assert(Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes > 0, `${label}.sizeBytes must be positive`);
}

function round7AssertAttemptArtifactName(record, label) {
  assert(Number.isSafeInteger(record.runAttempt) && record.runAttempt > 0, `${label}.runAttempt must be positive`);
  assert.equal(
    record.artifact.name,
    `cats-v082-step-1-recovery-evidence-attempt-${record.runAttempt}`,
    `${label}.artifact.name is not bound to the recorded run attempt`,
  );
}

function round7ExpectedSanitizedArtifactName(runId, runAttempt) {
  assert(Number.isSafeInteger(runId) && runId > 0, 'Sanitized audit artifact run ID must be positive');
  assert(Number.isSafeInteger(runAttempt) && runAttempt > 0, 'Sanitized audit artifact run attempt must be positive');
  return `cats-step-1-round-7-external-audit-source-${runId}-${runAttempt}-audit-${runAttempt}`;
}

function round7AssertSanitizedArtifactName(audit, label) {
  assert.equal(
    audit.sanitizedArtifact.name,
    round7ExpectedSanitizedArtifactName(audit.runId, audit.runAttempt),
    `${label}.sanitizedArtifact.name is not bound to the exact same-run source and audit attempt`,
  );
}

function round7AssertTextEvidence(items, label) {
  assert(Array.isArray(items) && items.length >= 2, `${label} must contain at least two entries`);
  for (const item of items) {
    assert.equal(typeof item, 'string', `${label} entries must be strings`);
    assert(item.trim().length >= 20, `${label} entries must each contain at least 20 non-whitespace characters`);
  }
}

function round7ValidateCiRecord(record, expectedRole, expectedHead, expectedTree, label) {
  round7AssertExactKeys(record, round7CiRecordKeys, label);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(record.role, expectedRole);
  assert.equal(record.repository, round7Repository);
  assert.equal(record.workflowId, round7PrimaryWorkflowId);
  assert(Number.isSafeInteger(record.runId) && record.runId > 0);
  assert(Number.isSafeInteger(record.runAttempt) && record.runAttempt > 0);
  assert(Number.isSafeInteger(record.jobId) && record.jobId > 0);
  assert.equal(record.headSha, expectedHead);
  assert.equal(record.headTree, expectedTree);
  assert.equal(round7Git(['rev-parse', `${record.headSha}^{tree}`]).trim(), record.headTree);
  assert.equal(record.status, 'completed');
  assert.equal(record.conclusion, 'success');
  assert.deepEqual(record.materialBlockers, []);
  round7AssertArtifact(record.artifact, `${label}.artifact`);
  round7AssertAttemptArtifactName(record, label);
  return record;
}

function round7ValidateCriticRecord(record, expectedRole, c1, c1Tree, acceptanceSha256, c1Ci, label) {
  round7AssertExactKeys(record, round7CriticRecordKeys, label);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(record.role, expectedRole);
  assert.equal(record.reviewTargetCommit, c1);
  assert.equal(record.reviewTargetTree, c1Tree);
  assert.equal(record.reviewedAcceptanceSha256, acceptanceSha256);
  assert.equal(record.reviewedCiRunId, c1Ci.runId);
  assert.equal(record.reviewedCiRunAttempt, c1Ci.runAttempt);
  assert.equal(record.reviewedCiJobId, c1Ci.jobId);
  round7AssertArtifact(record.reviewedCiArtifact, `${label}.reviewedCiArtifact`);
  assert.deepEqual(record.reviewedCiArtifact, c1Ci.artifact);
  assert.equal(record.verdict, 'PASS');
  assert.deepEqual(record.materialBlockers, []);
  round7AssertTextEvidence(record.method, `${label}.method`);
  round7AssertTextEvidence(record.findings, `${label}.findings`);
}

function round7ValidateSmokeRecord(record, c1, label) {
  round7AssertExactKeys(record, [
    'schemaVersion', 'artifactId', 'role', 'testedCommit', 'status', 'targets', 'materialBlockers',
  ], label);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(record.role, 'artifact-download-smoke');
  assert.equal(record.testedCommit, c1);
  assert.equal(record.status, 'PASS');
  assert.deepEqual(record.materialBlockers, []);
  assert(Array.isArray(record.targets) && record.targets.length === 2, `${label}.targets must contain exactly two entries`);
  assert.deepEqual(record.targets.map(target => target.role).sort(), Object.keys(round7KnownSmokeTargets).sort());
  for (const target of record.targets) {
    round7AssertExactKeys(target, round7SmokeTargetKeys, `${label}.${target.role}`);
    const known = round7KnownSmokeTargets[target.role];
    assert(known, `${label} contains an unknown target role`);
    assert.equal(target.runId, known.runId);
    assert.equal(target.runAttempt, known.runAttempt);
    assert.equal(target.jobId, known.jobId);
    round7AssertArtifact(target.artifact, `${label}.${target.role}.artifact`);
    assert.deepEqual(target.artifact, known.artifact);
    assert.equal(target.firstHopStatus, 302);
    assert.equal(target.secondHopStatus, 200);
    assert.equal(target.storageAuthorizationSent, false);
    assert.equal(target.archiveMemberCount, 95);
    assert.equal(target.provenanceMemberCount, 1);
    assert.equal(target.passReportCount, 10);
    assert.equal(target.result, 'PASS');
  }
}

function round7ValidateFinalJudge(record, c2, c2Tree, acceptanceSha256, c2Ci, criticBindings, label) {
  round7AssertExactKeys(record, [...round7CriticRecordKeys, 'criticRecordHashes'], label);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(record.role, 'final-judge');
  assert.equal(record.reviewTargetCommit, c2);
  assert.equal(record.reviewTargetTree, c2Tree);
  assert.equal(record.reviewedAcceptanceSha256, acceptanceSha256);
  assert.equal(record.reviewedCiRunId, c2Ci.runId);
  assert.equal(record.reviewedCiRunAttempt, c2Ci.runAttempt);
  assert.equal(record.reviewedCiJobId, c2Ci.jobId);
  round7AssertArtifact(record.reviewedCiArtifact, `${label}.reviewedCiArtifact`);
  assert.deepEqual(record.reviewedCiArtifact, c2Ci.artifact);
  assert.equal(record.verdict, 'PASS');
  assert.deepEqual(record.materialBlockers, []);
  round7AssertTextEvidence(record.method, `${label}.method`);
  round7AssertTextEvidence(record.findings, `${label}.findings`);
  assert(Array.isArray(record.criticRecordHashes), `${label}.criticRecordHashes must be an array`);
  for (const binding of record.criticRecordHashes) {
    round7AssertExactKeys(binding, ['path', 'sha256'], `${label}.criticRecordHashes entry`);
    assert.match(binding.sha256, /^[a-f0-9]{64}$/u);
  }
  assert.deepEqual(
    [...record.criticRecordHashes].sort((left, right) => left.path.localeCompare(right.path)),
    [...criticBindings].sort((left, right) => left.path.localeCompare(right.path)),
    `${label}.criticRecordHashes do not bind the exact three C2 critic bytes`,
  );
}

async function round7GithubApi(relativeUrl) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  assert(token, 'EXTERNAL_EVIDENCE_UNVERIFIED: --remote requires GITHUB_TOKEN or GH_TOKEN');
  const response = await fetch(`https://api.github.com/repos/${round7Repository}/${relativeUrl}`, {
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cats-tower-round7-verifier',
    },
  });
  assert.equal(response.status, 200, `GitHub provider API ${relativeUrl} returned HTTP ${response.status}`);
  return parseJsonStrict(await response.text(), `GitHub provider API ${relativeUrl}`);
}

function round7ValidatePaginatedPayloads(payloads, key, endpoint) {
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

async function round7GithubPaginated(endpoint, key) {
  const payloads = [];
  for (let page = 1; page <= 1000; page += 1) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const payload = await round7GithubApi(`${endpoint}${separator}per_page=100&page=${page}`);
    payloads.push(payload);
    assert(Array.isArray(payload[key]), `GitHub API ${endpoint} omitted ${key}`);
    if (payload[key].length < 100) return round7ValidatePaginatedPayloads(payloads, key, endpoint);
  }
  assert.fail(`GitHub API pagination exceeded the safety bound for ${endpoint}`);
}

function round7AssertStableWorkflowRunSnapshots(first, second, endpoint) {
  const identity = items => items.map(item => {
    assert(Number.isSafeInteger(item.run_attempt) && item.run_attempt > 0,
      `GitHub API ${endpoint} returned a run without a valid run_attempt`);
    return [item.id, item.run_attempt];
  });
  assert.deepEqual(
    identity(second),
    identity(first),
    `GitHub API ${endpoint} changed run identities or attempts between complete snapshots`,
  );
}

async function round7GithubAllPrimaryRuns() {
  const endpoint = 'actions/workflows/verify-main.yml/runs';
  const first = await round7GithubPaginated(endpoint, 'workflow_runs');
  const second = await round7GithubPaginated(endpoint, 'workflow_runs');
  round7AssertStableWorkflowRunSnapshots(first, second, endpoint);
  return first;
}

function round7AssertProviderIdentityPayload(identity, expected, run, jobsResponse, artifact = null) {
  assert.equal(run.id, identity.runId);
  assert.equal(run.run_attempt, identity.runAttempt);
  assert.equal(run.workflow_id, expected.workflowId);
  if (expected.workflowName !== undefined) assert.equal(run.name, expected.workflowName);
  assert.equal(run.head_sha, expected.headSha);
  assert.equal(run.event, expected.event);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');

  assert(Number.isSafeInteger(jobsResponse.total_count) && jobsResponse.total_count <= 100);
  assert.equal(jobsResponse.jobs.length, jobsResponse.total_count, 'GitHub exact-attempt jobs response was truncated');
  const matchingJobs = jobsResponse.jobs.filter(candidate => candidate.id === identity.jobId);
  assert.equal(matchingJobs.length, 1, 'GitHub exact-attempt jobs response does not contain exactly one recorded job');
  const [job] = matchingJobs;
  if (expected.jobName !== undefined) assert.equal(job.name, expected.jobName);
  assert.equal(job.run_id, identity.runId);
  assert.equal(job.run_attempt, identity.runAttempt);
  assert.equal(job.head_sha, expected.headSha);
  assert.equal(job.status, 'completed');
  assert.equal(job.conclusion, 'success');
  const jobStartedAt = Date.parse(job.started_at);
  const jobCompletedAt = Date.parse(job.completed_at);
  assert(Number.isFinite(jobStartedAt), 'GitHub exact-attempt job has no valid started_at');
  assert(Number.isFinite(jobCompletedAt), 'GitHub exact-attempt job has no valid completed_at');
  assert(jobStartedAt <= jobCompletedAt, 'GitHub exact-attempt job time interval is reversed');
  if (expected.requiredSteps !== undefined) {
    assert(Array.isArray(job.steps), 'GitHub exact-attempt job has no step ledger');
    for (const stepName of expected.requiredSteps) {
      const matchingSteps = job.steps.filter(step => step.name === stepName);
      assert.equal(matchingSteps.length, 1, `GitHub exact-attempt job does not contain exactly one ${stepName} step`);
      assert.equal(matchingSteps[0].conclusion, 'success', `GitHub exact-attempt step did not pass: ${stepName}`);
    }
  }

  if (identity.artifact) {
    assert(artifact, 'GitHub artifact payload is required for an artifact-bound identity');
    assert.equal(artifact.id, identity.artifact.id);
    assert.equal(artifact.name, identity.artifact.name);
    assert.equal(artifact.digest, identity.artifact.digest);
    assert.equal(artifact.size_in_bytes, identity.artifact.sizeBytes);
    assert.equal(artifact.expired, false);
    assert(
      artifact.workflow_run && typeof artifact.workflow_run === 'object' && !Array.isArray(artifact.workflow_run),
      'GitHub artifact payload has no workflow_run object',
    );
    assert.equal(artifact.workflow_run.id, identity.runId);
    assert.equal(artifact.workflow_run.head_sha, expected.headSha);
    const artifactCreatedAt = Date.parse(artifact.created_at);
    const artifactExpiresAt = Date.parse(artifact.expires_at);
    assert(Number.isFinite(artifactCreatedAt), 'GitHub artifact payload has no valid created_at');
    assert(Number.isFinite(artifactExpiresAt), 'GitHub artifact payload has no valid expires_at');
    assert(
      artifactCreatedAt >= jobStartedAt && artifactCreatedAt <= jobCompletedAt,
      'GitHub artifact was not created inside the matched job interval',
    );
    assert(artifactExpiresAt > Date.now(), 'GitHub artifact is expired at provider verification time');
  }
}

function round7AssertProviderArtifactListAndExact(identity, expected, run, jobsResponse, artifactsResponse, exactArtifact) {
  assert(Number.isSafeInteger(artifactsResponse.total_count) && artifactsResponse.total_count <= 100);
  assert(Array.isArray(artifactsResponse.artifacts), 'GitHub run artifact response has no artifacts array');
  assert.equal(
    artifactsResponse.artifacts.length,
    artifactsResponse.total_count,
    'GitHub run artifact response was truncated',
  );
  const expectedName = identity.artifact.name;
  const namedArtifacts = artifactsResponse.artifacts.filter(candidate => candidate.name === expectedName);
  assert.equal(namedArtifacts.length, 1, 'GitHub run artifact response does not contain exactly one scoped sanitized artifact name');
  const idArtifacts = artifactsResponse.artifacts.filter(candidate => candidate.id === identity.artifact.id);
  assert.equal(idArtifacts.length, 1, 'GitHub run artifact response does not contain exactly one recorded sanitized artifact ID');
  assert.equal(namedArtifacts[0].id, identity.artifact.id, 'Scoped sanitized artifact name belongs to another artifact ID');
  assert.equal(idArtifacts[0].name, expectedName, 'Recorded sanitized artifact ID belongs to another artifact name');
  round7AssertProviderIdentityPayload(identity, expected, run, jobsResponse, namedArtifacts[0]);
  round7AssertProviderIdentityPayload(identity, expected, run, jobsResponse, exactArtifact);
  for (const key of [
    'id', 'name', 'digest', 'size_in_bytes', 'expired', 'created_at', 'expires_at', 'workflow_run',
  ]) {
    assert.deepEqual(exactArtifact[key], namedArtifacts[0][key], `Sanitized artifact list and exact API disagree on ${key}`);
  }
}

async function round7VerifyProviderIdentity(identity, expected) {
  const run = await round7GithubApi(`actions/runs/${identity.runId}/attempts/${identity.runAttempt}`);
  const jobsResponse = await round7GithubApi(`actions/runs/${identity.runId}/attempts/${identity.runAttempt}/jobs?per_page=100`);
  const artifact = identity.artifact
    ? await round7GithubApi(`actions/artifacts/${identity.artifact.id}`)
    : null;
  round7AssertProviderIdentityPayload(identity, expected, run, jobsResponse, artifact);
  return { run, jobsResponse, artifact };
}

function round7RequireCompletionRemote(remoteEnabled) {
  assert(remoteEnabled, 'EXTERNAL_EVIDENCE_UNVERIFIED: the completion commit and merge require --remote provider verification');
}

function round7RequiresUnexpiredInitialSanitizedArtifact(head, completionCommit, completionMerge) {
  return Boolean(completionCommit && (head === completionCommit || head === completionMerge));
}

function round7RunAttackSelfTests() {
  const clone = value => JSON.parse(JSON.stringify(value));
  const paginationEndpoint = 'actions/workflows/verify-main.yml/runs';
  const overOneThousandRuns = Array.from({ length: 1001 }, (_, index) => ({
    id: index + 1,
    run_attempt: 1,
  }));
  const overOneThousandPayloads = [];
  for (let index = 0; index < overOneThousandRuns.length; index += 100) {
    overOneThousandPayloads.push({
      total_count: overOneThousandRuns.length,
      workflow_runs: overOneThousandRuns.slice(index, index + 100),
    });
  }
  const unfilteredOverOneThousand = round7ValidatePaginatedPayloads(
    overOneThousandPayloads,
    'workflow_runs',
    paginationEndpoint,
  );
  assert.equal(unfilteredOverOneThousand.length, 1001,
    'Unfiltered workflow pagination must retain runs beyond the filtered 1,000-result cap');
  assert.throws(
    () => round7ValidatePaginatedPayloads(
      [{ total_count: 100, workflow_runs: overOneThousandRuns.slice(0, 100) }],
      'workflow_runs',
      paginationEndpoint,
    ),
    /explicit safety bound/u,
  );
  const changingTotalPayloads = clone(overOneThousandPayloads);
  changingTotalPayloads[1].total_count += 1;
  assert.throws(
    () => round7ValidatePaginatedPayloads(changingTotalPayloads, 'workflow_runs', paginationEndpoint),
    /changed total_count/u,
  );
  const duplicatePagePayloads = clone(overOneThousandPayloads);
  duplicatePagePayloads.at(-1).workflow_runs[0].id = duplicatePagePayloads[0].workflow_runs[0].id;
  assert.throws(
    () => round7ValidatePaginatedPayloads(duplicatePagePayloads, 'workflow_runs', paginationEndpoint),
    /duplicate item across pages/u,
  );
  const shiftedWorkflowSnapshot = overOneThousandRuns.map(item => ({
    id: item.id + 1,
    run_attempt: item.run_attempt,
  }));
  assert.throws(
    () => round7AssertStableWorkflowRunSnapshots(
      overOneThousandRuns,
      shiftedWorkflowSnapshot,
      paginationEndpoint,
    ),
    /changed run identities or attempts/u,
  );
  const rerunChangedSnapshot = clone(overOneThousandRuns);
  rerunChangedSnapshot[500].run_attempt = 2;
  assert.throws(
    () => round7AssertStableWorkflowRunSnapshots(
      overOneThousandRuns,
      rerunChangedSnapshot,
      paginationEndpoint,
    ),
    /changed run identities or attempts/u,
  );
  const artifact = {
    id: 1,
    name: 'cats-v082-step-1-recovery-evidence-attempt-1',
    digest: `sha256:${'a'.repeat(64)}`,
    sizeBytes: 1,
  };
  const completionAuditResultFixture = { runAttempt: 1, artifact: clone(artifact) };
  round7AssertAttemptArtifactName(completionAuditResultFixture, 'Round 7 completion audit self-test');
  const completionSameRunDifferentArtifact = clone(completionAuditResultFixture);
  completionSameRunDifferentArtifact.artifact.id = 99;
  completionSameRunDifferentArtifact.artifact.name = 'another-green-artifact';
  completionSameRunDifferentArtifact.artifact.digest = `sha256:${'c'.repeat(64)}`;
  assert.throws(
    () => round7AssertAttemptArtifactName(completionSameRunDifferentArtifact, 'completion same-run artifact substitution attack'),
    /artifact.name is not bound to the recorded run attempt/u,
  );
  const frozenAcceptanceFixture = Buffer.from('{"externalCompletionStopConditions":["fixed"]}\n', 'utf8');
  round7AssertAcceptanceFrozen(frozenAcceptanceFixture, Buffer.from(frozenAcceptanceFixture));
  const modifiedUncheckedFieldFixture = Buffer.from('{"externalCompletionStopConditions":["weakened"]}\n', 'utf8');
  assert.throws(
    () => round7AssertAcceptanceFrozen(frozenAcceptanceFixture, modifiedUncheckedFieldFixture),
    /Acceptance raw bytes changed after C1/u,
  );
  round7AssertEvidenceTreeFrozen('a'.repeat(40), 'a'.repeat(40));
  assert.throws(
    () => round7AssertEvidenceTreeFrozen('a'.repeat(40), 'b'.repeat(40)),
    /evidence subtree changed after completion/u,
  );
  const historicalTreeFixture = {
    immutableHistoricalTrees: {
      [round6EvidencePath]: round6EvidenceTree,
      [baselineSnapshotPath]: baselineSnapshotTree,
    },
  };
  round7AssertHistoricalTreeIds(
    'post-completion-descendant-fixture',
    round6EvidenceTree,
    baselineSnapshotTree,
    historicalTreeFixture,
  );
  assert.throws(
    () => round7AssertHistoricalTreeIds(
      'post-completion-descendant-fixture',
      'd'.repeat(40),
      baselineSnapshotTree,
      historicalTreeFixture,
    ),
    /changed the sealed Round 6 evidence tree/u,
  );
  assert.throws(
    () => round7AssertHistoricalTreeIds(
      'post-completion-descendant-fixture',
      round6EvidenceTree,
      'e'.repeat(40),
      historicalTreeFixture,
    ),
    /changed the V0\.8\.2 baseline snapshot tree/u,
  );
  round7RunHistoricalTreeGitAttackSelfTest();
  round7RunSealedAuthorityGitAttackSelfTest();
  const frozenPaths = {
    c1AllowedPaths: round7ExpectedC1Paths,
    c2AllowedPaths: round7ExpectedC2Paths,
    c3AllowedPaths: round7ExpectedC3Paths,
    completionAllowedPaths: round7ExpectedCompletionPaths,
  };
  round7AssertFrozenPathLists(frozenPaths);
  const substitutedPaths = clone(frozenPaths);
  substitutedPaths.c1AllowedPaths[substitutedPaths.c1AllowedPaths.length - 1] = 'index.html';
  assert.throws(() => round7AssertFrozenPathLists(substitutedPaths), /differs from the validator kernel/u);
  const ci = {
    schemaVersion: 1,
    artifactId: 'step-1-legacy-baseline-round-007',
    role: 'c1-ci',
    repository: round7Repository,
    workflowId: round7PrimaryWorkflowId,
    runId: 1,
    runAttempt: 1,
    jobId: 2,
    headSha: round7BaseCommit,
    headTree: round7BaseTree,
    status: 'completed',
    conclusion: 'success',
    artifact,
    materialBlockers: [],
  };
  round7ValidateCiRecord(ci, 'c1-ci', round7BaseCommit, round7BaseTree, 'Round 7 CI self-test');
  const missingBlockers = clone(ci);
  delete missingBlockers.materialBlockers;
  assert.throws(
    () => round7ValidateCiRecord(missingBlockers, 'c1-ci', round7BaseCommit, round7BaseTree, 'missing-blockers attack'),
    /keys differ/u,
  );
  const conflictingOutcome = clone(ci);
  conflictingOutcome.conclusion = 'failure';
  assert.throws(
    () => round7ValidateCiRecord(conflictingOutcome, 'c1-ci', round7BaseCommit, round7BaseTree, 'OR-outcome attack'),
    /Expected values to be strictly equal/u,
  );
  const wrongAttemptArtifactName = clone(ci);
  wrongAttemptArtifactName.artifact.name = 'cats-v082-step-1-recovery-evidence-attempt-2';
  assert.throws(
    () => round7ValidateCiRecord(wrongAttemptArtifactName, 'c1-ci', round7BaseCommit, round7BaseTree, 'attempt-name attack'),
    /artifact.name is not bound to the recorded run attempt/u,
  );

  const smoke = {
    schemaVersion: 1,
    artifactId: 'step-1-legacy-baseline-round-007',
    role: 'artifact-download-smoke',
    testedCommit: round7BaseCommit,
    status: 'PASS',
    targets: Object.entries(round7KnownSmokeTargets).map(([role, known]) => ({
      role,
      runId: known.runId,
      runAttempt: known.runAttempt,
      jobId: known.jobId,
      artifact: clone(known.artifact),
      firstHopStatus: 302,
      secondHopStatus: 200,
      storageAuthorizationSent: false,
      archiveMemberCount: 95,
      provenanceMemberCount: 1,
      passReportCount: 10,
      result: 'PASS',
    })),
    materialBlockers: [],
  };
  round7ValidateSmokeRecord(smoke, round7BaseCommit, 'Round 7 smoke self-test');
  const substitutedSmoke = clone(smoke);
  substitutedSmoke.targets[0].artifact.id += 1;
  assert.throws(
    () => round7ValidateSmokeRecord(substitutedSmoke, round7BaseCommit, 'artifact substitution attack'),
    /Expected values to be strictly deep-equal/u,
  );

  const identity = { runId: 1, runAttempt: 1, jobId: 2, artifact };
  const expected = { workflowId: 3, headSha: round7BaseCommit, event: 'pull_request' };
  const fixtureNow = Date.now();
  const fixtureJobStartedAt = new Date(fixtureNow - 120_000).toISOString();
  const fixtureArtifactCreatedAt = new Date(fixtureNow - 90_000).toISOString();
  const fixtureJobCompletedAt = new Date(fixtureNow - 60_000).toISOString();
  const fixtureSanitizedArtifactCreatedAt = new Date(fixtureNow - 45_000).toISOString();
  const fixtureAuditCompletedAt = new Date(fixtureNow - 30_000).toISOString();
  const fixtureCurrentRunStartedAt = new Date(fixtureNow - 10_000).toISOString();
  const fixtureArtifactExpiresAt = new Date(fixtureNow + 86_400_000).toISOString();
  const runPayload = {
    id: 1,
    run_attempt: 1,
    workflow_id: 3,
    head_sha: round7BaseCommit,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
  };
  const jobsPayload = {
    total_count: 1,
    jobs: [{
      id: 2,
      run_id: 1,
      run_attempt: 1,
      head_sha: round7BaseCommit,
      status: 'completed',
      conclusion: 'success',
      started_at: fixtureJobStartedAt,
      completed_at: fixtureJobCompletedAt,
    }],
  };
  const artifactPayload = {
    id: 1,
    name: artifact.name,
    digest: artifact.digest,
    size_in_bytes: 1,
    expired: false,
    created_at: fixtureArtifactCreatedAt,
    expires_at: fixtureArtifactExpiresAt,
    workflow_run: { id: 1, head_sha: round7BaseCommit },
  };
  round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, artifactPayload);
  const sameRunStillInProgress = clone(runPayload);
  sameRunStillInProgress.status = 'in_progress';
  sameRunStillInProgress.conclusion = null;
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, sameRunStillInProgress, jobsPayload, artifactPayload),
    /Expected values to be strictly equal/u,
  );
  const finalAuditIdentity = { runId: 10, runAttempt: 2, jobId: 12 };
  const finalAuditExpected = {
    workflowId: round7PrimaryWorkflowId,
    workflowName: "Verify Cat's Tower baseline and quality records",
    jobName: round7ReusableAuditJobName,
    requiredSteps: round7ReusableAuditRequiredSteps,
    headSha: round7BaseCommit,
    event: 'push',
  };
  const finalAuditRun = {
    id: 10,
    run_attempt: 2,
    workflow_id: round7PrimaryWorkflowId,
    name: "Verify Cat's Tower baseline and quality records",
    path: '.github/workflows/verify-main.yml',
    head_sha: round7BaseCommit,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  const finalAuditJobs = {
    total_count: 2,
    jobs: [
      {
        id: 11,
        name: 'vertical-tower-qa',
        run_id: 10,
        run_attempt: 2,
        head_sha: round7BaseCommit,
        status: 'completed',
        conclusion: 'success',
        started_at: fixtureJobStartedAt,
        completed_at: fixtureJobCompletedAt,
        steps: [
          { name: 'GitHub recovery ref and live runtime manifest', conclusion: 'success' },
          { name: 'Exercise repaired artifact transport against Round 6 provider artifacts', conclusion: 'success' },
        ],
      },
      {
        id: 12,
        name: round7ReusableAuditJobName,
        run_id: 10,
        run_attempt: 2,
        head_sha: round7BaseCommit,
        status: 'completed',
        conclusion: 'success',
        started_at: fixtureJobCompletedAt,
        completed_at: fixtureAuditCompletedAt,
        steps: round7ReusableAuditRequiredSteps.map(name => ({ name, conclusion: 'success' })),
      },
    ],
  };
  round7AssertProviderIdentityPayload(finalAuditIdentity, finalAuditExpected, finalAuditRun, finalAuditJobs);
  round7AssertSameRunJobOrder(finalAuditJobs.jobs[0], finalAuditJobs.jobs[1]);
  round7AssertReusableAuditStepLedger(finalAuditJobs.jobs[1], 'success');
  const completionMergeAuditJobs = clone(finalAuditJobs);
  completionMergeAuditJobs.jobs[1].steps.find(
    step => step.name === 'Verify Round 7 C3 pull-request artifact',
  ).conclusion = 'skipped';
  assert.throws(
    () => round7AssertReusableAuditStepLedger(finalAuditJobs.jobs[1], 'skipped'),
    /wrong outcome/u,
  );
  const reorderedReusableAuditAttack = clone(completionMergeAuditJobs.jobs[1]);
  [reorderedReusableAuditAttack.steps[0], reorderedReusableAuditAttack.steps[1]] = [
    reorderedReusableAuditAttack.steps[1], reorderedReusableAuditAttack.steps[0],
  ];
  assert.throws(
    () => round7AssertReusableAuditStepLedger(reorderedReusableAuditAttack, 'skipped'),
    /exact C1 order/u,
  );
  const completionMergeAuditFixture = round7AssertCompletionMergeProviderCandidate(
      round7BaseCommit,
      Date.parse(fixtureCurrentRunStartedAt),
      finalAuditRun,
      completionMergeAuditJobs,
    );
  assert.deepEqual(
    completionMergeAuditFixture,
    {
      runId: finalAuditRun.id,
      runAttempt: finalAuditRun.run_attempt,
      jobId: completionMergeAuditJobs.jobs[1].id,
      headSha: round7BaseCommit,
      completedAt: completionMergeAuditJobs.jobs[1].completed_at,
    },
  );
  assert.deepEqual(
    round7SelectHistoricalCompletionMergeAudit([completionMergeAuditFixture]),
    completionMergeAuditFixture,
  );
  assert.throws(
    () => round7SelectHistoricalCompletionMergeAudit([]),
    /No earlier successful exact-head completion-merge/u,
  );
  const directDescendantBootstrapAttack = clone(finalAuditRun);
  directDescendantBootstrapAttack.head_sha = 'f'.repeat(40);
  const directDescendantBootstrapJobs = clone(completionMergeAuditJobs);
  for (const job of directDescendantBootstrapJobs.jobs) job.head_sha = directDescendantBootstrapAttack.head_sha;
  assert.throws(
    () => round7AssertCompletionMergeProviderCandidate(
      round7BaseCommit,
      Date.parse(fixtureCurrentRunStartedAt),
      directDescendantBootstrapAttack,
      directDescendantBootstrapJobs,
    ),
    /Expected values to be strictly equal/u,
  );
  const sanitizedArtifactFixture = {
    id: 20,
    name: round7ExpectedSanitizedArtifactName(finalAuditIdentity.runId, finalAuditIdentity.runAttempt),
    digest: `sha256:${'d'.repeat(64)}`,
    sizeBytes: 512,
  };
  const sanitizedAuditFixture = {
    runId: finalAuditIdentity.runId,
    runAttempt: finalAuditIdentity.runAttempt,
    sanitizedArtifact: sanitizedArtifactFixture,
  };
  round7AssertSanitizedArtifactName(sanitizedAuditFixture, 'sanitized artifact self-test');
  const sanitizedArtifactPayload = {
    id: sanitizedArtifactFixture.id,
    name: sanitizedArtifactFixture.name,
    digest: sanitizedArtifactFixture.digest,
    size_in_bytes: sanitizedArtifactFixture.sizeBytes,
    expired: false,
    created_at: fixtureSanitizedArtifactCreatedAt,
    expires_at: fixtureArtifactExpiresAt,
    workflow_run: { id: finalAuditIdentity.runId, head_sha: round7BaseCommit },
  };
  const sanitizedArtifactIdentity = {
    ...finalAuditIdentity,
    artifact: sanitizedArtifactFixture,
  };
  const sanitizedArtifactList = { total_count: 1, artifacts: [sanitizedArtifactPayload] };
  round7AssertProviderArtifactListAndExact(
    sanitizedArtifactIdentity,
    finalAuditExpected,
    finalAuditRun,
    finalAuditJobs,
    sanitizedArtifactList,
    sanitizedArtifactPayload,
  );
  const sameRunSanitizedArtifactSubstitution = clone(sanitizedArtifactList);
  sameRunSanitizedArtifactSubstitution.artifacts[0].id += 1;
  assert.throws(
    () => round7AssertProviderArtifactListAndExact(
      sanitizedArtifactIdentity,
      finalAuditExpected,
      finalAuditRun,
      finalAuditJobs,
      sameRunSanitizedArtifactSubstitution,
      sanitizedArtifactPayload,
    ),
    /recorded sanitized artifact ID/u,
  );
  const wrongScopedSanitizedArtifact = clone(sanitizedAuditFixture);
  wrongScopedSanitizedArtifact.sanitizedArtifact.name = 'another-same-run-sanitized-artifact';
  assert.throws(
    () => round7AssertSanitizedArtifactName(wrongScopedSanitizedArtifact, 'sanitized artifact name attack'),
    /not bound to the exact same-run source and audit attempt/u,
  );
  const earlyReusableAuditJobAttack = clone(finalAuditJobs);
  earlyReusableAuditJobAttack.jobs[1].started_at = fixtureJobStartedAt;
  assert.throws(
    () => round7AssertSameRunJobOrder(earlyReusableAuditJobAttack.jobs[0], earlyReusableAuditJobAttack.jobs[1]),
    /started before/u,
  );
  const unfinishedFinalAuditRun = clone(finalAuditRun);
  unfinishedFinalAuditRun.status = 'in_progress';
  unfinishedFinalAuditRun.conclusion = null;
  assert.throws(
    () => round7AssertProviderIdentityPayload(finalAuditIdentity, finalAuditExpected, unfinishedFinalAuditRun, finalAuditJobs),
    /Expected values to be strictly equal/u,
  );
  const unfinishedFinalAuditJob = clone(finalAuditJobs);
  unfinishedFinalAuditJob.jobs[1].status = 'in_progress';
  unfinishedFinalAuditJob.jobs[1].conclusion = null;
  assert.throws(
    () => round7AssertProviderIdentityPayload(finalAuditIdentity, finalAuditExpected, finalAuditRun, unfinishedFinalAuditJob),
    /Expected values to be strictly equal/u,
  );
  const sameRunAuditFixture = {
    workflowId: round7PrimaryWorkflowId,
    runId: 10,
    runAttempt: 2,
    jobId: 12,
    c3: { runId: 9, artifact: { id: 90 } },
    initialMain: { runId: 10, runAttempt: 2, jobId: 11, artifact: { id: 100 } },
  };
  round7AssertSameRunAuditBinding(sameRunAuditFixture);
  const separateAuditRunAttack = clone(sameRunAuditFixture);
  separateAuditRunAttack.runId = 13;
  assert.throws(() => round7AssertSameRunAuditBinding(separateAuditRunAttack), /share the exact initial-main caller run/u);
  const reusedPrimaryJobAttack = clone(sameRunAuditFixture);
  reusedPrimaryJobAttack.jobId = reusedPrimaryJobAttack.initialMain.jobId;
  assert.throws(() => round7AssertSameRunAuditBinding(reusedPrimaryJobAttack), /distinct from the primary verification job/u);
  const wrongAttemptJobs = clone(jobsPayload);
  wrongAttemptJobs.jobs[0].run_attempt = 2;
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, wrongAttemptJobs, artifactPayload),
    /Expected values to be strictly equal/u,
  );
  const wrongDigestArtifact = clone(artifactPayload);
  wrongDigestArtifact.digest = `sha256:${'b'.repeat(64)}`;
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, wrongDigestArtifact),
    /Expected values to be strictly equal/u,
  );
  const sameGreenRunDifferentArtifact = clone(artifactPayload);
  sameGreenRunDifferentArtifact.id = 3;
  sameGreenRunDifferentArtifact.name = 'another-green-artifact';
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, sameGreenRunDifferentArtifact),
    /Expected values to be strictly equal/u,
  );
  const missingWorkflowRun = clone(artifactPayload);
  delete missingWorkflowRun.workflow_run;
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, missingWorkflowRun),
    /no workflow_run object/u,
  );
  const missingWorkflowHead = clone(artifactPayload);
  delete missingWorkflowHead.workflow_run.head_sha;
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, missingWorkflowHead),
    /Expected values to be strictly equal/u,
  );
  const mismatchedWorkflowHead = clone(artifactPayload);
  mismatchedWorkflowHead.workflow_run.head_sha = 'f'.repeat(40);
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, mismatchedWorkflowHead),
    /Expected values to be strictly equal/u,
  );
  const outsideJobInterval = clone(artifactPayload);
  outsideJobInterval.created_at = new Date(fixtureNow - 180_000).toISOString();
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, outsideJobInterval),
    /not created inside the matched job interval/u,
  );
  const expiredArtifact = clone(artifactPayload);
  expiredArtifact.expires_at = new Date(fixtureNow - 1).toISOString();
  assert.throws(
    () => round7AssertProviderIdentityPayload(identity, expected, runPayload, jobsPayload, expiredArtifact),
    /expired at provider verification time/u,
  );
  assert.throws(() => round7RequireCompletionRemote(false), /EXTERNAL_EVIDENCE_UNVERIFIED/u);
  assert.equal(
    round7RequiresUnexpiredInitialSanitizedArtifact('completion', 'completion', null),
    true,
    'The completion commit must re-query its unexpired sanitized audit artifact',
  );
  assert.equal(
    round7RequiresUnexpiredInitialSanitizedArtifact('completion-merge', 'completion', 'completion-merge'),
    true,
    'The completion merge must re-query its unexpired sanitized audit artifact',
  );
  assert.equal(
    round7RequiresUnexpiredInitialSanitizedArtifact('later-descendant', 'completion', 'completion-merge'),
    false,
    'Later descendants must not depend on retained sanitized audit artifact bytes',
  );

  const generatedPrefixFixture = ['recovered-v082', 'sealed-step1-round7'];
  assert.equal(round7IsGeneratedStatusPath('recovered-v082', generatedPrefixFixture), true);
  assert.equal(round7IsGeneratedStatusPath('recovered-v082/', generatedPrefixFixture), true);
  assert.equal(round7IsGeneratedStatusPath('recovered-v082/index.html', generatedPrefixFixture), true);
  assert.equal(round7IsGeneratedStatusPath('sealed-step1-round7', generatedPrefixFixture), true);
  assert.equal(round7IsGeneratedStatusPath('sealed-step1-round7/', generatedPrefixFixture), true);
  assert.equal(round7IsGeneratedStatusPath('evil-peer.txt', generatedPrefixFixture), false);
  assert.equal(round7IsGeneratedStatusPath('recovered-v082-evil/index.html', generatedPrefixFixture), false);
  assert.equal(round7IsGeneratedStatusPath('sealed-step1-round7-evil.txt', generatedPrefixFixture), false);
  if (
    realpathSync(path.resolve(repoRoot)) === realpathSync(path.resolve(kitRoot))
    && realpathSync(path.resolve(repoRoot)) === realpathSync(path.resolve(targetRoot))
  ) {
    assert.deepEqual(round7GeneratedStatusPrefixes(), [], 'Normal root verification must not exclude any worktree prefix');
  }
  round7RunGeneratedStatusGitAttackSelfTest();
}

function round7StrictChildPrefix(rootPath, candidatePath) {
  let realRoot;
  let realCandidate;
  try {
    realRoot = realpathSync(path.resolve(rootPath));
    realCandidate = realpathSync(path.resolve(candidatePath));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!statSync(realRoot).isDirectory() || !statSync(realCandidate).isDirectory()) return null;
  const relative = path.relative(realRoot, realCandidate);
  if (relative === '' || relative === '.' || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null;
  const prefix = segments.join('/');
  if (prefix === '' || prefix === '.' || prefix === '..' || path.posix.isAbsolute(prefix)) return null;
  return prefix;
}

function round7GeneratedStatusPrefixes() {
  return round7GeneratedStatusPrefixesAt(repoRoot, [kitRoot, targetRoot]);
}

function round7GeneratedStatusPrefixesAt(rootPath, candidatePaths) {
  const prefixes = new Set();
  for (const candidate of candidatePaths) {
    const prefix = round7StrictChildPrefix(rootPath, candidate);
    if (!prefix) continue;
    const tracked = round7GitAt(rootPath, ['ls-files', '-z', '--', prefix], null);
    if (tracked.length !== 0) continue;
    prefixes.add(prefix);
  }
  return [...prefixes].sort();
}

function round7IsGeneratedStatusPath(relativePath, prefixes) {
  return prefixes.some(prefix => (
    relativePath === prefix
    || relativePath === `${prefix}/`
    || relativePath.startsWith(`${prefix}/`)
  ));
}

function round7WorkingTreeEntries() {
  return round7WorkingTreeEntriesAt(repoRoot, [kitRoot, targetRoot]);
}

function round7WorkingTreeEntriesAt(rootPath, candidatePaths) {
  const generatedPrefixes = round7GeneratedStatusPrefixesAt(rootPath, candidatePaths);
  const fields = round7GitAt(rootPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], null)
    .toString('utf8').split('\0').filter(Boolean);
  return fields.map(field => {
    const code = field.slice(0, 2);
    const relativePath = field.slice(3);
    assert(!relativePath.includes(' -> '), `Round 7 preflight forbids renames: ${relativePath}`);
    assert(code === '??' || /^[ MARC][MDARC]$/u.test(code), `Unsupported Round 7 worktree status ${code}: ${relativePath}`);
    return {
      status: code === '??' || code.includes('A') ? 'A' : 'M',
      path: relativePath,
    };
  }).filter(entry => !round7IsGeneratedStatusPath(entry.path, generatedPrefixes))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function round7RunGeneratedStatusGitAttackSelfTest() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'cats-round7-generated-status-'));
  const recoveredRoot = path.join(fixtureRoot, 'recovered-v082');
  const sealedRoot = path.join(fixtureRoot, 'sealed-step1-round7');
  try {
    round7GitAt(fixtureRoot, ['init', '--quiet']);
    round7GitAt(fixtureRoot, ['config', 'user.name', 'Round 7 generated status fixture']);
    round7GitAt(fixtureRoot, ['config', 'user.email', 'round7-generated-status@example.invalid']);
    writeFileSync(path.join(fixtureRoot, 'tracked.txt'), 'tracked fixture\n', 'utf8');
    round7GitAt(fixtureRoot, ['add', 'tracked.txt']);
    round7GitAt(fixtureRoot, ['commit', '--quiet', '-m', 'generated status fixture root']);
    mkdirSync(recoveredRoot, { recursive: true });
    mkdirSync(sealedRoot, { recursive: true });
    writeFileSync(path.join(recoveredRoot, 'index.html'), 'generated recovered runtime\n', 'utf8');
    writeFileSync(path.join(sealedRoot, 'PROJECT_STATUS.json'), '{}\n', 'utf8');
    assert.deepEqual(
      round7WorkingTreeEntriesAt(fixtureRoot, [recoveredRoot, sealedRoot]),
      [],
      'Exact generated nested runtime and sealed-kit directories must be the only ignored entries',
    );
    writeFileSync(path.join(fixtureRoot, 'evil-peer.txt'), 'must remain visible\n', 'utf8');
    assert.deepEqual(
      round7WorkingTreeEntriesAt(fixtureRoot, [recoveredRoot, sealedRoot]),
      [{ status: 'A', path: 'evil-peer.txt' }],
      'A same-level non-generated file must not be hidden by generated-directory filtering',
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function round7AssertPreflightEdge(parent, paths, label) {
  assert.deepEqual(
    round7WorkingTreeEntries(),
    round7ExpectedEntries(parent, paths),
    `${label} worktree differs from the exact next-edge contract`,
  );
}

function round7AssertHistoricalTreeIds(commit, evidenceTree, snapshotTree, acceptance) {
  assert.equal(
    evidenceTree,
    acceptance.immutableHistoricalTrees[round6EvidencePath],
    `${commit} changed the sealed Round 6 evidence tree`,
  );
  assert.equal(
    snapshotTree,
    acceptance.immutableHistoricalTrees[baselineSnapshotPath],
    `${commit} changed the V0.8.2 baseline snapshot tree`,
  );
}

function round7AssertHistoricalTrees(commit, acceptance) {
  round7AssertHistoricalTreeIds(
    commit,
    round7Git(['rev-parse', `${commit}:${round6EvidencePath}`]).trim(),
    round7Git(['rev-parse', `${commit}:${baselineSnapshotPath}`]).trim(),
    acceptance,
  );
}

function round7RunHistoricalTreeGitAttackSelfTest() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'cats-round7-sealed-tree-attack-'));
  const fixtureGit = args => execFileSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const evidenceMarker = path.join(fixtureRoot, round6EvidencePath, 'marker.txt');
  const snapshotMarker = path.join(fixtureRoot, baselineSnapshotPath, 'marker.txt');
  const commitAll = message => {
    fixtureGit(['add', '--all']);
    fixtureGit(['commit', '--quiet', '-m', message]);
    return fixtureGit(['rev-parse', 'HEAD']).trim();
  };
  const treeAt = (commit, relativePath) => fixtureGit(['rev-parse', `${commit}:${relativePath}`]).trim();
  try {
    fixtureGit(['init', '--quiet']);
    fixtureGit(['config', 'user.name', 'Round 7 attack fixture']);
    fixtureGit(['config', 'user.email', 'round7-attack-fixture@example.invalid']);
    mkdirSync(path.dirname(evidenceMarker), { recursive: true });
    mkdirSync(path.dirname(snapshotMarker), { recursive: true });
    writeFileSync(evidenceMarker, 'sealed Round 6 evidence\n', 'utf8');
    writeFileSync(snapshotMarker, 'sealed V0.8.2 snapshot\n', 'utf8');
    const sealedCompletion = commitAll('sealed completion fixture');
    const sealedEvidenceTree = treeAt(sealedCompletion, round6EvidencePath);
    const sealedSnapshotTree = treeAt(sealedCompletion, baselineSnapshotPath);
    const authority = {
      immutableHistoricalTrees: {
        [round6EvidencePath]: sealedEvidenceTree,
        [baselineSnapshotPath]: sealedSnapshotTree,
      },
    };

    writeFileSync(path.join(fixtureRoot, 'future-round.txt'), 'allowed sibling change\n', 'utf8');
    const benignChild = commitAll('post-completion benign child');
    round7AssertHistoricalTreeIds(
      benignChild,
      treeAt(benignChild, round6EvidencePath),
      treeAt(benignChild, baselineSnapshotPath),
      authority,
    );

    fixtureGit(['checkout', '--quiet', '-b', 'mutate-round6-evidence', sealedCompletion]);
    writeFileSync(evidenceMarker, 'tampered Round 6 evidence\n', 'utf8');
    const evidenceAttackChild = commitAll('post-completion Round 6 evidence attack');
    assert.throws(
      () => round7AssertHistoricalTreeIds(
        evidenceAttackChild,
        treeAt(evidenceAttackChild, round6EvidencePath),
        treeAt(evidenceAttackChild, baselineSnapshotPath),
        authority,
      ),
      /changed the sealed Round 6 evidence tree/u,
    );

    fixtureGit(['checkout', '--quiet', '-b', 'mutate-v082-snapshot', sealedCompletion]);
    writeFileSync(snapshotMarker, 'tampered V0.8.2 snapshot\n', 'utf8');
    const snapshotAttackChild = commitAll('post-completion V0.8.2 snapshot attack');
    assert.throws(
      () => round7AssertHistoricalTreeIds(
        snapshotAttackChild,
        treeAt(snapshotAttackChild, round6EvidencePath),
        treeAt(snapshotAttackChild, baselineSnapshotPath),
        authority,
      ),
      /changed the V0\.8\.2 baseline snapshot tree/u,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function round7RunSealedAuthorityGitAttackSelfTest() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'cats-round7-c1-authority-attack-'));
  const fixtureGit = args => execFileSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const writeFixture = (relativePath, contents) => {
    const absolutePath = path.join(fixtureRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents, 'utf8');
  };
  const commitAll = message => {
    fixtureGit(['add', '--all']);
    fixtureGit(['commit', '--quiet', '-m', message]);
    return fixtureGit(['rev-parse', 'HEAD']).trim();
  };
  const fixturePathExists = (commit, relativePath) => {
    try {
      fixtureGit(['cat-file', '-e', `${commit}:${relativePath}`]);
      return true;
    } catch {
      return false;
    }
  };
  const fixtureChangedEntries = (parent, child) => {
    const fields = execFileSync('git', [
      'diff-tree', '--no-commit-id', '-r', '--name-status', '--no-renames', '-z', parent, child,
    ], {
      cwd: fixtureRoot,
      encoding: null,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8').split('\0').filter(Boolean);
    assert.equal(fields.length % 2, 0);
    const entries = [];
    for (let index = 0; index < fields.length; index += 2) {
      entries.push({ status: fields[index], path: fields[index + 1] });
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  };
  const fixtureExpectedEntries = (parent, relativePaths) => relativePaths.map(relativePath => ({
    status: fixturePathExists(parent, relativePath) ? 'M' : 'A',
    path: relativePath,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const checkoutAttackBranch = (branch, commit) => fixtureGit(['checkout', '--quiet', '-b', branch, commit]);
  try {
    fixtureGit(['init', '--quiet']);
    fixtureGit(['config', 'user.name', 'Round 7 authority attack fixture']);
    fixtureGit(['config', 'user.email', 'round7-authority-fixture@example.invalid']);
    const c1ExistingPaths = new Set([
      ...round7C1TrustRootBlobPaths,
      round7AcceptancePath,
      ...round7ExpectedCompletionPaths.filter(relativePath => (
        relativePath !== round7CompletionPath && relativePath !== round7ExternalAuditPath
      )),
    ]);
    for (const relativePath of c1ExistingPaths) writeFixture(relativePath, `sealed C1 bytes: ${relativePath}\n`);
    const c1 = commitAll('sealed C1 authority fixture');
    const c1TrustRootBindings = round7BlobBindingsAt(fixtureRoot, c1, round7C1TrustRootBlobPaths);

    for (const [index, trustRootPath] of round7C1TrustRootBlobPaths.entries()) {
      checkoutAttackBranch(`trust-root-tamper-${index}`, c1);
      writeFixture(trustRootPath, 'tampered trust-root bytes\n');
      const trustRootAttackChild = commitAll(`post-C1 trust-root-only attack ${index}`);
      assert.throws(
        () => round7AssertFrozenBlobBindings(
          trustRootAttackChild,
          c1TrustRootBindings,
          round7BlobBindingsAt(fixtureRoot, trustRootAttackChild, round7C1TrustRootBlobPaths),
          'validator/workflow trust-root',
        ),
        /changed the C1-sealed validator\/workflow trust-root blobs/u,
      );
    }

    checkoutAttackBranch('exact-c2-control', c1);
    for (const relativePath of round7ExpectedC2Paths) writeFixture(relativePath, `exact C2 addition: ${relativePath}\n`);
    const exactC2 = commitAll('exact C2 control');
    round7AssertExactEntryContract(
      fixtureChangedEntries(c1, exactC2),
      fixtureExpectedEntries(c1, round7ExpectedC2Paths),
      'isolated exact C2 control',
    );

    checkoutAttackBranch('c2-validator-stub-attack', c1);
    for (const relativePath of round7ExpectedC2Paths) writeFixture(relativePath, `C2 addition: ${relativePath}\n`);
    writeFixture('tests/verify-step-1-baseline.mjs', 'process.exit(0); // forged PASS stub\n');
    const c2StubAttack = commitAll('C2 plus validator PASS stub attack');
    assert.throws(
      () => round7AssertExactEntryContract(
        fixtureChangedEntries(c1, c2StubAttack),
        fixtureExpectedEntries(c1, round7ExpectedC2Paths),
        'isolated C2 validator-stub attack',
      ),
      /differs from its exact path\/addition-modification contract/u,
    );

    checkoutAttackBranch('completion-authority-rewrite-attack', c1);
    for (const relativePath of round7ExpectedCompletionPaths) {
      writeFixture(relativePath, `completion edge bytes: ${relativePath}\n`);
    }
    writeFixture(round7AcceptancePath, 'weakened completion Acceptance bytes\n');
    writeFixture('tests/verify-step-1-baseline.mjs', 'process.exit(0); // completion forged PASS stub\n');
    const completionRewriteAttack = commitAll('completion Acceptance and validator rewrite attack');
    assert.throws(
      () => round7AssertExactEntryContract(
        fixtureChangedEntries(c1, completionRewriteAttack),
        fixtureExpectedEntries(c1, round7ExpectedCompletionPaths),
        'isolated completion authority-rewrite attack',
      ),
      /differs from its exact path\/addition-modification contract/u,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function round7RunHistoricalVerifier(includeRemote, includeLive) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cats-round7-historical-'));
  const contextWorktree = path.join(temporaryRoot, 'round6-merge-context');
  const sealWorktree = path.join(temporaryRoot, 'round6-c3-seal');
  let contextAdded = false;
  let sealAdded = false;
  try {
    round7Git(['worktree', 'add', '--detach', contextWorktree, round7BaseCommit]);
    contextAdded = true;
    round7Git(['worktree', 'add', '--detach', sealWorktree, round6C3Commit]);
    sealAdded = true;
    const historicalArgs = [];
    if (includeRemote) historicalArgs.push('--remote');
    if (includeLive) historicalArgs.push('--live');
    const historicalEnvironment = {
      ...process.env,
      CATS_REPO_ROOT: contextWorktree,
      CATS_SEAL_COMMIT: round6C3Commit,
      CATS_SEALED_REENTRY: '1',
    };
    execFileSync(
      process.execPath,
      [path.join(sealWorktree, 'tests/verify-step-1-baseline.mjs'), ...historicalArgs],
      {
        cwd: sealWorktree,
        env: historicalEnvironment,
        stdio: 'inherit',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } finally {
    if (sealAdded) {
      try { round7Git(['worktree', 'remove', '--force', sealWorktree]); } catch { /* preserve the primary failure */ }
    }
    if (contextAdded) {
      try { round7Git(['worktree', 'remove', '--force', contextWorktree]); } catch { /* preserve the primary failure */ }
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function round7ExactLineCount(contents, expectedLine) {
  return contents.split(/\r?\n/u).filter(line => line === expectedLine).length;
}

function round7ExactSubstringCount(contents, expectedSubstring) {
  assert.equal(typeof contents, 'string');
  assert.equal(typeof expectedSubstring, 'string');
  assert(expectedSubstring.length > 0, 'Round 7 exact replacement source may not be empty');
  let count = 0;
  let offset = 0;
  while (offset <= contents.length - expectedSubstring.length) {
    const index = contents.indexOf(expectedSubstring, offset);
    if (index === -1) break;
    count += 1;
    offset = index + expectedSubstring.length;
  }
  return count;
}

function round7ApplyCompletionMarkdownTransform(sourceBytes, transform, label) {
  const sourceBuffer = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes, 'utf8');
  let expectedByteString = sourceBuffer.toString('latin1');
  for (const replacement of transform.exactReplacements) {
    const fromByteString = Buffer.from(replacement.from, 'utf8').toString('latin1');
    const toByteString = Buffer.from(replacement.to, 'utf8').toString('latin1');
    assert.equal(
      round7ExactSubstringCount(expectedByteString, fromByteString),
      replacement.requiredCount,
      `${label} C3 source does not contain the exact mechanical replacement count`,
    );
    expectedByteString = expectedByteString.replaceAll(fromByteString, toByteString);
  }
  return Buffer.from(expectedByteString, 'latin1');
}

function round7AssertCompletionMarkdownBytes(sourceBytes, completionBytes, transform, label) {
  assert.deepEqual(
    Buffer.isBuffer(completionBytes) ? completionBytes : Buffer.from(completionBytes, 'utf8'),
    round7ApplyCompletionMarkdownTransform(sourceBytes, transform, label),
    `${label} completion bytes differ from C3 beyond the exact status-marker and checklist transforms`,
  );
}

function round7JsonPointerSegments(pointer, label) {
  assert.equal(typeof pointer, 'string', `${label} JSON pointer must be a string`);
  assert(pointer.startsWith('/') && pointer.length > 1, `${label} JSON pointer must be absolute and non-root`);
  return pointer.slice(1).split('/').map(segment => {
    assert(!/~(?:[^01]|$)/u.test(segment), `${label} JSON pointer has an invalid escape`);
    return segment.replaceAll('~1', '/').replaceAll('~0', '~');
  });
}

function round7ApplyCompletionProjectStatusTransform(sourceStatus, transforms, label) {
  const expectedStatus = JSON.parse(JSON.stringify(sourceStatus));
  for (const transform of transforms) {
    const segments = round7JsonPointerSegments(transform.pointer, label);
    let owner = expectedStatus;
    for (const segment of segments.slice(0, -1)) {
      assert(owner !== null && typeof owner === 'object', `${label} JSON pointer traverses a non-object`);
      assert(Object.hasOwn(owner, segment), `${label} JSON pointer does not exist at ${transform.pointer}`);
      owner = owner[segment];
    }
    const key = segments.at(-1);
    assert(owner !== null && typeof owner === 'object', `${label} JSON pointer owner is not an object`);
    assert(Object.hasOwn(owner, key), `${label} JSON pointer does not exist at ${transform.pointer}`);
    assert.deepEqual(owner[key], transform.from, `${label} source differs at ${transform.pointer}`);
    owner[key] = JSON.parse(JSON.stringify(transform.to));
  }
  return expectedStatus;
}

function round7AssertCompletionProjectStatus(sourceStatus, completionStatus, transformAuthority, label) {
  const expectedStatus = round7ApplyCompletionProjectStatusTransform(
    sourceStatus,
    transformAuthority.projectStatus,
    label,
  );
  assert.equal(
    expectedStatus.step1Round7.completionReportAllowed,
    transformAuthority.completionReportAllowedAtCommit,
    `${label} completion-report flag differs from the frozen pre-final-report boundary`,
  );
  assert.deepEqual(
    completionStatus,
    expectedStatus,
    `${label} completion PROJECT_STATUS differs from the exact C3 mechanical transform`,
  );
}

function round7AssertCompletionCanonicalTransformAt(root, c3, completionCommit, transformAuthority) {
  for (const relativePath of transformAuthority.canonicalMarkdown.paths) {
    round7AssertCompletionMarkdownBytes(
      round7GitAt(root, ['show', `${c3}:${relativePath}`], null),
      round7GitAt(root, ['show', `${completionCommit}:${relativePath}`], null),
      transformAuthority.canonicalMarkdown,
      `Round 7 ${relativePath}`,
    );
  }
  round7AssertCompletionProjectStatus(
    round7ReadCommitJsonAt(root, c3, 'PROJECT_STATUS.json', 'Round 7 C3 PROJECT_STATUS.json'),
    round7ReadCommitJsonAt(root, completionCommit, 'PROJECT_STATUS.json', 'Round 7 completion PROJECT_STATUS.json'),
    transformAuthority,
    'Round 7 PROJECT_STATUS.json',
  );
}

function round7AssertCompletionCanonicalTransform(c3, completionCommit, transformAuthority) {
  round7AssertCompletionCanonicalTransformAt(repoRoot, c3, completionCommit, transformAuthority);
}

function round7CompletionStatusFixture() {
  return {
    documentationBranch: 'codex/restart-step-1-round7',
    preparation: [{ order: 1, name: 'legacy-v082-source-runtime-byte-checkpoint', status: 'IN_PROGRESS' }],
    step1Round7: {
      status: 'IN_PROGRESS',
      completionReportAllowed: false,
      externalAudit: { state: 'PENDING', authorizesCanonicalPass: false },
      completionSeal: { state: 'PENDING', authorizesCanonicalPass: true },
      protectedHistory: 'unchanged',
    },
    nextAction: 'complete-step-1-round-7-external-audit-and-completion-seal',
    protectedTopLevel: { value: 'unchanged' },
  };
}

function round7RunCompletionTransformAttackSelfTest() {
  const markdownTransform = round7ExpectedCompletionTransforms.canonicalMarkdown;
  const sourceMarkdown = Buffer.from([
    '# completion transform fixture',
    markdownTransform.exactReplacements[0].from,
    'protected prose that completion may not delete or rewrite',
    markdownTransform.exactReplacements[1].from,
    '',
  ].join('\n'), 'utf8');
  const validMarkdown = round7ApplyCompletionMarkdownTransform(
    sourceMarkdown,
    markdownTransform,
    'Round 7 completion Markdown self-test',
  );
  round7AssertCompletionMarkdownBytes(
    sourceMarkdown,
    validMarkdown,
    markdownTransform,
    'Round 7 completion Markdown control',
  );
  assert.throws(
    () => round7AssertCompletionMarkdownBytes(
      sourceMarkdown,
      Buffer.from(validMarkdown.toString('utf8').replace('protected prose that completion may not delete or rewrite\n', ''), 'utf8'),
      markdownTransform,
      'Round 7 completion Markdown deletion attack',
    ),
    /differ from C3 beyond the exact status-marker and checklist transforms/u,
  );
  assert.throws(
    () => round7AssertCompletionMarkdownBytes(
      sourceMarkdown,
      Buffer.from(validMarkdown.toString('utf8').replace('protected prose', 'rewritten prose'), 'utf8'),
      markdownTransform,
      'Round 7 completion Markdown rewrite attack',
    ),
    /differ from C3 beyond the exact status-marker and checklist transforms/u,
  );
  assert.throws(
    () => round7AssertCompletionMarkdownBytes(
      sourceMarkdown,
      Buffer.concat([validMarkdown, Buffer.from([0xff])]),
      markdownTransform,
      'Round 7 completion Markdown arbitrary-byte attack',
    ),
    /differ from C3 beyond the exact status-marker and checklist transforms/u,
  );

  const sourceStatus = round7CompletionStatusFixture();
  const validStatus = round7ApplyCompletionProjectStatusTransform(
    sourceStatus,
    round7ExpectedCompletionTransforms.projectStatus,
    'Round 7 completion PROJECT_STATUS self-test',
  );
  round7AssertCompletionProjectStatus(
    sourceStatus,
    validStatus,
    round7ExpectedCompletionTransforms,
    'Round 7 completion PROJECT_STATUS control',
  );
  const extraKeyAttack = JSON.parse(JSON.stringify(validStatus));
  extraKeyAttack.unapproved = true;
  assert.throws(
    () => round7AssertCompletionProjectStatus(
      sourceStatus,
      extraKeyAttack,
      round7ExpectedCompletionTransforms,
      'Round 7 completion PROJECT_STATUS extra-key attack',
    ),
    /differs from the exact C3 mechanical transform/u,
  );
  const deletionAttack = JSON.parse(JSON.stringify(validStatus));
  delete deletionAttack.protectedTopLevel;
  assert.throws(
    () => round7AssertCompletionProjectStatus(
      sourceStatus,
      deletionAttack,
      round7ExpectedCompletionTransforms,
      'Round 7 completion PROJECT_STATUS deletion attack',
    ),
    /differs from the exact C3 mechanical transform/u,
  );
  const rewriteAttack = JSON.parse(JSON.stringify(validStatus));
  rewriteAttack.step1Round7.protectedHistory = 'rewritten';
  assert.throws(
    () => round7AssertCompletionProjectStatus(
      sourceStatus,
      rewriteAttack,
      round7ExpectedCompletionTransforms,
      'Round 7 completion PROJECT_STATUS rewrite attack',
    ),
    /differs from the exact C3 mechanical transform/u,
  );
}

function round7RunCompletionTransformGitAttackSelfTest() {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'cats-round7-completion-transform-'));
  const fixtureGit = args => round7GitAt(fixtureRoot, args, 'utf8');
  const writeFixture = (relativePath, contents) => {
    const absolutePath = path.join(fixtureRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  };
  const commitAll = message => {
    fixtureGit(['add', '--all']);
    fixtureGit(['commit', '--quiet', '-m', message]);
    return fixtureGit(['rev-parse', 'HEAD']).trim();
  };
  const checkoutFromC3 = (branch, c3) => fixtureGit(['checkout', '--quiet', '-b', branch, c3]);
  const materializeValidCompletion = c3 => {
    for (const relativePath of round7ExpectedCompletionTransforms.canonicalMarkdown.paths) {
      writeFixture(
        relativePath,
        round7ApplyCompletionMarkdownTransform(
          round7GitAt(fixtureRoot, ['show', `${c3}:${relativePath}`], null),
          round7ExpectedCompletionTransforms.canonicalMarkdown,
          `Round 7 isolated ${relativePath}`,
        ),
      );
    }
    const expectedStatus = round7ApplyCompletionProjectStatusTransform(
      round7ReadCommitJsonAt(fixtureRoot, c3, 'PROJECT_STATUS.json', 'Round 7 isolated C3 PROJECT_STATUS'),
      round7ExpectedCompletionTransforms.projectStatus,
      'Round 7 isolated PROJECT_STATUS',
    );
    writeFixture('PROJECT_STATUS.json', `${JSON.stringify(expectedStatus, null, 2)}\n`);
  };
  try {
    fixtureGit(['init', '--quiet']);
    fixtureGit(['config', 'user.name', 'Round 7 completion transform fixture']);
    fixtureGit(['config', 'user.email', 'round7-completion-transform@example.invalid']);
    for (const relativePath of round7ExpectedCompletionTransforms.canonicalMarkdown.paths) {
      writeFixture(relativePath, Buffer.from([
        `# ${relativePath}`,
        round7ExpectedCompletionTransforms.canonicalMarkdown.exactReplacements[0].from,
        `protected prose for ${relativePath}`,
        round7ExpectedCompletionTransforms.canonicalMarkdown.exactReplacements[1].from,
        '',
      ].join('\n'), 'utf8'));
    }
    writeFixture('PROJECT_STATUS.json', `${JSON.stringify(round7CompletionStatusFixture(), null, 2)}\n`);
    const c3 = commitAll('isolated C3 transform source');

    checkoutFromC3('valid-completion', c3);
    materializeValidCompletion(c3);
    const validCompletion = commitAll('isolated valid completion transform');
    round7AssertCompletionCanonicalTransformAt(
      fixtureRoot,
      c3,
      validCompletion,
      round7ExpectedCompletionTransforms,
    );

    checkoutFromC3('markdown-deletion-attack', c3);
    materializeValidCompletion(c3);
    const attackedMarkdownPath = round7ExpectedCompletionTransforms.canonicalMarkdown.paths[0];
    writeFixture(
      attackedMarkdownPath,
      readFileSync(path.join(fixtureRoot, attackedMarkdownPath), 'utf8')
        .replace(`protected prose for ${attackedMarkdownPath}\n`, ''),
    );
    const markdownDeletion = commitAll('isolated Markdown deletion attack');
    assert.throws(
      () => round7AssertCompletionCanonicalTransformAt(
        fixtureRoot,
        c3,
        markdownDeletion,
        round7ExpectedCompletionTransforms,
      ),
      /differ from C3 beyond the exact status-marker and checklist transforms/u,
    );

    checkoutFromC3('markdown-rewrite-attack', c3);
    materializeValidCompletion(c3);
    writeFixture(
      attackedMarkdownPath,
      readFileSync(path.join(fixtureRoot, attackedMarkdownPath), 'utf8')
        .replace('protected prose', 'arbitrarily rewritten prose'),
    );
    const markdownRewrite = commitAll('isolated Markdown rewrite attack');
    assert.throws(
      () => round7AssertCompletionCanonicalTransformAt(
        fixtureRoot,
        c3,
        markdownRewrite,
        round7ExpectedCompletionTransforms,
      ),
      /differ from C3 beyond the exact status-marker and checklist transforms/u,
    );

    checkoutFromC3('project-status-extra-key-attack', c3);
    materializeValidCompletion(c3);
    const extraKeyStatus = parseJsonStrict(
      readFileSync(path.join(fixtureRoot, 'PROJECT_STATUS.json'), 'utf8'),
      'Round 7 isolated extra-key source',
    );
    extraKeyStatus.unapproved = true;
    writeFixture('PROJECT_STATUS.json', `${JSON.stringify(extraKeyStatus, null, 2)}\n`);
    const extraKeyCommit = commitAll('isolated PROJECT_STATUS extra-key attack');
    assert.throws(
      () => round7AssertCompletionCanonicalTransformAt(
        fixtureRoot,
        c3,
        extraKeyCommit,
        round7ExpectedCompletionTransforms,
      ),
      /differs from the exact C3 mechanical transform/u,
    );

    checkoutFromC3('project-status-deletion-attack', c3);
    materializeValidCompletion(c3);
    const deletionStatus = parseJsonStrict(
      readFileSync(path.join(fixtureRoot, 'PROJECT_STATUS.json'), 'utf8'),
      'Round 7 isolated deletion source',
    );
    delete deletionStatus.protectedTopLevel;
    writeFixture('PROJECT_STATUS.json', `${JSON.stringify(deletionStatus, null, 2)}\n`);
    const deletionCommit = commitAll('isolated PROJECT_STATUS deletion attack');
    assert.throws(
      () => round7AssertCompletionCanonicalTransformAt(
        fixtureRoot,
        c3,
        deletionCommit,
        round7ExpectedCompletionTransforms,
      ),
      /differs from the exact C3 mechanical transform/u,
    );

    checkoutFromC3('project-status-rewrite-attack', c3);
    materializeValidCompletion(c3);
    const rewriteStatus = parseJsonStrict(
      readFileSync(path.join(fixtureRoot, 'PROJECT_STATUS.json'), 'utf8'),
      'Round 7 isolated rewrite source',
    );
    rewriteStatus.step1Round7.protectedHistory = 'rewritten';
    writeFixture('PROJECT_STATUS.json', `${JSON.stringify(rewriteStatus, null, 2)}\n`);
    const rewriteCommit = commitAll('isolated PROJECT_STATUS rewrite attack');
    assert.throws(
      () => round7AssertCompletionCanonicalTransformAt(
        fixtureRoot,
        c3,
        rewriteCommit,
        round7ExpectedCompletionTransforms,
      ),
      /differs from the exact C3 mechanical transform/u,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

round7RunCompletionTransformAttackSelfTest();
round7RunCompletionTransformGitAttackSelfTest();

function round7AssertCanonicalStatusAt(commit, expectedStatus) {
  const marker = `工程状態: 工程1A=${expectedStatus} / 工程2=PENDING_REVALIDATION / 工程3=PENDING_REVALIDATION / 工程4以降=NOT_STARTED`;
  const checklist = `1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — \`${expectedStatus}\``;
  for (const relativePath of round7CanonicalMarkdownPaths) {
    const contents = round7Git(['show', `${commit}:${relativePath}`], 'utf8');
    assert.equal(round7ExactLineCount(contents, marker), 1, `${commit}:${relativePath} must contain one exact Round 7 status marker line`);
    assert.equal(round7ExactLineCount(contents, checklist), 1, `${commit}:${relativePath} must contain one exact Round 7 checklist row`);
  }
  const status = round7ReadCommitJson(commit, 'PROJECT_STATUS.json', `Round 7 PROJECT_STATUS.json at ${commit}`);
  assert.equal(status.nextAction, round7NextActionByStatus[expectedStatus], `${commit}:PROJECT_STATUS.json has the wrong Round 7 nextAction`);
  assert.deepEqual(status.preparation[0], {
    order: 1,
    name: 'legacy-v082-source-runtime-byte-checkpoint',
    status: expectedStatus,
  });
  assert.equal(
    status.preparation.filter(item => item?.name === 'legacy-v082-source-runtime-byte-checkpoint').length,
    1,
    'PROJECT_STATUS duplicates the Round 7 Step 1A preparation name',
  );
  assert.equal(
    status.preparation.filter(item => item?.order === 1).length,
    1,
    'PROJECT_STATUS duplicates the Round 7 Step 1A preparation order',
  );
}

function round7AssertCurrentStepOnePass(commit) {
  const checklist = '1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — `PASS`';
  for (const relativePath of round7CanonicalMarkdownPaths) {
    const contents = round7Git(['show', `${commit}:${relativePath}`], 'utf8');
    const statusLines = contents.split(/\r?\n/u).filter(line => /^工程状態: 工程1A=PASS(?: \/ .+)?$/u.test(line));
    assert.equal(statusLines.length, 1, `${commit}:${relativePath} must retain exactly one Step 1A PASS marker line`);
    assert.equal(round7ExactLineCount(contents, checklist), 1, `${commit}:${relativePath} must retain exactly one Step 1A PASS checklist row`);
  }
  const status = round7ReadCommitJson(commit, 'PROJECT_STATUS.json', `current PROJECT_STATUS.json at ${commit}`);
  assert.deepEqual(status.preparation[0], {
    order: 1,
    name: 'legacy-v082-source-runtime-byte-checkpoint',
    status: 'PASS',
  });
  assert.equal(status.preparation.filter(item => item?.name === 'legacy-v082-source-runtime-byte-checkpoint').length, 1);
  assert.equal(status.preparation.filter(item => item?.order === 1).length, 1);
}

async function round7AssertPreflightCanonicalStatus(expectedStatus) {
  const marker = `工程状態: 工程1A=${expectedStatus} / 工程2=PENDING_REVALIDATION / 工程3=PENDING_REVALIDATION / 工程4以降=NOT_STARTED`;
  const checklist = `1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — \`${expectedStatus}\``;
  for (const relativePath of round7CanonicalMarkdownPaths) {
    const contents = await readFile(path.join(kitRoot, relativePath), 'utf8');
    assert.equal(round7ExactLineCount(contents, marker), 1, `${relativePath} must contain one exact Round 7 status marker line`);
    assert.equal(round7ExactLineCount(contents, checklist), 1, `${relativePath} must contain one exact Round 7 checklist row`);
  }
  const status = parseJsonStrict(await readFile(path.join(kitRoot, 'PROJECT_STATUS.json'), 'utf8'), 'Round 7 preflight PROJECT_STATUS.json');
  assert.equal(status.nextAction, round7NextActionByStatus[expectedStatus], 'Round 7 preflight PROJECT_STATUS.json has the wrong nextAction');
  assert.deepEqual(status.preparation[0], {
    order: 1,
    name: 'legacy-v082-source-runtime-byte-checkpoint',
    status: expectedStatus,
  });
  assert.equal(status.preparation.filter(item => item?.name === 'legacy-v082-source-runtime-byte-checkpoint').length, 1);
  assert.equal(status.preparation.filter(item => item?.order === 1).length, 1);
}

function round7AssertRuntimeUnchanged(head) {
  const manifest = round7ReadCommitJson(
    round7BaseCommit,
    `${round6EvidencePath}/evidence/runtime-manifest.json`,
    'sealed Round 6 runtime-manifest.json',
  );
  const runtimePaths = [...new Set(manifest.entries.map(entry => entry.sourcePath))];
  const deploymentPaths = manifest.deploymentInputs.map(entry => entry.sourcePath);
  assert.equal(runtimePaths.length, 16, 'Round 7 must retain exactly 16 runtime source paths');
  assert.deepEqual([...deploymentPaths].sort(), ['.vercelignore', 'vercel.json']);
  const changed = round7Git([
    'diff', '--name-only', `${baselineCommit}..${head}`, '--', ...runtimePaths, ...deploymentPaths,
  ]).trim();
  assert.equal(changed, '', `Round 7 changed runtime or deployment inputs: ${changed}`);
}

function round7AssertSameRunAuditBinding(audit) {
  assert.equal(audit.workflowId, round7PrimaryWorkflowId, 'Round 7 audit must use the primary workflow run');
  assert.notEqual(audit.c3.runId, audit.initialMain.runId, 'Round 7 C3 and initial-main evidence must come from distinct runs');
  assert.notEqual(audit.c3.artifact.id, audit.initialMain.artifact.id, 'Round 7 C3 and initial-main evidence must use distinct artifacts');
  assert.notEqual(audit.runId, audit.c3.runId, 'The reusable audit run must be distinct from the C3 source run');
  assert.equal(audit.runId, audit.initialMain.runId, 'The reusable audit job must share the exact initial-main caller run');
  assert.equal(audit.runAttempt, audit.initialMain.runAttempt, 'The reusable audit job must share the exact initial-main caller attempt');
  assert.notEqual(audit.jobId, audit.initialMain.jobId, 'The reusable audit job must be distinct from the primary verification job');
}

function round7AssertSameRunJobOrder(initialMainJob, reusableAuditJob) {
  assert(initialMainJob && reusableAuditJob, 'Provider response omitted the same-run primary or reusable audit job');
  assert(
    Date.parse(initialMainJob.completed_at) <= Date.parse(reusableAuditJob.started_at),
    'The reusable audit job started before the same-run primary verification completed',
  );
}

function round7AssertReusableAuditStepLedger(job, c3Conclusion) {
  assert(Array.isArray(job.steps), 'Same-run reusable audit job has no provider step ledger');
  assert(['success', 'skipped'].includes(c3Conclusion), 'Unexpected C3 audit step conclusion contract');
  const customSteps = job.steps.filter(step => round7ReusableAuditRequiredSteps.includes(step.name));
  assert.deepEqual(
    customSteps.map(step => step.name),
    round7ReusableAuditRequiredSteps,
    'Same-run reusable audit custom steps differ from the exact C1 order',
  );
  for (const step of customSteps) {
    const expectedConclusion = step.name === 'Verify Round 7 C3 pull-request artifact'
      ? c3Conclusion
      : 'success';
    assert.equal(step.conclusion, expectedConclusion, `Reusable audit step has the wrong outcome: ${step.name}`);
  }
}

function round7AssertCompletionMergeProviderCandidate(completionMerge, currentRunStartedAt, run, jobsResponse) {
  assert.equal(run.workflow_id, round7PrimaryWorkflowId);
  assert.equal(run.name, "Verify Cat's Tower baseline and quality records");
  assert.equal(run.path, '.github/workflows/verify-main.yml');
  assert.equal(run.event, 'push');
  assert.equal(run.head_branch, 'main');
  assert.equal(run.head_sha, completionMerge);
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert(Number.isSafeInteger(run.id) && run.id > 0);
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  const matchingPrimaryJobs = jobsResponse.jobs.filter(job => (
    job.name === 'vertical-tower-qa'
    && job.run_id === run.id
    && job.run_attempt === run.run_attempt
    && job.head_sha === completionMerge
  ));
  const matchingAuditJobs = jobsResponse.jobs.filter(job => (
    job.name === round7ReusableAuditJobName
    && job.run_id === run.id
    && job.run_attempt === run.run_attempt
    && job.head_sha === completionMerge
  ));
  assert.equal(matchingPrimaryJobs.length, 1, 'Completion-merge run does not have exactly one primary verification job');
  assert.equal(matchingAuditJobs.length, 1, 'Completion-merge run does not have exactly one same-run reusable audit job');
  const [primaryJob] = matchingPrimaryJobs;
  const [auditJob] = matchingAuditJobs;
  round7AssertProviderIdentityPayload(
    { runId: run.id, runAttempt: run.run_attempt, jobId: primaryJob.id },
    {
      workflowId: round7PrimaryWorkflowId,
      workflowName: "Verify Cat's Tower baseline and quality records",
      jobName: 'vertical-tower-qa',
      requiredSteps: [
        'GitHub recovery ref and live runtime manifest',
        'Exercise repaired artifact transport against Round 6 provider artifacts',
      ],
      headSha: completionMerge,
      event: 'push',
    },
    run,
    jobsResponse,
  );
  round7AssertProviderIdentityPayload(
    { runId: run.id, runAttempt: run.run_attempt, jobId: auditJob.id },
    {
      workflowId: round7PrimaryWorkflowId,
      workflowName: "Verify Cat's Tower baseline and quality records",
      jobName: round7ReusableAuditJobName,
      headSha: completionMerge,
      event: 'push',
    },
    run,
    jobsResponse,
  );
  round7AssertReusableAuditStepLedger(auditJob, 'skipped');
  round7AssertSameRunJobOrder(primaryJob, auditJob);
  const auditCompletedAt = Date.parse(auditJob.completed_at);
  assert(Number.isFinite(currentRunStartedAt), 'Current descendant provider run has no valid run_started_at');
  assert(auditCompletedAt < currentRunStartedAt, 'Completion-merge audit did not finish before the current descendant run started');
  return {
    runId: run.id,
    runAttempt: run.run_attempt,
    jobId: auditJob.id,
    headSha: completionMerge,
    completedAt: auditJob.completed_at,
  };
}

function round7SelectHistoricalCompletionMergeAudit(qualified) {
  assert(Array.isArray(qualified), 'Completion-merge provider candidates must be an array');
  assert(qualified.length >= 1, 'No earlier successful exact-head completion-merge primary and reusable audit run exists');
  return [...qualified].sort((left, right) => (
    left.runId - right.runId || left.runAttempt - right.runAttempt
  ))[0];
}

async function round7VerifyHistoricalCompletionMergeProvider(completionMerge, currentHead) {
  const currentRunId = Number(process.env.GITHUB_RUN_ID);
  const currentRunAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  assert(Number.isSafeInteger(currentRunId) && currentRunId > 0, 'Later descendants require the current provider run ID');
  assert(Number.isSafeInteger(currentRunAttempt) && currentRunAttempt > 0, 'Later descendants require the current provider run attempt');
  const currentRun = await round7GithubApi(`actions/runs/${currentRunId}/attempts/${currentRunAttempt}`);
  assert.equal(currentRun.id, currentRunId);
  assert.equal(currentRun.run_attempt, currentRunAttempt);
  assert.equal(currentRun.workflow_id, round7PrimaryWorkflowId);
  assert.equal(currentRun.name, "Verify Cat's Tower baseline and quality records");
  assert.equal(currentRun.head_sha, currentHead);
  assert.equal(currentRun.status, 'in_progress');
  assert.equal(currentRun.conclusion, null);
  const currentRunStartedAt = Date.parse(currentRun.run_started_at);
  assert(Number.isFinite(currentRunStartedAt), 'Current descendant provider run has no valid run_started_at');

  const listedRuns = await round7GithubAllPrimaryRuns();
  const candidates = listedRuns.filter(run => (
    run.workflow_id === round7PrimaryWorkflowId
    && run.name === "Verify Cat's Tower baseline and quality records"
    && run.path === '.github/workflows/verify-main.yml'
    && run.event === 'push'
    && run.head_branch === 'main'
    && run.head_sha === completionMerge
  ));
  const qualified = [];
  for (const candidate of candidates) {
    assert(Number.isSafeInteger(candidate.run_attempt) && candidate.run_attempt > 0);
    for (let attempt = 1; attempt <= candidate.run_attempt; attempt += 1) {
      const run = await round7GithubApi(`actions/runs/${candidate.id}/attempts/${attempt}`);
      const jobsResponse = await round7GithubApi(`actions/runs/${candidate.id}/attempts/${attempt}/jobs?per_page=100`);
      try {
        qualified.push(round7AssertCompletionMergeProviderCandidate(
          completionMerge,
          currentRunStartedAt,
          run,
          jobsResponse,
        ));
      } catch {
        // Failed or incomplete attempts do not authorize a later descendant.
      }
    }
  }
  return round7SelectHistoricalCompletionMergeAudit(qualified);
}

function round7ValidateCompletionRecord(completionCommit, initialMerge, c3) {
  const audit = round7ReadCommitJson(completionCommit, round7ExternalAuditPath, 'Round 7 initial external audit record');
  round7AssertExactKeys(audit, [
    'schemaVersion', 'artifactId', 'repository', 'status', 'mode', 'workflowId', 'runId',
    'runAttempt', 'jobId', 'headSha', 'c3', 'initialMain', 'sanitizedArtifact',
    'materialBlockers',
  ], 'Round 7 initial external audit record');
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(audit.repository, round7Repository);
  assert.equal(audit.status, 'PASS');
  assert.equal(audit.mode, 'initial-main-seal');
  assert(Number.isSafeInteger(audit.workflowId) && audit.workflowId > 0);
  assert.equal(audit.workflowId, round7PrimaryWorkflowId);
  assert(Number.isSafeInteger(audit.runId) && audit.runId > 0);
  assert(Number.isSafeInteger(audit.runAttempt) && audit.runAttempt > 0);
  assert(Number.isSafeInteger(audit.jobId) && audit.jobId > 0);
  assert.equal(audit.headSha, initialMerge);
  assert.deepEqual(audit.materialBlockers, []);
  round7AssertArtifact(audit.sanitizedArtifact, 'Round 7 sanitized audit artifact');
  round7AssertSanitizedArtifactName(audit, 'Round 7 initial external audit record');
  for (const [key, label, expectedHead] of [['c3', 'C3', c3], ['initialMain', 'initial main', initialMerge]]) {
    const result = audit[key];
    round7AssertExactKeys(result, [
      'status', 'headSha', 'runId', 'runAttempt', 'jobId', 'artifact',
    ], `Round 7 ${label} audit result`);
    assert.equal(result.status, 'PASS');
    assert.equal(result.headSha, expectedHead);
    assert(Number.isSafeInteger(result.runId) && result.runId > 0);
    assert(Number.isSafeInteger(result.runAttempt) && result.runAttempt > 0);
    assert(Number.isSafeInteger(result.jobId) && result.jobId > 0);
    round7AssertArtifact(result.artifact, `Round 7 ${label} audit artifact`);
    round7AssertAttemptArtifactName(result, `Round 7 ${label} audit result`);
  }
  assert.notEqual(audit.sanitizedArtifact.id, audit.c3.artifact.id, 'Sanitized audit artifact reuses the C3 primary artifact ID');
  assert.notEqual(audit.sanitizedArtifact.id, audit.initialMain.artifact.id, 'Sanitized audit artifact reuses the initial-main primary artifact ID');
  round7AssertSameRunAuditBinding(audit);
  const auditBytes = round7Git(['show', `${completionCommit}:${round7ExternalAuditPath}`], null);
  const completion = round7ReadCommitJson(completionCommit, round7CompletionPath, 'Round 7 completion record');
  round7AssertExactKeys(completion, [
    'schemaVersion', 'artifactId', 'round', 'status', 'canonicalStatus', 'recordedAt',
    'initialMerge', 'externalAuditRecord',
  ], 'Round 7 completion record');
  assert.equal(completion.schemaVersion, 1);
  assert.equal(completion.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(completion.round, 7);
  assert.equal(completion.status, 'PASS');
  assert.equal(completion.canonicalStatus, 'PASS');
  assert.equal(completion.initialMerge, initialMerge);
  assert.equal(typeof completion.recordedAt, 'string');
  assert.match(
    completion.recordedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
    'Round 7 completion recordedAt is not RFC3339',
  );
  assert(Number.isFinite(Date.parse(completion.recordedAt)), 'Round 7 completion recordedAt is not a valid timestamp');
  const completionCommitTime = Date.parse(round7Git(['show', '-s', '--format=%cI', completionCommit]).trim());
  assert(
    Date.parse(completion.recordedAt) <= completionCommitTime + 5 * 60 * 1000,
    'Round 7 completion recordedAt is materially later than its commit timestamp',
  );
  round7AssertExactKeys(completion.externalAuditRecord, ['path', 'sha256'], 'Round 7 completion externalAuditRecord');
  assert.deepEqual(completion.externalAuditRecord, {
    path: round7ExternalAuditPath,
    sha256: createHash('sha256').update(auditBytes).digest('hex'),
  });
  return { audit, completion };
}

async function round7VerifyCompletionProvider(audit, completion, c3, initialMerge) {
  const external = await round7VerifyProviderIdentity(audit, {
    workflowId: audit.workflowId,
    workflowName: "Verify Cat's Tower baseline and quality records",
    jobName: round7ReusableAuditJobName,
    requiredSteps: round7ReusableAuditRequiredSteps,
    headSha: initialMerge,
    event: 'push',
  });
  await round7VerifyProviderIdentity(audit.c3, {
    workflowId: round7PrimaryWorkflowId,
    workflowName: "Verify Cat's Tower baseline and quality records",
    jobName: 'vertical-tower-qa',
    requiredSteps: [
      'Exercise repaired artifact transport against Round 6 provider artifacts',
      'GitHub recovery ref and live runtime manifest',
    ],
    headSha: c3,
    event: 'pull_request',
  });
  const initialMainProvider = await round7VerifyProviderIdentity(audit.initialMain, {
    workflowId: round7PrimaryWorkflowId,
    workflowName: "Verify Cat's Tower baseline and quality records",
    jobName: 'vertical-tower-qa',
    requiredSteps: [
      'Exercise repaired artifact transport against Round 6 provider artifacts',
      'GitHub recovery ref and live runtime manifest',
    ],
    headSha: initialMerge,
    event: 'push',
  });
  const sanitizedArtifactIdentity = {
    runId: audit.runId,
    runAttempt: audit.runAttempt,
    jobId: audit.jobId,
    artifact: audit.sanitizedArtifact,
  };
  const sanitizedArtifactsResponse = await round7GithubApi(`actions/runs/${audit.runId}/artifacts?per_page=100`);
  const exactSanitizedArtifact = await round7GithubApi(`actions/artifacts/${audit.sanitizedArtifact.id}`);
  round7AssertProviderArtifactListAndExact(
    sanitizedArtifactIdentity,
    {
      workflowId: audit.workflowId,
      workflowName: "Verify Cat's Tower baseline and quality records",
      jobName: round7ReusableAuditJobName,
      requiredSteps: round7ReusableAuditRequiredSteps,
      headSha: initialMerge,
      event: 'push',
    },
    external.run,
    external.jobsResponse,
    sanitizedArtifactsResponse,
    exactSanitizedArtifact,
  );
  const externalJob = external.jobsResponse.jobs.find(job => job.id === audit.jobId);
  const initialMainJob = initialMainProvider.jobsResponse.jobs.find(job => job.id === audit.initialMain.jobId);
  round7AssertReusableAuditStepLedger(externalJob, 'success');
  round7AssertSameRunJobOrder(initialMainJob, externalJob);
  assert(Number.isFinite(Date.parse(external.run.updated_at)), 'External audit provider run has no valid updated_at');
  assert(
    Date.parse(completion.recordedAt) >= Date.parse(external.run.updated_at),
    'Round 7 completion was recorded before the provider reported the external audit complete',
  );
}

async function verifyRound7Layer() {
  assert.equal(round7Git(['rev-parse', '--is-shallow-repository']).trim(), 'false', 'Round 7 verification requires full history');
  assert.equal(round7Git(['replace', '-l']).trim(), '', 'Git replace refs are forbidden during Round 7 verification');
  assert.equal(round7Git(['rev-parse', `${round7BaseCommit}^{commit}`]).trim(), round7BaseCommit);
  assert.equal(round7Git(['rev-parse', `${round7BaseCommit}^{tree}`]).trim(), round7BaseTree);
  assert.equal(round7Git(['rev-parse', `${round6C3Commit}^{commit}`]).trim(), round6C3Commit);

  const head = round7Git(['rev-parse', 'HEAD']).trim();
  const c1Introductions = round7Introductions(round7AcceptancePath, head);
  const acceptanceBytes = c1Introductions.length === 0
    ? await readFile(path.join(kitRoot, round7AcceptancePath))
    : round7Git(['show', `${c1Introductions[0]}:${round7AcceptancePath}`], null);
  const acceptance = parseJsonStrict(acceptanceBytes.toString('utf8'), 'Round 7 Acceptance');
  const acceptanceSha256 = createHash('sha256').update(acceptanceBytes).digest('hex');
  assert.equal(acceptance.schemaVersion, 1);
  assert.equal(acceptance.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(acceptance.acceptanceRevision, 1);
  assert.equal(acceptance.status, 'FROZEN_AT_C1');
  assert.equal(acceptance.baseCommit, round7BaseCommit);
  assert.equal(acceptance.baseTree, round7BaseTree);
  assert.equal(acceptance.predecessor.internalSeal, round6C3Commit);
  assert.equal(acceptance.predecessor.merge, round7BaseCommit);
  assert.equal(acceptance.predecessor.overallStatus, 'FAIL');
  assert.equal(acceptance.predecessor.failureRecord, round7FailurePath);
  assert.deepEqual(acceptance.immutableHistoricalTrees, {
    [round6EvidencePath]: round6EvidenceTree,
    [baselineSnapshotPath]: baselineSnapshotTree,
  });
  assert.deepEqual(
    acceptance.commitProtocol,
    round7ExpectedCommitProtocol,
    'Round 7 commitProtocol differs from the frozen mechanical completion authority',
  );
  assert.deepEqual(
    acceptance.completionTransforms,
    round7ExpectedCompletionTransforms,
    'Round 7 completionTransforms differ from the frozen C3-to-completion mechanical authority',
  );
  assert.deepEqual(acceptance.trustRoot, {
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
        path: '.github/workflows/verify-main.yml',
        blobBinding: 'exact-c1-git-blob',
        executionAuthority: 'event-time-github-workflow-sha-bound-in-provenance',
      },
      external: {
        path: '.github/workflows/verify-step-1-artifacts.yml',
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
  }, 'Round 7 trustRoot differs from the frozen C1 authority model');
  assert.deepEqual(acceptance.externalAuditProtocol, {
    activeSeal: round7RecordPath,
    triggerAuthority: 'main-push-only reusable audit job invoked after the primary verification job through a relative same-commit workflow_call; a separate default-branch workflow_run cannot authorize completion',
    callerRunState: 'during the reusable audit, the exact caller run may still be in_progress with null conclusion, but its primary verification job must already be completed success and its provider-bound artifact must exist; completion evidence must later re-query the same run as completed success with the reusable audit job completed success',
    initialMode: 'only the exact Round 7 initial merge main-push run; after that same run uploads its primary artifact, execute the detached C1 artifact verifier against the current target repository and verify both the Round 7 C3 PR artifact and the caller run main artifact independently',
    partialFailure: 'attempt both verifications; reconstruct allowlisted result JSON without persisting raw verifier stdout; upload only the two exact regular non-symlink files from the mode-0700 RUNNER_TEMP boundary with if: always(); then fail an aggregate gate unless both passed',
    completionMergeMode: 'the exact completion merge must itself be the head of a completed successful primary main-push run whose same-run reusable future audit job succeeds with the exact C1 step ledger',
    laterDescendantMode: 'before auditing a later main descendant, discover and bind an earlier provider run on the exact completion merge with completed success primary and same-run reusable audit jobs; a descendant run cannot substitute for or bootstrap a missing completion-merge run, and retained artifact bytes are not required',
    futureMode: 'in the current main-push run, requires an earlier provider-bound successful same-run reusable Round 7 initial audit for the exact initial merge, then executes the detached C1 artifact verifier against the current target repository and verifies the caller run main artifact; the immediate completion merge re-queries the unexpired sanitized audit artifact, while later descendants bind its frozen completion identity and provider run/job ledger without requiring the historical C3 or sanitized audit artifact to remain downloadable',
    round6SuccessMayBootstrapRound7: false,
  }, 'Round 7 externalAuditProtocol differs from the same-run reusable authority model');
  assert.deepEqual(
    Object.keys(acceptance.evidenceSchemas).sort(),
    ['artifactSmokeRecord', 'ciRecord', 'completion', 'criticRecord', 'finalJudgeRecord'].sort(),
    'Round 7 evidenceSchemas top-level keys differ from the frozen authority',
  );
  assert.deepEqual(acceptance.evidenceSchemas.completion, {
    completionRequired: 'PASS record binding the exact initial merge and SHA-256 of the external-audit record',
    externalAuditRequired: 'provider-verified successful initial-main-seal primary workflow run and its same-run reusable audit job with independent PASS results for C3 and initial main',
    sanitizedAuditArtifactRequired: 'exact provider id, source-run-and-attempt-scoped name, digest, and size binding for the same-run uploaded two-file sanitized evidence artifact',
  });
  assert.deepEqual(acceptance.externalCompletionStopConditions, [
    'C1 is the unique immutable Round 7 trust root; every post-C1 validation uses its detached sealed validator or artifact-verifier bytes against the current target repository, and both workflow blobs remain byte-identical to C1',
    'C1 exact-head CI and real-provider Round 6 C3/main artifact smoke succeed through the repaired transport',
    'three independent C1 critics report no material blocker',
    'C2 exact-head CI and a separate final judge report no material blocker',
    'C3 exact-head PR CI and Vercel Preview succeed',
    'the exact two-parent Round 7 initial merge preserves C1/C2/C3 and has the C3 tree',
    'the exact initial merge main-push primary verification job succeeds and uploads its bound artifact',
    'the same source-bound main-push run invokes the relative reusable audit workflow after the primary job; it verifies both the Round 7 C3 and caller-run main artifacts, proves the exact sanitized RUNNER_TEMP upload boundary, uploads sanitized evidence, binds that upload to exact provider id, scoped name, digest, and size, and passes its aggregate gate',
    'the completion record binds that external audit before canonical status changes to PASS',
    'the exact completion merge is independently pushed and its primary job and same-run future-main reusable audit job succeed; every later descendant must provider-bind that earlier exact completion-merge run and cannot bootstrap its absence',
    'the archive ref, fixed Production deployment metadata, and all 17 live runtime bytes are rechecked after the completion merge',
  ], 'Round 7 external completion stop conditions differ from the same-run reusable authority');
  assert.equal(new Set(acceptance.c1AllowedPaths).size, acceptance.c1AllowedPaths.length);
  assert.equal(new Set(acceptance.c2AllowedPaths).size, acceptance.c2AllowedPaths.length);
  assert.equal(new Set(acceptance.c3AllowedPaths).size, acceptance.c3AllowedPaths.length);
  assert.equal(new Set(acceptance.completionAllowedPaths).size, acceptance.completionAllowedPaths.length);
  round7AssertFrozenPathLists(acceptance);
  assert.deepEqual([...acceptance.c1AllowedPaths.filter(relativePath => relativePath.endsWith('.md'))].sort(), [...round7CanonicalMarkdownPaths].sort());
  assert(acceptance.c1AllowedPaths.includes('tests/verify-step-1-baseline.mjs'));
  assert(acceptance.c1AllowedPaths.includes(round7AcceptancePath));
  assert(acceptance.c1AllowedPaths.includes(round7FailurePath));
  assert(acceptance.c3AllowedPaths.includes(round7RecordPath));
  assert(acceptance.completionAllowedPaths.includes(round7CompletionPath));
  assert(acceptance.completionAllowedPaths.includes(round7ExternalAuditPath));
  assert.deepEqual(
    [...acceptance.canonicalStatusMirrors].sort(),
    [...round7CanonicalMarkdownPaths, 'PROJECT_STATUS.json'].sort(),
    'Round 7 canonical mirror authority differs from the validator kernel',
  );
  assert.deepEqual(acceptance.evidenceSchemas.ciRecord.exactKeys, round7CiRecordKeys);
  assert.deepEqual(acceptance.evidenceSchemas.ciRecord.artifactExactKeys, round7ArtifactKeys);
  assert.deepEqual(acceptance.evidenceSchemas.ciRecord.roles, ['c1-ci', 'c2-ci']);
  assert.deepEqual(acceptance.evidenceSchemas.ciRecord.requiredOutcome, {
    status: 'completed', conclusion: 'success', materialBlockers: [],
  });
  assert.deepEqual(acceptance.evidenceSchemas.criticRecord.exactKeys, round7CriticRecordKeys);
  assert.deepEqual(acceptance.evidenceSchemas.criticRecord.artifactExactKeys, round7ArtifactKeys);
  assert.deepEqual(acceptance.evidenceSchemas.criticRecord.roles, [
    'adversarial-critic', 'repository-critic', 'runtime-critic',
  ]);
  assert.deepEqual(acceptance.evidenceSchemas.criticRecord.requiredOutcome, {
    verdict: 'PASS', materialBlockers: [],
  });
  assert.equal(acceptance.evidenceSchemas.finalJudgeRecord.role, 'final-judge');
  assert.equal(acceptance.evidenceSchemas.finalJudgeRecord.criticShapePlusExactKey, 'criticRecordHashes');
  assert.equal(acceptance.evidenceSchemas.finalJudgeRecord.criticRecordHashes, 'exact three path-to-lowercase-sha256 bindings');
  assert.deepEqual(acceptance.evidenceSchemas.artifactSmokeRecord.exactKeys, [
    'schemaVersion', 'artifactId', 'role', 'testedCommit', 'status', 'targets', 'materialBlockers',
  ]);
  assert.deepEqual(acceptance.evidenceSchemas.artifactSmokeRecord.targetExactKeys, round7SmokeTargetKeys);
  assert.equal(acceptance.evidenceSchemas.artifactSmokeRecord.role, 'artifact-download-smoke');
  assert.deepEqual(acceptance.evidenceSchemas.artifactSmokeRecord.requiredOutcome, {
    status: 'PASS', materialBlockers: [],
  });
  assert.deepEqual(acceptance.evidenceSchemas.artifactSmokeRecord.targetRoles, ['round6-c3', 'round6-main']);
  assert.deepEqual(acceptance.evidenceSchemas.artifactSmokeRecord.targetRequiredOutcome, {
    firstHopStatus: 302,
    secondHopStatus: 200,
    storageAuthorizationSent: false,
    archiveMemberCount: 95,
    provenanceMemberCount: 1,
    passReportCount: 10,
    result: 'PASS',
  });

  const failureBytes = c1Introductions.length === 0
    ? await readFile(path.join(kitRoot, round7FailurePath))
    : round7Git(['show', `${c1Introductions[0]}:${round7FailurePath}`], null);
  const failure = parseJsonStrict(failureBytes.toString('utf8'), 'Round 6 post-main failure record');
  assert.equal(failure.schemaVersion, 1);
  assert.equal(failure.artifactId, 'step-1-legacy-baseline-round-007');
  assert.equal(failure.predecessorRound, 6);
  assert.equal(failure.predecessorInternalSeal.c3, round6C3Commit);
  assert.equal(failure.merge.sha, round7BaseCommit);
  assert.equal(failure.failedExternalAudit.runId, 32590920047);
  assert.equal(failure.failedExternalAudit.job.id, 97074517000);
  assert.equal(failure.failedExternalAudit.conclusion, 'failure');
  assert.equal(failure.failedExternalAudit.failureClass, 'implementation-defect');
  assert.equal(failure.finalJudgment.round6Overall, 'FAIL');
  assert.equal(failure.finalJudgment.step1A, 'IN_PROGRESS');
  assert.equal(failure.finalJudgment.completionReportAllowed, false);
  assert.equal(failure.immutability.round6EvidenceTree, round6EvidenceTree);
  assert.equal(failure.immutability.baselineSnapshotTree, baselineSnapshotTree);

  round7AssertHistoricalTrees(round7BaseCommit, acceptance);
  assert.equal(
    round7Git(['status', '--porcelain', '--untracked-files=all', '--', round6EvidencePath, baselineSnapshotPath]).trim(),
    '',
    'Round 7 worktree changed sealed Round 6 or baseline snapshot bytes',
  );
  let c1 = null;
  let c2 = null;
  let c3 = null;
  let initialMerge = null;
  let completionCommit = null;
  let completionMerge = null;
  let c1Ci = null;
  let c2Ci = null;
  let criticBindings = null;
  let smoke = null;
  let completionEvidence = null;
  let phase = 'c1-preflight';

  if (c1Introductions.length === 0) {
    assert(preflight, 'Round 7 Acceptance exists in the worktree but has no committed C1 introduction');
    assert.equal(head, round7BaseCommit, 'Round 7 C1 preflight must start at the exact failed Round 6 merge');
    round7AssertPreflightEdge(round7BaseCommit, acceptance.c1AllowedPaths, 'Round 7 C1 preflight');
    round7AssertPrimaryWorkflowTrustContract();
    await round7AssertPreflightCanonicalStatus('IN_PROGRESS');
    round7AssertRuntimeUnchanged(round7BaseCommit);
    await round7RunHistoricalVerifier(remote, live);
    console.log('Round 7 Step 1 baseline C1 preflight passed.');
    return;
  }

  assert.equal(c1Introductions.length, 1, 'Round 7 Acceptance was introduced more than once in reachable history');
  [c1] = c1Introductions;
  assert.equal(round7SingleParent(c1, 'Round 7 C1'), round7BaseCommit, 'Round 7 C1 is not the direct child of the failed Round 6 merge');
  round7AssertExactEdge(round7BaseCommit, c1, acceptance.c1AllowedPaths, 'Round 7 C1');
  const c1AcceptanceBytes = round7Git(['show', `${c1}:${round7AcceptancePath}`], null);
  const headAcceptanceBytes = round7Git(['show', `${head}:${round7AcceptancePath}`], null);
  round7AssertAcceptanceFrozen(c1AcceptanceBytes, headAcceptanceBytes);
  round7Git(['merge-base', '--is-ancestor', c1, head]);
  round7AssertSealedValidatorInvocation(head, c1);
  round7AssertTrustRootBlobsFrozen(c1, head);
  round7AssertPrimaryWorkflowTrustContract(c1);
  round7AssertHistoricalTrees(c1, acceptance);

  const c2IntroductionsByPath = acceptance.c2AllowedPaths.map(relativePath => round7Introductions(relativePath, head));
  const c2Presence = c2IntroductionsByPath.map(items => items.length > 0);
  assert(
    c2Presence.every(Boolean) || c2Presence.every(value => !value),
    'Round 7 C2 records were only partially introduced',
  );
  const c2Present = c2Presence.every(Boolean);
  if (c2Present) {
    assert(c2IntroductionsByPath.every(items => items.length === 1), 'A Round 7 C2 record was introduced more than once');
    assert.equal(new Set(c2IntroductionsByPath.map(items => items[0])).size, 1, 'Round 7 C2 records were not introduced together');
    c2 = c2IntroductionsByPath[0][0];
    assert.equal(round7SingleParent(c2, 'Round 7 C2'), c1, 'Round 7 C2 is not the direct child of C1');
    round7AssertExactEdge(c1, c2, acceptance.c2AllowedPaths, 'Round 7 C2');
    round7AssertHistoricalTrees(c2, acceptance);
    round7Git(['merge-base', '--is-ancestor', c2, head]);
    const c1Tree = round7Git(['rev-parse', `${c1}^{tree}`]).trim();
    const c1CiPath = 'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-c1-ci-run.json';
    c1Ci = round7ValidateCiRecord(
      round7ReadCommitJson(c2, c1CiPath),
      'c1-ci',
      c1,
      c1Tree,
      c1CiPath,
    );
    const criticRoles = ['adversarial-critic', 'repository-critic', 'runtime-critic'];
    criticBindings = criticRoles.map(role => {
      const relativePath = `quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-${role}.json`;
      const bytes = round7Git(['show', `${c2}:${relativePath}`], null);
      round7ValidateCriticRecord(
        parseJsonStrict(bytes.toString('utf8'), relativePath),
        role,
        c1,
        c1Tree,
        acceptanceSha256,
        c1Ci,
        relativePath,
      );
      return { path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    const smokePath = 'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-artifact-download-smoke.json';
    smoke = round7ReadCommitJson(c2, smokePath);
    round7ValidateSmokeRecord(smoke, c1, smokePath);
  }

  const c3IntroductionsByPath = acceptance.c3AllowedPaths.map(relativePath => round7Introductions(relativePath, head));
  const c3Presence = c3IntroductionsByPath.map(items => items.length > 0);
  assert(
    c3Presence.every(Boolean) || c3Presence.every(value => !value),
    'Round 7 C3 records are only partially present',
  );
  const c3Present = c3Presence.every(Boolean);
  assert(!c3Present || c2Present, 'Round 7 C3 exists without a complete C2');
  if (c3Present) {
    assert(c3IntroductionsByPath.every(items => items.length === 1), 'A Round 7 C3 record was introduced more than once');
    assert.equal(new Set(c3IntroductionsByPath.map(items => items[0])).size, 1, 'Round 7 C3 records were not introduced together');
    c3 = c3IntroductionsByPath[0][0];
    assert.equal(round7SingleParent(c3, 'Round 7 C3'), c2, 'Round 7 C3 is not the direct child of C2');
    round7AssertExactEdge(c2, c3, acceptance.c3AllowedPaths, 'Round 7 C3');
    round7AssertHistoricalTrees(c3, acceptance);
    round7Git(['merge-base', '--is-ancestor', c3, head]);
    const c2Tree = round7Git(['rev-parse', `${c2}^{tree}`]).trim();
    const c2CiPath = 'quality-reviews/step-1-legacy-baseline-round-007/evidence/round-007-c2-ci-run.json';
    c2Ci = round7ValidateCiRecord(
      round7ReadCommitJson(c3, c2CiPath),
      'c2-ci',
      c2,
      c2Tree,
      c2CiPath,
    );
    const judgePath = 'quality-reviews/step-1-legacy-baseline-round-007/audits/round-007-final-judge.json';
    const judge = round7ReadCommitJson(c3, judgePath);
    round7ValidateFinalJudge(judge, c2, c2Tree, acceptanceSha256, c2Ci, criticBindings, judgePath);
    const round = round7ReadCommitJson(c3, round7RecordPath, 'Round 7 internal seal record');
    assert.equal(round.schemaVersion, 1);
    assert.equal(round.artifactId, 'step-1-legacy-baseline-round-007');
    assert.equal(round.round, 7);
    assert.equal(round.overallStatus, 'EXTERNAL_PENDING');
    assert.equal(round.canonicalStatus, 'IN_PROGRESS');
    assert.deepEqual(round.materialBlockers, []);
    assert.equal(Object.hasOwn(round, 'status'), false, 'Round 7 seal may not add an ambiguous status field');
    assert.equal(Object.hasOwn(round, 'conclusion'), false, 'Round 7 seal may not add an ambiguous conclusion field');
    assert.equal(Object.hasOwn(round, 'verdict'), false, 'Round 7 seal may not add an ambiguous verdict field');
    assert.equal(round.reviewTargetCommit, c2);

    const c3Tree = round7Git(['rev-parse', `${c3}^{tree}`]).trim();
    const mergeRows = round7CommitRows(head).filter(([commit, ...parents]) => (
      parents.length === 2
      && parents[0] === round7BaseCommit
      && parents[1] === c3
      && round7Git(['rev-parse', `${commit}^{tree}`]).trim() === c3Tree
    ));
    assert(mergeRows.length <= 1, 'Round 7 initial merge topology appears more than once');
    if (mergeRows.length === 1) [initialMerge] = mergeRows[0];
  }

  const completionIntroductionsByPath = [round7CompletionPath, round7ExternalAuditPath]
    .map(relativePath => round7Introductions(relativePath, head));
  const completionMarkers = completionIntroductionsByPath.map(items => items.length > 0);
  assert(
    completionMarkers.every(Boolean) || completionMarkers.every(value => !value),
    'Round 7 completion and initial external audit records are only partially present',
  );
  const completionPresent = completionMarkers.every(Boolean);
  assert(!completionPresent || initialMerge, 'Round 7 completion exists before the exact initial merge');
  if (completionPresent) {
    assert(completionIntroductionsByPath.every(items => items.length === 1), 'A Round 7 completion record was introduced more than once');
    assert.equal(new Set(completionIntroductionsByPath.map(items => items[0])).size, 1, 'Round 7 completion records were not introduced together');
    completionCommit = completionIntroductionsByPath[0][0];
    assert.equal(
      round7SingleParent(completionCommit, 'Round 7 completion'),
      initialMerge,
      'Round 7 completion is not the direct single-parent child of the initial merge',
    );
    round7AssertExactEdge(initialMerge, completionCommit, acceptance.completionAllowedPaths, 'Round 7 completion');
    round7AssertCompletionCanonicalTransform(c3, completionCommit, acceptance.completionTransforms);
    round7AssertHistoricalTrees(completionCommit, acceptance);
    completionEvidence = round7ValidateCompletionRecord(completionCommit, initialMerge, c3);
    const completionEvidenceTree = round7Git(['rev-parse', `${completionCommit}:${round7EvidenceRoot}`]).trim();
    const headEvidenceTree = round7Git(['rev-parse', `${head}:${round7EvidenceRoot}`]).trim();
    round7AssertEvidenceTreeFrozen(completionEvidenceTree, headEvidenceTree);
    const completionTree = round7Git(['rev-parse', `${completionCommit}^{tree}`]).trim();
    const mergeRows = round7CommitRows(head).filter(([commit, ...parents]) => (
      parents.length === 2
      && parents[0] === initialMerge
      && parents[1] === completionCommit
      && round7Git(['rev-parse', `${commit}^{tree}`]).trim() === completionTree
    ));
    assert(mergeRows.length <= 1, 'Round 7 completion merge topology appears more than once');
    if (mergeRows.length === 1) [completionMerge] = mergeRows[0];
  }

  if (!c2Present) {
    phase = 'c1';
    assert.equal(head, c1, 'Round 7 history advanced past C1 without a complete C2');
    if (preflight && round7WorkingTreeEntries().length > 0) round7AssertPreflightEdge(c1, acceptance.c2AllowedPaths, 'Round 7 C2 preflight');
  } else if (!c3Present) {
    phase = 'c2';
    assert.equal(head, c2, 'Round 7 history advanced past C2 without a complete C3');
    if (preflight && round7WorkingTreeEntries().length > 0) round7AssertPreflightEdge(c2, acceptance.c3AllowedPaths, 'Round 7 C3 preflight');
  } else if (!initialMerge) {
    phase = 'c3';
    assert.equal(head, c3, 'Round 7 history advanced past C3 without its exact initial merge');
    assert.equal(round7WorkingTreeEntries().length, 0, 'Round 7 C3 must be clean before the initial merge');
  } else if (!completionPresent) {
    phase = 'initial-merge';
    assert.equal(head, initialMerge, 'Round 7 history advanced past the initial merge without completion records');
    if (preflight && round7WorkingTreeEntries().length > 0) {
      round7AssertPreflightEdge(initialMerge, acceptance.completionAllowedPaths, 'Round 7 completion preflight');
    }
  } else if (!completionMerge) {
    phase = 'completion';
    assert.equal(head, completionCommit, 'Round 7 history advanced past completion without its exact completion merge');
    assert.equal(round7WorkingTreeEntries().length, 0, 'Round 7 completion commit must be clean before merge');
  } else {
    phase = 'completion-merge';
    round7Git(['merge-base', '--is-ancestor', completionMerge, head]);
  }

  for (const commit of [c1, c2, c3, initialMerge].filter(Boolean)) {
    round7AssertCanonicalStatusAt(commit, 'IN_PROGRESS');
    round7AssertRuntimeUnchanged(commit);
  }
  for (const commit of [completionCommit, completionMerge].filter(Boolean)) {
    round7AssertCanonicalStatusAt(commit, 'PASS');
    round7AssertRuntimeUnchanged(commit);
  }
  const postCompletionDescendant = Boolean(completionMerge && head !== completionMerge);
  await round7RunHistoricalVerifier(remote && !postCompletionDescendant, live);
  if (remote && !postCompletionDescendant && c1Ci) {
    await round7VerifyProviderIdentity(c1Ci, {
      workflowId: round7PrimaryWorkflowId,
      workflowName: "Verify Cat's Tower baseline and quality records",
      jobName: 'vertical-tower-qa',
      requiredSteps: [
        'Exercise repaired artifact transport against Round 6 provider artifacts',
        'GitHub recovery ref and live runtime manifest',
      ],
      headSha: c1,
      event: 'pull_request',
    });
    for (const target of smoke.targets) {
      await round7VerifyProviderIdentity(target, {
        workflowId: round7PrimaryWorkflowId,
        workflowName: "Verify Cat's Tower baseline and quality records",
        jobName: 'vertical-tower-qa',
        headSha: target.role === 'round6-c3' ? round6C3Commit : round7BaseCommit,
        event: target.role === 'round6-c3' ? 'pull_request' : 'push',
      });
    }
  }
  if (remote && !postCompletionDescendant && c2Ci) {
    await round7VerifyProviderIdentity(c2Ci, {
      workflowId: round7PrimaryWorkflowId,
      workflowName: "Verify Cat's Tower baseline and quality records",
      jobName: 'vertical-tower-qa',
      requiredSteps: [
        'Exercise repaired artifact transport against Round 6 provider artifacts',
        'GitHub recovery ref and live runtime manifest',
      ],
      headSha: c2,
      event: 'pull_request',
    });
  }
  if (completionPresent && round7RequiresUnexpiredInitialSanitizedArtifact(head, completionCommit, completionMerge)) {
    round7RequireCompletionRemote(remote);
    await round7VerifyCompletionProvider(completionEvidence.audit, completionEvidence.completion, c3, initialMerge);
  }
  if (postCompletionDescendant) {
    round7RequireCompletionRemote(remote);
    await round7VerifyHistoricalCompletionMergeProvider(completionMerge, head);
    round7AssertCurrentStepOnePass(head);
  }
  for (const commit of [c1, c2, c3, initialMerge, completionCommit, completionMerge].filter(Boolean)) {
    round7AssertHistoricalTrees(commit, acceptance);
  }
  round7AssertHistoricalTrees(head, acceptance);
  if (!preflight) {
    assert.equal(round7WorkingTreeEntries().length, 0, 'Round 7 verification requires a clean committed worktree');
  }
  const reportingBoundary = completionPresent
    ? ' Canonical Step 1 PASS authority is verified; completion reporting still requires the separately observed completion-merge main CI and future-main external audit gates.'
    : '';
  console.log(`Round 7 Step 1 baseline verification passed at phase ${phase}${remote ? ' + remote provider' : ''}${live ? ' + live runtime' : ''}.${reportingBoundary}`);
}

let round7AuthorityExists = round7Introductions(round7AcceptancePath, 'HEAD').length > 0;
if (!round7AuthorityExists) {
  try {
    await readFile(path.join(kitRoot, round7AcceptancePath));
    round7AuthorityExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (round7AuthorityExists && process.env.CATS_SEALED_REENTRY !== '1') {
  round7RunAttackSelfTests();
  await verifyRound7Layer();
  process.exit(0);
}

const syntheticReachableDag = [
  ['merge', 'branch-a', 'branch-b'],
  ['branch-a', 'root'],
  ['branch-b', 'root'],
  ['root'],
];
const syntheticPathOwners = new Set(['merge', 'branch-a', 'branch-b']);
assert.deepEqual(
  pathIntroductionCommits(syntheticReachableDag, commit => syntheticPathOwners.has(commit)),
  ['branch-a', 'branch-b'],
  'Reachable path-introduction discovery must expose additions hidden on separate merge branches',
);

assert.equal(kitGit(['rev-parse', '--is-shallow-repository']).trim(), 'false', 'Step 1 verification requires full Git history');
assert.equal(kitGit(['replace', '-l']).trim(), '', 'Git replace refs are forbidden during Step 1 verification');
const reachableSealCommits = reachablePathIntroductions(sealRoundPath);
assert(reachableSealCommits.length <= 1, 'round-006 was added more than once in reachable history');
if (process.env.CATS_SEAL_COMMIT) {
  assert.equal(reachableSealCommits.length, 1, 'An injected seal commit is forbidden when no unique reachable seal exists');
  assert.equal(process.env.CATS_SEAL_COMMIT, reachableSealCommits[0], 'An injected seal commit differs from the unique reachable seal');
}
const sealCommit = reachableSealCommits[0] || null;
const currentHead = kitGit(['rev-parse', 'HEAD']).trim();
if (sealCommit) {
  assert.equal(
    kitGit(['rev-list', '--parents', '-n', '1', sealCommit]).trim().split(/\s+/u).length,
    2,
    'The unique reachable Step 1 seal must be a single-parent commit',
  );
  assert.equal(kitGit(['rev-parse', `${sealCommit}^{commit}`]).trim(), sealCommit, 'Seal commit is missing');
  kitGit(['merge-base', '--is-ancestor', sealCommit, 'HEAD']);
}
if (process.env.CATS_SEALED_REENTRY === '1') {
  assert(process.env.CATS_SEAL_COMMIT, 'Sealed re-entry requires the parent-validated seal commit');
  assert(sealCommit, 'Sealed re-entry requires one reachable historical seal');
  assert.notEqual(repoRoot, kitRoot, 'Sealed re-entry may not bypass descendant checks from the current checkout');
  assert.notEqual(currentHead, sealCommit, 'Sealed re-entry requires a descendant HEAD distinct from the historical seal');
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: kitRoot, encoding: 'utf8' }).trim(),
    sealCommit,
    'Sealed re-entry must execute from the detached historical seal worktree',
  );
}

// Later steps may legitimately change product files. Re-run the immutable Step 1
// verifier from the historical seal instead of comparing the future HEAD to V0.8.2.
if (sealCommit && currentHead !== sealCommit) {
  const frozenAcceptance = parseJsonStrict(kitGit([
    'show', `${sealCommit}:quality-reviews/step-1-legacy-baseline/acceptance-round-006.json`,
  ], 'utf8'), 'sealed acceptance-round-006.json');
  assert.deepEqual(frozenAcceptance.futureImmutablePaths, futureImmutablePaths);
  assert.deepEqual(frozenAcceptance.futureRequiredQualityGateClaims, futureRequiredQualityGateClaims);
  assert.equal(frozenAcceptance.futureNormativeKernel.arbitraryNaturalLanguageSemanticCompletenessClaimed, false);
  for (const relativePath of futureImmutablePaths) {
    assert.equal(
      kitGit(['rev-parse', `${currentHead}:${relativePath}`]).trim(),
      kitGit(['rev-parse', `${sealCommit}:${relativePath}`]).trim(),
      `Current HEAD changed or removed sealed Step 1 evidence: ${relativePath}`,
    );
  }
  const currentQualityGate = kitGit(['show', `${currentHead}:QUALITY_GATE.md`], 'utf8');
  for (const claim of futureRequiredQualityGateClaims) {
    assert(currentQualityGate.includes(claim), `Current HEAD weakened a required universal quality-loop claim: ${claim}`);
  }
  const sealedStatus = parseJsonStrict(
    kitGit(['show', `${sealCommit}:PROJECT_STATUS.json`], 'utf8'),
    'sealed PROJECT_STATUS.json',
  );
  const currentStatus = parseJsonStrict(
    kitGit(['show', `${currentHead}:PROJECT_STATUS.json`], 'utf8'),
    'current PROJECT_STATUS.json',
  );
  const sealedStepOne = {
    order: 1,
    name: 'legacy-v082-source-runtime-byte-checkpoint',
    status: 'PASS',
  };
  assert.deepEqual(sealedStatus.preparation[0], sealedStepOne, 'The sealed Step 1A preparation entry is not canonical');
  assert.deepEqual(currentStatus.preparation[0], sealedStepOne, 'Current HEAD changed the sealed Step 1A preparation entry');
  assert.equal(
    currentStatus.preparation.filter(item => item?.name === sealedStepOne.name).length,
    1,
    'Current HEAD duplicates the authoritative Step 1A preparation name',
  );
  assert.equal(
    currentStatus.preparation.filter(item => item?.order === sealedStepOne.order).length,
    1,
    'Current HEAD duplicates the authoritative Step 1A preparation order',
  );
  assert.deepEqual(
    currentStatus.legacyBaseline,
    sealedStatus.legacyBaseline,
    'Current HEAD changed the sealed Step 1A baseline status record',
  );
  assert.deepEqual(
    currentStatus.legacyV082Verification,
    sealedStatus.legacyV082Verification,
    'Current HEAD changed the sealed Step 1A verification record',
  );
  for (const relativePath of futureCanonicalPaths) {
    const contents = kitGit(['show', `${currentHead}:${relativePath}`], 'utf8');
    const structuredStatusLines = contents.match(/^工程状態: 工程1A=[^\n]+$/gmu) || [];
    assert.equal(structuredStatusLines.length, 1, `${relativePath} must retain exactly one structured Step 1A status marker`);
    assert(structuredStatusLines[0].startsWith('工程状態: 工程1A=PASS /'), `${relativePath} no longer reports the sealed Step 1A PASS`);
    const checklistRows = contents.match(/^1\. V0\.8\.2 deployed browser-runtime source \+ deployment-input byte checkpoint — `[^`]+`$/gmu) || [];
    assert.deepEqual(checklistRows, ['1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — `PASS`']);
    assert.equal(contents.split('工程1A正式名称: V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint').length - 1, 1);
    assert.equal(contents.split('工程1A対象外: whole-repository backup / player-save backup / physical-iPhone approval / Production alias switch').length - 1, 1);
  }
  if (process.env.CATS_SEALED_REENTRY !== '1') {
    const temporaryWorktree = await mkdtemp(path.join(os.tmpdir(), 'cats-step1-seal-'));
    try {
      kitGit(['worktree', 'add', '--detach', temporaryWorktree, sealCommit]);
      const forwardedArgs = process.argv.slice(2).filter(argument => !['--live', '--remote', '--preflight'].includes(argument));
      execFileSync(process.execPath, [path.join(temporaryWorktree, 'tests/verify-step-1-baseline.mjs'), ...forwardedArgs], {
        cwd: temporaryWorktree,
        env: {
          ...process.env,
          CATS_REPO_ROOT: repoRoot,
          CATS_SEAL_COMMIT: sealCommit,
          CATS_SEALED_REENTRY: '1',
        },
        stdio: 'inherit',
        maxBuffer: 16 * 1024 * 1024,
      });
    } finally {
      try {
        kitGit(['worktree', 'remove', '--force', temporaryWorktree]);
      } finally {
        await rm(temporaryWorktree, { recursive: true, force: true });
      }
    }
    console.log(`Step 1 historical seal ${sealCommit} verified; future external aliases and expiring CI records were not re-queried.`);
    process.exit(0);
  }
}

const sealedRound = sealCommit
  ? parseJsonStrict(kitGit(['show', `${sealCommit}:${sealRoundPath}`], 'utf8'), 'sealed round-006.json')
  : null;
const contentCommit = sealedRound?.reviewTargetCommit || currentHead;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitObjectSha1(type, bytes) {
  return createHash('sha1').update(Buffer.concat([
    Buffer.from(`${type} ${bytes.byteLength}\0`, 'utf8'),
    bytes,
  ])).digest('hex');
}

async function listFiles(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join('/'));
  }
  return files.sort();
}

function webpDimensions(bytes) {
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', 'Visual evidence is not RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', 'Visual evidence is not WebP');
  const kind = bytes.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (kind === 'VP8L') {
    assert.equal(bytes[20], 0x2f, 'Invalid lossless WebP signature');
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  const frame = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
  assert(frame >= 0, 'Invalid lossy WebP frame header');
  return {
    width: bytes.readUInt16LE(frame + 3) & 0x3fff,
    height: bytes.readUInt16LE(frame + 5) & 0x3fff,
  };
}

assert.equal(git(['rev-parse', `${baselineCommit}^{commit}`]).trim(), baselineCommit, 'Baseline commit is missing');
assert.equal(git(['rev-parse', `${baselineCommit}^{tree}`]).trim(), baselineTree, 'Baseline tree changed');
git(['fsck', '--full', '--no-dangling']);
if (process.env.CATS_BASELINE_DIR) {
  assert.equal(git(['rev-parse', 'HEAD']).trim(), baselineCommit, 'Recovered checkout HEAD is not the baseline commit');
  assert.equal(git(['rev-parse', 'HEAD^{tree}']).trim(), baselineTree, 'Recovered checkout tree is not the baseline tree');
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']).trim(), '', 'Recovered checkout is not clean');
}
const baselineTreeEntries = git(['ls-tree', '-r', baselineCommit]).trim().split('\n').filter(Boolean);
assert(!baselineTreeEntries.some(line => line.startsWith('160000 ')), 'Baseline contains a submodule gitlink');
let lfsPointers = '';
try {
  lfsPointers = git(['grep', '-I', '-l', 'version https://git-lfs.github.com/spec/v1', baselineCommit, '--']).trim();
} catch (error) {
  assert.equal(error.status, 1, 'Unable to inspect the baseline for Git LFS pointers');
}
assert.equal(lfsPointers, '', `Baseline contains Git LFS pointers: ${lfsPointers}`);

const manifestPath = path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/runtime-manifest.json');
const manifest = parseJsonStrict(await readFile(manifestPath, 'utf8'), 'runtime-manifest.json');
assert.equal(manifest.baselineCommit, baselineCommit);
assert.equal(manifest.baselineTree, baselineTree);
assert.equal(manifest.entries.length, 17, 'The runtime manifest must contain all 17 execution and license entries');
assert.equal(new Set(manifest.entries.map(entry => entry.servedPath)).size, 17, 'Every served manifest path must be unique');

const uniqueSourcePaths = [...new Set(manifest.entries.map(entry => entry.sourcePath))];
const deploymentInputPaths = manifest.deploymentInputs.map(entry => entry.sourcePath);
assert.deepEqual([...deploymentInputPaths].sort(), ['.vercelignore', 'vercel.json']);
for (const sourcePath of [...uniqueSourcePaths, ...deploymentInputPaths]) {
  const entries = manifest.entries.filter(entry => entry.sourcePath === sourcePath);
  const deploymentEntries = manifest.deploymentInputs.filter(entry => entry.sourcePath === sourcePath);
  const expectedEntries = [...entries, ...deploymentEntries];
  const baselineBytes = git(['show', `${baselineCommit}:${sourcePath}`], null);
  const workingBytes = await readFile(path.join(targetRoot, sourcePath));
  for (const entry of expectedEntries) {
    assert.equal(baselineBytes.byteLength, entry.bytes, `Baseline byte size mismatch: ${sourcePath}`);
    assert.equal(sha256(baselineBytes), entry.sha256, `Baseline SHA-256 mismatch: ${sourcePath}`);
    assert.equal(sha256(workingBytes), entry.sha256, `Working runtime diverged from baseline: ${sourcePath}`);
  }
}

const runtimeDiff = kitGit([
  'diff', '--name-only', `${baselineCommit}..${contentCommit}`, '--', ...uniqueSourcePaths, ...deploymentInputPaths,
]).trim();
assert.equal(runtimeDiff, '', `Step 1A must not change runtime or deployment inputs: ${runtimeDiff}`);

const status = parseJsonStrict(
  await readFile(path.join(kitRoot, 'PROJECT_STATUS.json'), 'utf8'),
  'PROJECT_STATUS.json',
);
assert.deepEqual(Object.keys(status.preparation[0]), ['order', 'name', 'status']);
assert.equal(status.preparation[0].order, 1);
assert.equal(status.preparation[0].name, 'legacy-v082-source-runtime-byte-checkpoint');
assert(['IN_PROGRESS', 'PASS'].includes(status.preparation[0].status));
assert.equal(
  status.preparation.filter(item => item?.name === 'legacy-v082-source-runtime-byte-checkpoint').length,
  1,
  'PROJECT_STATUS duplicates the authoritative Step 1A preparation name',
);
assert.equal(
  status.preparation.filter(item => item?.order === 1).length,
  1,
  'PROJECT_STATUS duplicates the authoritative Step 1A preparation order',
);
assert.equal(status.legacyBaseline.commit, baselineCommit);
assert.equal(status.legacyBaseline.sourceRuntimeCheckpoint, status.preparation[0].status);
assert.equal(status.legacyBaseline.playerSaveBackup, 'UNAVAILABLE_IN_V082');
assert.equal(status.legacyBaseline.physicalIPhoneStandalonePwaApproval, 'NOT_VERIFIED');
assert.deepEqual(
  status.preparation.slice(1).map(item => item.status),
  ['PENDING_REVALIDATION', 'PENDING_REVALIDATION', ...Array(7).fill('NOT_STARTED')],
  'Later preparation steps do not have their required revalidation/not-started states',
);

const browserEvidence = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/browser-qa.json'),
  'utf8',
), 'browser-qa.json');
for (const evidence of browserEvidence.visualEvidence) {
  const evidencePath = path.join(kitRoot, evidence.path);
  const bytes = await readFile(evidencePath);
  assert.equal(sha256(bytes), evidence.sha256, `Visual evidence hash mismatch: ${evidence.path}`);
  assert.deepEqual(webpDimensions(bytes), { width: 390, height: 844 }, `Visual evidence dimensions mismatch: ${evidence.path}`);
}
assert.equal(browserEvidence.visualEvidence.length, 6, 'Six final-size visual records are required');
assert.equal(browserEvidence.deterministicLoop.length, 4, 'Four Chromium/WebKit deterministic viewport reports are required');
assert.equal(browserEvidence.normalUiFlow.length, 4, 'Four Chromium/WebKit normal-flow viewport reports are required');
assert.equal(browserEvidence.serviceWorkerRecovery.length, 2, 'Two Chromium service-worker reports are required');
assert.equal(browserEvidence.cleanCheckoutCi.durableRawReportsCommitted, 10);
assert.equal(browserEvidence.cleanCheckoutCi.durableEvidenceDoesNotDependOnArtifactRetention, true);
assert.equal(browserEvidence.sourceArtifact.runId, browserEvidence.cleanCheckoutCi.runId);
assert.equal(browserEvidence.sourceArtifact.artifactId, browserEvidence.cleanCheckoutCi.artifactId);
assert.equal(browserEvidence.sourceArtifact.digest, browserEvidence.cleanCheckoutCi.artifactDigest);
assert.equal(browserEvidence.sourceArtifact.downloadedZipSha256, browserEvidence.cleanCheckoutCi.artifactDigest.replace(/^sha256:/, ''));
assert.equal(browserEvidence.sourceArtifact.entryCount, 94);
assert.equal(browserEvidence.sourceArtifact.downloadedAndIndependentlyInspected, true);

const repositoryEvidence = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/repository.json'),
  'utf8',
), 'repository.json');
assert.equal(repositoryEvidence.baselineCommit, baselineCommit);
assert.equal(repositoryEvidence.baselineTree, baselineTree);
assert.equal(repositoryEvidence.archiveRef, archiveRef);
assert.equal(repositoryEvidence.archiveRefCommit, baselineCommit);
assert.equal(repositoryEvidence.archiveRefProtectedAtAudit, false);
assert.equal(repositoryEvidence.mainProtectedAtAudit, false);
assert.equal(repositoryEvidence.localAnnotatedTagObject, '43c9e624e3e87040a3808c9cd370fd311763d500');
assert.equal(repositoryEvidence.gameRuntimeChangedByStep1Redo, false);
assert.equal(repositoryEvidence.gitLfsUsed, false);
assert.equal(repositoryEvidence.submodulesUsed, false);
assert.equal(repositoryEvidence.selfContainedRuntimeSnapshot, '.github/baselines/v0.8.2');

const deploymentEvidence = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/deployments.json'),
  'utf8',
), 'deployments.json');
assert.equal(deploymentEvidence.historicalBaselineDeployment.githubCommitSha, baselineCommit);
assert.equal(deploymentEvidence.historicalBaselineDeployment.isCurrentFixedAliasTarget, false);
assert.equal(deploymentEvidence.historicalBaselineDeployment.state, 'READY');
assert.notEqual(
  deploymentEvidence.currentProductionDeploymentAtAudit.githubCommitSha,
  deploymentEvidence.historicalBaselineDeployment.githubCommitSha,
  'Current Production and historical deployment identities must remain distinct',
);
assert.equal(deploymentEvidence.runtimeManifestMismatchCount, 0);
assert.equal(deploymentEvidence.runtimeManifestMatchCount, 17);
assert.equal(deploymentEvidence.freshRecoveryDrill.tree, baselineTree);
assert.equal(deploymentEvidence.freshRecoveryDrill.treeEqualsBaseline, true);
assert.equal(deploymentEvidence.freshRecoveryDrill.state, 'READY');
assert.equal(deploymentEvidence.freshRecoveryDrill.runtimeEntriesExact, 15);
assert.equal(deploymentEvidence.freshRecoveryDrill.htmlEntriesEqualAfterRemovingVercelPreviewToolbarInjection, 2);
assert.equal(deploymentEvidence.freshRecoveryDrill.runtimeEntriesFailed, 0);

const vercelMetadata = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/vercel-deployment-metadata.json'),
  'utf8',
), 'vercel-deployment-metadata.json');
assert.equal(vercelMetadata.recheckedAt, '2026-08-22T15:28:51Z');
assert.equal(vercelMetadata.source, 'Vercel deployment API through the connected project');
assert.equal(vercelMetadata.connectorAuthentication, 'authenticated connected-project access');
assert.equal(vercelMetadata.cryptographicResponseSignatureStored, false);
assert.equal(vercelMetadata.proceduralIndependentRecheckRequired, true);
assert.equal(vercelMetadata.project.id, deploymentEvidence.project.id);
const vercelDeploymentsByRole = Object.fromEntries(vercelMetadata.deployments.map(item => [item.role, item]));
assert.equal(vercelDeploymentsByRole['historical-baseline'].id, deploymentEvidence.historicalBaselineDeployment.id);
assert.equal(vercelDeploymentsByRole['historical-baseline'].githubCommitSha, baselineCommit);
assert.equal(vercelDeploymentsByRole['fixed-production-at-audit'].id, deploymentEvidence.currentProductionDeploymentAtAudit.id);
assert.equal(
  vercelDeploymentsByRole['fixed-production-at-audit'].githubCommitSha,
  deploymentEvidence.currentProductionDeploymentAtAudit.githubCommitSha,
);
assert.equal(vercelDeploymentsByRole['fresh-baseline-tree-recovery-preview'].id, deploymentEvidence.freshRecoveryDrill.deploymentId);
assert.equal(vercelDeploymentsByRole['fresh-baseline-tree-recovery-preview'].state, 'READY');
assert.equal(
  vercelDeploymentsByRole['fresh-baseline-tree-recovery-preview'].githubCommitSha,
  deploymentEvidence.freshRecoveryDrill.commit,
);
const recoveryCommitObjectBase64 = await readFile(path.join(
  kitRoot,
  'quality-reviews/step-1-legacy-baseline/evidence/fresh-recovery-commit-object.b64',
), 'utf8');
assert.deepEqual(deploymentEvidence.freshRecoveryDrill.commitObjectWitness, {
  path: 'quality-reviews/step-1-legacy-baseline/evidence/fresh-recovery-commit-object.b64',
  encoding: 'base64',
  decodedBytes: 314,
  encodedFileSha256: sha256(Buffer.from(recoveryCommitObjectBase64, 'utf8')),
});
assert.match(recoveryCommitObjectBase64, /^[A-Za-z0-9+/]+=*\n$/);
const recoveryCommitObject = Buffer.from(recoveryCommitObjectBase64.trim(), 'base64');
assert.equal(recoveryCommitObject.byteLength, 314);
assert.equal(gitObjectSha1('commit', recoveryCommitObject), deploymentEvidence.freshRecoveryDrill.commit);
const recoveryCommitLines = recoveryCommitObject.toString('utf8').split('\n');
assert.equal(recoveryCommitLines[0], `tree ${baselineTree}`);
assert.equal(recoveryCommitLines[1], `parent ${baselineCommit}`);
assert.equal(recoveryCommitLines.filter(line => line.startsWith('tree ')).length, 1);
assert.equal(recoveryCommitLines.filter(line => line.startsWith('parent ')).length, 1);
assert.equal(recoveryCommitLines.at(-1), 'test: rebuild the V0.8.2 baseline from an unchanged tree');

const previewEvidence = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/fresh-recovery-preview.json'),
  'utf8',
), 'fresh-recovery-preview.json');
assert.equal(previewEvidence.deploymentId, deploymentEvidence.freshRecoveryDrill.deploymentId);
assert.equal(previewEvidence.deploymentTree, baselineTree);
assert.deepEqual(previewEvidence.summary, { exact: 15, previewToolbarNormalized: 2, failed: 0, total: 17 });
assert.deepEqual(
  previewEvidence.entries.map(entry => entry.servedPath),
  manifest.entries.map(entry => entry.servedPath),
  'Fresh Preview evidence must cover the complete runtime manifest in order',
);
for (const [index, previewEntry] of previewEvidence.entries.entries()) {
  const expected = manifest.entries[index];
  assert.equal(previewEntry.expectedBytes, expected.bytes);
  assert.equal(previewEntry.expectedSha256, expected.sha256);
  if (previewEntry.result === 'EXACT') {
    assert.equal(previewEntry.observedPreviewSha256, expected.sha256);
  } else {
    assert.equal(previewEntry.result, 'PREVIEW_TOOLBAR_NORMALIZED');
    assert(['/', '/index.html'].includes(previewEntry.servedPath));
    assert.equal(previewEntry.normalizedSha256, expected.sha256);
    assert.notEqual(previewEntry.observedPreviewSha256, expected.sha256);
  }
}

const previewCapture = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/fresh-recovery-preview-capture.json'),
  'utf8',
), 'fresh-recovery-preview-capture.json');
assert.equal(previewCapture.deploymentId, previewEvidence.deploymentId);
assert.equal(previewCapture.deploymentCommit, previewEvidence.deploymentCommit);
assert.equal(previewCapture.deploymentCommit, vercelDeploymentsByRole['fresh-baseline-tree-recovery-preview'].githubCommitSha);
assert.equal(previewCapture.deploymentTree, baselineTree);
assert.equal(
  previewCapture.normalizationStrategy,
  'raw response must equal exact baseline HTML bytes followed by exactly one deployment-bound Vercel Toolbar script suffix',
);
assert.equal(previewCapture.temporaryShareCredentialPersisted, false);
assert.deepEqual(previewCapture.summary, { exact: 15, previewToolbarNormalized: 2, failed: 0, total: 17 });
assert.deepEqual(previewCapture.entries.map(entry => entry.servedPath), manifest.entries.map(entry => entry.servedPath));
for (const [index, captureEntry] of previewCapture.entries.entries()) {
  const expected = manifest.entries[index];
  assert.equal(captureEntry.expectedBytes, expected.bytes);
  assert.equal(captureEntry.expectedSha256, expected.sha256);
  assert((captureEntry.headers['content-type'] || '').startsWith(expected.contentType), `Preview MIME mismatch: ${expected.servedPath}`);
  if (captureEntry.result === 'EXACT') {
    assert.equal(captureEntry.observedBytes, expected.bytes);
    assert.equal(captureEntry.observedSha256, expected.sha256);
    assert.equal(captureEntry.rawResponseBase64, undefined, 'Exact binary responses must not bloat the evidence record');
  } else {
    assert.equal(captureEntry.result, 'PREVIEW_TOOLBAR_NORMALIZED');
    assert(['/', '/index.html'].includes(captureEntry.servedPath));
    const rawHtml = Buffer.from(captureEntry.rawResponseBase64, 'base64');
    assert.equal(rawHtml.byteLength, captureEntry.observedBytes);
    assert.equal(sha256(rawHtml), captureEntry.observedSha256);
    const expectedHtml = git(['show', `${baselineCommit}:index.html`], null);
    assert.equal(expectedHtml.byteLength, expected.bytes);
    assert(rawHtml.subarray(0, expectedHtml.byteLength).equals(expectedHtml), `Preview HTML prefix differs: ${expected.servedPath}`);
    const expectedToolbarSuffix = `<script async data-explicit-opt-in="true" data-deployment-id="${previewCapture.deploymentId}" src="https://${previewCapture.normalizationMarker}"></script>`;
    const suffix = rawHtml.subarray(expectedHtml.byteLength);
    assert.equal(suffix.toString('utf8'), expectedToolbarSuffix, `Preview Toolbar suffix differs: ${expected.servedPath}`);
    assert.equal(rawHtml.toString('utf8').split(previewCapture.normalizationMarker).length - 1, 1);
    assert.equal(captureEntry.toolbarSuffixBytes, suffix.byteLength);
    assert.equal(captureEntry.toolbarSuffixSha256, sha256(suffix));
    assert.equal(previewCapture.expectedToolbarSuffix, expectedToolbarSuffix);
    assert.equal(sha256(expectedHtml), expected.sha256);
    assert.equal(captureEntry.normalizedSha256, expected.sha256);
  }
}

const cleanRecovery = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/clean-recovery.json'),
  'utf8',
), 'clean-recovery.json');
assert.equal(cleanRecovery.sourceRefCommit, baselineCommit);
assert.equal(cleanRecovery.checkoutHead, baselineCommit);
assert.equal(cleanRecovery.checkoutTree, baselineTree);
assert.equal(cleanRecovery.ciBaselineCheckoutRef, baselineCommit);
assert.equal(cleanRecovery.historicalDescendantsDependOnMutableArchiveRef, false);
assert.equal(cleanRecovery.checkoutStatusPorcelain, '');
assert.equal(cleanRecovery.verifierResult, 'PASS');

const serviceWorkerSource = await readFile(path.join(targetRoot, 'sw.js'), 'utf8');
const coreMatch = /const CORE=\[([\s\S]*?)\];/.exec(serviceWorkerSource);
assert(coreMatch, 'Unable to parse the service-worker CORE list');
const serviceWorkerCore = [...coreMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
const expectedCore = manifest.entries
  .filter(entry => !['sw.js', 'assets/fonts/NotoSansJP-OFL.txt'].includes(entry.sourcePath))
  .map(entry => entry.servedPath)
  .sort();
assert.deepEqual(serviceWorkerCore, expectedCore, 'Runtime manifest must equal service-worker CORE plus sw.js and font license');

const snapshotRoot = path.join(kitRoot, '.github/baselines/v0.8.2');
const snapshotManifest = parseJsonStrict(
  await readFile(path.join(snapshotRoot, 'MANIFEST.json'), 'utf8'),
  'snapshot MANIFEST.json',
);
assert.equal(snapshotManifest.baselineCommit, baselineCommit);
assert.equal(snapshotManifest.baselineTree, baselineTree);
const requiredSnapshotBindings = [
  ...uniqueSourcePaths.map(sourcePath => {
    const runtimeEntry = manifest.entries.find(entry => entry.sourcePath === sourcePath);
    return { path: `runtime/${sourcePath}`, baselinePath: sourcePath, sha256: runtimeEntry.sha256 };
  }),
  ...manifest.deploymentInputs.map(entry => ({
    path: `runtime/${entry.sourcePath}`,
    baselinePath: entry.sourcePath,
    sha256: entry.sha256,
  })),
  ...[
    ['verification/tests/living-tower-v080.mjs', 'tests/living-tower-v080.mjs'],
    ['verification/scripts/build_v080_art.py', 'scripts/build_v080_art.py'],
  ].map(([snapshotPath, baselinePath]) => ({
    path: snapshotPath,
    baselinePath,
    sha256: sha256(git(['show', `${baselineCommit}:${baselinePath}`], null)),
  })),
].sort((left, right) => left.path.localeCompare(right.path));
assert.equal(requiredSnapshotBindings.length, 20);
assert.deepEqual(
  snapshotManifest.files.map(({ path: entryPath, baselinePath, sha256: digest }) => ({ path: entryPath, baselinePath, sha256: digest }))
    .sort((left, right) => left.path.localeCompare(right.path)),
  requiredSnapshotBindings,
  'Snapshot manifest does not contain the exact required runtime/deployment/verification bindings',
);
assert.equal(new Set(snapshotManifest.files.map(entry => entry.baselinePath)).size, 20);
for (const entry of snapshotManifest.files) {
  const snapshotBytes = await readFile(path.join(snapshotRoot, entry.path));
  const baselineBytes = git(['show', `${baselineCommit}:${entry.baselinePath}`], null);
  assert.equal(sha256(snapshotBytes), entry.sha256, `Snapshot SHA-256 mismatch: ${entry.path}`);
  assert.equal(sha256(baselineBytes), entry.sha256, `Snapshot differs from baseline: ${entry.baselinePath}`);
}
const expectedSnapshotFiles = ['MANIFEST.json', 'RESTORE.md', ...snapshotManifest.files.map(entry => entry.path)].sort();
assert.deepEqual(await listFiles(snapshotRoot), expectedSnapshotFiles, 'Snapshot contains missing or unmanifested files');

const rawReportLedger = new Map((browserEvidence.rawReports || []).map(report => [report.sha256, report.path]));
assert.equal(rawReportLedger.size, 10, 'Ten unique raw Chromium/WebKit browser reports are required');
assert.equal(new Set(browserEvidence.rawReports.map(report => report.path)).size, 10, 'Raw browser report paths must be unique');
assert.equal(new Set(browserEvidence.rawReports.map(report => report.artifactMember)).size, 10, 'Artifact report members must be unique');
const rawRoot = path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/raw');
assert.deepEqual(
  await listFiles(rawRoot),
  browserEvidence.rawReports.map(report => path.basename(report.path)).sort(),
  'The durable raw-report directory must exactly equal the ten-file ledger',
);
for (const report of browserEvidence.rawReports || []) {
  const bytes = await readFile(path.join(kitRoot, report.path));
  assert.equal(sha256(bytes), report.sha256, `Raw browser report hash mismatch: ${report.path}`);
}
assert.deepEqual(
  browserEvidence.deterministicLoop.map(item => `${item.browser}:${item.viewportCss}`).sort(),
  ['chromium:375x667', 'chromium:390x844', 'webkit:375x667', 'webkit:390x844'],
  'Deterministic raw evidence does not cover both engines and both mobile viewports',
);
assert.deepEqual(
  browserEvidence.normalUiFlow.map(item => `${item.browser}:${item.viewportCss}`).sort(),
  ['chromium:375x667', 'chromium:390x844', 'webkit:375x667', 'webkit:390x844'],
  'Normal-flow raw evidence does not cover both engines and both mobile viewports',
);
assert.deepEqual(
  browserEvidence.serviceWorkerRecovery.map(item => `${item.browser}:${item.viewportCss}`).sort(),
  ['chromium:375x667', 'chromium:390x844'],
  'Service-worker raw evidence must cover both Chromium mobile viewports',
);
async function loadRawSummary(summary, kind) {
  assert(rawReportLedger.has(summary.rawReportSha256), `Summary report is absent from the raw ledger: ${summary.rawReportSha256}`);
  const rawPath = rawReportLedger.get(summary.rawReportSha256);
  assert(rawPath.endsWith(`-${kind}.json`), `Raw report type differs from its summary: ${rawPath}`);
  const raw = parseJsonStrict(await readFile(path.join(kitRoot, rawPath), 'utf8'), rawPath);
  assert.equal(raw.passed, true, 'A raw browser report is not passing');
  assert(['chromium', 'webkit'].includes(summary.browser), 'Raw evidence names an unsupported browser');
  assert.equal(raw.browserName, summary.browser, 'Raw browser identity differs from its summary');
  assert(rawPath.includes(`/${summary.browser}-`), 'Raw report path omits its browser identity');
  assert(rawPath.includes(`-${summary.viewportCss}-`), 'Raw report path omits its viewport identity');
  assert.equal(`${raw.viewport.width}x${raw.viewport.height}`, summary.viewportCss, 'Raw viewport differs from its summary');
  assert.equal(raw.targetUrl, 'http://127.0.0.1:4173/');
  return raw;
}

const expectedLoopEvidenceNames = [
  '00-title.png', '00-settings-paused.png', '01-auto-climb.png', '02-tap-dispatch.png', '02-full-party-rally.png',
  '03-upgrade-panel.png', '04-floor-conquered.png', '05-food-support-full.png', '05-food-support-sheet.png',
  '06-shared-room-full.png', '06-shared-room-sheet.png', '07-wall.png', '08-dawn-preview-full.png',
  '08-dawn-preview-sheet.png', '08-dawn-actions.png', '09-faster-replay.png', '10-first-night-boss.png',
  '11-first-night-clear.png',
].sort();
for (const summary of browserEvidence.deterministicLoop) {
  const raw = await loadRawSummary(summary, 'loop');
  assert.equal(raw.version, '0.8.2');
  assert.equal(raw.gameplaySchema, 2);
  assert.equal(raw.viewport.deviceScaleFactor, 3);
  assert.equal(raw.viewport.reducedMotion, 'reduce');
  assert.deepEqual(raw.errors, []);
  assert.deepEqual(raw.badResponses, []);
  assert.deepEqual(raw.failedRequests, []);
  assert.equal(raw.japaneseFont.status, 'loaded');
  assert.equal(raw.japaneseFont.checked, true);
  assert(raw.japaneseFont.faceCount >= 1);
  assert(raw.japaneseFont.faceStatuses.every(value => value === 'loaded'));
  assert(raw.japaneseFont.bodyFamily.includes('CatsTowerJP'));
  assert.equal(raw.japaneseFont.fontHttpStatus, 200);
  assert.equal(raw.japaneseFont.fontByteLength, 1039792);
  assert.equal(raw.japaneseFont.fontSignature, 'wOF2');
  assert(raw.japaneseFont.customFingerprint.ink > 0);
  assert.notEqual(raw.japaneseFont.customFingerprint.hash, raw.japaneseFont.fallbackFingerprint.hash);
  const assets = Object.fromEntries(raw.v082Assets.map(item => [item.path, item]));
  assert.deepEqual(Object.keys(assets).sort(), [
    '/assets/v082/pixel-r3/cats-cast-r3.png',
    '/assets/v082/pixel-r3/enemies-r3.png',
  ]);
  assert.deepEqual(
    { status: assets['/assets/v082/pixel-r3/cats-cast-r3.png'].status, bytes: assets['/assets/v082/pixel-r3/cats-cast-r3.png'].bytes, width: assets['/assets/v082/pixel-r3/cats-cast-r3.png'].width, height: assets['/assets/v082/pixel-r3/cats-cast-r3.png'].height },
    { status: 200, bytes: 977730, width: 1448, height: 1086 },
  );
  assert.deepEqual(
    { status: assets['/assets/v082/pixel-r3/enemies-r3.png'].status, bytes: assets['/assets/v082/pixel-r3/enemies-r3.png'].bytes, width: assets['/assets/v082/pixel-r3/enemies-r3.png'].width, height: assets['/assets/v082/pixel-r3/enemies-r3.png'].height },
    { status: 200, bytes: 1012304, width: 1448, height: 1086 },
  );
  assert.deepEqual(raw.modalPause, { playTimeMs: 0, enemyDamage: 0, floorBefore: 1, floorAfter: 1 });
  assert.equal(raw.recoveryRosterContract.waitingUnitCount, 5);
  assert.equal(Math.max(...Object.values(raw.recoveryRosterContract.waitingCounts)), 1);
  assert.equal(raw.recoveryRosterContract.recoveredUnitCount, 6);
  assert.equal(new Set(Object.values(raw.recoveryRosterContract.recoveredCounts)).size, 1);
  assert.equal([...new Set(Object.values(raw.recoveryRosterContract.recoveredCounts))][0], 1);
  assert.equal(raw.recoveryRosterContract.recoveryCount, 0);
  assert.equal(raw.recoveryRosterContract.totalUnitsRecovered, 1);
  assert.deepEqual(raw.roleTargetContract.withFrontline, { kind: 'mugi', role: 'frontline' });
  assert(['ranged', 'support'].includes(raw.roleTargetContract.withoutFrontline.role));
  const loop = raw.loop;
  assert(loop.autoDispatches >= 1);
  assert(loop.tapDispatches >= 1);
  assert.equal(loop.tapDirectDamage, 0);
  assert.equal(loop.rally.directDamage, 0);
  assert.equal(loop.rally.durationMs, 6000);
  assert.equal(loop.rally.unitCount, 6);
  assert.deepEqual(loop.rally.namedKinds, ['luna', 'mugi', 'toto']);
  assert(new Set(loop.rally.castVisual.characters).has('luna'));
  assert(new Set(loop.rally.castVisual.characters).has('toto'));
  assert(new Set(loop.rally.castVisual.characters).has('helper'));
  assert(loop.rally.castVisual.backgrounds.every(value => value.includes('cats-cast-r3.png')));
  assert.deepEqual(loop.rally.helperHueVisual, { 'helper-tabby': '42deg', 'helper-gray': '84deg', 'helper-calico': '0deg' });
  assert(loop.rally.rallyHelperFilters['helper-tabby'].includes('hue-rotate(42deg)'));
  assert(loop.rally.rallyHelperFilters['helper-gray'].includes('hue-rotate(84deg)'));
  assert(loop.rally.rallyHelperFilters['helper-calico'].includes('hue-rotate(0deg)'));
  assert(loop.rally.partyGeometry.footSpread <= 1.5);
  assert(loop.rally.partyGeometry.groundRatio >= 0.875 && loop.rally.partyGeometry.groundRatio <= 0.885);
  assert(loop.rally.partyGeometry.minimumGap >= 2);
  assert.equal(loop.rally.partyGeometry.contained, true);
  assert.equal(loop.rally.alignmentPhaseMatrix.cats.length, 24);
  assert.equal(loop.rally.alignmentPhaseMatrix.enemies.length, 16);
  assert(loop.rally.alignmentPhaseMatrix.maximumCatGroundError <= 0.15);
  assert(loop.rally.alignmentPhaseMatrix.maximumEnemyHoverError <= 0.15);
  assert(loop.firstKillReward > 0);
  assert.equal(loop.upgrade.levelAfter, loop.upgrade.levelBefore + 1);
  assert(loop.upgrade.dpsAfter > loop.upgrade.dpsBefore);
  assert.equal(loop.wall.floor, raw.rules.wallFloor);
  assert.equal(loop.wall.heldMs, 12000);
  assert.equal(loop.wall.visual.enemy, 'black-feather-barrier');
  assert.equal(loop.wall.visual.character, 'barrier');
  assert(loop.wall.visual.spriteBackground.includes('enemies-r3.png'));
  assert(loop.wall.ground.hoverGap >= 3 && loop.wall.ground.hoverGap <= 7.5);
  assert(loop.dawn.bestFloorAfter >= loop.dawn.bestFloorBefore);
  assert(loop.dawn.shardsAfter > loop.dawn.shardsBefore);
  assert(loop.replay.replayMs < loop.replay.baselineMs);
  assert(loop.replay.speedupRatio <= 0.75);
  assert.equal(loop.firstEnemy.ground.enemy, 'crow');
  assert(loop.firstEnemy.ground.hoverGap >= 3 && loop.firstEnemy.ground.hoverGap <= 7.5);
  assert.equal(loop.normalEnemy.enemy, 'owl');
  assert.equal(loop.normalEnemy.character, 'owl');
  assert(loop.normalEnemy.spriteBackground.includes('enemies-r3.png'));
  assert(loop.normalEnemy.ground.hoverGap >= 3 && loop.normalEnemy.ground.hoverGap <= 7.5);
  assert.equal(loop.firstNightBoss.enemy, 'boss');
  assert.equal(loop.firstNightBoss.character, 'boss');
  assert.notEqual(loop.firstNightBoss.phase, 'defeated');
  assert(loop.firstNightBoss.opacity > 0 && loop.firstNightBoss.intersectsViewport === true);
  assert(loop.firstNightBoss.width > 0 && loop.firstNightBoss.height > 0);
  assert(loop.firstNightBoss.spriteBackground.includes('enemies-r3.png'));
  assert(loop.firstNightBoss.ground.hoverGap >= 3 && loop.firstNightBoss.ground.hoverGap <= 7.5);
  assert.equal(loop.firstNightBoss.entryFormation.count, 6);
  assert.equal(new Set(loop.firstNightBoss.entryFormation.kinds).size, 6);
  assert(loop.firstNightBoss.entryFormation.minimumGap >= 2);
  assert.equal(loop.firstNightBoss.entryFormation.contained, true);
  assert(loop.firstNightBoss.entryFormationSweep.samples >= 2);
  assert(loop.firstNightBoss.entryFormationSweep.minimumGap >= 2);
  assert.equal(loop.firstNightBoss.entryFormationSweep.allContained, true);
  assert.equal(loop.completedImmediateRoster.unitCount, 6);
  assert.equal(new Set(loop.completedImmediateRoster.kinds).size, 6);
  assert.equal(loop.completedImmediateRoster.recoveryCount, 0);
  assert(loop.completedImmediateRoster.geometry.minimumGap >= 2);
  assert.equal(loop.completedImmediateRoster.geometry.contained, true);
  assert.equal(loop.firstNightCleared, true);
  assert.equal(loop.firstNightCompleted, true);
  assert.equal(loop.completedFloor, raw.rules.firstBossFloor);
  assert.equal(loop.completedFloor, 10);
  assert.equal(raw.save.newSchemaReload, true);
  assert.equal(raw.save.completedReloadRuntime.unitCount, 6);
  assert.equal(new Set(raw.save.completedReloadRuntime.kinds).size, 6);
  assert.deepEqual(raw.save.completedReloadRuntime.phases, ['celebrating']);
  assert(raw.save.completedReloadRuntime.geometry.minimumGap >= 2);
  assert.equal(raw.save.completedReloadRuntime.geometry.contained, true);
  assert.deepEqual(
    raw.save.migrations.map(item => item.name).sort(),
    ['living-v080', 'legacy-v01', 'corrupt-v080', 'v081-post-dawn', 'v081-boss-clear', 'future-schema'].sort(),
  );
  assert(raw.save.migrations.every(item => item.passed === true));
  assert.deepEqual(raw.evidence.map(item => item.name).sort(), expectedLoopEvidenceNames);
}

const durableKeys = [
  'gameplaySchema', 'currentFloor', 'bestFloor', 'checkpointFloor', 'runFloorPeak', 'enemyFloor', 'enemyHp',
  'coins', 'fish', 'mugiLevel', 'weaponLevel', 'dispatchLevel', 'restaurantLevel', 'roomLevel', 'dawnShards',
  'lifetimeShards', 'ascensions', 'firstNightCleared', 'completed',
].sort();
const screenKeys = ['floor', 'enemy', 'enemyHp', 'coins'].sort();
for (const summary of browserEvidence.normalUiFlow) {
  assert.equal(summary.qaMode, false);
  assert.equal(summary.reducedMotion, false);
  const raw = await loadRawSummary(summary, 'normal-flow');
  assert.equal(raw.deviceScaleFactor, 1);
  assert.equal(raw.qaMode, false);
  assert.equal(raw.reducedMotion, false);
  assert.equal(raw.serviceWorkers, 'enabled');
  assert.deepEqual(raw.initial, { floor: '1F', enemy: '夜ガラス', enemyHp: 'HP 21 / 21' });
  assert.equal(raw.active.gameVisible, true);
  assert.equal(raw.active.titleHidden, true);
  assert(raw.active.visibleCats >= 1);
  assert(raw.active.floor && raw.active.enemy && raw.active.enemyHp);
  assert.equal(raw.durableReload.before.rawPresent, true);
  assert.equal(raw.durableReload.after.rawPresent, true);
  assert.equal(raw.durableReload.preserved, true);
  assert.equal(raw.durableReload.before.durable.gameplaySchema, 2);
  assert.deepEqual(Object.keys(raw.durableReload.before.durable).sort(), durableKeys);
  assert.deepEqual(Object.keys(raw.durableReload.after.durable).sort(), durableKeys);
  assert.deepEqual(raw.durableReload.before.durable, raw.durableReload.after.durable);
  assert.deepEqual(Object.keys(raw.durableReload.before.screen).sort(), screenKeys);
  assert.deepEqual(Object.keys(raw.durableReload.after.screen).sort(), screenKeys);
  assert.deepEqual(raw.durableReload.before.screen, raw.durableReload.after.screen);
  assert.equal(raw.reloaded.gameVisible, true);
  if (summary.browser === 'chromium') {
    for (const sw of [raw.durableReload.before.serviceWorker, raw.durableReload.after.serviceWorker, raw.reloaded]) {
      assert.equal(sw.serviceWorkerSupported ?? sw.supported, true);
      assert.equal(sw.serviceWorkerControlled ?? sw.controlled, true);
      assert((sw.serviceWorkerControllerUrl ?? sw.controllerUrl).endsWith('/sw.js?v=082r3'));
    }
  }
  assert.deepEqual(raw.screenshots.map(item => item.name), ['01-title.png', '02-active-battle.png', '03-reloaded.png']);
  assert(raw.screenshots.every(item => item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.deepEqual(raw.errors, []);
  assert.deepEqual(raw.failedRequests, []);
}
for (const summary of browserEvidence.serviceWorkerRecovery) {
  assert.equal(summary.cachedResponseSha256Count, 15);
  assert.equal(summary.futureSchemaRawBytesUnchanged, 'PASS');
  assert.equal(summary.midCombatRosterNonPersistenceReproduced, 'PASS');
  const raw = await loadRawSummary(summary, 'service-worker');
  assert.equal(raw.browserName, 'chromium');
  assert.equal(raw.runtimeVersion, '0.8.2');
  assert.equal(raw.gameplaySchema, 2);
  assert.equal(raw.saveKey, 'cats-tower-v080');
  assert.equal(raw.cacheState.expectedName, 'cats-tower-v082-pixel-tower-r3');
  assert.deepEqual(raw.cacheState.cacheNames, ['cats-tower-v082-pixel-tower-r3']);
  assert.deepEqual([...raw.cacheState.keys].sort(), expectedCore);
  assert.deepEqual(
    [...raw.cacheState.paths].sort(),
    expectedCore.map(servedPath => new URL(servedPath, 'http://127.0.0.1:4173/').pathname).sort(),
  );
  assert.equal(raw.cacheState.controlled, true);
  assert.equal(raw.cacheState.actualEntryCount, 15);
  assert.equal(raw.cacheState.expectedEntryCount, 15);
  assert.equal(raw.cacheEntrySetVerified, true);
  assert.equal(raw.cachedResponseHashesVerified, 15);
  assert.deepEqual(raw.schema2Reload, { currentFloor: 5, bestFloor: 5, coins: 4321, fish: 17 });
  assert.equal(raw.midCombatKnownDefect.durableFieldsPreserved, true);
  assert(raw.midCombatKnownDefect.enemyHpBefore > 0);
  assert.equal(raw.midCombatKnownDefect.enemyHpAfter, raw.midCombatKnownDefect.enemyHpBefore);
  assert.equal(raw.midCombatKnownDefect.unitCountBefore, 6);
  assert.equal(raw.midCombatKnownDefect.unitCountAfter, 0);
  assert.equal(raw.futureSchemaPreserved, true);
  assert.equal(raw.futureSchemaRawBytesUnchanged, true);
  assert.equal(raw.obsoleteCacheRemoved, true);
  assert.equal(raw.offline.version, '0.8.2');
  assert.equal(raw.offline.controlled, true);
  assert.deepEqual(raw.offline.cacheNames, ['cats-tower-v082-pixel-tower-r3']);
  assert.deepEqual(raw.errors, []);
}
assert(browserEvidence.knownLegacyDefects.some(item => /roster/i.test(item)), 'Roster persistence defect is not disclosed');
assert(browserEvidence.knownLegacyDefects.some(item => /localStorage/i.test(item)), 'Deleted-save limitation is not disclosed');
assert(browserEvidence.knownLegacyDefects.some(item => /physical-iPhone/i.test(item)), 'Physical iPhone evidence boundary is not disclosed');

function gitPathExists(commit, relativePath) {
  try {
    kitGit(['cat-file', '-e', `${commit}:${relativePath}`]);
    return true;
  } catch {
    return false;
  }
}

function singleParent(commit, label) {
  const row = kitGit(['rev-list', '--parents', '-n', '1', commit]).trim().split(/\s+/);
  assert.equal(row.length, 2, `${label} must be a single-parent commit`);
  return row[1];
}

function touchedPaths(parent, child) {
  const output = kitGit([
    'diff-tree', '--no-commit-id', '-r', '--name-only', '--no-renames', '-z', parent, child,
  ], null);
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

function changedEntries(parent, child) {
  const output = kitGit([
    'diff-tree', '--no-commit-id', '-r', '--name-status', '--no-renames', '-z', parent, child,
  ], null).toString('utf8').split('\0').filter(Boolean);
  assert.equal(output.length % 2, 0, 'Unexpected name-status record shape');
  const entries = [];
  for (let index = 0; index < output.length; index += 2) {
    entries.push({ status: output[index], path: output[index + 1] });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function assertRegularFile(commit, relativePath) {
  const row = kitGit(['ls-tree', commit, '--', relativePath]).trim().split(/\s+/);
  assert.equal(row[0], '100644', `Expected a 100644 regular file at ${commit}: ${relativePath}`);
}

async function readOptionalJson(relativePath) {
  try {
    return parseJsonStrict(await readFile(path.join(kitRoot, relativePath), 'utf8'), relativePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys differ from the frozen schema`);
}

function validateCiProvenance(record, role) {
  assert.equal(record.artifact.provenanceMember, 'ci-provenance.json');
  assert.match(record.artifact.provenanceMemberSha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof record.artifact.provenanceMemberRaw, 'string');
  assert.equal(
    sha256(Buffer.from(record.artifact.provenanceMemberRaw, 'utf8')),
    record.artifact.provenanceMemberSha256,
    `${role} provenance raw bytes do not match their SHA-256`,
  );
  const provenance = parseJsonStrict(record.artifact.provenanceMemberRaw, `${role} ci-provenance.json raw bytes`);
  assertExactKeys(provenance, [
    'schemaVersion', 'repository', 'workflowName', 'workflowPath', 'workflowRef', 'workflowCommitSha',
    'workflowBlobSha', 'generator', 'sourceBoundary', 'event', 'eventContext', 'runId', 'runNumber',
    'runAttempt', 'jobName', 'invocationCheckout', 'verificationKit', 'servedRuntime',
  ], `${role} provenance`);
  assertExactKeys(provenance.eventContext, ['kind', 'pullRequest', 'push', 'workflowDispatch'], `${role} eventContext`);
  assertExactKeys(provenance.eventContext.pullRequest, [
    'number', 'baseBranch', 'baseSha', 'headBranch', 'headSha',
  ], `${role} pull-request event context`);
  assertExactKeys(provenance.invocationCheckout, ['sha', 'tree', 'ref'], `${role} invocation checkout`);
  assertExactKeys(provenance.verificationKit, ['mode', 'sha', 'tree'], `${role} verification kit`);
  assertExactKeys(provenance.servedRuntime, ['mode', 'sha', 'tree'], `${role} served runtime`);
  assert.equal(provenance.schemaVersion, 1);
  assert.equal(provenance.repository, record.repository);
  assert.equal(provenance.workflowName, record.workflowName);
  assert.equal(provenance.workflowPath, record.workflowPath);
  assert.match(provenance.workflowRef, new RegExp(`/.github/workflows/verify-main\\.yml@refs/pull/${record.pullRequest.number}/merge$`, 'u'));
  assert.match(provenance.workflowCommitSha, /^[a-f0-9]{40}$/);
  assert.equal(
    provenance.workflowBlobSha,
    kitGit(['rev-parse', `${record.pullRequest.headSha}:.github/workflows/verify-main.yml`]).trim(),
    `${role} provenance does not bind the protected workflow blob`,
  );
  assert.equal(provenance.generator, 'workflow-steps:Capture immutable invocation provenance+Finalize event-time CI provenance');
  assert.equal(provenance.sourceBoundary, 'frozen-workflow-generated record; not a GitHub-signed attestation');
  assert.equal(provenance.event, 'pull_request');
  assert.equal(provenance.eventContext.kind, 'pull_request');
  assert.equal(provenance.eventContext.push, null);
  assert.equal(provenance.eventContext.workflowDispatch, null);
  assert.deepEqual(provenance.eventContext.pullRequest, {
    number: record.pullRequest.number,
    baseBranch: record.pullRequest.baseBranch,
    baseSha: record.pullRequest.baseSha,
    headBranch: record.pullRequest.headBranch,
    headSha: record.pullRequest.headSha,
  });
  assert.equal(provenance.runId, record.runId);
  assert.equal(provenance.runNumber, record.runNumber);
  assert.equal(provenance.runAttempt, record.runAttempt);
  assert.equal(provenance.jobName, record.job.name);
  assert.deepEqual(provenance.invocationCheckout, {
    sha: record.checkout.sha,
    tree: record.checkout.tree,
    ref: record.pullRequest.headSha,
  });
  assert.deepEqual(provenance.verificationKit, {
    mode: 'current-head',
    sha: record.pullRequest.headSha,
    tree: record.pullRequest.headTree,
  });
  assert.deepEqual(provenance.servedRuntime, {
    mode: 'immutable-baseline-checkout',
    sha: baselineCommit,
    tree: baselineTree,
  });
  return provenance;
}

function validateCiRecord(record, role, expectedHead = null) {
  assert.equal(record.schemaVersion, 2);
  if (role === 'raw-source') assert([undefined, 'raw-source'].includes(record.role));
  else assert.equal(record.role, role);
  assert.equal(record.repository, '2hg7trp7rv-design/cats_tower');
  assert.equal(record.workflowName, "Verify Cat's Tower baseline and quality records");
  assert.equal(record.workflowId, 335561992);
  assert.equal(record.workflowPath, '.github/workflows/verify-main.yml');
  assert.equal(record.event, 'pull_request');
  assert(Number.isInteger(record.runId) && record.runId > 0);
  assert(Number.isInteger(record.runNumber) && record.runNumber > 0);
  assert(Number.isInteger(record.runAttempt) && record.runAttempt > 0);
  assert.equal(record.status, 'completed');
  assert.equal(record.conclusion, 'success');
  assert(Number.isSafeInteger(record.pullRequest.number) && record.pullRequest.number > 0);
  assert.equal(record.pullRequest.baseBranch, 'main');
  if (expectedHead) assert.equal(record.pullRequest.headSha, expectedHead);
  assert.equal(kitGit(['rev-parse', `${record.pullRequest.baseSha}^{tree}`]).trim(), record.pullRequest.baseTree);
  assert.equal(kitGit(['rev-parse', `${record.pullRequest.headSha}^{tree}`]).trim(), record.pullRequest.headTree);
  assert.equal(record.checkout.tree, record.pullRequest.headTree);
  assert.deepEqual(record.checkout.contentDiffFromHead, []);
  if (role === 'raw-source') {
    assert(['pull-request-head', 'pull-request-merge'].includes(record.checkout.mode));
    if (record.checkout.mode === 'pull-request-merge') {
      assert.match(record.checkout.sha, /^[a-f0-9]{40}$/);
      assert.equal(record.checkout.ref, `refs/pull/${record.pullRequest.number}/merge`);
      assert.deepEqual(record.checkout.parents, [record.pullRequest.baseSha, record.pullRequest.headSha]);
    }
  } else {
    assert.equal(record.checkout.mode, 'pull-request-head', `${role} must test the exact PR head`);
    assert.equal(record.checkout.sha, record.pullRequest.headSha);
    assert.equal(record.checkout.ref, record.pullRequest.headSha);
  }
  assert.equal(record.job.name, 'vertical-tower-qa');
  assert.equal(record.job.status, 'completed');
  assert.equal(record.job.conclusion, 'success');
  assert(Date.parse(record.job.startedAt) < Date.parse(record.job.completedAt));
  assert(record.job.requiredSteps.length >= 6);
  assert(record.job.requiredSteps.every(step => step.conclusion === 'success'));
  if (role !== 'raw-source') {
    const requiredStepNames = [
      'Assert primary checkout provenance',
      'Capture immutable invocation provenance',
      'Resolve immutable Step 1 verification kit',
      'Finalize event-time CI provenance',
      'Clean checkout of the immutable V0.8.2 commit',
      'Repository handover and source contracts',
      'Vertical tower source and raster contracts',
      'Bind unexpired CI records and downloaded artifacts before seal',
      'GitHub recovery ref and live runtime manifest',
      'Chromium and WebKit vertical tower loop QA',
      'Attach captured CI provenance',
      'Upload V0.8.2 vertical tower evidence',
    ];
    const recordedSteps = new Map(record.job.requiredSteps.map(step => [step.name, step.conclusion]));
    for (const stepName of requiredStepNames) {
      assert.equal(recordedSteps.get(stepName), 'success', `${role} CI omits successful required step: ${stepName}`);
    }
  }
  assert.match(record.artifact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    record.artifact.name,
    role === 'raw-source'
      ? 'cats-v082-step-1-recovery-evidence'
      : `cats-v082-step-1-recovery-evidence-attempt-${record.runAttempt}`,
  );
  assert(Number.isInteger(record.artifact.id) && record.artifact.id > 0);
  assert(Number.isInteger(record.artifact.sizeBytes) && record.artifact.sizeBytes > 0);
  assert.equal(record.artifact.fileCount, role === 'raw-source' ? 94 : 95);
  assert(
    Date.parse(record.artifact.createdAt) >= Date.parse(record.job.startedAt)
      && Date.parse(record.artifact.createdAt) <= Date.parse(record.job.completedAt),
    `${role} artifact is not bound to its matched job interval`,
  );
  assert(Date.parse(record.artifact.createdAt) < Date.parse(record.artifact.expiresAt));
  assert.equal(record.artifact.supplementaryOnly, true);
  if (role === 'raw-source') {
    assert.equal(Object.hasOwn(record.artifact, 'provenanceMember'), false);
    assert.equal(Object.hasOwn(record.artifact, 'provenanceMemberSha256'), false);
    assert.equal(Object.hasOwn(record.artifact, 'provenanceMemberRaw'), false);
  } else {
    validateCiProvenance(record, role);
  }
  return record;
}

const rawCiEvidence = validateCiRecord(parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/evidence/ci-run.json'),
  'utf8',
), 'ci-run.json'), 'raw-source');
assert.equal(rawCiEvidence.apiVerification.requiredAtC1C2C3, true);
assert.equal(rawCiEvidence.apiVerification.artifactMustExistAndBeUnexpiredBeforeSeal, true);
assert.equal(rawCiEvidence.apiVerification.downloadedZipAndTenRawMembersMustMatch, true);
assert.equal(rawCiEvidence.apiVerification.historicalDescendantsSkipTimeLimitedApi, true);
assert(Object.values(rawCiEvidence.assertedResults).every(result => result === 'PASS'));
assert.equal(browserEvidence.sourceArtifact.runId, rawCiEvidence.runId);
assert.equal(browserEvidence.sourceArtifact.artifactId, rawCiEvidence.artifact.id);
assert.equal(browserEvidence.sourceArtifact.digest, rawCiEvidence.artifact.digest);
assert.equal(browserEvidence.sourceArtifact.sizeBytes, rawCiEvidence.artifact.sizeBytes);

const roundTwoFailure = parseJsonStrict(await readFile(
  path.join(kitRoot, 'quality-reviews/step-1-legacy-baseline/round-002.json'),
  'utf8',
), 'round-002.json');
assert.equal(roundTwoFailure.round, 2);
assert.equal(roundTwoFailure.reviewTargetCommit, '5792be4a0cee37e540747233fd2921ab5f0db392');
assert.equal(roundTwoFailure.overallStatus, 'FAIL');
assert(roundTwoFailure.materialBlockers.length >= 8, 'Round 2 failure did not preserve its material findings');

const roundThreeFailure = parseJsonStrict(await readFile(
  path.join(kitRoot, failedRoundThreePath),
  'utf8',
), 'round-003.json');
assert.equal(roundThreeFailure.schemaVersion, 1);
assert.equal(roundThreeFailure.artifactId, 'step-1-legacy-baseline');
assert.equal(roundThreeFailure.round, 3);
assert.equal(roundThreeFailure.reviewTargetCommit, failedRoundThreeCommit);
assert.equal(roundThreeFailure.reviewTargetTree, failedRoundThreeTree);
assert.equal(roundThreeFailure.overallStatus, 'FAIL');
assert.deepEqual(roundThreeFailure.failedCi, {
  runId: 32582804569,
  runNumber: 22,
  runAttempt: 1,
  workflowId: 335561992,
  jobId: 97054600919,
  jobName: 'vertical-tower-qa',
  event: 'pull_request',
  headBranch: 'codex/restart-step-1-baseline',
  headSha: failedRoundThreeCommit,
  status: 'completed',
  conclusion: 'failure',
  artifactCount: 0,
  artifactCountAuthority: 'historical observation at failed attempt completion only; later rerun artifacts do not alter attempt 1 failure and are not a live completion dependency',
  startedAt: '2026-08-22T15:48:26Z',
  completedAt: '2026-08-22T15:48:41Z',
  failedStep: 'Bind unexpired CI records and downloaded artifacts before seal',
});
assert.deepEqual(roundThreeFailure.failedAcceptance, {
  path: failedRoundThreeAcceptancePath,
  commit: failedRoundThreeCommit,
  blobSha1: failedRoundThreeAcceptanceBlob,
  sha256: failedRoundThreeAcceptanceSha256,
});
assert.equal(kitGit(['rev-parse', `${failedRoundThreeCommit}^{commit}`]).trim(), failedRoundThreeCommit);
assert.equal(kitGit(['rev-parse', `${failedRoundThreeCommit}^{tree}`]).trim(), failedRoundThreeTree);
kitGit(['merge-base', '--is-ancestor', failedRoundThreeCommit, 'HEAD']);
assert.equal(
  kitGit(['rev-parse', `${failedRoundThreeCommit}:${failedRoundThreeAcceptancePath}`]).trim(),
  failedRoundThreeAcceptanceBlob,
);
const failedRoundThreeAcceptanceBytes = kitGit(['show', `${failedRoundThreeCommit}:${failedRoundThreeAcceptancePath}`], null);
assert.equal(sha256(failedRoundThreeAcceptanceBytes), failedRoundThreeAcceptanceSha256);
assert.equal(
  sha256(await readFile(path.join(kitRoot, failedRoundThreeAcceptancePath))),
  failedRoundThreeAcceptanceSha256,
  'Round 3 Acceptance bytes were rewritten during a later rebuild',
);
assert(roundThreeFailure.materialBlockers.length >= 2);
assert.equal(roundThreeFailure.observedApiBehavior.historicalRunId, 32578260669);
assert.equal(roundThreeFailure.observedApiBehavior.historicalRunHeadSha, '5792be4a0cee37e540747233fd2921ab5f0db392');
assert.equal(roundThreeFailure.observedApiBehavior.embeddedPullRequestHeadShaAfterC1, '830b32d4b0d26abebe7354b8db9d8dd3b21c203f');
assert.equal(roundThreeFailure.rebuildDecision.nextAcceptance, 'acceptance-round-004.json');

const roundFourFailure = parseJsonStrict(await readFile(
  path.join(kitRoot, failedRoundFourPath),
  'utf8',
), 'round-004.json');
assert.equal(roundFourFailure.schemaVersion, 1);
assert.equal(roundFourFailure.artifactId, 'step-1-legacy-baseline');
assert.equal(roundFourFailure.round, 4);
assert.equal(roundFourFailure.reviewTargetCommit, failedRoundFourCommit);
assert.equal(roundFourFailure.reviewTargetTree, failedRoundFourTree);
assert.equal(roundFourFailure.overallStatus, 'FAIL');
assert.deepEqual(roundFourFailure.failedAcceptance, {
  path: failedRoundFourAcceptancePath,
  commit: failedRoundFourCommit,
  blobSha1: failedRoundFourAcceptanceBlob,
  sha256: failedRoundFourAcceptanceSha256,
});
assert.deepEqual(roundFourFailure.successfulCiBeforeRejection, {
  runId: 32584243470,
  runNumber: 23,
  runAttempt: 1,
  workflowId: 335561992,
  workflowPath: '.github/workflows/verify-main.yml',
  jobId: 97058103217,
  jobName: 'vertical-tower-qa',
  event: 'pull_request',
  headBranch: 'codex/restart-step-1-baseline',
  headSha: failedRoundFourCommit,
  status: 'completed',
  conclusion: 'success',
  runStartedAt: '2026-08-22T16:17:11Z',
  runCompletedAt: '2026-08-22T16:22:28Z',
  artifact: {
    id: 9478670595,
    name: 'cats-v082-step-1-recovery-evidence',
    sizeBytes: 71612841,
    digest: 'sha256:7994f52234170803515c7b851bea988e438b750c40ef32b9f69a501b2e9bf304',
    createdAt: '2026-08-22T16:22:24Z',
    expiresAt: '2026-09-21T16:22:20Z',
    expiredAtAudit: false,
  },
  authorityBoundary: 'Run-level fields, exact attempt, job, and artifact metadata were observed through GitHub APIs. Mutable pull_requests[] relationship fields are not historical authority. CI success is recorded as an observation, not as completion approval.',
});
assert.deepEqual(roundFourFailure.frozenWeakImplementation, {
  workflow: {
    path: '.github/workflows/verify-main.yml',
    blobSha1: '12c86210d5187604de062b11ee94f400c9d5e492',
    sha256: '0958f09ebe6074d7b314697d10ca10d5ef311b89bc1cc441873db69108c61f04',
  },
  externalArtifactVerifier: {
    path: 'tests/verify-ci-artifact.mjs',
    blobSha1: '609b843840867b4450dd6456b36165f57aae5f08',
    sha256: '7e4ce2fdf4a0eff91f1191e5ffee9c50f0206f9cb62ab63595f78ea0f844a5db',
  },
  baselineValidator: {
    path: 'tests/verify-step-1-baseline.mjs',
    blobSha1: 'c780db174019a851e881d8ae5b38c84430d18599',
    sha256: 'c98e6d04f448b58e000aa3ecc047e63f40e6f8a1e57c0d379ac2de415835d7d8',
  },
  defaultBranchExternalAuditWorkflowPresent: false,
});
assert.equal(roundFourFailure.postCiAudit.taskPath, '/root/step1_adversarial_audit');
assert.equal(roundFourFailure.postCiAudit.performedAfterExactHeadCi, true);
assert.equal(roundFourFailure.postCiAudit.judgment, 'FAIL');
assert.equal(roundFourFailure.postCiAudit.materialBlockers.length, 5);
assert.deepEqual(roundFourFailure.rebuildDecision, {
  preservePublishedC1: true,
  forceRewriteForbidden: true,
  nextRound: 5,
  nextAcceptance: 'acceptance-round-005.json',
  nextC1MustBeDirectChildOf: failedRoundFourCommit,
  requiredChanges: [
    'replace caller-authored inspection input with direct attempt-scoped GitHub API access inside the verifier',
    'add and freeze a default-branch workflow_run audit for exact C3 and main artifacts',
    'freeze and verify the exact Round 5 C1 changed-path and A/M set',
    'bind merged main to the exact two-parent [pre-merge main,C3] topology, matching the C3 base and push.before values',
  ],
});
assert.equal(kitGit(['rev-parse', `${failedRoundFourCommit}^{commit}`]).trim(), failedRoundFourCommit);
assert.equal(kitGit(['rev-parse', `${failedRoundFourCommit}^{tree}`]).trim(), failedRoundFourTree);
assert.equal(singleParent(failedRoundFourCommit, 'failed Round 4 C1'), failedRoundThreeCommit);
kitGit(['merge-base', '--is-ancestor', failedRoundFourCommit, 'HEAD']);
assert.equal(kitGit(['rev-parse', `${failedRoundFourCommit}:${failedRoundFourAcceptancePath}`]).trim(), failedRoundFourAcceptanceBlob);
const failedRoundFourAcceptanceBytes = kitGit(['show', `${failedRoundFourCommit}:${failedRoundFourAcceptancePath}`], null);
assert.equal(sha256(failedRoundFourAcceptanceBytes), failedRoundFourAcceptanceSha256);
assert.equal(sha256(await readFile(path.join(kitRoot, failedRoundFourAcceptancePath))), failedRoundFourAcceptanceSha256);
assert.equal(sha256(await readFile(path.join(kitRoot, failedRoundFourPath))), failedRoundFourSha256);
for (const frozen of Object.values(roundFourFailure.frozenWeakImplementation).filter(value => value?.path)) {
  assert.equal(kitGit(['rev-parse', `${failedRoundFourCommit}:${frozen.path}`]).trim(), frozen.blobSha1);
  assert.equal(sha256(kitGit(['show', `${failedRoundFourCommit}:${frozen.path}`], null)), frozen.sha256);
}

const roundFiveFailure = parseJsonStrict(await readFile(
  path.join(kitRoot, failedRoundFivePath),
  'utf8',
), 'round-005.json');
assert.equal(roundFiveFailure.schemaVersion, 1);
assert.equal(roundFiveFailure.artifactId, 'step-1-legacy-baseline');
assert.equal(roundFiveFailure.round, 5);
assert.equal(roundFiveFailure.reviewTargetCommit, failedRoundFiveCommit);
assert.equal(roundFiveFailure.reviewTargetParent, failedRoundFourCommit);
assert.equal(roundFiveFailure.reviewTargetTree, failedRoundFiveTree);
assert.equal(roundFiveFailure.overallStatus, 'FAIL');
assert.deepEqual(roundFiveFailure.failedAcceptance, {
  path: failedRoundFiveAcceptancePath,
  commit: failedRoundFiveCommit,
  blobSha1: failedRoundFiveAcceptanceBlob,
  sha256: failedRoundFiveAcceptanceSha256,
});
assert.deepEqual(roundFiveFailure.publishedTarget, {
  repository: '2hg7trp7rv-design/cats_tower',
  pullRequestNumber: 4,
  branch: 'codex/restart-step-1-baseline',
  observedRemoteHead: failedRoundFiveCommit,
  observedAt: '2026-08-22T17:01:56Z',
  sourceBoundary: 'Authenticated GitHub connector PR and workflow metadata; mutable pull_requests[] relationship fields are not historical authority.',
});
assert.deepEqual(roundFiveFailure.successfulCiBeforeRejection, {
  runId: 32586052537,
  runNumber: 24,
  runAttempt: 1,
  workflowId: 335561992,
  workflowPath: '.github/workflows/verify-main.yml',
  jobId: 97062470626,
  jobName: 'vertical-tower-qa',
  event: 'pull_request',
  headBranch: 'codex/restart-step-1-baseline',
  headSha: failedRoundFiveCommit,
  status: 'completed',
  conclusion: 'success',
  runStartedAt: '2026-08-22T16:53:06Z',
  runCompletedAt: '2026-08-22T16:59:27Z',
  jobLogFirstAt: '2026-08-22T16:53:10.8011920Z',
  jobLogLastAt: '2026-08-22T16:59:24.3516308Z',
  requiredStepsConclusion: 'all-success',
  artifact: {
    id: 9479141640,
    name: 'cats-v082-step-1-recovery-evidence-attempt-1',
    sizeBytes: 71604643,
    digest: 'sha256:56eec906b8187d6ad962284d05a769137162a47856323478f40fe03e1e191821',
    fileCount: 95,
    provenanceSha256: 'ec7d987b60a0818998d282735c54e91b57700c823d8683e92cf88f0cf2316fa6',
    createdAt: '2026-08-22T16:59:23Z',
    expiresAt: '2026-09-21T16:59:20Z',
    expiredAtAudit: false,
  },
  authorityBoundary: 'Run-level identity, exact provider-reported attempt, job steps, logs, artifact metadata, downloaded ZIP digest/size/file count, and provenance bytes were checked. CI success is an observation and does not override the later quality rejection.',
});
assert.equal(roundFiveFailure.providerAttemptLedger.providerLatestAttempt, 1);
assert.deepEqual(roundFiveFailure.providerAttemptLedger.attempts.map(item => item.runAttempt), [1]);
assert.deepEqual(roundFiveFailure.providerAttemptLedger.mutableFieldsIgnored, ['pull_requests[]']);
assert.deepEqual(roundFiveFailure.frozenWeakImplementation.externalArtifactVerifier, {
  path: 'tests/verify-ci-artifact.mjs',
  blobSha1: '0e91129ee55b6b8e2a054e088023ee5f9a7a1a66',
  sha256: 'a08d53f8d2600e6ce2a039e8c59fbdc2fce6aea83d580211f8197d5b92da4eb5',
});
assert.deepEqual(roundFiveFailure.frozenWeakImplementation.baselineValidator, {
  path: 'tests/verify-step-1-baseline.mjs',
  blobSha1: '08e4a5dc8cf8fbb1b9d78340cb5cbedf04b1b994',
  sha256: 'e773045db8f86eacf432970c8905855420107888a848445d0c468e2d873093d8',
});
assert.equal(roundFiveFailure.frozenWeakImplementation.defect.listQueryFiltersLatestConclusion, 'status=success');
assert.equal(roundFiveFailure.frozenWeakImplementation.defect.inspectedAttempts, 'provider list record candidate.run_attempt only');
assert.equal(roundFiveFailure.frozenWeakImplementation.defect.exactJobRunAttemptRequired, false);
assert.equal(
  sha256(Buffer.from(JSON.stringify(roundFiveFailure.counterexample.fixture), 'utf8')),
  roundFiveFailure.counterexample.fixtureSha256,
);
assert.equal(roundFiveFailure.counterexample.fixture.synthetic, true);
assert.deepEqual(roundFiveFailure.counterexample.fixture.expected, {
  roundFiveLatestOnlyResult: 'NO_QUALIFYING_ATTEMPT',
  roundSixAllAttemptsQualifyingAttempts: [1],
});
assert.equal(roundFiveFailure.postPublicationAudit.exactHeadCiOutcomeKnownBeforeFinalRejection, true);
assert.equal(roundFiveFailure.postPublicationAudit.judgment, 'FAIL');
assert.equal(roundFiveFailure.postPublicationAudit.materialBlockers.length, 3);
assert.deepEqual(roundFiveFailure.rebuildDecision, {
  preservePublishedC1: true,
  forceRewriteForbidden: true,
  nextRound: 6,
  nextAcceptance: 'acceptance-round-006.json',
  nextC1MustBeDirectChildOf: failedRoundFiveCommit,
  requiredChanges: [
    'remove latest-conclusion status filtering from initial external-audit discovery',
    'enumerate attempt 1 through the provider-reported latest attempt using exact-attempt run and job APIs',
    'bind every qualifying job to run_id, run_attempt, head_sha, interval, conclusion, and all five required verification steps',
    'fail closed when the provider no longer retains the required run or job record',
    'move the active seal and all reviewer paths to Round 6 without changing Acceptance Round 5',
  ],
});
assert.equal(kitGit(['rev-parse', `${failedRoundFiveCommit}^{commit}`]).trim(), failedRoundFiveCommit);
assert.equal(kitGit(['rev-parse', `${failedRoundFiveCommit}^{tree}`]).trim(), failedRoundFiveTree);
assert.equal(singleParent(failedRoundFiveCommit, 'failed Round 5 C1'), failedRoundFourCommit);
kitGit(['merge-base', '--is-ancestor', failedRoundFiveCommit, 'HEAD']);
assert.equal(kitGit(['rev-parse', `${failedRoundFiveCommit}:${failedRoundFiveAcceptancePath}`]).trim(), failedRoundFiveAcceptanceBlob);
const failedRoundFiveAcceptanceBytes = kitGit(['show', `${failedRoundFiveCommit}:${failedRoundFiveAcceptancePath}`], null);
assert.equal(sha256(failedRoundFiveAcceptanceBytes), failedRoundFiveAcceptanceSha256);
assert.equal(sha256(await readFile(path.join(kitRoot, failedRoundFiveAcceptancePath))), failedRoundFiveAcceptanceSha256);
for (const frozen of Object.values(roundFiveFailure.frozenWeakImplementation).filter(value => value?.path)) {
  assert.equal(kitGit(['rev-parse', `${failedRoundFiveCommit}:${frozen.path}`]).trim(), frozen.blobSha1);
  assert.equal(sha256(kitGit(['show', `${failedRoundFiveCommit}:${frozen.path}`], null)), frozen.sha256);
}
const failedRoundFiveExpectedEntries = [
  { status: 'M', path: '.github/workflows/verify-main.yml' },
  { status: 'A', path: '.github/workflows/verify-step-1-artifacts.yml' },
  { status: 'M', path: 'BASELINE_V082.md' },
  { status: 'M', path: 'PROJECT_HANDOVER.md' },
  { status: 'M', path: 'PROJECT_STATUS.json' },
  { status: 'A', path: 'quality-reviews/step-1-legacy-baseline/acceptance-round-005.json' },
  { status: 'A', path: 'quality-reviews/step-1-legacy-baseline/round-004.json' },
  { status: 'M', path: 'tests/verify-ci-artifact.mjs' },
  { status: 'M', path: 'tests/verify-step-1-baseline.mjs' },
].sort((left, right) => left.path.localeCompare(right.path));
assertExactEdge(failedRoundFourCommit, failedRoundFiveCommit, failedRoundFiveExpectedEntries, 'failed Round 4 C1→failed Round 5 C1');

const acceptanceRelativePath = 'quality-reviews/step-1-legacy-baseline/acceptance-round-006.json';
const strengthenedAcceptanceBytes = await readFile(path.join(kitRoot, acceptanceRelativePath));
const strengthenedAcceptance = parseJsonStrict(
  strengthenedAcceptanceBytes.toString('utf8'),
  acceptanceRelativePath,
);
assert.equal(strengthenedAcceptance.artifactId, 'step-1-legacy-baseline');
assert.equal(strengthenedAcceptance.acceptanceRevision, 6);
assert.equal(strengthenedAcceptance.scopeName, 'Step 1A — V0.8.2 deployed browser-runtime source and deployment-input byte checkpoint');
assert.deepEqual(strengthenedAcceptance.preC1AdversarialCorrections, [
  'Artifact names include github.run_attempt so reruns cannot collide with an earlier upload-artifact v4 artifact in the same workflow run.',
  'The workflow_run audit job always starts and explicitly rejects any source that is not a successful push-triggered primary run on main, so a skipped job cannot appear as a successful audit.',
  'The initial seal merge and later legitimate main updates use separate verifier roles: a unique historical two-parent seal merge must remain reachable, only that initial merge downloads the still-retained C3 pull-request artifact, and every future main push must prove both seal-merge ancestry and an earlier provider-bound successful initial external audit before auditing its own current artifact.',
  'Workflow-run discovery never uses the actor, branch, check_suite_id, created, event, head_sha, or status search filters that GitHub caps at 1,000 results; it takes two complete workflow-specific snapshots, reconciles total_count and unique IDs, binds stable [id,run_attempt] identities, and fails closed on shifts, truncation, or its explicit 100,000-run safety bound.',
  'Future lookup paginates every exact-seal external audit run and enumerates every retained attempt through attempt-specific run and job APIs, so list truncation or a later failed or cancelled rerun cannot erase an earlier successful initial audit.',
  'Initial C3 discovery paginates every matching workflow run and enumerates every retained attempt through exact-attempt run and job APIs before selecting the latest qualifying success.',
  'The published Round 5 C1 and its successful CI remain immutable FAIL evidence; Round 6 starts as its direct child and never rewrites Acceptance Round 5.',
  'The direct API verifier accepts only the protected workflow path itself or that path followed by one non-empty, newline-free API ref suffix.',
]);
const requiredAcceptanceIds = [
  'S1', 'S2', 'S3', 'S4', 'S5', 'D1', 'D2', 'D3', 'D4', 'D5', 'R1', 'R2', 'R3', 'R4',
  'V1', 'V2', 'E1', 'E2', 'E3', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6',
];
assert.deepEqual(strengthenedAcceptance.requirements.map(item => item.id), requiredAcceptanceIds);
assert.equal(
  strengthenedAcceptance.requirements.find(item => item.id === 'S5').condition,
  'The remote archive ref resolves exactly to the baseline commit, and a clean GitHub checkout of that immutable SHA passes the independently retained verification kit through CATS_BASELINE_DIR; historical descendants do not depend on the mutable ref.',
);
assert.deepEqual(
  strengthenedAcceptance.separateCapabilities.map(item => item.status),
  ['UNAVAILABLE_IN_V082', 'NOT_VERIFIED', 'NOT_EXECUTED_BY_DESIGN', 'NOT_CONFIGURED_AT_AUDIT'],
);
assert.deepEqual(
  strengthenedAcceptance.explicitExclusions.map(item => item.id),
  [
    'whole-repository-off-provider-backup', 'deleted-or-corrupt-player-save-recovery',
    'physical-iphone-standalone-pwa-approval', 'production-alias-switch', 'tamper-proof-github-workflow-bootstrap',
  ],
);
assert.equal(strengthenedAcceptance.reviewAuthenticity.proceduralIndependenceRequired, true);
assert.equal(strengthenedAcceptance.reviewAuthenticity.cryptographicReviewerAuthenticationClaimed, false);
assert.deepEqual(
  strengthenedAcceptance.reviewAuthenticity.requiredRecordedFields,
  ['taskPath', 'assignment', 'verbatimResponse', 'verbatimResponseSha256'],
);
assert.equal(
  strengthenedAcceptance.reviewAuthenticity.verbatimResponseContract,
  'Each reviewer must return one JSON object that binds its role, exact target commit and tree, CI run and job, verdict, material blockers, method, and findings to the outer record. The runtime critic must additionally bind its post-C1 Vercel deployment re-query; the final judge must bind the three critic-record hashes.',
);
assert.deepEqual(strengthenedAcceptance.externalMetadataAuthenticity, {
  vercelSource: 'authenticated connected-project Vercel deployment metadata',
  cryptographicResponseSignatureStored: false,
  mitigation: "Freeze the exact C1 metadata record, independently re-query the fresh deployment after C1, bind that check in the runtime critic's target-specific verbatim response, and separately verify the sealed raw deployment responses.",
  claimBoundary: 'This is procedurally cross-checked provider metadata plus recalculable response evidence, not a cryptographically signed Vercel attestation.',
});
assert.deepEqual(strengthenedAcceptance.ciProvenanceContract, {
  member: 'ci-provenance.json',
  appliesToRecordRoles: ['acceptance', 'candidate'],
  rawSourceArtifactFileCount: 94,
  expectedArtifactFileCount: 95,
  attemptScopedArtifactName: 'cats-v082-step-1-recovery-evidence-attempt-<runAttempt> for Round 6 C1/C2/C3/main; the historical raw-source artifact retains cats-v082-step-1-recovery-evidence',
  requiredFields: [
    'schemaVersion', 'repository', 'workflowName', 'workflowPath', 'workflowRef', 'workflowCommitSha',
    'workflowBlobSha', 'generator', 'sourceBoundary', 'event', 'eventContext.kind', 'runId',
    'runNumber', 'runAttempt', 'jobName', 'invocationCheckout.sha', 'invocationCheckout.tree',
    'invocationCheckout.ref', 'verificationKit.mode', 'verificationKit.sha', 'verificationKit.tree',
    'servedRuntime.mode', 'servedRuntime.sha', 'servedRuntime.tree',
  ],
  eventContextUnion: {
    pull_request: ['number', 'baseBranch', 'baseSha', 'headBranch', 'headSha'],
    push: ['ref', 'before', 'after'],
    workflow_dispatch: ['ref', 'sha'],
  },
  rawBytesStoredInCiRecord: true,
  rawField: 'artifact.provenanceMemberRaw',
  mutableHistoricalApiFields: ['pull_requests[]'],
  runHeadAuthority: 'The Actions run-level id, attempt, workflow, event, head_sha, and head_branch are the historical run authority. No field under the related pull_requests[] array, including number, refs, or SHAs, is used as historical authority.',
  eventTimeAuthority: 'For new C1/C2 runs, the primary checkout step immediately captures the event-specific context, exact HEAD/tree, run identity, github.workflow_ref, github.workflow_sha, and actual workflow blob before resolving another kit or executing repository test code. A second step only appends the verification-kit and served-runtime identities. The final raw bytes are copied without regeneration into the artifact and then into the next immutable CI record, bound by member SHA-256 and provider artifact digest.',
  claimBoundary: 'ci-provenance.json is generated by the frozen workflow from GitHub event context and the checked-out Git objects. It is not a GitHub-signed attestation; trust comes from the frozen generator, exact-head workflow execution, downloaded artifact digest, durable raw-byte copy, and cross-checks against run/job APIs.',
});
assert.deepEqual(strengthenedAcceptance.externalArtifactVerifier, {
  path: 'tests/verify-ci-artifact.mjs',
  invocation: 'node tests/verify-ci-artifact.mjs <c3-pr|initial-main-seal|future-main> <run-id> <exact-run-attempt> with GitHub Actions read token',
  providerAccess: 'the workflow passes the source event attempt or the deterministically selected latest successful C3 run attempt; the verifier itself calls those exact attempt-scoped run and job APIs, selects the artifact inside the matched job interval, downloads the ZIP, and calls Git commit/tree APIs; no caller-authored provider metadata is trusted',
  providerBindings: [
    'run id/attempt/workflow/event/head/status', 'job id/attempt/interval/steps',
    'artifact id/digest/size/expiry', 'workflow commit/tree/path/blob',
  ],
  archiveBindings: [
    'exact 95 entries', 'unique safe member names', 'exactly one ci-provenance.json',
    'ZIP SHA-256 equals provider digest',
  ],
  supportedRoles: ['c3-pr', 'initial-main-seal', 'future-main'],
  derivedRoleInvariants: 'C3 is discovered as the unique full-DAG seal introduction. Exactly one reachable historical merge must have parents [pre-merge main,C3], the C3 tree, and a first parent that does not already contain C3. c3-pr and initial-main-seal require that merge to be the audited main head; c3-pr binds its event-time base to its first parent and initial-main-seal binds push.before to it. future-main requires that merge as a strict ancestor, permits a changed descendant tree, binds push.before to a strict ancestor of the current main head, verifies the current workflow blob, and independently queries GitHub for an earlier successful external audit run/job on that exact merge in which both C3 and initial-main artifact steps succeeded. Both discovery paths use the workflow-specific run endpoint without any GitHub 1,000-result search filter, take two complete snapshots, reconcile total_count and unique IDs, require stable [id,run_attempt] identities, and then enumerate attempt 1 through each provider-reported latest attempt with exact-attempt run/job APIs. A later failed rerun, first-page truncation, snapshot shift, duplicate, missing provider record, or the explicit 100,000-run safety bound therefore fails closed instead of silently hiding a prior success. The verifier cannot substitute a later green run for a missing initial audit and does not re-download the historical C3 artifact. Both main roles require push/historical-seal/sealed-C3-runtime plus C1-C2-C3 ancestry.',
  workflowRunEnumeration: {
    officialLimit: 'GitHub returns at most 1,000 workflow runs for a search using actor, branch, check_suite_id, created, event, head_sha, or status.',
    endpoint: 'workflow-specific run list with only per_page and page pagination parameters',
    forbiddenSearchFilters: ['actor', 'branch', 'check_suite_id', 'created', 'event', 'head_sha', 'status'],
    snapshotPasses: 2,
    pageSize: 100,
    maximumPages: 1000,
    requiredChecks: [
      'stable total_count on every page and exact final item count',
      'valid unique provider item IDs with no cross-page duplication',
      'identical ordered [id,run_attempt] identities across both complete snapshots',
      'local candidate filtering followed by exact-attempt run and job API validation',
    ],
    embeddedSelfTests: [
      '101-item multi-page success',
      'provider total_count 1,001 with a silently truncated result is rejected',
      'duplicate IDs are rejected',
      'page-to-page total_count mutation is rejected',
    ],
    overflowOrMutationBehavior: 'hard FAIL; no completeness or durability claim is emitted',
  },
  requiredExternalUses: [
    'C3 pull-request-head artifact during the initial seal audit',
    'initial merged main push artifact',
    'each later main push artifact after proving an earlier provider-bound successful initial audit, without requiring the historical C3 artifact to remain downloadable',
  ],
  output: 'machine-readable PASS summary binding run, attempt, job, artifact, event, head, artifact digest, provenance SHA-256, verification kit, served runtime, and the provider-bound initial external audit identity required by future-main',
});
assert.deepEqual(strengthenedAcceptance.externalArtifactAuditWorkflow, {
  path: '.github/workflows/verify-step-1-artifacts.yml',
  trigger: 'workflow_run completion of the primary workflow on main',
  sourceRestriction: 'the job always starts and explicitly fails unless the source is a successful push-triggered primary run on main; no skipped job may represent a successful audit',
  checks: [
    'initial seal only: take two complete unfiltered primary-workflow run snapshots, reconcile total_count/unique IDs/stable attempts, locally select exact-C3 candidates, enumerate every retained exact attempt and job, then verify the selected pull-request artifact and exact two-parent merge topology',
    'initial seal: exact source main-push artifact',
    'future main: exact source main-push artifact, unique historical seal-merge ancestry, an earlier provider-bound successful initial audit discovered from two complete unfiltered external-workflow snapshots and every exact attempt whose C3 and main verification steps both passed, current workflow blob, and no re-download dependency on the expired C3 artifact',
  ],
  requiredConclusion: 'success before Step 1 completion report',
});

const requiredProtectedPaths = [
  '.github/baselines/v0.8.2/MANIFEST.json',
  '.github/baselines/v0.8.2/RESTORE.md',
  '.github/workflows/verify-main.yml',
  '.github/workflows/verify-step-1-artifacts.yml',
  'QUALITY_GATE.md',
  'quality-reviews/step-1-legacy-baseline/acceptance-round-003.json',
  'quality-reviews/step-1-legacy-baseline/acceptance-round-004.json',
  'quality-reviews/step-1-legacy-baseline/acceptance-round-005.json',
  'quality-reviews/step-1-legacy-baseline/round-003.json',
  'quality-reviews/step-1-legacy-baseline/round-004.json',
  'quality-reviews/step-1-legacy-baseline/round-005.json',
  'quality-reviews/step-1-legacy-baseline/evidence/fresh-recovery-commit-object.b64',
  'quality-reviews/step-1-legacy-baseline/evidence/fresh-recovery-preview-capture.json',
  'quality-reviews/step-1-legacy-baseline/evidence/runtime-manifest.json',
  'quality-reviews/step-1-legacy-baseline/evidence/vercel-deployment-metadata.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/chromium-375x667-loop.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/chromium-375x667-normal-flow.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/chromium-375x667-service-worker.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/chromium-390x844-loop.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/chromium-390x844-normal-flow.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/chromium-390x844-service-worker.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/webkit-375x667-loop.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/webkit-375x667-normal-flow.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/webkit-390x844-loop.json',
  'quality-reviews/step-1-legacy-baseline/evidence/raw/webkit-390x844-normal-flow.json',
  'tests/capture-v082-preview.mjs',
  'tests/verify-ci-artifact.mjs',
  'tests/verify-step-1-baseline.mjs',
];
assert.deepEqual(strengthenedAcceptance.protectedFiles.map(item => item.path).sort(), [...requiredProtectedPaths].sort());
assert.equal(new Set(strengthenedAcceptance.protectedFiles.map(item => item.path)).size, requiredProtectedPaths.length);
for (const protectedFile of strengthenedAcceptance.protectedFiles) {
  const bytes = await readFile(path.join(kitRoot, protectedFile.path));
  assert.equal(sha256(bytes), protectedFile.sha256, `Acceptance protected-file hash is stale: ${protectedFile.path}`);
}

const criticPathsByRole = {
  'adversarial-critic': 'quality-reviews/step-1-legacy-baseline/audits/round-006-adversarial-critic.json',
  'repository-critic': 'quality-reviews/step-1-legacy-baseline/audits/round-006-repository-critic.json',
  'runtime-critic': 'quality-reviews/step-1-legacy-baseline/audits/round-006-runtime-critic.json',
};
const canonicalMarkdownPaths = [
  'README.md', 'AGENTS.md', 'MASTER_SPEC.md', 'FLOORS_1_10_DESIGN.md', 'PROJECT_HANDOVER.md', 'BASELINE_V082.md',
];
const expectedC1Entries = [
  { status: 'M', path: '.github/workflows/verify-main.yml' },
  { status: 'M', path: '.github/workflows/verify-step-1-artifacts.yml' },
  { status: 'M', path: 'BASELINE_V082.md' },
  { status: 'M', path: 'PROJECT_HANDOVER.md' },
  { status: 'M', path: 'PROJECT_STATUS.json' },
  { status: 'A', path: 'quality-reviews/step-1-legacy-baseline/acceptance-round-006.json' },
  { status: 'A', path: 'quality-reviews/step-1-legacy-baseline/round-005.json' },
  { status: 'M', path: 'tests/verify-ci-artifact.mjs' },
  { status: 'M', path: 'tests/verify-step-1-baseline.mjs' },
].sort((left, right) => left.path.localeCompare(right.path));
const acceptanceCiPath = 'quality-reviews/step-1-legacy-baseline/evidence/acceptance-ci-run.json';
const candidateCiPath = 'quality-reviews/step-1-legacy-baseline/evidence/candidate-ci-run.json';
const finalJudgePath = 'quality-reviews/step-1-legacy-baseline/audits/round-006-final-judge.json';
const requiredCandidatePaths = [acceptanceCiPath, 'quality-reviews/step-1-legacy-baseline/evidence/clean-recovery.json', ...Object.values(criticPathsByRole)].sort();
const requiredSealPaths = [
  'AGENTS.md', 'BASELINE_V082.md', 'FLOORS_1_10_DESIGN.md', 'MASTER_SPEC.md', 'PROJECT_HANDOVER.md',
  'PROJECT_STATUS.json', 'README.md', candidateCiPath, finalJudgePath, sealRoundPath,
].sort();
assert.deepEqual([...strengthenedAcceptance.candidateAllowedPaths].sort(), requiredCandidatePaths);
assert.deepEqual([...strengthenedAcceptance.sealAllowedPaths].sort(), requiredSealPaths);
assert.deepEqual(
  [...strengthenedAcceptance.c1AllowedPaths].sort((left, right) => left.path.localeCompare(right.path)),
  expectedC1Entries,
);
const expectedCandidateEntries = requiredCandidatePaths.map(relativePath => ({
  status: relativePath === 'quality-reviews/step-1-legacy-baseline/evidence/clean-recovery.json' ? 'M' : 'A',
  path: relativePath,
})).sort((left, right) => left.path.localeCompare(right.path));
const expectedSealEntries = requiredSealPaths.map(relativePath => ({
  status: canonicalMarkdownPaths.includes(relativePath) || relativePath === 'PROJECT_STATUS.json' ? 'M' : 'A',
  path: relativePath,
})).sort((left, right) => left.path.localeCompare(right.path));

function assertExactEdge(parent, child, expectedEntries, label) {
  assert.deepEqual(changedEntries(parent, child), expectedEntries, `${label} change kinds or paths differ from Acceptance`);
  for (const entry of expectedEntries) {
    if (entry.status === 'A') assert.equal(gitPathExists(parent, entry.path), false, `${label} addition already existed in its parent: ${entry.path}`);
    else assert.equal(gitPathExists(parent, entry.path), true, `${label} modification was absent from its parent: ${entry.path}`);
    assertRegularFile(child, entry.path);
    if (entry.status === 'M') assertRegularFile(parent, entry.path);
  }
}
assert.deepEqual(Object.keys(strengthenedAcceptance.commitProtocol), ['c1', 'c2', 'c3', 'sealDiscovery', 'futureMode', 'mergePolicy']);
assert.equal(
  strengthenedAcceptance.commitProtocol.futureMode,
  'When the current repository workflow invokes it on a descendant of C3, the immutable Acceptance kernel remains the sole machine authority. Verification requires both sealed evidence trees, all exact universal quality-loop mirror claims, the duplicate-key-free authoritative Step 1A JSON entry with its canonical order, name, and PASS status, and one structured PASS marker and checklist row in each canonical document, then re-runs the historical C3 verifier against the immutable baseline. Arbitrary natural-language semantic completeness is not claimed, and preventing deletion or short-circuiting of the workflow itself requires an external GitHub ruleset that is not configured at audit time.',
);
assert.deepEqual(strengthenedAcceptance.futureImmutablePaths, futureImmutablePaths);
assert.deepEqual(strengthenedAcceptance.futureRequiredQualityGateClaims, futureRequiredQualityGateClaims);
assert.deepEqual(strengthenedAcceptance.futureNormativeKernel, {
  authorityPath: 'quality-reviews/step-1-legacy-baseline/acceptance-round-006.json',
  authorityRetention: 'The full quality-reviews/step-1-legacy-baseline Git tree is immutable at descendants of C3 when the verifier runs, so this kernel cannot be overridden by a current Markdown edit.',
  qualityLoopAuthority: 'futureRequiredQualityGateClaims is the non-overridable machine-readable minimum; current QUALITY_GATE.md is an evolvable mirror that must retain every exact claim.',
  step1StatusAuthority: 'The sealed PROJECT_STATUS legacyBaseline and legacyV082Verification objects plus the exact preparation[0] object {order:1,name:legacy-v082-source-runtime-byte-checkpoint,status:PASS} are authoritative; that entry must be unique by name and order, and current canonical Markdown files must retain one structured PASS marker and checklist row.',
  jsonAuthorityEncoding: 'Every JSON document consumed by the verifier, including PROJECT_STATUS, Acceptance, CI, round, evidence, critic, judge, and embedded verbatimResponse JSON, must reject duplicate object keys before semantic validation.',
  arbitraryNaturalLanguageSemanticCompletenessClaimed: false,
  boundary: 'The verifier does not claim to understand every possible contradictory natural-language sentence. Such prose cannot override this frozen kernel or structured JSON status, and later human review remains responsible for editorial clarity.',
});
assert.deepEqual(
  strengthenedAcceptance.sealStatusTransforms.projectStatusJsonPointers,
  [
    'preparation[0].status', 'legacyBaseline.sourceRuntimeCheckpoint', 'legacyV082Verification.githubActionsRun',
    'legacyV082Verification.githubActionsHead', 'legacyV082Verification.githubActionsConclusion', 'nextAction',
  ],
);
assert.deepEqual(
  Object.keys(strengthenedAcceptance.sealStatusTransforms.markdownReplacements).sort(),
  [...canonicalMarkdownPaths].sort(),
  'Acceptance must define the exact C2→C3 transform for every canonical Markdown file',
);
const expectedMarkdownReplacementCounts = {
  'README.md': 8,
  'AGENTS.md': 3,
  'MASTER_SPEC.md': 2,
  'FLOORS_1_10_DESIGN.md': 4,
  'PROJECT_HANDOVER.md': 9,
  'BASELINE_V082.md': 2,
};
assert.deepEqual(
  Object.fromEntries(
    Object.entries(strengthenedAcceptance.sealStatusTransforms.markdownReplacements)
      .map(([relativePath, replacements]) => [relativePath, replacements.length]),
  ),
  expectedMarkdownReplacementCounts,
  'Acceptance C2→C3 Markdown transform paths or replacement counts differ from the frozen protocol',
);
for (const [relativePath, replacements] of Object.entries(strengthenedAcceptance.sealStatusTransforms.markdownReplacements)) {
  assert(Array.isArray(replacements) && replacements.length >= 1, `No seal replacements defined for ${relativePath}`);
  assert.equal(new Set(replacements.map(replacement => replacement.from)).size, replacements.length, `${relativePath} repeats a seal-transform source`);
  assert.equal(new Set(replacements.map(replacement => replacement.to)).size, replacements.length, `${relativePath} repeats a seal-transform destination`);
  for (const replacement of replacements) {
    assert.deepEqual(Object.keys(replacement), ['from', 'to']);
    assert.equal(typeof replacement.from, 'string');
    assert.equal(typeof replacement.to, 'string');
    assert(replacement.from.length > 0 && replacement.to.length > 0 && replacement.from !== replacement.to);
  }
}
assert.deepEqual(
  strengthenedAcceptance.sealStatusTransforms.projectStatusTransforms.map(item => item.pointer),
  strengthenedAcceptance.sealStatusTransforms.projectStatusJsonPointers,
  'PROJECT_STATUS transform definitions and pointer allowlist differ',
);
assert.deepEqual(strengthenedAcceptance.externalCompletionStopConditions, [
  'the remote pull-request head equals C3',
  'the exact C3 head completes this workflow successfully',
  'after the main push workflow succeeds, the separately triggered external artifact workflow directly resolves and downloads the exact C3 artifact through GitHub API and verifies its ci-provenance.json raw bytes, hash, event context, checkout, workflow generator, verification kit, served runtime, and workflow Git objects',
  'the C3 Vercel Preview reaches READY and serves the expected documentation-only tree',
  'the PR is merged without squashing or rebasing so C1, C2, and C3 remain ancestors of main',
  'the resulting main head is an exact two-parent merge whose second parent is C3 and whose first parent is both the C3 event-time base and main push before SHA, and its Git tree equals C3 so the merge adds no unreviewed content',
  'the exact resulting main head completes the main push workflow successfully in historical-seal mode',
  'the same external artifact workflow directly resolves and downloads the exact resulting main push artifact through GitHub API and verifies its push-event ci-provenance.json raw bytes, hash, checkout, workflow generator, historical verification kit, sealed served runtime, C1/C2/C3 ancestry, and main-tree equality; that external workflow must complete successfully before reporting',
  'the remote archive ref still resolves to the exact baseline commit at completion-report time',
  'the fixed Production URL is rechecked after merge; no Production alias switch is performed',
]);
assert(strengthenedAcceptance.automaticFailureConditions.length >= 22);

const acceptanceCiRecord = await readOptionalJson(acceptanceCiPath);
const candidateCiRecord = await readOptionalJson(candidateCiPath);
const criticRecords = {};
for (const [role, relativePath] of Object.entries(criticPathsByRole)) {
  criticRecords[role] = await readOptionalJson(relativePath);
}
const committedAcceptance = gitPathExists(currentHead, acceptanceRelativePath);
const committedCandidatePieces = [acceptanceCiPath, ...Object.values(criticPathsByRole)]
  .map(relativePath => gitPathExists(currentHead, relativePath));
assert(committedCandidatePieces.every(Boolean) || committedCandidatePieces.every(value => !value), 'C2 critic/CI files are only partially committed');
const phase = preflight
  ? 'preflight'
  : sealCommit
    ? 'seal'
    : committedCandidatePieces.every(Boolean)
      ? 'candidate'
      : committedAcceptance
        ? 'acceptance'
        : 'preflight';
const acceptanceCommit = phase === 'seal'
  ? sealedRound.acceptance.commit
  : phase === 'candidate'
    ? singleParent(currentHead, 'C2')
    : phase === 'acceptance'
      ? currentHead
      : null;
const candidateCommit = phase === 'seal' ? sealedRound.reviewTargetCommit : phase === 'candidate' ? currentHead : null;

if (phase === 'candidate') {
  assert.deepEqual(touchedPaths(acceptanceCommit, candidateCommit), requiredCandidatePaths, 'C1→C2 touched-path set differs from Acceptance');
  assertExactEdge(acceptanceCommit, candidateCommit, expectedCandidateEntries, 'C1→C2');
}
if (phase === 'seal') {
  assert.equal(singleParent(candidateCommit, 'C2'), acceptanceCommit, 'C2 is not the direct child of C1');
  assert.equal(singleParent(sealCommit, 'C3'), candidateCommit, 'C3 is not the direct child of C2');
  assert.deepEqual(touchedPaths(acceptanceCommit, candidateCommit), requiredCandidatePaths, 'C1→C2 touched-path set differs from Acceptance');
  assert.deepEqual(touchedPaths(candidateCommit, sealCommit), requiredSealPaths, 'C2→C3 touched-path set differs from Acceptance');
  assertExactEdge(acceptanceCommit, candidateCommit, expectedCandidateEntries, 'C1→C2');
  assertExactEdge(candidateCommit, sealCommit, expectedSealEntries, 'C2→C3');
}

if (acceptanceCommit) {
  assert.equal(singleParent(acceptanceCommit, 'Round 6 C1'), failedRoundFiveCommit, 'Round 6 C1 is not the direct child of failed Round 5 C1');
  assertExactEdge(failedRoundFiveCommit, acceptanceCommit, expectedC1Entries, 'failed Round 5 C1→Round 6 C1');
  const frozenAcceptance = kitGit(['show', `${acceptanceCommit}:${acceptanceRelativePath}`], null);
  assert.equal(sha256(frozenAcceptance), sha256(strengthenedAcceptanceBytes), 'Acceptance changed after C1');
  for (const protectedFile of strengthenedAcceptance.protectedFiles) {
    for (const commit of [acceptanceCommit, candidateCommit, sealCommit].filter(Boolean)) {
      const row = kitGit(['ls-tree', commit, '--', protectedFile.path]).trim().split(/\s+/);
      assert.equal(row[0], '100644', `Protected path is not a regular file at ${commit}: ${protectedFile.path}`);
      assert.equal(sha256(kitGit(['show', `${commit}:${protectedFile.path}`], null)), protectedFile.sha256);
    }
  }
}

const canonicalDocuments = {
  'README.md': await readFile(path.join(kitRoot, 'README.md'), 'utf8'),
  'AGENTS.md': await readFile(path.join(kitRoot, 'AGENTS.md'), 'utf8'),
  'MASTER_SPEC.md': await readFile(path.join(kitRoot, 'MASTER_SPEC.md'), 'utf8'),
  'FLOORS_1_10_DESIGN.md': await readFile(path.join(kitRoot, 'FLOORS_1_10_DESIGN.md'), 'utf8'),
  'PROJECT_HANDOVER.md': await readFile(path.join(kitRoot, 'PROJECT_HANDOVER.md'), 'utf8'),
  'BASELINE_V082.md': await readFile(path.join(kitRoot, 'BASELINE_V082.md'), 'utf8'),
};
const canonicalMarker = `工程状態: 工程1A=${status.preparation[0].status} / 工程2=PENDING_REVALIDATION / 工程3=PENDING_REVALIDATION / 工程4以降=NOT_STARTED`;
const canonicalScope = '工程1A正式名称: V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint';
const canonicalExclusions = '工程1A対象外: whole-repository backup / player-save backup / physical-iPhone approval / Production alias switch';
const canonicalChecklist = `1. V0.8.2 deployed browser-runtime source + deployment-input byte checkpoint — \`${status.preparation[0].status}\``;
for (const [name, contents] of Object.entries(canonicalDocuments)) {
  assert(contents.includes(canonicalMarker), `${name} omits the exact canonical project-state marker`);
  assert(contents.includes(canonicalScope), `${name} omits the exact Step 1A scope`);
  assert(contents.includes(canonicalExclusions), `${name} omits the exact Step 1A exclusions`);
  const checklistRows = contents.match(/^1\. V0\.8\.2 deployed browser-runtime source \+ deployment-input byte checkpoint — `[^`]+`$/gmu) || [];
  assert.deepEqual(checklistRows, [canonicalChecklist], `${name} must contain exactly one canonical Step 1A checklist row`);
  assert(!/工程1(?![A0-9])/u.test(contents), `${name} contains an unqualified Step 1 claim`);
  assert(!contents.includes('現行版の保存点'), `${name} contains the retired ambiguous checkpoint name`);
}

if (phase !== 'seal') {
  for (const [relativePath, replacements] of Object.entries(strengthenedAcceptance.sealStatusTransforms.markdownReplacements)) {
    let source = canonicalDocuments[relativePath];
    for (const replacement of replacements) {
      assert.equal(source.split(replacement.from).length - 1, 1, `${relativePath} C2 seal source is not unique`);
      source = source.replace(replacement.from, replacement.to);
    }
  }
}

if (phase !== 'seal') {
  assert.equal(status.preparation[0].status, 'IN_PROGRESS', 'C1 and C2 must remain IN_PROGRESS');
  assert.equal(candidateCiRecord, null, 'candidate-ci-run.json may only be introduced by C3');
} else {
  assert.equal(status.preparation[0].status, 'PASS', 'C3 must perform the exact PASS transition');
}

async function validateCriticRecord(record, role, relativePath, c1, c1Ci, acceptanceSha) {
  assert(record, `Missing ${role} record`);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.artifactId, 'step-1-legacy-baseline');
  assert.equal(record.role, role);
  assert.equal(record.source, 'Codex collaboration sub-agent response recorded by the primary agent');
  assert.equal(record.cryptographicReviewerAuthentication, false);
  assert.equal(typeof record.reviewerId, 'string');
  assert(record.reviewerId.length >= 3);
  assert.equal(typeof record.taskPath, 'string');
  assert(record.taskPath.startsWith('/root/step1_'));
  assert.equal(typeof record.assignment, 'string');
  assert(record.assignment.length >= 80);
  assert.equal(typeof record.verbatimResponse, 'string');
  assert(record.verbatimResponse.length >= 200);
  assert.equal(record.verbatimResponseSha256, sha256(Buffer.from(record.verbatimResponse, 'utf8')));
  const verbatim = parseJsonStrict(record.verbatimResponse, `${role} verbatimResponse`);
  const expectedVerbatimKeys = [
    'findings', 'materialBlockers', 'method', 'reviewTargetCommit', 'reviewTargetTree',
    'reviewedCiJobId', 'reviewedCiRunId', 'role', 'verdict',
  ];
  if (role === 'runtime-critic') {
    expectedVerbatimKeys.push('vercelCommitSha', 'vercelDeploymentId', 'vercelRecheckedAt', 'vercelState');
  }
  assert.deepEqual(Object.keys(verbatim).sort(), expectedVerbatimKeys.sort());
  assert.equal(record.reviewTargetCommit, c1);
  assert.equal(record.reviewTargetTree, kitGit(['rev-parse', `${c1}^{tree}`]).trim());
  assert.equal(record.reviewedAcceptanceSha256, acceptanceSha);
  assert.equal(record.reviewedCiRunId, c1Ci.runId);
  assert.equal(record.reviewedCiJobId, c1Ci.job.id);
  assert.equal(record.reviewedCiCheckoutSha, c1Ci.checkout.sha);
  assert.equal(record.reviewedCiCheckoutTree, c1Ci.checkout.tree);
  assert.equal(record.reviewedCiArtifactDigest, c1Ci.artifact.digest);
  assert.equal(record.reviewedCiRecordPath, acceptanceCiPath);
  assert.equal(
    record.reviewedCiRecordSha256,
    sha256(kitGit(['show', `${candidateCommit}:${acceptanceCiPath}`], null)),
    `${role} does not bind the exact C1 CI record bytes`,
  );
  assert(Date.parse(record.reviewedAt) > Date.parse(c1Ci.job.completedAt));
  assert.equal(record.status, 'PASS');
  assert.deepEqual(record.unresolvedMaterialBlockers, []);
  assert(Array.isArray(record.method) && record.method.length >= 2 && record.method.every(item => typeof item === 'string' && item.length >= 20));
  assert(Array.isArray(record.findings) && record.findings.length >= 2 && record.findings.every(item => typeof item === 'string' && item.length >= 20));
  assert.equal(verbatim.verdict, record.status, `${role} verbatim verdict contradicts its outer status`);
  assert.equal(verbatim.role, record.role, `${role} verbatim role contradicts its outer role`);
  assert.equal(verbatim.reviewTargetCommit, record.reviewTargetCommit, `${role} verbatim target commit contradicts its outer target`);
  assert.equal(verbatim.reviewTargetTree, record.reviewTargetTree, `${role} verbatim target tree contradicts its outer target`);
  assert.equal(verbatim.reviewedCiRunId, record.reviewedCiRunId, `${role} verbatim CI run contradicts its outer record`);
  assert.equal(verbatim.reviewedCiJobId, record.reviewedCiJobId, `${role} verbatim CI job contradicts its outer record`);
  if (role === 'runtime-critic') {
    assert.equal(record.vercelDeploymentId, 'dpl_3qe2uhLnFQ4e9M4UmedQxRGUY3xV');
    assert.equal(record.vercelCommitSha, '2b58ab705e569cc4f5c1ee2e88ea550ab162e4b3');
    assert.equal(record.vercelState, 'READY');
    assert(Date.parse(record.vercelRecheckedAt) > Date.parse(c1Ci.job.completedAt));
    assert(Date.parse(record.vercelRecheckedAt) <= Date.parse(record.reviewedAt));
    assert.equal(verbatim.vercelDeploymentId, record.vercelDeploymentId);
    assert.equal(verbatim.vercelCommitSha, record.vercelCommitSha);
    assert.equal(verbatim.vercelState, record.vercelState);
    assert.equal(verbatim.vercelRecheckedAt, record.vercelRecheckedAt);
  }
  assert.deepEqual(verbatim.materialBlockers, record.unresolvedMaterialBlockers, `${role} verbatim blockers contradict the outer blocker list`);
  assert.deepEqual(verbatim.method, record.method, `${role} verbatim method contradicts the outer method list`);
  assert.deepEqual(verbatim.findings, record.findings, `${role} verbatim findings contradict the outer findings list`);
  const bytes = kitGit(['show', `${candidateCommit}:${relativePath}`], null);
  assert.equal(sha256(bytes), sha256(await readFile(path.join(kitRoot, relativePath))));
  return record;
}

let validatedCritics = null;
if (phase === 'candidate' || phase === 'seal') {
  const c1Ci = validateCiRecord(acceptanceCiRecord, 'acceptance', acceptanceCommit);
  assert(Date.parse(c1Ci.job.completedAt) < Date.parse(c1Ci.artifact.expiresAt));
  assert.equal(cleanRecovery.directGitHubCheckoutCiResult, 'PASS');
  assert.equal(cleanRecovery.browserFromCleanCheckoutCiResult, 'PASS');
  assert.equal(cleanRecovery.githubActionsRunId, c1Ci.runId);
  assert.equal(cleanRecovery.githubActionsHeadSha, acceptanceCommit);
  assert.equal(cleanRecovery.githubActionsConclusion, 'success');
  const acceptanceSha = sha256(strengthenedAcceptanceBytes);
  validatedCritics = {};
  for (const [role, relativePath] of Object.entries(criticPathsByRole)) {
    validatedCritics[role] = await validateCriticRecord(
      criticRecords[role], role, relativePath, acceptanceCommit, c1Ci, acceptanceSha,
    );
  }
  assert.equal(new Set(Object.values(validatedCritics).map(record => record.reviewerId)).size, 3);
  assert.equal(new Set(Object.values(validatedCritics).map(record => record.taskPath)).size, 3);
}

function applyExactReplacements(source, replacements, relativePath) {
  let result = source;
  for (const [from, to] of replacements) {
    assert.equal(result.split(from).length - 1, 1, `${relativePath} seal transform source is not unique`);
    result = result.replace(from, to);
  }
  return result;
}

if (phase === 'seal') {
  const finalReview = sealedRound;
  const c2Ci = validateCiRecord(candidateCiRecord, 'candidate', candidateCommit);
  assert(Date.parse(c2Ci.job.startedAt) > Math.max(...Object.values(validatedCritics).map(record => Date.parse(record.reviewedAt))));
  const markdownTransforms = strengthenedAcceptance.sealStatusTransforms.markdownReplacements;
  for (const [relativePath, replacements] of Object.entries(markdownTransforms)) {
    const before = kitGit(['show', `${candidateCommit}:${relativePath}`], 'utf8');
    const after = kitGit(['show', `${sealCommit}:${relativePath}`], 'utf8');
    assert.equal(
      after,
      applyExactReplacements(before, replacements.map(item => [item.from, item.to]), relativePath),
      `C3 made a non-mechanical change to ${relativePath}`,
    );
  }
  const statusBeforeText = kitGit(['show', `${candidateCommit}:PROJECT_STATUS.json`], 'utf8');
  const statusBefore = parseJsonStrict(statusBeforeText, 'C2 PROJECT_STATUS.json');
  const expectedStatusAfter = structuredClone(statusBefore);
  const dynamicStatusValues = {
    'candidateCi.runId': c2Ci.runId,
    'candidateCi.pullRequest.headSha': candidateCommit,
  };
  const statusLocations = {
    'preparation[0].status': [expectedStatusAfter.preparation[0], 'status'],
    'legacyBaseline.sourceRuntimeCheckpoint': [expectedStatusAfter.legacyBaseline, 'sourceRuntimeCheckpoint'],
    'legacyV082Verification.githubActionsRun': [expectedStatusAfter.legacyV082Verification, 'githubActionsRun'],
    'legacyV082Verification.githubActionsHead': [expectedStatusAfter.legacyV082Verification, 'githubActionsHead'],
    'legacyV082Verification.githubActionsConclusion': [expectedStatusAfter.legacyV082Verification, 'githubActionsConclusion'],
    nextAction: [expectedStatusAfter, 'nextAction'],
  };
  for (const transform of strengthenedAcceptance.sealStatusTransforms.projectStatusTransforms) {
    const [owner, key] = statusLocations[transform.pointer];
    assert(owner, `Unknown PROJECT_STATUS transform pointer: ${transform.pointer}`);
    assert.deepEqual(owner[key], transform.from, `PROJECT_STATUS C2 source differs at ${transform.pointer}`);
    owner[key] = Object.hasOwn(transform, 'to') ? transform.to : dynamicStatusValues[transform.toSource];
    assert.notEqual(owner[key], undefined, `Unknown PROJECT_STATUS dynamic source: ${transform.toSource}`);
  }
  assert.equal(
    kitGit(['show', `${sealCommit}:PROJECT_STATUS.json`], 'utf8'),
    `${JSON.stringify(expectedStatusAfter, null, 2)}\n`,
    'C3 made a non-mechanical or formatting change to PROJECT_STATUS.json',
  );

  const judge = parseJsonStrict(
    await readFile(path.join(kitRoot, finalJudgePath), 'utf8'),
    finalJudgePath,
  );
  assert.equal(judge.schemaVersion, 1);
  assert.equal(judge.artifactId, 'step-1-legacy-baseline');
  assert.equal(judge.role, 'final-judge');
  assert.equal(judge.source, 'Codex collaboration sub-agent response recorded by the primary agent');
  assert.equal(judge.cryptographicReviewerAuthentication, false);
  assert.equal(typeof judge.reviewerId, 'string');
  assert(judge.reviewerId.length >= 3);
  assert.equal(typeof judge.taskPath, 'string');
  assert(judge.taskPath.startsWith('/root/step1_'));
  assert.equal(typeof judge.assignment, 'string');
  assert(judge.assignment.length >= 80);
  assert.equal(typeof judge.verbatimResponse, 'string');
  assert(judge.verbatimResponse.length >= 200);
  assert.equal(judge.reviewTargetCommit, candidateCommit);
  assert.equal(judge.reviewTargetTree, kitGit(['rev-parse', `${candidateCommit}^{tree}`]).trim());
  assert.equal(judge.reviewedAcceptanceSha256, sha256(strengthenedAcceptanceBytes));
  assert.equal(judge.reviewedCiRunId, c2Ci.runId);
  assert.equal(judge.reviewedCiJobId, c2Ci.job.id);
  assert.equal(judge.reviewedCiCheckoutSha, c2Ci.checkout.sha);
  assert.equal(judge.reviewedCiCheckoutTree, c2Ci.checkout.tree);
  assert.equal(judge.reviewedCiArtifactDigest, c2Ci.artifact.digest);
  assert.equal(judge.reviewedCiRecordPath, candidateCiPath);
  assert.equal(
    judge.reviewedCiRecordSha256,
    sha256(kitGit(['show', `${sealCommit}:${candidateCiPath}`], null)),
    'Final judge does not bind the exact C2 CI record bytes',
  );
  assert.equal(judge.verbatimResponseSha256, sha256(Buffer.from(judge.verbatimResponse, 'utf8')));
  const judgeVerbatim = parseJsonStrict(judge.verbatimResponse, 'final-judge verbatimResponse');
  assert.deepEqual(Object.keys(judgeVerbatim).sort(), [
    'criticRecordHashes', 'findings', 'materialBlockers', 'method', 'reviewTargetCommit',
    'reviewTargetTree', 'reviewedCiJobId', 'reviewedCiRunId', 'role', 'verdict',
  ]);
  assert(Date.parse(judge.reviewedAt) > Date.parse(c2Ci.job.completedAt));
  assert.equal(judge.status, 'PASS');
  assert.deepEqual(judge.unresolvedMaterialBlockers, []);
  assert(Array.isArray(judge.method) && judge.method.length >= 2 && judge.method.every(item => typeof item === 'string' && item.length >= 20));
  assert(Array.isArray(judge.findings) && judge.findings.length >= 2 && judge.findings.every(item => typeof item === 'string' && item.length >= 20));
  assert.equal(judgeVerbatim.verdict, judge.status, 'Final-judge verbatim verdict contradicts its outer status');
  assert.equal(judgeVerbatim.role, judge.role, 'Final-judge verbatim role contradicts its outer role');
  assert.equal(judgeVerbatim.reviewTargetCommit, judge.reviewTargetCommit, 'Final-judge verbatim target commit contradicts its outer target');
  assert.equal(judgeVerbatim.reviewTargetTree, judge.reviewTargetTree, 'Final-judge verbatim target tree contradicts its outer target');
  assert.equal(judgeVerbatim.reviewedCiRunId, judge.reviewedCiRunId, 'Final-judge verbatim CI run contradicts its outer record');
  assert.equal(judgeVerbatim.reviewedCiJobId, judge.reviewedCiJobId, 'Final-judge verbatim CI job contradicts its outer record');
  assert.deepEqual(judgeVerbatim.materialBlockers, judge.unresolvedMaterialBlockers, 'Final-judge verbatim blockers contradict the outer blocker list');
  assert.deepEqual(judgeVerbatim.method, judge.method, 'Final-judge verbatim method contradicts the outer method list');
  assert.deepEqual(judgeVerbatim.findings, judge.findings, 'Final-judge verbatim findings contradict the outer findings list');
  const expectedCriticReferences = Object.entries(criticPathsByRole).map(([role, relativePath]) => ({
    role,
    path: relativePath,
    sha256: sha256(kitGit(['show', `${candidateCommit}:${relativePath}`], null)),
    verbatimResponseSha256: validatedCritics[role].verbatimResponseSha256,
  })).sort((left, right) => left.role.localeCompare(right.role));
  assert.deepEqual([...judge.criticReferences].sort((left, right) => left.role.localeCompare(right.role)), expectedCriticReferences);
  assert.deepEqual(
    [...judgeVerbatim.criticRecordHashes].sort((left, right) => left.role.localeCompare(right.role)),
    expectedCriticReferences.map(({ role, sha256: recordSha256 }) => ({ role, sha256: recordSha256 })),
    'Final-judge verbatim response does not bind the exact three critic-record hashes',
  );

  assert.equal(finalReview.artifactId, 'step-1-legacy-baseline');
  assert.equal(finalReview.round, 6);
  assert.equal(finalReview.reviewTargetCommit, candidateCommit);
  assert.equal(finalReview.reviewTargetTree, kitGit(['rev-parse', `${candidateCommit}^{tree}`]).trim());
  assert.equal(finalReview.overallStatus, 'PASS');
  assert.deepEqual(Object.keys(finalReview.gates), ['G1', 'G2', 'G3', 'G4', 'G5']);
  assert.deepEqual(Object.values(finalReview.gates), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
  assert.equal(finalReview.acceptance.file, acceptanceRelativePath);
  assert.equal(finalReview.acceptance.commit, acceptanceCommit);
  assert.equal(finalReview.acceptance.tree, kitGit(['rev-parse', `${acceptanceCommit}^{tree}`]).trim());
  assert.equal(finalReview.acceptance.sha256, sha256(strengthenedAcceptanceBytes));
  assert.equal(finalReview.candidateCiEvidence.file, candidateCiPath);
  assert.equal(
    finalReview.candidateCiEvidence.sha256,
    sha256(kitGit(['show', `${sealCommit}:${candidateCiPath}`], null)),
  );
  assert.equal(finalReview.candidateCiEvidence.runId, c2Ci.runId);
  assert.equal(finalReview.candidateCiEvidence.jobId, c2Ci.job.id);
  assert.equal(finalReview.candidateCiEvidence.headSha, candidateCommit);
  assert.equal(finalReview.candidateCiEvidence.checkoutTree, c2Ci.checkout.tree);
  assert.equal(finalReview.candidateCiEvidence.artifactDigest, c2Ci.artifact.digest);
  assert.deepEqual(Object.keys(finalReview.requirementResults).sort(), requiredAcceptanceIds.sort());
  assert(Object.values(finalReview.requirementResults).every(result => result === 'PASS'));
  assert.equal(finalReview.independentAudits.length, 4);
  const auditRecords = {
    ...Object.fromEntries(Object.entries(criticPathsByRole).map(([role, relativePath]) => [role, { record: validatedCritics[role], path: relativePath }])),
    'final-judge': { record: judge, path: finalJudgePath },
  };
  assert.deepEqual(finalReview.independentAudits.map(item => item.role).sort(), Object.keys(auditRecords).sort());
  assert.equal(new Set(finalReview.independentAudits.map(item => item.reviewerId)).size, 4);
  assert.equal(new Set([...Object.values(validatedCritics), judge].map(record => record.taskPath)).size, 4);
  assert.equal(new Set([...Object.values(validatedCritics), judge].map(record => record.reviewerId)).size, 4);
  for (const audit of finalReview.independentAudits) {
    const expected = auditRecords[audit.role];
    assert.equal(audit.path, expected.path);
    assert.equal(audit.reviewerId, expected.record.reviewerId);
    assert.equal(audit.sha256, sha256(await readFile(path.join(kitRoot, audit.path))));
    assert.equal(audit.verbatimResponseSha256, expected.record.verbatimResponseSha256);
  }
  assert.deepEqual(finalReview.externalSealCi, {
    requiredBeforeCompletionReport: true,
    recordedInsideSeal: false,
    exactC3PullRequestHeadCiRequired: true,
    exactC3ArtifactProvenanceInspectionRequired: true,
    mergedMainPushCiRequired: true,
    mergedMainArtifactProvenanceInspectionRequired: true,
    postMainExternalArtifactAuditWorkflowRequired: true,
    mergedMainMustContainC1C2C3: true,
    mergedMainExactTwoParentBindingRequired: true,
    mergedMainTreeMustEqualC3Tree: true,
  });
}

if (remote) {
  const ref = git(['ls-remote', 'origin', archiveRef]).trim().split(/\s+/);
  assert.equal(ref[0], baselineCommit, `Remote archive ref does not resolve to ${baselineCommit}`);
  assert.equal(ref[1], archiveRef, 'Remote archive ref is missing');
}

if (live) {
  for (const entry of manifest.entries) {
    const url = new URL(entry.servedPath, manifest.fixedProductionUrl);
    const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
    assert.equal(response.status, 200, `Live HTTP failure: ${url}`);
    assert((response.headers.get('content-type') || '').startsWith(entry.contentType), `Live MIME mismatch: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.byteLength, entry.bytes, `Live byte size mismatch: ${url}`);
    assert.equal(sha256(bytes), entry.sha256, `Live SHA-256 mismatch: ${url}`);
  }
}

console.log(`Step 1 baseline verification passed${remote ? ' + remote ref' : ''}${live ? ' + live runtime' : ''}.`);
