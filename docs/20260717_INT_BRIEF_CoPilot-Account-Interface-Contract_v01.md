# CoPilot ↔ Account-Template — Interface Contract

**Date:** 2026-07-17
**Workstream:** INT
**From:** Build lane 13 (veradis-copilot)
**To:** Account-template session (verify-store / veradis-accounts)
**Purpose:** The two open coordinate items from the copilot live-wiring build (R-1, R-4), plus the standing contracts between the two lanes so nothing regresses. Neither open item needs new copilot code — both are integration on your side.

---

## Action needed (2)

### C-1 · Curator route auth — call it backend-to-backend with the shared secret
CoPilot exposes the curator action (confirm / downgrade / withhold + expert valuation band) as an authenticated endpoint. It is the pivot that seals a report to *definitive*, writes back to the customer's account under the service role, and emails the customer — so it is fail-closed and must never be publicly callable.

**Endpoint.** `POST /api/v1/curator` on the copilot deployment (`veradis-copilot.vercel.app`, or the custom domain once set).

**Auth.** `Authorization: Bearer <CURATOR_AUTH_SECRET>`.
- Unset secret → 500, zero work. Wrong/missing bearer → 401, zero work. Correct → proceeds.
- **The call must be server-to-server** — from your admin backend (a server function), never from browser JS. If the secret reaches the client, the guard is worthless.
- `CURATOR_AUTH_SECRET` is one shared value, set as a **server env var in both Vercel projects** (accounts admin + copilot). Rotate together.
- The human curator must already be authenticated by your admin surface (Supabase admin session) *before* your backend makes the call. CoPilot trusts the caller transitively — it does not re-authenticate the individual. (When there is more than one curator with distinct permissions, we move to a forwarded Supabase admin JWT; not now.)

**Request body.**
```
{
  "reportId":  "<accounts reports.id>",
  "verb":      "confirmed" | "downgraded" | "withheld",
  "curator":   "Brent Milliken",              // optional; recorded in the audit trail
  "credentialClass": "curator",               // optional; defaulted server-side
  "downgradeTo": "silver",                     // required only when verb = downgraded
  "valuationBand": { "currency": "CAD", "lo": 1200, "hi": 1800 }  // Appraise only
}
```

**Behaviour to build against.**
- **Confirmed / downgraded** → copilot mints the definitive version, re-delivers to the object, and emails the customer (EMAIL C). Downgrade never inflates the tier.
- **Withheld** → refund path, no deliverable.
- **A capped report** (uncalibrated category, or a vision-only category re-route) **cannot be confirmed** — copilot returns 400. It can only be withheld, or confirmed later once the category is calibrated. Your admin UI should expect and surface this.
- **`valuationBand`** is Appraise-only and validated (`0 ≤ lo ≤ hi`, never `0–0`). Invalid → 400 with **no** side effect. This is the *only* way a valuation number enters a report — the engine never invents one. The band-entry field lives in your admin flow.

**Response.**
```
{ "report": {...}, "action": {...}, "version": { "v": 2, "tier": "silver" } | null,
  "delivery": { "delivered": true, "filePath": "..." } | { "delivered": false, "reason": "..." } }
```
A `delivery.delivered = false` means the confirmation *took* but the write-back to the accounts row didn't — surface it so the curator can retry; the confirmation itself is not lost.

---

### C-2 · Collections card — render a missing `pcs_score` as "under review," not "0"
On delivery, copilot writes the accounts `reports` row: `status='delivered'`, `file_path`, `pcs_score`, `valuation`, `delivered_at`.

**The contract on `pcs_score`:**
- Present (integer 0–100) for a normally-scored report.
- **Absent / null for a capped report** — an uncalibrated category or a vision-only re-route. These are honest "provisional, not yet calibrated" results, and a bare confident number next to them would misrepresent them.

**What to build:** the collections card must render a null/absent `pcs_score` as an honest pending state — **"Provisional — under review"** (or your equivalent) — **not "0", and not a blank or broken badge.** No schema change is needed (`pcs_score` is already nullable). The delivered report file (`file_path`) always carries the full honest verdict — Flagged tier, composite/CI, and the "not yet calibrated" line — so the customer sees the complete picture on open; only the card's summary badge withholds the bare number.

Net effect: a normal provisional shows its number; a capped one shows "under review." That split is the honest outcome. *(Optional, not required for launch: if you want a distinct visual for "uncalibrated category" vs. "awaiting curator confirmation," add a flag column and we'll populate it — but omission is sufficient.)*

**`valuation`** is written only when a real expert-set band exists (never `0–0`) — render it only when present.

---

## Standing contracts (already met — do not regress)

- **Pull queues.** CoPilot reads `reports` (status `in_production`) and `enrichment_jobs` (status `queued`). It claims an enrichment job with a conditional `queued → running` PATCH (compare-and-swap) — so if you also process that queue, expect copilot to own any row it has moved to `running`. *(Please ack that copilot owns the enrich claim, or tell us if you'd rather own it.)*
- **Write surface.** CoPilot writes only: the `reports` delivery row (above), and the living-layer tables (`enrichment_events`, `object_links`, `collection_valuation`, and the `objects` enrich columns) in the exact `admin-enrich.js` shapes. Nothing else, ever.
- **Feed text is plain text.** `enrichment_events.title` / `.body` are plain strings (they can contain an owner's object title verbatim). Render them as text (`textContent` / escaped), **never as HTML** — otherwise an object title becomes a stored-XSS vector. `narrative_html` is the only field that is intended HTML, and copilot escapes its inputs.
- **Lane boundaries.** CoPilot does not touch your files (`verify-store/*`, the account app `api/*`, `index.html`) or the `veradis-accounts` schema. You own those; we own `06-prototype`/copilot.

---

## Bottom line
C-1 is an integration contract (server-to-server secret, admin-gated). C-2 is one empty-state check on the card. Both are on your side; copilot is built and waiting. Once both are confirmed and the copilot env + migration 0003 are in place, we merge, deploy behind the cron secret, and verify one real object end-to-end before the customer path is flipped.
