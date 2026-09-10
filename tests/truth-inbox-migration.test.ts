import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260823120000_truth_inbox_state/migration.sql", import.meta.url),
  "utf8"
);

describe("Feature 1 Truth Inbox persistence", () => {
  it("stores only cross-source workflow state with tenant and foreign-key boundaries", () => {
    expect(schema).toContain("model TruthInboxItemState");
    expect(migration).toContain('CREATE TABLE "truth_inbox_item_states"');
    expect(migration).toContain('FOREIGN KEY ("org_id") REFERENCES "organizations"("id")');
    expect(migration).toContain('FOREIGN KEY ("project_id") REFERENCES "projects"("id")');
    expect(migration).toContain('FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id")');
    expect(migration).toContain("truth_inbox_item_states_source_type_check");
    expect(migration).toContain("truth_inbox_item_states_status_check");
  });

  it("uses composite indexes for queue, owner, source, and wake-up reads", () => {
    expect(migration).toContain('ON "truth_inbox_item_states"("project_id", "status", "updated_at" DESC)');
    expect(migration).toContain('ON "truth_inbox_item_states"("project_id", "assigned_user_id", "status")');
    expect(migration).toContain('ON "truth_inbox_item_states"("org_id", "project_id", "source_type")');
    expect(migration).toContain('ON "truth_inbox_item_states"("project_id", "snoozed_until")');
  });

  it("denies direct Supabase clients and discovers the approved backend runtime role", () => {
    expect(migration).toContain('ALTER TABLE "truth_inbox_item_states" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain("TO anon, authenticated");
    expect(migration).toContain("USING (false)");
    expect(migration).toContain("WITH CHECK (false)");
    expect(migration).toContain("backend_database_role_full_access");
    expect(migration).toContain("no approved Orchestra backend database role is available");
  });
});
