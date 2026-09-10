import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type PrismaBlock = {
  kind: "model" | "enum";
  name: string;
  text: string;
  lines: string[];
};

type FieldRow = {
  field: string;
  dbColumn: string;
  type: string;
  optional: string;
  list: string;
  defaultValue: string;
  dbType: string;
  relation: string;
  attrs: string;
};

type RouteRow = {
  file: string;
  method: string;
  path: string;
  auth: string;
};

const repoRoot = process.cwd();

function rel(filePath: string) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}

function read(relPath: string) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function walk(dir: string): string[] {
  const absolute = path.join(repoRoot, dir);
  if (!existsSync(absolute)) return [];

  const entries = readdirSync(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(absolute, entry.name);
    const relative = rel(entryPath);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "coverage", ".git"].includes(entry.name)) continue;
      files.push(...walk(relative));
    } else {
      files.push(relative);
    }
  }
  return files.sort();
}

function extractPrismaBlocks(schema: string): PrismaBlock[] {
  const lines = schema.split(/\r?\n/);
  const blocks: PrismaBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(model|enum)\s+(\w+)\s+\{/.exec(lines[index]?.trim() ?? "");
    if (!match) continue;

    const kind = match[1] as "model" | "enum";
    const name = match[2];
    const blockLines: string[] = [];
    let depth = 0;
    for (; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      blockLines.push(line);
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      if (depth === 0) break;
    }
    blocks.push({ kind, name, text: blockLines.join("\n"), lines: blockLines });
  }

  return blocks;
}

function extractModelMap(block: PrismaBlock) {
  const mapLine = block.lines.find((line) => line.trim().startsWith("@@map("));
  return mapLine?.match(/@@map\("([^"]+)"\)/)?.[1] ?? block.name;
}

function extractFieldRows(block: PrismaBlock, modelNames: Set<string>): FieldRow[] {
  return block.lines
    .slice(1, -1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => {
      const [field = "", type = "", ...attrParts] = line.split(/\s+/);
      const attrs = attrParts.join(" ");
      const unwrappedType = type.replace(/\?|\[\]/g, "");
      const dbColumn = attrs.match(/@map\("([^"]+)"\)/)?.[1] ?? field;
      const defaultValue = attrs.match(/@default\(([^)]*(?:\)[^)]*)?)\)/)?.[0] ?? "";
      const dbType = (attrs.match(/@db\.[A-Za-z0-9_]+(?:\([^)]*\))?/g) ?? []).join(", ");
      const relation = attrs.match(/@relation\([^)]*\)/)?.[0] ?? (modelNames.has(unwrappedType) ? unwrappedType : "");

      return {
        field,
        dbColumn,
        type,
        optional: type.endsWith("?") ? "yes" : "no",
        list: type.endsWith("[]") ? "yes" : "no",
        defaultValue,
        dbType,
        relation,
        attrs
      };
    });
}

function extractConstraints(block: PrismaBlock) {
  return block.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("@@id") || line.startsWith("@@unique") || line.startsWith("@@index") || line.startsWith("@@map"));
}

function extractEnumValues(block: PrismaBlock) {
  return block.lines
    .slice(1, -1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

function markdownTable(headers: string[], rows: string[][]) {
  const escapeCell = (value: string) => value.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
  return [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => escapeCell(cell || "-")).join(" | ")} |`)
  ].join("\n");
}

function fenced(language: string, value: string) {
  return `\`\`\`${language}\n${value.trimEnd()}\n\`\`\``;
}

function listMigrations() {
  const migrationsDir = path.join(repoRoot, "prisma", "migrations");
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sqlPath = path.join(migrationsDir, entry.name, "migration.sql");
      return {
        name: entry.name,
        sqlPath: rel(sqlPath),
        bytes: existsSync(sqlPath) ? statSync(sqlPath).size : 0
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function extractExportedSchemas(files: string[]) {
  const rows: string[][] = [];
  for (const file of files) {
    const content = read(file);
    const regex = /export\s+const\s+(\w+Schema|\w+Enum)\s*=/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      rows.push([file, match[1]]);
    }
  }
  return rows;
}

function extractInlineSchemas(files: string[]) {
  const rows: string[][] = [];
  for (const file of files) {
    const content = read(file);
    const regex = /const\s+(\w+Schema|\w+Enum)\s*=\s*z\./g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      rows.push([file, match[1], "inline route/service schema"]);
    }
  }
  return rows;
}

function extractRoutes(routeFiles: string[]): RouteRow[] {
  const rows: RouteRow[] = [];
  for (const file of routeFiles) {
    const content = read(file);
    const internalAuthGuardAlias = /internalAuthGuard\s+as\s+authGuard/.test(content);
    const regex = /app\.(get|post|patch|put|delete)\(\s*(?:\{[^}]*\}\s*,\s*)?["']([^"']+)["']/gs;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      const window = content.slice(match.index, Math.min(content.length, match.index + 900));
      let auth = "public or route-local validation";
      if (window.includes("internalAuthGuard") || (internalAuthGuardAlias && window.includes("authGuard("))) {
        auth = "internalAuthGuard";
      } else if (window.includes("authGuard(")) {
        auth = "authGuard";
      }
      if (window.includes("requireManager")) auth += auth === "public or route-local validation" ? "requireManager" : " + requireManager";
      if (window.includes("verifyClientShareAccess") || window.includes("/client/:token")) auth = "tokenized client share";
      if (window.includes("/webhooks/")) auth = "provider webhook verification";
      if (window.includes("/oauth/")) auth = "OAuth callback/state verification";
      rows.push({ file, method: match[1].toUpperCase(), path: match[2], auth });
    }
  }
  return rows.sort((a, b) => `${a.file}:${a.path}`.localeCompare(`${b.file}:${b.path}`));
}

function extractEnvRows() {
  const env = read("src/config/env.ts");
  const schemaStart = env.indexOf("const envSchema = z.object({");
  const schemaEnd = env.indexOf("}).superRefine", schemaStart);
  const schemaBody = schemaStart >= 0 && schemaEnd >= 0 ? env.slice(schemaStart, schemaEnd) : env;
  const rows: string[][] = [];
  for (const line of schemaBody.split(/\r?\n/)) {
    const match = /^\s{2}([A-Z0-9_]+):\s*(.+?)(?:,)?$/.exec(line);
    if (!match) continue;
    const name = match[1];
    const expr = match[2].trim();
    const defaultValue = expr.match(/\.default\(([^)]*)\)/)?.[1] ?? "";
    const required = expr.includes(".optional()") || expr.includes(".default(") ? "no" : "yes";
    const sensitive = /SECRET|TOKEN|KEY|DATABASE_URL|DIRECT_URL|REDIS_URL|PASSWORD|ANTHROPIC|OPENAI|COHERE/.test(name) ? "yes" : "no";
    rows.push([name, expr, defaultValue, required, sensitive]);
  }
  return rows;
}

function extractTypeExports(files: string[]) {
  const rows: string[][] = [];
  for (const file of files) {
    const content = read(file);
    const regex = /export\s+(?:type|interface|const|class)\s+([A-Za-z0-9_]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) rows.push([file, match[1]]);
  }
  return rows;
}

function extractJobNames() {
  const types = read("src/lib/jobs/types.ts");
  const blockMatch = /export const JobNames = \{([\s\S]*?)\} as const;/.exec(types);
  if (!blockMatch) return [];
  const rows: string[][] = [];
  const regex = /(\w+):\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(blockMatch[1]))) {
    rows.push([match[2], match[1]]);
  }
  return rows;
}

function extractJobPayloadNotes() {
  return [
    ["parse_document", "documentVersionPayloadSchema", "{ documentVersionId: uuid, parseRevision: nonnegative int }"],
    ["chunk_document", "documentVersionPayloadSchema", "{ documentVersionId: uuid, parseRevision: nonnegative int }"],
    ["embed_document_chunks", "documentVersionPayloadSchema", "{ documentVersionId: uuid, parseRevision: nonnegative int }"],
    ["generate_source_package", "projectPayloadSchema", "{ projectId: uuid }"],
    ["generate_clarified_brief", "projectPayloadSchema", "{ projectId: uuid }"],
    ["generate_brain_graph", "projectPayloadSchema", "{ projectId: uuid }"],
    ["generate_product_brain", "projectPayloadSchema", "{ projectId: uuid }"],
    ["generate_live_doc", "liveDocPayloadSchema", "{ projectId: uuid, actorUserId?: uuid, proposalId?: uuid, reason?: string }"],
    ["apply_accepted_change", "acceptedChangePayloadSchema", "{ projectId: uuid, proposalId: uuid }"],
    ["precompute_socrates_suggestions", "socratesSuggestionPayloadSchema", "{ projectId: uuid, sessionId: uuid }"],
    ["refresh_dashboard_snapshot", "dashboardPayloadSchema", "{ scope: general|project, orgId: uuid, projectId?: uuid, reason?: string, idempotencyKey?: string }"],
    ["sync_communication_connector", "connectorSyncPayloadSchema", "{ connectorId: uuid, projectId: uuid, syncType, syncRunId: uuid, idempotencyKey? }"],
    ["ingest_communication_batch", "ingestBatchPayloadSchema", "{ projectId: uuid, connectorId: uuid, provider, syncRunId?: uuid, threads: provider refs, messages: provider refs }"],
    ["index_communication_message", "messagePayloadSchema", "{ messageId: uuid, idempotencyKey? }"],
    ["index_project_context_entry", "projectContextPayloadSchema", "{ contextId: uuid, idempotencyKey? }"],
    ["classify_message_insight", "messageClassificationPayloadSchema", "{ messageId: uuid, projectId: uuid, idempotencyKey? }"],
    ["classify_thread_insight", "threadClassificationPayloadSchema", "{ threadId: uuid, projectId: uuid, idempotencyKey? }"],
    ["generate_change_proposal_from_insight", "proposalFromInsightPayloadSchema", "{ projectId: uuid, insightId?: uuid xor threadInsightId?: uuid }"],
    ["sync_calendar_connection", "calendarSyncPayloadSchema", "{ connectionId: uuid, projectId: uuid, syncType, syncRunId: uuid, idempotencyKey? }"]
  ];
}

function groupFilesByModule(files: string[]) {
  const rows = files.map((file) => {
    const parts = file.split("/");
    const moduleName = parts[0] === "src" && parts[1] === "modules" ? parts[2] : parts.slice(0, -1).join("/");
    return [moduleName, file];
  });
  return rows.sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
}

const prismaSchema = read("prisma/schema.prisma");
const blocks = extractPrismaBlocks(prismaSchema);
const models = blocks.filter((block) => block.kind === "model");
const enums = blocks.filter((block) => block.kind === "enum");
const modelNames = new Set(models.map((model) => model.name));
const migrations = listMigrations();
const routeFiles = walk("src").filter((file) => file.endsWith("routes.ts") || file.endsWith("build-app.ts"));
const schemaFiles = walk("src").filter((file) => file.endsWith("schemas.ts") || file.endsWith("schema.ts") || file.endsWith("insight-classifier.prompt.ts"));
const serviceFiles = walk("src/modules").filter((file) => file.endsWith("service.ts") || file.endsWith(".service.ts"));
const jobFiles = walk("src/lib/jobs").filter((file) => file.endsWith(".ts"));
const socratesFiles = [...walk("src/modules/socrates"), ...walk("src/lib/retrieval")].filter((file) => file.endsWith(".ts"));
const communicationFiles = [...walk("src/modules/communications"), ...walk("src/lib/communications")].filter((file) => file.endsWith(".ts"));
const feature8Files = walk("src/modules/project-ops").filter((file) => file.endsWith(".ts"));
const evalFiles = [
  ...walk("evals").filter(
    (file) => !file.startsWith("evals/outputs/") && (file.endsWith(".ts") || file.endsWith(".json"))
  ),
  ...walk("docs/evals").filter((file) => file.endsWith(".md")),
  ...walk("docs/fixtures/evals").filter((file) => file.endsWith(".json") || file.endsWith(".md") || file.endsWith(".jsonl"))
];
const routeRows = extractRoutes(routeFiles);
const exportedSchemaRows = extractExportedSchemas(schemaFiles);
const inlineSchemaRows = extractInlineSchemas(routeFiles.concat(serviceFiles));
const evalSchemaRows = extractExportedSchemas(evalFiles.filter((file) => file.endsWith(".ts")));
const envRows = extractEnvRows();
const jobRows = extractJobNames();
const providerTypeRows = extractTypeExports(["src/lib/communications/provider-normalized-types.ts", "src/lib/communications/provider-types.ts"].filter((file) => existsSync(path.join(repoRoot, file))));
const sourceFiles = [
  "scripts/docs/generate-schema-md.ts",
  "prisma/schema.prisma",
  ...migrations.map((migration) => migration.sqlPath),
  ...schemaFiles,
  ...routeFiles,
  ...jobFiles,
  "src/config/env.ts",
  ...socratesFiles,
  ...communicationFiles,
  ...feature8Files,
  ...evalFiles,
  "docs/SOCRATES_RAG_SPEC.md",
  "docs/EVALS.md"
].filter((file, index, arr) => arr.indexOf(file) === index).sort();

const sourceFingerprint = createHash("sha256");
for (const file of sourceFiles) {
  sourceFingerprint.update(file);
  sourceFingerprint.update("\0");
  sourceFingerprint.update(read(file));
  sourceFingerprint.update("\0");
}
const sourceDigest = sourceFingerprint.digest("hex");

const sections: string[] = [];

sections.push(`# Orchestra Schema Source of Truth

Source fingerprint: \`sha256:${sourceDigest}\`

This document is generated from runtime repository sources. The actual code, Prisma schema, migrations, and Zod schemas remain authoritative. If this file drifts, update \`scripts/docs/generate-schema-md.ts\` and regenerate it instead of hand-editing stale examples.

Source files used:

${sourceFiles.map((file) => `- \`${file}\``).join("\n")}
`);

sections.push(`## 1. Database Schema Source Of Truth

Primary source: \`prisma/schema.prisma\`.

Prisma model count: ${models.length}

Prisma enum count: ${enums.length}

Migration count: ${migrations.length}

All primary identifiers in the current Prisma schema are UUID-based where model IDs use \`@default(uuid()) @db.Uuid\`. Older non-UUID examples formerly in \`docs/schema.md\` are not runtime source of truth.

### Prisma camelCase vs database snake_case

Prisma code uses camelCase model fields. The physical Postgres schema uses mapped snake_case columns through \`@map\` and mapped table names through \`@@map\`. Frontend consumers should use API response names, not raw database columns. DB owners should use the mapped table and column names shown below and in the migrations.
`);

sections.push(`## 2. Prisma Models

Each model below includes the exact Prisma block plus generated field metadata. Relation rows are included because Prisma relation fields are part of the runtime data model even when they do not map to a physical column.
`);

for (const model of models) {
  const tableName = extractModelMap(model);
  const fieldRows = extractFieldRows(model, modelNames);
  const constraints = extractConstraints(model);
  const primaryKey = fieldRows.find((row) => row.attrs.includes("@id"))?.field ?? constraints.find((constraint) => constraint.startsWith("@@id")) ?? "none declared";

  sections.push(`### ${model.name}

DB table: \`${tableName}\`

Primary key: \`${primaryKey}\`

${fenced("prisma", model.text)}

${markdownTable(
  ["Prisma field", "DB column", "Type", "Optional", "List", "Default", "DB type", "Relation", "Attributes"],
  fieldRows.map((row) => [
    row.field,
    row.dbColumn,
    row.type,
    row.optional,
    row.list,
    row.defaultValue,
    row.dbType,
    row.relation,
    row.attrs
  ])
)}

Constraints and mappings:

${constraints.length > 0 ? constraints.map((constraint) => `- \`${constraint}\``).join("\n") : "- No model-level indexes, uniques, or table map declared."}
`);
}

sections.push(`## 3. Prisma Enums

Every enum block below is copied exactly from \`prisma/schema.prisma\`.
`);

for (const enumBlock of enums) {
  sections.push(`### ${enumBlock.name}

Values: ${extractEnumValues(enumBlock).map((value) => `\`${value}\``).join(", ")}

${fenced("prisma", enumBlock.text)}
`);
}

sections.push(`## 4. Database Table And Column Mapping

${markdownTable(
  ["Prisma model", "DB table", "Mapped field count", "Relation field count"],
  models.map((model) => {
    const rows = extractFieldRows(model, modelNames);
    return [
      model.name,
      extractModelMap(model),
      String(rows.filter((row) => row.dbColumn !== row.field).length),
      String(rows.filter((row) => row.relation).length)
    ];
  })
)}
`);

sections.push(`## 5. Database Indexes, Uniques, FKs, Cascade Behavior

Model-level indexes and uniques are generated from \`@@index\`, \`@@unique\`, and \`@@id\` lines. Relation fields with \`@relation(... onDelete: ...)\` define cascade or set-null behavior where present.

${markdownTable(
  ["Model", "Constraint or mapping"],
  models.flatMap((model) => extractConstraints(model).map((constraint) => [model.name, constraint]))
)}
`);

sections.push(`## 6. Migration History

${markdownTable(
  ["Migration", "SQL file", "Bytes"],
  migrations.map((migration) => [migration.name, migration.sqlPath, String(migration.bytes)])
)}
`);

sections.push(`## 7. API Request/Response Schemas

API request validation is defined by exported Zod schemas in module \`schemas.ts\` files and inline route schemas. Response DTOs are often shaped in service methods; those are listed as service-shaped DTO sources and are inferred from code rather than generated Zod response schemas.

### Route inventory

${markdownTable(
  ["File", "Method", "Path", "Auth/role detection"],
  routeRows.map((route) => [route.file, route.method, route.path, route.auth])
)}

### Exported Zod schemas

${markdownTable(["File", "Schema"], exportedSchemaRows)}

### Inline Zod schemas

${markdownTable(["File", "Schema", "Notes"], inlineSchemaRows)}

### Service-shaped DTO sources

${markdownTable(["Module/source", "File"], groupFilesByModule(serviceFiles))}
`);

sections.push(`## 8. Auth And JWT Schemas

Source files: \`src/modules/auth/routes.ts\`, \`src/modules/auth/service.ts\`, \`src/app/auth.ts\`, and \`src/config/env.ts\`.

Runtime facts:

- Signup, login, refresh, logout, and current-user routes are implemented under the auth route module.
- JWT secrets and TTLs come from \`JWT_ACCESS_SECRET\`, \`JWT_REFRESH_SECRET\`, \`JWT_ACCESS_TTL\`, and \`JWT_REFRESH_TTL\`.
- Production rejects weak/default JWT secrets in \`src/config/env.ts\`.
- Internal routes use \`internalAuthGuard\`; manager-only mutations additionally call manager/project access checks in route/service code.
`);

sections.push(`## 9. Project/Member Schemas

Database models: \`Organization\`, \`User\`, \`RefreshToken\`, \`Project\`, and \`ProjectMember\`.

Route and validation sources: \`src/modules/projects/routes.ts\`.

Runtime invariants:

- Projects belong to an organization through mapped UUID foreign keys.
- Project roles are \`manager\`, \`dev\`, and \`client\` at the route validation layer.
- Project reads and mutations must pass project/org membership checks in service code.
`);

sections.push(`## 10. Document/Viewer/Live-Doc Schemas

Database models: \`Document\`, \`DocumentVersion\`, \`DocumentSection\`, \`DocumentChunk\`, \`DocumentProcessingRun\`, \`LiveDocSectionDraft\`, \`LiveDocComment\`, and \`LiveDocSectionRevision\`.

Validation and DTO sources:

${markdownTable(["Module/source", "File"], groupFilesByModule(schemaFiles.filter((file) => /documents|live-doc/.test(file)).concat(serviceFiles.filter((file) => /documents|live-doc/.test(file)))))}

Runtime invariants:

- Uploaded source documents and parsed document versions are source evidence.
- Viewer payloads are section/anchor based.
- Live Doc drafts and comments are separate from accepted Product Brain truth.
- Accepted overlays are derived from accepted changes and do not rewrite source document sections.
`);

sections.push(`## 11. Product Brain/Artifact/Graph Schemas

Database models: \`ArtifactVersion\`, \`BrainNode\`, \`BrainEdge\`, and \`BrainSectionLink\`.

Validation sources:

${markdownTable(["File", "Schema"], exportedSchemaRows.filter(([file]) => file.includes("brain/")))}

Runtime invariants:

- Source Package, Clarified Brief, Brain Graph, and Product Brain are artifact versions.
- Exactly one current accepted Product Brain per project is enforced by service behavior and database indexes.
- Brain nodes and section links retain source evidence through UUID references.
`);

sections.push(`## 12. Change Proposal / Decision Schemas

Database models: \`SpecChangeProposal\`, \`SpecChangeLink\`, and \`DecisionRecord\`.

Validation sources:

${markdownTable(["File", "Schema"], exportedSchemaRows.filter(([file]) => file.includes("changes/")))}

Runtime invariants:

- A needs-review proposal is not accepted truth.
- Only manager acceptance applies truth changes.
- Accepted proposals create newer Product Brain versions and populate accepted brain version linkage.
- Proposal links preserve affected document sections, affected brain nodes, source messages, and source threads when applicable.
`);

sections.push(`## 13. Communication Connector/Provider Schemas

Database models: \`CommunicationConnector\`, \`CommunicationSyncRun\`, \`OAuthState\`, and \`ProviderWebhookEvent\`.

Provider type exports:

${markdownTable(["File", "Export"], providerTypeRows)}

Communication validation schemas:

${markdownTable(["File", "Schema"], exportedSchemaRows.filter(([file]) => file.includes("communications/")))}

Runtime facts:

- Providers are defined by the Prisma \`CommunicationProvider\` enum and module Zod schemas: \`manual_import\`, \`slack\`, \`gmail\`, \`outlook\`, \`microsoft_teams\`, \`whatsapp_business\`, \`fireflies_ai\`, \`clickup\`, and \`granola\`. In MVP, manual import, Fireflies, Slack, ClickUp, Granola, and Microsoft Teams are the default visible communication provider profile; Gmail/Outlook/WhatsApp remain disabled unless explicitly enabled.
- Connector statuses are \`pending_auth\`, \`connected\`, \`syncing\`, \`error\`, and \`revoked\`.
- Provider readiness DTOs expose state, missing configuration names, and deferred capabilities only; they must not expose secret values.
- Raw OAuth tokens are credential-vault material. Prisma connector rows store internal vault references only, and API DTOs strip those references.
`);

sections.push(`## 14. Message/Thread/Insight Schemas

Database models: \`CommunicationThread\`, \`CommunicationMessage\`, \`CommunicationMessageRevision\`, \`CommunicationAttachment\`, \`CommunicationMessageChunk\`, \`MessageInsight\`, and \`ThreadInsight\`.

Runtime invariants:

- Raw messages are source evidence, not truth.
- Provider edits create revisions before current body updates.
- Provider deletes soft-mark evidence with provider-delete fields; accepted provenance remains inspectable.
- Message chunks carry project/thread/message/provider metadata for retrieval.
- Message and thread insights are review signals only.
- Insight statuses are detected, ignored, converted_to_proposal, converted_to_decision, and superseded.
`);

sections.push(`## 15. Socrates Session/Message/Answer Schemas

Database models: \`SocratesSession\`, \`SocratesMessage\`, \`SocratesCitation\`, \`SocratesOpenTarget\`, and \`SocratesSuggestion\`.

Validation schemas:

${markdownTable(["File", "Schema"], exportedSchemaRows.filter(([file]) => file.includes("socrates/")))}

Runtime invariants:

- Socrates sessions and messages are project/user scoped.
- Answer generation uses strict answer, citation, and open-target schemas from \`src/modules/socrates/schemas.ts\`.
- Socrates explains and navigates evidence; it is not a source of truth.
`);

sections.push(`## 16. Citation/Open-Target Schemas

Source: \`src/modules/socrates/schemas.ts\`.

Current citation types and open target unions are defined by \`citationSchema\` and \`openTargetRefSchema\`. Backend validation drops hallucinated citations and open targets that do not resolve to project-scoped evidence. Client contexts block internal communication, change, and decision targets.

Part 7 adds internal \`coding_requirements\` citations/open-targets for accepted engineering-requirements artifacts. Open targets resolve to \`ProjectCodingRequirements\` plus its accepted \`engineering_requirements\` \`ArtifactVersion\`; client contexts block them.
`);

sections.push(`## 17. RAG/Retrieval/Evidence Schemas

Sources:

${socratesFiles.map((file) => `- \`${file}\``).join("\n")}

Eval sources:

${evalFiles.map((file) => `- \`${file}\``).join("\n")}

Exported eval schemas:

${evalSchemaRows.length > 0 ? markdownTable(["File", "Schema"], evalSchemaRows) : "No exported eval Zod schemas detected by the generator."}

Runtime invariants:

- Retrieval candidates are project/org scoped.
- Current-truth questions prioritize accepted Product Brain, accepted changes, and accepted decisions.
- Provenance/origin questions can retrieve original document sections and internal communication messages where role-safe.
- Deleted provider messages are excluded from normal retrieval unless explicitly needed for history/provenance behavior.
- Same-source citation caps and context budgets are controlled by \`SOCRATES_*\` env variables.
`);

sections.push(`## 18. Dashboard Snapshot Schemas

Database model: \`DashboardSnapshot\`.

Validation schemas:

${markdownTable(["File", "Schema"], exportedSchemaRows.filter(([file]) => file.includes("dashboard/")))}

Runtime invariants:

- Dashboard is a snapshot-backed read model.
- General dashboard is manager-only; project dashboard is manager plus assigned dev.
- Dashboard shows freshness and review pressure; it does not mutate Product Brain, documents, proposals, decisions, or communication truth.
`);

sections.push(`## 19. Client Portal/Share Schemas

Database model: \`ProjectClientShare\`.

Route source: \`src/modules/client-view/client-view.routes.ts\`.

Runtime invariants:

- Client access is tokenized and does not use internal JWT routes.
- Client-safe projections strip raw communication bodies, message IDs, thread IDs, provider references, connector metadata, job payloads, proposal internals, internal decisions, and ops internals.
`);

sections.push(`## 20. Feature 7 Project-Ops Schemas

Database models include project events, deadlines, financial summaries, and subscriptions where present in the Prisma model section.

Validation and DTO sources:

${markdownTable(["Module/source", "File"], groupFilesByModule(feature8Files))}

Runtime boundary:

- Project ops is supporting context for dashboard/Socrates/client summaries.
- It must not dominate Dashboard or become finance/accounting/HR truth.
`);

sections.push(`## 21. Feature 8 Automation/Calendar/Cost Schemas

Feature 8 runtime sources are under \`src/modules/project-ops\` and the \`sync_calendar_connection\` job. Active database models and enums are listed exactly in the Prisma sections above. \`materialize_recurring_events\` is absent from \`JobNames\`; do not treat it as an active runtime job unless the code adds it.
`);

sections.push(`## 22. Job/Worker Payload Schemas

Job sources: \`src/lib/jobs/types.ts\`, \`src/lib/jobs/handlers.ts\`, \`src/lib/jobs/keys.ts\`, \`src/lib/jobs/policy.ts\`, \`src/setup-context.ts\`, and \`src/worker.ts\`.

Implemented jobs from \`JobNames\`:

${markdownTable(["Job name", "Const key"], jobRows)}

Payload schemas from \`src/lib/jobs/handlers.ts\`:

${markdownTable(["Job", "Payload schema", "Shape"], extractJobPayloadNotes())}

Runtime invariants:

- Handlers parse payloads with Zod before side effects.
- Idempotency keys are generated in \`src/lib/jobs/keys.ts\`.
- Retry/backoff defaults come from \`src/lib/jobs/policy.ts\` and env config.
- Worker and inline paths use the shared handler factory.
- Job failures are visible through persisted \`JobRun\` records.
`);

sections.push(`## 23. Env/Config Schema

Source: \`src/config/env.ts\`.

${markdownTable(["Variable", "Zod expression", "Default", "Required", "Sensitive"], envRows)}

Production fail-fast rules implemented in \`src/config/env.ts\` include:

- \`QUEUE_MODE=inline\` is rejected in production.
- \`STORAGE_DRIVER=local\` is rejected in production.
- Wildcard CORS origins are rejected in production.
- Weak/default JWT, connector OAuth state, client share token, and metrics token secrets are rejected in production.
- \`CONNECTOR_CREDENTIAL_VAULT_MODE=managed_reference\` is required in production so provider credentials live in managed secret storage/KMS instead of local encrypted files.
- Placeholder Socrates model names and zero-cost production AI telemetry are rejected.
`);

sections.push(`## 24. Credential Vault Schema

Sources: \`src/lib/communications/credential-vault.ts\`, \`src/modules/communications/connectors.service.ts\`, and \`src/config/env.ts\`.

Runtime invariants:

- Provider OAuth credentials are vault data, not API DTO data.
- Prisma rows may persist an internal credential reference, but connector DTOs must strip it.
- Production requires managed-reference credential vault mode by env validation; encrypted-file vaulting remains dev/pilot-only.
`);

sections.push(`## 25. OAuth State/Webhook Schemas

Sources: \`src/lib/communications/oauth-state.ts\`, \`src/modules/communications/communications.routes.ts\`, and provider webhook services.

Runtime invariants:

- OAuth state is signed, expiring, provider-bound, project-bound, actor-bound, and one-time-use.
- Slack and WhatsApp webhooks verify signatures/tokens where configured.
- Provider webhook events are deduped through \`ProviderWebhookEvent\`.
- Webhook route body limits are declared in route definitions.
`);

sections.push(`## 26. Provider Adapter Normalized Types

Provider-normalized source files:

${communicationFiles.filter((file) => file.includes("provider") || file.includes("providers")).map((file) => `- \`${file}\``).join("\n")}

Adapters normalize provider-specific Slack, Gmail, Outlook, Microsoft Teams, WhatsApp Business, Fireflies.ai meeting transcript, and manual import payloads into connector/thread/message/chunk/attachment evidence consumed by ingestion services.
`);

sections.push(`## 27. State Machines

State machines are defined by Prisma enums and module Zod enums:

- Document processing: \`ProcessingStatus\` and document version status fields.
- Artifact generation: \`ArtifactType\` and \`ArtifactStatus\`.
- Change proposals: \`SpecChangeStatus\`.
- Decisions: \`DecisionStatus\`.
- Connectors: \`CommunicationConnectorStatus\`.
- Sync runs: \`CommunicationSyncStatus\`.
- Message/thread insights: \`MessageInsightStatus\` and \`ThreadInsightStatus\`.
- Socrates messages: response/status fields on \`SocratesMessage\`.
- Client shares: \`ClientShareStatus\`.
- Jobs: \`JobRunStatus\`.
- Calendar/project ops: Feature 8 enums listed in the Prisma enum section.
`);

sections.push(`## 28. Cross-Schema Invariants

- Original source documents are immutable source evidence.
- Original communication messages are preserved through current rows plus revision history.
- Insight is not truth.
- Thread insight is not truth.
- Needs-review proposal is not truth.
- Accepted proposal is a reviewed current-truth update and creates a new Product Brain version.
- Accepted changes preserve source messages/threads, affected document sections, affected brain nodes, old/new understanding, and approval metadata where available.
- Product Brain current truth is versioned; old versions remain inspectable.
- Viewer overlays are derived from accepted changes, not source document mutation.
- Socrates citations and open targets must resolve to backend-valid evidence.
- Client-safe routes must not expose internal communication/provider/proposal/ops fields.
- Provider credentials are never returned as raw tokens.
- Dashboard is a read model, not a truth source.
`);

sections.push(`## 29. Frontend Integration-Critical DTOs

Frontend teams should treat route responses and frontend contract docs as DTO sources, not physical DB columns. Critical DTO families are shaped in these files:

${markdownTable(
  ["Surface", "Primary sources"],
  [
    ["Auth/session", "src/modules/auth/routes.ts; src/app/auth.ts"],
    ["Projects/members", "src/modules/projects/routes.ts; src/modules/projects/service.ts"],
    ["Documents/viewer", "src/modules/documents/routes.ts; src/modules/documents/service.ts"],
    ["Brain/graph", "src/modules/brain/routes.ts; src/modules/brain/service.ts"],
    ["Changes/decisions", "src/modules/changes/routes.ts; src/modules/changes/service.ts"],
    ["Live Doc", "src/modules/live-doc/routes.ts; src/modules/live-doc/service.ts"],
    ["Socrates", "src/modules/socrates/routes.ts; src/modules/socrates/schemas.ts; src/modules/socrates/service.ts"],
    ["Dashboard", "src/modules/dashboard/routes.ts; src/modules/dashboard/service.ts"],
    ["Communications", "src/modules/communications/communications.routes.ts; src/modules/communications/schemas.ts"],
    ["Client portal", "src/modules/client-view/client-view.routes.ts; src/modules/client-view/client-view.service.ts"],
    ["Project ops/Feature 8", "src/modules/project-ops/routes.ts; src/modules/project-ops/service.ts"]
  ]
)}
`);

sections.push(`## 30. DB Handoff Checklist References

DB handoff owners should verify:

- \`prisma/schema.prisma\` is the primary schema.
- Migration SQL under \`prisma/migrations\` is applied in order.
- UUID and mapped snake_case table/column names match this document.
- pgvector/extension requirements are confirmed from migrations before provisioning.
- Credential vault files and environment secrets are not database seed data.
- API/frontend teams consume DTOs, not raw table rows.
`);

const outputPath = path.join(repoRoot, "docs/schema.md");
const output = `${sections.join("\n\n").trimEnd()}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (current !== output) {
    console.error("docs/schema.md is stale. Run npm run docs:generate:schema and commit the result.");
    process.exitCode = 1;
  } else {
    console.log(`docs/schema.md matches ${models.length} models, ${enums.length} enums, ${migrations.length} migrations, and ${routeRows.length} routes.`);
  }
} else {
  writeFileSync(outputPath, output, "utf8");
  console.log(`Generated docs/schema.md from ${models.length} models, ${enums.length} enums, ${migrations.length} migrations, ${routeRows.length} routes.`);
}
