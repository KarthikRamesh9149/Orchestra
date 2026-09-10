import { AppError } from "../../app/errors.js";
import type { AuditService } from "../audit/service.js";
import { Prisma, type PrismaClient, type ProjectRole } from "@prisma/client";

type Actor = { userId: string; orgId: string };

const DEFAULT_NOTIFICATION_PREFERENCES = {
  productUpdates: false,
  projectActivity: true,
  approvalRequests: true,
  slackSyncAlerts: true,
  calendarReminders: true,
  socratesDigests: false,
  securityAlerts: true,
  emailEnabled: true,
  inAppEnabled: true
};

export class MeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async getProfile(actor: Actor, currentSessionId?: string) {
    const { user, membership } = await this.findActiveUser(actor);
    const activeSession = currentSessionId
      ? await this.prisma.refreshToken.findFirst({
          where: {
            sessionId: currentSessionId,
            userId: actor.userId,
            orgId: actor.orgId,
            revokedAt: null,
            reuseDetectedAt: null,
            expiresAt: { gt: new Date() }
          },
          orderBy: { lastUsedAt: "desc" },
          select: { activeProjectId: true }
        })
      : null;
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      timezone: user.timezone ?? null,
      locale: user.locale ?? null,
      emailVerified: Boolean(user.emailVerifiedAt),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      globalRole: membership.globalRole,
      workspaceRoleDefault: membership.workspaceRoleDefault,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      defaultProjectId: activeSession?.activeProjectId ?? null,
      activeProjectId: activeSession?.activeProjectId ?? null,
      profileCompleted: Boolean(user.displayName && user.email)
    };
  }

  async updateProfile(actor: Actor, input: { displayName?: string; timezone?: string | null; locale?: string | null }) {
    const { membership } = await this.findActiveUser(actor);
    const updated = await this.prisma.user.update({
      where: { id: actor.userId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {})
      }
    });
    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "profile.updated",
      entityType: "user",
      entityId: actor.userId,
      payload: {
        changedFields: Object.keys(input),
        emailChanged: false,
        roleChanged: false
      }
    });
    return {
      userId: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl ?? null,
      timezone: updated.timezone ?? null,
      locale: updated.locale ?? null,
      emailVerified: Boolean(updated.emailVerifiedAt),
      emailVerifiedAt: updated.emailVerifiedAt?.toISOString() ?? null,
      globalRole: membership.globalRole,
      workspaceRoleDefault: membership.workspaceRoleDefault,
      createdAt: updated.createdAt.toISOString(),
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      defaultProjectId: null,
      activeProjectId: null,
      profileCompleted: Boolean(updated.displayName && updated.email)
    };
  }

  async uploadAvatarDisabled(actor: Actor) {
    await this.findActiveUser(actor);
    throw new AppError(503, "Avatar upload storage is not configured for this private pilot", "feature_not_configured");
  }

  async getNotificationPreferences(actor: Actor) {
    await this.findActiveUser(actor);
    const prefs = await this.prisma.userNotificationPreference.upsert({
      where: { userId: actor.userId },
      create: { userId: actor.userId, orgId: actor.orgId, ...DEFAULT_NOTIFICATION_PREFERENCES },
      update: {}
    });
    return this.toNotificationDto(prefs);
  }

  async updateNotificationPreferences(actor: Actor, input: Partial<typeof DEFAULT_NOTIFICATION_PREFERENCES>) {
    await this.findActiveUser(actor);
    if (input.securityAlerts === false) {
      throw new AppError(400, "Security alerts cannot be disabled", "security_alerts_required");
    }
    const prefs = await this.prisma.userNotificationPreference.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        orgId: actor.orgId,
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...input,
        securityAlerts: true
      },
      update: {
        ...input,
        securityAlerts: true
      }
    });
    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "notification_preferences.updated",
      entityType: "user_notification_preferences",
      entityId: prefs.id,
      payload: { changedFields: Object.keys(input), securityAlerts: true }
    });
    return this.toNotificationDto(prefs);
  }

  async getAppearancePreference(actor: Actor) {
    await this.findActiveUser(actor);
    const preference = await this.prisma.userNotificationPreference.upsert({
      where: { userId: actor.userId },
      create: { userId: actor.userId, orgId: actor.orgId, ...DEFAULT_NOTIFICATION_PREFERENCES },
      update: {},
      select: { appearanceTheme: true, updatedAt: true }
    });
    return { theme: preference.appearanceTheme, updatedAt: preference.updatedAt.toISOString() };
  }

  async updateAppearancePreference(actor: Actor, theme: "light" | "dark" | "auto") {
    await this.findActiveUser(actor);
    const preference = await this.prisma.userNotificationPreference.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        orgId: actor.orgId,
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        appearanceTheme: theme
      },
      update: { appearanceTheme: theme },
      select: { id: true, appearanceTheme: true, updatedAt: true }
    });
    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "appearance_preference.updated",
      entityType: "user_notification_preferences",
      entityId: preference.id,
      payload: { theme: preference.appearanceTheme }
    });
    return { theme: preference.appearanceTheme, updatedAt: preference.updatedAt.toISOString() };
  }

  async listLinkedAccounts(actor: Actor) {
    await this.findActiveUser(actor);
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId: actor.userId, isActive: true },
      select: { organizationId: true }
    });
    const organizationIds = memberships.map((membership) => membership.organizationId);
    if (organizationIds.length === 0) return [];

    const [githubLinks, driveConnections, calendarConnections, communicationConnectors] = await Promise.all([
      this.prisma.gitHubUserLink.findMany({
        where: { userId: actor.userId, orgId: { in: organizationIds }, status: "active", revokedAt: null },
        select: { id: true, githubLogin: true, linkedAt: true, status: true }
      }),
      this.prisma.projectDriveConnection.findMany({
        where: {
          connectedByUserId: actor.userId,
          status: { in: ["connected", "syncing", "needs_reauth", "error"] },
          project: { orgId: { in: organizationIds } }
        },
        select: { id: true, googleAccountEmail: true, googleAccountSub: true, status: true, connectedAt: true, createdAt: true }
      }),
      this.prisma.projectCalendarConnection.findMany({
        where: {
          createdBy: actor.userId,
          provider: { in: ["google_calendar", "outlook_calendar"] },
          status: { in: ["connected", "syncing", "error"] },
          project: { orgId: { in: organizationIds } }
        },
        select: { id: true, provider: true, accountLabel: true, status: true, createdAt: true }
      }),
      this.prisma.communicationConnector.findMany({
        where: {
          createdBy: actor.userId,
          provider: { in: ["gmail", "outlook", "microsoft_teams"] },
          status: { in: ["connected", "syncing", "error"] },
          project: { orgId: { in: organizationIds } }
        },
        select: { id: true, provider: true, accountLabel: true, status: true, createdAt: true }
      })
    ]);

    type LinkedAccount = {
      id: string;
      service: "google" | "github" | "microsoft";
      connected: boolean;
      accountIdentifier: string;
      status: string;
      linkedAt: string;
      sources: string[];
    };
    const accounts = new Map<string, LinkedAccount>();
    const add = (account: LinkedAccount) => {
      const identifier = account.accountIdentifier.trim();
      const key = `${account.service}:${identifier ? identifier.toLowerCase() : account.id}`;
      const existing = accounts.get(key);
      if (!existing) {
        accounts.set(key, { ...account, accountIdentifier: identifier });
        return;
      }
      accounts.set(key, {
        ...existing,
        connected: existing.connected || account.connected,
        status: existing.connected ? existing.status : account.status,
        linkedAt: existing.linkedAt < account.linkedAt ? existing.linkedAt : account.linkedAt,
        sources: Array.from(new Set([...existing.sources, ...account.sources])).sort()
      });
    };

    for (const link of githubLinks) {
      add({
        id: `github:${link.id}`,
        service: "github",
        connected: true,
        accountIdentifier: link.githubLogin,
        status: link.status,
        linkedAt: link.linkedAt.toISOString(),
        sources: ["github_user_link"]
      });
    }
    for (const connection of driveConnections) {
      add({
        id: `google:${connection.id}`,
        service: "google",
        connected: connection.status === "connected" || connection.status === "syncing",
        accountIdentifier: connection.googleAccountEmail ?? connection.googleAccountSub ?? "",
        status: connection.status,
        linkedAt: (connection.connectedAt ?? connection.createdAt).toISOString(),
        sources: ["google_drive"]
      });
    }
    for (const connection of calendarConnections) {
      const service = connection.provider === "google_calendar" ? "google" : "microsoft";
      add({
        id: `${service}:${connection.id}`,
        service,
        connected: connection.status === "connected" || connection.status === "syncing",
        accountIdentifier: connection.accountLabel,
        status: connection.status,
        linkedAt: connection.createdAt.toISOString(),
        sources: [connection.provider]
      });
    }
    for (const connector of communicationConnectors) {
      const service = connector.provider === "gmail" ? "google" : "microsoft";
      add({
        id: `${service}:${connector.id}`,
        service,
        connected: connector.status === "connected" || connector.status === "syncing",
        accountIdentifier: connector.accountLabel,
        status: connector.status,
        linkedAt: connector.createdAt.toISOString(),
        sources: [connector.provider]
      });
    }

    return Array.from(accounts.values()).sort((left, right) =>
      left.service.localeCompare(right.service) || left.accountIdentifier.localeCompare(right.accountIdentifier)
    );
  }

  async listSessions(actor: Actor, currentSessionId?: string) {
    await this.findActiveUser(actor);
    const tokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: actor.userId,
        revokedAt: null,
        reuseDetectedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { organization: { select: { id: true, name: true } } }
    });
    const families = new Map<string, (typeof tokens)[number]>();
    for (const token of tokens) {
      if (!families.has(token.sessionId)) families.set(token.sessionId, token);
    }
    const sessions = Array.from(families.values()).slice(0, 50);
    return sessions.map((session) => ({
      id: session.sessionId,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: currentSessionId ? session.sessionId === currentSessionId : false,
      deviceLabel: session.deviceLabel ?? (session.clientType === "bearer" ? "API or developer client" : "Browser session"),
      deviceType: session.deviceType ?? (session.clientType === "bearer" ? "api" : "browser"),
      ipLabel: session.ipLabel,
      organization: session.organization,
      status: "active" as const,
      revokedAt: null,
      revokeReason: null
    }));
  }

  async revokeSession(actor: Actor, sessionId: string) {
    await this.findActiveUser(actor);
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        sessionId,
        userId: actor.userId,
        revokedAt: null,
        reuseDetectedAt: null
      },
      data: { revokedAt: new Date(), revokeReason: "user_revoked" }
    });
    if (result.count === 0) {
      throw new AppError(404, "Session not found", "session_not_found");
    }
    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "session.revoked",
      entityType: "refresh_token",
      entityId: sessionId,
      payload: { revokedByUser: true }
    });
    return { revoked: true, sessionId };
  }

  async revokeAllSessions(actor: Actor, input?: { includeCurrent?: boolean; currentSessionId?: string }) {
    await this.findActiveUser(actor);
    const currentSessionId = input?.currentSessionId;
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId: actor.userId,
        revokedAt: null,
        reuseDetectedAt: null,
        ...(input?.includeCurrent || !currentSessionId ? {} : { sessionId: { not: currentSessionId } })
      },
      data: { revokedAt: new Date(), revokeReason: "user_revoked_all" }
    });
    await this.auditService.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType: "sessions.revoked_all",
      entityType: "user",
      entityId: actor.userId,
      payload: { revokedCount: result.count, includeCurrent: Boolean(input?.includeCurrent) }
    });
    return { revoked: result.count };
  }

  async listWorkspaces(actor: Actor, currentSessionId?: string) {
    // One fresh read, not nested Prisma relation SELECTs over a remote DB.
    // Organization and project membership are both required for every row.
    const rows = await this.prisma.$queryRaw<Array<{
      projectId: string; name: string; slug: string; organizationId: string;
      organizationName: string; organizationSlug: string; role: ProjectRole;
      canApproveTruthChanges: boolean; memberCount: number; createdAt: Date;
      lastOpenedAt: Date | null; current: boolean;
    }>>(Prisma.sql`
      WITH active_session AS (
        SELECT active_project_id, last_used_at FROM public.refresh_tokens
        WHERE session_id = ${currentSessionId ?? null}::uuid
          AND user_id = ${actor.userId}::uuid AND org_id = ${actor.orgId}::uuid
          AND revoked_at IS NULL AND reuse_detected_at IS NULL AND expires_at > ${new Date()}
        ORDER BY last_used_at DESC LIMIT 1
      )
      SELECT p.id AS "projectId", p.name, p.slug, p.org_id AS "organizationId",
        o.name AS "organizationName", o.slug AS "organizationSlug", pm.project_role AS role,
        (pm.project_role = 'manager' OR pm.can_approve_truth_changes) AS "canApproveTruthChanges",
        (SELECT count(*)::int FROM public.project_members c WHERE c.project_id = p.id AND c.is_active) AS "memberCount",
        p.created_at AS "createdAt",
        CASE WHEN s.active_project_id = p.id THEN s.last_used_at END AS "lastOpenedAt",
        COALESCE(s.active_project_id = p.id, false) AS current
      FROM public.project_members pm
      JOIN public.projects p ON p.id = pm.project_id AND p.status = 'active'
      JOIN public.organization_memberships m ON m.organization_id = p.org_id
        AND m.user_id = pm.user_id AND m.is_active
      JOIN public.organizations o ON o.id = p.org_id
      LEFT JOIN active_session s ON true
      WHERE pm.user_id = ${actor.userId}::uuid AND pm.is_active
      ORDER BY pm.joined_at ASC
    `);
    return rows.map((row) => ({
      ...row,
      isActive: true,
      planLabel: "Private pilot",
      createdAt: row.createdAt.toISOString(),
      lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null
    }));
  }

  async switchWorkspace(actor: Actor, projectId: string) {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, userId: actor.userId, isActive: true, project: { status: "active" } },
      select: {
        projectRole: true,
        canApproveTruthChanges: true,
        project: {
          select: {
            id: true,
            orgId: true,
            name: true,
            slug: true,
            status: true,
            createdAt: true,
            organization: { select: { name: true, slug: true } },
            _count: { select: { members: { where: { isActive: true } } } }
          }
        }
      }
    });
    if (!member) throw new AppError(403, "Workspace access is no longer available", "workspace_access_forbidden");
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: member.project.orgId, userId: actor.userId } }
    });
    if (!membership?.isActive) throw new AppError(403, "Workspace access is no longer available", "workspace_access_forbidden");
    const project = member.project;
    return {
      projectId: project.id,
      name: project.name,
      slug: project.slug,
      organizationId: project.orgId,
      organizationName: project.organization.name,
      organizationSlug: project.organization.slug,
      role: member.projectRole,
      isActive: project.status === "active",
      canApproveTruthChanges: member.projectRole === "manager" || Boolean(member.canApproveTruthChanges),
      memberCount: project._count.members,
      planLabel: "Private pilot",
      createdAt: project.createdAt.toISOString(),
      lastOpenedAt: null,
      current: true
    };
  }

  private async findActiveUser(actor: Actor) {
    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actor.userId } }),
      this.prisma.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: actor.orgId, userId: actor.userId } }
      })
    ]);
    if (!user?.isActive || !membership?.isActive) throw new AppError(404, "User not found", "user_not_found");
    return { user, membership };
  }

  private toNotificationDto(prefs: {
    id: string;
    productUpdates: boolean;
    projectActivity: boolean;
    approvalRequests: boolean;
    slackSyncAlerts: boolean;
    calendarReminders: boolean;
    socratesDigests: boolean;
    securityAlerts: boolean;
    emailEnabled: boolean;
    inAppEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: prefs.id,
      productUpdates: prefs.productUpdates,
      projectActivity: prefs.projectActivity,
      approvalRequests: prefs.approvalRequests,
      slackSyncAlerts: prefs.slackSyncAlerts,
      calendarReminders: prefs.calendarReminders,
      socratesDigests: prefs.socratesDigests,
      securityAlerts: prefs.securityAlerts,
      emailEnabled: prefs.emailEnabled,
      inAppEnabled: prefs.inAppEnabled,
      createdAt: prefs.createdAt.toISOString(),
      updatedAt: prefs.updatedAt.toISOString()
    };
  }
}
