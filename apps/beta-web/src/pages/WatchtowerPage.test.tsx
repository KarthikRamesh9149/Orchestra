import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WatchtowerPage } from "./WatchtowerPage";

const mocks = vi.hoisted(() => ({ getWatchtowerSuggestions: vi.fn(), getWatchtowerFde: vi.fn(), dismissWatchtowerSuggestion: vi.fn(), promoteWatchtowerSuggestion: vi.fn(), createWatchtowerReview: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ activeProject: { id: "project-1", name: "Workspace" } }) }));
vi.mock("../lib/api/watchtower", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api/watchtower")>()), ...mocks }));

const activeSuggestion = { id: "signal-1", category: "spec_drift", title: "Launch scope drift needs review", description: "A provider-backed requirement differs from the accepted specification.", severity: "high", confidence: 0.87, status: "active", evidence: [{ source: "microsoft_teams_message", refId: "message-1", label: "Teams launch thread", excerpt: "Require manager approval", occurredAt: null }], limitations: ["Discussion evidence remains unaccepted until review."], promotedTimelineEventId: null, createdProposalId: null };

describe("[FIX-23] Watchtower authoritative actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWatchtowerSuggestions.mockResolvedValue({ items: [activeSuggestion], generatedAt: "2026-08-20T00:00:00Z", limitations: [] });
    mocks.getWatchtowerFde.mockResolvedValue({ items: [{ id: "fde-1", findingType: "safe_to_touch", findingSubType: "red", targetKind: "file", targetRef: "src/auth.ts", severity: "blocking", confidence: "high", summary: "Unsafe while overlapping work is active", whyItMatters: "Concurrent changes can conflict.", suggestedAction: "Coordinate owners.", reasons: ["Two open PRs touch this file."], limitations: [] }], limitations: [], readOnly: true, truthMutationAllowed: false });
  });
  it("shows real drift, evidence chains, rationale, and Safe-to-Touch without claiming truth", async () => {
    render(<MemoryRouter><WatchtowerPage /></MemoryRouter>);
    expect(await screen.findByText("Launch scope drift needs review")).toBeVisible();
    expect(screen.getByText("Safe-to-Touch red")).toBeVisible();
    expect(screen.getByText("Operational evidence only · truth mutation disabled")).toBeVisible();
    expect(screen.getByText(/Neither action accepts or edits Product Brain truth/)).toBeVisible();
  });
  it("reloads authoritative state after creating a pending review", async () => {
    mocks.createWatchtowerReview.mockResolvedValue({ proposal: { status: "needs_review" }, autoAccepted: false });
    mocks.getWatchtowerSuggestions.mockResolvedValueOnce({ items: [activeSuggestion], generatedAt: "", limitations: [] }).mockResolvedValueOnce({ items: [{ ...activeSuggestion, status: "converted_to_review", createdProposalId: "proposal-1" }], generatedAt: "", limitations: [] });
    const user = userEvent.setup();
    render(<MemoryRouter><WatchtowerPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Create review item" }));
    await waitFor(() => expect(mocks.getWatchtowerSuggestions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/truth remains unchanged until approval/i)).toBeVisible();
  });
  it("keeps the finding visible and reports backend action failure honestly", async () => {
    mocks.dismissWatchtowerSuggestion.mockRejectedValue(new Error("Truth approver required"));
    const user = userEvent.setup();
    render(<MemoryRouter><WatchtowerPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Truth approver required");
    expect(screen.getByText("Launch scope drift needs review")).toBeVisible();
    expect(mocks.getWatchtowerSuggestions).toHaveBeenCalledTimes(1);
  });
});
