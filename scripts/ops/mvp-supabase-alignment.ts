import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../../src/db/prisma.js";

type CheckStatus = "passed" | "warning" | "failed" | "skipped";

interface AlignmentCheck {
  name: string;
  status: CheckStatus;
  details: string[];
}

interface AlignmentReport {
  check: "mvp-supabase-alignment";
  mode: "read-only";
  proofLevel: "static" | "connected_db";
  status: "passed" | "passed_with_warnings" | "failed";
  startedAt: string;
  finishedAt: string;
  databaseUrlPresent: boolean;
  databaseTarget: {
    databaseName?: string;
    serverVersion?: string;
    publicTableCount?: number;
  };
  checks: AlignmentCheck[];
  blockers: string[];
  warnings: string[];
  reportJsonPath: string;
  reportMarkdownPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const REQUIRED_TABLES = [
  "organizations",
  "users",
  "refresh_tokens",
  "projects",
  "project_members",
  "audit_events",
  "job_runs",
  "documents",
  "document_versions",
  "document_sections",
  "document_chunks",
  "artifact_versions",
  "brain_nodes",
  "brain_edges",
  "brain_section_links",
  "spec_change_proposals",
  "spec_change_links",
  "decision_records",
  "project_live_doc_sources",
  "live_doc_section_revisions",
  "live_doc_section_drafts",
  "live_doc_comments",
  "project_responsibilities",
  "project_context_entries",
  "project_context_chunks",
  "project_context_attachments",
  "project_diagrams",
  "live_doc_section_diagrams",
  "project_coding_requirements",
  "project_events",
  "socrates_actions",
  "socrates_sessions",
  "socrates_messages",
  "socrates_citations",
  "socrates_open_targets",
  "socrates_suggestions",
  "communication_connectors",
  "communication_threads",
  "communication_messages",
  "communication_message_chunks",
  "communication_sync_runs",
  "message_insights",
  "thread_insights",
  "communication_attachments",
  "provider_webhook_events",
  "oauth_states",
  "agent_context_packs",
  "agent_context_pack_sources",
  "agent_runs",
  "agent_quality_reviews",
  "mcp_tokens",
  "agent_markdown_file_sets",
  "agent_markdown_files",
  "agent_markdown_file_versions",
  "agent_markdown_sync_runs",
  "agent_markdown_file_quality_reports",
  "agent_markdown_file_drift_reports",
  "github_installations",
  "github_repositories",
  "github_repository_project_links",
  "github_user_links",
  "github_webhook_events",
  "github_sync_runs",
  "github_engineering_evidence",
  "engineering_evidence_items",
  "engineering_evidence_refresh_runs",
  "engineering_evidence_manual_entries",
  "fde_readiness_runs",
  "fde_readiness_findings",
  "fde_rationale_traces",
  "fde_rationale_trace_hops",
  "fde_decision_engineering_links"
] as const;

const ALLOWED_SECRET_LIKE_COLUMNS = new Set([
  "agent_context_packs.max_token_budget",
  "agent_context_packs.token_estimate",
  "agent_context_packs.token_estimate_method",
  "agent_markdown_files.template_key",
  "brain_nodes.node_key",
  "communication_attachments.file_key",
  "communication_connectors.credentials_ref",
  "communication_message_chunks.token_count",
  "document_chunks.token_count",
  "document_sections.section_key",
  "document_versions.file_key",
  "engineering_evidence_items.evidence_key",
  "fde_readiness_findings.finding_key",
  "github_repositories.private",
  "job_runs.idempotency_key",
  "live_doc_comments.section_key",
  "live_doc_section_diagrams.section_key",
  "live_doc_section_drafts.section_key",
  "live_doc_section_revisions.event_key",
  "live_doc_section_revisions.section_key",
  "mcp_tokens.token_hash",
  "mcp_tokens.token_prefix",
  "project_calendar_connections.credentials_ref",
  "project_drive_connections.credential_ref",
  "project_drive_sync_roots.last_change_page_token",
  "project_drive_sync_roots.last_start_page_token",
  "project_drive_watch_channels.token_hash",
  "project_client_shares.token_hash",
  "project_client_shares.token_prefix",
  "project_editor_connectors.token_hash",
  "project_editor_connectors.token_prefix",
  "project_context_attachments.storage_key",
  "project_context_chunks.token_estimate",
  "refresh_tokens.token_hash",
  "users.password_hash"
]);

function createReport(): AlignmentReport {
  const stem = "mvp-supabase-alignment-report";
  return {
    check: "mvp-supabase-alignment",
    mode: "read-only",
    proofLevel: process.env.DATABASE_URL ? "connected_db" : "static",
    status: "failed",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    databaseUrlPresent: Boolean(process.env.DATABASE_URL),
    databaseTarget: {},
    checks: [],
    blockers: [],
    warnings: [],
    reportJsonPath: path.resolve(repoRoot, `artifacts/ops/${stem}.json`),
    reportMarkdownPath: path.resolve(repoRoot, `artifacts/ops/${stem}.md`)
  };
}

function addCheck(report: AlignmentReport, name: string, status: CheckStatus, details: string[]) {
  report.checks.push({ name, status, details });
  if (status === "failed") report.blockers.push(`${name}: ${details.join("; ")}`);
  if (status === "warning") report.warnings.push(`${name}: ${details.join("; ")}`);
}

async function migrationDirectories() {
  const migrationRoot = path.resolve(repoRoot, "prisma/migrations");
  const entries = await readdir(migrationRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function runStaticChecks(report: AlignmentReport) {
  const pkg = JSON.parse(await readFile(path.resolve(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const docs = await Promise.all([
    readFile(path.resolve(repoRoot, "docs/DB_HANDOFF.md"), "utf8").catch(() => ""),
    readFile(path.resolve(repoRoot, "docs/ENV_AND_DEPLOYMENT.md"), "utf8").catch(() => ""),
    readFile(path.resolve(repoRoot, "docs/MVP_RELEASE_CHECKLIST.md"), "utf8").catch(() => "")
  ]);
  const joinedDocs = docs.join("\n");
  const dirs = await migrationDirectories();

  addCheck(report, "Prisma migration source of truth", pkg.scripts?.["prisma:deploy"] === "prisma migrate deploy" ? "passed" : "failed", [
    "`prisma:deploy` must run `prisma migrate deploy`"
  ]);
  addCheck(report, "Migration directory inventory", dirs.length > 0 ? "passed" : "failed", [
    `${dirs.length} migration directories found`,
    `last repo migration: ${dirs.at(-1) ?? "none"}`
  ]);
  addCheck(report, "Production db-push prohibition docs", /do not use `?db push`?/i.test(joinedDocs) ? "passed" : "warning", [
    "docs should state db push is not the production migration source of truth"
  ]);
  addCheck(report, "DB handoff migration proof docs", joinedDocs.includes("_prisma_migrations") ? "passed" : "warning", [
    "docs should require _prisma_migrations proof"
  ]);
}

async function roleProjectCount(prisma: PrismaClient, roleName: "anon" | "authenticated") {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local role ${roleName}`);
    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint | number }>>("select count(*) as count from public.projects");
    return Number(rows[0]?.count ?? 0);
  });
}

async function runConnectedDbChecks(report: AlignmentReport) {
  if (!process.env.DATABASE_URL) {
    addCheck(report, "Connected DB proof", "skipped", ["DATABASE_URL is not set; static checks only"]);
    return;
  }

  const prisma = createPrismaClient();
  try {
    const [db] = await prisma.$queryRaw<Array<{ database_name: string; server_version: string; public_table_count: bigint | number }>>`
      select current_database() as database_name,
             current_setting('server_version') as server_version,
             (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') as public_table_count
    `;
    report.databaseTarget = {
      databaseName: db?.database_name,
      serverVersion: db?.server_version,
      publicTableCount: Number(db?.public_table_count ?? 0)
    };

    const repoMigrations = await migrationDirectories();
    const migrationRows = await prisma.$queryRaw<Array<{ migration_name: string; rolled_back_at: Date | null }>>`
      select migration_name, rolled_back_at from public._prisma_migrations order by started_at
    `;
    const applied = migrationRows.filter((row) => row.rolled_back_at === null).map((row) => row.migration_name);
    const missingInDb = repoMigrations.filter((name) => !applied.includes(name));
    const extraInDb = applied.filter((name) => !repoMigrations.includes(name));
    addCheck(report, "Prisma migration state", missingInDb.length === 0 && extraInDb.length === 0 ? "passed" : "failed", [
      `${applied.length} applied Prisma migrations`,
      `last applied migration: ${applied.at(-1) ?? "none"}`,
      missingInDb.length ? `missing in DB: ${missingInDb.join(", ")}` : "no repo migrations missing in DB",
      extraInDb.length ? `extra in DB: ${extraInDb.join(", ")}` : "no extra DB migrations"
    ]);

    const [migrationTables] = await prisma.$queryRaw<Array<{ prisma_table: string | null; supabase_table: string | null }>>`
      select to_regclass('public._prisma_migrations')::text as prisma_table,
             to_regclass('supabase_migrations.schema_migrations')::text as supabase_table
    `;
    addCheck(report, "Migration tracking tables", migrationTables?.prisma_table ? "passed" : "failed", [
      `_prisma_migrations: ${migrationTables?.prisma_table ?? "missing"}`,
      `supabase_migrations.schema_migrations: ${migrationTables?.supabase_table ?? "not present; Supabase-native tracking intentionally unused when Prisma is canonical"}`
    ]);

    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const existingTables = new Set(tables.map((row) => row.table_name));
    const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table));
    addCheck(report, "Required MVP table families", missingTables.length === 0 ? "passed" : "failed", [
      `${REQUIRED_TABLES.length - missingTables.length}/${REQUIRED_TABLES.length} required tables present`,
      missingTables.length ? `missing: ${missingTables.join(", ")}` : "all required MVP/Product Brain/Agent/FDE tables exist"
    ]);

    const [rls] = await prisma.$queryRaw<
      Array<{ table_count: bigint | number; rls_enabled: bigint | number; policy_count: bigint | number; backend_only_deny_policy_count: bigint | number }>
    >`
      select count(*) as table_count,
             count(*) filter (where c.relrowsecurity) as rls_enabled,
             (select count(*) from pg_policies where schemaname = 'public') as policy_count,
             (
               select count(*)
               from pg_policies p
               where p.schemaname = 'public'
                 and p.policyname = 'backend_api_only_no_direct_client_access'
                 and p.cmd = 'ALL'
                 and p.permissive = 'RESTRICTIVE'
                 and p.qual in ('false', '(false)')
                 and p.with_check in ('false', '(false)')
             ) as backend_only_deny_policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
    `;
    const anonProjectCount = await roleProjectCount(prisma, "anon");
    const authenticatedProjectCount = await roleProjectCount(prisma, "authenticated");
    const rlsHardDeny =
      Number(rls?.table_count ?? 0) === Number(rls?.rls_enabled ?? -1) &&
      Number(rls?.table_count ?? 0) === Number(rls?.backend_only_deny_policy_count ?? -1) &&
      anonProjectCount === 0 &&
      authenticatedProjectCount === 0;
    addCheck(report, "RLS backend-only hard-deny posture", rlsHardDeny ? "passed" : "failed", [
      `${Number(rls?.rls_enabled ?? 0)}/${Number(rls?.table_count ?? 0)} public tables have RLS enabled`,
      `${Number(rls?.policy_count ?? 0)} public RLS policies`,
      `${Number(rls?.backend_only_deny_policy_count ?? 0)} backend-only restrictive deny policies`,
      `anon visible project count: ${anonProjectCount}`,
      `authenticated visible project count: ${authenticatedProjectCount}`
    ]);

    const extensions = await prisma.$queryRaw<Array<{ name: string; schema: string; version: string }>>`
      select e.extname as name, n.nspname as schema, e.extversion as version
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      order by e.extname
    `;
    const publicExtensions = extensions.filter((extension) => ["vector", "pg_trgm"].includes(extension.name) && extension.schema === "public");
    addCheck(report, "Extension placement", publicExtensions.length > 0 ? "warning" : "passed", [
      extensions.map((extension) => `${extension.name}@${extension.schema} ${extension.version}`).join(", "),
      publicExtensions.length
        ? "vector/pg_trgm are in public; run the Supabase advisor hardening migration after staged rehearsal"
        : "vector/pg_trgm are not installed in public"
    ]);

    const duplicateIndexes = await prisma.$queryRaw<Array<{ table_name: string; indexes: string[] }>>`
      select indrelid::regclass::text as table_name,
             array_agg(indexrelid::regclass::text order by indexrelid::regclass::text) as indexes
      from pg_index
      join pg_class table_class on table_class.oid = pg_index.indrelid
      join pg_namespace table_schema on table_schema.oid = table_class.relnamespace
      where table_schema.nspname = 'public'
      group by indrelid, indkey, indclass, indcollation, indoption, indexprs, indpred
      having count(*) > 1
      order by indrelid::regclass::text
    `;
    addCheck(report, "Duplicate index advisory check", duplicateIndexes.length > 0 ? "warning" : "passed", [
      duplicateIndexes.length
        ? duplicateIndexes.map((row) => `${row.table_name}: ${row.indexes.join(", ")}`).join("; ")
        : "no duplicate indexes detected"
    ]);

    const secretLikeColumns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      select table_name, column_name
      from information_schema.columns
      where table_schema='public'
        and (
          lower(column_name) like '%secret%' or lower(column_name) like '%token%' or lower(column_name) like '%key%' or
          lower(column_name) like '%credential%' or lower(column_name) like '%password%' or lower(column_name) like '%private%'
        )
      order by table_name, column_name
    `;
    const unexpectedSecretLikeColumns = secretLikeColumns
      .map((row) => `${row.table_name}.${row.column_name}`)
      .filter((key) => !ALLOWED_SECRET_LIKE_COLUMNS.has(key));
    addCheck(report, "Raw secret storage shape", unexpectedSecretLikeColumns.length === 0 ? "passed" : "failed", [
      unexpectedSecretLikeColumns.length
        ? `unexpected secret-like columns: ${unexpectedSecretLikeColumns.join(", ")}`
        : "only hashes, prefixes, vault references, storage keys, token counts, and password hashes were found in secret-like columns"
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sanitizedMessage = message
      .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[redacted-database-url]")
      .replace(/at `[^`]+`/g, "at [redacted-host]");
    addCheck(report, "Connected DB proof", "failed", [
      "DATABASE_URL was present, but Prisma could not complete read-only connected checks",
      sanitizedMessage.split("\n").filter(Boolean).slice(0, 4).join(" ")
    ]);
  } finally {
    await prisma.$disconnect();
  }
}

function finalize(report: AlignmentReport) {
  report.finishedAt = new Date().toISOString();
  if (report.checks.some((check) => check.status === "failed")) report.status = "failed";
  else if (report.checks.some((check) => check.status === "warning" || check.status === "skipped")) {
    report.status = "passed_with_warnings";
  } else report.status = "passed";
  return report;
}

function buildMarkdown(report: AlignmentReport) {
  const checks = report.checks
    .map((check) => `| ${check.name} | ${check.status} | ${check.details.join("<br>")} |`)
    .join("\n");
  return `# MVP Supabase Alignment Report

## Result
- Status: ${report.status}
- Mode: ${report.mode}
- Proof level: ${report.proofLevel}
- DATABASE_URL present: ${report.databaseUrlPresent ? "yes" : "no"}
- Database: ${report.databaseTarget.databaseName ?? "not connected"}
- Postgres: ${report.databaseTarget.serverVersion ?? "not connected"}
- Public tables: ${report.databaseTarget.publicTableCount ?? "not connected"}
- Started: ${report.startedAt}
- Finished: ${report.finishedAt}

This report is read-only. It must not print connection strings, tokens, provider credentials, or Supabase keys.

## Checks
| Check | Status | Details |
| --- | --- | --- |
${checks || "| - | - | - |"}

## Blockers
${report.blockers.length ? report.blockers.map((item) => `- ${item}`).join("\n") : "- None"}

## Warnings
${report.warnings.length ? report.warnings.map((item) => `- ${item}`).join("\n") : "- None"}
`;
}

async function writeReport(report: AlignmentReport) {
  await mkdir(path.dirname(report.reportJsonPath), { recursive: true });
  await writeFile(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(report.reportMarkdownPath, buildMarkdown(report));
}

export async function runMvpSupabaseAlignment() {
  const report = createReport();
  await runStaticChecks(report);
  await runConnectedDbChecks(report);
  finalize(report);
  await writeReport(report);
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = await runMvpSupabaseAlignment();
  console.log(`MVP Supabase alignment ${report.status}. Report: ${report.reportMarkdownPath}`);
  if (report.status === "failed") process.exitCode = 1;
}
