// POST /api/v1/curator — a curator confirms / downgrades / withholds a report.
// Calls the tested confirmReport domain logic against the app store.

import { getStore } from "@/app/lib/store";
import { confirmReport } from "@/packages/curator/confirm";
import type { CredentialClass, CuratorVerb, Tier } from "@/packages/pcs-types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    reportId?: string;
    curator?: string;
    credentialClass?: CredentialClass;
    verb?: CuratorVerb;
    downgradeTo?: Tier;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.reportId || !body.verb) {
    return Response.json({ error: "reportId and verb are required" }, { status: 400 });
  }

  const { repo } = await getStore();
  try {
    const res = await confirmReport(repo, {
      reportId: body.reportId,
      curator: body.curator ?? "Curator",
      credentialClass: body.credentialClass ?? "curator",
      verb: body.verb,
      downgradeTo: body.downgradeTo,
    });
    return Response.json({
      report: res.report,
      action: res.action,
      version: res.version ? { v: res.version.v, tier: res.version.tier } : null,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
