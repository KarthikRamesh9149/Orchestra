import { describe, expect, it } from "vitest";
import { classifyIntent } from "../src/lib/retrieval/intent.js";

describe("classifyIntent", () => {
  it("classifies provenance queries as original_source", () => {
    expect(classifyIntent("Where was this feature first mentioned?")).toBe("original_source");
    expect(classifyIntent("What did the original PRD say about reporting?")).toBe("original_source");
    expect(classifyIntent("Which Slack message introduced this requirement?")).toBe("original_source");
    expect(classifyIntent("Which ClickUp task introduced the dashboard change?")).toBe("original_source");
  });

  it("classifies change queries as change_history", () => {
    expect(classifyIntent("What changed recently?")).toBe("change_history");
    expect(classifyIntent("Show me the change history for this feature")).toBe("change_history");
    expect(classifyIntent("List all accepted changes this week")).toBe("change_history");
  });

  it("classifies decision queries as decision_history", () => {
    expect(classifyIntent("Was this decided by the manager?")).toBe("decision_history");
    expect(classifyIntent("Show decision records for auth")).toBe("decision_history");
    expect(classifyIntent("Why was this approach chosen?")).toBe("decision_history");
  });

  it("classifies current-state queries as current_truth", () => {
    expect(classifyIntent("What is the current requirement for login?")).toBe("current_truth");
    expect(classifyIntent("What are the accepted flows?")).toBe("current_truth");
    expect(classifyIntent("What should engineering follow now?")).toBe("current_truth");
  });

  it("classifies dashboard queries as dashboard_status", () => {
    expect(classifyIntent("Summarize project status")).toBe("dashboard_status");
    expect(classifyIntent("Show workload pressure")).toBe("dashboard_status");
    expect(classifyIntent("What projects need attention?")).toBe("dashboard_status");
  });

  it("classifies responsibility ownership and blocked-task questions", () => {
    expect(classifyIntent("Who owns frontend?")).toBe("team_responsibility");
    expect(classifyIntent("What is Sara working on?")).toBe("team_responsibility");
    expect(classifyIntent("Which tasks are blocked?")).toBe("team_responsibility");
  });

  it("classifies manually added notes, decisions, transcripts, and captions as manual_context", () => {
    expect(classifyIntent("What did we manually record about onboarding?")).toBe("manual_context");
    expect(classifyIntent("What decisions have we added manually?")).toBe("manual_context");
    expect(classifyIntent("Who said the KYC decision?")).toBe("manual_context");
    expect(classifyIntent("What manual transcript mentioned authentication?")).toBe("manual_context");
    expect(classifyIntent("Show chart caption context about onboarding")).toBe("manual_context");
  });

  it("classifies comparison queries as comparison_or_diff", () => {
    expect(classifyIntent("Compare the original and current requirement")).toBe("comparison_or_diff");
    expect(classifyIntent("Compare original PRD vs current truth")).toBe("comparison_or_diff");
    expect(classifyIntent("What is different between version 1 and version 2?")).toBe("comparison_or_diff");
  });

  it("classifies brain structure queries as brain_local", () => {
    expect(classifyIntent("What does this module depend on?")).toBe("brain_local");
    expect(classifyIntent("What depends on this node?")).toBe("brain_local");
    expect(classifyIntent("Show the brain graph structure")).toBe("brain_local");
  });

  it("classifies persisted Mermaid diagram questions as diagram_lookup", () => {
    expect(classifyIntent("Show me the onboarding flow diagram")).toBe("diagram_lookup");
    expect(classifyIntent("What diagrams exist for backend architecture?")).toBe("diagram_lookup");
    expect(classifyIntent("Generate a Mermaid flowchart for this feature")).toBe("diagram_lookup");
  });

  it("classifies communication queries as communication_lookup", () => {
    expect(classifyIntent("Find the Slack message from last week")).toBe("communication_lookup");
    expect(classifyIntent("Which ClickUp comments mention this blocker?")).toBe("communication_lookup");
    expect(classifyIntent("What task status update mentioned auth?")).toBe("communication_lookup");
    expect(classifyIntent("What did someone say in the Gmail thread?")).toBe("communication_lookup");
  });

  it("classifies local document and role explanation questions", () => {
    expect(classifyIntent("What does this section mean?")).toBe("doc_local");
    expect(classifyIntent("Explain this for engineering")).toBe("explain_for_role");
    expect(classifyIntent("Explain this for the client")).toBe("explain_for_role");
  });

  it("falls back to current_truth for generic questions", () => {
    expect(classifyIntent("Hello what is going on")).toBe("current_truth");
  });
});
