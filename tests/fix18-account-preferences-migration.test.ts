import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260820033000_account_preferences/migration.sql", import.meta.url),
  "utf8"
);

describe("Fix 18 appearance preference migration", () => {
  it("adds a durable safe default and database-level theme constraint", () => {
    expect(schema).toMatch(/appearanceTheme\s+String\s+@default\("auto"\)\s+@map\("appearance_theme"\)/);
    expect(migration).toContain('ADD COLUMN "appearance_theme" TEXT NOT NULL DEFAULT \'auto\'');
    expect(migration).toContain("CHECK (\"appearance_theme\" IN ('light', 'dark', 'auto'))");
    expect(migration).toContain("no approved Orchestra backend database role is available");
    expect(migration).toContain("backend_database_role_full_access");
    expect(migration).toContain("public.user_notification_preferences AS PERMISSIVE FOR ALL");
  });
});
