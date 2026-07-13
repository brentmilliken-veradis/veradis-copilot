// Confidence engine (Method v21 §7). Per-quadrant beta-binomial posteriors,
// composite via Monte-Carlo over a pinned-seed RNG. Deterministic: identical
// (objectId, snapshotTs) ⇒ identical CI.

import type { ConfidenceInterval } from "@/packages/pcs-types";
import { DRAWS, JEFFREYS, WEIGHTS } from "./constants";
import { Pcg64 } from "./rng";
import { sampleBeta } from "./gamma-beta";
import type { QuadrantRaw } from "./scorers";

export interface PosteriorParams {
  alpha: number;
  beta: number;
}

/** §7.2 — beta-binomial posterior for one quadrant. Material inflates variance
 *  by (1 + 2·missingWeight) while preserving the mean. */
export function quadrantPosterior(q: QuadrantRaw, scaleFactor: number, isMaterial: boolean): PosteriorParams {
  const effWeight = q.totalWeight > 0 ? q.totalWeight : 1;
  const nEff = effWeight * scaleFactor;
  const successes = (q.raw / 100) * nEff;
  const failures = nEff - successes;
  let alpha = JEFFREYS.alpha + successes;
  let beta = JEFFREYS.beta + failures;

  if (isMaterial && q.missingWeight > 0) {
    const inflation = 1 + 2 * q.missingWeight;
    const mu = alpha / (alpha + beta);
    const kappa = alpha + beta;
    const kappa2 = Math.max((kappa + 1) / inflation - 1, 1e-3);
    alpha = mu * kappa2;
    beta = (1 - mu) * kappa2;
  }
  return { alpha, beta };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const frac = pos - lo;
  if (lo + 1 >= sorted.length) return sorted[lo];
  return sorted[lo] + (sorted[lo + 1] - sorted[lo]) * frac; // linear interpolation (§7.3)
}

/** numpy pairwise summation (umath DOUBLE_pairwise_sum, block 128) — the exact
 *  accumulation np.mean uses; a sequential reduce rounds differently. */
function pairwiseSum(a: number[], lo: number, n: number): number {
  if (n < 8) {
    let res = 0;
    for (let i = lo; i < lo + n; i++) res += a[i];
    return res;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    }
    let res = (r[0] + r[1]) + (r[2] + r[3]) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum(a, lo, n2) + pairwiseSum(a, lo + n2, n - n2);
}

/** §7.3 — composite credible interval. Returns the MC mean + 95% bounds. */
export function compositeCI(
  posteriors: { identity: PosteriorParams; custody: PosteriorParams; material: PosteriorParams; risk: PosteriorParams },
  rng: Pcg64,
  draws = DRAWS,
): ConfidenceInterval {
  const samples = new Array<number>(draws);
  for (let i = 0; i < draws; i++) {
    const s =
      WEIGHTS.identity * sampleBeta(rng, posteriors.identity.alpha, posteriors.identity.beta) +
      WEIGHTS.custody * sampleBeta(rng, posteriors.custody.alpha, posteriors.custody.beta) +
      WEIGHTS.material * sampleBeta(rng, posteriors.material.alpha, posteriors.material.beta) +
      WEIGHTS.risk * sampleBeta(rng, posteriors.risk.alpha, posteriors.risk.beta);
    samples[i] = s * 100;
  }
  // Mean over the ORIGINAL draw order (np.mean semantics), then sort for quantiles.
  const mean = pairwiseSum(samples, 0, draws) / draws;
  samples.sort((a, b) => a - b);
  return { point: mean, lo: quantile(samples, 0.025), hi: quantile(samples, 0.975) };
}
