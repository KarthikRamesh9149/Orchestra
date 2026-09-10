import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../prisma/migrations/20260819210000_workspace_roles_sessions/migration.sql", import.meta.url), "utf8");
const authContext = readFileSync(new URL("../apps/beta-web/src/context/AuthContext.tsx", import.meta.url), "utf8");
const workspaceStore = readFileSync(new URL("../apps/beta-web/src/store/workspaceStore.ts", import.meta.url), "utf8");

describe("Fix 10 workspace, identity, and session migration", () => {
  it("adds honest verification/login state and indexed session context metadata", () => {
    expect(schema).toMatch(/emailVerifiedAt\s+DateTime\?/);
    expect(schema).toMatch(/lastLoginAt\s+DateTime\?/);
    expect(schema).toMatch(/activeProjectId\s+String\?/);
    expect(schema).toMatch(/lastUsedAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(migration).toContain('CREATE INDEX "refresh_tokens_active_project_id_idx"');
    expect(migration).toContain('CREATE INDEX "refresh_tokens_user_active_last_used_idx"');
    expect(migration).toContain('FOREIGN KEY ("active_project_id") REFERENCES "projects"("id")');
    expect(migration).toContain('CREATE TRIGGER "refresh_tokens_active_project_guard"');
    expect(migration).toContain('pm."user_id" = NEW."user_id"');
    expect(migration).toContain('p."org_id" = NEW."org_id"');
  });

  it("does not ship frontend demo identity defaults or a development authentication bypass", () => {
    expect(authContext).not.toContain("DEV_USER");
    expect(authContext).not.toContain("DEV_PROJECT");
    expect(authContext).not.toContain("import.meta.env.DEV");
    expect(workspaceStore).not.toContain("Sarah Chen");
    expect(workspaceStore).not.toContain("sarah@orchestra.app");
  });
});
