import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { ProjectResponsibilitiesService, buildResponsibilitySummary } from "../src/modules/projects/responsibilities.service.js";
import { createResponsibilitySchema } from "../src/modules/projects/responsibilities.schemas.js";

const createdAt = new Date("2026-05-01T10:00:00.000Z");
const updatedAt = new Date("2026-05-02T10:00:00.000Z");

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp-1",
    orgId: "org-1",
    projectId: "project-1",
    memberId: "member-1",
    assigneeName: null,
    title: "Own frontend onboarding",
    description: "Build the MVP onboarding screens.",
    area: "frontend",
    status: "open",
    source: "manual",
    createdByUserId: "manager-1",
    updatedByUserId: "manager-1",
    createdAt,
    updatedAt,
    member: {
      id: "member-1",
      userId: "user-2",
      roleInProject: "Frontend",
      user: {
        id: "user-2",
        email: "sara@example.com",
        displayName: "Sara",
        passwordHash: "must-not-leak"
      }
    },
    ...overrides
  };
}

function createDeps() {
  const prisma = {
    project: {
      findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
    },
    projectMember: {
      findFirst: vi.fn().mockResolvedValue({
        id: "member-1",
        projectId: "project-1",
        isActive: true,
        userId: "user-2",
        roleInProject: "Frontend",
        user: { id: "user-2", email: "sara@example.com", displayName: "Sara" }
      })
    },
    projectResponsibility: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([makeRow()]),
      findFirst: vi.fn().mockResolvedValue(makeRow()),
      create: vi.fn().mockImplementation(async ({ data }: any) => makeRow(data)),
      update: vi.fn().mockImplementation(async ({ data }: any) =>
        makeRow({
          title: data.title ?? "Own frontend onboarding",
          status: data.status ?? "open",
          updatedByUserId: data.updatedBy?.connect?.id ?? "manager-1",
          updatedAt: new Date("2026-05-03T10:00:00.000Z")
        })
      ),
      delete: vi.fn().mockResolvedValue(makeRow())
    },
    jobRun: {
      upsert: vi.fn().mockResolvedValue({})
    }
  } as any;
  const projectService = {
    ensureProjectAccess: vi.fn().mockResolvedValue({ id: "member-1", projectRole: "dev", isActive: true }),
    ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ id: "member-1", projectRole: "dev", isActive: true }),
    ensureProjectMemberCanManageTeamContext: vi.fn().mockResolvedValue({ id: "member-1", projectRole: "manager", isActive: true })
  } as any;
  const auditService = { record: vi.fn().mockResolvedValue(undefined) } as any;
  const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) } as any;
  return { prisma, projectService, auditService, jobs };
}

describe("ProjectResponsibilitiesService", () => {
  it("validates create input requires a member or assignee label", () => {
    expect(() =>
      createResponsibilitySchema.parse({
        title: "Own frontend",
        area: "frontend"
      })
    ).toThrow();
  });

  it("creates a responsibility with safe assignee DTO, audit, and dashboard refresh", async () => {
    const { prisma, projectService, auditService, jobs } = createDeps();
    const service = new ProjectResponsibilitiesService(prisma, projectService, auditService, jobs);

    const created = await service.createResponsibility("project-1", "manager-1", {
      memberId: "member-1",
      title: "Own frontend onboarding",
      description: "Build the MVP onboarding screens.",
      area: "frontend",
      status: "open",
      source: "manual"
    });

    expect(projectService.ensureProjectMemberCanManageTeamContext).toHaveBeenCalledWith("project-1", "manager-1");
    expect(prisma.projectMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "member-1", projectId: "project-1", isActive: true } })
    );
    expect(created.assignee).toEqual({
      memberId: "member-1",
      userId: "user-2",
      displayName: "Sara",
      email: "sara@example.com",
      roleInProject: "Frontend"
    });
    expect(JSON.stringify(created)).not.toContain("must-not-leak");
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "responsibility_created",
        actorUserId: "manager-1",
        payload: expect.objectContaining({ title: "Own frontend onboarding", memberId: "member-1" })
      })
    );
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "refresh_dashboard_snapshot",
      expect.objectContaining({ projectId: "project-1", reason: "responsibility_created" }),
      expect.stringContaining("dashboard:project:project-1:")
    );
  });

  it("preserves normal-mode manager-only mutation by delegating to project policy", async () => {
    const { prisma, projectService, auditService, jobs } = createDeps();
    projectService.ensureProjectMemberCanManageTeamContext.mockRejectedValue(
      new AppError(403, "Project manager access required", "manager_access_required")
    );
    const service = new ProjectResponsibilitiesService(prisma, projectService, auditService, jobs);

    await expect(
      service.createResponsibility("project-1", "dev-1", {
        assigneeName: "Sara",
        title: "Own frontend",
        area: "frontend",
        status: "open",
        source: "manual"
      })
    ).rejects.toMatchObject({ code: "manager_access_required" });
    expect(prisma.projectResponsibility.create).not.toHaveBeenCalled();
  });

  it("lists and searches responsibilities through project-scoped access only", async () => {
    const { prisma, projectService, auditService, jobs } = createDeps();
    const service = new ProjectResponsibilitiesService(prisma, projectService, auditService, jobs);

    const result = await service.listResponsibilities("project-1", "dev-1", {
      q: "frontend",
      page: 1,
      pageSize: 10
    });

    expect(projectService.ensureProjectMemberCanUseSocrates).toHaveBeenCalledWith("project-1", "dev-1");
    expect(prisma.projectResponsibility.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          OR: expect.any(Array)
        }),
        take: 10
      })
    );
    expect(result.items[0]).toMatchObject({ id: "resp-1", title: "Own frontend onboarding" });
    expect(result.meta).toMatchObject({ page: 1, pageSize: 10, totalCount: 1 });
  });

  it("denies project-role clients from internal responsibility reads", async () => {
    const { prisma, projectService, auditService, jobs } = createDeps();
    projectService.ensureProjectMemberCanUseSocrates.mockRejectedValue(
      new AppError(403, "Project access denied", "project_access_denied")
    );
    const service = new ProjectResponsibilitiesService(prisma, projectService, auditService, jobs);

    await expect(service.listResponsibilities("project-1", "client-1", { page: 1, pageSize: 25 })).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    expect(prisma.projectResponsibility.findMany).not.toHaveBeenCalled();
  });

  it("rejects member assignments outside the active project", async () => {
    const { prisma, projectService, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue(null);
    const service = new ProjectResponsibilitiesService(prisma, projectService, auditService, jobs);

    await expect(
      service.createResponsibility("project-1", "manager-1", {
        memberId: "outside-member",
        title: "Own frontend",
        area: "frontend",
        status: "open",
        source: "manual"
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_responsibility_member" });
    expect(prisma.projectResponsibility.create).not.toHaveBeenCalled();
  });

  it("updates and deletes with before/after audit snapshots", async () => {
    const { prisma, projectService, auditService, jobs } = createDeps();
    const service = new ProjectResponsibilitiesService(prisma, projectService, auditService, jobs);

    await service.updateResponsibility("project-1", "resp-1", "manager-1", {
      status: "blocked",
      title: "Unblock frontend onboarding"
    });
    await service.deleteResponsibility("project-1", "resp-1", "manager-1");

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "responsibility_updated",
        payload: expect.objectContaining({
          before: expect.objectContaining({ title: "Own frontend onboarding", status: "open" }),
          after: expect.objectContaining({ title: "Unblock frontend onboarding", status: "blocked" })
        })
      })
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "responsibility_deleted",
        payload: expect.objectContaining({
          deleted: expect.objectContaining({ responsibilityId: "resp-1", title: "Own frontend onboarding" })
        })
      })
    );
  });

  it("does not allow updates to clear both memberId and assigneeName", async () => {
    const { prisma, projectService, auditService, jobs } = createDeps();
    prisma.projectResponsibility.findFirst.mockResolvedValue(makeRow({ memberId: null, assigneeName: "Sara", member: null }));
    const service = new ProjectResponsibilitiesService(prisma, projectService, auditService, jobs);

    await expect(
      service.updateResponsibility("project-1", "resp-1", "manager-1", {
        assigneeName: null
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "responsibility_assignee_required" });
    expect(prisma.projectResponsibility.update).not.toHaveBeenCalled();
  });

  it("builds bounded team responsibility summary counts", () => {
    const summary = buildResponsibilitySummary("project-1", [
      {
        ...makeRow(),
        id: "resp-1",
        status: "open",
        area: "frontend",
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        assignee: {
          memberId: "member-1",
          userId: "user-2",
          displayName: "Sara",
          email: "sara@example.com",
          roleInProject: "Frontend"
        }
      } as any,
      {
        ...makeRow({ id: "resp-2", status: "blocked", area: "backend" }),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        assignee: {
          memberId: "member-1",
          userId: "user-2",
          displayName: "Sara",
          email: "sara@example.com",
          roleInProject: "Frontend"
        }
      } as any,
      {
        ...makeRow({ id: "resp-3", status: "done", area: "docs", memberId: null, assigneeName: "External writer", member: null }),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        assignee: null
      } as any
    ]);

    expect(summary.activeCount).toBe(2);
    expect(summary.blockedCount).toBe(1);
    expect(summary.byArea).toMatchObject({ frontend: 1, backend: 1 });
    expect(summary.byStatus).toMatchObject({ open: 1, blocked: 1, done: 1 });
    expect(summary.memberHighlights[0]).toMatchObject({
      memberId: "member-1",
      displayName: "Sara",
      activeCount: 2,
      blockedCount: 1
    });
    expect(summary.quickLinks.responsibilitiesPath).toBe("/projects/project-1/responsibilities");
  });
});
