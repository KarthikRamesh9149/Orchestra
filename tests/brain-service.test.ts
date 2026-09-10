import { describe, expect, it, vi } from "vitest";
import { BrainService } from "../src/modules/brain/service.js";
import {
  brainGraphSchema,
  clarifiedBriefSchema,
  productBrainSchema,
  sourcePackageSchema
} from "../src/modules/brain/schemas.js";

describe("BrainService", () => {
  it("returns unresolved areas and accepted decisions in the current brain read model", async () => {
    const prisma = {
      artifactVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "brain-1",
            versionNumber: 3,
            payloadJson: {
              whatTheProductIs: "A product brain",
              whoItIsFor: ["Managers"],
              mainFlows: ["Ingest docs"],
              modules: ["Upload"],
              constraints: ["Immutable sources"],
              integrations: [],
              unresolvedAreas: ["Open client decision"],
              acceptedDecisions: [],
              recentAcceptedChanges: [],
              evidenceRefs: []
            },
            sourceRefsJson: [],
            acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z")
          })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
      },
      document: {
        findMany: vi.fn().mockResolvedValue([])
      },
      decisionRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "decision-1",
            title: "Keep managers as approvers",
            statement: "Managers remain the only truth approvers",
            status: "accepted"
          }
        ])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as any;

    const service = new BrainService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any
    );

    const result = await service.getCurrentBrain("project-1", "user-1");

    expect(result.unresolvedAreas).toEqual(["Open client decision"]);
    expect(result.acceptedDecisions[0]).toMatchObject({
      id: "decision-1",
      title: "Keep managers as approvers"
    });
  });

  it("invalidates Socrates suggestions when a new accepted artifact version is created", async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      artifactVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "source-1",
            payloadJson: {
              projectSummary: "Product source " + "x".repeat(20_000),
              actors: ["Manager"],
              features: ["Upload"],
              constraints: [],
              integrations: [],
              contradictions: [],
              unknowns: [],
              risks: [],
              sourceConfidence: 0.8,
              evidenceRefs: []
            }
          })
          .mockResolvedValueOnce({
            id: "clarified-1",
            payloadJson: {
              summary: "Clarified truth",
              targetUsers: ["Manager"],
              flows: ["Upload"],
              scope: ["Upload"],
              constraints: [],
              integrations: [],
              unresolvedDecisions: [],
              assumptions: [],
              risks: [],
              evidenceRefs: []
            }
          })
          .mockResolvedValueOnce({
            id: "graph-1",
            payloadJson: {
              nodes: [],
              edges: [],
              criticalPaths: [],
              riskyAreas: [],
              unresolvedAreas: []
            }
          })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: "old-brain", versionNumber: 2, changeSummary: "old" })
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      decisionRecord: {
        findMany: vi.fn().mockResolvedValue([])
      },
      socratesSuggestion: {
        deleteMany
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      $transaction: vi.fn(async (callback) =>
        callback({
          artifactVersion: {
            findFirst: vi
              .fn()
              .mockResolvedValueOnce({ id: "old-brain", versionNumber: 2, changeSummary: "old" })
              .mockResolvedValueOnce({ id: "old-brain", versionNumber: 2, changeSummary: "old" }),
            updateMany: vi.fn().mockResolvedValue(undefined),
            create: vi.fn().mockResolvedValue({
              id: "new-brain",
              versionNumber: 3,
              payloadJson: {
                whatTheProductIs: "Current truth",
                whoItIsFor: ["Manager"],
                mainFlows: ["Upload"],
                modules: ["Product Brain"],
                constraints: [],
                integrations: [],
                unresolvedAreas: [],
                acceptedDecisions: [],
                recentAcceptedChanges: [],
                evidenceRefs: []
              },
              sourceRefsJson: [],
              acceptedAt: new Date(),
              createdAt: new Date(),
              changeSummary: "new-signature",
              artifactType: "product_brain",
              status: "accepted"
            })
          },
          socratesSuggestion: {
            deleteMany
          }
        })
      )
    } as any;
    const generateObject = vi.fn(async ({ fallback }: { fallback: () => unknown }) => fallback());

    const service = new BrainService(
      prisma,
      { generateObject } as any,
      { enqueue: vi.fn() } as any,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any
    );

    await service.generateProductBrain("project-1", "user-1");

    expect(generateObject).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        session: {
          projectId: "project-1"
        }
      }
    });
  });

  it("generates source packages from current parsed document versions only", async () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    const oldVersion = {
      id: "ver-old",
      documentId: "doc-1",
      projectId: "project-1",
      checksumSha256: "old-checksum",
      parseRevision: 1,
      processedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "ready",
      document: { id: "doc-1", title: "Core PRD", kind: "prd" }
    };
    const currentVersion = {
      id: "ver-current",
      documentId: "doc-1",
      projectId: "project-1",
      checksumSha256: "current-checksum",
      parseRevision: 2,
      processedAt: now,
      createdAt: now,
      status: "ready",
      document: { id: "doc-1", title: "Core PRD", kind: "prd" }
    };
    const partialVersion = {
      id: "ver-partial-current",
      documentId: "doc-2",
      projectId: "project-1",
      checksumSha256: "partial-checksum",
      parseRevision: 1,
      processedAt: now,
      createdAt: now,
      status: "partial",
      document: { id: "doc-2", title: "Support SRS", kind: "srs" }
    };
    const generatedVersion = {
      id: "ver-generated-current",
      documentId: "doc-generated",
      projectId: "project-1",
      checksumSha256: "generated-checksum",
      parseRevision: 1,
      processedAt: now,
      createdAt: now,
      status: "ready",
      sourceLabel: "generated_by_socrates",
      document: { id: "doc-generated", title: "Generated MVP PRD", kind: "prd" }
    };

    const artifactCreate = vi.fn().mockResolvedValue({
      id: "source-new",
      artifactType: "source_package",
      versionNumber: 1,
      payloadJson: {},
      sourceRefsJson: [],
      acceptedAt: now,
      createdAt: now,
      changeSummary: "signature",
      status: "accepted"
    });
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          { id: "doc-1", title: "Core PRD", kind: "prd", currentVersionId: "ver-current" },
          { id: "doc-2", title: "Support SRS", kind: "srs", currentVersionId: "ver-partial-current" },
          { id: "doc-generated", title: "Generated MVP PRD", kind: "prd", currentVersionId: "ver-generated-current" },
          { id: "doc-3", title: "Failed Draft", kind: "prd", currentVersionId: "ver-failed" }
        ])
      },
      documentVersion: {
        findMany: vi.fn(async (args?: any) => {
          if (args?.where?.id?.in) {
            return [currentVersion, partialVersion, generatedVersion];
          }
          return [oldVersion, currentVersion];
        })
      },
      documentSection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-old",
            documentVersionId: "ver-old",
            parseRevision: 1,
            anchorText: "Old billing",
            normalizedText: "Old stale billing section must not feed current source package."
          },
          {
            id: "sec-current",
            documentVersionId: "ver-current",
            parseRevision: 2,
            anchorText: "Current billing",
            normalizedText: "Current billing section should feed the source package."
          },
          {
            id: "sec-partial",
            documentVersionId: "ver-partial-current",
            parseRevision: 1,
            anchorText: "Partial dispatch",
            normalizedText: "Partial current parsed section should feed the source package."
          },
          {
            id: "sec-generated",
            documentVersionId: "ver-generated-current",
            parseRevision: 1,
            anchorText: "Generated onboarding",
            normalizedText: "Generated onboarding section should feed the source package after processing."
          }
        ])
      },
      projectContextChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "context-chunk-1",
            contextEntryId: "context-1",
            contextualText: "Manual context: decision_note / KYC onboarding decision — Client PM said onboarding must support KYC before payment setup.",
            updatedAt: now,
            contextEntry: {
              id: "context-1",
              title: "KYC onboarding decision",
              type: "decision_note",
              bodyHash: "context-hash-1"
            }
          }
        ])
      },
      artifactVersion: {
        findFirst: vi.fn()
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      socratesSuggestion: {
        deleteMany: vi.fn().mockResolvedValue(undefined)
      },
      $transaction: vi.fn(async (callback) =>
        callback({
          artifactVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
            updateMany: vi.fn().mockResolvedValue(undefined),
            create: artifactCreate
          },
          socratesSuggestion: {
            deleteMany: vi.fn().mockResolvedValue(undefined)
          }
        })
      )
    } as any;
    const generateObject = vi.fn(async ({ fallback }: { fallback: () => unknown }) => fallback());

    const service = new BrainService(
      prisma,
      { generateObject } as any,
      { enqueue: vi.fn() } as any,
      { ensureProjectAccess: vi.fn(), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any
    );

    await service.generateSourcePackage("project-1", "manager-1");

    expect(generateObject).not.toHaveBeenCalled();
    const persistedPayload = JSON.stringify(artifactCreate.mock.calls[0][0].data.payloadJson);
    expect(persistedPayload).toContain("Current billing section should feed the source package");
    expect(persistedPayload).toContain("Partial current parsed section should feed the source package");
    expect(persistedPayload).toContain("Generated onboarding section should feed the source package");
    expect(persistedPayload).toContain("KYC onboarding decision");
    expect(persistedPayload).not.toContain("Old stale billing section");
    expect(artifactCreate.mock.calls[0][0].data.sourceRefsJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentVersionId: "ver-current", sectionId: "sec-current" }),
        expect.objectContaining({ documentVersionId: "ver-partial-current", sectionId: "sec-partial" }),
        expect.objectContaining({ documentVersionId: "ver-generated-current", sectionId: "sec-generated" }),
        expect.objectContaining({ contextId: "context-1", contextChunkId: "context-chunk-1" })
      ])
    );
  });

  it("rejects unknown fields in Product Brain artifact schemas", () => {
    expect(() =>
      sourcePackageSchema.parse({
        projectSummary: "Summary",
        actors: [],
        features: [],
        constraints: [],
        integrations: [],
        contradictions: [],
        unknowns: [],
        risks: [],
        sourceConfidence: 0.5,
        evidenceRefs: [],
        hallucinatedField: "must fail"
      })
    ).toThrow();

    expect(() =>
      clarifiedBriefSchema.parse({
        summary: "Summary",
        targetUsers: [],
        flows: [],
        scope: [],
        constraints: [],
        integrations: [],
        unresolvedDecisions: [],
        assumptions: [],
        risks: [],
        evidenceRefs: [],
        hallucinatedField: "must fail"
      })
    ).toThrow();

    expect(() =>
      brainGraphSchema.parse({
        nodes: [
          {
            nodeKey: "module-1",
            nodeType: "module",
            title: "Module",
            summary: "Module summary",
            status: "active",
            linkedSectionIds: [],
            hallucinatedField: "must fail"
          }
        ],
        edges: [
          {
            fromNodeKey: "module-1",
            toNodeKey: "module-1",
            edgeType: "relates_to",
            hallucinatedField: "must fail"
          }
        ],
        criticalPaths: [],
        riskyAreas: [],
        unresolvedAreas: []
      })
    ).toThrow();

    expect(() =>
      productBrainSchema.parse({
        whatTheProductIs: "Product",
        whoItIsFor: [],
        mainFlows: [],
        modules: [],
        constraints: [],
        integrations: [],
        unresolvedAreas: [],
        acceptedDecisions: [],
        recentAcceptedChanges: [],
        evidenceRefs: [],
        hallucinatedField: "must fail"
      })
    ).toThrow();
  });

  it("returns a client-safe current brain projection", async () => {
    const prisma = {
      artifactVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: "brain-2",
            versionNumber: 4,
            payloadJson: {
              whatTheProductIs: "A product brain",
              whoItIsFor: ["Managers", "Clients"],
              mainFlows: ["Ingest docs", "Review changes"],
              modules: ["Upload", "Brain"],
              constraints: ["Immutable sources"],
              integrations: [],
              unresolvedAreas: ["Pending launch wording"],
              acceptedDecisions: [{ decisionId: "decision-internal", title: "Internal decision", statement: "Internal statement" }],
              recentAcceptedChanges: [{ proposalId: "proposal-internal", title: "Internal proposal", summary: "Internal summary" }],
              evidenceRefs: [
                { documentId: "doc-shared", excerpt: "Shared excerpt" },
                { documentId: "doc-internal", excerpt: "Internal excerpt" }
              ]
            },
            sourceRefsJson: [],
            acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
            createdAt: new Date("2026-01-01T00:00:00.000Z")
          })
          .mockResolvedValueOnce({
            id: "source-2",
            versionNumber: 2,
            payloadJson: {
              projectSummary: "Internal source package",
              actors: ["Manager"],
              features: ["Upload"],
              constraints: [],
              integrations: [],
              contradictions: [],
              unknowns: [],
              risks: [],
              sourceConfidence: 0.9,
              evidenceRefs: []
            }
          })
          .mockResolvedValueOnce({
            id: "brief-2",
            versionNumber: 2,
            payloadJson: {
              summary: "Internal brief",
              targetUsers: ["Manager"],
              flows: ["Upload"],
              scope: ["Upload"],
              constraints: [],
              integrations: [],
              unresolvedDecisions: [],
              assumptions: [],
              risks: [],
              evidenceRefs: []
            }
          })
      },
      document: {
        findMany: vi.fn().mockResolvedValue([{ id: "doc-shared" }])
      },
      decisionRecord: {
        findMany: vi.fn().mockResolvedValue([
          { id: "decision-1", title: "Internal decision", statement: "Internal", status: "accepted" }
        ])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([
          { id: "proposal-1", title: "Internal proposal", summary: "Hidden", acceptedAt: new Date(), decisionRecordId: null }
        ])
      }
    } as any;

    const service = new BrainService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "client" }), ensureProjectManager: vi.fn() } as any,
      { record: vi.fn() } as any
    );

    const result = await service.getCurrentBrain("project-1", "client-1");

    expect(result.sourcePackage).toBeNull();
    expect(result.clarifiedBrief).toBeNull();
    expect(result.acceptedDecisions).toEqual([]);
    expect(result.recentAcceptedChanges).toEqual([]);
    expect(result.currentBrain).not.toBeNull();
    expect(result.currentBrain!.payload!.evidenceRefs).toEqual([{ documentId: "doc-shared", excerpt: "Shared excerpt" }]);
  });
});
