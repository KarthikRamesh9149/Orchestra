import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runMvpSupabaseAlignment } from "../scripts/ops/mvp-supabase-alignment.js";
import { runOpsDryRun } from "../scripts/ops/production-readiness.js";
import { runLocalSecurityScan } from "../scripts/ops/security-scan-local.js";

describe("provider-neutral production readiness diagnostics", () => {
  it("runs readiness dry-run without claiming live launch proof", async () => {
    const report = await runOpsDryRun("readiness");

    expect(report.status).toBe("diagnostic_passed");
    expect(report.mode).toBe("dry-run");
    expect(report.proofLevel).toBe("diagnostic");
    expect(report.canBeUsedForLaunchProof).toBe(false);
    expect(report.liveDbProofPending).toBe(true);
    expect(report.liveApiProofPending).toBe(true);
    expect(report.blockers.join(" ")).toContain("real backend HTTP smoke report");
    expect(await readFile(report.reportMarkdownPath, "utf8")).toContain("Can be used for launch proof: NO");
  });

  it("runs retention dry-run without deleting or connecting to data stores", async () => {
    const report = await runOpsDryRun("retention");

    expect(report.status).toBe("diagnostic_passed");
    expect(report.proof).toMatchObject({
      retentionDeletesPlanned: 0,
      retentionDryRunOnly: true
    });
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("runs metrics dry-run and verifies token-protected metrics contract", async () => {
    const report = await runOpsDryRun("metrics");

    expect(report.status).toBe("diagnostic_passed");
    expect(String(report.proof.samplePrometheus)).toContain("orchestra_http_requests_total");
    expect(report.proof.metricsTokenProtectedInProduction).toBe(true);
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("runs DB static audit without connecting to Postgres", async () => {
    const report = await runOpsDryRun("db-static-audit");

    expect(report.status).toBe("diagnostic_passed");
    expect(report.proof).toMatchObject({
      dbStaticAuditOnly: true,
      liveDbExplainPending: true
    });
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("runs MVP Supabase alignment diagnostics without printing secrets or requiring live DB", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const report = await runMvpSupabaseAlignment();
      const markdown = await readFile(report.reportMarkdownPath, "utf8");

      expect(report.status).toBe("passed_with_warnings");
      expect(report.proofLevel).toBe("static");
      expect(report.databaseUrlPresent).toBe(false);
      expect(report.checks.some((check) => check.name === "Prisma migration source of truth" && check.status === "passed")).toBe(true);
      expect(report.checks.some((check) => check.name === "Connected DB proof" && check.status === "skipped")).toBe(true);
      expect(markdown).toContain("This report is read-only");
      expect(markdown).not.toMatch(/postgresql:\/\/|postgres:\/\//i);
    } finally {
      if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
      else delete process.env.DATABASE_URL;
    }
  });

  it("runs worker dry-run without connecting to Redis", async () => {
    const report = await runOpsDryRun("worker");

    expect(report.status).toBe("diagnostic_passed");
    expect(report.proof).toMatchObject({
      workerDryRunOnly: true,
      liveRedisWorkerProofPending: true
    });
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("runs staging seed dry-run without applying data", async () => {
    const report = await runOpsDryRun("staging-seed");

    expect(report.status).toBe("diagnostic_passed");
    expect(report.proof).toMatchObject({
      stagingSeedDryRunOnly: true,
      liveSeedApplyPending: true
    });
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("runs release rehearsal dry-run across ADRs, threat models, and SLO docs", async () => {
    const report = await runOpsDryRun("release-rehearsal");

    expect(report.status).toBe("diagnostic_passed");
    expect(report.proof).toMatchObject({
      releaseRehearsalDryRunOnly: true,
      liveReleaseRehearsalPending: true
    });
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("runs load dry-run without making network calls or claiming capacity proof", async () => {
    const report = await runOpsDryRun("load");

    expect(report.status).toBe("diagnostic_passed");
    expect(report.proof).toMatchObject({
      loadDryRunOnly: true,
      liveLoadTestPending: true
    });
    expect(report.canBeUsedForLaunchProof).toBe(false);
  });

  it("runs local security scan as a static CI-safe gate", async () => {
    const report = await runLocalSecurityScan();

    expect(report.status).toBe("passed");
    expect(report.proofLevel).toBe("static");
    expect(report.findings).toEqual([]);
    expect(report.scannedFiles).toBeGreaterThan(0);
  }, 60_000);
});
