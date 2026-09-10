import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chatStore";

describe("chat continuity privacy", () => {
  beforeEach(() => useChatStore.getState().resetContinuity());
  it("retains drafts only for the same verified identity", () => {
    const store = useChatStore.getState();
    store.bindIdentity("user-a:org");
    store.setProject("shared-project");
    store.setDraft("shared-project", null, "Private unsent draft");
    store.bindIdentity("user-a:org");
    expect(Object.values(useChatStore.getState().drafts)).toEqual(["Private unsent draft"]);
    store.bindIdentity("user-b:org");
    expect(useChatStore.getState()).toMatchObject({ projectId: null, conversations: [], drafts: {} });
    expect(sessionStorage.getItem("orchestra_chat_continuity_v1")).not.toContain("Private unsent draft");
  });
  it("invalidates pending callbacks when continuity is cleared", () => {
    const generation = useChatStore.getState().generation;
    useChatStore.getState().resetContinuity();
    expect(useChatStore.getState().generation).toBe(generation + 1);
  });
});
