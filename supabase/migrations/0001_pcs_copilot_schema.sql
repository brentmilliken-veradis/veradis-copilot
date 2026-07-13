-- PCS / Appraise Co-Pilot — P0 data model
-- Source: docs/…CoPilot-P0-Build-Plan_v01.md §2 · BUILD-KICKOFF §4.
--
-- NOT APPLIED in this build. The live veradis-copilot Supabase project is a
-- human/CTO setup task (BUILD-KICKOFF §8); until then the engine runs against
-- InMemoryRepository. When provisioned, apply via the Studio SQL editor
-- (project_supabase_two_project_split) — NEVER against operating-prod
-- (tchfcyvclcjchoodgdnx), NEVER via the monorepo migration chain.
--
-- This schema EXTENDS the live `verify_orders` table: report.order_id points at
-- a verify_orders row. No hard FK is declared here so the copilot project can be
-- stood up independently of the verify order store.

create extension if not exists vector;

-- Report — one per paid order/object.
create table if not exists report (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null,                    -- → verify_orders (live)
  object_id       text not null,
  category        text not null,                    -- coins | cards | medals | watches | silver
  status          text not null default 'created',  -- created|paid|provisional|definitive|unscored|flagged|withheld
  current_version int  not null default 0,
  created_at      timestamptz not null default now()
);

-- Report version — immutable snapshot, hash-chained via supersedes_sha256.
create table if not exists report_version (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references report(id) on delete cascade,
  v                 int  not null,
  snapshot_jsonb    jsonb not null,
  snapshot_sha256   text not null,
  supersedes_sha256 text,                            -- prior version's hash (null on v1)
  tier              text,
  composite         numeric,
  ci_lo             numeric,
  ci_hi             numeric,
  pdf_path          text,
  created_at        timestamptz not null default now(),
  unique (report_id, v)
);

-- Evidence — photos/docs, hashed at intake, C2PA-checked (gate ④).
create table if not exists evidence_item (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references report(id) on delete cascade,
  slot         text not null,
  storage_path text not null,
  sha256       text not null,
  exif_ts      timestamptz,
  c2pa_state   text not null default 'unchecked',    -- present|absent|invalid|unchecked
  kind         text not null default 'photo'         -- photo|doc|linked
);

-- Source citation — every claim traceable; tier + retrieval state.
-- (Declared before check_result, which FKs it.)
create table if not exists source_citation (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references report(id) on delete cascade,
  name            text not null,
  url             text,
  retrieval_state text not null,                     -- retrieved|pending|not_digitised|access_restricted
  tier            int  not null                      -- 1|2|3|4
);

-- Check result — per quadrant, with its authority state.
create table if not exists check_result (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references report(id) on delete cascade,
  quadrant        text not null,                     -- identity|custody|material|risk
  key             text not null,
  result          text not null,                     -- match|consistent|observed|corrected|reinterpreted|flagged|gap_held_open
  authority_state text not null,                     -- resolved|declared|missing|corpus
  source_id       uuid references source_citation(id),
  note            text
);

-- Correction — the mislabel record (kindness register).
create table if not exists correction (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references report(id) on delete cascade,
  claimed         text not null,
  evidence        text not null,
  corrected_value text not null,
  kindness_note   text not null
);

-- Curator action — immutable, signed, credentialed (gate ⑨).
create table if not exists curator_action (
  id               uuid primary key default gen_random_uuid(),
  report_id        uuid not null references report(id) on delete cascade,
  curator          text not null,
  action           text not null,                    -- confirmed|downgraded|withheld
  credential_class text not null,                    -- curator|senior_curator|external_expert
  signed_at        timestamptz not null default now(),
  immutable        boolean not null default true
);

-- Category profile — versioned data (identity keys, slots, red flags, sources).
create table if not exists category_profile (
  id       uuid primary key default gen_random_uuid(),
  category text not null,
  version  int  not null,
  jsonb    jsonb not null,
  unique (category, version)
);

-- Corpus document — a fetched source snapshot (Tier 1/2), for the RAG moat.
create table if not exists corpus_document (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,
  source     text not null,
  url        text,
  licence    text,
  fetched_at timestamptz not null default now(),
  sha256     text not null
);

-- Corpus chunk — embedded text for pgvector retrieval.
-- vector dimension is provider-dependent (env-swappable); 1536 default.
create table if not exists corpus_chunk (
  id                  uuid primary key default gen_random_uuid(),
  corpus_document_id  uuid not null references corpus_document(id) on delete cascade,
  text                text not null,
  embedding           vector(1536),
  metadata_jsonb      jsonb not null default '{}'::jsonb
);

create index if not exists idx_report_order        on report(order_id);
create index if not exists idx_version_report       on report_version(report_id);
create index if not exists idx_evidence_report      on evidence_item(report_id);
create index if not exists idx_check_report         on check_result(report_id);
create index if not exists idx_citation_report      on source_citation(report_id);
create index if not exists idx_corpus_chunk_doc     on corpus_chunk(corpus_document_id);
