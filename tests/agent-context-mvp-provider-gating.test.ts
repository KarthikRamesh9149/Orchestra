import { describe, expect, it, vi } from "vitest";
import { AgentContextPackService } from "../src/modules/agent-context/service.js";

describe("MVP Agent Context provider gating", () => {
  it("excludes hidden full-product providers by default even if MVP_MODE is unset or false", async () => {
    const service = new AgentContextPackService({} as any, { MVP_MODE: false } as any, {} as any, {} as any);
    (service as any).collectCandidates = vi.fn(async () => ({
      versions: {
        productBrainVersionId: null,
        liveDocVersionId: null,
        documentVersionId: null,
        artifactVersionId: null
      },
      state: {
        hasProductBrain: false,
        hasLiveDoc: false,
        hasDocuments: false,
        hasCodingRequirements: false,
        hasDiagrams: false,
        hasResponsibilities: false,
        hasManualContext: false,
        hasCommunicationEvidence: true
      },
      candidates: [
        {
          id: "manual-msg",
          sourceType: "communication_message",
          sourceRefType: "communication_message",
          sourceRefId: "manual-msg",
          relationship: "communication_evidence",
          title: "Manual import",
          excerpt: "Manual evidence",
          summary: null,
          whyItMatters: "Allowed provider",
          evidenceStatus: "communication_evidence",
          score: 50,
          citation: null,
          openTarget: null,
          confidence: 0.5,
          sortOrder: 0,
          provider: "manual_import",
          sourceDomain: "communication_messages",
          isCurrentTruth: false,
          isPending: false,
          visibility: "internal"
        },
        {
          id: "gmail-msg",
          sourceType: "communication_message",
          sourceRefType: "communication_message",
          sourceRefId: "gmail-msg",
          relationship: "communication_evidence",
          title: "Gmail message",
          excerpt: "Hidden provider evidence",
          summary: null,
          whyItMatters: "Disabled provider",
          evidenceStatus: "communication_evidence",
          score: 50,
          citation: null,
          openTarget: null,
          confidence: 0.5,
          sortOrder: 0,
          provider: "gmail",
          sourceDomain: "communication_messages",
          isCurrentTruth: false,
          isPending: false,
          visibility: "internal"
        }
      ]
    }));

    const built = await (service as any).buildPack("project-1", {
      taskPrompt: "Prepare a handoff",
      taskType: "handoff",
      sourceMode: "task_prompt",
      budgetPreset: "normal",
      visibility: "internal"
    });

    expect(built.sources.map((source: any) => source.provider)).toEqual(["manual_import"]);
    expect(JSON.stringify(built)).not.toContain("Hidden provider evidence");
    expect(built.warnings).toContain("Excluded disabled provider evidence from gmail.");
  });
});
