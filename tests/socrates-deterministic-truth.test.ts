import { describe, expect, it } from "vitest";
import { SocratesService } from "../src/modules/socrates/service.js";
import type { EvidenceCard } from "../src/lib/retrieval/evidence-pack.js";

const service = new SocratesService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any) as any;

function card(sourceType: string, excerpt: string): EvidenceCard {
  return {
    evidenceId: `ev-${sourceType}`,
    sourceType,
    title: sourceType,
    excerpt,
    whySelected: "test",
    confidence: 0.82,
    sourcePrecedence: sourceType === "communication_message" ? "communication_evidence" : "accepted_truth",
    citationRef: { type: sourceType === "communication_message" ? "message" : "product_brain", id: "11111111-1111-1111-1111-111111111111" },
    trace: {}
  };
}

describe("Socrates deterministic current-truth wording", () => {
  it("does not label unaccepted communication evidence as current accepted understanding", () => {
    const answer = service.buildDeterministicEvalAnswerFromCards("What is current truth from the meeting?", "current_truth", [
      card("communication_message", "Sarah said weekly reporting sounded useful in the meeting.")
    ]);

    expect(answer.answer_md).toContain("Unaccepted source evidence, not current Product Brain truth:");
    expect(answer.answer_md).not.toContain("Current accepted understanding:");
  });

  it("keeps accepted truth wording when accepted Product Brain evidence is present", () => {
    const answer = service.buildDeterministicEvalAnswerFromCards("What is current truth?", "current_truth", [
      card("product_brain", "Managers get weekly exception reports.")
    ]);

    expect(answer.answer_md).toContain("Current accepted understanding:");
  });

  it("suppresses semantically duplicate evidence with different projection ids", () => {
    const evidence = [
      {
        evidenceId: "communication:projection-1",
        sourceType: "communication_message",
        sourceSubType: "fireflies_ai",
        title: "Weekly product review",
        text: "Ship the approved launch scope.",
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
        author: "Karthik",
        truthStatus: "evidence",
        confidence: 0.9,
        citation: { id: "message-1", type: "message", label: "Weekly product review" },
        openTarget: null,
        metadataSummary: null
      },
      {
        evidenceId: "communication:projection-2",
        sourceType: "communication_message",
        sourceSubType: "fireflies_ai",
        title: " weekly  PRODUCT review ",
        text: "  ship the approved launch scope.  ",
        createdAt: new Date("2026-08-20T00:01:00.000Z"),
        author: "Karthik",
        truthStatus: "evidence",
        confidence: 0.89,
        citation: { id: "message-2", type: "message", label: "Weekly product review" },
        openTarget: null,
        metadataSummary: null
      }
    ];

    expect(service.dedupeSocratesV1Evidence(evidence)).toHaveLength(1);
  });
});
