import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260819094500_centralize_membership_authorization/migration.sql"
);
const hardeningMigrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260819101500_harden_membership_authorization_function/migration.sql"
);

describe("centralized membership authorization migration", () => {
  it("indexes the user-first project authorization path", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('CREATE INDEX "project_members_user_id_is_active_project_id_idx"');
    expect(sql).toContain('ON "project_members" ("user_id", "is_active", "project_id")');
  });

  it("prevents active cross-tenant project memberships and client truth approval", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "project_members_require_active_organization_membership"');
    expect(sql).toContain('FROM public."organization_memberships" AS om');
    expect(sql).toContain('om."organization_id" = project_organization_id');
    expect(sql).toContain('om."user_id" = NEW."user_id"');
    expect(sql).toContain('om."is_active" = TRUE');
    expect(sql).toContain('ADD CONSTRAINT "project_members_client_truth_approval_check"');
  });

  it("prevents browser-facing Supabase roles from invoking the trigger function directly", () => {
    const sql = readFileSync(hardeningMigrationPath, "utf8");
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.enforce_project_member_organization_membership() FROM PUBLIC"
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.enforce_project_member_organization_membership() FROM anon"
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.enforce_project_member_organization_membership() FROM authenticated"
    );
  });
});
