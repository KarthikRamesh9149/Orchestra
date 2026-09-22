import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SocratesHistoryMessage } from "../lib/api";
import { useChatStore } from "../store/chatStore";
import { ChatPage } from "./ChatPage";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const USER_MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const ASSISTANT_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  streamSocratesV1: vi.fn(),
  cancelSocratesV1: vi.fn(),
  getSocratesHistory: vi.fn(),
  listSocratesSessions: vi.fn(),
  prewarmSocratesV1: vi.fn(),
  saveSocratesFeedback: vi.fn(),
  uploadDoc: vi.fn(),
  reconcileDocumentUpload: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ activeProject: { id: PROJECT_ID, name: "Local Workspace" } }),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, ...mocks };
});
vi.mock("../lib/api/feedback", () => ({ saveSocratesFeedback: mocks.saveSocratesFeedback }));

function ChatHarness() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{location.pathname}</output>
      <Routes key={location.pathname}><Route path="/chat/*" element={<ChatPage />} /></Routes>
    </>
  );
}

function renderChat(path = "/chat") {
  return render(<MemoryRouter initialEntries={[path]}><ChatHarness /></MemoryRouter>);
}

function userRow(content: string): SocratesHistoryMessage {
  return { id: USER_MESSAGE_ID, sessionId: SESSION_ID, role: "user", content, responseStatus: "completed", createdAt: "2026-08-19T01:00:00.000Z" };
}

function assistantRow(content: string): SocratesHistoryMessage {
  return {
    id: ASSISTANT_MESSAGE_ID,
    sessionId: SESSION_ID,
    role: "assistant",
    content,
    responseStatus: "completed",
    answerPayloadJson: { suggested_prompts: [], citations: [] },
    createdAt: "2026-08-19T01:00:01.000Z",
  };
}

describe("server-authoritative Socrates chat", () => {
  let history: SocratesHistoryMessage[];

  beforeEach(() => {
    cleanup();
    history = [];
    useChatStore.setState({ projectId: null, sourceScope: "All", conversations: [], activeId: null, drafts: {}, lastActiveByProject: {} });
    mocks.listSocratesSessions.mockReset().mockImplementation(async () => history.length ? [{
      id: SESSION_ID,
      projectId: PROJECT_ID,
      pageContext: "dashboard_project",
      title: history[0]?.content ?? "New Socrates chat",
      preview: history[history.length - 1]?.content ?? "",
      messageCount: history.length,
      createdAt: "2026-08-19T01:00:00.000Z",
      updatedAt: "2026-08-19T01:00:01.000Z",
    }] : []);
    mocks.getSocratesHistory.mockReset().mockImplementation(async () => [...history]);
    mocks.cancelSocratesV1.mockReset().mockResolvedValue({ cancelled: true, assistantMessageId: ASSISTANT_MESSAGE_ID });
    mocks.prewarmSocratesV1.mockReset().mockResolvedValue({ warmed: true, durationMs: 1, expiresInMs: 60_000 });
    mocks.uploadDoc.mockReset();
    mocks.reconcileDocumentUpload.mockReset();
    mocks.saveSocratesFeedback.mockReset().mockResolvedValue({ id: "feedback-1", reason: "missing_evidence", correctionText: "Cite the signed launch plan.", needsHumanReview: true, productBrainVersionId: "brain-1", updatedAt: "2026-08-24T01:00:00.000Z", acceptedTruthChanged: false });
    mocks.streamSocratesV1.mockReset().mockImplementation(async (_projectId, question, _sessionId, opts) => {
      opts?.handlers?.onMessageCreated?.({ sessionId: SESSION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-19T01:00:01.000Z" });
      opts?.handlers?.onDelta?.("Default delayed answer.", "Default delayed answer.");
      history = [userRow(question), assistantRow("Default delayed answer.")];
      return {
        answer_md: "Default delayed answer.",
        citations: [],
        suggested_prompts: [],
        confidence: "high",
        sessionId: SESSION_ID,
        message: { userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-19T01:00:01.000Z" },
      };
    });
  });

  it("[FIX-11][FIX-12][FIX-36] creates and streams the first request in one server round trip", async () => {
    const user = userEvent.setup();
    renderChat();
    const question = "What changed in the launch plan?";
    await user.type(screen.getByPlaceholderText("Ask Socrates anything about your project…"), `${question}{Enter}`);

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/chat/${SESSION_ID}`));
    await waitFor(() => expect(screen.getByText("Default delayed answer.")).toBeVisible());
    expect(mocks.streamSocratesV1).toHaveBeenCalledWith(PROJECT_ID, question, null, expect.objectContaining({ scope: "All" }));
    expect(useChatStore.getState().conversations[0]?.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: question },
      { role: "assistant", content: "Default delayed answer." },
    ]);
  });

  it("[R01] paints delayed first-chat tokens after remount and revisit before completion", async () => {
    let handlers: any;
    let finish!: (value: any) => void;
    mocks.streamSocratesV1.mockImplementation(async (_project, question, _session, opts) => {
      handlers = opts.handlers;
      history = [userRow(question)];
      handlers.onMessageCreated({ sessionId: SESSION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: new Date().toISOString() });
      return new Promise((resolve) => { finish = resolve; });
    });
    const user = userEvent.setup();
    const first = renderChat();
    await user.type(screen.getByPlaceholderText("Ask Socrates anything about your project…"), "Stream across routes{Enter}");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/chat/${SESSION_ID}`));
    await waitFor(() => expect(mocks.getSocratesHistory).toHaveBeenCalled());
    await act(async () => handlers.onDelta("First chunk", "First chunk"));
    await screen.findByText("First chunk");
    first.unmount();
    renderChat(`/chat/${SESSION_ID}`);
    await screen.findByText("First chunk");
    await act(async () => handlers.onDelta(" and second chunk", "First chunk and second chunk"));
    await screen.findByText("First chunk and second chunk");
    await act(async () => finish({ answer_md: "Completed answer.", citations: [], suggested_prompts: [], confidence: "high", sessionId: SESSION_ID,
      message: { userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: new Date().toISOString() } }));
    await screen.findByText("Completed answer.");
  });

  it("[R06] preserves a reader's scroll position while new text arrives", async () => {
    let handlers: any;
    let finish!: (value: any) => void;
    history = [userRow("Earlier question"), assistantRow("Earlier answer")];
    mocks.streamSocratesV1.mockImplementation(async (_project, _question, _session, opts) => {
      handlers = opts.handlers;
      handlers.onMessageCreated({ sessionId: SESSION_ID, assistantMessageId: "new-assistant", createdAt: new Date().toISOString() });
      return new Promise((resolve) => { finish = resolve; });
    });
    const view = renderChat(`/chat/${SESSION_ID}`);
    await screen.findByText("Earlier answer");
    await userEvent.setup().type(screen.getByPlaceholderText("Ask Socrates anything about your project…"), "Explain more{Enter}");
    await waitFor(() => expect(handlers).toBeDefined());
    const scroller = view.container.querySelector(".overflow-y-auto")!;
    Object.defineProperties(scroller, { scrollHeight: { value: 2000, configurable: true }, clientHeight: { value: 400, configurable: true }, scrollTop: { value: 100, writable: true, configurable: true } });
    fireEvent.scroll(scroller);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockClear();
    await act(async () => handlers.onDelta("New progressive text", "New progressive text"));
    await screen.findByText("New progressive text");
    expect(scroll).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(scroll).toHaveBeenCalled();
    await act(async () => finish({ answer_md: "Finished.", citations: [], suggested_prompts: [], confidence: "high", sessionId: SESSION_ID,
      message: { userMessageId: USER_MESSAGE_ID, assistantMessageId: "new-assistant", createdAt: new Date().toISOString() } }));
    scroll.mockRestore();
  });

  it("keeps conversation B visible when conversation A emits late stream events", async () => {
    const otherId = "55555555-5555-4555-8555-555555555555";
    let handlers: any;
    let finish!: (value: any) => void;
    mocks.getSocratesHistory.mockImplementation(async (_project, id) => id === otherId ? [{ ...assistantRow("Conversation B only."), sessionId: otherId }] : []);
    mocks.streamSocratesV1.mockImplementation(async (_project, _question, _session, opts) => {
      handlers = opts.handlers;
      handlers.onMessageCreated({ sessionId: SESSION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: new Date().toISOString() });
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<MemoryRouter initialEntries={[`/chat/${SESSION_ID}`]}><Link to={`/chat/${otherId}`}>Open B</Link><Routes><Route path="/chat/*" element={<ChatPage />} /></Routes></MemoryRouter>);
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText("Ask Socrates anything about your project…"), "Question for A{Enter}");
    await waitFor(() => expect(handlers).toBeDefined());
    await user.click(screen.getByRole("link", { name: "Open B" }));
    await screen.findByText("Conversation B only.");
    await act(async () => {
      handlers.onDelta("Late answer for A.", "Late answer for A.");
      finish({ answer_md: "Late answer for A.", citations: [], suggested_prompts: [], confidence: "high", sessionId: SESSION_ID,
        message: { userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: new Date().toISOString() } });
    });
    await waitFor(() => expect(screen.getByText("Conversation B only.")).toBeVisible());
    expect(screen.queryByText("Late answer for A.")).not.toBeInTheDocument();
  });

  it("does not submit Enter while an IME composition is active", async () => {
    renderChat();
    const input = await screen.findByPlaceholderText("Ask Socrates anything about your project…");
    fireEvent.change(input, { target: { value: "入力中" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
    expect(mocks.streamSocratesV1).not.toHaveBeenCalled();
  });

  it("keeps the selected source filter when the first answer creates a conversation route", async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(screen.getByRole("button", { name: "Docs" }));
    await user.type(screen.getByRole("textbox"), "What are the PRD requirements?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(SESSION_ID));
    expect(screen.getByRole("button", { name: "Docs" })).toHaveAttribute("aria-pressed", "true");
  });

  it("[R03] shows real attachment progress and cancels without claiming server rollback", async () => {
    let options: any;
    mocks.uploadDoc.mockImplementation((_project, _file, opts) => {
      options = opts;
      opts?.onProgress?.({ loaded: 50, total: 100, percent: 50, phase: "uploading" });
      return new Promise((_resolve, reject) => opts?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { code: "cancelled" }))));
    });
    const view = renderChat();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["synthetic"], "scope.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText(/50% uploaded/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    await waitFor(() => expect(options.signal.aborted).toBe(true));
    expect(await screen.findByText(/server may already have received/)).toBeVisible();
  });

  it("[R03] reconciles an uncertain upload before retrying and does not replay a saved document", async () => {
    mocks.uploadDoc.mockRejectedValue(Object.assign(new Error("Upload timed out"), { code: "timeout" }));
    mocks.reconcileDocumentUpload.mockResolvedValue({ documentId: "doc-saved", status: "ready" });
    const view = renderChat();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["synthetic"], "scope.pdf", { type: "application/pdf" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Check upload and retry" }));
    await waitFor(() => expect(mocks.reconcileDocumentUpload).toHaveBeenCalledWith(PROJECT_ID, expect.any(String), expect.any(AbortSignal)));
    expect(mocks.uploadDoc).toHaveBeenCalledTimes(1);
    expect(mocks.uploadDoc.mock.calls[0][2].operationId).toBe(mocks.reconcileDocumentUpload.mock.calls[0][1]);
  });

  it.each([[false, true], [true, true], [true, false]])('preserves a late first-session handoff without overriding a later selection (%s, away=%s)', async (chooseAnother, leaveRoute) => {
    let accept!: () => void;
    mocks.streamSocratesV1.mockImplementation((_projectId, _question, _sessionId, opts) => new Promise(resolve => {
      accept = () => {
        opts?.handlers?.onMessageCreated?.({sessionId: SESSION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: '2026-08-19T01:00:01.000Z'});
        history = [userRow('Keep the pending chat'), assistantRow('Persisted late answer.')];
        resolve({answer_md:'Persisted late answer.',citations:[],open_targets:[],suggested_prompts:[],confidence:'high',limitations:[],artifact:null,sourceStates:{},modelMetadata:{},sessionId:SESSION_ID,message:{userMessageId:USER_MESSAGE_ID,assistantMessageId:ASSISTANT_MESSAGE_ID,createdAt:'2026-08-19T01:00:01.000Z'}});
      };
    }));
    const first = renderChat();
    await userEvent.setup().type(screen.getByPlaceholderText('Ask Socrates anything about your project…'), 'Keep the pending chat{Enter}');
    await waitFor(() => expect(mocks.streamSocratesV1).toHaveBeenCalledTimes(1));
    if (leaveRoute) first.unmount();
    if (chooseAnother) act(() => useChatStore.getState().setActiveId(null));
    await act(async () => accept());
    expect(useChatStore.getState().activeId).toBe(chooseAnother ? null : SESSION_ID);
    if (!leaveRoute) first.unmount();
    renderChat();
    if (!chooseAnother) await waitFor(() => expect(screen.getByText('Persisted late answer.')).toBeVisible());
    else expect(screen.getByTestId('location')).toHaveTextContent('/chat');
  });

  it("[FIX-36] restores an unsent draft after the chat route unmounts", async () => {
    const user = userEvent.setup();
    const first = renderChat();
    const input = screen.getByPlaceholderText("Ask Socrates anything about your project…");
    await user.type(input, "Keep this draft while I check Memory");
    first.unmount();

    renderChat();
    expect(await screen.findByPlaceholderText("Ask Socrates anything about your project…")).toHaveValue(
      "Keep this draft while I check Memory"
    );
  });

  it("[FIX-12] restores the complete conversation after browser state is erased", async () => {
    history = [userRow("When is the launch?"), assistantRow("The launch is Friday.")];
    const first = renderChat(`/chat/${SESSION_ID}`);
    await screen.findByText("The launch is Friday.");
    first.unmount();
    useChatStore.setState({ projectId: null, conversations: [], activeId: null });

    renderChat(`/chat/${SESSION_ID}`);
    await screen.findByText("When is the launch?");
    expect(screen.getByText("The launch is Friday.")).toBeInTheDocument();
    expect(mocks.getSocratesHistory).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, expect.any(AbortSignal));
  });

  it("records answer corrections for human review without changing truth", async () => {
    history = [userRow("When is launch?"), assistantRow("Launch is Thursday.")];
    const user = userEvent.setup();
    renderChat(`/chat/${SESSION_ID}`);
    await screen.findByText("Launch is Thursday.");
    await user.click(screen.getByRole("button", { name: "Report an answer problem" }));
    await user.selectOptions(screen.getByLabelText("What went wrong?"), "missing_evidence");
    await user.type(screen.getByLabelText("Correction or context (optional)"), "Cite the signed launch plan.");
    await user.click(screen.getByRole("button", { name: "Save feedback" }));
    await waitFor(() => expect(mocks.saveSocratesFeedback).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, ASSISTANT_MESSAGE_ID, { reason: "missing_evidence", correctionText: "Cite the signed launch plan." }));
    expect(await screen.findByText(/queued for human review/)).toBeVisible();
  });

  it("[FIX-36] restores user-before-assistant order from a reversed history response", async () => {
    history = [assistantRow("The launch is Friday."), userRow("When is the launch?")];
    renderChat(`/chat/${SESSION_ID}`);

    await screen.findByText("The launch is Friday.");
    const renderedMessages = screen.getAllByText(/When is the launch\?|The launch is Friday\./);
    expect(renderedMessages.map((element) => element.textContent)).toEqual([
      "When is the launch?",
      "The launch is Friday.",
    ]);
  });

  it("[FIX-14] preserves safe Markdown, evidence, limitations and artifacts after reload", async () => {
    const rich = assistantRow("## Launch answer\n\nShip on **Friday**. [Safe link](https://example.com/plan) [Unsafe link](javascript:alert(1))");
    rich.answerPayloadJson = {
      suggested_prompts: [], confidence: "high",
      citations: [{ refId: "doc:launch", sourceType: "document", label: "Launch plan", excerpt: "Friday", openTargetId: "target:launch" }],
      open_targets: [{ id: "target:launch", sourceType: "document", targetType: "document_section", targetRef: { documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", anchorId: "launch" } }],
      limitations: ["Evidence-only fallback."],
      artifact: { id: "artifact:launch", type: "summary", title: "Launch brief", contentMd: "### Decision\n\nShip **Friday**.", payload: {}, sourceRefs: [{ sourceType: "document", refId: "doc:launch", label: "Launch plan" }], generatedAt: "2026-08-20T00:00:00.000Z" },
      sourceStates: {
        clickup: { state: "unavailable", count: 0, message: "ClickUp is not connected." },
        communications: { state: "empty", count: 0, message: "No indexed communication-layer evidence found." },
      },
      modelMetadata: { degraded: false },
    };
    history = [userRow("When do we ship?"), rich];

    const first = renderChat(`/chat/${SESSION_ID}`);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Launch answer" })).toBeVisible());
    expect(screen.getByRole("link", { name: "Safe link" })).toHaveAttribute("href", "https://example.com/plan");
    expect(screen.queryByRole("link", { name: "Unsafe link" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open document/ })).toHaveAttribute("href", expect.stringContaining("/memory/docs/"));
    await userEvent.click(screen.getByText("Limitations (1)"));
    expect(screen.getByText("Evidence-only fallback.")).toBeVisible();
    expect(screen.getByText("ClickUp is not connected.")).toBeVisible();
    expect(screen.queryByText("No indexed communication-layer evidence found.")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Artifact: Launch brief" })).toBeVisible();
    first.unmount();
    useChatStore.setState({ projectId: null, conversations: [], activeId: null });

    renderChat(`/chat/${SESSION_ID}`);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Launch answer" })).toBeVisible());
    expect(screen.getByRole("region", { name: "Artifact: Launch brief" })).toBeVisible();
  });

  it("navigates internal evidence targets through the client router", async () => {
    const rich = assistantRow("The launch plan is available.");
    rich.answerPayloadJson = {
      suggested_prompts: [], confidence: "high",
      citations: [{ refId: "doc:launch", sourceType: "document", label: "Launch plan", excerpt: "Friday", openTargetId: "target:launch" }],
      open_targets: [{ id: "target:launch", sourceType: "document", targetType: "document_section", targetRef: { documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", anchorId: "launch" } }],
    };
    history = [userRow("Open the plan"), rich];
    const user = userEvent.setup();
    renderChat(`/chat/${SESSION_ID}`);

    await user.click(await screen.findByRole("link", { name: /Open document/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/memory/docs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/view");
  });

  it("restores explicit sparse citation numbers after reload and opens the matching source", async () => {
    const rich = assistantRow("First claim [E8]. Second claim [E2]. Legacy [E1].");
    rich.answerPayloadJson = {
      citations: [
        { evidenceNumber: 2, refId: "chunk:2", sourceType: "document", label: "Second", openTargetId: "target:2" },
        { evidenceNumber: 8, refId: "chunk:8", sourceType: "document", label: "Eighth", openTargetId: "target:8" },
        { refId: "chunk:1", sourceType: "document", label: "Legacy", openTargetId: "target:1" },
      ],
      open_targets: [1, 2, 8].map((number) => ({ id: `target:${number}`, sourceType: "document", targetType: "document_section", targetRef: { documentId: `doc-${number}` } })),
    };
    history = [userRow("Which source supports each claim?"), rich];
    const first = renderChat(`/chat/${SESSION_ID}`);
    expect(await screen.findByRole("link", { name: "[E8]" })).toHaveAttribute("href", "/memory/docs/doc-8/view");
    expect(screen.getByRole("link", { name: "[E2]" })).toHaveAttribute("href", "/memory/docs/doc-2/view");
    expect(screen.queryByRole("link", { name: "[E1]" })).not.toBeInTheDocument();
    first.unmount();
    useChatStore.setState({ projectId: null, conversations: [], activeId: null });
    renderChat(`/chat/${SESSION_ID}`);
    await userEvent.click(await screen.findByRole("link", { name: "[E8]" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/memory/docs/doc-8/view");
  });

  it("[FIX-12] shows authorization/history failures instead of a false empty chat", async () => {
    mocks.getSocratesHistory.mockRejectedValue(new Error("Socrates session access denied"));
    renderChat(`/chat/${SESSION_ID}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Socrates session access denied");
    expect(screen.queryByText("ASK YOUR PROJECT")).not.toBeInTheDocument();
  });

  it("[FIX-12] submits a persisted suggested prompt into the existing server session", async () => {
    history = [userRow("Hello"), {
      ...assistantRow("Hey. I’m here."),
      answerPayloadJson: { suggested_prompts: ["Summarize the project memory."], citations: [] },
    }];
    mocks.streamSocratesV1.mockImplementation(async (_projectId, question, _sessionId, opts) => {
      const nextUserId = "66666666-6666-4666-8666-666666666666";
      const nextAssistantId = "77777777-7777-4777-8777-777777777777";
      opts?.handlers?.onMessageCreated?.({
        sessionId: SESSION_ID,
        userMessageId: nextUserId,
        assistantMessageId: nextAssistantId,
        createdAt: "2026-08-19T01:00:02.000Z"
      });
      history = [
        ...history,
        { ...userRow(question), id: nextUserId },
        { ...assistantRow("Here is the summary."), id: nextAssistantId }
      ];
      return {
        answer_md: "Here is the summary.", citations: [], open_targets: [], suggested_prompts: [], confidence: "high",
        limitations: [], artifact: null, sourceStates: {}, modelMetadata: {}, sessionId: SESSION_ID,
        message: { sessionId: SESSION_ID, userMessageId: nextUserId, assistantMessageId: nextAssistantId, createdAt: "2026-08-19T01:00:02.000Z" },
      };
    });
    const user = userEvent.setup();
    renderChat(`/chat/${SESSION_ID}`);
    await user.click(await screen.findByRole("button", { name: "Summarize the project memory." }));

    await waitFor(() => expect(mocks.streamSocratesV1).toHaveBeenCalledWith(
      PROJECT_ID,
      "Summarize the project memory.",
      SESSION_ID,
      expect.anything(),
    ));
  });

  it("deduplicates rapid duplicate submits while the first server request is pending", async () => {
    let resolveAnswer!: (answer: Awaited<ReturnType<typeof import("../lib/api")["streamSocratesV1"]>>) => void;
    mocks.streamSocratesV1.mockImplementation((_projectId, _question, _sessionId, opts) => new Promise((resolve) => {
      opts?.handlers?.onMessageCreated?.({ sessionId: SESSION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-19T01:00:01.000Z" });
      resolveAnswer = resolve;
    }));
    const user = userEvent.setup();
    renderChat();
    const input = screen.getByPlaceholderText("Ask Socrates anything about your project…");
    await user.type(input, "Protect this message");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await waitFor(() => expect(mocks.streamSocratesV1).toHaveBeenCalledTimes(1));
    await act(async () => resolveAnswer({
      answer_md: "One answer.", citations: [], open_targets: [], suggested_prompts: [], confidence: "high", limitations: [], artifact: null, sourceStates: {}, modelMetadata: {}, sessionId: SESSION_ID,
      message: { userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-19T01:00:01.000Z" },
    }));
    await waitFor(() => expect(screen.getByText("One answer.")).toBeVisible());
  });

  it("keeps unsent input when the server cannot accept the first streamed message", async () => {
    mocks.streamSocratesV1.mockRejectedValue(new Error("Session service unavailable"));
    const user = userEvent.setup();
    renderChat();
    const input = screen.getByPlaceholderText("Ask Socrates anything about your project…");
    await user.type(input, "Do not lose this{Enter}");
    await waitFor(() => expect(mocks.streamSocratesV1).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("Do not lose this");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat");
  });

  it("[FIX-13] paints provider deltas before the stream completes", async () => {
    let finish!: () => void;
    mocks.streamSocratesV1.mockImplementation((_projectId, _question, _sessionId, opts) => new Promise((resolve) => {
      opts?.handlers?.onMessageCreated?.({ userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-20T01:00:00.000Z" });
      opts?.handlers?.onDelta?.("First ", "First ");
      opts?.handlers?.onDelta?.("tokens", "First tokens");
      finish = () => resolve({
        answer_md: "First tokens", citations: [], suggested_prompts: [], confidence: "high", sessionId: SESSION_ID,
        message: { userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-20T01:00:00.000Z" },
      });
    }));
    const user = userEvent.setup();
    renderChat(`/chat/${SESSION_ID}`);
    await waitFor(() => expect(mocks.getSocratesHistory).toHaveBeenCalled());
    await user.type(screen.getByPlaceholderText("Ask Socrates anything about your project…"), "Show the stream{Enter}");

    expect(await screen.findByText("First tokens")).toBeInTheDocument();
    expect(screen.getByText("Writing answer…")).toBeInTheDocument();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByText("Writing answer…")).not.toBeInTheDocument());
    expect(screen.getAllByText("First tokens")).toHaveLength(1);
  });

  it("paints the completed stream before background history reconciliation finishes", async () => {
    renderChat(`/chat/${SESSION_ID}`);
    await waitFor(() => expect(mocks.getSocratesHistory).toHaveBeenCalledTimes(1));
    let resolveReconciliation!: (messages: SocratesHistoryMessage[]) => void;
    mocks.getSocratesHistory.mockImplementationOnce(() => new Promise((resolve) => { resolveReconciliation = resolve; }));
    mocks.streamSocratesV1.mockImplementation(async (_projectId, _question, _sessionId, opts) => {
      opts?.handlers?.onMessageCreated?.({ sessionId: SESSION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-20T01:00:00.000Z" });
      opts?.handlers?.onDelta?.("Fast final answer.", "Fast final answer.");
      return {
        answer_md: "Fast final answer.", citations: [], open_targets: [], suggested_prompts: [], confidence: "high",
        limitations: [], artifact: null, sourceStates: {}, modelMetadata: { provider: "openai", degraded: false }, sessionId: SESSION_ID,
        message: { sessionId: SESSION_ID, userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-20T01:00:00.000Z" },
      };
    });

    await userEvent.type(screen.getByPlaceholderText("Ask Socrates anything about your project…"), "Answer without a second wait{Enter}");

    await waitFor(() => expect(screen.getByLabelText("Answer status")).toHaveTextContent("high confidence"));
    expect(screen.getAllByText("Fast final answer.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Writing answer…")).not.toBeInTheDocument();
    expect(mocks.getSocratesHistory).toHaveBeenCalledTimes(2);

    await act(async () => resolveReconciliation([
      userRow("Answer without a second wait"),
      assistantRow("Fast final answer."),
    ]));
  });

  it("[FIX-13] cancels the accepted assistant response and keeps one stopped state", async () => {
    mocks.streamSocratesV1.mockImplementation((_projectId, _question, _sessionId, opts) => new Promise((_resolve, reject) => {
      opts?.handlers?.onMessageCreated?.({ userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-20T01:00:00.000Z" });
      opts?.handlers?.onDelta?.("Partial", "Partial");
      opts?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const user = userEvent.setup();
    renderChat(`/chat/${SESSION_ID}`);
    await waitFor(() => expect(mocks.getSocratesHistory).toHaveBeenCalled());
    const input = screen.getByPlaceholderText("Ask Socrates anything about your project…");
    await user.type(input, "Stop this{Enter}");
    await screen.findByText("Partial");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(mocks.cancelSocratesV1).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, ASSISTANT_MESSAGE_ID));
    await waitFor(() => expect(screen.getAllByText("Response stopped.")).toHaveLength(1));
    expect(screen.queryByText("Writing answer…")).not.toBeInTheDocument();
  });

  it("[FIX-13] waits for server acceptance before cancelling an immediately stopped response", async () => {
    let accept!: () => void;
    mocks.streamSocratesV1.mockImplementation((_projectId, _question, _sessionId, opts) => new Promise((_resolve, reject) => {
      accept = () => {
        opts?.handlers?.onMessageCreated?.({ userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-20T01:00:00.000Z" });
      };
      opts?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const user = userEvent.setup();
    renderChat(`/chat/${SESSION_ID}`);
    await waitFor(() => expect(mocks.getSocratesHistory).toHaveBeenCalled());
    const input = screen.getByPlaceholderText("Ask Socrates anything about your project…");
    await user.type(input, "Stop before acceptance{Enter}");
    await waitFor(() => expect(mocks.streamSocratesV1).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.cancelSocratesV1).not.toHaveBeenCalled();
    await act(async () => accept());
    await waitFor(() => expect(mocks.cancelSocratesV1).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, ASSISTANT_MESSAGE_ID));
    await waitFor(() => expect(screen.getAllByText("Response stopped.")).toHaveLength(1));
  });

  it("[FIX-13] reports a cancellation failure instead of claiming the response stopped", async () => {
    mocks.cancelSocratesV1.mockRejectedValueOnce(new Error("cancel unavailable"));
    mocks.streamSocratesV1.mockImplementation((_projectId, _question, _sessionId, opts) => new Promise((_resolve, reject) => {
      opts?.handlers?.onMessageCreated?.({ userMessageId: USER_MESSAGE_ID, assistantMessageId: ASSISTANT_MESSAGE_ID, createdAt: "2026-08-20T01:00:00.000Z" });
      opts?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const user = userEvent.setup();
    renderChat(`/chat/${SESSION_ID}`);
    await waitFor(() => expect(mocks.getSocratesHistory).toHaveBeenCalled());
    const input = screen.getByPlaceholderText("Ask Socrates anything about your project…");
    await user.type(input, "Fail cancellation honestly{Enter}");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Cancellation wasn’t confirmed. Reload to check the response.")).toBeInTheDocument();
    expect(screen.queryByText("Response stopped.")).not.toBeInTheDocument();
  });
});
