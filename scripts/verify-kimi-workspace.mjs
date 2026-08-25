#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_REPOSITORY = '2hg7trp7rv-design/cats_tower';
const EXPECTED_BRANCH = 'kimi';
const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);

function runGit(args, options = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim() || error?.message || 'unknown git error';
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }
}

function normalizeRepository(remoteUrl) {
  const value = remoteUrl.trim().replace(/\.git$/, '');

  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/]+)$/i);
  if (sshMatch) return sshMatch[1];

  const sshUrlMatch = value.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/i);
  if (sshUrlMatch) return sshUrlMatch[1];

  const httpsMatch = value.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i);
  if (httpsMatch) return httpsMatch[1];

  return value;
}

function fail(message, details = {}) {
  const output = {
    ok: false,
    status: 'BLOCKED',
    policy: 'fail-closed',
    message,
    ...details,
  };
  process.stderr.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(2);
}

function readPolicy(repoRoot) {
  const policyPath = resolve(repoRoot, 'AI_PROJECT_POLICY.json');
  if (!existsSync(policyPath)) {
    fail('AI_PROJECT_POLICY.json is missing.', { policyPath });
  }

  try {
    return JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (error) {
    fail('AI_PROJECT_POLICY.json is not valid JSON.', {
      policyPath,
      error: error?.message || String(error),
    });
  }
}

let repoRoot;
try {
  repoRoot = runGit(['-C', scriptDirectory, 'rev-parse', '--show-toplevel']);
} catch (error) {
  fail('The script is not located inside a Git repository.', {
    scriptDirectory,
    error: error.message,
  });
}

process.chdir(repoRoot);

const policy = readPolicy(repoRoot);
const policyRepository = policy?.repository?.fullName;
const policyBranch = policy?.repository?.allowedBranch;

if (policyRepository !== EXPECTED_REPOSITORY || policyBranch !== EXPECTED_BRANCH) {
  fail('Machine-readable policy does not match the immutable Cat\'s Tower repository lock.', {
    expectedRepository: EXPECTED_REPOSITORY,
    expectedBranch: EXPECTED_BRANCH,
    policyRepository,
    policyBranch,
  });
}

let branch;
try {
  branch = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);
} catch (error) {
  fail('Detached HEAD or unresolved branch is prohibited.', { error: error.message });
}

if (branch !== EXPECTED_BRANCH) {
  fail('Wrong branch. No read-modify-write task may continue.', {
    expectedBranch: EXPECTED_BRANCH,
    actualBranch: branch,
  });
}

let originUrl;
try {
  originUrl = runGit(['remote', 'get-url', 'origin']);
} catch (error) {
  fail('The origin remote cannot be verified.', { error: error.message });
}

const actualRepository = normalizeRepository(originUrl);
if (actualRepository.toLowerCase() !== EXPECTED_REPOSITORY.toLowerCase()) {
  fail('Wrong repository. No write may continue.', {
    expectedRepository: EXPECTED_REPOSITORY,
    actualRepository,
    originUrl,
  });
}

let gitDir;
try {
  gitDir = runGit(['rev-parse', '--git-dir']);
} catch (error) {
  fail('Git metadata directory cannot be resolved.', { error: error.message });
}

const absoluteGitDir = resolve(repoRoot, gitDir);
const forbiddenOperationMarkers = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'REBASE_HEAD',
  'rebase-apply',
  'rebase-merge',
];

const activeOperations = forbiddenOperationMarkers.filter((name) =>
  existsSync(resolve(absoluteGitDir, name)),
);

if (activeOperations.length > 0) {
  fail('Merge, rebase, cherry-pick, or revert state is prohibited for this workflow.', {
    activeOperations,
  });
}

let head;
let upstream;
let statusLines;
try {
  head = runGit(['rev-parse', 'HEAD']);
  upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  statusLines = runGit(['status', '--porcelain=v1']);
} catch (error) {
  fail('Repository state cannot be fully inspected.', { error: error.message });
}

if (upstream !== 'origin/kimi') {
  fail('The kimi branch must track origin/kimi.', {
    expectedUpstream: 'origin/kimi',
    actualUpstream: upstream,
  });
}

const dirty = statusLines.length > 0;
if (dirty && process.env.CATS_TOWER_ALLOW_DIRTY !== '1') {
  fail('Working tree is not clean. Inspect the pending changes before starting another task.', {
    head,
    status: statusLines.split('\n'),
    override: 'Set CATS_TOWER_ALLOW_DIRTY=1 only while intentionally validating current uncommitted work.',
  });
}

const output = {
  ok: true,
  status: 'PASS',
  repository: EXPECTED_REPOSITORY,
  branch: EXPECTED_BRANCH,
  upstream,
  head,
  clean: !dirty,
  policyFile: resolve(repoRoot, 'AI_PROJECT_POLICY.json'),
  script: resolve(scriptDirectory, 'verify-kimi-workspace.mjs'),
  message: 'Repository and branch preflight passed. This does not certify product completion.',
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
