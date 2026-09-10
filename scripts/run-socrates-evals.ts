import path from "node:path";
import { buildEvalWorld } from "../evals/helpers/fixture-world.js";
import { getSocratesGateMinimums, goldenSocratesCaseFiles, loadGoldenProjectFixtures } from "../evals/helpers/case-bank.js";
import { applyGate } from "../evals/helpers/gates.js";
import { loadValidatedJsonlFile, writeEvalReports } from "../evals/helpers/io.js";
import { buildReport } from "../evals/helpers/report.js";
import { scoreSocratesCase } from "../evals/helpers/scoring/socrates.js";
import { socratesEvalCaseSchema } from "../evals/helpers/schemas.js";
import type { SocratesEvalCase } from "../evals/helpers/types.js";

const CATEGORY_FILES: Partial<Record<SocratesEvalCase["category"], string>> = {
  current_truth: path.resolve("evals", "socrates", "current_truth.jsonl"),
  provenance: path.resolve("evals", "socrates", "provenance.jsonl"),
  communication_origin: path.resolve("evals", "socrates", "communication_origin.jsonl"),
  citation_correctness: path.resolve("evals", "socrates", "citation_correctness.jsonl"),
  role_safety: path.resolve("evals", "socrates", "role_safety.jsonl"),
  coding_requirements: path.resolve("evals", "socrates", "coding_requirements.jsonl"),
  socrates_actions: path.resolve("evals", "socrates", "socrates_actions.jsonl"),
  mvp_generated_prd_srs_quality: path.resolve("evals", "socrates", "mvp_generated_prd_srs_quality.jsonl"),
  mvp_manual_context_retrieval: path.resolve("evals", "socrates", "mvp_manual_context_retrieval.jsonl"),
  mvp_image_caption_retrieval: path.resolve("evals", "socrates", "mvp_image_caption_retrieval.jsonl"),
  mvp_coding_requirements_extraction: path.resolve("evals", "socrates", "mvp_coding_requirements_extraction.jsonl"),
  mvp_mermaid_diagram_safety: path.resolve("evals", "socrates", "mvp_mermaid_diagram_safety.jsonl"),
  mvp_responsibility_task_qa: path.resolve("evals", "socrates", "mvp_responsibility_task_qa.jsonl"),
  mvp_socrates_action_suggestions: path.resolve("evals", "socrates", "mvp_socrates_action_suggestions.jsonl"),
  mvp_fireflies_transcript_retrieval: path.resolve("evals", "socrates", "mvp_fireflies_transcript_retrieval.jsonl"),
  mvp_provider_gating: path.resolve("evals", "socrates", "mvp_provider_gating.jsonl"),
  mvp_low_evidence_honesty: path.resolve("evals", "socrates", "mvp_low_evidence_honesty.jsonl")
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
    [...Object.values(CATEGORY_FILES), ...goldenSocratesCaseFiles(fixtures)].map((filePath) =>
      loadValidatedJsonlFile(filePath, socratesEvalCaseSchema)
    )
  );
  return cases.flat() as SocratesEvalCase[];
}

async function main() {
  const args = parseArgs();
  let cases = await loadSeedCases();

  if (args.category) cases = cases.filter((testCase) => testCase.category === args.category);
  if (args.fixture) cases = cases.filter((testCase) => (testCase.projectFixtureId ?? testCase.setup.projectFixture) === args.fixture);
  if (args.caseId) cases = cases.filter((testCase) => testCase.id === args.caseId);
  if (cases.length === 0) {
    throw new Error("No Socrates eval cases matched the requested filters");
  }

  const results = [];
  for (const testCase of cases) {
    const world = buildEvalWorld();
    if (testCase.setup.messages?.length) {
      world.addFixtureMessages(testCase.setup.projectFixture, testCase.setup.messages);
    }
    const projectId = world.refs.resolveProjectId(testCase.setup.projectFixture);
    const actorUserId = world.refs.resolveUserId(testCase.session.role);
    const startedAt = Date.now();
    const response = await world.services.socratesService.answerForEval(projectId, actorUserId, {
      content: testCase.query,
      pageContext: testCase.session.pageContext,
      selectedRefType: testCase.session.selectedRefType ?? null,
      selectedRefId: resolveSelectedRefId(testCase, world),
      viewerState: testCase.session.viewerState ?? null
    });
    results.push(scoreSocratesCase(testCase, response, Date.now() - startedAt));
  }

  const report = applyGate(buildReport("socrates", results), args.category || args.fixture || args.caseId ? {} : getSocratesGateMinimums());
  const { jsonPath, mdPath } = await writeEvalReports("socrates-report", report);

  if (args.json) {
    console.log(JSON.stringify(report.summary, null, 2));
  } else {
    console.log(`Socrates evals: ${report.summary.passed}/${report.summary.total} passed`);
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

function resolveSelectedRefId(testCase: SocratesEvalCase, world: ReturnType<typeof buildEvalWorld>) {
  if (testCase.session.selectedRefId) return testCase.session.selectedRefId;
  if (testCase.session.selectedRefType === "document_section") {
    return world.refs.resolveSectionId(
      testCase.setup.projectFixture,
      documentKeyForFixture(testCase.setup.projectFixture),
      testCase.session.viewerState?.anchorId ?? anchorForFixture(testCase.setup.projectFixture)
    );
  }
  if (testCase.session.selectedRefType === "brain_node") {
    const projectId = world.refs.resolveProjectId(testCase.setup.projectFixture);
    const latestGraph = Array.from(world.store.artifactVersions.values())
      .filter((item: any) => item.projectId === projectId && item.artifactType === "brain_graph" && item.status === "accepted")
      .sort((left: any, right: any) => right.versionNumber - left.versionNumber)[0];
    const node = Array.from(world.store.brainNodes.values()).find(
      (item: any) => item.projectId === projectId && item.artifactVersionId === latestGraph?.id
    );
    return node?.id ?? null;
  }
  return null;
}

function documentKeyForFixture(projectFixture: SocratesEvalCase["setup"]["projectFixture"]) {
  return projectFixture === "project_client_safe" ? "project_client_safe_shared" : projectFixture;
}

function anchorForFixture(projectFixture: SocratesEvalCase["setup"]["projectFixture"]) {
  switch (projectFixture) {
    case "project_beta":
      return "notification-flow";
    case "project_gamma":
      return "launch-alerts";
    case "project_client_safe":
      return "shared-summary";
    case "project_alpha":
    default:
      return "assignment-flow";
  }
}

void main();
