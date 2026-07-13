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

  // Immutable, signed, credentialed record of the human decision.
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
  const prevSnap = provisional.snapshotJson;
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
