import { createHash as createNodeHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHash } from '../../../packages/domain/src/browser/node-crypto';

const samples = [
  '',
  'abc',
  'tower-modifier-combination-v1|2|tower.modifier.armored',
  '日本語・猫の塔・2026-09-04',
  'x'.repeat(1_025),
];

describe('browser node:crypto bridge', () => {
  it('matches Node SHA-256 for the strings used by engine-v2', () => {
    for (const sample of samples) {
      const expected = createNodeHash('sha256')
        .update(sample, 'utf8')
        .digest('hex');
      const actual = createHash('sha256')
        .update(sample, 'utf8')
        .digest('hex');

      expect(actual).toBe(expected);
    }
  });

  it('matches Node when engine code supplies multiple update chunks', () => {
    const expected = createNodeHash('sha256')
      .update('tower-', 'utf8')
      .update(new Uint8Array([1, 2, 3, 4]))
      .update('猫', 'utf8')
      .digest('hex');
    const actual = createHash('sha256')
      .update('tower-', 'utf8')
      .update(new Uint8Array([1, 2, 3, 4]))
      .update('猫', 'utf8')
      .digest('hex');

    expect(actual).toBe(expected);
  });

  it('provides the readBigUInt64BE contract required by DeterministicRng', () => {
    const digest = createHash('sha256').update('abc', 'utf8').digest();
    expect(digest.readBigUInt64BE(0)).toBe(0xba7816bf8f01cfean);
    expect(digest.readBigUInt64BE(8)).toBe(0x414140de5dae2223n);
  });

  it('rejects algorithms that the browser runtime does not need', () => {
    expect(() => createHash('sha1')).toThrow(/only exposes sha256/i);
  });
});
