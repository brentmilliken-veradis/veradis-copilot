@AGENTS.md

# veradis PCS / Appraise Co-Pilot

## What this is
The fulfilment engine behind verify.veradis.ai: a paid order + photos → a provisional Verify (PCS) + Appraise report in minutes → a curator confirms → definitive.
**Read `docs/BUILD-KICKOFF.md` first — it is the master spec.** Canon lives in `docs/`: co-pilot spec v01/v02, P0 Build Plan, Dealer-Grade Expert-Panel review, Canonical Report Spec v03, Method v21 (methodology + algorithm). Build to the fixture in `docs/fixtures/PCS-CA-2026-0007/`.

## LLM vision is ALREADY WIRED — do not rebuild it
`packages/adapters/vision.ts` has a complete real adapter, **`ClaudeVisionAdapter`**. It reads the
object's photos, calls the Anthropic API, and returns `derivedAttributes` / `derivedCategory` /
`redFlags` that feed the Identity quadrant. It is NOT a permanent stub — it self-activates:
`getVisionAdapter()` returns the real adapter when **`VISION_API_KEY` (or `ANTHROPIC_API_KEY`) is set
AND a Storage is present**, else the `StubVisionAdapter`. Model default `claude-opus-4-8`,
override with **`VISION_MODEL`**. It downscales images (≤1568px, 413-safe), parses strict JSON, and
**falls back to the stub on any failure** — so a bad key degrades, never crashes.
- **The score stays deterministic.** Vision only supplies observed attributes (what's on the coin);
  the scorer that turns them into a number is still the pinned-seed engine. The LLM never scores.
- **Anti-hallucination contract** (the system prompt): read ONLY what's visible, never invent,
  never grade/value/authenticate. Hallmarks are observations, not conclusions.
- **The key lives in Vercel env, never git.** A new env var only takes effect on the next
  deployment — merging to `main` (which redeploys) is what binds it to the running cron functions.
- If Identity comes back starved (~12 raw, one check) on a real photographed object, the key is
  probably not bound in the live deployment — check Vercel env + redeploy, don't "fix" the scorer.

## Golden rules (non-negotiable)
- The LLM drafts NARRATIVE, never the score. The scorer is DETERMINISTIC (pinned seed, encoded from Method v21) — two runs must match to the digit. Seed = SHA-256 over `objectId|snapshotTs|"pcs-v01"`, PCG64 RNG, Cheng's beta sampler, 10k Monte-Carlo draws.
- Weights 30/30/25/15 (Identity/Custody/Material/Risk), shown on the report face. 95% CI, tier on the LOWER bound. Missing checks widen the CI, never lower the score. Risk cap ≤90 while `ALR_ENABLED=false`.
- Honesty ceiling (hard): "verified against the documentary record, expert-reviewed" — NEVER "authenticated." No percentage-of-value fees. Render pricing flat CHF 20 / CHF 40 for now.
- Corpus tiers: Tier-1 APIs = ground truth (can close a check); Tier 2–3 archives = corroboration (cite, adjust confidence); Tier-4 forums = cite-as-evidence, NEVER ingested as fact.
- Secrets are env-only (.env.local / Vercel env). Never commit or print a key. If a key is missing, stub the adapter behind a flag, log `STUBBED: <adapter>`, and continue.
- Proceed on the BUILD-KICKOFF §3 defaults. Escalate ONLY a true blocker.

## Stack & commands
- Next.js 16 (App Router) + React 19 on Vercel. **This Next is newer than training data — read `node_modules/next/dist/docs/` before writing route/page code (see AGENTS.md).**
- Dev `npm run dev` · Test `npm test` (Vitest) · Lint `npm run lint` (ESLint 9 flat config).
- The engine is pure TypeScript under `packages/*`, unit-tested with Vitest, imported via the `@/` alias.

## Data & infra
- Database = a dedicated **veradis-copilot** Supabase project via the Supabase MCP ONLY. NEVER touch operating-prod (`tchfcyvclcjchoodgdnx`).
- **The live Supabase project and paid API keys are NOT provisioned yet** (BUILD-KICKOFF §8, a human/CTO task). Until then: build against `InMemoryRepository` + seeded fixtures, and author `supabase/migrations/` SQL without applying it. External adapters (PCGS, Numista, embeddings, narrative) run as stubs behind flags **until their key is set**. Vision is the exception now live in prod — see "LLM vision is ALREADY WIRED" above.
- pgvector for the corpus; Supabase Storage for photos (both live-deferred).

## Git / deploy
- Feature branches `feat/E<n>-*`; commit per epic with clear messages; note assumptions + every stubbed adapter in the commit body. Keep the default branch green.
- The GitHub remote / Vercel connect are outward-facing setup steps — do NOT push or create the remote without explicit go-ahead. Commits stay local.

## Build order
Phase A (Coins engine) E1→E8 per BUILD-KICKOFF §7. Acceptance A = a real coin end-to-end → a provisional a curator confirms; a mislabelled coin auto-corrected; reproduce the 2007 RCM proof-set report incl. the v01→v02 evidence ladder. Stop at Phase A.
