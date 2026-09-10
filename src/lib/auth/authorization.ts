import type { GlobalRole, PrismaClient, ProjectRole, WorkspaceRoleDefault } from "@prisma/client";
import { AppError } from "../../app/errors.js";

type OrganizationAuthorizationPrisma = Pick<PrismaClient, "organizationMembership">;
type ProjectAuthorizationPrisma = Pick<PrismaClient, "projectMember">;

const projectAuthorizationRequests = new WeakMap<object, Map<string, Promise<ActiveProjectAuthorization>>>();

export type ActiveOrganizationAuthorization = {
  organizationMembershipId: string;
  userId: string;
  orgId: string;
  globalRole: GlobalRole;
  workspaceRoleDefault: WorkspaceRoleDefault;
};

export type ActiveProjectAuthorization = {
  id: string;
  projectId: string;
  userId: string;
  projectRole: ProjectRole;
  canApproveTruthChanges: boolean;
  isActive: true;
};

export async function authorizeActiveOrganization(
  prisma: OrganizationAuthorizationPrisma,
  userId: string,
  organizationId: string
): Promise<ActiveOrganizationAuthorization> {
  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId }
    },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      globalRole: true,
      workspaceRoleDefault: true,
      isActive: true,
      user: { select: { isActive: true } }
    }
  });

  if (membership && !membership.user.isActive) {
    throw new AppError(401, "Authenticated user is inactive", "auth_user_inactive");
  }
  if (!membership?.isActive) {
    throw new AppError(401, "Active organization membership required", "auth_membership_inactive");
  }

  return {
    organizationMembershipId: membership.id,
    userId: membership.userId,
    orgId: membership.organizationId,
    globalRole: membership.globalRole,
    workspaceRoleDefault: membership.workspaceRoleDefault
  };
}

export async function authorizeActiveProject(
  prisma: ProjectAuthorizationPrisma,
  input: { userId: string; orgId: string; projectId: string }
): Promise<ActiveProjectAuthorization> {
  let requests = projectAuthorizationRequests.get(prisma as object);
  if (!requests) {
    requests = new Map();
    projectAuthorizationRequests.set(prisma as object, requests);
  }
  const key = `${input.userId}:${input.orgId}:${input.projectId}`;
  const pending = requests.get(key);
  if (pending) return pending;

  const request = loadActiveProjectAuthorization(prisma, input);
  requests.set(key, request);
  const cleanup = () => {
    if (requests?.get(key) === request) requests.delete(key);
  };
  void request.then(cleanup, cleanup);
  return request;
}

async function loadActiveProjectAuthorization(
  prisma: ProjectAuthorizationPrisma,
  input: { userId: string; orgId: string; projectId: string }
): Promise<ActiveProjectAuthorization> {
  const membership = await prisma.projectMember.findFirst({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      isActive: true,
      project: { orgId: input.orgId },
      user: { isActive: true }
    },
    select: {
      id: true,
      projectId: true,
      userId: true,
      projectRole: true,
      canApproveTruthChanges: true,
      isActive: true
    }
  });

  if (!membership) {
    throw new AppError(403, "Project access denied", "project_access_denied");
  }

  return { ...membership, isActive: true };
}

export function requireAuthorizedProjectRole(
  authorization: ActiveProjectAuthorization | null | undefined,
  roles: ProjectRole[]
) {
  if (!authorization || !roles.includes(authorization.projectRole)) {
    const managerOnly = roles.length === 1 && roles[0] === "manager";
    throw new AppError(
      403,
      managerOnly ? "Manager access required" : "Project role access required",
      managerOnly ? "manager_access_required" : "project_role_required"
    );
  }
  return authorization;
}

export function requireAuthorizedTruthApprover(
  authorization: ActiveProjectAuthorization | null | undefined
) {
  if (!authorization || !authorization.isActive || authorization.projectRole === "client") {
    throw new AppError(403, "Truth approval authority required", "truth_approver_required");
  }
  if (authorization.projectRole === "manager") {
    return {
      authorization,
      authority: "manager" as const,
      delegatedApproverGrantId: null
    };
  }
  if (authorization.canApproveTruthChanges) {
    return {
      authorization,
      authority: "delegated_truth_approver" as const,
      delegatedApproverGrantId: authorization.id
    };
  }
  throw new AppError(403, "Truth approval authority required", "truth_approver_required");
}
