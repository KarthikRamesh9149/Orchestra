import { describe, expect, it, vi } from "vitest";
import { MeService } from "../src/modules/me/me.service.js";

const actor = { userId: "user-1", orgId: "org-1" };
const now = new Date("2026-08-20T03:30:00.000Z");

function createService() {
  const preference = {
    id: "pref-1",
    appearanceTheme: "auto",
    updatedAt: now
  };
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ id: actor.userId, isActive: true })) },
    organizationMembership: {
      findUnique: vi.fn(async () => ({ organizationId: actor.orgId, userId: actor.userId, isActive: true })),
      findMany: vi.fn(async () => [{ organizationId: "org-1" }, { organizationId: "org-2" }])
    },
    userNotificationPreference: {
      upsert: vi.fn(async (args: { update?: { appearanceTheme?: string } }) => {
        if (args.update?.appearanceTheme) preference.appearanceTheme = args.update.appearanceTheme;
        return { ...preference };
      })
    },
    gitHubUserLink: {
      findMany: vi.fn(async () => [{ id: "gh-1", githubLogin: "manager", linkedAt: now, status: "active" }])
    },
    projectDriveConnection: {
      findMany: vi.fn(async () => [{
        id: "drive-1",
        googleAccountEmail: "manager@example.com",
        googleAccountSub: "google-sub",
        status: "connected",
        connectedAt: now,
        createdAt: now
      }])
    },
    projectCalendarConnection: {
      findMany: vi.fn(async () => [
        { id: "cal-1", provider: "google_calendar", accountLabel: "manager@example.com", status: "syncing", createdAt: now },
        { id: "cal-2", provider: "outlook_calendar", accountLabel: "manager@company.com", status: "error", createdAt: now }
      ])
    },
    communicationConnector: {
      findMany: vi.fn(async () => [
        { id: "gmail-1", provider: "gmail", accountLabel: "manager@example.com", status: "connected", createdAt: now },
        { id: "teams-1", provider: "microsoft_teams", accountLabel: "manager@company.com", status: "connected", createdAt: now }
      ])
    }
  } as any;
  const auditService = { record: vi.fn(async () => undefined) } as any;
  return { prisma, auditService, service: new MeService(prisma, auditService) };
}

describe("MeService account preferences and linked identities", () => {
  it("creates an authoritative default and persists only supported themes", async () => {
    const { service, prisma, auditService } = createService();

    await expect(service.getAppearancePreference(actor)).resolves.toEqual({
      theme: "auto",
      updatedAt: now.toISOString()
    });
    await expect(service.updateAppearancePreference(actor, "dark")).resolves.toEqual({
      theme: "dark",
      updatedAt: now.toISOString()
    });
    expect(prisma.userNotificationPreference.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: actor.userId },
        update: { appearanceTheme: "dark" }
      })
    );
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "appearance_preference.updated",
      payload: { theme: "dark" }
    }));
  });

  it("returns only actor-owned links, deduplicated by provider identity with honest status", async () => {
    const { service, prisma } = createService();
    const accounts = await service.listLinkedAccounts(actor);

    expect(prisma.gitHubUserLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: actor.userId, orgId: { in: ["org-1", "org-2"] }, status: "active", revokedAt: null }
    }));
    expect(prisma.projectDriveConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectedByUserId: actor.userId, project: { orgId: { in: ["org-1", "org-2"] } } })
    }));
    expect(accounts).toEqual([
      expect.objectContaining({ service: "github", accountIdentifier: "manager", connected: true }),
      expect.objectContaining({
        service: "google",
        accountIdentifier: "manager@example.com",
        connected: true,
        sources: ["gmail", "google_calendar", "google_drive"]
      }),
      expect.objectContaining({
        service: "microsoft",
        accountIdentifier: "manager@company.com",
        connected: true,
        sources: ["microsoft_teams", "outlook_calendar"]
      })
    ]);
  });
});
