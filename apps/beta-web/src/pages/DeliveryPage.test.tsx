import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryPage } from "./DeliveryPage";

const mocks = vi.hoisted(() => ({ getDeliveryOverview: vi.fn(), generateWeeklyBrief: vi.fn(), generateAgentPreflight: vi.fn(), generateAgentPostflight: vi.fn(), toast: vi.fn(), activeProject: { id: "project-1", name: "Orchestra" } as { id: string; name: string } }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ activeProject: mocks.activeProject }) }));
vi.mock("../components/ui/Toaster", () => ({ useToastStore: () => ({ add: mocks.toast }) }));
vi.mock("../lib/api/delivery", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api/delivery")>()), getDeliveryOverview: mocks.getDeliveryOverview, generateWeeklyBrief: mocks.generateWeeklyBrief, generateAgentPreflight: mocks.generateAgentPreflight, generateAgentPostflight: mocks.generateAgentPostflight }));

const overview = {
  projectId: "project-1",
  contextHealth: { state: "attention", generatedAt: "2026-08-24T01:00:00.000Z", limitations: ["Separate evidence-backed components."], components: [
    { key: "source_freshness", label: "Source freshness", state: "healthy", summary: "Slack synced 8 minutes ago.", detail: ["Slack: healthy"], openTarget: { targetType: "integrations", targetRef: {} } },
    { key: "open_contradictions", label: "Open contradictions", state: "attention", summary: "1 unresolved contradiction.", detail: ["Launch scope conflict"], openTarget: { targetType: "truth_inbox", targetRef: {} } }
  ] },
  releaseTruth: { readiness: "needs_attention", summary: "2 evidence-backed release gaps require attention.", assessedRevision: "abcdef1234567890", assessedRepository: "org/orchestra", assessedEnvironment: "production", assessmentScope: "All active GitHub-backed engineering evidence authorized for this project.", acceptedChanges: [], implementationEvidence: [], unresolvedDecisions: [{ id: "proposal:1", label: "Launch scope", detail: "Needs decision", status: "needs_review", occurredAt: "2026-08-24T01:00:00.000Z", openTarget: { targetType: "change_proposal", targetRef: { proposalId: "proposal-1" } } }], missingTests: [], unsafeAreas: [], staleAgentContext: [], deploymentEvidence: [], blockers: ["Unresolved decision: Launch scope"], generatedAt: "2026-08-24T01:00:00.000Z", limitations: ["Readiness view, not a guarantee."] },
  weeklyBrief: null,
  recentAgentRuns: [{ id: "run-1", title: "Implement login", status: "completed", provider: "codex", commitSha: "abcdef123456", prUrl: null, testStatus: "passed", requiresHumanReview: true, review: null, updatedAt: "2026-08-24T01:00:00.000Z" }],
  generatedAt: "2026-08-24T01:00:00.000Z", cached: false
};

describe("DeliveryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeProject = { id: "project-1", name: "Orchestra" };
    mocks.getDeliveryOverview.mockResolvedValue(overview);
    mocks.generateWeeklyBrief.mockResolvedValue({ id: "brief-1", weekStart: "2026-08-24", weekEnd: "2026-08-30", sourceFingerprint: "a".repeat(64), generatedAt: "2026-08-24T01:00:00.000Z", content: { title: "Weekly executive brief", weekStart: "2026-08-24", weekEnd: "2026-08-30", whatChanged: [], approved: [], rejected: [], implemented: [], blocked: [], needsDecision: [], possibleDrift: [], missingEvidence: [], limitations: ["Evidence-backed"] } });
    mocks.generateAgentPreflight.mockResolvedValue({ ready: false, readinessLabel: "needs_decision", blockers: ["Resolve launch scope"], currentAcceptedTruth: ["Login is email only"], relevantEvidence: ["Launch PRD"], technicalConstraints: [], knownConflicts: ["Launch scope"], safeToTouch: [], affectedAreas: ["Authentication"], requiredTests: ["Test OAuth callback"], openQuestions: ["Resolve launch scope"], implementationBoundaries: ["Do not change accepted truth"], contextPack: { id: "pack-1", title: "Agent Preflight", bodyMarkdown: "# Preflight", sourceCount: 1, evidenceCount: 1, warnings: [], limitations: [] }, generatedAt: "2026-08-24T01:00:00.000Z", limitations: [] });
    mocks.generateAgentPostflight.mockResolvedValue({ review: { scoreLabel: "needs_review", recommendation: "human_review", summary: "One gap requires review.", findings: [{ severity: "medium", summary: "Documentation not recorded" }] }, acceptedTruthChanged: false });
  });

  it("renders evidence-backed context health, release truth, briefs, and agent workflows", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><DeliveryPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Delivery Control" })).toBeVisible();
    expect(screen.getByText("Slack synced 8 minutes ago.")).toBeVisible();
    expect(screen.getByText("Unresolved decision: Launch scope")).toBeVisible();
    expect(screen.getByText(/Assessing org\/orchestra@abcdef1234567890 in production/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(await screen.findByText(/saved 8\/24\/2026/)).toBeVisible();

    await user.type(screen.getByLabelText("Implementation task"), "Implement the approved OAuth change");
    await user.click(screen.getByRole("button", { name: "Build preflight" }));
    expect(await screen.findByText("Task is not ready yet")).toBeVisible();
    expect(screen.getAllByText("Resolve launch scope").length).toBeGreaterThan(0);
    expect(screen.getByText("Pack ID: pack-1")).toBeVisible();
    expect(screen.getByText(/orchestra.get_context_pack/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Review in Truth Inbox" })).toHaveAttribute("href", "/truth-inbox");
    expect(screen.queryByText("No persisted item.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy for Codex" }));
    expect(mocks.toast).toHaveBeenCalledWith("Exact Codex context pack copied.", "success");

    await user.click(screen.getByRole("button", { name: "Run postflight" }));
    await waitFor(() => expect(mocks.generateAgentPostflight).toHaveBeenCalledWith("project-1", "run-1"));
    expect(await screen.findByText("One gap requires review.")).toBeVisible();
  });

  it("reports loading failures honestly", async () => {
    mocks.getDeliveryOverview.mockRejectedValue(new Error("Delivery evidence service is unavailable."));
    render(<MemoryRouter><DeliveryPage /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Delivery evidence service is unavailable.");
  });

  it("does not render a late overview from the previous project after switching projects", async () => {
    let resolveFirst: ((value: typeof overview) => void) | undefined;
    const first = new Promise<typeof overview>((resolve) => { resolveFirst = resolve; });
    const projectTwo = { ...overview, projectId: "project-2", releaseTruth: { ...overview.releaseTruth, summary: "Project two readiness" } };
    mocks.getDeliveryOverview.mockImplementation((projectId: string) => projectId === "project-1" ? first : Promise.resolve(projectTwo));
    const view = render(<MemoryRouter><DeliveryPage /></MemoryRouter>);

    mocks.activeProject = { id: "project-2", name: "Second project" };
    view.rerender(<MemoryRouter><DeliveryPage /></MemoryRouter>);
    expect(await screen.findByText("Project two readiness")).toBeVisible();
    resolveFirst?.(overview);

    await waitFor(() => expect(screen.getByText("Project two readiness")).toBeVisible());
    expect(screen.queryByText("2 evidence-backed release gaps require attention.")).not.toBeInTheDocument();
  });
});
