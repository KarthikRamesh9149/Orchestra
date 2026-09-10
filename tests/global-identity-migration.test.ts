import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "prisma/migrations/20260819090000_global_user_identity_memberships/migration.sql"),
  "utf8"
);
const backendAccessMigration = readFileSync(
  resolve(root, "prisma/migrations/20260819093000_organization_memberships_backend_access/migration.sql"),
  "utf8"
);

describe("global identity migration contract", () => {
  it("models one normalized global identity and separate organization/project memberships", () => {
    expect(schema).toMatch(/normalizedEmail\s+String\s+@unique\s+@map\("normalized_email"\)/);
    expect(schema).toContain("model OrganizationMembership");
    expect(schema).toContain("@@unique([organizationId, userId])");
    expect(schema).toContain("model ProjectMember");
    expect(schema).toContain("@@unique([projectId, userId])");
  });

  it("retains legacy organization and role columns for rolling compatibility", () => {
    expect(schema).toMatch(/orgId\s+String\s+@map\("org_id"\)/);
    expect(schema).toMatch(/globalRole\s+GlobalRole\s+@map\("global_role"\)/);
    expect(schema).toMatch(/workspaceRoleDefault\s+WorkspaceRoleDefault\s+@map\("workspace_role_default"\)/);
    expect(migration).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
  });

  it("aborts unsafe normalization before data rewrite or uniqueness enforcement", () => {
    const duplicateGuard = migration.indexOf("unsafe duplicate normalized user identities detected");
    const rewrite = migration.indexOf('UPDATE "users"');
    const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX "users_normalized_email_key"');
    expect(duplicateGuard).toBeGreaterThan(-1);
    expect(duplicateGuard).toBeLessThan(rewrite);
    expect(rewrite).toBeLessThan(uniqueIndex);
  });

  it("backfills memberships idempotently and protects every foreign-key access path", () => {
    expect(migration).toContain('INSERT INTO "organization_memberships"');
    expect(migration).toContain('ON CONFLICT ("organization_id", "user_id") DO UPDATE');
    expect(migration).toContain('organization_memberships_organization_id_user_id_key');
    expect(migration).toContain('organization_memberships_user_id_is_active_idx');
    expect(migration).toContain('organization_memberships_organization_id_is_active_global_role_idx');
  });

  it("keeps legacy writers synchronized and denies direct client access", () => {
    expect(migration).toContain('CREATE TRIGGER "users_sync_global_identity"');
    expect(migration).toContain('CREATE TRIGGER "users_sync_legacy_organization_membership"');
    expect(migration).toContain('ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "backend_api_only_no_direct_client_access"');
    expect(backendAccessMigration).toContain("backend_role name := current_user");
    expect(backendAccessMigration).toContain("backend_database_role_full_access");
    expect(backendAccessMigration).toContain("backend_role IN ('anon', 'authenticated')");
  });
});
