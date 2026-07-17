# CoPilot — Cleanups + Merge Prep

**Date:** 2026-07-17
**Workstream:** PRD (build lane 13)
**For:** CC (Claude Code) — veradis-copilot, branch `feat/live-wiring`
**Follows:** v04 fixes (re-verified — all six R-items wired, tests real, no regressions).
**Status:** Two one-line cleanups + prep the branch for merge. **Do NOT merge to `main`, do NOT deploy, do NOT expose the curator route** — that's gated on env vars being set and a one-object end-to-end verify behind the cron secret.

---

## Cleanup 1 · Withhold must not be blocked by a stray valuation band
`packages/curator/confirm.ts`. R-6 moved the `valuationBand` validation above the `withheld` early-return, so a `withheld` call that happens to carry a band (e.g. the admin form left a band field populated) now throws a 400 instead of withholding. A withhold never applies a band, so it should never validate one.

**Fix.** Scope the `valuationBand` block to non-withheld verbs — e.g. only run the "no valuation section" + `0 ≤ lo ≤ hi` / not-`0–0` checks (and the band apply) when `input.verb !== "withheld"`. The cap gate and `addCuratorAction` ordering stay as they are (validation still before the audit action for confirm/downgrade).

**Tests.** `withheld` + a `0–0` band (and a band on a Verify report) → withholds successfully, no throw, `version: null`, exactly one curator action. Confirm/downgrade + invalid band → still throws with **zero** curator actions (unchanged from R-6).

## Cleanup 2 · The email sweep can't sink a tick
`packages/pollers/reports.ts` — `pollReports` calls `sweepCuratorEmails(deps)` (~line 322) outside any guard. The per-report loop inside the sweep is already try/caught, but if `listReportsByStatus` itself throws, the exception propagates out of `pollReports` after row side effects have already committed.

**Fix.** Wrap the `sweepCuratorEmails` call in a try/catch: log and continue, still return the `PollSummary`. A curator-email sweep failure must never fail the whole tick.

**Tests.** A throwing `listReportsByStatus` → `pollReports` still returns its summary (optional but preferred).

---

## Merge prep (prepare only — do not merge/deploy)
1. Land each cleanup as its own conventional commit; push to `feat/live-wiring`.
2. Full green gate: `vitest` suite, `tsc` strict, `eslint` — all clean. Report the new test count.
3. Open (or update) the PR `feat/live-wiring` → `main` with a concise summary covering the whole live-wiring body of work (E-A…R-punch-list): the pull/queue contract, the honesty gates (thin-source cap, vision downgrade-only), the security doors (cron + curator fail-closed, tenancy), the atomic claim, and the Appraise number-honesty. Note migration `0003` is already applied to the copilot Supabase project.
4. **Stop there.** Do not merge, do not deploy, do not touch Production env or register the crons. Merge → deploy happens after the env vars are set and we watch one real object go produce → deliver → confirm behind the cron secret.

## Report back
New test count; confirm both cleanups pushed; PR open/updated against `main`; `main` still untouched at `3604baf`; nothing deployed.
