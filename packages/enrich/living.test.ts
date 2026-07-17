// R-3 — Enrich living-layer writer. A fake accounts surface records every
// write; the copilot side runs real stub adapters (narrative stub drafts the
// prose deterministically).

import { beforeEach, describe, expect, it } from "vitest";
import { parseTimelineDate, parseValuationBand, runEnrichmentJobs, type EnrichAccounts, type EnrichDeps } from "./living";
import type {
  AccountsEventInsert,
  AccountsJobRow,
  AccountsLinkInsert,
  AccountsObjectEnrichPatch,
  AccountsObjectRow,
  AccountsProfileRow,
  AccountsReportPatch,
  AccountsReportRow,
  AccountsValuationUpsert,
} from "@/packages/adapters/accounts";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";
import { StubEmailer } from "@/packages/adapters/email";
import { StubVisionAdapter } from "@/packages/adapters/vision";
import { pcgsAdapter, numistaAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { StubNarrativeAdapter } from "@/packages/adapters/narrative";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]);
const NOW = "2026-07-17T12:00:00.000Z";

class FakeAccounts implements EnrichAccounts {
  jobs: (AccountsJobRow & { started_at?: string; finished_at?: string })[] = [];
  queue: AccountsReportRow[] = [];
  objects = new Map<string, AccountsObjectRow>();
  profiles = new Map<string, AccountsProfileRow>();
  photos = new Map<string, Uint8Array>();
  appraisals: { object_id: string; valuation: string | null }[] = [];

  events: AccountsEventInsert[] = [];
  links: AccountsLinkInsert[] = [];
  objectPatches: { objectId: string; patch: AccountsObjectEnrichPatch }[] = [];
  valuations: AccountsValuationUpsert[] = [];
  jobPatches: { jobId: string; patch: Record<string, unknown> }[] = [];
  uploads: { reportId: string; html: string }[] = [];
  reportPatches: { reportId: string; patch: AccountsReportPatch }[] = [];

  async listQueuedJobs() {
    return this.jobs.filter((j) => j.status === "queued");
  }
  async updateJob(jobId: string, patch: { status: AccountsJobRow["status"]; started_at?: string; finished_at?: string; detail?: string }) {
    this.jobPatches.push({ jobId, patch });
    const j = this.jobs.find((x) => x.id === jobId);
    if (j) Object.assign(j, patch);
  }
  async claimJob(jobId: string, startedAt: string): Promise<boolean> {
    const j = this.jobs.find((x) => x.id === jobId);
    if (!j || j.status !== "queued") return false; // conditional PATCH semantics
    j.status = "running";
    j.started_at = startedAt;
    this.jobPatches.push({ jobId, patch: { status: "running", started_at: startedAt } });
    return true;
  }
  async listObjects(userId: string) {
    return [...this.objects.values()].filter((o) => o.user_id === userId);
  }
  async listDeliveredAppraisals() {
    return this.appraisals;
  }
  async insertEvent(e: AccountsEventInsert) {
    this.events.push(e);
  }
  async insertLink(l: AccountsLinkInsert) {
    this.links.push(l);
  }
  async updateObjectEnrich(objectId: string, _userId: string, patch: AccountsObjectEnrichPatch) {
    this.objectPatches.push({ objectId, patch });
  }
  async upsertValuation(v: AccountsValuationUpsert) {
    this.valuations.push(v);
  }
  async listInProductionReports(objectId?: string) {
    return this.queue.filter((r) => r.status === "in_production" && (!objectId || r.object_id === objectId));
  }
  async getObject(id: string) {
    return this.objects.get(id) ?? null;
  }
  async getProfile(id: string) {
    return this.profiles.get(id) ?? null;
  }
  async downloadObjectPhoto(path: string) {
    return this.photos.get(path) ?? null;
  }
  async getReport(reportId: string) {
    const row = this.queue.find((r) => r.id === reportId);
    return row ? { id: row.id, user_id: row.user_id, object_id: row.object_id, type: row.type, status: row.status } : null;
  }
  async uploadReportFile(userId: string, reportId: string, html: string) {
    this.uploads.push({ reportId, html });
    return `${userId}/${reportId}.html`;
  }
  async updateReport(reportId: string, patch: AccountsReportPatch) {
    this.reportPatches.push({ reportId, patch });
    const row = this.queue.find((r) => r.id === reportId);
    if (row) row.status = patch.status;
  }
}

function obj(id: string, over: Partial<AccountsObjectRow> = {}): AccountsObjectRow {
  return {
    id,
    user_id: "user-1",
    title: `Object ${id}`,
    maker: null,
    year: null,
    category: "Painting",
    notes: null,
    photo_paths: [],
    ...over,
  };
}

function deps(accounts: FakeAccounts): EnrichDeps {
  return {
    accounts,
    repo: new InMemoryRepository(),
    storage: new StubStorage(),
    emailer: new StubEmailer(),
    now: () => new Date(NOW),
    adapters: {
      vision: new StubVisionAdapter(),
      sources: [pcgsAdapter(), numistaAdapter()],
      embedder: new StubEmbeddingAdapter(),
      graph: new StubGraphAdapter(),
      sanctions: new StubSanctionsAdapter(),
      narrative: new StubNarrativeAdapter(),
    },
  };
}

describe("parse helpers", () => {
  it("parseTimelineDate finds the first plausible year", () => {
    expect(parseTimelineDate("c. 1927")).toBe("1927-01-01");
    expect(parseTimelineDate("1939")).toBe("1939-01-01");
    expect(parseTimelineDate("unknown")).toBeNull();
    expect(parseTimelineDate(null)).toBeNull();
  });

  it("parseValuationBand reads the bridge format and rejects empty bands", () => {
    expect(parseValuationBand("CAD 100–200")).toEqual({ currency: "CAD", lo: 100, hi: 200 });
    expect(parseValuationBand("CHF 50-80")).toEqual({ currency: "CHF", lo: 50, hi: 80 });
    expect(parseValuationBand("CAD 0–0")).toBeNull();
    expect(parseValuationBand("appraised")).toBeNull();
    expect(parseValuationBand(null)).toBeNull();
  });
});

describe("runEnrichmentJobs", () => {
  beforeEach(() => resetStubRegistry());

  it("first_pass: links same-maker objects, writes narratives + timeline, honest no-valuation", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a", { title: "Fishboats", maker: "E. J. Hughes", year: "1946" }));
    accounts.objects.set("b", obj("b", { title: "Beach at Savary", maker: "E. J. Hughes", year: "1952" }));
    accounts.objects.set("c", obj("c", { title: "Armoire", maker: "Unknown Atelier" }));
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: null, kind: "first_pass", status: "queued", detail: null });

    const summary = await runEnrichmentJobs(deps(accounts));

    expect(summary).toMatchObject({ polled: 1, done: 1, failed: 0 });
    // one same-maker edge, with its feed event
    expect(accounts.links).toHaveLength(1);
    expect(accounts.links[0]).toMatchObject({ from_object: "a", to_object: "b", relation: "same maker" });
    expect(accounts.events.filter((e) => e.type === "link_found")).toHaveLength(1);
    // narratives on all three, sourced from the catalogue entry
    const narrativePatches = accounts.objectPatches.filter((p) => p.patch.narrative_html);
    expect(narrativePatches).toHaveLength(3);
    expect(narrativePatches[0].patch.narrative_sources).toEqual(["Owner catalogue entry"]);
    expect(narrativePatches.find((p) => p.objectId === "a")?.patch.timeline_date).toBe("1946-01-01");
    expect(accounts.events.filter((e) => e.type === "narrative_added")).toHaveLength(3);
    // no delivered appraisals → NO valuation write, no value_changed event
    expect(accounts.valuations).toHaveLength(0);
    expect(accounts.events.some((e) => e.type === "value_changed")).toBe(false);
    // job lifecycle queued → running → done with detail
    const statuses = accounts.jobPatches.filter((p) => p.jobId === "job-1").map((p) => p.patch.status);
    expect(statuses).toEqual(["running", "done"]);
    expect(accounts.jobs[0].detail).toContain("no appraised values yet");
  });

  it("first_pass rolls delivered appraisal bands into collection_valuation", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a"));
    accounts.objects.set("b", obj("b"));
    accounts.appraisals.push({ object_id: "a", valuation: "CAD 100–200" }, { object_id: "b", valuation: "CAD 50–80" });
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: null, kind: "first_pass", status: "queued", detail: null });

    await runEnrichmentJobs(deps(accounts));

    expect(accounts.valuations).toEqual([
      { user_id: "user-1", low: 150, high: 280, currency: "CAD", basis: "full", updated_at: NOW },
    ]);
    expect(accounts.events.filter((e) => e.type === "value_changed")).toHaveLength(1);
  });

  it("F-11: mixed-currency appraisals subtotal the dominant currency only, basis partial + note", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a"));
    accounts.objects.set("b", obj("b"));
    accounts.objects.set("c", obj("c"));
    accounts.appraisals.push(
      { object_id: "a", valuation: "CAD 100–200" },
      { object_id: "b", valuation: "CAD 50–80" },
      { object_id: "c", valuation: "USD 1000–2000" },
    );
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: null, kind: "revalue", status: "queued", detail: null });

    await runEnrichmentJobs(deps(accounts));

    // Dominant currency (CAD, 2 bands) subtotalled; USD never added in.
    expect(accounts.valuations).toEqual([
      { user_id: "user-1", low: 150, high: 280, currency: "CAD", basis: "partial", updated_at: NOW },
    ]);
    const event = accounts.events.find((e) => e.type === "value_changed");
    expect(event?.body).toContain("USD");
    expect(accounts.jobs[0].detail).toContain("excluded currencies: USD");
  });

  it("revalue with a partial appraisal set writes basis=partial", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a"));
    accounts.objects.set("b", obj("b"));
    accounts.appraisals.push({ object_id: "a", valuation: "CHF 40–60" });
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: null, kind: "revalue", status: "queued", detail: null });

    await runEnrichmentJobs(deps(accounts));
    expect(accounts.valuations[0]).toMatchObject({ low: 40, high: 60, currency: "CHF", basis: "partial" });
  });

  it("narrative job targets one object; a missing object fails the job with detail", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a", { title: "Kurland plate", maker: "KPM Berlin", year: "c. 1900" }));
    accounts.jobs.push(
      { id: "job-1", user_id: "user-1", object_id: "a", kind: "narrative", status: "queued", detail: null },
      { id: "job-2", user_id: "user-1", object_id: "gone", kind: "narrative", status: "queued", detail: null },
    );

    const summary = await runEnrichmentJobs(deps(accounts));

    expect(summary).toMatchObject({ polled: 2, done: 1, failed: 1 });
    expect(accounts.objectPatches.filter((p) => p.patch.narrative_html)).toHaveLength(1);
    const failed = accounts.jobs.find((j) => j.id === "job-2");
    expect(failed?.status).toBe("failed");
    expect(failed?.detail).toMatch(/not found/);
  });

  it("reverify runs the pre-inserted in_production row through the report producer", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a", { title: "Fishboats", maker: "E. J. Hughes", photo_paths: ["user-1/f.jpg"] }));
    accounts.photos.set("user-1/f.jpg", JPEG);
    accounts.profiles.set("user-1", { id: "user-1", email: "c@example.com", full_name: null });
    accounts.queue.push({ id: "rep-9", user_id: "user-1", object_id: "a", type: "verify", status: "in_production" });
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: "a", kind: "reverify", status: "queued", detail: null });

    const summary = await runEnrichmentJobs(deps(accounts));

    expect(summary).toMatchObject({ done: 1, failed: 0 });
    expect(accounts.reportPatches[0]).toMatchObject({ reportId: "rep-9" });
    expect(accounts.reportPatches[0].patch.status).toBe("delivered");
    expect(accounts.events.some((e) => e.type === "value_changed" && e.object_id === "a")).toBe(true);
    expect(accounts.jobs[0].detail).toContain("rep-9: delivered");
  });

  it("reverify with no queued reports row fails honestly", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a"));
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: "a", kind: "reverify", status: "queued", detail: null });

    const summary = await runEnrichmentJobs(deps(accounts));
    expect(summary.failed).toBe(1);
    expect(accounts.jobs[0].detail).toMatch(/no in_production reports row/);
  });

  it("F-5b: two concurrent ticks over one queued job — one claims, one skips", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a", { title: "Kurland plate", maker: "KPM Berlin" }));
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: "a", kind: "narrative", status: "queued", detail: null });
    const d = deps(accounts);

    const [s1, s2] = await Promise.all([runEnrichmentJobs(d), runEnrichmentJobs(d)]);

    const all = [...s1.results, ...s2.results];
    expect(all.filter((r) => r.status === "done")).toHaveLength(1);
    expect(all.filter((r) => r.status === "skipped")).toHaveLength(1);
    // Exactly one narrative written, one narrative_added event.
    expect(accounts.objectPatches.filter((p) => p.patch.narrative_html)).toHaveLength(1);
    expect(accounts.events.filter((e) => e.type === "narrative_added")).toHaveLength(1);
  });

  it("F-4: reverify and narrative jobs on another tenant's object fail with no writes", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("theirs", obj("theirs", { user_id: "user-2", photo_paths: ["user-2/p.jpg"] }));
    accounts.photos.set("user-2/p.jpg", JPEG);
    accounts.queue.push({ id: "rep-x", user_id: "user-2", object_id: "theirs", type: "verify", status: "in_production" });
    accounts.jobs.push(
      { id: "job-1", user_id: "user-1", object_id: "theirs", kind: "reverify", status: "queued", detail: null },
      { id: "job-2", user_id: "user-1", object_id: "theirs", kind: "narrative", status: "queued", detail: null },
    );

    const summary = await runEnrichmentJobs(deps(accounts));

    expect(summary).toMatchObject({ polled: 2, done: 0, failed: 2 });
    for (const j of accounts.jobs) expect(j.detail).toMatch(/object\/owner mismatch/);
    expect(accounts.objectPatches).toHaveLength(0);
    expect(accounts.events).toHaveLength(0);
    expect(accounts.reportPatches).toHaveLength(0); // their report row untouched
  });

  it("F-10: relink on a NON-HEAD object links it to every other group member", async () => {
    const accounts = new FakeAccounts();
    accounts.objects.set("a", obj("a", { maker: "Omega" }));
    accounts.objects.set("b", obj("b", { maker: "Omega" }));
    accounts.objects.set("c", obj("c", { maker: "Omega" }));
    accounts.jobs.push({ id: "job-1", user_id: "user-1", object_id: "b", kind: "relink", status: "queued", detail: null });

    await runEnrichmentJobs(deps(accounts));
    expect(accounts.links.every((l) => l.from_object === "b")).toBe(true);
    // Both pairs, including the b→a (head) pair the old iteration missed.
    expect(accounts.links.map((l) => l.to_object).sort()).toEqual(["a", "c"]);
  });
});
