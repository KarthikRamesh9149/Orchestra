import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askSocratesV1, clearAuth, createSocratesSession, deleteSocratesSession, getSocratesHistory, listSocratesSessions, streamSocratesV1 } from "./api";
import { server } from "../test/server";

const api = "http://localhost:3000";
const projectId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

describe("Socrates session API", () => {
  beforeEach(() => clearAuth());

  it("creates a CSRF-protected server session and sends its ID with the first ask", async () => {
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "chat-csrf" }, meta: null, error: null })
      ),
      http.post(`${api}/v1/projects/${projectId}/socrates/sessions`, async ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(request.headers.get("x-csrf-token")).toBe("chat-csrf");
        expect(await request.json()).toEqual({ pageContext: "dashboard_project" });
        return HttpResponse.json({ data: {
          id: sessionId, projectId, userId: "user-1", pageContext: "dashboard_project",
          createdAt: "2026-08-19T01:00:00.000Z", updatedAt: "2026-08-19T01:00:00.000Z",
        }, meta: null, error: null });
      }),
      http.post(`${api}/v1/projects/${projectId}/socrates/v1/ask`, async ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(await request.json()).toEqual({
          question: "What changed?", sessionId, selectedSources: ["all"], includeArtifacts: true, mode: "ask",
        });
        return HttpResponse.json({ data: {
          answer_md: "The launch date changed.", citations: [], suggested_prompts: [], confidence: "high", sessionId,
          message: { userMessageId: "user-message", assistantMessageId: "assistant-message", createdAt: "2026-08-19T01:00:01.000Z" },
        }, meta: null, error: null });
      })
    );

    await expect(createSocratesSession(projectId)).resolves.toMatchObject({ id: sessionId });
    await expect(askSocratesV1(projectId, "What changed?", { sessionId })).resolves.toMatchObject({
      sessionId,
      message: { assistantMessageId: "assistant-message" },
    });
  });

  it("keeps Slack scope provider-specific and represents All explicitly", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "scope-csrf" }, meta: null, error: null })
      ),
      http.post(`${api}/v1/projects/${projectId}/socrates/v1/ask`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ data: {
          answer_md: "Scoped answer", citations: [], suggested_prompts: [], confidence: "high", sessionId,
          message: { userMessageId: "user-message", assistantMessageId: "assistant-message", createdAt: "2026-08-19T01:00:01.000Z" },
        }, meta: null, error: null });
      })
    );

    await askSocratesV1(projectId, "What did Slack say?", { sessionId, scope: "Slack" });
    await askSocratesV1(projectId, "What changed?", { sessionId, scope: "All" });

    expect(bodies).toEqual([
      expect.objectContaining({ selectedSources: ["slack"] }),
      expect.objectContaining({ selectedSources: ["all"] })
    ]);
  });

  it("loads the owned session list and complete ordered history with cookies", async () => {
    server.use(
      http.get(`${api}/v1/projects/${projectId}/socrates/sessions`, ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(new URL(request.url).searchParams.get("limit")).toBe("30");
        return HttpResponse.json({ data: [{
          id: sessionId, projectId, pageContext: "dashboard_project", title: "Question", preview: "Answer",
          messageCount: 2, createdAt: "2026-08-19T01:00:00.000Z", updatedAt: "2026-08-19T01:00:01.000Z",
        }], meta: null, error: null });
      }),
      http.get(`${api}/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages`, ({ request }) => {
        expect(request.credentials).toBe("include");
        return HttpResponse.json({ data: [
          { id: "user-message", sessionId, role: "user", content: "Question", responseStatus: null, createdAt: "2026-08-19T01:00:00.000Z" },
          { id: "assistant-message", sessionId, role: "assistant", content: "Answer", responseStatus: "completed", createdAt: "2026-08-19T01:00:01.000Z" },
        ], meta: null, error: null });
      })
    );

    await expect(listSocratesSessions(projectId)).resolves.toHaveLength(1);
    await expect(getSocratesHistory(projectId, sessionId)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "Question" }),
      expect.objectContaining({ role: "assistant", content: "Answer" }),
    ]));
  });

  it("deletes a session through the CSRF-protected authoritative contract", async () => {
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "delete-chat-csrf" }, meta: null, error: null })
      ),
      http.delete(`${api}/v1/projects/${projectId}/socrates/sessions/${sessionId}`, ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(request.headers.get("x-csrf-token")).toBe("delete-chat-csrf");
        return HttpResponse.json({ data: { deleted: true, sessionId }, meta: null, error: null });
      })
    );

    await expect(deleteSocratesSession(projectId, sessionId)).resolves.toEqual({ deleted: true, sessionId });
  });

  it("renders genuine SSE deltas before the authoritative done payload", async () => {
    const encoder = new TextEncoder();
    server.use(
      http.get(`${api}/v1/auth/csrf`, () => HttpResponse.json({ data: { csrfToken: "stream-csrf" }, meta: null, error: null })),
      http.post(`${api}/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream/v1`, () => {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`id: 1\nevent: message_created\ndata: {"userMessageId":"user-message","assistantMessageId":"assistant-message"}\n\n`));
            controller.enqueue(encoder.encode(`id: 2\nevent: delta\ndata: {"text":"Live "}\n\n`));
            controller.enqueue(encoder.encode(`id: 3\nevent: delta\ndata: {"text":"answer"}\n\n`));
            controller.enqueue(encoder.encode(`id: 4\nevent: done\ndata: ${JSON.stringify({
              answer_md: "## Live answer\n\nSee **Friday**.",
              citations: [{ ref_id: "doc:1", source_type: "document", title: "Launch plan", snippet: "Friday", open_target_id: "target:1" }],
              open_targets: [{ id: "target:1", source_type: "document", target_type: "document_section", target_ref: { documentId: "doc-1", anchorId: "launch" } }],
              suggested_prompts: [], confidence: "high", limitations: ["Based on indexed evidence only."],
              artifact: { id: "artifact:launch", type: "summary", title: "Launch brief", content_md: "**Ship Friday.**", payload: { day: "Friday" }, source_refs: [{ sourceType: "document", refId: "doc:1", label: "Launch plan" }], generated_at: "2026-08-20T00:00:00.000Z" },
              sourceStates: { slack: { state: "unavailable", count: 0, message: "Slack is not connected." } },
              modelMetadata: { provider: "openai", model: "test-model", degraded: false },
              sessionId,
              message: { userMessageId: "user-message", assistantMessageId: "assistant-message", createdAt: "2026-08-20T00:00:00.000Z" },
            })}\n\n`));
            controller.close();
          }
        });
        return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
      })
    );
    const deltas: string[] = [];

    const answer = await streamSocratesV1(projectId, "Stream this", sessionId, {
      handlers: { onDelta: (_delta, accumulated) => deltas.push(accumulated) }
    });

    expect(deltas).toEqual(["Live ", "Live answer"]);
    expect(answer.answer_md).toContain("Live answer");
    expect(answer.citations[0]).toMatchObject({ refId: "doc:1", openTargetId: "target:1" });
    expect(answer.open_targets[0]?.targetRef).toEqual({ documentId: "doc-1", anchorId: "launch" });
    expect(answer.limitations).toEqual(["Based on indexed evidence only."]);
    expect(answer.artifact).toMatchObject({ type: "summary", title: "Launch brief" });
    expect(answer.sourceStates.slack).toMatchObject({ state: "unavailable" });
    expect(answer.modelMetadata).toMatchObject({ provider: "openai", degraded: false });
    expect(answer.message.assistantMessageId).toBe("assistant-message");
  });

  it("[FIX-36] opens a new session and sends its first message through one SSE request", async () => {
    const requests = vi.fn();
    server.use(
      http.get(`${api}/v1/auth/csrf`, () => HttpResponse.json({ data: { csrfToken: "stream-csrf" }, meta: null, error: null })),
      http.post(`${api}/v1/projects/${projectId}/socrates/messages/stream/v1`, async ({ request }) => {
        requests();
        expect(await request.json()).toMatchObject({ question: "First message", sessionId: null });
        return new HttpResponse(
          `event: message_created\ndata: {"sessionId":"${sessionId}","userMessageId":"user-message","assistantMessageId":"assistant-message"}\n\n` +
          `event: done\ndata: {"answer_md":"Fast answer","sessionId":"${sessionId}","message":{"sessionId":"${sessionId}","userMessageId":"user-message","assistantMessageId":"assistant-message","createdAt":"2026-08-20T00:00:00.000Z"}}\n\n`,
          { headers: { "Content-Type": "text/event-stream" } }
        );
      })
    );

    const accepted: string[] = [];
    await expect(streamSocratesV1(projectId, "First message", null, {
      handlers: { onMessageCreated: (message) => accepted.push(message.sessionId ?? "") }
    })).resolves.toMatchObject({ sessionId, answer_md: "Fast answer" });
    expect(accepted).toEqual([sessionId]);
    expect(requests).toHaveBeenCalledTimes(1);
  });

  it("reconnects a bounded number of times by assistant ID without reposting the question", async () => {
    const initial = vi.fn();
    const reconnect = vi.fn();
    server.use(
      http.get(`${api}/v1/auth/csrf`, () => HttpResponse.json({ data: { csrfToken: "stream-csrf" }, meta: null, error: null })),
      http.post(`${api}/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream/v1`, () => {
        initial();
        return new HttpResponse(`event: message_created\ndata: {"userMessageId":"user-message","assistantMessageId":"assistant-message"}\n\nevent: delta\ndata: {"text":"Partial "}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      }),
      http.get(`${api}/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/assistant-message/stream`, ({ request }) => {
        reconnect();
        expect(new URL(request.url).searchParams.get("offset")).toBe("8");
        return new HttpResponse(`event: delta\ndata: {"text":"answer"}\n\nevent: done\ndata: {"answer_md":"Partial answer","sessionId":"${sessionId}","message":{"userMessageId":"user-message","assistantMessageId":"assistant-message","createdAt":"2026-08-20T00:00:00.000Z"}}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      })
    );

    await expect(streamSocratesV1(projectId, "Do not duplicate", sessionId)).resolves.toMatchObject({ answer_md: "Partial answer" });
    expect(initial).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
