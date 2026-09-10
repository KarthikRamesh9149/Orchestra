import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineEvent } from "../lib/types/timeline";
import { TimelinePage } from "./TimelinePage";

const mocks = vi.hoisted(() => ({
  getProjectTimeline: vi.fn(),
  createProjectTimelineEvent: vi.fn(),
  acceptTimelineProposal: vi.fn(),
  rejectTimelineProposal: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ activeProject: { id: "project-1", name: "Workspace" } }),
}));
vi.mock("../lib/api/timeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/timeline")>();
  return { ...actual, ...mocks };
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const providerEvent: TimelineEvent = {
  id: "clickup:task-1",
  title: "Release task",
  description: "ClickUp acceptance evidence",
  source: "clickup",
  sourceRef: "11111111-1111-4111-8111-111111111111",
  author: { name: "ClickUp", initials: "CL", color: "#7B68EE" },
  timestamp: "2026-08-20T00:00:00.000Z",
  tier: "milestone",
  type: "change",
  status: "approved",
  metadataSummary: null,
};
const driveEvent: TimelineEvent = {
  ...providerEvent,
  id: "drive:file-1",
  title: "Product brief",
  source: "google_drive",
  sourceRef: "file-1",
};
const pendingEvent: TimelineEvent = {
  ...providerEvent,
  id: "proposal:proposal-1",
  title: "Approve login copy",
  source: "approval",
  status: "pending",
  proposalId: "proposal-1",
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

describe("[FIX-21] Timeline authoritative interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProjectTimeline.mockResolvedValue([providerEvent, driveEvent]);
  });

  it("derives source filters from backend events, hides raw UUIDs, and preserves deep links", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/timeline?source=clickup&event=clickup%3Atask-1"]}><TimelinePage /><LocationProbe /></MemoryRouter>);

    expect(await screen.findByText("Release task")).toBeInTheDocument();
    expect(screen.queryByText(providerEvent.sourceRef)).not.toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
    expect(screen.getByText("Linked event highlighted.")).toBeVisible();
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/timeline?source=clickup&event=clickup%3Atask-1");

    await user.click(screen.getByRole("button", { name: "ClickUp" }));
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Google Drive" })).toBeVisible());
    expect(screen.queryByRole("menuitemradio", { name: "Slack" })).not.toBeInTheDocument();
  });

  it("keeps the add dialog open on rejection and submits manual provenance only", async () => {
    mocks.createProjectTimelineEvent.mockRejectedValueOnce(new Error("Manager access required"));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/timeline"]}><TimelinePage /></MemoryRouter>);
    await screen.findByText("Release task");

    await user.click(screen.getByRole("button", { name: "Add Event" }));
    await waitFor(() => expect(screen.getByText("Provider evidence is created only by connector sync.")).toBeVisible());
    expect(screen.queryByRole("combobox", { name: /source/i })).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Event title"), "Manual release checkpoint");
    await user.click(screen.getByRole("button", { name: "+ Add to timeline" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Manager access required");
    expect(screen.getByPlaceholderText("Event title")).toBeVisible();
    expect(mocks.createProjectTimelineEvent).toHaveBeenCalledWith("project-1", expect.objectContaining({ source: "manual" }));
  });

  it("waits for create and authoritative reload before closing", async () => {
    let resolveCreate!: (value: TimelineEvent) => void;
    mocks.createProjectTimelineEvent.mockReturnValue(new Promise<TimelineEvent>((resolve) => { resolveCreate = resolve; }));
    mocks.getProjectTimeline.mockResolvedValueOnce([providerEvent]).mockResolvedValueOnce([
      providerEvent,
      { ...providerEvent, id: "manual:event-1", title: "Manual release checkpoint", source: "manual", sourceRef: "", metadataSummary: "Manual event" },
    ]);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/timeline"]}><TimelinePage /></MemoryRouter>);
    await screen.findByText("Release task");
    await user.click(screen.getByRole("button", { name: "Add Event" }));
    await user.type(screen.getByPlaceholderText("Event title"), "Manual release checkpoint");
    await user.click(screen.getByRole("button", { name: "+ Add to timeline" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolveCreate({ ...providerEvent, id: "manual:event-1", title: "Manual release checkpoint", source: "manual" });
    await waitFor(() => expect(screen.queryByPlaceholderText("Event title")).not.toBeInTheDocument());
    expect(mocks.getProjectTimeline).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Manual release checkpoint")).toBeVisible();
  });

  it("shows proposal rejection errors without hiding the authoritative event", async () => {
    mocks.getProjectTimeline.mockResolvedValue([pendingEvent]);
    mocks.acceptTimelineProposal.mockRejectedValue(new Error("Truth approver required"));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/timeline"]}><TimelinePage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Truth approver required");
    expect(screen.getByText("Approve login copy")).toBeVisible();
    expect(mocks.getProjectTimeline).toHaveBeenCalledTimes(1);
  });
});
