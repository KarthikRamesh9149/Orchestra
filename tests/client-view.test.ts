/**
 * Feature 6 — Client Portal tests.
 *
 * Covers:
 *  1. Token helper (generate / hash / verify)
 *  2. ClientSharesService (create / rotate / revoke / resolve)
 *  3. ClientViewService (bootstrap / brain / graph / docs / provenance)
 *  4. Security invariants (revoked/expired token rejection, internal-data exclusion)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateClientShareToken,
  hashToken,
  verifyToken
} from "../src/modules/client-view/client-share-token.js";
import { ClientSharesService } from "../src/modules/client-view/client-shares.service.js";
import { ClientViewService } from "../src/modules/client-view/client-view.service.js";
import {
  projectBrainForClient,
  projectGraphForClient,
  projectDocumentListForClient,
  projectSectionForClient,
  buildClientProjectSummary
} from "../src/modules/client-view/client-view.projections.js";
import { defaultClientShareConfig } from "../src/modules/client-view/client-view.schemas.js";

const SECRET = "test_secret_for_client_share_tokens_32bytes";

// ─── 1. Token helper ─────────────────────────────────────────────────────────

describe("client-share-token", () => {
  it("generates a high-entropy token with cs_ prefix", () => {
    const { rawToken } = generateClientShareToken(SECRET);
    expect(rawToken).toMatch(/^cs_/);
    expect(rawToken.length).toBeGreaterThan(40);
  });

  it("never stores raw token — only hash", () => {
    const { rawToken, tokenHash } = generateClientShareToken(SECRET);
    expect(tokenHash).not.toContain(rawToken);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokenPrefix is the leading characters of the raw token", () => {
    const { rawToken, tokenPrefix } = generateClientShareToken(SECRET);
    expect(rawToken.startsWith(tokenPrefix)).toBe(true);
    expect(tokenPrefix.length).toBeGreaterThanOrEqual(7);
  });

  it("verifyToken returns true for the correct raw token", () => {
    const { rawToken, tokenHash } = generateClientShareToken(SECRET);
    expect(verifyToken(rawToken, tokenHash, SECRET)).toBe(true);
  });

  it("verifyToken returns false for a wrong token", () => {
    const { tokenHash } = generateClientShareToken(SECRET);
    expect(verifyToken("cs_wrong_token", tokenHash, SECRET)).toBe(false);
  });

  it("verifyToken returns false for a wrong secret", () => {
    const { rawToken, tokenHash } = generateClientShareToken(SECRET);
    expect(verifyToken(rawToken, tokenHash, "different_secret")).toBe(false);
  });

  it("two different tokens produce different hashes", () => {
    const a = generateClientShareToken(SECRET);
    const b = generateClientShareToken(SECRET);
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hashToken is deterministic", () => {
    expect(hashToken("cs_abc", SECRET)).toBe(hashToken("cs_abc", SECRET));
  });
});

// ─── 2. ClientSharesService ──────────────────────────────────────────────────

function makeSharePrisma(overrides: Record<string, unknown> = {}) {
  const share = {
    id: "share-1",
    projectId: "project-1",
    orgId: "org-1",
    name: "Acme share",
    tokenHash: hashToken("cs_testtoken", SECRET),
    tokenPrefix: "cs_testt",
    status: "active",
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    createdBy: "user-manager",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    lastAccessedAt: null,
    configJson: defaultClientShareConfig,
    ...overrides
  };

  return {
    projectClientShare: {
      create: vi.fn().mockResolvedValue(share),
      findMany: vi.fn().mockResolvedValue([share]),
      findFirst: vi.fn().mockResolvedValue(share),
      findUnique: vi.fn().mockResolvedValue({ ...share, project: { id: "project-1", orgId: "org-1", name: "Test Project", description: null, previewUrl: null, status: "active" } }),
      update: vi.fn().mockImplementation((args) =>
        Promise.resolve({ ...share, ...args.data })
      ),
      count: vi.fn().mockResolvedValue(1)
    },
    project: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "project-1",
        orgId: "org-1",
        name: "Test Project",
        description: null,
        previewUrl: null,
        status: "active"
      })
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({})
    }
  };
}

function makeProjectService(overrides = {}) {
  return {
    ensureProjectManager: vi.fn().mockResolvedValue({ projectRole: "manager" }),
    ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
    ...overrides
  };
}

function makeAuditService() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

describe("ClientSharesService", () => {
  it("createShare returns rawToken and clientUrl only on creation", async () => {
    const prisma = makeSharePrisma() as any;
    const service = new ClientSharesService(
      prisma, makeProjectService() as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    const result = await service.createShare("project-1", "user-manager", { name: "Test share" });
    expect(result.token).toMatch(/^cs_/);
    expect(result.clientUrl).toContain(result.token);
    expect("tokenHash" in result.share).toBe(false);
  });

  it("listShares does not include tokenHash or raw token", async () => {
    const prisma = makeSharePrisma() as any;
    const service = new ClientSharesService(
      prisma, makeProjectService() as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    const shares = await service.listShares("project-1", "user-manager");
    for (const share of shares) {
      expect("tokenHash" in share).toBe(false);
    }
  });

  it("rotateToken returns new raw token and invalidates old", async () => {
    const prisma = makeSharePrisma() as any;
    const service = new ClientSharesService(
      prisma, makeProjectService() as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    const result = await service.rotateToken("project-1", "share-1", "user-manager");
    expect(result.token).toMatch(/^cs_/);
    // update should have been called with new tokenHash
    expect(prisma.projectClientShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenHash: expect.any(String) })
      })
    );
  });

  it("revokeShare sets status=revoked and revokedBy", async () => {
    const prisma = makeSharePrisma() as any;
    const service = new ClientSharesService(
      prisma, makeProjectService() as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    await service.revokeShare("project-1", "share-1", "user-manager");
    expect(prisma.projectClientShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "revoked", revokedBy: "user-manager" })
      })
    );
  });

  it("resolveShareByToken rejects revoked share", async () => {
    const { rawToken, tokenHash } = generateClientShareToken(SECRET);
    const prisma = makeSharePrisma({ tokenHash, status: "revoked" }) as any;
    // Override findUnique to return the revoked share
    prisma.projectClientShare.findUnique = vi.fn().mockResolvedValue({
      id: "share-1", projectId: "project-1", orgId: "org-1", name: "Acme share",
      tokenHash, tokenPrefix: "cs_testt", status: "revoked",
      expiresAt: null, revokedAt: new Date(), revokedBy: "user-manager",
      createdBy: "user-manager", createdAt: new Date(), updatedAt: new Date(),
      lastAccessedAt: null, configJson: defaultClientShareConfig,
      project: { id: "project-1", orgId: "org-1", name: "Test", description: null, previewUrl: null, status: "active" }
    });
    const service = new ClientSharesService(
      prisma, makeProjectService() as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    await expect(service.resolveShareByToken(rawToken)).rejects.toMatchObject({ code: "client_share_revoked" });
  });

  it("resolveShareByToken rejects expired share", async () => {
    const { rawToken, tokenHash } = generateClientShareToken(SECRET);
    const pastDate = new Date(Date.now() - 1000);
    const prisma = makeSharePrisma({ tokenHash, status: "active", expiresAt: pastDate }) as any;
    prisma.projectClientShare.findUnique = vi.fn().mockResolvedValue({
      id: "share-1", projectId: "project-1", orgId: "org-1", name: "Acme share",
      tokenHash, tokenPrefix: "cs_testt", status: "active",
      expiresAt: pastDate, revokedAt: null, revokedBy: null,
      createdBy: "user-manager", createdAt: new Date(), updatedAt: new Date(),
      lastAccessedAt: null, configJson: defaultClientShareConfig,
      project: { id: "project-1", orgId: "org-1", name: "Test", description: null, previewUrl: null, status: "active" }
    });
    const service = new ClientSharesService(
      prisma, makeProjectService() as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    await expect(service.resolveShareByToken(rawToken)).rejects.toMatchObject({ code: "client_share_expired" });
  });

  it("resolveShareByToken rejects invalid/unknown token with not_found", async () => {
    const prisma = makeSharePrisma() as any;
    prisma.projectClientShare.findUnique = vi.fn().mockResolvedValue(null);
    const service = new ClientSharesService(
      prisma, makeProjectService() as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    await expect(service.resolveShareByToken("cs_badtoken")).rejects.toMatchObject({ code: "client_share_not_found" });
  });

  it("dev cannot create share — ensureProjectManager throws", async () => {
    const prisma = makeSharePrisma() as any;
    const projectService = makeProjectService({
      ensureProjectManager: vi.fn().mockRejectedValue({ code: "manager_access_required", statusCode: 403 })
    });
    const service = new ClientSharesService(
      prisma, projectService as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    await expect(service.createShare("project-1", "user-dev", { name: "Test" }))
      .rejects.toMatchObject({ code: "manager_access_required" });
  });
});

// ─── 3. Client-safe projections ──────────────────────────────────────────────

describe("projectBrainForClient", () => {
  const artifact = {
    id: "art-1",
    projectId: "proj-1",
    versionNumber: 3,
    acceptedAt: new Date("2026-03-01"),
    payloadJson: {
      executiveSummary: "A product for managing specs",
      targetAudience: "Product managers",
      mainFlows: ["Upload PRD", "Review Brain"],
      modules: ["Auth", "Dashboard"],
      constraints: ["Immutable sources"],
      integrations: ["Slack"],
      unresolvedAreas: ["Pricing model TBD"],
      acceptedDecisions: [{ id: "internal-decision-id", title: "Internal Decision" }],
      recentAcceptedChanges: [{ proposalId: "internal-proposal-id", summary: "Change summary" }],
      evidenceRefs: [{ messageId: "internal-msg-id", body: "internal body" }]
    }
  };

  it("strips internal decisions and change proposal internals", () => {
    const result = projectBrainForClient(artifact, [], defaultClientShareConfig);
    expect(JSON.stringify(result)).not.toContain("internal-decision-id");
    expect(JSON.stringify(result)).not.toContain("internal-proposal-id");
    expect(JSON.stringify(result)).not.toContain("internal-msg-id");
  });

  it("includes client-visible summary fields", () => {
    const result = projectBrainForClient(artifact, [], defaultClientShareConfig);
    expect(result.summary.whatTheProductIs).toBe("A product for managing specs");
    expect(result.summary.mainFlows).toContain("Upload PRD");
    expect(result.summary.unresolvedAreas).toContain("Pricing model TBD");
  });

  it("hides accepted change summaries by default", () => {
    const changes = [{ title: "Auth change", summary: "Auth was changed", acceptedAt: new Date() }];
    const result = projectBrainForClient(artifact, changes, defaultClientShareConfig);
    expect(result.summary.recentAcceptedChangeSummaries).toHaveLength(0);
  });

  it("includes accepted change summaries only as safe text when config allows", () => {
    const config = { ...defaultClientShareConfig, showAcceptedChangeSummaries: true };
    const changes = [{ title: "Auth change", summary: "Auth was changed", acceptedAt: new Date() }];
    const result = projectBrainForClient(artifact, changes, config);
    expect(result.summary.recentAcceptedChangeSummaries).toContain("Auth was changed");
    // No proposal IDs in output
    expect(JSON.stringify(result)).not.toContain("proposalId");
  });

  it("redacts client-unsafe accepted change summaries before client projection", () => {
    const config = { ...defaultClientShareConfig, showAcceptedChangeSummaries: true };
    const changes = [
      {
        title: "Fireflies secret",
        summary:
          "Accepted based on provider thread thread-internal and recording https://download.fireflies.ai/audio/private with OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnopqrstuvwxyz",
        acceptedAt: new Date()
      }
    ];
    const result = projectBrainForClient(artifact, changes, config);
    const json = JSON.stringify(result);

    expect(json).not.toContain("thread-internal");
    expect(json).not.toContain("download.fireflies.ai");
    expect(json).not.toContain("sk-proj");
    expect(result.summary.recentAcceptedChangeSummaries).toEqual(["[redacted client-unsafe summary]"]);
  });

  it("hides change summaries when config.showAcceptedChangeSummaries=false", () => {
    const config = { ...defaultClientShareConfig, showAcceptedChangeSummaries: false };
    const changes = [{ title: "Auth change", summary: "Auth was changed", acceptedAt: new Date() }];
    const result = projectBrainForClient(artifact, changes, config);
    expect(result.summary.recentAcceptedChangeSummaries).toHaveLength(0);
  });
});

describe("projectGraphForClient", () => {
  const nodes = [
    { id: "node-1", nodeKey: "module-1", nodeType: "module", title: "Auth", summary: "Auth module", status: "active" },
    { id: "node-2", nodeKey: "source-cluster-1", nodeType: "source_cluster", title: "Internal", summary: "Internal", status: "active" },
    { id: "node-3", nodeKey: "flow-1", nodeType: "flow", title: "Login Flow", summary: "Login", status: "active" }
  ];
  const edges = [
    { id: "edge-1", fromNodeId: "node-1", toNodeId: "node-3", edgeType: "depends_on" },
    { id: "edge-2", fromNodeId: "node-2", toNodeId: "node-1", edgeType: "supported_by" }
  ];

  it("excludes source_cluster nodes from client graph", () => {
    const clientSafeIds = new Set(["node-1", "node-3"]);
    const result = projectGraphForClient({ versionNumber: 2 }, nodes, edges, clientSafeIds);
    const nodeTypes = result.nodes.map((n) => n.nodeType);
    expect(nodeTypes).not.toContain("source_cluster");
  });

  it("excludes edges where either endpoint is filtered out", () => {
    const clientSafeIds = new Set(["node-1", "node-3"]);
    const result = projectGraphForClient({ versionNumber: 2 }, nodes, edges, clientSafeIds);
    // edge-2 involves node-2 (internal) — must be excluded
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].id).toBe("edge-1");
  });

  it("reports hiddenInternalNodeCount correctly", () => {
    const clientSafeIds = new Set(["node-1", "node-3"]);
    const result = projectGraphForClient({ versionNumber: 2 }, nodes, edges, clientSafeIds);
    // node-2 is source_cluster AND not in clientSafeIds — counted once as hidden
    expect(result.meta.hiddenInternalNodeCount).toBeGreaterThanOrEqual(1);
  });
});

describe("projectDocumentListForClient", () => {
  it("returns safe doc list without uploader or internal metadata", () => {
    const docs = [
      { id: "doc-1", title: "PRD v2", kind: "prd", currentVersionId: "ver-1", updatedAt: new Date("2026-02-01"), uploadedBy: "user-internal" }
    ];
    const result = projectDocumentListForClient(docs);
    expect(result[0].id).toBe("doc-1");
    expect(result[0].title).toBe("PRD v2");
    expect(JSON.stringify(result)).not.toContain("uploadedBy");
    expect(JSON.stringify(result)).not.toContain("user-internal");
  });
});

describe("projectSectionForClient", () => {
  it("strips internal ids from section read model", () => {
    const section = {
      id: "section-1",
      anchorId: "h1-auth",
      pageNumber: 1,
      headingPath: ["Authentication"],
      orderIndex: 0,
      normalizedText: "Auth section text"
    };
    const result = projectSectionForClient(section, ["Auth flow was updated"]);
    expect(result.sectionId).toBe("section-1");
    expect(result.acceptedChangeSummaries).toContain("Auth flow was updated");
    // No proposal IDs, acceptedBy, message refs
    expect(JSON.stringify(result)).not.toContain("proposalId");
    expect(JSON.stringify(result)).not.toContain("acceptedBy");
    expect(JSON.stringify(result)).not.toContain("messageId");
  });
});

describe("buildClientProjectSummary", () => {
  it("does not expose internal team data, connector counts, or pressure metrics", () => {
    const result = buildClientProjectSummary({
      project: { id: "proj-1", name: "Test", description: null, previewUrl: null },
      brain: {
        payloadJson: { executiveSummary: "An app", targetAudience: "PMs", mainFlows: [], modules: [], constraints: [], integrations: [], unresolvedAreas: [] },
        acceptedAt: new Date()
      },
      recentChanges: [],
      sharedDocumentCount: 3,
      config: defaultClientShareConfig
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("changePressure");
    expect(json).not.toContain("connector");
    expect(json).not.toContain("headcount");
    expect(json).not.toContain("internalDecision");
    expect(result.summary.sharedDocumentCount).toBe(3);
  });

  it("does not expose accepted internal change titles by default and redacts them when explicitly enabled", () => {
    const unsafeChange = {
      title: "Unannounced pricing token=internal-secret",
      summary: "Delay disclosure until provider thread thread-internal is approved.",
      acceptedAt: new Date("2026-05-01T00:00:00.000Z")
    };
    const defaultResult = buildClientProjectSummary({
      project: { id: "proj-1", name: "Test", description: null, previewUrl: null },
      brain: null,
      recentChanges: [unsafeChange],
      sharedDocumentCount: 0,
      config: defaultClientShareConfig
    });
    expect(defaultResult.summary.recentAcceptedChanges).toHaveLength(0);

    const explicitResult = buildClientProjectSummary({
      project: { id: "proj-1", name: "Test", description: null, previewUrl: null },
      brain: null,
      recentChanges: [unsafeChange],
      sharedDocumentCount: 0,
      config: { ...defaultClientShareConfig, showAcceptedChangeSummaries: true }
    });
    expect(explicitResult.summary.recentAcceptedChanges).toEqual([
      {
        title: "[redacted client-unsafe summary]",
        summary: "[redacted client-unsafe summary]",
        acceptedAt: "2026-05-01T00:00:00.000Z"
      }
    ]);
    expect(JSON.stringify(explicitResult)).not.toContain("internal-secret");
    expect(JSON.stringify(explicitResult)).not.toContain("thread-internal");
  });
});

// ─── 4. ClientViewService integration ────────────────────────────────────────

function makeShareRecord(tokenOverride?: string) {
  const { rawToken, tokenHash, tokenPrefix } = tokenOverride
    ? { rawToken: tokenOverride, tokenHash: hashToken(tokenOverride, SECRET), tokenPrefix: tokenOverride.slice(0, 7) }
    : generateClientShareToken(SECRET);

  return {
    rawToken,
    shareRecord: {
      id: "share-1", projectId: "project-1", orgId: "org-1", name: "Test Share",
      tokenHash, tokenPrefix, status: "active",
      expiresAt: null, revokedAt: null, revokedBy: null,
      createdBy: "user-manager", createdAt: new Date(), updatedAt: new Date(),
      lastAccessedAt: null, configJson: defaultClientShareConfig,
      project: { id: "project-1", orgId: "org-1", name: "Acme Project", description: "A project", previewUrl: "https://preview.example.com", status: "active" }
    }
  };
}

describe("ClientViewService.getBootstrap", () => {
  it("returns correct navigation for default config", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);
    const result = await service.getBootstrap(rawToken);
    expect(result.project.name).toBe("Acme Project");
    expect(result.capabilities.brain).toBe(true);
    expect(result.capabilities.socrates).toBe(false);
    // preview visible because previewUrl exists and showPreview=true
    expect(result.project.previewUrl).toBe("https://preview.example.com");
  });

  it("hides previewUrl if showPreview=false", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    shareRecord.configJson = { ...defaultClientShareConfig, showPreview: false };
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);
    const result = await service.getBootstrap(rawToken);
    expect(result.project.previewUrl).toBeNull();
  });
});

describe("ClientViewService.listDocuments", () => {
  it("returns only shared_with_client documents", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      document: {
        findMany: vi.fn().mockResolvedValue([
          { id: "doc-1", title: "Shared PRD", kind: "prd", visibility: "shared_with_client", currentVersionId: "ver-1", updatedAt: new Date() }
        ]),
        count: vi.fn().mockResolvedValue(1)
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);
    const result = await service.listDocuments(rawToken);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Shared PRD");
    // visibility field must not be exposed
    expect(JSON.stringify(result)).not.toContain("shared_with_client");
  });

  it("returns 403 if showDocuments=false", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    shareRecord.configJson = { ...defaultClientShareConfig, showDocuments: false };
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      document: { findMany: vi.fn(), count: vi.fn() },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);
    await expect(service.listDocuments(rawToken)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("ClientViewService.getDocumentView", () => {
  it("rejects unshared document (internal doc) without revealing its existence", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      document: {
        findFirst: vi.fn().mockResolvedValue(null) // not shared_with_client
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);
    await expect(service.getDocumentView(rawToken, "internal-doc-id"))
      .rejects.toMatchObject({ code: "client_document_not_shared", statusCode: 404 });
  });

  it("rejects shared documents whose current version is not parsed/viewable", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: "doc-1",
          projectId: "project-1",
          visibility: "shared_with_client",
          title: "Shared PRD",
          kind: "prd",
          currentVersionId: "ver-processing",
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      documentVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ver-processing",
          documentId: "doc-1",
          projectId: "project-1",
          status: "processing",
          parseRevision: 2
        })
      },
      documentSection: {
        findMany: vi.fn().mockResolvedValue([])
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);

    await expect(service.getDocumentView(rawToken, "doc-1")).rejects.toMatchObject({
      code: "document_version_not_viewable",
      statusCode: 409
    });
    expect(prisma.documentSection.findMany).not.toHaveBeenCalled();
  });

  it("pins client anchor lookup to the shared document current parsed version", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: "doc-1",
          projectId: "project-1",
          visibility: "shared_with_client",
          currentVersionId: "ver-current"
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: "doc-1",
          projectId: "project-1",
          visibility: "shared_with_client",
          currentVersionId: "ver-current"
        })
      },
      documentVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ver-current",
          documentId: "doc-1",
          projectId: "project-1",
          status: "ready",
          parseRevision: 3
        })
      },
      documentSection: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);

    await expect(service.getAnchor(rawToken, "doc-1", "overview")).rejects.toMatchObject({
      code: "anchor_not_found",
      statusCode: 404
    });
    expect(prisma.documentSection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentVersionId: "ver-current",
          parseRevision: 3,
          anchorId: "overview",
          projectId: "project-1"
        })
      })
    );
  });

  it("pins client document search to the current parsed version and parse revision", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: "doc-1",
          projectId: "project-1",
          visibility: "shared_with_client",
          currentVersionId: "ver-current"
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: "doc-1",
          projectId: "project-1",
          visibility: "shared_with_client",
          currentVersionId: "ver-current"
        })
      },
      documentVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ver-current",
          documentId: "doc-1",
          projectId: "project-1",
          status: "partial",
          parseRevision: 4
        })
      },
      documentSection: {
        findMany: vi.fn().mockResolvedValue([])
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);

    await service.searchDocument(rawToken, "doc-1", "auth");

    expect(prisma.documentSection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentVersionId: "ver-current",
          parseRevision: 4
        })
      })
    );
  });

  it("returns viewer-openable document section targets from client document search", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: "doc-1",
          projectId: "project-1",
          visibility: "shared_with_client",
          currentVersionId: "ver-current"
        })
      },
      documentVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ver-current",
          documentId: "doc-1",
          projectId: "project-1",
          status: "ready",
          parseRevision: 4
        })
      },
      documentSection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "section-1",
            anchorId: "overview",
            pageNumber: 2,
            headingPath: ["Overview"],
            orderIndex: 1,
            normalizedText: "Auth requirements are current."
          }
        ])
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);

    const [result] = await service.searchDocument(rawToken, "doc-1", "auth");

    expect(result).toMatchObject({
      sectionId: "section-1",
      anchorId: "overview",
      pageNumber: 2,
      openTarget: {
        targetType: "document_section",
        targetRef: {
          documentId: "doc-1",
          documentVersionId: "ver-current",
          anchorId: "overview",
          pageNumber: 2
        }
      }
    });
  });
});

describe("ClientViewService.getBrain", () => {
  it("returns client-safe brain without internal message refs or decision ids", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "art-1", projectId: "project-1", versionNumber: 3,
          acceptedAt: new Date("2026-02-01"),
          payloadJson: {
            executiveSummary: "A great product",
            targetAudience: "PMs",
            mainFlows: ["Ingest docs"],
            modules: ["Upload"],
            constraints: [],
            integrations: [],
            unresolvedAreas: [],
            acceptedDecisions: [{ id: "dec-internal", title: "private decision" }],
            evidenceRefs: [
              { messageId: "msg-internal-id", body: "private message body" },
              {
                provider: "fireflies_ai",
                transcriptId: "ff-transcript-internal",
                threadId: "thread-internal",
                speakerName: "Sarah Client",
                speakerEmail: "sarah@example.com",
                providerUrl: "https://app.fireflies.ai/view/private",
                recordingUrl: "https://download.fireflies.ai/audio/private",
                body: "Raw Fireflies transcript text"
              }
            ]
          }
        })
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);
    const result = await service.getBrain(rawToken);
    const json = JSON.stringify(result);
    expect(json).not.toContain("dec-internal");
    expect(json).not.toContain("msg-internal-id");
    expect(json).not.toContain("private message body");
    expect(json).not.toContain("private decision");
    expect(json).not.toContain("fireflies_ai");
    expect(json).not.toContain("ff-transcript-internal");
    expect(json).not.toContain("thread-internal");
    expect(json).not.toContain("Sarah Client");
    expect(json).not.toContain("sarah@example.com");
    expect(json).not.toContain("app.fireflies.ai");
    expect(json).not.toContain("download.fireflies.ai");
    expect(json).not.toContain("Raw Fireflies transcript text");
    expect(result.summary.whatTheProductIs).toBe("A great product");
  });

  it("redacts client-unsafe accepted Product Brain text fields", async () => {
    const result = projectBrainForClient(
      {
        id: "art-1",
        projectId: "project-1",
        versionNumber: 4,
        acceptedAt: new Date("2026-02-01"),
        payloadJson: {
          executiveSummary: "Built from transcript thread-internal with OPENAI_API_KEY=sk-testsecret123456789.",
          targetAudience: "Client PMs",
          mainFlows: ["Review provider message msg-internal-id"],
          modules: ["Upload"],
          constraints: ["Do not expose connector credential material"],
          integrations: ["Slack"],
          unresolvedAreas: ["Recording at https://download.fireflies.ai/audio/private"]
        }
      },
      [],
      defaultClientShareConfig
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain("thread-internal");
    expect(json).not.toContain("sk-testsecret");
    expect(json).not.toContain("msg-internal-id");
    expect(json).not.toContain("download.fireflies.ai");
    expect(result.summary.whatTheProductIs).toBe("[redacted client-unsafe summary]");
    expect(result.summary.mainFlows).toEqual(["[redacted client-unsafe summary]"]);
  });
});

describe("ClientViewService.getGraph", () => {
  it("derives client-safe graph nodes only from allowed current parsed shared document versions", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const allowedDocId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const otherDocId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    const currentAllowedVersionId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
    const oldAllowedVersionId = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
    const otherVersionId = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee";

    shareRecord.configJson = {
      ...defaultClientShareConfig,
      allowedDocumentIds: [allowedDocId]
    };
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "graph-1",
          projectId: "project-1",
          artifactType: "brain_graph",
          status: "accepted",
          versionNumber: 2
        })
      },
      brainNode: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "node-current-allowed",
            nodeKey: "current",
            nodeType: "module",
            title: "Current allowed node",
            summary: "Safe",
            status: "active"
          },
          {
            id: "node-old-allowed",
            nodeKey: "old",
            nodeType: "module",
            title: "Old allowed node",
            summary: "Stale",
            status: "active"
          },
          {
            id: "node-current-other",
            nodeKey: "other",
            nodeType: "module",
            title: "Other shared node",
            summary: "Not allowed",
            status: "active"
          }
        ])
      },
      brainEdge: {
        findMany: vi.fn().mockResolvedValue([])
      },
      document: {
        findMany: vi.fn(async ({ where }: any) => {
          const docs = [
            {
              id: allowedDocId,
              currentVersionId: currentAllowedVersionId
            },
            {
              id: otherDocId,
              currentVersionId: otherVersionId
            }
          ];
          return where?.id?.in ? docs.filter((doc) => where.id.in.includes(doc.id)) : docs;
        })
      },
      documentVersion: {
        findMany: vi.fn(async ({ where }: any) => {
          const versions = [
            {
              id: currentAllowedVersionId,
              documentId: allowedDocId,
              status: "ready",
              parseRevision: 3,
              document: { currentVersionId: currentAllowedVersionId }
            },
            {
              id: oldAllowedVersionId,
              documentId: allowedDocId,
              status: "ready",
              parseRevision: 2,
              document: { currentVersionId: currentAllowedVersionId }
            },
            {
              id: otherVersionId,
              documentId: otherDocId,
              status: "ready",
              parseRevision: 1,
              document: { currentVersionId: otherVersionId }
            }
          ];
          if (where?.id?.in) {
            return versions.filter((version) => where.id.in.includes(version.id));
          }
          if (where?.documentId?.in) {
            return versions.filter((version) => where.documentId.in.includes(version.documentId));
          }
          return versions;
        })
      },
      documentSection: {
        findMany: vi.fn(async ({ where }: any) => {
          const sections = [
            { id: "section-current-allowed", documentVersionId: currentAllowedVersionId },
            { id: "section-old-allowed", documentVersionId: oldAllowedVersionId },
            { id: "section-current-other", documentVersionId: otherVersionId }
          ];
          const versionIds = where.documentVersionId?.in ?? where.OR?.map((clause: any) => clause.documentVersionId) ?? [];
          return sections
            .filter((section) => versionIds.includes(section.documentVersionId))
            .map(({ id }) => ({ id }));
        })
      },
      brainSectionLink: {
        findMany: vi.fn(async ({ where }: any) => {
          const links = [
            { documentSectionId: "section-current-allowed", brainNodeId: "node-current-allowed" },
            { documentSectionId: "section-old-allowed", brainNodeId: "node-old-allowed" },
            { documentSectionId: "section-current-other", brainNodeId: "node-current-other" }
          ];
          expect(where).toMatchObject({ projectId: "project-1", artifactVersionId: "graph-1" });
          return links.map(({ brainNodeId, documentSectionId }) => ({ brainNodeId, documentSectionId }));
        })
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;
    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);

    const result = await service.getGraph(rawToken);

    expect(result.nodes.map((node) => node.id)).toEqual(["node-current-allowed"]);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [allowedDocId] },
          visibility: "shared_with_client"
        })
      })
    );
    expect(prisma.documentVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [currentAllowedVersionId] },
          status: { in: ["ready", "partial"] }
        })
      })
    );
  });

  it("does not expose graph nodes that also depend on internal evidence", async () => {
    const { rawToken, shareRecord } = makeShareRecord();
    const prisma = {
      projectClientShare: {
        findUnique: vi.fn().mockResolvedValue(shareRecord),
        update: vi.fn().mockResolvedValue(shareRecord)
      },
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "graph-1", projectId: "project-1", versionNumber: 2 })
      },
      brainNode: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "node-mixed",
            nodeKey: "mixed",
            nodeType: "module",
            title: "Mixed evidence node",
            summary: "Contains transcript-derived internal detail",
            status: "active"
          }
        ])
      },
      brainEdge: { findMany: vi.fn().mockResolvedValue([]) },
      document: {
        findMany: vi.fn().mockResolvedValue([{ id: "shared-doc", currentVersionId: "shared-version" }])
      },
      documentVersion: {
        findMany: vi.fn().mockResolvedValue([{ id: "shared-version", parseRevision: 1 }])
      },
      documentSection: {
        findMany: vi.fn().mockResolvedValue([{ id: "shared-section" }])
      },
      brainSectionLink: {
        findMany: vi.fn().mockResolvedValue([
          { brainNodeId: "node-mixed", documentSectionId: "shared-section" },
          { brainNodeId: "node-mixed", documentSectionId: "internal-section" }
        ])
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) }
    } as any;

    const auditService = makeAuditService() as any;
    const clientSharesService = new ClientSharesService(
      prisma, makeProjectService() as any, auditService, SECRET, "https://app.example.com"
    );
    const service = new ClientViewService(prisma, {} as any, clientSharesService, auditService);

    const result = await service.getGraph(rawToken);

    expect(result.nodes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("transcript-derived");
  });
});

// ─── 5. Regression: manager/dev routes not affected ─────────────────────────

describe("existing route auth guards are not affected by Feature 6", () => {
  it("requireManager guard still rejects non-manager via projectService", async () => {
    const prisma = makeSharePrisma() as any;
    const projectService = {
      ensureProjectManager: vi.fn().mockRejectedValue({ code: "manager_access_required", statusCode: 403 })
    };
    const service = new ClientSharesService(
      prisma, projectService as any, makeAuditService() as any,
      SECRET, "https://app.example.com"
    );
    await expect(service.createShare("project-1", "user-dev", { name: "Bad" }))
      .rejects.toMatchObject({ code: "manager_access_required" });
  });
});
