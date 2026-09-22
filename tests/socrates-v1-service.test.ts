import { describe, expect, it, vi } from "vitest";
import { buildSocratesV1EvidenceExcerpt, SocratesService } from "../src/modules/socrates/service.js";
import type { AppEnv } from "../src/config/env.js";

// The storage boundary is exercised against SQL separately; retain the service
// suite's existing durable-write controls, including the deferred-write test.
vi.mock("../src/modules/socrates/turn-store.js", () => ({
  createSocratesTurn: (prisma: any, input: any) => prisma.socratesSession.create({
    data: { projectId: input.projectId, userId: input.userId, pageContext: "dashboard_project", viewerStateJson: input.viewerState,
      messages: { create: [{role:"user",content:input.question},{role:"assistant",content:"",responseStatus:"streaming"}] } },
    include: { messages: { select: {id:true,role:true} } }
  })
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const USER_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const ASSISTANT_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";

function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some((item) => containsUndefined(item));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => containsUndefined(item));
  }
  return false;
}

function makeEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
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
    OPENAI_EMBEDDING_MODEL: "mock",
    RETRIEVAL_TOP_K: 8,
    RETRIEVAL_MIN_SCORE: 0.2,
    RETRIEVAL_USE_HYBRID: true,
    RETRIEVAL_DOC_WEIGHT: 1,
    RETRIEVAL_COMM_WEIGHT: 0.8,
    RETRIEVAL_ACCEPTED_TRUTH_BOOST: 1.2,
    SOCRATES_MODEL: "mock",
    SOCRATES_ESCALATION_MODEL: "mock-escalation",
    SOCRATES_ROUTER_MODEL: "mock-router",
    SOCRATES_MODEL_FAST: "mock",
    SOCRATES_MODEL_HIGH_QUALITY: "mock-escalation",
    SOCRATES_MODEL_FALLBACK: "mock-escalation",
    SOCRATES_CLASSIFIER_MODEL: "mock",
    SOCRATES_SUMMARY_MODEL: "mock",
    VSCODE_SOCRATES_MODEL: "mock",
    SOCRATES_MODEL_STRATEGY: "fast",
    SOCRATES_ESCALATE_ON_LOW_CONFIDENCE: true,
    SOCRATES_ESCALATE_ON_MULTI_SOURCE_CONFLICT: true,
    SOCRATES_ESCALATE_ON_ARTIFACT_GENERATION: true,
    SOCRATES_ENABLE_MODEL_FALLBACK: true,
    SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE: true,
    SOCRATES_MAX_CONTEXT_TOKENS: 12000,
    SOCRATES_MAX_HISTORY_TURNS: 8,
    SOCRATES_RETRIEVAL_TOP_K: 32,
    SOCRATES_RERANK_TOP_K: 8,
    SOCRATES_MAX_RETRIEVAL_CANDIDATES: 64,
    SOCRATES_MAX_RERANK_CANDIDATES: 32,
    SOCRATES_MAX_EVIDENCE_ITEMS: 10,
    SOCRATES_MAX_EVIDENCE_EXCERPT_CHARS: 900,
    SOCRATES_MAX_SAME_SOURCE_ITEMS: 2,
    SOCRATES_MAX_CITATIONS: 6,
    SOCRATES_MAX_OPEN_TARGETS: 6,
    SOCRATES_MAX_SAME_SOURCE_CITATIONS: 2,
    SOCRATES_MAX_REPAIR_ATTEMPTS: 1,
    SOCRATES_MAX_OUTPUT_TOKENS: 1800,
    SOCRATES_MAX_ANSWER_CHARS: 8000,
    SOCRATES_GENERATION_TIMEOUT_MS: 30000,
    SOCRATES_RETRIEVAL_TIMEOUT_MS: 5000,
    SOCRATES_MAX_REQUESTS_PER_USER_PER_WINDOW: 120,
    SOCRATES_MAX_REQUESTS_PER_PROJECT_PER_WINDOW: 1000,
    SOCRATES_RATE_LIMIT_WINDOW_MS: 60000,
    SOCRATES_MAX_CONCURRENT_STREAMS_PER_USER: 3,
    SOCRATES_MAX_CONCURRENT_STREAMS_PER_PROJECT: 20,
    SOCRATES_MAX_DAILY_COST_PER_PROJECT: 0,
    SOCRATES_MAX_DAILY_COST_PER_USER: 0,
    SOCRATES_RERANK_PROVIDER: "deterministic",
    SOCRATES_RERANK_MODEL: "mock",
    SOCRATES_RERANK_MIN_CANDIDATES: 4,
    SOCRATES_RERANK_MAX_CANDIDATES: 32,
    SOCRATES_RERANK_TIMEOUT_MS: 10000,
    SOCRATES_RERANK_MAX_COST_PER_QUERY: 0,
    ...overrides
  } as AppEnv;
}

function makeService(
  envOverrides: Partial<AppEnv> = {},
  generatedAnswer?: Record<string, unknown>,
  aiLimiter?: any
) {
  let messageCreateCount = 0;
  const tx = {
    socratesMessage: {
      update: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 }))
    },
    socratesCitation: {
      create: vi.fn(async () => undefined),
      createMany: vi.fn(async () => ({ count: 1 }))
    },
    socratesOpenTarget: {
      create: vi.fn(async () => undefined),
      createMany: vi.fn(async () => ({ count: 1 }))
    }
  };
  const prisma: any = {
    $transaction: vi.fn(async (callback: any) => callback(tx)),
    project: {
      findUniqueOrThrow: vi.fn(async () => ({ id: PROJECT_ID, orgId: ORG_ID, name: "Orchestra MVP" }))
    },
    socratesSession: {
      create: vi.fn(async ({ data }: any) => ({
        id: SESSION_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        pageContext: "dashboard_project",
        createdAt: new Date("2026-05-30T10:00:00.000Z"),
        updatedAt: new Date("2026-05-30T10:00:00.000Z"),
        ...(data.messages ? {
          messages: [
            { id: USER_MESSAGE_ID, role: "user" },
            { id: ASSISTANT_MESSAGE_ID, role: "assistant" }
          ]
        } : {})
      })),
      update: vi.fn(async ({ data }: any = {}) => ({
        id: SESSION_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
        pageContext: "dashboard_project",
        createdAt: new Date("2026-05-30T10:00:00.000Z"),
        updatedAt: new Date("2026-05-30T10:00:01.000Z"),
        ...(data?.messages ? {
          messages: [
            { id: USER_MESSAGE_ID, role: "user" },
            { id: ASSISTANT_MESSAGE_ID, role: "assistant" }
          ]
        } : {})
      })),
      findFirst: vi.fn()
    },
    socratesMessage: {
      update: vi.fn(async () => undefined),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: any) => {
        messageCreateCount += 1;
        if (data.role === "user" && messageCreateCount === 1) return { id: USER_MESSAGE_ID, role: "user" };
        if (data.role === "assistant" && messageCreateCount === 2) return { id: ASSISTANT_MESSAGE_ID, role: "assistant" };
        return {
          id: `77777777-7777-4777-8777-${String(messageCreateCount).padStart(12, "0")}`,
          role: data.role
        };
      }),
      findMany: vi.fn(async () => [
        {
          id: "77777777-7777-4777-8777-777777777777",
          role: "user",
          content: "Summarize this week",
          createdAt: new Date("2026-05-29T10:00:00.000Z"),
          session: { user: { id: USER_ID, displayName: "Karthik", email: "k@example.com" } }
        }
      ])
    },
    documentChunk: {
      findMany: vi.fn(async () => [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          content: "The backend exposes /v1/projects/:projectId/timeline and /v1/projects/:projectId/mission-control.",
          lexicalContent: "backend api routes timeline mission control",
          chunkIndex: 0,
          pageNumber: 2,
          documentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          section: {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            anchorId: "api-routes",
            headingPath: ["Backend API"],
            pageNumber: 2
          },
          documentVersion: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            document: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Backend Contract", currentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
          },
          createdAt: new Date("2026-05-28T10:00:00.000Z")
        }
      ]),
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
          return {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            projectId: PROJECT_ID,
            documentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            sectionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
          };
        }
        return null;
      })
    },
    projectNotionResource: {
      findMany: vi.fn(async () => [])
    },
    documentSection: {
      findMany: vi.fn(async () => [
        {
          id: "15151515-1515-4151-8151-151515151515",
          documentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          projectId: PROJECT_ID,
          headingPath: ["Sales dataset", "Dataset profile"],
          anchorId: "sales-dataset-profile",
          pageNumber: null,
          normalizedText: [
            "Dataset analysis profile: Sales dataset",
            "Rows: 3 data rows",
            "Columns: 3",
            "Column profile:",
            "- region: text; non-empty 3; missing 0; distinct sample 2; top values APAC (2), EMEA (1)",
            "- revenue: number; non-empty 3; missing 0; distinct sample 3; min 100, max 300, avg 200, sum 600",
            "- status: text; non-empty 2; missing 1; distinct sample 2; top values won (1), open (1)"
          ].join("\n"),
          metadataJson: {
            datasetProfileKind: "tabular",
            datasetProfile: {
              profileVersion: 1,
              title: "Sales dataset",
              sourceType: "csv",
              sheetName: null,
              dataRowCount: 3,
              scannedDataRowCount: 3,
              sampled: false,
              columnCount: 3,
              columns: [
                { name: "region", inferredType: "text", nonEmptyCount: 3, missingCount: 0, distinctSampleCount: 2, examples: ["APAC", "EMEA"], topValues: [{ value: "APAC", count: 2 }, { value: "EMEA", count: 1 }] },
                { name: "revenue", inferredType: "number", nonEmptyCount: 3, missingCount: 0, distinctSampleCount: 3, examples: ["100", "200"], topValues: [{ value: "100", count: 1 }], numeric: { count: 3, min: 100, max: 300, sum: 600, average: 200 } },
                { name: "status", inferredType: "text", nonEmptyCount: 2, missingCount: 1, distinctSampleCount: 2, examples: ["won", "open"], topValues: [{ value: "open", count: 1 }, { value: "won", count: 1 }] }
              ],
              limitations: ["Dataset profile is complete for this fixture."]
            }
          },
          documentVersion: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            document: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Sales dataset", currentVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
          },
          createdAt: new Date("2026-05-28T10:00:00.000Z")
        }
      ])
    },
    communicationMessageChunk: {
      findMany: vi.fn(async () => [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          messageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          threadId: "12121212-1212-4121-8121-121212121212",
          connectorId: "34343434-3434-4343-8343-343434343434",
          provider: "slack",
          content: "Slack discussion says the API map should cite real routes and avoid fabricated demo data.",
          lexicalContent: "slack api map cite real routes avoid fabricated",
          message: {
            senderLabel: "Adi",
            provider: "slack",
            sentAt: new Date("2026-05-30T09:00:00.000Z"),
            providerPermalink: "https://slack.example/archives/C1/p1",
            isDeletedByProvider: false
          },
          thread: { subject: "Socrates", rawMetadataJson: { channelName: "mvp-build", channelId: "C1" } },
          connector: { provider: "slack", accountLabel: "Orchestra Slack", configJson: { teamName: "Orchestra", teamId: "T1" } },
          createdAt: new Date("2026-05-30T09:00:00.000Z")
        }
      ])
    },
    communicationThread: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id === "12121212-1212-4121-8121-121212121212") {
          return { id: where.id, projectId: PROJECT_ID, subject: "Socrates" };
        }
        return null;
      })
    },
    communicationMessage: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.id === "ffffffff-ffff-4fff-8fff-ffffffffffff") {
          return {
            id: where.id,
            projectId: PROJECT_ID,
            threadId: "12121212-1212-4121-8121-121212121212"
          };
        }
        return null;
      })
    },
    projectEvent: {
      findMany: vi.fn(async () => [
        {
          id: "56565656-5656-4565-8565-565656565656",
          title: "Manager review checkpoint",
          description: "Manual event for release review",
          eventType: "milestone",
          source: "manual",
          startsAt: new Date("2026-05-30T08:00:00.000Z"),
          createdAt: new Date("2026-05-30T08:00:00.000Z"),
          creator: { id: USER_ID, displayName: "Karthik", email: "k@example.com", workspaceRoleDefault: "manager" }
        }
      ])
    },
    specChangeProposal: {
      findMany: vi.fn(async () => [
        {
          id: "78787878-7878-4787-8787-787878787878",
          title: "Pending Slack-derived copy change",
          summary: "Needs manager review before becoming truth.",
          status: "needs_review",
          proposalType: "clarification",
          sourceMessageCount: 1,
          createdAt: new Date("2026-05-30T07:00:00.000Z"),
          updatedAt: new Date("2026-05-30T07:00:00.000Z"),
          acceptedAt: null,
          accepter: null,
          links: []
        }
      ])
    },
    liveDocSectionRevision: {
      findMany: vi.fn(async () => [
        {
          id: "89898989-8989-4898-8989-898989898989",
          proposalId: "90909090-9090-4909-8909-909090909090",
          sectionKey: "release.scope",
          documentSectionId: null,
          eventType: "proposal_accepted",
          previousContent: "Old scope",
          nextContent: "Accepted release scope",
          changeSummary: "Accepted scope update",
          createdAt: new Date("2026-05-30T06:00:00.000Z"),
          actor: { id: USER_ID, displayName: "Karthik", email: "k@example.com", workspaceRoleDefault: "manager" },
          proposal: { id: "90909090-9090-4909-8909-909090909090", title: "Accepted scope update", summary: "Accepted", links: [] }
        }
      ])
    },
    projectMember: {
      findMany: vi.fn(async () => [
        {
          id: "abababab-abab-4aba-8aba-abababababab",
          userId: USER_ID,
          projectRole: "manager",
          roleInProject: "Auth owner",
          canApproveTruthChanges: true,
          user: { id: USER_ID, displayName: "Karthik", email: "k@example.com" }
        }
      ])
    },
    projectResponsibility: {
      findMany: vi.fn(async () => [
        {
          id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd",
          title: "Own auth module",
          description: "Responsible for auth and onboarding flows",
          area: "engineering",
          status: "open",
          assigneeName: null,
          member: {
            id: "abababab-abab-4aba-8aba-abababababab",
            user: { id: USER_ID, displayName: "Karthik", email: "k@example.com" }
          }
        }
      ])
    },
    projectSubscription: {
      findMany: vi.fn(async () => [
        {
          id: "efefefef-efef-4efe-8efe-efefefefefef",
          projectId: PROJECT_ID,
          name: "Supabase",
          category: "database",
          cost: { toString: () => "25.00" },
          billingType: "monthly",
          status: "active",
          provider: "Supabase",
          renewsAt: null,
          createdAt: new Date("2026-05-25T10:00:00.000Z")
        }
      ])
    },
    gitHubEngineeringEvidence: {
      findMany: vi.fn(async () => [])
    },
    projectEditorConnector: {
      findMany: vi.fn(async () => [
        {
          id: "13131313-1313-4131-8131-131313131313",
          projectId: PROJECT_ID,
          label: "Karthik VS Code",
          status: "connected",
          lastUsedAt: new Date("2026-05-30T05:00:00.000Z"),
          user: { id: USER_ID, displayName: "Karthik", email: "k@example.com" }
        }
      ])
    }
  };
  const projectService: any = {
    ensureProjectAccess: vi.fn(async () => ({ projectRole: "manager", isActive: true })),
    ensureProjectMemberCanUseSocrates: vi.fn(async () => ({ projectRole: "manager", isActive: true }))
  };
  const auditService: any = { record: vi.fn(async () => undefined) };
  const generationProvider = {
    generateObject: vi.fn(async ({ fallback, schema }: any) => generatedAnswer
      ? schema.parse(generatedAnswer)
      : fallback()),
    streamText: vi.fn(async ({ fallback, onDelta, signal }: any) => {
      if (signal?.aborted) throw signal.reason;
      const answer = typeof generatedAnswer?.answer_md === "string" ? generatedAnswer.answer_md : fallback();
      const midpoint = Math.max(1, Math.floor(answer.length / 2));
      await onDelta(answer.slice(0, midpoint));
      await onDelta(answer.slice(midpoint));
      return answer;
    })
  };
  const service = new SocratesService(
    prisma,
    makeEnv(envOverrides),
    generationProvider as any,
    { embedText: vi.fn(async () => new Array(1536).fill(0.1)) } as any,
    projectService,
    auditService,
    undefined,
    undefined,
    aiLimiter
  );
  return { service, prisma, tx, projectService, auditService, generationProvider };
}

function configureMultiDocumentEvidence(prisma: any, includeSecondDocument = true) {
  const documents = [
    { id: "10000000-0000-4000-8000-000000000001", title: "Alpha Launch PRD" },
    { id: "10000000-0000-4000-8000-000000000002", title: "Beta Validation PRD" }
  ];
  const rows = Array.from({ length: includeSecondDocument ? 11 : 10 }, (_, index) => {
    const document = documents[index < 10 ? 0 : 1]!;
    const versionId = `version-${document.id}`;
    return {
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      content: index < 10 ? "Launch requirements and exclusions: CSV export is required." : "Only email sign-in is permitted.",
      chunkIndex: index,
      documentVersionId: versionId,
      section: { anchorId: `section-${index}`, headingPath: ["Scope"] },
      documentVersion: { id: versionId, status: "ready", document: { ...document, currentVersionId: versionId } },
      createdAt: new Date("2026-05-28T10:00:00.000Z")
    };
  });
  prisma.document = { findMany: vi.fn(async () => documents) };
  prisma.$queryRaw = vi.fn(async () => rows.map(({ id }) => ({ id })));
  prisma.documentChunk.findMany = vi.fn(async ({ where }: any) => where.id?.in
    ? rows.filter((row) => where.id.in.includes(row.id))
    : rows);
  return { documents, rows };
}

describe("Socrates cached document freshness", () => {
  function fixture() {
    const { service, prisma } = makeService();
    const row = {
      id: "freshness-chunk", projectId: PROJECT_ID, documentVersionId: "freshness-version",
      content: "CSV export is required.", lexicalContent: "csv export required", parseRevision: 1,
      section: { anchorId: "scope", headingPath: ["Scope"] },
      documentVersion: { id: "freshness-version", status: "ready", parseRevision: 1,
        document: { id: "freshness-document", title: "Launch PRD", archivedAt: null, currentVersionId: "freshness-version" } }
    };
    let stored = [structuredClone(row)];
    prisma.documentChunk.findMany.mockImplementation(async ({ where }: any) => structuredClone(stored.filter((item) =>
      item.projectId === where.projectId && item.documentVersion.document.archivedAt === null &&
      (!where.id?.in || where.id.in.includes(item.id))
    )));
    const retrieve = () => (service as any).findSocratesV1DocumentEvidence(PROJECT_ID, "what is this project", false);
    return { service, prisma, row, retrieve, replace: (rows: typeof stored) => { stored = rows; } };
  }

  it("excludes archived or deleted documents immediately without reloading cached content", async () => {
    const { prisma, retrieve, replace } = fixture();
    expect(await retrieve()).toHaveLength(1);
    replace([]);
    expect(await retrieve()).toEqual([]);
    expect(prisma.documentChunk.findMany.mock.calls.filter(([args]: any) => args.include)).toHaveLength(1);
  });

  it.each(["version", "parse", "status"])("rejects a cached row after its current %s changes", async (change) => {
    const { row, retrieve, replace } = fixture();
    expect(await retrieve()).toHaveLength(1);
    const latest = structuredClone(row);
    if (change === "version") latest.documentVersion.document.currentVersionId = "new-version";
    if (change === "parse") latest.documentVersion.parseRevision = 2;
    if (change === "status") latest.documentVersion.status = "failed";
    replace([latest]);
    expect(await retrieve()).toEqual([]);
  });

  it("does not let an in-flight old load restore archived evidence to the next answer", async () => {
    const { prisma, row, retrieve, replace } = fixture();
    let release!: (rows: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { release = resolve; });
    prisma.documentChunk.findMany.mockImplementationOnce(() => pending);
    const reading = retrieve();
    await vi.waitFor(() => expect(prisma.documentChunk.findMany).toHaveBeenCalled());
    replace([]);
    release([row]);
    expect(await reading).toEqual([]);
    expect(await retrieve()).toEqual([]);
  });

  it("fails closed when fresh eligibility cannot be read", async () => {
    const { prisma, retrieve } = fixture();
    await retrieve();
    prisma.documentChunk.findMany.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(retrieve()).rejects.toThrow("database unavailable");
  });

  it("keeps unchanged content cached while checking project-scoped metadata", async () => {
    const { prisma, retrieve } = fixture();
    expect(await retrieve()).toHaveLength(1);
    expect(await retrieve()).toHaveLength(1);
    const reads = prisma.documentChunk.findMany.mock.calls.map(([args]: any) => args);
    expect(reads.filter((args: any) => args.include)).toHaveLength(1);
    const checks = reads.filter((args: any) => args.select);
    expect(checks).toHaveLength(2);
    expect(checks.every((args: any) => args.where.projectId === PROJECT_ID && args.where.documentVersion.document.archivedAt === null)).toBe(true);
    expect(checks.every((args: any) => !args.select.content && !args.select.lexicalContent)).toBe(true);
  });
});

describe("SocratesService.askV1ProjectMemory", () => {
  it.each([
    { selectedSources: ["documents"] },
    { selectedSources: ["all"] },
    { selectedSources: undefined }
  ])("preserves each named document before chunk and answer caps for source scope %j", async ({ selectedSources }) => {
    const { service, prisma, generationProvider } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key" },
      { answer_md: "Alpha requires export [E1]. Beta permits email sign-in [E2].", confidence: "high", limitations: [], suggested_prompts: [] }
    );
    const { rows } = configureMultiDocumentEvidence(prisma);
    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "Compare Alpha Launch PRD and Beta Validation PRD requirements and exclusions.",
      selectedSources, maxEvidence: 2, includeArtifacts: false, includeHistory: false
    });
    const prompt = String(generationProvider.generateObject.mock.calls[0]?.[0]?.prompt);
    expect(prompt).toContain("explicitDocumentScope: Alpha Launch PRD");
    expect(prompt).toContain("explicitDocumentScope: Beta Validation PRD");
    expect(result.citations.map((citation) => citation.refId)).toEqual([rows[0]!.id, rows[10]!.id]);
    expect(result.modelMetadata.degraded).toBe(false);
  });

  it.each([
    { includeSecondDocument: false, maxEvidence: 2 },
    { includeSecondDocument: true, maxEvidence: 1 }
  ])("abstains when a named comparison lacks complete document coverage: %j", async ({ includeSecondDocument, maxEvidence }) => {
    const { service, prisma, generationProvider } = makeService({ OPENAI_API_KEY: "sk-test-openai-key" });
    configureMultiDocumentEvidence(prisma, includeSecondDocument);
    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "Compare Alpha Launch PRD and Beta Validation PRD requirements and exclusions.",
      maxEvidence, includeArtifacts: false, includeHistory: false
    });
    expect(result.answer_md).toContain("don't have enough evidence from every explicitly requested document");
    expect(result.answer_md).toContain("Beta Validation PRD");
    expect(result.confidence).toBe("low");
    expect(result.costEstimate.modelCalls).toBe(0);
    expect(generationProvider.generateObject).not.toHaveBeenCalled();
  });

  it("preserves distinct document coverage for unscoped document summaries", async () => {
    const { service, prisma, generationProvider } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key" },
      { answer_md: "Export is required [E1]. Email sign-in is permitted [E2].", confidence: "high", limitations: [], suggested_prompts: [] }
    );
    configureMultiDocumentEvidence(prisma);
    await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "Summarize uploaded project documents requirements and exclusions.",
      selectedSources: ["documents"], maxEvidence: 2, includeArtifacts: false, includeHistory: false
    });
    const prompt = String(generationProvider.generateObject.mock.calls[0]?.[0]?.prompt);
    expect(prompt).toContain("title: Alpha Launch PRD");
    expect(prompt).toContain("title: Beta Validation PRD");
  });

  it("preserves complete source lists and acceptance sentences instead of cutting arbitrary windows", () => {
    const content = [
      "Northstar launch requirements. Demo project.",
      "Synthetic product-demo content. Northstar is a fictional team analytics product.",
      "This document is source evidence, not automatically accepted Product Brain truth.",
      "Team leads spend their Monday mornings assembling status updates from scattered project information.",
      "Northstar creates a weekly summary they can review and share.",
      "Launch scope: Email and password sign-in. A project overview. Weekly summaries.",
      "CSV export with item_id, title, owner and status columns.",
      "Google sign-in, PDF export and automated email delivery are outside the launch scope.",
      "Any change requires product-owner approval.",
      "Acceptance criteria: CSV export includes only the selected project. All four columns are present.",
      "Unauthorized users cannot export another project.",
      "Empty projects return column headers without invented rows.",
      "The product lead approves scope. Engineering implements approved requirements.",
      "QA verifies tenant isolation and export accuracy. Deployment evidence is recorded separately."
    ].join("\n");
    const result = buildSocratesV1EvidenceExcerpt(content,
      "According to Northstar-Launch-PRD, what is in launch scope, is PDF export included, and what are the CSV acceptance criteria? Cite the document.", 800);
    expect(result.length).toBeLessThanOrEqual(800);
    expect(result).toContain("CSV export with item_id, title, owner and status columns.");
    expect(result).toContain("Google sign-in, PDF export and automated email delivery are outside the launch scope.");
    expect(result).toContain("Acceptance criteria: CSV export includes only the selected project.");
    const focused = buildSocratesV1EvidenceExcerpt(content,
      "From Northstar-Launch-PRD, list the exact CSV columns and all CSV acceptance criteria, including empty-project behavior. Cite the source and do not infer missing details.", 800);
    expect(focused).toContain("Empty projects return column headers without invented rows.");
    // PDF extraction wraps sentences mid-line and does not punctuate headings.
    const pdfText = content.replace("Northstar launch requirements. Demo project.",
      "ORCHESTRA / SYNTHETIC DEMO\nNorthstar launch requirements\nDemo project")
      .replace("Launch scope:", "Launch scope\n")
      .replace("Acceptance criteria:", "Acceptance criteria\n")
      .replace("title, owner", "title,\nowner")
      .replace("users cannot", "users\ncannot");
    const pdfResult = buildSocratesV1EvidenceExcerpt(pdfText,
      "From Northstar-Launch-PRD, list the exact CSV columns and all CSV acceptance criteria, including empty-project behavior. Cite the source and do not infer missing details.", 800, "Northstar-Launch-PRD");
    expect(pdfResult).toContain("Empty projects return column headers without invented rows.");
    const normalizedPdfResult = pdfResult.replace(/\s+/g, " ");
    expect(normalizedPdfResult).toContain("item_id, title, owner and status columns.");
    expect(normalizedPdfResult).toContain("CSV export includes only the selected project.");
    expect(normalizedPdfResult).toContain("All four columns are present.");
    expect(normalizedPdfResult).toContain("Unauthorized users cannot export another project.");
    expect(pdfResult.length).toBeLessThanOrEqual(800);
  });
  it("keeps separated answer-bearing regions inside the fixed prompt excerpt budget", () => {
    const filler = " background context".repeat(70);
    const result = buildSocratesV1EvidenceExcerpt(
      `Overview.${filler} Product Lead: Maya Reddy.${filler} Backend Lead: Devraj Patel.${filler} Non-goals: no provider writes or fabricated evidence.`,
      "Who are the Product Lead and Backend Lead? State the non-goals.",
      900
    );

    expect(result).toContain("Maya Reddy");
    expect(result).toContain("Devraj Patel");
    expect(result).toContain("no provider writes");
  });

  it("isolates an exact named PRD, abstains when it has no chunk, and retains explicitly requested GitHub evidence", async () => {
    const { service, prisma, generationProvider } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key", SOCRATES_MODEL: "gpt-5.4-mini" },
      { answer_md: "The named PRD and GitHub evidence are distinct sources. [E1] [E2]", confidence: "high", limitations: [], suggested_prompts: [] }
    );
    const deliveryId = "10000000-0000-4000-8000-000000000001";
    const qaId = "10000000-0000-4000-8000-000000000002";
    const deliveryChunkId = "10000000-0000-4000-8000-000000000003";
    const qaChunkId = "10000000-0000-4000-8000-000000000004";
    const deliveryNonGoalsChunkId = "10000000-0000-4000-8000-000000000005";
    const deliveryRequirementsChunkId = "10000000-0000-4000-8000-000000000006";
    const longContext = " retained background context".repeat(80);
    const rows = [
      { id: deliveryChunkId, content: `Product Lead: Maya Reddy. Backend Lead: Devraj Patel.${longContext} Non-goals: no provider writes or fabricated evidence.`, lexicalContent: "product lead maya reddy backend lead devraj patel non goals provider writes fabricated evidence", chunkIndex: 0, documentVersionId: "delivery-version", section: { id: "delivery-section", anchorId: "owners", headingPath: ["Owners"] }, documentVersion: { id: "delivery-version", document: { id: deliveryId, title: "Orchestra test Delivery PRD", currentVersionId: "delivery-version" } }, createdAt: new Date("2026-05-01T00:00:00Z") },
      { id: deliveryNonGoalsChunkId, content: "Non-goals: no provider writes, AutoBrain, private folders, or fabricated evidence.", lexicalContent: "non goals no provider writes autobrain private folders fabricated evidence", chunkIndex: 1, documentVersionId: "delivery-version", section: { id: "delivery-nongoals", anchorId: "non-goals", headingPath: ["Non-goals"] }, documentVersion: { id: "delivery-version", document: { id: deliveryId, title: "Orchestra test Delivery PRD", currentVersionId: "delivery-version" } }, createdAt: new Date("2026-05-01T00:00:00Z") },
      { id: deliveryRequirementsChunkId, content: "Requirements are evidence-backed and do not imply implementation is complete.", lexicalContent: "requirements evidence backed implementation complete", chunkIndex: 2, documentVersionId: "delivery-version", section: { id: "delivery-requirements", anchorId: "requirements", headingPath: ["Requirements"] }, documentVersion: { id: "delivery-version", document: { id: deliveryId, title: "Orchestra test Delivery PRD", currentVersionId: "delivery-version" } }, createdAt: new Date("2026-05-01T00:00:00Z") },
      { id: qaChunkId, content: "Product Lead: Asha Raman. Backend Lead: Dev Patel.", lexicalContent: "product lead asha raman backend lead dev patel", chunkIndex: 0, documentVersionId: "qa-version", section: { id: "qa-section", anchorId: "owners", headingPath: ["Owners"] }, documentVersion: { id: "qa-version", document: { id: qaId, title: "OrchestraOS-Delivery-QA-PRD", currentVersionId: "qa-version" } }, createdAt: new Date("2026-06-01T00:00:00Z") }
    ];
    prisma.document = { findMany: vi.fn(async () => [{ id: deliveryId, title: "Orchestra test Delivery PRD" }, { id: qaId, title: "OrchestraOS-Delivery-QA-PRD" }]) };
    let indexedIds = [deliveryChunkId, deliveryNonGoalsChunkId, deliveryRequirementsChunkId];
    prisma.$queryRaw = vi.fn(async (sql: { values?: unknown[] }) => (
      sql.values?.includes(deliveryId) ? indexedIds.map((id) => ({ id })) : []
    ));
    prisma.documentChunk.findMany = vi.fn(async ({ where }: any) => where.id?.in ? rows.filter((row) => where.id.in.includes(row.id)) : rows);
    prisma.gitHubEngineeringEvidence.findMany = vi.fn(async () => [{ id: "github-evidence", projectId: PROJECT_ID, evidenceType: "github_commit", evidenceStatus: "active", title: "fix: delivery lead API", summary: "GitHub implementation evidence says Product Lead: Asha Raman. Commit evidence only; not a PRD requirement.", repositoryOwner: "org", repositoryName: "repo", branch: "main", sha: "abc123", occurredAt: new Date("2026-06-02T00:00:00Z"), createdAt: new Date("2026-06-02T00:00:00Z"), mappedUser: null }]);

    await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "In the \"Orchestra test Delivery PRD\", who are the Product Lead and Backend Lead? State the non-goals.", selectedSources: ["documents"], includeArtifacts: false, includeHistory: false });
    const scopedPrompt = String(generationProvider.generateObject.mock.calls[0][0].prompt);
    expect(scopedPrompt).toContain("Maya Reddy");
    expect(scopedPrompt).toContain("Devraj Patel");
    expect(scopedPrompt).not.toContain("Asha Raman");

    indexedIds = [];
    const absent = await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "Compare Orchestra test Delivery PRD with GitHub implementation evidence.", selectedSources: ["documents", "github"], includeArtifacts: false, includeHistory: false });
    expect(absent.answer_md).toMatch(/don't have enough evidence in the explicitly requested document/i);
    expect(absent.answer_md).not.toMatch(/Asha Raman|Dev Patel/);

    indexedIds = [deliveryChunkId, deliveryNonGoalsChunkId, deliveryRequirementsChunkId];
    await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "Compare Orchestra test Delivery PRD with GitHub implementation evidence.", selectedSources: ["documents", "github"], maxEvidence: 2, includeArtifacts: false, includeHistory: false });
    const comparisonPrompt = String(generationProvider.generateObject.mock.calls.at(-1)?.[0].prompt);
    expect(comparisonPrompt).toContain("explicitDocumentScope: Orchestra test Delivery PRD");
    expect(comparisonPrompt).toContain("fix: delivery lead API");
    expect(comparisonPrompt).toContain("### Evidence E1");
    expect(comparisonPrompt).toContain("### Evidence E2");

    const callsBeforeOneSlot = generationProvider.generateObject.mock.calls.length;
    const oneSlot = await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "Compare Orchestra test Delivery PRD with GitHub implementation evidence.", selectedSources: ["documents", "github"], maxEvidence: 1, includeArtifacts: false, includeHistory: false });
    expect(oneSlot.answer_md).toMatch(/comparison.*evidence budget.*one item/i);
    expect(generationProvider.generateObject.mock.calls).toHaveLength(callsBeforeOneSlot);

    await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "In Orchestra test Delivery PRD, who are the Product Lead and Backend Lead?", selectedSources: ["all"], includeArtifacts: false, includeHistory: false });
    const allSourcesPrompt = String(generationProvider.generateObject.mock.calls.at(-1)?.[0].prompt);
    expect(allSourcesPrompt).toContain("Maya Reddy");
    expect(allSourcesPrompt).not.toContain("fix: delivery lead API");
    expect(allSourcesPrompt).not.toContain("Asha Raman");
    expect(prisma.$queryRaw.mock.calls.some(([sql]: [{ values?: unknown[] }]) => sql.values?.includes(deliveryId))).toBe(true);

    generationProvider.generateObject.mockRejectedValueOnce(new Error("staging provider unavailable"));
    const failedSynthesis = await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "In Orchestra test Delivery PRD, who are the Product Lead and Backend Lead? State the non-goals.", selectedSources: ["documents"], includeArtifacts: false, includeHistory: false });
    expect(failedSynthesis.modelMetadata).toMatchObject({ provider: "deterministic", degraded: true });
    expect(failedSynthesis.answer_md).toContain("## Evidence-only fallback");
    expect(failedSynthesis.answer_md).toContain("Maya Reddy");
    expect(failedSynthesis.answer_md).toContain("Devraj Patel");
    expect(failedSynthesis.answer_md).toContain("no provider writes");
    expect(failedSynthesis.answer_md).not.toContain("Asha Raman");

    const callsBeforeNoKey = generationProvider.generateObject.mock.calls.length;
    delete (service as any).env.OPENAI_API_KEY;
    const noKeySynthesis = await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "In Orchestra test Delivery PRD, who are the Product Lead and Backend Lead? State the non-goals.", selectedSources: ["documents"], includeArtifacts: false, includeHistory: false });
    expect(noKeySynthesis.modelMetadata).toMatchObject({ provider: "deterministic", degraded: true });
    expect(noKeySynthesis.answer_md).toContain("## Evidence-only fallback");
    expect(noKeySynthesis.answer_md).toContain("Maya Reddy");
    expect(noKeySynthesis.answer_md).toContain("Devraj Patel");
    expect(noKeySynthesis.answer_md).toContain("no provider writes");
    expect(noKeySynthesis.answer_md).not.toContain("Asha Raman");
    expect(generationProvider.generateObject.mock.calls).toHaveLength(callsBeforeNoKey);
  });

  it("applies service-level limits to non-route callers and releases concurrency", async () => {
    const limiter = {
      checkRequestLimit: vi.fn(async () => ({ allowed: false, code: "socrates_rate_limited" })),
      acquireConcurrent: vi.fn(),
      releaseConcurrent: vi.fn(),
      checkDailyCost: vi.fn(),
      checkDailyCosts: vi.fn()
    };
    const { service, prisma } = makeService({}, undefined, limiter);
    await expect(service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize project memory"
    })).rejects.toMatchObject({ code: "socrates_rate_limited", statusCode: 429 });
    expect(prisma.socratesSession.create).not.toHaveBeenCalled();

    limiter.checkRequestLimit.mockResolvedValue({ allowed: true, code: "allowed" });
    limiter.acquireConcurrent.mockResolvedValue({ allowed: true, code: "allowed" });
    await service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID, question: "hello" });
    expect(limiter.releaseConcurrent).toHaveBeenCalledTimes(2);
  });

  it("starts authorized document retrieval while a new turn persists, without generating before durable IDs", async () => {
    const { service, prisma, generationProvider } = makeService();
    const create = prisma.socratesSession.create.getMockImplementation();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    prisma.socratesSession.create.mockImplementation(async (args: any) => {
      await barrier;
      return create(args);
    });
    const answer = service.askV1ProjectMemory({ projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "What backend API routes are documented?", selectedSources: ["documents"] });
    try {
      await vi.waitFor(() => expect(prisma.documentChunk.findMany).toHaveBeenCalled(), { timeout: 100 });
      expect(generationProvider.generateObject).not.toHaveBeenCalled();
    } finally { release(); }
    const result = await answer;
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.messageId).toBe(ASSISTANT_MESSAGE_ID);
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it("uses the Socrates project policy gate before collecting v1 evidence", async () => {
    const { service, prisma, projectService } = makeService();
    projectService.ensureProjectMemberCanUseSocrates.mockRejectedValueOnce(
      Object.assign(new Error("Client users cannot ask Socrates"), {
        statusCode: 403,
        code: "socrates_client_denied"
      })
    );

    await expect(
      service.askV1ProjectMemory({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        question: "Summarize project memory"
      })
    ).rejects.toMatchObject({ code: "socrates_client_denied" });

    expect(projectService.ensureProjectMemberCanUseSocrates).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    expect(projectService.ensureProjectAccess).not.toHaveBeenCalled();
    expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();
    expect(prisma.socratesMessage.create).not.toHaveBeenCalled();
  });

  it("persists a failed assistant status when generation cannot complete", async () => {
    const { service, prisma } = makeService();
    prisma.documentChunk.findMany.mockRejectedValueOnce(new Error("retrieval unavailable"));

    await expect(service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize the project memory"
    })).rejects.toThrow("retrieval unavailable");

    expect(prisma.socratesMessage.updateMany).toHaveBeenCalledWith({
      where: { id: ASSISTANT_MESSAGE_ID, responseStatus: "streaming" },
      data: { responseStatus: "failed", content: "" }
    });
  });

  it.each([
    "wassup",
    "wassup?",
    "what's up?",
    "how are you?",
    "how are you doing today?",
    "hi how are you",
    "how r u",
    "what's good?",
    "what's new?",
    "how's your day?",
    "what's your name?",
    "can we chat?",
    "what are you up to?",
    "good morning Socrates",
    "good night Socrates",
    "what can you do?",
    "thanks",
    "cool",
    "lol",
    "tell me a joke",
    "hey Socrates please",
    "hey Socrates, quick hello only please",
    "quick hello only please",
    "Say hi in one short sentence.",
    "can you hear me now?",
    "are you alive?",
    "bye",
    "what is 2+2?",
    "hey, quick check"
  ])(
    "answers simple chat instantly without project evidence or model calls: %s",
    async (question) => {
      const { service, prisma, generationProvider, tx } = makeService();

      const result = await service.askV1ProjectMemory({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        question
      });

      expect(result.retrievalSummary.intent).toBe("small_talk");
      expect(result.retrievalSummary.evidenceCount).toBe(0);
      expect(result.citations).toEqual([]);
      expect(result.open_targets).toEqual([]);
      expect(result.costEstimate).toMatchObject({ estimatedUsd: 0, modelCalls: 0, evidenceItems: 0 });
      expect(result.modelMetadata).toMatchObject({ provider: "deterministic", model: null, degraded: false });
      expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();
      expect(prisma.documentSection.findMany).not.toHaveBeenCalled();
      expect(prisma.communicationMessageChunk.findMany).not.toHaveBeenCalled();
      expect(prisma.gitHubEngineeringEvidence.findMany).not.toHaveBeenCalled();
      expect(prisma.socratesSession.update).not.toHaveBeenCalled();
      expect(generationProvider.generateObject).not.toHaveBeenCalled();
      expect(prisma.socratesMessage.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.socratesMessage.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: ASSISTANT_MESSAGE_ID },
        data: expect.objectContaining({
          responseStatus: "completed"
        })
      }));
    }
  );

  it("keeps short project questions on the evidence path", async () => {
    const { service, prisma } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "who owns auth?"
    });

    expect(result.retrievalSummary.intent).not.toBe("small_talk");
    expect(prisma.documentChunk.findMany).toHaveBeenCalled();
  });

  it("keeps current launch-priority questions on the evidence path", async () => {
    const { service, prisma, generationProvider } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What is the current launch priority and what evidence supports it?"
    });

    expect(result.retrievalSummary.evidenceCount).toBeGreaterThan(0);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.safety.policy).not.toBe("normal_chat_no_project_evidence");
    expect(prisma.documentChunk.findMany).toHaveBeenCalled();
    expect(generationProvider.generateObject).not.toHaveBeenCalledWith(expect.objectContaining({
      task: "socrates_v1_general_chat"
    }));
  });

  it("treats connector policy questions as evidence-backed project questions", async () => {
    const { service, prisma } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Which evidence says connector write actions must remain disabled?"
    });

    expect(result.retrievalSummary.intent).toBe("general_question");
    expect(result.retrievalSummary.evidenceCount).toBeGreaterThan(0);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.answer_md).not.toMatch(/do not have enough project evidence/i);
    expect(prisma.documentChunk.findMany).toHaveBeenCalled();
    expect(prisma.communicationMessageChunk.findMany).toHaveBeenCalled();
    expect(prisma.specChangeProposal.findMany).toHaveBeenCalled();
  });

  it("answers normal non-project questions without loading project evidence", async () => {
    const { service, prisma, generationProvider } = makeService({ OPENAI_API_KEY: "test-openai-key" });

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "why do teams use feature flags?"
    });

    expect(result.retrievalSummary.intent).toBe("general_question");
    expect(result.retrievalSummary.evidenceCount).toBe(0);
    expect(result.citations).toEqual([]);
    expect(result.open_targets).toEqual([]);
    expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();
    expect(prisma.communicationMessageChunk.findMany).not.toHaveBeenCalled();
    expect(prisma.gitHubEngineeringEvidence.findMany).not.toHaveBeenCalled();
    expect(generationProvider.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      task: "socrates_v1_general_chat"
    }));
  });

  it("answers known definition-style normal questions instantly even when OpenAI is configured", async () => {
    const { service, prisma, generationProvider } = makeService({ OPENAI_API_KEY: "test-openai-key" });

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "what is React in one sentence?"
    });

    expect(result.answer_md).toContain("JavaScript library");
    expect(result.retrievalSummary.evidenceCount).toBe(0);
    expect(result.costEstimate.modelCalls).toBe(0);
    expect(result.modelMetadata.provider).toBe("deterministic");
    expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();
    expect(generationProvider.generateObject).not.toHaveBeenCalled();
  });

  it("uses a useful instant fallback for common normal questions when the fast model is unavailable", async () => {
    const { service, prisma, generationProvider } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "what is React in one sentence?"
    });

    expect(result.answer_md).toContain("JavaScript library");
    expect(result.retrievalSummary.intent).toBe("general_question");
    expect(result.retrievalSummary.evidenceCount).toBe(0);
    expect(result.costEstimate.modelCalls).toBe(0);
    expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();
    expect(prisma.gitHubEngineeringEvidence.findMany).not.toHaveBeenCalled();
    expect(generationProvider.generateObject).not.toHaveBeenCalled();
  });

  it("treats definition-style project terms as normal chat unless the user asks about project evidence", async () => {
    const { service, prisma } = makeService();

    const definition = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "what is an API?"
    });

    expect(definition.answer_md).toContain("contract");
    expect(definition.retrievalSummary.evidenceCount).toBe(0);
    expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();

    await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "what is our API structure?"
    });

    expect(prisma.documentChunk.findMany).toHaveBeenCalled();
  });

  it("loads only the requested evidence family for source-specific questions", async () => {
    const { service, prisma } = makeService();

    await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What is GitHub showing?"
    });

    expect(prisma.gitHubEngineeringEvidence.findMany).toHaveBeenCalled();
    expect(prisma.documentChunk.findMany).not.toHaveBeenCalled();
    expect(prisma.communicationMessageChunk.findMany).not.toHaveBeenCalled();
    expect(prisma.projectEvent.findMany).not.toHaveBeenCalled();
  });

  it("answers dataset aggregate questions from the fast dataset profile without a model call", async () => {
    const { service, generationProvider } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What is the average revenue in the Sales dataset?",
      includeArtifacts: true
    });

    expect(result.answer_md).toContain("average 200");
    expect(result.answer_md).toContain("sum 600");
    expect(result.citations.map((citation) => citation.label).join(" ")).toMatch(/Sales dataset/i);
    expect(result.costEstimate.modelCalls).toBe(0);
    expect(result.modelMetadata.provider).toBe("deterministic");
    expect(generationProvider.generateObject).not.toHaveBeenCalled();
  });

  it("does not let broad launch-risk questions get hijacked by dataset profile mode", async () => {
    const { service, prisma } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What are the top launch risks? Cite the PRD and communication evidence.",
      includeArtifacts: true
    });

    expect(result.answer_md).not.toMatch(/Using the indexed dataset profile/i);
    expect(result.retrievalSummary.evidenceCount).toBeGreaterThan(0);
    expect(prisma.documentChunk.findMany).toHaveBeenCalled();
    expect(prisma.communicationMessageChunk.findMany).toHaveBeenCalled();
    expect(prisma.documentSection.findMany).not.toHaveBeenCalled();
  });

  it("keeps PRD, communication, timeline, ownership, and subscription evidence in launch-readiness summaries", async () => {
    const { service, prisma, generationProvider } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MODEL: "gpt-5.4-mini"
      },
      {
        answer_md: "Launch readiness uses PRD, communication, timeline, ownership, and subscription evidence.",
        confidence: "high",
        limitations: [],
        suggested_prompts: []
      }
    );

    await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Give me a launch-readiness summary and tell me what you cannot confirm.",
      includeArtifacts: true
    });

    expect(prisma.documentChunk.findMany).toHaveBeenCalled();
    expect(prisma.communicationMessageChunk.findMany).toHaveBeenCalled();
    expect(prisma.projectEvent.findMany).toHaveBeenCalled();
    expect(prisma.projectResponsibility.findMany).toHaveBeenCalled();
    expect(prisma.projectSubscription.findMany).toHaveBeenCalled();

    const prompt = String((generationProvider.generateObject as any).mock.calls[0][0].prompt);
    expect(prompt).toContain("Backend Contract");
    expect(prompt).toContain("Slack discussion says the API map should cite real routes");
    expect(prompt).toContain("Manager review checkpoint");
    expect(prompt).toContain("Own auth module");
    expect(prompt).toContain("Supabase");
  });

  it("returns an explicitly unverified deterministic fallback for a readiness verdict", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Give me a readiness verdict and list what remains unconfirmed.",
      includeArtifacts: false
    });

    expect(result.answer_md).toContain("## Readiness verdict");
    expect(result.answer_md).toContain("## Retrieved evidence");
    expect(result.answer_md).toContain("## Still unconfirmed");
    expect(result.answer_md).toContain("Readiness is unverified");
    expect(result.answer_md).not.toContain("supports a controlled beta");
  });

  it.each([
    "Critical tenant isolation failure. Do not launch or run a beta until the blocker is fixed.",
    "The office kitchen has a blue cupboard."
  ])("does not approve a beta from negative or irrelevant retrieved evidence: %s", async (content) => {
    const { service, prisma } = makeService();
    const rows = await prisma.documentChunk.findMany();
    prisma.documentChunk.findMany.mockResolvedValue([{ ...rows[0]!, content }]);
    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "Give me a readiness verdict.", selectedSources: ["documents"], includeArtifacts: false, includeHistory: false
    });
    expect(result.answer_md).toContain("Readiness is unverified");
    expect(result.answer_md).toContain(content);
    expect(result.answer_md).not.toContain("supports a controlled beta");
  });

  it("returns a persisted backend API map artifact with citations and no fake demo data", async () => {
    const { service, prisma, tx } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Map our API structure",
      includeArtifacts: true
    });

    expect(result.artifact?.type).toBe("api_map");
    expect(result.artifact?.payload).toMatchObject({
      groups: expect.any(Array),
      endpoints: expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("/v1/projects/:projectId/timeline") })
      ])
    });
    expect(JSON.stringify(result)).not.toMatch(/BloomFast|demo API|fake commit/i);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.open_targets.length).toBeGreaterThan(0);
    expect(result.citations.map((citation) => citation.sourceType)).toEqual(expect.arrayContaining(["subscription", "vscode_activity"]));
    expect(result.open_targets.map((target) => target.targetType)).toEqual(expect.arrayContaining(["project_subscription", "vscode_activity"]));
    expect(prisma.socratesSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        messages: {
          create: [
            expect.objectContaining({ role: "user" }),
            expect.objectContaining({ role: "assistant", responseStatus: "streaming" })
          ]
        }
      })
    }));
    expect(prisma.socratesMessage.create).not.toHaveBeenCalled();
    expect(tx.socratesMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ASSISTANT_MESSAGE_ID },
      data: expect.objectContaining({ responseStatus: "completed" })
    }));
    const updateMock = tx.socratesMessage.update as unknown as { mock: { calls: Array<[any]> } };
    const persistedPayload = updateMock.mock.calls[0]?.[0]?.data?.answerPayloadJson;
    expect(containsUndefined(persistedPayload)).toBe(false);
    expect(tx.socratesCitation.createMany).toHaveBeenCalled();
    expect(tx.socratesOpenTarget.createMany).toHaveBeenCalled();
  });

  it("returns an honest API map artifact with limitations when no route inventory is indexed", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Map our API structure based only on current communication evidence.",
      mode: "api_map",
      selectedSources: ["communications"],
      includeArtifacts: true
    });

    expect(result.artifact?.type).toBe("api_map");
    expect(result.artifact?.payload).toMatchObject({
      endpoints: [],
      limitations: expect.arrayContaining([
        expect.stringMatching(/No route inventory was indexed/i)
      ])
    });
    expect(result.artifact?.sourceRefs.length).toBeGreaterThan(0);
    expect(result.artifact?.contentMd).toMatch(/No indexed API routes/i);
    expect(result.answer_md).not.toMatch(/fake|demo API/i);
  });

  it("treats create API map requests as read-only artifacts even when GitHub evidence is requested", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Create an API map and separate PRD-reported endpoints from GitHub-confirmed API route files.",
      mode: "api_map",
      selectedSources: ["documents", "github"],
      includeArtifacts: true
    });

    expect(result.safety.refusedMutation).toBe(false);
    expect(result.artifact?.type).toBe("api_map");
    expect(result.answer_md).not.toMatch(/cannot directly mutate/i);
  });

  it("does not mistake read-only merge evidence comparisons for mutation commands", async () => {
    const { service } = makeService();

    for (const question of [
      "Compare the latest production validation document with current GitHub merge evidence and communication launch requirements.",
      "What change did we approve in the LiveDoc?",
      "What should we change in the LiveDoc based on the PRD?"
    ]) {
      const result = await service.askV1ProjectMemory({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        question,
        selectedSources: ["all"],
        includeArtifacts: false,
        includeHistory: false
      });

      expect(result.safety.refusedMutation).toBe(false);
      expect(result.answer_md).not.toMatch(/cannot directly mutate/i);
    }
  });

  it("returns a renderable system diagram artifact instead of raw evidence prose", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Generate a concise system diagram for Orchestra from the evidence.",
      includeArtifacts: true
    });

    expect(result.artifact?.type).toBe("diagram");
    expect(result.artifact?.payload).toMatchObject({
      diagramType: "mermaid_flowchart",
      mermaidSource: expect.stringContaining("flowchart LR")
    });
    expect(result.artifact?.contentMd).toMatch(/```mermaid/);
    expect(result.answer_md).toMatch(/diagram artifact/i);
    expect(result.answer_md).not.toMatch(/\*\*Backend Contract\*\*.*\*\*Slack/s);
  });

  it("labels pending Slack-derived changes as pending in weekly summaries", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize this week's changes",
      mode: "weekly_summary",
      includeArtifacts: true
    });

    expect(result.artifact?.type).toBe("summary");
    expect(JSON.stringify(result.artifact?.payload)).toMatch(/pending/i);
    expect(result.answer_md).toMatch(/pending/i);
    expect(result.answer_md).not.toMatch(/accepted Slack-derived copy change/i);
  });

  it("refuses direct mutation requests instead of accepting proposals or mutating LiveDoc", async () => {
    const { service, prisma } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Accept this change and update the LiveDoc now",
      includeArtifacts: true
    });

    expect(result.safety.refusedMutation).toBe(true);
    expect(result.answer_md).toMatch(/cannot directly/i);
    expect(result.answer_md).toMatch(/review flow/i);
    expect(prisma.specChangeProposal.findMany).toHaveBeenCalled();
    expect((prisma as any).specChangeProposal.update).toBeUndefined();
  });

  it("refuses paraphrased mutation requests that put the target before the action", async () => {
    const { service, prisma } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Mark the proposal accepted and merge PR #12",
      includeArtifacts: true
    });

    expect(result.safety.refusedMutation).toBe(true);
    expect(result.answer_md).toMatch(/cannot directly/i);
    expect(result.answer_md).toMatch(/review flow/i);
    expect((prisma as any).specChangeProposal.update).toBeUndefined();
  });

  it("refuses explicit target-first mutation commands without blocking descriptive evidence", async () => {
    const { service } = makeService();

    for (const question of [
      "GitHub: merge PR #12",
      "Proposal, approve it now",
      "Based on this evidence, merge PR #12",
      "After reviewing it, approve the proposal",
      "Can we update the LiveDoc now?"
    ]) {
      const result = await service.askV1ProjectMemory({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        question,
        includeArtifacts: false,
        includeHistory: false
      });

      expect(result.safety.refusedMutation).toBe(true);
      expect(result.answer_md).toMatch(/cannot directly mutate/i);
    }
  });

  it("refuses scheduling, conversion, and promote-style mutation requests", async () => {
    const { service } = makeService();

    for (const question of [
      "Schedule a launch review call tomorrow in Google Calendar",
      "Make this proposal live in project memory",
      "Convert this suggestion to timeline"
    ]) {
      const result = await service.askV1ProjectMemory({
        projectId: PROJECT_ID,
        actorUserId: USER_ID,
        question,
        includeArtifacts: false,
        includeHistory: false
      });

      expect(result.safety.refusedMutation).toBe(true);
      expect(result.answer_md).toMatch(/cannot directly/i);
    }
  });

  it("drops stale document chunks from superseded document versions", async () => {
    const { service, prisma } = makeService();
    prisma.documentChunk.findMany.mockResolvedValue([
      {
        id: "01010101-0101-4101-8101-010101010101",
        content: "Stale billing plan says invoices are manual and should not be trusted.",
        lexicalContent: "stale billing invoices manual",
        chunkIndex: 0,
        pageNumber: 1,
        documentVersionId: "old-version-id",
        section: { id: "old-section", anchorId: "billing-old", headingPath: ["Billing"], pageNumber: 1 },
        documentVersion: {
          id: "old-version-id",
          document: { id: "doc-billing", title: "Billing PRD old", currentVersionId: "current-version-id" }
        },
        createdAt: new Date("2026-05-31T10:00:00.000Z")
      },
      {
        id: "02020202-0202-4202-8202-020202020202",
        content: "Current billing plan says Stripe subscriptions are read-only evidence in beta.",
        lexicalContent: "current billing stripe subscriptions read only evidence beta",
        chunkIndex: 0,
        pageNumber: 2,
        documentVersionId: "current-version-id",
        section: { id: "current-section", anchorId: "billing-current", headingPath: ["Billing"], pageNumber: 2 },
        documentVersion: {
          id: "current-version-id",
          document: { id: "doc-billing", title: "Billing PRD current", currentVersionId: "current-version-id" }
        },
        createdAt: new Date("2026-05-30T10:00:00.000Z")
      }
    ]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What does the billing PRD say?",
      selectedSources: ["documents"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(result.citations.map((citation) => citation.refId)).toContain("02020202-0202-4202-8202-020202020202");
    expect(result.citations.map((citation) => citation.refId)).not.toContain("01010101-0101-4101-8101-010101010101");
    expect(result.answer_md).toMatch(/Stripe subscriptions|read-only evidence/i);
    expect(result.answer_md).not.toMatch(/manual and should not be trusted/i);
  });

  it("drops stale document chunks from older parse revisions of the current version", async () => {
    const { service, prisma } = makeService();
    prisma.documentChunk.findMany.mockResolvedValue([
      {
        id: "03030303-0303-4303-8303-030303030303",
        content: "Old parse revision says the beta stores raw private folder contents.",
        lexicalContent: "old parse beta raw private folder contents",
        parseRevision: 1,
        chunkIndex: 0,
        pageNumber: 1,
        documentVersionId: "current-version-id",
        section: { id: "old-section", anchorId: "drive-old", headingPath: ["Drive"], pageNumber: 1 },
        documentVersion: {
          id: "current-version-id",
          parseRevision: 2,
          status: "ready",
          document: { id: "doc-drive", title: "Drive PRD", currentVersionId: "current-version-id" }
        },
        createdAt: new Date("2026-06-01T10:00:00.000Z")
      },
      {
        id: "04040404-0404-4404-8404-040404040404",
        content: "Current parse revision says managers select the Drive files Socrates can use.",
        lexicalContent: "current parse managers select Drive files Socrates use",
        parseRevision: 2,
        chunkIndex: 1,
        pageNumber: 2,
        documentVersionId: "current-version-id",
        section: { id: "current-section", anchorId: "drive-current", headingPath: ["Drive"], pageNumber: 2 },
        documentVersion: {
          id: "current-version-id",
          parseRevision: 2,
          status: "ready",
          document: { id: "doc-drive", title: "Drive PRD", currentVersionId: "current-version-id" }
        },
        createdAt: new Date("2026-06-01T10:05:00.000Z")
      }
    ]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What does the Drive PRD say about private folders?",
      selectedSources: ["documents"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(result.citations.map((citation) => citation.refId)).toContain("04040404-0404-4404-8404-040404040404");
    expect(result.citations.map((citation) => citation.refId)).not.toContain("03030303-0303-4303-8303-030303030303");
    expect(result.answer_md).toMatch(/managers select/i);
    expect(result.answer_md).not.toMatch(/raw private folder contents/i);
  });

  it("persists Google Drive chunk citations with a valid document citation enum", async () => {
    const { service, prisma, tx } = makeService();
    prisma.projectDriveFile = {
      findMany: vi.fn(async () => [
        {
          id: "drive-file-row-id",
          projectId: PROJECT_ID,
          connectionId: "drive-connection-id",
          documentVersionId: "drive-version-id",
          driveFileId: "google-file-id",
          metadataJson: {},
          parentsJson: []
        }
      ])
    };
    prisma.projectDriveSyncRoot = {
      findMany: vi.fn(async () => [
        {
          id: "drive-root-id",
          connectionId: "drive-connection-id",
          rootType: "selected_file",
          googleFileId: "google-file-id"
        }
      ])
    };
    prisma.documentChunk.findMany.mockResolvedValue([
      {
        id: "05050505-0505-4505-8505-050505050505",
        content: "The Drive PRD says managers choose the exact files and folders Socrates may use.",
        lexicalContent: "drive prd managers choose exact files folders socrates may use",
        parseRevision: 1,
        chunkIndex: 0,
        pageNumber: 1,
        documentVersionId: "drive-version-id",
        section: { id: "drive-section", anchorId: "drive-access", headingPath: ["Drive access"], pageNumber: 1 },
        documentVersion: {
          id: "drive-version-id",
          parseRevision: 1,
          status: "ready",
          document: { id: "doc-drive", title: "Drive PRD", currentVersionId: "drive-version-id" }
        },
        createdAt: new Date("2026-06-01T10:05:00.000Z")
      }
    ]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What does the Drive PRD say about which files Socrates may use?",
      selectedSources: ["google_drive"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(result.citations).toContainEqual(expect.objectContaining({
      refId: "05050505-0505-4505-8505-050505050505",
      sourceType: "google_drive_document"
    }));
    expect(result.sourceStates.google_drive).toMatchObject({ state: "ready", count: 1 });
    expect(tx.socratesCitation.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({
        citationType: "document_chunk",
        refId: "05050505-0505-4505-8505-050505050505"
      })])
    }));
    const driveCitationRows = tx.socratesCitation.createMany.mock.calls.flatMap(([call]: any[]) => call.data);
    expect(driveCitationRows).not.toContainEqual(expect.objectContaining({ citationType: "google_drive_document" }));
  });

  it("does not infer GitHub connection status from zero matching ownership evidence", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Who owns auth?",
      mode: "ownership",
      includeArtifacts: true
    });

    expect(result.artifact?.type).toBe("ownership");
    expect(JSON.stringify(result.artifact?.payload)).toMatch(/Karthik|auth/i);
    expect(result.sourceStates.github).toMatchObject({ state: "ready", count: 0 });
    expect(result.answer_md).not.toMatch(/GitHub is not connected/i);
    expect(JSON.stringify(result.artifact?.payload)).not.toMatch(/GitHub is not connected/i);
  });

  it("only retrieves GitHub evidence from active repository links", async () => {
    const { service, prisma } = makeService();

    await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What is GitHub showing?",
      selectedSources: ["github"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(prisma.gitHubEngineeringEvidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: PROJECT_ID,
          evidenceStatus: "active",
          repositoryLink: {
            status: "active",
            archivedAt: null
          }
        })
      })
    );
  });

  it("uses the configured MVP communication provider policy for v1 communication evidence", async () => {
    const { service, prisma } = makeService({
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "microsoft_teams"] as any
    });

    await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What do Teams messages say?",
      selectedSources: ["communications"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(prisma.communicationMessageChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: { in: ["manual_import", "microsoft_teams"] }
        })
      })
    );
  });

  it("does not broaden explicit Slack scope to another communication provider", async () => {
    const { service, prisma } = makeService({
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["slack", "microsoft_teams"] as any
    });
    prisma.communicationMessageChunk.findMany.mockResolvedValueOnce([
      {
        id: "31313131-3131-4131-8131-313131313131",
        messageId: "32323232-3232-4232-8232-323232323232",
        threadId: "33333333-3333-4333-8333-333333333334",
        provider: "slack",
        content: "The launch decision requires a rollback owner.",
        lexicalContent: "launch decision rollback owner",
        message: { senderLabel: "Slack lead", provider: "slack", sentAt: new Date("2026-05-30T09:00:00.000Z"), isDeletedByProvider: false },
        thread: { subject: "Launch", rawMetadataJson: { channelName: "launch" } },
        connector: { provider: "slack", accountLabel: "Slack workspace" },
        createdAt: new Date("2026-05-30T09:00:00.000Z")
      },
      {
        id: "34343434-3434-4343-8343-343434343434",
        messageId: "35353535-3535-4535-8535-353535353535",
        threadId: "36363636-3636-4636-8636-363636363636",
        provider: "microsoft_teams",
        content: "The launch decision was discussed in Teams.",
        lexicalContent: "launch decision discussed teams",
        message: { senderLabel: "Teams lead", provider: "microsoft_teams", sentAt: new Date("2026-05-30T09:01:00.000Z"), isDeletedByProvider: false },
        thread: { subject: "Launch", rawMetadataJson: {} },
        connector: { provider: "microsoft_teams", accountLabel: "Teams workspace" },
        createdAt: new Date("2026-05-30T09:01:00.000Z")
      }
    ]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize the launch decision.",
      selectedSources: ["slack"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(result.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "slack_message", label: expect.stringContaining("Slack") })
    ]));
    expect(JSON.stringify(result)).not.toContain("Teams lead");
    expect(JSON.stringify(result)).not.toContain("Microsoft Teams");
  });

  it("retrieves relevant document evidence outside the recent cache window", async () => {
    const { service, prisma } = makeService();
    const oldChunkId = "37373737-3737-4737-8737-373737373737";
    prisma.$queryRaw = vi.fn().mockResolvedValue([{ id: oldChunkId }]);
    prisma.documentChunk.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: oldChunkId,
        projectId: PROJECT_ID,
        documentVersionId: "38383838-3838-4838-8838-383838383838",
        parseRevision: 1,
        chunkIndex: 0,
        content: "Legacy OAuth replay protection requires single-use state consumption.",
        lexicalContent: "legacy oauth replay protection single use state consumption",
        section: {
          id: "39393939-3939-4939-8939-393939393939",
          anchorId: "oauth-replay",
          headingPath: ["Security", "OAuth replay"],
          pageNumber: 4
        },
        documentVersion: {
          id: "38383838-3838-4838-8838-383838383838",
          status: "ready",
          parseRevision: 1,
          document: {
            id: "40404040-4040-4040-8040-404040404040",
            title: "Security architecture",
            currentVersionId: "38383838-3838-4838-8838-383838383838"
          }
        },
        createdAt: new Date("2025-01-01T00:00:00.000Z")
      }]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What is the legacy OAuth replay protection requirement?",
      selectedSources: ["documents"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const fullCorpusQuery = prisma.$queryRaw.mock.calls[0]![0] as { values: unknown[] };
    expect(fullCorpusQuery.values).toEqual(expect.arrayContaining([
      "legacy OR oauth OR replay OR protection OR requirement"
    ]));
    expect(result.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ refId: oldChunkId, label: expect.stringContaining("OAuth replay") })
    ]));
  });

  it("supplements thin lexical document recall with bounded semantic evidence", async () => {
    const { service } = makeService({
      OPENAI_EMBEDDING_MODEL: "text-embedding-3-small"
    });
    const semanticChunkId = "41414141-4141-4414-8414-414141414141";
    vi.spyOn(service as any, "findBetaHybridDocumentEvidence").mockResolvedValueOnce([{
      id: semanticChunkId,
      content: "Enterprise identity uses SAML single sign-on before the public launch.",
      lexicalContent: "enterprise identity saml single sign on public launch",
      parseRevision: 1,
      chunkIndex: 0,
      pageNumber: 4,
      documentVersionId: "42424242-4242-4424-8424-424242424242",
      section: {
        id: "43434343-4343-4434-8434-434343434343",
        anchorId: "enterprise-authentication",
        headingPath: ["Authentication"],
        pageNumber: 4
      },
      documentVersion: {
        id: "42424242-4242-4424-8424-424242424242",
        parseRevision: 1,
        status: "ready",
        document: {
          id: "44444444-4444-4444-8444-444444444445",
          title: "Identity requirements",
          currentVersionId: "42424242-4242-4424-8424-424242424242",
          archivedAt: null
        }
      },
      createdAt: new Date("2025-01-01T00:00:00.000Z")
    }]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What federated login requirement must ship?",
      selectedSources: ["documents"],
      includeArtifacts: false
    });

    expect(result.citations).toContainEqual(expect.objectContaining({ refId: semanticChunkId }));
    expect((service as any).findBetaHybridDocumentEvidence).toHaveBeenCalledTimes(1);
  });

  it("starts full-corpus document recall without waiting for the recent-evidence cache", async () => {
    const { service, prisma } = makeService();
    let releaseRecent!: (rows: any[]) => void;
    const blockedRecent = new Promise<any[]>((resolve) => { releaseRecent = resolve; });
    prisma.documentChunk.findMany.mockImplementationOnce(() => blockedRecent);
    prisma.$queryRaw = vi.fn(async () => []);

    const request = (service as any).findSocratesV1DocumentEvidence(
      PROJECT_ID,
      "production launch validation",
      false
    );

    await vi.waitFor(() => expect(prisma.$queryRaw).toHaveBeenCalledTimes(1));
    releaseRecent([]);
    await expect(request).resolves.toEqual([]);
  });

  it("cites selected Notion documents and Microsoft Teams threads with source-specific labels", async () => {
    const notionChunkId = "22222222-2222-4222-8222-aaaaaaaaaaaa";
    const notionVersionId = "23232323-2323-4232-8232-232323232323";
    const notionDocumentId = "24242424-2424-4242-8242-242424242424";
    const notionSectionId = "25252525-2525-4252-8252-252525252525";
    const teamsChunkId = "26262626-2626-4262-8262-262626262626";
    const teamsMessageId = "27272727-2727-4272-8272-272727272727";
    const teamsThreadId = "28282828-2828-4282-8282-282828282828";
    const { service, prisma } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MODEL: "gpt-5.4-mini",
        MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "microsoft_teams"] as any
      },
      {
        answer_md:
          "The selected Notion launch checklist [E1] and the Microsoft Teams approval thread [E2] agree that QA owner and rollback steps must stay visible before launch review. Teams remains communication evidence until a manager accepts the LiveDoc review item.",
        confidence: "high",
        limitations: [],
        suggested_prompts: []
      }
    );

    prisma.documentChunk.findMany.mockResolvedValue([
      {
        id: notionChunkId,
        projectId: PROJECT_ID,
        content:
          "Selected Notion launch checklist: keep QA owner and rollback steps visible before launch review. Teams approval is evidence only until a manager accepts the LiveDoc review item.",
        lexicalContent: "notion launch checklist qa owner rollback steps launch review teams approval evidence livedoc",
        chunkIndex: 0,
        pageNumber: 1,
        documentVersionId: notionVersionId,
        section: {
          id: notionSectionId,
          anchorId: "launch-review-checklist",
          headingPath: ["Launch workspace", "launch-review-checklist"],
          pageNumber: 1
        },
        documentVersion: {
          id: notionVersionId,
          document: { id: notionDocumentId, title: "Notion Launch Plan", currentVersionId: notionVersionId }
        },
        createdAt: new Date("2026-05-14T08:45:00.000Z")
      }
    ]);
    prisma.documentChunk.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === notionChunkId
        ? { id: notionChunkId, projectId: PROJECT_ID, documentVersionId: notionVersionId, sectionId: notionSectionId }
        : null
    );
    prisma.projectNotionResource.findMany.mockResolvedValueOnce([
      {
        id: "29292929-2929-4292-8292-292929292929",
        projectId: PROJECT_ID,
        documentVersionId: notionVersionId,
        selected: true,
        selectedResourceLabel: "Launch workspace",
        indexStatus: "ready",
        lastIndexedAt: new Date("2026-05-14T08:45:00.000Z"),
        updatedAt: new Date("2026-05-14T08:45:00.000Z")
      }
    ]);
    prisma.communicationMessageChunk.findMany.mockResolvedValueOnce([
      {
        id: teamsChunkId,
        projectId: PROJECT_ID,
        provider: "microsoft_teams",
        messageId: teamsMessageId,
        threadId: teamsThreadId,
        connectorId: "34343434-3434-4343-8343-343434343434",
        content:
          "Microsoft Teams approval: client approved manager approval launch only if the Notion launch checklist keeps QA owner and rollback steps visible.",
        lexicalContent: "microsoft teams approval client approved manager approval launch notion launch checklist qa owner rollback",
        message: {
          provider: "microsoft_teams",
          senderLabel: "Priya Product",
          sentAt: new Date("2026-05-14T09:00:00.000Z"),
          providerPermalink: "https://teams.example/thread/launch-review",
          isDeletedByProvider: false
        },
        thread: { subject: "Teams Launch Review", rawMetadataJson: { channelName: "Launch Review" } },
        connector: { provider: "microsoft_teams", accountLabel: "Orchestra Teams", configJson: { tenantName: "Orchestra" } },
        createdAt: new Date("2026-05-14T09:00:00.000Z")
      }
    ]);
    prisma.communicationThread.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === teamsThreadId ? { id: teamsThreadId, projectId: PROJECT_ID, subject: "Teams Launch Review" } : null
    );
    prisma.communicationMessage.findFirst.mockImplementation(async ({ where }: any) =>
      where.id === teamsMessageId ? { id: teamsMessageId, projectId: PROJECT_ID, threadId: teamsThreadId } : null
    );

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question:
        "Compare the selected Notion launch checklist with the Microsoft Teams approval thread. What is agreed and what still needs truth-gated review?",
      selectedSources: ["documents", "communications"],
      includeArtifacts: false,
      includeHistory: false
    });

    expect(result.answer_md).toMatch(/Teams remains communication evidence/i);
    expect(result.citations).toContainEqual(expect.objectContaining({
      sourceType: "document",
      refId: notionChunkId,
      label: expect.stringContaining("Notion")
    }));
    expect(result.citations).toContainEqual(expect.objectContaining({
      sourceType: "communication_message",
      refId: teamsMessageId,
      label: expect.stringContaining("Microsoft Teams")
    }));
    expect(result.open_targets.map((target) => target.targetType)).toEqual(
      expect.arrayContaining(["document_section", "message"])
    );
  });

  it("preserves multiple explicit responsibilities for ownership questions", async () => {
    const { service, prisma, generationProvider } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MODEL: "gpt-5.4-mini"
      },
      {
        answer_md: "Ownership is split across backend reliability, offline UX, and pilot go/no-go readiness.",
        confidence: "high",
        limitations: [],
        suggested_prompts: []
      }
    );
    prisma.projectResponsibility.findMany.mockResolvedValueOnce([
      {
        id: "19191919-1919-4191-8191-191919191919",
        projectId: PROJECT_ID,
        title: "MOCK QA Owner: API fallback and JSON repair",
        description: "Own itinerary API fallback and malformed AI JSON repair.",
        area: "backend",
        status: "in_progress",
        assigneeName: "Aditi Engineer",
        member: null,
        createdAt: new Date("2026-05-31T01:00:00.000Z"),
        updatedAt: new Date("2026-05-31T01:00:00.000Z")
      },
      {
        id: "20202020-2020-4202-8202-202020202020",
        projectId: PROJECT_ID,
        title: "MOCK QA Owner: Offline trip UX and saved itinerary",
        description: "Validate offline saved trip view and mobile states.",
        area: "frontend",
        status: "open",
        assigneeName: "Mannan QA",
        member: null,
        createdAt: new Date("2026-05-31T02:00:00.000Z"),
        updatedAt: new Date("2026-05-31T02:00:00.000Z")
      },
      {
        id: "21212121-2121-4212-8212-212121212121",
        projectId: PROJECT_ID,
        title: "MOCK QA Owner: Pilot go/no-go and evidence quality",
        description: "Own readiness checklist across PRD, GitHub, communication risks, and calendar review.",
        area: "product",
        status: "open",
        assigneeName: "Karthik PM",
        member: null,
        createdAt: new Date("2026-05-31T03:00:00.000Z"),
        updatedAt: new Date("2026-05-31T03:00:00.000Z")
      }
    ]);

    await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Who owns the main work areas?",
      mode: "ownership",
      selectedSources: ["team"],
      maxEvidence: 6,
      includeArtifacts: true,
      includeHistory: false
    });

    const prompt = String((generationProvider.generateObject as any).mock.calls[0][0].prompt);
    expect(prompt).toContain("MOCK QA Owner: API fallback and JSON repair");
    expect(prompt).toContain("MOCK QA Owner: Offline trip UX and saved itinerary");
    expect(prompt).toContain("MOCK QA Owner: Pilot go/no-go and evidence quality");
  });

  it("balances low evidence windows across requested integration sources", async () => {
    const { service, prisma, generationProvider } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MODEL: "gpt-5.4-mini",
        SOCRATES_MAX_EVIDENCE_ITEMS: 6
      },
      {
        answer_md: "Readiness uses PRD, GitHub, communication, calendar, ownership, and subscription evidence.",
        confidence: "high",
        limitations: [],
        suggested_prompts: []
      }
    );
    prisma.projectEvent.findMany.mockResolvedValueOnce([
      {
        id: "23232323-2323-4232-8232-232323232323",
        title: "MOCK QA Google Calendar: launch readiness review",
        description: "Review PRD, GitHub, communication risks, and go/no-go criteria.",
        eventType: "review",
        source: "imported",
        providerCalendarId: "primary",
        startsAt: new Date("2026-06-01T10:00:00.000Z"),
        createdAt: new Date("2026-05-31T10:00:00.000Z"),
        creator: { id: USER_ID, displayName: "Karthik", email: "k@example.com", workspaceRoleDefault: "manager" }
      }
    ]);
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValueOnce([
      {
        id: "24242424-2424-4242-8242-242424242424",
        projectId: PROJECT_ID,
        evidenceType: "github_commit",
        evidenceStatus: "active",
        title: "fix: harden API route",
        summary: "Updated API fallback behavior.",
        repositoryOwner: "KarthikRamesh9149",
        repositoryName: "BackpackerAI",
        branch: "main",
        sha: "abc1234",
        occurredAt: new Date("2026-05-30T09:00:00.000Z"),
        createdAt: new Date("2026-05-30T09:00:00.000Z"),
        mappedUser: null,
        actorGithubLogin: "karthik"
      }
    ]);

    await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Using the PRD, GitHub evidence, communication layer, calendar, team ownership, and subscriptions, summarize readiness.",
      selectedSources: ["documents", "slack", "timeline", "activity", "live_doc", "team", "subscriptions", "github", "vscode"],
      maxEvidence: 30,
      includeArtifacts: true,
      includeHistory: false
    });

    const prompt = String((generationProvider.generateObject as any).mock.calls[0][0].prompt);
    expect(prompt).toContain("Backend Contract");
    expect(prompt).toContain("fix: harden API route");
    expect(prompt).toContain("Slack discussion says the API map should cite real routes");
    expect(prompt).toContain("MOCK QA Google Calendar: launch readiness review");
    expect(prompt).toContain("Own auth module");
    expect(prompt).toContain("Supabase");
  });

  it("returns response-level GitHub evidence citations and targets without persisting unsupported enum values", async () => {
    const { service, prisma, tx } = makeService();
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValueOnce([
      {
        id: "14141414-1414-4141-8141-141414141414",
        projectId: PROJECT_ID,
        evidenceType: "commit",
        evidenceStatus: "active",
        title: "Implement Socrates v1",
        summary: "Backend Socrates v1 endpoint was added.",
        repositoryOwner: "KarthikRamesh9149",
        repositoryName: "orchestrav2",
        sha: "abc1234",
        occurredAt: new Date("2026-05-30T04:00:00.000Z"),
        createdAt: new Date("2026-05-30T04:00:00.000Z"),
        mappedUser: { displayName: "Karthik" },
        actorGithubLogin: "karthik"
      }
    ]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What GitHub evidence exists?",
      selectedSources: ["github"],
      includeArtifacts: true
    });

    expect(result.citations).toContainEqual(expect.objectContaining({ sourceType: "github_evidence", refId: "14141414-1414-4141-8141-141414141414" }));
    expect(result.open_targets).toContainEqual(expect.objectContaining({
      sourceType: "github_evidence",
      targetType: "github_evidence",
      targetRef: expect.objectContaining({ projectId: PROJECT_ID, evidenceId: "14141414-1414-4141-8141-141414141414" })
    }));
    const githubCitationRows = tx.socratesCitation.createMany.mock.calls.flatMap(([call]: any[]) => call.data);
    const githubTargetRows = tx.socratesOpenTarget.createMany.mock.calls.flatMap(([call]: any[]) => call.data);
    expect(githubCitationRows).not.toContainEqual(expect.objectContaining({ citationType: "github_evidence" }));
    expect(githubTargetRows).not.toContainEqual(expect.objectContaining({ targetType: "github_evidence" }));
  });

  it("does not cite prior Socrates history unless the user explicitly asks for it", async () => {
    const { service, prisma } = makeService();
    prisma.socratesMessage.findMany.mockResolvedValueOnce([
      {
        id: "15151515-1515-4151-8151-151515151515",
        role: "user",
        content: "Using the PRD and GitHub evidence, summarize what the repo shows.",
        createdAt: new Date("2026-05-30T11:00:00.000Z"),
        session: { user: { id: USER_ID, displayName: "Karthik", email: "k@example.com" } }
      },
      {
        id: "16161616-1616-4161-8161-161616161616",
        role: "assistant",
        content: "Prior answer about the PRD and GitHub evidence.",
        createdAt: new Date("2026-05-30T10:59:00.000Z"),
        session: { user: { id: USER_ID, displayName: "Karthik", email: "k@example.com" } }
      }
    ]);
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValueOnce([
      {
        id: "17171717-1717-4171-8171-171717171717",
        projectId: PROJECT_ID,
        evidenceType: "github_commit",
        evidenceStatus: "active",
        title: "fix: replace Groq SDK with native fetch for Vercel compatibility",
        summary: "Updated app/api/turn/route.ts to use native fetch for streaming.",
        repositoryOwner: "KarthikRamesh9149",
        repositoryName: "BackpackerAI",
        branch: "main",
        sha: "abc1234",
        occurredAt: new Date("2026-05-30T09:00:00.000Z"),
        createdAt: new Date("2026-05-30T09:00:00.000Z"),
        mappedUser: null,
        actorGithubLogin: "karthik"
      },
      {
        id: "18181818-1818-4181-8181-181818181818",
        projectId: PROJECT_ID,
        evidenceType: "github_branch",
        evidenceStatus: "active",
        title: "Branch main",
        summary: "Default branch main points at abc1234.",
        repositoryOwner: "KarthikRamesh9149",
        repositoryName: "BackpackerAI",
        branch: "main",
        sha: "abc1234",
        occurredAt: new Date("2026-05-30T09:05:00.000Z"),
        createdAt: new Date("2026-05-30T09:05:00.000Z"),
        mappedUser: null,
        actorGithubLogin: "karthik"
      }
    ]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Using the PRD and GitHub repo evidence, summarize BackpackerAI.",
      selectedSources: ["all"],
      maxEvidence: 20,
      includeArtifacts: false
    });

    expect(result.citations.map((citation) => citation.sourceType)).toEqual(expect.arrayContaining(["document", "github_evidence"]));
    expect(result.citations.filter((citation) => citation.sourceType === "socrates_message")).toHaveLength(0);
    expect(result.retrievalSummary.sourceCounts.github).toBe(2);
  });

  it("includes a reloadable prior-conversation target only for an explicit history question", async () => {
    const { service, prisma } = makeService();
    prisma.socratesMessage.findMany.mockResolvedValueOnce([{
      id: "15151515-1515-4151-8151-151515151515",
      role: "user",
      content: "What did we decide about the auth rollout?",
      createdAt: new Date("2026-05-30T11:00:00.000Z"),
      session: { id: SESSION_ID, user: { id: USER_ID, displayName: "Karthik", email: "k@example.com" } }
    }]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What did you say previously about the auth rollout?",
      includeArtifacts: false
    });

    expect(result.citations).toContainEqual(expect.objectContaining({ sourceType: "socrates_message" }));
    expect(prisma.socratesMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { session: { projectId: PROJECT_ID, userId: USER_ID }, role: "user" }
    }));
    expect(result.open_targets).toContainEqual(expect.objectContaining({
      targetType: "socrates_message",
      targetRef: expect.objectContaining({ sessionId: SESSION_ID, messageId: "15151515-1515-4151-8151-151515151515" })
    }));
  });

  it("scopes a broad communication summary to the provider the user named", async () => {
    const { service, prisma } = makeService({
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["slack", "clickup"] as any
    });
    const communicationRow = (provider: "slack" | "clickup", suffix: string) => ({
      id: `${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}${suffix}-${suffix}${suffix}${suffix}${suffix}-4${suffix}${suffix}${suffix}-${suffix}${suffix}${suffix}${suffix}-${suffix.repeat(12)}`,
      provider,
      messageId: provider === "clickup" ? "19191919-1919-4191-8191-191919191919" : "20202020-2020-4202-8202-202020202020",
      threadId: provider === "clickup" ? "21212121-2121-4212-8212-212121212121" : "22222222-2222-4222-8222-222222222223",
      connectorId: provider === "clickup" ? "23232323-2323-4232-8232-232323232323" : "24242424-2424-4242-8242-242424242424",
      content: provider === "clickup" ? "ClickUp launch checklist is ready for review." : "Slack contains an unrelated historical discussion.",
      lexicalContent: provider,
      createdAt: new Date("2026-05-30T09:00:00.000Z"),
      message: { provider, senderLabel: "Owner", sentAt: new Date("2026-05-30T09:00:00.000Z"), providerPermalink: null, isDeletedByProvider: false },
      thread: { subject: `${provider} launch`, rawMetadataJson: {} },
      connector: { provider, accountLabel: provider, configJson: {} }
    });
    prisma.communicationMessageChunk.findMany.mockResolvedValueOnce([
      communicationRow("slack", "2"),
      communicationRow("clickup", "1")
    ]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize ClickUp",
      includeArtifacts: false
    });

    expect(result.citations.map((citation) => citation.label).join(" ")).toMatch(/ClickUp/i);
    expect(result.citations.map((citation) => citation.label).join(" ")).not.toMatch(/Slack/i);
    expect((result.sourceStates as Record<string, { state: string; count: number }>).clickup).toMatchObject({ state: "ready", count: 1 });
  });

  it("does not report Slack as disconnected when another provider matches a broad all-sources question", async () => {
    const { service, prisma } = makeService({
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["slack", "fireflies_ai"] as any
    });
    prisma.communicationMessageChunk.findMany.mockResolvedValueOnce([{
      id: "31313131-3131-4313-8313-313131313131",
      provider: "fireflies_ai",
      messageId: "32323232-3232-4323-8323-323232323232",
      threadId: "33333333-3333-4333-8333-333333333334",
      connectorId: "34343434-3434-4343-8343-343434343435",
      content: "The launch review confirmed the authentication requirement for beta.",
      lexicalContent: "launch review confirmed authentication requirement beta",
      createdAt: new Date("2026-05-30T09:00:00.000Z"),
      message: { provider: "fireflies_ai", senderLabel: "Owner", sentAt: new Date("2026-05-30T09:00:00.000Z"), providerPermalink: null, isDeletedByProvider: false },
      thread: { subject: "Launch review", rawMetadataJson: {} },
      connector: { provider: "fireflies_ai", accountLabel: "Fireflies", configJson: {} }
    }]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Compare the PRD with communication launch requirements.",
      selectedSources: ["all"],
      includeArtifacts: false
    });

    expect(result.citations).toContainEqual(expect.objectContaining({ sourceType: "communication_message" }));
    expect(result.sourceStates.slack).toMatchObject({ state: "ready", count: 0 });
    expect(result.limitations.join(" ")).not.toMatch(/Slack.*(?:not connected|no indexed)/i);
  });

  it("reports no matching Slack evidence without guessing connector status", async () => {
    const { service, prisma } = makeService({
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["slack"] as any
    });
    prisma.communicationMessageChunk.findMany.mockResolvedValueOnce([]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What do Slack messages say about launch requirements?",
      selectedSources: ["slack"],
      includeArtifacts: false
    });

    expect(result.sourceStates.slack).toMatchObject({ state: "empty", count: 0 });
    expect(result.limitations).toContainEqual(expect.stringMatching(/No indexed Slack evidence matched this question/i));
    expect(result.limitations.join(" ")).not.toMatch(/Slack is not connected/i);
  });

  it("reports no matching GitHub evidence without guessing repository connection status", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What GitHub evidence supports the launch requirement?",
      selectedSources: ["github"],
      includeArtifacts: false
    });

    expect(result.sourceStates.github).toMatchObject({ state: "empty", count: 0 });
    expect(result.limitations).toContainEqual(expect.stringMatching(/No indexed GitHub evidence matched this question/i));
    expect(result.limitations.join(" ")).not.toMatch(/GitHub evidence is not connected/i);
  });

  it("abstains with provider-specific guidance instead of substituting another provider", async () => {
    const { service, prisma } = makeService({
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["slack", "clickup"] as any
    });
    prisma.communicationMessageChunk.findMany.mockResolvedValueOnce([{
      id: "25252525-2525-4252-8252-252525252525",
      provider: "slack",
      messageId: "26262626-2626-4262-8262-262626262626",
      threadId: "27272727-2727-4272-8272-272727272727",
      connectorId: "28282828-2828-4282-8282-282828282828",
      content: "Unrelated Slack evidence.", lexicalContent: "slack", createdAt: new Date(),
      message: { provider: "slack", senderLabel: "Owner", sentAt: new Date(), providerPermalink: null, isDeletedByProvider: false },
      thread: { subject: "Slack", rawMetadataJson: {} }, connector: { provider: "slack", accountLabel: "Slack", configJson: {} }
    }]);

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize ClickUp",
      includeArtifacts: false
    });

    expect(result.retrievalSummary.evidenceCount).toBe(0);
    expect(result.citations).toEqual([]);
    expect(result.answer_md).toMatch(/No indexed ClickUp evidence/i);
    expect(result.limitations).toContainEqual(expect.stringMatching(/ClickUp/));
    expect(result.limitations.join(" ")).not.toMatch(/Slack|GitHub/i);
    expect((result.sourceStates as Record<string, { state: string; count: number }>).clickup).toMatchObject({ state: "empty", count: 0 });
  });

  it("marks an unavailable normal-chat provider fallback as degraded with an explicit limitation", async () => {
    const { service } = makeService();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "How do semaphores coordinate software threads?"
    });

    expect(result.modelMetadata).toMatchObject({ provider: "deterministic", degraded: true });
    expect(result.limitations).toContainEqual(expect.stringMatching(/fast chat model is unavailable/i));
  });

  it.each(["object", "streaming"])("preserves source identity, approval provenance and subset limits in the %s prompt path", async (path) => {
    const { service, generationProvider } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key" },
      { answer_md: "The backend contract documents the API routes. [E1]", confidence: "medium", limitations: [], suggested_prompts: [] }
    );
    await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "What backend API routes are documented?", selectedSources: ["documents"], includeArtifacts: false,
      ...(path === "streaming" ? { onDelta: () => undefined } : {})
    });
    const call = (path === "streaming" ? generationProvider.streamText : generationProvider.generateObject).mock.calls[0]![0];
    for (const prompt of [call.systemPrompt, call.prompt]) {
      expect(prompt).toContain("title, sourceType and truthStatus metadata");
      expect(prompt).toContain("Never equate a user-mentioned absent or archived source with another retrieved source");
      expect(prompt).toContain("If a requested source appears only in the question, with no supplied item or attributed excerpt from that source, explicitly say it was not supplied; never merge it with another item using archived/other shorthand");
      expect(prompt).toContain("Do not claim the contents of an unretrieved source");
      expect(prompt).toContain("does not establish accepted Product Brain truth");
      expect(prompt).toContain("Retrieved evidence is a subset, not an exhaustive inventory");
      expect(prompt).toContain("overridden, superseded or archived unless supplied evidence explicitly establishes that status");
      expect(prompt).toContain('Avoid source-exclusivity phrases such as "the only other supplied document"');
      expect(prompt).toContain('Prefer "The PRD specifies CSV export"');
    }
    expect(call.prompt).toContain("title: Backend Contract - Backend API");
    expect(call.prompt).toContain("sourceType: document");
    expect(call.prompt).toContain("truthStatus: evidence");
    expect(call.prompt).toContain('"acceptedDecisionReferences":[]');
    expect(call.prompt).toContain('"completeProjectInventory":false');
  });

  it.each(["object", "streaming"])("keeps temporal safeguards without demanding irrelevant timestamp prose in the %s prompt path", async (path) => {
    const { service, generationProvider } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key" },
      { answer_md: "The backend contract documents the API routes. [E1]", confidence: "medium", limitations: [], suggested_prompts: [] }
    );
    await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "What backend API routes are documented?", selectedSources: ["documents"], includeArtifacts: false,
      ...(path === "streaming" ? { onDelta: () => undefined } : {})
    });
    const call = (path === "streaming" ? generationProvider.streamText : generationProvider.generateObject).mock.calls[0]![0];
    for (const prompt of [call.systemPrompt, call.prompt]) {
      expect(prompt).toContain("For ordinary factual questions where timing is immaterial, do not print observation/request timestamps or add a temporal caveat");
      expect(prompt).toContain("A source title containing current does not by itself make the question temporal");
      expect(prompt).toContain("sourceType, truthStatus, observedAt and requestAt are internal reasoning metadata; describe source roles and acceptance status naturally, not as raw keys or enum values. Preserve exact timestamps when needed to explain a material temporal gap");
      expect(prompt).toMatch(/(?:Never invent or approximate|Do not estimate) an elapsed duration/);
    }
    expect(call.prompt).toContain("observedAt: 2026-05-28T10:00:00.000Z");
    expect(call.prompt).toMatch(/requestAt: \d{4}-\d{2}-\d{2}T/);
  });

  it("labels offline excerpts as unconfirmed answers without discarding retrieved evidence", async () => {
    const { service } = makeService();
    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "What backend API routes are documented?", selectedSources: ["documents"], includeArtifacts: false
    });
    expect(result.answer_md).toContain("I cannot confirm this answers your question");
    expect(result.answer_md).toContain("Backend Contract - Backend API");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.retrievalSummary.evidenceCount).toBeGreaterThan(0);
    expect(result.modelMetadata.provider).toBe("deterministic");
  });

  it("uses AI synthesis for Socrates v1 when OpenAI is configured while keeping deterministic citations", async () => {
    const { service, generationProvider } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MODEL: "gpt-5.4-mini",
        SOCRATES_GENERATION_TIMEOUT_MS: 120000,
        SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M: 1,
        SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M: 1
      },
      {
        answer_md:
          "BackpackerAI is a travel assistant. The PRD describes product intent [E1], and GitHub evidence shows the current API and frontend implementation.",
        confidence: "high",
        limitations: ["No live pilot analytics were supplied."],
        suggested_prompts: ["What gaps exist between the PRD and implementation?"]
      }
    );

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What is this project and what evidence supports it?",
      selectedSources: ["documents"],
      includeArtifacts: true
    });

    expect(generationProvider.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      task: "socrates_v1_answer",
      model: "gpt-5.4-mini",
      timeoutMs: 45000,
      prompt: expect.stringContaining("Backend Contract")
    }));
    const prompt = String(generationProvider.generateObject.mock.calls[0]?.[0]?.prompt);
    expect(prompt).toContain("observedAt: 2026-05-28T10:00:00.000Z");
    expect(prompt).toContain("distinguish historical evidence from verified current state");
    expect(prompt).toMatch(/requestAt: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    expect(prompt).toContain("Do not estimate an elapsed duration");
    expect(result.answer_md).toContain("BackpackerAI is a travel assistant");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.costEstimate.modelCalls).toBe(1);
    expect(result.modelMetadata).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini",
      degraded: false
    });
  });

  it.each(["object", "streaming"])("preserves all eight explicit citation identities through %s completion and persisted history", async (path) => {
    const answer = "The selected document sources are [E8][E2][E1][E3][E4][E5][E6][E7].";
    const { service, prisma, generationProvider, tx } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key", SOCRATES_MAX_EVIDENCE_ITEMS: 10, SOCRATES_MAX_CITATIONS: 6, SOCRATES_MAX_OPEN_TARGETS: 6 },
      { answer_md: answer, confidence: "medium", limitations: [], suggested_prompts: [] }
    );
    const base = (await prisma.documentChunk.findMany())[0];
    const id = (prefix: number, index: number) => `${prefix}0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    prisma.documentChunk.findMany.mockResolvedValue(Array.from({ length: 8 }, (_, index) => ({
      ...base, id: id(1, index), documentVersionId: id(2, index),
      content: `The backend contract source ${index + 1} documents an authenticated API route.`,
      lexicalContent: `backend contract source ${index + 1} authenticated api route`,
      section: { ...base.section, id: id(4, index) },
      documentVersion: { ...base.documentVersion, id: id(2, index),
        document: { ...base.documentVersion.document, id: id(3, index), currentVersionId: id(2, index), title: `Backend Contract ${index + 1}` } }
    })));
    const deltas: string[] = [];
    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID, question: "Summarize the backend contract evidence.",
      selectedSources: ["documents"], includeArtifacts: false,
      ...(path === "streaming" ? { onDelta: (delta: string) => { deltas.push(delta); } } : {})
    });
    const call = (path === "streaming" ? generationProvider.streamText : generationProvider.generateObject).mock.calls[0]![0];
    expect(call.prompt).toContain("### Evidence E8");
    expect(result.answer_md).toBe(answer);
    if (path === "streaming") expect(deltas.join("")).toBe(answer);
    expect(result.citations.map((row) => row.evidenceNumber)).toEqual([8, 2, 1, 3, 4, 5, 6, 7]);
    expect(result.citations.every((row) => row.sourceType === "document")).toBe(true);
    expect(result.open_targets).toHaveLength(8);
    for (const citation of result.citations) {
      expect(citation.refId).toBe(id(1, citation.evidenceNumber! - 1));
      const target = result.open_targets.find((item) => item.id === citation.openTargetId);
      expect(target && "documentId" in target.targetRef ? target.targetRef.documentId : undefined).toBe(id(3, citation.evidenceNumber! - 1));
    }
    const stored = (tx.socratesMessage.update as any).mock.calls[0][0].data;
    expect(stored.content).toBe(answer);
    expect(stored.answerPayloadJson.citations).toEqual(result.citations);
    expect(stored.answerPayloadJson.open_targets).toEqual(result.open_targets);
    expect((tx.socratesCitation.createMany as any).mock.calls[0][0].data).toHaveLength(8);
    expect((tx.socratesOpenTarget.createMany as any).mock.calls[0][0].data).toHaveLength(8);
    prisma.socratesSession.findFirst.mockResolvedValue({ id: SESSION_ID, projectId: PROJECT_ID, userId: USER_ID });
    prisma.socratesMessage.findMany.mockResolvedValue([{ id: ASSISTANT_MESSAGE_ID, role: "assistant", ...stored }]);
    const history = await service.getHistory(PROJECT_ID, SESSION_ID, USER_ID, true);
    expect(history[0]?.answerPayloadJson).toEqual(stored.answerPayloadJson);
  });

  it("falls back to grounded evidence when the model cites beyond the prompt", async () => {
    const { service, prisma } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MAX_EVIDENCE_ITEMS: 25,
        SOCRATES_MAX_CITATIONS: 25
      },
      {
        answer_md: "This unsupported claim cites evidence that was never shown to the model. [E11]",
        confidence: "high",
        limitations: [],
        suggested_prompts: []
      }
    );
    prisma.gitHubEngineeringEvidence.findMany.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, index) => ({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        projectId: PROJECT_ID,
        evidenceType: "github_commit",
        evidenceStatus: "active",
        title: `launch evidence ${index + 1}`,
        summary: `Verified launch implementation evidence item ${index + 1}.`,
        repositoryOwner: "KarthikRamesh9149",
        repositoryName: "orchestrav2",
        sha: String(index + 1).padStart(40, "0"),
        occurredAt: new Date(Date.UTC(2026, 7, 23, 12, index)),
        createdAt: new Date(Date.UTC(2026, 7, 23, 12, index)),
        mappedUser: null,
        actorGithubLogin: "karthik"
      }))
    );

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize the GitHub launch evidence.",
      selectedSources: ["github"],
      maxEvidence: 25,
      includeArtifacts: false,
      includeHistory: false
    });

    expect(result.answer_md).not.toContain("[E11]");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.open_targets.length).toBeGreaterThan(0);
    expect(result.limitations).toContainEqual(expect.stringMatching(/failed evidence-marker validation/i));
    expect(result.modelMetadata.degraded).toBe(true);
  });

  it.each(["100", "0", "9".repeat(400)])("rejects invalid evidence marker E%s even alongside a valid marker", async (marker) => {
    const { service } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key" },
      { answer_md: `Supported statement [E1]. Fabricated statement [E${marker}].`, confidence: "high", limitations: [], suggested_prompts: [] }
    );
    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID, actorUserId: USER_ID,
      question: "What backend API routes are documented?", selectedSources: ["documents"], includeArtifacts: false
    });
    expect(result.answer_md).not.toContain("Fabricated statement");
    expect(result.answer_md).not.toContain(`[E${marker}]`);
    expect(result.modelMetadata.degraded).toBe(true);
    expect(result.limitations).toContainEqual(expect.stringMatching(/failed evidence-marker validation/i));
  });

  it("rejects invented elapsed-time arithmetic in current-state answers", async () => {
    const { service } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key", SOCRATES_MODEL: "gpt-5.4-mini" },
      {
        answer_md: "The audit was earlier than requestAt by 0h07m32.540s. [E1]",
        confidence: "high",
        limitations: [],
        suggested_prompts: []
      }
    );

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "What is the latest current state?",
      selectedSources: ["documents"],
      includeArtifacts: false
    });

    expect(result.answer_md).toContain("## Latest timestamped evidence");
    expect(result.answer_md).toContain("2026-05-28T10:00:00.000Z");
    expect(result.answer_md).toContain("No elapsed duration is inferred");
    expect(result.answer_md).not.toContain("0h07m32.540s");
    expect(result.citations.map((citation) => citation.label)).toEqual(["Backend Contract - Backend API"]);
    expect(result.limitations).toContainEqual(expect.stringMatching(/unverified elapsed duration/i));
    expect(result.modelMetadata.degraded).toBe(true);
  });

  it("[FIX-13] forwards provider token deltas before persisting the completed v1 answer", async () => {
    const answer = "The first provider tokens arrive before this grounded answer completes [E1].";
    const { service, generationProvider, prisma } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key", SOCRATES_MODEL: "gpt-5.4-mini" },
      { answer_md: answer, confidence: "high", limitations: [], suggested_prompts: [] }
    );
    const deltas: string[] = [];
    const created = vi.fn();

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize the backend contract from project evidence.",
      selectedSources: ["documents"],
      includeArtifacts: false,
      onMessageCreated: created,
      onDelta: (delta) => { deltas.push(delta); }
    });

    expect(created).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      createdAt: expect.any(String)
    }));
    expect(generationProvider.streamText).toHaveBeenCalledTimes(1);
    expect(generationProvider.streamText).toHaveBeenCalledWith(expect.objectContaining({
      model: "mock-router",
      maxOutputTokens: 600,
      timeoutMs: 8000
    }));
    const streamedPrompt = generationProvider.streamText.mock.calls[0]?.[0]?.prompt as string;
    expect(streamedPrompt.length).toBeLessThan(8_000);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(answer);
    expect(result.answer_md).toBe(answer);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("[FIX-36] keeps multi-source readiness chat on the bounded low-latency router", async () => {
    const answer = "Proceed with a controlled pilot, with the cited launch gaps tracked explicitly [E1].";
    const { service, generationProvider } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MODEL: "gpt-5.4-mini",
        SOCRATES_ROUTER_MODEL: "gpt-5.4-nano",
        SOCRATES_GENERATION_TIMEOUT_MS: 30_000,
      },
      { answer_md: answer, confidence: "high", limitations: [], suggested_prompts: [] }
    );

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Using every source, give me a production-readiness verdict.",
      includeArtifacts: false,
      onDelta: () => undefined,
    });

    expect(generationProvider.streamText).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.4-nano",
      maxOutputTokens: 900,
      timeoutMs: 12000,
    }));
    expect(result.answer_md).toBe(answer);
    expect(result.modelMetadata).toMatchObject({ model: "gpt-5.4-nano", degraded: false });
  });

  it("[FIX-36] does not block token streaming on slow partial database saves", async () => {
    const answer = "Ship a controlled pilot after the cited launch gaps are tracked [E1].";
    const { service, prisma } = makeService(
      { OPENAI_API_KEY: "sk-test-openai-key" },
      { answer_md: answer, confidence: "high", limitations: [], suggested_prompts: [] }
    );
    let releasePartial!: () => void;
    const slowPartial = new Promise<void>((resolve) => { releasePartial = resolve; });
    prisma.socratesMessage.updateMany.mockImplementationOnce(async () => {
      await slowPartial;
      return { count: 1 };
    });
    let streamBody = "";
    const reply = {
      raw: {
        destroyed: false,
        writableEnded: false,
        writeHead: vi.fn(),
        write: vi.fn((chunk: string) => { streamBody += chunk; return true; }),
        end: vi.fn(),
      },
    };

    const request = service.streamV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Using project evidence, should we run a controlled pilot?",
      includeArtifacts: false,
    }, reply as any);

    await vi.waitFor(() => expect(streamBody).toContain("event: done"));
    expect(streamBody).toContain(answer);
    releasePartial();
    await request;
  });

  it("coalesces and briefly caches prewarmed multi-source evidence without a model call", async () => {
    const { service, prisma, generationProvider, projectService } = makeService();

    const [first, concurrent] = await Promise.all([
      service.prewarmV1ProjectMemory(PROJECT_ID, USER_ID, "manager"),
      service.prewarmV1ProjectMemory(PROJECT_ID, USER_ID, "manager")
    ]);
    const second = await service.prewarmV1ProjectMemory(PROJECT_ID, USER_ID, "manager");

    expect(first.warmed).toBe(true);
    expect(concurrent.warmed).toBe(true);
    expect(second.expiresInMs).toBe(60_000);
    expect(prisma.documentChunk.findMany.mock.calls.filter(([args]: any) => args.include)).toHaveLength(1);
    expect(prisma.documentChunk.findMany.mock.calls.filter(([args]: any) => args.select)).toHaveLength(3);
    expect(prisma.communicationMessageChunk.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.gitHubEngineeringEvidence.findMany).toHaveBeenCalledTimes(1);
    expect(generationProvider.streamText).not.toHaveBeenCalled();
    expect(generationProvider.generateObject).not.toHaveBeenCalled();
    expect(projectService.ensureProjectMemberCanUseSocrates).not.toHaveBeenCalled();
  });

  it("accepts common OpenAI JSON key variants without degrading to evidence snippets", async () => {
    const { service, generationProvider } = makeService(
      {
        OPENAI_API_KEY: "sk-test-openai-key",
        SOCRATES_MODEL: "gpt-5.4-mini"
      },
      {
        answer: "The project is a grounded BackpackerAI travel assistant summary synthesized from the PRD and repo evidence [E1].",
        confidence: 0.92,
        caveats: "No production analytics were supplied.",
        followups: ["Which pilot-readiness gaps matter most?"],
        extra_model_note: "ignored"
      }
    );

    const result = await service.askV1ProjectMemory({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      question: "Summarize BackpackerAI from PRD and GitHub",
      selectedSources: ["documents"],
      includeArtifacts: true
    });

    expect(generationProvider.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      task: "socrates_v1_answer"
    }));
    expect(result.answer_md).toContain("synthesized from the PRD and repo evidence");
    expect(result.answer_md).not.toMatch(/^Based on the current project evidence/i);
    expect(result.confidence).toBe("high");
    expect(result.limitations).toEqual(["No production analytics were supplied."]);
    expect(result.suggested_prompts).toEqual(["Which pilot-readiness gaps matter most?"]);
    expect(result.modelMetadata.degraded).toBe(false);
  });
});
