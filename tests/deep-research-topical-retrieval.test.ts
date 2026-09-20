import { describe, expect, it, vi } from "vitest";
import { collectExplicitDeepResearchSourceCards, mergeDeepResearchCards, computeStats, assertDeepResearchDocumentEvidence, filterCardsBySources, filterDeepResearchOriginalDocumentCards } from "../src/modules/deep-research/service.js";

const focus = "Assess Northstar CSV export requirements and the product decisions still needed before launch.";
const documentRow = (id: string, content: string) => ({ id, content, parseRevision: 3, documentVersionId: `${id}-version`,
  documentVersion: { parseRevision: 3, document: { id: `${id}-document`, title: "Northstar-Launch-PRD", currentVersionId: `${id}-version` } }, section: null });

describe("Deep Research natural-question uploaded-document retrieval", () => {
  it("retrieves topical raw current chunks without requiring the complete document title or every focus word", async () => {
    const prd = documentRow("prd", "Northstar CSV export: item_id, title, owner, status. Launch acceptance: selected project only; all four columns; unauthorised projects isolated; empty projects return headers without invented rows.");
    const change = documentRow("change", "Northstar CSV launch decision: PDF export is an unapproved change request, not accepted scope.");
    const unrelated = documentRow("unrelated", "Office catering supplies and bicycle parking.");
    const generic = documentRow("generic", "The product requirements still need review before launch. Decisions and launch readiness remain uncertain.");
    const stale = { ...prd, id: "stale", parseRevision: 2 };
    const generated = { ...documentRow("generated", prd.content), documentVersion: { ...documentRow("generated", prd.content).documentVersion, sourceLabel: "generated_by_socrates" } };
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([{ id: "prd-document", title: "Northstar-Launch-PRD", currentVersionId: "prd-version" }]) },
      $queryRaw: vi.fn(async (query: any) => {
        const sql = query.strings.join(" ");
        expect(sql).toContain("d.current_version_id = dv.id");
        expect(sql).toContain("dc.parse_revision = dv.parse_revision");
        expect(sql).toContain("d.archived_at IS NULL");
        expect(sql).toContain("dc.project_id =");
        expect(sql).toContain("dc.content");
        expect(sql).toContain("to_tsvector('english', dc.lexical_content)");
        expect(sql).toContain("plainto_tsquery('english', query_term.term)");
        expect(sql).toContain("source_label <> 'generated_by_socrates'");
        expect(query.values).toContain("project");
        expect(query.values.some((value: unknown) => typeof value === "string" && value.includes("csv OR export"))).toBe(true);
        return [prd, change, unrelated, generic, stale, generated].map(row => ({ id: row.id, matchedTerms: ["unrelated", "generic"].includes(row.id) ? 0 : 3 }));
      }),
      documentChunk: { findMany: vi.fn().mockResolvedValue([prd, change, unrelated, generic, stale, generated]) }
    };
    const cards = await collectExplicitDeepResearchSourceCards(prisma as any, {} as any, "project", focus, new Set(["docs"]));
    expect(cards.map(card => card.citationRef?.id)).toEqual(["prd", "change"]);
    expect(cards[0].excerpt).toContain("item_id, title, owner, status");
    expect(cards[0].excerpt).toContain("empty projects return headers");
    expect(cards[0].openTarget?.targetRef.documentId).toBe("prd-document");
    const derived = Array.from({ length: 8 }, (_, i) => ({ evidenceId: `brain-${i}`, sourceType: "brain_node", title: "Prior research",
      excerpt: focus.repeat(5), whySelected: "Graph context", confidence: 1, sourcePrecedence: "brain_graph", trace: {} }));
    const merged = mergeDeepResearchCards(derived as any, cards, 2, focus);
    expect(merged.every(card => card.sourceType === "document_chunk")).toBe(true);
    expect(computeStats(merged, [], Date.now()).docs).toBe(2);
    const sourceFiltered = filterCardsBySources([...derived, ...cards] as any, new Set(["docs"]));
    expect(sourceFiltered.map(card => card.sourceType)).toEqual(["document_chunk", "document_chunk"]);
  });

  it("does not query raw documents when only another source was selected", async () => {
    const prisma = { $queryRaw: vi.fn(), document: { findMany: vi.fn() }, documentChunk: { findMany: vi.fn() } };
    expect(await collectExplicitDeepResearchSourceCards(prisma as any, {} as any, "project", focus, new Set(["calendar"]))).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it("does not synthesise a document-only absence claim from derived notes", () => {
    const derived = [{ evidenceId: "brain", sourceType: "brain_node", excerpt: "Earlier research summary" }] as any;
    expect(() => assertDeepResearchDocumentEvidence(derived, new Set(["docs"]))).toThrow(/does not mean the documents lack/);
    expect(() => assertDeepResearchDocumentEvidence([], new Set(["docs"]))).toThrow(/current uploaded-document text/);
    expect(() => assertDeepResearchDocumentEvidence(derived, new Set(["slack"]))).not.toThrow();
  });
  it("uses PostgreSQL stemmed term matches for plural natural questions instead of JS substrings", async () => {
    const row = documentRow("prd", "CSV export: item_id, title, owner, status.");
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ id: row.id, matchedTerms: 2 }]),
      documentChunk: { findMany: vi.fn().mockResolvedValue([row]) }
    };
    const cards = await collectExplicitDeepResearchSourceCards(prisma as any, {} as any, "project", "Assess CSV exports", new Set(["docs"]));
    expect(cards.map(card => card.citationRef?.id)).toEqual(["prd"]);
    expect(cards[0].excerpt).toContain("CSV export:");
  });
  it("also excludes generated documents in the explicit full-title path", async () => {
    const row = documentRow("generated", "CSV export: item_id, title, owner, status.");
    row.documentVersion = { ...row.documentVersion, sourceLabel: "generated_by_socrates" } as any;
    const prisma = {
      document: { findMany: vi.fn().mockResolvedValue([{ id: "generated-document", title: "Northstar-Launch-PRD", currentVersionId: row.documentVersionId }]) },
      documentChunk: { findMany: vi.fn().mockResolvedValue([row]) }
    };
    expect(await collectExplicitDeepResearchSourceCards(prisma as any, {} as any, "project", "Assess Northstar-Launch-PRD", new Set(["docs"]))).toEqual([]);
    expect(prisma.documentChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      documentVersion: expect.objectContaining({ OR: [{ sourceLabel: null }, { sourceLabel: { not: "generated_by_socrates" } }] })
    }) }));
  });
  it("preserves selected communication and GitHub coverage when many topical documents match", () => {
    const docs = Array.from({ length: 12 }, (_, index) => ({ evidenceId: `doc-${index}`, sourceType: "document_chunk", title: "Northstar PRD", excerpt: focus.repeat(5),
      whySelected: "Current original evidence", confidence: 0.8, sourcePrecedence: "source_evidence", trace: {},
      citationRef: { type: "document_chunk", id: `doc-${index}` }, openTarget: { targetType: "document", targetRef: { documentId: `document-${index}` } } }));
    const comm = { evidenceId: "message", sourceType: "communication_message", title: "Release message", excerpt: "CSV export decision", whySelected: "Requested communications", confidence: 0.7, sourcePrecedence: "communication_evidence", trace: {} };
    const github = { ...comm, evidenceId: "github", sourceType: "github_evidence", title: "CSV implementation", sourcePrecedence: "engineering_artifact" };
    const cards = mergeDeepResearchCards([], [...docs, comm, github] as any, 3, focus);
    expect(new Set(cards.map(card => card.sourceType))).toEqual(new Set(["document_chunk", "communication_message", "github_evidence"]));
  });
  it("checks semantic document provenance independently of topical exact-word matches", async () => {
    const semantic = { evidenceId: "semantic", sourceType: "document_chunk", title: "Data handbook", excerpt: "Comma-separated task downloads.",
      openTarget: { targetType: "document", targetRef: { documentId: "original", documentVersionId: "current" } } };
    const generated = { ...semantic, evidenceId: "generated", openTarget: { targetType: "document", targetRef: { documentId: "generated", documentVersionId: "generated-current" } } };
    const stale = { ...semantic, evidenceId: "stale", openTarget: { targetType: "document", targetRef: { documentId: "original", documentVersionId: "old" } } };
    const prisma = { documentVersion: { findMany: vi.fn(async (args: any) => {
      expect(args.where).toMatchObject({ projectId: "project", document: { projectId: "project", archivedAt: null },
        OR: [{ sourceLabel: null }, { sourceLabel: { not: "generated_by_socrates" } }] });
      return [
        { id: "current", documentId: "original", sourceLabel: null, document: { currentVersionId: "current" } },
        { id: "generated-current", documentId: "generated", sourceLabel: "generated_by_socrates", document: { currentVersionId: "generated-current" } },
        { id: "old", documentId: "original", sourceLabel: null, document: { currentVersionId: "current" } }
      ];
    }) } };
    expect(await filterDeepResearchOriginalDocumentCards(prisma as any, "project", [semantic, generated, stale] as any)).toEqual([semantic]);
  });
});
