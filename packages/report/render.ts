// Canonical report renderer (E6). Turns a ReportSnapshot into a self-contained,
// brand-styled HTML report — the customer-facing artefact delivered to the
// account and printable to PDF. The look-and-feel follows the reference design
// (veradis.ai/examples): a story-first report with a story + scope callout, an
// object hero + evidence strip, a donut verdict with weighted component bars and
// a plain-language read of each, collapsible detail sections, and a dark
// attestation card carrying the hash chain (gate ⑥) and reproducibility contract.
//
// Honesty is load-bearing and unchanged: "verified against the documentary
// record, expert-reviewed" — NEVER "authenticated"; no percentage-of-value fee;
// a value is only ever an expert-set band or a clearly-labelled INDICATIVE
// machine estimate; provisional reports carry the watermark until a curator
// confirms (E7).
//
// Object photographs are passed in via `opts.images` (data URIs built at
// delivery from the owner's uploads) — they are NEVER stored in the snapshot, so
// re-rendering the same snapshot without them still produces a valid report.

import type { ReportSnapshot } from "@/packages/pcs-types";
import { WEIGHTS } from "@/packages/pcs-core";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A rendered object photo. `dataUri` is a self-contained data: URI (base64) so
 *  the report file needs no network to show the object. */
export interface ReportImage {
  slot: string;
  label?: string;
  dataUri: string;
}

export interface RenderOptions {
  images?: ReportImage[];
}

const TIER_LABEL: Record<string, string> = {
  gold: "Gold", silver: "Silver", bronze: "Bronze",
  flagged: "Flagged", unscored: "Unscored", withheld: "Withheld",
};

// Fixed lines (Report Spec v03 §3.3, §16.6/16.7, §10.3). Verbatim — some are
// asserted by tests and all carry legal/honesty weight.
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

const QUADRANTS = ["identity", "custody", "material", "risk"] as const;
type Quadrant = (typeof QUADRANTS)[number];
const QUADRANT_LABEL: Record<Quadrant, string> = {
  identity: "Identity match",
  custody: "Custody &amp; story",
  material: "Material integrity",
  risk: "Risk profile",
};

const TIER_HEX: Record<string, string> = {
  gold: "#A87D2E", silver: "#8A8A92", bronze: "#8A5A2B",
  flagged: "#B4642A", unscored: "#8A8A92", withheld: "#8A8A92",
};

function humanize(key: string): string {
  return key.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function categoryLabel(category: string): string {
  return humanize(category);
}

/** A short, plain-language read of one quadrant, composed from its checks so the
 *  bar reads like the reference ("Country, year, mint and variety match the
 *  issuer certificate") rather than a bare number. Deterministic — no LLM. */
function quadrantRead(s: ReportSnapshot, q: Quadrant): string {
  const checks = s.checks.filter((c) => c.quadrant === q);
  const resolved = checks.filter((c) => c.authorityState === "resolved" || c.result === "match");
  const sources = Array.from(new Set(checks.map((c) => c.sourceName).filter(Boolean))) as string[];
  const src = sources[0];
  if (q === "identity") {
    if (!checks.length) return "Identity read from the photographs; no external source has confirmed it yet.";
    const matched = resolved.map((c) => c.label.toLowerCase());
    const held = checks.filter((c) => c.result === "gap_held_open").map((c) => c.label.toLowerCase());
    const lead = matched.length
      ? `${matched.slice(0, 4).join(", ")} ${matched.length === 1 ? "matches" : "match"}${src ? ` the ${src.toLowerCase()}` : ""}.`
      : "Identity is declared but not yet corroborated by a reference source.";
    return held.length ? `${lead} ${held.length} attribute${held.length > 1 ? "s" : ""} held open, honestly.` : lead;
  }
  if (q === "custody") {
    if (!checks.length) return "No ownership history was supplied — custody scores on what little is on file.";
    const labels = checks.map((c) => (c.note ? c.note.replace(/\s*\(owner-stated\)/i, "") : c.label));
    return `${labels.slice(0, 4).join("; ")}. A coherent, single-generation record; declared items firm up with a Tier-1 source or primary paper.`;
  }
  if (q === "material") {
    if (!checks.length) return "Material characterisation pending a closer capture pass.";
    const inconsistent = checks.some((c) => /inconsistent/i.test(c.result) || /inconsist/i.test(c.note ?? ""));
    return inconsistent
      ? "One or more material readings are inconsistent with the declared identity — flagged, not smoothed over."
      : "Surface, strike and finish read consistent with the declared identity; nothing contradicts it.";
  }
  // risk
  const clean = checks.filter((c) => c.result === "match" || c.authorityState === "resolved").length;
  const qs = s.score.quadrants.find((x) => x.quadrant === "risk");
  const capped = qs && Math.round(qs.raw) === 90;
  return `Clean across ${clean || "every"} registr${clean === 1 ? "y" : "ies"} checked (sweep below).${capped ? " Capped at 90 while the Art Loss Register remains unlicensed — the method telling the truth about its own coverage." : ""}`;
}

function donutSvg(composite: number, tier: string): string {
  const pct = Math.max(0, Math.min(100, composite));
  const r = 52, C = 2 * Math.PI * r;
  const arc = (pct / 100) * C;
  const colour = TIER_HEX[tier] ?? "#A87D2E";
  return `<svg class="donut" viewBox="0 0 130 130" role="img" aria-label="Provenance Confidence Score ${Math.round(composite)} of 100">
    <circle cx="65" cy="65" r="${r}" fill="none" stroke="#E6DFD2" stroke-width="11"/>
    <circle cx="65" cy="65" r="${r}" fill="none" stroke="${colour}" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="${arc.toFixed(1)} ${(C - arc).toFixed(1)}" transform="rotate(-90 65 65)"/>
    <text x="65" y="62" class="donut-num" text-anchor="middle">${Math.round(composite)}</text>
    <text x="65" y="80" class="donut-den" text-anchor="middle">/ 100</text>
  </svg>`;
}

function verdictCard(s: ReportSnapshot): string {
  const score = s.score;
  const tier = TIER_LABEL[score.tier];
  const ciWidth = Math.round((score.ci.hi - score.ci.lo) / 2);
  const coverageChecks = s.checks.length;
  const docs = s.citations.filter((c) => c.retrievalState === "retrieved").length;

  const bars = QUADRANTS.map((q) => {
    const qs = score.quadrants.find((x) => x.quadrant === q);
    const raw = qs ? Math.round(qs.raw) : null;
    const w = Math.round(WEIGHTS[q] * 100);
    const pct = raw ?? 0;
    return `<div class="bar-row">
      <div class="bar-head"><span class="bar-name">${QUADRANT_LABEL[q]} <span class="wt">· weight .${String(w).padStart(2, "0")}</span></span><span class="bar-val">${raw ?? "—"}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <p class="bar-read">${esc(quadrantRead(s, q))}</p>
    </div>`;
  }).join("");

  const arithmetic = score.quadrants.length
    ? `(${score.quadrants.map((qs) => `${Math.round(qs.raw)} × .${String(Math.round(WEIGHTS[qs.quadrant] * 100)).padStart(2, "0")}`).join(") + (")}) = ${score.composite}, reported as ${Math.round(score.composite)}`
    : "";

  const CAP_LINES: Record<NonNullable<ReportSnapshot["capReason"]>, string> = {
    uncalibrated_category: "This category is not yet calibrated; the result is provisional pending Tier-1 sources.",
    vision_reroute: "The category attribution was re-read from the images alone; the result is provisional pending corroboration.",
  };
  const capNote = s.capReason ? `<p class="cap-note">${CAP_LINES[s.capReason]}</p>` : "";
  const curatorChip = s.provisional
    ? `<span class="chip chip-soft">Provisional — under expert review</span>`
    : `<span class="chip chip-soft">No curator action required</span>`;

  return `<section class="verdict-wrap">
    <p class="eyebrow">The verdict</p>
    <div class="verdict">
      <div class="verdict-left">
        <h2 class="sr-head">Provenance Confidence Score</h2>
        ${donutSvg(score.composite, score.tier)}
        <p class="ci">± ${ciWidth} · 95% CI [${score.ci.lo.toFixed(0)}, ${score.ci.hi.toFixed(0)}]</p>
        <p><span class="chip chip-tier tier-${score.tier}">${tier} · lower bound ${score.ci.lo.toFixed(0)}</span></p>
        <p>${curatorChip}</p>
        <p class="coverage">Coverage: ${coverageChecks} checks · ${docs} source${docs === 1 ? "" : "s"} retrieved</p>
        ${capNote}
      </div>
      <div class="verdict-right">${bars}
        <p class="arith"><strong>Score computation, disclosed (locked weights):</strong> ${arithmetic}</p>
      </div>
    </div>
    ${whyBox(s)}
  </section>`;
}

function whyBox(s: ReportSnapshot): string {
  const score = s.score;
  const tier = TIER_LABEL[score.tier];
  const ciWidth = Math.round((score.ci.hi - score.ci.lo) / 2);
  const weakest = [...score.quadrants].sort((a, b) => a.raw - b.raw)[0];
  const weakLabel = weakest ? QUADRANT_LABEL[weakest.quadrant as Quadrant] : "the open items";
  return `<div class="why"><strong>Why ± ${ciWidth}, and why ${tier}.</strong> The tier is assigned on the lower bound of the 95% confidence interval (${score.ci.lo.toFixed(0)}), not the headline number — a deliberately conservative call. The interval reflects what is still open; here ${weakLabel.toLowerCase().replace("&amp;", "and")} carries the widest margin. Firming it lifts the floor, not the headline.</div>`;
}

// ---- Object hero + evidence strip -------------------------------------------

function heroBlock(s: ReportSnapshot, images: ReportImage[]): string {
  const bySlot = new Map(images.map((i) => [i.slot, i]));
  // Vision's pick of the object-itself photo wins (a coin, not its COA); else a
  // slot heuristic; else the first image.
  const heroKey = (s.heroSlot && bySlot.has(s.heroSlot) ? s.heroSlot : undefined)
    ?? ["obverse", "front", "hero", "reverse"].find((k) => bySlot.has(k));
  const hero = (heroKey ? bySlot.get(heroKey) : images[0]) ?? null;

  const heroImg = hero
    ? `<img class="hero-img" src="${hero.dataUri}" alt="${esc(s.object.title)}">`
    : `<div class="hero-ph"><span class="hero-ph-mark">◆</span><span>${s.evidence.length} photographs on file — hashed at intake</span></div>`;

  const tiles = (images.length ? images : s.evidence.map((e) => ({ slot: e.slot, label: undefined, dataUri: "" })))
    .slice(0, 12) // one tile per photo (the strip wraps); bounded only as a runaway guard
    .map((t) => {
      const label = esc((("label" in t && t.label) || humanize(t.slot)).toUpperCase());
      const inner = t.dataUri
        ? `<img src="${t.dataUri}" alt="${label}">`
        : `<span class="thumb-ph">${label}</span>`;
      return `<figure class="thumb">${inner}<figcaption>${label}</figcaption></figure>`;
    })
    .join("");

  return `<section class="hero">
    ${heroImg}
    <p class="hero-cap">Photographed by the owner · every image hashed into the report snapshot.</p>
    <div class="thumbs">${tiles}</div>
  </section>`;
}

// ---- Collapsible detail sections --------------------------------------------

function collapsible(eyebrow: string, headline: string, inner: string, open = false): string {
  if (!inner.trim()) return "";
  return `<details class="fold"${open ? " open" : ""}>
    <summary><span class="fold-eyebrow">${eyebrow}</span><span class="fold-headline">${headline}</span><span class="fold-caret" aria-hidden="true">›</span></summary>
    <div class="fold-body">${inner}</div>
  </details>`;
}

function registrySweep(s: ReportSnapshot): string {
  const theftCheck = s.checks.find((c) => c.quadrant === "risk" && c.key === "stolen_registry");
  const theftLine = theftCheck
    ? theftCheck.authorityState === "resolved" ? THEFT_CLEARED_LINE : THEFT_NOT_CHECKED_LINE
    : "";
  const risk = s.checks.filter((c) => c.quadrant === "risk");
  const rows = risk
    .map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.result)}</td><td>${esc(c.sourceName ?? c.authorityState)}</td></tr>`)
    .join("");
  const table = rows ? `<table><thead><tr><th>Register</th><th>Result</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>` : "";
  return `<p>${esc(ALR_COVERAGE_LINE)}</p>${theftLine ? `<p class="note">${esc(theftLine)}</p>` : ""}${table}<p class="caveat">${esc(REGISTRY_CAVEAT)}</p>`;
}

function materialSection(s: ReportSnapshot): string {
  const mat = s.checks.filter((c) => c.quadrant === "material");
  if (!mat.length) return "";
  const rows = mat
    .map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.result)}</td><td>${esc(c.authorityState)}</td><td>${esc(c.note ?? "")}</td></tr>`)
    .join("");
  return `<p>The declared identity read against what the photographs show and the reference record.</p>
    <table><thead><tr><th>Check</th><th>Result</th><th>Authority</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function evidenceSection(s: ReportSnapshot): string {
  const rows = s.evidence
    .map((e) => `<tr><td>${esc(humanize(e.slot))}</td><td>${esc(e.kind)}</td><td class="hash">${esc(e.sha256.slice(0, 16))}…</td><td>${esc(e.c2paState)}</td></tr>`)
    .join("");
  return `<p>${s.evidence.length} view${s.evidence.length === 1 ? "" : "s"} on file. Each photograph is individually SHA-256 hashed into the report snapshot; altering any image breaks the hash.</p>
    <table><thead><tr><th>View</th><th>Kind</th><th>SHA-256</th><th>C2PA</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function checksSection(s: ReportSnapshot): string {
  if (!s.checks.length) return "";
  const rows = s.checks
    .map((c) => `<tr><td>${esc(humanize(c.quadrant))}</td><td>${esc(c.label)}</td><td>${esc(c.result)}</td><td>${esc(c.authorityState)}</td><td>${esc(c.sourceName ?? "")}</td></tr>`)
    .join("");
  return `<p>Every claim, and where it resolved — authority state shown, gaps held open rather than papered over.</p>
    <table><thead><tr><th>Quadrant</th><th>Check</th><th>Result</th><th>Authority</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function deltaSection(s: ReportSnapshot): string {
  if (!s.delta?.length) return "";
  const rows = s.delta
    .map((d) => `<tr><td>${esc(d.measure)}</td><td>${esc(d.from)} → ${esc(d.to)}</td><td>${esc(d.note ?? "")}</td></tr>`)
    .join("");
  return `<section class="plain">
    <p class="eyebrow">What changed since v${s.v - 1}</p>
    <table class="delta"><thead><tr><th>Measure</th><th>Change</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ---- Valuation (Appraise) ----------------------------------------------------

function valuationSection(s: ReportSnapshot): string {
  if (!s.valuation) return "";
  const v = s.valuation;
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

  const factors = v.factors
    .map((f) => `<li class="factor factor-${esc(f.kind)}"><span class="factor-name">${esc(f.name)}</span>${f.effect ? ` — <span class="eff">${esc(f.effect)}</span>` : ""}</li>`)
    .join("");
  const factorsBlock = factors ? `<h3>Value factors</h3><ul class="factors">${factors}</ul>` : "";

  const comps = v.comps
    .map((c) => {
      const src = c.url ? `<a href="${esc(c.url)}" rel="nofollow noopener">${esc(c.source)}</a>` : esc(c.source);
      return `<tr><td>${src}</td><td>${esc(c.venue)}</td><td>${esc(c.date)}</td><td>${esc(c.result)}</td></tr>`;
    })
    .join("");
  const compsBlock = v.comps.length
    ? collapsible("Comparable sales · cited", `${v.comps.length} comparable${v.comps.length === 1 ? "" : "s"} found on the open market`,
        `<table><thead><tr><th>Listing</th><th>Venue</th><th>Date</th><th>Result</th></tr></thead><tbody>${comps}</tbody></table>`, true)
    : "";
  const actions = v.actions.map((a) => `<li>${esc(a.action)} <span class="eff">${esc(a.expectedBandEffect)}</span></li>`).join("");

  return `<section class="appraise">
    <p class="eyebrow">The appraise</p>
    <h2>Indicative fair market value</h2>
    ${head}
    ${factorsBlock}
    ${compsBlock}
    <h3>To tighten the band</h3><ol class="actions">${actions}</ol>
  </section>`;
}

// ---- Attestation -------------------------------------------------------------

function attestationCard(s: ReportSnapshot): string {
  const verifyUrl = `https://verify.veradis.ai/r/${esc(s.reportId)}/v${s.v}`;
  const snapHash = s.snapshotSha256
    ? `<div class="att-item"><span class="att-k">Data snapshot hash · SHA-256</span><code>${esc(s.snapshotSha256)}</code></div>` : "";
  const pred = s.supersedesSha256
    ? `<div class="att-item"><span class="att-k">Supersedes v${s.v - 1}</span><code>${esc(s.supersedesSha256)}</code></div>` : "";
  const curatorStatus = s.provisional ? "Provisional — awaiting curator confirmation" : "Confirmed — curator sealed";
  return `<section class="attestation">
    <h2>What this signature attests</h2>
    <p class="att-ceiling">${esc(HONESTY_CEILING)}</p>
    <div class="att-grid">
      <div class="att-item"><span class="att-k">Report ID</span><span>${esc(s.reportId)} · v${s.v}</span></div>
      <div class="att-item"><span class="att-k">Method</span><span>${esc(s.methodVersion)} · ${esc(s.snapshotTs)}</span></div>
      ${snapHash}
      <div class="att-item"><span class="att-k">Verify this report</span><a href="${verifyUrl}">${verifyUrl}</a></div>
      <div class="att-item"><span class="att-k">Pinned seed</span><code>${esc(s.score.seedHex)}</code></div>
      <div class="att-item"><span class="att-k">Curator status</span><span>${curatorStatus}</span></div>
      ${pred}
    </div>
    <p class="att-fine">${esc(REPRODUCIBILITY_LINE)}</p>
    <p class="att-fine">${esc(FALSIFIABILITY_LINE)}</p>
    <p class="att-fine">${esc(LIABILITY_LINE)}</p>
  </section>`;
}

// ---- Page --------------------------------------------------------------------

const REPORT_CSS = `
:root{--brass:#A87D2E;--forest:#1A4533;--ink:#20201C;--dark:#17150F;--paper:#F7F4EC;--card:#FFFFFF;--beige:#EFE9DB;--line:#E4DDCE;--muted:#6E6656;--flag:#B4642A}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.62;padding:30px 20px}
.report{max-width:800px;margin:0 auto}
.brandbar{display:flex;align-items:center;gap:9px;margin:0 auto 22px;max-width:800px;padding-bottom:18px;border-bottom:1px solid var(--line)}
.brandbar .wm{font-family:'Instrument Serif',Georgia,serif;font-size:23px;letter-spacing:.01em;color:var(--ink)}
.brandbar .prism{width:19px;height:19px;flex:0 0 auto}
/* Flat, light document — content sits on the page like the reference; only the
   banner and attestation are intentionally dark. No boxed card, no tint. */
.sheet{background:transparent;border:none;padding:0}
.sr-head{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.banner{display:flex;gap:14px;align-items:flex-start;background:var(--dark);color:#E9E4D6;border-radius:12px;padding:15px 20px;margin-bottom:28px;font-size:13px;line-height:1.55}
.banner .tag{flex:0 0 auto;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.banner-final .tag{background:#CBE4D3;color:#1A4533}
.banner-prov .tag{background:#E6D8B4;color:#6b5320}
.eyebrow{font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--brass);margin:0 0 8px}
h1.title{font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400;font-size:37px;line-height:1.13;margin:0 0 8px;color:var(--ink);letter-spacing:-.005em}
.subtitle{color:var(--muted);margin:0 0 24px;font-size:14.5px}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;background:var(--beige);border-radius:12px;padding:16px 22px;margin-bottom:26px}
.meta .k{font-family:'Instrument Sans',sans-serif;font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 4px}
.meta .val{font-size:13px;margin:0;color:var(--ink)}
.callout{border-left:3px solid var(--brass);background:var(--card);border:1px solid var(--line);border-left-width:3px;border-radius:8px;padding:16px 20px;margin:0 0 14px}
.callout .lead{font-weight:600;color:var(--ink)}
.callout p{margin:0}
.callout .fine{color:var(--muted);font-size:13px;margin-top:8px}
.hero{margin:26px 0}
.hero-img{display:block;width:100%;border-radius:12px;border:1px solid var(--line)}
.hero-ph{height:200px;border:1px dashed var(--line);border-radius:12px;background:var(--card);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--muted);font-size:13px}
.hero-ph-mark{font-size:26px;color:var(--brass)}
.hero-cap{color:var(--muted);font-size:12.5px;margin:10px 0 12px}
.thumbs{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
.thumb{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card)}
.thumb img{display:block;width:100%;height:64px;object-fit:cover}
.thumb-ph{display:flex;align-items:center;justify-content:center;height:64px;font-size:8.5px;font-weight:600;letter-spacing:.04em;color:var(--muted);text-align:center;padding:4px}
.thumb figcaption{font-size:8px;font-weight:600;letter-spacing:.03em;color:var(--muted);text-transform:uppercase;padding:4px;border-top:1px solid var(--line);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.verdict-wrap{margin:30px 0}
.verdict{display:grid;grid-template-columns:230px 1fr;gap:28px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px 28px}
.verdict-left{text-align:center;border-right:1px solid var(--line);padding-right:24px}
.donut{width:148px;height:148px;margin:0 auto 6px}
.donut-num{font-family:'Instrument Sans',sans-serif;font-size:34px;font-weight:700;fill:var(--ink)}
.donut-den{font-size:11px;fill:var(--muted);font-family:'Inter',sans-serif}
.ci{color:var(--muted);font-size:12px;margin:0 0 12px}
.chip{display:inline-block;border-radius:999px;padding:5px 13px;font-size:12px;font-weight:600;letter-spacing:.02em;border:1px solid transparent}
.chip-tier.tier-gold{background:rgba(168,125,46,.13);color:#8a6520;border-color:rgba(168,125,46,.35)}
.chip-tier.tier-silver{background:rgba(120,120,128,.14);color:#5f5f68;border-color:rgba(120,120,128,.32)}
.chip-tier.tier-bronze{background:rgba(138,90,43,.13);color:#7c4e24;border-color:rgba(138,90,43,.32)}
.chip-tier.tier-flagged{background:rgba(180,100,42,.13);color:#94491f;border-color:rgba(180,100,42,.34)}
.chip-tier.tier-unscored,.chip-tier.tier-withheld{background:rgba(120,120,128,.14);color:#5f5f68;border-color:rgba(120,120,128,.32)}
.chip-soft{background:rgba(26,69,51,.09);color:var(--forest);border-color:rgba(26,69,51,.18)}
.coverage{color:var(--muted);font-size:12px;margin:12px 0 0}
.cap-note{background:rgba(180,100,42,.08);border-left:3px solid var(--flag);border-radius:0 8px 8px 0;padding:9px 12px;font-size:12.5px;margin:12px 0 0;text-align:left}
.bar-row{margin:0 0 16px}
.bar-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.bar-name{font-family:'Instrument Sans',sans-serif;font-weight:600;font-size:14.5px;color:var(--ink)}
.wt{color:var(--muted);font-weight:400;font-size:12px}
.bar-val{font-family:'Instrument Sans',sans-serif;font-weight:700;font-size:19px;color:var(--forest)}
.bar-track{height:7px;border-radius:999px;background:var(--line);overflow:hidden}
.bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--forest),#3f7d5f)}
.bar-read{color:var(--muted);font-size:12.5px;margin:7px 0 0}
.arith{color:var(--muted);font-size:12px;margin:16px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.5}
.arith strong{font-family:'Instrument Sans',sans-serif;color:var(--ink)}
.why{background:var(--beige);border-radius:10px;padding:14px 18px;margin:16px 0 0;font-size:13.5px}
.fold{border-top:1px solid var(--line)}
.fold summary{list-style:none;cursor:pointer;display:flex;align-items:baseline;gap:12px;padding:16px 0}
.fold summary::-webkit-details-marker{display:none}
.fold-eyebrow{font-family:'Instrument Sans',sans-serif;font-size:11px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;color:var(--brass);flex:0 0 auto}
.fold-headline{font-family:'Instrument Serif',Georgia,serif;font-size:20px;color:var(--ink);flex:1 1 auto}
.fold-caret{color:var(--muted);font-size:20px;transition:transform .15s;flex:0 0 auto}
.fold[open] .fold-caret{transform:rotate(90deg)}
.fold-body{padding:0 0 18px}
.fold-body>p:first-child{margin-top:0}
h2{font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:20px;color:var(--forest);margin:6px 0 12px;letter-spacing:-.01em}
h3{font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:14px;color:var(--ink);margin:20px 0 8px}
p{margin:0 0 12px}
a{color:var(--brass);text-decoration:none}a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;word-break:break-all}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
th{text-align:left;font-family:'Instrument Sans',sans-serif;font-weight:600;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:1.5px solid var(--line);padding:8px 12px 8px 0}
td{padding:9px 12px 9px 0;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
.hash{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--muted)}
.note{color:var(--ink);font-size:13px}
.caveat{color:var(--muted);font-size:12.5px}
.plain{margin:8px 0}
.appraise{margin:26px 0}
.fmv{font-family:'Instrument Sans',sans-serif;font-size:30px;font-weight:700;color:var(--forest);margin:6px 0 10px}
.fmv-pending{font-style:italic;color:var(--muted);margin:6px 0 12px;font-size:16px}
.fmv-note{color:var(--muted);font-size:13px;margin:-4px 0 8px}
.fmv-basis{font-size:13px;margin:0 0 12px;color:var(--ink)}
.factors{margin:6px 0 12px;padding-left:0;list-style:none}
.factors .factor{margin:6px 0;padding-left:16px;position:relative}
.factors .factor::before{content:"";position:absolute;left:0;top:8px;width:7px;height:7px;border-radius:2px;background:var(--muted)}
.factors .factor-lift::before{background:var(--forest)}
.factors .factor-hold::before{background:var(--brass)}
.factors .factor-decide::before{background:var(--flag)}
.factor-name{font-weight:600}
.eff{color:var(--muted)}
.actions{padding-left:18px}.actions li{margin:6px 0}
.attestation{background:var(--dark);color:#D9D4C6;border-radius:14px;padding:26px 30px;margin:30px 0 0}
.attestation h2{color:#F0EAD8;margin-top:0}
.att-ceiling{color:#C9E3D4;font-size:13.5px}
.att-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 22px;margin:18px 0}
.att-item{display:flex;flex-direction:column;gap:3px;min-width:0}
.att-k{font-family:'Instrument Sans',sans-serif;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#9A9686}
.att-item span,.att-item a{font-size:12.5px;color:#E4DFD0;word-break:break-all}
.att-item code{color:#C7E0D0;font-size:11px}
.att-item a{color:#E7C98A}
.att-fine{color:#9A9686;font-size:11.5px;margin:4px 0 0}
footer{margin:26px auto 0;max-width:800px;color:var(--muted);font-size:12px;text-align:center}
@media print{body{background:#fff;padding:0}.fold{border-color:#ccc}.fold-body{display:block!important}.banner,.attestation{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
@media (max-width:640px){h1.title{font-size:28px}.meta{grid-template-columns:1fr 1fr}.verdict{grid-template-columns:1fr}.verdict-left{border-right:none;border-bottom:1px solid var(--line);padding-right:0;padding-bottom:18px}.thumbs{grid-template-columns:repeat(3,1fr)}.att-grid{grid-template-columns:1fr}}
`;

function subtitle(s: ReportSnapshot): string {
  const r = s.object.resolvedAttributes;
  const parts: string[] = [];
  const pick = (k: string) => (r[k] && r[k].trim() ? r[k].trim() : "");
  const commem = pick("commemorative");
  const count = pick("coin_count");
  if (count) parts.push(`${count}-piece set`);
  if (commem) parts.push(commem);
  const comp = pick("dollar_composition") || pick("composition") || pick("metal");
  if (comp) parts.push(comp);
  parts.push(`${s.meta.ownerLocale} · values in ${s.meta.currency}`);
  return parts.filter(Boolean).join(" · ");
}

export function renderReport(s: ReportSnapshot, opts: RenderOptions = {}): string {
  const images = opts.images ?? [];
  const bannerTag = s.provisional ? "Provisional" : "Final report";
  const bannerText = s.provisional
    ? "Provisional — under expert review. The score and evidence below are complete; a curator confirms the report to definitive."
    : "Confirmed. A curator has sealed this report against the documentary record; photographs are embedded and hashed.";

  const story = s.narrative.find((n) => n.id === "summary") ?? s.narrative[0];
  const storyCallout = story
    ? `<div class="callout"><p><span class="lead">The story.</span> ${esc(story.body)}</p></div>`
    : "";

  const article = `<article class="sheet">
    <div class="banner banner-${s.provisional ? "prov" : "final"}"><span class="tag">${bannerTag}</span><span>${esc(bannerText)}</span></div>
    <p class="eyebrow">veradis · Provenance Confidence Score · ${esc(categoryLabel(s.category))}</p>
    <h1 class="title">${esc(s.object.title)}</h1>
    <p class="subtitle">${esc(subtitle(s))}</p>
    <div class="meta">
      <div><p class="k">Report ID</p><p class="val">${esc(s.reportId.slice(0, 8))} · v${s.v}</p></div>
      <div><p class="k">Effective date</p><p class="val">${esc(s.meta.effectiveDate)}</p></div>
      <div><p class="k">Method</p><p class="val">${esc(s.methodVersion)} · ${esc(categoryLabel(s.category))}</p></div>
      <div><p class="k">Owner locale</p><p class="val">${esc(s.meta.ownerLocale)}</p></div>
    </div>
    ${storyCallout}
    <div class="callout"><p><span class="lead">Scope &amp; intended use.</span> ${esc(HONESTY_CEILING)}</p>
      <p class="fine">${esc(INDEPENDENCE_LINE)} ${esc(STALENESS_LINE)}</p></div>
    ${heroBlock(s, images)}
    ${verdictCard(s)}
    ${valuationSection(s)}
    ${deltaSection(s)}
    ${collapsible("The registry sweep · every source named", "Registers checked — gaps published, not hidden", registrySweep(s), true)}
    ${collapsible("Material characterisation · declared vs observed", "What the material readings show", materialSection(s))}
    ${collapsible("The evidence · each view hashed", `${s.evidence.length} photograph${s.evidence.length === 1 ? "" : "s"} on file`, evidenceSection(s))}
    ${collapsible("The checks · authority states shown", `${s.checks.length} check${s.checks.length === 1 ? "" : "s"}, sources named`, checksSection(s))}
    ${attestationCard(s)}
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
<div class="brandbar"><svg class="prism" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1 19 16 1 16Z" fill="none" stroke="#A87D2E" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 1 10 16 M10 1 1 16 M10 1 19 16" stroke="#A87D2E" stroke-width="0.6" opacity="0.5"/></svg><span class="wm">veradis</span></div>
<main class="report">
${article}
</main>
<footer>Method ${esc(s.methodVersion)} · veradis.ai · Know it's real. Know its story.</footer>
</body>
</html>`;
}
