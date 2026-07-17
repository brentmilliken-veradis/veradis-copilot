// Canonical report renderer (E6). Turns a ReportSnapshot into the 14-section
// report of Canonical Report Spec v03 §3. Self-contained HTML (inline CSS), so a
// rendered report is a portable artefact. Provisional reports carry the watermark
// until a curator confirms (E7). The verify-this-report block carries the hash
// chain (gate ⑥); the scannable QR image is a documented go-live stub.

import type { ReportSnapshot } from "@/packages/pcs-types";
import { WEIGHTS } from "@/packages/pcs-core";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TIER_LABEL: Record<string, string> = {
  gold: "Gold", silver: "Silver", bronze: "Bronze",
  flagged: "Flagged", unscored: "Unscored", withheld: "Withheld",
};

// Fixed lines (Report Spec v03 §3.3, §16.6/16.7, §10.3).
const INDEPENDENCE_LINE = "veradis' fee is fixed and does not depend on the value concluded.";
const STALENESS_LINE = "Values and registry results are as of the effective date; insurers typically require re-verification after 12–36 months.";
const REGISTRY_CAVEAT = "“Clear” means no match in the named registry on the check date — it never means “not stolen.”";
const REPRODUCIBILITY_LINE = "Re-running this method against this data snapshot reproduces this score to the digit (pinned-seed deterministic pipeline; golden tests in CI).";
const FALSIFIABILITY_LINE = "Every score is falsifiable: each check names the source that would overturn it.";
const HONESTY_CEILING = "Verified against the documentary record, expert-reviewed. This is not a certificate of authenticity and not a certified appraisal.";
const ALR_COVERAGE_LINE = "Stolen-property check covers Interpol, FBI Art Crime Team, ICOM Red Lists, and CBP repatriation registry. Art Loss Register integration scheduled Q3 2026. This report does not discharge the recipient's own diligence obligations.";
const LIABILITY_LINE = "This report is intelligence, not insurance: a probabilistic verification based on the data available at the time of query. It is not a legal determination and confers no indemnity.";

function verdict(s: ReportSnapshot): string {
  const score = s.score;
  const tier = TIER_LABEL[score.tier];
  const ciWidth = Math.round((score.ci.hi - score.ci.lo) / 2);
  const bars = (["identity", "custody", "material", "risk"] as const)
    .map((q) => {
      const qs = score.quadrants.find((x) => x.quadrant === q);
      const w = Math.round(WEIGHTS[q] * 100);
      return `<tr><td>${q[0].toUpperCase() + q.slice(1)} <span class="wt">${w}%</span></td><td>${qs ? Math.round(qs.raw) : "—"}</td></tr>`;
    })
    .join("");
  const arithmetic = score.quadrants.length
    ? `(${score.quadrants
        .map((qs) => `${Math.round(qs.raw)}×${WEIGHTS[qs.quadrant].toFixed(2)}`)
        .join(" + ")}) = ${score.composite}`
    : "";
  const CAP_LINES: Record<NonNullable<ReportSnapshot["capReason"]>, string> = {
    uncalibrated_category:
      "This category is not yet calibrated; the result is provisional pending Tier-1 sources.",
    vision_reroute:
      "The category attribution was re-read from the images alone; the result is provisional pending corroboration.",
  };
  const capNote = s.capReason ? `<p class="cap-note">${CAP_LINES[s.capReason]}</p>` : "";
  return `<section class="verdict"><h2>Provenance Confidence Score</h2>
    <p class="score"><span class="pcs-num">${Math.round(score.composite)}</span>
      <span class="pcs-ci">± ${ciWidth} · 95% CI [${score.ci.lo.toFixed(0)}, ${score.ci.hi.toFixed(0)}]</span></p>
    <p class="tier tier-${score.tier}">${tier} <span class="lb">tier on the lower bound (${score.ci.lo.toFixed(0)})</span></p>
    ${capNote}
    <table class="bars">${bars}</table>
    <p class="arith">${arithmetic}</p></section>`;
}

function deltaPanel(s: ReportSnapshot): string {
  if (!s.delta?.length) return "";
  const rows = s.delta
    .map((d) => `<tr><td>${esc(d.measure)}</td><td>${esc(d.from)}</td><td>&rarr;</td><td>${esc(d.to)}</td><td>${esc(d.note ?? "")}</td></tr>`)
    .join("");
  return `<section class="delta"><h2>What changed since v${s.v - 1}</h2>
    <table><thead><tr><th>Measure</th><th>Was</th><th></th><th>Now</th><th></th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function materialCharacterisation(s: ReportSnapshot): string {
  const mat = s.checks.filter((c) => c.quadrant === "material");
  if (!mat.length) return "";
  const rows = mat
    .map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.result)}</td><td>${esc(c.authorityState)}</td><td>${esc(c.note ?? "")}</td></tr>`)
    .join("");
  return `<section class="material"><h3>Declared · observed · reference</h3>
    <table><thead><tr><th>Check</th><th>Result</th><th>Authority</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function checksTable(s: ReportSnapshot): string {
  if (!s.checks.length) return "";
  const rows = s.checks
    .map((c) => `<tr><td>${esc(c.quadrant)}</td><td>${esc(c.label)}</td><td>${esc(c.result)}</td><td>${esc(c.authorityState)}</td><td>${esc(c.sourceName ?? "")}</td></tr>`)
    .join("");
  return `<section class="checks"><h2>Every claim, and where it resolved</h2>
    <table><thead><tr><th>Quadrant</th><th>Check</th><th>Result</th><th>Authority</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function evidencePanel(s: ReportSnapshot): string {
  const rows = s.evidence
    .map((e) => `<tr><td>${esc(e.slot)}</td><td>${esc(e.kind)}</td><td class="hash">${esc(e.sha256.slice(0, 16))}…</td><td>${esc(e.c2paState)}</td></tr>`)
    .join("");
  return `<section class="evidence"><h2>${s.evidence.length} photographs, hashed at intake</h2>
    <table><thead><tr><th>Slot</th><th>Kind</th><th>SHA-256</th><th>C2PA</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function valuation(s: ReportSnapshot): string {
  if (!s.valuation) return "";
  const v = s.valuation;
  const comps = v.comps
    .map((c) => `<tr><td>${esc(c.source)}</td><td>${esc(c.venue)}</td><td>${esc(c.date)}</td><td>${esc(c.result)}</td><td>${esc(c.basis)}</td></tr>`)
    .join("");
  const actions = v.actions
    .map((a) => `<li>${esc(a.action)} <span class="eff">${esc(a.expectedBandEffect)}</span></li>`)
    .join("");
  return `<section class="appraise"><h2>Indicative fair market value</h2>
    <p class="fmv">${esc(v.currency)} ${v.fmvLo.toLocaleString()}–${v.fmvHi.toLocaleString()}</p>
    <h3>Comparable sales</h3>
    <table><thead><tr><th>Source</th><th>Venue</th><th>Date</th><th>Result</th><th>Basis</th></tr></thead><tbody>${comps}</tbody></table>
    <h3>Actions</h3><ol class="actions">${actions}</ol></section>`;
}

function attestation(s: ReportSnapshot): string {
  const verifyUrl = `https://verify.veradis.ai/r/${esc(s.reportId)}/v${s.v}`;
  const snapHash = s.snapshotSha256 ? `<p>Snapshot hash: <code>${esc(s.snapshotSha256)}</code></p>` : "";
  const pred = s.supersedesSha256
    ? `<p>Supersedes v${s.v - 1}: <code>${esc(s.supersedesSha256)}</code> (hash chain)</p>`
    : "";
  return `<section class="attestation"><h2>What this signature attests</h2>
    <p>${esc(HONESTY_CEILING)}</p>
    <p>Report ${esc(s.reportId)} · v${s.v} · Method ${esc(s.methodVersion)} · snapshot ${esc(s.snapshotTs)}</p>
    ${snapHash}
    <p>Pinned seed: <code>${esc(s.score.seedHex)}</code></p>
    ${pred}
    <div class="verify"><p>Verify this report: <a href="${verifyUrl}">${verifyUrl}</a></p>
      <div class="qr" aria-label="verify-this-report QR (image renders at go-live)">[QR]</div></div>
    <p class="repro">${esc(REPRODUCIBILITY_LINE)}</p>
    <p class="falsif">${esc(FALSIFIABILITY_LINE)}</p>
    <p class="liability">${esc(LIABILITY_LINE)}</p></section>`;
}

export function renderReport(s: ReportSnapshot): string {
  const watermark = s.provisional
    ? `<div class="watermark">Provisional — under expert review</div>`
    : "";
  const registrySweep = `<section class="registry"><h3>Registry sweep</h3>
    <p>${esc(ALR_COVERAGE_LINE)}</p><p class="caveat">${esc(REGISTRY_CAVEAT)}</p></section>`;

  return `<article class="pcs-report tier-${s.score.tier}">
  ${watermark}
  <header><h1>${esc(s.object.title)}</h1>
    <p class="owner">${esc(s.object.ownerFacingName)}</p></header>
  <section class="meta"><p>${esc(s.reportId)} · v${s.v} · Effective ${esc(s.meta.effectiveDate)}
    · Method ${esc(s.methodVersion)} · snap ${esc(s.snapshotTs)}
    · ${esc(s.meta.ownerLocale)} / ${esc(s.meta.currency)} · Basis ${esc(s.meta.basis)}</p></section>
  <section class="scope"><h2>Scope &amp; intended use</h2>
    <p>${esc(HONESTY_CEILING)}</p>
    <p class="independence">${esc(INDEPENDENCE_LINE)}</p>
    <p class="staleness">${esc(STALENESS_LINE)}</p></section>
  ${deltaPanel(s)}
  ${verdict(s)}
  ${registrySweep}
  ${materialCharacterisation(s)}
  ${valuation(s)}
  ${evidencePanel(s)}
  ${checksTable(s)}
  ${attestation(s)}
  <section class="reading-guide"><h3>Reading guide</h3>
    <p>Gold/Silver/Bronze are tiered on the lower bound of the 95% confidence interval. Gaps are disclosed, not hidden.</p></section>
  <footer><p>Method ${esc(s.methodVersion)} · veradis.ai · The trust layer for everything physical.</p></footer>
</article>`;
}
