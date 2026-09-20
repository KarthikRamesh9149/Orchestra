import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SavedResearchSection } from "./SavedResearchSection";
import { ApiError } from "../../lib/api/client";

const api = vi.hoisted(() => ({ listSavedResearch: vi.fn() }));

vi.mock("../../lib/api/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/research")>()),
  listSavedResearch: api.listSavedResearch,
}));

const generated = {
  id: "research-1",
  projectId: "project-1",
  type: "manual_note",
  title: "Deep Research — release readiness",
  body: "# Synthetic report",
  source: "generated",
  status: "active",
  tags: ["deep-research"],
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

const page = (items: unknown[], pageNumber = 1, totalPages = 1) => ({
  items,
  meta: { page: pageNumber, pageSize: 10, totalCount: items.length, totalPages },
});

function renderSection(projectId = "project-1") {
  return render(<MemoryRouter><SavedResearchSection projectId={projectId} /></MemoryRouter>);
}

describe("[FIX-23] Saved Deep Research section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only generated saved research with a stable context route and an explicit truth boundary", async () => {
    api.listSavedResearch.mockResolvedValue(page([
      generated,
      { ...generated, id: "tag-only", title: "A tagged manual note", source: "manual" },
    ]));

    renderSection();

    expect(await screen.findByText(generated.title)).toBeVisible();
    expect(screen.queryByText("A tagged manual note")).not.toBeInTheDocument();
    expect(screen.getByText("Generated research reports are reference material, not accepted project truth.")).toBeVisible();
    expect(screen.getByRole("link", { name: new RegExp(generated.title) })).toHaveAttribute("href", "/memory/context/research-1");
    expect(api.listSavedResearch).toHaveBeenCalledWith("project-1", 1, expect.any(AbortSignal));
  });

  it("shows a retry state rather than fabricating an empty saved-research list", async () => {
    api.listSavedResearch.mockRejectedValueOnce(new Error("Synthetic outage"));
    api.listSavedResearch.mockResolvedValueOnce(page([generated]));
    const user = userEvent.setup();

    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent("Saved research could not be loaded");
    expect(screen.queryByText("No generated research reports have been saved in this workspace yet.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(generated.title)).toBeVisible();
    expect(api.listSavedResearch).toHaveBeenCalledTimes(2);
  });

  it("retains the safe API failure message and code for a retryable read", async () => {
    api.listSavedResearch.mockRejectedValue(new ApiError({ status: 403, code: "forbidden", message: "You do not have access to saved research." }));

    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have access to saved research.");
    expect(screen.getByText("forbidden")).toBeVisible();
  });

  it("keeps server pagination reachable when a tagged entry is not generated research", async () => {
    api.listSavedResearch
      .mockResolvedValueOnce(page([{ ...generated, id: "manual-tag", source: "manual" }], 1, 2))
      .mockResolvedValueOnce(page([generated], 2, 2));
    const user = userEvent.setup();

    renderSection();

    expect(await screen.findByText("No generated report appears on this saved-memory page. More pages may contain saved research.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Load more saved research" }));
    expect(await screen.findByText(generated.title)).toBeVisible();
    expect(api.listSavedResearch).toHaveBeenLastCalledWith("project-1", 2, expect.any(AbortSignal));
  });

  it("shows an honest empty state only after the final server page has no generated reports", async () => {
    api.listSavedResearch.mockResolvedValue(page([{ ...generated, id: "manual-tag", source: "manual" }]));

    renderSection();

    expect(await screen.findByText("No generated research reports have been saved in this workspace yet.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Load more saved research" })).not.toBeInTheDocument();
  });

  it("clears the previous workspace and ignores its late response", async () => {
    let resolveOld!: (value: ReturnType<typeof page>) => void;
    api.listSavedResearch.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    api.listSavedResearch.mockResolvedValueOnce(page([{ ...generated, id: "research-2", projectId: "project-2", title: "Current workspace research" }]));

    const view = renderSection("project-1");
    view.rerender(<MemoryRouter><SavedResearchSection projectId="project-2" /></MemoryRouter>);

    expect(await screen.findByText("Current workspace research")).toBeVisible();
    await act(async () => resolveOld(page([generated])));
    expect(screen.queryByText(generated.title)).not.toBeInTheDocument();
    expect(screen.getByText("Current workspace research")).toBeVisible();
  });
});
