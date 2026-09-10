import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import type { GenerationProvider } from "../../lib/ai/provider.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";
import { AuditService } from "../audit/service.js";
import type { BrainService } from "../brain/service.js";
import { ProjectService } from "../projects/service.js";
import type { DocumentGenerationBody } from "./schemas.js";
import { DocumentService } from "./service.js";
import {
  buildFallbackGeneratedMarkdown,
  DOCUMENT_GENERATION_TEMPLATES,
  getDocumentGenerationTemplate,
  sanitizeGeneratedTitle,
  type DocumentGenerationKind,
  type DocumentGenerationTemplateId,
  validateGeneratedPrdSrsMarkdown
} from "./document-generation-templates.js";

const generatedDocumentSchema = z.object({
  title: z.string().trim().min(2).max(160),
  markdown: z.string().min(100).max(60_000),
  model: z.string().trim().max(120).optional()
});

type GenerationContextItem = {
  ref: string;
  label: string;
  text: string;
};

export class ProjectDocumentGenerationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly generationProvider: GenerationProvider,
    private readonly projectService: ProjectService,
    private readonly documentService: DocumentService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly brainService?: BrainService,
    private readonly telemetry?: TelemetryService
  ) {}

  listGenerationTemplates() {
    return DOCUMENT_GENERATION_TEMPLATES.map((template) => ({
      id: template.id,
      kind: template.kind,
      label: template.label,
      description: template.description,
      sections: [...template.sections, template.codingHintsSection]
    }));
  }

  async generateDocument(projectId: string, actorUserId: string, input: DocumentGenerationBody) {
    await this.projectService.ensureProjectMemberCanUploadContext(projectId, actorUserId);
    const template = getDocumentGenerationTemplate(input.template, input.kind);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true, description: true }
    });
    if (!project) {
      throw new AppError(404, "Project not found", "project_not_found");
    }

    const context = await this.resolveGenerationContext(projectId, input.contextIds);
    const fallbackTitle = input.title ?? `${template.kind === "prd" ? "Generated PRD" : "Generated SRS"} - ${project.name}`;
    const fallbackMarkdown = buildFallbackGeneratedMarkdown({
      kind: input.kind,
      templateId: input.template,
      title: fallbackTitle,
      prompt: input.prompt,
      includeCodingHints: input.includeCodingHints,
      contextSummary: context.map((item) => item.label)
    });

    const generated = await this.generationProvider.generateObject({
      task: "mvp_generated_prd_srs",
      schema: generatedDocumentSchema,
      systemPrompt: [
        "Return valid JSON only with title and markdown fields.",
        "Generate a basic markdown PRD or SRS from the supplied prompt and project evidence.",
        "Separate assumptions from facts. Put unknowns in Open Questions.",
        "Do not include HTML, script tags, Mermaid diagrams, or fake certainty."
      ].join(" "),
      prompt: this.buildGenerationPrompt(project, input, context),
      fallback: () => ({
        title: fallbackTitle,
        markdown: fallbackMarkdown,
        model: "deterministic_fallback"
      }),
      maxOutputTokens: 5000,
      timeoutMs: this.env.SOCRATES_GENERATION_TIMEOUT_MS
    });

    const title = sanitizeGeneratedTitle(input.title ?? generated.title ?? fallbackTitle, fallbackTitle);
    const markdown = this.validateGeneratedPrdSrs(input.kind, input.template, generated.markdown, input.includeCodingHints);
    const persisted = await this.persistGeneratedDocument(projectId, actorUserId, {
      kind: input.kind,
      title,
      markdown,
      makePrimaryLiveDoc: input.makePrimaryLiveDoc
    });
    const postGeneration = await this.queuePostGenerationWork(projectId, actorUserId, persisted, input.rebuildBrain);

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "generated_document_created",
      entityType: "document",
      entityId: persisted.documentId,
      payload: {
        projectId,
        documentId: persisted.documentId,
        documentVersionId: persisted.documentVersionId,
        kind: input.kind,
        template: input.template,
        title,
        promptHash: createHash("sha256").update(input.prompt).digest("hex"),
        promptLength: input.prompt.length,
        contextRefCount: input.contextIds.length,
        rebuildBrainQueued: postGeneration.brainRebuildQueued,
        model: generated.model ?? null,
        sourceLabel: "generated_by_socrates"
      }
    });

    this.telemetry?.increment("orchestra_generated_documents_total", {
      kind: input.kind,
      template: input.template
    });

    return {
      documentId: persisted.documentId,
      documentVersionId: persisted.documentVersionId,
      status: persisted.status === "ready" || persisted.status === "partial" ? "ready" as const : "queued" as const,
      liveDocSourceStatus: input.makePrimaryLiveDoc ? "set" as const : "set_if_missing" as const,
      title,
      kind: input.kind,
      next: {
        viewerUrl: `/v1/projects/${projectId}/documents/${persisted.documentId}/view`,
        rebuildBrainRecommended: !postGeneration.brainRebuildQueued,
        brainRebuildQueued: postGeneration.brainRebuildQueued
      }
    };
  }

  buildGenerationPrompt(
    project: { name: string; description: string | null },
    input: DocumentGenerationBody,
    context: GenerationContextItem[]
  ) {
    const template = getDocumentGenerationTemplate(input.template, input.kind);
    return [
      `Project: ${project.name}`,
      project.description ? `Project description: ${project.description}` : "Project description: not provided",
      `Document kind: ${input.kind}`,
      `Template: ${template.label}`,
      `Required sections: ${[...template.sections, input.includeCodingHints ? template.codingHintsSection : null].filter(Boolean).join(", ")}`,
      `Tone: ${input.tone}`,
      `Include coding hints: ${input.includeCodingHints ? "yes" : "no"}`,
      `User prompt:\n${input.prompt}`,
      context.length > 0
        ? `Project context:\n${context.map((item, index) => `${index + 1}. ${item.label}\n${item.text}`).join("\n\n")}`
        : "Project context: none supplied. Be explicit about assumptions and open questions.",
      "Output markdown only inside the JSON markdown field."
    ].join("\n\n");
  }

  validateGeneratedPrdSrs(
    kind: DocumentGenerationKind,
    template: DocumentGenerationTemplateId,
    markdown: string,
    includeCodingHints: boolean
  ) {
    return validateGeneratedPrdSrsMarkdown(kind, template, markdown, includeCodingHints);
  }

  async persistGeneratedDocument(
    projectId: string,
    actorUserId: string,
    generated: {
      kind: DocumentGenerationKind;
      title: string;
      markdown: string;
      makePrimaryLiveDoc?: boolean;
    }
  ) {
    return this.documentService.uploadFile({
      projectId,
      actorUserId,
      kind: generated.kind,
      title: generated.title,
      visibility: "internal",
      sourceLabel: "generated_by_socrates",
      makePrimaryLiveDoc: generated.makePrimaryLiveDoc,
      fileName: `${safeMarkdownFileName(generated.title)}.md`,
      contentType: "text/markdown",
      buffer: Buffer.from(generated.markdown, "utf8")
    });
  }

  async queuePostGenerationWork(
    projectId: string,
    actorUserId: string,
    _persisted: { documentId: string; documentVersionId: string; parseRevision?: number },
    rebuildBrain: boolean
  ) {
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "generated_document_created");
    let brainRebuildQueued = false;
    if (rebuildBrain && this.brainService) {
      await this.brainService.rebuild(projectId, actorUserId);
      brainRebuildQueued = true;
    }
    return { brainRebuildQueued };
  }

  async resolveGenerationContext(projectId: string, contextIds: string[]) {
    const items: GenerationContextItem[] = [];
    for (const ref of contextIds) {
      const parsed = parseContextRef(ref);
      if (!parsed) {
        throw new AppError(422, "contextIds must use document:<uuid>, responsibility:<uuid>, or context:<uuid>", "invalid_generation_context_ref", { ref });
      }
      if (parsed.type === "document") {
        items.push(await this.resolveDocumentContext(projectId, ref, parsed.id));
      } else if (parsed.type === "responsibility") {
        items.push(await this.resolveResponsibilityContext(projectId, ref, parsed.id));
      } else {
        items.push(await this.resolveManualContext(projectId, ref, parsed.id));
      }
    }
    return items;
  }

  private async resolveDocumentContext(projectId: string, ref: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, projectId },
      select: { id: true, title: true, kind: true, currentVersionId: true }
    });
    if (!document) {
      throw new AppError(422, "Document context ref was not found in this project", "invalid_generation_context_ref", { ref });
    }
    const sections = document.currentVersionId
      ? await this.prisma.documentSection.findMany({
          where: { projectId, documentVersionId: document.currentVersionId },
          orderBy: { orderIndex: "asc" },
          take: 6
        })
      : [];
    return {
      ref,
      label: `Document: ${document.title} (${document.kind})`,
      text: sections.length > 0
        ? sections.map((section) => `${section.headingPath.join(" > ")}: ${section.normalizedText.slice(0, 800)}`).join("\n")
        : "Document exists but has no parsed sections yet."
    };
  }

  private async resolveResponsibilityContext(projectId: string, ref: string, responsibilityId: string) {
    const responsibility = await this.prisma.projectResponsibility.findFirst({
      where: { id: responsibilityId, projectId }
    });
    if (!responsibility) {
      throw new AppError(422, "Responsibility context ref was not found in this project", "invalid_generation_context_ref", { ref });
    }
    return {
      ref,
      label: `Responsibility: ${responsibility.title}`,
      text: [
        `Area: ${responsibility.area}`,
        `Status: ${responsibility.status}`,
        responsibility.assigneeName ? `Assignee: ${responsibility.assigneeName}` : null,
        responsibility.description ? `Description: ${responsibility.description}` : null
      ].filter(Boolean).join("\n")
    };
  }

  private async resolveManualContext(projectId: string, ref: string, contextId: string) {
    const context = await this.prisma.projectContextEntry.findFirst({
      where: { id: contextId, projectId, status: "active" },
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        participantsJson: true,
        tagsJson: true,
        sourceDate: true,
        importance: true
      }
    });
    if (!context) {
      throw new AppError(422, "Manual context ref was not found as active context in this project", "invalid_generation_context_ref", { ref });
    }
    const participants = Array.isArray(context.participantsJson)
      ? context.participantsJson.filter((value): value is string => typeof value === "string")
      : [];
    const tags = Array.isArray(context.tagsJson)
      ? context.tagsJson.filter((value): value is string => typeof value === "string")
      : [];
    return {
      ref,
      label: `Manual context: ${context.title} (${context.type})`,
      text: [
        participants.length ? `Participants: ${participants.join(", ")}` : null,
        tags.length ? `Tags: ${tags.join(", ")}` : null,
        context.sourceDate ? `Source date: ${context.sourceDate.toISOString()}` : null,
        `Importance: ${context.importance}`,
        context.body.slice(0, 1600)
      ].filter(Boolean).join("\n")
    };
  }
}

function parseContextRef(ref: string) {
  const match = /^(document|responsibility|context):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref);
  if (!match) return null;
  return {
    type: match[1] as "document" | "responsibility" | "context",
    id: match[2]
  };
}

function safeMarkdownFileName(title: string) {
  const safe = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return safe || "generated-document";
}
