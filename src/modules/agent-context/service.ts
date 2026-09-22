import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { validateAgentContextCitation, validateAgentContextOpenTarget } from "./citations.js";
import { composeAgentContextPackSections, renderAgentContextBodyMarkdown } from "./composer.js";
import { AGENT_CONTEXT_EXPORT_FORMATS, renderAgentContextExport } from "./export-templates.js";
import { buildAgentContextLimitations } from "./limitations.js";
import type { AgentContextExportRequestInput, CreateAgentContextPackInput, ListAgentContextPacksQuery } from "./schemas.js";
import { filterAgentContextEvidenceForMvp, isCurrentTruthEvidence, rankAgentContextSources } from "./source-selection.js";
import { estimateAgentContextTokens } from "./token-estimator.js";
import type {
  AgentContextBuildInput,
  AgentContextEvidenceCandidate,
  AgentContextSeedReference,
  AgentContextVersionMetadata
} from "./types.js";

type PackWithSources = Prisma.AgentContextPackGetPayload<{ include: { sources: { orderBy: { sortOrder: "asc" } } } }>;

const defaultMvpProviders = ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"];
const unsupportedStoredOnlyStatuses = new Set(["pending", "processing", "failed"]);

export class AgentContextPackService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async createPack(projectId: string, actorUserId: string, input: CreateAgentContextPackInput) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const normalized = this.normalizeInput(input);
    await this.validateSeedReference(projectId, normalized);
    const built = await this.buildPack(projectId, normalized);
    const now = new Date();
    const pack = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentContextPack.create({
        data: {
          orgId: project.orgId,
          projectId,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          title: normalized.title ?? deriveTitle(normalized.taskPrompt),
          taskPrompt: normalized.taskPrompt,
          taskType: normalized.taskType,
          targetAgentJson: normalized.targetAgent ? (normalized.targetAgent as Prisma.InputJsonValue) : undefined,
          sourceMode: normalized.sourceMode,
          seedRefJson: normalized.seedReference ? (normalized.seedReference as Prisma.InputJsonValue) : undefined,
          visibility: normalized.visibility,
          budgetPreset: normalized.budgetPreset,
          maxTokenBudget: normalized.maxTokenBudget,
          tokenEstimate: built.tokenEstimate,
          tokenEstimateMethod: built.tokenEstimateMethod,
          sourceCount: built.sources.length,
          evidenceCount: built.sources.filter((source) => source.evidenceStatus !== "limitation").length,
          citationCount: built.citationCount,
          openTargetCount: built.openTargetCount,
          productBrainVersionId: built.versions.productBrainVersionId,
          liveDocVersionId: built.versions.liveDocVersionId,
          documentVersionId: built.versions.documentVersionId,
          artifactVersionId: built.versions.artifactVersionId,
          sectionsJson: built.sections as Prisma.InputJsonValue,
          bodyMarkdown: built.bodyMarkdown,
          limitationsJson: built.limitations as Prisma.InputJsonValue,
          warningsJson: built.warnings as Prisma.InputJsonValue,
          errorsJson: built.errors.length ? (built.errors as Prisma.InputJsonValue) : undefined,
          generatedAt: now,
          sources: { createMany: { data: built.sources.map((source) => toCreateMany(project.orgId, projectId, source)) } }
        },
        include: { sources: { orderBy: { sortOrder: "asc" } } }
      });
      return created;
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "agent_context_pack_created",
      entityType: "agent_context_pack",
      entityId: pack.id,
      payload: { packId: pack.id, taskType: pack.taskType, sourceMode: pack.sourceMode, sourceCount: pack.sourceCount }
    });
    return this.toDto(pack);
  }

  async listPacks(projectId: string, actorUserId: string, query: ListAgentContextPacksQuery) {
    await this.ensureAccess(projectId, actorUserId);
    const page = query.page;
    const pageSize = query.pageSize;
    const where = {
      projectId,
      ...(query.status ? { status: query.status } : { status: { not: "deleted" as const } }),
      ...(query.taskType ? { taskType: query.taskType } : {}),
      ...(query.sourceMode ? { sourceMode: query.sourceMode } : {})
    };
    const [totalCount, rows] = await Promise.all([
      this.prisma.agentContextPack.count({ where }),
      this.prisma.agentContextPack.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return {
      items: rows.map((row) => this.toListDto(row)),
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
      }
    };
  }

  async getPack(projectId: string, packId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const pack = await this.loadPack(projectId, packId);
    this.assertRecordedTruth(pack);
    return this.toDto(pack);
  }

  async refreshPack(projectId: string, packId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const existing = await this.loadPack(projectId, packId);
    if (existing.status === "deleted") throw new AppError(404, "Agent context pack not found", "agent_context_pack_not_found");
    const input: AgentContextBuildInput = {
      title: existing.title,
      taskPrompt: existing.taskPrompt,
      taskType: existing.taskType,
      sourceMode: existing.sourceMode,
      seedReference: parseSeedReference(existing.seedRefJson),
      targetAgent: parseRecord(existing.targetAgentJson),
      budgetPreset: existing.budgetPreset,
      maxTokenBudget: existing.maxTokenBudget ?? undefined,
      visibility: existing.visibility
    };
    await this.validateSeedReference(projectId, input);
    const built = await this.buildPack(projectId, input);
    const now = new Date();
    const pack = await this.prisma.$transaction(async (tx) => {
      await tx.agentContextPackSource.deleteMany({ where: { packId } });
      return tx.agentContextPack.update({
        where: { id: packId },
        data: {
          updatedByUserId: actorUserId,
          refreshedByUserId: actorUserId,
          status: "active",
          tokenEstimate: built.tokenEstimate,
          tokenEstimateMethod: built.tokenEstimateMethod,
          sourceCount: built.sources.length,
          evidenceCount: built.sources.filter((source) => source.evidenceStatus !== "limitation").length,
          citationCount: built.citationCount,
          openTargetCount: built.openTargetCount,
          productBrainVersionId: built.versions.productBrainVersionId,
          liveDocVersionId: built.versions.liveDocVersionId,
          documentVersionId: built.versions.documentVersionId,
          artifactVersionId: built.versions.artifactVersionId,
          sectionsJson: built.sections as Prisma.InputJsonValue,
          bodyMarkdown: built.bodyMarkdown,
          limitationsJson: built.limitations as Prisma.InputJsonValue,
          warningsJson: built.warnings as Prisma.InputJsonValue,
          errorsJson: built.errors.length ? (built.errors as Prisma.InputJsonValue) : undefined,
          refreshedAt: now,
          generatedAt: now,
          sources: { createMany: { data: built.sources.map((source) => toCreateMany(project.orgId, projectId, source)) } }
        },
        include: { sources: { orderBy: { sortOrder: "asc" } } }
      });
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "agent_context_pack_refreshed",
      entityType: "agent_context_pack",
      entityId: pack.id,
      payload: { packId: pack.id, sourceCount: pack.sourceCount }
    });
    return this.toDto(pack);
  }

  async archivePack(projectId: string, packId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    await this.loadPack(projectId, packId);
    const pack = await this.prisma.agentContextPack.update({
      where: { id: packId },
      data: { status: "archived", archivedAt: new Date(), updatedByUserId: actorUserId },
      include: { sources: { orderBy: { sortOrder: "asc" } } }
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "agent_context_pack_archived",
      entityType: "agent_context_pack",
      entityId: pack.id,
      payload: { packId }
    });
    // Archival remains available for legacy packs; content is retrieved only
    // through the guarded get/export paths, never as a mutation side effect.
    return this.toListDto(pack);
  }

  async deletePack(projectId: string, packId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    await this.loadPack(projectId, packId);
    const pack = await this.prisma.agentContextPack.update({
      where: { id: packId },
      data: { status: "deleted", deletedAt: new Date(), updatedByUserId: actorUserId },
      include: { sources: { orderBy: { sortOrder: "asc" } } }
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "agent_context_pack_deleted",
      entityType: "agent_context_pack",
      entityId: pack.id,
      payload: { packId, softDeleted: true }
    });
    return { ok: true, deletedId: pack.id, status: pack.status, deletedAt: pack.deletedAt };
  }

  async listExportFormats(projectId: string, packId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    await this.loadPack(projectId, packId);
    return AGENT_CONTEXT_EXPORT_FORMATS.map((format) => ({
      ...format,
      supportsPreview: true,
      supportsHistory: false
    }));
  }

  async previewExport(projectId: string, packId: string, actorUserId: string, input: AgentContextExportRequestInput) {
    return this.renderExport(projectId, packId, actorUserId, input, true);
  }

  async generateExport(projectId: string, packId: string, actorUserId: string, input: AgentContextExportRequestInput) {
    return this.renderExport(projectId, packId, actorUserId, input, false);
  }

  private async ensureAccess(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    if (member.projectRole === "client") {
      throw new AppError(403, "Client users cannot access internal Agent Context packs", "client_agent_context_access_forbidden");
    }
    return member;
  }

  private async renderExport(
    projectId: string,
    packId: string,
    actorUserId: string,
    input: AgentContextExportRequestInput,
    preview: boolean
  ) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const pack = await this.loadPack(projectId, packId);
    this.assertRecordedTruth(pack);
    if (input.redactionMode === "client_safe") {
      await this.auditService.record({
        orgId: project.orgId,
        projectId,
        actorUserId,
        eventType: "agent_context_pack_export_denied",
        entityType: "agent_context_pack",
        entityId: packId,
        payload: { packId, format: input.format, redactionMode: input.redactionMode, reason: "client_safe_not_proven" }
      });
      throw new AppError(
        409,
        "Client-safe Agent Context exports are readiness-gated until a server-side projection is proven for this pack.",
        "agent_context_client_safe_export_unavailable"
      );
    }
    const result = renderAgentContextExport(pack, input, {
      mvpMode: this.isMvpProviderGateEnabled(),
      enabledProviders: normalizeEnabledProviders((this.env as any).MVP_ENABLED_COMMUNICATION_PROVIDERS),
      preview
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: preview ? "agent_context_pack_export_previewed" : "agent_context_pack_export_generated",
      entityType: "agent_context_pack",
      entityId: packId,
      payload: {
        packId,
        format: input.format,
        redactionMode: input.redactionMode,
        budgetPreset: input.budgetPreset,
        sourceCount: result.sourceCount,
        warningCount: result.warnings.length,
        preview
      }
    });
    return result;
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, orgId: true, name: true } });
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    return project;
  }

  private async loadPack(projectId: string, packId: string) {
    const pack = await this.prisma.agentContextPack.findFirst({
      where: { id: packId, projectId, status: { not: "deleted" } },
      include: { sources: { orderBy: { sortOrder: "asc" } } }
    });
    if (!pack) throw new AppError(404, "Agent context pack not found", "agent_context_pack_not_found");
    return pack;
  }

  private assertRecordedTruth(pack: PackWithSources) {
    if (pack.sources.some((source) =>
      ["current_accepted_truth", "coding_requirement", "accepted_change", "accepted_decision"].includes(source.evidenceStatus)
      && !isCurrentTruthEvidence(source)
    )) {
      throw new AppError(409,
        "This context pack treated generated source context as accepted truth. Refresh the pack before retrieving or exporting it.",
        "agent_context_truth_refresh_required");
    }
  }

  private normalizeInput(input: CreateAgentContextPackInput): AgentContextBuildInput {
    return {
      ...input,
      budgetPreset: input.budgetPreset ?? "normal",
      visibility: input.visibility ?? "internal",
      seedReference: input.seedReference,
      targetAgent: input.targetAgent
    };
  }

  private async buildPack(projectId: string, input: AgentContextBuildInput) {
    const collected = await this.collectCandidates(projectId, input);
    const mvpFilter = filterAgentContextEvidenceForMvp(collected.candidates, {
      mvpMode: this.isMvpProviderGateEnabled(),
      enabledProviders: normalizeEnabledProviders((this.env as any).MVP_ENABLED_COMMUNICATION_PROVIDERS)
    });
    const invalidReferenceWarnings: string[] = [];
    const withValidatedRefs = mvpFilter.allowed.map((candidate) => {
      const citationResult = validateAgentContextCitation(candidate.citation);
      const openTargetResult = validateAgentContextOpenTarget(candidate.openTarget);
      if (!citationResult.valid) invalidReferenceWarnings.push(`Excluded invalid citation for ${candidate.title}: ${citationResult.reason}`);
      if (!openTargetResult.valid) invalidReferenceWarnings.push(`Excluded invalid open target for ${candidate.title}: ${openTargetResult.reason}`);
      return {
        ...candidate,
        citation: citationResult.valid ? candidate.citation : null,
        openTarget: openTargetResult.valid ? candidate.openTarget : null
      };
    });
    const ranked = rankAgentContextSources(withValidatedRefs, {
      budgetPreset: input.budgetPreset,
      seedReference: input.seedReference
    });
    const limitations = buildAgentContextLimitations({
      ...collected.state,
      excludedProviders: mvpFilter.excluded.map((candidate) => candidate.provider).filter((provider): provider is string => Boolean(provider)),
      invalidReferenceWarnings,
      candidates: ranked
    });
    const warnings = [
      ...invalidReferenceWarnings,
      ...mvpFilter.excluded.map((candidate) => `Excluded disabled provider evidence from ${candidate.provider}.`)
    ];
    const sections = composeAgentContextPackSections({
      title: input.title,
      taskPrompt: input.taskPrompt,
      taskType: input.taskType,
      candidates: ranked,
      limitations,
      warnings,
      budgetPreset: input.budgetPreset
    });
    const bodyMarkdown = renderAgentContextBodyMarkdown(sections);
    const tokenEstimate = estimateAgentContextTokens(bodyMarkdown);
    return {
      sections,
      bodyMarkdown,
      limitations,
      warnings,
      errors: [] as string[],
      sources: ranked,
      tokenEstimate: tokenEstimate.estimate,
      tokenEstimateMethod: tokenEstimate.method,
      citationCount: ranked.filter((candidate) => candidate.citation).length,
      openTargetCount: ranked.filter((candidate) => candidate.openTarget).length,
      versions: collected.versions
    };
  }

  private isMvpProviderGateEnabled() {
    return true;
  }

  private async validateSeedReference(projectId: string, input: AgentContextBuildInput) {
    const requiresSeed = !["task_prompt", "product_brain_area", "other"].includes(input.sourceMode);
    if (requiresSeed && !input.seedReference) {
      throw new AppError(400, "This Agent Context source mode requires a project-scoped seed reference", "agent_context_seed_required");
    }
    if (!input.seedReference) return;
    if (!seedTypeMatchesSourceMode(input.sourceMode, input.seedReference.type)) {
      throw new AppError(400, "Seed reference type does not match the requested Agent Context source mode", "agent_context_seed_type_mismatch");
    }
    const optionalPrisma = this.prisma as any;
    const seed = input.seedReference;
    let found: unknown = null;
    switch (seed.type) {
      case "product_brain":
      case "product_brain_area":
        found = await this.prisma.artifactVersion.findFirst({ where: { projectId, artifactType: "product_brain", status: "accepted", id: seed.id } });
        break;
      case "brain_node":
        found = await this.prisma.brainNode.findFirst({
          where: {
            projectId,
            id: seed.id,
            artifactVersion: { status: "accepted", artifactType: { in: ["brain_graph", "product_brain"] } }
          }
        });
        break;
      case "live_doc_section":
        found =
          (optionalPrisma.liveDocSectionDraft
            ? await optionalPrisma.liveDocSectionDraft.findFirst({ where: { projectId, status: "accepted", OR: [{ id: seed.id }, { sectionKey: seed.id }] } })
            : null) ??
          (await this.prisma.artifactVersion.findFirst({ where: { projectId, artifactType: "live_doc", status: "accepted", id: seed.id } }));
        break;
      case "coding_requirement":
        if (!optionalPrisma.projectCodingRequirements) throw new AppError(400, "Coding requirement seeds are not supported in this branch", "agent_context_seed_type_unsupported");
        found = await optionalPrisma.projectCodingRequirements.findFirst({
          where: { projectId, id: seed.id, artifactVersion: { status: "accepted", artifactType: "engineering_requirements" } }
        });
        break;
      case "diagram":
        if (!optionalPrisma.projectDiagram) throw new AppError(400, "Diagram seeds are not supported in this branch", "agent_context_seed_type_unsupported");
        found = await optionalPrisma.projectDiagram.findFirst({ where: { projectId, id: seed.id, status: "active" } });
        break;
      case "document_section":
        found = await this.prisma.documentSection.findFirst({ where: { projectId, OR: [{ id: seed.id }, { sectionKey: seed.id }] } });
        break;
      case "manual_context":
        if (!optionalPrisma.projectContextEntry) throw new AppError(400, "Manual context seeds are not supported in this branch", "agent_context_seed_type_unsupported");
        found = await optionalPrisma.projectContextEntry.findFirst({ where: { projectId, id: seed.id, status: "active" } });
        break;
      case "responsibility":
        if (!optionalPrisma.projectResponsibility) throw new AppError(400, "Responsibility seeds are not supported in this branch", "agent_context_seed_type_unsupported");
        found = await optionalPrisma.projectResponsibility.findFirst({ where: { projectId, id: seed.id } });
        break;
      case "change_proposal":
        found = await this.prisma.specChangeProposal.findFirst({ where: { projectId, id: seed.id } });
        break;
      case "decision_record":
        found = await this.prisma.decisionRecord.findFirst({ where: { projectId, id: seed.id } });
        break;
      case "dashboard":
        found = await this.prisma.dashboardSnapshot.findFirst({ where: { projectId, id: seed.id } });
        break;
      case "other":
        return;
      default:
        throw new AppError(400, "Unsupported Agent Context seed reference type", "agent_context_seed_type_unsupported");
    }
    if (!found) {
      throw new AppError(404, "Agent Context seed reference was not found in this project", "agent_context_seed_not_found");
    }
  }

  private async collectCandidates(projectId: string, input: AgentContextBuildInput) {
    const optionalPrisma = this.prisma as any;
    const [brain, nodes, liveDoc, documentSections, changes, decisions, contexts, messages, diagrams, coding, responsibilities, dashboard] =
      await Promise.all([
        this.prisma.artifactVersion.findFirst({ where: { projectId, artifactType: "product_brain", status: "accepted" }, orderBy: { versionNumber: "desc" } }),
        this.prisma.brainNode.findMany({ where: { projectId, status: { not: "deprecated" }, artifactVersion: { status: "accepted" } }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }], take: 20 }),
        this.prisma.artifactVersion.findFirst({ where: { projectId, artifactType: "live_doc", status: "accepted" }, orderBy: { versionNumber: "desc" } }),
        this.prisma.documentSection.findMany({
          where: { projectId, documentVersion: { status: { in: ["ready", "partial"] } } },
          include: { documentVersion: { include: { document: true } } },
          orderBy: [{ documentVersion: { createdAt: "desc" } }, { orderIndex: "asc" }],
          take: 30
        }),
        this.prisma.specChangeProposal.findMany({
          where: { projectId, status: { in: ["accepted", "needs_review", "detected", "rejected", "superseded"] } },
          orderBy: { updatedAt: "desc" },
          take: 20
        }),
        this.prisma.decisionRecord.findMany({ where: { projectId, status: "accepted" }, orderBy: { acceptedAt: "desc" }, take: 12 }),
        optionalPrisma.projectContextEntry
          ? optionalPrisma.projectContextEntry.findMany({ where: { projectId, status: "active" }, orderBy: [{ importance: "desc" }, { updatedAt: "desc" }], take: 16 })
          : Promise.resolve([]),
        this.prisma.communicationMessage.findMany({
          where: { projectId, isDeletedByProvider: false },
          include: { thread: true },
          orderBy: { sentAt: "desc" },
          take: 16
        }),
        optionalPrisma.projectDiagram
          ? optionalPrisma.projectDiagram.findMany({ where: { projectId, status: "active" }, orderBy: { updatedAt: "desc" }, take: 12 })
          : Promise.resolve([]),
        optionalPrisma.projectCodingRequirements
          ? optionalPrisma.projectCodingRequirements.findMany({ where: { projectId }, include: { artifactVersion: true, mermaidDiagram: true }, orderBy: { updatedAt: "desc" }, take: 5 })
          : Promise.resolve([]),
        optionalPrisma.projectResponsibility
          ? optionalPrisma.projectResponsibility.findMany({ where: { projectId, status: { not: "done" } }, orderBy: { updatedAt: "desc" }, take: 12 })
          : Promise.resolve([]),
        this.prisma.dashboardSnapshot.findFirst({ where: { projectId, scope: "project" }, orderBy: { computedAt: "desc" } })
      ]) as [any, any[], any, any[], any[], any[], any[], any[], any[], any[], any[], any];
    const candidates: AgentContextEvidenceCandidate[] = [];
    const versions: AgentContextVersionMetadata = {
      productBrainVersionId: brain?.id ?? null,
      liveDocVersionId: liveDoc?.id ?? null,
      documentVersionId: documentSections[0]?.documentVersionId ?? null,
      artifactVersionId: coding[0]?.artifactVersionId ?? liveDoc?.id ?? brain?.id ?? null
    };

    if (brain) {
      candidates.push(candidate({
        id: brain.id,
        sourceType: "product_brain",
        sourceRefType: "product_brain",
        sourceRefId: brain.id,
        relationship: "derived_context",
        title: `Product Brain v${brain.versionNumber}`,
        excerpt: summarizeJson(brain.payloadJson),
        evidenceStatus: "manual_context",
        whyItMatters: "Generated Product Brain context; acceptance is established only by the specific recorded decisions below.",
        score: 70,
        artifactVersionId: brain.id,
        citation: { type: "product_brain", id: brain.id, label: `Product Brain v${brain.versionNumber}` },
        openTarget: { targetType: "product_brain", targetRef: { artifactVersionId: brain.id } }
      }));
    }
    for (const node of nodes) {
      candidates.push(candidate({
        id: node.id,
        sourceType: "brain_node",
        sourceRefType: "brain_node",
        sourceRefId: node.id,
        relationship: "derived_context",
        title: node.title,
        excerpt: node.summary,
        evidenceStatus: "manual_context",
        whyItMatters: "Generated graph summary of source material, not a recorded approval.",
        score: 62,
        artifactVersionId: node.artifactVersionId,
        citation: { type: "brain_node", id: node.id, label: node.title },
        openTarget: { targetType: "brain_node", targetRef: { brainNodeId: node.id } }
      }));
    }
    if (liveDoc) {
      candidates.push(candidate({
        id: liveDoc.id,
        sourceType: "live_doc_section",
        sourceRefType: "live_doc",
        sourceRefId: liveDoc.id,
        relationship: "derived_context",
        title: `Live Doc v${liveDoc.versionNumber}`,
        excerpt: summarizeJson(liveDoc.payloadJson),
        evidenceStatus: "manual_context",
        whyItMatters: "Derived Live Doc context; its lifecycle status does not approve every included statement.",
        score: 68,
        artifactVersionId: liveDoc.id,
        citation: { type: "live_doc_section", id: liveDoc.id, label: `Live Doc v${liveDoc.versionNumber}` },
        openTarget: { targetType: "live_doc_section", targetRef: { artifactVersionId: liveDoc.id } }
      }));
    }
    for (const section of documentSections) {
      const status = unsupportedStoredOnlyStatuses.has(section.documentVersion.status) ? "limitation" : "original_source";
      candidates.push(candidate({
        id: section.id,
        sourceType: "document_section",
        sourceRefType: "document_section",
        sourceRefId: section.id,
        relationship: "source_evidence",
        title: `${section.documentVersion.document.title}: ${section.headingPath.join(" > ") || section.sectionKey}`,
        excerpt: section.normalizedText,
        evidenceStatus: status,
        score: 58,
        documentVersionId: section.documentVersionId,
        citation: { type: "document_section", id: section.id, label: section.anchorText ?? section.sectionKey },
        openTarget: { targetType: "document_section", targetRef: { documentSectionId: section.id, anchorId: section.anchorId } }
      }));
    }
    for (const proposal of changes) {
      const accepted = proposal.status === "accepted";
      candidates.push(candidate({
        id: proposal.id,
        sourceType: "change_proposal",
        sourceRefType: "change_proposal",
        sourceRefId: proposal.id,
        relationship: accepted ? "accepted_change" : "review_pressure",
        title: proposal.title,
        excerpt: proposal.summary,
        evidenceStatus: accepted ? "accepted_change" : "pending_suggestion",
        score: accepted ? 86 : 25,
        isCurrentTruth: accepted,
        isPending: !accepted,
        citation: { type: "change_proposal", id: proposal.id, label: proposal.title },
        openTarget: { targetType: "change_proposal", targetRef: { proposalId: proposal.id } }
      }));
    }
    for (const decision of decisions) {
      candidates.push(candidate({
        id: decision.id,
        sourceType: "decision_record",
        sourceRefType: "decision_record",
        sourceRefId: decision.id,
        relationship: "accepted_decision",
        title: decision.title,
        excerpt: decision.statement,
        evidenceStatus: "accepted_decision",
        score: 84,
        isCurrentTruth: true,
        citation: { type: "decision_record", id: decision.id, label: decision.title },
        openTarget: { targetType: "decision_record", targetRef: { decisionRecordId: decision.id } }
      }));
    }
    for (const context of contexts) {
      candidates.push(candidate({
        id: context.id,
        sourceType: "project_context",
        sourceRefType: "project_context",
        sourceRefId: context.id,
        relationship: "manual_context",
        title: context.title,
        excerpt: context.body,
        evidenceStatus: context.type === "manual_transcript" ? "transcript_evidence" : "manual_context",
        score: context.importance === "high" ? 72 : 52,
        provider: context.source === "imported" && /fireflies/i.test(context.title) ? "fireflies_ai" : null,
        citation: { type: "project_context", id: context.id, label: context.title },
        openTarget: { targetType: "project_context", targetRef: { contextId: context.id } }
      }));
    }
    for (const message of messages) {
      candidates.push(candidate({
        id: message.id,
        sourceType: "communication_message",
        sourceRefType: "communication_message",
        sourceRefId: message.id,
        relationship: "communication_evidence",
        title: message.thread.subject ?? `${message.provider} message`,
        excerpt: message.bodyText,
        evidenceStatus: message.provider === "fireflies_ai" ? "transcript_evidence" : "communication_evidence",
        score: 46,
        provider: message.provider,
        sourceDomain: "communication_messages",
        citation: { type: "message", id: message.id, label: message.thread.subject ?? message.senderLabel },
        openTarget: { targetType: "communication_message", targetRef: { messageId: message.id, threadId: message.threadId } }
      }));
    }
    for (const diagram of diagrams) {
      candidates.push(candidate({
        id: diagram.id,
        sourceType: "project_diagram",
        sourceRefType: "project_diagram",
        sourceRefId: diagram.id,
        relationship: "diagram",
        title: diagram.title,
        excerpt: `${diagram.description ?? ""}\n${diagram.mermaidSource}`.trim(),
        evidenceStatus: "diagram",
        score: 63,
        artifactVersionId: diagram.linkedArtifactVersionId,
        citation: { type: "project_diagram", id: diagram.id, label: diagram.title },
        openTarget: { targetType: "project_diagram", targetRef: { diagramId: diagram.id } }
      }));
    }
    for (const requirement of coding) {
      candidates.push(candidate({
        id: requirement.id,
        sourceType: "coding_requirements",
        sourceRefType: "coding_requirements",
        sourceRefId: requirement.id,
        relationship: "coding_requirement",
        title: `Coding requirements ${requirement.artifactVersion.versionNumber}`,
        excerpt: summarizeJson(requirement.artifactVersion.payloadJson),
        evidenceStatus: "manual_context",
        whyItMatters: "Generated coding guidance; verify it against recorded accepted decisions before implementation.",
        score: 80,
        artifactVersionId: requirement.artifactVersionId,
        citation: { type: "coding_requirements", id: requirement.id, label: "Coding requirements" },
        openTarget: { targetType: "coding_requirements", targetRef: { codingRequirementsId: requirement.id } }
      }));
    }
    for (const responsibility of responsibilities) {
      candidates.push(candidate({
        id: responsibility.id,
        sourceType: "project_responsibility",
        sourceRefType: "project_responsibility",
        sourceRefId: responsibility.id,
        relationship: "responsibility_task",
        title: responsibility.title,
        excerpt: responsibility.description ?? `${responsibility.area} is ${responsibility.status}`,
        evidenceStatus: "responsibility_task",
        score: 45,
        citation: { type: "project_responsibility", id: responsibility.id, label: responsibility.title },
        openTarget: { targetType: "project_responsibility", targetRef: { responsibilityId: responsibility.id } }
      }));
    }
    if (dashboard) {
      candidates.push(candidate({
        id: dashboard.id,
        sourceType: "dashboard_snapshot",
        sourceRefType: "dashboard_snapshot",
        sourceRefId: dashboard.id,
        relationship: "dashboard_signal",
        title: "Project dashboard snapshot",
        excerpt: summarizeJson(dashboard.payloadJson),
        evidenceStatus: "dashboard_signal",
        score: 36,
        citation: { type: "dashboard_snapshot", id: dashboard.id, label: "Project dashboard" },
        openTarget: { targetType: "dashboard_snapshot", targetRef: { dashboardSnapshotId: dashboard.id } }
      }));
    }
    return {
      candidates: applyDomainFilters(candidates, input),
      versions,
      state: {
        hasProductBrain: Boolean(brain),
        hasLiveDoc: Boolean(liveDoc),
        hasDocuments: documentSections.some((section) => !unsupportedStoredOnlyStatuses.has(section.documentVersion.status)),
        hasCodingRequirements: coding.length > 0,
        hasDiagrams: diagrams.length > 0,
        hasResponsibilities: responsibilities.length > 0,
        hasManualContext: contexts.length > 0,
        hasCommunicationEvidence: messages.length > 0
      }
    };
  }

  private toDto(pack: PackWithSources) {
    const sections = pack.visibility === "redacted" ? redactPackSections(pack.sectionsJson) : pack.sectionsJson;
    return {
      id: pack.id,
      status: pack.status,
      title: pack.title,
      taskPrompt: pack.taskPrompt,
      taskType: pack.taskType,
      sourceMode: pack.sourceMode,
      seedReference: pack.seedRefJson,
      targetAgent: pack.targetAgentJson,
      budgetPreset: pack.budgetPreset,
      visibility: pack.visibility,
      sections,
      bodyMarkdown: pack.visibility === "redacted" ? renderAgentContextBodyMarkdown(sections as any) : pack.bodyMarkdown,
      citations: pack.sources.map((source) => source.citationJson).filter(Boolean),
      openTargets: pack.sources.map((source) => source.openTargetJson).filter(Boolean),
      sources: pack.sources.map((source) => ({
        id: source.id,
        sourceType: source.sourceType,
        sourceRefType: source.sourceRefType,
        sourceRefId: source.sourceRefId,
        relationship: source.relationship,
        title: source.title,
        excerpt: pack.visibility === "redacted" ? null : source.excerpt,
        summary: source.summary,
        whyItMatters: source.whyItMatters,
        citation: source.citationJson,
        openTarget: source.openTargetJson,
        evidenceStatus: source.evidenceStatus,
        confidence: source.confidence,
        sortOrder: source.sortOrder,
        provider: pack.visibility === "redacted" ? null : source.provider,
        sourceDomain: pack.visibility === "redacted" ? null : source.sourceDomain
      })),
      sourceCount: pack.sourceCount,
      evidenceCount: pack.evidenceCount,
      citationCount: pack.citationCount,
      openTargetCount: pack.openTargetCount,
      tokenEstimate: pack.tokenEstimate,
      tokenEstimateMethod: pack.tokenEstimateMethod,
      productBrainVersionId: pack.productBrainVersionId,
      liveDocVersionId: pack.liveDocVersionId,
      documentVersionId: pack.documentVersionId,
      artifactVersionId: pack.artifactVersionId,
      limitations: pack.limitationsJson,
      warnings: pack.warningsJson,
      errors: pack.errorsJson,
      generatedAt: pack.generatedAt.toISOString(),
      refreshedAt: pack.refreshedAt?.toISOString() ?? null,
      archivedAt: pack.archivedAt?.toISOString() ?? null,
      deletedAt: pack.deletedAt?.toISOString() ?? null,
      createdByUserId: pack.createdByUserId,
      updatedByUserId: pack.updatedByUserId,
      createdAt: pack.createdAt.toISOString(),
      updatedAt: pack.updatedAt.toISOString()
    };
  }

  private toListDto(pack: Prisma.AgentContextPackGetPayload<Record<string, never>>) {
    const limitations = toStringArray(pack.limitationsJson);
    const warnings = toStringArray(pack.warningsJson);
    return {
      id: pack.id,
      title: pack.title,
      taskType: pack.taskType,
      sourceMode: pack.sourceMode,
      status: pack.status,
      budgetPreset: pack.budgetPreset,
      tokenEstimate: pack.tokenEstimate,
      sourceCount: pack.sourceCount,
      evidenceCount: pack.evidenceCount,
      productBrainVersionId: pack.productBrainVersionId,
      createdByUserId: pack.createdByUserId,
      createdAt: pack.createdAt.toISOString(),
      refreshedAt: pack.refreshedAt?.toISOString() ?? null,
      archivedAt: pack.archivedAt?.toISOString() ?? null,
      limitationsSummary: limitations.slice(0, 3),
      warningSummary: warnings.slice(0, 3)
    };
  }
}

function candidate(input: Partial<AgentContextEvidenceCandidate> & Pick<AgentContextEvidenceCandidate, "id" | "sourceType" | "sourceRefType" | "sourceRefId" | "relationship" | "title" | "evidenceStatus" | "score">): AgentContextEvidenceCandidate {
  return {
    excerpt: null,
    summary: input.excerpt ?? null,
    whyItMatters: whyItMattersFor(input.evidenceStatus),
    citation: null,
    openTarget: null,
    confidence: Math.max(0.1, Math.min(0.99, input.score / 100)),
    sortOrder: 0,
    provider: null,
    sourceDomain: input.sourceType,
    isCurrentTruth: false,
    isPending: false,
    visibility: "internal",
    ...input
  };
}

function toCreateMany(orgId: string, projectId: string, source: AgentContextEvidenceCandidate) {
  return {
    orgId,
    projectId,
    sourceType: source.sourceType,
    sourceRefType: source.sourceRefType,
    sourceRefId: source.sourceRefId,
    relationship: source.relationship,
    title: source.title,
    excerpt: source.excerpt?.slice(0, 2000) ?? null,
    summary: source.summary?.slice(0, 1000) ?? null,
    whyItMatters: source.whyItMatters?.slice(0, 1000) ?? null,
    citationJson: source.citation ? (source.citation as Prisma.InputJsonValue) : undefined,
    openTargetJson: source.openTarget ? (source.openTarget as Prisma.InputJsonValue) : undefined,
    evidenceStatus: source.evidenceStatus as any,
    confidence: source.confidence ?? null,
    sortOrder: source.sortOrder,
    visibility: source.visibility ?? "internal",
    provider: source.provider ?? null,
    sourceDomain: source.sourceDomain ?? null
  };
}

function summarizeJson(value: unknown) {
  if (typeof value === "string") return value.slice(0, 3000);
  if (!value || typeof value !== "object") return "";
  const strings: string[] = [];
  const visit = (item: unknown) => {
    if (strings.join(" ").length > 3000) return;
    if (typeof item === "string") {
      if (item.trim()) strings.push(item.trim());
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 12)) visit(child);
      return;
    }
    if (item && typeof item === "object") {
      for (const child of Object.values(item as Record<string, unknown>).slice(0, 12)) visit(child);
    }
  };
  visit(value);
  return strings.join("; ").slice(0, 3000);
}

function normalizeEnabledProviders(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return defaultMvpProviders;
}

function deriveTitle(taskPrompt: string) {
  return taskPrompt.replace(/\s+/g, " ").trim().slice(0, 80) || "Agent context pack";
}

function parseSeedReference(value: unknown): AgentContextSeedReference | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.type === "string" && typeof record.id === "string") {
    return { type: record.type, id: record.id, label: typeof record.label === "string" ? record.label : undefined };
  }
  return undefined;
}

function parseRecord(value: unknown): { name?: string; kind?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    kind: typeof record.kind === "string" ? record.kind : undefined
  };
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function redactPackSections(value: unknown) {
  const clone = JSON.parse(JSON.stringify(value ?? {})) as Record<string, any>;
  if (clone.currentAcceptedTruth && Array.isArray(clone.currentAcceptedTruth.items)) {
    clone.currentAcceptedTruth.items = clone.currentAcceptedTruth.items.map(() => "Current accepted truth summary redacted for this pack response.");
  }
  if (clone.relevantSourceEvidence && Array.isArray(clone.relevantSourceEvidence.items)) {
    clone.relevantSourceEvidence.items = clone.relevantSourceEvidence.items.map((item: Record<string, unknown>) => ({
      ...item,
      excerpt: "[redacted]",
      summary: undefined,
      provider: undefined,
      sourceDomain: undefined
    }));
  }
  return clone;
}

function applyDomainFilters(candidates: AgentContextEvidenceCandidate[], input: AgentContextBuildInput) {
  const include = new Set(input.includeEvidenceDomains ?? []);
  const exclude = new Set(input.excludeEvidenceDomains ?? []);
  return candidates.filter((candidate) => {
    const domain = candidate.sourceDomain ?? candidate.sourceType;
    if (include.size > 0 && !include.has(domain)) return false;
    return !exclude.has(domain);
  });
}

function seedTypeMatchesSourceMode(sourceMode: string, seedType: string) {
  const allowedByMode: Record<string, string[]> = {
    task_prompt: ["other"],
    product_brain_node: ["brain_node"],
    product_brain_area: ["product_brain", "product_brain_area", "brain_node", "other"],
    live_doc_section: ["live_doc_section"],
    coding_requirement: ["coding_requirement"],
    diagram: ["diagram"],
    document_section: ["document_section"],
    manual_context: ["manual_context"],
    responsibility_or_task: ["responsibility"],
    other: ["other", "change_proposal", "decision_record"]
  };
  return (allowedByMode[sourceMode] ?? ["other"]).includes(seedType);
}

function whyItMattersFor(status: string) {
  switch (status) {
    case "current_accepted_truth":
      return "Accepted current truth for this project.";
    case "accepted_change":
      return "Accepted change that updates current project truth.";
    case "accepted_decision":
      return "Accepted decision that constrains implementation.";
    case "original_source":
      return "Original source evidence for provenance.";
    case "pending_suggestion":
      return "Pending review pressure only; not current truth.";
    default:
      return "Relevant evidence selected by the deterministic context-pack builder.";
  }
}
