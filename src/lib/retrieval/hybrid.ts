/**
 * CHR-RAG Layers 2 & 3: Hybrid retrieval (vector + lexical) and hierarchical
 * evidence expansion.
 *
 * Performs:
 *  1. Embedding-based vector search against document_chunks and (optionally)
 *     communication message_chunks stored in pgvector.
 *  2. Lexical keyword search against the lexical_content text field.
 *  3. Direct lookup of brain nodes, change proposals, decisions, dashboard
 *     snapshots when the intent or context makes them relevant.
 *  4. Score fusion using a configurable weighted combination.
 *  5. Hierarchical expansion: neighbouring chunks in the same section, and
 *     brain nodes linked to the selected section/node.
 */

import type { PrismaClient } from "@prisma/client";
import type { EmbeddingProvider } from "../ai/provider.js";
import { stableBodyHash } from "../communications/idempotency.js";
import { chunkText } from "./chunking.js";
import { loadLinkedEvidenceForCandidates, loadProductBrainEvidence } from "./brain-evidence.js";
import { expandBrainGraph } from "./graph-expansion.js";
import type { RetrievalCandidate, RetrievalDomains, RetrievalPlan } from "./types.js";
import type { QueryIntent } from "./intent.js";
import { AppError } from "../../app/errors.js";
import { liveDocArtifactSchema } from "../../modules/live-doc/schemas.js";
import { codingRequirementsPayloadSchema } from "../../modules/coding-requirements/schemas.js";
import { lexicalScore, tokenizeQuery } from "./lexical.js";
import { vectorDistanceToSimilarity, weightedHybridScore } from "./vector.js";
import {
  buildDocumentContextualRetrievalText,
  buildMessageContextualRetrievalText,
  buildMessageLexicalRetrievalText
} from "./contextualize.js";

export interface HybridRetrievalInput {
  projectId: string;
  pageContext?: string;
  query: string;
  queryEmbedding: number[];
  intent: QueryIntent;
  domains: RetrievalDomains;
  /**
   * Page-aware context boosts a selected anchor / node to the top.
   */
  selectedSectionId?: string;
  selectedNodeId?: string;
  selectedRefId?: string;
  /**
   * IDs of sections nearby in the same document (same heading path).
   */
  neighborSectionIds?: string[];
  topK: number;
  minScore: number;
  isClientContext: boolean;
  /**
   * Apply a multiplicative boost to accepted-truth sources.
   * Typically 1.2 from env.RETRIEVAL_ACCEPTED_TRUTH_BOOST.
   */
  acceptedTruthBoost: number;
  docWeight: number;
  commWeight: number;
  plan?: RetrievalPlan;
}

export interface HybridRetrievalTelemetry {
  rawCandidateCount: number;
  denseCandidateCount: number;
  lexicalCandidateCount: number;
  brainCandidateCount: number;
  graphCandidateCount: number;
  graphTraversalCandidateCount: number;
  linkedEvidenceCandidateCount: number;
  mergedCandidateCount: number;
  droppedForbiddenDomainCount: number;
  droppedForClientSafetyCount: number;
  retrievalBranchFailureCount: number;
}

export interface HybridRetrievalResult {
  candidates: RetrievalCandidate[];
  telemetry: HybridRetrievalTelemetry;
}

// ---------------------------------------------------------------------------
// Document chunk retrieval
// ---------------------------------------------------------------------------
async function retrieveDocumentChunks(
  prisma: PrismaClient,
  projectId: string,
  queryEmbedding: number[],
  query: string,
  topK: number,
  isClientContext: boolean,
  docWeight: number
): Promise<RetrievalCandidate[]> {
  // Fetch candidate chunks using raw pgvector cosine distance.
  // We also select the cosine distance so we can compute a real vector similarity score.
  const visibilityFilter = isClientContext ? "AND d.visibility = 'shared_with_client'" : "";

  const chunks = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      section_id: string | null;
      content: string;
      contextual_content: string | null;
      lexical_content: string;
      page_number: number | null;
      document_version_id: string;
      document_id: string;
      metadata_json: unknown;
      visibility: string;
      doc_title: string;
      drive_file_id: string | null;
      drive_file_name: string | null;
      drive_web_view_link: string | null;
      anchor_id: string | null;
      vec_dist: number | null;
    }>
  >(
    `
    SELECT
      dc.id,
      dc.section_id,
      dc.content,
      dc.contextual_content,
      dc.lexical_content,
      dc.page_number,
      dc.document_version_id,
      d.id AS document_id,
      dc.metadata_json,
      d.visibility,
      d.title AS doc_title,
      pdf.id AS drive_file_id,
      pdf.name AS drive_file_name,
      pdf.web_view_link AS drive_web_view_link,
      ds.anchor_id,
      (dc.embedding OPERATOR(extensions.<=>) $2::extensions.vector) AS vec_dist
    FROM document_chunks dc
    JOIN document_versions dv ON dv.id = dc.document_version_id
    JOIN documents d ON d.id = dv.document_id
    LEFT JOIN project_drive_files pdf
      ON pdf.project_id = d.project_id
     AND (pdf.document_id = d.id OR pdf.document_version_id = dv.id)
    LEFT JOIN document_sections ds
      ON ds.id = dc.section_id
     AND ds.parse_revision = dv.parse_revision
    WHERE dc.project_id = $1::uuid
      AND d.archived_at IS NULL
      AND d.current_version_id = dv.id
      AND dv.status IN ('ready', 'partial')
      AND dc.parse_revision = dv.parse_revision
      AND dc.embedding IS NOT NULL
      ${visibilityFilter}
    ORDER BY dc.embedding OPERATOR(extensions.<=>) $2::extensions.vector
    LIMIT $3
  `,
    projectId,
    `[${queryEmbedding.join(",")}]`,
    topK * 2
  );

  return chunks.map((chunk) => {
    const lexicalContent = [chunk.lexical_content, chunk.contextual_content ?? ""].join(" ");
    const lex = lexicalScore(query, lexicalContent);
    const vecSim = vectorDistanceToSimilarity(chunk.vec_dist, 0.5);
    const combined = weightedHybridScore({ vectorScore: vecSim, lexicalScore: lex }) * docWeight;
    const label = chunk.drive_file_id ? `Google Drive · ${chunk.drive_file_name ?? chunk.doc_title}` : chunk.doc_title;

    return {
      id: chunk.id,
      sourceType: "document_chunk" as const,
      domain: isClientContext ? "client_safe_documents" : "document_chunks",
      content: chunk.content,
      contextualContent: chunk.contextual_content ?? undefined,
      label,
      documentSectionId: chunk.section_id ?? undefined,
      documentChunkId: chunk.id,
      anchorId: chunk.anchor_id ?? undefined,
      pageNumber: chunk.page_number ?? undefined,
      containerId: chunk.document_version_id,
      sourcePrecedence: "source_evidence" as const,
      evidenceRole: "source_evidence" as const,
      openTarget: {
        targetType: chunk.anchor_id ? "document_section" : "document",
        targetRef: {
          documentVersionId: chunk.document_version_id,
          documentId: chunk.document_id,
          ...(chunk.anchor_id ? { anchorId: chunk.anchor_id } : {}),
          ...(chunk.page_number ? { pageNumber: chunk.page_number } : {})
        }
      },
      citationRef: { type: chunk.drive_file_id ? "google_drive_document" : "document_chunk", id: chunk.id, label },
      vectorScore: vecSim,
      lexicalScore: lex,
      citationAvailabilityScore: chunk.anchor_id ? 1 : 0.65,
      retrievalStage: "dense" as const,
      whySelected: `dense document retrieval; vector=${vecSim.toFixed(3)} lexical=${lex.toFixed(3)}`,
      finalScore: combined,
      isClientSafe: chunk.visibility === "shared_with_client",
      isInternalOnly: chunk.visibility === "internal",
      metadata: {
        sourceProvider: chunk.drive_file_id ? "google_drive" : "upload",
        driveFileId: chunk.drive_file_id ?? undefined,
        driveWebViewLink: chunk.drive_web_view_link ?? undefined
      },
    };
  });
}

function buildLexicalPatterns(query: string): string[] {
  const tokens = tokenizeQuery(query).slice(0, 8);
  if (tokens.length === 0) {
    const trimmed = query.trim().toLowerCase().slice(0, 80);
    return trimmed ? [`%${trimmed}%`] : [];
  }
  return tokens.map((token) => `%${token}%`);
}

function buildDocumentLexicalWhere(patternCount: number): string {
  return Array.from({ length: patternCount }, (_, index) => {
    const param = `$${index + 2}`;
    return `(dc.lexical_content ILIKE ${param} OR COALESCE(dc.contextual_content, '') ILIKE ${param} OR dc.content ILIKE ${param})`;
  }).join(" OR ");
}

async function retrieveDocumentLexicalChunks(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  topK: number,
  isClientContext: boolean,
  docWeight: number
): Promise<RetrievalCandidate[]> {
  const patterns = buildLexicalPatterns(query);
  if (patterns.length === 0) return [];

  const visibilityFilter = isClientContext ? "AND d.visibility = 'shared_with_client'" : "";
  const lexicalWhere = buildDocumentLexicalWhere(patterns.length);
  const limitParam = patterns.length + 2;
  const chunks = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      section_id: string | null;
      content: string;
      contextual_content: string | null;
      lexical_content: string;
      page_number: number | null;
      document_version_id: string;
      document_id: string;
      metadata_json: unknown;
      visibility: string;
      doc_title: string;
      drive_file_id: string | null;
      drive_file_name: string | null;
      drive_web_view_link: string | null;
      anchor_id: string | null;
    }>
  >(
    `
    SELECT
      dc.id,
      dc.section_id,
      dc.content,
      dc.contextual_content,
      dc.lexical_content,
      dc.page_number,
      dc.document_version_id,
      d.id AS document_id,
      dc.metadata_json,
      d.visibility,
      d.title AS doc_title,
      pdf.id AS drive_file_id,
      pdf.name AS drive_file_name,
      pdf.web_view_link AS drive_web_view_link,
      ds.anchor_id
    FROM document_chunks dc
    JOIN document_versions dv ON dv.id = dc.document_version_id
    JOIN documents d ON d.id = dv.document_id
    LEFT JOIN project_drive_files pdf
      ON pdf.project_id = d.project_id
     AND (pdf.document_id = d.id OR pdf.document_version_id = dv.id)
    LEFT JOIN document_sections ds
      ON ds.id = dc.section_id
     AND ds.parse_revision = dv.parse_revision
    WHERE dc.project_id = $1::uuid
      AND d.archived_at IS NULL
      AND d.current_version_id = dv.id
      AND dv.status IN ('ready', 'partial')
      AND dc.parse_revision = dv.parse_revision
      AND (${lexicalWhere})
      ${visibilityFilter}
    ORDER BY dc.created_at DESC
    LIMIT $${limitParam}
  `,
    projectId,
    ...patterns,
    topK * 3
  );

  return chunks
    .map((chunk) => {
      const lexicalContent = [chunk.lexical_content, chunk.contextual_content ?? "", chunk.content].join(" ");
      const lex = lexicalScore(query, lexicalContent);
      const label = chunk.drive_file_id ? `Google Drive · ${chunk.drive_file_name ?? chunk.doc_title}` : chunk.doc_title;
      return {
        id: chunk.id,
        sourceType: "document_chunk" as const,
        domain: isClientContext ? "client_safe_documents" as const : "document_chunks" as const,
        content: chunk.content,
        contextualContent: chunk.contextual_content ?? undefined,
        label,
        documentSectionId: chunk.section_id ?? undefined,
        documentChunkId: chunk.id,
        anchorId: chunk.anchor_id ?? undefined,
        pageNumber: chunk.page_number ?? undefined,
        containerId: chunk.document_version_id,
        sourcePrecedence: "source_evidence" as const,
        evidenceRole: "communication_evidence" as const,
        openTarget: {
          targetType: chunk.anchor_id ? "document_section" : "document",
          targetRef: {
            documentVersionId: chunk.document_version_id,
            documentId: chunk.document_id,
            ...(chunk.anchor_id ? { anchorId: chunk.anchor_id } : {}),
            ...(chunk.page_number ? { pageNumber: chunk.page_number } : {})
          }
        },
        citationRef: { type: chunk.drive_file_id ? "google_drive_document" : "document_chunk", id: chunk.id, label },
        vectorScore: 0,
        lexicalScore: lex,
        citationAvailabilityScore: chunk.anchor_id ? 1 : 0.65,
        retrievalStage: "lexical" as const,
        whySelected: `lexical document retrieval; lexical=${lex.toFixed(3)}`,
        finalScore: weightedHybridScore({ lexicalScore: lex, vectorScore: 0 }) * docWeight,
        isClientSafe: chunk.visibility === "shared_with_client",
        isInternalOnly: chunk.visibility === "internal",
        metadata: {
          sourceProvider: chunk.drive_file_id ? "google_drive" : "upload",
          driveFileId: chunk.drive_file_id ?? undefined,
          driveWebViewLink: chunk.drive_web_view_link ?? undefined
        },
      };
    })
    .filter((candidate) => (candidate.lexicalScore ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Brain node retrieval (direct lookup, not embedding-based)
// ---------------------------------------------------------------------------
async function retrieveBrainNodes(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  selectedNodeId: string | undefined,
  selectedSectionId: string | undefined,
  acceptedTruthBoost: number
): Promise<RetrievalCandidate[]> {
  // Fetch nodes from the latest accepted brain graph.
  const graphArtifact = await prisma.artifactVersion.findFirst({
    where: { projectId, artifactType: "brain_graph", status: "accepted" },
    orderBy: { versionNumber: "desc" },
  });
  if (!graphArtifact) return [];

  const whereNodeIds: string[] = [];
  if (selectedNodeId) whereNodeIds.push(selectedNodeId);

  // Expand: nodes linked to the selected section.
  if (selectedSectionId) {
    const linked = await prisma.brainSectionLink.findMany({
      where: { artifactVersionId: graphArtifact.id, documentSectionId: selectedSectionId },
      select: { brainNodeId: true },
    });
    for (const l of linked) whereNodeIds.push(l.brainNodeId);
  }

  // Expand: directly connected neighbors of the selected node.
  if (selectedNodeId) {
    const edges = await prisma.brainEdge.findMany({
      where: {
        artifactVersionId: graphArtifact.id,
        OR: [{ fromNodeId: selectedNodeId }, { toNodeId: selectedNodeId }],
      },
      select: { fromNodeId: true, toNodeId: true },
    });
    for (const e of edges) {
      whereNodeIds.push(e.fromNodeId);
      whereNodeIds.push(e.toNodeId);
    }
  }

  const nodes = await prisma.brainNode.findMany({
    where: {
      artifactVersionId: graphArtifact.id,
      ...(whereNodeIds.length > 0 ? { id: { in: whereNodeIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 12,
  });

  const nodeLinks = nodes.length
    ? await prisma.brainSectionLink.findMany({
        where: {
          artifactVersionId: graphArtifact.id,
          brainNodeId: { in: nodes.map((node) => node.id) }
        },
        include: {
          documentSection: {
            include: {
              documentVersion: {
                include: {
                  document: true
                }
              }
            }
          }
        }
      })
    : [];

  const visibilityByNodeId = new Map<string, Set<string>>();
  for (const link of nodeLinks) {
    const set = visibilityByNodeId.get(link.brainNodeId) ?? new Set<string>();
    set.add(link.documentSection.documentVersion.document.visibility);
    visibilityByNodeId.set(link.brainNodeId, set);
  }

  return nodes.map((node) => {
    const lex = lexicalScore(query, node.title + " " + node.summary);
    const isPriority = node.id === selectedNodeId;
    const linkedVisibilities = visibilityByNodeId.get(node.id);
    const isClientSafe =
      linkedVisibilities != null &&
      linkedVisibilities.size > 0 &&
      Array.from(linkedVisibilities).every((visibility) => visibility === "shared_with_client");
    return {
      id: node.id,
      sourceType: "brain_node" as const,
      content: `${node.title}: ${node.summary}`,
      label: node.title,
      containerId: graphArtifact.id,
      lexicalScore: lex,
      graphScore: isPriority ? 1 : 0.6,
      citationRef: { type: "brain_node", id: node.id, label: node.title },
      retrievalStage: "graph" as const,
      whySelected: isPriority ? "selected brain node" : "brain graph neighborhood",
      finalScore: (isPriority ? 2.0 : lex + 0.3) * acceptedTruthBoost,
      isClientSafe,
      isInternalOnly: !isClientSafe,
    };
  });
}

// ---------------------------------------------------------------------------
// Product Brain retrieval (accepted current truth summary)
// ---------------------------------------------------------------------------
async function retrieveProductBrain(
  prisma: PrismaClient,
  projectId: string,
  acceptedTruthBoost: number
): Promise<RetrievalCandidate[]> {
  const artifact = await prisma.artifactVersion.findFirst({
    where: { projectId, artifactType: "product_brain", status: "accepted" },
    orderBy: { versionNumber: "desc" }
  });

  if (!artifact) {
    return [];
  }

  const payload = artifact.payloadJson as Record<string, unknown>;
  const summaryParts = [
    payload.whatTheProductIs,
    Array.isArray(payload.mainFlows) ? payload.mainFlows.join("; ") : "",
    Array.isArray(payload.modules) ? payload.modules.join("; ") : "",
    Array.isArray(payload.constraints) ? payload.constraints.join("; ") : "",
    Array.isArray(payload.integrations) ? payload.integrations.join("; ") : ""
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");

  if (!summaryParts) {
    return [];
  }

  return [
    {
      id: artifact.id,
      sourceType: "product_brain" as const,
      content: summaryParts,
      label: `Product Brain v${artifact.versionNumber}`,
      containerId: artifact.id,
      finalScore: 0.75 * acceptedTruthBoost,
      isClientSafe: false,
      isInternalOnly: true
    }
  ];
}

async function retrieveLiveDocSections(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  selectedSectionId: string | undefined,
  acceptedTruthBoost: number
): Promise<RetrievalCandidate[]> {
  const queryTokens = tokenizeQuery(query);
  const artifact = await prisma.artifactVersion.findFirst({
    where: { projectId, artifactType: "live_doc", status: "accepted" },
    orderBy: { versionNumber: "desc" }
  });
  if (!artifact) return [];

  const payload = liveDocArtifactSchema.parse(artifact.payloadJson);
  return payload.sections
    .filter((section) => {
      if (selectedSectionId && section.sectionKey === selectedSectionId) {
        return true;
      }
      if (queryTokens.length === 0) {
        return true;
      }
      const haystack = `${section.sectionLabel}\n${section.content}`.toLowerCase();
      return queryTokens.some((token) => haystack.includes(token));
    })
    .slice(0, 8)
    .map((section) => {
      const lex = lexicalScore(query, `${section.sectionLabel}\n${section.content}`);
      const selectedBoost = selectedSectionId && section.sectionKey === selectedSectionId ? 1.2 : 1.0;
      return {
        id: section.sectionKey,
        sourceType: "live_doc_section" as const,
        content: section.content,
        contextualContent: `${section.sectionLabel}\n${section.content}`,
        label: section.sectionLabel,
        anchorId: section.anchorId,
        containerId: artifact.id,
        lexicalScore: lex,
        citationRef: { type: "live_doc_section", id: section.sectionKey, label: section.sectionLabel },
        citationAvailabilityScore: section.anchorId ? 1 : 0.65,
        retrievalStage: "structured" as const,
        whySelected: "live doc accepted artifact section",
        finalScore: Math.max(0.2, (0.5 + 0.5 * lex) * acceptedTruthBoost * selectedBoost),
        isClientSafe: false,
        isInternalOnly: true
      };
    });
}

// ---------------------------------------------------------------------------
// Change proposals retrieval
// ---------------------------------------------------------------------------
async function retrieveChanges(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  acceptedTruthBoost: number
): Promise<RetrievalCandidate[]> {
  const proposals = await prisma.specChangeProposal.findMany({
    where: { projectId, status: "accepted" },
    orderBy: { acceptedAt: "desc" },
    take: 8,
  });

  const links = proposals.length
    ? await prisma.specChangeLink.findMany({
        where: { projectId, specChangeProposalId: { in: proposals.map((proposal) => proposal.id) } },
      })
    : [];
  const linksByProposalId = new Map<string, typeof links>();
  for (const link of links) {
    const bucket = linksByProposalId.get(link.specChangeProposalId) ?? [];
    bucket.push(link);
    linksByProposalId.set(link.specChangeProposalId, bucket);
  }

  return proposals.map((proposal) => {
    const lex = lexicalScore(query, proposal.title + " " + proposal.summary);
    const proposalLinks = linksByProposalId.get(proposal.id) ?? [];
    return {
      id: proposal.id,
      sourceType: "change_proposal" as const,
      domain: "accepted_changes" as const,
      content: `${proposal.title}: ${proposal.summary}`,
      label: proposal.title,
      changeProposalId: proposal.id,
      linkedSectionIds: proposalLinks
        .filter((link) => link.linkType === "document_section")
        .map((link) => link.linkRefId),
      linkedMessageIds: proposalLinks
        .filter((link) => link.linkType === "message")
        .map((link) => link.linkRefId),
      decisionRecordIds: proposal.decisionRecordId ? [proposal.decisionRecordId] : [],
      sourcePrecedence: "accepted_changes" as const,
      evidenceRole: "accepted_change" as const,
      openTarget: {
        targetType: "change_proposal",
        targetRef: { proposalId: proposal.id },
      },
      citationRef: { type: "change_proposal", id: proposal.id, label: proposal.title },
      lexicalScore: lex,
      citationAvailabilityScore: 1,
      retrievalStage: "structured" as const,
      whySelected: "accepted change proposal",
      finalScore: (lex + 0.4) * acceptedTruthBoost,
      isClientSafe: false,
      isInternalOnly: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Decision records retrieval
// ---------------------------------------------------------------------------
async function retrieveDecisions(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  acceptedTruthBoost: number
): Promise<RetrievalCandidate[]> {
  const decisions = await prisma.decisionRecord.findMany({
    where: { projectId, status: "accepted" },
    orderBy: { acceptedAt: "desc" },
    take: 6,
  });

  return decisions.map((decision) => {
    const lex = lexicalScore(query, decision.title + " " + decision.statement);
    return {
      id: decision.id,
      sourceType: "decision_record" as const,
      domain: "decisions" as const,
      content: `Decision: ${decision.title} — ${decision.statement}`,
      label: decision.title,
      decisionRecordId: decision.id,
      sourcePrecedence: "accepted_decisions" as const,
      evidenceRole: "accepted_decision" as const,
      openTarget: {
        targetType: "decision_record",
        targetRef: { decisionId: decision.id },
      },
      citationRef: { type: "decision_record", id: decision.id, label: decision.title },
      lexicalScore: lex,
      citationAvailabilityScore: 1,
      retrievalStage: "structured" as const,
      whySelected: "accepted decision record",
      finalScore: (lex + 0.35) * acceptedTruthBoost,
      isClientSafe: false,
      isInternalOnly: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Dashboard snapshot retrieval
// ---------------------------------------------------------------------------
async function retrieveDashboard(
  prisma: PrismaClient,
  projectId: string,
  orgId: string,
  pageContext?: string
): Promise<RetrievalCandidate[]> {
  const scope = pageContext === "dashboard_general" ? "general" : "project";
  const snapshot = await prisma.dashboardSnapshot.findFirst({
    where: scope === "general" ? { orgId, projectId: null, scope } : { orgId, projectId, scope },
    orderBy: { computedAt: "desc" },
  });

  if (!snapshot) return [];

  return [
    {
      id: snapshot.id,
      sourceType: "dashboard_snapshot" as const,
      domain: "dashboard_snapshots" as const,
      content: JSON.stringify(snapshot.payloadJson),
      label: scope === "general" ? "General Dashboard Snapshot" : "Project Dashboard Snapshot",
      sourcePrecedence: "dashboard_facts" as const,
      dashboardSnapshotId: snapshot.id,
      evidenceRole: "dashboard_fact" as const,
      openTarget: {
        targetType: "dashboard_filter",
        targetRef: { filter: "snapshot", value: snapshot.id },
      },
      citationRef: { type: "dashboard_snapshot", id: snapshot.id, label: scope === "general" ? "General Dashboard Snapshot" : "Project Dashboard Snapshot" },
      citationAvailabilityScore: 1,
      retrievalStage: "structured" as const,
      whySelected: "latest dashboard snapshot",
      finalScore: 0.7,
      isClientSafe: true,
      isInternalOnly: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Project responsibility retrieval
// ---------------------------------------------------------------------------
async function retrieveResponsibilities(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  topK: number
): Promise<RetrievalCandidate[]> {
  const tokens = tokenizeQuery(query);
  const responsibilities = await prisma.projectResponsibility.findMany({
    where: { projectId },
    include: {
      member: {
        include: {
          user: {
            select: { displayName: true, email: true }
          }
        }
      }
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: Math.max(topK * 4, 20)
  });

  return responsibilities
    .map((responsibility) => {
      const assignee = responsibility.member?.user.displayName ?? responsibility.assigneeName ?? "Unassigned";
      const content = [
        `Title: ${responsibility.title}`,
        `Assignee: ${assignee}`,
        `Area: ${responsibility.area}`,
        `Status: ${responsibility.status}`,
        responsibility.description ? `Description: ${responsibility.description}` : null
      ].filter(Boolean).join("\n");
      const scoreText = [
        responsibility.title,
        responsibility.description ?? "",
        responsibility.area,
        responsibility.status,
        assignee,
        responsibility.member?.user.email ?? ""
      ].join(" ");
      const lex = lexicalScore(query, scoreText);
      const statusBoost = tokens.includes("blocked") && responsibility.status === "blocked" ? 0.8 : 0;
      const areaBoost = tokens.includes(responsibility.area) ? 0.5 : 0;
      const finalScore = lex + statusBoost + areaBoost + 0.4;

      return {
        id: responsibility.id,
        sourceType: "project_responsibility" as const,
        domain: "project_responsibilities" as const,
        content,
        contextualContent: `Project responsibility\n${content}`,
        label: `${responsibility.title} (${assignee})`,
        containerId: responsibility.projectId,
        responsibilityId: responsibility.id,
        sourcePrecedence: "team_context" as const,
        evidenceRole: "team_context" as const,
        openTarget: {
          targetType: "project_responsibility",
          targetRef: { projectId, responsibilityId: responsibility.id }
        },
        citationRef: { type: "project_responsibility", id: responsibility.id, label: responsibility.title },
        lexicalScore: lex,
        citationAvailabilityScore: 1,
        retrievalStage: "structured" as const,
        whySelected: `project responsibility; lexical=${lex.toFixed(3)}`,
        finalScore,
        isClientSafe: false,
        isInternalOnly: true
      } satisfies RetrievalCandidate;
    })
    .filter((candidate) => candidate.finalScore > 0.35)
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, topK);
}

// ---------------------------------------------------------------------------
// Manual project context retrieval
// ---------------------------------------------------------------------------
async function retrieveProjectContext(
  prisma: PrismaClient,
  projectId: string,
  queryEmbedding: number[],
  query: string,
  topK: number
): Promise<RetrievalCandidate[]> {
  const dense = queryEmbedding.length
    ? await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          context_entry_id: string;
          raw_text: string;
          contextual_text: string;
          lexical_text: string | null;
          type: string;
          title: string;
          participants_json: unknown;
          tags_json: unknown;
          source_date: Date | null;
          linked_member_id: string | null;
          importance: string;
          attachment_id: string | null;
          attachment_kind: string | null;
          attachment_mime_type: string | null;
          attachment_original_filename: string | null;
          attachment_caption: string | null;
          attachment_description: string | null;
          vec_dist: number | null;
        }>
      >(
        `
        SELECT
          pcc.id,
          pcc.context_entry_id,
          pcc.raw_text,
          pcc.contextual_text,
          pcc.lexical_text,
          pce.type,
          pce.title,
          pce.participants_json,
          pce.tags_json,
          pce.source_date,
          pce.linked_member_id,
          pce.importance,
          pca.id AS attachment_id,
          pca.attachment_kind AS attachment_kind,
          pca.mime_type AS attachment_mime_type,
          pca.original_filename AS attachment_original_filename,
          pca.caption AS attachment_caption,
          pca.description AS attachment_description,
          (pcc.embedding OPERATOR(extensions.<=>) $2::extensions.vector) AS vec_dist
        FROM project_context_chunks pcc
        JOIN project_context_entries pce ON pce.id = pcc.context_entry_id
        LEFT JOIN LATERAL (
          SELECT id, attachment_kind, mime_type, original_filename, caption, description
          FROM project_context_attachments
          WHERE context_entry_id = pce.id
          ORDER BY created_at ASC
          LIMIT 1
        ) pca ON TRUE
        WHERE pcc.project_id = $1::uuid
          AND pce.status = 'active'
          AND pcc.embedding IS NOT NULL
        ORDER BY pcc.embedding OPERATOR(extensions.<=>) $2::extensions.vector
        LIMIT $3
      `,
        projectId,
        `[${queryEmbedding.join(",")}]`,
        topK * 2
      )
    : [];

  const lexicalRows = await prisma.projectContextChunk.findMany({
    where: {
      projectId,
      contextEntry: { status: "active" }
    },
    include: {
      contextEntry: {
        include: {
          attachments: {
            orderBy: { createdAt: "asc" },
            take: 1
          }
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(topK * 4, 20)
  });

  const fromDense = dense.map((chunk) => {
    const lex = lexicalScore(query, [chunk.lexical_text ?? "", chunk.contextual_text].join(" "));
    const vecSim = vectorDistanceToSimilarity(chunk.vec_dist, 0.4);
    return mapProjectContextCandidate({
      id: chunk.id,
      projectId,
      contextEntryId: chunk.context_entry_id,
      rawText: chunk.raw_text,
      contextualText: chunk.contextual_text,
      lexicalText: chunk.lexical_text,
      type: chunk.type,
      title: chunk.title,
      participantsJson: chunk.participants_json,
      tagsJson: chunk.tags_json,
      sourceDate: chunk.source_date,
      linkedMemberId: chunk.linked_member_id,
      importance: chunk.importance,
      attachment: chunk.attachment_id
        ? {
            attachmentId: chunk.attachment_id,
            attachmentKind: chunk.attachment_kind,
            mimeType: chunk.attachment_mime_type,
            originalFilename: chunk.attachment_original_filename,
            caption: chunk.attachment_caption,
            description: chunk.attachment_description
          }
        : null,
      lexicalScore: lex,
      vectorScore: vecSim,
      stage: "dense"
    });
  });

  const fromLexical = lexicalRows.map((chunk) => {
    const lex = lexicalScore(query, [chunk.lexicalText ?? "", chunk.contextualText].join(" "));
    return mapProjectContextCandidate({
      id: chunk.id,
      projectId,
      contextEntryId: chunk.contextEntryId,
      rawText: chunk.rawText,
      contextualText: chunk.contextualText,
      lexicalText: chunk.lexicalText,
      type: chunk.contextEntry.type,
      title: chunk.contextEntry.title,
      participantsJson: chunk.contextEntry.participantsJson,
      tagsJson: chunk.contextEntry.tagsJson,
      sourceDate: chunk.contextEntry.sourceDate,
      linkedMemberId: chunk.contextEntry.linkedMemberId,
      importance: chunk.contextEntry.importance,
      attachment: chunk.contextEntry.attachments[0]
        ? {
            attachmentId: chunk.contextEntry.attachments[0].id,
            attachmentKind: chunk.contextEntry.attachments[0].attachmentKind,
            mimeType: chunk.contextEntry.attachments[0].mimeType,
            originalFilename: chunk.contextEntry.attachments[0].originalFilename ?? chunk.contextEntry.attachments[0].filename,
            caption: chunk.contextEntry.attachments[0].caption,
            description: chunk.contextEntry.attachments[0].description
          }
        : null,
      lexicalScore: lex,
      vectorScore: 0,
      stage: "lexical"
    });
  });

  return mergeCandidates([...fromDense, ...fromLexical])
    .filter((candidate) => candidate.finalScore > 0.2)
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, topK);
}

function mapProjectContextCandidate(input: {
  id: string;
  projectId: string;
  contextEntryId: string;
  rawText: string;
  contextualText: string;
  lexicalText: string | null;
  type: string;
  title: string;
  participantsJson: unknown;
  tagsJson: unknown;
  sourceDate: Date | null;
  linkedMemberId: string | null;
  importance: string;
  attachment?: {
    attachmentId: string | null;
    attachmentKind: string | null;
    mimeType: string | null;
    originalFilename: string | null;
    caption: string | null;
    description: string | null;
  } | null;
  lexicalScore: number;
  vectorScore: number;
  stage: "dense" | "lexical";
}): RetrievalCandidate {
  const participants = jsonStringArray(input.participantsJson);
  const tags = jsonStringArray(input.tagsJson);
  const importanceBoost = input.importance === "high" ? 0.2 : 0;
  const finalScore = weightedHybridScore({
    vectorScore: input.vectorScore,
    lexicalScore: input.lexicalScore
  }) + importanceBoost + 0.35;
  const label = `${input.title} (${input.type})`;
  const isImageContext = input.attachment?.attachmentKind === "image" || input.type === "chart_caption" || input.type === "screenshot_caption";
  return {
    id: input.id,
    sourceType: "project_context",
    domain: "project_context",
    content: input.rawText,
    contextualContent: input.contextualText,
    label,
    containerId: input.contextEntryId,
    contextId: input.contextEntryId,
    contextChunkId: input.id,
    contextType: input.type,
    sourcePrecedence: "manual_context",
    evidenceRole: "manual_context",
    openTarget: {
      targetType: "project_context",
      targetRef: {
        projectId: input.projectId,
        contextId: input.contextEntryId,
        contextChunkId: input.id,
        ...(input.attachment?.attachmentId ? { attachmentId: input.attachment.attachmentId } : {})
      }
    },
    citationRef: { type: "project_context", id: input.contextEntryId, label },
    vectorScore: input.vectorScore,
    lexicalScore: input.lexicalScore,
    citationAvailabilityScore: 1,
    retrievalStage: input.stage,
    whySelected: `${isImageContext ? "captioned image context" : "manual context"}; type=${input.type}; lexical=${input.lexicalScore.toFixed(3)}${input.vectorScore ? ` vector=${input.vectorScore.toFixed(3)}` : ""}`,
    finalScore,
    isClientSafe: false,
    isInternalOnly: true,
    evidenceCompleteness: "complete"
  };
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// ---------------------------------------------------------------------------
// Persisted diagram retrieval
// ---------------------------------------------------------------------------
async function retrieveProjectDiagrams(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  topK: number
): Promise<RetrievalCandidate[]> {
  const rows = await prisma.projectDiagram.findMany({
    where: { projectId, status: "active" },
    include: { liveDocEmbeds: true },
    orderBy: { updatedAt: "desc" },
    take: Math.max(topK * 4, 20)
  });

  return rows
    .map((diagram) => {
      const embeddedSections = diagram.liveDocEmbeds.map((embed) => embed.sectionKey);
      const text = [
        diagram.title,
        diagram.description ?? "",
        diagram.diagramType,
        diagram.source,
        diagram.mermaidSource,
        embeddedSections.join(" ")
      ].join(" ");
      const lex = lexicalScore(query, text);
      const embeddedBoost = embeddedSections.length ? 0.2 : 0;
      const finalScore = lex + embeddedBoost + 0.35;
      const content = [
        `Diagram: ${diagram.diagramType} / ${diagram.title}`,
        diagram.description ? `Description: ${diagram.description}` : null,
        embeddedSections.length ? `Embedded Live Doc sections: ${embeddedSections.join(", ")}` : null,
        `Mermaid excerpt: ${truncateForRetrieval(diagram.mermaidSource, 900)}`
      ]
        .filter(Boolean)
        .join("\n");
      return {
        id: diagram.id,
        sourceType: "project_diagram" as const,
        domain: "project_diagrams" as const,
        content,
        contextualContent: content,
        label: `${diagram.title} (${diagram.diagramType})`,
        containerId: diagram.projectId,
        diagramId: diagram.id,
        diagramType: diagram.diagramType,
        sourcePrecedence: "visual_artifact" as const,
        evidenceRole: "visual_artifact" as const,
        openTarget: {
          targetType: "project_diagram",
          targetRef: { projectId, diagramId: diagram.id }
        },
        citationRef: { type: "project_diagram", id: diagram.id, label: diagram.title },
        lexicalScore: lex,
        citationAvailabilityScore: 1,
        retrievalStage: "structured" as const,
        whySelected: `persisted diagram; type=${diagram.diagramType}; lexical=${lex.toFixed(3)}`,
        finalScore,
        isClientSafe: false,
        isInternalOnly: true,
        evidenceCompleteness: "complete" as const
      } satisfies RetrievalCandidate;
    })
    .filter((candidate) => candidate.finalScore > 0.35)
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, topK);
}

function truncateForRetrieval(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

// ---------------------------------------------------------------------------
// Persisted coding requirements retrieval
// ---------------------------------------------------------------------------
async function retrieveCodingRequirements(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  topK: number
): Promise<RetrievalCandidate[]> {
  const rows = await prisma.projectCodingRequirements.findMany({
    where: { projectId, artifactVersion: { artifactType: "engineering_requirements", status: "accepted" } },
    include: { artifactVersion: true, mermaidDiagram: true },
    orderBy: { createdAt: "desc" },
    take: Math.max(topK * 4, 12)
  });

  return rows
    .map((row) => {
      const payload = codingRequirementsPayloadSchema.parse(row.artifactVersion.payloadJson);
      const text = [
        payload.summary,
        payload.globalRequirements.join(" "),
        payload.integrationPoints.join(" "),
        payload.modules.map((module) => `${module.name} ${module.purpose} ${module.requirements.join(" ")} ${module.dependencies.join(" ")}`).join(" "),
        payload.unknowns.join(" "),
        payload.mermaid
      ].join(" ");
      const lex = lexicalScore(query, text);
      const recencyBoost = row.createdAt.getTime() / Math.max(Date.now(), 1) > 0.95 ? 0.1 : 0;
      const finalScore = lex + 0.55 + recencyBoost;
      const activeDiagram =
        row.mermaidDiagram?.status === "active" && row.mermaidDiagram.diagramType === "coding_flow"
          ? row.mermaidDiagram
          : null;
      const content = [
        `Coding requirements: ${payload.summary}`,
        `Modules: ${payload.modules.map((module) => module.name).join(", ")}`,
        payload.unknowns.length ? `Unknowns: ${payload.unknowns.join("; ")}` : null,
        activeDiagram ? `Flowchart diagram: ${activeDiagram.title}` : null,
        `Mermaid excerpt: ${truncateForRetrieval(payload.mermaid, 700)}`
      ]
        .filter(Boolean)
        .join("\n");
      return {
        id: row.id,
        sourceType: "coding_requirements" as const,
        domain: "coding_requirements" as const,
        content,
        contextualContent: content,
        label: "Current Coding Requirements",
        containerId: projectId,
        artifactVersionId: row.artifactVersionId,
        codingRequirementsId: row.id,
        diagramId: activeDiagram ? row.mermaidDiagramId ?? undefined : undefined,
        sourcePrecedence: "engineering_artifact" as const,
        evidenceRole: "engineering_artifact" as const,
        openTarget: {
          targetType: "coding_requirements",
          targetRef: { projectId, codingRequirementsId: row.id, artifactVersionId: row.artifactVersionId }
        },
        citationRef: { type: "coding_requirements", id: row.id, label: "Current Coding Requirements" },
        lexicalScore: lex,
        citationAvailabilityScore: 1,
        retrievalStage: "structured" as const,
        whySelected: `persisted engineering requirements; lexical=${lex.toFixed(3)}`,
        finalScore,
        isClientSafe: false,
        isInternalOnly: true,
        evidenceCompleteness: payload.evidenceSummary.lowEvidence ? "partial" as const : "complete" as const
      } satisfies RetrievalCandidate;
    })
    .filter((candidate) => candidate.finalScore >= 0.55)
    .sort((left, right) => right.finalScore - left.finalScore)
    .slice(0, topK);
}

// ---------------------------------------------------------------------------
// Communication message retrieval (embedding-based when chunks exist)
// ---------------------------------------------------------------------------
async function retrieveMessages(
  prisma: PrismaClient,
  embedProvider: EmbeddingProvider,
  projectId: string,
  queryEmbedding: number[],
  query: string,
  topK: number,
  commWeight: number
): Promise<RetrievalCandidate[]> {
  const messages = await prisma.communicationMessage.findMany({
    where: { projectId, bodyText: { not: "" }, isDeletedByProvider: false },
    orderBy: { sentAt: "desc" },
    take: Math.max(topK * 4, 20),
    include: { thread: true, attachments: true },
  });

  if (messages.length === 0) {
    return [];
  }

  await ensureCommunicationChunksIndexed(prisma, embedProvider, messages);

  const chunks = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      message_id: string;
      thread_id: string;
      content: string;
      contextual_content: string | null;
      lexical_content: string;
      sender_label: string;
      subject: string | null;
      provider: string;
      metadata_json: unknown;
      vec_dist: number | null;
    }>
  >(
    `
    SELECT
      cmc.id,
      cmc.message_id,
      cmc.thread_id,
      cmc.content,
      cmc.contextual_content,
      cmc.lexical_content,
      cm.sender_label,
      cm.provider,
      cmc.metadata_json,
      ct.subject,
      (cmc.embedding OPERATOR(extensions.<=>) $2::extensions.vector) AS vec_dist
    FROM communication_message_chunks cmc
    JOIN communication_messages cm ON cm.id = cmc.message_id
    JOIN communication_threads ct ON ct.id = cmc.thread_id
    WHERE cmc.project_id = $1::uuid
      AND cmc.embedding IS NOT NULL
      AND cm.is_deleted_by_provider = false
    ORDER BY cmc.embedding OPERATOR(extensions.<=>) $2::extensions.vector
    LIMIT $3
  `,
    projectId,
    `[${queryEmbedding.join(",")}]`,
    topK * 3
  );

  if (chunks.length > 0) {
    return chunks.map((chunk) => {
      const lexicalContent = [chunk.lexical_content, chunk.contextual_content ?? ""].join(" ");
      const lex = lexicalScore(query, lexicalContent);
      const vecSim = vectorDistanceToSimilarity(chunk.vec_dist, 0.4);
      const label = communicationChunkLabel(chunk);
      return {
        id: chunk.message_id,
        sourceType: "communication_message" as const,
        domain: "communication_message_chunks" as const,
        content: chunk.content,
        contextualContent: chunk.contextual_content ?? undefined,
        label,
        containerId: chunk.thread_id,
        messageId: chunk.message_id,
        threadId: chunk.thread_id,
        sourcePrecedence: "communication_evidence" as const,
        evidenceRole: "communication_evidence" as const,
        openTarget: {
          targetType: "message",
          targetRef: { messageId: chunk.message_id, threadId: chunk.thread_id, highlightChunkId: chunk.id },
        },
        citationRef: { type: "message", id: chunk.message_id, label },
        vectorScore: vecSim,
        lexicalScore: lex,
        recencyScore: 0.5,
        citationAvailabilityScore: 1,
        retrievalStage: "dense" as const,
        whySelected: `dense message retrieval; vector=${vecSim.toFixed(3)} lexical=${lex.toFixed(3)}`,
        finalScore: weightedHybridScore({ vectorScore: vecSim, lexicalScore: lex }) * commWeight,
        isClientSafe: false,
        isInternalOnly: true,
      };
    });
  }

  return messages
    .map((msg) => {
      const lex = lexicalScore(query, msg.bodyText);
      return {
        id: msg.id,
        sourceType: "communication_message" as const,
        domain: "communication_messages" as const,
        content: msg.bodyText,
        label: `${msg.senderLabel} (${msg.thread.subject ?? "thread"})`,
        containerId: msg.threadId,
        messageId: msg.id,
        threadId: msg.threadId,
        sourcePrecedence: "communication_evidence" as const,
        evidenceRole: "communication_evidence" as const,
        openTarget: {
          targetType: "message",
          targetRef: { messageId: msg.id, threadId: msg.threadId },
        },
        citationRef: { type: "message", id: msg.id, label: `${msg.senderLabel} (${msg.thread.subject ?? "thread"})` },
        lexicalScore: lex,
        recencyScore: 0.7,
        citationAvailabilityScore: 1,
        retrievalStage: "lexical" as const,
        whySelected: "lexical/recent communication evidence fallback",
        finalScore: lex * commWeight,
        isClientSafe: false,
        isInternalOnly: true,
      };
    })
    .filter((candidate) => candidate.finalScore > 0.05);
}

function buildMessageLexicalWhere(patternCount: number): string {
  return Array.from({ length: patternCount }, (_, index) => {
    const param = `$${index + 2}`;
    return `(cmc.lexical_content ILIKE ${param} OR COALESCE(cmc.contextual_content, '') ILIKE ${param} OR cmc.content ILIKE ${param} OR COALESCE(ct.subject, '') ILIKE ${param} OR cm.body_text ILIKE ${param})`;
  }).join(" OR ");
}

async function retrieveMessageLexicalChunks(
  prisma: PrismaClient,
  projectId: string,
  query: string,
  topK: number,
  commWeight: number
): Promise<RetrievalCandidate[]> {
  const patterns = buildLexicalPatterns(query);
  if (patterns.length === 0) return [];

  const lexicalWhere = buildMessageLexicalWhere(patterns.length);
  const limitParam = patterns.length + 2;
  const chunks = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      message_id: string;
      thread_id: string;
      content: string;
      contextual_content: string | null;
      lexical_content: string;
      sender_label: string;
      subject: string | null;
      provider: string;
      metadata_json: unknown;
    }>
  >(
    `
    SELECT
      cmc.id,
      cmc.message_id,
      cmc.thread_id,
      cmc.content,
      cmc.contextual_content,
      cmc.lexical_content,
      cm.sender_label,
      cm.provider,
      cmc.metadata_json,
      ct.subject
    FROM communication_message_chunks cmc
    JOIN communication_messages cm ON cm.id = cmc.message_id
    JOIN communication_threads ct ON ct.id = cmc.thread_id
    WHERE cmc.project_id = $1::uuid
      AND cm.is_deleted_by_provider = false
      AND (${lexicalWhere})
    ORDER BY cmc.created_at DESC
    LIMIT $${limitParam}
  `,
    projectId,
    ...patterns,
    topK * 3
  );

  return chunks
    .map((chunk) => {
      const lexicalContent = [chunk.lexical_content, chunk.contextual_content ?? "", chunk.content, chunk.subject ?? ""].join(" ");
      const lex = lexicalScore(query, lexicalContent);
      const label = communicationChunkLabel(chunk);
      return {
        id: chunk.message_id,
        sourceType: "communication_message" as const,
        domain: "communication_message_chunks" as const,
        content: chunk.content,
        contextualContent: chunk.contextual_content ?? undefined,
        label,
        containerId: chunk.thread_id,
        messageId: chunk.message_id,
        threadId: chunk.thread_id,
        sourcePrecedence: "communication_evidence" as const,
        evidenceRole: "source_evidence" as const,
        openTarget: {
          targetType: "message",
          targetRef: { messageId: chunk.message_id, threadId: chunk.thread_id, highlightChunkId: chunk.id },
        },
        citationRef: { type: "message", id: chunk.message_id, label },
        vectorScore: 0,
        lexicalScore: lex,
        recencyScore: 0.5,
        citationAvailabilityScore: 1,
        retrievalStage: "lexical" as const,
        whySelected: `lexical message retrieval; lexical=${lex.toFixed(3)}`,
        finalScore: weightedHybridScore({ lexicalScore: lex, vectorScore: 0 }) * commWeight,
        isClientSafe: false,
        isInternalOnly: true,
      };
    })
    .filter((candidate) => (candidate.lexicalScore ?? 0) > 0);
}

function communicationChunkLabel(chunk: {
  provider: string;
  sender_label: string;
  subject: string | null;
  metadata_json: unknown;
}) {
  if (chunk.provider !== "fireflies_ai" || !chunk.metadata_json || typeof chunk.metadata_json !== "object") {
    return `${chunk.sender_label} (${chunk.subject ?? "thread"})`;
  }

  const metadata = chunk.metadata_json as Record<string, unknown>;
  const meetingTitle = typeof metadata.meetingTitle === "string" ? metadata.meetingTitle : chunk.subject ?? "Fireflies meeting";
  const speakerName = typeof metadata.speakerName === "string" ? metadata.speakerName : chunk.sender_label;
  const timestampLabel = typeof metadata.timestampLabel === "string" ? metadata.timestampLabel : null;
  return timestampLabel
    ? `${meetingTitle} - ${speakerName} - ${timestampLabel}`
    : `${meetingTitle} - ${speakerName}`;
}

type FirefliesRetrievalSegment = {
  text: string;
  speakerName: string | null;
  speakerEmail: string | null;
  speakerId: string | null;
  startMs: number;
  endMs: number | null;
  segmentIndex: number;
  transcriptId: string;
  meetingTitle: string;
};

function extractFirefliesRetrievalSegments(rawMetadata: unknown): FirefliesRetrievalSegment[] {
  if (!rawMetadata || typeof rawMetadata !== "object") return [];
  const fireflies = (rawMetadata as { fireflies?: unknown }).fireflies;
  if (!fireflies || typeof fireflies !== "object") return [];
  const segments = (fireflies as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment): FirefliesRetrievalSegment | null => {
      if (!segment || typeof segment !== "object") return null;
      const item = segment as Record<string, unknown>;
      if (typeof item.text !== "string" || item.text.trim().length === 0) return null;
      return {
        text: item.text,
        speakerName: typeof item.speakerName === "string" ? item.speakerName : null,
        speakerEmail: typeof item.speakerEmail === "string" ? item.speakerEmail : null,
        speakerId: typeof item.speakerId === "string" ? item.speakerId : null,
        startMs: typeof item.startMs === "number" ? item.startMs : 0,
        endMs: typeof item.endMs === "number" ? item.endMs : null,
        segmentIndex: typeof item.segmentIndex === "number" ? item.segmentIndex : 0,
        transcriptId: typeof item.transcriptId === "string" ? item.transcriptId : "",
        meetingTitle: typeof item.meetingTitle === "string" ? item.meetingTitle : "Fireflies meeting"
      };
    })
    .filter((segment): segment is FirefliesRetrievalSegment => Boolean(segment));
}

function formatFirefliesRetrievalTimestampRange(startMs: number, endMs: number | null) {
  return `${formatFirefliesRetrievalMs(startMs)}-${formatFirefliesRetrievalMs(endMs ?? startMs)}`;
}

function formatFirefliesRetrievalMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

async function ensureCommunicationChunksIndexed(
  prisma: PrismaClient,
  embedProvider: EmbeddingProvider,
  messages: Array<{
    id: string;
    projectId: string;
    connectorId: string;
    provider: import("@prisma/client").CommunicationProvider;
    threadId: string;
    senderLabel: string;
    senderEmail?: string | null;
    sentAt: Date;
    bodyText: string;
    bodyHtml?: string | null;
    rawMetadataJson?: unknown;
    thread: { subject: string | null; participantsJson?: unknown };
    attachments?: Array<{ filename: string | null }>;
  }>
) {
  const existingChunks = await prisma.communicationMessageChunk.findMany({
    where: {
      messageId: {
        in: messages.map((message) => message.id)
      }
    },
    select: {
      messageId: true
    }
  });

  const indexedMessageIds = new Set(existingChunks.map((chunk: { messageId: string }) => chunk.messageId));

  for (const message of messages) {
    if (indexedMessageIds.has(message.id)) {
      continue;
    }

    const normalizedBody = message.bodyText.trim();
    if (!normalizedBody) {
      continue;
    }

    const firefliesSegments = message.provider === "fireflies_ai" ? extractFirefliesRetrievalSegments(message.rawMetadataJson) : [];
    const chunks =
      firefliesSegments.length > 0
        ? firefliesSegments.map((segment, index) => ({
            chunkIndex: index,
            content: segment.text,
            tokenCount: Math.max(1, Math.ceil(segment.text.length / 4)),
            metadata: {
              ...segment,
              timestampLabel: formatFirefliesRetrievalTimestampRange(segment.startMs, segment.endMs)
            }
          }))
        : chunkText({
            content: normalizedBody,
            documentTitle: message.thread.subject ?? `Thread ${message.threadId}`,
            kind: "communication_message",
            headingPath: [message.senderLabel],
            pageNumber: null,
            chunkSize: 220,
            overlapSize: 40
          }).map((chunk) => ({ ...chunk, metadata: null }));

    for (const chunk of chunks) {
      try {
        const attachmentNames = (message.attachments ?? [])
          .map((attachment) => attachment.filename)
          .filter((value): value is string => Boolean(value && value.trim().length > 0));
        const contentSignature = stableBodyHash(
          normalizedBody,
          `${message.thread.subject ?? ""}|${attachmentNames.join(",")}`
        );
        const contextualContent =
          message.provider === "fireflies_ai" && chunk.metadata
            ? [
                "Fireflies.ai meeting transcript segment",
                `Meeting: ${chunk.metadata.meetingTitle}`,
                `Speaker: ${chunk.metadata.speakerName ?? "Unknown speaker"}`,
                `Timestamp: ${chunk.metadata.timestampLabel}`,
                chunk.content
              ].join("\n")
            : buildMessageContextualRetrievalText({
                bodyText: chunk.content,
                provider: message.provider,
                threadSubject: message.thread.subject,
                senderLabel: message.senderLabel,
                senderEmail: message.senderEmail,
                sentAt: message.sentAt,
                projectId: message.projectId,
                messageId: message.id,
                threadId: message.threadId,
                attachmentNames
              });
        const created = await prisma.communicationMessageChunk.create({
          data: {
            messageId: message.id,
            threadId: message.threadId,
            projectId: message.projectId,
            connectorId: message.connectorId,
            provider: message.provider,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contextualContent,
            lexicalContent: buildMessageLexicalRetrievalText({
              subject: message.thread.subject,
              senderLabel: message.senderLabel,
              senderEmail: message.senderEmail,
              bodyText: normalizedBody,
              attachmentNames
            }),
            tokenCount: chunk.tokenCount,
            metadataJson: chunk.metadata
              ? { ...chunk.metadata, contentSignature }
              : {
                  senderLabel: message.senderLabel,
                  subject: message.thread.subject,
                  contentSignature
                }
          }
        });

        const embedding = await embedProvider.embedText(contextualContent);
        const vectorLiteral = `[${embedding.join(",")}]`;
        await prisma.$executeRawUnsafe(
          "UPDATE communication_message_chunks SET embedding = CAST($1 AS extensions.vector) WHERE id = CAST($2 AS uuid)",
          vectorLiteral,
          created.id
        );
      } catch (error) {
        if (
          error instanceof AppError ||
          !(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error as { code?: string }).code === "P2002"
          )
        ) {
          throw error;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hierarchical neighbor-section expansion (doc_viewer)
// ---------------------------------------------------------------------------
/**
 * When a document section is selected, fetch adjacent sections in the same
 * document version ordered by orderIndex so the reranker can apply a moderate
 * boost to content that is structurally close to the selected anchor.
 */
async function resolveNeighborSectionIds(
  prisma: PrismaClient,
  selectedSectionId: string,
  projectId: string,
  windowRadius = 2
): Promise<string[]> {
  const selected = await prisma.documentSection.findFirst({
    where: { id: selectedSectionId, projectId },
    select: { documentVersionId: true, orderIndex: true, parseRevision: true },
  });
  if (!selected) return [];

  const neighbors = await prisma.documentSection.findMany({
    where: {
      documentVersionId: selected.documentVersionId,
      projectId,
      parseRevision: selected.parseRevision,
      orderIndex: {
        gte: selected.orderIndex - windowRadius,
        lte: selected.orderIndex + windowRadius,
      },
      id: { not: selectedSectionId },
    },
    select: { id: true },
  });
  return neighbors.map((n) => n.id);
}

async function retrieveSelectedDocumentSections(
  prisma: PrismaClient,
  projectId: string,
  selectedSectionId: string,
  neighborSectionIds: string[],
  query: string,
  isClientContext: boolean
): Promise<RetrievalCandidate[]> {
  const sectionIds = [selectedSectionId, ...neighborSectionIds];
  const sections = await prisma.documentSection.findMany({
    where: { projectId, id: { in: sectionIds } },
    include: { documentVersion: { include: { document: true } } },
    orderBy: { orderIndex: "asc" },
  });

  const sectionOrder = new Map(sectionIds.map((id, index) => [id, index]));
  return sections
    .sort((a, b) => (sectionOrder.get(a.id) ?? 999) - (sectionOrder.get(b.id) ?? 999))
    .map((section) => {
      const content = section.normalizedText || section.anchorText || section.anchorId;
      const lex = lexicalScore(query, content);
      const selected = section.id === selectedSectionId;
      const isClientSafe = section.documentVersion.document.visibility === "shared_with_client";
      return {
        id: section.id,
        sourceType: "document_chunk" as const,
        domain: isClientContext ? "client_safe_documents" as const : "document_sections" as const,
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
        pageNumber: section.pageNumber ?? undefined,
        containerId: section.documentVersionId,
        linkedSectionIds: [section.id],
        sourcePrecedence: "source_evidence" as const,
        evidenceRole: "source_evidence" as const,
        openTarget: {
          targetType: "document_section",
          targetRef: {
            documentVersionId: section.documentVersionId,
            anchorId: section.anchorId,
            ...(section.pageNumber ? { pageNumber: section.pageNumber } : {}),
          },
        },
        citationRef: { type: "document_section", id: section.id, label: section.documentVersion.document.title },
        selectedObjectScore: selected ? 1 : 0,
        citationAvailabilityScore: 1,
        retrievalStage: "structured" as const,
        whySelected: selected ? "selected document section" : "neighboring document section",
        isNeighborSection: !selected,
        lexicalScore: lex,
        finalScore: selected ? 1.2 + lex : 0.65 + lex,
        isClientSafe,
        isInternalOnly: !isClientSafe,
      };
    });
}

async function retrieveSectionLinkedAcceptedEvidence(
  prisma: PrismaClient,
  projectId: string,
  sectionIds: string[],
  query: string
): Promise<RetrievalCandidate[]> {
  if (sectionIds.length === 0) return [];

  const sectionLinks = await prisma.specChangeLink.findMany({
    where: {
      projectId,
      linkType: "document_section",
      linkRefId: { in: sectionIds },
      proposal: { status: "accepted" },
    },
    include: { proposal: true },
    take: 12,
  });
  if (sectionLinks.length === 0) return [];

  const proposalIds = Array.from(new Set(sectionLinks.map((link) => link.specChangeProposalId)));
  const messageLinks = await prisma.specChangeLink.findMany({
    where: {
      projectId,
      specChangeProposalId: { in: proposalIds },
      linkType: "message",
    },
    take: 12,
  });
  const messageIds = Array.from(new Set(messageLinks.map((link) => link.linkRefId)));
  const messages = messageIds.length
    ? await prisma.communicationMessage.findMany({
        where: { projectId, id: { in: messageIds }, isDeletedByProvider: false },
        include: { thread: true },
        take: 12,
      })
    : [];

  const candidates: RetrievalCandidate[] = [];
  const seenProposalIds = new Set<string>();
  for (const link of sectionLinks) {
    if (seenProposalIds.has(link.proposal.id)) continue;
    seenProposalIds.add(link.proposal.id);
    const content = `${link.proposal.title}: ${link.proposal.summary}`;
    const lex = lexicalScore(query, content);
    candidates.push({
      id: link.proposal.id,
      sourceType: "change_proposal",
      domain: "accepted_changes",
      content,
      label: link.proposal.title,
      changeProposalId: link.proposal.id,
      linkedSectionIds: sectionLinks
        .filter((candidate) => candidate.specChangeProposalId === link.specChangeProposalId)
        .map((candidate) => candidate.linkRefId),
      linkedMessageIds: messageLinks
        .filter((candidate) => candidate.specChangeProposalId === link.specChangeProposalId)
        .map((candidate) => candidate.linkRefId),
      decisionRecordIds: link.proposal.decisionRecordId ? [link.proposal.decisionRecordId] : [],
      sourcePrecedence: "accepted_changes",
      evidenceRole: "linked_evidence",
      isLinkedEvidence: true,
      openTarget: {
        targetType: "change_proposal",
        targetRef: { proposalId: link.proposal.id },
      },
      citationRef: { type: "change_proposal", id: link.proposal.id, label: link.proposal.title },
      citationAvailabilityScore: 1,
      retrievalStage: "linked" as const,
      whySelected: "accepted change linked to selected section",
      lexicalScore: lex,
      finalScore: 0.7 + lex,
      isClientSafe: false,
      isInternalOnly: true,
    });
  }

  for (const message of messages) {
    const lex = lexicalScore(query, message.bodyText);
    candidates.push({
      id: message.id,
      sourceType: "communication_message",
      domain: "communication_messages",
      content: message.bodyText,
      label: `${message.senderLabel} (${message.thread.subject ?? "thread"})`,
      containerId: message.threadId,
      messageId: message.id,
      threadId: message.threadId,
      sourcePrecedence: "communication_evidence",
      evidenceRole: "linked_evidence",
      isLinkedEvidence: true,
      openTarget: {
        targetType: "message",
        targetRef: { messageId: message.id, threadId: message.threadId },
      },
      citationRef: { type: "message", id: message.id, label: `${message.senderLabel} (${message.thread.subject ?? "thread"})` },
      citationAvailabilityScore: 1,
      retrievalStage: "linked" as const,
      whySelected: "source message linked through accepted change",
      lexicalScore: lex,
      finalScore: 0.55 + lex,
      isClientSafe: false,
      isInternalOnly: true,
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Main hybrid retrieval entry point
// ---------------------------------------------------------------------------
export async function hybridRetrieve(
  prisma: PrismaClient,
  _embedProvider: EmbeddingProvider,
  orgId: string,
  input: HybridRetrievalInput
): Promise<RetrievalCandidate[]> {
  return (await hybridRetrieveDetailed(prisma, _embedProvider, orgId, input)).candidates;
}

function planAllows(plan: RetrievalPlan | undefined, domains: string[]): boolean {
  if (!plan) return true;
  return domains.some(
    (domain) =>
      plan.primaryDomains.includes(domain as never) ||
      plan.supportingDomains.includes(domain as never) ||
      plan.mustInclude.includes(domain as never) ||
      plan.shouldInclude.includes(domain as never)
  );
}

function filterByPlanAndRole(
  candidates: RetrievalCandidate[],
  plan: RetrievalPlan | undefined,
  isClientContext: boolean
): { candidates: RetrievalCandidate[]; droppedForbiddenDomainCount: number; droppedForClientSafetyCount: number } {
  let droppedForbiddenDomainCount = 0;
  let droppedForClientSafetyCount = 0;
  const filtered = candidates.filter((candidate) => {
    if (isClientContext && candidate.isInternalOnly) {
      droppedForClientSafetyCount++;
      return false;
    }
    if (plan && candidate.domain && plan.forbiddenDomains.includes(candidate.domain)) {
      droppedForbiddenDomainCount++;
      return false;
    }
    return true;
  });

  return { candidates: filtered, droppedForbiddenDomainCount, droppedForClientSafetyCount };
}

function mergeCandidates(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const byKey = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.sourceType,
      candidate.documentChunkId ??
        candidate.documentSectionId ??
        candidate.messageId ??
        candidate.brainNodeId ??
        candidate.changeProposalId ??
        candidate.decisionRecordId ??
        candidate.dashboardSnapshotId ??
        candidate.responsibilityId ??
        candidate.artifactVersionId ??
        candidate.id,
    ].join(":");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate });
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...candidate,
      contextualContent: existing.contextualContent ?? candidate.contextualContent,
      vectorScore: Math.max(existing.vectorScore ?? 0, candidate.vectorScore ?? 0),
      lexicalScore: Math.max(existing.lexicalScore ?? 0, candidate.lexicalScore ?? 0),
      graphScore: Math.max(existing.graphScore ?? 0, candidate.graphScore ?? 0),
      recencyScore: Math.max(existing.recencyScore ?? 0, candidate.recencyScore ?? 0),
      citationAvailabilityScore: Math.max(existing.citationAvailabilityScore ?? 0, candidate.citationAvailabilityScore ?? 0),
      finalScore: Math.max(existing.finalScore, candidate.finalScore),
      retrievalStage:
        existing.retrievalStage === "dense" && candidate.retrievalStage === "lexical"
          ? "dense"
          : existing.finalScore >= candidate.finalScore
            ? existing.retrievalStage
            : candidate.retrievalStage,
      whySelected:
        existing.whySelected && candidate.whySelected && existing.whySelected !== candidate.whySelected
          ? `${existing.whySelected}; ${candidate.whySelected}`
          : (existing.whySelected ?? candidate.whySelected),
      linkedSectionIds: Array.from(new Set([...(existing.linkedSectionIds ?? []), ...(candidate.linkedSectionIds ?? [])])),
      linkedMessageIds: Array.from(new Set([...(existing.linkedMessageIds ?? []), ...(candidate.linkedMessageIds ?? [])])),
      linkedChangeProposalIds: Array.from(
        new Set([...(existing.linkedChangeProposalIds ?? []), ...(candidate.linkedChangeProposalIds ?? [])])
      ),
      decisionRecordIds: Array.from(new Set([...(existing.decisionRecordIds ?? []), ...(candidate.decisionRecordIds ?? [])])),
    });
  }

  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Detailed hybrid retrieval entry point used by Socrates telemetry.
// ---------------------------------------------------------------------------
export async function hybridRetrieveDetailed(
  prisma: PrismaClient,
  _embedProvider: EmbeddingProvider,
  orgId: string,
  input: HybridRetrievalInput
): Promise<HybridRetrievalResult> {
  const queryTokens = tokenizeQuery(input.query);
  const candidates: RetrievalCandidate[] = [];
  let brainCandidateCount = 0;
  let graphCandidateCount = 0;
  let linkedEvidenceCandidateCount = 0;
  let retrievalBranchFailureCount = 0;

  // Resolve hierarchical neighbor section IDs for doc_viewer context.
  const neighborSectionIds: string[] =
    input.selectedSectionId && !input.neighborSectionIds
      ? await resolveNeighborSectionIds(prisma, input.selectedSectionId, input.projectId)
      : (input.neighborSectionIds ?? []);

  const retrievalTasks: Array<{
    domains: string[];
    required: boolean;
    task: Promise<RetrievalCandidate[]>;
  }> = [];

  const addTask = (domains: string[], task: Promise<RetrievalCandidate[]>) => {
    const required = Boolean(
      input.plan && domains.some((domain) => input.plan?.mustInclude.includes(domain as never))
    );
    retrievalTasks.push({ domains, required, task });
  };

  if (input.plan) {
    const brainCandidates = await loadProductBrainEvidence(
      prisma,
      input.projectId,
      input.plan,
      queryTokens,
      input.acceptedTruthBoost
    );
    brainCandidateCount = brainCandidates.length;
    candidates.push(...brainCandidates);

    const graphCandidates = await expandBrainGraph(
      prisma,
      input.projectId,
      input.plan,
      queryTokens,
      input.acceptedTruthBoost
    );
    graphCandidateCount = graphCandidates.length;
    candidates.push(...graphCandidates);

    const linkedEvidenceCandidates = await loadLinkedEvidenceForCandidates(
      prisma,
      input.projectId,
      [...brainCandidates, ...graphCandidates],
      input.plan,
      queryTokens
    );
    linkedEvidenceCandidateCount = linkedEvidenceCandidates.length;
    candidates.push(...linkedEvidenceCandidates);
  }

  if (
    input.pageContext === "doc_viewer" &&
    input.selectedSectionId &&
    input.domains.includeDocuments &&
    planAllows(input.plan, ["document_sections", "client_safe_documents"])
  ) {
    const selectedSectionCandidates = await retrieveSelectedDocumentSections(
      prisma,
      input.projectId,
      input.selectedSectionId,
      neighborSectionIds,
      input.query,
      input.isClientContext
    );
    candidates.push(...selectedSectionCandidates);
    if (!input.isClientContext && planAllows(input.plan, ["accepted_changes", "communication_messages"])) {
      candidates.push(
        ...(await retrieveSectionLinkedAcceptedEvidence(
          prisma,
          input.projectId,
          [input.selectedSectionId, ...neighborSectionIds],
          input.query
        ))
      );
    }
  }

  if (input.domains.includeDocuments && planAllows(input.plan, ["document_sections", "document_chunks", "client_safe_documents"])) {
    addTask(
      ["document_sections", "document_chunks", "client_safe_documents"],
      retrieveDocumentChunks(
        prisma,
        input.projectId,
        input.queryEmbedding,
        input.query,
        input.topK,
        input.isClientContext,
        input.docWeight
      )
    );
    addTask(
      ["document_sections", "document_chunks", "client_safe_documents"],
      retrieveDocumentLexicalChunks(
        prisma,
        input.projectId,
        input.query,
        input.topK,
        input.isClientContext,
        input.docWeight
      )
    );
  }

  if (!input.plan && input.domains.includeBrainNodes) {
    addTask(
      ["brain_nodes"],
      retrieveBrainNodes(
        prisma,
        input.projectId,
        input.query,
        input.selectedNodeId,
        input.selectedSectionId,
        input.acceptedTruthBoost
      )
    );
  }

  if (!input.plan && input.domains.includeProductBrain && !input.isClientContext) {
    addTask(["product_brain"], retrieveProductBrain(prisma, input.projectId, input.acceptedTruthBoost));
  }

  if (input.pageContext === "live_doc" && !input.isClientContext) {
    addTask(
      ["live_doc_sections"],
      retrieveLiveDocSections(
        prisma,
        input.projectId,
        input.query,
        input.selectedRefId,
        input.acceptedTruthBoost
      )
    );
  }

  if (
    input.domains.includeChanges &&
    !input.isClientContext &&
    planAllows(input.plan, ["accepted_changes"])
  ) {
    addTask(["accepted_changes"], retrieveChanges(prisma, input.projectId, input.query, input.acceptedTruthBoost));
  }

  if (
    input.domains.includeDecisions &&
    !input.isClientContext &&
    planAllows(input.plan, ["decisions"])
  ) {
    addTask(["decisions"], retrieveDecisions(prisma, input.projectId, input.query, input.acceptedTruthBoost));
  }

  if (input.domains.includeDashboard && planAllows(input.plan, ["dashboard_snapshots"])) {
    addTask(["dashboard_snapshots"], retrieveDashboard(prisma, input.projectId, orgId, input.pageContext));
  }

  if (
    input.domains.includeResponsibilities &&
    !input.isClientContext &&
    planAllows(input.plan, ["project_responsibilities"])
  ) {
    addTask(["project_responsibilities"], retrieveResponsibilities(prisma, input.projectId, input.query, input.topK));
  }

  if (
    input.domains.includeProjectContext &&
    !input.isClientContext &&
    planAllows(input.plan, ["project_context"])
  ) {
    addTask(
      ["project_context"],
      retrieveProjectContext(prisma, input.projectId, input.queryEmbedding, input.query, input.topK)
    );
  }

  if (
    input.domains.includeProjectDiagrams &&
    !input.isClientContext &&
    planAllows(input.plan, ["project_diagrams"])
  ) {
    addTask(["project_diagrams"], retrieveProjectDiagrams(prisma, input.projectId, input.query, input.topK));
  }

  if (
    input.domains.includeCodingRequirements &&
    !input.isClientContext &&
    planAllows(input.plan, ["coding_requirements"])
  ) {
    addTask(["coding_requirements"], retrieveCodingRequirements(prisma, input.projectId, input.query, input.topK));
  }

  if (
    input.domains.includeCommunications &&
    !input.isClientContext &&
    planAllows(input.plan, ["communication_messages", "communication_message_chunks", "communication_threads"])
  ) {
    addTask(
      ["communication_messages", "communication_message_chunks", "communication_threads"],
      retrieveMessages(
        prisma,
        _embedProvider,
        input.projectId,
        input.queryEmbedding,
        input.query,
        input.topK,
        input.commWeight
      )
    );
    addTask(
      ["communication_messages", "communication_message_chunks", "communication_threads"],
      retrieveMessageLexicalChunks(
        prisma,
        input.projectId,
        input.query,
        input.topK,
        input.commWeight
      )
    );
  }

  const results = await Promise.allSettled(retrievalTasks.map((entry) => entry.task));
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
    } else {
      retrievalBranchFailureCount++;
      if (retrievalTasks[index]?.required) {
        throw new AppError(
          503,
          `Required retrieval branch failed: ${retrievalTasks[index].domains.join(",")}`,
          "required_retrieval_branch_failed"
        );
      }
    }
  }

  // Tag neighbor-section candidates so the reranker can apply a moderate boost.
  if (neighborSectionIds.length > 0) {
    const neighborSet = new Set(neighborSectionIds);
    for (const candidate of candidates) {
      if (candidate.documentSectionId && neighborSet.has(candidate.documentSectionId)) {
        candidate.isNeighborSection = true;
      }
    }
  }

  const mergedCandidates = mergeCandidates(candidates);
  const passingScore = mergedCandidates.filter((candidate) => candidate.finalScore >= input.minScore);
  const filtered = filterByPlanAndRole(passingScore, input.plan, input.isClientContext);
  const finalCandidates = filtered.candidates.slice(0, input.plan?.initialCandidateLimit ?? filtered.candidates.length);
  return {
    candidates: finalCandidates,
    telemetry: {
      rawCandidateCount: candidates.length,
      denseCandidateCount: candidates.filter((candidate) => candidate.retrievalStage === "dense" || (candidate.vectorScore ?? 0) > 0).length,
      lexicalCandidateCount: candidates.filter((candidate) => candidate.retrievalStage === "lexical" || (candidate.lexicalScore ?? 0) > 0).length,
      brainCandidateCount,
      graphCandidateCount,
      graphTraversalCandidateCount: candidates.filter((candidate) => candidate.retrievalStage === "graph" || candidate.isGraphNeighbor || candidate.brainEdgeId).length,
      linkedEvidenceCandidateCount,
      mergedCandidateCount: mergedCandidates.length,
      droppedForbiddenDomainCount: filtered.droppedForbiddenDomainCount,
      droppedForClientSafetyCount: filtered.droppedForClientSafetyCount,
      retrievalBranchFailureCount,
    },
  };
}
