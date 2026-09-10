import type { PrismaClient } from "@prisma/client";
import type { RetrievalCandidate, RetrievalPlan } from "./types.js";
import { defaultClientShareConfig } from "../../modules/client-view/client-view.schemas.js";
import { projectBrainForClient } from "../../modules/client-view/client-view.projections.js";
import { lexicalScore } from "./lexical.js";
import { buildDocumentContextualRetrievalText } from "./contextualize.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export interface ProductBrainEvidenceMap {
  artifactVersionId: string;
  linkedSectionIds: string[];
  linkedMessageIds: string[];
  linkedChangeProposalIds: string[];
  decisionRecordIds: string[];
}

function collectRefs(value: unknown, refs: ProductBrainEvidenceMap) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return;
  }

  if (!isRecord(value)) return;

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.toLowerCase();
    if (key.includes("documentsectionid") || key === "sectionid" || key === "section_id") {
      refs.linkedSectionIds.push(...stringArray(Array.isArray(rawValue) ? rawValue : [rawValue]));
    } else if (key.includes("messageid") || key === "message_id") {
      refs.linkedMessageIds.push(...stringArray(Array.isArray(rawValue) ? rawValue : [rawValue]));
    } else if (key.includes("changeproposalid") || key === "proposalid" || key === "proposal_id") {
      refs.linkedChangeProposalIds.push(...stringArray(Array.isArray(rawValue) ? rawValue : [rawValue]));
    } else if (key.includes("decisionrecordid") || key === "decisionid" || key === "decision_id") {
      refs.decisionRecordIds.push(...stringArray(Array.isArray(rawValue) ? rawValue : [rawValue]));
    }
    collectRefs(rawValue, refs);
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function buildProductBrainEvidenceMapFromPayload(
  artifactVersionId: string,
  sourceRefsJson: unknown,
  payloadJson: unknown
): ProductBrainEvidenceMap {
  const refs: ProductBrainEvidenceMap = {
    artifactVersionId,
    linkedSectionIds: [],
    linkedMessageIds: [],
    linkedChangeProposalIds: [],
    decisionRecordIds: [],
  };

  collectRefs(sourceRefsJson, refs);
  collectRefs(payloadJson, refs);

  return {
    artifactVersionId,
    linkedSectionIds: dedupe(refs.linkedSectionIds),
    linkedMessageIds: dedupe(refs.linkedMessageIds),
    linkedChangeProposalIds: dedupe(refs.linkedChangeProposalIds),
    decisionRecordIds: dedupe(refs.decisionRecordIds),
  };
}

export async function buildProductBrainEvidenceMap(
  prisma: PrismaClient,
  projectId: string,
  artifactVersionId: string
): Promise<ProductBrainEvidenceMap | null> {
  const artifact = await prisma.artifactVersion.findFirst({
    where: { id: artifactVersionId, projectId, artifactType: "product_brain", status: "accepted" },
  });
  if (!artifact) return null;

  const refs = buildProductBrainEvidenceMapFromPayload(
    artifact.id,
    artifact.sourceRefsJson,
    artifact.payloadJson
  );

  if (refs.linkedChangeProposalIds.length > 0) {
    const links = await prisma.specChangeLink.findMany({
      where: {
        projectId,
        specChangeProposalId: { in: refs.linkedChangeProposalIds },
      },
    });
    for (const link of links) {
      if (link.linkType === "document_section") refs.linkedSectionIds.push(link.linkRefId);
      if (link.linkType === "message") refs.linkedMessageIds.push(link.linkRefId);
    }
  }

  return {
    artifactVersionId: refs.artifactVersionId,
    linkedSectionIds: dedupe(refs.linkedSectionIds),
    linkedMessageIds: dedupe(refs.linkedMessageIds),
    linkedChangeProposalIds: dedupe(refs.linkedChangeProposalIds),
    decisionRecordIds: dedupe(refs.decisionRecordIds),
  };
}

function summarizeProductBrainPayload(payloadJson: unknown): string {
  if (!isRecord(payloadJson)) return "";
  const parts = [
    payloadJson.whatTheProductIs,
    Array.isArray(payloadJson.mainFlows) ? payloadJson.mainFlows.join("; ") : "",
    Array.isArray(payloadJson.modules) ? payloadJson.modules.join("; ") : "",
    Array.isArray(payloadJson.constraints) ? payloadJson.constraints.join("; ") : "",
    Array.isArray(payloadJson.integrations) ? payloadJson.integrations.join("; ") : "",
    Array.isArray(payloadJson.openQuestions) ? payloadJson.openQuestions.join("; ") : "",
  ];
  return parts.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");
}

function summarizeClientSafeBrainPayload(artifact: {
  id: string;
  projectId: string;
  versionNumber: number;
  acceptedAt: Date | null;
  payloadJson: unknown;
}): string {
  const projected = projectBrainForClient(
    artifact,
    [],
    { ...defaultClientShareConfig, showAcceptedChangeSummaries: false, showAcceptedDecisionSummaries: false, showCommunicationEvidence: false }
  );
  const summary = projected.summary;
  return [
    summary.whatTheProductIs,
    summary.whoItIsFor,
    ...summary.mainFlows,
    ...summary.modules,
    ...summary.constraints,
    ...summary.integrations,
    ...summary.unresolvedAreas,
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

export async function loadProductBrainEvidence(
  prisma: PrismaClient,
  projectId: string,
  plan: RetrievalPlan,
  queryTokens: string[],
  acceptedTruthBoost: number
): Promise<RetrievalCandidate[]> {
  if (
    !plan.primaryDomains.includes("product_brain") &&
    !plan.supportingDomains.includes("product_brain") &&
    !plan.primaryDomains.includes("client_safe_brain")
  ) {
    return [];
  }

  if (plan.roleSafety.isClientSafe && !plan.primaryDomains.includes("client_safe_brain")) {
    return [];
  }

  const artifact = await prisma.artifactVersion.findFirst({
    where: { projectId, artifactType: "product_brain", status: "accepted" },
    orderBy: { versionNumber: "desc" },
  });
  if (!artifact) return [];

  const content = plan.roleSafety.isClientSafe
    ? summarizeClientSafeBrainPayload(artifact)
    : summarizeProductBrainPayload(artifact.payloadJson);
  if (!content) return [];

  const evidenceMap = buildProductBrainEvidenceMapFromPayload(
    artifact.id,
    artifact.sourceRefsJson,
    artifact.payloadJson
  );

  const query = queryTokens.join(" ");
  const lex = lexicalScore(query, content);
  const isClientSafe = plan.roleSafety.isClientSafe;

  return [
    {
      id: artifact.id,
      sourceType: "product_brain",
      domain: isClientSafe ? "client_safe_brain" : "product_brain",
      content,
      label: `Product Brain v${artifact.versionNumber}`,
      containerId: artifact.id,
      artifactVersionId: artifact.id,
      linkedSectionIds: evidenceMap.linkedSectionIds,
      linkedMessageIds: isClientSafe ? [] : evidenceMap.linkedMessageIds,
      linkedChangeProposalIds: isClientSafe ? [] : evidenceMap.linkedChangeProposalIds,
      decisionRecordIds: isClientSafe ? [] : evidenceMap.decisionRecordIds,
      sourcePrecedence: isClientSafe ? "client_safe_projection" : "accepted_truth",
      evidenceRole: isClientSafe ? "client_safe_projection" : "accepted_truth",
      evidenceCompleteness:
        evidenceMap.linkedSectionIds.length +
          evidenceMap.linkedMessageIds.length +
          evidenceMap.linkedChangeProposalIds.length +
          evidenceMap.decisionRecordIds.length >
        0
          ? "partial"
          : "missing",
      lexicalScore: lex,
      citationRef: isClientSafe ? undefined : { type: "product_brain", id: artifact.id, label: `Product Brain v${artifact.versionNumber}` },
      citationAvailabilityScore: isClientSafe ? 0 : 0.8,
      retrievalStage: "structured",
      whySelected: isClientSafe ? "client-safe Product Brain projection" : "latest accepted Product Brain artifact",
      finalScore: (0.8 + lex) * acceptedTruthBoost,
      isClientSafe,
      isInternalOnly: !isClientSafe,
    },
  ];
}

export async function loadLinkedEvidenceForCandidates(
  prisma: PrismaClient,
  projectId: string,
  candidates: RetrievalCandidate[],
  plan: RetrievalPlan,
  queryTokens: string[]
): Promise<RetrievalCandidate[]> {
  const query = queryTokens.join(" ");
  const sectionIds = new Set<string>();
  const messageIds = new Set<string>();
  const proposalIds = new Set<string>();
  const decisionIds = new Set<string>();

  for (const candidate of candidates) {
    for (const id of candidate.linkedSectionIds ?? []) sectionIds.add(id);
    if (!plan.roleSafety.isClientSafe) {
      for (const id of candidate.linkedMessageIds ?? []) messageIds.add(id);
      for (const id of candidate.linkedChangeProposalIds ?? []) proposalIds.add(id);
      for (const id of candidate.decisionRecordIds ?? []) decisionIds.add(id);
    }
  }

  const linked: RetrievalCandidate[] = [];

  if (sectionIds.size > 0 && !plan.forbiddenDomains.includes("document_sections")) {
    const sections = await prisma.documentSection.findMany({
      where: { projectId, id: { in: Array.from(sectionIds) } },
      include: { documentVersion: { include: { document: true } } },
      take: 12,
    });
    for (const section of sections) {
      const content = section.anchorText || section.normalizedText || section.anchorId;
      const lex = lexicalScore(query, content);
      linked.push({
        id: section.id,
        sourceType: "document_chunk",
        domain: plan.roleSafety.isClientSafe ? "client_safe_documents" : "document_sections",
        content,
        contextualContent: buildDocumentContextualRetrievalText({
          content,
          documentTitle: section.documentVersion.document.title,
          kind: section.documentVersion.document.kind,
          headingPath: section.headingPath,
          pageNumber: section.pageNumber,
          documentVersionId: section.documentVersionId,
          sourceType: "document_section",
          anchorId: section.anchorId
        }),
        label: section.documentVersion.document.title,
        documentSectionId: section.id,
        anchorId: section.anchorId,
        containerId: section.documentVersionId,
        artifactVersionId: candidates[0]?.artifactVersionId,
        linkedSectionIds: [section.id],
        sourcePrecedence: "source_evidence",
        evidenceRole: "linked_evidence",
        openTarget: {
          targetType: "document_section",
          targetRef: {
            documentVersionId: section.documentVersionId,
            anchorId: section.anchorId,
            ...(section.pageNumber ? { pageNumber: section.pageNumber } : {}),
          },
        },
        isLinkedEvidence: true,
        citationRef: { type: "document_section", id: section.id, label: section.documentVersion.document.title },
        citationAvailabilityScore: 1,
        retrievalStage: "linked",
        whySelected: "linked source section from Product Brain evidence map",
        lexicalScore: lex,
        finalScore: 0.55 + lex,
        isClientSafe: section.documentVersion.document.visibility === "shared_with_client",
        isInternalOnly: section.documentVersion.document.visibility !== "shared_with_client",
      });
    }
  }

  if (messageIds.size > 0 && plan.roleSafety.allowInternalMessages) {
    const messages = await prisma.communicationMessage.findMany({
      where: { projectId, id: { in: Array.from(messageIds) }, isDeletedByProvider: false },
      include: { thread: true },
      take: 12,
    });
    for (const message of messages) {
      const lex = lexicalScore(query, message.bodyText);
      linked.push({
        id: message.id,
        sourceType: "communication_message",
        domain: "communication_messages",
        content: message.bodyText,
        label: `${message.senderLabel} (${message.thread.subject ?? "thread"})`,
        containerId: message.threadId,
        messageId: message.id,
        threadId: message.threadId,
        artifactVersionId: candidates[0]?.artifactVersionId,
        sourcePrecedence: "communication_evidence",
        evidenceRole: "linked_evidence",
        openTarget: {
          targetType: "message",
          targetRef: { messageId: message.id, threadId: message.threadId },
        },
        isLinkedEvidence: true,
        citationRef: { type: "message", id: message.id, label: `${message.senderLabel} (${message.thread.subject ?? "thread"})` },
        citationAvailabilityScore: 1,
        retrievalStage: "linked",
        whySelected: "linked source message from Product Brain evidence map",
        lexicalScore: lex,
        finalScore: 0.5 + lex,
        isClientSafe: false,
        isInternalOnly: true,
      });
    }
  }

  if (proposalIds.size > 0 && plan.roleSafety.allowInternalChanges) {
    const proposals = await prisma.specChangeProposal.findMany({
      where: { projectId, id: { in: Array.from(proposalIds) }, status: "accepted" },
      take: 8,
    });
    for (const proposal of proposals) {
      const content = `${proposal.title}: ${proposal.summary}`;
      const lex = lexicalScore(query, content);
      linked.push({
        id: proposal.id,
        sourceType: "change_proposal",
        domain: "accepted_changes",
        content,
        label: proposal.title,
        changeProposalId: proposal.id,
        sourcePrecedence: "accepted_changes",
        evidenceRole: "linked_evidence",
        openTarget: {
          targetType: "change_proposal",
          targetRef: { proposalId: proposal.id },
        },
        isLinkedEvidence: true,
        citationRef: { type: "change_proposal", id: proposal.id, label: proposal.title },
        citationAvailabilityScore: 1,
        retrievalStage: "linked",
        whySelected: "linked accepted change from Product Brain evidence map",
        lexicalScore: lex,
        finalScore: 0.6 + lex,
        isClientSafe: false,
        isInternalOnly: true,
      });
    }
  }

  if (decisionIds.size > 0 && plan.roleSafety.allowInternalDecisions) {
    const decisions = await prisma.decisionRecord.findMany({
      where: { projectId, id: { in: Array.from(decisionIds) }, status: "accepted" },
      take: 8,
    });
    for (const decision of decisions) {
      const content = `Decision: ${decision.title} — ${decision.statement}`;
      const lex = lexicalScore(query, content);
      linked.push({
        id: decision.id,
        sourceType: "decision_record",
        domain: "decisions",
        content,
        label: decision.title,
        decisionRecordId: decision.id,
        sourcePrecedence: "accepted_decisions",
        evidenceRole: "linked_evidence",
        openTarget: {
          targetType: "decision_record",
          targetRef: { decisionId: decision.id },
        },
        isLinkedEvidence: true,
        citationRef: { type: "decision_record", id: decision.id, label: decision.title },
        citationAvailabilityScore: 1,
        retrievalStage: "linked",
        whySelected: "linked accepted decision from Product Brain evidence map",
        lexicalScore: lex,
        finalScore: 0.6 + lex,
        isClientSafe: false,
        isInternalOnly: true,
      });
    }
  }

  return linked.filter((candidate) => !plan.roleSafety.isClientSafe || !candidate.isInternalOnly);
}
