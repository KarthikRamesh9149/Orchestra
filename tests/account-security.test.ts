import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/modules/auth/service.js";
import { hashPassword, verifyPassword } from "../src/lib/auth/password.js";

const env = {
  JWT_ACCESS_SECRET: "test-access-secret-with-enough-length",
  JWT_REFRESH_SECRET: "test-refresh-secret-with-enough-length",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL: "30d",
  PASSWORD_HASH_COST: 4,
  FRONTEND_BASE_URL: "https://beta.orchestraos.dev",
  APP_BASE_URL: "https://api.orchestraos.dev"
} as any;

describe("account verification and password security", () => {
  it("stores only the verification-token hash and deletes it when email delivery fails", async () => {
    let createData: any;
    const prisma: any = {
      user: { findFirst: vi.fn(async () => ({ id: "user-1", normalizedEmail: "user@example.com", displayName: "User", emailVerifiedAt: null })) },
      projectMember: { findFirst: vi.fn(async () => ({ id: "member-1" })) },
      userEmailVerificationToken: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async ({ data }: any) => { createData = data; return { id: "verification-1", ...data }; }),
        delete: vi.fn(async () => undefined)
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const email = { sendEmailVerification: vi.fn(async () => ({ status: "manual_required", provider: null, errorCode: "gmail_send_scope_missing" })) } as any;
    const audit = { record: vi.fn(), recordWithClient: vi.fn() } as any;
    const service = new AuthService(prisma, env, audit, email);

    const result = await service.requestEmailVerification({ userId: "user-1", orgId: "org-1", projectId: "project-1" });
    expect(result).toMatchObject({ status: "manual_required", errorCode: "gmail_send_scope_missing", expiresAt: null });
    expect(createData.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const verificationUrl = email.sendEmailVerification.mock.calls[0][0].verificationUrl as string;
    const rawToken = new URL(verificationUrl).searchParams.get("verify_email")!;
    expect(rawToken.length).toBeGreaterThanOrEqual(40);
    expect(createData.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(rawToken);
    expect(prisma.userEmailVerificationToken.delete).toHaveBeenCalledWith({ where: { id: "verification-1" } });
  });

  it("consumes a verification link exactly once before marking the email verified", async () => {
    const now = new Date();
    const record = {
      id: "verification-1",
      email: "user@example.com",
      consumedAt: null,
      expiresAt: new Date(now.getTime() + 60_000),
      user: { id: "user-1", orgId: "org-1", normalizedEmail: "user@example.com", emailVerifiedAt: null, isActive: true }
    };
    const prisma: any = {
      userEmailVerificationToken: {
        findUnique: vi.fn(async () => record),
        updateMany: vi.fn(async () => ({ count: 1 }))
      },
      user: { update: vi.fn(async () => undefined) },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const audit = { record: vi.fn(), recordWithClient: vi.fn() } as any;
    const service = new AuthService(prisma, env, audit);
    await expect(service.confirmEmailVerification("one-time-token")).resolves.toMatchObject({ verified: true });
    expect(prisma.userEmailVerificationToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ consumedAt: null }) }));
    prisma.userEmailVerificationToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.confirmEmailVerification("one-time-token")).rejects.toMatchObject({ code: "email_verification_unavailable" });
  });

  it("changes a verified global user's password from any active organization and revokes every session", async () => {
    const currentHash = await hashPassword("CurrentPassword123!", 4);
    let newHash = "";
    const prisma: any = {
      user: {
        findFirst: vi.fn(async () => ({ id: "user-1", passwordHash: currentHash, emailVerifiedAt: new Date() })),
        update: vi.fn(async ({ data }: any) => { newHash = data.passwordHash; })
      },
      refreshToken: { updateMany: vi.fn(async () => ({ count: 3 })) },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const audit = { record: vi.fn(), recordWithClient: vi.fn() } as any;
    const service = new AuthService(prisma, env, audit);
    await expect(service.changePassword({ userId: "user-1", orgId: "org-secondary", currentPassword: "CurrentPassword123!", newPassword: "NewPassword456!" })).resolves.toEqual({ changed: true, sessionsRevoked: true });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationMemberships: { some: { organizationId: "org-secondary", isActive: true } } }) }));
    expect(await verifyPassword("NewPassword456!", newHash)).toBe(true);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: "user-1", revokedAt: null }, data: { revokedAt: expect.any(Date), revokeReason: "password_changed" } });
  });
});
