import type {
  Prisma,
  PrismaClient,
  ProjectDiagramSource,
  ProjectDiagramStatus,
  ProjectDiagramType
} from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../app/errors.js";
import type { GenerationProvider } from "../../lib/ai/provider.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { liveDocArtifactSchema } from "../live-doc/schemas.js";
import { ProjectService } from "../projects/service.js";
import { normalizeGeneratedMermaidSource, validateMermaidSource } from "./mermaid-validation.js";
import type {
  CreateDiagramInput,
  DiagramSourceRef,
  EmbedDiagramInput,
  GenerateDiagramInput,
  ListDiagramsQuery,
  UpdateDiagramInput
} from "./schemas.js";

type DiagramRow = Prisma.ProjectDiagramGetPayload<{
  include: {
    liveDocEmbeds: true;
  };
}>;

const generatedDiagramSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  mermaidSource: z.string().trim().min(1)
});

export class ProjectDiagramService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly generationProvider: GenerationProvider,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher
  ) {}

  async listDiagrams(projectId: string, actorUserId: string, query: ListDiagramsQuery) {
    if (query.includeDeleted) {
      await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    } else {
      await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    }
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = this.buildListWhere(projectId, query);
    const [totalCount, rows] = await Promise.all([
      this.prisma.projectDiagram.count({ where }),
      this.prisma.projectDiagram.findMany({
        where,
        include: { liveDocEmbeds: true },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
      }
    };
  }

  async getDiagram(projectId: string, diagramId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const row = await this.prisma.projectDiagram.findFirst({
      where: { id: diagramId, projectId, status: "active" },
      include: { liveDocEmbeds: true }
    });
    if (!row) {
      throw new AppError(404, "Diagram not found", "project_diagram_not_found");
    }
    return this.toDto(row);
  }

  async createDiagram(projectId: string, actorUserId: string, input: CreateDiagramInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const mermaidSource = validateMermaidSource({
      diagramType: input.diagramType,
      mermaidSource: input.mermaidSource
    });
    await this.validateLinkedRefs(projectId, {
      linkedDocumentSectionIds: input.linkedDocumentSectionIds,
      linkedBrainNodeIds: input.linkedBrainNodeIds,
      linkedContextEntryIds: input.linkedContextEntryIds,
      linkedArtifactVersionId: input.linkedArtifactVersionId ?? null
    });

    const row = await this.prisma.projectDiagram.create({
      data: {
        orgId: project.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        diagramType: input.diagramType,
        mermaidSource,
        source: input.source,
        status: "active",
        linkedDocumentSectionIdsJson: input.linkedDocumentSectionIds,
        linkedBrainNodeIdsJson: input.linkedBrainNodeIds,
        linkedContextEntryIdsJson: input.linkedContextEntryIds,
        linkedArtifactVersionId: input.linkedArtifactVersionId ?? null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId
      },
      include: { liveDocEmbeds: true }
    });

    await this.recordAudit(project.orgId, projectId, actorUserId, "project_diagram_created", row.id, this.auditSnapshot(row));
    await this.enqueueDashboardRefresh(projectId, "project_diagram_created");
    return this.toDto(row);
  }

  async updateDiagram(projectId: string, diagramId: string, actorUserId: string, input: UpdateDiagramInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const existing = await this.loadActiveDiagram(projectId, diagramId);
    const nextDiagramType = input.diagramType ?? existing.diagramType;
    const nextMermaidSource =
      input.mermaidSource !== undefined
        ? validateMermaidSource({ diagramType: nextDiagramType, mermaidSource: input.mermaidSource })
        : input.diagramType !== undefined
          ? validateMermaidSource({ diagramType: input.diagramType, mermaidSource: existing.mermaidSource })
          : existing.mermaidSource;

    const refs = {
      linkedDocumentSectionIds: input.linkedDocumentSectionIds ?? asStringArray(existing.linkedDocumentSectionIdsJson),
      linkedBrainNodeIds: input.linkedBrainNodeIds ?? asStringArray(existing.linkedBrainNodeIdsJson),
      linkedContextEntryIds: input.linkedContextEntryIds ?? asStringArray(existing.linkedContextEntryIdsJson),
      linkedArtifactVersionId:
        input.linkedArtifactVersionId !== undefined ? input.linkedArtifactVersionId : existing.linkedArtifactVersionId
    };
    await this.validateLinkedRefs(projectId, refs);

    const updated = await this.prisma.projectDiagram.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.diagramType !== undefined ? { diagramType: input.diagramType } : {}),
        ...(input.mermaidSource !== undefined || input.diagramType !== undefined ? { mermaidSource: nextMermaidSource } : {}),
        ...(input.linkedDocumentSectionIds !== undefined
          ? { linkedDocumentSectionIdsJson: input.linkedDocumentSectionIds }
          : {}),
        ...(input.linkedBrainNodeIds !== undefined ? { linkedBrainNodeIdsJson: input.linkedBrainNodeIds } : {}),
        ...(input.linkedContextEntryIds !== undefined ? { linkedContextEntryIdsJson: input.linkedContextEntryIds } : {}),
        ...(input.linkedArtifactVersionId !== undefined
          ? { linkedArtifactVersionId: input.linkedArtifactVersionId }
          : {}),
        updatedByUserId: actorUserId
      },
      include: { liveDocEmbeds: true }
    });

    await this.recordAudit(updated.orgId, projectId, actorUserId, "project_diagram_updated", updated.id, {
      before: this.auditSnapshot(existing),
      after: this.auditSnapshot(updated)
    });
    await this.enqueueDashboardRefresh(projectId, "project_diagram_updated");
    return this.toDto(updated);
  }

  async deleteDiagram(projectId: string, diagramId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const existing = await this.loadActiveDiagram(projectId, diagramId);
    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.liveDocSectionDiagram.deleteMany({ where: { projectId, diagramId } });
      return tx.projectDiagram.update({
        where: { id: diagramId },
        data: {
          status: "deleted",
          deletedAt: new Date(),
          deletedByUserId: actorUserId,
          updatedByUserId: actorUserId
        },
        include: { liveDocEmbeds: true }
      });
    });

    await this.recordAudit(deleted.orgId, projectId, actorUserId, "project_diagram_deleted", deleted.id, {
      deleted: this.auditSnapshot(existing)
    });
    await this.enqueueDashboardRefresh(projectId, "project_diagram_deleted");
    return { ok: true, deletedId: deleted.id };
  }

  async generateDiagram(projectId: string, actorUserId: string, input: GenerateDiagramInput) {
    if (input.save) {
      await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    } else {
      await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    }
    const project = await this.loadProject(projectId);
    const linkedRefs = await this.resolveSourceRefs(projectId, input.sourceRefs);
    const fallback = buildFallbackDiagram(input.diagramType, input.title ?? "Generated Diagram");
    const result = await this.generationProvider.generateObject({
      task: "project_diagram_generation",
      systemPrompt: [
        "Generate safe Mermaid source for an internal product diagram.",
        "Return Mermaid source only in mermaidSource; do not use markdown fences.",
        "Do not include HTML, scripts, links, Mermaid init/config directives, or external URLs.",
        "The diagram type must match the requested type."
      ].join("\n"),
      prompt: [
        `Project: ${project.name}`,
        `Diagram type: ${input.diagramType}`,
        `Requested title: ${input.title ?? "Generated Diagram"}`,
        `User prompt: ${input.prompt}`,
        linkedRefs.context.length
          ? `Grounding source refs:\n${linkedRefs.context.join("\n\n")}`
          : "No validated grounding refs were supplied. Use only the user's prompt and keep assumptions explicit in description."
      ].join("\n\n"),
      schema: generatedDiagramSchema,
      fallback: () => fallback,
      maxOutputTokens: 2500,
      telemetry: {
        projectId,
        diagramType: input.diagramType,
        save: input.save
      }
    });

    const mermaidSource = validateMermaidSource({
      diagramType: input.diagramType,
      mermaidSource: normalizeGeneratedMermaidSource(result.mermaidSource)
    });
    const title = (input.title ?? result.title ?? "Generated Diagram").trim().slice(0, 200);
    const description =
      input.description ??
      result.description ??
      (linkedRefs.context.length
        ? "Generated from validated project source references."
        : "Generated from the prompt only; validate assumptions before treating this as product truth.");

    if (!input.save) {
      return {
        proposed: {
          title,
          description,
          diagramType: input.diagramType,
          mermaidSource,
          source: "socrates_generated" as ProjectDiagramSource,
          linkedRefs: input.sourceRefs
        },
        validation: { ok: true },
        next: { canSave: true }
      };
    }

    const created = await this.createDiagram(projectId, actorUserId, {
      title,
      description,
      diagramType: input.diagramType,
      mermaidSource,
      source: "socrates_generated",
      linkedDocumentSectionIds: linkedRefs.linkedDocumentSectionIds,
      linkedBrainNodeIds: linkedRefs.linkedBrainNodeIds,
      linkedContextEntryIds: linkedRefs.linkedContextEntryIds,
      linkedArtifactVersionId: linkedRefs.linkedArtifactVersionId
    });
    await this.recordAudit(project.orgId, projectId, actorUserId, "project_diagram_generated", created.id, {
      diagramId: created.id,
      title: created.title,
      diagramType: created.diagramType,
      sourceRefCount: input.sourceRefs.length,
      mermaidLength: mermaidSource.length,
      saved: true
    });
    return created;
  }

  async embedDiagramInLiveDoc(
    projectId: string,
    sectionKey: string,
    diagramId: string,
    actorUserId: string,
    input: EmbedDiagramInput
  ) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const [project, diagram] = await Promise.all([this.loadProject(projectId), this.loadActiveDiagram(projectId, diagramId)]);
    await this.ensureLiveDocSectionExists(projectId, sectionKey);
    const embed = await this.prisma.liveDocSectionDiagram.upsert({
      where: {
        projectId_sectionKey_diagramId: {
          projectId,
          sectionKey,
          diagramId
        }
      },
      update: {
        sortOrder: input.sortOrder,
        embeddedByUserId: actorUserId
      },
      create: {
        orgId: project.orgId,
        projectId,
        sectionKey,
        diagramId,
        sortOrder: input.sortOrder,
        embeddedByUserId: actorUserId
      },
      include: { diagram: true }
    });

    await this.recordAudit(project.orgId, projectId, actorUserId, "live_doc_diagram_embedded", diagramId, {
      diagramId,
      title: diagram.title,
      diagramType: diagram.diagramType,
      sectionKey,
      sortOrder: embed.sortOrder
    });
    await this.enqueueDashboardRefresh(projectId, "live_doc_diagram_embedded");
    return this.toEmbedDto(embed);
  }

  async removeDiagramFromLiveDoc(projectId: string, sectionKey: string, diagramId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const [project, diagram] = await Promise.all([this.loadProject(projectId), this.loadActiveDiagram(projectId, diagramId)]);
    await this.prisma.liveDocSectionDiagram.deleteMany({ where: { projectId, sectionKey, diagramId } });
    await this.recordAudit(project.orgId, projectId, actorUserId, "live_doc_diagram_removed", diagramId, {
      diagramId,
      title: diagram.title,
      diagramType: diagram.diagramType,
      sectionKey
    });
    await this.enqueueDashboardRefresh(projectId, "live_doc_diagram_removed");
    return { ok: true, diagramId, sectionKey };
  }

  async getDiagramsForRetrieval(projectId: string, query: string, limit = 6) {
    const rows = await this.prisma.projectDiagram.findMany({
      where: {
        projectId,
        status: "active"
      },
      include: { liveDocEmbeds: true },
      orderBy: { updatedAt: "desc" },
      take: 100
    });
    const tokens = tokenize(query);
    return rows
      .map((row) => ({
        row,
        score: scoreText(tokens, `${row.title} ${row.description ?? ""} ${row.diagramType} ${row.mermaidSource}`)
      }))
      .filter((item) => tokens.length === 0 || item.score > 0)
      .sort((a, b) => b.score - a.score || b.row.updatedAt.getTime() - a.row.updatedAt.getTime())
      .slice(0, limit)
      .map(({ row, score }) => ({
        diagram: this.toDto(row),
        score,
        text: [
          `Diagram: ${row.diagramType} / ${row.title}`,
          row.description ? `Description: ${row.description}` : null,
          `Mermaid excerpt: ${excerpt(row.mermaidSource, 800)}`,
          row.liveDocEmbeds.length
            ? `Embedded in Live Doc sections: ${row.liveDocEmbeds.map((embed) => embed.sectionKey).join(", ")}`
            : null
        ]
          .filter(Boolean)
          .join("\n")
      }));
  }

  async buildDiagramSummary(projectId: string) {
    const [diagrams, embeddedCount] = await Promise.all([
      this.prisma.projectDiagram.findMany({
        where: { projectId, status: "active" },
        select: { diagramType: true, createdAt: true }
      }),
      this.prisma.liveDocSectionDiagram.count({
        where: {
          projectId,
          diagram: { status: "active" }
        }
      })
    ]);
    const byType = diagrams.reduce<Record<string, number>>((acc, diagram) => {
      acc[diagram.diagramType] = (acc[diagram.diagramType] ?? 0) + 1;
      return acc;
    }, {});
    const latestDiagramAt = diagrams
      .map((diagram) => diagram.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      totalCount: diagrams.length,
      embeddedCount,
      byType,
      latestDiagramAt: latestDiagramAt?.toISOString() ?? null,
      quickLinks: {
        diagramsPath: `/projects/${projectId}/diagrams`
      }
    };
  }

  async validateDiagramOpenTarget(projectId: string, diagramId: string, sectionKey?: string) {
    const diagram = await this.prisma.projectDiagram.findFirst({
      where: { id: diagramId, projectId, status: "active" },
      select: { id: true }
    });
    if (!diagram) return false;
    if (!sectionKey) return true;
    const embed = await this.prisma.liveDocSectionDiagram.findFirst({
      where: {
        projectId,
        sectionKey,
        diagramId,
        diagram: { status: "active" }
      },
      select: { id: true }
    });
    return Boolean(embed);
  }

  private buildListWhere(projectId: string, query: ListDiagramsQuery): Prisma.ProjectDiagramWhereInput {
    return {
      projectId,
      ...(query.includeDeleted ? {} : { status: "active" as ProjectDiagramStatus }),
      ...(query.diagramType ? { diagramType: query.diagramType } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
              { mermaidSource: { contains: query.q, mode: "insensitive" } }
            ]
          }
        : {})
    };
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true }
    });
    if (!project) {
      throw new AppError(404, "Project not found", "project_not_found");
    }
    return project;
  }

  private async loadActiveDiagram(projectId: string, diagramId: string) {
    const row = await this.prisma.projectDiagram.findFirst({
      where: { id: diagramId, projectId, status: "active" },
      include: { liveDocEmbeds: true }
    });
    if (!row) {
      throw new AppError(404, "Diagram not found", "project_diagram_not_found");
    }
    return row;
  }

  private async validateLinkedRefs(
    projectId: string,
    refs: {
      linkedDocumentSectionIds: string[];
      linkedBrainNodeIds: string[];
      linkedContextEntryIds: string[];
      linkedArtifactVersionId?: string | null;
    }
  ) {
    const checks: Array<Promise<boolean>> = [];
    if (refs.linkedDocumentSectionIds.length) {
      checks.push(
        this.prisma.documentSection
          .count({ where: { projectId, id: { in: refs.linkedDocumentSectionIds } } })
          .then((count) => count === refs.linkedDocumentSectionIds.length)
      );
    }
    if (refs.linkedBrainNodeIds.length) {
      checks.push(
        this.prisma.brainNode
          .count({ where: { projectId, id: { in: refs.linkedBrainNodeIds } } })
          .then((count) => count === refs.linkedBrainNodeIds.length)
      );
    }
    if (refs.linkedContextEntryIds.length) {
      checks.push(
        this.prisma.projectContextEntry
          .count({ where: { projectId, status: "active", id: { in: refs.linkedContextEntryIds } } })
          .then((count) => count === refs.linkedContextEntryIds.length)
      );
    }
    if (refs.linkedArtifactVersionId) {
      checks.push(
        this.prisma.artifactVersion
          .findFirst({ where: { projectId, id: refs.linkedArtifactVersionId }, select: { id: true } })
          .then(Boolean)
      );
    }
    const results = await Promise.all(checks);
    if (results.some((ok) => !ok)) {
      throw new AppError(422, "Diagram linked references must belong to the same project", "invalid_diagram_reference");
    }
  }

  private async resolveSourceRefs(projectId: string, refs: DiagramSourceRef[]) {
    const artifactVersionRefCount = refs.filter((ref) => ref.type === "artifact_version").length;
    if (artifactVersionRefCount > 1) {
      throw new AppError(422, "Only one artifact_version source reference can be linked to a diagram", "invalid_diagram_reference");
    }

    const linkedDocumentSectionIds: string[] = [];
    const linkedBrainNodeIds: string[] = [];
    const linkedContextEntryIds: string[] = [];
    let linkedArtifactVersionId: string | null = null;
    const context: string[] = [];

    for (const ref of refs) {
      switch (ref.type) {
        case "document_section": {
          const row = await this.prisma.documentSection.findFirst({
            where: { projectId, id: ref.id },
            select: { id: true, headingPath: true, normalizedText: true }
          });
          if (!row) throw new AppError(422, "Invalid diagram source reference", "invalid_diagram_reference");
          linkedDocumentSectionIds.push(row.id);
          context.push(`Document section ${row.headingPath.join(" > ")}:\n${excerpt(row.normalizedText, 1200)}`);
          break;
        }
        case "brain_node": {
          const row = await this.prisma.brainNode.findFirst({
            where: { projectId, id: ref.id },
            select: { id: true, title: true, summary: true, nodeType: true }
          });
          if (!row) throw new AppError(422, "Invalid diagram source reference", "invalid_diagram_reference");
          linkedBrainNodeIds.push(row.id);
          context.push(`Brain node ${row.nodeType} / ${row.title}:\n${excerpt(row.summary, 1200)}`);
          break;
        }
        case "project_context": {
          const row = await this.prisma.projectContextEntry.findFirst({
            where: { projectId, id: ref.id, status: "active" },
            select: { id: true, type: true, title: true, body: true }
          });
          if (!row) throw new AppError(422, "Invalid diagram source reference", "invalid_diagram_reference");
          linkedContextEntryIds.push(row.id);
          context.push(`Project context ${row.type} / ${row.title}:\n${excerpt(row.body, 1200)}`);
          break;
        }
        case "responsibility": {
          const row = await this.prisma.projectResponsibility.findFirst({
            where: { projectId, id: ref.id },
            select: { id: true, title: true, area: true, status: true, description: true }
          });
          if (!row) throw new AppError(422, "Invalid diagram source reference", "invalid_diagram_reference");
          context.push(`Responsibility ${row.area} / ${row.title} (${row.status}):\n${excerpt(row.description ?? "", 800)}`);
          break;
        }
        case "artifact_version": {
          const row = await this.prisma.artifactVersion.findFirst({
            where: { projectId, id: ref.id },
            select: { id: true, artifactType: true, versionNumber: true, payloadJson: true }
          });
          if (!row) throw new AppError(422, "Invalid diagram source reference", "invalid_diagram_reference");
          linkedArtifactVersionId = row.id;
          context.push(
            `Artifact ${row.artifactType} v${row.versionNumber}:\n${excerpt(JSON.stringify(row.payloadJson), 1500)}`
          );
          break;
        }
      }
    }

    await this.validateLinkedRefs(projectId, {
      linkedDocumentSectionIds,
      linkedBrainNodeIds,
      linkedContextEntryIds,
      linkedArtifactVersionId
    });

    return {
      linkedDocumentSectionIds,
      linkedBrainNodeIds,
      linkedContextEntryIds,
      linkedArtifactVersionId,
      context
    };
  }

  private async ensureLiveDocSectionExists(projectId: string, sectionKey: string) {
    if (sectionKey.startsWith("doc:")) {
      const documentSectionId = sectionKey.slice(4);
      const source = await this.prisma.projectLiveDocSource.findUnique({
        where: { projectId },
        include: { document: true, documentVersion: true }
      });
      const documentVersionId = source?.documentVersionId ?? source?.document?.currentVersionId;
      if (source && documentVersionId && (source.documentVersion?.status === "ready" || source.documentVersion?.status === "partial")) {
        const prdBackedSection = await this.prisma.documentSection.findFirst({
          where: {
            projectId,
            id: documentSectionId,
            documentVersionId,
            parseRevision: source.documentVersion?.parseRevision ?? 1
          },
          select: { id: true }
        });
        if (prdBackedSection) return;
      }
    }

    const artifact = await this.prisma.artifactVersion.findFirst({
      where: { projectId, artifactType: "live_doc", status: "accepted" },
      orderBy: { versionNumber: "desc" }
    });
    if (!artifact) {
      throw new AppError(409, "Live Doc must exist before embedding diagrams", "live_doc_not_ready");
    }
    const parsed = liveDocArtifactSchema.parse(artifact.payloadJson);
    if (!parsed.sections.some((section) => section.sectionKey === sectionKey)) {
      throw new AppError(422, "Live Doc section not found", "invalid_live_doc_section");
    }
  }

  private toDto(row: DiagramRow) {
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      description: row.description,
      diagramType: row.diagramType,
      mermaidSource: row.mermaidSource,
      source: row.source,
      status: row.status,
      linkedDocumentSectionIds: asStringArray(row.linkedDocumentSectionIdsJson),
      linkedBrainNodeIds: asStringArray(row.linkedBrainNodeIdsJson),
      linkedContextEntryIds: asStringArray(row.linkedContextEntryIdsJson),
      linkedArtifactVersionId: row.linkedArtifactVersionId,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      embeddedInLiveDoc: row.liveDocEmbeds.map((embed) => ({
        sectionKey: embed.sectionKey,
        sortOrder: embed.sortOrder,
        embeddedAt: embed.embeddedAt.toISOString()
      }))
    };
  }

  private toEmbedDto(embed: Prisma.LiveDocSectionDiagramGetPayload<{ include: { diagram: true } }>) {
    return {
      id: embed.id,
      projectId: embed.projectId,
      sectionKey: embed.sectionKey,
      diagramId: embed.diagramId,
      sortOrder: embed.sortOrder,
      embeddedAt: embed.embeddedAt.toISOString(),
      diagram: {
        id: embed.diagram.id,
        title: embed.diagram.title,
        description: embed.diagram.description,
        diagramType: embed.diagram.diagramType,
        mermaidSource: embed.diagram.mermaidSource,
        source: embed.diagram.source
      }
    };
  }

  private auditSnapshot(row: {
    id: string;
    title: string;
    diagramType: ProjectDiagramType;
    source: ProjectDiagramSource;
    status: ProjectDiagramStatus;
    mermaidSource: string;
    linkedDocumentSectionIdsJson: Prisma.JsonValue;
    linkedBrainNodeIdsJson: Prisma.JsonValue;
    linkedContextEntryIdsJson: Prisma.JsonValue;
    linkedArtifactVersionId: string | null;
  }) {
    return {
      diagramId: row.id,
      title: row.title,
      diagramType: row.diagramType,
      source: row.source,
      status: row.status,
      mermaidLength: row.mermaidSource.length,
      linkedDocumentSectionCount: asStringArray(row.linkedDocumentSectionIdsJson).length,
      linkedBrainNodeCount: asStringArray(row.linkedBrainNodeIdsJson).length,
      linkedContextEntryCount: asStringArray(row.linkedContextEntryIdsJson).length,
      linkedArtifactVersionId: row.linkedArtifactVersionId
    };
  }

  private async recordAudit(
    orgId: string,
    projectId: string,
    actorUserId: string,
    eventType: string,
    entityId: string,
    payload: unknown
  ) {
    await this.auditService.record({
      orgId,
      projectId,
      actorUserId,
      eventType,
      entityType: "project_diagram",
      entityId,
      payload
    });
  }

  private async enqueueDashboardRefresh(projectId: string, reason: string) {
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, reason);
  }
}

function asStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function excerpt(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
        .slice(0, 32)
    )
  );
}

function scoreText(tokens: string[], text: string) {
  const lower = text.toLowerCase();
  return tokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function buildFallbackDiagram(diagramType: ProjectDiagramType, title: string): z.infer<typeof generatedDiagramSchema> {
  if (diagramType === "sequence") {
    return {
      title,
      description: "Fallback sequence diagram generated from limited context.",
      mermaidSource: ["sequenceDiagram", "  participant User", "  participant Orchestra", "  User->>Orchestra: Request context", "  Orchestra-->>User: Return grounded diagram"].join("\n")
    };
  }
  return {
    title,
    description: "Fallback flowchart generated from limited context.",
    mermaidSource: [
      "flowchart TD",
      '  input["User prompt"]',
      '  evidence["Validated evidence"]',
      '  diagram["Persisted Mermaid diagram"]',
      '  livedoc["Optional Live Doc embed"]',
      "  input --> evidence",
      "  evidence --> diagram",
      "  diagram --> livedoc"
    ].join("\n")
  };
}
