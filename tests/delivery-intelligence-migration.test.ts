import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../prisma/migrations/20260824043000_delivery_intelligence/migration.sql", import.meta.url), "utf8");

describe("delivery intelligence migration", () => {
  it("creates the durable feature records with constrained immutable identity", () => {
    expect(sql).toContain('CREATE TABLE "decision_receipts"');
    expect(sql).toContain('CREATE TABLE "socrates_response_feedback"');
    expect(sql).toContain('CREATE TABLE "weekly_executive_briefs"');
    expect(sql).toContain('CREATE UNIQUE INDEX "decision_receipts_proposal_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "decision_receipts_content_hash_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "socrates_feedback_message_user_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "weekly_briefs_project_week_key"');
  });

  it("indexes every foreign key and keeps browser roles fail-closed", () => {
    for (const index of ["decision_receipts_org_project_issued_idx", "decision_receipts_project_decision_idx", "decision_receipts_issuer_idx", "socrates_feedback_org_project_created_idx", "socrates_feedback_session_idx", "socrates_feedback_user_idx", "socrates_feedback_brain_version_idx", "weekly_briefs_org_project_generated_idx", "weekly_briefs_generator_idx"]) {
      expect(sql).toContain(`CREATE INDEX "${index}"`);
    }
    for (const table of ["decision_receipts", "socrates_response_feedback", "weekly_executive_briefs"]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)");
    expect(sql).toContain("no approved Orchestra backend database role is available");
  });
});
