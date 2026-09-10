import type { Prisma, PrismaClient, ProjectRole } from "@prisma/client";
import slugify from "slugify";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import { isMvpBetaMode } from "../../lib/beta/policy.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import { normalizeEmail } from "../../lib/auth/email.js";
import { hashToken } from "../../lib/auth/jwt.js";
import {
  requireAuthorizedProjectRole,
  requireAuthorizedTruthApprover,
  type ActiveProjectAuthorization
} from "../../lib/auth/authorization.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import {
  canProjectMemberManageTeamContext,
  canProjectMemberMutate,
  canProjectMemberUploadContext,
  canProjectMemberUseSocrates
} from "../../lib/mvp/policy.js";
import { toSlug } from "../../lib/utils/slug.js";
import { AuditService } from "../audit/service.js";
import type { AuthEmailService } from "../auth/auth-email.service.js";
import {
  generateProjectInviteLinkToken,
  generateProjectJoinCode,
  getProjectJoinCodePrefix,
  hashProjectJoinCode
} from "./join-codes.js";

const safeProjectMemberUserSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  jobTitle: true,
  isActive: true
} as const;

const projectAccessInclude = {
  project: { select: { orgId: true } },
  user: {
    select: {
      organizationMemberships: {
        where: { isActive: true },
        select: { organizationId: true, workspaceRoleDefault: true }
      }
    }
  }
} satisfies Prisma.ProjectMemberInclude;

type ProjectAccessMember = Prisma.ProjectMemberGetPayload<{ include: typeof projectAccessInclude }>;

function normalizeInviteEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AppError(400, "Invite email must be a valid email address", "invalid_invite_email");
  }
  return normalized;
}

export class ProjectService {
  private readonly projectAccessRequests = new Map<string, Promise<ProjectAccessMember>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly env?: AppEnv,
    private readonly authEmailService?: AuthEmailService
  ) {}

  async createProject(input: {
    orgId: string;
    actorUserId: string;
    name: string;
    description?: string | null;
    previewUrl?: string | null;
  }) {
    const slug = await this.generateUniqueProjectSlug(input.orgId, input.name);
    const project = await this.prisma.project.create({
      data: {
        orgId: input.orgId,
        name: input.name,
        slug,
        description: input.description ?? null,
        previewUrl: input.previewUrl ?? null,
        status: "active",
        createdBy: input.actorUserId,
        members: {
          create: {
            userId: input.actorUserId,
            projectRole: "manager",
            isActive: true,
            canApproveTruthChanges: true,
            truthApprovalGrantedByUserId: input.actorUserId,
            truthApprovalGrantedAt: new Date()
          }
        }
      }
    });

    await this.auditService.record({
      orgId: input.orgId,
      projectId: project.id,
      actorUserId: input.actorUserId,
      eventType: "project_created",
      entityType: "project",
      entityId: project.id,
      payload: { name: project.name }
    });

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, project.id, "project_created", {
      skip: this.shouldSkipDashboardRefresh()
    });

    return project;
  }

  async listProjects(userId: string, orgId: string) {
    return this.prisma.project.findMany({
      where: {
        orgId,
        organization: {
          memberships: {
            some: {
              userId,
              isActive: true
            }
          }
        },
        members: {
          some: {
            userId,
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
  }

  async createJoinCode(
    projectId: string,
    actorUserId: string,
    input?: {
      projectRole?: ProjectRole;
      canApproveTruthChanges?: boolean;
      maxUses?: number;
      expiresAt?: Date;
      invitedEmail?: string | null;
    }
  ) {
    await this.ensureProjectManager(projectId, actorUserId);
    const projectRole = input?.projectRole ?? "dev";
    const canApproveTruthChanges = input?.canApproveTruthChanges ?? false;
    const invitedEmail = normalizeInviteEmail(input?.invitedEmail);
    if (!invitedEmail) {
      throw new AppError(400, "Invite email is required", "invite_email_required");
    }
    if (input?.maxUses !== undefined && input.maxUses !== 1) {
      throw new AppError(400, "Email-bound workspace invites must be single-use", "invite_single_use_required");
    }
    if (projectRole === "client" && canApproveTruthChanges) {
      throw new AppError(403, "Client invitees cannot approve internal truth changes", "client_truth_approval_forbidden");
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true }
    });

    if (!project) {
      throw new AppError(404, "Project not found", "project_not_found");
    }

    const expiresAt = input?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const maxUses = input?.maxUses ?? 1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateProjectJoinCode();
      const linkToken = generateProjectInviteLinkToken();
      try {
        const created = await this.prisma.projectJoinCode.create({
          data: {
            projectId,
            orgId: project.orgId,
            codeHash: hashProjectJoinCode(code),
            codePrefix: getProjectJoinCodePrefix(code),
            linkTokenHash: hashToken(linkToken),
            linkTokenExpiresAt: expiresAt,
            projectRole,
            canApproveTruthChanges,
            maxUses,
            useCount: 0,
            expiresAt,
            invitedEmail,
            createdBy: actorUserId
          }
        });

        await this.auditService.record({
          orgId: project.orgId,
          projectId,
          actorUserId,
          eventType: "team_invite_created",
          entityType: "project_join_code",
          entityId: created.id,
          payload: {
            codePrefix: created.codePrefix,
            projectRole: created.projectRole,
            canApproveTruthChanges: created.canApproveTruthChanges ?? canApproveTruthChanges,
            maxUses: created.maxUses,
            expiresAt: created.expiresAt.toISOString(),
            invitedEmail
          }
        });

        const inviteUrl = new URL("/login", this.env?.FRONTEND_BASE_URL ?? this.env?.APP_BASE_URL ?? "http://localhost:3001");
        inviteUrl.searchParams.set("mode", "join");
        inviteUrl.searchParams.set("email", invitedEmail);
        inviteUrl.searchParams.set("invite_token", linkToken);
        const delivery = this.authEmailService
          ? await this.authEmailService.sendWorkspaceInvite({ projectId, to: invitedEmail, projectName: project.name, activationCode: code, inviteUrl: inviteUrl.toString(), expiresAt }).catch(() => ({ status: "failed" as const, provider: "gmail" as const, from: null, sentAt: null, messageId: null, errorCode: "gmail_delivery_failed" }))
          : { status: "manual_required" as const, provider: null, from: null, sentAt: null, messageId: null, errorCode: "email_service_unavailable" };
        await this.prisma.projectJoinCode.update({
          where: { id: created.id },
          data: {
            emailDeliveryStatus: delivery.status,
            emailDeliveryProvider: delivery.provider,
            emailSentAt: delivery.sentAt,
            emailDeliveryError: delivery.errorCode
          }
        });
        await this.auditService.record({
          orgId: project.orgId,
          projectId,
          actorUserId,
          eventType: delivery.status === "sent" ? "team_invite_email_sent" : "team_invite_email_not_sent",
          entityType: "project_join_code",
          entityId: created.id,
          payload: { provider: delivery.provider, deliveryStatus: delivery.status, errorCode: delivery.errorCode }
        });

        return {
          id: created.id,
          projectId: created.projectId,
          code,
          codePrefix: created.codePrefix,
          projectRole: created.projectRole,
          canApproveTruthChanges: created.canApproveTruthChanges ?? canApproveTruthChanges,
          maxUses: created.maxUses,
          useCount: created.useCount,
          expiresAt: created.expiresAt,
          invitedEmail: created.invitedEmail,
          emailDeliveryStatus: delivery.status,
          emailDeliveryProvider: delivery.provider,
          emailSentAt: delivery.sentAt,
          emailDeliveryError: delivery.errorCode,
          revokedAt: created.revokedAt,
          createdAt: created.createdAt
        };
      } catch (error) {
        const maybePrismaError = error as { code?: string };
        if (maybePrismaError.code !== "P2002" || attempt === 4) {
          throw error;
        }
      }
    }

    throw new AppError(500, "Could not generate workspace join code", "join_code_generation_failed");
  }

  async listJoinCodes(projectId: string, actorUserId: string) {
    await this.ensureProjectManager(projectId, actorUserId);
    return this.prisma.projectJoinCode.findMany({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        codePrefix: true,
        projectRole: true,
        canApproveTruthChanges: true,
        maxUses: true,
        useCount: true,
        expiresAt: true,
        invitedEmail: true,
        emailDeliveryStatus: true,
        emailDeliveryProvider: true,
        emailSentAt: true,
        emailDeliveryError: true,
        revokedAt: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  async revokeJoinCode(projectId: string, codeId: string, actorUserId: string) {
    await this.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true }
    });
    if (!project) {
      throw new AppError(404, "Project not found", "project_not_found");
    }

    const updated = await this.prisma.projectJoinCode.updateMany({
      where: { id: codeId, projectId, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: actorUserId }
    });

    if (updated.count !== 1) {
      throw new AppError(404, "Workspace join code not found", "join_code_not_found");
    }

    const code = await this.prisma.projectJoinCode.findFirst({
      where: { id: codeId, projectId },
      select: {
        id: true,
        projectId: true,
        codePrefix: true,
        projectRole: true,
        canApproveTruthChanges: true,
        maxUses: true,
        useCount: true,
        expiresAt: true,
        invitedEmail: true,
        emailDeliveryStatus: true,
        emailDeliveryProvider: true,
        emailSentAt: true,
        emailDeliveryError: true,
        revokedAt: true,
        createdAt: true
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "team_invite_revoked",
      entityType: "project_join_code",
      entityId: codeId,
      payload: { codePrefix: code?.codePrefix ?? null }
    });

    return code;
  }

  async getProject(projectId: string, userId: string) {
    await this.ensureProjectAccess(projectId, userId);
    return this.prisma.project.findUniqueOrThrow({
      where: { id: projectId }
    });
  }

  async getProjectSettings(projectId: string, actorUserId: string) {
    await this.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        members: {
          where: { isActive: true },
          include: { user: { select: safeProjectMemberUserSelect } },
          orderBy: [{ projectRole: "asc" }, { joinedAt: "asc" }]
        }
      }
    });
    return this.toProjectSettingsDto(project);
  }

  async getProjectSettingsBundle(projectId: string, actorUserId: string) {
    await this.ensureProjectManager(projectId, actorUserId);
    const [project, members, joinCodes] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({
        where: { id: projectId }
      }),
      this.prisma.projectMember.findMany({
        where: {
          projectId,
          isActive: true
        },
        include: {
          user: {
            select: safeProjectMemberUserSelect
          },
          responsibilities: {
            where: {
              status: { in: ["open", "in_progress", "blocked"] }
            },
            select: {
              area: true,
              status: true
            }
          }
        },
        orderBy: [{ projectRole: "asc" }, { joinedAt: "asc" }]
      }),
      this.prisma.projectJoinCode.findMany({
        where: { projectId },
        select: {
          id: true,
          projectId: true,
          codePrefix: true,
          projectRole: true,
          canApproveTruthChanges: true,
          maxUses: true,
          useCount: true,
          expiresAt: true,
          invitedEmail: true,
          revokedAt: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" }
      })
    ]);
    const memberDtos = members.map((member) => this.toProjectMemberDto(member));

    return {
      settings: this.toProjectSettingsDto({ ...project, members }),
      members: memberDtos,
      joinCodes,
      approvers: memberDtos.filter((member) => member.projectRole === "manager" || member.canApproveTruthChanges)
    };
  }

  async updateProjectSettings(projectId: string, actorUserId: string, input: { name?: string; slug?: string; description?: string | null }) {
    await this.ensureProjectManager(projectId, actorUserId);
    const current = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const nextSlug = input.slug !== undefined ? normalizeProjectSlug(input.slug) : undefined;
    if (nextSlug && nextSlug !== current.slug) {
      const existing = await this.prisma.project.findFirst({
        where: { orgId: current.orgId, slug: nextSlug, id: { not: projectId } },
        select: { id: true }
      });
      if (existing) {
        throw new AppError(409, "Workspace slug is already in use", "project_slug_conflict");
      }
    }
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(nextSlug !== undefined ? { slug: nextSlug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {})
      },
      include: {
        members: {
          where: { isActive: true },
          include: { user: { select: safeProjectMemberUserSelect } },
          orderBy: [{ projectRole: "asc" }, { joinedAt: "asc" }]
        }
      }
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "workspace.settings_updated",
      entityType: "project",
      entityId: projectId,
      payload: { changedFields: Object.keys(input), planChanged: false }
    });
    return this.toProjectSettingsDto(project);
  }

  async getMembers(projectId: string, userId: string) {
    await this.ensureProjectMemberCanUseSocrates(projectId, userId);
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        isActive: true
      },
      include: {
        user: {
          select: safeProjectMemberUserSelect
        },
        responsibilities: {
          where: {
            status: { in: ["open", "in_progress", "blocked"] }
          },
          select: {
            area: true,
            status: true
          }
        }
      }
    });

    const headcount = members.length;
    const roleSummary = members.reduce<Record<string, number>>((accumulator, member) => {
      accumulator[member.projectRole] = (accumulator[member.projectRole] ?? 0) + 1;
      return accumulator;
    }, {});

    return {
      members: members.map((member) => this.toProjectMemberDto(member)),
      summary: {
        headcount,
        roleSummary
      }
    };
  }

  async addMember(
    projectId: string,
    actorUserId: string,
    input: {
      email: string;
      projectRole: ProjectRole;
      roleInProject?: string | null;
      allocationPercent?: number | null;
      weeklyCapacityHours?: number | null;
    }
  ) {
    await this.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true }
    });

    if (!project) {
      throw new AppError(404, "Project not found", "project_not_found");
    }

    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail: normalizeEmail(input.email) }
    });
    const organizationMembership = user?.isActive
      ? await this.prisma.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: project.orgId,
              userId: user.id
            }
          }
        })
      : null;

    if (!user || !organizationMembership?.isActive) {
      throw new AppError(404, "User not found in organization", "project_member_user_not_found");
    }

    const existing = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: user.id
      }
    });

    const member = await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId,
          userId: user.id
        }
      },
      create: {
        projectId,
        userId: user.id,
        projectRole: input.projectRole,
        roleInProject: input.roleInProject ?? null,
        allocationPercent: input.allocationPercent ?? null,
        weeklyCapacityHours: input.weeklyCapacityHours ?? null,
        isActive: true
      },
      update: {
        projectRole: input.projectRole,
        roleInProject: input.roleInProject ?? null,
        allocationPercent: input.allocationPercent ?? null,
        weeklyCapacityHours: input.weeklyCapacityHours ?? null,
        isActive: true
      },
      include: {
        user: {
          select: safeProjectMemberUserSelect
        }
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType:
        existing?.isActive === false
          ? "team_member_joined"
          : existing
            ? "team_member_role_updated"
            : "team_member_joined",
      entityType: "project_member",
      entityId: member.id,
      payload: {
        userId: user.id,
        projectRole: member.projectRole,
        roleInProject: member.roleInProject,
        allocationPercent: member.allocationPercent,
        weeklyCapacityHours: member.weeklyCapacityHours
      }
    });

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "project_member_changed", {
      skip: this.shouldSkipDashboardRefresh()
    });

    return this.toProjectMemberDto(member);
  }

  async updateMember(
    projectId: string,
    memberId: string,
    actorUserId: string,
    input: {
      projectRole?: ProjectRole;
      roleInProject?: string | null;
      allocationPercent?: number | null;
      weeklyCapacityHours?: number | null;
      isActive?: boolean;
    }
  ) {
    await this.ensureProjectManager(projectId, actorUserId);

    const existing = await this.prisma.projectMember.findFirst({
      where: {
        id: memberId,
        projectId
      },
      include: {
        project: { select: { orgId: true } },
        user: true
      }
    });

    if (!existing) {
      throw new AppError(404, "Project member not found", "project_member_not_found");
    }

    const nextRole = input.projectRole ?? existing.projectRole;
    const nextIsActive = input.isActive ?? existing.isActive;
    if (existing.projectRole === "manager" && existing.isActive && (nextRole !== "manager" || !nextIsActive)) {
      const otherManagerCount = await this.prisma.projectMember.count({
        where: {
          projectId,
          id: { not: memberId },
          projectRole: "manager",
          isActive: true
        }
      });

      if (otherManagerCount === 0) {
        throw new AppError(409, "Project must keep at least one active manager", "project_final_manager_required");
      }
    }
    const existingApprover =
      existing.isActive &&
      existing.projectRole !== "client" &&
      (existing.projectRole === "manager" || existing.canApproveTruthChanges);
    const nextApprover =
      nextIsActive &&
      nextRole !== "client" &&
      (nextRole === "manager" || existing.canApproveTruthChanges);
    if (existingApprover && !nextApprover) {
      await this.ensureOtherTruthApproverExists(projectId, memberId);
    }

    const data: {
      projectRole?: ProjectRole;
      roleInProject?: string | null;
      allocationPercent?: number | null;
      weeklyCapacityHours?: number | null;
      isActive?: boolean;
      canApproveTruthChanges?: boolean;
      truthApprovalRevokedByUserId?: string | null;
      truthApprovalRevokedAt?: Date | null;
    } = {};

    if (input.projectRole !== undefined) data.projectRole = input.projectRole;
    if (input.roleInProject !== undefined) data.roleInProject = input.roleInProject;
    if (input.allocationPercent !== undefined) data.allocationPercent = input.allocationPercent;
    if (input.weeklyCapacityHours !== undefined) data.weeklyCapacityHours = input.weeklyCapacityHours;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (nextRole === "client") {
      data.canApproveTruthChanges = false;
      data.truthApprovalRevokedByUserId = actorUserId;
      data.truthApprovalRevokedAt = new Date();
    }

    const member = await this.prisma.projectMember.update({
      where: { id: memberId },
      data,
      include: {
        user: {
          select: safeProjectMemberUserSelect
        }
      }
    });

    const eventType =
      existing.isActive === false && member.isActive
        ? "team_member_role_updated"
        : member.isActive === false
          ? "team_member_role_updated"
          : "team_member_role_updated";

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType,
      entityType: "project_member",
      entityId: member.id,
      payload: {
        userId: member.userId,
        projectRole: member.projectRole,
        roleInProject: member.roleInProject,
        allocationPercent: member.allocationPercent,
        weeklyCapacityHours: member.weeklyCapacityHours,
        isActive: member.isActive
      }
    });

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "project_member_changed", {
      skip: this.shouldSkipDashboardRefresh()
    });

    return this.toProjectMemberDto(member);
  }

  async ensureProjectAccess(projectId: string, userId: string) {
    const key = `${projectId}:${userId}`;
    const pending = this.projectAccessRequests.get(key);
    if (pending) return pending;
    const request = this.loadProjectAccess(projectId, userId);
    this.projectAccessRequests.set(key, request);
    const cleanup = () => {
      if (this.projectAccessRequests.get(key) === request) this.projectAccessRequests.delete(key);
    };
    void request.then(cleanup, cleanup);
    return request;
  }

  private async loadProjectAccess(projectId: string, userId: string): Promise<ProjectAccessMember> {
    const member = await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId,
        isActive: true,
        user: { isActive: true },
        project: {
          organization: {
            memberships: {
              some: { userId, isActive: true }
            }
          }
        }
      },
      include: projectAccessInclude
    });

    if (!member) {
      throw new AppError(403, "Project access denied", "project_access_denied");
    }

    return member;
  }

  async ensureProjectManager(projectId: string, userId: string) {
    const member = await this.ensureProjectAccess(projectId, userId);
    requireAuthorizedProjectRole(this.toProjectAuthorization(member), ["manager"]);
    return member;
  }

  async ensureProjectTruthApprover(projectId: string, userId: string) {
    const member = await this.ensureProjectAccess(projectId, userId);
    const approval = requireAuthorizedTruthApprover(this.toProjectAuthorization(member));
    return {
      member,
      authority: approval.authority,
      delegatedApproverGrantId: approval.delegatedApproverGrantId
    };
  }

  async ensureCanManageTruthApprovers(projectId: string, userId: string) {
    return this.ensureProjectManager(projectId, userId);
  }

  async listTruthApprovers(projectId: string, actorUserId: string) {
    await this.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        isActive: true,
        OR: [{ projectRole: "manager" }, { canApproveTruthChanges: true }]
      },
      include: {
        user: {
          select: safeProjectMemberUserSelect
        },
        responsibilities: {
          where: {
            status: { in: ["open", "in_progress", "blocked"] }
          },
          select: {
            area: true,
            status: true
          }
        }
      },
      orderBy: [{ projectRole: "asc" }, { joinedAt: "asc" }]
    });

    return members.map((member) => this.toProjectMemberDto(member));
  }

  async grantTruthApprover(projectId: string, actorUserId: string, memberId: string) {
    await this.ensureCanManageTruthApprovers(projectId, actorUserId);
    const existing = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
      include: {
        project: { select: { orgId: true } },
        user: { select: safeProjectMemberUserSelect }
      }
    });
    if (!existing) {
      throw new AppError(404, "Project member not found", "project_member_not_found");
    }
    if (!existing.isActive) {
      throw new AppError(409, "Inactive project members cannot approve truth changes", "truth_approver_member_inactive");
    }
    if (existing.projectRole === "client") {
      throw new AppError(403, "Client members cannot approve internal truth changes", "client_truth_approval_forbidden");
    }

    const member = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: {
        canApproveTruthChanges: true,
        truthApprovalGrantedByUserId: actorUserId,
        truthApprovalGrantedAt: new Date(),
        truthApprovalRevokedByUserId: null,
        truthApprovalRevokedAt: null
      },
      include: {
        user: { select: safeProjectMemberUserSelect },
        responsibilities: {
          where: {
            status: { in: ["open", "in_progress", "blocked"] }
          },
          select: {
            area: true,
            status: true
          }
        }
      }
    });

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType: "truth_approval_granted",
      entityType: "project_member",
      entityId: member.id,
      payload: {
        memberId: member.id,
        userId: member.userId,
        projectRole: member.projectRole
      }
    });

    return this.toProjectMemberDto(member);
  }

  async revokeTruthApprover(projectId: string, actorUserId: string, memberId: string) {
    await this.ensureCanManageTruthApprovers(projectId, actorUserId);
    const existing = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
      include: {
        project: { select: { orgId: true } },
        user: { select: safeProjectMemberUserSelect }
      }
    });
    if (!existing) {
      throw new AppError(404, "Project member not found", "project_member_not_found");
    }
    if (existing.isActive && existing.projectRole !== "client" && existing.canApproveTruthChanges) {
      await this.ensureOtherTruthApproverExists(projectId, memberId);
    }

    const member = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: {
        canApproveTruthChanges: false,
        truthApprovalRevokedByUserId: actorUserId,
        truthApprovalRevokedAt: new Date()
      },
      include: {
        user: { select: safeProjectMemberUserSelect },
        responsibilities: {
          where: {
            status: { in: ["open", "in_progress", "blocked"] }
          },
          select: {
            area: true,
            status: true
          }
        }
      }
    });

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType: "truth_approval_revoked",
      entityType: "project_member",
      entityId: member.id,
      payload: {
        memberId: member.id,
        userId: member.userId,
        projectRole: member.projectRole
      }
    });

    return this.toProjectMemberDto(member);
  }

  async ensureProjectMemberCanMutate(projectId: string, userId: string, _action = "mutate_project") {
    const member = await this.ensureProjectAccess(projectId, userId);
    if (!canProjectMemberMutate(this.env, this.toPolicyMembership(member))) {
      throw new AppError(403, "Manager access required", "manager_access_required");
    }
    return member;
  }

  async ensureProjectMemberCanUploadContext(projectId: string, userId: string) {
    const member = await this.ensureProjectAccess(projectId, userId);
    if (!canProjectMemberUploadContext(this.env, this.toPolicyMembership(member))) {
      throw new AppError(403, "Manager access required", "manager_access_required");
    }
    return member;
  }

  async ensureProjectMemberCanUseSocrates(projectId: string, userId: string) {
    const member = await this.ensureProjectAccess(projectId, userId);
    if (!canProjectMemberUseSocrates(this.env, this.toPolicyMembership(member))) {
      throw new AppError(403, "Project access denied", "project_access_denied");
    }
    return member;
  }

  async ensureProjectMemberCanManageTeamContext(projectId: string, userId: string) {
    const member = await this.ensureProjectAccess(projectId, userId);
    if (!canProjectMemberManageTeamContext(this.env, this.toPolicyMembership(member))) {
      throw new AppError(403, "Manager access required", "manager_access_required");
    }
    return member;
  }

  async ensureProjectMemberCanViewProjectAudit(projectId: string, userId: string) {
    return this.ensureProjectMemberCanManageTeamContext(projectId, userId);
  }

  private async generateUniqueProjectSlug(orgId: string, name: string) {
    const baseSlug = toSlug(name);
    let candidate = baseSlug;
    let suffix = 1;

    while (true) {
      const existing = await this.prisma.project.findFirst({
        where: {
          orgId,
          slug: candidate
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return candidate;
      }

      suffix += 1;
      candidate = `${baseSlug}-${suffix}`;
    }
  }

  private shouldSkipDashboardRefresh() {
    return this.env ? isMvpBetaMode(this.env) : false;
  }

  private async ensureOtherTruthApproverExists(projectId: string, excludingMemberId: string) {
    const otherApproverCount = await this.prisma.projectMember.count({
      where: {
        projectId,
        id: { not: excludingMemberId },
        isActive: true,
        projectRole: { not: "client" },
        OR: [{ projectRole: "manager" }, { canApproveTruthChanges: true }]
      }
    });

    if (otherApproverCount === 0) {
      throw new AppError(409, "Project must keep at least one active truth approver", "project_final_truth_approver_required");
    }
  }

  private toPolicyMembership(member: {
    projectRole: ProjectRole;
    isActive?: boolean | null;
    project?: { orgId?: string | null } | null;
    user?: {
      organizationMemberships?: Array<{
        organizationId: string;
        workspaceRoleDefault: "manager" | "dev" | "client";
      }>;
    } | null;
  }) {
    const activeOrganizationRole = member.user?.organizationMemberships?.find(
      (membership) => membership.organizationId === member.project?.orgId
    )?.workspaceRoleDefault;
    return {
      projectRole: member.projectRole,
      isActive: member.isActive ?? true,
      workspaceRoleDefault: activeOrganizationRole ?? null
    };
  }

  private toProjectAuthorization(member: {
    id: string;
    projectId: string;
    userId: string;
    projectRole: ProjectRole;
    canApproveTruthChanges: boolean;
    isActive: boolean;
  }): ActiveProjectAuthorization {
    return {
      id: member.id,
      projectId: member.projectId,
      userId: member.userId,
      projectRole: member.projectRole,
      canApproveTruthChanges: member.canApproveTruthChanges,
      isActive: true
    };
  }

  private toProjectMemberDto(member: {
    id: string;
    projectId: string;
    userId: string;
    projectRole: ProjectRole;
    roleInProject?: string | null;
    allocationPercent?: number | null;
    weeklyCapacityHours?: number | null;
    canApproveTruthChanges?: boolean;
    truthApprovalGrantedByUserId?: string | null;
    truthApprovalGrantedAt?: Date | null;
    truthApprovalRevokedByUserId?: string | null;
    truthApprovalRevokedAt?: Date | null;
    isActive: boolean;
    joinedAt?: Date;
    updatedAt?: Date;
    responsibilities?: Array<{
      area: string;
      status: string;
    }>;
      user?: {
      id: string;
      email: string;
      displayName: string;
      avatarUrl?: string | null;
      jobTitle?: string | null;
      isActive: boolean;
    } | null;
  }) {
    return {
      id: member.id,
      projectId: member.projectId,
      userId: member.userId,
      projectRole: member.projectRole,
      roleInProject: member.roleInProject ?? null,
      allocationPercent: member.allocationPercent ?? null,
      weeklyCapacityHours: member.weeklyCapacityHours ?? null,
      canApproveTruthChanges: member.projectRole === "manager" || Boolean(member.canApproveTruthChanges),
      truthApprovalGrantedByUserId: member.truthApprovalGrantedByUserId ?? null,
      truthApprovalGrantedAt: member.truthApprovalGrantedAt ?? null,
      truthApprovalRevokedByUserId: member.truthApprovalRevokedByUserId ?? null,
      truthApprovalRevokedAt: member.truthApprovalRevokedAt ?? null,
      isActive: member.isActive,
      joinedAt: member.joinedAt,
      updatedAt: member.updatedAt,
      activeResponsibilitiesCount: member.responsibilities?.length ?? 0,
      blockedResponsibilitiesCount:
        member.responsibilities?.filter((responsibility) => responsibility.status === "blocked").length ?? 0,
      primaryResponsibilityAreas: this.primaryResponsibilityAreas(member.responsibilities ?? []),
      user: member.user
        ? {
            id: member.user.id,
            email: member.user.email,
            displayName: member.user.displayName,
            avatarUrl: member.user.avatarUrl ?? null,
            jobTitle: member.user.jobTitle ?? null,
            isActive: member.user.isActive
          }
        : null
    };
  }

  private primaryResponsibilityAreas(responsibilities: Array<{ area: string }>) {
    return Object.entries(
      responsibilities.reduce<Record<string, number>>((accumulator, responsibility) => {
        accumulator[responsibility.area] = (accumulator[responsibility.area] ?? 0) + 1;
        return accumulator;
      }, {})
    )
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([area]) => area);
  }

  private toProjectSettingsDto(project: {
    id: string;
    orgId: string;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    members?: Array<{
      id: string;
      userId: string;
      projectRole: ProjectRole;
      canApproveTruthChanges: boolean;
      user?: { displayName: string; email: string } | null;
    }>;
  }) {
    const members = project.members ?? [];
    const managers = members.filter((member) => member.projectRole === "manager");
    return {
      projectId: project.id,
      organizationId: project.orgId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      planLabel: "Private pilot",
      avatarUrl: null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      owner: managers[0]
        ? {
            memberId: managers[0].id,
            userId: managers[0].userId,
            displayName: managers[0].user?.displayName ?? null,
            email: managers[0].user?.email ?? null
          }
        : null,
      managerSummary: {
        count: managers.length,
        labels: managers.slice(0, 5).map((member) => member.user?.displayName ?? member.user?.email ?? member.userId)
      },
      featureFlags: {
        privatePilot: true,
        billingEnabled: false,
        profileSettingsEnabled: true,
        integrationManagementEnabled: true
      }
    };
  }
}

function normalizeProjectSlug(value: string) {
  const normalized = slugify(value, { lower: true, strict: true, trim: true });
  if (normalized.length < 2 || normalized.length > 80) {
    throw new AppError(400, "Workspace slug must be 2-80 URL-safe characters", "project_slug_invalid");
  }
  return normalized;
}
