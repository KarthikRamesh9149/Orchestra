import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepResearchModal } from "./DeepResearch";

const mocks = vi.hoisted(() => ({
  startDeepResearch: vi.fn(),
  getDeepResearchRun: vi.fn(),
  getDeepResearchUsage: vi.fn(),
  addDeepResearchToMemory: vi.fn(),
  downloadDeepResearchReport: vi.fn(),
}));
vi.mock("../../lib/api/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/research")>()),
  ...mocks,
}));

const runId = "22222222-2222-4222-8222-222222222222";
const contextId = "33333333-3333-4333-8333-333333333333";
const completedRun = {
  id: runId,
  projectId: "project-1",
  status: "completed",
  researchFocus: "release readiness",
  sources: ["docs", "web"],
  outputFormat: "full_report",
  privacyMode: "internal_plus_web",
  webSearchRequested: true,
  webSearchUsed: true,
  progress: { percent: 100, stage: "completed" },
  results: {
    executiveSummary: "Release evidence is incomplete.",
    findings: [{ category: "RISK", severity: "HIGH", title: "Missing proof", description: "A release check is missing.", sources: `chunk:${contextId}` }],
    marketContext: [],
    expansionOpportunities: [],
    recommendedActions: [{ priority: "IMMEDIATE", action: "Run the missing check.", source: `chunk:${contextId}` }],
    stats: { totalSources: 2, slackMessages: 0, commits: 0, docs: 1, webSources: 1, duration: "3s" },
    sources: [
      { provider: "Documents", label: "Release checklist", kind: "internal", href: "/memory/docs/document-1/view" },
      { provider: "Web", label: "Public release benchmark", kind: "web", href: "https://example.com/release" },
    ],
  },
  error: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  completedAt: "2026-08-20T00:00:03.000Z",
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

function renderModal() {
  return render(
    <MemoryRouter initialEntries={["/chat"]}>
      <DeepResearchModal projectId="project-1" open minimized={false} onClose={vi.fn()} onMinimize={vi.fn()} onElapsedChange={vi.fn()} />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe("[FIX-22] Deep Research truthful UI", () => {
  afterEach(() => vi.unstubAllGlobals());
  it('lets the native backend validate configured AI instead of blocking every desktop request', async () => {
    vi.stubGlobal('orchestra', {});
    const user = userEvent.setup(); renderModal();
    await user.type(screen.getByRole('textbox'), 'synthetic desktop research');
    await user.click(screen.getByRole('button', {name: 'Run Research'}));
    expect(mocks.startDeepResearch).toHaveBeenCalledWith('project-1', expect.objectContaining({researchFocus:'synthetic desktop research',webSearchEnabled:false}));
    expect(await screen.findByText('Deep Research Complete')).toBeVisible();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDeepResearchUsage.mockResolvedValue({ used: 0, limit: 20, resetLabel: "Sep 1" });
    mocks.startDeepResearch.mockResolvedValue({ ...completedRun, status: "running", results: null, progress: { percent: 10, stage: "retrieving_evidence" } });
    mocks.getDeepResearchRun.mockResolvedValue(completedRun);
  });

  it("rejects blank focus and sends explicit source, privacy, and web choices", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Run Research" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("specific research focus");
    expect(mocks.startDeepResearch).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText(/auth flow reliability/i), "  release readiness  ");
    await user.click(screen.getByRole("button", { name: /Internal \+ public web/i }));
    await user.click(screen.getByRole("button", { name: /Use public web search/i }));
    await user.click(screen.getByRole("button", { name: "Run Research" }));

    expect(mocks.startDeepResearch).toHaveBeenCalledWith("project-1", expect.objectContaining({
      researchFocus: "release readiness",
      sources: ["docs", "web"],
      privacyMode: "internal_plus_web",
      webSearchEnabled: true,
    }));
    expect(await screen.findByText("Deep Research Complete")).toBeVisible();
    expect(screen.getByRole("link", { name: /Release checklist/i })).toHaveAttribute("href", "/memory/docs/document-1/view");
    expect(screen.getByRole("link", { name: /Public release benchmark/i })).toHaveAttribute("href", "https://example.com/release");
    expect(screen.queryByText(new RegExp(contextId))).not.toBeInTheDocument();
  });
  it("shows all citation aliases for one document without duplicating its source link", async () => {
    mocks.getDeepResearchRun.mockResolvedValue({ ...completedRun, results: { ...completedRun.results, sources: [
      { ...completedRun.results.sources[0], ref: "E1", refs: ["E1", "E2", "E3"] },
      { ...completedRun.results.sources[1], ref: "W1" }
    ] } });
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole("textbox"), "Release readiness");
    await user.click(screen.getByRole("button", { name: "Run Research" }));
    expect(await screen.findByText("Deep Research Complete")).toBeVisible();
    expect(screen.getByRole("link", { name: /Release checklist/i })).toHaveTextContent("E1 · E2 · E3 — Documents");
    expect(screen.getAllByRole("link", { name: /Release checklist/i })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Public release benchmark/i })).toHaveTextContent("W1 — Web");
  });

  it("starts exactly one run while the backend request is in flight", async () => {
    const user = userEvent.setup();
    let resolveStart!: (value: unknown) => void;
    mocks.startDeepResearch.mockReturnValueOnce(new Promise((resolve) => { resolveStart = resolve; }));
    renderModal();
    await user.type(screen.getByPlaceholderText(/auth flow reliability/i), "release readiness");

    const runButton = screen.getByRole("button", { name: "Run Research" });
    await user.click(runButton);
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Starting…" }));
    expect(mocks.startDeepResearch).toHaveBeenCalledTimes(1);

    resolveStart({ ...completedRun, status: "running", results: null, progress: { percent: 10, stage: "retrieving_evidence" } });
    expect(await screen.findByText("Deep Research Complete")).toBeVisible();
  });

  it("shows save and download failures, then exposes the authoritative saved destination", async () => {
    const user = userEvent.setup();
    mocks.addDeepResearchToMemory.mockRejectedValueOnce(new Error("Manager access required"));
    mocks.downloadDeepResearchReport.mockRejectedValueOnce(new Error("Report export unavailable"));
    renderModal();
    await user.type(screen.getByPlaceholderText(/auth flow reliability/i), "release readiness");
    await user.click(screen.getByRole("button", { name: "Run Research" }));
    await screen.findByText("Deep Research Complete");

    await user.click(screen.getAllByRole("button", { name: "Add to Memory" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Manager access required");
    await user.click(screen.getByRole("button", { name: "Download Report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Report export unavailable");

    mocks.addDeepResearchToMemory.mockResolvedValue({ success: true, memoryEntryId: contextId, createdAt: "2026-08-20T00:00:00.000Z", destination: { type: "project_context", route: `/memory/context/${contextId}`, apiPath: `/v1/projects/project-1/context/${contextId}` } });
    await user.click(screen.getAllByRole("button", { name: "Add to Memory" })[0]);
    expect(await screen.findByText(/Saved to Project Memory as a generated research note/i)).toBeVisible();
    expect(screen.getByText(/not accepted Product Brain truth/i)).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "Open saved report" })[0]);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(`/memory/context/${contextId}`);
  });

  it("renders an unsafe provider source as inert text", async () => {
    const user = userEvent.setup();
    mocks.getDeepResearchRun.mockResolvedValue({
      ...completedRun,
      results: {
        ...completedRun.results,
        sources: [
          ...completedRun.results.sources,
          { provider: "Web", label: "Unsafe source", kind: "web", href: "javascript:alert(1)" },
        ],
      },
    });
    renderModal();
    await user.type(screen.getByPlaceholderText(/auth flow reliability/i), "release readiness");
    await user.click(screen.getByRole("button", { name: "Run Research" }));

    expect(await screen.findByText("Unsafe source")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Unsafe source" })).not.toBeInTheDocument();
  });

  it("bounds repeated polling failures and reports the backend connection problem", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mocks.getDeepResearchRun.mockRejectedValue(new Error("Status endpoint unavailable"));
    renderModal();
    await user.type(screen.getByPlaceholderText(/auth flow reliability/i), "release readiness");
    await user.click(screen.getByRole("button", { name: "Run Research" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(await screen.findByText("Deep Research could not complete")).toBeVisible();
    expect(screen.getByText("Status endpoint unavailable")).toBeVisible();
    expect(mocks.getDeepResearchRun).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
