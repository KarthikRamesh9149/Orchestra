import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type AppliedMigration = { name: string; checksum: string; applied: boolean };

export const migrationLedgerSql = `
  SELECT COALESCE(json_agg(json_build_object(
    'name', migration_name, 'checksum', checksum,
    'applied', finished_at IS NOT NULL AND rolled_back_at IS NULL
  )), '[]'::json) FROM public._prisma_migrations
`;

export function readMigrationManifest(directory: string): Map<string, string> {
  const approved = new Map<string, string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Unexpected symlink in migration directory");
    if (!entry.isDirectory()) continue;
    const bytes = readFileSync(join(directory, entry.name, "migration.sql"));
    approved.set(entry.name, createHash("sha256").update(bytes).digest("hex"));
  }
  if (!approved.size) throw new Error("Source migration manifest is empty");
  return approved;
}

export function verifyAppliedMigrations(approved: ReadonlyMap<string, string>, rows: AppliedMigration[]): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const checksum = approved.get(row.name);
    if (!checksum) throw new Error(`Unexpected database migration: ${row.name}`);
    if (!row.applied) throw new Error(`Unfinished database migration: ${row.name}`);
    if (seen.has(row.name)) throw new Error(`Duplicate database migration: ${row.name}`);
    if (checksum !== row.checksum) throw new Error(`Migration checksum mismatch: ${row.name}`);
    seen.add(row.name);
  }
  const missing = [...approved.keys()].find(name => !seen.has(name));
  if (missing) throw new Error(`Missing database migration: ${missing}`);
  return seen.size;
}
