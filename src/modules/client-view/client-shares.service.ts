import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import {
  generateClientShareToken,
  hashToken,
  verifyToken
} from "./client-share-token.js";
import {
  clientShareConfigSchema,
  defaultClientShareConfig,
  type ClientShareConfig
} from "./client-view.schemas.js";

export interface ResolvedShare {
  id: string;
  projectId: string;
  orgId: string;
  name: string;
  tokenPrefix: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  lastAccessedAt: Date | null;
  config: ClientShareConfig;
}

function parseConfig(raw: unknown): ClientShareConfig {
  if (!raw || typeof raw !== "object") return defaultClientShareConfig;
  return clientShareConfigSchema.parse({ ...defaultClientShareConfig, ...raw });
}

function toPublicShare(share: {
  id: string;
  projectId: string;
  orgId: string;
  name: string;
  tokenPrefix: string;
  status: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
  configJson: unknown;
  createdBy: string;
}): ResolvedShare {
  return {
    id: share.id,
    projectId: share.projectId,
    orgId: share.orgId,
    name: share.name,
    tokenPrefix: share.tokenPrefix,
    status: share.status,
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
    lastAccessedAt: share.lastAccessedAt,
    config: parseConfig(share.configJson)
  };
}

export class ClientSharesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly tokenSecret: string,
    private readonly appBaseUrl: string
  ) {}

  async listShares(projectId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const shares = await this.prisma.projectClientShare.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" }
    });
    return shares.map(toPublicShare);
  }

  async createShare(
    projectId: string,
    actorUserId: string,
    input: { name: string; expiresAt?: string; config?: Partial<ClientShareConfig> }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    const { rawToken, tokenHash, tokenPrefix } = generateClientShareToken(this.tokenSecret);
    const config: ClientShareConfig = clientShareConfigSchema.parse({
      ...defaultClientShareConfig,
      ...(input.config ?? {})
    });

    const share = await this.prisma.projectClientShare.create({
      data: {
        projectId,
        orgId: project.orgId,
        name: input.name,
        tokenHash,
        tokenPrefix,
        status: "active",
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: actorUserId,
        configJson: config
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "client_share_created",
      entityType: "project_client_share",
      entityId: share.id,
      payload: { name: share.name, tokenPrefix: share.tokenPrefix }
    });

    const clientUrl = `${this.appBaseUrl}/client/${rawToken}`;

    return {
      share: toPublicShare(share),
      // rawToken returned ONCE — caller must not log or store it
      token: rawToken,
      clientUrl
    };
  }

  async getShare(projectId: string, shareId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const share = await this.prisma.projectClientShare.findFirst({
      where: { id: shareId, projectId }
    });
    if (!share) throw new AppError(404, "Client share not found", "client_share_not_found");
    return toPublicShare(share);
  }

  async updateShare(
    projectId: string,
    shareId: string,
    actorUserId: string,
    input: { name?: string; expiresAt?: string | null; config?: Partial<ClientShareConfig> }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const share = await this.prisma.projectClientShare.findFirst({
      where: { id: shareId, projectId }
    });
    if (!share) throw new AppError(404, "Client share not found", "client_share_not_found");

    const existingConfig = parseConfig(share.configJson);
    const newConfig = input.config
      ? clientShareConfigSchema.parse({ ...existingConfig, ...input.config })
      : existingConfig;

    const updated = await this.prisma.projectClientShare.update({
      where: { id: shareId },
      data: {
        name: input.name ?? share.name,
        expiresAt: input.expiresAt !== undefined ? (input.expiresAt ? new Date(input.expiresAt) : null) : share.expiresAt,
        configJson: newConfig
      }
    });

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "client_share_updated",
      entityType: "project_client_share",
      entityId: shareId,
      payload: { name: updated.name }
    });

    return toPublicShare(updated);
  }

  async rotateToken(projectId: string, shareId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const share = await this.prisma.projectClientShare.findFirst({
      where: { id: shareId, projectId }
    });
    if (!share) throw new AppError(404, "Client share not found", "client_share_not_found");

    const { rawToken, tokenHash, tokenPrefix } = generateClientShareToken(this.tokenSecret);
    const updated = await this.prisma.projectClientShare.update({
      where: { id: shareId },
      data: { tokenHash, tokenPrefix, status: "active", revokedAt: null, revokedBy: null }
    });

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "client_share_rotated",
      entityType: "project_client_share",
      entityId: shareId,
      payload: { tokenPrefix }
    });

    const clientUrl = `${this.appBaseUrl}/client/${rawToken}`;
    return {
      share: toPublicShare(updated),
      token: rawToken,
      clientUrl
    };
  }

  async revokeShare(projectId: string, shareId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const share = await this.prisma.projectClientShare.findFirst({
      where: { id: shareId, projectId }
    });
    if (!share) throw new AppError(404, "Client share not found", "client_share_not_found");

    const updated = await this.prisma.projectClientShare.update({
      where: { id: shareId },
      data: { status: "revoked", revokedAt: new Date(), revokedBy: actorUserId }
    });

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "client_share_revoked",
      entityType: "project_client_share",
      entityId: shareId,
      payload: { revokedBy: actorUserId }
    });

    return toPublicShare(updated);
  }

  async resolveShareByToken(rawToken: string): Promise<{
    share: ResolvedShare & { tokenHash: string };
    project: { id: string; orgId: string; name: string; description: string | null; previewUrl: string | null; status: string };
  }> {
    const computed = hashToken(rawToken, this.tokenSecret);

    const share = await this.prisma.projectClientShare.findUnique({
      where: { tokenHash: computed },
      include: { project: true }
    });

    if (!share) {
      throw new AppError(404, "Client share not found", "client_share_not_found");
    }

    // Constant-time verification (defense-in-depth on top of indexed lookup)
    if (!verifyToken(rawToken, share.tokenHash, this.tokenSecret)) {
      throw new AppError(404, "Client share not found", "client_share_not_found");
    }

    if (share.status === "revoked") {
      throw new AppError(410, "Client share has been revoked", "client_share_revoked");
    }

    if (share.expiresAt && share.expiresAt < new Date()) {
      // Mark expired lazily
      await this.prisma.projectClientShare.update({
        where: { id: share.id },
        data: { status: "expired" }
      }).catch(() => undefined);
      throw new AppError(410, "Client share has expired", "client_share_expired");
    }

    if (share.status === "expired") {
      throw new AppError(410, "Client share has expired", "client_share_expired");
    }

    // Update lastAccessedAt asynchronously — do not block response
    void this.prisma.projectClientShare.update({
      where: { id: share.id },
      data: { lastAccessedAt: new Date() }
    }).catch(() => undefined);

    // Audit access (fire-and-forget)
    void this.auditService.record({
      orgId: share.orgId,
      projectId: share.projectId,
      actorUserId: null,
      eventType: "client_share_accessed",
      entityType: "project_client_share",
      entityId: share.id,
      payload: { tokenPrefix: share.tokenPrefix }
    }).catch(() => undefined);

    return {
      share: { ...toPublicShare(share), tokenHash: share.tokenHash },
      project: {
        id: share.project.id,
        orgId: share.project.orgId,
        name: share.project.name,
        description: share.project.description ?? null,
        previewUrl: share.project.previewUrl ?? null,
        status: share.project.status
      }
    };
  }
}
