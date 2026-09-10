import { describe, expect, it } from "vitest";
import { buildSocratesAiTelemetry, redactAiTelemetry } from "../src/lib/ai-ops/ai-telemetry.js";

describe("AI ops telemetry", () => {
  it("builds required Socrates telemetry without raw prompt leakage", () => {
    const telemetry = buildSocratesAiTelemetry({
      requestId: "req-1",
      orgId: "org-1",
      projectId: "project-1",
      actorId: "user-1",
      actorRole: "manager",
      sessionId: "session-1",
      assistantMessageId: "assistant-1",
      intent: "current_truth",
      pageContext: "brain_overview",
      retrievalDomains: ["product_brain"],
      rawCandidateCount: 4,
      candidateCountByDomain: { product_brain: 2 },
      rerankedCandidateCount: 2,
      finalEvidenceCount: 2,
      finalEvidenceCountByDomain: { product_brain: 2 },
      finalEvidence: [{ id: "ev-1", type: "product_brain" }],
      citationsReturned: [{ type: "product_brain", refId: "brain-1" }],
      openTargetsReturned: [{ targetType: "brain_node" }],
      droppedCitations: [{ type: "message", refId: "msg-1", reason: "client_unsafe" }],
      droppedOpenTargets: [],
      tokenUsage: { input: 100, output: 20, evidence: 40, history: 5, total: 125 },
      cache: { hit: false, namespace: "none", safetyClass: "no_cache" },
      model: { provider: "mock", model: "fast-model", tier: "fast", strategy: "auto" },
      rerank: { provider: "none", count: 0, latencyMs: 0 },
      latency: { totalMs: 10, retrievalMs: 2, embeddingMs: 1, rerankMs: 0, promptBuildMs: 1, generationMs: 3, validationMs: 1 },
      cost: { totalCostUsd: 0.001 },
      degraded: false,
      schemaRepairAttemptCount: 0,
      failedAnswerSchema: false,
      lowEvidence: false,
      noCitation: false,
      roleSafetyFilterCount: 1,
      budgetTruncated: false,
      selectedEvidencePreserved: true
    });

    expect(telemetry.telemetrySchemaVersion).toBe(1);
    expect(JSON.stringify(telemetry)).not.toContain("raw prompt");
    expect(telemetry.droppedCitationCount).toBe(1);
  });

  it("redacts sensitive nested fields", () => {
    const redacted = redactAiTelemetry({
      apiKey: "secret",
      prompt: "private prompt",
      nested: { providerPermalink: "https://internal", messageBody: "private message" }
    });

    expect(JSON.stringify(redacted)).not.toContain("private prompt");
    expect(JSON.stringify(redacted)).not.toContain("private message");
    expect(JSON.stringify(redacted)).toContain("[REDACTED]");
  });

  it("preserves safe token and cost accounting fields while redacting credentials", () => {
    const redacted = redactAiTelemetry({
      tokenUsage: { input: 100, output: 20, evidence: 40, history: 5, total: 165 },
      promptTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.0012,
      latency: { promptBuildMs: 12, generationMs: 8 },
      accessToken: "provider-secret-token",
      refresh_token: "provider-refresh-token"
    });

    expect(redacted).toMatchObject({
      tokenUsage: { input: 100, output: 20, evidence: 40, history: 5, total: 165 },
      promptTokens: 100,
      outputTokens: 20,
      estimatedCostUsd: 0.0012,
      latency: { promptBuildMs: 12, generationMs: 8 },
      accessToken: "[REDACTED]",
      refresh_token: "[REDACTED]"
    });
  });

  it("redacts internal identifiers in client-safe telemetry", () => {
    const redacted = redactAiTelemetry({
      actorId: "user-internal",
      citationsReturned: [{ type: "message", messageId: "msg-internal", threadId: "thread-internal" }],
      openTargetsReturned: [{ targetType: "change_proposal", proposalId: "proposal-internal" }],
      overlay: {
        sourceMessageId: "source-message-internal",
        linkedThreadIds: ["linked-thread-internal"],
        changeProposalId: "change-proposal-internal",
        providerMessageRef: "provider-ref-internal"
      }
    }, { clientSafe: true });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("user-internal");
    expect(serialized).not.toContain("msg-internal");
    expect(serialized).not.toContain("thread-internal");
    expect(serialized).not.toContain("proposal-internal");
    expect(serialized).not.toContain("source-message-internal");
    expect(serialized).not.toContain("linked-thread-internal");
    expect(serialized).not.toContain("change-proposal-internal");
    expect(serialized).not.toContain("provider-ref-internal");
  });
});
