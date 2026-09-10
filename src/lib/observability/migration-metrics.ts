import type { TelemetryService } from "./telemetry.js";

export type MigrationObservation = {
  migration_name: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
  applied_steps_count: number;
};

export type MigrationTelemetrySummary = {
  total: number;
  applied: number;
  pending: number;
  failed: number;
  historicalRollbacks: number;
  latestDurationMs: number | null;
};

function durationMs(row: MigrationObservation): number | null {
  if (!row.finished_at) return null;
  const started = new Date(row.started_at).getTime();
  const finished = new Date(row.finished_at).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return finished - started;
}

export function observeMigrationState(
  telemetry: Pick<TelemetryService, "setGauge" | "observeDuration">,
  rows: MigrationObservation[],
  canonicalMigrationNames: string[] = []
): MigrationTelemetrySummary {
  const latestByName = new Map<string, MigrationObservation>();
  for (const row of rows) {
    const current = latestByName.get(row.migration_name);
    if (!current || new Date(row.started_at).getTime() > new Date(current.started_at).getTime()) {
      latestByName.set(row.migration_name, row);
    }
  }
  const latestRows = [...latestByName.values()];
  const appliedNames = new Set(
    latestRows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name)
  );
  const applied = appliedNames.size;
  const failed = latestRows.filter((row) => !row.finished_at && !row.rolled_back_at).length;
  const rolledBackLatest = latestRows.filter((row) => Boolean(row.rolled_back_at)).length;
  const pending = canonicalMigrationNames.length > 0
    ? canonicalMigrationNames.filter((name) => !appliedNames.has(name)).length
    : rolledBackLatest;
  const historicalRollbacks = rows.filter((row) => Boolean(row.rolled_back_at)).length;
  const latest = [...rows].sort(
    (left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime()
  )[0];
  const latestDurationMs = latest ? durationMs(latest) : null;

  telemetry.setGauge("orchestra_migrations_total", latestRows.length);
  telemetry.setGauge("orchestra_migrations_state", applied, { state: "applied" });
  telemetry.setGauge("orchestra_migrations_state", pending, { state: "pending" });
  telemetry.setGauge("orchestra_migrations_state", failed, { state: "failed" });
  telemetry.setGauge("orchestra_migration_rollbacks_total", historicalRollbacks);
  if (latestDurationMs !== null) {
    telemetry.observeDuration("orchestra_migration_latest_duration_ms", latestDurationMs, {
      status: latest?.rolled_back_at ? "rolled_back" : "applied"
    });
  }

  return { total: latestRows.length, applied, pending, failed, historicalRollbacks, latestDurationMs };
}
