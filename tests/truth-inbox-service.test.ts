import { describe, expect, it, vi } from "vitest";
import { TruthInboxService } from "../src/modules/truth-inbox/truth-inbox.service.js";

const ACTOR = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" };
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";

function sourceStates() {
  return {
    slack: { state: "ready", label: "Slack", detail: null },
    microsoft_teams: { state: "empty", label: "Microsoft Teams", detail: null },
    livedoc: { state: "ready", label: "LiveDoc", detail: null },
    timeline: { state: "ready", label: "Timeline", detail: null },
    calendar: { state: "not_connected", label: "Calendar", detail: null },
    documents: { state: "ready", label: "Documents", detail: null },
    notion: { state: "not_connected", label: "Notion", detail: null },
    google_drive: { state: "degraded", label: "Google Drive", detail: "Last sync failed" },
    socrates: { state: "ready", label: "Socrates", detail: null },
    github: { state: "ready", label: "GitHub", detail: null },
    vscode: { state: "ready", label: "VS Code", detail: null }
  };
}

function harness() {
  const states: any[] = [];
  const suggestion = {
    id: "sug_signal_12345",
    projectId: PROJECT_ID,
    category: "spec_drift",
    title: "Slack request changes launch scope",
    description: "A launch requirement differs from current truth.",
    severity: "high",
    confidence: 0.9,
    status: "active",
    sourceRefs: [{ type: "slack_message", id: "message-1", label: "Slack message" }],
    evidence: [{ source: "slack_message", refId: "message-1", label: "Slack message", excerpt: "Add Google login", occurredAt: "2026-08-23T01:00:00.000Z", openTarget: { targetType: "message", targetRef: { messageId: "message-1" } } }],
    recommendedActions: [],
    limitations: ["Discussion evidence is not accepted truth."],
    detectorKey: "slack_spec_drift",
    sourceFingerprint: "fingerprint-1",
    staleAfter: null,
    createdAt: "2026-08-23T01:00:00.000Z",
    updatedAt: "2026-08-23T01:00:00.000Z",
    dismissedAt: null,
    dismissedByUserId: null,
    promotedTimelineEventId: null,
    createdProposalId: null,
    metadata: {}
  };
  const proposal = {
    id: PROPOSAL_ID,
    title: "Google login before launch",
    summary: "Review the new login requirement.",
    proposalType: "requirement_change",
    status: "needs_review",
    oldUnderstandingJson: { requirement: "Email login" },
    newUnderstandingJson: { requirement: "Google login" },
    impactSummaryJson: { severity: "critical", confidence: 0.95 },
    externalEvidenceRefsJson: [],
    links: [
      { linkType: "message", linkRefId: "message-1", relationship: "source", createdAt: new Date("2026-08-23T02:00:00.000Z") },
      { linkType: "document_section", linkRefId: "section-1", relationship: "affected", createdAt: new Date("2026-08-23T02:00:00.000Z") },
      { linkType: "brain_node", linkRefId: "brain-1", relationship: "affected", createdAt: new Date("2026-08-23T02:00:00.000Z") }
    ],
    decisionRecord: null,
    createdAt: new Date("2026-08-23T02:00:00.000Z"),
    updatedAt: new Date("2026-08-23T02:00:00.000Z")
  };
  const prisma = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: PROJECT_ID }) },
    specChangeProposal: { findMany: vi.fn().mockResolvedValue([proposal]), create: vi.fn(), },
    fdeReadinessFinding: { findMany: vi.fn().mockResolvedValue([]) },
    agentQualityReview: { findMany: vi.fn().mockResolvedValue([]) },
    truthInboxItemState: {
      findMany: vi.fn(async () => states),
      upsert: vi.fn(async ({ create, update }: any) => {
        const index = states.findIndex((row) => row.projectId === PROJECT_ID && row.sourceType === create.sourceType && row.sourceId === create.sourceId);
        const next = index >= 0 ? { ...states[index], ...update, updatedAt: new Date("2026-08-23T03:00:00.000Z") } : { id: "state-1", ...create, updatedAt: new Date("2026-08-23T03:00:00.000Z"), assignedUser: null };
        if (next.assignedUserId === ACTOR.userId) next.assignedUser = { id: ACTOR.userId, displayName: "Karthik", email: "k@example.com" };
        if (index >= 0) states[index] = next; else states.push(next);
        return next;
      })
    },
    projectMember: {
      findMany: vi.fn().mockResolvedValue([{ projectRole: "manager", canApproveTruthChanges: true, joinedAt: new Date(), user: { id: ACTOR.userId, displayName: "Karthik", email: "k@example.com", isActive: true } }]),
      findFirst: vi.fn().mockResolvedValue({ id: "member-1" })
    }
  };
  const projectService = {
    ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ projectRole: "manager", canApproveTruthChanges: true }),
    ensureProjectMemberCanMutate: vi.fn().mockResolvedValue({ projectRole: "manager" }),
    ensureProjectTruthApprover: vi.fn().mockResolvedValue({ member: { projectRole: "manager" } })
  };
  const suggestionsService = {
    list: vi.fn().mockResolvedValue({ items: [suggestion], sourceStates: sourceStates(), countsByCategory: {}, countsBySeverity: {}, generatedAt: "", limitations: [] }),
    dismiss: vi.fn(),
    promoteToTimeline: vi.fn(),
    createReviewItem: vi.fn(),
  };
  const changeProposalService = { accept: vi.fn().mockResolvedValue({ ...proposal, status: "accepted" }), reject: vi.fn() };
  const auditService = { record: vi.fn() };
  const service = new TruthInboxService(
    prisma as any,
    projectService as any,
    auditService as any,
    { createManualEvent: vi.fn() } as any,
    { askV1ProjectMemory: vi.fn() } as any,
    suggestionsService as any,
    changeProposalService as any
  );
  return { service, prisma, states, suggestionsService, changeProposalService, auditService };
}

describe("TruthInboxService", () => {
  it("loads source history without building the unrelated cross-source snapshot", async () => {
    const { service } = harness();
    const buildSnapshot = vi.spyOn(service as any, "buildSnapshot");

    const result = await service.list(PROJECT_ID, ACTOR, { source: "proposal", limit: 30, refresh: true });

    expect(result.items.map((item) => item.sourceType)).toEqual(["proposal"]);
    expect(buildSnapshot).not.toHaveBeenCalled();
  });

  it("finds an older critical proposal outside the recent window using source history", async () => {
    const { service, prisma } = harness();
    const template = (await prisma.specChangeProposal.findMany())[0]!;
    const rows = Array.from({ length: 251 }, (_, index) => ({ ...template,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      updatedAt: new Date(Date.UTC(2026, 8, 5) - index * 1000),
      impactSummaryJson: { severity: index === 250 ? "critical" : "low" }
    }));
    prisma.specChangeProposal.findMany.mockImplementation(async (input: any) => {
      const after = input?.where?.OR?.[0]?.updatedAt?.lt;
      return rows.filter((row) => !after || row.updatedAt < after).slice(0, input.take);
    });
    const result = await service.list(PROJECT_ID, ACTOR, { source: "proposal", severity: "critical", limit: 30, refresh: true });
    expect(result.items.map((row) => row.sourceId)).toEqual([rows[250]!.id]);
    expect(result.page.hasMore).toBe(false);
    expect(result.limitations[0]).toContain("Counts describe this page only");
  });

  it("source keyset pages neither duplicate nor omit equal-timestamp rows", async () => {
    const { service, prisma } = harness();
    const template = (await prisma.specChangeProposal.findMany())[0]!;
    const rows = Array.from({ length: 3 }, (_, index) => ({ ...template, id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    prisma.specChangeProposal.findMany.mockImplementation(async (input: any) => rows.filter((row) => !input?.where?.OR || row.id > input.where.OR[1].id.gt).slice(0, input.take));
    const first = await service.list(PROJECT_ID, ACTOR, { source: "proposal", limit: 1, refresh: true });
    const second = await service.list(PROJECT_ID, ACTOR, { source: "proposal", cursor: first.page.nextCursor!, limit: 2, refresh: false });
    expect([...first.items, ...second.items].map((item) => item.sourceId)).toEqual(rows.map((row) => row.id));
    expect(second.page.hasMore).toBe(false);
    await expect(service.list(PROJECT_ID, ACTOR, { source: "fde", cursor: first.page.nextCursor!, limit: 2, refresh: false })).rejects.toMatchObject({ code: "truth_inbox_cursor_invalid" });
  });
  it("does not let an older in-flight snapshot overwrite a refreshed snapshot", async () => {
    const { service } = harness();
    const snapshot = (label: string) => ({ items: [], members: [], sourceStates: {}, generatedAt: label, limitations: [] });
    let releaseOld!: (value: any) => void;
    const old = new Promise((resolve) => { releaseOld = resolve; });
    const build = vi.spyOn(service as any, "buildSnapshot").mockReturnValueOnce(old).mockResolvedValue(snapshot("new"));
    const pending = service.list(PROJECT_ID, ACTOR, { limit: 30, refresh: true });
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(1));
    expect((await service.list(PROJECT_ID, ACTOR, { limit: 30, refresh: true })).generatedAt).toBe("new");
    releaseOld(snapshot("old"));
    await pending;
    expect((await service.list(PROJECT_ID, ACTOR, { limit: 30, refresh: false })).generatedAt).toBe("new");
  });
  it("aggregates proposals, suggestions, degraded connectors, capabilities, and stable cursor pagination", async () => {
    const { service, suggestionsService } = harness();
    const first = await service.list(PROJECT_ID, ACTOR, { limit: 1, refresh: true } as any);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ sourceType: "proposal", severity: "critical", status: "active" });
    expect(first.items[0]?.capabilities).toMatchObject({ accept: true, reject: true, ask_socrates: true });
    expect(first.page).toMatchObject({ hasMore: true });
    expect(first.summary).toMatchObject({ active: 3, critical: 1, awaitingDecision: 1 });
    expect(first.sourceStates.google_drive.state).toBe("degraded");

    const second = await service.list(PROJECT_ID, ACTOR, { limit: 5, cursor: first.page.nextCursor, refresh: false } as any);
    expect(second.items.map((item) => item.id)).not.toContain(first.items[0]?.id);
    expect(second.items.some((item) => item.sourceType === "connector")).toBe(true);
    expect(suggestionsService.list).toHaveBeenCalledTimes(1);
  });

  it("persists owner assignment and proves authoritative reload state", async () => {
    const { service, prisma, auditService } = harness();
    const result = await service.act(PROJECT_ID, "suggestion:sug_signal_12345", "assign_owner", ACTOR, { assignedUserId: ACTOR.userId });
    expect(prisma.truthInboxItemState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId_sourceType_sourceId: { projectId: PROJECT_ID, sourceType: "suggestion", sourceId: "sug_signal_12345" } }
    }));
    expect(result.item?.owner).toMatchObject({ userId: ACTOR.userId, displayName: "Karthik" });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "truth_inbox.assign_owner" }));
  });

  it("returns the persisted minor-action item without rebuilding its snapshot", async () => {
    const { service } = harness();
    (service as any).clearCache(PROJECT_ID);
    const buildSnapshot = vi.spyOn(service as any, "buildSnapshot");

    const result = await service.act(PROJECT_ID, "suggestion:sug_signal_12345", "assign_owner", ACTOR, { assignedUserId: ACTOR.userId });

    expect(result.item?.owner).toMatchObject({ userId: ACTOR.userId, displayName: "Karthik" });
    expect(result.summaryDelta).toEqual({ active: 0, critical: 0, awaitingDecision: 0, assignedToMe: 1 });
    expect(buildSnapshot).toHaveBeenCalledTimes(1);
  });

  it("delegates truth acceptance to the existing authorized proposal contract", async () => {
    const { service, changeProposalService, states } = harness();
    const result = await service.act(PROJECT_ID, `proposal:${PROPOSAL_ID}`, "accept", ACTOR, {});
    expect(changeProposalService.accept).toHaveBeenCalledWith(PROJECT_ID, PROPOSAL_ID, ACTOR.userId);
    expect(states[0]).toMatchObject({ sourceType: "proposal", sourceId: PROPOSAL_ID, status: "resolved", lastActionType: "accept" });
    expect(result.item).toBeNull();
  });

  it("does not offer acceptance for evidence-free proposals", async () => {
    const { service, prisma } = harness();
    prisma.specChangeProposal.findMany.mockResolvedValueOnce([{
      id: PROPOSAL_ID,
      title: "Unproven change",
      summary: "No source evidence",
      proposalType: "clarification",
      status: "needs_review",
      impactSummaryJson: {},
      externalEvidenceRefsJson: [],
      links: [],
      decisionRecord: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
    const response = await service.list(PROJECT_ID, ACTOR, { limit: 10, refresh: true } as any);
    const proposal = response.items.find((item) => item.sourceType === "proposal");
    expect(proposal?.capabilities.accept).toBe(false);
    expect(proposal?.limitations.join(" ")).toContain("no resolvable evidence");
  });
});
