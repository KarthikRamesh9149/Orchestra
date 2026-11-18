import { describe, expect, it, vi } from "vitest";
import { collectExplicitDeepResearchSourceCards, groundDeepResearchOutput, assertDeepResearchRetrievalAvailable, computeStats, buildDeepResearchSources, filterCardsBySources } from "../src/modules/deep-research/service.js";
import { DEEP_RESEARCH_SYSTEM_PROMPT, buildDeepResearchUserPrompt, isAcceptedDecision } from "../src/modules/deep-research/prompts.js";
import { renderReportMarkdown } from "../src/modules/deep-research/report-render.js";
import { deepResearchResultsSchema, startDeepResearchSchema } from "../src/modules/deep-research/schemas.js";

const card = { evidenceId: "ev_1", title: "Delivery PRD", sourceType: "document_chunk", excerpt: "Product Lead: Maya. Backend Lead: Dev.", citationRef: { type: "document_chunk", id: "chunk-1" } } as any;
const report = { executiveSummary: "Maya is Product Lead.", findings: [{ category: "PROJECT FACT", severity: "MEDIUM" as const, title: "Owner", description: "Maya is Product Lead.", sources: "Delivery PRD" }], recommendedActions: [], marketContext: [], expansionOpportunities: [] };

describe("Deep Research citation contract", () => {
  it("retrieves human-accepted records in the explicit decisions scope, not in Docs", async () => {
    const id = "b7ffad33-4d00-4fdd-ba0f-cceabafda0e1";
    const findMany = vi.fn().mockResolvedValue([
      { id, title: "Helix seat ceiling", statement: "Release approval covers twenty production seats." },
      { id: "unrelated", title: "Lime locale", statement: "Localisation follows catalogue rules." },
    ]);
    const prisma = { decisionRecord: { findMany } } as any;
    const focus = "What is the Helix seat ceiling?";
    expect(startDeepResearchSchema.parse({ researchFocus: focus, sources: ["decisions"] }).sources).toEqual(["decisions"]);
    expect(await collectExplicitDeepResearchSourceCards(prisma, {} as any, "project", focus, new Set(["docs"]))).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    const cards = await collectExplicitDeepResearchSourceCards(prisma, {} as any, "project", focus, new Set(["decisions"]));
    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      projectId: "project", status: "accepted", acceptedBy: { not: null }, acceptedAt: { not: null }
    });
    expect(cards.map(item => item.citationRef?.id)).toEqual([id]);
    expect(isAcceptedDecision(cards[0]!)).toBe(true);
    expect(isAcceptedDecision({ ...cards[0]!, sourcePrecedence: "unknown" })).toBe(false);
    expect(buildDeepResearchSources(cards, [])[0]).toMatchObject({
      provider: "Orchestra decisions", ref: "E1", target: { kind: "decision_record", id }
    });
    const answer = "Recorded approval was verified for the Helix seat ceiling [E1].";
    expect(groundDeepResearchOutput({ ...report, executiveSummary: answer }, cards, []).executiveSummary).toBe(answer);
    expect(groundDeepResearchOutput({ ...report, executiveSummary: answer }, [card], []).executiveSummary).not.toBe(answer);
  });
  it("counts source documents, not chunks or derived Product Brain cards", () => {
    const a = { ...card, openTarget: { targetRef: { documentId: "doc-a" } } };
    const b = { ...card, evidenceId: "chunk-2", openTarget: { targetRef: { documentId: "doc-a" } } };
    const c = { ...card, evidenceId: "chunk-3", openTarget: { targetRef: { documentId: "doc-b" } } };
    expect(computeStats([a, b, c, { ...card, sourceType: "product_brain" }], [], Date.now())).toMatchObject({ docs: 2, totalSources: 3 });
    expect(computeStats([{ ...card, sourceType: "brain_node" }], [], Date.now()).docs).toBe(0);
    const section = { ...a, citationRef: { ...card.citationRef, label: "Delivery PRD - requirements" } };
    expect(buildDeepResearchSources([a, section, c], [])).toHaveLength(2);
  });
  it("counts one pull request and one commit once each, even with different evidence aliases", () => {
    const pr = { ...card, sourceType: "github_evidence", evidenceId: "pr-excerpt",
      citationRef: { type: "github_evidence", id: "row-pr" }, title: "PR #12",
      openTarget: { targetType: "github_evidence", targetRef: { evidenceId: "row-pr" } } };
    const commit = { ...card, sourceType: "github_commit", evidenceId: "commit-excerpt",
      citationRef: { type: "github_commit", id: "row-commit" }, title: "Fix export",
      openTarget: { targetType: "github_evidence", targetRef: { evidenceId: "row-commit" } } };
    const alias = { ...commit, evidenceId: "commit-retrieval", sourceType: "github_evidence",
      citationRef: { type: "github_evidence", id: "alias-commit" } };
    const cards = [pr, commit, alias, pr];
    expect(filterCardsBySources(cards, new Set(["github"]))).toEqual(cards);
    expect(filterCardsBySources(cards, new Set(["slack"]))).toEqual([]);
    const stats = computeStats(cards, [], Date.now());
    expect(stats).toMatchObject({ totalSources: 2, slackMessages: 0, commits: 2 });
    const sources = buildDeepResearchSources(cards, []);
    expect(sources.map(source => source.refs)).toEqual([["E1", "E4"], ["E2", "E3"]]);
    const markdown = renderReportMarkdown("Delivery", { ...report, stats, sources });
    expect(markdown).toContain("2 GitHub records");
    expect(markdown).not.toContain("2 commits");
  });
  it("does not present failed retrieval branches as a successful empty search", () => {
    expect(() => assertDeepResearchRetrievalAvailable({ candidates: [], telemetry: { retrievalBranchFailureCount: 1 } })).toThrow(/retrieval/i);
    expect(() => assertDeepResearchRetrievalAvailable({ candidates: [], telemetry: { retrievalBranchFailureCount: 0 } })).not.toThrow();
  });
  it("keeps every evidence alias when grouping multiple excerpts of one document", () => {
    const a = { ...card, openTarget: { targetRef: { documentId: "doc-a" } } };
    const sources = buildDeepResearchSources([a, { ...a, evidenceId: "ev_2", citationRef: { type: "document_chunk", id: "chunk-2", label: "Delivery PRD - requirements" } }], []);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ ref: "E1", refs: ["E1", "E2"], label: "Delivery PRD", href: "/memory/docs/doc-a/view" });
    const results = deepResearchResultsSchema.parse({ ...report, sources, stats: computeStats([a], [], Date.now()) });
    expect(renderReportMarkdown("Owners", results)).toContain("E1 · E2 — [Delivery PRD]");
  });
  it("does not merge unidentified sources or separate documents by a shared label and fallback route", () => {
    const sources = buildDeepResearchSources([card, { ...card, citationRef: { type: "document_chunk", id: "chunk-2" } }], []);
    expect(sources).toHaveLength(2);
    expect(sources.map(source => source.refs)).toEqual([["E1"], ["E2"]]);
    const named = ["doc-a", "doc-b"].map(documentId => ({ ...card, openTarget: { targetRef: { documentId } } }));
    expect(buildDeepResearchSources(named, [])).toHaveLength(2);
  });
  it("preserves exact Slack, Brain, document-revision and GitHub destinations", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";
    const sources = buildDeepResearchSources([
      { ...card, evidenceId: "slack", citationRef: { type: "message", id }, sourceType: "slack_message",
        openTarget: { targetType: "message", targetRef: { messageId: id } } },
      { ...card, evidenceId: "brain", citationRef: { type: "brain_node", id }, sourceType: "brain_node",
        openTarget: { targetType: "product_brain", targetRef: { brainNodeId: id } } },
      { ...card, openTarget: { targetType: "document_section", targetRef: { documentId: id, documentVersionId: versionId, anchorId: "acceptance" } } },
      { ...card, evidenceId: "github", citationRef: { type: "github_commit", id }, sourceType: "github_commit",
        openTarget: { targetType: "github_evidence", targetRef: { url: "https://github.com/example/example/commit/abc1234" } } },
      { ...card, evidenceId: "unknown", sourceType: "other", citationRef: { type: "other", id } },
    ], []);
    expect(sources[0]).toMatchObject({ href: null, target: { kind: "message", id } });
    expect(sources[1]).toMatchObject({ href: null, target: { kind: "brain_node", id } });
    expect(sources[2]?.href).toBe(`/memory/docs/${id}/view?versionId=${versionId}#acceptance`);
    expect(sources[3]?.href).toBe("https://github.com/example/example/commit/abc1234");
    expect(sources[4]).toMatchObject({ href: null, excerpt: card.excerpt });
  });
  it("groups public URLs without losing citation aliases and labels derived evidence explicitly", () => {
    const sources = buildDeepResearchSources([{ ...card, sourceType: "brain_node" }], [
      { title: "Public source", url: "https://example.com/report", snippet: "First excerpt" },
      { title: "Another title", url: "https://example.com/report", snippet: "Second excerpt" }
    ]);
    expect(sources).toHaveLength(2);
    expect(sources[0].label).toBe("Delivery PRD (Brain node)");
    expect(sources[1].refs).toEqual(["W1", "W2"]);
  });
  it("does not let a grounded finding validate an uncited or invalidly cited executive summary", () => {
    expect(groundDeepResearchOutput({ ...report, executiveSummary: "Budget is approved [E99]." }, [card], []).executiveSummary).not.toContain("Budget is approved");
    expect(groundDeepResearchOutput({ ...report, executiveSummary: "Budget is approved." }, [card], []).executiveSummary).not.toContain("Budget is approved");
    expect(groundDeepResearchOutput({ ...report, executiveSummary: "Budget is approved [E1] [E99]." }, [card], []).executiveSummary).not.toContain("Budget is approved");
  });
  it("rejects mixed valid and unknown citation IDs instead of laundering the unsupported references", () => {
    const output = { ...report, findings: [{ ...report.findings[0], sources: "E1 · E999" }] };
    expect(groundDeepResearchOutput(output, [card], []).findings).toEqual([]);
  });
  it("retains all bibliography entries at the supported maximum evidence configuration", () => {
    const cards = Array.from({ length: 25 }, (_, i) => ({ ...card, evidenceId: `ev_${i}`, citationRef: { type: "document_chunk", id: `chunk-${i}` } }));
    const web = Array.from({ length: 24 }, (_, i) => ({ title: `Web ${i}`, url: `https://example.com/${i}`, snippet: "Public evidence" }));
    const sources = buildDeepResearchSources(cards, web);
    expect(sources).toHaveLength(49);
    expect(sources.at(-1)?.refs).toEqual(["W24"]);
    expect(deepResearchResultsSchema.parse({ ...report, sources, stats: computeStats(cards, web, Date.now()) }).sources).toHaveLength(49);
  });
  it("requires valid inline references in market context and expansion suggestions", () => {
    const output = { ...report,
      marketContext: [
        { title: "Web fact", body: "Public evidence [W1]." },
        { title: "Internal fact", body: "Internal evidence [E1]." },
        { title: "Invented", body: "No evidence." },
        { title: "Mixed", body: "Public evidence [W1] but fabricated source [W100]." }
      ], expansionOpportunities: ["Suggested follow-up [E1].", "Unsupported idea.", "Invalid idea [E100]."] };
    const grounded = groundDeepResearchOutput(output, [card], [{ title: "Public", url: "https://example.com", snippet: "Public evidence" }]);
    expect(grounded.marketContext).toEqual([output.marketContext[0]]);
    expect(grounded.expansionOpportunities).toEqual([output.expansionOpportunities[0]]);
  });
  it("does not accept web citations that cannot appear in the safe bibliography", () => {
    const unsafe = [{ title: "Bad source", url: "javascript:alert(1)", snippet: "Fabricated launch evidence" }];
    const output = { ...report, executiveSummary: "Launch approved [W1].", findings: [{ ...report.findings[0], sources: "W1" }] };
    expect(buildDeepResearchSources([], unsafe)).toEqual([]);
    const grounded = groundDeepResearchOutput(output, [], unsafe);
    expect(grounded.findings).toEqual([]);
    expect(grounded.executiveSummary).not.toContain("Launch approved");
  });
  it("resolves the exact unambiguous titles the prior prompt explicitly allowed", () => {
    expect(groundDeepResearchOutput(report, [card], []).findings[0]?.sources).toBe("E1");
  });
  it("never guesses ambiguous titles or unknown references", () => {
    expect(groundDeepResearchOutput(report, [card, { ...card, evidenceId: "ev_2" }], []).findings).toEqual([]);
    expect(groundDeepResearchOutput({ ...report, findings: [{ ...report.findings[0], sources: "Other PRD" }] }, [card], []).findings).toEqual([]);
  });
  it("preserves a citation-backed executive answer without manufactured risks or actions", () => {
    const output = { ...report, executiveSummary: "Maya is Product Lead [E1].", findings: [] };
    expect(groundDeepResearchOutput(output, [card], []).executiveSummary).toBe(output.executiveSummary);
  });
  it("requests the same E/W identifiers the verifier consumes", () => {
    const prompt = buildDeepResearchUserPrompt({ researchFocus: "Who owns delivery?", outputFormat: "exec_summary", sources: ["docs"], evidenceCards: [card], webResults: [] });
    expect(DEEP_RESEARCH_SYSTEM_PROMPT).toContain("E1");
    expect(prompt).toContain('"sources": "E1"');
    expect(prompt).not.toContain("cite by title/ref");
  });
});
