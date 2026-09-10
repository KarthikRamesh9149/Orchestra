import { describe, expect, it, vi } from "vitest";
import { EditorConnectorService } from "../src/modules/editor-connectors/service.js";

describe("EditorConnectorService", () => {
  it("stores only hashes for VS Code pairing and token exchange", async () => {
    const created: any = {
      id: "connector-1",
      orgId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      connectorType: "vscode",
      label: "VS Code",
      pairingCodeHash: "hash",
      tokenHash: null,
      tokenPrefix: null,
      status: "pairing_pending",
      scopesJson: ["project_memory:read", "socrates:ask"],
      createdAt: new Date("2026-05-27T00:00:00Z"),
      expiresAt: new Date(Date.now() + 600_000),
      lastUsedAt: null,
      revokedAt: null
    };
    const prisma: any = {
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ id: "project-1", orgId: "org-1", name: "Beta" }))
      },
      projectEditorConnector: {
        create: vi.fn(async ({ data }: any) => ({ ...created, ...data })),
        findUnique: vi.fn(async () => ({ ...created, project: { id: "project-1", orgId: "org-1", name: "Beta" } })),
        update: vi.fn(async ({ data }: any) => ({ ...created, ...data }))
      }
    };
    const service = new EditorConnectorService(
      prisma,
      {
        JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret",
        VSCODE_CONNECTOR_TOKEN_SECRET: "vscode-secret-vscode-secret-vscode",
        VSCODE_PAIRING_CODE_TTL_SECONDS: 600,
        VSCODE_CONNECTOR_TOKEN_TTL_DAYS: 90,
        FRONTEND_BASE_URL: "http://localhost:5173",
        APP_BASE_URL: "http://localhost:3000"
      } as any,
      { ensureProjectAccess: vi.fn(async () => ({ projectRole: "manager" })) } as any,
      {} as any,
      { record: vi.fn(async () => undefined) } as any
    );

    const pairing = await service.createVsCodePairing("project-1", "user-1");
    expect(pairing.pairingCode).toMatch(/^ORCH-/);
    expect(prisma.projectEditorConnector.create.mock.calls[0][0].data.pairingCodeHash).not.toContain("ORCH-");

    const exchanged = await service.exchangeVsCodePairing({ pairingCode: pairing.pairingCode! });
    const updateData = prisma.projectEditorConnector.update.mock.calls[0][0].data;
    expect(exchanged.token).toMatch(/^orch_vscode_/);
    expect(updateData.tokenHash).not.toContain("orch_vscode_");
    expect(updateData.pairingCodeHash).toBeNull();
  });

  it("does not persist selected editor text through the VS Code Socrates ask path", async () => {
    const connector: any = {
      id: "connector-1",
      orgId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      connectorType: "vscode",
      tokenPrefix: "orch_vscode_secret",
      tokenHash: "token-hash",
      status: "connected",
      expiresAt: new Date(Date.now() + 600_000),
      revokedAt: null
    };
    const prisma: any = {
      projectEditorConnector: {
        findFirst: vi.fn(async () => connector),
        update: vi.fn(async () => connector)
      }
    };
    const socratesService = {
      askBetaProjectMemory: vi.fn(async () => ({
        answer_md: "Answer from project memory.",
        citations: [],
        open_targets: [],
        suggested_prompts: [],
        suggested_actions: [],
        confidence: "medium",
        limitations: []
      }))
    };
    const auditService = { record: vi.fn(async () => undefined) };
    const service = new EditorConnectorService(
      prisma,
      {
        JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret",
        VSCODE_CONNECTOR_TOKEN_SECRET: "vscode-secret-vscode-secret-vscode"
      } as any,
      {} as any,
      socratesService as any,
      auditService as any
    );
    (service as any).hashSecret = () => "token-hash";

    await service.askSocratesWithVsCodeToken(
      "Bearer orch_vscode_secret_value",
      "What does project memory say about auth?",
      "const apiKey = 'should-not-be-stored';"
    );

    expect(socratesService.askBetaProjectMemory).toHaveBeenCalledWith({
      projectId: "project-1",
      actorUserId: "user-1",
      content: "What does project memory say about auth?",
      source: "vscode",
      ideContext: "Selected editor text:\nconst apiKey = 'should-not-be-stored';"
    });
    expect(JSON.stringify(auditService.record.mock.calls)).not.toContain("should-not-be-stored");
  });

  it("allows a VS Code pairing code to be exchanged only once", async () => {
    let connector: any = {
      id: "connector-once",
      orgId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      connectorType: "vscode",
      label: "VS Code",
      pairingCodeHash: null,
      tokenHash: null,
      tokenPrefix: null,
      status: "pairing_pending",
      scopesJson: ["project_memory:read", "socrates:ask"],
      createdAt: new Date("2026-05-27T00:00:00Z"),
      expiresAt: new Date(Date.now() + 600_000),
      lastUsedAt: null,
      revokedAt: null
    };
    const prisma: any = {
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ id: "project-1", orgId: "org-1", name: "Beta" }))
      },
      projectEditorConnector: {
        create: vi.fn(async ({ data }: any) => {
          connector = { ...connector, ...data };
          return connector;
        }),
        findUnique: vi.fn(async ({ where }: any) => {
          if (connector.pairingCodeHash && connector.pairingCodeHash === where.pairingCodeHash) {
            return { ...connector, project: { id: "project-1", orgId: "org-1", name: "Beta" } };
          }
          return null;
        }),
        update: vi.fn(async ({ data }: any) => {
          connector = { ...connector, ...data };
          return connector;
        })
      }
    };
    const service = new EditorConnectorService(
      prisma,
      {
        JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret",
        VSCODE_CONNECTOR_TOKEN_SECRET: "vscode-secret-vscode-secret-vscode",
        VSCODE_PAIRING_CODE_TTL_SECONDS: 600,
        VSCODE_CONNECTOR_TOKEN_TTL_DAYS: 90,
        FRONTEND_BASE_URL: "http://localhost:5173",
        APP_BASE_URL: "http://localhost:3000"
      } as any,
      { ensureProjectAccess: vi.fn(async () => ({ projectRole: "manager" })) } as any,
      {} as any,
      { record: vi.fn(async () => undefined) } as any
    );

    const pairing = await service.createVsCodePairing("project-1", "user-1");
    await expect(service.exchangeVsCodePairing({ pairingCode: pairing.pairingCode! })).resolves.toMatchObject({
      project: { id: "project-1" }
    });
    await expect(service.exchangeVsCodePairing({ pairingCode: pairing.pairingCode! })).rejects.toMatchObject({
      statusCode: 401,
      code: "vscode_pairing_invalid"
    });
  });

  it("expires and revokes VS Code tokens so later asks are denied", async () => {
    const connector: any = {
      id: "connector-expiring",
      orgId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      connectorType: "vscode",
      tokenPrefix: "orch_vscode_secret",
      tokenHash: "token-hash",
      status: "connected",
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null
    };
    const prisma: any = {
      projectEditorConnector: {
        findFirst: vi.fn(async () => connector),
        update: vi.fn(async ({ data }: any) => ({ ...connector, ...data })),
        updateMany: vi.fn(async ({ data }: any) => {
          Object.assign(connector, data);
          return { count: 1 };
        })
      }
    };
    const service = new EditorConnectorService(
      prisma,
      {
        JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret",
        VSCODE_CONNECTOR_TOKEN_SECRET: "vscode-secret-vscode-secret-vscode"
      } as any,
      {} as any,
      { askBetaProjectMemory: vi.fn() } as any,
      { record: vi.fn(async () => undefined) } as any
    );
    (service as any).hashSecret = () => "token-hash";

    await expect(
      service.askSocratesWithVsCodeToken("Bearer orch_vscode_secret_value", "What do docs say?")
    ).rejects.toMatchObject({ statusCode: 401, code: "vscode_token_expired" });
    expect(prisma.projectEditorConnector.update).toHaveBeenCalledWith({
      where: { id: "connector-expiring" },
      data: { status: "expired", tokenHash: null }
    });

    connector.status = "connected";
    connector.expiresAt = new Date(Date.now() + 600_000);
    connector.tokenHash = "token-hash";
    await service.revokeVsCodeConnectorToken("Bearer orch_vscode_secret_value");
    expect(connector.status).toBe("revoked");
    expect(connector.tokenHash).toBeNull();

    prisma.projectEditorConnector.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.askSocratesWithVsCodeToken("Bearer orch_vscode_secret_value", "What do docs say?")
    ).rejects.toMatchObject({ statusCode: 401, code: "vscode_token_denied" });
  });

  it("denies wrong-project VS Code pairing management before creating connectors", async () => {
    const prisma: any = {
      project: { findUniqueOrThrow: vi.fn() },
      projectEditorConnector: { create: vi.fn() }
    };
    const service = new EditorConnectorService(
      prisma,
      {
        JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret",
        VSCODE_CONNECTOR_TOKEN_SECRET: "vscode-secret-vscode-secret-vscode",
        VSCODE_PAIRING_CODE_TTL_SECONDS: 600
      } as any,
      {
        ensureProjectAccess: vi.fn(async () => {
          throw Object.assign(new Error("Project access denied"), { statusCode: 403, code: "project_access_denied" });
        })
      } as any,
      {} as any,
      { record: vi.fn(async () => undefined) } as any
    );

    await expect(service.createVsCodePairing("wrong-project", "user-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    expect(prisma.projectEditorConnector.create).not.toHaveBeenCalled();
  });
});
