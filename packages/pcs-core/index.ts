// @veradis/pcs-core — the deterministic PCS scorer (Method v21). Encodes §2–§10:
// quadrant scorers → composite → confidence interval → tier. The LLM never
// touches these numbers; two runs of the same (objectId, snapshotTs) are
// identical to the digit.

import type {
  FlaggedEvidenceBundle,
  FlaggedFinding,
  PcsScore,
  QuadrantScore,
  ScoreInputs,
} from "@/packages/pcs-types";
import { WEIGHTS } from "./constants";
import { seedFromObject, Pcg64 } from "./rng";
import { scoreCustody, scoreIdentity, scoreMaterial, scoreRisk, type QuadrantRaw } from "./scorers";
import { compositeCI, quadrantPosterior } from "./confidence";
import { sampleBeta } from "./gamma-beta";
import { isScoreable, mapToTier } from "./tier";

export * from "./constants";
export { Pcg64, seedFromObject } from "./rng";
export { scoreIdentity, scoreCustody, scoreMaterial, scoreRisk } from "./scorers";
export type { QuadrantRaw } from "./scorers";
export { mapToTier, isScoreable, applyCritic } from "./tier";

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface ComposeMeta {
  objectId: string;
  snapshotTs: string;
  scaleFactor: number;
  withheldDisclosure: boolean;
}

export interface Quadrants {
  identity: QuadrantRaw;
  custody: QuadrantRaw;
  material: QuadrantRaw;
  risk: QuadrantRaw;
}

function inferFinding(mat: QuadrantRaw, id: QuadrantRaw, risk: QuadrantRaw): FlaggedFinding {
  if (risk.flags.includes("COMPOSITE_OVERRIDE_FLAGGED")) return "mixed";
  const materialBad = mat.flags.includes("MATERIAL_INCONSISTENCY");
  const identityBad = id.raw < 50;
  if (materialBad && identityBad) return "counterfeit";
  if (materialBad) return "material_inconsistency";
  if (identityBad) return "identity_mismatch";
  return "mixed";
}

/** Compose the final score from four quadrant raws (§7–§8). Shared by scorePcs
 *  and the golden harness. Displayed composite is the deterministic algebraic
 *  weighted sum (§12); the CI width comes from the MC posteriors, recentred on
 *  that point so the point stays inside its interval. */
export function composeScore(q: Quadrants, meta: ComposeMeta): PcsScore {
  const composite = round2(
    WEIGHTS.identity * q.identity.raw +
      WEIGHTS.custody * q.custody.raw +
      WEIGHTS.material * q.material.raw +
      WEIGHTS.risk * q.risk.raw,
  );

  const { seed, hex } = seedFromObject(meta.objectId, meta.snapshotTs);
  const rng = new Pcg64(seed);
  const posteriors = {
    identity: quadrantPosterior(q.identity, meta.scaleFactor, false),
    custody: quadrantPosterior(q.custody, meta.scaleFactor, false),
    material: quadrantPosterior(q.material, meta.scaleFactor, true),
    risk: quadrantPosterior(q.risk, meta.scaleFactor, false),
  };
  const mc = compositeCI(posteriors, rng);
  const ci = {
    point: composite,
    lo: clamp(composite - (mc.point - mc.lo), 0, 100),
    hi: clamp(composite + (mc.hi - mc.point), 0, 100),
  };

  const scoreable = isScoreable({
    identity: q.identity.populated,
    custody: q.custody.populated,
    material: q.material.populated,
    risk: q.risk.populated,
  });
  const riskOverride = q.risk.flags.includes("COMPOSITE_OVERRIDE_FLAGGED");
  const tier = mapToTier({
    isScoreable: scoreable,
    withheldDisclosure: meta.withheldDisclosure,
    riskOverrideFlagged: riskOverride,
    ciLo: ci.lo,
  });

  const quadrants: QuadrantScore[] = [
    { quadrant: "identity", raw: round2(q.identity.raw), weightUsed: q.identity.totalWeight, ci: quadrantInterval(q.identity, meta, 0, false) },
    { quadrant: "custody", raw: round2(q.custody.raw), weightUsed: q.custody.totalWeight, ci: quadrantInterval(q.custody, meta, 1, false) },
    { quadrant: "material", raw: round2(q.material.raw), weightUsed: q.material.totalWeight, missingWeight: q.material.missingWeight, ci: quadrantInterval(q.material, meta, 2, true) },
    { quadrant: "risk", raw: round2(q.risk.raw), weightUsed: q.risk.totalWeight, ci: quadrantInterval(q.risk, meta, 3, false) },
  ];

  let flagged: FlaggedEvidenceBundle | undefined;
  if (tier === "flagged") {
    flagged = {
      finding: inferFinding(q.material, q.identity, q.risk),
      primarySources: [],
      supportingChecks: [],
      contradictions: [],
      appealWindowDays: 14,
      curatorContact: "appeals@veradis.ai",
    };
  }

  return { composite, ci, tier, quadrants, flagged, seedHex: hex, isScoreable: scoreable };
}

export function scorePcs(inputs: ScoreInputs): PcsScore {
  return composeScore(
    {
      identity: scoreIdentity(inputs.identity),
      custody: scoreCustody(inputs.custody),
      material: scoreMaterial(inputs.material),
      risk: scoreRisk(inputs.risk, inputs.alrEnabled),
    },
    {
      objectId: inputs.objectId,
      snapshotTs: inputs.snapshotTs,
      scaleFactor: inputs.scaleFactor,
      withheldDisclosure: inputs.withheldDisclosure,
    },
  );
}

/** Test/golden harness — compose a score straight from quadrant raw values
 *  (bypassing the quadrant scorers) to check §12 composite/tier/determinism. */
export function scoreFromRaws(
  raws: { identity: number; custody: number; material: number; risk: number },
  meta: ComposeMeta & { materialMissingWeight?: number; riskHighOverride?: boolean },
): PcsScore {
  const mk = (raw: number, flags: string[] = [], missingWeight = 0): QuadrantRaw => ({
    raw,
    totalWeight: 1,
    missingWeight,
    populated: true,
    flags,
  });
  return composeScore(
    {
      identity: mk(raws.identity),
      custody: mk(raws.custody),
      material: mk(raws.material, [], meta.materialMissingWeight ?? 0),
      risk: mk(raws.risk, meta.riskHighOverride ? ["COMPOSITE_OVERRIDE_FLAGGED"] : []),
    },
    meta,
  );
}

/** Per-quadrant CI, recentred on the quadrant raw, on an independent stream. */
function quadrantInterval(q: QuadrantRaw, meta: ComposeMeta, idx: number, isMaterial: boolean) {
  const { seed } = seedFromObject(meta.objectId, meta.snapshotTs);
  const rng = new Pcg64(seed ^ BigInt(idx + 1));
  const p = quadrantPosterior(q, meta.scaleFactor, isMaterial);
  const draws = 2000;
  const samples = new Array<number>(draws);
  for (let i = 0; i < draws; i++) samples[i] = sampleBeta(rng, p.alpha, p.beta) * 100;
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, x) => a + x, 0) / draws;
  const q025 = samples[Math.floor((draws - 1) * 0.025)];
  const q975 = samples[Math.floor((draws - 1) * 0.975)];
  return {
    point: round2(q.raw),
    lo: clamp(q.raw - (mean - q025), 0, 100),
    hi: clamp(q.raw + (q975 - mean), 0, 100),
  };
}
