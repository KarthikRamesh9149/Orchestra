import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIX33_RELEASE_PHASES, assertReleaseRuntimeSafety } from "../scripts/ops/verify-release-suite.js";

describe("[FIX-33] complete release suite", () => {
  it("maps every required release proof to an executable phase", () => {
    const contract = FIX33_RELEASE_PHASES.map((phase) => `${phase.id} ${phase.requirement} ${phase.command}`).join(" ").toLowerCase();
    for (const phrase of ["clean", "migration", "typecheck", "build", "test", "evaluation", "audit", "security", "backend", "mvp", "beta", "connector", "browser", "load", "concurr", "backup", "restore", "worker", "recovery"]) {
      expect(contract).toContain(phrase);
    }
    expect(new Set(FIX33_RELEASE_PHASES.map((phase) => phase.id)).size).toBe(FIX33_RELEASE_PHASES.length);
    expect(FIX33_RELEASE_PHASES.every((phase) => phase.command.length > 0)).toBe(true);
    expect(contract).toContain("ci-postgres-bootstrap.sql");
  });

  it("refuses production and shared infrastructure", () => {
    expect(() => assertReleaseRuntimeSafety({
      BETA_SMOKE_BASE_URL: "https://orchestrav2-production.up.railway.app",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/orchestra_release",
      RELEASE_TEST_REDIS_URL: "redis://localhost:6379"
    })).toThrow(/isolated HTTPS staging|production/);
    expect(() => assertReleaseRuntimeSafety({
      BETA_SMOKE_BASE_URL: "https://api-staging.example.test",
      DATABASE_URL: "postgresql://user:pass@database.example.test:5432/orchestra",
      RELEASE_TEST_REDIS_URL: "redis://redis.example.test:6379"
    })).toThrow(/local disposable release database/);
  });

  it("CI requires fresh migrations, backup/restore, and worker recovery", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    for (const command of ["npm ci", "npm run prisma:deploy", "npm run remediation:backup-restore:runtime", "npm run remediation:worker-recovery:runtime"]) {
      expect(ci).toContain(command);
    }
    expect(ci).toContain("release-runtime-proof");
  });

  it("does not present deterministic mock evals as production AI certification", () => {
    const runner = readFileSync("scripts/run-all-evals.ts", "utf8");
    expect(runner).toContain('evaluationMode: "deterministic_contract"');
    expect(runner).toContain("productionAiCertification");
    expect(runner).toContain("credential-backed live proof is required");
  });
});
