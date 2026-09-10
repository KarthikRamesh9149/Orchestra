import { describe, expect, it, vi } from "vitest";
import { ProjectService } from "../src/modules/projects/service.js";

function createDeps() {
  const prisma = {
    project: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn()
    },
    user: {
      findUnique: vi.fn()
    },
    organizationMembership: {
      findUnique: vi.fn()
    },
    projectMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn()
    },
    projectJoinCode: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    jobRun: {
      upsert: vi.fn()
    }
  } as any;

  const auditService = {
    record: vi.fn()
  } as any;

  const jobs = {
    enqueue: vi.fn()
  } as any;

  return { prisma, auditService, jobs };
}

describe("ProjectService membership management", () => {
  it("[FIX-36] deduplicates only concurrent project-access reads", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({
      id: "member-1",
      projectId: "project-1",
      userId: "user-1",
      projectRole: "manager",
      isActive: true,
      project: { orgId: "org-1" },
      user: {
        organizationMemberships: [{ organizationId: "org-1", workspaceRoleDefault: "manager" }]
      }
    });
    const service = new ProjectService(prisma, auditService, jobs);

    const results = await Promise.all(Array.from({ length: 8 }, () => service.ensureProjectAccess("project-1", "user-1")));
    expect(results).toHaveLength(8);
    expect(prisma.projectMember.findFirst).toHaveBeenCalledTimes(1);

    await service.ensureProjectAccess("project-1", "user-1");
    expect(prisma.projectMember.findFirst).toHaveBeenCalledTimes(2);
  });

  it("lists only active project memberships in the session's active organization", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.project.findMany.mockResolvedValue([
      { id: "project-owned", orgId: "org-owned", name: "Owned workspace", members: [] }
    ]);

    const service = new ProjectService(prisma, auditService, jobs);
    const projects = await service.listProjects("user-1", "org-owned");

    expect(projects.map((project: { id: string }) => project.id)).toEqual(["project-owned"]);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: {
        orgId: "org-owned",
        organization: {
          memberships: {
            some: {
              userId: "user-1",
              isActive: true
            }
          }
        },
        members: {
          some: {
            userId: "user-1",
            isActive: true
          }
        }
      },
      include: {
        members: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  });

  it("lets a project manager create and revoke one-time workspace join codes without storing plaintext", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({ id: "manager-member", projectRole: "manager" });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", orgId: "org-1", name: "Shared workspace" });
    prisma.projectJoinCode.create.mockImplementation(async (args: any) => ({
      id: "code-1",
      projectId: args.data.projectId,
      orgId: args.data.orgId,
      codeHash: args.data.codeHash,
      codePrefix: args.data.codePrefix,
      projectRole: args.data.projectRole,
      canApproveTruthChanges: args.data.canApproveTruthChanges,
      maxUses: args.data.maxUses,
      useCount: args.data.useCount,
      invitedEmail: args.data.invitedEmail,
      expiresAt: args.data.expiresAt,
      revokedAt: null,
      createdAt: new Date("2026-05-28T00:00:00.000Z")
    }));
    prisma.projectJoinCode.update.mockResolvedValue({ id: "code-1" });
    prisma.projectJoinCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.projectJoinCode.findFirst.mockResolvedValue({
      id: "code-1",
      projectId: "project-1",
      revokedAt: new Date("2026-05-28T00:10:00.000Z")
    });

    const service = new ProjectService(prisma, auditService, jobs);
    const result = await service.createJoinCode("project-1", "manager-1", { invitedEmail: "Teammate@Example.com" });

    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(result.invitedEmail).toBe("teammate@example.com");
    expect(result.projectRole).toBe("dev");
    expect(result.maxUses).toBe(1);
    expect(prisma.projectJoinCode.create.mock.calls[0][0].data.codeHash).not.toBe(result.code);
    expect(prisma.projectJoinCode.create.mock.calls[0][0].data.linkTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(prisma.projectJoinCode.create.mock.calls[0][0].data)).not.toContain("invite_token");
    expect(prisma.projectJoinCode.create.mock.calls[0][0].data).toMatchObject({
      projectId: "project-1",
      orgId: "org-1",
      createdBy: "manager-1",
      projectRole: "dev",
      canApproveTruthChanges: false,
      invitedEmail: "teammate@example.com",
      maxUses: 1,
      useCount: 0
    });

    await service.revokeJoinCode("project-1", "code-1", "manager-1");
    expect(prisma.projectJoinCode.updateMany).toHaveBeenCalledWith({
      where: { id: "code-1", projectId: "project-1", revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedBy: "manager-1" }
    });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "team_invite_created" }));
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "team_invite_revoked" }));
  });

  it("rejects multi-use email invitations before creating a code", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({ id: "manager-member", projectRole: "manager" });
    const service = new ProjectService(prisma, auditService, jobs);

    await expect(service.createJoinCode("project-1", "manager-1", {
      invitedEmail: "teammate@example.com",
      maxUses: 2
    })).rejects.toMatchObject({ statusCode: 400, code: "invite_single_use_required" });

    expect(prisma.projectJoinCode.create).not.toHaveBeenCalled();
  });

  it("does not enqueue dashboard refreshes when creating projects in MVP beta mode", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.project.findFirst.mockResolvedValue(null);
    prisma.project.create.mockResolvedValue({
      id: "project-1",
      orgId: "org-1",
      name: "Beta QA Socrates",
      slug: "beta-qa-socrates",
      description: null,
      previewUrl: null,
      status: "active",
      createdBy: "manager-1"
    });
    prisma.project.findUnique.mockResolvedValue({
      id: "project-1",
      orgId: "org-1"
    });

    const service = new ProjectService(prisma, auditService, jobs, {
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: true
    } as any);

    const project = await service.createProject({
      orgId: "org-1",
      actorUserId: "manager-1",
      name: "Beta QA Socrates"
    });

    expect(project).toMatchObject({ id: "project-1", slug: "beta-qa-socrates" });
    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          members: {
            create: expect.objectContaining({
              projectRole: "manager",
              isActive: true,
              canApproveTruthChanges: true,
              truthApprovalGrantedByUserId: "manager-1",
              truthApprovalGrantedAt: expect.any(Date)
            })
          }
        })
      })
    );
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "project_created" }));
    expect(prisma.jobRun.upsert).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("blocks join codes that would grant client truth approval", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({ id: "manager-member", projectRole: "manager" });

    const service = new ProjectService(prisma, auditService, jobs);

    await expect(
      service.createJoinCode("project-1", "manager-1", {
        invitedEmail: "client@example.com",
        projectRole: "client",
        canApproveTruthChanges: true
      })
    ).rejects.toMatchObject({ code: "client_truth_approval_forbidden" });
    expect(prisma.projectJoinCode.create).not.toHaveBeenCalled();
  });

  it("adds an existing same-org user and refreshes dashboard snapshots", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst
      .mockResolvedValueOnce({ id: "manager-member", projectRole: "manager" })
      .mockResolvedValueOnce(null);
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", orgId: "org-1" });
    prisma.user.findUnique.mockResolvedValue({ id: "dev-1", email: "dev@example.com", orgId: "org-home", isActive: true });
    prisma.organizationMembership.findUnique.mockResolvedValue({
      organizationId: "org-1",
      userId: "dev-1",
      isActive: true
    });
    prisma.projectMember.upsert.mockResolvedValue({
      id: "member-1",
      projectId: "project-1",
      userId: "dev-1",
      projectRole: "dev",
      isActive: true,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      user: {
        id: "dev-1",
        email: "dev@example.com",
        displayName: "Dev User",
        jobTitle: "Engineer",
        isActive: true,
        passwordHash: "must-not-leak"
      }
    });
    prisma.jobRun.upsert.mockResolvedValue({});

    const service = new ProjectService(prisma, auditService, jobs);
    const member = await service.addMember("project-1", "manager-1", {
      email: "dev@example.com",
      projectRole: "dev",
      roleInProject: "Backend",
      allocationPercent: 80,
      weeklyCapacityHours: 32
    });

    expect(member).toMatchObject({ id: "member-1", projectRole: "dev", isActive: true });
    expect(member.user).toEqual({
      id: "dev-1",
      email: "dev@example.com",
      displayName: "Dev User",
      avatarUrl: null,
      jobTitle: "Engineer",
      isActive: true
    });
    expect(JSON.stringify(member)).not.toContain("must-not-leak");
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { normalizedEmail: "dev@example.com" }
    });
    expect(prisma.organizationMembership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "dev-1" } }
    });
    expect(prisma.projectMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: "project-1", userId: "dev-1" } },
        create: expect.objectContaining({
          projectRole: "dev",
          roleInProject: "Backend",
          allocationPercent: 80,
          weeklyCapacityHours: 32,
          isActive: true
        }),
        update: expect.objectContaining({
          projectRole: "dev",
          isActive: true
        })
      })
    );
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "team_member_joined" }));
    expect(jobs.enqueue).toHaveBeenCalled();
  });

  it("blocks membership management by non-project managers", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({ id: "dev-member", projectRole: "dev" });

    const service = new ProjectService(prisma, auditService, jobs);

    await expect(
      service.addMember("project-1", "dev-1", {
        email: "new@example.com",
        projectRole: "dev"
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "manager_access_required" });
    expect(prisma.projectMember.upsert).not.toHaveBeenCalled();
  });

  it("keeps project membership management manager-only in MVP equal-access mode", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValueOnce({ id: "dev-member", projectRole: "dev", isActive: true });

    const service = new ProjectService(prisma, auditService, jobs, {
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"]
    } as any);

    await expect(
      service.addMember("project-1", "dev-1", {
        email: "new@example.com",
        projectRole: "dev"
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "manager_access_required" });
    expect(prisma.projectMember.upsert).not.toHaveBeenCalled();
  });

  it("does not elevate workspace client users through service-level MVP equal access", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({
      id: "client-workspace-member",
      projectRole: "dev",
      isActive: true,
      project: { orgId: "org-1" },
      user: {
        organizationMemberships: [
          {
            organizationId: "org-1",
            workspaceRoleDefault: "client"
          }
        ]
      }
    });

    const service = new ProjectService(prisma, auditService, jobs, {
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"]
    } as any);

    await expect(
      service.ensureProjectMemberCanMutate("project-1", "client-user-1", "mvp_mutation")
    ).rejects.toMatchObject({ statusCode: 403, code: "manager_access_required" });
  });

  it("blocks adding a user from another organization", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({ id: "manager-member", projectRole: "manager" });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", orgId: "org-1" });
    prisma.user.findUnique.mockResolvedValue({ id: "outsider-1", isActive: true });
    prisma.organizationMembership.findUnique.mockResolvedValue(null);

    const service = new ProjectService(prisma, auditService, jobs);

    await expect(
      service.addMember("project-1", "manager-1", {
        email: "outsider@example.com",
        projectRole: "dev"
      })
    ).rejects.toMatchObject({ statusCode: 404, code: "project_member_user_not_found" });
    expect(prisma.projectMember.upsert).not.toHaveBeenCalled();
  });

  it("prevents deactivating the final active project manager", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst
      .mockResolvedValueOnce({ id: "manager-member", projectRole: "manager" })
      .mockResolvedValueOnce({
        id: "member-1",
        projectId: "project-1",
        userId: "manager-1",
        projectRole: "manager",
        isActive: true,
        project: { orgId: "org-1" }
      });
    prisma.projectMember.count.mockResolvedValue(0);

    const service = new ProjectService(prisma, auditService, jobs);

    await expect(
      service.updateMember("project-1", "member-1", "manager-1", { isActive: false })
    ).rejects.toMatchObject({ statusCode: 409, code: "project_final_manager_required" });
    expect(prisma.projectMember.update).not.toHaveBeenCalled();
  });

  it("updates and reactivates a project membership", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst
      .mockResolvedValueOnce({ id: "manager-member", projectRole: "manager" })
      .mockResolvedValueOnce({
        id: "member-1",
        projectId: "project-1",
        userId: "dev-1",
        projectRole: "dev",
        isActive: false,
        project: { orgId: "org-1" }
      });
    prisma.project.findUnique.mockResolvedValue({ id: "project-1", orgId: "org-1" });
    prisma.projectMember.update.mockResolvedValue({
      id: "member-1",
      projectId: "project-1",
      userId: "dev-1",
      projectRole: "dev",
      isActive: true,
      roleInProject: "API",
      allocationPercent: 50,
      weeklyCapacityHours: 20,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      user: {
        id: "dev-1",
        email: "dev@example.com",
        displayName: "Dev User",
        jobTitle: "Engineer",
        isActive: true,
        passwordHash: "must-not-leak"
      }
    });
    prisma.jobRun.upsert.mockResolvedValue({});

    const service = new ProjectService(prisma, auditService, jobs);
    const member = await service.updateMember("project-1", "member-1", "manager-1", {
      roleInProject: "API",
      allocationPercent: 50,
      weeklyCapacityHours: 20,
      isActive: true
    });

    expect(member).toMatchObject({ id: "member-1", isActive: true, roleInProject: "API" });
    expect(member.user).toEqual({
      id: "dev-1",
      email: "dev@example.com",
      displayName: "Dev User",
      avatarUrl: null,
      jobTitle: "Engineer",
      isActive: true
    });
    expect(JSON.stringify(member)).not.toContain("must-not-leak");
    expect(prisma.projectMember.update).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: {
        roleInProject: "API",
        allocationPercent: 50,
        weeklyCapacityHours: 20,
        isActive: true
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            avatarUrl: true,
            jobTitle: true,
            isActive: true
          }
        }
      }
    });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "team_member_role_updated" }));
    expect(jobs.enqueue).toHaveBeenCalled();
  });

  it("returns member lists without password hashes or internal user fields", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({ id: "manager-member", projectRole: "manager" });
    prisma.projectMember.findMany.mockResolvedValue([
      {
        id: "member-1",
        projectId: "project-1",
        userId: "dev-1",
        projectRole: "dev",
        roleInProject: "API",
        allocationPercent: 50,
        weeklyCapacityHours: 20,
        isActive: true,
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        user: {
          id: "dev-1",
          email: "dev@example.com",
          displayName: "Dev User",
          jobTitle: "Engineer",
          isActive: true,
          passwordHash: "must-not-leak",
          globalRole: "member",
          workspaceRoleDefault: "dev"
        }
      }
    ]);

    const service = new ProjectService(prisma, auditService, jobs);
    const result = await service.getMembers("project-1", "manager-1");

    expect(result.members).toHaveLength(1);
    expect(result.members[0].user).toEqual({
      id: "dev-1",
      email: "dev@example.com",
      displayName: "Dev User",
      avatarUrl: null,
      jobTitle: "Engineer",
      isActive: true
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(JSON.stringify(result)).not.toContain("workspaceRoleDefault");
  });

  it("denies project-role clients from internal settings, member, and approver views even if their workspace role is broader", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst.mockResolvedValue({
      id: "client-member",
      projectRole: "client",
      isActive: true,
      user: { workspaceRoleDefault: "dev" }
    });

    const service = new ProjectService(prisma, auditService, jobs);

    await expect(service.getProjectSettings("project-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    await expect(service.getMembers("project-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    await expect(service.listTruthApprovers("project-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(prisma.projectMember.findMany).not.toHaveBeenCalled();
  });

  it("treats active managers and delegated project members as truth approvers in MVP", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst
      .mockResolvedValueOnce({ id: "manager-member", projectRole: "manager", canApproveTruthChanges: false })
      .mockResolvedValueOnce({ id: "dev-member", projectRole: "dev", canApproveTruthChanges: true })
      .mockResolvedValueOnce({ id: "client-member", projectRole: "client", canApproveTruthChanges: true });

    const service = new ProjectService(prisma, auditService, jobs, {
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"]
    } as any);

    await expect(service.ensureProjectTruthApprover("project-1", "manager-1")).resolves.toMatchObject({
      authority: "manager",
      delegatedApproverGrantId: null
    });
    await expect(service.ensureProjectTruthApprover("project-1", "dev-1")).resolves.toMatchObject({
      authority: "delegated_truth_approver",
      delegatedApproverGrantId: "dev-member"
    });
    await expect(service.ensureProjectTruthApprover("project-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "truth_approver_required"
    });
  });

  it("keeps MVP truth-approval grants manager-controlled", async () => {
    const { prisma, auditService, jobs } = createDeps();
    prisma.projectMember.findFirst
      .mockResolvedValueOnce({ id: "manager-member", projectRole: "manager" })
      .mockResolvedValueOnce({
        id: "member-1",
        projectId: "project-1",
        userId: "dev-1",
        projectRole: "dev",
        isActive: true,
        project: { orgId: "org-1" }
      })
      .mockResolvedValueOnce({ id: "manager-member", projectRole: "manager" })
      .mockResolvedValueOnce({
        id: "member-1",
        projectId: "project-1",
        userId: "dev-1",
        projectRole: "dev",
        isActive: true,
        project: { orgId: "org-1" }
      });
    prisma.projectMember.update
      .mockResolvedValueOnce({
        id: "member-1",
        projectId: "project-1",
        userId: "dev-1",
        projectRole: "dev",
        canApproveTruthChanges: true,
        isActive: true,
        responsibilities: [],
        user: { id: "dev-1", email: "dev@example.com", displayName: "Dev User", jobTitle: null, isActive: true }
      })
      .mockResolvedValueOnce({
        id: "member-1",
        projectId: "project-1",
        userId: "dev-1",
        projectRole: "dev",
        canApproveTruthChanges: false,
        isActive: true,
        responsibilities: [],
        user: { id: "dev-1", email: "dev@example.com", displayName: "Dev User", jobTitle: null, isActive: true }
      });

    const service = new ProjectService(prisma, auditService, jobs, {
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"]
    } as any);

    await expect(service.grantTruthApprover("project-1", "manager-1", "member-1")).resolves.toMatchObject({
      id: "member-1",
      canApproveTruthChanges: true
    });
    await expect(service.revokeTruthApprover("project-1", "manager-1", "member-1")).resolves.toMatchObject({
      id: "member-1",
      canApproveTruthChanges: false
    });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "truth_approval_granted" }));
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "truth_approval_revoked" }));
  });
});
