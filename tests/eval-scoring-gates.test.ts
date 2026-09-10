import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyGate } from "../evals/helpers/gates.js";
import { buildReport } from "../evals/helpers/report.js";
import { scoreMessageCase } from "../evals/helpers/scoring/messages.js";
import { scoreSocratesCase } from "../evals/helpers/scoring/socrates.js";
import type { MessageEvalCase, SocratesEvalCase } from "../evals/helpers/types.js";

describe("Part 4 eval scoring and gates", () => {
  it("does not allow dashboard snapshots in client-safe Socrates fixture expectations", () => {
    const files = [
      ...fs.readdirSync(path.resolve("evals", "socrates")).filter((file) => file.endsWith(".jsonl")).map((file) => path.resolve("evals", "socrates", file)),
      ...findFiles(path.resolve("docs", "fixtures", "evals", "golden_projects"), "expected_socrates.jsonl")
    ];

    const leakingCases: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const testCase = JSON.parse(line) as SocratesEvalCase;
        const isClientSafe = testCase.session?.role === "client" || testCase.session?.pageContext === "client_view" || testCase.clientSafeExpected === true;
        if (!isClientSafe) continue;
        const allowed = testCase.expectations?.allowedCitationTypes ?? [];
        if (allowed.includes("dashboard_snapshot" as any)) {
          leakingCases.push(`${path.relative(process.cwd(), file)}:${testCase.id}`);
        }
      }
    }

    expect(leakingCases).toEqual([]);
  });

  it("fails Socrates client-safety leaks", () => {
    const testCase: SocratesEvalCase = {
      id: "client_leak",
      category: "client_safe_leakage",
      title: "Client leak",
      setup: { projectFixture: "project_client_safe" },
      session: { pageContext: "client_view", selectedRefType: null, selectedRefId: null, viewerState: null, role: "client" },
      query: "Show internal Slack evidence",
      clientSafeExpected: true,
      expectations: {}
    };

    const result = scoreSocratesCase(testCase, {
      answer_md: "Internal threadId leaked",
      citations: [{ type: "message", refId: "msg_1" }],
      open_targets: [{ targetType: "message", targetRef: { messageId: "msg_1" } }],
      suggested_prompts: [],
      confidence: "high",
      limitations: [],
      debug: {
        intent: "communication_lookup",
        retrievalPlan: { primaryDomains: [], sourcePrecedence: [] },
        estimated_input_tokens: 100,
        prompt_version: "test",
        evidence_cards: []
      }
    }, 5);

    expect(result.passed).toBe(false);
    expect(result.checks.client_safety_correctness).toBe(false);
  });

  it("fails Socrates client-safe dashboard snapshot leaks", () => {
    const testCase: SocratesEvalCase = {
      id: "client_dashboard_leak",
      category: "client_safe_leakage",
      title: "Client dashboard leak",
      setup: { projectFixture: "project_client_safe" },
      session: { pageContext: "client_view", selectedRefType: null, selectedRefId: null, viewerState: null, role: "client" },
      query: "Show client status",
      clientSafeExpected: true,
      expectations: { allowedCitationTypes: ["document_chunk", "brain_node", "dashboard_snapshot"] }
    };

    const result = scoreSocratesCase(testCase, {
      answer_md: "Dashboard status is green.",
      citations: [{ type: "dashboard_snapshot", refId: "dash_1" }],
      open_targets: [{ targetType: "dashboard_filter", targetRef: { filter: "status" } }],
      suggested_prompts: [],
      confidence: "high",
      limitations: [],
      debug: {
        intent: "dashboard_status",
        retrievalPlan: { primaryDomains: ["dashboard_snapshots"], sourcePrecedence: ["dashboard_facts"] },
        estimated_input_tokens: 100,
        estimated_output_tokens: 10,
        prompt_version: "test",
        evidence_cards: [{ sourceType: "dashboard_snapshot" }],
        evidence_card_count: 1,
        model_tier: "fast",
        model_used: "mock",
        model_provider: "mock",
        estimated_cost_usd: 0,
        cache_hit: false,
        degraded_mode: false,
        degradation_reason: null,
        schema_repair_attempts: 0,
        low_evidence: false,
        no_evidence: false,
        no_citation: false,
        retrieval_latency_ms: 1,
        embedding_latency_ms: 0,
        rerank_latency_ms: 0,
        generation_latency_ms: 1,
        validation_latency_ms: 1,
        budget_truncated: false,
        dropped_citation_count: 0,
        dropped_open_target_count: 0
      }
    }, 5);

    expect(result.passed).toBe(false);
    expect(result.checks.client_safety_correctness).toBe(false);
  });

  it("fails message false positives that create proposals", () => {
    const testCase: MessageEvalCase = {
      id: "fp",
      category: "false_positive",
      title: "False positive",
      setup: { projectFixture: "project_alpha", messages: ["mi_amb_maybe_reporting"] },
      expectations: { mustNotCreateProposal: true }
    };

    const result = scoreMessageCase(testCase, {
      insightType: "info",
      shouldCreateProposal: true,
      shouldCreateDecision: false,
      uncertainty: [],
      affectedDocumentSectionIds: [],
      affectedBrainNodeIds: [],
      proposalId: "proposal_1",
      decisionId: null
    });

    expect(result.passed).toBe(false);
    expect(result.checks.false_positive_resistance).toBe(false);
  });

  it("fails gates when category minimums are not met", () => {
    const report = applyGate(buildReport("socrates", []), { current_truth: 50 });
    expect(report.gate?.passed).toBe(false);
    expect(report.gate?.reasons.join(" ")).toContain("current_truth has 0 materialized Part 4 cases");
  });

  it("fails gates on duplicate materiality keys", () => {
    const result = {
      id: "a",
      materialityKey: "same",
      category: "current_truth",
      title: "A",
      passed: true,
      checks: {},
      reasons: [],
      observed: {
        expected_behavior: "test",
        latency_ms: 1,
        query: "q",
        citations: [],
        open_targets: [],
        dropped_citation_count: 0,
        dropped_open_target_count: 0,
        estimated_input_tokens: 1,
        estimated_output_tokens: 1,
        retrieval_domains: [],
        rerank_count: 0,
        final_evidence_count: 0,
        confidence: "low",
        limitations: []
      }
    };
    const report = applyGate(buildReport("socrates", [result, { ...result, id: "b" }]), { current_truth: 1 });
    expect(report.gate?.passed).toBe(false);
    expect(report.gate?.reasons.join(" ")).toContain("duplicate materiality");
  });

  it("fails Socrates source precedence violations", () => {
    const testCase: SocratesEvalCase = {
      id: "precedence",
      materialityKey: "precedence",
      category: "dashboard_status",
      title: "Dashboard precedence",
      setup: { projectFixture: "project_alpha" },
      session: { pageContext: "dashboard_project", selectedRefType: null, selectedRefId: null, viewerState: null, role: "manager" },
      query: "What needs attention?",
      expectedSourcePrecedence: ["dashboard_snapshot"],
      expectations: { requiredCitationTypes: ["dashboard_snapshot"] }
    };
    const result = scoreSocratesCase(testCase, {
      answer_md: "Dashboard status.",
      citations: [{ type: "product_brain", refId: "brain_1" }],
      open_targets: [],
      suggested_prompts: [],
      confidence: "high",
      limitations: [],
      debug: {
        intent: "dashboard_status",
        retrievalPlan: { primaryDomains: [], sourcePrecedence: [] },
        estimated_input_tokens: 100,
        estimated_output_tokens: 10,
        prompt_version: "test",
        evidence_cards: [{ sourceType: "product_brain" }],
        evidence_card_count: 1
      }
    }, 5);
    expect(result.passed).toBe(false);
    expect(result.checks.source_precedence_correctness).toBe(false);
  });

  it("fails Socrates cases when AI ops telemetry fields are missing", () => {
    const testCase: SocratesEvalCase = {
      id: "missing_ai_ops",
      materialityKey: "missing_ai_ops",
      category: "current_truth",
      title: "Missing AI ops",
      setup: { projectFixture: "project_alpha" },
      session: { pageContext: "brain_overview", selectedRefType: null, selectedRefId: null, viewerState: null, role: "manager" },
      query: "What is current?",
      expectations: {}
    };
    const result = scoreSocratesCase(testCase, {
      answer_md: "Current truth.",
      citations: [],
      open_targets: [],
      suggested_prompts: [],
      confidence: "low",
      limitations: [],
      debug: {
        intent: "current_truth",
        retrievalPlan: { primaryDomains: [], sourcePrecedence: [] },
        estimated_input_tokens: 100,
        prompt_version: "test",
        evidence_cards: []
      }
    }, 5);
    expect(result.passed).toBe(false);
    expect(result.checks.debug_metadata_present).toBe(false);
  });

  it("fails duplicate/supersession cases when reuse is not observed", () => {
    const testCase: MessageEvalCase = {
      id: "dup",
      materialityKey: "dup",
      category: "duplicate_supersession",
      title: "Duplicate",
      setup: { projectFixture: "project_alpha", messages: ["mi_req_assignment_change"] },
      expectedDuplicateBehavior: "same_body_reuses",
      expectations: { allowedInsightTypes: ["requirement_change"] }
    };
    const result = scoreMessageCase(testCase, {
      insightType: "requirement_change",
      shouldCreateProposal: true,
      shouldCreateDecision: false,
      uncertainty: [],
      affectedDocumentSectionIds: ["section_1"],
      affectedBrainNodeIds: ["node_1"],
      proposalId: "proposal_1",
      decisionId: null,
      duplicateBehavior: "created_duplicate"
    });
    expect(result.passed).toBe(false);
    expect(result.checks.duplicate_supersession_behavior).toBe(false);
  });

  it("fails message cases when classifier AI ops metadata is missing", () => {
    const testCase: MessageEvalCase = {
      id: "missing_message_ai_ops",
      materialityKey: "missing_message_ai_ops",
      category: "real_requirement_change",
      title: "Missing message AI ops",
      setup: { projectFixture: "project_alpha", messages: ["mi_req_assignment_change"] },
      expectations: { requireAffectedRefs: true }
    };
    const result = scoreMessageCase(testCase, {
      insightType: "requirement_change",
      shouldCreateProposal: true,
      shouldCreateDecision: false,
      uncertainty: [],
      affectedDocumentSectionIds: ["section_1"],
      affectedBrainNodeIds: ["node_1"],
      proposalId: "proposal_1",
      decisionId: null
    });
    expect(result.passed).toBe(false);
    expect(result.checks.ai_ops_metadata_present).toBe(false);
  });
});

function findFiles(root: string, fileName: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return findFiles(fullPath, fileName);
    return entry.isFile() && entry.name === fileName ? [fullPath] : [];
  });
}
