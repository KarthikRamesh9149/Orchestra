import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { AuditService } from "../audit/service.js";
import { BrainService } from "../brain/service.js";
import type { ClientSharesService, ResolvedShare } from "./client-shares.service.js";
import type { ClientShareConfig } from "./client-view.schemas.js";
import {
  buildClientProjectSummary,
  projectBrainForClient,
  projectDocumentListForClient,
  projectGraphForClient,
  projectSectionForClient
} from "./client-view.projections.js";

type NavItem = { key: string; label: string };

export class ClientViewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly brainService: BrainService,
    private readonly clientSharesService: ClientSharesService,
    private readonly auditService: AuditService
  ) {}

  // ─── Token resolution helper ────────────────────────────────────────────────

  async resolveToken(rawToken: string) {
    return this.clientSharesService.resolveShareByToken(rawToken);
  }

  // ─── Bootstrap ──────────────────────────────────────────────────────────────

  async getBootstrap(rawToken: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    const navigation: NavItem[] = [{ key: "overview", label: "Overview" }];
    if (config.showPreview && project.previewUrl) navigation.push({ key: "preview", label: "Preview" });
    if (config.showBrain) navigation.push({ key: "brain", label: "Project Map" });
    if (config.showDocuments) navigation.push({ key: "documents", label: "Shared Docs" });
    if (config.enableSocrates) navigation.push({ key: "ask", label: "Ask" });

    return {
      share: {
        id: share.id,
        name: share.name,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        config: {
          showPreview: config.showPreview,
          showBrain: config.showBrain,
          showGraph: config.showGraph,
          showDocuments: config.showDocuments,
          enableSocrates: config.enableSocrates
        }
      },
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        previewUrl: config.showPreview ? project.previewUrl : null,
        status: project.status
      },
      capabilities: {
        preview: Boolean(config.showPreview && project.previewUrl),
        brain: config.showBrain,
        graph: config.showGraph,
        documents: config.showDocuments,
        socrates: config.enableSocrates
      },
      navigation
    };
  }

  // ─── Project summary ────────────────────────────────────────────────────────

  async getProjectSummary(rawToken: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    const [brainArtifact, recentChanges, sharedDocCount] = await Promise.all([
      this.prisma.artifactVersion.findFirst({
        where: { projectId: project.id, artifactType: "product_brain", status: "accepted" },
        orderBy: { versionNumber: "desc" }
      }),
      config.showAcceptedChangeSummaries
        ? this.prisma.specChangeProposal.findMany({
            where: { projectId: project.id, status: "accepted" },
            orderBy: { acceptedAt: "desc" },
            take: 5,
            select: { title: true, summary: true, acceptedAt: true }
          })
        : Promise.resolve([]),
      this.countSharedDocuments(project.id, config)
    ]);

    return buildClientProjectSummary({
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        previewUrl: config.showPreview ? project.previewUrl : null
      },
      brain: brainArtifact,
      recentChanges,
      sharedDocumentCount: sharedDocCount,
      config
    });
  }

  // ─── Brain ──────────────────────────────────────────────────────────────────

  async getBrain(rawToken: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    if (!config.showBrain) {
      throw new AppError(403, "Brain not enabled for this share", "client_share_feature_disabled");
    }

    const brainArtifact = await this.prisma.artifactVersion.findFirst({
      where: { projectId: project.id, artifactType: "product_brain", status: "accepted" },
      orderBy: { versionNumber: "desc" }
    });

    if (!brainArtifact) {
      throw new AppError(404, "Product Brain not available yet", "brain_not_ready");
    }

    const recentChanges = config.showAcceptedChangeSummaries
      ? await this.prisma.specChangeProposal.findMany({
          where: { projectId: project.id, status: "accepted" },
          orderBy: { acceptedAt: "desc" },
          take: 5,
          select: { title: true, summary: true, acceptedAt: true }
        })
      : [];

    return projectBrainForClient(brainArtifact, recentChanges, config);
  }

  // ─── Brain graph ─────────────────────────────────────────────────────────────

  async getGraph(rawToken: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    if (!config.showGraph) {
      throw new AppError(403, "Graph not enabled for this share", "client_share_feature_disabled");
    }

    const graphArtifact = await this.prisma.artifactVersion.findFirst({
      where: { projectId: project.id, artifactType: "brain_graph", status: "accepted" },
      orderBy: { versionNumber: "desc" }
    });

    if (!graphArtifact) {
      throw new AppError(404, "Brain graph not available yet", "graph_not_ready");
    }

    const [nodes, edges] = await Promise.all([
      this.prisma.brainNode.findMany({
        where: { artifactVersionId: graphArtifact.id },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.brainEdge.findMany({
        where: { artifactVersionId: graphArtifact.id }
      })
    ]);

    // Reuse existing BrainService client-safe node id logic
    const clientSafeNodeIds = await this.getClientSafeNodeIds(project.id, graphArtifact.id, config);

    return projectGraphForClient(graphArtifact, nodes, edges, clientSafeNodeIds);
  }

  // ─── Documents ──────────────────────────────────────────────────────────────

  async listDocuments(rawToken: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    if (!config.showDocuments) {
      throw new AppError(403, "Documents not enabled for this share", "client_share_feature_disabled");
    }

    const documents = await this.getSharedDocuments(project.id, config);
    return projectDocumentListForClient(documents);
  }

  async getDocumentView(rawToken: string, documentId: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    if (!config.showDocuments) {
      throw new AppError(403, "Documents not enabled for this share", "client_share_feature_disabled");
    }

    const document = await this.assertDocumentIsShared(documentId, project.id, config);
    const currentVersion = await this.resolveClientCurrentDocumentVersion(document, project.id);

    const sections = await this.prisma.documentSection.findMany({
      where: { documentVersionId: currentVersion.id, parseRevision: currentVersion.parseRevision },
      orderBy: { orderIndex: "asc" }
    });

    const clientSections = await Promise.all(
      sections.map(async (section) => {
        const changeSummaries = config.showAcceptedChangeSummaries
          ? await this.getSectionAcceptedChangeSummaries(project.id, section.id)
          : [];
        return projectSectionForClient(section, changeSummaries);
      })
    );

    return {
      document: {
        id: document.id,
        title: document.title,
        kind: document.kind,
        currentVersionId: document.currentVersionId,
        updatedAt: document.updatedAt.toISOString()
      },
      sections: clientSections
    };
  }

  async getAnchor(rawToken: string, documentId: string, anchorId: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    if (!config.showDocuments) {
      throw new AppError(403, "Documents not enabled for this share", "client_share_feature_disabled");
    }

    const document = await this.assertDocumentIsShared(documentId, project.id, config);
    const currentVersion = await this.resolveClientCurrentDocumentVersion(document, project.id);

    const section = await this.prisma.documentSection.findFirst({
      where: {
        anchorId,
        projectId: project.id,
        documentVersionId: currentVersion.id,
        parseRevision: currentVersion.parseRevision
      }
    });

    if (!section) {
      throw new AppError(404, "Anchor not found", "anchor_not_found");
    }

    const changeSummaries = config.showAcceptedChangeSummaries
      ? await this.getSectionAcceptedChangeSummaries(project.id, section.id)
      : [];

    return projectSectionForClient(section, changeSummaries);
  }

  async searchDocument(rawToken: string, documentId: string, q: string, limit = 20) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    if (!config.showDocuments) {
      throw new AppError(403, "Documents not enabled for this share", "client_share_feature_disabled");
    }

    const document = await this.assertDocumentIsShared(documentId, project.id, config);
    const currentVersion = await this.resolveClientCurrentDocumentVersion(document, project.id);

    const normalizedQ = q.toLowerCase();
    const sections = await this.prisma.documentSection.findMany({
      where: {
        documentVersionId: currentVersion.id,
        parseRevision: currentVersion.parseRevision,
        normalizedText: { contains: normalizedQ }
      },
      orderBy: { orderIndex: "asc" },
      take: Math.min(limit, 50)
    });

    return sections.map((section) => ({
      sectionId: section.id,
      anchorId: section.anchorId,
      pageNumber: section.pageNumber,
      headingPath: section.headingPath,
      excerpt: section.normalizedText.slice(0, 300),
      openTarget: {
        targetType: "document_section" as const,
        targetRef: {
          documentId: document.id,
          documentVersionId: currentVersion.id,
          anchorId: section.anchorId,
          ...(section.pageNumber ? { pageNumber: section.pageNumber } : {})
        }
      }
    }));
  }

  async getProvenance(rawToken: string, documentId: string, anchorId: string) {
    const { share, project } = await this.resolveToken(rawToken);
    const config = share.config;

    if (!config.showDocuments) {
      throw new AppError(403, "Documents not enabled for this share", "client_share_feature_disabled");
    }

    const document = await this.assertDocumentIsShared(documentId, project.id, config);
    const currentVersion = await this.resolveClientCurrentDocumentVersion(document, project.id);

    const section = await this.prisma.documentSection.findFirst({
      where: {
        anchorId,
        projectId: project.id,
        documentVersionId: currentVersion.id,
        parseRevision: currentVersion.parseRevision
      }
    });
    if (!section) throw new AppError(404, "Section not found", "anchor_not_found");

    // Adjacent sections (±2) from same document version
    const adjacent = await this.prisma.documentSection.findMany({
      where: {
        documentVersionId: section.documentVersionId,
        parseRevision: section.parseRevision,
        orderIndex: { gte: section.orderIndex - 2, lte: section.orderIndex + 2 },
        id: { not: section.id }
      },
      orderBy: { orderIndex: "asc" }
    });

    const changeSummaries = config.showAcceptedChangeSummaries
      ? await this.getSectionAcceptedChangeSummaries(project.id, section.id)
      : [];

    return {
      sectionId: section.id,
      anchorId: section.anchorId,
      headingPath: section.headingPath,
      text: section.normalizedText,
      acceptedChangeSummaries: changeSummaries,
      // No internal refs exposed in adjacentSections
      adjacentSections: adjacent.map((s) => ({
        sectionId: s.id,
        anchorId: s.anchorId,
        headingPath: s.headingPath,
        text: s.normalizedText
      }))
    };
  }

  // ─── Socrates ────────────────────────────────────────────────────────────────

  requireSocratesEnabled(config: ClientShareConfig) {
    if (!config.enableSocrates) {
      throw new AppError(403, "Socrates not enabled for this share", "client_socrates_disabled");
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async getSharedDocuments(projectId: string, config: ClientShareConfig) {
    const base = { projectId, visibility: "shared_with_client" as const };

    if (config.allowedDocumentIds.length > 0) {
      return this.prisma.document.findMany({
        where: {
          ...base,
          id: { in: config.allowedDocumentIds }
        },
        orderBy: { updatedAt: "desc" }
      });
    }

    return this.prisma.document.findMany({
      where: base,
      orderBy: { updatedAt: "desc" }
    });
  }

  private async countSharedDocuments(projectId: string, config: ClientShareConfig) {
    const base = { projectId, visibility: "shared_with_client" as const };
    if (config.allowedDocumentIds.length > 0) {
      return this.prisma.document.count({
        where: { ...base, id: { in: config.allowedDocumentIds } }
      });
    }
    return this.prisma.document.count({ where: base });
  }

  private async assertDocumentIsShared(
    documentId: string,
    projectId: string,
    config: ClientShareConfig
  ) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, projectId, visibility: "shared_with_client" }
    });

    if (!document) {
      // Do not reveal whether the document exists at all
      throw new AppError(404, "Document not found", "client_document_not_shared");
    }

    if (config.allowedDocumentIds.length > 0 && !config.allowedDocumentIds.includes(documentId)) {
      throw new AppError(404, "Document not found", "client_document_not_shared");
    }

    return document;
  }

  private async resolveClientCurrentDocumentVersion(
    document: { id: string; currentVersionId: string | null },
    projectId: string
  ) {
    if (!document.currentVersionId) {
      throw new AppError(404, "Document version not available", "document_version_not_found");
    }

    const currentVersion = await this.prisma.documentVersion.findUnique({
      where: { id: document.currentVersionId }
    });

    if (
      !currentVersion ||
      currentVersion.documentId !== document.id ||
      currentVersion.projectId !== projectId
    ) {
      throw new AppError(404, "Document version not available", "document_version_not_found");
    }

    if (currentVersion.status !== "ready" && currentVersion.status !== "partial") {
      throw new AppError(
        409,
        "Current document version is not ready for parsed viewing yet",
        "document_version_not_viewable"
      );
    }

    return currentVersion;
  }

  private async getSectionAcceptedChangeSummaries(projectId: string, sectionId: string): Promise<string[]> {
    const links = await this.prisma.specChangeLink.findMany({
      where: {
        projectId,
        linkType: "document_section",
        linkRefId: sectionId,
        proposal: { status: "accepted" }
      },
      include: {
        proposal: { select: { summary: true } }
      },
      take: 5
    });
    return links.map((link) => link.proposal.summary);
  }

  private async getClientSafeNodeIds(
    projectId: string,
    artifactVersionId: string,
    config: ClientShareConfig
  ): Promise<Set<string>> {
    // Nodes are client-safe if they are supported by at least one shared_with_client document section
    const documents = await this.prisma.document.findMany({
      where: {
        projectId,
        visibility: "shared_with_client",
        ...(config.allowedDocumentIds.length > 0 ? { id: { in: config.allowedDocumentIds } } : {})
      },
      select: { id: true, currentVersionId: true }
    });

    const currentVersionIds = documents
      .map((document) => document.currentVersionId)
      .filter((value): value is string => Boolean(value));

    if (currentVersionIds.length === 0) return new Set();

    const sharedVersionIds = await this.prisma.documentVersion
      .findMany({
        where: {
          id: { in: currentVersionIds },
          projectId,
          status: { in: ["ready", "partial"] }
        },
        select: { id: true, parseRevision: true }
      })
      .then((versions) => versions.map((v) => ({ id: v.id, parseRevision: v.parseRevision })));

    if (sharedVersionIds.length === 0) return new Set();

    const sharedSectionIds = await this.prisma.documentSection
      .findMany({
        where: {
          projectId,
          OR: sharedVersionIds.map((version) => ({
            documentVersionId: version.id,
            parseRevision: version.parseRevision
          }))
        },
        select: { id: true }
      })
      .then((sections) => new Set(sections.map((s) => s.id)));

    const links = await this.prisma.brainSectionLink.findMany({
      where: {
        projectId,
        artifactVersionId
      },
      select: { brainNodeId: true, documentSectionId: true }
    });

    const linkedSectionsByNode = new Map<string, string[]>();
    for (const link of links) {
      linkedSectionsByNode.set(link.brainNodeId, [
        ...(linkedSectionsByNode.get(link.brainNodeId) ?? []),
        link.documentSectionId
      ]);
    }

    return new Set(
      [...linkedSectionsByNode.entries()]
        .filter(([, sectionIds]) => sectionIds.length > 0 && sectionIds.every((sectionId) => sharedSectionIds.has(sectionId)))
        .map(([brainNodeId]) => brainNodeId)
    );
  }
}
