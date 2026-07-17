// Contract rounding — 2 dp, round-half-even, computed on the EXACT binary
// value of the double (matching CPython's `f"{x:.2f}"`, which rounds the exact
// value correctly with ties-to-even). This is the reproducibility contract per
// the 13 Jul 2026 HoI ruling: CI bounds are reported and hashed at 2 dp;
// bit-identical libm across platforms is explicitly NOT chased.

export function roundHalfEven2(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0;
  const neg = x < 0;
  const [m, e] = frexpBig(Math.abs(x));
  // exact value = m·2^e; scale by 100 and round to integer, ties to even.
  const num = m * 100n;
  let scaled: bigint;
  if (e >= 0) {
    scaled = num << BigInt(e);
  } else {
    const den = 1n << BigInt(-e);
    const q = num / den;
    const r = num % den;
    const twice = r * 2n;
    if (twice > den || (twice === den && (q & 1n) === 1n)) {
      scaled = q + 1n;
    } else {
      scaled = q;
    }
  }
  const out = Number(scaled) / 100;
  return neg ? -out : out;
}

function frexpBig(x: number): [bigint, number] {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const expo = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & 0xfffffffffffffn;
  if (expo === 0) return [frac, -1074];
  return [frac | 0x10000000000000n, expo - 1075];
}
