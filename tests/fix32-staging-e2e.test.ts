import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { FIX32_JOURNEYS, buildFix32Environment } from "../scripts/ops/verify-staging-e2e.js";

describe("Fix 32 isolated staging E2E gate", () => {
  it("maps every required staging journey to executable proof", () => {
    const text = FIX32_JOURNEYS.map((journey) => `${journey.requirement} ${journey.evidence.join(" ")}`).join(" ").toLowerCase();
    for (const phrase of ["signup", "invitation", "logout/login", "workspace switching", "project/team", "subscription", "upload", "socrates", "citations", "proposal acceptance", "product brain", "live doc", "timeline", "watchtower", "deep research", "connectors"]) {
      expect(text).toContain(phrase);
    }
    expect(new Set(FIX32_JOURNEYS.map((journey) => journey.id)).size).toBe(FIX32_JOURNEYS.length);
    expect(FIX32_JOURNEYS.every((journey) => journey.command.length > 0 && journey.evidence.length > 0)).toBe(true);
  });

  it("refuses production or non-HTTPS targets", () => {
    expect(() => buildFix32Environment({ BETA_SMOKE_BASE_URL: "https://orchestrav2-production.up.railway.app", BETA_WEB_URL: "https://beta-web-staging.up.railway.app" })).toThrow(/isolated HTTPS staging/);
    expect(() => buildFix32Environment({ BETA_SMOKE_BASE_URL: "http://localhost:8080", BETA_WEB_URL: "https://beta-web-staging.up.railway.app" })).toThrow(/isolated HTTPS staging/);
  });

  it("derives browser and launch-loop targets from the same isolated API", () => {
    const env = buildFix32Environment({ BETA_SMOKE_BASE_URL: "https://api-staging.example.test", BETA_WEB_URL: "https://web-staging.example.test", BETA_SMOKE_MANAGER_EMAIL: "manager@example.test", BETA_SMOKE_MANAGER_PASSWORD: "synthetic-password" });
    expect(env.BETA_API_URL).toBe(env.BETA_SMOKE_BASE_URL);
    expect(env.SMOKE_BASE_URL).toBe(env.BETA_SMOKE_BASE_URL);
    expect(env.BETA_TEST_EMAIL).toBe("manager@example.test");
    expect(env.BETA_TEST_PASSWORD).toBe("synthetic-password");
    expect(env.SMOKE_KEEP_DATA).toBe("false");
  });

  it("unwraps CommonJS Playwright modules in both browser release harnesses", async () => {
    for (const path of [
      "scripts/smoke/beta-browser-smoke.mjs",
      "scripts/smoke/beta-browser-product-walkthrough.mjs"
    ]) {
      const source = await readFile(path, "utf8");
      expect(source).toContain("return imported.chromium ? imported : imported.default;");
      expect(source).toMatch(/requestContext\.fetch\(`\$\{webUrl\}\$\{(?:path|pathname)\}`/);
    }
    const smoke = await readFile("scripts/smoke/beta-browser-smoke.mjs", "utf8");
    expect(smoke).toContain('"/truth-inbox", "/delivery"');
    expect(smoke).toContain('error !== "net::ERR_ABORTED"');
    expect(smoke).toMatch(/waitForURL\(\/\\\/chat\\\//);
  });
});
