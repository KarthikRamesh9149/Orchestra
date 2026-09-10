import { expect, it, vi } from "vitest";
import { startupCodeKeys, warmStartupCode } from "./startupCode";

it("loads only the requested page's public code and shell", () => {
  expect(startupCodeKeys("/chat/session-id")).toEqual(["shell", "chat", "markdown"]);
  expect(startupCodeKeys("/settings")).toEqual(["shell", "settings"]);
  expect(startupCodeKeys("/")).toEqual(["login"]);
  expect(startupCodeKeys("/unknown")).toEqual([]);
});

it("starts every selected download without waiting for another module or private API", async () => {
  let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  const shell = vi.fn(() => deferred), chat = vi.fn(async () => {}), markdown = vi.fn(async () => {});
  const pending = warmStartupCode("/chat/session-id", { shell, chat, markdown });
  expect(shell).toHaveBeenCalledOnce();
  expect(chat).toHaveBeenCalledOnce();
  expect(markdown).toHaveBeenCalledOnce();
  release(); await pending;
});

it("keeps speculative download failure from breaking authentication", async () => {
  await expect(warmStartupCode("/settings", { shell: async () => {}, settings: async () => { throw new Error("Offline"); } })).resolves.toBeUndefined();
});
