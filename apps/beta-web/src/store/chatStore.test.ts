import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, type Conversation } from "./chatStore";

const conversation: Conversation = {
  id: "session-1",
  title: "Pilot readiness",
  preview: "Decision: controlled pilot",
  timestamp: "2026-08-22T00:00:00.000Z",
  messageCount: 2,
  hasArtifacts: false,
  messages: [
    { id: "user-1", role: "user", content: "Are we ready?", timestamp: "2026-08-22T00:00:00.000Z" },
    { id: "assistant-1", role: "assistant", content: "Run a controlled pilot.", timestamp: "2026-08-22T00:00:01.000Z" },
  ],
};

describe("chat continuity cache", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useChatStore.setState({ projectId: null, conversations: [], activeId: null, drafts: {}, lastActiveByProject: {} });
  });

  it("restores the active conversation from the signed-in tab cache", async () => {
    useChatStore.setState({ projectId: "project-1", conversations: [conversation], activeId: conversation.id });
    const persisted = sessionStorage.getItem("orchestra_chat_continuity_v1");
    expect(persisted).toContain("Run a controlled pilot.");

    useChatStore.setState({ projectId: null, conversations: [], activeId: null });
    sessionStorage.setItem("orchestra_chat_continuity_v1", persisted!);
    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState()).toMatchObject({
      projectId: "project-1",
      activeId: "session-1",
      conversations: [{ id: "session-1", messages: [{ content: "Are we ready?" }, { content: "Run a controlled pilot." }] }],
    });
  });

  it("[R07] draft typing does not serialize or rewrite unrelated transcript text", () => {
    useChatStore.setState({ projectId: "project-1", conversations: [conversation], activeId: conversation.id });
    const write = vi.spyOn(Storage.prototype, "setItem");
    try {
      useChatStore.getState().setDraft("project-1", conversation.id, "a");
      useChatStore.getState().setDraft("project-1", conversation.id, "ab");
      window.dispatchEvent(new Event("pagehide"));
      expect(write.mock.calls.some(([, value]) => value.includes("Run a controlled pilot."))).toBe(false);
      expect(write.mock.calls.some(([, value]) => value.includes('"ab"'))).toBe(true);
    } finally { write.mockRestore(); }
  });

  it("[R07] storage quota errors cannot break typing or identity cleanup", () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      expect(() => useChatStore.getState().setDraft("project-1", null, "Recover this text")).not.toThrow();
      window.dispatchEvent(new Event("pagehide"));
      expect(useChatStore.getState().drafts["project-1:new"]).toBe("Recover this text");
      expect(() => useChatStore.getState().resetContinuity()).not.toThrow();
      expect(useChatStore.getState().drafts).toEqual({});
    } finally { write.mockRestore(); }
  });

  it("[R07] prioritizes the latest edited draft when checkpoint space is bounded", () => {
    for (let i = 0; i < 10; i++) useChatStore.getState().setDraft("project-1", `session-${i}`, "x".repeat(8000));
    useChatStore.getState().setDraft("project-1", "session-0", "Latest edit" + "x".repeat(7989));
    window.dispatchEvent(new Event("pagehide"));
    const saved = JSON.parse(sessionStorage.getItem("orchestra_chat_drafts_v1")!);
    expect(saved.drafts["project-1:session-0"]).toContain("Latest edit");
  });

  it("resets the source selection when a session is cleared", () => {
    useChatStore.getState().setSourceScope("Docs");
    useChatStore.getState().resetContinuity();
    expect(useChatStore.getState().sourceScope).toBe("All");
  });
});
