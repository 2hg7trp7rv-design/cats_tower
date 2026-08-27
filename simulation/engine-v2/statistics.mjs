import { assertUnsigned, parseExactDecimal, rational, compare, roundRational } from './numeric.mjs';

function sortedUnsigned(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('STATISTICS_EMPTY_INPUT');
  return values.map((value, index) => BigInt(assertUnsigned(value, `values[${index}]`))).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export function nearestRank(values, percentile) {
  const sorted = sortedUnsigned(values);
  const p = parseExactDecimal(percentile, 'percentile');
  if (compare(p, rational(0n)) <= 0 || compare(p, rational(1n)) > 0) throw new RangeError('PERCENTILE_OUT_OF_RANGE');
  const rank = roundRational({ n: BigInt(sorted.length) * p.n, d: p.d }, 'ceil');
  const index = Number(rank > 0n ? rank - 1n : 0n);
  return sorted[index].toString();
}

export function summarizeUnsigned(values) {
  const sorted = sortedUnsigned(values);
  return {
    count: String(sorted.length),
    minimum: sorted[0].toString(),
    maximum: sorted.at(-1).toString(),
    p50: nearestRank(sorted.map(String), '0.50'),
    p90: nearestRank(sorted.map(String), '0.90'),
    p99: nearestRank(sorted.map(String), '0.99'),
  };
}

export function mergeUnsignedSummaries(valuesByGroup) {
  if (!Array.isArray(valuesByGroup) || valuesByGroup.length === 0) throw new Error('STATISTICS_EMPTY_GROUPS');
  const flattened = valuesByGroup.flat();
  return summarizeUnsigned(flattened);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixtures = [
    [nearestRank(['1','2','3','4'], '0.50') === '2', 'p50-even'],
    [nearestRank(['1','2','3','4'], '0.90') === '4', 'p90-even'],
    [nearestRank(['9'], '0.99') === '9', 'singleton'],
    [JSON.stringify(summarizeUnsigned(['10','1','7','4'])) === JSON.stringify({count:'4',minimum:'1',maximum:'10',p50:'4',p90:'10',p99:'10'}), 'summary'],
  ];
  const failed = fixtures.filter(([passed]) => !passed).map(([, name]) => name);
  if (failed.length) {
    console.error(JSON.stringify({ ok: false, failed }));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, fixtureCount: String(fixtures.length), method: 'nearest-rank-v1' }));
}
