import { getEnv } from "../../src/config/env.js";
import { createPrismaClient } from "../../src/db/prisma.js";
import { createEmbeddingProvider, createGenerationProvider, createTranscriptionProvider } from "../../src/lib/ai/index.js";
import { createStorageDriver } from "../../src/lib/storage/index.js";
import { createLogger } from "../../src/lib/logging/logger.js";
import { TelemetryService } from "../../src/lib/observability/telemetry.js";
import { buildContext } from "../../src/setup-context.js";
import { deepResearchResultsSchema } from "../../src/modules/deep-research/schemas.js";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("  ✗ FAIL:", msg);
    process.exitCode = 1;
    throw new Error(`assertion failed: ${msg}`);
  }
  console.log("  ✓", msg);
}

async function main() {
  const env = getEnv();
  const prisma = createPrismaClient();
  const context = buildContext({
    env,
    prisma,
    logger: createLogger(env.LOG_LEVEL),
    storage: createStorageDriver(env),
    generationProvider: createGenerationProvider(env),
    embeddingProvider: createEmbeddingProvider(env),
    transcriptionProvider: createTranscriptionProvider(env),
    telemetry: new TelemetryService()
  });
  const svc = context.services.deepResearchService;
  const stamp = Date.now();

  console.log("Seeding org/user/project/member…");
  const org = await prisma.organization.create({ data: { name: `Smoke ${stamp}`, slug: `smoke-${stamp}` } });
  const email = `smoke-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: { orgId: org.id, email, normalizedEmail: email, passwordHash: "x", displayName: "Smoke", globalRole: "owner", workspaceRoleDefault: "manager" }
  });
  const project = await prisma.project.create({
    data: { orgId: org.id, name: "Smoke Project", slug: `smoke-proj-${stamp}`, status: "active", createdBy: user.id }
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: user.id, projectRole: "manager", isActive: true } });
  const actor = { userId: user.id, orgId: org.id };

  console.log("\n1) startRun (inline job runs the pipeline synchronously)…");
  const started = await svc.startRun(project.id, actor, {
    researchFocus: "auth flow reliability and onboarding drop-off",
    sources: ["docs", "slack", "web"],
    outputFormat: "full_report",
    privacyMode: "internal_plus_web",
    webSearchEnabled: true
  });
  assert(typeof started.id === "string" && started.id.length > 0, "startRun returns a run id");

  console.log("\n2) getRun → completed + schema-valid results…");
  const run = await svc.getRun(project.id, started.id, actor);
  assert(run.status === "completed", `run status is completed (got "${run.status}"${run.error ? `: ${run.error}` : ""})`);
  const parsed = deepResearchResultsSchema.safeParse(run.results);
  assert(parsed.success, "results validate against the report schema");
  assert(typeof run.results?.stats?.duration === "string", "stats.duration present");

  // Print the REAL generated report so we can eyeball actual OpenAI output + web sources
  const r = run.results!;
  console.log("\n────────── GENERATED REPORT (real OpenAI) ──────────");
  console.log("Executive summary:\n  " + r.executiveSummary);
  console.log(`\nFindings (${r.findings.length}):`);
  r.findings.forEach((f) => console.log(`  [${f.severity}] ${f.category} — ${f.title}\n     sources: ${f.sources}`));
  console.log(`\nMarket context / web sources (${r.marketContext.length}):`);
  r.marketContext.forEach((m) => console.log(`  • ${m.title}\n     ${m.body.slice(0, 160)}`));
  console.log(`\nRecommended actions (${r.recommendedActions.length}):`);
  r.recommendedActions.forEach((a) => console.log(`  [${a.priority}] ${a.action}`));
  console.log(`\nStats: ${JSON.stringify(r.stats)}`);
  console.log(`webSearchUsed(DB flag): ${(await prisma.deepResearchRun.findUnique({ where: { id: started.id } }))?.webSearchUsed}`);
  console.log("─────────────────────────────────────────────────────\n");
  assert(r.marketContext.length > 0, "web search populated marketContext (proves live web search worked)");

  console.log("\n3) getUsage reflects the run…");
  const usage = await svc.getUsage(project.id, actor);
  assert(usage.used >= 1, `usage.used >= 1 (got ${usage.used})`);
  assert(usage.limit === env.DEEP_RESEARCH_MONTHLY_LIMIT, `usage.limit = monthly cap (${usage.limit})`);

  console.log("\n4) addToMemory creates a ProjectContextEntry (evidence, source=generated)…");
  const mem = await svc.addToMemory(project.id, started.id, actor);
  assert(mem.success && typeof mem.memoryEntryId === "string", "addToMemory succeeded");
  const entry = await prisma.projectContextEntry.findUnique({ where: { id: mem.memoryEntryId } });
  assert(!!entry && entry.source === "generated", "context entry persisted with source=generated");

  console.log("\n5) exportReport (markdown + pdf)…");
  const md = await svc.exportReport(project.id, started.id, actor, "markdown");
  assert(md.format === "markdown" && typeof md.body === "string" && md.body.includes("Deep Research"), "markdown export produced");
  const pdf = await svc.exportReport(project.id, started.id, actor, "pdf");
  const pdfBytes = Buffer.isBuffer(pdf.body) ? pdf.body.length : 0;
  assert(pdf.format === "pdf" && pdfBytes > 500, `pdf export produced (${pdfBytes} bytes)`);

  console.log(`\n✅ DEEP RESEARCH SMOKE PASSED — run ${started.id}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("\n❌ SMOKE ERROR:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
