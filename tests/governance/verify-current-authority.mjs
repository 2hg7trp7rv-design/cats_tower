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
  return execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
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
    if (s02HarnessCorrectionCommit && commit === s02HarnessCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02HarnessCorrectionChangedPaths].sort()), `${label}: trusted-harness correction changed an unreviewed path`);
    } else if (s02QaCorrectionCommit && commit === s02QaCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02QaCorrectionChangedPaths].sort()), `${label}: QA-initialization correction changed an unreviewed path`);
    } else if (s02ReferenceQaCorrectionCommit && commit === s02ReferenceQaCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02ReferenceQaCorrectionChangedPaths].sort()), `${label}: review-reference QA correction changed an unreviewed path`);
    } else if (s02BrowserEvidenceCorrectionCommit && commit === s02BrowserEvidenceCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02BrowserEvidenceCorrectionChangedPaths].sort()), `${label}: browser-evidence correction changed an unreviewed path`);
    } else if (s02ExactCaptureCorrectionCommit && commit === s02ExactCaptureCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02ExactCaptureCorrectionChangedPaths].sort()), `${label}: exact-capture correction changed an unreviewed path`);
    } else if (s02SixFindingCorrectionCommit && commit === s02SixFindingCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02SixFindingCorrectionChangedPaths].sort()), `${label}: six-finding correction changed an unreviewed path`);
    } else if (s02FiveFindingCorrectionCommit && commit === s02FiveFindingCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02FiveFindingCorrectionChangedPaths].sort()), `${label}: five-finding correction changed an unreviewed path`);
    } else if (s02FourFindingCorrectionCommit && commit === s02FourFindingCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02FourFindingCorrectionChangedPaths].sort()), `${label}: four-finding correction changed an unreviewed path`);
    } else if (s02TwoFindingCorrectionCommit && commit === s02TwoFindingCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02TwoFindingCorrectionChangedPaths].sort()), `${label}: two-finding correction changed an unreviewed path`);
    } else if (s02RemainingTwoCorrectionCommit && commit === s02RemainingTwoCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02RemainingTwoCorrectionChangedPaths].sort()), `${label}: remaining-two correction changed an unreviewed path`);
    } else if (s02PixelMarginCorrectionCommit && commit === s02PixelMarginCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02PixelMarginCorrectionChangedPaths].sort()), `${label}: pixel-margin correction changed an unreviewed path`);
    } else if (s02FiligreeCorrectionCommit && commit === s02FiligreeCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02FiligreeCorrectionChangedPaths].sort()), `${label}: filigree correction changed an unreviewed path`);
    } else if (s02EvidenceTransportCorrectionCommit && commit === s02EvidenceTransportCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02EvidenceTransportCorrectionChangedPaths].sort()), `${label}: evidence-transport correction changed an unreviewed path`);
    } else if (s02ReviewVerifierCorrectionCommit && commit === s02ReviewVerifierCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02ReviewVerifierCorrectionChangedPaths].sort()), `${label}: review-verifier correction changed an unreviewed path`);
    } else if (s02ExternalPreviewVerifierCorrectionCommit && commit === s02ExternalPreviewVerifierCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02ExternalPreviewVerifierCorrectionChangedPaths].sort()), `${label}: external-preview verifier correction changed an unreviewed path`);
    } else if (s02ExternalPreviewRedirectCorrectionCommit && commit === s02ExternalPreviewRedirectCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02ExternalPreviewRedirectCorrectionChangedPaths].sort()), `${label}: external-preview redirect correction changed an unreviewed path`);
    } else if (s02ExternalPreviewBrowserCorrectionCommit && commit === s02ExternalPreviewBrowserCorrectionCommit) {
      assert(JSON.stringify([...paths].sort()) === JSON.stringify([...s02ExternalPreviewBrowserCorrectionChangedPaths].sort()), `${label}: external-preview browser correction changed an unreviewed path`);
    } else {
      assertBoundary(paths, control, `${label} commit ${commit}`);
    }
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
  if (!liveWorkflowEvidenceRecords.some(entry => entry.key === key && entry.label === label)) {
    liveWorkflowEvidenceRecords.push({ key, evidence, label });
  }
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
    assertExactKeySet(browserRaw, [...browserRawBaseKeys, 'offlineVariants', 'browserModes', ...(revisionProof ? ['requestMeasurements', 'assetParticipation'] : [])], `${label} browser raw`);
    assert(browserRaw.repository === '2hg7trp7rv-design/cats_tower' && browserRaw.branch === 'kimi' && browserRaw.head === evidence.commit && browserRaw.tree === evidence.tree, `${label}: browser raw target mismatch`);
    assertExactKeySet(browserRaw.browserModes, ['viewport', 'gmSwitches', 'fitActual', 'referenceCompare', 'diagnostics'], `${label} browser-mode evidence`);
    assertExactKeySet(browserRaw.browserModes.viewport, ['width', 'height'], `${label} browser-mode viewport`);
    assert(JSON.stringify(browserRaw.browserModes.viewport) === JSON.stringify({ width: 390, height: 844 }), `${label}: browser-mode evidence was not captured at the reviewed control viewport`);
    const modeGoldenMasters = ['GM01', 'GM02', 'GM03', 'GM04', 'GM05', 'GM06', 'GM07', 'GM08'];
    assert(Array.isArray(browserRaw.browserModes.gmSwitches) && browserRaw.browserModes.gmSwitches.length === modeGoldenMasters.length, `${label}: browser-mode evidence does not cover all eight Golden Master switches`);
    for (const [index, mode] of browserRaw.browserModes.gmSwitches.entries()) {
      assertExactKeySet(mode, ['requested', 'routePath', 'routeSearch', 'stageGm', 'fixtureId', 'layoutViewport', 'responsiveEvidenceOverride', 'selectedAriaCurrent', 'reviewId', 'ready', 'stageLayout', 'gameUiLayout', 'battlefieldLayout'], `${label} browser-mode GM switch ${index + 1}`);
      for (const layoutKey of ['stageLayout', 'gameUiLayout', 'battlefieldLayout']) assertExactKeySet(mode[layoutKey], ['width', 'height', 'scrollWidth', 'scrollHeight'], `${label} browser-mode GM switch ${index + 1} ${layoutKey}`);
      const id = modeGoldenMasters[index];
      const expectedViewport = s02ExpectedScreenshots[index].viewport;
      assert(mode.requested === id && mode.stageGm === id && mode.reviewId === id && mode.fixtureId === `s02.p1.fixture.${id}` && mode.routePath === '/step4/s02/golden-master-p1/' && mode.routeSearch === `?gm=${id}` && mode.layoutViewport === expectedViewport && mode.responsiveEvidenceOverride === '' && mode.selectedAriaCurrent === 'page' && mode.ready === 'true', `${label}: browser-mode switch identity/state mismatch for ${id}`);
      assert(mode.stageLayout.width === s02ExpectedScreenshots[index].width && mode.stageLayout.height >= s02ExpectedScreenshots[index].height && mode.gameUiLayout.width === s02ExpectedScreenshots[index].width && mode.gameUiLayout.height === mode.stageLayout.scrollHeight && mode.battlefieldLayout.width === s02ExpectedScreenshots[index].width && mode.battlefieldLayout.height >= 300, `${label}: browser-mode switch layout mismatch for ${id}`);
    }
    assertExactKeySet(browserRaw.browserModes.fitActual, ['fitBefore', 'actual', 'fitAfter'], `${label} fit/actual mode evidence`);
    for (const key of ['fitBefore', 'actual', 'fitAfter']) assertExactKeySet(browserRaw.browserModes.fitActual[key], ['actualSizeClass', 'fitAriaPressed', 'actualAriaPressed', 'nominalWidth', 'nominalHeight', 'reviewSizing', 'reviewScale', 'viewportReadout', 'reviewTransform', 'reviewMatrixScaleX', 'stageRect'], `${label} fit/actual mode ${key}`);
    assert(browserRaw.browserModes.fitActual.fitBefore.fitAriaPressed === 'true' && browserRaw.browserModes.fitActual.actual.actualAriaPressed === 'true' && browserRaw.browserModes.fitActual.actual.reviewSizing === 'ACTUAL_1_TO_1' && browserRaw.browserModes.fitActual.actual.reviewMatrixScaleX === 1 && browserRaw.browserModes.fitActual.fitAfter.fitAriaPressed === 'true', `${label}: fit/actual mode toggle did not complete its reversible state transition`);
    assertExactKeySet(browserRaw.browserModes.referenceCompare, ['closedBefore', 'open', 'closedAfter'], `${label} reference-compare mode evidence`);
    for (const key of ['closedBefore', 'open', 'closedAfter']) assertExactKeySet(browserRaw.browserModes.referenceCompare[key], ['comparingClass', 'singleAriaPressed', 'compareAriaPressed', 'referenceHidden', 'referenceRendered', 'referenceViewportVisible', 'referenceOutsideStage', 'referenceDecoded', 'surfaceScrollLeft'], `${label} reference-compare mode ${key}`);
    assert(browserRaw.browserModes.referenceCompare.closedBefore.referenceHidden === true && browserRaw.browserModes.referenceCompare.open.referenceRendered === true && browserRaw.browserModes.referenceCompare.open.referenceOutsideStage === true && browserRaw.browserModes.referenceCompare.closedAfter.referenceHidden === true, `${label}: reference comparison did not open outside the game stage and close reversibly`);
    assertExactKeySet(browserRaw.browserModes.diagnostics, ['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'resourcePaths', 'unexpectedResponses'], `${label} browser-mode diagnostics`);
    assert(['consoleErrors', 'pageErrors', 'failedRequests', 'externalResources', 'unexpectedResponses'].every(key => Array.isArray(browserRaw.browserModes.diagnostics[key]) && browserRaw.browserModes.diagnostics[key].length === 0), `${label}: browser-mode diagnostics contain an error, external resource or unexpected response`);
    assert(JSON.stringify(browserRaw.browserModes.diagnostics.resourcePaths) === JSON.stringify(['/step4/s02/golden-master-p1/', '/step4/s02/golden-master-p1/app.js', '/step4/s02/golden-master-p1/assets/clockwork-marten.webp', '/step4/s02/golden-master-p1/assets/party-actions.webp', '/step4/s02/golden-master-p1/assets/party-roster.webp', '/step4/s02/golden-master-p1/assets/prior-reference-s02.webp', '/step4/s02/golden-master-p1/assets/tower-corridor.webp', '/step4/s02/golden-master-p1/styles.css']), `${label}: browser-mode resource set differs from the closed local review graph`);
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
  process.exitCode = 1;
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
function resolveStep2PreSealVerifierCorrectionCommit() {
  if (!exists(step2ReviewPaths.liveReadback)) return null;
  const readbackCommit = firstAddCommit(step2ReviewPaths.liveReadback);
  if (!readbackCommit) return null;
  const sealCommit = exists(v3SealPath) ? firstAddCommit(v3SealPath) : null;
  const rangeEnd = sealCommit ? git(['rev-parse', `${sealCommit}^`]) : git(['rev-parse', 'HEAD']);
  const output = git(['log', '--reverse', '--format=%H', `${readbackCommit}..${rangeEnd}`, '--', 'tests/governance/verify-current-authority.mjs']);
  const commits = output ? output.split('\n').filter(Boolean) : [];
  assert(commits.length <= 1, 'Step 2 verifier changed more than once between the live readback and v3 seal');
  return commits[0] ?? null;
}
const phase0ClosureLiveReadbackPath = 'quality-reviews/phase-0-governance-recovery/live-readback-round-002.json';
function resolveStep2PostContinuityVerifierCorrectionCommits() {
  if (!exists(step2ContinuityPath)) return null;
  const continuityCommit = firstAddCommit(step2ContinuityPath);
  if (!continuityCommit) return null;
  const compatibilityRangeEnd = s02RepairOpeningCommit ? git(['rev-parse', `${s02RepairOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);
  const output = git(['log', '--reverse', '--format=%H', `${continuityCommit}..${compatibilityRangeEnd}`, '--', 'tests/governance/verify-current-authority.mjs']);
  const commits = output ? output.split('\n').filter(Boolean) : [];
  assert(commits.length <= 2, 'Step 2 verifier changed beyond the reviewed activation and pre-closure compatibility corrections');
  return commits;
}
function resolveStep2PostContinuityVerifierCorrectionCommit() {
  return resolveStep2PostContinuityVerifierCorrectionCommits()?.[0] ?? null;
}
function resolveStep2PreClosureVerifierCorrectionCommit() {
  return resolveStep2PostContinuityVerifierCorrectionCommits()?.[1] ?? null;
}
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
const expectedS02RepairControlBlob = '286daad09d0f25c5c1898615c75907d26b1096b7';
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
const expectedS02WorkflowCorrectionRound001Sha256 = '7219aba5d01f68105339a9815ce61f2d5c265a1c0b9e544f30f50056a7242225';
const expectedS02WorkflowCorrectionRound002Sha256 = '32e82c7b97cab50f6d51622f316fe11f33ed259d4c0372d1925af58bf4e2592d';
const expectedS02WorkflowCorrectionRound003Sha256 = '79d84163ca190041b814b80c4ef020b758d0c61cac36751c498194680904b9c0';
const expectedS02WorkflowCorrectionRound004Sha256 = '2119936e77a9b1b70e27b30697886519e0c9cb81d26fa585cc32801454ab532b';
const expectedS02WorkflowCorrectionRound005Sha256 = '4fa345932c2ba70a09e5726190cfef10690ca81b5b030612fc96fab7976f384c';
const expectedS02WorkflowSha256 = 'ebd5732f09d76d997c1642ea3b861f9e8373b6d18ea2781768e7e31e2cbef12e';
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
    testAssertions: ['SEVEN_REQUIRED_VIEWPORTS_PASS', 'NONZERO_SAFE_AREA_PASS', 'TEXT_200_PERCENT_NO_LOSS', 'LAYOUT_AND_VISUAL_VIEWPORT_MATCH', 'INITIAL_SCROLL_ORIGIN_ZERO', 'UNIFORM_FULL_SCREEN_SCALE_ABSENT', 'REDUCED_MOTION_POLICY_NATIVE', 'REVIEW_BROWSER_MODES_OPERABLE', 'GM05_UI_ANTI_BLOAT', 'RESPONSIVE_GEOMETRY_CONTRACT', 'GM04_REFLOW_OR_SCROLL_PASS']
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
  LAYOUT_AND_VISUAL_VIEWPORT_MATCH: ['EQUALS', true, 'boolean'],
  INITIAL_SCROLL_ORIGIN_ZERO: ['EQUALS', true, 'boolean'],
  UNIFORM_FULL_SCREEN_SCALE_ABSENT: ['EQUALS', true, 'boolean'],
  REDUCED_MOTION_POLICY_NATIVE: ['EQUALS', true, 'boolean'],
  REVIEW_BROWSER_MODES_OPERABLE: ['EQUALS', true, 'boolean'],
  GM05_UI_ANTI_BLOAT: ['EQUALS', true, 'boolean'],
  RESPONSIVE_GEOMETRY_CONTRACT: ['EQUALS', true, 'boolean'],
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
  const firstAdmissionCommit = firstAddCommit(admissionPaths.admission);
  const recoveredInitialAdmission = evidenceRound === '001' && Boolean(s02EvidenceTransportCorrection);
  const admissionCommit = recoveredInitialAdmission ? s02EvidenceTransportCorrectionCommit : firstAdmissionCommit;
  if (recoveredInitialAdmission) {
    assert(firstAdmissionCommit === s02InvalidAdmissionCommit && git(['rev-parse', `${s02InvalidAdmissionCommit}^`]) === packageCommit, `${label}: transport recovery does not immediately follow the exact durable package through the preserved invalid attempt`);
    assertExactChangedPaths(packageCommit, s02InvalidAdmissionCommit, [admissionPaths.admission], `${label} preserved invalid admission attempt`);
    assert(git(['rev-parse', `${s02InvalidAdmissionCommit}:${admissionPaths.admission}`]) === s02InvalidAdmissionBlob, `${label}: preserved invalid admission blob mismatch`);
    assertExactSingleParent(admissionCommit, s02InvalidAdmissionCommit, `${label} corrected authenticated S02 package admission`);
    assertExactChangedPaths(s02InvalidAdmissionCommit, admissionCommit, s02EvidenceTransportCorrectionChangedPaths, `${label} corrected authenticated S02 package admission`);
    assertRegularGitFile(admissionPaths.admission, `${label} recovered admission`);
    assert(git(['rev-parse', `HEAD:${admissionPaths.admission}`]) !== s02InvalidAdmissionBlob, `${label}: recovered admission still resolves to the invalid transport blob`);
    const transportVerifierFreezeEnd = s02ReviewVerifierCorrectionCommit ? git(['rev-parse', `${s02ReviewVerifierCorrectionCommit}^`]) : 'HEAD';
    assertNoPathChangesSince(admissionCommit, 'HEAD', [admissionPaths.admission, s02EvidenceTransportCorrectionPath], `${label} transport-recovery evidence freeze`);
    assertNoPathChangesSince(admissionCommit, transportVerifierFreezeEnd, ['tests/governance/verify-current-authority.mjs'], `${label} transport-recovery verifier freeze`);
  } else {
    assertExactSingleParent(admissionCommit, packageCommit, `${label} authenticated S02 package admission`);
    assertExactChangedPaths(packageCommit, admissionCommit, [admissionPaths.admission], `${label} authenticated S02 package admission`);
    assertAddedOnceAndUnchanged(admissionPaths.admission, admissionCommit);
  }
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
    'README.md': ['çŒ«ã¨çŒ«äººã®4ä½“ç·¨æˆã‚’è‚²ã¦ã€åº—èˆ—ãƒ»é…é€ã®æ”¯æ´ã‚’å—ã‘ãªãŒã‚‰ä¸Šé™ã®ãªã„å¡”ã‚’ç™»ã‚Šã€ä¸€ã¤ã®`reset.tower_return`ã§1Fã‹ã‚‰å‰å›žã‚ˆã‚Šé€Ÿãå†æ”»ç•¥ã™ã‚‹ã€ã‚¹ãƒžãƒ¼ãƒˆãƒ•ã‚©ãƒ³ç¸¦ç”»é¢å‘ã‘æ”¾ç½®ã‚¤ãƒ³ã‚¯ãƒªãƒ¡ãƒ³ã‚¿ãƒ«RPGã€‚\n', `\n${humanTruthBlock}\n`]
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
    'QUALITY_GATE.md': `# Cat's Tower â€” Current Quality Gate\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round032Snapshot}\n\n## Current gate\n\n- Repository Step: \`4\` / \`IN_PROGRESS\`\n- Internal phase: \`STEP2-SCREEN-PROJECTION-CORRECTION\`\n- Step 2: \`IN_PROGRESS_CONTRACT_CORRECTION_REQUIRED\`; immutable v2 remains historical evidence\n- Phase 0 unresolved P0/P1: \`0 / 0\` after the numbered round 031 independent re-critic\n- Current global P0/P1: \`1 / 1\` (Step 2 screen projection / S02 visual quality)\n- Step 4 PASS: \`false\`; Step 5 allowed: \`false\`\n\n## Allowed next work\n\nCorrect only the versioned S01-S12 screen projection under round 032, bind v3 review and Step 3 continuity evidence, then close Phase 0 through round 033. S02 product content remains read-only.\n`,
    'PROJECT_HANDOVER.md': `# Cat's Tower â€” Current Handover\n\nRepository: \`2hg7trp7rv-design/cats_tower\`\nBranch: existing \`kimi\` only\n\n${common}\n${round032Snapshot}\n\n## Purpose\n\nRepair the canonical Step 2 S01-S12 screen projection without changing immutable v2 history, runtime, economy, save data, Production or device claims.\n\n## Completed so far\n\nThe numbered round 031 independent re-critic verified the closure-integrity repair at Phase 0 P0/P1 \`0 / 0\`. Round 032 is active; S02 A-J and GM01-GM08 remain preserved and read-only.\n\n## Next\n\n1. create and validate the versioned v3 semantic contract\n2. bind independent critic, judge, completion and live readback\n3. prove Step 3 numeric continuity\n4. close corrected Phase 0 under round 033\n5. return to round 026 and audit the preserved S02 Golden Master\n`,
    '.github/workflows/CURRENT_STATUS.md': `# Cat's Tower â€” Current Workflow Status\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round032Snapshot}\n\n## Enforced state\n\n- every \`kimi\` push runs current-governance verification\n- Step 2 v2 is immutable historical evidence; semantic status remains open\n- round 032 may write only the reviewed v3 correction and numbered evidence paths\n- S02 product, runtime, economy, save, Production and physical-device state are frozen\n- corrected closure is reserved for round 033 after live provenance and continuity succeed\n`,
    'AGENTS.md': `# Cat's Tower â€” Agent Execution Boundary\n\nDo not infer current status from historical headers, chat history, old workflows or file existence.\n\n${common}\n${round032Snapshot}\n\n## Current authority\n\nRead \`CURRENT_AUTHORITY_INDEX.json\`, then the active round 032 control. Work only on the versioned Step 2 screen-projection correction. Do not rewrite v2 evidence or mutate S02 product content, runtime, economy, save, assets, Vercel Production or provider settings.\n\n## Required sequence\n\nSemantic target, independent critic, final judge, completion, live readback, v3 seal, continuity-only commit, PASS activation, numbered Phase 0 evidence, then exact round 033 closure.\n`,
    'README.md': `# Cat's Tower\n\nçŒ«ã¨çŒ«äººã®4ä½“ç·¨æˆã‚’è‚²ã¦ã€åº—èˆ—ãƒ»é…é€ã®æ”¯æ´ã‚’å—ã‘ãªãŒã‚‰ä¸Šé™ã®ãªã„å¡”ã‚’ç™»ã‚‹ã€ã‚¹ãƒžãƒ¼ãƒˆãƒ•ã‚©ãƒ³ç¸¦ç”»é¢å‘ã‘æ”¾ç½®ã‚¤ãƒ³ã‚¯ãƒªãƒ¡ãƒ³ã‚¿ãƒ«RPGã€‚\n\n${common}\n${round032Snapshot}\n\n## Current work\n\nRepository Step 4 remains in progress. The active work is the narrow, versioned Step 2 S01-S12 screen-projection correction required before the preserved S02 Golden Master can be audited and repaired. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.\n`
  };
  assert(Object.hasOwn(documents, file), `round 032 document template missing: ${file}`);
  return documents[file];
}
function expectedRound033DocumentText(file) {
  const common = `${humanTruthBlock}\n`;
  const documents = {
    'QUALITY_GATE.md': `# Cat's Tower â€” Current Quality Gate\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round033Snapshot}\n\n## Current gate\n\n- Repository Step: \`4\` / \`IN_PROGRESS\`\n- Step 2: \`PASS_CONTRACT\` under immutable v3 screen-projection seal\n- Step 3: \`PASS_MODEL\`; this is not runtime playtest evidence\n- Corrected Phase 0 unresolved P0/P1: \`0 / 0\`\n- Current S02 visual P1: \`1\` (\`S4-RECOVERY-VIS-001\`)\n- Step 4 PASS: \`false\`; Step 5 allowed: \`false\`\n\n## Allowed next work\n\nAudit the preserved S02 A-J and GM01-GM08 under round 026, reuse conforming material and repair only evidenced gaps. The maximum before explicit user visual approval is \`READY_FOR_USER_VISUAL_REVIEW\`.\n`,
    'PROJECT_HANDOVER.md': `# Cat's Tower â€” Current Handover\n\nRepository: \`2hg7trp7rv-design/cats_tower\`\nBranch: existing \`kimi\` only\n\n${common}\n${round033Snapshot}\n\n## Purpose\n\nBuild a production-quality S02 Golden Master and implementation contract before replacing the actual game runtime.\n\n## Completed so far\n\nRound 031 closure-integrity repair, the versioned Step 2 v3 screen projection, Step 3 continuity proof and numbered Phase 0 review chain are closed by round 033. Existing S02 A-J and GM01-GM08 are preserved but not visually accepted.\n\n## Next\n\n1. inventory the preserved S02 deliverables\n2. repair all independently evidenced visual P1 gaps\n3. verify 320â€“430 px responsive and accessibility boundaries\n4. publish only a Preview design-review route\n5. request explicit user visual review; do not infer approval\n`,
    '.github/workflows/CURRENT_STATUS.md': `# Cat's Tower â€” Current Workflow Status\n\nAuthority: \`CURRENT_AUTHORITY_INDEX.json\`\n\n${common}\n${round033Snapshot}\n\n## Enforced state\n\n- current authority returned to round 026 after corrected Phase 0 closure\n- immutable Step 2 v3 seal and Step 3 continuity evidence remain verified\n- current product work is the S02 A-J / GM01-GM08 audit\n- root runtime, economy, save, Production and physical-device state remain unchanged\n- current maximum is \`READY_FOR_USER_VISUAL_REVIEW\`\n`,
    'AGENTS.md': `# Cat's Tower â€” Agent Execution Boundary\n\nDo not infer current status from historical headers, chat history, old workflows or file existence.\n\n${common}\n${round033Snapshot}\n\n## Current authority\n\nRead \`CURRENT_AUTHORITY_INDEX.json\`, then round 026. Audit the preserved S02 A-J and GM01-GM08 first. Reuse conforming content and repair only independently evidenced gaps. Do not replace the actual root runtime, change gameplay numbers, economy, save schema, backend, payment, ads, Production or physical-device verdicts during S02-P1.\n`,
    'README.md': `# Cat's Tower\n\nçŒ«ã¨çŒ«äººã®4ä½“ç·¨æˆã‚’è‚²ã¦ã€åº—èˆ—ãƒ»é…é€ã®æ”¯æ´ã‚’å—ã‘ãªãŒã‚‰ä¸Šé™ã®ãªã„å¡”ã‚’ç™»ã‚‹ã€ã‚¹ãƒžãƒ¼ãƒˆãƒ•ã‚©ãƒ³ç¸¦ç”»é¢å‘ã‘æ”¾ç½®ã‚¤ãƒ³ã‚¯ãƒªãƒ¡ãƒ³ã‚¿ãƒ«RPGã€‚\n\n${common}\n${round033Snapshot}\n\n## Current work\n\nRepository Step 4 remains in progress. Corrected Phase 0 has returned authority to the S02-P1 Golden Master audit. The preserved design-review route and eight states are inputs, not accepted output; independently evidenced gaps must be repaired before user visual review. Runtime, gameplay numbers, economy, save data, backend, Production and physical-device verdicts are unchanged.\n`
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
    source = replaceOnce(source, 'The numbered round 031 independent re-critic verified the closure-integrity repair at Phase 0 P0/P1 `0 / 0`. Round 032 is active; S02 A-J and GM01-GM08 remain preserved and read-only.', `The numbered round 031 re-critic passed; Phase 0 P0/P1 \`0 / 0\`; Step 2 is now \`PASS_CONTRACT\` under \`${v3SealPath}\`; Step 3 continuity is verified. Round 032 remains active only for numbered Phase 0 evidence and round 033 closure. The global P1 is the separate S02 visual finding. S02 A-J and GM01-GM08 remain read-only.`, 'round 032 PASS handover progress');
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
    source = replaceOnce(source, '1. inventory the preserved S02 deliverables\n2. repair all independently evidenced visual P1 gaps\n3. verify 320â€“430 px responsive and accessibility boundaries\n4. publish only a Preview design-review route\n5. request explicit user visual review; do not infer approval', '1. repair all 10 independently evidenced S02 P1 groups\n2. verify all required 320â€“430 px viewports, Safe Area, 200% text and 44/48 px targets\n3. bind static, browser, independent critic, final judge and Preview deployment evidence\n4. publish only the design-review Preview route\n5. request explicit user visual review; do not infer approval', 'round 034 repair handover next');
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
    source = replaceOnce(source, '1. repair all 10 independently evidenced S02 P1 groups\n2. verify all required 320â€“430 px viewports, Safe Area, 200% text and 44/48 px targets\n3. bind static, browser, independent critic, final judge and Preview deployment evidence\n4. publish only the design-review Preview route\n5. request explicit user visual review; do not infer approval', '1. present all eight Golden Masters individually on the immutable Preview deployment\n2. collect explicit user visual approval or concrete revision requests\n3. if revisions are requested, reopen only the evidenced S02 gaps\n4. do not start P2 asset production before explicit approval and bound evidence', 'round 034 ready handover next');
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
  const v3SemanticCommit = exists('simulation/candidate-v3.json') ? firstAddCommit('simulation/candidate-v3.json') : null;
  if (v3SemanticCommit) {
    assert(git(['rev-parse', `${v3SemanticCommit}^`]) === correctionControlCommit, 'round 032 v3 semantic target must immediately follow the opening commit');
    assert(git(['log', '--format=%H', `${correctionControlCommit}..${v3SemanticCommit}`, '--', 'tests/governance/verify-current-authority.mjs']) === v3SemanticCommit, 'round 032 semantic target verifier correction is not one dedicated reviewed change');
    const preSealVerifierCorrectionCommit = resolveStep2PreSealVerifierCorrectionCommit();
    const postContinuityVerifierCorrectionCommit = resolveStep2PostContinuityVerifierCorrectionCommit();
    const preClosureVerifierCorrectionCommit = resolveStep2PreClosureVerifierCorrectionCommit();
    if (postContinuityVerifierCorrectionCommit) {
      const continuityCommit = firstAddCommit(step2ContinuityPath);
      assert(preSealVerifierCorrectionCommit, 'Step 2 post-continuity verifier correction requires the reviewed pre-seal correction');
      assert(git(['rev-parse', `${preSealVerifierCorrectionCommit}^`]) === firstAddCommit(step2ReviewPaths.liveReadback), 'Step 2 pre-seal verifier correction must immediately follow the live readback');
      assertNoPathChangesSince(preSealVerifierCorrectionCommit, continuityCommit, ['tests/governance/verify-current-authority.mjs'], 'round 032 verifier freeze from pre-seal correction through continuity');
      assert(git(['rev-parse', `${postContinuityVerifierCorrectionCommit}^`]) === continuityCommit, 'Step 2 post-continuity verifier correction must immediately follow the continuity bridge');
      assertExactChangedPaths(continuityCommit, postContinuityVerifierCorrectionCommit, ['tests/governance/verify-current-authority.mjs'], 'Step 2 post-continuity verifier correction');
      if (preClosureVerifierCorrectionCommit) {
        const phase0ReadbackCommit = firstAddCommit(phase0ClosureLiveReadbackPath);
        assert(phase0ReadbackCommit && git(['rev-parse', `${preClosureVerifierCorrectionCommit}^`]) === phase0ReadbackCommit, 'Step 2 pre-closure verifier correction must immediately follow the Phase 0 live readback');
        assertExactChangedPaths(phase0ReadbackCommit, preClosureVerifierCorrectionCommit, ['tests/governance/verify-current-authority.mjs'], 'Step 2 pre-closure verifier correction');
        assertNoPathChangesSince(postContinuityVerifierCorrectionCommit, phase0ReadbackCommit, ['tests/governance/verify-current-authority.mjs'], 'round 032 verifier freeze from activation correction through live readback');
        assertNoPathChangesSince(preClosureVerifierCorrectionCommit, governanceFreezeEnd, ['tests/governance/verify-current-authority.mjs'], 'round 032 verifier freeze after the pre-closure correction');
      } else {
        assertNoPathChangesSince(postContinuityVerifierCorrectionCommit, governanceFreezeEnd, ['tests/governance/verify-current-authority.mjs'], 'round 032 verifier freeze after the post-continuity correction');
      }
    } else if (preSealVerifierCorrectionCommit) {
      const readbackCommit = firstAddCommit(step2ReviewPaths.liveReadback);
      assert(git(['rev-parse', `${preSealVerifierCorrectionCommit}^`]) === readbackCommit, 'Step 2 pre-seal verifier correction must immediately follow the live readback');
      assertExactChangedPaths(readbackCommit, preSealVerifierCorrectionCommit, ['tests/governance/verify-current-authority.mjs'], 'Step 2 pre-seal verifier correction');
      assertNoPathChangesSince(preSealVerifierCorrectionCommit, governanceFreezeEnd, ['tests/governance/verify-current-authority.mjs'], 'round 032 verifier freeze after the pre-seal correction');
    } else {
      assertNoPathChangesSince(v3SemanticCommit, governanceFreezeEnd, ['tests/governance/verify-current-authority.mjs'], 'round 032 verifier freeze after the exact semantic-target repair');
    }
  } else {
    assertNoPathChangesSince(correctionControlCommit, governanceFreezeEnd, ['tests/governance/verify-current-authority.mjs'], 'round 032 verifier freeze before the semantic target');
  }
  assertNoPathChangesSince(correctionControlCommit, governanceFreezeEnd, ['.github/workflows/verify-current-governance.yml'], 'round 032 workflow freeze through round 033 closure');
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
  const oldCompatibilityResolver = "  const output = git(['log', '--reverse', '--format=%H', `${continuityCommit}..HEAD`, '--', 'tests/governance/verify-current-authority.mjs']);";
  const newCompatibilityResolver = "  const compatibilityRangeEnd = s02RepairOpeningCommit ? git(['rev-parse', `${s02RepairOpeningCommit}^`]) : git(['rev-parse', 'HEAD']);\n  const output = git(['log', '--reverse', '--format=%H', `${continuityCommit}..${compatibilityRangeEnd}`, '--', 'tests/governance/verify-current-authority.mjs']);";
  const expectedVerifierAtOpening = verifierBeforeOpening
    .replace(oldCompatibilityResolver, newCompatibilityResolver)
    .replace('const expectedS02RepairControlBlob = null;', `const expectedS02RepairControlBlob = '${expectedS02RepairControlBlob}';`);
  const normalizeOpeningSelfCheck = source => source.replace(
    /  const verifierBeforeOpening = textAt\(closureCommit, 'tests\/governance\/verify-current-authority\.mjs'\);[\s\S]*?assert\(expectedVerifierAtOpening !== verifierBeforeOpening && [\s\S]*?'round 034 opening changed the verifier beyond the reviewed control-blob pin'\);\n/,
    '  <ROUND_034_OPENING_SELF_CHECK>\n'
  );
  assert(expectedVerifierAtOpening !== verifierBeforeOpening && normalizeOpeningSelfCheck(textAt(openingCommit, 'tests/governance/verify-current-authority.mjs')) === normalizeOpeningSelfCheck(expectedVerifierAtOpening), 'round 034 opening changed the verifier beyond the reviewed control-blob pin');
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

const s02QaCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-002.json';
const s02QaCorrection = exists(s02QaCorrectionPath) ? json(s02QaCorrectionPath) : null;
const s02QaCorrectionCommit = s02QaCorrection ? firstAddCommit(s02QaCorrectionPath) : null;
const s02QaCorrectionChangedPaths = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  s02QaCorrectionPath,
  'tests/governance/verify-current-authority.mjs',
  'tests/step4/s02-golden-master-p1-browser-qa.mjs'
];
const s02ReferenceQaCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-003.json';
const s02ReferenceQaCorrection = exists(s02ReferenceQaCorrectionPath) ? json(s02ReferenceQaCorrectionPath) : null;
const s02ReferenceQaCorrectionCommit = s02ReferenceQaCorrection ? firstAddCommit(s02ReferenceQaCorrectionPath) : null;
const s02ReferenceQaCorrectionChangedPaths = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  s02ReferenceQaCorrectionPath,
  'tests/governance/verify-current-authority.mjs',
  'tests/step4/s02-golden-master-p1-browser-qa.mjs'
];
const s02BrowserEvidenceCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-004.json';
const s02BrowserEvidenceCorrection = exists(s02BrowserEvidenceCorrectionPath) ? json(s02BrowserEvidenceCorrectionPath) : null;
const s02BrowserEvidenceCorrectionCommit = s02BrowserEvidenceCorrection ? firstAddCommit(s02BrowserEvidenceCorrectionPath) : null;
const s02BrowserEvidenceCorrectionChangedPaths = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  s02BrowserEvidenceCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs',
  'tests/step4/s02-golden-master-p1-browser-qa.mjs',
  'tests/step4/s02-golden-master-p1-browser.mjs'
];
const s02ExactCaptureCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-005.json';
const s02ExactCaptureCorrection = exists(s02ExactCaptureCorrectionPath) ? json(s02ExactCaptureCorrectionPath) : null;
const s02ExactCaptureCorrectionCommit = s02ExactCaptureCorrection ? firstAddCommit(s02ExactCaptureCorrectionPath) : null;
const s02ExactCaptureCorrectionChangedPaths = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  s02ExactCaptureCorrectionPath,
  'tests/governance/verify-current-authority.mjs',
  'tests/step4/s02-golden-master-p1-browser.mjs'
];
const s02SixFindingCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-006.json';
const s02SixFindingCorrection = exists(s02SixFindingCorrectionPath) ? json(s02SixFindingCorrectionPath) : null;
const s02SixFindingCorrectionCommit = s02SixFindingCorrection ? firstAddCommit(s02SixFindingCorrectionPath) : null;
const s02SixFindingCorrectionChangedPaths = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  s02SixFindingCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs',
  'tests/step4/s02-golden-master-p1-browser-qa.mjs',
  'tests/step4/s02-golden-master-p1-browser.mjs'
];
const s02FiveFindingCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-007.json';
const s02FiveFindingCorrection = exists(s02FiveFindingCorrectionPath) ? json(s02FiveFindingCorrectionPath) : null;
const s02FiveFindingCorrectionCommit = s02FiveFindingCorrection ? firstAddCommit(s02FiveFindingCorrectionPath) : null;
const s02FiveFindingCorrectionChangedPaths = [
  s02FiveFindingCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs'
];
const s02FourFindingCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-008.json';
const s02FourFindingCorrection = exists(s02FourFindingCorrectionPath) ? json(s02FourFindingCorrectionPath) : null;
const s02FourFindingCorrectionCommit = s02FourFindingCorrection ? firstAddCommit(s02FourFindingCorrectionPath) : null;
const s02FourFindingCorrectionChangedPaths = [
  s02FourFindingCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs'
];
const s02TwoFindingCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-009.json';
const s02TwoFindingCorrection = exists(s02TwoFindingCorrectionPath) ? json(s02TwoFindingCorrectionPath) : null;
const s02TwoFindingCorrectionCommit = s02TwoFindingCorrection ? firstAddCommit(s02TwoFindingCorrectionPath) : null;
const s02TwoFindingCorrectionChangedPaths = [
  s02TwoFindingCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs'
];
const s02RemainingTwoCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-010.json';
const s02RemainingTwoCorrection = exists(s02RemainingTwoCorrectionPath) ? json(s02RemainingTwoCorrectionPath) : null;
const s02RemainingTwoCorrectionCommit = s02RemainingTwoCorrection ? firstAddCommit(s02RemainingTwoCorrectionPath) : null;
const s02RemainingTwoCorrectionChangedPaths = [
  s02RemainingTwoCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs'
];
const s02PixelMarginCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-011.json';
const s02PixelMarginCorrection = exists(s02PixelMarginCorrectionPath) ? json(s02PixelMarginCorrectionPath) : null;
const s02PixelMarginCorrectionCommit = s02PixelMarginCorrection ? firstAddCommit(s02PixelMarginCorrectionPath) : null;
const s02PixelMarginCorrectionChangedPaths = [
  s02PixelMarginCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs'
];
const s02FiligreeCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-012.json';
const s02FiligreeCorrection = exists(s02FiligreeCorrectionPath) ? json(s02FiligreeCorrectionPath) : null;
const s02FiligreeCorrectionCommit = s02FiligreeCorrection ? firstAddCommit(s02FiligreeCorrectionPath) : null;
const s02FiligreeCorrectionChangedPaths = [
  s02FiligreeCorrectionPath,
  'step4/s02/golden-master-p1/review-manifest.json',
  'step4/s02/golden-master-p1/styles.css',
  'tests/governance/verify-current-authority.mjs'
];
const s02EvidenceTransportCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-evidence-transport-correction-round-001.json';
const s02EvidenceTransportCorrection = exists(s02EvidenceTransportCorrectionPath) ? json(s02EvidenceTransportCorrectionPath) : null;
const s02EvidenceTransportCorrectionCommit = s02EvidenceTransportCorrection ? firstAddCommit(s02EvidenceTransportCorrectionPath) : null;
const s02InvalidAdmissionCommit = 'cc8c4a78bede734dc61ad46bfb0170cf7606b002';
const s02InvalidAdmissionBlob = '821f2b5844d1c2e0250c2bcabfa04e7eab7cbfbc';
const s02EvidenceTransportCorrectionChangedPaths = [
  'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-workflow-authenticated-admission-round-001.json',
  s02EvidenceTransportCorrectionPath,
  'tests/governance/verify-current-authority.mjs'
];
const s02ReviewVerifierCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-013.json';
const s02ReviewVerifierCorrection = exists(s02ReviewVerifierCorrectionPath) ? json(s02ReviewVerifierCorrectionPath) : null;
const s02ReviewVerifierCorrectionCommit = s02ReviewVerifierCorrection ? firstAddCommit(s02ReviewVerifierCorrectionPath) : null;
const s02ReviewVerifierCorrectionChangedPaths = [
  s02ReviewVerifierCorrectionPath,
  'tests/governance/verify-current-authority.mjs'
];
const s02ExternalPreviewVerifierCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-external-preview-verifier-correction-round-001.json';
const s02ExternalPreviewVerifierCorrection = exists(s02ExternalPreviewVerifierCorrectionPath) ? json(s02ExternalPreviewVerifierCorrectionPath) : null;
const s02ExternalPreviewVerifierCorrectionCommit = s02ExternalPreviewVerifierCorrection ? firstAddCommit(s02ExternalPreviewVerifierCorrectionPath) : null;
const s02ExternalPreviewVerifierCorrectionChangedPaths = [
  '.github/workflows/verify-current-governance.yml',
  s02ExternalPreviewVerifierCorrectionPath,
  'tests/governance/verify-current-authority.mjs'
];
const s02ExternalPreviewRedirectCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-external-preview-redirect-correction-round-002.json';
const s02ExternalPreviewRedirectCorrection = exists(s02ExternalPreviewRedirectCorrectionPath) ? json(s02ExternalPreviewRedirectCorrectionPath) : null;
const s02ExternalPreviewRedirectCorrectionCommit = s02ExternalPreviewRedirectCorrection ? firstAddCommit(s02ExternalPreviewRedirectCorrectionPath) : null;
const s02ExternalPreviewRedirectCorrectionChangedPaths = [
  '.github/workflows/verify-current-governance.yml',
  s02ExternalPreviewRedirectCorrectionPath,
  'tests/governance/verify-current-authority.mjs'
];
const s02ExternalPreviewBrowserCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-external-preview-browser-correction-round-003.json';
const s02ExternalPreviewBrowserCorrection = exists(s02ExternalPreviewBrowserCorrectionPath) ? json(s02ExternalPreviewBrowserCorrectionPath) : null;
const s02ExternalPreviewBrowserCorrectionCommit = s02ExternalPreviewBrowserCorrection ? firstAddCommit(s02ExternalPreviewBrowserCorrectionPath) : null;
const s02ExternalPreviewBrowserCorrectionChangedPaths = [
  '.github/workflows/verify-current-governance.yml',
  s02ExternalPreviewBrowserCorrectionPath,
  'tests/governance/verify-current-authority.mjs'
];

// BEGIN_S02_TRUSTED_HARNESS_CORRECTION_ROUND_001
const s02HarnessCorrectionPath = 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-trusted-harness-correction-round-001.json';
const s02HarnessCorrection = exists(s02HarnessCorrectionPath) ? json(s02HarnessCorrectionPath) : null;
const s02HarnessCorrectionCommit = s02HarnessCorrection ? firstAddCommit(s02HarnessCorrectionPath) : null;
const s02HarnessCorrectionChangedPaths = [
  '.github/workflows/verify-step-4-s02-golden-master-p1.yml',
  s02HarnessCorrectionPath,
  'tests/governance/verify-current-authority.mjs'
];
if (s02HarnessCorrection) {
  assertExactKeySet(s02HarnessCorrection, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'changeControl', 'entry', 'authorityWorkflow', 'failedWorkflow', 'diagnosis', 'correction', 'boundaries', 'status'], 'S02 trusted-harness correction');
  assertExactKeySet(s02HarnessCorrection.entry, ['head', 'tree'], 'S02 trusted-harness correction entry');
  assertExactKeySet(s02HarnessCorrection.authorityWorkflow, ['commit', 'tree', 'runId', 'runAttempt', 'jobId', 'conclusion', 'artifactId', 'artifactName', 'artifactDigest'], 'S02 trusted-harness authority workflow');
  assertExactKeySet(s02HarnessCorrection.failedWorkflow, ['commit', 'tree', 'runId', 'runAttempt', 'jobId', 'conclusion', 'failedStep', 'artifactCount'], 'S02 failed trusted-harness workflow');
  assertExactKeySet(s02HarnessCorrection.diagnosis, ['type', 'oldPins', 'committedSha256'], 'S02 trusted-harness diagnosis');
  assertExactKeySet(s02HarnessCorrection.correction, ['rule', 'changedPaths', 'newPins', 'workflowBeforeSha256', 'workflowAfterSha256', 'verifierAfterSha256', 'verifierPatchSha256', 'assertionSetChanged'], 'S02 trusted-harness exact correction');
  assertExactKeySet(s02HarnessCorrection.boundaries, ['rootRuntimeChanged', 'gameCoreChanged', 'gameDataChanged', 'economyChanged', 'saveSchemaChanged', 'backendChanged', 'productionChanged', 'productionAliasChanged', 'physicalIPhoneVerified', 'step4Pass', 'step5Allowed'], 'S02 trusted-harness correction boundaries');
  assert(s02HarnessCorrection.schemaVersion === 1 && s02HarnessCorrection.artifactId === 'cats-tower-s02-golden-master-p1-trusted-harness-correction-round-001' && s02HarnessCorrection.createdAt === '2026-09-02', 'S02 trusted-harness correction identity/date mismatch');
  assert(s02HarnessCorrection.repository === '2hg7trp7rv-design/cats_tower' && s02HarnessCorrection.branch === 'kimi' && s02HarnessCorrection.changeControl === s02RepairControlPath, 'S02 trusted-harness correction authority mismatch');
  assert(JSON.stringify(s02HarnessCorrection.entry) === JSON.stringify({ head: '47d093d4d528f3e1cf19788166a94b4f087d8f59', tree: 'e3603698d83bcea07c85b8b10ebdc3ed74a79b5e' }), 'S02 trusted-harness correction entry is not the exact failed content commit/tree');
  assert(JSON.stringify(s02HarnessCorrection.authorityWorkflow) === JSON.stringify({
    commit: s02HarnessCorrection.entry.head,
    tree: s02HarnessCorrection.entry.tree,
    runId: 33589755556,
    runAttempt: 1,
    jobId: 100121309882,
    conclusion: 'SUCCESS',
    artifactId: 9831332548,
    artifactName: 'phase0-current-governance-47d093d4d528f3e1cf19788166a94b4f087d8f59-33589755556-1',
    artifactDigest: 'sha256:edda9794a5c4fbae4d74f2882fe198a18c6b52cacf1b1785166824d00667cee4'
  }), 'S02 trusted-harness correction does not bind the successful exact-entry authority workflow');
  assert(JSON.stringify(s02HarnessCorrection.failedWorkflow) === JSON.stringify({
    commit: s02HarnessCorrection.entry.head,
    tree: s02HarnessCorrection.entry.tree,
    runId: 33589755596,
    runAttempt: 1,
    jobId: 100121173797,
    conclusion: 'FAILURE',
    failedStep: 'Verify immutable trusted harness',
    artifactCount: 0
  }), 'S02 trusted-harness correction does not bind the exact failed workflow/job/step');
  const expectedOldPins = [
    { path: 'tests/step4/verify-s02-golden-master-p1.mjs', sha256: '20c97c0b687aff966374513910516a7c64b237e4f7f6c0240b1a55f5b407ef7d' },
    { path: 'tests/step4/s02-golden-master-p1-browser.mjs', sha256: 'be01517f51eedc3c65373d56410abbc359971d59934135bed0e919c674404a37' },
    { path: 'tests/step4/s02-golden-master-p1-browser-qa.mjs', sha256: '771c7f8a1a0140a456e6044a7dd46bb7f76d7f1cf44ce98c80734181e8e0c74d' }
  ];
  const expectedNewPins = [
    { path: 'tests/step4/verify-s02-golden-master-p1.mjs', sha256: 'b712ba261f1fc66db97e54c15e833729199e17785b149b7459d0e95ddb13d011' },
    { path: 'tests/step4/s02-golden-master-p1-browser.mjs', sha256: '2661c5a75ee756e0baf5a7d5b0470f97d3fc56e02f29bfa641c1e4510ff3fdd3' },
    { path: 'tests/step4/s02-golden-master-p1-browser-qa.mjs', sha256: 'f67bf7472b108d2e88ac24ac034a386e2c24896a18a95950e82ec5bbf9042d03' }
  ];
  assert(s02HarnessCorrection.diagnosis.type === 'WORKFLOW_PINNED_SHA256_VALUES_DO_NOT_MATCH_COMMITTED_HARNESS_BYTES' && JSON.stringify(s02HarnessCorrection.diagnosis.oldPins) === JSON.stringify(expectedOldPins) && JSON.stringify(s02HarnessCorrection.diagnosis.committedSha256) === JSON.stringify(expectedNewPins), 'S02 trusted-harness mismatch diagnosis differs from the failed exact commit');
  assert(s02HarnessCorrection.correction.rule === 'REBIND_WORKFLOW_TO_EXACT_EXISTING_COMMITTED_HARNESS_BYTES_WITHOUT_REMOVING_OR_WEAKENING_ASSERTIONS' && JSON.stringify(s02HarnessCorrection.correction.changedPaths) === JSON.stringify(s02HarnessCorrectionChangedPaths) && JSON.stringify(s02HarnessCorrection.correction.newPins) === JSON.stringify(expectedNewPins), 'S02 trusted-harness correction rule/path/pin set mismatch');
  assert(s02HarnessCorrection.correction.workflowBeforeSha256 === 'ae42536a3d30dff057afa189bf15a9ed7caa5fb90d3e375dc4671c8757fbe8dc' && s02HarnessCorrection.correction.workflowAfterSha256 === expectedS02WorkflowCorrectionRound001Sha256 && s02HarnessCorrection.correction.assertionSetChanged === false, 'S02 trusted-harness workflow correction overreaches the exact checksum rebinding');
  assert(JSON.stringify(s02HarnessCorrection.boundaries) === JSON.stringify({ rootRuntimeChanged: false, gameCoreChanged: false, gameDataChanged: false, economyChanged: false, saveSchemaChanged: false, backendChanged: false, productionChanged: false, productionAliasChanged: false, physicalIPhoneVerified: false, step4Pass: false, step5Allowed: false }), 'S02 trusted-harness correction crosses a protected product/release boundary');
  assert(s02HarnessCorrection.status === 'CORRECTED_TRUSTED_HARNESS_PINS_PENDING_RERUN', 'S02 trusted-harness correction status mismatch');
  assert(s02HarnessCorrectionCommit && git(['rev-parse', `${s02HarnessCorrectionCommit}^`]) === s02HarnessCorrection.entry.head, 'S02 trusted-harness correction is not the immediate child of the failed content commit');
  assert(git(['rev-parse', `${s02HarnessCorrection.entry.head}^{tree}`]) === s02HarnessCorrection.entry.tree, 'S02 trusted-harness correction entry tree mismatch');
  assertExactChangedPaths(s02HarnessCorrection.entry.head, s02HarnessCorrectionCommit, s02HarnessCorrectionChangedPaths, 'S02 trusted-harness correction commit');
  assertAddedOnceAndUnchanged(s02HarnessCorrectionPath, s02HarnessCorrectionCommit);
  const correctedWorkflowSource = textAt(s02HarnessCorrectionCommit, '.github/workflows/verify-step-4-s02-golden-master-p1.yml');
  const priorWorkflowSource = textAt(s02HarnessCorrection.entry.head, '.github/workflows/verify-step-4-s02-golden-master-p1.yml');
  let expectedCorrectedWorkflowSource = priorWorkflowSource;
  for (let index = 0; index < expectedOldPins.length; index += 1) {
    const oldLine = `${expectedOldPins[index].sha256}  ${expectedOldPins[index].path}`;
    const newLine = `${expectedNewPins[index].sha256}  ${expectedNewPins[index].path}`;
    assert(expectedCorrectedWorkflowSource.split(oldLine).length === 2, `S02 trusted-harness prior workflow old pin count mismatch: ${expectedOldPins[index].path}`);
    expectedCorrectedWorkflowSource = expectedCorrectedWorkflowSource.replace(oldLine, newLine);
  }
  assert(correctedWorkflowSource === expectedCorrectedWorkflowSource && sha256Text(correctedWorkflowSource) === s02HarnessCorrection.correction.workflowAfterSha256, 'S02 trusted-harness workflow changed beyond the three exact checksum lines');
  const correctedVerifierSource = textAt(s02HarnessCorrectionCommit, 'tests/governance/verify-current-authority.mjs');
  const verifierPatch = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', s02HarnessCorrection.entry.head, s02HarnessCorrectionCommit, '--', 'tests/governance/verify-current-authority.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert(sha256Text(correctedVerifierSource) === s02HarnessCorrection.correction.verifierAfterSha256 && `sha256:${sha256Text(verifierPatch)}` === s02HarnessCorrection.correction.verifierPatchSha256, 'S02 trusted-harness verifier bytes/patch differ from the immutable correction record');
  assert(correctedVerifierSource.includes('// BEGIN_S02_TRUSTED_HARNESS_CORRECTION_ROUND_001') && correctedVerifierSource.includes('// END_S02_TRUSTED_HARNESS_CORRECTION_ROUND_001') && correctedVerifierSource.includes("assertBoundary(paths, control, `${label} commit ${commit}`);"), 'S02 trusted-harness verifier correction removed its self-check or original fail-closed boundary assertion');
  const firstCorrectionFreezeEnd = s02QaCorrectionCommit ? git(['rev-parse', `${s02QaCorrectionCommit}^`]) : git(['rev-parse', 'HEAD']);
  assertNoPathChangesSince(s02HarnessCorrectionCommit, firstCorrectionFreezeEnd, s02HarnessCorrectionChangedPaths, 'S02 trusted-harness correction freeze before QA-initialization correction');
  if (s02QaCorrectionCommit) assertNoPathChangesSince(s02HarnessCorrectionCommit, 'HEAD', [s02HarnessCorrectionPath], 'S02 trusted-harness round 001 record freeze');
  if (requireLiveActions) {
    const authorityRun = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/runs/${s02HarnessCorrection.authorityWorkflow.runId}`);
    const authorityJob = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/jobs/${s02HarnessCorrection.authorityWorkflow.jobId}`);
    const authorityArtifact = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/artifacts/${s02HarnessCorrection.authorityWorkflow.artifactId}`);
    assert(authorityRun.head_sha === s02HarnessCorrection.entry.head && authorityRun.head_branch === 'kimi' && authorityRun.status === 'completed' && authorityRun.conclusion === 'success' && authorityRun.run_attempt === 1, 'S02 trusted-harness correction live authority run mismatch');
    assert(authorityJob.run_id === authorityRun.id && authorityJob.head_sha === s02HarnessCorrection.entry.head && authorityJob.name === 'current-authority' && authorityJob.conclusion === 'success', 'S02 trusted-harness correction live authority job mismatch');
    assert(authorityArtifact.name === s02HarnessCorrection.authorityWorkflow.artifactName && authorityArtifact.digest === s02HarnessCorrection.authorityWorkflow.artifactDigest && authorityArtifact.expired === false && authorityArtifact.workflow_run?.head_sha === s02HarnessCorrection.entry.head, 'S02 trusted-harness correction live authority artifact mismatch');
    const failedRun = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/runs/${s02HarnessCorrection.failedWorkflow.runId}`);
    const failedJob = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/jobs/${s02HarnessCorrection.failedWorkflow.jobId}`);
    assert(failedRun.head_sha === s02HarnessCorrection.entry.head && failedRun.head_branch === 'kimi' && failedRun.status === 'completed' && failedRun.conclusion === 'failure' && failedRun.run_attempt === 1, 'S02 trusted-harness correction live failed run mismatch');
    assert(failedJob.run_id === failedRun.id && failedJob.head_sha === s02HarnessCorrection.entry.head && failedJob.name === 'Static, eight-master responsive and accessibility verification' && failedJob.conclusion === 'failure', 'S02 trusted-harness correction live failed job mismatch');
    const failedSteps = (failedJob.steps ?? []).filter(step => step.name === s02HarnessCorrection.failedWorkflow.failedStep);
    assert(failedSteps.length === 1 && failedSteps[0].conclusion === 'failure', 'S02 trusted-harness correction live failed step mismatch');
  }
}
// END_S02_TRUSTED_HARNESS_CORRECTION_ROUND_001

// BEGIN_S02_TRUSTED_HARNESS_CORRECTION_ROUND_002
if (s02QaCorrection) {
  assertExactKeySet(s02QaCorrection, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'changeControl', 'entry', 'authorityWorkflow', 'failedWorkflow', 'diagnosis', 'correction', 'boundaries', 'status'], 'S02 QA-initialization correction');
  assertExactKeySet(s02QaCorrection.entry, ['head', 'tree'], 'S02 QA-initialization correction entry');
  assertExactKeySet(s02QaCorrection.authorityWorkflow, ['commit', 'tree', 'runId', 'runAttempt', 'jobId', 'conclusion', 'artifactId', 'artifactName', 'artifactDigest'], 'S02 QA-initialization authority workflow');
  assertExactKeySet(s02QaCorrection.failedWorkflow, ['commit', 'tree', 'runId', 'runAttempt', 'jobId', 'conclusion', 'failedStep', 'error', 'artifactCount'], 'S02 QA-initialization failed workflow');
  assertExactKeySet(s02QaCorrection.diagnosis, ['type', 'symbol', 'firstUseLine', 'declarationLine', 'browserCaptureCompleted'], 'S02 QA-initialization diagnosis');
  assertExactKeySet(s02QaCorrection.correction, ['rule', 'changedPaths', 'qaBeforeSha256', 'qaAfterSha256', 'qaPatchSha256', 'workflowBeforeSha256', 'workflowAfterSha256', 'workflowPatchSha256', 'verifierAfterSha256', 'verifierPatchSha256', 'assertionSetChanged', 'acceptanceThresholdsChanged'], 'S02 QA-initialization exact correction');
  assertExactKeySet(s02QaCorrection.boundaries, ['rootRuntimeChanged', 'gameCoreChanged', 'gameDataChanged', 'economyChanged', 'saveSchemaChanged', 'backendChanged', 'productionChanged', 'productionAliasChanged', 'physicalIPhoneVerified', 'step4Pass', 'step5Allowed'], 'S02 QA-initialization correction boundaries');
  assert(s02QaCorrection.schemaVersion === 1 && s02QaCorrection.artifactId === 'cats-tower-s02-golden-master-p1-trusted-harness-correction-round-002' && s02QaCorrection.createdAt === '2026-09-02', 'S02 QA-initialization correction identity/date mismatch');
  assert(s02QaCorrection.repository === '2hg7trp7rv-design/cats_tower' && s02QaCorrection.branch === 'kimi' && s02QaCorrection.changeControl === s02RepairControlPath, 'S02 QA-initialization correction authority mismatch');
  assert(JSON.stringify(s02QaCorrection.entry) === JSON.stringify({ head: 'c85c1b7244026c2e4cf3ce9e170c5b17acaad5c5', tree: 'f8bfa03017603414e25738f2b00bfe5064490d60' }), 'S02 QA-initialization correction entry is not the exact failed compact-reference commit/tree');
  assert(JSON.stringify(s02QaCorrection.authorityWorkflow) === JSON.stringify({
    commit: s02QaCorrection.entry.head,
    tree: s02QaCorrection.entry.tree,
    runId: 33591146325,
    runAttempt: 1,
    jobId: 100125344631,
    conclusion: 'SUCCESS',
    artifactId: 9831795065,
    artifactName: 'phase0-current-governance-c85c1b7244026c2e4cf3ce9e170c5b17acaad5c5-33591146325-1',
    artifactDigest: 'sha256:bbe261b7349380b2162d095685972d653701a3c7faee6776c7459eb173a65bec'
  }), 'S02 QA-initialization correction does not bind the successful exact-entry authority workflow');
  assert(JSON.stringify(s02QaCorrection.failedWorkflow) === JSON.stringify({
    commit: s02QaCorrection.entry.head,
    tree: s02QaCorrection.entry.tree,
    runId: 33591146303,
    runAttempt: 1,
    jobId: 100125228390,
    conclusion: 'FAILURE',
    failedStep: 'Capture and verify eight masters plus required responsive variants',
    error: "ReferenceError: Cannot access 'responsiveByViewport' before initialization",
    artifactCount: 0
  }), 'S02 QA-initialization correction does not bind the exact failed workflow/job/step/error');
  assert(JSON.stringify(s02QaCorrection.diagnosis) === JSON.stringify({ type: 'QA_TEMPORAL_DEAD_ZONE_AFTER_SUCCESSFUL_BROWSER_CAPTURE', symbol: 'responsiveByViewport', firstUseLine: 478, declarationLine: 743, browserCaptureCompleted: true }), 'S02 QA-initialization diagnosis differs from the exact failed job');
  assert(s02QaCorrection.correction.rule === 'MOVE_EXISTING_RESPONSIVE_CONTRACT_INITIALIZATION_BEFORE_VALIDATE_RAW_WITHOUT_CHANGING_ASSERTIONS_OR_THRESHOLDS' && JSON.stringify(s02QaCorrection.correction.changedPaths) === JSON.stringify(s02QaCorrectionChangedPaths), 'S02 QA-initialization correction rule/path set mismatch');
  assert(s02QaCorrection.correction.qaBeforeSha256 === 'f67bf7472b108d2e88ac24ac034a386e2c24896a18a95950e82ec5bbf9042d03' && s02QaCorrection.correction.qaAfterSha256 === '5190fe2fca12b75356518a02c95dae6947ac2f6e68690c43ac30d7ee82bf293a' && s02QaCorrection.correction.qaPatchSha256 === 'sha256:c4a323a1cb4142c83dace4ae0284063a1e6c5aa801be12726d30073e03b18ab5', 'S02 QA-initialization source digest/patch mismatch');
  assert(s02QaCorrection.correction.workflowBeforeSha256 === expectedS02WorkflowCorrectionRound001Sha256 && s02QaCorrection.correction.workflowAfterSha256 === expectedS02WorkflowCorrectionRound002Sha256 && s02QaCorrection.correction.workflowPatchSha256 === 'sha256:459bdb2f6bbd1cfd0038aae250e36b0105c21cda3716c2b657a35bd27ccdf6c6', 'S02 QA-initialization workflow digest/patch mismatch');
  assert(s02QaCorrection.correction.assertionSetChanged === false && s02QaCorrection.correction.acceptanceThresholdsChanged === false, 'S02 QA-initialization correction changed assertions or acceptance thresholds');
  assert(JSON.stringify(s02QaCorrection.boundaries) === JSON.stringify({ rootRuntimeChanged: false, gameCoreChanged: false, gameDataChanged: false, economyChanged: false, saveSchemaChanged: false, backendChanged: false, productionChanged: false, productionAliasChanged: false, physicalIPhoneVerified: false, step4Pass: false, step5Allowed: false }), 'S02 QA-initialization correction crosses a protected product/release boundary');
  assert(s02QaCorrection.status === 'CORRECTED_QA_INITIALIZATION_ORDER_PENDING_RERUN', 'S02 QA-initialization correction status mismatch');
  assert(s02QaCorrectionCommit && git(['rev-parse', `${s02QaCorrectionCommit}^`]) === s02QaCorrection.entry.head, 'S02 QA-initialization correction is not the immediate child of the failed commit');
  assert(git(['rev-parse', `${s02QaCorrection.entry.head}^{tree}`]) === s02QaCorrection.entry.tree, 'S02 QA-initialization correction entry tree mismatch');
  assertExactChangedPaths(s02QaCorrection.entry.head, s02QaCorrectionCommit, s02QaCorrectionChangedPaths, 'S02 QA-initialization correction commit');
  assertAddedOnceAndUnchanged(s02QaCorrectionPath, s02QaCorrectionCommit);

  const priorQaSource = textAt(s02QaCorrection.entry.head, 'tests/step4/s02-golden-master-p1-browser-qa.mjs');
  const correctedQaSource = textAt(s02QaCorrectionCommit, 'tests/step4/s02-golden-master-p1-browser-qa.mjs');
  const responsiveContractLine = "const responsiveContract = parseJson(path.join(root, 'quality-reviews/step-4-twelve-screen-final-mockups/s02-golden-master-p1-responsive-contract.json'), 2 * 1024 * 1024);\n";
  const responsiveMapBlock = "const responsiveByViewport = new Map((responsiveContract.viewportContracts ?? []).map((contract) => [contract.viewport, contract]));\ninvariant(responsiveByViewport.size === 7 && ['320x568', '320x667', '375x667', '360x800', '390x844', '412x915', '430x932'].every((viewport) => responsiveByViewport.has(viewport)), 'responsive contract does not bind all seven required viewport sizes');\n";
  const validateRawMarker = "validateRaw(raw, revisionMode ? { requestDefinitions: revisionContract.definitions, assetParticipation: true, offlineVariants: true, browserModes: true } : { offlineVariants: true, browserModes: true });\n";
  let expectedQaSource = priorQaSource;
  for (const exactBlock of [responsiveContractLine, responsiveMapBlock, validateRawMarker]) assert(expectedQaSource.split(exactBlock).length === 2, 'S02 QA-initialization prior source does not contain one exact movable block/marker');
  expectedQaSource = expectedQaSource.replace(responsiveContractLine, '').replace(responsiveMapBlock, '').replace(validateRawMarker, responsiveContractLine + responsiveMapBlock + validateRawMarker);
  assert(correctedQaSource === expectedQaSource && sha256Text(correctedQaSource) === s02QaCorrection.correction.qaAfterSha256, 'S02 QA-initialization correction changed more than declaration order');
  const qaPatch = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', s02QaCorrection.entry.head, s02QaCorrectionCommit, '--', 'tests/step4/s02-golden-master-p1-browser-qa.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert(`sha256:${sha256Text(qaPatch)}` === s02QaCorrection.correction.qaPatchSha256, 'S02 QA-initialization patch digest differs from the immutable correction record');

  const priorQaPin = 'f67bf7472b108d2e88ac24ac034a386e2c24896a18a95950e82ec5bbf9042d03  tests/step4/s02-golden-master-p1-browser-qa.mjs';
  const correctedQaPin = '5190fe2fca12b75356518a02c95dae6947ac2f6e68690c43ac30d7ee82bf293a  tests/step4/s02-golden-master-p1-browser-qa.mjs';
  const priorQaWorkflowSource = textAt(s02QaCorrection.entry.head, '.github/workflows/verify-step-4-s02-golden-master-p1.yml');
  const correctedQaWorkflowSource = textAt(s02QaCorrectionCommit, '.github/workflows/verify-step-4-s02-golden-master-p1.yml');
  assert(priorQaWorkflowSource.split(priorQaPin).length === 2 && correctedQaWorkflowSource === priorQaWorkflowSource.replace(priorQaPin, correctedQaPin) && sha256Text(correctedQaWorkflowSource) === s02QaCorrection.correction.workflowAfterSha256, 'S02 QA-initialization workflow changed beyond the exact QA pin');
  const workflowPatch = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', s02QaCorrection.entry.head, s02QaCorrectionCommit, '--', '.github/workflows/verify-step-4-s02-golden-master-p1.yml'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert(`sha256:${sha256Text(workflowPatch)}` === s02QaCorrection.correction.workflowPatchSha256, 'S02 QA-initialization workflow patch differs from the immutable correction record');

  const correctedQaVerifierSource = textAt(s02QaCorrectionCommit, 'tests/governance/verify-current-authority.mjs');
  const qaVerifierPatch = execFileSync('git', ['diff', '--no-ext-diff', '--no-color', s02QaCorrection.entry.head, s02QaCorrectionCommit, '--', 'tests/governance/verify-current-authority.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert(sha256Text(correctedQaVerifierSource) === s02QaCorrection.correction.verifierAfterSha256 && `sha256:${sha256Text(qaVerifierPatch)}` === s02QaCorrection.correction.verifierPatchSha256, 'S02 QA-initialization verifier bytes/patch differ from the immutable correction record');
  assert(correctedQaVerifierSource.includes('// BEGIN_S02_TRUSTED_HARNESS_CORRECTION_ROUND_001') && correctedQaVerifierSource.includes('// BEGIN_S02_TRUSTED_HARNESS_CORRECTION_ROUND_002') && correctedQaVerifierSource.includes("assertBoundary(paths, control, `${label} commit ${commit}`);"), 'S02 QA-initialization verifier removed a prior correction guard or original fail-closed boundary assertion');
  const secondCorrectionFreezeEnd = s02ReferenceQaCorrectionCommit ? git(['rev-parse', `${s02ReferenceQaCorrectionCommit}^`]) : git(['rev-parse', 'HEAD']);
  assertNoPathChangesSince(s02QaCorrectionCommit, secondCorrectionFreezeEnd, s02QaCorrectionChangedPaths, 'S02 QA-initialization correction freeze before review-reference correction');
  if (s02ReferenceQaCorrectionCommit) assertNoPathChangesSince(s02QaCorrectionCommit, 'HEAD', [s02QaCorrectionPath], 'S02 QA-initialization round 002 record freeze');
  if (requireLiveActions) {
    const authorityRun = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/runs/${s02QaCorrection.authorityWorkflow.runId}`);
    const authorityJob = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/jobs/${s02QaCorrection.authorityWorkflow.jobId}`);
    const authorityArtifact = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/artifacts/${s02QaCorrection.authorityWorkflow.artifactId}`);
    assert(authorityRun.head_sha === s02QaCorrection.entry.head && authorityRun.head_branch === 'kimi' && authorityRun.status === 'completed' && authorityRun.conclusion === 'success' && authorityRun.run_attempt === 1, 'S02 QA-initialization correction live authority run mismatch');
    assert(authorityJob.run_id === authorityRun.id && authorityJob.head_sha === s02QaCorrection.entry.head && authorityJob.name === 'current-authority' && authorityJob.conclusion === 'success', 'S02 QA-initialization correction live authority job mismatch');
    assert(authorityArtifact.name === s02QaCorrection.authorityWorkflow.artifactName && authorityArtifact.digest === s02QaCorrection.authorityWorkflow.artifactDigest && authorityArtifact.expired === false && authorityArtifact.workflow_run?.head_sha === s02QaCorrection.entry.head, 'S02 QA-initialization correction live authority artifact mismatch');
    const failedRun = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/runs/${s02QaCorrection.failedWorkflow.runId}`);
    const failedJob = ghJson(`/repos/2hg7trp7rv-design/cats_tower/actions/jobs/${s02QaCorrection.failedWorkflow.jobId}`);
    assert(failedRun.head_sha === s02QaCorrection.entry.head && failedRun.head_branch === 'kimi' && failedRun.status === 'completed' && failedRun.conclusion === 'failure' && failedRun.run_attempt === 1, 'S02 QA-initialization correction live failed run mismatch');
    assert(failedJob.run_id === failedRun.id && failedJob.head_sha === s02QaCorrection.entry.head && failedJob.name === 'Static, eight-master responsive and accessibility verification' && failedJob.conclusion === 'failure', 'S02 QA-initialization correction live failed job mismatch');
    const failedSteps = (failedJob.steps ?? []).filter(step => step.name === s02QaCorrection.failedWorkflow.failedStep);
    assert(failedSteps.length === 1 && failedSteps[0].conclusion === 'failure', 'S02 QA-initialization correction live failed step mismatch');
  }
}
// END_S02_TRUSTED_HARNESS_CORRECTION_ROUND_002

// BEGIN_S02_TRUSTED_HARNESS_CORRECTION_ROUND_003
if (s02ReferenceQaCorrection) {
  assertExactKeySet(s02ReferenceQaCorrection, ['schemaVersion', 'artifactId', 'createdAt', 'repository', 'branch', 'changeControl', 'entry', 'authorityWorkflow', 'failedWorkflow', 'diagnosis', 'correction', 'boundaries', 'status'], 'S02 review-reference QA correction');
  assertExactKeySet(s02ReferenceQaCorrection.entry, ['head', 'tree'], 'S02 review-reference QA correction entry');
  assertExactKeySet(s02ReferenceQaCorrection.authorityWorkflow, ['commit', 'tree', 'runId', 'runAttempt', 'jobId', 'conclusion', 'artifactId', 'artifactName', 'artifactDigest'], 'S02 review-reference authority workflow');
  assertExactKeySet(s02ReferenceQaCorrection.failedWorkflow, ['commit', 'tree', 'runId', 'runAttempt', 'jobId', 'conclusion', 'failedStep', 'error', 'artifactCount'], 'S02 review-reference failed workflow');
  assertExactKeySet(s02ReferenceQaCorrection.diagnosis, ['type', 'collectorContract', 'validatorContract', 'browserCaptureCompleted'], 'S02 review-reference diagnosis');
  assertExactKeySet(s02ReferenceQaCorrection.correction, ['rule', 'changedPaths', 'qaBeforeSha256', 'qaAfterSha256', 'qaPatchSha256', 'workflowBeforeSha256', 'workflowAfterSha256', 'workflowPatchSha256', 'verifierAfterSha256', 'verifierPatchSha256', 'assertionChangeKind', 'acceptanceThresholdsChanged', 'qualityCoverageWeakened', 'failureEvidenceUploadEnabled'], 'S02 review-reference exact correction');
  assertExactKeySet(s02ReferenceQaCorrection.boundaries, ['rootRuntimeChanged', 'gameCoreChanged', 'gameDataChanged', 'economyChanged', 'saveSchemaChanged', 'backendChanged', 'productionChanged', 'productionAliasChanged', 'physicalIPhoneVerified', 'step4Pass', 'step5Allowed'], 'S02 review-reference correction boundaries');
  assert(s02ReferenceQaCorrection.schemaVersion === 1 && s02ReferenceQaCorrection.artifactId === 'cats-tower-s02-golden-master-p1-trusted-harness-correction-round-003' && s02ReferenceQaCorrection.createdAt === '2026-09-02', 'S02 review-reference correction identity/date mismatch');
  assert(s02ReferenceQaCorrection.repository === '2hg7trp7rv-design/cats_tower' && s02ReferenceQaCorrection.branch === 'kimi' && s02ReferenceQaCorrection.changeControl === s02RepairControlPath, 'S02 review-reference correction authority mismatch');
  assert(JSON.stringify(s02ReferenceQaCorrection.entry) === JSON.stringify({ head: '0d75cd6496c538ee6730f02aaeebd9c4063c6cee', tree: '7cc4fcedb181fe127dae020159a7a0f91a1db807' }), 'S02 review-reference correction entry is not the exact failed QA-initialization correction commit/tree');
  assert(JSON.stringify(s02ReferenceQaCorrection.authorityWorkflow) === JSON.stringify({
    commit: s02ReferenceQaCorrection.entry.head,
    tree: s02ReferenceQaCorrection.entry.tree,
    runId: 33591754174,
    runAttempt: 1,
    jobId: 100127121721,
    conclusion: 'SUCCESS',
    artifactId: 9831995434,
    artifactName: 'phase0-current-governance-0d75cd6496c538ee6730f02aaeebd9c4063c6cee-33591754174-1',
    artifactDigest: 'sha256:cfb43b6677c725d9815da2ab9ad0d5fa6f9a967b34736d2bbfe2677c75c1ff3f'
  }), 'S02 review-reference correction does ßÎxë†òµë(š+myÖWtWf–FVæ6R‡&VF&6²æW‡FW&æÅ&ööbÂFWÆ÷–ÖVçE&WVW7BÂG¶Æ&VÅ&Vf—‡ÒW‡FW&æÂ&Wf–Wr&VF&6¶ÂF‡2æFWÆ÷–ÖVçE&WVW7BÂ&WV—&TÆ—fTW‡FW&æÂ“°¢76W'B‚õæGÅõ´Õ¦×£Ó•Ò²BòçFW7B‡&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–Bóòrr’bbõæ‡GG3¥ÂõÂõ¶×£Ó’ÕÒµÂçfW&6VÅÂæBòçFW7B‡&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–Ö×WF&ÆUW&Âóòrr’bb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæVçf—&öæÖVçBÓÓÒu&Wf–Wrrbb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæv—F‡V$6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæv—F‡V%&VbÓÓÒv¶–Ö’rbb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBç&öGV7F–öåF&vWFVBÓÓÒfÇ6RÂu3"fW&–f–VBFWÆ÷–ÖVçB7VÖÖ'’—2–çfÆ–Br“°¢76W'B‡&VF&6²çfW&–f–VD‡GGæ'&æ6„Æ–2ÓÓÒFWÆ÷–ÖVçE&WVW7Bç&Wf–Wræ'&æ6„Æ–2bb&VF&6²çfW&–f–VD‡GGç&Wf–Wu&÷WFRÓÓÒFWÆ÷–ÖVçE&WVW7Bç&Wf–Wrç&÷WFRbb—46æöæ–6Ä—6ô–ç7FçB‡&VF&6²çfW&–f–VD‡GGçfW&–f–VDB’bb&VF&6²çfW&–f–VD‡GGæÆ–56W'fW5&Wf–WvVD6öçFVçBÓÓÒG'VRÂu3"fW&–f–VB…EE7VÖÖ'’—2–çfÆ–Br“°¢–b†Æ—fU&Wf–WtWf–FVæ6R’°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²çfW&–f–VDFWÆ÷–ÖVçB’ÓÓÒ¥4ôâç7G&–æv–g’‡²–C¢Æ—fU&Wf–WtWf–FVæ6Rç&W7VÇBæ6öçFVçDFWÆ÷–ÖVçBçfW&6VÄFWÆ÷–ÖVçD–BÂ–Ö×WF&ÆUW&Ã¢Æ—fU&Wf–WtWf–FVæ6Rç&W7VÇBæ6öçFVçDFWÆ÷–ÖVçBæ–Ö×WF&ÆUW&ÂÂVçf—&öæÖVçC¢u&Wf–WrrÂv—F‡V$6öÖÖ—C¢F&vWD6öÖÖ—BÂv—F‡V%&Vc¢v¶–Ö’rÂ&öGV7F–öåF&vWFVC¢fÇ6RÒ’Âu3"FWÆ÷–ÖVçB7VÖÖ'’F–ffW'2g&öÒÆ—fRW‡FW&æÂ&ööbr“°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²çfW&–f–VD‡GG’ÓÓÒ¥4ôâç7G&–æv–g’‡²'&æ6„Æ–3¢FWÆ÷–ÖVçE&WVW7Bç&Wf–Wræ'&æ6„Æ–2Â&Wf–Wu&÷WFS¢FWÆ÷–ÖVçE&WVW7Bç&Wf–Wrç&÷WFRÂfW&–f–VDC¢Æ—fU&Wf–WtWf–FVæ6Ræ‡GG&W÷'BçfW&–f–VDBÂÆ–56W'fW5&Wf–WvVD6öçFVçC¢G'VRÒ’Âu3"…EE7VÖÖ'’F–ffW'2g&öÒÆ—fRW‡FW&æÂ&ööbr“°¢Ð¢76W'B‡&VF&6²çfW&F–7BÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urrbb&VF&6²æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urrbb&VF&6²çVç&W6öÇfVBåÓÓÒbb&VF&6²çVç&W6öÇfVBåÓÓÒÂu3"FWÆ÷–ÖVçB&VF&6²fW&F–7B&÷VæF'’Ö—6ÖF6‚r“°¢76W'B‡&VF&6´6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG·&VF&6´6öÖÖ—GÕæÒ’ÓÓÒW‡FW&æÅ&ööd6öÖÖ—BÂu3"FWÆ÷–ÖVçB&VF&6²×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†RW‡FW&æÂ×&ööb&WVW7B÷"—G2f–ÂÖ6Æ÷6VB6÷'&V7F–öâr“°¢76W'DW†7D6†ævVEF‡2†W‡FW&æÅ&ööd6öÖÖ—BÂ&VF&6´6öÖÖ—BÂ·F‡2æFWÆ÷–ÖVçE&VF&6µÒÂG¶Æ&VÅ&Vf—‡ÒFWÆ÷–ÖVçB×&VF&6²6öÖÖ—F“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡F‡2æFWÆ÷–ÖVçE&VF&6²Â&VF&6´6öÖÖ—B“°¢&WGW&â²F&vWD6öÖÖ—BÂF&vWEG&VRÂ6öçFVçDÖæ–fW7C¢W‡V7FVD6öçFVçDÖæ–fW7BÂâââ‡&Wf—6–öä6†ævW2ò²66WFæ6T6öÖÖ—BÂfV6–&–Æ—G”VF—D6öÖÖ—BÒ¢·Ò’Â7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ&WVW7D6öÖÖ—BÂW‡FW&æÅ&ööd6öÖÖ—BÂ&VF&6´6öÖÖ—BÂÆ—fU&Wf–WtWf–FVæ6RÓ°§Ð ¦6öç7B3%&Wf–Wu&Vf—‚Ò3%&W—$6öçG&öÂòfW&–g•3%&Wf–WtWf–FVæ6U&Vf—‚‚’¢çVÆÃ°¦gVæ7F–öâf—'7D6öÖÖ—DgFW$öå6–ævÆU&VçDÆ–æVvR†æ6W7F÷"ÂFW66VæFçBÂÆ&VÂ’°¢76W'B†æ6W7F÷"ÓÓÒFW66VæFçBÇÂ—4æ6W7F÷"†æ6W7F÷"ÂFW66VæFçB’ÂG¶Æ&VÇÓ¢VæGö–çB—2æ÷BFW66VæFVBg&öÒ&6V“°¢–b†æ6W7F÷"ÓÓÒFW66VæFçB’&WGW&âçVÆÃ°¢6öç7B6öÖÖ—G2Òv—B…²w&WbÖÆ—7BrÂrÒ×&WfW'6RrÂrÒÖæ6W7G'’×F‚rÂG¶æ6W7F÷'ÒââG¶FW66VæFçGÖÒ’ç7Æ—B‚uÆâr’æf–ÇFW"„&ööÆVâ“°¢76W'B†6öÖÖ—G2æÆVæwF‚âÂG¶Æ&VÇÓ¢6ææ÷B&W6öÇfRf—'7BFW66VæFçF“°¢ÆWB&VçBÒæ6W7F÷#°¢f÷"†6öç7B6öÖÖ—Böb6öÖÖ—G2’°¢6öç7BÆ–æVvRÒv—B…²w&WbÖÆ—7BrÂrÒ×&VçG2rÂrÖârÂsrÂ6öÖÖ—EÒ’ç7Æ—B‚rr“°¢76W'B†Æ–æVvRæÆVæwF‚ÓÓÒ"bbÆ–æVvU³ÒÓÓÒ&VçBÂG¶Æ&VÇÓ¢&VæWvÂöFV6—6–öâÆ–æVvR6öçF–ç2ÖW&vR÷"F—66öçF–çV—G–“°¢&VçBÒ6öÖÖ—C°¢Ð¢&WGW&â6öÖÖ—G5³Ó°§Ð¦gVæ7F–öâfW&–g•3%&VG”66W75&VæWvÇ2‡²&Wf–Wu&Vf—‚ÂWf–FVæ6UF‡2ÂWf–FVæ6U&÷VæBÂ7V66W76÷$÷Væ–æt6öÖÖ—BÒçVÆÂÂÆ&VÂÒ’°¢–b‚&Wf–Wu&Vf—ƒòç&VF&6´6öÖÖ—B’&WGW&âçVÆÃ°¢6öç7BVæGö–çBÒ7V66W76÷$÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·7V66W76÷$÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢6öç7B&6U&VG”6öÖÖ—BÒf—'7D6öÖÖ—DgFW$öå6–ævÆU&VçDÆ–æVvR‡&Wf–Wu&Vf—‚ç&VF&6´6öÖÖ—BÂVæGö–çBÂG¶Æ&VÇÒ$TE’Æ–æVvV“°¢76W'B†&6U&VG”6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶&6U&VG”6öÖÖ—GÕæÒ’ÓÓÒ&Wf–Wu&Vf—‚ç&VF&6´6öÖÖ—BÂG¶Æ&VÇÓ¢FVF–6FVB$TE’7F—fF–öâ—2'6VçF“°¢76W'DW†7D6†ævVEF‡2‡&Wf–Wu&Vf—‚ç&VF&6´6öÖÖ—BÂ&6U&VG”6öÖÖ—BÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2ÂG¶Æ&VÇÒ&6R$TE’7F—fF–öæ“°¢6öç7B&6U&VG”WF†÷&—G’Ò§6öäB†&6U&VG”6öÖÖ—BÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr“°¢76W'B†&6U&VG”WF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UrrÂG¶Æ&VÇÓ¢&6R7F—fF–öâ—2æ÷B$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Uv“°¢6öç7BgFW%&VG’ÒVæGö–çBÓÓÒ&6U&VG”6öÖÖ—BòµÒ¢v—B…²w&WbÖÆ—7BrÂrÒ×&WfW'6RrÂrÒÖæ6W7G'’×F‚rÂG¶&6U&VG”6öÖÖ—GÒââG¶VæGö–çGÖÒ’ç7Æ—B‚uÆâr’æf–ÇFW"„&ööÆVâ“°¢6öç7B6æöæ–6Å&WVW7BÒ§6öâ†Wf–FVæ6UF‡2æFWÆ÷–ÖVçE&WVW7B“°¢6öç7B6æöæ–6Å&VF&6²Ò§6öâ†Wf–FVæ6UF‡2æFWÆ÷–ÖVçE&VF&6²“°¢ÆWB&Wf–÷W5&WVW7EF‚ÒWf–FVæ6UF‡2æFWÆ÷–ÖVçE&WVW7C°¢ÆWB&Wf–÷W5&VF&6µF‚ÒWf–FVæ6UF‡2æFWÆ÷–ÖVçE&VF&6³°¢ÆWB&Wf–÷W5&WVW7D&Æö"Òv—B…²w&Wb×'6RrÂ„TC¢G·&Wf–÷W5&WVW7EF‡ÖÒ“°¢ÆWB&Wf–÷W5&VF&6´&Æö"Òv—B…²w&Wb×'6RrÂ„TC¢G·&Wf–÷W5&VF&6µF‡ÖÒ“°¢ÆWB&Wf–÷W466W75W&ÂÒ6æöæ–6Å&WVW7Bç&Wf–WrçFV×÷&'”66W72çW&Ã°¢ÆWB7W'&VçE&WVW7BÒ6æöæ–6Å&WVW7C°¢ÆWB7W'&VçE&VF&6²Ò6æöæ–6Å&VF&6³°¢ÆWB7W'&VçE&WVW7EF‚ÒWf–FVæ6UF‡2æFWÆ÷–ÖVçE&WVW7C°¢ÆWB7W'&VçE&VF&6µF‚ÒWf–FVæ6UF‡2æFWÆ÷–ÖVçE&VF&6³°¢ÆWBFV6—6–öå&VG”6öÖÖ—BÒ&6U&VG”6öÖÖ—C°¢ÆWBVæF–æu&WVW7BÒçVÆÃ°¢ÆWB7W'6÷"Ò°¢76W'B…7G&–ærƒ3"’çE7F'Bƒ2Âsr’ÓÓÒs3"rbb7G&–ærƒ32’çE7F'Bƒ2Âsr’ÓÓÒs32rbbõåÆG³2ÇÒBòçFW7B…7G&–ærƒ’çE7F'Bƒ2Âsr’’ÂG¶Æ&VÇÓ¢&VæWvÂçVÖ&W&–ærFöW2æ÷B&VÖ–âÆ—fR&W–öæB3"ó““–“°¢f÷"†ÆWB&VæWvÄ–æFW‚Ò²7W'6÷"ÂgFW%&VG’æÆVæwFƒ²&VæWvÄ–æFW‚³Ò’°¢6öç7B7Vff—‚Ò7G&–ær‡&VæWvÄ–æFW‚’çE7F'Bƒ2Âsr“°¢6öç7B&Vf—‚ÒVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö66W72×&VæWvÂ×&÷VæBÒG¶Wf–FVæ6U&÷VæGÒÒG·7Vff—‡Ö°¢6öç7B&WVW7EF‚ÒG·&Vf—‡Ò×&WVW7Bæ§6öæ°¢6öç7B&VF&6µF‚ÒG·&Vf—‡Ò×&VF&6²æ§6öæ°¢6öç7B&WVW7D6öÖÖ—BÒgFW%&VG•¶7W'6÷%Ó°¢76W'DW†7D6†ævVEF‡2†7W'6÷"ÓÓÒò&6U&VG”6öÖÖ—B¢gFW%&VG•¶7W'6÷"ÒÒÂ&WVW7D6öÖÖ—BÂ·&WVW7EF…ÒÂG¶Æ&VÇÒ66W72&VæWvÂG·7Vff—‡Ò&WVW7F“°¢76W'B†f—'7DFD6öÖÖ—B‡&WVW7EF‚’ÓÓÒ&WVW7D6öÖÖ—BÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò&WVW7Bv2æ÷Bf—'7BFFVBB—G2W†7B6öÖÖ—F“°¢6öç7B&WVW7BÒ§6öâ‡&WVW7EF‚“°¢76W'DW†7D¶W•6WB‡&WVW7BÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&–f–VD6öçFVçBrÂv6ö×ÆWF–öârÂw&Wf–÷W466W72rÂw&Wf–WrrÂvÖ†–×VÕfW&F–7BuÒÂG¶Æ&VÇÒ&VæWvÂG·7Vff—‡Ò&WVW7F“°¢76W'DW†7D¶W•6WB‡&WVW7Bç&Wf–÷W466W72Â²w&WVW7BrÂw&VF&6²uÒÂG¶Æ&VÇÒ&VæWvÂG·7Vff—‡Ò&Wf–÷W266W76“°¢76W'DW†7D¶W•6WB‡&WVW7Bç&Wf–÷W466W72ç&WVW7BÂ²wF‚rÂv&Æö"uÒÂG¶Æ&VÇÒ&VæWvÂG·7Vff—‡Ò&Wf–÷W2&WVW7F“°¢76W'DW†7D¶W•6WB‡&WVW7Bç&Wf–÷W466W72ç&VF&6²Â²wF‚rÂv&Æö"uÒÂG¶Æ&VÇÒ&VæWvÂG·7Vff—‡Ò&Wf–÷W2&VF&6¶“°¢76W'DW†7D¶W•6WB‡&WVW7Bç&Wf–WrÂ²v'&æ6„Æ–2rÂw&÷WFRrÂvÖæ–fW7EF‚rÂvÖæ–fW7D&Æö"rÂw&WV—&VDÆ&VÇ2rÂvvöÆFVäÖ7FW'2rÂwFV×÷&'”66W72uÒÂG¶Æ&VÇÒ&VæWvÂG·7Vff—‡Ò&Wf–Wv“°¢76W'DW†7D¶W•6WB‡&WVW7Bç&Wf–WrçFV×÷&'”66W72Â²v¶–æBrÂwW&ÂrÂvW‡—&W4BuÒÂG¶Æ&VÇÒ&VæWvÂG·7Vff—‡ÒFV×÷&'’66W76“°¢76W'B‡&WVW7Bç66†VÖfW'6–öâÓÓÒbb&WVW7Bæ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×&Wf–WrÖ66W72×&VæWvÂ×&WVW7B×&÷VæBÒG¶Wf–FVæ6U&÷VæGÒÒG·7Vff—‡Öbb&WVW7Bç&W÷6—F÷'’ÓÓÒ6æöæ–6Å&WVW7Bç&W÷6—F÷'’bb&WVW7Bæ'&æ6‚ÓÓÒv¶–Ö’rbb&WVW7Bæ6†ævT6öçG&öÂÓÓÒ6æöæ–6Å&WVW7Bæ6†ævT6öçG&öÂÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6†“°¢76W'B„¥4ôâç7G&–æv–g’‡&WVW7BçfW&–f–VD6öçFVçB’ÓÓÒ¥4ôâç7G&–æv–g’†6æöæ–6Å&WVW7BçfW&–f–VD6öçFVçB’bb¥4ôâç7G&–æv–g’‡&WVW7Bæ6ö×ÆWF–öâ’ÓÓÒ¥4ôâç7G&–æv–g’†6æöæ–6Å&WVW7Bæ6ö×ÆWF–öâ’bb&WVW7BæÖ†–×VÕfW&F–7BÓÓÒuTäD”äuôU…DU$äÅõ$Ud”Uuõ$TD$4²rÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò6†ævVB6öçFVçBö6ö×ÆWF–öâ÷"÷fW&6Æ–ÖVF“°¢6öç7B²FV×÷&'”66W73¢–væ÷&VD6æöæ–6Ä66W72Âââæ6æöæ–6Å&Wf–WrÒÒ6æöæ–6Å&WVW7Bç&Wf–Ws°¢6öç7B²FV×÷&'”66W72Âââç&VæWvÅ&Wf–WrÒÒ&WVW7Bç&Wf–Ws°¢76W'B„¥4ôâç7G&–æv–g’‡&VæWvÅ&Wf–Wr’ÓÓÒ¥4ôâç7G&–æv–g’†6æöæ–6Å&Wf–Wr’ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò6†ævVBF†R&Wf–WvVB&÷WFRÂÖæ–fW7BÂÆ&VÇ2÷"vöÆFVâÖ7FW'6“°¢76W'B„¥4ôâç7G&–æv–g’‡&WVW7Bç&Wf–÷W466W72’ÓÓÒ¥4ôâç7G&–æv–g’‡²&WVW7C¢²Fƒ¢&Wf–÷W5&WVW7EF‚Â&Æö#¢&Wf–÷W5&WVW7D&Æö"ÒÂ&VF&6³¢²Fƒ¢&Wf–÷W5&VF&6µF‚Â&Æö#¢&Wf–÷W5&VF&6´&Æö"ÒÒ’ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡ÒFöW2æ÷B6†–âg&öÒF†RW†7B&V6VF–ær66W72&ööf“°¢ÆWB66W75W&Ã°¢G'’²66W75W&ÂÒæWrU$Â‡FV×÷&'”66W72çW&Â“²Ò6F6‚²76W'B†fÇ6RÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡ÒU$Â—2–çfÆ–F“²Ð¢76W'B‡FV×÷&'”66W72æ¶–æBÓÓÒudU$4TÅõDTÕõ$%•õ4„$Uó#4‚rbb66W75W&Âæ÷&–v–âÓÓÒ6æöæ–6Å&WVW7Bç&Wf–Wræ'&æ6„Æ–2bb66W75W&ÂçW6W&æÖRÓÓÒrrbb66W75W&Âç77v÷&BÓÓÒrrbb66W75W&ÂçF†æÖRÓÓÒ6æöæ–6Å&WVW7Bç&Wf–Wrç&÷WFRbb66W75W&Âæ†6‚ÓÓÒrrbb¥4ôâç7G&–æv–g’…²ââæ66W75W&Âç6V&6…&×2æ¶W—2‚•Ò’ÓÓÒ¥4ôâç7G&–æv–g’…²u÷fW&6VÅ÷6†&RuÒ’bbõå´Õ¦×£Ó•òÕ×³bÃS'ÒBòçFW7B†66W75W&Âç6V&6…&×2ævWB‚u÷fW&6VÅ÷6†&Rr’óòrr’bbFV×÷&'”66W72çW&ÂÓÒ&Wf–÷W466W75W&ÂÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡ÒFV×÷&'’U$Â—2æ÷Bg&W6‚W†7B7&VFVçF–ÂÖg&VR66÷VB6†&V“°¢6öç7B&WVW7EF–ÖRÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ&WVW7D6öÖÖ—EÒ’“°¢6öç7BW‡—'’ÒFFRç'6R‡FV×÷&'”66W72æW‡—&W4Bóòrr“°¢76W'B„çVÖ&W"æ—4f–æ—FR†W‡—'’’bbW‡—'’â&WVW7EF–ÖRbbW‡—'’ÃÒ&WVW7EF–ÖR²#R¢c¢c¢ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡ÒW‡—'’—2–çfÆ–F“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡&WVW7EF‚Â&WVW7D6öÖÖ—B“°¢7W'6÷"³Ò°¢–b†7W'6÷"ÓÓÒgFW%&VG’æÆVæwF‚’°¢VæF–æu&WVW7BÒ²Fƒ¢&WVW7EF‚Â6öÖÖ—C¢&WVW7D6öÖÖ—BÂ&WVW7BÓ°¢7W'&VçE&WVW7BÒ&WVW7C°¢'&V³°¢Ð¢6öç7B&VF&6´6öÖÖ—BÒgFW%&VG•¶7W'6÷%Ó°¢76W'DW†7D6†ævVEF‡2‡&WVW7D6öÖÖ—BÂ&VF&6´6öÖÖ—BÂ·&VF&6µF…ÒÂG¶Æ&VÇÒ66W72&VæWvÂG·7Vff—‡Ò&VF&6¶“°¢76W'B†f—'7DFD6öÖÖ—B‡&VF&6µF‚’ÓÓÒ&VF&6´6öÖÖ—BÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò&VF&6²v2æ÷Bf—'7BFFVBB—G2W†7B6öÖÖ—F“°¢6öç7B&VF&6²Ò§6öâ‡&VF&6µF‚“°¢76W'DW†7D¶W•6WB‡&VF&6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&–f–VD6öçFVçBrÂv6ö×ÆWF–öârÂw&WVW7BrÂvW‡FW&æÅ&ööbrÂwfW&–f–VDFWÆ÷–ÖVçBrÂwfW&–f–VD‡GGrÂwfW&F–7BrÂwVç&W6öÇfVBrÂvÖ†–×VÕfW&F–7BuÒÂG¶Æ&VÇÒ&VæWvÂG·7Vff—‡Ò&VF&6¶“°¢76W'B‡&VF&6²ç66†VÖfW'6–öâÓÓÒbb&VF&6²æ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×&Wf–WrÖ66W72×&VæWvÂ×&VF&6²×&÷VæBÒG¶Wf–FVæ6U&÷VæGÒÒG·7Vff—‡Öbb&VF&6²ç&W÷6—F÷'’ÓÓÒ6æöæ–6Å&VF&6²ç&W÷6—F÷'’bb&VF&6²æ'&æ6‚ÓÓÒv¶–Ö’rbb&VF&6²æ6†ævT6öçG&öÂÓÓÒ6æöæ–6Å&VF&6²æ6†ævT6öçG&öÂÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò&VF&6²–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6†“°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²çfW&–f–VD6öçFVçB’ÓÓÒ¥4ôâç7G&–æv–g’†6æöæ–6Å&VF&6²çfW&–f–VD6öçFVçB’bb¥4ôâç7G&–æv–g’‡&VF&6²æ6ö×ÆWF–öâ’ÓÓÒ¥4ôâç7G&–æv–g’†6æöæ–6Å&VF&6²æ6ö×ÆWF–öâ’bb&VF&6²ç&WVW7BçF‚ÓÓÒ&WVW7EF‚bb&VF&6²ç&WVW7Bæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·&WVW7EF‡ÖÒ’ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò&VF&6²6öçFVçBö6ö×ÆWF–öâ÷&WVW7BÖ—6ÖF6†“°¢6öç7BÆ—fRÒfW&–g•3$W‡FW&æÅ&Wf–WtWf–FVæ6R‡&VF&6²æW‡FW&æÅ&ööbÂ&WVW7BÂG¶Æ&VÇÒ66W72&VæWvÂG·7Vff—‡ÖÂ&WVW7EF‚Â7V66W76÷$÷Væ–æt6öÖÖ—B“°¢76W'B‚õæGÅõ´Õ¦×£Ó•Ò²BòçFW7B‡&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–Bóòrr’bbõæ‡GG3¥ÂõÂõ¶×£Ó’ÕÒµÂçfW&6VÅÂæBòçFW7B‡&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–Ö×WF&ÆUW&Âóòrr’bb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæVçf—&öæÖVçBÓÓÒu&Wf–Wrrbb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæv—F‡V$6öÖÖ—BÓÓÒ&Wf–Wu&Vf—‚çF&vWD6öÖÖ—Bbb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæv—F‡V%&VbÓÓÒv¶–Ö’rbb&VF&6²çfW&–f–VDFWÆ÷–ÖVçBç&öGV7F–öåF&vWFVBÓÓÒfÇ6RÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡ÒFWÆ÷–ÖVçB7VÖÖ'’—2–çfÆ–F“°¢76W'B‡&VF&6²çfW&–f–VD‡GGæ'&æ6„Æ–2ÓÓÒ&WVW7Bç&Wf–Wræ'&æ6„Æ–2bb&VF&6²çfW&–f–VD‡GGç&Wf–Wu&÷WFRÓÓÒ&WVW7Bç&Wf–Wrç&÷WFRbb&VF&6²çfW&–f–VD‡GGæÆ–56W'fW5&Wf–WvVD6öçFVçBÓÓÒG'VRbbFFRç'6R‡&VF&6²çfW&–f–VD‡GGçfW&–f–VDB’ÃÒW‡—'’ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò…EE7VÖÖ'’—2–çfÆ–B÷"W‡—&VF“°¢–b†Æ—fR’°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²çfW&–f–VDFWÆ÷–ÖVçB’ÓÓÒ¥4ôâç7G&–æv–g’‡²–C¢Æ—fRç&W7VÇBæ6öçFVçDFWÆ÷–ÖVçBçfW&6VÄFWÆ÷–ÖVçD–BÂ–Ö×WF&ÆUW&Ã¢Æ—fRç&W7VÇBæ6öçFVçDFWÆ÷–ÖVçBæ–Ö×WF&ÆUW&ÂÂVçf—&öæÖVçC¢u&Wf–WrrÂv—F‡V$6öÖÖ—C¢&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÂv—F‡V%&Vc¢v¶–Ö’rÂ&öGV7F–öåF&vWFVC¢fÇ6RÒ’ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡ÒFWÆ÷–ÖVçBF–ffW'2g&öÒÆ—fR&ööf“°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²çfW&–f–VD‡GG’ÓÓÒ¥4ôâç7G&–æv–g’‡²'&æ6„Æ–3¢&WVW7Bç&Wf–Wræ'&æ6„Æ–2Â&Wf–Wu&÷WFS¢&WVW7Bç&Wf–Wrç&÷WFRÂfW&–f–VDC¢Æ—fRæ‡GG&W÷'BçfW&–f–VDBÂÆ–56W'fW5&Wf–WvVD6öçFVçC¢G'VRÒ’ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò…EEWf–FVæ6RF–ffW'2g&öÒÆ—fR&ööf“°¢Ð¢76W'B‡&VF&6²çfW&F–7BÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urrbb&VF&6²æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urrbb¥4ôâç7G&–æv–g’‡&VF&6²çVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’ÂG¶Æ&VÇÓ¢&VæWvÂG·7Vff—‡Ò÷fW&6Æ–×2÷"&WF–ç2õ“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡&VF&6µF‚Â&VF&6´6öÖÖ—B“°¢&Wf–÷W5&WVW7EF‚Ò&WVW7EFƒ²&Wf–÷W5&VF&6µF‚Ò&VF&6µFƒ°¢&Wf–÷W5&WVW7D&Æö"Òv—B…²w&Wb×'6RrÂ„TC¢G·&WVW7EF‡ÖÒ“²&Wf–÷W5&VF&6´&Æö"Òv—B…²w&Wb×'6RrÂ„TC¢G·&VF&6µF‡ÖÒ“°¢&Wf–÷W466W75W&ÂÒFV×÷&'”66W72çW&Ã²7W'&VçE&WVW7BÒ&WVW7C²7W'&VçE&VF&6²Ò&VF&6³²7W'&VçE&WVW7EF‚Ò&WVW7EFƒ²7W'&VçE&VF&6µF‚Ò&VF&6µFƒ²FV6—6–öå&VG”6öÖÖ—BÒ&VF&6´6öÖÖ—C°¢7W'6÷"³Ò°¢Ð¢76W'DæõF„6†ævW56–æ6R‡&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÂVæGö–çBÂ&Wf–Wu&Vf—‚æ6öçFVçDÖæ–fW7BæÖ†VçG'’ÓâVçG'’çF‚’ÂG¶Æ&VÇÒ6öçFVçBg&VW¦RF‡&÷Vv‚66W72&VæWvÆ“°¢76W'DæõF„6†ævW56–æ6R†&6U&VG”6öÖÖ—BÂVæGö–çBÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2ÂG¶Æ&VÇÒÖ—'&÷"g&VW¦RF‡&÷Vv‚66W72&VæWvÆ“°¢&WGW&â²&6U&VG”6öÖÖ—BÂFV6—6–öå&VG”6öÖÖ—BÂ7W'&VçE&WVW7BÂ7W'&VçE&VF&6²Â7W'&VçE&WVW7EF‚Â7W'&VçE&VF&6µF‚ÂVæF–æu&WVW7BÂVæGö–çBÓ°§Ð¦76W'B‚‡3%$6öçG&öÂbb3%&Wf—6–öä6öçG&öÂ’Âw&÷VæB3R&÷fÂæB&÷VæB3b&Wf—6–öâ&R×WGVÆÇ’W†6ÇW6—fR7V66W76÷'2öbF†R–æ—F–Â$TE’7FFRr“°¦6öç7B3$–æ—F–Å&VG”66W72Ò3%&Wf–Wu&Vf—ƒòç&VF&6´6öÖÖ—@¢òfW&–g•3%&VG”66W75&VæWvÇ2‡²&Wf–Wu&Vf—ƒ¢3%&Wf–Wu&Vf—‚ÂWf–FVæ6UF‡3¢3%&Wf–WtWf–FVæ6UF‡2ÂWf–FVæ6U&÷VæC¢srÂ7V66W76÷$÷Væ–æt6öÖÖ—C¢3%$÷Væ–æt6öÖÖ—Bóò3%&Wf—6–öä÷Væ–æt6öÖÖ—BÂÆ&VÃ¢u3"–æ—F–Â&Wf–WrrÒ¢¢çVÆÃ°¦6öç7B3%&Wf—6–öä†&æW757G&–ætÆ–Ö—BÒ#C°¦gVæ7F–öâ—5v—F†–å3%&Wf—6–öä†&æW757G&–ætÆ–Ö—B‡fÇVR’°¢&WGW&âG—VöbfÇVRÓÓÒw7G&–ærrbbfÇVRæÆVæwF‚ÃÒ3%&Wf—6–öä†&æW757G&–ætÆ–Ö—C°§Ð¦76W'B†—5v—F†–å3%&Wf—6–öä†&æW757G&–ætÆ–Ö—B‚w‚rç&WVBƒ#C’’bb—5v—F†–å3%&Wf—6–öä†&æW757G&–ætÆ–Ö—B‚w‚rç&WVBƒ#C’’Âu3"&Wf—6–öâ†&æW727G&–ær&÷VæF'’—2æ÷Bf–ÂÖ6Æ÷6VBB#C6†&7FW'2r“°¦gVæ7F–öâ—46æöæ–6Å3%&Wf—6–öå6VÆV7F÷"‡fÇVR’°¢–b‡G—VöbfÇVRÓÒw7G&–ærrÇÂfÇVRæÆVæwF‚â#CÇÂfÇVRÓÒfÇVRçG&–Ò‚’ÇÂfÇVRç7F'G5v—F‚‚s§66÷Rr’ÇÂõ²Çâµ×Ã¦†5Ç2¥Â‡ÅµÇ%ÆåÒòçFW7B‡fÇVR’’&WGW&âfÇ6S°¢6öç7BFöÒÒ7G&–ærç&vƒó¥Â§Å¶×¤Õ¥Õ¶×¤Õ£Ó•òÕÒ§Å²â5Õ¶×¤Õ¥õÕ¶×¤Õ£Ó•òÕÒ§ÅÅ²ƒó¦FFÕ¶×£Ó’ÕÒ·Æ&–Õ¶×£Ó’ÕÒ·Ç&öÆWÆ–GÆ6Æ72’ƒó£Òƒó¢%¶×¤Õ£Ó•òâó¢Õ×³Ã#Ò'Âu¶×¤Õ£Ó•òâó¢Õ×³Ã#ÒwÅ¶×¤Õ¥õÕ¶×¤Õ£Ó•òÕÒ¢’“õÅÒ–°¢6öç7B6ö×÷VæBÒƒó¢G¶Fö×Ò’¶°¢&WGW&âæWr&VtW‡†ã§66÷Rƒó¥ÅÇ2·ÅÅÇ2£åÅÇ2¢’G¶6ö×÷VæGÒƒó¢ƒó¥ÅÇ2·ÅÅÇ2£åÅÇ2¢’G¶6ö×÷VæGÒ’¢F’çFW7B‡fÇVR“°§Ð¦gVæ7F–öâ—46æöæ–6Å3$W†7EFW‡B‡fÇVR’°¢&WGW&â—5v—F†–å3%&Wf—6–öä†&æW757G&–ætÆ–Ö—B‡fÇVR’bbfÇVRæÆVæwF‚ãÒbbfÇVRÓÓÒfÇVRç&WÆ6R‚õÇ2²öwRÂrr’çG&–Ò‚“°§Ð¦f÷"†6öç7B6VÆV7F÷"öb²s§66÷Ræ—FVÒrÂs§66÷Râ¶FFÖvÓÒ$tÓ%ÒæÆ&VÂrÂ#§66÷R'F–6ÆRç'G’Ö6&E¶FF×'G’×7FFSÒvf–VÆBuÒ%Ò’76W'B†—46æöæ–6Å3%&Wf—6–öå6VÆV7F÷"‡6VÆV7F÷"’Âu3"&Wf—6–öâ6VÆV7F÷"w&ÖÖ"&V¦V7FVBfÆ–B6fWG’fV7F÷"r“°¦f÷"†6öç7B6VÆV7F÷"öb²s§66÷R²rÂs§66÷RãâærÂs§66÷RââærÂs§66÷R¶–CÖföòæ&%ÒrÂs§66÷R¶–CÒ&föõÅÂ%ÒrÂv&öG’ærÂs§66÷RæÂæ"rÂs§66÷S¦†2‚æ’uÒ’76W'B‚—46æöæ–6Å3%&Wf—6–öå6VÆV7F÷"‡6VÆV7F÷"’Âu3"&Wf—6–öâ6VÆV7F÷"w&ÖÖ"66WFVBâ–çfÆ–B6fWG’fV7F÷"r“°¦76W'B†—46æöæ–6Å3$W†7EFW‡B‚~xÊ²NKÙ2r’bb—46æöæ–6Å3$W†7EFW‡B‚~xÊ²NKÙ2r’Âu3"&Wf—6–öâFW‡B6æöæ–6Æ—¦F–öâfV7F÷'2f–ÆVBr“°¦6öç7B3$vöÆFVäÖ7FW%f–Ww÷'D'”–BÒæWrÖ‡3$W‡V7FVE67&VVç6†÷G2ç6Æ–6RƒÂ‚’æÖ‚‡²–BÂv–GF‚Â†V–v‡BÒ’Óâ¶–BÂ²v–GF‚Â†V–v‡BÕÒ’“°¦gVæ7F–öâ3$7&—FW&–öäÖ†–×VÔÖvæ—GVFR†7&—FW&–öâ’°¢6öç7Bf–Ww÷'BÒ3$vöÆFVäÖ7FW%f–Ww÷'D'”–BævWB†7&—FW&–öâævöÆFVäÖ7FW"“°¢76W'B‡f–Ww÷'BÂ3"&Wf—6–öâ7&—FW&–öâ†2æò&Wf–WvVBf–Ww÷'C¢G¶7&—FW&–öâævöÆFVäÖ7FW'Ö“°¢–b†7&—FW&–öâçG—RÓÓÒtDôÕõ$T5EôDTÅDr’&WGW&â²wv–GF‚rÂw‚uÒæ–æ6ÇVFW2†7&—FW&–öâç&÷W'G’’òf–Ww÷'Bçv–GF‚¢f–Ww÷'Bæ†V–v‡C°¢–b†7&—FW&–öâçG—RÓÓÒtDôÕõ5E”ÄUôDTÅDr’&WGW&â7&—FW&–öâç&÷W'G’ÓÓÒv÷6—G’rò¢f–Ww÷'Bæ†V–v‡C°¢–b†7&—FW&–öâçG—RÓÓÒtTÄTÔTåEõd•4”$ÄRr’&WGW&âf–Ww÷'Bçv–GF‚¢f–Ww÷'Bæ†V–v‡C°¢&WGW&âçVÆÃ°§Ð¦gVæ7F–öâ—46æöæ–6Ä6‡&öÖ—VÔ6ö×WFVD6öÆ÷"‡fÇVR’°¢–b‡G—VöbfÇVRÓÒw7G&–ærr’&WGW&âfÇ6S°¢6öç7BÖF6‚ÒfÇVRæÖF6‚‚õç&v&õÂ‚…ÆG³Ã7Ò’Â…ÆG³Ã7Ò’Â…ÆG³Ã7Ò’ƒó¢ÂƒÃÃõÂåÆB²’“õÂ’Bò“°¢–b‚ÖF6‚ÇÂÖF6‚ç6Æ–6RƒÂB’ç6öÖR†6ö×öæVçBÓâçVÖ&W"†6ö×öæVçB’â#SR’’&WGW&âfÇ6S°¢6öç7BÇ†ÒÖF6…³EÒÓÓÒVæFVf–æVBòçVÆÂ¢çVÖ&W"†ÖF6…³EÒ“°¢&WGW&âÇ†ÓÓÒçVÆÂÇÂ„çVÖ&W"æ—4f–æ—FR†Ç†’bbÇ†ãÒbbÇ†ÃÒbb7G&–ær†Ç†’ÓÓÒÖF6…³EÒ“°§Ð¦76W'B†—46æöæ–6Ä6‡&öÖ—VÔ6ö×WFVD6öÆ÷"‚w&v"ƒÂ#‚Â#SR’r’bb—46æöæ–6Ä6‡&öÖ—VÔ6ö×WFVD6öÆ÷"‚w&v&ƒÂÂÂãR’r’bb—46æöæ–6Ä6‡&öÖ—VÔ6ö×WFVD6öÆ÷"‚v&æær’Ât6‡&öÖ—VÒ6ö×WFVBÖ6öÆ÷"6æöæ–6Æ—¦F–öâfV7F÷'2f–ÆVBr“°¦gVæ7F–öâFW&—fT7F—fT66WFæ6T7&—FW&–‡&–÷$7F—fRÂ&WVW7FVD6†ævW2ÂÆ&VÂ’°¢6öç7B7F—fRÒ²ââç&–÷$7F—fUÓ°¢6öç7B&–÷$'”76W'F–öä–BÒæWrÖ†7F—fRæÖ†VçG'’Óâ¶VçG'’æ76W'F–öâæ–BÂVçG'•Ò’“°¢6öç7B7WW'6VFVBÒæWr6WB‚“°¢6öç7B&WÆ6VÖVçD–G2ÒæWr6WB‚“°¢6öç7BÖV6†æ–6ÅF&vWG2ÒæWr6WB…²w7FWB÷3"övöÆFVâÖÖ7FW"×÷&Wf–WrÖÖæ–fW7Bæ§6öârÂw7FWB÷3"övöÆFVâÖÖ7FW"×ö76WBÖÖæ–fW7Bæ§6öâuÒ“°¢6öç7B6ÖU6VÖçF–4Æö7W2Ò‡&–÷"Â&WÆ6VÖVçB’Óâ°¢–b‡&–÷"çG—RÓÒ&WÆ6VÖVçBçG—RÇÂ&–÷"ævöÆFVäÖ7FW"ÓÒ&WÆ6VÖVçBævöÆFVäÖ7FW"’&WGW&âfÇ6S°¢–b‡&–÷"çG—RÓÓÒu$ô•õ•„TÅôDTÅDr’&WGW&â¥4ôâç7G&–æv–g’‡&–÷"ç&Vv–öâ’ÓÓÒ¥4ôâç7G&–æv–g’‡&WÆ6VÖVçBç&Vv–öâ“°¢–b‡&–÷"ç6VÆV7F÷"ÓÒ&WÆ6VÖVçBç6VÆV7F÷"’&WGW&âfÇ6S°¢&WGW&â²tDôÕõ$T5EôDTÅDrÂtDôÕõ5E”ÄUôDTÅDuÒæ–æ6ÇVFW2‡&–÷"çG—R’ÇÂ&–÷"ç&÷W'G’ÓÓÒ&WÆ6VÖVçBç&÷W'G“°¢Ó°¢6öç7BWVÆÇ•7G&öæu&WÆ6VÖVçBÒ‡&–÷"Â&WÆ6VÖVçB’Óâ°¢–b‚6ÖU6VÖçF–4Æö7W2‡&–÷"Â&WÆ6VÖVçB’’&WGW&âfÇ6S°¢–b‡&–÷"çG—RÓÓÒuDU…EôU„5Br’&WGW&â&WÆ6VÖVçBæW‡V7FVBÓÒ&–÷"æW‡V7FVC°¢–b‡&–÷"çG—RÓÓÒtTÄTÔTåEõd•4”$ÄRr’&WGW&â&WÆ6VÖVçBæÖ–æ–×VÔ&VãÒ&–÷"æÖ–æ–×VÔ&V°¢–b‡&–÷"çG—RÓÓÒu$ô•õ•„TÅôDTÅDr’&WGW&â²v6†ævVE—†VÅ&F–òrÂvÖVä'6öÇWFT6†ææVÄFVÇFuÒæWfW'’†¶W’Óâ&WÆ6VÖVçE¶¶W•Õ³ÒãÒ&–÷%¶¶W•Õ³Òbb&WÆ6VÖVçE¶¶W•Õ³ÒÃÒ&–÷%¶¶W•Õ³Ò“°¢–b‡&–÷"æ÷W&F÷"ÓÒ&WÆ6VÖVçBæ÷W&F÷"’&WGW&âfÇ6S°¢–b‡&–÷"æ÷W&F÷"ÓÓÒteDU%ôUTÅ2r’&WGW&â&WÆ6VÖVçBçF‡&W6†öÆBÓÒ&–÷"çF‡&W6†öÆC°¢–b‡&–÷"æ÷W&F÷"ÓÓÒt4„ätTBr’&WGW&âG'VS°¢&WGW&âÖF‚æ'2‡&WÆ6VÖVçBçF‡&W6†öÆB’ãÒÖF‚æ'2‡&–÷"çF‡&W6†öÆB“°¢Ó°¢f÷"†6öç7B6†ævRöb&WVW7FVD6†ævW2’°¢76W'B„'&’æ—4'&’†6†ævRç7WW'6VFW476W'F–öç2’bb¥4ôâç7G&–æv–g’†6†ævRç7WW'6VFW476W'F–öç2’ÓÓÒ¥4ôâç7G&–æv–g’…²ââæ6†ævRç7WW'6VFW476W'F–öç5Òç6÷'B‚’’bbæWr6WB†6†ævRç7WW'6VFW476W'F–öç2’ç6—¦RÓÓÒ6†ævRç7WW'6VFW476W'F–öç2æÆVæwF‚ÂG¶Æ&VÇÓ¢7WW'6VFVB76W'F–öâ”G2×W7B&R6÷'FVBVæ—VR6WF“°¢f÷"†6öç7B76W'F–öä–Böb6†ævRç7WW'6VFW476W'F–öç2’°¢6öç7B&–÷"Ò&–÷$'”76W'F–öä–BævWB†76W'F–öä–B“°¢76W'B‡&–÷"bb7WW'6VFVBæ†2†76W'F–öä–B’ÂG¶Æ&VÇÓ¢7WW'6W76–öâFöW2æ÷BæÖRöæRW†7B7F—fR&–÷"76W'F–öã¢G¶76W'F–öä–GÖ“°¢6öç7BÖVæ–ævgVÅ&–÷%F&vWG2Ò&–÷"çF&vWEF‡2æf–ÇFW"†f–ÆRÓâÖV6†æ–6ÅF&vWG2æ†2†f–ÆR’“°¢6öç7BÖVæ–ævgVÄ7W'&VçEF&vWG2Ò6†ævRçF&vWEF‡2æf–ÇFW"†f–ÆRÓâÖV6†æ–6ÅF&vWG2æ†2†f–ÆR’“°¢76W'B‡&–÷"æffV7FVDvöÆFVäÖ7FW'2ç6öÖR†–BÓâ6†ævRæffV7FVDvöÆFVäÖ7FW'2æ–æ6ÇVFW2†–B’’bbÖVæ–ævgVÅ&–÷%F&vWG2ç6öÖR†f–ÆRÓâÖVæ–ævgVÄ7W'&VçEF&vWG2æ–æ6ÇVFW2†f–ÆR’’ÂG¶Æ&VÇÓ¢7WW'6VFVB76W'F–öâFöW2æ÷B÷fW&ÆF†R7W'&VçB&WVW7Bw2vöÆFVâÖ7FW"æBæöâÖÖV6†æ–6ÂF&vWB×F‚66÷S¢G¶76W'F–öä–GÖ“°¢6öç7B&WÆ6VÖVçG2Ò6†ævRæ66WFæ6T76W'F–öç2æf–ÇFW"†76W'F–öâÓâWVÆÇ•7G&öæu&WÆ6VÖVçB‡&–÷"æ76W'F–öâÂ76W'F–öâ’“°¢76W'B‡&WÆ6VÖVçG2æÆVæwF‚ÓÓÒbb&WÆ6VÖVçD–G2æ†2‡&WÆ6VÖVçG5³Òæ–B’ÂG¶Æ&VÇÓ¢7WW'6VFVB76W'F–öâÆ6·2öæRVæ—VR6ÖRÖÆö7W2Âæöâ×f7V÷W2æBBÖÆV7BÖWV—fÆVçB&WÆ6VÖVçC¢G¶76W'F–öä–GÖ“°¢&WÆ6VÖVçD–G2æFB‡&WÆ6VÖVçG5³Òæ–B“°¢7WW'6VFVBæFB†76W'F–öä–B“°¢Ð¢Ð¢6öç7B7W'f—f÷'2Ò7F—fRæf–ÇFW"†VçG'’Óâ7WW'6VFVBæ†2†VçG'’æ76W'F–öâæ–B’“°¢6öç7BFF—F–öç2Ò&WVW7FVD6†ævW2æfÆDÖ†6†ævRÓâ6†ævRæ66WFæ6T76W'F–öç2æÖ†76W'F–öâÓâ‡°¢&WVW7D–C¢6†ævRæ–BÀ¢7&—FW&–öå6†#Sc¢6†#Sc¢G·6†#Sd6æöæ–6Â†76W'F–öâ—ÖÀ¢76W'F–öâÀ¢ffV7FVDvöÆFVäÖ7FW'3¢6†ævRæffV7FVDvöÆFVäÖ7FW'2À¢F&vWEF‡3¢6†ævRçF&vWEF‡0¢Ò’’“°¢6öç7B&W7VÇBÒ²ââç7W'f—f÷'2ÂââæFF—F–öç5Ó°¢76W'B†æWr6WB‡&W7VÇBæÖ†VçG'’ÓâVçG'’æ76W'F–öâæ–B’’ç6—¦RÓÓÒ&W7VÇBæÆVæwF‚ÂG¶Æ&VÇÓ¢7F—fR66WFæ6R76W'F–öâ”G2&Ræ÷BvÆö&ÆÇ’Væ—VV“°¢&WGW&â&W7VÇC°§Ð¦gVæ7F–öâV&Æ–47F—fT66WFæ6T7&—FW&–†7F—fR’°¢&WGW&â7F—fRæÖ‚‡²&WVW7D–BÂ7&—FW&–öå6†#SbÂ76W'F–öâÒ’Óâ‡²&WVW7D–BÂ7&—FW&–öå6†#SbÂ76W'F–öâÒ’“°§Ð¦gVæ7F–öâfW&–g•3%&Wf—6–öä†æFöfb‚’°¢76W'B„&ööÆVâ‡3%&Wf—6–öä6öçG&öÂ’ÓÓÒ&ööÆVâ‡3%&Wf—6–öäFV6—6–öäÆö6²’Âw&÷VæB3b6öçG&öÂæB&÷VæBrW6W"×&Wf—6–öâÆö6²×W7BV"FöÖ–6ÆÇ’r“°¢6öç7B&Wf—6–öäWf–FVæ6U&W6Væ6RÒö&¦V7BçfÇVW2‡3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’ç6öÖR†W†—7G2“°¢–b‚3%&Wf—6–öä6öçG&öÂ’°¢76W'B‚&Wf—6–öäWf–FVæ6U&W6Væ6RÂw&÷VæB"3"&Wf–WrWf–FVæ6RW†—7G2v—F†÷WBF†RW†7B&÷VæB3bW6W"×&Wf—6–öâ6öçG&öÂr“°¢&WGW&âçVÆÃ°¢Ð¢76W'B‚3%$6öçG&öÂbb3%W6W$FV6—6–öäÆö6²Âu3"&Wf—6–öâÖ’÷VâöæÇ’&Vf÷&R"&÷fÂr“°¢76W'B‚‡3%&Wf—6VE$6öçG&öÂbb3%6V6öæE&Wf—6–öä6öçG&öÂ’Âw&÷VæB3r&÷fÂæB&÷VæB3‚6V6öæB&Wf—6–öâ&R×WGVÆÇ’W†6ÇW6—fR7V66W76÷'2öbF†R6ÖR&Wf—6VB$TE’F&vWBr“°¢76W'B‡3%&W—$6öçG&öÂbb3%&Wf–Wu&Vf—ƒòç&VF&6´6öÖÖ—BÂw&÷VæB3b&WV—&W2F†R6ö×ÆWFR–Ö×WF&ÆR&÷VæB3"&Wf–Wr6†–âr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öä6öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂvVçG'•v÷&¶fÆ÷rrÂwW6W$FV6—6–öäÆö6²rÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂw&Wf—6–öå&WVW7BrÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂw&÷VæB3b&Wf—6–öâ6öçG&öÂr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öä6öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂw&÷VæB3bVçG'’r“°¢76W'Ev÷&¶fÆ÷tWf–FVæ6T¶W—2‡3%&Wf—6–öä6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæB3bVçG'’v÷&¶fÆ÷rrÂG'VR“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öä6öçG&öÂçW6W$FV6—6–öäÆö6²Â²wF‚rÂv&Æö"uÒÂw&÷VæB3bFV6—6–öâÖÆö6²&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öä6öçG&öÂç&Wf—6–öå&WVW7BÂ²v6÷VçBrÂw&WVW7E6†#SbrÂwF&vWEF‡2uÒÂw&÷VæB3b&Wf—6–öâ&WVW7B&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öä6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²w&WV—&VD–çFW&æÅrÂw&WV—&VD–çFW&æÅrÂvÖ†–×VÔgFW%&Wf—6–öå&Wf–WrrÂvÖ”æ÷DFV6Æ&RrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂwW6W%f—7VÄ&÷fÂuÒÂw&÷VæB3b6ö×ÆWF–öâ&÷VæF'’r“°¢76W'B‡3%&Wf—6–öä6öçG&öÂç66†VÖfW'6–öâÓÓÒbb3%&Wf—6–öä6öçG&öÂæ'F–f7D–BÓÓÒv6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3brbb—46æöæ–6Ä—6ôFFR‡3%&Wf—6–öä6öçG&öÂæ7&VFVDB’Âw&÷VæB3b–FVçF—G’÷"FFRÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6–öä6öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3%&Wf—6–öä6öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb3%&Wf—6–öä6öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ3%&W—$6öçG&öÅF‚Âw&÷VæB3b&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6–öä6öçG&öÂç7FGW2ÓÓÒt”åõ$ôu$U52rbb3%&Wf—6–öä6öçG&öÂçfW&F–7BÓÓÒt”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôârbb3%&Wf—6–öä6öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb3%&Wf—6–öä6öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"ÕÔtôÄDTâÔÔ5DU"rbb3%&Wf—6–öä6öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6RÂw&÷VæB3b†6R÷"fW&F–7BÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6–öä6öçG&öÂç66÷RÓÓÒu3%õôU„5EõU4U%õ$UTU5DTEõ$Ud•4”ôåôôäÅ’rÂw&÷VæB3b66÷RW†6VVG2F†RW†7BW6W"×&WVW7FVB3"&Wf—6–öâr“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6–öä6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢&WV—&VD–çFW&æÅ¢À¢&WV—&VD–çFW&æÅ¢À¢Ö†–×VÔgFW%&Wf—6–öå&Wf–Ws¢u$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UrrÀ¢Ö”æ÷DFV6Æ&S¢²u3"6ö×ÆWFRrÂu7FWB52rÂu7FWRÆÆ÷vVBrÂu"76WB&öGV7F–öâÆÆ÷vVBrÂu&öGV7F–öâ&VG’rÂw‡—6–6Â•†öæRfW&–f–VBrÂwW6W"f—7VÂ&÷fÂö'F–æVBuÒÀ¢7FWE73¢fÇ6RÀ¢7FWTÆÆ÷vVC¢fÇ6RÀ¢&öGV7F–öäÆÆ÷vVC¢fÇ6RÀ¢&öGV7F–öäÆ–46†ævVC¢fÇ6RÀ¢‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÀ¢W6W%f—7VÄ&÷fÃ¢fÇ6P¢Ò’Âw&÷VæB3b6ö×ÆWF–öâ&÷VæF'’÷fW&6Æ–×2&÷fÂÂ"Â&VÆV6R÷"FWf–6R7FGW2r“° ¢76W'DW†7D¶W•6WB‡3%&Wf—6–öäFV6—6–öäÆö6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂv6†BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçDFV6—6–öäÆö6²rÂv&6RrÂw6÷W&6TFV6—6–öârÂw&Wf–Wt66W72rÂvFV6—6–öârÂw&WVW7FVD6†ævW2rÂv&÷VæF&–W2uÒÂw&÷VæBrW6W"×&Wf—6–öâÆö6²r“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öäFV6—6–öäÆö6²æ&6RÂ²v†VBrÂwG&VRuÒÂw&÷VæBr&Wf—6–öâ&6Rr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâÂ²vÖW76vRrÂvÖW76vU6†#SbrÂvWF†÷&—¦F–öä6öFRrÂvö'6W'fVDBrÂv–æfW'&VBuÒÂw&÷VæBr&Wf—6–öâ6÷W&6Rr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öäFV6—6–öäÆö6²ç&Wf–Wt66W72Â²w&WVW7BrÂw&VF&6²uÒÂw&÷VæBr&Wf–Wr66W72r“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öäFV6—6–öäÆö6²ç&Wf–Wt66W72ç&WVW7BÂ²wF‚rÂv&Æö"uÒÂw&÷VæBr&Wf–Wr66W72&WVW7Br“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öäFV6—6–öäÆö6²ç&Wf–Wt66W72ç&VF&6²Â²wF‚rÂv&Æö"uÒÂw&÷VæBr&Wf–Wr66W72&VF&6²r“°¢76W'DW†7D¶W•6WB‡3%&Wf—6–öäFV6—6–öäÆö6²æ&÷VæF&–W2Â²wW6W%f—7VÄ&÷fÂrÂw3$6ö×ÆWFRrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw$76WE&öGV7F–öäÆÆ÷vVBrÂw'VçF–ÖT–×ÆVÖVçFVBrÂw&öGV7F–öå&VG’rÂw‡—6–6Ä•†öæUfW&–f–VBrÂw&öGV7F–öäÆ–46†ævVBuÒÂw&÷VæBr&Wf—6–öâ&÷VæF&–W2r“°¢76W'B‡3%&Wf—6–öäFV6—6–öäÆö6²ç66†VÖfW'6–öâÓÓÒbb3%&Wf—6–öäFV6—6–öäÆö6²æ'F–f7D–BÓÓÒw7FWÓÖ†W&òÖÖW&6†çBÖÆ&vRÖ–FÆRÖ–çFVw&F–öâ×W6W"ÖFV6—6–öâÖÆö6²×&÷VæBÓrrbb—46æöæ–6Ä—6ôFFR‡3%&Wf—6–öäFV6—6–öäÆö6²æ7&VFVDB’Âw&÷VæBr&Wf—6–öâ–FVçF—G’÷"FFRÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6–öäFV6—6–öäÆö6²æ6†BÓÓÒsEõ3"ÕôvöÆFVäÖ7FW.ŠŠÞŠˆ‚rbb3%&Wf—6–öäFV6—6–öäÆö6²ç&W÷6—F÷'’ÓÓÒ3%&Wf—6–öä6öçG&öÂç&W÷6—F÷'’bb3%&Wf—6–öäFV6—6–öäÆö6²æ'&æ6‚ÓÓÒv¶–Ö’rbb3%&Wf—6–öäFV6—6–öäÆö6²ç&VçDFV6—6–öäÆö6²ÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ†W&òÖÖW&6†çBÖÆ&vRÖ–FÆRÖ–çFVw&F–öâ÷W6W"ÖFV6—6–öâÖÆö6²×&÷VæBÓRæ§6öârÂw&÷VæBr&Wf—6–öâ6†BÂ&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6–öäFV6—6–öäÆö6²æFV6—6–öâÓÓÒu$UTU5DTEõ3%ôtôÄDTåôÔ5DU%õõ$Ud•4”ôârbbö&¦V7BçfÇVW2‡3%&Wf—6–öäFV6—6–öäÆö6²æ&÷VæF&–W2’æWfW'’‡fÇVRÓâfÇVRÓÓÒfÇ6R’Âw&÷VæBr&Wf—6–öâFV6—6–öâ÷fW&6Æ–×2&÷fÂÂ6ö×ÆWF–öâÂ"Â'VçF–ÖRÂ&VÆV6R÷"FWf–6R7FFRr“°¢76W'B„'&’æ—4'&’‡3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2’bb3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2æÆVæwF‚ãÒbb3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2æÆVæwF‚ÃÒ#Âw&÷VæBr×W7B&–æB&WGvVVâöæRæBGvVçG’6öæ7&WFR&Wf—6–öâw&÷W2r“°¢6öç7BvÕ6WBÒæWr6WB…²ttÓrÂttÓ"rÂttÓ2rÂttÓBrÂttÓRrÂttÓbrÂttÓrrÂttÓ‚uÒ“°¢6öç7B&Wf—6&ÆTFW6–vä6öçG&7G2ÒæWr6WB…°¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Öæ–ÖF–öâÖ6öçG&7Bæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö'BÖF—&V7F–öâæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö76WBÖFV6ö×÷6—F–öâæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö6ö×WF—F—fR×&W6V&6‚æÖBrÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×ÖFFÖ&–æF–ærÖÖG&—‚æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö–æf÷&ÖF–öâ×&–÷&—G’æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"××Æ–W"ÖW‡W&–Væ6Ræ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"××&W7öç6—fRÖ6öçG&7Bæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"××V’ÖFW6–vâ×7—7FVÒæ§6öâp¢Ò“°¢6öç7BF&vWEF‡2ÒµÓ°¢6öç7B&Wf—6–öä76W'F–öä–G2ÒæWr6WB‚“°¢f÷"†6öç7B¶–æFW‚Â6†ævUÒöb3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2æVçG&–W2‚’’°¢76W'DW†7D¶W•6WB†6†ævRÂ²v–BrÂw&WVW7BrÂvffV7FVDvöÆFVäÖ7FW'2rÂwF&vWEF‡2rÂw&WV—&VD76WG2rÂw7WW'6VFW476W'F–öç2rÂv66WFæ6T76W'F–öç2uÒÂ&÷VæBr&WVW7FVB6†ævRG¶–æFW‚²Ö“°¢76W'B†6†ævRæ–BÓÓÒU4U"Õ3"Õ$UbÒGµ7G&–ær†–æFW‚²’çE7F'Bƒ2Âsr—ÖÂ&÷VæBr&WVW7FVB6†ævR”BG¶–æFW‚²Ò—2æ÷B6æöæ–6Æ“°¢6öç7B&WVW7D6†&7FW'2ÒG—Vöb6†ævRç&WVW7BÓÓÒw7G&–ærrò²ââæ6†ævRç&WVW7EÒæf–ÇFW"†6†&7FW"ÓâõÇ2÷RçFW7B†6†&7FW"’’¢µÓ°¢76W'B‡G—Vöb6†ævRç&WVW7BÓÓÒw7G&–ærrbb6†ævRç&WVW7BÓÓÒ6†ævRç&WVW7BçG&–Ò‚’bb&WVW7D6†&7FW'2æÆVæwF‚ãÒ2bb6†ævRç&WVW7BæÆVæwF‚ÃÒSbbõµÇ´ÇÕÇ´çÕÒ÷RçFW7B†6†ævRç&WVW7B’bbõµÇSÕÇSeÇSveÒòçFW7B†6†ævRç&WVW7B’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ—2æ÷B6öæ7&WFR&÷VæFVB7FFVÖVçF“°¢76W'B„'&’æ—4'&’†6†ævRæffV7FVDvöÆFVäÖ7FW'2’bb6†ævRæffV7FVDvöÆFVäÖ7FW'2æÆVæwF‚ãÒbb6†ævRæffV7FVDvöÆFVäÖ7FW'2æÆVæwF‚ÃÒ‚bb¥4ôâç7G&–æv–g’†6†ævRæffV7FVDvöÆFVäÖ7FW'2’ÓÓÒ¥4ôâç7G&–æv–g’…²ââææWr6WB†6†ævRæffV7FVDvöÆFVäÖ7FW'2•Òç6÷'B‚’’bb6†ævRæffV7FVDvöÆFVäÖ7FW'2æWfW'’†–BÓâvÕ6WBæ†2†–B’’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ†2â–çfÆ–B÷"æöæ6æöæ–6ÂvöÆFVâÖ7FW"6WF“°¢76W'B„'&’æ—4'&’†6†ævRçF&vWEF‡2’bb6†ævRçF&vWEF‡2æÆVæwF‚ãÒbb6†ævRçF&vWEF‡2æÆVæwF‚ÃÒCbb6†ævRçF&vWEF‡2æWfW'’†—5v—F†–å3%&Wf—6–öä†&æW757G&–ætÆ–Ö—B’bb¥4ôâç7G&–æv–g’†6†ævRçF&vWEF‡2’ÓÓÒ¥4ôâç7G&–æv–g’…²ââæ6†ævRçF&vWEF‡5Òç6÷'B‚’’bbæWr6WB†6†ævRçF&vWEF‡2’ç6—¦RÓÓÒ6†ævRçF&vWEF‡2æÆVæwF‚Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒF&vWBF‡2×W7B&R6÷'FVBæöâÖV×G’W†7B6WBv—F‚BÖ÷7B#C6†&7FW'2W"F†“°¢76W'B„'&’æ—4'&’†6†ævRç&WV—&VD76WG2’bb6†ævRç&WV—&VD76WG2æÆVæwF‚ÃÒ#bb¥4ôâç7G&–æv–g’†6†ævRç&WV—&VD76WG2’ÓÓÒ¥4ôâç7G&–æv–g’…²ââæ6†ævRç&WV—&VD76WG5Òç6÷'B‚’’bbæWr6WB†6†ævRç&WV—&VD76WG2’ç6—¦RÓÓÒ6†ævRç&WV—&VD76WG2æÆVæwF‚Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ&WV—&VB76WG2×W7B&R6÷'FVBVæ—VR&÷VæFVB6WF“°¢76W'B„¥4ôâç7G&–æv–g’†6†ævRç7WW'6VFW476W'F–öç2’ÓÓÒ¥4ôâç7G&–æv–g’…µÒ’Â&÷VæBr6ææ÷B7WW'6VFRâ76W'F–öâ&Vf÷&Rç’&Wf—6–öâ66WFæ6RW†—7G6“°¢f÷"†6öç7B76WBöb6†ævRç&WV—&VD76WG2’°¢76W'B‚õæ76WG5Âõ´Õ¦×£Ó•òâòÕÒµÂâƒó§vV'ÇæwÇ7fr’BòçFW7B†76WB’bb76WBç7Æ—B‚ròr’ç6öÖR‡6VvÖVçBÓâ6VvÖVçBÇÂ6VvÖVçBÓÓÒrârÇÂ6VvÖVçBÓÓÒrâârÇÂ6VvÖVçBç7F'G5v—F‚‚râr’’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ6öçF–ç2âVç6fR÷"Vç7W÷'FVB&WV—&VB76WC¢G¶76WGÖ“°¢76W'B†6†ævRçF&vWEF‡2æ–æ6ÇVFW2†7FWB÷3"övöÆFVâÖÖ7FW"×òG¶76WGÖ’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ&WV—&VB76WB—2æ÷BöæRöb—G2W†7BF&vWBF‡3¢G¶76WGÖ“°¢Ð¢6öç7BF&vWFVD–ÖvT76WG2Ò6†ævRçF&vWEF‡0¢æf–ÇFW"†f–ÆRÓâõç7FWEÂ÷3%ÂövöÆFVâÖÖ7FW"×Âö76WG5ÂòâµÂâƒó§vV'ÇæwÇ7fr’BòçFW7B†f–ÆR’¢æÖ†f–ÆRÓâf–ÆRç6Æ–6R‚w7FWB÷3"övöÆFVâÖÖ7FW"×òræÆVæwF‚’¢ç6÷'B‚“°¢76W'B„¥4ôâç7G&–æv–g’†6†ævRç&WV—&VD76WG2’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWFVD–ÖvT76WG2’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ×W7BFV6Æ&RWfW'’æBöæÇ’&Wf—6VB&÷WFR–ÖvR76WF“°¢–b†6†ævRç&WV—&VD76WG2æÆVæwF‚’76W'B†6†ævRçF&vWEF‡2æ–æ6ÇVFW2‚w7FWB÷3"övöÆFVâÖÖ7FW"×ö76WBÖÖæ–fW7Bæ§6öâr’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ&Wf—6W2–ÖvR'—FW2v—F†÷WBF†R76WBÖæ–fW7F“°¢76W'B„'&’æ—4'&’†6†ævRæ66WFæ6T76W'F–öç2’bb6†ævRæ66WFæ6T76W'F–öç2æÆVæwF‚ãÒbb6†ævRæ66WFæ6T76W'F–öç2æÆVæwF‚ÃÒ#Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒÆ6·2&÷VæFVBÖ6†–æRÖ6†V6¶&ÆR66WFæ6R76W'F–öç6“°¢f÷"†6öç7B¶76W'F–öä–æFW‚Â7&—FW&–öåÒöb6†ævRæ66WFæ6T76W'F–öç2æVçG&–W2‚’’°¢76W'B†7&—FW&–öâbbG—Vöb7&—FW&–öâÓÓÒvö&¦V7Brbb'&’æ—4'&’†7&—FW&–öâ’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ76W'F–öâG¶76W'F–öä–æFW‚²Ò—2–çfÆ–F“°¢6öç7B6öÖÖöâÒ²v–BrÂwG—RrÂvvöÆFVäÖ7FW"uÓ°¢6öç7BW‡V7FVD¶W—2Ò7&—FW&–öâçG—RÓÓÒtDôÕõ$T5EôDTÅDrò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂw&÷W'G’rÂv÷W&F÷"rÂwF‡&W6†öÆBuÐ¢¢7&—FW&–öâçG—RÓÓÒtDôÕõ5E”ÄUôDTÅDrò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂw&÷W'G’rÂv÷W&F÷"rÂwF‡&W6†öÆBuÐ¢¢7&—FW&–öâçG—RÓÓÒu$ô•õ•„TÅôDTÅDrò²ââæ6öÖÖöâÂw&Vv–öârÂv6†ævVE—†VÅ&F–òrÂvÖVä'6öÇWFT6†ææVÄFVÇFuÐ¢¢7&—FW&–öâçG—RÓÓÒuDU…EôU„5Brò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂvW‡V7FVBuÐ¢¢7&—FW&–öâçG—RÓÓÒtTÄTÔTåEõd•4”$ÄRrò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂvÖ–æ–×VÔ&VuÐ¢¢çVÆÃ°¢76W'B†W‡V7FVD¶W—2Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ76W'F–öâG¶76W'F–öä–æFW‚²Ò†2âVç7W÷'FVBG—V“°¢76W'DW†7D¶W•6WB†7&—FW&–öâÂW‡V7FVD¶W—2Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ76W'F–öâG¶76W'F–öä–æFW‚²Ö“°¢76W'B†7&—FW&–öâæ–BÓÓÒG¶6†ævRæ–GÒÔGµ7G&–ær†76W'F–öä–æFW‚²’çE7F'Bƒ"Âsr—Öbb&Wf—6–öä76W'F–öä–G2æ†2†7&—FW&–öâæ–B’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ76W'F–öâ”B—2æöâÖ6æöæ–6Â÷"GWÆ–6FVF“°¢&Wf—6–öä76W'F–öä–G2æFB†7&—FW&–öâæ–B“°¢76W'B†6†ævRæffV7FVDvöÆFVäÖ7FW'2æ–æ6ÇVFW2†7&—FW&–öâævöÆFVäÖ7FW"’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ76W'F–öâF&vWG2âVæFV6Æ&VBvöÆFVâÖ7FW&“°¢–b†7&—FW&–öâçG—RÓÒu$ô•õ•„TÅôDTÅDr’°¢76W'B†—46æöæ–6Å3%&Wf—6–öå6VÆV7F÷"†7&—FW&–öâç6VÆV7F÷"’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ76W'F–öâ6VÆV7F÷"—2Vç66÷VBÂÖÆf÷&ÖVB÷"Vç6fV“°¢Ð¢–b†7&—FW&–öâçG—RÓÓÒtDôÕõ$T5EôDTÅDr’°¢6öç7BF—&V7F–öæÅF‡&W6†öÆBÒ7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôuDRrò7&—FW&–öâçF‡&W6†öÆBâ¢7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôÅDRrò7&—FW&–öâçF‡&W6†öÆBÂ¢7&—FW&–öâçF‡&W6†öÆBâ°¢76W'B…²wv–GF‚rÂv†V–v‡BrÂw‚rÂw’uÒæ–æ6ÇVFW2†7&—FW&–öâç&÷W'G’’bb²tDTÅDôuDRrÂtDTÅDôÅDRrÂt%5ôDTÅDôuDRuÒæ–æ6ÇVFW2†7&—FW&–öâæ÷W&F÷"’bbçVÖ&W"æ—4f–æ—FR†7&—FW&–öâçF‡&W6†öÆB’bbÖF‚æ'2†7&—FW&–öâçF‡&W6†öÆB’ÃÒ3$7&—FW&–öäÖ†–×VÔÖvæ—GVFR†7&—FW&–öâ’bbF—&V7F–öæÅF‡&W6†öÆBÂ&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒDôÒ&V7FævÆR76W'F–öâ6öçG&7B—2–çfÆ–BÂf–Ww÷'BÖ–×÷76–&ÆR÷"f7V÷W6“°¢ÒVÇ6R–b†7&—FW&–öâçG—RÓÓÒtDôÕõ5E”ÄUôDTÅDr’°¢76W'B…²vföçB×6—¦RrÂv6öÆ÷"rÂv&6¶w&÷VæBÖ6öÆ÷"rÂv÷6—G’uÒæ–æ6ÇVFW2†7&—FW&–öâç&÷W'G’’bb²tDTÅDôuDRrÂtDTÅDôÅDRrÂt%5ôDTÅDôuDRrÂt4„ätTBrÂteDU%ôUTÅ2uÒæ–æ6ÇVFW2†7&—FW&–öâæ÷W&F÷"’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒDôÒ7G–ÆR76W'F–öâ&÷W'G’ö÷W&F÷"—2–çfÆ–F“°¢6öç7BçVÖW&–57G–ÆRÒ²vföçB×6—¦RrÂv÷6—G’uÒæ–æ6ÇVFW2†7&—FW&–öâç&÷W'G’“°¢6öç7BçVÖW&–4÷W&F÷"Ò²tDTÅDôuDRrÂtDTÅDôÅDRrÂt%5ôDTÅDôuDRuÒæ–æ6ÇVFW2†7&—FW&–öâæ÷W&F÷"“°¢6öç7BF—&V7F–öæÅF‡&W6†öÆBÒ7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôuDRrò7&—FW&–öâçF‡&W6†öÆBâ¢7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôÅDRrò7&—FW&–öâçF‡&W6†öÆBÂ¢7&—FW&–öâæ÷W&F÷"ÓÓÒt%5ôDTÅDôuDRrò7&—FW&–öâçF‡&W6†öÆBâ¢G'VS°¢76W'B†çVÖW&–57G–ÆRÓÓÒçVÖW&–4÷W&F÷"bb†çVÖW&–4÷W&F÷"òçVÖ&W"æ—4f–æ—FR†7&—FW&–öâçF‡&W6†öÆB’bbÖF‚æ'2†7&—FW&–öâçF‡&W6†öÆB’ÃÒ3$7&—FW&–öäÖ†–×VÔÖvæ—GVFR†7&—FW&–öâ’bbF—&V7F–öæÅF‡&W6†öÆB¢†7&—FW&–öâæ÷W&F÷"ÓÓÒt4„ätTBrò7&—FW&–öâçF‡&W6†öÆBÓÓÒçVÆÂ¢—46æöæ–6Ä6‡&öÖ—VÔ6ö×WFVD6öÆ÷"†7&—FW&–öâçF‡&W6†öÆB’’’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒDôÒ7G–ÆR76W'F–öâF‡&W6†öÆB—2–æ6ö×F–&ÆRÂæöæ6æöæ–6Â÷"f7V÷W6“°¢ÒVÇ6R–b†7&—FW&–öâçG—RÓÓÒu$ô•õ•„TÅôDTÅDr’°¢76W'DW†7D¶W•6WB†7&—FW&–öâç&Vv–öâÂ²w‚rÂw’rÂwv–GF‚rÂv†V–v‡BuÒÂ&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ$ô’&Vv–öæ“°¢6öç7B²‚Â’Âv–GF‚Â†V–v‡BÒÒ7&—FW&–öâç&Vv–öã°¢76W'B…·‚Â’Âv–GF‚Â†V–v‡EÒæWfW'’„çVÖ&W"æ—4f–æ—FR’bb‚ãÒbb’ãÒbbv–GF‚âbb†V–v‡Bâbb‚²v–GF‚ÃÒbb’²†V–v‡BÃÒÂ&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ$ô’—2÷WG6–FRæ÷&ÖÆ—¦VB&÷VæG6“°¢f÷"†6öç7B¶ÖWG&–2Â&÷VæG5Òöbµ²v6†ævVE—†VÅ&F–òrÂ7&—FW&–öâæ6†ævVE—†VÅ&F–õÒÂ²vÖVä'6öÇWFT6†ææVÄFVÇFrÂ7&—FW&–öâæÖVä'6öÇWFT6†ææVÄFVÇFÕÒ’76W'B„'&’æ—4'&’†&÷VæG2’bb&÷VæG2æÆVæwF‚ÓÓÒ"bb&÷VæG2æWfW'’„çVÖ&W"æ—4f–æ—FR’bb&÷VæG5³ÒãÒbb&÷VæG5³ÒÃÒ&÷VæG5³Òbb&÷VæG5³ÒÃÒ†ÖWG&–2ÓÓÒv6†ævVE—†VÅ&F–òrò¢#SR’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ$ô’G¶ÖWG&–7Ò&÷VæG2&R–çfÆ–F“°¢76W'B†7&—FW&–öâæ6†ævVE—†VÅ&F–õ³ÒâÇÂ7&—FW&–öâæÖVä'6öÇWFT6†ææVÄFVÇF³ÒâÂ&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ$ô’76W'F–öâ—2f7V÷W6“°¢ÒVÇ6R–b†7&—FW&–öâçG—RÓÓÒuDU…EôU„5Br’°¢76W'B†—46æöæ–6Å3$W†7EFW‡B†7&—FW&–öâæW‡V7FVB’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒW†7BFW‡B—2–çfÆ–B÷"æöæ6æöæ–6Æ“°¢ÒVÇ6R–b†7&—FW&–öâçG—RÓÓÒtTÄTÔTåEõd•4”$ÄRr’°¢76W'B„çVÖ&W"æ—4f–æ—FR†7&—FW&–öâæÖ–æ–×VÔ&V’bb7&—FW&–öâæÖ–æ–×VÔ&VãÒcBbb7&—FW&–öâæÖ–æ–×VÔ&VÃÒ3$7&—FW&–öäÖ†–×VÔÖvæ—GVFR†7&—FW&–öâ’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒf—6–&ÆRÖ&VF‡&W6†öÆB—2–çfÆ–B÷"Æ&vW"F†â—G2&Wf–WvVBf–Ww÷'F“°¢Ð¢Ð¢76W'B„¥4ôâç7G&–æv–g’…²ââææWr6WB†6†ævRæ66WFæ6T76W'F–öç2æÖ†7&—FW&–öâÓâ7&—FW&–öâævöÆFVäÖ7FW"’•Òç6÷'B‚’’ÓÓÒ¥4ôâç7G&–æv–g’†6†ævRæffV7FVDvöÆFVäÖ7FW'2’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒFöW2æ÷B†fR66WFæ6R6÷fW&vRf÷"WfW'’æBöæÇ’ffV7FVBvöÆFVâÖ7FW&“°¢f÷"†6öç7Bf–ÆRöb6†ævRçF&vWEF‡2’°¢6öç7B—5&÷WFT6öçFVçBÒõç7FWEÂ÷3%ÂövöÆFVâÖÖ7FW"×Âõ´Õ¦×£Ó•òâòÕÒµÂâƒó¦‡FÖÇÆ777Æ§7Æ§6öçÇvV'ÇæwÇ7fr’BòçFW7B†f–ÆR“°¢6öç7B—4FW6–vä6öçG&7BÒ&Wf—6&ÆTFW6–vä6öçG&7G2æ†2†f–ÆR“°¢6öç7B6VvÖVçG2Òf–ÆRç7Æ—B‚ròr“°¢76W'B‚†—5&÷WFT6öçFVçBÇÂ—4FW6–vä6öçG&7B’bb6VvÖVçG2æWfW'’‡6VvÖVçBÓâ6VvÖVçBbb6VvÖVçBÓÒrârbb6VvÖVçBÓÒrâârbb6VvÖVçBç7F'G5v—F‚‚râr’’bbf–ÆRæ–æ6ÇVFW2‚uÅÂr’bbf–ÆRæ–æ6ÇVFW2‚r‚r’bbf–ÆRæ–æ6ÇVFW2‚r’r’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒ6öçF–ç2â÷WBÖöb×66÷RFƒ¢G¶f–ÆWÖ“°¢76W'B‚²ââäö&¦V7BçfÇVW2‡3%&Wf–WtWf–FVæ6UF‡2’Âââäö&¦V7BçfÇVW2‡3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’Âââç3%fW&–f–6F–öåF‡5Òæ–æ6ÇVFW2†f–ÆR’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒGFV×G2Fò×WFFR&Wf–WrWf–FVæ6R÷"G'W7FVBfW&–f–6F–öã¢G¶f–ÆWÖ“°¢F&vWEF‡2çW6‚†f–ÆR“°¢Ð¢76W'B†6†ævRçF&vWEF‡2ç6öÖR†f–ÆRÓâf–ÆRç7F'G5v—F‚‚w7FWB÷3"övöÆFVâÖÖ7FW"×òr’bbf–ÆRæVæG5v—F‚‚r÷&Wf–WrÖÖæ–fW7Bæ§6öâr’bbf–ÆRæVæG5v—F‚‚rö76WBÖÖæ–fW7Bæ§6öâr’’Â&÷VæBr&WVW7FVB6†ævRG¶6†ævRæ–GÒÆ6·2&VæFW&VB&÷WFR÷"76WBF&vWF“°¢Ð¢6öç7BW†7EF&vWEF‡2Ò²ââææWr6WB‡F&vWEF‡2•Òç6÷'B‚“°¢–b†W†7EF&vWEF‡2ç6öÖR†f–ÆRÓâf–ÆRç7F'G5v—F‚‚w7FWB÷3"övöÆFVâÖÖ7FW"×òr’bbf–ÆRæVæG5v—F‚‚r÷&Wf–WrÖÖæ–fW7Bæ§6öâr’’’°¢76W'B†W†7EF&vWEF‡2æ–æ6ÇVFW2‚w7FWB÷3"övöÆFVâÖÖ7FW"×÷&Wf–WrÖÖæ–fW7Bæ§6öâr’Âw&÷VæBr&÷WFR&Wf—6–öâ×W7BÇ6òF&vWBF†RW†7B6W'fVBÖf–ÆR&Wf–WrÖæ–fW7Br“°¢Ð¢6öç7B&WVW7E6†#SbÒ6†#Sc¢G·6†#Sd6æöæ–6Â‡3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2—Ö°¢6öç7B&Wf—6–öäÖW76vRÒ3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæÖW76vS°¢6öç7B&Wf—6–öäÖW76vT6†&7FW'2ÒG—Vöb&Wf—6–öäÖW76vRÓÓÒw7G&–ærrò²ââç&Wf—6–öäÖW76vUÒæf–ÇFW"†6†&7FW"ÓâõÇ2÷RçFW7B†6†&7FW"’’¢µÓ°¢76W'B‡G—Vöb&Wf—6–öäÖW76vRÓÓÒw7G&–ærrbb&Wf—6–öäÖW76vRÓÓÒ&Wf—6–öäÖW76vRçG&–Ò‚’bb&Wf—6–öäÖW76vT6†&7FW'2æÆVæwF‚ãÒ2bb&Wf—6–öäÖW76vRæÆVæwF‚ÃÒSbbõµÇ´ÇÕÇ´çÕÒ÷RçFW7B‡&Wf—6–öäÖW76vR’bbõµÇSÕÇS…ÇS%ÇS5ÇSRÕÇSeÇSveÒòçFW7B‡&Wf—6–öäÖW76vR’Âw&÷VæBr6÷W&6RÖW76vR—2æ÷B&÷VæFVB6öæ7&WFRW6W"7FFVÖVçBr“°¢76W'B‡3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæÖW76vU6†#SbÓÓÒ6†#Sc¢G·6†#SeFW‡B‡&Wf—6–öäÖW76vR—Öbb3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2æWfW'’†6†ævRÓâ&Wf—6–öäÖW76vRæ–æ6ÇVFW2†6†ævRç&WVW7B’’Âw&÷VæBr6÷W&6RÖW76vRFöW2æ÷BW†7FÇ’6öçF–âæB&–æBWfW'’6öæ7&WFR&Wf—6–öâ7FFVÖVçBr“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6–öä6öçG&öÂç&Wf—6–öå&WVW7B’ÓÓÒ¥4ôâç7G&–æv–g’‡²6÷VçC¢3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2æÆVæwF‚Â&WVW7E6†#SbÂF&vWEF‡3¢W†7EF&vWEF‡2Ò’Âw&÷VæB3b&Wf—6–öâ&WVW7BFöW2æ÷BW†7FÇ’&–æBF†R&÷VæBr6öæ7&WFR6†ævW2r“° ¢6öç7B÷Væ–æt6öÖÖ—BÒ3%&Wf—6–öä÷Væ–æt6öÖÖ—C°¢76W'B†÷Væ–æt6öÖÖ—Bbbf—'7DFD6öÖÖ—B‡3%&Wf—6–öäFV6—6–öäÆö6µF‚’ÓÓÒ÷Væ–æt6öÖÖ—BÂw&÷VæB3b6öçG&öÂæB&÷VæBr&Wf—6–öâÆö6²vW&Ræ÷Bf—'7BFFVBFöÖ–6ÆÇ’r“°¢6öç7B&VG”6öÖÖ—BÒv—B…²w&Wb×'6RrÂG¶÷Væ–æt6öÖÖ—GÕæÒ“°¢6öç7B&VG•G&VRÒv—B…²w&Wb×'6RrÂG·&VG”6öÖÖ—GÕç·G&VWÖÒ“°¢76W'DW†7E6–ævÆU&VçB†÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂw&÷VæB3b&Wf—6–öâ÷Væ–ærr“°¢76W'B‡3$–æ—F–Å&VG”66W72bb3$–æ—F–Å&VG”66W72çVæF–æu&WVW7Bbb&VG”6öÖÖ—BÓÓÒ3$–æ—F–Å&VG”66W72æFV6—6–öå&VG”6öÖÖ—BÂw&÷VæB3b&VçB—2æ÷BF†RÆFW7BgVÆÇ’fW&–f–VBÆ—fRÖ66W72$TE’7FFRr“°¢6öç7B&VG”WF†÷&—G’Ò§6öäB‡&VG”6öÖÖ—BÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr“°¢76W'B‡&VG”WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&W—$6öçG&öÅF‚bb&VG”WF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UrrÂw&÷VæB3b&VçB—2æ÷BF†RW†7B&÷VæB3B$TE’7FFR6†÷vâFòF†RW6W"r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6–öäFV6—6–öäÆö6²æ&6R’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’bb¥4ôâç7G&–æv–g’‡3%&Wf—6–öä6öçG&öÂæVçG'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’Âw&÷VæB3b6öçG&öÂ÷"&÷VæBrÆö6²FöW2æ÷B&–æBF†RW†7B$TE’&VçBr“°¢6öç7BW†7E&Wf—6–öäWF†÷&—¦F–öâÒ$UTU5Eõ3%õôtÕõ$Ud•4”ôã¢G·&VG”6öÖÖ—GÓ¢G·&VG•G&VWÓ¢G·&WVW7E6†#SgÖ°¢76W'B‡&Wf—6–öäÖW76vRæ–æ6ÇVFW2†W†7E&Wf—6–öäWF†÷&—¦F–öâ’Âw&÷VæBr6÷W&6RÖW76vRÆ6·2F†RW†7B$TE’f–ævW'&–çBæB7G'V7GW&VB&WVW7FVD6†ævW2F–vW7BWF†÷&—¦F–öâr“°¢76W'B‡3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæWF†÷&—¦F–öä6öFRÓÓÒu$UTU5Eõ3%õôtÕõ$Ud•4”ôârbb3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæ–æfW'&VBÓÓÒfÇ6RÂw&÷VæBr&Wf—6–öâ6FVv÷'’v2–æfW'&VB÷"Æ6·2F†RW†7B6fRWF†÷&—¦F–öâ6öFRr“°¢6öç7Bö'6W'fVDBÒFFRç'6R‡3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBóòrr“°¢6öç7B&VG”6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ&VG”6öÖÖ—EÒ’“°¢6öç7B÷Væ–æt6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ÷Væ–æt6öÖÖ—EÒ’“°¢6öç7Bf—'7E&VF&6²Ò3$–æ—F–Å&VG”66W72æ7W'&VçE&VF&6³°¢6öç7Bf—'7E&WVW7BÒ3$–æ—F–Å&VG”66W72æ7W'&VçE&WVW7C°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6–öäFV6—6–öäÆö6²ç&Wf–Wt66W72’ÓÓÒ¥4ôâç7G&–æv–g’‡²&WVW7C¢²Fƒ¢3$–æ—F–Å&VG”66W72æ7W'&VçE&WVW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3$–æ—F–Å&VG”66W72æ7W'&VçE&WVW7EF‡ÖÒ’ÒÂ&VF&6³¢²Fƒ¢3$–æ—F–Å&VG”66W72æ7W'&VçE&VF&6µF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3$–æ—F–Å&VG”66W72æ7W'&VçE&VF&6µF‡ÖÒ’ÒÒ’Âw&÷VæBrFöW2æ÷B&–æBF†RW†7BÆFW7BÆ—fR&Wf–WrÖ66W72&ööbr“°¢6öç7B6æöæ–6Äö'6W'fVDBÒçVÖ&W"æ—4f–æ—FR†ö'6W'fVDB’òæWrFFR†ö'6W'fVDB’çFô•4õ7G&–ær‚’ç&WÆ6R‚rã¢rÂu¢r’¢rs°¢76W'B†6æöæ–6Äö'6W'fVDBÓÓÒ3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBbbö'6W'fVDBãÒFFRç'6R†f—'7E&VF&6²çfW&–f–VD‡GGçfW&–f–VDB’bbö'6W'fVDBãÒ&VG”6öÖÖ—GFVDBbbö'6W'fVDBÃÒFFRç'6R†f—'7E&WVW7Bç&Wf–WrçFV×÷&'”66W72æW‡—&W4B’bbö'6W'fVDBÃÒ÷Væ–æt6öÖÖ—GFVDBbb÷Væ–æt6öÖÖ—GFVDBÒö'6W'fVDBÃÒ#B¢c¢c¢Âw&÷VæBr&Wf—6–öâF–ÖR—2÷WG6–FRF†RW†7BÆ—fRÖ66W72$TE’æB#BÖ†÷W"÷Væ–ær–çFW'fÂr“°¢76W'B‡3%&Wf—6–öäFV6—6–öäÆö6²æ7&VFVDBÓÓÒ3%&Wf—6–öäFV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBç6Æ–6RƒÂ’bb3%&Wf—6–öä6öçG&öÂæ7&VFVDBÓÓÒ3%&Wf—6–öäFV6—6–öäÆö6²æ7&VFVDBÂw&÷VæB3b6öçG&öÂæB&÷VæBr&Wf—6–öâFFW2F–ffW"r“°¢76W'DW†7D6†ævVEF‡2‡&VG”6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂW‡V7FVE3%&Wf—6–öä÷Væ–æuw&—FW2Âw&÷VæB3bFöÖ–2W6W"×&Wf—6–öâ÷Væ–ærr“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%&Wf—6–öä6öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%&Wf—6–öäFV6—6–öäÆö6µF‚Â÷Væ–æt6öÖÖ—B“°¢76W'B‡3%&Wf—6–öä6öçG&öÂçW6W$FV6—6–öäÆö6²çF‚ÓÓÒ3%&Wf—6–öäFV6—6–öäÆö6µF‚bb3%&Wf—6–öä6öçG&öÂçW6W$FV6—6–öäÆö6²æ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·3%&Wf—6–öäFV6—6–öäÆö6µF‡ÖÒ’Âw&÷VæB3bFöW2æ÷B&–æBF†R–Ö×WF&ÆR&÷VæBr&Wf—6–öâÆö6²r“°¢6öç7BW‡V7FVDÆÆ÷vVEw&—FW2Ò²ââæW‡V7FVE3%&Wf—6–öä÷Væ–æuw&—FW2Â3%&Wf—6VE$6öçG&öÅF‚Â3%&Wf—6VD&÷fÄÆö6µF‚Â3%6V6öæE&Wf—6–öä6öçG&öÅF‚Â3%6V6öæE&Wf—6–öäÆö6µF‚ÂââæW†7EF&vWEF‡2Âââäö&¦V7BçfÇVW2‡3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’Âââç3%v÷&¶fÆ÷u6¶vUw&—FUF‡2‚s"rÂG'VR’Âââäö&¦V7BçfÇVW2‡3%v÷&¶fÆ÷tFÖ—76–öåF‡2‚s"r’’Âââç3$66W75&VæWvÅw&—FUGFW&ç2‚s"r•Ó°¢6öç7BW‡V7FVDf÷&&–FFVåw&—FW2Ò²ââææWr6WB…²ââæW‡V7FVE3%&W—$f÷&&–FFVåw&—FW2Â3%$6öçG&öÅF‚Â3%W6W$FV6—6–öäÆö6µF‚Âââäö&¦V7BçfÇVW2‡3%&Wf–WtWf–FVæ6UF‡2’Âââç3%fW&–f–6F–öåF‡5Ò•Ó°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6–öä6öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDÆÆ÷vVEw&—FW2’bb¥4ôâç7G&–æv–g’‡3%&Wf—6–öä6öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf÷&&–FFVåw&—FW2’Âw&÷VæB3bw&—FR&÷VæF'’—2æ÷BF†RW†7B&Wf—6–öâÂWf–FVæ6RæBÖ—'&÷"6WBr“°¢76W'B‡3%&Wf—6–öä6öçG&öÂæVçG'•v÷&¶fÆ÷ræ6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb3%&Wf—6–öä6öçG&öÂæVçG'•v÷&¶fÆ÷rçG&VRÓÓÒ&VG•G&VRÂw&÷VæB3bVçG'’v÷&¶fÆ÷rFöW2æ÷BF&vWBF†RW†7B$TE’&VçBr“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R‡3%&Wf—6–öä6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæB3bVçG'’r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂW‡V7FVE&÷VæC3e&Wf—6–öäFö7VÖVçEFW‡BÂw&÷VæB3b&Wf—6–öâ÷Væ–ærFö7VÖVçG2r“°¢f÷"†6öç7Bf–ÆRöbö&¦V7BçfÇVW2‡3%&Wf–WtWf–FVæ6UF‡2’’76W'DFFVDöæ6TæEVæ6†ævVB†f–ÆRÂf—'7DFD6öÖÖ—B†f–ÆR’“°¢76W'DæõF„6†ævW56–æ6R‡3%&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â°¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö66WFæ6RÖÖG&—‚×&÷VæBÓæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×ÖfV6–&–Æ—G’ÖVF—Bæ§6öâp¢ÒÂw&÷VæB66WFæ6RæBfV6–&–Æ—G’Wf–FVæ6R–Ö×WF&–Æ—G’r“° ¢6öç7B7F—fT66WFæ6T7&—FW&–ÒFW&—fT7F—fT66WFæ6T7&—FW&–…µÒÂ3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2Âw&÷VæBrr“°¢6öç7B&Wf—6–öå&Vf—‚ÒfW&–g•3%&Wf–WtWf–FVæ6U&Vf—‚‡°¢F‡3¢3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2À¢Wf–FVæ6U&÷VæC¢s"rÀ¢6†ævT6öçG&öÅFƒ¢3%&Wf—6–öä6öçG&öÅF‚À¢÷Væ–æt6öÖÖ—BÀ¢W†7D6öçFVçE&VçC¢÷Væ–æt6öÖÖ—BÀ¢6öçFVçDÖæ–fW7D÷F–öç3¢²FVÇF&6T6öÖÖ—C¢÷Væ–æt6öÖÖ—BÂ&WV—&TgVÆÅ&W—$FVÇF¢fÇ6RÂW†7E&Wf—6–öåF‡3¢W†7EF&vWEF‡2ÒÀ¢&Wf—6–öä6†ævW3¢3%&Wf—6–öäFV6—6–öäÆö6²ç&WVW7FVD6†ævW2À¢7F—fT66WFæ6T7&—FW&–À¢&Wf—6–öä&6VÆ–æS¢²6öÖÖ—C¢3%&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÂG&VS¢3%&Wf–Wu&Vf—‚çF&vWEG&VRÒÀ¢&Wf–÷W5&Wf—6–öäWf–FVæ6UF‡3¢çVÆÂÀ¢&WV—&TÆ—fUv÷&¶fÆ÷s¢G'VRÀ¢Æ&VÅ&Vf—ƒ¢u3"&Wf—6–öâ&÷VæB"p¢Ò“°¢6öç7B†VBÒv—B…²w&Wb×'6RrÂt„TBuÒ“°¢6öç7Bf—'7E7V66W76÷$÷Væ–ærÒ3%&Wf—6VE$÷Væ–æt6öÖÖ—Bóò3%6V6öæE&Wf—6–öä÷Væ–æt6öÖÖ—C°¢6öç7B&Wf—6–öäÆ–æVvT†VBÒf—'7E7V66W76÷$÷Væ–æròv—B…²w&Wb×'6RrÂG¶f—'7E7V66W76÷$÷Væ–æwÕæÒ’¢†VC°¢–b‚&Wf—6–öå&Vf—‚’°¢–b‡&Wf—6–öäÆ–æVvT†VBÓÒ÷Væ–æt6öÖÖ—B’°¢76W'B†v—B…²w&Wb×'6RrÂG·&Wf—6–öäÆ–æVvT†VGÕæÒ’ÓÓÒ÷Væ–æt6öÖÖ—BÂw&÷VæB3bW&Ö—G2W†7FÇ’öæR6öçFVçB6öÖÖ—B&Vf÷&R&÷VæB"7&—F–2Wf–FVæ6Rr“°¢FW&—fU3$6öçFVçDÖæ–fW7B‡&Wf—6–öäÆ–æVvT†VBÂ²FVÇF&6T6öÖÖ—C¢÷Væ–æt6öÖÖ—BÂ&WV—&TgVÆÅ&W—$FVÇF¢fÇ6RÂW†7E&Wf—6–öåF‡3¢W†7EF&vWEF‡2Ò“°¢Ð¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3e&Wf—6–öäFö7VÖVçEFW‡BÂw&÷VæB3b–â×&öw&W72&Wf—6–öâFö7VÖVçG2r“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—ƒ¢çVÆÂÓ°¢Ð¢76W'DæõF„6†ævW56–æ6R†÷Væ–æt6öÖÖ—BÂ&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—Bóò†VBÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæB3bÖ—'&÷'26†ævVB&Vf÷&R&Wf—6VB$TE’7F—fF–öâr“°¢–b‚&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—B’°¢6öç7BWf–FVæ6UF–ÂÒ&Wf—6–öå&Vf—‚ç&WVW7D6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ6ö×ÆWF–öä6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ§VFvT6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ7&—F–46öÖÖ—Bóò&Wf—6–öå&Vf—‚æfV6–&–Æ—G”VF—D6öÖÖ—Bóò&Wf—6–öå&Vf—‚æFÖ—76–öå&VF&6´6öÖÖ—Bóò&Wf—6–öå&Vf—‚æFÖ—76–öä6öÖÖ—Bóò&Wf—6–öå&Vf—‚ç6¶vT6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ66WFæ6T6öÖÖ—C°¢76W'B††VBÓÓÒWf–FVæ6UF–ÂÂw&÷VæB"Wf–FVæ6R×W7B&VÖ–âF†RW†7B7W'&VçBF–ÂVçF–ÂF†RæW‡BFVF–6FVBWf–FVæ6R7FWr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3e&Wf—6–öäFö7VÖVçEFW‡BÂw&÷VæB3b–â×&öw&W72Wf–FVæ6RFö7VÖVçG2r“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—‚Ó°¢Ð¢–b‡&Wf—6–öäÆ–æVvT†VBÓÓÒ&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—B’°¢76W'B†WF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôârÂw&÷VæB"FWÆ÷–ÖVçB&VF&6²6öÖÖ—B×W7B&VÖ–â–âF†R–â×&öw&W72&Wf—6–öâ7FFRVçF–ÂF†RFVF–6FVB$TE’7F—fF–öâr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3e&Wf—6–öäFö7VÖVçEFW‡BÂw&÷VæB3bFWÆ÷–ÖVçB×&VF&6²F–ÂFö7VÖVçG2r“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—‚Ó°¢Ð¢6öç7B&Wf—6VE&VG”6öÖÖ—BÒf—'7D6öÖÖ—DgFW$öå6–ævÆU&VçDÆ–æVvR‡&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—BÂ&Wf—6–öäÆ–æVvT†VBÂw&÷VæB3b&Wf—6VB$TE’Æ–æVvRr“°¢76W'B†v—B…²w&Wb×'6RrÂG·&Wf—6VE&VG”6öÖÖ—GÕæÒ’ÓÓÒ&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—BÂw&Wf—6VB3"$TE’7F—fF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R&÷VæB"FWÆ÷–ÖVçB&VF&6²r“°¢76W'DW†7D6†ævVEF‡2‡&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—BÂ&Wf—6VE&VG”6öÖÖ—BÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæB3b&Wf—6VB$TE’7F—fF–öâr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‡&Wf—6VE&VG”6öÖÖ—BÂW‡V7FVE&÷VæC3e&VG”Fö7VÖVçEFW‡BÂw&÷VæB3b&Wf—6VB$TE’Fö7VÖVçG2r“°¢f÷"†6öç7BVçG'’öb&Wf—6–öå&Vf—‚æ6öçFVçDÖæ–fW7B’76W'B†v—B…²w&Wb×'6RrÂ„TC¢G¶VçG'’çF‡ÖÒ’ÓÓÒVçG'’æ&Æö"Â&Wf—6VB$TE’6öçFVçBF–ffW'2g&öÒF†R&÷VæB"7&—F–2Ö&÷VæBÖæ–fW7C¢G¶VçG'’çF‡Ö“°¢f÷"†6öç7Bf–ÆRöbö&¦V7BçfÇVW2‡3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’’76W'DFFVDöæ6TæEVæ6†ævVB†f–ÆRÂf—'7DFD6öÖÖ—B†f–ÆR’“°¢6öç7B&VG”66W72ÒfW&–g•3%&VG”66W75&VæWvÇ2‡²&Wf–Wu&Vf—ƒ¢&Wf—6–öå&Vf—‚ÂWf–FVæ6UF‡3¢3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2ÂWf–FVæ6U&÷VæC¢s"rÂ7V66W76÷$÷Væ–æt6öÖÖ—C¢f—'7E7V66W76÷$÷Væ–ærÂÆ&VÃ¢u3"&Wf—6VB&Wf–Wr&÷VæB"rÒ“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂ&Wf—6VE&VG”6öÖÖ—BÂFV6—6–öå&VG”6öÖÖ—C¢&VG”66W72æFV6—6–öå&VG”6öÖÖ—BÂ&VG”66W72ÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—‚Ó°§Ð ¦6öç7B3%&Wf—6–öä†æFöfbÒfW&–g•3%&Wf—6–öä†æFöfb‚“°¦gVæ7F–öâfÆ–FFTFF—F–öæÅ&Wf—6–öå&WVW7G2†Æö6²Â6öæf–r’°¢76W'B„'&’æ—4'&’†Æö6²ç&WVW7FVD6†ævW2’bbÆö6²ç&WVW7FVD6†ævW2æÆVæwF‚ãÒbbÆö6²ç&WVW7FVD6†ævW2æÆVæwF‚ÃÒ#Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ×W7B&–æBöæRFòGvVçG’6öæ7&WFR&Wf—6–öâw&÷W6“°¢6öç7BvÕ6WBÒæWr6WB…²ttÓrÂttÓ"rÂttÓ2rÂttÓBrÂttÓRrÂttÓbrÂttÓrrÂttÓ‚uÒ“°¢6öç7BÆÄWf–FVæ6UF‡2ÒæWr6WB…°¢ââäö&¦V7BçfÇVW2‡3%&Wf–WtWf–FVæ6UF‡2’À¢ââäö&¦V7BçfÇVW2‡3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’À¢ââäö&¦V7BçfÇVW2‡3%6V6öæE&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’À¢ââäö&¦V7BçfÇVW2‡3%F†—&E&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’À¢ââç3%fW&–f–6F–öåF‡0¢Ò“°¢6öç7B&Wf—6&ÆT6öçG&7G2ÒæWr6WB…°¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Öæ–ÖF–öâÖ6öçG&7Bæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö'BÖF—&V7F–öâæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö76WBÖFV6ö×÷6—F–öâæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö6ö×WF—F—fR×&W6V&6‚æÖBrÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×ÖFFÖ&–æF–ærÖÖG&—‚æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"×Ö–æf÷&ÖF–öâ×&–÷&—G’æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"××Æ–W"ÖW‡W&–Væ6Ræ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"××&W7öç6—fRÖ6öçG&7Bæ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓB×GvVÇfR×67&VVâÖf–æÂÖÖö6·W2÷3"ÖvöÆFVâÖÖ7FW"××V’ÖFW6–vâ×7—7FVÒæ§6öâp¢Ò“°¢6öç7BF&vWEF‡2ÒµÓ°¢6öç7B76W'F–öä–G2ÒæWr6WB‚“°¢f÷"†6öç7B¶–æFW‚Â6†ævUÒöbÆö6²ç&WVW7FVD6†ævW2æVçG&–W2‚’’°¢76W'DW†7D¶W•6WB†6†ævRÂ²v–BrÂw&WVW7BrÂvffV7FVDvöÆFVäÖ7FW'2rÂwF&vWEF‡2rÂw&WV—&VD76WG2rÂw7WW'6VFW476W'F–öç2rÂv66WFæ6T76W'F–öç2uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7FVB6†ævRG¶–æFW‚²Ö“°¢76W'B†6†ævRæ–BÓÓÒU4U"Õ3"Õ$UbÕ"G¶6öæf–ræWf–FVæ6U&÷VæGÒÒGµ7G&–ær†–æFW‚²’çE7F'Bƒ2Âsr—ÖÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7FVB6†ævR”B—2æ÷B7FvR×7V6–f–2æB6æöæ–6Æ“°¢6öç7B6†'2ÒG—Vöb6†ævRç&WVW7BÓÓÒw7G&–ærrò²ââæ6†ævRç&WVW7EÒæf–ÇFW"†6†&7FW"ÓâõÇ2÷RçFW7B†6†&7FW"’’¢µÓ°¢76W'B‡G—Vöb6†ævRç&WVW7BÓÓÒw7G&–ærrbb6†ævRç&WVW7BÓÓÒ6†ævRç&WVW7BçG&–Ò‚’bb6†'2æÆVæwF‚ãÒ2bb6†ævRç&WVW7BæÆVæwF‚ÃÒSbbõµÇ´ÇÕÇ´çÕÒ÷RçFW7B†6†ævRç&WVW7B’bbõµÇSÕÇSeÇSveÒòçFW7B†6†ævRç&WVW7B’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒ—2æ÷B6öæ7&WFR&÷VæFVB7FFVÖVçF“°¢76W'B„'&’æ—4'&’†6†ævRæffV7FVDvöÆFVäÖ7FW'2’bb6†ævRæffV7FVDvöÆFVäÖ7FW'2æÆVæwF‚ãÒbb6†ævRæffV7FVDvöÆFVäÖ7FW'2æÆVæwF‚ÃÒ‚bb¥4ôâç7G&–æv–g’†6†ævRæffV7FVDvöÆFVäÖ7FW'2’ÓÓÒ¥4ôâç7G&–æv–g’…²ââææWr6WB†6†ævRæffV7FVDvöÆFVäÖ7FW'2•Òç6÷'B‚’’bb6†ævRæffV7FVDvöÆFVäÖ7FW'2æWfW'’†–BÓâvÕ6WBæ†2†–B’’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒvöÆFVâÖ7FW"6WB—2–çfÆ–B÷"æöæ6æöæ–6Æ“°¢76W'B„'&’æ—4'&’†6†ævRçF&vWEF‡2’bb6†ævRçF&vWEF‡2æÆVæwF‚ãÒbb6†ævRçF&vWEF‡2æÆVæwF‚ÃÒCbb6†ævRçF&vWEF‡2æWfW'’†—5v—F†–å3%&Wf—6–öä†&æW757G&–ætÆ–Ö—B’bb¥4ôâç7G&–æv–g’†6†ævRçF&vWEF‡2’ÓÓÒ¥4ôâç7G&–æv–g’…²ââæ6†ævRçF&vWEF‡5Òç6÷'B‚’’bbæWr6WB†6†ævRçF&vWEF‡2’ç6—¦RÓÓÒ6†ævRçF&vWEF‡2æÆVæwF‚Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒF&vWBF‡2&R–çfÆ–F“°¢f÷"†6öç7Bf–ÆRöb6†ævRçF&vWEF‡2’°¢6öç7B&÷WFRÒõç7FWEÂ÷3%ÂövöÆFVâÖÖ7FW"×Âõ´Õ¦×£Ó•òâòÕÒµÂâƒó¦‡FÖÇÆ777Æ§7Æ§6öçÇvV'ÇæwÇ7fr’BòçFW7B†f–ÆR“°¢76W'B‚‡&÷WFRÇÂ&Wf—6&ÆT6öçG&7G2æ†2†f–ÆR’’bbf–ÆRç7Æ—B‚ròr’æWfW'’‡6VvÖVçBÓâ6VvÖVçBbb6VvÖVçBÓÒrârbb6VvÖVçBÓÒrâârbb6VvÖVçBç7F'G5v—F‚‚râr’’bbf–ÆRæ–æ6ÇVFW2‚uÅÂr’bbf–ÆRæ–æ6ÇVFW2‚r‚r’bbf–ÆRæ–æ6ÇVFW2‚r’r’bbÆÄWf–FVæ6UF‡2æ†2†f–ÆR’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒ6öçF–ç2âVç6fR÷"v÷fW&æVBFƒ¢G¶f–ÆWÖ“°¢F&vWEF‡2çW6‚†f–ÆR“°¢Ð¢76W'B†6†ævRçF&vWEF‡2ç6öÖR†f–ÆRÓâf–ÆRç7F'G5v—F‚‚w7FWB÷3"övöÆFVâÖÖ7FW"×òr’bbf–ÆRæVæG5v—F‚‚r÷&Wf–WrÖÖæ–fW7Bæ§6öâr’bbf–ÆRæVæG5v—F‚‚rö76WBÖÖæ–fW7Bæ§6öâr’’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒÆ6·2&VæFW&VB&÷WFR÷"76WBF&vWF“°¢6öç7BW‡V7FVD76WG2Ò6†ævRçF&vWEF‡2æf–ÇFW"†f–ÆRÓâõç7FWEÂ÷3%ÂövöÆFVâÖÖ7FW"×Âö76WG5ÂòâµÂâƒó§vV'ÇæwÇ7fr’BòçFW7B†f–ÆR’’æÖ†f–ÆRÓâf–ÆRç6Æ–6R‚w7FWB÷3"övöÆFVâÖÖ7FW"×òræÆVæwF‚’’ç6÷'B‚“°¢76W'B„'&’æ—4'&’†6†ævRç&WV—&VD76WG2’bb¥4ôâç7G&–æv–g’†6†ævRç&WV—&VD76WG2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD76WG2’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒ&WV—&VD76WG2F–ffW'2g&öÒWfW'’&Wf—6VB&÷WFR–ÖvR76WF“°¢–b†6†ævRç&WV—&VD76WG2æÆVæwF‚’76W'B†6†ævRçF&vWEF‡2æ–æ6ÇVFW2‚w7FWB÷3"övöÆFVâÖÖ7FW"×ö76WBÖÖæ–fW7Bæ§6öâr’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒ&Wf—6W2–ÖvR'—FW2v—F†÷WBF†R76WBÖæ–fW7F“°¢76W'B„'&’æ—4'&’†6†ævRæ66WFæ6T76W'F–öç2’bb6†ævRæ66WFæ6T76W'F–öç2æÆVæwF‚ãÒbb6†ævRæ66WFæ6T76W'F–öç2æÆVæwF‚ÃÒ#Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒÆ6·2Ö6†–æRÖ6†V6¶&ÆR66WFæ6R76W'F–öç6“°¢f÷"†6öç7B¶76W'F–öä–æFW‚Â7&—FW&–öåÒöb6†ævRæ66WFæ6T76W'F–öç2æVçG&–W2‚’’°¢6öç7B6öÖÖöâÒ²v–BrÂwG—RrÂvvöÆFVäÖ7FW"uÓ°¢6öç7BW‡V7FVD¶W—2Ò7&—FW&–öãòçG—RÓÓÒtDôÕõ$T5EôDTÅDrò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂw&÷W'G’rÂv÷W&F÷"rÂwF‡&W6†öÆBuÐ¢¢7&—FW&–öãòçG—RÓÓÒtDôÕõ5E”ÄUôDTÅDrò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂw&÷W'G’rÂv÷W&F÷"rÂwF‡&W6†öÆBuÐ¢¢7&—FW&–öãòçG—RÓÓÒu$ô•õ•„TÅôDTÅDrò²ââæ6öÖÖöâÂw&Vv–öârÂv6†ævVE—†VÅ&F–òrÂvÖVä'6öÇWFT6†ææVÄFVÇFuÐ¢¢7&—FW&–öãòçG—RÓÓÒuDU…EôU„5Brò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂvW‡V7FVBuÐ¢¢7&—FW&–öãòçG—RÓÓÒtTÄTÔTåEõd•4”$ÄRrò²ââæ6öÖÖöâÂw6VÆV7F÷"rÂvÖ–æ–×VÔ&VuÒ¢çVÆÃ°¢76W'B†W‡V7FVD¶W—2Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒ†2âVç7W÷'FVB76W'F–öâG—V“°¢76W'DW†7D¶W•6WB†7&—FW&–öâÂW‡V7FVD¶W—2Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7B76W'F–öæ“°¢76W'B†7&—FW&–öâæ–BÓÓÒG¶6†ævRæ–GÒÔGµ7G&–ær†76W'F–öä–æFW‚²’çE7F'Bƒ"Âsr—Öbb76W'F–öä–G2æ†2†7&—FW&–öâæ–B’bb6†ævRæffV7FVDvöÆFVäÖ7FW'2æ–æ6ÇVFW2†7&—FW&–öâævöÆFVäÖ7FW"’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7B76W'F–öâ”B÷"vöÆFVâÖ7FW"—2–çfÆ–F“°¢76W'F–öä–G2æFB†7&—FW&–öâæ–B“°¢–b†7&—FW&–öâçG—RÓÒu$ô•õ•„TÅôDTÅDr’76W'B†—46æöæ–6Å3%&Wf—6–öå6VÆV7F÷"†7&—FW&–öâç6VÆV7F÷"’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7B76W'F–öâ6VÆV7F÷"—2Vç66÷VBÂÖÆf÷&ÖVB÷"Vç6fV“°¢–b†7&—FW&–öâçG—RÓÓÒtDôÕõ$T5EôDTÅDr’°¢6öç7BF—&V7F–öæÂÒ7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôuDRrò7&—FW&–öâçF‡&W6†öÆBâ¢7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôÅDRrò7&—FW&–öâçF‡&W6†öÆBÂ¢7&—FW&–öâçF‡&W6†öÆBâ°¢76W'B…²wv–GF‚rÂv†V–v‡BrÂw‚rÂw’uÒæ–æ6ÇVFW2†7&—FW&–öâç&÷W'G’’bb²tDTÅDôuDRrÂtDTÅDôÅDRrÂt%5ôDTÅDôuDRuÒæ–æ6ÇVFW2†7&—FW&–öâæ÷W&F÷"’bbçVÖ&W"æ—4f–æ—FR†7&—FW&–öâçF‡&W6†öÆB’bbÖF‚æ'2†7&—FW&–öâçF‡&W6†öÆB’ÃÒ3$7&—FW&–öäÖ†–×VÔÖvæ—GVFR†7&—FW&–öâ’bbF—&V7F–öæÂÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒDôÒ&V7FævÆR76W'F–öâ—2–çfÆ–BÂf–Ww÷'BÖ–×÷76–&ÆR÷"f7V÷W6“°¢Ð¢VÇ6R–b†7&—FW&–öâçG—RÓÓÒtDôÕõ5E”ÄUôDTÅDr’°¢6öç7BçVÖW&–57G–ÆRÒ²vföçB×6—¦RrÂv÷6—G’uÒæ–æ6ÇVFW2†7&—FW&–öâç&÷W'G’“°¢6öç7BçVÖW&–4÷W&F÷"Ò²tDTÅDôuDRrÂtDTÅDôÅDRrÂt%5ôDTÅDôuDRuÒæ–æ6ÇVFW2†7&—FW&–öâæ÷W&F÷"“°¢6öç7BF—&V7F–öæÂÒ7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôuDRrò7&—FW&–öâçF‡&W6†öÆBâ¢7&—FW&–öâæ÷W&F÷"ÓÓÒtDTÅDôÅDRrò7&—FW&–öâçF‡&W6†öÆBÂ¢7&—FW&–öâæ÷W&F÷"ÓÓÒt%5ôDTÅDôuDRrò7&—FW&–öâçF‡&W6†öÆBâ¢G'VS°¢76W'B…²vföçB×6—¦RrÂv6öÆ÷"rÂv&6¶w&÷VæBÖ6öÆ÷"rÂv÷6—G’uÒæ–æ6ÇVFW2†7&—FW&–öâç&÷W'G’’bb²tDTÅDôuDRrÂtDTÅDôÅDRrÂt%5ôDTÅDôuDRrÂt4„ätTBrÂteDU%ôUTÅ2uÒæ–æ6ÇVFW2†7&—FW&–öâæ÷W&F÷"’bbçVÖW&–57G–ÆRÓÓÒçVÖW&–4÷W&F÷"bb†çVÖW&–4÷W&F÷"òçVÖ&W"æ—4f–æ—FR†7&—FW&–öâçF‡&W6†öÆB’bbÖF‚æ'2†7&—FW&–öâçF‡&W6†öÆB’ÃÒ3$7&—FW&–öäÖ†–×VÔÖvæ—GVFR†7&—FW&–öâ’bbF—&V7F–öæÂ¢†7&—FW&–öâæ÷W&F÷"ÓÓÒt4„ätTBrò7&—FW&–öâçF‡&W6†öÆBÓÓÒçVÆÂ¢—46æöæ–6Ä6‡&öÖ—VÔ6ö×WFVD6öÆ÷"†7&—FW&–öâçF‡&W6†öÆB’’’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒDôÒ7G–ÆR76W'F–öâ—2–çfÆ–BÂæöæ6æöæ–6Â÷"f7V÷W6“°¢ÒVÇ6R–b†7&—FW&–öâçG—RÓÓÒu$ô•õ•„TÅôDTÅDr’°¢76W'DW†7D¶W•6WB†7&—FW&–öâç&Vv–öâÂ²w‚rÂw’rÂwv–GF‚rÂv†V–v‡BuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ$ô–“°¢6öç7B²‚Â’Âv–GF‚Â†V–v‡BÒÒ7&—FW&–öâç&Vv–öã°¢76W'B…·‚Â’Âv–GF‚Â†V–v‡EÒæWfW'’„çVÖ&W"æ—4f–æ—FR’bb‚ãÒbb’ãÒbbv–GF‚âbb†V–v‡Bâbb‚²v–GF‚ÃÒbb’²†V–v‡BÃÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ$ô’—2–çfÆ–F“°¢76W'B…µ²v6†ævVE—†VÅ&F–òrÂ7&—FW&–öâæ6†ævVE—†VÅ&F–òÂÒÂ²vÖVä'6öÇWFT6†ææVÄFVÇFrÂ7&—FW&–öâæÖVä'6öÇWFT6†ææVÄFVÇFÂ#SUÕÒæWfW'’‚…²Â&÷VæG2ÂÖ†–×VÕÒ’Óâ'&’æ—4'&’†&÷VæG2’bb&÷VæG2æÆVæwF‚ÓÓÒ"bb&÷VæG2æWfW'’„çVÖ&W"æ—4f–æ—FR’bb&÷VæG5³ÒãÒbb&÷VæG5³ÒÃÒ&÷VæG5³Òbb&÷VæG5³ÒÃÒÖ†–×VÒ’bb†7&—FW&–öâæ6†ævVE—†VÅ&F–õ³ÒâÇÂ7&—FW&–öâæÖVä'6öÇWFT6†ææVÄFVÇF³Òâ’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ$ô’F‡&W6†öÆG2&R–çfÆ–B÷"f7V÷W6“°¢ÒVÇ6R–b†7&—FW&–öâçG—RÓÓÒuDU…EôU„5Br’76W'B†—46æöæ–6Å3$W†7EFW‡B†7&—FW&–öâæW‡V7FVB’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒDU…EôU„5B—2–çfÆ–B÷"æöæ6æöæ–6Æ“°¢VÇ6R–b†7&—FW&–öâçG—RÓÓÒtTÄTÔTåEõd•4”$ÄRr’76W'B„çVÖ&W"æ—4f–æ—FR†7&—FW&–öâæÖ–æ–×VÔ&V’bb7&—FW&–öâæÖ–æ–×VÔ&VãÒcBbb7&—FW&–öâæÖ–æ–×VÔ&VÃÒ3$7&—FW&–öäÖ†–×VÔÖvæ—GVFR†7&—FW&–öâ’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒTÄTÔTåEõd•4”$ÄR&V—2–çfÆ–B÷"Æ&vW"F†â—G2&Wf–WvVBf–Ww÷'F“°¢Ð¢76W'B„¥4ôâç7G&–æv–g’…²ââææWr6WB†6†ævRæ66WFæ6T76W'F–öç2æÖ†7&—FW&–öâÓâ7&—FW&–öâævöÆFVäÖ7FW"’•Òç6÷'B‚’’ÓÓÒ¥4ôâç7G&–æv–g’†6†ævRæffV7FVDvöÆFVäÖ7FW'2’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BG¶6†ævRæ–GÒFöW2æ÷B†fR66WFæ6R6÷fW&vRf÷"WfW'’æBöæÇ’ffV7FVBvöÆFVâÖ7FW&“°¢Ð¢6öç7BW†7EF&vWEF‡2Ò²ââææWr6WB‡F&vWEF‡2•Òç6÷'B‚“°¢–b†W†7EF&vWEF‡2ç6öÖR†f–ÆRÓâf–ÆRç7F'G5v—F‚‚w7FWB÷3"övöÆFVâÖÖ7FW"×òr’bbf–ÆRæVæG5v—F‚‚r÷&Wf–WrÖÖæ–fW7Bæ§6öâr’’’76W'B†W†7EF&vWEF‡2æ–æ6ÇVFW2‚w7FWB÷3"övöÆFVâÖÖ7FW"×÷&Wf–WrÖÖæ–fW7Bæ§6öâr’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&÷WFR&Wf—6–öâöÖ—G2&Wf–WrÖÖæ–fW7Bæ§6öæ“°¢&WGW&âW†7EF&vWEF‡3°§Ð¦gVæ7F–öâfW&–g”FF—F–öæÅ3%&Wf—6–öä†æFöfb†6öæf–rÂ&VFV6W76÷"’°¢6öç7B6öçG&öÂÒ6öæf–ræ6öçG&öÃ°¢6öç7BÆö6²Ò6öæf–ræÆö6³°¢6öç7BWf–FVæ6U&W6Væ6RÒö&¦V7BçfÇVW2†6öæf–ræWf–FVæ6UF‡2’ç6öÖR†W†—7G2“°¢76W'B„&ööÆVâ†6öçG&öÂ’ÓÓÒ&ööÆVâ†Æö6²’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ6öçG&öÂæB&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&Wf—6–öâÆö6²×W7BV"FöÖ–6ÆÇ–“°¢–b‚6öçG&öÂ’°¢76W'B‚Wf–FVæ6U&W6Væ6RÂ&Wf–Wr&÷VæBG¶6öæf–ræWf–FVæ6U&÷VæGÒW†—7G2v—F†÷WB&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÖ“°¢&WGW&âçVÆÃ°¢Ð¢76W'B‡&VFV6W76÷#òç&Wf—6VE&VG”6öÖÖ—Bbb&VFV6W76÷"ç&Wf—6–öå&Vf—ƒòç&VF&6´6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&WV—&W2F†R6ö×ÆWFR&VFV6W76÷"$TE’6†–æ“°¢6öç7B&VFV6W76÷$66W72ÒfW&–g•3%&VG”66W75&VæWvÇ2‡²&Wf–Wu&Vf—ƒ¢&VFV6W76÷"ç&Wf—6–öå&Vf—‚ÂWf–FVæ6UF‡3¢6öæf–rç&Wf–÷W4Wf–FVæ6UF‡2ÂWf–FVæ6U&÷VæC¢6öæf–rç&Wf–÷W4Wf–FVæ6U&÷VæBÂ7V66W76÷$÷Væ–æt6öÖÖ—C¢6öæf–ræ÷Væ–æt6öÖÖ—BÂÆ&VÃ¢3"&Wf–Wr&÷VæBG¶6öæf–rç&Wf–÷W4Wf–FVæ6U&÷VæGÖÒ“°¢76W'B‡&VFV6W76÷$66W72bb&VFV6W76÷$66W72çVæF–æu&WVW7BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ6ææ÷B÷Vâg&öÒVæF–ær66W72×&VæWvÂ&WVW7F“°¢76W'B‚†6öæf–ræ&÷fÄ6öçG&öÂbb6öæf–rææW‡E&Wf—6–öä6öçG&öÂ’Â&÷VæBG¶6öæf–ræ&÷fÅ&÷VæGÒ&÷fÂæB&÷VæBG¶6öæf–rææW‡E&Wf—6–öå&÷VæGÒ&Wf—6–öâ&R×WGVÆÇ’W†6ÇW6—fV“°¢76W'DW†7D¶W•6WB†6öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂvVçG'•v÷&¶fÆ÷rrÂwW6W$FV6—6–öäÆö6²rÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂw&Wf—6–öå&WVW7BrÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&Wf—6–öâ6öçG&öÆ“°¢76W'DW†7D¶W•6WB†6öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'–“°¢76W'Ev÷&¶fÆ÷tWf–FVæ6T¶W—2†6öçG&öÂæVçG'•v÷&¶fÆ÷rÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'’v÷&¶fÆ÷vÂG'VR“°¢76W'DW†7D¶W•6WB†6öçG&öÂçW6W$FV6—6–öäÆö6²Â²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒÆö6²&–æF–æv“°¢76W'DW†7D¶W•6WB†6öçG&öÂç&Wf—6–öå&WVW7BÂ²v6÷VçBrÂw&WVW7E6†#SbrÂwF&vWEF‡2uÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&WVW7B&–æF–æv“°¢76W'DW†7D¶W•6WB†6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²w&WV—&VD–çFW&æÅrÂw&WV—&VD–çFW&æÅrÂvÖ†–×VÔgFW%&Wf—6–öå&Wf–WrrÂvÖ”æ÷DFV6Æ&RrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂwW6W%f—7VÄ&÷fÂuÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ6ö×ÆWF–öâ&÷VæF'–“°¢76W'B†6öçG&öÂç66†VÖfW'6–öâÓÓÒbb6öçG&öÂæ'F–f7D–BÓÓÒ6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÒG¶6öæf–ræ6öçG&öÅ&÷VæGÖbb—46æöæ–6Ä—6ôFFR†6öçG&öÂæ7&VFVDB’bb6öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb6öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb6öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ6öæf–rç&VçD6öçG&öÅF‚Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ–FVçF—G’ÂFFRÂ&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6†“°¢76W'B†6öçG&öÂç7FGW2ÓÓÒt”åõ$ôu$U52rbb6öçG&öÂçfW&F–7BÓÓÒt”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôârbb6öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb6öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"ÕÔtôÄDTâÔÔ5DU"rbb6öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6Rbb6öçG&öÂç66÷RÓÓÒu3%õôU„5EõU4U%õ$UTU5DTEõ$Ud•4”ôåôôäÅ’rÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ†6R÷"66÷RÖ—6ÖF6†“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²&WV—&VD–çFW&æÅ¢Â&WV—&VD–çFW&æÅ¢ÂÖ†–×VÔgFW%&Wf—6–öå&Wf–Ws¢u$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UrrÂÖ”æ÷DFV6Æ&S¢²u3"6ö×ÆWFRrÂu7FWB52rÂu7FWRÆÆ÷vVBrÂu"76WB&öGV7F–öâÆÆ÷vVBrÂu&öGV7F–öâ&VG’rÂw‡—6–6Â•†öæRfW&–f–VBrÂwW6W"f—7VÂ&÷fÂö'F–æVBuÒÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÂW6W%f—7VÄ&÷fÃ¢fÇ6RÒ’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ6ö×ÆWF–öâ&÷VæF'’÷fW&6Æ–×6“°¢76W'DW†7D¶W•6WB†Æö6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂv6†BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçDFV6—6–öäÆö6²rÂv&6RrÂw6÷W&6TFV6—6–öârÂw&Wf–Wt66W72rÂvFV6—6–öârÂw&WVW7FVD6†ævW2rÂv&÷VæF&–W2uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&Wf—6–öâÆö6¶“°¢76W'DW†7D¶W•6WB†Æö6²æ&6RÂ²v†VBrÂwG&VRuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&6V“°¢76W'DW†7D¶W•6WB†Æö6²ç6÷W&6TFV6—6–öâÂ²vÖW76vRrÂvÖW76vU6†#SbrÂvWF†÷&—¦F–öä6öFRrÂvö'6W'fVDBrÂv–æfW'&VBuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ6÷W&6RFV6—6–öæ“°¢76W'DW†7D¶W•6WB†Æö6²ç&Wf–Wt66W72Â²w&WVW7BrÂw&VF&6²uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&Wf–Wr66W76“°¢76W'DW†7D¶W•6WB†Æö6²ç&Wf–Wt66W72ç&WVW7BÂ²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&Wf–Wr66W72&WVW7F“°¢76W'DW†7D¶W•6WB†Æö6²ç&Wf–Wt66W72ç&VF&6²Â²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&Wf–Wr66W72&VF&6¶“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷VæF&–W2Â²wW6W%f—7VÄ&÷fÂrÂw3$6ö×ÆWFRrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw$76WE&öGV7F–öäÆÆ÷vVBrÂw'VçF–ÖT–×ÆVÖVçFVBrÂw&öGV7F–öå&VG’rÂw‡—6–6Ä•†öæUfW&–f–VBrÂw&öGV7F–öäÆ–46†ævVBuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&÷VæF&–W6“°¢76W'B†Æö6²ç66†VÖfW'6–öâÓÓÒbbÆö6²æ'F–f7D–BÓÓÒ7FWÓÖ†W&òÖÖW&6†çBÖÆ&vRÖ–FÆRÖ–çFVw&F–öâ×W6W"ÖFV6—6–öâÖÆö6²×&÷VæBÒG¶6öæf–ræÆö6µ&÷VæGÖbb—46æöæ–6Ä—6ôFFR†Æö6²æ7&VFVDB’bbÆö6²æ6†BÓÓÒsEõ3"ÕôvöÆFVäÖ7FW.ŠŠÞŠˆ‚rbbÆö6²ç&W÷6—F÷'’ÓÓÒ6öçG&öÂç&W÷6—F÷'’bbÆö6²æ'&æ6‚ÓÓÒv¶–Ö’rbbÆö6²ç&VçDFV6—6–öäÆö6²ÓÓÒ6öæf–rç&VçDÆö6µF‚bbÆö6²æFV6—6–öâÓÓÒu$UTU5DTEõ3%ôtôÄDTåôÔ5DU%õõ$Ud•4”ôârbbö&¦V7BçfÇVW2†Æö6²æ&÷VæF&–W2’æWfW'’‡fÇVRÓâfÇVRÓÓÒfÇ6R’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ–FVçF—G’ÂFFRÂ&VçB÷"G'WF‚&÷VæF'’Ö—6ÖF6†“°¢6öç7BW†7EF&vWEF‡2ÒfÆ–FFTFF—F–öæÅ&Wf—6–öå&WVW7G2†Æö6²Â6öæf–r“°¢6öç7B6÷W&6TÖW76vRÒÆö6²ç6÷W&6TFV6—6–öâæÖW76vS°¢76W'B‡G—Vöb6÷W&6TÖW76vRÓÓÒw7G&–ærrbb6÷W&6TÖW76vRÓÓÒ6÷W&6TÖW76vRçG&–Ò‚’bb6÷W&6TÖW76vRæÆVæwF‚ÃÒSbbÆö6²ç6÷W&6TFV6—6–öâæÖW76vU6†#SbÓÓÒ6†#Sc¢G·6†#SeFW‡B‡6÷W&6TÖW76vR—ÖbbÆö6²ç&WVW7FVD6†ævW2æWfW'’†6†ævRÓâ6÷W&6TÖW76vRæ–æ6ÇVFW2†6†ævRç&WVW7B’’bbÆö6²ç6÷W&6TFV6—6–öâæWF†÷&—¦F–öä6öFRÓÓÒu$UTU5Eõ3%õôtÕõ$Ud•4”ôârbbÆö6²ç6÷W&6TFV6—6–öâæ–æfW'&VBÓÓÒfÇ6RÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ6÷W&6RÖW76vRFöW2æ÷BW†7FÇ’&–æBWfW'’&WVW7F“°¢6öç7B&WVW7E6†#SbÒ6†#Sc¢G·6†#Sd6æöæ–6Â†Æö6²ç&WVW7FVD6†ævW2—Ö°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&öÂç&Wf—6–öå&WVW7B’ÓÓÒ¥4ôâç7G&–æv–g’‡²6÷VçC¢Æö6²ç&WVW7FVD6†ævW2æÆVæwF‚Â&WVW7E6†#SbÂF&vWEF‡3¢W†7EF&vWEF‡2Ò’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒFöW2æ÷BW†7FÇ’&–æB&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7G6“°¢6öç7B÷Væ–æt6öÖÖ—BÒ6öæf–ræ÷Væ–æt6öÖÖ—C°¢6öç7B&VG”6öÖÖ—BÒv—B…²w&Wb×'6RrÂG¶÷Væ–æt6öÖÖ—GÕæÒ“°¢6öç7B&VG•G&VRÒv—B…²w&Wb×'6RrÂG·&VG”6öÖÖ—GÕç·G&VWÖÒ“°¢76W'DW†7E6–ævÆU&VçB†÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&Wf—6–öâ÷Væ–æv“°¢76W'B‡&VG”6öÖÖ—BÓÓÒ&VFV6W76÷$66W72æFV6—6–öå&VG”6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&VçB—2æ÷BF†RÆFW7BgVÆÇ’fW&–f–VBÆ—fRÖ66W72$TE’7FFV“°¢76W'B„¥4ôâç7G&–æv–g’†Æö6²æ&6R’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’bb¥4ôâç7G&–æv–g’†6öçG&öÂæVçG'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'’÷"&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&6RÖ—6ÖF6†“°¢6öç7BW†7E&Wf—6–öäWF†÷&—¦F–öâÒ$UTU5Eõ3%õôtÕõ$Ud•4”ôã¢G·&VG”6öÖÖ—GÓ¢G·&VG•G&VWÓ¢G·&WVW7E6†#SgÖ°¢76W'B‡6÷W&6TÖW76vRæ–æ6ÇVFW2†W†7E&Wf—6–öäWF†÷&—¦F–öâ’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ6÷W&6RÖW76vRÆ6·2F†RW†7B$TE’f–ævW'&–çBæB7G'V7GW&VB&WVW7FVD6†ævW2F–vW7BWF†÷&—¦F–öæ“°¢6öç7B&Wf–÷W5&WVW7BÒ&VFV6W76÷$66W72æ7W'&VçE&WVW7C°¢6öç7B&Wf–÷W5&VF&6²Ò&VFV6W76÷$66W72æ7W'&VçE&VF&6³°¢76W'B„¥4ôâç7G&–æv–g’†Æö6²ç&Wf–Wt66W72’ÓÓÒ¥4ôâç7G&–æv–g’‡²&WVW7C¢²Fƒ¢&VFV6W76÷$66W72æ7W'&VçE&WVW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·&VFV6W76÷$66W72æ7W'&VçE&WVW7EF‡ÖÒ’ÒÂ&VF&6³¢²Fƒ¢&VFV6W76÷$66W72æ7W'&VçE&VF&6µF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·&VFV6W76÷$66W72æ7W'&VçE&VF&6µF‡ÖÒ’ÒÒ’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒFöW2æ÷B&–æBF†RÆFW7BÆ—fR&Wf–WrÖ66W72&ööf“°¢6öç7Bö'6W'fVDBÒFFRç'6R†Æö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBóòrr“°¢6öç7B&VG”6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ&VG”6öÖÖ—EÒ’“°¢6öç7B÷Væ–æt6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ÷Væ–æt6öÖÖ—EÒ’“°¢6öç7B66W74W‡—'’ÒFFRç'6R‡&Wf–÷W5&WVW7Bç&Wf–WrçFV×÷&'”66W72æW‡—&W4Bóòrr“°¢6öç7B6æöæ–6Äö'6W'fVDBÒçVÖ&W"æ—4f–æ—FR†ö'6W'fVDB’òæWrFFR†ö'6W'fVDB’çFô•4õ7G&–ær‚’ç&WÆ6R‚rã¢rÂu¢r’¢rs°¢76W'B†6æöæ–6Äö'6W'fVDBÓÓÒÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBbbö'6W'fVDBãÒFFRç'6R‡&Wf–÷W5&VF&6²çfW&–f–VD‡GGçfW&–f–VDB’bbö'6W'fVDBãÒ&VG”6öÖÖ—GFVDBbbö'6W'fVDBÃÒ66W74W‡—'’bbö'6W'fVDBÃÒ÷Væ–æt6öÖÖ—GFVDBbb÷Væ–æt6öÖÖ—GFVDBÒö'6W'fVDBÃÒ#B¢c¢c¢Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&WVW7BF–ÖR—2÷WG6–FRF†RÆ—fR&Wf–WvVB$TE’–çFW'fÆ“°¢76W'B†6öçG&öÂæ7&VFVDBÓÓÒÆö6²æ7&VFVDBbbÆö6²æ7&VFVDBÓÓÒÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBç6Æ–6RƒÂ’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒòG¶6öæf–ræÆö6µ&÷VæGÒFFW2Ö—6ÖF6†“°¢6öç7B÷Væ–æuw&—FW2Ò¶6öæf–ræ6öçG&öÅF‚Â6öæf–ræÆö6µF‚ÂââæW‡V7FVE3%&VG”7F—fF–öåw&—FW5Ó°¢76W'DW†7D6†ævVEF‡2‡&VG”6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂ÷Væ–æuw&—FW2Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒFöÖ–2&Wf—6–öâ÷Væ–æv“°¢76W'B†f—'7DFD6öÖÖ—B†6öæf–ræÆö6µF‚’ÓÓÒ÷Væ–æt6öÖÖ—Bbbf—'7DFD6öÖÖ—B†6öæf–ræ6öçG&öÅF‚’ÓÓÒ÷Væ–æt6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒòG¶6öæf–ræÆö6µ&÷VæGÒvW&Ræ÷Bf—'7BFFVBFöÖ–6ÆÇ–“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6öæf–ræ6öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6öæf–ræÆö6µF‚Â÷Væ–æt6öÖÖ—B“°¢76W'B†6öçG&öÂçW6W$FV6—6–öäÆö6²çF‚ÓÓÒ6öæf–ræÆö6µF‚bb6öçG&öÂçW6W$FV6—6–öäÆö6²æ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G¶6öæf–ræÆö6µF‡ÖÒ’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒFöW2æ÷B&–æB–Ö×WF&ÆR&÷VæBG¶6öæf–ræÆö6µ&÷VæGÖ“°¢6öç7B7V66W76÷%F‡2Ò¶6öæf–ræ&÷fÄ6öçG&öÅF‚Â6öæf–ræ&÷fÄÆö6µF‚Ââââ†6öæf–rææW‡E&Wf—6–öä6öçG&öÅF‚ò¶6öæf–rææW‡E&Wf—6–öä6öçG&öÅF‚Â6öæf–rææW‡E&Wf—6–öäÆö6µF…Ò¢µÒ•Ó°¢6öç7BW‡V7FVDÆÆ÷vVEw&—FW2Ò²ââæ÷Væ–æuw&—FW2Âââç7V66W76÷%F‡2ÂââæW†7EF&vWEF‡2Âââäö&¦V7BçfÇVW2†6öæf–ræWf–FVæ6UF‡2’Âââç3%v÷&¶fÆ÷u6¶vUw&—FUF‡2†6öæf–ræWf–FVæ6U&÷VæBÂG'VR’Âââäö&¦V7BçfÇVW2‡3%v÷&¶fÆ÷tFÖ—76–öåF‡2†6öæf–ræWf–FVæ6U&÷VæB’’Âââç3$66W75&VæWvÅw&—FUGFW&ç2†6öæf–ræWf–FVæ6U&÷VæB•Ó°¢6öç7BÆÄ'&æ6…F‡2Ò·3%$6öçG&öÅF‚Â3%W6W$FV6—6–öäÆö6µF‚Â3%&Wf—6–öä6öçG&öÅF‚Â3%&Wf—6–öäFV6—6–öäÆö6µF‚Â3%&Wf—6VE$6öçG&öÅF‚Â3%&Wf—6VD&÷fÄÆö6µF‚Â3%6V6öæE&Wf—6–öä6öçG&öÅF‚Â3%6V6öæE&Wf—6–öäÆö6µF‚Â3%6V6öæE&Wf—6VE$6öçG&öÅF‚Â3%6V6öæE&Wf—6VD&÷fÄÆö6µF‚Â3%F†—&E&Wf—6–öä6öçG&öÅF‚Â3%F†—&E&Wf—6–öäÆö6µF‚Â3%F†—&E&Wf—6VE$6öçG&öÅF‚Â3%F†—&E&Wf—6VD&÷fÄÆö6µF…Ó°¢6öç7BW‡V7FVDf÷&&–FFVåw&—FW2Ò²ââææWr6WB…²ââæW‡V7FVE3%&W—$f÷&&–FFVåw&—FW2ÂââæÆÄ'&æ6…F‡2æf–ÇFW"†f–ÆRÓâW‡V7FVDÆÆ÷vVEw&—FW2æ–æ6ÇVFW2†f–ÆR’’Âââå·3%&Wf–WtWf–FVæ6UF‡2Â3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2Â3%6V6öæE&Wf—6–öå&Wf–WtWf–FVæ6UF‡2Â3%F†—&E&Wf—6–öå&Wf–WtWf–FVæ6UF‡5ÒæfÆDÖ„ö&¦V7BçfÇVW2’æf–ÇFW"†f–ÆRÓâW‡V7FVDÆÆ÷vVEw&—FW2æ–æ6ÇVFW2†f–ÆR’’Âââç3%fW&–f–6F–öåF‡5Ò•Ó°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDÆÆ÷vVEw&—FW2’bb¥4ôâç7G&–æv–g’†6öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf÷&&–FFVåw&—FW2’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒw&—FR&÷VæF'’F–ffW'2g&öÒW†7B&Wf—6–öâöWf–FVæ6R÷7V66W76÷'6“°¢76W'B†6öçG&öÂæVçG'•v÷&¶fÆ÷ræ6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb6öçG&öÂæVçG'•v÷&¶fÆ÷rçG&VRÓÓÒ&VG•G&VRÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒv÷&¶fÆ÷rF&vWBÖ—6ÖF6†“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R†6öçG&öÂæVçG'•v÷&¶fÆ÷rÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'–“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂf–ÆRÓâW‡V7FVDFF—F–öæÅ&Wf—6–öäFö7VÖVçEFW‡B†f–ÆRÂ6öæf–ræFö7VÖVçD6öæf–r’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ÷Væ–ærFö7VÖVçG6“°¢f÷"†6öç7B&–÷%F‡2öb6öæf–rç&–÷$Wf–FVæ6UF…6WG2’f÷"†6öç7Bf–ÆRöbö&¦V7BçfÇVW2‡&–÷%F‡2’’76W'DFFVDöæ6TæEVæ6†ævVB†f–ÆRÂf—'7DFD6öÖÖ—B†f–ÆR’“°¢6öç7B7F—fT66WFæ6T7&—FW&–ÒFW&—fT7F—fT66WFæ6T7&—FW&–‡&VFV6W76÷"æ7F—fT66WFæ6T7&—FW&–ÂÆö6²ç&WVW7FVD6†ævW2Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÖ“°¢6öç7B&Wf—6–öå&Vf—‚ÒfW&–g•3%&Wf–WtWf–FVæ6U&Vf—‚‡°¢F‡3¢6öæf–ræWf–FVæ6UF‡2À¢Wf–FVæ6U&÷VæC¢6öæf–ræWf–FVæ6U&÷VæBÀ¢6†ævT6öçG&öÅFƒ¢6öæf–ræ6öçG&öÅF‚À¢÷Væ–æt6öÖÖ—BÀ¢W†7D6öçFVçE&VçC¢÷Væ–æt6öÖÖ—BÀ¢6öçFVçDÖæ–fW7D÷F–öç3¢²FVÇF&6T6öÖÖ—C¢÷Væ–æt6öÖÖ—BÂ&WV—&TgVÆÅ&W—$FVÇF¢fÇ6RÂW†7E&Wf—6–öåF‡3¢W†7EF&vWEF‡2ÒÀ¢&Wf—6–öä6†ævW3¢Æö6²ç&WVW7FVD6†ævW2À¢7F—fT66WFæ6T7&—FW&–À¢&Wf—6–öä&6VÆ–æS¢²6öÖÖ—C¢&VFV6W76÷"ç&Wf—6–öå&Vf—‚çF&vWD6öÖÖ—BÂG&VS¢&VFV6W76÷"ç&Wf—6–öå&Vf—‚çF&vWEG&VRÒÀ¢&Wf–÷W5&Wf—6–öäWf–FVæ6UF‡3¢6öæf–rç&Wf–÷W4Wf–FVæ6UF‡2À¢&WV—&TÆ—fUv÷&¶fÆ÷s¢G'VRÀ¢Æ&VÅ&Vf—ƒ¢3"&Wf—6–öâ&÷VæBG¶6öæf–ræWf–FVæ6U&÷VæGÖ ¢Ò“°¢6öç7B†VBÒv—B…²w&Wb×'6RrÂt„TBuÒ“°¢6öç7B7V66W76÷$÷Væ–ærÒ6öæf–ræ&÷fÄ÷Væ–æt6öÖÖ—Bóò6öæf–rææW‡E&Wf—6–öä÷Væ–æt6öÖÖ—C°¢6öç7BÆ–æVvT†VBÒ7V66W76÷$÷Væ–æròv—B…²w&Wb×'6RrÂG·7V66W76÷$÷Væ–æwÕæÒ’¢†VC°¢–b‚&Wf—6–öå&Vf—‚’°¢–b†Æ–æVvT†VBÓÒ÷Væ–æt6öÖÖ—B’°¢76W'B†v—B…²w&Wb×'6RrÂG¶Æ–æVvT†VGÕæÒ’ÓÓÒ÷Væ–æt6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒW&Ö—G2W†7FÇ’öæR6öçFVçB6öÖÖ—B&Vf÷&RfV6–&–Æ—G’Wf–FVæ6V“°¢FW&—fU3$6öçFVçDÖæ–fW7B†Æ–æVvT†VBÂ²FVÇF&6T6öÖÖ—C¢÷Væ–æt6öÖÖ—BÂ&WV—&TgVÆÅ&W—$FVÇF¢fÇ6RÂW†7E&Wf—6–öåF‡3¢W†7EF&vWEF‡2Ò“°¢Ð¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÅ&Wf—6–öäFö7VÖVçEFW‡B†f–ÆRÂ6öæf–ræFö7VÖVçD6öæf–r’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ–â×&öw&W72Fö7VÖVçG6“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—ƒ¢çVÆÂÓ°¢Ð¢76W'DæõF„6†ævW56–æ6R†÷Væ–æt6öÖÖ—BÂ&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—Bóò†VBÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒÖ—'&÷'26†ævVB&Vf÷&R$TE–“°¢–b‚&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—B’°¢6öç7BWf–FVæ6UF–ÂÒ&Wf—6–öå&Vf—‚ç&WVW7D6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ6ö×ÆWF–öä6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ§VFvT6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ7&—F–46öÖÖ—Bóò&Wf—6–öå&Vf—‚æfV6–&–Æ—G”VF—D6öÖÖ—Bóò&Wf—6–öå&Vf—‚æFÖ—76–öå&VF&6´6öÖÖ—Bóò&Wf—6–öå&Vf—‚æFÖ—76–öä6öÖÖ—Bóò&Wf—6–öå&Vf—‚ç6¶vT6öÖÖ—Bóò&Wf—6–öå&Vf—‚æ66WFæ6T6öÖÖ—C°¢76W'B††VBÓÓÒWf–FVæ6UF–ÂÂ&Wf–Wr&÷VæBG¶6öæf–ræWf–FVæ6U&÷VæGÒWf–FVæ6R—2æ÷BF†RW†7BF–Æ“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÅ&Wf—6–öäFö7VÖVçEFW‡B†f–ÆRÂ6öæf–ræFö7VÖVçD6öæf–r’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒWf–FVæ6RFö7VÖVçG6“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—‚Ó°¢Ð¢–b†Æ–æVvT†VBÓÓÒ&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—B’°¢76W'B†WF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôârÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&VF&6²F–Â×W7B&VÖ–â–â&öw&W76“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÅ&Wf—6–öäFö7VÖVçEFW‡B†f–ÆRÂ6öæf–ræFö7VÖVçD6öæf–r’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&VF&6²×F–ÂFö7VÖVçG6“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—‚Ó°¢Ð¢6öç7B&Wf—6VE&VG”6öÖÖ—BÒf—'7D6öÖÖ—DgFW$öå6–ævÆU&VçDÆ–æVvR‡&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—BÂÆ–æVvT†VBÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&Wf—6VB$TE’Æ–æVvV“°¢76W'B†v—B…²w&Wb×'6RrÂG·&Wf—6VE&VG”6öÖÖ—GÕæÒ’ÓÓÒ&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ$TE’×W7B–ÖÖVF–FVÇ’föÆÆ÷r&Wf–Wr&VF&6¶“°¢76W'DW†7D6†ævVEF‡2‡&Wf—6–öå&Vf—‚ç&VF&6´6öÖÖ—BÂ&Wf—6VE&VG”6öÖÖ—BÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ$TE’7F—fF–öæ“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‡&Wf—6VE&VG”6öÖÖ—BÂf–ÆRÓâW‡V7FVDFF—F–öæÅ&Wf—6–öäFö7VÖVçEFW‡B†f–ÆRÂ6öæf–ræFö7VÖVçD6öæf–rÂG'VR’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ$TE’Fö7VÖVçG6“°¢f÷"†6öç7BVçG'’öb&Wf—6–öå&Vf—‚æ6öçFVçDÖæ–fW7B’76W'B†v—B…²w&Wb×'6RrÂ„TC¢G¶VçG'’çF‡ÖÒ’ÓÓÒVçG'’æ&Æö"Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ$TE’6öçFVçBF–ffW'2g&öÒ7&—F–2Öæ–fW7C¢G¶VçG'’çF‡Ö“°¢6öç7B&VG”66W72ÒfW&–g•3%&VG”66W75&VæWvÇ2‡²&Wf–Wu&Vf—ƒ¢&Wf—6–öå&Vf—‚ÂWf–FVæ6UF‡3¢6öæf–ræWf–FVæ6UF‡2ÂWf–FVæ6U&÷VæC¢6öæf–ræWf–FVæ6U&÷VæBÂ7V66W76÷$÷Væ–æt6öÖÖ—C¢7V66W76÷$÷Væ–ærÂÆ&VÃ¢3"&Wf—6VB&Wf–Wr&÷VæBG¶6öæf–ræWf–FVæ6U&÷VæGÖÒ“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂ&Wf—6VE&VG”6öÖÖ—BÂFV6—6–öå&VG”6öÖÖ—C¢&VG”66W72æFV6—6–öå&VG”6öÖÖ—BÂ&VG”66W72ÂF&vWEF‡3¢W†7EF&vWEF‡2Â7F—fT66WFæ6T7&—FW&–Â&Wf—6–öå&Vf—‚Ó°§Ð¦6öç7B3%6V6öæE&Wf—6–öä6öæf–rÒ°¢6öçG&öÅ&÷VæC¢s3‚rÂÆö6µ&÷VæC¢s’rÂWf–FVæ6U&÷VæC¢s2rÂ&÷fÅ&÷VæC¢s3’rÂæW‡E&Wf—6–öå&÷VæC¢sCrÀ¢6öçG&öÅFƒ¢3%6V6öæE&Wf—6–öä6öçG&öÅF‚ÂÆö6µFƒ¢3%6V6öæE&Wf—6–öäÆö6µF‚Â6öçG&öÃ¢3%6V6öæE&Wf—6–öä6öçG&öÂÂÆö6³¢3%6V6öæE&Wf—6–öäÆö6²Â÷Væ–æt6öÖÖ—C¢3%6V6öæE&Wf—6–öä÷Væ–æt6öÖÖ—BÀ¢&VçD6öçG&öÅFƒ¢3%&Wf—6–öä6öçG&öÅF‚Â&VçDÆö6µFƒ¢3%&Wf—6–öäFV6—6–öäÆö6µF‚À¢Wf–FVæ6UF‡3¢3%6V6öæE&Wf—6–öå&Wf–WtWf–FVæ6UF‡2Â&Wf–÷W4Wf–FVæ6UF‡3¢3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2À¢&Wf–÷W4Wf–FVæ6U&÷VæC¢s"rÀ¢&–÷$Wf–FVæ6UF…6WG3¢·3%&Wf–WtWf–FVæ6UF‡2Â3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡5ÒÀ¢&÷fÄ6öçG&öÅFƒ¢3%6V6öæE&Wf—6VE$6öçG&öÅF‚Â&÷fÄÆö6µFƒ¢3%6V6öæE&Wf—6VD&÷fÄÆö6µF‚Â&÷fÄ6öçG&öÃ¢3%6V6öæE&Wf—6VE$6öçG&öÂÂ&÷fÄ÷Væ–æt6öÖÖ—C¢3%6V6öæE&Wf—6VE$÷Væ–æt6öÖÖ—BÀ¢æW‡E&Wf—6–öä6öçG&öÅFƒ¢3%F†—&E&Wf—6–öä6öçG&öÅF‚ÂæW‡E&Wf—6–öäÆö6µFƒ¢3%F†—&E&Wf—6–öäÆö6µF‚ÂæW‡E&Wf—6–öä6öçG&öÃ¢3%F†—&E&Wf—6–öä6öçG&öÂÂæW‡E&Wf—6–öä÷Væ–æt6öÖÖ—C¢3%F†—&E&Wf—6–öä÷Væ–æt6öÖÖ—BÀ¢Fö7VÖVçD6öæf–s¢3%6V6öæE&Wf—6–öäFö7VÖVçD6öæf–p§Ó°¦6öç7B3%6V6öæE&Wf—6–öä†æFöfbÒfW&–g”FF—F–öæÅ3%&Wf—6–öä†æFöfb‡3%6V6öæE&Wf—6–öä6öæf–rÂ3%&Wf—6–öä†æFöfb“°¦6öç7B3%F†—&E&Wf—6–öä6öæf–rÒ°¢6öçG&öÅ&÷VæC¢sCrÂÆö6µ&÷VæC¢srÂWf–FVæ6U&÷VæC¢sBrÂ&÷fÅ&÷VæC¢sCrÂæW‡E&Wf—6–öå&÷VæC¢çVÆÂÀ¢6öçG&öÅFƒ¢3%F†—&E&Wf—6–öä6öçG&öÅF‚ÂÆö6µFƒ¢3%F†—&E&Wf—6–öäÆö6µF‚Â6öçG&öÃ¢3%F†—&E&Wf—6–öä6öçG&öÂÂÆö6³¢3%F†—&E&Wf—6–öäÆö6²Â÷Væ–æt6öÖÖ—C¢3%F†—&E&Wf—6–öä÷Væ–æt6öÖÖ—BÀ¢&VçD6öçG&öÅFƒ¢3%6V6öæE&Wf—6–öä6öçG&öÅF‚Â&VçDÆö6µFƒ¢3%6V6öæE&Wf—6–öäÆö6µF‚À¢Wf–FVæ6UF‡3¢3%F†—&E&Wf—6–öå&Wf–WtWf–FVæ6UF‡2Â&Wf–÷W4Wf–FVæ6UF‡3¢3%6V6öæE&Wf—6–öå&Wf–WtWf–FVæ6UF‡2À¢&Wf–÷W4Wf–FVæ6U&÷VæC¢s2rÀ¢&–÷$Wf–FVæ6UF…6WG3¢·3%&Wf–WtWf–FVæ6UF‡2Â3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2Â3%6V6öæE&Wf—6–öå&Wf–WtWf–FVæ6UF‡5ÒÀ¢&÷fÄ6öçG&öÅFƒ¢3%F†—&E&Wf—6VE$6öçG&öÅF‚Â&÷fÄÆö6µFƒ¢3%F†—&E&Wf—6VD&÷fÄÆö6µF‚Â&÷fÄ6öçG&öÃ¢3%F†—&E&Wf—6VE$6öçG&öÂÂ&÷fÄ÷Væ–æt6öÖÖ—C¢3%F†—&E&Wf—6VE$÷Væ–æt6öÖÖ—BÀ¢æW‡E&Wf—6–öä6öçG&öÅFƒ¢çVÆÂÂæW‡E&Wf—6–öäÆö6µFƒ¢çVÆÂÂæW‡E&Wf—6–öä6öçG&öÃ¢çVÆÂÂæW‡E&Wf—6–öä÷Væ–æt6öÖÖ—C¢çVÆÂÀ¢Fö7VÖVçD6öæf–s¢3%F†—&E&Wf—6–öäFö7VÖVçD6öæf–p§Ó°¦6öç7B3%F†—&E&Wf—6–öä†æFöfbÒfW&–g”FF—F–öæÅ3%&Wf—6–öä†æFöfb‡3%F†—&E&Wf—6–öä6öæf–rÂ3%6V6öæE&Wf—6–öä†æFöfb“°¦gVæ7F–öâfW&–g•3%$&÷fÄ†æFöfb‚’°¢76W'B„&ööÆVâ‡3%$6öçG&öÂ’ÓÓÒ&ööÆVâ‡3%W6W$FV6—6–öäÆö6²’Âw&÷VæB3R6öçG&öÂæBW‡Æ–6—BW6W"ÖFV6—6–öâÆö6²×W7BV"FöÖ–6ÆÇ’r“°¢–b‚3%$6öçG&öÂ’&WGW&âçVÆÃ°¢76W'B‡3%&W—$6öçG&öÂbb3%&Wf–Wu&Vf—ƒòç&VF&6´6öÖÖ—BÂw&÷VæB3R&WV—&W2F†R6ö×ÆWFR&÷VæB3B3"&Wf–Wr6†–âr“°¢76W'DW†7D¶W•6WB‡3%$6öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂvVçG'•v÷&¶fÆ÷rrÂwW6W$FV6—6–öäÆö6²rÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂw&VF–æW72rÂvæW‡DWF†÷&—¦VD7F–öârÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂw&÷VæB3R6öçG&öÂr“°¢76W'DW†7D¶W•6WB‡3%$6öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂw&÷VæB3RVçG'’r“°¢76W'DW†7D¶W•6WB‡3%$6öçG&öÂçW6W$FV6—6–öäÆö6²Â²wF‚rÂv&Æö"uÒÂw&÷VæB3RFV6—6–öâÖÆö6²&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%$6öçG&öÂç&VF–æW72Â²v–çFW&æÅrÂv–çFW&æÅrÂwW6W$&÷fVDvöÆFVäÖ7FW'2rÂvWf–FVæ6T66WFVDFVÆ—fW&&ÆW2rÂw3E&V6÷fW'”f–æF–ærrÂw&VG”6öÖÖ—BrÂw&VG•G&VRrÂv6öçFVçD6öÖÖ—BrÂv6öçFVçEG&VRrÂv7&—F–2rÂvFWÆ÷–ÖVçE&VF&6²uÒÂw&÷VæB3R&VF–æW72r“°¢76W'DW†7D¶W•6WB‡3%$6öçG&öÂç&VF–æW72æ7&—F–2Â²wF‚rÂv&Æö"uÒÂw&÷VæB3R7&—F–2&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%$6öçG&öÂç&VF–æW72æFWÆ÷–ÖVçE&VF&6²Â²wF‚rÂv&Æö"uÒÂw&÷VæB3RFWÆ÷–ÖVçB&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%$6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²w7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öä76WG4&÷fVBrÂwGvVÇfU67&VVç4&÷fVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂvÖ†–×VÕfW&F–7BrÂvÖ”æ÷DFV6Æ&RuÒÂw&÷VæB3R6ö×ÆWF–öâ&÷VæF'’r“°¢76W'B‡3%$6öçG&öÂç66†VÖfW'6–öâÓÓÒbb3%$6öçG&öÂæ'F–f7D–BÓÓÒv6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3Rrbb—46æöæ–6Ä—6ôFFR‡3%$6öçG&öÂæ7&VFVDB’Âw&÷VæB3R–FVçF—G’÷"FFRÖ—6ÖF6‚r“°¢76W'B‡3%$6öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3%$6öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb3%$6öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ3%&W—$6öçG&öÅF‚Âw&÷VæB3R&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6‚r“°¢76W'B‡3%$6öçG&öÂç7FGW2ÓÓÒt”åõ$ôu$U52rbb3%$6öçG&öÂçfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârbb3%$6öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb3%$6öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"Õ"Ô54UBÕ$ôET5D”ôârbb3%$6öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6RÂw&÷VæB3R†6R÷"fW&F–7BÖ—6ÖF6‚r“°¢76W'B‡3%$6öçG&öÂç66÷RÓÓÒu3%õ%õ$U$U4TåDD•dUõ$ôET5D”ôåô54UEõ$ôôeôôäÅ’rÂw&÷VæB3R66÷RW†6VVG2F†R&W&W6VçFF—fR76WB&ööbr“°¢76W'B‡3%$6öçG&öÂææW‡DWF†÷&—¦VD7F–öâÓÓÒt7&VFRæB–æFWVæFVçFÇ’fW&–g’öæR&W&W6VçFF—fR&öGV7F–öâÖ76WB6WB&Vf÷&Rç’föÇVÖRvVæW&F–öâ÷"'VçF–ÖR&WÆ6VÖVçBârÂw&÷VæB3RæW‡B7F–öâÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%$6öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3%$ÆÆ÷vVEw&—FW2’bb¥4ôâç7G&–æv–g’‡3%$6öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3%$f÷&&–FFVåw&—FW2’Âw&÷VæB3Rw&—FR&÷VæF'’Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%$6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FWE73¢fÇ6RÀ¢7FWTÆÆ÷vVC¢fÇ6RÀ¢&öGV7F–öäÆÆ÷vVC¢fÇ6RÀ¢&öGV7F–öä76WG4&÷fVC¢fÇ6RÀ¢GvVÇfU67&VVç4&÷fVC¢À¢&öGV7F–öäÆ–46†ævVC¢fÇ6RÀ¢‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÀ¢Ö†–×VÕfW&F–7C¢u$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârÀ¢Ö”æ÷DFV6Æ&S¢²u3"6ö×ÆWFRrÂu7FWB52rÂu7FWRÆÆ÷vVBrÂw'VçF–ÖR–×ÆVÖVçFVBrÂw&öGV7F–öâ76WG2&÷fVBrÂu&öGV7F–öâ&VG’rÂw‡—6–6Â•†öæRfW&–f–VBrÂu&öGV7F–öâÆ–26†ævVBuÐ¢Ò’Âw&÷VæB3R6ö×ÆWF–öâ&÷VæF'’÷fW&6Æ–×2&VÆV6RÂ'VçF–ÖRÂ76WG2÷"FWf–6R7FGW2r“° ¢6öç7B÷Væ–æt6öÖÖ—BÒ3%$÷Væ–æt6öÖÖ—C°¢6öç7B÷Væ–ætÆ–æVvRÒv—B…²w&WbÖÆ—7BrÂrÒ×&VçG2rÂrÖârÂsrÂ÷Væ–æt6öÖÖ—EÒ’ç7Æ—B‚rr“°¢76W'B†÷Væ–ætÆ–æVvRæÆVæwF‚ÓÓÒ"Âw&÷VæB3R÷Væ–ær×W7B†fRW†7FÇ’öæR&VçBæBÖ’æ÷B&RÖW&vRr“°¢6öç7B&VG”6öÖÖ—BÒv—B…²w&Wb×'6RrÂG¶÷Væ–æt6öÖÖ—GÕæÒ“°¢6öç7B&VG•G&VRÒv—B…²w&Wb×'6RrÂG·&VG”6öÖÖ—GÕç·G&VWÖÒ“°¢6öç7B&VG”WF†÷&—G’Ò§6öäB‡&VG”6öÖÖ—BÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr“°¢76W'B‡3$–æ—F–Å&VG”66W72bb3$–æ—F–Å&VG”66W72çVæF–æu&WVW7Bbb&VG”6öÖÖ—BÓÓÒ3$–æ—F–Å&VG”66W72æFV6—6–öå&VG”6öÖÖ—BÂw&÷VæB3R&VçB—2æ÷BF†RÆFW7BgVÆÇ’fW&–f–VBÆ—fRÖ66W72$TE’7FFRr“°¢76W'B‡&VG”WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&W—$6öçG&öÅF‚bb&VG”WF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UrrÂw&÷VæB3R&VçB—2æ÷BF†RW†7B&÷VæB3B$TE’7F—fF–öâr“°¢76W'B‡3%$6öçG&öÂæVçG'’æ†VBÓÓÒ&VG”6öÖÖ—Bbb3%$6öçG&öÂæVçG'’çG&VRÓÓÒ&VG•G&VRÂw&÷VæB3RVçG'’FöW2æ÷B&–æB—G2W†7B$TE’&VçBr“°¢76W'DW†7D6†ævVEF‡2‡&VG”6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂW‡V7FVE3%$÷Væ–æuw&—FW2Âw&÷VæB3RW‡Æ–6—BÖ&÷fÂ÷Væ–ærr“°¢76W'B†f—'7DFD6öÖÖ—B‡3%$6öçG&öÅF‚’ÓÓÒ÷Væ–æt6öÖÖ—Bbbf—'7DFD6öÖÖ—B‡3%W6W$FV6—6–öäÆö6µF‚’ÓÓÒ÷Væ–æt6öÖÖ—BÂw&÷VæB3R6öçG&öÂæBW6W"ÖFV6—6–öâÆö6²vW&Ræ÷Bf—'7BFFVBFöÖ–6ÆÇ’r“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%$6öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%W6W$FV6—6–öäÆö6µF‚Â÷Væ–æt6öÖÖ—B“° ¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂv6†BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçDFV6—6–öäÆö6²rÂv&6RrÂw6÷W&6TFV6—6–öârÂvFV6—6–öârÂv&÷fÅ66÷RrÂv&÷fVEF&vWBrÂv66WFVBrÂv&÷VæF&–W2uÒÂw&÷VæBbW6W"ÖFV6—6–öâÆö6²r“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&6RÂ²v†VBrÂwG&VRuÒÂw&÷VæBbW6W"ÖFV6—6–öâ&6Rr“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâÂ²vÖW76vRrÂvWF†÷&—¦F–öä6öFRrÂvö'6W'fVDBrÂv–æfW'&VBuÒÂw&÷VæBb6÷W&6RFV6—6–öâr“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBÂ²w&Wf–Wu&÷WFRrÂw&VG”6öÖÖ—BrÂw&VG•G&VRrÂv6öçFVçD6öÖÖ—BrÂv6öçFVçEG&VRrÂv6öçFVçDÖæ–fW7E6†#SbrÂvvöÆFVäÖ7FW'2rÂvWf–FVæ6RrÂvFWÆ÷–ÖVçBrÂwFV×÷&'”66W72rÂv66W75&ööbuÒÂw&÷VæBb&÷fVBF&vWBr“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæWf–FVæ6RÂ²v7&—F–2rÂvf–æÄ§VFvRrÂv6ö×ÆWF–öârÂvFWÆ÷–ÖVçE&WVW7BrÂvFWÆ÷–ÖVçE&VF&6²uÒÂw&÷VæBbWf–FVæ6R&–æF–ærr“°¢f÷"†6öç7B¶¶W’ÂfÇVUÒöbö&¦V7BæVçG&–W2‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæWf–FVæ6R’’76W'DW†7D¶W•6WB‡fÇVRÂ²wF‚rÂv&Æö"uÒÂ&÷VæBbG¶¶W—ÒWf–FVæ6R&–æF–æv“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæFWÆ÷–ÖVçBÂ²v–BrÂv–Ö×WF&ÆUW&ÂrÂvVçf—&öæÖVçBrÂvv—F‡V$6öÖÖ—BrÂw&ö¦V7D–BrÂwFVÔ–BrÂw&öGV7F–öäÆ–46†ævVBuÒÂw&÷VæBbFWÆ÷–ÖVçB&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæ66W75&ööbÂ²w&WVW7BrÂw&VF&6²uÒÂw&÷VæBb66W72&ööbr“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæ66W75&ööbç&WVW7BÂ²wF‚rÂv&Æö"uÒÂw&÷VæBb66W72&WVW7B&ööbr“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæ66W75&ööbç&VF&6²Â²wF‚rÂv&Æö"uÒÂw&÷VæBb66W72&VF&6²&ööbr“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ66WFVBÂ²wW6W$&÷fVDvöÆFVäÖ7FW'2rÂvWf–FVæ6T66WFVDFVÆ—fW&&ÆW2uÒÂw&÷VæBb66WFVB6÷VçG2r“°¢76W'DW†7D¶W•6WB‡3%W6W$FV6—6–öäÆö6²æ&÷VæF&–W2Â²w3$6ö×ÆWFRrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw'VçF–ÖT–×ÆVÖVçFVBrÂw&öGV7F–öä76WG4&÷fVBrÂw&öGV7F–öå&VG’rÂw‡—6–6Ä•†öæUfW&–f–VBrÂw&öGV7F–öäÆ–46†ævVBuÒÂw&÷VæBbG'WF‚&÷VæF&–W2r“°¢76W'B‡3%W6W$FV6—6–öäÆö6²ç66†VÖfW'6–öâÓÓÒbb3%W6W$FV6—6–öäÆö6²æ'F–f7D–BÓÓÒw7FWÓÖ†W&òÖÖW&6†çBÖÆ&vRÖ–FÆRÖ–çFVw&F–öâ×W6W"ÖFV6—6–öâÖÆö6²×&÷VæBÓbrbb—46æöæ–6Ä—6ôFFR‡3%W6W$FV6—6–öäÆö6²æ7&VFVDB’Âw&÷VæBb–FVçF—G’÷"FFRÖ—6ÖF6‚r“°¢76W'B‡3%W6W$FV6—6–öäÆö6²æ6†BÓÓÒsEõ3"ÕôvöÆFVäÖ7FW.ŠŠÞŠˆ‚rbb3%W6W$FV6—6–öäÆö6²ç&W÷6—F÷'’ÓÓÒ3%$6öçG&öÂç&W÷6—F÷'’bb3%W6W$FV6—6–öäÆö6²æ'&æ6‚ÓÓÒv¶–Ö’rbb3%W6W$FV6—6–öäÆö6²ç&VçDFV6—6–öäÆö6²ÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ†W&òÖÖW&6†çBÖÆ&vRÖ–FÆRÖ–çFVw&F–öâ÷W6W"ÖFV6—6–öâÖÆö6²×&÷VæBÓRæ§6öârÂw&÷VæBb6†BÂ&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6‚r“°¢76W'B‡3%W6W$FV6—6–öäÆö6²æ&6Ræ†VBÓÓÒ&VG”6öÖÖ—Bbb3%W6W$FV6—6–öäÆö6²æ&6RçG&VRÓÓÒ&VG•G&VRÂw&÷VæBbFöW2æ÷B&–æBF†RW†7B$TE’F&vWB6VVâ'’F†RW6W"r“°¢6öç7BW‡V7FVD6öçFVçDÖæ–fW7DF–vW7BÒ6†#Sc¢G·6†#Sd6æöæ–6Â‡3%&Wf–Wu&Vf—‚æ6öçFVçDÖæ–fW7B—Ö°¢6öç7BW‡V7FVD&÷fÄÖW76vRÒ$õdUõ3%õôtÕôdõ%õ"$TE•ô4ôÔÔ•CÒG·&VG”6öÖÖ—GÒ$TE•õE$TSÒG·&VG•G&VWÒ4ôåDTåEôÔä”dU5Eõ4„#ScÒG¶W‡V7FVD6öçFVçDÖæ–fW7DF–vW7GÖ°¢76W'B‡3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæÖW76vRÓÓÒW‡V7FVD&÷fÄÖW76vRÂw&÷VæBbFöW2æ÷B6öçF–âF†RW†7BF&vWBÖ&÷VæBöæR×F–ÖR&÷fÂ6öÖÖæBr“°¢76W'B‡3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæWF†÷&—¦F–öä6öFRÓÓÒt$õdUõ3%õôtÕôdõ%õ"rÂw&÷VæBbW‡Æ–6—B&÷fÂWF†÷&—¦F–öâ6öFRÖ—6ÖF6‚r“°¢76W'B†—46æöæ–6Ä—6ô–ç7FçB‡3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDB’bb3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæ–æfW'&VBÓÓÒfÇ6RÂw&÷VæBb&÷fÂv2–æfW'&VB÷"Æ6·2âW†7Bö'6W'fF–öâF–ÖRr“°¢76W'B‡3%W6W$FV6—6–öäÆö6²æFV6—6–öâÓÓÒt$õdTEõ3%ôtôÄDTåôÔ5DU%õôdõ%õ%ô54UEõ$ôET5D”ôârbb3%W6W$FV6—6–öäÆö6²æ&÷fÅ66÷RÓÓÒu3%õôtôÄDTåôÔ5DU%õd•5TÅôD•$T5D”ôåôôäÅ’rÂw&÷VæBbFV6—6–öâ÷"66÷RÖ—6ÖF6‚r“°¢76W'B‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBç&Wf–Wu&÷WFRÓÓÒr÷7FWB÷3"övöÆFVâÖÖ7FW"×òrbb3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBç&VG”6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBç&VG•G&VRÓÓÒ&VG•G&VRÂw&÷VæBb$TE’F&vWBÖ—6ÖF6‚r“°¢76W'B‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæ6öçFVçD6öÖÖ—BÓÓÒ3%&Wf–Wu&Vf—‚çF&vWD6öÖÖ—Bbb3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæ6öçFVçEG&VRÓÓÒ3%&Wf–Wu&Vf—‚çF&vWEG&VRÂw&÷VæBb6öçFVçBF&vWBÖ—6ÖF6‚r“°¢76W'B‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæ6öçFVçDÖæ–fW7E6†#SbÓÓÒW‡V7FVD6öçFVçDÖæ–fW7DF–vW7BÂw&÷VæBb6öçFVçBÖÖæ–fW7BF–vW7BÖ—6ÖF6‚r“°¢6öç7B7&—F–2Ò§6öâ‡3%&Wf–WtWf–FVæ6UF‡2æ7&—F–2“°¢76W'B„¥4ôâç7G&–æv–g’‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBævöÆFVäÖ7FW'2’ÓÓÒ¥4ôâç7G&–æv–g’†7&—F–2ç67&VVç6†÷G2’Âw&÷VæBbFöW2æ÷B&–æBF†RW†7BV–v‡BÖÖ7FW"æB&W7öç6—fR67&VVç6†÷B6WBr“°¢6öç7BW‡V7FVDFV6—6–öäWf–FVæ6RÒö&¦V7Bæg&öÔVçG&–W2„ö&¦V7BæVçG&–W2‡3%&Wf–WtWf–FVæ6UF‡2’æÖ‚…¶¶W’Âf–ÆUÒ’Óâ¶¶W’Â²Fƒ¢f–ÆRÂ&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G¶f–ÆWÖÒ’ÕÒ’“°¢76W'B„¥4ôâç7G&–æv–g’‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæWf–FVæ6R’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDFV6—6–öäWf–FVæ6R’Âw&÷VæBbWf–FVæ6RF‚ö&Æö"6WBÖ—6ÖF6‚r“°¢6öç7BFWÆ÷–ÖVçE&VF&6²Ò3$–æ—F–Å&VG”66W72æ7W'&VçE&VF&6³°¢6öç7BFWÆ÷–ÖVçE&WVW7BÒ3$–æ—F–Å&VG”66W72æ7W'&VçE&WVW7C°¢76W'B„¥4ôâç7G&–æv–g’‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæ66W75&ööb’ÓÓÒ¥4ôâç7G&–æv–g’‡²&WVW7C¢²Fƒ¢3$–æ—F–Å&VG”66W72æ7W'&VçE&WVW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3$–æ—F–Å&VG”66W72æ7W'&VçE&WVW7EF‡ÖÒ’ÒÂ&VF&6³¢²Fƒ¢3$–æ—F–Å&VG”66W72æ7W'&VçE&VF&6µF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3$–æ—F–Å&VG”66W72æ7W'&VçE&VF&6µF‡ÖÒ’ÒÒ’Âw&÷VæBb&÷fÂFöW2æ÷B&–æBF†RW†7BÆFW7B66W72×&VæWvÂ&ööbr“°¢6öç7B&÷fÄö'6W'fVDBÒFFRç'6R‡3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDB“°¢6öç7B&VG”6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ&VG”6öÖÖ—EÒ’“°¢6öç7B÷Væ–æt6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ÷Væ–æt6öÖÖ—EÒ’“°¢6öç7B6æöæ–6Äö'6W'fVDBÒçVÖ&W"æ—4f–æ—FR†&÷fÄö'6W'fVDB’òæWrFFR†&÷fÄö'6W'fVDB’çFô•4õ7G&–ær‚’ç&WÆ6R‚rã¢rÂu¢r’¢rs°¢6öç7B66W74W‡—'’ÒFFRç'6R†FWÆ÷–ÖVçE&WVW7Bç&Wf–WrçFV×÷&'”66W72æW‡—&W4Bóòrr“°¢76W'B†6æöæ–6Äö'6W'fVDBÓÓÒ3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBbb&÷fÄö'6W'fVDBãÒFFRç'6R†FWÆ÷–ÖVçE&VF&6²çfW&–f–VD‡GGçfW&–f–VDB’bb&÷fÄö'6W'fVDBãÒ&VG”6öÖÖ—GFVDBbb&÷fÄö'6W'fVDBÃÒ66W74W‡—'’bb&÷fÄö'6W'fVDBÃÒ÷Væ–æt6öÖÖ—GFVDBbb÷Væ–æt6öÖÖ—GFVDBÒ&÷fÄö'6W'fVDBÃÒ#B¢c¢c¢bb3%W6W$FV6—6–öäÆö6²æ7&VFVDBÓÓÒ3%W6W$FV6—6–öäÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBç6Æ–6RƒÂ’bb3%$6öçG&öÂæ7&VFVDBÓÓÒ3%W6W$FV6—6–öäÆö6²æ7&VFVDBÂw&÷VæBb&÷fÂF–ÖR—2÷WG6–FRF†RW†7BFWÆ÷–VB×F&vWBÂÆ—fRFV×÷&'’Ö66W72Â$TE’æB#BÖ†÷W"÷Væ–ær–çFW'fÂr“°¢76W'B„¥4ôâç7G&–æv–g’‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBçFV×÷&'”66W72’ÓÓÒ¥4ôâç7G&–æv–g’†FWÆ÷–ÖVçE&WVW7Bç&Wf–WrçFV×÷&'”66W72’Âw&÷VæBb&÷fÂFöW2æ÷B&–æBF†RW†7BÆ—fRFV×÷&'’&Wf–Wr66W72U$ÂæBW‡—'’r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%W6W$FV6—6–öäÆö6²æ&÷fVEF&vWBæFWÆ÷–ÖVçB’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢–C¢FWÆ÷–ÖVçE&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–BÀ¢–Ö×WF&ÆUW&Ã¢FWÆ÷–ÖVçE&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–Ö×WF&ÆUW&ÂÀ¢Vçf—&öæÖVçC¢u&Wf–WrrÀ¢v—F‡V$6öÖÖ—C¢3%&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÀ¢&ö¦V7D–C¢w&¥ó4—6SU”×“•66…e33f–&¤¥”Ä"rÀ¢FVÔ–C¢wFVÕóföE¤5¥†§¦…D3—6tWFô4ÒrÀ¢&öGV7F–öäÆ–46†ævVC¢fÇ6P¢Ò’Âw&÷VæBbFWÆ÷–ÖVçBF&vWBF–ffW'2g&öÒF†R&Wf–WvVB&Wf–Wrr“°¢76W'B„¥4ôâç7G&–æv–g’‡3%W6W$FV6—6–öäÆö6²æ66WFVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²W6W$&÷fVDvöÆFVäÖ7FW'3¢‚ÂWf–FVæ6T66WFVDFVÆ—fW&&ÆW3¢Ò’Âw&÷VæBb66WFVB6÷VçG2Ö—6ÖF6‚r“°¢76W'B„ö&¦V7BçfÇVW2‡3%W6W$FV6—6–öäÆö6²æ&÷VæF&–W2’æWfW'’‡fÇVRÓâfÇVRÓÓÒfÇ6R’Âw&÷VæBb&÷fÂ÷fW&6Æ–×26ö×ÆWF–öâÂ'VçF–ÖRÂ&VÆV6R÷"FWf–6R7FFRr“°¢76W'B‡3%$6öçG&öÂçW6W$FV6—6–öäÆö6²çF‚ÓÓÒ3%W6W$FV6—6–öäÆö6µF‚bb3%$6öçG&öÂçW6W$FV6—6–öäÆö6²æ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·3%W6W$FV6—6–öäÆö6µF‡ÖÒ’Âw&÷VæB3RFöW2æ÷B&–æBF†R–Ö×WF&ÆR&÷VæBbFV6—6–öâÆö6²r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%$6öçG&öÂç&VF–æW72’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢–çFW&æÅ¢À¢–çFW&æÅ¢À¢W6W$&÷fVDvöÆFVäÖ7FW'3¢‚À¢Wf–FVæ6T66WFVDFVÆ—fW&&ÆW3¢À¢3E&V6÷fW'”f–æF–æs¢tõTåõ3Eõ$T4õdU%•õd•5órÀ¢&VG”6öÖÖ—BÀ¢&VG•G&VRÀ¢6öçFVçD6öÖÖ—C¢3%&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÀ¢6öçFVçEG&VS¢3%&Wf–Wu&Vf—‚çF&vWEG&VRÀ¢7&—F–3¢W‡V7FVDFV6—6–öäWf–FVæ6Ræ7&—F–2À¢FWÆ÷–ÖVçE&VF&6³¢W‡V7FVDFV6—6–öäWf–FVæ6RæFWÆ÷–ÖVçE&VF&6°¢Ò’Âw&÷VæB3R&VF–æW72FöW2æ÷BW†7FÇ’FW&—fRg&öÒF†R&÷fVBF&vWBr“°¢76W'B‡3%$6öçG&öÂæVçG'•v÷&¶fÆ÷ræ6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb3%$6öçG&öÂæVçG'•v÷&¶fÆ÷rçG&VRÓÓÒ&VG•G&VRÂw&÷VæB3RVçG'’v÷&¶fÆ÷rFöW2æ÷BF&vWBF†RW†7B$TE’&VçBr“°¢76W'Ev÷&¶fÆ÷tWf–FVæ6T¶W—2‡3%$6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæB3RVçG'’v÷&¶fÆ÷rrÂG'VR“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R‡3%$6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæB3RVçG'’r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂW‡V7FVE&÷VæC3TFö7VÖVçEFW‡BÂw&÷VæB3R÷Væ–ærFö7VÖVçG2r“°¢76W'DæõF„6†ævW56–æ6R‡3%&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%&Wf–Wu&Vf—‚æ6öçFVçDÖæ–fW7BæÖ†VçG'’ÓâVçG'’çF‚’Âv&÷fVB3"vöÆFVâÖ7FW"g&VW¦RgFW"&÷VæB3Rr“°¢6öç7B&÷VæC3Tg&VW¦TVæBÒ3$76WE74÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3$76WE74÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'DæõF„6†ævW56–æ6R†÷Væ–æt6öÖÖ—BÂ&÷VæC3Tg&VW¦TVæBÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæB3R7W'&VçBÖ—'&÷'2×W7B&VÖ–âg&÷¦Vâ&Vf÷&RW†7B55ô54UB7F—fF–öâr“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂ&VG•G&VRÓ°§Ð ¦6öç7B3%$&÷fÂÒfW&–g•3%$&÷fÄ†æFöfb‚“°¦gVæ7F–öâfW&–g•3%&Wf—6VE$&÷fÄ†æFöfb‚’°¢76W'B„&ööÆVâ‡3%&Wf—6VE$6öçG&öÂ’ÓÓÒ&ööÆVâ‡3%&Wf—6VD&÷fÄÆö6²’Âw&÷VæB3r6öçG&öÂæB&÷VæB‚&Wf—6VB×F&vWB&÷fÂÆö6²×W7BV"FöÖ–6ÆÇ’r“°¢–b‚3%&Wf—6VE$6öçG&öÂ’&WGW&âçVÆÃ°¢76W'B‚3%$6öçG&öÂbb3%W6W$FV6—6–öäÆö6²Âw&÷VæB3r&Wf—6VB&÷fÂ—2×WGVÆÇ’W†6ÇW6—fRv—F‚–æ—F–Â&÷VæB3R&÷fÂr“°¢76W'B‡3%&Wf—6–öä6öçG&öÂbb3%&Wf—6–öäFV6—6–öäÆö6²bb3%&Wf—6–öä†æFöfcòç&Wf—6VE&VG”6öÖÖ—Bbb3%&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—ƒòç&VF&6´6öÖÖ—BÂw&÷VæB3r&WV—&W2F†R6ö×ÆWFR&÷VæB3b&Wf—6–öâÂ&÷VæB"&Wf–WræBFVF–6FVB&Wf—6VB$TE’7F—fF–öâr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂvVçG'•v÷&¶fÆ÷rrÂwW6W$FV6—6–öäÆö6²rÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂw&VF–æW72rÂvæW‡DWF†÷&—¦VD7F–öârÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂw&÷VæB3r6öçG&öÂr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂw&÷VæB3rVçG'’r“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂçW6W$FV6—6–öäÆö6²Â²wF‚rÂv&Æö"uÒÂw&÷VæB3rFV6—6–öâÖÆö6²&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂç&VF–æW72Â²v–çFW&æÅrÂv–çFW&æÅrÂwW6W$&÷fVDvöÆFVäÖ7FW'2rÂvWf–FVæ6T66WFVDFVÆ—fW&&ÆW2rÂw3E&V6÷fW'”f–æF–ærrÂw&VG”6öÖÖ—BrÂw&VG•G&VRrÂv6öçFVçD6öÖÖ—BrÂv6öçFVçEG&VRrÂv66WFæ6TÖG&—‚rÂvfV6–&–Æ—G”VF—BrÂv7&—F–2rÂvFWÆ÷–ÖVçE&VF&6²uÒÂw&÷VæB3r&VF–æW72r“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂç&VF–æW72æ66WFæ6TÖG&—‚Â²wF‚rÂv&Æö"uÒÂw&÷VæB3r66WFæ6R&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂç&VF–æW72æfV6–&–Æ—G”VF—BÂ²wF‚rÂv&Æö"uÒÂw&÷VæB3rfV6–&–Æ—G’&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂç&VF–æW72æ7&—F–2Â²wF‚rÂv&Æö"uÒÂw&÷VæB3r7&—F–2&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂç&VF–æW72æFWÆ÷–ÖVçE&VF&6²Â²wF‚rÂv&Æö"uÒÂw&÷VæB3rFWÆ÷–ÖVçB&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VE$6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²w7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öä76WG4&÷fVBrÂwGvVÇfU67&VVç4&÷fVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂvÖ†–×VÕfW&F–7BrÂvÖ”æ÷DFV6Æ&RuÒÂw&÷VæB3r6ö×ÆWF–öâ&÷VæF'’r“°¢76W'B‡3%&Wf—6VE$6öçG&öÂç66†VÖfW'6–öâÓÓÒbb3%&Wf—6VE$6öçG&öÂæ'F–f7D–BÓÓÒv6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3rrbb—46æöæ–6Ä—6ôFFR‡3%&Wf—6VE$6öçG&öÂæ7&VFVDB’Âw&÷VæB3r–FVçF—G’÷"FFRÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6VE$6öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3%&Wf—6VE$6öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb3%&Wf—6VE$6öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ3%&Wf—6–öä6öçG&öÅF‚Âw&÷VæB3r&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6VE$6öçG&öÂç7FGW2ÓÓÒt”åõ$ôu$U52rbb3%&Wf—6VE$6öçG&öÂçfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârbb3%&Wf—6VE$6öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb3%&Wf—6VE$6öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"Õ"Ô54UBÕ$ôET5D”ôârbb3%&Wf—6VE$6öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6RÂw&÷VæB3r†6R÷"fW&F–7BÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6VE$6öçG&öÂç66÷RÓÓÒu3%õ%õ$U$U4TåDD•dUõ$ôET5D”ôåô54UEõ$ôôeôe$ôÕõ$Ud•4TEôtôÄDTåôÔ5DU%ôôäÅ’rbb3%&Wf—6VE$6öçG&öÂææW‡DWF†÷&—¦VD7F–öâÓÓÒt7&VFRæB–æFWVæFVçFÇ’fW&–g’öæR&W&W6VçFF—fR&öGV7F–öâÖ76WB6WBg&öÒF†R&÷fVB&Wf—6VBvöÆFVâÖ7FW"&Vf÷&Rç’föÇVÖRvVæW&F–öâ÷"'VçF–ÖR&WÆ6VÖVçBârÂw&÷VæB3r66÷R÷"æW‡B7F–öâW†6VVG2F†R&W&W6VçFF—fR&Wf—6VB×F&vWB76WB&ööbr“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VE$6öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3%$ÆÆ÷vVEw&—FW2’bb¥4ôâç7G&–æv–g’‡3%&Wf—6VE$6öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3%$f÷&&–FFVåw&—FW2’Âw&÷VæB3rw&—FR&÷VæF'’Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VE$6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FWE73¢fÇ6RÀ¢7FWTÆÆ÷vVC¢fÇ6RÀ¢&öGV7F–öäÆÆ÷vVC¢fÇ6RÀ¢&öGV7F–öä76WG4&÷fVC¢fÇ6RÀ¢GvVÇfU67&VVç4&÷fVC¢À¢&öGV7F–öäÆ–46†ævVC¢fÇ6RÀ¢‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÀ¢Ö†–×VÕfW&F–7C¢u$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârÀ¢Ö”æ÷DFV6Æ&S¢²u3"6ö×ÆWFRrÂu7FWB52rÂu7FWRÆÆ÷vVBrÂw'VçF–ÖR–×ÆVÖVçFVBrÂw&öGV7F–öâ76WG2&÷fVBrÂu&öGV7F–öâ&VG’rÂw‡—6–6Â•†öæRfW&–f–VBrÂu&öGV7F–öâÆ–26†ævVBuÐ¢Ò’Âw&÷VæB3r6ö×ÆWF–öâ&÷VæF'’÷fW&6Æ–×2&VÆV6RÂ'VçF–ÖRÂ76WG2÷"FWf–6R7FGW2r“° ¢6öç7B÷Væ–æt6öÖÖ—BÒ3%&Wf—6VE$÷Væ–æt6öÖÖ—C°¢6öç7B÷Væ–ætÆ–æVvRÒv—B…²w&WbÖÆ—7BrÂrÒ×&VçG2rÂrÖârÂsrÂ÷Væ–æt6öÖÖ—EÒ’ç7Æ—B‚rr“°¢76W'B†÷Væ–ætÆ–æVvRæÆVæwF‚ÓÓÒ"Âw&÷VæB3r÷Væ–ær×W7B†fRW†7FÇ’öæR&VçBæBÖ’æ÷B&RÖW&vRr“°¢6öç7B&VG”6öÖÖ—BÒv—B…²w&Wb×'6RrÂG¶÷Væ–æt6öÖÖ—GÕæÒ“°¢6öç7B&VG•G&VRÒv—B…²w&Wb×'6RrÂG·&VG”6öÖÖ—GÕç·G&VWÖÒ“°¢76W'B‡3%&Wf—6–öä†æFöfbç&VG”66W72bb3%&Wf—6–öä†æFöfbç&VG”66W72çVæF–æu&WVW7Bbb&VG”6öÖÖ—BÓÓÒ3%&Wf—6–öä†æFöfbç&VG”66W72æFV6—6–öå&VG”6öÖÖ—BÂw&÷VæB3r&VçB—2æ÷BF†RÆFW7BgVÆÇ’fW&–f–VB&÷VæB"Æ—fRÖ66W72$TE’7FFRr“°¢6öç7B&VG”WF†÷&—G’Ò§6öäB‡&VG”6öÖÖ—BÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr“°¢76W'B‡&VG”WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&Wf—6–öä6öçG&öÅF‚bb&VG”WF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UrrÂw&÷VæB3r&VçB—2æ÷BF†RW†7B&Wf—6VB$TE’7FFR6†÷vâFòF†RW6W"r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VE$6öçG&öÂæVçG'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’Âw&÷VæB3rVçG'’FöW2æ÷B&–æBF†RW†7B&Wf—6VB$TE’&VçBr“°¢76W'DW†7D6†ævVEF‡2‡&VG”6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂW‡V7FVE3%&Wf—6VE$÷Væ–æuw&—FW2Âw&÷VæB3rFöÖ–2&Wf—6VB×F&vWB&÷fÂ÷Væ–ærr“°¢76W'B†f—'7DFD6öÖÖ—B‡3%&Wf—6VE$6öçG&öÅF‚’ÓÓÒ÷Væ–æt6öÖÖ—Bbbf—'7DFD6öÖÖ—B‡3%&Wf—6VD&÷fÄÆö6µF‚’ÓÓÒ÷Væ–æt6öÖÖ—BÂw&÷VæB3r6öçG&öÂæB&÷VæB‚&÷fÂÆö6²vW&Ræ÷Bf—'7BFFVBFöÖ–6ÆÇ’r“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%&Wf—6VE$6öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%&Wf—6VD&÷fÄÆö6µF‚Â÷Væ–æt6öÖÖ—B“° ¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂv6†BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçDFV6—6–öäÆö6²rÂv&6RrÂw6÷W&6TFV6—6–öârÂvFV6—6–öârÂv&÷fÅ66÷RrÂv&÷fVEF&vWBrÂv66WFVBrÂv&÷VæF&–W2uÒÂw&÷VæB‚W6W"ÖFV6—6–öâÆö6²r“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&6RÂ²v†VBrÂwG&VRuÒÂw&÷VæB‚&÷fÂ&6Rr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²ç6÷W&6TFV6—6–öâÂ²vÖW76vRrÂvWF†÷&—¦F–öä6öFRrÂvö'6W'fVDBrÂv–æfW'&VBuÒÂw&÷VæB‚&÷fÂ6÷W&6Rr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBÂ²w&Wf–Wu&÷WFRrÂw&VG”6öÖÖ—BrÂw&VG•G&VRrÂv6öçFVçD6öÖÖ—BrÂv6öçFVçEG&VRrÂv6öçFVçDÖæ–fW7E6†#SbrÂvvöÆFVäÖ7FW'2rÂvWf–FVæ6RrÂvFWÆ÷–ÖVçBrÂwFV×÷&'”66W72rÂv66W75&ööbuÒÂw&÷VæB‚&÷fVBF&vWBr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæWf–FVæ6RÂ²v66WFæ6TÖG&—‚rÂvfV6–&–Æ—G”VF—BrÂv7&—F–2rÂvf–æÄ§VFvRrÂv6ö×ÆWF–öârÂvFWÆ÷–ÖVçE&WVW7BrÂvFWÆ÷–ÖVçE&VF&6²uÒÂw&÷VæB‚Wf–FVæ6R&–æF–ærr“°¢f÷"†6öç7B¶¶W’ÂfÇVUÒöbö&¦V7BæVçG&–W2‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæWf–FVæ6R’’76W'DW†7D¶W•6WB‡fÇVRÂ²wF‚rÂv&Æö"uÒÂ&÷VæB‚G¶¶W—ÒWf–FVæ6R&–æF–æv“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæFWÆ÷–ÖVçBÂ²v–BrÂv–Ö×WF&ÆUW&ÂrÂvVçf—&öæÖVçBrÂvv—F‡V$6öÖÖ—BrÂw&ö¦V7D–BrÂwFVÔ–BrÂw&öGV7F–öäÆ–46†ævVBuÒÂw&÷VæB‚FWÆ÷–ÖVçB&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæ66W75&ööbÂ²w&WVW7BrÂw&VF&6²uÒÂw&÷VæB‚66W72&ööbr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæ66W75&ööbç&WVW7BÂ²wF‚rÂv&Æö"uÒÂw&÷VæB‚66W72&WVW7B&ööbr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæ66W75&ööbç&VF&6²Â²wF‚rÂv&Æö"uÒÂw&÷VæB‚66W72&VF&6²&ööbr“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ66WFVBÂ²wW6W$&÷fVDvöÆFVäÖ7FW'2rÂvWf–FVæ6T66WFVDFVÆ—fW&&ÆW2uÒÂw&÷VæB‚66WFVB6÷VçG2r“°¢76W'DW†7D¶W•6WB‡3%&Wf—6VD&÷fÄÆö6²æ&÷VæF&–W2Â²w3$6ö×ÆWFRrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw'VçF–ÖT–×ÆVÖVçFVBrÂw&öGV7F–öä76WG4&÷fVBrÂw&öGV7F–öå&VG’rÂw‡—6–6Ä•†öæUfW&–f–VBrÂw&öGV7F–öäÆ–46†ævVBuÒÂw&÷VæB‚G'WF‚&÷VæF&–W2r“°¢76W'B‡3%&Wf—6VD&÷fÄÆö6²ç66†VÖfW'6–öâÓÓÒbb3%&Wf—6VD&÷fÄÆö6²æ'F–f7D–BÓÓÒw7FWÓÖ†W&òÖÖW&6†çBÖÆ&vRÖ–FÆRÖ–çFVw&F–öâ×W6W"ÖFV6—6–öâÖÆö6²×&÷VæBÓ‚rbb—46æöæ–6Ä—6ôFFR‡3%&Wf—6VD&÷fÄÆö6²æ7&VFVDB’Âw&÷VæB‚–FVçF—G’÷"FFRÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6VD&÷fÄÆö6²æ6†BÓÓÒsEõ3"ÕôvöÆFVäÖ7FW.ŠŠÞŠˆ‚rbb3%&Wf—6VD&÷fÄÆö6²ç&W÷6—F÷'’ÓÓÒ3%&Wf—6VE$6öçG&öÂç&W÷6—F÷'’bb3%&Wf—6VD&÷fÄÆö6²æ'&æ6‚ÓÓÒv¶–Ö’rbb3%&Wf—6VD&÷fÄÆö6²ç&VçDFV6—6–öäÆö6²ÓÓÒ3%&Wf—6–öäFV6—6–öäÆö6µF‚Âw&÷VæB‚6†BÂ&W÷6—F÷'’Â'&æ6‚÷"&VçBFV6—6–öâÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VD&÷fÄÆö6²æ&6R’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’Âw&÷VæB‚FöW2æ÷B&–æBF†RW†7B&Wf—6VB$TE’F&vWB6VVâ'’F†RW6W"r“°¢6öç7B6öçFVçDÖæ–fW7BÒ3%&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—‚æ6öçFVçDÖæ–fW7C°¢6öç7B6öçFVçDÖæ–fW7E6†#SbÒ6†#Sc¢G·6†#Sd6æöæ–6Â†6öçFVçDÖæ–fW7B—Ö°¢6öç7BW‡V7FVD&÷fÄÖW76vRÒ$õdUõ3%õôtÕôdõ%õ"$TE•ô4ôÔÔ•CÒG·&VG”6öÖÖ—GÒ$TE•õE$TSÒG·&VG•G&VWÒ4ôåDTåEôÔä”dU5Eõ4„#ScÒG¶6öçFVçDÖæ–fW7E6†#SgÖ°¢76W'B‡3%&Wf—6VD&÷fÄÆö6²ç6÷W&6TFV6—6–öâæÖW76vRÓÓÒW‡V7FVD&÷fÄÖW76vRbb3%&Wf—6VD&÷fÄÆö6²ç6÷W&6TFV6—6–öâæWF†÷&—¦F–öä6öFRÓÓÒt$õdUõ3%õôtÕôdõ%õ"rbb3%&Wf—6VD&÷fÄÆö6²ç6÷W&6TFV6—6–öâæ–æfW'&VBÓÓÒfÇ6RÂw&÷VæB‚Æ6·2F†RW†7B&Wf—6VB×F&vWBöæR×F–ÖR&÷fÂ6öÖÖæBr“°¢76W'B‡3%&Wf—6VD&÷fÄÆö6²æFV6—6–öâÓÓÒt$õdTEõ$Ud•4TEõ3%ôtôÄDTåôÔ5DU%õôdõ%õ%ô54UEõ$ôET5D”ôârbb3%&Wf—6VD&÷fÄÆö6²æ&÷fÅ66÷RÓÓÒu$Ud•4TEõ3%õôtôÄDTåôÔ5DU%õd•5TÅôD•$T5D”ôåôôäÅ’rÂw&÷VæB‚FV6—6–öâ÷"66÷RÖ—6ÖF6‚r“°¢6öç7BF&vWD6öÖÖ—BÒ3%&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—‚çF&vWD6öÖÖ—C°¢6öç7BF&vWEG&VRÒ3%&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—‚çF&vWEG&VS°¢76W'B‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBç&Wf–Wu&÷WFRÓÓÒr÷7FWB÷3"övöÆFVâÖÖ7FW"×òrbb3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBç&VG”6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBç&VG•G&VRÓÓÒ&VG•G&VRbb3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæ6öçFVçD6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæ6öçFVçEG&VRÓÓÒF&vWEG&VRbb3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæ6öçFVçDÖæ–fW7E6†#SbÓÓÒ6öçFVçDÖæ–fW7E6†#SbÂw&÷VæB‚&Wf—6VB$TE’ö6öçFVçBf–ævW'&–çBÖ—6ÖF6‚r“°¢6öç7B7&—F–2Ò§6öâ‡3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2æ7&—F–2“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBævöÆFVäÖ7FW'2’ÓÓÒ¥4ôâç7G&–æv–g’†7&—F–2ç67&VVç6†÷G2’Âw&÷VæB‚FöW2æ÷B&–æBF†RW†7B&Wf—6VBvöÆFVâÖ7FW"æB&W7öç6—fR67&VVç6†÷B6WBr“°¢6öç7BW‡V7FVDWf–FVæ6RÒö&¦V7Bæg&öÔVçG&–W2„ö&¦V7BæVçG&–W2‡3%&Wf—6–öå&Wf–WtWf–FVæ6UF‡2’æÖ‚…¶¶W’Âf–ÆUÒ’Óâ¶¶W’Â²Fƒ¢f–ÆRÂ&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G¶f–ÆWÖÒ’ÕÒ’“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæWf–FVæ6R’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDWf–FVæ6R’Âw&÷VæB‚Wf–FVæ6RF‚ö&Æö"6WBF–ffW'2g&öÒF†R–Ö×WF&ÆR&÷VæB"6†–âr“°¢6öç7B&VF&6²Ò3%&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&VF&6³°¢6öç7BFWÆ÷–ÖVçE&WVW7BÒ3%&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&WVW7C°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæ66W75&ööb’ÓÓÒ¥4ôâç7G&–æv–g’‡²&WVW7C¢²Fƒ¢3%&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&WVW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&WVW7EF‡ÖÒ’ÒÂ&VF&6³¢²Fƒ¢3%&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&VF&6µF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&VF&6µF‡ÖÒ’ÒÒ’Âw&÷VæB‚&÷fÂFöW2æ÷B&–æBF†RW†7BÆFW7B66W72×&VæWvÂ&ööbr“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBæFWÆ÷–ÖVçB’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢–C¢&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–BÀ¢–Ö×WF&ÆUW&Ã¢&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–Ö×WF&ÆUW&ÂÀ¢Vçf—&öæÖVçC¢u&Wf–WrrÀ¢v—F‡V$6öÖÖ—C¢F&vWD6öÖÖ—BÀ¢&ö¦V7D–C¢w&¥ó4—6SU”×“•66…e33f–&¤¥”Ä"rÀ¢FVÔ–C¢wFVÕóföE¤5¥†§¦…D3—6tWFô4ÒrÀ¢&öGV7F–öäÆ–46†ævVC¢fÇ6P¢Ò’Âw&÷VæB‚FWÆ÷–ÖVçBF&vWBF–ffW'2g&öÒF†R&Wf—6VB&Wf–WvVB&Wf–Wrr“°¢6öç7B&÷fÄö'6W'fVDBÒFFRç'6R‡3%&Wf—6VD&÷fÄÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBóòrr“°¢6öç7B&VG”6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ&VG”6öÖÖ—EÒ’“°¢6öç7B÷Væ–æt6öÖÖ—GFVDBÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ÷Væ–æt6öÖÖ—EÒ’“°¢6öç7B6æöæ–6Äö'6W'fVDBÒçVÖ&W"æ—4f–æ—FR†&÷fÄö'6W'fVDB’òæWrFFR†&÷fÄö'6W'fVDB’çFô•4õ7G&–ær‚’ç&WÆ6R‚rã¢rÂu¢r’¢rs°¢6öç7B66W74W‡—'’ÒFFRç'6R†FWÆ÷–ÖVçE&WVW7Bç&Wf–WrçFV×÷&'”66W72æW‡—&W4Bóòrr“°¢76W'B†6æöæ–6Äö'6W'fVDBÓÓÒ3%&Wf—6VD&÷fÄÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBbb&÷fÄö'6W'fVDBãÒFFRç'6R‡&VF&6²çfW&–f–VD‡GGçfW&–f–VDB’bb&÷fÄö'6W'fVDBãÒ&VG”6öÖÖ—GFVDBbb&÷fÄö'6W'fVDBÃÒ66W74W‡—'’bb&÷fÄö'6W'fVDBÃÒ÷Væ–æt6öÖÖ—GFVDBbb÷Væ–æt6öÖÖ—GFVDBÒ&÷fÄö'6W'fVDBÃÒ#B¢c¢c¢bb3%&Wf—6VD&÷fÄÆö6²æ7&VFVDBÓÓÒ3%&Wf—6VD&÷fÄÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBç6Æ–6RƒÂ’bb3%&Wf—6VE$6öçG&öÂæ7&VFVDBÓÓÒ3%&Wf—6VD&÷fÄÆö6²æ7&VFVDBÂw&÷VæB‚&÷fÂF–ÖR—2÷WG6–FRF†R&Wf—6VBFWÆ÷–VB×F&vWBÂÆ—fRFV×÷&'’Ö66W72Â$TE’æB#BÖ†÷W"÷Væ–ær–çFW'fÂr“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VD&÷fÄÆö6²æ&÷fVEF&vWBçFV×÷&'”66W72’ÓÓÒ¥4ôâç7G&–æv–g’†FWÆ÷–ÖVçE&WVW7Bç&Wf–WrçFV×÷&'”66W72’Âw&÷VæB‚&÷fÂFöW2æ÷B&–æBF†RW†7BÆ—fRFV×÷&'’&Wf–Wr66W72U$ÂæBW‡—'’r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VD&÷fÄÆö6²æ66WFVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²W6W$&÷fVDvöÆFVäÖ7FW'3¢‚ÂWf–FVæ6T66WFVDFVÆ—fW&&ÆW3¢Ò’bbö&¦V7BçfÇVW2‡3%&Wf—6VD&÷fÄÆö6²æ&÷VæF&–W2’æWfW'’‡fÇVRÓâfÇVRÓÓÒfÇ6R’Âw&÷VæB‚66WFVB6÷VçG2÷"G'WF‚&÷VæF&–W2÷fW&6Æ–Ò6ö×ÆWF–öâ÷'VçF–ÖR÷&VÆV6RöFWf–6R7FFRr“°¢76W'B‡3%&Wf—6VE$6öçG&öÂçW6W$FV6—6–öäÆö6²çF‚ÓÓÒ3%&Wf—6VD&÷fÄÆö6µF‚bb3%&Wf—6VE$6öçG&öÂçW6W$FV6—6–öäÆö6²æ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·3%&Wf—6VD&÷fÄÆö6µF‡ÖÒ’Âw&÷VæB3rFöW2æ÷B&–æB–Ö×WF&ÆR&÷VæB‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3%&Wf—6VE$6öçG&öÂç&VF–æW72’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢–çFW&æÅ¢À¢–çFW&æÅ¢À¢W6W$&÷fVDvöÆFVäÖ7FW'3¢‚À¢Wf–FVæ6T66WFVDFVÆ—fW&&ÆW3¢À¢3E&V6÷fW'”f–æF–æs¢tõTåõ3Eõ$T4õdU%•õd•5órÀ¢&VG”6öÖÖ—BÀ¢&VG•G&VRÀ¢6öçFVçD6öÖÖ—C¢F&vWD6öÖÖ—BÀ¢6öçFVçEG&VS¢F&vWEG&VRÀ¢66WFæ6TÖG&—ƒ¢W‡V7FVDWf–FVæ6Ræ66WFæ6TÖG&—‚À¢fV6–&–Æ—G”VF—C¢W‡V7FVDWf–FVæ6RæfV6–&–Æ—G”VF—BÀ¢7&—F–3¢W‡V7FVDWf–FVæ6Ræ7&—F–2À¢FWÆ÷–ÖVçE&VF&6³¢W‡V7FVDWf–FVæ6RæFWÆ÷–ÖVçE&VF&6°¢Ò’Âw&÷VæB3r&VF–æW72FöW2æ÷BW†7FÇ’FW&—fRg&öÒF†R&÷fVB&Wf—6VBF&vWBr“°¢76W'B‡3%&Wf—6VE$6öçG&öÂæVçG'•v÷&¶fÆ÷ræ6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb3%&Wf—6VE$6öçG&öÂæVçG'•v÷&¶fÆ÷rçG&VRÓÓÒ&VG•G&VRÂw&÷VæB3rVçG'’v÷&¶fÆ÷rFöW2æ÷BF&vWBF†RW†7B&Wf—6VB$TE’&VçBr“°¢76W'Ev÷&¶fÆ÷tWf–FVæ6T¶W—2‡3%&Wf—6VE$6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæB3rVçG'’v÷&¶fÆ÷rrÂG'VR“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R‡3%&Wf—6VE$6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæB3rVçG'’r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂW‡V7FVE&÷VæC3tFö7VÖVçEFW‡BÂw&÷VæB3r÷Væ–ærFö7VÖVçG2r“°¢76W'DæõF„6†ævW56–æ6R‡F&vWD6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â6öçFVçDÖæ–fW7BæÖ†VçG'’ÓâVçG'’çF‚’Âv&÷fVB&Wf—6VB3"vöÆFVâÖ7FW"g&VW¦RgFW"&÷VæB3rr“°¢6öç7B&÷VæC3tg&VW¦TVæBÒ3$76WE74÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3$76WE74÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'DæõF„6†ævW56–æ6R†÷Væ–æt6öÖÖ—BÂ&÷VæC3tg&VW¦TVæBÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæB3rÖ—'&÷'2×W7B&VÖ–âg&÷¦Vâ&Vf÷&RW†7B55ô54UB7F—fF–öâr“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂ&VG•G&VRÓ°§Ð ¦6öç7B3%&Wf—6VE$&÷fÂÒfW&–g•3%&Wf—6VE$&÷fÄ†æFöfb‚“°¦gVæ7F–öâfW&–g”FF—F–öæÅ3$&÷fÄ†æFöfb†6öæf–rÂ&Wf—6–öä†æFöfb’°¢6öç7B6öçG&öÂÒ6öæf–ræ6öçG&öÃ°¢6öç7BÆö6²Ò6öæf–ræÆö6³°¢76W'B„&ööÆVâ†6öçG&öÂ’ÓÓÒ&ööÆVâ†Æö6²’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ6öçG&öÂæB&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&÷fÂÆö6²×W7BV"FöÖ–6ÆÇ–“°¢–b‚6öçG&öÂ’&WGW&âçVÆÃ°¢76W'B‡&Wf—6–öä†æFöfcòç&Wf—6VE&VG”6öÖÖ—Bbb&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—ƒòç&VF&6´6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&WV—&W26ö×ÆWFR&Wf–Wr&÷VæBG¶6öæf–ræWf–FVæ6U&÷VæGÒæB$TE’7F—fF–öæ“°¢76W'DW†7D¶W•6WB†6öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂvVçG'•v÷&¶fÆ÷rrÂwW6W$FV6—6–öäÆö6²rÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂw&VF–æW72rÂvæW‡DWF†÷&—¦VD7F–öârÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&÷fÂ6öçG&öÆ“°¢76W'DW†7D¶W•6WB†6öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'–“°¢76W'DW†7D¶W•6WB†6öçG&öÂçW6W$FV6—6–öäÆö6²Â²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒÆö6²&–æF–æv“°¢76W'DW†7D¶W•6WB†6öçG&öÂç&VF–æW72Â²v–çFW&æÅrÂv–çFW&æÅrÂwW6W$&÷fVDvöÆFVäÖ7FW'2rÂvWf–FVæ6T66WFVDFVÆ—fW&&ÆW2rÂw3E&V6÷fW'”f–æF–ærrÂw&VG”6öÖÖ—BrÂw&VG•G&VRrÂv6öçFVçD6öÖÖ—BrÂv6öçFVçEG&VRrÂv66WFæ6TÖG&—‚rÂvfV6–&–Æ—G”VF—BrÂv7&—F–2rÂvFWÆ÷–ÖVçE&VF&6²uÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&VF–æW76“°¢f÷"†6öç7B¶W’öb²v66WFæ6TÖG&—‚rÂvfV6–&–Æ—G”VF—BrÂv7&—F–2rÂvFWÆ÷–ÖVçE&VF&6²uÒ’76W'DW†7D¶W•6WB†6öçG&öÂç&VF–æW75¶¶W•ÒÂ²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒG¶¶W—Ò&–æF–æv“°¢76W'DW†7D¶W•6WB†6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²w7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öä76WG4&÷fVBrÂwGvVÇfU67&VVç4&÷fVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂvÖ†–×VÕfW&F–7BrÂvÖ”æ÷DFV6Æ&RuÒÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ6ö×ÆWF–öâ&÷VæF'–“°¢76W'B†6öçG&öÂç66†VÖfW'6–öâÓÓÒbb6öçG&öÂæ'F–f7D–BÓÓÒ6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÒG¶6öæf–ræ6öçG&öÅ&÷VæGÖbb—46æöæ–6Ä—6ôFFR†6öçG&öÂæ7&VFVDB’bb6öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb6öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb6öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ6öæf–rç&VçD6öçG&öÅF‚Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ–FVçF—G’ÂFFRÂ&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6†“°¢76W'B†6öçG&öÂç7FGW2ÓÓÒt”åõ$ôu$U52rbb6öçG&öÂçfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârbb6öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb6öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"Õ"Ô54UBÕ$ôET5D”ôârbb6öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6Rbb6öçG&öÂç66÷RÓÓÒu3%õ%õ$U$U4TåDD•dUõ$ôET5D”ôåô54UEõ$ôôeôe$ôÕõ$Ud•4TEôtôÄDTåôÔ5DU%ôôäÅ’rÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ†6R÷"66÷RÖ—6ÖF6†“°¢76W'B†6öçG&öÂææW‡DWF†÷&—¦VD7F–öâÓÓÒt7&VFRæB–æFWVæFVçFÇ’fW&–g’öæRW†7B&W&W6VçFF—fR&öGV7F–öâÖ76WB6WBg&öÒF†R&÷fVB&Wf—6VBvöÆFVâÖ7FW#²föÇVÖRvVæW&F–öâæB'VçF–ÖR&WÆ6VÖVçB&VÖ–â&Æö6¶VBVçF–Â&÷VæBC"55ô54UBârÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒæW‡B7F–öâW†6VVG2F†RW†7B&W&W6VçFF—fR&ööf“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3%$ÆÆ÷vVEw&—FW2’bb¥4ôâç7G&–æv–g’†6öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3%$f÷&&–FFVåw&—FW2’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒw&—FR&÷VæF'’Ö—6ÖF6†“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öä76WG4&÷fVC¢fÇ6RÂGvVÇfU67&VVç4&÷fVC¢Â&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÂÖ†–×VÕfW&F–7C¢u$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârÂÖ”æ÷DFV6Æ&S¢²u3"6ö×ÆWFRrÂu7FWB52rÂu7FWRÆÆ÷vVBrÂw'VçF–ÖR–×ÆVÖVçFVBrÂw&öGV7F–öâ76WG2&÷fVBrÂu&öGV7F–öâ&VG’rÂw‡—6–6Â•†öæRfW&–f–VBrÂu&öGV7F–öâÆ–26†ævVBuÒÒ’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ6ö×ÆWF–öâ&÷VæF'’÷fW&6Æ–×6“°¢6öç7B÷Væ–æt6öÖÖ—BÒ6öæf–ræ÷Væ–æt6öÖÖ—C°¢6öç7B&VG”6öÖÖ—BÒv—B…²w&Wb×'6RrÂG¶÷Væ–æt6öÖÖ—GÕæÒ“°¢6öç7B&VG•G&VRÒv—B…²w&Wb×'6RrÂG·&VG”6öÖÖ—GÕç·G&VWÖÒ“°¢76W'DW†7E6–ævÆU&VçB†÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&÷fÂ÷Væ–æv“°¢76W'B‡&Wf—6–öä†æFöfbç&VG”66W72bb&Wf—6–öä†æFöfbç&VG”66W72çVæF–æu&WVW7Bbb&VG”6öÖÖ—BÓÓÒ&Wf—6–öä†æFöfbç&VG”66W72æFV6—6–öå&VG”6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&VçB—2æ÷BF†RÆFW7BgVÆÇ’fW&–f–VBÆ—fRÖ66W72$TE’7FFV“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&öÂæVçG'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'’FöW2æ÷B&–æB$TE–“°¢6öç7B÷Væ–æuw&—FW2Ò¶6öæf–ræ6öçG&öÅF‚Â6öæf–ræÆö6µF‚ÂââæW‡V7FVE3%&VG”7F—fF–öåw&—FW5Ó°¢76W'DW†7D6†ævVEF‡2‡&VG”6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂ÷Væ–æuw&—FW2Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒFöÖ–2&÷fÂ÷Væ–æv“°¢76W'B†f—'7DFD6öÖÖ—B†6öæf–ræ6öçG&öÅF‚’ÓÓÒ÷Væ–æt6öÖÖ—Bbbf—'7DFD6öÖÖ—B†6öæf–ræÆö6µF‚’ÓÓÒ÷Væ–æt6öÖÖ—BÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒòG¶6öæf–ræÆö6µ&÷VæGÒvW&Ræ÷Bf—'7BFFVBFöÖ–6ÆÇ–“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6öæf–ræ6öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6öæf–ræÆö6µF‚Â÷Væ–æt6öÖÖ—B“°¢76W'DW†7D¶W•6WB†Æö6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂv6†BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçDFV6—6–öäÆö6²rÂv&6RrÂw6÷W&6TFV6—6–öârÂvFV6—6–öârÂv&÷fÅ66÷RrÂv&÷fVEF&vWBrÂv66WFVBrÂv&÷VæF&–W2uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&÷fÂÆö6¶“°¢76W'DW†7D¶W•6WB†Æö6²æ&6RÂ²v†VBrÂwG&VRuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&6V“°¢76W'DW†7D¶W•6WB†Æö6²ç6÷W&6TFV6—6–öâÂ²vÖW76vRrÂvWF†÷&—¦F–öä6öFRrÂvö'6W'fVDBrÂv–æfW'&VBuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ6÷W&6V“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷fVEF&vWBÂ²w&Wf–Wu&÷WFRrÂw&VG”6öÖÖ—BrÂw&VG•G&VRrÂv6öçFVçD6öÖÖ—BrÂv6öçFVçEG&VRrÂv6öçFVçDÖæ–fW7E6†#SbrÂvvöÆFVäÖ7FW'2rÂvWf–FVæ6RrÂvFWÆ÷–ÖVçBrÂwFV×÷&'”66W72rÂv66W75&ööbuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&÷fVBF&vWF“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷fVEF&vWBæWf–FVæ6RÂ²v66WFæ6TÖG&—‚rÂvfV6–&–Æ—G”VF—BrÂv7&—F–2rÂvf–æÄ§VFvRrÂv6ö×ÆWF–öârÂvFWÆ÷–ÖVçE&WVW7BrÂvFWÆ÷–ÖVçE&VF&6²uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒWf–FVæ6V“°¢f÷"†6öç7BfÇVRöbö&¦V7BçfÇVW2†Æö6²æ&÷fVEF&vWBæWf–FVæ6R’’76W'DW†7D¶W•6WB‡fÇVRÂ²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒWf–FVæ6R&–æF–æv“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷fVEF&vWBæFWÆ÷–ÖVçBÂ²v–BrÂv–Ö×WF&ÆUW&ÂrÂvVçf—&öæÖVçBrÂvv—F‡V$6öÖÖ—BrÂw&ö¦V7D–BrÂwFVÔ–BrÂw&öGV7F–öäÆ–46†ævVBuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒFWÆ÷–ÖVçF“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷fVEF&vWBæ66W75&ööbÂ²w&WVW7BrÂw&VF&6²uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ66W72&ööf“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷fVEF&vWBæ66W75&ööbç&WVW7BÂ²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ66W72&WVW7B&ööf“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷fVEF&vWBæ66W75&ööbç&VF&6²Â²wF‚rÂv&Æö"uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ66W72&VF&6²&ööf“°¢76W'DW†7D¶W•6WB†Æö6²æ66WFVBÂ²wW6W$&÷fVDvöÆFVäÖ7FW'2rÂvWf–FVæ6T66WFVDFVÆ—fW&&ÆW2uÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ66WFVF“°¢76W'DW†7D¶W•6WB†Æö6²æ&÷VæF&–W2Â²w3$6ö×ÆWFRrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw'VçF–ÖT–×ÆVÖVçFVBrÂw&öGV7F–öä76WG4&÷fVBrÂw&öGV7F–öå&VG’rÂw‡—6–6Ä•†öæUfW&–f–VBrÂw&öGV7F–öäÆ–46†ævVBuÒÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&÷VæF&–W6“°¢76W'B†Æö6²ç66†VÖfW'6–öâÓÓÒbbÆö6²æ'F–f7D–BÓÓÒ7FWÓÖ†W&òÖÖW&6†çBÖÆ&vRÖ–FÆRÖ–çFVw&F–öâ×W6W"ÖFV6—6–öâÖÆö6²×&÷VæBÒG¶6öæf–ræÆö6µ&÷VæGÖbb—46æöæ–6Ä—6ôFFR†Æö6²æ7&VFVDB’bbÆö6²æ6†BÓÓÒsEõ3"ÕôvöÆFVäÖ7FW.ŠŠÞŠˆ‚rbbÆö6²ç&W÷6—F÷'’ÓÓÒ6öçG&öÂç&W÷6—F÷'’bbÆö6²æ'&æ6‚ÓÓÒv¶–Ö’rbbÆö6²ç&VçDFV6—6–öäÆö6²ÓÓÒ6öæf–rç&VçDÆö6µF‚bb¥4ôâç7G&–æv–g’†Æö6²æ&6R’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ–FVçF—G’ÂFFRÂ&VçB÷"$TE’&6RÖ—6ÖF6†“°¢6öç7B6öçFVçDÖæ–fW7BÒ&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—‚æ6öçFVçDÖæ–fW7C°¢6öç7BÖæ–fW7E6†#SbÒ6†#Sc¢G·6†#Sd6æöæ–6Â†6öçFVçDÖæ–fW7B—Ö°¢6öç7BW‡V7FVDÖW76vRÒ$õdUõ3%õôtÕôdõ%õ"$TE•ô4ôÔÔ•CÒG·&VG”6öÖÖ—GÒ$TE•õE$TSÒG·&VG•G&VWÒ4ôåDTåEôÔä”dU5Eõ4„#ScÒG¶Öæ–fW7E6†#SgÖ°¢76W'B†Æö6²ç6÷W&6TFV6—6–öâæÖW76vRÓÓÒW‡V7FVDÖW76vRbbÆö6²ç6÷W&6TFV6—6–öâæWF†÷&—¦F–öä6öFRÓÓÒt$õdUõ3%õôtÕôdõ%õ"rbbÆö6²ç6÷W&6TFV6—6–öâæ–æfW'&VBÓÓÒfÇ6RbbÆö6²æFV6—6–öâÓÓÒt$õdTEõ$Ud•4TEõ3%ôtôÄDTåôÔ5DU%õôdõ%õ%ô54UEõ$ôET5D”ôârbbÆö6²æ&÷fÅ66÷RÓÓÒu$Ud•4TEõ3%õôtôÄDTåôÔ5DU%õd•5TÅôD•$T5D”ôåôôäÅ’rÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒÆ6·2W†7B&Wf—6VB×F&vWB&÷fÆ“°¢6öç7BF&vWD6öÖÖ—BÒ&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—‚çF&vWD6öÖÖ—C°¢6öç7BF&vWEG&VRÒ&Wf—6–öä†æFöfbç&Wf—6–öå&Vf—‚çF&vWEG&VS°¢76W'B†Æö6²æ&÷fVEF&vWBç&Wf–Wu&÷WFRÓÓÒr÷7FWB÷3"övöÆFVâÖÖ7FW"×òrbbÆö6²æ&÷fVEF&vWBç&VG”6öÖÖ—BÓÓÒ&VG”6öÖÖ—BbbÆö6²æ&÷fVEF&vWBç&VG•G&VRÓÓÒ&VG•G&VRbbÆö6²æ&÷fVEF&vWBæ6öçFVçD6öÖÖ—BÓÓÒF&vWD6öÖÖ—BbbÆö6²æ&÷fVEF&vWBæ6öçFVçEG&VRÓÓÒF&vWEG&VRbbÆö6²æ&÷fVEF&vWBæ6öçFVçDÖæ–fW7E6†#SbÓÓÒÖæ–fW7E6†#SbÂ&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ$TE’ö6öçFVçBf–ævW'&–çBÖ—6ÖF6†“°¢6öç7B7&—F–2Ò§6öâ†6öæf–ræWf–FVæ6UF‡2æ7&—F–2“°¢76W'B„¥4ôâç7G&–æv–g’†Æö6²æ&÷fVEF&vWBævöÆFVäÖ7FW'2’ÓÓÒ¥4ôâç7G&–æv–g’†7&—F–2ç67&VVç6†÷G2’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒvöÆFVâÖ7FW"&–æF–ærÖ—6ÖF6†“°¢6öç7BW‡V7FVDWf–FVæ6RÒö&¦V7Bæg&öÔVçG&–W2„ö&¦V7BæVçG&–W2†6öæf–ræWf–FVæ6UF‡2’æÖ‚…¶¶W’Âf–ÆUÒ’Óâ¶¶W’Â²Fƒ¢f–ÆRÂ&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G¶f–ÆWÖÒ’ÕÒ’“°¢76W'B„¥4ôâç7G&–æv–g’†Æö6²æ&÷fVEF&vWBæWf–FVæ6R’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDWf–FVæ6R’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒWf–FVæ6R&–æF–ærÖ—6ÖF6†“°¢6öç7B&VF&6²Ò&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&VF&6³°¢6öç7B&WVW7BÒ&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&WVW7C°¢76W'B„¥4ôâç7G&–æv–g’†Æö6²æ&÷fVEF&vWBæFWÆ÷–ÖVçB’ÓÓÒ¥4ôâç7G&–æv–g’‡²–C¢&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–BÂ–Ö×WF&ÆUW&Ã¢&VF&6²çfW&–f–VDFWÆ÷–ÖVçBæ–Ö×WF&ÆUW&ÂÂVçf—&öæÖVçC¢u&Wf–WrrÂv—F‡V$6öÖÖ—C¢F&vWD6öÖÖ—BÂ&ö¦V7D–C¢w&¥ó4—6SU”×“•66…e33f–&¤¥”Ä"rÂFVÔ–C¢wFVÕóföE¤5¥†§¦…D3—6tWFô4ÒrÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÒ’bb¥4ôâç7G&–æv–g’†Æö6²æ&÷fVEF&vWBçFV×÷&'”66W72’ÓÓÒ¥4ôâç7G&–æv–g’‡&WVW7Bç&Wf–WrçFV×÷&'”66W72’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒFWÆ÷–ÖVçB÷"FV×÷&'’Ö66W72&–æF–ærÖ—6ÖF6†“°¢76W'B„¥4ôâç7G&–æv–g’†Æö6²æ&÷fVEF&vWBæ66W75&ööb’ÓÓÒ¥4ôâç7G&–æv–g’‡²&WVW7C¢²Fƒ¢&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&WVW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&WVW7EF‡ÖÒ’ÒÂ&VF&6³¢²Fƒ¢&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&VF&6µF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·&Wf—6–öä†æFöfbç&VG”66W72æ7W'&VçE&VF&6µF‡ÖÒ’ÒÒ’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒFöW2æ÷B&–æBF†RW†7BÆFW7B66W72&ööf“°¢6öç7Bö'6W'fVDBÒFFRç'6R†Æö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBóòrr“°¢6öç7B&VG•F–ÖRÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ&VG”6öÖÖ—EÒ’“°¢6öç7B÷Væ–æuF–ÖRÒFFRç'6R†v—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ÷Væ–æt6öÖÖ—EÒ’“°¢6öç7BW‡—'’ÒFFRç'6R‡&WVW7Bç&Wf–WrçFV×÷&'”66W72æW‡—&W4Bóòrr“°¢76W'B„çVÖ&W"æ—4f–æ—FR†ö'6W'fVDB’bbæWrFFR†ö'6W'fVDB’çFô•4õ7G&–ær‚’ç&WÆ6R‚rã¢rÂu¢r’ÓÓÒÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBbbö'6W'fVDBãÒFFRç'6R‡&VF&6²çfW&–f–VD‡GGçfW&–f–VDB’bbö'6W'fVDBãÒ&VG•F–ÖRbbö'6W'fVDBÃÒW‡—'’bbö'6W'fVDBÃÒ÷Væ–æuF–ÖRbb÷Væ–æuF–ÖRÒö'6W'fVDBÃÒ#B¢c¢c¢bb6öçG&öÂæ7&VFVDBÓÓÒÆö6²æ7&VFVDBbbÆö6²æ7&VFVDBÓÓÒÆö6²ç6÷W&6TFV6—6–öâæö'6W'fVDBç6Æ–6RƒÂ’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ&÷fÂF–ÖR—2÷WG6–FRF†RW†7BÆ—fR&Wf–WvVB$TE’–çFW'fÆ“°¢76W'B„¥4ôâç7G&–æv–g’†Æö6²æ66WFVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²W6W$&÷fVDvöÆFVäÖ7FW'3¢‚ÂWf–FVæ6T66WFVDFVÆ—fW&&ÆW3¢Ò’bbö&¦V7BçfÇVW2†Æö6²æ&÷VæF&–W2’æWfW'’‡fÇVRÓâfÇVRÓÓÒfÇ6R’Â&÷VæBG¶6öæf–ræÆö6µ&÷VæGÒ66WFVB6÷VçB÷"&÷VæF&–W2÷fW&6Æ–Ö“°¢76W'B†6öçG&öÂçW6W$FV6—6–öäÆö6²çF‚ÓÓÒ6öæf–ræÆö6µF‚bb6öçG&öÂçW6W$FV6—6–öäÆö6²æ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G¶6öæf–ræÆö6µF‡ÖÒ’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒFöW2æ÷B&–æB–Ö×WF&ÆR&÷VæBG¶6öæf–ræÆö6µ&÷VæGÖ“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&öÂç&VF–æW72’ÓÓÒ¥4ôâç7G&–æv–g’‡²–çFW&æÅ¢Â–çFW&æÅ¢ÂW6W$&÷fVDvöÆFVäÖ7FW'3¢‚ÂWf–FVæ6T66WFVDFVÆ—fW&&ÆW3¢Â3E&V6÷fW'”f–æF–æs¢tõTåõ3Eõ$T4õdU%•õd•5órÂ&VG”6öÖÖ—BÂ&VG•G&VRÂ6öçFVçD6öÖÖ—C¢F&vWD6öÖÖ—BÂ6öçFVçEG&VS¢F&vWEG&VRÂ66WFæ6TÖG&—ƒ¢W‡V7FVDWf–FVæ6Ræ66WFæ6TÖG&—‚ÂfV6–&–Æ—G”VF—C¢W‡V7FVDWf–FVæ6RæfV6–&–Æ—G”VF—BÂ7&—F–3¢W‡V7FVDWf–FVæ6Ræ7&—F–2ÂFWÆ÷–ÖVçE&VF&6³¢W‡V7FVDWf–FVæ6RæFWÆ÷–ÖVçE&VF&6²Ò’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ&VF–æW72FöW2æ÷BFW&—fRg&öÒW†7BÆFW7BWf–FVæ6V“°¢76W'B†6öçG&öÂæVçG'•v÷&¶fÆ÷ræ6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb6öçG&öÂæVçG'•v÷&¶fÆ÷rçG&VRÓÓÒ&VG•G&VRÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'’v÷&¶fÆ÷rF&vWBÖ—6ÖF6†“°¢76W'Ev÷&¶fÆ÷tWf–FVæ6T¶W—2†6öçG&öÂæVçG'•v÷&¶fÆ÷rÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'’v÷&¶fÆ÷vÂG'VR“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R†6öçG&öÂæVçG'•v÷&¶fÆ÷rÂ&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒVçG'–“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂf–ÆRÓâW‡V7FVDFF—F–öæÄ&÷fÄFö7VÖVçEFW‡B†f–ÆRÂ6öæf–ræFö7VÖVçD6öæf–r’Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒ÷Væ–ærFö7VÖVçG6“°¢76W'DæõF„6†ævW56–æ6R‡F&vWD6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â6öçFVçDÖæ–fW7BæÖ†VçG'’ÓâVçG'’çF‚’Â&÷fVB6öçFVçBg&VW¦RgFW"&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÖ“°¢6öç7Bg&VW¦TVæBÒ3$76WE74÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3$76WE74÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'DæõF„6†ævW56–æ6R†÷Væ–æt6öÖÖ—BÂg&VW¦TVæBÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Â&÷VæBG¶6öæf–ræ6öçG&öÅ&÷VæGÒÖ—'&÷'26†ævVB&Vf÷&R55ô54UB7V66W76÷&“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂ&VG•G&VRÂF&vWD6öÖÖ—BÂF&vWEG&VRÂ6öçFVçDÖæ–fW7BÂWf–FVæ6UF‡3¢6öæf–ræWf–FVæ6UF‡2Ó°§Ð¦6öç7B3%6V6öæE&Wf—6VE$&÷fÂÒfW&–g”FF—F–öæÅ3$&÷fÄ†æFöfb‡°¢6öçG&öÅ&÷VæC¢s3’rÂÆö6µ&÷VæC¢srÂWf–FVæ6U&÷VæC¢s2rÂ6öçG&öÅFƒ¢3%6V6öæE&Wf—6VE$6öçG&öÅF‚ÂÆö6µFƒ¢3%6V6öæE&Wf—6VD&÷fÄÆö6µF‚Â6öçG&öÃ¢3%6V6öæE&Wf—6VE$6öçG&öÂÂÆö6³¢3%6V6öæE&Wf—6VD&÷fÄÆö6²Â÷Væ–æt6öÖÖ—C¢3%6V6öæE&Wf—6VE$÷Væ–æt6öÖÖ—BÀ¢&VçD6öçG&öÅFƒ¢3%6V6öæE&Wf—6–öä6öçG&öÅF‚Â&VçDÆö6µFƒ¢3%6V6öæE&Wf—6–öäÆö6µF‚ÂWf–FVæ6UF‡3¢3%6V6öæE&Wf—6–öå&Wf–WtWf–FVæ6UF‡2ÂFö7VÖVçD6öæf–s¢3%6V6öæE&Wf—6–öäFö7VÖVçD6öæf–p§ÒÂ3%6V6öæE&Wf—6–öä†æFöfb“°¦6öç7B3%F†—&E&Wf—6VE$&÷fÂÒfW&–g”FF—F–öæÅ3$&÷fÄ†æFöfb‡°¢6öçG&öÅ&÷VæC¢sCrÂÆö6µ&÷VæC¢s"rÂWf–FVæ6U&÷VæC¢sBrÂ6öçG&öÅFƒ¢3%F†—&E&Wf—6VE$6öçG&öÅF‚ÂÆö6µFƒ¢3%F†—&E&Wf—6VD&÷fÄÆö6µF‚Â6öçG&öÃ¢3%F†—&E&Wf—6VE$6öçG&öÂÂÆö6³¢3%F†—&E&Wf—6VD&÷fÄÆö6²Â÷Væ–æt6öÖÖ—C¢3%F†—&E&Wf—6VE$÷Væ–æt6öÖÖ—BÀ¢&VçD6öçG&öÅFƒ¢3%F†—&E&Wf—6–öä6öçG&öÅF‚Â&VçDÆö6µFƒ¢3%F†—&E&Wf—6–öäÆö6µF‚ÂWf–FVæ6UF‡3¢3%F†—&E&Wf—6–öå&Wf–WtWf–FVæ6UF‡2ÂFö7VÖVçD6öæf–s¢3%F†—&E&Wf—6–öäFö7VÖVçD6öæf–p§ÒÂ3%F†—&E&Wf—6–öä†æFöfb“°¦6öç7B3$&÷fVD76WE6÷W&6RÒ3%F†—&E&Wf—6VE$6öçG&öÂò°¢6öçG&öÃ¢3%F†—&E&Wf—6VE$6öçG&öÂÂ6öçG&öÅFƒ¢3%F†—&E&Wf—6VE$6öçG&öÅF‚Â÷Væ–æt6öÖÖ—C¢3%F†—&E&Wf—6VE$÷Væ–æt6öÖÖ—BÀ¢Æö6³¢3%F†—&E&Wf—6VD&÷fÄÆö6²ÂÆö6µFƒ¢3%F†—&E&Wf—6VD&÷fÄÆö6µF‚Â&÷fÃ¢3%F†—&E&Wf—6VE$&÷fÂÀ¢Fö7VÖVçE&VæFW&W#¢f–ÆRÓâW‡V7FVDFF—F–öæÄ&÷fÄFö7VÖVçEFW‡B†f–ÆRÂ3%F†—&E&Wf—6–öäFö7VÖVçD6öæf–r’Â6æ6†÷C¢3%F†—&E&Wf—6–öäFö7VÖVçD6öæf–ræ&÷fÅ6æ6†÷@§Ò¢3%6V6öæE&Wf—6VE$6öçG&öÂò°¢6öçG&öÃ¢3%6V6öæE&Wf—6VE$6öçG&öÂÂ6öçG&öÅFƒ¢3%6V6öæE&Wf—6VE$6öçG&öÅF‚Â÷Væ–æt6öÖÖ—C¢3%6V6öæE&Wf—6VE$÷Væ–æt6öÖÖ—BÀ¢Æö6³¢3%6V6öæE&Wf—6VD&÷fÄÆö6²ÂÆö6µFƒ¢3%6V6öæE&Wf—6VD&÷fÄÆö6µF‚Â&÷fÃ¢3%6V6öæE&Wf—6VE$&÷fÂÀ¢Fö7VÖVçE&VæFW&W#¢f–ÆRÓâW‡V7FVDFF—F–öæÄ&÷fÄFö7VÖVçEFW‡B†f–ÆRÂ3%6V6öæE&Wf—6–öäFö7VÖVçD6öæf–r’Â6æ6†÷C¢3%6V6öæE&Wf—6–öäFö7VÖVçD6öæf–ræ&÷fÅ6æ6†÷@§Ò¢3%&Wf—6VE$6öçG&öÂò°¢6öçG&öÃ¢3%&Wf—6VE$6öçG&öÂÂ6öçG&öÅFƒ¢3%&Wf—6VE$6öçG&öÅF‚Â÷Væ–æt6öÖÖ—C¢3%&Wf—6VE$÷Væ–æt6öÖÖ—BÀ¢Æö6³¢3%&Wf—6VD&÷fÄÆö6²ÂÆö6µFƒ¢3%&Wf—6VD&÷fÄÆö6µF‚Â&÷fÃ¢3%&Wf—6VE$&÷fÂÀ¢Fö7VÖVçE&VæFW&W#¢W‡V7FVE&÷VæC3tFö7VÖVçEFW‡BÂ6æ6†÷C¢&÷VæC3u&VG•6æ6†÷@§Ò¢3%$6öçG&öÂò°¢6öçG&öÃ¢3%$6öçG&öÂÂ6öçG&öÅFƒ¢3%$6öçG&öÅF‚Â÷Væ–æt6öÖÖ—C¢3%$÷Væ–æt6öÖÖ—BÀ¢Æö6³¢3%W6W$FV6—6–öäÆö6²ÂÆö6µFƒ¢3%W6W$FV6—6–öäÆö6µF‚Â&÷fÃ¢3%$&÷fÂÀ¢Fö7VÖVçE&VæFW&W#¢W‡V7FVE&÷VæC3TFö7VÖVçEFW‡BÂ6æ6†÷C¢&÷VæC3U&VG•6æ6†÷@§Ò¢çVÆÃ° ¦6öç7B&÷VæCC%6æ6†÷BÒ5U%$TåEôUD„õ$•E•õ4ä4„õC¢G·3$76WE746öçG&öÅF‡ÒÂ5DUBÂ3"Õ"Ô54UBÕ$ôET5D”ôâÂ55õ3%õ%õ$U$U4TåDD•dUô54UF°¦gVæ7F–öâW‡V7FVE&÷VæCC$Fö7VÖVçEFW‡B†f–ÆR’°¢76W'B‡3$&÷fVD76WE6÷W&6RÂw&÷VæBC"Fö7VÖVçB&VæFW&W"Æ6·2öæRW†7B&÷fÂ6÷W&6Rr“°¢ÆWB6÷W&6RÒ3$&÷fVD76WE6÷W&6RæFö7VÖVçE&VæFW&W"†f–ÆR’ç&WÆ6R‡3$&÷fVD76WE6÷W&6Rç6æ6†÷BÂ&÷VæCC%6æ6†÷B“°¢6öç7B&WÆ6VÖVçG2Ò°¢uTÄ•E•ôtDRæÖBs¢°¢²õF†Râ£òƒó§&W&W6VçFF—fWÇW&Ö—G2öæÇ’öæR&W&W6VçFF—fR’â£òƒó¥55ô54UEÂçÆ&Vf÷&R55ô54UEÂâ’÷2ÂuF†RW†7B&W&W6VçFF—fR3""76WB6WB76VB66÷VB55ô54UFâ76WBföÇVÖRÂ'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBVçF–ÂæWrW†7B6†ævRÖ6öçG&öÂâuÐ¢ÒÀ¢u$ô¤T5Eô„äDõdU"æÖBs¢°¢²óÂâ&öGV6RöæRâ£õÆã%ÂâfW&–g’â£õÆã5Âââ£õ55ô54UBâ£õÆãEÂââ£òƒó§Væ6†ævVGÇVæ6†ævVEÂâ’÷2Âsâ&W6W'fRF†R&W&W6VçFF—fR55ô54UBWf–FVæ6RæB&÷fVBvöÆFVâÖ7FW"Æ–æVvUÆã"â÷VâæWrW†7B6†ævRÖ6öçG&öÂ&Vf÷&R&öGV6–ær76WBföÇVÖUÆã2â¶VW'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWRæB&öGV7F–öâ&Æö6¶VEÆãBâ&W÷'B‡—6–6Â•†öæR2æ÷BfW&–f–VBuÐ¢ÒÀ¢ræv—F‡V"÷v÷&¶fÆ÷w2ô5U%$TåEõ5DEU2æÖBs¢°¢²òÒâ£òƒó§W&Ö—G2öæÇ’öæR&W&W6VçFF—fWÇ&W&W6VçFF—fR"’â¢BöÒÂrÒF†RW†7B&W&W6VçFF—fR3""76WG2†fR66÷VB55ô54UF²föÇVÖRÂ'VçF–ÖRÂ7FWBÂ7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBuÐ¢ÒÀ¢ttTåE2æÖBs¢°¢²õ&VB5U%$TåEôUD„õ$•E•ô”äDU…Âæ§6öæâ£òƒó¦FWf–6RfW&F–7G5ÂçÇ‡—6–6ÂÖFWf–6RfW&F–7G5Ââ’÷2Âu&VB5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öææB&÷VæBC"â&W6W'fRF†R&W&W6VçFF—fR55ô54UBWf–FVæ6RâFòæ÷B7&VFR76WBföÇVÖRÂ&WÆ6R'VçF–ÖRÂ÷"×WFFRvÖWÆ’ÂV6öæö×’Â6fRÂ&6¶VæBÂ–ÖVçBÂG2Â&öGV7F–öâ÷"FWf–6RfW&F–7G2v—F†÷WBæWrW†7B6†ævRÖ6öçG&öÂâuÐ¢ÒÀ¢u$TDÔRæÖBs¢°¢²õ&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBÆBµÂââ£òƒó§Væ6†ævVEÂçÇ&VÖ–âVæ6†ævVEÂâ’÷2Âu&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBC"âöæRW†7B&W&W6VçFF—fR3""76WB6WB†266÷VB55ô54UC²76WBföÇVÖRæB'VçF–ÖR–çFVw&F–öâ&Ræ÷BWF†÷&—¦VBâ7FWBÂ7FWRÂ&öGV7F–öâæB‡—6–6ÂÖFWf–6RfW&F–7G2&VÖ–âVæ6†ævVBâuÐ¢Ð¢Ó°¢f÷"†6öç7B·GFW&âÂ&WÆ6VÖVçEÒöb&WÆ6VÖVçG5¶f–ÆUÒóòµÒ’°¢76W'B‡GFW&âçFW7B‡6÷W&6R’Â&÷VæBC"FWFW&Ö–æ—7F–2Fö7VÖVçBG&ç6f÷&Ò6÷W&6R—2Ö—76–æs¢G¶f–ÆWÖ“°¢6÷W&6RÒ6÷W&6Rç&WÆ6R‡GFW&âÂ&WÆ6VÖVçB“°¢Ð¢&WGW&â6÷W&6S°§Ð ¦6öç7B&÷VæCC4–å&öw&W756æ6†÷BÒ5U%$TåEôUD„õ$•E•õ4ä4„õC¢G·3$76WEföÇVÖU66÷T6öçG&öÅF‡ÒÂ5DUBÂ3"Õ"Ô54UBÕ$ôET5D”ôâÂ”åõ$ôu$U55õ3%õ%õdôÅTÔUõ44õUô4ôåE$5F°¦6öç7B&÷VæCCE6æ6†÷BÒ5U%$TåEôUD„õ$•E•õ4ä4„õC¢G·3$76WEföÇVÖT6öçG&öÅF‡ÒÂ5DUBÂ3"Õ"Ô54UBÕ$ôET5D”ôâÂ”åõ$ôu$U55õ3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôæ°¦6öç7B&÷VæCCE&VG•6æ6†÷BÒ5U%$TåEôUD„õ$•E•õ4ä4„õC¢G·3$76WEföÇVÖT6öçG&öÅF‡ÒÂ5DUBÂ3"Õ"Ô54UBÕ$ôET5D”ôâÂ$TE•ôdõ%õ3%õ5õ%TåD”ÔUô”åDTu$D”ôåõ44õUõ$Ud”Uv°¦gVæ7F–öâW‡V7FVE&÷VæCC4Fö7VÖVçEFW‡B†f–ÆR’°¢ÆWB6÷W&6RÒW‡V7FVE&÷VæCC$Fö7VÖVçEFW‡B†f–ÆR’ç&WÆ6R‡&÷VæCC%6æ6†÷BÂ&÷VæCC4–å&öw&W756æ6†÷B“°¢6öç7B&WÆ6VÖVçG2Ò°¢uTÄ•E•ôtDRæÖBs¢°¢²uF†RW†7B&W&W6VçFF—fR3""76WB6WB76VB66÷VB55ô54UFâ76WBföÇVÖRÂ'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBVçF–ÂæWrW†7B6†ævRÖ6öçG&öÂârÂu&÷VæBC2WF†÷&—¦W2öæÇ’f–æ—FR3""76WB×föÇVÖR66÷R6öçG&7BæB—G2–æFWVæFVçB&Wf–WrWf–FVæ6RâæòföÇVÖR76WB'—FRÂ'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWR÷"&öGV7F–öâv÷&²—2WF†÷&—¦VBâuÐ¢ÒÀ¢u$ô¤T5Eô„äDõdU"æÖBs¢°¢²sâ&W6W'fRF†R&W&W6VçFF—fR55ô54UBWf–FVæ6RæB&÷fVBvöÆFVâÖ7FW"Æ–æVvUÆã"â÷VâæWrW†7B6†ævRÖ6öçG&öÂ&Vf÷&R&öGV6–ær76WBföÇVÖUÆã2â¶VW'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWRæB&öGV7F–öâ&Æö6¶VEÆãBâ&W÷'B‡—6–6Â•†öæR2æ÷BfW&–f–VBrÂsâ&W6W'fRF†R&W&W6VçFF—fR55ô54UBWf–FVæ6RæB&÷fVBvöÆFVâÖ7FW"Æ–æVvUÆã"âFVf–æRf–æ—FRF‚Ö'’×F‚6÷W&6RæBFVÆ—fW'’76WB×föÇVÖR6öçG&7BVæFW"&÷VæBC5Æã2â–æFWVæFVçFÇ’&Wf–WrfV6–&–Æ—G’Â'VFvWG2Âæ6†÷'2Âg&ÖW2ÂW‡÷'BÆ–æVvRæBWf–FVæ6RF‡2v—F†÷WB7&VF–ær76WB'—FW5ÆãBâ¶VW'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWRÂ&öGV7F–öâæB‡—6–6Â•†öæRfW&–f–6F–öâ&Æö6¶VBuÐ¢ÒÀ¢ræv—F‡V"÷v÷&¶fÆ÷w2ô5U%$TåEõ5DEU2æÖBs¢°¢²rÒF†RW†7B&W&W6VçFF—fR3""76WG2†fR66÷VB55ô54UF²föÇVÖRÂ'VçF–ÖRÂ7FWBÂ7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBrÂrÒ&÷VæBC2—2Æ–Ö—FVBFòF†RW†7B3""76WB×föÇVÖR66÷R6öçG&7BæB&Wf–WrWf–FVæ6S²76WB'—FW2Â'VçF–ÖRÂ7FWBÂ7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBuÐ¢ÒÀ¢ttTåE2æÖBs¢°¢²u&VB5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öææB&÷VæBC"â&W6W'fRF†R&W&W6VçFF—fR55ô54UBWf–FVæ6RâFòæ÷B7&VFR76WBföÇVÖRÂ&WÆ6R'VçF–ÖRÂ÷"×WFFRvÖWÆ’ÂV6öæö×’Â6fRÂ&6¶VæBÂ–ÖVçBÂG2Â&öGV7F–öâ÷"FWf–6RfW&F–7G2v—F†÷WBæWrW†7B6†ævRÖ6öçG&öÂârÂu&VB5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öæÂ&÷VæBC2æB–Ö×WF&ÆRv÷fW&ææ6R7F—fF–öâ&V6÷&B&÷VæB2â7&VFRöæÇ’F†Rf–æ—FR3""6÷W&6RöFVÆ—fW'’76WB×föÇVÖR66÷R6öçG&7BæB—G2W†7B&Wf–WrWf–FVæ6RâFòæ÷B7&VFRföÇVÖR76WB'—FW2÷"×WFFR'VçF–ÖRÂvÖWÆ’ÂV6öæö×’Â6fRÂ&6¶VæBÂ–ÖVçBÂG2Â&öGV7F–öâ÷"FWf–6RfW&F–7G2âuÐ¢ÒÀ¢u$TDÔRæÖBs¢°¢²u&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBC"âöæRW†7B&W&W6VçFF—fR3""76WB6WB†266÷VB55ô54UC²76WBföÇVÖRæB'VçF–ÖR–çFVw&F–öâ&Ræ÷BWF†÷&—¦VBâ7FWBÂ7FWRÂ&öGV7F–öâæB‡—6–6ÂÖFWf–6RfW&F–7G2&VÖ–âVæ6†ævVBârÂu&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBC2âöæÇ’F†Rf–æ—FR3""76WB×föÇVÖR66÷R6öçG&7BæB–æFWVæFVçBWf–FVæ6R&RWF†÷&—¦VC²76WB'—FW2æB'VçF–ÖR–çFVw&F–öâ&Ræ÷Bâ7FWBÂ7FWRÂ&öGV7F–öâæB‡—6–6ÂÖFWf–6RfW&F–7G2&VÖ–âVæ6†ævVBâuÐ¢Ð¢Ó°¢f÷"†6öç7B¶g&öÒÂFõÒöb&WÆ6VÖVçG5¶f–ÆUÒóòµÒ’6÷W&6RÒ&WÆ6Töæ6R‡6÷W&6RÂg&öÒÂFòÂ&÷VæBC2G¶f–ÆWÖ“°¢&WGW&â6÷W&6S°§Ð¦gVæ7F–öâW‡V7FVE&÷VæCCDFö7VÖVçEFW‡B†f–ÆR’°¢ÆWB6÷W&6RÒW‡V7FVE&÷VæCC4Fö7VÖVçEFW‡B†f–ÆR’ç&WÆ6R‡&÷VæCC4–å&öw&W756æ6†÷BÂ&÷VæCCE6æ6†÷B“°¢6öç7B&WÆ6VÖVçG2Ò°¢uTÄ•E•ôtDRæÖBs¢µ²u&÷VæBC2WF†÷&—¦W2öæÇ’f–æ—FR3""76WB×föÇVÖR66÷R6öçG&7BæB—G2–æFWVæFVçB&Wf–WrWf–FVæ6RâæòföÇVÖR76WB'—FRÂ'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWR÷"&öGV7F–öâv÷&²—2WF†÷&—¦VBârÂu&÷VæBC2–æFWVæFVçFÇ’6Æ÷6VBF†Rf–æ—FR66÷R6öçG&7Bv—F‚õ¦W&òâ&÷VæBCBWFöÖF–6ÆÇ’WF†÷&—¦W2öæÇ’F†RW†7B6÷W&6R76WG2ÂFVÆ—fW'’76WG2æBWf–FVæ6RF‡2VçVÖW&FVB'’F†B–Ö×WF&ÆR6öçG&7C²'VçF–ÖR–çFVw&F–öâÂvÖWÆ’FFÂ7FWB52Â7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBâuÕÒÀ¢u$ô¤T5Eô„äDõdU"æÖBs¢µ²sâ&W6W'fRF†R&W&W6VçFF—fR55ô54UBWf–FVæ6RæB&÷fVBvöÆFVâÖ7FW"Æ–æVvUÆã"âFVf–æRf–æ—FRF‚Ö'’×F‚6÷W&6RæBFVÆ—fW'’76WB×föÇVÖR6öçG&7BVæFW"&÷VæBC5Æã2â–æFWVæFVçFÇ’&Wf–WrfV6–&–Æ—G’Â'VFvWG2Âæ6†÷'2Âg&ÖW2ÂW‡÷'BÆ–æVvRæBWf–FVæ6RF‡2v—F†÷WB7&VF–ær76WB'—FW5ÆãBâ¶VW'VçF–ÖR–çFVw&F–öâÂ7FWB52Â7FWRÂ&öGV7F–öâæB‡—6–6Â•†öæRfW&–f–6F–öâ&Æö6¶VBrÂsâ&öGV6R6÷W&6RæBFVÆ—fW'’76WG2öæÇ’–âF†R6öçG&7BÖFVf–æVB&F6‚÷&FW"æBW†7BF‡5Æã"âfW&–g’'—FW2Âf÷&ÖBÂF–ÖVç6–öç2Âg&ÖW2Âæ6†÷'2ÂÇ†Â’×6Æ–6RÂW‡÷'BÆ–æVvRÂFW‡BW†6ÇW6–öâæB'VFvWG5Æã2â6ö×ÆWFRF†RW†7B6öçG&7BÖVçVÖW&FVB&öGV7F–öâWf–FVæ6Rv—F†÷WB'VçF–ÖR–çFVw&F–öåÆãBâ¶VW7FWB52Â7FWRÂ&öGV7F–öâæB‡—6–6Â•†öæRfW&–f–6F–öâ&Æö6¶VBuÕÒÀ¢ræv—F‡V"÷v÷&¶fÆ÷w2ô5U%$TåEõ5DEU2æÖBs¢µ²rÒ&÷VæBC2—2Æ–Ö—FVBFòF†RW†7B3""76WB×föÇVÖR66÷R6öçG&7BæB&Wf–WrWf–FVæ6S²76WB'—FW2Â'VçF–ÖRÂ7FWBÂ7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBrÂrÒ&÷VæBCBWFöÖF–6ÆÇ’FW&—fW2—G2f–æ—FR6÷W&6RöFVÆ—fW'’76WBæBWf–FVæ6RÆÆ÷vÆ—7Bg&öÒF†Rõ×¦W&ò&÷VæBC26öçG&7C²'VçF–ÖRÂ7FWBÂ7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBuÕÒÀ¢ttTåE2æÖBs¢µ²u&VB5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öæÂ&÷VæBC2æB–Ö×WF&ÆRv÷fW&ææ6R7F—fF–öâ&V6÷&B&÷VæB2â7&VFRöæÇ’F†Rf–æ—FR3""6÷W&6RöFVÆ—fW'’76WB×föÇVÖR66÷R6öçG&7BæB—G2W†7B&Wf–WrWf–FVæ6RâFòæ÷B7&VFRföÇVÖR76WB'—FW2÷"×WFFR'VçF–ÖRÂvÖWÆ’ÂV6öæö×’Â6fRÂ&6¶VæBÂ–ÖVçBÂG2Â&öGV7F–öâ÷"FWf–6RfW&F–7G2ârÂu&VB5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öæÂ&÷VæBCBÂ–Ö×WF&ÆRv÷fW&ææ6R7F—fF–öâ&V6÷&B&÷VæBBæBF†R76VB&÷VæBC26öçG&7Bâw&—FRöæÇ’W†7B6öçG&7BÖVçVÖW&FVB6÷W&6RöFVÆ—fW'’76WBæBWf–FVæ6RF‡2âFòæ÷B×WFFR'VçF–ÖRÂvÖWÆ’ÂV6öæö×’Â6fRÂ&6¶VæBÂ–ÖVçBÂG2Â&öGV7F–öâ÷"FWf–6RfW&F–7G2âuÕÒÀ¢u$TDÔRæÖBs¢µ²u&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBC2âöæÇ’F†Rf–æ—FR3""76WB×föÇVÖR66÷R6öçG&7BæB–æFWVæFVçBWf–FVæ6R&RWF†÷&—¦VC²76WB'—FW2æB'VçF–ÖR–çFVw&F–öâ&Ræ÷Bâ7FWBÂ7FWRÂ&öGV7F–öâæB‡—6–6ÂÖFWf–6RfW&F–7G2&VÖ–âVæ6†ævVBârÂu&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBCBâöæÇ’W†7B–Ö×WF&ÆRÖ6öçG&7BÖVçVÖW&FVB3""6÷W&6RöFVÆ—fW'’76WG2æBWf–FVæ6R&RWF†÷&—¦VC²'VçF–ÖR–çFVw&F–öâ—2æ÷Bâ7FWBÂ7FWRÂ&öGV7F–öâæB‡—6–6ÂÖFWf–6RfW&F–7G2&VÖ–âVæ6†ævVBâuÕÐ¢Ó°¢f÷"†6öç7B¶g&öÒÂFõÒöb&WÆ6VÖVçG5¶f–ÆUÒóòµÒ’6÷W&6RÒ&WÆ6Töæ6R‡6÷W&6RÂg&öÒÂFòÂ&÷VæBCBG¶f–ÆWÖ“°¢&WGW&â6÷W&6S°§Ð¦gVæ7F–öâW‡V7FVE&÷VæCCE&VG”Fö7VÖVçEFW‡B†f–ÆR’°¢ÆWB6÷W&6RÒW‡V7FVE&÷VæCCDFö7VÖVçEFW‡B†f–ÆR’ç&WÆ6R‡&÷VæCCE6æ6†÷BÂ&÷VæCCE&VG•6æ6†÷B“°¢6öç7B&WÆ6VÖVçG2Ò°¢uTÄ•E•ôtDRæÖBs¢µ²u&÷VæBC2–æFWVæFVçFÇ’6Æ÷6VBF†Rf–æ—FR66÷R6öçG&7Bv—F‚õ¦W&òâ&÷VæBCBWFöÖF–6ÆÇ’WF†÷&—¦W2öæÇ’F†RW†7B6÷W&6R76WG2ÂFVÆ—fW'’76WG2æBWf–FVæ6RF‡2VçVÖW&FVB'’F†B–Ö×WF&ÆR6öçG&7C²'VçF–ÖR–çFVw&F–öâÂvÖWÆ’FFÂ7FWB52Â7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBârÂtWfW'’W†7B&÷VæBC26öçG&7BÖVçVÖW&FVB3""6÷W&6RæBFVÆ—fW'’76WB&F6‚76VBFV6öFVBÖ'—FRÂÆ–æVvRÂfV6–&–Æ—G’Â–æFWVæFVçBÖ7&—F–2æBf–æÂÖ§VFvR&Wf–Wrv—F‚õ¦W&òâF†RÖ†–×VÒ7FFR—2&VF–æW72Fò66÷R3"2'VçF–ÖR–çFVw&F–öã²'VçF–ÖRw&—FW2ÂvÖWÆ’FFÂ7FWB52Â7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBâuÕÒÀ¢u$ô¤T5Eô„äDõdU"æÖBs¢µ²sâ&öGV6R6÷W&6RæBFVÆ—fW'’76WG2öæÇ’–âF†R6öçG&7BÖFVf–æVB&F6‚÷&FW"æBW†7BF‡5Æã"âfW&–g’'—FW2Âf÷&ÖBÂF–ÖVç6–öç2Âg&ÖW2Âæ6†÷'2ÂÇ†Â’×6Æ–6RÂW‡÷'BÆ–æVvRÂFW‡BW†6ÇW6–öâæB'VFvWG5Æã2â6ö×ÆWFRF†RW†7B6öçG&7BÖVçVÖW&FVB&öGV7F–öâWf–FVæ6Rv—F†÷WB'VçF–ÖR–çFVw&F–öåÆãBâ¶VW7FWB52Â7FWRÂ&öGV7F–öâæB‡—6–6Â•†öæRfW&–f–6F–öâ&Æö6¶VBrÂsâ&W6W'fRWfW'’–Ö×WF&ÆR&÷VæBCB6÷W&6RöFVÆ—fW'’76WBæB&F6‚Wf–FVæ6R&–æF–æuÆã"â÷VâæWrW†7B66÷RÖöæÇ’6†ævRÖ6öçG&öÂ&Vf÷&Rç’3"2'VçF–ÖR–çFVw&F–öåÆã2â¶VWvÖWÆ’FFÂ7FWB52Â7FWRæB&öGV7F–öâ&Æö6¶VEÆãBâ&W÷'B‡—6–6Â•†öæR2æ÷BfW&–f–VBuÕÒÀ¢ræv—F‡V"÷v÷&¶fÆ÷w2ô5U%$TåEõ5DEU2æÖBs¢µ²rÒ&÷VæBCBWFöÖF–6ÆÇ’FW&—fW2—G2f–æ—FR6÷W&6RöFVÆ—fW'’76WBæBWf–FVæ6RÆÆ÷vÆ—7Bg&öÒF†Rõ×¦W&ò&÷VæBC26öçG&7C²'VçF–ÖRÂ7FWBÂ7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBrÂrÒÆÂW†7B6öçG&7BÖVçVÖW&FVB&÷VæBCB76WB&F6†W276VBv—F‚õ¦W&ó²öæÇ’gWGW&RW†7B3"2'VçF–ÖRÖ–çFVw&F–öâ66÷R&Wf–WrÖ’föÆÆ÷rÂv†–ÆR'VçF–ÖRÂ7FWBÂ7FWRæB&öGV7F–öâ&VÖ–â&Æö6¶VBuÕÒÀ¢ttTåE2æÖBs¢µ²u&VB5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öæÂ&÷VæBCBÂ–Ö×WF&ÆRv÷fW&ææ6R7F—fF–öâ&V6÷&B&÷VæBBæBF†R76VB&÷VæBC26öçG&7Bâw&—FRöæÇ’W†7B6öçG&7BÖVçVÖW&FVB6÷W&6RöFVÆ—fW'’76WBæBWf–FVæ6RF‡2âFòæ÷B×WFFR'VçF–ÖRÂvÖWÆ’ÂV6öæö×’Â6fRÂ&6¶VæBÂ–ÖVçBÂG2Â&öGV7F–öâ÷"FWf–6RfW&F–7G2ârÂu&VB5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öæÂ&÷VæBCBÂ–Ö×WF&ÆRv÷fW&ææ6R7F—fF–öâ&V6÷&B&÷VæBBÂF†R76VB&÷VæBC26öçG&7BæBWfW'’–Ö×WF&ÆR&F6‚6ö×ÆWF–öââFòæ÷Bw&—FR'VçF–ÖRÂvÖWÆ’ÂV6öæö×’Â6fRÂ&6¶VæBÂ–ÖVçBÂG2Â&öGV7F–öâ÷"FWf–6RfW&F–7G2VçF–ÂæWrW†7B66÷RÖöæÇ’7V66W76÷"—2–æFWVæFVçFÇ’7F—fFVBâuÕÒÀ¢u$TDÔRæÖBs¢µ²u&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBCBâöæÇ’W†7B–Ö×WF&ÆRÖ6öçG&7BÖVçVÖW&FVB3""6÷W&6RöFVÆ—fW'’76WG2æBWf–FVæ6R&RWF†÷&—¦VC²'VçF–ÖR–çFVw&F–öâ—2æ÷Bâ7FWBÂ7FWRÂ&öGV7F–öâæB‡—6–6ÂÖFWf–6RfW&F–7G2&VÖ–âVæ6†ævVBârÂu&W÷6—F÷'’7FWB&VÖ–ç2–â&öw&W72VæFW"&÷VæBCBâW†7B6öçG&7BÖVçVÖW&FVB3""76WBföÇVÖR†276VB—G2&÷VæFVB&F6‚Wf–FVæ6S²öæÇ’3"2'VçF–ÖRÖ–çFVw&F–öâ66÷R&Wf–WrÖ’&R6öç6–FW&VBæW‡Bâ'VçF–ÖRÂ7FWB52Â7FWRÂ&öGV7F–öâæB‡—6–6ÂÖFWf–6RfW&F–7G2&VÖ–âVæ6†ævVBâuÕÐ¢Ó°¢f÷"†6öç7B¶g&öÒÂFõÒöb&WÆ6VÖVçG5¶f–ÆUÒóòµÒ’6÷W&6RÒ&WÆ6Töæ6R‡6÷W&6RÂg&öÒÂFòÂ&÷VæBCB$TE’G¶f–ÆWÖ“°¢&WGW&â6÷W&6S°§Ð ¦gVæ7F–öâfW&–g•3%&W&W6VçFF—fT76WE72‚’°¢6öç7Bç•&ööbÒW†—7G2‡3%&W&W6VçFF—fTÖæ–fW7EF‚’ÇÂö&¦V7BçfÇVW2‡3%&W&W6VçFF—fTWf–FVæ6UF‡2’ç6öÖR†W†—7G2’ÇÂ&ööÆVâ‡3$76WE746öçG&öÂ“°¢–b‚ç•&ööb’&WGW&âçVÆÃ°¢76W'B‡3$&÷fVD76WE6÷W&6Sòæ&÷fÂbb3$&÷fVD76WE6÷W&6RæÆö6²bb3$&÷fVD76WE6÷W&6Ræ6öçG&öÂÂw&W&W6VçFF—fR76WB&ööb&WV—&W2W†7FÇ’öæRfW&–f–VBW6W"Ö&÷fVBvöÆFVâÖ7FW"6÷W&6Rr“°¢6öç7BÖæ–fW7E&W6VçBÒW†—7G2‡3%&W&W6VçFF—fTÖæ–fW7EF‚“°¢76W'B†Öæ–fW7E&W6VçBÂw&W&W6VçFF—fR76WBWf–FVæ6Rö6öçG&öÂW†—7G2&Vf÷&R—G2W†7BÖæ–fW7BæB6—‚76WG2r“°¢f÷"†6öç7Bf–ÆRöb3%&W&W6VçFF—fT76WEF‡2’76W'B†W†—7G2†f–ÆR’Â&W&W6VçFF—fR76WB—2Ö—76–æs¢G¶f–ÆWÖ“°¢6öç7BÖæ–fW7BÒ§6öâ‡3%&W&W6VçFF—fTÖæ–fW7EF‚“°¢76W'DW†7D¶W•6WB†Öæ–fW7BÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv&÷fVE6÷W&6RrÂv76WG2rÂwF÷FÄ'—FW2rÂv&÷VæF&–W2uÒÂw&W&W6VçFF—fR76WBÖæ–fW7Br“°¢76W'DW†7D¶W•6WB†Öæ–fW7Bæ&÷fVE6÷W&6RÂ²v6†ævT6öçG&öÂrÂvFV6—6–öäÆö6²rÂw&VG”6öÖÖ—BrÂw&VG•G&VRrÂvvöÆFVäÖ7FW$6öçFVçD6öÖÖ—BrÂvvöÆFVäÖ7FW$6öçFVçEG&VRrÂvvöÆFVäÖ7FW$6öçFVçDÖæ–fW7E6†#SbuÒÂw&W&W6VçFF—fR76WB&÷fVB6÷W&6Rr“°¢76W'DW†7D¶W•6WB†Öæ–fW7Bæ&÷VæF&–W2Â²w'VçF–ÖUW6TWF†÷&—¦VBrÂv76WEföÇVÖTWF†÷&—¦VBrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBuÒÂw&W&W6VçFF—fR76WB&÷VæF&–W2r“°¢6öç7B&÷fVEF&vWBÒ3$&÷fVD76WE6÷W&6RæÆö6²æ&÷fVEF&vWC°¢6öç7BW‡V7FVD&÷fVE6÷W&6RÒ°¢6†ævT6öçG&öÃ¢²Fƒ¢3$&÷fVD76WE6÷W&6Ræ6öçG&öÅF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3$&÷fVD76WE6÷W&6Ræ6öçG&öÅF‡ÖÒ’ÒÀ¢FV6—6–öäÆö6³¢²Fƒ¢3$&÷fVD76WE6÷W&6RæÆö6µF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3$&÷fVD76WE6÷W&6RæÆö6µF‡ÖÒ’ÒÀ¢&VG”6öÖÖ—C¢&÷fVEF&vWBç&VG”6öÖÖ—BÀ¢&VG•G&VS¢&÷fVEF&vWBç&VG•G&VRÀ¢vöÆFVäÖ7FW$6öçFVçD6öÖÖ—C¢&÷fVEF&vWBæ6öçFVçD6öÖÖ—BÀ¢vöÆFVäÖ7FW$6öçFVçEG&VS¢&÷fVEF&vWBæ6öçFVçEG&VRÀ¢vöÆFVäÖ7FW$6öçFVçDÖæ–fW7E6†#Sc¢&÷fVEF&vWBæ6öçFVçDÖæ–fW7E6†#S`¢Ó°¢76W'B†Öæ–fW7Bç66†VÖfW'6–öâÓÓÒbbÖæ–fW7Bæ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"×&W&W6VçFF—fRÖ76WBÖÖæ–fW7B×&÷VæBÓrbbÖæ–fW7Bç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbbÖæ–fW7Bæ'&æ6‚ÓÓÒv¶–Ö’rbb¥4ôâç7G&–æv–g’†Öæ–fW7Bæ&÷fVE6÷W&6R’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE6÷W&6R’Âw&W&W6VçFF—fR76WBÖæ–fW7B–FVçF—G’÷"&÷fVBvöÆFVâÖ7FW"f–ævW'&–çBÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†Öæ–fW7Bæ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’‡²'VçF–ÖUW6TWF†÷&—¦VC¢fÇ6RÂ76WEföÇVÖTWF†÷&—¦VC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÒ’Âw&W&W6VçFF—fR76WBÖæ–fW7B÷fW&6Æ–×2—G266÷Rr“°¢6öç7B76WDFVf–æ—F–öç2Ò°¢²t4BÔÔôDTÂÕ4„TUBrÂ3%&W&W6VçFF—fT76WEF‡5³ÒÂt4EôÔôDTÅõ4„TUBrÂBÂG'VRÂfÇ6UÒÀ¢²t4BÔ”DÄRÕ5E$•rÂ3%&W&W6VçFF—fT76WEF‡5³ÒÂt4Eô”DÄRrÂBÂG'VRÂfÇ6UÒÀ¢²t4BÔED4²Õ5E$•rÂ3%&W&W6VçFF—fT76WEF‡5³%ÒÂt4EôED4²rÂBÂG'VRÂG'VUÒÀ¢²tTäTÕ’ÔÔôDTÂÕ4„TUBrÂ3%&W&W6VçFF—fT76WEF‡5³5ÒÂtTäTÕ•ôÔôDTÅõ4„TUBrÂBÂG'VRÂfÇ6UÒÀ¢²tTäTÕ’ÔDTdTBÕ5E$•rÂ3%&W&W6VçFF—fT76WEF‡5³EÒÂtTäTÕ•ôDTdTBrÂBÂG'VRÂfÇ6UÒÀ¢²uT’ÕäTÂÓ•4Ä”4RrÂ3%&W&W6VçFF—fT76WEF‡5³UÒÂuT•ôä”äUõ4Ä”4RrÂÂfÇ6RÂfÇ6UÐ¢Ó°¢76W'B„'&’æ—4'&’†Öæ–fW7Bæ76WG2’bbÖæ–fW7Bæ76WG2æÆVæwF‚ÓÓÒ76WDFVf–æ—F–öç2æÆVæwF‚Âw&W&W6VçFF—fRÖæ–fW7B×W7B6öçF–âW†7FÇ’6—‚&Wf–WvVB76WG2r“°¢ÆWBF÷FÄ'—FW2Ò°¢6öç7B6öçFVçDÖæ–fW7BÒµÓ°¢6öç7B76WDæÇ—6W2ÒµÓ°¢ÆWBæ–æU6Æ–6TÖV7W&VÖVçBÒçVÆÃ°¢f÷"†ÆWB–æFW‚Ò²–æFW‚Â76WDFVf–æ—F–öç2æÆVæwFƒ²–æFW‚³Ò’°¢6öç7B¶–BÂf–ÆRÂ&öÆRÂÖ–æ–×VÔg&ÖW2Âfö÷E&WV—&VBÂ†—E&WV—&VEÒÒ76WDFVf–æ—F–öç5¶–æFW…Ó°¢6öç7B76WBÒÖæ–fW7Bæ76WG5¶–æFW…Ó°¢76W'DW†7D¶W•6WB†76WBÂ²v–BrÂwF‚rÂw&öÆRrÂwv–GF‚rÂv†V–v‡BrÂw6†#SbrÂv'—FW2rÂvg&ÖT6÷VçBrÂvg&ÖUv–GF‚rÂvg&ÖT†V–v‡BrÂvÇ†&WV—&VBrÂvfö÷Dæ6†÷"rÂv†—Dæ6†÷"rÂvæ–æU6Æ–6RrÂwFW‡D&¶VD–ârÂvVffV7G56W&FVBuÒÂ&W&W6VçFF—fR76WBG¶–GÖ“°¢76W'B†76WBæ–BÓÓÒ–Bbb76WBçF‚ÓÓÒf–ÆRbb76WBç&öÆRÓÓÒ&öÆRbbçVÖ&W"æ—56fT–çFVvW"†76WBçv–GF‚’bbçVÖ&W"æ—56fT–çFVvW"†76WBæ†V–v‡B’bb76WBçv–GF‚ãÒ#‚bb76WBçv–GF‚ÃÒC“bbb76WBæ†V–v‡BãÒ#‚bb76WBæ†V–v‡BÃÒC“bÂ&W&W6VçFF—fR76WB–FVçF—G’÷"F–ÖVç6–öç2–çfÆ–C¢G¶–GÖ“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†76WBæg&ÖT6÷VçB’bb76WBæg&ÖT6÷VçBãÒÖ–æ–×VÔg&ÖW2bb76WBæg&ÖT6÷VçBÃÒbbbçVÖ&W"æ—56fT–çFVvW"†76WBæg&ÖUv–GF‚’bbçVÖ&W"æ—56fT–çFVvW"†76WBæg&ÖT†V–v‡B’bb76WBæg&ÖUv–GF‚¢76WBæg&ÖT6÷VçBÓÓÒ76WBçv–GF‚bb76WBæg&ÖT†V–v‡BÓÓÒ76WBæ†V–v‡BÂ&W&W6VçFF—fRg&ÖRvVöÖWG'’–çfÆ–C¢G¶–GÖ“°¢6öç7B'—FW2Ò'—FW4B‚t„TBrÂf–ÆR“°¢6öç7BFV6öFVBÒ76W'DFV6öFVEær†'—FW2Â76WBçv–GF‚Â76WBæ†V–v‡BÂ&W&W6VçFF—fR76WBG¶–GÖ“°¢6öç7BF–vW7BÒ7&VFT†6‚‚w6†#Sbr’çWFFR†'—FW2’æF–vW7B‚v†W‚r“°¢76W'B†76WBç6†#SbÓÓÒF–vW7Bbb76WBæ'—FW2ÓÓÒ'—FW2æÆVæwF‚bb76WBæ'—FW2ÃÒ‚¢#B¢#Bbb76WBæÇ†&WV—&VBÓÓÒG'VRbb76WBçFW‡D&¶VD–âÓÓÒfÇ6Rbb76WBæVffV7G56W&FVBÓÓÒG'VRÂ&W&W6VçFF—fR'—FRÂÇ†ÂFW‡B÷"VffV7G26öçG&7BÖ—6ÖF6ƒ¢G¶–GÖ“°¢76W'B…³BÂeÒæ–æ6ÇVFW2†FV6öFVBæ6öÆ÷%G—R’Â&W&W6VçFF—fR76WBFV6Æ&W2Ç†'WBF†Rär†2æòÇ†6†ææVÃ¢G¶–GÖ“°¢76W'B†—5&W&W6VçFF—fUG&ç7&VçD76WEær†FV6öFVB’Â&W&W6VçFF—fR76WBÆ6·2&öGV7F–öâÖÆ–¶RFV6öFVBf—7VÂ–æf÷&ÖF–öã¢G¶–GÖ“°¢6öç7BæÇ—6—2ÒæÇ—¦U&W&W6VçFF—fTg&ÖW2†FV6öFVBÂ76WBæg&ÖUv–GF‚Â76WBæg&ÖT†V–v‡BÂ76WBæg&ÖT6÷VçBÂ&W&W6VçFF—fR76WBG¶–GÖ“°¢–b‡&öÆRÓÒuT•ôä”äUõ4Ä”4Rr’°¢76W'B†æÇ—6—2æg&ÖW2æWfW'’†g&ÖRÓâg&ÖRææöåG&ç7&VçE&F–òãÒã2bbg&ÖRææöåG&ç7&VçE&F–òÃÒã’bbg&ÖRæ6÷&TÇ†&F–òãÒã"bbg&ÖRæ6÷&TÇ†g&7F–öäöef—6–&ÆRãÒãRbbg&ÖRæÆ&vW7DÇ†6ö×öæVçE&F–òãÒãcRbbg&ÖRçf—6–&ÆUVçF—¦VD6öÆ÷$6÷VçBãÒbbbg&ÖRçf—6–&ÆTÇVÖ7FDFWbãÒbbbg&ÖRçf—6–&ÆT&÷VæG2æ†V–v‡BãÒ76WBæg&ÖT†V–v‡B¢ã3R’Â&W&W6VçFF—fRæ–ÖF–öâöÖöFVÂg&ÖR†27'6RÂG&ç6ÇV6VçBÖöæÇ’Âg&vÖVçFVBÂfÆB÷"Væ–FVçF–f–&ÆRf—6–&ÆR—†VÇ3¢G¶–GÖ“°¢76W'B†æWr6WB†æÇ—6—2æg&ÖW2æÖ†g&ÖRÓâg&ÖRç6†#Sb’’ç6—¦RÓÓÒæÇ—6—2æg&ÖW2æÆVæwF‚Â&W&W6VçFF—fRæ–ÖF–öâöÖöFVÂ6†VWB&WVG2â–FVçF–6Âg&ÖS¢G¶–GÖ“°¢76W'B†æÇ—6—2æ6öç6V7WF—fTg&ÖTFVÇF2æWfW'’†FVÇFÓâFVÇFæ6†ævVE—†VÅ&F–òãÒã2bbFVÇFæ6†ævVE—†VÅ&F–òÃÒã’bbFVÇFæÖVä'6öÇWFT6†ææVÄFVÇFãÒã#R’Â&W&W6VçFF—fRæ–ÖF–öâöÖöFVÂg&ÖW2Fòæ÷B6öçF–â&÷VæFVBf—6–&ÆR÷6RöÖ÷F–öâ6†ævS¢G¶–GÖ“°¢Ð¢6öç7B76W'Dæ6†÷"Ò†æ6†÷"Âæ6†÷$Æ&VÂÂ&WV—&VB’Óâ°¢–b‚&WV—&VB’²76W'B†æ6†÷"ÓÓÒçVÆÂÂG¶æ6†÷$Æ&VÇÒ×W7B&RçVÆÆ“²&WGW&ã²Ð¢76W'DW†7D¶W•6WB†æ6†÷"Â²w‚rÂw’uÒÂæ6†÷$Æ&VÂ“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†æ6†÷"ç‚’bbçVÖ&W"æ—56fT–çFVvW"†æ6†÷"ç’’bbæ6†÷"ç‚ãÒbbæ6†÷"ç‚ÃÒ76WBæg&ÖUv–GF‚bbæ6†÷"ç’ãÒbbæ6†÷"ç’ÃÒ76WBæg&ÖT†V–v‡BÂG¶æ6†÷$Æ&VÇÒ—2÷WG6–FRöæRæ–ÖF–öâg&ÖV“°¢Ó°¢76W'Dæ6†÷"†76WBæfö÷Dæ6†÷"ÂG¶–GÒfö÷Bæ6†÷&Âfö÷E&WV—&VB“°¢76W'Dæ6†÷"†76WBæ†—Dæ6†÷"ÂG¶–GÒ†—Bæ6†÷&Â†—E&WV—&VB“°¢–b†fö÷E&WV—&VB’f÷"†6öç7Bg&ÖRöbæÇ—6—2æg&ÖW2’°¢6öç7B&÷VæG2Òg&ÖRçf—6–&ÆT&÷VæG3°¢76W'B†76WBæfö÷Dæ6†÷"ç‚ãÒ&÷VæG2ç‚ÒÖF‚æ6V–Â†76WBæg&ÖUv–GF‚¢ã’bb76WBæfö÷Dæ6†÷"ç‚ÃÒ&÷VæG2ç‚²&÷VæG2çv–GF‚²ÖF‚æ6V–Â†76WBæg&ÖUv–GF‚¢ã’bb76WBæfö÷Dæ6†÷"ç’ãÒ&÷VæG2ç’²&÷VæG2æ†V–v‡BÒÖF‚æ6V–Â†76WBæg&ÖT†V–v‡B¢ã"’bb76WBæfö÷Dæ6†÷"ç’ÃÒ&÷VæG2ç’²&÷VæG2æ†V–v‡B²ÖF‚æ6V–Â†76WBæg&ÖT†V–v‡B¢ã’Â&W&W6VçFF—fRfö÷Bæ6†÷"—2æ÷BF–VBFòF†RFV6öFVBf—6–&ÆR&öG’&÷VæG3¢G¶–GÒg&ÖRG¶g&ÖRæ–æFW‡Ö“°¢Ð¢–b††—E&WV—&VB’f÷"†6öç7Bg&ÖRöbæÇ—6—2æg&ÖW2’°¢6öç7B&÷VæG2Òg&ÖRçf—6–&ÆT&÷VæG3°¢76W'B†76WBæ†—Dæ6†÷"ç‚ãÒ&÷VæG2ç‚ÒÖF‚æ6V–Â†76WBæg&ÖUv–GF‚¢ã#R’bb76WBæ†—Dæ6†÷"ç‚ÃÒ&÷VæG2ç‚²&÷VæG2çv–GF‚²ÖF‚æ6V–Â†76WBæg&ÖUv–GF‚¢ã#R’bb76WBæ†—Dæ6†÷"ç’ãÒ&÷VæG2ç’ÒÖF‚æ6V–Â†76WBæg&ÖT†V–v‡B¢ã"’bb76WBæ†—Dæ6†÷"ç’ÃÒ&÷VæG2ç’²&÷VæG2æ†V–v‡B²ÖF‚æ6V–Â†76WBæg&ÖT†V–v‡B¢ã"’Â&W&W6VçFF—fR†—Bæ6†÷"—2Vç&VÆFVBFòF†RFV6öFVBGF6²&÷VæG3¢G¶–GÒg&ÖRG¶g&ÖRæ–æFW‡Ö“°¢Ð¢–b‡&öÆRÓÓÒuT•ôä”äUõ4Ä”4Rr’°¢76W'DW†7D¶W•6WB†76WBææ–æU6Æ–6RÂ²vÆVgBrÂwF÷rÂw&–v‡BrÂv&÷GFöÒrÂvÖ–æ–×VÕv–GF‚rÂvÖ–æ–×VÔ†V–v‡BuÒÂG¶–GÒæ–æR×6Æ–6V“°¢76W'B„ö&¦V7BçfÇVW2†76WBææ–æU6Æ–6R’æWfW'’„çVÖ&W"æ—56fT–çFVvW"’bb76WBææ–æU6Æ–6RæÆVgBâbb76WBææ–æU6Æ–6RçF÷âbb76WBææ–æU6Æ–6Rç&–v‡Bâbb76WBææ–æU6Æ–6Ræ&÷GFöÒâbb76WBææ–æU6Æ–6RæÆVgB²76WBææ–æU6Æ–6Rç&–v‡BÂ76WBçv–GF‚bb76WBææ–æU6Æ–6RçF÷²76WBææ–æU6Æ–6Ræ&÷GFöÒÂ76WBæ†V–v‡Bbb76WBææ–æU6Æ–6RæÖ–æ–×VÕv–GF‚ãÒ76WBææ–æU6Æ–6RæÆVgB²76WBææ–æU6Æ–6Rç&–v‡Bbb76WBææ–æU6Æ–6RæÖ–æ–×VÔ†V–v‡BãÒ76WBææ–æU6Æ–6RçF÷²76WBææ–æU6Æ–6Ræ&÷GFöÒÂG¶–GÒæ–æR×6Æ–6R62öÖ–æ–×V×2&R–çfÆ–F“°¢76W'B†76WBæg&ÖT6÷VçBÓÓÒbb76WBçv–GF‚ÃÒ#Bbb76WBæ†V–v‡BÃÒ#BÂG¶–GÒ×W7B&RöæR&÷VæFVB&Wf–Wv&ÆRæ–æR×6Æ–6R6÷W&6Rg&ÖV“°¢æ–æU6Æ–6TÖV7W&VÖVçBÒ&VæFW$æ–æU6Æ–6TÖV7W&VÖVçB†FV6öFVBÂ76WBææ–æU6Æ–6R“°¢ÒVÇ6R76W'B†76WBææ–æU6Æ–6RÓÓÒçVÆÂÂG¶–GÒ–çfVçG2æöâÕT’æ–æR×6Æ–6R6öçG&7F“°¢76WDæÇ—6W2çW6‚‡²–BÂ&öÆRÂg&ÖT†V–v‡C¢76WBæg&ÖT†V–v‡BÂæÇ—6—2Ò“°¢F÷FÄ'—FW2³Ò'—FW2æÆVæwFƒ°¢6öçFVçDÖæ–fW7BçW6‚‡²Fƒ¢f–ÆRÂ&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G¶f–ÆWÖÒ’Â'—FW3¢'—FW2æÆVæwF‚Â6†#Sc¢6†#Sc¢G¶F–vW7GÖÒ“°¢Ð¢6öç7B6D–FVçF—G’Ò&W&W6VçFF—fT–FVçF—G”ÖV7W&VÖVçB‚t4Eô”DTåD•E•ôäEõ$õõ%D”ôârÂ76WDæÇ—6W2æf–ÇFW"†76WBÓâ76WBç&öÆRç7F'G5v—F‚‚t4Eòr’’“°¢6öç7BVæV×”–FVçF—G’Ò&W&W6VçFF—fT–FVçF—G”ÖV7W&VÖVçB‚tTäTÕ•ô”DTåD•E•ôäEõ$õõ%D”ôârÂ76WDæÇ—6W2æf–ÇFW"†76WBÓâ76WBç&öÆRç7F'G5v—F‚‚tTäTÕ•òr’’“°¢76W'B†6D–FVçF—G’ææ÷&ÖÆ—¦VEf—6–&ÆT†V–v‡E&F–òÃÒãRbb6D–FVçF—G’æÖ†–×VÔÖVä6öÆ÷W$F—7Fæ6RÃÒbbVæV×”–FVçF—G’ææ÷&ÖÆ—¦VEf—6–&ÆT†V–v‡E&F–òÃÒãbbbVæV×”–FVçF—G’æÖ†–×VÔÖVä6öÆ÷W$F—7Fæ6RÃÒ#Âw&W&W6VçFF—fR7&÷72×6†VWB–FVçF—G’÷&÷÷'F–öâÖWG&–72&R÷WG6–FRF†R&Wf–WvVB&÷VæG2r“°¢76W'B†æ–æU6Æ–6TÖV7W&VÖVçCòæ65&W6W'fVBÓÓÒG'VRbbæWr6WB†æ–æU6Æ–6TÖV7W&VÖVçBçF&vWG2æÖ‡F&vWBÓâF&vWBç6†#Sb’’ç6—¦RÓÓÒ"Âw&W&W6VçFF—fRæ–æR×6Æ–6RF–Bæ÷B&öGV6RGvòF—7F–æ7B6×&W6W'f–ær7G&WF6‚&VæFW'2r“°¢6öç7B&W&W6VçFF—fTÖV7W&VÖVçG2Ò°¢66†VÖfW'6–öã¢À¢76WG3¢76WDæÇ—6W2æÖ†76WBÓâ‡²–C¢76WBæ–BÂ&öÆS¢76WBç&öÆRÂââçV&Æ–5&W&W6VçFF—fTg&ÖTæÇ—6—2†76WBææÇ—6—2’Ò’’À¢–FVçF—G”w&÷W3¢¶6D–FVçF—G’ÂVæV×”–FVçF—G•ÒÀ¢æ–æU6Æ–6S¢²76WD–C¢uT’ÕäTÂÓ•4Ä”4RrÂââææ–æU6Æ–6TÖV7W&VÖVçBÐ¢Ó°¢6öç7BÖæ–fW7D'—FW2Ò'—FW4B‚t„TBrÂ3%&W&W6VçFF—fTÖæ–fW7EF‚“°¢F÷FÄ'—FW2³ÒÖæ–fW7D'—FW2æÆVæwFƒ°¢6öçFVçDÖæ–fW7BçVç6†–gB‡²Fƒ¢3%&W&W6VçFF—fTÖæ–fW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTÖæ–fW7EF‡ÖÒ’Â'—FW3¢Öæ–fW7D'—FW2æÆVæwF‚Â6†#Sc¢6†#Sc¢G¶7&VFT†6‚‚w6†#Sbr’çWFFR†Öæ–fW7D'—FW2’æF–vW7B‚v†W‚r—ÖÒ“°¢76W'B†Öæ–fW7BçF÷FÄ'—FW2ÓÓÒF÷FÄ'—FW2bbF÷FÄ'—FW2ÃÒ3"¢#B¢#BÂw&W&W6VçFF—fR76WBvw&VvFR'VFvWBÖ—6ÖF6‚÷"÷fW&fÆ÷rr“°¢6öç7B6öçFVçD6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3%&W&W6VçFF—fTÖæ–fW7EF‚“°¢76W'B†6öçFVçD6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶6öçFVçD6öÖÖ—GÕæÒ’ÓÓÒ3$&÷fVD76WE6÷W&6Ræ÷Væ–æt6öÖÖ—BÂw&W&W6VçFF—fR76WB6öçFVçB×W7B&RöæRW†7B6öÖÖ—BgFW"—G2&÷fÂ6öçG&öÂr“°¢76W'DW†7D6†ævVEF‡2‡3$&÷fVD76WE6÷W&6Ræ÷Væ–æt6öÖÖ—BÂ6öçFVçD6öÖÖ—BÂ·3%&W&W6VçFF—fTÖæ–fW7EF‚Âââç3%&W&W6VçFF—fT76WEF‡5ÒÂw&W&W6VçFF—fR76WB6öçFVçB6öÖÖ—Br“°¢f÷"†6öç7Bf–ÆRöb·3%&W&W6VçFF—fTÖæ–fW7EF‚Âââç3%&W&W6VçFF—fT76WEF‡5Ò’76W'B†f—'7DFD6öÖÖ—B†f–ÆR’ÓÓÒ6öçFVçD6öÖÖ—Bbbv—B…²vÆörrÂrÒÖf÷&ÖCÒT‚rÂrÒÒrÂf–ÆUÒ’ç7Æ—B‚uÆâr’æf–ÇFW"„&ööÆVâ’æÆVæwF‚ÓÓÒÂ&W&W6VçFF—fR76WB6öçFVçB—2æ÷B–Ö×WF&ÆRgFW"öæRW†7BFF—F–öã¢G¶f–ÆWÖ“°¢6öç7BW‡V7FVDf–æF–æw2Ò°¢²–C¢u3"Õ"Ô54UBÔ”DTåD•E’ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"Ô54UBÔä”ÔD”ôâÔä4„õ"ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"Ô54UBÔä”äRÕ4Ä”4RÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"Ô54UBÕ4U$$”Ä•E’ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÐ¢Ó°¢6öç7BW‡V7FVD6†V6·2Ò²t”DTåD•E•ôäEõ$õõ%D”ôârÂtä”ÔD”ôåôe$ÔUôäEôä4„õ"rÂtTddT5Eõ4U$D”ôârÂtä”äUõ4Ä”4Uõ5E$UD4‚rÂtdõ$ÔEôD”ÔTå4”ôåôäEô%TDtUBrÂuDU…Eôe$TUôäEõ%TåD”ÔUõ4U$$ÄRuÒæÖ†–BÓâ‡²–BÂ7FGW3¢u52rÒ’“°¢6öç7B&W&W6VçFF—fTÖV7W&VÖVçG56†#SbÒ6†#Sc¢G·6†#Sd6æöæ–6Â‡&W&W6VçFF—fTÖV7W&VÖVçG2—Ö°¢76W'B†W†—7G2‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–2’Âw&W&W6VçFF—fR76WB6öçFVçBW†—7G2v—F†÷WB—G2–æFWVæFVçB7&—F–2r“°¢6öç7B7&—F–2Ò§6öâ‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–2“°¢76W'DW†7D¶W•6WB†7&—F–2Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvVF—EF&vWBrÂv&÷fVE6÷W&6RrÂv6öçFVçDÖæ–fW7BrÂvÖV7W&VÖVçG2rÂv6†V6·2rÂvf–æF–æw2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&W&W6VçFF—fR76WB7&—F–2r“°¢76W'DW†7D¶W•6WB†7&—F–2æVF—EF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂw&W&W6VçFF—fR76WB7&—F–2F&vWBr“°¢76W'DW†7D¶W•6WB†7&—F–2çVç&W6öÇfVBÂ²urÂuuÒÂw&W&W6VçFF—fR76WB7&—F–2Vç&W6öÇfVBr“°¢76W'B†7&—F–2ç66†VÖfW'6–öâÓÓÒbb7&—F–2æ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"×&W&W6VçFF—fRÖ76WBÖ–æFWVæFVçBÖ7&—F–2×&÷VæBÓrbb7&—F–2ç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb7&—F–2æ'&æ6‚ÓÓÒv¶–Ö’rbb7&—F–2æ6†ævT6öçG&öÂÓÓÒ3$&÷fVD76WE6÷W&6Ræ6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†7&—F–2æVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’‡²6öÖÖ—C¢6öçFVçD6öÖÖ—BÂG&VS¢v—B…²w&Wb×'6RrÂG¶6öçFVçD6öÖÖ—GÕç·G&VWÖÒ’Ò’bb¥4ôâç7G&–æv–g’†7&—F–2æ&÷fVE6÷W&6R’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE6÷W&6R’bb¥4ôâç7G&–æv–g’†7&—F–2æ6öçFVçDÖæ–fW7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçFVçDÖæ–fW7B’bb¥4ôâç7G&–æv–g’†7&—F–2æÖV7W&VÖVçG2’ÓÓÒ¥4ôâç7G&–æv–g’‡&W&W6VçFF—fTÖV7W&VÖVçG2’Âw&W&W6VçFF—fR7&—F–2–FVçF—G’ÂF&vWBÂ&÷fÂÂ6öçFVçB÷"FV6öFVBÖV7W&VÖVçG2&–æF–ærÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†7&—F–2æ6†V6·2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD6†V6·2’bb¥4ôâç7G&–æv–g’†7&—F–2æf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†7&—F–2çVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb7&—F–2çfW&F–7BÓÓÒu55õ3%õ%õ$U$U4TåDD•dUô54UEô”äDUTäDTåEô5$•D”2rbb7&—F–2æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%õ$U$U4TåDD•dUô54UEôd”äÅô¥TDtRrÂw&W&W6VçFF—fR76WB7&—F–2F–Bæ÷B6Æ÷6RW†7Bõ66÷Rr“°¢6öç7B7&—F–46öÖÖ—BÒf—'7DFD6öÖÖ—B‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–2“°¢76W'B†7&—F–46öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶7&—F–46öÖÖ—GÕæÒ’ÓÓÒ6öçFVçD6öÖÖ—BÂw&W&W6VçFF—fR7&—F–2×W7B–ÖÖVF–FVÇ’föÆÆ÷rW†7B76WB6öçFVçBr“°¢76W'DW†7D6†ævVEF‡2†6öçFVçD6öÖÖ—BÂ7&—F–46öÖÖ—BÂ·3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–5ÒÂw&W&W6VçFF—fR76WB7&—F–26öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–2Â7&—F–46öÖÖ—B“°¢76W'B†W†—7G2‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvR’Âw&W&W6VçFF—fR7&—F–2W†—7G2v—F†÷WBf–æÂ§VFvRr“°¢6öç7B§VFvRÒ§6öâ‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvR“°¢76W'DW†7D¶W•6WB†§VFvRÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwF&vWBrÂv7&—F–2rÂvÖV7W&VÖVçG56†#SbrÂv6†V6·2rÂvf–æF–æw2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&W&W6VçFF—fR76WBf–æÂ§VFvRr“°¢76W'DW†7D¶W•6WB†§VFvRçF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂw&W&W6VçFF—fR§VFvRF&vWBr“°¢76W'DW†7D¶W•6WB†§VFvRæ7&—F–2Â²wF‚rÂv&Æö"uÒÂw&W&W6VçFF—fR§VFvR7&—F–2&–æF–ærr“°¢76W'DW†7D¶W•6WB†§VFvRçVç&W6öÇfVBÂ²urÂuuÒÂw&W&W6VçFF—fR§VFvRVç&W6öÇfVBr“°¢76W'B†§VFvRç66†VÖfW'6–öâÓÓÒbb§VFvRæ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"×&W&W6VçFF—fRÖ76WBÖf–æÂÖ§VFvR×&÷VæBÓrbb§VFvRç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb§VFvRæ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb§VFvRæ6†ævT6öçG&öÂÓÓÒ7&—F–2æ6†ævT6öçG&öÂbb¥4ôâç7G&–æv–g’†§VFvRçF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’†7&—F–2æVF—EF&vWB’bb¥4ôâç7G&–æv–g’†§VFvRæ7&—F–2’ÓÓÒ¥4ôâç7G&–æv–g’‡²Fƒ¢3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–2Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–7ÖÒ’Ò’bb§VFvRæÖV7W&VÖVçG56†#SbÓÓÒ&W&W6VçFF—fTÖV7W&VÖVçG56†#Sbbb¥4ôâç7G&–æv–g’†§VFvRæ6†V6·2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD6†V6·2’bb¥4ôâç7G&–æv–g’†§VFvRæf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†§VFvRçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb§VFvRçfW&F–7BÓÓÒu55õ3%õ%õ$U$U4TåDD•dUô54UEôd”äÅô¥TDtRrbb§VFvRæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%õ$U$U4TåDD•dUô54UEô4ôÕÄUD”ôârÂw&W&W6VçFF—fRf–æÂ§VFvRÖ—6ÖF6‚÷"÷fW&6Æ–Òr“°¢6öç7B§VFvT6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvR“°¢76W'B†§VFvT6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶§VFvT6öÖÖ—GÕæÒ’ÓÓÒ7&—F–46öÖÖ—BÂw&W&W6VçFF—fRf–æÂ§VFvR×W7B–ÖÖVF–FVÇ’föÆÆ÷r7&—F–2r“°¢76W'DW†7D6†ævVEF‡2†7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ·3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvUÒÂw&W&W6VçFF—fR76WBf–æÂÖ§VFvR6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvRÂ§VFvT6öÖÖ—B“°¢76W'B†W†—7G2‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öâ’Âw&W&W6VçFF—fRf–æÂ§VFvRW†—7G2v—F†÷WB6ö×ÆWF–öâr“°¢6öç7B6ö×ÆWF–öâÒ§6öâ‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öâ“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&–f–VD6öçFVçBrÂvf–æÄ§VFvRrÂvÖæ–fW7BrÂvÖV7W&VÖVçG56†#SbrÂwfW&F–7BrÂwVç&W6öÇfVBrÂv&÷VæF&–W2rÂvÖ†–×VÕfW&F–7BuÒÂw&W&W6VçFF—fR76WB6ö×ÆWF–öâr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâçfW&–f–VD6öçFVçBÂ²v6öÖÖ—BrÂwG&VRuÒÂw&W&W6VçFF—fR6ö×ÆWF–öâ6öçFVçBr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâæf–æÄ§VFvRÂ²wF‚rÂv&Æö"uÒÂw&W&W6VçFF—fR6ö×ÆWF–öâ§VFvRr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâæÖæ–fW7BÂ²wF‚rÂv&Æö"rÂw6†#SbuÒÂw&W&W6VçFF—fR6ö×ÆWF–öâÖæ–fW7Br“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâçVç&W6öÇfVBÂ²urÂuuÒÂw&W&W6VçFF—fR6ö×ÆWF–öâVç&W6öÇfVBr“°¢76W'B†6ö×ÆWF–öâç66†VÖfW'6–öâÓÓÒbb6ö×ÆWF–öâæ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"×&W&W6VçFF—fRÖ76WBÖ6ö×ÆWF–öâ×&÷VæBÓrbb6ö×ÆWF–öâç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb6ö×ÆWF–öâæ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb6ö×ÆWF–öâæ6†ævT6öçG&öÂÓÓÒ7&—F–2æ6†ævT6öçG&öÂbb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâçfW&–f–VD6öçFVçB’ÓÓÒ¥4ôâç7G&–æv–g’†7&—F–2æVF—EF&vWB’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæf–æÄ§VFvR’ÓÓÒ¥4ôâç7G&–æv–g’‡²Fƒ¢3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvRÂ&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvWÖÒ’Ò’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæÖæ–fW7B’ÓÓÒ¥4ôâç7G&–æv–g’‡²Fƒ¢3%&W&W6VçFF—fTÖæ–fW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTÖæ–fW7EF‡ÖÒ’Â6†#Sc¢6öçFVçDÖæ–fW7E³Òç6†#SbÒ’bb6ö×ÆWF–öâæÖV7W&VÖVçG56†#SbÓÓÒ&W&W6VçFF—fTÖV7W&VÖVçG56†#SbÂw&W&W6VçFF—fR6ö×ÆWF–öâF&vWBöWf–FVæ6RöÖV7W&VÖVçB&–æF–ærÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6ö×ÆWF–öâçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†Öæ–fW7Bæ&÷VæF&–W2’bb6ö×ÆWF–öâçfW&F–7BÓÓÒu55õ3%õ%õ$U$U4TåDD•dUô54UBrbb6ö×ÆWF–öâæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%õ$U$U4TåDD•dUô54UEõ55ô5D•dD”ôârÂw&W&W6VçFF—fR6ö×ÆWF–öâfW&F–7B÷"&÷VæF'’Ö—6ÖF6‚r“°¢6öç7B6ö×ÆWF–öä6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öâ“°¢76W'B†6ö×ÆWF–öä6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶6ö×ÆWF–öä6öÖÖ—GÕæÒ’ÓÓÒ§VFvT6öÖÖ—BÂw&W&W6VçFF—fR6ö×ÆWF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rf–æÂ§VFvRr“°¢76W'DW†7D6†ævVEF‡2†§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ·3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öåÒÂw&W&W6VçFF—fR76WB6ö×ÆWF–öâ6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öâÂ6ö×ÆWF–öä6öÖÖ—B“°¢76W'B‡3$76WE746öçG&öÂÂw&W&W6VçFF—fR6ö×ÆWF–öâW†—7G2v—F†÷WBW†7B&÷VæBC"55ô54UB7F—fF–öâr“°¢76W'DW†7D¶W•6WB‡3$76WE746öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂv&÷fVE6÷W&6RrÂvWf–FVæ6RrÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂw&÷VæBC"6öçG&öÂr“°¢76W'DW†7D¶W•6WB‡3$76WE746öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂw&÷VæBC"VçG'’r“°¢76W'DW†7D¶W•6WB‡3$76WE746öçG&öÂæWf–FVæ6RÂ²vÖæ–fW7BrÂv7&—F–2rÂvf–æÄ§VFvRrÂv6ö×ÆWF–öâuÒÂw&÷VæBC"Wf–FVæ6Rr“°¢f÷"†6öç7B&–æF–æröbö&¦V7BçfÇVW2‡3$76WE746öçG&öÂæWf–FVæ6R’’76W'DW†7D¶W•6WB†&–æF–ærÂ²wF‚rÂv&Æö"uÒÂw&÷VæBC"Wf–FVæ6R&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3$76WE746öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²w&W&W6VçFF—fT76WE72rÂv76WEföÇVÖTÆÆ÷vVBrÂw'VçF–ÖT–çFVw&F–öäÆÆ÷vVBrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC"6ö×ÆWF–öâ&÷VæF'’r“°¢6öç7BW‡V7FVDWf–FVæ6RÒ°¢Öæ–fW7C¢²Fƒ¢3%&W&W6VçFF—fTÖæ–fW7EF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTÖæ–fW7EF‡ÖÒ’ÒÀ¢7&—F–3¢²Fƒ¢3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–2Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–7ÖÒ’ÒÀ¢f–æÄ§VFvS¢²Fƒ¢3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvRÂ&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvWÖÒ’ÒÀ¢6ö×ÆWF–öã¢²Fƒ¢3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öâÂ&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öçÖÒ’Ð¢Ó°¢76W'B‡3$76WE746öçG&öÂç66†VÖfW'6–öâÓÓÒbb3$76WE746öçG&öÂæ'F–f7D–BÓÓÒv6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓC"rbb—46æöæ–6Ä—6ôFFR‡3$76WE746öçG&öÂæ7&VFVDB’bb3$76WE746öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3$76WE746öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb3$76WE746öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ3$&÷fVD76WE6÷W&6Ræ6öçG&öÅF‚bb¥4ôâç7G&–æv–g’‡3$76WE746öçG&öÂæVçG'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢6ö×ÆWF–öä6öÖÖ—BÂG&VS¢v—B…²w&Wb×'6RrÂG¶6ö×ÆWF–öä6öÖÖ—GÕç·G&VWÖÒ’Ò’bb¥4ôâç7G&–æv–g’‡3$76WE746öçG&öÂæ&÷fVE6÷W&6R’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE6÷W&6R’bb¥4ôâç7G&–æv–g’‡3$76WE746öçG&öÂæWf–FVæ6R’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDWf–FVæ6R’Âw&÷VæBC"–FVçF—G’Â&VçBÂVçG'’Â&÷fÂ÷"Wf–FVæ6RÖ—6ÖF6‚r“°¢76W'B‡3$76WE746öçG&öÂç7FGW2ÓÓÒu55ô54UBrbb3$76WE746öçG&öÂçfW&F–7BÓÓÒu55õ3%õ%õ$U$U4TåDD•dUô54UBrbb3$76WE746öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb3$76WE746öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"Õ"Ô54UBÕ$ôET5D”ôârbb3$76WE746öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6Rbb3$76WE746öçG&öÂç66÷RÓÓÒu3%õ%õ$U$U4TåDD•dUô54UEõ55ôôäÅ•ôäõõdôÅTÔUôäõõ%TåD”ÔRrÂw&÷VæBC"†6R÷66÷R÷fW&F–7BÖ—6ÖF6‚r“°¢6öç7B&÷VæCC$f÷&&–FFVâÒ²ââææWr6WB…²ââæW‡V7FVE3%$f÷&&–FFVåw&—FW2ÂââæW‡V7FVE3%$ÆÆ÷vVEw&—FW5Ò•Òæf–ÇFW"†f–ÆRÓâW‡V7FVE3$76WE74v÷fW&ææ6TW‡FVç6–öåw&—FW2æ–æ6ÇVFW2†f–ÆR’“°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WE746öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3$76WE74v÷fW&ææ6TW‡FVç6–öåw&—FW2’bb¥4ôâç7G&–æv–g’‡3$76WE746öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’‡&÷VæCC$f÷&&–FFVâ’bb¥4ôâç7G&–æv–g’‡3$76WE746öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²&W&W6VçFF—fT76WE73¢G'VRÂ76WEföÇVÖTÆÆ÷vVC¢fÇ6RÂ'VçF–ÖT–çFVw&F–öäÆÆ÷vVC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÂÖ†–×VÕfW&F–7C¢u55ô54UBrÒ’Âw&÷VæBC"w&—FR÷"6ö×ÆWF–öâ&÷VæF'’—2Vç6fRr“°¢6öç7B÷Væ–æt6öÖÖ—BÒ3$76WE74÷Væ–æt6öÖÖ—C°¢76W'DW†7E6–ævÆU&VçB†÷Væ–æt6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂw&÷VæBC"55ô54UB7F—fF–öâr“°¢76W'DW†7D6†ævVEF‡2†6ö×ÆWF–öä6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂW‡V7FVE3$76WE74÷Væ–æuw&—FW2Âw&÷VæBC"FöÖ–255ô54UB7F—fF–öâr“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WE746öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂW‡V7FVE&÷VæCC$Fö7VÖVçEFW‡BÂw&÷VæBC"7W'&VçBFö7VÖVçG2r“°¢6öç7B&÷VæCC$g&VW¦TVæBÒ3$76WEföÇVÖU66÷T÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3$76WEföÇVÖU66÷T÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’†÷Væ–æt6öÖÖ—BÂ&÷VæCC$g&VW¦TVæBÂ3$76WE746öçG&öÂÂw&÷VæBC"g&÷¦Vâ55ô54UB7FFRrÂ#BÂ#BÂbÂ#BÂB“°¢&WGW&â²6öçFVçD6öÖÖ—BÂ7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÓ°§Ð¦6öç7B3%&W&W6VçFF—fT76WE72ÒfW&–g•3%&W&W6VçFF—fT76WE72‚“°¦gVæ7F–öâ6†#Sdf–ÆTB†6öÖÖ—BÂf–ÆR’°¢&WGW&â6†#Sc¢G¶7&VFT†6‚‚w6†#Sbr’çWFFR†'—FW4B†6öÖÖ—BÂf–ÆR’’æF–vW7B‚v†W‚r—Ö°§Ð¦gVæ7F–öâW†7EF„&–æF–ætB†6öÖÖ—BÂf–ÆRÂ–æ6ÇVFU6†#SbÒfÇ6R’°¢6öç7B&–æF–ærÒ²Fƒ¢f–ÆRÂ&Æö#¢v—B…²w&Wb×'6RrÂG¶6öÖÖ—GÓ¢G¶f–ÆWÖÒ’Ó°¢–b†–æ6ÇVFU6†#Sb’&–æF–ærç6†#SbÒ6†#Sdf–ÆTB†6öÖÖ—BÂf–ÆR“°¢&WGW&â&–æF–æs°§Ð¦gVæ7F–öâ76W'E6÷'FVEVæ—VU7G&–æw2‡fÇVW2ÂÆ&VÂÂÖ–æ–×VÒÒÂÖ†–×VÒÒS"’°¢76W'B„'&’æ—4'&’‡fÇVW2’bbfÇVW2æÆVæwF‚ãÒÖ–æ–×VÒbbfÇVW2æÆVæwF‚ÃÒÖ†–×VÒbbfÇVW2æWfW'’‡fÇVRÓâG—VöbfÇVRÓÓÒw7G&–ærrbbfÇVRæÆVæwF‚ãÒ’ÂG¶Æ&VÇÓ¢7G&–ærÆ—7B—2Ö—76–ær÷"÷WG6–FR&÷VæG6“°¢76W'B„¥4ôâç7G&–æv–g’‡fÇVW2’ÓÓÒ¥4ôâç7G&–æv–g’…²ââææWr6WB‡fÇVW2•Òç6÷'B‚’’ÂG¶Æ&VÇÓ¢7G&–æw2&Ræ÷BW†7B6÷'FVBVæ—VRfÇVW6“°§Ð¦gVæ7F–öâ76W'E6fU3%föÇVÖUF‚†f–ÆRÂ&VÂÆ&VÂ’°¢76W'B‡G—Vöbf–ÆRÓÓÒw7G&–ærrbbf–ÆRÓÓÒf–ÆRææ÷&ÖÆ—¦R‚täd2r’bbõåµÇƒ#ÕÇƒtUÒ²BòçFW7B†f–ÆR’bbf–ÆRæ–æ6ÇVFW2‚uÅÂr’bbf–ÆRç7Æ—B‚ròr’ç6öÖR‡6VvÖVçBÓâ6VvÖVçBÇÂ6VvÖVçBÓÓÒrârÇÂ6VvÖVçBÓÓÒrâârÇÂ6VvÖVçBç7F'G5v—F‚‚râr’’ÂG¶Æ&VÇÓ¢F‚—2æ÷B6æöæ–6Â44”’&VÆF—fR6öçFVçF“°¢6öç7B&Vf—‚Ò7FWB÷3"ö76WB×&öGV7F–öâ×"÷föÇVÖR×&÷VæBÓòG¶&VÒö°¢76W'B†f–ÆRç7F'G5v—F‚‡&Vf—‚’bbõç7FWEÂ÷3%Âö76WB×&öGV7F–öâ×%Â÷föÇVÖR×&÷VæBÓÂòƒó§6÷W&6WÆFVÆ—fW'’•Âõ´Õ¦×£Ó•Õ´Õ¦×£Ó•òâòÕÒ¥ÂçærBòçFW7B†f–ÆR’ÂG¶Æ&VÇÓ¢F‚W66W2F†RW†7BG¶&VÒ76WB&ö÷B÷"W6W2âVç&Wf–WvVBf÷&ÖF“°¢76W'B‚3%&W&W6VçFF—fT76WEF‡2æ–æ6ÇVFW2†f–ÆR’bbf–ÆRÓÒ3%&W&W6VçFF—fTÖæ–fW7EF‚bbf–ÆRç7F'G5v—F‚‚w7FWB÷3"övöÆFVâÖÖ7FW"×òr’ÂG¶Æ&VÇÓ¢F‚÷fW&Æ2&W&W6VçFF—fR÷"vöÆFVâÖ7FW"6öçFVçF“°§Ð¦gVæ7F–öâW‡V7FVD76WEföÇVÖT&F6„Wf–FVæ6UF‡2†&F6„–B’°¢6öç7B&Vf—‚ÒG·3$76WEföÇVÖU&Wf–Wu&ö÷GÒö76WB×föÇVÖRÒG¶&F6„–GÖ°¢&WGW&â°¢G·&Vf—‡ÒÖvVæW&F–öâ×&÷fVææ6R×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖÖçVÂÖ6÷'&V7F–öâÖÆör×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖW‡÷'BÖÆ–æVvR×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖÖæ–fW7B×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖÖV7W&VÖVçG2×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖfV6–&–Æ—G’ÖVF—B×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖ–æFWVæFVçBÖ7&—F–2×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖf–æÂÖ§VFvR×&÷VæBÓæ§6öæÀ¢G·&Vf—‡ÒÖ6ö×ÆWF–öâÖWf–FVæ6R×&÷VæBÓæ§6öæ ¢Ó°§Ð¦6öç7B3$76WEföÇVÖU66÷T7&—FW&–öä–G2Ò°¢td”ä•DUôU„5EõD…2rÂu4õU$4UôDTÄ•dU%•õ4U$D”ôârÂtdõU%ô4E5ôäEôTäTÕ•ôÔôDTÅ2rÀ¢t$D4…ôäEôUd”DTä4Uô4õdU$tRrÂt%•DUô%TDtUBrÂte$ÔUôä4„õ%ôtTôÔUE%’rÀ¢tä”äUõ4Ä”4Uô4ôåE$5BrÂtU…õ%EôÄ”äTtRrÂtDDô4ôå5TÔU%ôÔ”ärrÀ¢täõõDU…Eô$´TEô”ârÂtäõõ%TåD”ÔUôUD„õ$•¤D”ôârÂu$TÄT4Uô$õTäD$”U2p¥Ó°¦6öç7B3$76WEföÇVÖU66÷U&W6öÇfVDf–æF–æw2Ò°¢²–C¢u3"Õ"ÕdôÅTÔRÕ44õRÕD‚ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÕ44õRÕ4õU$4RÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÕ44õRÔ$D4‚ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÕ44õRÔ%TDtUBÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÕ44õRÕ%TåD”ÔRÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÐ¥Ó°¦gVæ7F–öâfW&–g•3$76WEföÇVÖU66÷T6öçG&7B†6öçG&7BÂ6öçG&7D6öÖÖ—BÂW‡V7FVD&÷fVE&W&W6VçFF—fR’°¢76W'DW†7D¶W•6WB†6öçG&7BÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvv÷fW&ææ6T7F—fF–öârÂv&÷fVE&W&W6VçFF—fRrÂw66÷RrÂw6÷W&6T76WG2rÂvFVÆ—fW'”76WG2rÂw&öGV7F–öä&F6†W2rÂv'VFvWG2rÂv66WFæ6RrÂv&÷VæF&–W2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC276WB×föÇVÖR66÷R6öçG&7Br“°¢76W'DW†7D¶W•6WB†6öçG&7Bæ6†ævT6öçG&öÂÂ²wF‚rÂv&Æö"uÒÂw&÷VæBC26öçG&7B6öçG&öÂ&–æF–ærr“°¢76W'DW†7D¶W•6WB†6öçG&7Bæv÷fW&ææ6T7F—fF–öâÂ²wF‚rÂv&Æö"uÒÂw&÷VæBC26öçG&7B7F—fF–öâ&–æF–ærr“°¢76W'DW†7D¶W•6WB†6öçG&7Bæ'VFvWG2Â²w6÷W&6T'—FW2rÂvFVÆ—fW'”'—FW2rÂwF÷FÄ'—FW2rÂvÖ†–×VÕ&W÷6—F÷'”'—FW2uÒÂw&÷VæBC26öçG&7B'VFvWG2r“°¢76W'DW†7D¶W•6WB†6öçG&7Bæ66WFæ6RÂ²v–çFW&æÅrÂv–çFW&æÅrÂvFV6öFVDF–ÖVç6–öç2rÂvW†7DF–vW7G2rÂvæ–ÖF–öä6öçF–çV—G’rÂvæ6†÷$vVöÖWG'’rÂvæ–æU6Æ–6U7G&WF6‚rÂv7&÷7476WD–FVçF—G’rÂw6÷W&6TFVÆ—fW'”Æ–æVvRrÂv'VFvWDVF—BrÂvFF6öç7VÖW$Ö–ærrÂv–æFWVæFVçD7&—F–2rÂvf–æÄ§VFvRuÒÂw&÷VæBC26öçG&7B66WFæ6Rr“°¢76W'DW†7D¶W•6WB†6öçG&7Bæ&÷VæF&–W2Â²w66÷T6öçG&7DöæÇ’rÂv76WD'—FW4WF†÷&—¦VBrÂv76WEföÇVÖTÆÆ÷vVBrÂw'VçF–ÖT–çFVw&F–öäÆÆ÷vVBrÂvvÖTFF×WFF–öäÆÆ÷vVBrÂvV6öæö×”×WFF–öäÆÆ÷vVBrÂw6fU66†VÖ×WFF–öäÆÆ÷vVBrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBuÒÂw&÷VæBC26öçG&7B&÷VæF&–W2r“°¢76W'DW†7D¶W•6WB†6öçG&7BçVç&W6öÇfVBÂ²urÂuuÒÂw&÷VæBC26öçG&7BVç&W6öÇfVBr“°¢76W'B†6öçG&7Bç66†VÖfW'6–öâÓÓÒbb6öçG&7Bæ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"Ö76WB×föÇVÖR×66÷RÖ6öçG&7B×&÷VæBÓrbb—46æöæ–6Ä—6ôFFR†6öçG&7Bæ7&VFVDB’bb6öçG&7Bç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb6öçG&7Bæ'&æ6‚ÓÓÒv¶–Ö’rÂw&÷VæBC26öçG&7B–FVçF—G’Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&7Bæ6†ævT6öçG&öÂ’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷T6öçG&öÅF‚’’bb¥4ôâç7G&–æv–g’†6öçG&7Bæv÷fW&ææ6T7F—fF–öâ’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TÆö6µF‚’’bb¥4ôâç7G&–æv–g’†6öçG&7Bæ&÷fVE&W&W6VçFF—fR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE&W&W6VçFF—fR’Âw&÷VæBC26öçG&7BWF†÷&—G’÷"&W&W6VçFF—fR&–æF–ærÖ—6ÖF6‚r“°¢76W'B†6öçG&7Bç66÷RÓÓÒu3%õ%ô54UEõdôÅTÔUõ44õUô4ôåE$5EôôäÅ•ôäõô54UEô%•DU5ôäõõ%TåD”ÔRrbb6öçG&7BçfW&F–7BÓÓÒt”åõ$ôu$U55õ3%õ%õdôÅTÔUõ44õUô4ôåE$5Brbb6öçG&7BæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôåô5D•dD”ôârbb¥4ôâç7G&–æv–g’†6öçG&7BçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’Âw&÷VæBC26öçG&7B66÷R÷"fW&F–7B÷fW&6Æ–×2r“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&7Bæ66WFæ6R’ÓÓÒ¥4ôâç7G&–æv–g’‡²–çFW&æÅ¢Â–çFW&æÅ¢ÂFV6öFVDF–ÖVç6–öç3¢G'VRÂW†7DF–vW7G3¢G'VRÂæ–ÖF–öä6öçF–çV—G“¢G'VRÂæ6†÷$vVöÖWG'“¢G'VRÂæ–æU6Æ–6U7G&WF6ƒ¢G'VRÂ7&÷7476WD–FVçF—G“¢G'VRÂ6÷W&6TFVÆ—fW'”Æ–æVvS¢G'VRÂ'VFvWDVF—C¢G'VRÂFF6öç7VÖW$Ö–æs¢G'VRÂ–æFWVæFVçD7&—F–3¢G'VRÂf–æÄ§VFvS¢G'VRÒ’Âw&÷VæBC266WFæ6R6öçG&7BF–ffW'2g&öÒF†RW†7B&öGV7F–öâvFRr“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&7Bæ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’‡²66÷T6öçG&7DöæÇ“¢G'VRÂ76WD'—FW4WF†÷&—¦VC¢fÇ6RÂ76WEföÇVÖTÆÆ÷vVC¢fÇ6RÂ'VçF–ÖT–çFVw&F–öäÆÆ÷vVC¢fÇ6RÂvÖTFF×WFF–öäÆÆ÷vVC¢fÇ6RÂV6öæö×”×WFF–öäÆÆ÷vVC¢fÇ6RÂ6fU66†VÖ×WFF–öäÆÆ÷vVC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÒ’Âw&÷VæBC26öçG&7B7&÷76W2â76WBÂ'VçF–ÖRÂ&VÆV6R÷"FWf–6R&÷VæF'’r“°¢76W'B„'&’æ—4'&’†6öçG&7Bç6÷W&6T76WG2’bb6öçG&7Bç6÷W&6T76WG2æÆVæwF‚ãÒRbb6öçG&7Bç6÷W&6T76WG2æÆVæwF‚ÃÒ#‚bb'&’æ—4'&’†6öçG&7BæFVÆ—fW'”76WG2’bb6öçG&7BæFVÆ—fW'”76WG2æÆVæwF‚ãÒRbb6öçG&7BæFVÆ—fW'”76WG2æÆVæwF‚ÃÒ#SbÂw&÷VæBC26÷W&6RöFVÆ—fW'’76WB–çfVçF÷'’—2Ö—76–ær÷"÷WG6–FR&Wf–WvVB&÷VæG2r“°¢6öç7B6÷W&6T–G2ÒµÓ²6öç7B6÷W&6UF‡2ÒµÓ²6öç7B6÷W&6T'”–BÒæWrÖ‚“²ÆWB6÷W&6T'VFvWBÒ°¢6öç7B&W&W6VçFF—fT76WD–G2ÒæWr6WB†§6öâ‡3%&W&W6VçFF—fTÖæ–fW7EF‚’æ76WG2æÖ†76WBÓâ76WBæ–B’“°¢f÷"†6öç7B76WBöb6öçG&7Bç6÷W&6T76WG2’°¢76W'DW†7D¶W•6WB†76WBÂ²v–BrÂwF‚rÂw&öÆRrÂw7V&¦V7D–BrÂvf÷&ÖBrÂwv–GF‚rÂv†V–v‡BrÂvÇ†&WV—&VBrÂvÖ„'—FW2rÂv6ö×öæVçG2rÂw&W&W6VçFF—fT76WD–G2rÂw&WV—&VDf÷$FVÆ—fW'”–G2rÂwFW‡D&¶VD–âuÒÂ&÷VæBC26÷W&6R76WBG¶76WBæ–BóòsÆÖ—76–æsâwÖ“°¢76W'B‡G—Vöb76WBæ–BÓÓÒw7G&–ærrbbõå´Õ¥Õ´Õ£Ó•òÕ×³"Ãc7ÒBòçFW7B†76WBæ–B’bb²t4„$5DU%ôÔôDTÅõ4„TUBrÂt4„$5DU%ôÄ”U%õÄDRrÂtTäTÕ•ôÔôDTÅõ4„TUBrÂtTäTÕ•ôÄ”U%õÄDRrÂt$4´u$õTäEôÔ5DU"rÂuT•ôÔ5DU"rÂtTddT5EôÔ5DU"rÂt”4ôåôÔ5DU"uÒæ–æ6ÇVFW2†76WBç&öÆR’bbõå´Õ¥Õ´Õ£Ó•òÕ×³Ãc7ÒBòçFW7B†76WBç7V&¦V7D–Bóòrr’Â&÷VæBC26÷W&6R–FVçF—G’÷"&öÆR–çfÆ–C¢G¶76WBæ–GÖ“°¢76W'E6fU3%föÇVÖUF‚†76WBçF‚Âw6÷W&6RrÂ&÷VæBC26÷W&6R76WBG¶76WBæ–GÖ“°¢76W'B†76WBæf÷&ÖBÓÓÒuärrbb76WBçF‚æVæG5v—F‚‚rçærr’Â&÷VæBC26÷W&6Rf÷&ÖB÷F‚Ö—6ÖF6ƒ¢G¶76WBæ–GÖ“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†76WBçv–GF‚’bbçVÖ&W"æ—56fT–çFVvW"†76WBæ†V–v‡B’bb76WBçv–GF‚ãÒcBbb76WBçv–GF‚ÃÒƒ“"bb76WBæ†V–v‡BãÒcBbb76WBæ†V–v‡BÃÒƒ“"bbG—Vöb76WBæÇ†&WV—&VBÓÓÒv&ööÆVârbbçVÖ&W"æ—56fT–çFVvW"†76WBæÖ„'—FW2’bb76WBæÖ„'—FW2ãÒ#Bbb76WBæÖ„'—FW2ÃÒb¢#B¢#Bbb76WBçFW‡D&¶VD–âÓÓÒfÇ6RÂ&÷VæBC26÷W&6RF–ÖVç6–öç2Â'—FR6÷"FW‡BöÆ–7’–çfÆ–C¢G¶76WBæ–GÖ“°¢76W'E6÷'FVEVæ—VU7G&–æw2†76WBæ6ö×öæVçG2Â&÷VæBC26÷W&6R6ö×öæVçG2G¶76WBæ–GÖÂÂb“°¢76W'B†76WBæ6ö×öæVçG2æWfW'’†6ö×öæVçBÓâ²te$ôåBrÂu4”DRrÂt$4²rÂtUT•ÔTåBrÂtd4RrÂt$ôE•õ$õõ%D”ôârÂtdôõEôä4„õ"rÂt4ôÄÄ•4”ôåô$õTäE2rÂud•4”$ÄUô$õTäE2rÂt$4´u$õTäEôDUD‚rÂtä”äUõ4Ä”4Uô42rÂtTddT5Eõ4U$D”ôârÂt”4ôåõ4”Ä„õTUEDRuÒæ–æ6ÇVFW2†6ö×öæVçB’’Â&÷VæBC26÷W&6R76WB†2âVç&Wf–WvVB6ö×öæVçC¢G¶76WBæ–GÖ“°¢76W'E6÷'FVEVæ—VU7G&–æw2†76WBç&W&W6VçFF—fT76WD–G2Â&÷VæBC26÷W&6R&W&W6VçFF—fRÆ–æVvRG¶76WBæ–GÖÂÂb“°¢76W'B†76WBç&W&W6VçFF—fT76WD–G2æWfW'’†–BÓâ&W&W6VçFF—fT76WD–G2æ†2†–B’’Â&÷VæBC26÷W&6R76WB6—FW2âVæ¶æ÷vâ&W&W6VçFF—fR76WC¢G¶76WBæ–GÖ“°¢76W'E6÷'FVEVæ—VU7G&–æw2†76WBç&WV—&VDf÷$FVÆ—fW'”–G2Â&÷VæBC26÷W&6RFVÆ—fW'’6÷fW&vRG¶76WBæ–GÖÂÂ#Sb“°¢6÷W&6T–G2çW6‚†76WBæ–B“²6÷W&6UF‡2çW6‚†76WBçF‚“²6÷W&6T'”–Bç6WB†76WBæ–BÂ76WB“²6÷W&6T'VFvWB³Ò76WBæÖ„'—FW3°¢Ð¢76W'E6÷'FVEVæ—VU7G&–æw2‡6÷W&6T–G2Âw&÷VæBC26÷W&6R76WB”G2rÂRÂ#‚“°¢76W'E6÷'FVEVæ—VU7G&–æw2‡6÷W&6UF‡2Âw&÷VæBC26÷W&6R76WBF‡2rÂRÂ#‚“°¢6öç7B66TföÆFVE6÷W&6UF‡2Ò6÷W&6UF‡2æÖ†f–ÆRÓâf–ÆRçFôÆ÷vW$66R‚’“°¢76W'B†æWr6WB†66TföÆFVE6÷W&6UF‡2’ç6—¦RÓÓÒ66TföÆFVE6÷W&6UF‡2æÆVæwF‚Âw&÷VæBC26÷W&6RF‡2†fR66RÖföÆB6öÆÆ—6–öâr“°¢6öç7BFVÆ—fW'”–G2ÒµÓ²6öç7BFVÆ—fW'•F‡2ÒµÓ²6öç7BFVÆ—fW'”'”–BÒæWrÖ‚“²ÆWBFVÆ—fW'”'VFvWBÒ°¢6öç7B6öç7VÖW%fö6'VÆ'’ÒæWr6WB…²tÄÅ•õd•5TÂrÂtTäTÕ•õd•5TÂrÂt$EDÄUô$4´u$õTäBrÂt$EDÄUôTddT5BrÂuT•õ4´”ârÂu%E•ô4$BrÂu$Ut$EôdTTD$4²rÂtdÄôõ%õE$å4•D”ôâuÒ“°¢f÷"†6öç7B76WBöb6öçG&7BæFVÆ—fW'”76WG2’°¢76W'DW†7D¶W•6WB†76WBÂ²v–BrÂwF‚rÂw&öÆRrÂw7V&¦V7D–BrÂvf÷&ÖBrÂwv–GF‚rÂv†V–v‡BrÂvÇ†&WV—&VBrÂvÖ„'—FW2rÂw6÷W&6T76WD–G2rÂvW‡÷'E&V6—RrÂvg&ÖW2rÂvæ6†÷'2rÂvæ–æU6Æ–6RrÂvFF6öç7VÖW'2rÂwFW‡D&¶VD–ârÂw'VçF–ÖUW6TWF†÷&—¦VBuÒÂ&÷VæBC2FVÆ—fW'’76WBG¶76WBæ–BóòsÆÖ—76–æsâwÖ“°¢76W'B‡G—Vöb76WBæ–BÓÓÒw7G&–ærrbbõå´Õ¥Õ´Õ£Ó•òÕ×³"Ãc7ÒBòçFW7B†76WBæ–B’bb²t4„$5DU%ôÔôDTÅõ4„TUBrÂt4„$5DU%ôä”ÔD”ôârÂtTäTÕ•ôÔôDTÅõ4„TUBrÂtTäTÕ•ôä”ÔD”ôârÂt$4´u$õTäEôÄ”U"rÂuT•ôä”äUõ4Ä”4RrÂtTddT5BrÂt”4ôâuÒæ–æ6ÇVFW2†76WBç&öÆR’bbõå´Õ¥Õ´Õ£Ó•òÕ×³Ãc7ÒBòçFW7B†76WBç7V&¦V7D–Bóòrr’Â&÷VæBC2FVÆ—fW'’–FVçF—G’÷"&öÆR–çfÆ–C¢G¶76WBæ–GÖ“°¢76W'E6fU3%föÇVÖUF‚†76WBçF‚ÂvFVÆ—fW'’rÂ&÷VæBC2FVÆ—fW'’76WBG¶76WBæ–GÖ“°¢76W'B†76WBæf÷&ÖBÓÓÒuärrbb76WBçF‚æVæG5v—F‚‚rçærr’Â&÷VæBC2FVÆ—fW'’f÷&ÖB÷F‚Ö—6ÖF6ƒ¢G¶76WBæ–GÖ“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†76WBçv–GF‚’bbçVÖ&W"æ—56fT–çFVvW"†76WBæ†V–v‡B’bb76WBçv–GF‚ãÒbbb76WBçv–GF‚ÃÒƒ“"bb76WBæ†V–v‡BãÒbbb76WBæ†V–v‡BÃÒƒ“"bbG—Vöb76WBæÇ†&WV—&VBÓÓÒv&ööÆVârbbçVÖ&W"æ—56fT–çFVvW"†76WBæÖ„'—FW2’bb76WBæÖ„'—FW2ãÒ#Sbbb76WBæÖ„'—FW2ÃÒ‚¢#B¢#Bbb76WBçFW‡D&¶VD–âÓÓÒfÇ6Rbb76WBç'VçF–ÖUW6TWF†÷&—¦VBÓÓÒfÇ6RÂ&÷VæBC2FVÆ—fW'’F–ÖVç6–öç2Â'—FR6ÂFW‡B÷"'VçF–ÖRöÆ–7’–çfÆ–C¢G¶76WBæ–GÖ“°¢76W'E6÷'FVEVæ—VU7G&–æw2†76WBç6÷W&6T76WD–G2Â&÷VæBC2FVÆ—fW'’6÷W&6RÆ–æVvRG¶76WBæ–GÖÂÂ3"“°¢76W'B†76WBç6÷W&6T76WD–G2æWfW'’†–BÓâ6÷W&6T'”–Bæ†2†–B’’Â&÷VæBC2FVÆ—fW'’76WB6—FW2âVæ¶æ÷vâ6÷W&6S¢G¶76WBæ–GÖ“°¢76W'DW†7D¶W•6WB†76WBæW‡÷'E&V6—RÂ²vÖWF†öBrÂw66ÆRrÂwG&–ÕG&ç7&VçBrÂvÆ÷76ÆW72rÂvVffV7G56W&FVBuÒÂ&÷VæBC2W‡÷'B&V6—RG¶76WBæ–GÖ“°¢76W'B†76WBæW‡÷'E&V6—RæÖWF†öBÓÓÒtÔåTÅôU…õ%Eôe$ôÕô$õdTEõ4õU$4RrbbçVÖ&W"æ—4f–æ—FR†76WBæW‡÷'E&V6—Rç66ÆR’bb76WBæW‡÷'E&V6—Rç66ÆRãÒã#Rbb76WBæW‡÷'E&V6—Rç66ÆRÃÒBbbG—Vöb76WBæW‡÷'E&V6—RçG&–ÕG&ç7&VçBÓÓÒv&ööÆVârbbG—Vöb76WBæW‡÷'E&V6—RæÆ÷76ÆW72ÓÓÒv&ööÆVârbbG—Vöb76WBæW‡÷'E&V6—RæVffV7G56W&FVBÓÓÒv&ööÆVârÂ&÷VæBC2W‡÷'B&V6—R–çfÆ–C¢G¶76WBæ–GÖ“°¢76W'B„'&’æ—4'&’†76WBæg&ÖW2’bb76WBæg&ÖW2æÆVæwF‚ãÒbb76WBæg&ÖW2æÆVæwF‚ÃÒ#‚bb'&’æ—4'&’†76WBææ6†÷'2’bb76WBææ6†÷'2æÆVæwF‚ÃÒS"Â&÷VæBC2g&ÖRöæ6†÷"–çfVçF÷'’–çfÆ–C¢G¶76WBæ–GÖ“°¢6öç7Bg&ÖT–G2ÒæWr6WB‚“°¢f÷"†6öç7Bg&ÖRöb76WBæg&ÖW2’°¢76W'DW†7D¶W•6WB†g&ÖRÂ²v–BrÂw6÷W&6U&V7BrÂwf—6–&ÆT&÷VæG2rÂvGW&F–öä×2rÂw7FFRrÂvF—&V7F–öâuÒÂ&÷VæBC2g&ÖRG¶76WBæ–GÒòG¶g&ÖRæ–BóòsÆÖ—76–æsâwÖ“°¢76W'B‡G—Vöbg&ÖRæ–BÓÓÒw7G&–ærrbbõå´Õ£Ó•Õ´Õ£Ó•òÕ×³Ãc7ÒBòçFW7B†g&ÖRæ–B’bbg&ÖT–G2æ†2†g&ÖRæ–B’Â&÷VæBC2g&ÖR”B–çfÆ–B÷"GWÆ–6FS¢G¶76WBæ–GÒòG¶g&ÖRæ–GÖ“°¢g&ÖT–G2æFB†g&ÖRæ–B“°¢f÷"†6öç7B·&V7DæÖRÂ&V7EÒöbµ²w6÷W&6U&V7BrÂg&ÖRç6÷W&6U&V7EÒÂ²wf—6–&ÆT&÷VæG2rÂg&ÖRçf—6–&ÆT&÷VæG5ÕÒ’°¢76W'DW†7D¶W•6WB‡&V7BÂ²w‚rÂw’rÂwv–GF‚rÂv†V–v‡BuÒÂ&÷VæBC2G·&V7DæÖWÒG¶76WBæ–GÒòG¶g&ÖRæ–GÖ“°¢76W'B„ö&¦V7BçfÇVW2‡&V7B’æWfW'’„çVÖ&W"æ—56fT–çFVvW"’bb&V7Bç‚ãÒbb&V7Bç’ãÒbb&V7Bçv–GF‚ãÒbb&V7Bæ†V–v‡BãÒbb&V7Bç‚²&V7Bçv–GF‚ÃÒ76WBçv–GF‚bb&V7Bç’²&V7Bæ†V–v‡BÃÒ76WBæ†V–v‡BÂ&÷VæBC2G·&V7DæÖWÒW†6VVG2FVÆ—fW'’76WC¢G¶76WBæ–GÒòG¶g&ÖRæ–GÖ“°¢Ð¢76W'B†g&ÖRçf—6–&ÆT&÷VæG2ç‚ãÒg&ÖRç6÷W&6U&V7Bç‚bbg&ÖRçf—6–&ÆT&÷VæG2ç’ãÒg&ÖRç6÷W&6U&V7Bç’bbg&ÖRçf—6–&ÆT&÷VæG2ç‚²g&ÖRçf—6–&ÆT&÷VæG2çv–GF‚ÃÒg&ÖRç6÷W&6U&V7Bç‚²g&ÖRç6÷W&6U&V7Bçv–GF‚bbg&ÖRçf—6–&ÆT&÷VæG2ç’²g&ÖRçf—6–&ÆT&÷VæG2æ†V–v‡BÃÒg&ÖRç6÷W&6U&V7Bç’²g&ÖRç6÷W&6U&V7Bæ†V–v‡BÂ&÷VæBC2f—6–&ÆR&÷VæG2W66RF†V—"g&ÖR6÷W&6R&V7FævÆS¢G¶76WBæ–GÒòG¶g&ÖRæ–GÖ“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†g&ÖRæGW&F–öä×2’bbg&ÖRæGW&F–öä×2ãÒbbbg&ÖRæGW&F–öä×2ÃÒSbb²t”DÄRrÂutÄ²rÂtED4µôåD”4•D”ôârÂtED4²rÂu$ô¤T5D”ÄRrÂt„•BrÂtDTdTBrÂu$Ut$Eõ$T5D”ôârÂud”5Dõ%’rÂu5DD”2uÒæ–æ6ÇVFW2†g&ÖRç7FFR’bb²te$ôåBrÂu4”DUôÄTeBrÂu4”DUõ$”t…BrÂt$4²rÂtäôäRuÒæ–æ6ÇVFW2†g&ÖRæF—&V7F–öâ’Â&÷VæBC2g&ÖRF–Ö–ær÷7FFRöF—&V7F–öâ–çfÆ–C¢G¶76WBæ–GÒòG¶g&ÖRæ–GÖ“°¢Ð¢f÷"†6öç7Bæ6†÷"öb76WBææ6†÷'2’°¢76W'DW†7D¶W•6WB†æ6†÷"Â²vg&ÖT–BrÂwG—RrÂw‚rÂw’uÒÂ&÷VæBC2æ6†÷"G¶76WBæ–GÖ“°¢6öç7Bg&ÖRÒ76WBæg&ÖW2æf–æB†6æF–FFRÓâ6æF–FFRæ–BÓÓÒæ6†÷"æg&ÖT–B“°¢76W'B†g&ÖRbb²tdôõBrÂu$ô¤T5D”ÄUôõ$”t”ârÂt„•Eô4TåDU"rÂt4ôÄÄ•4”ôåô4TåDU"uÒæ–æ6ÇVFW2†æ6†÷"çG—R’bbçVÖ&W"æ—56fT–çFVvW"†æ6†÷"ç‚’bbçVÖ&W"æ—56fT–çFVvW"†æ6†÷"ç’’bbæ6†÷"ç‚ãÒbbæ6†÷"ç‚ÃÒg&ÖRç6÷W&6U&V7Bçv–GF‚bbæ6†÷"ç’ãÒbbæ6†÷"ç’ÃÒg&ÖRç6÷W&6U&V7Bæ†V–v‡BÂ&÷VæBC2æ6†÷"–çfÆ–B÷"÷WG6–FRg&ÖS¢G¶76WBæ–GÒòG¶æ6†÷"æg&ÖT–GÖ“°¢Ð¢–b‚õâƒó¤4„$5DU'ÄTäTÕ’•òòçFW7B†76WBç&öÆR’’76W'B†76WBæg&ÖW2æWfW'’†g&ÖRÓâ76WBææ6†÷'2ç6öÖR†æ6†÷"Óâæ6†÷"æg&ÖT–BÓÓÒg&ÖRæ–Bbbæ6†÷"çG—RÓÓÒtdôõBr’’Â&÷VæBC26öÖ&BFVÆ—fW'’g&ÖRÆ6·2—G2fö÷Bæ6†÷#¢G¶76WBæ–GÖ“°¢VÇ6R76W'B†76WBææ6†÷'2æÆVæwF‚ÓÓÒÂ&÷VæBC2æöæ6öÖ&BFVÆ—fW'’76WB6'&–W2âÖ&–wV÷W26öÖ&Bæ6†÷#¢G¶76WBæ–GÖ“°¢–b†76WBææ–æU6Æ–6RÓÓÒçVÆÂ’76W'B†76WBç&öÆRÓÒuT•ôä”äUõ4Ä”4RrÂ&÷VæBC2T’æ–æR×6Æ–6RÆ6·266öçG&7C¢G¶76WBæ–GÖ“°¢VÇ6R°¢76W'DW†7D¶W•6WB†76WBææ–æU6Æ–6RÂ²vÆVgBrÂwF÷rÂw&–v‡BrÂv&÷GFöÒrÂvÖ–æ–×VÕv–GF‚rÂvÖ–æ–×VÔ†V–v‡BuÒÂ&÷VæBC2æ–æR×6Æ–6RG¶76WBæ–GÖ“°¢76W'B†76WBç&öÆRÓÓÒuT•ôä”äUõ4Ä”4Rrbbö&¦V7BçfÇVW2†76WBææ–æU6Æ–6R’æWfW'’„çVÖ&W"æ—56fT–çFVvW"’bb76WBææ–æU6Æ–6RæÆVgBâbb76WBææ–æU6Æ–6RçF÷âbb76WBææ–æU6Æ–6Rç&–v‡Bâbb76WBææ–æU6Æ–6Ræ&÷GFöÒâbb76WBææ–æU6Æ–6RæÆVgB²76WBææ–æU6Æ–6Rç&–v‡BÂ76WBçv–GF‚bb76WBææ–æU6Æ–6RçF÷²76WBææ–æU6Æ–6Ræ&÷GFöÒÂ76WBæ†V–v‡Bbb76WBææ–æU6Æ–6RæÖ–æ–×VÕv–GF‚ãÒ76WBææ–æU6Æ–6RæÆVgB²76WBææ–æU6Æ–6Rç&–v‡Bbb76WBææ–æU6Æ–6RæÖ–æ–×VÔ†V–v‡BãÒ76WBææ–æU6Æ–6RçF÷²76WBææ–æU6Æ–6Ræ&÷GFöÒÂ&÷VæBC2æ–æR×6Æ–6R–çfÆ–C¢G¶76WBæ–GÖ“°¢Ð¢76W'E6÷'FVEVæ—VU7G&–æw2†76WBæFF6öç7VÖW'2Â&÷VæBC2FF6öç7VÖW'2G¶76WBæ–GÖÂÂ‚“°¢76W'B†76WBæFF6öç7VÖW'2æWfW'’†6öç7VÖW"Óâ6öç7VÖW%fö6'VÆ'’æ†2†6öç7VÖW"’’Â&÷VæBC2FVÆ—fW'’76WB†2âVç&Wf–WvVBFF6öç7VÖW#¢G¶76WBæ–GÖ“°¢FVÆ—fW'”–G2çW6‚†76WBæ–B“²FVÆ—fW'•F‡2çW6‚†76WBçF‚“²FVÆ—fW'”'”–Bç6WB†76WBæ–BÂ76WB“²FVÆ—fW'”'VFvWB³Ò76WBæÖ„'—FW3°¢Ð¢76W'E6÷'FVEVæ—VU7G&–æw2†FVÆ—fW'”–G2Âw&÷VæBC2FVÆ—fW'’76WB”G2rÂRÂ#Sb“°¢76W'E6÷'FVEVæ—VU7G&–æw2†FVÆ—fW'•F‡2Âw&÷VæBC2FVÆ—fW'’76WBF‡2rÂRÂ#Sb“°¢76W'B†æWr6WB…²ââç6÷W&6T–G2ÂââæFVÆ—fW'”–G5Ò’ç6—¦RÓÓÒ6÷W&6T–G2æÆVæwF‚²FVÆ—fW'”–G2æÆVæwF‚Âw&÷VæBC26÷W&6RöFVÆ—fW'’76WB”G26öÆÆ–FR7&÷72–çfVçF÷'’&V2r“°¢6öç7BÆÄ66TföÆFVEF‡2Ò²ââç6÷W&6UF‡2ÂââæFVÆ—fW'•F‡5ÒæÖ†f–ÆRÓâf–ÆRçFôÆ÷vW$66R‚’“°¢76W'B†æWr6WB†ÆÄ66TföÆFVEF‡2’ç6—¦RÓÓÒÆÄ66TföÆFVEF‡2æÆVæwF‚Âw&÷VæBC26÷W&6RöFVÆ—fW'’F‡26öÆÆ–FRVæFW"66RföÆF–ærr“°¢f÷"†6öç7B6÷W&6Röb6öçG&7Bç6÷W&6T76WG2’76W'B‡6÷W&6Rç&WV—&VDf÷$FVÆ—fW'”–G2æWfW'’†–BÓâFVÆ—fW'”'”–Bæ†2†–B’bbFVÆ—fW'”'”–BævWB†–B’ç6÷W&6T76WD–G2æ–æ6ÇVFW2‡6÷W&6Ræ–B’’Â&÷VæBC26÷W&6R×FòÖFVÆ—fW'’Æ–æVvR—2æ÷B&–F—&V7F–öæÃ¢G·6÷W&6Ræ–GÖ“°¢f÷"†6öç7BFVÆ—fW'’öb6öçG&7BæFVÆ—fW'”76WG2’76W'B†FVÆ—fW'’ç6÷W&6T76WD–G2æWfW'’†–BÓâ6÷W&6T'”–BævWB†–B’ç&WV—&VDf÷$FVÆ—fW'”–G2æ–æ6ÇVFW2†FVÆ—fW'’æ–B’’Â&÷VæBC2FVÆ—fW'’×Fò×6÷W&6RÆ–æVvR—2æ÷B&–F—&V7F–öæÃ¢G¶FVÆ—fW'’æ–GÖ“°¢6öç7B6÷W&6T6E7V&¦V7G2ÒæWr6WB†6öçG&7Bç6÷W&6T76WG2æf–ÇFW"†76WBÓâ76WBç&öÆRÓÓÒt4„$5DU%ôÔôDTÅõ4„TUBrbb76WBç7V&¦V7D–Bç7F'G5v—F‚‚t4BÒr’’æÖ†76WBÓâ76WBç7V&¦V7D–B’“°¢6öç7BFVÆ—fW'”6E7V&¦V7G2ÒæWr6WB†6öçG&7BæFVÆ—fW'”76WG2æf–ÇFW"†76WBÓâ²t4„$5DU%ôÔôDTÅõ4„TUBrÂt4„$5DU%ôä”ÔD”ôâuÒæ–æ6ÇVFW2†76WBç&öÆR’bb76WBç7V&¦V7D–Bç7F'G5v—F‚‚t4BÒr’’æÖ†76WBÓâ76WBç7V&¦V7D–B’“°¢76W'B‡6÷W&6T6E7V&¦V7G2ç6—¦RÓÓÒBbbFVÆ—fW'”6E7V&¦V7G2ç6—¦RÓÓÒBbb²ââç6÷W&6T6E7V&¦V7G5ÒæWfW'’†–BÓâFVÆ—fW'”6E7V&¦V7G2æ†2†–B’’Âw&÷VæBC26öçG&7B×W7B&W6W'fRW†7FÇ’f÷W"æÖVB6B7V&¦V7G2g&öÒ6÷W&6RF‡&÷Vv‚FVÆ—fW'’r“°¢6öç7BgVÆÄ6†&7FW$ÖöFVÄ6ö×öæVçG2Ò²t$4²rÂt$ôE•õ$õõ%D”ôârÂt4ôÄÄ•4”ôåô$õTäE2rÂtUT•ÔTåBrÂtd4RrÂtdôõEôä4„õ"rÂte$ôåBrÂu4”DRrÂud•4”$ÄUô$õTäE2uÓ°¢f÷"†6öç7B6E7V&¦V7Böb6÷W&6T6E7V&¦V7G2’°¢6öç7B6†VWBÒ6öçG&7Bç6÷W&6T76WG2æf–æB†76WBÓâ76WBç&öÆRÓÓÒt4„$5DU%ôÔôDTÅõ4„TUBrbb76WBç7V&¦V7D–BÓÓÒ6E7V&¦V7B“°¢76W'B„¥4ôâç7G&–æv–g’‡6†VWBæ6ö×öæVçG2’ÓÓÒ¥4ôâç7G&–æv–g’†gVÆÄ6†&7FW$ÖöFVÄ6ö×öæVçG2’bb6öçG&7Bç6÷W&6T76WG2ç6öÖR†76WBÓâ76WBç&öÆRÓÓÒt4„$5DU%ôÄ”U%õÄDRrbb76WBç7V&¦V7D–BÓÓÒ6E7V&¦V7B’Â&÷VæBC26öçG&7BÆ6·2gVÆÂÖöFVÂ×6†VWB6ö×öæVçG2÷"6W&&ÆR6÷W&6RÆ–W"ÆFRf÷"G¶6E7V&¦V7GÖ“°¢Ð¢6öç7B&WV—&VD6E7FFW2Ò²tED4²rÂtED4µôåD”4•D”ôârÂtDTdTBrÂt„•BrÂt”DÄRrÂu$Ut$Eõ$T5D”ôârÂutÄ²uÓ°¢f÷"†6öç7B6E7V&¦V7BöbFVÆ—fW'”6E7V&¦V7G2’°¢6öç7Bg&ÖW2Ò6öçG&7BæFVÆ—fW'”76WG2æf–ÇFW"†76WBÓâ76WBç7V&¦V7D–BÓÓÒ6E7V&¦V7Bbb²t4„$5DU%ôÔôDTÅõ4„TUBrÂt4„$5DU%ôä”ÔD”ôâuÒæ–æ6ÇVFW2†76WBç&öÆR’’æfÆDÖ†76WBÓâ76WBæg&ÖW2“°¢6öç7B7FFW2Ò²ââææWr6WB†g&ÖW2æÖ†g&ÖRÓâg&ÖRç7FFR’•Òç6÷'B‚“°¢76W'B‡&WV—&VD6E7FFW2æWfW'’‡7FFRÓâ7FFW2æ–æ6ÇVFW2‡7FFR’’bbg&ÖW2ç6öÖR†g&ÖRÓâ²u4”DUôÄTeBrÂu4”DUõ$”t…BuÒæ–æ6ÇVFW2†g&ÖRæF—&V7F–öâ’’Â&÷VæBC26öçG&7BÆ6·26ö×ÆWFRWFòÖ&GFÆR÷&Wv&Bæ–ÖF–öâ7FFRæB6–FR×f–Wr6÷fW&vRf÷"G¶6E7V&¦V7GÖ“°¢Ð¢6öç7BVæV×•6†VWG2Ò6öçG&7Bç6÷W&6T76WG2æf–ÇFW"†76WBÓâ76WBç&öÆRÓÓÒtTäTÕ•ôÔôDTÅõ4„TUBrbb76WBç7V&¦V7D–Bç7F'G5v—F‚‚tTäTÕ’Òr’“°¢76W'B†VæV×•6†VWG2æÆVæwF‚ãÒbbVæV×•6†VWG2æWfW'’‡6†VWBÓâ²t$4²rÂt$ôE•õ$õõ%D”ôârÂt4ôÄÄ•4”ôåô$õTäE2rÂtdôõEôä4„õ"rÂte$ôåBrÂu4”DRrÂud•4”$ÄUô$õTäE2uÒæWfW'’†6ö×öæVçBÓâ6†VWBæ6ö×öæVçG2æ–æ6ÇVFW2†6ö×öæVçB’’bb6öçG&7Bç6÷W&6T76WG2ç6öÖR†76WBÓâ76WBç&öÆRÓÓÒtTäTÕ•ôÄ”U%õÄDRrbb76WBç7V&¦V7D–BÓÓÒ6†VWBç7V&¦V7D–B’’bb6öçG&7BæFVÆ—fW'”76WG2ç6öÖR†76WBÓâ²tTäTÕ•ôÔôDTÅõ4„TUBrÂtTäTÕ•ôä”ÔD”ôâuÒæ–æ6ÇVFW2†76WBç&öÆR’bb76WBç7V&¦V7D–Bç7F'G5v—F‚‚tTäTÕ’Òr’’Âw&÷VæBC26öçG&7BÆ6·26ö×ÆWFR6W&&ÆRVæV×’6÷W&6RöFVÆ—fW'’ÖöFVÂ6÷fW&vRr“°¢f÷"†6öç7BVæV×•7V&¦V7BöbæWr6WB†VæV×•6†VWG2æÖ†76WBÓâ76WBç7V&¦V7D–B’’’°¢6öç7Bg&ÖW2Ò6öçG&7BæFVÆ—fW'”76WG2æf–ÇFW"†76WBÓâ76WBç7V&¦V7D–BÓÓÒVæV×•7V&¦V7Bbb²tTäTÕ•ôÔôDTÅõ4„TUBrÂtTäTÕ•ôä”ÔD”ôâuÒæ–æ6ÇVFW2†76WBç&öÆR’’æfÆDÖ†76WBÓâ76WBæg&ÖW2“°¢6öç7B7FFW2ÒæWr6WB†g&ÖW2æÖ†g&ÖRÓâg&ÖRç7FFR’“°¢76W'B…²tED4²rÂtDTdTBrÂt„•BrÂt”DÄRrÂutÄ²uÒæWfW'’‡7FFRÓâ7FFW2æ†2‡7FFR’’bbg&ÖW2ç6öÖR†g&ÖRÓâ²u4”DUôÄTeBrÂu4”DUõ$”t…BuÒæ–æ6ÇVFW2†g&ÖRæF—&V7F–öâ’’Â&÷VæBC26öçG&7BÆ6·26ö×ÆWFRVæV×’&GFÆR×7FFRæB6–FR×f–Wr6÷fW&vRf÷"G¶VæV×•7V&¦V7GÖ“°¢Ð¢76W'B„'&’æ—4'&’†6öçG&7Bç&öGV7F–öä&F6†W2’bb6öçG&7Bç&öGV7F–öä&F6†W2æÆVæwF‚ãÒ"bb6öçG&7Bç&öGV7F–öä&F6†W2æÆVæwF‚ÃÒbÂw&÷VæBC26öçG&7BæVVG2&÷VæFVB×VÇF’Ö&F6‚&öGV7F–öâÆâr“°¢6öç7B&F6†VE6÷W&6RÒµÓ²6öç7B&F6†VDFVÆ—fW'’ÒµÓ²6öç7BWf–FVæ6UF‡2ÒµÓ²6öç7B6÷W&6T&F6„–æFW‚ÒæWrÖ‚“²6öç7BFVÆ—fW'”&F6„–æFW‚ÒæWrÖ‚“°¢f÷"†ÆWB–æFW‚Ò²–æFW‚Â6öçG&7Bç&öGV7F–öä&F6†W2æÆVæwFƒ²–æFW‚³Ò’°¢6öç7B&F6‚Ò6öçG&7Bç&öGV7F–öä&F6†W5¶–æFW…Ó²6öç7B&F6„–BÒ&F6‚ÒGµ7G&–ær†–æFW‚²’çE7F'Bƒ2Âsr—Ö°¢76W'DW†7D¶W•6WB†&F6‚Â²v–BrÂw6÷W&6T76WD–G2rÂvFVÆ—fW'”76WD–G2rÂvWf–FVæ6UF‡2rÂvÖ„'—FW2uÒÂ&÷VæBC2&öGV7F–öâ&F6‚G¶&F6„–GÖ“°¢76W'B†&F6‚æ–BÓÓÒ&F6„–BÂ&÷VæBC2&öGV7F–öâ&F6‚÷&FW"ö–FVçF—G’Ö—6ÖF6ƒ¢G¶&F6‚æ–GÖ“°¢76W'E6÷'FVEVæ—VU7G&–æw2†&F6‚ç6÷W&6T76WD–G2Â&÷VæBC2&F6‚6÷W&6R”G2G¶&F6„–GÖÂÂ#‚“°¢76W'E6÷'FVEVæ—VU7G&–æw2†&F6‚æFVÆ—fW'”76WD–G2Â&÷VæBC2&F6‚FVÆ—fW'’”G2G¶&F6„–GÖÂÂ#Sb“°¢76W'B†&F6‚ç6÷W&6T76WD–G2æÆVæwF‚²&F6‚æFVÆ—fW'”76WD–G2æÆVæwF‚ãÒbb&F6‚ç6÷W&6T76WD–G2æWfW'’†–BÓâ6÷W&6T'”–Bæ†2†–B’’bb&F6‚æFVÆ—fW'”76WD–G2æWfW'’†–BÓâFVÆ—fW'”'”–Bæ†2†–B’’Â&÷VæBC2&F6‚6—FW2âVæ¶æ÷vâ÷"V×G’76WB6WC¢G¶&F6„–GÖ“°¢6öç7BW‡V7FVDWf–FVæ6UF‡2ÒW‡V7FVD76WEföÇVÖT&F6„Wf–FVæ6UF‡2†&F6„–B“°¢76W'B„¥4ôâç7G&–æv–g’†&F6‚æWf–FVæ6UF‡2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDWf–FVæ6UF‡2’Â&÷VæBC2&F6‚Wf–FVæ6RF‡2F–ffW"g&öÒF†RW†7B6÷W&6R×&÷fVææ6RÇW26—‚×7FvR&Wf–Wr6öçG&7C¢G¶&F6„–GÖ“°¢6öç7BW‡V7FVDÖ„'—FW2Ò²ââæ&F6‚ç6÷W&6T76WD–G2æÖ†–BÓâ6÷W&6T'”–BævWB†–B’æÖ„'—FW2’Âââæ&F6‚æFVÆ—fW'”76WD–G2æÖ†–BÓâFVÆ—fW'”'”–BævWB†–B’æÖ„'—FW2•Òç&VGV6R‚‡7VÒÂfÇVR’Óâ7VÒ²fÇVRÂ“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†&F6‚æÖ„'—FW2’bb&F6‚æÖ„'—FW2ÓÓÒW‡V7FVDÖ„'—FW2bb&F6‚æÖ„'—FW2ÃÒcB¢#B¢#BÂ&÷VæBC2&F6‚'—FR'VFvWBÖ—6ÖF6‚÷"÷fW&fÆ÷s¢G¶&F6„–GÖ“°¢f÷"†6öç7B–Böb&F6‚ç6÷W&6T76WD–G2’6÷W&6T&F6„–æFW‚ç6WB†–BÂ–æFW‚“°¢f÷"†6öç7B–Böb&F6‚æFVÆ—fW'”76WD–G2’FVÆ—fW'”&F6„–æFW‚ç6WB†–BÂ–æFW‚“°¢&F6†VE6÷W&6RçW6‚‚ââæ&F6‚ç6÷W&6T76WD–G2“²&F6†VDFVÆ—fW'’çW6‚‚ââæ&F6‚æFVÆ—fW'”76WD–G2“²Wf–FVæ6UF‡2çW6‚‚ââæ&F6‚æWf–FVæ6UF‡2“°¢Ð¢76W'B„¥4ôâç7G&–æv–g’†&F6†VE6÷W&6Rç6÷'B‚’’ÓÓÒ¥4ôâç7G&–æv–g’‡6÷W&6T–G2’bb¥4ôâç7G&–æv–g’†&F6†VDFVÆ—fW'’ç6÷'B‚’’ÓÓÒ¥4ôâç7G&–æv–g’†FVÆ—fW'”–G2’Âw&÷VæBC2&F6†W2Fòæ÷B'F—F–öâWfW'’6÷W&6RöFVÆ—fW'’76WBW†7FÇ’öæ6Rr“°¢76W'B†æWr6WB†Wf–FVæ6UF‡2’ç6—¦RÓÓÒWf–FVæ6UF‡2æÆVæwF‚Âw&÷VæBC2&F6‚Wf–FVæ6RF‡2&Ræ÷BvÆö&ÆÇ’Væ—VRr“°¢f÷"†6öç7BFVÆ—fW'’öb6öçG&7BæFVÆ—fW'”76WG2’76W'B†FVÆ—fW'’ç6÷W&6T76WD–G2æWfW'’†–BÓâ6÷W&6T&F6„–æFW‚ævWB†–B’ÃÒFVÆ—fW'”&F6„–æFW‚ævWB†FVÆ—fW'’æ–B’’Â&÷VæBC2FVÆ—fW'’&V6VFW2öæRöb—G2&WV—&VB6÷W&6R76WG3¢G¶FVÆ—fW'’æ–GÖ“°¢76W'B„¥4ôâç7G&–æv–g’†6öçG&7Bæ'VFvWG2’ÓÓÒ¥4ôâç7G&–æv–g’‡²6÷W&6T'—FW3¢6÷W&6T'VFvWBÂFVÆ—fW'”'—FW3¢FVÆ—fW'”'VFvWBÂF÷FÄ'—FW3¢6÷W&6T'VFvWB²FVÆ—fW'”'VFvWBÂÖ†–×VÕ&W÷6—F÷'”'—FW3¢S"¢#B¢#BÒ’bb6÷W&6T'VFvWB²FVÆ—fW'”'VFvWBÃÒS"¢#B¢#BÂw&÷VæBC2vw&VvFR6÷W&6RöFVÆ—fW'’'VFvWBÖ—6ÖF6‚÷"÷fW&fÆ÷rr“°¢6öç7BFW&—fVDÆÆ÷vVEw&—FW2Ò²ââç6÷W&6UF‡2ÂââæFVÆ—fW'•F‡2ÂââæWf–FVæ6UF‡5Ó°¢76W'B†æWr6WB†FW&—fVDÆÆ÷vVEw&—FW2’ç6—¦RÓÓÒFW&—fVDÆÆ÷vVEw&—FW2æÆVæwF‚Âw&÷VæBC26öçG&7BÖFW&—fVB&÷VæBCBÆÆ÷vÆ—7B6öçF–ç2GWÆ–6FRF‡2r“°¢&WGW&â²6öçG&7D6öÖÖ—BÂ6öçG&7EG&VS¢v—B…²w&Wb×'6RrÂG¶6öçG&7D6öÖÖ—GÕç·G&VWÖÒ’Â6öçG&7E6†#Sc¢6†#Sdf–ÆTB‚t„TBrÂ3$76WEföÇVÖT6öçG&7EF‚’Â6÷W&6UF‡2ÂFVÆ—fW'•F‡2ÂWf–FVæ6UF‡2ÂFW&—fVDÆÆ÷vVEw&—FW2Â6÷W&6T'”–BÂFVÆ—fW'”'”–BÓ°§Ð ¦gVæ7F–öâæÇ—¦U3%föÇVÖU&Vv–öâ†FV6öFVBÂ&V7BÂÆ&VÂ’°¢76W'B‡&V7Bbbö&¦V7BçfÇVW2‡&V7B’æWfW'’„çVÖ&W"æ—56fT–çFVvW"’bb&V7Bç‚ãÒbb&V7Bç’ãÒbb&V7Bçv–GF‚ãÒbb&V7Bæ†V–v‡BãÒbb&V7Bç‚²&V7Bçv–GF‚ÃÒFV6öFVBçv–GF‚bb&V7Bç’²&V7Bæ†V–v‡BÃÒFV6öFVBæ†V–v‡BÂG¶Æ&VÇÓ¢æÇ—6—2&V7FævÆRW66W2FV6öFVBäv“°¢6öç7B†6‚Ò7&VFT†6‚‚w6†#Sbr“²6öç7BÆWGFRÒæWr6WB‚“°¢ÆWBf—6–&ÆU—†VÇ2Ò²ÆWB6÷&U—†VÇ2Ò²ÆWBÇVÖÒ²ÆWBÇVÖ7V&VBÒ²ÆWB&VBÒ²ÆWBw&VVâÒ²ÆWB&ÇVRÒ°¢ÆWBÖ–å‚Ò&V7Bç‚²&V7Bçv–GFƒ²ÆWBÖ–å’Ò&V7Bç’²&V7Bæ†V–v‡C²ÆWBÖ…‚ÒÓ²ÆWBÖ…’ÒÓ°¢f÷"†ÆWB’Ò&V7Bç“²’Â&V7Bç’²&V7Bæ†V–v‡C²’³Ò’f÷"†ÆWB‚Ò&V7Bçƒ²‚Â&V7Bç‚²&V7Bçv–GFƒ²‚³Ò’°¢6öç7Böfg6WBÒ‡’¢FV6öFVBçv–GF‚²‚’¢C²6öç7B—†VÂÒFV6öFVBç&v&ç7V&'&’†öfg6WBÂöfg6WB²B“²†6‚çWFFR‡—†VÂ“°¢–b‡—†VÅ³5ÒÂ3%&W&W6VçFF—fUf—6–&ÆTÇ†F‡&W6†öÆB’6öçF–çVS°¢f—6–&ÆU—†VÇ2³Ò²–b‡—†VÅ³5ÒãÒ“"’6÷&U—†VÇ2³Ò°¢Ö–å‚ÒÖF‚æÖ–â†Ö–å‚Â‚“²Ö–å’ÒÖF‚æÖ–â†Ö–å’Â’“²Ö…‚ÒÖF‚æÖ‚†Ö…‚Â‚“²Ö…’ÒÖF‚æÖ‚†Ö…’Â’“°¢6öç7B&V×VÇF—Æ–VBÒ³ÂÂ%ÒæÖ†6†ææVÂÓâÖF‚ç&÷VæB‡—†VÅ¶6†ææVÅÒ¢—†VÅ³5Òò#SR’“°¢&VB³Ò&V×VÇF—Æ–VE³Ó²w&VVâ³Ò&V×VÇF—Æ–VE³Ó²&ÇVR³Ò&V×VÇF—Æ–VE³%Ó°¢ÆWGFRæFB†G·&V×VÇF—Æ–VE³ÒãâGÓ¢G·&V×VÇF—Æ–VE³ÒãâGÓ¢G·&V×VÇF—Æ–VE³%ÒãâGÖ“°¢6öç7B—†VÄÇVÖÒƒSB¢&V×VÇF—Æ–VE³Ò²ƒ2¢&V×VÇF—Æ–VE³Ò²’¢&V×VÇF—Æ–VE³%Ò’ò#Sc°¢ÇVÖ³Ò—†VÄÇVÖ²ÇVÖ7V&VB³Ò—†VÄÇVÖ¢—†VÄÇVÖ°¢Ð¢76W'B‡f—6–&ÆU—†VÇ2âÂG¶Æ&VÇÓ¢æòf—6–&ÆRFV6öFVB—†VÇ6“°¢6öç7BÖVäÇVÖÒÇVÖòf—6–&ÆU—†VÇ3°¢&WGW&â°¢V&Æ–3¢°¢6†#Sc¢6†#Sc¢G¶†6‚æF–vW7B‚v†W‚r—ÖÀ¢f—6–&ÆT&÷VæG3¢²ƒ¢Ö–å‚Â“¢Ö–å’Âv–GFƒ¢Ö…‚ÒÖ–å‚²Â†V–v‡C¢Ö…’ÒÖ–å’²ÒÀ¢æöåG&ç7&VçE&F–ó¢f—6–&ÆU—†VÇ2ò‡&V7Bçv–GF‚¢&V7Bæ†V–v‡B’À¢6÷&TÇ†g&7F–öäöef—6–&ÆS¢6÷&U—†VÇ2òf—6–&ÆU—†VÇ2À¢f—6–&ÆUVçF—¦VD6öÆ÷$6÷VçC¢ÆWGFRç6—¦RÀ¢ÇVÖ7FDFWc¢ÖF‚ç7'B„ÖF‚æÖ‚ƒÂÇVÖ7V&VBòf—6–&ÆU—†VÇ2ÒÖVäÇVÖ¢¢"’’À¢ÖVå&v#¢·&VBòf—6–&ÆU—†VÇ2Âw&VVâòf—6–&ÆU—†VÇ2Â&ÇVRòf—6–&ÆU—†VÇ5Ð¢ÒÀ¢ÆWGFP¢Ó°§Ð¦gVæ7F–öâ6ö×&U3%föÇVÖTg&ÖU&V7G2†FV6öFVBÂÆVgBÂ&–v‡BÂÆ&VÂ’°¢76W'B†ÆVgBçv–GF‚ÓÓÒ&–v‡Bçv–GF‚bbÆVgBæ†V–v‡BÓÓÒ&–v‡Bæ†V–v‡BÂG¶Æ&VÇÓ¢æ–ÖF–öâg&ÖW2×W7B6†&RW†7BF–ÖVç6–öç2f÷"FV6öFVB6öçF–çV—G’ÖV7W&VÖVçF“°¢6öç7B—†VÄ6÷VçBÒÆVgBçv–GF‚¢ÆVgBæ†V–v‡C²ÆWB6†ævVE—†VÇ2Ò²ÆWBF÷FÄ'6öÇWFT6†ææVÄFVÇFÒ°¢f÷"†ÆWB’Ò²’ÂÆVgBæ†V–v‡C²’³Ò’f÷"†ÆWB‚Ò²‚ÂÆVgBçv–GFƒ²‚³Ò’°¢6öç7BÆVgDöfg6WBÒ‚†ÆVgBç’²’’¢FV6öFVBçv–GF‚²ÆVgBç‚²‚’¢C°¢6öç7B&–v‡Döfg6WBÒ‚‡&–v‡Bç’²’’¢FV6öFVBçv–GF‚²&–v‡Bç‚²‚’¢C°¢ÆWBÖ†–×VÔFVÇFÒ°¢f÷"†ÆWB6†ææVÂÒ²6†ææVÂÂC²6†ææVÂ³Ò’°¢6öç7BFVÇFÒÖF‚æ'2†FV6öFVBç&v&¶ÆVgDöfg6WB²6†ææVÅÒÒFV6öFVBç&v&·&–v‡Döfg6WB²6†ææVÅÒ“°¢Ö†–×VÔFVÇFÒÖF‚æÖ‚†Ö†–×VÔFVÇFÂFVÇF“²F÷FÄ'6öÇWFT6†ææVÄFVÇF³ÒFVÇF°¢Ð¢–b†Ö†–×VÔFVÇFãÒ"’6†ævVE—†VÇ2³Ò°¢Ð¢&WGW&â²6†ævVE—†VÅ&F–ó¢6†ævVE—†VÇ2ò—†VÄ6÷VçBÂÖVä'6öÇWFT6†ææVÄFVÇF¢F÷FÄ'6öÇWFT6†ææVÄFVÇFò‡—†VÄ6÷VçB¢B’Ó°§Ð¦gVæ7F–öâf—7VÅÆWGFTÆ–æVvR†ÆVgDæÇ—6W2Â&–v‡DæÇ—6—2’°¢6öç7BÆVgEÆWGFRÒæWr6WB†ÆVgDæÇ—6W2æfÆDÖ†VçG'’Óâ²ââæVçG'’å÷ÆWGFUÒ’“°¢6öç7B&–v‡EÆWGFRÒ&–v‡DæÇ—6—2å÷ÆWGFS°¢6öç7B÷fW&ÆÒ²ââç&–v‡EÆWGFUÒæf–ÇFW"†6öÆ÷W"ÓâÆVgEÆWGFRæ†2†6öÆ÷W"’’æÆVæwFƒ°¢6öç7B6÷W&6TÖVâÒ³ÂÂ%ÒæÖ†6†ææVÂÓâÆVgDæÇ—6W2ç&VGV6R‚‡7VÒÂVçG'’’Óâ7VÒ²VçG'’åöÖVå&v%¶6†ææVÅÒÂ’òÆVgDæÇ—6W2æÆVæwF‚“°¢&WGW&â°¢ÆWGFT÷fW&Æ&F–ó¢÷fW&ÆòÖF‚æÖ‚ƒÂÖF‚æÖ–â†ÆVgEÆWGFRç6—¦RÂ&–v‡EÆWGFRç6—¦R’’À¢ÖVå&v$F—7Fæ6S¢ÖF‚æ‡—÷B‚ââç6÷W&6TÖVâæÖ‚‡fÇVRÂ6†ææVÂ’ÓâfÇVRÒ&–v‡DæÇ—6—2åöÖVå&v%¶6†ææVÅÒ’¢Ó°§Ð¦gVæ7F–öâæÇ—¦U3%föÇVÖT76WB†76WBÂ&VÂÆ&VÂ’°¢76W'E&VwVÆ$v—Df–ÆR†76WBçF‚ÂÆ&VÂ“°¢6öç7B'—FW2Ò'—FW4B‚t„TBrÂ76WBçF‚“°¢76W'B†'—FW2æÆVæwF‚âbb'—FW2æÆVæwF‚ÃÒ76WBæÖ„'—FW2ÂG¶Æ&VÇÓ¢7GVÂ'—FW2W†6VVBF†RW†7B6öçG&7B6“°¢6öç7BFV6öFVBÒ76W'DFV6öFVEær†'—FW2Â76WBçv–GF‚Â76WBæ†V–v‡BÂÆ&VÂ“°¢ÆWBf—6–&ÆU—†VÇ2Ò²ÆWB÷VU—†VÇ2Ò²ÆWBG&ç7&VçE—†VÇ2Ò°¢f÷"†ÆWBöfg6WBÒ3²öfg6WBÂFV6öFVBç&v&æÆVæwFƒ²öfg6WB³ÒB’°¢6öç7BÇ†ÒFV6öFVBç&v&¶öfg6WEÓ°¢–b†Ç†ãÒ3%&W&W6VçFF—fUf—6–&ÆTÇ†F‡&W6†öÆB’f—6–&ÆU—†VÇ2³Ò°¢–b†Ç†ãÒ#S’÷VU—†VÇ2³Ò°¢–b†Ç†Â3%&W&W6VçFF—fUf—6–&ÆTÇ†F‡&W6†öÆB’G&ç7&VçE—†VÇ2³Ò°¢Ð¢76W'B‡f—6–&ÆU—†VÇ2ãÒÖF‚æÖ‚ƒcBÂÖF‚æfÆö÷"†76WBçv–GF‚¢76WBæ†V–v‡B¢ã"’’bb‚76WBæÇ†&WV—&VBÇÂ…³BÂeÒæ–æ6ÇVFW2†FV6öFVBæ6öÆ÷%G—R’bbG&ç7&VçE—†VÇ2ãÒ’’ÂG¶Æ&VÇÓ¢f—6–&ÆR6–væÂ÷"&WV—&VBÇ†—2Ö—76–æv“°¢6öç7Bv†öÆRÒæÇ—¦U3%föÇVÖU&Vv–öâ†FV6öFVBÂ²ƒ¢Â“¢Âv–GFƒ¢76WBçv–GF‚Â†V–v‡C¢76WBæ†V–v‡BÒÂG¶Æ&VÇÒv†öÆR76WF“°¢76W'B‡v†öÆRçV&Æ–2æ6÷&TÇ†g&7F–öäöef—6–&ÆRãÒã3Rbbv†öÆRçV&Æ–2çf—6–&ÆUVçF—¦VD6öÆ÷$6÷VçBãÒbbbv†öÆRçV&Æ–2æÇVÖ7FDFWbãÒRbbv†öÆRçV&Æ–2çf—6–&ÆT&÷VæG2çv–GF‚ãÒÖF‚æÖ‚ƒ‚ÂÖF‚æfÆö÷"†76WBçv–GF‚¢ã‚’’bbv†öÆRçV&Æ–2çf—6–&ÆT&÷VæG2æ†V–v‡BãÒÖF‚æÖ‚ƒ‚ÂÖF‚æfÆö÷"†76WBæ†V–v‡B¢ã‚’’ÂG¶Æ&VÇÓ¢FV6öFVB76WB—27'6RÂG&ç6ÇV6VçBÖöæÇ’ÂfÆBÂÆ÷rÖFWF–Â÷"Æ6V†öÆFW"ÖÆ–¶V“°¢6öç7Bg&ÖUf—7VÇ2Ò&VÓÓÒvFVÆ—fW'’rò76WBæg&ÖW2æÖ†g&ÖRÓâæÇ—¦U3%föÇVÖU&Vv–öâ†FV6öFVBÂg&ÖRç6÷W&6U&V7BÂG¶Æ&VÇÒg&ÖRG¶g&ÖRæ–GÖ’’¢µÓ°¢6öç7Bg&ÖW2Òg&ÖUf—7VÇ2æÖ‚‡f—7VÂÂ–æFW‚’Óâ°¢6öç7Bg&ÖRÒ76WBæg&ÖW5¶–æFW…Ó²6öç7BÖWG&–72Òf—7VÂçV&Æ–3°¢76W'B„¥4ôâç7G&–æv–g’†ÖWG&–72çf—6–&ÆT&÷VæG2’ÓÓÒ¥4ôâç7G&–æv–g’†g&ÖRçf—6–&ÆT&÷VæG2’ÂG¶Æ&VÇÓ¢FV6öFVBf—6–&ÆR&÷VæG2F–ffW"g&öÒF†R–Ö×WF&ÆRg&ÖR6öçG&7C¢G¶g&ÖRæ–GÖ“°¢6öç7B6öÖ&BÒõâƒó¤4„$5DU'ÄTäTÕ’•òòçFW7B†76WBç&öÆR“°¢76W'B†ÖWG&–72çf—6–&ÆUVçF—¦VD6öÆ÷$6÷VçBãÒ†6öÖ&Bò"¢‚’bbÖWG&–72æÇVÖ7FDFWbãÒ†6öÖ&BòB¢"’bbÖWG&–72æ6÷&TÇ†g&7F–öäöef—6–&ÆRãÒ†6öÖ&BòãCR¢ã2’bb‚6öÖ&BÇÂ†ÖWG&–72ææöåG&ç7&VçE&F–òãÒã"bbÖWG&–72ææöåG&ç7&VçE&F–òÃÒã“RbbÖWG&–72çf—6–&ÆT&÷VæG2æ†V–v‡BãÒg&ÖRç6÷W&6U&V7Bæ†V–v‡B¢ã2’’ÂG¶Æ&VÇÓ¢g&ÖRG¶g&ÖRæ–GÒ—27'6RÂfÆBÂG&ç6ÇV6VçBÖöæÇ’÷"Æ6·2&VF&ÆR6öÖ&B6–Æ†÷VWGFV“°¢&WGW&â²–C¢g&ÖRæ–BÂââæÖWG&–72Ó°¢Ò“°¢6öç7Bæ–ÖF–öäFVÇF2ÒµÓ°¢–b†&VÓÓÒvFVÆ—fW'’rbbõôä”ÔD”ôâBòçFW7B†76WBç&öÆR’’°¢76W'B†g&ÖW2æÆVæwF‚ãÒ2bbæWr6WB†g&ÖW2æÖ†g&ÖRÓâg&ÖRç6†#Sb’’ç6—¦RÓÓÒg&ÖW2æÆVæwF‚ÂG¶Æ&VÇÓ¢&öGV7F–öâæ–ÖF–öâ&WV—&W2BÆV7BF‡&VRVæ—VRFV6öFVBg&ÖW6“°¢f÷"†ÆWB–æFW‚Ò²–æFW‚Â76WBæg&ÖW2æÆVæwFƒ²–æFW‚³Ò’°¢6öç7BFVÇFÒ6ö×&U3%föÇVÖTg&ÖU&V7G2†FV6öFVBÂ76WBæg&ÖW5¶–æFW‚ÒÒç6÷W&6U&V7BÂ76WBæg&ÖW5¶–æFW…Òç6÷W&6U&V7BÂG¶Æ&VÇÒG¶76WBæg&ÖW5¶–æFW‚ÒÒæ–GÒÓâG¶76WBæg&ÖW5¶–æFW…Òæ–GÖ“°¢76W'B†FVÇFæ6†ævVE—†VÅ&F–òãÒã"bbFVÇFæ6†ævVE—†VÅ&F–òÃÒã’bbFVÇFæÖVä'6öÇWFT6†ææVÄFVÇFãÒã#RbbFVÇFæÖVä'6öÇWFT6†ææVÄFVÇFÃÒ#ÂG¶Æ&VÇÓ¢æ–ÖF–öâFVÇF—27FF–2ÂF—66öçF–çV÷W2÷"–×ÆW6–&Ç’gVÆÂÖg&ÖS¢G¶76WBæg&ÖW5¶–æFW‚ÒÒæ–GÒÓâG¶76WBæg&ÖW5¶–æFW…Òæ–GÖ“°¢æ–ÖF–öäFVÇF2çW6‚‡²g&öÓ¢76WBæg&ÖW5¶–æFW‚ÒÒæ–BÂFó¢76WBæg&ÖW5¶–æFW…Òæ–BÂââæFVÇFÒ“°¢Ð¢Ð¢–b†&VÓÓÒvFVÆ—fW'’rbbõâƒó¤4„$5DU'ÄTäTÕ’•òòçFW7B†76WBç&öÆR’’f÷"†6öç7Bæ6†÷"öb76WBææ6†÷'2æf–ÇFW"†VçG'’ÓâVçG'’çG—RÓÓÒtdôõBr’’°¢6öç7Bg&ÖRÒ76WBæg&ÖW2æf–æB†VçG'’ÓâVçG'’æ–BÓÓÒæ6†÷"æg&ÖT–B“²6öç7B&÷VæG2Òg&ÖRçf—6–&ÆT&÷VæG3°¢6öç7B'6öÇWFU‚Òg&ÖRç6÷W&6U&V7Bç‚²æ6†÷"çƒ²6öç7B'6öÇWFU’Òg&ÖRç6÷W&6U&V7Bç’²æ6†÷"ç“°¢76W'B†'6öÇWFU‚ãÒ&÷VæG2ç‚ÒÖF‚æ6V–Â†&÷VæG2çv–GF‚¢ãR’bb'6öÇWFU‚ÃÒ&÷VæG2ç‚²&÷VæG2çv–GF‚²ÖF‚æ6V–Â†&÷VæG2çv–GF‚¢ãR’bb'6öÇWFU’ãÒ&÷VæG2ç’²&÷VæG2æ†V–v‡BÒÖF‚æ6V–Â†&÷VæG2æ†V–v‡B¢ã#R’bb'6öÇWFU’ÃÒ&÷VæG2ç’²&÷VæG2æ†V–v‡B²ÖF‚æ6V–Â†&÷VæG2æ†V–v‡B¢ãR’ÂG¶Æ&VÇÓ¢fö÷Bæ6†÷"—2æ÷BF–VBFòFV6öFVBf—6–&ÆRfVWC¢G¶æ6†÷"æg&ÖT–GÖ“°¢Ð¢6öç7Bæ–æU6Æ–6RÒ&VÓÓÒvFVÆ—fW'’rbb76WBææ–æU6Æ–6Rò&VæFW$æ–æU6Æ–6TÖV7W&VÖVçB†FV6öFVBÂ76WBææ–æU6Æ–6R’¢çVÆÃ°¢6öç7B&W7VÇBÒ°¢–C¢76WBæ–BÀ¢Fƒ¢76WBçF‚À¢&VÀ¢&öÆS¢76WBç&öÆRÀ¢7V&¦V7D–C¢76WBç7V&¦V7D–BÀ¢f÷&ÖC¢76WBæf÷&ÖBÀ¢v–GFƒ¢FV6öFVBçv–GF‚À¢†V–v‡C¢FV6öFVBæ†V–v‡BÀ¢'—FW3¢'—FW2æÆVæwF‚À¢&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G¶76WBçF‡ÖÒ’À¢6†#Sc¢6†#Sc¢G¶7&VFT†6‚‚w6†#Sbr’çWFFR†'—FW2’æF–vW7B‚v†W‚r—ÖÀ¢6öÆ÷%G—S¢FV6öFVBæ6öÆ÷%G—RÀ¢Ç†7FG3¢²f—6–&ÆU—†VÇ2Â÷VU—†VÇ2ÂG&ç7&VçE—†VÇ2ÒÀ¢f—7VÄÖWG&–73¢v†öÆRçV&Æ–2À¢g&ÖW2À¢æ–ÖF–öäFVÇF2À¢&W&W6VçFF—fT–FVçF—G“¢çVÆÂÀ¢6÷W&6Uf—7VÄÆ–æVvS¢çVÆÂÀ¢æ–æU6Æ–6P¢Ó°¢ö&¦V7BæFVf–æU&÷W'F–W2‡&W7VÇBÂ°¢÷ÆWGFS¢²fÇVS¢v†öÆRçÆWGFRÂVçVÖW&&ÆS¢fÇ6RÒÀ¢öÖVå&v#¢²fÇVS¢v†öÆRçV&Æ–2æÖVå&v"ÂVçVÖW&&ÆS¢fÇ6RÒÀ¢ög&ÖUf—7VÇ3¢²fÇVS¢g&ÖUf—7VÇ2ÂVçVÖW&&ÆS¢fÇ6RÐ¢Ò“°¢&WGW&â&W7VÇC°§Ð ¦gVæ7F–öâfW&–g•3$76WEföÇVÖT&F6†W2††æFöfb’°¢6öç7B²÷Væ–æt6öÖÖ—BÂ6öçG&7BÂ6öçG&7E&ööbÒÒ†æFöfc°¢6öç7B6öçG&7D&–æF–ærÒW†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖT6öçG&7EF‚ÂG'VR“°¢ÆWB&VFV6W76÷"Ò÷Væ–æt6öÖÖ—C°¢ÆWB6ö×ÆWFVD&F6†W2Ò°¢6öç7BW‡V7FVD6†V6·2Ò²tDT4ôDTEôdõ$ÔEôD”ÔTå4”ôå2rÂtÅ„ôäEõd•4”$ÄUô$õTäE2rÂte$ÔUôäEôä4„õ%ôtTôÔUE%’rÂtä”ÔD”ôåô4ôåD”åT•E’rÂu$U$U4TåDD•dUô”DTåD•E’rÂt5$õ55ô54UEô”DTåD•E’rÂu4õU$4UôDTÄ•dU%•ôÄ”äTtRrÂtä”äUõ4Ä”4Uõ5E$UD4‚rÂuDU…EôÄ”U%õ$TÔõdTBrÂt%•DUô%TDtUBuÒæÖ†–BÓâ‡²–BÂ7FGW3¢u52rÒ’“°¢6öç7BW‡V7FVDf–æF–æw2Ò°¢²–C¢u3"Õ"ÕdôÅTÔRÔ54UBÕÄ4T„ôÄDU"ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÔ54UBÔÄ”äTtRÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÔ54UBÔ”DTåD•E’ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÔ54UBÔä”ÔD”ôâÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÔ54UBÔä4„õ"ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"Õ"ÕdôÅTÔRÔ54UBÔ%TDtUBÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÐ¢Ó°¢6öç7BÆÄæÇ—6W2ÒæWrÖ‚“°¢6öç7B&W&W6VçFF—fTÖæ–fW7BÒ§6öâ‡3%&W&W6VçFF—fTÖæ–fW7EF‚“°¢6öç7B&W&W6VçFF—fUf—7VÇ2ÒæWrÖ‡&W&W6VçFF—fTÖæ–fW7Bæ76WG2æÖ†76WBÓâ°¢6öç7BFV6öFVBÒ76W'DFV6öFVEær†'—FW4B‚t„TBrÂ76WBçF‚’Â76WBçv–GF‚Â76WBæ†V–v‡BÂ&÷VæBCB&W&W6VçFF—fR–FVçF—G’6÷W&6RG¶76WBæ–GÖ“°¢6öç7Bf—7VÂÒæÇ—¦U3%föÇVÖU&Vv–öâ†FV6öFVBÂ²ƒ¢Â“¢Âv–GFƒ¢FV6öFVBçv–GF‚Â†V–v‡C¢FV6öFVBæ†V–v‡BÒÂ&÷VæBCB&W&W6VçFF—fR–FVçF—G’6÷W&6RG¶76WBæ–GÖ“°¢&WGW&â¶76WBæ–BÂ²÷ÆWGFS¢f—7VÂçÆWGFRÂöÖVå&v#¢f—7VÂçV&Æ–2æÖVå&v"ÕÓ°¢Ò’“°¢f÷"†ÆWB&F6„–æFW‚Ò²&F6„–æFW‚Â6öçG&7Bç&öGV7F–öä&F6†W2æÆVæwFƒ²&F6„–æFW‚³Ò’°¢6öç7B&F6‚Ò6öçG&7Bç&öGV7F–öä&F6†W5¶&F6„–æFW…Ó²6öç7B·&÷fVææ6UF‚Â6÷'&V7F–öåF‚ÂW‡÷'EF‚ÂÖæ–fW7EF‚ÂÖV7W&VÖVçG5F‚ÂfV6–&–Æ—G•F‚Â7&—F–5F‚Â§VFvUF‚Â6ö×ÆWF–öåF…ÒÒ&F6‚æWf–FVæ6UF‡3°¢6öç7B6÷W&6T76WG2Ò&F6‚ç6÷W&6T76WD–G2æÖ†–BÓâ6öçG&7E&ööbç6÷W&6T'”–BævWB†–B’“°¢6öç7BFVÆ—fW'”76WG2Ò&F6‚æFVÆ—fW'”76WD–G2æÖ†–BÓâ6öçG&7E&ööbæFVÆ—fW'”'”–BævWB†–B’“°¢6öç7B76WEF‡2Ò²ââç6÷W&6T76WG2æÖ†76WBÓâ76WBçF‚’ÂââæFVÆ—fW'”76WG2æÖ†76WBÓâ76WBçF‚•Ó°¢6öç7Bç•&W6VçBÒ²ââæ76WEF‡2Âââæ&F6‚æWf–FVæ6UF‡5Òç6öÖR†W†—7G2“°¢–b‚ç•&W6VçB’°¢76W'B‚²ââæ76WEF‡2Âââæ&F6‚æWf–FVæ6UF‡5Òç6öÖR†f–ÆRÓâf—'7DFD6öÖÖ—B†f–ÆR’’Â&÷VæBCBG¶&F6‚æ–GÒv2FFVBæBÆFW"&VÖ÷fVB–ç7FVBöb&VÖ–æ–ær–Ö×WF&ÆV“°¢6öç7BÆFW%F‡2Ò6öçG&7Bç&öGV7F–öä&F6†W2ç6Æ–6R†&F6„–æFW‚²’æfÆDÖ†6æF–FFRÓâ²ââæ6æF–FFRç6÷W&6T76WD–G2æÖ†–BÓâ6öçG&7E&ööbç6÷W&6T'”–BævWB†–B’çF‚’Âââæ6æF–FFRæFVÆ—fW'”76WD–G2æÖ†–BÓâ6öçG&7E&ööbæFVÆ—fW'”'”–BævWB†–B’çF‚’Âââæ6æF–FFRæWf–FVæ6UF‡5Ò“°¢76W'B‚ÆFW%F‡2ç6öÖR†f–ÆRÓâW†—7G2†f–ÆR’ÇÂf—'7DFD6öÖÖ—B†f–ÆR’’Â&÷VæBCB6¶—2Væf–æ—6†VBG¶&F6‚æ–GÒæBw&—FW2÷"ÆFW"&VÖ÷fW2ÆFW"&F6†“°¢&WGW&â²6ö×ÆWFS¢fÇ6RÂ6ö×ÆWFVD&F6†W2Â&VFV6W76÷"Ó°¢Ð¢76W'B…²ââæ76WEF‡2Âââæ&F6‚æWf–FVæ6UF‡5ÒæWfW'’†W†—7G2’Â&÷VæBCBG¶&F6‚æ–GÒ—2'F–Ã²76WG2æBæ–æRW†7BWf–FVæ6Rf–ÆW2×W7B'&—fR2—G2&Wf–WvVB6†–æ“°¢6öç7B6öçFVçD6öÖÖ—BÒf—'7DFD6öÖÖ—B†Öæ–fW7EF‚“°¢76W'DW†7E6–ævÆU&VçB†6öçFVçD6öÖÖ—BÂ&VFV6W76÷"Â&÷VæBCBG¶&F6‚æ–GÒ6öçFVçF“°¢6öç7BW‡V7FVD6öçFVçEF‡2Ò²ââæ76WEF‡2Â&÷fVææ6UF‚Â6÷'&V7F–öåF‚ÂW‡÷'EF‚ÂÖæ–fW7EF…Ó°¢76W'DW†7D6†ævVEF‡2‡&VFV6W76÷"Â6öçFVçD6öÖÖ—BÂW‡V7FVD6öçFVçEF‡2Â&÷VæBCBG¶&F6‚æ–GÒ6öçFVçB÷&÷fVææ6RöÖæ–fW7F“°¢f÷"†6öç7Bf–ÆRöbW‡V7FVD6öçFVçEF‡2’76W'B†f—'7DFD6öÖÖ—B†f–ÆR’ÓÓÒ6öçFVçD6öÖÖ—Bbb76W'DFFVDöæ6TæEVæ6†ævVB†f–ÆRÂ6öçFVçD6öÖÖ—B’Â&÷VæBCBG¶&F6‚æ–GÒ6öçFVçB—2æ÷Bâ–Ö×WF&ÆRf—'7BFF—F–öã¢G¶f–ÆWÖ“°¢6öç7BæÇ—6W2Ò²ââç6÷W&6T76WG2æÖ†76WBÓâæÇ—¦U3%föÇVÖT76WB†76WBÂw6÷W&6RrÂ&÷VæBCBG¶&F6‚æ–GÒ6÷W&6RG¶76WBæ–GÖ’’ÂââæFVÆ—fW'”76WG2æÖ†76WBÓâæÇ—¦U3%föÇVÖT76WB†76WBÂvFVÆ—fW'’rÂ&÷VæBCBG¶&F6‚æ–GÒFVÆ—fW'’G¶76WBæ–GÖ’•Ó°¢6öç7BæÇ—6—4'”–BÒæWrÖ†æÇ—6W2æÖ†VçG'’Óâ¶VçG'’æ–BÂVçG'•Ò’“°¢f÷"†6öç7BæÇ—6—2öbæÇ—6W2’ÆÄæÇ—6W2ç6WB†æÇ—6—2æ–BÂæÇ—6—2“°¢f÷"†6öç7BFVf–æ—F–öâöb6÷W&6T76WG2’°¢6öç7BæÇ—6—2ÒæÇ—6—4'”–BævWB†FVf–æ—F–öâæ–B“°¢6öç7BG—VD–FVçF—G’Òõâƒó¤4„$5DU'ÄTäTÕ—ÅT’•òòçFW7B†FVf–æ—F–öâç&öÆR“°¢–b‚G—VD–FVçF—G’’6öçF–çVS°¢6öç7BW‡V7FVE&Vf—‚ÒFVf–æ—F–öâç&öÆRç7F'G5v—F‚‚t4„$5DU%òr’òt4BÒr¢FVf–æ—F–öâç&öÆRç7F'G5v—F‚‚tTäTÕ•òr’òtTäTÕ’Òr¢uT’Òs°¢76W'B†FVf–æ—F–öâç&W&W6VçFF—fT76WD–G2ç6öÖR†–BÓâ–Bç7F'G5v—F‚†W‡V7FVE&Vf—‚’’Â&÷VæBCBG¶&F6‚æ–GÒ6÷W&6RG¶FVf–æ—F–öâæ–GÒ6—FW2æò&öÆRÖ6ö×F–&ÆR&÷fVB&W&W6VçFF—fR76WF“°¢6öç7B&VfW&Væ6W2ÒFVf–æ—F–öâç&W&W6VçFF—fT76WD–G2æÖ†–BÓâ&W&W6VçFF—fUf—7VÇ2ævWB†–B’“°¢6öç7BÖV7W&VÖVçBÒf—7VÅÆWGFTÆ–æVvR‡&VfW&Væ6W2ÂæÇ—6—2“°¢76W'B†ÖV7W&VÖVçBçÆWGFT÷fW&Æ&F–òãÒãRbbÖV7W&VÖVçBæÖVå&v$F—7Fæ6RÃÒ#Â&÷VæBCBG¶&F6‚æ–GÒ6÷W&6RG¶FVf–æ—F–öâæ–GÒ†2æòÖV7W&VBf—7VÂ–FVçF—G’6öçF–çV—G’v—F‚—G2&÷fVB&W&W6VçFF—fRÆ–æVvV“°¢æÇ—6—2ç&W&W6VçFF—fT–FVçF—G’Ò²&W&W6VçFF—fT76WD–G3¢FVf–æ—F–öâç&W&W6VçFF—fT76WD–G2ÂââæÖV7W&VÖVçBÓ°¢Ð¢f÷"†6öç7BFVf–æ—F–öâöbFVÆ—fW'”76WG2’°¢6öç7BæÇ—6—2ÒæÇ—6—4'”–BævWB†FVf–æ—F–öâæ–B“°¢6öç7B6÷W&6W2ÒFVf–æ—F–öâç6÷W&6T76WD–G2æÖ†–BÓâÆÄæÇ—6W2ævWB†–B’“°¢76W'B‡6÷W&6W2æWfW'’„&ööÆVâ’Â&÷VæBCBG¶&F6‚æ–GÒFVÆ—fW'’G¶FVf–æ—F–öâæ–GÒÆ6·2âÇ&VG’&öGV6VBFV6öFVB6÷W&6RæÇ—6—6“°¢6öç7BÖV7W&VÖVçBÒf—7VÅÆWGFTÆ–æVvR‡6÷W&6W2ÂæÇ—6—2“°¢76W'B†ÖV7W&VÖVçBçÆWGFT÷fW&Æ&F–òãÒã‚bbÖV7W&VÖVçBæÖVå&v$F—7Fæ6RÃÒƒÂ&÷VæBCBG¶&F6‚æ–GÒFVÆ—fW'’G¶FVf–æ—F–öâæ–GÒ—2æ÷BÖV7W&&Ç’f—7VÆÇ’FW&—fVBg&öÒ—G2FV6Æ&VB6÷W&6R76WG6“°¢æÇ—6—2ç6÷W&6Uf—7VÄÆ–æVvRÒ²6÷W&6T76WD–G3¢FVf–æ—F–öâç6÷W&6T76WD–G2ÂââæÖV7W&VÖVçBÓ°¢Ð¢6öç7B&÷VæF&–W2Ò²'VçF–ÖUW6TWF†÷&—¦VC¢fÇ6RÂ'VçF–ÖT–çFVw&F–öäÆÆ÷vVC¢fÇ6RÂvÖTFF×WFF–öäÆÆ÷vVC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÓ°¢6öç7B&÷fVææ6RÒ§6öâ‡&÷fVææ6UF‚“°¢76W'DW†7D¶W•6WB‡&÷fVææ6RÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂw&V6÷&G2rÂv&÷VæF&–W2uÒÂ&÷VæBCBG¶&F6‚æ–GÒvVæW&F–öâ&÷fVææ6V“°¢76W'B‡&÷fVææ6Rç66†VÖfW'6–öâÓÓÒbb&÷fVææ6Ræ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖvVæW&F–öâ×&÷fVææ6R×&÷VæBÓbb&÷fVææ6Rç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb&÷fVææ6Ræ'&æ6‚ÓÓÒv¶–Ö’rbb&÷fVææ6Ræ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’‡&÷fVææ6Ræ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb&÷fVææ6Ræ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’‡&÷fVææ6Ræ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†&÷VæF&–W2’Â&÷VæBCBG¶&F6‚æ–GÒvVæW&F–öâ&÷fVææ6R–FVçF—G’÷"&÷VæF'’Ö—6ÖF6†“°¢76W'B„'&’æ—4'&’‡&÷fVææ6Rç&V6÷&G2’bb&÷fVææ6Rç&V6÷&G2æÆVæwF‚ÓÓÒæÇ—6W2æÆVæwF‚Â&÷VæBCBG¶&F6‚æ–GÒvVæW&F–öâ&÷fVææ6R6÷fW&vRÖ—6ÖF6†“°¢f÷"†ÆWB–æFW‚Ò²–æFW‚ÂæÇ—6W2æÆVæwFƒ²–æFW‚³Ò’°¢6öç7B&V6÷&BÒ&÷fVææ6Rç&V6÷&G5¶–æFW…Ó²6öç7BæÇ—6—2ÒæÇ—6W5¶–æFW…Ó²6öç7BFVf–æ—F–öâÒ6öçG&7E&ööbç6÷W&6T'”–BævWB†æÇ—6—2æ–B’óò6öçG&7E&ööbæFVÆ—fW'”'”–BævWB†æÇ—6—2æ–B“°¢76W'DW†7D¶W•6WB‡&V6÷&BÂ²v76WD–BrÂv&VrÂv÷&–v–ârÂwFööÂrÂvÖöFVÂrÂv7&VFVDBrÂw&VfW&Væ6T76WD–G2rÂv÷WGWE6†#SbuÒÂ&÷VæBCBG¶&F6‚æ–GÒ&÷fVææ6RG¶æÇ—6—2æ–GÖ“°¢76W'B‡&V6÷&Bæ76WD–BÓÓÒæÇ—6—2æ–Bbb&V6÷&Bæ&VÓÓÒæÇ—6—2æ&Vbb²ttTäU$DTEôäEôÔåTÄÅ•ô4õ%$T5DTBrÂtÔåTÄÅ•ôUD„õ$TBrÂt…”%$”BuÒæ–æ6ÇVFW2‡&V6÷&Bæ÷&–v–â’bbG—Vöb&V6÷&BçFööÂÓÓÒw7G&–ærrbbõå´Õ¦×£Ó’åò²Õ×³ÃƒÒBòçFW7B‡&V6÷&BçFööÂ’bbG—Vöb&V6÷&BæÖöFVÂÓÓÒw7G&–ærrbbõå´Õ¦×£Ó’åò³¢òÕ×³Ã#ÒBòçFW7B‡&V6÷&BæÖöFVÂ’bb—46æöæ–6Ä—6ô–ç7FçB‡&V6÷&Bæ7&VFVDB’bb&V6÷&Bæ÷WGWE6†#SbÓÓÒæÇ—6—2ç6†#SbÂ&÷VæBCBG¶&F6‚æ–GÒ&÷fVææ6R&V6÷&B—2–çfÆ–C¢G¶æÇ—6—2æ–GÖ“°¢6öç7BW‡V7FVE&VfW&Væ6T–G2ÒæÇ—6—2æ&VÓÓÒw6÷W&6RròFVf–æ—F–öâç&W&W6VçFF—fT76WD–G2¢FVf–æ—F–öâç6÷W&6T76WD–G3°¢76W'B„¥4ôâç7G&–æv–g’‡&V6÷&Bç&VfW&Væ6T76WD–G2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE&VfW&Væ6T–G2’Â&÷VæBCBG¶&F6‚æ–GÒ&÷fVææ6RÆ–æVvRF–ffW'2g&öÒ6öçG&7C¢G¶æÇ—6—2æ–GÖ“°¢Ð¢6öç7B6÷'&V7F–öç2Ò§6öâ†6÷'&V7F–öåF‚“°¢76W'DW†7D¶W•6WB†6÷'&V7F–öç2Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂw&V6÷&G2rÂv&÷VæF&–W2uÒÂ&÷VæBCBG¶&F6‚æ–GÒ6÷'&V7F–öâÆöv“°¢76W'B†6÷'&V7F–öç2ç66†VÖfW'6–öâÓÓÒbb6÷'&V7F–öç2æ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖÖçVÂÖ6÷'&V7F–öâÖÆör×&÷VæBÓbb6÷'&V7F–öç2ç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bb6÷'&V7F–öç2æ'&æ6‚ÓÓÒv¶–Ö’rbb6÷'&V7F–öç2æ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†6÷'&V7F–öç2æ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb6÷'&V7F–öç2æ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†6÷'&V7F–öç2æ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†&÷VæF&–W2’bb'&’æ—4'&’†6÷'&V7F–öç2ç&V6÷&G2’bb6÷'&V7F–öç2ç&V6÷&G2æÆVæwF‚ÓÓÒæÇ—6W2æÆVæwF‚Â&÷VæBCBG¶&F6‚æ–GÒ6÷'&V7F–öâÆör–FVçF—G’Â&÷VæF'’÷"6÷fW&vRÖ—6ÖF6†“°¢f÷"†ÆWB–æFW‚Ò²–æFW‚ÂæÇ—6W2æÆVæwFƒ²–æFW‚³Ò’°¢6öç7B&V6÷&BÒ6÷'&V7F–öç2ç&V6÷&G5¶–æFW…Ó²6öç7BæÇ—6—2ÒæÇ—6W5¶–æFW…Ó°¢76W'DW†7D¶W•6WB‡&V6÷&BÂ²v76WD–BrÂv÷W&F–öç2rÂw&Wf–WvW%&öÆRrÂv6ö×ÆWFVDBrÂv÷WGWE6†#SbuÒÂ&÷VæBCBG¶&F6‚æ–GÒ6÷'&V7F–öâG¶æÇ—6—2æ–GÖ“°¢76W'E6÷'FVEVæ—VU7G&–æw2‡&V6÷&Bæ÷W&F–öç2Â&÷VæBCBG¶&F6‚æ–GÒ6÷'&V7F–öâ÷W&F–öç2G¶æÇ—6—2æ–GÖÂ2Â"“°¢76W'B‡&V6÷&Bæ76WD–BÓÓÒæÇ—6—2æ–Bbb&V6÷&Bæ÷W&F–öç2æWfW'’†÷W&F–öâÓâ²tä4„õ%ôÄ”täÔTåBrÂt%D”d5Eô4ÄTåUrÂt4ôÄõ%ô4ôå4•5DTä5’rÂtTDtUô4ÄTåUrÂte$ÔUô4ôåD”åT•E’rÂt”DTåD•E•ô4õ%$T5D”ôârÂtä”äUõ4Ä”4Uô4ÄTåUrÂuDU…EôÄ”U%õ$TÔõdTBuÒæ–æ6ÇVFW2†÷W&F–öâ’’bb&V6÷&Bæ÷W&F–öç2æ–æ6ÇVFW2‚t%D”d5Eô4ÄTåUr’bb&V6÷&Bæ÷W&F–öç2æ–æ6ÇVFW2‚t4ôÄõ%ô4ôå4•5DTä5’r’bb&V6÷&Bæ÷W&F–öç2æ–æ6ÇVFW2‚uDU…EôÄ”U%õ$TÔõdTBr’bb&V6÷&Bç&Wf–WvW%&öÆRÓÓÒu3%õ%ô54UEô%EôD•$T5Dõ"rbb—46æöæ–6Ä—6ô–ç7FçB‡&V6÷&Bæ6ö×ÆWFVDB’bb&V6÷&Bæ÷WGWE6†#SbÓÓÒæÇ—6—2ç6†#SbÂ&÷VæBCBG¶&F6‚æ–GÒ6÷'&V7F–öâÆörFöW2æ÷B6Æ÷6RFW‡Bö'F–f7Bö6öÆ÷W"&Wf–Ws¢G¶æÇ—6—2æ–GÖ“°¢–b†æÇ—6—2æ&VÓÓÒvFVÆ—fW'’rbbõâƒó¤4„$5DU'ÄTäTÕ’•òòçFW7B†æÇ—6—2ç&öÆR’’76W'B‡&V6÷&Bæ÷W&F–öç2æ–æ6ÇVFW2‚tä4„õ%ôÄ”täÔTåBr’bb&V6÷&Bæ÷W&F–öç2æ–æ6ÇVFW2‚te$ÔUô4ôåD”åT•E’r’Â&÷VæBCBG¶&F6‚æ–GÒ6öÖ&BFVÆ—fW'’6÷'&V7F–öâÆ6·2æ6†÷"ög&ÖR&Wf–Ws¢G¶æÇ—6—2æ–GÖ“°¢Ð¢6öç7BW‡÷'DÆ–æVvRÒ§6öâ†W‡÷'EF‚“°¢76W'DW†7D¶W•6WB†W‡÷'DÆ–æVvRÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂw&V6÷&G2rÂv&÷VæF&–W2uÒÂ&÷VæBCBG¶&F6‚æ–GÒW‡÷'BÆ–æVvV“°¢76W'B†W‡÷'DÆ–æVvRç66†VÖfW'6–öâÓÓÒbbW‡÷'DÆ–æVvRæ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖW‡÷'BÖÆ–æVvR×&÷VæBÓbbW‡÷'DÆ–æVvRç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bbW‡÷'DÆ–æVvRæ'&æ6‚ÓÓÒv¶–Ö’rbbW‡÷'DÆ–æVvRæ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†W‡÷'DÆ–æVvRæ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bbW‡÷'DÆ–æVvRæ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†W‡÷'DÆ–æVvRæ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†&÷VæF&–W2’bb'&’æ—4'&’†W‡÷'DÆ–æVvRç&V6÷&G2’bbW‡÷'DÆ–æVvRç&V6÷&G2æÆVæwF‚ÓÓÒFVÆ—fW'”76WG2æÆVæwF‚Â&÷VæBCBG¶&F6‚æ–GÒW‡÷'BÆ–æVvR–FVçF—G’Â&÷VæF'’÷"6÷fW&vRÖ—6ÖF6†“°¢f÷"†ÆWB–æFW‚Ò²–æFW‚ÂFVÆ—fW'”76WG2æÆVæwFƒ²–æFW‚³Ò’°¢6öç7BFVf–æ—F–öâÒFVÆ—fW'”76WG5¶–æFW…Ó²6öç7BæÇ—6—2ÒæÇ—6—4'”–BævWB†FVf–æ—F–öâæ–B“²6öç7B&V6÷&BÒW‡÷'DÆ–æVvRç&V6÷&G5¶–æFW…Ó°¢76W'DW†7D¶W•6WB‡&V6÷&BÂ²vFVÆ—fW'”76WD–BrÂw6÷W&6T76WG2rÂw&V6—RrÂv÷WGWBuÒÂ&÷VæBCBG¶&F6‚æ–GÒW‡÷'BG¶FVf–æ—F–öâæ–GÖ“°¢6öç7B6÷W&6T&–æF–æw2ÒFVf–æ—F–öâç6÷W&6T76WD–G2æÖ†–BÓâ²6öç7B6÷W&6RÒ6öçG&7E&ööbç6÷W&6T'”–BævWB†–B“²&WGW&â²–BÂFƒ¢6÷W&6RçF‚Â&Æö#¢v—B…²w&Wb×'6RrÂ„TC¢G·6÷W&6RçF‡ÖÒ’Â6†#Sc¢6†#Sdf–ÆTB‚t„TBrÂ6÷W&6RçF‚’Ó²Ò“°¢76W'B‡&V6÷&BæFVÆ—fW'”76WD–BÓÓÒFVf–æ—F–öâæ–Bbb¥4ôâç7G&–æv–g’‡&V6÷&Bç6÷W&6T76WG2’ÓÓÒ¥4ôâç7G&–æv–g’‡6÷W&6T&–æF–æw2’bb¥4ôâç7G&–æv–g’‡&V6÷&Bç&V6—R’ÓÓÒ¥4ôâç7G&–æv–g’†FVf–æ—F–öâæW‡÷'E&V6—R’bb¥4ôâç7G&–æv–g’‡&V6÷&Bæ÷WGWB’ÓÓÒ¥4ôâç7G&–æv–g’‡²Fƒ¢æÇ—6—2çF‚Â&Æö#¢æÇ—6—2æ&Æö"Â6†#Sc¢æÇ—6—2ç6†#SbÒ’Â&÷VæBCBG¶&F6‚æ–GÒW‡÷'B—2æ÷B'—FRÖ&÷VæBFòW†7B6÷W&6R76WG2÷&V6—Rö÷WGWC¢G¶FVf–æ—F–öâæ–GÖ“°¢Ð¢6öç7BÖæ–fW7BÒ§6öâ†Öæ–fW7EF‚“°¢76W'DW†7D¶W•6WB†Öæ–fW7BÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂw&÷fVææ6RrÂvÖçVÄ6÷'&V7F–öäÆörrÂvW‡÷'DÆ–æVvRrÂv76WG2rÂwF÷FÄ'—FW2rÂv&÷VæF&–W2uÒÂ&÷VæBCBG¶&F6‚æ–GÒÖæ–fW7F“°¢76W'B†Öæ–fW7Bç66†VÖfW'6–öâÓÓÒbbÖæ–fW7Bæ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖÖæ–fW7B×&÷VæBÓbbÖæ–fW7Bç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bbÖæ–fW7Bæ'&æ6‚ÓÓÒv¶–Ö’rbbÖæ–fW7Bæ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†Öæ–fW7Bæ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bbÖæ–fW7Bæ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†Öæ–fW7Bç&÷fVææ6R’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ&÷fVææ6UF‚ÂG'VR’’bb¥4ôâç7G&–æv–g’†Öæ–fW7BæÖçVÄ6÷'&V7F–öäÆör’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ6÷'&V7F–öåF‚ÂG'VR’’bb¥4ôâç7G&–æv–g’†Öæ–fW7BæW‡÷'DÆ–æVvR’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂW‡÷'EF‚ÂG'VR’’bb¥4ôâç7G&–æv–g’†Öæ–fW7Bæ76WG2’ÓÓÒ¥4ôâç7G&–æv–g’†æÇ—6W2’bbÖæ–fW7BçF÷FÄ'—FW2ÓÓÒæÇ—6W2ç&VGV6R‚‡7VÒÂVçG'’’Óâ7VÒ²VçG'’æ'—FW2Â’bbÖæ–fW7BçF÷FÄ'—FW2ÃÒ&F6‚æÖ„'—FW2bb¥4ôâç7G&–æv–g’†Öæ–fW7Bæ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†&÷VæF&–W2’Â&÷VæBCBG¶&F6‚æ–GÒÖæ–fW7BF–ffW'2g&öÒG'W7FVBFV6öFVB'—FW2ÂÆ–æVvR÷"'VFvWF“°¢6öç7BÖæ–fW7EF&vWBÒ²6öÖÖ—C¢6öçFVçD6öÖÖ—BÂG&VS¢v—B…²w&Wb×'6RrÂG¶6öçFVçD6öÖÖ—GÕç·G&VWÖÒ’Ó°¢6öç7BÖæ–fW7D&–æF–ærÒW†7EF„&–æF–ætB‚t„TBrÂÖæ–fW7EF‚ÂG'VR“°¢6öç7BÖV7W&VÖVçG2Ò§6öâ†ÖV7W&VÖVçG5F‚“°¢76W'DW†7D¶W•6WB†ÖV7W&VÖVçG2Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂvVF—EF&vWBrÂvÖæ–fW7BrÂv6†V6·2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂ&÷VæBCBG¶&F6‚æ–GÒÖV7W&VÖVçG6“²76W'DW†7D¶W•6WB†ÖV7W&VÖVçG2çVç&W6öÇfVBÂ²urÂuuÒÂ&÷VæBCBG¶&F6‚æ–GÒÖV7W&VÖVçBVç&W6öÇfVF“°¢76W'B†ÖV7W&VÖVçG2ç66†VÖfW'6–öâÓÓÒbbÖV7W&VÖVçG2æ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖÖV7W&VÖVçG2×&÷VæBÓbbÖV7W&VÖVçG2ç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bbÖV7W&VÖVçG2æ'&æ6‚ÓÓÒv¶–Ö’rbbÖV7W&VÖVçG2æ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†ÖV7W&VÖVçG2æ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bbÖV7W&VÖVçG2æ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†ÖV7W&VÖVçG2æVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’†Öæ–fW7EF&vWB’bb¥4ôâç7G&–æv–g’†ÖV7W&VÖVçG2æÖæ–fW7B’ÓÓÒ¥4ôâç7G&–æv–g’†Öæ–fW7D&–æF–ær’bb¥4ôâç7G&–æv–g’†ÖV7W&VÖVçG2æ6†V6·2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD6†V6·2’bb¥4ôâç7G&–æv–g’†ÖV7W&VÖVçG2çVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bbÖV7W&VÖVçG2çfW&F–7BÓÓÒu55õ3%õ%ô54UEõdôÅTÔUô$D4…ôÔT5U$TÔTåE2rbbÖV7W&VÖVçG2æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõdôÅTÔUô$D4…ôdT4”$”Ä•E’rÂ&÷VæBCBG¶&F6‚æ–GÒÖV7W&VÖVçG2Ö—6ÖF6‚÷"÷fW&6Æ–Ö“°¢6öç7BÖV7W&VÖVçG46öÖÖ—BÒf—'7DFD6öÖÖ—B†ÖV7W&VÖVçG5F‚“²76W'DW†7E6–ævÆU&VçB†ÖV7W&VÖVçG46öÖÖ—BÂ6öçFVçD6öÖÖ—BÂ&÷VæBCBG¶&F6‚æ–GÒÖV7W&VÖVçG6“²76W'DW†7D6†ævVEF‡2†6öçFVçD6öÖÖ—BÂÖV7W&VÖVçG46öÖÖ—BÂ¶ÖV7W&VÖVçG5F…ÒÂ&÷VæBCBG¶&F6‚æ–GÒÖV7W&VÖVçG6“²76W'DFFVDöæ6TæEVæ6†ævVB†ÖV7W&VÖVçG5F‚ÂÖV7W&VÖVçG46öÖÖ—B“°¢6öç7BfV6–&–Æ—G’Ò§6öâ†fV6–&–Æ—G•F‚“°¢76W'DW†7D¶W•6WB†fV6–&–Æ—G’Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂvVF—EF&vWBrÂvÖV7W&VÖVçG2rÂv6†V6·2rÂvf–æF–æw2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂ&÷VæBCBG¶&F6‚æ–GÒfV6–&–Æ—G–“²76W'DW†7D¶W•6WB†fV6–&–Æ—G’çVç&W6öÇfVBÂ²urÂuuÒÂ&÷VæBCBG¶&F6‚æ–GÒfV6–&–Æ—G’Vç&W6öÇfVF“°¢76W'B†fV6–&–Æ—G’ç66†VÖfW'6–öâÓÓÒbbfV6–&–Æ—G’æ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖfV6–&–Æ—G’ÖVF—B×&÷VæBÓbbfV6–&–Æ—G’ç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bbfV6–&–Æ—G’æ'&æ6‚ÓÓÒv¶–Ö’rbbfV6–&–Æ—G’æ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bbfV6–&–Æ—G’æ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’†Öæ–fW7EF&vWB’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æÖV7W&VÖVçG2’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂÖV7W&VÖVçG5F‚ÂG'VR’’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æ6†V6·2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD6†V6·2’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’çVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bbfV6–&–Æ—G’çfW&F–7BÓÓÒu55õ3%õ%ô54UEõdôÅTÔUô$D4…ôdT4”$”Ä•E’rbbfV6–&–Æ—G’æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõdôÅTÔUô$D4…ô”äDUTäDTåEô5$•D”2rÂ&÷VæBCBG¶&F6‚æ–GÒfV6–&–Æ—G’Ö—6ÖF6‚÷"÷fW&6Æ–Ö“°¢6öç7BfV6–&–Æ—G”6öÖÖ—BÒf—'7DFD6öÖÖ—B†fV6–&–Æ—G•F‚“²76W'DW†7E6–ævÆU&VçB†fV6–&–Æ—G”6öÖÖ—BÂÖV7W&VÖVçG46öÖÖ—BÂ&÷VæBCBG¶&F6‚æ–GÒfV6–&–Æ—G–“²76W'DW†7D6†ævVEF‡2†ÖV7W&VÖVçG46öÖÖ—BÂfV6–&–Æ—G”6öÖÖ—BÂ¶fV6–&–Æ—G•F…ÒÂ&÷VæBCBG¶&F6‚æ–GÒfV6–&–Æ—G–“²76W'DFFVDöæ6TæEVæ6†ævVB†fV6–&–Æ—G•F‚ÂfV6–&–Æ—G”6öÖÖ—B“°¢6öç7B7&—F–2Ò§6öâ†7&—F–5F‚“°¢76W'DW†7D¶W•6WB†7&—F–2Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂvVF—EF&vWBrÂvfV6–&–Æ—G”VF—BrÂvÆVç6W2rÂvf–æF–æw2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂ&÷VæBCBG¶&F6‚æ–GÒ7&—F–6“²76W'DW†7D¶W•6WB†7&—F–2çVç&W6öÇfVBÂ²urÂuuÒÂ&÷VæBCBG¶&F6‚æ–GÒ7&—F–2Vç&W6öÇfVF“°¢6öç7BÆVç6W2Ò²t%EôD•$T5D”ôârÂt4„$5DU%ô”DTåD•E’rÂtä”ÔD”ôârÂt”ÕÄTÔTåDD”ôârÂt54UEõ•TÄ”äRrÂt44U54”$”Ä•E’rÂt%TDtUBrÂu%TåD”ÔUô$õTäD%’uÒæÖ†–BÓâ‡²–BÂ7FGW3¢u52rÒ’“°¢76W'B†7&—F–2ç66†VÖfW'6–öâÓÓÒbb7&—F–2æ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖ–æFWVæFVçBÖ7&—F–2×&÷VæBÓbb7&—F–2ç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bb7&—F–2æ'&æ6‚ÓÓÒv¶–Ö’rbb7&—F–2æ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†7&—F–2æ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb7&—F–2æ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†7&—F–2æVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’†Öæ–fW7EF&vWB’bb¥4ôâç7G&–æv–g’†7&—F–2æfV6–&–Æ—G”VF—B’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂfV6–&–Æ—G•F‚ÂG'VR’’bb¥4ôâç7G&–æv–g’†7&—F–2æÆVç6W2’ÓÓÒ¥4ôâç7G&–æv–g’†ÆVç6W2’bb¥4ôâç7G&–æv–g’†7&—F–2æf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†7&—F–2çVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb7&—F–2çfW&F–7BÓÓÒu55õ3%õ%ô54UEõdôÅTÔUô$D4…ô”äDUTäDTåEô5$•D”2rbb7&—F–2æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõdôÅTÔUô$D4…ôd”äÅô¥TDtRrÂ&÷VæBCBG¶&F6‚æ–GÒ7&—F–2Ö—6ÖF6‚÷"õ&VÖ–ç6“°¢6öç7B7&—F–46öÖÖ—BÒf—'7DFD6öÖÖ—B†7&—F–5F‚“²76W'DW†7E6–ævÆU&VçB†7&—F–46öÖÖ—BÂfV6–&–Æ—G”6öÖÖ—BÂ&÷VæBCBG¶&F6‚æ–GÒ7&—F–6“²76W'DW†7D6†ævVEF‡2†fV6–&–Æ—G”6öÖÖ—BÂ7&—F–46öÖÖ—BÂ¶7&—F–5F…ÒÂ&÷VæBCBG¶&F6‚æ–GÒ7&—F–6“²76W'DFFVDöæ6TæEVæ6†ævVB†7&—F–5F‚Â7&—F–46öÖÖ—B“°¢6öç7B§VFvRÒ§6öâ†§VFvUF‚“°¢76W'DW†7D¶W•6WB†§VFvRÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂvVF—EF&vWBrÂv7&—F–2rÂvf–æF–æw2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂ&÷VæBCBG¶&F6‚æ–GÒ§VFvV“²76W'DW†7D¶W•6WB†§VFvRçVç&W6öÇfVBÂ²urÂuuÒÂ&÷VæBCBG¶&F6‚æ–GÒ§VFvRVç&W6öÇfVF“°¢76W'B†§VFvRç66†VÖfW'6–öâÓÓÒbb§VFvRæ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖf–æÂÖ§VFvR×&÷VæBÓbb§VFvRç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bb§VFvRæ'&æ6‚ÓÓÒv¶–Ö’rbb§VFvRæ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†§VFvRæ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb§VFvRæ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†§VFvRæVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’†Öæ–fW7EF&vWB’bb¥4ôâç7G&–æv–g’†§VFvRæ7&—F–2’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ7&—F–5F‚ÂG'VR’’bb¥4ôâç7G&–æv–g’†§VFvRæf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†§VFvRçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb§VFvRçfW&F–7BÓÓÒu55õ3%õ%ô54UEõdôÅTÔUô$D4…ôd”äÅô¥TDtRrbb§VFvRæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõdôÅTÔUô$D4…ô4ôÕÄUD”ôârÂ&÷VæBCBG¶&F6‚æ–GÒf–æÂ§VFvRÖ—6ÖF6‚÷"÷fW&6Æ–Ö“°¢6öç7B§VFvT6öÖÖ—BÒf—'7DFD6öÖÖ—B†§VFvUF‚“²76W'DW†7E6–ævÆU&VçB†§VFvT6öÖÖ—BÂ7&—F–46öÖÖ—BÂ&÷VæBCBG¶&F6‚æ–GÒ§VFvV“²76W'DW†7D6†ævVEF‡2†7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ¶§VFvUF…ÒÂ&÷VæBCBG¶&F6‚æ–GÒ§VFvV“²76W'DFFVDöæ6TæEVæ6†ævVB†§VFvUF‚Â§VFvT6öÖÖ—B“°¢6öç7B6ö×ÆWF–öâÒ§6öâ†6ö×ÆWF–öåF‚“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6öçG&7BrÂv&F6‚rÂwfW&–f–VD6öçFVçBrÂvf–æÄ§VFvRrÂwVç&W6öÇfVBrÂv&÷VæF&–W2rÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂ&÷VæBCBG¶&F6‚æ–GÒ6ö×ÆWF–öæ“²76W'DW†7D¶W•6WB†6ö×ÆWF–öâçVç&W6öÇfVBÂ²urÂuuÒÂ&÷VæBCBG¶&F6‚æ–GÒ6ö×ÆWF–öâVç&W6öÇfVF“°¢6öç7BÖ†–×VÕfW&F–7BÒ&F6„–æFW‚²ÓÓÒ6öçG&7Bç&öGV7F–öä&F6†W2æÆVæwF‚òu$TE•ôdõ%õ3%õ5õ%TåD”ÔUô”åDTu$D”ôåõ44õUõ$Ud”Urr¢u$TE•ôdõ%õ3%õ%ô54UEõdôÅTÔUôäU…Eô$D4‚s°¢76W'B†6ö×ÆWF–öâç66†VÖfW'6–öâÓÓÒbb6ö×ÆWF–öâæ'F–f7D–BÓÓÒ6G2×F÷vW"×3"×"Ö76WB×föÇVÖRÒG¶&F6‚æ–GÒÖ6ö×ÆWF–öâÖWf–FVæ6R×&÷VæBÓbb6ö×ÆWF–öâç&W÷6—F÷'’ÓÓÒ&÷fVææ6Rç&W÷6—F÷'’bb6ö×ÆWF–öâæ'&æ6‚ÓÓÒv¶–Ö’rbb6ö×ÆWF–öâæ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb6ö×ÆWF–öâæ&F6‚ÓÓÒ&F6‚æ–Bbb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâçfW&–f–VD6öçFVçB’ÓÓÒ¥4ôâç7G&–æv–g’†Öæ–fW7EF&vWB’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæf–æÄ§VFvR’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ§VFvUF‚ÂG'VR’’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†&÷VæF&–W2’bb6ö×ÆWF–öâçfW&F–7BÓÓÒu55õ3%õ%ô54UEõdôÅTÔUô$D4‚rbb6ö×ÆWF–öâæÖ†–×VÕfW&F–7BÓÓÒÖ†–×VÕfW&F–7BÂ&÷VæBCBG¶&F6‚æ–GÒ6ö×ÆWF–öâÖ—6ÖF6‚÷"÷fW&6Æ–Ö“°¢6öç7B6ö×ÆWF–öä6öÖÖ—BÒf—'7DFD6öÖÖ—B†6ö×ÆWF–öåF‚“²76W'DW†7E6–ævÆU&VçB†6ö×ÆWF–öä6öÖÖ—BÂ§VFvT6öÖÖ—BÂ&÷VæBCBG¶&F6‚æ–GÒ6ö×ÆWF–öæ“²76W'DW†7D6†ævVEF‡2†§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ¶6ö×ÆWF–öåF…ÒÂ&÷VæBCBG¶&F6‚æ–GÒ6ö×ÆWF–öæ“²76W'DFFVDöæ6TæEVæ6†ævVB†6ö×ÆWF–öåF‚Â6ö×ÆWF–öä6öÖÖ—B“°¢&VFV6W76÷"Ò6ö×ÆWF–öä6öÖÖ—C²6ö×ÆWFVD&F6†W2³Ò°¢Ð¢f÷"†6öç7B7V&¦V7D–BöbæWr6WB†6öçG&7BæFVÆ—fW'”76WG2æf–ÇFW"†76WBÓâõâƒó¤4„$5DU'ÄTäTÕ’•òòçFW7B†76WBç&öÆR’’æÖ†76WBÓâ76WBç7V&¦V7D–B’’’°¢6öç7BFVf–æ—F–öç2Ò6öçG&7BæFVÆ—fW'”76WG2æf–ÇFW"†76WBÓâ76WBç7V&¦V7D–BÓÓÒ7V&¦V7D–Bbbõâƒó¤4„$5DU'ÄTäTÕ’•òòçFW7B†76WBç&öÆR’“°¢6öç7BæÇ—6W2ÒFVf–æ—F–öç2æÖ†76WBÓâÆÄæÇ—6W2ævWB†76WBæ–B’“°¢76W'B†æÇ—6W2æWfW'’„&ööÆVâ’Â&÷VæBCB7&÷72Ö76WB–FVçF—G’VF—BÆ6·2FV6öFVB76WBf÷"G·7V&¦V7D–GÖ“°¢6öç7Bg&ÖTÖVç2ÒæÇ—6W2æfÆDÖ†æÇ—6—2ÓâæÇ—6—2æg&ÖW2æÖ†g&ÖRÓâg&ÖRæÖVå&v"’“°¢6öç7Bæ÷&ÖÆ—¦VD†V–v‡G2ÒFVf–æ—F–öç2æfÆDÖ‚†FVf–æ—F–öâÂ76WD–æFW‚’ÓâFVf–æ—F–öâæg&ÖW2æÖ‚†g&ÖRÂg&ÖT–æFW‚’ÓâæÇ—6W5¶76WD–æFW…Òæg&ÖW5¶g&ÖT–æFW…Òçf—6–&ÆT&÷VæG2æ†V–v‡Bòg&ÖRç6÷W&6U&V7Bæ†V–v‡B’“°¢ÆWBÖ†–×VÔÖVä6öÆ÷W$F—7Fæ6RÒ°¢f÷"†ÆWBÆVgBÒ²ÆVgBÂg&ÖTÖVç2æÆVæwFƒ²ÆVgB³Ò’f÷"†ÆWB&–v‡BÒÆVgB²²&–v‡BÂg&ÖTÖVç2æÆVæwFƒ²&–v‡B³Ò’Ö†–×VÔÖVä6öÆ÷W$F—7Fæ6RÒÖF‚æÖ‚†Ö†–×VÔÖVä6öÆ÷W$F—7Fæ6RÂÖF‚æ‡—÷B‚ââæg&ÖTÖVç5¶ÆVgEÒæÖ‚‡fÇVRÂ6†ææVÂ’ÓâfÇVRÒg&ÖTÖVç5·&–v‡EÕ¶6†ææVÅÒ’’“°¢76W'B†g&ÖTÖVç2æÆVæwF‚ãÒRbbÖ†–×VÔÖVä6öÆ÷W$F—7Fæ6RÃÒƒbbÖF‚æÖ‚‚ââææ÷&ÖÆ—¦VD†V–v‡G2’òÖF‚æÖ–â‚ââææ÷&ÖÆ—¦VD†V–v‡G2’ÃÒ2ãRÂ&÷VæBCBFV6öFVB7&÷72Ö76WB–FVçF—G’÷&÷÷'F–öâ6öçF–çV—G’f–ÆVBf÷"G·7V&¦V7D–GÖ“°¢Ð¢&WGW&â²6ö×ÆWFS¢6ö×ÆWFVD&F6†W2ÓÓÒ6öçG&7Bç&öGV7F–öä&F6†W2æÆVæwF‚Â6ö×ÆWFVD&F6†W2Â&VFV6W76÷"Ó°§Ð ¦gVæ7F–öâfW&–g•3$76WEföÇVÖU66÷T†æFöfb‚’°¢76W'B„&ööÆVâ‡3$76WEföÇVÖU66÷T6öçG&öÂ’ÓÓÒ&ööÆVâ‡3$76WEföÇVÖU66÷TÆö6²’Âw&÷VæBC26öçG&öÂæBv÷fW&ææ6R7F—fF–öâ&V6÷&B&÷VæB2×W7BV"FöÖ–6ÆÇ’r“°¢–b‚3$76WEföÇVÖU66÷T6öçG&öÂ’&WGW&âçVÆÃ°¢76W'B‡3%&W&W6VçFF—fT76WE72bb3$76WE746öçG&öÂÂw&÷VæBC2&WV—&W2F†R6ö×ÆWFR–Ö×WF&ÆR&W&W6VçFF—fR55ô54UB7FFRr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷T6öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂvVçG'•v÷&¶fÆ÷rrÂvv÷fW&ææ6T7F—fF–öârÂv&÷fVE&W&W6VçFF—fRrÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂw&÷VæBC26öçG&öÂr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷T6öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂw&÷VæBC2VçG'’r“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷T6öçG&öÂæv÷fW&ææ6T7F—fF–öâÂ²wF‚rÂv&Æö"uÒÂw&÷VæBC2v÷fW&ææ6R7F—fF–öâ&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷T6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²w66÷T6öçG&7E&VG’rÂv76WD'—FW4WF†÷&—¦VBrÂv76WEföÇVÖTÆÆ÷vVBrÂw'VçF–ÖT–çFVw&F–öäÆÆ÷vVBrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC26ö×ÆWF–öâ&÷VæF'’r“°¢6öç7B746öÖÖ—BÒ3%&W&W6VçFF—fT76WE72æ÷Væ–æt6öÖÖ—C²6öç7B75G&VRÒv—B…²w&Wb×'6RrÂG·746öÖÖ—GÕç·G&VWÖÒ“°¢6öç7BW‡V7FVD&÷fVE&W&W6VçFF—fRÒ°¢6†ævT6öçG&öÃ¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WE746öçG&öÅF‚ÂG'VR’À¢746öÖÖ—BÀ¢75G&VRÀ¢Öæ–fW7C¢W†7EF„&–æF–ætB‚t„TBrÂ3%&W&W6VçFF—fTÖæ–fW7EF‚ÂG'VR’À¢7&—F–3¢W†7EF„&–æF–ætB‚t„TBrÂ3%&W&W6VçFF—fTWf–FVæ6UF‡2æ7&—F–2ÂG'VR’À¢f–æÄ§VFvS¢W†7EF„&–æF–ætB‚t„TBrÂ3%&W&W6VçFF—fTWf–FVæ6UF‡2æf–æÄ§VFvRÂG'VR’À¢6ö×ÆWF–öã¢W†7EF„&–æF–ætB‚t„TBrÂ3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öâÂG'VR¢Ó°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷TÆö6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv&6RrÂvFW&—fF–öârÂvFV6—6–öârÂv&÷fVE&W&W6VçFF—fRrÂv&÷VæF&–W2uÒÂw&÷VæB2v÷fW&ææ6R7F—fF–öâ&V6÷&Br“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷TÆö6²æ&6RÂ²v†VBrÂwG&VRuÒÂw&÷VæB2&6Rr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷TÆö6²æFW&—fF–öâÂ²w'VÆRrÂv&÷fVDvöÆFVäÖ7FW$FV6—6–öäÆö6²rÂw&W&W6VçFF—fU746öçG&öÂrÂw&W&W6VçFF—fTÖæ–fW7BrÂw&W&W6VçFF—fT6ö×ÆWF–öâuÒÂw&÷VæB2FW&—fF–öâr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖU66÷TÆö6²æ&÷VæF&–W2Â²v76WD'—FW4WF†÷&—¦VBrÂv76WEföÇVÖTÆÆ÷vVBrÂw'VçF–ÖT–çFVw&F–öäÆÆ÷vVBrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBuÒÂw&÷VæB2&÷VæF&–W2r“°¢76W'B‡3$76WEföÇVÖU66÷TÆö6²ç66†VÖfW'6–öâÓÓÒbb3$76WEföÇVÖU66÷TÆö6²æ'F–f7D–BÓÓÒv6G2×F÷vW"Öv÷fW&ææ6RÖ7F—fF–öâ×&V6÷&B×&÷VæBÓ2rbb—46æöæ–6Ä—6ôFFR‡3$76WEföÇVÖU66÷TÆö6²æ7&VFVDB’bb3$76WEföÇVÖU66÷TÆö6²ç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3$76WEföÇVÖU66÷TÆö6²æ'&æ6‚ÓÓÒv¶–Ö’rÂw&÷VæB27F—fF–öâ–FVçF—G’Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷TÆö6²æ&6R’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢746öÖÖ—BÂG&VS¢75G&VRÒ’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷TÆö6²æ&÷fVE&W&W6VçFF—fR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE&W&W6VçFF—fR’Âw&÷VæB2FöW2æ÷B&–æBF†RW†7B&W&W6VçFF—fR55ô54UB7FFRr“°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷TÆö6²æFW&—fF–öâ’ÓÓÒ¥4ôâç7G&–æv–g’‡²'VÆS¢tUDôÔD”5õ44õUôôäÅ•õ5T44U54õ%ôeDU%ôU„5EõU4U%ô$õdTEôtôÄDTåôÔ5DU%ôäEõ$U$U4TåDD•dUõ55ô54UBrÂ&÷fVDvöÆFVäÖ7FW$FV6—6–öäÆö6³¢W†7EF„&–æF–ætB‚t„TBrÂ3$&÷fVD76WE6÷W&6RæÆö6µF‚ÂG'VR’Â&W&W6VçFF—fU746öçG&öÃ¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WE746öçG&öÅF‚ÂG'VR’Â&W&W6VçFF—fTÖæ–fW7C¢W†7EF„&–æF–ætB‚t„TBrÂ3%&W&W6VçFF—fTÖæ–fW7EF‚ÂG'VR’Â&W&W6VçFF—fT6ö×ÆWF–öã¢W†7EF„&–æF–ætB‚t„TBrÂ3%&W&W6VçFF—fTWf–FVæ6UF‡2æ6ö×ÆWF–öâÂG'VR’Ò’bb3$76WEföÇVÖU66÷TÆö6²æFV6—6–öâÓÓÒt5D•dDUõ3%õ%ô54UEõdôÅTÔUõ44õUô4ôåE$5EôôäÅ’rÂw&÷VæB2—2æ÷BW†7FÇ’FW&—fVBg&öÒF†RW6W"Ö&÷fVBvöÆFVâÖ7FW"æB&W&W6VçFF—fR55ô54UBr“°¢76W'B„ö&¦V7BçfÇVW2‡3$76WEföÇVÖU66÷TÆö6²æ&÷VæF&–W2’æWfW'’‡fÇVRÓâfÇVRÓÓÒfÇ6R’Âw&÷VæB2WF†÷&—¦W276WBÂ'VçF–ÖRÂ&VÆV6R÷"FWf–6Rv÷&²r“°¢6öç7B÷Væ–æt6öÖÖ—BÒ3$76WEföÇVÖU66÷T÷Væ–æt6öÖÖ—C°¢76W'DW†7E6–ævÆU&VçB†÷Væ–æt6öÖÖ—BÂ746öÖÖ—BÂw&÷VæBC266÷RÖ6öçG&7B÷Væ–ærr“°¢76W'DW†7D6†ævVEF‡2‡746öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂW‡V7FVE3$76WEföÇVÖU66÷T÷Væ–æuw&—FW2Âw&÷VæBC2FöÖ–266÷RÖ6öçG&7B÷Væ–ærr“°¢76W'B†f—'7DFD6öÖÖ—B‡3$76WEföÇVÖU66÷T6öçG&öÅF‚’ÓÓÒ÷Væ–æt6öÖÖ—Bbbf—'7DFD6öÖÖ—B‡3$76WEföÇVÖU66÷TÆö6µF‚’ÓÓÒ÷Væ–æt6öÖÖ—BÂw&÷VæBC26öçG&öÂö7F—fF–öâ&V6÷&BvW&Ræ÷Bf—'7BFFVBFöÖ–6ÆÇ’r“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖU66÷T6öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“²76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖU66÷TÆö6µF‚Â÷Væ–æt6öÖÖ—B“°¢6öç7B÷Væ–ætFFRÒv—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ÷Væ–æt6öÖÖ—EÒ’ç6Æ–6RƒÂ“°¢76W'B‡3$76WEföÇVÖU66÷TÆö6²æ7&VFVDBÓÓÒ÷Væ–ætFFRbb3$76WEföÇVÖU66÷T6öçG&öÂæ7&VFVDBÓÓÒ÷Væ–ætFFRÂw&÷VæB2óC27F—fF–öâFFRF–ffW'2g&öÒ—G2W†7B÷Væ–ær6öÖÖ—Br“°¢6öç7B&÷VæCC4f÷&&–FFVâÒ²ââææWr6WB…²ââæW‡V7FVE3%$f÷&&–FFVåw&—FW2ÂââæW‡V7FVE3%$ÆÆ÷vVEw&—FW2Âw7FWB÷3"ö76WB×&öGV7F–öâ×"÷föÇVÖR×&÷VæBÓò¢¢uÒ•Òæf–ÇFW"†f–ÆRÓâW‡V7FVE3$76WEföÇVÖU66÷TÆÆ÷vVEw&—FW2æ–æ6ÇVFW2†f–ÆR’“°¢76W'B‡3$76WEföÇVÖU66÷T6öçG&öÂç66†VÖfW'6–öâÓÓÒbb3$76WEföÇVÖU66÷T6öçG&öÂæ'F–f7D–BÓÓÒv6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓC2rbb—46æöæ–6Ä—6ôFFR‡3$76WEföÇVÖU66÷T6öçG&öÂæ7&VFVDB’bb3$76WEföÇVÖU66÷T6öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3$76WEföÇVÖU66÷T6öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb3$76WEföÇVÖU66÷T6öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ3$76WE746öçG&öÅF‚bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷T6öçG&öÂæVçG'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢746öÖÖ—BÂG&VS¢75G&VRÒ’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷T6öçG&öÂæv÷fW&ææ6T7F—fF–öâ’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TÆö6µF‚’’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷T6öçG&öÂæ&÷fVE&W&W6VçFF—fR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE&W&W6VçFF—fR’Âw&÷VæBC2WF†÷&—G’ÂVçG'’Â7F—fF–öâ÷"&W&W6VçFF—fR&–æF–ærÖ—6ÖF6‚r“°¢76W'B‡3$76WEföÇVÖU66÷T6öçG&öÂç7FGW2ÓÓÒt”åõ$ôu$U52rbb3$76WEföÇVÖU66÷T6öçG&öÂçfW&F–7BÓÓÒt”åõ$ôu$U55õ3%õ%õdôÅTÔUõ44õUô4ôåE$5Brbb3$76WEföÇVÖU66÷T6öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb3$76WEföÇVÖU66÷T6öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"Õ"Ô54UBÕ$ôET5D”ôârbb3$76WEföÇVÖU66÷T6öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6Rbb3$76WEföÇVÖU66÷T6öçG&öÂç66÷RÓÓÒu3%õ%ô54UEõdôÅTÔUõ44õUô4ôåE$5EôôäÅ•ôäõô54UEô%•DU5ôäõõ%TåD”ÔRrÂw&÷VæBC2†6R÷66÷R÷fW&F–7BÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷T6öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE3$76WEföÇVÖU66÷TÆÆ÷vVEw&—FW2’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷T6öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’‡&÷VæCC4f÷&&–FFVâ’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷T6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²66÷T6öçG&7E&VG“¢fÇ6RÂ76WD'—FW4WF†÷&—¦VC¢fÇ6RÂ76WEföÇVÖTÆÆ÷vVC¢fÇ6RÂ'VçF–ÖT–çFVw&F–öäÆÆ÷vVC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÂÖ†–×VÕfW&F–7C¢u$TE•ôdõ%õ3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôåô5D•dD”ôârÒ’Âw&÷VæBC2w&—FR÷"6ö×ÆWF–öâ&÷VæF'’—2Vç6fRr“°¢76W'B‡3$76WEföÇVÖU66÷T6öçG&öÂæVçG'•v÷&¶fÆ÷ræ6öÖÖ—BÓÓÒ746öÖÖ—Bbb3$76WEföÇVÖU66÷T6öçG&öÂæVçG'•v÷&¶fÆ÷rçG&VRÓÓÒ75G&VRÂw&÷VæBC2VçG'’v÷&¶fÆ÷rF&vWBÖ—6ÖF6‚r“°¢76W'Ev÷&¶fÆ÷tWf–FVæ6T¶W—2‡3$76WEföÇVÖU66÷T6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæBC2VçG'’v÷&¶fÆ÷rrÂG'VR“²&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R‡3$76WEföÇVÖU66÷T6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæBC2VçG'’r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂW‡V7FVE&÷VæCC4Fö7VÖVçEFW‡BÂw&÷VæBC2÷Væ–ærFö7VÖVçG2r“°¢–b‚W†—7G2‡3$76WEföÇVÖT6öçG&7EF‚’’°¢76W'B‚ö&¦V7BçfÇVW2‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2’ç6öÖR†W†—7G2’bb3$76WEföÇVÖT6öçG&öÂÂw&÷VæBC2Wf–FVæ6R÷"7V66W76÷"W†—7G2&Vf÷&R—G2–Ö×WF&ÆR66÷R6öçG&7Br“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’†÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3$76WEföÇVÖU66÷T6öçG&öÂÂw&÷VæBC2&RÖ6öçG&7B66÷RFW6–vârÂ"¢#B¢#BÂB¢#B¢#BÂ3"Â‚¢#B¢#BÂ3"“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂW‡V7FVD&÷fVE&W&W6VçFF—fRÂ6ö×ÆWFS¢fÇ6RÓ°¢Ð¢6öç7B6öçG&7D6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3$76WEföÇVÖT6öçG&7EF‚“°¢76W'DW†7E6–ævÆU&VçB†6öçG&7D6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂw&÷VæBC266÷R6öçG&7B6öçFVçBr“°¢76W'DW†7D6†ævVEF‡2†÷Væ–æt6öÖÖ—BÂ6öçG&7D6öÖÖ—BÂ·3$76WEföÇVÖT6öçG&7EF…ÒÂw&÷VæBC266÷R6öçG&7B6öçFVçBr“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖT6öçG&7EF‚Â6öçG&7D6öÖÖ—B“°¢6öç7B6öçG&7E&ööbÒfW&–g•3$76WEföÇVÖU66÷T6öçG&7B†§6öâ‡3$76WEföÇVÖT6öçG&7EF‚’Â6öçG&7D6öÖÖ—BÂW‡V7FVD&÷fVE&W&W6VçFF—fR“°¢6öç7BWf–FVæ6U6WVVæ6RÒö&¦V7BçfÇVW2‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2“°¢76W'B†Wf–FVæ6U6WVVæ6RæWfW'’†W†—7G2’Âw&÷VæBC266÷R6öçG&7BW†—7G2v—F†÷WB—G26ö×ÆWFR66WFæ6RöfV6–&–Æ—G’ö7&—F–2ö§VFvRö6ö×ÆWF–öâ6†–âr“°¢6öç7B6öçG&7D&–æF–ærÒW†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖT6öçG&7EF‚ÂG'VR“²6öç7BF&vWBÒ²6öÖÖ—C¢6öçG&7D6öÖÖ—BÂG&VS¢6öçG&7E&ööbæ6öçG&7EG&VRÓ°¢6öç7BW‡V7FVD6†V6·2Ò3$76WEföÇVÖU66÷T7&—FW&–öä–G2æÖ†–BÓâ‡²–BÂ7FGW3¢u52rÒ’“°¢6öç7B66WFæ6RÒ§6öâ‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ66WFæ6TÖG&—‚“°¢76W'DW†7D¶W•6WB†66WFæ6RÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvVF—EF&vWBrÂv6öçG&7BrÂv7&—FW&–rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC266÷R66WFæ6Rr“°¢76W'DW†7D¶W•6WB†66WFæ6RæVF—EF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂw&÷VæBC266WFæ6RF&vWBr“²76W'DW†7D¶W•6WB†66WFæ6RçVç&W6öÇfVBÂ²urÂuuÒÂw&÷VæBC266WFæ6RVç&W6öÇfVBr“°¢76W'B†66WFæ6Rç66†VÖfW'6–öâÓÓÒbb66WFæ6Ræ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"Ö76WB×föÇVÖR×66÷RÖ66WFæ6RÖÖG&—‚×&÷VæBÓrbb66WFæ6Rç&W÷6—F÷'’ÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÂç&W÷6—F÷'’bb66WFæ6Ræ'&æ6‚ÓÓÒv¶–Ö’rbb66WFæ6Ræ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†66WFæ6RæVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWB’bb¥4ôâç7G&–æv–g’†66WFæ6Ræ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb¥4ôâç7G&–æv–g’†66WFæ6Ræ7&—FW&–’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD6†V6·2’bb¥4ôâç7G&–æv–g’†66WFæ6RçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb66WFæ6RçfW&F–7BÓÓÒu55õ3%õ%õdôÅTÔUõ44õUô44UDä4Rrbb66WFæ6RæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%õdôÅTÔUõ44õUôdT4”$”Ä•E•ôTD•BrÂw&÷VæBC266÷R66WFæ6RÖ—6ÖF6‚÷"÷fW&6Æ–Òr“°¢6öç7B66WFæ6T6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ66WFæ6TÖG&—‚“²76W'DW†7E6–ævÆU&VçB†66WFæ6T6öÖÖ—BÂ6öçG&7D6öÖÖ—BÂw&÷VæBC266÷R66WFæ6Rr“²76W'DW†7D6†ævVEF‡2†6öçG&7D6öÖÖ—BÂ66WFæ6T6öÖÖ—BÂ·3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ66WFæ6TÖG&—…ÒÂw&÷VæBC266÷R66WFæ6Rr“²76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ66WFæ6TÖG&—‚Â66WFæ6T6öÖÖ—B“°¢6öç7BfV6–&–Æ—G’Ò§6öâ‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æfV6–&–Æ—G”VF—B“°¢76W'DW†7D¶W•6WB†fV6–&–Æ—G’Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvVF—EF&vWBrÂv6öçG&7BrÂv66WFæ6TÖG&—‚rÂv6†V6·2rÂw&—6·2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC266÷RfV6–&–Æ—G’r“²76W'DW†7D¶W•6WB†fV6–&–Æ—G’çVç&W6öÇfVBÂ²urÂuuÒÂw&÷VæBC266÷RfV6–&–Æ—G’Vç&W6öÇfVBr“°¢6öç7BW‡V7FVE&—6·2Ò3$76WEföÇVÖU66÷U&W6öÇfVDf–æF–æw2æÖ‚‡²–BÂ6WfW&—G’Â&W6öÇfVBÒ’Óâ‡²–BÂ6WfW&—G’Â&W6öÇfVBÒ’“°¢76W'B†fV6–&–Æ—G’ç66†VÖfW'6–öâÓÓÒbbfV6–&–Æ—G’æ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"Ö76WB×föÇVÖR×66÷RÖfV6–&–Æ—G’ÖVF—B×&÷VæBÓrbbfV6–&–Æ—G’ç&W÷6—F÷'’ÓÓÒ66WFæ6Rç&W÷6—F÷'’bbfV6–&–Æ—G’æ'&æ6‚ÓÓÒv¶–Ö’rbbfV6–&–Æ—G’æ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWB’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æ66WFæ6TÖG&—‚’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ66WFæ6TÖG&—‚’’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’æ6†V6·2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD6†V6·2’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’ç&—6·2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE&—6·2’bb¥4ôâç7G&–æv–g’†fV6–&–Æ—G’çVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bbfV6–&–Æ—G’çfW&F–7BÓÓÒu55õ3%õ%õdôÅTÔUõ44õUôdT4”$”Ä•E’rbbfV6–&–Æ—G’æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%õdôÅTÔUõ44õUô”äDUTäDTåEô5$•D”2rÂw&÷VæBC2fV6–&–Æ—G’Ö—6ÖF6‚÷"÷fW&6Æ–Òr“°¢6öç7BfV6–&–Æ—G”6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æfV6–&–Æ—G”VF—B“²76W'DW†7E6–ævÆU&VçB†fV6–&–Æ—G”6öÖÖ—BÂ66WFæ6T6öÖÖ—BÂw&÷VæBC266÷RfV6–&–Æ—G’r“²76W'DW†7D6†ævVEF‡2†66WFæ6T6öÖÖ—BÂfV6–&–Æ—G”6öÖÖ—BÂ·3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æfV6–&–Æ—G”VF—EÒÂw&÷VæBC266÷RfV6–&–Æ—G’r“²76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æfV6–&–Æ—G”VF—BÂfV6–&–Æ—G”6öÖÖ—B“°¢6öç7B7&—F–2Ò§6öâ‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ7&—F–2“°¢76W'DW†7D¶W•6WB†7&—F–2Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvVF—EF&vWBrÂv6öçG&7BrÂv66WFæ6TÖG&—‚rÂvfV6–&–Æ—G”VF—BrÂvÆVç6W2rÂvf–æF–æw2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC266÷R7&—F–2r“²76W'DW†7D¶W•6WB†7&—F–2çVç&W6öÇfVBÂ²urÂuuÒÂw&÷VæBC27&—F–2Vç&W6öÇfVBr“°¢6öç7BÆVç6W2Ò²t”ÕÄTÔTåDD”ôârÂt%EôD•$T5D”ôârÂtä”ÔD”ôârÂu$U5ôå4•dRrÂt44U54”$”Ä•E’rÂt54UEõ•TÄ”äRrÂt%TDtUBrÂu%TåD”ÔUô$õTäD%’uÒæÖ†–BÓâ‡²–BÂ7FGW3¢u52rÒ’“°¢76W'B†7&—F–2ç66†VÖfW'6–öâÓÓÒbb7&—F–2æ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"Ö76WB×föÇVÖR×66÷RÖ–æFWVæFVçBÖ7&—F–2×&÷VæBÓrbb7&—F–2ç&W÷6—F÷'’ÓÓÒ66WFæ6Rç&W÷6—F÷'’bb7&—F–2æ'&æ6‚ÓÓÒv¶–Ö’rbb7&—F–2æ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†7&—F–2æVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWB’bb¥4ôâç7G&–æv–g’†7&—F–2æ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb¥4ôâç7G&–æv–g’†7&—F–2æ66WFæ6TÖG&—‚’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ66WFæ6TÖG&—‚’’bb¥4ôâç7G&–æv–g’†7&—F–2æfV6–&–Æ—G”VF—B’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æfV6–&–Æ—G”VF—B’’bb¥4ôâç7G&–æv–g’†7&—F–2æÆVç6W2’ÓÓÒ¥4ôâç7G&–æv–g’†ÆVç6W2’bb¥4ôâç7G&–æv–g’†7&—F–2æf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷U&W6öÇfVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†7&—F–2çVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb7&—F–2çfW&F–7BÓÓÒu55õ3%õ%õdôÅTÔUõ44õUô”äDUTäDTåEô5$•D”2rbb7&—F–2æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%õdôÅTÔUõ44õUôd”äÅô¥TDtRrÂw&÷VæBC27&—F–2Ö—6ÖF6‚÷"õ&VÖ–ç2r“°¢6öç7B7&—F–46öÖÖ—BÒf—'7DFD6öÖÖ—B‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ7&—F–2“²76W'DW†7E6–ævÆU&VçB†7&—F–46öÖÖ—BÂfV6–&–Æ—G”6öÖÖ—BÂw&÷VæBC266÷R7&—F–2r“²76W'DW†7D6†ævVEF‡2†fV6–&–Æ—G”6öÖÖ—BÂ7&—F–46öÖÖ—BÂ·3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ7&—F–5ÒÂw&÷VæBC266÷R7&—F–2r“²76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ7&—F–2Â7&—F–46öÖÖ—B“°¢6öç7B§VFvRÒ§6öâ‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æf–æÄ§VFvR“°¢76W'DW†7D¶W•6WB†§VFvRÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvVF—EF&vWBrÂv6öçG&7BrÂv7&—F–2rÂvf–æF–æw2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC266÷R§VFvRr“²76W'DW†7D¶W•6WB†§VFvRçVç&W6öÇfVBÂ²urÂuuÒÂw&÷VæBC2§VFvRVç&W6öÇfVBr“°¢76W'B†§VFvRç66†VÖfW'6–öâÓÓÒbb§VFvRæ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"Ö76WB×föÇVÖR×66÷RÖf–æÂÖ§VFvR×&÷VæBÓrbb§VFvRç&W÷6—F÷'’ÓÓÒ66WFæ6Rç&W÷6—F÷'’bb§VFvRæ'&æ6‚ÓÓÒv¶–Ö’rbb§VFvRæ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†§VFvRæVF—EF&vWB’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWB’bb¥4ôâç7G&–æv–g’†§VFvRæ6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†6öçG&7D&–æF–ær’bb¥4ôâç7G&–æv–g’†§VFvRæ7&—F–2’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ7&—F–2’’bb¥4ôâç7G&–æv–g’†§VFvRæf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’‡3$76WEföÇVÖU66÷U&W6öÇfVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†§VFvRçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb§VFvRçfW&F–7BÓÓÒu55õ3%õ%õdôÅTÔUõ44õUôd”äÅô¥TDtRrbb§VFvRæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%õdôÅTÔUõ44õUô4ôÕÄUD”ôârÂw&÷VæBC2f–æÂ§VFvRÖ—6ÖF6‚÷"÷fW&6Æ–Òr“°¢6öç7B§VFvT6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æf–æÄ§VFvR“²76W'DW†7E6–ævÆU&VçB†§VFvT6öÖÖ—BÂ7&—F–46öÖÖ—BÂw&÷VæBC266÷R§VFvRr“²76W'DW†7D6†ævVEF‡2†7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ·3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æf–æÄ§VFvUÒÂw&÷VæBC266÷R§VFvRr“²76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æf–æÄ§VFvRÂ§VFvT6öÖÖ—B“°¢6öç7B6ö×ÆWF–öâÒ§6öâ‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ6ö×ÆWF–öâ“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&–f–VD6öçG&7BrÂvf–æÄ§VFvRrÂwVç&W6öÇfVBrÂv&÷VæF&–W2rÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBC266÷R6ö×ÆWF–öâr“²76W'DW†7D¶W•6WB†6ö×ÆWF–öâçVç&W6öÇfVBÂ²urÂuuÒÂw&÷VæBC26ö×ÆWF–öâVç&W6öÇfVBr“°¢6öç7B6ö×ÆWF–öä&÷VæF&–W2Ò²76WD'—FW4WF†÷&—¦VC¢fÇ6RÂ76WEföÇVÖTÆÆ÷vVC¢fÇ6RÂ'VçF–ÖT–çFVw&F–öäÆÆ÷vVC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÓ°¢76W'B†6ö×ÆWF–öâç66†VÖfW'6–öâÓÓÒbb6ö×ÆWF–öâæ'F–f7D–BÓÓÒv6G2×F÷vW"×3"×"Ö76WB×föÇVÖR×66÷RÖ6ö×ÆWF–öâÖWf–FVæ6R×&÷VæBÓrbb6ö×ÆWF–öâç&W÷6—F÷'’ÓÓÒ66WFæ6Rç&W÷6—F÷'’bb6ö×ÆWF–öâæ'&æ6‚ÓÓÒv¶–Ö’rbb6ö×ÆWF–öâæ6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâçfW&–f–VD6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’‡²ââæ6öçG&7D&–æF–ærÂ6öÖÖ—C¢6öçG&7D6öÖÖ—BÂG&VS¢6öçG&7E&ööbæ6öçG&7EG&VRÒ’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæf–æÄ§VFvR’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æf–æÄ§VFvR’’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡²¢Â¢Ò’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâæ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†6ö×ÆWF–öä&÷VæF&–W2’bb6ö×ÆWF–öâçfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôåô5D•dD”ôârbb6ö×ÆWF–öâæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôåô5D•dD”ôârÂw&÷VæBC26ö×ÆWF–öâÖ—6ÖF6‚÷"÷fW&6Æ–Òr“°¢6öç7B6ö×ÆWF–öä6öÖÖ—BÒf—'7DFD6öÖÖ—B‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ6ö×ÆWF–öâ“²76W'DW†7E6–ævÆU&VçB†6ö×ÆWF–öä6öÖÖ—BÂ§VFvT6öÖÖ—BÂw&÷VæBC266÷R6ö×ÆWF–öâr“²76W'DW†7D6†ævVEF‡2†§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ·3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ6ö×ÆWF–öåÒÂw&÷VæBC266÷R6ö×ÆWF–öâr“²76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ6ö×ÆWF–öâÂ6ö×ÆWF–öä6öÖÖ—B“°¢6öç7Bg&VW¦TVæBÒ3$76WEföÇVÖT÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3$76WEföÇVÖT÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’†÷Væ–æt6öÖÖ—BÂg&VW¦TVæBÂ3$76WEföÇVÖU66÷T6öçG&öÂÂw&÷VæBC2W†7B66÷RÖ6öçG&7B†—7F÷'’rÂ"¢#B¢#BÂB¢#B¢#BÂcBÂb¢#B¢#BÂ3"“°¢76W'DæõF„6†ævW56–æ6R†6öçG&7D6öÖÖ—BÂg&VW¦TVæBÂ·3$76WEföÇVÖT6öçG&7EF‚ÂââæWf–FVæ6U6WVVæ6UÒÂw&÷VæBC2–Ö×WF&ÆR6öçG&7BöWf–FVæ6Rg&VW¦Rr“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ6öçG&7D6öÖÖ—BÂ6öçG&7E&ööbÂ6ö×ÆWF–öä6öÖÖ—BÂ&VG”6öÖÖ—C¢6ö×ÆWF–öä6öÖÖ—BÂ&VG•G&VS¢v—B…²w&Wb×'6RrÂG¶6ö×ÆWF–öä6öÖÖ—GÕç·G&VWÖÒ’ÂW‡V7FVD&÷fVE&W&W6VçFF—fRÂ6ö×ÆWFS¢G'VRÓ°§Ð¦6öç7B3$76WEföÇVÖU66÷T†æFöfbÒfW&–g•3$76WEföÇVÖU66÷T†æFöfb‚“° ¦gVæ7F–öâfW&–g•3$76WEföÇVÖU&öGV7F–öä†æFöfb‚’°¢76W'B„&ööÆVâ‡3$76WEföÇVÖT6öçG&öÂ’ÓÓÒ&ööÆVâ‡3$76WEföÇVÖT&÷fÄÆö6²’Âw&÷VæBCB6öçG&öÂæBW†7Bv÷fW&ææ6R7F—fF–öâ&V6÷&B&÷VæBB×W7BV"FöÖ–6ÆÇ’r“°¢–b‚3$76WEföÇVÖT6öçG&öÂ’&WGW&âçVÆÃ°¢76W'B‡3$76WEföÇVÖU66÷T†æFöfcòæ6ö×ÆWFRÂw&÷VæBCB&WV—&W2F†R6ö×ÆWFR–Ö×WF&ÆR&÷VæBC266÷R&Wf–WræB$TE’7F—fF–öâr“°¢6öç7B²6öçG&7E&ööbÂ&VG”6öÖÖ—BÂ&VG•G&VRÒÒ3$76WEföÇVÖU66÷T†æFöfc°¢6öç7B6öçG&7BÒ§6öâ‡3$76WEföÇVÖT6öçG&7EF‚“°¢6öç7B6öçG&7D&–æF–ærÒW†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖT6öçG&7EF‚ÂG'VR“°¢6öç7BW‡V7FVD&÷fVE66÷RÒ°¢66÷T6ö×ÆWF–öä6öÖÖ—C¢&VG”6öÖÖ—BÀ¢66÷T6ö×ÆWF–öåG&VS¢&VG•G&VRÀ¢6öçG&7C¢6öçG&7D&–æF–ærÀ¢f–æÄ§VFvS¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æf–æÄ§VFvRÂG'VR’À¢6ö×ÆWF–öã¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ6ö×ÆWF–öâÂG'VR’À¢6÷W&6T76WEF‡3¢6öçG&7E&ööbç6÷W&6UF‡2À¢FVÆ—fW'”76WEF‡3¢6öçG&7E&ööbæFVÆ—fW'•F‡2À¢Wf–FVæ6UF‡3¢6öçG&7E&ööbæWf–FVæ6UF‡2À¢'VFvWG3¢6öçG&7Bæ'VFvWG0¢Ó°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT&÷fÄÆö6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv&6RrÂvFW&—fF–öârÂvFV6—6–öârÂv7F—fFVD6öçG&7BrÂv&÷VæF&–W2uÒÂw&÷VæBBv÷fW&ææ6R7F—fF–öâ&V6÷&Br“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT&÷fÄÆö6²æ&6RÂ²v†VBrÂwG&VRuÒÂw&÷VæBB&6Rr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT&÷fÄÆö6²æFW&—fF–öâÂ²w'VÆRrÂw66÷T6öçG&7BrÂv66WFæ6TÖG&—‚rÂvfV6–&–Æ—G”VF—BrÂv7&—F–2rÂvf–æÄ§VFvRrÂv6ö×ÆWF–öâuÒÂw&÷VæBBFW&—fF–öâr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT&÷fÄÆö6²æ7F—fFVD6öçG&7BÂ²w66÷T6ö×ÆWF–öä6öÖÖ—BrÂw66÷T6ö×ÆWF–öåG&VRrÂv6öçG&7BrÂvf–æÄ§VFvRrÂv6ö×ÆWF–öârÂw6÷W&6T76WEF‡2rÂvFVÆ—fW'”76WEF‡2rÂvWf–FVæ6UF‡2rÂv'VFvWG2uÒÂw&÷VæBB7F—fFVB6öçG&7Br“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT&÷fÄÆö6²æ&÷VæF&–W2Â²v76WEföÇVÖTÆÆ÷vVBrÂw'VçF–ÖT–çFVw&F–öäÆÆ÷vVBrÂvvÖTFF×WFF–öäÆÆ÷vVBrÂvV6öæö×”×WFF–öäÆÆ÷vVBrÂw6fU66†VÖ×WFF–öäÆÆ÷vVBrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBuÒÂw&÷VæBB&÷VæF&–W2r“°¢76W'B‡3$76WEföÇVÖT&÷fÄÆö6²ç66†VÖfW'6–öâÓÓÒbb3$76WEföÇVÖT&÷fÄÆö6²æ'F–f7D–BÓÓÒv6G2×F÷vW"Öv÷fW&ææ6RÖ7F—fF–öâ×&V6÷&B×&÷VæBÓBrbb—46æöæ–6Ä—6ôFFR‡3$76WEföÇVÖT&÷fÄÆö6²æ7&VFVDB’bb3$76WEföÇVÖT&÷fÄÆö6²ç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3$76WEföÇVÖT&÷fÄÆö6²æ'&æ6‚ÓÓÒv¶–Ö’rÂw&÷VæBB7F—fF–öâ–FVçF—G’Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT&÷fÄÆö6²æ&6R’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT&÷fÄÆö6²æ7F—fFVD6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE66÷R’Âw&÷VæBBFöW2æ÷B&–æBF†RW†7Bõ×¦W&ò&÷VæBC26öçG&7Bf–ævW'&–çBr“°¢6öç7BW‡V7FVE&÷VæCDFW&—fF–öâÒ²'VÆS¢tUDôÔD”5ôU„5EõD…ô5D•dD”ôåôeDU%õ$õTäEóC5õ44õUõõõ¤U$òrÂ66÷T6öçG&7C¢6öçG&7D&–æF–ærÂ66WFæ6TÖG&—ƒ¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ66WFæ6TÖG&—‚ÂG'VR’ÂfV6–&–Æ—G”VF—C¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æfV6–&–Æ—G”VF—BÂG'VR’Â7&—F–3¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ7&—F–2ÂG'VR’Âf–æÄ§VFvS¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æf–æÄ§VFvRÂG'VR’Â6ö×ÆWF–öã¢W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖU66÷TWf–FVæ6UF‡2æ6ö×ÆWF–öâÂG'VR’Ó°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT&÷fÄÆö6²æFW&—fF–öâ’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE&÷VæCDFW&—fF–öâ’bb3$76WEföÇVÖT&÷fÄÆö6²æFV6—6–öâÓÓÒt5D•dDUôU„5Eô4ôåE$5EôTåTÔU$DTEõ3%õ%ô54UEõdôÅTÔUõ$ôET5D”ôârÂw&÷VæBB—2æ÷BW†7FÇ’FW&—fVBg&öÒF†R–æFWVæFVçFÇ’76VB&÷VæBC266÷R6öçG&7Br“°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT&÷fÄÆö6²æ&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’‡²76WEföÇVÖTÆÆ÷vVC¢G'VRÂ'VçF–ÖT–çFVw&F–öäÆÆ÷vVC¢fÇ6RÂvÖTFF×WFF–öäÆÆ÷vVC¢fÇ6RÂV6öæö×”×WFF–öäÆÆ÷vVC¢fÇ6RÂ6fU66†VÖ×WFF–öäÆÆ÷vVC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÒ’Âw&÷VæBB7&÷76W2'VçF–ÖRÂvÖWÆ’Â&VÆV6R÷"FWf–6R&÷VæF'’r“°¢6öç7B÷Væ–æt6öÖÖ—BÒ3$76WEföÇVÖT÷Væ–æt6öÖÖ—C°¢76W'DW†7E6–ævÆU&VçB†÷Væ–æt6öÖÖ—BÂ&VG”6öÖÖ—BÂw&÷VæBCBW†7B76WB×föÇVÖR÷Væ–ærr“°¢76W'DW†7D6†ævVEF‡2‡&VG”6öÖÖ—BÂ÷Væ–æt6öÖÖ—BÂW‡V7FVE3$76WEföÇVÖT÷Væ–æuw&—FW2Âw&÷VæBCBFöÖ–2W†7B76WB×föÇVÖR÷Væ–ærr“°¢76W'B†f—'7DFD6öÖÖ—B‡3$76WEföÇVÖT6öçG&öÅF‚’ÓÓÒ÷Væ–æt6öÖÖ—Bbbf—'7DFD6öÖÖ—B‡3$76WEföÇVÖT&÷fÄÆö6µF‚’ÓÓÒ÷Væ–æt6öÖÖ—BÂw&÷VæBCB6öçG&öÂö7F—fF–öâ&V6÷&BvW&Ræ÷Bf—'7BFFVBFöÖ–6ÆÇ’r“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖT6öçG&öÅF‚Â÷Væ–æt6öÖÖ—B“²76W'DFFVDöæ6TæEVæ6†ævVB‡3$76WEföÇVÖT&÷fÄÆö6µF‚Â÷Væ–æt6öÖÖ—B“°¢6öç7B÷Væ–ætFFRÒv—B…²w6†÷rrÂr×2rÂrÒÖf÷&ÖCÒV4’rÂ÷Væ–æt6öÖÖ—EÒ’ç6Æ–6RƒÂ“°¢76W'B‡3$76WEföÇVÖT&÷fÄÆö6²æ7&VFVDBÓÓÒ÷Væ–ætFFRbb3$76WEföÇVÖT6öçG&öÂæ7&VFVDBÓÓÒ÷Væ–ætFFRÂw&÷VæBBóCB7F—fF–öâFFRF–ffW'2g&öÒ—G2W†7B÷Væ–ær6öÖÖ—Br“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT6öçG&öÂÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂvVçG'’rÂvVçG'•v÷&¶fÆ÷rrÂvv÷fW&ææ6T7F—fF–öârÂv&÷fVD6öçG&7BrÂw7FGW2rÂwfW&F–7BrÂv7W'&VçE&W÷6—F÷'•7FWrÂv–çFW&æÅ†6RrÂv–çFW&æÅ†6T—5&W÷6—F÷'•7FWrÂw66÷RrÂvÆÆ÷vVEw&—FW2rÂvf÷&&–FFVåw&—FW2rÂv6ö×ÆWF–öä&÷VæF'’uÒÂw&÷VæBCB6öçG&öÂr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT6öçG&öÂæVçG'’Â²v†VBrÂwG&VRuÒÂw&÷VæBCBVçG'’r“²76W'DW†7D¶W•6WB‡3$76WEföÇVÖT6öçG&öÂæv÷fW&ææ6T7F—fF–öâÂ²wF‚rÂv&Æö"uÒÂw&÷VæBCB7F—fF–öâ&–æF–ærr“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT6öçG&öÂæ&÷fVD6öçG&7BÂ²w66÷T6ö×ÆWF–öä6öÖÖ—BrÂw66÷T6ö×ÆWF–öåG&VRrÂv6öçG&7BrÂvf–æÄ§VFvRrÂv6ö×ÆWF–öârÂw6÷W&6T76WEF‡2rÂvFVÆ—fW'”76WEF‡2rÂvWf–FVæ6UF‡2rÂv'VFvWG2uÒÂw&÷VæBCB&÷fVB6öçG&7Br“°¢76W'DW†7D¶W•6WB‡3$76WEföÇVÖT6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’Â²v76WEföÇVÖTÆÆ÷vVBrÂw6÷W&6T76WE&öGV7F–öäÆÆ÷vVBrÂvFVÆ—fW'”76WE&öGV7F–öäÆÆ÷vVBrÂw'VçF–ÖT–çFVw&F–öäÆÆ÷vVBrÂvvÖTFF×WFF–öäÆÆ÷vVBrÂw7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öä76WG4&÷fVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂvÖ†–×VÕfW&F–7BuÒÂw&÷VæBCB6ö×ÆWF–öâ&÷VæF'’r“°¢6öç7BW‡V7FVE&÷VæCCDÆÆ÷vVEw&—FW2Ò²ââæ6öçG&7E&ööbæFW&—fVDÆÆ÷vVEw&—FW2ÂââæW‡V7FVE3%&VG”7F—fF–öåw&—FW5Ó°¢76W'B†æWr6WB†W‡V7FVE&÷VæCCDÆÆ÷vVEw&—FW2’ç6—¦RÓÓÒW‡V7FVE&÷VæCCDÆÆ÷vVEw&—FW2æÆVæwF‚Âw&÷VæBCB6öçG&7BÖFW&—fVBÆÆ÷vÆ—7B6öçF–ç2GWÆ–6FRF‡2r“°¢6öç7BW‡V7FVE&÷VæCCDf÷&&–FFVåw&—FW2Ò²ââææWr6WB…²ââæW‡V7FVE3%$f÷&&–FFVåw&—FW2ÂââæW‡V7FVE3%$ÆÆ÷vVEw&—FW2Â3$76WEföÇVÖT6öçG&7EF‚Âââäö&¦V7BçfÇVW2‡3$76WEföÇVÖU66÷TWf–FVæ6UF‡2’Â3$76WEföÇVÖU66÷T6öçG&öÅF‚Â3$76WEföÇVÖU66÷TÆö6µF‚Â3$76WEföÇVÖT6öçG&öÅF‚Â3$76WEföÇVÖT&÷fÄÆö6µF…Ò•Òæf–ÇFW"†f–ÆRÓâW‡V7FVE&÷VæCCDÆÆ÷vVEw&—FW2æ–æ6ÇVFW2†f–ÆR’“°¢76W'B‡3$76WEföÇVÖT6öçG&öÂç66†VÖfW'6–öâÓÓÒbb3$76WEföÇVÖT6öçG&öÂæ'F–f7D–BÓÓÒv6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓCBrbb—46æöæ–6Ä—6ôFFR‡3$76WEföÇVÖT6öçG&öÂæ7&VFVDB’bb3$76WEföÇVÖT6öçG&öÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb3$76WEföÇVÖT6öçG&öÂæ'&æ6‚ÓÓÒv¶–Ö’rbb3$76WEföÇVÖT6öçG&öÂç&VçD6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT6öçG&öÂæVçG'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²†VC¢&VG”6öÖÖ—BÂG&VS¢&VG•G&VRÒ’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT6öçG&öÂæv÷fW&ææ6T7F—fF–öâ’ÓÓÒ¥4ôâç7G&–æv–g’†W†7EF„&–æF–ætB‚t„TBrÂ3$76WEföÇVÖT&÷fÄÆö6µF‚’’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT6öçG&öÂæ&÷fVD6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD&÷fVE66÷R’Âw&÷VæBCBWF†÷&—G’ÂVçG'’Â7F—fF–öâ÷"6öçG&7B&–æF–ærÖ—6ÖF6‚r“°¢76W'B‡3$76WEföÇVÖT6öçG&öÂç7FGW2ÓÓÒt”åõ$ôu$U52rbb3$76WEföÇVÖT6öçG&öÂçfW&F–7BÓÓÒt”åõ$ôu$U55õ3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôârbb3$76WEföÇVÖT6öçG&öÂæ7W'&VçE&W÷6—F÷'•7FWÓÓÒBbb3$76WEföÇVÖT6öçG&öÂæ–çFW&æÅ†6RÓÓÒu3"Õ"Ô54UBÕ$ôET5D”ôârbb3$76WEföÇVÖT6öçG&öÂæ–çFW&æÅ†6T—5&W÷6—F÷'•7FWÓÓÒfÇ6Rbb3$76WEföÇVÖT6öçG&öÂç66÷RÓÓÒu3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôåôôäÅ•ôäõõ%TåD”ÔRrÂw&÷VæBCB†6R÷66÷R÷fW&F–7BÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT6öçG&öÂæÆÆ÷vVEw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE&÷VæCCDÆÆ÷vVEw&—FW2’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT6öçG&öÂæf÷&&–FFVåw&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE&÷VæCCDf÷&&–FFVåw&—FW2’bb¥4ôâç7G&–æv–g’‡3$76WEföÇVÖT6öçG&öÂæ6ö×ÆWF–öä&÷VæF'’’ÓÓÒ¥4ôâç7G&–æv–g’‡²76WEföÇVÖTÆÆ÷vVC¢G'VRÂ6÷W&6T76WE&öGV7F–öäÆÆ÷vVC¢G'VRÂFVÆ—fW'”76WE&öGV7F–öäÆÆ÷vVC¢G'VRÂ'VçF–ÖT–çFVw&F–öäÆÆ÷vVC¢fÇ6RÂvÖTFF×WFF–öäÆÆ÷vVC¢fÇ6RÂ7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆÆ÷vVC¢fÇ6RÂ&öGV7F–öä76WG4&÷fVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÂÖ†–×VÕfW&F–7C¢u$TE•ôdõ%õ3%õ5õ%TåD”ÔUô”åDTu$D”ôåõ44õUõ$Ud”UrrÒ’Âw&÷VæBCBw&—FR÷"6ö×ÆWF–öâ&÷VæF'’—2Vç6fRr“°¢76W'B‡3$76WEföÇVÖT6öçG&öÂæVçG'•v÷&¶fÆ÷ræ6öÖÖ—BÓÓÒ&VG”6öÖÖ—Bbb3$76WEföÇVÖT6öçG&öÂæVçG'•v÷&¶fÆ÷rçG&VRÓÓÒ&VG•G&VRÂw&÷VæBCBVçG'’v÷&¶fÆ÷rF&vWBÖ—6ÖF6‚r“²76W'Ev÷&¶fÆ÷tWf–FVæ6T¶W—2‡3$76WEföÇVÖT6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæBCBVçG'’v÷&¶fÆ÷rrÂG'VR“²&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R‡3$76WEföÇVÖT6öçG&öÂæVçG'•v÷&¶fÆ÷rÂw&÷VæBCBVçG'’r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†÷Væ–æt6öÖÖ—BÂW‡V7FVE&÷VæCCDFö7VÖVçEFW‡BÂw&÷VæBCB÷Væ–ærFö7VÖVçG2r“°¢6öç7B&F6…&ööbÒfW&–g•3$76WEföÇVÖT&F6†W2‡²÷Væ–æt6öÖÖ—BÂ6öçG&7BÂ6öçG&7E&ööbÒ“°¢6öç7B†VBÒv—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’†÷Væ–æt6öÖÖ—BÂ†VBÂ3$76WEföÇVÖT6öçG&öÂÂw&÷VæBCBW†7B6öçG&7BÖFW&—fVB76WB&öGV7F–öârÂb¢#B¢#BÂƒ¢#B¢#BÂScÂSCB¢#B¢#BÂ#Sb“°¢–b‚&F6…&ööbæ6ö×ÆWFR’°¢76W'B††VBÓÓÒ&F6…&ööbç&VFV6W76÷"Âw&÷VæBCB7W'&VçBF–Â6öçF–ç2âVç&Wf–WvVB6öÖÖ—BgFW"F†RÆ7B6ö×ÆWFR76WB&F6‚r“°¢76W'DæõF„6†ævW56–æ6R†÷Væ–æt6öÖÖ—BÂ†VBÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæBCBÖ—'&÷'26†ævVB&Vf÷&RWfW'’W†7B76WB&F6‚76VBr“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ6öçG&7BÂ6öçG&7E&ööbÂW‡V7FVE&÷VæCCDÆÆ÷vVEw&—FW2Â&F6…&ööbÂ&VG”6öÖÖ—C¢çVÆÂÂ&VG•G&VS¢çVÆÂÓ°¢Ð¢6öç7B&VG”7F—fF–öä6öÖÖ—BÒ†VC°¢76W'DW†7E6–ævÆU&VçB‡&VG”7F—fF–öä6öÖÖ—BÂ&F6…&ööbç&VFV6W76÷"Âw&÷VæBCBf–æÂ$TE’7F—fF–öâr“°¢76W'DW†7D6†ævVEF‡2†&F6…&ööbç&VFV6W76÷"Â&VG”7F—fF–öä6öÖÖ—BÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæBCBf–æÂ$TE’7F—fF–öâr“°¢76W'DæõF„6†ævW56–æ6R†÷Væ–æt6öÖÖ—BÂ&F6…&ööbç&VFV6W76÷"ÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæBCBÖ—'&÷'26†ævVB&Vf÷&RF†RFVF–6FVBf–æÂ$TE’7F—fF–öâr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‡&VG”7F—fF–öä6öÖÖ—BÂW‡V7FVE&÷VæCCE&VG”Fö7VÖVçEFW‡BÂw&÷VæBCBf–æÂ$TE’Fö7VÖVçG2r“°¢&WGW&â²÷Væ–æt6öÖÖ—BÂ6öçG&7BÂ6öçG&7E&ööbÂW‡V7FVE&÷VæCCDÆÆ÷vVEw&—FW2Â&F6…&ööbÂ&VG”6öÖÖ—C¢&VG”7F—fF–öä6öÖÖ—BÂ&VG•G&VS¢v—B…²w&Wb×'6RrÂG·&VG”7F—fF–öä6öÖÖ—GÕç·G&VWÖÒ’Ó°§Ð¦6öç7B3$76WEföÇVÖU&öGV7F–öä†æFöfbÒfW&–g•3$76WEföÇVÖU&öGV7F–öä†æFöfb‚“° ¦–b‡3$76WEföÇVÖT6öçG&öÂ’°¢76W'B‡3$76WEföÇVÖU&öGV7F–öä†æFöfbbbWF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚Âw&÷VæBCBWF†÷&—G’7FFR÷"W†7B6öçG&7BÖFW&—fVB†æFöfbÖ—6ÖF6‚r“°¢6öç7B&÷VæCCDW‡V7FVE7FGW2Ò3$76WEföÇVÖU&öGV7F–öä†æFöfbç&VG”6öÖÖ—Bòu$TE•ôdõ%õ3%õ5õ%TåD”ÔUô”åDTu$D”ôåõ44õUõ$Ud”Urr¢t”åõ$ôu$U55õ3%õ%ôU„5Eô54UEõdôÅTÔUõ$ôET5D”ôâs°¢76W'B†WF†÷&—G’ç7FGW2ÓÓÒ&÷VæCCDW‡V7FVE7FGW2Âw&÷VæBCBWF†÷&—G’fW&F–7BF–ffW'2g&öÒ—G2W†7B6ö×ÆWFVBÖ&F6‚F–Âr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂ3$76WEföÇVÖU&öGV7F–öä†æFöfbç&VG”6öÖÖ—BòW‡V7FVE&÷VæCCE&VG”Fö7VÖVçEFW‡B¢W‡V7FVE&÷VæCCDFö7VÖVçEFW‡BÂw&÷VæBCB7W'&VçBFö7VÖVçG2r“°§ÒVÇ6R–b‡3$76WEföÇVÖU66÷T6öçG&öÂ’°¢76W'B‡3$76WEföÇVÖU66÷T†æFöfbbbWF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚bbWF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õ%õdôÅTÔUõ44õUô4ôåE$5BrÂw&÷VæBC2WF†÷&—G’7FFR÷"W†7B66÷R6†–âÖ—6ÖF6‚r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæCC4Fö7VÖVçEFW‡BÂw&÷VæBC27W'&VçBFö7VÖVçG2r“°§ÒVÇ6R–b‡3$76WE746öçG&öÂ’°¢76W'B‡3%&W&W6VçFF—fT76WE72bbWF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3$76WE746öçG&öÅF‚bbWF†÷&—G’ç7FGW2ÓÓÒu55õ3%õ%õ$U$U4TåDD•dUô54UBrÂw&÷VæBC"WF†÷&—G’7FFR÷"&ööbÖ—6ÖF6‚r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæCC$Fö7VÖVçEFW‡BÂw&÷VæBC"7W'&VçBFö7VÖVçG2r“°§ÒVÇ6R–b‡3%F†—&E&Wf—6VE$6öçG&öÂ’°¢76W'B†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%F†—&E&Wf—6VE$6öçG&öÅF‚bbWF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârÂw&÷VæBCWF†÷&—G’7FFRÖ—6ÖF6‚r“°¢76W'B‡3%F†—&E&Wf—6VE$&÷fÂÂv7F—fR&÷VæBCÆ6·2W†7B&÷fÂ†æFöfbr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÄ&÷fÄFö7VÖVçEFW‡B†f–ÆRÂ3%F†—&E&Wf—6–öäFö7VÖVçD6öæf–r’Âw&÷VæBC7W'&VçBFö7VÖVçG2r“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%F†—&E&Wf—6VE$&÷fÂæ÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%F†—&E&Wf—6VE$6öçG&öÂÂw&÷VæBC&W&W6VçFF—fR76WB&ööbr“°§ÒVÇ6R–b‡3%F†—&E&Wf—6–öä6öçG&öÂ’°¢76W'B†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%F†—&E&Wf—6–öä6öçG&öÅF‚bb²t”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôârÂu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UruÒæ–æ6ÇVFW2†WF†÷&—G’ç7FGW2’Âw&÷VæBCWF†÷&—G’7FFRÖ—6ÖF6‚r“°¢76W'B‡3%F†—&E&Wf—6–öä†æFöfbÂv7F—fR&÷VæBCÆ6·2W†7B&Wf—6–öâ†æFöfbr“°¢76W'E3$†—7F÷'•v—F„–æ7&VÖVçFÅ&VæWvÇ2‡3%F†—&E&Wf—6–öä†æFöfbæ÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%F†—&E&Wf—6–öä6öçG&öÂÂw&÷VæBCW†7BW6W"&Wf—6–öâæB&÷VæBBWf–FVæ6RrÂsBr“°§ÒVÇ6R–b‡3%6V6öæE&Wf—6VE$6öçG&öÂ’°¢76W'B†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%6V6öæE&Wf—6VE$6öçG&öÅF‚bbWF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârÂw&÷VæB3’WF†÷&—G’7FFRÖ—6ÖF6‚r“°¢76W'B‡3%6V6öæE&Wf—6VE$&÷fÂÂv7F—fR&÷VæB3’Æ6·2W†7B&÷fÂ†æFöfbr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÄ&÷fÄFö7VÖVçEFW‡B†f–ÆRÂ3%6V6öæE&Wf—6–öäFö7VÖVçD6öæf–r’Âw&÷VæB3’7W'&VçBFö7VÖVçG2r“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%6V6öæE&Wf—6VE$&÷fÂæ÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%6V6öæE&Wf—6VE$6öçG&öÂÂw&÷VæB3’&W&W6VçFF—fR76WB&ööbr“°§ÒVÇ6R–b‡3%6V6öæE&Wf—6–öä6öçG&öÂ’°¢76W'B†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%6V6öæE&Wf—6–öä6öçG&öÅF‚bb²t”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôârÂu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UruÒæ–æ6ÇVFW2†WF†÷&—G’ç7FGW2’Âw&÷VæB3‚WF†÷&—G’7FFRÖ—6ÖF6‚r“°¢76W'B‡3%6V6öæE&Wf—6–öä†æFöfbÂv7F—fR&÷VæB3‚Æ6·2W†7B&Wf—6–öâ†æFöfbr“°¢76W'E3$†—7F÷'•v—F„–æ7&VÖVçFÅ&VæWvÇ2‡3%6V6öæE&Wf—6–öä†æFöfbæ÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%6V6öæE&Wf—6–öä6öçG&öÂÂw&÷VæB3‚W†7BW6W"&Wf—6–öâæB&÷VæB2Wf–FVæ6RrÂs2r“°§ÒVÇ6R–b‡3%$6öçG&öÂ’°¢76W'B†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%$6öçG&öÅF‚bbWF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârÂw&÷VæB3RWF†÷&—G’7FFRÖ—6ÖF6‚r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3TFö7VÖVçEFW‡BÂw&÷VæB3R7W'&VçBFö7VÖVçG2r“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%$&÷fÂæ÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%$6öçG&öÂÂw&÷VæB3R&W&W6VçFF—fR76WB&ööbr“°§ÒVÇ6R–b‡3%&Wf—6VE$6öçG&öÂ’°¢76W'B†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&Wf—6VE$6öçG&öÅF‚bbWF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õ3%õ%ô54UEõ$ôET5D”ôârÂw&÷VæB3rWF†÷&—G’7FFRÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6VE$&÷fÂÂv7F—fR&÷VæB3rÆ6·2—G2W†7B&Wf—6VB×F&vWB&÷fÂ†æFöfbr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3tFö7VÖVçEFW‡BÂw&÷VæB3r7W'&VçBFö7VÖVçG2r“°¢76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%&Wf—6VE$&÷fÂæ÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%&Wf—6VE$6öçG&öÂÂw&÷VæB3r&W&W6VçFF—fR&Wf—6VB×F&vWB76WB&ööbr“°§ÒVÇ6R–b‡3%&Wf—6–öä6öçG&öÂ’°¢76W'B†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&Wf—6–öä6öçG&öÅF‚bb²t”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôârÂu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”UruÒæ–æ6ÇVFW2†WF†÷&—G’ç7FGW2’Âw&÷VæB3bWF†÷&—G’7FFRÖ—6ÖF6‚r“°¢76W'B‡3%&Wf—6–öä†æFöfbÂv7F—fR&÷VæB3bÆ6·2—G2W†7B&Wf—6–öâ†æFöfbr“°¢76W'E3$†—7F÷'•v—F„–æ7&VÖVçFÅ&VæWvÇ2‡3%&Wf—6–öä†æFöfbæ÷Væ–æt6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â3%&Wf—6–öä6öçG&öÂÂw&÷VæB3bW†7BW6W"×&WVW7FVB&Wf—6–öâæB&÷VæB"Wf–FVæ6RrÂs"r“°§ÒVÇ6R–b†WF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urr’°¢76W'B‡3%&W—$6öçG&öÂbb3%&Wf–Wu&Vf—ƒòç&VF&6´6öÖÖ—BÂu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Ur&WV—&W2F†R6ö×ÆWFR3"7&—F–2Â§VFvRÂ6ö×ÆWF–öâæBFWÆ÷–ÖVçB×&VF&6²6†–âr“°¢76W'B‡3$–æ—F–Å&VG”66W72bb3$–æ—F–Å&VG”66W72æVæGö–çBÓÓÒv—B…²w&Wb×'6RrÂt„TBuÒ’Âv–æ—F–Â$TE’7FFRFöW2æ÷B&–æB—G26ö×ÆWFR66W72×&VæWvÂF–Âr“°¢6öç7B&VG”6öÖÖ—BÒ3$–æ—F–Å&VG”66W72æ&6U&VG”6öÖÖ—C°¢76W'B†v—B…²w&Wb×'6RrÂG·&VG”6öÖÖ—GÕæÒ’ÓÓÒ3%&Wf–Wu&Vf—‚ç&VF&6´6öÖÖ—BÂu3"$TE’7F—fF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†RW†7BFWÆ÷–ÖVçB&VF&6²r“°¢76W'DW†7D6†ævVEF‡2‡3%&Wf–Wu&Vf—‚ç&VF&6´6öÖÖ—BÂ&VG”6öÖÖ—BÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âu3"$TE’7F—fF–öâ6öÖÖ—Br“°¢6öç7Bg&÷¦VåF‡2Ò3%&Wf–Wu&Vf—‚æ6öçFVçDÖæ–fW7BæÖ†VçG'’ÓâVçG'’çF‚“°¢76W'DæõF„6†ævW56–æ6R‡3%&W—$÷Væ–æt6öÖÖ—BÂ3%&Wf–Wu&Vf—‚ç&VF&6´6öÖÖ—BÂW‡V7FVE3%&VG”7F—fF–öåw&—FW2Âw&÷VæB3BÖ—'&÷'26†ævVB&Vf÷&RF†RFVF–6FVB$TE’7F—fF–öâr“°¢76W'DæõF„6†ævW56–æ6R‡3%&Wf–Wu&Vf—‚çF&vWD6öÖÖ—BÂ3$–æ—F–Å&VG”66W72æVæGö–çBÂg&÷¦VåF‡2Âu3"&Wf–WvVB&öGV7B÷FW7B÷v÷&¶fÆ÷rg&VW¦RF‡&÷Vv‚$TE’æB66W72&VæWvÂr“°¢f÷"†6öç7BVçG'’öb3%&Wf–Wu&Vf—‚æ6öçFVçDÖæ–fW7B’°¢76W'B†v—B…²w&Wb×'6RrÂ„TC¢G¶VçG'’çF‡ÖÒ’ÓÓÒVçG'’æ&Æö"Â3"$TE’6öçFVçBF–ffW'2g&öÒF†R7&—F–2Ö&÷VæBÖæ–fW7C¢G¶VçG'’çF‡Ö“°¢Ð¢f÷"†6öç7Bf–ÆRöbö&¦V7BçfÇVW2‡3%&Wf–WtWf–FVæ6UF‡2’’76W'DFFVDöæ6TæEVæ6†ævVB†f–ÆRÂf—'7DFD6öÖÖ—B†f–ÆR’“°§ÒVÇ6R–b‡3%&W—$6öçG&öÂ’°¢76W'B†WF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õõd•5TÅõ$U•"rÂw&÷VæB3B†2âVç7W÷'FVBæöâÕ$TE’7FFRr“°¢–b‡3%&Wf–Wu&Vf—‚’°¢6öç7BWf–FVæ6UF–ÂÒ3%&Wf–Wu&Vf—‚ç&VF&6´6öÖÖ—Bóò3%&Wf–Wu&Vf—‚æW‡FW&æÅ&ööd6öÖÖ—Bóò3%&Wf–Wu&Vf—‚ç&WVW7D6öÖÖ—Bóò3%&Wf–Wu&Vf—‚æ6ö×ÆWF–öä6öÖÖ—Bóò3%&Wf–Wu&Vf—‚æ§VFvT6öÖÖ—Bóò3%&Wf–Wu&Vf—‚æ7&—F–46öÖÖ—Bóò3%&Wf–Wu&Vf—‚ç&Wf–WufW&–f–W$6÷'&V7F–öä6öÖÖ—Bóò3%&Wf–Wu&Vf—‚æFÖ—76–öå&VF&6´6öÖÖ—Bóò3%&Wf–Wu&Vf—‚æFÖ—76–öä6öÖÖ—Bóò3%&Wf–Wu&Vf—‚ç6¶vT6öÖÖ—C°¢76W'B†v—B…²w&Wb×'6RrÂt„TBuÒ’ÓÓÒWf–FVæ6UF–ÂÂvöæ6R3"çVÖ&W&VB&Wf–Wr7F'G2ÂV6‚Wf–FVæ6R6öÖÖ—B×W7B&VÖ–âF†RW†7B7W'&VçBF–ÂVçF–ÂF†RæW‡BFVF–6FVBWf–FVæ6R7FWr“°¢Ð§Ð ¦6öç7B&WV—&VEc4&–æF–æuF‡2Ò°¢v6æöæ–6Âõ5DU%ôDUTäDTä5•ô4Äõ5U$Ræ§6öârÀ¢v6æöæ–6Âõ45$TTåõ5DDUõ$Tt•5E%’æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓö66WFæ6RÖÖG&—‚æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ÷VÆ–f–6F–öâ×&W7VÇB×c2æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ÷67&VVâ×&ö¦V7F–öâÖ6÷fW&vRÖÆVFvW"æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓöçVÖW&–2ÖæöâÖ–×7Bæ§6öârÀ¢ââäö&¦V7BçfÇVW2‡7FW%&Wf–WuF‡2’À¢w6–×VÆF–öâö6æF–FFR×c2æ§6öârÀ¢w6–×VÆF–öâö6æF–FFR×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFRÖ6æF–FFR×c2æÖ§2rÀ¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c2æ§6öârÀ¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFRÖW†V7WF–öâÖ6öçG&7B×c2æÖ§2rÀ¢w6–×VÆF–öâ÷'Vâ×Æâ×c2æ§6öârÀ¢w6–×VÆF–öâ÷'Vâ×Æâ×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFR×'Vâ×Æâ×c2æÖ§2rÀ¢w6–×VÆF–öâöf—‡GW&W2÷c2öÖæ–fW7Bæ§6öârÀ¢w6–×VÆF–öâöf—‡GW&W2÷c2öæVvF—fRæ§6öârÀ¢w6–×VÆF–öâöf—‡GW&W2÷c2÷fÆ–FFRÖf—‡GW&W2æÖ§2rÀ¢w6–×VÆF–öâ÷&W7VÇB×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFR×&W7VÇB×c2æÖ§2rÀ¢c5VÆ–f–6F–öå'VææW%F‚À¢w6–×VÆF–öâöVæv–æR×c"÷'Vâ×ÆâæÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷'Vâ×66Væ&–òæÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"ö†–v‚×föÇVÖRæÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"ö–æFW‚æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷&æræÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷7FF—7F–72æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"ö†6‚æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷F÷vW"æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"öV6öæö×’æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"öçVÖW&–2æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷7FFRÖÖ6†–æW2æÖ§2rÀ¢w6–×VÆF–öâöÆ–"×c"÷66†VÖ×fÆ–FF÷"æÖ§2rÀ¢w6–×VÆF–öâöÖ–w&F–öç2÷c×Fò×c"öÖ–w&F–öâÖÖæ§6öârÀ¢w6–×VÆF–öâöW†V7WF&ÆR×6VÂ×c2ç66†VÖæ§6öârÀ¢c56VÅfÆ–FF÷%F‚À¢w6–×VÆF–öâ÷fW&–g’×7FW"×c2æÖ§2rÀ¢c5&ö¦V7F–öåfW&–f–W%F‚À¢c46öçF–çV—G•fW&–f–W%F€¥Ó° ¦6öç7BW‡V7FVEc4WF†÷&—G•ö–çFW'2Ò°¢6VÃ¢c56VÅF‚À¢6æF–FFS¢w6–×VÆF–öâö6æF–FFR×c2æ§6öârÀ¢66†VÖ¢w6–×VÆF–öâö6æF–FFR×c2ç66†VÖæ§6öârÀ¢6æF–FFUfÆ–FF÷#¢w6–×VÆF–öâ÷fÆ–FFRÖ6æF–FFR×c2æÖ§2rÀ¢W†V7WF–öä6öçG&7C¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c2æ§6öârÀ¢W†V7WF–öä6öçG&7E66†VÖ¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c2ç66†VÖæ§6öârÀ¢W†V7WF–öä6öçG&7EfÆ–FF÷#¢w6–×VÆF–öâ÷fÆ–FFRÖW†V7WF–öâÖ6öçG&7B×c2æÖ§2rÀ¢'VåÆã¢w6–×VÆF–öâ÷'Vâ×Æâ×c2æ§6öârÀ¢'VåÆå66†VÖ¢w6–×VÆF–öâ÷'Vâ×Æâ×c2ç66†VÖæ§6öârÀ¢'VåÆåfÆ–FF÷#¢w6–×VÆF–öâ÷fÆ–FFR×'Vâ×Æâ×c2æÖ§2rÀ¢&W7VÇE66†VÖ¢w6–×VÆF–öâ÷&W7VÇB×c2ç66†VÖæ§6öârÀ¢&W7VÇEfÆ–FF÷#¢w6–×VÆF–öâ÷fÆ–FFR×&W7VÇB×c2æÖ§2rÀ¢Væv–æS¢w6–×VÆF–öâöVæv–æR×c"òrÀ¢&ö¦V7F–öåfW&–f–W#¢c5&ö¦V7F–öåfW&–f–W%F‚À¢6öçF–çV—G•fW&–f–W#¢c46öçF–çV—G•fW&–f–W%F€§Ó° ¦6öç7BW‡V7FVD÷Vå7FW$WF†÷&—G’Ò°¢7FW%7FGW3¢t”åõ$ôu$U55ô4ôåE$5Eô4õ%$T5D”ôåõ$UT•$TBrÀ¢6VÃ¢w6–×VÆF–öâöW†V7WF&ÆR×6VÂ×c"æ§6öârÀ¢6æF–FFS¢w6–×VÆF–öâö6æF–FFR×c"æ§6öârÀ¢66†VÖ¢w6–×VÆF–öâö6æF–FFR×c"ç66†VÖæ§6öârÀ¢W†V7WF–öä6öçG&7C¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c"æ§6öârÀ¢'VåÆã¢w6–×VÆF–öâ÷'Vâ×Æâ×c"æ§6öârÀ¢Væv–æS¢w6–×VÆF–öâöVæv–æR×c"òrÀ¢7W'&VçEfW&–f–6F–öäÖWF†öC¢ufW&–g’WfW'’6VÂ&–æF–ærB7W'&VçB„TBæB'VâF†R6÷W&6RÖ&÷VæBfW&–f–W"–âF†R–çF7B†—7F÷&–6Âv÷&·G&VS²&ö¦V7B×6÷W&6R&WÆ6VÖVçBFöW2æ÷B&W6VÂ7FW"âp§Ó° ¦6öç7BW‡V7FVD÷Vå7FW%6–×VÆF–öâÒ°¢7FGW3¢t”åõ$ôu$U55ô4ôåE$5Eô4õ%$T5D”ôåõ$UT•$TBrÀ¢6VÃ¢w6–×VÆF–öâöW†V7WF&ÆR×6VÂ×c"æ§6öârÀ¢6æF–FFS¢w6–×VÆF–öâö6æF–FFR×c"æ§6öârÀ¢W†V7WF–öä6öçG&7C¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c"æ§6öârÀ¢&–æF–ætG&–gC¢À¢fW&–f–6F–öã¢v'—FR&–æF–æw2&W&öGV6RÂ'WB67&VVâ&W7öç6–&–Æ—G’÷7FFR6VÖçF–2&ö¦V7F–öâf–ÆVB–æFWVæFVçB×WFF–öâFW7F–ærrÀ¢÷Väf–æF–æs¢u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓp§Ó° ¦6öç7BW‡V7FVE757FW$WF†÷&—G’Ò°¢7FW%7FGW3¢u55ô4ôåE$5BrÀ¢ââæW‡V7FVEc4WF†÷&—G•ö–çFW'0§Ó° ¦6öç7BW‡V7FVE757FW%6–×VÆF–öâÒ°¢7FGW3¢u55ô4ôåE$5BrÀ¢6VÃ¢c56VÅF‚À¢6æF–FFS¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æ6æF–FFRÀ¢W†V7WF–öä6öçG&7C¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7BÀ¢&–æF–ætG&–gC¢À¢fW&–f–6F–öã¢wG'W7FVB7W'&VçBc26VÂÂÆ÷76ÆW726æöæ–6Â67&VVâ&ö¦V7F–öâÂæB7FW26öçF–çV—G’fW&–f–6F–öârÀ¢WF†÷&—G•ö–çFW'3¢W‡V7FVEc4WF†÷&—G•ö–çFW'0§Ó° ¦6öç7BW‡V7FVE&÷VæC3$6öæ7&WFUw&—FW2ÒæWr6WB…°¢7FW$6÷'&V7F–öåF‚À¢wVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ32æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’ö7&—F–2×7VÖÖ'’×&÷VæBÓ2æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’öf–æÂÖ§VFvR×&÷VæBÓ"æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’ö6ö×ÆWF–öâÖWf–FVæ6R×&÷VæBÓ"æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’öÆ—fR×&VF&6²×&÷VæBÓ"æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓö66WFæ6RÖÖG&—‚æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ÷VÆ–f–6F–öâ×&W7VÇB×c2æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ÷67&VVâ×&ö¦V7F–öâÖ6÷fW&vRÖÆVFvW"æ§6öârÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓöçVÖW&–2ÖæöâÖ–×7Bæ§6öârÀ¢ââäö&¦V7BçfÇVW2‡7FW%&Wf–WuF‡2’À¢7FW$6öçF–çV—G•F‚À¢w6–×VÆF–öâö6æF–FFR×c2æ§6öârÀ¢w6–×VÆF–öâö6æF–FFR×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFRÖ6æF–FFR×c2æÖ§2rÀ¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c2æ§6öârÀ¢w6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFRÖW†V7WF–öâÖ6öçG&7B×c2æÖ§2rÀ¢w6–×VÆF–öâ÷'Vâ×Æâ×c2æ§6öârÀ¢w6–×VÆF–öâ÷'Vâ×Æâ×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFR×'Vâ×Æâ×c2æÖ§2rÀ¢w6–×VÆF–öâ÷&W7VÇB×c2ç66†VÖæ§6öârÀ¢w6–×VÆF–öâ÷fÆ–FFR×&W7VÇB×c2æÖ§2rÀ¢c5VÆ–f–6F–öå'VææW%F‚À¢w6–×VÆF–öâöf—‡GW&W2÷c2öÖæ–fW7Bæ§6öârÀ¢w6–×VÆF–öâöf—‡GW&W2÷c2öæVvF—fRæ§6öârÀ¢w6–×VÆF–öâöf—‡GW&W2÷c2÷fÆ–FFRÖf—‡GW&W2æÖ§2rÀ¢c56VÅF‚À¢w6–×VÆF–öâöW†V7WF&ÆR×6VÂ×c2ç66†VÖæ§6öârÀ¢c56VÅfÆ–FF÷%F‚À¢w6–×VÆF–öâ÷fW&–g’×7FW"×c2æÖ§2rÀ¢c5&ö¦V7F–öåfW&–f–W%F‚À¢c46öçF–çV—G•fW&–f–W%F‚À¢wFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2rÀ¢t5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öârÀ¢u$ô¤T5Eõ5DEU2æ§6öârÀ¢t•õ$ô¤T5EõôÄ”5’æ§6öârÀ¢uTÄ•E•ôtDRæÖBrÀ¢u$ô¤T5Eô„äDõdU"æÖBrÀ¢ttTåE2æÖBrÀ¢u$TDÔRæÖBrÀ¢w6–×VÆF–öâô5U%$TåEõ5DEU2æ§6öârÀ¢ræv—F‡V"÷v÷&¶fÆ÷w2ô5U%$TåEõ5DEU2æÖBrÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂæ§6öâp¥Ò“° ¦gVæ7F–öâfW&–g•&÷VæC3$æöå7FW$g&VW¦R‚’°¢–b‚7FW$6÷'&V7F–öâ’&WGW&ã°¢6öç7B&6VÆ–æRÒG'W7FVE&÷VæC3&W—$&6Ræ6öÖÖ—C°¢6öç7BgWGW&T6Æ÷7W&UF‚ÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ32æ§6öâs°¢6öç7B&ævTVæBÒW†—7G2†gWGW&T6Æ÷7W&UF‚’òf—'7DFD6öÖÖ—B†gWGW&T6Æ÷7W&UF‚’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢6öç7BVæDWF†÷&—G’Ò&ævTVæBÓÓÒv—B…²w&Wb×'6RrÂt„TBuÒ’òWF†÷&—G’¢§6öäB‡&ævTVæBÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr“°¢6öç7BVæE7FGW2Ò&ævTVæBÓÓÒv—B…²w&Wb×'6RrÂt„TBuÒ’ò7FGW2¢§6öäB‡&ævTVæBÂu$ô¤T5Eõ5DEU2æ§6öâr“°¢6öç7BVæEöÆ–7’Ò&ævTVæBÓÓÒv—B…²w&Wb×'6RrÂt„TBuÒ’òöÆ–7’¢§6öäB‡&ævTVæBÂt•õ$ô¤T5EõôÄ”5’æ§6öâr“°¢6öç7BVæE6–×VÆF–öâÒ&ævTVæBÓÓÒv—B…²w&Wb×'6RrÂt„TBuÒ’ò6–Ò¢§6öäB‡&ævTVæBÂw6–×VÆF–öâô5U%$TåEõ5DEU2æ§6öâr“°¢6öç7BVæDF—7F6†W"Ò&ævTVæBÓÓÒv—B…²w&Wb×'6RrÂt„TBuÒ’òF—7F6†W"¢§6öäB‡&ævTVæBÂwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂæ§6öâr“°¢6öç7B&6VÆ–æTWF†÷&—G’Ò§6öäB†&6VÆ–æRÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr“°¢6öç7B&6VÆ–æU7FGW2Ò§6öäB†&6VÆ–æRÂu$ô¤T5Eõ5DEU2æ§6öâr“°¢6öç7B&6VÆ–æUöÆ–7’Ò§6öäB†&6VÆ–æRÂt•õ$ô¤T5EõôÄ”5’æ§6öâr“°¢6öç7B&6VÆ–æU6–×VÆF–öâÒ§6öäB†&6VÆ–æRÂw6–×VÆF–öâô5U%$TåEõ5DEU2æ§6öâr“°¢6öç7B&6VÆ–æTF—7F6†W"Ò§6öäB†&6VÆ–æRÂwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂæ§6öâr“°¢6öç7Bg&VW¦UF÷ÆWfVÄW†6WBÒ†7W'&VçEfÇVRÂ&6VÆ–æUfÇVRÂÆÆ÷vVD¶W—2ÂÆ&VÂ’Óâ°¢6öç7B7W'&VçD6÷’Ò7G'V7GW&VD6ÆöæR†7W'&VçEfÇVR“°¢6öç7B&6VÆ–æT6÷’Ò7G'V7GW&VD6ÆöæR†&6VÆ–æUfÇVR“°¢f÷"†6öç7B¶W’öbÆÆ÷vVD¶W—2’°¢FVÆWFR7W'&VçD6÷•¶¶W•Ó°¢FVÆWFR&6VÆ–æT6÷•¶¶W•Ó°¢Ð¢76W'B„¥4ôâç7G&–æv–g’†7W'&VçD6÷’’ÓÓÒ¥4ôâç7G&–æv–g’†&6VÆ–æT6÷’’Â&÷VæB3"6†ævVBg&÷¦VâG¶Æ&VÇÒF÷ÖÆWfVÂ6öçFVçF“°¢Ó°¢g&VW¦UF÷ÆWfVÄW†6WB†VæDWF†÷&—G’Â&6VÆ–æTWF†÷&—G’Â²wWFFVDBrÂw7FGW2rÂv7W'&VçD–çFW&æÅ†6RrÂv7F—fT6†ævT6öçG&öÂrÂvv÷fW&ææ6U&V6÷fW'’rÂvW†V7WF&ÆT6öçG&7BrÂvvÆö&ÄvFRrÂv7W'&VçE&öGV7Ev÷&²uÒÂvWF†÷&—G’r“°¢g&VW¦UF÷ÆWfVÄW†6WB†VæE7FGW2Â&6VÆ–æU7FGW2Â²wWFFVDBrÂv7F—fT6†ævT6öçG&öÂrÂw7FGW2rÂv7W'&VçD–çFW&æÅ†6RrÂv7W'&VçEfW&F–7BrÂvv÷fW&ææ6U&V6÷fW'’rÂw66÷VE76W2rÂvW†V7WF&ÆT6öçG&7BrÂv7W'&VçE&öGV7Ev÷&²rÂv÷Väf–æF–æw2rÂvæW‡DWF†÷&—¦VD7F–öâuÒÂu$ô¤T5Eõ5DEU2r“°¢g&VW¦UF÷ÆWfVÄW†6WB†VæEöÆ–7’Â&6VÆ–æUöÆ–7’Â²wWFFVDBrÂvWF†÷&—G’rÂv7W'&VçBrÂv7W'&VçEw&—FT&÷VæF'’uÒÂt’öÆ–7’r“°¢g&VW¦UF÷ÆWfVÄW†6WB†VæE6–×VÆF–öâÂ&6VÆ–æU6–×VÆF–öâÂ²wWFFVDBrÂv7W'&VçD–çFW&æÅ†6RrÂw7FGW2rÂvv÷fW&ææ6U&V6÷fW'’rÂw7FW"rÂv7W'&VçD×WFF–öäÆÆ÷vVBrÂvæW‡D7F–öâuÒÂw6–×VÆF–öâÖ—'&÷"r“°¢g&VW¦UF÷ÆWfVÄW†6WB†VæDF—7F6†W"Â&6VÆ–æTF—7F6†W"Â²wWFFVDBrÂw7FGW2rÂv7W'&VçDFFVæGVÒrÂv7W'&VçEfW&F–7BrÂv7W'&VçD–çFW&æÅ†6RrÂvv÷fW&ææ6U&V6÷fW'”6Æ÷7W&RrÂv6æöæ–6Å6VÇ2rÂw7FW$W†V7WF&ÆT6öçG&7BrÂw66÷UG'WF‚uÒÂvF—7F6†W"r“°¢6öç7B7F&ÆUöÆ–7”WF†÷&—G’ÒfÇVRÓâ°¢6öç7B6÷’Ò7G'V7GW&VD6ÆöæR‡fÇVR“°¢FVÆWFR6÷’æ7F—fT6†ævT6öçG&öÃ°¢FVÆWFR6÷’æv÷fW&ææ6U&V6÷fW'”6Æ÷7W&S°¢&WGW&â6÷“°¢Ó°¢76W'B„¥4ôâç7G&–æv–g’‡7F&ÆUöÆ–7”WF†÷&—G’†VæEöÆ–7’æWF†÷&—G’’’ÓÓÒ¥4ôâç7G&–æv–g’‡7F&ÆUöÆ–7”WF†÷&—G’†&6VÆ–æUöÆ–7’æWF†÷&—G’’’Âw&÷VæB3"6†ævVBg&÷¦Vâ’öÆ–7’WF†÷&—G’ö–çFW'2÷WG6–FRF†R7F—fR6öçG&öÂr“°¢f÷"†6öç7B¶W’öb²v6æöæ–6Å&öGV7BrÂvÖöFVÅfÆ–FF–öârÂvÆVv7•'VçF–ÖRrÂw66÷VEfW&F–7G2rÂwv÷&¶fÆ÷uöÆ–7’rÂv–Ö×WF&ÆT†—7F÷'•öÆ–7’rÂw&ö¦V7E6÷W&6W2uÒ’°¢76W'B„¥4ôâç7G&–æv–g’†VæDWF†÷&—G•¶¶W•Ò’ÓÓÒ¥4ôâç7G&–æv–g’†&6VÆ–æTWF†÷&—G•¶¶W•Ò’Â&÷VæB3"6†ævVBg&÷¦VâWF†÷&—G’6V7F–öã¢G¶¶W—Ö“°¢Ð¢6öç7B7F&ÆU&öGV7BÒfÇVRÓâ°¢6öç7B6÷’Ò7G'V7GW&VD6ÆöæR‡fÇVR“°¢FVÆWFR6÷’æ7W'&VçE7FFS°¢FVÆWFR6÷’ææW‡DWF†÷&—¦VD7F–öã°¢FVÆWFR6÷’ææW‡E&öGV7D7F–öägFW$6÷'&V7FVD6Æ÷7W&S°¢&WGW&â6÷“°¢Ó°¢76W'B„¥4ôâç7G&–æv–g’‡7F&ÆU&öGV7B†VæDWF†÷&—G’æ7W'&VçE&öGV7Ev÷&²’’ÓÓÒ¥4ôâç7G&–æv–g’‡7F&ÆU&öGV7B†&6VÆ–æTWF†÷&—G’æ7W'&VçE&öGV7Ev÷&²’’Âw&÷VæB3"6†ævVBg&÷¦Vâ3"&öGV7BG'WF‚r“°¢6öç7B7F&ÆU7FGW5&öGV7BÒfÇVRÓâ°¢6öç7B6÷’Ò7G'V7GW&VD6ÆöæR‡fÇVR“°¢FVÆWFR6÷’æ7W'&VçE7FFS°¢&WGW&â6÷“°¢Ó°¢76W'B„¥4ôâç7G&–æv–g’‡7F&ÆU7FGW5&öGV7B†VæE7FGW2æ7W'&VçE&öGV7Ev÷&²’’ÓÓÒ¥4ôâç7G&–æv–g’‡7F&ÆU7FGW5&öGV7B†&6VÆ–æU7FGW2æ7W'&VçE&öGV7Ev÷&²’’Âw&÷VæB3"6†ævVBg&÷¦Vâ$ô¤T5Eõ5DEU2&öGV7BG'WF‚r“°¢6öç7B7F&ÆU66÷VE76W2ÒfÇVRÓâ°¢6öç7B6÷’Ò7G'V7GW&VD6ÆöæR‡fÇVR“°¢FVÆWFR6÷’ç7FW#°¢&WGW&â6÷“°¢Ó°¢76W'B„¥4ôâç7G&–æv–g’‡7F&ÆU66÷VE76W2†VæE7FGW2ç66÷VE76W2’’ÓÓÒ¥4ôâç7G&–æv–g’‡7F&ÆU66÷VE76W2†&6VÆ–æU7FGW2ç66÷VE76W2’’Âw&÷VæB3"6†ævVBæöâÕ7FW"66÷VB52Æ&VÇ2r“°¢76W'B„¥4ôâç7G&–æv–g’†VæE7FGW2çG'WF„&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’†&6VÆ–æU7FGW2çG'WF„&÷VæF&–W2’Âw&÷VæB3"6†ævVBg&÷¦Vâ'VçF–ÖR÷&VÆV6RG'WF‚&÷VæF&–W2r“°¢f÷"†6öç7B¶W’öb²w&W÷6—F÷'’rÂw66÷VE75fö6'VÆ'’rÂvf÷&&–FFVåVç66÷VEfW&F–7BrÂv6ö×ÆWF–öä–ç7Vff–6–VçDÆöæRrÂvÆ÷u&Wv÷&µ'VÆW2rÂwfW&–f–6F–öåöÆ–7’rÂvÆVv7’rÂw&W÷'F–æu&WV—&VBuÒ’°¢76W'B„¥4ôâç7G&–æv–g’†VæEöÆ–7•¶¶W•Ò’ÓÓÒ¥4ôâç7G&–æv–g’†&6VÆ–æUöÆ–7•¶¶W•Ò’Â&÷VæB3"6†ævVBg&÷¦Vâ’öÆ–7’6V7W&—G’6V7F–öã¢G¶¶W—Ö“°¢Ð¢f÷"†6öç7B¶W’öb²w7FWrÂw7FW2rÂw'VçF–ÖU&WfÆ–FF–öârÂv6æF–FFT×WFF–öäGW&–æu3%rÂw6VÆVDWf–FVæ6T×WFF–öäGW&–æu3%uÒ’°¢76W'B„¥4ôâç7G&–æv–g’†VæE6–×VÆF–öå¶¶W•Ò’ÓÓÒ¥4ôâç7G&–æv–g’†&6VÆ–æU6–×VÆF–öå¶¶W•Ò’Â&÷VæB3"6†ævVBg&÷¦Vâ6–×VÆF–öâ6V7F–öã¢G¶¶W—Ö“°¢Ð¢6öç7Bv—F†÷WE7FW"ÒfÇVRÓâ°¢6öç7B6÷’Ò7G'V7GW&VD6ÆöæR‡fÇVR“°¢FVÆWFR6÷’ç7FW#°¢&WGW&â6÷“°¢Ó°¢76W'B„¥4ôâç7G&–æv–g’‡v—F†÷WE7FW"†VæDF—7F6†W"æ6æöæ–6Å6VÇ2’’ÓÓÒ¥4ôâç7G&–æv–g’‡v—F†÷WE7FW"†&6VÆ–æTF—7F6†W"æ6æöæ–6Å6VÇ2’’Âw&÷VæB3"6†ævVBæöâÕ7FW"6æöæ–6Â6VÇ2r“°¢76W'B„¥4ôâç7G&–æv–g’‡v—F†÷WE7FW"†VæDF—7F6†W"ç66÷UG'WF‚’’ÓÓÒ¥4ôâç7G&–æv–g’‡v—F†÷WE7FW"†&6VÆ–æTF—7F6†W"ç66÷UG'WF‚’’Âw&÷VæB3"6†ævVBæöâÕ7FW"F—7F6†W"66÷RG'WF‚r“°¢f÷"†6öç7B¶W’öb²w&W÷6—F÷'’rÂv'&æ6‚rÂv7W'&VçDWF†÷&—G”–æFW‚rÂvÆ–æVvRrÂw'VÆRuÒ’°¢76W'B„¥4ôâç7G&–æv–g’†VæDF—7F6†W%¶¶W•Ò’ÓÓÒ¥4ôâç7G&–æv–g’†&6VÆ–æTF—7F6†W%¶¶W•Ò’Â&÷VæB3"6†ævVBg&÷¦VâF—7F6†W"6V7F–öã¢G¶¶W—Ö“°¢Ð¢6öç7B6öæ7&WFT6†ævW2Ò6†ævVEF‡2‡7FW$6÷'&V7F–öâæVçG'’æ†VBÂ&ævTVæB“°¢ÆWBvw&VvFT'—FW2Ò°¢f÷"†6öç7Bf–ÆRöb6öæ7&WFT6†ævW2’°¢76W'B†W‡V7FVE&÷VæC3$6öæ7&WFUw&—FW2æ†2†f–ÆR’Â&÷VæB3"7&VFVB÷"6†ævVBâVç&Wf–WvVB6öæ7&WFRFƒ¢G¶f–ÆWÖ“°¢6öç7BVçG'’Òv—B…²vÇ2×G&VRrÂ&ævTVæBÂrÒÒrÂf–ÆUÒ’ç7Æ—B‚õÇ2²ò“°¢76W'B†VçG'•³ÒÓÓÒscCBrbbVçG'•³ÒÓÓÒv&Æö"rbbVçG'•³5ÒÓÓÒf–ÆRÂ&÷VæB3"VæB×7FFRf–ÆR—2Ö—76–ær÷"æöâÓcCC¢G¶f–ÆWÖ“°¢6öç7B'—FW2ÒçVÖ&W"†v—B…²v6BÖf–ÆRrÂr×2rÂG·&ævTVæGÓ¢G¶f–ÆWÖÒ’“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†'—FW2’bb'—FW2ãÒbb'—FW2ÃÒ¢#B¢#BÂ&÷VæB3"v÷fW&æVBf–ÆRW†6VVG2Ö”#¢G¶f–ÆWÖ“°¢vw&VvFT'—FW2³Ò'—FW3°¢Ð¢76W'B†vw&VvFT'—FW2ÃÒC¢#B¢#BÂw&÷VæB3"vw&VvFRv÷fW&æVBw&—FW2W†6VVBCÖ”"r“°¢6öç7B6öÖÖ—D÷WGWBÒv—B…²w&WbÖÆ—7BrÂrÒ×&WfW'6RrÂG·7FW$6÷'&V7F–öâæVçG'’æ†VGÒââG·&ævTVæGÖÒ“°¢6öç7B6öÖÖ—G2Ò6öÖÖ—D÷WGWBò6öÖÖ—D÷WGWBç7Æ—B‚uÆâr’æf–ÇFW"„&ööÆVâ’¢µÓ°¢ÆWB&VçBÒ7FW$6÷'&V7F–öâæVçG'’æ†VC°¢f÷"†6öç7B6öÖÖ—Böb6öÖÖ—G2’°¢ÆWB6öÖÖ—D'—FW2Ò°¢f÷"†6öç7Bf–ÆRöb6†ævVEF‡2‡&VçBÂ6öÖÖ—B’’°¢76W'B†W‡V7FVE&÷VæC3$6öæ7&WFUw&—FW2æ†2†f–ÆR’Â&÷VæB3"–çFW&ÖVF–FR6öÖÖ—B6†ævVBâVç&Wf–WvVB6öæ7&WFRFƒ¢G¶f–ÆWÖ“°¢6öç7BVçG'’Òv—B…²vÇ2×G&VRrÂ6öÖÖ—BÂrÒÒrÂf–ÆUÒ’ç7Æ—B‚õÇ2²ò“°¢76W'B†VçG'•³ÒÓÓÒscCBrbbVçG'•³ÒÓÓÒv&Æö"rbbVçG'•³5ÒÓÓÒf–ÆRÂ&÷VæB3"–çFW&ÖVF–FR6öÖÖ—BFVÆWFVB÷"W6VBæöâÓcCBf–ÆS¢G¶f–ÆWÖ“°¢6öç7B'—FW2ÒçVÖ&W"†v—B…²v6BÖf–ÆRrÂr×2rÂG¶6öÖÖ—GÓ¢G¶f–ÆWÖÒ’“°¢76W'B„çVÖ&W"æ—56fT–çFVvW"†'—FW2’bb'—FW2ãÒbb'—FW2ÃÒ¢#B¢#BÂ&÷VæB3"–çFW&ÖVF–FRf–ÆRW†6VVG2Ö”#¢G¶f–ÆWÖ“°¢6öÖÖ—D'—FW2³Ò'—FW3°¢Ð¢76W'B†6öÖÖ—D'—FW2ÃÒC¢#B¢#BÂ&÷VæB3"–çFW&ÖVF–FR6öÖÖ—BW†6VVG2CÖ”#¢G¶6öÖÖ—GÖ“°¢&VçBÒ6öÖÖ—C°¢Ð§Ð §fW&–g•&÷VæC3$æöå7FW$g&VW¦R‚“° ¦gVæ7F–öâfW&–g•7FW%&Wf–WtWf–FVæ6R‡6VÂ’°¢6öç7B&W6Væ6RÒö&¦V7Bæg&öÔVçG&–W2„ö&¦V7BæVçG&–W2‡7FW%&Wf–WuF‡2’æÖ‚…¶¶W’Âf–ÆUÒ’Óâ¶¶W’ÂW†—7G2†f–ÆR•Ò’“°¢76W'B‚&W6Væ6Ræf–æÄ§VFvRÇÂ&W6Væ6Ræ7&—F–2Âu7FW"f–æÂ§VFvRW†—7G2&Vf÷&RF†R–æFWVæFVçB7&—F–2r“°¢76W'B‚&W6Væ6Ræ6ö×ÆWF–öâÇÂ&W6Væ6Ræf–æÄ§VFvRÂu7FW"6ö×ÆWF–öâW†—7G2&Vf÷&RF†Rf–æÂ§VFvRr“°¢76W'B‚&W6Væ6RæÆ—fU&VF&6²ÇÂ&W6Væ6Ræ6ö×ÆWF–öâÂu7FW"Æ—fR&VF&6²W†—7G2&Vf÷&R6ö×ÆWF–öâr“°¢–b‡6VÂ’76W'B„ö&¦V7BçfÇVW2‡&W6Væ6R’æWfW'’„&ööÆVâ’Âu7FW"c26VÂW†—7G2&Vf÷&RF†R6ö×ÆWFRçVÖ&W&VB&Wf–Wr&Vf—‚r“°¢–b‚&W6Væ6Ræ7&—F–2’&WGW&âçVÆÃ°¢6öç7B7&—F–2Ò§6öâ‡7FW%&Wf–WuF‡2æ7&—F–2“°¢76W'DW†7D¶W•6WB†7&—F–2Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvVF—EF&vWBrÂwfW&F–7BrÂv6÷fW&vRrÂvf–æF–æw2rÂwVç&W6öÇfVBrÂvÖ†–×VÕfW&F–7BuÒÂu7FW"–æFWVæFVçB7&—F–2r“°¢76W'DW†7D¶W•6WB†7&—F–2æVF—EF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂu7FW"–æFWVæFVçB7&—F–2F&vWBr“°¢76W'DW†7D¶W•6WB†7&—F–2çVç&W6öÇfVBÂ²urÂuuÒÂu7FW"–æFWVæFVçB7&—F–2Vç&W6öÇfVBr“°¢76W'B†7&—F–2ç66†VÖfW'6–öâÓÓÒbb7&—F–2æ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"×67&VVâ×&ö¦V7F–öâÖ7&—F–2×&÷VæBÓrÂu7FW"–æFWVæFVçB7&—F–2–FVçF—G’Ö—6ÖF6‚r“°¢6öç7BF&vWD6öÖÖ—BÒ7&—F–2æVF—EF&vWCòæ6öÖÖ—C°¢6öç7BF&vWEG&VRÒ7&—F–2æVF—EF&vWCòçG&VS°¢76W'B‡F&vWD6öÖÖ—BbbF&vWEG&VRÓÓÒv—B…²w&Wb×'6RrÂG·F&vWD6öÖÖ—GÕç·G&VWÖÒ’Âu7FW"7&—F–2F&vWB6öÖÖ—B÷G&VRÖ—6ÖF6‚r“°¢–b‡6VÂ’76W'B‡6VÂç6VÖçF–46öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb6VÂç6VÖçF–5G&VRÓÓÒF&vWEG&VRÂwc26VÂ6VÖçF–2F&vWBF–ffW'2g&öÒF†R7FW"7&—F–2r“°¢76W'B†7&—F–2ç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb7&—F–2æ'&æ6‚ÓÓÒv¶–Ö’rÂu7FW"7&—F–2&W÷6—F÷'’ö'&æ6‚Ö—6ÖF6‚r“°¢76W'B†7&—F–2æ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu7FW"7&—F–26†ævRÖ6öçG&öÂÖ—6ÖF6‚r“°¢76W'B†7&—F–2çfW&F–7BÓÓÒu55õ5DU%õ45$TTåõ$ô¤T5D”ôåô”äDUTäDTåEô5$•D”2rÂu7FW"–æFWVæFVçB7&—F–2F–Bæ÷B72r“°¢76W'D7&—F–6Äf–æF–æt6÷VçG2†7&—F–2Âu7FW"–æFWVæFVçB7&—F–2r“°¢6öç7B&WV—&VD6÷fW&vRÒ°¢tÄõ54ÄU55ô4äôä”4Åõ45$TTåõ$ô¤T5D”ôârÀ¢t4Äõ4TEõc5õ44„TÔôäEôÕUDD”ôåôd•…EU$U2rÀ¢tåTÔU$”5ôäôåô”Õ5Eõ$õdTâp¢Ó°¢76W'B„¥4ôâç7G&–æv–g’†7&—F–2æ6÷fW&vR’ÓÓÒ¥4ôâç7G&–æv–g’‡&WV—&VD6÷fW&vR’Âu7FW"7&—F–26÷fW&vR—2–æ6ö×ÆWFRr“°¢76W'B„¥4ôâç7G&–æv–g’†7&—F–2æf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’…·²–C¢u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÕÒ’Âu7FW"7&—F–2f–æF–ær6WBF–ffW'2g&öÒF†RW†7B67&VVâ×&ö¦V7F–öâ&W6öÇWF–öâr“°¢76W'B†7&—F–2æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%ôd”äÅô¥TDtRrÂu7FW"7&—F–2Ö†–×VÒfW&F–7BÖ—6ÖF6‚r“°¢6öç7B7&—F–46öÖÖ—BÒf—'7DFD6öÖÖ—B‡7FW%&Wf–WuF‡2æ7&—F–2“°¢76W'B†7&—F–46öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶7&—F–46öÖÖ—GÕæÒ’ÓÓÒF&vWD6öÖÖ—BÂu7FW"7&—F–2×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†RW†7BVF—FVB6öçFVçBr“°¢76W'DW†7D6†ævVEF‡2‡F&vWD6öÖÖ—BÂ7&—F–46öÖÖ—BÂ·7FW%&Wf–WuF‡2æ7&—F–5ÒÂu7FW"7&—F–26öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡7FW%&Wf–WuF‡2æ7&—F–2Â7&—F–46öÖÖ—B“°¢–b‚&W6Væ6Ræf–æÄ§VFvR’&WGW&â²F&vWD6öÖÖ—BÂ7&—F–46öÖÖ—BÓ° ¢6öç7B§VFvRÒ§6öâ‡7FW%&Wf–WuF‡2æf–æÄ§VFvR“°¢76W'DW†7D¶W•6WB†§VFvRÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwF&vWBrÂv7&—F–2rÂwfW&F–7BrÂv6÷fW&vRrÂvf–æF–æw2rÂwVç&W6öÇfVBrÂw&W6öÇfVDf–æF–æw2rÂvÖ†–×VÕfW&F–7BuÒÂu7FW"f–æÂ§VFvRr“°¢76W'DW†7D¶W•6WB†§VFvRçF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂu7FW"f–æÂ§VFvRF&vWBr“°¢76W'DW†7D¶W•6WB†§VFvRæ7&—F–2Â²wF‚rÂv&Æö"uÒÂu7FW"f–æÂ§VFvR7&—F–2&–æF–ærr“°¢76W'DW†7D¶W•6WB†§VFvRçVç&W6öÇfVBÂ²urÂuuÒÂu7FW"f–æÂ§VFvRVç&W6öÇfVBr“°¢76W'B†§VFvRç66†VÖfW'6–öâÓÓÒbb§VFvRæ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"×67&VVâ×&ö¦V7F–öâÖf–æÂÖ§VFvR×&÷VæBÓrbb§VFvRç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb§VFvRæ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb§VFvRæ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu7FW"f–æÂ§VFvR–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†§VFvRçF&vWCòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb§VFvRçF&vWCòçG&VRÓÓÒF&vWEG&VRÂu7FW"§VFvRF&vWBF–ffW'2g&öÒ7&—F–2F&vWBr“°¢76W'B†§VFvRæ7&—F–3òçF‚ÓÓÒ7FW%&Wf–WuF‡2æ7&—F–2bb§VFvRæ7&—F–3òæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·7FW%&Wf–WuF‡2æ7&—F–7ÖÒ’Âu7FW"§VFvRFöW2æ÷B&–æBF†R7&—F–2r“°¢76W'B†§VFvRçfW&F–7BÓÓÒu55õ5DU%õ45$TTåõ$ô¤T5D”ôåô4õ%$T5D”ôârÂu7FW"f–æÂ§VFvRF–Bæ÷B72r“°¢76W'D7&—F–6Äf–æF–æt6÷VçG2†§VFvRÂu7FW"f–æÂ§VFvRr“°¢76W'B„¥4ôâç7G&–æv–g’†§VFvRæf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†7&—F–2æf–æF–æw2’Âu7FW"f–æÂ§VFvRf–æF–ær6WBF–ffW'2g&öÒF†R–æFWVæFVçB7&—F–2r“°¢76W'B„¥4ôâç7G&–æv–g’†§VFvRæ6÷fW&vR’ÓÓÒ¥4ôâç7G&–æv–g’‡&WV—&VD6÷fW&vR’Âu7FW"f–æÂ§VFvR6÷fW&vR—2–æ6ö×ÆWFRr“°¢76W'B„¥4ôâç7G&–æv–g’†§VFvRç&W6öÇfVDf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’…²u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓuÒ’Âu7FW"f–æÂ§VFvRF–Bæ÷BW†7FÇ’&–æBF†R&W6öÇfVB&ö¦V7F–öâr“°¢76W'B†§VFvRæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%ô4ôÕÄUD”ôåôUd”DTä4RrÂu7FW"f–æÂ§VFvRÖ†–×VÒfW&F–7BÖ—6ÖF6‚r“°¢6öç7B§VFvT6öÖÖ—BÒf—'7DFD6öÖÖ—B‡7FW%&Wf–WuF‡2æf–æÄ§VFvR“°¢76W'B†§VFvT6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶§VFvT6öÖÖ—GÕæÒ’ÓÓÒ7&—F–46öÖÖ—BÂu7FW"f–æÂ§VFvR×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R–æFWVæFVçB7&—F–2r“°¢76W'DW†7D6†ævVEF‡2†7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ·7FW%&Wf–WuF‡2æf–æÄ§VFvUÒÂu7FW"f–æÂÖ§VFvR6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡7FW%&Wf–WuF‡2æf–æÄ§VFvRÂ§VFvT6öÖÖ—B“°¢–b‚&W6Væ6Ræ6ö×ÆWF–öâ’&WGW&â²F&vWD6öÖÖ—BÂ7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÓ° ¢6öç7B6ö×ÆWF–öâÒ§6öâ‡7FW%&Wf–WuF‡2æ6ö×ÆWF–öâ“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&–f–VD6öçFVçBrÂvf–æÄ§VFvRrÂwfW&F–7BrÂwVç&W6öÇfVBrÂw&W6öÇfVDf–æF–æw2rÂvÖ†–×VÕfW&F–7BuÒÂu7FW"6ö×ÆWF–öâWf–FVæ6Rr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâçfW&–f–VD6öçFVçBÂ²v6öÖÖ—BrÂwG&VRuÒÂu7FW"6ö×ÆWF–öâfW&–f–VB6öçFVçBr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâæf–æÄ§VFvRÂ²wF‚rÂv&Æö"uÒÂu7FW"6ö×ÆWF–öâ§VFvR&–æF–ærr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâçVç&W6öÇfVBÂ²urÂuuÒÂu7FW"6ö×ÆWF–öâVç&W6öÇfVBr“°¢76W'B†6ö×ÆWF–öâç66†VÖfW'6–öâÓÓÒbb6ö×ÆWF–öâæ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"×67&VVâ×&ö¦V7F–öâÖ6ö×ÆWF–öâ×&÷VæBÓrbb6ö×ÆWF–öâç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb6ö×ÆWF–öâæ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb6ö×ÆWF–öâæ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu7FW"6ö×ÆWF–öâ–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†6ö×ÆWF–öâçfW&–f–VD6öçFVçCòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb6ö×ÆWF–öâçfW&–f–VD6öçFVçCòçG&VRÓÓÒF&vWEG&VRÂu7FW"6ö×ÆWF–öâF&vWBF–ffW'2g&öÒ7&—F–2F&vWBr“°¢76W'B†6ö×ÆWF–öâæf–æÄ§VFvSòçF‚ÓÓÒ7FW%&Wf–WuF‡2æf–æÄ§VFvRbb6ö×ÆWF–öâæf–æÄ§VFvSòæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·7FW%&Wf–WuF‡2æf–æÄ§VFvWÖÒ’Âu7FW"6ö×ÆWF–öâFöW2æ÷B&–æBF†Rf–æÂ§VFvRr“°¢76W'B†6ö×ÆWF–öâçfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%ôÄ•dUõ$TD$4²rbb6ö×ÆWF–öâçVç&W6öÇfVCòåÓÓÒbb6ö×ÆWF–öâçVç&W6öÇfVCòåÓÓÒÂu7FW"6ö×ÆWF–öâWf–FVæ6RF–Bæ÷BWF†÷&—¦RÆ—fR&VF&6²r“°¢76W'B„¥4ôâç7G&–æv–g’†6ö×ÆWF–öâç&W6öÇfVDf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’…²u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓuÒ’bb6ö×ÆWF–öâæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%ôÄ•dUõ$TD$4²rÂu7FW"6ö×ÆWF–öâ&W6öÇfVB6WB÷"Ö†–×VÒfW&F–7BÖ—6ÖF6‚r“°¢6öç7B6ö×ÆWF–öä6öÖÖ—BÒf—'7DFD6öÖÖ—B‡7FW%&Wf–WuF‡2æ6ö×ÆWF–öâ“°¢76W'B†6ö×ÆWF–öä6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶6ö×ÆWF–öä6öÖÖ—GÕæÒ’ÓÓÒ§VFvT6öÖÖ—BÂu7FW"6ö×ÆWF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†Rf–æÂ§VFvRr“°¢76W'DW†7D6†ævVEF‡2†§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ·7FW%&Wf–WuF‡2æ6ö×ÆWF–öåÒÂu7FW"6ö×ÆWF–öâ6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡7FW%&Wf–WuF‡2æ6ö×ÆWF–öâÂ6ö×ÆWF–öä6öÖÖ—B“°¢–b‚&W6Væ6RæÆ—fU&VF&6²’&WGW&â²F&vWD6öÖÖ—BÂ7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÓ° ¢6öç7B&VF&6²Ò§6öâ‡7FW%&Wf–WuF‡2æÆ—fU&VF&6²“°¢76W'DW†7D¶W•6WB‡&VF&6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂw&VF&6µF&vWBrÂv6ö×ÆWF–öârÂwv÷&¶fÆ÷rrÂwfW&F–7BrÂwVç&W6öÇfVBrÂw&W6öÇfVDf–æF–æw2rÂvÖ†–×VÕfW&F–7BuÒÂu7FW"Æ—fR&VF&6²r“°¢76W'DW†7D¶W•6WB‡&VF&6²ç&VF&6µF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂu7FW"Æ—fR&VF&6²F&vWBr“°¢76W'DW†7D¶W•6WB‡&VF&6²æ6ö×ÆWF–öâÂ²wF‚rÂv&Æö"uÒÂu7FW"Æ—fR&VF&6²6ö×ÆWF–öâ&–æF–ærr“°¢76W'DW†7D¶W•6WB‡&VF&6²çVç&W6öÇfVBÂ²urÂuuÒÂu7FW"Æ—fR&VF&6²Vç&W6öÇfVBr“°¢76W'B‡&VF&6²ç66†VÖfW'6–öâÓÓÒbb&VF&6²æ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"×67&VVâ×&ö¦V7F–öâÖÆ—fR×&VF&6²×&÷VæBÓrbb&VF&6²ç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb&VF&6²æ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb&VF&6²æ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu7FW"Æ—fR&VF&6²–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B‡&VF&6²ç&VF&6µF&vWCòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb&VF&6²ç&VF&6µF&vWCòçG&VRÓÓÒF&vWEG&VRÂu7FW"Æ—fR&VF&6²F&vWBF–ffW'2g&öÒ7&—F–2F&vWBr“°¢76W'B‡&VF&6²æ6ö×ÆWF–öãòçF‚ÓÓÒ7FW%&Wf–WuF‡2æ6ö×ÆWF–öâbb&VF&6²æ6ö×ÆWF–öãòæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·7FW%&Wf–WuF‡2æ6ö×ÆWF–öçÖÒ’Âu7FW"Æ—fR&VF&6²FöW2æ÷B&–æB6ö×ÆWF–öâWf–FVæ6Rr“°¢76W'B‡&VF&6²çfW&F–7BÓÓÒu$TE•õDõõ4TÅõ5DU%õc5õ45$TTåõ$ô¤T5D”ôârbb&VF&6²çVç&W6öÇfVCòåÓÓÒbb&VF&6²çVç&W6öÇfVCòåÓÓÒÂu7FW"Æ—fR&VF&6²F–Bæ÷BWF†÷&—¦RF†Rc26VÂr“°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²ç&W6öÇfVDf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’…²u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓuÒ’bb&VF&6²æÖ†–×VÕfW&F–7BÓÓÒu$TE•õDõõ4TÅõ5DU%õc5õ45$TTåõ$ô¤T5D”ôârÂu7FW"&VF&6²&W6öÇfVB6WB÷"Ö†–×VÒfW&F–7BÖ—6ÖF6‚r“°¢6öç7Bv÷&¶fÆ÷rÒ&VF&6²çv÷&¶fÆ÷s°¢76W'B‡v÷&¶fÆ÷sòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbbv÷&¶fÆ÷sòçG&VRÓÓÒF&vWEG&VRbbv÷&¶fÆ÷sòæ6öæ6ÇW6–öâÓÓÒu5T44U52rÂu7FW"Æ—fR&VF&6²v÷&¶fÆ÷rF&vWB÷"6öæ6ÇW6–öâÖ—6ÖF6‚r“°¢76W'B„çVÖ&W"æ—4–çFVvW"‡v÷&¶fÆ÷sòç'Vä–B’bbv÷&¶fÆ÷rç'Vä–BâbbçVÖ&W"æ—4–çFVvW"‡v÷&¶fÆ÷sòæ¦ö$–B’bbv÷&¶fÆ÷ræ¦ö$–BâÂu7FW"Æ—fR&VF&6²v÷&¶fÆ÷r'Vâö¦ö"Ö—76–ærr“°¢76W'B„çVÖ&W"æ—4–çFVvW"‡v÷&¶fÆ÷sòæ'F–f7D–B’bbv÷&¶fÆ÷ræ'F–f7D–Bâbbõç6†#Sc¥¶ÖcÓ•×³cGÒBòçFW7B‡v÷&¶fÆ÷sòæ'F–f7DF–vW7Bóòrr’Âu7FW"Æ—fR&VF&6²v÷&¶fÆ÷r'F–f7B&–æF–ærÖ—76–ærr“°¢76W'B‡v÷&¶fÆ÷ræ'F–f7DæÖRÓÓÒ†6SÖ7W'&VçBÖv÷fW&ææ6RÒG·F&vWD6öÖÖ—GÒÒG·v÷&¶fÆ÷rç'Vä–GÒÒG·v÷&¶fÆ÷rç'VäGFV×GÖÂu7FW"Æ—fR&VF&6²v÷&¶fÆ÷r'F–f7BæÖRFöW2æ÷B&–æBF†R6VÖçF–2F&vWB÷'VâöGFV×Br“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R‡v÷&¶fÆ÷rÂu7FW"Æ—fR&VF&6²r“°¢6öç7Bv÷&¶fÆ÷uFW‡BÒFW‡B‚ræv—F‡V"÷v÷&¶fÆ÷w2÷fW&–g’Ö7W'&VçBÖv÷fW&ææ6Rç–ÖÂr“°¢f÷"†6öç7B6öÖÖæBöb°¢væöFR6–×VÆF–öâ÷fÆ–FFRÖ6æF–FFR×c2æÖ§2rÀ¢væöFR6–×VÆF–öâ÷fÆ–FFRÖW†V7WF–öâÖ6öçG&7B×c2æÖ§2rÀ¢væöFR6–×VÆF–öâ÷fÆ–FFR×'Vâ×Æâ×c2æÖ§2rÀ¢væöFR6–×VÆF–öâöf—‡GW&W2÷c2÷fÆ–FFRÖf—‡GW&W2æÖ§2rÀ¢væöFR6–×VÆF–öâ÷fÆ–FFR×&W7VÇB×c2æÖ§2rÀ¢væöFR6–×VÆF–öâ÷fW&–g’×7FW"×c2æÖ§2rÀ¢æöFRG·c5&ö¦V7F–öåfW&–f–W%F‡Ö ¢Ò’76W'B‡v÷&¶fÆ÷uFW‡Bæ–æ6ÇVFW2†6öÖÖæB’Â7FW"F&vWBv÷&¶fÆ÷röÖ—G2&WV—&VB&R×6VÂc26öÖÖæC¢G¶6öÖÖæGÖ“°¢6öç7B&VF&6´6öÖÖ—BÒf—'7DFD6öÖÖ—B‡7FW%&Wf–WuF‡2æÆ—fU&VF&6²“°¢76W'B‡&VF&6´6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG·&VF&6´6öÖÖ—GÕæÒ’ÓÓÒ6ö×ÆWF–öä6öÖÖ—BÂu7FW"Æ—fR&VF&6²×W7B–ÖÖVF–FVÇ’föÆÆ÷r6ö×ÆWF–öâr“°¢76W'DW†7D6†ævVEF‡2†6ö×ÆWF–öä6öÖÖ—BÂ&VF&6´6öÖÖ—BÂ·7FW%&Wf–WuF‡2æÆ—fU&VF&6µÒÂu7FW"Æ—fR×&VF&6²6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡7FW%&Wf–WuF‡2æÆ—fU&VF&6²Â&VF&6´6öÖÖ—B“°¢–b‚6VÂ’&WGW&â²F&vWD6öÖÖ—BÂ7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ&VF&6´6öÖÖ—BÓ° ¢6öç7B6öÖÖ—G2Ò°¢7&—F–3¢7&—F–46öÖÖ—BÀ¢f–æÄ§VFvS¢§VFvT6öÖÖ—BÀ¢6ö×ÆWF–öã¢6ö×ÆWF–öä6öÖÖ—BÀ¢Æ—fU&VF&6³¢&VF&6´6öÖÖ—BÀ¢6VÃ¢f—'7DFD6öÖÖ—B‡c56VÅF‚¢Ó°¢76W'B„ö&¦V7BçfÇVW2†6öÖÖ—G2’æWfW'’„&ööÆVâ’bbæWr6WB„ö&¦V7BçfÇVW2†6öÖÖ—G2’’ç6—¦RÓÓÒRÂu7FW"7&—F–2Â§VFvRÂ6ö×ÆWF–öâÂ&VF&6²æB6VÂ×W7B&Rf—fRF—7F–æ7B6öÖÖ—G2r“°¢76W'B‡F&vWD6öÖÖ—BÓÒ6öÖÖ—G2æ7&—F–2bb—4æ6W7F÷"‡F&vWD6öÖÖ—BÂ6öÖÖ—G2æ7&—F–2’Âu7FW"7&—F–2×W7BföÆÆ÷r—G2W†7BVF—FVB6öçFVçBr“°¢76W'B†v—B…²w&Wb×'6RrÂG¶6öÖÖ—G2æ7&—F–7ÕæÒ’ÓÓÒF&vWD6öÖÖ—BÂu7FW"7&—F–2×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†RVF—FVB6öçFVçBr“°¢76W'B†v—B…²w&Wb×'6RrÂG¶6öÖÖ—G2æf–æÄ§VFvWÕæÒ’ÓÓÒ6öÖÖ—G2æ7&—F–2Âu7FW"f–æÂ§VFvR×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R–æFWVæFVçB7&—F–2r“°¢76W'B†v—B…²w&Wb×'6RrÂG¶6öÖÖ—G2æ6ö×ÆWF–öçÕæÒ’ÓÓÒ6öÖÖ—G2æf–æÄ§VFvRÂu7FW"6ö×ÆWF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†Rf–æÂ§VFvRr“°¢76W'B†v—B…²w&Wb×'6RrÂG¶6öÖÖ—G2æÆ—fU&VF&6·ÕæÒ’ÓÓÒ6öÖÖ—G2æ6ö×ÆWF–öâÂu7FW"Æ—fR&VF&6²×W7B–ÖÖVF–FVÇ’föÆÆ÷r6ö×ÆWF–öâr“°¢6öç7B&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—BÒ&W6öÇfU7FW%&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—B‚“°¢–b‡&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—B’°¢76W'B†v—B…²w&Wb×'6RrÂG·&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—GÕæÒ’ÓÓÒ6öÖÖ—G2æÆ—fU&VF&6²Âu7FW"&R×6VÂfW&–f–W"6÷'&V7F–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rÆ—fR&VF&6²r“°¢76W'B†v—B…²w&Wb×'6RrÂG¶6öÖÖ—G2ç6VÇÕæÒ’ÓÓÒ&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—BÂwc26VÂ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†RFVF–6FVB&R×6VÂfW&–f–W"6÷'&V7F–öâr“°¢ÒVÇ6R°¢76W'B†v—B…²w&Wb×'6RrÂG¶6öÖÖ—G2ç6VÇÕæÒ’ÓÓÒ6öÖÖ—G2æÆ—fU&VF&6²Âwc26VÂ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R7FW"Æ—fR&VF&6²r“°¢Ð¢76W'DW†7D6†ævVEF‡2‡F&vWD6öÖÖ—BÂ6öÖÖ—G2æ7&—F–2Â·7FW%&Wf–WuF‡2æ7&—F–5ÒÂu7FW"7&—F–26öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2†6öÖÖ—G2æ7&—F–2Â6öÖÖ—G2æf–æÄ§VFvRÂ·7FW%&Wf–WuF‡2æf–æÄ§VFvUÒÂu7FW"f–æÂÖ§VFvR6öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2†6öÖÖ—G2æf–æÄ§VFvRÂ6öÖÖ—G2æ6ö×ÆWF–öâÂ·7FW%&Wf–WuF‡2æ6ö×ÆWF–öåÒÂu7FW"6ö×ÆWF–öâ6öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2†6öÖÖ—G2æ6ö×ÆWF–öâÂ6öÖÖ—G2æÆ—fU&VF&6²Â·7FW%&Wf–WuF‡2æÆ—fU&VF&6µÒÂu7FW"Æ—fR×&VF&6²6öÖÖ—Br“°¢–b‡&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—B’°¢76W'DW†7D6†ævVEF‡2†6öÖÖ—G2æÆ—fU&VF&6²Â&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—BÂ²wFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2uÒÂu7FW"&R×6VÂfW&–f–W"Ö6÷'&V7F–öâ6öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2‡&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—BÂ6öÖÖ—G2ç6VÂÂ·c56VÅF…ÒÂu7FW"c2×6VÂ6öÖÖ—Br“°¢ÒVÇ6R°¢76W'DW†7D6†ævVEF‡2†6öÖÖ—G2æÆ—fU&VF&6²Â6öÖÖ—G2ç6VÂÂ·c56VÅF…ÒÂu7FW"c2×6VÂ6öÖÖ—Br“°¢Ð¢6öç7B&Wf–WtWf–FVæ6U6WBÒæWr6WB„ö&¦V7BçfÇVW2‡7FW%&Wf–WuF‡2’“°¢f÷"†6öç7B&–æF–æröb6VÂæ&–æF–æw2’°¢–b‚&Wf–WtWf–FVæ6U6WBæ†2†&–æF–ærçF‚’’°¢6öç7B&–æF–æt6öÖÖ—BÒ&–æF–ærçF‚ÓÓÒwFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2rbb&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—@¢ò&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—@¢¢F&vWD6öÖÖ—C°¢76W'B†v—B…²w&Wb×'6RrÂG¶&–æF–æt6öÖÖ—GÓ¢G¶&–æF–ærçF‡ÖÒ’ÓÓÒ&–æF–æræ&Æö"Â7FW"&Wf–WvVB6÷W&6RF–ffW'2g&öÒc26öçFVçB&–æF–æs¢G¶&–æF–ærçF‡Ö“°¢Ð¢Ð¢f÷"†6öç7B¶¶W’Âf–ÆUÒöbö&¦V7BæVçG&–W2‡7FW%&Wf–WuF‡2’’°¢6öç7B&Æö"Ò76W'DFFVDöæ6TæEVæ6†ævVB†f–ÆRÂ6öÖÖ—G5¶¶W•Ò“°¢76W'B‡6VÂç&Wf–WtWf–FVæ6Sòå¶¶W•ÓòçF‚ÓÓÒf–ÆRbb6VÂç&Wf–WtWf–FVæ6Sòå¶¶W•Óòæ&Æö"ÓÓÒ&Æö"Âc26VÂFöW2æ÷B&–æB–Ö×WF&ÆR7FW"G¶¶W—ÒWf–FVæ6V“°¢Ð¢6öç7Bg&÷¦Väg&öÕ6VÖçF–5F&vWBÒ6VÂæ&–æF–æw0¢æf–ÇFW"†&–æF–ærÓâ&Wf–WtWf–FVæ6U6WBæ†2†&–æF–ærçF‚’bb‡&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—Bbb&–æF–ærçF‚ÓÓÒwFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2r’¢æÖ†&–æF–ærÓâ&–æF–ærçF‚“°¢76W'DæõF„6†ævW56–æ6R‡F&vWD6öÖÖ—BÂ6öÖÖ—G2ç6VÂÂg&÷¦Väg&öÕ6VÖçF–5F&vWBÂu7FW"6VÖçF–2F&vWBg&VW¦RF‡&÷Vv‚6VÂr“°¢–b‡&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—B’76W'DæõF„6†ævW56–æ6R‡&U6VÅfW&–f–W$6÷'&V7F–öä6öÖÖ—BÂ6öÖÖ—G2ç6VÂÂ²wFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2uÒÂu7FW"6÷'&V7FVBfW&–f–W"g&VW¦RF‡&÷Vv‚6VÂr“°§Ð ¦gVæ7F–öâfW&–g•c4WF†÷&—G•ö–çFW'2‚’°¢76W'B„¥4ôâç7G&–æv–g’†WF†÷&—G’æW†V7WF&ÆT6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE757FW$WF†÷&—G’’ÂvWF†÷&—G’7FW"52ö&¦V7BF–ffW'2g&öÒF†RW†7Bc26öçG&7Br“°¢76W'B„¥4ôâç7G&–æv–g’‡7FGW2æW†V7WF&ÆT6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVEc4WF†÷&—G•ö–çFW'2’Âu$ô¤T5Eõ5DEU27FW"c2ö–çFW"Ö—'&÷"Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡6–Òç7FW"’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE757FW%6–×VÆF–öâ’Âw6–×VÆF–öâ7FW"52ö&¦V7BF–ffW'2g&öÒF†RW†7Bc26öçG&7Br“°¢76W'B„¥4ôâç7G&–æv–g’†F—7F6†W"ç7FW$W†V7WF&ÆT6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVEc4WF†÷&—G•ö–çFW'2’ÂvF—7F6†W"7FW"c2ö–çFW"Ö—'&÷"Ö—6ÖF6‚r“°¢76W'B†F—7F6†W"æ6æöæ–6Å6VÇ3òç7FW"ÓÓÒc56VÅF‚bbF—7F6†W"ç66÷UG'WFƒòç7FW"ÓÓÒu55ô4ôåE$5BrÂvF—7F6†W"7FW"6VÂ÷7FGW2Ö—'&÷"Ö—6ÖF6‚r“°¢6öç7BW‡V7FVE6æ6†÷BÒWF†÷&—G•6æ6†÷DÆ–æR†WF†÷&—G’Â7FGW2“°¢f÷"†6öç7Bf–ÆRöb²uTÄ•E•ôtDRæÖBrÂu$ô¤T5Eô„äDõdU"æÖBrÂræv—F‡V"÷v÷&¶fÆ÷w2ô5U%$TåEõ5DEU2æÖBrÂttTåE2æÖBrÂu$TDÔRæÖBuÒ’°¢6öç7B7W'&VçEFW‡BÒFW‡B†f–ÆR“°¢–b‚†6S6Æ÷6VB’76W'B†7W'&VçEFW‡Bæ–æ6ÇVFW2‚u55ô4ôåE$5Br’bb7W'&VçEFW‡Bæ–æ6ÇVFW2‡c56VÅF‚’Â7W'&VçBÖ&¶F÷vâ7FW"c2Ö—'&÷"Ö—6ÖF6ƒ¢G¶f–ÆWÖ“°¢76W'E6–ævÆTWF†÷&—G•6æ6†÷B†7W'&VçEFW‡BÂW‡V7FVE6æ6†÷BÂf–ÆR“°¢Ð§Ð ¦gVæ7F–öâfW&–g”F—&V7Ec56VÖçF–72‚’°¢6öç7B6æöæ–6ÅF‚Òv6æöæ–6Âõ45$TTåõ5DDUõ$Tt•5E%’æ§6öâs°¢6öç7B6æF–FFUc%F‚Òw6–×VÆF–öâö6æF–FFR×c"æ§6öâs°¢6öç7B6æF–FFUc5F‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2æ6æF–FFS°¢6öç7B'VåÆåc%F‚Òw6–×VÆF–öâ÷'Vâ×Æâ×c"æ§6öâs°¢6öç7B'VåÆåc5F‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2ç'VåÆã°¢6öç7BW†V7WF–öåc%F‚Òw6–×VÆF–öâöW†V7WF–öâÖ6öçG&7B×c"æ§6öâs°¢6öç7BW†V7WF–öåc5F‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7C°¢6öç7B6æF–FFU66†VÖc5F‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2ç66†VÖ°¢6öç7BW†V7WF–öå66†VÖc5F‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7E66†VÖ°¢6öç7B'VåÆå66†VÖc5F‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2ç'VåÆå66†VÖ°¢6öç7B&W7VÇE66†VÖc5F‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2ç&W7VÇE66†VÖ°¢6öç7BVÆ–f–6F–öåc%F‚ÒwVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷VÆ–f–6F–öâ×&W7VÇBæ§6öâs°¢6öç7BVÆ–f–6F–öåc5F‚ÒwVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ÷VÆ–f–6F–öâ×&W7VÇB×c2æ§6öâs°¢6öç7B66WFæ6UF‚ÒwVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓö66WFæ6RÖÖG&—‚æ§6öâs°¢6öç7B6÷fW&vUF‚ÒwVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ÷67&VVâ×&ö¦V7F–öâÖ6÷fW&vRÖÆVFvW"æ§6öâs°¢6öç7BçVÖW&–4–×7EF‚ÒwVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓöçVÖW&–2ÖæöâÖ–×7Bæ§6öâs°¢6öç7B&Wf–WtWf–FVæ6UF‡2ÒæWr6WB„ö&¦V7BçfÇVW2‡7FW%&Wf–WuF‡2’“°¢6öç7BF—&V7E6VÖçF–5F‡2Ò²ââææWr6WB…°¢6æöæ–6ÅF‚Â6æF–FFUc%F‚Â6æF–FFUc5F‚Â'VåÆåc%F‚Â'VåÆåc5F‚À¢W†V7WF–öåc%F‚ÂW†V7WF–öåc5F‚Â6æF–FFU66†VÖc5F‚ÂW†V7WF–öå66†VÖc5F‚À¢'VåÆå66†VÖc5F‚Â&W7VÇE66†VÖc5F‚ÂVÆ–f–6F–öåc%F‚ÂVÆ–f–6F–öåc5F‚À¢66WFæ6UF‚Â6÷fW&vUF‚ÂçVÖW&–4–×7EF‚À¢ââç&WV—&VEc4&–æF–æuF‡2æf–ÇFW"†f–ÆRÓâ&Wf–WtWf–FVæ6UF‡2æ†2†f–ÆR’¢Ò•Ó°¢f÷"†6öç7Bf–ÆRöbF—&V7E6VÖçF–5F‡2’°¢76W'B†W†—7G2†f–ÆR’ÂF—&V7Bc26VÖçF–2–çWBÖ—76–æs¢G¶f–ÆWÖ“°¢76W'E&VwVÆ$v—Df–ÆR†f–ÆRÂvF—&V7Bc26VÖçF–2fW&–f–6F–öâr“°¢Ð¢76W'B†v—B…²w&Wb×'6RrÂ„TC¢G¶6æöæ–6ÅF‡ÖÒ’ÓÓÒs6cc33vF&VC3““33fF&cF–SC“†Vf3SC&RrÂv6æöæ–6Â67&VVâ&Vv—7G'’&Æö"6†ævVBr“°¢6öç7B6æöæ–6ÂÒ§6öâ†6æöæ–6ÅF‚“°¢6öç7B6æF–FFUc"Ò§6öâ†6æF–FFUc%F‚“°¢6öç7B6æF–FFUc2Ò§6öâ†6æF–FFUc5F‚“°¢6öç7BW‡V7FVE&ö¦V7F–öâÒ°¢6÷VçC¢7G&–ær†6æöæ–6Âç67&VVä6÷VçB’À¢&Vv—7G'“¢6æöæ–6Âç67&VVç2À¢vÆö&Å'VÆW3¢6æöæ–6ÂævÆö&Å'VÆW2À¢Væ—fW'6Å&V6÷fW'“¢6æöæ–6ÂçVæ—fW'6Å&V6÷fW'’À¢vÆö&Ä–çf&–çG3¢6æöæ–6ÂævÆö&Ä–çf&–çG0¢Ó°¢6öç7B66WFæ6RÒ§6öâ†66WFæ6UF‚“°¢76W'DW†7D¶W•6WB†66WFæ6RÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂw66÷RrÂw&WV—&VÖVçG2rÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BrÂw&VÆV6T&÷VæF&–W2uÒÂu7FW"7WÆVÖVçB66WFæ6Rr“°¢76W'DW†7D¶W•6WB†66WFæ6RçVç&W6öÇfVBÂ²urÂuuÒÂu7FW"7WÆVÖVçB66WFæ6RVç&W6öÇfVBr“°¢76W'DW†7D¶W•6WB†66WFæ6Rç&VÆV6T&÷VæF&–W2Â²w7FWE72rÂw7FWTÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂwW6W%f—7VÄ&÷fÂrÂw'VçF–ÖT÷%3$6†ævVBuÒÂu7FW"7WÆVÖVçB66WFæ6R&VÆV6R&÷VæF&–W2r“°¢76W'B†66WFæ6Rç66†VÖfW'6–öâÓÓÒbb66WFæ6Rç66÷RÓÓÒudU%4”ôäTEõc5õ45$TTåõ$ô¤T5D”ôåôôäÅ’rÂu7FW"7WÆVÖVçB66WFæ6R66†VÖ÷"66÷RÖ—6ÖF6‚r“°¢76W'B†66WFæ6Ræ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ3"Ö66WFæ6Rrbb66WFæ6Rç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb66WFæ6Ræ'&æ6‚ÓÓÒv¶–Ö’rbb66WFæ6Ræ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu7FW"7WÆVÖVçB66WFæ6R–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†66WFæ6RçfW&F–7BÓÓÒu55õ5DU%õ45$TTåõ$ô¤T5D”ôåô44UDä4Rrbb66WFæ6RçVç&W6öÇfVCòåÓÓÒbb66WFæ6RçVç&W6öÇfVCòåÓÓÒbb66WFæ6RæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%õc5ô”äDUTäDTåEõ$Ud”UrrÂu7FW"7WÆVÖVçB66WFæ6RfW&F–7B÷"&÷VæF'’Ö—6ÖF6‚r“°¢6öç7BW‡V7FVD66WFæ6U&WV—&VÖVçG2Ò°¢tÄõ54ÄU55ô4äôä”4Åõ45$TTåõ$ô¤T5D”ôârÀ¢uc%ôäôåõ45$TTåô4ôåDTåEôU„5DÅ•õ$U4U%dTBrÀ¢t4Äõ4TEõc5õ44„TÔ2rÀ¢tÕUDD”ôåõ$T¤T5D”ôåôäEõõ4•D•dUõDTÕô4õ’rÀ¢te$õ¤TåôTät”äUõTÄ”d”4D”ôåõ$U$ôET5D”ôârÀ¢tåTÔU$”5ôäôåô”Õ5Eõ$õdTârÀ¢t”äDUTäDTåEõ$Ud”Uuô4„”åõ$UT•$TBrÀ¢u%TåD”ÔUõ3%õ$ôET5D”ôåõTä4„ätTBp¢Ó°¢76W'B„¥4ôâç7G&–æv–g’†66WFæ6Rç&WV—&VÖVçG2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD66WFæ6U&WV—&VÖVçG2æÖ†–BÓâ‡²–BÂ7FGW3¢u52rÒ’’’Âu7FW"7WÆVÖVçB66WFæ6R&WV—&VÖVçG2&R–æ6ö×ÆWFRr“°¢76W'B„¥4ôâç7G&–æv–g’†66WFæ6Rç&VÆV6T&÷VæF&–W2’ÓÓÒ¥4ôâç7G&–æv–g’‡²7FWE73¢fÇ6RÂ7FWTÆÆ÷vVC¢fÇ6RÂ&öGV7F–öäÆ–46†ævVC¢fÇ6RÂ‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÂW6W%f—7VÄ&÷fÃ¢fÇ6RÂ'VçF–ÖT÷%3$6†ævVC¢fÇ6RÒ’Âu7FW"7WÆVÖVçB66WFæ6R&VÆV6R&÷VæF'’Ö—6ÖF6‚r“° ¢6öç7B6÷fW&vRÒ§6öâ†6÷fW&vUF‚“°¢6öç7BW‡V7FVDf–VÆDfÖ–Æ–W2Ò²v–BrÂvæÖRrÂw&W7öç6–&–Æ—F–W2rÂvWF†÷&—G’rÂw&WV—&VE7FFRrÂwV•7FFW2rÂw6W'fW$÷væVE7FFRuÓ°¢76W'DW†7D¶W•6WB†6÷fW&vRÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6æöæ–6ÂrÂw67&VVä6÷VçBrÂvf–VÆDfÖ–Æ–W2rÂw67&VVä6÷fW&vRrÂw&ö¦V7F–öå6†#SbrÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂw67&VVâ×&ö¦V7F–öâ6÷fW&vRÆVFvW"r“°¢76W'DW†7D¶W•6WB†6÷fW&vRæ6æöæ–6ÂÂ²wF‚rÂv&Æö"uÒÂw67&VVâ×&ö¦V7F–öâ6÷fW&vR6æöæ–6Â&–æF–ærr“°¢76W'DW†7D¶W•6WB†6÷fW&vRçVç&W6öÇfVBÂ²urÂuuÒÂw67&VVâ×&ö¦V7F–öâ6÷fW&vRVç&W6öÇfVBr“°¢76W'B†6÷fW&vRç66†VÖfW'6–öâÓÓÒbb6÷fW&vRç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb6÷fW&vRæ'&æ6‚ÓÓÒv¶–Ö’rbb6÷fW&vRæ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚bb6÷fW&vRæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%õc5ô”äDUTäDTåEõ$Ud”UrrÂw67&VVâ×&ö¦V7F–öâ6÷fW&vR–FVçF—G’÷"Ö†–×VÒfW&F–7BÖ—6ÖF6‚r“°¢76W'B†6÷fW&vRæ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"×67&VVâ×&ö¦V7F–öâÖ6÷fW&vRÖÆVFvW"×&÷VæBÓrbb6÷fW&vRçfW&F–7BÓÓÒu55ôÄõ54ÄU55ô4äôä”4Åõ45$TTåõ$ô¤T5D”ôârbb6÷fW&vRçVç&W6öÇfVCòåÓÓÒbb6÷fW&vRçVç&W6öÇfVCòåÓÓÒÂw67&VVâ×&ö¦V7F–öâ6÷fW&vRÆVFvW"fW&F–7BÖ—6ÖF6‚r“°¢76W'B†6÷fW&vRæ6æöæ–6ÃòçF‚ÓÓÒ6æöæ–6ÅF‚bb6÷fW&vRæ6æöæ–6Ãòæ&Æö"ÓÓÒs6cc33vF&VC3““33fF&cF–SC“†Vf3SC&Rrbb6÷fW&vRç67&VVä6÷VçBÓÓÒs"rÂw67&VVâ×&ö¦V7F–öâ6÷fW&vRÆVFvW"6æöæ–6Â&–æF–ærÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6÷fW&vRæf–VÆDfÖ–Æ–W2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf–VÆDfÖ–Æ–W2’Âw67&VVâ×&ö¦V7F–öâ6÷fW&vRÆVFvW"f–VÆBfÖ–Æ–W2&R–æ6ö×ÆWFRr“°¢6öç7BW‡V7FVE67&VVä6÷fW&vRÒ6æöæ–6Âç67&VVç2æÖ†VçG'’Óâ‡°¢–C¢VçG'’æ–BÀ¢f–VÆDfÖ–Æ–W3¢W‡V7FVDf–VÆDfÖ–Æ–W2À¢6æöæ–6ÄVçG'•6†#Sc¢6†#Sd6æöæ–6Â†VçG'’’À¢7FGW3¢u52p¢Ò’“°¢76W'B„¥4ôâç7G&–æv–g’†6÷fW&vRç67&VVä6÷fW&vR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE67&VVä6÷fW&vR’Âw67&VVâ×&ö¦V7F–öâ6÷fW&vRÆVFvW"FöW2æ÷B&–æBÆÂ"6æöæ–6ÂVçG&–W2æBf–VÆBfÖ–Æ–W2r“°¢76W'B†6÷fW&vRç&ö¦V7F–öå6†#SbÓÓÒvV&VS6C#C–#ƒ63fcs3vcvS“ƒS6CCSƒcf3CƒfC3V6C#“ƒ3ƒFSvSSc“sV#CFc#&RrÂw67&VVâ×&ö¦V7F–öâ6÷fW&vRF–vW7BÖ—6ÖF6‚r“° ¢6öç7BçVÖW&–4–×7BÒ§6öâ†çVÖW&–4–×7EF‚“°¢76W'DW†7D¶W•6WB†çVÖW&–4–×7BÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂv6†ævVD§6öåö–çFW'2rÂvVæv–æT6öç7VÖW$6÷VçBrÂv6öç7VÖW%66ârÂv6æF–FFT÷WG6–FU67&VVç2rÂwVÆ–f–6F–öârÂvW†V7WF–öå&W'Vä6Æ–ÒrÂw7FW57FGW5&VÖ–ç2rÂw'VçF–ÖT÷%3$6†ævVBrÂwVç&W6öÇfVBrÂwfW&F–7BrÂvÖ†–×VÕfW&F–7BuÒÂvçVÖW&–2æöâÖ–×7BWf–FVæ6Rr“°¢76W'DW†7D¶W•6WB†çVÖW&–4–×7Bæ6öç7VÖW%66âÂ²vf–ÆW2rÂvÆ—FW&ÄÖF6†W2uÒÂvçVÖW&–2æöâÖ–×7B6öç7VÖW"66âr“°¢76W'DW†7D¶W•6WB†çVÖW&–4–×7Bæ6æF–FFT÷WG6–FU67&VVç2Â²v&Vf÷&U6†#SbrÂvgFW%6†#SbuÒÂvçVÖW&–2æöâÖ–×7B÷WG6–FR×67&VVç2&ööbr“°¢76W'DW†7D¶W•6WB†çVÖW&–4–×7BçVÆ–f–6F–öâÂ²v&Vf÷&TFWFW&Ö–æ—7F–5–ÆöE6†#SbrÂvgFW$FWFW&Ö–æ—7F–5–ÆöE6†#SbrÂvFVWWVÂuÒÂvçVÖW&–2æöâÖ–×7BVÆ–f–6F–öâ&ööbr“°¢76W'DW†7D¶W•6WB†çVÖW&–4–×7BçVç&W6öÇfVBÂ²urÂuuÒÂvçVÖW&–2æöâÖ–×7BVç&W6öÇfVBr“°¢76W'B†çVÖW&–4–×7Bç66†VÖfW'6–öâÓÓÒbbçVÖW&–4–×7Bç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbbçVÖW&–4–×7Bæ'&æ6‚ÓÓÒv¶–Ö’rbbçVÖW&–4–×7Bæ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚bbçVÖW&–4–×7BæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%õc5ô”äDUTäDTåEõ$Ud”UrrÂvçVÖW&–2æöâÖ–×7B–FVçF—G’÷"Ö†–×VÒfW&F–7BÖ—6ÖF6‚r“°¢76W'B†çVÖW&–4–×7Bæ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"×67&VVâ×&ö¦V7F–öâÖçVÖW&–2ÖæöâÖ–×7B×&÷VæBÓrbbçVÖW&–4–×7BçfW&F–7BÓÓÒu55ôåTÔU$”5ôäôåô”Õ5Eôäõõ5DU5õ$U%Tåõ$UT•$TBrbbçVÖW&–4–×7BçVç&W6öÇfVCòåÓÓÒbbçVÖW&–4–×7BçVç&W6öÇfVCòåÓÓÒÂvçVÖW&–2æöâÖ–×7BfW&F–7BÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†çVÖW&–4–×7Bæ6†ævVD§6öåö–çFW'2’ÓÓÒ¥4ôâç7G&–æv–g’…²r÷67&VVç2uÒ’bbçVÖW&–4–×7BæVæv–æT6öç7VÖW$6÷VçBÓÓÒÂvçVÖW&–2æöâÖ–×7BWf–FVæ6RFöW2æ÷B&÷fR67&VVç2ÖöæÇ’Â¦W&òÖVæv–æRÖ6öç7VÖW"6†ævRr“°¢6öç7BçVÖW&–46öç7VÖW$f–ÆW2Ò°¢w6–×VÆF–öâöVæv–æR×c"öV6öæö×’æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"ö†6‚æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"ö†–v‚×föÇVÖRæÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"ö–æFW‚æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"öçVÖW&–2æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷&æræÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷'Vâ×ÆâæÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷'Vâ×66Væ&–òæÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷7FFRÖÖ6†–æW2æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷7FF—7F–72æÖ§2rÀ¢w6–×VÆF–öâöVæv–æR×c"÷F÷vW"æÖ§2rÀ¢w6–×VÆF–öâöÆ–"×c"÷66†VÖ×fÆ–FF÷"æÖ§2rÀ¢w6–×VÆF–öâöÖ–w&F–öç2÷c×Fò×c"öÖ–w&F–öâÖÖæ§6öâp¢Ó°¢6öç7B67&VVä6öç7VÖW$ÖF6†W2ÒçVÖW&–46öç7VÖW$f–ÆW2æfÆDÖ†f–ÆRÓâ°¢6öç7BÖF6†W2ÒFW‡B†f–ÆR’æÖF6‚‚òƒó¥Âç67&VVç5Æ'ÅÅµ²r%×67&VVç5²r%ÕÅÒ’ör’óòµÓ°¢&WGW&âÖF6†W2æÖ†ÖF6‚Óâ‡²f–ÆRÂÖF6‚Ò’“°¢Ò“°¢76W'B‡67&VVä6öç7VÖW$ÖF6†W2æÆVæwF‚ÓÓÒÂG'W7FVBg&÷¦VâVæv–æR†26æF–FFRç67&VVç26öç7VÖW'3¢G´¥4ôâç7G&–æv–g’‡67&VVä6öç7VÖW$ÖF6†W2—Ö“°¢76W'B„¥4ôâç7G&–æv–g’†çVÖW&–4–×7Bæ6öç7VÖW%66ãòæf–ÆW2’ÓÓÒ¥4ôâç7G&–æv–g’†çVÖW&–46öç7VÖW$f–ÆW2’bbçVÖW&–4–×7Bæ6öç7VÖW%66ãòæÆ—FW&ÄÖF6†W2ÓÓÒÂvçVÖW&–2æöâÖ–×7B6öç7VÖW"×66âÖæ–fW7BÖ—6ÖF6‚r“°¢76W'B†çVÖW&–4–×7Bæ6æF–FFT÷WG6–FU67&VVç3òæ&Vf÷&U6†#SbÓÓÒvF3V#SsSCƒ#ƒcfF#F“C“Sv#Sƒ&3S6V3“6fC“cCCVc3“ƒS“–V–S#vCƒRrbbçVÖW&–4–×7Bæ6æF–FFT÷WG6–FU67&VVç3òægFW%6†#SbÓÓÒçVÖW&–4–×7Bæ6æF–FFT÷WG6–FU67&VVç2æ&Vf÷&U6†#SbÂvçVÖW&–2æöâÖ–×7B÷WG6–FR×67&VVç2F–vW7BÖ—6ÖF6‚r“°¢76W'B†çVÖW&–4–×7BçVÆ–f–6F–öãòæ&Vf÷&TFWFW&Ö–æ—7F–5–ÆöE6†#SbÓÓÒv#FfVF&6c3&3Csv3ƒSssC36C#“v#s&&&Vcƒ633ƒƒ3ccC#Sc&2rbbçVÖW&–4–×7BçVÆ–f–6F–öãòægFW$FWFW&Ö–æ—7F–5–ÆöE6†#SbÓÓÒçVÖW&–4–×7BçVÆ–f–6F–öâæ&Vf÷&TFWFW&Ö–æ—7F–5–ÆöE6†#SbbbçVÖW&–4–×7BçVÆ–f–6F–öãòæFVWWVÂÓÓÒG'VRÂvçVÖW&–2æöâÖ–×7BVÆ–f–6F–öâ&ööbÖ—6ÖF6‚r“°¢76W'B†çVÖW&–4–×7BæW†V7WF–öå&W'Vä6Æ–ÒÓÓÒtäõõ5DU5ôU„T5UD”ôåõ$U%Tåô4Ä”ÔTBrbbçVÖW&–4–×7Bç7FW57FGW5&VÖ–ç2ÓÓÒu55ôÔôDTÂrbbçVÖW&–4–×7Bç'VçF–ÖT÷%3$6†ævVBÓÓÒfÇ6RÂvçVÖW&–2æöâÖ–×7BWf–FVæ6R÷fW&6Æ–×2W†V7WF–öâ÷"&öGV7B6†ævW2r“° ¢6öç7Bf—‡GW&TÖæ–fW7EF‚Òw6–×VÆF–öâöf—‡GW&W2÷c2öÖæ–fW7Bæ§6öâs°¢6öç7Bf—‡GW&TæVvF—fUF‚Òw6–×VÆF–öâöf—‡GW&W2÷c2öæVvF—fRæ§6öâs°¢6öç7Bf—‡GW&UfÆ–FF÷%F‚Òw6–×VÆF–öâöf—‡GW&W2÷c2÷fÆ–FFRÖf—‡GW&W2æÖ§2s°¢6öç7BW‡V7FVDf—‡GW&T66W2Ò°¢²–C¢w67&VVâÖ6÷VçBÖG&–gBrÂF&vWC¢v6æF–FFR×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢w67&VVâÖ–BÖG&–gBrÂF&vWC¢v6æF–FFR×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢w67&VVâÖVçG'’ÖG&–gBrÂF&vWC¢v6æF–FFR×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢vvÆö&Â×'VÆW2ÖG&–gBrÂF&vWC¢v6æF–FFR×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢wVæ—fW'6Â×&V6÷fW'’ÖG&–gBrÂF&vWC¢v6æF–FFR×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢vvÆö&ÂÖ–çf&–çG2ÖG&–gBrÂF&vWC¢v6æF–FFR×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢v6æF–FFRÖW‡G&×&÷W'G’rÂF&vWC¢v6æF–FFR×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢vW†V7WF–öâÖ6öçG&7BÖ–BÖG&–gBrÂF&vWC¢vW†V7WF–öâÖ6öçG&7B×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢w'Vâ×ÆâÖ–BÖG&–gBrÂF&vWC¢w'Vâ×Æâ×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢w&W7VÇBÖ6æF–FFRÖF–vW7BÖG&–gBrÂF&vWC¢w&W7VÇB×c2rÂW‡V7FVD6öFS¢u44„TÔrÒÀ¢²–C¢w&W7VÇBÖfÇ6R×7FW2ÖWF†÷&—¦F–öârÂF&vWC¢w&W7VÇB×c2rÂW‡V7FVD6öFS¢u44„TÔrÐ¢Ó°¢6öç7Bf—‡GW&TæVvF—fRÒ§6öâ†f—‡GW&TæVvF—fUF‚“°¢76W'B„¥4ôâç7G&–æv–g’†f—‡GW&TæVvF—fR’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢66†VÖfW'6–öã¢À¢'F–f7D–C¢v6G2×F÷vW"×7FW"×c2ÖæVvF—fRÖf—‡GW&W2×&÷VæBÓrÀ¢66T6÷VçC¢7G&–ær†W‡V7FVDf—‡GW&T66W2æÆVæwF‚’À¢66W3¢W‡V7FVDf—‡GW&T66W0¢Ò’Âwc2æVvF—fRf—‡GW&R6FÆörF–ffW'2g&öÒF†RW†7B–æFWVæFVçFÇ’W†W&6—6VB66R6WBr“°¢6öç7Bf—‡GW&TÖæ–fW7BÒ§6öâ†f—‡GW&TÖæ–fW7EF‚“°¢6öç7BW‡V7FVDf—‡GW&TÖæ–fW7BÒ°¢66†VÖfW'6–öã¢À¢'F–f7D–C¢v6G2×F÷vW"×7FW"×c2Öf—‡GW&RÖÖæ–fW7B×&÷VæBÓrÀ¢fW&F–7C¢u55ô4Äõ4TEõc5ôÕUDD”ôåôd•…EU$U2rÀ¢66T6÷VçC¢7G&–ær†W‡V7FVDf—‡GW&T66W2æÆVæwF‚’À¢66T–G3¢W‡V7FVDf—‡GW&T66W2æÖ†VçG'’ÓâVçG'’æ–B’À¢f–ÆW3¢°¢²Fƒ¢f—‡GW&TæVvF—fUF‚Â6†#Sc¢6†#SeFW‡B‡FW‡B†f—‡GW&TæVvF—fUF‚’’Â'—FW3¢7G&–ær„'VffW"æ'—FTÆVæwF‚‡FW‡B†f—‡GW&TæVvF—fUF‚’ÂwWFc‚r’’ÒÀ¢²Fƒ¢f—‡GW&UfÆ–FF÷%F‚Â6†#Sc¢6†#SeFW‡B‡FW‡B†f—‡GW&UfÆ–FF÷%F‚’’Â'—FW3¢7G&–ær„'VffW"æ'—FTÆVæwF‚‡FW‡B†f—‡GW&UfÆ–FF÷%F‚’ÂwWFc‚r’’Ð¢Ð¢Ó°¢76W'B„¥4ôâç7G&–æv–g’†f—‡GW&TÖæ–fW7B’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDf—‡GW&TÖæ–fW7B’Âwc2f—‡GW&RÖæ–fW7BFöW2æ÷BW†7FÇ’&–æBF†RæVvF—fR6FÆöræBfÆ–FF÷"r“°¢76W'B„¥4ôâç7G&–æv–g’†6æF–FFUc2ç67&VVç2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE&ö¦V7F–öâ’Âv6æF–FFR×c267&VVç2—2æ÷BF†RÆ÷76ÆW726æöæ–6Â&ö¦V7F–öâr“°¢76W'B‡6†#Sd6æöæ–6Â†6æF–FFUc2ç67&VVç2’ÓÓÒvV&VS6C#C–#ƒ63fcs3vcvS“ƒS6CCSƒcf3CƒfC3V6C#“ƒ3ƒFSvSSc“sV#CFc#&RrÂv6æF–FFR×c267&VVâ&ö¦V7F–öâF–vW7BÖ—6ÖF6‚r“°¢6öç7B²67&VVç3¢–væ÷&VEc%67&VVç2Âââæ÷WG6–FUc"ÒÒ6æF–FFUc#°¢6öç7B²67&VVç3¢–væ÷&VEc567&VVç2Âââæ÷WG6–FUc2ÒÒ6æF–FFUc3°¢76W'B„¥4ôâç7G&–æv–g’†÷WG6–FUc2’ÓÓÒ¥4ôâç7G&–æv–g’†÷WG6–FUc"’Âv6æF–FFR×c26†ævVB6öçFVçB÷WG6–FR÷67&VVç2r“°¢76W'B‡6†#Sd6æöæ–6Â†÷WG6–FUc2’ÓÓÒvF3V#SsSCƒ#ƒcfF#F“C“Sv#Sƒ&3S6V3“6fC“cCCVc3“ƒS“–V–S#vCƒRrÂv6æF–FFR×c2÷WG6–FR×67&VVç2F–vW7BÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6æF–FFUc2’ÓÓÒ¥4ôâç7G&–æv–g’‡²ââæ6æF–FFUc"Â67&VVç3¢W‡V7FVE&ö¦V7F–öâÒ’Âv6æF–FFR×c2F–ffW'2g&öÒF†RW†7B6÷'&V7FVB6æF–FFR&ö¦V7F–öâr“°¢6öç7B6æF–FFU66†VÖc2Ò§6öâ†6æF–FFU66†VÖc5F‚“°¢6öç7BW‡V7FVD6æF–FFU66†VÖc2Ò°¢G66†VÖ¢v‡GG3¢òö§6öâ×66†VÖæ÷&röG&gBó##Ó"÷66†VÖrÀ¢F–C¢v‡GG3¢òö6G2×F÷vW"æ–çfÆ–B÷66†VÖö6æF–FFR×c2ç66†VÖæ§6öârÀ¢F—FÆS¢$6Bw2F÷vW"6æF–FFRc267&VVâ×&ö¦V7F–öâ7WÆVÖVçB"À¢FW67&—F–öã¢tW†7B–Ö×WF&ÆR6æF–FFRf÷"F†RfW'6–öæVB67&VVâ×&ö¦V7F–öâ6÷'&V7F–öââÆÂæöâ×67&VVâ6VÖçF–72&VÖ–âc"ârÀ¢6öç7C¢6æF–FFUc0¢Ó°¢76W'B„¥4ôâç7G&–æv–g’†6æF–FFU66†VÖc2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD6æF–FFU66†VÖc2’Âv6æF–FFR×c266†VÖ—2æ÷BF†RW†7B&Wf–WvVB–Ö×WF&ÆR6öçG&7Br“°¢76W'E66†VÖ†6æF–FFUc2Â6æF–FFU66†VÖc2“°¢6öç7B6æF–FFUv—F„W‡G&Ò7G'V7GW&VD6ÆöæR†6æF–FFUc2“°¢6æF–FFUv—F„W‡G&åõ÷VæW‡V7FVBÒG'VS°¢76W'E66†VÖ&V¦V7G2†6æF–FFUv—F„W‡G&Â6æF–FFU66†VÖc2Âv6æF–FFR×c2W‡G&F÷ÖÆWfVÂ&÷W'G’r“°¢6öç7B6æF–FFUv—F…67&VVäG&–gBÒ7G'V7GW&VD6ÆöæR†6æF–FFUc2“°¢6æF–FFUv—F…67&VVäG&–gBç67&VVç2ç&Vv—7G'•³ÒææÖRÒv–çfÆ–B×67&VVâÖæÖRs°¢76W'E66†VÖ&V¦V7G2†6æF–FFUv—F…67&VVäG&–gBÂ6æF–FFU66†VÖc2Âv6æF–FFR×c26æöæ–6Â67&VVâ6öç7Br“° ¢6öç7B'VåÆåc"Ò§6öâ‡'VåÆåc%F‚“°¢6öç7B'VåÆåc2Ò§6öâ‡'VåÆåc5F‚“°¢6öç7BW‡V7FVE'VåÆåc2Ò7G'V7GW&VD6ÆöæR‡'VåÆåc"“°¢W‡V7FVE'VåÆåc2çÆä–BÒv6G2×F÷vW"×'Vâ×Æâ×c2s°¢W‡V7FVE'VåÆåc2æW†V7WF–öä6öçG&7BÒ°¢Fƒ¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7BÀ¢66†VÖFƒ¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7E66†VÖÀ¢fÆ–FF÷%Fƒ¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7EfÆ–FF÷ ¢Ó°¢W‡V7FVE'VåÆåc2æ÷WGWBçVÆ–f–6F–öåF‚ÒVÆ–f–6F–öåc5Fƒ°¢W‡V7FVE'VåÆåc2æ÷WGWBçVÆ–f–6F–öå66†VÖF‚ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2ç&W7VÇE66†VÖ°¢76W'B„¥4ôâç7G&–æv–g’‡'VåÆåc2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE'VåÆåc2’Âw'Vâ×Æâ×c2F–ffW'2÷WG6–FR&Wf–WvVBfW'6–öæVBF‚&–æF–æw2r“°¢6öç7B'VåÆå66†VÖc2Ò§6öâ‡'VåÆå66†VÖc5F‚“°¢6öç7BW‡V7FVE'VåÆå66†VÖc2Ò°¢G66†VÖ¢v‡GG3¢òö§6öâ×66†VÖæ÷&röG&gBó##Ó"÷66†VÖrÀ¢F–C¢v‡GG3¢òö6G2×F÷vW"æ–çfÆ–B÷66†VÖ÷'Vâ×Æâ×c2ç66†VÖæ§6öârÀ¢F—FÆS¢$6Bw2F÷vW"'VâÆâc267&VVâ×&ö¦V7F–öâ7WÆVÖVçB"À¢FW67&—F–öã¢tW†7B–Ö×WF&ÆR'VâÆâf÷"F†RfW'6–öæVB67&VVâ×&ö¦V7F–öâ6÷'&V7F–öâârÀ¢6öç7C¢W‡V7FVE'VåÆåc0¢Ó°¢76W'B„¥4ôâç7G&–æv–g’‡'VåÆå66†VÖc2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE'VåÆå66†VÖc2’Âw'Vâ×Æâ×c266†VÖ—2æ÷BF†RW†7B&Wf–WvVB6öç7B6öçG&7Br“°¢76W'E66†VÖ‡'VåÆåc2Â'VåÆå66†VÖc2“° ¢6öç7BW†V7WF–öåc"Ò§6öâ†W†V7WF–öåc%F‚“°¢6öç7BW†V7WF–öåc2Ò§6öâ†W†V7WF–öåc5F‚“°¢6öç7BW‡V7FVDW†V7WF–öåc2Ò7G'V7GW&VD6ÆöæR†W†V7WF–öåc"“°¢W‡V7FVDW†V7WF–öåc2æ6öçG&7D–BÒv6G2×F÷vW"×7FW2ÖW†V7WF–öâÖ6öçG&7B×c2s°¢W‡V7FVDW†V7WF–öåc2ç6÷W&6UF‡2Ò°¢6æF–FFS¢6æF–FFUc5F‚À¢'VåÆã¢'VåÆåc5F‚À¢66WFæ6S¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓö66WFæ6RÖÖG&—‚æ§6öâp¢Ó°¢W‡V7FVDW†V7WF–öåc2ç&W7VÇD6öçG&7G2çVÆ–f–6F–öå66†VÖÒW‡V7FVEc4WF†÷&—G•ö–çFW'2ç&W7VÇE66†VÖ°¢W‡V7FVDW†V7WF–öåc2ç&W7VÇD6öçG&7G2çVÆ–f–6F–öåfÆ–FF÷"ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2ç&W7VÇEfÆ–FF÷#°¢76W'B„¥4ôâç7G&–æv–g’†W†V7WF–öåc2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDW†V7WF–öåc2’ÂvW†V7WF–öâÖ6öçG&7B×c2F–ffW'2÷WG6–FR&Wf–WvVBfW'6–öæVBF‚&–æF–æw2r“°¢6öç7BW†V7WF–öå66†VÖc2Ò§6öâ†W†V7WF–öå66†VÖc5F‚“°¢6öç7BW‡V7FVDW†V7WF–öå66†VÖc2Ò°¢G66†VÖ¢v‡GG3¢òö§6öâ×66†VÖæ÷&röG&gBó##Ó"÷66†VÖrÀ¢F–C¢v‡GG3¢òö6G2×F÷vW"æ–çfÆ–B÷66†VÖöW†V7WF–öâÖ6öçG&7B×c2ç66†VÖæ§6öârÀ¢F—FÆS¢$6Bw2F÷vW"W†V7WF–öâ6öçG&7Bc267&VVâ×&ö¦V7F–öâ7WÆVÖVçB"À¢FW67&—F–öã¢tW†7B–Ö×WF&ÆRW†V7WF–öâ6öçG&7Bf÷"F†RfW'6–öæVB67&VVâ×&ö¦V7F–öâ6÷'&V7F–öã²çVÖW&–2W†V7WF–öâ6VÖçF–72&VÖ–âc"ârÀ¢6öç7C¢W‡V7FVDW†V7WF–öåc0¢Ó°¢76W'B„¥4ôâç7G&–æv–g’†W†V7WF–öå66†VÖc2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDW†V7WF–öå66†VÖc2’ÂvW†V7WF–öâÖ6öçG&7B×c266†VÖ—2æ÷BF†RW†7B&Wf–WvVB6öç7B6öçG&7Br“°¢76W'E66†VÖ†W†V7WF–öåc2ÂW†V7WF–öå66†VÖc2“° ¢6öç7BVÆ–f–6F–öåc"Ò§6öâ‡VÆ–f–6F–öåc%F‚“°¢6öç7BVÆ–f–6F–öåc2Ò§6öâ‡VÆ–f–6F–öåc5F‚“°¢76W'B‡FW‡B‡c5VÆ–f–6F–öå'VææW%F‚’ÓÓÒW†7Ec5VÆ–f–6F–öå'VææW%6÷W&6R‚’Âwc2VÆ–f–6F–öâ'VææW"—2æ÷BF†RW†7B&Wf–WvVBw&W"&÷VæBF†Rg&÷¦VâVæv–æRr“°¢76W'B„¥4ôâç7G&–æv–g’‡VÆ–f–6F–öåc2æFWFW&Ö–æ—7F–5–ÆöB’ÓÓÒ¥4ôâç7G&–æv–g’‡VÆ–f–6F–öåc"æFWFW&Ö–æ—7F–5–ÆöB’Âwc2VÆ–f–6F–öâFWFW&Ö–æ—7F–2–ÆöBF–ffW'2g&öÒ6VÆVBc"r“°¢76W'B‡VÆ–f–6F–öåc2æ†6†W3òæFWFW&Ö–æ—7F–5–ÆöE6†#SbÓÓÒv#FfVF&6c3&3Csv3ƒSssC36C#“v#s&&&Vcƒ633ƒƒ3ccC#Sc&2rÂwc2VÆ–f–6F–öâ¶æ÷vâ–ÆöBF–vW7BÖ—6ÖF6‚r“°¢76W'B‡VÆ–f–6F–öåc2æ†6†W2æFWFW&Ö–æ—7F–5–ÆöE6†#SbÓÓÒ6†#Sd6æöæ–6Â‡VÆ–f–6F–öåc2æFWFW&Ö–æ—7F–5–ÆöB’Âwc2VÆ–f–6F–öâ–ÆöBF–vW7Bv2æ÷B&V6ö×WFVBr“°¢76W'B‡VÆ–f–6F–öåc2æ†6†W2æ6æF–FFU6†#SbÓÓÒ6†#SeFW‡B‡FW‡B†6æF–FFUc5F‚’’Âwc2VÆ–f–6F–öâ6æF–FFRF–vW7BÖ—6ÖF6‚r“°¢76W'B‡VÆ–f–6F–öåc2æ†6†W2ç'VåÆå6†#SbÓÓÒ6†#SeFW‡B‡FW‡B‡'VåÆåc5F‚’’Âwc2VÆ–f–6F–öâ'Vâ×ÆâF–vW7BÖ—6ÖF6‚r“°¢76W'B‡VÆ–f–6F–öåc2æ†6†W2æW†V7WF–öä6öçG&7E6†#SbÓÓÒ6†#SeFW‡B‡FW‡B†W†V7WF–öåc5F‚’’Âwc2VÆ–f–6F–öâW†V7WF–öâÖ6öçG&7BF–vW7BÖ—6ÖF6‚r“°¢76W'B‡VÆ–f–6F–öåc2æFWFW&Ö–æ—7F–5–ÆöCòç66Væ&–ô6÷VçBÓÓÒs3rbbVÆ–f–6F–öåc2æFWFW&Ö–æ—7F–5–ÆöCòçf–öÆF–öç3òæÆVæwF‚ÓÓÒÂwc2VÆ–f–6F–öâ66÷R÷"f–öÆF–öç2Ö—6ÖF6‚r“°¢76W'B‚õçc#%ÂåÆBµÂåÆB²BòçFW7B‡VÆ–f–6F–öåc2æWf–FVæ6Sòç'VçF–ÖUfW'6–öâóòrr’Âwc2VÆ–f–6F–öâ'VçF–ÖUfW'6–öâ×W7B&RâW†7BæöFR#"6VÖçF–2fW'6–öâr“°¢6öç7BVÆ–f–6F–öäW†V7WFVDBÒFFRç'6R‡VÆ–f–6F–öåc2æWf–FVæ6SòæW†V7WFVDBóòrr“°¢76W'B„çVÖ&W"æ—4f–æ—FR‡VÆ–f–6F–öäW†V7WFVDB’bbæWrFFR‡VÆ–f–6F–öäW†V7WFVDB’çFô•4õ7G&–ær‚’ÓÓÒVÆ–f–6F–öåc2æWf–FVæ6RæW†V7WFVDBÂwc2VÆ–f–6F–öâW†V7WFVDB×W7B&R6æöæ–6Â•4òUD2F–ÖW7F×r“°¢76W'B‡VÆ–f–6F–öåc2æWf–FVæ6Rç&W&öGV7F–öä6öÖÖæBÓÓÒvæöFR6–×VÆF–öâ÷'Vâ×VÆ–f–6F–öâ×c2æÖ§2rÂwc2VÆ–f–6F–öâ&W&öGV7F–öä6öÖÖæB—2æ÷BF†RW†7Bc2w&W"6öÖÖæBr“°¢6öç7B&W7VÇE66†VÖc2Ò§6öâ‡&W7VÇE66†VÖc5F‚“°¢6öç7BW‡V7FVE&W7VÇE66†VÖc2Ò°¢G66†VÖ¢v‡GG3¢òö§6öâ×66†VÖæ÷&röG&gBó##Ó"÷66†VÖrÀ¢F–C¢v‡GG3¢òö6G2×F÷vW"æ–çfÆ–B÷66†VÖ÷&W7VÇB×c2ç66†VÖæ§6öârÀ¢F—FÆS¢$6Bw2F÷vW"7FW"VÆ–f–6F–öâ&W7VÇBc267&VVâ×&ö¦V7F–öâ7WÆVÖVçB"À¢FW67&—F–öã¢tW†7B–Ö×WF&ÆRVÆ–f–6F–öâVçfVÆ÷R&W&öGV6VBv—F‚F†Rg&÷¦Vâc"çVÖW&–2Væv–æRæBfW'6–öæVBc2ÖWFFF–çWG2ârÀ¢6öç7C¢VÆ–f–6F–öåc0¢Ó°¢76W'B„¥4ôâç7G&–æv–g’‡&W7VÇE66†VÖc2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE&W7VÇE66†VÖc2’Âw&W7VÇB×c266†VÖ—2æ÷BF†RW†7B&Wf–WvVB–Ö×WF&ÆRVÆ–f–6F–öâ6öçG&7Br“°¢76W'E66†VÖ‡VÆ–f–6F–öåc2Â&W7VÇE66†VÖc2“°¢6öç7B–çfÆ–EVÆ–f–6F–öåfW&F–7BÒ7G'V7GW&VD6ÆöæR‡VÆ–f–6F–öåc2“°¢–çfÆ–EVÆ–f–6F–öåfW&F–7BçfW&F–7Bç7FW4WF†÷&—¦VD'•F†—5&W7VÇBÒG'VS°¢76W'E66†VÖ&V¦V7G2†–çfÆ–EVÆ–f–6F–öåfW&F–7BÂ&W7VÇE66†VÖc2Âw&W7VÇB×c2fÇ6R7FW2WF†÷&—¦F–öâr“°¢6öç7B7G&–7EfÆ–FF÷%6÷W&6W2Ò°¢°¢Fƒ¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æ6æF–FFUfÆ–FF÷"À¢FVfVÇDFFFƒ¢6æF–FFUc5F‚À¢66†VÖFƒ¢6æF–FFU66†VÖc5F‚À¢'F–f7D–C¢v6G2×F÷vW"Ö6æF–FFR×c2×fÆ–FF÷"p¢ÒÀ¢°¢Fƒ¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7EfÆ–FF÷"À¢FVfVÇDFFFƒ¢W†V7WF–öåc5F‚À¢66†VÖFƒ¢W†V7WF–öå66†VÖc5F‚À¢'F–f7D–C¢v6G2×F÷vW"ÖW†V7WF–öâÖ6öçG&7B×c2×fÆ–FF÷"p¢ÒÀ¢°¢Fƒ¢W‡V7FVEc4WF†÷&—G•ö–çFW'2ç'VåÆåfÆ–FF÷"À¢FVfVÇDFFFƒ¢'VåÆåc5F‚À¢66†VÖFƒ¢'VåÆå66†VÖc5F‚À¢'F–f7D–C¢v6G2×F÷vW"×'Vâ×Æâ×c2×fÆ–FF÷"p¢ÒÀ¢°¢Fƒ¢W‡V7FVEc4WF†÷&—G•ö–çFW'2ç&W7VÇEfÆ–FF÷"À¢FVfVÇDFFFƒ¢VÆ–f–6F–öåc5F‚À¢66†VÖFƒ¢&W7VÇE66†VÖc5F‚À¢'F–f7D–C¢v6G2×F÷vW"×&W7VÇB×c2×fÆ–FF÷"p¢Ð¢Ó°¢f÷"†6öç7B6öæf–röb7G&–7EfÆ–FF÷%6÷W&6W2’°¢76W'B‡FW‡B†6öæf–rçF‚’ÓÓÒ7G&–7E66†VÖFFW%6÷W&6R†6öæf–r’ÂfW'6–öæVBfÆ–FF÷"—2æ÷BF†RW†7B&Wf–WvVBf–ÂÖ6Æ÷6VB66†VÖFFW#¢G¶6öæf–rçF‡Ö“°¢Ð ¢–b‚6¶—6æF–FFTW†V7WF–öâ’°¢6öç7B&W&öGV7F–öäF—&V7F÷'’Òg2æÖ¶GFV×7–æ2‡F‚æ¦ö–â†÷2çF×F—"‚’Âv6G2×F÷vW"×c2×VÆ–f–6F–öâÒr’“°¢6öç7B&W&öGV6VEF‚ÒF‚æ¦ö–â‡&W&öGV7F–öäF—&V7F÷'’ÂwVÆ–f–6F–öâ×&W7VÇB×c2æ§6öâr“°¢G'’°¢W†V4f–ÆU7–æ2‡&ö6W72æW†V5F‚Â°¢&VÂ‡c5VÆ–f–6F–öå'VææW%F‚’À¢rÒÖ÷WGWBrÂ&W&öGV6VEF€¢ÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÂVçc¢²Dƒ¢&ö6W72æVçbåD‚ÂÄäs¢t2åUDbÓ‚rÂÄ5ôÄÃ¢t2åUDbÓ‚rÂE£¢uUD2rÒÒ“°¢6öç7B&W&öGV6VBÒ¥4ôâç'6R†g2ç&VDf–ÆU7–æ2‡&W&öGV6VEF‚ÂwWFc‚r’“°¢76W'B‚õçc#%ÂåÆBµÂåÆB²BòçFW7B‡&W&öGV6VBæWf–FVæ6Sòç'VçF–ÖUfW'6–öâóòrr’Âw&W&öGV6VBc2VÆ–f–6F–öâ'VçF–ÖUfW'6–öâ—2–çfÆ–Br“°¢6öç7B&W&öGV6VDW†V7WFVDBÒFFRç'6R‡&W&öGV6VBæWf–FVæ6SòæW†V7WFVDBóòrr“°¢76W'B„çVÖ&W"æ—4f–æ—FR‡&W&öGV6VDW†V7WFVDB’bbæWrFFR‡&W&öGV6VDW†V7WFVDB’çFô•4õ7G&–ær‚’ÓÓÒ&W&öGV6VBæWf–FVæ6RæW†V7WFVDBÂw&W&öGV6VBc2VÆ–f–6F–öâW†V7WFVDB—2–çfÆ–Br“°¢76W'B‡&W&öGV6VBæWf–FVæ6Rç&W&öGV7F–öä6öÖÖæBÓÓÒvæöFR6–×VÆF–öâ÷'Vâ×VÆ–f–6F–öâ×c2æÖ§2rÂw&W&öGV6VBc2VÆ–f–6F–öâ6öÖÖæB—2æ÷B6VÆbÖ6öçF–æVBr“°¢6öç7Bæ÷&ÖÆ—¦U'VçF–ÖTWf–FVæ6RÒfÇVRÓâ°¢6öç7B6÷’Ò7G'V7GW&VD6ÆöæR‡fÇVR“°¢6÷’æWf–FVæ6Rç'VçF–ÖUfW'6–öâÒsÄäõ$ÔÄ•¤TEõ%TåD”ÔSâs°¢6÷’æWf–FVæ6RæW†V7WFVDBÒsÄäõ$ÔÄ•¤TEõD”ÔSâs°¢&WGW&â6÷“°¢Ó°¢76W'B„¥4ôâç7G&–æv–g’†æ÷&ÖÆ—¦U'VçF–ÖTWf–FVæ6R‡VÆ–f–6F–öåc2’’ÓÓÒ¥4ôâç7G&–æv–g’†æ÷&ÖÆ—¦U'VçF–ÖTWf–FVæ6R‡&W&öGV6VB’’Âw7F÷&VBc2VÆ–f–6F–öâVçfVÆ÷RF–ffW'2g&öÒG'W7FVBg&÷¦VâÖVæv–æR&W&öGV7F–öâr“°¢Òf–æÆÇ’°¢g2ç&Õ7–æ2‡&W&öGV7F–öäF—&V7F÷'’Â²&V7W'6—fS¢G'VRÂf÷&6S¢G'VRÒ“°¢Ð¢Ð§Ð ¦gVæ7F–öâfW&–g•c4×WFF–öå&V¦V7F–öâ‚’°¢6öç7BfÆ–FF÷"ÒW‡V7FVEc4WF†÷&—G•ö–çFW'2æ6æF–FFUfÆ–FF÷#°¢6öç7B6æF–FFRÒ§6öâ†W‡V7FVEc4WF†÷&—G•ö–çFW'2æ6æF–FFR“°¢W†V4f–ÆU7–æ2‡&ö6W72æW†V5F‚Â·&VÂ‡fÆ–FF÷"’Â&VÂ†W‡V7FVEc4WF†÷&—G•ö–çFW'2æ6æF–FFR•ÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢6öç7BFV×F—&V7F÷'’Òg2æÖ¶GFV×7–æ2‡F‚æ¦ö–â†÷2çF×F—"‚’Âv6G2×F÷vW"×c2Ö×WFF–öç2Òr’“°¢ÆWB÷&F–æÂÒ°¢6öç7Bw&—FTf—‡GW&RÒfÇVRÓâ°¢6öç7Bf—‡GW&UF‚ÒF‚æ¦ö–â‡FV×F—&V7F÷'’ÂG·&æFöÕUT”B‚—Òæ§6öæ“°¢÷&F–æÂ³Ò°¢g2çw&—FTf–ÆU7–æ2†f—‡GW&UF‚ÂG´¥4ôâç7G&–æv–g’‡fÇVRÂçVÆÂÂ"—ÕÆæÂwWFc‚r“°¢&WGW&âf—‡GW&UFƒ°¢Ó°¢6öç7BW‡V7E&V¦V7BÒ†×WFFRÂÆ&VÂ’Óâ°¢6öç7Bf—‡GW&RÒ7G'V7GW&VD6ÆöæR†6æF–FFR“°¢×WFFR†f—‡GW&R“°¢6öç7Bf—‡GW&UF‚Òw&—FTf—‡GW&R†f—‡GW&R“°¢ÆWB&V¦V7FVBÒfÇ6S°¢ÆWB÷WGWBÒrs°¢G'’°¢W†V4f–ÆU7–æ2‡&ö6W72æW†V5F‚Â·&VÂ‡fÆ–FF÷"’Âf—‡GW&UF…ÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢Ò6F6‚†W'&÷"’°¢&V¦V7FVBÒG'VS°¢÷WGWBÒ¶W'&÷#òç7FF÷WBÂW'&÷#òç7FFW'%Òæf–ÇFW"„&ööÆVâ’æ¦ö–â‚uÆâr“°¢Ð¢76W'B‡&V¦V7FVBÂc2fÆ–FF÷"66WFVB×WFF–öã¢G¶Æ&VÇÖ“°¢ÆWBF–væ÷7F–3°¢G'’°¢F–væ÷7F–2Ò¥4ôâç'6R†÷WGWBçG&–Ò‚’“°¢Ò6F6‚°¢F‡&÷ræWrW'&÷"†c2fÆ–FF÷"&V¦V7FVBG¶Æ&VÇÒv—F†÷WBöæR7G'V7GW&VB¥4ôâF–væ÷7F–6“°¢Ð¢6öç7B6öFW2Ò†F–væ÷7F–2æW'&÷'2óòµÒ’æÖ†VçG'’ÓâVçG'’æ6öFR“°¢76W'B„¥4ôâç7G&–æv–g’†6öFW2’ÓÓÒ¥4ôâç7G&–æv–g’…²u44„TÔuÒ’Âc2fÆ–FF÷"F–væ÷7F–2f÷"G¶Æ&VÇÒ—2æ÷BW†7FÇ’öæR44„TÔW'&÷&“°¢Ó°¢G'’°¢6öç7BfÆ–D6æF–FFT6÷’Òw&—FTf—‡GW&R†6æF–FFR“°¢W†V4f–ÆU7–æ2‡&ö6W72æW†V5F‚Â·&VÂ‡fÆ–FF÷"’ÂfÆ–D6æF–FFT6÷•ÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç2æ6÷VçBÒss²ÒÂv6÷VçBG&–gBr“°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç2ç&Vv—7G'’ç÷‚“²ÒÂvÖ—76–ær67&VVâr“°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç2ç&Vv—7G'•³Òæ–BÒtäõEõ3"s²ÒÂwVæ¶æ÷vâ67&VVâ”Br“°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç2ç&Vv—7G'•³Òæ–BÒu3s²ÒÂvGWÆ–6FR67&VVâ”Br“°¢W‡V7E&V¦V7B‡fÇVRÓâ²·fÇVRç67&VVç2ç&Vv—7G'•³ÒÂfÇVRç67&VVç2ç&Vv—7G'•³ÕÒÒ·fÇVRç67&VVç2ç&Vv—7G'•³ÒÂfÇVRç67&VVç2ç&Vv—7G'•³ÕÓ²ÒÂw67&VVâ÷&FW"r“°¢6öç7BVçG'”×WFF–öç2Ò°¢æÖS¢VçG'’Óâ²VçG'’ææÖRÒvf÷&ÖF–öâs²ÒÀ¢&W7öç6–&–Æ—F–W3¢VçG'’Óâ²VçG'’ç&W7öç6–&–Æ—F–W2Ò²t$ääuÓ²ÒÀ¢WF†÷&—G“¢VçG'’Óâ²VçG'’æWF†÷&—G’Òu”äTÄRs²ÒÀ¢&WV—&VE7FFS¢VçG'’Óâ²VçG'’ç&WV—&VE7FFRÒ²t$ääuÓ²ÒÀ¢V•7FFW3¢VçG'’Óâ²VçG'’çV•7FFW2Ò²u”äTÄRuÓ²ÒÀ¢6W'fW$÷væVE7FFS¢VçG'’Óâ²VçG'’ç6W'fW$÷væVE7FFRÒ²täõEõ3"uÓ²Ð¢Ó°¢f÷"†ÆWB–æFW‚Ò²–æFW‚Â6æF–FFRç67&VVç2ç&Vv—7G'’æÆVæwFƒ²–æFW‚³Ò’°¢f÷"†6öç7B¶f–VÆBÂ×WFFTVçG'•Òöbö&¦V7BæVçG&–W2†VçG'”×WFF–öç2’’°¢W‡V7E&V¦V7B‡fÇVRÓâ×WFFTVçG'’‡fÇVRç67&VVç2ç&Vv—7G'•¶–æFW…Ò’Â2Gµ7G&–ær†–æFW‚²’çE7F'Bƒ"Âsr—ÒG¶f–VÆGÖ“°¢Ð¢Ð¢f÷"†6öç7BÆVv7”f–VÆBöb²w&W7öç6–&–Æ—G’rÂvæ÷&ÖÅ7FFW2rÂvW'&÷%7FFW2rÂw&WG'”–FV×÷FVçBrÂw6W'fW$WF†÷&—G•f—6–&ÆRuÒ’°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç2ç&Vv—7G'•³Õ¶ÆVv7”f–VÆEÒÒÆVv7”f–VÆBÓÓÒw&WG'”–FV×÷FVçBròG'VR¢µÓ²ÒÂÆVv7’VçG'’f–VÆBG¶ÆVv7”f–VÆGÖ“°¢Ð¢f÷"†6öç7BÆVv7”f–VÆBöb²v&GFÆU67&VVä6öÖÖW&6TFWF–ÅW'6—7FVçBrÂw&V6÷fW'•7FFW5&WV—&VBuÒ’°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç5¶ÆVv7”f–VÆEÒÒG'VS²ÒÂÆVv7’67&VVç2f–VÆBG¶ÆVv7”f–VÆGÖ“°¢Ð¢f÷"†6öç7B¶W’öbö&¦V7Bæ¶W—2†6æF–FFRç67&VVç2ævÆö&Å'VÆW2’’°¢W‡V7E&V¦V7B‡fÇVRÓâ²FVÆWFRfÇVRç67&VVç2ævÆö&Å'VÆW5¶¶W•Ó²ÒÂvÆö&Â'VÆRG¶¶W—Ö“°¢Ð¢f÷"†ÆWB–æFW‚Ò²–æFW‚Â6æF–FFRç67&VVç2çVæ—fW'6Å&V6÷fW'’æÆVæwFƒ²–æFW‚³Ò’°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç2çVæ—fW'6Å&V6÷fW'’ç7Æ–6R†–æFW‚Â“²ÒÂVæ—fW'6Â&V6÷fW'’G¶–æFW‡Ö“°¢Ð¢f÷"†ÆWB–æFW‚Ò²–æFW‚Â6æF–FFRç67&VVç2ævÆö&Ä–çf&–çG2æÆVæwFƒ²–æFW‚³Ò’°¢W‡V7E&V¦V7B‡fÇVRÓâ²fÇVRç67&VVç2ævÆö&Ä–çf&–çG2ç7Æ–6R†–æFW‚Â“²ÒÂvÆö&Â–çf&–çBG¶–æFW‡Ö“°¢Ð ¢6öç7BfW&–g•fW'6–öæVEfÆ–FF÷"Ò‡²6÷W&6RÂfÆ–FF÷#¢fÆ–FF÷%F‚Â×WFFRÂÆ&VÂÒ’Óâ°¢6öç7BfÆ–EfÇVRÒ§6öâ‡6÷W&6R“°¢6öç7BfÆ–EF‚Òw&—FTf—‡GW&R‡fÆ–EfÇVR“°¢W†V4f–ÆU7–æ2‡&ö6W72æW†V5F‚Â·&VÂ‡fÆ–FF÷%F‚’ÂfÆ–EF…ÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢6öç7B–çfÆ–EfÇVRÒ7G'V7GW&VD6ÆöæR‡fÆ–EfÇVR“°¢×WFFR†–çfÆ–EfÇVR“°¢6öç7B–çfÆ–EF‚Òw&—FTf—‡GW&R†–çfÆ–EfÇVR“°¢ÆWB&V¦V7FVBÒfÇ6S°¢ÆWB÷WGWBÒrs°¢G'’°¢W†V4f–ÆU7–æ2‡&ö6W72æW†V5F‚Â·&VÂ‡fÆ–FF÷%F‚’Â–çfÆ–EF…ÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢Ò6F6‚†W'&÷"’°¢&V¦V7FVBÒG'VS°¢÷WGWBÒ¶W'&÷#òç7FF÷WBÂW'&÷#òç7FFW'%Òæf–ÇFW"„&ööÆVâ’æ¦ö–â‚uÆâr“°¢Ð¢ÆWBF–væ÷7F–2ÒçVÆÃ°¢G'’°¢F–væ÷7F–2Ò¥4ôâç'6R†÷WGWBçG&–Ò‚’“°¢Ò6F6‚·Ð¢6öç7B6öFW2Ò†F–væ÷7F–3òæW'&÷'2óòµÒ’æÖ†VçG'’ÓâVçG'’æ6öFR“°¢76W'B‡&V¦V7FVBbb¥4ôâç7G&–æv–g’†6öFW2’ÓÓÒ¥4ôâç7G&–æv–g’…²u44„TÔuÒ’ÂG¶Æ&VÇÒfÆ–FF÷"F–Bæ÷B&V¦V7BFV×Öf–ÆR×WFF–öâv—F‚W†7FÇ’öæR44„TÔF–væ÷7F–6“°¢Ó°¢fW&–g•fW'6–öæVEfÆ–FF÷"‡°¢6÷W&6S¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7BÀ¢fÆ–FF÷#¢W‡V7FVEc4WF†÷&—G•ö–çFW'2æW†V7WF–öä6öçG&7EfÆ–FF÷"À¢×WFFS¢fÇVRÓâ²fÇVRæ6öçG&7D–BÒv6G2×F÷vW"Ö–çfÆ–BÖ6öçG&7Bs²ÒÀ¢Æ&VÃ¢vW†V7WF–öâÖ6öçG&7B×c2p¢Ò“°¢fW&–g•fW'6–öæVEfÆ–FF÷"‡°¢6÷W&6S¢W‡V7FVEc4WF†÷&—G•ö–çFW'2ç'VåÆâÀ¢fÆ–FF÷#¢W‡V7FVEc4WF†÷&—G•ö–çFW'2ç'VåÆåfÆ–FF÷"À¢×WFFS¢fÇVRÓâ²fÇVRçÆä–BÒv6G2×F÷vW"Ö–çfÆ–B×Æâs²ÒÀ¢Æ&VÃ¢w'Vâ×Æâ×c2p¢Ò“°¢fW&–g•fW'6–öæVEfÆ–FF÷"‡°¢6÷W&6S¢wVÆ—G’×&Wf–Ww2÷7FWÓ"ÖW†V7WF&ÆRÖ6öçG&7B×c"÷7WÆVÖVçB×67&VVâ×&ö¦V7F–öâ×&÷VæBÓ÷VÆ–f–6F–öâ×&W7VÇB×c2æ§6öârÀ¢fÆ–FF÷#¢W‡V7FVEc4WF†÷&—G•ö–çFW'2ç&W7VÇEfÆ–FF÷"À¢×WFFS¢fÇVRÓâ²fÇVRæ†6†W2æ6æF–FFU6†#SbÒsrç&WVBƒcB“²ÒÀ¢Æ&VÃ¢w&W7VÇB×c2p¢Ò“°¢Òf–æÆÇ’°¢g2ç&Õ7–æ2‡FV×F—&V7F÷'’Â²&V7W'6—fS¢G'VRÂf÷&6S¢G'VRÒ“°¢Ð§Ð ¦gVæ7F–öâfW&–g•c56VÄ'F–f7B‚’°¢76W'B†W†—7G2‡c56VÅF‚’Âu7FW"52&WV—&W2c26VÂr“°¢6öç7B6VÂÒ§6öâ‡c56VÅF‚“°¢76W'B„¥4ôâç7G&–æv–g’„ö&¦V7Bæ¶W—2‡6VÂ’’ÓÓÒ¥4ôâç7G&–æv–g’…²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&F–7BrÂw6VÖçF–46öÖÖ—BrÂw6VÖçF–5G&VRrÂv&–æF–æw2rÂw&Wf–WtWf–FVæ6RuÒ’Âu7FW"c26VÂF÷ÖÆWfVÂ6†R÷"÷&FW&–ærÖ—6ÖF6‚r“°¢76W'B‡6VÂç66†VÖfW'6–öâÓÓÒs2ããrbb6VÂæ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW"ÖW†V7WF&ÆR×6VÂ×c2×67&VVâ×&ö¦V7F–öâ×&÷VæBÓrÂu7FW"c26VÂ–FVçF—G’Ö—6ÖF6‚r“°¢76W'B‡6VÂç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb6VÂæ'&æ6‚ÓÓÒv¶–Ö’rbb6VÂæ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu7FW"c26VÂWF†÷&—G’Ö—6ÖF6‚r“°¢76W'B‡6VÂçfW&F–7BÓÓÒu4TÄTEõ5DU%ôU„T5UD$ÄUô4ôåE$5Eõ45$TTåõ$ô¤T5D”ôåô4õ%$T5DTBrÂu7FW"52c26VÂfW&F–7BÖ—6ÖF6‚r“°¢76W'B„'&’æ—4'&’‡6VÂæ&–æF–æw2’bb6VÂæ&–æF–æw2æÆVæwF‚âÂu7FW"52c26VÂ†2æò&–æF–æw2r“°¢6öç7B&–æF–æuF‡2Ò6VÂæ&–æF–æw2æÖ†&–æF–ærÓâ&–æF–ærçF‚“°¢76W'B„¥4ôâç7G&–æv–g’†&–æF–æuF‡2’ÓÓÒ¥4ôâç7G&–æv–g’‡&WV—&VEc4&–æF–æuF‡2’Âu7FW"52c26VÂ&–æF–ærF‡2ö÷&FW"F–ffW"g&öÒF†RW†7B&Wf–WvVBFWVæFVæ7’6Æ÷7W&Rr“°¢6öç7B6VÄ6öÖÖ—BÒf—'7DFD6öÖÖ—B‡c56VÅF‚“°¢6öç7B÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—BÒ&W6öÇfU7FW%÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—B‚“°¢f÷"†6öç7B&–æF–æröb6VÂæ&–æF–æw2’°¢76W'B‡G—Vöb&–æF–ærçF‚ÓÓÒw7G&–ærrbbõå¶ÖcÓ•×³CÒBòçFW7B†&–æF–æræ&Æö"óòrr’Âu7FW"52c26VÂ6öçF–ç2â–çfÆ–B&–æF–ærr“°¢76W'B†W†—7G2†&–æF–ærçF‚’Â7FW"52c2&–æF–ærÖ—76–æs¢G¶&–æF–ærçF‡Ö“°¢76W'E&VwVÆ$v—Df–ÆR†&–æF–ærçF‚Âu7FW"52c2&–æF–ærr“°¢6öç7B&–æF–æt6öÖÖ—BÒ÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—Bbb&–æF–ærçF‚ÓÓÒwFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2p¢ò6VÄ6öÖÖ—@¢¢t„TBs°¢76W'B†v—B…²w&Wb×'6RrÂG¶&–æF–æt6öÖÖ—GÓ¢G¶&–æF–ærçF‡ÖÒ’ÓÓÒ&–æF–æræ&Æö"Â7FW"52c2&–æF–ær6†ævVC¢G¶&–æF–ærçF‡Ö“°¢Ð¢6öç7B&–æF–æu66†VÖÒ°¢G—S¢vö&¦V7BrÀ¢FF—F–öæÅ&÷W'F–W3¢fÇ6RÀ¢&WV—&VC¢²wF‚rÂv&Æö"uÒÀ¢&÷W'F–W3¢°¢Fƒ¢²G—S¢w7G&–ærrÂÖ–äÆVæwFƒ¢ÒÀ¢&Æö#¢²G—S¢w7G&–ærrÂGFW&ã¢uå¶ÖcÓ•×³CÒBrÐ¢Ð¢Ó°¢6öç7B&Wf–Wu66†VÖ&÷W'F–W2Òö&¦V7Bæg&öÔVçG&–W2„ö&¦V7Bæ¶W—2‡7FW%&Wf–WuF‡2’æÖ†¶W’Óâ¶¶W’Â&–æF–æu66†VÖÒ’“°¢6öç7BW‡V7FVE6VÅ66†VÖÒ°¢G66†VÖ¢v‡GG3¢òö§6öâ×66†VÖæ÷&röG&gBó##Ó"÷66†VÖrÀ¢F–C¢v‡GG3¢òö6G2×F÷vW"æ–çfÆ–B÷66†VÖöW†V7WF&ÆR×6VÂ×c2ç66†VÖæ§6öârÀ¢F—FÆS¢$6Bw2F÷vW"7FW"W†V7WF&ÆR6VÂc267&VVâ×&ö¦V7F–öâ7WÆVÖVçB"À¢G—S¢vö&¦V7BrÀ¢FF—F–öæÅ&÷W'F–W3¢fÇ6RÀ¢&WV—&VC¢²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&F–7BrÂw6VÖçF–46öÖÖ—BrÂw6VÖçF–5G&VRrÂv&–æF–æw2rÂw&Wf–WtWf–FVæ6RuÒÀ¢&÷W'F–W3¢°¢66†VÖfW'6–öã¢²6öç7C¢s2ããrÒÀ¢'F–f7D–C¢²6öç7C¢v6G2×F÷vW"×7FW"ÖW†V7WF&ÆR×6VÂ×c2×67&VVâ×&ö¦V7F–öâ×&÷VæBÓrÒÀ¢&W÷6—F÷'“¢²6öç7C¢s&†swG'w'bÖFW6–vâö6G5÷F÷vW"rÒÀ¢'&æ6ƒ¢²6öç7C¢v¶–Ö’rÒÀ¢6†ævT6öçG&öÃ¢²6öç7C¢7FW$6÷'&V7F–öåF‚ÒÀ¢fW&F–7C¢²6öç7C¢u4TÄTEõ5DU%ôU„T5UD$ÄUô4ôåE$5Eõ45$TTåõ$ô¤T5D”ôåô4õ%$T5DTBrÒÀ¢6VÖçF–46öÖÖ—C¢²G—S¢w7G&–ærrÂGFW&ã¢uå¶ÖcÓ•×³CÒBrÒÀ¢6VÖçF–5G&VS¢²G—S¢w7G&–ærrÂGFW&ã¢uå¶ÖcÓ•×³CÒBrÒÀ¢&–æF–æw3¢²G—S¢v'&’rÂÖ–ä—FV×3¢&WV—&VEc4&–æF–æuF‡2æÆVæwF‚ÂÖ„—FV×3¢&WV—&VEc4&–æF–æuF‡2æÆVæwF‚ÂVæ—VT—FV×3¢G'VRÂ—FV×3¢&–æF–æu66†VÖÒÀ¢&Wf–WtWf–FVæ6S¢²G—S¢vö&¦V7BrÂFF—F–öæÅ&÷W'F–W3¢fÇ6RÂ&WV—&VC¢ö&¦V7Bæ¶W—2‡7FW%&Wf–WuF‡2’Â&÷W'F–W3¢&Wf–Wu66†VÖ&÷W'F–W2Ð¢Ð¢Ó°¢6öç7B6VÅ66†VÖÒ§6öâ‚w6–×VÆF–öâöW†V7WF&ÆR×6VÂ×c2ç66†VÖæ§6öâr“°¢76W'B„¥4ôâç7G&–æv–g’‡6VÅ66†VÖ’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE6VÅ66†VÖ’Âu7FW"c26VÂ66†VÖF–ffW'2g&öÒF†RW†7B&Wf–WvVB6Æ÷6VB66†VÖr“°¢76W'E66†VÖ‡6VÂÂ6VÅ66†VÖ“°¢76W'B‡6VÄ6öÖÖ—Bbb76W'DFFVDöæ6TæEVæ6†ævVB‡c56VÅF‚Â6VÄ6öÖÖ—B’ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·c56VÅF‡ÖÒ’Âwc26VÂ6†ævVBgFW"f—'7BFF—F–öâr“°¢76W'B‡&U6VÅc5fW&–f–VBÂu7FW"c26VÂ6ææ÷B72&Vf÷&RF†RG'W7FVB&R×6VÂ6VÖçF–2æB×WFF–öâvFW272r“°¢fW&–g•7FW%&Wf–WtWf–FVæ6R‡6VÂ“°¢–b‡÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—B’°¢6öç7BFV×÷&'•v÷&·G&VRÒg2æÖ¶GFV×7–æ2‡F‚æ¦ö–â†÷2çF×F—"‚’Âv6G2×7FW"×c2×6VÂÒr’“°¢ÆWBv÷&·G&VTFFVBÒfÇ6S°¢G'’°¢W†V4f–ÆU7–æ2‚vv—BrÂ²wv÷&·G&VRrÂvFBrÂrÒÖFWF6‚rÂFV×÷&'•v÷&·G&VRÂ6VÄ6öÖÖ—EÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢v÷&·G&VTFFVBÒG'VS°¢W†V4f–ÆU7–æ2‡&ö6W72æW†V5F‚Â·F‚æ¦ö–â‡FV×÷&'•v÷&·G&VRÂc56VÅfÆ–FF÷%F‚•ÒÂ²7vC¢FV×÷&'•v÷&·G&VRÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢Ò6F6‚†W'&÷"’°¢F‡&÷ræWrW'&÷"†7FW"c26VÂ†—7F÷&–6ÂfW&–f–W"f–ÆVC¢G¶W'&÷"ç7FFW'#òçFõ7G&–ær‚’ÇÂW'&÷"ç7FF÷WCòçFõ7G&–ær‚’ÇÂW'&÷"æÖW76vWÖ“°¢Òf–æÆÇ’°¢–b‡v÷&·G&VTFFVB’W†V4f–ÆU7–æ2‚vv—BrÂ²wv÷&·G&VRrÂw&VÖ÷fRrÂrÒÖf÷&6RrÂFV×÷&'•v÷&·G&VUÒÂ²7vC¢&ö÷BÂVæ6öF–æs¢wWFc‚rÂ7FF–ó¢w—RrÒ“°¢VÇ6Rg2ç&Õ7–æ2‡FV×÷&'•v÷&·G&VRÂ²&V7W'6—fS¢G'VRÂf÷&6S¢G'VRÒ“°¢Ð¢ÒVÇ6R°¢'VäæöFUfW&–f–W"‡c56VÅfÆ–FF÷%F‚Âu7FW"c26VÂr“°¢Ð¢&WGW&â6VÃ°§Ð ¦gVæ7F–öâfW&–g”6öçF–çV—G”6Æ–×2†6öçF–çV—G’Âc56VÂ’°¢76W'E&VwVÆ$v—Df–ÆR‡7FW$6öçF–çV—G•F‚Âu7FW26öçF–çV—G’Wf–FVæ6Rr“°¢76W'DW†7D¶W•6WB†6öçF–çV—G’Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&F–7BrÂv6†ævVD§6öåö–çFW'2rÂv6æF–FFT÷WG6–FU67&VVç2rÂwVÆ–f–6F–öârÂv6æF–FFTf–ÆW2rÂwc56VÂrÂw7FW57FGW2rÂw'VçF–ÖT÷%3$6†ævVBrÂwVç&W6öÇfVBrÂvÖ†–×VÕfW&F–7BuÒÂu7FW26öçF–çV—G’'&–FvRr“°¢76W'DW†7D¶W•6WB†6öçF–çV—G’æ6æF–FFT÷WG6–FU67&VVç2Â²v&Vf÷&U6†#SbrÂvgFW%6†#SbuÒÂu7FW26öçF–çV—G’÷WG6–FR×67&VVç2&ööbr“°¢76W'DW†7D¶W•6WB†6öçF–çV—G’çVÆ–f–6F–öâÂ²v&Vf÷&TFWFW&Ö–æ—7F–5–ÆöE6†#SbrÂvgFW$FWFW&Ö–æ—7F–5–ÆöE6†#SbrÂvFVWWVÂuÒÂu7FW26öçF–çV—G’VÆ–f–6F–öâ&ööbr“°¢76W'DW†7D¶W•6WB†6öçF–çV—G’æ6æF–FFTf–ÆW2Â²v&Vf÷&U6†#SbrÂvgFW%6†#SbuÒÂu7FW26öçF–çV—G’6æF–FFRf–ÆW2r“°¢76W'DW†7D¶W•6WB†6öçF–çV—G’çc56VÂÂ²wF‚rÂv&Æö"uÒÂu7FW26öçF–çV—G’c26VÂ&–æF–ærr“°¢76W'DW†7D¶W•6WB†6öçF–çV—G’çVç&W6öÇfVBÂ²urÂuuÒÂu7FW26öçF–çV—G’Vç&W6öÇfVBr“°¢76W'B†6öçF–çV—G’ç66†VÖfW'6–öâÓÓÒbb6öçF–çV—G’æ'F–f7D–BÓÓÒv6G2×F÷vW"×7FW2Ö6öçF–çV—G’Ö'&–FvR×67&VVâ×&ö¦V7F–öâ×&÷VæBÓrbb6öçF–çV—G’ç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb6öçF–çV—G’æ'&æ6‚ÓÓÒv¶–Ö’rbb6öçF–çV—G’æ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu7FW26öçF–çV—G’–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†6öçF–çV—G’çfW&F–7BÓÓÒu55õ5DU5ôåTÔU$”5ôÔôDTÅô4ôåD”åT•E•ôäõôU„T5UD”ôåõ$U%Tåõ$UT•$TBrÂu7FW26öçF–çV—G’'&–FvRfW&F–7Bw&öærr“°¢76W'B†6öçF–çV—G’ç7FW57FGW2ÓÓÒu55ôÔôDTÂrbb6öçF–çV—G’ç'VçF–ÖT÷%3$6†ævVBÓÓÒfÇ6Rbb6öçF–çV—G’çVç&W6öÇfVBåÓÓÒbb6öçF–çV—G’çVç&W6öÇfVBåÓÓÒbb6öçF–çV—G’æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ5DU%õ55ô5D•dD”ôârÂu7FW26öçF–çV—G’&VÆV6R÷"Ö†–×VÒ×fW&F–7B&÷VæF'’Ö—6ÖF6‚r“°¢76W'B†6öçF–çV—G’æ6†ævVD§6öåö–çFW'3òæÆVæwF‚ÓÓÒbb6öçF–çV—G’æ6†ævVD§6öåö–çFW'5³ÒÓÓÒr÷67&VVç2rÂu7FW26öçF–çV—G’'&–FvRFöW2æ÷B&÷fR67&VVç2ÖöæÇ’6†ævRr“°¢6öç7B÷WG6–FT&Vf÷&RÒ6öçF–çV—G’æ6æF–FFT÷WG6–FU67&VVç3òæ&Vf÷&U6†#Sc°¢6öç7B÷WG6–FTgFW"Ò6öçF–çV—G’æ6æF–FFT÷WG6–FU67&VVç3òægFW%6†#Sc°¢76W'B‚õå¶ÖcÓ•×³cGÒBòçFW7B†÷WG6–FT&Vf÷&Róòrr’bbõå¶ÖcÓ•×³cGÒBòçFW7B†÷WG6–FTgFW"óòrr’Âvæöâ×67&VVâ6æF–FFR†6†W2&RÖ—76–ærr“°¢76W'B†÷WG6–FT&Vf÷&RÓÓÒ÷WG6–FTgFW"Âvæöâ×67&VVâ6æF–FFR6öçFVçB6†ævVBr“°¢76W'B†÷WG6–FT&Vf÷&RÓÓÒvF3V#SsSCƒ#ƒcfF#F“C“Sv#Sƒ&3S6V3“6fC“cCCVc3“ƒS“–V–S#vCƒRrÂvæöâ×67&VVâ6æF–FFRF–vW7BF–ffW'2g&öÒF†R–æFWVæFVçFÇ’FW&—fVBfÇVRr“°¢6öç7B–ÆöD&Vf÷&RÒ6öçF–çV—G’çVÆ–f–6F–öãòæ&Vf÷&TFWFW&Ö–æ—7F–5–ÆöE6†#Sc°¢6öç7B–ÆöDgFW"Ò6öçF–çV—G’çVÆ–f–6F–öãòægFW$FWFW&Ö–æ—7F–5–ÆöE6†#Sc°¢76W'B‚õå¶ÖcÓ•×³cGÒBòçFW7B‡–ÆöD&Vf÷&Róòrr’bbõå¶ÖcÓ•×³cGÒBòçFW7B‡–ÆöDgFW"óòrr’ÂwVÆ–f–6F–öâFWFW&Ö–æ—7F–2–ÆöB†6†W2&RÖ—76–ærr“°¢76W'B‡–ÆöD&Vf÷&RÓÓÒ–ÆöDgFW"ÂwVÆ–f–6F–öâFWFW&Ö–æ—7F–2–ÆöB6†ævVBr“°¢76W'B‡–ÆöD&Vf÷&RÓÓÒv#FfVF&6c3&3Csv3ƒSssC36C#“v#s&&&Vcƒ633ƒƒ3ccC#Sc&2rÂwVÆ–f–6F–öâF–vW7BF–ffW'2g&öÒF†R6VÆVBFWFW&Ö–æ—7F–2–ÆöBr“°¢76W'B†6öçF–çV—G’çVÆ–f–6F–öãòæFVWWVÂÓÓÒG'VRÂwVÆ–f–6F–öâ–ÆöBFVWWVÆ—G’Ö—76–ærr“°¢6öç7Bc$6æF–FFTF–vW7BÒ6†#SeFW‡B‡FW‡B‚w6–×VÆF–öâö6æF–FFR×c"æ§6öâr’“°¢6öç7Bc46æF–FFTF–vW7BÒ6†#SeFW‡B‡FW‡B‚w6–×VÆF–öâö6æF–FFR×c2æ§6öâr’“°¢76W'B†6öçF–çV—G’æ6æF–FFTf–ÆW3òæ&Vf÷&U6†#SbÓÓÒc$6æF–FFTF–vW7Bbb6öçF–çV—G’æ6æF–FFTf–ÆW3òægFW%6†#SbÓÓÒc46æF–FFTF–vW7BÂv6öçF–çV—G’6æF–FFRf–ÆRF–vW7G2vW&Ræ÷B&V6ö×WFVBr“°¢76W'B‡c$6æF–FFTF–vW7BÓÒc46æF–FFTF–vW7BÂv6÷'&V7FVB6æF–FFRf–ÆRF–vW7BF–Bæ÷B6†ævRr“°¢76W'B†6öçF–çV—G’çc56VÃòçF‚ÓÓÒc56VÅF‚Âv6öçF–çV—G’'&–FvRFöW2æ÷B&–æBc26VÂF‚r“°¢76W'B†6öçF–çV—G’çc56VÃòæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·c56VÅF‡ÖÒ’Âv6öçF–çV—G’'&–FvRc26VÂ&Æö"Ö—6ÖF6‚r“°¢76W'B†6öçF–çV—G’çc56VÂæ&Æö"ÓÓÒv—B…²v†6‚Öö&¦V7BrÂc56VÅF…Ò’Âv6öçF–çV—G’'&–FvRc26VÂv÷&·G&VR†6‚Ö—6ÖF6‚r“°¢76W'B‡c56VÂçfW&F–7BÓÓÒu4TÄTEõ5DU%ôU„T5UD$ÄUô4ôåE$5Eõ45$TTåõ$ô¤T5D”ôåô4õ%$T5DTBrÂv6öçF–çV—G’'&–FvRW6VBâ–çfÆ–Bc26VÂr“°§Ð ¦ÆWB&U6VÅc5fW&–f–VBÒfÇ6S°¦–b†W†—7G2†W‡V7FVEc4WF†÷&—G•ö–çFW'2æ6æF–FFR’’°¢76W'B‡7FW$6÷'&V7F–öâÂwfW'6–öæVB7FW"6æF–FFRW†—7G2v—F†÷WBF†Rg&÷¦Vâ&÷VæB3"WF†÷&—G’r“°¢fW&–g”F—&V7Ec56VÖçF–72‚“°¢–b‚6¶—6æF–FFTW†V7WF–öâ’fW&–g•c4×WFF–öå&V¦V7F–öâ‚“°¢'VäæöFUfW&–f–W"‚w6–×VÆF–öâöf—‡GW&W2÷c2÷fÆ–FFRÖf—‡GW&W2æÖ§2rÂu7FW"c2×WFF–öâf—‡GW&W2r“°¢'VäæöFUfW&–f–W"‚w6–×VÆF–öâ÷fW&–g’×7FW"×c2æÖ§2rÂu7FW"6ö×ÆWFRc26öçG&7Br“°¢'VäæöFUfW&–f–W"‡c5&ö¦V7F–öåfW&–f–W%F‚Âu7FW"67&VVâ&ö¦V7F–öâr“°¢&U6VÅc5fW&–f–VBÒG'VS°§Ð ¦–b„ö&¦V7BçfÇVW2‡7FW%&Wf–WuF‡2’ç6öÖR†f–ÆRÓâW†—7G2†f–ÆR’’’°¢76W'B‡&U6VÅc5fW&–f–VBÂu7FW"çVÖ&W&VB&Wf–WrWf–FVæ6RW†—7G2&Vf÷&RF†RG'W7FVBc26VÖçF–2F&vWB76W2r“°¢fW&–g•7FW%&Wf–WtWf–FVæ6R†çVÆÂ“°§Ð ¦ÆWB&T7F—fFVEc56VÂÒçVÆÃ°¦–b†W†—7G2‡c56VÅF‚’’°¢76W'B‡&U6VÅc5fW&–f–VBÂu7FW"c26VÂW†—7G2&Vf÷&RF†RG'W7FVB&R×6VÂ6VÖçF–2æB×WFF–öâvFW272r“°¢&T7F—fFVEc56VÂÒfW&–g•c56VÄ'F–f7B‚“°§Ð ¦ÆWB&T7F—fFVD6öçF–çV—G’ÒçVÆÃ°¦–b†W†—7G2‡7FW$6öçF–çV—G•F‚’’°¢76W'B‡&T7F—fFVEc56VÂÂu7FW26öçF–çV—G’W†—7G2&Vf÷&RF†RG'W7FVBc26VÂr“°¢&T7F—fFVD6öçF–çV—G’Ò§6öâ‡7FW$6öçF–çV—G•F‚“°¢fW&–g”6öçF–çV—G”6Æ–×2‡&T7F—fFVD6öçF–çV—G’Â&T7F—fFVEc56VÂ“°¢6öç7B6VÄ6öÖÖ—BÒf—'7DFD6öÖÖ—B‡c56VÅF‚“°¢6öç7B6öçF–çV—G”6öÖÖ—BÒf—'7DFD6öÖÖ—B‡7FW$6öçF–çV—G•F‚“°¢76W'B‡6VÄ6öÖÖ—Bbb6öçF–çV—G”6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶6öçF–çV—G”6öÖÖ—GÕæÒ’ÓÓÒ6VÄ6öÖÖ—BÂu7FW26öçF–çV—G’×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†Rc26VÂr“°¢76W'DW†7D6†ævVEF‡2‡6VÄ6öÖÖ—BÂ6öçF–çV—G”6öÖÖ—BÂ·7FW$6öçF–çV—G•F…ÒÂu7FW26öçF–çV—G’6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB‡7FW$6öçF–çV—G•F‚Â6öçF–çV—G”6öÖÖ—B“°§Ð ¦6öç7BW‡V7FVE†6SÒ6Æ÷7W&U&W—$7&—F–46ö×ÆWFRò¢C°¦6öç7B7FW%&ö¦V7F–öä÷VâÒWF†÷&—G’æW†V7WF&ÆT6öçG&7Bç7FW%7FGW2ÓÒu55ô4ôåE$5Bs°¦–b‚†6S6Æ÷6VB’°¢6öç7B&6TWF†÷&—G•&V6÷fW'’Ò§6öäB‡G'W7FVE&÷VæC3&W—$&6Ræ6öÖÖ—BÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr’æv÷fW&ææ6U&V6÷fW'“°¢6öç7B&6U7FGW5&V6÷fW'’Ò§6öäB‡G'W7FVE&÷VæC3&W—$&6Ræ6öÖÖ—BÂu$ô¤T5Eõ5DEU2æ§6öâr’æv÷fW&ææ6U&V6÷fW'“°¢6öç7B&6U6–×VÆF–öå&V6÷fW'’Ò§6öäB‡G'W7FVE&÷VæC3&W—$&6Ræ6öÖÖ—BÂw6–×VÆF–öâô5U%$TåEõ5DEU2æ§6öâr’æv÷fW&ææ6U&V6÷fW'“°¢6öç7B&÷VæC3$7F—fRÒWF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåFƒ°¢76W'B„¥4ôâç7G&–æv–g’†WF†÷&—G’æv÷fW&ææ6U&V6÷fW'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢ââæ&6TWF†÷&—G•&V6÷fW'’À¢7FGW3¢&÷VæC3$7F—fRòu5DU%õ45$TTåõ$ô¤T5D”ôåô4õ%$T5D”ôåô”åõ$ôu$U52r¢u$TõTäTEõ„4Sô4Äõ5U$UôäEô4ôåE$5Eô”åDTu$•E’rÀ¢†6S¢W‡V7FVE†6S¢Ò’Âw&RÖ6Æ÷7W&RWF†÷&—G’v÷fW&ææ6U&V6÷fW'’F–ffW'2g&öÒF†RW†7B&Wf–WvVB7FFRr“°¢76W'B„¥4ôâç7G&–æv–g’‡7FGW2æv÷fW&ææ6U&V6÷fW'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢ââæ&6U7FGW5&V6÷fW'’À¢7FGW3¢&÷VæC3$7F—fRòu5DU%õ45$TTåõ$ô¤T5D”ôåô4õ%$T5D”ôåô”åõ$ôu$U52r¢u$TõTäTEõ„4Sô4Äõ5U$UôäEô4ôåE$5Eô”åDTu$•E’rÀ¢†6S¢W‡V7FVE†6S¢Ò’Âw&RÖ6Æ÷7W&R$ô¤T5Eõ5DEU2v÷fW&ææ6U&V6÷fW'’F–ffW'2g&öÒF†RW†7B&Wf–WvVB7FFRr“°¢76W'B„¥4ôâç7G&–æv–g’‡6–Òæv÷fW&ææ6U&V6÷fW'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢ââæ&6U6–×VÆF–öå&V6÷fW'’À¢7FGW3¢&÷VæC3$7F—fRòu5DU%õ45$TTåõ$ô¤T5D”ôåô4õ%$T5D”ôåô”åõ$ôu$U52r¢u$TõTäTEõ„4Sô4Äõ5U$Uô”åDTu$•E’p¢Ò’Âw&RÖ6Æ÷7W&R6–×VÆF–öâv÷fW&ææ6U&V6÷fW'’F–ffW'2g&öÒF†RW†7B&Wf–WvVB7FFRr“°§Ð¦6öç7BW‡V7FVE7FW%7FGW2Ò7FW%&ö¦V7F–öä÷Vâòt”åõ$ôu$U55ô4ôåE$5Eô4õ%$T5D”ôåõ$UT•$TBr¢u55ô4ôåE$5Bs°¦6öç7BW‡V7FVE7FW%6VÂÒ7FW%&ö¦V7F–öä÷Vâòw6–×VÆF–öâöW†V7WF&ÆR×6VÂ×c"æ§6öâr¢c56VÅFƒ°¦76W'B„¥4ôâç7G&–æv–g’‡7FGW2ç66÷VE76W2’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FW¢u55ô4äôä”4ÂrÀ¢7FW#¢W‡V7FVE7FW%7FGW2À¢7FW3¢u55ôÔôDTÂrÀ¢7FWC¢t”åõ$ôu$U52rÀ¢7FWS¢t$Äô4´TBrÀ¢7FWc¢t$Äô4´TBp§Ò’Âu$ô¤T5Eõ5DEU266÷VB76W2F–ffW"g&öÒF†RW†7B7W'&VçBvFW2r“°¦76W'B„¥4ôâç7G&–æv–g’†F—7F6†W"æ6æöæ–6Å6VÇ2’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FW¢wVÆ—G’×&Wf–Ww2÷7FWÓ×&W6VÂ×&÷VæBÓ‚÷6VÂ×&÷VæBÓ‚æ§6öârÀ¢7FW#¢W‡V7FVE7FW%6VÂÀ¢7FW4f–æÄ§VFvS¢wVÆ—G’×&Wf–Ww2÷7FWÓ2ÖÆ&vR×66ÆR×fÆ–FF–öâöf–æÂÖ§VFvRæ§6öârÀ¢7FW46ö×ÆWF–öã¢wVÆ—G’×&Wf–Ww2÷7FWÓ2ÖÆ&vR×66ÆR×fÆ–FF–öâö6ö×ÆWF–öâÖWf–FVæ6Ræ§6öâp§Ò’ÂvF—7F6†W"6æöæ–6Â6VÂö–çFW'2F–ffW"g&öÒF†RW†7B7W'&VçBWF†÷&—F–W2r“°¦76W'B„¥4ôâç7G&–æv–g’†F—7F6†W"ç66÷UG'WF‚’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FW¢u55ô4äôä”4ÂrÀ¢7FW#¢W‡V7FVE7FW%7FGW2À¢7FW3¢u55ôÔôDTÂrÀ¢7FWC¢t”åõ$ôu$U52rÀ¢7FWTÆÆ÷vVC¢fÇ6RÀ¢&öGV7F–öäÆÆ÷vVC¢fÇ6RÀ¢‡—6–6Ä•†öæUfW&–f–VC¢fÇ6P§Ò’ÂvF—7F6†W"66÷RG'WF‚F–ffW'2g&öÒF†RW†7B7W'&VçBvFW2r“°¦–b‡7FW%&ö¦V7F–öä÷Vâ’°¢76W'B„¥4ôâç7G&–æv–g’†WF†÷&—G’æW†V7WF&ÆT6öçG&7B’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD÷Vå7FW$WF†÷&—G’’Âv÷Vâ7FW"WF†÷&—G’×W7B&VÖ–âF†RW†7B6VÆVB×c"6VÖçF–2Õ7FFRr“°¢76W'B„¥4ôâç7G&–æv–g’‡6–Òç7FW"’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD÷Vå7FW%6–×VÆF–öâ’Âv÷Vâ7FW"6–×VÆF–öâÖ—'&÷"F–ffW'2g&öÒF†RW†7B6VÆVB×c"6VÖçF–2Õ7FFRr“°¢76W'B‚ö&¦V7Bæ†4÷vâ‡7FGW2ÂvW†V7WF&ÆT6öçG&7Br’Âv÷Vâ7FW"×W7Bæ÷BV&Æ—6‚52ö–çFW"ö&¦V7B–â$ô¤T5Eõ5DEU2r“°¢76W'B‚ö&¦V7Bæ†4÷vâ†F—7F6†W"Âw7FW$W†V7WF&ÆT6öçG&7Br’Âv÷Vâ7FW"×W7Bæ÷BV&Æ—6‚52ö–çFW"ö&¦V7B–âF—7F6†W"r“°§Ð¦–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3æ§6öâr’°¢76W'B‡7FW%&ö¦V7F–öä÷VâÂu7FW"6ææ÷B72v†–ÆR&÷VæB3—27F–ÆÂ7F—fRr“°§Ð¦ÆWBfW&–f–VEc56VÂÒçVÆÃ°¦–b‚7FW%&ö¦V7F–öä÷Vâ’°¢76W'B†6Æ÷7W&U&W—$7&—F–46ö×ÆWFRÂu7FW"6ææ÷B72&Vf÷&RF†R6Æ÷7W&RÖ–çFVw&—G’7&—F–276W2r“°¢76W'B‡7FW$6÷'&V7F–öâÂu7FW"52&WV—&W2F†Rg&÷¦Vâ&÷VæB3"6÷'&V7F–öâ6öçG&öÂr“°¢76W'B†WF†÷&—G’æW†V7WF&ÆT6öçG&7Bç6VÂÓÓÒc56VÅF‚Âu7FW"52&WV—&W2F†Rc26VÂWF†÷&—G’ö–çFW"r“°¢76W'B‡&T7F—fFVD6öçF–çV—G’Âu7FW"52&WV—&W2G'W7FVB&RÖ7F—fF–öâ6öçF–çV—G’Wf–FVæ6Rr“°¢6öç7B6öçF–çV—G”6öÖÖ—BÒf—'7DFD6öÖÖ—B‡7FW$6öçF–çV—G•F‚“°¢76W'B†6öçF–çV—G”6öÖÖ—BÂu7FW"527F—fF–öâ6ææ÷B&R&W6öÇfVBv—F†÷WBF†R6öçF–çV—G’6öÖÖ—Br“°¢6öç7B7F—fF–öä6æF–FFW2Òv—B…²w&WbÖÆ—7BrÂrÒ×&WfW'6RrÂG¶6öçF–çV—G”6öÖÖ—GÒâä„TFÒ¢ç7Æ—B‚uÆâr¢æf–ÇFW"„&ööÆVâ“°¢6öç7B7FW%747F—fF–öä6öÖÖ—BÒ7F—fF–öä6æF–FFW2æf–æB†6öÖÖ—BÓâ°¢G'’°¢&WGW&â§6öäB†6öÖÖ—BÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr’æW†V7WF&ÆT6öçG&7Còç7FW%7FGW2ÓÓÒu55ô4ôåE$5Bs°¢Ò6F6‚°¢&WGW&âfÇ6S°¢Ð¢Ò“°¢76W'B‡7FW%747F—fF–öä6öÖÖ—BÂu7FW"527F—fF–öâ6öÖÖ—B—2Ö—76–ærr“°¢6öç7B÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—BÒ&W6öÇfU7FW%÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—B‚“°¢6öç7B7F—fF–öå&VçBÒ÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—Bóò6öçF–çV—G”6öÖÖ—C°¢76W'B†v—B…²w&Wb×'6RrÂG·7FW%747F—fF–öä6öÖÖ—GÕæÒ’ÓÓÒ7F—fF–öå&VçBÂu7FW"527F—fF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R&Wf–WvVB6öçF–çV—G’&÷VæF'’r“°¢76W'DW†7D6†ævVEF‡2†7F—fF–öå&VçBÂ7FW%747F—fF–öä6öÖÖ—BÂW‡V7FVE7FW%747F—fF–öåw&—FW2Âu7FW"527F—fF–öâ6öÖÖ—Br“°¢6öç7B†6S7&—F–5F‚ÒwVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’ö7&—F–2×7VÖÖ'’×&÷VæBÓ2æ§6öâs°¢6öç7B†6S7&—F–5F&vWBÒW†—7G2‡†6S7&—F–5F‚¢òv—B…²w&Wb×'6RrÂG¶f—'7DFD6öÖÖ—B‡†6S7&—F–5F‚—ÕæÒ¢¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'B‡†6S7&—F–5F&vWBÓÓÒ7FW%747F—fF–öä6öÖÖ—BÂu7FW"527F—fF–öâ×W7B&VÖ–âF†RW†7BF–ÂVçF–ÂF†R†6R–æFWVæFVçB7&—F–2–ÖÖVF–FVÇ’föÆÆ÷w2—Br“°¢76W'B‡&T7F—fFVEc56VÂÂu7FW"52&WV—&W2G'W7FVB&RÖ7F—fF–öâc26VÂfW&–f–6F–öâr“°¢fW&–f–VEc56VÂÒ&T7F—fFVEc56VÃ°¢'VäæöFUfW&–f–W"‡c46öçF–çV—G•fW&–f–W%F‚Âu7FW26öçF–çV—G’r“°¢fW&–g•c4WF†÷&—G•ö–çFW'2‚“°§Ð¦6öç7B7F—fU3%&Wf—6–öäÆö6²ÒWF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&Wf—6–öä6öçG&öÅF‚ò3%&Wf—6–öäFV6—6–öäÆö6°¢¢WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%6V6öæE&Wf—6–öä6öçG&öÅF‚ò3%6V6öæE&Wf—6–öäÆö6°¢¢WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%F†—&E&Wf—6–öä6öçG&öÅF‚ò3%F†—&E&Wf—6–öäÆö6°¢¢çVÆÃ°¦6öç7B3%W6W%&Wf—6–öäf–æF–æt–G2ÒWF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôâp¢ò†7F—fU3%&Wf—6–öäÆö6³òç&WVW7FVD6†ævW2óòµÒ’æÖ†6†ævRÓâ6†ævRæ–B¢¢µÓ°¦6öç7B3$–çFW&æÅ–G2ÒWF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&W—$6öçG&öÅF‚bbWF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õõd•5TÅõ$U•"p¢ò3%&W—$f–æF–æt–G0¢¢3%W6W%&Wf—6–öäf–æF–æt–G3°¦6öç7B3$–çFW&æÅ÷VâÒ3$–çFW&æÅ–G2æÆVæwFƒ°¦6öç7BW‡V7FVD÷Väf–æF–æw2Ò°¢âââ‡7FW%&ö¦V7F–öä÷Vâò²u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓuÒ¢µÒ’À¢u3BÕ$T4õdU%’Õd•2ÓrÀ¢ââç3$–çFW&æÅ–G2À¢âââ‚6Æ÷7W&U&W—$7&—F–46ö×ÆWFRò°¢u„4SÕõ5BÔ4Äõ5U$RÔ$õTäD%’ÓrÀ¢u„4SÔ44UDä4RÔ4Äõ5U$RÔ”BÓrÀ¢u„4SÕ$TÔEU$RÔUd”DTä4RÓrÀ¢u„4SÔ”ÔÕUD$ÄRÔUd”DTä4RÔõdU%u$•DRÓp¢Ò¢µÒ’À¢u„4SÕ"Õ#‚Õ5DÄRÔÔUDDDrÀ¢u„4SÕ"Ô´”Ô’ÕTå$õDT5DTBÔU…DU$äÂÔTädõ$4TÔTåBp¥Ó°¦76W'B†WF†÷&—G’æv÷fW&ææ6U&V6÷fW'’ç†6SÓÓÒW‡V7FVE†6SÂvWF†÷&—G’†6R6÷VçBÖ—6ÖF6‚r“°¦76W'B‡7FGW2æv÷fW&ææ6U&V6÷fW'’ç†6SÓÓÒW‡V7FVE†6SÂu$ô¤T5Eõ5DEU2†6R6÷VçBÖ—6ÖF6‚r“°¦76W'B†WF†÷&—G’ævÆö&ÄvFRçVç&W6öÇfVEÓÓÒ‡7FW%&ö¦V7F–öä÷Vâò¢’ÂvWF†÷&—G’vÆö&ÂÖ—6ÖF6‚r“°¦76W'B‡7FGW2æ÷Väf–æF–æw2åÓÓÒ‡7FW%&ö¦V7F–öä÷Vâò¢’Âu$ô¤T5Eõ5DEU2vÆö&ÂÖ—6ÖF6‚r“°¦76W'B†WF†÷&—G’ævÆö&ÄvFRçVç&W6öÇfVEÓÓÒW‡V7FVE†6S²²3$–çFW&æÅ÷VâÂvvÆö&Â×W7BWVÂ†6RÂ3B&öGV7BæB7F—fR3"–çFW&æÂ&W—"f–æF–æw2r“°¦76W'B‡7FGW2æ÷Väf–æF–æw2åÓÓÒW‡V7FVE†6S²²3$–çFW&æÅ÷VâÂu$ô¤T5Eõ5DEU2vÆö&ÂÖ—6ÖF6‚r“°¦76W'B†WF†÷&—G’æv÷fW&ææ6U&V6÷fW'’ç†6S"ÓÓÒ"bbWF†÷&—G’ævÆö&ÄvFRçVç&W6öÇfVE"ÓÓÒ"ÂvWF†÷&—G’†6RövÆö&Â"Ö—6ÖF6‚r“°¦76W'B‡7FGW2æv÷fW&ææ6U&V6÷fW'’ç†6S"ÓÓÒ"bb7FGW2æ÷Väf–æF–æw2å"ÓÓÒ"Âu$ô¤T5Eõ5DEU2†6RövÆö&Â"Ö—6ÖF6‚r“°¦76W'B„¥4ôâç7G&–æv–g’†WF†÷&—G’ævÆö&ÄvFRæ÷Väf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD÷Väf–æF–æw2’ÂvWF†÷&—G’÷VâÖf–æF–ær”G2÷"÷&FW"Ö—6ÖF6‚r“°¦76W'B„¥4ôâç7G&–æv–g’‡7FGW2æ÷Väf–æF–æw2æ—FV×2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVD÷Väf–æF–æw2’Âu$ô¤T5Eõ5DEU2÷VâÖf–æF–ær”G2÷"÷&FW"Ö—6ÖF6‚r“°¦76W'B‡6–Òæv÷fW&ææ6U&V6÷fW'’ç7FW$6÷'&V7F–öâÓÓÒ7FW$6÷'&V7F–öåF‚Âw6–×VÆF–öâ7FW"6÷'&V7F–öâÆ–æVvRÖ—6ÖF6‚r“°¦76W'B‡6–Òæv÷fW&ææ6U&V6÷fW'’çÆææVD6÷'&V7FVD6Æ÷7W&RÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ32æ§6öârÂw6–×VÆF–öâ6÷'&V7FVB6Æ÷7W&R×W7B&RW†7B&÷VæB32F‚r“°¦76W'B†F—7F6†W"ç7FW%67&VVå&ö¦V7F–öä6÷'&V7F–öâÓÓÒ7FW$6÷'&V7F–öåF‚ÂvF—7F6†W"7FW"6÷'&V7F–öâÆ–æVvRÖ—6ÖF6‚r“°¦76W'B†F—7F6†W"çÆææVDv÷fW&ææ6U&V6÷fW'”6Æ÷7W&RÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ32æ§6öârÂvF—7F6†W"6÷'&V7FVB6Æ÷7W&R×W7B&RW†7B&÷VæB32F‚r“°¦76W'B†WF†÷&—G’æv÷fW&ææ6U&V6÷fW'’ç7FW$6÷'&V7F–öâÓÓÒ7FW$6÷'&V7F–öåF‚ÂvWF†÷&—G’7FW"6÷'&V7F–öâÆ–æVvRÖ—6ÖF6‚r“°¦76W'B†WF†÷&—G’æv÷fW&ææ6U&V6÷fW'’çÆææVD6÷'&V7FVD6Æ÷7W&RÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ32æ§6öârÂvWF†÷&—G’6÷'&V7FVB6Æ÷7W&R×W7B&RW†7B&÷VæB32F‚r“°¦76W'B‡7FGW2ç66÷VE76W2ç7FW"ÓÓÒWF†÷&—G’æW†V7WF&ÆT6öçG&7Bç7FW%7FGW2Âu7FW"7FGW2F–ffW'2&WGvVVâWF†÷&—G’æB$ô¤T5Eõ5DEU2r“°¦76W'B‡6–Òç7FW"ç7FGW2ÓÓÒWF†÷&—G’æW†V7WF&ÆT6öçG&7Bç7FW%7FGW2Âu7FW"7FGW2F–ffW'2&WGvVVâWF†÷&—G’æB6–×VÆF–öâÖ—'&÷"r“°¦6öç7BvFUFW‡BÒFW‡B‚uTÄ•E•ôtDRæÖBr“°¦6öç7B†æF÷fW%FW‡BÒFW‡B‚u$ô¤T5Eô„äDõdU"æÖBr“°¦–b‚6Æ÷7W&U&W—$7&—F–46ö×ÆWFR’°¢76W'B†vFUFW‡Bæ–æ6ÇVFW2‚t7W'&VçB†6Rõ¢òFr’ÂuTÄ•E•ôtDRFöW2æ÷B6†÷rVæF–ær†6Rõr“°¢76W'B††æF÷fW%FW‡Bæ–æ6ÇVFW2‚vòFr’Âv†æF÷fW"FöW2æ÷B6†÷rVæF–ær†6Rõr“°§ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3æ§6öâr’°¢76W'B†vFUFW‡Bæ–æ6ÇVFW2‚t7W'&VçB†6Rõ¢òr’Âw&÷VæB3TÄ•E•ôtDRFöW2æ÷B6†÷r&W6öÇfVB†6Rõr“°¢76W'B††æF÷fW%FW‡Bæ–æ6ÇVFW2‚t7W'&VçB†6RVç&W6öÇfVBr’bb†æF÷fW%FW‡Bæ–æ6ÇVFW2‚vòr’Âw&÷VæB3†æF÷fW"FöW2æ÷B6†÷r&W6öÇfVB†6Rõr“°§ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚’°¢76W'B†vFUFW‡Bæ–æ6ÇVFW2‚u†6RVç&W6öÇfVBõ¢òr’Âw&÷VæB3"TÄ•E•ôtDRFöW2æ÷B6†÷r&W6öÇfVB†6Rõr“°¢76W'B††æF÷fW%FW‡Bæ–æ6ÇVFW2‚u†6Rõòr’Âw&÷VæB3"†æF÷fW"FöW2æ÷B6†÷r&W6öÇfVB†6Rõr“°§ÒVÇ6R°¢76W'B‡†6S6Æ÷6VBbbvFUFW‡Bæ–æ6ÇVFW2‚t6÷'&V7FVB†6RVç&W6öÇfVBõ¢òr’Âw÷7BÖ6Æ÷7W&RTÄ•E•ôtDRFöW2æ÷B6†÷r6÷'&V7FVB†6Rõr“°§Ð ¦76W'D&÷VæF'”†—7F÷'’‡&ö÷D6öçG&öÂæVçG'’æ†VBÂ6÷'&V7F–öâæVçG'’æ†VBÂ&ö÷D6öçG&öÂÂw&÷VæB#‚6öçFVçBr“°¦76W'B†66WFæ6TFFVæGVÒç&VçD66WFæ6RÓÓÒwVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’ö66WFæ6RÖÖG&—‚æ§6öârÂu†6R66WFæ6RFFVæGVÒ&VçBÖ—6ÖF6‚r“°¦76W'B†66WFæ6TFFVæGVÒæ6÷'&V7F–öâç7FW$6÷'&V7F–öâæVæG5v—F‚‚w&÷VæBÓ3"æ§6öâr’Âu7FW"6÷'&V7F–öâÆ–æVvRÖ—76–ærr“°¦76W'B†66WFæ6TFFVæGVÒæ6÷'&V7F–öâæWF†÷&—FF—fT6Æ÷7W&RæVæG5v—F‚‚w&÷VæBÓ32æ§6öâr’Âv6÷'&V7FVB†6R6Æ÷7W&RÆ–æVvRÖ—76–ærr“°¦76W'B†GFV×FVD6Æ÷7W&Rç7FGW2ÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%’rÂvGFV×FVB&÷VæB36Æ÷7W&R†—7F÷'’6†ævVBr“° ¦6öç7B7WW'6W76–öå&÷VæC"Ò§6öâ‚wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’öWf–FVæ6R×7WW'6W76–öâ×&Vv—7FW"×&÷VæBÓ"æ§6öâr“°¦6öç7B&Vv—7FW&VDg&÷¦VâÒæWrÖ…°¢ââç7WW'6W76–öå&÷VæC"æg&÷¦VäGFV×FVD6Æ÷7W&T†—7F÷'’À¢ââç7WW'6W76–öå&÷VæC"æg&÷¦Vä6÷'&V7F–öä†—7F÷'’À¢ââç7WW'6W76–öå&÷VæC"æg&÷¦Vä&÷VæF'”6öçG&öÇ0¥ÒæÖ†VçG'’Óâ¶VçG'’çF‚ÂVçG'’æ&Æö%Ò’“°¦f÷"†6öç7B·ÂW‡V7FVD&Æö%Òöbö&¦V7BæVçG&–W2‡²ââæg&÷¦VäGFV×FVD6Æ÷7W&T&Æö'2Âââæg&÷¦Vä6÷'&V7F–öä&Æö'2Ò’’°¢76W'B‡&Vv—7FW&VDg&÷¦VâævWB‡’ÓÓÒW‡V7FVD&Æö"Â6ö×ÆWFR7WW'6W76–öâ&Vv—7FW"Ö—76–ær÷"Ö—6&–æF–ærG·Ö“°§Ð ¦6öç7B6Æ÷7W&TWf–FVæ6RÒ°¢7FW$6öçF–çV—G“¢7FW$6öçF–çV—G•F‚À¢7&—F–3¢wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’ö7&—F–2×7VÖÖ'’×&÷VæBÓ2æ§6öârÀ¢f–æÄ§VFvS¢wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’öf–æÂÖ§VFvR×&÷VæBÓ"æ§6öârÀ¢6ö×ÆWF–öã¢wVÆ—G’×&Wf–Ww2÷†6RÓÖv÷fW&ææ6R×&V6÷fW'’ö6ö×ÆWF–öâÖWf–FVæ6R×&÷VæBÓ"æ§6öârÀ¢Æ—fU&VF&6³¢†6S6Æ÷7W&TÆ—fU&VF&6µF€§Ó°¦6öç7BW‡V7FVD6Æ÷7W&T6öÖÖ—Ew&—FW2Ò°¢6Æ÷7W&UF‚À¢t5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öârÀ¢u$ô¤T5Eõ5DEU2æ§6öârÀ¢t•õ$ô¤T5EõôÄ”5’æ§6öârÀ¢uTÄ•E•ôtDRæÖBrÀ¢u$ô¤T5Eô„äDõdU"æÖBrÀ¢ttTåE2æÖBrÀ¢u$TDÔRæÖBrÀ¢w6–×VÆF–öâô5U%$TåEõ5DEU2æ§6öârÀ¢ræv—F‡V"÷v÷&¶fÆ÷w2ô5U%$TåEõ5DEU2æÖBrÀ¢wVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂæ§6öâp¥Ó° ¦6öç7BW‡V7FVE†6S6÷fW&vRÒ°¢u$õTäC3õ$U•%õD$tUEô”åDTu$•E’rÀ¢u$õTäC3%ôU„5Eõu$•DUô$õTäD%’rÀ¢u5DU%õc5õ4TÅôäEô4ôåD”åT•E’rÀ¢täôåõ5DU%ôUD„õ$•E•ôe$TU¤RrÀ¢tUd”DTä4Uô4„”åô”ÔÕUD$”Ä•E’rÀ¢u$ôET5D”ôåõ%TåD”ÔUôDUd”4Uô$õTäD$”U2p¥Ó°¦6öç7BW‡V7FVE†6Sf–æF–æw2Ò°¢²–C¢u„4SÕõ5BÔ4Äõ5U$RÔ$õTäD%’ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÔ44UDä4RÔ4Äõ5U$RÔ”BÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÕ$TÔEU$RÔUd”DTä4RÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÔ”ÔÕUD$ÄRÔUd”DTä4RÔõdU%u$•DRÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÕ"Õ#‚Õ5DÄRÔÔUDDDrÂ6WfW&—G“¢u"rÂ&W6öÇfVC¢fÇ6RÒÀ¢²–C¢u„4SÕ"Ô´”Ô’ÕTå$õDT5DTBÔU…DU$äÂÔTädõ$4TÔTåBrÂ6WfW&—G“¢u"rÂ&W6öÇfVC¢fÇ6RÐ¥Ó° ¦gVæ7F–öâfW&–g•†6S&Wf–WtWf–FVæ6U&Vf—‚‚’°¢6öç7B&W6Væ6RÒö&¦V7Bæg&öÔVçG&–W2„ö&¦V7BæVçG&–W2‡°¢7&—F–3¢6Æ÷7W&TWf–FVæ6Ræ7&—F–2À¢f–æÄ§VFvS¢6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvRÀ¢6ö×ÆWF–öã¢6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâÀ¢Æ—fU&VF&6³¢6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6°¢Ò’æÖ‚…¶¶W’Âf–ÆUÒ’Óâ¶¶W’ÂW†—7G2†f–ÆR•Ò’“°¢76W'B‚&W6Væ6Ræf–æÄ§VFvRÇÂ&W6Væ6Ræ7&—F–2Âu†6Rf–æÂ§VFvRW†—7G2&Vf÷&RF†R–æFWVæFVçB7&—F–2r“°¢76W'B‚&W6Væ6Ræ6ö×ÆWF–öâÇÂ&W6Væ6Ræf–æÄ§VFvRÂu†6R6ö×ÆWF–öâW†—7G2&Vf÷&RF†Rf–æÂ§VFvRr“°¢76W'B‚&W6Væ6RæÆ—fU&VF&6²ÇÂ&W6Væ6Ræ6ö×ÆWF–öâÂu†6RÆ—fR&VF&6²W†—7G2&Vf÷&R6ö×ÆWF–öâr“°¢–b‚&W6Væ6Ræ7&—F–2’&WGW&âçVÆÃ° ¢6öç7B7&—F–2Ò§6öâ†6Æ÷7W&TWf–FVæ6Ræ7&—F–2“°¢76W'DW†7D¶W•6WB†7&—F–2Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂvVF—EF&vWBrÂwfW&F–7BrÂv6÷fW&vRrÂvf–æF–æw2rÂwVç&W6öÇfVBrÂvÖ†–×VÕfW&F–7BuÒÂu†6R–æFWVæFVçB7&—F–2r“°¢76W'DW†7D¶W•6WB†7&—F–2æVF—EF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂu†6R–æFWVæFVçB7&—F–2F&vWBr“°¢76W'DW†7D¶W•6WB†7&—F–2çVç&W6öÇfVBÂ²urÂurÂu"uÒÂu†6R–æFWVæFVçB7&—F–2Vç&W6öÇfVBr“°¢76W'B†7&—F–2ç66†VÖfW'6–öâÓÓÒbb7&—F–2æ'F–f7D–BÓÓÒv6G2×F÷vW"×†6SÖv÷fW&ææ6R×&V6÷fW'’Ö7&—F–2×&÷VæBÓ2rÂu†6R–æFWVæFVçB7&—F–2–FVçF—G’Ö—6ÖF6‚r“°¢76W'B†7&—F–2ç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb7&—F–2æ'&æ6‚ÓÓÒv¶–Ö’rbb7&—F–2æ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu†6R–æFWVæFVçB7&—F–2WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†7&—F–2çfW&F–7BÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%•ô”äDUTäDTåEô5$•D”2rbb7&—F–2æÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ„4Sôd”äÅô¥TDtRrÂu†6R–æFWVæFVçB7&—F–2fW&F–7B&÷VæF'’Ö—6ÖF6‚r“°¢76W'D7&—F–6Äf–æF–æt6÷VçG2†7&—F–2Âu†6R–æFWVæFVçB7&—F–2r“°¢76W'B„¥4ôâç7G&–æv–g’†7&—F–2æ6÷fW&vR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6S6÷fW&vR’bb¥4ôâç7G&–æv–g’†7&—F–2æf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6Sf–æF–æw2’bb7&—F–2çVç&W6öÇfVBå"ÓÓÒ"Âu†6R–æFWVæFVçB7&—F–26÷fW&vRöf–æF–ær6WBÖ—6ÖF6‚r“°¢6öç7BF&vWD6öÖÖ—BÒ7&—F–2æVF—EF&vWBæ6öÖÖ—C°¢6öç7BF&vWEG&VRÒ7&—F–2æVF—EF&vWBçG&VS°¢76W'B‡F&vWEG&VRÓÓÒv—B…²w&Wb×'6RrÂG·F&vWD6öÖÖ—GÕç·G&VWÖÒ’Âu†6R7&—F–2F&vWB6öÖÖ—B÷G&VRÖ—6ÖF6‚r“°¢6öç7BF&vWDWF†÷&—G’Ò§6öäB‡F&vWD6öÖÖ—BÂt5U%$TåEôUD„õ$•E•ô”äDU‚æ§6öâr“°¢76W'B‡F&vWDWF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚bbF&vWDWF†÷&—G’æW†V7WF&ÆT6öçG&7Còç7FW%7FGW2ÓÓÒu55ô4ôåE$5BrbbF&vWDWF†÷&—G’æW†V7WF&ÆT6öçG&7Còç6VÂÓÓÒc56VÅF‚Âu†6R7&—F–2F&vWB—2æ÷BF†R6÷'&V7FVB7FW"527F—fF–öâr“°¢76W'B†v—B…²v6BÖf–ÆRrÂrÖRrÂG·F&vWD6öÖÖ—GÓ¢G·7FW$6öçF–çV—G•F‡ÖÒ’ÓÓÒrrÂu†6R7&—F–2F&vWBÆ6·27FW26öçF–çV—G’Wf–FVæ6Rr“°¢6öç7B7&—F–46öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6Ræ7&—F–2“°¢76W'B†7&—F–46öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶7&—F–46öÖÖ—GÕæÒ’ÓÓÒF&vWD6öÖÖ—BÂu†6R7&—F–2×W7B–ÖÖVF–FVÇ’föÆÆ÷r—G2W†7BVF—BF&vWBr“°¢76W'DW†7D6†ævVEF‡2‡F&vWD6öÖÖ—BÂ7&—F–46öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6Ræ7&—F–5ÒÂu†6R7&—F–26öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6Æ÷7W&TWf–FVæ6Ræ7&—F–2Â7&—F–46öÖÖ—B“°¢–b‚&W6Væ6Ræf–æÄ§VFvR’&WGW&â²F&vWD6öÖÖ—BÂF&vWEG&VRÂ7&—F–46öÖÖ—BÓ° ¢6öç7B§VFvRÒ§6öâ†6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvR“°¢76W'DW†7D¶W•6WB†§VFvRÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwF&vWBrÂv7&—F–2rÂwfW&F–7BrÂv6÷fW&vRrÂvf–æF–æw2rÂwVç&W6öÇfVBrÂw&W6öÇfVDf–æF–æw2rÂw&WF–æVE"rÂvÖ†–×VÕfW&F–7BuÒÂu†6Rf–æÂ§VFvRr“°¢76W'DW†7D¶W•6WB†§VFvRçF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂu†6Rf–æÂ§VFvRF&vWBr“°¢76W'DW†7D¶W•6WB†§VFvRæ7&—F–2Â²wF‚rÂv&Æö"uÒÂu†6Rf–æÂ§VFvR7&—F–2&–æF–ærr“°¢76W'DW†7D¶W•6WB†§VFvRçVç&W6öÇfVBÂ²urÂurÂu"uÒÂu†6Rf–æÂ§VFvRVç&W6öÇfVBr“°¢76W'B†§VFvRç66†VÖfW'6–öâÓÓÒbb§VFvRæ'F–f7D–BÓÓÒv6G2×F÷vW"×†6SÖv÷fW&ææ6R×&V6÷fW'’Öf–æÂÖ§VFvR×&÷VæBÓ"rbb§VFvRç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb§VFvRæ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb§VFvRæ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu†6Rf–æÂ§VFvR–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†§VFvRçF&vWBæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb§VFvRçF&vWBçG&VRÓÓÒF&vWEG&VRbb§VFvRæ7&—F–2çF‚ÓÓÒ6Æ÷7W&TWf–FVæ6Ræ7&—F–2bb§VFvRæ7&—F–2æ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G¶6Æ÷7W&TWf–FVæ6Ræ7&—F–7ÖÒ’Âu†6Rf–æÂ§VFvRF&vWB÷"7&—F–2&–æF–ærÖ—6ÖF6‚r“°¢76W'B†§VFvRçfW&F–7BÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%’rbb§VFvRæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ„4Sô4ôÕÄUD”ôåôUd”DTä4RrÂu†6Rf–æÂ§VFvRfW&F–7B&÷VæF'’Ö—6ÖF6‚r“°¢76W'D7&—F–6Äf–æF–æt6÷VçG2†§VFvRÂu†6Rf–æÂ§VFvRr“°¢6öç7B&W6öÇfVDf–æF–æw2ÒW‡V7FVE†6Sf–æF–æw2æf–ÇFW"†VçG'’ÓâVçG'’ç&W6öÇfVB’æÖ†VçG'’ÓâVçG'’æ–B“°¢6öç7B&WF–æVE"ÒW‡V7FVE†6Sf–æF–æw2æf–ÇFW"†VçG'’ÓâVçG'’ç6WfW&—G’ÓÓÒu"r’æÖ†VçG'’ÓâVçG'’æ–B“°¢76W'B„¥4ôâç7G&–æv–g’†§VFvRæ6÷fW&vR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6S6÷fW&vR’bb¥4ôâç7G&–æv–g’†§VFvRæf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6Sf–æF–æw2’bb¥4ôâç7G&–æv–g’†§VFvRç&W6öÇfVDf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’‡&W6öÇfVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†§VFvRç&WF–æVE"’ÓÓÒ¥4ôâç7G&–æv–g’‡&WF–æVE"’bb§VFvRçVç&W6öÇfVBå"ÓÓÒ"Âu†6Rf–æÂ§VFvR&W7VÇB6WBÖ—6ÖF6‚r“°¢6öç7B§VFvT6öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvR“°¢76W'B†§VFvT6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶§VFvT6öÖÖ—GÕæÒ’ÓÓÒ7&—F–46öÖÖ—BÂu†6Rf–æÂ§VFvR×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R–æFWVæFVçB7&—F–2r“°¢76W'DW†7D6†ævVEF‡2†7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvUÒÂu†6Rf–æÂÖ§VFvR6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvRÂ§VFvT6öÖÖ—B“°¢–b‚&W6Væ6Ræ6ö×ÆWF–öâ’&WGW&â²F&vWD6öÖÖ—BÂF&vWEG&VRÂ7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÓ° ¢6öç7B6ö×ÆWF–öâÒ§6öâ†6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâ“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâÂ²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂwfW&–f–VD6öçFVçBrÂvf–æÄ§VFvRrÂwv÷&¶fÆ÷tWf–FVæ6RrÂwfW&F–7BrÂw†6SVç&W6öÇfVBrÂw&W6öÇfVDf–æF–æw2rÂw&WF–æVE"rÂvÖ†–×VÕfW&F–7BuÒÂu†6R6ö×ÆWF–öâWf–FVæ6Rr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâçfW&–f–VD6öçFVçBÂ²v6öÖÖ—BrÂwG&VRuÒÂu†6R6ö×ÆWF–öâfW&–f–VB6öçFVçBr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâæf–æÄ§VFvRÂ²wF‚rÂv&Æö"uÒÂu†6R6ö×ÆWF–öâ§VFvR&–æF–ærr“°¢76W'DW†7D¶W•6WB†6ö×ÆWF–öâç†6SVç&W6öÇfVBÂ²urÂuuÒÂu†6R6ö×ÆWF–öâVç&W6öÇfVBr“°¢76W'B†6ö×ÆWF–öâç66†VÖfW'6–öâÓÓÒbb6ö×ÆWF–öâæ'F–f7D–BÓÓÒv6G2×F÷vW"×†6SÖv÷fW&ææ6R×&V6÷fW'’Ö6ö×ÆWF–öâ×&÷VæBÓ"rbb6ö×ÆWF–öâç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb6ö×ÆWF–öâæ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb6ö×ÆWF–öâæ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu†6R6ö×ÆWF–öâ–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†6ö×ÆWF–öâçfW&–f–VD6öçFVçBæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb6ö×ÆWF–öâçfW&–f–VD6öçFVçBçG&VRÓÓÒF&vWEG&VRbb6ö×ÆWF–öâæf–æÄ§VFvRçF‚ÓÓÒ6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvRbb6ö×ÆWF–öâæf–æÄ§VFvRæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G¶6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvWÖÒ’Âu†6R6ö×ÆWF–öâF&vWB÷"§VFvR&–æF–ærÖ—6ÖF6‚r“°¢76W'B†6ö×ÆWF–öâçfW&F–7BÓÓÒu$TE•ôdõ%õ„4SôÄ•dUõ$TD$4²rbb6ö×ÆWF–öâæÖ†–×VÕfW&F–7BÓÓÒu$TE•ôdõ%õ„4SôÄ•dUõ$TD$4²rbb6ö×ÆWF–öâç†6SVç&W6öÇfVBåÓÓÒbb6ö×ÆWF–öâç†6SVç&W6öÇfVBåÓÓÒÂu†6R6ö×ÆWF–öâfW&F–7B&÷VæF'’Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6ö×ÆWF–öâç&W6öÇfVDf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’‡&W6öÇfVDf–æF–æw2’bb¥4ôâç7G&–æv–g’†6ö×ÆWF–öâç&WF–æVE"’ÓÓÒ¥4ôâç7G&–æv–g’‡&WF–æVE"’Âu†6R6ö×ÆWF–öâ&W6öÇfVB÷&WF–æVB6WBÖ—6ÖF6‚r“°¢76W'B†6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6Ræ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6RçG&VRÓÓÒF&vWEG&VRÂu†6R6ö×ÆWF–öâv÷&¶fÆ÷rF&vWBÖ—6ÖF6‚r“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R†6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6RÂu†6R6ö×ÆWF–öâr“°¢6öç7B6ö×ÆWF–öä6öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâ“°¢76W'B†6ö×ÆWF–öä6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG¶6ö×ÆWF–öä6öÖÖ—GÕæÒ’ÓÓÒ§VFvT6öÖÖ—BÂu†6R6ö×ÆWF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†Rf–æÂ§VFvRr“°¢76W'DW†7D6†ævVEF‡2†§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öåÒÂu†6R6ö×ÆWF–öâ6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâÂ6ö×ÆWF–öä6öÖÖ—B“°¢–b‚&W6Væ6RæÆ—fU&VF&6²’&WGW&â²F&vWD6öÖÖ—BÂF&vWEG&VRÂ7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÓ° ¢6öç7B&VF&6²Ò§6öâ†6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6²“°¢76W'DW†7D¶W•6WB‡&VF&6²Â²w66†VÖfW'6–öârÂv'F–f7D–BrÂw&W÷6—F÷'’rÂv'&æ6‚rÂv6†ævT6öçG&öÂrÂw&VF&6µF&vWBrÂv6ö×ÆWF–öârÂwv÷&¶fÆ÷rrÂwfW&F–7BrÂw†6SVç&W6öÇfVBrÂw&W6öÇfVDf–æF–æw2rÂw&WF–æVE"rÂvÖ†–×VÕfW&F–7BuÒÂu†6RÆ—fR&VF&6²r“°¢76W'DW†7D¶W•6WB‡&VF&6²ç&VF&6µF&vWBÂ²v6öÖÖ—BrÂwG&VRuÒÂu†6RÆ—fR&VF&6²F&vWBr“°¢76W'DW†7D¶W•6WB‡&VF&6²æ6ö×ÆWF–öâÂ²wF‚rÂv&Æö"uÒÂu†6RÆ—fR&VF&6²6ö×ÆWF–öâ&–æF–ærr“°¢76W'DW†7D¶W•6WB‡&VF&6²ç†6SVç&W6öÇfVBÂ²urÂuuÒÂu†6RÆ—fR&VF&6²Vç&W6öÇfVBr“°¢76W'B‡&VF&6²ç66†VÖfW'6–öâÓÓÒbb&VF&6²æ'F–f7D–BÓÓÒv6G2×F÷vW"×†6SÖv÷fW&ææ6R×&V6÷fW'’ÖÆ—fR×&VF&6²×&÷VæBÓ"rbb&VF&6²ç&W÷6—F÷'’ÓÓÒ7&—F–2ç&W÷6—F÷'’bb&VF&6²æ'&æ6‚ÓÓÒ7&—F–2æ'&æ6‚bb&VF&6²æ6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âu†6RÆ—fR&VF&6²–FVçF—G’÷"WF†÷&—G’Ö—6ÖF6‚r“°¢76W'B‡&VF&6²ç&VF&6µF&vWBæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb&VF&6²ç&VF&6µF&vWBçG&VRÓÓÒF&vWEG&VRbb&VF&6²æ6ö×ÆWF–öâçF‚ÓÓÒ6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâbb&VF&6²æ6ö×ÆWF–öâæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G¶6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öçÖÒ’Âu†6RÆ—fR&VF&6²F&vWB÷"6ö×ÆWF–öâ&–æF–ærÖ—6ÖF6‚r“°¢76W'B‡&VF&6²çfW&F–7BÓÓÒu$TE•õDõô4Äõ4Uõ„4SôtõdU$ää4Uõ$T4õdU%’rbb&VF&6²æÖ†–×VÕfW&F–7BÓÓÒu$TE•õDõô4Äõ4Uõ„4SôtõdU$ää4Uõ$T4õdU%’rbb&VF&6²ç†6SVç&W6öÇfVBåÓÓÒbb&VF&6²ç†6SVç&W6öÇfVBåÓÓÒÂu†6RÆ—fR&VF&6²fW&F–7B&÷VæF'’Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²ç&W6öÇfVDf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’‡&W6öÇfVDf–æF–æw2’bb¥4ôâç7G&–æv–g’‡&VF&6²ç&WF–æVE"’ÓÓÒ¥4ôâç7G&–æv–g’‡&WF–æVE"’Âu†6RÆ—fR&VF&6²&W6öÇfVB÷&WF–æVB6WBÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²çv÷&¶fÆ÷r’ÓÓÒ¥4ôâç7G&–æv–g’†6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6R’Âu†6RÆ—fR&VF&6²v÷&¶fÆ÷rF–ffW'2g&öÒ6ö×ÆWF–öâWf–FVæ6Rr“°¢&Vv—7FW%v÷&¶fÆ÷tWf–FVæ6R‡&VF&6²çv÷&¶fÆ÷rÂu†6RÆ—fR&VF&6²r“°¢6öç7B&VF&6´6öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6²“°¢76W'B‡&VF&6´6öÖÖ—Bbbv—B…²w&Wb×'6RrÂG·&VF&6´6öÖÖ—GÕæÒ’ÓÓÒ6ö×ÆWF–öä6öÖÖ—BÂu†6RÆ—fR&VF&6²×W7B–ÖÖVF–FVÇ’föÆÆ÷r6ö×ÆWF–öâWf–FVæ6Rr“°¢76W'DW†7D6†ævVEF‡2†6ö×ÆWF–öä6öÖÖ—BÂ&VF&6´6öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6µÒÂu†6RÆ—fR×&VF&6²6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6²Â&VF&6´6öÖÖ—B“°¢&WGW&â²F&vWD6öÖÖ—BÂF&vWEG&VRÂ7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ&VF&6´6öÖÖ—BÓ°§Ð ¦6öç7B†6S&Wf–Wu&Vf—‚ÒfW&–g•†6S&Wf–WtWf–FVæ6U&Vf—‚‚“° ¦–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3æ§6öâr’°¢76W'B†7F—fRç7FGW2ÓÓÒt”åõ$ôu$U52rÂw&÷VæB3×W7B&R–â&öw&W72r“°¢76W'B‡7FGW2æ7W'&VçD–çFW&æÅ†6RÓÓÒu„4SÔtõdU$ää4RÕ$T4õdU%’rÂu†6RÖ—'&÷"Ö—6ÖF6‚r“°¢–b†6Æ÷7W&U&W—$7&—F–46ö×ÆWFR’°¢76W'DW†7E÷7D7&—F–4Fö7VÖVçEG&ç6f÷&×2‚t„TBr“°¢76W'D7W'&VçDFö4&Æö$Ö†W‡V7FVE÷7D7&—F–47W'&VçDFö4&Æö'2Ât„TBrÂw÷7BÖ7&—F–2&÷VæB37W'&VçBFö7VÖVçG2r“°¢Ð¢VÇ6R76W'DW†7E&W—$Fö7VÖVçEG&ç6f÷&×2‚utõ$µE$TRr“°¢76W'D&÷VæF'”†—7F÷'’‡&V÷VâæVçG'’æ†VBÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â&V÷VâÂw&÷VæB36Æ÷7W&RÖ–çFVw&—G’&W—"r“°¢76W'B‚7FW$6÷'&V7F–öâÂw&÷VæB3"×W7Bæ÷BW†—7Bv†–ÆR&÷VæB3—27F—fRr“°¢76W'B‚W†—7G2†6Æ÷7W&UF‚’Âw&÷VæB32×W7Bæ÷BW†—7B&Vf÷&R6÷'&V7FVB†6R6Æ÷7W&Rr“°§ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚’°¢76W'B‡7FW$6÷'&V7F–öâÂv7F—fR&÷VæB3"6†ævRÖ6öçG&öÂÖ—76–ærr“°¢76W'B†6Æ÷7W&U&W—$7&—F–46ö×ÆWFRbbWF†÷&—G’æv÷fW&ææ6U&V6÷fW'’ç†6SÓÓÒbbW‡V7FVE†6SÓÓÒÂw&÷VæB3"6ææ÷B&R7F—fRv†–ÆR†6Rõ&VÖ–ç2r“°¢76W'B†7F—fRç7FGW2ÓÓÒt”åõ$ôu$U52rÂw&÷VæB3"×W7B&VÖ–â–â&öw&W72&Vf÷&R6÷'&V7FVB6Æ÷7W&Rr“°¢76W'B‡7FGW2æ7W'&VçD–çFW&æÅ†6RÓÓÒu5DU"Õ45$TTâÕ$ô¤T5D”ôâÔ4õ%$T5D”ôârÂw&÷VæB3"†6RÖ—'&÷"Ö—6ÖF6‚r“°¢76W'D&÷VæF'”†—7F÷'’‡&V÷VâæVçG'’æ†VBÂ7FW$6÷'&V7F–öâæVçG'’æ†VBÂ&V÷VâÂv6ö×ÆWFVB&÷VæB3&W—"&ævRr“°¢76W'D&÷VæF'”†—7F÷'’‡7FW$6÷'&V7F–öâæVçG'’æ†VBÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â7FW$6÷'&V7F–öâÂw&÷VæB3"7FW"6÷'&V7F–öâ&ævRr“°¢–b‡7FW%&ö¦V7F–öä÷Vâ’°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3$Fö7VÖVçEFW‡BÂw&÷VæB3"÷Vâ7W'&VçBFö7VÖVçG2r“°¢76W'D7W'&VçDFö4&Æö$Ö†W‡V7FVE&÷VæC3$7W'&VçDFö4&Æö'2Ât„TBrÂw&÷VæB3"÷Vâ7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3%74Fö7VÖVçEFW‡BÂw&÷VæB3"52Ö7F—fFVB7W'&VçBFö7VÖVçG2r“°¢Ð¢76W'B‚W†—7G2†6Æ÷7W&UF‚’Âw&÷VæB32×W7Bæ÷BW†—7Bv†–ÆR&÷VæB3"—27F—fRr“°§ÒVÇ6R°¢76W'B‡÷7D6Æ÷7W&T6öçG&öÅF‡2æ–æ6ÇVFW2†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂ’Âw÷7BÕ†6SWF†÷&—G’—2÷WG6–FRF†RW†7B&Wf–WvVB3"7V66W76÷"6†–âr“°¢76W'B‡7FW$6÷'&V7F–öâÂw&÷VæB3"6÷'&V7F–öâ6öçG&öÂÖ—76–ærgFW"6Æ÷7W&Rr“°¢76W'B†W†—7G2†6Æ÷7W&UF‚’Âv6÷'&V7FVB†6R6Æ÷7W&RFFVæGVÒÖ—76–ærr“°¢6öç7B6Æ÷7W&RÒ§6öâ†6Æ÷7W&UF‚“°¢76W'DW†7D¶W•6WB†6Æ÷7W&RÂ°¢w66†VÖfW'6–öârÂv'F–f7D–BrÂv7&VFVDBrÂw&W÷6—F÷'’rÂv'&æ6‚rÂw&VçD6†ævT6öçG&öÂrÂw7FGW2rÀ¢wfW&F–7BrÂw66÷RrÂv6öçFVçBrÂvWf–FVæ6RrÂvWf–FVæ6T&Æö'2rÂv6ö×ÆWF–öå&W7VÇG2rÂwVç&W6öÇfVBrÀ¢w&WGW&ç47W'&VçE&öGV7DWF†÷&—G•FòrÂvæW‡E&öGV7Ev÷&²rÂvÖ”æ÷DFV6Æ&RrÂw7FWE72rÂw7FWTÆÆ÷vVBrÀ¢w&öGV7F–öäÆÆ÷vVBrÂw&öGV7F–öäÆ–46†ævVBrÂw‡—6–6Ä•†öæUfW&–f–VBrÂwW6W%f—7VÄ&÷fÂp¢ÒÂw&÷VæB326Æ÷7W&Rr“°¢76W'DW†7D¶W•6WB†6Æ÷7W&Ræ6öçFVçBÂ²wfW&–f–VEF—6öÖÖ—BrÂwfW&–f–VEF—G&VRrÂvWf–FVæ6T6öÖÖ—BrÂvWf–FVæ6UG&VRrÂw&ö÷DVçG'”6öÖÖ—BrÂw&ö÷DVçG'•G&VRuÒÂw&÷VæB326öçFVçBr“°¢76W'DW†7D¶W•6WB†6Æ÷7W&RæWf–FVæ6RÂ²w7FW$6öçF–çV—G’rÂv7&—F–2rÂvf–æÄ§VFvRrÂv6ö×ÆWF–öârÂvÆ—fU&VF&6²uÒÂw&÷VæB32Wf–FVæ6RF‡2r“°¢76W'DW†7D¶W•6WB†6Æ÷7W&RæWf–FVæ6T&Æö'2Â²w7FW$6öçF–çV—G’rÂv7&—F–2rÂvf–æÄ§VFvRrÂv6ö×ÆWF–öârÂvÆ—fU&VF&6²uÒÂw&÷VæB32Wf–FVæ6R&Æö'2r“°¢76W'DW†7D¶W•6WB†6Æ÷7W&Ræ6ö×ÆWF–öå&W7VÇG2Â°¢w6–ævÆT7W'&VçDWF†÷&—G’rÂv7W'&VçDÖ—'&÷'57–æ6‡&öæ—¦VBrÂw&÷VæC3&W—%fW&–f–VBrÀ¢w7FW%&ö¦V7F–öä6÷'&V7FVBrÂw7FW%c56VÆVBrÂw7FW46öçF–çV—G•fW&–f–VBrÂvçVÖ&W&VDWf–FVæ6T&÷VæBrÀ¢vÆ—fT7F–öç5&÷fVææ6UfW&–f–VDD6Æ÷7W&RrÂw7FW%c$†—7F÷'•&W6W'fVBrÂvÆVv7•'VçF–ÖT×WFFVBrÀ¢w&W6W'fVE3%6öçFVçD×WFFVD'•†6Sp¢ÒÂw&÷VæB326ö×ÆWF–öâ&W7VÇG2r“°¢76W'DW†7D¶W•6WB†6Æ÷7W&RçVç&W6öÇfVBÂ²w†6SrÂw†6SrÂw†6S"rÂvæöä&Æö6¶–æu†6S"rÂw&öGV7ErÂw&öGV7ErÂw&öGV7E—FV×2uÒÂw&÷VæB32Vç&W6öÇfVBr“°¢76W'B†6Æ÷7W&Rç66†VÖfW'6–öâÓÓÒbb6Æ÷7W&Ræ'F–f7D–BÓÓÒv6G2×F÷vW"Ö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ32rbbõã##bÕÆG³'ÒÕÆG³'ÒBòçFW7B†6Æ÷7W&Ræ7&VFVDBóòrr’Âw&÷VæB32–FVçF—G’÷"7&VF–öâFFRÖ—6ÖF6‚r“°¢76W'B†6Æ÷7W&Rç&W÷6—F÷'’ÓÓÒs&†swG'w'bÖFW6–vâö6G5÷F÷vW"rbb6Æ÷7W&Ræ'&æ6‚ÓÓÒv¶–Ö’rbb6Æ÷7W&Rç&VçD6†ævT6öçG&öÂÓÓÒ7FW$6÷'&V7F–öåF‚Âw&÷VæB32&W÷6—F÷'’Â'&æ6‚÷"&VçBÖ—6ÖF6‚r“°¢76W'B†6Æ÷7W&Rç7FGW2ÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%’rbb6Æ÷7W&RçfW&F–7BÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%’rÂw&÷VæB3266÷VB6Æ÷7W&RfW&F–7BÖ—6ÖF6‚r“°¢76W'B†6Æ÷7W&Rç66÷RÓÓÒt6÷'&V7FVB†6Rv÷fW&ææ6R&V6÷fW'’6Æ÷7W&RgFW"F†RfW'6–öæVB7FW"c267&VVâ&ö¦V7F–öâæB7FW26öçF–çV—G’&ööc²æò3"&öGV7BÂ'VçF–ÖRÂV6öæö×’Â6fRÂ&öGV7F–öâ÷"FWf–6R×WFF–öâârÂw&÷VæB3266÷RÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6Æ÷7W&RæWf–FVæ6R’ÓÓÒ¥4ôâç7G&–æv–g’†6Æ÷7W&TWf–FVæ6R’Âw&÷VæB32Wf–FVæ6RF‚6WBÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6Æ÷7W&Ræ6ö×ÆWF–öå&W7VÇG2’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢6–ævÆT7W'&VçDWF†÷&—G“¢G'VRÀ¢7W'&VçDÖ—'&÷'57–æ6‡&öæ—¦VC¢G'VRÀ¢&÷VæC3&W—%fW&–f–VC¢G'VRÀ¢7FW%&ö¦V7F–öä6÷'&V7FVC¢G'VRÀ¢7FW%c56VÆVC¢G'VRÀ¢7FW46öçF–çV—G•fW&–f–VC¢G'VRÀ¢çVÖ&W&VDWf–FVæ6T&÷VæC¢G'VRÀ¢Æ—fT7F–öç5&÷fVææ6UfW&–f–VDD6Æ÷7W&S¢G'VRÀ¢7FW%c$†—7F÷'•&W6W'fVC¢G'VRÀ¢ÆVv7•'VçF–ÖT×WFFVC¢fÇ6RÀ¢&W6W'fVE3%6öçFVçD×WFFVD'•†6S¢fÇ6P¢Ò’Âw&÷VæB326ö×ÆWF–öâ&W7VÇBÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6Æ÷7W&RçVç&W6öÇfVB’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢†6S¢À¢†6S¢À¢†6S#¢"À¢æöä&Æö6¶–æu†6S#¢²u„4SÕ"Õ#‚Õ5DÄRÔÔUDDDrÂu„4SÕ"Ô´”Ô’ÕTå$õDT5DTBÔU…DU$äÂÔTädõ$4TÔTåBuÒÀ¢&öGV7E¢À¢&öGV7E¢À¢&öGV7E—FV×3¢²u3BÕ$T4õdU%’Õd•2ÓuÐ¢Ò’Âw&÷VæB32Vç&W6öÇfVB6WBÖ—6ÖF6‚r“°¢76W'B†6Æ÷7W&Rç&WGW&ç47W'&VçE&öGV7DWF†÷&—G•FòÓÓÒwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ#bæ§6öârÂw&÷VæB32&WGW&âWF†÷&—G’Ö—6ÖF6‚r“°¢76W'B†6Æ÷7W&RææW‡E&öGV7Ev÷&²ÓÓÒtVF—BF†R&W6W'fVB3"Õ'F–f7G2v–ç7BFVÆ—fW&&ÆW2Ô¢æBtÓÔtÓ‚&Vf÷&Rç’FF—F–öæÂ&öGV7BÖ6öçFVçBw&—FRâ&WW6R6öæf÷&Ö–ærÖFW&–ÂæB&W—"öæÇ’FVÖöç7G&FVBv2ârÂw&÷VæB32æW‡B&öGV7Bv÷&²Ö—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†6Æ÷7W&RæÖ”æ÷DFV6Æ&R’ÓÓÒ¥4ôâç7G&–æv–g’…°¢u3"6ö×ÆWFRrÂu7FWB52rÂu7FWRÆÆ÷vVBrÂv6æöæ–6Â'VçF–ÖR–×ÆVÖVçFVBrÀ¢v&6¶VæB–×ÆVÖVçFVBrÂu&öGV7F–öâ&VG’rÂw‡—6–6Â•†öæRfW&–f–VBp¢Ò’Âw&÷VæB32f÷&&–FFVâFV6Æ&F–öâ6WBÖ—6ÖF6‚r“°¢76W'B†6Æ÷7W&Rç7FWE72ÓÓÒfÇ6Rbb6Æ÷7W&Rç7FWTÆÆ÷vVBÓÓÒfÇ6Rbb6Æ÷7W&Rç&öGV7F–öäÆÆ÷vVBÓÓÒfÇ6Rbb6Æ÷7W&Rç&öGV7F–öäÆ–46†ævVBÓÓÒfÇ6Rbb6Æ÷7W&Rç‡—6–6Ä•†öæUfW&–f–VBÓÓÒfÇ6Rbb6Æ÷7W&RçW6W%f—7VÄ&÷fÂÓÓÒfÇ6RÂw&÷VæB32&VÆV6RÂ&÷fÂ÷"FWf–6R&÷VæF'’6†ævVBr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2†6Æ÷7W&T6öÖÖ—BÂW‡V7FVE&÷VæC34Fö7VÖVçEFW‡BÂw&÷VæB326Æ÷7W&RFö7VÖVçG2r“°¢76W'D7W'&VçDFö4&Æö$Ö†W‡V7FVE&÷VæC347W'&VçDFö4&Æö'2Â6Æ÷7W&T6öÖÖ—BÂw&÷VæB326Æ÷7W&RFö7VÖVçG2r“°¢–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖT6öçG&öÅF‚’°¢76W'B‡3$76WEföÇVÖU&öGV7F–öä†æFöfbÂv7F—fR&÷VæBCBÆ6·2—G2W†7B6öçG&7BÖFW&—fVB76WB×föÇVÖR†æFöfbr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂ3$76WEföÇVÖU&öGV7F–öä†æFöfbç&VG”6öÖÖ—BòW‡V7FVE&÷VæCCE&VG”Fö7VÖVçEFW‡B¢W‡V7FVE&÷VæCCDFö7VÖVçEFW‡BÂw&÷VæBCB7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3$76WEföÇVÖU66÷T6öçG&öÅF‚’°¢76W'B‡3$76WEföÇVÖU66÷T†æFöfbÂv7F—fR&÷VæBC2Æ6·2—G2W†7B66÷RÖ6öçG&7B†æFöfbr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæCC4Fö7VÖVçEFW‡BÂw&÷VæBC27W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3$76WE746öçG&öÅF‚’°¢76W'B‡3%&W&W6VçFF—fT76WE72Âv7F—fR&÷VæBC"Æ6·2W†7B&W&W6VçFF—fR55ô54UBWf–FVæ6Rr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæCC$Fö7VÖVçEFW‡BÂw&÷VæBC"7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%F†—&E&Wf—6VE$6öçG&öÅF‚’°¢76W'B‡3%F†—&E&Wf—6VE$&÷fÂÂv7F—fR&÷VæBCÆ6·2W†7B&÷fÂWf–FVæ6Rr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÄ&÷fÄFö7VÖVçEFW‡B†f–ÆRÂ3%F†—&E&Wf—6–öäFö7VÖVçD6öæf–r’Âw&÷VæBC7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%F†—&E&Wf—6–öä6öçG&öÅF‚’°¢76W'B‡3%F†—&E&Wf—6–öä†æFöfbÂv7F—fR&÷VæBCÆ6·2W†7B&Wf—6–öâWf–FVæ6Rr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÅ&Wf—6–öäFö7VÖVçEFW‡B†f–ÆRÂ3%F†—&E&Wf—6–öäFö7VÖVçD6öæf–rÂWF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urr’Âw&÷VæBC7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%6V6öæE&Wf—6VE$6öçG&öÅF‚’°¢76W'B‡3%6V6öæE&Wf—6VE$&÷fÂÂv7F—fR&÷VæB3’Æ6·2W†7B&÷fÂWf–FVæ6Rr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÄ&÷fÄFö7VÖVçEFW‡B†f–ÆRÂ3%6V6öæE&Wf—6–öäFö7VÖVçD6öæf–r’Âw&÷VæB3’7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%6V6öæE&Wf—6–öä6öçG&öÅF‚’°¢76W'B‡3%6V6öæE&Wf—6–öä†æFöfbÂv7F—fR&÷VæB3‚Æ6·2W†7B&Wf—6–öâWf–FVæ6Rr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂf–ÆRÓâW‡V7FVDFF—F–öæÅ&Wf—6–öäFö7VÖVçEFW‡B†f–ÆRÂ3%6V6öæE&Wf—6–öäFö7VÖVçD6öæf–rÂWF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urr’Âw&÷VæB3‚7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&W—$6öçG&öÅF‚’°¢76W'B‡3%&W—$6öçG&öÂÂv7F—fR&÷VæB3B6öçG&öÂÖ—76–ærr“°¢–b†WF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õõd•5TÅõ$U•"r’°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3E&W—$Fö7VÖVçEFW‡BÂw&÷VæB3B&W—"7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urr’°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3E&VG”Fö7VÖVçEFW‡BÂw&÷VæB3B&VG’7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R°¢76W'B†fÇ6RÂw&÷VæB3B7W'&VçB7FGW2—2æ÷BâÆÆ÷vVB3"Õ7FFRr“°¢Ð¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%$6öçG&öÅF‚’°¢76W'B‡3%$6öçG&öÂbb3%W6W$FV6—6–öäÆö6²Âv7F—fR&÷VæB3RÆ6·2—G2W‡Æ–6—BFV6—6–öâÆö6²r“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3TFö7VÖVçEFW‡BÂw&÷VæB3R&÷fVBÕ"7W'&VçBFö7VÖVçG2r“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&Wf—6–öä6öçG&öÅF‚’°¢76W'B‡3%&Wf—6–öä6öçG&öÂbb3%&Wf—6–öäFV6—6–öäÆö6²bb3%&Wf—6–öä†æFöfbÂv7F—fR&÷VæB3bÆ6·2—G2W†7BW6W"×&Wf—6–öâÆö6²æB†æFöfbr“°¢–b†WF†÷&—G’ç7FGW2ÓÓÒt”åõ$ôu$U55õ3%õõU4U%õ$Ud•4”ôâr’76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3e&Wf—6–öäFö7VÖVçEFW‡BÂw&÷VæB3b&Wf—6–öâ7W'&VçBFö7VÖVçG2r“°¢VÇ6R–b†WF†÷&—G’ç7FGW2ÓÓÒu$TE•ôdõ%õU4U%õd•5TÅõ$Ud”Urr’76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3e&VG”Fö7VÖVçEFW‡BÂw&÷VæB3b&Wf—6VB×&VG’7W'&VçBFö7VÖVçG2r“°¢VÇ6R76W'B†fÇ6RÂw&÷VæB3b7W'&VçB7FGW2—2æ÷BâÆÆ÷vVB3"Õ&Wf—6–öâ7FFRr“°¢ÒVÇ6R–b†WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÓÓÒ3%&Wf—6VE$6öçG&öÅF‚’°¢76W'B‡3%&Wf—6VE$6öçG&öÂbb3%&Wf—6VD&÷fÄÆö6²bb3%&Wf—6VE$&÷fÂÂv7F—fR&÷VæB3rÆ6·2—G2W†7B&Wf—6VB×F&vWB&÷fÂÆö6²æB†æFöfbr“°¢76W'DW†7E†6TFö7VÖVçEG&ç6f÷&×2‚t„TBrÂW‡V7FVE&÷VæC3tFö7VÖVçEFW‡BÂw&÷VæB3r&÷fVB&Wf—6VB×F&vWB7W'&VçBFö7VÖVçG2r“°¢Ð¢76W'B†6Æ÷7W&Rç7FGW2ÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%’rÂw&÷VæB32×W7B6Æ÷6R6÷'&V7FVB†6Rr“°¢76W'B†WF†÷&—G’æv÷fW&ææ6U&V6÷fW'“òæ6Æ÷7W&RÓÓÒ6Æ÷7W&UF‚ÂvWF†÷&—G’×W7B&–æB†6R6Æ÷7W&Rr“°¢76W'B†F—7F6†W"æv÷fW&ææ6U&V6÷fW'”6Æ÷7W&RÓÓÒ6Æ÷7W&UF‚ÂvF—7F6†W"×W7B&–æB†6R6Æ÷7W&Rr“°¢76W'B…²u3"ÕÔtôÄDTâÔÔ5DU"rÂu3"Õ"Ô54UBÕ$ôET5D”ôâuÒæ–æ6ÇVFW2‡7FGW2æ7W'&VçD–çFW&æÅ†6R’Âw÷7BÕ†6S†6RÖ—6ÖF6‚r“°¢76W'B†WF†÷&—G’æW†V7WF&ÆT6öçG&7Bç7FW%7FGW2ÓÓÒu55ô4ôåE$5BrÂw&÷VæB32Ö’æ÷B6Æ÷6Rv†–ÆR7FW"&VÖ–ç2÷Vâr“°¢76W'B†WF†÷&—G’æW†V7WF&ÆT6öçG&7Bç6VÂÓÓÒc56VÅF‚Âv7W'&VçB7FW"6VÂ×W7B&Rc2gFW"6÷'&V7F–öâr“°¢76W'B‡fW&–f–VEc56VÂÂv6÷'&V7FVBc27FW"6öçG&7Bv2æ÷BfW&–f–VBr“°¢6öç7Bc56VÂÒfW&–f–VEc56VÃ°¢f÷"†6öç7Böbö&¦V7BçfÇVW2†6Æ÷7W&TWf–FVæ6R’’76W'B†W†—7G2‡’Â†6R6Æ÷7W&RWf–FVæ6RÖ—76–æs¢G·Ö“°¢f÷"†6öç7B¶¶W’ÂÒöbö&¦V7BæVçG&–W2†6Æ÷7W&TWf–FVæ6R’’76W'B†6Æ÷7W&RæWf–FVæ6Sòå¶¶W•ÒÓÓÒÂ&÷VæB32FöW2æ÷BW†7FÇ’&–æBçVÖ&W&VBG¶¶W—ÒWf–FVæ6V“°¢6öç7B6öçF–çV—G’Ò§6öâ†6Æ÷7W&TWf–FVæ6Rç7FW$6öçF–çV—G’“°¢fW&–g”6öçF–çV—G”6Æ–×2†6öçF–çV—G’Âc56VÂ“°¢6öç7B7&—F–2Ò§6öâ†6Æ÷7W&TWf–FVæ6Ræ7&—F–2“°¢6öç7B§VFvRÒ§6öâ†6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvR“°¢6öç7B6ö×ÆWF–öâÒ§6öâ†6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâ“°¢6öç7B&VF&6²Ò§6öâ†6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6²“°¢76W'B†7&—F–2çfW&F–7BÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%•ô”äDUTäDTåEô5$•D”2rÂu†6R–æFWVæFVçB7&—F–2F–Bæ÷B72r“°¢76W'D7&—F–6Äf–æF–æt6÷VçG2†7&—F–2Âu†6R–æFWVæFVçB7&—F–2r“°¢6öç7BW‡V7FVE†6S6÷fW&vRÒ°¢u$õTäC3õ$U•%õD$tUEô”åDTu$•E’rÀ¢u$õTäC3%ôU„5Eõu$•DUô$õTäD%’rÀ¢u5DU%õc5õ4TÅôäEô4ôåD”åT•E’rÀ¢täôåõ5DU%ôUD„õ$•E•ôe$TU¤RrÀ¢tUd”DTä4Uô4„”åô”ÔÕUD$”Ä•E’rÀ¢u$ôET5D”ôåõ%TåD”ÔUôDUd”4Uô$õTäD$”U2p¢Ó°¢6öç7BW‡V7FVE†6Sf–æF–æw2Ò°¢²–C¢u„4SÕõ5BÔ4Äõ5U$RÔ$õTäD%’ÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÔ44UDä4RÔ4Äõ5U$RÔ”BÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÕ$TÔEU$RÔUd”DTä4RÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÔ”ÔÕUD$ÄRÔUd”DTä4RÔõdU%u$•DRÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u3"ÕÕ45$TTâÕ$ô¤T5D”ôâÓrÂ6WfW&—G“¢urÂ&W6öÇfVC¢G'VRÒÀ¢²–C¢u„4SÕ"Õ#‚Õ5DÄRÔÔUDDDrÂ6WfW&—G“¢u"rÂ&W6öÇfVC¢fÇ6RÒÀ¢²–C¢u„4SÕ"Ô´”Ô’ÕTå$õDT5DTBÔU…DU$äÂÔTädõ$4TÔTåBrÂ6WfW&—G“¢u"rÂ&W6öÇfVC¢fÇ6RÐ¢Ó°¢76W'B„¥4ôâç7G&–æv–g’†7&—F–2æ6÷fW&vR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6S6÷fW&vR’bb¥4ôâç7G&–æv–g’†7&—F–2æf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6Sf–æF–æw2’bb7&—F–2çVç&W6öÇfVBå"ÓÓÒ"Âu†6R7&—F–26÷fW&vRöf–æF–ær&÷w2F–ffW"g&öÒF†RW†7B&W6öÇfVBæB&WF–æVB6WBr“°¢76W'B†§VFvRæ7&—F–3òçF‚ÓÓÒ6Æ÷7W&TWf–FVæ6Ræ7&—F–2bb§VFvRæ7&—F–3òæ&Æö"ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G¶6Æ÷7W&TWf–FVæ6Ræ7&—F–7ÖÒ’Âu†6R§VFvRFöW2æ÷B&–æBçVÖ&W&VB7&—F–2r“°¢76W'B†§VFvRçfW&F–7BÓÓÒu55õ„4SôtõdU$ää4Uõ$T4õdU%’rÂu†6R§VFvRF–Bæ÷B72r“°¢76W'D7&—F–6Äf–æF–æt6÷VçG2†§VFvRÂu†6Rf–æÂ§VFvRr“°¢76W'B„¥4ôâç7G&–æv–g’†§VFvRæ6÷fW&vR’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6S6÷fW&vR’bb¥4ôâç7G&–æv–g’†§VFvRæf–æF–æw2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6Sf–æF–æw2’bb§VFvRçVç&W6öÇfVBå"ÓÓÒ"Âu†6Rf–æÂ§VFvR6÷fW&vRöf–æF–ær&÷w2F–ffW"g&öÒF†R–æFWVæFVçB7&—F–2r“°¢76W'B†6ö×ÆWF–öâçfW&F–7BÓÓÒu$TE•ôdõ%õ„4SôÄ•dUõ$TD$4²rÂu†6R6ö×ÆWF–öâWf–FVæ6RF–Bæ÷BWF†÷&—¦RÆ—fR&VF&6²r“°¢76W'B†6ö×ÆWF–öâç†6SVç&W6öÇfVBåÓÓÒbb6ö×ÆWF–öâç†6SVç&W6öÇfVBåÓÓÒÂu†6R6ö×ÆWF–öâõ×W7B&R¦W&òr“°¢76W'B„¥4ôâç7G&–æv–g’†6ö×ÆWF–öâç&WF–æVE"’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVE†6Sf–æF–æw2æf–ÇFW"†VçG'’ÓâVçG'’ç6WfW&—G’ÓÓÒu"r’æÖ†VçG'’ÓâVçG'’æ–B’’Âu†6R6ö×ÆWF–öâFöW2æ÷B&WF–âF†RW†7B"6WBr“°¢76W'B‡&VF&6²çfW&F–7BÓÓÒu$TE•õDõô4Äõ4Uõ„4SôtõdU$ää4Uõ$T4õdU%’rÂu†6RÆ—fR&VF&6²F–Bæ÷BWF†÷&—¦R6Æ÷7W&Rr“°¢76W'B‡&VF&6²ç†6SVç&W6öÇfVBåÓÓÒbb&VF&6²ç†6SVç&W6öÇfVBåÓÓÒÂu†6R&VF&6²õ×W7B&R¦W&òr“°¢76W'B„¥4ôâç7G&–æv–g’‡&VF&6²ç&WF–æVE"’ÓÓÒ¥4ôâç7G&–æv–g’†6ö×ÆWF–öâç&WF–æVE"’Âu†6RÆ—fR&VF&6²&WF–æVBÕ"6WBÖ—6ÖF6‚r“°¢6öç7B7&—F–46öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6Ræ7&—F–2“°¢6öç7B§VFvT6öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvR“°¢6öç7B6ö×ÆWF–öä6öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâ“°¢6öç7B&VF&6´6öÖÖ—BÒf—'7DFD6öÖÖ—B†6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6²“°¢6öç7B&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—BÒ&W6öÇfU7FW%&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—B‚“°¢6öç7B6Æ÷7W&U&VçBÒ&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—Bóò&VF&6´6öÖÖ—C°¢76W'B†6Æ÷7W&T6öÖÖ—BÂv6ææ÷B&W6öÇfR†6R6Æ÷7W&R6öÖÖ—Br“°¢76W'B†7&—F–46öÖÖ—Bbb§VFvT6öÖÖ—Bbb6ö×ÆWF–öä6öÖÖ—Bbb&VF&6´6öÖÖ—BÂv6ææ÷B&W6öÇfRçVÖ&W&VB†6RWf–FVæ6R6öÖÖ—G2r“°¢76W'B†æWr6WB…¶7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ&VF&6´6öÖÖ—BÂ6Æ÷7W&T6öÖÖ—EÒ’ç6—¦RÓÓÒRÂv7&—F–2Â§VFvRÂ6ö×ÆWF–öâÂ&VF&6²æB6Æ÷7W&R×W7B&RF—7F–æ7B6öÖÖ—G2r“°¢76W'B†v—B…²w&Wb×'6RrÂG¶7&—F–46öÖÖ—GÕæÒ’ÓÓÒ7&—F–2æVF—EF&vWBæ6öÖÖ—BÂu†6R7&—F–2×W7B–ÖÖVF–FVÇ’föÆÆ÷r—G2W†7BVF—FVBF&vWBr“°¢76W'B†v—B…²w&Wb×'6RrÂG¶§VFvT6öÖÖ—GÕæÒ’ÓÓÒ7&—F–46öÖÖ—BÂu†6R§VFvR×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R–æFWVæFVçB7&—F–2r“°¢76W'B†v—B…²w&Wb×'6RrÂG¶6ö×ÆWF–öä6öÖÖ—GÕæÒ’ÓÓÒ§VFvT6öÖÖ—BÂu†6R6ö×ÆWF–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†Rf–æÂ§VFvRr“°¢76W'B†v—B…²w&Wb×'6RrÂG·&VF&6´6öÖÖ—GÕæÒ’ÓÓÒ6ö×ÆWF–öä6öÖÖ—BÂu†6RÆ—fR&VF&6²×W7B–ÖÖVF–FVÇ’föÆÆ÷r6ö×ÆWF–öâWf–FVæ6Rr“°¢–b‡&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—B’°¢76W'B†v—B…²w&Wb×'6RrÂG·&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—GÕæÒ’ÓÓÒ&VF&6´6öÖÖ—BÂw&RÖ6Æ÷7W&RfW&–f–W"6÷'&V7F–öâ×W7B–ÖÖVF–FVÇ’föÆÆ÷rÆ—fR&VF&6²r“°¢76W'DW†7D6†ævVEF‡2‡&VF&6´6öÖÖ—BÂ&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—BÂ²wFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2uÒÂw&RÖ6Æ÷7W&RfW&–f–W"6÷'&V7F–öâ6öÖÖ—Br“°¢Ð¢76W'B†v—B…²w&Wb×'6RrÂG¶6Æ÷7W&T6öÖÖ—GÕæÒ’ÓÓÒ6Æ÷7W&U&VçBÂw&÷VæB326Æ÷7W&R×W7B–ÖÖVF–FVÇ’föÆÆ÷rF†R&Wf–WvVBÆ—fR×&VF&6²&÷VæF'’r“°¢76W'DW†7D6†ævVEF‡2†7&—F–2æVF—EF&vWBæ6öÖÖ—BÂ7&—F–46öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6Ræ7&—F–5ÒÂu†6R7&—F–26öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2†7&—F–46öÖÖ—BÂ§VFvT6öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6Ræf–æÄ§VFvUÒÂu†6Rf–æÂÖ§VFvR6öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2†§VFvT6öÖÖ—BÂ6ö×ÆWF–öä6öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öåÒÂu†6R6ö×ÆWF–öâ6öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2†6ö×ÆWF–öä6öÖÖ—BÂ&VF&6´6öÖÖ—BÂ¶6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6µÒÂu†6RÆ—fR×&VF&6²6öÖÖ—Br“°¢76W'DW†7D6†ævVEF‡2†6Æ÷7W&U&VçBÂ6Æ÷7W&T6öÖÖ—BÂW‡V7FVD6Æ÷7W&T6öÖÖ—Ew&—FW2Âw&÷VæB326Æ÷7W&R6öÖÖ—Br“°¢76W'DFFVDöæ6TæEVæ6†ævVB†6Æ÷7W&UF‚Â6Æ÷7W&T6öÖÖ—B“°¢f÷"†6öç7B¶¶W’Âf–ÆUÒöbö&¦V7BæVçG&–W2†6Æ÷7W&TWf–FVæ6R’’°¢6öç7BFD6öÖÖ—BÒf—'7DFD6öÖÖ—B†f–ÆR“°¢6öç7B7W'&VçD&Æö"Ò76W'DFFVDöæ6TæEVæ6†ævVB†f–ÆRÂFD6öÖÖ—B“°¢76W'B†6Æ÷7W&RæWf–FVæ6T&Æö'3òå¶¶W•ÒÓÓÒ7W'&VçD&Æö"Â&÷VæB32FöW2æ÷B&–æB–Ö×WF&ÆRG¶¶W—ÒWf–FVæ6R&Æö&“°¢Ð¢6öç7BF&vWD6öÖÖ—BÒ7&—F–2æVF—EF&vWCòæ6öÖÖ—C°¢6öç7BF&vWEG&VRÒ7&—F–2æVF—EF&vWCòçG&VS°¢76W'B‡F&vWD6öÖÖ—BbbF&vWEG&VRÓÓÒv—B…²w&Wb×'6RrÂG·F&vWD6öÖÖ—GÕç·G&VWÖÒ’Âv7&—F–2F&vWB6öÖÖ—B÷G&VR&–æF–ær—2–çfÆ–Br“°¢6öç7BF&vWEöÆ–7’Ò§6öäB‡F&vWD6öÖÖ—BÂt•õ$ô¤T5EõôÄ”5’æ§6öâr“°¢f÷"†6öç7B¶W’öb²w&W÷6—F÷'’rÂw66÷VE75fö6'VÆ'’rÂvf÷&&–FFVåVç66÷VEfW&F–7BrÂv6ö×ÆWF–öä–ç7Vff–6–VçDÆöæRrÂvÆ÷u&Wv÷&µ'VÆW2rÂwfW&–f–6F–öåöÆ–7’rÂvÆVv7’rÂw&W÷'F–æu&WV—&VBuÒ’°¢76W'B„¥4ôâç7G&–æv–g’‡öÆ–7•¶¶W•Ò’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWEöÆ–7•¶¶W•Ò’Â÷7B×F&vWB’öÆ–7’6V7W&—G’6V7F–öâ6†ævVC¢G¶¶W—Ö“°¢Ð¢6öç7B²7F—fT6†ævT6öçG&öÃ¢–væ÷&VEF&vWD6öçG&öÂÂv÷fW&ææ6U&V6÷fW'”6Æ÷7W&S¢–væ÷&VEF&vWD6Æ÷7W&RÂââçF&vWEöÆ–7”WF†÷&—G’ÒÒF&vWEöÆ–7’æWF†÷&—G“°¢6öç7B²7F—fT6†ævT6öçG&öÃ¢–væ÷&VD7W'&VçD6öçG&öÂÂv÷fW&ææ6U&V6÷fW'”6Æ÷7W&S¢–væ÷&VD7W'&VçD6Æ÷7W&RÂââæ7W'&VçEöÆ–7”WF†÷&—G’ÒÒöÆ–7’æWF†÷&—G“°¢76W'B„¥4ôâç7G&–æv–g’†7W'&VçEöÆ–7”WF†÷&—G’’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWEöÆ–7”WF†÷&—G’’Âw÷7B×F&vWB’öÆ–7’WF†÷&—G’Æ–æVvR6†ævVB÷WG6–FR7F—fR6öçG&öÂr“°¢76W'B„¥4ôâç7G&–æv–g’‡öÆ–7’æ7W'&VçEw&—FT&÷VæF'“òæf÷&&–FFVâ’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWEöÆ–7’æ7W'&VçEw&—FT&÷VæF'“òæf÷&&–FFVâ’Âw÷7B×F&vWB’öÆ–7’f÷&&–FFVâ&÷VæF'’6†ævVBr“°¢6öç7BF&vWDF—7F6†W"Ò§6öäB‡F&vWD6öÖÖ—BÂwVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂæ§6öâr“°¢f÷"†6öç7B¶W’öb²w&W÷6—F÷'’rÂv'&æ6‚rÂw7WW'6VFVDv÷fW&ææ6U&V6÷fW'”6Æ÷7W&RrÂw7FW%67&VVå&ö¦V7F–öä6÷'&V7F–öârÂwÆææVDv÷fW&ææ6U&V6÷fW'”6Æ÷7W&RrÂv6æöæ–6Å6VÇ2rÂw7FW$W†V7WF&ÆT6öçG&7BrÂw66÷UG'WF‚rÂvÆ–æVvRrÂw'VÆRuÒ’°¢76W'B„¥4ôâç7G&–æv–g’†F—7F6†W%¶¶W•Ò’ÓÓÒ¥4ôâç7G&–æv–g’‡F&vWDF—7F6†W%¶¶W•Ò’Â÷7B×F&vWBF—7F6†W"öÆ–7’6†ævVC¢G¶¶W—Ö“°¢Ð¢f÷"†6öç7Bf–ÆRöb²ttTåE2æÖBrÂu$TDÔRæÖBuÒ’°¢6öç7B6Æ÷7W&UFW‡BÒFW‡DB†6Æ÷7W&T6öÖÖ—BÂf–ÆR“°¢76W'E6–ævÆTWF†÷&—G•6æ6†÷B†6Æ÷7W&UFW‡BÂ&÷VæC356æ6†÷BÂG¶f–ÆWÒB&÷VæB326Æ÷7W&V“°¢76W'B‚6Æ÷7W&UFW‡Bæ–æ6ÇVFW2‡&÷VæC3%6æ6†÷B’Â&÷VæB32ÆVgBF†R&÷VæB3"7W'&VçBÖWF†÷&—G’6æ6†÷B–âG¶f–ÆWÖ“°¢Ð¢76W'B‡F&vWD6öÖÖ—BÓÒ7FW$6÷'&V7F–öâæVçG'’æ†VBbb—4æ6W7F÷"‡7FW$6÷'&V7F–öâæVçG'’æ†VBÂF&vWD6öÖÖ—B’Âv7&—F–2F&vWB×W7B&R6÷'&V7FVB&÷VæB3"FW66VæFçBÂæ÷B—G2VçG'’r“°¢76W'B‡F&vWD6öÖÖ—BÓÒ7&—F–46öÖÖ—BÂv–æFWVæFVçB7&—F–2×W7B&R6öÖÖ—GFVBgFW"—G2VF—FVBF&vWBr“°¢6öç7Bc56VÄ6öÖÖ—BÒf—'7DFD6öÖÖ—B‚w6–×VÆF–öâöW†V7WF&ÆR×6VÂ×c2æ§6öâr“°¢76W'B‡c56VÄ6öÖÖ—Bbb—4æ6W7F÷"‡c56VÄ6öÖÖ—BÂF&vWD6öÖÖ—B’Âv7&—F–2F&vWBFöW2æ÷B6öçF–âF†Rc26÷'&V7F–öâ6VÂr“°¢6öç7B6öçF–çV—G”6öÖÖ—BÒf—'7DFD6öÖÖ—B‡7FW$6öçF–çV—G•F‚“°¢76W'B†6öçF–çV—G”6öÖÖ—Bbb—4æ6W7F÷"†6öçF–çV—G”6öÖÖ—BÂF&vWD6öÖÖ—B’Âv7&—F–2F&vWBFöW2æ÷B6öçF–âF†R7FW26öçF–çV—G’Wf–FVæ6Rr“°¢76W'B†v—B…²w&Wb×'6RrÂG·F&vWD6öÖÖ—GÓ¢G·7FW$6öçF–çV—G•F‡ÖÒ’ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·7FW$6öçF–çV—G•F‡ÖÒ’Âu7FW26öçF–çV—G’Wf–FVæ6R6†ævVBgFW"F†R7&—F–2F&vWBr“°¢76W'B†—4æ6W7F÷"‡F&vWD6öÖÖ—BÂ7&—F–46öÖÖ—B’Âv7&—F–2Wf–FVæ6R×W7BföÆÆ÷r—G2F&vWB6öÖÖ—Br“°¢76W'B†§VFvRçF&vWCòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb§VFvRçF&vWCòçG&VRÓÓÒF&vWEG&VRÂv§VFvRF&vWBF–ffW'2g&öÒ7&—F–2F&vWBr“°¢76W'B†6ö×ÆWF–öâçfW&–f–VD6öçFVçCòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb6ö×ÆWF–öâçfW&–f–VD6öçFVçCòçG&VRÓÓÒF&vWEG&VRÂv6ö×ÆWF–öâF&vWBF–ffW'2g&öÒ7&—F–2F&vWBr“°¢76W'B‡&VF&6²ç&VF&6µF&vWCòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb&VF&6²ç&VF&6µF&vWCòçG&VRÓÓÒF&vWEG&VRÂw&VF&6²F&vWBF–ffW'2g&öÒ7&—F–2F&vWBr“°¢6öç7BWf–FVæ6U&VçBÒ&VF&6´6öÖÖ—C°¢76W'B†6Æ÷7W&Ræ6öçFVçCòçfW&–f–VEF—6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbb6Æ÷7W&Ræ6öçFVçCòçfW&–f–VEF—G&VRÓÓÒF&vWEG&VRÂw&÷VæB32F&vWBF–ffW'2g&öÒçVÖ&W&VBWf–FVæ6Rr“°¢76W'B†6Æ÷7W&Ræ6öçFVçCòæWf–FVæ6T6öÖÖ—BÓÓÒWf–FVæ6U&VçBbb6Æ÷7W&Ræ6öçFVçCòæWf–FVæ6UG&VRÓÓÒv—B…²w&Wb×'6RrÂG¶Wf–FVæ6U&VçGÕç·G&VWÖÒ’Âw&÷VæB32FöW2æ÷B&–æB—G2Wf–FVæ6R&VçB6öÖÖ—B÷G&VRr“°¢76W'B†6Æ÷7W&Ræ6öçFVçCòç&ö÷DVçG'”6öÖÖ—BÓÓÒ&ö÷D6öçG&öÂæVçG'’æ†VBbb6Æ÷7W&Ræ6öçFVçCòç&ö÷DVçG'•G&VRÓÓÒ&ö÷D6öçG&öÂæVçG'’çG&VRbb6Æ÷7W&Ræ6öçFVçBç&ö÷DVçG'•G&VRÓÓÒv—B…²w&Wb×'6RrÂG¶6Æ÷7W&Ræ6öçFVçBç&ö÷DVçG'”6öÖÖ—GÕç·G&VWÖÒ’Âw&÷VæB32†6R&ö÷BVçG'’6öÖÖ—B÷G&VRÖ—6ÖF6‚r“°¢76W'B„¥4ôâç7G&–æv–g’†WF†÷&—G’æv÷fW&ææ6U&V6÷fW'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FGW3¢u55õ„4SôtõdU$ää4Uõ$T4õdU%’rÀ¢7WW'6VFVD6Æ÷7W&TGFV×C¢wVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3æ§6öârÀ¢7FW$6÷'&V7F–öã¢7FW$6÷'&V7F–öåF‚À¢ÆææVD6÷'&V7FVD6Æ÷7W&S¢6Æ÷7W&UF‚À¢6öçFVçD6öÖÖ—C¢F&vWD6öÖÖ—BÀ¢6öçFVçEG&VS¢F&vWEG&VRÀ¢Wf–FVæ6T6öÖÖ—C¢Wf–FVæ6U&VçBÀ¢Wf–FVæ6UG&VS¢v—B…²w&Wb×'6RrÂG¶Wf–FVæ6U&VçGÕç·G&VWÖÒ’À¢v÷&¶fÆ÷u'Vã¢6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6Rç'Vä–BÀ¢v÷&¶fÆ÷t¦ö#¢6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6Ræ¦ö$–BÀ¢'F–f7D–C¢6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6Ræ'F–f7D–BÀ¢†6S¢À¢†6S¢À¢†6S#¢"À¢6Æ÷7W&S¢6Æ÷7W&UF€¢Ò’Âw÷7BÖ6Æ÷7W&RWF†÷&—G’v÷fW&ææ6U&V6÷fW'’F–ffW'2g&öÒF†RW†7BWf–FVæ6RÖFW&—fVB7FFRr“°¢76W'B„¥4ôâç7G&–æv–g’‡7FGW2æv÷fW&ææ6U&V6÷fW'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FGW3¢u55õ„4SôtõdU$ää4Uõ$T4õdU%’rÀ¢7WW'6VFVD6Æ÷7W&TGFV×C¢wVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3æ§6öârÀ¢7FW$6÷'&V7F–öã¢7FW$6÷'&V7F–öåF‚À¢ÆææVD6÷'&V7FVD6Æ÷7W&S¢6Æ÷7W&UF‚À¢†6S¢À¢†6S¢À¢†6S#¢"À¢6Æ÷7W&S¢6Æ÷7W&UF€¢Ò’Âw÷7BÖ6Æ÷7W&R$ô¤T5Eõ5DEU2v÷fW&ææ6U&V6÷fW'’F–ffW'2g&öÒF†RW†7B7FFRr“°¢76W'B„¥4ôâç7G&–æv–g’‡6–Òæv÷fW&ææ6U&V6÷fW'’’ÓÓÒ¥4ôâç7G&–æv–g’‡°¢7FGW3¢u55õ„4SôtõdU$ää4Uõ$T4õdU%’rÀ¢7WW'6VFVD6Æ÷7W&TGFV×C¢wVÆ—G’×&Wf–Ww2÷7FWÓÖ6æöæ–6ÂÖFW6–vâö7F—fRÖ6†ævRÖ6öçG&öÂÖFFVæGVÒ×&÷VæBÓ3æ§6öârÀ¢7FW$6÷'&V7F–öã¢7FW$6÷'&V7F–öåF‚À¢ÆææVD6÷'&V7FVD6Æ÷7W&S¢6Æ÷7W&UF‚À¢6Æ÷7W&S¢6Æ÷7W&UF€¢Ò’Âw÷7BÖ6Æ÷7W&R6–×VÆF–öâv÷fW&ææ6U&V6÷fW'’F–ffW'2g&öÒF†RW†7B7FFRr“°¢f÷"†6öç7Bv÷&¶fÆ÷röb¶6ö×ÆWF–öâçv÷&¶fÆ÷tWf–FVæ6RÂ&VF&6²çv÷&¶fÆ÷uÒ’°¢76W'B‡v÷&¶fÆ÷sòæ6öÖÖ—BÓÓÒF&vWD6öÖÖ—Bbbv÷&¶fÆ÷sòçG&VRÓÓÒF&vWEG&VRÂwv÷&¶fÆ÷rWf–FVæ6RF&vWBF–ffW'2g&öÒ6÷'&V7FVB6öçFVçBr“°¢76W'B‡v÷&¶fÆ÷sòæ6öæ6ÇW6–öâÓÓÒu5T44U52rÂwv÷&¶fÆ÷rWf–FVæ6R—2æ÷B7V66W76gVÂr“°¢76W'B„çVÖ&W"æ—4–çFVvW"‡v÷&¶fÆ÷sòç'Vä–B’bbv÷&¶fÆ÷rç'Vä–BâbbçVÖ&W"æ—4–çFVvW"‡v÷&¶fÆ÷sòæ¦ö$–B’bbv÷&¶fÆ÷ræ¦ö$–BâÂwv÷&¶fÆ÷r'Vâö¦ö"&–æF–ærÖ—76–ærr“°¢76W'B„çVÖ&W"æ—4–çFVvW"‡v÷&¶fÆ÷sòæ'F–f7D–B’bbv÷&¶fÆ÷ræ'F–f7D–Bâbbõç6†#Sc¥¶ÖcÓ•×³cGÒBòçFW7B‡v÷&¶fÆ÷sòæ'F–f7DF–vW7Bóòrr’Âwv÷&¶fÆ÷r'F–f7B&–æF–ærÖ—76–ærr“°¢76W'B‡v÷&¶fÆ÷ræ'F–f7DæÖRÓÓÒ†6SÖ7W'&VçBÖv÷fW&ææ6RÒG·F&vWD6öÖÖ—GÒÒG·v÷&¶fÆ÷rç'Vä–GÒÒG·v÷&¶fÆ÷rç'VäGFV×GÖÂwv÷&¶fÆ÷r'F–f7BæÖRFöW2æ÷B&–æB6÷'&V7FVB6öçFVçBF&vWB÷'VâöGFV×Br“°¢Ð¢76W'B„'&’æ—4'&’‡7FW$6÷'&V7F–öâæWf–FVæ6TöæÇ•w&—FW2’bb7FW$6÷'&V7F–öâæWf–FVæ6TöæÇ•w&—FW2æÆVæwF‚âÂw&÷VæB3"Wf–FVæ6RÖöæÇ’&÷VæF'’Ö—76–ærr“°¢76W'B„¥4ôâç7G&–æv–g’‡7FW$6÷'&V7F–öâæWf–FVæ6TöæÇ•w&—FW2’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDWf–FVæ6TöæÇ•w&—FW2’Âw&÷VæB3"Wf–FVæ6RÖöæÇ’ÆÆ÷vÆ—7B—2æ÷BF†RW†7B&Wf–WvVB6WBr“°¢6öç7B÷7EF&vWD–Ö×WF&ÆUF‡2Ò°¢7FW$6öçF–çV—G•F‚À¢c56VÅF‚À¢ââç&WV—&VEc4&–æF–æuF‡2À¢7FW$6÷'&V7F–öåF‚À¢wFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2rÀ¢ræv—F‡V"÷v÷&¶fÆ÷w2÷fW&–g’Ö7W'&VçBÖv÷fW&ææ6Rç–ÖÂp¢Ó°¢f÷"†6öç7B–Ö×WF&ÆUF‚öbæWr6WB‡÷7EF&vWD–Ö×WF&ÆUF‡2’’°¢76W'B‚7FW$6÷'&V7F–öâæWf–FVæ6TöæÇ•w&—FW2ç6öÖR‡GFW&âÓâvÆö$ÖF6‚‡GFW&âÂ–Ö×WF&ÆUF‚’’Â÷7B×F&vWBWf–FVæ6RÆÆ÷vÆ—7B6÷fW'2–Ö×WF&ÆR6öçFVçC¢G¶–Ö×WF&ÆUF‡Ö“°¢Ð¢6öç7BWf–FVæ6TöæÇ”6öçG&öÂÒ²ÆÆ÷vVEw&—FW3¢7FW$6÷'&V7F–öâæWf–FVæ6TöæÇ•w&—FW2Âf÷&&–FFVåw&—FW3¢7FW$6÷'&V7F–öâæf÷&&–FFVåw&—FW2Ó°¢–b‡&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—B’°¢76W'D&÷VæF'”†—7F÷'’‡F&vWD6öÖÖ—BÂ&VF&6´6öÖÖ—BÂWf–FVæ6TöæÇ”6öçG&öÂÂw÷7B×F&vWBWf–FVæ6RÖöæÇ’&ævRF‡&÷Vv‚Æ—fR&VF&6²r“°¢76W'D&÷VæF'”†—7F÷'’‡&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—BÂ6Æ÷7W&T6öÖÖ—BÂWf–FVæ6TöæÇ”6öçG&öÂÂw÷7BÖ6÷'&V7F–öâWf–FVæ6RÖöæÇ’6Æ÷7W&R&ævRr“°¢ÒVÇ6R°¢76W'D&÷VæF'”†—7F÷'’‡F&vWD6öÖÖ—BÂ6Æ÷7W&T6öÖÖ—BÂWf–FVæ6TöæÇ”6öçG&öÂÂw÷7B×F&vWBWf–FVæ6RÖöæÇ’&ævRr“°¢Ð¢6öç7B&÷VæD6öçFVçEF‡2Ò‡c56VÂæ&–æF–æw2óòµÒ’æÖ†&–æF–ærÓâ&–æF–ærçF‚“°¢76W'B†&÷VæD6öçFVçEF‡2æÆVæwF‚âÂwc26VÂ†2æò&÷VæB6öçFVçBF‡2r“°¢6öç7B÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—BÒ&W6öÇfU7FW%÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—B‚“°¢6öç7B7W'&VçEfW&–f–W$6÷'&V7F–öä6öÖÖ—BÒ&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—Bóò÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—C°¢6öç7B6VÄ6öÖÖ—BÒf—'7DFD6öÖÖ—B‡c56VÅF‚“°¢f÷"†6öç7B&–æF–æröbc56VÂæ&–æF–æw2’°¢–b‡÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—Bbb&–æF–ærçF‚ÓÓÒwFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2r’°¢6öç7B6÷'&V7FVEfW&–f–W$&Æö"Òv—B…²w&Wb×'6RrÂG·÷7D6öçF–çV—G•fW&–f–W$6÷'&V7F–öä6öÖÖ—GÓ¢G¶&–æF–ærçF‡ÖÒ“°¢6öç7B7W'&VçEfW&–f–W$&Æö"Òv—B…²w&Wb×'6RrÂG¶7W'&VçEfW&–f–W$6÷'&V7F–öä6öÖÖ—GÓ¢G¶&–æF–ærçF‡ÖÒ“°¢76W'B†v—B…²w&Wb×'6RrÂG·6VÄ6öÖÖ—GÓ¢G¶&–æF–ærçF‡ÖÒ’ÓÓÒ&–æF–æræ&Æö"Â6VÆVBfW&–f–W"&–æF–ærF–ffW'2BF†R†—7F÷&–6Â6VÃ¢G¶&–æF–ærçF‡Ö“°¢76W'B†v—B…²w&Wb×'6RrÂG·F&vWD6öÖÖ—GÓ¢G¶&–æF–ærçF‡ÖÒ’ÓÓÒ6÷'&V7FVEfW&–f–W$&Æö"Â7&—F–2F&vWBF–ffW'2g&öÒF†R&Wf–WvVB÷7BÖ6öçF–çV—G’fW&–f–W#¢G¶&–æF–ærçF‡Ö“°¢76W'B†v—B…²w&Wb×'6RrÂ„TC¢G¶&–æF–ærçF‡ÖÒ’ÓÓÒ7W'&VçEfW&–f–W$&Æö"Â7W'&VçBfW&–f–W"F–ffW'2g&öÒF†R&Wf–WvVB6ö×F–&–Æ—G’6÷'&V7F–öã¢G¶&–æF–ærçF‡Ö“°¢ÒVÇ6R°¢76W'B†v—B…²w&Wb×'6RrÂG·F&vWD6öÖÖ—GÓ¢G¶&–æF–ærçF‡ÖÒ’ÓÓÒ&–æF–æræ&Æö"Â7&—F–2F&vWBF–ffW'2g&öÒc26VÂ&–æF–æs¢G¶&–æF–ærçF‡Ö“°¢76W'B†v—B…²w&Wb×'6RrÂ„TC¢G¶&–æF–ærçF‡ÖÒ’ÓÓÒ&–æF–æræ&Æö"Âc26VÂ&–æF–ær6†ævVBgFW"7&—F–6—6Ó¢G¶&–æF–ærçF‡Ö“°¢Ð¢Ð¢76W'B†v—B…²w&Wb×'6RrÂG·F&vWD6öÖÖ—GÓ¢G·c56VÅF‡ÖÒ’ÓÓÒv—B…²w&Wb×'6RrÂ„TC¢G·c56VÅF‡ÖÒ’Âwc26VÂ6†ævVBgFW"F†R7&—F–2F&vWBr“°¢6öç7Bg&÷¦Vå÷7EF&vWEF‡2Ò²ââææWr6WB…²ââæ&÷VæD6öçFVçEF‡2Âââç÷7EF&vWD–Ö×WF&ÆUF‡5Ò•Ð¢æf–ÇFW"†f–ÆRÓâ‡&T6Æ÷7W&UfW&–f–W$6÷'&V7F–öä6öÖÖ—Bbbf–ÆRÓÓÒwFW7G2öv÷fW&ææ6R÷fW&–g’Ö7W'&VçBÖWF†÷&—G’æÖ§2r’“°¢76W'DæõF„6†ævW56–æ6R‡F&vWD6öÖÖ—BÂ6Æ÷7W&T6öÖÖ—BÂg&÷¦Vå÷7EF&vWEF‡2Âw÷7BÖ7&—F–2c26öçFVçBg&VW¦Rr“°¢76W'B†—4æ6W7F÷"‡&V÷VâæVçG'’æ†VBÂ6Æ÷7W&T6öÖÖ—B’Âw&÷VæB326Æ÷7W&R—2æ÷BFW66VæFVBg&öÒ&÷VæB3VçG'’r“°¢76W'D&÷VæF'”†—7F÷'’‡&V÷VâæVçG'’æ†VBÂ7FW$6÷'&V7F–öâæVçG'’æ†VBÂ&V÷VâÂv6ö×ÆWFVB&÷VæB3&W—"&ævRr“°¢76W'D&÷VæF'”†—7F÷'’‡7FW$6÷'&V7F–öâæVçG'’æ†VBÂ6Æ÷7W&T6öÖÖ—BÂ7FW$6÷'&V7F–öâÂw&÷VæB3"6÷'&V7F–öâæB&÷VæB326Æ÷7W&R&ævRr“°¢–b‡3%&W—$6öçG&öÂ’°¢6öç7B&W—$VæBÒ3%$÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3%$÷Væ–æt6öÖÖ—GÕæÒ’¢3%&Wf—6–öä÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3%&Wf—6–öä÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'E3$†—7F÷'•v—F„–æ7&VÖVçFÅ&VæWvÇ2‡3%&W—$÷Væ–æt6öÖÖ—BÂ&W—$VæBÂ3%&W—$6öçG&öÂÂw&÷VæB3B3"Õ&W—"&ævRrÂsr“°¢6öç7B76WE7V66W76÷$VæBÒ÷Væ–ærÓâ3$76WE74÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3$76WE74÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢–b‡3%$6öçG&öÂ’76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%$÷Væ–æt6öÖÖ—BÂ76WE7V66W76÷$VæB‡3%$÷Væ–æt6öÖÖ—B’Â3%$6öçG&öÂÂw&÷VæB3R&W&W6VçFF—fR76WB×&ööb&ævRr“°¢–b‡3%&Wf—6–öä6öçG&öÂ’°¢6öç7BVæBÒ3%&Wf—6VE$÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3%&Wf—6VE$÷Væ–æt6öÖÖ—GÕæÒ’¢3%6V6öæE&Wf—6–öä÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3%6V6öæE&Wf—6–öä÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'E3$†—7F÷'•v—F„–æ7&VÖVçFÅ&VæWvÇ2‡3%&Wf—6–öä÷Væ–æt6öÖÖ—BÂVæBÂ3%&Wf—6–öä6öçG&öÂÂw&÷VæB3b&Wf—6–öâöWf–FVæ6R&ævRrÂs"r“°¢Ð¢–b‡3%&Wf—6VE$6öçG&öÂ’76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%&Wf—6VE$÷Væ–æt6öÖÖ—BÂ76WE7V66W76÷$VæB‡3%&Wf—6VE$÷Væ–æt6öÖÖ—B’Â3%&Wf—6VE$6öçG&öÂÂw&÷VæB3r&W&W6VçFF—fR76WB×&ööb&ævRr“°¢–b‡3%6V6öæE&Wf—6–öä6öçG&öÂ’°¢6öç7BVæBÒ3%6V6öæE&Wf—6VE$÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3%6V6öæE&Wf—6VE$÷Væ–æt6öÖÖ—GÕæÒ’¢3%F†—&E&Wf—6–öä÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3%F†—&E&Wf—6–öä÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'E3$†—7F÷'•v—F„–æ7&VÖVçFÅ&VæWvÇ2‡3%6V6öæE&Wf—6–öä÷Væ–æt6öÖÖ—BÂVæBÂ3%6V6öæE&Wf—6–öä6öçG&öÂÂw&÷VæB3‚&Wf—6–öâöWf–FVæ6R&ævRrÂs2r“°¢Ð¢–b‡3%6V6öæE&Wf—6VE$6öçG&öÂ’76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%6V6öæE&Wf—6VE$÷Væ–æt6öÖÖ—BÂ76WE7V66W76÷$VæB‡3%6V6öæE&Wf—6VE$÷Væ–æt6öÖÖ—B’Â3%6V6öæE&Wf—6VE$6öçG&öÂÂw&÷VæB3’&W&W6VçFF—fR76WB×&ööb&ævRr“°¢–b‡3%F†—&E&Wf—6–öä6öçG&öÂ’°¢6öç7BVæBÒ3%F†—&E&Wf—6VE$÷Væ–æt6öÖÖ—Bòv—B…²w&Wb×'6RrÂG·3%F†—&E&Wf—6VE$÷Væ–æt6öÖÖ—GÕæÒ’¢v—B…²w&Wb×'6RrÂt„TBuÒ“°¢76W'E3$†—7F÷'•v—F„–æ7&VÖVçFÅ&VæWvÇ2‡3%F†—&E&Wf—6–öä÷Væ–æt6öÖÖ—BÂVæBÂ3%F†—&E&Wf—6–öä6öçG&öÂÂw&÷VæBC&Wf—6–öâöWf–FVæ6R&ævRrÂsBr“°¢Ð¢–b‡3%F†—&E&Wf—6VE$6öçG&öÂ’76W'E&VwVÆ$&÷VæFVD†—7F÷'’‡3%F†—&E&Wf—6VE$÷Væ–æt6öÖÖ—BÂ76WE7V66W76÷$VæB‡3%F†—&E&Wf—6VE$÷Væ–æt6öÖÖ—B’Â3%F†—&E&Wf—6VE$6öçG&öÂÂw&÷VæBC&W&W6VçFF—fR76WB×&ööb&ævRr“°¢ÒVÇ6R°¢76W'D&÷VæF'”†—7F÷'’†6Æ÷7W&T6öÖÖ—BÂv—B…²w&Wb×'6RrÂt„TBuÒ’Â&öGV7D6öçG&öÂÂw÷7BÕ†6S&÷VæB#bVF—B7FFRr“°¢Ð§Ð ¦76W'B‡&ö6W72æVçbät•D…T%ô5D”ôå2ÓÒwG'VRrÇÂ&WV—&TÆ—fT7F–öç2ÇÂ6VÖçF–4öæÇ’Âtv—D‡V"7F–öç2×W7B'VâF†R7W'&VçBfW&–f–W"–âÆ—fR×&÷fVææ6R÷"Væ7&VFVçF–ÆVB6VÖçF–2ÖöFRr“°¦6öç7BW‡V7FVDÆ—fUv÷&¶fÆ÷tÆ&VÇ2Ò°¢âââ†6Æ÷7W&U&W—$7&—F–46ö×ÆWFRò²v6Æ÷7W&RÖ–çFVw&—G’7&—F–2uÒ¢µÒ’À¢âââ‡7FW$6÷'&V7F–öâò²w&÷VæB3"VçG'’uÒ¢µÒ’À¢âââ†W†—7G2‡7FW%&Wf–WuF‡2æÆ—fU&VF&6²’ò²u7FW"Æ—fR&VF&6²uÒ¢µÒ’À¢âââ†W†—7G2†6Æ÷7W&TWf–FVæ6Ræ6ö×ÆWF–öâ’ò²u†6R6ö×ÆWF–öâuÒ¢µÒ’À¢âââ†W†—7G2†6Æ÷7W&TWf–FVæ6RæÆ—fU&VF&6²’ò²u†6RÆ—fR&VF&6²uÒ¢µÒ’À¢âââ‡3%&W—$6öçG&öÂò²w&÷VæB3BVçG'’uÒ¢µÒ’À¢âââ‡3%$6öçG&öÂò²w&÷VæB3RVçG'’uÒ¢µÒ’À¢âââ‡3%&Wf—6–öä6öçG&öÂò²w&÷VæB3bVçG'’uÒ¢µÒ’À¢âââ‡3%&Wf—6VE$6öçG&öÂò²w&÷VæB3rVçG'’uÒ¢µÒ’À¢âââ‡3%6V6öæE&Wf—6–öä6öçG&öÂò²w&÷VæB3‚VçG'’uÒ¢µÒ’À¢âââ‡3%6V6öæE&Wf—6VE$6öçG&öÂò²w&÷VæB3’VçG'’uÒ¢µÒ’À¢âââ‡3%F†—&E&Wf—6–öä6öçG&öÂò²w&÷VæBCVçG'’uÒ¢µÒ’À¢âââ‡3%F†—&E&Wf—6VE$6öçG&öÂò²w&÷VæBCVçG'’uÒ¢µÒ¥Ó°¦76W'B„¥4ôâç7G&–æv–g’†Æ—fUv÷&¶fÆ÷tWf–FVæ6U&V6÷&G2æÖ†VçG'’ÓâVçG'’æÆ&VÂ’ç6÷'B‚’’ÓÓÒ¥4ôâç7G&–æv–g’†W‡V7FVDÆ—fUv÷&¶fÆ÷tÆ&VÇ2ç6÷'B‚’’Âw&Vv—7FW&VBÆ—fR7F–öç2Wf–FVæ6R6WBF–ffW'2g&öÒF†RW†7B†6R×&WV—&VB6WBr“°¦6öç7B7W'&VçD†VBÒv—B…²w&Wb×'6RrÂt„TBuÒ“°¦6öç7BW†7E&W—$&ö÷G7G&Ò—4W†7E&W—$&ö÷G7G&6öÖÖ—B†7W'&VçD†VB“°¦–b‡&WV—&TÆ—fT7F–öç2bbÆ—fUv÷&¶fÆ÷tWf–FVæ6U&V6÷&G2æÆVæwF‚ÓÓÒ’°¢76W'B†W†7E&W—$&ö÷G7G&ÂvV×G’Æ—fR7F–öç2Wf–FVæ6R—2ÆÆ÷vVBöæÇ’f÷"F†RW†7B–ÖÖVF–FR&W—"Ö&ö÷G7G&6öÖÖ—Br“°§Ð¦6öç7B'F–f7D&6†—fU&WV—&VDf÷$7W'&VçE†6RÒG'VS°¦–b‡&WV—&TÆ—fT7F–öç2’°¢6öç7BVæ—VU&V6÷&G2Ò²ââææWrÖ†Æ—fUv÷&¶fÆ÷tWf–FVæ6U&V6÷&G2æÖ†VçG'’Óâ¶VçG'’æ¶W’ÂVçG'•Ò’’çfÇVW2‚•Ó°¢f÷"†6öç7BVçG'’öbVæ—VU&V6÷&G2’fW&–g”Æ—fUv÷&¶fÆ÷tWf–FVæ6R†VçG'’æWf–FVæ6RÂVçG'’æÆ&VÂÂ'F–f7D&6†—fU&WV—&VDf÷$7W'&VçE†6R“°§Ð¦6öç7BÆ—fTv—D‡V$7F–öç5&÷fVææ6RÒ&WV—&TÆ—fT7F–öç0¢ò†Æ—fUv÷&¶fÆ÷tWf–FVæ6U&V6÷&G2æÆVæwF‚âòudU$”d”TEô’r¢uTäD”äuôÄ•dUõ$õdTää4Uõ$TD$4²r¢¢täõEô4„T4´TEôÄô4Âs°¦6öç7B7W'&VçDv÷fW&ææ6UfW&F–7BÒÆ—fTv—D‡V$7F–öç5&÷fVææ6RÓÓÒudU$”d”TEô’p¢òu55ô5U%$TåEôUD„õ$•E•ôtõdU$ää4Rp¢¢†Æ—fTv—D‡V$7F–öç5&÷fVææ6RÓÓÒuTäD”äuôÄ•dUõ$õdTää4Uõ$TD$4²p¢òuTäD”äuôÄ•dUõ$õdTää4Uõ$TD$4²p¢¢u55õ5DD”5ô5U%$TåEôUD„õ$•E•ôäôåôUD„õ$•¤”ärr“° ¦6öç6öÆRæÆör„¥4ôâç7G&–æv–g’‡°¢fW&F–7C¢7W'&VçDv÷fW&ææ6UfW&F–7BÀ¢7F—fT6†ævT6öçG&öÃ¢WF†÷&—G’æ7F—fT6†ævT6öçG&öÂÀ¢v÷fW&ææ6U&V6÷fW'”6Æ÷7W&S¢WF†÷&—G’æv÷fW&ææ6U&V6÷fW'“òæ6Æ÷7W&RÇÂçVÆÂÀ¢7FW%7FGW3¢WF†÷&—G’æW†V7WF&ÆT6öçG&7Bç7FW%7FGW2À¢7FW$7F—fU6VÃ¢WF†÷&—G’æW†V7WF&ÆT6öçG&7Bç6VÂÀ¢7FW$&–æF–æt6÷VçC¢fW&–f–VEc56VÂòfW&–f–VEc56VÂæ&–æF–æw2æÆVæwF‚¢7FW%6VÂæ&–æF–æw2æÆVæwF‚À¢†—7F÷&–6Å7FW%c$&–æF–æt6÷VçC¢7FW%6VÂæ&–æF–æw2æÆVæwF‚À¢Æ—fTv—D‡V$7F–öç5&÷fVææ6RÀ¢Æ—fTv—D‡V$7F–öç4Wf–FVæ6T6÷VçC¢Æ—fUv÷&¶fÆ÷tWf–FVæ6U&V6÷&G2æÆVæwF‚À¢7FWE73¢fÇ6RÀ¢7FWTÆÆ÷vVC¢fÇ6RÀ¢‡—6–6Ä•†öæUfW&–f–VC¢fÇ6RÀ¢&öGV7F–öäÆ–46†ævVC¢fÇ6P§ÒÂçVÆÂÂ"’“° 