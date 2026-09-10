import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TruthInboxPage } from "./TruthInboxPage";

const mocks = vi.hoisted(() => ({ getTruthInbox: vi.fn(), actOnTruthInboxItem: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ activeProject: { id: "project-1", name: "Workspace", projectRole: "manager" } }) }));
vi.mock("../lib/api/truthInbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api/truthInbox")>()), ...mocks }));

const activeItem = {
  id: "proposal:proposal-1",
  sourceType: "proposal",
  sourceId: "proposal-1",
  category: "spec_drift",
  title: "Google login before launch",
  description: "A Teams request differs from the accepted login scope.",
  severity: "critical",
  confidence: 0.94,
  status: "active",
  sourceLabels: ["message"],
  evidence: [{ id: "message:message-1", source: "message", label: "Teams launch thread", excerpt: "Google login must ship before launch", occurredAt: "2026-08-23T00:00:00.000Z", openTarget: { targetType: "message", targetRef: { messageId: "message-1" } } }],
  limitations: ["Discussion evidence remains proposed until approval."],
  owner: null,
  clarification: null,
  deferredUntil: null,
  snoozedUntil: null,
  timelineEventRef: null,
  reviewProposalId: null,
  capabilities: {
    ask_socrates: true,
    assign_owner: true,
    request_clarification: true,
    create_review_item: false,
    accept: true,
    reject: true,
    defer: true,
    snooze: true,
    dismiss: false,
    promote_to_timeline: true
  },
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z"
} as const;

function response(item = activeItem) {
  return {
    items: [item],
    members: [{ userId: "user-1", displayName: "Karthik", email: "k@example.com", projectRole: "manager", canApproveTruthChanges: true }],
    summary: { active: 1, critical: 1, awaitingDecision: 1, assignedToMe: 0 },
    countsByCategory: { spec_drift: 1 },
    countsByStatus: { active: 1 },
    sourceStates: { microsoft_teams: { state: "ready", label: "Microsoft Teams", detail: null } },
    page: { limit: 30, hasMore: false, nextCursor: null },
    generatedAt: "2026-08-23T00:00:00.000Z",
    cached: false,
    limitations: ["Evidence is not accepted truth."]
  };
}

describe("TruthInboxPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTruthInbox.mockResolvedValue(response());
    mocks.actOnTruthInboxItem.mockResolvedValue({ item: activeItem, outcome: null, action: "assign_owner" });
  });

  it("shows the unified authoritative queue without changing the existing visual language", async () => {
    render(<MemoryRouter><TruthInboxPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Truth Inbox" })).toBeVisible();
    expect(screen.getByText("Google login before launch")).toBeVisible();
    expect(screen.getByText(/Only an authorized truth approver/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Ask Socrates" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Accept change" })).toBeVisible();
    await userEvent.click(screen.getByText("View evidence (1)"));
    expect(screen.getByText("Google login must ship before launch")).toBeVisible();
  });

  it("shows the server-confirmed owner without issuing a redundant Inbox reload", async () => {
    const assigned = { ...activeItem, owner: { userId: "user-1", displayName: "Karthik", email: "k@example.com" } };
    mocks.actOnTruthInboxItem.mockResolvedValue({ item: assigned, outcome: null, action: "assign_owner" });
    const user = userEvent.setup();
    render(<MemoryRouter><TruthInboxPage /></MemoryRouter>);
    const owner = await screen.findByRole("combobox", { name: "Owner for Google login before launch" });
    await user.selectOptions(owner, "user-1");
    await waitFor(() => expect(mocks.actOnTruthInboxItem).toHaveBeenCalledWith("project-1", activeItem.id, "assign_owner", { assignedUserId: "user-1" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Owner for Google login before launch" })).toHaveValue("user-1"));
    expect(mocks.getTruthInbox).toHaveBeenCalledTimes(1);
  });

  it("requires explicit confirmation before accepting truth", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><TruthInboxPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Accept change" }));
    expect(screen.getByText("Confirm this evidence-backed change as accepted truth?")).toBeVisible();
    expect(mocks.actOnTruthInboxItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.actOnTruthInboxItem).toHaveBeenCalledWith("project-1", activeItem.id, "accept", {}));
  });

  it("keeps the item visible and reports a failed mutation honestly", async () => {
    mocks.actOnTruthInboxItem.mockRejectedValue(new Error("Truth approver required"));
    const user = userEvent.setup();
    render(<MemoryRouter><TruthInboxPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Reject change" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Truth approver required");
    expect(screen.getByText("Google login before launch")).toBeVisible();
    expect(mocks.getTruthInbox).toHaveBeenCalledTimes(1);
  });
});
