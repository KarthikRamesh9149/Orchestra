import path from "node:path";
import { Prisma } from "@prisma/client";
import { buildEvalWorld } from "../evals/helpers/fixture-world.js";
import { getMessageGateMinimums, goldenMessageCaseFiles, loadGoldenProjectFixtures } from "../evals/helpers/case-bank.js";
import { applyGate } from "../evals/helpers/gates.js";
import { loadValidatedJsonlFile, writeEvalReports } from "../evals/helpers/io.js";
import { buildReport } from "../evals/helpers/report.js";
import { scoreMessageCase } from "../evals/helpers/scoring/messages.js";
import { messageEvalCaseSchema } from "../evals/helpers/schemas.js";
import type { MessageEvalCase } from "../evals/helpers/types.js";

const CATEGORY_FILES: Partial<Record<MessageEvalCase["category"], string>> = {
  classification: path.resolve("evals", "message_intelligence", "classification.jsonl"),
  false_positive_guard: path.resolve("evals", "message_intelligence", "false_positive_guard.jsonl"),
  proposal_generation: path.resolve("evals", "message_intelligence", "proposal_generation.jsonl"),
  decision_candidate: path.resolve("evals", "message_intelligence", "decision_candidate.jsonl")
};

function parseArgs() {
  const get = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? null;
  return {
    category: get("category"),
    fixture: get("fixture"),
    caseId: get("case"),
    json: process.argv.includes("--json"),
    ci: process.argv.includes("--ci"),
    reportOnly: process.argv.includes("--report-only")
  };
}

async function loadSeedCases() {
  const fixtures = await loadGoldenProjectFixtures();
  const cases = await Promise.all(
    [...Object.values(CATEGORY_FILES), ...goldenMessageCaseFiles(fixtures)].map((filePath) =>
      loadValidatedJsonlFile(filePath, messageEvalCaseSchema)
    )
  );
  return cases.flat() as MessageEvalCase[];
}

async function main() {
  const args = parseArgs();
  let cases = await loadSeedCases();

  if (args.category) cases = cases.filter((testCase) => testCase.category === args.category);
  if (args.fixture) cases = cases.filter((testCase) => (testCase.projectFixtureId ?? testCase.setup.projectFixture) === args.fixture);
  if (args.caseId) cases = cases.filter((testCase) => testCase.id === args.caseId);
  if (cases.length === 0) {
    throw new Error("No message-intelligence eval cases matched the requested filters");
  }

  const results = [];
  for (const testCase of cases) {
    const world = buildEvalWorld();
    const injected = world.addFixtureMessages(testCase.setup.projectFixture, testCase.setup.messages);
    const projectId = world.refs.resolveProjectId(testCase.setup.projectFixture);
    const actorUserId = world.refs.resolveUserId("manager");
    const targetKind = testCase.targetKind ?? "message";
    const startedAt = Date.now();

    let insightId: string;
    if (targetKind === "thread") {
      const firstRef = injected[testCase.setup.messages[0]];
      const classified = await world.services.threadInsightsService.classifyThread(projectId, firstRef.threadId, actorUserId);
      insightId = classified.id;
    } else {
      const targetRef = testCase.messageIdRef ? injected[testCase.messageIdRef] : injected[testCase.setup.messages[testCase.setup.messages.length - 1]];
      const classified = await world.services.messageInsightsService.classifyMessage(projectId, targetRef.messageId, actorUserId);
      insightId = classified.id;
    }

    const insightStore = targetKind === "thread" ? world.store.threadInsights : world.store.messageInsights;
    const insight = insightStore.get(insightId);
    const insightCountBeforeDuplicateCheck = insightStore.size;

    let duplicateBehavior: "same_body_reuses" | "created_duplicate" | "not_observed" = "not_observed";
    if (testCase.category === "duplicate_supersession") {
      if (targetKind === "thread") {
        const firstRef = injected[testCase.setup.messages[0]];
        await world.services.threadInsightsService.classifyThread(projectId, firstRef.threadId, actorUserId);
      } else {
        const targetRef = testCase.messageIdRef ? injected[testCase.messageIdRef] : injected[testCase.setup.messages[testCase.setup.messages.length - 1]];
        await world.services.messageInsightsService.classifyMessage(projectId, targetRef.messageId, actorUserId);
      }
      duplicateBehavior = insightStore.size === insightCountBeforeDuplicateCheck ? "same_body_reuses" : "created_duplicate";
    }

    let proposalId: string | null = null;
    let decisionId: string | null = null;
    if (insight?.shouldCreateProposal || insight?.shouldCreateDecision) {
      const created = targetKind === "thread"
        ? await world.services.threadInsightsService.autoCreateProposal(projectId, insightId)
        : await world.services.messageInsightsService.autoCreateProposal(projectId, insightId);
      proposalId = created.proposalId ?? null;
      decisionId = created.decisionId ?? null;
    }
    const modelJson = (insight.modelJson ?? {}) as Record<string, any>;
    const aiOps = (modelJson.aiOps ?? {}) as Record<string, any>;
    const truthPolicy = (modelJson.truthPolicy ?? {}) as Record<string, any>;

    results.push(
      scoreMessageCase(testCase, {
        insightType: insight.insightType,
        shouldCreateProposal: insight.shouldCreateProposal,
        shouldCreateDecision: insight.shouldCreateDecision,
        uncertainty: Array.isArray(insight.uncertaintyJson) ? insight.uncertaintyJson : [],
        affectedDocumentSectionIds: Array.isArray(insight.affectedRefsJson?.documentSectionIds) ? insight.affectedRefsJson.documentSectionIds : [],
        affectedBrainNodeIds: Array.isArray(insight.affectedRefsJson?.brainNodeIds) ? insight.affectedRefsJson.brainNodeIds : [],
        proposalId,
        decisionId,
        confidence: toNumber(insight.confidence),
        latencyMs: Date.now() - startedAt,
        duplicateBehavior,
        classifierModel: String(aiOps.classifierModel ?? aiOps.model ?? "mock-message-classifier"),
        modelTier: String(aiOps.modelTier ?? "fast"),
        estimatedInputTokens: Number(aiOps.tokenUsage?.input ?? aiOps.estimatedInputTokens ?? 0),
        estimatedOutputTokens: Number(aiOps.tokenUsage?.output ?? aiOps.estimatedOutputTokens ?? 0),
        estimatedCostUsd: Number(aiOps.estimatedCostUsd ?? 0),
        schemaRepairAttempts: Number(aiOps.schemaRepairAttempts ?? 0),
        invalidAffectedRefsDropped: Number(aiOps.invalidAffectedRefsDropped ?? truthPolicy.invalidAffectedRefsDropped ?? 0),
        truthPolicyBackendDecision: {
          shouldCreateProposal: Boolean(insight.shouldCreateProposal),
          shouldCreateDecision: Boolean(insight.shouldCreateDecision)
        },
        classifierFallbackUsed: Boolean(aiOps.classifierFallbackUsed ?? false)
      })
    );
  }

  const report = applyGate(buildReport("message_intelligence", results), args.category || args.fixture || args.caseId ? {} : getMessageGateMinimums());
  const { jsonPath, mdPath } = await writeEvalReports("message-intelligence-report", report);

  if (args.json) {
    console.log(JSON.stringify(report.summary, null, 2));
  } else {
    console.log(`Message-intelligence evals: ${report.summary.passed}/${report.summary.total} passed`);
    console.log(`JSON report: ${jsonPath}`);
    console.log(`Markdown report: ${mdPath}`);
    if (report.gate && !report.gate.passed) {
      console.log(`Gate failures: ${report.gate.reasons.join("; ")}`);
    }
  }

  if (!report.gate?.passed) {
    process.exitCode = 1;
  }
}

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return Number(value ?? 0);
}

void main();
