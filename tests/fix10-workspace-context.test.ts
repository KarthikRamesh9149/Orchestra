import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { AuthService } from "../src/modules/auth/service.js";
import { MeService } from "../src/modules/me/me.service.js";

const actor = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" };
const sessionId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const targetOrgId = "55555555-5555-4555-8555-555555555555";

describe("Fix 10 authoritative workspace context", () => {
  it("lists projects across active organization memberships and marks only the server-persisted project current", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [{ projectId, organizationId: targetOrgId, organizationName: "Client Org", organizationSlug: "client-org", name: "Client Workspace", slug: "client-workspace", role: "client", canApproveTruthChanges: false, memberCount: 2, createdAt: new Date("2026-08-19T00:00:00.000Z"), lastOpenedAt: new Date("2026-08-19T01:00:00.000Z"), current: true }]),
      organizationMembership: {
        findMany: vi.fn(async () => [{ organizationId: actor.orgId }, { organizationId: targetOrgId }])
      },
      projectMember: {
        findMany: vi.fn(async () => [{
          projectRole: "client",
          canApproveTruthChanges: false,
          project: {
            id: projectId,
            orgId: targetOrgId,
            name: "Client Workspace",
            slug: "client-workspace",
            status: "active",
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            organization: { id: targetOrgId, name: "Client Org", slug: "client-org" },
            _count: { members: 2 }
          }
        }])
      },
      refreshToken: {
        findFirst: vi.fn(async () => ({ activeProjectId: projectId, lastUsedAt: new Date("2026-08-19T01:00:00.000Z") }))
      }
    } as any;
    const service = new MeService(prisma, { record: vi.fn() } as any);

    const workspaces = await service.listWorkspaces(actor, sessionId);

    expect(workspaces).toEqual([expect.objectContaining({
      projectId,
      organizationId: targetOrgId,
      organizationName: "Client Org",
      role: "client",
      current: true,
      memberCount: 2
    })]);
    expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual([sessionId, actor.userId, actor.orgId, expect.any(Date), actor.userId]);
  });

  it("atomically reissues the same session family for the target organization and project", async () => {
    const source = {
      id: "66666666-6666-4666-8666-666666666666",
      sessionId,
      clientType: "browser",
      deviceLabel: "Chrome on computer",
      deviceType: "laptop",
      userAgentHash: "ua-hash",
      ipAddressHash: "ip-hash",
      ipLabel: "Network ip-hash"
    };
    const prisma: any = {
      refreshToken: {
        findFirst: vi.fn(async () => source),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => undefined)
      },
      organizationMembership: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ organizationId: targetOrgId, userId: actor.userId, globalRole: "member", workspaceRoleDefault: "client", isActive: true })
          .mockResolvedValueOnce({
            globalRole: "member",
            workspaceRoleDefault: "client",
            isActive: true,
            organization: { id: targetOrgId, name: "Client Org", slug: "client-org" },
            user: { id: actor.userId, email: "client@example.com", displayName: "Client", isActive: true, emailVerifiedAt: null, createdAt: new Date(), lastLoginAt: null }
          })
      },
      projectMember: {
        findFirst: vi.fn(async () => ({ id: "member-1", projectRole: "client" }))
      },
      $transaction: vi.fn(async (callback: any) => callback(prisma))
    };
    const service = new AuthService(prisma, {
      JWT_ACCESS_SECRET: "test-access-secret-with-enough-length",
      JWT_REFRESH_SECRET: "test-refresh-secret-with-enough-length",
      JWT_ACCESS_TTL: "15m",
      JWT_REFRESH_TTL: "30d"
    } as any, { record: vi.fn(), recordWithClient: vi.fn(async () => undefined) } as any);

    const result = await service.switchSessionContext({
      userId: actor.userId,
      currentOrgId: actor.orgId,
      targetOrgId,
      projectId,
      sessionId
    });

    expect(jwt.decode(result.accessToken)).toMatchObject({ orgId: targetOrgId, sessionId, workspaceRoleDefault: "client" });
    expect(prisma.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: targetOrgId,
        sessionId,
        activeProjectId: projectId,
        parentTokenId: source.id,
        clientType: "browser"
      })
    });
    expect(result.user).toMatchObject({ orgId: targetOrgId, emailVerified: false, workspaceRoleDefault: "client" });
  });
});
