import type { EvalSuiteReport } from "./types.js";

export function applyGate(report: EvalSuiteReport, minimums: Record<string, number>) {
  const reasons: string[] = [];
  const totalMinimum = Object.values(minimums).reduce((sum, value) => sum + value, 0);
  if (report.summary.total < totalMinimum) {
    reasons.push(`suite has ${report.summary.total} cases; total minimum is ${totalMinimum}`);
  }
  for (const [category, minimum] of Object.entries(minimums)) {
    if (minimum === 0) continue;
    const actual = report.results.filter((result) => result.category === category && isMaterializedPart4Case(result)).length;
    if (actual < minimum) {
      reasons.push(`${category} has ${actual} materialized Part 4 cases; minimum is ${minimum}`);
    }
  }
  if (report.summary.failed > 0) {
    reasons.push(`${report.summary.failed} mandatory eval case(s) failed`);
  }
  if ((report.summary.clientSafetyFailures ?? 0) > 0) {
    reasons.push(`${report.summary.clientSafetyFailures} client-safety failure(s)`);
  }
  if ((report.summary.falsePositiveFailures ?? 0) > 0) {
    reasons.push(`${report.summary.falsePositiveFailures} false-positive failure(s)`);
  }
  if ((report.summary.invalidRefFailures ?? 0) > 0) {
    reasons.push(`${report.summary.invalidRefFailures} invalid-ref failure(s)`);
  }
  const targetCategories = new Set(Object.entries(minimums).filter(([, minimum]) => minimum > 0).map(([category]) => category));
  const missingMateriality = report.results.filter((result) => targetCategories.has(result.category) && isMaterializedPart4Case(result) && !result.materialityKey);
  if (missingMateriality.length > 0) {
    reasons.push(`${missingMateriality.length} target-count case(s) are missing materialityKey`);
  }
  const materialityCounts = new Map<string, number>();
  for (const result of report.results) {
    if (!targetCategories.has(result.category) || !isMaterializedPart4Case(result) || !result.materialityKey) continue;
    const key = `${result.category}:${result.materialityKey}`;
    materialityCounts.set(key, (materialityCounts.get(key) ?? 0) + 1);
  }
  const duplicateMateriality = Array.from(materialityCounts.entries()).filter(([, count]) => count > 1);
  if (duplicateMateriality.length > 0) {
    reasons.push(`${duplicateMateriality.length} duplicate materiality key(s) found`);
  }
  const missingReportFields = report.results.filter((result) => missingRequiredObservedFields(report.suite, result).length > 0);
  if (missingReportFields.length > 0) {
    reasons.push(`${missingReportFields.length} case report(s) are missing required observed fields`);
  }
  report.gate = {
    passed: reasons.length === 0,
    reasons,
    minimums
  };
  return report;
}

function isMaterializedPart4Case(result: EvalSuiteReport["results"][number]) {
  const tags = Array.isArray(result.observed.tags) ? result.observed.tags : [];
  return Boolean(result.materialityKey) || tags.includes("materialized") || tags.includes("part4");
}

function missingRequiredObservedFields(suite: EvalSuiteReport["suite"], result: EvalSuiteReport["results"][number]) {
  const common = ["expected_behavior", "latency_ms"];
  const socrates = [
    "query",
    "citations",
    "open_targets",
    "dropped_citation_count",
    "dropped_open_target_count",
    "estimated_input_tokens",
    "estimated_output_tokens",
    "retrieval_domains",
    "rerank_count",
    "final_evidence_count",
    "confidence",
    "limitations",
    "model_tier",
    "model_used",
    "model_provider",
    "estimated_cost_usd",
    "cache_hit",
    "degraded_mode",
    "degradation_reason",
    "schema_repair_attempts",
    "low_evidence",
    "no_evidence",
    "no_citation",
    "retrieval_latency_ms",
    "embedding_latency_ms",
    "rerank_latency_ms",
    "generation_latency_ms",
    "validation_latency_ms",
    "budget_truncated",
    "dropped_citation_count",
    "dropped_open_target_count"
  ];
  const messages = [
    "provider",
    "message_or_thread_input",
    "proposalId",
    "decisionId",
    "affectedDocumentSectionIds",
    "affectedBrainNodeIds",
    "classifier_model",
    "model_tier",
    "estimated_input_tokens",
    "estimated_output_tokens",
    "estimated_cost_usd",
    "schema_repair_attempts",
    "invalid_affected_refs_dropped",
    "truth_policy_backend_decision",
    "classifier_fallback_used"
  ];
  const required = suite === "socrates" ? [...common, ...socrates] : suite === "message_intelligence" ? [...common, ...messages] : common;
  return required.filter((field) => !(field in result.observed));
}
