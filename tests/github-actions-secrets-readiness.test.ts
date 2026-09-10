import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIREFLIES_LIVE_SECRET_GROUPS,
  REQUIRED_SECRET_GROUPS,
  REQUIRED_VARIABLE_NAMES,
  buildReadinessReport,
  renderReadinessMarkdown
} from "../scripts/ops/check-github-actions-secrets.js";

function readRepoFile(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function namesFromGroups(groups: Array<{ names: string[] }>) {
  return new Set(groups.flatMap((group) => group.names));
}

describe("manual HTTP smoke GitHub secrets readiness", () => {
  it("defines the required staging secret groups", () => {
    const requiredNames = namesFromGroups(REQUIRED_SECRET_GROUPS);

    expect(requiredNames).toContain("STAGING_DATABASE_URL");
    expect(requiredNames).toContain("STAGING_SMOKE_BASE_URL");
    expect(requiredNames).toContain("SMOKE_BASE_URL");
    expect(requiredNames).toContain("STAGING_MVP_SMOKE_BASE_URL");
    expect(requiredNames).toContain("MVP_SMOKE_BASE_URL");
    expect(requiredNames).toContain("SMOKE_MANAGER_EMAIL");
    expect(requiredNames).toContain("SMOKE_MANAGER_PASSWORD");
    expect(requiredNames).toContain("SMOKE_DEV_EMAIL");
    expect(requiredNames).toContain("SMOKE_DEV_PASSWORD");
    expect(requiredNames).toContain("SMOKE_CLIENT_EMAIL");
    expect(requiredNames).toContain("SMOKE_CLIENT_PASSWORD");
    expect(requiredNames).toContain("METRICS_TOKEN");
  });

  it("accepts documented fallback base URL groups", () => {
    const report = buildReadinessReport({
      presentSecrets: new Set([
        "STAGING_DATABASE_URL",
        "SMOKE_BASE_URL",
        "SMOKE_MANAGER_EMAIL",
        "SMOKE_MANAGER_PASSWORD",
        "SMOKE_DEV_EMAIL",
        "SMOKE_DEV_PASSWORD",
        "SMOKE_CLIENT_EMAIL",
        "SMOKE_CLIENT_PASSWORD",
        "METRICS_TOKEN"
      ]),
      presentVariables: new Set(REQUIRED_VARIABLE_NAMES),
      environmentName: "staging",
      repository: "KarthikRamesh9149/orchestrav2",
      requireFirefliesLive: false
    });

    expect(report.ok).toBe(true);
    expect(report.missingSecretGroups).toEqual([]);
  });

  it("requires Fireflies live secrets only when live proof is requested", () => {
    const baseSecrets = new Set([
      "STAGING_DATABASE_URL",
      "STAGING_SMOKE_BASE_URL",
      "STAGING_MVP_SMOKE_BASE_URL",
      "SMOKE_MANAGER_EMAIL",
      "SMOKE_MANAGER_PASSWORD",
      "SMOKE_DEV_EMAIL",
      "SMOKE_DEV_PASSWORD",
      "SMOKE_CLIENT_EMAIL",
      "SMOKE_CLIENT_PASSWORD",
      "METRICS_TOKEN"
    ]);
    const variables = new Set(REQUIRED_VARIABLE_NAMES);

    expect(
      buildReadinessReport({
        presentSecrets: baseSecrets,
        presentVariables: variables,
        environmentName: "staging",
        repository: "KarthikRamesh9149/orchestrav2",
        requireFirefliesLive: false
      }).ok
    ).toBe(true);

    const liveReport = buildReadinessReport({
      presentSecrets: baseSecrets,
      presentVariables: variables,
      environmentName: "staging",
      repository: "KarthikRamesh9149/orchestrav2",
      requireFirefliesLive: true
    });

    expect(liveReport.ok).toBe(false);
    expect(liveReport.missingSecretGroups.map((group) => group.label)).toEqual(
      FIREFLIES_LIVE_SECRET_GROUPS.map((group) => group.label)
    );
  });

  it("renders missing secret summaries without leaking values", () => {
    const report = buildReadinessReport({
      presentSecrets: new Set(["SMOKE_MANAGER_PASSWORD"]),
      presentVariables: new Set(),
      environmentName: "staging",
      repository: "KarthikRamesh9149/orchestrav2",
      requireFirefliesLive: false
    });
    const markdown = renderReadinessMarkdown(report);

    expect(markdown).toContain("STAGING_DATABASE_URL");
    expect(markdown).toContain("SMOKE_MANAGER_PASSWORD");
    expect(markdown).not.toContain("super-secret-password");
    expect(markdown).not.toContain("postgresql://user:pass@");
  });

  it("documents every required secret and variable", () => {
    const doc = readRepoFile("docs/MVP_HTTP_SMOKE_SECRETS.md");

    for (const name of namesFromGroups(REQUIRED_SECRET_GROUPS)) {
      expect(doc, `missing ${name}`).toContain(name);
    }
    for (const name of REQUIRED_VARIABLE_NAMES) {
      expect(doc, `missing ${name}`).toContain(name);
    }
  });

  it("keeps the HTTP smoke workflow manual-only and staged", () => {
    const workflow = readRepoFile(".github/workflows/http-smoke.yml");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("environment: staging");
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
    expect(workflow.indexOf("Validate required staging secrets")).toBeGreaterThan(-1);
    expect(workflow.indexOf("Validate required staging secrets")).toBeLessThan(workflow.indexOf("npx prisma validate"));
    expect(workflow.indexOf("Validate required staging secrets")).toBeLessThan(workflow.indexOf("smoke:backend:http"));
    expect(workflow.indexOf("Validate required staging secrets")).toBeLessThan(workflow.indexOf("smoke:mvp:http"));
  });
});
