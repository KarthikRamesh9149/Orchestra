import { describe, expect, it, vi } from "vitest";
import { MeService } from "../src/modules/me/me.service.js";

const actor = { userId: "user-1", orgId: "org-1" };
const currentSessionId = "11111111-1111-4111-8111-111111111111";
const otherSessionId = "22222222-2222-4222-8222-222222222222";

function createService() {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({ id: actor.userId, orgId: actor.orgId, isActive: true }))
    },
    organizationMembership: {
      findUnique: vi.fn(async () => ({ organizationId: actor.orgId, userId: actor.userId, isActive: true }))
    },
    refreshToken: {
      findMany: vi.fn(async () => [
        {
          id: "token-current",
          sessionId: currentSessionId,
          clientType: "browser",
          deviceLabel: "Chrome on computer",
          deviceType: "laptop",
          ipLabel: "Network 12345678",
          lastUsedAt: new Date("2026-08-19T01:00:00.000Z"),
          createdAt: new Date("2026-08-19T00:00:00.000Z"),
          expiresAt: new Date("2026-09-19T00:00:00.000Z"),
          organization: { id: "org-1", name: "Orchestra" }
        },
        {
          id: "token-current-older",
          sessionId: currentSessionId,
          clientType: "browser",
          deviceLabel: "Chrome on computer",
          deviceType: "laptop",
          ipLabel: "Network 12345678",
          lastUsedAt: new Date("2026-08-19T00:30:00.000Z"),
          createdAt: new Date("2026-08-19T00:00:00.000Z"),
          expiresAt: new Date("2026-09-19T00:00:00.000Z"),
          organization: { id: "org-1", name: "Orchestra" }
        },
        {
          id: "token-other",
          sessionId: otherSessionId,
          clientType: "bearer",
          deviceLabel: "API or developer client",
          deviceType: "api",
          ipLabel: null,
          lastUsedAt: new Date("2026-08-18T01:00:00.000Z"),
          createdAt: new Date("2026-08-18T00:00:00.000Z"),
          expiresAt: new Date("2026-09-18T00:00:00.000Z"),
          organization: { id: "org-2", name: "Client Org" }
        }
      ]),
      updateMany: vi.fn(async () => ({ count: 1 }))
    }
  } as any;
  const auditService = { record: vi.fn(async () => undefined) } as any;
  return {
    prisma,
    auditService,
    service: new MeService(prisma, auditService)
  };
}

describe("MeService refresh-token session families", () => {
  it("lists the durable family id and marks the access-token family as current", async () => {
    const { service } = createService();
    const sessions = await service.listSessions(actor, currentSessionId);

    expect(sessions.map(({ id, current }) => ({ id, current }))).toEqual([
      { id: currentSessionId, current: true },
      { id: otherSessionId, current: false }
    ]);
    expect(sessions[0]).toMatchObject({
      deviceLabel: "Chrome on computer",
      deviceType: "laptop",
      ipLabel: "Network 12345678",
      lastUsedAt: "2026-08-19T01:00:00.000Z",
      organization: { id: "org-1", name: "Orchestra" }
    });
  });

  it("revokes every active token in the selected owned family", async () => {
    const { service, prisma } = createService();
    await service.revokeSession(actor, otherSessionId);

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: otherSessionId,
        userId: actor.userId,
        revokedAt: null,
        reuseDetectedAt: null
      },
      data: { revokedAt: expect.any(Date), revokeReason: "user_revoked" }
    });
  });

  it("revokes all other families while preserving the authoritative current family", async () => {
    const { service, prisma } = createService();
    await service.revokeAllSessions(actor, { includeCurrent: false, currentSessionId });

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        userId: actor.userId,
        revokedAt: null,
        reuseDetectedAt: null,
        sessionId: { not: currentSessionId }
      },
      data: { revokedAt: expect.any(Date), revokeReason: "user_revoked_all" }
    });
  });
});
