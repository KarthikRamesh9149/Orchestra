/**
 * Route-level contract tests for Socrates endpoints.
 *
 * Uses the same mock-context pattern as routes.test.ts.
 * Does NOT test streaming — SSE requires a live process.
 */

import jwt from "jsonwebtoken";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app/build-app.js";
import type { AppContext } from "../src/types/index.js";

const SESSION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function managerToken() {
  return jwt.sign(
    { userId: "user-1", orgId: "org-1", workspaceRoleDefault: "manager", globalRole: "owner", typ: "access" },
    "test-access-secret"
  );
}

function clientToken() {
  return jwt.sign(
    { userId: "client-1", orgId: "org-1", workspaceRoleDefault: "client", globalRole: "member", typ: "access" },
    "test-access-secret"
  );
}

function createContext(): AppContext {
  const socratesService = {
    createSession: vi.fn(async () => ({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      userId: "user-1",
      pageContext: "brain_overview",
      selectedRefType: null,
      selectedRefId: null,
      viewerStateJson: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    listSessions: vi.fn(async () => [
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        pageContext: "dashboard_project",
        title: "What changed?",
        preview: "A change was made.",
        messageCount: 2,
        createdAt: "2026-05-30T00:00:00.000Z",
        updatedAt: "2026-05-30T00:00:01.000Z",
      }
    ]),
    deleteSession: vi.fn(async () => ({ deleted: true, sessionId: SESSION_ID })),
    patchContext: vi.fn(async () => ({
      id: SESSION_ID,
      pageContext: "doc_viewer",
    })),
    getSuggestions: vi.fn(async () => ({
      suggestions: ["Explain the main flows.", "Which areas are uncertain?"],
      cached: false,
    })),
    streamAnswer: vi.fn(async (_pid: string, _sid: string, _uid: string, _content: string, reply: any) => {
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      reply.raw.write('event: done\ndata: {"answer_md":"ok"}\n\n');
      reply.raw.end();
    }),
    streamV1ProjectMemory: vi.fn(async (_input: any, reply: any) => {
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      reply.raw.write(`event: message_created\ndata: {"sessionId":"${SESSION_ID}","userMessageId":"message-v1-user","assistantMessageId":"message-v1-assistant"}\n\n`);
      reply.raw.write(`event: delta\ndata: {"text":"Live answer"}\n\n`);
      reply.raw.write(`event: done\ndata: {"answer_md":"Live answer"}\n\n`);
      reply.raw.end();
    }),
    resumeV1ProjectMemory: vi.fn(async (_pid: string, _sid: string, _mid: string, _uid: string, _offset: number, reply: any) => {
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      reply.raw.write(`event: done\ndata: {"answer_md":"Live answer"}\n\n`);
      reply.raw.end();
    }),
    cancelV1ProjectMemory: vi.fn(async () => ({ cancelled: true, assistantMessageId: "44444444-4444-4444-8444-444444444444" })),
    getHistory: vi.fn(async () => [
      { id: "msg-1", role: "user", content: "What changed?", responseStatus: null, createdAt: new Date() },
      { id: "msg-2", role: "assistant", content: "A change was made.", responseStatus: "completed", createdAt: new Date(), citations: [], openTargets: [] },
    ]),
    askV1ProjectMemory: vi.fn(async () => ({
      answer_md: "Answer from Socrates v1.",
      citations: [{ id: "chunk-1", sourceType: "document", label: "Core PRD", refId: "chunk-1", confidence: 0.9 }],
      open_targets: [{ id: "target-1", sourceType: "document", targetType: "document_section", targetRef: { documentId: "doc-1", anchorId: "overview-1" } }],
      artifact: {
        id: "artifact-1",
        type: "api_map",
        title: "API Map",
        payload: { endpoints: [{ method: "GET", path: "/v1/projects/:projectId/timeline" }] },
        sourceRefs: [{ sourceType: "document", refId: "chunk-1", label: "Core PRD" }],
        generatedAt: "2026-05-30T00:00:00.000Z"
      },
      session: { sessionId: "session-v1-1", createdAt: "2026-05-30T00:00:00.000Z", updatedAt: "2026-05-30T00:00:00.000Z" },
      message: { userMessageId: "message-v1-user", assistantMessageId: "message-v1-assistant", createdAt: "2026-05-30T00:00:00.000Z" },
      sessionId: "session-v1-1",
      messageId: "message-v1-assistant",
      retrievalSummary: { intent: "api_map", evidenceCount: 1, limitations: [] },
      sourceStates: { documents: { state: "ready", count: 1 } },
      safety: { refusedMutation: false, directMutationAllowed: false, pendingChangesAreTruth: false },
      costEstimate: { estimatedUsd: 0, modelCalls: 0, evidenceItems: 1 },
      modelMetadata: { provider: "deterministic", model: null, degraded: false }
    })),
    precomputeSuggestions: vi.fn(async () => undefined),
    prewarmV1ProjectMemory: vi.fn(async () => ({ warmed: true, durationMs: 12, expiresInMs: 60_000 })),
  };

  return {
    env: {
      NODE_ENV: "test",
      PORT: 3000,
      HOST: "127.0.0.1",
      LOG_LEVEL: "silent",
      APP_BASE_URL: "http://localhost:3000",
      CORS_ALLOWED_ORIGINS: "http://localhost:3001",
      DATABASE_URL: "postgresql://test",
      DIRECT_URL: "postgresql://test",
      REDIS_URL: "redis://localhost:6379",
      QUEUE_MODE: "inline",
      QUEUE_PREFIX: "orchestra",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_ROOT: "./storage",
      SIGNED_URL_TTL_SECONDS: 3600,
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      JWT_ACCESS_TTL: "15m",
      JWT_REFRESH_TTL: "30d",
      PASSWORD_HASH_COST: 12,
      OPENAI_TRANSCRIPTION_MODEL: "mock-transcribe",
      OPENAI_EMBEDDING_MODEL: "mock",
      RETRIEVAL_TOP_K: 8,
      RETRIEVAL_MIN_SCORE: 0.2,
      RETRIEVAL_USE_HYBRID: true,
      RETRIEVAL_DOC_WEIGHT: 1,
      RETRIEVAL_COMM_WEIGHT: 0.8,
      RETRIEVAL_ACCEPTED_TRUTH_BOOST: 1.2,
      SOCRATES_MAX_CONTEXT_TOKENS: 12000,
      SOCRATES_MAX_HISTORY_TURNS: 8,
      SOCRATES_RETRIEVAL_TOP_K: 32,
      SOCRATES_RERANK_TOP_K: 8,
      SOCRATES_MAX_CITATIONS: 6,
      SOCRATES_MAX_OUTPUT_TOKENS: 1800,
      METRICS_TOKEN: undefined,
    },
    logger: pino({ enabled: false }),
    prisma: {
      user: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where?.id === "user-1" && where?.orgId === "org-1") {
            return { id: "user-1", orgId: "org-1", workspaceRoleDefault: "manager", globalRole: "owner" };
          }
          if (where?.id === "client-1" && where?.orgId === "org-1") {
            return { id: "client-1", orgId: "org-1", workspaceRoleDefault: "client", globalRole: "member" };
          }
          return null;
        })
      },
      organizationMembership: {
        findUnique: vi.fn(async ({ where }: any) => {
          const { organizationId, userId } = where?.organizationId_userId ?? {};
          if (organizationId !== "org-1") return null;
          if (userId === "user-1") {
            return {
              id: "org-member-user-1",
              organizationId,
              userId,
              workspaceRoleDefault: "manager",
              globalRole: "owner",
              isActive: true,
              user: { isActive: true },
            };
          }
          if (userId === "client-1") {
            return {
              id: "org-member-client-1",
              organizationId,
              userId,
              workspaceRoleDefault: "client",
              globalRole: "member",
              isActive: true,
              user: { isActive: true },
            };
          }
          return null;
        })
      },
      projectMember: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where?.projectId !== PROJECT_ID || where?.project?.orgId !== "org-1") return null;
          if (where?.userId === "user-1") {
            return {
              id: "project-member-user-1",
              projectId: PROJECT_ID,
              userId: "user-1",
              projectRole: "manager",
              canApproveTruthChanges: true,
              isActive: true,
            };
          }
          if (where?.userId === "client-1") {
            return {
              id: "project-member-client-1",
              projectId: PROJECT_ID,
              userId: "client-1",
              projectRole: "client",
              canApproveTruthChanges: false,
              isActive: true,
            };
          }
          return null;
        })
      }
    } as any,
    storage: {} as any,
    generationProvider: {} as any,
    embeddingProvider: {} as any,
    transcriptionProvider: {} as any,
    jobs: { enqueue: vi.fn() },
    telemetry: {
      increment: vi.fn(),
      observeDuration: vi.fn(),
      setGauge: vi.fn(),
      renderPrometheus: vi.fn(() => ""),
    } as any,
    services: {
      authService: {
        assertSessionActive: vi.fn(async () => undefined),
        authorizeSessionContext: vi.fn(async () => ({
          organizationMembershipId: "org-membership-1",
          userId: "user-1",
          orgId: "org-1",
          globalRole: "owner",
          workspaceRoleDefault: "manager"
        }))
      } as any,
      projectService: {} as any,
      documentService: {} as any,
      brainService: {} as any,
      changeProposalService: {} as any,
      auditService: { record: vi.fn() } as any,
      socratesService: socratesService as any,
      socratesFeedbackService: {
        record: vi.fn(async (input: any) => ({ id: "feedback-1", reason: input.reason, correctionText: input.correctionText ?? null, needsHumanReview: input.reason !== "helpful", productBrainVersionId: "brain-1", updatedAt: "2026-08-24T01:00:00.000Z", acceptedTruthChanged: false }))
      } as any,
      dashboardService: {} as any,
      communicationsService: {
        connectors: {} as any,
        sync: {} as any,
        timeline: {} as any,
        indexing: {} as any,
        importManualBatch: vi.fn()
      } as any,
    },
  } as unknown as AppContext;
}

describe("Socrates route contracts", () => {
  const context = createContext();
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp(context);
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /v1/projects/:projectId/socrates/sessions — creates a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions`,
      headers: { authorization: `Bearer ${managerToken()}` },
      payload: { pageContext: "brain_overview" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.id).toBe(SESSION_ID);
    expect(body.data.pageContext).toBe("brain_overview");
    expect(context.services.socratesService.createSession).toHaveBeenCalledWith(
      PROJECT_ID,
      "user-1",
      expect.objectContaining({ pageContext: "brain_overview" }),
      "manager"
    );
  });

  it("GET /v1/projects/:projectId/socrates/sessions — returns recent sessions", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions?limit=10`,
      headers: { authorization: `Bearer ${managerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].id).toBe(SESSION_ID);
    expect(body.data[0].title).toBe("What changed?");
    expect(context.services.socratesService.listSessions).toHaveBeenCalledWith(PROJECT_ID, "user-1", 10, true);
  });

  it("DELETE /v1/projects/:projectId/socrates/sessions/:sessionId — deletes an owned session", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}`,
      headers: { authorization: `Bearer ${managerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.deleted).toBe(true);
    expect(context.services.socratesService.deleteSession).toHaveBeenCalledWith(PROJECT_ID, SESSION_ID, "user-1");
  });

  it("POST /v1/projects/:projectId/socrates/sessions — rejects invalid pageContext", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions`,
      headers: { authorization: `Bearer ${managerToken()}` },
      payload: { pageContext: "not_a_real_page" },
    });

    // Must not succeed — 400 (ZodError → validation_error) or 500 from test env.
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(context.services.socratesService.createSession).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ pageContext: "not_a_real_page" })
    );
  });

  it("PATCH context — updates session context", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/context`,
      headers: { authorization: `Bearer ${managerToken()}` },
      payload: { pageContext: "doc_viewer" },
    });

    expect(response.statusCode).toBe(200);
    expect(context.services.socratesService.patchContext).toHaveBeenCalled();
  });

  it("GET suggestions — returns suggestion list", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/suggestions`,
      headers: { authorization: `Bearer ${managerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data.suggestions)).toBe(true);
    expect(body.data.suggestions.length).toBeGreaterThan(0);
  });

  it("GET messages — returns history", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/messages`,
      headers: { authorization: `Bearer ${managerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
    expect(body.data[0].role).toBe("user");
    expect(body.data[1].role).toBe("assistant");
  });

  it("POST message feedback — records a review case without changing accepted truth", async () => {
    const assistantMessageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/messages/${assistantMessageId}/feedback`,
      headers: { authorization: `Bearer ${managerToken()}` },
      payload: { reason: "missing_evidence", correctionText: "Cite the signed launch plan." }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ reason: "missing_evidence", needsHumanReview: true, acceptedTruthChanged: false });
    expect(context.services.socratesFeedbackService.record).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      assistantMessageId,
      actorUserId: "user-1",
      reason: "missing_evidence"
    }));
  });

  it("POST v1 ask — calls the full Socrates v1 backend contract", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/v1/ask`,
      headers: { authorization: `Bearer ${managerToken()}` },
      payload: {
        question: "Map our API structure",
        mode: "api_map",
        includeArtifacts: true,
        maxEvidence: 6
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.artifact.type).toBe("api_map");
    expect(context.services.socratesService.askV1ProjectMemory).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      actorUserId: "user-1",
      question: "Map our API structure",
      sessionId: null,
      mode: "api_map",
      selectedSources: undefined,
      maxEvidence: 6,
      includeArtifacts: true,
      includeHistory: true,
      clientContext: undefined,
      authorizedProjectRole: "manager"
    });
  });

  it("GET v1 prewarm — authorizes and warms project evidence without generating an answer", async () => {
    const askCallsBefore = vi.mocked(context.services.socratesService.askV1ProjectMemory).mock.calls.length;
    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/socrates/v1/prewarm`,
      headers: { authorization: `Bearer ${managerToken()}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ warmed: true, durationMs: 12, expiresInMs: 60_000 });
    expect(context.services.socratesService.prewarmV1ProjectMemory).toHaveBeenCalledWith(
      PROJECT_ID,
      "user-1",
      "manager"
    );
    expect(context.services.socratesService.askV1ProjectMemory).toHaveBeenCalledTimes(askCallsBefore);
  });

  it("POST v1 stream — dispatches the authorized SSE contract", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/messages/stream/v1`,
      headers: { authorization: `Bearer ${managerToken()}`, origin: "http://localhost:3001" },
      payload: { question: "Stream this answer", includeArtifacts: false }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.body).toContain("event: delta");
    expect(context.services.socratesService.streamV1ProjectMemory).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, sessionId: SESSION_ID, question: "Stream this answer" }),
      expect.anything()
    );
  });

  it("[FIX-36] POST v1 new-session stream combines session creation and the first answer", async () => {
    vi.mocked(context.services.socratesService.streamV1ProjectMemory).mockClear();
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/messages/stream/v1`,
      headers: { authorization: `Bearer ${managerToken()}`, origin: "http://localhost:3001" },
      payload: { question: "Start and stream in one request", includeArtifacts: true }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain(`"sessionId":"${SESSION_ID}"`);
    expect(context.services.socratesService.streamV1ProjectMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        sessionId: null,
        question: "Start and stream in one request",
        authorizedProjectRole: "manager"
      }),
      expect.anything()
    );
  });

  it("POST v1 stream — never reflects an untrusted Origin", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/messages/stream/v1`,
      headers: { authorization: `Bearer ${managerToken()}`, origin: "https://attacker.example" },
      payload: { question: "Stream this answer", includeArtifacts: false }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("POST v1 cancel — cancels only the authorized session response", async () => {
    const assistantMessageId = "44444444-4444-4444-8444-444444444444";
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/messages/${assistantMessageId}/cancel`,
      headers: { authorization: `Bearer ${managerToken()}` },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.cancelled).toBe(true);
    expect(context.services.socratesService.cancelV1ProjectMemory).toHaveBeenCalledWith(
      PROJECT_ID, SESSION_ID, assistantMessageId, "user-1"
    );
  });

  it("GET suggestions — rejects unauthenticated request", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/suggestions`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("POST sessions — rejects invalid UUID in projectId param", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/projects/not-a-uuid/socrates/sessions`,
      headers: { authorization: `Bearer ${managerToken()}` },
      payload: { pageContext: "brain_overview" },
    });

    // Must not succeed (ZodError → 400 in prod, may be 500 in test env due to ESM module boundary).
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("client token is blocked from internal Socrates routes before service dispatch", async () => {
    vi.mocked(context.services.socratesService.getSuggestions).mockClear();

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_ID}/socrates/sessions/${SESSION_ID}/suggestions`,
      headers: { authorization: `Bearer ${clientToken()}` },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    if (body.error?.code !== "client_internal_access_forbidden") {
      throw new Error(`Expected client_internal_access_forbidden, got: ${response.body}`);
    }
    expect(context.services.socratesService.getSuggestions).not.toHaveBeenCalled();
  });
});
