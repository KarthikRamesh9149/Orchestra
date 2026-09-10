import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "../store/workspaceStore";
import { LiveDocViewerPage } from "./LiveDocViewerPage";

const mocks = vi.hoisted(() => ({ getDocViewer: vi.fn(), getDocFileBlob: vi.fn() }));
vi.mock("../lib/api/documents", () => mocks);
beforeEach(() => {
  useWorkspaceStore.setState({ activeProjectId: "project" });
  mocks.getDocViewer.mockResolvedValue({ document: { title: "Source PDF" }, version: { status: "ready", mimeType: "application/pdf" }, sections: [{ anchorId: "one", pageNumber: 1, text: "Extracted evidence", citationLabel: "Page one" }] });
  mocks.getDocFileBlob.mockReset();
});

it("[R11] distinguishes extracted pages from original evidence and reports download failure", async () => {
  mocks.getDocFileBlob.mockRejectedValue(new Error("Original file unavailable"));
  render(<MemoryRouter initialEntries={["/memory/docs/doc/view"]}><Routes><Route path="/memory/docs/:docId/view" element={<LiveDocViewerPage />} /></Routes></MemoryRouter>);
  await screen.findByText("Extracted evidence");
  expect(screen.queryByRole("button", { name: "PDF preview" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Paged extracted text" }));
  expect(screen.getByText("Extracted evidence")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Download original" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Original file unavailable");
  expect(mocks.getDocFileBlob).toHaveBeenCalledWith("project", "doc", expect.any(AbortSignal));
});
