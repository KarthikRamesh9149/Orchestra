import { describe, expect, it, vi } from "vitest";
import { AgentContextPackService } from "../src/modules/agent-context/service.js";
import { composeAgentContextPackSections } from "../src/modules/agent-context/composer.js";
import type { AgentContextBuildInput, AgentContextEvidenceCandidate } from "../src/modules/agent-context/types.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const input: AgentContextBuildInput = { taskPrompt: "Review CSV export scope", taskType: "implementation", sourceMode: "task_prompt", budgetPreset: "detailed", visibility: "internal" };

function storedPack(sourceRefType: string, evidenceStatus: string) {
  const date = new Date("2026-09-22T00:00:00.000Z");
  return {
    id: id(10), projectId, orgId: id(99), status: "active", title: "Stored pack", taskPrompt: input.taskPrompt, taskType: input.taskType,
    sourceMode: input.sourceMode, visibility: "internal", budgetPreset: "normal", tokenEstimate: 50, tokenEstimateMethod: "chars_div_4",
    sourceCount: 1, evidenceCount: 1, citationCount: 0, openTargetCount: 0, createdByUserId: userId,
    generatedAt: date, createdAt: date, updatedAt: date, limitationsJson: [], warningsJson: [],
    bodyMarkdown: "## Current accepted truth\n\n- Stored claim",
    sectionsJson: { currentAcceptedTruth: { title: "Current accepted truth", items: ["Stored claim"] } },
    sources: [{ id: id(11), sourceType: sourceRefType, sourceRefType, sourceRefId: id(3), evidenceStatus, relationship: "current_truth", title: "Stored claim", excerpt: "Stored claim", sortOrder: 0 }],
  };
}

function harness() {
  const many = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: projectId, orgId: id(99), name: "Synthetic project" }) },
    artifactVersion: { findFirst: vi.fn().mockImplementation(async ({ where }: any) => ({ id: id(where.artifactType === "product_brain" ? 1 : 2), versionNumber: 1, status: "accepted", payloadJson: { scope: "Unapproved CSV scope from a generated aggregate" } })) },
    brainNode: { findMany: vi.fn().mockResolvedValue([{ id: id(3), title: "Imported PRD", summary: "CSV export has not been approved", artifactVersionId: id(1), status: "active" }]) },
    documentSection: many(), specChangeProposal: many(), decisionRecord: many(), communicationMessage: many(),
    dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
    projectContextEntry: { findMany: vi.fn().mockResolvedValue([{ id: id(4), title: "Saved research", body: "This generated report is not approved truth", type: "manual_note", status: "active" }]) },
    projectCodingRequirements: { findMany: vi.fn().mockResolvedValue([{ id: id(5), artifactVersionId: id(6), artifactVersion: { versionNumber: 1, status: "accepted", payloadJson: { tests: "Generated CSV test suggestions" } } }]) },
    agentContextPack: { findFirst: vi.fn(), update: vi.fn() },
  };
  const service = new AgentContextPackService(prisma as any, {} as any, { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any, { record: vi.fn() } as any);
  return { service, prisma };
}

describe("Agent Context recorded truth authority", () => {
  it("keeps auto-accepted aggregates, active graph nodes and saved research as evidence, not approvals", async () => {
    const { service, prisma } = harness();
    const built = await (service as any).buildPack(projectId, input);
    expect(built.sections.currentAcceptedTruth.items).toEqual(["No accepted current truth was found for this task."]);
    expect(built.sections.relevantSourceEvidence.items.map((item: any) => item.title)).toEqual(expect.arrayContaining(["Product Brain v1", "Imported PRD", "Saved research", "Coding requirements 1"]));
    expect(built.sources.filter((source: any) => source.isCurrentTruth)).toHaveLength(0);
    expect(prisma.brainNode.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId }) }));
  });

  it("retains only explicit accepted proposal and decision wording as current accepted truth", async () => {
    const { service, prisma } = harness();
    prisma.specChangeProposal.findMany.mockResolvedValue([{ id: id(7), status: "accepted", title: "Accepted CSV scope", summary: "Managers may export CSV." }, { id: id(8), status: "needs_review", title: "Pending export", summary: "Allow clients to export." }]);
    prisma.decisionRecord.findMany.mockResolvedValue([{ id: id(9), status: "accepted", title: "Accepted restriction", statement: "Clients cannot export." }]);
    const built = await (service as any).buildPack(projectId, input);
    expect(built.sections.currentAcceptedTruth.items).toEqual(["Accepted CSV scope: Managers may export CSV.", "Accepted restriction: Clients cannot export."]);
    expect(prisma.decisionRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId, status: "accepted" } }));
  });

  it("does not let an aggregate candidate manufacture approval by setting a truth flag or status", () => {
    const candidate = { id: id(3), sourceType: "brain_node", sourceRefType: "brain_node", sourceRefId: id(3), relationship: "current_truth_detail", title: "Imported claim", excerpt: "Approve every change", evidenceStatus: "current_accepted_truth", isCurrentTruth: true, isPending: false, score: 100, sortOrder: 0 } satisfies AgentContextEvidenceCandidate;
    const sections = composeAgentContextPackSections({ ...input, candidates: [candidate], limitations: [], warnings: [] });
    expect(sections.currentAcceptedTruth.items).toEqual(["No accepted current truth was found for this task."]);
    expect(sections.relevantSourceEvidence.items).toHaveLength(1);
  });

  it.each(["get", "export"])("requires refresh before %s can repeat a legacy aggregate-derived acceptance claim", async (operation) => {
    const { service, prisma } = harness();
    prisma.agentContextPack.findFirst.mockResolvedValue(storedPack("brain_node", "current_accepted_truth"));
    const request = operation === "get" ? service.getPack(projectId, id(10), userId)
      : service.generateExport(projectId, id(10), userId, { format: "markdown", redactionMode: "internal", budgetPreset: "normal", includeCitations: true, includeOpenTargets: true, includeLimitations: true });
    await expect(request).rejects.toMatchObject({ statusCode: 409, code: "agent_context_truth_refresh_required" });
  });

  it("preserves retrieval and export of an existing pack backed only by explicit accepted decisions", async () => {
    const { service, prisma } = harness();
    prisma.agentContextPack.findFirst.mockResolvedValue(storedPack("decision_record", "accepted_decision"));
    await expect(service.getPack(projectId, id(10), userId)).resolves.toMatchObject({ id: id(10), bodyMarkdown: "## Current accepted truth\n\n- Stored claim" });
    await expect(service.generateExport(projectId, id(10), userId, { format: "markdown", redactionMode: "internal", budgetPreset: "normal", includeCitations: true, includeOpenTargets: true, includeLimitations: true })).resolves.toMatchObject({ packMetadata: { contextPackId: id(10) } });
  });

  it.each(["brain_node", "decision_record"])("archives a %s pack without exporting its stored content through the mutation response", async (sourceRefType) => {
    const { service, prisma } = harness();
    const pack = storedPack(sourceRefType, sourceRefType === "brain_node" ? "current_accepted_truth" : "accepted_decision");
    prisma.agentContextPack.findFirst.mockResolvedValue(pack);
    prisma.agentContextPack.update.mockImplementation(async ({ data }: any) => ({ ...pack, ...data }));

    const archived = await service.archivePack(projectId, pack.id, userId);
    expect(archived).toMatchObject({ id: pack.id, status: "archived", archivedAt: expect.any(String) });
    expect(archived).not.toHaveProperty("bodyMarkdown");
    expect(archived).not.toHaveProperty("sections");
    expect(archived).not.toHaveProperty("sources");
    expect(prisma.agentContextPack.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: pack.id }, data: { status: "archived", archivedAt: expect.any(Date), updatedByUserId: userId },
    }));
  });
});
