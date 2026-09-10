import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { SuggestionsService } from "../src/modules/suggestions/suggestions.service.js";

describe("SuggestionsService", () => {
  it("surfaces selected Notion document evidence in Watchtower without fake pages", async () => {
    const notionResource = {
      id: "notion-resource-1",
      projectId: "project-1",
      providerResourceId: "notion-page-1",
      resourceType: "page",
      title: "Launch scope notes",
      url: "https://www.notion.so/launch-scope-notes",
      indexStatus: "indexed",
      documentId: "doc-notion-1",
      documentVersionId: "version-notion-1",
      lastEditedAt: new Date("2026-06-01T09:00:00.000Z"),
      lastIndexedAt: new Date("2026-06-01T09:05:00.000Z"),
      updatedAt: new Date("2026-06-01T09:05:00.000Z")
    };
    const notionSection = {
      id: "section-notion-1",
      projectId: "project-1",
      documentVersionId: "version-notion-1",
      title: "Approval notes",
      text: "Design team requested scope review and approval before changing onboarding copy.",
      anchorId: "approval-notes",
      createdAt: new Date("2026-06-01T09:06:00.000Z"),
      updatedAt: new Date("2026-06-01T09:06:00.000Z")
    };
    const prisma = {
      project: {
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      messageInsight: {
        findMany: vi.fn().mockResolvedValue([])
      },
      threadInsight: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectEvent: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectCalendarConnection: {
        findMany: vi.fn().mockResolvedValue([])
      },
      document: {
        count: vi.fn().mockResolvedValue(1)
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([notionSection])
      },
      projectDriveConnection: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectDriveFile: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectNotionResource: {
        findMany: vi.fn().mockResolvedValue([notionResource])
      },
      projectDriveSyncRun: {
        findMany: vi.fn().mockResolvedValue([])
      },
      socratesMessage: {
        findMany: vi.fn().mockResolvedValue([])
      },
      gitHubRepositoryProjectLink: {
        findMany: vi.fn().mockResolvedValue([])
      },
      gitHubSyncRun: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectEditorConnector: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectResponsibility: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectSuggestionAction: {
        findMany: vi.fn().mockResolvedValue([])
      },
      gitHubEngineeringEvidence: {
        findMany: vi.fn().mockResolvedValue([])
      }
    };
    const service = new SuggestionsService(
      prisma as any,
      { ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      {} as any,
      {} as any
    );

    const response = await service.list("project-1", { userId: "manager-1", orgId: "org-1" }, { limit: 20, offset: 0, refresh: true } as any);

    expect(response.sourceStates.notion).toMatchObject({ state: "ready", label: "Notion" });
    const notionSuggestion = response.items.find((item) => item.detectorKey === "notion_doc_review_signal");
    expect(notionSuggestion).toBeTruthy();
    expect(notionSuggestion?.sourceRefs[0]).toMatchObject({
      type: "notion_document",
      id: "section-notion-1",
      label: "Launch scope notes"
    });
    expect(notionSuggestion?.evidence[0].openTarget).toMatchObject({
      targetType: "document_section",
      targetRef: {
        documentId: "doc-notion-1",
        documentVersionId: "version-notion-1",
        sectionId: "section-notion-1",
        notionResourceId: "notion-resource-1"
      }
    });
    expect(prisma.projectNotionResource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1" },
        take: 80
      })
    );
  });

  it("surfaces Microsoft Teams insights as native communication evidence", async () => {
    const teamsInsight = {
      id: "teams-insight-1",
      projectId: "project-1",
      provider: "microsoft_teams",
      insightType: "requirement_change",
      summary: "Teams thread says onboarding approval needs a manager checkpoint before launch.",
      confidence: 0.84,
      messageId: "teams-message-1",
      threadId: "teams-thread-1",
      createdAt: new Date("2026-06-01T10:00:00.000Z")
    };
    const prisma = {
      project: {
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      messageInsight: {
        findMany: vi.fn().mockResolvedValue([teamsInsight])
      },
      threadInsight: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectEvent: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectCalendarConnection: {
        findMany: vi.fn().mockResolvedValue([])
      },
      document: {
        count: vi.fn().mockResolvedValue(0)
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([])
      },
      projectDriveConnection: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectDriveFile: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectNotionResource: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectDriveSyncRun: {
        findMany: vi.fn().mockResolvedValue([])
      },
      socratesMessage: {
        findMany: vi.fn().mockResolvedValue([])
      },
      gitHubRepositoryProjectLink: {
        findMany: vi.fn().mockResolvedValue([])
      },
      gitHubSyncRun: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectEditorConnector: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectResponsibility: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectSuggestionAction: {
        findMany: vi.fn().mockResolvedValue([])
      },
      gitHubEngineeringEvidence: {
        findMany: vi.fn().mockResolvedValue([])
      }
    };
    const service = new SuggestionsService(
      prisma as any,
      { ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      {} as any,
      {} as any
    );

    const response = await service.list("project-1", { userId: "manager-1", orgId: "org-1" }, { limit: 20, offset: 0, refresh: true } as any);

    expect(response.sourceStates.microsoft_teams).toMatchObject({ state: "ready", label: "Microsoft Teams" });
    expect(response.sourceStates.slack).toMatchObject({ state: "empty", label: "Slack" });
    const teamsSuggestion = response.items.find((item) => item.detectorKey === "microsoft_teams_spec_drift");
    expect(teamsSuggestion).toBeTruthy();
    expect(teamsSuggestion?.title).toContain("Microsoft Teams evidence needs review");
    expect(teamsSuggestion?.sourceRefs[0]).toMatchObject({
      type: "microsoft_teams_message",
      id: "teams-insight-1"
    });
    expect(teamsSuggestion?.evidence[0].openTarget).toMatchObject({
      targetType: "message_insight",
      targetRef: {
        provider: "microsoft_teams",
        messageId: "teams-message-1",
        threadId: "teams-thread-1"
      }
    });
  });

  it("denies project-role clients from internal Watchtower reads and Socrates follow-up", async () => {
    const projectService = {
      ensureProjectMemberCanUseSocrates: vi
        .fn()
        .mockRejectedValue(new AppError(403, "Project access denied", "project_access_denied"))
    };
    const service = new SuggestionsService(
      {} as any,
      projectService as any,
      { record: vi.fn() } as any,
      {} as any,
      {} as any
    );

    await expect(
      service.list("project-1", { userId: "client-1", orgId: "org-1" }, { limit: 50, offset: 0 } as any)
    ).rejects.toMatchObject({ statusCode: 403, code: "project_access_denied" });
    await expect(
      service.askSocrates("project-1", "suggestion-1", { userId: "client-1", orgId: "org-1" })
    ).rejects.toMatchObject({ statusCode: 403, code: "project_access_denied" });
  });
});
