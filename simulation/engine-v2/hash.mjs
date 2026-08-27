import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new TypeError('Canonical JSON permits only finite safe integer JSON numbers; gameplay quantities must be strings');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  throw new TypeError(`Unsupported canonical JSON type: ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Canonical(value) {
  return sha256Text(canonicalJson(value));
}

export function gitBlobSha(buffer) {
  const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
}

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function gitBlobShaFile(path) {
  return gitBlobSha(await readFile(path));
}
