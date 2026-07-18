// Pipeline orchestrator — wires the stages into one run (E2→E5) and assembles the
// provisional report a curator confirms in E7. This is the job the per-order
// Vercel background function drives (BUILD-KICKOFF §2).
//
//   intake (E2) → ingest+mislabel (E3) → enrich (E4) → score (E5)
//     → assemble snapshot → seal v1 → persist → paid → provisional/unscored/withheld

import type {
  CategoryProfile,
  Correction,
  PcsScore,
  Report,
  ReportSnapshot,
  ReportVersion,
  SnapshotCheck,
  SnapshotCitation,
  SnapshotEvidence,
  Valuation,
} from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import type { Storage } from "@/packages/adapters/storage";
import type { VisionAdapter } from "@/packages/adapters/vision";
import type { SourceAdapter } from "@/packages/adapters/source";
import type { EmbeddingAdapter } from "@/packages/adapters/embedding";
import type { GraphAdapter } from "@/packages/adapters/graph";
import type { SanctionsAdapter } from "@/packages/adapters/sanctions";
import type { NarrativeAdapter } from "@/packages/adapters/narrative";
import { listStubbed, type StubFlag } from "@/packages/adapters/stub-registry";
import { capTier } from "./cap";
import { intakeOrder } from "@/packages/intake/intake";
import type { OrderIntake } from "@/packages/intake/types";
import { ingest } from "@/packages/ingestion/ingest";
import { enrich } from "@/packages/enrichment/enrich";
import { scorePcs } from "@/packages/pcs-core";
import { statusForTier, assertTransition } from "@/packages/orchestrator/state";
import { sealVersion } from "@/packages/report/version";

export interface PipelineAdapters {
  vision: VisionAdapter;
  sources: SourceAdapter[];
  embedder: EmbeddingAdapter;
  graph: GraphAdapter;
  sanctions: SanctionsAdapter;
  narrative: NarrativeAdapter;
}

export interface PipelineResult {
  report: Report;
  version: ReportVersion;
  snapshot: ReportSnapshot;
  /** The PRESENTED score — tier capped for uncalibrated/vision-reroute (F-1/F-2). */
  score: PcsScore;
  /** The RAW deterministic score before any cap. Equals `score` when uncapped;
   *  on a capped report it exposes the tier the scorer actually produced, so
   *  the cap is auditable and provably load-bearing. */
  rawScore: PcsScore;
  corrections: Correction[];
  profile: CategoryProfile;
  /** External adapters that ran as stubs (and the env key each needs). */
  stubs: StubFlag[];
}

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function assembleSnapshot(
  repo: Repository,
  report: Report,
  profile: CategoryProfile,
  declaredAttributes: Record<string, string>,
  resolvedAttributes: Record<string, string>,
  score: PcsScore,
  valuation: Valuation | undefined,
  narrativeSections: ReportSnapshot["narrative"],
  capReason: ReportSnapshot["capReason"],
): Promise<ReportSnapshot> {
  const labels = new Map(profile.identityKeys.map((k) => [k.key, k.label]));
  const citations = await repo.listCitations(report.id);
  const citationById = new Map(citations.map((c) => [c.id, c]));

  const evidence: SnapshotEvidence[] = (await repo.listEvidence(report.id)).map((e) => ({
    slot: e.slot,
    kind: e.kind,
    sha256: e.sha256,
    c2paState: e.c2paState,
  }));
  const checks: SnapshotCheck[] = (await repo.listChecks(report.id)).map((c) => ({
    quadrant: c.quadrant,
    key: c.key,
    label: labels.get(c.key) ?? humanize(c.key),
    result: c.result,
    authorityState: c.authorityState,
    sourceName: c.sourceId ? citationById.get(c.sourceId)?.name : undefined,
    note: c.note ?? undefined,
  }));
  const snapCitations: SnapshotCitation[] = citations.map((c) => ({
    name: c.name,
    url: c.url ?? undefined,
    retrievalState: c.retrievalState,
    tier: c.tier,
  }));
  const corrections = (await repo.listCorrections(report.id)).map((c) => ({
    claimed: c.claimed,
    evidence: c.evidence,
    correctedValue: c.correctedValue,
    kindnessNote: c.kindnessNote,
  }));

  return {
    reportId: report.id,
    objectId: report.objectId,
    snapshotTs: report.createdAt,
    category: report.category,
    v: 1,
    methodVersion: "v21",
    meta: {
      effectiveDate: report.createdAt.slice(0, 10),
      ownerLocale: "en-CA",
      currency: valuation?.currency ?? "CAD",
      basis: "Documentary",
    },
    object: {
      title: resolvedAttributes.title ?? `${resolvedAttributes.year ?? ""} ${resolvedAttributes.denomination ?? report.category}`.trim(),
      ownerFacingName: report.objectId,
      declaredAttributes,
      resolvedAttributes,
    },
    evidence,
    checks,
    citations: snapCitations,
    corrections,
    score,
    valuation,
    narrative: narrativeSections,
    provisional: true,
    // Included only when capped, so calibrated-category hashes are unchanged.
    ...(capReason ? { capReason } : {}),
  };
}

export async function runProvisional(
  repo: Repository,
  storage: Storage,
  adapters: PipelineAdapters,
  order: OrderIntake,
  /** Optional overrides. `profile` pins/overrides the category profile the
   *  order is scored against (version pin / test seam); defaults to the
   *  registry profile. Production ships every category `provisional`. */
  opts: { profile?: CategoryProfile } = {},
): Promise<PipelineResult> {
  // E2 — intake (report becomes paid)
  const intake = await intakeOrder(repo, storage, order, opts.profile);

  // E3 — ingestion + mislabel correction + C2PA gate
  const ing = await ingest(repo, adapters.vision, {
    report: intake.report,
    profile: intake.profile,
    declaredAttributes: order.declaredAttributes,
    evidence: intake.evidence.map((e) => ({ id: e.id, slot: e.slot, sha256: e.sha256, storagePath: e.storagePath })),
  });

  // E4 — enrichment → ScoreInputs
  const enr = await enrich(
    repo,
    { sources: adapters.sources, embedder: adapters.embedder, graph: adapters.graph, sanctions: adapters.sanctions },
    {
      report: ing.report,
      profile: ing.profile,
      declaredAttributes: ing.declaredAttributes,
      resolvedAttributes: ing.resolvedAttributes,
      redFlags: ing.redFlags,
    },
  );

  // E5 — deterministic score
  const score = scorePcs(enr.scoreInputs);

  // F-1 (D-1): an uncalibrated category can never present a confident tier.
  // F-2 (D-2): a vision-only category re-route can never seal a tier either.
  // Both cap the PRESENTED tier only — composite/CI are the scorer's, untouched.
  const calibration = ing.profile.calibration ?? "provisional";
  const capReason: ReportSnapshot["capReason"] = ing.rerouted
    ? "vision_reroute"
    : calibration === "provisional"
      ? "uncalibrated_category"
      : undefined;
  const presented: PcsScore = capReason ? { ...score, tier: capTier(score.tier, "provisional") } : score;

  // Narrative (prose only — never the number). A capped result uses the
  // bronze register ("material gaps, disclosed") — the flagged register claims
  // identity-mismatch evidence, which a calibration cap has not established.
  const narrativeTier = capReason && presented.tier === "flagged" && score.tier !== "flagged" ? "bronze" : presented.tier;
  const narrative = await adapters.narrative.draft({
    title: order.ownerFacingName ?? ing.report.objectId,
    category: ing.report.category,
    resolvedAttributes: ing.resolvedAttributes,
    tier: narrativeTier,
    corrections: ing.corrections.map((c) => ({ claimed: c.claimed, correctedValue: c.correctedValue })),
  });

  // F-8 (D-3): the engine NEVER synthesises a valuation band. A provisional
  // Appraise carries no number — the indicative band is expert-set at curator
  // confirm and rendered under the honesty ceiling.
  const valuation: Valuation | undefined =
    order.sku === "appraise"
      ? {
          currency: order.currency ?? "CAD",
          comps: [],
          factors: [],
          actions: [{ rank: 1, action: "Supply comparable-sale evidence to tighten the valuation", expectedBandEffect: "Narrows the FMV band" }],
          marketInterest: "modest",
        }
      : undefined;

  const snapshot0 = await assembleSnapshot(
    repo,
    ing.report,
    ing.profile,
    ing.declaredAttributes,
    ing.resolvedAttributes,
    presented,
    valuation,
    narrative,
    capReason,
  );
  const sealed = sealVersion(snapshot0); // v1, no predecessor

  const version = await repo.addReportVersion({
    reportId: ing.report.id,
    v: 1,
    snapshotJson: sealed,
    snapshotSha256: sealed.snapshotSha256!,
    supersedesSha256: null,
    tier: presented.tier,
    composite: presented.composite,
    ciLo: presented.ci.lo,
    ciHi: presented.ci.hi,
    pdfPath: null,
  });

  // paid → provisional | unscored | withheld
  const nextStatus = statusForTier(presented.tier);
  assertTransition(ing.report.status, nextStatus);
  const updated = await repo.updateReport(ing.report.id, { status: nextStatus, currentVersion: 1 });

  return {
    report: updated,
    version,
    snapshot: sealed,
    score: presented,
    rawScore: score,
    corrections: ing.corrections,
    profile: ing.profile,
    stubs: listStubbed(),
  };
}
