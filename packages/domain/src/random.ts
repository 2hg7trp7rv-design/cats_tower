export class DeterministicRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  public next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const result = ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    this.state >>>= 0;
    return result;
  }

  public integer(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError('Invalid deterministic integer range.');
    }

    return min + Math.floor(this.next() * (max - min + 1));
  }
}
