import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryContextPage } from "./MemoryContextPage";

const contextEntry = {
  id: "context-1",
  projectId: "project-1",
  type: "manual_note",
  title: "Deep Research — release readiness",
  body: "# Report\n\nGenerated saved content.",
  source: "generated",
  status: "active",
  tags: ["deep-research"],
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};
const { getProjectContextEntry, auth } = vi.hoisted(() => ({
  getProjectContextEntry: vi.fn(),
  auth: { activeProject: { id: "project-1" } as { id: string } | null },
}));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../lib/api/research", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api/research")>()), getProjectContextEntry }));

describe("[FIX-22] saved Deep Research artifact", () => {
  beforeEach(() => {
    auth.activeProject = { id: "project-1" };
    getProjectContextEntry.mockReset().mockResolvedValue(contextEntry);
  });

  it("clears the previous workspace's report when no workspace is selected", async () => {
    const page = () => <MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>;
    const { rerender } = render(page());
    expect(await screen.findByRole("heading", { name: contextEntry.title })).toBeVisible();
    auth.activeProject = null;
    rerender(page());
    expect(screen.queryByRole("heading", { name: contextEntry.title })).not.toBeInTheDocument();
    expect(screen.queryByText("Generated saved content.")).not.toBeInTheDocument();
    expect(screen.getByText("Select a workspace to open saved research.")).toBeVisible();
    expect(getProjectContextEntry).toHaveBeenCalledTimes(1);
  });

  it("ignores a late response from the previous workspace", async () => {
    let resolvePrevious!: (entry: typeof contextEntry) => void;
    getProjectContextEntry.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }));
    getProjectContextEntry.mockResolvedValueOnce({ ...contextEntry, projectId: "project-2", title: "Current workspace report" });
    const page = () => <MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>;
    const { rerender } = render(page());
    auth.activeProject = { id: "project-2" };
    rerender(page());
    expect(await screen.findByRole("heading", { name: "Current workspace report" })).toBeVisible();
    await act(async () => resolvePrevious(contextEntry));
    expect(screen.queryByRole("heading", { name: contextEntry.title })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Current workspace report" })).toBeVisible();
  });

  it("shows a rejected backend read without inventing an empty saved report", async () => {
    getProjectContextEntry.mockRejectedValue(new Error("You do not have access to this research note."));
    render(<MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have access to this research note.");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading saved research…")).not.toBeInTheDocument();
  });

  it("loads the returned stable destination from the authorized backend contract", async () => {
    render(<MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Deep Research — release readiness" })).toBeVisible();
    expect(screen.getByText("Generated saved content.")).toBeVisible();
    expect(getProjectContextEntry).toHaveBeenCalledWith("project-1", "context-1");
  });

  it.each([
    `# ${contextEntry.title}\n\n`,
    `\uFEFF\n  # ${contextEntry.title} ###\r\n\r\n`,
  ])("renders the saved title once without altering report evidence (%j)", async (prefix) => {
    getProjectContextEntry.mockResolvedValue({ ...contextEntry, body: `${prefix}## Findings\n\nGenerated analysis [E1].\n\n[E1 source](/memory/docs/doc-1/view)` });
    render(<MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Findings" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: contextEntry.title })).toHaveLength(1);
    expect(screen.getByText("Generated analysis [E1].")).toBeVisible();
    expect(screen.getByRole("link", { name: "E1 source" })).toHaveAttribute("href", "/memory/docs/doc-1/view");
  });

  it("preserves a distinct opening heading and a matching heading later in the report", async () => {
    getProjectContextEntry.mockResolvedValue({ ...contextEntry, body: `# Executive summary\n\nEvidence first.\n\n## ${contextEntry.title}\n\nContext matters.` });
    render(<MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Executive summary" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: contextEntry.title })).toHaveLength(2);
    expect(screen.getByText("Context matters.")).toBeVisible();
  });

  it("does not strip an apparent title from a fenced evidence excerpt", async () => {
    getProjectContextEntry.mockResolvedValue({ ...contextEntry, body: `\`\`\`text\n# ${contextEntry.title}\n\`\`\`\n\nQuoted source.` });
    render(<MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(`# ${contextEntry.title}`)).toBeVisible();
    expect(screen.getByText("Quoted source.")).toBeVisible();
  });
});
