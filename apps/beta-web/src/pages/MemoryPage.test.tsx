import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../lib/types";
import { MemoryPage } from "./MemoryPage";

const mocks = vi.hoisted(() => ({
  archiveDocument: vi.fn(),
  getDocs: vi.fn(),
  getDocFileBlob: vi.fn(),
  getCommunicationThreads: vi.fn(),
  getCommunicationReadiness: vi.fn(),
  listCommunicationConnectors: vi.fn(),
  connectSlack: vi.fn(),
  uploadDoc: vi.fn(),
  reconcileDocumentUpload: vi.fn(),
  createDocumentUploadOperationId: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
  activeProjectId: "project-1" as string | null,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ activeProject: mocks.activeProjectId ? { id: mocks.activeProjectId, name: "Workspace" } : null, projects: [], selectProject: vi.fn() }),
}));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, reconcileDocumentUpload: mocks.reconcileDocumentUpload, createDocumentUploadOperationId: mocks.createDocumentUploadOperationId };
});
vi.mock("../lib/api/memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api/memory")>();
  return { ...actual, ...mocks };
});

const doc: Doc = {
  id: "document-1",
  name: "Core PRD",
  fileName: "core-prd.pdf",
  type: "prd",
  size: "1 MB",
  pages: 3,
  status: "ready",
  uploadedBy: "Project member",
  uploadedAt: "Today",
  excerpt: "Authoritative product requirements",
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

describe("[FIX-20] Memory document persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeProjectId = "project-1";
    mocks.getDocs.mockResolvedValue([doc]);
    mocks.getCommunicationThreads.mockResolvedValue([]);
    mocks.getCommunicationReadiness.mockResolvedValue([]);
    mocks.listCommunicationConnectors.mockResolvedValue([]);
  });

  it("reports loading rather than fabricated zero memory counts", () => {
    mocks.getDocs.mockReturnValue(new Promise(() => undefined));
    mocks.getCommunicationThreads.mockReturnValue(new Promise(() => undefined));
    mocks.getCommunicationReadiness.mockReturnValue(new Promise(() => undefined));
    mocks.listCommunicationConnectors.mockReturnValue(new Promise(() => undefined));

    render(<MemoryRouter><MemoryPage /></MemoryRouter>);

    expect(screen.getByText("Loading memory…")).toBeVisible();
    expect(screen.getByText("Socrates uses evidence from your selected, available project sources.")).toBeVisible();
    expect(screen.queryByText("0 docs · 0 connectors")).not.toBeInTheDocument();
  });

  it("does not count a send-only Gmail account as communication evidence", async () => {
    mocks.listCommunicationConnectors.mockResolvedValue([{id:'sender',provider:'gmail',accountLabel:'Synthetic sender',status:'connected',readiness:{deferredFeatures:['gmail_mailbox_sync_disabled_for_invitation_sender']}}]);
    render(<MemoryRouter><MemoryPage /></MemoryRouter>);
    await waitFor(()=>expect(screen.getByText('1 docs · 0 connectors')).toBeVisible());
    expect(screen.queryByText('Synthetic sender')).not.toBeInTheDocument();
  });

  it("keeps the dialog and document visible when the backend rejects removal", async () => {
    mocks.archiveDocument.mockRejectedValue(new Error("Manager access required"));
    const user = userEvent.setup();
    render(<MemoryRouter><MemoryPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Open actions for Core PRD" }));
    await user.click(screen.getByRole("button", { name: "Remove from memory" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Manager access required");
    expect(screen.getAllByText("Core PRD")[0]).toBeVisible();
  });

  it("closes the document actions disclosure with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><MemoryPage /></MemoryRouter>);
    const trigger = await screen.findByRole("button", { name: "Open actions for Core PRD" });
    await user.click(trigger);
    await user.keyboard("{Tab}{Escape}");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Download original" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("reloads the authoritative list after a successful archive", async () => {
    mocks.archiveDocument.mockResolvedValue({ documentId: doc.id, archivedAt: "2026-08-20T00:00:00.000Z" });
    mocks.getDocs.mockResolvedValueOnce([doc]).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<MemoryRouter><MemoryPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "Open actions for Core PRD" }));
    await user.click(screen.getByRole("button", { name: "Remove from memory" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.archiveDocument).toHaveBeenCalledWith("project-1", "document-1"));
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText("Core PRD")).not.toBeInTheDocument());
  });

  it("does not retain a false empty state after a successful upload", async () => {
    mocks.getDocs.mockResolvedValue([]);
    mocks.uploadDoc.mockResolvedValue(doc);
    const user = userEvent.setup();
    const { container } = render(<MemoryRouter><MemoryPage /></MemoryRouter>);
    await screen.findByText("No documents uploaded yet. Drag a PDF or DOCX above to get started.");

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["synthetic"], "core-prd.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    await waitFor(() => expect(screen.getByText("Core PRD")).toBeVisible());
    expect(screen.queryByText("No documents uploaded yet. Drag a PDF or DOCX above to get started.")).not.toBeInTheDocument();
  });

  it("[R03] exposes upload progress and lets the member cancel the in-flight transfer", async () => {
    let options: { signal?: AbortSignal; onProgress?: (progress: { loaded: number; total: number | null; percent: number | null; phase: "uploading" | "processing" }) => void } | undefined;
    let rejectUpload: ((reason?: unknown) => void) | undefined;
    mocks.uploadDoc.mockImplementation((_projectId, _file, input) => {
      options = input;
      options?.onProgress?.({ loaded: 25, total: 100, percent: 25, phase: "uploading" });
      return new Promise((_resolve, reject) => { rejectUpload = reject; });
    });
    const user = userEvent.setup();
    const { container } = render(<MemoryRouter><MemoryPage /></MemoryRouter>);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(["synthetic"], "core-prd.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    expect(await screen.findByText("25% uploaded")).toBeVisible();
    expect(screen.getByText("Stopping this browser request may not undo an upload already received by the server.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Stop upload" }));
    expect(options?.signal?.aborted).toBe(true);
    rejectUpload?.(Object.assign(new Error("Request cancelled by the user."), { code: "cancelled" }));
    mocks.reconcileDocumentUpload.mockResolvedValue({ documentId: doc.id, documentVersionId: "version-1", status: "processing", parseRevision: 1, operationId: "unused" });
    await user.click(await screen.findByRole("button", { name: /^Upload$/ }));
    await waitFor(() => expect(mocks.reconcileDocumentUpload).toHaveBeenCalledTimes(1));
    expect(mocks.uploadDoc).toHaveBeenCalledTimes(1);
  });

  it("[R03] reconciles an ambiguous upload before retrying and does not post an already completed document", async () => {
    mocks.getDocs.mockResolvedValue([doc]);
    mocks.uploadDoc.mockRejectedValueOnce(Object.assign(new Error("The upload took too long."), { code: "timeout" }));
    mocks.reconcileDocumentUpload.mockResolvedValue({ documentId: doc.id, documentVersionId: "version-1", status: "ready", parseRevision: 1, operationId: "unused" });
    const user = userEvent.setup();
    const { container } = render(<MemoryRouter><MemoryPage /></MemoryRouter>);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(["synthetic"], "core-prd.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    await waitFor(() => expect(mocks.reconcileDocumentUpload).toHaveBeenCalledTimes(1));
    const operationId = mocks.reconcileDocumentUpload.mock.calls[0][1];
    expect(mocks.uploadDoc).toHaveBeenCalledTimes(1);
    expect(mocks.uploadDoc).toHaveBeenCalledWith("project-1", expect.any(File), expect.objectContaining({ operationId }));
    expect(await screen.findByText("Core PRD")).toBeVisible();
  });

  it("[R03] aborts an old-project upload and ignores its late completion", async () => {
    let resolveUpload: ((value: Doc) => void) | undefined;
    let options: { signal?: AbortSignal } | undefined;
    mocks.getDocs.mockResolvedValue([]);
    mocks.uploadDoc.mockImplementation((_projectId, _file, input) => {
      options = input;
      return new Promise((resolve) => { resolveUpload = resolve; });
    });
    const user = userEvent.setup();
    const view = render(<MemoryRouter><MemoryPage /></MemoryRouter>);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(["synthetic"], "core-prd.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));
    mocks.activeProjectId = "project-2";
    view.rerender(<MemoryRouter><MemoryPage /></MemoryRouter>);

    expect(options?.signal?.aborted).toBe(true);
    resolveUpload?.(doc);
    await waitFor(() => expect(screen.queryByText("Core PRD")).not.toBeInTheDocument());
  });

  it("[R03] accepts upload completion after Strict Mode replays lifecycle effects", async () => {
    mocks.getDocs.mockResolvedValue([]);
    mocks.uploadDoc.mockResolvedValue(doc);
    const user = userEvent.setup();
    const { container } = render(<StrictMode><MemoryRouter><MemoryPage /></MemoryRouter></StrictMode>);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(input, new File(["synthetic"], "core-prd.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: /^Upload$/ }));

    await waitFor(() => {
      const visibleTitle = screen.getAllByText("Core PRD").find((title) => {
        try { expect(title).toBeVisible(); return true; }
        catch { return false; }
      });
      expect(visibleTitle).toBeDefined();
    });
  });

  it("opens the stable document route and downloads through the authorized file contract", async () => {
    mocks.getDocFileBlob.mockResolvedValue(new Blob(["synthetic"], { type: "application/pdf" }));
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:memory-document");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<MemoryRouter><MemoryPage /><LocationProbe /></MemoryRouter>);

    await user.click(await screen.findByText("Core PRD"));
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/memory/docs/document-1/view");

    await user.click(screen.getByRole("button", { name: "Open actions for Core PRD" }));
    await user.click(screen.getByRole("button", { name: "Download original" }));
    await waitFor(() => expect(mocks.getDocFileBlob).toHaveBeenCalledWith("project-1", "document-1"));
    expect(createObjectUrl).toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:memory-document");
    expect(screen.queryByText("Original document downloaded.")).not.toBeInTheDocument();
    expect(screen.getByText("Download requested. Complete the save dialog to keep the file.")).toBeInTheDocument();
  });

  it("shows provider provenance and opens the real provider source", async () => {
    mocks.listCommunicationConnectors.mockResolvedValue([{ id: "teams-1", projectId: "project-1", provider: "microsoft_teams", accountLabel: "Engineering", status: "connected", lastSyncedAt: null, lastError: null }]);
    mocks.getCommunicationThreads.mockResolvedValue([{ threadId: "thread-1", connectorId: "teams-1", provider: "microsoft_teams", accountLabel: "Engineering", subject: "Release plan", lastMessageAt: null, latestMessage: null, providerOpenTarget: { targetType: "provider_evidence", provider: "microsoft_teams", url: "https://teams.example/thread/1" } }]);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    render(<MemoryRouter><MemoryPage /></MemoryRouter>);

    expect(await screen.findByText("Microsoft Teams")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Release plan from Microsoft Teams" }));
    expect(open).toHaveBeenCalledWith("https://teams.example/thread/1", "_blank", "noopener,noreferrer");
  });

  it("refuses an unsafe Slack authorization redirect", async () => {
    mocks.getCommunicationReadiness.mockResolvedValue([{
      provider: "slack",
      metadata: { label: "Slack" },
      connectorId: null,
      connectorStatus: null,
      readiness: { state: "enabled", canConnect: true, canSync: false, canDisconnect: false, canWebhook: false, reasons: [], missingConfig: [], deferredFeatures: [] },
    }]);
    mocks.connectSlack.mockResolvedValue({ connectorId: "slack-1", provider: "slack", status: "pending_auth", redirectUrl: "javascript:alert(1)" });
    const user = userEvent.setup();
    render(<MemoryRouter><MemoryPage /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: /Connect Slack/i }));
    expect(await screen.findByText("Slack returned an unsafe redirect URL.")).toBeInTheDocument();
  });
});
