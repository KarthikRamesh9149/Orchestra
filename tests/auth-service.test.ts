import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { AuthService } from "../src/modules/auth/service.js";

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-with-enough-length",
  JWT_REFRESH_SECRET: "test-refresh-secret-with-enough-length",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
  PASSWORD_HASH_COST: 8,
  SIGNUP_MODE: "open",
  SIGNUP_ALLOWED_EMAIL_DOMAINS: ""
} as any;

function createRefreshToken(payload: Record<string, unknown>) {
  return jwt.sign({ typ: "refresh", ...payload }, env.JWT_REFRESH_SECRET, { expiresIn: "30d" });
}

function createInvitationPrisma(input?: { projectRole?: "dev" | "client"; useCount?: number; existingUser?: any }) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => input?.existingUser ?? null),
      create: vi.fn(async ({ data }: any) => ({ id: "new-user-1", isActive: true, ...data }))
    },
    projectJoinCode: {
      findUnique: vi.fn(async () => ({
        id: "code-1",
        projectId: "project-shared",
        orgId: "org-shared",
        codePrefix: "ORCH-ABC123",
        createdBy: "inviter-1",
        projectRole: input?.projectRole ?? "dev",
        canApproveTruthChanges: false,
        invitedEmail: "invited@example.com",
        maxUses: 1,
        useCount: input?.useCount ?? 0,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        project: { id: "project-shared", orgId: "org-shared", name: "Shared project" }
      })),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    organizationMembership: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: any) => ({ id: "org-member-1", ...create }))
    },
    projectMember: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: any) => ({ id: "member-1", ...create }))
    },
    projectJoinCodeRedemption: {
      create: vi.fn(async ({ data }: any) => ({ id: "redemption-1", ...data }))
    },
    refreshToken: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (callback: any) => callback(prisma))
  } as any;
  return prisma;
}

const invitationAudit = () => ({ record: vi.fn(), recordWithClient: vi.fn() } as any);

describe("AuthService refresh token safety", () => {
  it("refuses the legacy passwordless invitation flow", async () => {
    const prisma = createInvitationPrisma();
    const service = new AuthService(prisma, env, invitationAudit());

    await expect(service.joinWorkspace({
      email: "invited@example.com",
      code: "ORCH-ABC123-DEF456"
    })).rejects.toMatchObject({ statusCode: 400, code: "join_account_completion_required" });

    expect(prisma.projectJoinCode.findUnique).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it("creates a password-backed client invitee with durable membership and a client-scoped session", async () => {
    const prisma = createInvitationPrisma({ projectRole: "client" });
    const service = new AuthService(prisma, env, invitationAudit());

    const result = await service.completeInvitationAccount({
      email: "invited@example.com",
      code: "ORCH-ABC123-DEF456",
      password: "Password123!",
      displayName: "Client User"
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ passwordHash: expect.any(String), workspaceRoleDefault: "client" })
    });
    expect(prisma.organizationMembership.upsert).toHaveBeenCalled();
    expect(prisma.projectJoinCodeRedemption.create).toHaveBeenCalled();
    expect(jwt.decode(result.accessToken)).toMatchObject({ orgId: "org-shared", workspaceRoleDefault: "client" });
  });

  it("rejects an email mismatch before any mutation", async () => {
    const prisma = createInvitationPrisma();
    const service = new AuthService(prisma, env, invitationAudit());

    await expect(service.completeInvitationAccount({
      email: "other@example.com",
      code: "ORCH-ABC123-DEF456",
      password: "Password123!",
      displayName: "Other User"
    })).rejects.toMatchObject({ statusCode: 403, code: "join_code_email_mismatch" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects expired, revoked, or already-used workspace codes", async () => {
    const prisma = createInvitationPrisma({ useCount: 1 });
    const service = new AuthService(prisma, env, invitationAudit());

    await expect(service.completeInvitationAccount({
      email: "invited@example.com",
      code: "ORCH-ABC123-DEF456",
      password: "Password123!",
      displayName: "Invited User"
    })).rejects.toMatchObject({ statusCode: 410, code: "join_code_unavailable" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("authenticates an existing account before revealing invite status", async () => {
    const prisma = createInvitationPrisma({
      existingUser: {
        id: "existing-user",
        normalizedEmail: "invited@example.com",
        passwordHash: "$2b$08$wiPjiOQcgiXB2J2UIrCVWug6AjOqbysInKRlkKvr1LMsW6FVMceAe",
        isActive: true
      }
    });
    const service = new AuthService(prisma, env, invitationAudit());

    await expect(service.redeemInvitationForExistingAccount({
      email: "invited@example.com",
      password: "wrong-password",
      code: "ORCH-ABC123-DEF456"
    })).rejects.toMatchObject({ statusCode: 401, code: "invalid_credentials" });

    expect(prisma.projectJoinCode.findUnique).not.toHaveBeenCalled();
  });

  it("normalizes signup and login emails before policy and lookup checks", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (args) => ({
          id: "user-1",
          orgId: args.data.orgId,
          email: args.data.email,
          displayName: args.data.displayName,
          globalRole: args.data.globalRole,
          workspaceRoleDefault: args.data.workspaceRoleDefault
        }))
      },
      organization: {
        create: vi.fn(async () => ({ id: "org-1", name: "Acme", slug: "acme" }))
      },
      refreshToken: { create: vi.fn(async () => undefined) },
      $transaction: vi.fn(async (callback) => callback(prisma))
    } as any;
    const service = new AuthService(
      prisma,
      { ...env, SIGNUP_MODE: "invite_only", SIGNUP_ALLOWED_EMAIL_DOMAINS: "trusted.example" },
      { record: vi.fn() } as any
    );

    await service.signup({
      orgName: "Acme",
      email: " Owner@Trusted.Example ",
      password: "Password123!",
      displayName: "Owner"
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { normalizedEmail: "owner@trusted.example" } });
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe("owner@trusted.example");
    expect(prisma.user.create.mock.calls[0][0].data.normalizedEmail).toBe("owner@trusted.example");

    await expect(service.login({ email: " Owner@Trusted.Example ", password: "Password123!" })).rejects.toMatchObject({
      statusCode: 401,
      code: "invalid_credentials"
    });
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { normalizedEmail: "owner@trusted.example" } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("rejects a globally existing normalized identity before creating an organization", async () => {
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ id: "existing-user" })) },
      organization: { create: vi.fn() },
      $transaction: vi.fn()
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(
      service.signup({
        orgName: "Second Organization",
        email: " Existing@Example.com ",
        password: "Password123!",
        displayName: "Existing"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "user_exists" });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { normalizedEmail: "existing@example.com" }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("returns a conflict and rolls back the organization when concurrent signup loses the identity race", async () => {
    const prisma = {
      user: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async () => {
        throw { code: "P2002", meta: { target: ["normalized_email"] } };
      })
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(
      service.signup({
        orgName: "Racing Organization",
        email: "race@example.com",
        password: "Password123!",
        displayName: "Racer"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "user_exists" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("issues login roles from the active organization membership", async () => {
    const user = {
      id: "user-1",
      orgId: "org-1",
      email: "member@example.com",
      normalizedEmail: "member@example.com",
      passwordHash: "$2b$08$wiPjiOQcgiXB2J2UIrCVWug6AjOqbysInKRlkKvr1LMsW6FVMceAe",
      displayName: "Member",
      globalRole: "member",
      workspaceRoleDefault: "dev",
      isActive: true
    };
    const prisma = {
      user: {
        findUnique: vi.fn(async () => user),
        update: vi.fn(async ({ data }: any) => ({ ...user, ...data }))
      },
      organizationMembership: {
        findUnique: vi.fn(async () => ({
          organizationId: "org-1",
          userId: "user-1",
          globalRole: "admin",
          workspaceRoleDefault: "manager",
          isActive: true
        }))
      },
      refreshToken: { create: vi.fn(async () => undefined) }
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    const result = await service.login({ email: " MEMBER@example.com ", password: "Password123!" });
    const payload = jwt.decode(result.accessToken) as Record<string, unknown>;

    expect(prisma.organizationMembership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "user-1" } }
    });
    expect(payload).toMatchObject({ orgId: "org-1", globalRole: "admin", workspaceRoleDefault: "manager" });
    expect(result.user).toMatchObject({ globalRole: "admin", workspaceRoleDefault: "manager" });
  });

  it("blocks public signup when signup mode is disabled before creating orgs or users", async () => {
    const prisma = {
      user: { findUnique: vi.fn() },
      organization: { create: vi.fn() },
      refreshToken: { create: vi.fn() }
    } as any;
    const service = new AuthService(
      prisma,
      { ...env, SIGNUP_MODE: "disabled" },
      { record: vi.fn() } as any
    );

    await expect(
      service.signup({
        orgName: "Blocked Org",
        email: "owner@example.com",
        password: "Password123!",
        displayName: "Owner"
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "signup_disabled"
    });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("enforces invite-only signup domain allowlist before creating orgs or users", async () => {
    const prisma = {
      user: { findUnique: vi.fn() },
      organization: { create: vi.fn() },
      refreshToken: { create: vi.fn() }
    } as any;
    const service = new AuthService(
      prisma,
      { ...env, SIGNUP_MODE: "invite_only", SIGNUP_ALLOWED_EMAIL_DOMAINS: "trusted.example" },
      { record: vi.fn() } as any
    );

    await expect(
      service.signup({
        orgName: "Blocked Org",
        email: "owner@untrusted.example",
        password: "Password123!",
        displayName: "Owner"
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "signup_invite_required"
    });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it("returns a deliberate 401 for malformed refresh tokens", async () => {
    const prisma = {
      refreshToken: {
        findFirst: vi.fn()
      }
    } as any;
    const auditService = { record: vi.fn() } as any;
    const service = new AuthService(prisma, env, auditService);

    await expect(service.refresh("not-a-jwt")).rejects.toMatchObject({
      statusCode: 401,
      code: "refresh_invalid"
    });
    expect(prisma.refreshToken.findFirst).not.toHaveBeenCalled();
  });

  it("checks token, user and membership concurrently without rotating before all complete", async () => {
    let releaseToken!: (value: any) => void;
    let releaseUser!: (value: any) => void;
    let membershipStarted = false;
    const tokenRead = new Promise(resolve => { releaseToken = resolve; });
    const userRead = new Promise(resolve => { releaseUser = resolve; });
    const token = createRefreshToken({ userId: "user-1", orgId: "org-1", workspaceRoleDefault: "dev", globalRole: "member" });
    const prisma: any = {
      refreshToken: { findFirst: vi.fn(() => tokenRead), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
      user: { findUnique: vi.fn(() => userRead) },
      organizationMembership: { findUnique: vi.fn(async () => { membershipStarted = true; return { isActive: true, workspaceRoleDefault: "manager", globalRole: "member" }; }) },
      $executeRaw: vi.fn(async () => 1),
      $transaction: vi.fn(async (fn: any) => fn(prisma))
    };
    const result = new AuthService(prisma, env, { record: vi.fn() } as any).refresh(token);
    await Promise.resolve(); await Promise.resolve();
    const startedBeforeUserFinished = membershipStarted;
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    releaseToken({ id: "r1", userId: "user-1", orgId: "org-1", clientType: "bearer", expiresAt: new Date(Date.now()+60000) });
    releaseUser({ id: "user-1", isActive: true });
    await result;
    expect(startedBeforeUserFinished).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rotates refresh tokens atomically and reissues roles from current active user state", async () => {
    const token = createRefreshToken({
      userId: "user-1",
      orgId: "org-1",
      workspaceRoleDefault: "dev",
      globalRole: "member"
    });
    const prisma = {
      refreshToken: {
        findFirst: vi.fn(async () => ({
          id: "refresh-1",
          userId: "user-1",
          orgId: "org-1",
          sessionId: "session-1",
          clientType: "bearer",
          revokedAt: null,
          replacedAt: null,
          reuseDetectedAt: null,
          expiresAt: new Date(Date.now() + 60_000)
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => undefined)
      },
      user: {
        findUnique: vi.fn(async () => ({
          id: "user-1",
          orgId: "org-1",
          workspaceRoleDefault: "manager",
          globalRole: "owner",
          isActive: true
        }))
      },
      organizationMembership: {
        findUnique: vi.fn(async () => ({
          organizationId: "org-1",
          userId: "user-1",
          workspaceRoleDefault: "manager",
          globalRole: "owner",
          isActive: true
        }))
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    } as any;
    prisma.$executeRaw = vi.fn(async () => 1);
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    const result = await service.refresh(token);
    const accessPayload = jwt.decode(result.accessToken) as Record<string, unknown>;

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0][0].values).toEqual(expect.arrayContaining(["refresh-1", "session-1", "bearer"]));
    expect(accessPayload.workspaceRoleDefault).toBe("manager");
    expect(accessPayload.globalRole).toBe("owner");
    expect(accessPayload.typ).toBe("access");
    const refreshPayload = jwt.decode(result.refreshToken) as Record<string, unknown>;
    expect(refreshPayload.typ).toBe("refresh");
    expect(refreshPayload.jti).toEqual(expect.any(String));
    expect(prisma.$executeRaw.mock.calls[0][0].values).toContain(refreshPayload.jti);
  });

  it("rejects access-token typed JWTs at the refresh endpoint even if secrets are accidentally equal", async () => {
    const sharedSecretEnv = {
      ...env,
      JWT_ACCESS_SECRET: "same-test-secret-with-enough-length",
      JWT_REFRESH_SECRET: "same-test-secret-with-enough-length"
    };
    const accessToken = jwt.sign(
      {
        typ: "access",
        userId: "user-1",
        orgId: "org-1",
        workspaceRoleDefault: "manager",
        globalRole: "owner"
      },
      sharedSecretEnv.JWT_ACCESS_SECRET,
      { expiresIn: "15m" }
    );
    const prisma = {
      refreshToken: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn()
      },
      user: {
        findUnique: vi.fn()
      }
    } as any;
    const service = new AuthService(prisma, sharedSecretEnv, { record: vi.fn() } as any);

    await expect(service.refresh(accessToken)).rejects.toMatchObject({
      statusCode: 401,
      code: "refresh_invalid"
    });
    expect(prisma.refreshToken.findFirst).not.toHaveBeenCalled();
  });

  it("rejects refresh tokens when conditional rotation loses the race", async () => {
    const token = createRefreshToken({
      userId: "user-1",
      orgId: "org-1",
      workspaceRoleDefault: "manager",
      globalRole: "owner"
    });
    const prisma = {
      refreshToken: {
        findFirst: vi.fn(async () => ({
          id: "refresh-1",
          userId: "user-1",
          orgId: "org-1",
          sessionId: "session-1",
          clientType: "bearer",
          revokedAt: null,
          replacedAt: null,
          reuseDetectedAt: null,
          expiresAt: new Date(Date.now() + 60_000)
        })),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 0 })
          .mockResolvedValueOnce({ count: 2 }),
        create: vi.fn()
      },
      user: {
        findUnique: vi.fn(async () => ({ id: "user-1", isActive: true }))
      },
      organizationMembership: {
        findUnique: vi.fn(async () => ({
          organizationId: "org-1",
          userId: "user-1",
          workspaceRoleDefault: "manager",
          globalRole: "owner",
          isActive: true
        }))
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    prisma.$executeRaw = vi.fn(async () => 0);
    await expect(service.refresh(token)).rejects.toMatchObject({
      statusCode: 401,
      code: "refresh_reused"
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { sessionId: "session-1" },
      data: {
        revokedAt: expect.any(Date),
        reuseDetectedAt: expect.any(Date),
        revokeReason: "refresh_reuse_detected"
      }
    });
  });

  it("revokes an entire refresh-token family on logout", async () => {
    const prisma = {
      refreshToken: {
        findUnique: vi.fn(async () => ({ id: "refresh-1", sessionId: "session-1" })),
        updateMany: vi.fn(async () => ({ count: 3 }))
      }
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await service.logout("refresh-token-value");

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { sessionId: "session-1" },
      data: { revokedAt: expect.any(Date), revokeReason: "logout" }
    });
  });

  it("revokes the full family when a rotated refresh token is replayed", async () => {
    const token = createRefreshToken({
      userId: "user-1",
      orgId: "org-1",
      sessionId: "session-1",
      workspaceRoleDefault: "manager",
      globalRole: "owner"
    });
    const prisma = {
      refreshToken: {
        findFirst: vi.fn(async () => ({
          id: "refresh-1",
          userId: "user-1",
          orgId: "org-1",
          sessionId: "session-1",
          clientType: "bearer",
          revokedAt: new Date(),
          replacedAt: new Date(),
          reuseDetectedAt: null,
          expiresAt: new Date(Date.now() + 60_000)
        })),
        updateMany: vi.fn(async () => ({ count: 2 }))
      },
      user: { findUnique: vi.fn(async () => null) },
      organizationMembership: { findUnique: vi.fn(async () => null) }
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(service.refresh(token)).rejects.toMatchObject({ statusCode: 401, code: "refresh_reused" });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { sessionId: "session-1" },
      data: {
        revokedAt: expect.any(Date),
        reuseDetectedAt: expect.any(Date),
        revokeReason: "refresh_reuse_detected"
      }
    });
  });

  it("rejects access JWT sessions after their refresh-token family is revoked", async () => {
    const prisma = {
      refreshToken: { findFirst: vi.fn(async () => null) }
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(service.assertSessionActive("session-1", "user-1", "org-1")).rejects.toMatchObject({
      statusCode: 401,
      code: "session_revoked"
    });
    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        userId: "user-1",
        orgId: "org-1",
        revokedAt: null,
        reuseDetectedAt: null,
        expiresAt: { gt: expect.any(Date) }
      },
      select: { id: true, lastUsedAt: true }
    });
  });

  it("authorizes an active session and organization membership in one database query", async () => {
    const prisma = {
      refreshToken: {
        findFirst: vi.fn(async () => ({
          id: "refresh-1",
          lastUsedAt: new Date(),
          user: {
            id: "user-1",
            email: "dev@example.com",
            emailVerifiedAt: null,
            displayName: "Dev",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            lastLoginAt: null,
            organizationMemberships: [{
              id: "membership-1",
              organizationId: "org-1",
              userId: "user-1",
              globalRole: "member",
              workspaceRoleDefault: "dev",
              organization: { id: "org-1", name: "Orchestra", slug: "orchestra" }
            }]
          }
        })),
        updateMany: vi.fn()
      }
    } as any;
    const sessionRow = await prisma.refreshToken.findFirst();
    prisma.refreshToken.findFirst.mockClear();
    prisma.$queryRaw = vi.fn(async () => [sessionRow]);
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(service.authorizeSessionContext("session-1", "user-1", "org-1")).resolves.toEqual({
      organizationMembershipId: "membership-1",
      userId: "user-1",
      orgId: "org-1",
      globalRole: "member",
      workspaceRoleDefault: "dev",
      profile: expect.objectContaining({ id: "user-1", email: "dev@example.com", organization: { id: "org-1", name: "Orchestra", slug: "orchestra" } })
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.findFirst).not.toHaveBeenCalled();
    const query = prisma.$queryRaw.mock.calls[0][0];
    expect(query.values).toEqual(expect.arrayContaining(["session-1", "user-1", "org-1"]));
    expect(query.sql).toContain('r.revoked_at IS NULL');
    expect(query.sql).toContain('r.reuse_detected_at IS NULL');
    expect(query.sql).toContain('u.is_active = true');
    expect(query.sql).toContain('m.is_active = true');
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a valid session when its organization membership is inactive", async () => {
    const prisma = {
      refreshToken: {
        findFirst: vi.fn(async () => ({ id: "refresh-1", lastUsedAt: new Date(), user: { organizationMemberships: [] } })),
        updateMany: vi.fn()
      }
    } as any;
    prisma.$queryRaw = vi.fn(async () => [{ id: "refresh-1", lastUsedAt: new Date(), user: { organizationMemberships: [] } }]);
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(service.authorizeSessionContext("session-1", "user-1", "org-1")).rejects.toMatchObject({
      statusCode: 401,
      code: "auth_membership_inactive"
    });
  });

  it("rejects refresh records that do not match the signed token subject", async () => {
    const token = createRefreshToken({
      userId: "user-1",
      orgId: "org-1",
      workspaceRoleDefault: "manager",
      globalRole: "owner"
    });
    const prisma = {
      organizationMembership: { findUnique: vi.fn(async () => null) },
      refreshToken: {
        findFirst: vi.fn(async () => ({
          id: "refresh-1",
          userId: "user-2",
          orgId: "org-1",
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000)
        })),
        updateMany: vi.fn(),
        create: vi.fn()
      },
      user: {
        findUnique: vi.fn()
      }
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(service.refresh(token)).rejects.toMatchObject({
      statusCode: 401,
      code: "refresh_invalid"
    });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it("does not return inactive users from getMe", async () => {
    const prisma = {
      organizationMembership: {
        findUnique: vi.fn(async () => null)
      }
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(service.getMe("inactive-user-1", "org-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "user_not_found"
    });
    expect(prisma.organizationMembership.findUnique).toHaveBeenCalledWith({
      where: { organizationId_userId: { organizationId: "org-1", userId: "inactive-user-1" } },
      select: expect.objectContaining({
        globalRole: true,
        workspaceRoleDefault: true,
        organization: { select: { id: true, name: true, slug: true } },
        user: { select: expect.objectContaining({ id: true, isActive: true }) }
      })
    });
  });

  it("loads the authenticated profile, membership roles, and organization in one query", async () => {
    const prisma = {
      organizationMembership: {
        findUnique: vi.fn(async () => ({
          globalRole: "member",
          workspaceRoleDefault: "dev",
          isActive: true,
          organization: { id: "org-1", name: "Orchestra", slug: "orchestra" },
          user: {
            id: "user-1",
            email: "dev@example.com",
            emailVerifiedAt: null,
            displayName: "Dev",
            isActive: true,
            createdAt: new Date("2026-01-01T00:00:00Z"),
            lastLoginAt: null
          }
        }))
      }
    } as any;
    const service = new AuthService(prisma, env, { record: vi.fn() } as any);

    await expect(service.getMe("user-1", "org-1")).resolves.toMatchObject({
      id: "user-1",
      orgId: "org-1",
      globalRole: "member",
      workspaceRoleDefault: "dev",
      organization: { id: "org-1" }
    });
    expect(prisma.organizationMembership.findUnique).toHaveBeenCalledTimes(1);
  });
});
