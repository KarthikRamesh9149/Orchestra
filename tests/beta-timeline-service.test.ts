import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { clearAggregateCachesForTests } from "../src/lib/dashboard/aggregate-cache.js";
import { BetaTimelineService } from "../src/modules/beta-timeline/beta-timeline.service.js";
import { timelineQuerySchema } from "../src/modules/beta-timeline/schemas.js";

const now = new Date("2026-05-30T10:00:00.000Z");

function createService(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    project: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
    },
    projectEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn()
    },
    communicationMessage: {
      findMany: vi.fn().mockResolvedValue([])
    },
    socratesMessage: {
      findMany: vi.fn().mockResolvedValue([])
    },
    gitHubEngineeringEvidence: {
      findMany: vi.fn().mockResolvedValue([])
    },
    projectEditorConnector: {
      findMany: vi.fn().mockResolvedValue([])
    },
    document: {
      findMany: vi.fn().mockResolvedValue([])
    },
    specChangeProposal: {
      findMany: vi.fn().mockResolvedValue([])
    },
    liveDocSectionRevision: {
      findMany: vi.fn().mockResolvedValue([])
    },
    ...overrides
  } as any;
  const projectService = {
    ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager", isActive: true }),
    ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ projectRole: "manager", isActive: true })
  } as any;
  const auditService = {
    record: vi.fn().mockResolvedValue(undefined)
  } as any;
  return {
    prisma,
    projectService,
    auditService,
    service: new BetaTimelineService(prisma, projectService, auditService)
  };
}

describe("BetaTimelineService", () => {
  beforeEach(() => {
    clearAggregateCachesForTests();
  });

  it("aggregates real project sources and orders newest first without fake rows", async () => {
    const { prisma, service } = createService();
    prisma.projectEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        title: "Manual launch note",
        description: "Ship candidate opened",
        eventType: "milestone",
        startsAt: new Date("2026-05-30T09:00:00.000Z"),
        createdAt: now,
        linkedRefType: null,
        linkedRefId: null,
        creator: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" }
      }
    ]);
    prisma.communicationMessage.findMany.mockResolvedValue([
      {
        id: "msg-teams-1",
        threadId: "thread-teams-1",
        provider: "microsoft_teams",
        senderLabel: "Priya",
        bodyText: "Teams channel says the release walkthrough needs approval before launch.",
        sentAt: new Date("2026-05-30T08:45:00.000Z"),
        thread: { subject: "Launch channel", threadUrl: null },
        connector: { accountLabel: "Orchestra Teams" }
      },
      {
        id: "msg-1",
        threadId: "thread-1",
        provider: "clickup",
        senderLabel: "Adi",
        bodyText: "ClickUp task says Timeline UI copy is ready",
        sentAt: new Date("2026-05-30T08:00:00.000Z"),
        thread: { subject: "Frontend task", threadUrl: null },
        connector: { accountLabel: "Orchestra ClickUp" }
      },
      {
        id: "msg-zoho-1",
        threadId: "thread-zoho-1",
        provider: "zoho_crm",
        senderLabel: "Zoho CRM",
        bodyText: "Zoho CRM Deals evidence says Enterprise pilot is blocked on security review.",
        sentAt: new Date("2026-05-30T08:30:00.000Z"),
        thread: { subject: "Enterprise pilot", threadUrl: null },
        connector: { accountLabel: "Orchestra Zoho CRM" }
      }
    ]);
    prisma.socratesMessage.findMany.mockResolvedValue([
      {
        id: "soc-1",
        sessionId: "session-1",
        content: "What changed this week?",
        createdAt: new Date("2026-05-30T07:00:00.000Z"),
        session: { user: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" } }
      }
    ]);
    prisma.projectEditorConnector.findMany.mockResolvedValue([
      {
        id: "vscode-1",
        label: "Karthik VS Code",
        status: "connected",
        lastUsedAt: new Date("2026-05-30T06:00:00.000Z"),
        updatedAt: new Date("2026-05-30T06:00:00.000Z"),
        createdAt: new Date("2026-05-29T06:00:00.000Z"),
        user: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" }
      }
    ]);
    prisma.document.findMany.mockResolvedValue([
      {
        id: "doc-1",
        title: "MVP PRD",
        kind: "prd",
        currentVersionId: "version-1",
        createdAt: new Date("2026-05-30T05:00:00.000Z"),
        uploader: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" },
        versions: [{ id: "version-1", status: "ready" }]
      }
    ]);
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue([
      {
        id: "gh-1",
        evidenceType: "github_commit",
        title: "Implement route",
        summary: "Commit evidence",
        repositoryOwner: "KarthikRamesh9149",
        repositoryName: "orchestrav2",
        sha: "abc123",
        providerId: "abc123",
        branch: "mvp-v1",
        openTargetJson: {},
        occurredAt: new Date("2026-05-30T04:00:00.000Z"),
        createdAt: new Date("2026-05-30T04:00:00.000Z"),
        mappedUser: null,
        actorGithubLogin: "karthik"
      }
    ]);
    prisma.specChangeProposal.findMany.mockResolvedValue([
      {
        id: "proposal-1",
        title: "Clarify login copy",
        summary: "Slack-derived change needs review",
        proposalType: "clarification",
        status: "needs_review",
        sourceMessageCount: 1,
        oldUnderstandingJson: { text: "Old" },
        newUnderstandingJson: { text: "New" },
        createdAt: new Date("2026-05-30T03:00:00.000Z"),
        updatedAt: new Date("2026-05-30T03:00:00.000Z"),
        acceptedAt: null,
        accepter: null,
        links: [
          { linkType: "message", linkRefId: "msg-1" },
          { linkType: "document_section", linkRefId: "section-1" }
        ]
      }
    ]);
    prisma.liveDocSectionRevision.findMany.mockResolvedValue([
      {
        id: "revision-1",
        proposalId: "proposal-2",
        eventType: "proposal_accepted",
        sectionKey: "doc:section-2",
        documentSectionId: "section-2",
        sourceDocumentId: "doc-1",
        previousContent: "Old text",
        nextContent: "New text",
        changeSummary: "Accepted update",
        createdAt: new Date("2026-05-30T02:00:00.000Z"),
        actor: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" },
        proposal: {
          id: "proposal-2",
          title: "Accepted update",
          summary: "Accepted from review",
          acceptedAt: new Date("2026-05-30T02:00:00.000Z"),
          accepter: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" },
          links: []
        }
      }
    ]);

    const result = await service.listTimeline("project-1", "user-1", { view: "detailed", limit: 20 });

    expect(result.items.map((item) => item.source)).toEqual([
      "manual",
      "microsoft_teams",
      "zoho_crm",
      "clickup",
      "socrates",
      "vscode",
      "document",
      "github",
      "approval",
      "approval"
    ]);
    expect(result.items.find((item) => item.source === "zoho_crm")).toMatchObject({
      title: "Enterprise pilot",
      metadataSummary: "Zoho CRM account: Orchestra Zoho CRM"
    });
    expect(result.items.find((item) => item.source === "microsoft_teams")).toMatchObject({
      title: "Launch channel",
      metadataSummary: "Microsoft Teams account: Orchestra Teams"
    });
    expect(result.items.find((item) => item.proposalId === "proposal-1")?.status).toBe("pending");
    expect(result.items.find((item) => item.id === "livedoc:revision-1")?.status).toBe("accepted");
    expect(JSON.stringify(result.items)).not.toMatch(/mock|sample|demo/i);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "project-1", archivedAt: null } })
    );
  });

  it("accepts every provider-derived timeline filter without relabeling it as manual", () => {
    for (const source of ["zoho_mail", "zoho_cliq", "zoho_crm"] as const) {
      expect(timelineQuerySchema.parse({ source }).source).toBe(source);
    }
  });

  it("stores provider source hints as manual references and records an audit event", async () => {
    const { prisma, auditService, service } = createService();
    prisma.projectEvent.create.mockResolvedValue({
      id: "event-1",
      title: "Reference GitHub discussion",
      description: "Manual note",
      eventType: "other",
      startsAt: now,
      createdAt: now,
      linkedRefType: "manual_github_reference",
      linkedRefId: "abc123",
      creator: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" }
    });

    const event = await service.createManualEvent("project-1", "user-1", {
      title: "Reference GitHub discussion",
      description: "Manual note",
      source: "github",
      sourceRef: "abc123",
      tier: "atomic"
    });

    expect(prisma.projectEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "manual",
          linkedRefType: "manual_github_reference",
          linkedRefId: "abc123"
        })
      })
    );
    expect(event.source).toBe("manual");
    expect(event.metadataSummary).toContain("not provider-originated");
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "project_timeline_event_created",
        payload: expect.objectContaining({ spoofingPolicy: "stored_as_manual_reference" })
      })
    );
  });

  it("keeps communication evidence visible in all-source timeline even when newer GitHub rows dominate the limit", async () => {
    const { prisma, service } = createService();
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `gh-${index}`,
        evidenceType: "github_commit",
        title: `Commit ${index}`,
        summary: "GitHub evidence",
        repositoryOwner: "KarthikRamesh9149",
        repositoryName: "orchestrav2",
        sha: `sha-${index}`,
        providerId: `sha-${index}`,
        branch: "mvp-beta-beta",
        openTargetJson: {},
        occurredAt: new Date(`2026-05-30T09:${String(59 - index).padStart(2, "0")}:00.000Z`),
        createdAt: new Date(`2026-05-30T09:${String(59 - index).padStart(2, "0")}:00.000Z`),
        mappedUser: null,
        actorGithubLogin: "karthik"
      }))
    );
    prisma.communicationMessage.findMany.mockResolvedValue([
      {
        id: "slack-1",
        threadId: "thread-slack",
        provider: "slack",
        senderLabel: "Sarah PM",
        bodyText: "Slack says GitHub and PRD evidence should be combined.",
        sentAt: new Date("2026-05-30T08:00:00.000Z"),
        thread: { subject: "Release readiness", threadUrl: null },
        connector: { accountLabel: "Slack workspace" }
      },
      {
        id: "clickup-1",
        threadId: "thread-clickup",
        provider: "clickup",
        senderLabel: "Maya QA",
        bodyText: "ClickUp acceptance criteria require PM Watchtower visibility.",
        sentAt: new Date("2026-05-30T07:59:00.000Z"),
        thread: { subject: "CU-142", threadUrl: null },
        connector: { accountLabel: "ClickUp workspace" }
      }
    ]);

    const result = await service.listTimeline("project-1", "user-1", { view: "summary", limit: 5 });

    expect(result.items).toHaveLength(5);
    expect(result.items.some((item) => item.source === "slack")).toBe(true);
    expect(result.items.some((item) => item.source === "clickup")).toBe(true);
  });

  it("denies client manual timeline event creation", async () => {
    const { projectService, service } = createService();
    projectService.ensureProjectAccess.mockResolvedValue({ projectRole: "client", isActive: true });

    await expect(
      service.createManualEvent("project-1", "client-1", {
        title: "Client note",
        source: "manual",
        tier: "atomic"
      })
    ).rejects.toMatchObject(new AppError(403, "Manager or developer access required", "timeline_event_create_denied"));
  });

  it("denies project-role clients from internal timeline reads", async () => {
    const { prisma, projectService, service } = createService();
    projectService.ensureProjectMemberCanUseSocrates.mockRejectedValue(
      new AppError(403, "Project access denied", "project_access_denied")
    );

    await expect(service.listTimeline("project-1", "client-1", { view: "summary", limit: 5 })).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    expect(prisma.projectEvent.findMany).not.toHaveBeenCalled();
  });

  it("serves repeated timeline reads from the aggregate cache after access is checked", async () => {
    const { prisma, projectService, service } = createService();
    prisma.projectEvent.findMany.mockResolvedValue([
      {
        id: "event-1",
        title: "Cached timeline note",
        description: null,
        eventType: "other",
        startsAt: now,
        createdAt: now,
        linkedRefType: null,
        linkedRefId: null,
        creator: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" }
      }
    ]);

    await service.listTimeline("project-1", "user-1", { view: "summary", limit: 5 });
    await service.listTimeline("project-1", "user-1", { view: "summary", limit: 5 });

    expect(projectService.ensureProjectMemberCanUseSocrates).toHaveBeenCalledTimes(2);
    expect(prisma.projectEvent.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.communicationMessage.findMany).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached timeline aggregates after creating a manual event", async () => {
    const { prisma, service } = createService();
    prisma.projectEvent.create.mockResolvedValue({
      id: "event-2",
      title: "New manual decision",
      description: null,
      eventType: "other",
      startsAt: now,
      createdAt: now,
      linkedRefType: null,
      linkedRefId: null,
      creator: { id: "user-1", displayName: "Karthik Ramesh", email: "k@example.com", workspaceRoleDefault: "manager" }
    });

    await service.listTimeline("project-1", "user-1", { view: "summary", limit: 5 });
    await service.createManualEvent("project-1", "user-1", {
      title: "New manual decision",
      source: "manual",
      tier: "atomic"
    });
    await service.listTimeline("project-1", "user-1", { view: "summary", limit: 5 });

    expect(prisma.projectEvent.findMany).toHaveBeenCalledTimes(2);
  });
});
