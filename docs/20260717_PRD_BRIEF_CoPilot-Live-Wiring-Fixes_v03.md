# CoPilot Live-Wiring — Pre-Deploy Fix Brief (v03)

**Date:** 2026-07-17
**Workstream:** PRD (build lane 13)
**For:** CC (Claude Code) — veradis-copilot repo
**Follows:** `20260717_PRD_BRIEF_CoPilot-Live-Wiring-Build_v02.md` (build), `20260717_OPS_RPT_CoPilot-Red-Team-Pre-Deploy_v01.md` (findings)
**Status:** Blocks deploy of the live customer path. Manual admin delivery stays the fallback until this lands.

---

## 0. Read first

Three independent red-team passes (correctness, honesty, security) all returned deploy-blocker. This brief fixes the six blockers plus the should-fix cluster. Every fix is grounded against the actual code below with file:line refs.

**Golden rules that govern this brief (do not weaken):**
- The deterministic scorer owns the number. The LLM drafts narrative, never the score — and by extension never the *inputs* to the score, except to *withhold or downgrade*.
- A thin-source / uncalibrated category can never present a confident tier. Provisional/flagged only until calibration lands.
- Honesty ceiling: "verified / expert-reviewed", never "authenticated". Never a fabricated number.
- Confident-wrong is the brand-killer. When unsure, withhold.

**Lane:** copilot only. All code lives under `packages/*`, `app/api/v1/cron/*`, `app/lib/*`, and copilot Supabase migrations. Do **not** touch the account-template's files (`verify-store` / account-app `api/*`, `index.html`). Writes to the veradis-accounts DB stay inside the existing PULL/queue contract (read `reports` in_production + `enrichment_jobs` queued; write back `reports` delivery + living-layer tables). Two items below use the shared accounts tables in new-but-in-contract ways (F-5 reaper, F-9 event escaping) — those are flagged **COORDINATE** and must be raised with the account-template session before merge.

**Process:** conventional commits, sequential copilot migrations, Vitest tests required for every fix (DB-write / money / tenancy fixes are non-negotiable). tsc strict + eslint clean.

**GitHub is the one source of truth.** The live-wiring build is 12 local commits currently unpushed (branch `feat/brand-logo`, 11 ahead of `origin/feat/brand-logo` — only the brand-logo commit was ever pushed). **First action, before any fix:** rename the branch to `feat/live-wiring` and push it, so GitHub reflects the real state of the build. Then land each fix as commits on that branch and **push as you go** — nothing stays local. **Do NOT merge to `main` and do NOT deploy** until every fix has landed and the diff is re-red-teamed; `main` stays the deployable last-safe state, and Production env / the Vercel crons are not touched until then. When done, report back for the re-red-team.

---

## 1. Decisions — all three confirmed by the founder

Nothing is blocked on a decision. Build all of F-1…F-12.

**D-1 — Thin-source cap (F-1) — CONFIRMED (cap to Flagged).** Add `calibration: "calibrated" | "provisional"` to the category profile schema; default `provisional` for `art`, `watches`, `fine-china` (and any profile without a Tier-1 corpus). After `scorePcs`, an uncalibrated category's presented tier is capped at **Flagged** and the report forced **provisional** — composite and CI stay visible, but no Gold/Silver/Bronze is sealed and a curator cannot confirm it to definitive while uncalibrated. Build per F-1.

**D-2 — Vision may only downgrade (F-2) — CONFIRMED (CTO-hat approved).** Extend the ADR-001 "critic can only withhold/downgrade" rule to the vision stage. A vision-derived attribute that *differs* from the owner's declaration may raise a correction/red-flag and *lower or withhold* confidence, but an uncorroborated vision value does **not** replace the declared attribute as scored ground-truth, and a vision-only category re-route forces the report **provisional/flagged** (never a sealed definitive tier). Build per F-2, at the ingest→enrich seam so the scorer core stays pure.

**D-3 — Appraise SKU (F-8) — CONFIRMED: keep Appraise, fix the number.** veradis does not sell certified appraisals, and the report already says so — `HONESTY_CEILING` in `render.ts:24` reads "expert-reviewed… not a certificate of authenticity and not a certified appraisal." That positioning is correct and stays; Appraise stays on sale. The only defect is the fabricated `0–0` band. The engine must never emit an invented value: a provisional Appraise shows "Indicative value — under expert review" (no number), and the indicative band is expert-set at curator confirm, rendered under the existing honesty ceiling. An automated comps-based valuation is a separate post-launch build (category-by-category, liquid categories — coins, watches — first) and is **not** in this brief. Build per F-8.

---

## 2. Blockers (must fix before the live path carries a customer)

### F-1 · Enforce the thin-source cap in code (honesty, CRITICAL) — needs D-1

**Problem.** `packages/profiles/data/art.v1.json:4` (and watches/fine-china) carries the provisional intent only as a `label` string: `"… provisional/flagged only until Tier-1 + calibration land"`. Nothing reads it. `packages/pipeline/run.ts:164` scores, `:214` maps `statusForTier(score.tier)` → status, and `packages/report/render.ts:44-49` renders whatever tier came out. An art object that scores Gold on the numbers renders a confident Gold verdict it has not earned.

**Fix.**
1. Add `"calibration": "provisional"` to `art.v1.json`, `watches.v1.json`, `fine-china.v1.json`; add `"calibration": "calibrated"` to the mature category profiles (coins, medals, etc.). Extend the `CategoryProfile` type + profile loader to carry it (default to `"provisional"` when absent, so a new profile is safe-by-default).
2. In `run.ts`, after `scorePcs` and after any ingest re-route (so the cap keys off the *resolved* profile), apply a pure `capTier(tier, profile.calibration)`:
   - `calibrated` → tier unchanged.
   - `provisional` → tier is clamped so it can never be Gold/Silver/Bronze; a scored result becomes **Flagged**; Unscored/Withheld stay as-is. Composite + CI are preserved in the snapshot unchanged (reproducibility holds — the cap is deterministic).
3. `statusForTier` / `assertTransition`: a capped (provisional-category) report resolves to **provisional** status and is not eligible for curator confirm-to-definitive. Gate the E7 confirm path on `profile.calibration === "calibrated"`.
4. `render.ts`: when the category is uncalibrated, the verdict block shows the Flagged treatment + an explicit line ("This category is not yet calibrated; result is provisional pending Tier-1 sources"). Keep the composite/CI visible.

**Acceptance.** An `art` object whose raw score is Gold seals as **Flagged / provisional**, renders the uncalibrated line, and cannot be confirmed to definitive. A `coins` object is unaffected. `capTier` is a pure, unit-tested function. The cap is driven by profile data, not a hardcoded category list.

**Tests.** Unit: `capTier` truth table across all six tiers × {calibrated, provisional}. Pipeline: art-scores-gold → sealed Flagged/provisional; coins-scores-gold → Gold. Guard: curator confirm rejected for a provisional-category report.

---

### F-2 · Vision cannot move the score (honesty, CRITICAL) — needs D-2

**Problem.** `packages/ingestion/ingest.ts:89-110` overwrites declared identity attributes with vision-derived ones (`resolvedAttributes[key] = derived`) and re-routes the whole category on `vr.derivedCategory` (`:71-84`). Those resolved attributes + category feed `enrich` → `scoreInputs` → `scorePcs` (`run.ts:151-164`). The only guardrail is the "never invent" instruction in `packages/adapters/vision.ts:84-93`. A prompt is not an enforcement boundary: a vision hallucination changes the deterministic number by proxy.

**Fix (mechanism per D-2 — vision downgrades, never upgrades).**
1. **Uncorroborated vision attribute changes don't earn identity points.** When a vision-derived identity value *differs* from the declaration and has no corroborating source, record the correction (kindness register, as today) but mark that identity key **unverified** for scoring — the scorer must not treat a vision-only value as a confirmed identity match that *raises* the composite. Confirmations (vision agrees with declaration) are fine. Red flags (vision sees a problem) flow through as today and *lower* confidence.
2. **Vision-only category re-route → provisional.** A re-route driven solely by `vr.derivedCategory` (no corroborating evidence) forces the report **provisional/flagged** (compose with F-1's cap) and can never seal a definitive tier on the strength of the model's category call alone.
3. Keep the echo-declared safety net (`vision.ts:218-221`) — an omitted attribute stays at the declared value. The change is specifically: a *differing* vision value may correct/flag/downgrade but not silently become the scored ground-truth that lifts the number.

**Boundary note for CC.** This changes what feeds `scoreInputs`. Implement it at the ingest→enrich seam (mark keys verified/unverified) rather than inside the scorer core, so `scorePcs` stays a pure function of its inputs. If the cleanest cut needs a scorer-input shape change, stop and flag it — that's a CTO-gated ADR touch.

**Acceptance.** A crafted vision result that "upgrades" an attribute (e.g., a better maker than declared) with no source cannot raise the composite above the declared-only baseline; it appears as a correction and, if it changes identity, lowers/withholds. A vision-only re-route yields a provisional report. Vision red flags still downgrade as before.

**Tests.** Unit: ingest marks a differing-uncorroborated identity key unverified. Pipeline: "vision upgrades maker, no source" → composite not raised vs. declared baseline. Pipeline: vision-only re-route → provisional. Regression: vision-confirms-declaration → unchanged score.

---

### F-3 · Cron auth must fail closed (security, HIGH)

**Problem.** `app/api/v1/cron/reports/route.ts:15-21` and `app/api/v1/cron/enrich/route.ts:15-21`: `if (secret) { …check… }`. If `CRON_SECRET` is unset, the check is skipped and the endpoint runs unauthenticated with service-role writes → anyone can trigger production/enrichment (data integrity + denial-of-wallet on Anthropic).

**Fix.** Fail closed in both routes: if `CRON_SECRET` is unset/empty → return 500 `{ error: "cron secret not configured" }` and do no work. If set → require `authorization === "Bearer " + secret`, else 401. Use a length-constant comparison.

**Acceptance.** No `CRON_SECRET` → 500, zero DB reads/writes. Wrong/absent bearer → 401. Correct bearer → runs.

**Tests.** Route tests for all three states, both endpoints. Assert no accounts/repo calls happen on the 500/401 paths.

---

### F-4 · Cross-tenant ownership checks (security, HIGH)

**Problem.** `packages/pollers/reports.ts:120` fetches `getObject(row.object_id)` with no check that `obj.user_id === row.user_id`, then renders/delivers → cross-tenant read/exfil via a crafted or mismatched id. Same class in the enrich handlers (`packages/enrich/living.ts:198,236`) which trust `job.object_id` / `job.user_id` without verifying the object belongs to the job's user.

**Fix.**
- `reports.ts processAccountsReport`: after `getObject`, if `!obj || obj.user_id !== row.user_id` → `failed` ("object/owner mismatch"), never render/deliver.
- `living.ts handleReverify`: assert each `listInProductionReports(job.object_id)` row has `user_id === job.user_id` before running; skip/fail mismatches.
- `living.ts handleNarrative` / any handler using `job.object_id`: fetch the object and assert `obj.user_id === job.user_id` before writing events/links/narrative to it.
- `writeLinks` already scopes by the passed `userId`; keep every insert's `user_id` bound to the job's user, never an object-derived value.

**Acceptance.** A report row whose `object_id` belongs to another user is never produced or delivered. An enrich job referencing another tenant's object writes nothing and fails with a clear reason.

**Tests.** Poller: mismatched object owner → failed, no deliverReport call. Enrich: reverify/narrative with cross-tenant object_id → failed, no writes.

---

### F-5 · Atomic claim + terminal failure on both queues (correctness/cost, HIGH) — F-5b COORDINATE

**Problem A (double-run).** Neither queue claims work atomically. Two overlapping cron ticks both drain the same rows → double pipeline runs, double Anthropic spend, duplicate reports (`reports.ts:182-192`, `living.ts:258-274`).

**Problem B (re-burn + leak).** `reports.ts:151` creates the copilot `orders` row *after* `runProvisional` (`:147`). A pipeline that throws leaves no order, so the next tick re-runs the *full paid pipeline* and re-inserts report/evidence/photo rows every tick — infinite re-burn + row leak for any permanently-failing row.

**Fix — reports queue (F-5a, copilot lane, no accounts schema change):**
1. Add copilot migration `0003`: `orders` gains `production_state text not null default 'producing'` (`producing | produced | failed`), `attempts int not null default 0`, `claimed_at timestamptz`, `last_error text`.
2. Reorder `processAccountsReport`: do the cheap reads (`getObject`, ownership check from F-4, `getProfile`) first, then **claim by inserting the order** with `production_state='producing'`, `attempts=1`, `claimed_at=now`. The `orders.id` PK **is** the atomic claim — wrap `createOrder` in try/catch; a unique-violation means another tick owns it → return `skipped("claimed")`. Only after a successful claim run `runProvisional`.
3. On success → `updateOrder(production_state='produced')`, deliver as today.
4. On pipeline throw → `updateOrder(production_state='failed', last_error=…)` (or `'producing'`→retry while `attempts < 3`, incrementing). A `failed` order is skipped on future ticks and surfaced to the admin queue / curator email, not retried forever.
5. The top-of-function existing-order branch becomes state-aware: `produced` → retry delivery only (today's behaviour); `producing` older than a staleness window (e.g. 15 min) → reclaim (crash recovery); `producing` fresh → skip; `failed` → skip (already surfaced).

**Fix — enrich queue (F-5b, COORDINATE — uses accounts `enrichment_jobs` status, within the existing write surface):**
1. Replace the unconditional `updateJob(status:'running')` (`living.ts:263`) with a **conditional claim**: PATCH `enrichment_jobs SET status='running', started_at=now WHERE id=X AND status='queued'` with `Prefer: return=representation`; if it returns no row, another tick claimed it → skip. Add `claimJob(jobId): Promise<boolean>` to the accounts adapter.
2. This uses columns/semantics the account-template owns — raise it with them before merge (they may prefer to own the claim). No new columns needed.

**Acceptance.** Two concurrent ticks over the same queue produce each report/job exactly once (one claims, the other skips). A pipeline that throws does not re-run the full paid pipeline next tick; after N attempts the row is `failed` and surfaced. A crashed `producing` row is reclaimed after the staleness window.

**Tests.** Concurrency: two `pollReports` runs over one in_production row → one delivered, one skipped, one `runProvisional` call. Failure: throwing pipeline → order `failed`, next tick skips, no second pipeline run. Recovery: stale `producing` → reclaimed. Enrich: two `runEnrichmentJobs` over one queued job → one running-claim wins.

---

### F-6 · Bounded report lookup by order id (correctness, HIGH)

**Problem.** `reports.ts:109` `(await deps.repo.listReports()).find(r => r.orderId === row.id)` pulls *all* reports and filters in memory. PostgREST caps at 1000 rows silently → past 1000 reports the delivery-retry lookup misses and re-delivery breaks.

**Fix.** Add `getReportByOrderId(orderId): Promise<Report | null>` to the repository (both `SupabaseRepository` — `report?order_id=eq.<id>&limit=1` — and `InMemoryRepository`). Replace the `listReports().find` call. Audit for any other unbounded `listReports()`/`list*()` on a hot path and bound them too.

**Acceptance.** Delivery-retry finds the produced report regardless of table size; no full-table scan on the poller path.

**Tests.** Unit: `getReportByOrderId` hit/miss. Poller: produced-but-not-delivered retry finds its report with >1000 rows present (or a mocked cap).

---

## 3. Should fix in the same pass

### F-7 · Photo path traversal (security, MEDIUM)
`packages/adapters/accounts.ts:117` `encodePath` keeps `..` and `/` (`encodeURIComponent('..')==='..'`), so a hostile `photo_paths` entry like `a/../../b` escapes the bucket in the storage URL. **Fix:** validate before encoding — reject any path with an empty, `.`, or `..` segment, a leading `/`, or a backslash; throw/skip on violation. Apply to both `downloadObjectPhoto` and `uploadReportFile`. **Test:** traversal inputs rejected; normal `userId/report.html` passes.

### F-8 · Appraise emits a fabricated `0–0` band (correctness/honesty, HIGH) — COORDINATE
**Problem.** `run.ts:175-186` and `packages/delivery/bridge.ts:61` build the appraise valuation with `fmvLo/fmvHi = 0` and empty comps, so every Appraise delivers a `0–0` band — an invented number. (The collection roll-up is safe: `parseValuationBand` at `living.ts:57-64` already rejects `0–0`.) Appraise stays on sale (D-3); the bug is the fabricated number, not the product.
**Fix (expert-assigned indicative value, never fabricated).**
1. Kill the hardcoded zeros. The pipeline must not synthesise a valuation band. A provisional Appraise carries **no** number — `valuation` is `undefined` at the provisional stage.
2. Render honestly: with no band, the valuation section shows "Indicative value — under expert review" (no figure), under the existing `HONESTY_CEILING` ("expert-reviewed… not a certified appraisal"). Never render `0–0` or an engine-invented range.
3. The indicative band is **expert-set at curator confirm (E7)** and flows through the delivery bridge onto `reports.valuation` as today (format "CCY lo–hi"); the confirmed report renders that expert band. The curator band-entry UI lives in the account-template admin flow → **COORDINATE** so confirm can capture a valuation.
4. Keep the independence line already in `render.ts` (the fee does not depend on the value concluded).
**Acceptance.** No code path renders `0–0` or an engine-invented value. A provisional Appraise shows "under expert review"; a confirmed Appraise renders the expert-set band under the not-a-certified-appraisal ceiling; the collection roll-up still sums only real delivered bands.
**Tests.** Provisional appraise snapshot → no numeric band, shows the review line. Confirmed appraise with expert band "CAD 1200–1800" → renders that band. Guard: no snapshot serialises `fmvLo/fmvHi = 0` as a shown value.

### F-9 · Stored-XSS surface in the living feed (security, MEDIUM) — COORDINATE
`living.ts:102,141,212` interpolate owner-controlled `title`/`maker` into `enrichment_events.body`/`title` unescaped. If the account-app feed renders `body` as HTML, a title like `<img onerror=…>` executes. **Fix depends on the feed:** confirm with the account-template session whether the feed renders event `body`/`title` as text or HTML. If HTML → escape at the engine (reuse the `esc` already in `living.ts:47`). If text (likely) → no engine change, but document the contract ("event body/title are plain text; render as textContent"). Don't blind-escape into a text field (double-encoding). **Test:** if escaping, a `<script>`-bearing title is inert in the stored body.

### F-10 · Relink off-by-one (correctness, MEDIUM)
`living.ts writeLinks` with `onlyFrom` iterates `rest = group.slice(1)`, so when the relinked object isn't the group `head`, the `(onlyFrom → head)` pair is missed. **Fix:** for the `onlyFrom` case, pair the relinked object with *every other* same-maker object in the group (not `group`-minus-`head`). **Test:** a 3-object same-maker group, relink on the non-head object → links to both others.

### F-11 · Mixed-currency valuation sum (correctness, MEDIUM)
`living.ts:160-167` sums `lo`/`hi` across all delivered appraisals but labels the total `bands[0].currency`, so CAD+USD bands are added as if one currency. **Fix:** group bands by currency; sum only within a currency. If multiple currencies, present the dominant-currency subtotal with `basis:"partial"` and a note naming the excluded currencies (do not FX-convert without a rate source). **Test:** mixed CAD/USD appraisals → no cross-currency sum; basis `partial` + note.

### F-12 · Don't lose the curator email; don't leak upstream error bodies (LOW)
- `reports.ts:160-163` `await sendCuratorReview(...)` can throw and fail the whole row; on retry the existing-order branch returns early and the curator review email is never sent. **Fix:** wrap in try/catch (log, record intent in `email_log`), don't fail the row on a notify error; add a lightweight retry path.
- `accounts.ts` / `supabase.ts` throw `…${status} ${await res.text()}` and those messages become per-row `reason`/`detail` in cron responses. **Fix:** log full upstream detail server-side; return a generic reason to the response surface.

---

## 4. Out of scope / do not touch
- account-template files: `verify-store/*`, account-app `api/create-checkout-session|stripe-webhook|reverify|admin-enrich|admin-deliver-report`, `index.html`, and the veradis-accounts **schema** (no new columns/status on `reports` or `enrichment_jobs` — F-5b uses existing columns only).
- seaforth-operating-prod: never.
- The deterministic scorer core (`packages/pcs-core`): F-1/F-2 attach at the pipeline/ingest seams, not inside `scorePcs`. If a fix seems to need a scorer-core change, stop and flag it.
- Stripe test→live: gated on SARL, not this brief.

## 5. Definition of done
- F-1…F-6 landed with tests; F-7, F-9, F-10, F-11, F-12 landed with tests; F-8 fixed per D-3 (no fabricated value; expert-set band).
- `tsc` strict + eslint clean; full Vitest suite green (report the new count).
- Branch renamed to `feat/live-wiring` and **pushed to GitHub** with each epic as you go (GitHub = source of truth). Do **not** merge to `main` or deploy; `main` stays the last-safe state until the re-red-team passes.
- COORDINATE items (F-5b, F-9) raised with the account-template session; note their response in the completion report.
- Completion report lists each epic, the tests added, and anything you had to flag (CTO-gated seams, coordination answers). Then we re-red-team the diff — specifically the two honesty gates (F-1 cap enforced in code; F-2 vision can't raise the number) and the two security doors (F-3, F-4), because those are the ones a prompt tweak can silently un-fix.
