import { describe, expect, it, vi } from "vitest";
import { SocratesService } from "../src/modules/socrates/service.js";

function evidence(count = 8) {
  return Array.from({ length: count }, (_, index) => {
    const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return {
      evidenceId: `document:${id}`, sourceType: "document", sourceSubType: null,
      title: `Source ${index + 1}`, text: `Verified content from source ${index + 1}.`,
      createdAt: null, author: null, truthStatus: "evidence", confidence: 0.9,
      citation: { id, type: "document_chunk", label: `Source ${index + 1}` },
      openTarget: { targetType: "document_section", targetRef: { documentId: id, documentVersionId: id, anchorId: `part-${index + 1}` } },
      metadataSummary: null
    };
  });
}

function service(overrides = {}) {
  const instance = Object.create(SocratesService.prototype) as any;
  instance.env = { SOCRATES_MAX_EVIDENCE_ITEMS: 10, SOCRATES_MAX_CITATIONS: 6, SOCRATES_MAX_OPEN_TARGETS: 6, ...overrides };
  return instance;
}

function project(instance: any, answer: string, rows = evidence(), fallback = false) {
  const selected = instance.socratesV1EvidenceCitedByAnswer(answer, instance.socratesV1PromptEvidence(rows), fallback);
  return { selected, citations: instance.socratesV1ResponseCitations(selected), targets: instance.socratesV1ResponseOpenTargets(selected) };
}

describe("Socrates v1 exact evidence-marker projection", () => {
  it("resolves all eight valid markers instead of trimming the final two supporting sources", () => {
    const result = project(service(), "Sources [E1][E2][E3][E4][E5][E6][E7][E8].");
    expect(result.citations).toHaveLength(8);
    expect(result.targets).toHaveLength(8);
    expect(result.citations.map((row: any) => row.evidenceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const row of result.citations) expect(result.targets.find((target: any) => target.id === row.openTargetId)?.targetRef.documentId).toBe(row.refId);
  });

  it("retains E8 identity even when it is the only citation card", () => {
    const result = project(service(), "The answer is in source eight [E8].");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ evidenceNumber: 8, refId: evidence()[7]!.citation.id });
  });

  it("preserves original ordinals through first-mention ordering and duplicate markers without mutating retrieval rows", () => {
    const rows = evidence();
    const result = project(service(), "Second [E2], then first [E1], second again [E2].", rows);
    expect(result.citations.map((row: any) => [row.evidenceNumber, row.label])).toEqual([[2, "Source 2"], [1, "Source 1"]]);
    expect(rows.every((row) => !("evidenceNumber" in row))).toBe(true);
  });

  it("never invents a source for zero, out-of-prompt, or enormous markers and stays bounded by ten inputs", () => {
    const result = project(service(), "[E0][E1][E10][E11][E999999999999999999999999999999]", evidence(12));
    expect(result.citations.map((row: any) => row.evidenceNumber)).toEqual([1, 10]);
    expect(result.targets).toHaveLength(2);
  });

  it("keeps an explicit zero-target policy without dangling citation links", () => {
    const result = project(service({ SOCRATES_MAX_OPEN_TARGETS: 0 }), "Source eight [E8].");
    expect(result.citations[0]).toMatchObject({ evidenceNumber: 8, openTargetId: null });
    expect(result.targets).toEqual([]);
  });

  it("keeps unmarked fallback caps and does not assign fake inline ordinals or dangling capped targets", () => {
    const result = project(service({ SOCRATES_MAX_OPEN_TARGETS: 2 }), "Evidence-only excerpts without inline labels.", evidence(), true);
    expect(result.citations).toHaveLength(6);
    expect(result.targets).toHaveLength(2);
    expect(result.citations.every((row: any) => row.evidenceNumber === undefined)).toBe(true);
    expect(result.citations.slice(2).every((row: any) => row.openTargetId === null)).toBe(true);
  });

  it("projects marked membership evidence using its real evidence identity, without inventing navigation", () => {
    const rows: any[] = [{ ...evidence(1)[0], evidenceId: "member:actual-membership", sourceType: "team_member", title: "Asha — manager", citation: null, openTarget: null }];
    const result = project(service(), "The manager is Asha [E1].", rows);
    expect(result.citations).toEqual([expect.objectContaining({ evidenceNumber: 1, refId: "member:actual-membership", sourceType: "team_member", label: "Asha — manager", openTargetId: null })]);
    expect(result.targets).toEqual([]);
  });

  it("persists the exact projected eight-source response and all supported relational rows", async () => {
    const instance = service();
    const tx = { socratesMessage: { update: vi.fn() }, socratesCitation: { createMany: vi.fn() }, socratesOpenTarget: { createMany: vi.fn() } };
    instance.prisma = { $transaction: async (run: any) => run(tx) };
    const answer = "Sources [E8][E2][E1][E3][E4][E5][E6][E7].";
    const result = project(instance, answer);
    const response = { answer_md: answer, citations: result.citations, open_targets: result.targets, artifact: null, retrievalSummary: {}, safety: {}, costEstimate: {}, modelMetadata: {} };
    await instance.persistSocratesV1Answer("project", "assistant", response, result.selected);
    const stored = tx.socratesMessage.update.mock.calls[0]![0].data;
    expect(stored.content).toBe(answer);
    expect(stored.answerPayloadJson).toEqual(response);
    expect(stored.answerPayloadJson.citations.map((row: any) => row.evidenceNumber)).toEqual([8, 2, 1, 3, 4, 5, 6, 7]);
    expect(tx.socratesCitation.createMany.mock.calls[0]![0].data).toHaveLength(8);
    expect(tx.socratesOpenTarget.createMany.mock.calls[0]![0].data).toHaveLength(8);
  });
});
