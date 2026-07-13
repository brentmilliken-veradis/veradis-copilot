// Gamma/Beta samplers — bit-exact port of NumPy 2.0.2
// numpy/random/src/distributions/distributions.c (random_standard_gamma,
// random_beta), per the Method v21 §7.3 contract ("as implemented in NumPy
// 1.17+ Generator.beta"). Gamma: Marsaglia–Tsang with ziggurat normals for
// shape > 1, exponential for shape == 1, and the GS rejection loop for
// shape < 1. Beta: Johnk when both parameters ≤ 1, else the gamma ratio.
// Parity is asserted against tests/golden/np-parity-vectors.json.

import type { Pcg64 } from "./rng";
import { fma } from "./fma";

const BETA_TINY_THRESHOLD = 3e-103;

/** numpy random_standard_gamma(shape). */
export function sampleGamma(rng: Pcg64, shape: number): number {
  if (shape === 1.0) return rng.nextExponential();
  if (shape === 0.0) return 0.0;
  if (shape < 1.0) {
    for (;;) {
      const U = rng.nextDouble();
      const V = rng.nextExponential();
      if (U <= 1.0 - shape) {
        const X = Math.pow(U, 1.0 / shape);
        if (X <= V) return X;
      } else {
        const Y = -Math.log((1 - U) / shape);
        const X = Math.pow(1.0 - shape + shape * Y, 1.0 / shape);
        if (X <= V + Y) return X;
      }
    }
  }
  const b = shape - 1.0 / 3.0;
  const c = 1.0 / Math.sqrt(9 * b);
  for (;;) {
    let X: number;
    let V: number;
    do {
      X = rng.nextNormal();
      // numpy's arm64 build contracts `1.0 + c * X` to fmadd — match it.
      V = fma(c, X, 1.0);
    } while (V <= 0.0);
    V = V * V * V;
    const U = rng.nextDouble();
    if (U < 1.0 - 0.0331 * (X * X) * (X * X)) return b * V;
    if (Math.log(U) < 0.5 * X * X + b * (1.0 - V + Math.log(V))) return b * V;
  }
}

/** numpy random_beta(a, b). */
export function sampleBeta(rng: Pcg64, a: number, b: number): number {
  if (a <= 1.0 && b <= 1.0) {
    if (a < BETA_TINY_THRESHOLD && b < BETA_TINY_THRESHOLD) {
      const U = rng.nextDouble();
      return (a + b) * U < a ? 1 : 0;
    }
    // Johnk's algorithm.
    for (;;) {
      const U = rng.nextDouble();
      const V = rng.nextDouble();
      const X = Math.pow(U, 1.0 / a);
      const Y = Math.pow(V, 1.0 / b);
      const XpY = X + Y;
      if (XpY <= 1.0 && U + V > 0.0) {
        if (XpY > 0) return X / XpY;
        let logX = Math.log(U) / a;
        let logY = Math.log(V) / b;
        const logM = logX > logY ? logX : logY;
        logX -= logM;
        logY -= logM;
        return Math.exp(logX - Math.log(Math.exp(logX) + Math.exp(logY)));
      }
    }
  }
  const Ga = sampleGamma(rng, a);
  const Gb = sampleGamma(rng, b);
  return Ga / (Ga + Gb);
}
