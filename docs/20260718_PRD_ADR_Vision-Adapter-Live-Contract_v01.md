# ADR — LLM vision is a live, self-activating adapter (not a permanent stub)

Date: 2026-07-18 · Workstream: PRD · Status: Accepted · Owner: Brent (until CTO onboards, month 2)

## Context

The PCS/Appraise engine scores four quadrants — Identity, Custody, Material, Risk. Identity
depends on knowing *what the object actually is* (country, denomination, year, mint mark, variety,
maker, portrait, legend). For a photographed object with a thin or sloppy owner description, the
only way to populate those attributes is to **read the photos**.

A real vision adapter, **`ClaudeVisionAdapter`**, was built for exactly this and has been in
`packages/adapters/vision.ts` for some time. It was easy to mistake for a stub because it ships
alongside `StubVisionAdapter` and only activates when a key is present. A fresh session that didn't
read the adapter assumed vision was unimplemented and tried to compensate inside the deterministic
scorer — the wrong layer. This ADR records the design so that never happens again.

## Decision

Vision is a first-class, self-activating adapter. It is documented at the top of `CLAUDE.md`
("LLM vision is ALREADY WIRED") and its contract is fixed as follows.

**Activation.** `getVisionAdapter(scenarios, storage)` returns the real `ClaudeVisionAdapter` when
`VISION_API_KEY` (or `ANTHROPIC_API_KEY`) is set **and** a Storage is available to load image
bytes; otherwise it returns `StubVisionAdapter`. No code change is needed to switch modes — only
the environment.

**What it does.** Loads the object's photos, downscales each to ≤1568px (keeps the request under
the 413 payload ceiling), base64-encodes them, calls the Anthropic API, and parses strict JSON into
`derivedAttributes`, an optional `derivedCategory`, and `redFlags[]`. Model defaults to
`claude-opus-4-8`, overridable with `VISION_MODEL`. On any failure — missing key, no images, bad
JSON, API error — it **falls back to the stub**. A bad key degrades the report; it never crashes
the pipeline.

**What it must never do.** Vision supplies *observed attributes only*. The score that turns those
attributes into a number is still the deterministic, pinned-seed engine (Method v21). The LLM never
scores, grades, values, or authenticates. Its system prompt enforces this: read only what is
visible, never invent, hallmarks are observations not conclusions.

**Operational binding.** The key lives in Vercel env, never in git. A newly added env var only
reaches the running cron/serverless functions on the **next deployment** — so a merge to `main`
(which redeploys) is what actually binds `VISION_API_KEY` to production. Adding the key in the
dashboard without a redeploy leaves the old deployment blind.

## Consequences / diagnostics

The tell-tale signature of vision **not** firing on a real photographed object is a starved
Identity quadrant: raw ≈ 12, a single check, CI floor at 0 — while Material and Risk look healthy.
Seen that? The fix is environment, not code: confirm `VISION_API_KEY` is set in Vercel **and** that
a deployment has happened since. Do not "correct" the scorer to paper over a blind adapter — that
would trade an honest low score for a confident wrong one, which is the one failure mode that kills
the company.

## For the record (team handoff)

When the CTO and Product hires land, this is the one-paragraph brief: vision is real and wired,
lives in `packages/adapters/vision.ts`, activates on an env key, feeds Identity, and keeps the score
deterministic. It is not on the "still to build" list. The remaining work is calibration and
corpus, not wiring.
