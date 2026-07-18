-- PCS / Appraise Co-Pilot — bound delivery write-back retries (B4)
--
-- Copilot project (lpfmaaeuojextcqhsivs) only — apply via the Studio SQL
-- editor after 0003, NEVER against operating-prod, NEVER via the monorepo
-- migration chain.
--
-- 0003 caps PRODUCTION retries (production_state + attempts). Delivery — the
-- veradis-accounts write-back that runs AFTER a report is produced — had no
-- cap: a permanently-failing write-back (accounts unreachable / rejecting the
-- PATCH) retried on every poll tick forever, and the paid row sat
-- in_production indefinitely. delivery_attempts bounds it: at the cap the order
-- is marked failed and the paid accounts row is settled to `refunded`
-- (mirrors the B1/B2 refund discipline).

alter table orders
  add column if not exists delivery_attempts int not null default 0;
