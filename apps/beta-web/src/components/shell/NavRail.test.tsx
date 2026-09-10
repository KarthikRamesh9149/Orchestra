import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api/client";
import { useChatStore } from "../../store/chatStore";
import { NavRail, useRailStore } from "./NavRail";

const apiMocks = vi.hoisted(() => ({
  deleteSocratesSession: vi.fn(async (_projectId: string, sessionId: string) => ({ deleted: true, sessionId }))
}));

const authState = vi.hoisted(() => ({
  user: { displayName: "Karthik" },
  activeProject: { id: "project-1", projectRole: "manager" }
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => authState
}));
vi.mock("../../lib/api/settings", () => ({
  getAppearancePreference: vi.fn(async () => ({ theme: "auto" })),
  updateAppearancePreference: vi.fn(async (theme: string) => ({ theme }))
}));
vi.mock("../../lib/performance/prefetch", () => ({ prefetchPrimaryRoute: vi.fn() }));
vi.mock("../../lib/api/socrates", () => ({ deleteSocratesSession: apiMocks.deleteSocratesSession }));

describe("Socrates conversation navigation", () => {
  beforeEach(() => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === "(min-width: 768px)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    useRailStore.setState({ isExpanded: false });
    apiMocks.deleteSocratesSession.mockClear();
    useChatStore.setState({
      projectId: "project-1",
      activeId: "chat-1",
      conversations: [
        { id: "chat-1", title: "GitHub launch summary", preview: "", timestamp: new Date().toISOString(), messageCount: 2, hasArtifacts: false, messages: [] },
        { id: "chat-2", title: "Pilot readiness", preview: "", timestamp: new Date().toISOString(), messageCount: 4, hasArtifacts: false, messages: [] }
      ]
    });
  });

  it("opens named recent chats by default on desktop Chat routes", async () => {
    render(
      <MemoryRouter initialEntries={["/chat/chat-1"]}>
        <NavRail />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeInTheDocument());
    expect(screen.getByText("Recent chats")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /GitHub launch summary/ })).toHaveAttribute("href", "/chat/chat-1");
    expect(screen.getByRole("link", { name: /Pilot readiness/ })).toHaveAttribute("href", "/chat/chat-2");
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  });

  it("deletes a chat only after authoritative confirmation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/chat/chat-1"]}>
        <NavRail />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "Delete chat GitHub launch summary" }));
    await waitFor(() => expect(screen.getByRole("alertdialog", { name: "Delete chat" })).toBeVisible());
    expect(apiMocks.deleteSocratesSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(apiMocks.deleteSocratesSession).toHaveBeenCalledWith("project-1", "chat-1"));
    await waitFor(() => expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual(["chat-2"]));
    expect(useChatStore.getState().activeId).toBeNull();
  });

  it("cleans a stale cached chat when the server confirms it is already absent", async () => {
    apiMocks.deleteSocratesSession.mockRejectedValueOnce(new ApiError({
      status: 404,
      code: "session_not_found",
      message: "Session not found",
    }));
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/chat/chat-1"]}>
        <NavRail />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: "Delete chat GitHub launch summary" }));
    await user.click(await screen.findByRole("button", { name: /^Delete$/ }));

    await waitFor(() => expect(useChatStore.getState().conversations.map((conversation) => conversation.id)).toEqual(["chat-2"]));
    expect(useChatStore.getState().activeId).toBeNull();
    expect(screen.queryByText("Session not found")).not.toBeInTheDocument();
  });
});
