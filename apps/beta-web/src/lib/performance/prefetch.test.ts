import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prefetchPrimaryRoute } from "./prefetch";
import "../desktop";

const settings = vi.hoisted(() => ({
  getIntegrationsList: vi.fn(),
  getWorkspace: vi.fn(),
  getMembersList: vi.fn(),
  listWorkspaceInvites: vi.fn(),
  getProfile: vi.fn(),
  getSessions: vi.fn(),
  getLinkedAccounts: vi.fn(),
  getAppearancePreference: vi.fn(),
}));

vi.mock("../api/settings", () => settings);
vi.mock("../../pages/SettingsPage", () => ({ default: () => null }));

beforeEach(() => {
  vi.useFakeTimers();
  for (const read of Object.values(settings)) read.mockResolvedValue([]);
  delete window.orchestra;
  delete window.orchestraShared;
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  delete window.orchestra;
  delete window.orchestraShared;
});

function setRuntime(runtime: "local" | "shared" | "browser") {
  if (runtime === "local") {
    window.orchestra = {
      status: async () => ({ state: "ready", message: "" }),
      bootstrap: async () => ({ ok: true }),
      completeOnboarding: async () => ({ ok: true }),
    };
  } else if (runtime === "shared") {
    window.orchestraShared = {
      connection: { id: "server", name: "Shared", origin: "https://example.test", serverId: "server" },
      close: async () => {},
      copyText: async () => ({ ok: true }),
    };
  }
}

describe("Settings route prefetch", () => {
  it.each([
    { runtime: "local", canManage: true, inviteRequests: 0 },
    { runtime: "shared", canManage: true, inviteRequests: 1 },
    { runtime: "browser", canManage: true, inviteRequests: 1 },
    { runtime: "local", canManage: false, inviteRequests: 0 },
    { runtime: "shared", canManage: false, inviteRequests: 0 },
    { runtime: "browser", canManage: false, inviteRequests: 0 },
  ] as const)("$runtime, canManage=$canManage makes $inviteRequests invitation requests", async ({ runtime, canManage, inviteRequests }) => {
    setRuntime(runtime);
    const projectId = `project-${runtime}-${canManage}`;

    await prefetchPrimaryRoute("/settings", projectId, canManage);

    expect(settings.listWorkspaceInvites).toHaveBeenCalledTimes(inviteRequests);
    if (inviteRequests) expect(settings.listWorkspaceInvites).toHaveBeenCalledWith(projectId);
    for (const read of [settings.getIntegrationsList, settings.getWorkspace, settings.getMembersList]) {
      expect(read).toHaveBeenCalledExactlyOnceWith(projectId);
    }
    for (const read of [settings.getProfile, settings.getSessions, settings.getLinkedAccounts, settings.getAppearancePreference]) {
      expect(read).toHaveBeenCalledExactlyOnceWith();
    }
  });

  it("reuses a pending warm-up across Settings query strings", async () => {
    const first = prefetchPrimaryRoute("/settings?tab=profile", "deduplicated-project", true);
    const second = prefetchPrimaryRoute("/settings?tab=team", "deduplicated-project", true);

    expect(second).toBe(first);
    await first;
    expect(settings.getWorkspace).toHaveBeenCalledOnce();
    expect(settings.listWorkspaceInvites).toHaveBeenCalledOnce();
  });
});
