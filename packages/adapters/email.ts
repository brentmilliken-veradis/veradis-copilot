// Email adapter — how EMAIL A/B/C leave the system. Production is Resend
// (RESEND_API_KEY); until the key exists the stub keeps messages in memory and
// registers itself with the stub registry, per BUILD-KICKOFF §3.

import { markStubbed } from "./stub-registry";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SentEmail {
  providerId: string;
}

export interface Emailer {
  send(msg: EmailMessage): Promise<SentEmail>;
}

/** In-memory — backs tests and keyless dev runs. */
export class StubEmailer implements Emailer {
  readonly sent: EmailMessage[] = [];

  async send(msg: EmailMessage): Promise<SentEmail> {
    this.sent.push(msg);
    return { providerId: `stub-${this.sent.length}` };
  }
}

const FROM = process.env.EMAIL_FROM ?? "veradis.ai <reports@veradis.ai>";

/** Resend over plain fetch — no SDK dependency. */
export class ResendEmailer implements Emailer {
  constructor(private apiKey: string) {}

  async send(msg: EmailMessage): Promise<SentEmail> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { id: string };
    return { providerId: body.id };
  }
}

export function getEmailer(): Emailer {
  const key = process.env.RESEND_API_KEY;
  if (key) return new ResendEmailer(key);
  markStubbed("email", "RESEND_API_KEY", "customer + curator notifications stay in memory");
  return new StubEmailer();
}
