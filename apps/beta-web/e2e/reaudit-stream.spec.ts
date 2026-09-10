import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

// A real HTTP stream deliberately withholds completion. A single buffered
// route.fulfill response cannot prove that progressive rendering works.
test("first-chat stream survives routing, source selection and draft navigation", async ({ page }) => {
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const userMessageId = "33333333-3333-4333-8333-333333333333";
  const assistantMessageId = "44444444-4444-4444-8444-444444444444";
  let first!: () => void, finish!: () => void;
  const firstAllowed = new Promise<void>((resolve) => { first = resolve; });
  const doneAllowed = new Promise<void>((resolve) => { finish = resolve; });
  let completed = false;
  let history: unknown[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4173");
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "content-type,x-csrf-token");
    if (request.method === "OPTIONS") { response.end(); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const event = (name: string, data: unknown) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    event("message_created", { sessionId, userMessageId, assistantMessageId, createdAt: new Date().toISOString() });
    await firstAllowed;
    event("delta", { text: "The first evidence paragraph arrives before completion." });
    await doneAllowed;
    const answer = "The first evidence paragraph arrives before completion. The complete answer is now saved.";
    history = [
      { id: userMessageId, sessionId, role: "user", content: "Summarize the PRD", responseStatus: "completed", createdAt: "2026-09-07T00:00:00Z" },
      { id: assistantMessageId, sessionId, role: "assistant", content: answer, responseStatus: "completed", createdAt: "2026-09-07T00:00:01Z" },
    ];
    completed = true;
    event("done", { sessionId, answer_md: answer, citations: [], suggested_prompts: [], confidence: "low", limitations: [], open_targets: [], message: { sessionId, userMessageId, assistantMessageId, createdAt: new Date().toISOString() } });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("**/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const data = (value: unknown) => route.fulfill({ json: { data: value, error: null, meta: null } });
      if (path.endsWith("/messages/stream/v1")) return route.continue({ url: `http://127.0.0.1:${port}/stream` });
      if (path === "/v1/auth/me") return data({ id: "browser-user", orgId: "browser-org", displayName: "Synthetic browser user", email: "browser@example.invalid", globalRole: "owner", workspaceRoleDefault: "manager" });
      if (path === "/v1/me/workspaces") return data([{ projectId: "browser-project", name: "Synthetic browser workspace", role: "manager", organizationId: "browser-org", current: true }]);
      if (path.endsWith("/csrf")) return data({ csrfToken: "synthetic-browser-csrf" });
      if (path.endsWith("/messages")) return data(history);
      if (path.endsWith("/prewarm")) return data({ warmed: true });
      if (path.endsWith("/appearance-preference")) return data({ theme: "light" });
      return data([]);
    });
    await page.goto("/chat");
    await page.getByRole("button", { name: "Docs", exact: true }).click();
    await page.getByRole("textbox", { name: "Ask Socrates anything about your project…" }).fill("Summarize the PRD");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/chat/${sessionId}$`));
    first();
    await expect(page.getByText("The first evidence paragraph arrives before completion.", { exact: true })).toBeVisible();
    expect(completed).toBe(false);
    await expect(page.getByRole("button", { name: "Docs", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("textbox", { name: "Ask Socrates anything about your project…" }).fill("Keep my next question");
    await page.getByRole("button", { name: "Memory", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project memory", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.getByText("The first evidence paragraph arrives before completion.", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Ask Socrates anything about your project…" })).toHaveValue("Keep my next question");
    finish();
    await expect(page.getByText(/The complete answer is now saved/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop generating response" })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    first(); finish(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
