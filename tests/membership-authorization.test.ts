import { describe, expect, it, vi } from "vitest";
import {
  authorizeActiveOrganization,
  authorizeActiveProject,
  requireAuthorizedProjectRole,
  requireAuthorizedTruthApprover
} from "../src/lib/auth/authorization.js";
import { blockClientInternalAccess } from "../src/app/auth.js";

describe("centralized membership authorization", () => {
  it("[FIX-36] shares a concurrent active-project authorization read but rechecks later calls", async () => {
    const prisma = {
      projectMember: {
        findFirst: vi.fn(async () => ({
          id: "project-membership-1",
          projectId: "project-1",
          userId: "user-1",
          projectRole: "manager",
          canApproveTruthChanges: true,
          isActive: true
        }))
      }
    } as any;
    const input = { userId: "user-1", orgId: "org-1", projectId: "project-1" };

    await Promise.all(Array.from({ length: 6 }, () => authorizeActiveProject(prisma, input)));
    expect(prisma.projectMember.findFirst).toHaveBeenCalledTimes(1);
    await authorizeActiveProject(prisma, input);
    expect(prisma.projectMember.findFirst).toHaveBeenCalledTimes(2);
  });

  it("hydrates the active organization and roles only from OrganizationMembership", async () => {
    const prisma = {
      organizationMembership: {
        findUnique: vi.fn(async () => ({
          id: "membership-1",
          organizationId: "org-active",
          userId: "user-1",
          globalRole: "member",
          workspaceRoleDefault: "dev",
          isActive: true,
          user: { isActive: true }
        }))
      }
    } as any;

    const principal = await authorizeActiveOrganization(prisma, "user-1", "org-active");

    expect(principal).toEqual({
      organizationMembershipId: "membership-1",
      userId: "user-1",
      orgId: "org-active",
      globalRole: "member",
      workspaceRoleDefault: "dev"
    });
    expect(prisma.organizationMembership.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: "org-active",
          userId: "user-1"
        }
      },
      select: expect.objectContaining({
        id: true,
        organizationId: true,
        userId: true,
        isActive: true,
        user: { select: { isActive: true } }
      })
    });
  });

  it("rejects inactive users and inactive or missing organization memberships", async () => {
    const inactiveUserPrisma = {
      organizationMembership: {
        findUnique: vi.fn(async () => ({
          id: "membership-1",
          organizationId: "org-1",
          userId: "user-1",
          globalRole: "owner",
          workspaceRoleDefault: "manager",
          isActive: true,
          user: { isActive: false }
        }))
      }
    } as any;
    await expect(authorizeActiveOrganization(inactiveUserPrisma, "user-1", "org-1")).rejects.toMatchObject({
      statusCode: 401,
      code: "auth_user_inactive"
    });

    const inactiveMembershipPrisma = {
      organizationMembership: {
        findUnique: vi.fn(async () => ({
          id: "membership-1",
          organizationId: "org-1",
          userId: "user-1",
          globalRole: "owner",
          workspaceRoleDefault: "manager",
          isActive: false,
          user: { isActive: true }
        }))
      }
    } as any;
    await expect(authorizeActiveOrganization(inactiveMembershipPrisma, "user-1", "org-1")).rejects.toMatchObject({
      statusCode: 401,
      code: "auth_membership_inactive"
    });
  });

  it("binds project authorization to the active organization and active project membership", async () => {
    const prisma = {
      projectMember: {
        findFirst: vi.fn(async () => ({
          id: "project-membership-1",
          projectId: "project-1",
          userId: "user-1",
          projectRole: "manager",
          canApproveTruthChanges: true,
          isActive: true
        }))
      }
    } as any;

    const authorization = await authorizeActiveProject(prisma, {
      userId: "user-1",
      orgId: "org-active",
      projectId: "project-1"
    });

    expect(authorization.projectRole).toBe("manager");
    expect(prisma.projectMember.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        userId: "user-1",
        isActive: true,
        project: { orgId: "org-active" },
        user: { isActive: true }
      },
      select: expect.objectContaining({ projectRole: true, canApproveTruthChanges: true })
    });
  });

  it("rejects cross-tenant project IDs without revealing whether the project exists", async () => {
    const prisma = {
      projectMember: { findFirst: vi.fn(async () => null) }
    } as any;

    await expect(
      authorizeActiveProject(prisma, {
        userId: "user-1",
        orgId: "org-active",
        projectId: "project-in-another-org"
      })
    ).rejects.toMatchObject({ statusCode: 403, code: "project_access_denied" });
  });

  it("keeps role escalation and truth approval explicit", () => {
    const dev = {
      id: "member-dev",
      projectId: "project-1",
      userId: "user-dev",
      projectRole: "dev" as const,
      canApproveTruthChanges: false,
      isActive: true as const
    };
    expect(() => requireAuthorizedProjectRole(dev, ["manager"])).toThrowError(
      expect.objectContaining({ code: "manager_access_required" })
    );
    expect(() => requireAuthorizedTruthApprover(dev)).toThrowError(
      expect.objectContaining({ code: "truth_approver_required" })
    );

    const delegated = { ...dev, canApproveTruthChanges: true };
    expect(requireAuthorizedTruthApprover(delegated)).toMatchObject({
      authority: "delegated_truth_approver",
      delegatedApproverGrantId: "member-dev"
    });

    const corruptedClient = { ...delegated, projectRole: "client" as const };
    expect(() => requireAuthorizedTruthApprover(corruptedClient)).toThrowError(
      expect.objectContaining({ code: "truth_approver_required" })
    );
  });

  it("uses the project role to keep project clients out of internal routes", () => {
    const request = {
      authUser: { workspaceRoleDefault: "manager" },
      projectAuthorization: {
        id: "member-client",
        projectId: "project-1",
        userId: "user-1",
        projectRole: "client",
        canApproveTruthChanges: false,
        isActive: true,
      },
    } as any;

    expect(() => blockClientInternalAccess(request)).toThrowError(
      expect.objectContaining({ code: "client_internal_access_forbidden" })
    );
  });
});
