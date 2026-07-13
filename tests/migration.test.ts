import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Structural check on the P0 migration. We can't spin up Postgres here (the live
// project is deferred), so we assert the schema's shape and catch ordering bugs
// (a FK to a not-yet-created table would fail on apply).
const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/0001_pcs_copilot_schema.sql", import.meta.url)),
  "utf8",
);

const TABLES = [
  "report",
  "report_version",
  "evidence_item",
  "source_citation",
  "check_result",
  "correction",
  "curator_action",
  "category_profile",
  "corpus_document",
  "corpus_chunk",
];

describe("0001 migration", () => {
  it("enables pgvector", () => {
    expect(sql).toMatch(/create extension if not exists vector/i);
  });

  it("creates all ten P0 tables", () => {
    for (const t of TABLES) {
      expect(sql, `missing table ${t}`).toMatch(new RegExp(`create table if not exists ${t}\\b`, "i"));
    }
  });

  it("declares source_citation before check_result (check_result FKs it)", () => {
    const iSource = sql.indexOf("create table if not exists source_citation");
    const iCheck = sql.indexOf("create table if not exists check_result");
    expect(iSource).toBeGreaterThan(-1);
    expect(iCheck).toBeGreaterThan(-1);
    expect(iSource).toBeLessThan(iCheck);
  });

  it("hash-chains report versions", () => {
    expect(sql).toMatch(/snapshot_sha256\s+text not null/i);
    expect(sql).toMatch(/supersedes_sha256\s+text/i);
  });

  it("keeps curator actions immutable + signed", () => {
    expect(sql).toMatch(/immutable\s+boolean not null default true/i);
    expect(sql).toMatch(/signed_at\s+timestamptz/i);
  });

  it("stores corpus embeddings as pgvector", () => {
    expect(sql).toMatch(/embedding\s+vector\(\d+\)/i);
  });
});
