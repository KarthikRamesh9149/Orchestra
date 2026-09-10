import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("[FIX-25] Supabase advisor remediation", () => {
  it("enables backend-only RLS for deep research runs", () => {
    const sql = readFileSync(
      "prisma/migrations/20260820125000_deep_research_backend_only_rls/migration.sql",
      "utf8"
    );
    expect(sql).toContain('ALTER TABLE "deep_research_runs" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('TO anon, authenticated');
    expect(sql).toContain('USING (false)');
    expect(sql).toContain('WITH CHECK (false)');
    expect(sql).toContain('backend_database_role_full_access');
    expect(sql).toContain("backend_role IN ('anon', 'authenticated')");
  });

  it("activates all pre-existing public deny policies and fixes trigger search paths", () => {
    const sql = readFileSync(
      "prisma/migrations/20260820125500_public_backend_rls_completion/migration.sql",
      "utf8"
    );
    expect(sql).toContain("AND NOT c.relrowsecurity");
    expect(sql).toContain("ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("backend_api_only_no_direct_client_access");
    expect(sql).toContain("backend_database_role_full_access");
    expect(sql).toContain("ALTER FUNCTION public.sync_user_global_identity()");
    expect(sql).toContain("ALTER FUNCTION public.sync_legacy_user_organization_membership()");
    expect(sql).toContain("SET search_path = pg_catalog, public");
  });

  it("preserves least-privileged Orchestra runtime access under RLS", () => {
    const prepareSql = readFileSync(
      "prisma/migrations/20260820125400_public_backend_runtime_policy_prepare/migration.sql",
      "utf8"
    );
    const sql = readFileSync(
      "prisma/migrations/20260820130000_public_backend_runtime_rls_access/migration.sql",
      "utf8"
    );
    expect(prepareSql).toContain("before the following migration");
    expect(prepareSql).toContain("backend_database_role_full_access");
    expect(sql).toContain("^orchestra_[a-z0-9_]+_runtime$");
    expect(sql).toContain("role.rolname = current_user");
    expect(sql).toContain("ALTER POLICY %I ON %I.%I TO %s");
    expect(sql).toContain("USING (true) WITH CHECK (true)");
  });

  it("records current advisor and query-plan evidence without speculative index churn", () => {
    const report = readFileSync("docs/remediation/fix25-supabase-advisor-profile.md", "utf8");
    expect(report).toContain("110 unindexed foreign keys");
    expect(report).toContain("131 unused indexes");
    expect(report).toContain("deep_research_runs_user_idx");
    expect(report).toContain("0.094 ms");
    expect(report).toContain("No index was added or removed");
  });
});
