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
  score: PcsScore;
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
  };
}

export async function runProvisional(
  repo: Repository,
  storage: Storage,
  adapters: PipelineAdapters,
  order: OrderIntake,
): Promise<PipelineResult> {
  // E2 — intake (report becomes paid)
  const intake = await intakeOrder(repo, storage, order);

  // E3 — ingestion + mislabel correction + C2PA gate
  const ing = await ingest(repo, adapters.vision, {
    report: intake.report,
    profile: intake.profile,
    declaredAttributes: order.declaredAttributes,
    evidence: intake.evidence.map((e) => ({ id: e.id, slot: e.slot, sha256: e.sha256 })),
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

  // Narrative (prose only — never the number)
  const narrative = await adapters.narrative.draft({
    title: order.ownerFacingName ?? ing.report.objectId,
    category: ing.report.category,
    resolvedAttributes: ing.resolvedAttributes,
    tier: score.tier,
    corrections: ing.corrections.map((c) => ({ claimed: c.claimed, correctedValue: c.correctedValue })),
  });

  const valuation: Valuation | undefined =
    order.sku === "appraise"
      ? {
          currency: order.currency ?? "CAD",
          fmvLo: 0,
          fmvHi: 0,
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
    score,
    valuation,
    narrative,
  );
  const sealed = sealVersion(snapshot0); // v1, no predecessor

  const version = await repo.addReportVersion({
    reportId: ing.report.id,
    v: 1,
    snapshotJson: sealed,
    snapshotSha256: sealed.snapshotSha256!,
    supersedesSha256: null,
    tier: score.tier,
    composite: score.composite,
    ciLo: score.ci.lo,
    ciHi: score.ci.hi,
    pdfPath: null,
  });

  // paid → provisional | unscored | withheld
  const nextStatus = statusForTier(score.tier);
  assertTransition(ing.report.status, nextStatus);
  const updated = await repo.updateReport(ing.report.id, { status: nextStatus, currentVersion: 1 });

  return {
    report: updated,
    version,
    snapshot: sealed,
    score,
    corrections: ing.corrections,
    profile: ing.profile,
    stubs: listStubbed(),
  };
}
