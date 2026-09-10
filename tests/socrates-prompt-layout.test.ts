import { describe, expect, it } from "vitest";
import { buildSocratesPrompt, buildStaticPromptPrefix, SOCRATES_PROMPT_VERSION } from "../src/modules/socrates/prompts.js";

describe("Socrates prompt layout", () => {
  it("puts static prefix before variable evidence and query", () => {
    const prompt = buildSocratesPrompt("What changed?", {
      projectId: "proj",
      pageContext: "brain_overview",
      intent: "current_truth",
      recentHistory: [],
      candidates: [],
      evidenceCards: [
        {
          evidenceId: "ev_1",
          sourceType: "product_brain",
          title: "Brain",
          excerpt: "Accepted reporting cadence is weekly.",
          whySelected: "accepted truth",
          confidence: 0.9,
          sourcePrecedence: "accepted_truth",
          citationRef: { type: "product_brain", id: "brain_1" },
          trace: { artifactVersionId: "brain_1" }
        }
      ],
      isClientContext: false
    });

    expect(prompt.indexOf("## Static system instructions")).toBeLessThan(prompt.indexOf("## Session context"));
    expect(prompt.indexOf("## Compressed evidence cards")).toBeLessThan(prompt.indexOf("## User question"));
    expect(prompt).toContain(SOCRATES_PROMPT_VERSION);
    expect(prompt).toContain("citationRef: product_brain / brain_1");
  });

  it("builds a deterministic static prefix", () => {
    expect(buildStaticPromptPrefix()).toBe(buildStaticPromptPrefix());
  });
});
