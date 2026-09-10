import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import {
  authorizeActiveOrganization,
  authorizeActiveProject,
  requireAuthorizedProjectRole,
  requireAuthorizedTruthApprover
} from "../lib/auth/authorization.js";
import type { AuthenticatedProfile } from "../modules/auth/service.js";

export async function requireAuth(request: FastifyRequest) {
  await request.jwtVerify();
  const signedUser = request.user as (typeof request.authUser & { typ?: string }) | undefined;
  if (!signedUser) {
    throw new AppError(401, "Authentication required", "auth_required");
  }
  if (signedUser.typ !== "access") {
    throw new AppError(401, "Invalid token type", "auth_invalid_token_type");
  }

  const activeOrganization = signedUser.sessionId
    ? await request.appContext.services.authService.authorizeSessionContext(
        signedUser.sessionId,
        signedUser.userId,
        signedUser.orgId
      )
    : await authorizeActiveOrganization(
        request.appContext.prisma,
        signedUser.userId,
        signedUser.orgId
      );

  request.authUser = {
    userId: activeOrganization.userId,
    orgId: activeOrganization.orgId,
    sessionId: signedUser.sessionId,
    organizationMembershipId: activeOrganization.organizationMembershipId,
    workspaceRoleDefault: activeOrganization.workspaceRoleDefault,
    globalRole: activeOrganization.globalRole
  };
  if ("profile" in activeOrganization) request.authProfile = activeOrganization.profile as AuthenticatedProfile;
}

async function requireActiveProjectContext(request: FastifyRequest) {
  const params = request.params as { projectId?: unknown } | null | undefined;
  const projectId = typeof params?.projectId === "string" ? params.projectId : null;
  if (!projectId) return;
  request.projectAuthorization = await authorizeActiveProject(request.appContext.prisma, {
    userId: request.authUser!.userId,
    orgId: request.authUser!.orgId,
    projectId
  });
}

export function requireWorkspaceRole(request: FastifyRequest, roles: Array<"manager" | "dev" | "client">) {
  const role = request.authUser?.workspaceRoleDefault;
  if (!role || !roles.includes(role)) {
    throw new AppError(403, "Forbidden", "forbidden");
  }
}

export function requireManager(request: FastifyRequest) {
  if (request.projectAuthorization) {
    requireAuthorizedProjectRole(request.projectAuthorization, ["manager"]);
    return;
  }
  requireWorkspaceRole(request, ["manager"]);
}

export function requireProjectRole(request: FastifyRequest, roles: Array<"manager" | "dev" | "client">) {
  return requireAuthorizedProjectRole(request.projectAuthorization, roles);
}

export function requireTruthApprover(request: FastifyRequest) {
  return requireAuthorizedTruthApprover(request.projectAuthorization);
}

export function blockClientInternalAccess(request: FastifyRequest) {
  const activeRole = request.projectAuthorization?.projectRole ?? request.authUser?.workspaceRoleDefault;
  if (activeRole === "client") {
    throw new AppError(403, "Client users must use the client portal", "client_internal_access_forbidden");
  }
}

export function authGuard(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request);
    return handler(request, reply);
  };
}

export function internalAuthGuard(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request);
    await requireActiveProjectContext(request);
    blockClientInternalAccess(request);
    return handler(request, reply);
  };
}
