-- PCS / Appraise Co-Pilot — orders + email audit log (E-F)
--
-- Companion to 0001 (which is APPLIED on the live veradis-copilot project,
-- ref lpfmaaeuojextcqhsivs). This migration is AUTHORED, NOT YET APPLIED —
-- apply it via the Studio SQL editor like 0001 (project_supabase_two_project_split):
-- NEVER against operating-prod (tchfcyvclcjchoodgdnx), NEVER via the monorepo
-- migration chain. The SupabaseRepository (packages/data/supabase.ts) needs it
-- before DATA_BACKEND flips live.

-- Orders arrive from two front doors with different id shapes:
--   Tally  → 'ord-<submissionId>' (text)
--   verify.veradis.ai → the veradis-accounts reports.id (uuid, as text)
-- report.order_id therefore relaxes from uuid to text.
alter table report alter column order_id type text using order_id::text;

-- One row per paid order (the commercial side of a report).
-- tally_submission_id doubles as the webhook dedupe key for BOTH intakes
-- (veradis orders store 'veradis:<accounts report id>').
create table if not exists orders (
  id                  text primary key,
  tally_submission_id text not null unique,
  email               text not null,
  owner_name          text,
  category            text not null,
  sku                 text not null,          -- verify | appraise
  created_at          timestamptz not null default now()
);

-- EMAIL A/B/C audit trail (packages/notify/emails.ts).
create table if not exists email_log (
  id          uuid primary key default gen_random_uuid(),
  order_id    text not null references orders(id) on delete cascade,
  report_id   uuid,                            -- no FK: emails can precede the report
  kind        text not null,                   -- received | curator_review | definitive
  "to"        text not null,
  subject     text not null,
  provider_id text not null,
  sent_at     timestamptz not null default now()
);

create index if not exists idx_email_log_order on email_log(order_id);
