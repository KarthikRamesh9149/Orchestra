import jwt from "jsonwebtoken";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type GlobalRole, type PrismaClient, type ProjectRole, type User, type WorkspaceRoleDefault } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { hashToken, type JwtUser, type TypedJwtUser } from "../../lib/auth/jwt.js";
import { hashPassword, verifyPassword } from "../../lib/auth/password.js";
import { normalizeEmail } from "../../lib/auth/email.js";
import { toSlug } from "../../lib/utils/slug.js";
import { AuditService } from "../audit/service.js";
import { hashProjectJoinCode, normalizeProjectJoinCode } from "../projects/join-codes.js";
import type { AuthEmailService } from "./auth-email.service.js";
import type { SessionMode } from "./browser-session.js";

export type SessionRequestMetadata = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

export type AuthenticatedProfile = {
  id: string;
  orgId: string;
  organization: { id: string; name: string; slug: string };
  email: string;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  displayName: string;
  globalRole: GlobalRole;
  workspaceRoleDefault: WorkspaceRoleDefault;
  createdAt: Date;
  lastLoginAt: string | null;
};

type StoredSessionMetadata = {
  deviceLabel: string;
  deviceType: "browser" | "laptop" | "phone" | "tablet" | "api" | "unknown";
  userAgentHash: string | null;
  ipAddressHash: string | null;
  ipLabel: string | null;
};

type InvitationRecord = {
  id: string;
  projectId: string;
  orgId: string;
  codePrefix: string;
  projectRole: ProjectRole;
  canApproveTruthChanges: boolean;
  maxUses: number;
  useCount: number;
  invitedEmail: string | null;
  linkTokenExpiresAt: Date | null;
  emailDeliveryStatus: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdBy: string;
  project: { id: string; orgId: string; name: string };
};

type RedeemedInvitation = {
  user: User;
  organizationMembership: {
    globalRole: GlobalRole;
    workspaceRoleDefault: WorkspaceRoleDefault;
  };
  projectMember: { id: string };
  redemption: { id: string };
};

type AuthorizedSessionContext = {
  organizationMembershipId: string;
  userId: string;
  orgId: string;
  globalRole: GlobalRole;
  workspaceRoleDefault: WorkspaceRoleDefault;
  profile: AuthenticatedProfile;
};

export class AuthService {
  private readonly sessionContextRequests = new Map<string, Promise<AuthorizedSessionContext>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly auditService: AuditService,
    private readonly authEmailService?: AuthEmailService
  ) {}

  async signup(input: {
    orgName: string;
    email: string;
    password: string;
    displayName: string;
    sessionMode?: SessionMode;
  }, requestMetadata?: SessionRequestMetadata) {
    const email = normalizeEmail(input.email);
    this.assertSignupAllowed(email);

    const existing = await this.prisma.user.findUnique({ where: { normalizedEmail: email } });

    if (existing) {
      throw new AppError(409, "User already exists", "user_exists");
    }

    const passwordHash = await hashPassword(input.password, this.env.PASSWORD_HASH_COST);
    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: input.orgName,
            slug: toSlug(input.orgName)
          }
        });
        const user = await tx.user.create({
          data: {
            orgId: organization.id,
            email,
            normalizedEmail: email,
            passwordHash,
            displayName: input.displayName,
            globalRole: "owner",
            workspaceRoleDefault: "manager"
          }
        });
        return { organization, user };
      });
    } catch (error) {
      if (isNormalizedEmailConflict(error)) {
        throw new AppError(409, "User already exists", "user_exists");
      }
      throw error;
    }
    const { organization, user } = created;

    await this.auditService.record({
      orgId: organization.id,
      actorUserId: user.id,
      eventType: "user_signed_up",
      entityType: "user",
      entityId: user.id,
      payload: { email: user.email }
    });

    const tokens = await this.issueTokens({
      userId: user.id,
      orgId: organization.id,
      workspaceRoleDefault: "manager",
      globalRole: "owner"
    }, input.sessionMode ?? "bearer", requestMetadata);

    return {
      organization,
      user,
      ...tokens
    };
  }

  async login(input: { email: string; password: string; sessionMode?: SessionMode }, requestMetadata?: SessionRequestMetadata) {
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { normalizedEmail: email } });
    if (!user?.isActive) {
      throw new AppError(401, "Invalid credentials", "invalid_credentials");
    }
    if (!user.passwordHash) {
      throw new AppError(401, "Invalid credentials", "invalid_credentials");
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, "Invalid credentials", "invalid_credentials");
    }

    const membership = await this.findActiveOrganizationMembership(user.orgId, user.id);
    if (!membership) {
      throw new AppError(401, "Invalid credentials", "invalid_credentials");
    }

    const loggedInAt = new Date();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: loggedInAt }
    });

    const tokens = await this.issueTokens({
      userId: user.id,
      orgId: user.orgId,
      workspaceRoleDefault: membership.workspaceRoleDefault,
      globalRole: membership.globalRole
    }, input.sessionMode ?? "bearer", requestMetadata);

    return {
      user: {
        ...user,
        lastLoginAt: loggedInAt,
        globalRole: membership.globalRole,
        workspaceRoleDefault: membership.workspaceRoleDefault
      },
      ...tokens
    };
  }

  async joinWorkspace(input: {
    email: string;
    code: string;
    password?: string;
    displayName?: string;
    sessionMode?: SessionMode;
  }, requestMetadata?: SessionRequestMetadata) {
    if (!input.password || !input.displayName) {
      throw new AppError(
        400,
        "A password and profile name are required to complete an invited account",
        "join_account_completion_required"
      );
    }
    return this.completeInvitationAccount({
      email: input.email,
      code: input.code,
      password: input.password,
      displayName: input.displayName,
      sessionMode: input.sessionMode
    }, requestMetadata);
  }

  async completeInvitationAccount(input: {
    email: string;
    code?: string;
    inviteToken?: string;
    password: string;
    displayName: string;
    sessionMode?: SessionMode;
  }, requestMetadata?: SessionRequestMetadata) {
    const email = normalizeEmail(input.email);
    const invitation = await this.loadAvailableInvitation(email, input.code, input.inviteToken);
    const existingUser = await this.prisma.user.findUnique({ where: { normalizedEmail: email } });
    if (existingUser) {
      throw new AppError(
        409,
        "This email already has an account. Choose 'I have an account' and sign in to redeem the invite.",
        "invite_existing_account_requires_sign_in"
      );
    }
    const passwordHash = await hashPassword(input.password, this.env.PASSWORD_HASH_COST);
    let redeemed;
    try {
      redeemed = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            orgId: invitation.orgId,
            email,
            normalizedEmail: email,
            passwordHash,
            displayName: input.displayName.trim(),
            // Enrollment authorizes membership; only the email-verification
            // challenge may establish ownership of a global identity.
            emailVerifiedAt: null,
            globalRole: "member",
            workspaceRoleDefault: workspaceRoleForProjectRole(invitation.projectRole)
          }
        });
        return this.redeemInvitationInTransaction(tx, invitation, user);
      });
    } catch (error) {
      if (isNormalizedEmailConflict(error)) {
        throw new AppError(
          409,
          "This email already has an account. Choose 'I have an account' and sign in to redeem the invite.",
          "invite_existing_account_requires_sign_in"
        );
      }
      if (isInvitationRedemptionConflict(error)) {
        throw new AppError(410, "Workspace invite code has already been redeemed", "join_code_already_redeemed");
      }
      throw error;
    }

    return this.issueInvitationSession(invitation, redeemed, input.sessionMode ?? "bearer", requestMetadata);
  }

  async redeemInvitationForExistingAccount(input: {
    email: string;
    password: string;
    code?: string;
    inviteToken?: string;
    sessionMode?: SessionMode;
  }, requestMetadata?: SessionRequestMetadata) {
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { normalizedEmail: email } });
    if (!user?.isActive || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AppError(401, "Invalid credentials", "invalid_credentials");
    }
    const invitation = await this.loadAvailableInvitation(email, input.code, input.inviteToken);

    let redeemed;
    try {
      redeemed = await this.prisma.$transaction((tx) =>
        this.redeemInvitationInTransaction(tx, invitation, user)
      );
    } catch (error) {
      if (isInvitationRedemptionConflict(error)) {
        throw new AppError(410, "Workspace invite code has already been redeemed", "join_code_already_redeemed");
      }
      throw error;
    }

    return this.issueInvitationSession(invitation, redeemed, input.sessionMode ?? "bearer", requestMetadata);
  }

  private async loadAvailableInvitation(email: string, code?: string, inviteToken?: string): Promise<InvitationRecord> {
    if (!code && !inviteToken) throw new AppError(400, "Activation code or secure invitation link is required", "invite_credential_required");
    const normalizedCode = code ? normalizeProjectJoinCode(code) : null;
    const invitation = await this.prisma.projectJoinCode.findUnique({
      where: normalizedCode ? { codeHash: hashProjectJoinCode(normalizedCode) } : { linkTokenHash: hashToken(inviteToken!) },
      include: {
        project: { select: { id: true, orgId: true, name: true } }
      }
    });

    if (
      !invitation ||
      !invitation.invitedEmail ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.maxUses !== 1 ||
      invitation.useCount >= invitation.maxUses ||
      (!normalizedCode && (!invitation.linkTokenExpiresAt || invitation.linkTokenExpiresAt <= new Date())) ||
      invitation.project.orgId !== invitation.orgId
    ) {
      throw new AppError(410, "Workspace invite code is expired, revoked, or already used", "join_code_unavailable");
    }
    if (invitation.projectRole === "client" && invitation.canApproveTruthChanges) {
      throw new AppError(403, "Client invitees cannot approve internal truth changes", "client_truth_approval_forbidden");
    }
    if (normalizeEmail(invitation.invitedEmail) !== email) {
      throw new AppError(403, "Workspace invite is only valid for the invited email", "join_code_email_mismatch");
    }
    return invitation;
  }

  private async redeemInvitationInTransaction(
    tx: Prisma.TransactionClient,
    invitation: InvitationRecord,
    user: User
  ) {
    const verifiedUser = user;
    const existingProjectMember = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } }
    });
    if (existingProjectMember?.isActive) {
      throw new AppError(409, "This account is already an active member of the invited project", "invite_already_member");
    }

    const currentMembership = await tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: invitation.orgId, userId: user.id } }
    });
    const invitedWorkspaceRole = workspaceRoleForProjectRole(invitation.projectRole);
    const workspaceRoleDefault = strongerWorkspaceRole(
      currentMembership?.workspaceRoleDefault,
      invitedWorkspaceRole
    );
    const organizationMembership = await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: invitation.orgId, userId: user.id } },
      create: {
        organizationId: invitation.orgId,
        userId: user.id,
        globalRole: "member",
        workspaceRoleDefault,
        isActive: true
      },
      update: {
        isActive: true,
        workspaceRoleDefault
      }
    });

    const canApproveTruthChanges = Boolean(invitation.canApproveTruthChanges);
    const projectMember = await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: invitation.projectId, userId: user.id } },
      create: {
        projectId: invitation.projectId,
        userId: user.id,
        projectRole: invitation.projectRole,
        canApproveTruthChanges,
        truthApprovalGrantedByUserId: canApproveTruthChanges ? invitation.createdBy : null,
        truthApprovalGrantedAt: canApproveTruthChanges ? new Date() : null,
        isActive: true,
        roleInProject: "Beta teammate"
      },
      update: {
        projectRole: invitation.projectRole,
        canApproveTruthChanges,
        truthApprovalGrantedByUserId: canApproveTruthChanges ? invitation.createdBy : null,
        truthApprovalGrantedAt: canApproveTruthChanges ? new Date() : null,
        truthApprovalRevokedByUserId: null,
        truthApprovalRevokedAt: null,
        isActive: true
      }
    });

    const redemption = await tx.projectJoinCodeRedemption.create({
      data: {
        joinCodeId: invitation.id,
        projectId: invitation.projectId,
        userId: user.id
      }
    });
    const consumed = await tx.projectJoinCode.updateMany({
      where: {
        id: invitation.id,
        invitedEmail: user.normalizedEmail,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        useCount: { lt: invitation.maxUses }
      },
      data: { useCount: { increment: 1 } }
    });
    if (consumed.count !== 1) {
      throw new AppError(410, "Workspace invite code is expired, revoked, or already used", "join_code_unavailable");
    }

    await this.auditService.recordWithClient(tx, {
      orgId: invitation.orgId,
      projectId: invitation.projectId,
      actorUserId: user.id,
      eventType: "team_invitation_redeemed",
      entityType: "project_join_code_redemption",
      entityId: redemption.id,
      payload: {
        joinCodeId: invitation.id,
        codePrefix: invitation.codePrefix,
        userId: user.id,
        projectRole: invitation.projectRole,
        canApproveTruthChanges
      }
    });

    return { user: verifiedUser, organizationMembership, projectMember, redemption };
  }

  private async issueInvitationSession(
    invitation: InvitationRecord,
    redeemed: RedeemedInvitation,
    sessionMode: SessionMode,
    requestMetadata?: SessionRequestMetadata
  ) {
    const user = {
      ...redeemed.user,
      orgId: invitation.orgId,
      globalRole: redeemed.organizationMembership.globalRole,
      workspaceRoleDefault: redeemed.organizationMembership.workspaceRoleDefault
    };

    const tokens = await this.issueTokens({
      userId: user.id,
      orgId: invitation.orgId,
      workspaceRoleDefault: user.workspaceRoleDefault,
      globalRole: user.globalRole
    }, sessionMode, requestMetadata, invitation.projectId);

    return {
      user,
      invitation: {
        redemptionId: redeemed.redemption.id,
        organizationId: invitation.orgId,
        projectId: invitation.projectId,
        projectName: invitation.project.name
      },
      ...tokens
    };
  }

  async refresh(refreshToken: string, expectedSessionMode?: SessionMode, requestMetadata?: SessionRequestMetadata,
    observe?: (phase: "validation_read" | "rotation", elapsedMs: number) => void) {
    let phaseStarted = Date.now();
    let payload: TypedJwtUser;
    try {
      payload = jwt.verify(refreshToken, this.env.JWT_REFRESH_SECRET) as TypedJwtUser;
    } catch {
      throw new AppError(401, "Invalid refresh token", "refresh_invalid");
    }
    if (payload.typ !== "refresh" || typeof payload.userId !== "string" || typeof payload.orgId !== "string") {
      throw new AppError(401, "Invalid refresh token", "refresh_invalid");
    }
    const tokenHash = hashToken(refreshToken);
    // The signed identity lets independent reads start together. Nothing is
    // issued until the durable record, identity binding, expiry, revocation,
    // active user and active membership have all passed below.
    const [record, user, membership] = await Promise.all([
      this.prisma.refreshToken.findFirst({ where: { tokenHash } }),
      this.prisma.user.findUnique({ where: { id: payload.userId } }),
      this.findActiveOrganizationMembership(payload.orgId, payload.userId)
    ]);
    observe?.("validation_read", Date.now() - phaseStarted);

    if (!record) {
      throw new AppError(401, "Invalid refresh token", "refresh_invalid");
    }
    const sessionId = record.sessionId ?? payload.sessionId ?? record.id;
    const clientType = (record.clientType ?? "bearer") as SessionMode;
    if (expectedSessionMode && clientType !== expectedSessionMode) {
      throw new AppError(401, "Invalid refresh token", "refresh_invalid");
    }
    if (record.revokedAt || record.replacedAt || record.reuseDetectedAt) {
      await this.revokeSessionFamily(sessionId, "refresh_reuse_detected", true);
      throw new AppError(401, "Refresh token reuse detected", "refresh_reused");
    }
    if (record.expiresAt < new Date()) {
      throw new AppError(401, "Refresh token expired", "refresh_expired");
    }
    if (record.userId !== payload.userId || record.orgId !== payload.orgId) {
      throw new AppError(401, "Invalid refresh token", "refresh_invalid");
    }

    if (!user?.isActive || !membership) {
      throw new AppError(401, "Refresh token user is inactive", "refresh_user_inactive");
    }

    phaseStarted = Date.now();
    const next = this.buildTokenPair({
      userId: user.id,
      orgId: record.orgId,
      workspaceRoleDefault: membership.workspaceRoleDefault,
      globalRole: membership.globalRole,
      sessionId
    });
    const now = new Date();
    const metadata = this.resolveSessionMetadata(requestMetadata, clientType, record);
    // One PostgreSQL statement atomically claims the old token and inserts its
    // replacement. INSERT failure rolls back the claim; a concurrent loser
    // inserts nothing. No begin/update/insert/commit network staircase.
    const rotated = await this.prisma.$executeRaw(Prisma.sql`
      WITH claimed AS (
        UPDATE public.refresh_tokens SET revoked_at = ${now}, replaced_at = ${now}
        WHERE id = ${record.id}::uuid AND user_id = ${user.id}::uuid
          AND org_id = ${record.orgId}::uuid
          AND revoked_at IS NULL AND replaced_at IS NULL AND reuse_detected_at IS NULL
        RETURNING id
      )
      INSERT INTO public.refresh_tokens
        (id, user_id, org_id, session_id, parent_token_id, client_type, active_project_id,
         device_label, device_type, user_agent_hash, ip_address_hash, ip_label,
         last_used_at, token_hash, expires_at)
      SELECT ${next.refreshTokenId}::uuid, ${user.id}::uuid, ${record.orgId}::uuid,
        ${sessionId}::uuid, claimed.id, ${clientType}, ${record.activeProjectId ?? null}::uuid,
        ${metadata.deviceLabel}, ${metadata.deviceType}, ${metadata.userAgentHash},
        ${metadata.ipAddressHash}, ${metadata.ipLabel}, ${now},
        ${hashToken(next.refreshToken)}, ${next.refreshExpiresAt}
      FROM claimed
    `);
    observe?.("rotation", Date.now() - phaseStarted);
    if (rotated !== 1) {
      // A separate statement sees the winner's committed replacement, so a
      // concurrent replay revokes the whole family, including that replacement.
      await this.revokeSessionFamily(sessionId, "refresh_reuse_detected", true);
      throw new AppError(401, "Refresh token reuse detected", "refresh_reused");
    }

    return { accessToken: next.accessToken, refreshToken: next.refreshToken };
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record) return;
    await this.revokeSessionFamily(record.sessionId ?? record.id, "logout");
  }

  async assertSessionActive(sessionId: string | undefined, userId: string, orgId: string) {
    if (!sessionId) return;
    const active = await this.prisma.refreshToken.findFirst({
      where: {
        sessionId,
        userId,
        orgId,
        revokedAt: null,
        reuseDetectedAt: null,
        expiresAt: { gt: new Date() }
      },
      select: { id: true, lastUsedAt: true }
    });
    if (!active) {
      throw new AppError(401, "Session has been revoked", "session_revoked");
    }
    if (active.lastUsedAt.getTime() < Date.now() - 5 * 60 * 1000) {
      await this.prisma.refreshToken.updateMany({
        where: { sessionId, userId, orgId, revokedAt: null, reuseDetectedAt: null },
        data: { lastUsedAt: new Date() }
      });
    }
  }

  async authorizeSessionContext(sessionId: string, userId: string, orgId: string) {
    const key = `${sessionId}:${userId}:${orgId}`;
    const pending = this.sessionContextRequests.get(key);
    if (pending) return pending;
    const request = this.loadSessionContext(sessionId, userId, orgId);
    this.sessionContextRequests.set(key, request);
    const cleanup = () => {
      if (this.sessionContextRequests.get(key) === request) this.sessionContextRequests.delete(key);
    };
    void request.then(cleanup, cleanup);
    return request;
  }

  private async loadSessionContext(sessionId: string, userId: string, orgId: string): Promise<AuthorizedSessionContext> {
    // Nested Prisma reads issue several serial SELECTs. Keep this hot-path
    // authorization fresh while fetching the exact same context in one round trip.
    const [active] = await this.prisma.$queryRaw<Array<{
      id: string; lastUsedAt: Date;
      user: {
        id: string; email: string; emailVerifiedAt: string | null;
        displayName: string; createdAt: string; lastLoginAt: string | null;
        organizationMemberships: Array<{
          id: string; organizationId: string; userId: string;
          globalRole: GlobalRole; workspaceRoleDefault: WorkspaceRoleDefault;
          organization: { id: string; name: string; slug: string };
        }>;
      };
    }>>(Prisma.sql`
      SELECT r.id, r.last_used_at AS "lastUsedAt",
        json_build_object(
          'id', u.id, 'email', u.email, 'emailVerifiedAt', u.email_verified_at,
          'displayName', u.display_name, 'createdAt', u.created_at, 'lastLoginAt', u.last_login_at,
          'organizationMemberships', CASE WHEN m.id IS NULL THEN '[]'::json ELSE json_build_array(
            json_build_object('id', m.id, 'organizationId', m.organization_id, 'userId', m.user_id,
              'globalRole', m.global_role, 'workspaceRoleDefault', m.workspace_role_default,
              'organization', json_build_object('id', o.id, 'name', o.name, 'slug', o.slug))
          ) END
        ) AS "user"
      FROM refresh_tokens r
      JOIN users u ON u.id = r.user_id AND u.is_active = true
      LEFT JOIN organization_memberships m ON m.user_id = u.id
        AND m.organization_id = r.org_id AND m.is_active = true
      LEFT JOIN organizations o ON o.id = m.organization_id
      WHERE r.session_id = ${sessionId}::uuid AND r.user_id = ${userId}::uuid
        AND r.org_id = ${orgId}::uuid AND r.revoked_at IS NULL
        AND r.reuse_detected_at IS NULL AND r.expires_at > ${new Date()}
      LIMIT 1
    `);
    const membership = active?.user.organizationMemberships[0];
    if (!active) throw new AppError(401, "Session has been revoked", "session_revoked");
    if (!membership) throw new AppError(401, "Active organization membership required", "auth_membership_inactive");
    if (active.lastUsedAt.getTime() < Date.now() - 5 * 60 * 1000) {
      await this.prisma.refreshToken.updateMany({
        where: { sessionId, userId, orgId, revokedAt: null, reuseDetectedAt: null },
        data: { lastUsedAt: new Date() }
      });
    }
    return {
      organizationMembershipId: membership.id,
      userId: membership.userId,
      orgId: membership.organizationId,
      globalRole: membership.globalRole,
      workspaceRoleDefault: membership.workspaceRoleDefault,
      profile: {
        id: active.user.id,
        orgId: membership.organizationId,
        organization: membership.organization,
        email: active.user.email,
        emailVerified: Boolean(active.user.emailVerifiedAt),
        emailVerifiedAt: active.user.emailVerifiedAt ? new Date(active.user.emailVerifiedAt).toISOString() : null,
        displayName: active.user.displayName,
        globalRole: membership.globalRole,
        workspaceRoleDefault: membership.workspaceRoleDefault,
        createdAt: new Date(active.user.createdAt),
        lastLoginAt: active.user.lastLoginAt ? new Date(active.user.lastLoginAt).toISOString() : null
      } satisfies AuthenticatedProfile
    };
  }

  async requestEmailVerification(input: { userId: string; orgId: string; projectId: string }) {
    if (!this.authEmailService) throw new AppError(503, "Email delivery is not configured", "auth_email_unavailable");
    const [user, member] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: input.userId, isActive: true }, select: { id: true, normalizedEmail: true, displayName: true, emailVerifiedAt: true } }),
      this.prisma.projectMember.findFirst({ where: { projectId: input.projectId, userId: input.userId, isActive: true, project: { orgId: input.orgId, status: "active" } }, select: { id: true } })
    ]);
    if (!user || !member) throw new AppError(403, "Workspace access is required to send verification email", "email_verification_project_forbidden");
    if (user.emailVerifiedAt) return { status: "already_verified" as const, emailVerifiedAt: user.emailVerifiedAt };

    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.userEmailVerificationToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
      return tx.userEmailVerificationToken.create({ data: { userId: user.id, email: user.normalizedEmail, tokenHash: hashToken(rawToken), expiresAt } });
    });
    const url = new URL("/login", this.env.FRONTEND_BASE_URL ?? this.env.APP_BASE_URL);
    url.searchParams.set("verify_email", rawToken);
    const delivery = await this.authEmailService.sendEmailVerification({ projectId: input.projectId, to: user.normalizedEmail, displayName: user.displayName, verificationUrl: url.toString(), expiresAt }).catch(() => ({ status: "failed" as const, provider: "gmail" as const, from: null, sentAt: null, messageId: null, errorCode: "gmail_delivery_failed" }));
    if (delivery.status !== "sent") {
      await this.prisma.userEmailVerificationToken.delete({ where: { id: record.id } }).catch(() => undefined);
    }
    await this.auditService.record({ orgId: input.orgId, projectId: input.projectId, actorUserId: user.id, eventType: delivery.status === "sent" ? "email_verification_sent" : "email_verification_not_sent", entityType: "user", entityId: user.id, payload: { provider: delivery.provider, deliveryStatus: delivery.status, errorCode: delivery.errorCode } });
    return { status: delivery.status, provider: delivery.provider, errorCode: delivery.errorCode, expiresAt: delivery.status === "sent" ? expiresAt : null };
  }

  async confirmEmailVerification(rawToken: string) {
    const record = await this.prisma.userEmailVerificationToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: { id: true, orgId: true, normalizedEmail: true, emailVerifiedAt: true, isActive: true } } }
    });
    if (!record || record.consumedAt || record.expiresAt <= new Date() || !record.user.isActive || record.email !== record.user.normalizedEmail) {
      throw new AppError(410, "Email verification link is expired or already used", "email_verification_unavailable");
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.userEmailVerificationToken.updateMany({ where: { id: record.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new AppError(410, "Email verification link is expired or already used", "email_verification_unavailable");
      await tx.user.update({ where: { id: record.user.id }, data: { emailVerifiedAt: record.user.emailVerifiedAt ?? now } });
      await this.auditService.recordWithClient(tx, { orgId: record.user.orgId, actorUserId: record.user.id, eventType: "email_verified", entityType: "user", entityId: record.user.id, payload: { verifiedAt: now.toISOString() } });
    });
    return { verified: true, emailVerifiedAt: record.user.emailVerifiedAt ?? now };
  }

  async changePassword(input: { userId: string; orgId: string; currentPassword: string; newPassword: string }) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: input.userId,
        isActive: true,
        organizationMemberships: { some: { organizationId: input.orgId, isActive: true } }
      },
      select: { id: true, passwordHash: true, emailVerifiedAt: true }
    });
    if (!user || !user.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new AppError(401, "Current password is incorrect", "current_password_invalid");
    }
    if (!user.emailVerifiedAt) throw new AppError(403, "Verify your email before changing your password", "email_verification_required");
    if (await verifyPassword(input.newPassword, user.passwordHash)) throw new AppError(400, "New password must be different", "password_unchanged");
    const passwordHash = await hashPassword(input.newPassword, this.env.PASSWORD_HASH_COST);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now, revokeReason: "password_changed" } });
      await this.auditService.recordWithClient(tx, { orgId: input.orgId, actorUserId: user.id, eventType: "password_changed", entityType: "user", entityId: user.id, payload: { allSessionsRevoked: true } });
    });
    return { changed: true, sessionsRevoked: true };
  }

  async getMe(userId: string, orgId: string) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      select: {
        globalRole: true,
        workspaceRoleDefault: true,
        isActive: true,
        organization: { select: { id: true, name: true, slug: true } },
        user: {
          select: {
            id: true,
            email: true,
            emailVerifiedAt: true,
            displayName: true,
            isActive: true,
            createdAt: true,
            lastLoginAt: true
          }
        }
      }
    });

    if (!membership?.isActive || !membership.user.isActive) {
      throw new AppError(404, "User not found", "user_not_found");
    }
    const { user } = membership;

    return {
      id: user.id,
      orgId,
      organization: membership.organization,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      displayName: user.displayName,
      globalRole: membership.globalRole,
      workspaceRoleDefault: membership.workspaceRoleDefault,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null
    };
  }

  async switchSessionContext(input: {
    userId: string;
    currentOrgId: string;
    targetOrgId: string;
    projectId: string;
    sessionId?: string;
    requestMetadata?: SessionRequestMetadata;
  }) {
    if (!input.sessionId) {
      throw new AppError(409, "This session cannot switch workspaces; sign in again", "session_context_unavailable");
    }
    const [source, membership, projectMember] = await Promise.all([
      this.prisma.refreshToken.findFirst({
        where: {
          sessionId: input.sessionId,
          userId: input.userId,
          orgId: input.currentOrgId,
          revokedAt: null,
          reuseDetectedAt: null,
          expiresAt: { gt: new Date() }
        },
        orderBy: { lastUsedAt: "desc" }
      }),
      this.findActiveOrganizationMembership(input.targetOrgId, input.userId),
      this.prisma.projectMember.findFirst({
        where: {
          projectId: input.projectId,
          userId: input.userId,
          isActive: true,
          project: { orgId: input.targetOrgId, status: "active" }
        },
        select: { id: true, projectRole: true }
      })
    ]);
    if (!source || !membership || !projectMember) {
      throw new AppError(403, "Workspace access is no longer available", "workspace_access_forbidden");
    }

    const tokens = this.buildTokenPair({
      userId: input.userId,
      orgId: input.targetOrgId,
      workspaceRoleDefault: membership.workspaceRoleDefault,
      globalRole: membership.globalRole,
      sessionId: input.sessionId
    });
    const now = new Date();
    const metadata = this.resolveSessionMetadata(input.requestMetadata, source.clientType as SessionMode, source);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: {
          id: source.id,
          sessionId: input.sessionId,
          userId: input.userId,
          revokedAt: null,
          reuseDetectedAt: null
        },
        data: { revokedAt: now, replacedAt: now, revokeReason: "workspace_switched" }
      });
      if (claimed.count !== 1) {
        throw new AppError(409, "Workspace changed in another request; reload and try again", "workspace_switch_conflict");
      }
      await tx.refreshToken.updateMany({
        where: {
          sessionId: input.sessionId,
          userId: input.userId,
          revokedAt: null,
          reuseDetectedAt: null
        },
        data: { revokedAt: now, replacedAt: now, revokeReason: "workspace_switched" }
      });
      await tx.refreshToken.create({
        data: {
          id: tokens.refreshTokenId,
          userId: input.userId,
          orgId: input.targetOrgId,
          sessionId: input.sessionId,
          parentTokenId: source.id,
          clientType: source.clientType,
          activeProjectId: input.projectId,
          ...metadata,
          lastUsedAt: now,
          tokenHash: hashToken(tokens.refreshToken),
          expiresAt: tokens.refreshExpiresAt
        }
      });
      await this.auditService.recordWithClient(tx, {
        orgId: input.targetOrgId,
        projectId: input.projectId,
        actorUserId: input.userId,
        eventType: "workspace.switched",
        entityType: "project",
        entityId: input.projectId,
        payload: {
          previousOrganizationId: input.currentOrgId,
          organizationChanged: input.currentOrgId !== input.targetOrgId,
          persistedSessionContext: true,
          projectRole: projectMember.projectRole
        }
      });
    });

    const user = await this.getMe(input.userId, input.targetOrgId);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      clientType: source.clientType as SessionMode,
      user,
      projectRole: projectMember.projectRole
    };
  }

  private async issueTokens(
    user: JwtUser,
    clientType: SessionMode,
    requestMetadata?: SessionRequestMetadata,
    activeProjectId?: string
  ) {
    const tokens = this.buildTokenPair({ ...user, sessionId: randomUUID() });
    const metadata = this.resolveSessionMetadata(requestMetadata, clientType);
    await this.prisma.refreshToken.create({
      data: {
        id: tokens.refreshTokenId,
        userId: user.userId,
        orgId: user.orgId,
        sessionId: tokens.sessionId,
        clientType,
        activeProjectId,
        ...metadata,
        lastUsedAt: new Date(),
        tokenHash: hashToken(tokens.refreshToken),
        expiresAt: tokens.refreshExpiresAt
      }
    });

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  private buildTokenPair(user: JwtUser & { sessionId: string }) {
    const refreshTokenId = randomUUID();
    const accessToken = jwt.sign({ ...user, typ: "access", jti: randomUUID() } satisfies TypedJwtUser<"access">, this.env.JWT_ACCESS_SECRET, {
      expiresIn: this.env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"]
    });
    const refreshToken = jwt.sign({ ...user, typ: "refresh", jti: refreshTokenId } satisfies TypedJwtUser<"refresh">, this.env.JWT_REFRESH_SECRET, {
      expiresIn: this.env.JWT_REFRESH_TTL as jwt.SignOptions["expiresIn"]
    });

    const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
    return {
      accessToken,
      refreshToken,
      refreshTokenId,
      sessionId: user.sessionId,
      refreshExpiresAt: new Date((decoded?.exp ?? 0) * 1000)
    };
  }

  private async revokeSessionFamily(sessionId: string, reason: string, reuseDetected = false) {
    const now = new Date();
    await this.prisma.refreshToken.updateMany({
      where: { sessionId },
      data: {
        revokedAt: now,
        revokeReason: reason,
        ...(reuseDetected ? { reuseDetectedAt: now } : {})
      }
    });
  }

  private async findActiveOrganizationMembership(organizationId: string, userId: string) {
    const membership = await this.prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: { organizationId, userId }
      }
    });
    return membership?.isActive ? membership : null;
  }

  private resolveSessionMetadata(
    requestMetadata: SessionRequestMetadata | undefined,
    clientType: SessionMode,
    fallback?: {
      deviceLabel?: string | null;
      deviceType?: StoredSessionMetadata["deviceType"] | string | null;
      userAgentHash?: string | null;
      ipAddressHash?: string | null;
      ipLabel?: string | null;
    }
  ): StoredSessionMetadata {
    const userAgent = requestMetadata?.userAgent?.trim().slice(0, 1000) || null;
    const ipAddress = requestMetadata?.ipAddress?.trim().slice(0, 200) || null;
    const detected = detectDevice(userAgent, clientType);
    const userAgentHash = userAgent ? this.hashSessionValue(userAgent) : fallback?.userAgentHash ?? null;
    const ipAddressHash = ipAddress ? this.hashSessionValue(ipAddress) : fallback?.ipAddressHash ?? null;
    return {
      deviceLabel: userAgent ? detected.label : fallback?.deviceLabel ?? detected.label,
      deviceType: userAgent ? detected.type : normalizeDeviceType(fallback?.deviceType) ?? detected.type,
      userAgentHash,
      ipAddressHash,
      ipLabel: ipAddressHash ? `Network ${ipAddressHash.slice(0, 8)}` : fallback?.ipLabel ?? null
    };
  }

  private hashSessionValue(value: string) {
    return createHmac("sha256", this.env.JWT_ACCESS_SECRET).update(value).digest("hex");
  }

  private assertSignupAllowed(email: string) {
    if (this.env.SIGNUP_MODE === "disabled") {
      throw new AppError(403, "Public signup is disabled", "signup_disabled");
    }

    if (this.env.SIGNUP_MODE !== "invite_only") {
      return;
    }

    const allowedDomains = this.env.SIGNUP_ALLOWED_EMAIL_DOMAINS.split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    const emailDomain = email.split("@").pop()?.toLowerCase() ?? "";
    if (!emailDomain || !allowedDomains.includes(emailDomain)) {
      throw new AppError(403, "Signup requires an invitation or approved email domain", "signup_invite_required");
    }
  }
}

function workspaceRoleForProjectRole(role: ProjectRole): WorkspaceRoleDefault {
  if (role === "manager") return "manager";
  if (role === "client") return "client";
  return "dev";
}

const WORKSPACE_ROLE_RANK: Record<WorkspaceRoleDefault, number> = {
  client: 0,
  dev: 1,
  manager: 2
};

function strongerWorkspaceRole(
  current: WorkspaceRoleDefault | undefined,
  invited: WorkspaceRoleDefault
): WorkspaceRoleDefault {
  if (!current) return invited;
  return WORKSPACE_ROLE_RANK[current] >= WORKSPACE_ROLE_RANK[invited] ? current : invited;
}

function isNormalizedEmailConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return false;
  const meta = "meta" in error ? error.meta : undefined;
  const target = meta && typeof meta === "object" && "target" in meta ? meta.target : undefined;
  return JSON.stringify(target).toLowerCase().includes("normalized_email");
}

function isInvitationRedemptionConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return false;
  const meta = "meta" in error ? error.meta : undefined;
  const target = meta && typeof meta === "object" && "target" in meta ? meta.target : undefined;
  const normalizedTarget = JSON.stringify(target).toLowerCase();
  return (
    normalizedTarget.includes("project_join_code_redemptions") ||
    normalizedTarget.includes("join_code_id") ||
    normalizedTarget.includes("project_id")
  );
}

function detectDevice(userAgent: string | null, clientType: SessionMode): {
  label: string;
  type: StoredSessionMetadata["deviceType"];
} {
  if (clientType === "bearer") return { label: "API or developer client", type: "api" };
  if (!userAgent) return { label: "Browser session", type: "browser" };

  const ua = userAgent.toLowerCase();
  const browser = ua.includes("edg/") ? "Edge" : ua.includes("firefox/") ? "Firefox" : ua.includes("chrome/") ? "Chrome" : ua.includes("safari/") ? "Safari" : "Browser";
  if (/ipad|tablet/.test(ua)) return { label: `${browser} on tablet`, type: "tablet" };
  if (/iphone|ipod/.test(ua)) return { label: `${browser} on iPhone`, type: "phone" };
  if (/android/.test(ua) && /mobile/.test(ua)) return { label: `${browser} on Android`, type: "phone" };
  if (/macintosh|windows|linux|cros/.test(ua)) return { label: `${browser} on computer`, type: "laptop" };
  return { label: browser, type: "browser" };
}

function normalizeDeviceType(value: string | null | undefined): StoredSessionMetadata["deviceType"] | null {
  return value === "browser" || value === "laptop" || value === "phone" || value === "tablet" || value === "api" || value === "unknown"
    ? value
    : null;
}
