import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireLiveActions = process.argv.includes('--require-live-actions');
const semanticOnly = process.argv.includes('--semantic-only');
const skipCandidateExecution = process.argv.includes('--skip-candidate-execution');
assert(!(requireLiveActions && semanticOnly), 'live provenance and semantic-only modes are mutually exclusive');
assert(!skipCandidateExecution || requireLiveActions, 'candidate execution may be skipped only in the credentialed live-provenance job');
const liveWorkflowEvidenceRecords = [];
const rel = p => path.join(root, p);
const exists = p => fs.existsSync(rel(p));
const text = p => fs.readFileSync(rel(p), 'utf8');
const json = p => JSON.parse(text(p));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeySet(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label}: object missing`);
  assert(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()), `${label}: key set differs`);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const trustedRuntimeDependencyBlobs = {
  'simulation/lib-v2/schema-validator.mjs': '5e2694e8c2c9eb3677fd132382b5f595706f0801'
};
for (const [file, blob] of Object.entries(trustedRuntimeDependencyBlobs)) {
  assert(git(['ls-tree', 'HEAD', '--', file]) === `100644 blob ${blob}\t${file}`, `credentialed verifier dependency differs from the exact trusted 100644 blob: ${file}`);
}
const { assertSchema } = await import('../../simulation/lib-v2/schema-validator.mjs');

function canonicalJsonForGovernance(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'canonical governance JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForGovernance).join(',')}]`;
  assert(typeof value === 'object', `canonical governance JSON rejects unsupported type: ${typeof value}`);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJsonForGovernance(value[key])}`).join(',')}}`;
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Canonical(value) {
  return sha256Text(canonicalJsonForGovernance(value));
}
assert(sha256Canonical([{ threshold: 0.8, region: { y: 0.05, x: 0.1, width: 0.5, height: 0.25 } }]) === 'ac3413db5f1c4b11ed1ada06cd86d2bba3e4bc6fc70b1487057555a0cd1c36c4', 'canonical governance digest decimal/order parity vector failed');

function isCanonicalIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isCanonicalIsoInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value ?? '')) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
}

function jsonAt(commit, file) {
  return JSON.parse(git(['show', `${commit}:${file}`]));
}

function textAt(commit, file) {
  return execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8' });
}

function bytesAt(commit, file) {
  return execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: null, maxBuffer: 20 * 1024 * 1024 });
}

function globMatch(pattern, file) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const source = '^' + escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$';
  return new RegExp(source).test(file);
}

function changedPaths(base, head) {
  const output = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], { cwd: root, encoding: 'utf8' });
  return output ? output.split('\0').filter(Boolean) : [];
}

function assertExactChangedPaths(base, head, expected, label) {
  const actual = changedPaths(base, head).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label}: changed paths differ; expected ${JSON.stringify(wanted)} got ${JSON.stringify(actual)}`);
}

function assertExactSingleParent(commit, expectedParent, label) {
  const lineage = git(['rev-list', '--parents', '-n', '1', commit]).split(' ');
  assert(lineage.length === 2 && lineage[0] === commit && lineage[1] === expectedParent, `${label}: opening must be one exact non-merge child of the reviewed parent`);
}

function firstAddCommit(file) {
  const output = git(['log', '--diff-filter=A', '--format=%H', '--', file]);
  const commits = output ? output.split('\n').filter(Boolean) : [];
  return commits.at(-1) ?? null;
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function assertRegularGitFile(file, label) {
  const stat = fs.lstatSync(rel(file));
  assert(stat.isFile() && !stat.isSymbolicLink(), `${label}: path is not a regular file: ${file}`);
  const entry = git(['ls-tree', 'HEAD', '--', file]).split(/\s+/);
  assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `${label}: Git mode/type is not a regular 100644 blob: ${file}`);
}

function assertAddedOnceAndUnchanged(file, addCommit) {
  assertRegularGitFile(file, 'numbered evidence');
  const firstBlob = git(['rev-parse', `${addCommit}:${file}`]);
  const currentBlob = git(['rev-parse', `HEAD:${file}`]);
  assert(firstBlob === currentBlob, `numbered evidence changed after first addition: ${file}`);
  assertNoPathChangesSince(addCommit, 'HEAD', [file], 'numbered evidence immutability');
  const priorObjects = git(['rev-list', '--objects', `${addCommit}^`]);
  assert(!priorObjects.split('\n').some(line => line.split(' ')[0] === firstBlob), `numbered evidence blob existed before its authoritative path: ${file}`);
  return currentBlob;
}

function assertBoundary(paths, control, label) {
  for (const file of paths) {
    assert(control.allowedWrites.some(pattern => globMatch(pattern, file)), `${label}: changed path outside allowlist: ${file}`);
    assert(!control.forbiddenWrites.some(pattern => globMatch(pattern, file)), `${label}: forbidden path changed: ${file}`);
  }
}

function assertBoundaryHistory(base, head, control, label) {
  const output = git(['rev-list', '--reverse', `${base}..${head}`]);
  const commits = output ? output.split('\n').filter(Boolean) : [];
  let expectedParent = base;
  for (const commit of commits) {
    const [resolvedCommit, ...parents] = git(['rev-list', '--parents', '-n', '1', commit]).split(' ');
    assert(resolvedCommit === commit, `${label}: failed to resolve commit ${commit}`);
    assert(parents.length === 1 && parents[0] === expectedParent, `${label}: merge, branch splice or non-linear commit detected at ${commit}`);
    assertBoundary(changedPaths(expectedParent, commit), control, `${label} commit ${commit}`);
    expectedParent = commit;
  }
  assert(expectedParent === head || (commits.length === 0 && base === head), `${label}: commit chain does not end at ${head}`);
}

function assertRegularBoundedHistory(base, head, control, label, perFileLimit = 10 * 1024 * 1024, perCommitLimit = 40 * 1024 * 1024, rangePathLimit = 500, rangeUniqueBlobLimit = 100 * 1024 * 1024, commitLimit = 256) {
  const output = git(['rev-list', '--reverse', `${base}..${head}`]);
  const commits = output ? output.split('\n').filter(Boolean) : [];
  assert(commits.length <= commitLimit, `${label}: governed range exceeds the reviewed commit-count cap`);
  let expectedParent = base;
  const seenPaths = new Set();
  const seenBlobOids = new Set();
  let rangeUniqueBlobBytes = 0;
  for (const commit of commits) {
    const [resolvedCommit, ...parents] = git(['rev-list', '--parents', '-n', '1', commit]).split(' ');
    assert(resolvedCommit === commit && parents.length === 1 && parents[0] === expectedParent, `${label}: merge, splice or non-linear commit detected at ${commit}`);
    const paths = changedPaths(expectedParent, commit);
    assertBoundary(paths, control, `${label} commit ${commit}`);
    let commitBytes = 0;
    for (const file of paths) {
      const entry = git(['ls-tree', commit, '--', file]).split(/\s+/);
      assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `${label}: allowed path was deleted or is not a regular 100644 blob at ${commit}: ${file}`);
      const bytes = Number(git(['cat-file', '-s', `${commit}:${file}`]));
      assert(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= perFileLimit, `${label}: governed file exceeds the per-file limit at ${commit}: ${file}`);
      seenPaths.add(file);
      if (!seenBlobOids.has(entry[2])) {
        seenBlobOids.add(entry[2]);
        rangeUniqueBlobBytes += bytes;
      }
      commitBytes += bytes;
    }
    assert(commitBytes <= perCommitLimit, `${label}: governed commit exceeds the aggregate size limit at ${commit}`);
    assert(seenPaths.size <= rangePathLimit, `${label}: governed range exceeds the reviewed unique-path cap`);
    assert(rangeUniqueBlobBytes <= rangeUniqueBlobLimit, `${label}: governed range exceeds the cumulative unique-blob byte cap`);
    expectedParent = commit;
  }
  assert(expectedParent === head || (commits.length === 0 && base === head), `${label}: commit chain does not end at ${head}`);
}

function assertS02HistoryWithIncrementalRenewals(base, head, control, label, evidenceRound) {
  assert(/^(001|002|003|004)$/.test(evidenceRound ?? ''), `${label}: invalid S02 renewal evidence round`);
  const output = execFileSync('git', ['rev-list', '--reverse', `${base}..${head}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const commits = output ? output.trim().split('\n').filter(Boolean) : [];
  const renewalPattern = new RegExp(`^quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-access-renewal-round-${evidenceRound}-\\d{3,}-(?:request|readback)\\.json$`);
  let expectedParent = base;
  let boundedCommitCount = 0;
  const boundedPaths = new Set();
  const boundedBlobOids = new Set();
  let boundedUniqueBlobBytes = 0;
  for (const commit of commits) {
    const [resolvedCommit, ...parents] = git(['rev-list', '--parents', '-n', '1', commit]).split(' ');
    assert(resolvedCommit === commit && parents.length === 1 && parents[0] === expectedParent, `${label}: merge, splice or non-linear commit detected at ${commit}`);
    const paths = changedPaths(expectedParent, commit);
    assertBoundary(paths, control, `${label} commit ${commit}`);
    const renewalOnly = paths.length === 1 && renewalPattern.test(paths[0]);
    let commitBytes = 0;
    for (const file of paths) {
      const entry = git(['ls-tree', commit, '--', file]).split(/\s+/);
      assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `${label}: allowed path was deleted or is not a regular 100644 blob at ${commit}: ${file}`);
      const bytes = Number(git(['cat-file', '-s', `${commit}:${file}`]));
      const perFileLimit = renewalOnly ? 2 * 1024 * 1024 : 10 * 1024 * 1024;
      assert(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= perFileLimit, `${label}: governed file exceeds its incremental limit at ${commit}: ${file}`);
      commitBytes += bytes;
      if (!renewalOnly) {
        boundedPaths.add(file);
        if (!boundedBlobOids.has(entry[2])) {
          boundedBlobOids.add(entry[2]);
          boundedUniqueBlobBytes += bytes;
        }
      }
    }
    assert(commitBytes <= (renewalOnly ? 2 * 1024 * 1024 : 40 * 1024 * 1024), `${label}: governed commit exceeds its aggregate size cap at ${commit}`);
    if (!renewalOnly) boundedCommitCount += 1;
    expectedParent = commit;
  }
  assert(expectedParent === head || (commits.length === 0 && base === head), `${label}: commit chain does not end at ${head}`);
  assert(boundedCommitCount <= 256 && boundedPaths.size <= 500 && boundedUniqueBlobBytes <= 100 * 1024 * 1024, `${label}: fixed non-renewal history exceeds its reviewed bounded budget`);
}

function assertNoPathChangesSince(base, head, paths, label) {
  for (const file of paths) {
    const output = git(['log', '--format=%H', `${base}..${head}`, '--', file]);
    assert(output === '', `${label}: frozen path changed after baseline: ${file}`);
  }
}

function runNodeVerifier(file, label) {
  assert(exists(file), `${label}: verifier missing: ${file}`);
  if (skipCandidateExecution) return;
  try {
    execFileSync(process.execPath, [rel(file)], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        PATH: process.env.PATH,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        TZ: 'UTC',
        NODE_NO_WARNINGS: '1'
      }
    });
  } catch (error) {
    const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label}: verifier failed: ${file}${detail ? `\n${detail}` : ''}`);
  }
}

function authoritySnapshotLine(authorityValue, statusValue) {
  return `CURRENT_AUTHORITY_SNAPSHOT: ${authorityValue.activeChangeControl} | STEP ${statusValue.currentRepositoryStep} | ${statusValue.currentInternalPhase} | ${statusValue.currentVerdict}`;
}

function assertSingleAuthoritySnapshot(content, expected, label) {
  const matches = content.match(/^CURRENT_AUTHORITY_SNAPSHOT: .*$/gm) ?? [];
  assert(matches.length === 1 && matches[0] === expected, `${label}: current-authority snapshot is missing, duplicated or stale`);
  return content.replace(/^CURRENT_AUTHORITY_SNAPSHOT: .*$/m, 'CURRENT_AUTHORITY_SNAPSHOT: <NORMALIZED>');
}

function assertSchemaRejects(instance, schema, label) {
  let rejected = false;
  try {
    assertSchema(instance, schema);
  } catch {
    rejected = true;
  }
  assert(rejected, `${label}: trusted schema validator accepted an invalid mutation`);
}

function assertCriticalFindingCounts(report, label) {
  assert(Array.isArray(report.findings), `${label}: findings array missing`);
  const unresolvedP0 = report.findings.filter(entry => entry.severity === 'P0' && entry.resolved !== true).length;
  const unresolvedP1 = report.findings.filter(entry => entry.severity === 'P1' && entry.resolved !== true).length;
  assert(report.unresolved?.P0 === unresolvedP0 && report.unresolved?.P1 === unresolvedP1, `${label}: unresolved counts do not derive from the finding rows`);
  assert(unresolvedP0 === 0 && unresolvedP1 === 0, `${label}: unresolved P0/P1 finding remains`);
}

// Frozen from GitHub's official Actions OIDC JWKS before the repair target was committed.
// The durable JWT lets later commits prove the exact workflow/run after Actions logs and ZIPs expire.
const trustedActionsOidcKeys = {
  'cc413527-173f-5a05-976e-9c52b1d7b431': {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: 'cc413527-173f-5a05-976e-9c52b1d7b431',
    n: 'w4M936N3ZxNaEblcUoBm-xu0-V9JxNx5S7TmF0M3SBK-2bmDyAeDdeIOTcIVZHG-ZX9N9W0u1yWafgWewHrsz66BkxXq3bscvQUTAw7W3s6TEeYY7o9shPkFfOiU3x_KYgOo06SpiFdymwJflRs9cnbaU88i5fZJmUepUHVllP2tpPWTi-7UA3AdP3cdcCs5bnFfTRKzH2W0xqKsY_jIG95aQJRBDpbiesefjuyxcQnOv88j9tCKWzHpJzRKYjAUM6OPgN4HYnaSWrPJj1v41eEkFM1kORuj-GSH2qMVD02VklcqaerhQHIqM-RjeHsN7G05YtwYzomE5G-fZuwgvQ',
    e: 'AQAB'
  },
  '38826b17-6a30-5f9b-b169-8beb8202f723': {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: '38826b17-6a30-5f9b-b169-8beb8202f723',
    n: '5Manmy-zwsk3wEftXNdKFZec4rSWENW4jTGevlvAcU9z3bgLBogQVvqYLtu9baVm2B3rfe5onadobq8po5UakJ0YsTiiEfXWdST7YI2Sdkvv-hOYMcZKYZ4dFvuSO1vQ2DgEkw_OZNiYI1S518MWEcNxnPU5u67zkawAGsLlmXNbOylgVfBRJrG8gj6scr-sBs4LaCa3kg5IuaCHe1pB-nSYHovGV_z0egE83C098FfwO1dNZBWeo4Obhb5Z-ZYFLJcZfngMY0zJnCVNmpHQWOgxfGikh3cwi4MYrFrbB4NTlxbrQ3bL-rGKR5X318veyDlo8Dyz2KWMobT4wB9U1Q',
    e: 'AQAB'
  },
  '38E9B30B3A023A1B72309921A69A42FCC496C42C': {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: '38E9B30B3A023A1B72309921A69A42FCC496C42C',
    n: 'tEq2Fp9HcdT5MwMsB_UTm8j_woJJLi3sA-y0RX2tioTm581seyfvOH6lJ5JmHVtS-_fb8B2tRT1pznHQSNq14PsJdu9bp5egbWmIz-5RvhqoM-oKem_MJENCNFuqXijRLT47FRdfH3inqde1vJlA_JJHCqYMKIpHH7kqNFYcCpwr0vk80Hc2rTyL0uBXI7NqBZbtUgNoyucWO5O7QQrPNOmlr-GI8aFckFRfobCaCOiH9qW02FtkV74fwBGVCNhNf3a1CK81-O8xEGimvVydI_pQA5B8QqVuQjY_ntOu555HdirA0hKkY6fsE9eZCMFmWDHZ2kSWLjhabxWxIzSzXQ',
    e: 'AQAB'
  },
  '4F3E9AD8C9A6F5EB3173006F4FA630E28F43DCE9': {
    kty: 'RSA',
    alg: 'RS256',
    use: 'sig',
    kid: '4F3E9AD8C9A6F5EB3173006F4FA630E28F43DCE9',
    n: 'tGevqhkBGn8NB0dKxs8Ddxhn-xZPm55svcSlkJZEOwDOXDLl_0-iVOVKNJfcHHLHvMqa6zh2DDcpAWZi2FpeBAJupsrymqwzllxOODWKWoVIoaIjOO7h1JLiF9Knwuq-o6BPtKdwOT-bOrXRzChMtQsc5C1Auex-D0Z6loObBuK1Lkm0RK9ISQsLqBEwq8g0OOupI_shU1r2rT2G0nkZ0CvxVlQeUGShFi8Mdys2s5LPqBwjC4LKwjk8moWQV32KEccbTPKxnG_539DxRglHJgHPHisSVGsfZIUXi2chtXdQHZPdVve8ZRmknCykZtkJ6K87llSUXi7oyzhCIZdiUQ',
    e: 'AQAB'
  }
};
function verifyDurableActionsOidc(evidence, label, expectedWorkflow = {
  name: "Verify Cat's Tower current authority",
  ref: '2hg7trp7rv-design/cats_tower/.github/workflows/verify-current-governance.yml@refs/heads/kimi',
  audience: 'cats-tower-current-governance'
}) {
  if (!Object.hasOwn(evidence, 'oidcToken')) {
    assert(/^sha256:[a-f0-9]{64}$/.test(evidence.oidcTokenSha256 ?? '') && evidence.oidcVerified === true, `${label}: hardened OIDC digest or verified verdict is invalid`);
    assertExactKeySet(evidence.oidcClaims, ['issuer', 'audience', 'subject', 'repository', 'repositoryId', 'repositoryOwnerId', 'ref', 'sha', 'runId', 'runAttempt', 'workflowRef'], `${label} hardened OIDC claims`);
    const expectedClaims = {
      issuer: 'https://token.actions.githubusercontent.com',
      audience: expectedWorkflow.audience,
      subject: 'repo:2hg7trp7rv-design@245031448/cats_tower@1331488679:ref:refs/heads/kimi',
      repository: '2hg7trp7rv-design/cats_tower',
      repositoryId: '1331488679',
      repositoryOwnerId: '245031448',
      ref: 'refs/heads/kimi',
      sha: evidence.commit,
      runId: String(evidence.runId),
      runAttempt: String(evidence.runAttempt),
      workflowRef: expectedWorkflow.ref
    };
    assert(JSON.stringify(evidence.oidcClaims) === JSON.stringify(expectedClaims), `${label}: hardened OIDC claims differ from exact workflow target`);
    return evidence.oidcClaims;
  }
  assert(typeof evidence.oidcToken === 'string' && evidence.oidcToken.length > 500 && evidence.oidcToken.length < 10000, `${label}: durable Actions OIDC token missing or invalid`);
  const parts = evidence.oidcToken.split('.');
  assert(parts.length === 3, `${label}: Actions OIDC token is not a compact JWT`);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert(header.alg === 'RS256' && header.typ === 'JWT' && typeof header.kid === 'string', `${label}: Actions OIDC JWT header mismatch`);
  const jwk = trustedActionsOidcKeys[header.kid];
  assert(jwk, `${label}: Actions OIDC signing key is not in the frozen official trust set`);
  const signatureValid = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url')
  );
  assert(signatureValid, `${label}: Actions OIDC JWT signature is invalid`);
  assert(claims.iss === 'https://token.actions.githubusercontent.com' && claims.aud === expectedWorkflow.audience, `${label}: Actions OIDC issuer or audience mismatch`);
  assert(claims.repository === '2hg7trp7rv-design/cats_tower' && claims.repository_id === '1331488679' && claims.repository_owner_id === '245031448', `${label}: Actions OIDC repository name or immutable ID mismatch`);
  assert(claims.ref === 'refs/heads/kimi' && claims.ref_type === 'branch', `${label}: Actions OIDC ref mismatch`);
  assert(claims.sha === evidence.commit && claims.workflow_sha === evidence.commit, `${label}: Actions OIDC source/workflow SHA mismatch`);
  assert(claims.workflow === expectedWorkflow.name && claims.workflow_ref === expectedWorkflow.ref, `${label}: Actions OIDC workflow identity mismatch`);
  assert(String(claims.run_id) === String(evidence.runId) && String(claims.run_attempt) === String(evidence.runAttempt), `${label}: Actions OIDC run/attempt mismatch`);
  assert(['push', 'workflow_dispatch'].includes(claims.event_name) && claims.runner_environment === 'github-hosted', `${label}: Actions OIDC event or runner mismatch`);
  assert(Number.isInteger(claims.iat) && Number.isInteger(claims.nbf) && Number.isInteger(claims.exp) && claims.nbf <= claims.iat && claims.exp > claims.iat && claims.exp - claims.iat <= 900, `${label}: Actions OIDC issued/expiry window mismatch`);
  assert(typeof claims.jti === 'string' && claims.jti.length >= 16, `${label}: Actions OIDC unique token identifier missing`);
  return claims;
}

function assertWorkflowEvidenceKeys(evidence, label, requireHardened = false) {
  const baseKeys = ['commit', 'tree', 'runId', 'runAttempt', 'jobId', 'conclusion', 'artifactId', 'artifactName', 'artifactDigest'];
  const hardened = !Object.hasOwn(evidence ?? {}, 'oidcToken');
  assert(!requireHardened || hardened, `${label}: new evidence must not persist a bearer OIDC token`);
  assertExactKeySet(evidence, [...baseKeys, ...(hardened ? ['oidcTokenSha256', 'oidcClaims', 'oidcVerified'] : ['oidcToken'])], label);
}

function registerWorkflowEvidence(evidence, label) {
  assertWorkflowEvidenceKeys(evidence, `${label} workflow evidence`);
  for (const key of ['runId', 'runAttempt', 'jobId', 'artifactId']) {
    assert(Number.isSafeInteger(evidence[key]) && evidence[key] > 0, `${label}: workflow ${key} must be a positive safe integer`);
  }
  assert(/^[a-f0-9]{40}$/.test(evidence.commit ?? '') && /^[a-f0-9]{40}$/.test(evidence.tree ?? ''), `${label}: workflow commit/tree binding is invalid`);
  assert(evidence.tree === git(['rev-parse', `${evidence.commit}^{tree}`]), `${label}: workflow tree does not match the bound commit`);
  assert(evidence.conclusion === 'SUCCESS', `${label}: workflow conclusion is not SUCCESS`);
  assert(evidence.artifactName === `phase0-current-governance-${evidence.commit}-${evidence.runId}-${evidence.runAttempt}`, `${label}: workflow artifact name does not bind the target commit/run/attempt`);
  assert(/^sha256:[a-f0-9]{64}$/.test(evidence.artifactDigest ?? ''), `${label}: workflow artifact digest is invalid`);
  verifyDurableActionsOidc(evidence, label);
  const key = JSON.stringify(evidence);
  liveWorkflowEvidenceRecords.push({ key, evidence, label });
}

function ghApi(endpoint, { binary = false, maxBuffer = 10 * 1024 * 1024 } = {}) {
  assert(process.env.GITHUB_ACTIONS === 'true', 'live Actions proof may only run inside GitHub Actions');
  assert(process.env.GH_TOKEN, 'GH_TOKEN is missing for live Actions proof');
  assert(Number.isSafeInteger(maxBuffer) && maxBuffer > 0 && maxBuffer <= 128 * 1024 * 1024, 'GitHub API response buffer is outside the reviewed bound');
  return execFileSync('gh', [
    'api', '--method', 'GET',
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    endpoint
  ], { cwd: root, encoding: binary ? null : 'utf8', maxBuffer });
}

function ghJson(endpoint) {
  return JSON.parse(ghApi(endpoint));
}

function verifyLiveWorkflowEvidence(evidence, label, requireArtifactArchive) {
  const currentHead = git(['rev-parse', 'HEAD']);
  assert(evidence.commit !== currentHead && isAncestor(evidence.commit, currentHead), `${label}: bound workflow target must be a prior ancestor of the current evidence commit`);
  const base = '/repos/2hg7trp7rv-design/cats_tower/actions';
  const run = ghJson(`${base}/runs/${evidence.runId}/attempts/${evidence.runAttempt}`);
  assert(run.id === evidence.runId && run.run_attempt === evidence.runAttempt, `${label}: workflow run/attempt mismatch`);
  assert(run.repository?.full_name === '2hg7trp7rv-design/cats_tower' && run.repository?.id === 1331488679 && run.repository?.owner?.id === 245031448, `${label}: workflow repository name or immutable ID mismatch`);
  assert(run.head_repository?.full_name === '2hg7trp7rv-design/cats_tower' && run.head_repository?.id === 1331488679 && run.head_repository?.owner?.id === 245031448, `${label}: workflow head repository name or immutable ID mismatch`);
  assert(run.head_sha === evidence.commit && run.head_branch === 'kimi', `${label}: workflow head commit/branch mismatch`);
  assert(['push', 'workflow_dispatch'].includes(run.event) && run.status === 'completed' && run.conclusion === 'success', `${label}: workflow event or conclusion mismatch`);
  assert((run.path ?? '').split('@')[0] === '.github/workflows/verify-current-governance.yml', `${label}: unexpected workflow path`);

  const jobs = ghJson(`${base}/runs/${evidence.runId}/attempts/${evidence.runAttempt}/jobs?per_page=100`);
  assert(jobs.total_count === 2 && jobs.jobs?.length === 2, `${label}: workflow attempt must contain exactly the semantic and provenance jobs`);
  const listedSemanticJob = jobs.jobs.find(entry => entry.name === 'semantic-verification-no-credentials');
  const listedProvenanceJob = jobs.jobs.find(entry => entry.name === 'current-authority');
  assert(listedSemanticJob?.status === 'completed' && listedSemanticJob?.conclusion === 'success', `${label}: uncredentialed semantic job did not succeed`);
  assert(listedProvenanceJob?.id === evidence.jobId, `${label}: evidence job ID does not bind the provenance job`);
  const job = ghJson(`${base}/jobs/${evidence.jobId}`);
  assert(job.run_id === evidence.runId && job.run_attempt === evidence.runAttempt && job.head_sha === evidence.commit && job.head_branch === 'kimi', `${label}: workflow job target/attempt mismatch`);
  assert(job.name === 'current-authority' && job.status === 'completed' && job.conclusion === 'success', `${label}: governance job did not succeed`);
  const requiredStepNames = [
    'Confirm exact source commit',
    'Verify current authority, mirrors, source replacement and deletion boundary',
    'Parse current JSON documents',
    'Reject non-Markdown whitespace defects in governed Phase 0 changes',
    'Write machine-readable governance evidence',
    'Upload governance evidence artifact'
  ];
  const requiredStepIndexes = [];
  for (const stepName of requiredStepNames) {
    const matches = job.steps?.filter(step => step.name === stepName) ?? [];
    assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success', `${label}: required successful job step missing: ${stepName}`);
    requiredStepIndexes.push(job.steps.indexOf(matches[0]));
  }
  assert(requiredStepIndexes.every((index, offset) => offset === 0 || index > requiredStepIndexes[offset - 1]), `${label}: governed workflow steps ran out of the reviewed order`);
  assert((job.steps ?? []).every(step => !['failure', 'cancelled', 'timed_out', 'action_required'].includes(step.conclusion)), `${label}: workflow contains a failed or cancelled step`);
  const semanticJob = ghJson(`${base}/jobs/${listedSemanticJob.id}`);
  assert(semanticJob.run_id === evidence.runId && semanticJob.run_attempt === evidence.runAttempt && semanticJob.head_sha === evidence.commit && semanticJob.head_branch === 'kimi', `${label}: semantic job target/attempt mismatch`);
  assert(semanticJob.name === 'semantic-verification-no-credentials' && semanticJob.status === 'completed' && semanticJob.conclusion === 'success', `${label}: semantic job did not complete successfully`);
  const semanticStepNames = [
    'Confirm exact source commit without credentials',
    'Verify current authority semantics without live credentials',
    'Validate the immutable Step 2 seal at current HEAD',
    'Validate the versioned Step 2 v3 correction when present',
    'Re-run the source-bound Step 2 verifier in an intact historical worktree'
  ];
  const semanticStepIndexes = semanticStepNames.map(stepName => {
    const matches = semanticJob.steps?.filter(step => step.name === stepName) ?? [];
    assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success', `${label}: required uncredentialed semantic step missing: ${stepName}`);
    return semanticJob.steps.indexOf(matches[0]);
  });
  assert(semanticStepIndexes.every((index, offset) => offset === 0 || index > semanticStepIndexes[offset - 1]), `${label}: uncredentialed semantic workflow steps ran out of order`);
  assert((semanticJob.steps ?? []).every(step => !['failure', 'cancelled', 'timed_out', 'action_required'].includes(step.conclusion)), `${label}: semantic workflow contains a failed or cancelled step`);
  if (!requireArtifactArchive) return;

  const artifact = ghJson(`${base}/artifacts/${evidence.artifactId}`);
  assert(artifact.id === evidence.artifactId && artifact.name === evidence.artifactName && artifact.digest === evidence.artifactDigest && artifact.expired === false, `${label}: artifact identity, digest or expiry mismatch`);
  assert(artifact.workflow_run?.id === evidence.runId && artifact.workflow_run?.head_sha === evidence.commit && artifact.workflow_run?.head_branch === 'kimi', `${label}: artifact workflow binding mismatch`);
  assert(artifact.workflow_run?.repository_id === run.repository?.id && artifact.workflow_run?.head_repository_id === run.head_repository?.id, `${label}: artifact repository IDs differ from the run`);
  assert(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 1024 * 1024, `${label}: artifact size is invalid`);
  const uploadStep = job.steps.find(step => step.name === 'Upload governance evidence artifact');
  assert(uploadStep && Date.parse(artifact.created_at) >= Date.parse(uploadStep.started_at) && Date.parse(artifact.created_at) <= Date.parse(uploadStep.completed_at), `${label}: artifact timestamp is outside the exact upload-step interval`);

  const zip = ghApi(`${base}/artifacts/${evidence.artifactId}/zip`, {
    binary: true,
    maxBuffer: artifact.size_in_bytes + 1024 * 1024
  });
  assert(`sha256:${createHash('sha256').update(zip).digest('hex')}` === evidence.artifactDigest, `${label}: downloaded artifact archive digest mismatch`);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cats-tower-actions-artifact-'));
  const zipPath = path.join(tempDirectory, 'artifact.zip');
  try {
    fs.writeFileSync(zipPath, zip);
    const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n').filter(Boolean);
    assert(JSON.stringify(entries) === JSON.stringify(['current-governance-result.json']), `${label}: artifact archive contains unexpected entries`);
    const artifactResult = JSON.parse(execFileSync('unzip', ['-p', zipPath, 'current-governance-result.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
    const targetAuthority = jsonAt(evidence.commit, 'CURRENT_AUTHORITY_INDEX.json');
    const targetSeal = jsonAt(evidence.commit, targetAuthority.executableContract.seal);
    // The direct bootstrap cannot authorize itself. Its dedicated immutable-OIDC
    // correction child is independently read back here and emitted PASS by the
    // reviewed workflow, so keep the two historical cases distinct.
    const directBootstrapRequiresReadback = isExactRepairBootstrapCommit(evidence.commit)
      && git(['rev-parse', `${evidence.commit}^`]) === trustedRound031RepairBase.commit;
    const expectedArtifactVerdict = directBootstrapRequiresReadback
      ? 'PENDING_LIVE_PROVENANCE_READBACK'
      : 'PASS_CURRENT_AUTHORITY_GOVERNANCE';
    const expectedArtifactResult = {
      schemaVersion: 1,
      artifactId: 'cats-tower-current-governance-result',
      repository: '2hg7trp7rv-design/cats_tower',
      branch: 'kimi',
      commit: evidence.commit,
      tree: evidence.tree,
      runId: evidence.runId,
      runAttempt: evidence.runAttempt,
      ...(Object.hasOwn(evidence, 'oidcToken')
        ? { oidcToken: evidence.oidcToken }
        : { oidcTokenSha256: evidence.oidcTokenSha256, oidcClaims: evidence.oidcClaims, oidcVerified: true }),
      activeChangeControl: targetAuthority.activeChangeControl,
      verdict: expectedArtifactVerdict,
      step1: 'PASS_CANONICAL',
      step2: targetAuthority.executableContract.step2Status,
      step2ActiveSeal: targetAuthority.executableContract.seal,
      step2BindingCount: targetSeal.bindings.length,
      historicalStep2V2BindingCount: 16,
      step2SourceBoundHistoricalWorktree: 'PASS_CONTRACT_SOURCE_REPRODUCTION',
      step3: 'PASS_MODEL',
      step4: 'IN_PROGRESS',
      step5Allowed: false,
      physicalIPhoneVerified: false,
      productionAliasChanged: false
    };
    assert(JSON.stringify(artifactResult) === JSON.stringify(expectedArtifactResult), `${label}: artifact payload differs from the exact target authority`);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngPaeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function assertDecodedPng(bytes, expectedWidth, expectedHeight, label) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert(bytes.length >= 20 * 1024 && bytes.length <= 8 * 1024 * 1024 && bytes.subarray(0, 8).equals(signature), `${label}: PNG signature or size is invalid`);
  let offset = 8;
  let seenIhdr = false;
  let seenIdat = false;
  let endedIdat = false;
  let seenIend = false;
  let bitDepth;
  let colorType;
  const idatChunks = [];
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length, `${label}: PNG chunk header is truncated`);
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert(length <= 8 * 1024 * 1024 && dataEnd + 4 <= bytes.length, `${label}: PNG chunk length is invalid`);
    const data = bytes.subarray(dataStart, dataEnd);
    const recordedCrc = bytes.readUInt32BE(dataEnd);
    assert(pngCrc32(Buffer.concat([typeBytes, data])) === recordedCrc, `${label}: PNG chunk CRC failed: ${type}`);
    if (!seenIhdr) {
      assert(type === 'IHDR' && length === 13, `${label}: PNG IHDR is not the first exact chunk`);
      seenIhdr = true;
      assert(data.readUInt32BE(0) === expectedWidth && data.readUInt32BE(4) === expectedHeight, `${label}: PNG dimensions mismatch`);
      bitDepth = data[8];
      colorType = data[9];
      assert(bitDepth === 8 && [0, 2, 4, 6].includes(colorType), `${label}: PNG pixel format is outside the reviewed 8-bit formats`);
      assert(data[10] === 0 && data[11] === 0 && data[12] === 0, `${label}: PNG compression, filter or interlace method is unsupported`);
    } else if (type === 'IHDR') {
      assert(false, `${label}: PNG contains a duplicate IHDR`);
    } else if (type === 'IDAT') {
      assert(!endedIdat && !seenIend, `${label}: PNG IDAT chunks are not contiguous`);
      seenIdat = true;
      idatChunks.push(data);
    } else if (type === 'IEND') {
      assert(seenIdat && !seenIend && length === 0, `${label}: PNG IEND is invalid`);
      seenIend = true;
    } else {
      if (seenIdat) endedIdat = true;
      assert((typeBytes[0] & 0x20) !== 0 || type === 'PLTE', `${label}: PNG contains an unknown critical chunk: ${type}`);
    }
    offset = dataEnd + 4;
    if (seenIend) break;
  }
  assert(seenIhdr && seenIdat && seenIend && offset === bytes.length, `${label}: PNG is missing required chunks or has trailing bytes`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const scanlineBytes = expectedWidth * channels;
  const expectedInflatedBytes = expectedHeight * (scanlineBytes + 1);
  const filtered = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedInflatedBytes });
  assert(filtered.length === expectedInflatedBytes, `${label}: PNG decompressed pixel length mismatch`);
  const raw = Buffer.allocUnsafe(expectedWidth * expectedHeight * channels);
  for (let row = 0; row < expectedHeight; row += 1) {
    const sourceOffset = row * (scanlineBytes + 1);
    const filter = filtered[sourceOffset];
    assert(filter <= 4, `${label}: PNG scanline filter is invalid at row ${row}`);
    const targetOffset = row * scanlineBytes;
    for (let column = 0; column < scanlineBytes; column += 1) {
      const encoded = filtered[sourceOffset + 1 + column];
      const left = column >= channels ? raw[targetOffset + column - channels] : 0;
      const up = row > 0 ? raw[targetOffset - scanlineBytes + column] : 0;
      const upperLeft = row > 0 && column >= channels ? raw[targetOffset - scanlineBytes + column - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : pngPaeth(left, up, upperLeft);
      raw[targetOffset + column] = (encoded + predictor) & 0xff;
    }
  }
  const rgba = Buffer.allocUnsafe(expectedWidth * expectedHeight * 4);
  for (let pixel = 0; pixel < expectedWidth * expectedHeight; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (colorType === 0) {
      rgba[target] = raw[source]; rgba[target + 1] = raw[source]; rgba[target + 2] = raw[source]; rgba[target + 3] = 255;
    } else if (colorType === 2) {
      rgba[target] = raw[source]; rgba[target + 1] = raw[source + 1]; rgba[target + 2] = raw[source + 2]; rgba[target + 3] = 255;
    } else if (colorType === 4) {
      rgba[target] = raw[source]; rgba[target + 1] = raw[source]; rgba[target + 2] = raw[source]; rgba[target + 3] = raw[source + 1];
    } else {
      rgba[target] = raw[source]; rgba[target + 1] = raw[source + 1]; rgba[target + 2] = raw[source + 2]; rgba[target + 3] = raw[source + 3];
    }
  }
  const pixelCount = expectedWidth * expectedHeight;
  let nonTransparent = 0;
  let nearOpaque = 0;
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let edgeCount = 0;
  let edgeSamples = 0;
  const buckets = new Map();
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 4;
    const red = rgba[index]; const green = rgba[index + 1]; const blue = rgba[index + 2]; const alpha = rgba[index + 3];
    if (alpha > 0) nonTransparent += 1;
    if (alpha >= 250) nearOpaque += 1;
    const luma = (54 * red + 183 * green + 19 * blue) / 256;
    lumaSum += luma;
    lumaSquaredSum += luma * luma;
    const bucket = `${red >> 4}:${green >> 4}:${blue >> 4}`;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    if (pixel % expectedWidth + 1 < expectedWidth) {
      const adjacent = index + 4;
      const adjacentLuma = (54 * rgba[adjacent] + 183 * rgba[adjacent + 1] + 19 * rgba[adjacent + 2]) / 256;
      if (Math.abs(luma - adjacentLuma) >= 12) edgeCount += 1;
      edgeSamples += 1;
    }
  }
  const lumaMean = lumaSum / pixelCount;
  const stats = {
    nonTransparentRatio: nonTransparent / pixelCount,
    nearOpaqueRatio: nearOpaque / pixelCount,
    quantizedColorCount: buckets.size,
    dominantColorRatio: Math.max(...buckets.values()) / pixelCount,
    lumaStdDev: Math.sqrt(Math.max(0, lumaSquaredSum / pixelCount - lumaMean * lumaMean)),
    horizontalEdgeRatio: edgeSamples === 0 ? 0 : edgeCount / edgeSamples
  };
  return { width: expectedWidth, height: expectedHeight, colorType, rgba, stats };
}

function isProductionScreenshotPng(decoded) {
  return decoded.stats.nonTransparentRatio >= 0.995 && decoded.stats.nearOpaqueRatio >= 0.99
    && decoded.stats.quantizedColorCount >= 256 && decoded.stats.dominantColorRatio <= 0.72
    && decoded.stats.lumaStdDev >= 18 && decoded.stats.horizontalEdgeRatio >= 0.01;
}

function assertProductionScreenshotPng(decoded, label) {
  assert(decoded.stats.nonTransparentRatio >= 0.995 && decoded.stats.nearOpaqueRatio >= 0.99, `${label}: screenshot transparency exceeds the production evidence bound`);
  assert(isProductionScreenshotPng(decoded), `${label}: screenshot is flat, uniform or implausibly low-detail`);
}

function isRepresentativeTransparentAssetPng(decoded) {
  return [4, 6].includes(decoded.colorType);
}

const transparentSpriteStripPolicyVector = { colorType: 6, stats: { nonTransparentRatio: 0.5, nearOpaqueRatio: 0.45, quantizedColorCount: 64, dominantColorRatio: 0.2, lumaStdDev: 12, horizontalEdgeRatio: 0.02 } };
const opaqueScreenshotPolicyVector = { colorType: 6, stats: { nonTransparentRatio: 1, nearOpaqueRatio: 1, quantizedColorCount: 256, dominantColorRatio: 0.2, lumaStdDev: 20, horizontalEdgeRatio: 0.02 } };
assert(isRepresentativeTransparentAssetPng(transparentSpriteStripPolicyVector) && !isProductionScreenshotPng(transparentSpriteStripPolicyVector), 'transparent sprite-strip policy vector does not remain distinct from opaque screenshot policy');
assert(isProductionScreenshotPng(opaqueScreenshotPolicyVector), 'opaque screenshot policy vector is invalid');

const s02RepresentativeVisibleAlphaThreshold = 32;
const isRepresentativeVisibleAlpha = alpha => Number.isInteger(alpha) && alpha >= s02RepresentativeVisibleAlphaThreshold;
assert(!isRepresentativeVisibleAlpha(0) && !isRepresentativeVisibleAlpha(1) && !isRepresentativeVisibleAlpha(31) && isRepresentativeVisibleAlpha(32), 'representative asset alpha-threshold adversarial vectors failed');

function analyzeRepresentativeFrames(decoded, frameWidth, frameHeight, frameCount, label) {
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const rgba = Buffer.allocUnsafe(frameWidth * frameHeight * 4);
    let alphaPixels = 0; let coreAlphaPixels = 0;
    let minX = frameWidth; let minY = frameHeight; let maxX = -1; let maxY = -1;
    let red = 0; let green = 0; let blue = 0; let luma = 0; let lumaSquared = 0;
    const colourBuckets = new Set();
    const alphaMask = new Uint8Array(frameWidth * frameHeight);
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const source = (y * decoded.width + frameIndex * frameWidth + x) * 4;
        const target = (y * frameWidth + x) * 4;
        const alpha = decoded.rgba[source + 3];
        if (isRepresentativeVisibleAlpha(alpha)) {
          const premultipliedRed = Math.round(decoded.rgba[source] * alpha / 255);
          const premultipliedGreen = Math.round(decoded.rgba[source + 1] * alpha / 255);
          const premultipliedBlue = Math.round(decoded.rgba[source + 2] * alpha / 255);
          rgba[target] = premultipliedRed; rgba[target + 1] = premultipliedGreen; rgba[target + 2] = premultipliedBlue; rgba[target + 3] = alpha;
          const maskIndex = y * frameWidth + x;
          alphaMask[maskIndex] = 1;
          alphaPixels += 1;
          if (alpha >= 192) coreAlphaPixels += 1;
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          red += premultipliedRed; green += premultipliedGreen; blue += premultipliedBlue;
          const pixelLuma = (54 * premultipliedRed + 183 * premultipliedGreen + 19 * premultipliedBlue) / 256;
          luma += pixelLuma; lumaSquared += pixelLuma * pixelLuma;
          colourBuckets.add(`${premultipliedRed >> 4}:${premultipliedGreen >> 4}:${premultipliedBlue >> 4}`);
        } else rgba.fill(0, target, target + 4);
      }
    }
    assert(alphaPixels > 0, `${label}: frame ${frameIndex} has no visible pixels`);
    const visited = new Uint8Array(alphaMask.length);
    const queue = new Int32Array(alphaMask.length);
    let largestComponent = 0;
    for (let start = 0; start < alphaMask.length; start += 1) {
      if (!alphaMask[start] || visited[start]) continue;
      let head = 0; let tail = 0; let component = 0;
      queue[tail++] = start; visited[start] = 1;
      while (head < tail) {
        const current = queue[head++]; component += 1;
        const x = current % frameWidth; const y = Math.floor(current / frameWidth);
        const neighbours = [x > 0 ? current - 1 : -1, x + 1 < frameWidth ? current + 1 : -1, y > 0 ? current - frameWidth : -1, y + 1 < frameHeight ? current + frameWidth : -1];
        for (const neighbour of neighbours) if (neighbour >= 0 && alphaMask[neighbour] && !visited[neighbour]) { visited[neighbour] = 1; queue[tail++] = neighbour; }
      }
      largestComponent = Math.max(largestComponent, component);
    }
    frames.push({
      index: frameIndex,
      sha256: `sha256:${createHash('sha256').update(rgba).digest('hex')}`,
      visibleBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      nonTransparentRatio: alphaPixels / (frameWidth * frameHeight),
      coreAlphaRatio: coreAlphaPixels / (frameWidth * frameHeight),
      coreAlphaFractionOfVisible: coreAlphaPixels / alphaPixels,
      largestAlphaComponentRatio: largestComponent / alphaPixels,
      visibleQuantizedColorCount: colourBuckets.size,
      visibleLumaStdDev: Math.sqrt(Math.max(0, lumaSquared / alphaPixels - (luma / alphaPixels) ** 2)),
      meanRgb: [red / alphaPixels, green / alphaPixels, blue / alphaPixels],
      rgba
    });
  }
  const consecutiveFrameDeltas = [];
  for (let index = 1; index < frames.length; index += 1) {
    const left = { width: frameWidth, height: frameHeight, rgba: frames[index - 1].rgba };
    const right = { width: frameWidth, height: frameHeight, rgba: frames[index].rgba };
    consecutiveFrameDeltas.push({ from: index - 1, to: index, ...compareDecodedPng(left, right) });
  }
  return { frames, consecutiveFrameDeltas };
}

function publicRepresentativeFrameAnalysis(analysis) {
  return {
    frames: analysis.frames.map(({ rgba: ignored, ...frame }) => frame),
    consecutiveFrameDeltas: analysis.consecutiveFrameDeltas
  };
}

function representativeIdentityMeasurement(id, members) {
  const frameHeights = members.flatMap(member => member.analysis.frames.map(frame => frame.visibleBounds.height / member.frameHeight));
  const colours = members.map(member => {
    const channels = [0, 1, 2].map(channel => member.analysis.frames.reduce((sum, frame) => sum + frame.meanRgb[channel], 0) / member.analysis.frames.length);
    return channels;
  });
  let maximumColourDistance = 0;
  for (let left = 0; left < colours.length; left += 1) for (let right = left + 1; right < colours.length; right += 1) {
    maximumColourDistance = Math.max(maximumColourDistance, Math.hypot(...colours[left].map((value, channel) => value - colours[right][channel])));
  }
  return {
    id,
    members: members.map(member => member.id),
    normalizedVisibleHeightRatio: Math.max(...frameHeights) / Math.min(...frameHeights),
    maximumMeanColourDistance: maximumColourDistance
  };
}

function renderNineSliceMeasurement(decoded, nineSlice) {
  const sourceWidth = decoded.width; const sourceHeight = decoded.height;
  const wideHeight = Math.max(nineSlice.minimumHeight, sourceHeight + Math.ceil(sourceHeight / 2));
  const tallWidth = Math.max(nineSlice.minimumWidth, sourceWidth + Math.ceil(sourceWidth / 2));
  const targets = [
    { width: Math.max(nineSlice.minimumWidth, sourceWidth * 2, wideHeight + 1), height: wideHeight },
    { width: tallWidth, height: Math.max(nineSlice.minimumHeight, sourceHeight * 2, tallWidth + 1) }
  ];
  const sourceCenterWidth = sourceWidth - nineSlice.left - nineSlice.right;
  const sourceCenterHeight = sourceHeight - nineSlice.top - nineSlice.bottom;
  const mapAxis = (coordinate, targetSize, sourceSize, leading, trailing) => coordinate < leading ? coordinate
    : coordinate >= targetSize - trailing ? sourceSize - (targetSize - coordinate)
      : leading + Math.min(sourceSize - leading - trailing - 1, Math.floor((coordinate - leading) * (sourceSize - leading - trailing) / (targetSize - leading - trailing)));
  const sourceCornerDigest = createHash('sha256');
  for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) {
    if ((x < nineSlice.left || x >= sourceWidth - nineSlice.right) && (y < nineSlice.top || y >= sourceHeight - nineSlice.bottom)) {
      const offset = (y * sourceWidth + x) * 4; sourceCornerDigest.update(decoded.rgba.subarray(offset, offset + 4));
    }
  }
  const sourceCornersSha256 = `sha256:${sourceCornerDigest.digest('hex')}`;
  const regionStats = predicate => {
    let pixels = 0; let visible = 0; let core = 0; let luma = 0; let lumaSquared = 0; let neighbourDelta = 0; let neighbourSamples = 0;
    const colours = new Set();
    const premultiplied = (x, y) => {
      const offset = (y * sourceWidth + x) * 4; const alpha = decoded.rgba[offset + 3];
      return isRepresentativeVisibleAlpha(alpha) ? [Math.round(decoded.rgba[offset] * alpha / 255), Math.round(decoded.rgba[offset + 1] * alpha / 255), Math.round(decoded.rgba[offset + 2] * alpha / 255), alpha] : [0, 0, 0, 0];
    };
    for (let y = 0; y < sourceHeight; y += 1) for (let x = 0; x < sourceWidth; x += 1) if (predicate(x, y)) {
      pixels += 1; const rgba = premultiplied(x, y); const pixelLuma = (54 * rgba[0] + 183 * rgba[1] + 19 * rgba[2]) / 256;
      if (rgba[3] >= s02RepresentativeVisibleAlphaThreshold) { visible += 1; if (rgba[3] >= 192) core += 1; colours.add(`${rgba[0] >> 4}:${rgba[1] >> 4}:${rgba[2] >> 4}`); }
      luma += pixelLuma; lumaSquared += pixelLuma * pixelLuma;
      for (const [nextX, nextY] of [[x + 1, y], [x, y + 1]]) if (nextX < sourceWidth && nextY < sourceHeight && predicate(nextX, nextY)) {
        const neighbour = premultiplied(nextX, nextY); neighbourDelta += rgba.reduce((sum, value, channel) => sum + Math.abs(value - neighbour[channel]), 0) / 4; neighbourSamples += 1;
      }
    }
    const meanLuma = luma / pixels;
    return { visibleRatio: visible / pixels, coreRatio: core / pixels, quantizedColorCount: colours.size, lumaMean: meanLuma, lumaStdDev: Math.sqrt(Math.max(0, lumaSquared / pixels - meanLuma ** 2)), meanNeighbourChannelDelta: neighbourDelta / neighbourSamples };
  };
  const inCorner = (x, y) => (x < nineSlice.left || x >= sourceWidth - nineSlice.right) && (y < nineSlice.top || y >= sourceHeight - nineSlice.bottom);
  const inCenter = (x, y) => x >= nineSlice.left && x < sourceWidth - nineSlice.right && y >= nineSlice.top && y < sourceHeight - nineSlice.bottom;
  const cornerSignal = regionStats(inCorner);
  const centerSignal = regionStats(inCenter);
  const borderSignal = regionStats((x, y) => !inCenter(x, y));
  assert(cornerSignal.coreRatio >= 0.05 && cornerSignal.quantizedColorCount >= 8 && centerSignal.visibleRatio >= 0.5 && centerSignal.coreRatio >= 0.25 && centerSignal.quantizedColorCount >= 4 && centerSignal.meanNeighbourChannelDelta <= 45 && Math.abs(borderSignal.lumaMean - centerSignal.lumaMean) >= 3, 'representative nine-slice source lacks coherent center fill or stable decorative cap/border signal');
  const rendered = targets.map(target => {
    const hash = createHash('sha256'); const cornerHash = createHash('sha256');
    for (let y = 0; y < target.height; y += 1) for (let x = 0; x < target.width; x += 1) {
      const sourceX = mapAxis(x, target.width, sourceWidth, nineSlice.left, nineSlice.right);
      const sourceY = mapAxis(y, target.height, sourceHeight, nineSlice.top, nineSlice.bottom);
      const offset = (sourceY * sourceWidth + sourceX) * 4; const pixel = decoded.rgba.subarray(offset, offset + 4); hash.update(pixel);
      if ((x < nineSlice.left || x >= target.width - nineSlice.right) && (y < nineSlice.top || y >= target.height - nineSlice.bottom)) cornerHash.update(pixel);
    }
    return { ...target, sha256: `sha256:${hash.digest('hex')}`, cornersSha256: `sha256:${cornerHash.digest('hex')}` };
  });
  assert(sourceCenterWidth > 0 && sourceCenterHeight > 0 && rendered.every(result => result.cornersSha256 === sourceCornersSha256) && rendered[0].width > rendered[0].height && rendered[1].height > rendered[1].width, 'representative nine-slice render changed immutable corner pixels or omitted wide/tall stress targets');
  return { sourceCornersSha256, cornerSignal, centerSignal, borderSignal, targets: rendered, capsPreserved: true };
}

function compareDecodedPng(left, right) {
  assert(left.width === right.width && left.height === right.height, 'S02 state screenshot comparison dimensions differ');
  const pixelCount = left.width * left.height;
  let changedPixels = 0;
  let totalAbsoluteChannelDelta = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 4;
    let maximumDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left.rgba[index + channel] - right.rgba[index + channel]);
      maximumDelta = Math.max(maximumDelta, delta);
      totalAbsoluteChannelDelta += delta;
    }
    if (maximumDelta >= 12) changedPixels += 1;
  }
  return { changedPixelRatio: changedPixels / pixelCount, meanAbsoluteChannelDelta: totalAbsoluteChannelDelta / (pixelCount * 4) };
}

function compareDecodedPngRegion(left, right, region) {
  assert(left.width === right.width && left.height === right.height, 'S02 ROI comparison dimensions differ');
  const leftPixel = Math.floor(region.x * left.width);
  const topPixel = Math.floor(region.y * left.height);
  const rightPixel = Math.ceil((region.x + region.width) * left.width);
  const bottomPixel = Math.ceil((region.y + region.height) * left.height);
  assert(leftPixel >= 0 && topPixel >= 0 && rightPixel <= left.width && bottomPixel <= left.height && rightPixel > leftPixel && bottomPixel > topPixel, 'S02 ROI resolves outside the screenshot');
  let changedPixels = 0;
  let totalAbsoluteChannelDelta = 0;
  const pixelCount = (rightPixel - leftPixel) * (bottomPixel - topPixel);
  for (let y = topPixel; y < bottomPixel; y += 1) {
    for (let x = leftPixel; x < rightPixel; x += 1) {
      const index = (y * left.width + x) * 4;
      let maximumDelta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(left.rgba[index + channel] - right.rgba[index + channel]);
        maximumDelta = Math.max(maximumDelta, delta);
        totalAbsoluteChannelDelta += delta;
      }
      if (maximumDelta >= 12) changedPixels += 1;
    }
  }
  return { changedPixelRatio: changedPixels / pixelCount, meanAbsoluteChannelDelta: totalAbsoluteChannelDelta / (pixelCount * 4) };
}

function imageDimensionsFromBytes(bytes, file) {
  if (file.endsWith('.png')) {
    assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `image signature mismatch: ${file}`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (file.endsWith('.webp')) {
    assert(bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP', `image signature mismatch: ${file}`);
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (kind === 'VP8L') return { width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)) };
    if (kind === 'VP8 ') {
      const marker = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
      assert(marker >= 0 && marker + 7 <= bytes.length, `WebP dimensions missing: ${file}`);
      return { width: bytes.readUInt16LE(marker + 3) & 0x3fff, height: bytes.readUInt16LE(marker + 5) & 0x3fff };
    }
  }
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) {
    assert(bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8, `image signature mismatch: ${file}`);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      if (marker === 0xd9 || marker === 0xda) break;
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  if (file.endsWith('.svg')) {
    const source = bytes.toString('utf8');
    assert(/^\s*<svg\b/i.test(source) && !/<script\b|<foreignObject\b|<!doctype\b|<!entity\b|\bon\w+\s*=|javascript:|@import\b/i.test(source), `SVG is invalid, executable or externally composited: ${file}`);
    for (const match of source.matchAll(/(?:href|xlink:href)\s*=\s*["']([^"']*)["']/gi)) assert(match[1].startsWith('#'), `SVG external href is forbidden: ${file}`);
    for (const match of source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) assert(match[1].startsWith('#'), `SVG external CSS resource is forbidden: ${file}`);
    const widthMatch = source.match(/\bwidth=["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i);
    const heightMatch = source.match(/\bheight=["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i);
    const viewBoxMatch = source.match(/\bviewBox=["']([^"']+)["']/i);
    const viewBox = viewBoxMatch?.[1].trim().split(/[\s,]+/).map(Number);
    assert((widthMatch && heightMatch) || (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0), `SVG dimensions are missing: ${file}`);
    return { width: Number(widthMatch?.[1] ?? viewBox[2]), height: Number(heightMatch?.[1] ?? viewBox[3]) };
  }
  if (file.endsWith('.avif')) {
    assert(bytes.length >= 32 && bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 32)), `AVIF signature mismatch: ${file}`);
    const ispe = bytes.indexOf(Buffer.from('ispe'));
    assert(ispe >= 4 && ispe + 12 <= bytes.length, `AVIF dimensions missing: ${file}`);
    return { width: bytes.readUInt32BE(ispe + 8), height: bytes.readUInt32BE(ispe + 12) };
  }
  assert(false, `unsupported image format: ${file}`);
}

function verifyS02WorkflowEvidence(evidence, label, requireArtifactArchive = true, requireLiveApi = true, revisionProof = null) {
  assertWorkflowEvidenceKeys(evidence, `${label} S02 workflow evidence`, true);
  for (const key of ['runId', 'runAttempt', 'jobId', 'artifactId']) assert(Number.isSafeInteger(evidence[key]) && evidence[key] > 0, `${label}: S02 workflow ${key} is invalid`);
  assert(/^[a-f0-9]{40}$/.test(evidence.commit ?? '') && evidence.tree === git(['rev-parse', `${evidence.commit}^{tree}`]), `${label}: S02 workflow commit/tree mismatch`);
  assert(evidence.conclusion === 'SUCCESS' && evidence.artifactName === `step4-s02-golden-master-p1-${evidence.commit}-${evidence.runId}-${evidence.runAttempt}` && /^sha256:[a-f0-9]{64}$/.test(evidence.artifactDigest ?? ''), `${label}: S02 workflow result or artifact identity mismatch`);
  verifyDurableActionsOidc(evidence, label, {
    name: 'Verify Step 4 S02 Golden Master P1',
    ref: '2hg7trp7rv-design/cats_tower/.github/workflows/verify-step-4-s02-golden-master-p1.yml@refs/heads/kimi',
    audience: 'cats-tower-s02-golden-master-p1'
  });
  if (requireLiveActions && requireLiveApi) {
    const base = '/repos/2hg7trp7rv-design/cats_tower/actions';
    const run = ghJson(`${base}/runs/${evidence.runId}/attempts/${evidence.runAttempt}`);
    assert(run.id === evidence.runId && run.run_attempt === evidence.runAttempt, `${label}: S02 workflow run/attempt mismatch`);
    assert(run.repository?.full_name === '2hg7trp7rv-design/cats_tower' && run.repository?.id === 1331488679 && run.repository?.owner?.id === 245031448, `${label}: S02 workflow repository identity mismatch`);
    assert(run.head_repository?.full_name === '2hg7trp7rv-design/cats_tower' && run.head_repository?.id === 1331488679 && run.head_repository?.owner?.id === 245031448, `${label}: S02 workflow head-repository identity mismatch`);
    assert(run.head_sha === evidence.commit && run.head_branch === 'kimi' && ['push', 'workflow_dispatch'].includes(run.event) && run.status === 'completed' && run.conclusion === 'success', `${label}: S02 workflow run target or result mismatch`);
    assert((run.path ?? '').split('@')[0] === '.github/workflows/verify-step-4-s02-golden-master-p1.yml', `${label}: S02 workflow path mismatch`);
    const jobs = ghJson(`${base}/runs/${evidence.runId}/attempts/${evidence.runAttempt}/jobs?per_page=100`);
    assert(jobs.total_count === 2 && jobs.jobs?.length === 2, `${label}: S02 workflow must contain exactly one uncredentialed verification job and one provenance job`);
    const listedSemanticJob = jobs.jobs.find(entry => entry.name === 'Static, eight-master responsive and accessibility verification');
    const listedProvenanceJob = jobs.jobs.find(entry => entry.name === 'S02 evidence provenance');
    assert(listedSemanticJob?.status === 'completed' && listedSemanticJob?.conclusion === 'success', `${label}: uncredentialed S02 verification job did not succeed`);
    assert(listedProvenanceJob?.id === evidence.jobId, `${label}: S02 evidence job ID does not bind the provenance job`);
    const semanticJob = ghJson(`${base}/jobs/${listedSemanticJob.id}`);
    assert(semanticJob.run_id === evidence.runId && semanticJob.run_attempt === evidence.runAttempt && semanticJob.head_sha === evidence.commit && semanticJob.head_branch === 'kimi', `${label}: S02 semantic job target/attempt mismatch`);
    assert(semanticJob.name === 'Static, eight-master responsive and accessibility verification' && semanticJob.status === 'completed' && semanticJob.conclusion === 'success', `${label}: S02 semantic job result mismatch`);
    const semanticSteps = [
      'Checkout exact kimi commit',
      'Assert repository and branch boundary',
      'Verify immutable trusted harness',
      'Run fail-closed P1 static contracts',
      'Install exact Node runtime',
      'Install locked Playwright and Chromium',
      'Start exact-head static review',
      ...(revisionProof ? ['Start exact immediate-prior baseline review for revision'] : []),
      'Capture and verify eight masters plus required responsive variants',
      'Upload uncredentialed semantic evidence'
    ];
    const semanticIndexes = semanticSteps.map(name => {
      const matches = semanticJob.steps?.filter(step => step.name === name) ?? [];
      assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success', `${label}: required S02 workflow step missing or failed: ${name}`);
      return semanticJob.steps.indexOf(matches[0]);
    });
    assert(semanticIndexes.every((index, offset) => offset === 0 || index > semanticIndexes[offset - 1]) && (semanticJob.steps ?? []).every(step => !['failure', 'cancelled', 'timed_out', 'action_required'].includes(step.conclusion)), `${label}: S02 semantic workflow step order or conclusion mismatch`);
    const provenanceJob = ghJson(`${base}/jobs/${evidence.jobId}`);
    assert(provenanceJob.run_id === evidence.runId && provenanceJob.run_attempt === evidence.runAttempt && provenanceJob.head_sha === evidence.commit && provenanceJob.head_branch === 'kimi', `${label}: S02 provenance job target/attempt mismatch`);
    assert(provenanceJob.name === 'S02 evidence provenance' && provenanceJob.status === 'completed' && provenanceJob.conclusion === 'success', `${label}: S02 provenance job result mismatch`);
    const provenanceSteps = ['Checkout exact kimi commit for provenance', 'Download exact semantic evidence', 'Write signed S02 evidence result', 'Prepare exact S02 content attestation subjects', 'Create durable S02 content Sigstore attestation', 'Verify and record durable S02 content attestation', 'Prepare exact S02 admission attestation subjects', 'Create durable S02 admission Sigstore attestation', 'Verify durable S02 admission attestation chain', 'Upload exact-head P1 evidence'];
    const provenanceIndexes = provenanceSteps.map(name => {
      const matches = provenanceJob.steps?.filter(step => step.name === name) ?? [];
      assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success', `${label}: required S02 provenance step missing or failed: ${name}`);
      return provenanceJob.steps.indexOf(matches[0]);
    });
    assert(provenanceIndexes.every((index, offset) => offset === 0 || index > provenanceIndexes[offset - 1]) && (provenanceJob.steps ?? []).every(step => !['failure', 'cancelled', 'timed_out', 'action_required'].includes(step.conclusion)), `${label}: S02 provenance workflow step order or conclusion mismatch`);
  }
  if (!requireArtifactArchive) return null;
  const evidenceRound = revisionProof?.evidenceRound ?? '001';
  const persisted = verifyS02PersistedWorkflowPackage(evidence, evidenceRound, revisionProof, label);
  const { readEntry } = persisted;
  try {
    const result = JSON.parse(readEntry('s02-golden-master-p1-result.json').toString('utf8'));
    const staticReportBytes = readEntry('semantic-evidence/static-report.json');
    const browserReportBytes = readEntry('semantic-evidence/browser-report.json');
    const browserRawBytes = readEntry('semantic-evidence/browser-raw.json');
    const staticReport = JSON.parse(staticReportBytes.toString('utf8'));
    const browserReport = JSON.parse(browserReportBytes.toString('utf8'));
    const browserRaw = JSON.parse(browserRawBytes.toString('utf8'));
    const browserRawBaseKeys = ['schemaVersion', 'artifactId', 'repository', 'branch', 'head', 'tree', 'baseUrl', 'playwrightVersion', 'chromiumVersion', 'scenarios'];
    assertExactKeySet(browserRaw, [...browserRawBaseKeys, 'offlineVariants', ...(revisionProof ? ['requestMeasurements', 'assetParticipation'] : [])], `${label} browser raw`);
    assert(browserRaw.repository === '2hg7trp7rv-design/cats_tower' && browserRaw.branch === 'kimi' && browserRaw.head === evidence.commit && browserRaw.tree === evidence.tree, `${label}: browser raw target mismatch`);
    const expectedOfflineViewStates = ['NO_PROGRESS', 'ELAPSED_UNKNOWN', 'RECONCILING_INDETERMINATE', 'RECONCILING_DETERMINATE', 'PROVISIONAL', 'CONFIRMING', 'CONFIRMED', 'REJECTED', 'RETRYABLE_ERROR', 'UNKNOWN'];
    assert(Array.isArray(browserRaw.offlineVariants) && JSON.stringify(browserRaw.offlineVariants.map(entry => entry?.viewState)) === JSON.stringify(expectedOfflineViewStates), `${label}: browser raw offline-state decision-table coverage mismatch`);
    assertExactKeySet(result, ['schemaVersion', 'artifactId', 'repository', 'repositoryId', 'repositoryOwnerId', 'branch', 'commit', 'tree', 'runId', 'runAttempt', 'oidcTokenSha256', 'oidcClaims', 'oidcVerified', 'staticReportSha256', 'browserRawSha256', 'browserReportSha256', ...(revisionProof ? ['baselineBrowserRawSha256', 'revisionComparisonSha256', 'revision'] : []), 'screenshots', 'verdict', 'unresolved', 'physicalIPhoneVerified', 'productionAliasChanged'], `${label} S02 result`);
    assert(result.schemaVersion === 1 && result.artifactId === 'cats-tower-s02-golden-master-p1-workflow-result' && result.repository === '2hg7trp7rv-design/cats_tower' && result.repositoryId === 1331488679 && result.repositoryOwnerId === 245031448, `${label}: S02 result repository identity mismatch`);
    assert(result.branch === 'kimi' && result.commit === evidence.commit && result.tree === evidence.tree && result.runId === evidence.runId && result.runAttempt === evidence.runAttempt && result.oidcTokenSha256 === evidence.oidcTokenSha256 && JSON.stringify(result.oidcClaims) === JSON.stringify(evidence.oidcClaims) && result.oidcVerified === true, `${label}: S02 result target, run or hardened OIDC binding mismatch`);
    assert(result.staticReportSha256 === `sha256:${createHash('sha256').update(staticReportBytes).digest('hex')}` && result.browserRawSha256 === `sha256:${createHash('sha256').update(browserRawBytes).digest('hex')}` && result.browserReportSha256 === `sha256:${createHash('sha256').update(browserReportBytes).digest('hex')}`, `${label}: S02 report or raw-browser digest binding mismatch`);
    assert(result.verdict === 'PASS_S02_GOLDEN_MASTER_P1_WORKFLOW' && JSON.stringify(result.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && result.physicalIPhoneVerified === false && result.productionAliasChanged === false, `${label}: S02 workflow result overclaims or retains P0/P1`);
    assert(staticReport.verdict === 'PASS_S02_GOLDEN_MASTER_P1_STATIC' && Array.isArray(staticReport.failures) && staticReport.failures.length === 0 && staticReport.repository === result.repository && staticReport.branch === result.branch, `${label}: S02 static report did not pass exactly`);
    assertExactKeySet(browserReport, ['schemaVersion', 'artifactId', 'repository', 'branch', 'head', 'tree', 'rawEvidenceSha256', ...(revisionProof ? ['baselineRawSha256', 'revisionComparisonSha256'] : []), 'viewports', 'goldenMasters', 'findingAssertions', 'screenshots', 'pixelStats', 'stateComparisons', 'failures', 'verdict', 'physicalIPhoneVerified', 'productionMutationPerformed'], `${label} S02 browser report`);
    assert(browserReport.schemaVersion === 2 && browserReport.artifactId === 'cats-tower-s02-golden-master-p1-browser-evidence-round-002' && browserReport.repository === result.repository && browserReport.branch === 'kimi', `${label}: S02 browser report identity mismatch`);
    assert(browserReport.head === evidence.commit && browserReport.tree === evidence.tree && browserReport.rawEvidenceSha256 === `sha256:${createHash('sha256').update(browserRawBytes).digest('hex')}` && browserReport.verdict === 'PASS_S02_GOLDEN_MASTER_P1_BROWSER' && browserReport.failures.length === 0 && browserReport.physicalIPhoneVerified === false && browserReport.productionMutationPerformed === false, `${label}: S02 browser report target, raw binding or result mismatch`);
    assert(JSON.stringify(browserReport.viewports) === JSON.stringify(['320x568', '320x667', '375x667', '360x800', '390x844', '412x915', '430x932']) && JSON.stringify(browserReport.goldenMasters) === JSON.stringify(['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08']), `${label}: S02 browser report coverage mismatch`);
    const expectedAssertionIds = s02FindingClosureDefinitions.flatMap(definition => definition.testAssertions);
    assert(JSON.stringify(browserReport.findingAssertions.map(entry => entry.id)) === JSON.stringify(expectedAssertionIds), `${label}: S02 browser assertion set or order mismatch`);
    for (const assertion of browserReport.findingAssertions) {
      assertExactKeySet(assertion, ['id', 'status', 'measurement'], `${label} S02 browser assertion ${assertion.id}`);
      assertExactKeySet(assertion.measurement, ['value', 'operator', 'threshold', 'unit'], `${label} S02 browser assertion measurement ${assertion.id}`);
      const [operator, threshold, unit] = s02AssertionCriteria[assertion.id] ?? [];
      assert(assertion.status === 'PASS' && assertion.measurement.operator === operator && JSON.stringify(assertion.measurement.threshold) === JSON.stringify(threshold) && assertion.measurement.unit === unit, `${label}: S02 browser assertion contract mismatch: ${assertion.id}`);
      const value = assertion.measurement.value;
      const passes = operator === 'EQUALS' ? value === threshold
        : operator === 'GTE' ? typeof value === 'number' && value >= threshold
          : operator === 'LTE' ? typeof value === 'number' && value <= threshold
            : operator === 'BETWEEN' ? typeof value === 'number' && value >= threshold[0] && value <= threshold[1]
              : false;
      assert(passes, `${label}: S02 measured assertion failed trusted threshold evaluation: ${assertion.id}`);
    }
    assert(JSON.stringify(browserReport.screenshots.map(({ id, viewport, path, width, height }) => ({ id, viewport, path, width, height }))) === JSON.stringify(s02ExpectedScreenshots), `${label}: S02 browser screenshot identity, viewport, path or dimension manifest mismatch`);
    const resultScreenshots = [];
    const decodedCurrentScreenshots = new Map();
    for (let index = 0; index < browserReport.screenshots.length; index += 1) {
      const screenshot = browserReport.screenshots[index];
      const expectedScreenshot = s02ExpectedScreenshots[index];
      assertExactKeySet(screenshot, ['id', 'viewport', 'path', 'width', 'height', 'sha256'], `${label} S02 screenshot manifest entry`);
      const bytes = readEntry(screenshot.path);
      const decoded = assertDecodedPng(bytes, expectedScreenshot.width, expectedScreenshot.height, `${label}: ${screenshot.path}`);
      assertProductionScreenshotPng(decoded, `${label}: ${screenshot.path}`);
      const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      assert(screenshot.sha256 === sha256, `${label}: S02 screenshot digest mismatch: ${screenshot.path}`);
      resultScreenshots.push({ path: screenshot.path, sha256 });
      decodedCurrentScreenshots.set(screenshot.id, { decoded, bytes, sha256, path: screenshot.path });
    }
    assert(JSON.stringify(result.screenshots) === JSON.stringify(resultScreenshots), `${label}: S02 signed result does not bind every screenshot digest`);
    let revisionComparison = null;
    if (revisionProof) {
      assertExactKeySet(revisionProof, ['evidenceRound', 'baselineCommit', 'baselineTree', 'affectedGoldenMasters', 'requestedChanges', 'activeAcceptanceCriteria'], `${label} expected revision proof`);
      assert(/^(002|003|004)$/.test(revisionProof.evidenceRound ?? ''), `${label}: expected revision evidence round is invalid`);
      assert(/^[a-f0-9]{40}$/.test(revisionProof.baselineCommit ?? '') && revisionProof.baselineTree === git(['rev-parse', `${revisionProof.baselineCommit}^{tree}`]), `${label}: expected revision baseline commit/tree mismatch`);
      const expectedAffected = [...new Set(revisionProof.affectedGoldenMasters)].sort();
      assert(expectedAffected.length >= 1 && expectedAffected.every(id => /^GM0[1-8]$/.test(id)), `${label}: expected affected Golden Master set is invalid`);
      const beforeRawBytes = readEntry('semantic-evidence/revision/browser-before-raw.json');
      const beforeRaw = JSON.parse(beforeRawBytes.toString('utf8'));
      assertExactKeySet(beforeRaw, [...browserRawBaseKeys, 'requestMeasurements'], `${label} baseline browser raw`);
      assert(beforeRaw.repository === '2hg7trp7rv-design/cats_tower' && beforeRaw.branch === 'kimi' && beforeRaw.head === revisionProof.baselineCommit && beforeRaw.tree === revisionProof.baselineTree, `${label}: baseline browser raw target mismatch`);
      const comparisonBytes = readEntry('semantic-evidence/revision/revision-comparison.json');
      revisionComparison = JSON.parse(comparisonBytes.toString('utf8'));
      assert(browserReport.baselineRawSha256 === `sha256:${createHash('sha256').update(beforeRawBytes).digest('hex')}` && browserReport.revisionComparisonSha256 === `sha256:${createHash('sha256').update(comparisonBytes).digest('hex')}`, `${label}: browser report does not bind exact baseline raw and revision comparison bytes`);
      const acceptanceCriteriaSha256 = `sha256:${sha256Canonical(revisionProof.activeAcceptanceCriteria)}`;
      assertExactKeySet(result.revision, ['baselineCommit', 'baselineTree', 'affectedGoldenMasters', 'requestedChangesSha256', 'acceptanceCriteriaSha256'], `${label} signed revision summary`);
      assert(JSON.stringify(result.revision) === JSON.stringify({ baselineCommit: revisionProof.baselineCommit, baselineTree: revisionProof.baselineTree, affectedGoldenMasters: expectedAffected, requestedChangesSha256: `sha256:${sha256Canonical(revisionProof.requestedChanges)}`, acceptanceCriteriaSha256 }), `${label}: signed revision summary differs from the exact baseline, affected set, request and cumulative Acceptance digests`);
      assert(result.baselineBrowserRawSha256 === `sha256:${createHash('sha256').update(beforeRawBytes).digest('hex')}` && result.revisionComparisonSha256 === `sha256:${createHash('sha256').update(comparisonBytes).digest('hex')}`, `${label}: signed revision result does not bind baseline raw evidence and comparison report`);
      assertExactKeySet(revisionComparison, ['schemaVersion', 'artifactId', 'repository', 'branch', 'baseline', 'revised', 'affectedGoldenMasters', 'requestedChangesSha256', 'acceptanceCriteriaSha256', 'comparisons', 'requestMeasurements', 'assetParticipation', 'verdict', 'failures'], `${label} revision comparison`);
      assertExactKeySet(revisionComparison.baseline, ['commit', 'tree'], `${label} revision comparison baseline`);
      assertExactKeySet(revisionComparison.revised, ['commit', 'tree'], `${label} revision comparison revised target`);
      const expectedRevisionComparisonRound = revisionProof.requestedChanges[0]?.id?.match(/^USER-S02-REV-R(\d{3})-/)?.[1] ?? '002';
      assert(revisionComparison.schemaVersion === 1 && revisionComparison.artifactId === `cats-tower-s02-golden-master-p1-revision-comparison-round-${expectedRevisionComparisonRound}` && revisionComparison.repository === '2hg7trp7rv-design/cats_tower' && revisionComparison.branch === 'kimi', `${label}: revision comparison identity mismatch`);
      assert(JSON.stringify(revisionComparison.baseline) === JSON.stringify({ commit: revisionProof.baselineCommit, tree: revisionProof.baselineTree }) && JSON.stringify(revisionComparison.revised) === JSON.stringify({ commit: evidence.commit, tree: evidence.tree }), `${label}: revision comparison baseline or revised target mismatch`);
      assert(revisionComparison.requestedChangesSha256 === `sha256:${sha256Canonical(revisionProof.requestedChanges)}` && revisionComparison.acceptanceCriteriaSha256 === acceptanceCriteriaSha256, `${label}: revision comparison does not bind the immutable current request and cumulative Acceptance digests`);
      assert(JSON.stringify(revisionComparison.affectedGoldenMasters) === JSON.stringify(expectedAffected) && Array.isArray(revisionComparison.comparisons) && revisionComparison.comparisons.length === 8 && JSON.stringify(revisionComparison.failures) === JSON.stringify([]) && revisionComparison.verdict === 'PASS_S02_USER_REVISION_SAME_RUN_COMPARISON', `${label}: revision comparison affected set, coverage or verdict mismatch`);
      const materiallyChanged = [];
      const decodedBaselineScreenshots = new Map();
      for (let index = 0; index < 8; index += 1) {
        const expectedScreenshot = s02ExpectedScreenshots[index];
        const comparison = revisionComparison.comparisons[index];
        const affected = expectedAffected.includes(expectedScreenshot.id);
        const beforePath = revisionBaselineScreenshots[index];
        const after = decodedCurrentScreenshots.get(expectedScreenshot.id);
        assertExactKeySet(comparison, ['id', 'affected', 'before', 'after', 'delta', 'threshold', 'status'], `${label} revision comparison ${expectedScreenshot.id}`);
        assertExactKeySet(comparison.before, ['path', 'sha256', 'pixelStats'], `${label} revision before ${expectedScreenshot.id}`);
        assertExactKeySet(comparison.after, ['path', 'sha256', 'pixelStats'], `${label} revision after ${expectedScreenshot.id}`);
        assertExactKeySet(comparison.delta, ['changedPixelRatio', 'meanAbsoluteChannelDelta'], `${label} revision delta ${expectedScreenshot.id}`);
        assertExactKeySet(comparison.threshold, ['changedPixelRatio', 'meanAbsoluteChannelDelta'], `${label} revision threshold ${expectedScreenshot.id}`);
        const beforeBytes = readEntry(beforePath);
        const before = assertDecodedPng(beforeBytes, expectedScreenshot.width, expectedScreenshot.height, `${label}: ${beforePath}`);
        assertProductionScreenshotPng(before, `${label}: ${beforePath}`);
        const beforeSha256 = `sha256:${createHash('sha256').update(beforeBytes).digest('hex')}`;
        const recomputed = compareDecodedPng(before, after.decoded);
        const threshold = affected
          ? { changedPixelRatio: [0, 1], meanAbsoluteChannelDelta: [0, 255] }
          : { changedPixelRatio: [0, 0], meanAbsoluteChannelDelta: [0, 0] };
        const assertPixelStats = (reported, recomputedStats, statsLabel) => {
          assertExactKeySet(reported, ['nonTransparentRatio', 'nearOpaqueRatio', 'quantizedColorCount', 'dominantColorRatio', 'lumaStdDev', 'horizontalEdgeRatio'], statsLabel);
          for (const [key, expectedValue] of Object.entries(recomputedStats)) {
            assert(Number.isFinite(reported[key]) && Math.abs(reported[key] - expectedValue) <= 1e-12, `${statsLabel}: recomputed value mismatch for ${key}`);
          }
        };
        assert(comparison.id === expectedScreenshot.id && comparison.affected === affected && comparison.status === 'PASS', `${label}: revision comparison identity, affected flag or status mismatch: ${expectedScreenshot.id}`);
        assert(JSON.stringify(comparison.threshold) === JSON.stringify(threshold), `${label}: revision comparison threshold mismatch: ${expectedScreenshot.id}`);
        assert(comparison.before.path === beforePath && comparison.before.sha256 === beforeSha256, `${label}: revision baseline PNG binding mismatch: ${expectedScreenshot.id}`);
        assert(comparison.after.path === after.path && comparison.after.sha256 === after.sha256, `${label}: revised PNG binding mismatch: ${expectedScreenshot.id}`);
        assertPixelStats(comparison.before.pixelStats, before.stats, `${label} revision before pixel stats ${expectedScreenshot.id}`);
        assertPixelStats(comparison.after.pixelStats, after.decoded.stats, `${label} revision after pixel stats ${expectedScreenshot.id}`);
        assert(Number.isFinite(comparison.delta.changedPixelRatio) && Number.isFinite(comparison.delta.meanAbsoluteChannelDelta) && Math.abs(comparison.delta.changedPixelRatio - recomputed.changedPixelRatio) <= 1e-12 && Math.abs(comparison.delta.meanAbsoluteChannelDelta - recomputed.meanAbsoluteChannelDelta) <= 1e-12, `${label}: revision pixel delta differs from trusted decoded-PNG recomputation: ${expectedScreenshot.id}`);
        const ratioPass = recomputed.changedPixelRatio >= threshold.changedPixelRatio[0] && recomputed.changedPixelRatio <= threshold.changedPixelRatio[1];
        const meanPass = recomputed.meanAbsoluteChannelDelta >= threshold.meanAbsoluteChannelDelta[0] && recomputed.meanAbsoluteChannelDelta <= threshold.meanAbsoluteChannelDelta[1];
        assert(ratioPass && meanPass, `${label}: revision pixel delta is outside the exact affected/unaffected bounds: ${expectedScreenshot.id}`);
        decodedBaselineScreenshots.set(expectedScreenshot.id, { decoded: before, bytes: beforeBytes, sha256: beforeSha256, path: beforePath });
        if (beforeSha256 !== after.sha256) {
          assert(recomputed.changedPixelRatio > 0 || recomputed.meanAbsoluteChannelDelta > 0, `${label}: changed screenshot digest has no decoded pixel delta: ${expectedScreenshot.id}`);
          materiallyChanged.push(expectedScreenshot.id);
        }
      }
      assert(JSON.stringify(materiallyChanged) === JSON.stringify(expectedAffected), `${label}: materially changed Golden Masters differ from the exact round 007 affected set`);
      const expectedRawAssertionOrder = revisionProof.activeAcceptanceCriteria.map(entry => ({
        requestId: entry.requestId,
        criterionSha256: entry.criterionSha256,
        criterion: entry.assertion,
        introducedNow: revisionProof.requestedChanges.some(change => change.id === entry.requestId)
      }));
      const expectedGroups = [];
      for (const entry of expectedRawAssertionOrder) {
        let group = expectedGroups.find(candidate => candidate.requestId === entry.requestId);
        if (!group) { group = { requestId: entry.requestId, assertions: [] }; expectedGroups.push(group); }
        group.assertions.push(entry);
      }
      assert(Array.isArray(beforeRaw.requestMeasurements) && Array.isArray(browserRaw.requestMeasurements) && beforeRaw.requestMeasurements.length === expectedRawAssertionOrder.length && browserRaw.requestMeasurements.length === expectedRawAssertionOrder.length, `${label}: request-measurement raw coverage mismatch`);
      assert(Array.isArray(revisionComparison.requestMeasurements) && revisionComparison.requestMeasurements.length === expectedGroups.length, `${label}: grouped cumulative request-measurement coverage mismatch`);
      const numbersEqual = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-12;
      const assertSelectorObservation = (observed, type, observedLabel, allowAbsent = false) => {
        const keys = type === 'DOM_RECT_DELTA' ? ['selectorCount', 'visible', 'rect']
          : type === 'DOM_STYLE_DELTA' ? ['selectorCount', 'visible', 'value']
            : type === 'TEXT_EXACT' ? ['selectorCount', 'visible', 'text']
              : ['selectorCount', 'visible', 'area'];
        assertExactKeySet(observed, keys, observedLabel);
        const canonicalAbsent = allowAbsent && observed.selectorCount === 0 && observed.visible === false
          && (type === 'TEXT_EXACT' ? observed.text === '' : type === 'ELEMENT_VISIBLE' ? observed.area === 0 : false);
        assert((observed.selectorCount === 1 || canonicalAbsent) && typeof observed.visible === 'boolean', `${observedLabel}: selector count, visibility or absent-element sentinel is invalid`);
        if (canonicalAbsent) return;
        if (type === 'DOM_RECT_DELTA') {
          assertExactKeySet(observed.rect, ['x', 'y', 'width', 'height'], `${observedLabel} rect`);
          assert(Object.values(observed.rect).every(Number.isFinite), `${observedLabel}: rectangle is nonnumeric`);
        } else if (type === 'DOM_STYLE_DELTA') assert(['string', 'number'].includes(typeof observed.value), `${observedLabel}: style value is invalid`);
        else if (type === 'TEXT_EXACT') assert(typeof observed.text === 'string', `${observedLabel}: text is invalid`);
        else assert(Number.isFinite(observed.area) && observed.area >= 0, `${observedLabel}: visible area is invalid`);
      };
      let rawOffset = 0;
      for (let requestIndex = 0; requestIndex < expectedGroups.length; requestIndex += 1) {
        const expectedGroup = expectedGroups[requestIndex];
        const grouped = revisionComparison.requestMeasurements[requestIndex];
        assertExactKeySet(grouped, ['requestId', 'assertions', 'status'], `${label} request measurement ${expectedGroup.requestId}`);
        assert(grouped.requestId === expectedGroup.requestId && grouped.status === 'PASS' && Array.isArray(grouped.assertions) && grouped.assertions.length === expectedGroup.assertions.length, `${label}: request ${expectedGroup.requestId} cumulative measurement identity, count or verdict mismatch`);
        for (let assertionIndex = 0; assertionIndex < expectedGroup.assertions.length; assertionIndex += 1) {
          const expectedEntry = expectedGroup.assertions[assertionIndex];
          const criterion = expectedEntry.criterion;
          const beforeRawEntry = beforeRaw.requestMeasurements[rawOffset];
          const afterRawEntry = browserRaw.requestMeasurements[rawOffset];
          const measured = grouped.assertions[assertionIndex];
          const identity = { requestId: expectedEntry.requestId, assertionId: criterion.id, type: criterion.type, goldenMaster: criterion.goldenMaster, criterionSha256: expectedEntry.criterionSha256 };
          assertExactKeySet(beforeRawEntry, [...Object.keys(identity), 'observed'], `${label} baseline raw assertion ${criterion.id}`);
          assertExactKeySet(afterRawEntry, [...Object.keys(identity), 'observed'], `${label} revised raw assertion ${criterion.id}`);
          assert(JSON.stringify(Object.fromEntries(Object.keys(identity).map(key => [key, beforeRawEntry[key]]))) === JSON.stringify(identity) && JSON.stringify(Object.fromEntries(Object.keys(identity).map(key => [key, afterRawEntry[key]]))) === JSON.stringify(identity), `${label}: raw assertion identity differs from immutable request: ${criterion.id}`);
          assertExactKeySet(measured, ['assertionId', 'type', 'goldenMaster', 'criterionSha256', 'before', 'after', 'measured', 'status'], `${label} comparison assertion ${criterion.id}`);
          assert(measured.assertionId === criterion.id && measured.type === criterion.type && measured.goldenMaster === criterion.goldenMaster && measured.criterionSha256 === expectedEntry.criterionSha256 && measured.status === 'PASS' && JSON.stringify(measured.before) === JSON.stringify(beforeRawEntry.observed) && JSON.stringify(measured.after) === JSON.stringify(afterRawEntry.observed), `${label}: comparison assertion is not the exact raw before/after evidence: ${criterion.id}`);
          if (criterion.type === 'ROI_PIXEL_DELTA') {
            for (const [observed, screenshotPath, observedLabel] of [[measured.before, decodedBaselineScreenshots.get(criterion.goldenMaster)?.path, 'before'], [measured.after, decodedCurrentScreenshots.get(criterion.goldenMaster)?.path, 'after']]) {
              assertExactKeySet(observed, ['screenshotPath', 'region'], `${label} ${observedLabel} ROI ${criterion.id}`);
              assert(observed.screenshotPath === screenshotPath && JSON.stringify(observed.region) === JSON.stringify(criterion.region), `${label}: ROI observation differs from immutable region/screenshot: ${criterion.id}`);
            }
            assertExactKeySet(measured.measured, ['changedPixelRatio', 'meanAbsoluteChannelDelta'], `${label} ROI result ${criterion.id}`);
            const roi = compareDecodedPngRegion(decodedBaselineScreenshots.get(criterion.goldenMaster).decoded, decodedCurrentScreenshots.get(criterion.goldenMaster).decoded, criterion.region);
            const currentPass = roi.changedPixelRatio >= criterion.changedPixelRatio[0] && roi.changedPixelRatio <= criterion.changedPixelRatio[1] && roi.meanAbsoluteChannelDelta >= criterion.meanAbsoluteChannelDelta[0] && roi.meanAbsoluteChannelDelta <= criterion.meanAbsoluteChannelDelta[1] && (roi.changedPixelRatio > 0 || roi.meanAbsoluteChannelDelta > 0);
            const survivorPass = roi.changedPixelRatio === 0 && roi.meanAbsoluteChannelDelta === 0;
            assert(numbersEqual(measured.measured.changedPixelRatio, roi.changedPixelRatio) && numbersEqual(measured.measured.meanAbsoluteChannelDelta, roi.meanAbsoluteChannelDelta) && (expectedEntry.introducedNow ? currentPass : survivorPass), `${label}: trusted ROI ${expectedEntry.introducedNow ? 'acceptance' : 'non-regression'} evaluation failed ${criterion.id}`);
          } else {
            const permitsAbsentBaseline = expectedEntry.introducedNow && ['TEXT_EXACT', 'ELEMENT_VISIBLE'].includes(criterion.type);
            assertSelectorObservation(measured.before, criterion.type, `${label} before ${criterion.id}`, permitsAbsentBaseline);
            assertSelectorObservation(measured.after, criterion.type, `${label} after ${criterion.id}`);
            assert(measured.after.visible === true, `${label}: revised assertion target is not visible: ${criterion.id}`);
            if (criterion.type === 'DOM_RECT_DELTA') {
              assertExactKeySet(measured.measured, ['beforeValue', 'afterValue', 'delta'], `${label} rectangle result ${criterion.id}`);
              const beforeValue = measured.before.rect[criterion.property]; const afterValue = measured.after.rect[criterion.property]; const delta = afterValue - beforeValue;
              const pass = criterion.operator === 'DELTA_GTE' ? delta >= criterion.threshold : criterion.operator === 'DELTA_LTE' ? delta <= criterion.threshold : Math.abs(delta) >= criterion.threshold;
              assert(numbersEqual(measured.measured.beforeValue, beforeValue) && numbersEqual(measured.measured.afterValue, afterValue) && numbersEqual(measured.measured.delta, delta) && (expectedEntry.introducedNow ? (delta !== 0 && pass) : delta === 0), `${label}: rectangle assertion failed trusted ${expectedEntry.introducedNow ? 'acceptance' : 'non-regression'} evaluation: ${criterion.id}`);
            } else if (criterion.type === 'DOM_STYLE_DELTA') {
              assertExactKeySet(measured.measured, ['beforeValue', 'afterValue', 'delta', 'changed', 'afterMatches'], `${label} style result ${criterion.id}`);
              const beforeValue = measured.before.value; const afterValue = measured.after.value; const changed = beforeValue !== afterValue;
              const numeric = ['font-size', 'opacity'].includes(criterion.property);
              const beforeNumeric = numeric ? Number.parseFloat(beforeValue) : null;
              const afterNumeric = numeric ? Number.parseFloat(afterValue) : null;
              if (numeric) assert(Number.isFinite(beforeNumeric) && Number.isFinite(afterNumeric), `${label}: numeric style observation is not parseable: ${criterion.id}`);
              const delta = numeric ? afterNumeric - beforeNumeric : null;
              const afterMatches = criterion.operator === 'AFTER_EQUALS' ? afterValue === criterion.threshold : null;
              const pass = criterion.operator === 'DELTA_GTE' ? delta >= criterion.threshold : criterion.operator === 'DELTA_LTE' ? delta <= criterion.threshold : criterion.operator === 'ABS_DELTA_GTE' ? Math.abs(delta) >= criterion.threshold : criterion.operator === 'CHANGED' ? changed : afterMatches && beforeValue !== criterion.threshold;
              assert(JSON.stringify(measured.measured) === JSON.stringify({ beforeValue, afterValue, delta, changed, afterMatches }) && (expectedEntry.introducedNow ? (changed && pass) : !changed), `${label}: style assertion failed trusted ${expectedEntry.introducedNow ? 'acceptance' : 'non-regression'} evaluation: ${criterion.id}`);
            } else if (criterion.type === 'TEXT_EXACT') {
              assertExactKeySet(measured.measured, ['expected', 'beforeMatches', 'afterMatches', 'introducedOrChanged'], `${label} text result ${criterion.id}`);
              const beforeMatches = measured.before.selectorCount === 1 && measured.before.visible === true && measured.before.text === criterion.expected;
              const afterMatches = measured.after.selectorCount === 1 && measured.after.visible === true && measured.after.text === criterion.expected;
              const introducedOrChanged = measured.before.selectorCount === 0 || measured.before.visible !== true || measured.before.text !== criterion.expected;
              const baselinePass = expectedEntry.introducedNow ? introducedOrChanged : beforeMatches;
              assert(JSON.stringify(measured.measured) === JSON.stringify({ expected: criterion.expected, beforeMatches, afterMatches, introducedOrChanged }) && afterMatches && baselinePass, `${label}: TEXT_EXACT failed trusted ${expectedEntry.introducedNow ? 'acceptance' : 'non-regression'} evaluation: ${criterion.id}`);
            } else {
              assertExactKeySet(measured.measured, ['minimumArea', 'beforeVisibleArea', 'afterVisibleArea', 'introducedOrExpanded'], `${label} visibility result ${criterion.id}`);
              const beforeVisibleArea = measured.before.area;
              const afterVisibleArea = measured.after.area;
              const introducedOrExpanded = measured.before.selectorCount === 0 || measured.before.visible !== true || beforeVisibleArea < criterion.minimumArea;
              const baselinePass = expectedEntry.introducedNow ? introducedOrExpanded : (measured.before.visible && beforeVisibleArea >= criterion.minimumArea);
              assert(JSON.stringify(measured.measured) === JSON.stringify({ minimumArea: criterion.minimumArea, beforeVisibleArea, afterVisibleArea, introducedOrExpanded }) && measured.after.visible === true && afterVisibleArea >= criterion.minimumArea && baselinePass, `${label}: ELEMENT_VISIBLE failed trusted ${expectedEntry.introducedNow ? 'acceptance' : 'non-regression'} evaluation: ${criterion.id}`);
            }
          }
          rawOffset += 1;
        }
      }
      assert(rawOffset === expectedRawAssertionOrder.length, `${label}: request-measurement raw ordering is incomplete`);
      assert(Array.isArray(browserRaw.assetParticipation) && JSON.stringify(revisionComparison.assetParticipation) === JSON.stringify(browserRaw.assetParticipation), `${label}: comparison asset participation differs from revised raw evidence`);
      const assetManifest = jsonAt(evidence.commit, 'step4/s02/golden-master-p1/asset-manifest.json');
      assertExactKeySet(assetManifest, ['schemaVersion', 'purpose', 'visibleBoundsContract', 'assets'], `${label} asset manifest`);
      assertExactKeySet(assetManifest.visibleBoundsContract, ['alphaThresholdInclusive', 'connectivity', 'discardComponentAreaBelowFractionOfOpaquePixels', 'bounds'], `${label} visible-bounds contract`);
      assert(assetManifest.schemaVersion === 2 && assetManifest.purpose === 'DESIGN_REVIEW_ONLY_NOT_RUNTIME' && JSON.stringify(assetManifest.visibleBoundsContract) === JSON.stringify({ alphaThresholdInclusive: 32, connectivity: 8, discardComponentAreaBelowFractionOfOpaquePixels: 0.0025, bounds: 'union of retained components in sourceRect-local integer pixels' }) && Array.isArray(assetManifest.assets) && assetManifest.assets.length >= 1 && assetManifest.assets.length <= 100, `${label}: asset manifest identity, visible-bounds policy or size is invalid`);
      const manifestAssetPaths = assetManifest.assets.map(asset => asset.path).sort();
      assert(new Set(manifestAssetPaths).size === manifestAssetPaths.length, `${label}: asset manifest contains duplicate paths`);
      const requiredAssetPaths = [...new Set(revisionProof.requestedChanges.flatMap(change => change.requiredAssets))].sort();
      assert(requiredAssetPaths.every(file => manifestAssetPaths.includes(file)), `${label}: a user-required revised asset is absent from the exact asset manifest`);
      const manifestByPath = new Map();
      for (const asset of assetManifest.assets) {
        assertExactKeySet(asset, ['path', 'kind', 'width', 'height', 'sha256', 'textBakedIn', 'runtimeUseAuthorized', 'includesEffects', 'includesCharacterPixels', 'reviewOnly', 'frames'], `${label} asset manifest entry ${asset.path ?? '<missing>'}`);
        assert(typeof asset.path === 'string' && /^assets\/[A-Za-z0-9_./-]+\.(?:webp|png|svg)$/.test(asset.path) && !asset.path.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.')), `${label}: asset manifest path is unsafe or uses an unreviewed decoder: ${asset.path}`);
        const file = `step4/s02/golden-master-p1/${asset.path}`;
        const bytes = bytesAt(evidence.commit, file);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const dimensions = imageDimensionsFromBytes(bytes, file);
        assert(['background', 'character', 'enemy', 'ui', 'effect', 'reference'].includes(asset.kind) && Number.isSafeInteger(asset.width) && Number.isSafeInteger(asset.height) && asset.width >= 1 && asset.height >= 1 && asset.width <= 8192 && asset.height <= 8192 && asset.sha256 === sha256 && asset.width === dimensions.width && asset.height === dimensions.height, `${label}: asset kind, digest or decoded dimensions differ from Git bytes: ${asset.path}`);
        for (const key of ['textBakedIn', 'runtimeUseAuthorized', 'includesEffects', 'includesCharacterPixels', 'reviewOnly']) assert(typeof asset[key] === 'boolean', `${label}: asset truth field is not boolean (${key}): ${asset.path}`);
        assert(asset.runtimeUseAuthorized === false && (asset.kind === 'reference' ? asset.reviewOnly === true && asset.textBakedIn === true : asset.reviewOnly === false && asset.textBakedIn === false), `${label}: asset review/runtime/text truth is inconsistent: ${asset.path}`);
        assert(Array.isArray(asset.frames) && asset.frames.length >= 1 && asset.frames.length <= 64, `${label}: asset frame manifest is missing or unbounded: ${asset.path}`);
        const frameIds = new Set();
        for (const frame of asset.frames) {
          assertExactKeySet(frame, ['id', 'sourceRect', 'visibleBounds', 'footAnchor', 'hitBounds', 'containsEffects'], `${label} asset frame ${asset.path}`);
          assert(typeof frame.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(frame.id) && !frameIds.has(frame.id), `${label}: asset frame ID is invalid or duplicated: ${asset.path}`);
          frameIds.add(frame.id);
          const assertRect = (rect, rectLabel, nullable = false) => {
            if (nullable && rect === null) return;
            assertExactKeySet(rect, ['x', 'y', 'width', 'height'], rectLabel);
            assert(Object.values(rect).every(Number.isSafeInteger) && rect.x >= 0 && rect.y >= 0 && rect.width >= 1 && rect.height >= 1, `${rectLabel}: rectangle is invalid`);
          };
          assertRect(frame.sourceRect, `${label} sourceRect ${asset.path}/${frame.id}`);
          assert(frame.sourceRect.x + frame.sourceRect.width <= asset.width && frame.sourceRect.y + frame.sourceRect.height <= asset.height, `${label}: frame sourceRect exceeds decoded image: ${asset.path}/${frame.id}`);
          assertRect(frame.visibleBounds, `${label} visibleBounds ${asset.path}/${frame.id}`);
          assert(frame.visibleBounds.x + frame.visibleBounds.width <= frame.sourceRect.width && frame.visibleBounds.y + frame.visibleBounds.height <= frame.sourceRect.height, `${label}: visible bounds exceed frame: ${asset.path}/${frame.id}`);
          if (frame.footAnchor !== null) {
            assertExactKeySet(frame.footAnchor, ['x', 'y'], `${label} foot anchor ${asset.path}/${frame.id}`);
            assert(Number.isSafeInteger(frame.footAnchor.x) && Number.isSafeInteger(frame.footAnchor.y) && frame.footAnchor.x >= 0 && frame.footAnchor.x <= frame.sourceRect.width && frame.footAnchor.y >= 0 && frame.footAnchor.y <= frame.sourceRect.height, `${label}: foot anchor exceeds frame: ${asset.path}/${frame.id}`);
          }
          assertRect(frame.hitBounds, `${label} hit bounds ${asset.path}/${frame.id}`, true);
          if (frame.hitBounds) assert(frame.hitBounds.x + frame.hitBounds.width <= frame.sourceRect.width && frame.hitBounds.y + frame.hitBounds.height <= frame.sourceRect.height, `${label}: hit bounds exceed frame: ${asset.path}/${frame.id}`);
          assert(typeof frame.containsEffects === 'boolean' && (!frame.containsEffects || asset.includesEffects), `${label}: frame effect truth is inconsistent: ${asset.path}/${frame.id}`);
        }
        manifestByPath.set(asset.path, { asset, bytes, sha256: `sha256:${sha256}` });
      }
      assert(JSON.stringify(browserRaw.assetParticipation.map(entry => entry.path)) === JSON.stringify(manifestAssetPaths), `${label}: asset participation does not cover the exact asset manifest in order`);
      const revisedBaseUrl = new URL(browserRaw.baseUrl);
      assert(revisedBaseUrl.username === '' && revisedBaseUrl.password === '', `${label}: revised browser base URL contains userinfo`);
      const revisedOrigin = revisedBaseUrl.origin;
      for (const participation of browserRaw.assetParticipation) {
        assertExactKeySet(participation, ['path', 'goldenMasters', 'requestIds', 'requests', 'domReferences'], `${label} asset participation ${participation.path}`);
        const manifestAsset = manifestByPath.get(participation.path);
        assert(manifestAsset, `${label}: asset participation path is not manifest-bound: ${participation.path}`);
        const owners = revisionProof.requestedChanges.filter(change => change.requiredAssets.includes(participation.path));
        const expectedRequestIds = owners.map(change => change.id).sort();
        const expectedOwnerGms = [...new Set(owners.flatMap(change => change.affectedGoldenMasters))].sort();
        assert(Array.isArray(participation.goldenMasters) && JSON.stringify(participation.goldenMasters) === JSON.stringify([...new Set(participation.goldenMasters)].sort()) && participation.goldenMasters.every(id => /^GM0[1-8]$/.test(id)), `${label}: asset Golden Master set is invalid: ${participation.path}`);
        assert(JSON.stringify(participation.requestIds) === JSON.stringify(expectedRequestIds), `${label}: asset request ownership differs from immutable requiredAssets: ${participation.path}`);
        if (owners.length) assert(JSON.stringify(participation.goldenMasters) === JSON.stringify(expectedOwnerGms), `${label}: requested asset does not participate in every affected Golden Master: ${participation.path}`);
        assert(Array.isArray(participation.requests) && Array.isArray(participation.domReferences) && participation.requests.length === participation.goldenMasters.length && participation.domReferences.length >= participation.goldenMasters.length, `${label}: asset network/decode/DOM evidence is incomplete: ${participation.path}`);
        for (const request of participation.requests) {
          assertExactKeySet(request, ['goldenMaster', 'url', 'status', 'contentType', 'decoded', 'sha256'], `${label} asset request ${participation.path}`);
          let assetUrl; try { assetUrl = new URL(request.url); } catch { assert(false, `${label}: asset URL is invalid: ${participation.path}`); }
          assert(participation.goldenMasters.includes(request.goldenMaster) && assetUrl.origin === revisedOrigin && assetUrl.username === '' && assetUrl.password === '' && assetUrl.search === '' && assetUrl.hash === '' && assetUrl.pathname === `/step4/s02/golden-master-p1/${participation.path}` && request.status === 200 && /^image\/(?:webp|png|svg\+xml)(?:;|$)/i.test(request.contentType ?? '') && request.decoded === true && request.sha256 === manifestAsset.sha256, `${label}: asset was not exact-origin loaded, decoded and byte-bound: ${participation.path}`);
        }
        const expectedSurface = manifestAsset.asset.reviewOnly ? 'review' : 'game';
        assert(!owners.length || expectedSurface === 'game', `${label}: a user-required revised asset is marked reviewOnly: ${participation.path}`);
        for (const reference of participation.domReferences) {
          assertExactKeySet(reference, ['goldenMaster', 'selector', 'property', 'visibleArea', 'surface', 'resolvedUrl'], `${label} asset DOM reference ${participation.path}`);
          let resolvedUrl; try { resolvedUrl = new URL(reference.resolvedUrl); } catch { assert(false, `${label}: resolved asset DOM URL is invalid: ${participation.path}`); }
          assert(participation.goldenMasters.includes(reference.goldenMaster) && typeof reference.selector === 'string' && reference.selector.length >= 1 && reference.selector.length <= 300 && ['src', 'background-image', 'mask-image'].includes(reference.property) && Number.isFinite(reference.visibleArea) && reference.visibleArea >= 64 && reference.surface === expectedSurface && resolvedUrl.origin === revisedOrigin && resolvedUrl.username === '' && resolvedUrl.password === '' && resolvedUrl.search === '' && resolvedUrl.hash === '' && resolvedUrl.pathname === `/step4/s02/golden-master-p1/${participation.path}`, `${label}: asset DOM reference is inert, wrong-surface or not byte-route-bound: ${participation.path}`);
        }
        for (const gm of participation.goldenMasters) assert(participation.requests.filter(request => request.goldenMaster === gm).length === 1 && participation.domReferences.some(reference => reference.goldenMaster === gm && reference.surface === expectedSurface), `${label}: asset lacks one exact request and visible DOM evidence for ${gm}: ${participation.path}`);
        if (owners.length) assert(participation.domReferences.every(reference => reference.surface === 'game'), `${label}: user-requested game asset is shown only in review chrome: ${participation.path}`);
      }
    }
    return { result, staticReport, browserReport, revisionComparison };
  } finally {}
}

function strictSchemaAdapterSource({ defaultDataPath, schemaPath, artifactId }) {
  return `#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { assertSchema } from './lib-v2/schema-validator.mjs';

const dataPath = resolve(process.argv[2] ?? '${defaultDataPath}');
const schemaPath = resolve('${schemaPath}');
try {
  const [data, schema] = await Promise.all([
    readFile(dataPath, 'utf8').then(JSON.parse),
    readFile(schemaPath, 'utf8').then(JSON.parse)
  ]);
  assertSchema(data, schema);
  console.log(JSON.stringify({ ok: true, artifactId: '${artifactId}' }));
} catch (error) {
  const details = error.errors ?? [{ path: '#', keyword: 'runtime', message: error.message }];
  console.error(JSON.stringify({
    ok: false,
    artifactId: '${artifactId}',
    errors: [{ code: 'SCHEMA', message: JSON.stringify(details) }]
  }));
  process.exit(1);
}
`;
}

function exactV3QualificationRunnerSource() {
  return `#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runQualification } from './engine-v2/run-plan.mjs';

const canonicalOutput = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json';
const outputIndex = process.argv.indexOf('--output');
if (process.argv.length !== (outputIndex >= 0 ? 4 : 2) || (outputIndex >= 0 && outputIndex !== 2)) throw new Error('USAGE: node simulation/run-qualification-v3.mjs [--output <path>]');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : canonicalOutput;
if (!output) throw new Error('V3_QUALIFICATION_OUTPUT_REQUIRED');
const result = await runQualification({
  candidatePath: 'simulation/candidate-v3.json',
  planPath: 'simulation/run-plan-v3.json',
  executionPath: 'simulation/execution-contract-v3.json'
});
result.evidence.reproductionCommand = 'node simulation/run-qualification-v3.mjs';
await writeFile(resolve(output), \`${'${JSON.stringify(result, null, 2)}'}\\n\`, 'utf8');
console.log(JSON.stringify({ ok: true, mode: 'qualification-v3', output, digest: result.hashes.deterministicPayloadSha256, scenarioCount: result.deterministicPayload.scenarioCount }));
`;
}

function assertDeleted(paths, label) {
  for (const p of paths) assert(!exists(p), `${label}: obsolete live path remains: ${p}`);
}

const authority = json('CURRENT_AUTHORITY_INDEX.json');
const status = json('PROJECT_STATUS.json');
const policy = json('AI_PROJECT_POLICY.json');
const sim = json('simulation/CURRENT_STATUS.json');
const dispatcher = json('quality-reviews/step-1-canonical-design/active-change-control.json');
const rootControl = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-028.json');
const correction = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-029.json');
const attemptedClosure = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json');
const reopen = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json');
const step2CorrectionPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-032.json';
const step2Correction = exists(step2CorrectionPath) ? json(step2CorrectionPath) : null;
const closurePath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json';
const closureExists = exists(closurePath);
const closureCommit = closureExists ? firstAddCommit(closurePath) : null;
const s02RepairControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-034.json';
const s02RepairControl = exists(s02RepairControlPath) ? json(s02RepairControlPath) : null;
const s02RepairOpeningCommit = s02RepairControl ? firstAddCommit(s02RepairControlPath) : null;
const s02P2ControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-035.json';
const s02UserDecisionLockPath = 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-006.json';
const s02P2Control = exists(s02P2ControlPath) ? json(s02P2ControlPath) : null;
const s02UserDecisionLock = exists(s02UserDecisionLockPath) ? json(s02UserDecisionLockPath) : null;
const s02P2OpeningCommit = s02P2Control ? firstAddCommit(s02P2ControlPath) : null;
const s02RevisionControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-036.json';
const s02RevisionDecisionLockPath = 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-007.json';
const s02RevisionControl = exists(s02RevisionControlPath) ? json(s02RevisionControlPath) : null;
const s02RevisionDecisionLock = exists(s02RevisionDecisionLockPath) ? json(s02RevisionDecisionLockPath) : null;
const s02RevisionOpeningCommit = s02RevisionControl ? firstAddCommit(s02RevisionControlPath) : null;
const s02RevisedP2ControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-037.json';
const s02RevisedApprovalLockPath = 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-008.json';
const s02RevisedP2Control = exists(s02RevisedP2ControlPath) ? json(s02RevisedP2ControlPath) : null;
const s02RevisedApprovalLock = exists(s02RevisedApprovalLockPath) ? json(s02RevisedApprovalLockPath) : null;
const s02RevisedP2OpeningCommit = s02RevisedP2Control ? firstAddCommit(s02RevisedP2ControlPath) : null;
const s02SecondRevisionControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-038.json';
const s02SecondRevisionLockPath = 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-009.json';
const s02SecondRevisionControl = exists(s02SecondRevisionControlPath) ? json(s02SecondRevisionControlPath) : null;
const s02SecondRevisionLock = exists(s02SecondRevisionLockPath) ? json(s02SecondRevisionLockPath) : null;
const s02SecondRevisionOpeningCommit = s02SecondRevisionControl ? firstAddCommit(s02SecondRevisionControlPath) : null;
const s02SecondRevisedP2ControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-039.json';
const s02SecondRevisedApprovalLockPath = 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-010.json';
const s02SecondRevisedP2Control = exists(s02SecondRevisedP2ControlPath) ? json(s02SecondRevisedP2ControlPath) : null;
const s02SecondRevisedApprovalLock = exists(s02SecondRevisedApprovalLockPath) ? json(s02SecondRevisedApprovalLockPath) : null;
const s02SecondRevisedP2OpeningCommit = s02SecondRevisedP2Control ? firstAddCommit(s02SecondRevisedP2ControlPath) : null;
const s02ThirdRevisionControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-040.json';
const s02ThirdRevisionLockPath = 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-011.json';
const s02ThirdRevisionControl = exists(s02ThirdRevisionControlPath) ? json(s02ThirdRevisionControlPath) : null;
const s02ThirdRevisionLock = exists(s02ThirdRevisionLockPath) ? json(s02ThirdRevisionLockPath) : null;
const s02ThirdRevisionOpeningCommit = s02ThirdRevisionControl ? firstAddCommit(s02ThirdRevisionControlPath) : null;
const s02ThirdRevisedP2ControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-041.json';
const s02ThirdRevisedApprovalLockPath = 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-012.json';
const s02ThirdRevisedP2Control = exists(s02ThirdRevisedP2ControlPath) ? json(s02ThirdRevisedP2ControlPath) : null;
const s02ThirdRevisedApprovalLock = exists(s02ThirdRevisedApprovalLockPath) ? json(s02ThirdRevisedApprovalLockPath) : null;
const s02ThirdRevisedP2OpeningCommit = s02ThirdRevisedP2Control ? firstAddCommit(s02ThirdRevisedP2ControlPath) : null;
const s02AssetPassControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-042.json';
const s02AssetPassControl = exists(s02AssetPassControlPath) ? json(s02AssetPassControlPath) : null;
const s02AssetPassOpeningCommit = s02AssetPassControl ? firstAddCommit(s02AssetPassControlPath) : null;
const s02AssetVolumeScopeControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-043.json';
const s02AssetVolumeScopeLockPath = 'quality-reviews/step-1-canonical-design/governance-activation-record-round-013.json';
const s02AssetVolumeScopeControl = exists(s02AssetVolumeScopeControlPath) ? json(s02AssetVolumeScopeControlPath) : null;
const s02AssetVolumeScopeLock = exists(s02AssetVolumeScopeLockPath) ? json(s02AssetVolumeScopeLockPath) : null;
const s02AssetVolumeScopeOpeningCommit = s02AssetVolumeScopeControl ? firstAddCommit(s02AssetVolumeScopeControlPath) : null;
const s02AssetVolumeControlPath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-044.json';
const s02AssetVolumeApprovalLockPath = 'quality-reviews/step-1-canonical-design/governance-activation-record-round-014.json';
const s02AssetVolumeControl = exists(s02AssetVolumeControlPath) ? json(s02AssetVolumeControlPath) : null;
const s02AssetVolumeApprovalLock = exists(s02AssetVolumeApprovalLockPath) ? json(s02AssetVolumeApprovalLockPath) : null;
const s02AssetVolumeOpeningCommit = s02AssetVolumeControl ? firstAddCommit(s02AssetVolumeControlPath) : null;
const s02P2Controls = [s02P2Control, s02RevisedP2Control, s02SecondRevisedP2Control, s02ThirdRevisedP2Control].filter(Boolean);
const s02AnyP2Control = s02P2Controls.at(-1) ?? null;
const step2ContinuityPath = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/step3-continuity-bridge.json';
const v3SealPath = 'simulation/executable-seal-v3.json';
const v3SealValidatorPath = 'simulation/validate-executable-seal-v3.mjs';
const v3ProjectionVerifierPath = 'tests/governance/verify-step2-screen-projection-round-032.mjs';
const v3ContinuityVerifierPath = 'tests/governance/verify-step3-continuity-round-032.mjs';
const v3QualificationRunnerPath = 'simulation/run-qualification-v3.mjs';
const step2ReviewPaths = {
  critic: 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/critic-summary.json',
  finalJudge: 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/final-judge.json',
  completion: 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/completion-evidence.json',
  liveReadback: 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/live-readback.json'
};
const expectedRound032AllowedWrites = [
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  step2CorrectionPath,
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json',
  'quality-reviews/phase-0-governance-recovery/critic-summary-round-003.json',
  'quality-reviews/phase-0-governance-recovery/final-judge-round-002.json',
  'quality-reviews/phase-0-governance-recovery/completion-evidence-round-002.json',
  'quality-reviews/phase-0-governance-recovery/live-readback-round-002.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/acceptance-matrix.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/screen-projection-coverage-ledger.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/numeric-non-impact.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/critic-summary.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/final-judge.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/completion-evidence.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/live-readback.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/step3-continuity-bridge.json',
  'simulation/candidate-v3.json',
  'simulation/candidate-v3.schema.json',
  'simulation/validate-candidate-v3.mjs',
  'simulation/execution-contract-v3.json',
  'simulation/execution-contract-v3.schema.json',
  'simulation/validate-execution-contract-v3.mjs',
  'simulation/run-plan-v3.json',
  'simulation/run-plan-v3.schema.json',
  'simulation/validate-run-plan-v3.mjs',
  'simulation/result-v3.schema.json',
  'simulation/validate-result-v3.mjs',
  v3QualificationRunnerPath,
  'simulation/fixtures/v3/manifest.json',
  'simulation/fixtures/v3/negative.json',
  'simulation/fixtures/v3/validate-fixtures.mjs',
  'simulation/executable-seal-v3.json',
  'simulation/executable-seal-v3.schema.json',
  'simulation/validate-executable-seal-v3.mjs',
  'simulation/verify-step2-v3.mjs',
  v3ProjectionVerifierPath,
  v3ContinuityVerifierPath,
  'tests/governance/verify-current-authority.mjs',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md'
];
const expectedRound032ForbiddenWrites = [
  'CHATGPT_PROJECT_INSTRUCTIONS1.md',
  'DEVELOPMENT_PLAYBOOK.md',
  'PROJECT_SOURCE_MANIFEST.md',
  'MASTER_SPEC.md',
  'FLOORS_1_10_DESIGN.md',
  'canonical/**',
  'simulation/candidate-v2.json',
  'simulation/candidate-v2.schema.json',
  'simulation/validate-candidate-v2.mjs',
  'simulation/execution-contract-v2.json',
  'simulation/execution-contract-v2.schema.json',
  'simulation/validate-execution-contract-v2.mjs',
  'simulation/run-plan-v2.json',
  'simulation/validate-run-plan-v2.mjs',
  'simulation/result-v2.schema.json',
  'simulation/validate-result-v2.mjs',
  'simulation/executable-seal-v2.json',
  'simulation/executable-seal-v2.schema.json',
  'simulation/validate-executable-seal-v2.mjs',
  'simulation/fixtures/v2/**',
  'simulation/engine-v2/**',
  'simulation/lib-v2/**',
  'simulation/migrations/**',
  'quality-reviews/step-1-reseal-round-008/**',
  'quality-reviews/step-2-executable-contract-v2/*',
  'quality-reviews/step-3-large-scale-validation/**',
  'quality-reviews/step-4-twelve-screen-final-mockups/**',
  'index.html',
  'app.js',
  'styles.css',
  'game-core.js',
  'game-data.js',
  'sw.js',
  'runtime/**',
  'step4/s02/**',
  'assets/**',
  'backend/**',
  'payment/**',
  'ads/**',
  '.vercel/**',
  'vercel.json'
];
const expectedEvidenceOnlyWrites = [
  'quality-reviews/phase-0-governance-recovery/critic-summary-round-003.json',
  'quality-reviews/phase-0-governance-recovery/final-judge-round-002.json',
  'quality-reviews/phase-0-governance-recovery/completion-evidence-round-002.json',
  'quality-reviews/phase-0-governance-recovery/live-readback-round-002.json',
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md'
];
const expectedPolicyForbidden = [
  'actual root replacement',
  'gameplay runtime mutation',
  'economy or save mutation',
  'production asset volume generation',
  'backend/payment/ad implementation',
  'sealed Step 1/2/3 mutation',
  'Production alias change',
  'PR operation',
  'physical-iPhone PASS claim'
];
const expectedPolicyBoundaryByControl = {
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json': {
    allowed: 'round 031 allowedWrites only',
    preWriteRequirement: 'Repair Phase 0 closure integrity and complete independent re-judgment before any S02-P1 product write.'
  },
  [step2CorrectionPath]: {
    allowed: 'round 032 allowedWrites only',
    preWriteRequirement: 'Complete the versioned Step 2 screen-projection correction, independent re-judgment, and corrected round 033 Phase 0 closure before any S02-P1 product write.'
  },
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json': {
    allowed: 'round 026 allowedWrites only',
    preWriteRequirement: 'S02-P1 product writes require exact round 026 scope; user visual approval is required before P2 asset production.'
  },
  [s02RepairControlPath]: {
    allowed: 'round 034 allowedWrites only',
    preWriteRequirement: 'Repair only the independently evidenced S02-P1 Golden Master P1 gaps; exact user visual approval is required before P2 asset production.'
  },
  [s02P2ControlPath]: {
    allowed: 'round 035 allowedWrites only',
    preWriteRequirement: 'Produce only the representative S02 P2 production-asset proof authorized by the exact user-decision lock; do not replace runtime or generate asset volume before PASS_ASSET.'
  },
  [s02RevisionControlPath]: {
    allowed: 'round 036 exact user-requested S02 revision paths and round 002 evidence only',
    preWriteRequirement: 'Apply only the concrete S02 Golden Master revisions bound by the exact round 007 user-decision lock, then repeat the complete independent review and Preview readback chain before returning to user review.'
  },
  [s02RevisedP2ControlPath]: {
    allowed: 'round 037 allowedWrites only',
    preWriteRequirement: 'Produce only the representative S02 P2 production-asset proof authorized by the exact revised-target round 008 user-decision lock; do not replace runtime or generate asset volume before PASS_ASSET.'
  },
  [s02SecondRevisionControlPath]: {
    allowed: 'round 038 exact user-requested S02 revision paths and round 003 evidence only',
    preWriteRequirement: 'Apply only the concrete S02 Golden Master revisions bound by immutable round 009, preserve every surviving cumulative acceptance criterion, and complete review round 003 before returning to user review.'
  },
  [s02SecondRevisedP2ControlPath]: {
    allowed: 'round 039 allowedWrites only',
    preWriteRequirement: 'Produce only the representative S02 P2 production-asset proof authorized by exact revised-target round 010; do not replace runtime or generate asset volume before PASS_ASSET.'
  },
  [s02ThirdRevisionControlPath]: {
    allowed: 'round 040 exact user-requested S02 revision paths and round 004 evidence only',
    preWriteRequirement: 'Apply only the concrete S02 Golden Master revisions bound by immutable round 011, preserve every surviving cumulative acceptance criterion, and complete review round 004 before returning to user review.'
  },
  [s02ThirdRevisedP2ControlPath]: {
    allowed: 'round 041 allowedWrites only',
    preWriteRequirement: 'Produce only the representative S02 P2 production-asset proof authorized by exact revised-target round 012; do not replace runtime or generate asset volume before PASS_ASSET.'
  },
  [s02AssetPassControlPath]: {
    allowed: 'round 042 exact governance-extension writes only; no product writes',
    preWriteRequirement: 'The representative S02 P2 asset proof has scoped PASS_ASSET only. Open a new exact change-control before asset volume, runtime integration, Step 4 completion or Production work.'
  },
  [s02AssetVolumeScopeControlPath]: {
    allowed: 'round 043 exact S02 P2 asset-volume scope-contract and review evidence only; no asset bytes or runtime writes',
    preWriteRequirement: 'Freeze and independently review a finite path-by-path S02 P2 asset-volume contract. Only an exact governance activation derived from P0/P1 zero may open its contract-enumerated asset writes.'
  },
  [s02AssetVolumeControlPath]: {
    allowed: 'round 044 exact immutable-contract-derived S02 P2 asset and evidence paths only',
    preWriteRequirement: 'Produce only the exact assets and evidence enumerated by the independently passed round 043 scope contract; runtime integration, gameplay data, Step 4 completion and Production remain blocked.'
  }
};
const expectedClosureRepairCriticCommitWrites = [
  'quality-reviews/phase-0-governance-recovery/closure-integrity-critic-round-001.json',
  'tests/governance/verify-current-authority.mjs',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  '.github/workflows/CURRENT_STATUS.md'
];
const expectedRound032OpeningCommitWrites = [
  step2CorrectionPath,
  'tests/governance/verify-current-authority.mjs',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md',
  'quality-reviews/step-1-canonical-design/active-change-control.json'
];
const expectedStep2PassActivationWrites = [
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md',
  'quality-reviews/step-1-canonical-design/active-change-control.json'
];
const trustedRound031RepairBase = {
  commit: '250ea65f38af7dd0e4dcd9a342bdef464e4b1516',
  tree: '2727b7139029861689ca5494cd4b34ff8d4f1c20'
};
const exactRepairBootstrapPaths = [
  '.github/workflows/CURRENT_STATUS.md',
  '.github/workflows/verify-current-governance.yml',
  'AGENTS.md',
  'PROJECT_HANDOVER.md',
  'QUALITY_GATE.md',
  'README.md',
  'tests/governance/verify-current-authority.mjs'
];
const failedOidcBootstrapAttempt = {
  commit: '3dd49340c8d4403d742a6cf8cc3d3efca7df0527',
  tree: 'd57a8c8d628f9919f93ca3d7be25b9777bdbe486'
};
const oidcBootstrapCorrectionPaths = [
  '.github/workflows/verify-current-governance.yml',
  'tests/governance/verify-current-authority.mjs'
];
function isExactRepairBootstrapCommit(commit) {
  try {
    if (!/^[a-f0-9]{40}$/.test(commit)) return false;
    const expected = [...exactRepairBootstrapPaths].sort();
    const directParent = git(['rev-parse', `${commit}^`]);
    if (directParent === trustedRound031RepairBase.commit) {
      return JSON.stringify(changedPaths(trustedRound031RepairBase.commit, commit).sort()) === JSON.stringify(expected);
    }
    if (directParent !== failedOidcBootstrapAttempt.commit || git(['rev-parse', `${failedOidcBootstrapAttempt.commit}^{tree}`]) !== failedOidcBootstrapAttempt.tree || git(['rev-parse', `${failedOidcBootstrapAttempt.commit}^`]) !== trustedRound031RepairBase.commit) return false;
    if (JSON.stringify(changedPaths(trustedRound031RepairBase.commit, failedOidcBootstrapAttempt.commit).sort()) !== JSON.stringify(expected)) return false;
    if (JSON.stringify(changedPaths(failedOidcBootstrapAttempt.commit, commit).sort()) !== JSON.stringify([...oidcBootstrapCorrectionPaths].sort())) return false;
    return JSON.stringify(changedPaths(trustedRound031RepairBase.commit, commit).sort()) === JSON.stringify(expected);
  } catch {
    return false;
  }
}
// Round 032 opening must replace this null with the immutable blob created for the new control.
const expectedStep2CorrectionControlBlob = '3db99b4a5d4e1c1ca75932b84686541f89917e5a';
// The closure-integrity critic commit must replace this null with the immutable critic blob.
const expectedClosureRepairCriticBlob = '5c706202de5f32fa638e2abdb636a2b89f9b0fe5';
// The closure-integrity critic commit must pin the independently reviewed repair-target sources.
const expectedRepairTargetVerifierBlob = '7bb63b045593f7fa6f5c06ac3673ed90c4f97e76';
const expectedRepairTargetWorkflowBlob = '3812269fb8c287a8d91ecee2fcc2f77ad551ca91';
const expectedRepairTargetCurrentDocBlobs = {"QUALITY_GATE.md":"f65ed017a48c77e67f6dd0dbd8d068c381cfef96","PROJECT_HANDOVER.md":"cdcfbdd92764e9873a045006328dcdfb8b642730",".github/workflows/CURRENT_STATUS.md":"5474ad8ec2cc909ca488c2ee685f388c19cf1903","AGENTS.md":"5fc36abe3525d04d328343d62afda66b75a4af15","README.md":"f90c4d703836f4479388fd81f0367f669ce5c899"};
const expectedPostCriticCurrentDocBlobs = {"QUALITY_GATE.md":"5253b1f5e503efa3dee7282464a64b50d7045cfb","PROJECT_HANDOVER.md":"69926893a6028415dd919168056b51147982e126",".github/workflows/CURRENT_STATUS.md":"2a78777b6798098a10307f712094d2e72141624b","AGENTS.md":"383b34fa094a99b4fb0929f8084d18d57332d4ed","README.md":"b994a822d7a45dc46f964e864828a3f52fbc2bb5"};
// Round 032 opening must pin the complete current Markdown set for correction and closure phases.
const expectedRound032CurrentDocBlobs = {"QUALITY_GATE.md":"adeffd52454921bcbc2a9bb155a353b3e247ba6f","PROJECT_HANDOVER.md":"246bd861145a2f6722aa223379c23d8d1b8a919c",".github/workflows/CURRENT_STATUS.md":"871e1002843556fa90504993f69b587808be0fbf","AGENTS.md":"918f29fcd24965842362f77493fa602cd60d7982","README.md":"3fc4241b0f7c3637c1f79603a28a0bbabe69aed5"};
const expectedRound033CurrentDocBlobs = {"QUALITY_GATE.md":"4897a35857957de9786dca3d16072a26a73eb6c7","PROJECT_HANDOVER.md":"0366189ffd64fae0f58a2e754138aba3b3471eef",".github/workflows/CURRENT_STATUS.md":"40bcd64b1c1b8e7f2c896e2fb65a5e1eebbf040b","AGENTS.md":"f9bf76ada0a98db96f32909ef33abd5247d887b0","README.md":"b368abd8414abaa284eecb5649e0fa0cf64f9bf6"};
// Round 034 opening replaces this null with the immutable reviewed S02 repair-control blob.
const expectedS02RepairControlBlob = null;
const productControl = json('quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json');
const s02RepairFindingIds = [
  'S02-P1-VISIBLE-BOUNDS-001',
  'S02-P1-PARTY-ATLAS-ANCHOR-001',
  'S02-P1-DESIGN-TOKEN-MINIMUM-001',
  'S02-P1-RESPONSIVE-SAFEAREA-001',
  'S02-P1-RESOURCE-RANK-BINDING-001',
  'S02-P1-COMBAT-REWARD-CAUSALITY-001',
  'S02-P1-SUPPORT-CAUSALITY-001',
  'S02-P1-OFFLINE-PARTY-SEMANTICS-001',
  'S02-P1-ASSET-SEPARATION-001',
  'S02-P1-TEST-RESEARCH-COVERAGE-001'
];
const s02ReviewEvidencePaths = {
  critic: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-independent-critic-round-001.json',
  finalJudge: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-final-judge-round-001.json',
  completion: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-completion-evidence-round-001.json',
  deploymentRequest: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-deployment-readback-request-round-001.json',
  deploymentReadback: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-deployment-readback-round-001.json'
};
function s02RevisionEvidencePaths(round) {
  return {
    acceptanceMatrix: `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-acceptance-matrix-round-${round}.json`,
    feasibilityAudit: `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-feasibility-audit-round-${round}.json`,
    critic: `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-independent-critic-round-${round}.json`,
    finalJudge: `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-final-judge-round-${round}.json`,
    completion: `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-completion-evidence-round-${round}.json`,
    deploymentRequest: `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-deployment-readback-request-round-${round}.json`,
    deploymentReadback: `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-deployment-readback-round-${round}.json`
  };
}
const s02RevisionReviewEvidencePaths = s02RevisionEvidencePaths('002');
const s02SecondRevisionReviewEvidencePaths = s02RevisionEvidencePaths('003');
const s02ThirdRevisionReviewEvidencePaths = s02RevisionEvidencePaths('004');
const s02AccessRenewalWritePatterns = round => [
  `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-access-renewal-round-${round}-*-request.json`,
  `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-access-renewal-round-${round}-*-readback.json`
];
const s02VerificationPaths = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  'tests/step4/s02-golden-master-p1-browser.mjs',
  'tests/step4/verify-s02-golden-master-p1.mjs',
  'tests/step4/s02-golden-master-p1-browser-qa.mjs',
  'step4/s02/golden-master-p1/browser-qa/package.json',
  'step4/s02/golden-master-p1/browser-qa/package-lock.json'
];
const expectedS02WorkflowSha256 = 'ae42536a3d30dff057afa189bf15a9ed7caa5fb90d3e375dc4671c8757fbe8dc';
const s02ContentManifestPatterns = [
  'step4/s02/golden-master-p1/**',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-*.json',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-*.md',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-evidence/**',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-browser-evidence/**',
  ...s02VerificationPaths
];
const s02FindingClosureDefinitions = [
  {
    findingId: 'S02-P1-VISIBLE-BOUNDS-001',
    changedPaths: ['step4/s02/golden-master-p1/app.js', 'step4/s02/golden-master-p1/styles.css', 'tests/step4/s02-golden-master-p1-browser-qa.mjs'],
    testAssertions: ['VISIBLE_CAT_ALPHA_HEIGHT_MIN_60', 'VISIBLE_ENEMY_ALPHA_HEIGHT_MIN_80', 'STANDARD_CAT_ALPHA_HEIGHT_MIN_68', 'STANDARD_ENEMY_ALPHA_HEIGHT_MIN_96', 'TRANSPARENT_WRAPPER_EXCLUDED']
  },
  {
    findingId: 'S02-P1-PARTY-ATLAS-ANCHOR-001',
    changedPaths: ['step4/s02/golden-master-p1/app.js', 'step4/s02/golden-master-p1/asset-manifest.json', 'step4/s02/golden-master-p1/assets/party-actions.webp', 'step4/s02/golden-master-p1/assets/party-roster.webp'],
    testAssertions: ['NON_UNIFORM_CHARACTER_SCALE_ABSENT', 'FOOT_AND_HIT_ANCHORS_BOUND', 'DEFEAT_POSE_VISUALLY_DISTINCT']
  },
  {
    findingId: 'S02-P1-DESIGN-TOKEN-MINIMUM-001',
    changedPaths: ['step4/s02/golden-master-p1/styles.css', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-ui-design-system.json', 'tests/step4/verify-s02-golden-master-p1.mjs'],
    testAssertions: ['MEANINGFUL_TEXT_MIN_14', 'METADATA_TEXT_MIN_12', 'PRIMARY_LABEL_MIN_14', 'PRIMARY_CONTROL_HIT_AREA_MIN_48', 'IMPORTANT_CONTROL_HIT_AREA_MIN_44', 'CONTROL_HIT_BOUNDS_NONOVERLAP', 'CONTROL_HIT_BOUNDS_MIN_GAP_8', 'MEANINGFUL_TEXT_CONTRAST_WCAG', 'STATE_SEMANTICS_NOT_COLOR_ONLY', 'DESIGN_TOKEN_DRIFT_ZERO']
  },
  {
    findingId: 'S02-P1-RESPONSIVE-SAFEAREA-001',
    changedPaths: ['step4/s02/golden-master-p1/styles.css', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json', 'tests/step4/s02-golden-master-p1-browser.mjs', 'tests/step4/s02-golden-master-p1-browser-qa.mjs'],
    testAssertions: ['SEVEN_REQUIRED_VIEWPORTS_PASS', 'NONZERO_SAFE_AREA_PASS', 'TEXT_200_PERCENT_NO_LOSS', 'GM04_REFLOW_OR_SCROLL_PASS']
  },
  {
    findingId: 'S02-P1-RESOURCE-RANK-BINDING-001',
    changedPaths: ['step4/s02/golden-master-p1/app.js', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-data-binding-matrix.json', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-information-priority.json'],
    testAssertions: ['UNBOUND_RUBY_REMOVED', 'UNBOUND_RANK_REMOVED_OR_BOUND']
  },
  {
    findingId: 'S02-P1-COMBAT-REWARD-CAUSALITY-001',
    changedPaths: ['step4/s02/golden-master-p1/app.js', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-animation-contract.json', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-player-experience.json'],
    testAssertions: ['KILL_COUNTER_AND_OBJECTIVE_CONSISTENT', 'REWARD_PROVISIONAL_NOT_CONFIRMED', 'ATTACK_HIT_DEFEAT_REWARD_CAUSALITY_VISIBLE']
  },
  {
    findingId: 'S02-P1-SUPPORT-CAUSALITY-001',
    changedPaths: ['step4/s02/golden-master-p1/app.js', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-data-binding-matrix.json', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-player-experience.json'],
    testAssertions: ['SUPPORT_NEXT_BATTLE_CAUSALITY_VISIBLE', 'GM04_SUPPORT_REMAINS_AVAILABLE']
  },
  {
    findingId: 'S02-P1-OFFLINE-PARTY-SEMANTICS-001',
    changedPaths: ['step4/s02/golden-master-p1/index.html', 'step4/s02/golden-master-p1/app.js', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-information-priority.json'],
    testAssertions: ['OFFLINE_RECONCILIATION_ACCESSIBLE', 'PARTY_STATE_LABELS_CANONICAL', 'REVIEW_COPY_EXCLUDED_FROM_GAME_UI']
  },
  {
    findingId: 'S02-P1-ASSET-SEPARATION-001',
    changedPaths: ['step4/s02/golden-master-p1/asset-manifest.json', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-animation-contract.json', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-asset-decomposition.json', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-feasibility-audit.json'],
    testAssertions: ['EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES', 'ANIMATION_ANCHORS_COMPLETE', 'NINE_SLICE_CAPS_AND_MINIMUMS_VALID']
  },
  {
    findingId: 'S02-P1-TEST-RESEARCH-COVERAGE-001',
    changedPaths: ['.github/workflows/verify-step-4-s02-golden-master-p1.yml', 'tests/step4/s02-golden-master-p1-browser.mjs', 'tests/step4/s02-golden-master-p1-browser-qa.mjs', 'tests/step4/verify-s02-golden-master-p1.mjs', 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-competitive-research.md'],
    testAssertions: ['PRIMARY_SOURCE_COMPETITORS_6_TO_10', 'OFFICIAL_SOURCE_CURRENT_LISTING_CHECKED', 'ALL_TEN_FINDING_GROUPS_AUTOMATED']
  }
];
const s02AssertionCriteria = {
  VISIBLE_CAT_ALPHA_HEIGHT_MIN_60: ['GTE', 60, 'css-px'],
  VISIBLE_ENEMY_ALPHA_HEIGHT_MIN_80: ['GTE', 80, 'css-px'],
  STANDARD_CAT_ALPHA_HEIGHT_MIN_68: ['GTE', 68, 'css-px'],
  STANDARD_ENEMY_ALPHA_HEIGHT_MIN_96: ['GTE', 96, 'css-px'],
  TRANSPARENT_WRAPPER_EXCLUDED: ['EQUALS', true, 'boolean'],
  NON_UNIFORM_CHARACTER_SCALE_ABSENT: ['LTE', 0.01, 'ratio-delta'],
  FOOT_AND_HIT_ANCHORS_BOUND: ['EQUALS', true, 'boolean'],
  DEFEAT_POSE_VISUALLY_DISTINCT: ['EQUALS', true, 'boolean'],
  MEANINGFUL_TEXT_MIN_14: ['GTE', 14, 'css-px'],
  METADATA_TEXT_MIN_12: ['GTE', 12, 'css-px'],
  PRIMARY_LABEL_MIN_14: ['GTE', 14, 'css-px'],
  PRIMARY_CONTROL_HIT_AREA_MIN_48: ['GTE', 48, 'css-px'],
  IMPORTANT_CONTROL_HIT_AREA_MIN_44: ['GTE', 44, 'css-px'],
  CONTROL_HIT_BOUNDS_NONOVERLAP: ['EQUALS', true, 'boolean'],
  CONTROL_HIT_BOUNDS_MIN_GAP_8: ['GTE', 8, 'css-px'],
  MEANINGFUL_TEXT_CONTRAST_WCAG: ['EQUALS', true, 'boolean'],
  STATE_SEMANTICS_NOT_COLOR_ONLY: ['EQUALS', true, 'boolean'],
  DESIGN_TOKEN_DRIFT_ZERO: ['EQUALS', 0, 'count'],
  SEVEN_REQUIRED_VIEWPORTS_PASS: ['EQUALS', 7, 'count'],
  NONZERO_SAFE_AREA_PASS: ['EQUALS', true, 'boolean'],
  TEXT_200_PERCENT_NO_LOSS: ['EQUALS', true, 'boolean'],
  GM04_REFLOW_OR_SCROLL_PASS: ['EQUALS', true, 'boolean'],
  UNBOUND_RUBY_REMOVED: ['EQUALS', true, 'boolean'],
  UNBOUND_RANK_REMOVED_OR_BOUND: ['EQUALS', true, 'boolean'],
  KILL_COUNTER_AND_OBJECTIVE_CONSISTENT: ['EQUALS', true, 'boolean'],
  REWARD_PROVISIONAL_NOT_CONFIRMED: ['EQUALS', true, 'boolean'],
  ATTACK_HIT_DEFEAT_REWARD_CAUSALITY_VISIBLE: ['EQUALS', true, 'boolean'],
  SUPPORT_NEXT_BATTLE_CAUSALITY_VISIBLE: ['EQUALS', true, 'boolean'],
  GM04_SUPPORT_REMAINS_AVAILABLE: ['EQUALS', true, 'boolean'],
  OFFLINE_RECONCILIATION_ACCESSIBLE: ['EQUALS', true, 'boolean'],
  PARTY_STATE_LABELS_CANONICAL: ['EQUALS', true, 'boolean'],
  REVIEW_COPY_EXCLUDED_FROM_GAME_UI: ['EQUALS', true, 'boolean'],
  EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES: ['EQUALS', true, 'boolean'],
  ANIMATION_ANCHORS_COMPLETE: ['EQUALS', true, 'boolean'],
  NINE_SLICE_CAPS_AND_MINIMUMS_VALID: ['EQUALS', true, 'boolean'],
  PRIMARY_SOURCE_COMPETITORS_6_TO_10: ['BETWEEN', [6, 10], 'count'],
  OFFICIAL_SOURCE_CURRENT_LISTING_CHECKED: ['EQUALS', true, 'boolean'],
  ALL_TEN_FINDING_GROUPS_AUTOMATED: ['EQUALS', 10, 'count']
};
const s02ExpectedScreenshots = [
  { id: 'GM01', viewport: '390x844', path: 'semantic-evidence/screenshots/GM01-390x844.png', width: 390, height: 844 },
  { id: 'GM02', viewport: '320x667', path: 'semantic-evidence/screenshots/GM02-320x667.png', width: 320, height: 667 },
  { id: 'GM03', viewport: '375x667', path: 'semantic-evidence/screenshots/GM03-375x667.png', width: 375, height: 667 },
  { id: 'GM04', viewport: '320x568', path: 'semantic-evidence/screenshots/GM04-320x568.png', width: 320, height: 568 },
  { id: 'GM05', viewport: '430x932', path: 'semantic-evidence/screenshots/GM05-430x932.png', width: 430, height: 932 },
  { id: 'GM06', viewport: '390x844', path: 'semantic-evidence/screenshots/GM06-390x844.png', width: 390, height: 844 },
  { id: 'GM07', viewport: '390x844', path: 'semantic-evidence/screenshots/GM07-390x844.png', width: 390, height: 844 },
  { id: 'GM08', viewport: '390x844', path: 'semantic-evidence/screenshots/GM08-390x844.png', width: 390, height: 844 },
  { id: 'RV360', viewport: '360x800', path: 'semantic-evidence/screenshots/RV360-360x800.png', width: 360, height: 800 },
  { id: 'RV412', viewport: '412x915', path: 'semantic-evidence/screenshots/RV412-412x915.png', width: 412, height: 915 },
  { id: 'SAFE390', viewport: '390x844-safe-area', path: 'semantic-evidence/screenshots/SAFE390-390x844.png', width: 390, height: 844 },
  { id: 'TEXT200', viewport: '320x568-text-200', path: 'semantic-evidence/screenshots/TEXT200-320x568.png', width: 320, height: 568 },
  { id: 'GM07C320', viewport: '320x568-offline-compact', path: 'semantic-evidence/screenshots/GM07C320-320x568.png', width: 320, height: 568 },
  { id: 'GM07C320TEXT200', viewport: '320x568-offline-compact-text-200-safe-area', path: 'semantic-evidence/screenshots/GM07C320TEXT200-320x568.png', width: 320, height: 568 },
  { id: 'TEXT200SAFE', viewport: '320x568-text-200-safe-area', path: 'semantic-evidence/screenshots/TEXT200SAFE-320x568.png', width: 320, height: 568 }
];
const s02ContentSubjectManifestName = 's02-golden-master-p1-content-subjects.sha256';
const s02ContentAttestationBundleName = 's02-golden-master-p1-content-attestation.sigstore.json';
const s02ContentAttestationReceiptName = 's02-golden-master-p1-content-attestation-receipt.json';
const s02AdmissionAttestationBundleName = 's02-golden-master-p1-admission-attestation.sigstore.json';
const s02AttestationAction = {
  repository: 'actions/attest',
  commit: '508db95dd578ae2727ebd6217d5ba78e4fbda05d',
  version: 'v4.2.1'
};
function s02WorkflowEvidencePackageRoot(evidenceRound) {
  assert(/^(001|002|003|004)$/.test(evidenceRound ?? ''), `S02 evidence package round is outside the bounded reviewed protocol: ${evidenceRound}`);
  return `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-workflow-evidence-round-${evidenceRound}`;
}
function s02WorkflowAdmissionPaths(evidenceRound) {
  assert(/^(001|002|003|004)$/.test(evidenceRound ?? ''), `S02 workflow admission round is outside the bounded reviewed protocol: ${evidenceRound}`);
  const prefix = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-workflow';
  return {
    admission: `${prefix}-authenticated-admission-round-${evidenceRound}.json`,
    readback: `${prefix}-authenticated-admission-readback-round-${evidenceRound}.json`
  };
}
const s02WorkflowLiveAdmissionEnforcementMarker = 'S02_WORKFLOW_LIVE_ADMISSION_REQUIRED_BEFORE_REVIEW';
function s02ExpectedAttestationSubjectEntries(revisionProof) {
  const currentScreenshots = s02ExpectedScreenshots.map(entry => entry.path);
  const revisionBaselineScreenshots = revisionProof
    ? s02ExpectedScreenshots.slice(0, 8).map(entry => `semantic-evidence/revision/before/${entry.path.split('/').at(-1)}`)
    : [];
  const revisionEntries = revisionProof
    ? ['semantic-evidence/revision/browser-before-raw.json', 'semantic-evidence/revision/revision-comparison.json', ...revisionBaselineScreenshots]
    : [];
  return [
    's02-golden-master-p1-result.json',
    'semantic-evidence/static-report.json',
    'semantic-evidence/browser-report.json',
    'semantic-evidence/browser-raw.json',
    ...currentScreenshots,
    ...revisionEntries
  ].sort();
}
function s02ExpectedWorkflowPackageEntries(revisionProof) {
  return [...s02ExpectedAttestationSubjectEntries(revisionProof), s02ContentSubjectManifestName, s02ContentAttestationBundleName, s02ContentAttestationReceiptName, s02AdmissionAttestationBundleName].sort();
}
function s02WorkflowPackageWritePaths(evidenceRound, revision) {
  const packageRoot = s02WorkflowEvidencePackageRoot(evidenceRound);
  return s02ExpectedWorkflowPackageEntries(revision ? {} : null).map(entry => `${packageRoot}/${entry}`);
}
function s02WorkflowPackageEntryCap(entry) {
  return [s02ContentAttestationBundleName, s02AdmissionAttestationBundleName].includes(entry) ? 16 * 1024 * 1024
    : entry.endsWith('.png') ? 8 * 1024 * 1024
      : entry.endsWith('browser-raw.json') || entry.endsWith('browser-before-raw.json') ? 16 * 1024 * 1024
        : entry.endsWith('revision-comparison.json') ? 4 * 1024 * 1024
          : entry.endsWith('-report.json') ? 2 * 1024 * 1024
            : 256 * 1024;
}
function verifyS02PendingWorkflowPackageTail(evidenceRound, revisionProof, label, options = {}) {
  const packageRoot = s02WorkflowEvidencePackageRoot(evidenceRound);
  const expectedSubjects = s02ExpectedAttestationSubjectEntries(revisionProof);
  const expectedEntries = s02ExpectedWorkflowPackageEntries(revisionProof);
  assert(expectedSubjects.length === (revisionProof ? 29 : 19) && expectedEntries.length === (revisionProof ? 33 : 23), `${label}: pending durable package cardinality drifted`);
  const packagePaths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', packageRoot], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const expectedPackagePaths = expectedEntries.map(entry => `${packageRoot}/${entry}`);
  assert(JSON.stringify(packagePaths) === JSON.stringify(expectedPackagePaths), `${label}: pending durable package differs from the exact ${revisionProof ? 33 : 23}-file set`);
  const receiptPath = `${packageRoot}/${s02ContentAttestationReceiptName}`;
  const packageCommit = firstAddCommit(receiptPath);
  assert(packageCommit && git(['rev-parse', 'HEAD']) === packageCommit, `${label}: only the exact package commit may remain as the pending pre-admission branch tail`);
  const packageParent = git(['rev-parse', `${packageCommit}^`]);
  if (options.expectedPackageParent) assert(packageParent === options.expectedPackageParent, `${label}: pending durable package is not the exact child of its reviewed predecessor`);
  assertExactChangedPaths(packageParent, packageCommit, expectedPackagePaths, `${label} pending durable package commit`);
  const sizes = new Map(); let totalBytes = 0;
  for (const [index, file] of expectedPackagePaths.entries()) {
    assert(firstAddCommit(file) === packageCommit, `${label}: pending package file was not atomically first-added: ${file}`);
    assertAddedOnceAndUnchanged(file, packageCommit);
    const size = Number(git(['cat-file', '-s', `HEAD:${file}`]));
    const entry = expectedEntries[index];
    assert(Number.isSafeInteger(size) && size > 0 && size <= s02WorkflowPackageEntryCap(entry), `${label}: pending package entry exceeds its exact cap: ${entry}`);
    sizes.set(entry, size); totalBytes += size;
  }
  assert(totalBytes > 0 && totalBytes <= 120 * 1024 * 1024, `${label}: pending durable package exceeds the reviewed total byte cap`);
  const readEntry = entry => {
    assert(expectedEntries.includes(entry), `${label}: pending package read escaped its exact manifest: ${entry}`);
    const value = bytesAt('HEAD', `${packageRoot}/${entry}`);
    assert(value.length === sizes.get(entry), `${label}: pending package entry length differs from its Git blob size: ${entry}`);
    return value;
  };
  const result = JSON.parse(readEntry('s02-golden-master-p1-result.json').toString('utf8'));
  assert(result?.schemaVersion === 1 && result.artifactId === 'cats-tower-s02-golden-master-p1-workflow-result' && result.repository === '2hg7trp7rv-design/cats_tower' && result.branch === 'kimi' && /^[a-f0-9]{40}$/.test(result.commit ?? '') && result.tree === git(['rev-parse', `${result.commit}^{tree}`]), `${label}: pending package signed-result target or identity is invalid`);
  assert(packageParent === (options.expectedPackageParent ?? result.commit), `${label}: pending package parent differs from its exact content/Acceptance predecessor`);
  if (options.expectedContentCommit) assert(result.commit === options.expectedContentCommit, `${label}: pending revision package does not target the exact accepted content commit`);
  for (const entry of ['semantic-evidence/static-report.json', 'semantic-evidence/browser-report.json', 'semantic-evidence/browser-raw.json', ...(revisionProof ? ['semantic-evidence/revision/browser-before-raw.json', 'semantic-evidence/revision/revision-comparison.json'] : [])]) JSON.parse(readEntry(entry).toString('utf8'));
  for (const screenshot of s02ExpectedScreenshots) assertDecodedPng(readEntry(screenshot.path), screenshot.width, screenshot.height, `${label}: ${screenshot.path}`);
  if (revisionProof) for (const screenshot of s02ExpectedScreenshots.slice(0, 8)) {
    const entry = `semantic-evidence/revision/before/${screenshot.path.split('/').at(-1)}`;
    assertDecodedPng(readEntry(entry), screenshot.width, screenshot.height, `${label}: ${entry}`);
  }
  const expectedSubjectRecords = expectedSubjects.map(subjectPath => ({ path: subjectPath, sha256: `sha256:${createHash('sha256').update(readEntry(subjectPath)).digest('hex')}` }));
  const subjectManifestBytes = readEntry(s02ContentSubjectManifestName);
  const expectedManifestBytes = Buffer.from(expectedSubjectRecords.map(entry => `${entry.sha256.slice('sha256:'.length)}  ${entry.path}\n`).join(''), 'utf8');
  assert(subjectManifestBytes.equals(expectedManifestBytes), `${label}: pending content-subject manifest does not byte-bind the exact subject set`);
  const receipt = JSON.parse(readEntry(s02ContentAttestationReceiptName).toString('utf8'));
  assertExactKeySet(receipt, ['schemaVersion', 'artifactId', 'repository', 'branch', 'commit', 'runId', 'runAttempt', 'evidenceRound', 'action', 'subjects', 'attestation', 'verification'], `${label} pending content-attestation receipt`);
  assertExactKeySet(receipt.subjects, ['count', 'manifestSha256', 'entries'], `${label} pending content-attestation subjects`);
  assertExactKeySet(receipt.attestation, ['id', 'url', 'bundlePath', 'bundleSha256', 'bundleMediaType'], `${label} pending content-attestation identity`);
  assert(receipt.schemaVersion === 1 && receipt.artifactId === `cats-tower-s02-golden-master-p1-content-attestation-receipt-round-${evidenceRound}` && receipt.repository === '2hg7trp7rv-design/cats_tower' && receipt.branch === 'kimi' && receipt.commit === result.commit && receipt.runId === result.runId && receipt.runAttempt === result.runAttempt && receipt.evidenceRound === evidenceRound, `${label}: pending content-attestation receipt identity, target or run mismatch`);
  assert(JSON.stringify(receipt.action) === JSON.stringify(s02AttestationAction) && receipt.subjects.count === expectedSubjects.length && JSON.stringify(receipt.subjects.entries) === JSON.stringify(expectedSubjectRecords) && receipt.subjects.manifestSha256 === `sha256:${createHash('sha256').update(subjectManifestBytes).digest('hex')}`, `${label}: pending content-attestation action or subject binding mismatch`);
  const contentBundle = readEntry(s02ContentAttestationBundleName); const admissionBundle = readEntry(s02AdmissionAttestationBundleName);
  assert(receipt.attestation.bundlePath === s02ContentAttestationBundleName && receipt.attestation.bundleSha256 === `sha256:${createHash('sha256').update(contentBundle).digest('hex')}` && receipt.attestation.bundleMediaType === 'application/vnd.dev.sigstore.bundle.v0.3+json', `${label}: pending content-attestation bundle binding mismatch`);
  for (const [entry, bytes] of [[s02ContentAttestationBundleName, contentBundle], [s02AdmissionAttestationBundleName, admissionBundle]]) {
    const bundle = JSON.parse(bytes.toString('utf8'));
    assert(bundle && typeof bundle === 'object' && bundle.mediaType === 'application/vnd.dev.sigstore.bundle.v0.3+json' && bundle.verificationMaterial && bundle.dsseEnvelope, `${label}: pending ${entry} is not a v0.3 DSSE bundle`);
  }
  return { packageRoot, packageCommit, packageParent, targetCommit: result.commit, targetTree: result.tree };
}
function verifyS02PersistedWorkflowPackage(evidence, evidenceRound, revisionProof, label, options = {}) {
  const requireAdmissionReadback = options.requireAdmissionReadback ?? true;
  const packageRoot = s02WorkflowEvidencePackageRoot(evidenceRound);
  const admissionPaths = s02WorkflowAdmissionPaths(evidenceRound);
  const expectedSubjects = s02ExpectedAttestationSubjectEntries(revisionProof);
  const expectedEntries = s02ExpectedWorkflowPackageEntries(revisionProof);
  assert(expectedSubjects.length === (revisionProof ? 29 : 19) && expectedEntries.length === (revisionProof ? 33 : 23), `${label}: durable S02 package cardinality contract drifted`);
  const treeOutput = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', packageRoot], { cwd: root, encoding: 'utf8' });
  const packagePaths = treeOutput.split('\0').filter(Boolean);
  const expectedPackagePaths = expectedEntries.map(entry => `${packageRoot}/${entry}`);
  assert(JSON.stringify(packagePaths) === JSON.stringify(expectedPackagePaths), `${label}: durable S02 package differs from the exact ${revisionProof ? 33 : 23}-file set`);
  const receiptPath = `${packageRoot}/${s02ContentAttestationReceiptName}`;
  const packageCommit = firstAddCommit(receiptPath);
  const packageParent = revisionProof ? firstAddCommit(s02RevisionEvidencePaths(evidenceRound).acceptanceMatrix) : evidence.commit;
  assert(packageCommit && packageParent && git(['rev-parse', `${packageCommit}^`]) === packageParent, `${label}: durable S02 package is not the exact child of its content/Acceptance predecessor`);
  assertExactChangedPaths(packageParent, packageCommit, expectedPackagePaths, `${label} durable S02 package commit`);
  assert(exists(admissionPaths.admission), `${label}: durable S02 package lacks its required subsequent authenticated-admission record`);
  const admissionCommit = firstAddCommit(admissionPaths.admission);
  assertExactSingleParent(admissionCommit, packageCommit, `${label} authenticated S02 package admission`);
  assertExactChangedPaths(packageCommit, admissionCommit, [admissionPaths.admission], `${label} authenticated S02 package admission`);
  assertAddedOnceAndUnchanged(admissionPaths.admission, admissionCommit);
  const readbackPresent = exists(admissionPaths.readback);
  assert(!requireAdmissionReadback || readbackPresent, `${label}: critic/feasibility review is blocked until authenticated-admission readback is persisted`);
  const admissionReadbackCommit = readbackPresent ? firstAddCommit(admissionPaths.readback) : null;
  if (readbackPresent) {
    assertExactSingleParent(admissionReadbackCommit, admissionCommit, `${label} authenticated S02 admission readback`);
    assertExactChangedPaths(admissionCommit, admissionReadbackCommit, [admissionPaths.readback], `${label} authenticated S02 admission readback`);
    assertAddedOnceAndUnchanged(admissionPaths.readback, admissionReadbackCommit);
  }
  let totalBytes = 0;
  const sizes = new Map();
  for (const file of expectedPackagePaths) {
    assert(firstAddCommit(file) === packageCommit, `${label}: durable S02 package file was not atomically first-added: ${file}`);
    assertAddedOnceAndUnchanged(file, packageCommit);
    const size = Number(git(['cat-file', '-s', `HEAD:${file}`]));
    const entry = file.slice(packageRoot.length + 1);
    const cap = s02WorkflowPackageEntryCap(entry);
    assert(Number.isSafeInteger(size) && size > 0 && size <= cap, `${label}: durable S02 package entry exceeds its exact cap: ${entry}`);
    sizes.set(entry, size);
    totalBytes += size;
  }
  assert(totalBytes > 0 && totalBytes <= 120 * 1024 * 1024, `${label}: durable S02 package exceeds the reviewed total byte cap`);
  const readEntry = entry => {
    assert(expectedEntries.includes(entry), `${label}: attempted to read a non-manifest durable S02 package entry: ${entry}`);
    const value = bytesAt('HEAD', `${packageRoot}/${entry}`);
    assert(value.length === sizes.get(entry), `${label}: durable S02 package entry length differs from its Git blob size: ${entry}`);
    return value;
  };
  const expectedPackageRecords = expectedEntries.map(entry => ({
    path: entry,
    bytes: sizes.get(entry),
    sha256: `sha256:${createHash('sha256').update(readEntry(entry)).digest('hex')}`
  }));
  const admission = json(admissionPaths.admission);
  assertExactKeySet(admission, ['schemaVersion', 'artifactId', 'repository', 'branch', 'evidenceRound', 'workflowTarget', 'workflow', 'package', 'archive', 'verification', 'verdict'], `${label} authenticated S02 workflow admission`);
  assertExactKeySet(admission.workflowTarget, ['commit', 'tree'], `${label} authenticated S02 workflow target`);
  assertExactKeySet(admission.package, ['root', 'commit', 'tree', 'entries', 'fileSetSha256'], `${label} authenticated S02 package`);
  assertExactKeySet(admission.archive, ['artifactId', 'artifactName', 'artifactDigest', 'sizeInBytes'], `${label} authenticated S02 archive`);
  assertExactKeySet(admission.verification, ['githubApiAssociation', 'exactZipDigest', 'exactEntrySet', 'exactEntryBytes', 'contentAttestation', 'admissionAttestation', 'bearerTokenPersisted', 'verifiedAt'], `${label} authenticated S02 verification`);
  assertWorkflowEvidenceKeys(admission.workflow, `${label} authenticated S02 source workflow`, true);
  assert(admission.schemaVersion === 1 && admission.artifactId === `cats-tower-s02-golden-master-p1-workflow-authenticated-admission-round-${evidenceRound}` && admission.repository === '2hg7trp7rv-design/cats_tower' && admission.branch === 'kimi' && admission.evidenceRound === evidenceRound, `${label}: authenticated S02 admission identity mismatch`);
  assert(JSON.stringify(admission.workflowTarget) === JSON.stringify({ commit: evidence.commit, tree: evidence.tree }) && JSON.stringify(admission.workflow) === JSON.stringify(evidence), `${label}: authenticated S02 admission does not bind the exact source workflow target/evidence`);
  assert(JSON.stringify(admission.package) === JSON.stringify({ root: packageRoot, commit: packageCommit, tree: git(['rev-parse', `${packageCommit}^{tree}`]), entries: expectedPackageRecords, fileSetSha256: `sha256:${sha256Canonical(expectedPackageRecords)}` }), `${label}: authenticated S02 admission does not bind the exact persisted package commit/tree/file set`);
  assert(JSON.stringify(admission.archive) === JSON.stringify({ artifactId: evidence.artifactId, artifactName: evidence.artifactName, artifactDigest: evidence.artifactDigest, sizeInBytes: admission.archive.sizeInBytes }) && Number.isSafeInteger(admission.archive.sizeInBytes) && admission.archive.sizeInBytes > 0 && admission.archive.sizeInBytes <= 128 * 1024 * 1024, `${label}: authenticated S02 admission archive identity or size is invalid`);
  assert(JSON.stringify(admission.verification) === JSON.stringify({ githubApiAssociation: true, exactZipDigest: true, exactEntrySet: true, exactEntryBytes: true, contentAttestation: true, admissionAttestation: true, bearerTokenPersisted: false, verifiedAt: admission.verification.verifiedAt }) && isCanonicalIsoInstant(admission.verification.verifiedAt), `${label}: authenticated S02 admission verification is incomplete or persists a bearer token`);
  assert(admission.verdict === 'PASS_S02_WORKFLOW_PACKAGE_LIVE_AUTHENTICATED_ADMISSION', `${label}: authenticated S02 admission verdict mismatch`);
  let admissionReadback = null;
  if (readbackPresent) {
    admissionReadback = json(admissionPaths.readback);
    assertExactKeySet(admissionReadback, ['schemaVersion', 'artifactId', 'repository', 'branch', 'evidenceRound', 'admission', 'workflow', 'verification', 'verdict'], `${label} authenticated S02 admission readback`);
    assertExactKeySet(admissionReadback.admission, ['path', 'blob', 'commit', 'tree'], `${label} authenticated S02 admission binding`);
    assertExactKeySet(admissionReadback.verification, ['runApiVerified', 'jobApiVerified', 'verifierStepVerified', 'liveArchiveAdmissionEnforced', 'bearerTokenPersisted'], `${label} authenticated S02 admission-readback verification`);
    assertWorkflowEvidenceKeys(admissionReadback.workflow, `${label} authenticated S02 admission-readback workflow`, true);
    assert(admissionReadback.schemaVersion === 1 && admissionReadback.artifactId === `cats-tower-s02-golden-master-p1-workflow-authenticated-admission-readback-round-${evidenceRound}` && admissionReadback.repository === '2hg7trp7rv-design/cats_tower' && admissionReadback.branch === 'kimi' && admissionReadback.evidenceRound === evidenceRound, `${label}: authenticated S02 admission-readback identity mismatch`);
    assert(JSON.stringify(admissionReadback.admission) === JSON.stringify({ path: admissionPaths.admission, blob: git(['rev-parse', `HEAD:${admissionPaths.admission}`]), commit: admissionCommit, tree: git(['rev-parse', `${admissionCommit}^{tree}`]) }), `${label}: admission readback does not bind the immutable admission record commit/tree/blob`);
    assert(admissionReadback.workflow.commit === admissionCommit && admissionReadback.workflow.tree === admissionReadback.admission.tree, `${label}: admission-readback workflow does not target the exact admission commit`);
    assert(JSON.stringify(admissionReadback.verification) === JSON.stringify({ runApiVerified: true, jobApiVerified: true, verifierStepVerified: true, liveArchiveAdmissionEnforced: true, bearerTokenPersisted: false }) && admissionReadback.verdict === 'PASS_S02_WORKFLOW_PACKAGE_AUTHENTICATED_ADMISSION_READBACK', `${label}: admission readback verification/verdict is incomplete or unsafe`);
    verifyDurableActionsOidc(admissionReadback.workflow, `${label} authenticated S02 admission readback`);
  }
  const subjectManifestBytes = readEntry(s02ContentSubjectManifestName);
  const receiptBytes = readEntry(s02ContentAttestationReceiptName);
  const bundleBytes = readEntry(s02ContentAttestationBundleName);
  const admissionBundleBytes = readEntry(s02AdmissionAttestationBundleName);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assertExactKeySet(receipt, ['schemaVersion', 'artifactId', 'repository', 'branch', 'commit', 'runId', 'runAttempt', 'evidenceRound', 'action', 'subjects', 'attestation', 'verification'], `${label} S02 attestation receipt`);
  assertExactKeySet(receipt.action, ['repository', 'commit', 'version'], `${label} S02 attestation action`);
  assertExactKeySet(receipt.subjects, ['count', 'manifestSha256', 'entries'], `${label} S02 attestation subjects`);
  assertExactKeySet(receipt.attestation, ['id', 'url', 'bundlePath', 'bundleSha256', 'bundleMediaType'], `${label} S02 attestation identity`);
  assertExactKeySet(receipt.verification, ['githubApiAssociation', 'liveApiVerified', 'offlineSigstoreBundleVerified', 'bearerTokenPersisted'], `${label} S02 attestation verification`);
  assert(receipt.schemaVersion === 1 && receipt.artifactId === `cats-tower-s02-golden-master-p1-content-attestation-receipt-round-${evidenceRound}` && receipt.repository === '2hg7trp7rv-design/cats_tower' && receipt.branch === 'kimi', `${label}: S02 attestation receipt identity mismatch`);
  assert(receipt.commit === evidence.commit && receipt.runId === evidence.runId && receipt.runAttempt === evidence.runAttempt && receipt.evidenceRound === evidenceRound, `${label}: S02 attestation receipt target or run mismatch`);
  assert(JSON.stringify(receipt.action) === JSON.stringify(s02AttestationAction), `${label}: S02 attestation action is not the exact fixed-SHA reviewed action`);
  assert(receipt.subjects.count === expectedSubjects.length && Array.isArray(receipt.subjects.entries) && receipt.subjects.entries.length === expectedSubjects.length, `${label}: S02 attestation subject count mismatch`);
  const expectedSubjectRecords = expectedSubjects.map(subjectPath => ({
    path: subjectPath,
    sha256: `sha256:${createHash('sha256').update(readEntry(subjectPath)).digest('hex')}`
  }));
  assert(JSON.stringify(receipt.subjects.entries) === JSON.stringify(expectedSubjectRecords), `${label}: S02 attestation subjects do not byte-bind the exact durable package`);
  const checksumManifest = Buffer.from(expectedSubjectRecords.map(entry => `${entry.sha256.slice('sha256:'.length)}  ${entry.path}\n`).join(''), 'utf8');
  assert(subjectManifestBytes.equals(checksumManifest) && receipt.subjects.manifestSha256 === `sha256:${createHash('sha256').update(subjectManifestBytes).digest('hex')}`, `${label}: S02 content-subject manifest bytes or digest mismatch`);
  assert(/^[1-9][0-9]*$/.test(receipt.attestation.id ?? '') && receipt.attestation.bundlePath === s02ContentAttestationBundleName && receipt.attestation.bundleSha256 === `sha256:${createHash('sha256').update(bundleBytes).digest('hex')}` && receipt.attestation.bundleMediaType === 'application/vnd.dev.sigstore.bundle.v0.3+json', `${label}: S02 content-attestation ID, bundle path, media type or digest mismatch`);
  let attestationUrl;
  try { attestationUrl = new URL(receipt.attestation.url); } catch { assert(false, `${label}: S02 attestation URL is invalid`); }
  assert(attestationUrl.protocol === 'https:' && attestationUrl.hostname === 'github.com' && attestationUrl.username === '' && attestationUrl.password === '' && attestationUrl.pathname === `/2hg7trp7rv-design/cats_tower/attestations/${receipt.attestation.id}` && attestationUrl.search === '' && attestationUrl.hash === '', `${label}: S02 attestation URL is not the exact credential-free GitHub identity URL`);
  const parsedBundle = JSON.parse(bundleBytes.toString('utf8'));
  assert(parsedBundle && typeof parsedBundle === 'object' && parsedBundle.mediaType === receipt.attestation.bundleMediaType && parsedBundle.verificationMaterial && parsedBundle.dsseEnvelope, `${label}: S02 Sigstore bundle is not the exact v0.3 DSSE bundle shape`);
  const parsedAdmissionBundle = JSON.parse(admissionBundleBytes.toString('utf8'));
  assert(parsedAdmissionBundle && typeof parsedAdmissionBundle === 'object' && parsedAdmissionBundle.mediaType === 'application/vnd.dev.sigstore.bundle.v0.3+json' && parsedAdmissionBundle.verificationMaterial && parsedAdmissionBundle.dsseEnvelope, `${label}: S02 admission Sigstore bundle is not the exact v0.3 DSSE bundle shape`);
  assert(JSON.stringify(receipt.verification) === JSON.stringify({ githubApiAssociation: true, liveApiVerified: true, offlineSigstoreBundleVerified: true, bearerTokenPersisted: false }), `${label}: S02 attestation receipt does not attest both live and offline verification without bearer persistence`);
  if (requireLiveActions) {
    assert(typeof process.env.GH_TOKEN === 'string' && process.env.GH_TOKEN.length >= 1, `${label}: live S02 attestation verification requires a step-scoped GH_TOKEN`);
    const certificateIdentity = 'https://github.com/2hg7trp7rv-design/cats_tower/.github/workflows/verify-step-4-s02-golden-master-p1.yml@refs/heads/kimi';
    const commonArgs = ['--repo', '2hg7trp7rv-design/cats_tower', '--cert-identity', certificateIdentity, '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com', '--deny-self-hosted-runners', '--predicate-type', 'https://slsa.dev/provenance/v1', '--source-digest', evidence.commit, '--source-ref', 'refs/heads/kimi'];
    for (const subjectPath of expectedSubjects) execFileSync('gh', ['attestation', 'verify', rel(`${packageRoot}/${subjectPath}`), '--bundle', rel(`${packageRoot}/${s02ContentAttestationBundleName}`), ...commonArgs], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    for (const admissionSubject of [s02ContentSubjectManifestName, s02ContentAttestationBundleName, s02ContentAttestationReceiptName]) execFileSync('gh', ['attestation', 'verify', rel(`${packageRoot}/${admissionSubject}`), '--bundle', rel(`${packageRoot}/${s02AdmissionAttestationBundleName}`), ...commonArgs], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    execFileSync('gh', ['attestation', 'verify', rel(`${packageRoot}/${s02ContentAttestationReceiptName}`), ...commonArgs], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    execFileSync('gh', ['attestation', 'verify', rel(`${packageRoot}/s02-golden-master-p1-result.json`), ...commonArgs], { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 4 * 1024 * 1024 });
    if (admissionReadback) {
      const workflow = admissionReadback.workflow;
      assert(workflow.artifactName === `phase0-current-governance-${workflow.commit}-${workflow.runId}-${workflow.runAttempt}` && /^sha256:[a-f0-9]{64}$/.test(workflow.artifactDigest ?? ''), `${label}: admission-readback governance artifact identity is invalid`);
      const governanceRun = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/runs/${workflow.runId}/attempts/${workflow.runAttempt}`);
      assert(governanceRun.id === workflow.runId && governanceRun.run_attempt === workflow.runAttempt && governanceRun.head_sha === admissionCommit && governanceRun.head_branch === 'kimi' && governanceRun.status === 'completed' && governanceRun.conclusion === 'success' && ['push', 'workflow_dispatch'].includes(governanceRun.event), `${label}: admission-readback governance run did not successfully target the exact admission commit`);
      assert(governanceRun.repository?.id === 1331488679 && governanceRun.repository?.owner?.id === 245031448 && governanceRun.head_repository?.id === 1331488679 && governanceRun.head_repository?.owner?.id === 245031448 && (governanceRun.path ?? '').split('@')[0] === '.github/workflows/verify-current-governance.yml', `${label}: admission-readback governance run repository/workflow identity mismatch`);
      const governanceJobs = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/runs/${workflow.runId}/attempts/${workflow.runAttempt}/jobs?per_page=100`);
      assert(governanceJobs.total_count === 2 && governanceJobs.jobs?.length === 2 && governanceJobs.jobs.some(job => job.name === 'semantic-verification-no-credentials' && job.status === 'completed' && job.conclusion === 'success'), `${label}: admission-readback run lacks its exact successful uncredentialed semantic job`);
      const governanceJob = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/jobs/${workflow.jobId}`);
      assert(governanceJob.run_id === workflow.runId && governanceJob.run_attempt === workflow.runAttempt && governanceJob.head_sha === admissionCommit && governanceJob.head_branch === 'kimi' && governanceJob.name === 'current-authority' && governanceJob.status === 'completed' && governanceJob.conclusion === 'success', `${label}: admission-readback governance job identity or conclusion mismatch`);
      const verifierSteps = governanceJob.steps?.filter(step => step.name === 'Verify current authority, mirrors, source replacement and deletion boundary') ?? [];
      assert(verifierSteps.length === 1 && verifierSteps[0].status === 'completed' && verifierSteps[0].conclusion === 'success', `${label}: admission-readback run did not successfully execute the live-admission-enforcing verifier step`);
      assert(textAt(admissionCommit, 'tests/governance/verify-current-authority.mjs').includes(s02WorkflowLiveAdmissionEnforcementMarker), `${label}: admission commit verifier lacks the immutable live-admission enforcement marker`);
    }
    let artifact = null;
    try {
      artifact = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/artifacts/${evidence.artifactId}`);
    } catch (error) {
      const detail = `${error?.stderr ?? ''}\n${error?.message ?? ''}`;
      assert(admissionReadback && /(?:HTTP\s+(?:404|410)|Not Found|Gone)/i.test(detail), `${label}: initial S02 package admission requires the live exact Actions artifact; retention fallback is allowed only after its successful governance admission readback`);
    }
    if (artifact) {
      assert(artifact.id === evidence.artifactId && artifact.name === evidence.artifactName && artifact.digest === evidence.artifactDigest, `${label}: live S02 artifact identity or digest mismatch`);
      assert(artifact.workflow_run?.id === evidence.runId && artifact.workflow_run?.head_sha === evidence.commit && artifact.workflow_run?.head_branch === 'kimi', `${label}: live S02 artifact workflow binding mismatch`);
      assert(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes === admission.archive.sizeInBytes && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 128 * 1024 * 1024, `${label}: live S02 artifact size is invalid or differs from its authenticated admission`);
      if (artifact.expired === false) {
        const zip = ghApi(`/repos/2hg7trp7rv-design/cats_tower/actions/artifacts/${evidence.artifactId}/zip`, { binary: true, maxBuffer: artifact.size_in_bytes + 1024 * 1024 });
        assert(`sha256:${createHash('sha256').update(zip).digest('hex')}` === evidence.artifactDigest, `${label}: downloaded S02 artifact digest mismatch`);
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cats-tower-s02-artifact-'));
        const zipPath = path.join(tempDirectory, 'artifact.zip');
        try {
          fs.writeFileSync(zipPath, zip);
          const archiveEntries = execFileSync('unzip', ['-Z1', zipPath], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n').filter(Boolean).sort();
          assert(JSON.stringify(archiveEntries) === JSON.stringify(expectedEntries), `${label}: live S02 archive entry set differs from the durable package`);
          for (const entry of expectedEntries) {
            const archived = execFileSync('unzip', ['-p', zipPath, entry], { cwd: root, encoding: null, maxBuffer: sizes.get(entry) + 1024 });
            assert(archived.equals(readEntry(entry)), `${label}: live S02 archive byte differs from its durable package: ${entry}`);
          }
          const verifiedAt = Date.parse(admission.verification.verifiedAt);
          assert(verifiedAt >= Date.parse(artifact.created_at) && verifiedAt <= Date.parse(git(['show', '-s', '--format=%cI', admissionCommit])), `${label}: authenticated admission time is outside artifact creation/admission-commit order`);
        } finally {
          fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
      } else {
        assert(admissionReadback && artifact.expired === true, `${label}: initial admission cannot use an expired S02 Actions artifact`);
      }
    }
  }
  return { packageRoot, packageCommit, admissionCommit, admissionReadbackCommit, expectedEntries, expectedSubjects, readEntry, receipt, admission, admissionReadback };
}
function deriveS02ContentManifest(targetCommit, options = {}) {
  const {
    deltaBaseCommit = s02RepairOpeningCommit,
    requireFullRepairDelta = true,
    exactRevisionPaths = null
  } = options;
  const numberedReviewEvidence = new Set([
    ...Object.values(s02ReviewEvidencePaths),
    ...Object.values(s02RevisionReviewEvidencePaths),
    ...Object.values(s02SecondRevisionReviewEvidencePaths),
    ...Object.values(s02ThirdRevisionReviewEvidencePaths)
  ]);
  const treeOutput = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', targetCommit], { cwd: root, encoding: 'utf8' });
  const paths = treeOutput.split('\0').filter(Boolean)
    .filter(file => s02ContentManifestPatterns.some(pattern => globMatch(pattern, file)))
    .filter(file => !numberedReviewEvidence.has(file))
    .filter(file => !/^quality-reviews\/step-4-twelve-screen-final-mockups\/s02-golden-master-p1-access-renewal-round-00[1-4]-\d{3,}-(?:request|readback)\.json$/.test(file))
    .sort();
  assert(paths.length >= 16 && paths.length <= 400, 'S02 reviewed content manifest has an implausible path count');
  const requiredRepairedPaths = [
    'step4/s02/golden-master-p1/index.html',
    'step4/s02/golden-master-p1/app.js',
    'step4/s02/golden-master-p1/styles.css',
    ...s02VerificationPaths
  ];
  for (const required of requiredRepairedPaths) assert(paths.includes(required), `S02 reviewed content manifest omits required implementation or verifier: ${required}`);
  const repairDelta = changedPaths(deltaBaseCommit, targetCommit)
    .filter(file => s02ContentManifestPatterns.some(pattern => globMatch(pattern, file)))
    .filter(file => !numberedReviewEvidence.has(file));
  if (requireFullRepairDelta) {
    assert(repairDelta.length >= 16, 'S02 critic target does not contain a substantive production-quality repair delta');
    for (const required of requiredRepairedPaths) assert(repairDelta.includes(required), `S02 repair delta did not update required implementation or verifier: ${required}`);
    for (const definition of s02FindingClosureDefinitions) {
      for (const required of definition.changedPaths) assert(repairDelta.includes(required), `${definition.findingId}: required repair path did not change from the round 034 opening: ${required}`);
    }
  } else {
    assert(Array.isArray(exactRevisionPaths) && exactRevisionPaths.length > 0, 'S02 revision target lacks an exact user-requested path set');
    assert(JSON.stringify(repairDelta) === JSON.stringify([...exactRevisionPaths].sort()), 'S02 revision content commit differs from the exact user-requested path set');
    for (const file of exactRevisionPaths) {
      const entry = git(['ls-tree', targetCommit, '--', file]).split(/\s+/);
      assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `S02 revision target deleted or made a non-regular file: ${file}`);
      assert(paths.includes(file), `S02 revision target path is outside the critic-bound content manifest: ${file}`);
    }
  }
  let totalBytes = 0;
  const manifest = paths.map(file => {
    const entry = git(['ls-tree', targetCommit, '--', file]).split(/\s+/);
    assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `S02 target contains a deleted, symbolic or non-regular governed path: ${file}`);
    const bytes = Number(git(['cat-file', '-s', `${targetCommit}:${file}`]));
    assert(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 10 * 1024 * 1024, `S02 target file exceeds reviewed size: ${file}`);
    totalBytes += bytes;
    return { path: file, mode: '100644', blob: entry[2], bytes };
  });
  assert(totalBytes > 0 && totalBytes <= 80 * 1024 * 1024, 'S02 reviewed content manifest exceeds the total byte cap');
  return manifest;
}

function deriveS02ServedFileManifest(targetCommit, manifestPath, route) {
  const prefix = 'step4/s02/golden-master-p1/';
  assert(manifestPath === `${prefix}review-manifest.json` && route === '/step4/s02/golden-master-p1/', 'S02 served-file manifest target is not the fixed review route');
  const assetManifestPath = `${prefix}asset-manifest.json`;
  const assetManifest = jsonAt(targetCommit, assetManifestPath);
  assert(Array.isArray(assetManifest.assets) && assetManifest.assets.length >= 1 && assetManifest.assets.length <= 80, 'S02 review asset manifest has an invalid asset count');
  const assetPaths = assetManifest.assets.map(asset => asset?.path);
  assert(assetPaths.every(file => /^assets\/[a-z0-9][a-z0-9._/-]*\.(?:webp|png|svg)$/i.test(file ?? '')) && new Set(assetPaths).size === assetPaths.length, 'S02 review asset manifest contains an invalid or duplicate route asset path');
  const routeTargets = [
    `${prefix}index.html`,
    `${prefix}styles.css`,
    `${prefix}app.js`,
    `${prefix}golden-master-spec.json`,
    assetManifestPath,
    ...assetPaths.map(file => `${prefix}${file}`)
  ].sort();
  const documentTargets = [
    's02-golden-master-p1-acceptance-matrix-round-001.json',
    's02-golden-master-p1-competitive-research.md',
    's02-golden-master-p1-player-experience.json',
    's02-golden-master-p1-information-priority.json',
    's02-golden-master-p1-art-direction.json',
    's02-golden-master-p1-ui-design-system.json',
    's02-golden-master-p1-asset-decomposition.json',
    's02-golden-master-p1-animation-contract.json',
    's02-golden-master-p1-data-binding-matrix.json',
    's02-golden-master-p1-responsive-contract.json',
    's02-golden-master-p1-feasibility-audit.json'
  ].map(file => `quality-reviews/step-4-twelve-screen-final-mockups/${file}`).sort();
  const record = file => {
    const entry = git(['ls-tree', targetCommit, '--', file]).split(/\s+/);
    assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `S02 review manifest target is not a regular 100644 blob: ${file}`);
    const bytes = Number(git(['cat-file', '-s', `${targetCommit}:${file}`]));
    assert(Number.isSafeInteger(bytes) && bytes > 0 && bytes <= 10 * 1024 * 1024, `S02 review manifest target size is invalid: ${file}`);
    const content = bytesAt(targetCommit, file);
    return { path: file, bytes, sha256: createHash('sha256').update(content).digest('hex'), gitBlob: entry[2] };
  };
  const routeFiles = routeTargets.map(record);
  const documents = documentTargets.map(record);
  let totalBytes = 0;
  for (const entry of [...routeFiles, ...documents]) totalBytes += entry.bytes;
  assert(totalBytes <= 80 * 1024 * 1024, 'S02 review-manifest route/document graph exceeds the total byte cap');
  return {
    schemaVersion: 2,
    artifactId: 'cats-tower-s02-golden-master-p1-review-manifest',
    purpose: 'DESIGN_REVIEW_ONLY_NOT_RUNTIME',
    repository: '2hg7trp7rv-design/cats_tower',
    branch: 'kimi',
    route,
    goldenMasters: ['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08'],
    requiredViewports: ['320x568', '320x667', '375x667', '360x800', '390x844', '412x915', '430x932'],
    documents,
    routeFiles
  };
}
const expectedS02RepairAllowedWrites = [
  s02RepairControlPath,
  s02P2ControlPath,
  s02UserDecisionLockPath,
  s02RevisionControlPath,
  s02RevisionDecisionLockPath,
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md',
  'step4/s02/golden-master-p1/**',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-*.json',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-*.md',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-evidence/**',
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-browser-evidence/**',
  ...s02WorkflowPackageWritePaths('001', false),
  'tests/step4/s02-golden-master-p1-browser.mjs',
  'tests/step4/verify-s02-golden-master-p1.mjs',
  'tests/step4/s02-golden-master-p1-browser-qa.mjs',
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml'
  , ...s02AccessRenewalWritePatterns('001')
];
const expectedS02RepairForbiddenWrites = [
  'CHATGPT_PROJECT_INSTRUCTIONS1.md',
  'DEVELOPMENT_PLAYBOOK.md',
  'PROJECT_SOURCE_MANIFEST.md',
  'MASTER_SPEC.md',
  'FLOORS_1_10_DESIGN.md',
  'canonical/**',
  'simulation/candidate-v2.json',
  'simulation/candidate-v2.schema.json',
  'simulation/execution-contract-v2.json',
  'simulation/run-plan-v2.json',
  'simulation/executable-seal-v2.json',
  'simulation/engine-v2/**',
  'simulation/candidate-v3.json',
  'simulation/execution-contract-v3.json',
  'simulation/run-plan-v3.json',
  'simulation/executable-seal-v3.json',
  'quality-reviews/step-1-reseal-round-008/**',
  'quality-reviews/step-2-executable-contract-v2/**',
  'quality-reviews/step-3-large-scale-validation/**',
  'index.html',
  'app.js',
  'styles.css',
  'game-core.js',
  'game-data.js',
  'sw.js',
  'runtime/**',
  'step4/s02/index.html',
  'step4/s02/app.js',
  'step4/s02/root-entry.js',
  'step4/s02/*.css',
  'step4/s02/assets/**',
  'assets/**',
  'backend/**',
  'payment/**',
  'ads/**',
  '.vercel/**',
  'vercel.json',
  '.github/workflows/verify-current-governance.yml',
  'tests/governance/verify-current-authority.mjs'
];
const expectedS02RepairOpeningCommitWrites = [
  s02RepairControlPath,
  'tests/governance/verify-current-authority.mjs',
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md'
];
const expectedS02ReadyActivationWrites = [
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md'
];
const expectedS02P2OpeningWrites = [
  s02P2ControlPath,
  s02UserDecisionLockPath,
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md'
];
const expectedS02RevisionOpeningWrites = [
  s02RevisionControlPath,
  s02RevisionDecisionLockPath,
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md'
];
const expectedS02RevisedP2OpeningWrites = [
  s02RevisedP2ControlPath,
  s02RevisedApprovalLockPath,
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md'
];
const s02RepresentativeAssetPaths = [
  'step4/s02/asset-production-p2/representative-proof/cat-model-sheet.png',
  'step4/s02/asset-production-p2/representative-proof/cat-idle-strip.png',
  'step4/s02/asset-production-p2/representative-proof/cat-attack-strip.png',
  'step4/s02/asset-production-p2/representative-proof/enemy-model-sheet.png',
  'step4/s02/asset-production-p2/representative-proof/enemy-defeat-strip.png',
  'step4/s02/asset-production-p2/representative-proof/ui-panel-9slice.png'
];
const s02RepresentativeManifestPath = 'step4/s02/asset-production-p2/representative-proof/manifest.json';
const s02RepresentativeEvidencePaths = {
  critic: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-asset-production-p2/representative-critic-round-001.json',
  finalJudge: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-asset-production-p2/representative-final-judge-round-001.json',
  completion: 'quality-reviews/step-4-twelve-screen-final-mockups/s02-asset-production-p2/representative-completion-evidence-round-001.json'
};
const s02AssetVolumeReviewRoot = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-asset-production-p2';
const s02AssetVolumeContractPath = `${s02AssetVolumeReviewRoot}/asset-volume-scope-contract-round-001.json`;
const s02AssetVolumeScopeEvidencePaths = {
  acceptanceMatrix: `${s02AssetVolumeReviewRoot}/asset-volume-scope-acceptance-matrix-round-001.json`,
  feasibilityAudit: `${s02AssetVolumeReviewRoot}/asset-volume-scope-feasibility-audit-round-001.json`,
  critic: `${s02AssetVolumeReviewRoot}/asset-volume-scope-independent-critic-round-001.json`,
  finalJudge: `${s02AssetVolumeReviewRoot}/asset-volume-scope-final-judge-round-001.json`,
  completion: `${s02AssetVolumeReviewRoot}/asset-volume-scope-completion-evidence-round-001.json`
};
const expectedS02AssetVolumeScopeOpeningWrites = [s02AssetVolumeScopeControlPath, s02AssetVolumeScopeLockPath, ...expectedS02ReadyActivationWrites];
const expectedS02AssetVolumeOpeningWrites = [s02AssetVolumeControlPath, s02AssetVolumeApprovalLockPath, ...expectedS02ReadyActivationWrites];
const expectedS02AssetPassOpeningWrites = [s02AssetPassControlPath, ...expectedS02ReadyActivationWrites];
// PASS_ASSET remains fully frozen. A later governance extension must be reviewed
// and installed before round 042 activates; round 042 itself may never authorize
// an arbitrary edit of the verifier or workflow that enforces this boundary.
const expectedS02AssetPassGovernanceExtensionWrites = expectedS02AssetVolumeScopeOpeningWrites;
const expectedS02AssetVolumeScopeAllowedWrites = [...new Set([
  s02AssetVolumeContractPath,
  ...Object.values(s02AssetVolumeScopeEvidencePaths),
  ...expectedS02ReadyActivationWrites,
  ...expectedS02AssetVolumeOpeningWrites
])];
const expectedS02P2AllowedWrites = [
  s02RepresentativeManifestPath,
  ...s02RepresentativeAssetPaths,
  ...Object.values(s02RepresentativeEvidencePaths),
  ...expectedS02AssetPassOpeningWrites
];
const expectedS02P2ForbiddenWrites = [
  'CHATGPT_PROJECT_INSTRUCTIONS1.md',
  'DEVELOPMENT_PLAYBOOK.md',
  'PROJECT_SOURCE_MANIFEST.md',
  'MASTER_SPEC.md',
  'FLOORS_1_10_DESIGN.md',
  'canonical/**',
  'simulation/candidate-v2.json',
  'simulation/candidate-v3.json',
  'simulation/executable-seal-v2.json',
  'simulation/executable-seal-v3.json',
  'simulation/engine-v2/**',
  'quality-reviews/step-2-executable-contract-v2/**',
  'quality-reviews/step-3-large-scale-validation/**',
  'step4/s02/golden-master-p1/**',
  'step4/s02/index.html',
  'step4/s02/app.js',
  'step4/s02/root-entry.js',
  'step4/s02/*.css',
  'step4/s02/assets/**',
  'index.html',
  'app.js',
  'styles.css',
  'game-core.js',
  'game-data.js',
  'sw.js',
  'runtime/**',
  'assets/**',
  'backend/**',
  'payment/**',
  'ads/**',
  '.vercel/**',
  'vercel.json',
  'tests/governance/verify-current-authority.mjs',
  '.github/workflows/verify-current-governance.yml'
];
const acceptanceAddendum = json('quality-reviews/phase-0-governance-recovery/acceptance-addendum-round-001.json');
const active = json(authority.activeChangeControl);

assert(git(['rev-parse', `${trustedRound031RepairBase.commit}^{tree}`]) === trustedRound031RepairBase.tree, 'trusted round 031 repair-base commit/tree mismatch');
assert(isAncestor(trustedRound031RepairBase.commit, git(['rev-parse', 'HEAD'])), 'current history is not descended from the trusted live round 031 repair base');

for (const file of [
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'simulation/CURRENT_STATUS.json',
  'quality-reviews/step-1-canonical-design/active-change-control.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  '.github/workflows/CURRENT_STATUS.md',
  '.github/workflows/verify-current-governance.yml',
  'tests/governance/verify-current-authority.mjs',
  authority.activeChangeControl
]) assertRegularGitFile(file, 'current authority');

const step2PassMirror = authority.executableContract?.step2Status === 'PASS_CONTRACT';
const postClosureControlPaths = ['quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json', s02RepairControlPath, s02P2ControlPath, s02RevisionControlPath, s02RevisedP2ControlPath, s02SecondRevisionControlPath, s02SecondRevisedP2ControlPath, s02ThirdRevisionControlPath, s02ThirdRevisedP2ControlPath, s02AssetPassControlPath, s02AssetVolumeScopeControlPath, s02AssetVolumeControlPath];
const phase0Closed = closureExists && postClosureControlPaths.includes(authority.activeChangeControl);
assertExactKeySet(authority, [
  'schemaVersion', 'artifactId', 'updatedAt', 'repository', 'branch', 'status', 'currentRepositoryStep',
  'currentInternalPhase', 'activeChangeControl', 'singleSourceRule', 'governanceRecovery', 'readOrder',
  'projectSources', 'canonicalProduct', 'executableContract', 'modelValidation', 'currentProductWork',
  'legacyRuntime', 'scopedVerdicts', 'globalGate', 'workflowPolicy', 'immutableHistoryPolicy'
], 'CURRENT_AUTHORITY_INDEX top level');
assertExactKeySet(status, [
  'schemaVersion', 'updatedAt', 'project', 'repository', 'branch', 'authorityIndex', 'activeChangeControl',
  'status', 'currentRepositoryStep', 'currentInternalPhase', 'currentVerdict', 'governanceRecovery',
  'scopedPasses', 'currentProductWork', 'openFindings', 'truthBoundaries', 'nextAuthorizedAction',
  'step5Allowed', 'productionAllowed', 'physicalIPhoneVerified', ...(step2PassMirror ? ['executableContract'] : [])
], 'PROJECT_STATUS top level');
assertExactKeySet(policy, [
  'schemaVersion', 'updatedAt', 'repository', 'authority', 'current', 'scopedPassVocabulary',
  'forbiddenUnscopedVerdict', 'completionInsufficientAlone', 'lowReworkRules', 'verificationPolicy',
  'currentWriteBoundary', 'legacy', 'reportingRequired'
], 'AI_PROJECT_POLICY top level');
assertExactKeySet(sim, [
  'schemaVersion', 'updatedAt', 'repository', 'branch', 'authorityIndex', 'currentRepositoryStep',
  'currentInternalPhase', 'status', 'governanceRecovery', 'step1', 'step2', 'step3', 'runtimeRevalidation',
  'currentMutationAllowed', 'candidateMutationDuringS02P1', 'sealedEvidenceMutationDuringS02P1',
  'step4Pass', 'step5Allowed', 'physicalIPhoneVerified', 'productionAliasChanged', 'nextAction'
], 'simulation CURRENT_STATUS top level');
assertExactKeySet(dispatcher, [
  'schemaVersion', 'artifactId', 'updatedAt', 'repository', 'branch', 'status', 'currentAuthorityIndex',
  'currentAddendum', 'currentVerdict', 'currentRepositoryStep', 'currentInternalPhase',
  'supersededGovernanceRecoveryClosure', 'step2ScreenProjectionCorrection', 'plannedGovernanceRecoveryClosure',
  'canonicalSeals', 'scopeTruth', 'lineage', 'rule', ...(step2PassMirror ? ['step2ExecutableContract'] : []),
  ...(phase0Closed ? ['governanceRecoveryClosure'] : [])
], 'active-change-control dispatcher top level');
const authorityRecoveryKeys = [
  'status', 'supersededClosureAttempt', 'step2Correction', 'plannedCorrectedClosure', 'contentCommit',
  'contentTree', 'evidenceCommit', 'evidenceTree', 'workflowRun', 'workflowJob', 'artifactId',
  'phase0P0', 'phase0P1', 'phase0P2', ...(phase0Closed ? ['closure'] : [])
];
assertExactKeySet(authority.governanceRecovery, authorityRecoveryKeys, 'authority governance recovery');
assertExactKeySet(status.governanceRecovery, [
  'status', 'supersededClosureAttempt', 'step2Correction', 'plannedCorrectedClosure',
  'phase0P0', 'phase0P1', 'phase0P2', ...(phase0Closed ? ['closure'] : [])
], 'PROJECT_STATUS governance recovery');
assertExactKeySet(sim.governanceRecovery, [
  'status', 'supersededClosureAttempt', 'step2Correction', 'plannedCorrectedClosure', ...(phase0Closed ? ['closure'] : [])
], 'simulation governance recovery');
assertExactKeySet(status.truthBoundaries, [
  'legacyRuntime', 'step3RuntimePlaytestEvidence', 'canonicalOneToTenRuntimeImplemented',
  'backendImplemented', 'paymentImplemented', 'adsImplemented', 'productionAssetsApproved',
  'twelveScreensApproved', 'userVisualApproval', 'physicalIPhoneVerified', 'productionAliasChanged',
  'productionReady'
], 'PROJECT_STATUS truth boundaries');
assertExactKeySet(policy.authority, [
  'index', 'activeChangeControl', 'supersededGovernanceRecoveryClosure', 'step2ScreenProjectionCorrection',
  'plannedGovernanceRecoveryClosure', 'instructions', 'playbook', 'projectSourceManifest',
  ...(phase0Closed ? ['governanceRecoveryClosure'] : [])
], 'AI policy authority');
const trustedPolicyAuthority = jsonAt(trustedRound031RepairBase.commit, 'AI_PROJECT_POLICY.json').authority;
assert(JSON.stringify(policy.authority) === JSON.stringify({
  ...trustedPolicyAuthority,
  activeChangeControl: authority.activeChangeControl,
  ...(phase0Closed ? { governanceRecoveryClosure: closurePath } : {})
}), 'AI policy authority pointers differ from the exact reviewed lineage');
if (!phase0Closed) {
  assert(!Object.hasOwn(authority.governanceRecovery, 'closure') && !Object.hasOwn(status.governanceRecovery, 'closure') && !Object.hasOwn(sim.governanceRecovery, 'closure'), 'Phase 0 closure pointer was published before round 033');
  assert(!Object.hasOwn(dispatcher, 'governanceRecoveryClosure'), 'dispatcher published Phase 0 closure before round 033');
}

if (step2Correction) {
  assert(typeof expectedStep2CorrectionControlBlob === 'string' && /^[a-f0-9]{40}$/.test(expectedStep2CorrectionControlBlob), 'round 032 control blob was not frozen at opening');
  assert(git(['rev-parse', `HEAD:${step2CorrectionPath}`]) === expectedStep2CorrectionControlBlob, 'round 032 change-control mutated or self-expanded');
}

assert(authority.repository === '2hg7trp7rv-design/cats_tower', 'authority repository mismatch');
assert(authority.schemaVersion === 4 && authority.artifactId === 'cats-tower-current-authority-index', 'authority schema or artifact identity mismatch');
assert(status.schemaVersion === 22 && status.project === "Cat's Tower", 'PROJECT_STATUS schema or project identity mismatch');
assert(policy.schemaVersion === 14 && sim.schemaVersion === 13, 'AI policy or simulation status schema mismatch');
assert(dispatcher.schemaVersion === 5 && dispatcher.artifactId === 'cats-tower-active-change-control-dispatcher', 'dispatcher schema or artifact identity mismatch');
assert(isCanonicalIsoDate(authority.updatedAt) && ['PROJECT_STATUS.json', 'AI_PROJECT_POLICY.json', 'simulation/CURRENT_STATUS.json'].every(file => json(file).updatedAt === authority.updatedAt), 'current mirror updatedAt is not one exact canonical date across JSON mirrors');
assert(isCanonicalIsoDate('2027-01-01'), 'canonical date validation does not remain live across the 2026/2027 boundary');
assert(authority.branch === 'kimi', 'authority branch mismatch');
assert(status.repository === authority.repository && status.branch === authority.branch, 'PROJECT_STATUS repository/branch mismatch');
assert(sim.repository === authority.repository && sim.branch === authority.branch, 'simulation repository/branch mismatch');
assert(dispatcher.repository === authority.repository && dispatcher.branch === authority.branch, 'dispatcher repository/branch mismatch');
assert(active.repository === authority.repository && active.branch === authority.branch, 'active control repository/branch mismatch');
assert(policy.repository?.fullName === authority.repository && policy.repository?.allowedBranch === authority.branch, 'AI policy repository/branch mismatch');
for (const key of ['writeOtherBranch', 'createBranch', 'pullRequestWorkflow', 'mergeRebaseCherryPickForcePush', 'productionAliasChangeWithoutExplicitApproval']) {
  assert(policy.repository?.[key] === false, `AI policy unsafe repository permission: ${key}`);
}
assert(status.authorityIndex === 'CURRENT_AUTHORITY_INDEX.json', 'PROJECT_STATUS must use authority index');
assert(policy.authority.index === 'CURRENT_AUTHORITY_INDEX.json', 'AI policy must use authority index');
assert(sim.authorityIndex === 'CURRENT_AUTHORITY_INDEX.json', 'simulation mirror must use authority index');
assert(dispatcher.currentAuthorityIndex === 'CURRENT_AUTHORITY_INDEX.json', 'dispatcher must use authority index');
assert(dispatcher.currentAddendum === authority.activeChangeControl, 'dispatcher and authority active addendum differ');
assert(status.activeChangeControl === authority.activeChangeControl, 'PROJECT_STATUS active addendum differs');
assert(policy.authority.activeChangeControl === authority.activeChangeControl, 'AI policy active addendum differs');
assert(authority.currentRepositoryStep === 4 && status.currentRepositoryStep === 4 && sim.currentRepositoryStep === 4 && dispatcher.currentRepositoryStep === 4 && policy.current?.repositoryStep === 4, 'current repository-step mirrors must be exact Step 4');
assert(authority.currentInternalPhase === status.currentInternalPhase && status.currentInternalPhase === sim.currentInternalPhase && sim.currentInternalPhase === dispatcher.currentInternalPhase && dispatcher.currentInternalPhase === policy.current?.internalPhase, 'current internal-phase mirrors differ');
assert(status.status === 'IN_PROGRESS' && dispatcher.status === 'IN_PROGRESS' && policy.current?.status === 'IN_PROGRESS' && authority.globalGate?.overallStatus === 'IN_PROGRESS', 'current operational/global status must remain IN_PROGRESS');
assert(authority.status === status.currentVerdict && status.currentVerdict === sim.status && sim.status === dispatcher.currentVerdict && dispatcher.currentVerdict === policy.current?.verdict, 'current verdict mirrors differ');
assert(sim.currentMutationAllowed === false, 'simulation current mutation authority must remain false');
assertExactKeySet(policy.current, ['repositoryStep', 'internalPhase', 'status', 'verdict', 'step4Pass', 'step5Allowed', 'productionAllowed', 'physicalIPhoneVerified', 'userVisualApproval'], 'AI policy current');
assertExactKeySet(policy.currentWriteBoundary, ['allowed', 'preWriteRequirement', 'forbidden'], 'AI policy current write boundary');
assertExactKeySet(authority.globalGate, ['overallStatus', 'unresolvedP0', 'unresolvedP1', 'unresolvedP2', 'openFindings', 'productionAliasChanged', 'physicalIPhoneVerified', 'productionReady'], 'authority global gate');
assertExactKeySet(status.openFindings, ['P0', 'P1', 'P2', 'items'], 'PROJECT_STATUS open findings');
const baseAuthorityProductKeys = ['step4Status', 'phase', 'changeControl', 'acceptance', 'reviewRoute', 'deliverablesRequired', 'goldenMastersRequired', 'goldenMasterRoutePresent', 'deliverablesClaimedForAudit', 'goldenMastersClaimedForAudit', 'deliverablesAccepted', 'goldenMastersAccepted', 'currentState', 'nextAuthorizedAction', 'step4Pass', 'step5Allowed', 'userVisualApproval'];
const expectedAuthorityProductKeys = ['S02-P1-GOLDEN-MASTER', 'S02-P2-ASSET-PRODUCTION'].includes(authority.currentInternalPhase)
  ? baseAuthorityProductKeys
  : [...baseAuthorityProductKeys, 'nextProductActionAfterCorrectedClosure'];
assertExactKeySet(authority.currentProductWork, expectedAuthorityProductKeys, 'authority current product work');
assertExactKeySet(status.currentProductWork, ['phase', 'changeControl', 'acceptance', 'goldenMastersRequired', 'deliverablesRequired', 'goldenMasterRoutePresent', 'goldenMastersClaimedForAudit', 'goldenMastersAccepted', 'deliverablesClaimedForAudit', 'deliverablesAccepted', 'currentState'], 'PROJECT_STATUS current product work');
assert(authority.updatedAt === status.updatedAt && status.updatedAt === sim.updatedAt && sim.updatedAt === dispatcher.updatedAt && dispatcher.updatedAt === policy.updatedAt, 'current authority mirror timestamps differ');
const expectedCurrentStateByControl = {
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json': {
    internalPhase: 'PHASE0-GOVERNANCE-RECOVERY',
    verdict: 'IN_PROGRESS_PHASE0_CLOSURE_INTEGRITY_RECOVERY',
    authorityProductState: 'READ_ONLY_UNTIL_ROUND_033_CORRECTED_CLOSURE',
    authorityNext: 'Do not mutate S02-P1 product content before round 033 closes Phase 0 and returns authority to round 026.',
    authorityNextProduct: 'Inventory and audit the preserved S02-P1 artifacts against A-J and GM01-GM08; reuse conforming material and repair only evidenced gaps.',
    statusProductState: 'AUDIT_REQUIRED_BEFORE_ADDITIONAL_PRODUCT_WRITE',
    statusNext: 'Repair Phase 0 closure integrity, then perform the narrow Step 2 screen-projection correction under round 032. Keep S02-P1 product content read-only until corrected closure round 033 returns authority to round 026.',
    simulationNext: 'Complete round 031 repair verification, then open round 032 for the narrow Step 2 screen-projection correction. Keep S02 content read-only through round 033.'
  },
  [step2CorrectionPath]: {
    internalPhase: 'STEP2-SCREEN-PROJECTION-CORRECTION',
    verdict: 'IN_PROGRESS_STEP2_SCREEN_PROJECTION_CORRECTION',
    authorityProductState: 'READ_ONLY_UNTIL_ROUND_033_CORRECTED_CLOSURE',
    authorityNext: 'Do not mutate S02-P1 product content before round 033 closes Phase 0 and returns authority to round 026.',
    authorityNextProduct: 'Inventory and audit the preserved S02-P1 artifacts against A-J and GM01-GM08; reuse conforming material and repair only evidenced gaps.',
    statusProductState: 'READ_ONLY_UNTIL_ROUND_033_CORRECTED_CLOSURE',
    statusNext: 'Complete the versioned Step 2 screen-projection correction and corrected Phase 0 closure under rounds 032 and 033. Keep S02-P1 product content read-only.',
    simulationNext: 'Complete the versioned Step 2 screen-projection correction, independent review, continuity proof, and corrected round 033 closure.'
  },
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json': {
    internalPhase: 'S02-P1-GOLDEN-MASTER',
    verdict: 'IN_PROGRESS_S02_P1_A_J_AUDIT',
    authorityProductState: 'AUDIT_EXISTING_A_J_AND_GM01_GM08_BEFORE_NEW_PRODUCT_WRITE',
    authorityNext: 'Inventory and audit the preserved S02-P1 artifacts against A-J and GM01-GM08; reuse conforming material and repair only evidenced gaps.',
    authorityNextProduct: null,
    statusProductState: 'AUDIT_REQUIRED_BEFORE_ADDITIONAL_PRODUCT_WRITE',
    statusNext: 'Audit the preserved S02-P1 artifacts against A-J and GM01-GM08 before any new product-content write. Reuse conforming content; repair only demonstrated gaps.',
    simulationNext: 'Do not tune or rerun the model during S02-P1. Audit existing S02 visual artifacts first. Resume simulation only when an authorized product change affects the sealed model or after canonical runtime shares the domain engine.'
  },
  [s02RepairControlPath]: [
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER',
      verdict: 'IN_PROGRESS_S02_P1_VISUAL_REPAIR',
      authorityProductState: 'REPAIRING_INDEPENDENTLY_EVIDENCED_S02_P1_GAPS',
      authorityNext: 'Repair the independently evidenced S02-P1 visual, responsive, accessibility and implementation-feasibility gaps, then rerun exact browser verification.',
      authorityNextProduct: null,
      statusProductState: 'REPAIRING_INDEPENDENTLY_EVIDENCED_S02_P1_GAPS',
      statusNext: 'Repair only the independently evidenced S02-P1 P1 gaps under round 034, then rerun static, responsive, browser and accessibility verification.',
      simulationNext: 'Do not tune or rerun the model during S02-P1. Resume simulation only when an authorized product change affects the sealed model or after canonical runtime shares the domain engine.'
    },
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER',
      verdict: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityNext: 'Present all eight individually viewable Golden Masters on the immutable Preview deployment and await explicit user visual approval.',
      authorityNextProduct: null,
      statusProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      statusNext: 'Await explicit user visual review of the immutable Preview deployment. Do not infer approval and do not start P2 asset production.',
      simulationNext: 'Do not tune or rerun the model during S02-P1. Resume simulation only when an authorized product change affects the sealed model or after canonical runtime shares the domain engine.'
    }
  ],
  [s02P2ControlPath]: {
    internalPhase: 'S02-P2-ASSET-PRODUCTION',
    verdict: 'READY_FOR_S02_P2_ASSET_PRODUCTION',
    authorityProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    authorityNext: 'Create and independently verify one representative production-asset set before any volume generation or runtime replacement.',
    authorityNextProduct: null,
    statusProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    statusNext: 'Produce the representative S02 P2 production-asset proof under round 035. Do not generate the full asset volume or replace runtime before PASS_ASSET.',
    simulationNext: 'Do not tune or rerun the model during S02 P2 asset proof. Resume simulation only when an authorized product change affects the sealed model or after canonical runtime shares the domain engine.'
  },
  [s02RevisionControlPath]: [
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER',
      verdict: 'IN_PROGRESS_S02_P1_USER_REVISION',
      authorityProductState: 'REVISING_EXACT_USER_REQUESTED_S02_P1_PATHS',
      authorityNext: 'Apply only the concrete user-requested S02 Golden Master revisions, then repeat the full independent review and Preview readback chain.',
      authorityNextProduct: null,
      statusProductState: 'REVISING_EXACT_USER_REQUESTED_S02_P1_PATHS',
      statusNext: 'Apply only the round 007 user-decision-lock target paths, then complete round 002 critic, judge, completion and Preview readback evidence.',
      simulationNext: 'Do not tune or rerun the model during the S02-P1 user revision. Runtime, sealed simulation, Production and device claims remain unchanged.'
    },
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER',
      verdict: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityNext: 'Present the revised eight Golden Masters; exact approval may open pre-reviewed round 037 and a second exact revision may open pre-reviewed round 038.',
      authorityNextProduct: null,
      statusProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      statusNext: 'Await explicit review of the revised Preview. Approval may open exact round 037; a second exact revision may open pre-reviewed round 038. Do not infer approval or start P2.',
      simulationNext: 'Do not tune or rerun the model during S02-P1. Runtime, sealed simulation, Production and device claims remain unchanged.'
    }
  ],
  [s02RevisedP2ControlPath]: {
    internalPhase: 'S02-P2-ASSET-PRODUCTION',
    verdict: 'READY_FOR_S02_P2_ASSET_PRODUCTION',
    authorityProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    authorityNext: 'Create and independently verify one representative production-asset set from the approved revised Golden Master before any volume generation or runtime replacement.',
    authorityNextProduct: null,
    statusProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    statusNext: 'Produce the representative S02 P2 production-asset proof under round 037. Do not generate the full asset volume or replace runtime before PASS_ASSET.',
    simulationNext: 'Do not tune or rerun the model during S02 P2 asset proof. Resume simulation only when an authorized product change affects the sealed model or after canonical runtime shares the domain engine.'
  },
  [s02SecondRevisionControlPath]: [
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER', verdict: 'IN_PROGRESS_S02_P1_USER_REVISION',
      authorityProductState: 'REVISING_EXACT_USER_REQUESTED_S02_P1_PATHS',
      authorityNext: 'Apply only exact round 009 user-requested paths and cumulative acceptance assertions, then complete review round 003.', authorityNextProduct: null,
      statusProductState: 'REVISING_EXACT_USER_REQUESTED_S02_P1_PATHS',
      statusNext: 'Apply only exact round 009 targets, preserve every surviving criterion, and complete round 003 evidence before user review.',
      simulationNext: 'Do not tune or rerun the model during the S02-P1 user revision. Runtime, sealed simulation, Production and device claims remain unchanged.'
    },
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER', verdict: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityNext: 'Present the review-round-003 immutable Preview; exact approval may open round 039 and another exact revision may open round 040.', authorityNextProduct: null,
      statusProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      statusNext: 'Await explicit review of the round 003 Preview. Approval may open round 039; another revision may open round 040. Do not infer approval or start P2.',
      simulationNext: 'Do not tune or rerun the model during S02-P1. Runtime, sealed simulation, Production and device claims remain unchanged.'
    }
  ],
  [s02SecondRevisedP2ControlPath]: {
    internalPhase: 'S02-P2-ASSET-PRODUCTION', verdict: 'READY_FOR_S02_P2_ASSET_PRODUCTION',
    authorityProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    authorityNext: 'Create and independently verify one representative production-asset set from the round 003 approved target before any volume generation or runtime replacement.', authorityNextProduct: null,
    statusProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    statusNext: 'Produce only the representative S02 P2 asset proof under round 039. Do not generate volume or replace runtime before PASS_ASSET.',
    simulationNext: 'Do not tune or rerun the model during S02 P2 asset proof. Resume simulation only when an authorized product change affects the sealed model or after canonical runtime shares the domain engine.'
  },
  [s02ThirdRevisionControlPath]: [
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER', verdict: 'IN_PROGRESS_S02_P1_USER_REVISION',
      authorityProductState: 'REVISING_EXACT_USER_REQUESTED_S02_P1_PATHS',
      authorityNext: 'Apply only exact round 011 user-requested paths and cumulative acceptance assertions, then complete review round 004.', authorityNextProduct: null,
      statusProductState: 'REVISING_EXACT_USER_REQUESTED_S02_P1_PATHS',
      statusNext: 'Apply only exact round 011 targets, preserve every surviving criterion, and complete round 004 evidence before user review.',
      simulationNext: 'Do not tune or rerun the model during the S02-P1 user revision. Runtime, sealed simulation, Production and device claims remain unchanged.'
    },
    {
      internalPhase: 'S02-P1-GOLDEN-MASTER', verdict: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      authorityNext: 'Present the review-round-004 immutable Preview; exact approval may open round 041, while a fourth revision is BLOCKED_PENDING_GOVERNANCE_EXTENSION.', authorityNextProduct: null,
      statusProductState: 'READY_FOR_USER_VISUAL_REVIEW',
      statusNext: 'Await explicit review of the round 004 Preview. Approval may open round 041; a fourth revision is BLOCKED_PENDING_GOVERNANCE_EXTENSION. Do not infer approval or start P2.',
      simulationNext: 'Do not tune or rerun the model during S02-P1. Runtime, sealed simulation, Production and device claims remain unchanged.'
    }
  ],
  [s02ThirdRevisedP2ControlPath]: {
    internalPhase: 'S02-P2-ASSET-PRODUCTION', verdict: 'READY_FOR_S02_P2_ASSET_PRODUCTION',
    authorityProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    authorityNext: 'Create and independently verify one representative production-asset set from the round 004 approved target before any volume generation or runtime replacement.', authorityNextProduct: null,
    statusProductState: 'READY_FOR_REPRESENTATIVE_S02_P2_ASSET_PROOF',
    statusNext: 'Produce only the representative S02 P2 asset proof under round 041. Do not generate volume or replace runtime before PASS_ASSET.',
    simulationNext: 'Do not tune or rerun the model during S02 P2 asset proof. Resume simulation only when an authorized product change affects the sealed model or after canonical runtime shares the domain engine.'
  },
  [s02AssetPassControlPath]: {
    internalPhase: 'S02-P2-ASSET-PRODUCTION', verdict: 'PASS_S02_P2_REPRESENTATIVE_ASSET',
    authorityProductState: 'PASS_ASSET_REPRESENTATIVE_ONLY',
    authorityNext: 'Open a new exact change-control before asset volume or runtime integration; Step 4, Step 5 and Production remain blocked.', authorityNextProduct: null,
    statusProductState: 'PASS_ASSET_REPRESENTATIVE_ONLY',
    statusNext: 'Representative S02 P2 assets passed their scoped proof. Asset volume and runtime integration require a new exact change-control.',
    simulationNext: 'Do not tune or rerun the model. Representative PASS_ASSET does not authorize runtime, asset volume, Step 4 PASS, Step 5 or Production.'
  },
  [s02AssetVolumeScopeControlPath]: {
    internalPhase: 'S02-P2-ASSET-PRODUCTION', verdict: 'IN_PROGRESS_S02_P2_VOLUME_SCOPE_CONTRACT',
    authorityProductState: 'DESIGNING_EXACT_S02_P2_ASSET_VOLUME_SCOPE',
    authorityNext: 'Create and independently review only the finite S02 P2 asset-volume scope contract; P0/P1 zero may activate only its exact enumerated paths without another technical user decision.', authorityNextProduct: null,
    statusProductState: 'DESIGNING_EXACT_S02_P2_ASSET_VOLUME_SCOPE',
    statusNext: 'Complete the round 043 scope contract and independent evidence. An exact governance activation may then open only contract-enumerated asset paths.',
    simulationNext: 'Do not tune or rerun the model. Round 043 authorizes scope-contract evidence only; asset bytes, runtime, Step 4 PASS, Step 5 and Production remain blocked.'
  },
  [s02AssetVolumeControlPath]: [
    {
      internalPhase: 'S02-P2-ASSET-PRODUCTION', verdict: 'IN_PROGRESS_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION',
      authorityProductState: 'PRODUCING_EXACT_CONTRACT_ENUMERATED_S02_P2_ASSETS',
      authorityNext: 'Produce and independently verify only the exact asset and evidence paths enumerated by the approved round 043 contract; do not integrate runtime.', authorityNextProduct: null,
      statusProductState: 'PRODUCING_EXACT_CONTRACT_ENUMERATED_S02_P2_ASSETS',
      statusNext: 'Produce only contract-enumerated S02 P2 asset bytes and evidence. Runtime integration, Step 4 PASS, Step 5 and Production remain blocked.',
      simulationNext: 'Do not tune or rerun the model. Round 044 asset production does not authorize runtime integration, gameplay data, Step 4 PASS, Step 5 or Production.'
    },
    {
      internalPhase: 'S02-P2-ASSET-PRODUCTION', verdict: 'READY_FOR_S02_P3_RUNTIME_INTEGRATION_SCOPE_REVIEW',
      authorityProductState: 'S02_P2_EXACT_ASSET_VOLUME_PASSED_AWAITING_P3_SCOPE',
      authorityNext: 'Preserve the exact round 044 asset/evidence chain and open a new scope-only governance successor before any S02 P3 runtime integration.', authorityNextProduct: null,
      statusProductState: 'S02_P2_EXACT_ASSET_VOLUME_PASSED_AWAITING_P3_SCOPE',
      statusNext: 'All contract-enumerated S02 P2 asset batches passed with P0/P1 zero. Runtime integration requires a new exact scope-only change-control; Step 4 PASS, Step 5 and Production remain blocked.',
      simulationNext: 'Do not tune or rerun the model. Exact S02 P2 asset-volume PASS does not authorize runtime integration, gameplay data, Step 4 PASS, Step 5 or Production.'
    }
  ]
};
const currentStateOptions = expectedCurrentStateByControl[authority.activeChangeControl];
assert(currentStateOptions, 'active control has no exact current-state contract');
const expectedCurrentState = (Array.isArray(currentStateOptions) ? currentStateOptions : [currentStateOptions]).find(option =>
  authority.currentInternalPhase === option.internalPhase &&
  authority.status === option.verdict &&
  authority.currentProductWork.currentState === option.authorityProductState &&
  authority.currentProductWork.nextAuthorizedAction === option.authorityNext &&
  (authority.currentProductWork.nextProductActionAfterCorrectedClosure ?? null) === option.authorityNextProduct &&
  status.currentProductWork.currentState === option.statusProductState &&
  status.nextAuthorizedAction === option.statusNext &&
  sim.nextAction === option.simulationNext
);
assert(expectedCurrentState, 'current phase, verdict and next actions do not match any reviewed active-control state');
const expectedProductIdentity = {
  phase: s02AnyP2Control ? 'S02-P2-ASSET-PRODUCTION' : 'S02-P1-GOLDEN-MASTER',
  changeControl: s02AnyP2Control
    ? authority.activeChangeControl
    : ([s02RepairControlPath, s02RevisionControlPath, s02SecondRevisionControlPath, s02ThirdRevisionControlPath].includes(authority.activeChangeControl)
      ? authority.activeChangeControl
      : 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json'),
  acceptance: s02ThirdRevisionControl || s02ThirdRevisedP2Control
    ? s02ThirdRevisionReviewEvidencePaths.acceptanceMatrix
    : s02SecondRevisionControl || s02SecondRevisedP2Control
      ? s02SecondRevisionReviewEvidencePaths.acceptanceMatrix
      : s02RevisionControl || s02RevisedP2Control
        ? s02RevisionReviewEvidencePaths.acceptanceMatrix
        : 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-acceptance-matrix-round-001.json',
  goldenMastersRequired: 8,
  deliverablesRequired: 10,
  goldenMasterRoutePresent: true,
  goldenMastersClaimedForAudit: 8,
  goldenMastersAccepted: s02AnyP2Control ? 8 : 0,
  deliverablesClaimedForAudit: 10,
  deliverablesAccepted: s02AnyP2Control ? 10 : 0
};
for (const [key, value] of Object.entries(expectedProductIdentity)) {
  assert(authority.currentProductWork[key] === value && status.currentProductWork[key] === value, `S02 product identity/count mirror mismatch: ${key}`);
}
assert(authority.currentProductWork.reviewRoute === '/step4/s02/golden-master-p1/' && authority.currentProductWork.step4Status === 'IN_PROGRESS', 'authority S02 review route or Step 4 state mismatch');
const expectedPolicyBoundary = expectedPolicyBoundaryByControl[authority.activeChangeControl];
assert(expectedPolicyBoundary && policy.currentWriteBoundary?.allowed === expectedPolicyBoundary.allowed && policy.currentWriteBoundary?.preWriteRequirement === expectedPolicyBoundary.preWriteRequirement, 'AI policy current write-boundary summary is stale or contradictory');
assert(JSON.stringify(policy.currentWriteBoundary?.forbidden) === JSON.stringify(expectedPolicyForbidden), 'AI policy forbidden write boundary changed');

assert(authority.canonicalProduct.step1Status === 'PASS_CANONICAL', 'Step 1 scope label wrong');
assert(['IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED', 'PASS_CONTRACT'].includes(authority.executableContract.step2Status), 'Step 2 screen-projection status is invalid');
assert(authority.modelValidation.step3Status === 'PASS_MODEL', 'Step 3 scope label wrong');
assert(authority.currentProductWork.step4Pass === false, 'Step 4 must not pass');
assert(authority.currentProductWork.step5Allowed === false, 'Step 5 must remain blocked');
assert(authority.legacyRuntime.status === 'LEGACY_RUNTIME_NOT_CANONICAL', 'legacy runtime truth missing');
assert(status.truthBoundaries.legacyRuntime === 'LEGACY_RUNTIME_NOT_CANONICAL', 'PROJECT_STATUS legacy runtime truth mismatch');
assert(authority.modelValidation.limitation.toLowerCase().includes('not evidence'), 'Step 3 runtime limitation missing');
assert(status.truthBoundaries.canonicalOneToTenRuntimeImplemented === false, 'canonical runtime must be false');
assert(status.truthBoundaries.backendImplemented === false, 'backend must be false');
assert(status.truthBoundaries.paymentImplemented === false && status.truthBoundaries.adsImplemented === false, 'payment/ads truth boundary changed');
assert(status.truthBoundaries.productionAssetsApproved === false && status.truthBoundaries.twelveScreensApproved === 0, 'production assets or twelve-screen approval was overstated');
assert(status.truthBoundaries.step3RuntimePlaytestEvidence === false, 'Step 3 runtime playtest evidence must remain false');
assert(status.truthBoundaries.productionReady === false, 'Production Ready must be false');
assert(status.truthBoundaries.physicalIPhoneVerified === false, 'physical iPhone must be false');
assert(status.truthBoundaries.productionAliasChanged === false && status.productionAllowed === false, 'PROJECT_STATUS Production boundary changed');
assert(status.step5Allowed === false && status.physicalIPhoneVerified === false, 'PROJECT_STATUS Step 5/device boundary changed');
assert(sim.productionAliasChanged === false && sim.physicalIPhoneVerified === false && sim.step4Pass === false && sim.step5Allowed === false, 'simulation release boundary changed');
assert(dispatcher.scopeTruth?.step4 === 'IN_PROGRESS' && dispatcher.scopeTruth?.step5Allowed === false && dispatcher.scopeTruth?.productionAllowed === false && dispatcher.scopeTruth?.physicalIPhoneVerified === false, 'dispatcher release boundary changed');
const expectedUserVisualApproval = Boolean(s02AnyP2Control);
assert(policy.current?.step4Pass === false && policy.current?.step5Allowed === false && policy.current?.productionAllowed === false && policy.current?.physicalIPhoneVerified === false && policy.current?.userVisualApproval === expectedUserVisualApproval, 'AI policy release or user-approval boundary changed');
assert(status.truthBoundaries.userVisualApproval === expectedUserVisualApproval && authority.currentProductWork.userVisualApproval === expectedUserVisualApproval, 'user visual approval mirror differs from the exact decision-lock state');
assert(authority.currentProductWork.deliverablesAccepted === (s02AnyP2Control ? 10 : 0) && authority.currentProductWork.goldenMastersAccepted === (s02AnyP2Control ? 8 : 0) && status.currentProductWork.deliverablesAccepted === (s02AnyP2Control ? 10 : 0) && status.currentProductWork.goldenMastersAccepted === (s02AnyP2Control ? 8 : 0), 'S02 accepted counts differ from the exact approval state');
assert(authority.globalGate.productionAliasChanged === false && authority.globalGate.physicalIPhoneVerified === false && authority.globalGate.productionReady === false, 'authority release boundary changed');
assert(policy.forbiddenUnscopedVerdict === 'PASS', 'unscoped PASS prohibition missing');

if (phase0Closed) {
  const closureAuthoritySnapshot = jsonAt(closureCommit, 'CURRENT_AUTHORITY_INDEX.json');
  for (const key of ['projectSources', 'canonicalProduct', 'modelValidation', 'legacyRuntime', 'scopedVerdicts', 'workflowPolicy', 'immutableHistoryPolicy']) {
    assert(JSON.stringify(authority[key]) === JSON.stringify(closureAuthoritySnapshot[key]), `S02-P1 changed a frozen authority section after round 033: ${key}`);
  }
  const closureSimulationSnapshot = jsonAt(closureCommit, 'simulation/CURRENT_STATUS.json');
  for (const key of ['step1', 'step3', 'runtimeRevalidation', 'candidateMutationDuringS02P1', 'sealedEvidenceMutationDuringS02P1']) {
    assert(JSON.stringify(sim[key]) === JSON.stringify(closureSimulationSnapshot[key]), `S02-P1 changed a frozen simulation section after round 033: ${key}`);
  }
}

const fixedHistoricalBlobs = {
  'quality-reviews/step-1-reseal-round-008/seal-round-008.json': '0a959de0383b57ad6cd1f33c124b398aa51c1e00',
  'simulation/executable-seal-v2.json': 'ee3507969c03b08fe27350263cf0bc093a1c18e1',
  'quality-reviews/step-3-large-scale-validation/final-judge.json': 'a089266f56076a0b2a59b2670188d95ae8eff3d2',
  'quality-reviews/step-3-large-scale-validation/completion-evidence.json': 'bc808fc3129f81000f1c5e755ffb2fc3a05bcf0b'
};
for (const [p, expectedBlob] of Object.entries(fixedHistoricalBlobs)) {
  assert(exists(p), `sealed evidence missing: ${p}`);
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `sealed evidence blob changed: ${p}`);
}

const frozenAttemptedClosureBlobs = {
  'quality-reviews/phase-0-governance-recovery/acceptance-matrix.json': '66b243ce69e976913413a944e3fd1290072c304f',
  'quality-reviews/phase-0-governance-recovery/change-manifest.json': '1bcd8add6fc463922bd4fbd652e83601f1f5aa7d',
  'quality-reviews/phase-0-governance-recovery/step2-source-compatibility.json': 'efeeea2a33e77bff8822b8c3aa4743f7448b1641',
  'quality-reviews/phase-0-governance-recovery/critic-summary.json': 'bc411bd18ab7ef12825f463ed4486f370ff9d85e',
  'quality-reviews/phase-0-governance-recovery/final-judge.json': '7af39af4b1e40255a38421e0606766e086d1f29f',
  'quality-reviews/phase-0-governance-recovery/completion-evidence.json': 'd1bdb3eb93734d3cd758c50355793d857f915c56',
  'quality-reviews/phase-0-governance-recovery/live-readback.json': 'dd045fc9526bde19c561412da11a67761afd13b5',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json': '20011a1007dd9795486b870293d2aeac89909fb1'
};
for (const [p, expectedBlob] of Object.entries(frozenAttemptedClosureBlobs)) {
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `superseded Phase 0 evidence changed again: ${p}`);
}

const frozenCorrectionBlobs = {
  'quality-reviews/phase-0-governance-recovery/acceptance-addendum-round-001.json': '15001d7dcf998008be3f049dbdb34d9621142309',
  'quality-reviews/phase-0-governance-recovery/critic-summary-round-002.json': '8acef973ee08cfdca45de8a4c790a626af002acc',
  'quality-reviews/phase-0-governance-recovery/evidence-supersession-register.json': '4fa508cf4f6206b15022b09d54cac41617548c74',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json': '7f7337a9954f1a2c0229b681a53091fa2e349489',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-027.json': 'b05545d5a768ec1e3001c10633a98209f672c646',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-028.json': '073e83818b88b5d8b808c65859540adaada10f19',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-029.json': 'e42b0afa3494427d5dd34e6c8777a7aecbedf102',
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json': 'fbbd5c4baecac4b1ef5e9b8e741338acd50f1c97'
};
for (const [p, expectedBlob] of Object.entries(frozenCorrectionBlobs)) {
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `Phase 0 correction history or boundary control changed: ${p}`);
}
const frozenCurrentRecoveryBlobs = {
  'quality-reviews/phase-0-governance-recovery/evidence-supersession-register-round-002.json': '69d76534cadcbedeff272cf39003ab55c939f9f8'
};
for (const [p, expectedBlob] of Object.entries(frozenCurrentRecoveryBlobs)) {
  assertRegularGitFile(p, 'current Phase 0 recovery evidence');
  assert(git(['rev-parse', `HEAD:${p}`]) === expectedBlob, `current Phase 0 recovery evidence changed: ${p}`);
}
assert(exists('quality-reviews/phase-0-governance-recovery/evidence-supersession-register-round-002.json'), 'complete evidence supersession register missing');
const closureIntegrityFreezeBaseline = '52261184fe895bf17c01a8cc5bc55ccf561064da';
assertNoPathChangesSince(
  closureIntegrityFreezeBaseline,
  'HEAD',
  [...Object.keys(fixedHistoricalBlobs), ...Object.keys(frozenAttemptedClosureBlobs), ...Object.keys(frozenCorrectionBlobs), ...Object.keys(frozenCurrentRecoveryBlobs)],
  'immutable governance history'
);

const step2Seal = json('simulation/executable-seal-v2.json');
for (const binding of step2Seal.bindings) {
  assert(exists(binding.path), `Step 2 seal binding missing: ${binding.path}`);
  assert(git(['rev-parse', `HEAD:${binding.path}`]) === binding.blob, `Step 2 seal binding changed: ${binding.path}`);
}
const oldInstructionBlob = '2b42e9907bf19724dd5eb3342872aaa931424be9';
assert(git(['rev-parse', `${rootControl.entry.head}:CHATGPT_PROJECT_INSTRUCTIONS1.md`]) === oldInstructionBlob, 'historical worktree no longer contains Step 2-bound Project instructions');
assert(git(['rev-parse', 'HEAD:CHATGPT_PROJECT_INSTRUCTIONS1.md']) !== oldInstructionBlob, 'Project instructions replacement did not occur');

for (const p of ['CHATGPT_PROJECT_INSTRUCTIONS1.md', 'DEVELOPMENT_PLAYBOOK.md', 'PROJECT_SOURCE_MANIFEST.md']) {
  assert(exists(p), `missing Project source: ${p}`);
}
const instructions = text('CHATGPT_PROJECT_INSTRUCTIONS1.md');
const playbook = text('DEVELOPMENT_PLAYBOOK.md');
assert(!instructions.includes('simulation/candidate-v1.json'), 'Project instructions still activate candidate-v1');
assert(!instructions.includes('Step 4: **READY_TO_START**'), 'Project instructions contain stale Step 4 status');
for (const required of ['Downstream Usability Contract', 'Representative proof before volume', 'PASS_RUNTIME']) {
  assert(instructions.includes(required) || playbook.includes(required), `missing methodology marker: ${required}`);
}
for (const required of ['Downstream consumer', 'State family', 'Data authority', 'Performance budget', 'Failure behavior', 'Evidence']) {
  assert(playbook.includes(required), `playbook missing downstream field: ${required}`);
}

assertDeleted(rootControl.deleteFromLiveKimi, 'round 028 deletion');
assertDeleted(correction.deleteFromLiveKimi, 'round 029 deletion');
for (const p of [
  '.github/workflows/verify-current-governance.yml',
  '.github/workflows/verify-history-round7.yml',
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  'quality-reviews/phase-0-governance-recovery/acceptance-matrix.json',
  'step4/s02/golden-master-p1/index.html'
]) {
  assert(exists(p), `required current verifier or preserved product path missing: ${p}`);
}
for (const p of ['index.html', 'game-core.js']) assert(exists(p), `required legacy history path missing: ${p}`);

const currentDocs = [
  'PROJECT_STATUS.json', 'AI_PROJECT_POLICY.json', 'QUALITY_GATE.md', 'PROJECT_HANDOVER.md',
  'AGENTS.md', 'simulation/CURRENT_STATUS.json', '.github/workflows/CURRENT_STATUS.md'
].map(text).join('\n');
const humanTruthFiles = ['QUALITY_GATE.md', 'PROJECT_HANDOVER.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'README.md'];
const humanTruthBlock = `\`\`\`text
STEP4_STATUS: IN_PROGRESS
STEP5_ALLOWED: false
PRODUCTION_ALIAS_CHANGED: false
PRODUCTION_READY: false
PHYSICAL_IPHONE_VERIFIED: false
USER_VISUAL_APPROVAL: false
\`\`\``;
function insertOnce(source, anchor, insertion, label) {
  assert(source.split(anchor).length - 1 === 1, `${label}: trusted insertion anchor is missing or duplicated`);
  return source.replace(anchor, `${anchor}${insertion}`);
}
function replaceOnce(source, search, replacement, label) {
  assert(source.split(search).length - 1 === 1, `${label}: trusted replacement source is missing or duplicated`);
  return source.replace(search, replacement);
}
function expectedRepairDocumentText(file) {
  let source = textAt(trustedRound031RepairBase.commit, file);
  const insertions = {
    'QUALITY_GATE.md': ['Authority: `CURRENT_AUTHORITY_INDEX.json`\n', `\n${humanTruthBlock}\n`],
    'PROJECT_HANDOVER.md': ['Branch: existing `kimi` only\n', `\n${humanTruthBlock}\n`],
    '.github/workflows/CURRENT_STATUS.md': ['Authority: `CURRENT_AUTHORITY_INDEX.json`\n', `\n${humanTruthBlock}\n`],
    'AGENTS.md': ['Do not infer current status from historical headers, chat history, old workflows or file existence.\n', `\n${humanTruthBlock}\n`],
    'README.md': ['猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登り、一つの`reset.tower_return`で1Fから前回より速く再攻略する、スマートフォン縦画面向け放置インクリメンタルRPG。\n', `\n${humanTruthBlock}\n`]
  };
  const [anchor, insertion] = insertions[file];
  source = insertOnce(source, anchor, insertion, file);
  if (file === 'AGENTS.md') {
    const stale = 'Step 2 is `PASS_CONTRACT`. At current HEAD verify immutable seal bindings; run its source-bound verifier in the intact historical worktree. Do not modify the seal to match current Project instructions.';
    const corrected = 'Step 2 is `IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED`. The immutable v2 byte bindings still reproduce, but canonical S01-S12 semantics require the versioned round 032 correction. Run the source-bound verifier in the intact historical worktree and do not modify the old seal.';
    source = replaceOnce(source, stale, corrected, 'AGENTS Step 2 statement');
  }
  return source;
}
function assertExactRepairDocumentTransforms(commit) {
  for (const file of humanTruthFiles) {
    const actual = commit === 'WORKTREE' ? text(file) : textAt(commit, file);
    assert(actual === expectedRepairDocumentText(file), `repair target changed ${file} beyond the exact truth-block insertion${file === 'AGENTS.md' ? ' and Step 2 correction' : ''}`);
  }
}
function expectedPostCriticDocumentText(file) {
  let source = expectedRepairDocumentText(file);
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, '- P1: **5**', '- P1: **1**', 'QUALITY_GATE post-critic P1 count');
    for (const id of ['PHASE0-POST-CLOSURE-BOUNDARY-001', 'PHASE0-ACCEPTANCE-CLOSURE-ID-001', 'PHASE0-PREMATURE-EVIDENCE-001', 'PHASE0-IMMUTABLE-EVIDENCE-OVERWRITE-001']) {
      source = replaceOnce(source, `  - \`${id}\`\n`, '', `QUALITY_GATE resolved ${id}`);
    }
    source = replaceOnce(
      source,
      'Round 030 is preserved as a superseded closure attempt. Independent criticism completed afterward and found four P1 closure-integrity defects. Round 031 now implements the every-push boundary, Acceptance lineage, numbered-evidence requirement, immutable-history freeze and future evidence-order checks; all four remain open until an independent re-critic verifies this repair commit. Product writes remain paused while round 032 corrects Step 2 and until round 033 binds the numbered replacement evidence and returns authority to round 026.',
      'Round 030 is preserved as a superseded closure attempt. The numbered independent re-critic verified the round 031 repair with Phase 0 P0/P1 at 0/0. Product writes remain paused while round 032 corrects Step 2 and until round 033 binds the numbered replacement evidence and returns authority to round 026.',
      'QUALITY_GATE post-critic conclusion'
    );
    source = replaceOnce(source, '- Current Phase 0 P0/P1: `0 / 4` pending independent re-criticism', '- Current Phase 0 P0/P1: `0 / 0` after numbered independent re-criticism', 'QUALITY_GATE post-critic count');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(
      source,
      'Phase 0 governance closure was reopened after independent criticism found four closure-integrity P1 defects. Round 031 implements the repairs, but the four findings remain open until this repair commit passes independent re-criticism. Step 2 correction and corrected closure evidence remain pending.',
      'Phase 0 governance closure was reopened after independent criticism found four closure-integrity P1 defects. The numbered independent re-critic has now verified the round 031 repair at P0/P1 0/0. Step 2 correction and corrected closure evidence remain pending.',
      'handover post-critic conclusion'
    );
    source = replaceOnce(source, '- Current Phase 0 unresolved pending repair re-criticism: P0/P1 `0 / 4`', '- Current Phase 0 unresolved after numbered repair re-criticism: P0/P1 `0 / 0`', 'handover post-critic count');
    source = replaceOnce(source, '1. independently re-criticize the round 031 closure-integrity repair\n2. open round 032 and correct the canonical S01-S12 projection without rewriting immutable v2 history\n3. reseal the corrected Step 2 contract and prove Step 3 numeric-model continuity\n4. bind numbered critic, judge, completion and live-readback evidence in round 033\n5. only after round 033 returns authority to round 026, freeze and audit S02-P1 A-J and GM01-GM08\n6. reuse conforming material, repair evidenced gaps and run browser/render verification\n7. reach at most `READY_FOR_USER_VISUAL_REVIEW`', '1. open round 032 and correct the canonical S01-S12 projection without rewriting immutable v2 history\n2. reseal the corrected Step 2 contract and prove Step 3 numeric-model continuity\n3. bind numbered critic, judge, completion and live-readback evidence in round 033\n4. only after round 033 returns authority to round 026, freeze and audit S02-P1 A-J and GM01-GM08\n5. reuse conforming material, repair evidenced gaps and run browser/render verification\n6. reach at most `READY_FOR_USER_VISUAL_REVIEW`', 'handover post-critic next actions');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- current Phase 0 P0/P1 pending independent re-criticism of the repair: `0 / 4`', '- current Phase 0 P0/P1 after numbered independent re-criticism: `0 / 0`', 'workflow status post-critic count');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Repair the Phase 0 closure boundary, then correct the canonical S01-S12 screen projection under round 032. Keep the preserved S02-P1 route, A-J artifacts and GM01-GM08 read-only until round 033 returns authority to round 026.', 'The numbered round 031 repair critic passed at Phase 0 P0/P1 0/0. Open round 032 for the canonical S01-S12 screen projection correction. Keep the preserved S02-P1 route, A-J artifacts and GM01-GM08 read-only until round 033 returns authority to round 026.', 'AGENTS post-critic next action');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'First repair the Phase 0 closure evidence and post-closure write boundary under round 031, then repair the narrow Step 2 screen projection under round 032. After corrected round 033 closure returns authority to round 026, audit the preserved S02-P1 content against deliverables A-J and GM01-GM08. The actual root, gameplay core, economy, backend, Production and physical-device verdict remain unchanged.', 'The numbered independent re-critic verified the round 031 repair at Phase 0 P0/P1 0/0. Next, correct the narrow Step 2 screen projection under round 032. After corrected round 033 closure returns authority to round 026, audit the preserved S02-P1 content against deliverables A-J and GM01-GM08. The actual root, gameplay core, economy, backend, Production and physical-device verdict remain unchanged.', 'README post-critic current work');
  }
  return source;
}
function assertExactPostCriticDocumentTransforms(commit) {
  for (const file of humanTruthFiles) assert(textAt(commit, file) === expectedPostCriticDocumentText(file), `post-critic document differs from exact transform: ${file}`);
}
const round032Snapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${step2CorrectionPath} | STEP 4 | STEP2-SCREEN-PROJECTION-CORRECTION | IN_PROGRESS_STEP2_SCREEN_PROJECTION_CORRECTION`;
const round033Snapshot = 'CURRENT_AUTHORITY_SNAPSHOT: quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json | STEP 4 | S02-P1-GOLDEN-MASTER | IN_PROGRESS_S02_P1_A_J_AUDIT';
function expectedRound032DocumentText(file) {
  const common = `${humanTruthBlock}\n`;
  const documents = {
    'QUALITY_GATE.md': `# Cat's Tower — Current Quality Gate\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round032Snapshot}\n\n## Current gate\n\n- Repository Step: \`4\` / \`IN_PROGRESS\`\n- Internal phase: \`STEP2-SCREEN-PROJECTION-CORRECTION\`\n- Step 2: \`IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED\`; immutable v2 remains historical evidence\n- Phase 0 unresolved P0/P1: \`0 / 0\` after the numbered round 031 independent re-critic\n- Current global P0/P1: \`1 / 1\` (Step 2 screen projection / S02 visual quality)\n- Step 4 PASS: \`false\`; Step 5 allowed: \`false\`\n\n## Allowed next work\n\nCorrect only the versioned S01-S12 screen projection under round 032, bind v3 review and Step 3 continuity evidence, then close Phase 0 through round 033. S02 product content remains read-only.\n`,
    'PROJECT_HANDOVER.md': `# Cat's Tower — Current Handover\n\nRepository: \`2hg7trp7rv-design/cats_tower\`\nBranch: existing \`kimi\` only\n\n${common}\n${round032Snapshot}\n\n## Purpose\n\nRepair the canonical Step 2 S01-S12 screen projection without changing immutable v2 history, runtime, economy, save data, Production or device claims.\n\n## Completed so far\n\nThe numbered round 031 independent re-critic verified the closure-integrity repair at Phase 0 P0/P1 \`0 / 0\`. Round 032 is active; S02 A-J and GM01-GM08 remain preserved and read-only.\n\n## Next\n\n1. create and validate the versioned v3 semantic contract\n2. bind independent critic, judge, completion and live readback\n3. prove Step 3 numeric continuity\n4. close corrected Phase 0 under round 033\n5. return to round 026 and audit the preserved S02 Golden Master\n`,
    '.github/workflows/CURRENT_STATUS.md': `# Cat's Tower — Current Workflow Status\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round032Snapshot}\n\n## Enforced state\n\n- every \`kimi\` push runs current-governance verification\n- Step 2 v2 is immutable historical evidence; semantic status remains open\n- round 032 may write only the reviewed v3 correction and numbered evidence paths\n- S02 product, runtime, economy, save, Production and physical-device state are frozen\n- corrected closure is reserved for round 033 after live provenance and continuity succeed\n`,
    'AGENTS.md': `# Cat's Tower — Agent Execution Boundary\n\nDo not infer current status from historical headers, chat history, old workflows or file existence.\n\n${common}\n${round032Snapshot}\n\n## Current authority\n\nRead \`CURRENT_AUTHORITY_INDEX.json\`, then the active round 032 control. Work only on the versioned Step 2 screen-projection correction. Do not rewrite v2 evidence or mutate S02 product content, runtime, economy, save, assets, Vercel Production or provider settings.\n\n## Required sequence\n\nSemantic target, independent critic, final judge, completion, live readback, v3 seal, continuity-only commit, PASS activation, numbered Phase 0 evidence, then exact round 033 closure.\n`,
    'README.md': `# Cat's Tower\n\n猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登る、スマートフォン縦画面向け放置インクリメンタルRPG。\n\n${common}\n${round032Snapshot}\n\n## Current work\n\nRepository Step 4 remains in progress. The active work is the narrow, versioned Step 2 S01-S12 screen-projection correction required before the preserved S02 Golden Master can be audited and repaired. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.\n`
  };
  assert(Object.hasOwn(documents, file), `round 032 document template missing: ${file}`);
  return documents[file];
}
function expectedRound033DocumentText(file) {
  const common = `${humanTruthBlock}\n`;
  const documents = {
    'QUALITY_GATE.md': `# Cat's Tower — Current Quality Gate\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round033Snapshot}\n\n## Current gate\n\n- Repository Step: \`4\` / \`IN_PROGRESS\`\n- Step 2: \`PASS_CONTRACT\` under immutable v3 screen-projection seal\n- Step 3: \`PASS_MODEL\`; this is not runtime playtest evidence\n- Corrected Phase 0 unresolved P0/P1: \`0 / 0\`\n- Current S02 visual P1: \`1\` (\`S4-RECOVERY-VIS-001\`)\n- Step 4 PASS: \`false\`; Step 5 allowed: \`false\`\n\n## Allowed next work\n\nAudit the preserved S02 A-J and GM01-GM08 under round 026, reuse conforming material and repair only evidenced gaps. The maximum before explicit user visual approval is \`READY_FOR_USER_VISUAL_REVIEW\`.\n`,
    'PROJECT_HANDOVER.md': `# Cat's Tower — Current Handover\n\nRepository: \`2hg7trp7rv-design/cats_tower\`\nBranch: existing \`kimi\` only\n\n${common}\n${round033Snapshot}\n\n## Purpose\n\nBuild a production-quality S02 Golden Master and implementation contract before replacing the actual game runtime.\n\n## Completed so far\n\nRound 031 closure-integrity repair, the versioned Step 2 v3 screen projection, Step 3 continuity proof and numbered Phase 0 review chain are closed by round 033. Existing S02 A-J and GM01-GM08 are preserved but not visually accepted.\n\n## Next\n\n1. inventory the preserved S02 deliverables\n2. repair all independently evidenced visual P1 gaps\n3. verify 320–430 px responsive and accessibility boundaries\n4. publish only a Preview design-review route\n5. request explicit user visual review; do not infer approval\n`,
    '.github/workflows/CURRENT_STATUS.md': `# Cat's Tower — Current Workflow Status\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round033Snapshot}\n\n## Enforced state\n\n- current authority returned to round 026 after corrected Phase 0 closure\n- immutable Step 2 v3 seal and Step 3 continuity evidence remain verified\n- current product work is the S02 A-J / GM01-GM08 audit\n- root runtime, economy, save, Production and physical-device state remain unchanged\n- current maximum is \`READY_FOR_USER_VISUAL_REVIEW\`\n`,
    'AGENTS.md': `# Cat's Tower — Agent Execution Boundary\n\nDo not infer current status from historical headers, chat history, old workflows or file existence.\n\n${common}\n${round033Snapshot}\n\n## Current authority\n\nRead \`CURRENT_AUTHORITY_INDEX.json\`, then round 026. Audit the preserved S02 A-J and GM01-GM08 first. Reuse conforming content and repair only independently evidenced gaps. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts during S02-P1.\n`,
    'README.md': `# Cat's Tower\n\n猫と猫人の4体編成を育て、店舗・配送の支援を受けながら上限のない塔を登る、スマートフォン縦画面向け放置インクリメンタルRPG。\n\n${common}\n${round033Snapshot}\n\n## Current work\n\nRepository Step 4 remains in progress. Corrected Phase 0 has returned authority to the S02-P1 Golden Master audit. The preserved design-review route and eight states are inputs, not accepted output; independently evidenced gaps must be repaired before user visual review. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.\n`
  };
  assert(Object.hasOwn(documents, file), `round 033 document template missing: ${file}`);
  return documents[file];
}
function expectedRound032PassDocumentText(file) {
  let source = expectedRound032DocumentText(file);
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, '- Step 2: `IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED`; immutable v2 remains historical evidence', `- Step 2: \`PASS_CONTRACT\` under \`${v3SealPath}\`; immutable v2 remains historical evidence`, 'round 032 PASS quality Step 2');
    source = replaceOnce(source, '- Current global P0/P1: `1 / 1` (Step 2 screen projection / S02 visual quality)', '- Current global P0/P1: `0 / 1` (S02 visual quality)', 'round 032 PASS quality counts');
    source = replaceOnce(source, 'Correct only the versioned S01-S12 screen projection under round 032, bind v3 review and Step 3 continuity evidence, then close Phase 0 through round 033. S02 product content remains read-only.', `The versioned S01-S12 screen projection is sealed by \`${v3SealPath}\` and Step 3 continuity is verified. Bind the numbered corrected Phase 0 review chain, then close through round 033. S02 product content remains read-only.`, 'round 032 PASS quality next');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, 'Repair the canonical Step 2 S01-S12 screen projection without changing immutable v2 history, runtime, economy, save data, Production or device claims.', `Close corrected Phase 0 after \`${v3SealPath}\` and Step 3 continuity proved the versioned Step 2 repair without changing runtime, economy, save data, Production or device claims.`, 'round 032 PASS handover purpose');
    source = replaceOnce(source, 'The numbered round 031 independent re-critic verified the closure-integrity repair at Phase 0 P0/P1 `0 / 0`. Round 032 is active; S02 A-J and GM01-GM08 remain preserved and read-only.', `The numbered round 031 re-critic passed; Step 2 is now \`PASS_CONTRACT\` under \`${v3SealPath}\`; Step 3 continuity is verified. Round 032 remains active only for numbered Phase 0 evidence and round 033 closure. S02 A-J and GM01-GM08 remain read-only.`, 'round 032 PASS handover progress');
    source = replaceOnce(source, '1. create and validate the versioned v3 semantic contract\n2. bind independent critic, judge, completion and live readback\n3. prove Step 3 numeric continuity\n4. close corrected Phase 0 under round 033\n5. return to round 026 and audit the preserved S02 Golden Master', '1. bind the numbered Phase 0 independent critic\n2. bind final judge, completion and live readback\n3. close corrected Phase 0 under round 033\n4. return to round 026 and audit the preserved S02 Golden Master', 'round 032 PASS handover next');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- Step 2 v2 is immutable historical evidence; semantic status remains open', `- Step 2 v2 is immutable historical evidence; corrected v3 is \`PASS_CONTRACT\` under \`${v3SealPath}\``, 'round 032 PASS workflow Step 2');
    source = replaceOnce(source, '- round 032 may write only the reviewed v3 correction and numbered evidence paths', '- round 032 may now write only numbered corrected-Phase-0 evidence paths', 'round 032 PASS workflow boundary');
    source = replaceOnce(source, '- corrected closure is reserved for round 033 after live provenance and continuity succeed', '- live provenance and Step 3 continuity succeeded; corrected closure remains reserved for round 033 after numbered Phase 0 review', 'round 032 PASS workflow next');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Read `CURRENT_AUTHORITY_INDEX.json`, then the active round 032 control. Work only on the versioned Step 2 screen-projection correction. Do not rewrite v2 evidence or mutate S02 product content, runtime, economy, save, assets, Vercel Production or provider settings.', `Read \`CURRENT_AUTHORITY_INDEX.json\`, then round 032. Step 2 is \`PASS_CONTRACT\` under \`${v3SealPath}\`; write only the numbered corrected-Phase-0 critic, judge, completion, live readback and exact round 033 closure. Do not mutate S02 product content, runtime, economy, save, assets, Vercel Production or provider settings.`, 'round 032 PASS agent boundary');
    source = replaceOnce(source, 'Semantic target, independent critic, final judge, completion, live readback, v3 seal, continuity-only commit, PASS activation, numbered Phase 0 evidence, then exact round 033 closure.', 'Numbered Phase 0 independent critic, final judge, completion, live readback, then exact round 033 closure and return to the S02 audit.', 'round 032 PASS agent sequence');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'Repository Step 4 remains in progress. The active work is the narrow, versioned Step 2 S01-S12 screen-projection correction required before the preserved S02 Golden Master can be audited and repaired. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', `Repository Step 4 remains in progress. Step 2 is \`PASS_CONTRACT\` under \`${v3SealPath}\` with Step 3 continuity verified; the active work is now the numbered corrected-Phase-0 review and exact round 033 closure before S02 audit resumes. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.`, 'round 032 PASS README current work');
  }
  return source;
}
const round034RepairSnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02RepairControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | IN_PROGRESS_S02_P1_VISUAL_REPAIR`;
const round034ReadySnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02RepairControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | READY_FOR_USER_VISUAL_REVIEW`;
function expectedRound034RepairDocumentText(file) {
  let source = expectedRound033DocumentText(file).replace(round033Snapshot, round034RepairSnapshot);
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, '- Current S02 visual P1: `1` (`S4-RECOVERY-VIS-001`)', '- Current S02 P1: `11` (`S4-RECOVERY-VIS-001` plus 10 independently evidenced Golden Master repair groups)', 'round 034 repair quality count');
    source = replaceOnce(source, 'Audit the preserved S02 A-J and GM01-GM08 under round 026, reuse conforming material and repair only evidenced gaps. The maximum before explicit user visual approval is `READY_FOR_USER_VISUAL_REVIEW`.', 'Round 034 is the latest-user-decision control. Repair the 10 independently evidenced Golden Master P1 groups, rerun exact static/browser/responsive/accessibility checks, and obtain an independent P0/P1-zero judgment. The maximum remains `READY_FOR_USER_VISUAL_REVIEW`.', 'round 034 repair quality next');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, 'Round 031 closure-integrity repair, the versioned Step 2 v3 screen projection, Step 3 continuity proof and numbered Phase 0 review chain are closed by round 033. Existing S02 A-J and GM01-GM08 are preserved but not visually accepted.', 'Round 033 closed the governance repair and Round 034 records the latest user decision. Independent audit found 10 S02 Golden Master P1 repair groups; A-J and GM01-GM08 remain unaccepted until all are repaired and re-judged.', 'round 034 repair handover progress');
    source = replaceOnce(source, '1. inventory the preserved S02 deliverables\n2. repair all independently evidenced visual P1 gaps\n3. verify 320–430 px responsive and accessibility boundaries\n4. publish only a Preview design-review route\n5. request explicit user visual review; do not infer approval', '1. repair all 10 independently evidenced S02 P1 groups\n2. verify all required 320–430 px viewports, Safe Area, 200% text and 44/48 px targets\n3. bind static, browser, independent critic, final judge and Preview deployment evidence\n4. publish only the design-review Preview route\n5. request explicit user visual review; do not infer approval', 'round 034 repair handover next');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- current authority returned to round 026 after corrected Phase 0 closure', '- corrected Phase 0 returned through round 026; current authority is the latest-user-decision S02 repair control round 034', 'round 034 repair workflow authority');
    source = replaceOnce(source, '- current product work is the S02 A-J / GM01-GM08 audit', '- current product work repairs 10 independently evidenced S02 Golden Master P1 groups', 'round 034 repair workflow product');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Read `CURRENT_AUTHORITY_INDEX.json`, then round 026. Audit the preserved S02 A-J and GM01-GM08 first. Reuse conforming content and repair only independently evidenced gaps. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts during S02-P1.', 'Read `CURRENT_AUTHORITY_INDEX.json`, then round 034. Repair exactly the 10 independently evidenced S02 P1 groups; reuse conforming A-J and GM01-GM08 material. Require independent P0/P1-zero review and exact Preview evidence before `READY_FOR_USER_VISUAL_REVIEW`. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'round 034 repair agent boundary');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'Repository Step 4 remains in progress. Corrected Phase 0 has returned authority to the S02-P1 Golden Master audit. The preserved design-review route and eight states are inputs, not accepted output; independently evidenced gaps must be repaired before user visual review. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'Repository Step 4 remains in progress under the latest-user-decision round 034 control. Ten independently evidenced S02 Golden Master P1 groups are being repaired before user visual review; the preserved route and eight states remain unaccepted inputs. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'round 034 repair README current work');
  }
  return source;
}
function expectedRound034ReadyDocumentText(file) {
  let source = expectedRound034RepairDocumentText(file).replace(round034RepairSnapshot, round034ReadySnapshot);
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, '- Current S02 P1: `11` (`S4-RECOVERY-VIS-001` plus 10 independently evidenced Golden Master repair groups)', '- Current S02 P1: `1` (`S4-RECOVERY-VIS-001`; the 10 internal Golden Master repair groups are independently resolved)', 'round 034 ready quality count');
    source = replaceOnce(source, 'Round 034 is the latest-user-decision control. Repair the 10 independently evidenced Golden Master P1 groups, rerun exact static/browser/responsive/accessibility checks, and obtain an independent P0/P1-zero judgment. The maximum remains `READY_FOR_USER_VISUAL_REVIEW`.', 'The 10 internal Golden Master repair groups have exact static/browser/responsive/accessibility evidence and an independent P0/P1-zero judgment. Present the immutable Preview deployment for explicit user visual review; do not infer approval and do not start P2.', 'round 034 ready quality next');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, 'Round 033 closed the governance repair and Round 034 records the latest user decision. Independent audit found 10 S02 Golden Master P1 repair groups; A-J and GM01-GM08 remain unaccepted until all are repaired and re-judged.', 'Round 033 closed the governance repair. Under Round 034, all 10 internal S02 Golden Master P1 repair groups were independently re-judged at P0/P1 0/0 and bound to the immutable Preview deployment. User visual approval remains unobtained.', 'round 034 ready handover progress');
    source = replaceOnce(source, '1. repair all 10 independently evidenced S02 P1 groups\n2. verify all required 320–430 px viewports, Safe Area, 200% text and 44/48 px targets\n3. bind static, browser, independent critic, final judge and Preview deployment evidence\n4. publish only the design-review Preview route\n5. request explicit user visual review; do not infer approval', '1. present all eight Golden Masters individually on the immutable Preview deployment\n2. collect explicit user visual approval or concrete revision requests\n3. if revisions are requested, reopen only the evidenced S02 gaps\n4. do not start P2 asset production before explicit approval and bound evidence', 'round 034 ready handover next');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- current product work repairs 10 independently evidenced S02 Golden Master P1 groups', '- the 10 internal Golden Master repair groups are independently resolved; current state is `READY_FOR_USER_VISUAL_REVIEW`', 'round 034 ready workflow product');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Read `CURRENT_AUTHORITY_INDEX.json`, then round 034. Repair exactly the 10 independently evidenced S02 P1 groups; reuse conforming A-J and GM01-GM08 material. Require independent P0/P1-zero review and exact Preview evidence before `READY_FOR_USER_VISUAL_REVIEW`. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'Read `CURRENT_AUTHORITY_INDEX.json`, then round 034. The internal S02 Golden Master critic is P0/P1 0/0 and the current maximum is `READY_FOR_USER_VISUAL_REVIEW`. Await explicit user visual approval; do not infer it or start P2. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'round 034 ready agent boundary');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'Repository Step 4 remains in progress under the latest-user-decision round 034 control. Ten independently evidenced S02 Golden Master P1 groups are being repaired before user visual review; the preserved route and eight states remain unaccepted inputs. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'Repository Step 4 remains in progress under round 034. The 10 internal Golden Master repair groups are independently resolved and the eight individual states are ready for user visual review on the immutable Preview deployment. User approval is not yet obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'round 034 ready README current work');
  }
  return source;
}
const round035ReadySnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02P2ControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | READY_FOR_S02_P2_ASSET_PRODUCTION`;
function expectedRound035DocumentText(file) {
  let source = expectedRound034ReadyDocumentText(file)
    .replace(round034ReadySnapshot, round035ReadySnapshot)
    .replace('USER_VISUAL_APPROVAL: false', 'USER_VISUAL_APPROVAL: true');
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, '- Current S02 P1: `1` (`S4-RECOVERY-VIS-001`; the 10 internal Golden Master repair groups are independently resolved)', '- Current product P1: `1` (`S4-RECOVERY-VIS-001` remains open for later actual-runtime recovery); S02-P1 internal P0/P1: `0 / 0`', 'round 035 quality count');
    source = replaceOnce(source, 'The 10 internal Golden Master repair groups have exact static/browser/responsive/accessibility evidence and an independent P0/P1-zero judgment. Present the immutable Preview deployment for explicit user visual review; do not infer approval and do not start P2.', 'The explicit user-decision lock approves the exact eight Golden Masters for P2 asset production. Create one representative production-asset proof under round 035; do not generate asset volume or replace runtime before PASS_ASSET.', 'round 035 quality next');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, 'Round 033 closed the governance repair. Under Round 034, all 10 internal S02 Golden Master P1 repair groups were independently re-judged at P0/P1 0/0 and bound to the immutable Preview deployment. User visual approval remains unobtained.', 'Round 033 closed the governance repair. Round 034 reached independently verified P0/P1 0/0 and the exact Preview target received explicit user visual approval recorded by the immutable round 006 decision lock. Round 035 authorizes only the representative S02 P2 asset proof.', 'round 035 handover progress');
    source = replaceOnce(source, '1. present all eight Golden Masters individually on the immutable Preview deployment\n2. collect explicit user visual approval or concrete revision requests\n3. if revisions are requested, reopen only the evidenced S02 gaps\n4. do not start P2 asset production before explicit approval and bound evidence', '1. produce one representative production asset set from the approved Golden Master\n2. verify model consistency, animation anchors, 9-slice behavior, size and runtime separability\n3. obtain independent PASS_ASSET before any volume generation\n4. keep actual runtime, Step 4, Step 5 and Production unchanged', 'round 035 handover next');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- the 10 internal Golden Master repair groups are independently resolved; current state is `READY_FOR_USER_VISUAL_REVIEW`', '- the exact eight Golden Masters received explicit user approval; current state is `READY_FOR_S02_P2_ASSET_PRODUCTION` for one representative asset proof only', 'round 035 workflow product');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Read `CURRENT_AUTHORITY_INDEX.json`, then round 034. The internal S02 Golden Master critic is P0/P1 0/0 and the current maximum is `READY_FOR_USER_VISUAL_REVIEW`. Await explicit user visual approval; do not infer it or start P2. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'Read `CURRENT_AUTHORITY_INDEX.json`, round 035 and the immutable round 006 user-decision lock. Produce only one representative S02 P2 production-asset proof. Do not generate asset volume before PASS_ASSET or replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'round 035 agent boundary');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'Repository Step 4 remains in progress under round 034. The 10 internal Golden Master repair groups are independently resolved and the eight individual states are ready for user visual review on the immutable Preview deployment. User approval is not yet obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'Repository Step 4 remains in progress under round 035. The exact eight Golden Masters received explicit user visual approval and one representative S02 P2 production-asset proof is authorized. S02 is not complete; runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'round 035 README current work');
  }
  return source;
}
const round036RevisionSnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02RevisionControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | IN_PROGRESS_S02_P1_USER_REVISION`;
const round036ReadySnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02RevisionControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | READY_FOR_USER_VISUAL_REVIEW`;
function expectedRound036RevisionDocumentText(file) {
  const revisionCount = s02RevisionDecisionLock?.requestedChanges?.length ?? 0;
  let source = expectedRound034ReadyDocumentText(file).replace(round034ReadySnapshot, round036RevisionSnapshot);
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, '- Current S02 P1: `1` (`S4-RECOVERY-VIS-001`; the 10 internal Golden Master repair groups are independently resolved)', `- Current S02 P1: \`${1 + revisionCount}\` (\`S4-RECOVERY-VIS-001\` plus ${revisionCount} exact user-requested revision group${revisionCount === 1 ? '' : 's'})`, 'round 036 revision quality count');
    source = replaceOnce(source, 'The 10 internal Golden Master repair groups have exact static/browser/responsive/accessibility evidence and an independent P0/P1-zero judgment. Present the immutable Preview deployment for explicit user visual review; do not infer approval and do not start P2.', 'Round 036 reopens only the exact paths named by the immutable round 007 user-revision lock. Repeat the complete static, browser, critic, judge and external Preview readback chain before returning to user review; P2 remains blocked.', 'round 036 revision quality next');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, 'Round 033 closed the governance repair. Under Round 034, all 10 internal S02 Golden Master P1 repair groups were independently re-judged at P0/P1 0/0 and bound to the immutable Preview deployment. User visual approval remains unobtained.', 'Round 034 reached internal P0/P1 0/0 and produced the first immutable Preview. The user requested concrete changes instead of approving it; round 036 binds those requests and reopens only their exact S02 paths. The round 001 evidence remains immutable.', 'round 036 revision handover progress');
    source = replaceOnce(source, '1. present all eight Golden Masters individually on the immutable Preview deployment\n2. collect explicit user visual approval or concrete revision requests\n3. if revisions are requested, reopen only the evidenced S02 gaps\n4. do not start P2 asset production before explicit approval and bound evidence', '1. change only the exact paths bound by the round 007 user-revision lock\n2. rerun the trusted S02 workflow and all required viewport checks\n3. create the round 002 critic, judge, completion and external Preview readback chain\n4. return only to `READY_FOR_USER_VISUAL_REVIEW`; do not start P2', 'round 036 revision handover next');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- the 10 internal Golden Master repair groups are independently resolved; current state is `READY_FOR_USER_VISUAL_REVIEW`', '- round 036 is limited to the exact user-requested S02 paths; round 001 evidence remains immutable and P2 remains blocked', 'round 036 revision workflow product');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Read `CURRENT_AUTHORITY_INDEX.json`, then round 034. The internal S02 Golden Master critic is P0/P1 0/0 and the current maximum is `READY_FOR_USER_VISUAL_REVIEW`. Await explicit user visual approval; do not infer it or start P2. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'Read `CURRENT_AUTHORITY_INDEX.json`, round 036 and the immutable round 007 user-revision lock. Change only its exact target paths, then complete the round 002 review and Preview readback chain. Do not mutate trusted tests, runtime, gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'round 036 revision agent boundary');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'Repository Step 4 remains in progress under round 034. The 10 internal Golden Master repair groups are independently resolved and the eight individual states are ready for user visual review on the immutable Preview deployment. User approval is not yet obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'Repository Step 4 remains in progress under round 036. The user requested concrete revisions to the first S02 Golden Master Preview; only the exact bound S02 paths are being revised and the complete review chain will be repeated. User approval is not obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'round 036 revision README current work');
  }
  return source;
}
function expectedRound036ReadyDocumentText(file) {
  let source = expectedRound036RevisionDocumentText(file).replace(round036RevisionSnapshot, round036ReadySnapshot);
  const revisionCount = s02RevisionDecisionLock?.requestedChanges?.length ?? 0;
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, `- Current S02 P1: \`${1 + revisionCount}\` (\`S4-RECOVERY-VIS-001\` plus ${revisionCount} exact user-requested revision group${revisionCount === 1 ? '' : 's'})`, '- Current S02 P1: `1` (`S4-RECOVERY-VIS-001`; all round 007 user-requested revisions are independently re-verified)', 'round 036 ready quality count');
    source = replaceOnce(source, 'Round 036 reopens only the exact paths named by the immutable round 007 user-revision lock. Repeat the complete static, browser, critic, judge and external Preview readback chain before returning to user review; P2 remains blocked.', 'The round 007 user-requested revisions passed the complete round 002 chain. Present the revised immutable Preview. Exact approval may open pre-reviewed round 037; a second exact revision may open pre-reviewed round 038. Do not infer approval or start P2.', 'round 036 ready quality next');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, 'Round 034 reached internal P0/P1 0/0 and produced the first immutable Preview. The user requested concrete changes instead of approving it; round 036 binds those requests and reopens only their exact S02 paths. The round 001 evidence remains immutable.', 'Round 034 produced the first immutable Preview. Round 036 applied only the exact round 007 user-requested paths and the complete round 002 review chain returned internal P0/P1 to 0/0 on a new immutable Preview. User visual approval remains unobtained; round 001 evidence remains immutable.', 'round 036 ready handover progress');
    source = replaceOnce(source, '1. change only the exact paths bound by the round 007 user-revision lock\n2. rerun the trusted S02 workflow and all required viewport checks\n3. create the round 002 critic, judge, completion and external Preview readback chain\n4. return only to `READY_FOR_USER_VISUAL_REVIEW`; do not start P2', '1. present all eight revised Golden Masters individually on the new immutable Preview\n2. exact approval may open pre-reviewed round 037\n3. a second revision may open only through the pre-reviewed round 038 successor\n4. do not infer approval or start P2', 'round 036 ready handover next');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- round 036 is limited to the exact user-requested S02 paths; round 001 evidence remains immutable and P2 remains blocked', '- round 036 revision evidence is complete; the revised S02 Preview is `READY_FOR_USER_VISUAL_REVIEW`; exact approval may open round 037 and a second exact revision may open round 038', 'round 036 ready workflow product');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Read `CURRENT_AUTHORITY_INDEX.json`, round 036 and the immutable round 007 user-revision lock. Change only its exact target paths, then complete the round 002 review and Preview readback chain. Do not mutate trusted tests, runtime, gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts.', 'Read `CURRENT_AUTHORITY_INDEX.json`, round 036 and immutable round 007. The revised Preview is ready after round 002 evidence. Await an exact decision: approval may open pre-reviewed round 037 or a second exact revision may open pre-reviewed round 038. Do not infer approval, start P2, or mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.', 'round 036 ready agent boundary');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'Repository Step 4 remains in progress under round 036. The user requested concrete revisions to the first S02 Golden Master Preview; only the exact bound S02 paths are being revised and the complete review chain will be repeated. User approval is not obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'Repository Step 4 remains in progress under round 036. The exact user-requested S02 revisions passed the complete round 002 review chain and the revised immutable Preview is ready for user visual review. User approval is not obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'round 036 ready README current work');
  }
  return source;
}
const round037ReadySnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02RevisedP2ControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | READY_FOR_S02_P2_ASSET_PRODUCTION`;
function expectedRound037DocumentText(file) {
  let source = expectedRound036ReadyDocumentText(file)
    .replace(round036ReadySnapshot, round037ReadySnapshot)
    .replace('USER_VISUAL_APPROVAL: false', 'USER_VISUAL_APPROVAL: true');
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, '- Current S02 P1: `1` (`S4-RECOVERY-VIS-001`; all round 007 user-requested revisions are independently re-verified)', '- Current product P1: `1` (`S4-RECOVERY-VIS-001` remains open for later actual-runtime recovery); revised S02-P1 internal P0/P1: `0 / 0`', 'round 037 quality count');
    source = replaceOnce(source, 'The round 007 user-requested revisions passed the complete round 002 chain. Present the revised immutable Preview. Exact approval may open pre-reviewed round 037; a second exact revision may open pre-reviewed round 038. Do not infer approval or start P2.', 'The round 008 user-decision lock explicitly approves the exact revised Golden Master target. Round 037 authorizes only one representative P2 production-asset proof; do not generate asset volume or replace runtime before PASS_ASSET.', 'round 037 quality next');
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, 'Round 034 produced the first immutable Preview. Round 036 applied only the exact round 007 user-requested paths and the complete round 002 review chain returned internal P0/P1 to 0/0 on a new immutable Preview. User visual approval remains unobtained; round 001 evidence remains immutable.', 'Round 036 applied the exact round 007 revisions and completed the round 002 review chain. The exact revised Preview then received explicit user approval recorded by immutable round 008; round 037 authorizes only one representative S02 P2 asset proof. Round 001 and round 002 evidence remain immutable.', 'round 037 handover progress');
    source = replaceOnce(source, '1. present all eight revised Golden Masters individually on the new immutable Preview\n2. exact approval may open pre-reviewed round 037\n3. a second revision may open only through the pre-reviewed round 038 successor\n4. do not infer approval or start P2', '1. produce one representative production asset set from the approved revised Golden Master\n2. verify model consistency, animation anchors, 9-slice behavior, size and runtime separability\n3. obtain independent PASS_ASSET before volume generation\n4. keep actual runtime, Step 4, Step 5 and Production unchanged', 'round 037 handover next');
  } else if (file === '.github/workflows/CURRENT_STATUS.md') {
    source = replaceOnce(source, '- round 036 revision evidence is complete; the revised S02 Preview is `READY_FOR_USER_VISUAL_REVIEW`; exact approval may open round 037 and a second exact revision may open round 038', '- the exact revised S02 Preview received explicit approval under round 008; round 037 permits only one representative P2 asset proof and keeps both review chains immutable', 'round 037 workflow product');
  } else if (file === 'AGENTS.md') {
    source = replaceOnce(source, 'Read `CURRENT_AUTHORITY_INDEX.json`, round 036 and immutable round 007. The revised Preview is ready after round 002 evidence. Await an exact decision: approval may open pre-reviewed round 037 or a second exact revision may open pre-reviewed round 038. Do not infer approval, start P2, or mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.', 'Read `CURRENT_AUTHORITY_INDEX.json`, round 037 and immutable round 008. Produce only one representative S02 P2 production-asset proof from the approved revised target. Do not generate asset volume before PASS_ASSET or mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.', 'round 037 agent boundary');
  } else if (file === 'README.md') {
    source = replaceOnce(source, 'Repository Step 4 remains in progress under round 036. The exact user-requested S02 revisions passed the complete round 002 review chain and the revised immutable Preview is ready for user visual review. User approval is not obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'Repository Step 4 remains in progress under round 037. The exact revised S02 Golden Master received explicit user visual approval and one representative P2 production-asset proof is authorized. S02 is not complete; runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.', 'round 037 README current work');
  }
  return source;
}
const round036ReadyDocumentStrings = {
  qualityCount: '- Current S02 P1: `1` (`S4-RECOVERY-VIS-001`; all round 007 user-requested revisions are independently re-verified)',
  qualityNext: 'The round 007 user-requested revisions passed the complete round 002 chain. Present the revised immutable Preview. Exact approval may open pre-reviewed round 037; a second exact revision may open pre-reviewed round 038. Do not infer approval or start P2.',
  handoverProgress: 'Round 034 produced the first immutable Preview. Round 036 applied only the exact round 007 user-requested paths and the complete round 002 review chain returned internal P0/P1 to 0/0 on a new immutable Preview. User visual approval remains unobtained; round 001 evidence remains immutable.',
  handoverNext: '1. present all eight revised Golden Masters individually on the new immutable Preview\n2. exact approval may open pre-reviewed round 037\n3. a second revision may open only through the pre-reviewed round 038 successor\n4. do not infer approval or start P2',
  workflowProduct: '- round 036 revision evidence is complete; the revised S02 Preview is `READY_FOR_USER_VISUAL_REVIEW`; exact approval may open round 037 and a second exact revision may open round 038',
  agent: 'Read `CURRENT_AUTHORITY_INDEX.json`, round 036 and immutable round 007. The revised Preview is ready after round 002 evidence. Await an exact decision: approval may open pre-reviewed round 037 or a second exact revision may open pre-reviewed round 038. Do not infer approval, start P2, or mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.',
  readme: 'Repository Step 4 remains in progress under round 036. The exact user-requested S02 revisions passed the complete round 002 review chain and the revised immutable Preview is ready for user visual review. User approval is not obtained. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.'
};
function additionalRevisionStrings(config) {
  const nextDecision = config.nextRevisionRound
    ? `Exact approval may open pre-reviewed round ${config.approvalRound}; another exact revision may open pre-reviewed round ${config.nextRevisionRound}.`
    : `Exact approval may open pre-reviewed round ${config.approvalRound}; a fourth revision is \`BLOCKED_PENDING_GOVERNANCE_EXTENSION\`.`;
  const nextLine = config.nextRevisionRound
    ? `3. another revision may open only through the pre-reviewed round ${config.nextRevisionRound} successor`
    : '3. a fourth revision is `BLOCKED_PENDING_GOVERNANCE_EXTENSION`';
  return {
    revisionQualityCount: count => `- Current S02 P1: \`${1 + count}\` (\`S4-RECOVERY-VIS-001\` plus ${count} exact round ${config.lockRound} user-requested revision group${count === 1 ? '' : 's'})`,
    revisionQualityNext: `Round ${config.controlRound} reopens only the exact paths and machine-checkable acceptance assertions in immutable round ${config.lockRound}. Complete versioned feasibility, same-run comparison, critic, judge and external Preview readback round ${config.evidenceRound}; P2 remains blocked.`,
    revisionHandoverProgress: `The preceding immutable Preview was not approved. Round ${config.controlRound} binds the next concrete user decision in immutable round ${config.lockRound}, preserves all earlier evidence and reopens only exact declared S02 paths.`,
    revisionHandoverNext: `1. change only exact round ${config.lockRound} target paths\n2. satisfy every request-specific acceptance assertion in the trusted same-run capture\n3. create feasibility, critic, judge, completion and Preview readback round ${config.evidenceRound}\n4. return only to \`READY_FOR_USER_VISUAL_REVIEW\`; do not start P2`,
    revisionWorkflowProduct: `- round ${config.controlRound} is limited to exact round ${config.lockRound} user-requested paths and acceptance assertions; all earlier review rounds remain immutable and P2 remains blocked`,
    revisionAgent: `Read \`CURRENT_AUTHORITY_INDEX.json\`, round ${config.controlRound} and immutable round ${config.lockRound}. Change only its exact target paths, satisfy each machine-checkable acceptance assertion, and complete review round ${config.evidenceRound}. Do not mutate trusted governance, runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.`,
    revisionReadme: `Repository Step 4 remains in progress under round ${config.controlRound}. The user requested another concrete S02 Golden Master revision; only exact bound paths and acceptance assertions may change before complete review round ${config.evidenceRound}. User approval is not obtained. Runtime, economy, save, backend, Production and device verdicts remain unchanged.`,
    readyQualityCount: `- Current S02 P1: \`1\` (\`S4-RECOVERY-VIS-001\`; all round ${config.lockRound} user-requested revisions are independently re-verified)`,
    readyQualityNext: `The round ${config.lockRound} requests passed complete review round ${config.evidenceRound}. Present the new immutable Preview. ${nextDecision} Do not infer approval or start P2.`,
    readyHandoverProgress: `Round ${config.controlRound} applied only exact round ${config.lockRound} requests; versioned feasibility and complete review round ${config.evidenceRound} returned P0/P1 to 0/0 on a new immutable Preview. User approval remains unobtained and all prior evidence remains immutable.`,
    readyHandoverNext: `1. present all eight revised Golden Masters individually\n2. exact approval may open pre-reviewed round ${config.approvalRound}\n${nextLine}\n4. do not infer approval or start P2`,
    readyWorkflowProduct: `- round ${config.controlRound} review round ${config.evidenceRound} is complete and \`READY_FOR_USER_VISUAL_REVIEW\`; approval may open round ${config.approvalRound}${config.nextRevisionRound ? ` and another exact revision may open round ${config.nextRevisionRound}` : '; further revision is blocked pending governance extension'}`,
    readyAgent: `Read \`CURRENT_AUTHORITY_INDEX.json\`, round ${config.controlRound} and immutable round ${config.lockRound}. Review round ${config.evidenceRound} is complete. Await the exact user decision; approval may open round ${config.approvalRound}${config.nextRevisionRound ? ` or another revision may open round ${config.nextRevisionRound}` : ', while further revision is blocked pending governance extension'}. Do not infer approval or mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.`,
    readyReadme: `Repository Step 4 remains in progress under round ${config.controlRound}. Exact user revisions passed complete review round ${config.evidenceRound}; the immutable Preview is ready for user review. Approval is not obtained. Runtime, economy, save, backend, Production and device verdicts remain unchanged.`
  };
}
const s02SecondRevisionDocumentConfig = {
  controlRound: '038', lockRound: '009', evidenceRound: '003', approvalRound: '039', nextRevisionRound: '040',
  revisionSnapshot: `CURRENT_AUTHORITY_SNAPSHOT: ${s02SecondRevisionControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | IN_PROGRESS_S02_P1_USER_REVISION`,
  readySnapshot: `CURRENT_AUTHORITY_SNAPSHOT: ${s02SecondRevisionControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | READY_FOR_USER_VISUAL_REVIEW`,
  approvalSnapshot: `CURRENT_AUTHORITY_SNAPSHOT: ${s02SecondRevisedP2ControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | READY_FOR_S02_P2_ASSET_PRODUCTION`,
  baseSnapshot: round036ReadySnapshot,
  baseRenderer: expectedRound036ReadyDocumentText,
  baseStrings: round036ReadyDocumentStrings,
  lock: () => s02SecondRevisionLock
};
const s02SecondRevisionReadyStrings = additionalRevisionStrings(s02SecondRevisionDocumentConfig);
const s02ThirdRevisionDocumentConfig = {
  controlRound: '040', lockRound: '011', evidenceRound: '004', approvalRound: '041', nextRevisionRound: null,
  revisionSnapshot: `CURRENT_AUTHORITY_SNAPSHOT: ${s02ThirdRevisionControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | IN_PROGRESS_S02_P1_USER_REVISION`,
  readySnapshot: `CURRENT_AUTHORITY_SNAPSHOT: ${s02ThirdRevisionControlPath} | STEP 4 | S02-P1-GOLDEN-MASTER | READY_FOR_USER_VISUAL_REVIEW`,
  approvalSnapshot: `CURRENT_AUTHORITY_SNAPSHOT: ${s02ThirdRevisedP2ControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | READY_FOR_S02_P2_ASSET_PRODUCTION`,
  baseSnapshot: s02SecondRevisionDocumentConfig.readySnapshot,
  baseRenderer: file => expectedAdditionalRevisionDocumentText(file, s02SecondRevisionDocumentConfig, true),
  baseStrings: {
    qualityCount: s02SecondRevisionReadyStrings.readyQualityCount,
    qualityNext: s02SecondRevisionReadyStrings.readyQualityNext,
    handoverProgress: s02SecondRevisionReadyStrings.readyHandoverProgress,
    handoverNext: s02SecondRevisionReadyStrings.readyHandoverNext,
    workflowProduct: s02SecondRevisionReadyStrings.readyWorkflowProduct,
    agent: s02SecondRevisionReadyStrings.readyAgent,
    readme: s02SecondRevisionReadyStrings.readyReadme
  },
  lock: () => s02ThirdRevisionLock
};
function expectedAdditionalRevisionDocumentText(file, config, ready = false) {
  const strings = additionalRevisionStrings(config);
  const count = config.lock()?.requestedChanges?.length ?? 0;
  let source = config.baseRenderer(file).replace(config.baseSnapshot, config.revisionSnapshot);
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, config.baseStrings.qualityCount, strings.revisionQualityCount(count), `round ${config.controlRound} revision quality count`);
    source = replaceOnce(source, config.baseStrings.qualityNext, strings.revisionQualityNext, `round ${config.controlRound} revision quality next`);
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, config.baseStrings.handoverProgress, strings.revisionHandoverProgress, `round ${config.controlRound} revision handover progress`);
    source = replaceOnce(source, config.baseStrings.handoverNext, strings.revisionHandoverNext, `round ${config.controlRound} revision handover next`);
  } else if (file === '.github/workflows/CURRENT_STATUS.md') source = replaceOnce(source, config.baseStrings.workflowProduct, strings.revisionWorkflowProduct, `round ${config.controlRound} revision workflow`);
  else if (file === 'AGENTS.md') source = replaceOnce(source, config.baseStrings.agent, strings.revisionAgent, `round ${config.controlRound} revision agents`);
  else if (file === 'README.md') source = replaceOnce(source, config.baseStrings.readme, strings.revisionReadme, `round ${config.controlRound} revision README`);
  if (!ready) return source;
  source = source.replace(config.revisionSnapshot, config.readySnapshot);
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, strings.revisionQualityCount(count), strings.readyQualityCount, `round ${config.controlRound} ready quality count`);
    source = replaceOnce(source, strings.revisionQualityNext, strings.readyQualityNext, `round ${config.controlRound} ready quality next`);
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, strings.revisionHandoverProgress, strings.readyHandoverProgress, `round ${config.controlRound} ready handover progress`);
    source = replaceOnce(source, strings.revisionHandoverNext, strings.readyHandoverNext, `round ${config.controlRound} ready handover next`);
  } else if (file === '.github/workflows/CURRENT_STATUS.md') source = replaceOnce(source, strings.revisionWorkflowProduct, strings.readyWorkflowProduct, `round ${config.controlRound} ready workflow`);
  else if (file === 'AGENTS.md') source = replaceOnce(source, strings.revisionAgent, strings.readyAgent, `round ${config.controlRound} ready agents`);
  else if (file === 'README.md') source = replaceOnce(source, strings.revisionReadme, strings.readyReadme, `round ${config.controlRound} ready README`);
  return source;
}
function expectedAdditionalApprovalDocumentText(file, config) {
  const strings = additionalRevisionStrings(config);
  let source = expectedAdditionalRevisionDocumentText(file, config, true)
    .replace(config.readySnapshot, config.approvalSnapshot)
    .replace('USER_VISUAL_APPROVAL: false', 'USER_VISUAL_APPROVAL: true');
  if (file === 'QUALITY_GATE.md') {
    source = replaceOnce(source, strings.readyQualityCount, '- Current product P1: `1` (`S4-RECOVERY-VIS-001` remains open for later actual-runtime recovery); approved S02-P1 internal P0/P1: `0 / 0`', `round ${config.approvalRound} quality count`);
    source = replaceOnce(source, strings.readyQualityNext, `The exact round ${config.evidenceRound} Preview received explicit approval in immutable round ${Number(config.lockRound) + 1}. Round ${config.approvalRound} permits only one representative production-asset proof; no volume generation or runtime replacement before PASS_ASSET.`, `round ${config.approvalRound} quality next`);
  } else if (file === 'PROJECT_HANDOVER.md') {
    source = replaceOnce(source, strings.readyHandoverProgress, `Round ${config.controlRound} completed review round ${config.evidenceRound}; immutable decision lock round ${Number(config.lockRound) + 1} explicitly approved that exact Preview. Round ${config.approvalRound} authorizes only one representative S02 P2 asset proof. All earlier review evidence stays immutable.`, `round ${config.approvalRound} handover progress`);
    source = replaceOnce(source, strings.readyHandoverNext, '1. produce one exact representative production-asset set from the approved Golden Master\n2. verify identity, anchors, 9-slice, format, dimensions, size and separability\n3. obtain independent PASS_ASSET through exact round 042\n4. keep runtime, Step 4, Step 5, volume generation and Production unchanged', `round ${config.approvalRound} handover next`);
  } else if (file === '.github/workflows/CURRENT_STATUS.md') source = replaceOnce(source, strings.readyWorkflowProduct, `- the exact round ${config.evidenceRound} Preview received explicit approval; round ${config.approvalRound} permits only one representative asset proof and keeps every review round immutable`, `round ${config.approvalRound} workflow`);
  else if (file === 'AGENTS.md') source = replaceOnce(source, strings.readyAgent, `Read \`CURRENT_AUTHORITY_INDEX.json\`, round ${config.approvalRound} and immutable approval lock round ${Number(config.lockRound) + 1}. Produce only the exact representative asset proof. Do not generate volume, replace runtime, or mutate gameplay, economy, save, backend, payment, ads, Production or device verdicts before exact round 042 PASS_ASSET.`, `round ${config.approvalRound} agents`);
  else if (file === 'README.md') source = replaceOnce(source, strings.readyReadme, `Repository Step 4 remains in progress under round ${config.approvalRound}. The exact revised Golden Master received explicit approval and only one representative P2 asset proof is authorized. S02 is not complete; runtime, asset volume, Production and device verdicts remain unchanged.`, `round ${config.approvalRound} README`);
  return source;
}
function gitBlobSha(source) {
  const body = Buffer.from(source, 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}
function assertExactPhaseDocumentTransforms(commit, renderer, label) {
  for (const file of humanTruthFiles) assert(textAt(commit, file) === renderer(file), `${label}: document differs from the deterministic current-state template: ${file}`);
}
function assertDocumentBlobMapDerivesFromTemplate(blobMap, renderer, label) {
  assert(blobMap && typeof blobMap === 'object' && !Array.isArray(blobMap), `${label}: document blob map missing`);
  assert(JSON.stringify(Object.keys(blobMap).sort()) === JSON.stringify([...humanTruthFiles].sort()), `${label}: document blob-map paths differ`);
  for (const file of humanTruthFiles) assert(blobMap[file] === gitBlobSha(renderer(file)), `${label}: document blob was not derived from the deterministic template: ${file}`);
}
function assertCurrentDocBlobMap(blobMap, commit, label) {
  assert(blobMap && typeof blobMap === 'object' && !Array.isArray(blobMap), `${label}: current-document blob map missing`);
  assert(JSON.stringify(Object.keys(blobMap).sort()) === JSON.stringify([...humanTruthFiles].sort()), `${label}: current-document blob-map paths differ`);
  for (const file of humanTruthFiles) {
    assert(/^[a-f0-9]{40}$/.test(blobMap[file] ?? '') && git(['rev-parse', `${commit}:${file}`]) === blobMap[file], `${label}: current-document blob mismatch: ${file}`);
  }
}
const exactHumanTruthMarkers = [
  'STEP4_STATUS: IN_PROGRESS',
  'STEP5_ALLOWED: false',
  'PRODUCTION_ALIAS_CHANGED: false',
  'PRODUCTION_READY: false',
  'PHYSICAL_IPHONE_VERIFIED: false',
  `USER_VISUAL_APPROVAL: ${s02AnyP2Control ? 'true' : 'false'}`
];
const forbiddenHumanOverclaims = [
  ...(!s02AnyP2Control ? [/READY_FOR_S02_P2_ASSET_PRODUCTION/i] : []),
  /Step 4(?:\s+PASS|\s*:)\s*(?:is\s*)?(?:true|PASS)\b/i,
  /Step 5(?:\s+allowed|\s*:)\s*(?:is\s*)?true\b/i,
  /Production Ready\s*(?:is|:)?\s*(?:true|PASS)\b/i,
  /Production alias changed\s*(?:is|:)?\s*true\b/i,
  /^.*Physical iPhone(?:\s+verified)?\s*:\s*`?(?:true|VERIFIED)`?\s*$/im,
  ...(!s02AnyP2Control ? [/User visual approval\s*(?:is|:)?\s*(?:true|obtained|approved)\b/i] : [])
];
for (const file of humanTruthFiles) {
  const content = text(file);
  for (const marker of exactHumanTruthMarkers) {
    assert(content.split(marker).length - 1 === 1, `${file}: exact current truth marker is missing or duplicated: ${marker}`);
  }
  for (const pattern of forbiddenHumanOverclaims) assert(!pattern.test(content), `${file}: forbidden completion, approval, device or Production overclaim remains`);
}
assert(!currentDocs.includes('IN_PROGRESS_S02_ACTUAL_ROOT_VISUAL_REPAIR'), 'stale actual-root verdict remains in current mirrors');
assert(!currentDocs.includes('active-change-control-addendum-round-025.json'), 'round 025 remains current in mirrors');
assert(!currentDocs.includes('active-change-control-addendum-round-024.json'), 'round 024 remains current in mirrors');
assert(!currentDocs.includes('Step 4: `READY_TO_START`'), 'stale Step 4 ready state remains in current mirrors');
assert(!currentDocs.includes('found three closure-integrity P1'), 'incorrect Phase 0 finding count remains in current mirrors');
assert(!currentDocs.includes('found three P1 closure-integrity'), 'incorrect Phase 0 finding count remains in current mirrors');
const currentWorkflow = text('.github/workflows/verify-current-governance.yml');
assert(!/^\s+paths(?:-ignore)?:/m.test(currentWorkflow), 'current governance push trigger must not be path-filtered');
for (const marker of [
  'permissions: {}',
  'semantic-verification-no-credentials',
  'Verify current authority semantics without live credentials',
  '--semantic-only',
  'needs: semantic-verification',
  '--require-live-actions --skip-candidate-execution',
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'persist-credentials: false',
  'attestations: read',
  'REVIEW_MANIFEST_V2_SCHEMA_INVALID',
  "manifest.routeFiles",
  'asset.gitBlob',
  'oidcTokenSha256',
  'oidcClaims',
  'oidcVerified: true',
  'url.username || url.password || url.port',
  'finalUrl.username || finalUrl.password || finalUrl.port'
]) assert(currentWorkflow.includes(marker), `current governance workflow security marker missing: ${marker}`);
assert(!/uses:\s+actions\/(?:checkout|setup-node|upload-artifact)@v\d+/m.test(currentWorkflow), 'current governance workflow uses a mutable first-party action tag');
assert((currentWorkflow.match(/id-token: write/g) ?? []).length === 1, 'only the provenance job may receive id-token: write');
assert((currentWorkflow.match(/attestations: read/g) ?? []).length === 1, 'only the current-authority job may receive attestation read permission');
assert(!currentWorkflow.includes('oidcToken: token') && !currentWorkflow.includes('--arg oidcToken ') && !currentWorkflow.includes('oidcToken: $oidcToken'), 'current governance workflow must not persist an OIDC bearer token');

const closureRepairCriticPath = 'quality-reviews/phase-0-governance-recovery/closure-integrity-critic-round-001.json';
const closureRepairCriticComplete = exists(closureRepairCriticPath);
const closureRepairCritic = closureRepairCriticComplete ? json(closureRepairCriticPath) : null;
if (closureRepairCritic) {
  assertExactKeySet(closureRepairCritic, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'workflow', 'verdict', 'coverage', 'findings', 'unresolved', 'maximumVerdict'], 'closure-integrity critic');
  assertExactKeySet(closureRepairCritic.auditTarget, ['commit', 'tree'], 'closure-integrity critic target');
  assertExactKeySet(closureRepairCritic.unresolved, ['P0', 'P1'], 'closure-integrity critic unresolved');
  assert(closureRepairCritic.schemaVersion === 1, 'closure-integrity critic schema version mismatch');
  assert(typeof expectedClosureRepairCriticBlob === 'string' && /^[a-f0-9]{40}$/.test(expectedClosureRepairCriticBlob), 'closure-integrity critic blob was not frozen when added');
  assert(git(['rev-parse', `HEAD:${closureRepairCriticPath}`]) === expectedClosureRepairCriticBlob, 'closure-integrity critic blob differs from its frozen value');
  assert(closureRepairCritic.artifactId === 'cats-tower-phase0-closure-integrity-critic-round-001', 'closure-integrity critic artifact ID mismatch');
  assert(closureRepairCritic.repository === '2hg7trp7rv-design/cats_tower' && closureRepairCritic.branch === 'kimi', 'closure-integrity critic repository/branch mismatch');
  assert(closureRepairCritic.changeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json', 'closure-integrity critic change-control mismatch');
  assert(closureRepairCritic.verdict === 'PASS_PHASE0_CLOSURE_INTEGRITY_REPAIR', 'closure-integrity critic verdict is not a scoped pass');
  assert(closureRepairCritic.unresolved?.P0 === 0 && closureRepairCritic.unresolved?.P1 === 0, 'closure-integrity critic P0/P1 must be zero');
  assert(closureRepairCritic.maximumVerdict === 'READY_FOR_STEP2_SCREEN_PROJECTION_CORRECTION', 'closure-integrity critic maximum verdict is wrong');
  assert(JSON.stringify(closureRepairCritic.coverage) === JSON.stringify(['VERIFIER_FALSE_PASS_CLOSED', 'WORKFLOW_LIVE_PROVENANCE_VERIFIED', 'VERSIONED_CORRECTION_PROOF_BOUNDARY', 'FALSE_RELEASE_CLAIM_REJECTION']), 'closure-integrity critic coverage differs from the exact repaired attack set');
  const repairTarget = closureRepairCritic.auditTarget?.commit;
  assert(repairTarget && closureRepairCritic.auditTarget?.tree === git(['rev-parse', `${repairTarget}^{tree}`]), 'closure-integrity critic target commit/tree mismatch');
  assert(isExactRepairBootstrapCommit(repairTarget), 'closure-integrity repair target must be the exact reviewed bootstrap or its dedicated immutable-OIDC correction child');
  assertExactChangedPaths(trustedRound031RepairBase.commit, repairTarget, exactRepairBootstrapPaths, 'closure-integrity repair target');
  assertExactRepairDocumentTransforms(repairTarget);
  assert(typeof expectedRepairTargetVerifierBlob === 'string' && /^[a-f0-9]{40}$/.test(expectedRepairTargetVerifierBlob) && git(['rev-parse', `${repairTarget}:tests/governance/verify-current-authority.mjs`]) === expectedRepairTargetVerifierBlob, 'closure-integrity critic did not pin the independently reviewed repair-target verifier');
  assert(typeof expectedRepairTargetWorkflowBlob === 'string' && /^[a-f0-9]{40}$/.test(expectedRepairTargetWorkflowBlob) && git(['rev-parse', `${repairTarget}:.github/workflows/verify-current-governance.yml`]) === expectedRepairTargetWorkflowBlob, 'closure-integrity critic did not pin the independently reviewed repair-target workflow');
  assertCurrentDocBlobMap(expectedRepairTargetCurrentDocBlobs, repairTarget, 'closure-integrity critic repair target');
  const repairCriticCommit = firstAddCommit(closureRepairCriticPath);
  assert(repairCriticCommit && repairCriticCommit !== repairTarget && isAncestor(repairTarget, repairCriticCommit), 'closure-integrity critic commit must follow its audit target');
  assert(git(['rev-parse', `${repairCriticCommit}^`]) === repairTarget, 'closure-integrity critic must audit its exact immediate predecessor');
  const verifierBeforeRepairCritic = textAt(repairTarget, 'tests/governance/verify-current-authority.mjs');
  const expectedVerifierAtRepairCritic = verifierBeforeRepairCritic.replace(
    'const expectedClosureRepairCriticBlob = null;',
    `const expectedClosureRepairCriticBlob = '${expectedClosureRepairCriticBlob}';`
  ).replace(
    'const expectedRepairTargetVerifierBlob = null;',
    `const expectedRepairTargetVerifierBlob = '${expectedRepairTargetVerifierBlob}';`
  ).replace(
    'const expectedRepairTargetWorkflowBlob = null;',
    `const expectedRepairTargetWorkflowBlob = '${expectedRepairTargetWorkflowBlob}';`
  ).replace(
    'const expectedRepairTargetCurrentDocBlobs = null;',
    `const expectedRepairTargetCurrentDocBlobs = ${JSON.stringify(expectedRepairTargetCurrentDocBlobs)};`
  ).replace(
    'const expectedPostCriticCurrentDocBlobs = null;',
    `const expectedPostCriticCurrentDocBlobs = ${JSON.stringify(expectedPostCriticCurrentDocBlobs)};`
  );
  assert(expectedVerifierAtRepairCritic !== verifierBeforeRepairCritic && textAt(repairCriticCommit, 'tests/governance/verify-current-authority.mjs') === expectedVerifierAtRepairCritic, 'closure-integrity critic commit changed the verifier beyond the one reviewed blob-pin replacement');
  assertExactChangedPaths(repairTarget, repairCriticCommit, expectedClosureRepairCriticCommitWrites, 'closure-integrity critic evidence commit');
  assertExactPostCriticDocumentTransforms(repairCriticCommit);
  assert(assertAddedOnceAndUnchanged(closureRepairCriticPath, repairCriticCommit) === expectedClosureRepairCriticBlob, 'closure-integrity critic immutable blob mismatch');
  assert(closureRepairCritic.workflow?.commit === repairTarget && closureRepairCritic.workflow?.tree === closureRepairCritic.auditTarget.tree, 'closure-integrity critic workflow target mismatch');
  assert(closureRepairCritic.workflow?.conclusion === 'SUCCESS', 'closure-integrity critic workflow was not successful');
  assert(Number.isInteger(closureRepairCritic.workflow?.runId) && closureRepairCritic.workflow.runId > 0 && Number.isInteger(closureRepairCritic.workflow?.jobId) && closureRepairCritic.workflow.jobId > 0, 'closure-integrity critic run/job binding missing');
  assert(Number.isInteger(closureRepairCritic.workflow?.artifactId) && closureRepairCritic.workflow.artifactId > 0 && /^sha256:[a-f0-9]{64}$/.test(closureRepairCritic.workflow?.artifactDigest ?? ''), 'closure-integrity critic artifact binding missing');
  assert(closureRepairCritic.workflow?.artifactName === `phase0-current-governance-${repairTarget}-${closureRepairCritic.workflow.runId}-${closureRepairCritic.workflow.runAttempt}`, 'closure-integrity critic artifact name mismatch');
  registerWorkflowEvidence(closureRepairCritic.workflow, 'closure-integrity critic');
  const requiredFindingIds = [
    'PHASE0-POST-CLOSURE-BOUNDARY-001',
    'PHASE0-ACCEPTANCE-CLOSURE-ID-001',
    'PHASE0-PREMATURE-EVIDENCE-001',
    'PHASE0-IMMUTABLE-EVIDENCE-OVERWRITE-001'
  ];
  assert(JSON.stringify(closureRepairCritic.findings) === JSON.stringify(requiredFindingIds.map(id => ({ id, severity: 'P1', resolved: true }))), 'closure-integrity critic finding set mismatch');
  assertCriticalFindingCounts(closureRepairCritic, 'closure-integrity critic');
}

if (step2Correction) {
  assert(closureRepairCriticComplete, 'round 032 may not open before the closure-integrity critic passes');
  assertExactKeySet(step2Correction, [
    'schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry',
    'entryWorkflow', 'trigger', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase',
    'internalPhaseIsRepositoryStep', 'scope', 'preserves', 'findings', 'requiredDeliverables',
    'allowedWrites', 'evidenceOnlyWrites', 'forbiddenWrites', 'completionBoundary'
  ], 'round 032 change control');
  assertExactKeySet(step2Correction.entry, ['head', 'tree'], 'round 032 entry');
  assertWorkflowEvidenceKeys(step2Correction.entryWorkflow, 'round 032 entry workflow', true);
  assertExactKeySet(step2Correction.completionBoundary, [
    'requiredStep2P0', 'requiredPhase0P0', 'requiredPhase0P1', 'maximumVerdict', 'closureAddendum',
    'nextProductAuthorityAfterCorrectionAndClosure', 'step4Pass', 'step5Allowed', 'productionAllowed',
    'productionAliasChanged', 'physicalIPhoneVerified', 'userVisualApproval'
  ], 'round 032 completion boundary');
  assert(step2Correction.schemaVersion === 1 && step2Correction.artifactId === 'cats-tower-active-change-control-addendum-round-032', 'round 032 identity mismatch');
  assert(/^2026-\d{2}-\d{2}$/.test(step2Correction.createdAt ?? '') && step2Correction.trigger === 'Independent audit proved S2-P0-SCREEN-PROJECTION-001; create a versioned v3 projection while preserving immutable v2 history and all product/runtime boundaries.', 'round 032 creation date or trigger is invalid');
  assert(step2Correction.repository === '2hg7trp7rv-design/cats_tower' && step2Correction.branch === 'kimi', 'round 032 repository/branch mismatch');
  assert(step2Correction.parentChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json', 'round 032 parent change-control mismatch');
  assert(step2Correction.status === 'IN_PROGRESS' && step2Correction.verdict === 'IN_PROGRESS_STEP2_SCREEN_PROJECTION_CORRECTION', 'round 032 status/verdict mismatch');
  assert(step2Correction.currentRepositoryStep === 4 && step2Correction.internalPhaseIsRepositoryStep === false, 'round 032 repository-step boundary mismatch');
  assert(step2Correction.internalPhase === 'STEP2-SCREEN-PROJECTION-CORRECTION', 'round 032 internal phase mismatch');
  assert(step2Correction.scope === 'VERSIONED_V3_SCREEN_PROJECTION_ONLY', 'round 032 scope mismatch');
  assert(JSON.stringify(step2Correction.preserves) === JSON.stringify([
    'immutable v2 Step 2 history and byte bindings',
    'sealed Step 1 and Step 3 evidence',
    'all preserved S02-P1 content without mutation',
    'runtime, economy, save, Production and physical-device state'
  ]), 'round 032 preservation set mismatch');
  assert(JSON.stringify(step2Correction.findings) === JSON.stringify([{
    id: 'S2-P0-SCREEN-PROJECTION-001',
    severity: 'P0',
    status: 'OPEN_REQUIRES_VERSIONED_V3_CORRECTION'
  }]), 'round 032 finding set mismatch');
  assert(JSON.stringify(step2Correction.requiredDeliverables) === JSON.stringify([
    'closed v3 canonical S01-S12 screen projection and mutation fixtures',
    'numeric non-impact evidence and exact frozen-engine reproduction',
    'numbered Step 2 critic, judge, completion and live readback',
    'immutable v3 seal followed by a continuity-only commit',
    'distinct Step 2 PASS activation commit',
    'numbered Phase 0 critic, judge, completion and live readback',
    'round 033 corrected Phase 0 closure'
  ]), 'round 032 required deliverables mismatch');
  assert(JSON.stringify(step2Correction.allowedWrites) === JSON.stringify(expectedRound032AllowedWrites), 'round 032 allowedWrites is not the exact reviewed set');
  assert(JSON.stringify(step2Correction.forbiddenWrites) === JSON.stringify(expectedRound032ForbiddenWrites), 'round 032 forbiddenWrites is not the exact reviewed set');
  assert(JSON.stringify(step2Correction.evidenceOnlyWrites) === JSON.stringify(expectedEvidenceOnlyWrites), 'round 032 evidenceOnlyWrites is not the exact reviewed set');
  assert(JSON.stringify(step2Correction.completionBoundary) === JSON.stringify({
    requiredStep2P0: 0,
    requiredPhase0P0: 0,
    requiredPhase0P1: 0,
    maximumVerdict: 'READY_FOR_CORRECTED_PHASE0_CLOSURE',
    closureAddendum: closurePath,
    nextProductAuthorityAfterCorrectionAndClosure: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json',
    step4Pass: false,
    step5Allowed: false,
    productionAllowed: false,
    productionAliasChanged: false,
    physicalIPhoneVerified: false,
    userVisualApproval: false
  }), 'round 032 completion and release boundary mismatch');
  const correctionControlCommit = firstAddCommit(step2CorrectionPath);
  const closureRepairCriticCommit = firstAddCommit(closureRepairCriticPath);
  assert(correctionControlCommit, 'cannot resolve round 032 control addition commit');
  assert(step2Correction.entry?.head === git(['rev-parse', `${correctionControlCommit}^`]), 'round 032 entry must be the exact parent of its opening commit');
  assert(step2Correction.entry?.tree === git(['rev-parse', `${step2Correction.entry.head}^{tree}`]), 'round 032 entry commit/tree mismatch');
  const reviewedProvenanceCorrection = {
    commit: 'ba8fbf41883b81750bc3be2619f827582c303aab',
    tree: 'ff8bc8f6e0b9cae084c76acb27cf817a0d4a9ec5'
  };
  assert(git(['rev-parse', `${reviewedProvenanceCorrection.commit}^{tree}`]) === reviewedProvenanceCorrection.tree, 'round 032 reviewed provenance-correction tree mismatch');
  assert(git(['rev-parse', `${reviewedProvenanceCorrection.commit}^`]) === closureRepairCriticCommit, 'round 032 reviewed provenance correction is not the immediate critic child');
  assertExactChangedPaths(closureRepairCriticCommit, reviewedProvenanceCorrection.commit, ['tests/governance/verify-current-authority.mjs'], 'round 032 reviewed provenance correction');
  const reviewedEntryBoundaryCorrection = {
    commit: '1cce16ceab1c42f1a4796afbb597566430ebb123',
    tree: '93adafd475be9fc71574964ebd65ddd68fea3764'
  };
  assert(git(['rev-parse', `${reviewedEntryBoundaryCorrection.commit}^{tree}`]) === reviewedEntryBoundaryCorrection.tree, 'round 032 reviewed entry-boundary tree mismatch');
  assert(git(['rev-parse', `${reviewedEntryBoundaryCorrection.commit}^`]) === reviewedProvenanceCorrection.commit, 'round 032 reviewed entry-boundary correction is not the immediate provenance child');
  assertExactChangedPaths(reviewedProvenanceCorrection.commit, reviewedEntryBoundaryCorrection.commit, ['tests/governance/verify-current-authority.mjs'], 'round 032 reviewed entry-boundary correction');
  assert(git(['rev-parse', `${step2Correction.entry.head}^`]) === reviewedEntryBoundaryCorrection.commit, 'round 032 must open after the dedicated document-boundary correction');
  assertExactChangedPaths(reviewedEntryBoundaryCorrection.commit, step2Correction.entry.head, ['tests/governance/verify-current-authority.mjs'], 'round 032 document-boundary correction');
  const verifierBeforeRound032 = textAt(step2Correction.entry.head, 'tests/governance/verify-current-authority.mjs');
  const expectedVerifierAtRound032 = verifierBeforeRound032.replace(
    'const expectedStep2CorrectionControlBlob = null;',
    `const expectedStep2CorrectionControlBlob = '${expectedStep2CorrectionControlBlob}';`
  ).replace(
    'const expectedRound032CurrentDocBlobs = null;',
    `const expectedRound032CurrentDocBlobs = ${JSON.stringify(expectedRound032CurrentDocBlobs)};`
  ).replace(
    'const expectedRound033CurrentDocBlobs = null;',
    `const expectedRound033CurrentDocBlobs = ${JSON.stringify(expectedRound033CurrentDocBlobs)};`
  );
  assert(expectedVerifierAtRound032 !== verifierBeforeRound032 && textAt(correctionControlCommit, 'tests/governance/verify-current-authority.mjs') === expectedVerifierAtRound032, 'round 032 opening changed the verifier beyond the one reviewed control-blob pin replacement');
  assertExactChangedPaths(step2Correction.entry.head, correctionControlCommit, expectedRound032OpeningCommitWrites, 'round 032 opening commit');
  assert(assertAddedOnceAndUnchanged(step2CorrectionPath, correctionControlCommit) === expectedStep2CorrectionControlBlob, 'round 032 control immutable blob mismatch');
  assertExactPhaseDocumentTransforms(correctionControlCommit, expectedRound032DocumentText, 'round 032 opening');
  assertDocumentBlobMapDerivesFromTemplate(expectedRound032CurrentDocBlobs, expectedRound032DocumentText, 'round 032 opening');
  assertCurrentDocBlobMap(expectedRound032CurrentDocBlobs, correctionControlCommit, 'round 032 opening');
  assertDocumentBlobMapDerivesFromTemplate(expectedRound033CurrentDocBlobs, expectedRound033DocumentText, 'round 033 closure');
  const governanceFreezeEnd = closureCommit ?? git(['rev-parse', 'HEAD']);
  assertNoPathChangesSince(correctionControlCommit, governanceFreezeEnd, ['tests/governance/verify-current-authority.mjs', '.github/workflows/verify-current-governance.yml'], 'round 032 verifier/workflow freeze through round 033 closure');
  const entryWorkflow = step2Correction.entryWorkflow;
  assert(entryWorkflow?.commit === step2Correction.entry.head && entryWorkflow?.tree === step2Correction.entry.tree, 'round 032 entry workflow target mismatch');
  assert(entryWorkflow?.conclusion === 'SUCCESS', 'round 032 entry workflow must succeed');
  assert(Number.isInteger(entryWorkflow?.runId) && entryWorkflow.runId > 0 && Number.isInteger(entryWorkflow?.jobId) && entryWorkflow.jobId > 0, 'round 032 entry workflow run/job missing');
  assert(Number.isInteger(entryWorkflow?.artifactId) && entryWorkflow.artifactId > 0 && /^sha256:[a-f0-9]{64}$/.test(entryWorkflow?.artifactDigest ?? ''), 'round 032 entry workflow artifact binding missing');
  assert(entryWorkflow.artifactName === `phase0-current-governance-${step2Correction.entry.head}-${entryWorkflow.runId}-${entryWorkflow.runAttempt}`, 'round 032 entry workflow artifact name mismatch');
  registerWorkflowEvidence(entryWorkflow, 'round 032 entry');
}

if (s02RepairControl) {
  assert(closureExists && closureCommit, 'round 034 may not open before the exact round 033 closure');
  assertExactKeySet(s02RepairControl, [
    'schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry',
    'entryWorkflow', 'trigger', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep',
    'scope', 'latestUserDecision', 'findings', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'
  ], 'round 034 S02 repair control');
  assertExactKeySet(s02RepairControl.entry, ['head', 'tree'], 'round 034 entry');
  assertWorkflowEvidenceKeys(s02RepairControl.entryWorkflow, 'round 034 entry workflow', true);
  assertExactKeySet(s02RepairControl.completionBoundary, [
    'requiredInternalP0', 'requiredInternalP1', 'maximumBeforeUserVisualReview', 'mayNotDeclare',
    'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified',
    'userVisualApproval'
  ], 'round 034 completion boundary');
  assert(s02RepairControl.schemaVersion === 1 && s02RepairControl.artifactId === 'cats-tower-active-change-control-addendum-round-034' && /^2026-\d{2}-\d{2}$/.test(s02RepairControl.createdAt ?? ''), 'round 034 identity or date mismatch');
  assert(s02RepairControl.repository === '2hg7trp7rv-design/cats_tower' && s02RepairControl.branch === 'kimi' && s02RepairControl.parentChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json', 'round 034 repository, branch or parent mismatch');
  assert(s02RepairControl.trigger === 'The latest user decision rejects the preserved S02 as non-production-quality and authorizes production-standard Golden Master repair limited to S02 after corrected Phase 0 closure.', 'round 034 trigger mismatch');
  assert(s02RepairControl.status === 'IN_PROGRESS' && s02RepairControl.verdict === 'IN_PROGRESS_S02_P1_VISUAL_REPAIR' && s02RepairControl.currentRepositoryStep === 4 && s02RepairControl.internalPhase === 'S02-P1-GOLDEN-MASTER' && s02RepairControl.internalPhaseIsRepositoryStep === false, 'round 034 current phase boundary mismatch');
  assert(s02RepairControl.scope === 'S02_P1_GOLDEN_MASTER_PRODUCTION_QUALITY_REPAIR_ONLY', 'round 034 scope mismatch');
  assert(JSON.stringify(s02RepairControl.latestUserDecision) === JSON.stringify([
    'current S02 visual design is not production quality',
    'quality starts at production standard while scope remains limited to S02',
    'complete the Golden Master and implementation contract before runtime replacement',
    'build, automated tests and Vercel READY are not visual-quality PASS evidence',
    'do not mass-implement the actual root runtime before explicit user visual approval',
    'maximum before explicit user visual approval is READY_FOR_USER_VISUAL_REVIEW'
  ]), 'round 034 latest user decision differs');
  assert(JSON.stringify(s02RepairControl.findings) === JSON.stringify(s02RepairFindingIds.map(id => ({ id, severity: 'P1', status: 'OPEN_REQUIRES_REPAIR' }))), 'round 034 exact S02 repair finding set mismatch');
  assert(JSON.stringify(s02RepairControl.allowedWrites) === JSON.stringify(expectedS02RepairAllowedWrites), 'round 034 allowedWrites mismatch');
  assert(JSON.stringify(s02RepairControl.forbiddenWrites) === JSON.stringify(expectedS02RepairForbiddenWrites), 'round 034 forbiddenWrites mismatch');
  assert(JSON.stringify(s02RepairControl.completionBoundary) === JSON.stringify({
    requiredInternalP0: 0,
    requiredInternalP1: 0,
    maximumBeforeUserVisualReview: 'READY_FOR_USER_VISUAL_REVIEW',
    mayNotDeclare: ['S02 complete', 'Step 4 PASS', 'Step 5 allowed', 'Production Ready', 'physical iPhone verified', 'user visual approval obtained'],
    step4Pass: false,
    step5Allowed: false,
    productionAllowed: false,
    productionAliasChanged: false,
    physicalIPhoneVerified: false,
    userVisualApproval: false
  }), 'round 034 completion/release boundary mismatch');
  assert(typeof expectedS02RepairControlBlob === 'string' && /^[a-f0-9]{40}$/.test(expectedS02RepairControlBlob), 'round 034 control blob was not frozen at opening');
  const openingCommit = s02RepairOpeningCommit;
  assert(openingCommit && git(['rev-parse', `${openingCommit}^`]) === closureCommit, 'round 034 must open as the immediate child of round 033 closure');
  assert(s02RepairControl.entry.head === closureCommit && s02RepairControl.entry.tree === git(['rev-parse', `${closureCommit}^{tree}`]), 'round 034 entry commit/tree mismatch');
  const verifierBeforeOpening = textAt(closureCommit, 'tests/governance/verify-current-authority.mjs');
  const expectedVerifierAtOpening = verifierBeforeOpening.replace(
    'const expectedS02RepairControlBlob = null;',
    `const expectedS02RepairControlBlob = '${expectedS02RepairControlBlob}';`
  );
  assert(expectedVerifierAtOpening !== verifierBeforeOpening && textAt(openingCommit, 'tests/governance/verify-current-authority.mjs') === expectedVerifierAtOpening, 'round 034 opening changed the verifier beyond the reviewed control-blob pin');
  assertExactChangedPaths(closureCommit, openingCommit, expectedS02RepairOpeningCommitWrites, 'round 034 opening commit');
  assert(assertAddedOnceAndUnchanged(s02RepairControlPath, openingCommit) === expectedS02RepairControlBlob, 'round 034 immutable control blob mismatch');
  assertExactPhaseDocumentTransforms(openingCommit, expectedRound034RepairDocumentText, 'round 034 opening documents');
  assert(s02RepairControl.entryWorkflow.commit === closureCommit && s02RepairControl.entryWorkflow.tree === git(['rev-parse', `${closureCommit}^{tree}`]), 'round 034 entry workflow target mismatch');
  registerWorkflowEvidence(s02RepairControl.entryWorkflow, 'round 034 entry');
  assert(!(s02P2Control && s02RevisionControl) && !(s02P2Control && s02RevisedP2Control), 'initial round 035 approval is mutually exclusive with the revision/revised-approval lineage');
  const expectedPostRound034Control = [
    [s02AssetVolumeControl, s02AssetVolumeControlPath],
    [s02AssetVolumeScopeControl, s02AssetVolumeScopeControlPath],
    [s02AssetPassControl, s02AssetPassControlPath],
    [s02ThirdRevisedP2Control, s02ThirdRevisedP2ControlPath],
    [s02ThirdRevisionControl, s02ThirdRevisionControlPath],
    [s02SecondRevisedP2Control, s02SecondRevisedP2ControlPath],
    [s02SecondRevisionControl, s02SecondRevisionControlPath],
    [s02RevisedP2Control, s02RevisedP2ControlPath],
    [s02RevisionControl, s02RevisionControlPath],
    [s02P2Control, s02P2ControlPath]
  ].find(([control]) => control)?.[1] ?? s02RepairControlPath;
  assert(authority.activeChangeControl === expectedPostRound034Control && status.activeChangeControl === expectedPostRound034Control, 'post-round-034 authority rolled back or skipped the reviewed successor');
  assert(policy.authority.activeChangeControl === expectedPostRound034Control && dispatcher.currentAddendum === expectedPostRound034Control, 'post-round-034 policy or dispatcher rolled back or skipped the reviewed successor');
}

function verifyS02ExternalPreviewEvidence(evidence, request, label, requestPath = s02ReviewEvidencePaths.deploymentRequest, requireLiveApi = true) {
  assertWorkflowEvidenceKeys(evidence, `${label} workflow evidence`, true);
  for (const key of ['runId', 'runAttempt', 'jobId', 'artifactId']) assert(Number.isSafeInteger(evidence[key]) && evidence[key] > 0, `${label}: ${key} is invalid`);
  assert(/^[a-f0-9]{40}$/.test(evidence.commit ?? '') && evidence.tree === git(['rev-parse', `${evidence.commit}^{tree}`]), `${label}: commit/tree mismatch`);
  assert(evidence.commit === firstAddCommit(requestPath), `${label}: workflow does not bind the exact readback request commit`);
  assert(evidence.conclusion === 'SUCCESS' && evidence.artifactName === `s02-external-preview-${evidence.commit}-${evidence.runId}-${evidence.runAttempt}` && /^sha256:[a-f0-9]{64}$/.test(evidence.artifactDigest ?? ''), `${label}: conclusion or artifact identity mismatch`);
  verifyDurableActionsOidc(evidence, label);
  if (!requireLiveActions || !requireLiveApi) return null;
  const base = '/repos/2hg7trp7rv-design/cats_tower/actions';
  const run = ghJson(`${base}/runs/${evidence.runId}/attempts/${evidence.runAttempt}`);
  assert(run.id === evidence.runId && run.run_attempt === evidence.runAttempt && run.head_sha === evidence.commit && run.head_branch === 'kimi' && run.status === 'completed' && run.conclusion === 'success', `${label}: workflow run target or result mismatch`);
  assert(run.repository?.id === 1331488679 && run.repository?.owner?.id === 245031448 && run.head_repository?.id === 1331488679 && run.head_repository?.owner?.id === 245031448, `${label}: immutable repository identity mismatch`);
  assert((run.path ?? '').split('@')[0] === '.github/workflows/verify-current-governance.yml', `${label}: workflow path mismatch`);
  const job = ghJson(`${base}/jobs/${evidence.jobId}`);
  assert(job.run_id === evidence.runId && job.run_attempt === evidence.runAttempt && job.head_sha === evidence.commit && job.head_branch === 'kimi' && job.name === 'current-authority' && job.status === 'completed' && job.conclusion === 'success', `${label}: job target or result mismatch`);
  const externalSteps = ['Generate external S02 Preview proof', 'Upload external S02 Preview proof'];
  const stepIndexes = externalSteps.map(name => {
    const matches = job.steps?.filter(step => step.name === name) ?? [];
    assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success', `${label}: required external-proof step missing or failed: ${name}`);
    return job.steps.indexOf(matches[0]);
  });
  assert(stepIndexes[1] > stepIndexes[0], `${label}: external-proof steps ran out of order`);
  const artifact = ghJson(`${base}/artifacts/${evidence.artifactId}`);
  assert(artifact.id === evidence.artifactId && artifact.name === evidence.artifactName && artifact.digest === evidence.artifactDigest && artifact.expired === false, `${label}: artifact identity, digest or expiry mismatch`);
  assert(artifact.workflow_run?.id === evidence.runId && artifact.workflow_run?.head_sha === evidence.commit && artifact.workflow_run?.head_branch === 'kimi', `${label}: artifact workflow binding mismatch`);
  assert(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 10 * 1024 * 1024, `${label}: artifact size is invalid`);
  const zip = ghApi(`${base}/artifacts/${evidence.artifactId}/zip`, { binary: true, maxBuffer: artifact.size_in_bytes + 1024 * 1024 });
  assert(`sha256:${createHash('sha256').update(zip).digest('hex')}` === evidence.artifactDigest, `${label}: downloaded archive digest mismatch`);
  const expectedEntries = [
    's02-external-preview-envelope.json',
    'external/github-deployments-content.json',
    'external/github-deployment-statuses-content.json',
    'external/github-commit-statuses-content.json',
    'external/http-report.json',
    'external/s02-preview-proof-result.json'
  ];
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cats-tower-s02-preview-'));
  const zipPath = path.join(tempDirectory, 'artifact.zip');
  try {
    fs.writeFileSync(zipPath, zip);
    const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split('\n').filter(Boolean);
    assert(new Set(entries).size === entries.length && JSON.stringify([...entries].sort()) === JSON.stringify([...expectedEntries].sort()), `${label}: external-proof artifact entry set mismatch`);
    assert(entries.every(entry => !entry.startsWith('/') && !entry.split('/').includes('..')), `${label}: external-proof archive contains an unsafe path`);
    const readEntry = entry => execFileSync('unzip', ['-p', zipPath, entry], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
    const envelopeBytes = readEntry(expectedEntries[0]);
    const rawDeploymentsBytes = readEntry(expectedEntries[1]);
    const rawDeploymentStatusesBytes = readEntry(expectedEntries[2]);
    const rawCommitStatusesBytes = readEntry(expectedEntries[3]);
    const httpBytes = readEntry(expectedEntries[4]);
    const resultBytes = readEntry(expectedEntries[5]);
    assert(envelopeBytes.equals(resultBytes), `${label}: root envelope differs from the signed external result`);
    const deployments = JSON.parse(rawDeploymentsBytes.toString('utf8'));
    const deploymentStatuses = JSON.parse(rawDeploymentStatusesBytes.toString('utf8'));
    const commitStatuses = JSON.parse(rawCommitStatusesBytes.toString('utf8'));
    const httpReport = JSON.parse(httpBytes.toString('utf8'));
    const result = JSON.parse(resultBytes.toString('utf8'));
    assert(Array.isArray(deployments) && Array.isArray(deploymentStatuses) && Array.isArray(commitStatuses), `${label}: raw GitHub external responses are not arrays`);
    assertExactKeySet(result, ['schemaVersion', 'artifactId', 'repository', 'repositoryId', 'repositoryOwnerId', 'branch', 'requestCommit', 'requestTree', 'runId', 'runAttempt', 'oidcTokenSha256', 'oidcClaims', 'oidcVerified', 'verifiedContent', 'contentDeployment', 'rawSha256', 'httpReportSha256', 'productionBoundary', 'verdict'], `${label} result`);
    assertExactKeySet(result.verifiedContent, ['commit', 'tree'], `${label} verified content`);
    assertExactKeySet(result.contentDeployment, ['githubDeploymentId', 'githubDeploymentStatusId', 'githubCommitStatusId', 'vercelDeploymentId', 'immutableUrl', 'githubSha', 'githubRef', 'environment', 'transientEnvironment', 'productionEnvironment', 'state', 'creator'], `${label} content deployment`);
    assertExactKeySet(result.contentDeployment.creator, ['login', 'id', 'type'], `${label} deployment creator`);
    assertExactKeySet(result.rawSha256, ['deployments', 'deploymentStatuses', 'commitStatuses'], `${label} raw hashes`);
    assertExactKeySet(result.productionBoundary, ['reviewDeploymentTarget', 'productionTargeted', 'globalProductionAliasUnchanged'], `${label} production boundary`);
    assert(result.schemaVersion === 1 && result.artifactId === 'cats-tower-s02-external-preview-proof' && result.repository === '2hg7trp7rv-design/cats_tower' && result.repositoryId === 1331488679 && result.repositoryOwnerId === 245031448 && result.branch === 'kimi', `${label}: result repository identity mismatch`);
    assert(result.requestCommit === evidence.commit && result.requestTree === evidence.tree && result.runId === evidence.runId && result.runAttempt === evidence.runAttempt && result.oidcTokenSha256 === evidence.oidcTokenSha256 && JSON.stringify(result.oidcClaims) === JSON.stringify(evidence.oidcClaims) && result.oidcVerified === true, `${label}: result request, run or hardened OIDC binding mismatch`);
    assert(JSON.stringify(result.verifiedContent) === JSON.stringify(request.verifiedContent), `${label}: result verified content differs from the immutable request`);
    assert(result.rawSha256.deployments === `sha256:${createHash('sha256').update(rawDeploymentsBytes).digest('hex')}` && result.rawSha256.deploymentStatuses === `sha256:${createHash('sha256').update(rawDeploymentStatusesBytes).digest('hex')}` && result.rawSha256.commitStatuses === `sha256:${createHash('sha256').update(rawCommitStatusesBytes).digest('hex')}` && result.httpReportSha256 === `sha256:${createHash('sha256').update(httpBytes).digest('hex')}`, `${label}: result does not bind every raw response and HTTP report`);
    const eligibleDeployments = deployments.filter(item => item.sha === request.verifiedContent.commit && item.ref === 'kimi' && item.task === 'deploy' && /^preview$/i.test(item.environment ?? '') && item.transient_environment === true && item.production_environment === false && item.creator?.login === 'vercel[bot]' && item.creator?.id === 35613825 && item.creator?.type === 'Bot');
    assert(eligibleDeployments.length >= 1 && eligibleDeployments[0].id === result.contentDeployment.githubDeploymentId, `${label}: selected deployment is not the latest exact Vercel Preview candidate`);
    const eligibleDeploymentStatuses = deploymentStatuses.filter(item => item.creator?.login === 'vercel[bot]' && item.creator?.id === 35613825 && item.creator?.type === 'Bot');
    assert(eligibleDeploymentStatuses.length >= 1 && eligibleDeploymentStatuses[0].id === result.contentDeployment.githubDeploymentStatusId && eligibleDeploymentStatuses[0].state === 'success', `${label}: latest Vercel deployment status is absent or not successful`);
    const eligibleCommitStatuses = commitStatuses.filter(item => item.context === 'Vercel' && item.creator?.login === 'vercel[bot]' && item.creator?.id === 35613825 && item.creator?.type === 'Bot');
    assert(eligibleCommitStatuses.length >= 1 && eligibleCommitStatuses[0].id === result.contentDeployment.githubCommitStatusId && eligibleCommitStatuses[0].state === 'success', `${label}: latest Vercel commit status is absent or not successful`);
    assert([eligibleDeploymentStatuses[0].target_url, eligibleDeploymentStatuses[0].log_url].includes(eligibleCommitStatuses[0].target_url), `${label}: Vercel deployment status and commit status do not identify the same deployment target`);
    const targetMatch = /^https:\/\/vercel\.com\/shinyaaas-projects\/cats_tower\/([A-Za-z0-9]+)$/.exec(eligibleCommitStatuses[0].target_url ?? '');
    assert(targetMatch && result.contentDeployment.vercelDeploymentId === `dpl_${targetMatch[1]}`, `${label}: Vercel deployment ID does not derive from the bot status target URL`);
    let normalizedEnvironmentUrl;
    try {
      const environmentUrl = new URL(eligibleDeploymentStatuses[0].environment_url);
      assert(environmentUrl.username === '' && environmentUrl.password === '', `${label}: Vercel deployment environment URL contains userinfo`);
      normalizedEnvironmentUrl = environmentUrl.origin;
    } catch {
      assert(false, `${label}: Vercel deployment status has an invalid environment URL`);
    }
    assert(result.contentDeployment.immutableUrl === normalizedEnvironmentUrl && result.contentDeployment.immutableUrl !== request.review.branchAlias && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(result.contentDeployment.immutableUrl ?? ''), `${label}: immutable URL does not derive from a distinct Vercel deployment status URL`);
    assert(JSON.stringify(result.contentDeployment) === JSON.stringify({
      githubDeploymentId: eligibleDeployments[0].id,
      githubDeploymentStatusId: eligibleDeploymentStatuses[0].id,
      githubCommitStatusId: eligibleCommitStatuses[0].id,
      vercelDeploymentId: `dpl_${targetMatch[1]}`,
      immutableUrl: normalizedEnvironmentUrl,
      githubSha: request.verifiedContent.commit,
      githubRef: 'kimi',
      environment: 'Preview',
      transientEnvironment: true,
      productionEnvironment: false,
      state: 'success',
      creator: { login: 'vercel[bot]', id: 35613825, type: 'Bot' }
    }), `${label}: derived content-deployment result mismatch`);
    assert(JSON.stringify(result.productionBoundary) === JSON.stringify({ reviewDeploymentTarget: 'preview', productionTargeted: false, globalProductionAliasUnchanged: 'NOT_PROVEN_BY_PUBLIC_PREVIEW_EVIDENCE' }) && result.verdict === 'PASS_EXTERNAL_S02_PREVIEW_READBACK', `${label}: production boundary or verdict overclaims`);
    assertExactKeySet(httpReport, ['schemaVersion', 'artifactId', 'verifiedAt', 'route', 'immutableUrl', 'branchAlias', 'immutableStatus', 'branchAliasStatus', 'immutableContentType', 'branchAliasContentType', 'immutableFinalPath', 'branchAliasFinalPath', 'indexBlob', 'indexSha256', 'immutablePageSha256', 'branchAliasPageSha256', 'manifestPath', 'manifestBlob', 'manifestSha256', 'branchAliasManifestSha256', 'requiredLabelsVisible', 'goldenMastersAvailable', 'assetChecks', 'assetFailures', 'aliasServesReviewedContent'], `${label} HTTP report`);
    assert(httpReport.schemaVersion === 1 && httpReport.artifactId === 'cats-tower-s02-external-preview-http-report' && isCanonicalIsoInstant(httpReport.verifiedAt), `${label}: HTTP report identity or time mismatch`);
    assert(httpReport.route === request.review.route && httpReport.immutableUrl === result.contentDeployment.immutableUrl && httpReport.branchAlias === request.review.branchAlias && httpReport.immutableStatus === 200 && httpReport.branchAliasStatus === 200, `${label}: HTTP route, URL or status mismatch`);
    assert(/^text\/html(?:;|$)/i.test(httpReport.immutableContentType ?? '') && /^text\/html(?:;|$)/i.test(httpReport.branchAliasContentType ?? ''), `${label}: review route did not return HTML`);
    assert([request.review.route, request.review.route.replace(/\/$/, '')].includes(httpReport.immutableFinalPath) && [request.review.route, request.review.route.replace(/\/$/, '')].includes(httpReport.branchAliasFinalPath), `${label}: review route resolved to an unexpected canonical path`);
    const manifestText = textAt(request.verifiedContent.commit, request.review.manifestPath);
    const manifest = JSON.parse(manifestText);
    const manifestSha = `sha256:${sha256Text(manifestText)}`;
    assert(git(['rev-parse', `${request.verifiedContent.commit}:${request.review.manifestPath}`]) === request.review.manifestBlob, `${label}: request manifest blob differs from target`);
    const indexPath = 'step4/s02/golden-master-p1/index.html';
    const indexText = textAt(request.verifiedContent.commit, indexPath);
    const indexBlob = git(['rev-parse', `${request.verifiedContent.commit}:${indexPath}`]);
    const indexSha = `sha256:${sha256Text(indexText)}`;
    assert(httpReport.indexBlob === indexBlob && httpReport.indexSha256 === indexSha && httpReport.immutablePageSha256 === indexSha && httpReport.branchAliasPageSha256 === indexSha, `${label}: immutable route and branch alias are not byte-identical to the target index.html`);
    assert(httpReport.manifestPath === request.review.manifestPath && httpReport.manifestBlob === request.review.manifestBlob && httpReport.manifestSha256 === manifestSha && httpReport.branchAliasManifestSha256 === manifestSha, `${label}: served review manifest differs from the target Git blob`);
    assert(JSON.stringify(httpReport.requiredLabelsVisible) === JSON.stringify(request.review.requiredLabels) && JSON.stringify(httpReport.goldenMastersAvailable) === JSON.stringify(request.review.goldenMasters), `${label}: live review labels or Golden Master set is incomplete`);
    const expectedManifest = deriveS02ServedFileManifest(request.verifiedContent.commit, request.review.manifestPath, request.review.route);
    assert(JSON.stringify(manifest) === JSON.stringify(expectedManifest), `${label}: Git review manifest does not exactly enumerate the complete served route`);
    assert(Array.isArray(manifest.routeFiles) && Array.isArray(httpReport.assetChecks) && httpReport.assetChecks.length === manifest.routeFiles.length, `${label}: live file-check count differs from the exact v2 review route manifest`);
    const expectedAssetChecks = manifest.routeFiles.map(asset => ({ path: asset.path, gitBlob: asset.gitBlob, bytes: asset.bytes, sha256: asset.sha256, immutableStatus: 200, branchAliasStatus: 200 }));
    assert(JSON.stringify(httpReport.assetChecks) === JSON.stringify(expectedAssetChecks) && httpReport.assetFailures === 0 && httpReport.aliasServesReviewedContent === true, `${label}: live assets failed or branch alias did not serve the reviewed content`);
    assert(Date.parse(httpReport.verifiedAt) <= Date.parse(request.review.temporaryAccess.expiresAt), `${label}: external HTTP verification occurred after its temporary Vercel share expired`);
    return { result, httpReport };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function verifyS02ReviewEvidencePrefix(options = {}) {
  const paths = options.paths ?? s02ReviewEvidencePaths;
  const evidenceRound = options.evidenceRound ?? '001';
  const changeControlPath = options.changeControlPath ?? s02RepairControlPath;
  const openingCommit = options.openingCommit ?? s02RepairOpeningCommit;
  const contentManifestOptions = options.contentManifestOptions ?? {};
  const exactContentParent = options.exactContentParent ?? null;
  const revisionChanges = options.revisionChanges ?? null;
  const revisionBaseline = options.revisionBaseline ?? null;
  const previousRevisionEvidencePaths = options.previousRevisionEvidencePaths ?? null;
  const activeAcceptanceCriteria = options.activeAcceptanceCriteria ?? null;
  const labelPrefix = options.labelPrefix ?? 'S02';
  if (revisionChanges) assert(Array.isArray(activeAcceptanceCriteria) && activeAcceptanceCriteria.length >= 1, `${labelPrefix}: revision review lacks its cumulative active Acceptance criteria`);
  // A successor must not turn a self-authored digest/claim summary into durable provenance.
  // Whenever credentialed live verification is requested by the caller, every historical
  // workflow/archive in the successor chain is re-read from GitHub and must remain available.
  const requireLiveWorkflow = options.requireLiveWorkflow ?? true;
  const requireLiveExternal = options.requireLiveExternal ?? requireLiveWorkflow;
  const presence = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, exists(file)]));
  const packageReceiptPath = `${s02WorkflowEvidencePackageRoot(evidenceRound)}/${s02ContentAttestationReceiptName}`;
  const packageCommit = exists(packageReceiptPath) ? firstAddCommit(packageReceiptPath) : null;
  const admissionPaths = s02WorkflowAdmissionPaths(evidenceRound);
  const admissionPresent = exists(admissionPaths.admission);
  const admissionReadbackPresent = exists(admissionPaths.readback);
  assert(!admissionPresent || packageCommit, `${labelPrefix}: authenticated admission exists without its exact durable workflow package`);
  assert(!admissionReadbackPresent || admissionPresent, `${labelPrefix}: authenticated-admission readback exists without its immutable admission record`);
  const revisionProof = revisionChanges ? {
    evidenceRound,
    baselineCommit: revisionBaseline?.commit,
    baselineTree: revisionBaseline?.tree,
    affectedGoldenMasters: [...new Set(revisionChanges.flatMap(change => change.affectedGoldenMasters))].sort(),
    requestedChanges: revisionChanges,
    activeAcceptanceCriteria: publicActiveAcceptanceCriteria(activeAcceptanceCriteria)
  } : null;
  let persistedAdmission = null;
  if (admissionPresent) {
    const admission = json(admissionPaths.admission);
    assert(admission?.workflow && typeof admission.workflow === 'object', `${labelPrefix}: authenticated-admission record lacks its exact S02 source workflow evidence`);
    persistedAdmission = verifyS02PersistedWorkflowPackage(admission.workflow, evidenceRound, revisionProof, `${labelPrefix} authenticated workflow package`, { requireAdmissionReadback: false });
    if (!admissionReadbackPresent) {
      assert(!(revisionChanges ? presence.feasibilityAudit : presence.critic), `${labelPrefix}: critic/feasibility evidence exists before the successful authenticated-admission readback`);
      assert(git(['rev-parse', 'HEAD']) === persistedAdmission.admissionCommit, `${labelPrefix}: unreviewed commit follows the pending authenticated-admission run`);
    }
  }
  if (revisionChanges) assert(!presence.feasibilityAudit || presence.acceptanceMatrix, 'S02 revision feasibility audit exists before its versioned Acceptance Matrix');
  if (revisionChanges) assert(!presence.feasibilityAudit || admissionReadbackPresent, 'S02 revision feasibility audit exists before authenticated workflow-package admission readback');
  if (!revisionChanges) assert(!presence.critic || admissionReadbackPresent, 'S02 critic exists before authenticated workflow-package admission readback');
  if (revisionChanges) assert(!presence.critic || presence.feasibilityAudit, 'S02 revision critic exists before its versioned feasibility audit');
  assert(!presence.finalJudge || presence.critic, 'S02 final judge exists before the independent critic');
  assert(!presence.completion || presence.finalJudge, 'S02 completion exists before the final judge');
  assert(!presence.deploymentRequest || presence.completion, 'S02 deployment request exists before completion');
  assert(!presence.deploymentReadback || presence.deploymentRequest, 'S02 deployment readback exists before its external-proof request');
  let acceptanceMatrix = null;
  let acceptanceCommit = null;
  let acceptanceTarget = null;
  if (revisionChanges && presence.acceptanceMatrix) {
    acceptanceMatrix = json(paths.acceptanceMatrix);
    assertExactKeySet(acceptanceMatrix, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'supersedes', 'requestSha256', 'criteria', 'unresolved', 'verdict', 'maximumVerdict'], `${labelPrefix} versioned Acceptance Matrix`);
    assertExactKeySet(acceptanceMatrix.auditTarget, ['commit', 'tree'], `${labelPrefix} Acceptance target`);
    assertExactKeySet(acceptanceMatrix.supersedes, ['path', 'blob'], `${labelPrefix} Acceptance predecessor`);
    assertExactKeySet(acceptanceMatrix.unresolved, ['P0', 'P1'], `${labelPrefix} Acceptance unresolved`);
    acceptanceTarget = acceptanceMatrix.auditTarget.commit;
    assert(acceptanceMatrix.schemaVersion === 1 && acceptanceMatrix.artifactId === `cats-tower-s02-golden-master-p1-acceptance-matrix-round-${evidenceRound}` && acceptanceMatrix.repository === '2hg7trp7rv-design/cats_tower' && acceptanceMatrix.branch === 'kimi' && acceptanceMatrix.changeControl === changeControlPath, `${labelPrefix}: Acceptance identity or authority mismatch`);
    assert(acceptanceTarget && acceptanceMatrix.auditTarget.tree === git(['rev-parse', `${acceptanceTarget}^{tree}`]) && isAncestor(openingCommit, acceptanceTarget), `${labelPrefix}: Acceptance target commit/tree or lineage mismatch`);
    if (exactContentParent) assert(git(['rev-parse', `${acceptanceTarget}^`]) === exactContentParent, `${labelPrefix}: Acceptance Matrix does not target the one exact revision content commit`);
    const previousAcceptancePath = previousRevisionEvidencePaths?.acceptanceMatrix ?? 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-acceptance-matrix-round-001.json';
    assert(JSON.stringify(acceptanceMatrix.supersedes) === JSON.stringify({ path: previousAcceptancePath, blob: git(['rev-parse', `${acceptanceTarget}:${previousAcceptancePath}`]) }), `${labelPrefix}: versioned Acceptance does not bind the immediately preceding immutable criteria`);
    const expectedCriteria = publicActiveAcceptanceCriteria(activeAcceptanceCriteria);
    assert(acceptanceMatrix.requestSha256 === `sha256:${sha256Canonical(revisionChanges)}` && JSON.stringify(acceptanceMatrix.criteria) === JSON.stringify(expectedCriteria), `${labelPrefix}: Acceptance Matrix differs from cumulative active user criteria`);
    assert(JSON.stringify(acceptanceMatrix.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && acceptanceMatrix.verdict === 'READY_FOR_S02_P1_REVISED_FEASIBILITY_AUDIT' && acceptanceMatrix.maximumVerdict === 'READY_FOR_S02_P1_REVISED_FEASIBILITY_AUDIT', `${labelPrefix}: Acceptance Matrix overclaims completion`);
    acceptanceCommit = firstAddCommit(paths.acceptanceMatrix);
    assert(acceptanceCommit && git(['rev-parse', `${acceptanceCommit}^`]) === acceptanceTarget, `${labelPrefix}: versioned Acceptance must immediately follow exact revised content`);
    assertExactChangedPaths(acceptanceTarget, acceptanceCommit, [paths.acceptanceMatrix], `${labelPrefix} Acceptance commit`);
    assertAddedOnceAndUnchanged(paths.acceptanceMatrix, acceptanceCommit);
  }
  let pendingPackageState = null;
  if (packageCommit && !admissionPresent) {
    assert(!(revisionChanges ? presence.feasibilityAudit : presence.critic) && !presence.finalJudge && !presence.completion && !presence.deploymentRequest && !presence.deploymentReadback, `${labelPrefix}: no review, completion or Preview evidence may follow an unauthenticated durable workflow package`);
    pendingPackageState = verifyS02PendingWorkflowPackageTail(evidenceRound, revisionProof, `${labelPrefix} pending workflow package`, {
      expectedPackageParent: revisionChanges ? acceptanceCommit : null,
      expectedContentCommit: revisionChanges ? acceptanceTarget : null
    });
    if (!revisionChanges) {
      assert(pendingPackageState.targetCommit !== openingCommit && isAncestor(openingCommit, pendingPackageState.targetCommit), `${labelPrefix}: pending initial package does not target content after the authorized opening`);
      deriveS02ContentManifest(pendingPackageState.targetCommit, contentManifestOptions);
    }
  }
  let feasibilityAudit = null;
  let feasibilityAuditCommit = null;
  let feasibilityTarget = null;
  let feasibilityLiveEvidence = null;
  if (revisionChanges && presence.feasibilityAudit) {
    feasibilityAudit = json(paths.feasibilityAudit);
    assertExactKeySet(feasibilityAudit, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'supersedes', 'acceptanceMatrix', 'contentManifestSha256', 'inputBindings', 'workflow', 'auditItems', 'pendingGates', 'knownP2Risks', 'unresolved', 'verdict', 'maximumVerdict'], `${labelPrefix} versioned feasibility audit`);
    assertExactKeySet(feasibilityAudit.auditTarget, ['commit', 'tree'], `${labelPrefix} feasibility target`);
    assertExactKeySet(feasibilityAudit.supersedes, ['path', 'blob'], `${labelPrefix} superseded feasibility audit`);
    assertExactKeySet(feasibilityAudit.acceptanceMatrix, ['path', 'blob'], `${labelPrefix} feasibility Acceptance binding`);
    assertExactKeySet(feasibilityAudit.unresolved, ['P0', 'P1'], `${labelPrefix} feasibility unresolved`);
    feasibilityTarget = feasibilityAudit.auditTarget.commit;
    assert(feasibilityAudit.schemaVersion === 1 && feasibilityAudit.artifactId === `cats-tower-s02-golden-master-p1-feasibility-audit-round-${evidenceRound}` && feasibilityAudit.repository === '2hg7trp7rv-design/cats_tower' && feasibilityAudit.branch === 'kimi' && feasibilityAudit.changeControl === changeControlPath, `${labelPrefix}: feasibility identity or authority mismatch`);
    assert(feasibilityTarget && feasibilityTarget !== openingCommit && feasibilityAudit.auditTarget.tree === git(['rev-parse', `${feasibilityTarget}^{tree}`]) && isAncestor(openingCommit, feasibilityTarget), `${labelPrefix}: feasibility target commit/tree or lineage mismatch`);
    assert(feasibilityTarget === acceptanceTarget && feasibilityAudit.acceptanceMatrix.path === paths.acceptanceMatrix && feasibilityAudit.acceptanceMatrix.blob === git(['rev-parse', `HEAD:${paths.acceptanceMatrix}`]), `${labelPrefix}: feasibility audit does not bind latest versioned Acceptance Matrix`);
    if (exactContentParent) assert(git(['rev-parse', `${feasibilityTarget}^`]) === exactContentParent, `${labelPrefix}: feasibility audit does not target the one exact revision content commit`);
    const previousFeasibilityPath = previousRevisionEvidencePaths?.feasibilityAudit ?? 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-feasibility-audit.json';
    assert(JSON.stringify(feasibilityAudit.supersedes) === JSON.stringify({ path: previousFeasibilityPath, blob: git(['rev-parse', `${feasibilityTarget}:${previousFeasibilityPath}`]) }), `${labelPrefix}: versioned feasibility audit does not bind the immediately preceding immutable feasibility input`);
    const feasibilityContentManifest = deriveS02ContentManifest(feasibilityTarget, contentManifestOptions);
    const canonicalFeasibilityInputs = [
      'canonical/SCREEN_STATE_REGISTRY.json',
      'canonical/STABLE_ID_REGISTRY.json',
      'canonical/STATE_TRANSITION_CONTRACT.json'
    ];
    const expectedInputBindings = [
      ...feasibilityContentManifest.map(({ path: file, blob }) => ({ path: file, blob })),
      ...canonicalFeasibilityInputs.map(file => ({ path: file, blob: git(['rev-parse', `${feasibilityTarget}:${file}`]) }))
    ];
    assert(feasibilityAudit.contentManifestSha256 === `sha256:${sha256Canonical(feasibilityContentManifest)}` && JSON.stringify(feasibilityAudit.inputBindings) === JSON.stringify(expectedInputBindings), `${labelPrefix}: feasibility audit does not bind the exact full critic content manifest and canonical input blobs`);
    for (const change of revisionChanges) for (const file of change.targetPaths) assert(feasibilityAudit.inputBindings.some(binding => binding.path === file), `${labelPrefix}: feasibility audit omits a user-revised target path: ${file}`);
    const feasibilityDefinitions = [
      ['FEAS-001', ['EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES', 'REVIEW_COPY_EXCLUDED_FROM_GAME_UI']],
      ['FEAS-002', ['SEVEN_REQUIRED_VIEWPORTS_PASS']],
      ['FEAS-003', ['NON_UNIFORM_CHARACTER_SCALE_ABSENT', 'FOOT_AND_HIT_ANCHORS_BOUND']],
      ['FEAS-004', ['FOOT_AND_HIT_ANCHORS_BOUND']],
      ['FEAS-005', ['ATTACK_HIT_DEFEAT_REWARD_CAUSALITY_VISIBLE']],
      ['FEAS-006', ['NINE_SLICE_CAPS_AND_MINIMUMS_VALID']],
      ['FEAS-007', ['REVIEW_COPY_EXCLUDED_FROM_GAME_UI']],
      ['FEAS-008', ['PARTY_STATE_LABELS_CANONICAL']],
      ['FEAS-009', ['REWARD_PROVISIONAL_NOT_CONFIRMED']],
      ['FEAS-010', ['PARTY_STATE_LABELS_CANONICAL']],
      ['FEAS-011', ['SEVEN_REQUIRED_VIEWPORTS_PASS', 'GM04_REFLOW_OR_SCROLL_PASS']],
      ['FEAS-012', ['NONZERO_SAFE_AREA_PASS']],
      ['FEAS-013', ['TEXT_200_PERCENT_NO_LOSS', 'PRIMARY_CONTROL_HIT_AREA_MIN_48', 'IMPORTANT_CONTROL_HIT_AREA_MIN_44', 'MEANINGFUL_TEXT_CONTRAST_WCAG']],
      ['FEAS-014', ['EFFECTS_SEPARATED_FROM_CHARACTER_FRAMES', 'NINE_SLICE_CAPS_AND_MINIMUMS_VALID']],
      ['FEAS-015', ['VISIBLE_ENEMY_ALPHA_HEIGHT_MIN_80', 'STANDARD_ENEMY_ALPHA_HEIGHT_MIN_96']],
      ['FEAS-016', ['UNBOUND_RUBY_REMOVED', 'UNBOUND_RANK_REMOVED_OR_BOUND']],
      ['FEAS-017', ['ALL_TEN_FINDING_GROUPS_AUTOMATED']]
    ];
    const originalFeasibility = jsonAt(feasibilityTarget, 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-feasibility-audit.json');
    assertExactKeySet(originalFeasibility, ['schemaVersion', 'artifactId', 'auditStage', 'repository', 'branch', 'createdAt', 'screen', 'scope', 'status', 'method', 'auditItems', 'defectSummary', 'pendingGates', 'knownP2Risks', 'selfDenial', 'verdict'], `${labelPrefix} canonical feasibility source`);
    assert(Array.isArray(originalFeasibility.auditItems) && JSON.stringify(originalFeasibility.auditItems.map(item => item.id)) === JSON.stringify(feasibilityDefinitions.map(([id]) => id)), `${labelPrefix}: canonical feasibility source is not the exact FEAS-001..017 sequence`);
    const originalById = new Map(originalFeasibility.auditItems.map(item => [item.id, item]));
    const expectedAuditItems = feasibilityDefinitions.map(([id, verificationAssertions]) => ({
      ...(() => {
        const source = originalById.get(id);
        assertExactKeySet(source, ['id', 'area', 'risk', 'specStatus', 'evidence', 'executionGate'], `${labelPrefix} canonical feasibility ${id}`);
        assert(typeof source.area === 'string' && source.area.length >= 1 && typeof source.risk === 'string' && source.risk.length >= 1 && typeof source.specStatus === 'string' && source.specStatus.length >= 1 && Array.isArray(source.evidence) && source.evidence.length >= 1 && source.evidence.every(entry => typeof entry === 'string' && entry.length >= 1) && typeof source.executionGate === 'string' && source.executionGate.length >= 1, `${labelPrefix}: canonical feasibility ${id} is incomplete`);
        return { id, area: source.area, risk: source.risk, specStatus: source.specStatus, evidence: source.evidence, executionGate: source.executionGate };
      })(),
      verificationAssertions,
      workflowEvidence: {
        workflowArtifactId: feasibilityAudit.workflow.artifactId,
        artifactDigest: feasibilityAudit.workflow.artifactDigest,
        browserReport: 'semantic-evidence/browser-report.json'
      }
    }));
    assert(JSON.stringify(feasibilityAudit.auditItems) === JSON.stringify(expectedAuditItems), `${labelPrefix}: feasibility audit does not preserve and verify the exact FEAS-001..017 set`);
    for (const item of feasibilityAudit.auditItems) assert(item.verificationAssertions.every(id => Object.hasOwn(s02AssertionCriteria, id)), `${labelPrefix}: feasibility audit cites an assertion outside the trusted browser contract: ${item.id}`);
    assert(JSON.stringify(feasibilityAudit.pendingGates) === JSON.stringify(originalFeasibility.pendingGates) && JSON.stringify(feasibilityAudit.knownP2Risks) === JSON.stringify(originalFeasibility.knownP2Risks), `${labelPrefix}: feasibility audit dropped, weakened or invented a canonical pending gate/P2 risk`);
    assert(JSON.stringify(feasibilityAudit.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && feasibilityAudit.verdict === 'PASS_S02_P1_REVISED_SPEC_FEASIBILITY' && feasibilityAudit.maximumVerdict === 'READY_FOR_S02_P1_INDEPENDENT_CRITIC', `${labelPrefix}: feasibility audit did not pass revised P1 spec feasibility or overclaims its P2 boundary`);
    assert(feasibilityAudit.workflow.commit === feasibilityTarget && feasibilityAudit.workflow.tree === feasibilityAudit.auditTarget.tree, `${labelPrefix}: feasibility workflow target differs from its revised content target`);
    feasibilityLiveEvidence = verifyS02WorkflowEvidence(feasibilityAudit.workflow, `${labelPrefix} feasibility audit`, true, requireLiveWorkflow, revisionProof);
    feasibilityAuditCommit = firstAddCommit(paths.feasibilityAudit);
    assert(persistedAdmission?.admissionReadbackCommit && git(['rev-parse', `${feasibilityAuditCommit}^`]) === persistedAdmission.admissionReadbackCommit, `${labelPrefix}: versioned feasibility audit must immediately follow the authenticated workflow-package admission readback`);
    assertExactChangedPaths(persistedAdmission.admissionReadbackCommit, feasibilityAuditCommit, [paths.feasibilityAudit], `${labelPrefix} feasibility commit`);
    assertAddedOnceAndUnchanged(paths.feasibilityAudit, feasibilityAuditCommit);
  }
  if (!presence.critic) {
    const admissionState = persistedAdmission ? { packageCommit: persistedAdmission.packageCommit, admissionCommit: persistedAdmission.admissionCommit, admissionReadbackCommit: persistedAdmission.admissionReadbackCommit } : {};
    if (pendingPackageState) return { targetCommit: pendingPackageState.targetCommit, targetTree: pendingPackageState.targetTree, contentManifest: deriveS02ContentManifest(pendingPackageState.targetCommit, contentManifestOptions), ...(revisionChanges ? { acceptanceCommit } : {}), packageCommit: pendingPackageState.packageCommit };
    if (feasibilityAudit) return { targetCommit: feasibilityTarget, targetTree: feasibilityAudit.auditTarget.tree, contentManifest: deriveS02ContentManifest(feasibilityTarget, contentManifestOptions), acceptanceCommit, feasibilityAuditCommit, ...admissionState };
    if (acceptanceMatrix) return { targetCommit: acceptanceTarget, targetTree: acceptanceMatrix.auditTarget.tree, contentManifest: deriveS02ContentManifest(acceptanceTarget, contentManifestOptions), acceptanceCommit, ...admissionState };
    if (persistedAdmission) return { targetCommit: persistedAdmission.admission.workflowTarget.commit, targetTree: persistedAdmission.admission.workflowTarget.tree, contentManifest: deriveS02ContentManifest(persistedAdmission.admission.workflowTarget.commit, contentManifestOptions), ...admissionState };
    return null;
  }
  const critic = json(paths.critic);
  assertExactKeySet(critic, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'contentManifest', 'workflow', 'screenshots', 'findingClosure', ...(revisionChanges ? ['acceptanceMatrix', 'feasibilityAudit', 'revisionComparison', 'revisionClosure'] : []), 'verdict', 'coverage', 'testedViewports', 'goldenMasters', 'findings', 'unresolved', 'maximumVerdict'], 'S02 independent critic');
  assertExactKeySet(critic.auditTarget, ['commit', 'tree'], 'S02 critic target');
  assertExactKeySet(critic.unresolved, ['P0', 'P1'], 'S02 critic unresolved');
  if (revisionChanges) assertExactKeySet(critic.feasibilityAudit, ['path', 'blob'], `${labelPrefix} critic feasibility binding`);
  if (revisionChanges) assertExactKeySet(critic.acceptanceMatrix, ['path', 'blob'], `${labelPrefix} critic Acceptance binding`);
  assert(critic.schemaVersion === 1 && critic.artifactId === `cats-tower-s02-golden-master-p1-independent-critic-round-${evidenceRound}` && critic.repository === '2hg7trp7rv-design/cats_tower' && critic.branch === 'kimi' && critic.changeControl === changeControlPath, `${labelPrefix} critic identity or authority mismatch`);
  const targetCommit = critic.auditTarget.commit;
  const targetTree = critic.auditTarget.tree;
  assert(targetCommit && targetCommit !== openingCommit && targetTree === git(['rev-parse', `${targetCommit}^{tree}`]) && isAncestor(openingCommit, targetCommit), `${labelPrefix} critic target commit/tree or lineage mismatch`);
  if (revisionChanges) {
    assert(targetCommit === feasibilityTarget && critic.acceptanceMatrix?.path === paths.acceptanceMatrix && critic.acceptanceMatrix?.blob === git(['rev-parse', `HEAD:${paths.acceptanceMatrix}`]) && critic.feasibilityAudit?.path === paths.feasibilityAudit && critic.feasibilityAudit?.blob === git(['rev-parse', `HEAD:${paths.feasibilityAudit}`]), `${labelPrefix}: critic does not bind the exact revised Acceptance/feasibility audits and target`);
    assert(JSON.stringify(feasibilityAudit.workflow) === JSON.stringify(critic.workflow), `${labelPrefix}: feasibility audit workflow differs from the critic workflow evidence`);
  }
  if (exactContentParent) assert(git(['rev-parse', `${targetCommit}^`]) === exactContentParent, `${labelPrefix} revised content must be one exact commit after its control opening`);
  const expectedContentManifest = deriveS02ContentManifest(targetCommit, contentManifestOptions);
  assert(JSON.stringify(critic.contentManifest) === JSON.stringify(expectedContentManifest), 'S02 critic does not bind the exact reviewed product/test/workflow manifest');
  assert(critic.workflow.commit === targetCommit && critic.workflow.tree === targetTree, 'S02 critic workflow target mismatch');
  const liveS02Evidence = feasibilityLiveEvidence ?? verifyS02WorkflowEvidence(critic.workflow, `${labelPrefix} independent critic`, true, requireLiveWorkflow, revisionProof);
  assert(JSON.stringify(critic.screenshots.map(({ path, sha256 }) => ({ path, sha256 }))) === JSON.stringify(critic.screenshots), 'S02 critic screenshot binding contains unexpected keys');
  assert(JSON.stringify(critic.screenshots.map(({ path }) => path)) === JSON.stringify(s02ExpectedScreenshots.map(entry => entry.path)) && critic.screenshots.every(entry => /^sha256:[a-f0-9]{64}$/.test(entry.sha256)), 'S02 critic screenshot binding set or digest is invalid');
  if (liveS02Evidence) assert(JSON.stringify(critic.screenshots) === JSON.stringify(liveS02Evidence.result.screenshots), 'S02 critic screenshot bindings differ from the live workflow artifact');
  if (revisionChanges) {
    assertExactKeySet(critic.revisionComparison, ['path', 'sha256'], `${labelPrefix} critic revision-comparison binding`);
    assert(critic.revisionComparison.path === 'semantic-evidence/revision/revision-comparison.json' && /^sha256:[a-f0-9]{64}$/.test(critic.revisionComparison.sha256 ?? ''), `${labelPrefix}: critic revision-comparison binding is invalid`);
    if (liveS02Evidence) assert(critic.revisionComparison.sha256 === liveS02Evidence.result.revisionComparisonSha256, `${labelPrefix}: critic revision-comparison digest differs from the live signed artifact`);
  }
  const expectedFindingClosure = s02FindingClosureDefinitions.map(definition => ({
    ...definition,
    evidence: {
      artifactId: critic.workflow.artifactId,
      artifactDigest: critic.workflow.artifactDigest,
      browserReport: 'semantic-evidence/browser-report.json'
    }
  }));
  assert(JSON.stringify(critic.findingClosure) === JSON.stringify(expectedFindingClosure), 'S02 critic finding closure does not bind each repair group to exact changed paths, test assertions and workflow evidence');
  if (revisionChanges) {
    assert(exactContentParent, `${labelPrefix}: revision closure lacks its exact pre-revision content commit`);
    const afterScreenshots = new Map(critic.screenshots.map(entry => [entry.path.match(/(?:^|\/)(GM\d{2})-/)?.[1], entry.sha256]));
    const liveComparisons = new Map((liveS02Evidence?.revisionComparison?.comparisons ?? []).map(entry => [entry.id, entry]));
    const suppliedScreenshotChanges = new Map((critic.revisionClosure ?? []).flatMap(closure => closure.screenshotChanges ?? []).map(entry => [entry.id, entry]));
    const blobOrNull = (commit, file) => {
      try {
        const value = git(['rev-parse', `${commit}:${file}`]);
        return /^[a-f0-9]{40}$/.test(value) ? value : null;
      } catch {
        return null;
      }
    };
    const expectedRevisionClosure = revisionChanges.map(change => ({
      id: change.id,
      requestSha256: `sha256:${sha256Text(change.request)}`,
      affectedGoldenMasters: change.affectedGoldenMasters,
      pathChanges: change.targetPaths.map(file => ({
        path: file,
        beforeBlob: blobOrNull(exactContentParent, file),
        afterBlob: blobOrNull(targetCommit, file)
      })),
      screenshotChanges: change.affectedGoldenMasters.map(id => ({
        id,
        beforeSha256: liveComparisons.get(id)?.before?.sha256 ?? suppliedScreenshotChanges.get(id)?.beforeSha256,
        afterSha256: afterScreenshots.get(id)
      })),
      status: 'RESOLVED'
    }));
    assert(JSON.stringify(critic.revisionClosure) === JSON.stringify(expectedRevisionClosure), `${labelPrefix}: critic revision closure does not bind every exact request, path blob and affected Golden Master screenshot`);
    for (const closure of critic.revisionClosure) {
      assert(closure.pathChanges.every(change => /^[a-f0-9]{40}$/.test(change.afterBlob ?? '') && change.afterBlob !== change.beforeBlob), `${labelPrefix}: revision closure contains an unchanged, deleted or unbound target path`);
      assert(closure.screenshotChanges.every(change => /^sha256:[a-f0-9]{64}$/.test(change.beforeSha256 ?? '') && /^sha256:[a-f0-9]{64}$/.test(change.afterSha256 ?? '') && change.afterSha256 !== change.beforeSha256), `${labelPrefix}: an affected Golden Master screenshot did not change from round 001`);
    }
  }
  assert(critic.verdict === 'PASS_S02_GOLDEN_MASTER_P1_INDEPENDENT_CRITIC' && critic.maximumVerdict === 'READY_FOR_S02_P1_FINAL_JUDGE', 'S02 critic verdict boundary mismatch');
  const expectedCriticCoverage = [
    'FIRST_FIVE_SECONDS_COMBAT_CAT_FLOOR_THREAT_CAUSALITY',
    'VISIBLE_ALPHA_BOUNDS_AND_CHARACTER_IDENTITY',
    'DESIGN_SYSTEM_TOKENS_TYPE_AND_HIT_AREAS',
    'ALL_REQUIRED_VIEWPORTS_SAFE_AREA_AND_200_PERCENT_TEXT',
    'COMBAT_REWARD_SUPPORT_OFFLINE_AND_PARTY_STATE_SEMANTICS',
    'ASSET_ANIMATION_DATA_BINDING_AND_IMPLEMENTATION_FEASIBILITY',
    'CURRENT_PRIMARY_SOURCE_COMPETITIVE_RESEARCH_AND_COPY_AVOIDANCE',
    ...(revisionChanges ? ['EXACT_USER_REQUESTED_REVISIONS_RESOLVED'] : [])
  ];
  assert(JSON.stringify(critic.coverage) === JSON.stringify(expectedCriticCoverage), 'S02 critic coverage mismatch');
  assert(JSON.stringify(critic.testedViewports) === JSON.stringify(['320x568', '320x667', '375x667', '360x800', '390x844', '412x915', '430x932']), 'S02 critic viewport coverage mismatch');
  assert(JSON.stringify(critic.goldenMasters) === JSON.stringify(['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08']), 'S02 critic Golden Master set mismatch');
  const expectedCriticFindings = [
    ...s02RepairFindingIds,
    ...(revisionChanges ? revisionChanges.map(change => change.id) : [])
  ].map(id => ({ id, severity: 'P1', resolved: true }));
  assert(JSON.stringify(critic.findings) === JSON.stringify(expectedCriticFindings) && critic.unresolved.P0 === 0 && critic.unresolved.P1 === 0, 'S02 critic finding resolution mismatch');
  const workflowSource = textAt(targetCommit, '.github/workflows/verify-step-4-s02-golden-master-p1.yml');
  assert(sha256Text(workflowSource) === expectedS02WorkflowSha256, 'S02 reviewed workflow is not the exact independently reviewed two-job source');
  for (const marker of [
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    'permissions: {}',
    'Static, eight-master responsive and accessibility verification',
    'S02 evidence provenance',
    'persist-credentials: false',
    'id-token: write',
    'npm ci --ignore-scripts',
    'Write signed S02 evidence result'
  ]) assert(workflowSource.includes(marker), `S02 reviewed workflow security marker missing: ${marker}`);
  assert(!/^\s+paths(?:-ignore)?:/m.test(workflowSource) && !workflowSource.includes('if: always()') && !/uses:\s+actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@v\d+/m.test(workflowSource), 'S02 reviewed workflow retains a path bypass, always-upload or mutable first-party action tag');
  assert((workflowSource.match(/id-token: write/g) ?? []).length === 1, 'only the S02 provenance job may receive id-token: write');
  for (const harnessPath of s02VerificationPaths.filter(file => file !== '.github/workflows/verify-step-4-s02-golden-master-p1.yml')) {
    const harnessBytes = bytesAt(targetCommit, harnessPath);
    const expectedChecksumLine = `${createHash('sha256').update(harnessBytes).digest('hex')}  ${harnessPath}`;
    assert(workflowSource.split('\n').filter(line => line.trim() === expectedChecksumLine).length === 1, `S02 workflow does not freeze the exact trusted harness dependency: ${harnessPath}`);
  }
  const criticCommit = firstAddCommit(paths.critic);
  const expectedCriticParent = revisionChanges ? feasibilityAuditCommit : persistedAdmission?.admissionReadbackCommit;
  assert(packageCommit && persistedAdmission?.admissionReadbackCommit, 'S02 critic exists without its exact durable package and authenticated-admission readback');
  assert(criticCommit && git(['rev-parse', `${criticCommit}^`]) === expectedCriticParent, 'S02 critic does not immediately follow its authenticated admission/feasibility predecessor');
  const expectedCriticWrites = [paths.critic];
  assertExactChangedPaths(expectedCriticParent, criticCommit, expectedCriticWrites, `${labelPrefix} critic commit`);
  assertAddedOnceAndUnchanged(paths.critic, criticCommit);
  if (!presence.finalJudge) return { targetCommit, targetTree, contentManifest: expectedContentManifest, ...(revisionChanges ? { acceptanceCommit, feasibilityAuditCommit } : {}), criticCommit };

  const judge = json(paths.finalJudge);
  assertExactKeySet(judge, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'target', 'critic', ...(revisionChanges ? ['acceptanceMatrix', 'feasibilityAudit', 'revisionComparison', 'revisionClosure'] : []), 'verdict', 'coverage', 'findings', 'unresolved', 'maximumVerdict'], 'S02 final judge');
  assertExactKeySet(judge.target, ['commit', 'tree'], 'S02 judge target');
  assertExactKeySet(judge.critic, ['path', 'blob'], 'S02 judge critic binding');
  assertExactKeySet(judge.unresolved, ['P0', 'P1'], 'S02 judge unresolved');
  assert(judge.schemaVersion === 1 && judge.artifactId === `cats-tower-s02-golden-master-p1-final-judge-round-${evidenceRound}` && judge.repository === critic.repository && judge.branch === critic.branch && judge.changeControl === changeControlPath, `${labelPrefix} judge identity or authority mismatch`);
  assert(judge.target.commit === targetCommit && judge.target.tree === targetTree && judge.critic.path === paths.critic && judge.critic.blob === git(['rev-parse', `HEAD:${paths.critic}`]), `${labelPrefix} judge target or critic binding mismatch`);
  assert(judge.verdict === 'PASS_S02_GOLDEN_MASTER_P1_FINAL_JUDGE' && judge.maximumVerdict === 'READY_FOR_S02_P1_COMPLETION_EVIDENCE' && judge.unresolved.P0 === 0 && judge.unresolved.P1 === 0, 'S02 judge verdict boundary mismatch');
  assert(JSON.stringify(judge.coverage) === JSON.stringify(critic.coverage) && JSON.stringify(judge.findings) === JSON.stringify(critic.findings), 'S02 judge coverage or finding set differs from the critic');
  if (revisionChanges) {
    assert(JSON.stringify(judge.acceptanceMatrix) === JSON.stringify(critic.acceptanceMatrix), `${labelPrefix}: final judge does not bind the versioned Acceptance Matrix`);
    assert(JSON.stringify(judge.feasibilityAudit) === JSON.stringify(critic.feasibilityAudit), `${labelPrefix}: final judge does not bind the versioned feasibility audit`);
    assert(JSON.stringify(judge.revisionComparison) === JSON.stringify(critic.revisionComparison), `${labelPrefix}: final judge does not bind the exact same-run revision-comparison artifact`);
    assert(JSON.stringify(judge.revisionClosure) === JSON.stringify(critic.revisionClosure), `${labelPrefix}: final judge does not independently carry the exact user-revision closure`);
  }
  const judgeCommit = firstAddCommit(paths.finalJudge);
  assert(judgeCommit && git(['rev-parse', `${judgeCommit}^`]) === criticCommit, 'S02 judge must immediately follow the critic');
  assertExactChangedPaths(criticCommit, judgeCommit, [paths.finalJudge], `${labelPrefix} final-judge commit`);
  assertAddedOnceAndUnchanged(paths.finalJudge, judgeCommit);
  if (!presence.completion) return { targetCommit, targetTree, contentManifest: expectedContentManifest, ...(revisionChanges ? { acceptanceCommit, feasibilityAuditCommit } : {}), criticCommit, judgeCommit };

  const completion = json(paths.completion);
  assertExactKeySet(completion, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'finalJudge', 'workflow', ...(revisionChanges ? ['acceptanceMatrix', 'feasibilityAudit'] : []), 'verdict', 'unresolved', 'maximumVerdict'], 'S02 completion evidence');
  assertExactKeySet(completion.verifiedContent, ['commit', 'tree'], 'S02 completion target');
  assertExactKeySet(completion.finalJudge, ['path', 'blob'], 'S02 completion judge binding');
  assertExactKeySet(completion.unresolved, ['P0', 'P1'], 'S02 completion unresolved');
  assert(completion.schemaVersion === 1 && completion.artifactId === `cats-tower-s02-golden-master-p1-completion-round-${evidenceRound}` && completion.repository === critic.repository && completion.branch === critic.branch && completion.changeControl === changeControlPath, `${labelPrefix} completion identity or authority mismatch`);
  assert(completion.verifiedContent.commit === targetCommit && completion.verifiedContent.tree === targetTree && completion.finalJudge.path === paths.finalJudge && completion.finalJudge.blob === git(['rev-parse', `HEAD:${paths.finalJudge}`]), `${labelPrefix} completion target or judge binding mismatch`);
  assert(JSON.stringify(completion.workflow) === JSON.stringify(critic.workflow), 'S02 completion workflow differs from critic workflow evidence');
  if (revisionChanges) {
    assert(JSON.stringify(completion.acceptanceMatrix) === JSON.stringify(critic.acceptanceMatrix), `${labelPrefix}: completion does not bind the versioned Acceptance Matrix`);
    assert(JSON.stringify(completion.feasibilityAudit) === JSON.stringify(critic.feasibilityAudit), `${labelPrefix}: completion does not bind the versioned feasibility audit`);
  }
  assert(completion.verdict === 'READY_FOR_S02_DEPLOYMENT_READBACK' && completion.maximumVerdict === 'READY_FOR_S02_DEPLOYMENT_READBACK' && completion.unresolved.P0 === 0 && completion.unresolved.P1 === 0, 'S02 completion verdict boundary mismatch');
  const completionCommit = firstAddCommit(paths.completion);
  assert(completionCommit && git(['rev-parse', `${completionCommit}^`]) === judgeCommit, 'S02 completion must immediately follow the judge');
  assertExactChangedPaths(judgeCommit, completionCommit, [paths.completion], `${labelPrefix} completion commit`);
  assertAddedOnceAndUnchanged(paths.completion, completionCommit);
  if (!presence.deploymentRequest) return { targetCommit, targetTree, contentManifest: expectedContentManifest, ...(revisionChanges ? { acceptanceCommit, feasibilityAuditCommit } : {}), criticCommit, judgeCommit, completionCommit };

  const deploymentRequest = json(paths.deploymentRequest);
  assertExactKeySet(deploymentRequest, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'completion', 'review', 'maximumVerdict'], 'S02 deployment readback request');
  assertExactKeySet(deploymentRequest.verifiedContent, ['commit', 'tree'], 'S02 deployment request content');
  assertExactKeySet(deploymentRequest.completion, ['path', 'blob'], 'S02 deployment request completion');
  assertExactKeySet(deploymentRequest.review, ['branchAlias', 'route', 'manifestPath', 'manifestBlob', 'requiredLabels', 'goldenMasters', 'temporaryAccess'], 'S02 deployment request review target');
  assertExactKeySet(deploymentRequest.review.temporaryAccess, ['kind', 'url', 'expiresAt'], 'S02 deployment request temporary Preview access');
  const requestCommit = firstAddCommit(paths.deploymentRequest);
  assert(deploymentRequest.schemaVersion === 1 && deploymentRequest.artifactId === `cats-tower-s02-preview-readback-request-round-${evidenceRound}` && deploymentRequest.repository === critic.repository && deploymentRequest.branch === 'kimi' && deploymentRequest.changeControl === changeControlPath, `${labelPrefix} deployment request identity or authority mismatch`);
  assert(requestCommit, 'S02 deployment request commit is missing');
  assert(JSON.stringify(deploymentRequest.verifiedContent) === JSON.stringify({ commit: targetCommit, tree: targetTree }) && deploymentRequest.completion.path === paths.completion && deploymentRequest.completion.blob === git(['rev-parse', `HEAD:${paths.completion}`]), `${labelPrefix} deployment request content or completion binding mismatch`);
  assert(deploymentRequest.review.branchAlias === 'https://catstower-git-kimi-shinyaaas-projects.vercel.app' && deploymentRequest.review.route === '/step4/s02/golden-master-p1/' && deploymentRequest.review.manifestPath === 'step4/s02/golden-master-p1/review-manifest.json', 'S02 deployment request route, alias or manifest path mismatch');
  let temporaryAccessUrl;
  try {
    temporaryAccessUrl = new URL(deploymentRequest.review.temporaryAccess.url);
  } catch {
    assert(false, 'S02 deployment request temporary access URL is invalid');
  }
  const temporaryAccessKeys = [...temporaryAccessUrl.searchParams.keys()];
  assert(deploymentRequest.review.temporaryAccess.kind === 'VERCEL_TEMPORARY_SHARE_23H' && temporaryAccessUrl.origin === deploymentRequest.review.branchAlias && temporaryAccessUrl.username === '' && temporaryAccessUrl.password === '' && temporaryAccessUrl.pathname === deploymentRequest.review.route && temporaryAccessUrl.hash === '' && JSON.stringify(temporaryAccessKeys) === JSON.stringify(['_vercel_share']) && /^[A-Za-z0-9_-]{16,512}$/.test(temporaryAccessUrl.searchParams.get('_vercel_share') ?? ''), 'S02 deployment request temporary access is not the exact scoped credential-free Vercel share URL');
  const requestCommitTime = Date.parse(git(['show', '-s', '--format=%cI', requestCommit]));
  const accessExpiry = Date.parse(deploymentRequest.review.temporaryAccess.expiresAt ?? '');
  assert(Number.isFinite(requestCommitTime) && Number.isFinite(accessExpiry) && accessExpiry > requestCommitTime && accessExpiry <= requestCommitTime + 25 * 60 * 60 * 1000, 'S02 temporary Preview access expiry is absent or exceeds the reviewed 25-hour maximum');
  assert(deploymentRequest.review.manifestBlob === git(['rev-parse', `${targetCommit}:${deploymentRequest.review.manifestPath}`]), 'S02 deployment request manifest blob differs from target');
  const exactServedFileManifest = deriveS02ServedFileManifest(targetCommit, deploymentRequest.review.manifestPath, deploymentRequest.review.route);
  assert(JSON.stringify(jsonAt(targetCommit, deploymentRequest.review.manifestPath)) === JSON.stringify(exactServedFileManifest), 'S02 review manifest does not exactly enumerate every non-manifest file served by the review route');
  assert(JSON.stringify(deploymentRequest.review.requiredLabels) === JSON.stringify(['DESIGN REVIEW', 'S02 GOLDEN MASTER', 'NOT RUNTIME']) && JSON.stringify(deploymentRequest.review.goldenMasters) === JSON.stringify(['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08']), 'S02 deployment request labels or Golden Master set mismatch');
  assert(deploymentRequest.maximumVerdict === 'PENDING_EXTERNAL_PREVIEW_READBACK', 'S02 deployment request overclaims external readback');
  assert(git(['rev-parse', `${requestCommit}^`]) === completionCommit, 'S02 deployment request must immediately follow completion');
  assertExactChangedPaths(completionCommit, requestCommit, [paths.deploymentRequest], `${labelPrefix} deployment-readback request commit`);
  assertAddedOnceAndUnchanged(paths.deploymentRequest, requestCommit);
  if (!presence.deploymentReadback) return { targetCommit, targetTree, contentManifest: expectedContentManifest, ...(revisionChanges ? { acceptanceCommit, feasibilityAuditCommit } : {}), criticCommit, judgeCommit, completionCommit, requestCommit };

  const readback = json(paths.deploymentReadback);
  assertExactKeySet(readback, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'completion', 'request', 'externalProof', 'verifiedDeployment', 'verifiedHttp', 'verdict', 'unresolved', 'maximumVerdict'], 'S02 deployment readback');
  assertExactKeySet(readback.verifiedContent, ['commit', 'tree'], 'S02 deployment content');
  assertExactKeySet(readback.completion, ['path', 'blob'], 'S02 deployment completion binding');
  assertExactKeySet(readback.request, ['path', 'blob'], 'S02 deployment request binding');
  assertExactKeySet(readback.verifiedDeployment, ['id', 'immutableUrl', 'environment', 'githubCommit', 'githubRef', 'productionTargeted'], 'S02 verified deployment summary');
  assertExactKeySet(readback.verifiedHttp, ['branchAlias', 'reviewRoute', 'verifiedAt', 'aliasServesReviewedContent'], 'S02 verified HTTP summary');
  assertExactKeySet(readback.unresolved, ['P0', 'P1'], 'S02 deployment unresolved');
  const readbackCommit = firstAddCommit(paths.deploymentReadback);
  assert(readback.schemaVersion === 1 && readback.artifactId === `cats-tower-s02-golden-master-p1-deployment-readback-round-${evidenceRound}` && readback.repository === critic.repository && readback.branch === critic.branch && readback.changeControl === changeControlPath, `${labelPrefix} deployment readback identity or authority mismatch`);
  assert(readback.verifiedContent.commit === targetCommit && readback.verifiedContent.tree === targetTree && readback.completion.path === paths.completion && readback.completion.blob === git(['rev-parse', `HEAD:${paths.completion}`]), `${labelPrefix} deployment readback content or completion binding mismatch`);
  assert(readback.request.path === paths.deploymentRequest && readback.request.blob === git(['rev-parse', `HEAD:${paths.deploymentRequest}`]), `${labelPrefix} deployment readback does not bind the immutable external-proof request`);
  const livePreviewEvidence = verifyS02ExternalPreviewEvidence(readback.externalProof, deploymentRequest, `${labelPrefix} external Preview readback`, paths.deploymentRequest, requireLiveExternal);
  assert(/^dpl_[A-Za-z0-9]+$/.test(readback.verifiedDeployment.id ?? '') && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(readback.verifiedDeployment.immutableUrl ?? '') && readback.verifiedDeployment.environment === 'Preview' && readback.verifiedDeployment.githubCommit === targetCommit && readback.verifiedDeployment.githubRef === 'kimi' && readback.verifiedDeployment.productionTargeted === false, 'S02 verified deployment summary is invalid');
  assert(readback.verifiedHttp.branchAlias === deploymentRequest.review.branchAlias && readback.verifiedHttp.reviewRoute === deploymentRequest.review.route && isCanonicalIsoInstant(readback.verifiedHttp.verifiedAt) && readback.verifiedHttp.aliasServesReviewedContent === true, 'S02 verified HTTP summary is invalid');
  if (livePreviewEvidence) {
    assert(JSON.stringify(readback.verifiedDeployment) === JSON.stringify({ id: livePreviewEvidence.result.contentDeployment.vercelDeploymentId, immutableUrl: livePreviewEvidence.result.contentDeployment.immutableUrl, environment: 'Preview', githubCommit: targetCommit, githubRef: 'kimi', productionTargeted: false }), 'S02 deployment summary differs from live external proof');
    assert(JSON.stringify(readback.verifiedHttp) === JSON.stringify({ branchAlias: deploymentRequest.review.branchAlias, reviewRoute: deploymentRequest.review.route, verifiedAt: livePreviewEvidence.httpReport.verifiedAt, aliasServesReviewedContent: true }), 'S02 HTTP summary differs from live external proof');
  }
  assert(readback.verdict === 'READY_FOR_USER_VISUAL_REVIEW' && readback.maximumVerdict === 'READY_FOR_USER_VISUAL_REVIEW' && readback.unresolved.P0 === 0 && readback.unresolved.P1 === 0, 'S02 deployment readback verdict boundary mismatch');
  assert(readbackCommit && git(['rev-parse', `${readbackCommit}^`]) === requestCommit, 'S02 deployment readback must immediately follow the external-proof request');
  assertExactChangedPaths(requestCommit, readbackCommit, [paths.deploymentReadback], `${labelPrefix} deployment-readback commit`);
  assertAddedOnceAndUnchanged(paths.deploymentReadback, readbackCommit);
  return { targetCommit, targetTree, contentManifest: expectedContentManifest, ...(revisionChanges ? { acceptanceCommit, feasibilityAuditCommit } : {}), criticCommit, judgeCommit, completionCommit, requestCommit, readbackCommit, livePreviewEvidence };
}

const s02ReviewPrefix = s02RepairControl ? verifyS02ReviewEvidencePrefix() : null;
function firstCommitAfterOnSingleParentLineage(ancestor, descendant, label) {
  assert(ancestor === descendant || isAncestor(ancestor, descendant), `${label}: endpoint is not descended from base`);
  if (ancestor === descendant) return null;
  const commits = git(['rev-list', '--reverse', '--ancestry-path', `${ancestor}..${descendant}`]).split('\n').filter(Boolean);
  assert(commits.length > 0, `${label}: cannot resolve first descendant`);
  let parent = ancestor;
  for (const commit of commits) {
    const lineage = git(['rev-list', '--parents', '-n', '1', commit]).split(' ');
    assert(lineage.length === 2 && lineage[1] === parent, `${label}: renewal/decision lineage contains a merge or discontinuity`);
    parent = commit;
  }
  return commits[0];
}
function verifyS02ReadyAccessRenewals({ reviewPrefix, evidencePaths, evidenceRound, successorOpeningCommit = null, label }) {
  if (!reviewPrefix?.readbackCommit) return null;
  const endpoint = successorOpeningCommit ? git(['rev-parse', `${successorOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
  const baseReadyCommit = firstCommitAfterOnSingleParentLineage(reviewPrefix.readbackCommit, endpoint, `${label} READY lineage`);
  assert(baseReadyCommit && git(['rev-parse', `${baseReadyCommit}^`]) === reviewPrefix.readbackCommit, `${label}: dedicated READY activation is absent`);
  assertExactChangedPaths(reviewPrefix.readbackCommit, baseReadyCommit, expectedS02ReadyActivationWrites, `${label} base READY activation`);
  const baseReadyAuthority = jsonAt(baseReadyCommit, 'CURRENT_AUTHORITY_INDEX.json');
  assert(baseReadyAuthority.status === 'READY_FOR_USER_VISUAL_REVIEW', `${label}: base activation is not READY_FOR_USER_VISUAL_REVIEW`);
  const afterReady = endpoint === baseReadyCommit ? [] : git(['rev-list', '--reverse', '--ancestry-path', `${baseReadyCommit}..${endpoint}`]).split('\n').filter(Boolean);
  const canonicalRequest = json(evidencePaths.deploymentRequest);
  const canonicalReadback = json(evidencePaths.deploymentReadback);
  let previousRequestPath = evidencePaths.deploymentRequest;
  let previousReadbackPath = evidencePaths.deploymentReadback;
  let previousRequestBlob = git(['rev-parse', `HEAD:${previousRequestPath}`]);
  let previousReadbackBlob = git(['rev-parse', `HEAD:${previousReadbackPath}`]);
  let previousAccessUrl = canonicalRequest.review.temporaryAccess.url;
  let currentRequest = canonicalRequest;
  let currentReadback = canonicalReadback;
  let currentRequestPath = evidencePaths.deploymentRequest;
  let currentReadbackPath = evidencePaths.deploymentReadback;
  let decisionReadyCommit = baseReadyCommit;
  let pendingRequest = null;
  let cursor = 0;
  assert(String(32).padStart(3, '0') === '032' && String(33).padStart(3, '0') === '033' && /^\d{3,}$/.test(String(1000).padStart(3, '0')), `${label}: renewal numbering does not remain live beyond 032/999`);
  for (let renewalIndex = 1; cursor < afterReady.length; renewalIndex += 1) {
    const suffix = String(renewalIndex).padStart(3, '0');
    const prefix = `quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-access-renewal-round-${evidenceRound}-${suffix}`;
    const requestPath = `${prefix}-request.json`;
    const readbackPath = `${prefix}-readback.json`;
    const requestCommit = afterReady[cursor];
    assertExactChangedPaths(cursor === 0 ? baseReadyCommit : afterReady[cursor - 1], requestCommit, [requestPath], `${label} access renewal ${suffix} request`);
    assert(firstAddCommit(requestPath) === requestCommit, `${label}: renewal ${suffix} request was not first added at its exact commit`);
    const request = json(requestPath);
    assertExactKeySet(request, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'completion', 'previousAccess', 'review', 'maximumVerdict'], `${label} renewal ${suffix} request`);
    assertExactKeySet(request.previousAccess, ['request', 'readback'], `${label} renewal ${suffix} previous access`);
    assertExactKeySet(request.previousAccess.request, ['path', 'blob'], `${label} renewal ${suffix} previous request`);
    assertExactKeySet(request.previousAccess.readback, ['path', 'blob'], `${label} renewal ${suffix} previous readback`);
    assertExactKeySet(request.review, ['branchAlias', 'route', 'manifestPath', 'manifestBlob', 'requiredLabels', 'goldenMasters', 'temporaryAccess'], `${label} renewal ${suffix} review`);
    assertExactKeySet(request.review.temporaryAccess, ['kind', 'url', 'expiresAt'], `${label} renewal ${suffix} temporary access`);
    assert(request.schemaVersion === 1 && request.artifactId === `cats-tower-s02-preview-access-renewal-request-round-${evidenceRound}-${suffix}` && request.repository === canonicalRequest.repository && request.branch === 'kimi' && request.changeControl === canonicalRequest.changeControl, `${label}: renewal ${suffix} identity or authority mismatch`);
    assert(JSON.stringify(request.verifiedContent) === JSON.stringify(canonicalRequest.verifiedContent) && JSON.stringify(request.completion) === JSON.stringify(canonicalRequest.completion) && request.maximumVerdict === 'PENDING_EXTERNAL_PREVIEW_READBACK', `${label}: renewal ${suffix} changed content/completion or overclaimed`);
    const { temporaryAccess: ignoredCanonicalAccess, ...canonicalReview } = canonicalRequest.review;
    const { temporaryAccess, ...renewalReview } = request.review;
    assert(JSON.stringify(renewalReview) === JSON.stringify(canonicalReview), `${label}: renewal ${suffix} changed the reviewed route, manifest, labels or Golden Masters`);
    assert(JSON.stringify(request.previousAccess) === JSON.stringify({ request: { path: previousRequestPath, blob: previousRequestBlob }, readback: { path: previousReadbackPath, blob: previousReadbackBlob } }), `${label}: renewal ${suffix} does not chain from the exact preceding access proof`);
    let accessUrl;
    try { accessUrl = new URL(temporaryAccess.url); } catch { assert(false, `${label}: renewal ${suffix} URL is invalid`); }
    assert(temporaryAccess.kind === 'VERCEL_TEMPORARY_SHARE_23H' && accessUrl.origin === canonicalRequest.review.branchAlias && accessUrl.username === '' && accessUrl.password === '' && accessUrl.pathname === canonicalRequest.review.route && accessUrl.hash === '' && JSON.stringify([...accessUrl.searchParams.keys()]) === JSON.stringify(['_vercel_share']) && /^[A-Za-z0-9_-]{16,512}$/.test(accessUrl.searchParams.get('_vercel_share') ?? '') && temporaryAccess.url !== previousAccessUrl, `${label}: renewal ${suffix} temporary URL is not a fresh exact credential-free scoped share`);
    const requestTime = Date.parse(git(['show', '-s', '--format=%cI', requestCommit]));
    const expiry = Date.parse(temporaryAccess.expiresAt ?? '');
    assert(Number.isFinite(expiry) && expiry > requestTime && expiry <= requestTime + 25 * 60 * 60 * 1000, `${label}: renewal ${suffix} expiry is invalid`);
    assertAddedOnceAndUnchanged(requestPath, requestCommit);
    cursor += 1;
    if (cursor === afterReady.length) {
      pendingRequest = { path: requestPath, commit: requestCommit, request };
      currentRequest = request;
      break;
    }
    const readbackCommit = afterReady[cursor];
    assertExactChangedPaths(requestCommit, readbackCommit, [readbackPath], `${label} access renewal ${suffix} readback`);
    assert(firstAddCommit(readbackPath) === readbackCommit, `${label}: renewal ${suffix} readback was not first added at its exact commit`);
    const readback = json(readbackPath);
    assertExactKeySet(readback, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'completion', 'request', 'externalProof', 'verifiedDeployment', 'verifiedHttp', 'verdict', 'unresolved', 'maximumVerdict'], `${label} renewal ${suffix} readback`);
    assert(readback.schemaVersion === 1 && readback.artifactId === `cats-tower-s02-preview-access-renewal-readback-round-${evidenceRound}-${suffix}` && readback.repository === canonicalReadback.repository && readback.branch === 'kimi' && readback.changeControl === canonicalReadback.changeControl, `${label}: renewal ${suffix} readback identity or authority mismatch`);
    assert(JSON.stringify(readback.verifiedContent) === JSON.stringify(canonicalReadback.verifiedContent) && JSON.stringify(readback.completion) === JSON.stringify(canonicalReadback.completion) && readback.request.path === requestPath && readback.request.blob === git(['rev-parse', `HEAD:${requestPath}`]), `${label}: renewal ${suffix} readback content/completion/request mismatch`);
    const live = verifyS02ExternalPreviewEvidence(readback.externalProof, request, `${label} access renewal ${suffix}`, requestPath, !successorOpeningCommit);
    assert(/^dpl_[A-Za-z0-9]+$/.test(readback.verifiedDeployment.id ?? '') && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(readback.verifiedDeployment.immutableUrl ?? '') && readback.verifiedDeployment.environment === 'Preview' && readback.verifiedDeployment.githubCommit === reviewPrefix.targetCommit && readback.verifiedDeployment.githubRef === 'kimi' && readback.verifiedDeployment.productionTargeted === false, `${label}: renewal ${suffix} deployment summary is invalid`);
    assert(readback.verifiedHttp.branchAlias === request.review.branchAlias && readback.verifiedHttp.reviewRoute === request.review.route && readback.verifiedHttp.aliasServesReviewedContent === true && Date.parse(readback.verifiedHttp.verifiedAt) <= expiry, `${label}: renewal ${suffix} HTTP summary is invalid or expired`);
    if (live) {
      assert(JSON.stringify(readback.verifiedDeployment) === JSON.stringify({ id: live.result.contentDeployment.vercelDeploymentId, immutableUrl: live.result.contentDeployment.immutableUrl, environment: 'Preview', githubCommit: reviewPrefix.targetCommit, githubRef: 'kimi', productionTargeted: false }), `${label}: renewal ${suffix} deployment differs from live proof`);
      assert(JSON.stringify(readback.verifiedHttp) === JSON.stringify({ branchAlias: request.review.branchAlias, reviewRoute: request.review.route, verifiedAt: live.httpReport.verifiedAt, aliasServesReviewedContent: true }), `${label}: renewal ${suffix} HTTP evidence differs from live proof`);
    }
    assert(readback.verdict === 'READY_FOR_USER_VISUAL_REVIEW' && readback.maximumVerdict === 'READY_FOR_USER_VISUAL_REVIEW' && JSON.stringify(readback.unresolved) === JSON.stringify({ P0: 0, P1: 0 }), `${label}: renewal ${suffix} overclaims or retains P0/P1`);
    assertAddedOnceAndUnchanged(readbackPath, readbackCommit);
    previousRequestPath = requestPath; previousReadbackPath = readbackPath;
    previousRequestBlob = git(['rev-parse', `HEAD:${requestPath}`]); previousReadbackBlob = git(['rev-parse', `HEAD:${readbackPath}`]);
    previousAccessUrl = temporaryAccess.url; currentRequest = request; currentReadback = readback; currentRequestPath = requestPath; currentReadbackPath = readbackPath; decisionReadyCommit = readbackCommit;
    cursor += 1;
  }
  assertNoPathChangesSince(reviewPrefix.targetCommit, endpoint, reviewPrefix.contentManifest.map(entry => entry.path), `${label} content freeze through access renewal`);
  assertNoPathChangesSince(baseReadyCommit, endpoint, expectedS02ReadyActivationWrites, `${label} mirror freeze through access renewal`);
  return { baseReadyCommit, decisionReadyCommit, currentRequest, currentReadback, currentRequestPath, currentReadbackPath, pendingRequest, endpoint };
}
assert(!(s02P2Control && s02RevisionControl), 'round 035 approval and round 036 revision are mutually exclusive successors of the initial READY state');
const s02InitialReadyAccess = s02ReviewPrefix?.readbackCommit
  ? verifyS02ReadyAccessRenewals({ reviewPrefix: s02ReviewPrefix, evidencePaths: s02ReviewEvidencePaths, evidenceRound: '001', successorOpeningCommit: s02P2OpeningCommit ?? s02RevisionOpeningCommit, label: 'S02 initial review' })
  : null;
const s02RevisionHarnessStringLimit = 240;
function isWithinS02RevisionHarnessStringLimit(value) {
  return typeof value === 'string' && value.length <= s02RevisionHarnessStringLimit;
}
assert(isWithinS02RevisionHarnessStringLimit('x'.repeat(240)) && !isWithinS02RevisionHarnessStringLimit('x'.repeat(241)), 'S02 revision harness string boundary is not fail-closed at 240 characters');
function isCanonicalS02RevisionSelector(value) {
  if (typeof value !== 'string' || value.length > 240 || value !== value.trim() || !value.startsWith(':scope') || /[,~+]|:has\s*\(|[\r\n]/.test(value)) return false;
  const atom = String.raw`(?:\*|[a-zA-Z][a-zA-Z0-9_-]*|[.#][a-zA-Z_][a-zA-Z0-9_-]*|\[(?:data-[a-z0-9-]+|aria-[a-z0-9-]+|role|id|class)(?:=(?:"[a-zA-Z0-9_./:-]{1,120}"|'[a-zA-Z0-9_./:-]{1,120}'|[a-zA-Z_][a-zA-Z0-9_-]*))?\])`;
  const compound = `(?:${atom})+`;
  return new RegExp(`^:scope(?:\\s+|\\s*>\\s*)${compound}(?:(?:\\s+|\\s*>\\s*)${compound})*$`).test(value);
}
function isCanonicalS02ExactText(value) {
  return isWithinS02RevisionHarnessStringLimit(value) && value.length >= 1 && value === value.replace(/\s+/gu, ' ').trim();
}
for (const selector of [':scope .item', ':scope > [data-gm="GM01"] .label', ":scope article.party-card[data-party-state='field']"]) assert(isCanonicalS02RevisionSelector(selector), 'S02 revision selector grammar rejected a valid safety vector');
for (const selector of [':scope [', ':scope >> .a', ':scope > > .a', ':scope [id=foo.bar]', ':scope [id="foo\\"]', 'body .a', ':scope .a,.b', ':scope:has(.a)']) assert(!isCanonicalS02RevisionSelector(selector), 'S02 revision selector grammar accepted an invalid safety vector');
assert(isCanonicalS02ExactText('猫 4体') && !isCanonicalS02ExactText('猫  4体'), 'S02 revision text canonicalization vectors failed');
const s02GoldenMasterViewportById = new Map(s02ExpectedScreenshots.slice(0, 8).map(({ id, width, height }) => [id, { width, height }]));
function s02CriterionMaximumMagnitude(criterion) {
  const viewport = s02GoldenMasterViewportById.get(criterion.goldenMaster);
  assert(viewport, `S02 revision criterion has no reviewed viewport: ${criterion.goldenMaster}`);
  if (criterion.type === 'DOM_RECT_DELTA') return ['width', 'x'].includes(criterion.property) ? viewport.width : viewport.height;
  if (criterion.type === 'DOM_STYLE_DELTA') return criterion.property === 'opacity' ? 1 : viewport.height;
  if (criterion.type === 'ELEMENT_VISIBLE') return viewport.width * viewport.height;
  return null;
}
function isCanonicalChromiumComputedColor(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^rgba?\((\d{1,3}), (\d{1,3}), (\d{1,3})(?:, (0|1|0?\.\d+))?\)$/);
  if (!match || match.slice(1, 4).some(component => Number(component) > 255)) return false;
  const alpha = match[4] === undefined ? null : Number(match[4]);
  return alpha === null || (Number.isFinite(alpha) && alpha >= 0 && alpha <= 1 && String(alpha) === match[4]);
}
assert(isCanonicalChromiumComputedColor('rgb(0, 128, 255)') && isCanonicalChromiumComputedColor('rgba(0, 0, 0, 0.5)') && !isCanonicalChromiumComputedColor('banana'), 'Chromium computed-color canonicalization vectors failed');
function deriveActiveAcceptanceCriteria(priorActive, requestedChanges, label) {
  const active = [...priorActive];
  const priorByAssertionId = new Map(active.map(entry => [entry.assertion.id, entry]));
  const superseded = new Set();
  const replacementIds = new Set();
  const mechanicalTargets = new Set(['step4/s02/golden-master-p1/review-manifest.json', 'step4/s02/golden-master-p1/asset-manifest.json']);
  const sameSemanticLocus = (prior, replacement) => {
    if (prior.type !== replacement.type || prior.goldenMaster !== replacement.goldenMaster) return false;
    if (prior.type === 'ROI_PIXEL_DELTA') return JSON.stringify(prior.region) === JSON.stringify(replacement.region);
    if (prior.selector !== replacement.selector) return false;
    return !['DOM_RECT_DELTA', 'DOM_STYLE_DELTA'].includes(prior.type) || prior.property === replacement.property;
  };
  const equallyStrongReplacement = (prior, replacement) => {
    if (!sameSemanticLocus(prior, replacement)) return false;
    if (prior.type === 'TEXT_EXACT') return replacement.expected !== prior.expected;
    if (prior.type === 'ELEMENT_VISIBLE') return replacement.minimumArea >= prior.minimumArea;
    if (prior.type === 'ROI_PIXEL_DELTA') return ['changedPixelRatio', 'meanAbsoluteChannelDelta'].every(key => replacement[key][0] >= prior[key][0] && replacement[key][1] <= prior[key][1]);
    if (prior.operator !== replacement.operator) return false;
    if (prior.operator === 'AFTER_EQUALS') return replacement.threshold !== prior.threshold;
    if (prior.operator === 'CHANGED') return true;
    return Math.abs(replacement.threshold) >= Math.abs(prior.threshold);
  };
  for (const change of requestedChanges) {
    assert(Array.isArray(change.supersedesAssertions) && JSON.stringify(change.supersedesAssertions) === JSON.stringify([...change.supersedesAssertions].sort()) && new Set(change.supersedesAssertions).size === change.supersedesAssertions.length, `${label}: superseded assertion IDs must be a sorted unique set`);
    for (const assertionId of change.supersedesAssertions) {
      const prior = priorByAssertionId.get(assertionId);
      assert(prior && !superseded.has(assertionId), `${label}: supersession does not name one exact active prior assertion: ${assertionId}`);
      const meaningfulPriorTargets = prior.targetPaths.filter(file => !mechanicalTargets.has(file));
      const meaningfulCurrentTargets = change.targetPaths.filter(file => !mechanicalTargets.has(file));
      assert(prior.affectedGoldenMasters.some(id => change.affectedGoldenMasters.includes(id)) && meaningfulPriorTargets.some(file => meaningfulCurrentTargets.includes(file)), `${label}: superseded assertion does not overlap the current request's Golden Master and non-mechanical target-path scope: ${assertionId}`);
      const replacements = change.acceptanceAssertions.filter(assertion => equallyStrongReplacement(prior.assertion, assertion));
      assert(replacements.length === 1 && !replacementIds.has(replacements[0].id), `${label}: superseded assertion lacks one unique same-locus, non-vacuous and at-least-equivalent replacement: ${assertionId}`);
      replacementIds.add(replacements[0].id);
      superseded.add(assertionId);
    }
  }
  const survivors = active.filter(entry => !superseded.has(entry.assertion.id));
  const additions = requestedChanges.flatMap(change => change.acceptanceAssertions.map(assertion => ({
    requestId: change.id,
    criterionSha256: `sha256:${sha256Canonical(assertion)}`,
    assertion,
    affectedGoldenMasters: change.affectedGoldenMasters,
    targetPaths: change.targetPaths
  })));
  const result = [...survivors, ...additions];
  assert(new Set(result.map(entry => entry.assertion.id)).size === result.length, `${label}: active acceptance assertion IDs are not globally unique`);
  return result;
}
function publicActiveAcceptanceCriteria(active) {
  return active.map(({ requestId, criterionSha256, assertion }) => ({ requestId, criterionSha256, assertion }));
}
function verifyS02RevisionHandoff() {
  assert(Boolean(s02RevisionControl) === Boolean(s02RevisionDecisionLock), 'round 036 control and round 007 user-revision lock must appear atomically');
  const revisionEvidencePresence = Object.values(s02RevisionReviewEvidencePaths).some(exists);
  if (!s02RevisionControl) {
    assert(!revisionEvidencePresence, 'round 002 S02 review evidence exists without the exact round 036 user-revision control');
    return null;
  }
  assert(!s02P2Control && !s02UserDecisionLock, 'S02 revision may open only before P2 approval');
  assert(!(s02RevisedP2Control && s02SecondRevisionControl), 'round 037 approval and round 038 second revision are mutually exclusive successors of the same revised READY target');
  assert(s02RepairControl && s02ReviewPrefix?.readbackCommit, 'round 036 requires the complete immutable round 001 S02 review chain');
  assertExactKeySet(s02RevisionControl, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'entryWorkflow', 'userDecisionLock', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'revisionRequest', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], 'round 036 revision control');
  assertExactKeySet(s02RevisionControl.entry, ['head', 'tree'], 'round 036 entry');
  assertWorkflowEvidenceKeys(s02RevisionControl.entryWorkflow, 'round 036 entry workflow', true);
  assertExactKeySet(s02RevisionControl.userDecisionLock, ['path', 'blob'], 'round 036 decision-lock binding');
  assertExactKeySet(s02RevisionControl.revisionRequest, ['count', 'requestSha256', 'targetPaths'], 'round 036 revision request binding');
  assertExactKeySet(s02RevisionControl.completionBoundary, ['requiredInternalP0', 'requiredInternalP1', 'maximumAfterRevisionReview', 'mayNotDeclare', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified', 'userVisualApproval'], 'round 036 completion boundary');
  assert(s02RevisionControl.schemaVersion === 1 && s02RevisionControl.artifactId === 'cats-tower-active-change-control-addendum-round-036' && isCanonicalIsoDate(s02RevisionControl.createdAt), 'round 036 identity or date mismatch');
  assert(s02RevisionControl.repository === '2hg7trp7rv-design/cats_tower' && s02RevisionControl.branch === 'kimi' && s02RevisionControl.parentChangeControl === s02RepairControlPath, 'round 036 repository, branch or parent mismatch');
  assert(s02RevisionControl.status === 'IN_PROGRESS' && s02RevisionControl.verdict === 'IN_PROGRESS_S02_P1_USER_REVISION' && s02RevisionControl.currentRepositoryStep === 4 && s02RevisionControl.internalPhase === 'S02-P1-GOLDEN-MASTER' && s02RevisionControl.internalPhaseIsRepositoryStep === false, 'round 036 phase or verdict mismatch');
  assert(s02RevisionControl.scope === 'S02_P1_EXACT_USER_REQUESTED_REVISION_ONLY', 'round 036 scope exceeds the exact user-requested S02 revision');
  assert(JSON.stringify(s02RevisionControl.completionBoundary) === JSON.stringify({
    requiredInternalP0: 0,
    requiredInternalP1: 0,
    maximumAfterRevisionReview: 'READY_FOR_USER_VISUAL_REVIEW',
    mayNotDeclare: ['S02 complete', 'Step 4 PASS', 'Step 5 allowed', 'P2 asset production allowed', 'Production Ready', 'physical iPhone verified', 'user visual approval obtained'],
    step4Pass: false,
    step5Allowed: false,
    productionAllowed: false,
    productionAliasChanged: false,
    physicalIPhoneVerified: false,
    userVisualApproval: false
  }), 'round 036 completion boundary overclaims approval, P2, release or device status');

  assertExactKeySet(s02RevisionDecisionLock, ['schemaVersion', 'artifactId', 'createdAt', 'chat', 'repository', 'branch', 'parentDecisionLock', 'base', 'sourceDecision', 'reviewAccess', 'decision', 'requestedChanges', 'boundaries'], 'round 007 user-revision lock');
  assertExactKeySet(s02RevisionDecisionLock.base, ['head', 'tree'], 'round 007 revision base');
  assertExactKeySet(s02RevisionDecisionLock.sourceDecision, ['message', 'messageSha256', 'authorizationCode', 'observedAt', 'inferred'], 'round 007 revision source');
  assertExactKeySet(s02RevisionDecisionLock.reviewAccess, ['request', 'readback'], 'round 007 review access');
  assertExactKeySet(s02RevisionDecisionLock.reviewAccess.request, ['path', 'blob'], 'round 007 review access request');
  assertExactKeySet(s02RevisionDecisionLock.reviewAccess.readback, ['path', 'blob'], 'round 007 review access readback');
  assertExactKeySet(s02RevisionDecisionLock.boundaries, ['userVisualApproval', 's02Complete', 'step4Pass', 'step5Allowed', 'p2AssetProductionAllowed', 'runtimeImplemented', 'productionReady', 'physicalIPhoneVerified', 'productionAliasChanged'], 'round 007 revision boundaries');
  assert(s02RevisionDecisionLock.schemaVersion === 1 && s02RevisionDecisionLock.artifactId === 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-007' && isCanonicalIsoDate(s02RevisionDecisionLock.createdAt), 'round 007 revision identity or date mismatch');
  assert(s02RevisionDecisionLock.chat === '04_S02-P1_GoldenMaster設計' && s02RevisionDecisionLock.repository === s02RevisionControl.repository && s02RevisionDecisionLock.branch === 'kimi' && s02RevisionDecisionLock.parentDecisionLock === 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-005.json', 'round 007 revision chat, repository, branch or parent mismatch');
  assert(s02RevisionDecisionLock.decision === 'REQUESTED_S02_GOLDEN_MASTER_P1_REVISION' && Object.values(s02RevisionDecisionLock.boundaries).every(value => value === false), 'round 007 revision decision overclaims approval, completion, P2, runtime, release or device state');
  assert(Array.isArray(s02RevisionDecisionLock.requestedChanges) && s02RevisionDecisionLock.requestedChanges.length >= 1 && s02RevisionDecisionLock.requestedChanges.length <= 20, 'round 007 must bind between one and twenty concrete revision groups');
  const gmSet = new Set(['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08']);
  const revisableDesignContracts = new Set([
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-animation-contract.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-art-direction.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-asset-decomposition.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-competitive-research.md',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-data-binding-matrix.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-information-priority.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-player-experience.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-ui-design-system.json'
  ]);
  const targetPaths = [];
  const revisionAssertionIds = new Set();
  for (const [index, change] of s02RevisionDecisionLock.requestedChanges.entries()) {
    assertExactKeySet(change, ['id', 'request', 'affectedGoldenMasters', 'targetPaths', 'requiredAssets', 'supersedesAssertions', 'acceptanceAssertions'], `round 007 requested change ${index + 1}`);
    assert(change.id === `USER-S02-REV-${String(index + 1).padStart(3, '0')}`, `round 007 requested change ID ${index + 1} is not canonical`);
    const requestCharacters = typeof change.request === 'string' ? [...change.request].filter(character => !/\s/u.test(character)) : [];
    assert(typeof change.request === 'string' && change.request === change.request.trim() && requestCharacters.length >= 3 && change.request.length <= 500 && /[\p{L}\p{N}]/u.test(change.request) && !/[\u0000-\u001f\u007f]/.test(change.request), `round 007 requested change ${change.id} is not a concrete bounded statement`);
    assert(Array.isArray(change.affectedGoldenMasters) && change.affectedGoldenMasters.length >= 1 && change.affectedGoldenMasters.length <= 8 && JSON.stringify(change.affectedGoldenMasters) === JSON.stringify([...new Set(change.affectedGoldenMasters)].sort()) && change.affectedGoldenMasters.every(id => gmSet.has(id)), `round 007 requested change ${change.id} has an invalid or noncanonical Golden Master set`);
    assert(Array.isArray(change.targetPaths) && change.targetPaths.length >= 1 && change.targetPaths.length <= 40 && change.targetPaths.every(isWithinS02RevisionHarnessStringLimit) && JSON.stringify(change.targetPaths) === JSON.stringify([...change.targetPaths].sort()) && new Set(change.targetPaths).size === change.targetPaths.length, `round 007 requested change ${change.id} target paths must be a sorted non-empty exact set with at most 240 characters per path`);
    assert(Array.isArray(change.requiredAssets) && change.requiredAssets.length <= 20 && JSON.stringify(change.requiredAssets) === JSON.stringify([...change.requiredAssets].sort()) && new Set(change.requiredAssets).size === change.requiredAssets.length, `round 007 requested change ${change.id} required assets must be a sorted unique bounded set`);
    assert(JSON.stringify(change.supersedesAssertions) === JSON.stringify([]), `round 007 cannot supersede an assertion before any revision Acceptance exists`);
    for (const asset of change.requiredAssets) {
      assert(/^assets\/[A-Za-z0-9_./-]+\.(?:webp|png|svg)$/.test(asset) && !asset.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.')), `round 007 requested change ${change.id} contains an unsafe or unsupported required asset: ${asset}`);
      assert(change.targetPaths.includes(`step4/s02/golden-master-p1/${asset}`), `round 007 requested change ${change.id} required asset is not one of its exact target paths: ${asset}`);
    }
    const targetedImageAssets = change.targetPaths
      .filter(file => /^step4\/s02\/golden-master-p1\/assets\/.+\.(?:webp|png|svg)$/.test(file))
      .map(file => file.slice('step4/s02/golden-master-p1/'.length))
      .sort();
    assert(JSON.stringify(change.requiredAssets) === JSON.stringify(targetedImageAssets), `round 007 requested change ${change.id} must declare every and only revised route image asset`);
    if (change.requiredAssets.length) assert(change.targetPaths.includes('step4/s02/golden-master-p1/asset-manifest.json'), `round 007 requested change ${change.id} revises image bytes without the asset manifest`);
    assert(Array.isArray(change.acceptanceAssertions) && change.acceptanceAssertions.length >= 1 && change.acceptanceAssertions.length <= 20, `round 007 requested change ${change.id} lacks bounded machine-checkable acceptance assertions`);
    for (const [assertionIndex, criterion] of change.acceptanceAssertions.entries()) {
      assert(criterion && typeof criterion === 'object' && !Array.isArray(criterion), `round 007 requested change ${change.id} assertion ${assertionIndex + 1} is invalid`);
      const common = ['id', 'type', 'goldenMaster'];
      const expectedKeys = criterion.type === 'DOM_RECT_DELTA' ? [...common, 'selector', 'property', 'operator', 'threshold']
        : criterion.type === 'DOM_STYLE_DELTA' ? [...common, 'selector', 'property', 'operator', 'threshold']
          : criterion.type === 'ROI_PIXEL_DELTA' ? [...common, 'region', 'changedPixelRatio', 'meanAbsoluteChannelDelta']
            : criterion.type === 'TEXT_EXACT' ? [...common, 'selector', 'expected']
              : criterion.type === 'ELEMENT_VISIBLE' ? [...common, 'selector', 'minimumArea']
                : null;
      assert(expectedKeys, `round 007 requested change ${change.id} assertion ${assertionIndex + 1} has an unsupported type`);
      assertExactKeySet(criterion, expectedKeys, `round 007 requested change ${change.id} assertion ${assertionIndex + 1}`);
      assert(criterion.id === `${change.id}-A${String(assertionIndex + 1).padStart(2, '0')}` && !revisionAssertionIds.has(criterion.id), `round 007 requested change ${change.id} assertion ID is non-canonical or duplicated`);
      revisionAssertionIds.add(criterion.id);
      assert(change.affectedGoldenMasters.includes(criterion.goldenMaster), `round 007 requested change ${change.id} assertion targets an undeclared Golden Master`);
      if (criterion.type !== 'ROI_PIXEL_DELTA') {
        assert(isCanonicalS02RevisionSelector(criterion.selector), `round 007 requested change ${change.id} assertion selector is unscoped, malformed or unsafe`);
      }
      if (criterion.type === 'DOM_RECT_DELTA') {
        const directionalThreshold = criterion.operator === 'DELTA_GTE' ? criterion.threshold > 0 : criterion.operator === 'DELTA_LTE' ? criterion.threshold < 0 : criterion.threshold > 0;
        assert(['width', 'height', 'x', 'y'].includes(criterion.property) && ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(criterion.operator) && Number.isFinite(criterion.threshold) && Math.abs(criterion.threshold) <= s02CriterionMaximumMagnitude(criterion) && directionalThreshold, `round 007 requested change ${change.id} DOM rectangle assertion contract is invalid, viewport-impossible or vacuous`);
      } else if (criterion.type === 'DOM_STYLE_DELTA') {
        assert(['font-size', 'color', 'background-color', 'opacity'].includes(criterion.property) && ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE', 'CHANGED', 'AFTER_EQUALS'].includes(criterion.operator), `round 007 requested change ${change.id} DOM style assertion property/operator is invalid`);
        const numericStyle = ['font-size', 'opacity'].includes(criterion.property);
        const numericOperator = ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(criterion.operator);
        const directionalThreshold = criterion.operator === 'DELTA_GTE' ? criterion.threshold > 0 : criterion.operator === 'DELTA_LTE' ? criterion.threshold < 0 : criterion.operator === 'ABS_DELTA_GTE' ? criterion.threshold > 0 : true;
        assert(numericStyle === numericOperator && (numericOperator ? Number.isFinite(criterion.threshold) && Math.abs(criterion.threshold) <= s02CriterionMaximumMagnitude(criterion) && directionalThreshold : (criterion.operator === 'CHANGED' ? criterion.threshold === null : isCanonicalChromiumComputedColor(criterion.threshold))), `round 007 requested change ${change.id} DOM style assertion threshold is incompatible, noncanonical or vacuous`);
      } else if (criterion.type === 'ROI_PIXEL_DELTA') {
        assertExactKeySet(criterion.region, ['x', 'y', 'width', 'height'], `round 007 requested change ${change.id} ROI region`);
        const { x, y, width, height } = criterion.region;
        assert([x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1, `round 007 requested change ${change.id} ROI is outside normalized bounds`);
        for (const [metric, bounds] of [['changedPixelRatio', criterion.changedPixelRatio], ['meanAbsoluteChannelDelta', criterion.meanAbsoluteChannelDelta]]) assert(Array.isArray(bounds) && bounds.length === 2 && bounds.every(Number.isFinite) && bounds[0] >= 0 && bounds[0] <= bounds[1] && bounds[1] <= (metric === 'changedPixelRatio' ? 1 : 255), `round 007 requested change ${change.id} ROI ${metric} bounds are invalid`);
        assert(criterion.changedPixelRatio[0] > 0 || criterion.meanAbsoluteChannelDelta[0] > 0, `round 007 requested change ${change.id} ROI assertion is vacuous`);
      } else if (criterion.type === 'TEXT_EXACT') {
        assert(isCanonicalS02ExactText(criterion.expected), `round 007 requested change ${change.id} exact text is invalid or noncanonical`);
      } else if (criterion.type === 'ELEMENT_VISIBLE') {
        assert(Number.isFinite(criterion.minimumArea) && criterion.minimumArea >= 64 && criterion.minimumArea <= s02CriterionMaximumMagnitude(criterion), `round 007 requested change ${change.id} visible-area threshold is invalid or larger than its reviewed viewport`);
      }
    }
    assert(JSON.stringify([...new Set(change.acceptanceAssertions.map(criterion => criterion.goldenMaster))].sort()) === JSON.stringify(change.affectedGoldenMasters), `round 007 requested change ${change.id} does not have acceptance coverage for every and only affected Golden Master`);
    for (const file of change.targetPaths) {
      const isRouteContent = /^step4\/s02\/golden-master-p1\/[A-Za-z0-9_./-]+\.(?:html|css|js|json|webp|png|svg)$/.test(file);
      const isDesignContract = revisableDesignContracts.has(file);
      const segments = file.split('/');
      assert((isRouteContent || isDesignContract) && segments.every(segment => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.')) && !file.includes('\\') && !file.includes('(') && !file.includes(')'), `round 007 requested change ${change.id} contains an out-of-scope path: ${file}`);
      assert(![...Object.values(s02ReviewEvidencePaths), ...Object.values(s02RevisionReviewEvidencePaths), ...s02VerificationPaths].includes(file), `round 007 requested change ${change.id} attempts to mutate review evidence or trusted verification: ${file}`);
      targetPaths.push(file);
    }
    assert(change.targetPaths.some(file => file.startsWith('step4/s02/golden-master-p1/') && !file.endsWith('/review-manifest.json') && !file.endsWith('/asset-manifest.json')), `round 007 requested change ${change.id} lacks a rendered route or asset target`);
  }
  const exactTargetPaths = [...new Set(targetPaths)].sort();
  if (exactTargetPaths.some(file => file.startsWith('step4/s02/golden-master-p1/') && !file.endsWith('/review-manifest.json'))) {
    assert(exactTargetPaths.includes('step4/s02/golden-master-p1/review-manifest.json'), 'round 007 route revision must also target the exact served-file review manifest');
  }
  const requestSha256 = `sha256:${sha256Canonical(s02RevisionDecisionLock.requestedChanges)}`;
  const revisionMessage = s02RevisionDecisionLock.sourceDecision.message;
  const revisionMessageCharacters = typeof revisionMessage === 'string' ? [...revisionMessage].filter(character => !/\s/u.test(character)) : [];
  assert(typeof revisionMessage === 'string' && revisionMessage === revisionMessage.trim() && revisionMessageCharacters.length >= 3 && revisionMessage.length <= 5000 && /[\p{L}\p{N}]/u.test(revisionMessage) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(revisionMessage), 'round 007 source message is not a bounded concrete user statement');
  assert(s02RevisionDecisionLock.sourceDecision.messageSha256 === `sha256:${sha256Text(revisionMessage)}` && s02RevisionDecisionLock.requestedChanges.every(change => revisionMessage.includes(change.request)), 'round 007 source message does not exactly contain and bind every concrete revision statement');
  assert(JSON.stringify(s02RevisionControl.revisionRequest) === JSON.stringify({ count: s02RevisionDecisionLock.requestedChanges.length, requestSha256, targetPaths: exactTargetPaths }), 'round 036 revision request does not exactly bind the round 007 concrete changes');

  const openingCommit = s02RevisionOpeningCommit;
  assert(openingCommit && firstAddCommit(s02RevisionDecisionLockPath) === openingCommit, 'round 036 control and round 007 revision lock were not first added atomically');
  const readyCommit = git(['rev-parse', `${openingCommit}^`]);
  const readyTree = git(['rev-parse', `${readyCommit}^{tree}`]);
  assertExactSingleParent(openingCommit, readyCommit, 'round 036 revision opening');
  assert(s02InitialReadyAccess && !s02InitialReadyAccess.pendingRequest && readyCommit === s02InitialReadyAccess.decisionReadyCommit, 'round 036 parent is not the latest fully verified live-access READY state');
  const readyAuthority = jsonAt(readyCommit, 'CURRENT_AUTHORITY_INDEX.json');
  assert(readyAuthority.activeChangeControl === s02RepairControlPath && readyAuthority.status === 'READY_FOR_USER_VISUAL_REVIEW', 'round 036 parent is not the exact round 034 READY state shown to the user');
  assert(JSON.stringify(s02RevisionDecisionLock.base) === JSON.stringify({ head: readyCommit, tree: readyTree }) && JSON.stringify(s02RevisionControl.entry) === JSON.stringify({ head: readyCommit, tree: readyTree }), 'round 036 control or round 007 lock does not bind the exact READY parent');
  const exactRevisionAuthorization = `REQUEST_S02_P1_GM_REVISION:${readyCommit}:${readyTree}:${requestSha256}`;
  assert(revisionMessage.includes(exactRevisionAuthorization), 'round 007 source message lacks the exact READY fingerprint and structured requestedChanges digest authorization');
  assert(s02RevisionDecisionLock.sourceDecision.authorizationCode === 'REQUEST_S02_P1_GM_REVISION' && s02RevisionDecisionLock.sourceDecision.inferred === false, 'round 007 revision category was inferred or lacks the exact safe authorization code');
  const observedAt = Date.parse(s02RevisionDecisionLock.sourceDecision.observedAt ?? '');
  const readyCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', readyCommit]));
  const openingCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', openingCommit]));
  const firstReadback = s02InitialReadyAccess.currentReadback;
  const firstRequest = s02InitialReadyAccess.currentRequest;
  assert(JSON.stringify(s02RevisionDecisionLock.reviewAccess) === JSON.stringify({ request: { path: s02InitialReadyAccess.currentRequestPath, blob: git(['rev-parse', `HEAD:${s02InitialReadyAccess.currentRequestPath}`]) }, readback: { path: s02InitialReadyAccess.currentReadbackPath, blob: git(['rev-parse', `HEAD:${s02InitialReadyAccess.currentReadbackPath}`]) } }), 'round 007 does not bind the exact latest live review-access proof');
  const canonicalObservedAt = Number.isFinite(observedAt) ? new Date(observedAt).toISOString().replace('.000Z', 'Z') : '';
  assert(canonicalObservedAt === s02RevisionDecisionLock.sourceDecision.observedAt && observedAt >= Date.parse(firstReadback.verifiedHttp.verifiedAt) && observedAt >= readyCommittedAt && observedAt <= Date.parse(firstRequest.review.temporaryAccess.expiresAt) && observedAt <= openingCommittedAt && openingCommittedAt - observedAt <= 24 * 60 * 60 * 1000, 'round 007 revision time is outside the exact live-access READY and 24-hour opening interval');
  assert(s02RevisionDecisionLock.createdAt === s02RevisionDecisionLock.sourceDecision.observedAt.slice(0, 10) && s02RevisionControl.createdAt === s02RevisionDecisionLock.createdAt, 'round 036 control and round 007 revision dates differ');
  assertExactChangedPaths(readyCommit, openingCommit, expectedS02RevisionOpeningWrites, 'round 036 atomic user-revision opening');
  assertAddedOnceAndUnchanged(s02RevisionControlPath, openingCommit);
  assertAddedOnceAndUnchanged(s02RevisionDecisionLockPath, openingCommit);
  assert(s02RevisionControl.userDecisionLock.path === s02RevisionDecisionLockPath && s02RevisionControl.userDecisionLock.blob === git(['rev-parse', `HEAD:${s02RevisionDecisionLockPath}`]), 'round 036 does not bind the immutable round 007 revision lock');
  const expectedAllowedWrites = [...expectedS02RevisionOpeningWrites, s02RevisedP2ControlPath, s02RevisedApprovalLockPath, s02SecondRevisionControlPath, s02SecondRevisionLockPath, ...exactTargetPaths, ...Object.values(s02RevisionReviewEvidencePaths), ...s02WorkflowPackageWritePaths('002', true), ...Object.values(s02WorkflowAdmissionPaths('002')), ...s02AccessRenewalWritePatterns('002')];
  const expectedForbiddenWrites = [...new Set([...expectedS02RepairForbiddenWrites, s02P2ControlPath, s02UserDecisionLockPath, ...Object.values(s02ReviewEvidencePaths), ...s02VerificationPaths])];
  assert(JSON.stringify(s02RevisionControl.allowedWrites) === JSON.stringify(expectedAllowedWrites) && JSON.stringify(s02RevisionControl.forbiddenWrites) === JSON.stringify(expectedForbiddenWrites), 'round 036 write boundary is not the exact revision, evidence and mirror set');
  assert(s02RevisionControl.entryWorkflow.commit === readyCommit && s02RevisionControl.entryWorkflow.tree === readyTree, 'round 036 entry workflow does not target the exact READY parent');
  registerWorkflowEvidence(s02RevisionControl.entryWorkflow, 'round 036 entry');
  assertExactPhaseDocumentTransforms(openingCommit, expectedRound036RevisionDocumentText, 'round 036 revision opening documents');
  for (const file of Object.values(s02ReviewEvidencePaths)) assertAddedOnceAndUnchanged(file, firstAddCommit(file));
  assertNoPathChangesSince(s02ReviewPrefix.targetCommit, git(['rev-parse', 'HEAD']), [
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-acceptance-matrix-round-001.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-feasibility-audit.json'
  ], 'round 001 Acceptance and feasibility evidence immutability');

  const activeAcceptanceCriteria = deriveActiveAcceptanceCriteria([], s02RevisionDecisionLock.requestedChanges, 'round 007');
  const revisionPrefix = verifyS02ReviewEvidencePrefix({
    paths: s02RevisionReviewEvidencePaths,
    evidenceRound: '002',
    changeControlPath: s02RevisionControlPath,
    openingCommit,
    exactContentParent: openingCommit,
    contentManifestOptions: { deltaBaseCommit: openingCommit, requireFullRepairDelta: false, exactRevisionPaths: exactTargetPaths },
    revisionChanges: s02RevisionDecisionLock.requestedChanges,
    activeAcceptanceCriteria,
    revisionBaseline: { commit: s02ReviewPrefix.targetCommit, tree: s02ReviewPrefix.targetTree },
    previousRevisionEvidencePaths: null,
    requireLiveWorkflow: true,
    labelPrefix: 'S02 revision round 002'
  });
  const head = git(['rev-parse', 'HEAD']);
  const firstSuccessorOpening = s02RevisedP2OpeningCommit ?? s02SecondRevisionOpeningCommit;
  const revisionLineageHead = firstSuccessorOpening ? git(['rev-parse', `${firstSuccessorOpening}^`]) : head;
  if (!revisionPrefix) {
    if (revisionLineageHead !== openingCommit) {
      assert(git(['rev-parse', `${revisionLineageHead}^`]) === openingCommit, 'round 036 permits exactly one content commit before round 002 critic evidence');
      deriveS02ContentManifest(revisionLineageHead, { deltaBaseCommit: openingCommit, requireFullRepairDelta: false, exactRevisionPaths: exactTargetPaths });
    }
    assertExactPhaseDocumentTransforms('HEAD', expectedRound036RevisionDocumentText, 'round 036 in-progress revision documents');
    return { openingCommit, readyCommit, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix: null };
  }
  assertNoPathChangesSince(openingCommit, revisionPrefix.readbackCommit ?? head, expectedS02ReadyActivationWrites, 'round 036 mirrors changed before revised READY activation');
  if (!revisionPrefix.readbackCommit) {
    const evidenceTail = revisionPrefix.requestCommit ?? revisionPrefix.completionCommit ?? revisionPrefix.judgeCommit ?? revisionPrefix.criticCommit ?? revisionPrefix.feasibilityAuditCommit ?? revisionPrefix.admissionReadbackCommit ?? revisionPrefix.admissionCommit ?? revisionPrefix.packageCommit ?? revisionPrefix.acceptanceCommit;
    assert(head === evidenceTail, 'round 002 evidence must remain the exact current tail until the next dedicated evidence step');
    assertExactPhaseDocumentTransforms('HEAD', expectedRound036RevisionDocumentText, 'round 036 in-progress evidence documents');
    return { openingCommit, readyCommit, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix };
  }
  if (revisionLineageHead === revisionPrefix.readbackCommit) {
    assert(authority.status === 'IN_PROGRESS_S02_P1_USER_REVISION', 'round 002 deployment readback commit must remain in the in-progress revision state until the dedicated READY activation');
    assertExactPhaseDocumentTransforms('HEAD', expectedRound036RevisionDocumentText, 'round 036 deployment-readback tail documents');
    return { openingCommit, readyCommit, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix };
  }
  const revisedReadyCommit = firstCommitAfterOnSingleParentLineage(revisionPrefix.readbackCommit, revisionLineageHead, 'round 036 revised READY lineage');
  assert(git(['rev-parse', `${revisedReadyCommit}^`]) === revisionPrefix.readbackCommit, 'revised S02 READY activation must immediately follow the round 002 deployment readback');
  assertExactChangedPaths(revisionPrefix.readbackCommit, revisedReadyCommit, expectedS02ReadyActivationWrites, 'round 036 revised READY activation');
  assertExactPhaseDocumentTransforms(revisedReadyCommit, expectedRound036ReadyDocumentText, 'round 036 revised READY documents');
  for (const entry of revisionPrefix.contentManifest) assert(git(['rev-parse', `HEAD:${entry.path}`]) === entry.blob, `revised READY content differs from the round 002 critic-bound manifest: ${entry.path}`);
  for (const file of Object.values(s02RevisionReviewEvidencePaths)) assertAddedOnceAndUnchanged(file, firstAddCommit(file));
  const readyAccess = verifyS02ReadyAccessRenewals({ reviewPrefix: revisionPrefix, evidencePaths: s02RevisionReviewEvidencePaths, evidenceRound: '002', successorOpeningCommit: firstSuccessorOpening, label: 'S02 revised review round 002' });
  return { openingCommit, readyCommit, revisedReadyCommit, decisionReadyCommit: readyAccess.decisionReadyCommit, readyAccess, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix };
}

const s02RevisionHandoff = verifyS02RevisionHandoff();
function validateAdditionalRevisionRequests(lock, config) {
  assert(Array.isArray(lock.requestedChanges) && lock.requestedChanges.length >= 1 && lock.requestedChanges.length <= 20, `round ${config.lockRound} must bind one to twenty concrete revision groups`);
  const gmSet = new Set(['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08']);
  const allEvidencePaths = new Set([
    ...Object.values(s02ReviewEvidencePaths),
    ...Object.values(s02RevisionReviewEvidencePaths),
    ...Object.values(s02SecondRevisionReviewEvidencePaths),
    ...Object.values(s02ThirdRevisionReviewEvidencePaths),
    ...s02VerificationPaths
  ]);
  const revisableContracts = new Set([
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-animation-contract.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-art-direction.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-asset-decomposition.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-competitive-research.md',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-data-binding-matrix.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-information-priority.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-player-experience.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json',
    'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-ui-design-system.json'
  ]);
  const targetPaths = [];
  const assertionIds = new Set();
  for (const [index, change] of lock.requestedChanges.entries()) {
    assertExactKeySet(change, ['id', 'request', 'affectedGoldenMasters', 'targetPaths', 'requiredAssets', 'supersedesAssertions', 'acceptanceAssertions'], `round ${config.lockRound} requested change ${index + 1}`);
    assert(change.id === `USER-S02-REV-R${config.evidenceRound}-${String(index + 1).padStart(3, '0')}`, `round ${config.lockRound} requested change ID is not stage-specific and canonical`);
    const chars = typeof change.request === 'string' ? [...change.request].filter(character => !/\s/u.test(character)) : [];
    assert(typeof change.request === 'string' && change.request === change.request.trim() && chars.length >= 3 && change.request.length <= 500 && /[\p{L}\p{N}]/u.test(change.request) && !/[\u0000-\u001f\u007f]/.test(change.request), `round ${config.lockRound} request ${change.id} is not a concrete bounded statement`);
    assert(Array.isArray(change.affectedGoldenMasters) && change.affectedGoldenMasters.length >= 1 && change.affectedGoldenMasters.length <= 8 && JSON.stringify(change.affectedGoldenMasters) === JSON.stringify([...new Set(change.affectedGoldenMasters)].sort()) && change.affectedGoldenMasters.every(id => gmSet.has(id)), `round ${config.lockRound} request ${change.id} Golden Master set is invalid or noncanonical`);
    assert(Array.isArray(change.targetPaths) && change.targetPaths.length >= 1 && change.targetPaths.length <= 40 && change.targetPaths.every(isWithinS02RevisionHarnessStringLimit) && JSON.stringify(change.targetPaths) === JSON.stringify([...change.targetPaths].sort()) && new Set(change.targetPaths).size === change.targetPaths.length, `round ${config.lockRound} request ${change.id} target paths are invalid`);
    for (const file of change.targetPaths) {
      const route = /^step4\/s02\/golden-master-p1\/[A-Za-z0-9_./-]+\.(?:html|css|js|json|webp|png|svg)$/.test(file);
      assert((route || revisableContracts.has(file)) && file.split('/').every(segment => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.')) && !file.includes('\\') && !file.includes('(') && !file.includes(')') && !allEvidencePaths.has(file), `round ${config.lockRound} request ${change.id} contains an unsafe or governed path: ${file}`);
      targetPaths.push(file);
    }
    assert(change.targetPaths.some(file => file.startsWith('step4/s02/golden-master-p1/') && !file.endsWith('/review-manifest.json') && !file.endsWith('/asset-manifest.json')), `round ${config.lockRound} request ${change.id} lacks a rendered route or asset target`);
    const expectedAssets = change.targetPaths.filter(file => /^step4\/s02\/golden-master-p1\/assets\/.+\.(?:webp|png|svg)$/.test(file)).map(file => file.slice('step4/s02/golden-master-p1/'.length)).sort();
    assert(Array.isArray(change.requiredAssets) && JSON.stringify(change.requiredAssets) === JSON.stringify(expectedAssets), `round ${config.lockRound} request ${change.id} requiredAssets differs from every revised route image asset`);
    if (change.requiredAssets.length) assert(change.targetPaths.includes('step4/s02/golden-master-p1/asset-manifest.json'), `round ${config.lockRound} request ${change.id} revises image bytes without the asset manifest`);
    assert(Array.isArray(change.acceptanceAssertions) && change.acceptanceAssertions.length >= 1 && change.acceptanceAssertions.length <= 20, `round ${config.lockRound} request ${change.id} lacks machine-checkable acceptance assertions`);
    for (const [assertionIndex, criterion] of change.acceptanceAssertions.entries()) {
      const common = ['id', 'type', 'goldenMaster'];
      const expectedKeys = criterion?.type === 'DOM_RECT_DELTA' ? [...common, 'selector', 'property', 'operator', 'threshold']
        : criterion?.type === 'DOM_STYLE_DELTA' ? [...common, 'selector', 'property', 'operator', 'threshold']
          : criterion?.type === 'ROI_PIXEL_DELTA' ? [...common, 'region', 'changedPixelRatio', 'meanAbsoluteChannelDelta']
            : criterion?.type === 'TEXT_EXACT' ? [...common, 'selector', 'expected']
              : criterion?.type === 'ELEMENT_VISIBLE' ? [...common, 'selector', 'minimumArea'] : null;
      assert(expectedKeys, `round ${config.lockRound} request ${change.id} has an unsupported assertion type`);
      assertExactKeySet(criterion, expectedKeys, `round ${config.lockRound} request assertion`);
      assert(criterion.id === `${change.id}-A${String(assertionIndex + 1).padStart(2, '0')}` && !assertionIds.has(criterion.id) && change.affectedGoldenMasters.includes(criterion.goldenMaster), `round ${config.lockRound} request assertion ID or Golden Master is invalid`);
      assertionIds.add(criterion.id);
      if (criterion.type !== 'ROI_PIXEL_DELTA') assert(isCanonicalS02RevisionSelector(criterion.selector), `round ${config.lockRound} request assertion selector is unscoped, malformed or unsafe`);
      if (criterion.type === 'DOM_RECT_DELTA') {
        const directional = criterion.operator === 'DELTA_GTE' ? criterion.threshold > 0 : criterion.operator === 'DELTA_LTE' ? criterion.threshold < 0 : criterion.threshold > 0;
        assert(['width', 'height', 'x', 'y'].includes(criterion.property) && ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(criterion.operator) && Number.isFinite(criterion.threshold) && Math.abs(criterion.threshold) <= s02CriterionMaximumMagnitude(criterion) && directional, `round ${config.lockRound} DOM rectangle assertion is invalid, viewport-impossible or vacuous`);
      }
      else if (criterion.type === 'DOM_STYLE_DELTA') {
        const numericStyle = ['font-size', 'opacity'].includes(criterion.property);
        const numericOperator = ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE'].includes(criterion.operator);
        const directional = criterion.operator === 'DELTA_GTE' ? criterion.threshold > 0 : criterion.operator === 'DELTA_LTE' ? criterion.threshold < 0 : criterion.operator === 'ABS_DELTA_GTE' ? criterion.threshold > 0 : true;
        assert(['font-size', 'color', 'background-color', 'opacity'].includes(criterion.property) && ['DELTA_GTE', 'DELTA_LTE', 'ABS_DELTA_GTE', 'CHANGED', 'AFTER_EQUALS'].includes(criterion.operator) && numericStyle === numericOperator && (numericOperator ? Number.isFinite(criterion.threshold) && Math.abs(criterion.threshold) <= s02CriterionMaximumMagnitude(criterion) && directional : (criterion.operator === 'CHANGED' ? criterion.threshold === null : isCanonicalChromiumComputedColor(criterion.threshold))), `round ${config.lockRound} DOM style assertion is invalid, noncanonical or vacuous`);
      } else if (criterion.type === 'ROI_PIXEL_DELTA') {
        assertExactKeySet(criterion.region, ['x', 'y', 'width', 'height'], `round ${config.lockRound} ROI`);
        const { x, y, width, height } = criterion.region;
        assert([x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1, `round ${config.lockRound} ROI is invalid`);
        assert([['changedPixelRatio', criterion.changedPixelRatio, 1], ['meanAbsoluteChannelDelta', criterion.meanAbsoluteChannelDelta, 255]].every(([, bounds, maximum]) => Array.isArray(bounds) && bounds.length === 2 && bounds.every(Number.isFinite) && bounds[0] >= 0 && bounds[0] <= bounds[1] && bounds[1] <= maximum) && (criterion.changedPixelRatio[0] > 0 || criterion.meanAbsoluteChannelDelta[0] > 0), `round ${config.lockRound} ROI thresholds are invalid or vacuous`);
      } else if (criterion.type === 'TEXT_EXACT') assert(isCanonicalS02ExactText(criterion.expected), `round ${config.lockRound} TEXT_EXACT is invalid or noncanonical`);
      else if (criterion.type === 'ELEMENT_VISIBLE') assert(Number.isFinite(criterion.minimumArea) && criterion.minimumArea >= 64 && criterion.minimumArea <= s02CriterionMaximumMagnitude(criterion), `round ${config.lockRound} ELEMENT_VISIBLE area is invalid or larger than its reviewed viewport`);
    }
    assert(JSON.stringify([...new Set(change.acceptanceAssertions.map(criterion => criterion.goldenMaster))].sort()) === JSON.stringify(change.affectedGoldenMasters), `round ${config.lockRound} request ${change.id} does not have acceptance coverage for every and only affected Golden Master`);
  }
  const exactTargetPaths = [...new Set(targetPaths)].sort();
  if (exactTargetPaths.some(file => file.startsWith('step4/s02/golden-master-p1/') && !file.endsWith('/review-manifest.json'))) assert(exactTargetPaths.includes('step4/s02/golden-master-p1/review-manifest.json'), `round ${config.lockRound} route revision omits review-manifest.json`);
  return exactTargetPaths;
}
function verifyAdditionalS02RevisionHandoff(config, predecessor) {
  const control = config.control;
  const lock = config.lock;
  const evidencePresence = Object.values(config.evidencePaths).some(exists);
  assert(Boolean(control) === Boolean(lock), `round ${config.controlRound} control and round ${config.lockRound} revision lock must appear atomically`);
  if (!control) {
    assert(!evidencePresence, `review round ${config.evidenceRound} exists without round ${config.controlRound}`);
    return null;
  }
  assert(predecessor?.revisedReadyCommit && predecessor.revisionPrefix?.readbackCommit, `round ${config.controlRound} requires the complete predecessor READY chain`);
  const predecessorAccess = verifyS02ReadyAccessRenewals({ reviewPrefix: predecessor.revisionPrefix, evidencePaths: config.previousEvidencePaths, evidenceRound: config.previousEvidenceRound, successorOpeningCommit: config.openingCommit, label: `S02 review round ${config.previousEvidenceRound}` });
  assert(predecessorAccess && !predecessorAccess.pendingRequest, `round ${config.controlRound} cannot open from a pending access-renewal request`);
  assert(!(config.approvalControl && config.nextRevisionControl), `round ${config.approvalRound} approval and round ${config.nextRevisionRound} revision are mutually exclusive`);
  assertExactKeySet(control, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'entryWorkflow', 'userDecisionLock', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'revisionRequest', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], `round ${config.controlRound} revision control`);
  assertExactKeySet(control.entry, ['head', 'tree'], `round ${config.controlRound} entry`);
  assertWorkflowEvidenceKeys(control.entryWorkflow, `round ${config.controlRound} entry workflow`, true);
  assertExactKeySet(control.userDecisionLock, ['path', 'blob'], `round ${config.controlRound} lock binding`);
  assertExactKeySet(control.revisionRequest, ['count', 'requestSha256', 'targetPaths'], `round ${config.controlRound} request binding`);
  assertExactKeySet(control.completionBoundary, ['requiredInternalP0', 'requiredInternalP1', 'maximumAfterRevisionReview', 'mayNotDeclare', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified', 'userVisualApproval'], `round ${config.controlRound} completion boundary`);
  assert(control.schemaVersion === 1 && control.artifactId === `cats-tower-active-change-control-addendum-round-${config.controlRound}` && isCanonicalIsoDate(control.createdAt) && control.repository === '2hg7trp7rv-design/cats_tower' && control.branch === 'kimi' && control.parentChangeControl === config.parentControlPath, `round ${config.controlRound} identity, date, repository, branch or parent mismatch`);
  assert(control.status === 'IN_PROGRESS' && control.verdict === 'IN_PROGRESS_S02_P1_USER_REVISION' && control.currentRepositoryStep === 4 && control.internalPhase === 'S02-P1-GOLDEN-MASTER' && control.internalPhaseIsRepositoryStep === false && control.scope === 'S02_P1_EXACT_USER_REQUESTED_REVISION_ONLY', `round ${config.controlRound} phase or scope mismatch`);
  assert(JSON.stringify(control.completionBoundary) === JSON.stringify({ requiredInternalP0: 0, requiredInternalP1: 0, maximumAfterRevisionReview: 'READY_FOR_USER_VISUAL_REVIEW', mayNotDeclare: ['S02 complete', 'Step 4 PASS', 'Step 5 allowed', 'P2 asset production allowed', 'Production Ready', 'physical iPhone verified', 'user visual approval obtained'], step4Pass: false, step5Allowed: false, productionAllowed: false, productionAliasChanged: false, physicalIPhoneVerified: false, userVisualApproval: false }), `round ${config.controlRound} completion boundary overclaims`);
  assertExactKeySet(lock, ['schemaVersion', 'artifactId', 'createdAt', 'chat', 'repository', 'branch', 'parentDecisionLock', 'base', 'sourceDecision', 'reviewAccess', 'decision', 'requestedChanges', 'boundaries'], `round ${config.lockRound} revision lock`);
  assertExactKeySet(lock.base, ['head', 'tree'], `round ${config.lockRound} base`);
  assertExactKeySet(lock.sourceDecision, ['message', 'messageSha256', 'authorizationCode', 'observedAt', 'inferred'], `round ${config.lockRound} source decision`);
  assertExactKeySet(lock.reviewAccess, ['request', 'readback'], `round ${config.lockRound} review access`);
  assertExactKeySet(lock.reviewAccess.request, ['path', 'blob'], `round ${config.lockRound} review access request`);
  assertExactKeySet(lock.reviewAccess.readback, ['path', 'blob'], `round ${config.lockRound} review access readback`);
  assertExactKeySet(lock.boundaries, ['userVisualApproval', 's02Complete', 'step4Pass', 'step5Allowed', 'p2AssetProductionAllowed', 'runtimeImplemented', 'productionReady', 'physicalIPhoneVerified', 'productionAliasChanged'], `round ${config.lockRound} boundaries`);
  assert(lock.schemaVersion === 1 && lock.artifactId === `step-1-hero-merchant-large-idle-integration-user-decision-lock-round-${config.lockRound}` && isCanonicalIsoDate(lock.createdAt) && lock.chat === '04_S02-P1_GoldenMaster設計' && lock.repository === control.repository && lock.branch === 'kimi' && lock.parentDecisionLock === config.parentLockPath && lock.decision === 'REQUESTED_S02_GOLDEN_MASTER_P1_REVISION' && Object.values(lock.boundaries).every(value => value === false), `round ${config.lockRound} identity, date, parent or truth boundary mismatch`);
  const exactTargetPaths = validateAdditionalRevisionRequests(lock, config);
  const sourceMessage = lock.sourceDecision.message;
  assert(typeof sourceMessage === 'string' && sourceMessage === sourceMessage.trim() && sourceMessage.length <= 5000 && lock.sourceDecision.messageSha256 === `sha256:${sha256Text(sourceMessage)}` && lock.requestedChanges.every(change => sourceMessage.includes(change.request)) && lock.sourceDecision.authorizationCode === 'REQUEST_S02_P1_GM_REVISION' && lock.sourceDecision.inferred === false, `round ${config.lockRound} source message does not exactly bind every request`);
  const requestSha256 = `sha256:${sha256Canonical(lock.requestedChanges)}`;
  assert(JSON.stringify(control.revisionRequest) === JSON.stringify({ count: lock.requestedChanges.length, requestSha256, targetPaths: exactTargetPaths }), `round ${config.controlRound} does not exactly bind round ${config.lockRound} requests`);
  const openingCommit = config.openingCommit;
  const readyCommit = git(['rev-parse', `${openingCommit}^`]);
  const readyTree = git(['rev-parse', `${readyCommit}^{tree}`]);
  assertExactSingleParent(openingCommit, readyCommit, `round ${config.controlRound} revision opening`);
  assert(readyCommit === predecessorAccess.decisionReadyCommit, `round ${config.controlRound} parent is not the latest fully verified live-access READY state`);
  assert(JSON.stringify(lock.base) === JSON.stringify({ head: readyCommit, tree: readyTree }) && JSON.stringify(control.entry) === JSON.stringify({ head: readyCommit, tree: readyTree }), `round ${config.controlRound} entry or round ${config.lockRound} base mismatch`);
  const exactRevisionAuthorization = `REQUEST_S02_P1_GM_REVISION:${readyCommit}:${readyTree}:${requestSha256}`;
  assert(sourceMessage.includes(exactRevisionAuthorization), `round ${config.lockRound} source message lacks the exact READY fingerprint and structured requestedChanges digest authorization`);
  const previousRequest = predecessorAccess.currentRequest;
  const previousReadback = predecessorAccess.currentReadback;
  assert(JSON.stringify(lock.reviewAccess) === JSON.stringify({ request: { path: predecessorAccess.currentRequestPath, blob: git(['rev-parse', `HEAD:${predecessorAccess.currentRequestPath}`]) }, readback: { path: predecessorAccess.currentReadbackPath, blob: git(['rev-parse', `HEAD:${predecessorAccess.currentReadbackPath}`]) } }), `round ${config.lockRound} does not bind the latest live review-access proof`);
  const observedAt = Date.parse(lock.sourceDecision.observedAt ?? '');
  const readyCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', readyCommit]));
  const openingCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', openingCommit]));
  const accessExpiry = Date.parse(previousRequest.review.temporaryAccess.expiresAt ?? '');
  const canonicalObservedAt = Number.isFinite(observedAt) ? new Date(observedAt).toISOString().replace('.000Z', 'Z') : '';
  assert(canonicalObservedAt === lock.sourceDecision.observedAt && observedAt >= Date.parse(previousReadback.verifiedHttp.verifiedAt) && observedAt >= readyCommittedAt && observedAt <= accessExpiry && observedAt <= openingCommittedAt && openingCommittedAt - observedAt <= 24 * 60 * 60 * 1000, `round ${config.lockRound} request time is outside the live reviewed READY interval`);
  assert(control.createdAt === lock.createdAt && lock.createdAt === lock.sourceDecision.observedAt.slice(0, 10), `round ${config.controlRound}/${config.lockRound} dates mismatch`);
  const openingWrites = [config.controlPath, config.lockPath, ...expectedS02ReadyActivationWrites];
  assertExactChangedPaths(readyCommit, openingCommit, openingWrites, `round ${config.controlRound} atomic revision opening`);
  assert(firstAddCommit(config.lockPath) === openingCommit && firstAddCommit(config.controlPath) === openingCommit, `round ${config.controlRound}/${config.lockRound} were not first added atomically`);
  assertAddedOnceAndUnchanged(config.controlPath, openingCommit);
  assertAddedOnceAndUnchanged(config.lockPath, openingCommit);
  assert(control.userDecisionLock.path === config.lockPath && control.userDecisionLock.blob === git(['rev-parse', `HEAD:${config.lockPath}`]), `round ${config.controlRound} does not bind immutable round ${config.lockRound}`);
  const successorPaths = [config.approvalControlPath, config.approvalLockPath, ...(config.nextRevisionControlPath ? [config.nextRevisionControlPath, config.nextRevisionLockPath] : [])];
  const expectedAllowedWrites = [...openingWrites, ...successorPaths, ...exactTargetPaths, ...Object.values(config.evidencePaths), ...s02WorkflowPackageWritePaths(config.evidenceRound, true), ...Object.values(s02WorkflowAdmissionPaths(config.evidenceRound)), ...s02AccessRenewalWritePatterns(config.evidenceRound)];
  const allBranchPaths = [s02P2ControlPath, s02UserDecisionLockPath, s02RevisionControlPath, s02RevisionDecisionLockPath, s02RevisedP2ControlPath, s02RevisedApprovalLockPath, s02SecondRevisionControlPath, s02SecondRevisionLockPath, s02SecondRevisedP2ControlPath, s02SecondRevisedApprovalLockPath, s02ThirdRevisionControlPath, s02ThirdRevisionLockPath, s02ThirdRevisedP2ControlPath, s02ThirdRevisedApprovalLockPath];
  const expectedForbiddenWrites = [...new Set([...expectedS02RepairForbiddenWrites, ...allBranchPaths.filter(file => !expectedAllowedWrites.includes(file)), ...[s02ReviewEvidencePaths, s02RevisionReviewEvidencePaths, s02SecondRevisionReviewEvidencePaths, s02ThirdRevisionReviewEvidencePaths].flatMap(Object.values).filter(file => !expectedAllowedWrites.includes(file)), ...s02VerificationPaths])];
  assert(JSON.stringify(control.allowedWrites) === JSON.stringify(expectedAllowedWrites) && JSON.stringify(control.forbiddenWrites) === JSON.stringify(expectedForbiddenWrites), `round ${config.controlRound} write boundary differs from exact revision/evidence/successors`);
  assert(control.entryWorkflow.commit === readyCommit && control.entryWorkflow.tree === readyTree, `round ${config.controlRound} workflow target mismatch`);
  registerWorkflowEvidence(control.entryWorkflow, `round ${config.controlRound} entry`);
  assertExactPhaseDocumentTransforms(openingCommit, file => expectedAdditionalRevisionDocumentText(file, config.documentConfig), `round ${config.controlRound} opening documents`);
  for (const priorPaths of config.priorEvidencePathSets) for (const file of Object.values(priorPaths)) assertAddedOnceAndUnchanged(file, firstAddCommit(file));
  const activeAcceptanceCriteria = deriveActiveAcceptanceCriteria(predecessor.activeAcceptanceCriteria, lock.requestedChanges, `round ${config.lockRound}`);
  const revisionPrefix = verifyS02ReviewEvidencePrefix({
    paths: config.evidencePaths,
    evidenceRound: config.evidenceRound,
    changeControlPath: config.controlPath,
    openingCommit,
    exactContentParent: openingCommit,
    contentManifestOptions: { deltaBaseCommit: openingCommit, requireFullRepairDelta: false, exactRevisionPaths: exactTargetPaths },
    revisionChanges: lock.requestedChanges,
    activeAcceptanceCriteria,
    revisionBaseline: { commit: predecessor.revisionPrefix.targetCommit, tree: predecessor.revisionPrefix.targetTree },
    previousRevisionEvidencePaths: config.previousEvidencePaths,
    requireLiveWorkflow: true,
    labelPrefix: `S02 revision round ${config.evidenceRound}`
  });
  const head = git(['rev-parse', 'HEAD']);
  const successorOpening = config.approvalOpeningCommit ?? config.nextRevisionOpeningCommit;
  const lineageHead = successorOpening ? git(['rev-parse', `${successorOpening}^`]) : head;
  if (!revisionPrefix) {
    if (lineageHead !== openingCommit) {
      assert(git(['rev-parse', `${lineageHead}^`]) === openingCommit, `round ${config.controlRound} permits exactly one content commit before feasibility evidence`);
      deriveS02ContentManifest(lineageHead, { deltaBaseCommit: openingCommit, requireFullRepairDelta: false, exactRevisionPaths: exactTargetPaths });
    }
    assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalRevisionDocumentText(file, config.documentConfig), `round ${config.controlRound} in-progress documents`);
    return { openingCommit, readyCommit, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix: null };
  }
  assertNoPathChangesSince(openingCommit, revisionPrefix.readbackCommit ?? head, expectedS02ReadyActivationWrites, `round ${config.controlRound} mirrors changed before READY`);
  if (!revisionPrefix.readbackCommit) {
    const evidenceTail = revisionPrefix.requestCommit ?? revisionPrefix.completionCommit ?? revisionPrefix.judgeCommit ?? revisionPrefix.criticCommit ?? revisionPrefix.feasibilityAuditCommit ?? revisionPrefix.admissionReadbackCommit ?? revisionPrefix.admissionCommit ?? revisionPrefix.packageCommit ?? revisionPrefix.acceptanceCommit;
    assert(head === evidenceTail, `review round ${config.evidenceRound} evidence is not the exact tail`);
    assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalRevisionDocumentText(file, config.documentConfig), `round ${config.controlRound} evidence documents`);
    return { openingCommit, readyCommit, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix };
  }
  if (lineageHead === revisionPrefix.readbackCommit) {
    assert(authority.status === 'IN_PROGRESS_S02_P1_USER_REVISION', `round ${config.controlRound} readback tail must remain in progress`);
    assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalRevisionDocumentText(file, config.documentConfig), `round ${config.controlRound} readback-tail documents`);
    return { openingCommit, readyCommit, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix };
  }
  const revisedReadyCommit = firstCommitAfterOnSingleParentLineage(revisionPrefix.readbackCommit, lineageHead, `round ${config.controlRound} revised READY lineage`);
  assert(git(['rev-parse', `${revisedReadyCommit}^`]) === revisionPrefix.readbackCommit, `round ${config.controlRound} READY must immediately follow review readback`);
  assertExactChangedPaths(revisionPrefix.readbackCommit, revisedReadyCommit, expectedS02ReadyActivationWrites, `round ${config.controlRound} READY activation`);
  assertExactPhaseDocumentTransforms(revisedReadyCommit, file => expectedAdditionalRevisionDocumentText(file, config.documentConfig, true), `round ${config.controlRound} READY documents`);
  for (const entry of revisionPrefix.contentManifest) assert(git(['rev-parse', `HEAD:${entry.path}`]) === entry.blob, `round ${config.controlRound} READY content differs from critic manifest: ${entry.path}`);
  const readyAccess = verifyS02ReadyAccessRenewals({ reviewPrefix: revisionPrefix, evidencePaths: config.evidencePaths, evidenceRound: config.evidenceRound, successorOpeningCommit: successorOpening, label: `S02 revised review round ${config.evidenceRound}` });
  return { openingCommit, readyCommit, revisedReadyCommit, decisionReadyCommit: readyAccess.decisionReadyCommit, readyAccess, targetPaths: exactTargetPaths, activeAcceptanceCriteria, revisionPrefix };
}
const s02SecondRevisionConfig = {
  controlRound: '038', lockRound: '009', evidenceRound: '003', approvalRound: '039', nextRevisionRound: '040',
  controlPath: s02SecondRevisionControlPath, lockPath: s02SecondRevisionLockPath, control: s02SecondRevisionControl, lock: s02SecondRevisionLock, openingCommit: s02SecondRevisionOpeningCommit,
  parentControlPath: s02RevisionControlPath, parentLockPath: s02RevisionDecisionLockPath,
  evidencePaths: s02SecondRevisionReviewEvidencePaths, previousEvidencePaths: s02RevisionReviewEvidencePaths,
  previousEvidenceRound: '002',
  priorEvidencePathSets: [s02ReviewEvidencePaths, s02RevisionReviewEvidencePaths],
  approvalControlPath: s02SecondRevisedP2ControlPath, approvalLockPath: s02SecondRevisedApprovalLockPath, approvalControl: s02SecondRevisedP2Control, approvalOpeningCommit: s02SecondRevisedP2OpeningCommit,
  nextRevisionControlPath: s02ThirdRevisionControlPath, nextRevisionLockPath: s02ThirdRevisionLockPath, nextRevisionControl: s02ThirdRevisionControl, nextRevisionOpeningCommit: s02ThirdRevisionOpeningCommit,
  documentConfig: s02SecondRevisionDocumentConfig
};
const s02SecondRevisionHandoff = verifyAdditionalS02RevisionHandoff(s02SecondRevisionConfig, s02RevisionHandoff);
const s02ThirdRevisionConfig = {
  controlRound: '040', lockRound: '011', evidenceRound: '004', approvalRound: '041', nextRevisionRound: null,
  controlPath: s02ThirdRevisionControlPath, lockPath: s02ThirdRevisionLockPath, control: s02ThirdRevisionControl, lock: s02ThirdRevisionLock, openingCommit: s02ThirdRevisionOpeningCommit,
  parentControlPath: s02SecondRevisionControlPath, parentLockPath: s02SecondRevisionLockPath,
  evidencePaths: s02ThirdRevisionReviewEvidencePaths, previousEvidencePaths: s02SecondRevisionReviewEvidencePaths,
  previousEvidenceRound: '003',
  priorEvidencePathSets: [s02ReviewEvidencePaths, s02RevisionReviewEvidencePaths, s02SecondRevisionReviewEvidencePaths],
  approvalControlPath: s02ThirdRevisedP2ControlPath, approvalLockPath: s02ThirdRevisedApprovalLockPath, approvalControl: s02ThirdRevisedP2Control, approvalOpeningCommit: s02ThirdRevisedP2OpeningCommit,
  nextRevisionControlPath: null, nextRevisionLockPath: null, nextRevisionControl: null, nextRevisionOpeningCommit: null,
  documentConfig: s02ThirdRevisionDocumentConfig
};
const s02ThirdRevisionHandoff = verifyAdditionalS02RevisionHandoff(s02ThirdRevisionConfig, s02SecondRevisionHandoff);
function verifyS02P2ApprovalHandoff() {
  assert(Boolean(s02P2Control) === Boolean(s02UserDecisionLock), 'round 035 control and explicit user-decision lock must appear atomically');
  if (!s02P2Control) return null;
  assert(s02RepairControl && s02ReviewPrefix?.readbackCommit, 'round 035 requires the complete round 034 S02 review chain');
  assertExactKeySet(s02P2Control, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'entryWorkflow', 'userDecisionLock', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'readiness', 'nextAuthorizedAction', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], 'round 035 control');
  assertExactKeySet(s02P2Control.entry, ['head', 'tree'], 'round 035 entry');
  assertExactKeySet(s02P2Control.userDecisionLock, ['path', 'blob'], 'round 035 decision-lock binding');
  assertExactKeySet(s02P2Control.readiness, ['internalP0', 'internalP1', 'userApprovedGoldenMasters', 'evidenceAcceptedDeliverables', 's4RecoveryFinding', 'readyCommit', 'readyTree', 'contentCommit', 'contentTree', 'critic', 'deploymentReadback'], 'round 035 readiness');
  assertExactKeySet(s02P2Control.readiness.critic, ['path', 'blob'], 'round 035 critic binding');
  assertExactKeySet(s02P2Control.readiness.deploymentReadback, ['path', 'blob'], 'round 035 deployment binding');
  assertExactKeySet(s02P2Control.completionBoundary, ['step4Pass', 'step5Allowed', 'productionAllowed', 'productionAssetsApproved', 'twelveScreensApproved', 'productionAliasChanged', 'physicalIPhoneVerified', 'maximumVerdict', 'mayNotDeclare'], 'round 035 completion boundary');
  assert(s02P2Control.schemaVersion === 1 && s02P2Control.artifactId === 'cats-tower-active-change-control-addendum-round-035' && isCanonicalIsoDate(s02P2Control.createdAt), 'round 035 identity or date mismatch');
  assert(s02P2Control.repository === '2hg7trp7rv-design/cats_tower' && s02P2Control.branch === 'kimi' && s02P2Control.parentChangeControl === s02RepairControlPath, 'round 035 repository, branch or parent mismatch');
  assert(s02P2Control.status === 'IN_PROGRESS' && s02P2Control.verdict === 'READY_FOR_S02_P2_ASSET_PRODUCTION' && s02P2Control.currentRepositoryStep === 4 && s02P2Control.internalPhase === 'S02-P2-ASSET-PRODUCTION' && s02P2Control.internalPhaseIsRepositoryStep === false, 'round 035 phase or verdict mismatch');
  assert(s02P2Control.scope === 'S02_P2_REPRESENTATIVE_PRODUCTION_ASSET_PROOF_ONLY', 'round 035 scope exceeds the representative asset proof');
  assert(s02P2Control.nextAuthorizedAction === 'Create and independently verify one representative production-asset set before any volume generation or runtime replacement.', 'round 035 next action mismatch');
  assert(JSON.stringify(s02P2Control.allowedWrites) === JSON.stringify(expectedS02P2AllowedWrites) && JSON.stringify(s02P2Control.forbiddenWrites) === JSON.stringify(expectedS02P2ForbiddenWrites), 'round 035 write boundary mismatch');
  assert(JSON.stringify(s02P2Control.completionBoundary) === JSON.stringify({
    step4Pass: false,
    step5Allowed: false,
    productionAllowed: false,
    productionAssetsApproved: false,
    twelveScreensApproved: 0,
    productionAliasChanged: false,
    physicalIPhoneVerified: false,
    maximumVerdict: 'READY_FOR_S02_P2_ASSET_PRODUCTION',
    mayNotDeclare: ['S02 complete', 'Step 4 PASS', 'Step 5 allowed', 'runtime implemented', 'production assets approved', 'Production Ready', 'physical iPhone verified', 'Production alias changed']
  }), 'round 035 completion boundary overclaims release, runtime, assets or device status');

  const openingCommit = s02P2OpeningCommit;
  const openingLineage = git(['rev-list', '--parents', '-n', '1', openingCommit]).split(' ');
  assert(openingLineage.length === 2, 'round 035 opening must have exactly one parent and may not be a merge');
  const readyCommit = git(['rev-parse', `${openingCommit}^`]);
  const readyTree = git(['rev-parse', `${readyCommit}^{tree}`]);
  const readyAuthority = jsonAt(readyCommit, 'CURRENT_AUTHORITY_INDEX.json');
  assert(s02InitialReadyAccess && !s02InitialReadyAccess.pendingRequest && readyCommit === s02InitialReadyAccess.decisionReadyCommit, 'round 035 parent is not the latest fully verified live-access READY state');
  assert(readyAuthority.activeChangeControl === s02RepairControlPath && readyAuthority.status === 'READY_FOR_USER_VISUAL_REVIEW', 'round 035 parent is not the exact round 034 READY activation');
  assert(s02P2Control.entry.head === readyCommit && s02P2Control.entry.tree === readyTree, 'round 035 entry does not bind its exact READY parent');
  assertExactChangedPaths(readyCommit, openingCommit, expectedS02P2OpeningWrites, 'round 035 explicit-approval opening');
  assert(firstAddCommit(s02P2ControlPath) === openingCommit && firstAddCommit(s02UserDecisionLockPath) === openingCommit, 'round 035 control and user-decision lock were not first added atomically');
  assertAddedOnceAndUnchanged(s02P2ControlPath, openingCommit);
  assertAddedOnceAndUnchanged(s02UserDecisionLockPath, openingCommit);

  assertExactKeySet(s02UserDecisionLock, ['schemaVersion', 'artifactId', 'createdAt', 'chat', 'repository', 'branch', 'parentDecisionLock', 'base', 'sourceDecision', 'decision', 'approvalScope', 'approvedTarget', 'accepted', 'boundaries'], 'round 006 user-decision lock');
  assertExactKeySet(s02UserDecisionLock.base, ['head', 'tree'], 'round 006 user-decision base');
  assertExactKeySet(s02UserDecisionLock.sourceDecision, ['message', 'authorizationCode', 'observedAt', 'inferred'], 'round 006 source decision');
  assertExactKeySet(s02UserDecisionLock.approvedTarget, ['reviewRoute', 'readyCommit', 'readyTree', 'contentCommit', 'contentTree', 'contentManifestSha256', 'goldenMasters', 'evidence', 'deployment', 'temporaryAccess', 'accessProof'], 'round 006 approved target');
  assertExactKeySet(s02UserDecisionLock.approvedTarget.evidence, ['critic', 'finalJudge', 'completion', 'deploymentRequest', 'deploymentReadback'], 'round 006 evidence binding');
  for (const [key, value] of Object.entries(s02UserDecisionLock.approvedTarget.evidence)) assertExactKeySet(value, ['path', 'blob'], `round 006 ${key} evidence binding`);
  assertExactKeySet(s02UserDecisionLock.approvedTarget.deployment, ['id', 'immutableUrl', 'environment', 'githubCommit', 'projectId', 'teamId', 'productionAliasChanged'], 'round 006 deployment binding');
  assertExactKeySet(s02UserDecisionLock.approvedTarget.accessProof, ['request', 'readback'], 'round 006 access proof');
  assertExactKeySet(s02UserDecisionLock.approvedTarget.accessProof.request, ['path', 'blob'], 'round 006 access request proof');
  assertExactKeySet(s02UserDecisionLock.approvedTarget.accessProof.readback, ['path', 'blob'], 'round 006 access readback proof');
  assertExactKeySet(s02UserDecisionLock.accepted, ['userApprovedGoldenMasters', 'evidenceAcceptedDeliverables'], 'round 006 accepted counts');
  assertExactKeySet(s02UserDecisionLock.boundaries, ['s02Complete', 'step4Pass', 'step5Allowed', 'runtimeImplemented', 'productionAssetsApproved', 'productionReady', 'physicalIPhoneVerified', 'productionAliasChanged'], 'round 006 truth boundaries');
  assert(s02UserDecisionLock.schemaVersion === 1 && s02UserDecisionLock.artifactId === 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-006' && isCanonicalIsoDate(s02UserDecisionLock.createdAt), 'round 006 identity or date mismatch');
  assert(s02UserDecisionLock.chat === '04_S02-P1_GoldenMaster設計' && s02UserDecisionLock.repository === s02P2Control.repository && s02UserDecisionLock.branch === 'kimi' && s02UserDecisionLock.parentDecisionLock === 'quality-reviews/step-1-hero-merchant-large-idle-integration/user-decision-lock-round-005.json', 'round 006 chat, repository, branch or parent mismatch');
  assert(s02UserDecisionLock.base.head === readyCommit && s02UserDecisionLock.base.tree === readyTree, 'round 006 does not bind the exact READY target seen by the user');
  const expectedContentManifestDigest = `sha256:${sha256Canonical(s02ReviewPrefix.contentManifest)}`;
  const expectedApprovalMessage = `APPROVE_S02_P1_GM_FOR_P2 READY_COMMIT=${readyCommit} READY_TREE=${readyTree} CONTENT_MANIFEST_SHA256=${expectedContentManifestDigest}`;
  assert(s02UserDecisionLock.sourceDecision.message === expectedApprovalMessage, 'round 006 does not contain the exact target-bound one-time approval command');
  assert(s02UserDecisionLock.sourceDecision.authorizationCode === 'APPROVE_S02_P1_GM_FOR_P2', 'round 006 explicit approval authorization code mismatch');
  assert(isCanonicalIsoInstant(s02UserDecisionLock.sourceDecision.observedAt) && s02UserDecisionLock.sourceDecision.inferred === false, 'round 006 approval was inferred or lacks an exact observation time');
  assert(s02UserDecisionLock.decision === 'APPROVED_S02_GOLDEN_MASTER_P1_FOR_P2_ASSET_PRODUCTION' && s02UserDecisionLock.approvalScope === 'S02_P1_GOLDEN_MASTER_VISUAL_DIRECTION_ONLY', 'round 006 decision or scope mismatch');
  assert(s02UserDecisionLock.approvedTarget.reviewRoute === '/step4/s02/golden-master-p1/' && s02UserDecisionLock.approvedTarget.readyCommit === readyCommit && s02UserDecisionLock.approvedTarget.readyTree === readyTree, 'round 006 READY target mismatch');
  assert(s02UserDecisionLock.approvedTarget.contentCommit === s02ReviewPrefix.targetCommit && s02UserDecisionLock.approvedTarget.contentTree === s02ReviewPrefix.targetTree, 'round 006 content target mismatch');
  assert(s02UserDecisionLock.approvedTarget.contentManifestSha256 === expectedContentManifestDigest, 'round 006 content-manifest digest mismatch');
  const critic = json(s02ReviewEvidencePaths.critic);
  assert(JSON.stringify(s02UserDecisionLock.approvedTarget.goldenMasters) === JSON.stringify(critic.screenshots), 'round 006 does not bind the exact eight-master and responsive screenshot set');
  const expectedDecisionEvidence = Object.fromEntries(Object.entries(s02ReviewEvidencePaths).map(([key, file]) => [key, { path: file, blob: git(['rev-parse', `HEAD:${file}`]) }]));
  assert(JSON.stringify(s02UserDecisionLock.approvedTarget.evidence) === JSON.stringify(expectedDecisionEvidence), 'round 006 evidence path/blob set mismatch');
  const deploymentReadback = s02InitialReadyAccess.currentReadback;
  const deploymentRequest = s02InitialReadyAccess.currentRequest;
  assert(JSON.stringify(s02UserDecisionLock.approvedTarget.accessProof) === JSON.stringify({ request: { path: s02InitialReadyAccess.currentRequestPath, blob: git(['rev-parse', `HEAD:${s02InitialReadyAccess.currentRequestPath}`]) }, readback: { path: s02InitialReadyAccess.currentReadbackPath, blob: git(['rev-parse', `HEAD:${s02InitialReadyAccess.currentReadbackPath}`]) } }), 'round 006 approval does not bind the exact latest access-renewal proof');
  const approvalObservedAt = Date.parse(s02UserDecisionLock.sourceDecision.observedAt);
  const readyCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', readyCommit]));
  const openingCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', openingCommit]));
  const canonicalObservedAt = Number.isFinite(approvalObservedAt) ? new Date(approvalObservedAt).toISOString().replace('.000Z', 'Z') : '';
  const accessExpiry = Date.parse(deploymentRequest.review.temporaryAccess.expiresAt ?? '');
  assert(canonicalObservedAt === s02UserDecisionLock.sourceDecision.observedAt && approvalObservedAt >= Date.parse(deploymentReadback.verifiedHttp.verifiedAt) && approvalObservedAt >= readyCommittedAt && approvalObservedAt <= accessExpiry && approvalObservedAt <= openingCommittedAt && openingCommittedAt - approvalObservedAt <= 24 * 60 * 60 * 1000 && s02UserDecisionLock.createdAt === s02UserDecisionLock.sourceDecision.observedAt.slice(0, 10) && s02P2Control.createdAt === s02UserDecisionLock.createdAt, 'round 006 approval time is outside the exact deployed-target, live temporary-access, READY and 24-hour opening interval');
  assert(JSON.stringify(s02UserDecisionLock.approvedTarget.temporaryAccess) === JSON.stringify(deploymentRequest.review.temporaryAccess), 'round 006 approval does not bind the exact live temporary Preview access URL and expiry');
  assert(JSON.stringify(s02UserDecisionLock.approvedTarget.deployment) === JSON.stringify({
    id: deploymentReadback.verifiedDeployment.id,
    immutableUrl: deploymentReadback.verifiedDeployment.immutableUrl,
    environment: 'Preview',
    githubCommit: s02ReviewPrefix.targetCommit,
    projectId: 'prj_3Ip3e0eYMy9SchP1vS36ibjJP9LB',
    teamId: 'team_6odZCZQ1QxjzhPdC9sgEtoCM',
    productionAliasChanged: false
  }), 'round 006 deployment target differs from the reviewed Preview');
  assert(JSON.stringify(s02UserDecisionLock.accepted) === JSON.stringify({ userApprovedGoldenMasters: 8, evidenceAcceptedDeliverables: 10 }), 'round 006 accepted counts mismatch');
  assert(Object.values(s02UserDecisionLock.boundaries).every(value => value === false), 'round 006 approval overclaims completion, runtime, release or device state');
  assert(s02P2Control.userDecisionLock.path === s02UserDecisionLockPath && s02P2Control.userDecisionLock.blob === git(['rev-parse', `HEAD:${s02UserDecisionLockPath}`]), 'round 035 does not bind the immutable round 006 decision lock');
  assert(JSON.stringify(s02P2Control.readiness) === JSON.stringify({
    internalP0: 0,
    internalP1: 0,
    userApprovedGoldenMasters: 8,
    evidenceAcceptedDeliverables: 10,
    s4RecoveryFinding: 'OPEN_S4_RECOVERY_VIS_001',
    readyCommit,
    readyTree,
    contentCommit: s02ReviewPrefix.targetCommit,
    contentTree: s02ReviewPrefix.targetTree,
    critic: expectedDecisionEvidence.critic,
    deploymentReadback: expectedDecisionEvidence.deploymentReadback
  }), 'round 035 readiness does not exactly derive from the approved target');
  assert(s02P2Control.entryWorkflow.commit === readyCommit && s02P2Control.entryWorkflow.tree === readyTree, 'round 035 entry workflow does not target the exact READY parent');
  assertWorkflowEvidenceKeys(s02P2Control.entryWorkflow, 'round 035 entry workflow', true);
  registerWorkflowEvidence(s02P2Control.entryWorkflow, 'round 035 entry');
  assertExactPhaseDocumentTransforms(openingCommit, expectedRound035DocumentText, 'round 035 opening documents');
  assertNoPathChangesSince(s02ReviewPrefix.targetCommit, git(['rev-parse', 'HEAD']), s02ReviewPrefix.contentManifest.map(entry => entry.path), 'approved S02 Golden Master freeze after round 035');
  const round035FreezeEnd = s02AssetPassOpeningCommit ? git(['rev-parse', `${s02AssetPassOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
  assertNoPathChangesSince(openingCommit, round035FreezeEnd, expectedS02ReadyActivationWrites, 'round 035 current mirrors must remain frozen before exact PASS_ASSET activation');
  return { openingCommit, readyCommit, readyTree };
}

const s02P2Approval = verifyS02P2ApprovalHandoff();
function verifyS02RevisedP2ApprovalHandoff() {
  assert(Boolean(s02RevisedP2Control) === Boolean(s02RevisedApprovalLock), 'round 037 control and round 008 revised-target approval lock must appear atomically');
  if (!s02RevisedP2Control) return null;
  assert(!s02P2Control && !s02UserDecisionLock, 'round 037 revised approval is mutually exclusive with initial round 035 approval');
  assert(s02RevisionControl && s02RevisionDecisionLock && s02RevisionHandoff?.revisedReadyCommit && s02RevisionHandoff.revisionPrefix?.readbackCommit, 'round 037 requires the complete round 036 revision, round 002 review and dedicated revised READY activation');
  assertExactKeySet(s02RevisedP2Control, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'entryWorkflow', 'userDecisionLock', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'readiness', 'nextAuthorizedAction', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], 'round 037 control');
  assertExactKeySet(s02RevisedP2Control.entry, ['head', 'tree'], 'round 037 entry');
  assertExactKeySet(s02RevisedP2Control.userDecisionLock, ['path', 'blob'], 'round 037 decision-lock binding');
  assertExactKeySet(s02RevisedP2Control.readiness, ['internalP0', 'internalP1', 'userApprovedGoldenMasters', 'evidenceAcceptedDeliverables', 's4RecoveryFinding', 'readyCommit', 'readyTree', 'contentCommit', 'contentTree', 'acceptanceMatrix', 'feasibilityAudit', 'critic', 'deploymentReadback'], 'round 037 readiness');
  assertExactKeySet(s02RevisedP2Control.readiness.acceptanceMatrix, ['path', 'blob'], 'round 037 Acceptance binding');
  assertExactKeySet(s02RevisedP2Control.readiness.feasibilityAudit, ['path', 'blob'], 'round 037 feasibility binding');
  assertExactKeySet(s02RevisedP2Control.readiness.critic, ['path', 'blob'], 'round 037 critic binding');
  assertExactKeySet(s02RevisedP2Control.readiness.deploymentReadback, ['path', 'blob'], 'round 037 deployment binding');
  assertExactKeySet(s02RevisedP2Control.completionBoundary, ['step4Pass', 'step5Allowed', 'productionAllowed', 'productionAssetsApproved', 'twelveScreensApproved', 'productionAliasChanged', 'physicalIPhoneVerified', 'maximumVerdict', 'mayNotDeclare'], 'round 037 completion boundary');
  assert(s02RevisedP2Control.schemaVersion === 1 && s02RevisedP2Control.artifactId === 'cats-tower-active-change-control-addendum-round-037' && isCanonicalIsoDate(s02RevisedP2Control.createdAt), 'round 037 identity or date mismatch');
  assert(s02RevisedP2Control.repository === '2hg7trp7rv-design/cats_tower' && s02RevisedP2Control.branch === 'kimi' && s02RevisedP2Control.parentChangeControl === s02RevisionControlPath, 'round 037 repository, branch or parent mismatch');
  assert(s02RevisedP2Control.status === 'IN_PROGRESS' && s02RevisedP2Control.verdict === 'READY_FOR_S02_P2_ASSET_PRODUCTION' && s02RevisedP2Control.currentRepositoryStep === 4 && s02RevisedP2Control.internalPhase === 'S02-P2-ASSET-PRODUCTION' && s02RevisedP2Control.internalPhaseIsRepositoryStep === false, 'round 037 phase or verdict mismatch');
  assert(s02RevisedP2Control.scope === 'S02_P2_REPRESENTATIVE_PRODUCTION_ASSET_PROOF_FROM_REVISED_GOLDEN_MASTER_ONLY' && s02RevisedP2Control.nextAuthorizedAction === 'Create and independently verify one representative production-asset set from the approved revised Golden Master before any volume generation or runtime replacement.', 'round 037 scope or next action exceeds the representative revised-target asset proof');
  assert(JSON.stringify(s02RevisedP2Control.allowedWrites) === JSON.stringify(expectedS02P2AllowedWrites) && JSON.stringify(s02RevisedP2Control.forbiddenWrites) === JSON.stringify(expectedS02P2ForbiddenWrites), 'round 037 write boundary mismatch');
  assert(JSON.stringify(s02RevisedP2Control.completionBoundary) === JSON.stringify({
    step4Pass: false,
    step5Allowed: false,
    productionAllowed: false,
    productionAssetsApproved: false,
    twelveScreensApproved: 0,
    productionAliasChanged: false,
    physicalIPhoneVerified: false,
    maximumVerdict: 'READY_FOR_S02_P2_ASSET_PRODUCTION',
    mayNotDeclare: ['S02 complete', 'Step 4 PASS', 'Step 5 allowed', 'runtime implemented', 'production assets approved', 'Production Ready', 'physical iPhone verified', 'Production alias changed']
  }), 'round 037 completion boundary overclaims release, runtime, assets or device status');

  const openingCommit = s02RevisedP2OpeningCommit;
  const openingLineage = git(['rev-list', '--parents', '-n', '1', openingCommit]).split(' ');
  assert(openingLineage.length === 2, 'round 037 opening must have exactly one parent and may not be a merge');
  const readyCommit = git(['rev-parse', `${openingCommit}^`]);
  const readyTree = git(['rev-parse', `${readyCommit}^{tree}`]);
  assert(s02RevisionHandoff.readyAccess && !s02RevisionHandoff.readyAccess.pendingRequest && readyCommit === s02RevisionHandoff.readyAccess.decisionReadyCommit, 'round 037 parent is not the latest fully verified round 002 live-access READY state');
  const readyAuthority = jsonAt(readyCommit, 'CURRENT_AUTHORITY_INDEX.json');
  assert(readyAuthority.activeChangeControl === s02RevisionControlPath && readyAuthority.status === 'READY_FOR_USER_VISUAL_REVIEW', 'round 037 parent is not the exact revised READY state shown to the user');
  assert(JSON.stringify(s02RevisedP2Control.entry) === JSON.stringify({ head: readyCommit, tree: readyTree }), 'round 037 entry does not bind the exact revised READY parent');
  assertExactChangedPaths(readyCommit, openingCommit, expectedS02RevisedP2OpeningWrites, 'round 037 atomic revised-target approval opening');
  assert(firstAddCommit(s02RevisedP2ControlPath) === openingCommit && firstAddCommit(s02RevisedApprovalLockPath) === openingCommit, 'round 037 control and round 008 approval lock were not first added atomically');
  assertAddedOnceAndUnchanged(s02RevisedP2ControlPath, openingCommit);
  assertAddedOnceAndUnchanged(s02RevisedApprovalLockPath, openingCommit);

  assertExactKeySet(s02RevisedApprovalLock, ['schemaVersion', 'artifactId', 'createdAt', 'chat', 'repository', 'branch', 'parentDecisionLock', 'base', 'sourceDecision', 'decision', 'approvalScope', 'approvedTarget', 'accepted', 'boundaries'], 'round 008 user-decision lock');
  assertExactKeySet(s02RevisedApprovalLock.base, ['head', 'tree'], 'round 008 approval base');
  assertExactKeySet(s02RevisedApprovalLock.sourceDecision, ['message', 'authorizationCode', 'observedAt', 'inferred'], 'round 008 approval source');
  assertExactKeySet(s02RevisedApprovalLock.approvedTarget, ['reviewRoute', 'readyCommit', 'readyTree', 'contentCommit', 'contentTree', 'contentManifestSha256', 'goldenMasters', 'evidence', 'deployment', 'temporaryAccess', 'accessProof'], 'round 008 approved target');
  assertExactKeySet(s02RevisedApprovalLock.approvedTarget.evidence, ['acceptanceMatrix', 'feasibilityAudit', 'critic', 'finalJudge', 'completion', 'deploymentRequest', 'deploymentReadback'], 'round 008 evidence binding');
  for (const [key, value] of Object.entries(s02RevisedApprovalLock.approvedTarget.evidence)) assertExactKeySet(value, ['path', 'blob'], `round 008 ${key} evidence binding`);
  assertExactKeySet(s02RevisedApprovalLock.approvedTarget.deployment, ['id', 'immutableUrl', 'environment', 'githubCommit', 'projectId', 'teamId', 'productionAliasChanged'], 'round 008 deployment binding');
  assertExactKeySet(s02RevisedApprovalLock.approvedTarget.accessProof, ['request', 'readback'], 'round 008 access proof');
  assertExactKeySet(s02RevisedApprovalLock.approvedTarget.accessProof.request, ['path', 'blob'], 'round 008 access request proof');
  assertExactKeySet(s02RevisedApprovalLock.approvedTarget.accessProof.readback, ['path', 'blob'], 'round 008 access readback proof');
  assertExactKeySet(s02RevisedApprovalLock.accepted, ['userApprovedGoldenMasters', 'evidenceAcceptedDeliverables'], 'round 008 accepted counts');
  assertExactKeySet(s02RevisedApprovalLock.boundaries, ['s02Complete', 'step4Pass', 'step5Allowed', 'runtimeImplemented', 'productionAssetsApproved', 'productionReady', 'physicalIPhoneVerified', 'productionAliasChanged'], 'round 008 truth boundaries');
  assert(s02RevisedApprovalLock.schemaVersion === 1 && s02RevisedApprovalLock.artifactId === 'step-1-hero-merchant-large-idle-integration-user-decision-lock-round-008' && isCanonicalIsoDate(s02RevisedApprovalLock.createdAt), 'round 008 identity or date mismatch');
  assert(s02RevisedApprovalLock.chat === '04_S02-P1_GoldenMaster設計' && s02RevisedApprovalLock.repository === s02RevisedP2Control.repository && s02RevisedApprovalLock.branch === 'kimi' && s02RevisedApprovalLock.parentDecisionLock === s02RevisionDecisionLockPath, 'round 008 chat, repository, branch or parent decision mismatch');
  assert(JSON.stringify(s02RevisedApprovalLock.base) === JSON.stringify({ head: readyCommit, tree: readyTree }), 'round 008 does not bind the exact revised READY target seen by the user');
  const contentManifest = s02RevisionHandoff.revisionPrefix.contentManifest;
  const contentManifestSha256 = `sha256:${sha256Canonical(contentManifest)}`;
  const expectedApprovalMessage = `APPROVE_S02_P1_GM_FOR_P2 READY_COMMIT=${readyCommit} READY_TREE=${readyTree} CONTENT_MANIFEST_SHA256=${contentManifestSha256}`;
  assert(s02RevisedApprovalLock.sourceDecision.message === expectedApprovalMessage && s02RevisedApprovalLock.sourceDecision.authorizationCode === 'APPROVE_S02_P1_GM_FOR_P2' && s02RevisedApprovalLock.sourceDecision.inferred === false, 'round 008 lacks the exact revised-target one-time approval command');
  assert(s02RevisedApprovalLock.decision === 'APPROVED_REVISED_S02_GOLDEN_MASTER_P1_FOR_P2_ASSET_PRODUCTION' && s02RevisedApprovalLock.approvalScope === 'REVISED_S02_P1_GOLDEN_MASTER_VISUAL_DIRECTION_ONLY', 'round 008 decision or scope mismatch');
  const targetCommit = s02RevisionHandoff.revisionPrefix.targetCommit;
  const targetTree = s02RevisionHandoff.revisionPrefix.targetTree;
  assert(s02RevisedApprovalLock.approvedTarget.reviewRoute === '/step4/s02/golden-master-p1/' && s02RevisedApprovalLock.approvedTarget.readyCommit === readyCommit && s02RevisedApprovalLock.approvedTarget.readyTree === readyTree && s02RevisedApprovalLock.approvedTarget.contentCommit === targetCommit && s02RevisedApprovalLock.approvedTarget.contentTree === targetTree && s02RevisedApprovalLock.approvedTarget.contentManifestSha256 === contentManifestSha256, 'round 008 revised READY/content fingerprint mismatch');
  const critic = json(s02RevisionReviewEvidencePaths.critic);
  assert(JSON.stringify(s02RevisedApprovalLock.approvedTarget.goldenMasters) === JSON.stringify(critic.screenshots), 'round 008 does not bind the exact revised Golden Master and responsive screenshot set');
  const expectedEvidence = Object.fromEntries(Object.entries(s02RevisionReviewEvidencePaths).map(([key, file]) => [key, { path: file, blob: git(['rev-parse', `HEAD:${file}`]) }]));
  assert(JSON.stringify(s02RevisedApprovalLock.approvedTarget.evidence) === JSON.stringify(expectedEvidence), 'round 008 evidence path/blob set differs from the immutable round 002 chain');
  const readback = s02RevisionHandoff.readyAccess.currentReadback;
  const deploymentRequest = s02RevisionHandoff.readyAccess.currentRequest;
  assert(JSON.stringify(s02RevisedApprovalLock.approvedTarget.accessProof) === JSON.stringify({ request: { path: s02RevisionHandoff.readyAccess.currentRequestPath, blob: git(['rev-parse', `HEAD:${s02RevisionHandoff.readyAccess.currentRequestPath}`]) }, readback: { path: s02RevisionHandoff.readyAccess.currentReadbackPath, blob: git(['rev-parse', `HEAD:${s02RevisionHandoff.readyAccess.currentReadbackPath}`]) } }), 'round 008 approval does not bind the exact latest access-renewal proof');
  assert(JSON.stringify(s02RevisedApprovalLock.approvedTarget.deployment) === JSON.stringify({
    id: readback.verifiedDeployment.id,
    immutableUrl: readback.verifiedDeployment.immutableUrl,
    environment: 'Preview',
    githubCommit: targetCommit,
    projectId: 'prj_3Ip3e0eYMy9SchP1vS36ibjJP9LB',
    teamId: 'team_6odZCZQ1QxjzhPdC9sgEtoCM',
    productionAliasChanged: false
  }), 'round 008 deployment target differs from the revised reviewed Preview');
  const approvalObservedAt = Date.parse(s02RevisedApprovalLock.sourceDecision.observedAt ?? '');
  const readyCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', readyCommit]));
  const openingCommittedAt = Date.parse(git(['show', '-s', '--format=%cI', openingCommit]));
  const canonicalObservedAt = Number.isFinite(approvalObservedAt) ? new Date(approvalObservedAt).toISOString().replace('.000Z', 'Z') : '';
  const accessExpiry = Date.parse(deploymentRequest.review.temporaryAccess.expiresAt ?? '');
  assert(canonicalObservedAt === s02RevisedApprovalLock.sourceDecision.observedAt && approvalObservedAt >= Date.parse(readback.verifiedHttp.verifiedAt) && approvalObservedAt >= readyCommittedAt && approvalObservedAt <= accessExpiry && approvalObservedAt <= openingCommittedAt && openingCommittedAt - approvalObservedAt <= 24 * 60 * 60 * 1000 && s02RevisedApprovalLock.createdAt === s02RevisedApprovalLock.sourceDecision.observedAt.slice(0, 10) && s02RevisedP2Control.createdAt === s02RevisedApprovalLock.createdAt, 'round 008 approval time is outside the revised deployed-target, live temporary-access, READY and 24-hour opening interval');
  assert(JSON.stringify(s02RevisedApprovalLock.approvedTarget.temporaryAccess) === JSON.stringify(deploymentRequest.review.temporaryAccess), 'round 008 approval does not bind the exact live temporary Preview access URL and expiry');
  assert(JSON.stringify(s02RevisedApprovalLock.accepted) === JSON.stringify({ userApprovedGoldenMasters: 8, evidenceAcceptedDeliverables: 10 }) && Object.values(s02RevisedApprovalLock.boundaries).every(value => value === false), 'round 008 accepted counts or truth boundaries overclaim completion/runtime/release/device state');
  assert(s02RevisedP2Control.userDecisionLock.path === s02RevisedApprovalLockPath && s02RevisedP2Control.userDecisionLock.blob === git(['rev-parse', `HEAD:${s02RevisedApprovalLockPath}`]), 'round 037 does not bind immutable round 008');
  assert(JSON.stringify(s02RevisedP2Control.readiness) === JSON.stringify({
    internalP0: 0,
    internalP1: 0,
    userApprovedGoldenMasters: 8,
    evidenceAcceptedDeliverables: 10,
    s4RecoveryFinding: 'OPEN_S4_RECOVERY_VIS_001',
    readyCommit,
    readyTree,
    contentCommit: targetCommit,
    contentTree: targetTree,
    acceptanceMatrix: expectedEvidence.acceptanceMatrix,
    feasibilityAudit: expectedEvidence.feasibilityAudit,
    critic: expectedEvidence.critic,
    deploymentReadback: expectedEvidence.deploymentReadback
  }), 'round 037 readiness does not exactly derive from the approved revised target');
  assert(s02RevisedP2Control.entryWorkflow.commit === readyCommit && s02RevisedP2Control.entryWorkflow.tree === readyTree, 'round 037 entry workflow does not target the exact revised READY parent');
  assertWorkflowEvidenceKeys(s02RevisedP2Control.entryWorkflow, 'round 037 entry workflow', true);
  registerWorkflowEvidence(s02RevisedP2Control.entryWorkflow, 'round 037 entry');
  assertExactPhaseDocumentTransforms(openingCommit, expectedRound037DocumentText, 'round 037 opening documents');
  assertNoPathChangesSince(targetCommit, git(['rev-parse', 'HEAD']), contentManifest.map(entry => entry.path), 'approved revised S02 Golden Master freeze after round 037');
  const round037FreezeEnd = s02AssetPassOpeningCommit ? git(['rev-parse', `${s02AssetPassOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
  assertNoPathChangesSince(openingCommit, round037FreezeEnd, expectedS02ReadyActivationWrites, 'round 037 mirrors must remain frozen before exact PASS_ASSET activation');
  return { openingCommit, readyCommit, readyTree };
}

const s02RevisedP2Approval = verifyS02RevisedP2ApprovalHandoff();
function verifyAdditionalS02ApprovalHandoff(config, revisionHandoff) {
  const control = config.control;
  const lock = config.lock;
  assert(Boolean(control) === Boolean(lock), `round ${config.controlRound} control and round ${config.lockRound} approval lock must appear atomically`);
  if (!control) return null;
  assert(revisionHandoff?.revisedReadyCommit && revisionHandoff.revisionPrefix?.readbackCommit, `round ${config.controlRound} requires complete review round ${config.evidenceRound} and READY activation`);
  assertExactKeySet(control, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'entryWorkflow', 'userDecisionLock', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'readiness', 'nextAuthorizedAction', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], `round ${config.controlRound} approval control`);
  assertExactKeySet(control.entry, ['head', 'tree'], `round ${config.controlRound} entry`);
  assertExactKeySet(control.userDecisionLock, ['path', 'blob'], `round ${config.controlRound} lock binding`);
  assertExactKeySet(control.readiness, ['internalP0', 'internalP1', 'userApprovedGoldenMasters', 'evidenceAcceptedDeliverables', 's4RecoveryFinding', 'readyCommit', 'readyTree', 'contentCommit', 'contentTree', 'acceptanceMatrix', 'feasibilityAudit', 'critic', 'deploymentReadback'], `round ${config.controlRound} readiness`);
  for (const key of ['acceptanceMatrix', 'feasibilityAudit', 'critic', 'deploymentReadback']) assertExactKeySet(control.readiness[key], ['path', 'blob'], `round ${config.controlRound} ${key} binding`);
  assertExactKeySet(control.completionBoundary, ['step4Pass', 'step5Allowed', 'productionAllowed', 'productionAssetsApproved', 'twelveScreensApproved', 'productionAliasChanged', 'physicalIPhoneVerified', 'maximumVerdict', 'mayNotDeclare'], `round ${config.controlRound} completion boundary`);
  assert(control.schemaVersion === 1 && control.artifactId === `cats-tower-active-change-control-addendum-round-${config.controlRound}` && isCanonicalIsoDate(control.createdAt) && control.repository === '2hg7trp7rv-design/cats_tower' && control.branch === 'kimi' && control.parentChangeControl === config.parentControlPath, `round ${config.controlRound} identity, date, repository, branch or parent mismatch`);
  assert(control.status === 'IN_PROGRESS' && control.verdict === 'READY_FOR_S02_P2_ASSET_PRODUCTION' && control.currentRepositoryStep === 4 && control.internalPhase === 'S02-P2-ASSET-PRODUCTION' && control.internalPhaseIsRepositoryStep === false && control.scope === 'S02_P2_REPRESENTATIVE_PRODUCTION_ASSET_PROOF_FROM_REVISED_GOLDEN_MASTER_ONLY', `round ${config.controlRound} phase or scope mismatch`);
  assert(control.nextAuthorizedAction === 'Create and independently verify one exact representative production-asset set from the approved revised Golden Master; volume generation and runtime replacement remain blocked until round 042 PASS_ASSET.', `round ${config.controlRound} next action exceeds the exact representative proof`);
  assert(JSON.stringify(control.allowedWrites) === JSON.stringify(expectedS02P2AllowedWrites) && JSON.stringify(control.forbiddenWrites) === JSON.stringify(expectedS02P2ForbiddenWrites), `round ${config.controlRound} write boundary mismatch`);
  assert(JSON.stringify(control.completionBoundary) === JSON.stringify({ step4Pass: false, step5Allowed: false, productionAllowed: false, productionAssetsApproved: false, twelveScreensApproved: 0, productionAliasChanged: false, physicalIPhoneVerified: false, maximumVerdict: 'READY_FOR_S02_P2_ASSET_PRODUCTION', mayNotDeclare: ['S02 complete', 'Step 4 PASS', 'Step 5 allowed', 'runtime implemented', 'production assets approved', 'Production Ready', 'physical iPhone verified', 'Production alias changed'] }), `round ${config.controlRound} completion boundary overclaims`);
  const openingCommit = config.openingCommit;
  const readyCommit = git(['rev-parse', `${openingCommit}^`]);
  const readyTree = git(['rev-parse', `${readyCommit}^{tree}`]);
  assertExactSingleParent(openingCommit, readyCommit, `round ${config.controlRound} approval opening`);
  assert(revisionHandoff.readyAccess && !revisionHandoff.readyAccess.pendingRequest && readyCommit === revisionHandoff.readyAccess.decisionReadyCommit, `round ${config.controlRound} parent is not the latest fully verified live-access READY state`);
  assert(JSON.stringify(control.entry) === JSON.stringify({ head: readyCommit, tree: readyTree }), `round ${config.controlRound} entry does not bind READY`);
  const openingWrites = [config.controlPath, config.lockPath, ...expectedS02ReadyActivationWrites];
  assertExactChangedPaths(readyCommit, openingCommit, openingWrites, `round ${config.controlRound} atomic approval opening`);
  assert(firstAddCommit(config.controlPath) === openingCommit && firstAddCommit(config.lockPath) === openingCommit, `round ${config.controlRound}/${config.lockRound} were not first added atomically`);
  assertAddedOnceAndUnchanged(config.controlPath, openingCommit);
  assertAddedOnceAndUnchanged(config.lockPath, openingCommit);
  assertExactKeySet(lock, ['schemaVersion', 'artifactId', 'createdAt', 'chat', 'repository', 'branch', 'parentDecisionLock', 'base', 'sourceDecision', 'decision', 'approvalScope', 'approvedTarget', 'accepted', 'boundaries'], `round ${config.lockRound} approval lock`);
  assertExactKeySet(lock.base, ['head', 'tree'], `round ${config.lockRound} base`);
  assertExactKeySet(lock.sourceDecision, ['message', 'authorizationCode', 'observedAt', 'inferred'], `round ${config.lockRound} source`);
  assertExactKeySet(lock.approvedTarget, ['reviewRoute', 'readyCommit', 'readyTree', 'contentCommit', 'contentTree', 'contentManifestSha256', 'goldenMasters', 'evidence', 'deployment', 'temporaryAccess', 'accessProof'], `round ${config.lockRound} approved target`);
  assertExactKeySet(lock.approvedTarget.evidence, ['acceptanceMatrix', 'feasibilityAudit', 'critic', 'finalJudge', 'completion', 'deploymentRequest', 'deploymentReadback'], `round ${config.lockRound} evidence`);
  for (const value of Object.values(lock.approvedTarget.evidence)) assertExactKeySet(value, ['path', 'blob'], `round ${config.lockRound} evidence binding`);
  assertExactKeySet(lock.approvedTarget.deployment, ['id', 'immutableUrl', 'environment', 'githubCommit', 'projectId', 'teamId', 'productionAliasChanged'], `round ${config.lockRound} deployment`);
  assertExactKeySet(lock.approvedTarget.accessProof, ['request', 'readback'], `round ${config.lockRound} access proof`);
  assertExactKeySet(lock.approvedTarget.accessProof.request, ['path', 'blob'], `round ${config.lockRound} access request proof`);
  assertExactKeySet(lock.approvedTarget.accessProof.readback, ['path', 'blob'], `round ${config.lockRound} access readback proof`);
  assertExactKeySet(lock.accepted, ['userApprovedGoldenMasters', 'evidenceAcceptedDeliverables'], `round ${config.lockRound} accepted`);
  assertExactKeySet(lock.boundaries, ['s02Complete', 'step4Pass', 'step5Allowed', 'runtimeImplemented', 'productionAssetsApproved', 'productionReady', 'physicalIPhoneVerified', 'productionAliasChanged'], `round ${config.lockRound} boundaries`);
  assert(lock.schemaVersion === 1 && lock.artifactId === `step-1-hero-merchant-large-idle-integration-user-decision-lock-round-${config.lockRound}` && isCanonicalIsoDate(lock.createdAt) && lock.chat === '04_S02-P1_GoldenMaster設計' && lock.repository === control.repository && lock.branch === 'kimi' && lock.parentDecisionLock === config.parentLockPath && JSON.stringify(lock.base) === JSON.stringify({ head: readyCommit, tree: readyTree }), `round ${config.lockRound} identity, date, parent or READY base mismatch`);
  const contentManifest = revisionHandoff.revisionPrefix.contentManifest;
  const manifestSha256 = `sha256:${sha256Canonical(contentManifest)}`;
  const expectedMessage = `APPROVE_S02_P1_GM_FOR_P2 READY_COMMIT=${readyCommit} READY_TREE=${readyTree} CONTENT_MANIFEST_SHA256=${manifestSha256}`;
  assert(lock.sourceDecision.message === expectedMessage && lock.sourceDecision.authorizationCode === 'APPROVE_S02_P1_GM_FOR_P2' && lock.sourceDecision.inferred === false && lock.decision === 'APPROVED_REVISED_S02_GOLDEN_MASTER_P1_FOR_P2_ASSET_PRODUCTION' && lock.approvalScope === 'REVISED_S02_P1_GOLDEN_MASTER_VISUAL_DIRECTION_ONLY', `round ${config.lockRound} lacks exact revised-target approval`);
  const targetCommit = revisionHandoff.revisionPrefix.targetCommit;
  const targetTree = revisionHandoff.revisionPrefix.targetTree;
  assert(lock.approvedTarget.reviewRoute === '/step4/s02/golden-master-p1/' && lock.approvedTarget.readyCommit === readyCommit && lock.approvedTarget.readyTree === readyTree && lock.approvedTarget.contentCommit === targetCommit && lock.approvedTarget.contentTree === targetTree && lock.approvedTarget.contentManifestSha256 === manifestSha256, `round ${config.lockRound} READY/content fingerprint mismatch`);
  const critic = json(config.evidencePaths.critic);
  assert(JSON.stringify(lock.approvedTarget.goldenMasters) === JSON.stringify(critic.screenshots), `round ${config.lockRound} Golden Master binding mismatch`);
  const expectedEvidence = Object.fromEntries(Object.entries(config.evidencePaths).map(([key, file]) => [key, { path: file, blob: git(['rev-parse', `HEAD:${file}`]) }]));
  assert(JSON.stringify(lock.approvedTarget.evidence) === JSON.stringify(expectedEvidence), `round ${config.lockRound} evidence binding mismatch`);
  const readback = revisionHandoff.readyAccess.currentReadback;
  const request = revisionHandoff.readyAccess.currentRequest;
  assert(JSON.stringify(lock.approvedTarget.deployment) === JSON.stringify({ id: readback.verifiedDeployment.id, immutableUrl: readback.verifiedDeployment.immutableUrl, environment: 'Preview', githubCommit: targetCommit, projectId: 'prj_3Ip3e0eYMy9SchP1vS36ibjJP9LB', teamId: 'team_6odZCZQ1QxjzhPdC9sgEtoCM', productionAliasChanged: false }) && JSON.stringify(lock.approvedTarget.temporaryAccess) === JSON.stringify(request.review.temporaryAccess), `round ${config.lockRound} deployment or temporary-access binding mismatch`);
  assert(JSON.stringify(lock.approvedTarget.accessProof) === JSON.stringify({ request: { path: revisionHandoff.readyAccess.currentRequestPath, blob: git(['rev-parse', `HEAD:${revisionHandoff.readyAccess.currentRequestPath}`]) }, readback: { path: revisionHandoff.readyAccess.currentReadbackPath, blob: git(['rev-parse', `HEAD:${revisionHandoff.readyAccess.currentReadbackPath}`]) } }), `round ${config.lockRound} does not bind the exact latest access proof`);
  const observedAt = Date.parse(lock.sourceDecision.observedAt ?? '');
  const readyTime = Date.parse(git(['show', '-s', '--format=%cI', readyCommit]));
  const openingTime = Date.parse(git(['show', '-s', '--format=%cI', openingCommit]));
  const expiry = Date.parse(request.review.temporaryAccess.expiresAt ?? '');
  assert(Number.isFinite(observedAt) && new Date(observedAt).toISOString().replace('.000Z', 'Z') === lock.sourceDecision.observedAt && observedAt >= Date.parse(readback.verifiedHttp.verifiedAt) && observedAt >= readyTime && observedAt <= expiry && observedAt <= openingTime && openingTime - observedAt <= 24 * 60 * 60 * 1000 && control.createdAt === lock.createdAt && lock.createdAt === lock.sourceDecision.observedAt.slice(0, 10), `round ${config.lockRound} approval time is outside the exact live reviewed READY interval`);
  assert(JSON.stringify(lock.accepted) === JSON.stringify({ userApprovedGoldenMasters: 8, evidenceAcceptedDeliverables: 10 }) && Object.values(lock.boundaries).every(value => value === false), `round ${config.lockRound} accepted count or boundaries overclaim`);
  assert(control.userDecisionLock.path === config.lockPath && control.userDecisionLock.blob === git(['rev-parse', `HEAD:${config.lockPath}`]), `round ${config.controlRound} does not bind immutable round ${config.lockRound}`);
  assert(JSON.stringify(control.readiness) === JSON.stringify({ internalP0: 0, internalP1: 0, userApprovedGoldenMasters: 8, evidenceAcceptedDeliverables: 10, s4RecoveryFinding: 'OPEN_S4_RECOVERY_VIS_001', readyCommit, readyTree, contentCommit: targetCommit, contentTree: targetTree, acceptanceMatrix: expectedEvidence.acceptanceMatrix, feasibilityAudit: expectedEvidence.feasibilityAudit, critic: expectedEvidence.critic, deploymentReadback: expectedEvidence.deploymentReadback }), `round ${config.controlRound} readiness does not derive from exact latest evidence`);
  assert(control.entryWorkflow.commit === readyCommit && control.entryWorkflow.tree === readyTree, `round ${config.controlRound} entry workflow target mismatch`);
  assertWorkflowEvidenceKeys(control.entryWorkflow, `round ${config.controlRound} entry workflow`, true);
  registerWorkflowEvidence(control.entryWorkflow, `round ${config.controlRound} entry`);
  assertExactPhaseDocumentTransforms(openingCommit, file => expectedAdditionalApprovalDocumentText(file, config.documentConfig), `round ${config.controlRound} opening documents`);
  assertNoPathChangesSince(targetCommit, git(['rev-parse', 'HEAD']), contentManifest.map(entry => entry.path), `approved content freeze after round ${config.controlRound}`);
  const freezeEnd = s02AssetPassOpeningCommit ? git(['rev-parse', `${s02AssetPassOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
  assertNoPathChangesSince(openingCommit, freezeEnd, expectedS02ReadyActivationWrites, `round ${config.controlRound} mirrors changed before PASS_ASSET successor`);
  return { openingCommit, readyCommit, readyTree, targetCommit, targetTree, contentManifest, evidencePaths: config.evidencePaths };
}
const s02SecondRevisedP2Approval = verifyAdditionalS02ApprovalHandoff({
  controlRound: '039', lockRound: '010', evidenceRound: '003', controlPath: s02SecondRevisedP2ControlPath, lockPath: s02SecondRevisedApprovalLockPath, control: s02SecondRevisedP2Control, lock: s02SecondRevisedApprovalLock, openingCommit: s02SecondRevisedP2OpeningCommit,
  parentControlPath: s02SecondRevisionControlPath, parentLockPath: s02SecondRevisionLockPath, evidencePaths: s02SecondRevisionReviewEvidencePaths, documentConfig: s02SecondRevisionDocumentConfig
}, s02SecondRevisionHandoff);
const s02ThirdRevisedP2Approval = verifyAdditionalS02ApprovalHandoff({
  controlRound: '041', lockRound: '012', evidenceRound: '004', controlPath: s02ThirdRevisedP2ControlPath, lockPath: s02ThirdRevisedApprovalLockPath, control: s02ThirdRevisedP2Control, lock: s02ThirdRevisedApprovalLock, openingCommit: s02ThirdRevisedP2OpeningCommit,
  parentControlPath: s02ThirdRevisionControlPath, parentLockPath: s02ThirdRevisionLockPath, evidencePaths: s02ThirdRevisionReviewEvidencePaths, documentConfig: s02ThirdRevisionDocumentConfig
}, s02ThirdRevisionHandoff);
const s02ApprovedAssetSource = s02ThirdRevisedP2Control ? {
  control: s02ThirdRevisedP2Control, controlPath: s02ThirdRevisedP2ControlPath, openingCommit: s02ThirdRevisedP2OpeningCommit,
  lock: s02ThirdRevisedApprovalLock, lockPath: s02ThirdRevisedApprovalLockPath, approval: s02ThirdRevisedP2Approval,
  documentRenderer: file => expectedAdditionalApprovalDocumentText(file, s02ThirdRevisionDocumentConfig), snapshot: s02ThirdRevisionDocumentConfig.approvalSnapshot
} : s02SecondRevisedP2Control ? {
  control: s02SecondRevisedP2Control, controlPath: s02SecondRevisedP2ControlPath, openingCommit: s02SecondRevisedP2OpeningCommit,
  lock: s02SecondRevisedApprovalLock, lockPath: s02SecondRevisedApprovalLockPath, approval: s02SecondRevisedP2Approval,
  documentRenderer: file => expectedAdditionalApprovalDocumentText(file, s02SecondRevisionDocumentConfig), snapshot: s02SecondRevisionDocumentConfig.approvalSnapshot
} : s02RevisedP2Control ? {
  control: s02RevisedP2Control, controlPath: s02RevisedP2ControlPath, openingCommit: s02RevisedP2OpeningCommit,
  lock: s02RevisedApprovalLock, lockPath: s02RevisedApprovalLockPath, approval: s02RevisedP2Approval,
  documentRenderer: expectedRound037DocumentText, snapshot: round037ReadySnapshot
} : s02P2Control ? {
  control: s02P2Control, controlPath: s02P2ControlPath, openingCommit: s02P2OpeningCommit,
  lock: s02UserDecisionLock, lockPath: s02UserDecisionLockPath, approval: s02P2Approval,
  documentRenderer: expectedRound035DocumentText, snapshot: round035ReadySnapshot
} : null;

const round042Snapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02AssetPassControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | PASS_S02_P2_REPRESENTATIVE_ASSET`;
function expectedRound042DocumentText(file) {
  assert(s02ApprovedAssetSource, 'round 042 document renderer lacks one exact approval source');
  let source = s02ApprovedAssetSource.documentRenderer(file).replace(s02ApprovedAssetSource.snapshot, round042Snapshot);
  const replacements = {
    'QUALITY_GATE.md': [
      [/The .*?(?:representative|permits only one representative).*?(?:PASS_ASSET\.|before PASS_ASSET\.)/s, 'The exact representative S02 P2 asset set passed scoped `PASS_ASSET`. Asset volume, runtime integration, Step 4 PASS, Step 5 and Production remain blocked until a new exact change-control.']
    ],
    'PROJECT_HANDOVER.md': [
      [/1\. produce one .*?\n2\. verify .*?\n3\. .*?PASS_ASSET.*?\n4\. .*?(?:unchanged|unchanged\.)/s, '1. preserve the representative PASS_ASSET evidence and approved Golden Master lineage\n2. open a new exact change-control before producing asset volume\n3. keep runtime integration, Step 4 PASS, Step 5 and Production blocked\n4. report physical iPhone as not verified']
    ],
    '.github/workflows/CURRENT_STATUS.md': [
      [/- .*?(?:permits only one representative|representative P2).*$/m, '- the exact representative S02 P2 assets have scoped `PASS_ASSET`; volume, runtime, Step 4, Step 5 and Production remain blocked']
    ],
    'AGENTS.md': [
      [/Read `CURRENT_AUTHORITY_INDEX\.json`.*?(?:device verdicts\.|physical-device verdicts\.)/s, 'Read `CURRENT_AUTHORITY_INDEX.json` and round 042. Preserve the representative PASS_ASSET evidence. Do not create asset volume, replace runtime, or mutate gameplay, economy, save, backend, payment, ads, Production or device verdicts without a new exact change-control.']
    ],
    'README.md': [
      [/Repository Step 4 remains in progress under round \d+\..*?(?:unchanged\.|remain unchanged\.)/s, 'Repository Step 4 remains in progress under round 042. One exact representative S02 P2 asset set has scoped PASS_ASSET; asset volume and runtime integration are not authorized. Step 4, Step 5, Production and physical-device verdicts remain unchanged.']
    ]
  };
  for (const [pattern, replacement] of replacements[file] ?? []) {
    assert(pattern.test(source), `round 042 deterministic document transform source is missing: ${file}`);
    source = source.replace(pattern, replacement);
  }
  return source;
}

const round043InProgressSnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02AssetVolumeScopeControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | IN_PROGRESS_S02_P2_VOLUME_SCOPE_CONTRACT`;
const round044Snapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02AssetVolumeControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | IN_PROGRESS_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION`;
const round044ReadySnapshot = `CURRENT_AUTHORITY_SNAPSHOT: ${s02AssetVolumeControlPath} | STEP 4 | S02-P2-ASSET-PRODUCTION | READY_FOR_S02_P3_RUNTIME_INTEGRATION_SCOPE_REVIEW`;
function expectedRound043DocumentText(file) {
  let source = expectedRound042DocumentText(file).replace(round042Snapshot, round043InProgressSnapshot);
  const replacements = {
    'QUALITY_GATE.md': [
      ['The exact representative S02 P2 asset set passed scoped `PASS_ASSET`. Asset volume, runtime integration, Step 4 PASS, Step 5 and Production remain blocked until a new exact change-control.', 'Round 043 authorizes only a finite S02 P2 asset-volume scope contract and its independent review evidence. No volume asset byte, runtime integration, Step 4 PASS, Step 5 or Production work is authorized.']
    ],
    'PROJECT_HANDOVER.md': [
      ['1. preserve the representative PASS_ASSET evidence and approved Golden Master lineage\n2. open a new exact change-control before producing asset volume\n3. keep runtime integration, Step 4 PASS, Step 5 and Production blocked\n4. report physical iPhone as not verified', '1. preserve the representative PASS_ASSET evidence and approved Golden Master lineage\n2. define a finite path-by-path source and delivery asset-volume contract under round 043\n3. independently review feasibility, budgets, anchors, frames, export lineage and evidence paths without creating asset bytes\n4. keep runtime integration, Step 4 PASS, Step 5, Production and physical iPhone verification blocked']
    ],
    '.github/workflows/CURRENT_STATUS.md': [
      ['- the exact representative S02 P2 assets have scoped `PASS_ASSET`; volume, runtime, Step 4, Step 5 and Production remain blocked', '- round 043 is limited to the exact S02 P2 asset-volume scope contract and review evidence; asset bytes, runtime, Step 4, Step 5 and Production remain blocked']
    ],
    'AGENTS.md': [
      ['Read `CURRENT_AUTHORITY_INDEX.json` and round 042. Preserve the representative PASS_ASSET evidence. Do not create asset volume, replace runtime, or mutate gameplay, economy, save, backend, payment, ads, Production or device verdicts without a new exact change-control.', 'Read `CURRENT_AUTHORITY_INDEX.json`, round 043 and immutable governance activation record round 013. Create only the finite S02 P2 source/delivery asset-volume scope contract and its exact review evidence. Do not create volume asset bytes or mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.']
    ],
    'README.md': [
      ['Repository Step 4 remains in progress under round 042. One exact representative S02 P2 asset set has scoped PASS_ASSET; asset volume and runtime integration are not authorized. Step 4, Step 5, Production and physical-device verdicts remain unchanged.', 'Repository Step 4 remains in progress under round 043. Only the finite S02 P2 asset-volume scope contract and independent evidence are authorized; asset bytes and runtime integration are not. Step 4, Step 5, Production and physical-device verdicts remain unchanged.']
    ]
  };
  for (const [from, to] of replacements[file] ?? []) source = replaceOnce(source, from, to, `round 043 ${file}`);
  return source;
}
function expectedRound044DocumentText(file) {
  let source = expectedRound043DocumentText(file).replace(round043InProgressSnapshot, round044Snapshot);
  const replacements = {
    'QUALITY_GATE.md': [['Round 043 authorizes only a finite S02 P2 asset-volume scope contract and its independent review evidence. No volume asset byte, runtime integration, Step 4 PASS, Step 5 or Production work is authorized.', 'Round 043 independently closed the finite scope contract with P0/P1 zero. Round 044 automatically authorizes only the exact source assets, delivery assets and evidence paths enumerated by that immutable contract; runtime integration, gameplay data, Step 4 PASS, Step 5 and Production remain blocked.']],
    'PROJECT_HANDOVER.md': [['1. preserve the representative PASS_ASSET evidence and approved Golden Master lineage\n2. define a finite path-by-path source and delivery asset-volume contract under round 043\n3. independently review feasibility, budgets, anchors, frames, export lineage and evidence paths without creating asset bytes\n4. keep runtime integration, Step 4 PASS, Step 5, Production and physical iPhone verification blocked', '1. produce source and delivery assets only in the contract-defined batch order and exact paths\n2. verify bytes, format, dimensions, frames, anchors, alpha, 9-slice, export lineage, text exclusion and budgets\n3. complete the exact contract-enumerated production evidence without runtime integration\n4. keep Step 4 PASS, Step 5, Production and physical iPhone verification blocked']],
    '.github/workflows/CURRENT_STATUS.md': [['- round 043 is limited to the exact S02 P2 asset-volume scope contract and review evidence; asset bytes, runtime, Step 4, Step 5 and Production remain blocked', '- round 044 automatically derives its finite source/delivery asset and evidence allowlist from the P0/P1-zero round 043 contract; runtime, Step 4, Step 5 and Production remain blocked']],
    'AGENTS.md': [['Read `CURRENT_AUTHORITY_INDEX.json`, round 043 and immutable governance activation record round 013. Create only the finite S02 P2 source/delivery asset-volume scope contract and its exact review evidence. Do not create volume asset bytes or mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.', 'Read `CURRENT_AUTHORITY_INDEX.json`, round 044, immutable governance activation record round 014 and the passed round 043 contract. Write only exact contract-enumerated source/delivery asset and evidence paths. Do not mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.']],
    'README.md': [['Repository Step 4 remains in progress under round 043. Only the finite S02 P2 asset-volume scope contract and independent evidence are authorized; asset bytes and runtime integration are not. Step 4, Step 5, Production and physical-device verdicts remain unchanged.', 'Repository Step 4 remains in progress under round 044. Only exact immutable-contract-enumerated S02 P2 source/delivery assets and evidence are authorized; runtime integration is not. Step 4, Step 5, Production and physical-device verdicts remain unchanged.']]
  };
  for (const [from, to] of replacements[file] ?? []) source = replaceOnce(source, from, to, `round 044 ${file}`);
  return source;
}
function expectedRound044ReadyDocumentText(file) {
  let source = expectedRound044DocumentText(file).replace(round044Snapshot, round044ReadySnapshot);
  const replacements = {
    'QUALITY_GATE.md': [['Round 043 independently closed the finite scope contract with P0/P1 zero. Round 044 automatically authorizes only the exact source assets, delivery assets and evidence paths enumerated by that immutable contract; runtime integration, gameplay data, Step 4 PASS, Step 5 and Production remain blocked.', 'Every exact round 043 contract-enumerated S02 P2 source and delivery asset batch passed decoded-byte, lineage, feasibility, independent-critic and final-judge review with P0/P1 zero. The maximum state is readiness to scope S02 P3 runtime integration; runtime writes, gameplay data, Step 4 PASS, Step 5 and Production remain blocked.']],
    'PROJECT_HANDOVER.md': [['1. produce source and delivery assets only in the contract-defined batch order and exact paths\n2. verify bytes, format, dimensions, frames, anchors, alpha, 9-slice, export lineage, text exclusion and budgets\n3. complete the exact contract-enumerated production evidence without runtime integration\n4. keep Step 4 PASS, Step 5, Production and physical iPhone verification blocked', '1. preserve every immutable round 044 source/delivery asset and batch evidence binding\n2. open a new exact scope-only change-control before any S02 P3 runtime integration\n3. keep gameplay data, Step 4 PASS, Step 5 and Production blocked\n4. report physical iPhone as not verified']],
    '.github/workflows/CURRENT_STATUS.md': [['- round 044 automatically derives its finite source/delivery asset and evidence allowlist from the P0/P1-zero round 043 contract; runtime, Step 4, Step 5 and Production remain blocked', '- all exact contract-enumerated round 044 asset batches passed with P0/P1 zero; only a future exact S02 P3 runtime-integration scope review may follow, while runtime, Step 4, Step 5 and Production remain blocked']],
    'AGENTS.md': [['Read `CURRENT_AUTHORITY_INDEX.json`, round 044, immutable governance activation record round 014 and the passed round 043 contract. Write only exact contract-enumerated source/delivery asset and evidence paths. Do not mutate runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts.', 'Read `CURRENT_AUTHORITY_INDEX.json`, round 044, immutable governance activation record round 014, the passed round 043 contract and every immutable batch completion. Do not write runtime, gameplay, economy, save, backend, payment, ads, Production or device verdicts until a new exact scope-only successor is independently activated.']],
    'README.md': [['Repository Step 4 remains in progress under round 044. Only exact immutable-contract-enumerated S02 P2 source/delivery assets and evidence are authorized; runtime integration is not. Step 4, Step 5, Production and physical-device verdicts remain unchanged.', 'Repository Step 4 remains in progress under round 044. Exact contract-enumerated S02 P2 asset volume has passed its bounded batch evidence; only S02 P3 runtime-integration scope review may be considered next. Runtime, Step 4 PASS, Step 5, Production and physical-device verdicts remain unchanged.']]
  };
  for (const [from, to] of replacements[file] ?? []) source = replaceOnce(source, from, to, `round 044 READY ${file}`);
  return source;
}

function verifyS02RepresentativeAssetPass() {
  const anyProof = exists(s02RepresentativeManifestPath) || Object.values(s02RepresentativeEvidencePaths).some(exists) || Boolean(s02AssetPassControl);
  if (!anyProof) return null;
  assert(s02ApprovedAssetSource?.approval && s02ApprovedAssetSource.lock && s02ApprovedAssetSource.control, 'representative asset proof requires exactly one verified user-approved Golden Master source');
  const manifestPresent = exists(s02RepresentativeManifestPath);
  assert(manifestPresent, 'representative asset evidence/control exists before its exact manifest and six assets');
  for (const file of s02RepresentativeAssetPaths) assert(exists(file), `representative asset is missing: ${file}`);
  const manifest = json(s02RepresentativeManifestPath);
  assertExactKeySet(manifest, ['schemaVersion', 'artifactId', 'repository', 'branch', 'approvedSource', 'assets', 'totalBytes', 'boundaries'], 'representative asset manifest');
  assertExactKeySet(manifest.approvedSource, ['changeControl', 'decisionLock', 'readyCommit', 'readyTree', 'goldenMasterContentCommit', 'goldenMasterContentTree', 'goldenMasterContentManifestSha256'], 'representative asset approved source');
  assertExactKeySet(manifest.boundaries, ['runtimeUseAuthorized', 'assetVolumeAuthorized', 'step4Pass', 'step5Allowed', 'productionAllowed'], 'representative asset boundaries');
  const approvedTarget = s02ApprovedAssetSource.lock.approvedTarget;
  const expectedApprovedSource = {
    changeControl: { path: s02ApprovedAssetSource.controlPath, blob: git(['rev-parse', `HEAD:${s02ApprovedAssetSource.controlPath}`]) },
    decisionLock: { path: s02ApprovedAssetSource.lockPath, blob: git(['rev-parse', `HEAD:${s02ApprovedAssetSource.lockPath}`]) },
    readyCommit: approvedTarget.readyCommit,
    readyTree: approvedTarget.readyTree,
    goldenMasterContentCommit: approvedTarget.contentCommit,
    goldenMasterContentTree: approvedTarget.contentTree,
    goldenMasterContentManifestSha256: approvedTarget.contentManifestSha256
  };
  assert(manifest.schemaVersion === 1 && manifest.artifactId === 'cats-tower-s02-p2-representative-asset-manifest-round-001' && manifest.repository === '2hg7trp7rv-design/cats_tower' && manifest.branch === 'kimi' && JSON.stringify(manifest.approvedSource) === JSON.stringify(expectedApprovedSource), 'representative asset manifest identity or approved Golden Master fingerprint mismatch');
  assert(JSON.stringify(manifest.boundaries) === JSON.stringify({ runtimeUseAuthorized: false, assetVolumeAuthorized: false, step4Pass: false, step5Allowed: false, productionAllowed: false }), 'representative asset manifest overclaims its scope');
  const assetDefinitions = [
    ['CAT-MODEL-SHEET', s02RepresentativeAssetPaths[0], 'CAT_MODEL_SHEET', 4, true, false],
    ['CAT-IDLE-STRIP', s02RepresentativeAssetPaths[1], 'CAT_IDLE', 4, true, false],
    ['CAT-ATTACK-STRIP', s02RepresentativeAssetPaths[2], 'CAT_ATTACK', 4, true, true],
    ['ENEMY-MODEL-SHEET', s02RepresentativeAssetPaths[3], 'ENEMY_MODEL_SHEET', 4, true, false],
    ['ENEMY-DEFEAT-STRIP', s02RepresentativeAssetPaths[4], 'ENEMY_DEFEAT', 4, true, false],
    ['UI-PANEL-9SLICE', s02RepresentativeAssetPaths[5], 'UI_NINE_SLICE', 1, false, false]
  ];
  assert(Array.isArray(manifest.assets) && manifest.assets.length === assetDefinitions.length, 'representative manifest must contain exactly six reviewed assets');
  let totalBytes = 0;
  const contentManifest = [];
  const assetAnalyses = [];
  let nineSliceMeasurement = null;
  for (let index = 0; index < assetDefinitions.length; index += 1) {
    const [id, file, role, minimumFrames, footRequired, hitRequired] = assetDefinitions[index];
    const asset = manifest.assets[index];
    assertExactKeySet(asset, ['id', 'path', 'role', 'width', 'height', 'sha256', 'bytes', 'frameCount', 'frameWidth', 'frameHeight', 'alphaRequired', 'footAnchor', 'hitAnchor', 'nineSlice', 'textBakedIn', 'effectsSeparated'], `representative asset ${id}`);
    assert(asset.id === id && asset.path === file && asset.role === role && Number.isSafeInteger(asset.width) && Number.isSafeInteger(asset.height) && asset.width >= 128 && asset.width <= 4096 && asset.height >= 128 && asset.height <= 4096, `representative asset identity or dimensions invalid: ${id}`);
    assert(Number.isSafeInteger(asset.frameCount) && asset.frameCount >= minimumFrames && asset.frameCount <= 16 && Number.isSafeInteger(asset.frameWidth) && Number.isSafeInteger(asset.frameHeight) && asset.frameWidth * asset.frameCount === asset.width && asset.frameHeight === asset.height, `representative frame geometry invalid: ${id}`);
    const bytes = bytesAt('HEAD', file);
    const decoded = assertDecodedPng(bytes, asset.width, asset.height, `representative asset ${id}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert(asset.sha256 === digest && asset.bytes === bytes.length && asset.bytes <= 8 * 1024 * 1024 && asset.alphaRequired === true && asset.textBakedIn === false && asset.effectsSeparated === true, `representative byte, alpha, text or effects contract mismatch: ${id}`);
    assert([4, 6].includes(decoded.colorType), `representative asset declares alpha but the PNG has no alpha channel: ${id}`);
    assert(isRepresentativeTransparentAssetPng(decoded), `representative asset lacks production-like decoded visual information: ${id}`);
    const analysis = analyzeRepresentativeFrames(decoded, asset.frameWidth, asset.frameHeight, asset.frameCount, `representative asset ${id}`);
    if (role !== 'UI_NINE_SLICE') {
      assert(analysis.frames.every(frame => frame.nonTransparentRatio >= 0.03 && frame.nonTransparentRatio <= 0.9 && frame.coreAlphaRatio >= 0.02 && frame.coreAlphaFractionOfVisible >= 0.5 && frame.largestAlphaComponentRatio >= 0.65 && frame.visibleQuantizedColorCount >= 16 && frame.visibleLumaStdDev >= 6 && frame.visibleBounds.height >= asset.frameHeight * 0.35), `representative animation/model frame has sparse, translucent-only, fragmented, flat or unidentifiable visible pixels: ${id}`);
      assert(new Set(analysis.frames.map(frame => frame.sha256)).size === analysis.frames.length, `representative animation/model sheet repeats an identical frame: ${id}`);
      assert(analysis.consecutiveFrameDeltas.every(delta => delta.changedPixelRatio >= 0.003 && delta.changedPixelRatio <= 0.9 && delta.meanAbsoluteChannelDelta >= 0.25), `representative animation/model frames do not contain bounded visible pose/motion change: ${id}`);
    }
    const assertAnchor = (anchor, anchorLabel, required) => {
      if (!required) { assert(anchor === null, `${anchorLabel} must be null`); return; }
      assertExactKeySet(anchor, ['x', 'y'], anchorLabel);
      assert(Number.isSafeInteger(anchor.x) && Number.isSafeInteger(anchor.y) && anchor.x >= 0 && anchor.x <= asset.frameWidth && anchor.y >= 0 && anchor.y <= asset.frameHeight, `${anchorLabel} is outside one animation frame`);
    };
    assertAnchor(asset.footAnchor, `${id} foot anchor`, footRequired);
    assertAnchor(asset.hitAnchor, `${id} hit anchor`, hitRequired);
    if (footRequired) for (const frame of analysis.frames) {
      const bounds = frame.visibleBounds;
      assert(asset.footAnchor.x >= bounds.x - Math.ceil(asset.frameWidth * 0.1) && asset.footAnchor.x <= bounds.x + bounds.width + Math.ceil(asset.frameWidth * 0.1) && asset.footAnchor.y >= bounds.y + bounds.height - Math.ceil(asset.frameHeight * 0.2) && asset.footAnchor.y <= bounds.y + bounds.height + Math.ceil(asset.frameHeight * 0.1), `representative foot anchor is not tied to the decoded visible body bounds: ${id} frame ${frame.index}`);
    }
    if (hitRequired) for (const frame of analysis.frames) {
      const bounds = frame.visibleBounds;
      assert(asset.hitAnchor.x >= bounds.x - Math.ceil(asset.frameWidth * 0.25) && asset.hitAnchor.x <= bounds.x + bounds.width + Math.ceil(asset.frameWidth * 0.25) && asset.hitAnchor.y >= bounds.y - Math.ceil(asset.frameHeight * 0.2) && asset.hitAnchor.y <= bounds.y + bounds.height + Math.ceil(asset.frameHeight * 0.2), `representative hit anchor is unrelated to the decoded attack bounds: ${id} frame ${frame.index}`);
    }
    if (role === 'UI_NINE_SLICE') {
      assertExactKeySet(asset.nineSlice, ['left', 'top', 'right', 'bottom', 'minimumWidth', 'minimumHeight'], `${id} nine-slice`);
      assert(Object.values(asset.nineSlice).every(Number.isSafeInteger) && asset.nineSlice.left > 0 && asset.nineSlice.top > 0 && asset.nineSlice.right > 0 && asset.nineSlice.bottom > 0 && asset.nineSlice.left + asset.nineSlice.right < asset.width && asset.nineSlice.top + asset.nineSlice.bottom < asset.height && asset.nineSlice.minimumWidth >= asset.nineSlice.left + asset.nineSlice.right && asset.nineSlice.minimumHeight >= asset.nineSlice.top + asset.nineSlice.bottom, `${id} nine-slice caps/minimums are invalid`);
      assert(asset.frameCount === 1 && asset.width <= 1024 && asset.height <= 1024, `${id} must be one bounded reviewable nine-slice source frame`);
      nineSliceMeasurement = renderNineSliceMeasurement(decoded, asset.nineSlice);
    } else assert(asset.nineSlice === null, `${id} invents a non-UI nine-slice contract`);
    assetAnalyses.push({ id, role, frameHeight: asset.frameHeight, analysis });
    totalBytes += bytes.length;
    contentManifest.push({ path: file, blob: git(['rev-parse', `HEAD:${file}`]), bytes: bytes.length, sha256: `sha256:${digest}` });
  }
  const catIdentity = representativeIdentityMeasurement('CAT_IDENTITY_AND_PROPORTION', assetAnalyses.filter(asset => asset.role.startsWith('CAT_')));
  const enemyIdentity = representativeIdentityMeasurement('ENEMY_IDENTITY_AND_PROPORTION', assetAnalyses.filter(asset => asset.role.startsWith('ENEMY_')));
  assert(catIdentity.normalizedVisibleHeightRatio <= 1.5 && catIdentity.maximumMeanColourDistance <= 110 && enemyIdentity.normalizedVisibleHeightRatio <= 1.6 && enemyIdentity.maximumMeanColourDistance <= 120, 'representative cross-sheet identity/proportion metrics are outside the reviewed bounds');
  assert(nineSliceMeasurement?.capsPreserved === true && new Set(nineSliceMeasurement.targets.map(target => target.sha256)).size === 2, 'representative nine-slice did not produce two distinct cap-preserving stretch renders');
  const representativeMeasurements = {
    schemaVersion: 1,
    assets: assetAnalyses.map(asset => ({ id: asset.id, role: asset.role, ...publicRepresentativeFrameAnalysis(asset.analysis) })),
    identityGroups: [catIdentity, enemyIdentity],
    nineSlice: { assetId: 'UI-PANEL-9SLICE', ...nineSliceMeasurement }
  };
  const manifestBytes = bytesAt('HEAD', s02RepresentativeManifestPath);
  totalBytes += manifestBytes.length;
  contentManifest.unshift({ path: s02RepresentativeManifestPath, blob: git(['rev-parse', `HEAD:${s02RepresentativeManifestPath}`]), bytes: manifestBytes.length, sha256: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}` });
  assert(manifest.totalBytes === totalBytes && totalBytes <= 32 * 1024 * 1024, 'representative asset aggregate budget mismatch or overflow');
  const contentCommit = firstAddCommit(s02RepresentativeManifestPath);
  assert(contentCommit && git(['rev-parse', `${contentCommit}^`]) === s02ApprovedAssetSource.openingCommit, 'representative asset content must be one exact commit after its approval control');
  assertExactChangedPaths(s02ApprovedAssetSource.openingCommit, contentCommit, [s02RepresentativeManifestPath, ...s02RepresentativeAssetPaths], 'representative asset content commit');
  for (const file of [s02RepresentativeManifestPath, ...s02RepresentativeAssetPaths]) assert(firstAddCommit(file) === contentCommit && git(['log', '--format=%H', '--', file]).split('\n').filter(Boolean).length === 1, `representative asset content is not immutable after one exact addition: ${file}`);
  const expectedFindings = [
    { id: 'S02-P2-ASSET-IDENTITY-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-ASSET-ANIMATION-ANCHOR-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-ASSET-NINE-SLICE-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-ASSET-SEPARABILITY-001', severity: 'P1', resolved: true }
  ];
  const expectedChecks = ['IDENTITY_AND_PROPORTION', 'ANIMATION_FRAME_AND_ANCHOR', 'EFFECT_SEPARATION', 'NINE_SLICE_STRETCH', 'FORMAT_DIMENSION_AND_BUDGET', 'TEXT_FREE_AND_RUNTIME_SEPARABLE'].map(id => ({ id, status: 'PASS' }));
  const representativeMeasurementsSha256 = `sha256:${sha256Canonical(representativeMeasurements)}`;
  assert(exists(s02RepresentativeEvidencePaths.critic), 'representative asset content exists without its independent critic');
  const critic = json(s02RepresentativeEvidencePaths.critic);
  assertExactKeySet(critic, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'approvedSource', 'contentManifest', 'measurements', 'checks', 'findings', 'unresolved', 'verdict', 'maximumVerdict'], 'representative asset critic');
  assertExactKeySet(critic.auditTarget, ['commit', 'tree'], 'representative asset critic target');
  assertExactKeySet(critic.unresolved, ['P0', 'P1'], 'representative asset critic unresolved');
  assert(critic.schemaVersion === 1 && critic.artifactId === 'cats-tower-s02-p2-representative-asset-independent-critic-round-001' && critic.repository === '2hg7trp7rv-design/cats_tower' && critic.branch === 'kimi' && critic.changeControl === s02ApprovedAssetSource.controlPath && JSON.stringify(critic.auditTarget) === JSON.stringify({ commit: contentCommit, tree: git(['rev-parse', `${contentCommit}^{tree}`]) }) && JSON.stringify(critic.approvedSource) === JSON.stringify(expectedApprovedSource) && JSON.stringify(critic.contentManifest) === JSON.stringify(contentManifest) && JSON.stringify(critic.measurements) === JSON.stringify(representativeMeasurements), 'representative critic identity, target, approval, content or decoded measurements binding mismatch');
  assert(JSON.stringify(critic.checks) === JSON.stringify(expectedChecks) && JSON.stringify(critic.findings) === JSON.stringify(expectedFindings) && JSON.stringify(critic.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && critic.verdict === 'PASS_S02_P2_REPRESENTATIVE_ASSET_INDEPENDENT_CRITIC' && critic.maximumVerdict === 'READY_FOR_S02_P2_REPRESENTATIVE_ASSET_FINAL_JUDGE', 'representative asset critic did not close exact P0/P1 scope');
  const criticCommit = firstAddCommit(s02RepresentativeEvidencePaths.critic);
  assert(criticCommit && git(['rev-parse', `${criticCommit}^`]) === contentCommit, 'representative critic must immediately follow exact asset content');
  assertExactChangedPaths(contentCommit, criticCommit, [s02RepresentativeEvidencePaths.critic], 'representative asset critic commit');
  assertAddedOnceAndUnchanged(s02RepresentativeEvidencePaths.critic, criticCommit);
  assert(exists(s02RepresentativeEvidencePaths.finalJudge), 'representative critic exists without final judge');
  const judge = json(s02RepresentativeEvidencePaths.finalJudge);
  assertExactKeySet(judge, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'target', 'critic', 'measurementsSha256', 'checks', 'findings', 'unresolved', 'verdict', 'maximumVerdict'], 'representative asset final judge');
  assertExactKeySet(judge.target, ['commit', 'tree'], 'representative judge target');
  assertExactKeySet(judge.critic, ['path', 'blob'], 'representative judge critic binding');
  assertExactKeySet(judge.unresolved, ['P0', 'P1'], 'representative judge unresolved');
  assert(judge.schemaVersion === 1 && judge.artifactId === 'cats-tower-s02-p2-representative-asset-final-judge-round-001' && judge.repository === critic.repository && judge.branch === critic.branch && judge.changeControl === critic.changeControl && JSON.stringify(judge.target) === JSON.stringify(critic.auditTarget) && JSON.stringify(judge.critic) === JSON.stringify({ path: s02RepresentativeEvidencePaths.critic, blob: git(['rev-parse', `HEAD:${s02RepresentativeEvidencePaths.critic}`]) }) && judge.measurementsSha256 === representativeMeasurementsSha256 && JSON.stringify(judge.checks) === JSON.stringify(expectedChecks) && JSON.stringify(judge.findings) === JSON.stringify(expectedFindings) && JSON.stringify(judge.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && judge.verdict === 'PASS_S02_P2_REPRESENTATIVE_ASSET_FINAL_JUDGE' && judge.maximumVerdict === 'READY_FOR_S02_P2_REPRESENTATIVE_ASSET_COMPLETION', 'representative final judge mismatch or overclaim');
  const judgeCommit = firstAddCommit(s02RepresentativeEvidencePaths.finalJudge);
  assert(judgeCommit && git(['rev-parse', `${judgeCommit}^`]) === criticCommit, 'representative final judge must immediately follow critic');
  assertExactChangedPaths(criticCommit, judgeCommit, [s02RepresentativeEvidencePaths.finalJudge], 'representative asset final-judge commit');
  assertAddedOnceAndUnchanged(s02RepresentativeEvidencePaths.finalJudge, judgeCommit);
  assert(exists(s02RepresentativeEvidencePaths.completion), 'representative final judge exists without completion');
  const completion = json(s02RepresentativeEvidencePaths.completion);
  assertExactKeySet(completion, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'finalJudge', 'manifest', 'measurementsSha256', 'verdict', 'unresolved', 'boundaries', 'maximumVerdict'], 'representative asset completion');
  assertExactKeySet(completion.verifiedContent, ['commit', 'tree'], 'representative completion content');
  assertExactKeySet(completion.finalJudge, ['path', 'blob'], 'representative completion judge');
  assertExactKeySet(completion.manifest, ['path', 'blob', 'sha256'], 'representative completion manifest');
  assertExactKeySet(completion.unresolved, ['P0', 'P1'], 'representative completion unresolved');
  assert(completion.schemaVersion === 1 && completion.artifactId === 'cats-tower-s02-p2-representative-asset-completion-round-001' && completion.repository === critic.repository && completion.branch === critic.branch && completion.changeControl === critic.changeControl && JSON.stringify(completion.verifiedContent) === JSON.stringify(critic.auditTarget) && JSON.stringify(completion.finalJudge) === JSON.stringify({ path: s02RepresentativeEvidencePaths.finalJudge, blob: git(['rev-parse', `HEAD:${s02RepresentativeEvidencePaths.finalJudge}`]) }) && JSON.stringify(completion.manifest) === JSON.stringify({ path: s02RepresentativeManifestPath, blob: git(['rev-parse', `HEAD:${s02RepresentativeManifestPath}`]), sha256: contentManifest[0].sha256 }) && completion.measurementsSha256 === representativeMeasurementsSha256, 'representative completion target/evidence/measurement binding mismatch');
  assert(JSON.stringify(completion.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && JSON.stringify(completion.boundaries) === JSON.stringify(manifest.boundaries) && completion.verdict === 'PASS_S02_P2_REPRESENTATIVE_ASSET' && completion.maximumVerdict === 'READY_FOR_S02_P2_REPRESENTATIVE_ASSET_PASS_ACTIVATION', 'representative completion verdict or boundary mismatch');
  const completionCommit = firstAddCommit(s02RepresentativeEvidencePaths.completion);
  assert(completionCommit && git(['rev-parse', `${completionCommit}^`]) === judgeCommit, 'representative completion must immediately follow final judge');
  assertExactChangedPaths(judgeCommit, completionCommit, [s02RepresentativeEvidencePaths.completion], 'representative asset completion commit');
  assertAddedOnceAndUnchanged(s02RepresentativeEvidencePaths.completion, completionCommit);
  assert(s02AssetPassControl, 'representative completion exists without exact round 042 PASS_ASSET activation');
  assertExactKeySet(s02AssetPassControl, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'approvedSource', 'evidence', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], 'round 042 control');
  assertExactKeySet(s02AssetPassControl.entry, ['head', 'tree'], 'round 042 entry');
  assertExactKeySet(s02AssetPassControl.evidence, ['manifest', 'critic', 'finalJudge', 'completion'], 'round 042 evidence');
  for (const binding of Object.values(s02AssetPassControl.evidence)) assertExactKeySet(binding, ['path', 'blob'], 'round 042 evidence binding');
  assertExactKeySet(s02AssetPassControl.completionBoundary, ['representativeAssetPass', 'assetVolumeAllowed', 'runtimeIntegrationAllowed', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified', 'maximumVerdict'], 'round 042 completion boundary');
  const expectedEvidence = {
    manifest: { path: s02RepresentativeManifestPath, blob: git(['rev-parse', `HEAD:${s02RepresentativeManifestPath}`]) },
    critic: { path: s02RepresentativeEvidencePaths.critic, blob: git(['rev-parse', `HEAD:${s02RepresentativeEvidencePaths.critic}`]) },
    finalJudge: { path: s02RepresentativeEvidencePaths.finalJudge, blob: git(['rev-parse', `HEAD:${s02RepresentativeEvidencePaths.finalJudge}`]) },
    completion: { path: s02RepresentativeEvidencePaths.completion, blob: git(['rev-parse', `HEAD:${s02RepresentativeEvidencePaths.completion}`]) }
  };
  assert(s02AssetPassControl.schemaVersion === 1 && s02AssetPassControl.artifactId === 'cats-tower-active-change-control-addendum-round-042' && isCanonicalIsoDate(s02AssetPassControl.createdAt) && s02AssetPassControl.repository === '2hg7trp7rv-design/cats_tower' && s02AssetPassControl.branch === 'kimi' && s02AssetPassControl.parentChangeControl === s02ApprovedAssetSource.controlPath && JSON.stringify(s02AssetPassControl.entry) === JSON.stringify({ head: completionCommit, tree: git(['rev-parse', `${completionCommit}^{tree}`]) }) && JSON.stringify(s02AssetPassControl.approvedSource) === JSON.stringify(expectedApprovedSource) && JSON.stringify(s02AssetPassControl.evidence) === JSON.stringify(expectedEvidence), 'round 042 identity, parent, entry, approval or evidence mismatch');
  assert(s02AssetPassControl.status === 'PASS_ASSET' && s02AssetPassControl.verdict === 'PASS_S02_P2_REPRESENTATIVE_ASSET' && s02AssetPassControl.currentRepositoryStep === 4 && s02AssetPassControl.internalPhase === 'S02-P2-ASSET-PRODUCTION' && s02AssetPassControl.internalPhaseIsRepositoryStep === false && s02AssetPassControl.scope === 'S02_P2_REPRESENTATIVE_ASSET_PASS_ONLY_NO_VOLUME_NO_RUNTIME', 'round 042 phase/scope/verdict mismatch');
  const round042Forbidden = [...new Set([...expectedS02P2ForbiddenWrites, ...expectedS02P2AllowedWrites])].filter(file => !expectedS02AssetPassGovernanceExtensionWrites.includes(file));
  assert(JSON.stringify(s02AssetPassControl.allowedWrites) === JSON.stringify(expectedS02AssetPassGovernanceExtensionWrites) && JSON.stringify(s02AssetPassControl.forbiddenWrites) === JSON.stringify(round042Forbidden) && JSON.stringify(s02AssetPassControl.completionBoundary) === JSON.stringify({ representativeAssetPass: true, assetVolumeAllowed: false, runtimeIntegrationAllowed: false, step4Pass: false, step5Allowed: false, productionAllowed: false, productionAliasChanged: false, physicalIPhoneVerified: false, maximumVerdict: 'PASS_ASSET' }), 'round 042 write or completion boundary is unsafe');
  const openingCommit = s02AssetPassOpeningCommit;
  assertExactSingleParent(openingCommit, completionCommit, 'round 042 PASS_ASSET activation');
  assertExactChangedPaths(completionCommit, openingCommit, expectedS02AssetPassOpeningWrites, 'round 042 atomic PASS_ASSET activation');
  assertAddedOnceAndUnchanged(s02AssetPassControlPath, openingCommit);
  assertExactPhaseDocumentTransforms(openingCommit, expectedRound042DocumentText, 'round 042 current documents');
  const round042FreezeEnd = s02AssetVolumeScopeOpeningCommit ? git(['rev-parse', `${s02AssetVolumeScopeOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
  assertRegularBoundedHistory(openingCommit, round042FreezeEnd, s02AssetPassControl, 'round 042 frozen PASS_ASSET state', 1024, 1024, 16, 1024, 4);
  return { contentCommit, criticCommit, judgeCommit, completionCommit, openingCommit };
}
const s02RepresentativeAssetPass = verifyS02RepresentativeAssetPass();
function sha256FileAt(commit, file) {
  return `sha256:${createHash('sha256').update(bytesAt(commit, file)).digest('hex')}`;
}
function exactPathBindingAt(commit, file, includeSha256 = false) {
  const binding = { path: file, blob: git(['rev-parse', `${commit}:${file}`]) };
  if (includeSha256) binding.sha256 = sha256FileAt(commit, file);
  return binding;
}
function assertSortedUniqueStrings(values, label, minimum = 1, maximum = 512) {
  assert(Array.isArray(values) && values.length >= minimum && values.length <= maximum && values.every(value => typeof value === 'string' && value.length >= 1), `${label}: string list is missing or outside bounds`);
  assert(JSON.stringify(values) === JSON.stringify([...new Set(values)].sort()), `${label}: strings are not exact sorted unique values`);
}
function assertSafeS02VolumePath(file, area, label) {
  assert(typeof file === 'string' && file === file.normalize('NFC') && /^[\x20-\x7E]+$/.test(file) && !file.includes('\\') && !file.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.')), `${label}: path is not canonical ASCII relative content`);
  const prefix = `step4/s02/asset-production-p2/volume-round-001/${area}/`;
  assert(file.startsWith(prefix) && /^step4\/s02\/asset-production-p2\/volume-round-001\/(?:source|delivery)\/[A-Za-z0-9][A-Za-z0-9_./-]*\.png$/.test(file), `${label}: path escapes the exact ${area} asset root or uses an unreviewed format`);
  assert(!s02RepresentativeAssetPaths.includes(file) && file !== s02RepresentativeManifestPath && !file.startsWith('step4/s02/golden-master-p1/'), `${label}: path overlaps representative or Golden Master content`);
}
function expectedAssetVolumeBatchEvidencePaths(batchId) {
  const prefix = `${s02AssetVolumeReviewRoot}/asset-volume-${batchId}`;
  return [
    `${prefix}-generation-provenance-round-001.json`,
    `${prefix}-manual-correction-log-round-001.json`,
    `${prefix}-export-lineage-round-001.json`,
    `${prefix}-manifest-round-001.json`,
    `${prefix}-measurements-round-001.json`,
    `${prefix}-feasibility-audit-round-001.json`,
    `${prefix}-independent-critic-round-001.json`,
    `${prefix}-final-judge-round-001.json`,
    `${prefix}-completion-evidence-round-001.json`
  ];
}
const s02AssetVolumeScopeCriterionIds = [
  'FINITE_EXACT_PATHS', 'SOURCE_DELIVERY_SEPARATION', 'FOUR_CATS_AND_ENEMY_MODELS',
  'BATCH_AND_EVIDENCE_COVERAGE', 'BYTE_BUDGET', 'FRAME_ANCHOR_GEOMETRY',
  'NINE_SLICE_CONTRACT', 'EXPORT_LINEAGE', 'DATA_CONSUMER_MAPPING',
  'NO_TEXT_BAKED_IN', 'NO_RUNTIME_AUTHORIZATION', 'RELEASE_BOUNDARIES'
];
const s02AssetVolumeScopeResolvedFindings = [
  { id: 'S02-P2-VOLUME-SCOPE-PATH-001', severity: 'P1', resolved: true },
  { id: 'S02-P2-VOLUME-SCOPE-SOURCE-001', severity: 'P1', resolved: true },
  { id: 'S02-P2-VOLUME-SCOPE-BATCH-001', severity: 'P1', resolved: true },
  { id: 'S02-P2-VOLUME-SCOPE-BUDGET-001', severity: 'P1', resolved: true },
  { id: 'S02-P2-VOLUME-SCOPE-RUNTIME-001', severity: 'P1', resolved: true }
];
function verifyS02AssetVolumeScopeContract(contract, contractCommit, expectedApprovedRepresentative) {
  assertExactKeySet(contract, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'changeControl', 'governanceActivation', 'approvedRepresentative', 'scope', 'sourceAssets', 'deliveryAssets', 'productionBatches', 'budgets', 'acceptance', 'boundaries', 'unresolved', 'verdict', 'maximumVerdict'], 'round 043 asset-volume scope contract');
  assertExactKeySet(contract.changeControl, ['path', 'blob'], 'round 043 contract control binding');
  assertExactKeySet(contract.governanceActivation, ['path', 'blob'], 'round 043 contract activation binding');
  assertExactKeySet(contract.budgets, ['sourceBytes', 'deliveryBytes', 'totalBytes', 'maximumRepositoryBytes'], 'round 043 contract budgets');
  assertExactKeySet(contract.acceptance, ['internalP0', 'internalP1', 'decodedDimensions', 'exactDigests', 'animationContinuity', 'anchorGeometry', 'nineSliceStretch', 'crossAssetIdentity', 'sourceDeliveryLineage', 'budgetAudit', 'dataConsumerMapping', 'independentCritic', 'finalJudge'], 'round 043 contract acceptance');
  assertExactKeySet(contract.boundaries, ['scopeContractOnly', 'assetBytesAuthorized', 'assetVolumeAllowed', 'runtimeIntegrationAllowed', 'gameDataMutationAllowed', 'economyMutationAllowed', 'saveSchemaMutationAllowed', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified'], 'round 043 contract boundaries');
  assertExactKeySet(contract.unresolved, ['P0', 'P1'], 'round 043 contract unresolved');
  assert(contract.schemaVersion === 1 && contract.artifactId === 'cats-tower-s02-p2-asset-volume-scope-contract-round-001' && isCanonicalIsoDate(contract.createdAt) && contract.repository === '2hg7trp7rv-design/cats_tower' && contract.branch === 'kimi', 'round 043 contract identity mismatch');
  assert(JSON.stringify(contract.changeControl) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeControlPath)) && JSON.stringify(contract.governanceActivation) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeLockPath)) && JSON.stringify(contract.approvedRepresentative) === JSON.stringify(expectedApprovedRepresentative), 'round 043 contract authority or representative binding mismatch');
  assert(contract.scope === 'S02_P2_ASSET_VOLUME_SCOPE_CONTRACT_ONLY_NO_ASSET_BYTES_NO_RUNTIME' && contract.verdict === 'IN_PROGRESS_S02_P2_VOLUME_SCOPE_CONTRACT' && contract.maximumVerdict === 'READY_FOR_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION_ACTIVATION' && JSON.stringify(contract.unresolved) === JSON.stringify({ P0: 0, P1: 0 }), 'round 043 contract scope or verdict overclaims');
  assert(JSON.stringify(contract.acceptance) === JSON.stringify({ internalP0: 0, internalP1: 0, decodedDimensions: true, exactDigests: true, animationContinuity: true, anchorGeometry: true, nineSliceStretch: true, crossAssetIdentity: true, sourceDeliveryLineage: true, budgetAudit: true, dataConsumerMapping: true, independentCritic: true, finalJudge: true }), 'round 043 acceptance contract differs from the exact production gate');
  assert(JSON.stringify(contract.boundaries) === JSON.stringify({ scopeContractOnly: true, assetBytesAuthorized: false, assetVolumeAllowed: false, runtimeIntegrationAllowed: false, gameDataMutationAllowed: false, economyMutationAllowed: false, saveSchemaMutationAllowed: false, step4Pass: false, step5Allowed: false, productionAllowed: false, productionAliasChanged: false, physicalIPhoneVerified: false }), 'round 043 contract crosses an asset, runtime, release or device boundary');
  assert(Array.isArray(contract.sourceAssets) && contract.sourceAssets.length >= 5 && contract.sourceAssets.length <= 128 && Array.isArray(contract.deliveryAssets) && contract.deliveryAssets.length >= 5 && contract.deliveryAssets.length <= 256, 'round 043 source/delivery asset inventory is missing or outside reviewed bounds');
  const sourceIds = []; const sourcePaths = []; const sourceById = new Map(); let sourceBudget = 0;
  const representativeAssetIds = new Set(json(s02RepresentativeManifestPath).assets.map(asset => asset.id));
  for (const asset of contract.sourceAssets) {
    assertExactKeySet(asset, ['id', 'path', 'role', 'subjectId', 'format', 'width', 'height', 'alphaRequired', 'maxBytes', 'components', 'representativeAssetIds', 'requiredForDeliveryIds', 'textBakedIn'], `round 043 source asset ${asset.id ?? '<missing>'}`);
    assert(typeof asset.id === 'string' && /^[A-Z][A-Z0-9_-]{2,63}$/.test(asset.id) && ['CHARACTER_MODEL_SHEET', 'CHARACTER_LAYER_PLATE', 'ENEMY_MODEL_SHEET', 'ENEMY_LAYER_PLATE', 'BACKGROUND_MASTER', 'UI_MASTER', 'EFFECT_MASTER', 'ICON_MASTER'].includes(asset.role) && /^[A-Z][A-Z0-9_-]{1,63}$/.test(asset.subjectId ?? ''), `round 043 source identity or role invalid: ${asset.id}`);
    assertSafeS02VolumePath(asset.path, 'source', `round 043 source asset ${asset.id}`);
    assert(asset.format === 'PNG' && asset.path.endsWith('.png'), `round 043 source format/path mismatch: ${asset.id}`);
    assert(Number.isSafeInteger(asset.width) && Number.isSafeInteger(asset.height) && asset.width >= 64 && asset.width <= 8192 && asset.height >= 64 && asset.height <= 8192 && typeof asset.alphaRequired === 'boolean' && Number.isSafeInteger(asset.maxBytes) && asset.maxBytes >= 1024 && asset.maxBytes <= 16 * 1024 * 1024 && asset.textBakedIn === false, `round 043 source dimensions, byte cap or text policy invalid: ${asset.id}`);
    assertSortedUniqueStrings(asset.components, `round 043 source components ${asset.id}`, 1, 16);
    assert(asset.components.every(component => ['FRONT', 'SIDE', 'BACK', 'EQUIPMENT', 'FACE', 'BODY_PROPORTION', 'FOOT_ANCHOR', 'COLLISION_BOUNDS', 'VISIBLE_BOUNDS', 'BACKGROUND_DEPTH', 'NINE_SLICE_CAPS', 'EFFECT_SEPARATION', 'ICON_SILHOUETTE'].includes(component)), `round 043 source asset has an unreviewed component: ${asset.id}`);
    assertSortedUniqueStrings(asset.representativeAssetIds, `round 043 source representative lineage ${asset.id}`, 1, 6);
    assert(asset.representativeAssetIds.every(id => representativeAssetIds.has(id)), `round 043 source asset cites an unknown representative asset: ${asset.id}`);
    assertSortedUniqueStrings(asset.requiredForDeliveryIds, `round 043 source delivery coverage ${asset.id}`, 1, 256);
    sourceIds.push(asset.id); sourcePaths.push(asset.path); sourceById.set(asset.id, asset); sourceBudget += asset.maxBytes;
  }
  assertSortedUniqueStrings(sourceIds, 'round 043 source asset IDs', 5, 128);
  assertSortedUniqueStrings(sourcePaths, 'round 043 source asset paths', 5, 128);
  const caseFoldedSourcePaths = sourcePaths.map(file => file.toLowerCase());
  assert(new Set(caseFoldedSourcePaths).size === caseFoldedSourcePaths.length, 'round 043 source paths have a case-fold collision');
  const deliveryIds = []; const deliveryPaths = []; const deliveryById = new Map(); let deliveryBudget = 0;
  const consumerVocabulary = new Set(['ALLY_VISUAL', 'ENEMY_VISUAL', 'BATTLE_BACKGROUND', 'BATTLE_EFFECT', 'UI_SKIN', 'PARTY_CARD', 'REWARD_FEEDBACK', 'FLOOR_TRANSITION']);
  for (const asset of contract.deliveryAssets) {
    assertExactKeySet(asset, ['id', 'path', 'role', 'subjectId', 'format', 'width', 'height', 'alphaRequired', 'maxBytes', 'sourceAssetIds', 'exportRecipe', 'frames', 'anchors', 'nineSlice', 'dataConsumers', 'textBakedIn', 'runtimeUseAuthorized'], `round 043 delivery asset ${asset.id ?? '<missing>'}`);
    assert(typeof asset.id === 'string' && /^[A-Z][A-Z0-9_-]{2,63}$/.test(asset.id) && ['CHARACTER_MODEL_SHEET', 'CHARACTER_ANIMATION', 'ENEMY_MODEL_SHEET', 'ENEMY_ANIMATION', 'BACKGROUND_LAYER', 'UI_NINE_SLICE', 'EFFECT', 'ICON'].includes(asset.role) && /^[A-Z][A-Z0-9_-]{1,63}$/.test(asset.subjectId ?? ''), `round 043 delivery identity or role invalid: ${asset.id}`);
    assertSafeS02VolumePath(asset.path, 'delivery', `round 043 delivery asset ${asset.id}`);
    assert(asset.format === 'PNG' && asset.path.endsWith('.png'), `round 043 delivery format/path mismatch: ${asset.id}`);
    assert(Number.isSafeInteger(asset.width) && Number.isSafeInteger(asset.height) && asset.width >= 16 && asset.width <= 8192 && asset.height >= 16 && asset.height <= 8192 && typeof asset.alphaRequired === 'boolean' && Number.isSafeInteger(asset.maxBytes) && asset.maxBytes >= 256 && asset.maxBytes <= 8 * 1024 * 1024 && asset.textBakedIn === false && asset.runtimeUseAuthorized === false, `round 043 delivery dimensions, byte cap, text or runtime policy invalid: ${asset.id}`);
    assertSortedUniqueStrings(asset.sourceAssetIds, `round 043 delivery source lineage ${asset.id}`, 1, 32);
    assert(asset.sourceAssetIds.every(id => sourceById.has(id)), `round 043 delivery asset cites an unknown source: ${asset.id}`);
    assertExactKeySet(asset.exportRecipe, ['method', 'scale', 'trimTransparent', 'lossless', 'effectsSeparated'], `round 043 export recipe ${asset.id}`);
    assert(asset.exportRecipe.method === 'MANUAL_EXPORT_FROM_APPROVED_SOURCE' && Number.isFinite(asset.exportRecipe.scale) && asset.exportRecipe.scale >= 0.25 && asset.exportRecipe.scale <= 4 && typeof asset.exportRecipe.trimTransparent === 'boolean' && typeof asset.exportRecipe.lossless === 'boolean' && typeof asset.exportRecipe.effectsSeparated === 'boolean', `round 043 export recipe invalid: ${asset.id}`);
    assert(Array.isArray(asset.frames) && asset.frames.length >= 1 && asset.frames.length <= 128 && Array.isArray(asset.anchors) && asset.anchors.length <= 512, `round 043 frame/anchor inventory invalid: ${asset.id}`);
    const frameIds = new Set();
    for (const frame of asset.frames) {
      assertExactKeySet(frame, ['id', 'sourceRect', 'visibleBounds', 'durationMs', 'state', 'direction'], `round 043 frame ${asset.id}/${frame.id ?? '<missing>'}`);
      assert(typeof frame.id === 'string' && /^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(frame.id) && !frameIds.has(frame.id), `round 043 frame ID invalid or duplicate: ${asset.id}/${frame.id}`);
      frameIds.add(frame.id);
      for (const [rectName, rect] of [['sourceRect', frame.sourceRect], ['visibleBounds', frame.visibleBounds]]) {
        assertExactKeySet(rect, ['x', 'y', 'width', 'height'], `round 043 ${rectName} ${asset.id}/${frame.id}`);
        assert(Object.values(rect).every(Number.isSafeInteger) && rect.x >= 0 && rect.y >= 0 && rect.width >= 1 && rect.height >= 1 && rect.x + rect.width <= asset.width && rect.y + rect.height <= asset.height, `round 043 ${rectName} exceeds delivery asset: ${asset.id}/${frame.id}`);
      }
      assert(frame.visibleBounds.x >= frame.sourceRect.x && frame.visibleBounds.y >= frame.sourceRect.y && frame.visibleBounds.x + frame.visibleBounds.width <= frame.sourceRect.x + frame.sourceRect.width && frame.visibleBounds.y + frame.visibleBounds.height <= frame.sourceRect.y + frame.sourceRect.height, `round 043 visible bounds escape their frame source rectangle: ${asset.id}/${frame.id}`);
      assert(Number.isSafeInteger(frame.durationMs) && frame.durationMs >= 16 && frame.durationMs <= 5000 && ['IDLE', 'WALK', 'ATTACK_ANTICIPATION', 'ATTACK', 'PROJECTILE', 'HIT', 'DEFEAT', 'REWARD_REACTION', 'VICTORY', 'STATIC'].includes(frame.state) && ['FRONT', 'SIDE_LEFT', 'SIDE_RIGHT', 'BACK', 'NONE'].includes(frame.direction), `round 043 frame timing/state/direction invalid: ${asset.id}/${frame.id}`);
    }
    for (const anchor of asset.anchors) {
      assertExactKeySet(anchor, ['frameId', 'type', 'x', 'y'], `round 043 anchor ${asset.id}`);
      const frame = asset.frames.find(candidate => candidate.id === anchor.frameId);
      assert(frame && ['FOOT', 'PROJECTILE_ORIGIN', 'HIT_CENTER', 'COLLISION_CENTER'].includes(anchor.type) && Number.isSafeInteger(anchor.x) && Number.isSafeInteger(anchor.y) && anchor.x >= 0 && anchor.x <= frame.sourceRect.width && anchor.y >= 0 && anchor.y <= frame.sourceRect.height, `round 043 anchor invalid or outside frame: ${asset.id}/${anchor.frameId}`);
    }
    if (/^(?:CHARACTER|ENEMY)_/.test(asset.role)) assert(asset.frames.every(frame => asset.anchors.some(anchor => anchor.frameId === frame.id && anchor.type === 'FOOT')), `round 043 combat delivery frame lacks its foot anchor: ${asset.id}`);
    else assert(asset.anchors.length === 0, `round 043 noncombat delivery asset carries an ambiguous combat anchor: ${asset.id}`);
    if (asset.nineSlice === null) assert(asset.role !== 'UI_NINE_SLICE', `round 043 UI nine-slice lacks cap contract: ${asset.id}`);
    else {
      assertExactKeySet(asset.nineSlice, ['left', 'top', 'right', 'bottom', 'minimumWidth', 'minimumHeight'], `round 043 nine-slice ${asset.id}`);
      assert(asset.role === 'UI_NINE_SLICE' && Object.values(asset.nineSlice).every(Number.isSafeInteger) && asset.nineSlice.left > 0 && asset.nineSlice.top > 0 && asset.nineSlice.right > 0 && asset.nineSlice.bottom > 0 && asset.nineSlice.left + asset.nineSlice.right < asset.width && asset.nineSlice.top + asset.nineSlice.bottom < asset.height && asset.nineSlice.minimumWidth >= asset.nineSlice.left + asset.nineSlice.right && asset.nineSlice.minimumHeight >= asset.nineSlice.top + asset.nineSlice.bottom, `round 043 nine-slice invalid: ${asset.id}`);
    }
    assertSortedUniqueStrings(asset.dataConsumers, `round 043 data consumers ${asset.id}`, 1, 8);
    assert(asset.dataConsumers.every(consumer => consumerVocabulary.has(consumer)), `round 043 delivery asset has an unreviewed data consumer: ${asset.id}`);
    deliveryIds.push(asset.id); deliveryPaths.push(asset.path); deliveryById.set(asset.id, asset); deliveryBudget += asset.maxBytes;
  }
  assertSortedUniqueStrings(deliveryIds, 'round 043 delivery asset IDs', 5, 256);
  assertSortedUniqueStrings(deliveryPaths, 'round 043 delivery asset paths', 5, 256);
  assert(new Set([...sourceIds, ...deliveryIds]).size === sourceIds.length + deliveryIds.length, 'round 043 source/delivery asset IDs collide across inventory areas');
  const allCaseFoldedPaths = [...sourcePaths, ...deliveryPaths].map(file => file.toLowerCase());
  assert(new Set(allCaseFoldedPaths).size === allCaseFoldedPaths.length, 'round 043 source/delivery paths collide under case folding');
  for (const source of contract.sourceAssets) assert(source.requiredForDeliveryIds.every(id => deliveryById.has(id) && deliveryById.get(id).sourceAssetIds.includes(source.id)), `round 043 source-to-delivery lineage is not bidirectional: ${source.id}`);
  for (const delivery of contract.deliveryAssets) assert(delivery.sourceAssetIds.every(id => sourceById.get(id).requiredForDeliveryIds.includes(delivery.id)), `round 043 delivery-to-source lineage is not bidirectional: ${delivery.id}`);
  const sourceCatSubjects = new Set(contract.sourceAssets.filter(asset => asset.role === 'CHARACTER_MODEL_SHEET' && asset.subjectId.startsWith('CAT-')).map(asset => asset.subjectId));
  const deliveryCatSubjects = new Set(contract.deliveryAssets.filter(asset => ['CHARACTER_MODEL_SHEET', 'CHARACTER_ANIMATION'].includes(asset.role) && asset.subjectId.startsWith('CAT-')).map(asset => asset.subjectId));
  assert(sourceCatSubjects.size === 4 && deliveryCatSubjects.size === 4 && [...sourceCatSubjects].every(id => deliveryCatSubjects.has(id)), 'round 043 contract must preserve exactly four named cat subjects from source through delivery');
  const fullCharacterModelComponents = ['BACK', 'BODY_PROPORTION', 'COLLISION_BOUNDS', 'EQUIPMENT', 'FACE', 'FOOT_ANCHOR', 'FRONT', 'SIDE', 'VISIBLE_BOUNDS'];
  for (const catSubject of sourceCatSubjects) {
    const sheet = contract.sourceAssets.find(asset => asset.role === 'CHARACTER_MODEL_SHEET' && asset.subjectId === catSubject);
    assert(JSON.stringify(sheet.components) === JSON.stringify(fullCharacterModelComponents) && contract.sourceAssets.some(asset => asset.role === 'CHARACTER_LAYER_PLATE' && asset.subjectId === catSubject), `round 043 contract lacks full model-sheet components or separable source layer plate for ${catSubject}`);
  }
  const requiredCatStates = ['ATTACK', 'ATTACK_ANTICIPATION', 'DEFEAT', 'HIT', 'IDLE', 'REWARD_REACTION', 'WALK'];
  for (const catSubject of deliveryCatSubjects) {
    const frames = contract.deliveryAssets.filter(asset => asset.subjectId === catSubject && ['CHARACTER_MODEL_SHEET', 'CHARACTER_ANIMATION'].includes(asset.role)).flatMap(asset => asset.frames);
    const states = [...new Set(frames.map(frame => frame.state))].sort();
    assert(requiredCatStates.every(state => states.includes(state)) && frames.some(frame => ['SIDE_LEFT', 'SIDE_RIGHT'].includes(frame.direction)), `round 043 contract lacks complete auto-battle/reward animation state and side-view coverage for ${catSubject}`);
  }
  const enemySheets = contract.sourceAssets.filter(asset => asset.role === 'ENEMY_MODEL_SHEET' && asset.subjectId.startsWith('ENEMY-'));
  assert(enemySheets.length >= 1 && enemySheets.every(sheet => ['BACK', 'BODY_PROPORTION', 'COLLISION_BOUNDS', 'FOOT_ANCHOR', 'FRONT', 'SIDE', 'VISIBLE_BOUNDS'].every(component => sheet.components.includes(component)) && contract.sourceAssets.some(asset => asset.role === 'ENEMY_LAYER_PLATE' && asset.subjectId === sheet.subjectId)) && contract.deliveryAssets.some(asset => ['ENEMY_MODEL_SHEET', 'ENEMY_ANIMATION'].includes(asset.role) && asset.subjectId.startsWith('ENEMY-')), 'round 043 contract lacks complete separable enemy source/delivery model coverage');
  for (const enemySubject of new Set(enemySheets.map(asset => asset.subjectId))) {
    const frames = contract.deliveryAssets.filter(asset => asset.subjectId === enemySubject && ['ENEMY_MODEL_SHEET', 'ENEMY_ANIMATION'].includes(asset.role)).flatMap(asset => asset.frames);
    const states = new Set(frames.map(frame => frame.state));
    assert(['ATTACK', 'DEFEAT', 'HIT', 'IDLE', 'WALK'].every(state => states.has(state)) && frames.some(frame => ['SIDE_LEFT', 'SIDE_RIGHT'].includes(frame.direction)), `round 043 contract lacks complete enemy battle-state and side-view coverage for ${enemySubject}`);
  }
  assert(Array.isArray(contract.productionBatches) && contract.productionBatches.length >= 2 && contract.productionBatches.length <= 16, 'round 043 contract needs a bounded multi-batch production plan');
  const batchedSource = []; const batchedDelivery = []; const evidencePaths = []; const sourceBatchIndex = new Map(); const deliveryBatchIndex = new Map();
  for (let index = 0; index < contract.productionBatches.length; index += 1) {
    const batch = contract.productionBatches[index]; const batchId = `batch-${String(index + 1).padStart(3, '0')}`;
    assertExactKeySet(batch, ['id', 'sourceAssetIds', 'deliveryAssetIds', 'evidencePaths', 'maxBytes'], `round 043 production batch ${batchId}`);
    assert(batch.id === batchId, `round 043 production batch order/identity mismatch: ${batch.id}`);
    assertSortedUniqueStrings(batch.sourceAssetIds, `round 043 batch source IDs ${batchId}`, 0, 128);
    assertSortedUniqueStrings(batch.deliveryAssetIds, `round 043 batch delivery IDs ${batchId}`, 0, 256);
    assert(batch.sourceAssetIds.length + batch.deliveryAssetIds.length >= 1 && batch.sourceAssetIds.every(id => sourceById.has(id)) && batch.deliveryAssetIds.every(id => deliveryById.has(id)), `round 043 batch cites an unknown or empty asset set: ${batchId}`);
    const expectedEvidencePaths = expectedAssetVolumeBatchEvidencePaths(batchId);
    assert(JSON.stringify(batch.evidencePaths) === JSON.stringify(expectedEvidencePaths), `round 043 batch evidence paths differ from the exact source-provenance plus six-stage review contract: ${batchId}`);
    const expectedMaxBytes = [...batch.sourceAssetIds.map(id => sourceById.get(id).maxBytes), ...batch.deliveryAssetIds.map(id => deliveryById.get(id).maxBytes)].reduce((sum, value) => sum + value, 0);
    assert(Number.isSafeInteger(batch.maxBytes) && batch.maxBytes === expectedMaxBytes && batch.maxBytes <= 64 * 1024 * 1024, `round 043 batch byte budget mismatch or overflow: ${batchId}`);
    for (const id of batch.sourceAssetIds) sourceBatchIndex.set(id, index);
    for (const id of batch.deliveryAssetIds) deliveryBatchIndex.set(id, index);
    batchedSource.push(...batch.sourceAssetIds); batchedDelivery.push(...batch.deliveryAssetIds); evidencePaths.push(...batch.evidencePaths);
  }
  assert(JSON.stringify(batchedSource.sort()) === JSON.stringify(sourceIds) && JSON.stringify(batchedDelivery.sort()) === JSON.stringify(deliveryIds), 'round 043 batches do not partition every source/delivery asset exactly once');
  assert(new Set(evidencePaths).size === evidencePaths.length, 'round 043 batch evidence paths are not globally unique');
  for (const delivery of contract.deliveryAssets) assert(delivery.sourceAssetIds.every(id => sourceBatchIndex.get(id) <= deliveryBatchIndex.get(delivery.id)), `round 043 delivery precedes one of its required source assets: ${delivery.id}`);
  assert(JSON.stringify(contract.budgets) === JSON.stringify({ sourceBytes: sourceBudget, deliveryBytes: deliveryBudget, totalBytes: sourceBudget + deliveryBudget, maximumRepositoryBytes: 512 * 1024 * 1024 }) && sourceBudget + deliveryBudget <= 512 * 1024 * 1024, 'round 043 aggregate source/delivery budget mismatch or overflow');
  const derivedAllowedWrites = [...sourcePaths, ...deliveryPaths, ...evidencePaths];
  assert(new Set(derivedAllowedWrites).size === derivedAllowedWrites.length, 'round 043 contract-derived round 044 allowlist contains duplicate paths');
  return { contractCommit, contractTree: git(['rev-parse', `${contractCommit}^{tree}`]), contractSha256: sha256FileAt('HEAD', s02AssetVolumeContractPath), sourcePaths, deliveryPaths, evidencePaths, derivedAllowedWrites, sourceById, deliveryById };
}

function analyzeS02VolumeRegion(decoded, rect, label) {
  assert(rect && Object.values(rect).every(Number.isSafeInteger) && rect.x >= 0 && rect.y >= 0 && rect.width >= 1 && rect.height >= 1 && rect.x + rect.width <= decoded.width && rect.y + rect.height <= decoded.height, `${label}: analysis rectangle escapes decoded PNG`);
  const hash = createHash('sha256'); const palette = new Set();
  let visiblePixels = 0; let corePixels = 0; let luma = 0; let lumaSquared = 0; let red = 0; let green = 0; let blue = 0;
  let minX = rect.x + rect.width; let minY = rect.y + rect.height; let maxX = -1; let maxY = -1;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) for (let x = rect.x; x < rect.x + rect.width; x += 1) {
    const offset = (y * decoded.width + x) * 4; const pixel = decoded.rgba.subarray(offset, offset + 4); hash.update(pixel);
    if (pixel[3] < s02RepresentativeVisibleAlphaThreshold) continue;
    visiblePixels += 1; if (pixel[3] >= 192) corePixels += 1;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    const premultiplied = [0, 1, 2].map(channel => Math.round(pixel[channel] * pixel[3] / 255));
    red += premultiplied[0]; green += premultiplied[1]; blue += premultiplied[2];
    palette.add(`${premultiplied[0] >> 4}:${premultiplied[1] >> 4}:${premultiplied[2] >> 4}`);
    const pixelLuma = (54 * premultiplied[0] + 183 * premultiplied[1] + 19 * premultiplied[2]) / 256;
    luma += pixelLuma; lumaSquared += pixelLuma * pixelLuma;
  }
  assert(visiblePixels > 0, `${label}: no visible decoded pixels`);
  const meanLuma = luma / visiblePixels;
  return {
    public: {
      sha256: `sha256:${hash.digest('hex')}`,
      visibleBounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      nonTransparentRatio: visiblePixels / (rect.width * rect.height),
      coreAlphaFractionOfVisible: corePixels / visiblePixels,
      visibleQuantizedColorCount: palette.size,
      lumaStdDev: Math.sqrt(Math.max(0, lumaSquared / visiblePixels - meanLuma ** 2)),
      meanRgb: [red / visiblePixels, green / visiblePixels, blue / visiblePixels]
    },
    palette
  };
}
function compareS02VolumeFrameRects(decoded, left, right, label) {
  assert(left.width === right.width && left.height === right.height, `${label}: animation frames must share exact dimensions for decoded continuity measurement`);
  const pixelCount = left.width * left.height; let changedPixels = 0; let totalAbsoluteChannelDelta = 0;
  for (let y = 0; y < left.height; y += 1) for (let x = 0; x < left.width; x += 1) {
    const leftOffset = ((left.y + y) * decoded.width + left.x + x) * 4;
    const rightOffset = ((right.y + y) * decoded.width + right.x + x) * 4;
    let maximumDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(decoded.rgba[leftOffset + channel] - decoded.rgba[rightOffset + channel]);
      maximumDelta = Math.max(maximumDelta, delta); totalAbsoluteChannelDelta += delta;
    }
    if (maximumDelta >= 12) changedPixels += 1;
  }
  return { changedPixelRatio: changedPixels / pixelCount, meanAbsoluteChannelDelta: totalAbsoluteChannelDelta / (pixelCount * 4) };
}
function visualPaletteLineage(leftAnalyses, rightAnalysis) {
  const leftPalette = new Set(leftAnalyses.flatMap(entry => [...entry._palette]));
  const rightPalette = rightAnalysis._palette;
  const overlap = [...rightPalette].filter(colour => leftPalette.has(colour)).length;
  const sourceMean = [0, 1, 2].map(channel => leftAnalyses.reduce((sum, entry) => sum + entry._meanRgb[channel], 0) / leftAnalyses.length);
  return {
    paletteOverlapRatio: overlap / Math.max(1, Math.min(leftPalette.size, rightPalette.size)),
    meanRgbDistance: Math.hypot(...sourceMean.map((value, channel) => value - rightAnalysis._meanRgb[channel]))
  };
}
function analyzeS02VolumeAsset(asset, area, label) {
  assertRegularGitFile(asset.path, label);
  const bytes = bytesAt('HEAD', asset.path);
  assert(bytes.length > 0 && bytes.length <= asset.maxBytes, `${label}: actual bytes exceed the exact contract cap`);
  const decoded = assertDecodedPng(bytes, asset.width, asset.height, label);
  let visiblePixels = 0; let opaquePixels = 0; let transparentPixels = 0;
  for (let offset = 3; offset < decoded.rgba.length; offset += 4) {
    const alpha = decoded.rgba[offset];
    if (alpha >= s02RepresentativeVisibleAlphaThreshold) visiblePixels += 1;
    if (alpha >= 250) opaquePixels += 1;
    if (alpha < s02RepresentativeVisibleAlphaThreshold) transparentPixels += 1;
  }
  assert(visiblePixels >= Math.max(64, Math.floor(asset.width * asset.height * 0.002)) && (!asset.alphaRequired || ([4, 6].includes(decoded.colorType) && transparentPixels >= 1)), `${label}: visible signal or required alpha is missing`);
  const whole = analyzeS02VolumeRegion(decoded, { x: 0, y: 0, width: asset.width, height: asset.height }, `${label} whole asset`);
  assert(whole.public.coreAlphaFractionOfVisible >= 0.35 && whole.public.visibleQuantizedColorCount >= 16 && whole.public.lumaStdDev >= 5 && whole.public.visibleBounds.width >= Math.max(8, Math.floor(asset.width * 0.08)) && whole.public.visibleBounds.height >= Math.max(8, Math.floor(asset.height * 0.08)), `${label}: decoded asset is sparse, translucent-only, flat, low-detail or placeholder-like`);
  const frameVisuals = area === 'delivery' ? asset.frames.map(frame => analyzeS02VolumeRegion(decoded, frame.sourceRect, `${label} frame ${frame.id}`)) : [];
  const frames = frameVisuals.map((visual, index) => {
    const frame = asset.frames[index]; const metrics = visual.public;
    assert(JSON.stringify(metrics.visibleBounds) === JSON.stringify(frame.visibleBounds), `${label}: decoded visible bounds differ from the immutable frame contract: ${frame.id}`);
    const combat = /^(?:CHARACTER|ENEMY)_/.test(asset.role);
    assert(metrics.visibleQuantizedColorCount >= (combat ? 12 : 8) && metrics.lumaStdDev >= (combat ? 4 : 2) && metrics.coreAlphaFractionOfVisible >= (combat ? 0.45 : 0.3) && (!combat || (metrics.nonTransparentRatio >= 0.02 && metrics.nonTransparentRatio <= 0.95 && metrics.visibleBounds.height >= frame.sourceRect.height * 0.3)), `${label}: frame ${frame.id} is sparse, flat, translucent-only or lacks a readable combat silhouette`);
    return { id: frame.id, ...metrics };
  });
  const animationDeltas = [];
  if (area === 'delivery' && /_ANIMATION$/.test(asset.role)) {
    assert(frames.length >= 3 && new Set(frames.map(frame => frame.sha256)).size === frames.length, `${label}: production animation requires at least three unique decoded frames`);
    for (let index = 1; index < asset.frames.length; index += 1) {
      const delta = compareS02VolumeFrameRects(decoded, asset.frames[index - 1].sourceRect, asset.frames[index].sourceRect, `${label} ${asset.frames[index - 1].id}->${asset.frames[index].id}`);
      assert(delta.changedPixelRatio >= 0.002 && delta.changedPixelRatio <= 0.9 && delta.meanAbsoluteChannelDelta >= 0.25 && delta.meanAbsoluteChannelDelta <= 120, `${label}: animation delta is static, discontinuous or implausibly full-frame: ${asset.frames[index - 1].id}->${asset.frames[index].id}`);
      animationDeltas.push({ from: asset.frames[index - 1].id, to: asset.frames[index].id, ...delta });
    }
  }
  if (area === 'delivery' && /^(?:CHARACTER|ENEMY)_/.test(asset.role)) for (const anchor of asset.anchors.filter(entry => entry.type === 'FOOT')) {
    const frame = asset.frames.find(entry => entry.id === anchor.frameId); const bounds = frame.visibleBounds;
    const absoluteX = frame.sourceRect.x + anchor.x; const absoluteY = frame.sourceRect.y + anchor.y;
    assert(absoluteX >= bounds.x - Math.ceil(bounds.width * 0.15) && absoluteX <= bounds.x + bounds.width + Math.ceil(bounds.width * 0.15) && absoluteY >= bounds.y + bounds.height - Math.ceil(bounds.height * 0.25) && absoluteY <= bounds.y + bounds.height + Math.ceil(bounds.height * 0.15), `${label}: foot anchor is not tied to decoded visible feet: ${anchor.frameId}`);
  }
  const nineSlice = area === 'delivery' && asset.nineSlice ? renderNineSliceMeasurement(decoded, asset.nineSlice) : null;
  const result = {
    id: asset.id,
    path: asset.path,
    area,
    role: asset.role,
    subjectId: asset.subjectId,
    format: asset.format,
    width: decoded.width,
    height: decoded.height,
    bytes: bytes.length,
    blob: git(['rev-parse', `HEAD:${asset.path}`]),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    colorType: decoded.colorType,
    alphaStats: { visiblePixels, opaquePixels, transparentPixels },
    visualMetrics: whole.public,
    frames,
    animationDeltas,
    representativeIdentity: null,
    sourceVisualLineage: null,
    nineSlice
  };
  Object.defineProperties(result, {
    _palette: { value: whole.palette, enumerable: false },
    _meanRgb: { value: whole.public.meanRgb, enumerable: false },
    _frameVisuals: { value: frameVisuals, enumerable: false }
  });
  return result;
}

function verifyS02AssetVolumeBatches(handoff) {
  const { openingCommit, contract, contractProof } = handoff;
  const contractBinding = exactPathBindingAt('HEAD', s02AssetVolumeContractPath, true);
  let predecessor = openingCommit;
  let completedBatches = 0;
  const expectedChecks = ['DECODED_FORMAT_DIMENSIONS', 'ALPHA_AND_VISIBLE_BOUNDS', 'FRAME_AND_ANCHOR_GEOMETRY', 'ANIMATION_CONTINUITY', 'REPRESENTATIVE_IDENTITY', 'CROSS_ASSET_IDENTITY', 'SOURCE_DELIVERY_LINEAGE', 'NINE_SLICE_STRETCH', 'TEXT_LAYER_REMOVED', 'BYTE_BUDGET'].map(id => ({ id, status: 'PASS' }));
  const expectedFindings = [
    { id: 'S02-P2-VOLUME-ASSET-PLACEHOLDER-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-VOLUME-ASSET-LINEAGE-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-VOLUME-ASSET-IDENTITY-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-VOLUME-ASSET-ANIMATION-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-VOLUME-ASSET-ANCHOR-001', severity: 'P1', resolved: true },
    { id: 'S02-P2-VOLUME-ASSET-BUDGET-001', severity: 'P1', resolved: true }
  ];
  const allAnalyses = new Map();
  const representativeManifest = json(s02RepresentativeManifestPath);
  const representativeVisuals = new Map(representativeManifest.assets.map(asset => {
    const decoded = assertDecodedPng(bytesAt('HEAD', asset.path), asset.width, asset.height, `round 044 representative identity source ${asset.id}`);
    const visual = analyzeS02VolumeRegion(decoded, { x: 0, y: 0, width: decoded.width, height: decoded.height }, `round 044 representative identity source ${asset.id}`);
    return [asset.id, { _palette: visual.palette, _meanRgb: visual.public.meanRgb }];
  }));
  for (let batchIndex = 0; batchIndex < contract.productionBatches.length; batchIndex += 1) {
    const batch = contract.productionBatches[batchIndex]; const [provenancePath, correctionPath, exportPath, manifestPath, measurementsPath, feasibilityPath, criticPath, judgePath, completionPath] = batch.evidencePaths;
    const sourceAssets = batch.sourceAssetIds.map(id => contractProof.sourceById.get(id));
    const deliveryAssets = batch.deliveryAssetIds.map(id => contractProof.deliveryById.get(id));
    const assetPaths = [...sourceAssets.map(asset => asset.path), ...deliveryAssets.map(asset => asset.path)];
    const anyPresent = [...assetPaths, ...batch.evidencePaths].some(exists);
    if (!anyPresent) {
      assert(![...assetPaths, ...batch.evidencePaths].some(file => firstAddCommit(file)), `round 044 ${batch.id} was added and later removed instead of remaining immutable`);
      const laterPaths = contract.productionBatches.slice(batchIndex + 1).flatMap(candidate => [...candidate.sourceAssetIds.map(id => contractProof.sourceById.get(id).path), ...candidate.deliveryAssetIds.map(id => contractProof.deliveryById.get(id).path), ...candidate.evidencePaths]);
      assert(!laterPaths.some(file => exists(file) || firstAddCommit(file)), `round 044 skips unfinished ${batch.id} and writes or later removes a later batch`);
      return { complete: false, completedBatches, predecessor };
    }
    assert([...assetPaths, ...batch.evidencePaths].every(exists), `round 044 ${batch.id} is partial; assets and nine exact evidence files must arrive as its reviewed chain`);
    const contentCommit = firstAddCommit(manifestPath);
    assertExactSingleParent(contentCommit, predecessor, `round 044 ${batch.id} content`);
    const expectedContentPaths = [...assetPaths, provenancePath, correctionPath, exportPath, manifestPath];
    assertExactChangedPaths(predecessor, contentCommit, expectedContentPaths, `round 044 ${batch.id} content/provenance/manifest`);
    for (const file of expectedContentPaths) assert(firstAddCommit(file) === contentCommit && assertAddedOnceAndUnchanged(file, contentCommit), `round 044 ${batch.id} content is not an immutable first addition: ${file}`);
    const analyses = [...sourceAssets.map(asset => analyzeS02VolumeAsset(asset, 'source', `round 044 ${batch.id} source ${asset.id}`)), ...deliveryAssets.map(asset => analyzeS02VolumeAsset(asset, 'delivery', `round 044 ${batch.id} delivery ${asset.id}`))];
    const analysisById = new Map(analyses.map(entry => [entry.id, entry]));
    for (const analysis of analyses) allAnalyses.set(analysis.id, analysis);
    for (const definition of sourceAssets) {
      const analysis = analysisById.get(definition.id);
      const typedIdentity = /^(?:CHARACTER|ENEMY|UI)_/.test(definition.role);
      if (!typedIdentity) continue;
      const expectedPrefix = definition.role.startsWith('CHARACTER_') ? 'CAT-' : definition.role.startsWith('ENEMY_') ? 'ENEMY-' : 'UI-';
      assert(definition.representativeAssetIds.some(id => id.startsWith(expectedPrefix)), `round 044 ${batch.id} source ${definition.id} cites no role-compatible approved representative asset`);
      const references = definition.representativeAssetIds.map(id => representativeVisuals.get(id));
      const measurement = visualPaletteLineage(references, analysis);
      assert(measurement.paletteOverlapRatio >= 0.05 && measurement.meanRgbDistance <= 200, `round 044 ${batch.id} source ${definition.id} has no measured visual identity continuity with its approved representative lineage`);
      analysis.representativeIdentity = { representativeAssetIds: definition.representativeAssetIds, ...measurement };
    }
    for (const definition of deliveryAssets) {
      const analysis = analysisById.get(definition.id);
      const sources = definition.sourceAssetIds.map(id => allAnalyses.get(id));
      assert(sources.every(Boolean), `round 044 ${batch.id} delivery ${definition.id} lacks an already produced decoded source analysis`);
      const measurement = visualPaletteLineage(sources, analysis);
      assert(measurement.paletteOverlapRatio >= 0.08 && measurement.meanRgbDistance <= 180, `round 044 ${batch.id} delivery ${definition.id} is not measurably visually derived from its declared source assets`);
      analysis.sourceVisualLineage = { sourceAssetIds: definition.sourceAssetIds, ...measurement };
    }
    const boundaries = { runtimeUseAuthorized: false, runtimeIntegrationAllowed: false, gameDataMutationAllowed: false, step4Pass: false, step5Allowed: false, productionAllowed: false, productionAliasChanged: false, physicalIPhoneVerified: false };
    const provenance = json(provenancePath);
    assertExactKeySet(provenance, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'records', 'boundaries'], `round 044 ${batch.id} generation provenance`);
    assert(provenance.schemaVersion === 1 && provenance.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-generation-provenance-round-001` && provenance.repository === '2hg7trp7rv-design/cats_tower' && provenance.branch === 'kimi' && provenance.changeControl === s02AssetVolumeControlPath && JSON.stringify(provenance.contract) === JSON.stringify(contractBinding) && provenance.batch === batch.id && JSON.stringify(provenance.boundaries) === JSON.stringify(boundaries), `round 044 ${batch.id} generation provenance identity or boundary mismatch`);
    assert(Array.isArray(provenance.records) && provenance.records.length === analyses.length, `round 044 ${batch.id} generation provenance coverage mismatch`);
    for (let index = 0; index < analyses.length; index += 1) {
      const record = provenance.records[index]; const analysis = analyses[index]; const definition = contractProof.sourceById.get(analysis.id) ?? contractProof.deliveryById.get(analysis.id);
      assertExactKeySet(record, ['assetId', 'area', 'origin', 'tool', 'model', 'createdAt', 'referenceAssetIds', 'outputSha256'], `round 044 ${batch.id} provenance ${analysis.id}`);
      assert(record.assetId === analysis.id && record.area === analysis.area && ['GENERATED_AND_MANUALLY_CORRECTED', 'MANUALLY_AUTHORED', 'HYBRID'].includes(record.origin) && typeof record.tool === 'string' && /^[A-Za-z0-9 ._+-]{1,80}$/.test(record.tool) && typeof record.model === 'string' && /^[A-Za-z0-9 ._+:/-]{1,120}$/.test(record.model) && isCanonicalIsoInstant(record.createdAt) && record.outputSha256 === analysis.sha256, `round 044 ${batch.id} provenance record is invalid: ${analysis.id}`);
      const expectedReferenceIds = analysis.area === 'source' ? definition.representativeAssetIds : definition.sourceAssetIds;
      assert(JSON.stringify(record.referenceAssetIds) === JSON.stringify(expectedReferenceIds), `round 044 ${batch.id} provenance lineage differs from contract: ${analysis.id}`);
    }
    const corrections = json(correctionPath);
    assertExactKeySet(corrections, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'records', 'boundaries'], `round 044 ${batch.id} correction log`);
    assert(corrections.schemaVersion === 1 && corrections.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-manual-correction-log-round-001` && corrections.repository === provenance.repository && corrections.branch === 'kimi' && corrections.changeControl === s02AssetVolumeControlPath && JSON.stringify(corrections.contract) === JSON.stringify(contractBinding) && corrections.batch === batch.id && JSON.stringify(corrections.boundaries) === JSON.stringify(boundaries) && Array.isArray(corrections.records) && corrections.records.length === analyses.length, `round 044 ${batch.id} correction log identity, boundary or coverage mismatch`);
    for (let index = 0; index < analyses.length; index += 1) {
      const record = corrections.records[index]; const analysis = analyses[index];
      assertExactKeySet(record, ['assetId', 'operations', 'reviewerRole', 'completedAt', 'outputSha256'], `round 044 ${batch.id} correction ${analysis.id}`);
      assertSortedUniqueStrings(record.operations, `round 044 ${batch.id} correction operations ${analysis.id}`, 3, 12);
      assert(record.assetId === analysis.id && record.operations.every(operation => ['ANCHOR_ALIGNMENT', 'ARTIFACT_CLEANUP', 'COLOR_CONSISTENCY', 'EDGE_CLEANUP', 'FRAME_CONTINUITY', 'IDENTITY_CORRECTION', 'NINE_SLICE_CLEANUP', 'TEXT_LAYER_REMOVED'].includes(operation)) && record.operations.includes('ARTIFACT_CLEANUP') && record.operations.includes('COLOR_CONSISTENCY') && record.operations.includes('TEXT_LAYER_REMOVED') && record.reviewerRole === 'S02_P2_ASSET_ART_DIRECTOR' && isCanonicalIsoInstant(record.completedAt) && record.outputSha256 === analysis.sha256, `round 044 ${batch.id} correction log does not close text/artifact/colour review: ${analysis.id}`);
      if (analysis.area === 'delivery' && /^(?:CHARACTER|ENEMY)_/.test(analysis.role)) assert(record.operations.includes('ANCHOR_ALIGNMENT') && record.operations.includes('FRAME_CONTINUITY'), `round 044 ${batch.id} combat delivery correction lacks anchor/frame review: ${analysis.id}`);
    }
    const exportLineage = json(exportPath);
    assertExactKeySet(exportLineage, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'records', 'boundaries'], `round 044 ${batch.id} export lineage`);
    assert(exportLineage.schemaVersion === 1 && exportLineage.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-export-lineage-round-001` && exportLineage.repository === provenance.repository && exportLineage.branch === 'kimi' && exportLineage.changeControl === s02AssetVolumeControlPath && JSON.stringify(exportLineage.contract) === JSON.stringify(contractBinding) && exportLineage.batch === batch.id && JSON.stringify(exportLineage.boundaries) === JSON.stringify(boundaries) && Array.isArray(exportLineage.records) && exportLineage.records.length === deliveryAssets.length, `round 044 ${batch.id} export lineage identity, boundary or coverage mismatch`);
    for (let index = 0; index < deliveryAssets.length; index += 1) {
      const definition = deliveryAssets[index]; const analysis = analysisById.get(definition.id); const record = exportLineage.records[index];
      assertExactKeySet(record, ['deliveryAssetId', 'sourceAssets', 'recipe', 'output'], `round 044 ${batch.id} export ${definition.id}`);
      const sourceBindings = definition.sourceAssetIds.map(id => { const source = contractProof.sourceById.get(id); return { id, path: source.path, blob: git(['rev-parse', `HEAD:${source.path}`]), sha256: sha256FileAt('HEAD', source.path) }; });
      assert(record.deliveryAssetId === definition.id && JSON.stringify(record.sourceAssets) === JSON.stringify(sourceBindings) && JSON.stringify(record.recipe) === JSON.stringify(definition.exportRecipe) && JSON.stringify(record.output) === JSON.stringify({ path: analysis.path, blob: analysis.blob, sha256: analysis.sha256 }), `round 044 ${batch.id} export is not byte-bound to exact source assets/recipe/output: ${definition.id}`);
    }
    const manifest = json(manifestPath);
    assertExactKeySet(manifest, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'provenance', 'manualCorrectionLog', 'exportLineage', 'assets', 'totalBytes', 'boundaries'], `round 044 ${batch.id} manifest`);
    assert(manifest.schemaVersion === 1 && manifest.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-manifest-round-001` && manifest.repository === provenance.repository && manifest.branch === 'kimi' && manifest.changeControl === s02AssetVolumeControlPath && JSON.stringify(manifest.contract) === JSON.stringify(contractBinding) && manifest.batch === batch.id && JSON.stringify(manifest.provenance) === JSON.stringify(exactPathBindingAt('HEAD', provenancePath, true)) && JSON.stringify(manifest.manualCorrectionLog) === JSON.stringify(exactPathBindingAt('HEAD', correctionPath, true)) && JSON.stringify(manifest.exportLineage) === JSON.stringify(exactPathBindingAt('HEAD', exportPath, true)) && JSON.stringify(manifest.assets) === JSON.stringify(analyses) && manifest.totalBytes === analyses.reduce((sum, entry) => sum + entry.bytes, 0) && manifest.totalBytes <= batch.maxBytes && JSON.stringify(manifest.boundaries) === JSON.stringify(boundaries), `round 044 ${batch.id} manifest differs from trusted decoded bytes, lineage or budget`);
    const manifestTarget = { commit: contentCommit, tree: git(['rev-parse', `${contentCommit}^{tree}`]) };
    const manifestBinding = exactPathBindingAt('HEAD', manifestPath, true);
    const measurements = json(measurementsPath);
    assertExactKeySet(measurements, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'auditTarget', 'manifest', 'checks', 'unresolved', 'verdict', 'maximumVerdict'], `round 044 ${batch.id} measurements`); assertExactKeySet(measurements.unresolved, ['P0', 'P1'], `round 044 ${batch.id} measurement unresolved`);
    assert(measurements.schemaVersion === 1 && measurements.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-measurements-round-001` && measurements.repository === provenance.repository && measurements.branch === 'kimi' && measurements.changeControl === s02AssetVolumeControlPath && JSON.stringify(measurements.contract) === JSON.stringify(contractBinding) && measurements.batch === batch.id && JSON.stringify(measurements.auditTarget) === JSON.stringify(manifestTarget) && JSON.stringify(measurements.manifest) === JSON.stringify(manifestBinding) && JSON.stringify(measurements.checks) === JSON.stringify(expectedChecks) && JSON.stringify(measurements.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && measurements.verdict === 'PASS_S02_P2_ASSET_VOLUME_BATCH_MEASUREMENTS' && measurements.maximumVerdict === 'READY_FOR_S02_P2_ASSET_VOLUME_BATCH_FEASIBILITY', `round 044 ${batch.id} measurements mismatch or overclaim`);
    const measurementsCommit = firstAddCommit(measurementsPath); assertExactSingleParent(measurementsCommit, contentCommit, `round 044 ${batch.id} measurements`); assertExactChangedPaths(contentCommit, measurementsCommit, [measurementsPath], `round 044 ${batch.id} measurements`); assertAddedOnceAndUnchanged(measurementsPath, measurementsCommit);
    const feasibility = json(feasibilityPath);
    assertExactKeySet(feasibility, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'auditTarget', 'measurements', 'checks', 'findings', 'unresolved', 'verdict', 'maximumVerdict'], `round 044 ${batch.id} feasibility`); assertExactKeySet(feasibility.unresolved, ['P0', 'P1'], `round 044 ${batch.id} feasibility unresolved`);
    assert(feasibility.schemaVersion === 1 && feasibility.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-feasibility-audit-round-001` && feasibility.repository === provenance.repository && feasibility.branch === 'kimi' && feasibility.changeControl === s02AssetVolumeControlPath && JSON.stringify(feasibility.contract) === JSON.stringify(contractBinding) && feasibility.batch === batch.id && JSON.stringify(feasibility.auditTarget) === JSON.stringify(manifestTarget) && JSON.stringify(feasibility.measurements) === JSON.stringify(exactPathBindingAt('HEAD', measurementsPath, true)) && JSON.stringify(feasibility.checks) === JSON.stringify(expectedChecks) && JSON.stringify(feasibility.findings) === JSON.stringify(expectedFindings) && JSON.stringify(feasibility.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && feasibility.verdict === 'PASS_S02_P2_ASSET_VOLUME_BATCH_FEASIBILITY' && feasibility.maximumVerdict === 'READY_FOR_S02_P2_ASSET_VOLUME_BATCH_INDEPENDENT_CRITIC', `round 044 ${batch.id} feasibility mismatch or overclaim`);
    const feasibilityCommit = firstAddCommit(feasibilityPath); assertExactSingleParent(feasibilityCommit, measurementsCommit, `round 044 ${batch.id} feasibility`); assertExactChangedPaths(measurementsCommit, feasibilityCommit, [feasibilityPath], `round 044 ${batch.id} feasibility`); assertAddedOnceAndUnchanged(feasibilityPath, feasibilityCommit);
    const critic = json(criticPath);
    assertExactKeySet(critic, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'auditTarget', 'feasibilityAudit', 'lenses', 'findings', 'unresolved', 'verdict', 'maximumVerdict'], `round 044 ${batch.id} critic`); assertExactKeySet(critic.unresolved, ['P0', 'P1'], `round 044 ${batch.id} critic unresolved`);
    const lenses = ['ART_DIRECTION', 'CHARACTER_IDENTITY', 'ANIMATION', 'IMPLEMENTATION', 'ASSET_PIPELINE', 'ACCESSIBILITY', 'BUDGET', 'RUNTIME_BOUNDARY'].map(id => ({ id, status: 'PASS' }));
    assert(critic.schemaVersion === 1 && critic.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-independent-critic-round-001` && critic.repository === provenance.repository && critic.branch === 'kimi' && critic.changeControl === s02AssetVolumeControlPath && JSON.stringify(critic.contract) === JSON.stringify(contractBinding) && critic.batch === batch.id && JSON.stringify(critic.auditTarget) === JSON.stringify(manifestTarget) && JSON.stringify(critic.feasibilityAudit) === JSON.stringify(exactPathBindingAt('HEAD', feasibilityPath, true)) && JSON.stringify(critic.lenses) === JSON.stringify(lenses) && JSON.stringify(critic.findings) === JSON.stringify(expectedFindings) && JSON.stringify(critic.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && critic.verdict === 'PASS_S02_P2_ASSET_VOLUME_BATCH_INDEPENDENT_CRITIC' && critic.maximumVerdict === 'READY_FOR_S02_P2_ASSET_VOLUME_BATCH_FINAL_JUDGE', `round 044 ${batch.id} critic mismatch or P0/P1 remains`);
    const criticCommit = firstAddCommit(criticPath); assertExactSingleParent(criticCommit, feasibilityCommit, `round 044 ${batch.id} critic`); assertExactChangedPaths(feasibilityCommit, criticCommit, [criticPath], `round 044 ${batch.id} critic`); assertAddedOnceAndUnchanged(criticPath, criticCommit);
    const judge = json(judgePath);
    assertExactKeySet(judge, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'auditTarget', 'critic', 'findings', 'unresolved', 'verdict', 'maximumVerdict'], `round 044 ${batch.id} judge`); assertExactKeySet(judge.unresolved, ['P0', 'P1'], `round 044 ${batch.id} judge unresolved`);
    assert(judge.schemaVersion === 1 && judge.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-final-judge-round-001` && judge.repository === provenance.repository && judge.branch === 'kimi' && judge.changeControl === s02AssetVolumeControlPath && JSON.stringify(judge.contract) === JSON.stringify(contractBinding) && judge.batch === batch.id && JSON.stringify(judge.auditTarget) === JSON.stringify(manifestTarget) && JSON.stringify(judge.critic) === JSON.stringify(exactPathBindingAt('HEAD', criticPath, true)) && JSON.stringify(judge.findings) === JSON.stringify(expectedFindings) && JSON.stringify(judge.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && judge.verdict === 'PASS_S02_P2_ASSET_VOLUME_BATCH_FINAL_JUDGE' && judge.maximumVerdict === 'READY_FOR_S02_P2_ASSET_VOLUME_BATCH_COMPLETION', `round 044 ${batch.id} final judge mismatch or overclaim`);
    const judgeCommit = firstAddCommit(judgePath); assertExactSingleParent(judgeCommit, criticCommit, `round 044 ${batch.id} judge`); assertExactChangedPaths(criticCommit, judgeCommit, [judgePath], `round 044 ${batch.id} judge`); assertAddedOnceAndUnchanged(judgePath, judgeCommit);
    const completion = json(completionPath);
    assertExactKeySet(completion, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'contract', 'batch', 'verifiedContent', 'finalJudge', 'unresolved', 'boundaries', 'verdict', 'maximumVerdict'], `round 044 ${batch.id} completion`); assertExactKeySet(completion.unresolved, ['P0', 'P1'], `round 044 ${batch.id} completion unresolved`);
    const maximumVerdict = batchIndex + 1 === contract.productionBatches.length ? 'READY_FOR_S02_P3_RUNTIME_INTEGRATION_SCOPE_REVIEW' : 'READY_FOR_S02_P2_ASSET_VOLUME_NEXT_BATCH';
    assert(completion.schemaVersion === 1 && completion.artifactId === `cats-tower-s02-p2-asset-volume-${batch.id}-completion-evidence-round-001` && completion.repository === provenance.repository && completion.branch === 'kimi' && completion.changeControl === s02AssetVolumeControlPath && JSON.stringify(completion.contract) === JSON.stringify(contractBinding) && completion.batch === batch.id && JSON.stringify(completion.verifiedContent) === JSON.stringify(manifestTarget) && JSON.stringify(completion.finalJudge) === JSON.stringify(exactPathBindingAt('HEAD', judgePath, true)) && JSON.stringify(completion.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && JSON.stringify(completion.boundaries) === JSON.stringify(boundaries) && completion.verdict === 'PASS_S02_P2_ASSET_VOLUME_BATCH' && completion.maximumVerdict === maximumVerdict, `round 044 ${batch.id} completion mismatch or overclaim`);
    const completionCommit = firstAddCommit(completionPath); assertExactSingleParent(completionCommit, judgeCommit, `round 044 ${batch.id} completion`); assertExactChangedPaths(judgeCommit, completionCommit, [completionPath], `round 044 ${batch.id} completion`); assertAddedOnceAndUnchanged(completionPath, completionCommit);
    predecessor = completionCommit; completedBatches += 1;
  }
  for (const subjectId of new Set(contract.deliveryAssets.filter(asset => /^(?:CHARACTER|ENEMY)_/.test(asset.role)).map(asset => asset.subjectId))) {
    const definitions = contract.deliveryAssets.filter(asset => asset.subjectId === subjectId && /^(?:CHARACTER|ENEMY)_/.test(asset.role));
    const analyses = definitions.map(asset => allAnalyses.get(asset.id));
    assert(analyses.every(Boolean), `round 044 cross-asset identity audit lacks a decoded asset for ${subjectId}`);
    const frameMeans = analyses.flatMap(analysis => analysis.frames.map(frame => frame.meanRgb));
    const normalizedHeights = definitions.flatMap((definition, assetIndex) => definition.frames.map((frame, frameIndex) => analyses[assetIndex].frames[frameIndex].visibleBounds.height / frame.sourceRect.height));
    let maximumMeanColourDistance = 0;
    for (let left = 0; left < frameMeans.length; left += 1) for (let right = left + 1; right < frameMeans.length; right += 1) maximumMeanColourDistance = Math.max(maximumMeanColourDistance, Math.hypot(...frameMeans[left].map((value, channel) => value - frameMeans[right][channel])));
    assert(frameMeans.length >= 5 && maximumMeanColourDistance <= 180 && Math.max(...normalizedHeights) / Math.min(...normalizedHeights) <= 3.5, `round 044 decoded cross-asset identity/proportion continuity failed for ${subjectId}`);
  }
  return { complete: completedBatches === contract.productionBatches.length, completedBatches, predecessor };
}

function verifyS02AssetVolumeScopeHandoff() {
  assert(Boolean(s02AssetVolumeScopeControl) === Boolean(s02AssetVolumeScopeLock), 'round 043 control and governance activation record round 013 must appear atomically');
  if (!s02AssetVolumeScopeControl) return null;
  assert(s02RepresentativeAssetPass && s02AssetPassControl, 'round 043 requires the complete immutable representative PASS_ASSET state');
  assertExactKeySet(s02AssetVolumeScopeControl, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'entryWorkflow', 'governanceActivation', 'approvedRepresentative', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], 'round 043 control');
  assertExactKeySet(s02AssetVolumeScopeControl.entry, ['head', 'tree'], 'round 043 entry');
  assertExactKeySet(s02AssetVolumeScopeControl.governanceActivation, ['path', 'blob'], 'round 043 governance activation binding');
  assertExactKeySet(s02AssetVolumeScopeControl.completionBoundary, ['scopeContractReady', 'assetBytesAuthorized', 'assetVolumeAllowed', 'runtimeIntegrationAllowed', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified', 'maximumVerdict'], 'round 043 completion boundary');
  const passCommit = s02RepresentativeAssetPass.openingCommit; const passTree = git(['rev-parse', `${passCommit}^{tree}`]);
  const expectedApprovedRepresentative = {
    changeControl: exactPathBindingAt('HEAD', s02AssetPassControlPath, true),
    passCommit,
    passTree,
    manifest: exactPathBindingAt('HEAD', s02RepresentativeManifestPath, true),
    critic: exactPathBindingAt('HEAD', s02RepresentativeEvidencePaths.critic, true),
    finalJudge: exactPathBindingAt('HEAD', s02RepresentativeEvidencePaths.finalJudge, true),
    completion: exactPathBindingAt('HEAD', s02RepresentativeEvidencePaths.completion, true)
  };
  assertExactKeySet(s02AssetVolumeScopeLock, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'base', 'derivation', 'decision', 'approvedRepresentative', 'boundaries'], 'round 013 governance activation record');
  assertExactKeySet(s02AssetVolumeScopeLock.base, ['head', 'tree'], 'round 013 base');
  assertExactKeySet(s02AssetVolumeScopeLock.derivation, ['rule', 'approvedGoldenMasterDecisionLock', 'representativePassControl', 'representativeManifest', 'representativeCompletion'], 'round 013 derivation');
  assertExactKeySet(s02AssetVolumeScopeLock.boundaries, ['assetBytesAuthorized', 'assetVolumeAllowed', 'runtimeIntegrationAllowed', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified'], 'round 013 boundaries');
  assert(s02AssetVolumeScopeLock.schemaVersion === 1 && s02AssetVolumeScopeLock.artifactId === 'cats-tower-governance-activation-record-round-013' && isCanonicalIsoDate(s02AssetVolumeScopeLock.createdAt) && s02AssetVolumeScopeLock.repository === '2hg7trp7rv-design/cats_tower' && s02AssetVolumeScopeLock.branch === 'kimi', 'round 013 activation identity mismatch');
  assert(JSON.stringify(s02AssetVolumeScopeLock.base) === JSON.stringify({ head: passCommit, tree: passTree }) && JSON.stringify(s02AssetVolumeScopeLock.approvedRepresentative) === JSON.stringify(expectedApprovedRepresentative), 'round 013 does not bind the exact representative PASS_ASSET state');
  assert(JSON.stringify(s02AssetVolumeScopeLock.derivation) === JSON.stringify({ rule: 'AUTOMATIC_SCOPE_ONLY_SUCCESSOR_AFTER_EXACT_USER_APPROVED_GOLDEN_MASTER_AND_REPRESENTATIVE_PASS_ASSET', approvedGoldenMasterDecisionLock: exactPathBindingAt('HEAD', s02ApprovedAssetSource.lockPath, true), representativePassControl: exactPathBindingAt('HEAD', s02AssetPassControlPath, true), representativeManifest: exactPathBindingAt('HEAD', s02RepresentativeManifestPath, true), representativeCompletion: exactPathBindingAt('HEAD', s02RepresentativeEvidencePaths.completion, true) }) && s02AssetVolumeScopeLock.decision === 'ACTIVATE_S02_P2_ASSET_VOLUME_SCOPE_CONTRACT_ONLY', 'round 013 is not exactly derived from the user-approved Golden Master and representative PASS_ASSET');
  assert(Object.values(s02AssetVolumeScopeLock.boundaries).every(value => value === false), 'round 013 authorizes asset, runtime, release or device work');
  const openingCommit = s02AssetVolumeScopeOpeningCommit;
  assertExactSingleParent(openingCommit, passCommit, 'round 043 scope-contract opening');
  assertExactChangedPaths(passCommit, openingCommit, expectedS02AssetVolumeScopeOpeningWrites, 'round 043 atomic scope-contract opening');
  assert(firstAddCommit(s02AssetVolumeScopeControlPath) === openingCommit && firstAddCommit(s02AssetVolumeScopeLockPath) === openingCommit, 'round 043 control/activation record were not first added atomically');
  assertAddedOnceAndUnchanged(s02AssetVolumeScopeControlPath, openingCommit); assertAddedOnceAndUnchanged(s02AssetVolumeScopeLockPath, openingCommit);
  const openingDate = git(['show', '-s', '--format=%cI', openingCommit]).slice(0, 10);
  assert(s02AssetVolumeScopeLock.createdAt === openingDate && s02AssetVolumeScopeControl.createdAt === openingDate, 'round 013/043 activation date differs from its exact opening commit');
  const round043Forbidden = [...new Set([...expectedS02P2ForbiddenWrites, ...expectedS02P2AllowedWrites, 'step4/s02/asset-production-p2/volume-round-001/**'])].filter(file => !expectedS02AssetVolumeScopeAllowedWrites.includes(file));
  assert(s02AssetVolumeScopeControl.schemaVersion === 1 && s02AssetVolumeScopeControl.artifactId === 'cats-tower-active-change-control-addendum-round-043' && isCanonicalIsoDate(s02AssetVolumeScopeControl.createdAt) && s02AssetVolumeScopeControl.repository === '2hg7trp7rv-design/cats_tower' && s02AssetVolumeScopeControl.branch === 'kimi' && s02AssetVolumeScopeControl.parentChangeControl === s02AssetPassControlPath && JSON.stringify(s02AssetVolumeScopeControl.entry) === JSON.stringify({ head: passCommit, tree: passTree }) && JSON.stringify(s02AssetVolumeScopeControl.governanceActivation) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeLockPath)) && JSON.stringify(s02AssetVolumeScopeControl.approvedRepresentative) === JSON.stringify(expectedApprovedRepresentative), 'round 043 authority, entry, activation or representative binding mismatch');
  assert(s02AssetVolumeScopeControl.status === 'IN_PROGRESS' && s02AssetVolumeScopeControl.verdict === 'IN_PROGRESS_S02_P2_VOLUME_SCOPE_CONTRACT' && s02AssetVolumeScopeControl.currentRepositoryStep === 4 && s02AssetVolumeScopeControl.internalPhase === 'S02-P2-ASSET-PRODUCTION' && s02AssetVolumeScopeControl.internalPhaseIsRepositoryStep === false && s02AssetVolumeScopeControl.scope === 'S02_P2_ASSET_VOLUME_SCOPE_CONTRACT_ONLY_NO_ASSET_BYTES_NO_RUNTIME', 'round 043 phase/scope/verdict mismatch');
  assert(JSON.stringify(s02AssetVolumeScopeControl.allowedWrites) === JSON.stringify(expectedS02AssetVolumeScopeAllowedWrites) && JSON.stringify(s02AssetVolumeScopeControl.forbiddenWrites) === JSON.stringify(round043Forbidden) && JSON.stringify(s02AssetVolumeScopeControl.completionBoundary) === JSON.stringify({ scopeContractReady: false, assetBytesAuthorized: false, assetVolumeAllowed: false, runtimeIntegrationAllowed: false, step4Pass: false, step5Allowed: false, productionAllowed: false, productionAliasChanged: false, physicalIPhoneVerified: false, maximumVerdict: 'READY_FOR_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION_ACTIVATION' }), 'round 043 write or completion boundary is unsafe');
  assert(s02AssetVolumeScopeControl.entryWorkflow.commit === passCommit && s02AssetVolumeScopeControl.entryWorkflow.tree === passTree, 'round 043 entry workflow target mismatch');
  assertWorkflowEvidenceKeys(s02AssetVolumeScopeControl.entryWorkflow, 'round 043 entry workflow', true); registerWorkflowEvidence(s02AssetVolumeScopeControl.entryWorkflow, 'round 043 entry');
  assertExactPhaseDocumentTransforms(openingCommit, expectedRound043DocumentText, 'round 043 opening documents');
  if (!exists(s02AssetVolumeContractPath)) {
    assert(!Object.values(s02AssetVolumeScopeEvidencePaths).some(exists) && !s02AssetVolumeControl, 'round 043 evidence or successor exists before its immutable scope contract');
    assertRegularBoundedHistory(openingCommit, git(['rev-parse', 'HEAD']), s02AssetVolumeScopeControl, 'round 043 pre-contract scope design', 2 * 1024 * 1024, 4 * 1024 * 1024, 32, 8 * 1024 * 1024, 32);
    return { openingCommit, expectedApprovedRepresentative, complete: false };
  }
  const contractCommit = firstAddCommit(s02AssetVolumeContractPath);
  assertExactSingleParent(contractCommit, openingCommit, 'round 043 scope contract content');
  assertExactChangedPaths(openingCommit, contractCommit, [s02AssetVolumeContractPath], 'round 043 scope contract content');
  assertAddedOnceAndUnchanged(s02AssetVolumeContractPath, contractCommit);
  const contractProof = verifyS02AssetVolumeScopeContract(json(s02AssetVolumeContractPath), contractCommit, expectedApprovedRepresentative);
  const evidenceSequence = Object.values(s02AssetVolumeScopeEvidencePaths);
  assert(evidenceSequence.every(exists), 'round 043 scope contract exists without its complete Acceptance/feasibility/critic/judge/completion chain');
  const contractBinding = exactPathBindingAt('HEAD', s02AssetVolumeContractPath, true); const target = { commit: contractCommit, tree: contractProof.contractTree };
  const expectedChecks = s02AssetVolumeScopeCriterionIds.map(id => ({ id, status: 'PASS' }));
  const acceptance = json(s02AssetVolumeScopeEvidencePaths.acceptanceMatrix);
  assertExactKeySet(acceptance, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'contract', 'criteria', 'unresolved', 'verdict', 'maximumVerdict'], 'round 043 scope Acceptance');
  assertExactKeySet(acceptance.auditTarget, ['commit', 'tree'], 'round 043 Acceptance target'); assertExactKeySet(acceptance.unresolved, ['P0', 'P1'], 'round 043 Acceptance unresolved');
  assert(acceptance.schemaVersion === 1 && acceptance.artifactId === 'cats-tower-s02-p2-asset-volume-scope-acceptance-matrix-round-001' && acceptance.repository === s02AssetVolumeScopeControl.repository && acceptance.branch === 'kimi' && acceptance.changeControl === s02AssetVolumeScopeControlPath && JSON.stringify(acceptance.auditTarget) === JSON.stringify(target) && JSON.stringify(acceptance.contract) === JSON.stringify(contractBinding) && JSON.stringify(acceptance.criteria) === JSON.stringify(expectedChecks) && JSON.stringify(acceptance.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && acceptance.verdict === 'PASS_S02_P2_VOLUME_SCOPE_ACCEPTANCE' && acceptance.maximumVerdict === 'READY_FOR_S02_P2_VOLUME_SCOPE_FEASIBILITY_AUDIT', 'round 043 scope Acceptance mismatch or overclaim');
  const acceptanceCommit = firstAddCommit(s02AssetVolumeScopeEvidencePaths.acceptanceMatrix); assertExactSingleParent(acceptanceCommit, contractCommit, 'round 043 scope Acceptance'); assertExactChangedPaths(contractCommit, acceptanceCommit, [s02AssetVolumeScopeEvidencePaths.acceptanceMatrix], 'round 043 scope Acceptance'); assertAddedOnceAndUnchanged(s02AssetVolumeScopeEvidencePaths.acceptanceMatrix, acceptanceCommit);
  const feasibility = json(s02AssetVolumeScopeEvidencePaths.feasibilityAudit);
  assertExactKeySet(feasibility, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'contract', 'acceptanceMatrix', 'checks', 'risks', 'unresolved', 'verdict', 'maximumVerdict'], 'round 043 scope feasibility'); assertExactKeySet(feasibility.unresolved, ['P0', 'P1'], 'round 043 scope feasibility unresolved');
  const expectedRisks = s02AssetVolumeScopeResolvedFindings.map(({ id, severity, resolved }) => ({ id, severity, resolved }));
  assert(feasibility.schemaVersion === 1 && feasibility.artifactId === 'cats-tower-s02-p2-asset-volume-scope-feasibility-audit-round-001' && feasibility.repository === acceptance.repository && feasibility.branch === 'kimi' && feasibility.changeControl === s02AssetVolumeScopeControlPath && JSON.stringify(feasibility.auditTarget) === JSON.stringify(target) && JSON.stringify(feasibility.contract) === JSON.stringify(contractBinding) && JSON.stringify(feasibility.acceptanceMatrix) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.acceptanceMatrix)) && JSON.stringify(feasibility.checks) === JSON.stringify(expectedChecks) && JSON.stringify(feasibility.risks) === JSON.stringify(expectedRisks) && JSON.stringify(feasibility.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && feasibility.verdict === 'PASS_S02_P2_VOLUME_SCOPE_FEASIBILITY' && feasibility.maximumVerdict === 'READY_FOR_S02_P2_VOLUME_SCOPE_INDEPENDENT_CRITIC', 'round 043 feasibility mismatch or overclaim');
  const feasibilityCommit = firstAddCommit(s02AssetVolumeScopeEvidencePaths.feasibilityAudit); assertExactSingleParent(feasibilityCommit, acceptanceCommit, 'round 043 scope feasibility'); assertExactChangedPaths(acceptanceCommit, feasibilityCommit, [s02AssetVolumeScopeEvidencePaths.feasibilityAudit], 'round 043 scope feasibility'); assertAddedOnceAndUnchanged(s02AssetVolumeScopeEvidencePaths.feasibilityAudit, feasibilityCommit);
  const critic = json(s02AssetVolumeScopeEvidencePaths.critic);
  assertExactKeySet(critic, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'contract', 'acceptanceMatrix', 'feasibilityAudit', 'lenses', 'findings', 'unresolved', 'verdict', 'maximumVerdict'], 'round 043 scope critic'); assertExactKeySet(critic.unresolved, ['P0', 'P1'], 'round 043 critic unresolved');
  const lenses = ['IMPLEMENTATION', 'ART_DIRECTION', 'ANIMATION', 'RESPONSIVE', 'ACCESSIBILITY', 'ASSET_PIPELINE', 'BUDGET', 'RUNTIME_BOUNDARY'].map(id => ({ id, status: 'PASS' }));
  assert(critic.schemaVersion === 1 && critic.artifactId === 'cats-tower-s02-p2-asset-volume-scope-independent-critic-round-001' && critic.repository === acceptance.repository && critic.branch === 'kimi' && critic.changeControl === s02AssetVolumeScopeControlPath && JSON.stringify(critic.auditTarget) === JSON.stringify(target) && JSON.stringify(critic.contract) === JSON.stringify(contractBinding) && JSON.stringify(critic.acceptanceMatrix) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.acceptanceMatrix)) && JSON.stringify(critic.feasibilityAudit) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.feasibilityAudit)) && JSON.stringify(critic.lenses) === JSON.stringify(lenses) && JSON.stringify(critic.findings) === JSON.stringify(s02AssetVolumeScopeResolvedFindings) && JSON.stringify(critic.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && critic.verdict === 'PASS_S02_P2_VOLUME_SCOPE_INDEPENDENT_CRITIC' && critic.maximumVerdict === 'READY_FOR_S02_P2_VOLUME_SCOPE_FINAL_JUDGE', 'round 043 critic mismatch or P0/P1 remains');
  const criticCommit = firstAddCommit(s02AssetVolumeScopeEvidencePaths.critic); assertExactSingleParent(criticCommit, feasibilityCommit, 'round 043 scope critic'); assertExactChangedPaths(feasibilityCommit, criticCommit, [s02AssetVolumeScopeEvidencePaths.critic], 'round 043 scope critic'); assertAddedOnceAndUnchanged(s02AssetVolumeScopeEvidencePaths.critic, criticCommit);
  const judge = json(s02AssetVolumeScopeEvidencePaths.finalJudge);
  assertExactKeySet(judge, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'contract', 'critic', 'findings', 'unresolved', 'verdict', 'maximumVerdict'], 'round 043 scope judge'); assertExactKeySet(judge.unresolved, ['P0', 'P1'], 'round 043 judge unresolved');
  assert(judge.schemaVersion === 1 && judge.artifactId === 'cats-tower-s02-p2-asset-volume-scope-final-judge-round-001' && judge.repository === acceptance.repository && judge.branch === 'kimi' && judge.changeControl === s02AssetVolumeScopeControlPath && JSON.stringify(judge.auditTarget) === JSON.stringify(target) && JSON.stringify(judge.contract) === JSON.stringify(contractBinding) && JSON.stringify(judge.critic) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.critic)) && JSON.stringify(judge.findings) === JSON.stringify(s02AssetVolumeScopeResolvedFindings) && JSON.stringify(judge.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && judge.verdict === 'PASS_S02_P2_VOLUME_SCOPE_FINAL_JUDGE' && judge.maximumVerdict === 'READY_FOR_S02_P2_VOLUME_SCOPE_COMPLETION', 'round 043 final judge mismatch or overclaim');
  const judgeCommit = firstAddCommit(s02AssetVolumeScopeEvidencePaths.finalJudge); assertExactSingleParent(judgeCommit, criticCommit, 'round 043 scope judge'); assertExactChangedPaths(criticCommit, judgeCommit, [s02AssetVolumeScopeEvidencePaths.finalJudge], 'round 043 scope judge'); assertAddedOnceAndUnchanged(s02AssetVolumeScopeEvidencePaths.finalJudge, judgeCommit);
  const completion = json(s02AssetVolumeScopeEvidencePaths.completion);
  assertExactKeySet(completion, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContract', 'finalJudge', 'unresolved', 'boundaries', 'verdict', 'maximumVerdict'], 'round 043 scope completion'); assertExactKeySet(completion.unresolved, ['P0', 'P1'], 'round 043 completion unresolved');
  const completionBoundaries = { assetBytesAuthorized: false, assetVolumeAllowed: false, runtimeIntegrationAllowed: false, step4Pass: false, step5Allowed: false, productionAllowed: false, productionAliasChanged: false, physicalIPhoneVerified: false };
  assert(completion.schemaVersion === 1 && completion.artifactId === 'cats-tower-s02-p2-asset-volume-scope-completion-evidence-round-001' && completion.repository === acceptance.repository && completion.branch === 'kimi' && completion.changeControl === s02AssetVolumeScopeControlPath && JSON.stringify(completion.verifiedContract) === JSON.stringify({ ...contractBinding, commit: contractCommit, tree: contractProof.contractTree }) && JSON.stringify(completion.finalJudge) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.finalJudge)) && JSON.stringify(completion.unresolved) === JSON.stringify({ P0: 0, P1: 0 }) && JSON.stringify(completion.boundaries) === JSON.stringify(completionBoundaries) && completion.verdict === 'READY_FOR_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION_ACTIVATION' && completion.maximumVerdict === 'READY_FOR_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION_ACTIVATION', 'round 043 completion mismatch or overclaim');
  const completionCommit = firstAddCommit(s02AssetVolumeScopeEvidencePaths.completion); assertExactSingleParent(completionCommit, judgeCommit, 'round 043 scope completion'); assertExactChangedPaths(judgeCommit, completionCommit, [s02AssetVolumeScopeEvidencePaths.completion], 'round 043 scope completion'); assertAddedOnceAndUnchanged(s02AssetVolumeScopeEvidencePaths.completion, completionCommit);
  const freezeEnd = s02AssetVolumeOpeningCommit ? git(['rev-parse', `${s02AssetVolumeOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
  assertRegularBoundedHistory(openingCommit, freezeEnd, s02AssetVolumeScopeControl, 'round 043 exact scope-contract history', 2 * 1024 * 1024, 4 * 1024 * 1024, 64, 16 * 1024 * 1024, 32);
  assertNoPathChangesSince(contractCommit, freezeEnd, [s02AssetVolumeContractPath, ...evidenceSequence], 'round 043 immutable contract/evidence freeze');
  return { openingCommit, contractCommit, contractProof, completionCommit, readyCommit: completionCommit, readyTree: git(['rev-parse', `${completionCommit}^{tree}`]), expectedApprovedRepresentative, complete: true };
}
const s02AssetVolumeScopeHandoff = verifyS02AssetVolumeScopeHandoff();

function verifyS02AssetVolumeProductionHandoff() {
  assert(Boolean(s02AssetVolumeControl) === Boolean(s02AssetVolumeApprovalLock), 'round 044 control and exact governance activation record round 014 must appear atomically');
  if (!s02AssetVolumeControl) return null;
  assert(s02AssetVolumeScopeHandoff?.complete, 'round 044 requires the complete immutable round 043 scope review and READY activation');
  const { contractProof, readyCommit, readyTree } = s02AssetVolumeScopeHandoff;
  const contract = json(s02AssetVolumeContractPath);
  const contractBinding = exactPathBindingAt('HEAD', s02AssetVolumeContractPath, true);
  const expectedApprovedScope = {
    scopeCompletionCommit: readyCommit,
    scopeCompletionTree: readyTree,
    contract: contractBinding,
    finalJudge: exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.finalJudge, true),
    completion: exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.completion, true),
    sourceAssetPaths: contractProof.sourcePaths,
    deliveryAssetPaths: contractProof.deliveryPaths,
    evidencePaths: contractProof.evidencePaths,
    budgets: contract.budgets
  };
  assertExactKeySet(s02AssetVolumeApprovalLock, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'base', 'derivation', 'decision', 'activatedContract', 'boundaries'], 'round 014 governance activation record');
  assertExactKeySet(s02AssetVolumeApprovalLock.base, ['head', 'tree'], 'round 014 base');
  assertExactKeySet(s02AssetVolumeApprovalLock.derivation, ['rule', 'scopeContract', 'acceptanceMatrix', 'feasibilityAudit', 'critic', 'finalJudge', 'completion'], 'round 014 derivation');
  assertExactKeySet(s02AssetVolumeApprovalLock.activatedContract, ['scopeCompletionCommit', 'scopeCompletionTree', 'contract', 'finalJudge', 'completion', 'sourceAssetPaths', 'deliveryAssetPaths', 'evidencePaths', 'budgets'], 'round 014 activated contract');
  assertExactKeySet(s02AssetVolumeApprovalLock.boundaries, ['assetVolumeAllowed', 'runtimeIntegrationAllowed', 'gameDataMutationAllowed', 'economyMutationAllowed', 'saveSchemaMutationAllowed', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified'], 'round 014 boundaries');
  assert(s02AssetVolumeApprovalLock.schemaVersion === 1 && s02AssetVolumeApprovalLock.artifactId === 'cats-tower-governance-activation-record-round-014' && isCanonicalIsoDate(s02AssetVolumeApprovalLock.createdAt) && s02AssetVolumeApprovalLock.repository === '2hg7trp7rv-design/cats_tower' && s02AssetVolumeApprovalLock.branch === 'kimi', 'round 014 activation identity mismatch');
  assert(JSON.stringify(s02AssetVolumeApprovalLock.base) === JSON.stringify({ head: readyCommit, tree: readyTree }) && JSON.stringify(s02AssetVolumeApprovalLock.activatedContract) === JSON.stringify(expectedApprovedScope), 'round 014 does not bind the exact P0/P1-zero round 043 contract fingerprint');
  const expectedRound014Derivation = { rule: 'AUTOMATIC_EXACT_PATH_ACTIVATION_AFTER_ROUND_043_SCOPE_P0_P1_ZERO', scopeContract: contractBinding, acceptanceMatrix: exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.acceptanceMatrix, true), feasibilityAudit: exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.feasibilityAudit, true), critic: exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.critic, true), finalJudge: exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.finalJudge, true), completion: exactPathBindingAt('HEAD', s02AssetVolumeScopeEvidencePaths.completion, true) };
  assert(JSON.stringify(s02AssetVolumeApprovalLock.derivation) === JSON.stringify(expectedRound014Derivation) && s02AssetVolumeApprovalLock.decision === 'ACTIVATE_EXACT_CONTRACT_ENUMERATED_S02_P2_ASSET_VOLUME_PRODUCTION', 'round 014 is not exactly derived from the independently passed round 043 scope contract');
  assert(JSON.stringify(s02AssetVolumeApprovalLock.boundaries) === JSON.stringify({ assetVolumeAllowed: true, runtimeIntegrationAllowed: false, gameDataMutationAllowed: false, economyMutationAllowed: false, saveSchemaMutationAllowed: false, step4Pass: false, step5Allowed: false, productionAllowed: false, productionAliasChanged: false, physicalIPhoneVerified: false }), 'round 014 crosses a runtime, gameplay, release or device boundary');
  const openingCommit = s02AssetVolumeOpeningCommit;
  assertExactSingleParent(openingCommit, readyCommit, 'round 044 exact asset-volume opening');
  assertExactChangedPaths(readyCommit, openingCommit, expectedS02AssetVolumeOpeningWrites, 'round 044 atomic exact asset-volume opening');
  assert(firstAddCommit(s02AssetVolumeControlPath) === openingCommit && firstAddCommit(s02AssetVolumeApprovalLockPath) === openingCommit, 'round 044 control/activation record were not first added atomically');
  assertAddedOnceAndUnchanged(s02AssetVolumeControlPath, openingCommit); assertAddedOnceAndUnchanged(s02AssetVolumeApprovalLockPath, openingCommit);
  const openingDate = git(['show', '-s', '--format=%cI', openingCommit]).slice(0, 10);
  assert(s02AssetVolumeApprovalLock.createdAt === openingDate && s02AssetVolumeControl.createdAt === openingDate, 'round 014/044 activation date differs from its exact opening commit');
  assertExactKeySet(s02AssetVolumeControl, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'entry', 'entryWorkflow', 'governanceActivation', 'approvedContract', 'status', 'verdict', 'currentRepositoryStep', 'internalPhase', 'internalPhaseIsRepositoryStep', 'scope', 'allowedWrites', 'forbiddenWrites', 'completionBoundary'], 'round 044 control');
  assertExactKeySet(s02AssetVolumeControl.entry, ['head', 'tree'], 'round 044 entry'); assertExactKeySet(s02AssetVolumeControl.governanceActivation, ['path', 'blob'], 'round 044 activation binding');
  assertExactKeySet(s02AssetVolumeControl.approvedContract, ['scopeCompletionCommit', 'scopeCompletionTree', 'contract', 'finalJudge', 'completion', 'sourceAssetPaths', 'deliveryAssetPaths', 'evidencePaths', 'budgets'], 'round 044 approved contract');
  assertExactKeySet(s02AssetVolumeControl.completionBoundary, ['assetVolumeAllowed', 'sourceAssetProductionAllowed', 'deliveryAssetProductionAllowed', 'runtimeIntegrationAllowed', 'gameDataMutationAllowed', 'step4Pass', 'step5Allowed', 'productionAllowed', 'productionAssetsApproved', 'productionAliasChanged', 'physicalIPhoneVerified', 'maximumVerdict'], 'round 044 completion boundary');
  const expectedRound044AllowedWrites = [...contractProof.derivedAllowedWrites, ...expectedS02ReadyActivationWrites];
  assert(new Set(expectedRound044AllowedWrites).size === expectedRound044AllowedWrites.length, 'round 044 contract-derived allowlist contains duplicate paths');
  const expectedRound044ForbiddenWrites = [...new Set([...expectedS02P2ForbiddenWrites, ...expectedS02P2AllowedWrites, s02AssetVolumeContractPath, ...Object.values(s02AssetVolumeScopeEvidencePaths), s02AssetVolumeScopeControlPath, s02AssetVolumeScopeLockPath, s02AssetVolumeControlPath, s02AssetVolumeApprovalLockPath])].filter(file => !expectedRound044AllowedWrites.includes(file));
  assert(s02AssetVolumeControl.schemaVersion === 1 && s02AssetVolumeControl.artifactId === 'cats-tower-active-change-control-addendum-round-044' && isCanonicalIsoDate(s02AssetVolumeControl.createdAt) && s02AssetVolumeControl.repository === '2hg7trp7rv-design/cats_tower' && s02AssetVolumeControl.branch === 'kimi' && s02AssetVolumeControl.parentChangeControl === s02AssetVolumeScopeControlPath && JSON.stringify(s02AssetVolumeControl.entry) === JSON.stringify({ head: readyCommit, tree: readyTree }) && JSON.stringify(s02AssetVolumeControl.governanceActivation) === JSON.stringify(exactPathBindingAt('HEAD', s02AssetVolumeApprovalLockPath)) && JSON.stringify(s02AssetVolumeControl.approvedContract) === JSON.stringify(expectedApprovedScope), 'round 044 authority, entry, activation or contract binding mismatch');
  assert(s02AssetVolumeControl.status === 'IN_PROGRESS' && s02AssetVolumeControl.verdict === 'IN_PROGRESS_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION' && s02AssetVolumeControl.currentRepositoryStep === 4 && s02AssetVolumeControl.internalPhase === 'S02-P2-ASSET-PRODUCTION' && s02AssetVolumeControl.internalPhaseIsRepositoryStep === false && s02AssetVolumeControl.scope === 'S02_P2_EXACT_ASSET_VOLUME_PRODUCTION_ONLY_NO_RUNTIME', 'round 044 phase/scope/verdict mismatch');
  assert(JSON.stringify(s02AssetVolumeControl.allowedWrites) === JSON.stringify(expectedRound044AllowedWrites) && JSON.stringify(s02AssetVolumeControl.forbiddenWrites) === JSON.stringify(expectedRound044ForbiddenWrites) && JSON.stringify(s02AssetVolumeControl.completionBoundary) === JSON.stringify({ assetVolumeAllowed: true, sourceAssetProductionAllowed: true, deliveryAssetProductionAllowed: true, runtimeIntegrationAllowed: false, gameDataMutationAllowed: false, step4Pass: false, step5Allowed: false, productionAllowed: false, productionAssetsApproved: false, productionAliasChanged: false, physicalIPhoneVerified: false, maximumVerdict: 'READY_FOR_S02_P3_RUNTIME_INTEGRATION_SCOPE_REVIEW' }), 'round 044 write or completion boundary is unsafe');
  assert(s02AssetVolumeControl.entryWorkflow.commit === readyCommit && s02AssetVolumeControl.entryWorkflow.tree === readyTree, 'round 044 entry workflow target mismatch'); assertWorkflowEvidenceKeys(s02AssetVolumeControl.entryWorkflow, 'round 044 entry workflow', true); registerWorkflowEvidence(s02AssetVolumeControl.entryWorkflow, 'round 044 entry');
  assertExactPhaseDocumentTransforms(openingCommit, expectedRound044DocumentText, 'round 044 opening documents');
  const batchProof = verifyS02AssetVolumeBatches({ openingCommit, contract, contractProof });
  const head = git(['rev-parse', 'HEAD']);
  assertRegularBoundedHistory(openingCommit, head, s02AssetVolumeControl, 'round 044 exact contract-derived asset production', 16 * 1024 * 1024, 80 * 1024 * 1024, 560, 544 * 1024 * 1024, 256);
  if (!batchProof.complete) {
    assert(head === batchProof.predecessor, 'round 044 current tail contains an unreviewed commit after the last complete asset batch');
    assertNoPathChangesSince(openingCommit, head, expectedS02ReadyActivationWrites, 'round 044 mirrors changed before every exact asset batch passed');
    return { openingCommit, contract, contractProof, expectedRound044AllowedWrites, batchProof, readyCommit: null, readyTree: null };
  }
  const readyActivationCommit = head;
  assertExactSingleParent(readyActivationCommit, batchProof.predecessor, 'round 044 final READY activation');
  assertExactChangedPaths(batchProof.predecessor, readyActivationCommit, expectedS02ReadyActivationWrites, 'round 044 final READY activation');
  assertNoPathChangesSince(openingCommit, batchProof.predecessor, expectedS02ReadyActivationWrites, 'round 044 mirrors changed before the dedicated final READY activation');
  assertExactPhaseDocumentTransforms(readyActivationCommit, expectedRound044ReadyDocumentText, 'round 044 final READY documents');
  return { openingCommit, contract, contractProof, expectedRound044AllowedWrites, batchProof, readyCommit: readyActivationCommit, readyTree: git(['rev-parse', `${readyActivationCommit}^{tree}`]) };
}
const s02AssetVolumeProductionHandoff = verifyS02AssetVolumeProductionHandoff();

if (s02AssetVolumeControl) {
  assert(s02AssetVolumeProductionHandoff && authority.activeChangeControl === s02AssetVolumeControlPath, 'round 044 authority state or exact contract-derived handoff mismatch');
  const round044ExpectedStatus = s02AssetVolumeProductionHandoff.readyCommit ? 'READY_FOR_S02_P3_RUNTIME_INTEGRATION_SCOPE_REVIEW' : 'IN_PROGRESS_S02_P2_EXACT_ASSET_VOLUME_PRODUCTION';
  assert(authority.status === round044ExpectedStatus, 'round 044 authority verdict differs from its exact completed-batch tail');
  assertExactPhaseDocumentTransforms('HEAD', s02AssetVolumeProductionHandoff.readyCommit ? expectedRound044ReadyDocumentText : expectedRound044DocumentText, 'round 044 current documents');
} else if (s02AssetVolumeScopeControl) {
  assert(s02AssetVolumeScopeHandoff && authority.activeChangeControl === s02AssetVolumeScopeControlPath && authority.status === 'IN_PROGRESS_S02_P2_VOLUME_SCOPE_CONTRACT', 'round 043 authority state or exact scope chain mismatch');
  assertExactPhaseDocumentTransforms('HEAD', expectedRound043DocumentText, 'round 043 current documents');
} else if (s02AssetPassControl) {
  assert(s02RepresentativeAssetPass && authority.activeChangeControl === s02AssetPassControlPath && authority.status === 'PASS_S02_P2_REPRESENTATIVE_ASSET', 'round 042 authority state or proof mismatch');
  assertExactPhaseDocumentTransforms('HEAD', expectedRound042DocumentText, 'round 042 current documents');
} else if (s02ThirdRevisedP2Control) {
  assert(authority.activeChangeControl === s02ThirdRevisedP2ControlPath && authority.status === 'READY_FOR_S02_P2_ASSET_PRODUCTION', 'round 041 authority state mismatch');
  assert(s02ThirdRevisedP2Approval, 'active round 041 lacks exact approval handoff');
  assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalApprovalDocumentText(file, s02ThirdRevisionDocumentConfig), 'round 041 current documents');
  assertRegularBoundedHistory(s02ThirdRevisedP2Approval.openingCommit, git(['rev-parse', 'HEAD']), s02ThirdRevisedP2Control, 'round 041 representative asset proof');
} else if (s02ThirdRevisionControl) {
  assert(authority.activeChangeControl === s02ThirdRevisionControlPath && ['IN_PROGRESS_S02_P1_USER_REVISION', 'READY_FOR_USER_VISUAL_REVIEW'].includes(authority.status), 'round 040 authority state mismatch');
  assert(s02ThirdRevisionHandoff, 'active round 040 lacks exact revision handoff');
  assertS02HistoryWithIncrementalRenewals(s02ThirdRevisionHandoff.openingCommit, git(['rev-parse', 'HEAD']), s02ThirdRevisionControl, 'round 040 exact user revision and round 004 evidence', '004');
} else if (s02SecondRevisedP2Control) {
  assert(authority.activeChangeControl === s02SecondRevisedP2ControlPath && authority.status === 'READY_FOR_S02_P2_ASSET_PRODUCTION', 'round 039 authority state mismatch');
  assert(s02SecondRevisedP2Approval, 'active round 039 lacks exact approval handoff');
  assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalApprovalDocumentText(file, s02SecondRevisionDocumentConfig), 'round 039 current documents');
  assertRegularBoundedHistory(s02SecondRevisedP2Approval.openingCommit, git(['rev-parse', 'HEAD']), s02SecondRevisedP2Control, 'round 039 representative asset proof');
} else if (s02SecondRevisionControl) {
  assert(authority.activeChangeControl === s02SecondRevisionControlPath && ['IN_PROGRESS_S02_P1_USER_REVISION', 'READY_FOR_USER_VISUAL_REVIEW'].includes(authority.status), 'round 038 authority state mismatch');
  assert(s02SecondRevisionHandoff, 'active round 038 lacks exact revision handoff');
  assertS02HistoryWithIncrementalRenewals(s02SecondRevisionHandoff.openingCommit, git(['rev-parse', 'HEAD']), s02SecondRevisionControl, 'round 038 exact user revision and round 003 evidence', '003');
} else if (s02P2Control) {
  assert(authority.activeChangeControl === s02P2ControlPath && authority.status === 'READY_FOR_S02_P2_ASSET_PRODUCTION', 'round 035 authority state mismatch');
  assertExactPhaseDocumentTransforms('HEAD', expectedRound035DocumentText, 'round 035 current documents');
  assertRegularBoundedHistory(s02P2Approval.openingCommit, git(['rev-parse', 'HEAD']), s02P2Control, 'round 035 representative asset proof');
} else if (s02RevisedP2Control) {
  assert(authority.activeChangeControl === s02RevisedP2ControlPath && authority.status === 'READY_FOR_S02_P2_ASSET_PRODUCTION', 'round 037 authority state mismatch');
  assert(s02RevisedP2Approval, 'active round 037 lacks its exact revised-target approval handoff');
  assertExactPhaseDocumentTransforms('HEAD', expectedRound037DocumentText, 'round 037 current documents');
  assertRegularBoundedHistory(s02RevisedP2Approval.openingCommit, git(['rev-parse', 'HEAD']), s02RevisedP2Control, 'round 037 representative revised-target asset proof');
} else if (s02RevisionControl) {
  assert(authority.activeChangeControl === s02RevisionControlPath && ['IN_PROGRESS_S02_P1_USER_REVISION', 'READY_FOR_USER_VISUAL_REVIEW'].includes(authority.status), 'round 036 authority state mismatch');
  assert(s02RevisionHandoff, 'active round 036 lacks its exact revision handoff');
  assertS02HistoryWithIncrementalRenewals(s02RevisionHandoff.openingCommit, git(['rev-parse', 'HEAD']), s02RevisionControl, 'round 036 exact user-requested revision and round 002 evidence', '002');
} else if (authority.status === 'READY_FOR_USER_VISUAL_REVIEW') {
  assert(s02RepairControl && s02ReviewPrefix?.readbackCommit, 'READY_FOR_USER_VISUAL_REVIEW requires the complete S02 critic, judge, completion and deployment-readback chain');
  assert(s02InitialReadyAccess && s02InitialReadyAccess.endpoint === git(['rev-parse', 'HEAD']), 'initial READY state does not bind its complete access-renewal tail');
  const readyCommit = s02InitialReadyAccess.baseReadyCommit;
  assert(git(['rev-parse', `${readyCommit}^`]) === s02ReviewPrefix.readbackCommit, 'S02 READY activation must immediately follow the exact deployment readback');
  assertExactChangedPaths(s02ReviewPrefix.readbackCommit, readyCommit, expectedS02ReadyActivationWrites, 'S02 READY activation commit');
  const frozenPaths = s02ReviewPrefix.contentManifest.map(entry => entry.path);
  assertNoPathChangesSince(s02RepairOpeningCommit, s02ReviewPrefix.readbackCommit, expectedS02ReadyActivationWrites, 'round 034 mirrors changed before the dedicated READY activation');
  assertNoPathChangesSince(s02ReviewPrefix.targetCommit, s02InitialReadyAccess.endpoint, frozenPaths, 'S02 reviewed product/test/workflow freeze through READY and access renewal');
  for (const entry of s02ReviewPrefix.contentManifest) {
    assert(git(['rev-parse', `HEAD:${entry.path}`]) === entry.blob, `S02 READY content differs from the critic-bound manifest: ${entry.path}`);
  }
  for (const file of Object.values(s02ReviewEvidencePaths)) assertAddedOnceAndUnchanged(file, firstAddCommit(file));
} else if (s02RepairControl) {
  assert(authority.status === 'IN_PROGRESS_S02_P1_VISUAL_REPAIR', 'round 034 has an unsupported non-READY state');
  if (s02ReviewPrefix) {
    const evidenceTail = s02ReviewPrefix.readbackCommit ?? s02ReviewPrefix.requestCommit ?? s02ReviewPrefix.completionCommit ?? s02ReviewPrefix.judgeCommit ?? s02ReviewPrefix.criticCommit ?? s02ReviewPrefix.admissionReadbackCommit ?? s02ReviewPrefix.admissionCommit ?? s02ReviewPrefix.packageCommit;
    assert(git(['rev-parse', 'HEAD']) === evidenceTail, 'once S02 numbered review starts, each evidence commit must remain the exact current tail until the next dedicated evidence step');
  }
}

const requiredV3BindingPaths = [
  'canonical/STEP2_DEPENDENCY_CLOSURE.json',
  'canonical/SCREEN_STATE_REGISTRY.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/acceptance-matrix.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/screen-projection-coverage-ledger.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/numeric-non-impact.json',
  ...Object.values(step2ReviewPaths),
  'simulation/candidate-v3.json',
  'simulation/candidate-v3.schema.json',
  'simulation/validate-candidate-v3.mjs',
  'simulation/execution-contract-v3.json',
  'simulation/execution-contract-v3.schema.json',
  'simulation/validate-execution-contract-v3.mjs',
  'simulation/run-plan-v3.json',
  'simulation/run-plan-v3.schema.json',
  'simulation/validate-run-plan-v3.mjs',
  'simulation/fixtures/v3/manifest.json',
  'simulation/fixtures/v3/negative.json',
  'simulation/fixtures/v3/validate-fixtures.mjs',
  'simulation/result-v3.schema.json',
  'simulation/validate-result-v3.mjs',
  v3QualificationRunnerPath,
  'simulation/engine-v2/run-plan.mjs',
  'simulation/engine-v2/run-scenario.mjs',
  'simulation/engine-v2/high-volume.mjs',
  'simulation/engine-v2/index.mjs',
  'simulation/engine-v2/rng.mjs',
  'simulation/engine-v2/statistics.mjs',
  'simulation/engine-v2/hash.mjs',
  'simulation/engine-v2/tower.mjs',
  'simulation/engine-v2/economy.mjs',
  'simulation/engine-v2/numeric.mjs',
  'simulation/engine-v2/state-machines.mjs',
  'simulation/lib-v2/schema-validator.mjs',
  'simulation/migrations/v1-to-v2/migration-map.json',
  'simulation/executable-seal-v3.schema.json',
  v3SealValidatorPath,
  'simulation/verify-step2-v3.mjs',
  v3ProjectionVerifierPath,
  v3ContinuityVerifierPath
];

const expectedV3AuthorityPointers = {
  seal: v3SealPath,
  candidate: 'simulation/candidate-v3.json',
  schema: 'simulation/candidate-v3.schema.json',
  candidateValidator: 'simulation/validate-candidate-v3.mjs',
  executionContract: 'simulation/execution-contract-v3.json',
  executionContractSchema: 'simulation/execution-contract-v3.schema.json',
  executionContractValidator: 'simulation/validate-execution-contract-v3.mjs',
  runPlan: 'simulation/run-plan-v3.json',
  runPlanSchema: 'simulation/run-plan-v3.schema.json',
  runPlanValidator: 'simulation/validate-run-plan-v3.mjs',
  resultSchema: 'simulation/result-v3.schema.json',
  resultValidator: 'simulation/validate-result-v3.mjs',
  engine: 'simulation/engine-v2/',
  projectionVerifier: v3ProjectionVerifierPath,
  continuityVerifier: v3ContinuityVerifierPath
};

const expectedOpenStep2Authority = {
  step2Status: 'IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED',
  seal: 'simulation/executable-seal-v2.json',
  candidate: 'simulation/candidate-v2.json',
  schema: 'simulation/candidate-v2.schema.json',
  executionContract: 'simulation/execution-contract-v2.json',
  runPlan: 'simulation/run-plan-v2.json',
  engine: 'simulation/engine-v2/',
  currentVerificationMethod: 'Verify every seal binding at current HEAD and run the source-bound verifier in the intact historical worktree; Project-source replacement does not reseal Step 2.'
};

const expectedOpenStep2Simulation = {
  status: 'IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED',
  seal: 'simulation/executable-seal-v2.json',
  candidate: 'simulation/candidate-v2.json',
  executionContract: 'simulation/execution-contract-v2.json',
  bindingDrift: 0,
  verification: 'byte bindings reproduce, but screen responsibility/state semantic projection failed independent mutation testing',
  openFinding: 'S2-P0-SCREEN-PROJECTION-001'
};

const expectedPassStep2Authority = {
  step2Status: 'PASS_CONTRACT',
  ...expectedV3AuthorityPointers
};

const expectedPassStep2Simulation = {
  status: 'PASS_CONTRACT',
  seal: v3SealPath,
  candidate: expectedV3AuthorityPointers.candidate,
  executionContract: expectedV3AuthorityPointers.executionContract,
  bindingDrift: 0,
  verification: 'trusted current v3 seal, lossless canonical screen projection, and Step 3 continuity verification',
  authorityPointers: expectedV3AuthorityPointers
};

const expectedRound032ConcreteWrites = new Set([
  step2CorrectionPath,
  'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json',
  'quality-reviews/phase-0-governance-recovery/critic-summary-round-003.json',
  'quality-reviews/phase-0-governance-recovery/final-judge-round-002.json',
  'quality-reviews/phase-0-governance-recovery/completion-evidence-round-002.json',
  'quality-reviews/phase-0-governance-recovery/live-readback-round-002.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/acceptance-matrix.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/screen-projection-coverage-ledger.json',
  'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/numeric-non-impact.json',
  ...Object.values(step2ReviewPaths),
  step2ContinuityPath,
  'simulation/candidate-v3.json',
  'simulation/candidate-v3.schema.json',
  'simulation/validate-candidate-v3.mjs',
  'simulation/execution-contract-v3.json',
  'simulation/execution-contract-v3.schema.json',
  'simulation/validate-execution-contract-v3.mjs',
  'simulation/run-plan-v3.json',
  'simulation/run-plan-v3.schema.json',
  'simulation/validate-run-plan-v3.mjs',
  'simulation/result-v3.schema.json',
  'simulation/validate-result-v3.mjs',
  'simulation/fixtures/v3/manifest.json',
  'simulation/fixtures/v3/negative.json',
  'simulation/fixtures/v3/validate-fixtures.mjs',
  v3SealPath,
  'simulation/executable-seal-v3.schema.json',
  v3SealValidatorPath,
  'simulation/verify-step2-v3.mjs',
  v3ProjectionVerifierPath,
  v3ContinuityVerifierPath,
  'tests/governance/verify-current-authority.mjs',
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md',
  'quality-reviews/step-1-canonical-design/active-change-control.json'
]);

function verifyRound032NonStep2Freeze() {
  if (!step2Correction) return;
  const baseline = trustedRound031RepairBase.commit;
  const futureClosurePath = 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json';
  const rangeEnd = exists(futureClosurePath) ? firstAddCommit(futureClosurePath) : git(['rev-parse', 'HEAD']);
  const endAuthority = rangeEnd === git(['rev-parse', 'HEAD']) ? authority : jsonAt(rangeEnd, 'CURRENT_AUTHORITY_INDEX.json');
  const endStatus = rangeEnd === git(['rev-parse', 'HEAD']) ? status : jsonAt(rangeEnd, 'PROJECT_STATUS.json');
  const endPolicy = rangeEnd === git(['rev-parse', 'HEAD']) ? policy : jsonAt(rangeEnd, 'AI_PROJECT_POLICY.json');
  const endSimulation = rangeEnd === git(['rev-parse', 'HEAD']) ? sim : jsonAt(rangeEnd, 'simulation/CURRENT_STATUS.json');
  const endDispatcher = rangeEnd === git(['rev-parse', 'HEAD']) ? dispatcher : jsonAt(rangeEnd, 'quality-reviews/step-1-canonical-design/active-change-control.json');
  const baselineAuthority = jsonAt(baseline, 'CURRENT_AUTHORITY_INDEX.json');
  const baselineStatus = jsonAt(baseline, 'PROJECT_STATUS.json');
  const baselinePolicy = jsonAt(baseline, 'AI_PROJECT_POLICY.json');
  const baselineSimulation = jsonAt(baseline, 'simulation/CURRENT_STATUS.json');
  const baselineDispatcher = jsonAt(baseline, 'quality-reviews/step-1-canonical-design/active-change-control.json');
  const freezeTopLevelExcept = (currentValue, baselineValue, allowedKeys, label) => {
    const currentCopy = structuredClone(currentValue);
    const baselineCopy = structuredClone(baselineValue);
    for (const key of allowedKeys) {
      delete currentCopy[key];
      delete baselineCopy[key];
    }
    assert(JSON.stringify(currentCopy) === JSON.stringify(baselineCopy), `round 032 changed frozen ${label} top-level content`);
  };
  freezeTopLevelExcept(endAuthority, baselineAuthority, ['updatedAt', 'status', 'currentInternalPhase', 'activeChangeControl', 'governanceRecovery', 'executableContract', 'globalGate', 'currentProductWork'], 'authority');
  freezeTopLevelExcept(endStatus, baselineStatus, ['updatedAt', 'activeChangeControl', 'status', 'currentInternalPhase', 'currentVerdict', 'governanceRecovery', 'scopedPasses', 'currentProductWork', 'openFindings', 'nextAuthorizedAction'], 'PROJECT_STATUS');
  freezeTopLevelExcept(endPolicy, baselinePolicy, ['updatedAt', 'authority', 'current', 'currentWriteBoundary'], 'AI policy');
  freezeTopLevelExcept(endSimulation, baselineSimulation, ['updatedAt', 'currentInternalPhase', 'status', 'governanceRecovery', 'step2', 'currentMutationAllowed', 'nextAction'], 'simulation mirror');
  freezeTopLevelExcept(endDispatcher, baselineDispatcher, ['updatedAt', 'status', 'currentAddendum', 'currentVerdict', 'currentInternalPhase', 'governanceRecoveryClosure', 'canonicalSeals', 'step2ExecutableContract', 'scopeTruth'], 'dispatcher');
  const stablePolicyAuthority = value => {
    const copy = structuredClone(value);
    delete copy.activeChangeControl;
    return copy;
  };
  assert(JSON.stringify(stablePolicyAuthority(endPolicy.authority)) === JSON.stringify(stablePolicyAuthority(baselinePolicy.authority)), 'round 032 changed frozen AI policy authority pointers outside the active control');
  for (const key of ['canonicalProduct', 'modelValidation', 'legacyRuntime', 'scopedVerdicts', 'workflowPolicy', 'immutableHistoryPolicy', 'projectSources']) {
    assert(JSON.stringify(endAuthority[key]) === JSON.stringify(baselineAuthority[key]), `round 032 changed frozen authority section: ${key}`);
  }
  const stableProduct = value => {
    const copy = structuredClone(value);
    delete copy.currentState;
    delete copy.nextAuthorizedAction;
    delete copy.nextProductActionAfterCorrectedClosure;
    return copy;
  };
  assert(JSON.stringify(stableProduct(endAuthority.currentProductWork)) === JSON.stringify(stableProduct(baselineAuthority.currentProductWork)), 'round 032 changed frozen S02 product truth');
  const stableStatusProduct = value => {
    const copy = structuredClone(value);
    delete copy.currentState;
    return copy;
  };
  assert(JSON.stringify(stableStatusProduct(endStatus.currentProductWork)) === JSON.stringify(stableStatusProduct(baselineStatus.currentProductWork)), 'round 032 changed frozen PROJECT_STATUS product truth');
  const stableScopedPasses = value => {
    const copy = structuredClone(value);
    delete copy.step2;
    return copy;
  };
  assert(JSON.stringify(stableScopedPasses(endStatus.scopedPasses)) === JSON.stringify(stableScopedPasses(baselineStatus.scopedPasses)), 'round 032 changed non-Step2 scoped PASS labels');
  assert(JSON.stringify(endStatus.truthBoundaries) === JSON.stringify(baselineStatus.truthBoundaries), 'round 032 changed frozen runtime/release truth boundaries');
  for (const key of ['repository', 'scopedPassVocabulary', 'forbiddenUnscopedVerdict', 'completionInsufficientAlone', 'lowReworkRules', 'verificationPolicy', 'legacy', 'reportingRequired']) {
    assert(JSON.stringify(endPolicy[key]) === JSON.stringify(baselinePolicy[key]), `round 032 changed frozen AI policy security section: ${key}`);
  }
  for (const key of ['step1', 'step3', 'runtimeRevalidation', 'candidateMutationDuringS02P1', 'sealedEvidenceMutationDuringS02P1']) {
    assert(JSON.stringify(endSimulation[key]) === JSON.stringify(baselineSimulation[key]), `round 032 changed frozen simulation section: ${key}`);
  }
  const withoutStep2 = value => {
    const copy = structuredClone(value);
    delete copy.step2;
    return copy;
  };
  assert(JSON.stringify(withoutStep2(endDispatcher.canonicalSeals)) === JSON.stringify(withoutStep2(baselineDispatcher.canonicalSeals)), 'round 032 changed non-Step2 canonical seals');
  assert(JSON.stringify(withoutStep2(endDispatcher.scopeTruth)) === JSON.stringify(withoutStep2(baselineDispatcher.scopeTruth)), 'round 032 changed non-Step2 dispatcher scope truth');
  for (const key of ['repository', 'branch', 'currentAuthorityIndex', 'lineage', 'rule']) {
    assert(JSON.stringify(endDispatcher[key]) === JSON.stringify(baselineDispatcher[key]), `round 032 changed frozen dispatcher section: ${key}`);
  }
  const concreteChanges = changedPaths(step2Correction.entry.head, rangeEnd);
  let aggregateBytes = 0;
  for (const file of concreteChanges) {
    assert(expectedRound032ConcreteWrites.has(file), `round 032 created or changed an unreviewed concrete path: ${file}`);
    const entry = git(['ls-tree', rangeEnd, '--', file]).split(/\s+/);
    assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `round 032 end-state file is missing or non-100644: ${file}`);
    const bytes = Number(git(['cat-file', '-s', `${rangeEnd}:${file}`]));
    assert(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 10 * 1024 * 1024, `round 032 governed file exceeds 10 MiB: ${file}`);
    aggregateBytes += bytes;
  }
  assert(aggregateBytes <= 40 * 1024 * 1024, 'round 032 aggregate governed writes exceed 40 MiB');
  const commitOutput = git(['rev-list', '--reverse', `${step2Correction.entry.head}..${rangeEnd}`]);
  const commits = commitOutput ? commitOutput.split('\n').filter(Boolean) : [];
  let parent = step2Correction.entry.head;
  for (const commit of commits) {
    let commitBytes = 0;
    for (const file of changedPaths(parent, commit)) {
      assert(expectedRound032ConcreteWrites.has(file), `round 032 intermediate commit changed an unreviewed concrete path: ${file}`);
      const entry = git(['ls-tree', commit, '--', file]).split(/\s+/);
      assert(entry[0] === '100644' && entry[1] === 'blob' && entry[3] === file, `round 032 intermediate commit deleted or used a non-100644 file: ${file}`);
      const bytes = Number(git(['cat-file', '-s', `${commit}:${file}`]));
      assert(Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 10 * 1024 * 1024, `round 032 intermediate file exceeds 10 MiB: ${file}`);
      commitBytes += bytes;
    }
    assert(commitBytes <= 40 * 1024 * 1024, `round 032 intermediate commit exceeds 40 MiB: ${commit}`);
    parent = commit;
  }
}

verifyRound032NonStep2Freeze();

function verifyStep2ReviewEvidence(seal) {
  const presence = Object.fromEntries(Object.entries(step2ReviewPaths).map(([key, file]) => [key, exists(file)]));
  assert(!presence.finalJudge || presence.critic, 'Step 2 final judge exists before the independent critic');
  assert(!presence.completion || presence.finalJudge, 'Step 2 completion exists before the final judge');
  assert(!presence.liveReadback || presence.completion, 'Step 2 live readback exists before completion');
  if (seal) assert(Object.values(presence).every(Boolean), 'Step 2 v3 seal exists before the complete numbered review prefix');
  if (!presence.critic) return null;
  const critic = json(step2ReviewPaths.critic);
  assertExactKeySet(critic, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'verdict', 'coverage', 'findings', 'unresolved', 'maximumVerdict'], 'Step 2 independent critic');
  assertExactKeySet(critic.auditTarget, ['commit', 'tree'], 'Step 2 independent critic target');
  assertExactKeySet(critic.unresolved, ['P0', 'P1'], 'Step 2 independent critic unresolved');
  assert(critic.schemaVersion === 1 && critic.artifactId === 'cats-tower-step2-screen-projection-critic-round-001', 'Step 2 independent critic identity mismatch');
  const targetCommit = critic.auditTarget?.commit;
  const targetTree = critic.auditTarget?.tree;
  assert(targetCommit && targetTree === git(['rev-parse', `${targetCommit}^{tree}`]), 'Step 2 critic target commit/tree mismatch');
  if (seal) assert(seal.semanticCommit === targetCommit && seal.semanticTree === targetTree, 'v3 seal semantic target differs from the Step 2 critic');
  assert(critic.repository === '2hg7trp7rv-design/cats_tower' && critic.branch === 'kimi', 'Step 2 critic repository/branch mismatch');
  assert(critic.changeControl === step2CorrectionPath, 'Step 2 critic change-control mismatch');
  assert(critic.verdict === 'PASS_STEP2_SCREEN_PROJECTION_INDEPENDENT_CRITIC', 'Step 2 independent critic did not pass');
  assertCriticalFindingCounts(critic, 'Step 2 independent critic');
  const requiredCoverage = [
    'LOSSLESS_CANONICAL_SCREEN_PROJECTION',
    'CLOSED_V3_SCHEMA_AND_MUTATION_FIXTURES',
    'NUMERIC_NON_IMPACT_PROVEN'
  ];
  assert(JSON.stringify(critic.coverage) === JSON.stringify(requiredCoverage), 'Step 2 critic coverage is incomplete');
  assert(JSON.stringify(critic.findings) === JSON.stringify([{ id: 'S2-P0-SCREEN-PROJECTION-001', severity: 'P0', resolved: true }]), 'Step 2 critic finding set differs from the exact screen-projection P0 resolution');
  assert(critic.maximumVerdict === 'READY_FOR_STEP2_FINAL_JUDGE', 'Step 2 critic maximum verdict mismatch');
  const criticCommit = firstAddCommit(step2ReviewPaths.critic);
  assert(criticCommit && git(['rev-parse', `${criticCommit}^`]) === targetCommit, 'Step 2 critic must immediately follow the exact audited content');
  assertExactChangedPaths(targetCommit, criticCommit, [step2ReviewPaths.critic], 'Step 2 critic commit');
  assertAddedOnceAndUnchanged(step2ReviewPaths.critic, criticCommit);
  if (!presence.finalJudge) return { targetCommit, criticCommit };

  const judge = json(step2ReviewPaths.finalJudge);
  assertExactKeySet(judge, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'target', 'critic', 'verdict', 'coverage', 'findings', 'unresolved', 'resolvedFindings', 'maximumVerdict'], 'Step 2 final judge');
  assertExactKeySet(judge.target, ['commit', 'tree'], 'Step 2 final judge target');
  assertExactKeySet(judge.critic, ['path', 'blob'], 'Step 2 final judge critic binding');
  assertExactKeySet(judge.unresolved, ['P0', 'P1'], 'Step 2 final judge unresolved');
  assert(judge.schemaVersion === 1 && judge.artifactId === 'cats-tower-step2-screen-projection-final-judge-round-001' && judge.repository === critic.repository && judge.branch === critic.branch && judge.changeControl === step2CorrectionPath, 'Step 2 final judge identity or authority mismatch');
  assert(judge.target?.commit === targetCommit && judge.target?.tree === targetTree, 'Step 2 judge target differs from critic target');
  assert(judge.critic?.path === step2ReviewPaths.critic && judge.critic?.blob === git(['rev-parse', `HEAD:${step2ReviewPaths.critic}`]), 'Step 2 judge does not bind the critic');
  assert(judge.verdict === 'PASS_STEP2_SCREEN_PROJECTION_CORRECTION', 'Step 2 final judge did not pass');
  assertCriticalFindingCounts(judge, 'Step 2 final judge');
  assert(JSON.stringify(judge.findings) === JSON.stringify(critic.findings), 'Step 2 final judge finding set differs from the independent critic');
  assert(JSON.stringify(judge.coverage) === JSON.stringify(requiredCoverage), 'Step 2 final judge coverage is incomplete');
  assert(JSON.stringify(judge.resolvedFindings) === JSON.stringify(['S2-P0-SCREEN-PROJECTION-001']), 'Step 2 final judge did not exactly bind the resolved projection P0');
  assert(judge.maximumVerdict === 'READY_FOR_STEP2_COMPLETION_EVIDENCE', 'Step 2 final judge maximum verdict mismatch');
  const judgeCommit = firstAddCommit(step2ReviewPaths.finalJudge);
  assert(judgeCommit && git(['rev-parse', `${judgeCommit}^`]) === criticCommit, 'Step 2 final judge must immediately follow the independent critic');
  assertExactChangedPaths(criticCommit, judgeCommit, [step2ReviewPaths.finalJudge], 'Step 2 final-judge commit');
  assertAddedOnceAndUnchanged(step2ReviewPaths.finalJudge, judgeCommit);
  if (!presence.completion) return { targetCommit, criticCommit, judgeCommit };

  const completion = json(step2ReviewPaths.completion);
  assertExactKeySet(completion, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'finalJudge', 'verdict', 'unresolved', 'resolvedFindings', 'maximumVerdict'], 'Step 2 completion evidence');
  assertExactKeySet(completion.verifiedContent, ['commit', 'tree'], 'Step 2 completion verified content');
  assertExactKeySet(completion.finalJudge, ['path', 'blob'], 'Step 2 completion judge binding');
  assertExactKeySet(completion.unresolved, ['P0', 'P1'], 'Step 2 completion unresolved');
  assert(completion.schemaVersion === 1 && completion.artifactId === 'cats-tower-step2-screen-projection-completion-round-001' && completion.repository === critic.repository && completion.branch === critic.branch && completion.changeControl === step2CorrectionPath, 'Step 2 completion identity or authority mismatch');
  assert(completion.verifiedContent?.commit === targetCommit && completion.verifiedContent?.tree === targetTree, 'Step 2 completion target differs from critic target');
  assert(completion.finalJudge?.path === step2ReviewPaths.finalJudge && completion.finalJudge?.blob === git(['rev-parse', `HEAD:${step2ReviewPaths.finalJudge}`]), 'Step 2 completion does not bind the final judge');
  assert(completion.verdict === 'READY_FOR_STEP2_LIVE_READBACK' && completion.unresolved?.P0 === 0 && completion.unresolved?.P1 === 0, 'Step 2 completion evidence did not authorize live readback');
  assert(JSON.stringify(completion.resolvedFindings) === JSON.stringify(['S2-P0-SCREEN-PROJECTION-001']) && completion.maximumVerdict === 'READY_FOR_STEP2_LIVE_READBACK', 'Step 2 completion resolved set or maximum verdict mismatch');
  const completionCommit = firstAddCommit(step2ReviewPaths.completion);
  assert(completionCommit && git(['rev-parse', `${completionCommit}^`]) === judgeCommit, 'Step 2 completion must immediately follow the final judge');
  assertExactChangedPaths(judgeCommit, completionCommit, [step2ReviewPaths.completion], 'Step 2 completion commit');
  assertAddedOnceAndUnchanged(step2ReviewPaths.completion, completionCommit);
  if (!presence.liveReadback) return { targetCommit, criticCommit, judgeCommit, completionCommit };

  const readback = json(step2ReviewPaths.liveReadback);
  assertExactKeySet(readback, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'readbackTarget', 'completion', 'workflow', 'verdict', 'unresolved', 'resolvedFindings', 'maximumVerdict'], 'Step 2 live readback');
  assertExactKeySet(readback.readbackTarget, ['commit', 'tree'], 'Step 2 live readback target');
  assertExactKeySet(readback.completion, ['path', 'blob'], 'Step 2 live readback completion binding');
  assertExactKeySet(readback.unresolved, ['P0', 'P1'], 'Step 2 live readback unresolved');
  assert(readback.schemaVersion === 1 && readback.artifactId === 'cats-tower-step2-screen-projection-live-readback-round-001' && readback.repository === critic.repository && readback.branch === critic.branch && readback.changeControl === step2CorrectionPath, 'Step 2 live readback identity or authority mismatch');
  assert(readback.readbackTarget?.commit === targetCommit && readback.readbackTarget?.tree === targetTree, 'Step 2 live readback target differs from critic target');
  assert(readback.completion?.path === step2ReviewPaths.completion && readback.completion?.blob === git(['rev-parse', `HEAD:${step2ReviewPaths.completion}`]), 'Step 2 live readback does not bind completion evidence');
  assert(readback.verdict === 'READY_TO_SEAL_STEP2_V3_SCREEN_PROJECTION' && readback.unresolved?.P0 === 0 && readback.unresolved?.P1 === 0, 'Step 2 live readback did not authorize the v3 seal');
  assert(JSON.stringify(readback.resolvedFindings) === JSON.stringify(['S2-P0-SCREEN-PROJECTION-001']) && readback.maximumVerdict === 'READY_TO_SEAL_STEP2_V3_SCREEN_PROJECTION', 'Step 2 readback resolved set or maximum verdict mismatch');
  const workflow = readback.workflow;
  assert(workflow?.commit === targetCommit && workflow?.tree === targetTree && workflow?.conclusion === 'SUCCESS', 'Step 2 live readback workflow target or conclusion mismatch');
  assert(Number.isInteger(workflow?.runId) && workflow.runId > 0 && Number.isInteger(workflow?.jobId) && workflow.jobId > 0, 'Step 2 live readback workflow run/job missing');
  assert(Number.isInteger(workflow?.artifactId) && workflow.artifactId > 0 && /^sha256:[a-f0-9]{64}$/.test(workflow?.artifactDigest ?? ''), 'Step 2 live readback workflow artifact binding missing');
  assert(workflow.artifactName === `phase0-current-governance-${targetCommit}-${workflow.runId}-${workflow.runAttempt}`, 'Step 2 live readback workflow artifact name does not bind the semantic target/run/attempt');
  registerWorkflowEvidence(workflow, 'Step 2 live readback');
  const workflowText = text('.github/workflows/verify-current-governance.yml');
  for (const command of [
    'node simulation/validate-candidate-v3.mjs',
    'node simulation/validate-execution-contract-v3.mjs',
    'node simulation/validate-run-plan-v3.mjs',
    'node simulation/fixtures/v3/validate-fixtures.mjs',
    'node simulation/validate-result-v3.mjs',
    'node simulation/verify-step2-v3.mjs',
    `node ${v3ProjectionVerifierPath}`
  ]) assert(workflowText.includes(command), `Step 2 target workflow omits required pre-seal v3 command: ${command}`);
  const readbackCommit = firstAddCommit(step2ReviewPaths.liveReadback);
  assert(readbackCommit && git(['rev-parse', `${readbackCommit}^`]) === completionCommit, 'Step 2 live readback must immediately follow completion');
  assertExactChangedPaths(completionCommit, readbackCommit, [step2ReviewPaths.liveReadback], 'Step 2 live-readback commit');
  assertAddedOnceAndUnchanged(step2ReviewPaths.liveReadback, readbackCommit);
  if (!seal) return { targetCommit, criticCommit, judgeCommit, completionCommit, readbackCommit };

  const commits = {
    critic: criticCommit,
    finalJudge: judgeCommit,
    completion: completionCommit,
    liveReadback: readbackCommit,
    seal: firstAddCommit(v3SealPath)
  };
  assert(Object.values(commits).every(Boolean) && new Set(Object.values(commits)).size === 5, 'Step 2 critic, judge, completion, readback and seal must be five distinct commits');
  assert(targetCommit !== commits.critic && isAncestor(targetCommit, commits.critic), 'Step 2 critic must follow its exact audited content');
  assert(git(['rev-parse', `${commits.critic}^`]) === targetCommit, 'Step 2 critic must immediately follow the audited content');
  assert(git(['rev-parse', `${commits.finalJudge}^`]) === commits.critic, 'Step 2 final judge must immediately follow the independent critic');
  assert(git(['rev-parse', `${commits.completion}^`]) === commits.finalJudge, 'Step 2 completion must immediately follow the final judge');
  assert(git(['rev-parse', `${commits.liveReadback}^`]) === commits.completion, 'Step 2 live readback must immediately follow completion');
  assert(git(['rev-parse', `${commits.seal}^`]) === commits.liveReadback, 'v3 seal must immediately follow the Step 2 live readback');
  assertExactChangedPaths(targetCommit, commits.critic, [step2ReviewPaths.critic], 'Step 2 critic commit');
  assertExactChangedPaths(commits.critic, commits.finalJudge, [step2ReviewPaths.finalJudge], 'Step 2 final-judge commit');
  assertExactChangedPaths(commits.finalJudge, commits.completion, [step2ReviewPaths.completion], 'Step 2 completion commit');
  assertExactChangedPaths(commits.completion, commits.liveReadback, [step2ReviewPaths.liveReadback], 'Step 2 live-readback commit');
  assertExactChangedPaths(commits.liveReadback, commits.seal, [v3SealPath], 'Step 2 v3-seal commit');
  const reviewEvidenceSet = new Set(Object.values(step2ReviewPaths));
  for (const binding of seal.bindings) {
    if (!reviewEvidenceSet.has(binding.path)) {
      assert(git(['rev-parse', `${targetCommit}:${binding.path}`]) === binding.blob, `Step 2 critic target differs from v3 content binding: ${binding.path}`);
    }
  }
  for (const [key, file] of Object.entries(step2ReviewPaths)) {
    const blob = assertAddedOnceAndUnchanged(file, commits[key]);
    assert(seal.reviewEvidence?.[key]?.path === file && seal.reviewEvidence?.[key]?.blob === blob, `v3 seal does not bind immutable Step 2 ${key} evidence`);
  }
  const frozenFromSemanticTarget = seal.bindings.filter(binding => !reviewEvidenceSet.has(binding.path)).map(binding => binding.path);
  assertNoPathChangesSince(targetCommit, commits.seal, frozenFromSemanticTarget, 'Step 2 semantic target freeze through seal');
}

function verifyV3AuthorityPointers() {
  assert(JSON.stringify(authority.executableContract) === JSON.stringify(expectedPassStep2Authority), 'authority Step 2 PASS object differs from the exact v3 contract');
  assert(JSON.stringify(status.executableContract) === JSON.stringify(expectedV3AuthorityPointers), 'PROJECT_STATUS Step 2 v3 pointer mirror mismatch');
  assert(JSON.stringify(sim.step2) === JSON.stringify(expectedPassStep2Simulation), 'simulation Step 2 PASS object differs from the exact v3 contract');
  assert(JSON.stringify(dispatcher.step2ExecutableContract) === JSON.stringify(expectedV3AuthorityPointers), 'dispatcher Step 2 v3 pointer mirror mismatch');
  assert(dispatcher.canonicalSeals?.step2 === v3SealPath && dispatcher.scopeTruth?.step2 === 'PASS_CONTRACT', 'dispatcher Step 2 seal/status mirror mismatch');
  const expectedSnapshot = authoritySnapshotLine(authority, status);
  for (const file of ['QUALITY_GATE.md', 'PROJECT_HANDOVER.md', '.github/workflows/CURRENT_STATUS.md', 'AGENTS.md', 'README.md']) {
    const currentText = text(file);
    assert(currentText.includes('PASS_CONTRACT') && currentText.includes(v3SealPath), `current Markdown Step 2 v3 mirror mismatch: ${file}`);
    assertSingleAuthoritySnapshot(currentText, expectedSnapshot, file);
  }
}

function verifyDirectV3Semantics() {
  const canonicalPath = 'canonical/SCREEN_STATE_REGISTRY.json';
  const candidateV2Path = 'simulation/candidate-v2.json';
  const candidateV3Path = expectedV3AuthorityPointers.candidate;
  const runPlanV2Path = 'simulation/run-plan-v2.json';
  const runPlanV3Path = expectedV3AuthorityPointers.runPlan;
  const executionV2Path = 'simulation/execution-contract-v2.json';
  const executionV3Path = expectedV3AuthorityPointers.executionContract;
  const candidateSchemaV3Path = expectedV3AuthorityPointers.schema;
  const executionSchemaV3Path = expectedV3AuthorityPointers.executionContractSchema;
  const runPlanSchemaV3Path = expectedV3AuthorityPointers.runPlanSchema;
  const resultSchemaV3Path = expectedV3AuthorityPointers.resultSchema;
  const qualificationV2Path = 'quality-reviews/step-2-executable-contract-v2/qualification-result.json';
  const qualificationV3Path = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json';
  const acceptancePath = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/acceptance-matrix.json';
  const coveragePath = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/screen-projection-coverage-ledger.json';
  const numericImpactPath = 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/numeric-non-impact.json';
  const reviewEvidencePaths = new Set(Object.values(step2ReviewPaths));
  const directSemanticPaths = [...new Set([
    canonicalPath, candidateV2Path, candidateV3Path, runPlanV2Path, runPlanV3Path,
    executionV2Path, executionV3Path, candidateSchemaV3Path, executionSchemaV3Path,
    runPlanSchemaV3Path, resultSchemaV3Path, qualificationV2Path, qualificationV3Path,
    acceptancePath, coveragePath, numericImpactPath,
    ...requiredV3BindingPaths.filter(file => !reviewEvidencePaths.has(file))
  ])];
  for (const file of directSemanticPaths) {
    assert(exists(file), `direct v3 semantic input missing: ${file}`);
    assertRegularGitFile(file, 'direct v3 semantic verification');
  }
  assert(git(['rev-parse', `HEAD:${canonicalPath}`]) === '0cf6337da2ed3993136dbf4a9e4918efac501d2e', 'canonical screen registry blob changed');
  const canonical = json(canonicalPath);
  const candidateV2 = json(candidateV2Path);
  const candidateV3 = json(candidateV3Path);
  const expectedProjection = {
    count: String(canonical.screenCount),
    registry: canonical.screens,
    globalRules: canonical.globalRules,
    universalRecovery: canonical.universalRecovery,
    globalInvariants: canonical.globalInvariants
  };
  const acceptance = json(acceptancePath);
  assertExactKeySet(acceptance, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'scope', 'requirements', 'unresolved', 'verdict', 'maximumVerdict', 'releaseBoundaries'], 'Step 2 supplement Acceptance');
  assertExactKeySet(acceptance.unresolved, ['P0', 'P1'], 'Step 2 supplement Acceptance unresolved');
  assertExactKeySet(acceptance.releaseBoundaries, ['step4Pass', 'step5Allowed', 'productionAliasChanged', 'physicalIPhoneVerified', 'userVisualApproval', 'runtimeOrS02Changed'], 'Step 2 supplement Acceptance release boundaries');
  assert(acceptance.schemaVersion === 1 && acceptance.scope === 'VERSIONED_V3_SCREEN_PROJECTION_ONLY', 'Step 2 supplement Acceptance schema or scope mismatch');
  assert(acceptance.artifactId === 'cats-tower-step2-screen-projection-round-032-acceptance' && acceptance.repository === '2hg7trp7rv-design/cats_tower' && acceptance.branch === 'kimi' && acceptance.changeControl === step2CorrectionPath, 'Step 2 supplement Acceptance identity or authority mismatch');
  assert(acceptance.verdict === 'PASS_STEP2_SCREEN_PROJECTION_ACCEPTANCE' && acceptance.unresolved?.P0 === 0 && acceptance.unresolved?.P1 === 0 && acceptance.maximumVerdict === 'READY_FOR_STEP2_V3_INDEPENDENT_REVIEW', 'Step 2 supplement Acceptance verdict or boundary mismatch');
  const expectedAcceptanceRequirements = [
    'LOSSLESS_CANONICAL_SCREEN_PROJECTION',
    'V2_NON_SCREEN_CONTENT_EXACTLY_PRESERVED',
    'CLOSED_V3_SCHEMAS',
    'MUTATION_REJECTION_AND_POSITIVE_TEMP_COPY',
    'FROZEN_ENGINE_QUALIFICATION_REPRODUCTION',
    'NUMERIC_NON_IMPACT_PROVEN',
    'INDEPENDENT_REVIEW_CHAIN_REQUIRED',
    'RUNTIME_S02_PRODUCTION_UNCHANGED'
  ];
  assert(JSON.stringify(acceptance.requirements) === JSON.stringify(expectedAcceptanceRequirements.map(id => ({ id, status: 'PASS' }))), 'Step 2 supplement Acceptance requirements are incomplete');
  assert(JSON.stringify(acceptance.releaseBoundaries) === JSON.stringify({ step4Pass: false, step5Allowed: false, productionAliasChanged: false, physicalIPhoneVerified: false, userVisualApproval: false, runtimeOrS02Changed: false }), 'Step 2 supplement Acceptance release boundary mismatch');

  const coverage = json(coveragePath);
  const expectedFieldFamilies = ['id', 'name', 'responsibilities', 'authority', 'requiredState', 'uiStates', 'serverOwnedState'];
  assertExactKeySet(coverage, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'canonical', 'screenCount', 'fieldFamilies', 'screenCoverage', 'projectionSha256', 'unresolved', 'verdict', 'maximumVerdict'], 'screen-projection coverage ledger');
  assertExactKeySet(coverage.canonical, ['path', 'blob'], 'screen-projection coverage canonical binding');
  assertExactKeySet(coverage.unresolved, ['P0', 'P1'], 'screen-projection coverage unresolved');
  assert(coverage.schemaVersion === 1 && coverage.repository === '2hg7trp7rv-design/cats_tower' && coverage.branch === 'kimi' && coverage.changeControl === step2CorrectionPath && coverage.maximumVerdict === 'READY_FOR_STEP2_V3_INDEPENDENT_REVIEW', 'screen-projection coverage identity or maximum verdict mismatch');
  assert(coverage.artifactId === 'cats-tower-step2-screen-projection-coverage-ledger-round-001' && coverage.verdict === 'PASS_LOSSLESS_CANONICAL_SCREEN_PROJECTION' && coverage.unresolved?.P0 === 0 && coverage.unresolved?.P1 === 0, 'screen-projection coverage ledger verdict mismatch');
  assert(coverage.canonical?.path === canonicalPath && coverage.canonical?.blob === '0cf6337da2ed3993136dbf4a9e4918efac501d2e' && coverage.screenCount === '12', 'screen-projection coverage ledger canonical binding mismatch');
  assert(JSON.stringify(coverage.fieldFamilies) === JSON.stringify(expectedFieldFamilies), 'screen-projection coverage ledger field families are incomplete');
  const expectedScreenCoverage = canonical.screens.map(entry => ({
    id: entry.id,
    fieldFamilies: expectedFieldFamilies,
    canonicalEntrySha256: sha256Canonical(entry),
    status: 'PASS'
  }));
  assert(JSON.stringify(coverage.screenCoverage) === JSON.stringify(expectedScreenCoverage), 'screen-projection coverage ledger does not bind all 12 canonical entries and field families');
  assert(coverage.projectionSha256 === 'ebee3d249b83c6f7037f7a59853d45866c486d35cd298384e7e569715b44f22e', 'screen-projection coverage digest mismatch');

  const numericImpact = json(numericImpactPath);
  assertExactKeySet(numericImpact, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'changedJsonPointers', 'engineConsumerCount', 'consumerScan', 'candidateOutsideScreens', 'qualification', 'executionRerunClaim', 'step3StatusRemains', 'runtimeOrS02Changed', 'unresolved', 'verdict', 'maximumVerdict'], 'numeric non-impact evidence');
  assertExactKeySet(numericImpact.consumerScan, ['files', 'literalMatches'], 'numeric non-impact consumer scan');
  assertExactKeySet(numericImpact.candidateOutsideScreens, ['beforeSha256', 'afterSha256'], 'numeric non-impact outside-screens proof');
  assertExactKeySet(numericImpact.qualification, ['beforeDeterministicPayloadSha256', 'afterDeterministicPayloadSha256', 'deepEqual'], 'numeric non-impact qualification proof');
  assertExactKeySet(numericImpact.unresolved, ['P0', 'P1'], 'numeric non-impact unresolved');
  assert(numericImpact.schemaVersion === 1 && numericImpact.repository === '2hg7trp7rv-design/cats_tower' && numericImpact.branch === 'kimi' && numericImpact.changeControl === step2CorrectionPath && numericImpact.maximumVerdict === 'READY_FOR_STEP2_V3_INDEPENDENT_REVIEW', 'numeric non-impact identity or maximum verdict mismatch');
  assert(numericImpact.artifactId === 'cats-tower-step2-screen-projection-numeric-non-impact-round-001' && numericImpact.verdict === 'PASS_NUMERIC_NON_IMPACT_NO_STEP3_RERUN_REQUIRED' && numericImpact.unresolved?.P0 === 0 && numericImpact.unresolved?.P1 === 0, 'numeric non-impact verdict mismatch');
  assert(JSON.stringify(numericImpact.changedJsonPointers) === JSON.stringify(['/screens']) && numericImpact.engineConsumerCount === 0, 'numeric non-impact evidence does not prove a screens-only, zero-engine-consumer change');
  const numericConsumerFiles = [
    'simulation/engine-v2/economy.mjs',
    'simulation/engine-v2/hash.mjs',
    'simulation/engine-v2/high-volume.mjs',
    'simulation/engine-v2/index.mjs',
    'simulation/engine-v2/numeric.mjs',
    'simulation/engine-v2/rng.mjs',
    'simulation/engine-v2/run-plan.mjs',
    'simulation/engine-v2/run-scenario.mjs',
    'simulation/engine-v2/state-machines.mjs',
    'simulation/engine-v2/statistics.mjs',
    'simulation/engine-v2/tower.mjs',
    'simulation/lib-v2/schema-validator.mjs',
    'simulation/migrations/v1-to-v2/migration-map.json'
  ];
  const screenConsumerMatches = numericConsumerFiles.flatMap(file => {
    const matches = text(file).match(/(?:\.screens\b|\[['"]screens['"]\])/g) ?? [];
    return matches.map(match => ({ file, match }));
  });
  assert(screenConsumerMatches.length === 0, `trusted frozen engine has candidate.screens consumers: ${JSON.stringify(screenConsumerMatches)}`);
  assert(JSON.stringify(numericImpact.consumerScan?.files) === JSON.stringify(numericConsumerFiles) && numericImpact.consumerScan?.literalMatches === 0, 'numeric non-impact consumer-scan manifest mismatch');
  assert(numericImpact.candidateOutsideScreens?.beforeSha256 === 'dc0eb575481b866dab14a904957b582c513ec93fd96445f3985919ea9e217d85' && numericImpact.candidateOutsideScreens?.afterSha256 === numericImpact.candidateOutsideScreens.beforeSha256, 'numeric non-impact outside-screens digest mismatch');
  assert(numericImpact.qualification?.beforeDeterministicPayloadSha256 === 'a24fa5a4a12cf132ac477c80e77431cd0b97ab070bbbef83c3881c160f42562c' && numericImpact.qualification?.afterDeterministicPayloadSha256 === numericImpact.qualification.beforeDeterministicPayloadSha256 && numericImpact.qualification?.deepEqual === true, 'numeric non-impact qualification proof mismatch');
  assert(numericImpact.executionRerunClaim === 'NO_STEP3_EXECUTION_RERUN_CLAIMED' && numericImpact.step3StatusRemains === 'PASS_MODEL' && numericImpact.runtimeOrS02Changed === false, 'numeric non-impact evidence overclaims execution or product changes');

  const fixtureManifestPath = 'simulation/fixtures/v3/manifest.json';
  const fixtureNegativePath = 'simulation/fixtures/v3/negative.json';
  const fixtureValidatorPath = 'simulation/fixtures/v3/validate-fixtures.mjs';
  const expectedFixtureCases = [
    { id: 'screen-count-drift', target: 'candidate-v3', expectedCode: 'SCHEMA' },
    { id: 'screen-id-drift', target: 'candidate-v3', expectedCode: 'SCHEMA' },
    { id: 'screen-entry-drift', target: 'candidate-v3', expectedCode: 'SCHEMA' },
    { id: 'global-rules-drift', target: 'candidate-v3', expectedCode: 'SCHEMA' },
    { id: 'universal-recovery-drift', target: 'candidate-v3', expectedCode: 'SCHEMA' },
    { id: 'global-invariants-drift', target: 'candidate-v3', expectedCode: 'SCHEMA' },
    { id: 'candidate-extra-property', target: 'candidate-v3', expectedCode: 'SCHEMA' },
    { id: 'execution-contract-id-drift', target: 'execution-contract-v3', expectedCode: 'SCHEMA' },
    { id: 'run-plan-id-drift', target: 'run-plan-v3', expectedCode: 'SCHEMA' },
    { id: 'result-candidate-digest-drift', target: 'result-v3', expectedCode: 'SCHEMA' },
    { id: 'result-false-step3-authorization', target: 'result-v3', expectedCode: 'SCHEMA' }
  ];
  const fixtureNegative = json(fixtureNegativePath);
  assert(JSON.stringify(fixtureNegative) === JSON.stringify({
    schemaVersion: 1,
    artifactId: 'cats-tower-step2-v3-negative-fixtures-round-001',
    caseCount: String(expectedFixtureCases.length),
    cases: expectedFixtureCases
  }), 'v3 negative fixture catalog differs from the exact independently exercised case set');
  const fixtureManifest = json(fixtureManifestPath);
  const expectedFixtureManifest = {
    schemaVersion: 1,
    artifactId: 'cats-tower-step2-v3-fixture-manifest-round-001',
    verdict: 'PASS_CLOSED_V3_MUTATION_FIXTURES',
    caseCount: String(expectedFixtureCases.length),
    caseIds: expectedFixtureCases.map(entry => entry.id),
    files: [
      { path: fixtureNegativePath, sha256: sha256Text(text(fixtureNegativePath)), bytes: String(Buffer.byteLength(text(fixtureNegativePath), 'utf8')) },
      { path: fixtureValidatorPath, sha256: sha256Text(text(fixtureValidatorPath)), bytes: String(Buffer.byteLength(text(fixtureValidatorPath), 'utf8')) }
    ]
  };
  assert(JSON.stringify(fixtureManifest) === JSON.stringify(expectedFixtureManifest), 'v3 fixture manifest does not exactly bind the negative catalog and validator');
  assert(JSON.stringify(candidateV3.screens) === JSON.stringify(expectedProjection), 'candidate-v3 screens is not the lossless canonical projection');
  assert(sha256Canonical(candidateV3.screens) === 'ebee3d249b83c6f7037f7a59853d45866c486d35cd298384e7e569715b44f22e', 'candidate-v3 screen projection digest mismatch');
  const { screens: ignoredV2Screens, ...outsideV2 } = candidateV2;
  const { screens: ignoredV3Screens, ...outsideV3 } = candidateV3;
  assert(JSON.stringify(outsideV3) === JSON.stringify(outsideV2), 'candidate-v3 changed content outside /screens');
  assert(sha256Canonical(outsideV3) === 'dc0eb575481b866dab14a904957b582c513ec93fd96445f3985919ea9e217d85', 'candidate-v3 outside-screens digest mismatch');
  assert(JSON.stringify(candidateV3) === JSON.stringify({ ...candidateV2, screens: expectedProjection }), 'candidate-v3 differs from the exact corrected candidate projection');
  const candidateSchemaV3 = json(candidateSchemaV3Path);
  const expectedCandidateSchemaV3 = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cats-tower.invalid/schema/candidate-v3.schema.json',
    title: "Cat's Tower candidate V3 screen-projection supplement",
    description: 'Exact immutable candidate for the versioned screen-projection correction. All non-screen semantics remain V2.',
    const: candidateV3
  };
  assert(JSON.stringify(candidateSchemaV3) === JSON.stringify(expectedCandidateSchemaV3), 'candidate-v3 schema is not the exact reviewed immutable contract');
  assertSchema(candidateV3, candidateSchemaV3);
  const candidateWithExtra = structuredClone(candidateV3);
  candidateWithExtra.__unexpected = true;
  assertSchemaRejects(candidateWithExtra, candidateSchemaV3, 'candidate-v3 extra top-level property');
  const candidateWithScreenDrift = structuredClone(candidateV3);
  candidateWithScreenDrift.screens.registry[0].name = 'invalid-screen-name';
  assertSchemaRejects(candidateWithScreenDrift, candidateSchemaV3, 'candidate-v3 canonical screen const');

  const runPlanV2 = json(runPlanV2Path);
  const runPlanV3 = json(runPlanV3Path);
  const expectedRunPlanV3 = structuredClone(runPlanV2);
  expectedRunPlanV3.planId = 'cats-tower-run-plan-v3';
  expectedRunPlanV3.executionContract = {
    path: expectedV3AuthorityPointers.executionContract,
    schemaPath: expectedV3AuthorityPointers.executionContractSchema,
    validatorPath: expectedV3AuthorityPointers.executionContractValidator
  };
  expectedRunPlanV3.output.qualificationPath = qualificationV3Path;
  expectedRunPlanV3.output.qualificationSchemaPath = expectedV3AuthorityPointers.resultSchema;
  assert(JSON.stringify(runPlanV3) === JSON.stringify(expectedRunPlanV3), 'run-plan-v3 differs outside reviewed versioned path bindings');
  const runPlanSchemaV3 = json(runPlanSchemaV3Path);
  const expectedRunPlanSchemaV3 = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cats-tower.invalid/schema/run-plan-v3.schema.json',
    title: "Cat's Tower run plan V3 screen-projection supplement",
    description: 'Exact immutable run plan for the versioned screen-projection correction.',
    const: expectedRunPlanV3
  };
  assert(JSON.stringify(runPlanSchemaV3) === JSON.stringify(expectedRunPlanSchemaV3), 'run-plan-v3 schema is not the exact reviewed const contract');
  assertSchema(runPlanV3, runPlanSchemaV3);

  const executionV2 = json(executionV2Path);
  const executionV3 = json(executionV3Path);
  const expectedExecutionV3 = structuredClone(executionV2);
  expectedExecutionV3.contractId = 'cats-tower-step3-execution-contract-v3';
  expectedExecutionV3.sourcePaths = {
    candidate: candidateV3Path,
    runPlan: runPlanV3Path,
    acceptance: 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/acceptance-matrix.json'
  };
  expectedExecutionV3.resultContracts.qualificationSchema = expectedV3AuthorityPointers.resultSchema;
  expectedExecutionV3.resultContracts.qualificationValidator = expectedV3AuthorityPointers.resultValidator;
  assert(JSON.stringify(executionV3) === JSON.stringify(expectedExecutionV3), 'execution-contract-v3 differs outside reviewed versioned path bindings');
  const executionSchemaV3 = json(executionSchemaV3Path);
  const expectedExecutionSchemaV3 = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cats-tower.invalid/schema/execution-contract-v3.schema.json',
    title: "Cat's Tower execution contract V3 screen-projection supplement",
    description: 'Exact immutable execution contract for the versioned screen-projection correction; numeric execution semantics remain V2.',
    const: expectedExecutionV3
  };
  assert(JSON.stringify(executionSchemaV3) === JSON.stringify(expectedExecutionSchemaV3), 'execution-contract-v3 schema is not the exact reviewed const contract');
  assertSchema(executionV3, executionSchemaV3);

  const qualificationV2 = json(qualificationV2Path);
  const qualificationV3 = json(qualificationV3Path);
  assert(text(v3QualificationRunnerPath) === exactV3QualificationRunnerSource(), 'v3 qualification runner is not the exact reviewed wrapper around the frozen engine');
  assert(JSON.stringify(qualificationV3.deterministicPayload) === JSON.stringify(qualificationV2.deterministicPayload), 'v3 qualification deterministic payload differs from sealed v2');
  assert(qualificationV3.hashes?.deterministicPayloadSha256 === 'a24fa5a4a12cf132ac477c80e77431cd0b97ab070bbbef83c3881c160f42562c', 'v3 qualification known payload digest mismatch');
  assert(qualificationV3.hashes.deterministicPayloadSha256 === sha256Canonical(qualificationV3.deterministicPayload), 'v3 qualification payload digest was not recomputed');
  assert(qualificationV3.hashes.candidateSha256 === sha256Text(text(candidateV3Path)), 'v3 qualification candidate digest mismatch');
  assert(qualificationV3.hashes.runPlanSha256 === sha256Text(text(runPlanV3Path)), 'v3 qualification run-plan digest mismatch');
  assert(qualificationV3.hashes.executionContractSha256 === sha256Text(text(executionV3Path)), 'v3 qualification execution-contract digest mismatch');
  assert(qualificationV3.deterministicPayload?.scenarioCount === '30' && qualificationV3.deterministicPayload?.violations?.length === 0, 'v3 qualification scope or violations mismatch');
  assert(/^v22\.\d+\.\d+$/.test(qualificationV3.evidence?.runtimeVersion ?? ''), 'v3 qualification runtimeVersion must be an exact Node 22 semantic version');
  const qualificationExecutedAt = Date.parse(qualificationV3.evidence?.executedAt ?? '');
  assert(Number.isFinite(qualificationExecutedAt) && new Date(qualificationExecutedAt).toISOString() === qualificationV3.evidence.executedAt, 'v3 qualification executedAt must be a canonical ISO UTC timestamp');
  assert(qualificationV3.evidence.reproductionCommand === 'node simulation/run-qualification-v3.mjs', 'v3 qualification reproductionCommand is not the exact V3 wrapper command');
  const resultSchemaV3 = json(resultSchemaV3Path);
  const expectedResultSchemaV3 = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cats-tower.invalid/schema/result-v3.schema.json',
    title: "Cat's Tower Step 2 qualification result V3 screen-projection supplement",
    description: 'Exact immutable qualification envelope reproduced with the frozen V2 numeric engine and versioned V3 metadata inputs.',
    const: qualificationV3
  };
  assert(JSON.stringify(resultSchemaV3) === JSON.stringify(expectedResultSchemaV3), 'result-v3 schema is not the exact reviewed immutable qualification contract');
  assertSchema(qualificationV3, resultSchemaV3);
  const invalidQualificationVerdict = structuredClone(qualificationV3);
  invalidQualificationVerdict.verdict.step3AuthorizedByThisResult = true;
  assertSchemaRejects(invalidQualificationVerdict, resultSchemaV3, 'result-v3 false Step 3 authorization');
  const strictValidatorSources = [
    {
      path: expectedV3AuthorityPointers.candidateValidator,
      defaultDataPath: candidateV3Path,
      schemaPath: candidateSchemaV3Path,
      artifactId: 'cats-tower-candidate-v3-validator'
    },
    {
      path: expectedV3AuthorityPointers.executionContractValidator,
      defaultDataPath: executionV3Path,
      schemaPath: executionSchemaV3Path,
      artifactId: 'cats-tower-execution-contract-v3-validator'
    },
    {
      path: expectedV3AuthorityPointers.runPlanValidator,
      defaultDataPath: runPlanV3Path,
      schemaPath: runPlanSchemaV3Path,
      artifactId: 'cats-tower-run-plan-v3-validator'
    },
    {
      path: expectedV3AuthorityPointers.resultValidator,
      defaultDataPath: qualificationV3Path,
      schemaPath: resultSchemaV3Path,
      artifactId: 'cats-tower-result-v3-validator'
    }
  ];
  for (const config of strictValidatorSources) {
    assert(text(config.path) === strictSchemaAdapterSource(config), `versioned validator is not the exact reviewed fail-closed schema adapter: ${config.path}`);
  }

  if (!skipCandidateExecution) {
    const reproductionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cats-tower-v3-qualification-'));
    const reproducedPath = path.join(reproductionDirectory, 'qualification-result-v3.json');
    try {
      execFileSync(process.execPath, [
        rel(v3QualificationRunnerPath),
        '--output', reproducedPath
      ], { cwd: root, encoding: 'utf8', stdio: 'pipe', env: { PATH: process.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' } });
      const reproduced = JSON.parse(fs.readFileSync(reproducedPath, 'utf8'));
      assert(/^v22\.\d+\.\d+$/.test(reproduced.evidence?.runtimeVersion ?? ''), 'reproduced v3 qualification runtimeVersion is invalid');
      const reproducedExecutedAt = Date.parse(reproduced.evidence?.executedAt ?? '');
      assert(Number.isFinite(reproducedExecutedAt) && new Date(reproducedExecutedAt).toISOString() === reproduced.evidence.executedAt, 'reproduced v3 qualification executedAt is invalid');
      assert(reproduced.evidence.reproductionCommand === 'node simulation/run-qualification-v3.mjs', 'reproduced v3 qualification command is not self-contained');
      const normalizeRuntimeEvidence = value => {
        const copy = structuredClone(value);
        copy.evidence.runtimeVersion = '<NORMALIZED_RUNTIME>';
        copy.evidence.executedAt = '<NORMALIZED_TIME>';
        return copy;
      };
      assert(JSON.stringify(normalizeRuntimeEvidence(qualificationV3)) === JSON.stringify(normalizeRuntimeEvidence(reproduced)), 'stored v3 qualification envelope differs from a trusted frozen-engine reproduction');
    } finally {
      fs.rmSync(reproductionDirectory, { recursive: true, force: true });
    }
  }
}

function verifyV3MutationRejection() {
  const validator = expectedV3AuthorityPointers.candidateValidator;
  const candidate = json(expectedV3AuthorityPointers.candidate);
  execFileSync(process.execPath, [rel(validator), rel(expectedV3AuthorityPointers.candidate)], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cats-tower-v3-mutations-'));
  let ordinal = 0;
  const writeFixture = value => {
    const fixturePath = path.join(tempDirectory, `${randomUUID()}.json`);
    ordinal += 1;
    fs.writeFileSync(fixturePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return fixturePath;
  };
  const expectReject = (mutate, label) => {
    const fixture = structuredClone(candidate);
    mutate(fixture);
    const fixturePath = writeFixture(fixture);
    let rejected = false;
    let output = '';
    try {
      execFileSync(process.execPath, [rel(validator), fixturePath], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      rejected = true;
      output = [error?.stdout, error?.stderr].filter(Boolean).join('\n');
    }
    assert(rejected, `v3 validator accepted mutation: ${label}`);
    let diagnostic;
    try {
      diagnostic = JSON.parse(output.trim());
    } catch {
      throw new Error(`v3 validator rejected ${label} without one structured JSON diagnostic`);
    }
    const codes = (diagnostic.errors ?? []).map(entry => entry.code);
    assert(JSON.stringify(codes) === JSON.stringify(['SCHEMA']), `v3 validator diagnostic for ${label} is not exactly one SCHEMA error`);
  };
  try {
    const validCandidateCopy = writeFixture(candidate);
    execFileSync(process.execPath, [rel(validator), validCandidateCopy], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    expectReject(value => { value.screens.count = '11'; }, 'count drift');
    expectReject(value => { value.screens.registry.pop(); }, 'missing screen');
    expectReject(value => { value.screens.registry[0].id = 'NOT_S02'; }, 'unknown screen ID');
    expectReject(value => { value.screens.registry[1].id = 'S01'; }, 'duplicate screen ID');
    expectReject(value => { [value.screens.registry[0], value.screens.registry[1]] = [value.screens.registry[1], value.screens.registry[0]]; }, 'screen order');
    const entryMutations = {
      name: entry => { entry.name = 'formation'; },
      responsibilities: entry => { entry.responsibilities = ['BANANA']; },
      authority: entry => { entry.authority = 'PINEAPPLE'; },
      requiredState: entry => { entry.requiredState = ['BANANA']; },
      uiStates: entry => { entry.uiStates = ['PINEAPPLE']; },
      serverOwnedState: entry => { entry.serverOwnedState = ['NOT_S02']; }
    };
    for (let index = 0; index < candidate.screens.registry.length; index += 1) {
      for (const [field, mutateEntry] of Object.entries(entryMutations)) {
        expectReject(value => mutateEntry(value.screens.registry[index]), `S${String(index + 1).padStart(2, '0')} ${field}`);
      }
    }
    for (const legacyField of ['responsibility', 'normalStates', 'errorStates', 'retryIdempotent', 'serverAuthorityVisible']) {
      expectReject(value => { value.screens.registry[0][legacyField] = legacyField === 'retryIdempotent' ? true : []; }, `legacy entry field ${legacyField}`);
    }
    for (const legacyField of ['battleScreenCommerceDetailPersistent', 'recoveryStatesRequired']) {
      expectReject(value => { value.screens[legacyField] = true; }, `legacy screens field ${legacyField}`);
    }
    for (const key of Object.keys(candidate.screens.globalRules)) {
      expectReject(value => { delete value.screens.globalRules[key]; }, `global rule ${key}`);
    }
    for (let index = 0; index < candidate.screens.universalRecovery.length; index += 1) {
      expectReject(value => { value.screens.universalRecovery.splice(index, 1); }, `universal recovery ${index}`);
    }
    for (let index = 0; index < candidate.screens.globalInvariants.length; index += 1) {
      expectReject(value => { value.screens.globalInvariants.splice(index, 1); }, `global invariant ${index}`);
    }

    const verifyVersionedValidator = ({ source, validator: validatorPath, mutate, label }) => {
      const validValue = json(source);
      const validPath = writeFixture(validValue);
      execFileSync(process.execPath, [rel(validatorPath), validPath], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
      const invalidValue = structuredClone(validValue);
      mutate(invalidValue);
      const invalidPath = writeFixture(invalidValue);
      let rejected = false;
      let output = '';
      try {
        execFileSync(process.execPath, [rel(validatorPath), invalidPath], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
      } catch (error) {
        rejected = true;
        output = [error?.stdout, error?.stderr].filter(Boolean).join('\n');
      }
      let diagnostic = null;
      try {
        diagnostic = JSON.parse(output.trim());
      } catch {}
      const codes = (diagnostic?.errors ?? []).map(entry => entry.code);
      assert(rejected && JSON.stringify(codes) === JSON.stringify(['SCHEMA']), `${label} validator did not reject a temp-file mutation with exactly one SCHEMA diagnostic`);
    };
    verifyVersionedValidator({
      source: expectedV3AuthorityPointers.executionContract,
      validator: expectedV3AuthorityPointers.executionContractValidator,
      mutate: value => { value.contractId = 'cats-tower-invalid-contract'; },
      label: 'execution-contract-v3'
    });
    verifyVersionedValidator({
      source: expectedV3AuthorityPointers.runPlan,
      validator: expectedV3AuthorityPointers.runPlanValidator,
      mutate: value => { value.planId = 'cats-tower-invalid-plan'; },
      label: 'run-plan-v3'
    });
    verifyVersionedValidator({
      source: 'quality-reviews/step-2-executable-contract-v2/supplement-screen-projection-round-001/qualification-result-v3.json',
      validator: expectedV3AuthorityPointers.resultValidator,
      mutate: value => { value.hashes.candidateSha256 = '0'.repeat(64); },
      label: 'result-v3'
    });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function verifyV3SealArtifact() {
  assert(exists(v3SealPath), 'Step 2 PASS requires a v3 seal');
  const seal = json(v3SealPath);
  assert(JSON.stringify(Object.keys(seal)) === JSON.stringify(['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verdict', 'semanticCommit', 'semanticTree', 'bindings', 'reviewEvidence']), 'Step 2 v3 seal top-level shape or ordering mismatch');
  assert(seal.schemaVersion === '3.0.0' && seal.artifactId === 'cats-tower-step2-executable-seal-v3-screen-projection-round-001', 'Step 2 v3 seal identity mismatch');
  assert(seal.repository === '2hg7trp7rv-design/cats_tower' && seal.branch === 'kimi' && seal.changeControl === step2CorrectionPath, 'Step 2 v3 seal authority mismatch');
  assert(seal.verdict === 'SEALED_STEP2_EXECUTABLE_CONTRACT_SCREEN_PROJECTION_CORRECTED', 'Step 2 PASS v3 seal verdict mismatch');
  assert(Array.isArray(seal.bindings) && seal.bindings.length > 0, 'Step 2 PASS v3 seal has no bindings');
  const bindingPaths = seal.bindings.map(binding => binding.path);
  assert(JSON.stringify(bindingPaths) === JSON.stringify(requiredV3BindingPaths), 'Step 2 PASS v3 seal binding paths/order differ from the exact reviewed dependency closure');
  for (const binding of seal.bindings) {
    assert(typeof binding.path === 'string' && /^[a-f0-9]{40}$/.test(binding.blob ?? ''), 'Step 2 PASS v3 seal contains an invalid binding');
    assert(exists(binding.path), `Step 2 PASS v3 binding missing: ${binding.path}`);
    assertRegularGitFile(binding.path, 'Step 2 PASS v3 binding');
    assert(git(['rev-parse', `HEAD:${binding.path}`]) === binding.blob, `Step 2 PASS v3 binding changed: ${binding.path}`);
  }
  const bindingSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'blob'],
    properties: {
      path: { type: 'string', minLength: 1 },
      blob: { type: 'string', pattern: '^[a-f0-9]{40}$' }
    }
  };
  const reviewSchemaProperties = Object.fromEntries(Object.keys(step2ReviewPaths).map(key => [key, bindingSchema]));
  const expectedSealSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cats-tower.invalid/schema/executable-seal-v3.schema.json',
    title: "Cat's Tower Step 2 executable seal V3 screen-projection supplement",
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verdict', 'semanticCommit', 'semanticTree', 'bindings', 'reviewEvidence'],
    properties: {
      schemaVersion: { const: '3.0.0' },
      artifactId: { const: 'cats-tower-step2-executable-seal-v3-screen-projection-round-001' },
      repository: { const: '2hg7trp7rv-design/cats_tower' },
      branch: { const: 'kimi' },
      changeControl: { const: step2CorrectionPath },
      verdict: { const: 'SEALED_STEP2_EXECUTABLE_CONTRACT_SCREEN_PROJECTION_CORRECTED' },
      semanticCommit: { type: 'string', pattern: '^[a-f0-9]{40}$' },
      semanticTree: { type: 'string', pattern: '^[a-f0-9]{40}$' },
      bindings: { type: 'array', minItems: requiredV3BindingPaths.length, maxItems: requiredV3BindingPaths.length, uniqueItems: true, items: bindingSchema },
      reviewEvidence: { type: 'object', additionalProperties: false, required: Object.keys(step2ReviewPaths), properties: reviewSchemaProperties }
    }
  };
  const sealSchema = json('simulation/executable-seal-v3.schema.json');
  assert(JSON.stringify(sealSchema) === JSON.stringify(expectedSealSchema), 'Step 2 v3 seal schema differs from the exact reviewed closed schema');
  assertSchema(seal, sealSchema);
  const sealCommit = firstAddCommit(v3SealPath);
  assert(sealCommit && assertAddedOnceAndUnchanged(v3SealPath, sealCommit) === git(['rev-parse', `HEAD:${v3SealPath}`]), 'v3 seal changed after first addition');
  assert(preSealV3Verified, 'Step 2 v3 seal cannot pass before the trusted pre-seal semantic and mutation gates pass');
  verifyStep2ReviewEvidence(seal);
  runNodeVerifier(v3SealValidatorPath, 'Step 2 v3 seal');
  return seal;
}

function verifyContinuityClaims(continuity, v3Seal) {
  assertRegularGitFile(step2ContinuityPath, 'Step 3 continuity evidence');
  assertExactKeySet(continuity, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verdict', 'changedJsonPointers', 'candidateOutsideScreens', 'qualification', 'candidateFiles', 'v3Seal', 'step3Status', 'runtimeOrS02Changed', 'unresolved', 'maximumVerdict'], 'Step 3 continuity bridge');
  assertExactKeySet(continuity.candidateOutsideScreens, ['beforeSha256', 'afterSha256'], 'Step 3 continuity outside-screens proof');
  assertExactKeySet(continuity.qualification, ['beforeDeterministicPayloadSha256', 'afterDeterministicPayloadSha256', 'deepEqual'], 'Step 3 continuity qualification proof');
  assertExactKeySet(continuity.candidateFiles, ['beforeSha256', 'afterSha256'], 'Step 3 continuity candidate files');
  assertExactKeySet(continuity.v3Seal, ['path', 'blob'], 'Step 3 continuity v3 seal binding');
  assertExactKeySet(continuity.unresolved, ['P0', 'P1'], 'Step 3 continuity unresolved');
  assert(continuity.schemaVersion === 1 && continuity.artifactId === 'cats-tower-step3-continuity-bridge-screen-projection-round-001' && continuity.repository === '2hg7trp7rv-design/cats_tower' && continuity.branch === 'kimi' && continuity.changeControl === step2CorrectionPath, 'Step 3 continuity identity or authority mismatch');
  assert(continuity.verdict === 'PASS_STEP3_NUMERIC_MODEL_CONTINUITY_NO_EXECUTION_RERUN_REQUIRED', 'Step 3 continuity bridge verdict wrong');
  assert(continuity.step3Status === 'PASS_MODEL' && continuity.runtimeOrS02Changed === false && continuity.unresolved.P0 === 0 && continuity.unresolved.P1 === 0 && continuity.maximumVerdict === 'READY_FOR_STEP2_PASS_ACTIVATION', 'Step 3 continuity release or maximum-verdict boundary mismatch');
  assert(continuity.changedJsonPointers?.length === 1 && continuity.changedJsonPointers[0] === '/screens', 'Step 3 continuity bridge does not prove a screens-only change');
  const outsideBefore = continuity.candidateOutsideScreens?.beforeSha256;
  const outsideAfter = continuity.candidateOutsideScreens?.afterSha256;
  assert(/^[a-f0-9]{64}$/.test(outsideBefore ?? '') && /^[a-f0-9]{64}$/.test(outsideAfter ?? ''), 'non-screen candidate hashes are missing');
  assert(outsideBefore === outsideAfter, 'non-screen candidate content changed');
  assert(outsideBefore === 'dc0eb575481b866dab14a904957b582c513ec93fd96445f3985919ea9e217d85', 'non-screen candidate digest differs from the independently derived value');
  const payloadBefore = continuity.qualification?.beforeDeterministicPayloadSha256;
  const payloadAfter = continuity.qualification?.afterDeterministicPayloadSha256;
  assert(/^[a-f0-9]{64}$/.test(payloadBefore ?? '') && /^[a-f0-9]{64}$/.test(payloadAfter ?? ''), 'qualification deterministic payload hashes are missing');
  assert(payloadBefore === payloadAfter, 'qualification deterministic payload changed');
  assert(payloadBefore === 'a24fa5a4a12cf132ac477c80e77431cd0b97ab070bbbef83c3881c160f42562c', 'qualification digest differs from the sealed deterministic payload');
  assert(continuity.qualification?.deepEqual === true, 'qualification payload deep equality missing');
  const v2CandidateDigest = sha256Text(text('simulation/candidate-v2.json'));
  const v3CandidateDigest = sha256Text(text('simulation/candidate-v3.json'));
  assert(continuity.candidateFiles?.beforeSha256 === v2CandidateDigest && continuity.candidateFiles?.afterSha256 === v3CandidateDigest, 'continuity candidate file digests were not recomputed');
  assert(v2CandidateDigest !== v3CandidateDigest, 'corrected candidate file digest did not change');
  assert(continuity.v3Seal?.path === v3SealPath, 'continuity bridge does not bind v3 seal path');
  assert(continuity.v3Seal?.blob === git(['rev-parse', `HEAD:${v3SealPath}`]), 'continuity bridge v3 seal blob mismatch');
  assert(continuity.v3Seal.blob === git(['hash-object', v3SealPath]), 'continuity bridge v3 seal worktree hash mismatch');
  assert(v3Seal.verdict === 'SEALED_STEP2_EXECUTABLE_CONTRACT_SCREEN_PROJECTION_CORRECTED', 'continuity bridge used an invalid v3 seal');
}

let preSealV3Verified = false;
if (exists(expectedV3AuthorityPointers.candidate)) {
  assert(step2Correction, 'versioned Step 2 candidate exists without the frozen round 032 authority');
  verifyDirectV3Semantics();
  if (!skipCandidateExecution) verifyV3MutationRejection();
  runNodeVerifier('simulation/fixtures/v3/validate-fixtures.mjs', 'Step 2 v3 mutation fixtures');
  runNodeVerifier('simulation/verify-step2-v3.mjs', 'Step 2 complete v3 contract');
  runNodeVerifier(v3ProjectionVerifierPath, 'Step 2 screen projection');
  preSealV3Verified = true;
}

if (Object.values(step2ReviewPaths).some(file => exists(file))) {
  assert(preSealV3Verified, 'Step 2 numbered review evidence exists before the trusted v3 semantic target passes');
  verifyStep2ReviewEvidence(null);
}

let preActivatedV3Seal = null;
if (exists(v3SealPath)) {
  assert(preSealV3Verified, 'Step 2 v3 seal exists before the trusted pre-seal semantic and mutation gates pass');
  preActivatedV3Seal = verifyV3SealArtifact();
}

let preActivatedContinuity = null;
if (exists(step2ContinuityPath)) {
  assert(preActivatedV3Seal, 'Step 3 continuity exists before the trusted v3 seal');
  preActivatedContinuity = json(step2ContinuityPath);
  verifyContinuityClaims(preActivatedContinuity, preActivatedV3Seal);
  const sealCommit = firstAddCommit(v3SealPath);
  const continuityCommit = firstAddCommit(step2ContinuityPath);
  assert(sealCommit && continuityCommit && git(['rev-parse', `${continuityCommit}^`]) === sealCommit, 'Step 3 continuity must immediately follow the v3 seal');
  assertExactChangedPaths(sealCommit, continuityCommit, [step2ContinuityPath], 'Step 3 continuity commit');
  assertAddedOnceAndUnchanged(step2ContinuityPath, continuityCommit);
}

const expectedPhase0P1 = closureRepairCriticComplete ? 0 : 4;
const step2ProjectionOpen = authority.executableContract.step2Status !== 'PASS_CONTRACT';
if (!phase0Closed) {
  const baseAuthorityRecovery = jsonAt(trustedRound031RepairBase.commit, 'CURRENT_AUTHORITY_INDEX.json').governanceRecovery;
  const baseStatusRecovery = jsonAt(trustedRound031RepairBase.commit, 'PROJECT_STATUS.json').governanceRecovery;
  const baseSimulationRecovery = jsonAt(trustedRound031RepairBase.commit, 'simulation/CURRENT_STATUS.json').governanceRecovery;
  const round032Active = authority.activeChangeControl === step2CorrectionPath;
  assert(JSON.stringify(authority.governanceRecovery) === JSON.stringify({
    ...baseAuthorityRecovery,
    status: round032Active ? 'STEP2_SCREEN_PROJECTION_CORRECTION_IN_PROGRESS' : 'REOPENED_PHASE0_CLOSURE_AND_CONTRACT_INTEGRITY',
    phase0P1: expectedPhase0P1
  }), 'pre-closure authority governanceRecovery differs from the exact reviewed state');
  assert(JSON.stringify(status.governanceRecovery) === JSON.stringify({
    ...baseStatusRecovery,
    status: round032Active ? 'STEP2_SCREEN_PROJECTION_CORRECTION_IN_PROGRESS' : 'REOPENED_PHASE0_CLOSURE_AND_CONTRACT_INTEGRITY',
    phase0P1: expectedPhase0P1
  }), 'pre-closure PROJECT_STATUS governanceRecovery differs from the exact reviewed state');
  assert(JSON.stringify(sim.governanceRecovery) === JSON.stringify({
    ...baseSimulationRecovery,
    status: round032Active ? 'STEP2_SCREEN_PROJECTION_CORRECTION_IN_PROGRESS' : 'REOPENED_PHASE0_CLOSURE_INTEGRITY'
  }), 'pre-closure simulation governanceRecovery differs from the exact reviewed state');
}
const expectedStep2Status = step2ProjectionOpen ? 'IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED' : 'PASS_CONTRACT';
const expectedStep2Seal = step2ProjectionOpen ? 'simulation/executable-seal-v2.json' : v3SealPath;
assert(JSON.stringify(status.scopedPasses) === JSON.stringify({
  step1: 'PASS_CANONICAL',
  step2: expectedStep2Status,
  step3: 'PASS_MODEL',
  step4: 'IN_PROGRESS',
  step5: 'BLOCKED',
  step6: 'BLOCKED'
}), 'PROJECT_STATUS scoped passes differ from the exact current gates');
assert(JSON.stringify(dispatcher.canonicalSeals) === JSON.stringify({
  step1: 'quality-reviews/step-1-reseal-round-008/seal-round-008.json',
  step2: expectedStep2Seal,
  step3FinalJudge: 'quality-reviews/step-3-large-scale-validation/final-judge.json',
  step3Completion: 'quality-reviews/step-3-large-scale-validation/completion-evidence.json'
}), 'dispatcher canonical seal pointers differ from the exact current authorities');
assert(JSON.stringify(dispatcher.scopeTruth) === JSON.stringify({
  step1: 'PASS_CANONICAL',
  step2: expectedStep2Status,
  step3: 'PASS_MODEL',
  step4: 'IN_PROGRESS',
  step5Allowed: false,
  productionAllowed: false,
  physicalIPhoneVerified: false
}), 'dispatcher scope truth differs from the exact current gates');
if (step2ProjectionOpen) {
  assert(JSON.stringify(authority.executableContract) === JSON.stringify(expectedOpenStep2Authority), 'open Step 2 authority must remain the exact sealed-v2 semantic-P0 state');
  assert(JSON.stringify(sim.step2) === JSON.stringify(expectedOpenStep2Simulation), 'open Step 2 simulation mirror differs from the exact sealed-v2 semantic-P0 state');
  assert(!Object.hasOwn(status, 'executableContract'), 'open Step 2 must not publish a PASS pointer object in PROJECT_STATUS');
  assert(!Object.hasOwn(dispatcher, 'step2ExecutableContract'), 'open Step 2 must not publish a PASS pointer object in dispatcher');
}
if (authority.activeChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json') {
  assert(step2ProjectionOpen, 'Step 2 cannot pass while round 031 is still active');
}
let verifiedV3Seal = null;
if (!step2ProjectionOpen) {
  assert(closureRepairCriticComplete, 'Step 2 cannot pass before the closure-integrity critic passes');
  assert(step2Correction, 'Step 2 PASS requires the frozen round 032 correction control');
  assert(authority.executableContract.seal === v3SealPath, 'Step 2 PASS requires the v3 seal authority pointer');
  assert(preActivatedContinuity, 'Step 2 PASS requires trusted pre-activation continuity evidence');
  const continuityCommit = firstAddCommit(step2ContinuityPath);
  assert(continuityCommit, 'Step 2 PASS activation cannot be resolved without the continuity commit');
  const activationCandidates = git(['rev-list', '--reverse', `${continuityCommit}..HEAD`])
    .split('\n')
    .filter(Boolean);
  const step2PassActivationCommit = activationCandidates.find(commit => {
    try {
      return jsonAt(commit, 'CURRENT_AUTHORITY_INDEX.json').executableContract?.step2Status === 'PASS_CONTRACT';
    } catch {
      return false;
    }
  });
  assert(step2PassActivationCommit, 'Step 2 PASS activation commit is missing');
  assert(git(['rev-parse', `${step2PassActivationCommit}^`]) === continuityCommit, 'Step 2 PASS activation must immediately follow the continuity-only commit');
  assertExactChangedPaths(continuityCommit, step2PassActivationCommit, expectedStep2PassActivationWrites, 'Step 2 PASS activation commit');
  const phase0CriticPath = 'quality-reviews/phase-0-governance-recovery/critic-summary-round-003.json';
  const phase0CriticTarget = exists(phase0CriticPath)
    ? git(['rev-parse', `${firstAddCommit(phase0CriticPath)}^`])
    : git(['rev-parse', 'HEAD']);
  assert(phase0CriticTarget === step2PassActivationCommit, 'Step 2 PASS activation must remain the exact tail until the Phase 0 independent critic immediately follows it');
  assert(preActivatedV3Seal, 'Step 2 PASS requires a trusted pre-activation v3 seal verification');
  verifiedV3Seal = preActivatedV3Seal;
  runNodeVerifier(v3ContinuityVerifierPath, 'Step 3 continuity');
  verifyV3AuthorityPointers();
}
const activeS02RevisionLock = authority.activeChangeControl === s02RevisionControlPath ? s02RevisionDecisionLock
  : authority.activeChangeControl === s02SecondRevisionControlPath ? s02SecondRevisionLock
    : authority.activeChangeControl === s02ThirdRevisionControlPath ? s02ThirdRevisionLock
      : null;
const s02UserRevisionFindingIds = authority.status === 'IN_PROGRESS_S02_P1_USER_REVISION'
  ? (activeS02RevisionLock?.requestedChanges ?? []).map(change => change.id)
  : [];
const s02InternalP1Ids = authority.activeChangeControl === s02RepairControlPath && authority.status === 'IN_PROGRESS_S02_P1_VISUAL_REPAIR'
  ? s02RepairFindingIds
  : s02UserRevisionFindingIds;
const s02InternalP1Open = s02InternalP1Ids.length;
const expectedOpenFindings = [
  ...(step2ProjectionOpen ? ['S2-P0-SCREEN-PROJECTION-001'] : []),
  'S4-RECOVERY-VIS-001',
  ...s02InternalP1Ids,
  ...(!closureRepairCriticComplete ? [
    'PHASE0-POST-CLOSURE-BOUNDARY-001',
    'PHASE0-ACCEPTANCE-CLOSURE-ID-001',
    'PHASE0-PREMATURE-EVIDENCE-001',
    'PHASE0-IMMUTABLE-EVIDENCE-OVERWRITE-001'
  ] : []),
  'PHASE0-P2-PR8-STALE-METADATA',
  'PHASE0-P2-KIMI-UNPROTECTED-EXTERNAL-ENFORCEMENT'
];
assert(authority.governanceRecovery.phase0P1 === expectedPhase0P1, 'authority Phase 0 P1 count mismatch');
assert(status.governanceRecovery.phase0P1 === expectedPhase0P1, 'PROJECT_STATUS Phase 0 P1 count mismatch');
assert(authority.globalGate.unresolvedP0 === (step2ProjectionOpen ? 1 : 0), 'authority global P0 mismatch');
assert(status.openFindings.P0 === (step2ProjectionOpen ? 1 : 0), 'PROJECT_STATUS global P0 mismatch');
assert(authority.globalGate.unresolvedP1 === expectedPhase0P1 + 1 + s02InternalP1Open, 'global P1 must equal Phase 0 P1, S4 product P1 and active S02 internal repair findings');
assert(status.openFindings.P1 === expectedPhase0P1 + 1 + s02InternalP1Open, 'PROJECT_STATUS global P1 mismatch');
assert(authority.governanceRecovery.phase0P2 === 2 && authority.globalGate.unresolvedP2 === 2, 'authority Phase 0/global P2 mismatch');
assert(status.governanceRecovery.phase0P2 === 2 && status.openFindings.P2 === 2, 'PROJECT_STATUS Phase 0/global P2 mismatch');
assert(JSON.stringify(authority.globalGate.openFindings) === JSON.stringify(expectedOpenFindings), 'authority open-finding IDs or order mismatch');
assert(JSON.stringify(status.openFindings.items) === JSON.stringify(expectedOpenFindings), 'PROJECT_STATUS open-finding IDs or order mismatch');
assert(sim.governanceRecovery.step2Correction === step2CorrectionPath, 'simulation Step 2 correction lineage mismatch');
assert(sim.governanceRecovery.plannedCorrectedClosure === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json', 'simulation corrected closure must be exact round 033 path');
assert(dispatcher.step2ScreenProjectionCorrection === step2CorrectionPath, 'dispatcher Step 2 correction lineage mismatch');
assert(dispatcher.plannedGovernanceRecoveryClosure === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json', 'dispatcher corrected closure must be exact round 033 path');
assert(authority.governanceRecovery.step2Correction === step2CorrectionPath, 'authority Step 2 correction lineage mismatch');
assert(authority.governanceRecovery.plannedCorrectedClosure === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-033.json', 'authority corrected closure must be exact round 033 path');
assert(status.scopedPasses.step2 === authority.executableContract.step2Status, 'Step 2 status differs between authority and PROJECT_STATUS');
assert(sim.step2.status === authority.executableContract.step2Status, 'Step 2 status differs between authority and simulation mirror');
const gateText = text('QUALITY_GATE.md');
const handoverText = text('PROJECT_HANDOVER.md');
if (!closureRepairCriticComplete) {
  assert(gateText.includes('Current Phase 0 P0/P1: `0 / 4`'), 'QUALITY_GATE does not show pending Phase 0 P0/P1');
  assert(handoverText.includes('`0 / 4`'), 'handover does not show pending Phase 0 P0/P1');
} else if (authority.activeChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json') {
  assert(gateText.includes('Current Phase 0 P0/P1: `0 / 0`'), 'round 031 QUALITY_GATE does not show resolved Phase 0 P0/P1');
  assert(handoverText.includes('Current Phase 0 unresolved') && handoverText.includes('`0 / 0`'), 'round 031 handover does not show resolved Phase 0 P0/P1');
} else if (authority.activeChangeControl === step2CorrectionPath) {
  assert(gateText.includes('Phase 0 unresolved P0/P1: `0 / 0`'), 'round 032 QUALITY_GATE does not show resolved Phase 0 P0/P1');
  assert(handoverText.includes('Phase 0 P0/P1 `0 / 0`'), 'round 032 handover does not show resolved Phase 0 P0/P1');
} else {
  assert(phase0Closed && gateText.includes('Corrected Phase 0 unresolved P0/P1: `0 / 0`'), 'post-closure QUALITY_GATE does not show corrected Phase 0 P0/P1');
}

assertBoundaryHistory(rootControl.entry.head, correction.entry.head, rootControl, 'round 028 content');
assert(acceptanceAddendum.parentAcceptance === 'quality-reviews/phase-0-governance-recovery/acceptance-matrix.json', 'Phase 0 acceptance addendum parent mismatch');
assert(acceptanceAddendum.correction.step2Correction.endsWith('round-032.json'), 'Step 2 correction lineage missing');
assert(acceptanceAddendum.correction.authoritativeClosure.endsWith('round-033.json'), 'corrected Phase 0 closure lineage missing');
assert(attemptedClosure.status === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'attempted round 030 closure history changed');

const supersessionRound2 = json('quality-reviews/phase-0-governance-recovery/evidence-supersession-register-round-002.json');
const registeredFrozen = new Map([
  ...supersessionRound2.frozenAttemptedClosureHistory,
  ...supersessionRound2.frozenCorrectionHistory,
  ...supersessionRound2.frozenBoundaryControls
].map(entry => [entry.path, entry.blob]));
for (const [p, expectedBlob] of Object.entries({ ...frozenAttemptedClosureBlobs, ...frozenCorrectionBlobs })) {
  assert(registeredFrozen.get(p) === expectedBlob, `complete supersession register missing or misbinding ${p}`);
}

const closureEvidence = {
  step2Continuity: step2ContinuityPath,
  critic: 'quality-reviews/phase-0-governance-recovery/critic-summary-round-003.json',
  finalJudge: 'quality-reviews/phase-0-governance-recovery/final-judge-round-002.json',
  completion: 'quality-reviews/phase-0-governance-recovery/completion-evidence-round-002.json',
  liveReadback: 'quality-reviews/phase-0-governance-recovery/live-readback-round-002.json'
};
const expectedClosureCommitWrites = [
  closurePath,
  'CURRENT_AUTHORITY_INDEX.json',
  'PROJECT_STATUS.json',
  'AI_PROJECT_POLICY.json',
  'QUALITY_GATE.md',
  'PROJECT_HANDOVER.md',
  'AGENTS.md',
  'README.md',
  'simulation/CURRENT_STATUS.json',
  '.github/workflows/CURRENT_STATUS.md',
  'quality-reviews/step-1-canonical-design/active-change-control.json'
];

const expectedPhase0Coverage = [
  'ROUND031_REPAIR_TARGET_INTEGRITY',
  'ROUND032_EXACT_WRITE_BOUNDARY',
  'STEP2_V3_SEAL_AND_CONTINUITY',
  'NON_STEP2_AUTHORITY_FREEZE',
  'EVIDENCE_CHAIN_IMMUTABILITY',
  'PRODUCTION_RUNTIME_DEVICE_BOUNDARIES'
];
const expectedPhase0Findings = [
  { id: 'PHASE0-POST-CLOSURE-BOUNDARY-001', severity: 'P1', resolved: true },
  { id: 'PHASE0-ACCEPTANCE-CLOSURE-ID-001', severity: 'P1', resolved: true },
  { id: 'PHASE0-PREMATURE-EVIDENCE-001', severity: 'P1', resolved: true },
  { id: 'PHASE0-IMMUTABLE-EVIDENCE-OVERWRITE-001', severity: 'P1', resolved: true },
  { id: 'S2-P0-SCREEN-PROJECTION-001', severity: 'P0', resolved: true },
  { id: 'PHASE0-P2-PR8-STALE-METADATA', severity: 'P2', resolved: false },
  { id: 'PHASE0-P2-KIMI-UNPROTECTED-EXTERNAL-ENFORCEMENT', severity: 'P2', resolved: false }
];

function verifyPhase0ReviewEvidencePrefix() {
  const presence = Object.fromEntries(Object.entries({
    critic: closureEvidence.critic,
    finalJudge: closureEvidence.finalJudge,
    completion: closureEvidence.completion,
    liveReadback: closureEvidence.liveReadback
  }).map(([key, file]) => [key, exists(file)]));
  assert(!presence.finalJudge || presence.critic, 'Phase 0 final judge exists before the independent critic');
  assert(!presence.completion || presence.finalJudge, 'Phase 0 completion exists before the final judge');
  assert(!presence.liveReadback || presence.completion, 'Phase 0 live readback exists before completion');
  if (!presence.critic) return null;

  const critic = json(closureEvidence.critic);
  assertExactKeySet(critic, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'auditTarget', 'verdict', 'coverage', 'findings', 'unresolved', 'maximumVerdict'], 'Phase 0 independent critic');
  assertExactKeySet(critic.auditTarget, ['commit', 'tree'], 'Phase 0 independent critic target');
  assertExactKeySet(critic.unresolved, ['P0', 'P1', 'P2'], 'Phase 0 independent critic unresolved');
  assert(critic.schemaVersion === 1 && critic.artifactId === 'cats-tower-phase0-governance-recovery-critic-round-003', 'Phase 0 independent critic identity mismatch');
  assert(critic.repository === '2hg7trp7rv-design/cats_tower' && critic.branch === 'kimi' && critic.changeControl === step2CorrectionPath, 'Phase 0 independent critic authority mismatch');
  assert(critic.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY_INDEPENDENT_CRITIC' && critic.maximumVerdict === 'READY_FOR_PHASE0_FINAL_JUDGE', 'Phase 0 independent critic verdict boundary mismatch');
  assertCriticalFindingCounts(critic, 'Phase 0 independent critic');
  assert(JSON.stringify(critic.coverage) === JSON.stringify(expectedPhase0Coverage) && JSON.stringify(critic.findings) === JSON.stringify(expectedPhase0Findings) && critic.unresolved.P2 === 2, 'Phase 0 independent critic coverage/finding set mismatch');
  const targetCommit = critic.auditTarget.commit;
  const targetTree = critic.auditTarget.tree;
  assert(targetTree === git(['rev-parse', `${targetCommit}^{tree}`]), 'Phase 0 critic target commit/tree mismatch');
  const targetAuthority = jsonAt(targetCommit, 'CURRENT_AUTHORITY_INDEX.json');
  assert(targetAuthority.activeChangeControl === step2CorrectionPath && targetAuthority.executableContract?.step2Status === 'PASS_CONTRACT' && targetAuthority.executableContract?.seal === v3SealPath, 'Phase 0 critic target is not the corrected Step 2 PASS activation');
  assert(git(['cat-file', '-e', `${targetCommit}:${step2ContinuityPath}`]) === '', 'Phase 0 critic target lacks Step 3 continuity evidence');
  const criticCommit = firstAddCommit(closureEvidence.critic);
  assert(criticCommit && git(['rev-parse', `${criticCommit}^`]) === targetCommit, 'Phase 0 critic must immediately follow its exact audit target');
  assertExactChangedPaths(targetCommit, criticCommit, [closureEvidence.critic], 'Phase 0 critic commit');
  assertAddedOnceAndUnchanged(closureEvidence.critic, criticCommit);
  if (!presence.finalJudge) return { targetCommit, targetTree, criticCommit };

  const judge = json(closureEvidence.finalJudge);
  assertExactKeySet(judge, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'target', 'critic', 'verdict', 'coverage', 'findings', 'unresolved', 'resolvedFindings', 'retainedP2', 'maximumVerdict'], 'Phase 0 final judge');
  assertExactKeySet(judge.target, ['commit', 'tree'], 'Phase 0 final judge target');
  assertExactKeySet(judge.critic, ['path', 'blob'], 'Phase 0 final judge critic binding');
  assertExactKeySet(judge.unresolved, ['P0', 'P1', 'P2'], 'Phase 0 final judge unresolved');
  assert(judge.schemaVersion === 1 && judge.artifactId === 'cats-tower-phase0-governance-recovery-final-judge-round-002' && judge.repository === critic.repository && judge.branch === critic.branch && judge.changeControl === step2CorrectionPath, 'Phase 0 final judge identity or authority mismatch');
  assert(judge.target.commit === targetCommit && judge.target.tree === targetTree && judge.critic.path === closureEvidence.critic && judge.critic.blob === git(['rev-parse', `HEAD:${closureEvidence.critic}`]), 'Phase 0 final judge target or critic binding mismatch');
  assert(judge.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY' && judge.maximumVerdict === 'READY_FOR_PHASE0_COMPLETION_EVIDENCE', 'Phase 0 final judge verdict boundary mismatch');
  assertCriticalFindingCounts(judge, 'Phase 0 final judge');
  const resolvedFindings = expectedPhase0Findings.filter(entry => entry.resolved).map(entry => entry.id);
  const retainedP2 = expectedPhase0Findings.filter(entry => entry.severity === 'P2').map(entry => entry.id);
  assert(JSON.stringify(judge.coverage) === JSON.stringify(expectedPhase0Coverage) && JSON.stringify(judge.findings) === JSON.stringify(expectedPhase0Findings) && JSON.stringify(judge.resolvedFindings) === JSON.stringify(resolvedFindings) && JSON.stringify(judge.retainedP2) === JSON.stringify(retainedP2) && judge.unresolved.P2 === 2, 'Phase 0 final judge result set mismatch');
  const judgeCommit = firstAddCommit(closureEvidence.finalJudge);
  assert(judgeCommit && git(['rev-parse', `${judgeCommit}^`]) === criticCommit, 'Phase 0 final judge must immediately follow the independent critic');
  assertExactChangedPaths(criticCommit, judgeCommit, [closureEvidence.finalJudge], 'Phase 0 final-judge commit');
  assertAddedOnceAndUnchanged(closureEvidence.finalJudge, judgeCommit);
  if (!presence.completion) return { targetCommit, targetTree, criticCommit, judgeCommit };

  const completion = json(closureEvidence.completion);
  assertExactKeySet(completion, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'verifiedContent', 'finalJudge', 'workflowEvidence', 'verdict', 'phase0Unresolved', 'resolvedFindings', 'retainedP2', 'maximumVerdict'], 'Phase 0 completion evidence');
  assertExactKeySet(completion.verifiedContent, ['commit', 'tree'], 'Phase 0 completion verified content');
  assertExactKeySet(completion.finalJudge, ['path', 'blob'], 'Phase 0 completion judge binding');
  assertExactKeySet(completion.phase0Unresolved, ['P0', 'P1'], 'Phase 0 completion unresolved');
  assert(completion.schemaVersion === 1 && completion.artifactId === 'cats-tower-phase0-governance-recovery-completion-round-002' && completion.repository === critic.repository && completion.branch === critic.branch && completion.changeControl === step2CorrectionPath, 'Phase 0 completion identity or authority mismatch');
  assert(completion.verifiedContent.commit === targetCommit && completion.verifiedContent.tree === targetTree && completion.finalJudge.path === closureEvidence.finalJudge && completion.finalJudge.blob === git(['rev-parse', `HEAD:${closureEvidence.finalJudge}`]), 'Phase 0 completion target or judge binding mismatch');
  assert(completion.verdict === 'READY_FOR_PHASE0_LIVE_READBACK' && completion.maximumVerdict === 'READY_FOR_PHASE0_LIVE_READBACK' && completion.phase0Unresolved.P0 === 0 && completion.phase0Unresolved.P1 === 0, 'Phase 0 completion verdict boundary mismatch');
  assert(JSON.stringify(completion.resolvedFindings) === JSON.stringify(resolvedFindings) && JSON.stringify(completion.retainedP2) === JSON.stringify(retainedP2), 'Phase 0 completion resolved/retained set mismatch');
  assert(completion.workflowEvidence.commit === targetCommit && completion.workflowEvidence.tree === targetTree, 'Phase 0 completion workflow target mismatch');
  registerWorkflowEvidence(completion.workflowEvidence, 'Phase 0 completion');
  const completionCommit = firstAddCommit(closureEvidence.completion);
  assert(completionCommit && git(['rev-parse', `${completionCommit}^`]) === judgeCommit, 'Phase 0 completion must immediately follow the final judge');
  assertExactChangedPaths(judgeCommit, completionCommit, [closureEvidence.completion], 'Phase 0 completion commit');
  assertAddedOnceAndUnchanged(closureEvidence.completion, completionCommit);
  if (!presence.liveReadback) return { targetCommit, targetTree, criticCommit, judgeCommit, completionCommit };

  const readback = json(closureEvidence.liveReadback);
  assertExactKeySet(readback, ['schemaVersion', 'artifactId', 'repository', 'branch', 'changeControl', 'readbackTarget', 'completion', 'workflow', 'verdict', 'phase0Unresolved', 'resolvedFindings', 'retainedP2', 'maximumVerdict'], 'Phase 0 live readback');
  assertExactKeySet(readback.readbackTarget, ['commit', 'tree'], 'Phase 0 live readback target');
  assertExactKeySet(readback.completion, ['path', 'blob'], 'Phase 0 live readback completion binding');
  assertExactKeySet(readback.phase0Unresolved, ['P0', 'P1'], 'Phase 0 live readback unresolved');
  assert(readback.schemaVersion === 1 && readback.artifactId === 'cats-tower-phase0-governance-recovery-live-readback-round-002' && readback.repository === critic.repository && readback.branch === critic.branch && readback.changeControl === step2CorrectionPath, 'Phase 0 live readback identity or authority mismatch');
  assert(readback.readbackTarget.commit === targetCommit && readback.readbackTarget.tree === targetTree && readback.completion.path === closureEvidence.completion && readback.completion.blob === git(['rev-parse', `HEAD:${closureEvidence.completion}`]), 'Phase 0 live readback target or completion binding mismatch');
  assert(readback.verdict === 'READY_TO_CLOSE_PHASE0_GOVERNANCE_RECOVERY' && readback.maximumVerdict === 'READY_TO_CLOSE_PHASE0_GOVERNANCE_RECOVERY' && readback.phase0Unresolved.P0 === 0 && readback.phase0Unresolved.P1 === 0, 'Phase 0 live readback verdict boundary mismatch');
  assert(JSON.stringify(readback.resolvedFindings) === JSON.stringify(resolvedFindings) && JSON.stringify(readback.retainedP2) === JSON.stringify(retainedP2), 'Phase 0 live readback resolved/retained set mismatch');
  assert(JSON.stringify(readback.workflow) === JSON.stringify(completion.workflowEvidence), 'Phase 0 live readback workflow differs from completion evidence');
  registerWorkflowEvidence(readback.workflow, 'Phase 0 live readback');
  const readbackCommit = firstAddCommit(closureEvidence.liveReadback);
  assert(readbackCommit && git(['rev-parse', `${readbackCommit}^`]) === completionCommit, 'Phase 0 live readback must immediately follow completion evidence');
  assertExactChangedPaths(completionCommit, readbackCommit, [closureEvidence.liveReadback], 'Phase 0 live-readback commit');
  assertAddedOnceAndUnchanged(closureEvidence.liveReadback, readbackCommit);
  return { targetCommit, targetTree, criticCommit, judgeCommit, completionCommit, readbackCommit };
}

const phase0ReviewPrefix = verifyPhase0ReviewEvidencePrefix();

if (authority.activeChangeControl === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-031.json') {
  assert(active.status === 'IN_PROGRESS', 'round 031 must be in progress');
  assert(status.currentInternalPhase === 'PHASE0-GOVERNANCE-RECOVERY', 'Phase 0 mirror mismatch');
  if (closureRepairCriticComplete) {
    assertExactPostCriticDocumentTransforms('HEAD');
    assertCurrentDocBlobMap(expectedPostCriticCurrentDocBlobs, 'HEAD', 'post-critic round 031 current documents');
  }
  else assertExactRepairDocumentTransforms('WORKTREE');
  assertBoundaryHistory(reopen.entry.head, git(['rev-parse', 'HEAD']), reopen, 'round 031 closure-integrity repair');
  assert(!step2Correction, 'round 032 must not exist while round 031 is active');
  assert(!exists(closurePath), 'round 033 must not exist before corrected Phase 0 closure');
} else if (authority.activeChangeControl === step2CorrectionPath) {
  assert(step2Correction, 'active round 032 change-control missing');
  assert(closureRepairCriticComplete && authority.governanceRecovery.phase0P0 === 0 && expectedPhase0P1 === 0, 'round 032 cannot be active while Phase 0 P0/P1 remains');
  assert(active.status === 'IN_PROGRESS', 'round 032 must remain in progress before corrected closure');
  assert(status.currentInternalPhase === 'STEP2-SCREEN-PROJECTION-CORRECTION', 'round 032 phase mirror mismatch');
  assertBoundaryHistory(reopen.entry.head, step2Correction.entry.head, reopen, 'completed round 031 repair range');
  assertBoundaryHistory(step2Correction.entry.head, git(['rev-parse', 'HEAD']), step2Correction, 'round 032 Step 2 correction range');
  if (step2ProjectionOpen) {
    assertExactPhaseDocumentTransforms('HEAD', expectedRound032DocumentText, 'round 032 open current documents');
    assertCurrentDocBlobMap(expectedRound032CurrentDocBlobs, 'HEAD', 'round 032 open current documents');
  } else {
    assertExactPhaseDocumentTransforms('HEAD', expectedRound032PassDocumentText, 'round 032 PASS-activated current documents');
  }
  assert(!exists(closurePath), 'round 033 must not exist while round 032 is active');
} else {
  assert(postClosureControlPaths.includes(authority.activeChangeControl), 'post-Phase0 authority is outside the exact reviewed S02 successor chain');
  assert(step2Correction, 'round 032 correction control missing after closure');
  assert(exists(closurePath), 'corrected Phase 0 closure addendum missing');
  const closure = json(closurePath);
  assertExactKeySet(closure, [
    'schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'parentChangeControl', 'status',
    'verdict', 'scope', 'content', 'evidence', 'evidenceBlobs', 'completionResults', 'unresolved',
    'returnsCurrentProductAuthorityTo', 'nextProductWork', 'mayNotDeclare', 'step4Pass', 'step5Allowed',
    'productionAllowed', 'productionAliasChanged', 'physicalIPhoneVerified', 'userVisualApproval'
  ], 'round 033 closure');
  assertExactKeySet(closure.content, ['verifiedTipCommit', 'verifiedTipTree', 'evidenceCommit', 'evidenceTree', 'rootEntryCommit', 'rootEntryTree'], 'round 033 content');
  assertExactKeySet(closure.evidence, ['step2Continuity', 'critic', 'finalJudge', 'completion', 'liveReadback'], 'round 033 evidence paths');
  assertExactKeySet(closure.evidenceBlobs, ['step2Continuity', 'critic', 'finalJudge', 'completion', 'liveReadback'], 'round 033 evidence blobs');
  assertExactKeySet(closure.completionResults, [
    'singleCurrentAuthority', 'currentMirrorsSynchronized', 'round031RepairVerified',
    'step2ProjectionCorrected', 'step2V3Sealed', 'step3ContinuityVerified', 'numberedEvidenceBound',
    'liveActionsProvenanceVerifiedAtClosure', 'step2V2HistoryPreserved', 'legacyRuntimeMutated',
    'preservedS02P1ContentMutatedByPhase0'
  ], 'round 033 completion results');
  assertExactKeySet(closure.unresolved, ['phase0P0', 'phase0P1', 'phase0P2', 'nonBlockingPhase0P2', 'productP0', 'productP1', 'productP1Items'], 'round 033 unresolved');
  assert(closure.schemaVersion === 1 && closure.artifactId === 'cats-tower-active-change-control-addendum-round-033' && /^2026-\d{2}-\d{2}$/.test(closure.createdAt ?? ''), 'round 033 identity or creation date mismatch');
  assert(closure.repository === '2hg7trp7rv-design/cats_tower' && closure.branch === 'kimi' && closure.parentChangeControl === step2CorrectionPath, 'round 033 repository, branch or parent mismatch');
  assert(closure.status === 'PASS_PHASE0_GOVERNANCE_RECOVERY' && closure.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'round 033 scoped closure verdict mismatch');
  assert(closure.scope === 'Corrected Phase 0 governance recovery closure after the versioned Step 2 v3 screen projection and Step 3 continuity proof; no S02 product, runtime, economy, save, Production or device mutation.', 'round 033 scope mismatch');
  assert(JSON.stringify(closure.evidence) === JSON.stringify(closureEvidence), 'round 033 evidence path set mismatch');
  assert(JSON.stringify(closure.completionResults) === JSON.stringify({
    singleCurrentAuthority: true,
    currentMirrorsSynchronized: true,
    round031RepairVerified: true,
    step2ProjectionCorrected: true,
    step2V3Sealed: true,
    step3ContinuityVerified: true,
    numberedEvidenceBound: true,
    liveActionsProvenanceVerifiedAtClosure: true,
    step2V2HistoryPreserved: true,
    legacyRuntimeMutated: false,
    preservedS02P1ContentMutatedByPhase0: false
  }), 'round 033 completion result mismatch');
  assert(JSON.stringify(closure.unresolved) === JSON.stringify({
    phase0P0: 0,
    phase0P1: 0,
    phase0P2: 2,
    nonBlockingPhase0P2: ['PHASE0-P2-PR8-STALE-METADATA', 'PHASE0-P2-KIMI-UNPROTECTED-EXTERNAL-ENFORCEMENT'],
    productP0: 0,
    productP1: 1,
    productP1Items: ['S4-RECOVERY-VIS-001']
  }), 'round 033 unresolved set mismatch');
  assert(closure.returnsCurrentProductAuthorityTo === 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-026.json', 'round 033 return authority mismatch');
  assert(closure.nextProductWork === 'Audit the preserved S02-P1 artifacts against deliverables A-J and GM01-GM08 before any additional product-content write. Reuse conforming material and repair only demonstrated gaps.', 'round 033 next product work mismatch');
  assert(JSON.stringify(closure.mayNotDeclare) === JSON.stringify([
    'S02 complete', 'Step 4 PASS', 'Step 5 allowed', 'canonical runtime implemented',
    'backend implemented', 'Production Ready', 'physical iPhone verified'
  ]), 'round 033 forbidden declaration set mismatch');
  assert(closure.step4Pass === false && closure.step5Allowed === false && closure.productionAllowed === false && closure.productionAliasChanged === false && closure.physicalIPhoneVerified === false && closure.userVisualApproval === false, 'round 033 release, approval or device boundary changed');
  assertExactPhaseDocumentTransforms(closureCommit, expectedRound033DocumentText, 'round 033 closure documents');
  assertCurrentDocBlobMap(expectedRound033CurrentDocBlobs, closureCommit, 'round 033 closure documents');
  if (authority.activeChangeControl === s02AssetVolumeControlPath) {
    assert(s02AssetVolumeProductionHandoff, 'active round 044 lacks its exact contract-derived asset-volume handoff');
    assertExactPhaseDocumentTransforms('HEAD', s02AssetVolumeProductionHandoff.readyCommit ? expectedRound044ReadyDocumentText : expectedRound044DocumentText, 'round 044 current documents');
  } else if (authority.activeChangeControl === s02AssetVolumeScopeControlPath) {
    assert(s02AssetVolumeScopeHandoff, 'active round 043 lacks its exact scope-contract handoff');
    assertExactPhaseDocumentTransforms('HEAD', expectedRound043DocumentText, 'round 043 current documents');
  } else if (authority.activeChangeControl === s02AssetPassControlPath) {
    assert(s02RepresentativeAssetPass, 'active round 042 lacks exact representative PASS_ASSET evidence');
    assertExactPhaseDocumentTransforms('HEAD', expectedRound042DocumentText, 'round 042 current documents');
  } else if (authority.activeChangeControl === s02ThirdRevisedP2ControlPath) {
    assert(s02ThirdRevisedP2Approval, 'active round 041 lacks exact approval evidence');
    assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalApprovalDocumentText(file, s02ThirdRevisionDocumentConfig), 'round 041 current documents');
  } else if (authority.activeChangeControl === s02ThirdRevisionControlPath) {
    assert(s02ThirdRevisionHandoff, 'active round 040 lacks exact revision evidence');
    assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalRevisionDocumentText(file, s02ThirdRevisionDocumentConfig, authority.status === 'READY_FOR_USER_VISUAL_REVIEW'), 'round 040 current documents');
  } else if (authority.activeChangeControl === s02SecondRevisedP2ControlPath) {
    assert(s02SecondRevisedP2Approval, 'active round 039 lacks exact approval evidence');
    assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalApprovalDocumentText(file, s02SecondRevisionDocumentConfig), 'round 039 current documents');
  } else if (authority.activeChangeControl === s02SecondRevisionControlPath) {
    assert(s02SecondRevisionHandoff, 'active round 038 lacks exact revision evidence');
    assertExactPhaseDocumentTransforms('HEAD', file => expectedAdditionalRevisionDocumentText(file, s02SecondRevisionDocumentConfig, authority.status === 'READY_FOR_USER_VISUAL_REVIEW'), 'round 038 current documents');
  } else if (authority.activeChangeControl === s02RepairControlPath) {
    assert(s02RepairControl, 'active round 034 control missing');
    if (authority.status === 'IN_PROGRESS_S02_P1_VISUAL_REPAIR') {
      assertExactPhaseDocumentTransforms('HEAD', expectedRound034RepairDocumentText, 'round 034 repair current documents');
    } else if (authority.status === 'READY_FOR_USER_VISUAL_REVIEW') {
      assertExactPhaseDocumentTransforms('HEAD', expectedRound034ReadyDocumentText, 'round 034 ready current documents');
    } else {
      assert(false, 'round 034 current status is not an allowed S02-P1 state');
    }
  } else if (authority.activeChangeControl === s02P2ControlPath) {
    assert(s02P2Control && s02UserDecisionLock, 'active round 035 lacks its explicit decision lock');
    assertExactPhaseDocumentTransforms('HEAD', expectedRound035DocumentText, 'round 035 approved-P2 current documents');
  } else if (authority.activeChangeControl === s02RevisionControlPath) {
    assert(s02RevisionControl && s02RevisionDecisionLock && s02RevisionHandoff, 'active round 036 lacks its exact user-revision lock and handoff');
    if (authority.status === 'IN_PROGRESS_S02_P1_USER_REVISION') assertExactPhaseDocumentTransforms('HEAD', expectedRound036RevisionDocumentText, 'round 036 revision current documents');
    else if (authority.status === 'READY_FOR_USER_VISUAL_REVIEW') assertExactPhaseDocumentTransforms('HEAD', expectedRound036ReadyDocumentText, 'round 036 revised-ready current documents');
    else assert(false, 'round 036 current status is not an allowed S02-P1 revision state');
  } else if (authority.activeChangeControl === s02RevisedP2ControlPath) {
    assert(s02RevisedP2Control && s02RevisedApprovalLock && s02RevisedP2Approval, 'active round 037 lacks its exact revised-target approval lock and handoff');
    assertExactPhaseDocumentTransforms('HEAD', expectedRound037DocumentText, 'round 037 approved revised-target current documents');
  }
  assert(closure.status === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'round 033 must close corrected Phase 0');
  assert(authority.governanceRecovery?.closure === closurePath, 'authority must bind Phase 0 closure');
  assert(dispatcher.governanceRecoveryClosure === closurePath, 'dispatcher must bind Phase 0 closure');
  assert(['S02-P1-GOLDEN-MASTER', 'S02-P2-ASSET-PRODUCTION'].includes(status.currentInternalPhase), 'post-Phase0 phase mismatch');
  assert(authority.executableContract.step2Status === 'PASS_CONTRACT', 'round 033 may not close while Step 2 P0 remains open');
  assert(authority.executableContract.seal === v3SealPath, 'current Step 2 seal must be v3 after correction');
  assert(verifiedV3Seal, 'corrected v3 Step 2 contract was not verified');
  const v3Seal = verifiedV3Seal;
  for (const p of Object.values(closureEvidence)) assert(exists(p), `Phase 0 closure evidence missing: ${p}`);
  for (const [key, p] of Object.entries(closureEvidence)) assert(closure.evidence?.[key] === p, `round 033 does not exactly bind numbered ${key} evidence`);
  const continuity = json(closureEvidence.step2Continuity);
  verifyContinuityClaims(continuity, v3Seal);
  const critic = json(closureEvidence.critic);
  const judge = json(closureEvidence.finalJudge);
  const completion = json(closureEvidence.completion);
  const readback = json(closureEvidence.liveReadback);
  assert(critic.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY_INDEPENDENT_CRITIC', 'Phase 0 independent critic did not pass');
  assertCriticalFindingCounts(critic, 'Phase 0 independent critic');
  const expectedPhase0Coverage = [
    'ROUND031_REPAIR_TARGET_INTEGRITY',
    'ROUND032_EXACT_WRITE_BOUNDARY',
    'STEP2_V3_SEAL_AND_CONTINUITY',
    'NON_STEP2_AUTHORITY_FREEZE',
    'EVIDENCE_CHAIN_IMMUTABILITY',
    'PRODUCTION_RUNTIME_DEVICE_BOUNDARIES'
  ];
  const expectedPhase0Findings = [
    { id: 'PHASE0-POST-CLOSURE-BOUNDARY-001', severity: 'P1', resolved: true },
    { id: 'PHASE0-ACCEPTANCE-CLOSURE-ID-001', severity: 'P1', resolved: true },
    { id: 'PHASE0-PREMATURE-EVIDENCE-001', severity: 'P1', resolved: true },
    { id: 'PHASE0-IMMUTABLE-EVIDENCE-OVERWRITE-001', severity: 'P1', resolved: true },
    { id: 'S2-P0-SCREEN-PROJECTION-001', severity: 'P0', resolved: true },
    { id: 'PHASE0-P2-PR8-STALE-METADATA', severity: 'P2', resolved: false },
    { id: 'PHASE0-P2-KIMI-UNPROTECTED-EXTERNAL-ENFORCEMENT', severity: 'P2', resolved: false }
  ];
  assert(JSON.stringify(critic.coverage) === JSON.stringify(expectedPhase0Coverage) && JSON.stringify(critic.findings) === JSON.stringify(expectedPhase0Findings) && critic.unresolved.P2 === 2, 'Phase 0 critic coverage/finding rows differ from the exact resolved and retained set');
  assert(judge.critic?.path === closureEvidence.critic && judge.critic?.blob === git(['rev-parse', `HEAD:${closureEvidence.critic}`]), 'Phase 0 judge does not bind numbered critic');
  assert(judge.verdict === 'PASS_PHASE0_GOVERNANCE_RECOVERY', 'Phase 0 judge did not pass');
  assertCriticalFindingCounts(judge, 'Phase 0 final judge');
  assert(JSON.stringify(judge.coverage) === JSON.stringify(expectedPhase0Coverage) && JSON.stringify(judge.findings) === JSON.stringify(expectedPhase0Findings) && judge.unresolved.P2 === 2, 'Phase 0 final judge coverage/finding rows differ from the independent critic');
  assert(completion.verdict === 'READY_FOR_PHASE0_LIVE_READBACK', 'Phase 0 completion evidence did not authorize live readback');
  assert(completion.phase0Unresolved.P0 === 0 && completion.phase0Unresolved.P1 === 0, 'Phase 0 completion P0/P1 must be zero');
  assert(JSON.stringify(completion.retainedP2) === JSON.stringify(expectedPhase0Findings.filter(entry => entry.severity === 'P2').map(entry => entry.id)), 'Phase 0 completion does not retain the exact P2 set');
  assert(readback.verdict === 'READY_TO_CLOSE_PHASE0_GOVERNANCE_RECOVERY', 'Phase 0 live readback did not authorize closure');
  assert(readback.phase0Unresolved.P0 === 0 && readback.phase0Unresolved.P1 === 0, 'Phase 0 readback P0/P1 must be zero');
  assert(JSON.stringify(readback.retainedP2) === JSON.stringify(completion.retainedP2), 'Phase 0 live readback retained-P2 set mismatch');
  const criticCommit = firstAddCommit(closureEvidence.critic);
  const judgeCommit = firstAddCommit(closureEvidence.finalJudge);
  const completionCommit = firstAddCommit(closureEvidence.completion);
  const readbackCommit = firstAddCommit(closureEvidence.liveReadback);
  assert(closureCommit, 'cannot resolve Phase 0 closure commit');
  assert(criticCommit && judgeCommit && completionCommit && readbackCommit, 'cannot resolve numbered Phase 0 evidence commits');
  assert(new Set([criticCommit, judgeCommit, completionCommit, readbackCommit, closureCommit]).size === 5, 'critic, judge, completion, readback and closure must be distinct commits');
  assert(git(['rev-parse', `${criticCommit}^`]) === critic.auditTarget.commit, 'Phase 0 critic must immediately follow its exact audited target');
  assert(git(['rev-parse', `${judgeCommit}^`]) === criticCommit, 'Phase 0 judge must immediately follow the independent critic');
  assert(git(['rev-parse', `${completionCommit}^`]) === judgeCommit, 'Phase 0 completion must immediately follow the final judge');
  assert(git(['rev-parse', `${readbackCommit}^`]) === completionCommit, 'Phase 0 live readback must immediately follow completion evidence');
  assert(git(['rev-parse', `${closureCommit}^`]) === readbackCommit, 'round 033 closure must immediately follow live readback');
  assertExactChangedPaths(critic.auditTarget.commit, criticCommit, [closureEvidence.critic], 'Phase 0 critic commit');
  assertExactChangedPaths(criticCommit, judgeCommit, [closureEvidence.finalJudge], 'Phase 0 final-judge commit');
  assertExactChangedPaths(judgeCommit, completionCommit, [closureEvidence.completion], 'Phase 0 completion commit');
  assertExactChangedPaths(completionCommit, readbackCommit, [closureEvidence.liveReadback], 'Phase 0 live-readback commit');
  assertExactChangedPaths(readbackCommit, closureCommit, expectedClosureCommitWrites, 'round 033 closure commit');
  assertAddedOnceAndUnchanged(closurePath, closureCommit);
  for (const [key, file] of Object.entries(closureEvidence)) {
    const addCommit = firstAddCommit(file);
    const currentBlob = assertAddedOnceAndUnchanged(file, addCommit);
    assert(closure.evidenceBlobs?.[key] === currentBlob, `round 033 does not bind immutable ${key} evidence blob`);
  }
  const targetCommit = critic.auditTarget?.commit;
  const targetTree = critic.auditTarget?.tree;
  assert(targetCommit && targetTree === git(['rev-parse', `${targetCommit}^{tree}`]), 'critic target commit/tree binding is invalid');
  const targetPolicy = jsonAt(targetCommit, 'AI_PROJECT_POLICY.json');
  for (const key of ['repository', 'scopedPassVocabulary', 'forbiddenUnscopedVerdict', 'completionInsufficientAlone', 'lowReworkRules', 'verificationPolicy', 'legacy', 'reportingRequired']) {
    assert(JSON.stringify(policy[key]) === JSON.stringify(targetPolicy[key]), `post-target AI policy security section changed: ${key}`);
  }
  const { activeChangeControl: ignoredTargetControl, ...targetPolicyAuthority } = targetPolicy.authority;
  const { activeChangeControl: ignoredCurrentControl, ...currentPolicyAuthority } = policy.authority;
  assert(JSON.stringify(currentPolicyAuthority) === JSON.stringify(targetPolicyAuthority), 'post-target AI policy authority lineage changed outside active control');
  assert(JSON.stringify(policy.currentWriteBoundary?.forbidden) === JSON.stringify(targetPolicy.currentWriteBoundary?.forbidden), 'post-target AI policy forbidden boundary changed');
  const targetDispatcher = jsonAt(targetCommit, 'quality-reviews/step-1-canonical-design/active-change-control.json');
  for (const key of ['repository', 'branch', 'supersededGovernanceRecoveryClosure', 'step2ScreenProjectionCorrection', 'plannedGovernanceRecoveryClosure', 'canonicalSeals', 'step2ExecutableContract', 'scopeTruth', 'lineage', 'rule']) {
    assert(JSON.stringify(dispatcher[key]) === JSON.stringify(targetDispatcher[key]), `post-target dispatcher policy changed: ${key}`);
  }
  for (const file of ['AGENTS.md', 'README.md']) {
    const closureText = textAt(closureCommit, file);
    assertSingleAuthoritySnapshot(closureText, round033Snapshot, `${file} at round 033 closure`);
    assert(!closureText.includes(round032Snapshot), `round 033 left the round 032 current-authority snapshot in ${file}`);
  }
  assert(targetCommit !== step2Correction.entry.head && isAncestor(step2Correction.entry.head, targetCommit), 'critic target must be a corrected round 032 descendant, not its entry');
  assert(targetCommit !== criticCommit, 'independent critic must be committed after its audited target');
  const v3SealCommit = firstAddCommit('simulation/executable-seal-v3.json');
  assert(v3SealCommit && isAncestor(v3SealCommit, targetCommit), 'critic target does not contain the v3 correction seal');
  const continuityCommit = firstAddCommit(step2ContinuityPath);
  assert(continuityCommit && isAncestor(continuityCommit, targetCommit), 'critic target does not contain the Step 3 continuity evidence');
  assert(git(['rev-parse', `${targetCommit}:${step2ContinuityPath}`]) === git(['rev-parse', `HEAD:${step2ContinuityPath}`]), 'Step 3 continuity evidence changed after the critic target');
  assert(isAncestor(targetCommit, criticCommit), 'critic evidence must follow its target commit');
  assert(judge.target?.commit === targetCommit && judge.target?.tree === targetTree, 'judge target differs from critic target');
  assert(completion.verifiedContent?.commit === targetCommit && completion.verifiedContent?.tree === targetTree, 'completion target differs from critic target');
  assert(readback.readbackTarget?.commit === targetCommit && readback.readbackTarget?.tree === targetTree, 'readback target differs from critic target');
  const evidenceParent = git(['rev-parse', `${closureCommit}^`]);
  assert(closure.content?.verifiedTipCommit === targetCommit && closure.content?.verifiedTipTree === targetTree, 'round 033 target differs from numbered evidence');
  assert(closure.content?.evidenceCommit === evidenceParent && closure.content?.evidenceTree === git(['rev-parse', `${evidenceParent}^{tree}`]), 'round 033 does not bind its evidence parent commit/tree');
  assert(closure.content?.rootEntryCommit === rootControl.entry.head && closure.content?.rootEntryTree === rootControl.entry.tree && closure.content.rootEntryTree === git(['rev-parse', `${closure.content.rootEntryCommit}^{tree}`]), 'round 033 Phase 0 root entry commit/tree mismatch');
  assert(JSON.stringify(authority.governanceRecovery) === JSON.stringify({
    status: 'PASS_PHASE0_GOVERNANCE_RECOVERY',
    supersededClosureAttempt: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json',
    step2Correction: step2CorrectionPath,
    plannedCorrectedClosure: closurePath,
    contentCommit: targetCommit,
    contentTree: targetTree,
    evidenceCommit: evidenceParent,
    evidenceTree: git(['rev-parse', `${evidenceParent}^{tree}`]),
    workflowRun: completion.workflowEvidence.runId,
    workflowJob: completion.workflowEvidence.jobId,
    artifactId: completion.workflowEvidence.artifactId,
    phase0P0: 0,
    phase0P1: 0,
    phase0P2: 2,
    closure: closurePath
  }), 'post-closure authority governanceRecovery differs from the exact evidence-derived state');
  assert(JSON.stringify(status.governanceRecovery) === JSON.stringify({
    status: 'PASS_PHASE0_GOVERNANCE_RECOVERY',
    supersededClosureAttempt: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json',
    step2Correction: step2CorrectionPath,
    plannedCorrectedClosure: closurePath,
    phase0P0: 0,
    phase0P1: 0,
    phase0P2: 2,
    closure: closurePath
  }), 'post-closure PROJECT_STATUS governanceRecovery differs from the exact state');
  assert(JSON.stringify(sim.governanceRecovery) === JSON.stringify({
    status: 'PASS_PHASE0_GOVERNANCE_RECOVERY',
    supersededClosureAttempt: 'quality-reviews/step-1-canonical-design/active-change-control-addendum-round-030.json',
    step2Correction: step2CorrectionPath,
    plannedCorrectedClosure: closurePath,
    closure: closurePath
  }), 'post-closure simulation governanceRecovery differs from the exact state');
  for (const workflow of [completion.workflowEvidence, readback.workflow]) {
    assert(workflow?.commit === targetCommit && workflow?.tree === targetTree, 'workflow evidence target differs from corrected content');
    assert(workflow?.conclusion === 'SUCCESS', 'workflow evidence is not successful');
    assert(Number.isInteger(workflow?.runId) && workflow.runId > 0 && Number.isInteger(workflow?.jobId) && workflow.jobId > 0, 'workflow run/job binding missing');
    assert(Number.isInteger(workflow?.artifactId) && workflow.artifactId > 0 && /^sha256:[a-f0-9]{64}$/.test(workflow?.artifactDigest ?? ''), 'workflow artifact binding missing');
    assert(workflow.artifactName === `phase0-current-governance-${targetCommit}-${workflow.runId}-${workflow.runAttempt}`, 'workflow artifact name does not bind corrected content target/run/attempt');
  }
  assert(Array.isArray(step2Correction.evidenceOnlyWrites) && step2Correction.evidenceOnlyWrites.length > 0, 'round 032 evidence-only boundary missing');
  assert(JSON.stringify(step2Correction.evidenceOnlyWrites) === JSON.stringify(expectedEvidenceOnlyWrites), 'round 032 evidence-only allowlist is not the exact reviewed set');
  const postTargetImmutablePaths = [
    step2ContinuityPath,
    v3SealPath,
    ...requiredV3BindingPaths,
    step2CorrectionPath,
    'tests/governance/verify-current-authority.mjs',
    '.github/workflows/verify-current-governance.yml'
  ];
  for (const immutablePath of new Set(postTargetImmutablePaths)) {
    assert(!step2Correction.evidenceOnlyWrites.some(pattern => globMatch(pattern, immutablePath)), `post-target evidence allowlist covers immutable content: ${immutablePath}`);
  }
  const evidenceOnlyControl = { allowedWrites: step2Correction.evidenceOnlyWrites, forbiddenWrites: step2Correction.forbiddenWrites };
  assertBoundaryHistory(targetCommit, closureCommit, evidenceOnlyControl, 'post-target evidence-only range');
  const boundContentPaths = (v3Seal.bindings ?? []).map(binding => binding.path);
  assert(boundContentPaths.length > 0, 'v3 seal has no bound content paths');
  for (const binding of v3Seal.bindings) {
    assert(git(['rev-parse', `${targetCommit}:${binding.path}`]) === binding.blob, `critic target differs from v3 seal binding: ${binding.path}`);
    assert(git(['rev-parse', `HEAD:${binding.path}`]) === binding.blob, `v3 seal binding changed after criticism: ${binding.path}`);
  }
  assert(git(['rev-parse', `${targetCommit}:${v3SealPath}`]) === git(['rev-parse', `HEAD:${v3SealPath}`]), 'v3 seal changed after the critic target');
  assertNoPathChangesSince(targetCommit, closureCommit, [...new Set([...boundContentPaths, ...postTargetImmutablePaths])], 'post-critic v3 content freeze');
  assert(isAncestor(reopen.entry.head, closureCommit), 'round 033 closure is not descended from round 031 entry');
  assertBoundaryHistory(reopen.entry.head, step2Correction.entry.head, reopen, 'completed round 031 repair range');
  assertBoundaryHistory(step2Correction.entry.head, closureCommit, step2Correction, 'round 032 correction and round 033 closure range');
  if (s02RepairControl) {
    const repairEnd = s02P2OpeningCommit ? git(['rev-parse', `${s02P2OpeningCommit}^`]) : s02RevisionOpeningCommit ? git(['rev-parse', `${s02RevisionOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
    assertS02HistoryWithIncrementalRenewals(s02RepairOpeningCommit, repairEnd, s02RepairControl, 'round 034 S02-P1 repair range', '001');
    const assetSuccessorEnd = opening => s02AssetPassOpeningCommit ? git(['rev-parse', `${s02AssetPassOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
    if (s02P2Control) assertRegularBoundedHistory(s02P2OpeningCommit, assetSuccessorEnd(s02P2OpeningCommit), s02P2Control, 'round 035 representative asset-proof range');
    if (s02RevisionControl) {
      const end = s02RevisedP2OpeningCommit ? git(['rev-parse', `${s02RevisedP2OpeningCommit}^`]) : s02SecondRevisionOpeningCommit ? git(['rev-parse', `${s02SecondRevisionOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
      assertS02HistoryWithIncrementalRenewals(s02RevisionOpeningCommit, end, s02RevisionControl, 'round 036 revision/evidence range', '002');
    }
    if (s02RevisedP2Control) assertRegularBoundedHistory(s02RevisedP2OpeningCommit, assetSuccessorEnd(s02RevisedP2OpeningCommit), s02RevisedP2Control, 'round 037 representative asset-proof range');
    if (s02SecondRevisionControl) {
      const end = s02SecondRevisedP2OpeningCommit ? git(['rev-parse', `${s02SecondRevisedP2OpeningCommit}^`]) : s02ThirdRevisionOpeningCommit ? git(['rev-parse', `${s02ThirdRevisionOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
      assertS02HistoryWithIncrementalRenewals(s02SecondRevisionOpeningCommit, end, s02SecondRevisionControl, 'round 038 revision/evidence range', '003');
    }
    if (s02SecondRevisedP2Control) assertRegularBoundedHistory(s02SecondRevisedP2OpeningCommit, assetSuccessorEnd(s02SecondRevisedP2OpeningCommit), s02SecondRevisedP2Control, 'round 039 representative asset-proof range');
    if (s02ThirdRevisionControl) {
      const end = s02ThirdRevisedP2OpeningCommit ? git(['rev-parse', `${s02ThirdRevisedP2OpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
      assertS02HistoryWithIncrementalRenewals(s02ThirdRevisionOpeningCommit, end, s02ThirdRevisionControl, 'round 040 revision/evidence range', '004');
    }
    if (s02ThirdRevisedP2Control) assertRegularBoundedHistory(s02ThirdRevisedP2OpeningCommit, assetSuccessorEnd(s02ThirdRevisedP2OpeningCommit), s02ThirdRevisedP2Control, 'round 041 representative asset-proof range');
  } else {
    assertBoundaryHistory(closureCommit, git(['rev-parse', 'HEAD']), productControl, 'post-Phase0 round 026 audit state');
  }
}

assert(process.env.GITHUB_ACTIONS !== 'true' || requireLiveActions || semanticOnly, 'GitHub Actions must run the current verifier in live-provenance or uncredentialed semantic mode');
const expectedLiveWorkflowLabels = [
  ...(closureRepairCriticComplete ? ['closure-integrity critic'] : []),
  ...(step2Correction ? ['round 032 entry'] : []),
  ...(exists(step2ReviewPaths.liveReadback) ? ['Step 2 live readback'] : []),
  ...(exists(closureEvidence.completion) ? ['Phase 0 completion'] : []),
  ...(exists(closureEvidence.liveReadback) ? ['Phase 0 live readback'] : []),
  ...(s02RepairControl ? ['round 034 entry'] : []),
  ...(s02P2Control ? ['round 035 entry'] : []),
  ...(s02RevisionControl ? ['round 036 entry'] : []),
  ...(s02RevisedP2Control ? ['round 037 entry'] : []),
  ...(s02SecondRevisionControl ? ['round 038 entry'] : []),
  ...(s02SecondRevisedP2Control ? ['round 039 entry'] : []),
  ...(s02ThirdRevisionControl ? ['round 040 entry'] : []),
  ...(s02ThirdRevisedP2Control ? ['round 041 entry'] : [])
];
assert(JSON.stringify(liveWorkflowEvidenceRecords.map(entry => entry.label).sort()) === JSON.stringify(expectedLiveWorkflowLabels.sort()), 'registered live Actions evidence set differs from the exact phase-required set');
const currentHead = git(['rev-parse', 'HEAD']);
const exactRepairBootstrap = isExactRepairBootstrapCommit(currentHead);
if (requireLiveActions && liveWorkflowEvidenceRecords.length === 0) {
  assert(exactRepairBootstrap, 'empty live Actions evidence is allowed only for the exact immediate repair-bootstrap commit');
}
const artifactArchiveRequiredForCurrentPhase = true;
if (requireLiveActions) {
  const uniqueRecords = [...new Map(liveWorkflowEvidenceRecords.map(entry => [entry.key, entry])).values()];
  for (const entry of uniqueRecords) verifyLiveWorkflowEvidence(entry.evidence, entry.label, artifactArchiveRequiredForCurrentPhase);
}
const liveGitHubActionsProvenance = requireLiveActions
  ? (liveWorkflowEvidenceRecords.length > 0 ? 'VERIFIED_API' : 'PENDING_LIVE_PROVENANCE_READBACK')
  : 'NOT_CHECKED_LOCAL';
const currentGovernanceVerdict = liveGitHubActionsProvenance === 'VERIFIED_API'
  ? 'PASS_CURRENT_AUTHORITY_GOVERNANCE'
  : (liveGitHubActionsProvenance === 'PENDING_LIVE_PROVENANCE_READBACK'
    ? 'PENDING_LIVE_PROVENANCE_READBACK'
    : 'PASS_STATIC_CURRENT_AUTHORITY_NON_AUTHORIZING');

console.log(JSON.stringify({
  verdict: currentGovernanceVerdict,
  activeChangeControl: authority.activeChangeControl,
  governanceRecoveryClosure: authority.governanceRecovery?.closure || null,
  step2Status: authority.executableContract.step2Status,
  step2ActiveSeal: authority.executableContract.seal,
  step2BindingCount: verifiedV3Seal ? verifiedV3Seal.bindings.length : step2Seal.bindings.length,
  historicalStep2V2BindingCount: step2Seal.bindings.length,
  liveGitHubActionsProvenance,
  liveGitHubActionsEvidenceCount: liveWorkflowEvidenceRecords.length,
  step4Pass: false,
  step5Allowed: false,
  physicalIPhoneVerified: false,
  productionAliasChanged: false
}, null, 2));
