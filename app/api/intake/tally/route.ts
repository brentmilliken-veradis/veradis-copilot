// POST /api/intake/tally — the front door. Verifies the Tally signature,
// dedupes on submissionId, creates the order, and returns 200 fast; the heavy
// work (photo download, HEIC→JPEG, hashing, the E2→E6 provisional pipeline,
// EMAIL A and EMAIL B) runs after the response via next/server `after()`.
// Report lifecycle: the diagram's "received" is `created` here — intakeOrder
// moves it created → paid → provisional per the orchestrator state machine.

import { after } from "next/server";
import { getStore } from "@/app/lib/store";
import { verifyTallySignature, parseTallySubmission, type TallyWebhookPayload } from "@/packages/intake/tally";
import { fetchPhotos } from "@/packages/adapters/photos";
import { runProvisional } from "@/packages/pipeline/run";
import { sendReceived, sendCuratorReview } from "@/packages/notify/emails";
import { markStubbed } from "@/packages/adapters/stub-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();

  // 1 — signature. Without the secret we accept but mark the gap (dev only).
  const secret = process.env.TALLY_SIGNING_SECRET;
  if (secret) {
    if (!verifyTallySignature(rawBody, request.headers.get("tally-signature"), secret)) {
      return Response.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    markStubbed("tally-signature", "TALLY_SIGNING_SECRET", "webhook accepted unverified");
  }

  let payload: TallyWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (payload.eventType && payload.eventType !== "FORM_RESPONSE") {
    return Response.json({ ok: true, ignored: payload.eventType });
  }

  let parsed;
  try {
    parsed = parseTallySubmission(payload);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }

  const { repo, storage, emailer, adapters } = await getStore();

  // 2 — dedupe. Tally retries webhooks; the submissionId is the idempotency key.
  const existing = await repo.getOrderByTallySubmission(parsed.submissionId);
  if (existing) {
    return Response.json({ ok: true, deduped: true, orderId: existing.id });
  }

  const order = await repo.createOrder({
    id: `ord-${parsed.submissionId}`,
    tallySubmissionId: parsed.submissionId,
    email: parsed.email,
    ownerName: parsed.ownerName,
    category: parsed.category,
    sku: parsed.sku,
  });

  // 3 — respond fast; pipeline + emails continue after the response is sent.
  after(async () => {
    try {
      await sendReceived(repo, emailer, order, null); // EMAIL A — before the heavy work
      const photos = await fetchPhotos(parsed.photos);
      const result = await runProvisional(repo, storage, adapters, {
        orderId: order.id,
        category: order.category,
        sku: order.sku,
        declaredAttributes: parsed.declaredAttributes,
        ownerFacingName: parsed.ownerName ?? undefined,
        photos,
      });
      if (result.report.status === "provisional") {
        await sendCuratorReview(repo, emailer, order, result.report.id, result.score.tier); // EMAIL B
      }
    } catch (e) {
      // The order row survives; a re-delivered webhook is deduped, so recovery
      // is manual replay. Log loudly — this is the failure a curator must see.
      console.error(`intake pipeline failed for ${order.id}:`, e);
    }
  });

  return Response.json({ ok: true, orderId: order.id });
}
