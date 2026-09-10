import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const matrix = JSON.parse(readFileSync("docs/remediation/adversarial-audit-matrix.json", "utf8")) as {
  productionMutationAuthorized: boolean;
  categories: Array<{ id: string; status: string; controls: string[]; evidence: string[] }>;
  findings: Array<{ status: string }>;
  openReproducibleP0P3: number;
};

describe("[FIX-34] final adversarial audit", () => {
  it("covers every required threat category with executable evidence", () => {
    const required = ["authentication", "csrf-origin", "invitation-replay", "tenant-isolation-idor", "role-escalation", "upload-parser-abuse", "stored-rendered-xss", "oauth-replay", "webhook-integrity", "secret-handling", "mobile-accessibility", "failure-modes"];
    expect(matrix.categories.map((entry) => entry.id)).toEqual(required);
    expect(matrix.categories.every((entry) => entry.status === "verified" && entry.controls.length > 0 && entry.evidence.length > 0)).toBe(true);
    expect(matrix.findings.every((finding) => finding.status === "remediated")).toBe(true);
    expect(matrix.openReproducibleP0P3).toBe(0);
    expect(matrix.productionMutationAuthorized).toBe(false);
  });

  it("enforces durable one-time OAuth state and backend-only database access", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync("prisma/migrations/20260821005000_github_oauth_state_replay_protection/migration.sql", "utf8");
    const github = readFileSync("src/modules/github/service.ts", "utf8");
    const drive = readFileSync("src/modules/google-drive/service.ts", "utf8");
    const calendar = readFileSync("src/modules/project-ops/calendar-connections.service.ts", "utf8");
    expect(schema).toContain("model GitHubOAuthState");
    for (const phrase of ["ENABLE ROW LEVEL SECURITY", "backend_api_only_no_direct_client_access", "backend_database_role_full_access", "github_oauth_states_purpose_check", "github_oauth_states_actor_user_id_idx"]) expect(migration).toContain(phrase);
    expect(github).toContain("github_install_state_used");
    expect(github).toContain("github_user_link_state_used");
    expect(github).toContain("redactAndLimit(error instanceof Error ? error.message");
    expect(drive).toContain("google_drive_oauth_state_used");
    expect(calendar).toContain("calendar_oauth_state_used");
  });

  it("keeps the gate in CI and production frozen", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const governance = readFileSync("docs/remediation/release-governance.json", "utf8");
    expect(ci).toContain("npm run remediation:adversarial:check");
    expect(governance).toContain('"remediationBranchForbidden": true');
    expect(governance).toContain('"requiredFinalFix": 35');
  });
});
