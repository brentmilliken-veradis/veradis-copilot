// POST /api/intake/veradis — the live-store front door (E-C). The verify-store
// stripe-webhook (kind=`report`), after inserting the veradis-accounts reports
// row, POSTs a signed payload here. We verify the shared-secret signature,
// dedupe on the accounts report id, create the order, and return 200 fast; the
// heavy work (photo download from veradis-accounts storage, HEIC→JPEG, the
// E2→E6 provisional pipeline, EMAIL B) runs after the response via `after()`.
// No EMAIL A here — the store's own webhook already told the collector the
// report is in production.

import { after } from "next/server";
import { getStore } from "@/app/lib/store";
import {
  VERADIS_SIGNATURE_HEADER,
  parseVeradisIntake,
  toOrderIntake,
  verifyVeradisSignature,
  type VeradisIntakePayload,
} from "@/packages/intake/veradis";
import type { PhotoInput } from "@/packages/intake/types";
import { normalizePhoto } from "@/packages/adapters/photos";
import { getAccountsClient } from "@/packages/adapters/accounts";
import { deliverReport } from "@/packages/delivery/bridge";
import { runProvisional } from "@/packages/pipeline/run";
import { sendCuratorReview } from "@/packages/notify/emails";
import { markStubbed } from "@/packages/adapters/stub-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();

  // 1 — signature. Without the secret we accept but mark the gap (dev only).
  const secret = process.env.VERADIS_INTAKE_SIGNING_SECRET;
  if (secret) {
    if (!verifyVeradisSignature(rawBody, request.headers.get(VERADIS_SIGNATURE_HEADER), secret)) {
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    markStubbed("veradis-signature", "VERADIS_INTAKE_SIGNING_SECRET", "webhook accepted unverified");
  }

  let payload: VeradisIntakePayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseVeradisIntake(payload);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }

  const { repo, storage, emailer, adapters } = await getStore();

  // 2 — dedupe. Stripe retries webhooks; the accounts report id is the key.
  const dedupeKey = `veradis:${parsed.reportId}`;
  const existing = await repo.getOrderByTallySubmission(dedupeKey);
  if (existing) {
    return Response.json({ ok: true, deduped: true, orderId: existing.id });
  }

  const order = await repo.createOrder({
    id: parsed.reportId, // = veradis-accounts reports.id (E-D write-back target)
    tallySubmissionId: dedupeKey,
    email: parsed.email,
    ownerName: parsed.ownerName,
    category: parsed.category,
    sku: parsed.sku,
  });

  // 3 — respond fast; pipeline + curator email continue after the response.
  after(async () => {
    try {
      const accounts = getAccountsClient();
      if (!accounts) {
        throw new Error("VERADIS_ACCOUNTS_URL / VERADIS_ACCOUNTS_SERVICE_ROLE_KEY not set — cannot fetch object photos");
      }
      const photos: PhotoInput[] = [];
      for (const path of parsed.photoPaths) {
        const bytes = await accounts.downloadObjectPhoto(path);
        if (!bytes) {
          console.warn(`veradis intake ${order.id}: photo missing in accounts storage: ${path}`);
          continue;
        }
        photos.push(await normalizePhoto(path.split("/").pop() ?? "photo.jpg", bytes));
      }
      if (!photos.length) throw new Error("no photos could be downloaded from veradis-accounts");

      const result = await runProvisional(repo, storage, adapters, toOrderIntake(parsed, photos));

      // E-D — the provisional lands on the collector's object automatically.
      const delivery = await deliverReport(accounts, result.report, result.version);
      if (!delivery.delivered) {
        console.warn(`veradis intake ${order.id}: provisional not delivered — ${delivery.reason}`);
      }

      if (result.report.status === "provisional") {
        await sendCuratorReview(repo, emailer, order, result.report.id, result.score.tier); // EMAIL B
      }
    } catch (e) {
      // The order row survives; a re-delivered webhook is deduped, so recovery
      // is manual replay. Log loudly — this is the failure a curator must see.
      console.error(`veradis intake pipeline failed for ${order.id}:`, e);
    }
  });

  return Response.json({ ok: true, orderId: order.id });
}
