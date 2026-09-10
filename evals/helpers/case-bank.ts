import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { MessageEvalCase, SocratesEvalCase } from "./types.js";
import { goldenProjectFixtureSchema } from "./schemas.js";

export type GoldenProject = {
  id: string;
  title: string;
  mappedProjectFixture: SocratesEvalCase["setup"]["projectFixture"];
  directory: string;
};

export const SOCRATES_TARGETS: Record<SocratesEvalCase["category"], number> = {
  current_truth: 50,
  provenance: 40,
  communication_origin: 30,
  citation_correctness: 0,
  role_safety: 0,
  doc_viewer_selected_section: 20,
  brain_graph_selected_node: 20,
  dashboard_status: 20,
  client_safe_leakage: 20,
  bad_ambiguous_no_evidence: 20,
  coding_requirements: 0,
  socrates_actions: 0,
  mvp_generated_prd_srs_quality: 8,
  mvp_manual_context_retrieval: 8,
  mvp_image_caption_retrieval: 8,
  mvp_coding_requirements_extraction: 10,
  mvp_mermaid_diagram_safety: 10,
  mvp_responsibility_task_qa: 8,
  mvp_socrates_action_suggestions: 10,
  mvp_fireflies_transcript_retrieval: 8,
  mvp_provider_gating: 5,
  mvp_low_evidence_honesty: 10
};

export const MESSAGE_TARGETS: Record<MessageEvalCase["category"], number> = {
  classification: 0,
  false_positive_guard: 0,
  proposal_generation: 0,
  decision_candidate: 0,
  false_positive: 50,
  real_requirement_change: 40,
  decision_approval: 30,
  blocker_risk_action: 30,
  ambiguous_chat: 30,
  duplicate_supersession: 20,
  invalid_ref: 20
};

const REQUIRED_GOLDEN_FILES = [
  "fixture.json",
  "prd.md",
  "srs.md",
  "supporting_docs.json",
  "communications.json",
  "accepted_proposals.json",
  "rejected_proposals.json",
  "decisions.json",
  "product_brain.json",
  "brain_graph.json",
  "viewer_sections.json",
  "dashboard_snapshot.json",
  "expected_socrates.jsonl",
  "expected_message_intelligence.jsonl"
];

export function getSocratesGateMinimums() {
  return SOCRATES_TARGETS;
}

export function getMessageGateMinimums() {
  return MESSAGE_TARGETS;
}

export async function loadGoldenProjectFixtures(rootDir = path.resolve("docs", "fixtures", "evals", "golden_projects")) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const fixtures: GoldenProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(rootDir, entry.name);
    await assertGoldenFixtureComplete(directory);
    const manifestPath = path.join(directory, "fixture.json");
    const parsed = goldenProjectFixtureSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    fixtures.push({
      id: parsed.id,
      title: parsed.title,
      mappedProjectFixture: parsed.mappedProjectFixture,
      directory
    });
  }
  if (fixtures.length !== 5) {
    throw new Error(`Expected exactly 5 golden project fixtures, found ${fixtures.length}`);
  }
  return fixtures.sort((left, right) => left.id.localeCompare(right.id));
}

export function goldenSocratesCaseFiles(fixtures: GoldenProject[]) {
  return fixtures.map((fixture) => path.join(fixture.directory, "expected_socrates.jsonl"));
}

export function goldenMessageCaseFiles(fixtures: GoldenProject[]) {
  return fixtures.map((fixture) => path.join(fixture.directory, "expected_message_intelligence.jsonl"));
}

async function assertGoldenFixtureComplete(directory: string) {
  const missing: string[] = [];
  for (const fileName of REQUIRED_GOLDEN_FILES) {
    try {
      await access(path.join(directory, fileName));
    } catch {
      missing.push(fileName);
    }
  }
  if (missing.length > 0) {
    throw new Error(`${directory} is missing golden fixture file(s): ${missing.join(", ")}`);
  }
}
