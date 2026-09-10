import { describe, expect, it } from "vitest";
import { buildEvidenceOnlyDegradedAnswer } from "../src/lib/ai-ops/ai-degradation.js";

describe("AI degradation", () => {
  it("returns evidence-only degraded answer with validated citations", () => {
    const answer = buildEvidenceOnlyDegradedAnswer({
      reason: "generation_provider_failed",
      citations: [{ type: "document_chunk", refId: "chunk-1", label: "Source", confidence: 0.8 }],
      openTargets: [{ targetType: "document_section", targetRef: { anchorId: "a1" } }]
    });

    expect(answer.confidence).toBe("low");
    expect(answer.answer_md).toContain("generated answer is unavailable");
    expect(answer.citations).toHaveLength(1);
    expect(answer.open_targets).toHaveLength(1);
    expect(answer.limitations.join(" ")).toContain("generation_provider_failed");
  });
});
