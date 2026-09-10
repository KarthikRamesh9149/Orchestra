import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryContextPage } from "./MemoryContextPage";

const contextEntry = {
  id: "context-1",
  projectId: "project-1",
  type: "manual_note",
  title: "Deep Research — release readiness",
  body: "# Report\n\nAuthoritative saved content.",
  source: "generated",
  status: "active",
  tags: ["deep-research"],
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};
const { getProjectContextEntry } = vi.hoisted(() => ({ getProjectContextEntry: vi.fn() }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ activeProject: { id: "project-1" } }) }));
vi.mock("../lib/api/research", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api/research")>()), getProjectContextEntry }));

describe("[FIX-22] saved Deep Research artifact", () => {
  beforeEach(() => getProjectContextEntry.mockResolvedValue(contextEntry));

  it("loads the returned stable destination from the authorized backend contract", async () => {
    render(<MemoryRouter initialEntries={["/memory/context/context-1"]}><Routes><Route path="/memory/context/:contextId" element={<MemoryContextPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Deep Research — release readiness" })).toBeVisible();
    expect(screen.getByText("Authoritative saved content.")).toBeVisible();
    expect(getProjectContextEntry).toHaveBeenCalledWith("project-1", "context-1");
  });
});
