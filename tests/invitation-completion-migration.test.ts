import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260819113000_durable_invitation_completion/migration.sql"
);
const backendAccessMigrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260819114500_invitation_backend_database_access/migration.sql"
);

describe("durable invitation completion migration", () => {
  it("records one durable redemption per code and global user", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('CREATE TABLE "project_join_code_redemptions"');
    expect(sql).toContain('UNIQUE ("join_code_id")');
    expect(sql).toContain('UNIQUE ("project_id", "user_id")');
    expect(sql).toContain('REFERENCES "project_join_codes"("id")');
    expect(sql).toContain('REFERENCES "projects"("id")');
    expect(sql).toContain('REFERENCES "users"("id")');
  });

  it("revokes legacy unbound codes and enforces valid usage counters", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('WHERE "invited_email" IS NULL');
    expect(sql).toContain('project_join_codes_email_bound_or_revoked_check');
    expect(sql).toContain('project_join_codes_normalized_email_check');
    expect(sql).toContain('project_join_codes_single_use_or_revoked_check');
    expect(sql).toContain('project_join_codes_usage_bounds_check');
  });

  it("denies direct anon and authenticated access to redemption records", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('TO anon, authenticated');
    expect(sql).toContain('USING (false)');
    expect(sql).toContain('WITH CHECK (false)');
  });

  it("grants only the already-approved Orchestra backend database role full invitation-table access", () => {
    const sql = readFileSync(backendAccessMigrationPath, "utf8");
    expect(sql).toContain("organization_memberships");
    expect(sql).toContain("roles.rolname NOT IN ('anon', 'authenticated')");
    expect(sql).toContain("no approved Orchestra backend database role is available");
    expect(sql).toContain("'project_join_codes'");
    expect(sql).toContain("'project_join_code_redemptions'");
    expect(sql).toContain("backend_database_role_full_access");
    expect(sql).toContain("AS PERMISSIVE FOR ALL");
    expect(sql).toContain("USING (true) WITH CHECK (true)");
  });
});
