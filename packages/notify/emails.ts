// EMAIL A/B/C — the three notifications in the intake flow. Each send is
// recorded on the repository so the audit trail exists whether the emailer is
// live (Resend) or stubbed. Copy follows the brand voice: short declarative,
// UK English, honesty register, no hype vocabulary.

import type { Emailer } from "@/packages/adapters/email";
import type { Order, Repository } from "@/packages/data/repository";

const BASE_URL = () => process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
const CURATOR_INBOX = () => process.env.CURATOR_EMAIL ?? "curator@veradis.ai";

function greeting(order: Order): string {
  return order.ownerName ? `Dear ${order.ownerName},` : "Hello,";
}

/** EMAIL A → customer: submission received, work under way. */
export async function sendReceived(
  repo: Repository,
  emailer: Emailer,
  order: Order,
  reportId: string | null,
): Promise<void> {
  const subject = "We have your submission — verification in progress";
  const text = [
    greeting(order),
    "",
    "Your photos and object details arrived safely. Our verification pipeline is now at work: photo forensics, source checks, and a Provenance Confidence Score.",
    "",
    "A curator reviews every report before it reaches you. You will hear from us when your verified report is ready — typically within 48 hours.",
    "",
    `Order reference: ${order.id}`,
    "",
    "veradis.ai — AI generates. veradis verifies.",
  ].join("\n");
  const { providerId } = await emailer.send({ to: order.email, subject, text });
  await repo.recordEmail({ orderId: order.id, reportId, kind: "received", to: order.email, subject, providerId });
}

/** EMAIL B → curator (internal): a provisional report awaits review. */
export async function sendCuratorReview(
  repo: Repository,
  emailer: Emailer,
  order: Order,
  reportId: string,
  tier: string,
): Promise<void> {
  const subject = `Review needed — provisional report ${reportId} (${tier})`;
  const text = [
    "A report is ready for your review.",
    "",
    `Report: ${reportId}`,
    `Order: ${order.id} · ${order.category} · ${order.sku}`,
    `Provisional tier: ${tier}`,
    "",
    `Review and confirm: ${BASE_URL()}/curator/${reportId}`,
  ].join("\n");
  const { providerId } = await emailer.send({ to: CURATOR_INBOX(), subject, text });
  await repo.recordEmail({ orderId: order.id, reportId, kind: "curator_review", to: CURATOR_INBOX(), subject, providerId });
}

/** EMAIL C → customer: the curator-confirmed report, with its link. */
export async function sendDefinitive(
  repo: Repository,
  emailer: Emailer,
  order: Order,
  reportId: string,
): Promise<void> {
  const subject = "Your verified report is ready";
  const text = [
    greeting(order),
    "",
    "A curator has confirmed your report. It is now final.",
    "",
    `Read it here: ${BASE_URL()}/report/${reportId}`,
    "",
    "The report states what the evidence supports and what it does not. Where the data is thin, the confidence interval says so — that is by design.",
    "",
    "veradis.ai — AI generates. veradis verifies.",
  ].join("\n");
  const { providerId } = await emailer.send({ to: order.email, subject, text });
  await repo.recordEmail({ orderId: order.id, reportId, kind: "definitive", to: order.email, subject, providerId });
}
