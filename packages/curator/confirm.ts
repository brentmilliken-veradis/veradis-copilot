// Curator confirm → definitive (E7, gate ⑨). A curator confirms a provisional
// report; the action is immutable + signed + credentialed. Confirming (or a
// downgrade) mints a definitive version chained onto the provisional's hash and
// moves the report provisional → definitive. Withholding routes to the refund
// path. The critic/curator may only hold the line or step down — never inflate.

import type { CredentialClass, CuratorAction, CuratorVerb, ReportVersion, Report, Tier } from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import { assertTransition } from "@/packages/orchestrator/state";
import { sealVersion } from "@/packages/report/version";
import { applyCritic } from "@/packages/pcs-core";

export interface ConfirmInput {
  reportId: string;
  curator: string;
  credentialClass: CredentialClass;
  verb: CuratorVerb;
  /** For a downgrade, the (lower) tier to step to. */
  downgradeTo?: Tier;
  /** F-8 (D-3): the EXPERT-SET indicative band for an Appraise. The engine
   *  never invents one — this is the only way a number enters the report. */
  valuationBand?: { currency: string; lo: number; hi: number };
}

export interface ConfirmResult {
  report: Report;
  action: CuratorAction;
  /** The new definitive version, or null when withheld (no deliverable). */
  version: ReportVersion | null;
}

export async function confirmReport(repo: Repository, input: ConfirmInput): Promise<ConfirmResult> {
  const report = await repo.getReport(input.reportId);
  if (!report) throw new Error(`report ${input.reportId} not found`);
  if (report.status !== "provisional") {
    throw new Error(`report ${input.reportId} is ${report.status}, not provisional — nothing to confirm`);
  }
  const provisional = await repo.getLatestVersion(input.reportId);
  if (!provisional) throw new Error(`report ${input.reportId} has no version to confirm`);

  // R-6 (fix brief v04): validate ALL inputs BEFORE minting the immutable,
  // signed curator action — an invalid input must never leave an orphaned
  // audit row that a retry then duplicates.

  // F-1/F-2 gate (fix brief v03): a capped report — uncalibrated category or
  // vision-only re-route — can never seal a definitive tier. Withholding (the
  // refund/curator-mediated path) remains available.
  const prevSnap = provisional.snapshotJson;
  const capReason = prevSnap.capReason;
  if (capReason && input.verb !== "withheld") {
    throw new Error(
      `report ${input.reportId} is capped (${capReason}) — cannot confirm to definitive until the category is calibrated and the attribution corroborated`,
    );
  }

  // F-8: validate the expert-set indicative band (Appraise only, sane values)
  // and pre-compute the sealed valuation. Runs before addCuratorAction (R-6).
  let valuation = prevSnap.valuation;
  if (input.valuationBand) {
    const { currency, lo, hi } = input.valuationBand;
    if (!valuation) throw new Error("valuationBand supplied for a report with no Appraise valuation section");
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo || (lo === 0 && hi === 0)) {
      throw new Error("valuationBand must satisfy 0 ≤ lo ≤ hi and not be 0–0");
    }
    valuation = { ...valuation, currency, fmvLo: lo, fmvHi: hi };
  }

  // Inputs are valid — mint the immutable, signed, credentialed record.
  const action = await repo.addCuratorAction({
    reportId: report.id,
    curator: input.curator,
    action: input.verb,
    credentialClass: input.credentialClass,
  });

  // Withheld → refund path, no definitive deliverable.
  if (input.verb === "withheld") {
    assertTransition(report.status, "withheld");
    const updated = await repo.updateReport(report.id, { status: "withheld" });
    return { report: updated, action, version: null };
  }

  // Confirmed / downgraded → mint the definitive version.
  let tier = prevSnap.score.tier;
  if (input.verb === "downgraded" && input.downgradeTo) {
    tier = applyCritic(tier, input.downgradeTo); // never inflates
  }

  const nextV = provisional.v + 1;
  const sealed = sealVersion(
    {
      ...prevSnap,
      v: nextV,
      provisional: false,
      score: { ...prevSnap.score, tier },
      valuation,
      snapshotSha256: undefined,
      supersedesSha256: undefined,
    },
    provisional.snapshotSha256, // chain onto the provisional's hash
  );

  const version = await repo.addReportVersion({
    reportId: report.id,
    v: nextV,
    snapshotJson: sealed,
    snapshotSha256: sealed.snapshotSha256!,
    supersedesSha256: provisional.snapshotSha256,
    tier: sealed.score.tier,
    composite: sealed.score.composite,
    ciLo: sealed.score.ci.lo,
    ciHi: sealed.score.ci.hi,
    pdfPath: null,
  });

  assertTransition(report.status, "definitive");
  const updated = await repo.updateReport(report.id, { status: "definitive", currentVersion: nextV });
  return { report: updated, action, version };
}
