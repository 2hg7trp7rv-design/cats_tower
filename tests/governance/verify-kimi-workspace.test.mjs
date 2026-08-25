#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testFile = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(testFile), '../..');
const guardSource = resolve(repositoryRoot, 'scripts/verify-kimi-workspace.mjs');
const policySource = resolve(repositoryRoot, 'AI_PROJECT_POLICY.json');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function git(cwd, args) {
  return run('git', ['-C', cwd, ...args]);
}

function runGuard(testRepository) {
  const result = spawnSync(
    process.execPath,
    [resolve(testRepository, 'scripts/verify-kimi-workspace.mjs')],
    {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, CATS_TOWER_ALLOW_DIRTY: '' },
    },
  );

  const raw = (result.status === 0 ? result.stdout : result.stderr).trim();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Guard returned non-JSON output: ${raw}\n${error.message}`);
  }

  return { statusCode: result.status, payload };
}

function expectBlocked(result, expectedMessagePart) {
  assert.equal(result.statusCode, 2);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.status, 'BLOCKED');
  assert.match(result.payload.message, new RegExp(expectedMessagePart));
}

const testRepository = mkdtempSync(resolve(tmpdir(), 'cats-tower-kimi-guard-'));

try {
  mkdirSync(resolve(testRepository, 'scripts'), { recursive: true });
  cpSync(guardSource, resolve(testRepository, 'scripts/verify-kimi-workspace.mjs'));
  cpSync(policySource, resolve(testRepository, 'AI_PROJECT_POLICY.json'));

  git(testRepository, ['init', '-b', 'kimi']);
  git(testRepository, ['config', 'user.email', 'governance-test@example.invalid']);
  git(testRepository, ['config', 'user.name', 'Cat Tower Governance Test']);
  git(testRepository, ['add', '.']);
  git(testRepository, ['commit', '-m', 'test fixture']);
  git(testRepository, [
    'remote',
    'add',
    'origin',
    'git@github.com:2hg7trp7rv-design/cats_tower.git',
  ]);
  git(testRepository, ['update-ref', 'refs/remotes/origin/kimi', 'HEAD']);
  git(testRepository, ['branch', '--set-upstream-to=origin/kimi', 'kimi']);

  const passCase = runGuard(testRepository);
  assert.equal(passCase.statusCode, 0);
  assert.equal(passCase.payload.ok, true);
  assert.equal(passCase.payload.status, 'PASS');
  assert.equal(passCase.payload.repository, '2hg7trp7rv-design/cats_tower');
  assert.equal(passCase.payload.branch, 'kimi');

  git(testRepository, ['switch', '-c', 'main']);
  expectBlocked(runGuard(testRepository), 'Wrong branch');
  git(testRepository, ['switch', 'kimi']);
  git(testRepository, ['branch', '-D', 'main']);

  appendFileSync(resolve(testRepository, 'AI_PROJECT_POLICY.json'), '\n', 'utf8');
  const dirtyCase = runGuard(testRepository);
  expectBlocked(dirtyCase, 'Working tree is not clean');
  assert.ok(Array.isArray(dirtyCase.payload.workingTree));
  git(testRepository, ['checkout', '--', 'AI_PROJECT_POLICY.json']);

  git(testRepository, ['remote', 'set-url', 'origin', 'git@github.com:someone/other.git']);
  const wrongRemoteCase = runGuard(testRepository);
  expectBlocked(wrongRemoteCase, 'Wrong repository');
  assert.equal(wrongRemoteCase.payload.actualRepository, 'someone/other');
  git(testRepository, [
    'remote',
    'set-url',
    'origin',
    'git@github.com:2hg7trp7rv-design/cats_tower.git',
  ]);

  appendFileSync(resolve(testRepository, 'AI_PROJECT_POLICY.json'), 'broken', 'utf8');
  expectBlocked(runGuard(testRepository), 'not valid JSON');
  git(testRepository, ['checkout', '--', 'AI_PROJECT_POLICY.json']);

  const originalPolicy = JSON.parse(
    readFileSync(resolve(testRepository, 'AI_PROJECT_POLICY.json'), 'utf8'),
  );
  originalPolicy.repository.allowedBranch = 'main';
  await import('node:fs').then(({ writeFileSync }) =>
    writeFileSync(
      resolve(testRepository, 'AI_PROJECT_POLICY.json'),
      `${JSON.stringify(originalPolicy, null, 2)}\n`,
      'utf8',
    ),
  );
  expectBlocked(runGuard(testRepository), 'does not match');

  process.stdout.write('verify-kimi-workspace regression suite: PASS\n');
} finally {
  rmSync(testRepository, { recursive: true, force: true });
}
