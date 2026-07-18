// Tally intake flow — signature, parsing, dedupe, HEIC normalisation, and the
// EMAIL A/B/C ladder across intake → provisional → curator confirmation.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTallySignature, parseTallySubmission, type TallyWebhookPayload } from "./tally";
import { fetchPhotos } from "@/packages/adapters/photos";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";
import { StubEmailer } from "@/packages/adapters/email";
import { sendReceived, sendCuratorReview, sendDefinitive } from "@/packages/notify/emails";
import { runProvisional, type PipelineAdapters } from "@/packages/pipeline/run";
import { confirmReport } from "@/packages/curator/confirm";
import { getVisionAdapter } from "@/packages/adapters/vision";
import { pcgsAdapter, numistaAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { StubNarrativeAdapter } from "@/packages/adapters/narrative";
import { loadProfile } from "@/packages/profiles/loader";
import type { CategoryProfile } from "@/packages/pcs-types";

const SECRET = "tally-test-secret";

// The EMAIL-C ladder needs a confirmable (definitive-eligible) report; coins
// ships `provisional`, so this mechanism test runs against a calibrated profile
// override. No shipped category is calibrated (loader.test.ts guard).
const calibratedCoins: CategoryProfile = { ...loadProfile("coins"), calibration: "calibrated" };

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
}

function payload(): TallyWebhookPayload {
  return {
    eventId: "evt-1",
    eventType: "FORM_RESPONSE",
    data: {
      responseId: "resp-1",
      submissionId: "sub-001",
      formId: "form-1",
      formName: "Verify an object",
      createdAt: "2026-07-13T10:00:00Z",
      fields: [
        { key: "q1", label: "Your name", type: "INPUT_TEXT", value: "Margaret Chen" },
        { key: "q2", label: "Email", type: "INPUT_EMAIL", value: "margaret@example.com" },
        {
          key: "q3",
          label: "Object category",
          type: "MULTIPLE_CHOICE",
          value: ["opt-coin"],
          ...{ options: [{ id: "opt-coin", text: "Coin or coin set" }] },
        },
        { key: "q4", label: "Service", type: "MULTIPLE_CHOICE", value: "Appraise (CHF 40)" },
        { key: "q5", label: "Country", type: "INPUT_TEXT", value: "Canada" },
        { key: "q6", label: "Year", type: "INPUT_TEXT", value: "2007" },
        {
          key: "q7",
          label: "Photos",
          type: "FILE_UPLOAD",
          value: [
            { name: "front.heic", url: "https://tally.example/front.heic", mimeType: "image/heic" },
            { name: "back.jpg", url: "https://tally.example/back.jpg", mimeType: "image/jpeg" },
          ],
        },
      ],
    },
  };
}

function adapters(): PipelineAdapters {
  return {
    vision: getVisionAdapter(),
    sources: [pcgsAdapter(), numistaAdapter()],
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(),
    sanctions: new StubSanctionsAdapter(),
    narrative: new StubNarrativeAdapter(),
  };
}

describe("Tally signature", () => {
  it("accepts a valid HMAC and rejects a tampered body", () => {
    const body = JSON.stringify(payload());
    expect(verifyTallySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyTallySignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyTallySignature(body, null, SECRET)).toBe(false);
    expect(verifyTallySignature(body, "not-base64-hmac", SECRET)).toBe(false);
  });
});

describe("Tally parsing", () => {
  it("extracts email, name, category, sku, attributes, photos", () => {
    const p = parseTallySubmission(payload());
    expect(p.submissionId).toBe("sub-001");
    expect(p.email).toBe("margaret@example.com");
    expect(p.ownerName).toBe("Margaret Chen");
    expect(p.category).toBe("coins");
    expect(p.sku).toBe("appraise");
    expect(p.declaredAttributes).toMatchObject({ country: "Canada", year: "2007" });
    expect(p.photos).toHaveLength(2);
  });

  it("rejects a submission without photos", () => {
    const p = payload();
    p.data.fields = p.data.fields.filter((f) => f.type !== "FILE_UPLOAD");
    expect(() => parseTallySubmission(p)).toThrow(/no photos/);
  });
});

describe("photo normalisation", () => {
  it("converts HEIC to JPEG and passes JPEG through untouched", async () => {
    const heicBytes = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 1, 2, 3]);
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6]);
    const converted = new Uint8Array([0xff, 0xd8, 9, 9]);
    const fetcher = async (url: string) => (url.endsWith(".heic") ? heicBytes : jpegBytes);
    const converter = async () => converted;

    const out = await fetchPhotos(parseTallySubmission(payload()).photos, fetcher, converter);
    expect(out[0].filename).toBe("front.jpg");
    expect(out[0].bytes).toBe(converted);
    expect(out[1].filename).toBe("back.jpg");
    expect(out[1].bytes).toBe(jpegBytes);
  });
});

describe("intake → provisional → definitive email ladder", () => {
  it("sends EMAIL A on receipt, EMAIL B on provisional, EMAIL C on confirmation", async () => {
    const repo = new InMemoryRepository();
    const emailer = new StubEmailer();
    const parsed = parseTallySubmission(payload());

    // dedupe key behaviour
    const order = await repo.createOrder({
      id: `ord-${parsed.submissionId}`,
      tallySubmissionId: parsed.submissionId,
      email: parsed.email,
      ownerName: parsed.ownerName,
      category: parsed.category,
      sku: parsed.sku,
    });
    expect(await repo.getOrderByTallySubmission("sub-001")).not.toBeNull();
    expect(await repo.getOrderByTallySubmission("sub-999")).toBeNull();

    // EMAIL A
    await sendReceived(repo, emailer, order, null);
    expect(emailer.sent[0].to).toBe("margaret@example.com");
    expect(emailer.sent[0].subject).toMatch(/verification in progress/);

    // pipeline → provisional, EMAIL B
    const fetcher = async () => new Uint8Array([0xff, 0xd8, 1, 2, 3]);
    const photos = await fetchPhotos(parsed.photos, fetcher, async (b) => b);
    const result = await runProvisional(repo, new StubStorage(), adapters(), {
      orderId: order.id,
      category: order.category,
      sku: order.sku,
      declaredAttributes: parsed.declaredAttributes,
      ownerFacingName: parsed.ownerName ?? undefined,
      photos,
    }, { profile: calibratedCoins });
    expect(result.report.status).toBe("provisional");
    await sendCuratorReview(repo, emailer, order, result.report.id, result.score.tier);
    expect(emailer.sent[1].subject).toMatch(/Review needed/);

    // curator confirms → definitive, EMAIL C
    const confirmed = await confirmReport(repo, {
      reportId: result.report.id,
      curator: "Test Curator",
      credentialClass: "curator",
      verb: "confirmed",
    });
    expect(confirmed.report.status).toBe("definitive");
    await sendDefinitive(repo, emailer, order, result.report.id);
    expect(emailer.sent[2].to).toBe("margaret@example.com");
    expect(emailer.sent[2].text).toContain(`/report/${result.report.id}`);

    // audit trail: A, B, C all recorded against the order
    const log = await repo.listEmails(order.id);
    expect(log.map((e) => e.kind)).toEqual(["received", "curator_review", "definitive"]);
  });
});
