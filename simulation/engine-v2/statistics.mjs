import { assertUnsigned, parseExactDecimal, rational, compare, roundRational } from './numeric.mjs';

function percentileRank(total, percentile) {
  const p = parseExactDecimal(percentile, 'percentile');
  if (compare(p, rational(0n)) <= 0 || compare(p, rational(1n)) > 0) throw new RangeError('PERCENTILE_OUT_OF_RANGE');
  return roundRational({ n: total * p.n, d: p.d }, 'ceil');
}

function sortedUnsigned(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('STATISTICS_EMPTY_INPUT');
  return values.map((value, index) => BigInt(assertUnsigned(value, `values[${index}]`))).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function nearestRank(values, percentile) {
  const sorted = sortedUnsigned(values);
  const rank = percentileRank(BigInt(sorted.length), percentile);
  return sorted[Number(rank - 1n)].toString();
}

export function summarizeUnsigned(values) {
  const sorted = sortedUnsigned(values);
  return {
    count: String(sorted.length),
    minimum: sorted[0].toString(),
    maximum: sorted.at(-1).toString(),
    p50: sorted[Number(percentileRank(BigInt(sorted.length), '0.50') - 1n)].toString(),
    p90: sorted[Number(percentileRank(BigInt(sorted.length), '0.90') - 1n)].toString(),
    p99: sorted[Number(percentileRank(BigInt(sorted.length), '0.99') - 1n)].toString(),
  };
}

export class UnsignedHistogram {
  #counts = new Map();
  #total = 0n;

  add(value, count = '1') {
    const canonicalValue = assertUnsigned(value, 'histogram.value');
    const canonicalCount = assertUnsigned(count, 'histogram.count', { positive: true });
    const increment = BigInt(canonicalCount);
    this.#counts.set(canonicalValue, (this.#counts.get(canonicalValue) ?? 0n) + increment);
    this.#total += increment;
    return this;
  }

  get count() { return this.#total.toString(); }

  summary() {
    if (this.#total === 0n) throw new Error('STATISTICS_EMPTY_INPUT');
    const entries = [...this.#counts.entries()].map(([value, count]) => [BigInt(value), count]).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const atRank = (rank) => {
      let cumulative = 0n;
      for (const [value, count] of entries) {
        cumulative += count;
        if (cumulative >= rank) return value.toString();
      }
      throw new Error('STATISTICS_RANK_NOT_REACHED');
    };
    return {
      count: this.#total.toString(),
      minimum: entries[0][0].toString(),
      maximum: entries.at(-1)[0].toString(),
      p50: atRank(percentileRank(this.#total, '0.50')),
      p90: atRank(percentileRank(this.#total, '0.90')),
      p99: atRank(percentileRank(this.#total, '0.99')),
    };
  }
}

export function mergeUnsignedSummaries(valuesByGroup) {
  if (!Array.isArray(valuesByGroup) || valuesByGroup.length === 0) throw new Error('STATISTICS_EMPTY_GROUPS');
  return summarizeUnsigned(valuesByGroup.flat());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const histogram = new UnsignedHistogram().add('1').add('2').add('3').add('4');
  const fixtures = [
    [nearestRank(['1','2','3','4'], '0.50') === '2', 'p50-even'],
    [nearestRank(['1','2','3','4'], '0.90') === '4', 'p90-even'],
    [nearestRank(['9'], '0.99') === '9', 'singleton'],
    [JSON.stringify(summarizeUnsigned(['10','1','7','4'])) === JSON.stringify({count:'4',minimum:'1',maximum:'10',p50:'4',p90:'10',p99:'10'}), 'summary'],
    [JSON.stringify(histogram.summary()) === JSON.stringify({count:'4',minimum:'1',maximum:'4',p50:'2',p90:'4',p99:'4'}), 'histogram'],
  ];
  const failed = fixtures.filter(([passed]) => !passed).map(([, name]) => name);
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, fixtureCount: String(fixtures.length), method: 'nearest-rank-v1' }));
}
