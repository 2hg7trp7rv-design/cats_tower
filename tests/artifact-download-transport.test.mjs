import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ArtifactDownloadTransportError,
  GITHUB_API_VERSION,
  GITHUB_JSON_ACCEPT,
  assertArtifactArchiveBinding,
  downloadGithubArtifactArchive,
} from './artifact-download-transport.mjs';

const repository = 'octo-org/cats-tower';
const artifactId = 9_480_141_426;
const token = 'github-test-token';
const apiUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`;
const signedUrl = 'https://artifact-storage.example/download?sig=one-minute-secret';
const payload = Buffer.from('PK\u0003\u0004mock-artifact-zip', 'utf8');

function exactArrayBuffer(bytes) {
  const copy = Buffer.from(bytes);
  return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
}

function mockResponse(status, { location, bytes = payload, bodyError } = {}) {
  return {
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() !== 'location') return null;
        return location === undefined ? null : location;
      },
    },
    async arrayBuffer() {
      if (bodyError) throw bodyError;
      return exactArrayBuffer(bytes);
    },
  };
}

function headerValue(headers, name) {
  return new Headers(headers).get(name);
}

function baseOptions(fetchImpl, overrides = {}) {
  return {
    repository,
    artifactId,
    token,
    fetchImpl,
    timeoutMs: 250,
    ...overrides,
  };
}

async function expectTransportCode(operation, expectedCode) {
  await assert.rejects(operation, error => {
    assert(error instanceof ArtifactDownloadTransportError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function expectBindingCode(operation, expectedCode) {
  assert.throws(operation, error => {
    assert(error instanceof ArtifactDownloadTransportError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

test('downloads through an authenticated manual 302 then an unauthenticated no-redirect hop', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return mockResponse(302, { location: signedUrl });
    return mockResponse(200);
  };

  const archive = await downloadGithubArtifactArchive(baseOptions(fetchImpl));
  assert.deepEqual(archive, payload);
  assert.equal(calls.length, 2);

  const first = calls[0];
  assert.equal(first.url, apiUrl);
  assert.equal(first.options.method, 'GET');
  assert.equal(first.options.redirect, 'manual');
  assert.equal(first.options.credentials, 'omit');
  assert.equal(headerValue(first.options.headers, 'Authorization'), `Bearer ${token}`);
  assert.equal(headerValue(first.options.headers, 'Accept'), GITHUB_JSON_ACCEPT);
  assert.equal(headerValue(first.options.headers, 'X-GitHub-Api-Version'), GITHUB_API_VERSION);
  assert.equal(
    headerValue(first.options.headers, 'User-Agent'),
    'cats-tower-step-1-artifact-verifier',
  );
  assert(first.options.signal instanceof AbortSignal);

  const second = calls[1];
  assert.equal(second.url, signedUrl);
  assert.equal(second.options.method, 'GET');
  assert.equal(second.options.redirect, 'error');
  assert.equal(second.options.credentials, 'omit');
  assert.equal(second.options.referrerPolicy, 'no-referrer');
  assert.equal(Object.hasOwn(second.options, 'headers'), false);
  assert(second.options.signal instanceof AbortSignal);

  const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  assert.deepEqual(assertArtifactArchiveBinding(archive, {
    expectedSize: payload.byteLength,
    expectedDigest: digest,
  }), payload);
});

test('reproduces the legacy octet-stream 415 while the JSON-media-type transport succeeds', async () => {
  let firstHopCount = 0;
  const fetchImpl = async (url, options) => {
    if (String(url) === apiUrl) {
      firstHopCount += 1;
      const accept = headerValue(options.headers, 'Accept');
      if (accept === 'application/octet-stream') return mockResponse(415);
      assert.equal(accept, GITHUB_JSON_ACCEPT);
      return mockResponse(302, { location: signedUrl });
    }
    assert.equal(String(url), signedUrl);
    return mockResponse(200);
  };

  const legacyResponse = await fetchImpl(apiUrl, {
    redirect: 'follow',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/octet-stream',
    },
  });
  assert.equal(legacyResponse.status, 415);

  assert.deepEqual(
    await downloadGithubArtifactArchive(baseOptions(fetchImpl)),
    payload,
  );
  assert.equal(firstHopCount, 2);
});

test('rejects every first-hop status other than the required 302', async t => {
  for (const status of [200, 201, 301, 303, 307, 308, 401, 403, 404, 415, 500]) {
    await t.test(String(status), async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        return mockResponse(status, { location: signedUrl });
      };
      await expectTransportCode(
        () => downloadGithubArtifactArchive(baseOptions(fetchImpl)),
        'FIRST_HOP_STATUS',
      );
      assert.equal(calls, 1);
    });
  }
});

test('rejects a missing, empty, or unreadable Location header', async t => {
  const cases = [
    ['missing', mockResponse(302)],
    ['empty', mockResponse(302, { location: '' })],
    ['unreadable', {
      status: 302,
      headers: {
        get() {
          throw new Error('header parser failed');
        },
      },
    }],
  ];

  for (const [name, firstResponse] of cases) {
    await t.test(name, async () => {
      await expectTransportCode(
        () => downloadGithubArtifactArchive(baseOptions(async () => firstResponse)),
        'LOCATION_MISSING',
      );
    });
  }
});

test('rejects non-HTTPS, credential-bearing, relative, whitespace, and newline Locations', async t => {
  const invalidLocations = {
    http: 'http://artifact-storage.example/download',
    file: 'file:///tmp/artifact.zip',
    username: 'https://user@artifact-storage.example/download',
    password: 'https://user:password@artifact-storage.example/download',
    relative: '/artifact/download',
    leadingWhitespace: ' https://artifact-storage.example/download',
    horizontalTab: 'https://artifact\t-storage.example/download',
    nullByte: 'https://artifact-storage.example/down\u0000load',
    carriageReturn: 'https://artifact-storage.example/download\rX-Evil: yes',
    lineFeed: 'https://artifact-storage.example/download\nX-Evil: yes',
  };

  for (const [name, location] of Object.entries(invalidLocations)) {
    await t.test(name, async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        return mockResponse(302, { location });
      };
      await expectTransportCode(
        () => downloadGithubArtifactArchive(baseOptions(fetchImpl)),
        'LOCATION_INVALID',
      );
      assert.equal(calls, 1);
    });
  }
});

test('rejects a second-hop redirect and every non-200 storage response', async t => {
  for (const status of [204, 206, 301, 302, 307, 401, 403, 404, 500]) {
    await t.test(String(status), async () => {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        if (calls === 1) return mockResponse(302, { location: signedUrl });
        return mockResponse(status);
      };
      await expectTransportCode(
        () => downloadGithubArtifactArchive(baseOptions(fetchImpl)),
        'SECOND_HOP_STATUS',
      );
      assert.equal(calls, 2);
    });
  }

  await t.test('fetch implementation reports a followed redirect', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return mockResponse(302, { location: signedUrl });
      return { ...mockResponse(200), redirected: true };
    };
    await expectTransportCode(
      () => downloadGithubArtifactArchive(baseOptions(fetchImpl)),
      'SECOND_HOP_REDIRECT',
    );
  });
});

test('does not leak Authorization or GitHub API headers to artifact storage', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    if (calls === 1) return mockResponse(302, { location: signedUrl });

    assert.equal(String(url), signedUrl);
    assert.equal(Object.hasOwn(options, 'headers'), false);
    const serialized = JSON.stringify(options);
    assert.doesNotMatch(serialized, /Authorization|Bearer|github\+json|GitHub-Api-Version/u);
    assert.doesNotMatch(serialized, new RegExp(token, 'u'));
    return mockResponse(200);
  };

  await downloadGithubArtifactArchive(baseOptions(fetchImpl));
  assert.equal(calls, 2);
});

test('binds bytes to exact provider size and SHA-256 digest and fails mismatches', () => {
  const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  const arrayBuffer = exactArrayBuffer(payload);
  assert.deepEqual(assertArtifactArchiveBinding(payload, {
    expectedSize: payload.byteLength,
    expectedDigest: digest,
  }), payload);
  assert.deepEqual(assertArtifactArchiveBinding(new Uint8Array(arrayBuffer), {
    expectedSize: payload.byteLength,
    expectedDigest: digest,
  }), payload);
  assert.deepEqual(assertArtifactArchiveBinding(arrayBuffer, {
    expectedSize: payload.byteLength,
    expectedDigest: digest,
  }), payload);

  expectBindingCode(() => assertArtifactArchiveBinding(payload, {
    expectedSize: payload.byteLength + 1,
    expectedDigest: digest,
  }), 'SIZE_MISMATCH');
  expectBindingCode(() => assertArtifactArchiveBinding(payload, {
    expectedSize: payload.byteLength,
    expectedDigest: `sha256:${'0'.repeat(64)}`,
  }), 'DIGEST_MISMATCH');
  expectBindingCode(() => assertArtifactArchiveBinding(payload, {
    expectedSize: -1,
    expectedDigest: digest,
  }), 'INVALID_ARGUMENT');

  for (const malformedDigest of [digest.slice(7), digest.toUpperCase(), 'sha512:bad', '']) {
    expectBindingCode(() => assertArtifactArchiveBinding(payload, {
      expectedSize: payload.byteLength,
      expectedDigest: malformedDigest,
    }), 'INVALID_ARGUMENT');
  }
  expectBindingCode(() => assertArtifactArchiveBinding('not-bytes', {
    expectedSize: payload.byteLength,
    expectedDigest: digest,
  }), 'INVALID_ARGUMENT');
  expectBindingCode(() => assertArtifactArchiveBinding(payload), 'INVALID_ARGUMENT');
});

test('sanitizes synchronous and asynchronous transport failures without exposing secrets', async () => {
  const firstSecret = 'first-hop-private-detail';
  await assert.rejects(
    () => downloadGithubArtifactArchive(baseOptions(() => {
      throw new Error(`${firstSecret}:${token}`);
    })),
    error => {
      assert.equal(error.code, 'FIRST_HOP_REQUEST_FAILED');
      assert.doesNotMatch(error.message, new RegExp(`${firstSecret}|${token}`, 'u'));
      return true;
    },
  );

  let calls = 0;
  await assert.rejects(
    () => downloadGithubArtifactArchive(baseOptions(async () => {
      calls += 1;
      if (calls === 1) return mockResponse(302, { location: signedUrl });
      throw new Error(`storage failed at ${signedUrl}`);
    })),
    error => {
      assert.equal(error.code, 'SECOND_HOP_REQUEST_FAILED');
      assert.doesNotMatch(error.message, /one-minute-secret|artifact-storage\.example/u);
      return true;
    },
  );
});

function rejectWhenAborted(signal) {
  return new Promise((resolve, reject) => {
    const rejectAbort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) rejectAbort();
    else signal.addEventListener('abort', rejectAbort, { once: true });
  });
}

test('fails closed when either request exceeds its timeout', async t => {
  await t.test('first hop', async () => {
    await expectTransportCode(
      () => downloadGithubArtifactArchive(baseOptions(
        async (url, options) => rejectWhenAborted(options.signal),
        { timeoutMs: 20 },
      )),
      'FIRST_HOP_TIMEOUT',
    );
  });

  await t.test('second hop', async () => {
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls += 1;
      if (calls === 1) return mockResponse(302, { location: signedUrl });
      return rejectWhenAborted(options.signal);
    };
    await expectTransportCode(
      () => downloadGithubArtifactArchive(baseOptions(fetchImpl, { timeoutMs: 20 })),
      'SECOND_HOP_TIMEOUT',
    );
  });

  await t.test('second-hop response body', async () => {
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls += 1;
      if (calls === 1) return mockResponse(302, { location: signedUrl });
      return {
        status: 200,
        async arrayBuffer() {
          return rejectWhenAborted(options.signal);
        },
      };
    };
    await expectTransportCode(
      () => downloadGithubArtifactArchive(baseOptions(fetchImpl, { timeoutMs: 20 })),
      'SECOND_HOP_TIMEOUT',
    );
  });
});

test('fails closed when the 200 response body cannot provide archive bytes', async t => {
  await t.test('arrayBuffer throws', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return mockResponse(302, { location: signedUrl });
      return mockResponse(200, { bodyError: new Error('stream failure') });
    };
    await expectTransportCode(
      () => downloadGithubArtifactArchive(baseOptions(fetchImpl)),
      'ARCHIVE_READ_FAILED',
    );
  });

  await t.test('arrayBuffer returns another type', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return mockResponse(302, { location: signedUrl });
      return {
        status: 200,
        async arrayBuffer() {
          return payload;
        },
      };
    };
    await expectTransportCode(
      () => downloadGithubArtifactArchive(baseOptions(fetchImpl)),
      'ARCHIVE_READ_FAILED',
    );
  });
});

test('rejects input values that could alter the API request or disable the bound timeout', async t => {
  const inertFetch = async () => mockResponse(302, { location: signedUrl });
  const invalidCases = [
    ['repository traversal', { repository: 'octo-org/cats/../../other' }],
    ['repository newline', { repository: 'octo-org/cats\ntower' }],
    ['artifact zero', { artifactId: 0 }],
    ['artifact string', { artifactId: '9480141426' }],
    ['token empty', { token: '' }],
    ['token CRLF', { token: 'secret\r\nX-Evil: yes' }],
    ['fetch absent', { fetchImpl: null }],
    ['timeout zero', { timeoutMs: 0 }],
    ['timeout overflow', { timeoutMs: 2_147_483_648 }],
  ];

  for (const [name, overrides] of invalidCases) {
    await t.test(name, async () => {
      await expectTransportCode(
        () => downloadGithubArtifactArchive(baseOptions(inertFetch, overrides)),
        'INVALID_ARGUMENT',
      );
    });
  }
});
