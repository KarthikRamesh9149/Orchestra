import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ProjectOpsService } from "../src/modules/project-ops/service.js";

function createBaseDeps() {
  const prisma = {
    project: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn()
    },
    projectEvent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    projectDeadline: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    projectFinancialSummary: {
      findUnique: vi.fn(),
      upsert: vi.fn()
    },
    projectSubscription: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    jobRun: {
      upsert: vi.fn()
    }
  } as any;

  const projectService = {
    ensureProjectAccess: vi.fn(),
    ensureProjectManager: vi.fn()
  } as any;

  const auditService = {
    record: vi.fn()
  } as any;

  const jobs = {
    enqueue: vi.fn()
  } as any;

  return { prisma, projectService, auditService, jobs };
}

describe("ProjectOpsService", () => {
  it("returns a default financial summary when one has not been created", async () => {
    const { prisma, projectService, auditService, jobs } = createBaseDeps();
    projectService.ensureProjectAccess.mockResolvedValue({ projectRole: "dev" });
    prisma.projectFinancialSummary.findUnique.mockResolvedValue(null);

    const service = new ProjectOpsService(prisma, projectService, auditService, jobs);
    const summary = await service.getFinancialSummary("project-1", "user-1");

    expect(summary).toEqual({
      projectId: "project-1",
      currency: "USD",
      budgetAmount: null,
      spentAmount: 0,
      remainingAmount: null,
      notes: null,
      updatedAt: null
    });
  });

  it("blocks clients from reading project ops data", async () => {
    const { prisma, projectService, auditService, jobs } = createBaseDeps();
    projectService.ensureProjectAccess.mockResolvedValue({ projectRole: "client" });

    const service = new ProjectOpsService(prisma, projectService, auditService, jobs);

    await expect(service.getFinancialSummary("project-1", "user-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "project_ops_access_forbidden"
    });
  });

  it("rejects non-manager mutation attempts", async () => {
    const { prisma, projectService, auditService, jobs } = createBaseDeps();
    projectService.ensureProjectManager.mockRejectedValue({
      statusCode: 403,
      code: "manager_access_required"
    });

    const service = new ProjectOpsService(prisma, projectService, auditService, jobs);

    await expect(
      service.updateFinancialSummary("project-1", "dev-1", { spentAmount: 100 })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "manager_access_required"
    });
    expect(prisma.projectFinancialSummary.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid meeting ranges even when called directly", async () => {
    const { prisma, projectService, auditService, jobs } = createBaseDeps();
    projectService.ensureProjectManager.mockResolvedValue({ projectRole: "manager" });
    prisma.project.findUniqueOrThrow.mockResolvedValue({ id: "project-1", orgId: "org-1", name: "Apollo" });

    const service = new ProjectOpsService(prisma, projectService, auditService, jobs);

    await expect(
      service.createMeeting("project-1", "manager-1", {
        title: "Bad meeting",
        eventType: "meeting",
        startsAt: "2026-04-23T10:00:00.000Z",
        endsAt: "2026-04-23T09:00:00.000Z"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "project_event_invalid_time_range"
    });
    expect(prisma.projectEvent.create).not.toHaveBeenCalled();
  });

  it("sets completedAt when a deadline moves to completed and clears it when reopened", async () => {
    const { prisma, projectService, auditService, jobs } = createBaseDeps();
    projectService.ensureProjectManager.mockResolvedValue({ projectRole: "manager" });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", orgId: "org-1" });

    prisma.projectDeadline.findFirst
      .mockResolvedValueOnce({
        id: "deadline-1",
        title: "Client demo",
        status: "at_risk",
        completedAt: null,
        project: { orgId: "org-1" }
      })
      .mockResolvedValueOnce({
        id: "deadline-1",
        title: "Client demo",
        status: "completed",
        completedAt: new Date("2026-04-23T00:00:00.000Z"),
        project: { orgId: "org-1" }
      });

    prisma.projectDeadline.update
      .mockResolvedValueOnce({
        id: "deadline-1",
        title: "Client demo",
        dueAt: new Date("2026-04-30T00:00:00.000Z"),
        status: "completed",
        completedAt: new Date("2026-04-23T00:00:00.000Z"),
        linkedRefType: null,
        linkedRefId: null,
        project: { id: "project-1", name: "Apollo" }
      })
      .mockResolvedValueOnce({
        id: "deadline-1",
        title: "Client demo",
        dueAt: new Date("2026-04-30T00:00:00.000Z"),
        status: "on_track",
        completedAt: null,
        linkedRefType: null,
        linkedRefId: null,
        project: { id: "project-1", name: "Apollo" }
      });

    const service = new ProjectOpsService(prisma, projectService, auditService, jobs);

    await service.updateDeadline("project-1", "deadline-1", "manager-1", { status: "completed" });
    expect(prisma.projectDeadline.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          completedAt: expect.any(Date)
        })
      })
    );

    await service.updateDeadline("project-1", "deadline-1", "manager-1", { status: "on_track" });
    expect(prisma.projectDeadline.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "on_track",
          completedAt: null
        })
      })
    );
  });

  it("groups meetings and deadlines by day in the calendar read model", async () => {
    const { prisma, projectService, auditService, jobs } = createBaseDeps();
    projectService.ensureProjectManager.mockResolvedValue({ projectRole: "manager" });
    prisma.projectEvent.findMany.mockResolvedValue([
      {
        id: "meeting-1",
        title: "Sprint planning",
        startsAt: new Date("2026-04-23T09:00:00.000Z"),
        endsAt: new Date("2026-04-23T10:00:00.000Z"),
        eventType: "meeting",
        isAllDay: false,
        timezone: null,
        source: "manual",
        linkedRefType: null,
        linkedRefId: null,
        projectId: "project-1",
        project: { id: "project-1", name: "Apollo" }
      }
    ]);
    prisma.projectDeadline.findMany.mockResolvedValue([
      {
        id: "deadline-1",
        title: "Client demo",
        dueAt: new Date("2026-04-23T16:00:00.000Z"),
        status: "critical",
        completedAt: null,
        linkedRefType: null,
        linkedRefId: null,
        projectId: "project-1",
        project: { id: "project-1", name: "Apollo" }
      }
    ]);

    const service = new ProjectOpsService(prisma, projectService, auditService, jobs);
    const calendar = await service.getCalendar({
      actorUserId: "manager-1",
      orgId: "org-1",
      month: "2026-04"
    });

    expect(calendar.days.find((day) => day.date === "2026-04-23")).toMatchObject({
      meetings: [{ id: "meeting-1", title: "Sprint planning" }],
      deadlines: [{ id: "deadline-1", title: "Client demo", status: "critical" }]
    });
  });

  it("builds a project ops summary with remaining amount and recurring costs", async () => {
    const { prisma, projectService, auditService, jobs } = createBaseDeps();
    const now = new Date();
    prisma.projectEvent.findMany.mockResolvedValue([
      {
        id: "meeting-1",
        title: "Client review",
        startsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        endsAt: null,
        eventType: "review",
        isAllDay: false,
        timezone: null,
        source: "manual",
        linkedRefType: null,
        linkedRefId: null,
        projectId: "project-1",
        project: { id: "project-1", name: "Apollo" }
      }
    ]);
    prisma.projectDeadline.findMany.mockResolvedValue([
      {
        id: "deadline-1",
        title: "Launch prep",
        dueAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
        status: "at_risk",
        completedAt: null,
        linkedRefType: null,
        linkedRefId: null,
        projectId: "project-1",
        project: { id: "project-1", name: "Apollo" }
      },
      {
        id: "deadline-2",
        title: "Overdue item",
        dueAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        status: "critical",
        completedAt: null,
        linkedRefType: null,
        linkedRefId: null,
        projectId: "project-1",
        project: { id: "project-1", name: "Apollo" }
      },
      {
        id: "deadline-3",
        title: "Completed item",
        dueAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        status: "completed",
        completedAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
        linkedRefType: null,
        linkedRefId: null,
        projectId: "project-1",
        project: { id: "project-1", name: "Apollo" }
      }
    ]);
    prisma.projectFinancialSummary.findUnique.mockResolvedValue({
      id: "fin-1",
      projectId: "project-1",
      currency: "USD",
      budgetAmount: new Prisma.Decimal("85000.00"),
      spentAmount: new Prisma.Decimal("28900.00"),
      notes: null,
      updatedAt: new Date("2026-04-23T00:00:00.000Z")
    });
    prisma.projectSubscription.findMany.mockResolvedValue([
      {
        id: "sub-1",
        projectId: "project-1",
        name: "AWS",
        category: "Infrastructure",
        cost: new Prisma.Decimal("420.00"),
        billingType: "monthly",
        status: "active",
        provider: "AWS",
        externalRef: "https://console.aws.amazon.com/",
        renewsAt: new Date("2026-05-01T00:00:00.000Z"),
        createdBy: "user-1",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z")
      },
      {
        id: "sub-2",
        projectId: "project-1",
        name: "Figma",
        category: "Design",
        cost: new Prisma.Decimal("1200.00"),
        billingType: "annual",
        status: "active",
        provider: "Figma",
        externalRef: null,
        renewsAt: new Date("2027-01-01T00:00:00.000Z"),
        createdBy: "user-1",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z")
      }
    ]);

    const service = new ProjectOpsService(prisma, projectService, auditService, jobs);
    const summary = await service.buildProjectSummary("project-1");

    expect(summary.financials.remainingAmount).toBe(56100);
    expect(summary.subscriptions.activeCount).toBe(2);
    expect(summary.subscriptions.monthlyCost).toBe(420);
    expect(summary.subscriptions.annualCost).toBe(1200);
    expect(summary.subscriptions.items[0].externalRef).toBe("https://console.aws.amazon.com/");
    expect(summary.deadlines.completedCount).toBe(1);
    expect(summary.deadlines.upcoming.some((deadline) => deadline.id === "deadline-2")).toBe(true);
  });

  it("refreshes both project and general dashboard snapshots after a meeting mutation", async () => {
    const previousBetaMode = process.env.MVP_BETA_MODE;
    const previousProfile = process.env.ORCHESTRA_PROFILE;
    delete process.env.MVP_BETA_MODE;
    delete process.env.ORCHESTRA_PROFILE;
    try {
      const { prisma, projectService, auditService, jobs } = createBaseDeps();
      projectService.ensureProjectManager.mockResolvedValue({ projectRole: "manager" });
      prisma.project.findUniqueOrThrow.mockResolvedValue({ id: "project-1", orgId: "org-1", name: "Apollo" });
      prisma.project.findUnique.mockResolvedValue({ id: "project-1", orgId: "org-1" });
      prisma.projectEvent.create.mockResolvedValue({
        id: "meeting-1",
        title: "Sprint planning",
        eventType: "meeting",
        startsAt: new Date("2026-04-23T09:00:00.000Z"),
        endsAt: null,
        isAllDay: false,
        timezone: null,
        source: "manual",
        linkedRefType: null,
        linkedRefId: null,
        project: { id: "project-1", name: "Apollo" }
      });

      const service = new ProjectOpsService(prisma, projectService, auditService, jobs);
      await service.createMeeting("project-1", "manager-1", {
        title: "Sprint planning",
        eventType: "meeting",
        startsAt: "2026-04-23T09:00:00.000Z"
      });

      expect(prisma.jobRun.upsert).toHaveBeenCalledTimes(2);
      expect(jobs.enqueue).toHaveBeenCalledTimes(2);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "project_event_created",
          entityType: "project_event"
        })
      );
    } finally {
      if (previousBetaMode === undefined) {
        delete process.env.MVP_BETA_MODE;
      } else {
        process.env.MVP_BETA_MODE = previousBetaMode;
      }
      if (previousProfile === undefined) {
        delete process.env.ORCHESTRA_PROFILE;
      } else {
        process.env.ORCHESTRA_PROFILE = previousProfile;
      }
    }
  });

  it("skips legacy dashboard snapshot refresh for beta manual ops mutations", async () => {
    const previousBetaMode = process.env.MVP_BETA_MODE;
    process.env.MVP_BETA_MODE = "true";
    try {
      const { prisma, projectService, auditService, jobs } = createBaseDeps();
      projectService.ensureProjectManager.mockResolvedValue({ projectRole: "manager" });
      prisma.project.findUniqueOrThrow.mockResolvedValue({ id: "project-1", orgId: "org-1", name: "Apollo" });
      prisma.projectEvent.create.mockResolvedValue({
        id: "meeting-1",
        title: "Sprint planning",
        eventType: "meeting",
        startsAt: new Date("2026-04-23T09:00:00.000Z"),
        endsAt: null,
        isAllDay: false,
        timezone: null,
        source: "manual",
        linkedRefType: null,
        linkedRefId: null,
        project: { id: "project-1", name: "Apollo" }
      });

      const service = new ProjectOpsService(prisma, projectService, auditService, jobs);
      await service.createMeeting("project-1", "manager-1", {
        title: "Sprint planning",
        eventType: "meeting",
        startsAt: "2026-04-23T09:00:00.000Z"
      });

      expect(prisma.jobRun.upsert).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "project_event_created",
          entityType: "project_event"
        })
      );
    } finally {
      if (previousBetaMode === undefined) {
        delete process.env.MVP_BETA_MODE;
      } else {
        process.env.MVP_BETA_MODE = previousBetaMode;
      }
    }
  });
});
