import { describe, expect, it, vi } from "vitest";
import { finalizeSocratesAnswer, buildLowEvidenceAnswer } from "../src/modules/socrates/answer-finalizer.js";
import type { EvidenceCard } from "../src/lib/retrieval/evidence-pack.js";

const evidenceCard: EvidenceCard = {
  evidenceId: "ev_1",
  sourceType: "document_section",
  title: "Reporting requirements",
  excerpt: "Reporting should be weekly.",
  whySelected: "Direct source evidence",
  confidence: 0.92,
  sourcePrecedence: "source_evidence",
  citationRef: {
    type: "document_section",
    id: "11111111-1111-1111-1111-111111111111",
    label: "Backend derived label",
  },
  openTarget: {
    targetType: "document_section",
    targetRef: {
      anchorId: "reporting",
      documentVersionId: "22222222-2222-2222-2222-222222222222",
    },
  },
  trace: {
    documentSectionId: "11111111-1111-1111-1111-111111111111",
  },
};

describe("finalizeSocratesAnswer", () => {
  it("repairs malformed model output once before degrading", async () => {
    const repair = vi.fn().mockResolvedValue({
      answer_md: "Weekly reporting is the accepted requirement.",
      citations: [
        {
          type: "document_section",
          refId: "11111111-1111-1111-1111-111111111111",
          label: "Model label",
        },
      ],
      open_targets: [],
      suggested_prompts: ["Show source evidence"],
      suggested_actions: [],
      confidence: "high",
      limitations: [],
    });

    const result = await finalizeSocratesAnswer({
      rawText: "{not json",
      evidenceCards: [evidenceCard],
      repair,
    });

    expect(repair).toHaveBeenCalledTimes(1);
    expect(result.answer.confidence).toBe("high");
    expect(result.degraded).toBe(false);
  });

  it("returns a safe degraded answer when repair also fails", async () => {
    const result = await finalizeSocratesAnswer({
      rawText: "{not json",
      evidenceCards: [evidenceCard],
      repair: vi.fn().mockResolvedValue({ invalid: true }),
    });

    expect(result.answer.answer_md).toContain("I could not produce a fully valid structured answer");
    expect(result.answer.confidence).toBe("low");
    expect(result.answer.limitations).toContain("The generated answer failed schema validation.");
    expect(result.answer.citations).toHaveLength(1);
    expect(result.degraded).toBe(true);
  });
});

describe("buildLowEvidenceAnswer", () => {
  it("returns the required insufficiency sentence with closest validated evidence", () => {
    const answer = buildLowEvidenceAnswer([evidenceCard], [
      "No directly matching accepted change or source message was found.",
    ]);

    expect(answer.answer_md).toContain("I could not find enough project evidence to answer this confidently.");
    expect(answer.confidence).toBe("low");
    expect(answer.citations).toHaveLength(1);
    expect(answer.open_targets).toHaveLength(1);
    expect(answer.suggested_actions).toEqual([]);
    expect(answer.limitations[0]).toContain("No directly matching");
  });
});
