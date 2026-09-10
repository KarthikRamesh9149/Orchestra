import { describe, expect, it } from "vitest";
import { buildBetaEvidenceExcerpt, strengthenBetaAnswerWithEvidence } from "../src/modules/socrates/service.js";

describe("Socrates beta answer strengthening", () => {
  it("adds only source-supported beta grounding terms when the model is too terse", () => {
    const answer = strengthenBetaAnswerWithEvidence(
      {
        answer_md: "After disconnect, the backend must call revoke on the scoped connector token.",
        confidence: "high",
        limitations: []
      },
      "What should happen to connector tokens after disconnect?",
      "Security constraints: Expired or revoked tokens must be denied. Wrong-project access must be rejected."
    );

    expect(answer.answer_md).toContain("Expired or revoked tokens must be denied.");
  });

  it("does not add citations to low-confidence no-evidence answers", () => {
    const answer = strengthenBetaAnswerWithEvidence(
      {
        answer_md: "I don't have enough project memory.",
        confidence: "low",
        limitations: ["No pricing information in uploaded docs."]
      },
      "What is approved pricing?",
      "Project Memory supports uploaded document evidence."
    );

    expect(answer.answer_md).toBe("I don't have enough project memory.");
  });

  it("uses a query-focused evidence excerpt for later PRD sections", () => {
    const content = `${"Intro ".repeat(400)} Acceptance Criteria PDF and DOCX uploads become ready, Socrates cites evidence, and revoked VS Code tokens are denied. ${"Tail ".repeat(200)}`;

    const excerpt = buildBetaEvidenceExcerpt(content, "What acceptance criteria must pass before beta is ready?", 300);

    expect(excerpt).toContain("Acceptance Criteria");
    expect(excerpt).toContain("revoked VS Code tokens are denied");
    expect(excerpt.length).toBeLessThanOrEqual(306);
  });

  it("prefers the densest later PRD section over an early passing mention", () => {
    const content = `Problem Engineers search for acceptance criteria and non-goals. ${"Intro ".repeat(200)} Acceptance Criteria The beta is ready when PDF and DOCX uploads become ready, Socrates citations work, no-evidence questions abstain, and revoked VS Code tokens are denied.`;

    const excerpt = buildBetaEvidenceExcerpt(content, "What acceptance criteria must pass before this beta is ready?", 360);

    expect(excerpt).toContain("The beta is ready");
    expect(excerpt).toContain("no-evidence questions abstain");
  });
});
