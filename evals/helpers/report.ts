import type { EvalCaseResult, EvalSuiteReport } from "./types.js";

export function buildReport(suite: EvalSuiteReport["suite"], results: EvalCaseResult[]): EvalSuiteReport {
  const byCategory: EvalSuiteReport["summary"]["byCategory"] = {};
  const byFixture: NonNullable<EvalSuiteReport["summary"]["byFixture"]> = {};
  const reasonCounts = new Map<string, number>();
  for (const result of results) {
    byCategory[result.category] ??= { total: 0, passed: 0, failed: 0 };
    byCategory[result.category].total += 1;
    if (result.passed) {
      byCategory[result.category].passed += 1;
    } else {
      byCategory[result.category].failed += 1;
    }
    const fixture = result.fixture ?? "default";
    byFixture[fixture] ??= { total: 0, passed: 0, failed: 0 };
    byFixture[fixture].total += 1;
    if (result.passed) byFixture[fixture].passed += 1;
    else byFixture[fixture].failed += 1;
    for (const reason of result.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const latencies = results.map((result) => result.durationMs ?? Number(result.observed.latency_ms ?? 0)).filter((value) => value > 0).sort((a, b) => a - b);
  const estimatedInputTokens = results.map((result) => Number(result.observed.estimated_input_tokens ?? 0)).filter((value) => value > 0);
  const estimatedOutputTokens = results.map((result) => Number(result.observed.estimated_output_tokens ?? 0)).filter((value) => value > 0);
  const estimatedCosts = results.map((result) => Number(result.observed.estimated_cost_usd ?? 0)).filter((value) => value >= 0);
  const schemaRepairs = results.reduce((sum, result) => sum + Number(result.observed.schema_repair_attempts ?? 0), 0);
  return {
    suite,
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length === 0 ? 0 : passed / results.length,
      byCategory,
      byFixture,
      topFailureReasons: Array.from(reasonCounts.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
      averageLatencyMs: average(latencies),
      p95LatencyMs: percentile(latencies, 0.95),
      averageEstimatedInputTokens: average(estimatedInputTokens),
      averageEstimatedOutputTokens: average(estimatedOutputTokens),
      totalEstimatedCostUsd: estimatedCosts.reduce((sum, value) => sum + value, 0),
      averageEstimatedCostUsd: average(estimatedCosts),
      degradedCount: results.filter((result) => result.observed.degraded_mode === true || result.observed.classifier_fallback_used === true).length,
      schemaRepairCount: schemaRepairs,
      lowEvidenceCount: results.filter((result) => result.observed.low_evidence === true).length,
      noEvidenceCount: results.filter((result) => result.observed.no_evidence === true).length,
      budgetTruncatedCount: results.filter((result) => result.observed.budget_truncated === true).length,
      droppedCitationCount: results.reduce((sum, result) => sum + Number(result.observed.dropped_citation_count ?? 0), 0),
      droppedOpenTargetCount: results.reduce((sum, result) => sum + Number(result.observed.dropped_open_target_count ?? 0), 0),
      clientSafetyFailures: results.filter((result) => result.checks.client_safety_correctness === false || result.checks.role_safety_pass === false).length,
      falsePositiveFailures: results.filter((result) => result.checks.false_positive_resistance === false || result.checks.false_positive_guard_pass === false).length,
      invalidRefFailures: results.filter((result) => result.checks.invalid_ref_handling === false || result.checks.affected_refs_pass === false).length
    },
    results
  };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index] ?? 0;
}
