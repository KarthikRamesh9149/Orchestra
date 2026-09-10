import { describe, expect, it, vi } from "vitest";
import { domainsFromPlan, buildRetrievalPlan } from "../src/lib/retrieval/planner.js";
import { hybridRetrieveDetailed } from "../src/lib/retrieval/hybrid.js";

describe("manual context retrieval", () => {
  it("retrieves active project context chunks as internal citable evidence", async () => {
    const prisma = {
      artifactVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      projectContextChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "33333333-3333-4333-8333-333333333333",
            contextEntryId: "22222222-2222-4222-8222-222222222222",
            rawText: "Client PM said onboarding must support KYC before payment setup.",
            contextualText: "Manual context: decision_note / KYC onboarding decision — Client PM said onboarding must support KYC before payment setup.",
            lexicalText: "kyc onboarding decision client pm",
            updatedAt: new Date("2026-05-01T00:00:00.000Z"),
            contextEntry: {
              id: "22222222-2222-4222-8222-222222222222",
              type: "decision_note",
              title: "KYC onboarding decision",
              participantsJson: ["Client PM"],
              tagsJson: ["kyc", "onboarding"],
              sourceDate: new Date("2026-05-01T00:00:00.000Z"),
              linkedMemberId: null,
              importance: "high",
              status: "active",
              attachments: []
            }
          }
        ])
      }
    } as any;

    const plan = buildRetrievalPlan({
      intent: "manual_context",
      pageContext: "dashboard_project",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 8,
      rerankTopK: 5
    });

    const result = await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      pageContext: "dashboard_project",
      query: "What did we manually record about onboarding KYC?",
      queryEmbedding: [],
      intent: "manual_context",
      domains: domainsFromPlan(plan),
      topK: 5,
      minScore: 0,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 1,
      plan
    });

    expect(prisma.projectContextChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
          contextEntry: { status: "active" }
        }
      })
    );
    expect(result.candidates[0]).toMatchObject({
      sourceType: "project_context",
      domain: "project_context",
      contextId: "22222222-2222-4222-8222-222222222222",
      contextChunkId: "33333333-3333-4333-8333-333333333333",
      citationRef: { type: "project_context", id: "22222222-2222-4222-8222-222222222222" },
      openTarget: {
        targetType: "project_context",
        targetRef: {
          projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
          contextId: "22222222-2222-4222-8222-222222222222",
          contextChunkId: "33333333-3333-4333-8333-333333333333"
        }
      },
      isInternalOnly: true
    });
  });

  it("does not retrieve manual context in client-safe context", async () => {
    const prisma = {
      artifactVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      documentChunk: { findMany: vi.fn().mockResolvedValue([]) },
      projectContextChunk: { findMany: vi.fn() }
    } as any;
    const plan = buildRetrievalPlan({
      intent: "manual_context",
      pageContext: "client_view",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: true,
      retrievalTopK: 8,
      rerankTopK: 5
    });

    const result = await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      pageContext: "client_view",
      query: "What manual notes exist?",
      queryEmbedding: [],
      intent: "manual_context",
      domains: domainsFromPlan(plan),
      topK: 5,
      minScore: 0,
      isClientContext: true,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 1,
      plan
    });

    expect(prisma.projectContextChunk.findMany).not.toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
  });

  it("retrieves captioned image context with attachment open target metadata", async () => {
    const prisma = {
      artifactVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      projectContextChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "33333333-3333-4333-8333-333333333333",
            contextEntryId: "22222222-2222-4222-8222-222222222222",
            rawText: "Caption: WhatsApp screenshot showing onboarding KYC feedback.",
            contextualText: "Manual context: screenshot_caption / WhatsApp onboarding screenshot — Evidence limitation: Socrates only has the user-provided caption/description.",
            lexicalText: "whatsapp onboarding screenshot kyc caption",
            updatedAt: new Date("2026-05-01T00:00:00.000Z"),
            contextEntry: {
              id: "22222222-2222-4222-8222-222222222222",
              type: "screenshot_caption",
              title: "WhatsApp onboarding screenshot",
              participantsJson: [],
              tagsJson: ["whatsapp", "onboarding"],
              sourceDate: null,
              linkedMemberId: null,
              importance: "normal",
              status: "active",
              attachments: [
                {
                  id: "44444444-4444-4444-8444-444444444444",
                  attachmentKind: "image",
                  mimeType: "image/png",
                  originalFilename: "whatsapp.png",
                  filename: "whatsapp.png",
                  caption: "WhatsApp screenshot showing onboarding KYC feedback.",
                  description: null
                }
              ]
            }
          }
        ])
      }
    } as any;
    const plan = buildRetrievalPlan({
      intent: "manual_context",
      pageContext: "dashboard_project",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 8,
      rerankTopK: 5
    });

    const result = await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      projectId: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
      pageContext: "dashboard_project",
      query: "What does the WhatsApp screenshot say about onboarding KYC?",
      queryEmbedding: [],
      intent: "manual_context",
      domains: domainsFromPlan(plan),
      topK: 5,
      minScore: 0,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 1,
      plan
    });

    expect(result.candidates[0]).toMatchObject({
      sourceType: "project_context",
      contextType: "screenshot_caption",
      openTarget: {
        targetType: "project_context",
        targetRef: {
          contextId: "22222222-2222-4222-8222-222222222222",
          contextChunkId: "33333333-3333-4333-8333-333333333333",
          attachmentId: "44444444-4444-4444-8444-444444444444"
        }
      }
    });
    expect(result.candidates[0].whySelected).toContain("captioned image context");
  });
});
