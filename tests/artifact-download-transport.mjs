import { createHash } from 'node:crypto';

export const GITHUB_JSON_ACCEPT = 'application/vnd.github+json';
export const GITHUB_API_VERSION = '2022-11-28';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export class ArtifactDownloadTransportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArtifactDownloadTransportError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ArtifactDownloadTransportError(code, message);
}

function validateInputs({ repository, artifactId, token, fetchImpl, timeoutMs }) {
  if (
    typeof repository !== 'string'
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/u.test(repository)
  ) {
    fail('INVALID_ARGUMENT', 'repository must be an owner/repository GitHub slug');
  }
  if (!Number.isSafeInteger(artifactId) || artifactId <= 0) {
    fail('INVALID_ARGUMENT', 'artifactId must be a positive safe integer');
  }
  if (
    typeof token !== 'string'
    || token.length === 0
    || /[\u0000-\u001f\u007f]/u.test(token)
  ) {
    fail('INVALID_ARGUMENT', 'token must be a non-empty HTTP-header-safe string');
  }
  if (typeof fetchImpl !== 'function') {
    fail('INVALID_ARGUMENT', 'fetchImpl must be a function');
  }
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_TIMEOUT_MS
  ) {
    fail('INVALID_ARGUMENT', 'timeoutMs must be a positive safe timer interval');
  }
}

async function boundedFetch(fetchImpl, url, options, timeoutMs, hop, consumeResponse) {
  const controller = new AbortController();
  const timeoutMarker = Symbol('artifact-download-timeout');
  let timedOut = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutMarker);
    }, timeoutMs);
  });

  try {
    const request = Promise.resolve().then(async () => {
      let response;
      try {
        response = await fetchImpl(url, {
          ...options,
          signal: controller.signal,
        });
      } catch {
        fail(
          `${hop}_REQUEST_FAILED`,
          `${hop === 'FIRST_HOP' ? 'GitHub API' : 'Artifact storage'} request failed`,
        );
      }
      return consumeResponse ? consumeResponse(response) : response;
    });
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timedOut || error === timeoutMarker) {
      fail(`${hop}_TIMEOUT`, `${hop === 'FIRST_HOP' ? 'GitHub API' : 'Artifact storage'} request timed out`);
    }
    if (error instanceof ArtifactDownloadTransportError) throw error;
    fail(`${hop}_REQUEST_FAILED`, `${hop === 'FIRST_HOP' ? 'GitHub API' : 'Artifact storage'} request failed`);
  } finally {
    clearTimeout(timer);
  }
}

function readLocation(response) {
  let rawLocation;
  try {
    rawLocation = response?.headers?.get?.('location');
  } catch {
    fail('LOCATION_MISSING', 'GitHub artifact response has no readable Location header');
  }
  if (typeof rawLocation !== 'string' || rawLocation.length === 0) {
    fail('LOCATION_MISSING', 'GitHub artifact response has no Location header');
  }
  if (rawLocation !== rawLocation.trim() || /[\u0000-\u001f\u007f]/u.test(rawLocation)) {
    fail('LOCATION_INVALID', 'GitHub artifact Location contains forbidden whitespace or controls');
  }

  let location;
  try {
    location = new URL(rawLocation);
  } catch {
    fail('LOCATION_INVALID', 'GitHub artifact Location is not an absolute URL');
  }
  if (location.protocol !== 'https:') {
    fail('LOCATION_INVALID', 'GitHub artifact Location must use HTTPS');
  }
  if (!location.hostname || location.username || location.password) {
    fail('LOCATION_INVALID', 'GitHub artifact Location must have a host and no credentials');
  }
  return location;
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  fail('INVALID_ARGUMENT', 'artifact bytes must be a Buffer, Uint8Array, or ArrayBuffer');
}

export async function downloadGithubArtifactArchive({
  repository,
  artifactId,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  validateInputs({ repository, artifactId, token, fetchImpl, timeoutMs });

  const apiUrl = new URL(
    `/repos/${repository}/actions/artifacts/${artifactId}/zip`,
    'https://api.github.com',
  );
  const signedLocation = await boundedFetch(fetchImpl, apiUrl, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: GITHUB_JSON_ACCEPT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'cats-tower-step-1-artifact-verifier',
    },
  }, timeoutMs, 'FIRST_HOP', firstResponse => {
    const status = firstResponse?.status;
    if (status !== 302) {
      fail(
        'FIRST_HOP_STATUS',
        `GitHub artifact endpoint must return 302; received ${Number.isInteger(status) ? status : 'invalid'}`,
      );
    }
    return readLocation(firstResponse);
  });

  return boundedFetch(fetchImpl, signedLocation, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  }, timeoutMs, 'SECOND_HOP', async secondResponse => {
    if (secondResponse?.redirected === true) {
      fail('SECOND_HOP_REDIRECT', 'Artifact storage response followed a forbidden redirect');
    }
    const status = secondResponse?.status;
    if (status !== 200) {
      fail(
        'SECOND_HOP_STATUS',
        `Artifact storage endpoint must return 200; received ${Number.isInteger(status) ? status : 'invalid'}`,
      );
    }

    let archive;
    try {
      archive = await secondResponse.arrayBuffer();
    } catch {
      fail('ARCHIVE_READ_FAILED', 'Artifact archive body could not be read');
    }
    if (!(archive instanceof ArrayBuffer)) {
      fail('ARCHIVE_READ_FAILED', 'Artifact archive body was not returned as an ArrayBuffer');
    }
    return Buffer.from(archive);
  });
}

export function assertArtifactArchiveBinding(bytes, binding) {
  const archive = toBuffer(bytes);
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    fail('INVALID_ARGUMENT', 'artifact binding must be an object');
  }
  const { expectedSize, expectedDigest } = binding;
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    fail('INVALID_ARGUMENT', 'expectedSize must be a non-negative safe integer');
  }
  if (typeof expectedDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(expectedDigest)) {
    fail('INVALID_ARGUMENT', 'expectedDigest must be a lowercase sha256: digest');
  }
  if (archive.byteLength !== expectedSize) {
    fail(
      'SIZE_MISMATCH',
      `Artifact archive size mismatch: expected ${expectedSize}, received ${archive.byteLength}`,
    );
  }

  const observedDigest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
  if (observedDigest !== expectedDigest) {
    fail('DIGEST_MISMATCH', 'Artifact archive SHA-256 digest mismatch');
  }
  return archive;
}
