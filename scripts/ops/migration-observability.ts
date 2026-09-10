import { PrismaClient } from "@prisma/client";
import { readdir } from "node:fs/promises";
import { observeMigrationState, type MigrationObservation } from "../../src/lib/observability/migration-metrics.js";
import { TelemetryService } from "../../src/lib/observability/telemetry.js";

const prisma = new PrismaClient();

try {
  const rows = await prisma.$queryRaw<MigrationObservation[]>`
    SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
    FROM public._prisma_migrations
    ORDER BY started_at ASC
  `;
  const canonicalMigrationNames = (await readdir(new URL("../../prisma/migrations/", import.meta.url), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const telemetry = new TelemetryService();
  const summary = observeMigrationState(telemetry, rows, canonicalMigrationNames);
  process.stdout.write(`${JSON.stringify(summary)}\n${telemetry.renderPrometheus()}\n`);
  if (summary.failed > 0 || summary.pending > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
