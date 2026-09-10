import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { SocratesService } from "../socrates/service.js";

const VSCODE_SCOPES = ["project_memory:read", "socrates:ask"] as const;

export class EditorConnectorService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly socratesService: SocratesService,
    private readonly auditService: AuditService
  ) {}

  async createVsCodePairing(projectId: string, actorUserId: string, label?: string) {
    await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true }
    });
    const pairingCode = this.createPairingCode();
    const expiresAt = new Date(Date.now() + this.env.VSCODE_PAIRING_CODE_TTL_SECONDS * 1000);
    const connector = await this.prisma.projectEditorConnector.create({
      data: {
        orgId: project.orgId,
        projectId,
        userId: actorUserId,
        connectorType: "vscode",
        label: label?.trim() || "VS Code",
        pairingCodeHash: this.hashSecret(pairingCode),
        status: "pairing_pending",
        scopesJson: [...VSCODE_SCOPES],
        expiresAt,
        metadataJson: {
          projectName: project.name,
          beta: true
        }
      }
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "vscode_pairing_created",
      entityType: "project_editor_connector",
      entityId: connector.id,
      payload: { status: "pairing_pending", expiresAt: expiresAt.toISOString(), scopes: VSCODE_SCOPES }
    });
    return this.toPublicConnector(connector, { pairingCode });
  }

  async getVsCodeStatus(projectId: string, actorUserId: string) {
    await this.projectService.ensureProjectAccess(projectId, actorUserId);
    await this.expireStalePairings(projectId);
    const connectors = await this.prisma.projectEditorConnector.findMany({
      where: {
        projectId,
        userId: actorUserId,
        connectorType: "vscode"
      },
      orderBy: { createdAt: "desc" },
      take: 10
    });
    return {
      connectors: connectors.map((connector) => this.toPublicConnector(connector)),
      scopes: [...VSCODE_SCOPES]
    };
  }

  async exchangeVsCodePairing(input: {
    pairingCode: string;
    extensionVersion?: string;
    deviceLabel?: string;
  }) {
    const pairingCode = input.pairingCode.trim();
    const connector = await this.prisma.projectEditorConnector.findUnique({
      where: { pairingCodeHash: this.hashSecret(pairingCode) },
      include: { project: { select: { id: true, orgId: true, name: true } } }
    });
    if (!connector || connector.connectorType !== "vscode") {
      throw new AppError(401, "Invalid pairing code", "vscode_pairing_invalid");
    }
    if (connector.status !== "pairing_pending" || !connector.expiresAt || connector.expiresAt <= new Date()) {
      await this.prisma.projectEditorConnector.update({
        where: { id: connector.id },
        data: { status: "expired", pairingCodeHash: null }
      }).catch(() => undefined);
      throw new AppError(410, "Pairing code expired", "vscode_pairing_expired");
    }

    const token = `orch_vscode_${randomBytes(32).toString("base64url")}`;
    const tokenPrefix = token.slice(0, 18);
    const expiresAt = new Date(Date.now() + this.env.VSCODE_CONNECTOR_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.projectEditorConnector.update({
      where: { id: connector.id },
      data: {
        pairingCodeHash: null,
        tokenHash: this.hashSecret(token),
        tokenPrefix,
        status: "connected",
        expiresAt,
        lastUsedAt: new Date(),
        metadataJson: {
          ...(typeof connector.metadataJson === "object" && connector.metadataJson ? connector.metadataJson : {}),
          extensionVersion: input.extensionVersion ?? null,
          deviceLabel: input.deviceLabel ?? null
        }
      }
    });
    await this.auditService.record({
      orgId: connector.orgId,
      projectId: connector.projectId,
      actorUserId: connector.userId,
      eventType: "vscode_pairing_exchanged",
      entityType: "project_editor_connector",
      entityId: connector.id,
      payload: { tokenPrefix, scopes: VSCODE_SCOPES, expiresAt: expiresAt.toISOString() }
    });
    return {
      connector: this.toPublicConnector(updated),
      token,
      project: connector.project,
      scopes: [...VSCODE_SCOPES],
      webAppBaseUrl: this.env.FRONTEND_BASE_URL ?? this.env.APP_BASE_URL
    };
  }

  async revokeVsCodeConnector(projectId: string, actorUserId: string) {
    await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });
    const result = await this.prisma.projectEditorConnector.updateMany({
      where: {
        projectId,
        userId: actorUserId,
        connectorType: "vscode",
        status: { in: ["pairing_pending", "connected"] }
      },
      data: {
        status: "revoked",
        pairingCodeHash: null,
        tokenHash: null,
        revokedAt: new Date()
      }
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "vscode_connector_revoked",
      entityType: "project_editor_connector",
      entityId: projectId,
      payload: { count: result.count }
    });
    return { revoked: result.count };
  }

  async revokeVsCodeConnectorToken(authorization: string | undefined) {
    const principal = await this.authenticateVsCodeToken(authorization);
    const result = await this.prisma.projectEditorConnector.updateMany({
      where: {
        id: principal.connectorId,
        connectorType: "vscode",
        status: "connected"
      },
      data: {
        status: "revoked",
        tokenHash: null,
        revokedAt: new Date()
      }
    });
    await this.auditService.record({
      orgId: principal.orgId,
      projectId: principal.projectId,
      actorUserId: principal.userId,
      eventType: "vscode_connector_revoked",
      entityType: "project_editor_connector",
      entityId: principal.connectorId,
      payload: { tokenPrefix: principal.tokenPrefix, count: result.count, source: "vscode_extension" }
    });
    return { revoked: result.count };
  }

  async askSocratesWithVsCodeToken(
    authorization: string | undefined,
    question: string,
    selectedText?: string,
    ideContext?: string
  ) {
    const principal = await this.authenticateVsCodeToken(authorization);
    const temporaryIdeContext = [
      selectedText?.trim() ? `Selected editor text:\n${selectedText.trim()}` : "",
      ideContext?.trim() ? ideContext.trim() : ""
    ].filter(Boolean).join("\n\n").slice(0, 20000);
    const answer = await this.socratesService.askBetaProjectMemory({
      projectId: principal.projectId,
      actorUserId: principal.userId,
      content: question,
      source: "vscode",
      ideContext: temporaryIdeContext || undefined
    });
    await this.auditService.record({
      orgId: principal.orgId,
      projectId: principal.projectId,
      actorUserId: principal.userId,
      eventType: "vscode_socrates_asked",
      entityType: "project_editor_connector",
      entityId: principal.connectorId,
      payload: {
        tokenPrefix: principal.tokenPrefix,
        citationCount: answer.citations.length,
        selectedTextProvided: Boolean(selectedText?.trim()),
        ideContextProvided: Boolean(ideContext?.trim()),
        ideContextChars: temporaryIdeContext.length
      }
    });
    return answer;
  }

  private async authenticateVsCodeToken(authorization: string | undefined) {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    if (!token) {
      throw new AppError(401, "VS Code connector token required", "vscode_token_required");
    }
    const tokenPrefix = token.slice(0, 18);
    const connector = await this.prisma.projectEditorConnector.findFirst({
      where: {
        connectorType: "vscode",
        tokenPrefix,
        tokenHash: this.hashSecret(token),
        status: "connected"
      }
    });
    if (!connector || connector.revokedAt) {
      throw new AppError(401, "VS Code connector token denied", "vscode_token_denied");
    }
    if (connector.expiresAt && connector.expiresAt <= new Date()) {
      await this.prisma.projectEditorConnector.update({
        where: { id: connector.id },
        data: { status: "expired", tokenHash: null }
      });
      throw new AppError(401, "VS Code connector token expired", "vscode_token_expired");
    }
    await this.prisma.projectEditorConnector.update({
      where: { id: connector.id },
      data: { lastUsedAt: new Date() }
    });
    return {
      connectorId: connector.id,
      orgId: connector.orgId,
      projectId: connector.projectId,
      userId: connector.userId,
      tokenPrefix
    };
  }

  private async expireStalePairings(projectId: string) {
    await this.prisma.projectEditorConnector.updateMany({
      where: {
        projectId,
        connectorType: "vscode",
        status: "pairing_pending",
        expiresAt: { lt: new Date() }
      },
      data: {
        status: "expired",
        pairingCodeHash: null
      }
    });
  }

  private createPairingCode() {
    return `ORCH-${randomBytes(3).toString("hex").toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  }

  private hashSecret(secret: string) {
    const pepper = this.env.VSCODE_CONNECTOR_TOKEN_SECRET ?? this.env.JWT_ACCESS_SECRET;
    return createHash("sha256").update(`${pepper}:${secret}`).digest("hex");
  }

  private toPublicConnector(connector: {
    id: string;
    connectorType: string;
    label: string;
    tokenPrefix: string | null;
    status: string;
    scopesJson: unknown;
    createdAt: Date;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }, extra?: { pairingCode?: string }) {
    return {
      id: connector.id,
      connectorType: connector.connectorType,
      label: connector.label,
      tokenPrefix: connector.tokenPrefix,
      status: connector.status,
      scopes: Array.isArray(connector.scopesJson) ? connector.scopesJson : [...VSCODE_SCOPES],
      createdAt: connector.createdAt.toISOString(),
      expiresAt: connector.expiresAt?.toISOString() ?? null,
      lastUsedAt: connector.lastUsedAt?.toISOString() ?? null,
      revokedAt: connector.revokedAt?.toISOString() ?? null,
      pairingCode: extra?.pairingCode
    };
  }
}
