# CoPilot — Vision Image-Sizing Fix (413 on photo-heavy objects)

**Date:** 2026-07-17
**Workstream:** PRD (build lane 13)
**For:** CC (Claude Code) — veradis-copilot, branch `feat/live-wiring`
**Surfaced by:** the live production verify (2026-07-17). The Art appraise passed end-to-end with all honesty gates firing; the Coins verify (7 photos) failed at the vision step.
**Status:** Blocks photo-heavy objects from completing. Copilot-lane, one adapter.

---

## Symptom
On the live run, the Coins/Verify object (Canadian Proof Set, **7 photos**) failed production with:

```
vision:claude 413 { "error": { "type": "request_too_large", "message": "Request exceeds the maximum size" } }
```

The Art/Appraise object (**5 photos**) completed fine. So it's a size threshold, not a logic bug.

## Root cause
`packages/adapters/vision.ts` (`ClaudeVisionAdapter.analyze`) base64-encodes **every** evidence image at **full resolution** and sends them all in **one** Anthropic `/v1/messages` request (`vision.ts:180-185`), with no downscale, no per-image cap, and no total-payload cap. iPhone JPEGs are ~3–5 MB each; base64 inflates ~33%, so 7 photos blow past Anthropic's request-body limit (~32 MB) → HTTP 413. (`normalizePhoto` in `packages/adapters/photos.ts` converts HEIC→JPEG but does **not** resize — images stay full-res.)

Anthropic downscales anything over **1568 px** on the long edge server-side anyway, but only *after* the request body is received — so a full-res base64 payload still counts against the size limit before it's shrunk. The fix is to downscale client-side, before encoding.

---

## Fix (packages/adapters/vision.ts)

**1. Downscale each image before base64 — vision copy only.**
Add a `downscaleForVision(bytes)` step applied to each image right before `toBase64` (`vision.ts:180-185`): decode → if long edge > **1568 px**, resize to 1568 px long edge (preserve aspect) → re-encode **JPEG quality ~80**. After this, each image is ~150–300 KB, so 7 photos ≈ 1–2 MB total — comfortably under the limit.
- Use a **pure-JS** resizer to match the repo's existing no-native-binary constraint (`heic-convert` was chosen precisely because it's "Vercel-safe, no native binary" — see `photos.ts` header). **`jimp`** does decode + resize + JPEG re-encode in pure JS. (`sharp` is faster but native; only use it if you're comfortable adding a native dep — the pure-JS path is the safer default here.)
- **Do not** change the stored evidence bytes or their SHA-256. The downscale is a throwaway copy sent to the LLM only; the evidence hash must remain the original bytes' hash for integrity/audit. (Confirm the `evidence_item.sha256` written at intake is unaffected.)

**2. Total-payload safety cap (no silent truncation).**
After downscaling, if the combined encoded payload would still exceed a safe threshold — set it to **~20 MB** (well under Anthropic's ~32 MB) — cap the number of images sent: send the profile's **required/core capture slots first** (they carry the identity signal), then fill the remaining byte budget in slot order, and **`console.warn` exactly which slots were dropped** (operating rule: no silent truncation — a bounded set must be logged). In practice the downscale makes this cap almost never fire, but it guarantees a 20-photo object can never 413.

**3. Per-image guard.**
Anthropic caps a single image at 5 MB (base64). After the 1568 px downscale every image is far under, but assert/skip-with-log if any single encoded image still exceeds ~4.5 MB — never send an over-limit image.

**4. No honesty-logic change.**
This is purely a transport/size fix. F-2 (vision may only downgrade) and the stub-fallback behaviour are unchanged. Don't touch `parseVisionJson`, the system prompt, or the ingest seam.

---

## Tests (Vitest — no live API call)
- `downscaleForVision`: a >1568 px image → output long edge ≤ 1568 and byte size reduced; a ≤1568 px image → returned small/unchanged; output decodes as valid JPEG.
- Payload assembler: given N oversized images exceeding the 20 MB budget, it sends only up to the budget, prioritises core slots, and reports the dropped slot list.
- Regression: the evidence SHA-256 (stored/hashed bytes) equals the original bytes' hash — unaffected by the vision downscale.

## Lane / process
Copilot only — `packages/adapters/vision.ts` and `package.json` (the resizer dep). No accounts/schema change. Conventional commit, push to `feat/live-wiring`, full green gate (vitest + tsc + eslint), report the new count. This branch is already merged to `main` and deploying to production, so once this lands: merge to `main` and it redeploys.

## After it deploys (I'll handle)
The Coins order is currently stuck `producing` (it 413'd). Once the fix is live I'll delete the stale copilot order + report row for that object and re-trigger the reports cron, so the calibrated coin path completes end-to-end. Expected result: a real Coins tier (Gold/Silver/Bronze on the calibrated path) with a genuine `pcs_score` written to the account card — the confident path, to sit alongside the Art object's honest Flagged result.

---

## Context: what the live verify already proved
The Art/Appraise object went fully end-to-end and **every honesty gate held in production**: sealed **Flagged / provisional** with `capReason = uncalibrated_category` (composite 49, CI 35–61), delivered with **`pcs_score` withheld** (no confident number on the card) and **`valuation` null** (no fabricated band). This vision fix is the last thing standing between us and the same clean pass on photo-heavy / calibrated objects.
