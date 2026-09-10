import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAggregateCachesForTests } from "../src/lib/dashboard/aggregate-cache.js";
import { DashboardService } from "../src/modules/dashboard/service.js";

function missionControlFixture(overrides: Record<string, unknown> = {}) {
  return {
    stats: [
      {
        id: "active-now",
        label: "Active now",
        value: "1 / 1",
        numericValue: 1,
        state: "ready",
        source: "team"
      }
    ],
    team: [],
    teamSummary: { totalActive: 1, managers: 1, devs: 0, clients: 0, approvers: 1, inactive: 0 },
    recentChanges: [],
    calendarEvents: [],
    slackMessages: [],
    gitCommits: [],
    githubPreview: {
      state: "not_connected",
      repositoryLabel: null,
      lastSyncedAt: null,
      openPrs: null,
      commitsThisWeek: null
    },
    googleDrivePreview: {
      state: "not_connected",
      accountLabel: null,
      indexedFileCount: 0,
      failedFileCount: 0,
      skippedFileCount: 0,
      lastSyncedAt: null,
      lastError: null,
      recentFiles: []
    },
    activity: [],
    socratesQueries: [],
    subscriptions: [],
    subscriptionSummary: {
      monthlyTotalCents: 0,
      currency: "USD",
      activeCount: 0,
      usageBasedCount: 0,
      renewalCount: 0
    },
    featureStates: {
      missionControl: "ready",
      github: "not_connected",
      googleDrive: "not_connected",
      slack: "not_connected",
      subscriptions: "empty",
      calendar: "empty",
      activity: "empty",
      socrates: "empty"
    },
    updatedAt: "2026-05-30T10:00:00.000Z",
    ...overrides
  };
}

describe("DashboardService", () => {
  beforeEach(() => {
    clearAggregateCachesForTests();
  });

  it("builds a minimal general dashboard snapshot with attention and freshness summaries", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-general-1",
      computedAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "org-1",
          name: "Acme",
          slug: "acme"
        })
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "user-1" }),
        findMany: vi.fn().mockResolvedValue([
          { id: "user-1", displayName: "Manager", workspaceRoleDefault: "manager" },
          { id: "user-2", displayName: "Dev", workspaceRoleDefault: "dev" }
        ])
      },
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "Apollo",
            slug: "apollo",
            status: "active",
            members: [
              {
                id: "pm-1",
                projectRole: "manager",
                roleInProject: "Lead",
                allocationPercent: 40,
                weeklyCapacityHours: 20,
                user: { id: "user-1", displayName: "Manager", workspaceRoleDefault: "manager", isActive: true }
              },
              {
                id: "pm-2",
                projectRole: "dev",
                roleInProject: "Backend",
                allocationPercent: 120,
                weeklyCapacityHours: 40,
                user: { id: "user-2", displayName: "Dev", workspaceRoleDefault: "dev", isActive: true }
              }
            ],
            documents: [
              {
                id: "doc-1",
                title: "PRD",
                currentVersionId: "ver-1",
                versions: [{ id: "ver-1", status: "failed", createdAt: new Date(), processedAt: null }]
              }
            ],
            changeProposals: [{ id: "proposal-1", title: "Change", summary: "Needs review", status: "needs_review", acceptedAt: null }],
            decisions: [{ id: "decision-1", title: "Decision", status: "open", acceptedAt: null }],
            artifacts: [],
            communicationConnectors: [],
            messageInsights: []
          }
        ])
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getGeneralDashboard({
      orgId: "org-1",
      actorUserId: "user-1",
      forceRefresh: true
    });

    expect(payload.summary.activeProjectCount).toBe(1);
    expect(payload.summary.orgHeadcount).toBe(2);
    expect(payload.summary.projectsNeedingAttention[0].attention.label).toBe("attention");
    expect(payload.summary.overloadedMembers[0]).toMatchObject({
      userId: "user-2",
      workloadLabel: "overloaded"
    });
    expect(payload.summary.brainFreshness.blocked).toBe(1);
    expect(snapshotCreate).toHaveBeenCalled();
  });

  it("returns a fresh project snapshot without rebuilding and blocks client dashboard access", async () => {
    const snapshot = {
      id: "snap-project-1",
      computedAt: new Date(),
      payloadJson: {
        scope: "project",
        computedAt: new Date().toISOString(),
        project: { id: "project-1", orgId: "org-1", name: "Apollo", slug: "apollo", status: "active", description: null, previewUrl: null, memberCount: 1, documentCount: 1 },
        teamSummary: { headcount: 1, roleBreakdown: { dev: 1 }, members: [], workload: { label: "healthy", overloadedCount: 0, watchCount: 0, unknownCount: 0 } },
        documents: { totalCount: 1, readinessState: "ready", counts: { pending: 0, processing: 0, ready: 1, partial: 0, failed: 0 }, latestProcessedAt: null, documents: [] },
        brain: { freshnessState: "current", latestVersionId: "brain-1", latestVersionNumber: 2, acceptedAt: null, latestAcceptedChangeAt: null, latestAcceptedDecisionAt: null },
        changes: { pendingCount: 0, acceptedRecentCount: 0, latestAcceptedAt: null, pendingSummaries: [], recentAccepted: [] },
        decisions: { openCount: 0, latestAcceptedAt: null, openItems: [] },
        communication: { connectedProviders: [], providerCount: 0, lastSyncedAt: null, insightCount: 0, needsReviewCount: 0, blockerCount: 0, contradictionCount: 0, connectorStatuses: [] },
        attention: { score: 0, label: "healthy", reasons: [] },
        quickLinks: { dashboardPath: "", brainPath: "", documentsPath: "", docViewerPath: null, docViewerState: null, brainViewerState: { pageContext: "brain_overview", selectedRefType: "dashboard_scope", selectedRefId: "project-1" } },
        recentActivity: { latestAcceptedChangeAt: null, latestDecisionAt: null, latestDocumentProcessedAt: null }
      }
    };
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(snapshot)
      }
    } as any;

    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi
          .fn()
          .mockResolvedValueOnce({ projectRole: "dev" })
          .mockResolvedValueOnce({ projectRole: "client" }),
        ensureProjectManager: vi.fn()
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getProjectDashboard("project-1", "dev-1");
    expect(payload.project.id).toBe("project-1");
    expect(prisma.dashboardSnapshot.findFirst).toHaveBeenCalled();

    await expect(service.getProjectDashboard("project-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "client_dashboard_access_forbidden"
    });
  });

  it("requires managers for service-level general dashboard access and explicit project force refresh", async () => {
    const freshSnapshot = {
      id: "snap-project-force",
      computedAt: new Date(),
      payloadJson: {
        scope: "project",
        computedAt: new Date().toISOString(),
        project: { id: "project-1", orgId: "org-1", name: "Apollo", slug: "apollo", status: "active", description: null, previewUrl: null, memberCount: 1, documentCount: 0 },
        teamSummary: { headcount: 1, roleBreakdown: { dev: 1 }, members: [], workload: { label: "healthy", overloadedCount: 0, watchCount: 0, unknownCount: 0 } },
        documents: { totalCount: 0, readinessState: "empty", counts: { pending: 0, processing: 0, ready: 0, partial: 0, failed: 0 }, latestProcessedAt: null, documents: [] },
        brain: { freshnessState: "blocked", latestVersionId: null, latestVersionNumber: null, acceptedAt: null, latestAcceptedChangeAt: null, latestAcceptedDecisionAt: null },
        changes: { pendingCount: 0, acceptedRecentCount: 0, latestAcceptedAt: null, pendingSummaries: [], recentAccepted: [] },
        decisions: { openCount: 0, latestAcceptedAt: null, openItems: [] },
        communication: { connectedProviders: [], providerCount: 0, lastSyncedAt: null, insightCount: 0, needsReviewCount: 0, blockerCount: 0, contradictionCount: 0, connectorStatuses: [] },
        attention: { score: 0, label: "healthy", reasons: [] },
        quickLinks: { dashboardPath: "", brainPath: "", documentsPath: "", docViewerPath: null, docViewerState: null, brainViewerState: { pageContext: "brain_overview", selectedRefType: "dashboard_scope", selectedRefId: "project-1" } },
        recentActivity: { latestAcceptedChangeAt: null, latestDecisionAt: null, latestDocumentProcessedAt: null }
      }
    };
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValueOnce(null)
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(freshSnapshot)
      }
    } as any;
    const projectService = {
      ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "dev" }),
      ensureProjectManager: vi.fn()
    };

    const service = new DashboardService(
      prisma,
      projectService as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.getGeneralDashboard({ orgId: "org-1", actorUserId: "dev-1" })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "manager_access_required"
    });

    await expect(
      service.getProjectDashboard("project-1", "dev-1", { forceRefresh: true })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "manager_access_required"
    });

    await expect(service.getProjectDashboard("project-1", "dev-1")).resolves.toMatchObject({
      project: { id: "project-1" }
    });
  });

  it("computes project attention from stale brain, pending changes, and processing docs", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-project-2",
      computedAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [
            {
              id: "pm-1",
              projectRole: "manager",
              roleInProject: "Lead",
              allocationPercent: 85,
              weeklyCapacityHours: 20,
              user: { id: "user-1", displayName: "Manager", workspaceRoleDefault: "manager" }
            }
          ],
          documents: [
            {
              id: "doc-1",
              title: "PRD",
              currentVersionId: "ver-1",
              versions: [{ id: "ver-1", status: "processing", createdAt: new Date(), processedAt: null }]
            }
          ],
          changeProposals: [{ id: "proposal-1", title: "Change", summary: "Pending", status: "needs_review", acceptedAt: null }],
          decisions: [{ id: "decision-1", title: "Decision", status: "open", acceptedAt: null }],
          artifacts: [
            {
              id: "brain-1",
              versionNumber: 1,
              acceptedAt: new Date("2026-03-01T00:00:00.000Z"),
              createdAt: new Date("2026-03-01T00:00:00.000Z")
            }
          ],
          communicationConnectors: [],
          messageInsights: []
        })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      }
    } as any;

    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });

    expect(payload.attention.label).toBe("attention");
    expect(payload.brain.freshnessState).toBe("processing");
    expect(payload.documents.readinessState).toBe("processing");
    expect(payload.teamSummary.workload.label).toBe("watch");
    expect(payload.quickLinks.brainViewerState.pageContext).toBe("brain_overview");
  });

  it("includes bounded responsibility summary in project dashboard snapshots", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-project-responsibilities",
      computedAt: new Date("2026-05-01T00:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [
            {
              id: "pm-1",
              projectRole: "dev",
              roleInProject: "Frontend",
              allocationPercent: 60,
              weeklyCapacityHours: 20,
              user: { id: "user-1", displayName: "Sara", workspaceRoleDefault: "dev" }
            }
          ],
          documents: [],
          changeProposals: [],
          decisions: [],
          artifacts: [],
          communicationConnectors: [],
          messageInsights: []
        })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      }
    } as any;
    const responsibilities = {
      activeCount: 2,
      blockedCount: 1,
      byArea: { frontend: 1, backend: 1 },
      byStatus: { open: 1, blocked: 1, done: 1 },
      memberHighlights: [
        {
          memberId: "pm-1",
          displayName: "Sara",
          activeCount: 2,
          blockedCount: 1,
          primaryAreas: ["frontend", "backend"]
        }
      ],
      quickLinks: { responsibilitiesPath: "/projects/project-1/responsibilities" }
    };
    const projectResponsibilitiesService = {
      buildProjectResponsibilitySummary: vi.fn().mockResolvedValue(responsibilities)
    };
    const manualContext = {
      totalCount: 3,
      highImportanceCount: 1,
      decisionNoteCount: 1,
      manualTranscriptCount: 1,
      imageContextCount: 1,
      chartContextCount: 1,
      screenshotContextCount: 0,
      latestContextAt: "2026-05-04T00:00:00.000Z",
      teamNoteCount: 1,
      taskNoteCount: 0,
      quickLinks: { contextPath: "/projects/project-1/context" }
    };
    const projectContextService = {
      buildContextSummary: vi.fn().mockResolvedValue(manualContext)
    };
    const engineering = {
      hasCodingRequirements: true,
      latestGeneratedAt: "2026-05-19T00:00:00.000Z",
      moduleCount: 4,
      unknownCount: 2,
      flowchartAvailable: true,
      quickLinks: {
        codingRequirementsPath: "/projects/project-1/coding-requirements",
        flowchartPath: "/projects/project-1/coding-requirements/flowchart"
      }
    };
    const codingRequirementsService = {
      buildEngineeringSummary: vi.fn().mockResolvedValue(engineering)
    };

    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      undefined,
      projectResponsibilitiesService as any,
      projectContextService as any,
      undefined,
      codingRequirementsService as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });

    expect(projectResponsibilitiesService.buildProjectResponsibilitySummary).toHaveBeenCalledWith("project-1");
    expect(projectContextService.buildContextSummary).toHaveBeenCalledWith("project-1");
    expect(codingRequirementsService.buildEngineeringSummary).toHaveBeenCalledWith("project-1");
    expect(payload.responsibilities).toEqual(responsibilities);
    expect(payload.manualContext).toEqual(manualContext);
    expect(payload.engineering).toEqual(engineering);
    expect(payload.teamSummary.responsibilities).toEqual(responsibilities);
    expect(payload.responsibilities.memberHighlights).toHaveLength(1);
    expect(JSON.stringify(payload.responsibilities)).not.toContain("passwordHash");
    expect(JSON.stringify(payload.manualContext)).not.toContain("Client PM said");
    expect(JSON.stringify(payload.engineering)).not.toContain("flowchart TD");
  });

  it("marks brain stale from accepted changes or decisions newer than the accepted brain", async () => {
    const olderAccepted = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const newerAccepted = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-project-stale-accepted",
      computedAt: new Date(),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [],
          documents: [
            {
              id: "doc-1",
              title: "PRD",
              currentVersionId: "ver-1",
              versions: [{ id: "ver-1", status: "ready", createdAt: olderAccepted, processedAt: olderAccepted }]
            }
          ],
          changeProposals: [
            { id: "proposal-old", title: "Old accepted", summary: null, status: "accepted", acceptedAt: olderAccepted },
            { id: "proposal-new", title: "New accepted", summary: null, status: "accepted", acceptedAt: newerAccepted }
          ],
          decisions: [
            { id: "decision-new", title: "New decision", status: "accepted", acceptedAt: newerAccepted }
          ],
          artifacts: [
            {
              id: "brain-1",
              versionNumber: 1,
              acceptedAt: olderAccepted,
              createdAt: olderAccepted
            }
          ],
          communicationConnectors: [],
          messageInsights: []
        })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      }
    } as any;

    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });

    expect(payload.brain.freshnessState).toBe("stale");
    expect(payload.changes.latestAcceptedAt).toBe(newerAccepted.toISOString());
    expect(payload.decisions.latestAcceptedAt).toBe(newerAccepted.toISOString());
    expect(payload.recentActivity.latestAcceptedChangeAt).toBe(newerAccepted.toISOString());
    expect(payload.recentActivity.latestDecisionAt).toBe(newerAccepted.toISOString());
  });

  it("includes project ops summaries without polluting core dashboard behavior", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-project-ops-1",
      computedAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [],
          documents: [],
          changeProposals: [],
          decisions: [],
          artifacts: [],
          communicationConnectors: [],
          messageInsights: []
        })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      }
    } as any;

    const projectOpsService = {
      buildProjectSummary: vi.fn().mockResolvedValue({
        meetings: {
          upcoming: [
            {
              id: "meeting-1",
              title: "Sprint planning",
              startsAt: "2026-04-20T09:00:00.000Z",
              endsAt: null,
              eventType: "meeting",
              projectId: "project-1",
              projectName: "Apollo",
              isAllDay: false,
              timezone: null,
              source: "manual",
              linkedRefType: null,
              linkedRefId: null
            }
          ],
          todayCount: 1,
          thisWeekCount: 2
        },
        deadlines: {
          upcoming: [
            {
              id: "deadline-1",
              title: "Client demo",
              description: null,
              projectId: "project-1",
              projectName: "Apollo",
              dueAt: "2026-04-21T00:00:00.000Z",
              status: "critical",
              linkedRefType: null,
              linkedRefId: null,
              completedAt: null,
              daysLeft: -1
            }
          ],
          urgentCount: 1,
          criticalCount: 1,
          completedCount: 0
        },
        financials: {
          projectId: "project-1",
          currency: "USD",
          budgetAmount: 1000,
          spentAmount: 1250,
          remainingAmount: -250,
          notes: null,
          updatedAt: "2026-04-19T00:00:00.000Z"
        },
        subscriptions: {
          activeCount: 1,
          monthlyCost: 200,
          annualCost: 0,
          items: [
            {
              id: "sub-1",
              name: "AWS",
              category: "Infrastructure",
              cost: 200,
              billingType: "monthly",
              status: "active",
              provider: "AWS",
              renewsAt: null
            }
          ]
        }
      })
    } as any;

    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      projectOpsService
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });

    expect(payload.meetings.todayCount).toBe(1);
    expect(payload.deadlines.criticalCount).toBe(1);
    expect(payload.financials?.remainingAmount).toBe(-250);
    expect(payload.subscriptions?.activeCount).toBe(1);
    expect(payload.attention.label).toBe("watch");
  });

  it("uses the MVP dashboard profile for manual/Fireflies communications, simple calendar, and hidden ops finance", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [],
          documents: [],
          changeProposals: [],
          decisions: [],
          artifacts: [],
          communicationConnectors: [
            { id: "connector-manual", provider: "manual_import", status: "connected", lastSyncedAt: null, lastError: null },
            { id: "connector-fireflies", provider: "fireflies_ai", status: "pending_auth", lastSyncedAt: null, lastError: null },
            {
              id: "connector-slack",
              provider: "slack",
              status: "connected",
              lastSyncedAt: new Date("2026-05-19T00:00:00.000Z"),
              lastError: "Bearer slack.secret.token failed"
            }
          ],
          messageInsights: []
        })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({
          id: "snap-mvp-dashboard",
          computedAt: new Date(),
          payloadJson: data.payloadJson
        })),
        update: vi.fn()
      }
    } as any;
    const projectOpsService = {
      buildProjectSummary: vi.fn().mockResolvedValue({
        meetings: {
          upcoming: [
            {
              id: "meeting-1",
              title: "Kickoff",
              startsAt: "2026-05-20T09:00:00.000Z",
              endsAt: null,
              eventType: "meeting",
              projectId: "project-1",
              projectName: "Apollo",
              isAllDay: false,
              timezone: null,
              source: "manual",
              linkedRefType: null,
              linkedRefId: null
            }
          ],
          todayCount: 1,
          thisWeekCount: 1
        },
        deadlines: { upcoming: [], urgentCount: 0, criticalCount: 0, completedCount: 0 },
        financials: {
          projectId: "project-1",
          currency: "USD",
          budgetAmount: 1000,
          spentAmount: 500,
          remainingAmount: 500,
          notes: null,
          updatedAt: null
        },
        subscriptions: { activeCount: 1, monthlyCost: 99, annualCost: 0, items: [] }
      })
    } as any;
    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      projectOpsService,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        MVP_MODE: true,
        MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"],
        MVP_ENABLE_PROJECT_FINANCE: false,
        MVP_ENABLE_PROJECT_SUBSCRIPTIONS: false
      } as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });

    expect(payload.communication.enabledProviders).toEqual(["manual_import", "fireflies_ai"]);
    expect(payload.communication.connectedProviders).toEqual(["manual_import"]);
    expect(payload.communication.providerCount).toBe(1);
    expect(payload.communication.connectorStatuses.map((connector: { provider: string }) => connector.provider)).toEqual([
      "manual_import",
      "fireflies_ai"
    ]);
    expect(payload.communication.manualImportAvailable).toBe(true);
    expect(payload.communication.firefliesState).toBe("pending_auth");
    expect(payload.calendar).toMatchObject({
      upcomingCount: 1,
      todayCount: 1,
      nextEvent: { id: "meeting-1", title: "Kickoff" }
    });
    expect(payload).not.toHaveProperty("financials");
    expect(payload).not.toHaveProperty("subscriptions");
    expect(JSON.stringify(payload)).not.toContain("budgetAmount");
    expect(JSON.stringify(payload)).not.toContain("monthlyCost");
    expect(JSON.stringify(payload.communication)).not.toContain("slack");
    expect(JSON.stringify(payload.communication)).not.toContain("slack.secret.token");
  });

  it("marks refresh dashboard jobs as running then completed", async () => {
    const jobRunUpsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      jobRun: {
        upsert: jobRunUpsert
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({
          id: "snap-general-2",
          computedAt: new Date(),
          payloadJson: data.payloadJson
        })),
        update: vi.fn()
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Acme", slug: "acme" })
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "user-1" }),
        findMany: vi.fn().mockResolvedValue([])
      },
      project: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await service.refreshSnapshotJob({
      scope: "general",
      orgId: "org-1",
      idempotencyKey: "dashboard:general:org-1:test"
    });

    expect(jobRunUpsert.mock.calls[0][0].update.status).toBe("running");
    expect(jobRunUpsert.mock.calls.at(-1)![0].update.status).toBe("completed");
  });

  it("rejects project dashboard refresh jobs whose orgId does not own the project", async () => {
    const jobRunUpsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      jobRun: {
        upsert: jobRunUpsert
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-real" })
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.refreshSnapshotJob({
        scope: "project",
        orgId: "org-wrong",
        projectId: "project-1",
        idempotencyKey: "dashboard:project:project-1:test"
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "dashboard_project_org_mismatch"
    });
    expect(jobRunUpsert.mock.calls.at(-1)![0].update.status).toBe("failed");
  });

  it("builds the general dashboard from active projects only", async () => {
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({
          id: "snap-general-active",
          computedAt: new Date("2026-04-18T00:00:00.000Z"),
          payloadJson: data.payloadJson
        })),
        update: vi.fn()
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "org-1",
          name: "Acme",
          slug: "acme"
        })
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "user-1" }),
        findMany: vi.fn().mockResolvedValue([])
      },
      project: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await service.getGeneralDashboard({
      orgId: "org-1",
      actorUserId: "user-1",
      forceRefresh: true
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1", status: "active" }
      })
    );
  });

  it("falls back to the latest stale snapshot when rebuild fails", async () => {
    const stalePayload = {
      scope: "general",
      organization: { id: "org-1", name: "Acme", slug: "acme" },
      computedAt: "2026-04-01T00:00:00.000Z",
      summary: {
        activeProjectCount: 1,
        orgHeadcount: 2,
        orgRoleBreakdown: { manager: 1, dev: 1 },
        projectMemberDistribution: [],
        overloadedMembers: [],
        overloadedCount: 0,
        watchCount: 0,
        projectsNeedingAttention: [],
        changePressure: { pendingCount: 0, recentAcceptedCount: 0, openDecisionCount: 0 },
        brainFreshness: { current: 1, processing: 0, stale: 0, blocked: 0 },
        communication: { connectedProviderCount: 0, needsReviewCount: 0, blockerCount: 0, contradictionCount: 0, lastSyncedAt: null }
      },
      projects: [],
      quickLinks: { projects: [] }
    };
    const staleSnapshot = {
      id: "snap-stale",
      computedAt: new Date("2026-04-01T00:00:00.000Z"),
      payloadJson: stalePayload
    };
    const telemetry = { increment: vi.fn(), observeDuration: vi.fn() };
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(staleSnapshot)
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "user-1" })
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("db down"))
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      telemetry as any
    );

    const payload = await service.getGeneralDashboard({
      orgId: "org-1",
      actorUserId: "user-1"
    });

    expect(payload).toEqual(stalePayload);
    expect(telemetry.increment).toHaveBeenCalledWith("orchestra_dashboard_snapshot_fallback_total", {
      scope: "general"
    });
  });

  it("propagates null allocation to unknown workload when any project has missing allocationPercent", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-alloc-1",
      computedAt: new Date("2026-04-19T10:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Acme", slug: "acme" })
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "user-1" }),
        findMany: vi.fn().mockResolvedValue([
          { id: "user-1", displayName: "Dev A", workspaceRoleDefault: "dev" }
        ])
      },
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "Apollo",
            slug: "apollo",
            status: "active",
            // User has a known allocation in project-1
            members: [
              {
                id: "pm-1",
                projectRole: "dev",
                roleInProject: "Backend",
                allocationPercent: 50,
                weeklyCapacityHours: 20,
                user: { id: "user-1", displayName: "Dev A", workspaceRoleDefault: "dev", isActive: true }
              }
            ],
            documents: [],
            changeProposals: [],
            decisions: [],
            artifacts: [],
            communicationConnectors: [],
            messageInsights: []
          },
          {
            id: "project-2",
            name: "Hermes",
            slug: "hermes",
            status: "active",
            // Same user has null allocation in project-2 — total must become null
            members: [
              {
                id: "pm-2",
                projectRole: "dev",
                roleInProject: "Backend",
                allocationPercent: null,
                weeklyCapacityHours: 20,
                user: { id: "user-1", displayName: "Dev A", workspaceRoleDefault: "dev", isActive: true }
              }
            ],
            documents: [],
            changeProposals: [],
            decisions: [],
            artifacts: [],
            communicationConnectors: [],
            messageInsights: []
          }
        ])
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getGeneralDashboard({ orgId: "org-1", actorUserId: "manager-1" });

    // The overloadedMembers list (summary.overloadedMembers) contains all members
    // sorted by allocation desc. user-1 appears once with totalAllocationPercent = null
    // because one component is null, so workloadLabel must be "unknown".
    const userEntry = payload.summary.overloadedMembers.find(
      (member: { userId: string }) => member.userId === "user-1"
    );
    expect(userEntry).toBeDefined();
    expect(userEntry!.totalAllocationPercent).toBeNull();
    expect(userEntry!.workloadLabel).toBe("unknown");
  });

  it("returns movement label slow when brain is blocked and no pending changes", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-movement-1",
      computedAt: new Date("2026-04-19T10:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "org-1", name: "Acme", slug: "acme" })
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "user-1" }),
        findMany: vi.fn().mockResolvedValue([
          { id: "user-1", displayName: "Manager", workspaceRoleDefault: "manager" }
        ])
      },
      project: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "Blocked",
            slug: "blocked",
            status: "active",
            members: [
              {
                id: "pm-1",
                projectRole: "manager",
                roleInProject: "Lead",
                allocationPercent: 30,
                weeklyCapacityHours: 20,
                user: { id: "user-1", displayName: "Manager", workspaceRoleDefault: "manager", isActive: true }
              }
            ],
            // One failed document → no ready/partial docs → brain is "blocked"
            documents: [
              {
                id: "doc-1",
                title: "PRD",
                currentVersionId: "ver-1",
                versions: [{ id: "ver-1", status: "failed", createdAt: new Date(), processedAt: null }]
              }
            ],
            // No pending changes, no recent accepted changes
            changeProposals: [],
            decisions: [],
            // No accepted brain
            artifacts: [],
            communicationConnectors: [],
            messageInsights: []
          }
        ])
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getGeneralDashboard({ orgId: "org-1", actorUserId: "manager-1" });

    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0].brain.freshnessState).toBe("blocked");
    expect(payload.projects[0].movementLabel).toBe("slow");
  });

  it("counts only detected insights for needsReviewCount while converted insights do not inflate it", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-comm-1",
      computedAt: new Date("2026-04-21T00:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [],
          documents: [],
          changeProposals: [],
          decisions: [],
          artifacts: [],
          communicationConnectors: [
            {
              id: "connector-1",
              provider: "slack",
              status: "connected",
              accountLabel: "Slack",
              lastSyncedAt: new Date("2026-04-21T00:00:00.000Z"),
              lastError: "Bearer dashboard.secret.token failed"
            },
            {
              id: "connector-2",
              provider: "clickup",
              status: "error",
              accountLabel: "ClickUp",
              lastSyncedAt: new Date("2026-04-20T00:00:00.000Z"),
              lastError: "ClickUp token secret failed"
            }
          ],
          // The DB query pre-filters to only active statuses — no ignored/superseded here
          messageInsights: [
            { id: "insight-1", provider: "slack", insightType: "blocker", status: "detected", generatedProposalId: null },
            { id: "insight-2", provider: "slack", insightType: "contradiction", status: "converted_to_proposal", generatedProposalId: "proposal-1" },
            { id: "insight-3", provider: "clickup", insightType: "blocker", status: "converted_to_decision", generatedProposalId: null }
          ]
        })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: snapshotCreate,
        update: vi.fn()
      }
    } as any;

    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });

    // Only the `detected` insight counts toward needsReviewCount — converted ones must not inflate it
    expect(payload.communication.needsReviewCount).toBe(1);
    // All three active insights count toward insightCount
    expect(payload.communication.insightCount).toBe(3);
    // Two blocker-type insights across all statuses
    expect(payload.communication.blockerCount).toBe(2);
    // One contradiction-type insight
    expect(payload.communication.contradictionCount).toBe(1);
    expect(payload.communication.providerPressure).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "slack",
          connectorCount: 1,
          connectedCount: 1,
          syncErrorCount: 1,
          insightCount: 2,
          needsReviewCount: 1,
          pendingProposalCount: 1,
          health: "degraded"
        }),
        expect.objectContaining({
          provider: "clickup",
          connectorCount: 1,
          connectedCount: 0,
          syncErrorCount: 1,
          insightCount: 1,
          blockerCount: 1,
          health: "error"
        })
      ])
    );
    expect(JSON.stringify(payload.communication)).not.toContain("dashboard.secret.token");
    expect(JSON.stringify(payload.communication)).not.toContain("ClickUp token secret");
    expect(payload.communication.connectorStatuses[0]?.lastError).toBe("Bearer [redacted] failed");
  });

  it("excludes failed processed versions from document latestProcessedAt", async () => {
    const readyProcessedAt = new Date("2026-04-20T09:00:00.000Z");
    const failedProcessedAt = new Date("2026-04-22T09:00:00.000Z");
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [],
          documents: [
            {
              id: "doc-ready",
              title: "Ready PRD",
              currentVersionId: "ver-ready",
              versions: [{ id: "ver-ready", status: "ready", createdAt: readyProcessedAt, processedAt: readyProcessedAt }]
            },
            {
              id: "doc-failed",
              title: "Failed PRD",
              currentVersionId: "ver-failed",
              versions: [{ id: "ver-failed", status: "failed", createdAt: failedProcessedAt, processedAt: failedProcessedAt }]
            }
          ],
          changeProposals: [],
          decisions: [],
          artifacts: [],
          communicationConnectors: [],
          messageInsights: []
        })
      },
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({
          id: "snap-doc-readiness",
          computedAt: new Date(),
          payloadJson: data.payloadJson
        })),
        update: vi.fn()
      }
    } as any;

    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });

    expect(payload.documents.readinessState).toBe("watch");
    expect(payload.documents.latestProcessedAt).toBe(readyProcessedAt.toISOString());
  });

  it("returns a controlled error when rebuild fails and no fallback snapshot exists", async () => {
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: "manager-1" })
      },
      organization: {
        findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("database offline"))
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.getGeneralDashboard({ orgId: "org-1", actorUserId: "manager-1" })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "dashboard_snapshot_unavailable"
    });
  });

  it("builds the MVP canonical project dashboard as readiness-first while preserving operationalSummary", async () => {
    const snapshotCreate = vi.fn(async ({ data }) => ({
      id: "snap-fde-mvp",
      computedAt: new Date("2026-05-24T00:00:00.000Z"),
      payloadJson: data.payloadJson
    }));
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [],
          documents: [],
          changeProposals: [],
          decisions: [{ id: "decision-1", title: "Use readiness dashboard", status: "accepted", acceptedAt: new Date() }],
          artifacts: [],
          communicationConnectors: [],
          messageInsights: []
        })
      },
      dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null), create: snapshotCreate, update: vi.fn() },
      engineeringEvidenceItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "evidence-route-real",
            sourceType: "github",
            sourceSubType: "route real",
            routeMethod: "GET",
            routePath: "/v1/projects/:projectId/dashboard",
            filePath: "src/modules/dashboard/routes.ts",
            title: "Dashboard route is wired",
            summary: "real route",
            confidence: "high",
            occurredAt: new Date(),
            updatedAt: new Date(),
            citationJson: { type: "engineering_evidence", id: "evidence-route-real" },
            openTargetJson: { targetType: "file", targetRef: { path: "src/modules/dashboard/routes.ts" } }
          }
        ])
      },
      engineeringEvidenceManualEntry: { findMany: vi.fn().mockResolvedValue([]) },
      fdeReadinessFinding: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conflict-1",
            findingType: "conflict",
            findingSubType: "overlapping_edit",
            targetKind: "file",
            targetRef: "src/modules/dashboard/service.ts",
            status: "active",
            severity: "blocking",
            confidence: "high",
            summary: "Two open PRs edit dashboard service",
            whyItMatters: "Concurrent edits can conflict.",
            suggestedAction: "Inspect both PRs before editing.",
            sourceDomainsJson: ["github"],
            evidenceIdsJson: ["evidence-route-real"],
            affectedJson: { files: ["src/modules/dashboard/service.ts"] },
            actorsJson: [],
            citationsJson: [{ type: "fde_readiness_finding", id: "conflict-1" }],
            openTargetsJson: [{ targetType: "file", targetRef: { path: "src/modules/dashboard/service.ts" } }],
            reasonsJson: ["same file overlap"],
            limitationsJson: [],
            warningsJson: []
          },
          {
            id: "safe-1",
            findingType: "safe_to_touch",
            findingSubType: "red",
            targetKind: "file",
            targetRef: "src/modules/dashboard/service.ts",
            status: "red",
            severity: "blocking",
            confidence: "high",
            summary: "Dashboard service is unsafe to touch",
            whyItMatters: "Blocking conflict exists.",
            suggestedAction: "Resolve conflict first.",
            sourceDomainsJson: ["github"],
            evidenceIdsJson: ["evidence-route-real"],
            affectedJson: { files: ["src/modules/dashboard/service.ts"] },
            actorsJson: [],
            citationsJson: [{ type: "fde_readiness_finding", id: "safe-1" }],
            openTargetsJson: [{ targetType: "file", targetRef: { path: "src/modules/dashboard/service.ts" } }],
            reasonsJson: ["blocking conflict"],
            limitationsJson: [],
            warningsJson: []
          }
        ])
      },
      fdeRationaleTrace: { findMany: vi.fn().mockResolvedValue([]) },
      fdeDecisionEngineeringLink: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;
    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });
    const keys = Object.keys(payload);

    expect(payload.dashboardKind).toBe("fde_readiness");
    expect(keys.indexOf("readinessSummary")).toBeLessThan(keys.indexOf("operationalSummary"));
    expect(payload.readinessSummary.blockingConflicts).toMatchObject({ value: 1, status: "red" });
    expect(payload.readinessSummary.unsafeToTouchFiles).toMatchObject({ value: 1, status: "red" });
    expect(payload.operationalSummary).toMatchObject({ documents: payload.documents, decisions: payload.decisions });
    expect((payload.conflictRadar.items as any[])[0]).toMatchObject({ summary: "Two open PRs edit dashboard service" });
    expect(JSON.stringify(payload)).toContain("no GitHub writes");
  });

  it("excludes MVP-hidden provider details from stored readiness dashboard rows", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn().mockResolvedValue({ orgId: "org-1" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "project-1",
          orgId: "org-1",
          name: "Apollo",
          slug: "apollo",
          status: "active",
          description: null,
          previewUrl: null,
          members: [],
          documents: [],
          changeProposals: [],
          decisions: [],
          artifacts: [],
          communicationConnectors: [],
          messageInsights: []
        })
      },
      dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }) => ({ id: "snap-fde-mvp", computedAt: new Date(), payloadJson: data.payloadJson })), update: vi.fn() },
      engineeringEvidenceItem: { findMany: vi.fn().mockResolvedValue([]) },
      engineeringEvidenceManualEntry: { findMany: vi.fn().mockResolvedValue([]) },
      fdeReadinessFinding: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "hidden-provider-finding",
            findingType: "conflict",
            findingSubType: "communication_overlap",
            targetKind: "file",
            targetRef: "src/modules/dashboard/service.ts",
            status: "active",
            severity: "watch",
            confidence: "medium",
            summary: "Slack thread client-payment-change indicates a possible overlap",
            whyItMatters: "Gmail and Microsoft Teams evidence mention the same file.",
            suggestedAction: "Check the Slack thread before editing.",
            sourceDomainsJson: ["slack"],
            evidenceIdsJson: [],
            affectedJson: { files: ["src/modules/dashboard/service.ts"] },
            actorsJson: [],
            citationsJson: [{ provider: "slack", title: "Slack thread client-payment-change", sourceType: "communication" }],
            openTargetsJson: [{ targetType: "slack_thread", targetRef: { channel: "client-payment-change" } }],
            reasonsJson: ["Slack and Gmail evidence"],
            limitationsJson: [],
            warningsJson: []
          }
        ])
      },
      fdeRationaleTrace: { findMany: vi.fn().mockResolvedValue([]) },
      fdeDecisionEngineeringLink: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;
    const service = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { MVP_MODE: true, MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"] } as any
    );

    const payload = await service.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });
    const serialized = JSON.stringify(payload).toLowerCase();

    expect(serialized).not.toContain("slack");
    expect(serialized).not.toContain("gmail");
    expect(serialized).not.toContain("microsoft teams");
    expect(serialized).not.toContain("client-payment-change");
    expect(JSON.stringify(payload)).toContain("Some communication providers are disabled in MVP mode");

    const slackEnabledService = new DashboardService(
      prisma,
      {
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
        ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { MVP_MODE: true, MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup"] } as any
    );
    const slackEnabledPayload = await slackEnabledService.getProjectDashboard("project-1", "manager-1", { forceRefresh: true });
    const slackEnabledSerialized = JSON.stringify(slackEnabledPayload).toLowerCase();

    expect(slackEnabledSerialized).toContain("slack");
    expect(slackEnabledSerialized).toContain("client-payment-change");
    expect(slackEnabledSerialized).not.toContain("gmail");
    expect(slackEnabledSerialized).not.toContain("microsoft teams");
  });

  it("creates MVP dashboard context snapshots through Agent Context Packs without truth mutation", async () => {
    const createPack = vi.fn().mockResolvedValue({ id: "context-pack-1", title: "Context snapshot" });
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1", name: "Apollo" })
      }
    } as any;
    const audit = { record: vi.fn() };
    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      audit as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { MVP_MODE: true } as any,
      { createPack } as any
    );

    const result = await service.createContextSnapshot("project-1", "manager-1", {
      targetType: "file",
      targetRef: "src/modules/dashboard/service.ts",
      audience: "Codex",
      detailLevel: "compact",
      includeRelatedEvidence: true
    });

    expect(createPack).toHaveBeenCalledWith(
      "project-1",
      "manager-1",
      expect.objectContaining({
        visibility: "internal",
        targetAgent: { name: "Codex", kind: "codex" },
        includeEvidenceDomains: expect.arrayContaining(["dashboard", "fde_readiness", "product_brain", "live_doc"])
      })
    );
    expect(result).toMatchObject({
      dashboardKind: "fde_readiness",
      truthMutationAllowed: false,
      githubWritesAllowed: false,
      externalAgentExecution: false
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "dashboard.context_snapshot.created" }));
  });

  it("builds Mission Control from real project sources with degraded GitHub state", async () => {
    const now = new Date("2026-05-30T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1", name: "Apollo" })
      },
      projectMember: {
        count: vi
          .fn()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(3),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "member-1",
            userId: "user-1",
            projectRole: "manager",
            isActive: true,
            canApproveTruthChanges: true,
            roleInProject: "Lead",
            joinedAt: new Date("2026-05-01T00:00:00.000Z"),
            user: { displayName: "Maya Chen", email: "maya@example.com" }
          },
          {
            id: "member-2",
            userId: "user-2",
            projectRole: "dev",
            isActive: true,
            canApproveTruthChanges: false,
            roleInProject: "Backend",
            joinedAt: new Date("2026-05-02T00:00:00.000Z"),
            user: { displayName: "Dev Raj", email: "dev@example.com" }
          }
        ])
      },
      communicationMessage: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "msg-1",
            threadId: "thread-1",
            connectorId: "connector-1",
            senderLabel: "Maya",
            bodyText: "Manager approved the tighter onboarding scope.",
            sentAt: new Date("2026-05-30T09:00:00.000Z"),
            providerPermalink: "https://slack.example/archives/C1/p1",
            thread: { subject: "#product", threadUrl: "https://slack.example/thread" },
            connector: { accountLabel: "Orchestra Slack" }
          }
        ])
      },
      communicationConnector: {
        count: vi.fn().mockResolvedValue(1)
      },
      gitHubRepositoryProjectLink: {
        findFirst: vi.fn().mockRejectedValue(new Error("connection pool exhausted"))
      },
      gitHubEngineeringEvidence: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "proposal-1",
            title: "Onboarding scope tightened",
            summary: "Manager confirmed smaller v1 onboarding flow.",
            status: "needs_review",
            createdAt: new Date("2026-05-30T08:00:00.000Z"),
            updatedAt: new Date("2026-05-30T08:30:00.000Z"),
            acceptedAt: null,
            accepter: null,
            links: [{ linkType: "message", linkRefId: "msg-1" }]
          }
        ])
      },
      liveDocSectionRevision: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "event-1",
            title: "Standup",
            description: "Daily team sync",
            startsAt: new Date("2026-05-31T09:00:00.000Z"),
            endsAt: new Date("2026-05-31T09:15:00.000Z"),
            source: "manual",
            createdAt: new Date("2026-05-30T07:00:00.000Z"),
            creator: { displayName: "Maya Chen" }
          }
        ])
      },
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([])
      },
      communicationSyncRun: {
        findMany: vi.fn().mockResolvedValue([])
      },
      socratesMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "smsg-1",
            sessionId: "session-1",
            content: "What changed in onboarding?",
            createdAt: new Date("2026-05-30T09:30:00.000Z"),
            session: { userId: "user-1", user: { displayName: "Maya Chen" } }
          }
        ])
      },
      document: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectEditorConnector: {
        findMany: vi.fn().mockResolvedValue([])
      },
      projectSubscription: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sub-1",
            name: "Supabase Pro",
            category: "database",
            cost: { toNumber: () => 25 },
            billingType: "monthly",
            status: "active",
            provider: "Manual",
            externalRef: "https://supabase.com/dashboard/project/example"
          }
        ])
      }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getMissionControl("project-1", "user-1", { limit: 4 });

    expect(payload.stats.find((stat) => stat.id === "slack-today")).toMatchObject({
      numericValue: 1,
      state: "ready",
      source: "slack"
    });
    expect(payload.stats.find((stat) => stat.id === "open-prs")).toMatchObject({
      numericValue: null,
      state: "not_connected",
      source: "github"
    });
    expect(payload.teamSummary).toMatchObject({ totalActive: 2, managers: 1, devs: 1, approvers: 1 });
    expect(payload.slackMessages[0]).toMatchObject({
      id: "msg-1",
      channelName: "product",
      preview: "Manager approved the tighter onboarding scope."
    });
    expect(payload.recentChanges[0]).toMatchObject({
      id: "proposal-1",
      status: "needs_review",
      source: "slack"
    });
    expect(payload.calendarEvents[0]).toMatchObject({ id: "event-1", source: "manual" });
    expect(payload.socratesQueries[0]).toMatchObject({ query: "What changed in onboarding?", askedBy: "Maya Chen" });
    expect(payload.subscriptions[0]).toMatchObject({ name: "Supabase Pro", amountCents: 2500, billingCadence: "/mo", vendorUrl: "https://supabase.com/dashboard/project/example" });
    expect(payload.subscriptionSummary).toMatchObject({ monthlyTotalCents: 2500, activeCount: 1 });
    expect(payload.githubPreview).toMatchObject({ state: "not_connected", commits: [] });
    expect(JSON.stringify(payload)).not.toContain("fake");

    vi.useRealTimers();
  });

  it("serves Mission Control from a fresh project dashboard snapshot without reading raw sources", async () => {
    const snapshotMissionControl = missionControlFixture();
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          computedAt: new Date(),
          payloadJson: { missionControl: snapshotMissionControl }
        })
      },
      project: { findUniqueOrThrow: vi.fn() },
      projectMember: { count: vi.fn(), findMany: vi.fn() },
      communicationMessage: { count: vi.fn(), findMany: vi.fn() }
    } as any;
    const projectService = { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any;
    const telemetry = { increment: vi.fn(), observeDuration: vi.fn() } as any;
    const service = new DashboardService(prisma, projectService, { record: vi.fn() } as any, telemetry);

    const payload = await service.getMissionControl("project-1", "user-1");

    expect(payload).toBe(snapshotMissionControl);
    expect(projectService.ensureProjectAccess).toHaveBeenCalledWith("project-1", "user-1");
    expect(prisma.project.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.projectMember.count).not.toHaveBeenCalled();
    expect(prisma.communicationMessage.count).not.toHaveBeenCalled();
    expect(telemetry.increment).toHaveBeenCalledWith("orchestra_mission_control_snapshot_hits_total");
  });

  it("serves stale Mission Control snapshots immediately and refreshes in the background", async () => {
    const staleMissionControl = missionControlFixture({ updatedAt: "2026-05-30T09:00:00.000Z" });
    const prisma = {
      dashboardSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          computedAt: new Date("2026-05-30T09:00:00.000Z"),
          payloadJson: { missionControl: staleMissionControl }
        })
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1", name: "Apollo" })
      }
    } as any;
    const projectService = { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any;
    const telemetry = { increment: vi.fn(), observeDuration: vi.fn() } as any;
    const service = new DashboardService(prisma, projectService, { record: vi.fn() } as any, telemetry);
    const refreshSpy = vi.spyOn(service as any, "buildAndPersistMissionControlSnapshot").mockResolvedValue({
      snapshot: {},
      data: missionControlFixture({ updatedAt: "2026-05-30T10:00:00.000Z" })
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-30T10:00:00.000Z"));

    const payload = await service.getMissionControl("project-1", "user-1");

    expect(payload).toBe(staleMissionControl);
    expect(prisma.project.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalledWith("project-1");
    expect(telemetry.increment).toHaveBeenCalledWith("orchestra_mission_control_snapshot_hits_total");
    expect(telemetry.increment).toHaveBeenCalledWith("orchestra_mission_control_stale_snapshot_hits_total");
    vi.useRealTimers();
  });

  it("denies Mission Control to client project members before reading sources", async () => {
    const prisma = {
      project: { findUniqueOrThrow: vi.fn() },
      communicationMessage: { findMany: vi.fn() }
    } as any;
    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "client" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(service.getMissionControl("project-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "client_dashboard_access_forbidden"
    });
    expect(prisma.project.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("surfaces Microsoft Teams messages and sync runs in Mission Control activity", async () => {
    const prisma = {
      auditEvent: { findMany: vi.fn().mockResolvedValue([
        { id: "internal-1", eventType: "dashboard_mission_control_opened", createdAt: new Date("2026-05-30T09:03:00.000Z"), actor: null, entityType: "dashboard_snapshot", entityId: "snapshot-1" },
        { id: "customer-1", eventType: "project_subscription_created", createdAt: new Date("2026-05-30T09:04:00.000Z"), actor: { displayName: "Maya" }, entityType: "project_subscription", entityId: "sub-1" }
      ]) },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "teams-msg-1",
            threadId: "teams-thread-1",
            provider: "microsoft_teams",
            senderLabel: "Maya",
            bodyText: "Teams says the launch approval needs one final review.",
            sentAt: new Date("2026-05-30T09:00:00.000Z")
          }
        ])
      },
      communicationSyncRun: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "teams-sync-1",
            provider: "microsoft_teams",
            status: "completed",
            createdAt: new Date("2026-05-30T09:01:00.000Z"),
            startedAt: new Date("2026-05-30T09:01:00.000Z"),
            finishedAt: new Date("2026-05-30T09:02:00.000Z")
          }
        ])
      },
      socratesMessage: { findMany: vi.fn().mockResolvedValue([]) },
      projectEvent: { findMany: vi.fn().mockResolvedValue([]) },
      document: { findMany: vi.fn().mockResolvedValue([]) },
      projectEditorConnector: { findMany: vi.fn().mockResolvedValue([]) },
      gitHubEngineeringEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeProposal: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;
    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const items = await service.getActivityFeed("project-1", "manager-1", 10);

    expect(prisma.communicationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: { in: expect.arrayContaining(["microsoft_teams"]) }
        })
      })
    );
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "microsoft_teams-sync:teams-sync-1", source: "microsoft_teams", text: "Microsoft Teams sync completed" }),
        expect.objectContaining({ id: "microsoft_teams:teams-msg-1", source: "microsoft_teams" })
      ])
    );
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "audit:customer-1", source: "manual" })]));
    expect(items).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "audit:internal-1" })]));
  });

  it("rejects general dashboard refresh jobs that carry a projectId", async () => {
    const jobRunUpsert = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      jobRun: { upsert: jobRunUpsert }
    } as any;

    const service = new DashboardService(
      prisma,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.refreshSnapshotJob({
        scope: "general",
        orgId: "org-1",
        projectId: "project-1",
        idempotencyKey: "dashboard:general:org-1:test"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "dashboard_general_project_id_forbidden"
    });
    expect(jobRunUpsert.mock.calls.at(-1)![0].update.status).toBe("failed");
  });
});
