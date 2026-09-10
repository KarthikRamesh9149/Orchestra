import { describe, expect, it, vi } from "vitest";
import { toAppError } from "../src/app/errors.js";
import { normalizeCorrelationId, resolveRequestId } from "../src/lib/observability/correlation.js";
import { observeMigrationState } from "../src/lib/observability/migration-metrics.js";
import { buildWorkerObservation } from "../src/lib/jobs/queue.js";

describe("Fix 26 observability contracts", () => {
  it("accepts bounded safe correlation ids and replaces unsafe input", () => {
    expect(normalizeCorrelationId("request-123:child.4")).toBe("request-123:child.4");
    expect(normalizeCorrelationId("bad\nheader")).toBeNull();
    expect(normalizeCorrelationId("x".repeat(129))).toBeNull();
    expect(resolveRequestId("bad header")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("maps database conflicts to stable safe errors without leaking database values", () => {
    const unique = toAppError({
      code: "P2002",
      meta: { target: ["normalized_email", "unsafe\nfield"], cause: "secret@example.com" }
    });
    expect(unique).toMatchObject({
      statusCode: 409,
      code: "unique_constraint_conflict",
      details: { fields: ["normalized_email"] }
    });
    expect(JSON.stringify(unique.details)).not.toContain("secret@example.com");
    expect(toAppError({ code: "P2003" })).toMatchObject({ statusCode: 409, code: "foreign_key_conflict" });
    expect(toAppError({ code: "P2025" })).toMatchObject({ statusCode: 404, code: "resource_not_found" });
  });

  it("exports low-cardinality migration state and latest duration metrics", () => {
    const telemetry = { setGauge: vi.fn(), observeDuration: vi.fn() };
    const summary = observeMigrationState(telemetry as any, [
      {
        migration_name: "20260820000000_applied",
        started_at: "2026-08-20T00:00:00.000Z",
        finished_at: "2026-08-20T00:00:00.125Z",
        rolled_back_at: null,
        applied_steps_count: 1
      },
      {
        migration_name: "20260820010000_rolled_back",
        started_at: "2026-08-20T01:00:00.000Z",
        finished_at: "2026-08-20T01:00:00.050Z",
        rolled_back_at: "2026-08-20T01:00:01.000Z",
        applied_steps_count: 0
      },
      {
        migration_name: "20260820010000_rolled_back",
        started_at: "2026-08-20T01:01:00.000Z",
        finished_at: "2026-08-20T01:01:00.050Z",
        rolled_back_at: null,
        applied_steps_count: 0
      }
    ], ["20260820000000_applied", "20260820010000_rolled_back"]);
    expect(summary).toEqual({
      total: 2,
      applied: 2,
      pending: 0,
      failed: 0,
      historicalRollbacks: 1,
      latestDurationMs: 50
    });
    expect(telemetry.setGauge).toHaveBeenCalledWith("orchestra_migrations_state", 0, { state: "failed" });
    expect(telemetry.setGauge).toHaveBeenCalledWith("orchestra_migration_rollbacks_total", 1);
    expect(telemetry.observeDuration).toHaveBeenCalledWith("orchestra_migration_latest_duration_ms", 50, {
      status: "applied"
    });
  });

  it("derives worker retry metadata while preserving a safe originating request id", () => {
    expect(buildWorkerObservation({
      id: "sync|project-1|event-2",
      name: "sync_connector",
      data: { requestId: "api-request-8" },
      attemptsMade: 1,
      opts: { attempts: 3 }
    })).toEqual({
      requestId: "api-request-8",
      jobId: "sync|project-1|event-2",
      attempt: 2,
      attemptClass: "retry",
      maxAttempts: 3
    });
  });

  it("falls back to the job id when a worker payload supplies an unsafe request id", () => {
    expect(buildWorkerObservation({
      id: "parse|document-1|1",
      name: "parse_document",
      data: { requestId: "unsafe request" }
    })).toMatchObject({
      requestId: "parse|document-1|1",
      attempt: 1,
      attemptClass: "initial",
      maxAttempts: 1
    });
  });
});
