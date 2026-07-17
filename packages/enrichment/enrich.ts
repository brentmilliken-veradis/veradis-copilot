// Enrichment stage (E4). Resolves identity attributes against Tier-1 sources
// (ground truth), corroborates with the corpus + internal graph (never closes on
// them), screens Risk, and assembles the deterministic ScoreInputs the E5 scorer
// consumes. Also persists check_result + source_citation rows for the report.

import type {
  CategoryProfile,
  CustodyInput,
  IdentityCheckInput,
  MaterialCheckInput,
  Report,
  RiskEventInput,
  ScoreInputs,
  AuthorityState,
  CheckOutcome,
} from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import type { SourceAdapter } from "@/packages/adapters/source";
import { routeLookup } from "@/packages/adapters/source";
import type { EmbeddingAdapter } from "@/packages/adapters/embedding";
import { retrieveTopK } from "@/packages/adapters/embedding";
import type { GraphAdapter } from "@/packages/adapters/graph";
import type { SanctionsAdapter } from "@/packages/adapters/sanctions";
import type { VisionRedFlag } from "@/packages/adapters/vision";

const CORPUS_MATCH_THRESHOLD = 0.35;
// P2 (fix brief v04): a vision-ADDED value (the owner never declared this key)
// has no human assertion behind it — only the model's reading. It must clear a
// STRONGER corpus bar than a declared value before the corpus is allowed to
// corroborate it; a marginal cosine echo must not credit a model-originated
// attribute. Declared and vision-changed values keep the ordinary bar.
const VISION_ADDED_CORPUS_THRESHOLD = 0.6;

// CI scale factor (§7.2) — higher = data dominates the prior (tighter CI).
// Coins carry the richest machine-readable data (PCGS + Numista APIs, die-match),
// so they earn horology-grade confidence.
const SCALE_BY_CATEGORY: Record<string, number> = {
  watches: 10,
  coins: 10,
  cards: 10,
  medals: 5,
  silver: 5,
};

export interface EnrichAdapters {
  sources: SourceAdapter[];
  embedder: EmbeddingAdapter;
  graph: GraphAdapter;
  sanctions: SanctionsAdapter;
}

export interface EnrichInput {
  report: Report;
  profile: CategoryProfile;
  declaredAttributes: Record<string, string>;
  resolvedAttributes: Record<string, string>;
  redFlags: VisionRedFlag[];
  /** Optional fixture hints so a golden run can pin exact custody/material inputs. */
  custodyHint?: Partial<CustodyInput>;
  materialHint?: MaterialCheckInput[];
  parties?: string[];
}

export interface EnrichResult {
  report: Report;
  profile: CategoryProfile;
  scoreInputs: ScoreInputs;
}

/** Which coin/medal red flags are material-integrity problems. */
const MATERIAL_FLAGS = new Set(["cast_tooled", "altered_date", "cleaned_whizzed", "fake_slab", "renamed", "copy_striking"]);

export async function enrich(
  repo: Repository,
  adapters: EnrichAdapters,
  input: EnrichInput,
): Promise<EnrichResult> {
  const { report, profile, declaredAttributes, resolvedAttributes } = input;
  const correctedKeys = new Set(
    Object.keys(declaredAttributes).filter(
      (k) => resolvedAttributes[k] !== undefined && declaredAttributes[k] !== resolvedAttributes[k],
    ),
  );

  // ── Identity ────────────────────────────────────────────────────────────
  const normv = (v: string): string => v.trim().toLowerCase();

  // R-2 (fix brief v04): only CORROBORATED values may feed custody. Base set =
  // the owner's unchanged declarations; identity keys that earn Tier-1/corpus
  // credit are added in the loop below. A value that exists only because
  // vision changed or added it never reaches the graph cross-ref — F-2 closed
  // the identity channel, this closes the custody proxy.
  const corroboratedAttributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolvedAttributes)) {
    const declaredVal = declaredAttributes[k];
    if (declaredVal !== undefined && normv(declaredVal) === normv(v)) corroboratedAttributes[k] = v;
  }

  const identity: IdentityCheckInput[] = [];
  for (const idKey of profile.identityKeys) {
    const value = resolvedAttributes[idKey.key];
    const claimed = declaredAttributes[idKey.key];
    let authorityState: AuthorityState;
    let credit: number;
    let present: boolean;
    let result: CheckOutcome;
    let note: string | null = null;
    let citation: { name: string; url?: string; retrievalState: "retrieved" | "pending"; tier: 1 | 2 | 4 } | null;

    if (!value) {
      authorityState = "missing";
      credit = 0;
      present = false;
      result = "gap_held_open";
      note = "attribute not supplied";
      const t1 = adapters.sources.find((a) => a.tier === 1 && a.categories.includes(report.category));
      citation = t1 ? { name: t1.name, retrievalState: "pending", tier: 1 } : null;
    } else {
      const results = await routeLookup(adapters.sources, { key: idKey.key, value, category: report.category });
      const resolved = results.find((r) => r.matched && r.tier === 1);
      if (resolved) {
        authorityState = "resolved";
        credit = 1.0;
        present = true;
        result = correctedKeys.has(idKey.key) ? "corrected" : "match";
        citation = { name: resolved.name, url: resolved.url, retrievalState: "retrieved", tier: 1 };
        corroboratedAttributes[idKey.key] = value; // Tier-1 closed it (R-2)
      } else {
        // Corpus corroboration (Tier 2–3) — cite, never close. A vision-added
        // value (owner never declared this key) must clear the stronger bar.
        const visionAddedValue = claimed === undefined;
        const corpusBar = visionAddedValue ? VISION_ADDED_CORPUS_THRESHOLD : CORPUS_MATCH_THRESHOLD;
        const top = await retrieveTopK(repo, adapters.embedder, {
          category: report.category,
          query: `${idKey.key} ${value}`,
          k: 1,
        });
        if (top.length && top[0].score >= corpusBar) {
          authorityState = "corpus";
          credit = 0.5;
          present = true;
          result = correctedKeys.has(idKey.key) ? "corrected" : "consistent";
          const src = String(top[0].chunk.metadataJson.source ?? "corpus");
          citation = { name: src, retrievalState: "retrieved", tier: 2 };
          corroboratedAttributes[idKey.key] = value; // corpus corroborated (R-2)
        } else {
          // F-2 (D-2): vision may only downgrade. With neither Tier-1 nor
          // corpus corroboration, a value that exists only because vision
          // changed or supplied it is never scored ground truth:
          //  - vision CHANGED the declaration → assessed conflict, zero credit
          //    (lowers vs the declared-only 0.5 baseline);
          //  - vision ADDED a value the owner never declared → treated exactly
          //    like a missing attribute (cannot lift the score).
          const visionChanged = claimed !== undefined && normv(claimed) !== normv(value);
          const visionAdded = claimed === undefined;
          if (visionChanged) {
            authorityState = "declared";
            credit = 0;
            present = true;
            result = "corrected";
            note = "vision-derived value conflicts with the declaration and has no corroborating source — not credited";
            citation = { name: "Vision (uncorroborated)", retrievalState: "pending", tier: 4 };
          } else if (visionAdded) {
            authorityState = "declared";
            credit = 0;
            present = false;
            result = "gap_held_open";
            note = "vision-derived value has no corroborating source — held open, not credited";
            citation = { name: "Vision (uncorroborated)", retrievalState: "pending", tier: 4 };
          } else {
            authorityState = "declared";
            credit = 0.5;
            present = true;
            result = "observed";
            citation = { name: "Owner declaration", retrievalState: "retrieved", tier: 4 };
          }
        }
      }
    }

    const sourceRow = citation
      ? await repo.addCitation({
          reportId: report.id,
          name: citation.name,
          url: citation.url ?? null,
          retrievalState: citation.retrievalState,
          tier: citation.tier,
        })
      : null;
    await repo.addCheck({
      reportId: report.id,
      quadrant: "identity",
      key: idKey.key,
      result,
      authorityState,
      sourceId: sourceRow?.id ?? null,
      note,
    });
    identity.push({ key: idKey.key, weight: idKey.weight, credit, present, authorityState });
  }

  // ── Material ───────────────────────────────────────────────────────────
  let material: MaterialCheckInput[];
  if (input.materialHint) {
    material = input.materialHint;
  } else {
    const flagged = input.redFlags.filter((f) => MATERIAL_FLAGS.has(f.key));
    if (flagged.length) {
      material = flagged.map((f) => ({ key: f.key, weight: 1, consistency: "inconsistent" as const, present: true }));
    } else {
      // No forensic red flags → the material slot class reads consistent.
      material = [{ key: profile.materialSlotClass ?? "material", weight: 1, consistency: "consistent", present: true }];
    }
  }
  for (const m of material) {
    await repo.addCheck({
      reportId: report.id,
      quadrant: "material",
      key: m.key,
      result: m.present ? (m.consistency === "inconsistent" ? "flagged" : "consistent") : "gap_held_open",
      // Material is an in-hand observation, not an external authority resolution.
      authorityState: m.present ? "declared" : "missing",
      sourceId: null,
      note: null,
    });
  }

  // ── Custody (graph cross-ref raises coverage) ────────────────────────────
  // R-2: the cross-ref sees ONLY corroborated attributes — an uncorroborated
  // vision value can never lift coverage/eventCount (and so the composite)
  // through custody. resolvedAttributes stays as-is for display.
  const links = await adapters.graph.crossRef({
    objectId: report.objectId,
    category: report.category,
    attributes: corroboratedAttributes,
  });
  const baseCoverage = input.custodyHint?.coverage ?? 0.5;
  const coverage = Math.min(1, baseCoverage + links.reduce((a, l) => a + l.confidence * 0.1, 0));
  const custody: CustodyInput = {
    coverage,
    documentQuality: input.custodyHint?.documentQuality ?? 0.7,
    gaps: input.custodyHint?.gaps ?? [],
    // One trial per documented custody evidence item: the owner's declared
    // baseline plus each graph cross-ref link (Scenario B n_eff).
    eventCount: input.custodyHint?.eventCount ?? 1 + links.length,
  };
  for (const l of links) {
    const src = await repo.addCitation({
      reportId: report.id,
      name: l.institution,
      url: null,
      retrievalState: "retrieved",
      tier: 2,
    });
    await repo.addCheck({
      reportId: report.id,
      quadrant: "custody",
      key: l.relation,
      result: "consistent",
      authorityState: "corpus",
      sourceId: src.id,
      note: l.note ?? null,
    });
  }

  // ── Risk (sanctions + stolen registries; ALR off) ────────────────────────
  const riskEvents: RiskEventInput[] = await adapters.sanctions.check({
    parties: input.parties ?? [],
    objectId: report.objectId,
  });
  if (riskEvents.length) {
    for (const e of riskEvents) {
      await repo.addCheck({
        reportId: report.id,
        quadrant: "risk",
        key: e.kind,
        result: "flagged",
        authorityState: "resolved",
        sourceId: null,
        note: `${e.severity} severity`,
      });
    }
  } else {
    await repo.addCheck({
      reportId: report.id,
      quadrant: "risk",
      key: "registries",
      result: "match",
      authorityState: "resolved",
      sourceId: null,
      note: "no match in the named registries on the check date",
    });
  }

  const scoreInputs: ScoreInputs = {
    objectId: report.objectId,
    snapshotTs: report.createdAt,
    category: report.category,
    identity,
    custody,
    material,
    risk: riskEvents,
    alrEnabled: false, // D5: Risk capped at 90
    withheldDisclosure: false,
    scaleFactor: SCALE_BY_CATEGORY[report.category] ?? 5,
  };

  return { report, profile, scoreInputs };
}
