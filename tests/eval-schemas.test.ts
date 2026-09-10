import { describe, expect, it } from "vitest";
import { goldenMessageCaseFiles, goldenSocratesCaseFiles, loadGoldenProjectFixtures } from "../evals/helpers/case-bank.js";
import { loadValidatedJsonlFile } from "../evals/helpers/io.js";
import { socratesEvalCaseSchema, messageEvalCaseSchema } from "../evals/helpers/schemas.js";

describe("Part 4 eval schemas", () => {
  it("rejects unknown Socrates case fields", () => {
    const result = socratesEvalCaseSchema.safeParse({
      id: "bad",
      title: "Bad case",
      category: "current_truth",
      setup: { projectFixture: "project_alpha" },
      session: { pageContext: "brain_overview", selectedRefType: null, selectedRefId: null, viewerState: null, role: "manager" },
      query: "What is current?",
      expectations: {},
      unsupported: true
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid message-intelligence categories", () => {
    const result = messageEvalCaseSchema.safeParse({
      id: "bad",
      title: "Bad message case",
      category: "generic_summary",
      setup: { projectFixture: "project_alpha", messages: ["mi_info_status_update"] },
      expectations: {}
    });

    expect(result.success).toBe(false);
  });

  it("accepts ClickUp provider evidence eval cases", () => {
    const result = messageEvalCaseSchema.safeParse({
      id: "clickup-case",
      title: "ClickUp acceptance",
      category: "proposal_generation",
      provider: "clickup",
      setup: { projectFixture: "project_alpha", messages: ["mi_clickup_acceptance_reporting"] },
      messageIdRef: "mi_clickup_acceptance_reporting",
      expectations: { allowedInsightTypes: ["approval"], mustCreateProposal: true, provider: "clickup" }
    });

    expect(result.success).toBe(true);
  });

  it("loads the five golden customer fixtures", async () => {
    const fixtures = await loadGoldenProjectFixtures();
    expect(fixtures.map((fixture) => fixture.id).sort()).toEqual([
      "ai_chatbot_product",
      "fintech_onboarding_app",
      "logistics_dispatch_app",
      "marketplace_mvp",
      "saas_admin_dashboard"
    ]);
  });

  it("loads materialized golden eval cases from fixture files", async () => {
    const fixtures = await loadGoldenProjectFixtures();
    const socrates = (await Promise.all(goldenSocratesCaseFiles(fixtures).map((file) => loadValidatedJsonlFile(file, socratesEvalCaseSchema)))).flat();
    const messages = (await Promise.all(goldenMessageCaseFiles(fixtures).map((file) => loadValidatedJsonlFile(file, messageEvalCaseSchema)))).flat();

    expect(socrates).toHaveLength(220);
    expect(messages).toHaveLength(220);
    expect(socrates.every((testCase) => testCase.materialityKey)).toBe(true);
    expect(messages.every((testCase) => testCase.materialityKey)).toBe(true);
  });
});
