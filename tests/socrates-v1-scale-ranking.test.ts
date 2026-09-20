import { describe, expect, it } from "vitest";
import { SocratesService } from "../src/modules/socrates/service.js";

// Exercise the actual downstream rank/citation/fallback functions without a
// database or generation provider. Upstream order is the real SQL/coverage order.
function service() {
  const instance = Object.create(SocratesService.prototype) as any;
  instance.env = { SOCRATES_MAX_CITATIONS: 6 };
  return instance;
}
function evidence(id: string, text: string, day: number, sourceType = "document") {
  return {
    evidenceId: id, documentId: id, sourceType, sourceSubType: null,
    title: `Operating memo ${id}`, text, createdAt: new Date(Date.UTC(2020, 0, 1) + day * 86400000),
    author: null, truthStatus: "evidence", confidence: 0.9, metadataSummary: null,
    citation: { id, type: "document_chunk", label: `Operating memo ${id}` }, openTarget: null
  };
}
const question = "Compare project records for Nimbuscopper acceptance desk, Pinequartz rollout threshold and Copperharbor dispatch path. Cite each source.";
function eightRankedDocuments() {
  const boilerplate = "For dispatch handover, teams compare records and checks. ".repeat(80);
  return [
    evidence("pine", "Pinequartz rollout threshold: 73 receipts. Teams compare records for review and signoff.", 210),
    evidence("nimbus", "Nimbuscopper acceptance desk: Asha Vale, 47 minutes. Teams compare records for review and signoff.", 3),
    evidence("copper", "Copperharbor dispatch path: ledger route is dock-seven. Teams compare observations for accuracy and handover.", 490),
    evidence("silver", boilerplate, 620),
    ...[999, 983, 967, 951].map(day => evidence(`generic-${day}`, boilerplate, day))
  ];
}

describe("Socrates v1 scale ranking", () => {
  it("keeps an older third-ranked relevant document inside citation and fallback caps when generic newer documents tie", () => {
    const instance = service();
    const ranked = instance.rankSocratesV1Evidence(eightRankedDocuments(), question, "general_question");
    expect(ranked.slice(0, 3).map((item: any) => item.evidenceId)).toEqual(["pine", "nimbus", "copper"]);
    expect(instance.socratesV1ResponseCitations(ranked).map((item: any) => item.refId)).toContain("copper");
    const answer = instance.buildSocratesV1Answer({ question, intent: "general_question", evidence: ranked,
      sourceStates: { github: { state: "ready" } }, artifact: null, refusedMutation: false });
    expect(answer).toContain("dock-seven");
  });

  it.each([
    ["Show the latest dispatch records.", "general_question"],
    ["Summarize this week.", "weekly_summary"],
    ["Show the sequence of events.", "timeline_view"],
    ["Review the accepted changes.", "change_review_question"]
  ])("retains creation-date tie ordering for explicit temporal requests: %s", (query, intent) => {
    const rows = [evidence("old", "Same relevant passage", 3), evidence("new", "Same relevant passage", 999)];
    expect(service().rankSocratesV1Evidence(rows, query, intent).map((item: any) => item.evidenceId)).toEqual(["new", "old"]);
  });

  it("does not mistake conditional 'when' phrasing for a temporal ordering request", () => {
    const ranked = service().rankSocratesV1Evidence(eightRankedDocuments(), `${question} Explain what happens when these controls apply.`, "general_question");
    expect(ranked.slice(0, 3).map((item: any) => item.evidenceId)).toEqual(["pine", "nimbus", "copper"]);
  });

  it("does not change other-source tie ordering", () => {
    const rows = [evidence("old", "Same relevant passage", 3, "communication_message"), evidence("new", "Same relevant passage", 999, "communication_message")];
    expect(service().rankSocratesV1Evidence(rows, "Find the passage", "general_question").map((item: any) => item.evidenceId)).toEqual(["new", "old"]);
  });

  it("keeps non-document slots unchanged in mixed-source score ties", () => {
    const rows = [evidence("old-doc", "Same passage", 3), evidence("new-comm", "Same passage", 900, "communication_message"),
      evidence("new-doc", "Same passage", 999), evidence("old-comm", "Same passage", 700, "communication_message")];
    const ranked = service().rankSocratesV1Evidence(rows, "Find the passage", "general_question");
    expect(ranked.map((item: any) => item.evidenceId)).toEqual(["old-doc", "new-comm", "old-comm", "new-doc"]);
    expect(rows.map(item => item.evidenceId)).toEqual(["old-doc", "new-comm", "new-doc", "old-comm"]);
  });

  it("retains distinct truth and recency scores before a stable document tie", () => {
    const accepted = { ...evidence("accepted", "Same relevant passage", 3), truthStatus: "accepted" };
    const recent = { ...evidence("recent", "Same relevant passage", 999), createdAt: new Date() };
    expect(service().rankSocratesV1Evidence([recent, accepted], "Find the passage", "general_question").map((item: any) => item.evidenceId)).toEqual(["accepted", "recent"]);
  });
});
