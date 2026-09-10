import type { EvidenceCard } from "../../lib/retrieval/evidence-pack.js";
import { liveDocArtifactSchema } from "../live-doc/schemas.js";
import { citationSchema, openTargetRefSchema, type CitationSchema, type OpenTargetRef } from "./schemas.js";
import type { RetrievalIntent } from "../../lib/retrieval/types.js";

export type ValidationDropReason =
  | "invalid_shape"
  | "not_in_final_evidence"
  | "client_forbidden"
  | "missing_or_deleted"
  | "stale_or_not_current"
  | "not_accepted_truth"
  | "not_backed_by_citation"
  | "invalid_dashboard_filter";

export interface ValidationDrop {
  refId?: string;
  targetType?: string;
  reason: ValidationDropReason;
}

export interface CitationValidationInput {
  citations: unknown[];
  evidenceCards: EvidenceCard[];
  projectId: string;
  isClientContext: boolean;
  intent: RetrievalIntent;
}

export interface CitationValidationResult {
  valid: CitationSchema[];
  dropped: ValidationDrop[];
}

export interface OpenTargetValidationInput {
  targets: unknown[];
  citations: CitationSchema[];
  evidenceCards: EvidenceCard[];
  projectId: string;
  isClientContext: boolean;
}

export interface OpenTargetValidationResult {
  valid: OpenTargetRef[];
  dropped: ValidationDrop[];
}

const CLIENT_FORBIDDEN_CITATION_TYPES = new Set<CitationSchema["type"]>([
  "live_doc_section",
  "message",
  "product_brain",
  "change_proposal",
  "decision_record",
  "dashboard_snapshot",
  "project_responsibility",
  "project_context",
  "project_diagram",
  "coding_requirements",
  "agent_run",
  "agent_quality_review",
  "agent_markdown_file",
  "agent_markdown_file_version",
  "agent_markdown_quality_report",
  "agent_markdown_drift_report",
  "agent_markdown_sync_run",
]);

const CLIENT_FORBIDDEN_TARGET_TYPES = new Set<OpenTargetRef["targetType"]>([
  "live_doc_section",
  "message",
  "thread",
  "change_proposal",
  "decision_record",
  "dashboard_filter",
  "project_responsibility",
  "project_context",
  "project_diagram",
  "coding_requirements",
  "project_event",
  "agent_run",
  "agent_quality_review",
  "agent_markdown_file",
  "agent_markdown_file_version",
  "agent_markdown_quality_report",
  "agent_markdown_drift_report",
  "agent_markdown_sync_run",
]);

const DASHBOARD_FILTERS = new Set(["snapshot", "status", "review_pressure", "brain_freshness", "project"]);

function evidenceKey(type: string, id: string) {
  return `${type}:${id}`;
}

function evidenceMap(cards: EvidenceCard[]) {
  const map = new Map<string, EvidenceCard>();
  for (const card of cards) {
    if (!card.citationRef?.id) continue;
    map.set(evidenceKey(card.citationRef.type, card.citationRef.id), card);
  }
  return map;
}

function backendLabel(card: EvidenceCard, fallback: string) {
  return (card.citationRef?.label ?? card.title ?? fallback).slice(0, 200);
}

function isCurrentParsedDocumentVersion(version: any) {
  return (
    version &&
    (version.status === "ready" || version.status === "partial") &&
    version.document?.currentVersionId === version.id
  );
}

function isCurrentParsedSection(section: any) {
  return (
    section &&
    section.parseRevision === section.documentVersion?.parseRevision &&
    isCurrentParsedDocumentVersion(section.documentVersion)
  );
}

function isCurrentParsedChunk(chunk: any) {
  return (
    chunk &&
    chunk.parseRevision === chunk.documentVersion?.parseRevision &&
    isCurrentParsedDocumentVersion(chunk.documentVersion)
  );
}

async function isCurrentBrainNode(prisma: any, projectId: string, node: any) {
  if (!node?.artifactVersionId) return false;
  const graphArtifact = await prisma.artifactVersion.findFirst({
    where: { projectId, artifactType: "brain_graph", status: "accepted" },
    orderBy: { versionNumber: "desc" },
  });
  return graphArtifact?.id === node.artifactVersionId;
}

export class CitationValidationService {
  constructor(private readonly prisma: any) {}

  async validate(input: CitationValidationInput): Promise<CitationValidationResult> {
    const valid: CitationSchema[] = [];
    const dropped: ValidationDrop[] = [];
    const evidence = evidenceMap(input.evidenceCards);

    for (const raw of input.citations) {
      const parsed = citationSchema.safeParse(raw);
      if (!parsed.success) {
        dropped.push({ reason: "invalid_shape" });
        continue;
      }
      const citation = parsed.data;
      const card = evidence.get(evidenceKey(citation.type, citation.refId));
      if (!card) {
        dropped.push({ refId: citation.refId, reason: "not_in_final_evidence" });
        continue;
      }
      if (input.isClientContext && CLIENT_FORBIDDEN_CITATION_TYPES.has(citation.type)) {
        dropped.push({ refId: citation.refId, reason: "client_forbidden" });
        continue;
      }
      const existence = await this.validateExistence(citation, input.projectId, input.isClientContext, input.intent);
      if (!existence.valid) {
        dropped.push({ refId: citation.refId, reason: existence.reason });
        continue;
      }
      valid.push({
        ...citation,
        label: backendLabel(card, citation.label),
        confidence: citation.confidence ?? Math.max(0, Math.min(1, card.confidence)),
      });
    }

    return { valid, dropped };
  }

  private async validateExistence(
    citation: CitationSchema,
    projectId: string,
    isClientContext: boolean,
    intent: RetrievalIntent
  ): Promise<{ valid: true } | { valid: false; reason: ValidationDropReason }> {
    switch (citation.type) {
      case "live_doc_section": {
        const artifact = await this.prisma.artifactVersion.findFirst({
          where: { projectId, artifactType: "live_doc", status: "accepted" },
          orderBy: { versionNumber: "desc" },
        });
        if (!artifact) return { valid: false, reason: "missing_or_deleted" };
        const payload = liveDocArtifactSchema.parse(artifact.payloadJson);
        return payload.sections.some((section) => section.sectionKey === citation.refId)
          ? { valid: true }
          : { valid: false, reason: "missing_or_deleted" };
      }
      case "document_section": {
        const section = await this.prisma.documentSection.findFirst({
          where: { id: citation.refId, projectId },
          include: { documentVersion: { include: { document: true } } },
        });
        if (!section) return { valid: false, reason: "missing_or_deleted" };
        if (!isCurrentParsedSection(section)) {
          return { valid: false, reason: "stale_or_not_current" };
        }
        if (isClientContext && section.documentVersion.document.visibility !== "shared_with_client") {
          return { valid: false, reason: "client_forbidden" };
        }
        return { valid: true };
      }
      case "document_chunk": {
        const chunk = await this.prisma.documentChunk.findFirst({
          where: { id: citation.refId, projectId },
          include: { documentVersion: { include: { document: true } } },
        });
        if (!chunk) return { valid: false, reason: "missing_or_deleted" };
        if (!isCurrentParsedChunk(chunk)) {
          return { valid: false, reason: "stale_or_not_current" };
        }
        if (isClientContext && chunk.documentVersion.document.visibility !== "shared_with_client") {
          return { valid: false, reason: "client_forbidden" };
        }
        return { valid: true };
      }
      case "google_drive_document": {
        const chunk = await this.prisma.documentChunk.findFirst({
          where: { id: citation.refId, projectId },
          include: { documentVersion: { include: { document: true } } },
        });
        if (!chunk) return { valid: false, reason: "missing_or_deleted" };
        if (!isCurrentParsedChunk(chunk)) {
          return { valid: false, reason: "stale_or_not_current" };
        }
        const driveFile = await this.prisma.projectDriveFile.findFirst({
          where: { projectId, OR: [{ documentVersionId: chunk.documentVersionId }, { documentId: chunk.documentVersion.documentId }] }
        });
        if (!driveFile) return { valid: false, reason: "missing_or_deleted" };
        if (!(await isDriveFileAllowedBySelectedRoots(this.prisma, projectId, driveFile))) {
          return { valid: false, reason: "missing_or_deleted" };
        }
        if (isClientContext && chunk.documentVersion.document.visibility !== "shared_with_client") {
          return { valid: false, reason: "client_forbidden" };
        }
        return { valid: true };
      }
      case "message": {
        const message = await this.prisma.communicationMessage.findFirst({
          where: { id: citation.refId, projectId, isDeletedByProvider: false },
        });
        return message ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "brain_node": {
        const node = await this.prisma.brainNode.findFirst({ where: { id: citation.refId, projectId } });
        if (!node) return { valid: false, reason: "missing_or_deleted" };
        if (!(await isCurrentBrainNode(this.prisma, projectId, node))) {
          return { valid: false, reason: "stale_or_not_current" };
        }
        if (!isClientContext) return { valid: true };
        const links = await this.prisma.brainSectionLink.findMany({
          where: { projectId, brainNodeId: node.id },
          include: { documentSection: { include: { documentVersion: { include: { document: true } } } } },
        });
        return links.length > 0 &&
          links.every((link: any) => link.documentSection.documentVersion.document.visibility === "shared_with_client")
          ? { valid: true }
          : { valid: false, reason: "client_forbidden" };
      }
      case "product_brain": {
        const artifact = await this.prisma.artifactVersion.findFirst({
          where: { id: citation.refId, projectId, artifactType: "product_brain", status: "accepted" },
        });
        return artifact ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "change_proposal": {
        const proposal = await this.prisma.specChangeProposal.findFirst({
          where: { id: citation.refId, projectId },
        });
        if (!proposal) return { valid: false, reason: "missing_or_deleted" };
        if (intent === "current_truth" && proposal.status !== "accepted") {
          return { valid: false, reason: "not_accepted_truth" };
        }
        return { valid: true };
      }
      case "decision_record": {
        const decision = await this.prisma.decisionRecord.findFirst({ where: { id: citation.refId, projectId } });
        if (!decision) return { valid: false, reason: "missing_or_deleted" };
        if (intent === "current_truth" && decision.status !== "accepted") {
          return { valid: false, reason: "not_accepted_truth" };
        }
        return { valid: true };
      }
      case "dashboard_snapshot": {
        const snapshot = await this.prisma.dashboardSnapshot.findFirst({
          where: {
            id: citation.refId,
            OR: [
              { projectId },
              { projectId: null, scope: "general", organization: { projects: { some: { id: projectId } } } },
            ],
          },
        });
        return snapshot ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "project_responsibility": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const responsibility = await this.prisma.projectResponsibility.findFirst({
          where: { id: citation.refId, projectId },
        });
        return responsibility ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "project_context": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const context = await this.prisma.projectContextEntry.findFirst({
          where: { id: citation.refId, projectId, status: "active" },
        });
        return context ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "project_diagram": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const diagram = await this.prisma.projectDiagram.findFirst({
          where: { id: citation.refId, projectId, status: "active" },
        });
        return diagram ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "coding_requirements": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const requirements = await this.prisma.projectCodingRequirements.findFirst({
          where: {
            id: citation.refId,
            projectId,
            artifactVersion: { artifactType: "engineering_requirements", status: "accepted" }
          },
        });
        return requirements ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_run": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const run = await this.prisma.agentRun.findFirst({
          where: { id: citation.refId, projectId, status: { not: "deleted" } },
        });
        return run ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_quality_review": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const review = await this.prisma.agentQualityReview.findFirst({
          where: { id: citation.refId, projectId, deletedAt: null, archivedAt: null },
        });
        return review ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_file": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const file = await this.prisma.agentMarkdownFile.findFirst({ where: { id: citation.refId, projectId, archivedAt: null } });
        return file ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_file_version": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const version = await this.prisma.agentMarkdownFileVersion.findFirst({ where: { id: citation.refId, projectId } });
        return version ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_quality_report": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const report = await (this.prisma as any).agentMarkdownFileQualityReport.findFirst({ where: { id: citation.refId, projectId } });
        return report ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_drift_report": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const report = await (this.prisma as any).agentMarkdownFileDriftReport.findFirst({ where: { id: citation.refId, projectId } });
        return report ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_sync_run": {
        if (isClientContext) return { valid: false, reason: "client_forbidden" };
        const syncRun = await this.prisma.agentMarkdownSyncRun.findFirst({ where: { id: citation.refId, projectId } });
        return syncRun ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
    }
  }
}

export class OpenTargetValidationService {
  constructor(private readonly prisma: any) {}

  async validate(input: OpenTargetValidationInput): Promise<OpenTargetValidationResult> {
    const valid: OpenTargetRef[] = [];
    const dropped: ValidationDrop[] = [];

    for (const raw of input.targets) {
      const parsed = openTargetRefSchema.safeParse(raw);
      if (!parsed.success) {
        dropped.push({ reason: "invalid_shape" });
        continue;
      }
      const target = parsed.data;
      if (input.isClientContext && CLIENT_FORBIDDEN_TARGET_TYPES.has(target.targetType)) {
        dropped.push({ targetType: target.targetType, reason: "client_forbidden" });
        continue;
      }
      const existence = await this.validateTarget(target, input);
      if (!existence.valid) {
        dropped.push({ targetType: target.targetType, reason: existence.reason });
        continue;
      }
      valid.push(target);
    }

    return { valid, dropped };
  }

  private hasCitation(input: OpenTargetValidationInput, type: CitationSchema["type"], refId?: string) {
    return input.citations.some((citation) => citation.type === type && (!refId || citation.refId === refId));
  }

  private async validateTarget(
    target: OpenTargetRef,
    input: OpenTargetValidationInput
  ): Promise<{ valid: true } | { valid: false; reason: ValidationDropReason }> {
    switch (target.targetType) {
      case "live_doc_section": {
        if (
          !this.hasCitation(input, "live_doc_section", target.targetRef.sectionKey) &&
          !(target.targetRef.diagramId && this.hasCitation(input, "project_diagram", target.targetRef.diagramId))
        ) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const artifact = await this.prisma.artifactVersion.findFirst({
          where: { projectId: input.projectId, artifactType: "live_doc", status: "accepted" },
          orderBy: { versionNumber: "desc" },
        });
        if (!artifact) return { valid: false, reason: "missing_or_deleted" };
        const payload = liveDocArtifactSchema.parse(artifact.payloadJson);
        const sectionExists = payload.sections.some((section) => section.sectionKey === target.targetRef.sectionKey);
        if (!sectionExists) return { valid: false, reason: "missing_or_deleted" };
        if (target.targetRef.diagramId) {
          const embed = await this.prisma.liveDocSectionDiagram.findFirst({
            where: {
              projectId: input.projectId,
              sectionKey: target.targetRef.sectionKey,
              diagramId: target.targetRef.diagramId,
              diagram: { status: "active" }
            }
          });
          return embed ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
        }
        return { valid: true };
      }
      case "document_section": {
        const sections = await this.prisma.documentSection.findMany({
          where: {
            projectId: input.projectId,
            anchorId: target.targetRef.anchorId,
            ...(target.targetRef.documentVersionId ? { documentVersionId: target.targetRef.documentVersionId } : {}),
            ...(target.targetRef.documentId ? { documentVersion: { documentId: target.targetRef.documentId } } : {}),
          },
          include: { documentVersion: { include: { document: true } } },
          orderBy: [{ parseRevision: "desc" }, { createdAt: "desc" }],
        });
        const section = sections.find(isCurrentParsedSection);
        if (!section) {
          return sections.length > 0
            ? { valid: false, reason: "stale_or_not_current" }
            : { valid: false, reason: "missing_or_deleted" };
        }
        if (input.isClientContext && section.documentVersion.document.visibility !== "shared_with_client") {
          return { valid: false, reason: "client_forbidden" };
        }
        if (this.hasCitation(input, "document_section", section.id)) return { valid: true };
        const citedChunkIds = input.citations
          .filter((citation) => citation.type === "document_chunk" || citation.type === "google_drive_document")
          .map((citation) => citation.refId);
        if (citedChunkIds.length === 0) return { valid: false, reason: "not_backed_by_citation" };
        const chunk = await this.prisma.documentChunk.findFirst({
          where: { id: { in: citedChunkIds }, projectId: input.projectId, sectionId: section.id },
        });
        return chunk ? { valid: true } : { valid: false, reason: "not_backed_by_citation" };
      }
      case "google_drive_file": {
        const file = await this.prisma.projectDriveFile.findFirst({
          where: { id: target.targetRef.driveFileId, projectId: input.projectId }
        });
        if (!file) return { valid: false, reason: "missing_or_deleted" };
        if (!(await isDriveFileAllowedBySelectedRoots(this.prisma, input.projectId, file))) {
          return { valid: false, reason: "missing_or_deleted" };
        }
        const hasDriveCitation = input.citations.some((citation) => citation.type === "google_drive_document");
        return hasDriveCitation ? { valid: true } : { valid: false, reason: "not_backed_by_citation" };
      }
      case "message": {
        if (!this.hasCitation(input, "message", target.targetRef.messageId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const message = await this.prisma.communicationMessage.findFirst({
          where: { id: target.targetRef.messageId, projectId: input.projectId, isDeletedByProvider: false },
        });
        if (!message) return { valid: false, reason: "missing_or_deleted" };
        if (target.targetRef.highlightChunkId) {
          const chunk = await this.prisma.communicationMessageChunk.findFirst({
            where: {
              id: target.targetRef.highlightChunkId,
              messageId: message.id,
              projectId: input.projectId,
            },
          });
          return chunk ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
        }
        return { valid: true };
      }
      case "thread": {
        const messageCitationIds = input.citations
          .filter((citation) => citation.type === "message")
          .map((citation) => citation.refId);
        if (messageCitationIds.length === 0) return { valid: false, reason: "not_backed_by_citation" };
        const thread = await this.prisma.communicationThread.findFirst({
          where: { id: target.targetRef.threadId, projectId: input.projectId },
        });
        if (!thread) return { valid: false, reason: "missing_or_deleted" };
        const message = await this.prisma.communicationMessage.findFirst({
          where: {
            id: { in: messageCitationIds },
            threadId: thread.id,
            projectId: input.projectId,
            isDeletedByProvider: false,
          },
        });
        return message ? { valid: true } : { valid: false, reason: "not_backed_by_citation" };
      }
      case "brain_node": {
        if (!this.hasCitation(input, "brain_node", target.targetRef.nodeId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const node = await this.prisma.brainNode.findFirst({ where: { id: target.targetRef.nodeId, projectId: input.projectId } });
        if (!node) return { valid: false, reason: "missing_or_deleted" };
        return (await isCurrentBrainNode(this.prisma, input.projectId, node))
          ? { valid: true }
          : { valid: false, reason: "stale_or_not_current" };
      }
      case "change_proposal": {
        if (!this.hasCitation(input, "change_proposal", target.targetRef.proposalId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const proposal = await this.prisma.specChangeProposal.findFirst({
          where: { id: target.targetRef.proposalId, projectId: input.projectId },
        });
        return proposal ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "decision_record": {
        if (!this.hasCitation(input, "decision_record", target.targetRef.decisionId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const decision = await this.prisma.decisionRecord.findFirst({
          where: { id: target.targetRef.decisionId, projectId: input.projectId },
        });
        return decision ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "dashboard_filter": {
        if (!DASHBOARD_FILTERS.has(target.targetRef.filter)) {
          return { valid: false, reason: "invalid_dashboard_filter" };
        }
        return this.hasCitation(input, "dashboard_snapshot")
          ? { valid: true }
          : { valid: false, reason: "not_backed_by_citation" };
      }
      case "project_responsibility": {
        if (!this.hasCitation(input, "project_responsibility", target.targetRef.responsibilityId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const responsibility = await this.prisma.projectResponsibility.findFirst({
          where: {
            id: target.targetRef.responsibilityId,
            projectId: input.projectId
          }
        });
        return responsibility ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "project_context": {
        if (!this.hasCitation(input, "project_context", target.targetRef.contextId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const context = await this.prisma.projectContextEntry.findFirst({
          where: {
            id: target.targetRef.contextId,
            projectId: input.projectId,
            status: "active"
          }
        });
        if (!context) return { valid: false, reason: "missing_or_deleted" };
        if (target.targetRef.contextChunkId) {
          const chunk = await this.prisma.projectContextChunk.findFirst({
            where: {
              id: target.targetRef.contextChunkId,
              contextEntryId: context.id,
              projectId: input.projectId
            }
          });
          if (!chunk) return { valid: false, reason: "missing_or_deleted" };
        }
        if (target.targetRef.attachmentId) {
          const attachment = await this.prisma.projectContextAttachment.findFirst({
            where: {
              id: target.targetRef.attachmentId,
              contextEntryId: context.id,
              projectId: input.projectId
            }
          });
          if (!attachment) return { valid: false, reason: "missing_or_deleted" };
        }
        return { valid: true };
      }
      case "project_diagram": {
        if (!this.hasCitation(input, "project_diagram", target.targetRef.diagramId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const diagram = await this.prisma.projectDiagram.findFirst({
          where: {
            id: target.targetRef.diagramId,
            projectId: input.projectId,
            status: "active"
          }
        });
        return diagram ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "coding_requirements": {
        if (!this.hasCitation(input, "coding_requirements", target.targetRef.codingRequirementsId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const requirements = await this.prisma.projectCodingRequirements.findFirst({
          where: {
            id: target.targetRef.codingRequirementsId,
            projectId: input.projectId,
            artifactVersionId: target.targetRef.artifactVersionId,
            artifactVersion: { artifactType: "engineering_requirements", status: "accepted" }
          }
        });
        return requirements ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "project_event": {
        const event = await this.prisma.projectEvent.findFirst({
          where: {
            id: target.targetRef.eventId,
            projectId: input.projectId
          }
        });
        return event && this.hasCitation(input, "dashboard_snapshot")
          ? { valid: true }
          : { valid: false, reason: event ? "not_backed_by_citation" : "missing_or_deleted" };
      }
      case "agent_run": {
        if (!this.hasCitation(input, "agent_run", target.targetRef.agentRunId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const run = await this.prisma.agentRun.findFirst({
          where: { id: target.targetRef.agentRunId, projectId: input.projectId, status: { not: "deleted" } },
        });
        return run ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_quality_review": {
        if (!this.hasCitation(input, "agent_quality_review", target.targetRef.reviewId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const review = await this.prisma.agentQualityReview.findFirst({
          where: { id: target.targetRef.reviewId, projectId: input.projectId, deletedAt: null, archivedAt: null },
        });
        return review ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_file": {
        if (!this.hasCitation(input, "agent_markdown_file", target.targetRef.fileId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const file = await this.prisma.agentMarkdownFile.findFirst({
          where: { id: target.targetRef.fileId, fileSetId: target.targetRef.fileSetId, projectId: input.projectId, archivedAt: null },
        });
        return file ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_file_version": {
        if (!this.hasCitation(input, "agent_markdown_file_version", target.targetRef.versionId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const version = await this.prisma.agentMarkdownFileVersion.findFirst({
          where: { id: target.targetRef.versionId, fileId: target.targetRef.fileId, fileSetId: target.targetRef.fileSetId, projectId: input.projectId },
        });
        return version ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_quality_report": {
        if (!this.hasCitation(input, "agent_markdown_quality_report", target.targetRef.reportId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const report = await (this.prisma as any).agentMarkdownFileQualityReport.findFirst({
          where: { id: target.targetRef.reportId, fileSetId: target.targetRef.fileSetId, projectId: input.projectId },
        });
        return report ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_drift_report": {
        if (!this.hasCitation(input, "agent_markdown_drift_report", target.targetRef.reportId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const report = await (this.prisma as any).agentMarkdownFileDriftReport.findFirst({
          where: { id: target.targetRef.reportId, fileSetId: target.targetRef.fileSetId, projectId: input.projectId },
        });
        return report ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
      case "agent_markdown_sync_run": {
        if (!this.hasCitation(input, "agent_markdown_sync_run", target.targetRef.syncRunId)) {
          return { valid: false, reason: "not_backed_by_citation" };
        }
        const syncRun = await this.prisma.agentMarkdownSyncRun.findFirst({
          where: { id: target.targetRef.syncRunId, fileSetId: target.targetRef.fileSetId, projectId: input.projectId },
        });
        return syncRun ? { valid: true } : { valid: false, reason: "missing_or_deleted" };
      }
    }
  }
}

async function isDriveFileAllowedBySelectedRoots(prisma: any, projectId: string, file: any) {
  if (!prisma.projectDriveSyncRoot?.findMany) return false;
  const roots = await prisma.projectDriveSyncRoot.findMany({
    where: {
      projectId,
      connectionId: file.connectionId,
      selected: true,
      rootType: { in: ["folder", "selected_file"] }
    },
    select: { id: true, rootType: true, googleFileId: true }
  });
  if (!roots.length) return false;
  const parents = readStringArray(file.parentsJson);
  const metadata = readRecord(file.metadataJson);
  const allowedRootIds = readStringArray(metadata["allowedRootIds"]);
  return roots.some((root: any) =>
    (root.rootType === "selected_file" && root.googleFileId === file.driveFileId) ||
    (root.rootType === "folder" && Boolean(root.googleFileId) && (parents.includes(root.googleFileId) || allowedRootIds.includes(root.id)))
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
