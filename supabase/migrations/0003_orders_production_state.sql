-- PCS / Appraise Co-Pilot — order production lifecycle (fix brief v03 F-5a)
--
-- Copilot project (lpfmaaeuojextcqhsivs) only — apply via the Studio SQL
-- editor after 0002, NEVER against operating-prod, NEVER via the monorepo
-- migration chain.
--
-- The orders.id PK is the report poller's ATOMIC CLAIM: the first tick to
-- insert the row owns production; a concurrent tick's insert hits the unique
-- violation and skips. production_state records the outcome so a permanently
-- failing row is retried at most `attempts` times and then surfaced, never
-- re-burning the paid pipeline every tick.

alter table orders
  add column if not exists production_state text not null default 'producing',
  add column if not exists attempts int not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists last_error text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_production_state_chk') then
    alter table orders
      add constraint orders_production_state_chk
      check (production_state in ('producing','produced','failed'));
  end if;
end $$;
