import { http, HttpResponse } from "msw";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render as renderView } from "@testing-library/react";
import { Toaster, useToastStore } from "../components/ui/Toaster";
import { useThemeStore } from "../store/themeStore";
import { server } from "../test/server";
import { SettingsPage } from "./SettingsPage";
import * as desktopMode from "../lib/desktop";

function render(node: React.ReactNode) { return renderView(<>{node}<Toaster /></>); }

const auth = vi.hoisted(() => ({
  refreshProject: vi.fn(async () => null),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    activeProject: { id: "local-project", name: "Original Workspace", projectRole: "manager" },
    user: { id: "local-user", email: "local@example.test", displayName: "Local User" },
    refreshProject: auth.refreshProject,
  }),
}));

describe("Settings workspace persistence", () => {
  it("local Settings does not present retained server evidence as live connector access", async () => {
    vi.spyOn(desktopMode, "isDesktop").mockReturnValue(true);
    let hostedStatusReads = 0;
    server.use(http.get("http://localhost:3000/v1/projects/local-project/integrations/status", () => {
      hostedStatusReads++;
      return HttpResponse.json({data:{providers:[{provider:"slack",label:"Slack",connected:true,status:"connected",availableActions:["disconnect"]}]},error:null});
    }));
    render(<SettingsPage />);
    await screen.findByText("Original Workspace");
    expect(screen.queryByRole("button", {name:"Disconnect Slack"})).not.toBeInTheDocument();
    expect(hostedStatusReads).toBe(0);
    expect(document.getElementById("integrations")).toBeNull();
  });
  it("[R08] renders each toast once with the app-level outlet", async () => {
    render(<SettingsPage />);
    await screen.findByText("Original Workspace");
    act(() => useToastStore.getState().add("Unique saved notification", "success"));
    expect(screen.getAllByText("Unique saved notification")).toHaveLength(1);
  });
  beforeEach(() => {
    auth.refreshProject.mockClear();
    useThemeStore.getState().setMode("auto");
  });
  afterEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.restoreAllMocks();
  });

  it("loads the authoritative workspace through the MSW-backed API contract", async () => {
    render(<SettingsPage />);

    expect(await screen.findByText("Original Workspace")).toBeVisible();
    expect(screen.getByText("original-workspace")).toBeVisible();
  });

  it("[FIX-19] disables unavailable integrations, hides manual import, and exposes only authorized actions", async () => {
    const actions: string[] = [];
    server.use(
      http.get("http://localhost:3000/v1/projects/local-project/integrations/status", () => HttpResponse.json({
        data: {
          providers: [
            { provider: "slack", label: "Slack", connected: false, status: "not_configured", availableActions: [] },
            { provider: "google_drive", label: "Google Drive", connected: true, status: "connected", availableActions: ["sync", "disconnect"] },
          ],
        },
        meta: null,
        error: null,
      })),
      http.get("http://localhost:3000/v1/projects/local-project/connectors/readiness", () => HttpResponse.json({
        data: [
          { provider: "slack", metadata: { label: "Slack" }, connectorId: null, connectorStatus: null, readiness: { state: "readiness_gated", canConnect: false, canSync: false, canDisconnect: false, canWebhook: false, reasons: ["missing_oauth_configuration"], missingConfig: ["SLACK_CLIENT_SECRET"], deferredFeatures: [] } },
          { provider: "manual_import", metadata: { label: "Manual import" }, connectorId: null, connectorStatus: null, readiness: { state: "enabled", canConnect: true, canSync: false, canDisconnect: false, canWebhook: false, reasons: [], missingConfig: [], deferredFeatures: [] } },
        ],
        meta: null,
        error: null,
      })),
      http.post("http://localhost:3000/v1/projects/local-project/connectors/google-drive/sync", () => {
        actions.push("sync");
        return HttpResponse.json({ data: { status: "queued" }, meta: null, error: null });
      }),
      http.post("http://localhost:3000/v1/projects/local-project/connectors/google-drive/disconnect", () => {
        actions.push("disconnect");
        return HttpResponse.json({ data: { status: "disconnected" }, meta: null, error: null });
      })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<SettingsPage />);

    expect(await screen.findByText("Slack is not configured by an administrator.")).toBeVisible();
    expect(screen.queryByText("Manual import")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slack unavailable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Google Drive" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disconnect Google Drive" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Connect Slack" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sync Google Drive" }));
    await waitFor(() => expect(actions).toEqual(["sync"]));
    await user.click(screen.getByRole("button", { name: "Disconnect Google Drive" }));
    await waitFor(() => expect(actions).toEqual(["sync", "disconnect"]));
    expect(window.confirm).toHaveBeenCalledWith("Disconnect Google Drive? Existing evidence will remain, but future syncs will stop.");
  });

  it("refuses an unsafe integration authorization redirect", async () => {
    server.use(
      http.get("http://localhost:3000/v1/projects/local-project/integrations/status", () => HttpResponse.json({
        data: { providers: [{ provider: "github", label: "GitHub", connected: false, status: "connectable", availableActions: ["connect"] }] },
        meta: null,
        error: null,
      })),
      http.get("http://localhost:3000/v1/projects/local-project/connectors/readiness", () => HttpResponse.json({
        data: [{ provider: "github", metadata: { label: "GitHub" }, connectorId: null, connectorStatus: null, readiness: { state: "enabled", canConnect: true, canSync: false, canDisconnect: false, canWebhook: false, reasons: [], missingConfig: [], deferredFeatures: [] } }],
        meta: null,
        error: null,
      })),
      http.get("http://localhost:3000/v1/github/install-url", () => HttpResponse.json({
        data: { installUrl: "javascript:alert(1)" }, meta: null, error: null,
      }))
    );
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts[toasts.length - 1]?.message).toContain("unsafe redirect URL");
    });
  });

  it("[FIX-17] keeps the server value and reports failure when rename persistence is rejected", async () => {
    let patchAttempted = false;
    server.use(
      http.patch("http://localhost:3000/v1/projects/local-project/settings", () => {
        patchAttempted = true;
        return HttpResponse.json(
          { data: null, meta: null, error: { code: "SAVE_REJECTED", message: "Rename rejected" } },
          { status: 503 }
        );
      })
    );

    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByText("Original Workspace");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByDisplayValue("Original Workspace");
    await user.clear(input);
    await user.type(input, "Unsaved Workspace");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchAttempted).toBe(true));
    expect(screen.queryByText("Workspace name updated")).not.toBeInTheDocument();
    expect(screen.getByText("Original Workspace")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("[SAVE_REJECTED] Rename rejected");
    expect(auth.refreshProject).not.toHaveBeenCalled();
  });

  it("persists a workspace rename before updating shared state or claiming success", async () => {
    let body: unknown;
    server.use(
      http.patch("http://localhost:3000/v1/projects/local-project/settings", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: {
            projectId: "local-project",
            name: "Persisted Workspace",
            slug: "original-workspace",
            createdAt: "2026-08-19T00:00:00.000Z",
          },
          meta: null,
          error: null,
        });
      })
    );

    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByText("Original Workspace");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByDisplayValue("Original Workspace"));
    await user.type(screen.getByRole("textbox"), "Persisted Workspace");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Persisted Workspace")).toBeVisible();
    expect(body).toEqual({ name: "Persisted Workspace" });
    expect(auth.refreshProject).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Workspace name updated")).toBeInTheDocument();
  });

  it("preserves exact invite roles and displays durable account-completion state", async () => {
    let createdBody: unknown;
    let revoked = false;
    let invites: Array<Record<string, unknown>> = [];
    server.use(
      http.get("http://localhost:3000/v1/projects/local-project/join-codes", () =>
        HttpResponse.json({ data: invites, meta: null, error: null })
      ),
      http.post("http://localhost:3000/v1/projects/local-project/join-codes", async ({ request }) => {
        createdBody = await request.json();
        const invite = {
          id: "invite-1",
          code: "ABC234",
          codePrefix: "ABC",
          invitedEmail: "client@example.test",
          projectRole: "client",
          canApproveTruthChanges: false,
          maxUses: 1,
          useCount: 0,
          expiresAt: "2099-01-01T00:00:00.000Z",
          revokedAt: null,
          createdAt: "2026-08-20T00:00:00.000Z",
          emailDeliveryStatus: "sent",
          emailDeliveryProvider: "gmail",
          emailSentAt: "2026-08-20T00:00:01.000Z",
          emailDeliveryError: null,
        };
        invites = [{ ...invite, code: undefined }];
        return HttpResponse.json({ data: invite, meta: null, error: null });
      }),
      http.post("http://localhost:3000/v1/projects/local-project/join-codes/invite-1/revoke", () => {
        revoked = true;
        invites = invites.map((invite) => ({ ...invite, revokedAt: "2026-08-20T01:00:00.000Z" }));
        return HttpResponse.json({ data: { id: "invite-1", revokedAt: "2026-08-20T01:00:00.000Z" }, meta: null, error: null });
      })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<SettingsPage />);
    await screen.findByText("Original Workspace");
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(screen.getByLabelText("Invite email"), "client@example.test");
    await user.selectOptions(screen.getByLabelText("Invite role"), "client");
    await user.click(screen.getByRole("button", { name: "Create invite" }));

    expect(await screen.findByText("ABC234")).toBeVisible();
    expect(screen.getByText("Six-character activation code — shown in full once")).toBeVisible();
    expect(screen.getByText("client@example.test")).toBeVisible();
    expect(screen.getByText("pending")).toBeVisible();
    expect(createdBody).toEqual({
      invitedEmail: "client@example.test",
      projectRole: "client",
      canApproveTruthChanges: false,
    });

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revoked).toBe(true));
    expect(screen.queryByText("ABC234")).not.toBeInTheDocument();
    expect(await screen.findByText("revoked")).toBeVisible();
  });

  it("confirms and persists truth approval, exact roles, and member removal", async () => {
    let role: "dev" | "client" = "dev";
    let canApproveTruthChanges = false;
    let isActive = true;
    const requests: Array<{ method: string; body?: unknown }> = [];
    const member = () => ({
      id: "member-2",
      userId: "user-2",
      user: { displayName: "Dev User", email: "dev@example.test" },
      projectRole: role,
      canApproveTruthChanges,
      isActive,
    });
    server.use(
      http.get("http://localhost:3000/v1/projects/local-project/members", () =>
        HttpResponse.json({ data: { members: isActive ? [member()] : [] }, meta: null, error: null })
      ),
      http.post("http://localhost:3000/v1/projects/local-project/truth-approvers", async ({ request }) => {
        requests.push({ method: "grant", body: await request.json() });
        canApproveTruthChanges = true;
        return HttpResponse.json({ data: member(), meta: null, error: null });
      }),
      http.patch("http://localhost:3000/v1/projects/local-project/members/member-2", async ({ request }) => {
        const body = await request.json() as { projectRole?: "client"; isActive?: boolean };
        requests.push({ method: "patch", body });
        if (body.projectRole) role = body.projectRole;
        if (body.isActive === false) isActive = false;
        return HttpResponse.json({ data: member(), meta: null, error: null });
      })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<SettingsPage />);
    expect(await screen.findByText("Dev User")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Grant approval" }));
    expect(await screen.findByText("Truth approver")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Role for Dev User"), "client");
    await waitFor(() => expect(screen.getByLabelText("Role for Dev User")).toHaveValue("client"));
    await user.click(screen.getByRole("button", { name: "Remove Dev User" }));
    await waitFor(() => expect(screen.queryByText("Dev User")).not.toBeInTheDocument());

    expect(requests).toEqual([
      { method: "grant", body: { memberId: "member-2" } },
      { method: "patch", body: { projectRole: "client" } },
      { method: "patch", body: { isActive: false } },
    ]);
    expect(window.confirm).toHaveBeenCalledTimes(3);
  });

  it("[FIX-18] loads honest verification and linked-account state from the backend", async () => {
    server.use(
      http.get("http://localhost:3000/v1/me/profile", () => HttpResponse.json({
        data: {
          userId: "local-user",
          displayName: "Local User",
          email: "local@example.test",
          emailVerified: false,
          emailVerifiedAt: null,
          globalRole: "owner",
          createdAt: "2026-08-19T00:00:00.000Z",
        },
        meta: null,
        error: null,
      })),
      http.get("http://localhost:3000/v1/me/linked-accounts", () => HttpResponse.json({
        data: [
          { id: "google:1", service: "google", connected: true, accountIdentifier: "local@example.test", status: "connected", linkedAt: "2026-08-19T00:00:00.000Z", sources: ["google_drive"] },
          { id: "github:1", service: "github", connected: true, accountIdentifier: "local-user", status: "active", linkedAt: "2026-08-19T00:00:00.000Z", sources: ["github_user_link"] },
          { id: "microsoft:1", service: "microsoft", connected: false, accountIdentifier: "local@company.test", status: "needs_reauth", linkedAt: "2026-08-19T00:00:00.000Z", sources: ["outlook_calendar"] },
        ],
        meta: null,
        error: null,
      }))
    );

    render(<SettingsPage />);

    expect(await screen.findByText("Email not verified")).toBeVisible();
    expect(screen.getByText("local-user")).toBeVisible();
    expect(screen.getByText("local@company.test")).toBeVisible();
    expect(screen.getByText("Needs attention")).toBeVisible();
  });

  it("persists appearance before applying it and keeps the old theme on rejection", async () => {
    const requests: unknown[] = [];
    server.use(
      http.get("http://localhost:3000/v1/me/appearance-preference", () => HttpResponse.json({
        data: { theme: "light", updatedAt: "2026-08-20T00:00:00.000Z" }, meta: null, error: null,
      })),
      http.patch("http://localhost:3000/v1/me/appearance-preference", async ({ request }) => {
        const body = await request.json();
        requests.push(body);
        if ((body as { theme?: string }).theme === "auto") {
          return HttpResponse.json(
            { data: null, meta: null, error: { code: "PREFERENCE_REJECTED", message: "Preference rejected" } },
            { status: 503 }
          );
        }
        return HttpResponse.json({
          data: { theme: "dark", updatedAt: "2026-08-20T00:01:00.000Z" }, meta: null, error: null,
        });
      })
    );
    const user = userEvent.setup();
    render(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "light" })).toHaveAttribute("aria-pressed", "true"));
    await user.click(screen.getByRole("button", { name: "dark" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "dark" })).toHaveAttribute("aria-pressed", "true"));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(screen.getByRole("button", { name: "auto" }));
    expect(await screen.findByText("[PREFERENCE_REJECTED] Preference rejected")).toBeVisible();
    expect(screen.getByRole("button", { name: "dark" })).toHaveAttribute("aria-pressed", "true");
    expect(requests).toEqual([{ theme: "dark" }, { theme: "auto" }]);
  });

  it("refreshes sessions from authoritative server state after confirmed revoke", async () => {
    let revoked = false;
    server.use(
      http.get("http://localhost:3000/v1/me/sessions", () => HttpResponse.json({
        data: [
          { id: "current", deviceLabel: "Current browser", current: true, status: "active", lastUsedAt: "2026-08-20T00:00:00.000Z", expiresAt: "2026-09-20T00:00:00.000Z" },
          ...(!revoked ? [{ id: "other", deviceLabel: "Other browser", current: false, status: "active", lastUsedAt: "2026-08-19T00:00:00.000Z", expiresAt: "2026-09-19T00:00:00.000Z" }] : []),
        ],
        meta: null,
        error: null,
      })),
      http.delete("http://localhost:3000/v1/me/sessions/other", () => {
        revoked = true;
        return HttpResponse.json({ data: { revoked: true, sessionId: "other" }, meta: null, error: null });
      })
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect(await screen.findByText("Other browser")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByText("Other browser")).not.toBeInTheDocument());
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 active session")).toBeVisible();
  });

  it("keeps avatar upload unexposed until private storage exists", async () => {
    render(<SettingsPage />);
    await screen.findByText("Account");
    expect(screen.queryByLabelText(/avatar upload/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
