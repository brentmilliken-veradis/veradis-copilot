// LIVE end-to-end driver (gated behind E2E=1 so it's out of the normal suite).
// Walks a real order through the orchestrator stage by stage with timing, writes
// the rendered reports to _e2e-out/, and prints the full result. HTTP routes only
// exist for the curator step; intake/enrich/score/render are driven directly.
//
//   E2E=1 npx vitest run tests/e2e-live.test.ts --disable-console-intercept

import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { intakeOrder } from "@/packages/intake/intake";
import type { OrderIntake, PhotoInput } from "@/packages/intake/types";
import { InMemoryRepository } from "@/packages/data/in-memory";
import type { RepoEnv } from "@/packages/data/repository";
import { StubStorage } from "@/packages/adapters/storage";
import { StubVisionAdapter } from "@/packages/adapters/vision";
import { pcgsAdapter, numistaAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { StubNarrativeAdapter } from "@/packages/adapters/narrative";
import { resetStubRegistry, listStubbed } from "@/packages/adapters/stub-registry";
import { ingest } from "@/packages/ingestion/ingest";
import { enrich } from "@/packages/enrichment/enrich";
import { scorePcs } from "@/packages/pcs-core";
import { statusForTier } from "@/packages/orchestrator/state";
import { renderReport } from "@/packages/report/render";
import { sealVersion } from "@/packages/report/version";
import { confirmReport } from "@/packages/curator/confirm";
import type { CategoryProfile, PcsScore, Report, ReportSnapshot, ScoreInputs, DeltaRow } from "@/packages/pcs-types";

const OUT = fileURLToPath(new URL("../_e2e-out/", import.meta.url));
const log = (...a: unknown[]) => console.log(...a);
const ms = (n: number) => `${n.toFixed(1)}ms`;

const CSS = `:root{--gold:#C9963B;--navy:#1B365D;--green:#2D6A4F;--parch:#FAF6EC;--obsidian:#1A1714}*{box-sizing:border-box}body{margin:0;background:#e9e4d6;font-family:Inter,system-ui,sans-serif;color:var(--obsidian);padding:32px}.pcs-report{max-width:820px;margin:0 auto;background:var(--parch);padding:40px 48px;box-shadow:0 8px 40px rgba(0,0,0,.12);border-radius:6px}h1{font-family:Georgia,serif;color:var(--navy);font-size:28px;margin:0 0 4px}h2{color:var(--navy);font-size:18px;border-bottom:2px solid var(--gold);padding-bottom:4px;margin-top:32px}h3{color:var(--green);font-size:15px;margin-top:20px}.owner{color:#6b6455}.meta p{font-size:12px;color:#6b6455}.watermark{background:var(--gold);color:#fff;text-align:center;padding:6px;font-weight:600;letter-spacing:.05em;border-radius:4px;margin-bottom:16px}.pcs-num{font-family:Georgia,serif;font-size:56px;color:var(--navy);font-weight:700}.pcs-ci{font-size:13px;color:#6b6455;margin-left:8px}.tier{font-weight:700;font-size:18px}.tier-gold .tier{color:var(--gold)}.tier-silver .tier{color:#8a8a8a}.lb{font-weight:400;font-size:12px;color:#6b6455}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd6c4}th{color:var(--navy);font-size:11px;text-transform:uppercase}.arith{font-family:monospace;font-size:12px;color:#6b6455}.delta{background:#fff;border-left:4px solid var(--gold);padding:8px 16px;border-radius:4px}.fmv{font-family:Georgia,serif;font-size:24px;color:var(--green)}code{font-family:monospace;font-size:11px;word-break:break-all}.verify{background:#fff;padding:12px;border-radius:4px}.qr{width:56px;height:56px;border:1px dashed #aaa;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#999}.liability,.repro,.falsif,.caveat{font-size:11px;color:#6b6455}footer{margin-top:32px;font-size:11px;color:#6b6455;text-align:center}`;
const wrap = (html: string, title: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>${html}</body></html>`;

const PHOTO_FILES = ["IMG_2348.jpg", "IMG_2349.jpg", "IMG_2350.jpg", "IMG_2351.jpg", "IMG_2352.jpg", "IMG_2353.jpg", "IMG_2354.jpg", "IMG_2355.jpg", "IMG_2356.jpg"];
function realPhotos(): PhotoInput[] {
  return PHOTO_FILES.map((file) => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(fileURLToPath(new URL(`../docs/fixtures/PCS-CA-2026-0007/${file}`, import.meta.url)));
    } catch {
      bytes = new TextEncoder().encode(file);
    }
    return { filename: file, bytes };
  });
}

const fixedEnv = (): RepoEnv => ({ now: () => "2026-07-13T12:00:00.000Z", id: () => randomUUID() });

const timings: { stage: string; ms: number }[] = [];
async function stage<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const t = performance.now();
  const r = await fn();
  timings.push({ stage: name, ms: performance.now() - t });
  return r;
}

function humanize(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function buildSnapshot(
  repo: InMemoryRepository, report: Report, profile: CategoryProfile,
  declared: Record<string, string>, resolved: Record<string, string>,
  score: PcsScore, narrative: ReportSnapshot["narrative"],
  opts: { v: number; provisional: boolean; supersedes?: string; delta?: DeltaRow[]; title: string },
): Promise<ReportSnapshot> {
  const labels = new Map(profile.identityKeys.map((k) => [k.key, k.label]));
  const cites = await repo.listCitations(report.id);
  const citeById = new Map(cites.map((c) => [c.id, c]));
  const snap: ReportSnapshot = {
    reportId: report.id, objectId: report.objectId, snapshotTs: report.createdAt,
    category: report.category, v: opts.v, methodVersion: "v21",
    meta: { effectiveDate: report.createdAt.slice(0, 10), ownerLocale: "en-CA", currency: "CAD", basis: "Documentary" },
    object: { title: opts.title, ownerFacingName: report.objectId, declaredAttributes: declared, resolvedAttributes: resolved },
    evidence: (await repo.listEvidence(report.id)).map((e) => ({ slot: e.slot, kind: e.kind, sha256: e.sha256, c2paState: e.c2paState })),
    checks: (await repo.listChecks(report.id)).map((c) => ({ quadrant: c.quadrant, key: c.key, label: labels.get(c.key) ?? humanize(c.key), result: c.result, authorityState: c.authorityState, sourceName: c.sourceId ? citeById.get(c.sourceId)?.name : undefined, note: c.note ?? undefined })),
    citations: cites.map((c) => ({ name: c.name, url: c.url ?? undefined, retrievalState: c.retrievalState, tier: c.tier })),
    corrections: (await repo.listCorrections(report.id)).map((c) => ({ claimed: c.claimed, evidence: c.evidence, correctedValue: c.correctedValue, kindnessNote: c.kindnessNote })),
    score, narrative, provisional: opts.provisional, delta: opts.delta,
  };
  return sealVersion(snap, opts.supersedes);
}

describe.runIf(process.env.E2E === "1")("LIVE end-to-end", () => {
  it("2007 RCM proof set — mislabelled → provisional → definitive → ladder", { timeout: 120000 }, async () => {
    mkdirSync(OUT, { recursive: true });
    resetStubRegistry();
    const repo = new InMemoryRepository(fixedEnv());
    const storage = new StubStorage();
    const vision = new StubVisionAdapter({ "coin-2007-mislabel": { derivedAttributes: { year: "2007" } } });
    const sources = [
      pcgsAdapter({ "year=2007": { matched: true, url: "https://pcgs.com/2007" }, "denomination=Proof Set": { matched: true } }),
      numistaAdapter({ "country=Canada": { matched: true }, "mint_mark=RCM": { matched: true } }),
    ];
    const enrichAdapters = { sources, embedder: new StubEmbeddingAdapter(), graph: new StubGraphAdapter(), sanctions: new StubSanctionsAdapter() };
    const narrator = new StubNarrativeAdapter();

    const order: OrderIntake = {
      orderId: "ORD-LIVE-001", objectId: "coin-2007-mislabel", category: "coins", sku: "appraise",
      declaredAttributes: { country: "Canada", denomination: "Proof Set", year: "2008", mint_mark: "RCM", variety: "Proof" },
      ownerFacingName: "2007 Royal Canadian Mint Proof Set", photos: realPhotos(),
    };

    log("\n================ LIVE E2E — order ORD-LIVE-001 ================");
    log(`Owner declared: year=${order.declaredAttributes.year} (WRONG — the set is 2007), mint=${order.declaredAttributes.mint_mark}`);

    // ── STAGE 1 · intake (orchestrator; no HTTP intake route) ──
    const intake = await stage("1 intake", () => intakeOrder(repo, storage, order));
    log(`\n[1] INTAKE  → report ${intake.report.id.slice(0, 8)} status=${intake.report.status}, ${intake.evidence.length} photos hashed, profile=${intake.profile.category}, coverage ${intake.coverage.covered}/${intake.coverage.required}`);

    // ── STAGE 2 · ingest + mislabel correction (BEFORE scoring) ──
    const ing = await stage("2 ingest+correct", () => ingest(repo, vision, {
      report: intake.report, profile: intake.profile, declaredAttributes: order.declaredAttributes,
      evidence: intake.evidence.map((e) => ({ id: e.id, slot: e.slot, sha256: e.sha256 })),
    }));
    log(`[2] INGEST  → C2PA checked; corrections=${ing.corrections.length}`);
    for (const c of ing.corrections) log(`    ⤷ CORRECTION FIRED: “${c.claimed}” → “${c.correctedValue}”  (${c.kindnessNote})`);
    log(`    resolved year is now ${ing.resolvedAttributes.year} (was declared ${order.declaredAttributes.year})`);

    // ── STAGE 3 · enrich (thin custody) ──
    const enr = await stage("3 enrich", () => enrich(repo, enrichAdapters, {
      report: ing.report, profile: ing.profile, declaredAttributes: ing.declaredAttributes,
      resolvedAttributes: ing.resolvedAttributes, redFlags: ing.redFlags,
      custodyHint: { coverage: 0.5, documentQuality: 0.7, gaps: [] },
    }));
    const idStates = enr.scoreInputs.identity.map((i) => `${i.key}:${i.authorityState}`).join(" ");
    log(`[3] ENRICH  → identity ${idStates}; scaleFactor=${enr.scoreInputs.scaleFactor}, ALR=${enr.scoreInputs.alrEnabled}`);

    // ── STAGE 4 · deterministic score ──
    const score = await stage("4 score", () => scorePcs(enr.scoreInputs));
    const q = (name: string) => score.quadrants.find((x) => x.quadrant === name)!.raw;
    log(`[4] SCORE   → PCS ${score.composite} · ${score.tier.toUpperCase()} · CI [${score.ci.lo.toFixed(1)}, ${score.ci.hi.toFixed(1)}]`);
    log(`    quadrants: Identity ${q("identity")} · Custody ${q("custody")} · Material ${q("material")} · Risk ${q("risk")}`);

    // ── STAGE 5 · narrative + assemble + render provisional ──
    const narrative = await stage("5 narrative", () => narrator.draft({ title: order.ownerFacingName!, category: "coins", resolvedAttributes: ing.resolvedAttributes, tier: score.tier, corrections: ing.corrections.map((c) => ({ claimed: c.claimed, correctedValue: c.correctedValue })) }));
    const provisional = await stage("5 assemble+seal v1", () => buildSnapshot(repo, ing.report, ing.profile, ing.declaredAttributes, ing.resolvedAttributes, score, narrative, { v: 1, provisional: true, title: order.ownerFacingName!, delta: undefined }));
    const v1 = await repo.addReportVersion({ reportId: ing.report.id, v: 1, snapshotJson: provisional, snapshotSha256: provisional.snapshotSha256!, supersedesSha256: null, tier: score.tier, composite: score.composite, ciLo: score.ci.lo, ciHi: score.ci.hi, pdfPath: null });
    await repo.updateReport(ing.report.id, { status: statusForTier(score.tier), currentVersion: 1 });
    const provHtml = `${OUT}01-provisional.html`;
    await stage("5 render provisional", () => writeFileSync(provHtml, wrap(renderReport(provisional), "Provisional v1")));
    log(`[5] RENDER  → provisional report written`);

    log(`\n---------------- PROVISIONAL RESULT ----------------`);
    log(`PCS composite : ${score.composite}`);
    log(`Tier          : ${score.tier}`);
    log(`Quadrants     : Identity ${q("identity")} / Custody ${q("custody")} / Material ${q("material")} / Risk ${q("risk")}  (weights 30/30/25/15)`);
    log(`95% CI        : lower ${score.ci.lo.toFixed(2)}  upper ${score.ci.hi.toFixed(2)}`);
    log(`Corrections   : ${ing.corrections.map((c) => `${c.claimed}→${c.correctedValue}`).join(", ") || "none"}`);
    log(`Stubbed       : ${listStubbed().map((s) => `${s.adapter}(${s.envKey})`).join(", ")}`);

    // ── STAGE 6 · curator confirm → definitive ──
    const confirmed = await stage("6 curator confirm", () => confirmReport(repo, { reportId: ing.report.id, curator: "Rod Bell-Irving", credentialClass: "curator", verb: "confirmed" }));
    log(`\n[6] CONFIRM → status ${intake.report.status} → provisional → ${confirmed.report.status} (v${confirmed.report.currentVersion})`);
    log(`    curator_action: ${confirmed.action.action} by ${confirmed.action.curator} [${confirmed.action.credentialClass}] immutable=${confirmed.action.immutable} signed=${confirmed.action.signedAt}`);
    log(`    HASH CHAIN: v1 ${v1.snapshotSha256!.slice(0, 16)}…  ⇐ superseded by  v2.supersedes ${confirmed.version!.supersedesSha256!.slice(0, 16)}…  (match=${v1.snapshotSha256 === confirmed.version!.supersedesSha256})`);
    const defHtml = `${OUT}02-definitive.html`;
    writeFileSync(defHtml, wrap(renderReport(confirmed.version!.snapshotJson), "Definitive v2"));

    // ── STAGE 7 · evidence ladder: add provenance + receipt, re-score ──
    const score2 = await stage("7 re-score (provenance added)", () => scorePcs({ ...enr.scoreInputs, custody: { coverage: 0.95, documentQuality: 1.0, gaps: [] } } as ScoreInputs));
    const q2 = (name: string) => score2.quadrants.find((x) => x.quadrant === name)!.raw;
    // update the custody check to reflect the supplied receipt, then re-assemble
    const custodyCheck = (await repo.listChecks(ing.report.id)).find((c) => c.quadrant === "custody");
    if (custodyCheck) await repo.addCheck({ reportId: ing.report.id, quadrant: "custody", key: "provenance_receipt", result: "consistent", authorityState: "declared", sourceId: null, note: "owner receipt + provenance narrative supplied" });
    const delta: DeltaRow[] = [
      { measure: "PCS score", from: String(Math.round(score.composite)), to: String(Math.round(score2.composite)), note: `${score.tier} → ${score2.tier}` },
      { measure: "Custody", from: String(Math.round(q("custody"))), to: String(Math.round(q2("custody"))), note: "provenance narrative + receipt supplied" },
      { measure: "95% CI width", from: (score.ci.hi - score.ci.lo).toFixed(1), to: (score2.ci.hi - score2.ci.lo).toFixed(1), note: "interval tightens" },
    ];
    const ladder = await stage("7 assemble+seal v3", () => buildSnapshot(repo, confirmed.report, ing.profile, ing.declaredAttributes, ing.resolvedAttributes, score2, narrative, { v: 3, provisional: false, supersedes: confirmed.version!.snapshotSha256!, title: order.ownerFacingName!, delta }));
    await repo.addReportVersion({ reportId: confirmed.report.id, v: 3, snapshotJson: ladder, snapshotSha256: ladder.snapshotSha256!, supersedesSha256: confirmed.version!.snapshotSha256, tier: score2.tier, composite: score2.composite, ciLo: score2.ci.lo, ciHi: score2.ci.hi, pdfPath: null });
    const ladderHtml = `${OUT}03-ladder-gold.html`;
    writeFileSync(ladderHtml, wrap(renderReport(ladder), "Evidence ladder v3"));

    log(`\n[7] LADDER  → provenance + receipt added, re-scored`);
    log(`    ${score.tier.toUpperCase()} ${score.composite}  CI [${score.ci.lo.toFixed(1)},${score.ci.hi.toFixed(1)}] (width ${(score.ci.hi - score.ci.lo).toFixed(1)})`);
    log(`      →  ${score2.tier.toUpperCase()} ${score2.composite}  CI [${score2.ci.lo.toFixed(1)},${score2.ci.hi.toFixed(1)}] (width ${(score2.ci.hi - score2.ci.lo).toFixed(1)})`);
    log(`    Custody ${q("custody")} → ${q2("custody")}; hash chain v2 → v3 = ${ladder.supersedesSha256 === confirmed.version!.snapshotSha256}`);

    // ── stage timing table ──
    log(`\n---------------- STAGE TIMING ----------------`);
    for (const t of timings) log(`  ${t.stage.padEnd(28)} ${ms(t.ms).padStart(9)}`);
    log(`  ${"TOTAL".padEnd(28)} ${ms(timings.reduce((a, t) => a + t.ms, 0)).padStart(9)}`);

    log(`\n---------------- OUTPUT FILES ----------------`);
    log(`  ${provHtml}`);
    log(`  ${defHtml}`);
    log(`  ${ladderHtml}`);

    // assertions so the run is also a pass/fail gate
    expect(ing.corrections[0].correctedValue).toBe("2007");
    expect(score.tier).toBe("silver");
    expect(score2.tier).toBe("gold");
    expect(confirmed.report.status).toBe("definitive");
    expect(confirmed.version!.supersedesSha256).toBe(v1.snapshotSha256);
    expect(score2.ci.hi - score2.ci.lo).toBeLessThan(score.ci.hi - score.ci.lo); // CI tightens
  });
});
