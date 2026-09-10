import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { AuthService } from "../src/modules/auth/service.js";

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-with-enough-length",
  JWT_REFRESH_SECRET: "test-refresh-secret-with-enough-length",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
  PASSWORD_HASH_COST: 4,
  SIGNUP_MODE: "invite_only",
  SIGNUP_ALLOWED_EMAIL_DOMAINS: ""
} as any;

const validInvite = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  orgId: "33333333-3333-4333-8333-333333333333",
  codePrefix: "ORCH-ABC123",
  createdBy: "44444444-4444-4444-8444-444444444444",
  projectRole: "dev" as const,
  canApproveTruthChanges: false,
  invitedEmail: "invitee@example.com",
  linkTokenExpiresAt: new Date(Date.now() + 60_000),
  emailDeliveryStatus: "pending",
  maxUses: 1,
  useCount: 0,
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  project: { id: "22222222-2222-4222-8222-222222222222", orgId: "33333333-3333-4333-8333-333333333333", name: "Shared project" }
};

function createPrisma(
  existingUser: Record<string, unknown> | null = null,
  invitation: Record<string, any> = validInvite
) {
  const prisma = {
    projectJoinCode: {
      findUnique: vi.fn(async () => invitation),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    user: {
      findUnique: vi.fn(async () => existingUser),
      create: vi.fn(async ({ data }: any) => ({ id: "55555555-5555-4555-8555-555555555555", isActive: true, ...data }))
    },
    organizationMembership: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: any) => ({ id: "66666666-6666-4666-8666-666666666666", isActive: true, ...create }))
    },
    projectMember: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: "77777777-7777-4777-8777-777777777777" }))
    },
    projectJoinCodeRedemption: {
      create: vi.fn(async ({ data }: any) => ({ id: "88888888-8888-4888-8888-888888888888", ...data }))
    },
    refreshToken: { create: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (callback: any) => callback(prisma))
  } as any;
  return prisma;
}

describe("durable invitation completion", () => {
  it("redeems an email-link token without confusing delivery with global email verification", async () => {
    const prisma = createPrisma(null, { ...validInvite, emailDeliveryStatus: "sent" });
    const service = new AuthService(prisma, env, { record: vi.fn(), recordWithClient: vi.fn() } as any);
    const rawToken = "strong-one-time-invitation-token-with-256-bits-of-entropy";
    await service.completeInvitationAccount({
      email: "invitee@example.com",
      inviteToken: rawToken,
      password: "Password123!",
      displayName: "Invited Teammate"
    });
    const where = prisma.projectJoinCode.findUnique.mock.calls[0][0].where;
    expect(where.linkTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(where.linkTokenHash).not.toBe(rawToken);
    expect(prisma.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ emailVerifiedAt: null }) });
  });

  it("does not verify an email when the inviter redeems the returned code after successful delivery", async () => {
    const prisma = createPrisma(null, { ...validInvite, emailDeliveryStatus: "sent" });
    const service = new AuthService(prisma, env, { record: vi.fn(), recordWithClient: vi.fn() } as any);
    await service.completeInvitationAccount({ email: "invitee@example.com", code: "ABC123", password: "Password123!", displayName: "Invitee" });
    expect(prisma.user.create.mock.calls[0][0].data.emailVerifiedAt).toBeNull();
  });

  it("creates a password-backed profile and durable memberships for a new invitee", async () => {
    const prisma = createPrisma();
    const auditService = { record: vi.fn(), recordWithClient: vi.fn() } as any;
    const service = new AuthService(prisma, env, auditService);

    const result = await service.completeInvitationAccount({
      email: " Invitee@Example.com ",
      code: "ORCH-ABC123-DEF456",
      password: "Password123!",
      displayName: "Invited Teammate"
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "invitee@example.com",
        normalizedEmail: "invitee@example.com",
        displayName: "Invited Teammate",
        passwordHash: expect.any(String)
      })
    });
    expect(prisma.user.create.mock.calls[0][0].data.passwordHash).not.toBeNull();
    expect(prisma.organizationMembership.upsert).toHaveBeenCalled();
    expect(prisma.projectMember.upsert).toHaveBeenCalled();
    expect(prisma.projectJoinCodeRedemption.create).toHaveBeenCalled();
    expect(prisma.projectJoinCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ useCount: { lt: 1 } })
    }));
    expect(jwt.decode(result.accessToken)).toMatchObject({
      userId: "55555555-5555-4555-8555-555555555555",
      orgId: validInvite.orgId
    });
  });

  it("requires an existing account password before atomically redeeming into the invited organization", async () => {
    const existingUser = {
      id: "99999999-9999-4999-8999-999999999999",
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "invitee@example.com",
      normalizedEmail: "invitee@example.com",
      passwordHash: "$2b$08$wiPjiOQcgiXB2J2UIrCVWug6AjOqbysInKRlkKvr1LMsW6FVMceAe",
      displayName: "Existing User",
      globalRole: "member",
      workspaceRoleDefault: "dev",
      isActive: true
    };
    const prisma = createPrisma(existingUser);
    const service = new AuthService(prisma, env, { record: vi.fn(), recordWithClient: vi.fn() } as any);

    const result = await service.redeemInvitationForExistingAccount({
      email: "invitee@example.com",
      password: "Password123!",
      code: "ORCH-ABC123-DEF456"
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.organizationMembership.upsert).toHaveBeenCalled();
    expect(prisma.projectMember.upsert).toHaveBeenCalled();
    expect(prisma.projectJoinCodeRedemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: existingUser.id, joinCodeId: validInvite.id })
    });
    expect(jwt.decode(result.accessToken)).toMatchObject({ userId: existingUser.id, orgId: validInvite.orgId });
  });

  it("does not mutate anything when the invite is bound to another email", async () => {
    const prisma = createPrisma();
    const service = new AuthService(prisma, env, { record: vi.fn(), recordWithClient: vi.fn() } as any);

    await expect(service.completeInvitationAccount({
      email: "other@example.com",
      code: "ORCH-ABC123-DEF456",
      password: "Password123!",
      displayName: "Other Person"
    })).rejects.toMatchObject({ statusCode: 403, code: "join_code_email_mismatch" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.projectJoinCode.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", { expiresAt: new Date(Date.now() - 1) }],
    ["revoked", { revokedAt: new Date() }],
    ["already used", { useCount: 1 }],
    ["legacy multi-use", { maxUses: 2 }]
  ])("rejects %s invitations before starting a transaction", async (_label, override) => {
    const prisma = createPrisma(null, { ...validInvite, ...override });
    const service = new AuthService(prisma, env, { record: vi.fn(), recordWithClient: vi.fn() } as any);

    await expect(service.completeInvitationAccount({
      email: "invitee@example.com",
      code: "ORCH-ABC123-DEF456",
      password: "Password123!",
      displayName: "Invited Teammate"
    })).rejects.toMatchObject({ statusCode: 410, code: "join_code_unavailable" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back redemption when the conditional code-consumption update loses a race", async () => {
    const prisma = createPrisma();
    prisma.projectJoinCode.updateMany.mockResolvedValue({ count: 0 });
    const service = new AuthService(prisma, env, { record: vi.fn(), recordWithClient: vi.fn() } as any);

    await expect(service.completeInvitationAccount({
      email: "invitee@example.com",
      code: "ORCH-ABC123-DEF456",
      password: "Password123!",
      displayName: "Invited Teammate"
    })).rejects.toMatchObject({ statusCode: 410, code: "join_code_unavailable" });
  });
});
