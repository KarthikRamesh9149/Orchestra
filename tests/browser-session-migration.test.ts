import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "../prisma/migrations/20260819133000_http_only_browser_sessions/migration.sql",
  import.meta.url
);

describe("Fix 9 browser session migration", () => {
  it("adds indexed refresh-token families with replay and client-mode state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain('"session_id" UUID');
    expect(sql).toContain('"parent_token_id" UUID');
    expect(sql).toContain('"client_type"');
    expect(sql).toContain('"reuse_detected_at"');
    expect(sql).toContain('refresh_tokens_session_id_active_idx');
    expect(sql).toContain('refresh_tokens_parent_token_id_fkey');
    expect(sql).toContain('refresh_tokens_org_id_idx');
  });

  it("prevents direct browser-role access while retaining the approved backend role", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain('ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('backend_api_only_no_direct_client_access');
    expect(sql).toContain('backend_database_role_full_access');
    expect(sql).toContain("organization_memberships");
  });

  it("keeps browser smoke coverage on the HttpOnly contract instead of injecting storage tokens", async () => {
    const [smoke, walkthrough] = await Promise.all([
      readFile(new URL("../scripts/smoke/beta-browser-smoke.mjs", import.meta.url), "utf8"),
      readFile(new URL("../scripts/smoke/beta-browser-product-walkthrough.mjs", import.meta.url), "utf8")
    ]);
    for (const script of [smoke, walkthrough]) {
      expect(script).toContain('sessionMode: "browser"');
      expect(script).toContain('"x-csrf-token"');
      expect(script).not.toContain('sessionStorage.setItem("orchestra_beta_access_token"');
      expect(script).not.toContain('sessionStorage.setItem("orchestra_beta_refresh_token"');
    }
    expect(smoke).toContain("simpleChatAnswered &&");
    expect(smoke).toContain("answered: simpleChatAnswered");
  });
});
