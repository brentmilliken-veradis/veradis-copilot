// Exact fused multiply-add: round-once fl(a·b + c), emulated with BigInt
// rationals. Needed for bit-parity with the numpy macos-arm64 wheel, whose
// compiler contracts `1.0 + c * X` in random_standard_gamma into an fmadd
// (C ffp-contract). JS never contracts, so we fuse explicitly.
// Domain note: exact for finite normal/subnormal inputs; results that would
// round into the subnormal range may double-round — the call site (V ≈ 1.0 in
// Marsaglia–Tsang) never approaches that range.

export function fma(a: number, b: number, c: number): number {
  if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return a * b + c;
  const [ma, ea] = frexpBig(a);
  const [mb, eb] = frexpBig(b);
  const [mc, ec] = frexpBig(c);
  let m = ma * mb;
  let e = ea + eb;
  if (ec >= e) {
    m += mc << BigInt(ec - e);
  } else {
    m = (m << BigInt(e - ec)) + mc;
    e = ec;
  }
  if (m === 0n) return 0;
  return roundBig(m, e);
}

/** Decompose a finite double into (integer mantissa, base-2 exponent). */
function frexpBig(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const expo = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (expo === 0) return [sign * frac, -1074];
  return [sign * (frac | 0x10000000000000n), expo - 1075];
}

/** Round m·2^e to the nearest double (ties to even). */
function roundBig(m: bigint, e: number): number {
  const neg = m < 0n;
  if (neg) m = -m;
  const bits = m.toString(2).length;
  const shift = bits - 53;
  let mant: bigint;
  let exp2: number;
  if (shift > 0) {
    const rem = m & ((1n << BigInt(shift)) - 1n);
    mant = m >> BigInt(shift);
    exp2 = e + shift;
    const half = 1n << BigInt(shift - 1);
    if (rem > half || (rem === half && (mant & 1n) === 1n)) {
      mant += 1n;
      if (mant >> 53n) {
        mant >>= 1n;
        exp2 += 1;
      }
    }
  } else {
    mant = m;
    exp2 = e;
  }
  const val = Number(mant) * Math.pow(2, exp2);
  return neg ? -val : val;
}
