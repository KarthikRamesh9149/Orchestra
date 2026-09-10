import { describe, expect, it } from "vitest";
import {
  createAgentContextPackSchema,
  createAgentRunSchema,
  reviewAgentRunSchema,
  updateAgentRunSchema,
  updateAgentRunStatusSchema
} from "../src/modules/agent-context/schemas.js";
import { composeAgentContextPackSections } from "../src/modules/agent-context/composer.js";
import { estimateAgentContextTokens } from "../src/modules/agent-context/token-estimator.js";
import { filterAgentContextEvidenceForMvp, rankAgentContextSources } from "../src/modules/agent-context/source-selection.js";
import { redactAgentContextText, validateAgentContextOpenTarget } from "../src/modules/agent-context/citations.js";
import type { AgentContextEvidenceCandidate } from "../src/modules/agent-context/types.js";

const baseCandidate = {
  id: "ev-1",
  sourceType: "product_brain",
  sourceRefType: "product_brain",
  sourceRefId: "brain-1",
  relationship: "current_truth",
  title: "Product Brain v3",
  excerpt: "Accepted KYC onboarding flow must happen before payment setup.",
  summary: "KYC before payments",
  whyItMatters: "This is accepted current truth.",
  citation: { type: "product_brain", id: "brain-1", label: "Product Brain v3" },
  openTarget: { targetType: "brain_node", targetRef: { brainNodeId: "node-1" } },
  evidenceStatus: "current_accepted_truth",
  confidence: 0.92,
  sortOrder: 0,
  provider: null,
  sourceDomain: "product_brain",
  score: 10,
  isCurrentTruth: true,
  isPending: false
} satisfies AgentContextEvidenceCandidate;

describe("Agent Context Pack foundation", () => {
  it("validates the create request contract and rejects unsafe task prompts", () => {
    const parsed = createAgentContextPackSchema.parse({
      taskPrompt: "Implement KYC onboarding",
      taskType: "implementation",
      sourceMode: "product_brain_node",
      seedReference: { type: "brain_node", id: "11111111-1111-4111-8111-111111111111" },
      targetAgent: { kind: "codex", name: "Codex" },
      budgetPreset: "normal",
      visibility: "internal"
    });

    expect(parsed.taskType).toBe("implementation");
    expect(parsed.sourceMode).toBe("product_brain_node");
    expect(() =>
      createAgentContextPackSchema.parse({
        taskPrompt: "<script>alert(1)</script>",
        taskType: "implementation",
        sourceMode: "task_prompt"
      })
    ).toThrow();
    expect(() =>
      createAgentContextPackSchema.parse({
        taskPrompt: "Use ghp_123456789012345678901234567890123456 in the export",
        taskType: "implementation",
        sourceMode: "task_prompt"
      })
    ).toThrow();
    expect(() =>
      createAgentContextPackSchema.parse({
        taskPrompt: "Use mcp_abcdefghijklmnopqrstuvwxyz123456 in the export",
        taskType: "implementation",
        sourceMode: "task_prompt"
      })
    ).toThrow();
  });

  it("keeps pending suggestions out of current accepted truth while preserving them as limitations", () => {
    const sections = composeAgentContextPackSections({
      title: "KYC implementation pack",
      taskPrompt: "Implement KYC onboarding",
      taskType: "implementation",
      candidates: [
        baseCandidate,
        {
          ...baseCandidate,
          id: "ev-2",
          sourceType: "change_proposal",
          sourceRefType: "change_proposal",
          sourceRefId: "proposal-1",
          relationship: "review_pressure",
          title: "Pending payment shortcut",
          excerpt: "Skip KYC for low-risk users.",
          evidenceStatus: "pending_suggestion",
          isCurrentTruth: false,
          isPending: true,
          score: 8
        }
      ],
      limitations: ["Pending suggestions were included only as review pressure, not current truth."],
      warnings: [],
      budgetPreset: "normal"
    });

    expect(sections.currentAcceptedTruth.items.join("\n")).toContain("KYC onboarding");
    expect(sections.currentAcceptedTruth.items.join("\n")).not.toContain("Skip KYC");
    expect(sections.limitations.items.join("\n")).toContain("Pending suggestions");
  });

  it("excludes disabled full-product providers in MVP mode", () => {
    const filtered = filterAgentContextEvidenceForMvp(
      [
        { ...baseCandidate, id: "manual", provider: "manual_import", sourceDomain: "communication_messages" },
        { ...baseCandidate, id: "fireflies", provider: "fireflies_ai", sourceDomain: "communication_messages" },
        { ...baseCandidate, id: "slack", provider: "slack", sourceDomain: "communication_messages" }
      ],
      { mvpMode: true, enabledProviders: ["manual_import", "fireflies_ai"] }
    );

    expect(filtered.allowed.map((item) => item.id)).toEqual(["manual", "fireflies"]);
    expect(filtered.excluded.map((item) => item.provider)).toEqual(["slack"]);
  });

  it("uses the MVP default provider profile for Granola and Teams evidence when no override is supplied", () => {
    const filtered = filterAgentContextEvidenceForMvp(
      [
        { ...baseCandidate, id: "granola", provider: "granola", sourceDomain: "communication_messages" },
        { ...baseCandidate, id: "teams", provider: "microsoft_teams", sourceDomain: "communication_messages" },
        { ...baseCandidate, id: "gmail", provider: "gmail", sourceDomain: "communication_messages" }
      ],
      { mvpMode: true, enabledProviders: [] }
    );

    expect(filtered.allowed.map((item) => item.id)).toEqual(["granola", "teams"]);
    expect(filtered.excluded.map((item) => item.provider)).toEqual(["gmail"]);
  });

  it("ranks current truth first, dedupes sources, and estimates tokens approximately", () => {
    const ranked = rankAgentContextSources(
      [
        { ...baseCandidate, id: "old-doc", sourceRefType: "document_section", sourceRefId: "same", evidenceStatus: "original_source", score: 1, isCurrentTruth: false },
        { ...baseCandidate, id: "truth", sourceRefType: "product_brain", sourceRefId: "truth", evidenceStatus: "current_accepted_truth", score: 2, isCurrentTruth: true },
        { ...baseCandidate, id: "old-doc-duplicate", sourceRefType: "document_section", sourceRefId: "same", evidenceStatus: "original_source", score: 9, isCurrentTruth: false }
      ],
      { budgetPreset: "compact", seedReference: { type: "product_brain", id: "truth" } }
    );

    expect(ranked.map((item) => item.id)).toEqual(["truth", "old-doc-duplicate"]);
    expect(estimateAgentContextTokens("abcd ".repeat(20))).toMatchObject({
      method: "chars_div_4",
      estimate: expect.any(Number)
    });
  });

  it("rejects unsafe open targets", () => {
    expect(
      validateAgentContextOpenTarget({
        targetType: "communication_message",
        targetRef: { messageId: "msg-1", providerUrl: "https://app.fireflies.ai/view/demo" }
      })
    ).toMatchObject({ valid: false });
    expect(
      validateAgentContextOpenTarget({
        targetType: "document_section",
        targetRef: { documentSectionId: "section-1" }
      })
    ).toMatchObject({ valid: true });
  });

  it("validates Agent Run Memory lifecycle input without allowing direct truth mutation", () => {
    const parsed = createAgentRunSchema.parse({
      contextPackId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetAgent: { kind: "codex", name: "Codex" },
      provider: "codex",
      taskTitle: "Implement auth routes",
      taskType: "implementation",
      promptSource: "context_pack",
      outputSummary: "Codex says it changed auth routing.",
      filesChanged: ["src/modules/auth/routes.ts"],
      modulesTouched: ["auth"],
      testsRun: ["npm test -- auth"],
      risksFound: ["Agent output is an unverified implementation claim until reviewed."],
      possibleProductBrainImplications: true,
      productBrainImplications: ["Auth handoff may need a Product Brain follow-up."]
    });

    expect(parsed.status).toBe("planned");
    expect(parsed.promptSource).toBe("context_pack");
    expect(parsed.possibleProductBrainImplications).toBe(true);
    expect(updateAgentRunSchema.safeParse({ status: "accepted" }).success).toBe(false);
    expect(() => updateAgentRunStatusSchema.parse({ status: "accepted" })).toThrow();
    expect(() => reviewAgentRunSchema.parse({ reviewResult: "accepted", humanReviewNotes: "Useful implementation evidence." })).not.toThrow();
  });

  it("redacts secret-like content in agent-run text fields", () => {
    expect(redactAgentContextText("xoxb-testsecretvalue123456")).toContain("[redacted]");
    expect(redactAgentContextText("ghp_abcdefghijklmnopqrstuvwxyz123456")).toContain("[redacted]");
    expect(redactAgentContextText("mcp_abcdefghijklmnopqrstuvwxyz123456")).toContain("[redacted]");
    expect(redactAgentContextText("AKIA1234567890ABCDEF")).toContain("[redacted]");
    expect(redactAgentContextText("postgresql://user:pass@example.supabase.co:5432/postgres")).toContain("[redacted]");
    expect(redactAgentContextText("-----BEGIN PRIVATE KEY-----")).toContain("[redacted]");
  });
});
