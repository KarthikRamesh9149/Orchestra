import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api/client";
import type { DashboardData } from "../lib/api/dashboard";
import type { Subscription } from "../lib/types/dashboard";
import { DashboardPage, monthlyEquivalent, safeExternalUrl } from "./DashboardPage";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(), refreshDashboard: vi.fn(), listSubscriptions: vi.fn(),
  createSubscription: vi.fn(), updateSubscription: vi.fn(), deleteSubscription: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ activeProject: { id: "project-1", projectRole: "manager" } }),
}));
vi.mock("../lib/api/dashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/dashboard")>();
  return { ...actual, ...mocks };
});

const created: Subscription = {
  id: "sub-1", name: "Supabase Pro", category: "DATABASE", cost: 25, billingType: "monthly", status: "active",
  provider: "Supabase", externalRef: "https://supabase.com/dashboard", renewsAt: null,
  iconLabel: "S", iconBg: "#eee", iconTextColor: "#111",
};
const dashboard: DashboardData = {
  stats: [], team: [], changes: [], calendarEvents: [], slackMessages: [], gitCommits: [], activity: [], socratesQueries: [],
  subscriptions: [], updatedAt: "2026-08-20T02:00:00.000Z",
};

describe("Dashboard backend actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboard.mockResolvedValue(dashboard);
    mocks.listSubscriptions.mockResolvedValue([created]);
    mocks.createSubscription.mockResolvedValue(created);
  });

  it("only links safe provider URLs and computes comparable monthly active cost", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("https://provider.example/account")).toBe("https://provider.example/account");
    expect(monthlyEquivalent({ ...created, cost: 120, billingType: "annual" })).toBe(10);
    expect(monthlyEquivalent({ ...created, status: "paused" })).toBe(0);
  });

  it("creates through the backend and reloads the authoritative list", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: /add subscription/i }));
    await user.type(screen.getByLabelText("Service name"), "Supabase Pro");
    await user.type(screen.getByLabelText("Cost"), "25");
    await user.type(screen.getByLabelText("Provider"), "Supabase");
    await user.type(screen.getByLabelText("External reference"), "https://supabase.com/dashboard");
    await user.click(screen.getByRole("button", { name: /^add subscription$/i }));

    await waitFor(() => expect(mocks.createSubscription).toHaveBeenCalledWith("project-1", expect.objectContaining({ name: "Supabase Pro", cost: 25, provider: "Supabase" })));
    expect(mocks.listSubscriptions).toHaveBeenCalledWith("project-1");
    expect(await screen.findByText("Supabase Pro")).toBeInTheDocument();
  });

  it("keeps prior data and reports refresh failures with the backend code", async () => {
    mocks.refreshDashboard.mockRejectedValue(new ApiError({ status: 503, code: "dashboard_refresh_failed", message: "Fresh data is temporarily unavailable." }));
    const user = userEvent.setup();
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: /updated/i }));
    expect(await screen.findByText("Fresh data is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByText(/dashboard_refresh_failed/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("updates and deletes through the backend, reloading after each mutation", async () => {
    const updated = { ...created, cost: 30, status: "paused" as const };
    mocks.getDashboard.mockResolvedValue({ ...dashboard, subscriptions: [created] });
    mocks.updateSubscription.mockResolvedValue(updated);
    mocks.deleteSubscription.mockResolvedValue(undefined);
    mocks.listSubscriptions.mockResolvedValueOnce([updated]).mockResolvedValueOnce([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Edit Supabase Pro" }));
    await user.clear(screen.getByLabelText("Cost"));
    await user.type(screen.getByLabelText("Cost"), "30");
    await user.selectOptions(screen.getByLabelText("Status"), "paused");
    fireEvent.input(screen.getByLabelText("Renewal date"), { target: { value: "2026-09-15" } });
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mocks.updateSubscription).toHaveBeenCalledWith("project-1", "sub-1", expect.objectContaining({
      cost: 30,
      status: "paused",
      renewsAt: "2026-09-15T00:00:00.000Z",
    })));
    expect(await screen.findByText("$30.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Supabase Pro" }));
    await waitFor(() => expect(mocks.deleteSubscription).toHaveBeenCalledWith("project-1", "sub-1"));
    expect(await screen.findByText("No project subscriptions have been added.")).toBeInTheDocument();
  });
});
