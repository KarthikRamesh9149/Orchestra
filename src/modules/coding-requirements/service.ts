import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { AppError } from "../../app/errors.js";
import type { GenerationProvider } from "../../lib/ai/provider.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { validateCodingFlowchart, safeMermaidLabel } from "./validation.js";
import { buildCodingRequirementsPrompt, buildCodingRequirementsSystemPrompt } from "./prompts.js";
import {
  codingRequirementsPayloadSchema,
  type CodingRequirementsPayload,
  type CodingRequirementsSourceRef,
  type GenerateCodingRequirementsInput
} from "./schemas.js";
import { ProjectService } from "../projects/service.js";
import type { CitationSchema, OpenTargetRef } from "../socrates/schemas.js";

type EvidenceCard = {
  evidenceId: string;
  sourceType: CitationSchema["type"];
  title: string;
  excerpt: string;
  whySelected: string;
  citationRef: CitationSchema;
  openTarget?: OpenTargetRef;
};

type CodingRequirementsRow = Prisma.ProjectCodingRequirementsGetPayload<{
  include: {
    artifactVersion: true;
    mermaidDiagram: true;
  };
}>;

export class CodingRequirementsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly generationProvider: GenerationProvider,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher
  ) {}

  async generate(projectId: string, actorUserId: string, input: GenerateCodingRequirementsInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const evidence = await this.buildEvidencePack(projectId, input);
    const fallback = this.buildFallbackPayload(evidence.cards);
    const generated = await this.generationProvider.generateObject({
      task: "coding_requirements_generation",
      systemPrompt: buildCodingRequirementsSystemPrompt(),
      prompt: buildCodingRequirementsPrompt({
        projectName: project.name,
        focus: input.focus,
        prompt: input.prompt,
        evidenceText: this.formatEvidenceForPrompt(evidence.cards)
      }),
      schema: codingRequirementsPayloadSchema,
      fallback: () => fallback,
      maxOutputTokens: 6000,
      timeoutMs: 30_000,
      telemetry: {
        projectId,
        focus: input.focus,
        sourceRefCount: input.sourceRefs.length
      }
    });

    const payload = this.validatePayload(generated, evidence.cards);
    const persisted = await this.persistPayload(project, actorUserId, payload, input, evidence.cards);
    return {
      ...persisted,
      next: {
        flowchartPath: `/v1/projects/${projectId}/coding-requirements/flowchart`,
        liveDocRecommendedSections: [
          "coding_requirements",
          "main_coding_flowchart",
          "module_breakdown",
          "implementation_unknowns"
        ]
      }
    };
  }

  async getCurrent(projectId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const row = await this.loadCurrent(projectId);
    if (!row) {
      throw new AppError(404, "Coding requirements not found", "coding_requirements_not_found");
    }
    return this.toDto(row, true);
  }

  async acceptDraft(projectId: string, codingRequirementsId: string, actorUserId: string) {
    const approval = await this.projectService.ensureProjectTruthApprover(projectId, actorUserId);
    const existing = await this.prisma.projectCodingRequirements.findFirst({
      where: { id: codingRequirementsId, projectId },
      include: { artifactVersion: true, mermaidDiagram: true }
    });
    if (!existing) throw new AppError(404, "Coding requirements draft not found", "coding_requirements_not_found");
    if (existing.artifactVersion.status === "accepted") return this.toDto(existing, true);
    if (existing.artifactVersion.status !== "draft") {
      throw new AppError(409, "Only a draft coding-requirements artifact can be accepted", "coding_requirements_not_acceptable");
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.artifactVersion.updateMany({
        where: { id: existing.artifactVersionId, projectId, artifactType: "engineering_requirements", status: "draft" },
        data: { status: "accepted", acceptedAt: new Date() }
      });
      if (claimed.count !== 1) {
        throw new AppError(409, "Coding requirements changed while being reviewed; reload before accepting", "coding_requirements_state_changed");
      }
      await tx.artifactVersion.updateMany({
        where: {
          projectId,
          artifactType: "engineering_requirements",
          status: "accepted",
          id: { not: existing.artifactVersionId }
        },
        data: { status: "superseded" }
      });
      if (existing.mermaidDiagramId) {
        await tx.projectDiagram.update({
          where: { id: existing.mermaidDiagramId },
          data: { status: "active", updatedByUserId: actorUserId }
        });
      }
      await tx.socratesSuggestion.deleteMany({ where: { session: { projectId } } });
    });

    const accepted = await this.prisma.projectCodingRequirements.findFirstOrThrow({
      where: { id: codingRequirementsId, projectId },
      include: { artifactVersion: true, mermaidDiagram: true }
    });
    await this.auditService.record({
      orgId: accepted.orgId,
      projectId,
      actorUserId,
      eventType: "coding_requirements_accepted",
      entityType: "coding_requirements",
      entityId: codingRequirementsId,
      payload: {
        artifactVersionId: accepted.artifactVersionId,
        acceptedByAuthority: approval.authority,
        delegatedApproverGrantId: approval.delegatedApproverGrantId
      }
    });
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "coding_requirements_accepted");
    return this.toDto(accepted, true);
  }

  async getHistory(projectId: string, actorUserId: string, query: { page: number; pageSize: number }) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const page = Math.max(query.page, 1);
    const pageSize = Math.min(Math.max(query.pageSize, 1), 50);
    const [totalCount, rows] = await Promise.all([
      this.prisma.projectCodingRequirements.count({ where: { projectId } }),
      this.prisma.projectCodingRequirements.findMany({
        where: { projectId },
        include: { artifactVersion: true, mermaidDiagram: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return {
      items: rows.map((row) => this.toDto(row, false)),
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
      }
    };
  }

  async getFlowchart(projectId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const row = await this.loadCurrent(projectId);
    if (!row) {
      throw new AppError(404, "Coding requirements not found", "coding_requirements_not_found");
    }
    const payload = codingRequirementsPayloadSchema.parse(row.artifactVersion.payloadJson);
    return {
      mermaid: payload.mermaid,
      diagram: isActiveCodingFlowchart(row.mermaidDiagram)
        ? {
            id: row.mermaidDiagram.id,
            projectId: row.mermaidDiagram.projectId,
            title: row.mermaidDiagram.title,
            description: row.mermaidDiagram.description,
            diagramType: row.mermaidDiagram.diagramType,
            mermaidSource: row.mermaidDiagram.mermaidSource,
            source: row.mermaidDiagram.source,
            status: row.mermaidDiagram.status,
            createdAt: row.mermaidDiagram.createdAt.toISOString(),
            updatedAt: row.mermaidDiagram.updatedAt.toISOString()
          }
        : null,
      artifactVersionId: row.artifactVersionId,
      generatedAt: payload.generatedAt
    };
  }

  async buildEngineeringSummary(projectId: string) {
    const row = await this.prisma.projectCodingRequirements.findFirst({
      where: { projectId, artifactVersion: { status: "accepted", artifactType: "engineering_requirements" } },
      include: { artifactVersion: true, mermaidDiagram: true },
      orderBy: { createdAt: "desc" }
    });
    if (!row) return this.emptyEngineeringSummary(projectId);
    const payload = codingRequirementsPayloadSchema.parse(row.artifactVersion.payloadJson);
    return {
      hasCodingRequirements: true,
      latestGeneratedAt: payload.generatedAt,
      moduleCount: payload.modules.length,
      unknownCount: payload.unknowns.length + payload.modules.reduce((count, module) => count + module.unknowns.length, 0),
      flowchartAvailable: isActiveCodingFlowchart(row.mermaidDiagram),
      quickLinks: {
        codingRequirementsPath: `/projects/${projectId}/coding-requirements`,
        flowchartPath: `/projects/${projectId}/coding-requirements/flowchart`
      }
    };
  }

  async getCodingRequirementsForRetrieval(projectId: string, query: string, limit = 4) {
    const rows = await this.prisma.projectCodingRequirements.findMany({
      where: { projectId, artifactVersion: { artifactType: "engineering_requirements", status: "accepted" } },
      include: { artifactVersion: true, mermaidDiagram: true },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    const tokens = tokenize(query);
    return rows
      .map((row) => {
        const payload = codingRequirementsPayloadSchema.parse(row.artifactVersion.payloadJson);
        const text = [
          payload.summary,
          payload.modules.map((module) => `${module.name} ${module.purpose} ${module.requirements.join(" ")}`).join(" "),
          payload.unknowns.join(" "),
          payload.mermaid
        ].join(" ");
        const score = scoreText(tokens, text);
        return { row, payload, score };
      })
      .sort((left, right) => right.score - left.score || right.row.createdAt.getTime() - left.row.createdAt.getTime())
      .slice(0, limit)
      .map(({ row, payload, score }) => ({
        id: row.id,
        sourceType: "coding_requirements" as const,
        domain: "coding_requirements" as const,
        content: [
          `Coding requirements: ${payload.summary}`,
          `Modules: ${payload.modules.map((module) => module.name).join(", ")}`,
          payload.unknowns.length ? `Unknowns: ${payload.unknowns.join("; ")}` : null,
          `Mermaid excerpt: ${excerpt(payload.mermaid, 500)}`
        ]
          .filter(Boolean)
          .join("\n"),
        contextualContent: payload.summary,
        label: "Current Coding Requirements",
        containerId: projectId,
        artifactVersionId: row.artifactVersionId,
        codingRequirementsId: row.id,
        sourcePrecedence: "engineering_artifact" as const,
        evidenceRole: "engineering_artifact" as const,
        openTarget: {
          targetType: "coding_requirements",
          targetRef: { projectId, codingRequirementsId: row.id, artifactVersionId: row.artifactVersionId }
        },
        citationRef: { type: "coding_requirements", id: row.id, label: "Current Coding Requirements" },
        lexicalScore: score,
        citationAvailabilityScore: 1,
        retrievalStage: "structured" as const,
        whySelected: `persisted coding requirements; lexical=${score.toFixed(3)}`,
        finalScore: score + 0.5,
        isClientSafe: false,
        isInternalOnly: true,
        evidenceCompleteness: payload.evidenceSummary.lowEvidence ? "partial" as const : "complete" as const
      }));
  }

  private async buildEvidencePack(projectId: string, input: GenerateCodingRequirementsInput) {
    const cards: EvidenceCard[] = [];
    const add = (card: EvidenceCard) => {
      const key = `${card.citationRef.type}:${card.citationRef.refId}`;
      if (!cards.some((existing) => `${existing.citationRef.type}:${existing.citationRef.refId}` === key)) {
        cards.push(card);
      }
    };

    for (const ref of input.sourceRefs) {
      add(await this.resolveSourceRef(projectId, ref));
    }

    const [
      productBrain,
      brainNodes,
      documentSections,
      contexts,
      responsibilities,
      diagrams,
      decisions,
      changes,
      messages
    ] = await Promise.all([
      this.prisma.artifactVersion.findFirst({
        where: { projectId, artifactType: "product_brain", status: "accepted" },
        orderBy: { versionNumber: "desc" }
      }),
      this.prisma.brainNode.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 8 }),
      this.prisma.documentSection.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { documentVersion: { include: { document: true } } }
      }),
      this.prisma.projectContextEntry.findMany({
        where: { projectId, status: "active" },
        orderBy: { updatedAt: "desc" },
        take: 8
      }),
      this.prisma.projectResponsibility.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: 8 }),
      this.prisma.projectDiagram.findMany({ where: { projectId, status: "active" }, orderBy: { updatedAt: "desc" }, take: 5 }),
      this.prisma.decisionRecord.findMany({
        where: { projectId, status: { in: ["accepted", "open"] } },
        orderBy: { updatedAt: "desc" },
        take: 6
      }),
      this.prisma.specChangeProposal.findMany({
        where: { projectId, status: { in: ["accepted", "needs_review"] } },
        orderBy: { updatedAt: "desc" },
        take: 6
      }),
      this.prisma.communicationMessage.findMany({
        where: { projectId, isDeletedByProvider: false },
        orderBy: { sentAt: "desc" },
        take: 6,
        include: { thread: true }
      })
    ]);

    if (productBrain) {
      add({
        evidenceId: `product_brain:${productBrain.id}`,
        sourceType: "product_brain",
        title: "Accepted Product Brain",
        excerpt: excerpt(JSON.stringify(productBrain.payloadJson), 1600),
        whySelected: "latest accepted Product Brain",
        citationRef: { type: "product_brain", refId: productBrain.id, label: "Accepted Product Brain", confidence: 1 }
      });
    }
    for (const node of brainNodes) {
      add({
        evidenceId: `brain_node:${node.id}`,
        sourceType: "brain_node",
        title: node.title,
        excerpt: excerpt(`${node.nodeType}: ${node.summary}`, 900),
        whySelected: "current brain graph node",
        citationRef: { type: "brain_node", refId: node.id, label: node.title, confidence: 0.9 },
        openTarget: { targetType: "brain_node", targetRef: { nodeId: node.id, artifactVersionId: node.artifactVersionId } }
      });
    }
    for (const section of documentSections) {
      add({
        evidenceId: `document_section:${section.id}`,
        sourceType: "document_section",
        title: section.headingPath.join(" > ") || section.documentVersion.document.title,
        excerpt: excerpt(section.normalizedText, 1000),
        whySelected: "document section evidence",
        citationRef: { type: "document_section", refId: section.id, label: section.headingPath.join(" > ") || "Document section" },
        openTarget: {
          targetType: "document_section",
          targetRef: {
            documentId: section.documentVersion.documentId,
            documentVersionId: section.documentVersionId,
            anchorId: section.anchorId,
            pageNumber: section.pageStart ?? undefined
          }
        }
      });
    }
    for (const context of contexts) {
      add({
        evidenceId: `project_context:${context.id}`,
        sourceType: "project_context",
        title: context.title,
        excerpt: excerpt(context.body, 900),
        whySelected: `manual context ${context.type}`,
        citationRef: { type: "project_context", refId: context.id, label: context.title },
        openTarget: { targetType: "project_context", targetRef: { projectId, contextId: context.id } }
      });
    }
    for (const responsibility of responsibilities) {
      add({
        evidenceId: `project_responsibility:${responsibility.id}`,
        sourceType: "project_responsibility",
        title: responsibility.title,
        excerpt: excerpt(`${responsibility.area} ${responsibility.status} ${responsibility.description ?? ""}`, 700),
        whySelected: "team responsibility context",
        citationRef: { type: "project_responsibility", refId: responsibility.id, label: responsibility.title },
        openTarget: { targetType: "project_responsibility", targetRef: { projectId, responsibilityId: responsibility.id } }
      });
    }
    for (const diagram of diagrams) {
      add({
        evidenceId: `project_diagram:${diagram.id}`,
        sourceType: "project_diagram",
        title: diagram.title,
        excerpt: excerpt(`${diagram.diagramType} ${diagram.description ?? ""} ${diagram.mermaidSource}`, 900),
        whySelected: "persisted project diagram",
        citationRef: { type: "project_diagram", refId: diagram.id, label: diagram.title },
        openTarget: { targetType: "project_diagram", targetRef: { projectId, diagramId: diagram.id } }
      });
    }
    for (const decision of decisions) {
      add({
        evidenceId: `decision_record:${decision.id}`,
        sourceType: "decision_record",
        title: decision.title,
        excerpt: excerpt(`${decision.status} ${decision.statement} ${decision.sourceSummary ?? ""}`, 700),
        whySelected: "accepted/open decision context",
        citationRef: { type: "decision_record", refId: decision.id, label: decision.title },
        openTarget: { targetType: "decision_record", targetRef: { decisionId: decision.id } }
      });
    }
    for (const proposal of changes) {
      add({
        evidenceId: `change_proposal:${proposal.id}`,
        sourceType: "change_proposal",
        title: proposal.title,
        excerpt: excerpt(`${proposal.status} ${proposal.summary ?? ""}`, 700),
        whySelected: "change proposal context",
        citationRef: { type: "change_proposal", refId: proposal.id, label: proposal.title },
        openTarget: { targetType: "change_proposal", targetRef: { proposalId: proposal.id } }
      });
    }
    for (const message of messages) {
      add({
        evidenceId: `message:${message.id}`,
        sourceType: "message",
        title: message.thread?.subject ?? "Communication message",
        excerpt: excerpt(message.bodyText ?? message.bodyHtml ?? "", 800),
        whySelected: "communication evidence",
        citationRef: { type: "message", refId: message.id, label: message.thread?.subject ?? "Message" },
        openTarget: { targetType: "message", targetRef: { messageId: message.id, threadId: message.threadId ?? undefined } }
      });
    }

    return { cards: cards.slice(0, 40) };
  }

  private async resolveSourceRef(projectId: string, ref: CodingRequirementsSourceRef): Promise<EvidenceCard> {
    switch (ref.type) {
      case "document": {
        const section = await this.prisma.documentSection.findFirst({
          where: { projectId, documentVersion: { documentId: ref.id, document: { projectId } } },
          include: { documentVersion: { include: { document: true } } },
          orderBy: { orderIndex: "asc" }
        });
        if (!section) throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        return {
          evidenceId: `document:${ref.id}`,
          sourceType: "document_section",
          title: section.documentVersion.document.title,
          excerpt: excerpt(section.normalizedText, 1000),
          whySelected: "explicit source ref",
          citationRef: { type: "document_section", refId: section.id, label: section.documentVersion.document.title },
          openTarget: {
            targetType: "document_section",
            targetRef: { documentId: ref.id, documentVersionId: section.documentVersionId, anchorId: section.anchorId }
          }
        };
      }
      case "document_section": {
        const section = await this.prisma.documentSection.findFirst({
          where: { id: ref.id, projectId },
          include: { documentVersion: { include: { document: true } } }
        });
        if (!section) throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        return {
          evidenceId: `document_section:${section.id}`,
          sourceType: "document_section",
          title: section.headingPath.join(" > ") || "Document section",
          excerpt: excerpt(section.normalizedText, 1000),
          whySelected: "explicit source ref",
          citationRef: { type: "document_section", refId: section.id, label: section.headingPath.join(" > ") || "Document section" },
          openTarget: {
            targetType: "document_section",
            targetRef: { documentId: section.documentVersion.documentId, documentVersionId: section.documentVersionId, anchorId: section.anchorId }
          }
        };
      }
      case "brain_node": {
        const node = await this.prisma.brainNode.findFirst({ where: { id: ref.id, projectId } });
        if (!node) throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        return {
          evidenceId: `brain_node:${node.id}`,
          sourceType: "brain_node",
          title: node.title,
          excerpt: excerpt(node.summary, 800),
          whySelected: "explicit source ref",
          citationRef: { type: "brain_node", refId: node.id, label: node.title },
          openTarget: { targetType: "brain_node", targetRef: { nodeId: node.id, artifactVersionId: node.artifactVersionId } }
        };
      }
      case "project_context": {
        const context = await this.prisma.projectContextEntry.findFirst({ where: { id: ref.id, projectId, status: "active" } });
        if (!context) throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        return {
          evidenceId: `project_context:${context.id}`,
          sourceType: "project_context",
          title: context.title,
          excerpt: excerpt(context.body, 900),
          whySelected: "explicit source ref",
          citationRef: { type: "project_context", refId: context.id, label: context.title },
          openTarget: { targetType: "project_context", targetRef: { projectId, contextId: context.id } }
        };
      }
      case "project_responsibility": {
        const responsibility = await this.prisma.projectResponsibility.findFirst({ where: { id: ref.id, projectId } });
        if (!responsibility) throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        return {
          evidenceId: `project_responsibility:${responsibility.id}`,
          sourceType: "project_responsibility",
          title: responsibility.title,
          excerpt: excerpt(`${responsibility.area} ${responsibility.description ?? ""}`, 700),
          whySelected: "explicit source ref",
          citationRef: { type: "project_responsibility", refId: responsibility.id, label: responsibility.title },
          openTarget: { targetType: "project_responsibility", targetRef: { projectId, responsibilityId: responsibility.id } }
        };
      }
      case "project_diagram": {
        const diagram = await this.prisma.projectDiagram.findFirst({ where: { id: ref.id, projectId, status: "active" } });
        if (!diagram) throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        return {
          evidenceId: `project_diagram:${diagram.id}`,
          sourceType: "project_diagram",
          title: diagram.title,
          excerpt: excerpt(diagram.mermaidSource, 900),
          whySelected: "explicit source ref",
          citationRef: { type: "project_diagram", refId: diagram.id, label: diagram.title },
          openTarget: { targetType: "project_diagram", targetRef: { projectId, diagramId: diagram.id } }
        };
      }
      case "artifact_version": {
        const artifact = await this.prisma.artifactVersion.findFirst({ where: { id: ref.id, projectId, status: "accepted" } });
        if (!artifact) throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        if (artifact.artifactType === "engineering_requirements") {
          const requirements = await this.prisma.projectCodingRequirements.findFirst({
            where: { projectId, artifactVersionId: artifact.id }
          });
          if (!requirements) {
            throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
          }
          return {
            evidenceId: `coding_requirements:${requirements.id}`,
            sourceType: "coding_requirements",
            title: `Engineering requirements v${artifact.versionNumber}`,
            excerpt: excerpt(JSON.stringify(artifact.payloadJson), 1000),
            whySelected: "explicit engineering requirements artifact source ref",
            citationRef: { type: "coding_requirements", refId: requirements.id, label: `Engineering requirements v${artifact.versionNumber}` },
            openTarget: {
              targetType: "coding_requirements",
              targetRef: { projectId, codingRequirementsId: requirements.id, artifactVersionId: artifact.id }
            }
          };
        }
        if (artifact.artifactType !== "product_brain") {
          throw new AppError(422, "Invalid coding requirements source reference", "invalid_coding_requirements_source_ref");
        }
        return {
          evidenceId: `artifact_version:${artifact.id}`,
          sourceType: "product_brain",
          title: `${artifact.artifactType} v${artifact.versionNumber}`,
          excerpt: excerpt(JSON.stringify(artifact.payloadJson), 1000),
          whySelected: "explicit artifact source ref",
          citationRef: { type: "product_brain", refId: artifact.id, label: `${artifact.artifactType} v${artifact.versionNumber}` }
        };
      }
    }
  }

  private validatePayload(payload: CodingRequirementsPayload, evidenceCards: EvidenceCard[]) {
    const evidenceCitationKeys = new Set(evidenceCards.map((card) => `${card.citationRef.type}:${card.citationRef.refId}`));
    const evidenceTargetKeys = new Set(evidenceCards.map((card) => card.openTarget ? JSON.stringify(card.openTarget) : null).filter(Boolean));
    const sanitizeCitations = (citations: CitationSchema[]) =>
      citations.filter((citation) => evidenceCitationKeys.has(`${citation.type}:${citation.refId}`));
    const sanitizeTargets = (targets: OpenTargetRef[]) =>
      targets.filter((target) => evidenceTargetKeys.has(JSON.stringify(target)));
    const parsed = codingRequirementsPayloadSchema.parse({
      ...payload,
      mermaid: validateCodingFlowchart(payload.mermaid),
      citations: sanitizeCitations(payload.citations),
      openTargets: sanitizeTargets(payload.openTargets),
      modules: payload.modules.map((module) => ({
        ...module,
        citations: sanitizeCitations(module.citations),
        openTargets: sanitizeTargets(module.openTargets)
      }))
    });
    return parsed;
  }

  private buildFallbackPayload(evidenceCards: EvidenceCard[]): CodingRequirementsPayload {
    const generatedAt = new Date().toISOString();
    const lowEvidence = evidenceCards.length < 3;
    const primaryCards = evidenceCards.slice(0, Math.max(1, Math.min(6, evidenceCards.length)));
    const modules = (primaryCards.length ? primaryCards : [{
      title: "Implementation discovery",
      excerpt: "No strong project evidence was available.",
      citationRef: undefined,
      openTarget: undefined
    } as unknown as EvidenceCard]).map((card, index) => ({
      name: normalizeTitle(card.title || `Module ${index + 1}`),
      purpose: card.excerpt ? excerpt(card.excerpt, 300) : "Clarify implementation scope from project evidence.",
      requirements: card.excerpt ? [excerpt(card.excerpt, 300)] : ["Collect accepted Product Brain, PRD/SRS, or manual context before implementation."],
      apis: [],
      dataModels: [],
      dependencies: index === 0 ? [] : [normalizeTitle(primaryCards[index - 1]?.title ?? "Prior module")],
      risks: lowEvidence ? ["Evidence is insufficient to confirm implementation details."] : [],
      suggestedBuildOrder: index + 1,
      assumptions: lowEvidence ? ["Module boundaries are provisional until more evidence is added."] : [],
      unknowns: lowEvidence ? ["Confirm exact APIs, data models, and technical stack from source evidence."] : [],
      citations: card.citationRef ? [card.citationRef] : [],
      openTargets: card.openTarget ? [card.openTarget] : []
    }));
    return {
      summary: lowEvidence
        ? "Evidence is limited. This output captures a cautious implementation outline and highlights unknowns."
        : "Engineering requirements were generated from current project evidence.",
      modules,
      globalRequirements: ["Use accepted Product Brain and cited source evidence as implementation inputs."],
      integrationPoints: [],
      assumptions: lowEvidence ? ["Do not treat this as final technical scope until evidence improves."] : [],
      unknowns: lowEvidence ? ["Technology stack, API contracts, and data model details may be incomplete."] : [],
      suggestedBuildOrder: modules.map((module) => ({
        order: module.suggestedBuildOrder,
        moduleName: module.name,
        reason: module.dependencies.length ? "Build after dependencies are clarified." : "Start with foundational scope.",
        dependencies: module.dependencies
      })),
      mermaid: buildMermaid(modules.map((module) => module.name)),
      citations: modules.flatMap((module) => module.citations),
      openTargets: modules.flatMap((module) => module.openTargets),
      generatedAt,
      evidenceSummary: {
        sourceCounts: countBy(evidenceCards.map((card) => card.sourceType)),
        lowEvidence,
        limitations: lowEvidence
          ? ["Low evidence: add Product Brain, PRD/SRS, or manual context before using as final build plan."]
          : []
      }
    };
  }

  private async persistPayload(
    project: { id: string; orgId: string },
    actorUserId: string,
    payload: CodingRequirementsPayload,
    input: GenerateCodingRequirementsInput,
    evidenceCards: EvidenceCard[]
  ) {
    const changeSummary = createSignature(payload);
    const result = await this.prisma.$transaction(async (tx) => {
      const latestAny = await tx.artifactVersion.findFirst({
        where: { projectId: project.id, artifactType: "engineering_requirements" },
        orderBy: { versionNumber: "desc" }
      });
      const artifact = await tx.artifactVersion.create({
        data: {
          projectId: project.id,
          artifactType: "engineering_requirements",
          versionNumber: (latestAny?.versionNumber ?? 0) + 1,
          parentVersionId: latestAny?.id ?? null,
          status: "draft",
          sourceRefsJson: evidenceCards.map((card) => card.citationRef) as object,
          payloadJson: payload as object,
          changeSummary,
          createdBy: actorUserId,
          acceptedAt: null
        }
      });
      let diagramId: string | null = null;
      if (input.includeMermaid && input.saveFlowchart) {
        const diagram = await tx.projectDiagram.create({
          data: {
            orgId: project.orgId,
            projectId: project.id,
            title: "Main Coding Flowchart",
            description: "Derived from the current coding requirements artifact.",
            diagramType: "coding_flow",
            mermaidSource: payload.mermaid,
            source: "socrates_generated",
            status: "draft",
            linkedDocumentSectionIdsJson: [],
            linkedBrainNodeIdsJson: [],
            linkedContextEntryIdsJson: [],
            linkedArtifactVersionId: artifact.id,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId
          }
        });
        diagramId = diagram.id;
      }
      const coding = await tx.projectCodingRequirements.create({
        data: {
          orgId: project.orgId,
          projectId: project.id,
          artifactVersionId: artifact.id,
          mermaidDiagramId: diagramId,
          generatedByUserId: actorUserId
        },
        include: { artifactVersion: true, mermaidDiagram: true }
      });
      return coding;
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId: project.id,
      actorUserId,
      eventType: "coding_requirements_generated",
      entityType: "coding_requirements",
      entityId: result.id,
      payload: {
        codingRequirementsId: result.id,
        artifactVersionId: result.artifactVersionId,
        mermaidDiagramId: result.mermaidDiagramId,
        moduleCount: payload.modules.length,
        unknownCount: payload.unknowns.length,
        citationCount: payload.citations.length,
        openTargetCount: payload.openTargets.length,
        lowEvidence: payload.evidenceSummary.lowEvidence,
        reviewStatus: "draft",
        focus: input.focus,
        sourceRefCount: input.sourceRefs.length
      }
    });
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, project.id, "coding_requirements_draft_generated");
    return this.toDto(result, true);
  }

  private async loadCurrent(projectId: string) {
    return this.prisma.projectCodingRequirements.findFirst({
      where: { projectId, artifactVersion: { artifactType: "engineering_requirements", status: "accepted" } },
      include: { artifactVersion: true, mermaidDiagram: true },
      orderBy: { createdAt: "desc" }
    });
  }

  private toDto(row: CodingRequirementsRow, includePayload: boolean) {
    const payload = codingRequirementsPayloadSchema.parse(row.artifactVersion.payloadJson);
    return {
      id: row.id,
      projectId: row.projectId,
      artifactVersionId: row.artifactVersionId,
      artifactVersionNumber: row.artifactVersion.versionNumber,
      reviewStatus: row.artifactVersion.status,
      mermaidDiagramId: isActiveCodingFlowchart(row.mermaidDiagram) ? row.mermaidDiagramId : null,
      generatedByUserId: row.generatedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      moduleCount: payload.modules.length,
      unknownCount: payload.unknowns.length + payload.modules.reduce((count, module) => count + module.unknowns.length, 0),
      lowEvidence: payload.evidenceSummary.lowEvidence,
      flowchartAvailable: isActiveCodingFlowchart(row.mermaidDiagram),
      payload: includePayload ? payload : undefined
    };
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, orgId: true, name: true } });
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    return project;
  }

  private formatEvidenceForPrompt(cards: EvidenceCard[]) {
    return cards
      .slice(0, 30)
      .map((card, index) =>
        [
          `<untrusted_evidence_card index="${index + 1}">`,
          `Evidence ${index + 1}: ${card.sourceType} / ${card.title}`,
          `Citation: ${card.citationRef.type}:${card.citationRef.refId}`,
          card.openTarget ? `OpenTarget: ${JSON.stringify(card.openTarget)}` : null,
          `Why selected: ${card.whySelected}`,
          `Excerpt: ${card.excerpt}`,
          "</untrusted_evidence_card>"
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");
  }

  private emptyEngineeringSummary(projectId: string) {
    return {
      hasCodingRequirements: false,
      latestGeneratedAt: null,
      moduleCount: 0,
      unknownCount: 0,
      flowchartAvailable: false,
      quickLinks: {
        codingRequirementsPath: `/projects/${projectId}/coding-requirements`,
        flowchartPath: `/projects/${projectId}/coding-requirements/flowchart`
      }
    };
  }
}

function buildMermaid(moduleNames: string[]) {
  const names = moduleNames.length ? moduleNames.slice(0, 12) : ["Implementation discovery"];
  const lines = ["flowchart TD"];
  names.forEach((name, index) => {
    lines.push(`  m${index + 1}["${safeMermaidLabel(name)}"]`);
    if (index > 0) lines.push(`  m${index} --> m${index + 1}`);
  });
  return validateCodingFlowchart(lines.join("\n"));
}

function isActiveCodingFlowchart(
  diagram: CodingRequirementsRow["mermaidDiagram"]
): diagram is NonNullable<CodingRequirementsRow["mermaidDiagram"]> {
  return Boolean(diagram && diagram.status === "active" && diagram.diagramType === "coding_flow");
}

function normalizeTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120) || "Implementation module";
}

function excerpt(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
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

function createSignature(payload: CodingRequirementsPayload) {
  return `engineering_requirements:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}
