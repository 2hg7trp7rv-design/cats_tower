const UNSIGNED = /^(0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL = /^-?(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

export function assertUnsigned(value, label = 'value', { positive = false } = {}) {
  if (typeof value !== 'string' || !UNSIGNED.test(value)) throw new TypeError(`${label} must be a normalized unsigned decimal string`);
  if (positive && value === '0') throw new RangeError(`${label} must be positive`);
  return value;
}

export function toBigInt(value, label = 'value') {
  return BigInt(assertUnsigned(value, label));
}

export function normalizeUnsigned(value) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new RangeError('unsigned value cannot be negative');
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('number must be a non-negative safe integer');
    return String(value);
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new TypeError('unsigned value must contain decimal digits only');
  return BigInt(value).toString();
}

function abs(n) { return n < 0n ? -n : n; }
function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

export function rational(numerator, denominator = 1n) {
  let n = typeof numerator === 'bigint' ? numerator : BigInt(numerator);
  let d = typeof denominator === 'bigint' ? denominator : BigInt(denominator);
  if (d === 0n) throw new RangeError('rational denominator cannot be zero');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function parseExactDecimal(value, label = 'decimal') {
  if (typeof value !== 'string' || !SIGNED_DECIMAL.test(value) || /[eE+]/.test(value)) throw new TypeError(`${label} must be a canonical fixed-point decimal string`);
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  if (whole.length > 1 && whole.startsWith('0')) throw new TypeError(`${label} has leading zeros`);
  const d = 10n ** BigInt(fraction.length);
  const n = BigInt(whole + fraction) * (negative ? -1n : 1n);
  return rational(n, d);
}

export function parseRatioObject(value, label = 'ratio') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return rational(toBigInt(value.numerator, `${label}.numerator`), toBigInt(value.denominator, `${label}.denominator`));
}

export function add(a, b) { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
export function subtract(a, b) { return rational(a.n * b.d - b.n * a.d, a.d * b.d); }
export function multiply(a, b) { return rational(a.n * b.n, a.d * b.d); }
export function divide(a, b) {
  if (b.n === 0n) throw new RangeError('division by zero');
  return rational(a.n * b.d, a.d * b.n);
}
export function compare(a, b) {
  const diff = a.n * b.d - b.n * a.d;
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

function divmodFloor(n, d) {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  let q = n / d;
  let r = n % d;
  if (r < 0n) { q -= 1n; r += d; }
  return { q, r };
}

export function roundRational(value, mode = 'half-even') {
  const { q, r } = divmodFloor(value.n, value.d);
  if (mode === 'floor') return q;
  if (mode === 'ceil') return r === 0n ? q : q + 1n;
  if (mode !== 'half-even') throw new RangeError(`unsupported rounding mode ${mode}`);
  const twice = r * 2n;
  if (twice < value.d) return q;
  if (twice > value.d) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

export function toFixed(value, scale, mode = 'half-even') {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 10000) throw new RangeError('scale must be a safe non-negative integer <= 10000');
  const factor = 10n ** BigInt(scale);
  const scaled = roundRational(rational(value.n * factor, value.d), mode);
  const sign = scaled < 0n ? '-' : '';
  const digits = abs(scaled).toString().padStart(scale + 1, '0');
  if (scale === 0) return sign + digits;
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

export function addUnsigned(a, b) { return (toBigInt(a) + toBigInt(b)).toString(); }
export function subtractUnsigned(a, b, underflow = 'reject') {
  const result = toBigInt(a) - toBigInt(b);
  if (result < 0n) {
    if (underflow === 'clamp-zero') return '0';
    throw new RangeError('unsigned subtraction underflow');
  }
  return result.toString();
}
export function multiplyUnsigned(a, b) { return (toBigInt(a) * toBigInt(b)).toString(); }
export function divideUnsigned(a, b, mode = 'floor') {
  const divisor = toBigInt(b);
  if (divisor === 0n) throw new RangeError('division by zero');
  return roundRational(rational(toBigInt(a), divisor), mode).toString();
}

export function powBigInt(base, exponent) {
  let b = typeof base === 'bigint' ? base : BigInt(base);
  let e = typeof exponent === 'bigint' ? exponent : BigInt(exponent);
  if (e < 0n) throw new RangeError('negative exponent not supported');
  let out = 1n;
  while (e) {
    if (e & 1n) out *= b;
    e >>= 1n;
    if (e) b *= b;
  }
  return out;
}

export function exactPowerExpression(coefficient, numerator, denominator, exponent) {
  return {
    kind: 'exact-symbolic-power-v1',
    coefficient: normalizeUnsigned(coefficient),
    numerator: normalizeUnsigned(numerator),
    denominator: normalizeUnsigned(denominator),
    exponent: normalizeUnsigned(exponent),
  };
}

export function evaluatePowerExpression(expression, mode = 'ceil') {
  const e = toBigInt(expression.exponent);
  const n = toBigInt(expression.coefficient) * powBigInt(toBigInt(expression.numerator), e);
  const d = powBigInt(toBigInt(expression.denominator), e);
  return roundRational(rational(n, d), mode).toString();
}

export function canonicalSigned(sign, magnitude) {
  const normalized = normalizeUnsigned(magnitude);
  if (!['positive', 'negative', 'zero'].includes(sign)) throw new TypeError('invalid explicit sign');
  if (normalized === '0') return { sign: 'zero', magnitude: '0' };
  if (sign === 'zero') throw new TypeError('zero sign requires zero magnitude');
  return { sign, magnitude: normalized };
}

export function displayAbbreviation(integerString, significantDigits = 4) {
  const digits = assertUnsigned(integerString);
  if (digits.length <= significantDigits) return digits;
  const exponent = digits.length - 1;
  const mantissaDigits = digits.slice(0, significantDigits);
  const mantissa = `${mantissaDigits[0]}.${mantissaDigits.slice(1)}`.replace(/\.?0+$/, '');
  return `${mantissa}e${exponent}`;
}
