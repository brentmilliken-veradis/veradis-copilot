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
const THEFT_NOT_CHECKED_LINE = "Stolen-property register: not checked. The hard register clearance is a paid add-on and is not included in this base report — its absence widens no claim: nothing here asserts this item is not stolen.";
const THEFT_CLEARED_LINE = "Stolen-property register: no match on the check date; a clearance certificate accompanies this report.";
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
  const factors = v.factors
    .map((f) => `<li class="factor factor-${esc(f.kind)}">${esc(f.name)}${f.effect ? ` — <span class="eff">${esc(f.effect)}</span>` : ""}</li>`)
    .join("");
  // F-8: a number is shown only as (a) an expert-set band, or (b) a clearly-
  // labelled INDICATIVE machine estimate. No band — or a degenerate 0–0 —
  // renders the under-review line. A certified figure is never fabricated.
  const hasBand = v.fmvLo !== undefined && v.fmvHi !== undefined && !(v.fmvLo === 0 && v.fmvHi === 0);
  let head: string;
  if (hasBand && v.indicative) {
    head = `<p class="fmv">${esc(v.currency)} ${v.fmvLo!.toLocaleString()}–${v.fmvHi!.toLocaleString()}</p>
    <p class="fmv-note">Machine estimate — not a certified appraisal. Market interest: ${esc(v.marketInterest)}. An expert confirms the firm band.</p>
    ${v.basis ? `<p class="fmv-basis">${esc(v.basis)}</p>` : ""}`;
  } else if (hasBand) {
    head = `<p class="fmv">${esc(v.currency)} ${v.fmvLo!.toLocaleString()}–${v.fmvHi!.toLocaleString()}</p>`;
  } else {
    head = `<p class="fmv-pending">Indicative value — under expert review</p>`;
  }
  const factorsBlock = factors ? `<h3>Value factors</h3><ul class="factors">${factors}</ul>` : "";
  return `<section class="appraise"><h2>Indicative fair market value</h2>
    ${head}
    ${factorsBlock}
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

// Self-contained, brand-styled stylesheet embedded in every report so the file
// is a portable, professional artefact standalone (opened, downloaded, or
// printed to PDF) — not a bare fragment that inherits nothing. Brand: Brass /
// Forest / Ink, Instrument Serif/Sans + Inter.
const REPORT_CSS = `
:root{--brass:#A87D2E;--forest:#1A4533;--ink:#0F1F38;--paper:#F7F4EC;--card:#FFFFFF;--line:#E6DFD2;--muted:#6E6656;--flag:#B4642A}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;padding:32px 16px}
.pcs-report{max-width:780px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:44px 48px;box-shadow:0 1px 3px rgba(15,31,56,.06),0 14px 44px rgba(15,31,56,.05)}
.watermark{display:inline-block;margin:0 0 20px;padding:6px 14px;background:rgba(168,125,46,.10);color:var(--brass);border:1px solid rgba(168,125,46,.30);border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:6px}
header h1{font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400;font-size:34px;line-height:1.15;margin:0 0 6px;color:var(--ink)}
.owner{color:var(--muted);margin:0;font-size:14px}
.meta p{color:var(--muted);font-size:12.5px;margin:14px 0 0}
h2{font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:19px;color:var(--forest);margin:34px 0 12px;letter-spacing:-.01em}
h3{font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:15px;color:var(--ink);margin:22px 0 8px}
p{margin:0 0 12px}
a{color:var(--brass);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:rgba(15,31,56,.05);padding:2px 6px;border-radius:5px;word-break:break-all}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px}
th{text-align:left;font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--line);padding:8px 12px 8px 0}
td{padding:9px 12px 9px 0;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
.hash{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted)}
.verdict{background:linear-gradient(180deg,rgba(26,69,51,.045),rgba(26,69,51,0));border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin-top:26px}
.verdict h2{margin-top:0}
.score{margin:2px 0 6px;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.pcs-num{font-family:'Instrument Sans',system-ui,sans-serif;font-size:52px;font-weight:700;line-height:1;color:var(--forest)}
.pcs-ci{color:var(--muted);font-size:13px}
.tier{font-weight:600;margin:0 0 6px}
.tier .lb{font-weight:400;color:var(--muted);font-size:13px}
.tier-flagged{color:var(--flag)}.tier-gold{color:var(--brass)}.tier-silver{color:#7A7A82}.tier-bronze{color:#8A5A2B}
.cap-note{background:rgba(180,100,42,.08);border-left:3px solid var(--flag);border-radius:0 8px 8px 0;padding:10px 14px;font-size:13.5px;margin:12px 0}
.bars td{font-variant-numeric:tabular-nums}
.bars td:last-child{text-align:right;font-weight:600;width:64px}
.wt{color:var(--muted);font-size:12px;font-weight:400}
.arith{color:var(--muted);font-size:12.5px;font-family:ui-monospace,monospace}
.fmv{font-family:'Instrument Sans',sans-serif;font-size:26px;font-weight:700;color:var(--forest);margin:6px 0 14px}
.fmv-pending{font-style:italic;color:var(--muted);margin:6px 0 14px}
.fmv-note{color:var(--muted);font-size:13px;margin:-6px 0 6px}
.fmv-basis{font-size:13px;margin:0 0 14px}
.factors{margin:6px 0 14px;padding-left:18px}
.factors .factor{margin:3px 0}
.factors .eff{color:var(--muted)}
.actions{padding-left:18px}.actions li{margin:6px 0}.eff{color:var(--muted);font-size:12.5px}
.caveat,.independence,.staleness{color:var(--muted);font-size:13px}
.verify{background:rgba(15,31,56,.03);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.qr{width:56px;height:56px;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;flex:0 0 auto}
.repro,.falsif,.liability{color:var(--muted);font-size:12.5px}
.reading-guide p{color:var(--muted);font-size:13px}
footer{margin-top:34px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;text-align:center}
@media print{body{background:#fff;padding:0}.pcs-report{box-shadow:none;border:none;max-width:none;padding:0}}
@media (max-width:560px){.pcs-report{padding:26px 20px}header h1{font-size:27px}.pcs-num{font-size:42px}}
`;

export function renderReport(s: ReportSnapshot): string {
  const watermark = s.provisional
    ? `<div class="watermark">Provisional — under expert review</div>`
    : "";
  const theftCheck = s.checks.find((c) => c.quadrant === "risk" && c.key === "stolen_registry");
  const theftLine = theftCheck
    ? theftCheck.authorityState === "resolved"
      ? THEFT_CLEARED_LINE
      : THEFT_NOT_CHECKED_LINE
    : "";
  const registrySweep = `<section class="registry"><h3>Registry sweep</h3>
    <p>${esc(ALR_COVERAGE_LINE)}</p>${theftLine ? `<p class="theft">${esc(theftLine)}</p>` : ""}<p class="caveat">${esc(REGISTRY_CAVEAT)}</p></section>`;

  const article = `<article class="pcs-report tier-${s.score.tier}">
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

  const lang = esc((s.meta.ownerLocale || "en").split("-")[0] || "en");
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.object.title)} — veradis report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Instrument+Sans:wght@500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>${REPORT_CSS}</style>
</head>
<body>
${article}
</body>
</html>`;
}
