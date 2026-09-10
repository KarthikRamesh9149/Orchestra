import { describe, expect, it, vi } from "vitest";
import { TruthChangePacketService } from "../src/modules/truth-inbox/truth-change-packet.service.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = { userId: "22222222-2222-4222-8222-222222222222", orgId: "33333333-3333-4333-8333-333333333333" };

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "proposal:44444444-4444-4444-8444-444444444444",
    projectId: PROJECT_ID,
    sourceType: "proposal",
    sourceId: "44444444-4444-4444-8444-444444444444",
    sourceFingerprint: "proposal:fingerprint",
    category: "spec_drift",
    title: "Google login before launch",
    description: "New communication may change accepted authentication scope.",
    severity: "critical",
    confidence: 0.94,
    status: "active",
    sourceLabels: ["message", "brain_node", "document_section"],
    evidence: [],
    limitations: [],
    owner: { userId: ACTOR.userId, displayName: "Karthik", email: "k@example.com" },
    clarification: null,
    deferredUntil: null,
    snoozedUntil: null,
    timelineEventRef: null,
    reviewProposalId: null,
    capabilities: {
      ask_socrates: true,
      assign_owner: true,
      request_clarification: true,
      create_review_item: false,
      accept: true,
      reject: true,
      defer: true,
      snooze: true,
      dismiss: false,
      promote_to_timeline: true
    },
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ...overrides
  };
}

function proposal() {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    projectId: PROJECT_ID,
    title: "Google login before launch",
    summary: "Add Google login before launch.",
    proposalType: "requirement_change",
    status: "needs_review",
    sourceMessageCount: 1,
    oldUnderstandingJson: { authentication: "Email and password only" },
    newUnderstandingJson: { authentication: "Google login is required" },
    impactSummaryJson: { scopeImpact: "high", engineeringImpact: "high", summary: "Authentication and onboarding change." },
    externalEvidenceRefsJson: [],
    acceptedBrainVersionId: null,
    decisionRecordId: null,
    acceptedBy: null,
    acceptedAt: null,
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-23T00:00:00.000Z"),
    decisionRecord: null,
    links: [
      { id: "link-1", specChangeProposalId: "44444444-4444-4444-8444-444444444444", projectId: PROJECT_ID, linkType: "message", linkRefId: "55555555-5555-4555-8555-555555555555", relationship: "source", createdAt: new Date() },
      { id: "link-2", specChangeProposalId: "44444444-4444-4444-8444-444444444444", projectId: PROJECT_ID, linkType: "thread", linkRefId: "66666666-6666-4666-8666-666666666666", relationship: "evidence", createdAt: new Date() },
      { id: "link-3", specChangeProposalId: "44444444-4444-4444-8444-444444444444", projectId: PROJECT_ID, linkType: "document_section", linkRefId: "77777777-7777-4777-8777-777777777777", relationship: "affected", createdAt: new Date() },
      { id: "link-4", specChangeProposalId: "44444444-4444-4444-8444-444444444444", projectId: PROJECT_ID, linkType: "brain_node", linkRefId: "88888888-8888-4888-8888-888888888888", relationship: "affected", createdAt: new Date() }
    ]
  };
}

function harness(input: { inboxItem?: ReturnType<typeof item>; proposalRow?: ReturnType<typeof proposal> | null; acceptedNode?: boolean } = {}) {
  const inbox = { get: vi.fn(async () => input.inboxItem ?? item()) };
  const proposalRow = input.proposalRow === undefined ? proposal() : input.proposalRow;
  const prisma = {
    specChangeProposal: { findFirst: vi.fn(async () => proposalRow) },
    communicationMessage: { findMany: vi.fn(async () => [{
      id: "55555555-5555-4555-8555-555555555555",
      provider: "microsoft_teams",
      providerPermalink: "https://teams.example/message",
      senderLabel: "Client",
      sentAt: new Date("2026-08-23T00:00:00.000Z"),
      bodyText: "Google login must be included before launch.",
      threadId: "66666666-6666-4666-8666-666666666666",
      thread: { subject: "Launch scope" }
    }]) },
    communicationThread: { findMany: vi.fn(async () => [{ id: "66666666-6666-4666-8666-666666666666", provider: "microsoft_teams", subject: "Launch scope", threadUrl: "https://teams.example/thread", lastMessageAt: new Date("2026-08-23T00:00:00.000Z") }]) },
    documentSection: { findMany: vi.fn(async () => [{
      id: "77777777-7777-4777-8777-777777777777",
      anchorId: "authentication",
      headingPath: ["Authentication"],
      normalizedText: "Users sign in with email and password.",
      pageNumber: 4,
      documentVersion: { id: "version-1", status: "ready", document: { id: "document-1", title: "Launch PRD", currentVersionId: "version-1" } }
    }]) },
    brainNode: { findMany: vi.fn(async () => [{
      id: "88888888-8888-4888-8888-888888888888",
      nodeType: "flow",
      title: "Authentication",
      summary: "Email and password login.",
      status: "active",
      artifactVersionId: "brain-version-1",
      artifactVersion: { artifactType: "brain_graph", status: input.acceptedNode === false ? "draft" : "accepted", acceptedAt: new Date("2026-08-20T00:00:00.000Z") }
    }]) }
  };
  const impactMap = {
    buildForProposal: vi.fn(async () => ({ proposalId: proposalRow?.id ?? null, status: "partial", groups: [], summary: { mappedGroups: 0, totalGroups: 13, mappedItems: 0, verifiedItems: 0, recordedItems: 0 }, generatedAt: new Date().toISOString(), limitations: [] })),
    reviewOnly: vi.fn(() => ({ proposalId: null, status: "review_only", groups: [], summary: { mappedGroups: 0, totalGroups: 13, mappedItems: 0, verifiedItems: 0, recordedItems: 0 }, generatedAt: new Date().toISOString(), limitations: [] }))
  };
  return { service: new TruthChangePacketService(prisma as any, inbox as any, impactMap as any), prisma, inbox, impactMap };
}

describe("TruthChangePacketService", () => {
  it("builds a decision-ready packet only from exact evidence and accepted truth links", async () => {
    const { service, prisma, inbox, impactMap } = harness();
    const packet = await service.get(PROJECT_ID, item().id, ACTOR);

    expect(inbox.get).toHaveBeenCalledWith(PROJECT_ID, item().id, ACTOR);
    expect(prisma.specChangeProposal.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: item().sourceId, projectId: PROJECT_ID } }));
    expect(packet.readiness).toBe("decision_ready");
    expect(packet.newEvidence.map((evidence) => evidence.id)).toEqual(expect.arrayContaining([
      "message:55555555-5555-4555-8555-555555555555",
      "thread:66666666-6666-4666-8666-666666666666"
    ]));
    expect(packet.currentAcceptedTruth).toEqual([expect.objectContaining({ id: "88888888-8888-4888-8888-888888888888", authority: "accepted_truth" })]);
    expect(packet.potentialConflict?.interpretationOnly).toBe(true);
    expect(packet.proposedChange?.statements).toContain("Authentication: Google login is required");
    expect(packet.decision.options).toContain("accept");
    expect(packet.boundaries.at(-1)).toMatchObject({ stage: "accepted_truth", state: "unchanged" });
    expect(packet.impactMap.proposalId).toBe(proposal().id);
    expect(impactMap.buildForProposal).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      item: expect.objectContaining({ id: item().id }),
      proposal: expect.objectContaining({ id: proposal().id })
    }));
  });

  it("blocks acceptance when an affected node is not accepted truth", async () => {
    const { service } = harness({ acceptedNode: false });
    const packet = await service.get(PROJECT_ID, item().id, ACTOR);
    expect(packet.readiness).toBe("needs_context");
    expect(packet.currentAcceptedTruth).toEqual([]);
    expect(packet.decision.options).not.toContain("accept");
    expect(packet.decision.blockers).toContain("No linked accepted Product Brain node or accepted decision was resolved.");
  });

  it("keeps non-proposal Inbox signals review-only without querying proposal data", async () => {
    const signal = item({ sourceType: "fde", sourceId: "finding-1", id: "fde:finding-1", capabilities: { ...item().capabilities, accept: false, reject: false, create_review_item: true } });
    const { service, prisma, impactMap } = harness({ inboxItem: signal as any });
    const packet = await service.get(PROJECT_ID, signal.id, ACTOR);
    expect(packet.packetKind).toBe("review_signal");
    expect(packet.readiness).toBe("review_only");
    expect(packet.proposedChange).toBeNull();
    expect(packet.currentAcceptedTruth).toEqual([]);
    expect(packet.impactMap.status).toBe("review_only");
    expect(impactMap.reviewOnly).toHaveBeenCalledOnce();
    expect(impactMap.buildForProposal).not.toHaveBeenCalled();
    expect(prisma.specChangeProposal.findFirst).not.toHaveBeenCalled();
  });
});
