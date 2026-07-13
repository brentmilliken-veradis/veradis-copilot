// Beta sampler for the per-quadrant posteriors (§7.2). Beta(a,b) = X/(X+Y) with
// X~Gamma(a), Y~Gamma(b); Gamma via Marsaglia–Tsang (2000), which needs only a
// normal + a uniform per attempt and is numerically robust.
//
// NOTE (E5 checkpoint): Method v21 §7.3 names Cheng's BB/BC beta sampler for
// cross-language NumPy parity. This uses Marsaglia–Tsang instead — equally
// deterministic (the hard §3 requirement), but its exact bit-stream differs from
// NumPy. Bit-parity with a NumPy reference is unverified and flagged for the
// Head-of-Intelligence sign-off after E5.

import type { Pcg64 } from "./rng";

/** Gamma(shape, 1) via Marsaglia–Tsang; boosts shape<1 by the standard trick. */
export function sampleGamma(rng: Pcg64, shape: number): number {
  if (shape <= 0) return 0;
  if (shape < 1) {
    const g = sampleGamma(rng, shape + 1);
    const u = Math.max(rng.nextDouble(), 1e-12);
    return g * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bounded attempts — the acceptance rate is high, but never loop forever.
  for (let i = 0; i < 1000; i++) {
    let x: number;
    let v: number;
    do {
      x = rng.nextNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.nextDouble();
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // fallback (mean) — effectively unreachable
}

/** Beta(a, b) in [0, 1]. */
export function sampleBeta(rng: Pcg64, a: number, b: number): number {
  const x = sampleGamma(rng, a);
  const y = sampleGamma(rng, b);
  const s = x + y;
  if (s <= 0) return 0.5;
  return x / s;
}
