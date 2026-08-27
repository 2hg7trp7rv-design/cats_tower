import { createHash } from 'node:crypto';

const MASK = (1n << 64n) - 1n;
const TWO64 = 1n << 64n;

function splitMixStep(state) {
  let z = (state + 0x9e3779b97f4a7c15n) & MASK;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return { state: (state + 0x9e3779b97f4a7c15n) & MASK, value: (z ^ (z >> 31n)) & MASK };
}

export function seed64(text) {
  const digest = createHash('sha256').update(String(text), 'utf8').digest();
  return digest.readBigUInt64BE(0);
}

export class DeterministicRng {
  #state;
  constructor(seed) {
    this.#state = typeof seed === 'bigint' ? seed & MASK : seed64(seed);
  }
  nextU64() {
    const step = splitMixStep(this.#state);
    this.#state = step.state;
    return step.value;
  }
  nextBelow(maxExclusive) {
    const max = typeof maxExclusive === 'bigint' ? maxExclusive : BigInt(maxExclusive);
    if (max <= 0n || max > TWO64) throw new RangeError('maxExclusive must be in 1..2^64');
    const limit = TWO64 - (TWO64 % max);
    let value;
    do value = this.nextU64(); while (value >= limit);
    return value % max;
  }
  nextBasisPoints() { return this.nextBelow(10000n); }
  choose(array) {
    if (!Array.isArray(array) || array.length === 0) throw new RangeError('choose requires a non-empty array');
    return array[Number(this.nextBelow(BigInt(array.length)))];
  }
  snapshot() { return this.#state.toString(); }
}

export function deterministicSeed(namespace, buildId, personaId, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) throw new RangeError('ordinal must be a non-negative safe integer');
  return createHash('sha256').update(`${namespace}|${buildId}|${personaId}|${ordinal}`, 'utf8').digest('hex');
}
