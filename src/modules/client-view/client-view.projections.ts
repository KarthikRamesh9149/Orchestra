/**
 * Client-safe projection helpers.
 *
 * These functions take internal data structures and strip all manager/dev-only
 * fields before returning data to unauthenticated client portal users.
 *
 * INVARIANT: Nothing returned from these functions may reference:
 *  - raw communication message bodies or IDs
 *  - thread IDs, connector IDs, provider permalinks
 *  - internal user IDs (acceptedBy, createdBy, etc.)
 *  - draft/rejected/superseded artifacts
 *  - source_cluster brain nodes
 *  - source package or clarified brief internals
 *  - decision record internal details unless explicitly allowed
 */

import type { ClientShareConfig } from "./client-view.schemas.js";

const CLIENT_UNSAFE_TEXT_REPLACEMENT = "[redacted client-unsafe summary]";
const clientUnsafeTextPattern =
  /\b(provider|connector|thread|message|transcript|recording|credential|token|secret|api[_-]?key|OPENAI_API_KEY|ANTHROPIC_API_KEY|FIREFLIES_API_KEY|sk-[A-Za-z0-9_-]{12,}|xox[abprs]-[A-Za-z0-9-]{12,}|https?:\/\/(?:app\.fireflies\.ai|download\.fireflies\.ai|localhost|127\.0\.0\.1|10\.|172\.(?:1[6-9]|2\d|3[0-1])\.|192\.168\.))/i;

function clientSafeSummaryText(value: string) {
  const trimmed = value.trim();
  return clientUnsafeTextPattern.test(trimmed) ? CLIENT_UNSAFE_TEXT_REPLACEMENT : trimmed;
}

function clientSafeTextValue(value: unknown) {
  return clientSafeSummaryText(String(value ?? ""));
}

function clientSafeTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(clientSafeSummaryText) : [];
}

// ─── Brain projection ────────────────────────────────────────────────────────

export type ClientBrainNode = {
  id: string;
  nodeKey: string;
  nodeType: string;
  title: string;
  summary: string;
  status: string;
};

export type ClientBrainEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: string;
};

export type ClientSafeBrainPayload = {
  projectId: string;
  versionNumber: number;
  acceptedAt: string | null;
  summary: {
    whatTheProductIs: string;
    whoItIsFor: string;
    mainFlows: string[];
    modules: string[];
    constraints: string[];
    integrations: string[];
    unresolvedAreas: string[];
    recentAcceptedChangeSummaries: string[];
  };
};

export type ClientSafeGraphPayload = {
  versionNumber: number;
  nodes: ClientBrainNode[];
  edges: ClientBrainEdge[];
  meta: { filtered: boolean; hiddenInternalNodeCount: number };
};

export function projectBrainForClient(
  artifact: {
    id: string;
    projectId: string;
    versionNumber: number;
    acceptedAt: Date | null;
    payloadJson: unknown;
  },
  recentAcceptedChanges: Array<{ title: string; summary: string; acceptedAt: Date | null }>,
  config: ClientShareConfig
): ClientSafeBrainPayload {
  const payload = artifact.payloadJson as Record<string, unknown>;

  const unresolvedAreas = Array.isArray(payload["unresolvedAreas"])
    ? (payload["unresolvedAreas"] as string[])
    : [];

  const changeSummaries: string[] = config.showAcceptedChangeSummaries
    ? recentAcceptedChanges.slice(0, 5).map((c) => clientSafeSummaryText(c.summary))
    : [];

  return {
    projectId: artifact.projectId,
    versionNumber: artifact.versionNumber,
    acceptedAt: artifact.acceptedAt?.toISOString() ?? null,
    summary: {
      whatTheProductIs: clientSafeTextValue(payload["executiveSummary"]),
      whoItIsFor: clientSafeTextValue(payload["targetAudience"]),
      mainFlows: clientSafeTextArray(payload["mainFlows"]),
      modules: clientSafeTextArray(payload["modules"]),
      constraints: clientSafeTextArray(payload["constraints"]),
      integrations: clientSafeTextArray(payload["integrations"]),
      unresolvedAreas: unresolvedAreas.map(clientSafeSummaryText),
      recentAcceptedChangeSummaries: changeSummaries
    }
  };
}

// ─── INTERNAL NODE TYPES not safe for clients ────────────────────────────────

const INTERNAL_NODE_TYPES = new Set(["source_cluster"]);

export function projectGraphForClient(
  artifact: { versionNumber: number },
  nodes: Array<{
    id: string;
    nodeKey: string;
    nodeType: string;
    title: string;
    summary: string;
    status: string;
  }>,
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    edgeType: string;
  }>,
  clientSafeNodeIds: Set<string>
): ClientSafeGraphPayload {
  const totalNodes = nodes.length;

  const safeNodes = nodes.filter(
    (node) => clientSafeNodeIds.has(node.id) && !INTERNAL_NODE_TYPES.has(node.nodeType)
  );
  const safeNodeIdSet = new Set(safeNodes.map((n) => n.id));

  const safeEdges = edges.filter(
    (edge) => safeNodeIdSet.has(edge.fromNodeId) && safeNodeIdSet.has(edge.toNodeId)
  );

  return {
    versionNumber: artifact.versionNumber,
    nodes: safeNodes.map((node) => ({
      id: node.id,
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      title: clientSafeSummaryText(node.title),
      summary: clientSafeSummaryText(node.summary),
      status: node.status
    })),
    edges: safeEdges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.fromNodeId,
      targetNodeId: edge.toNodeId,
      edgeType: edge.edgeType
    })),
    meta: {
      filtered: true,
      hiddenInternalNodeCount: totalNodes - safeNodes.length
    }
  };
}

// ─── Document projection ─────────────────────────────────────────────────────

export type ClientSafeDocumentListItem = {
  id: string;
  title: string;
  kind: string;
  currentVersionId: string | null;
  updatedAt: string;
};

export type ClientSafeSection = {
  sectionId: string;
  anchorId: string;
  pageNumber: number | null;
  headingPath: string[];
  orderIndex: number;
  text: string;
  hasAcceptedChanges: boolean;
  acceptedChangeSummaries: string[];
};

export type ClientSafeDocumentSectionOpenTarget = {
  targetType: "document_section";
  targetRef: {
    documentId: string;
    documentVersionId: string;
    anchorId: string;
    pageNumber?: number;
  };
};

export type ClientSafeViewerPayload = {
  document: ClientSafeDocumentListItem;
  sections: ClientSafeSection[];
};

export type ClientSafeProvenance = {
  sectionId: string;
  anchorId: string;
  headingPath: string[];
  text: string;
  acceptedChangeSummaries: string[];
  adjacentSections: Array<{ sectionId: string; anchorId: string; headingPath: string[]; text: string }>;
};

export function projectDocumentListForClient(
  documents: Array<{
    id: string;
    title: string;
    kind: string;
    currentVersionId: string | null;
    updatedAt: Date;
  }>
): ClientSafeDocumentListItem[] {
  return documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    currentVersionId: doc.currentVersionId,
    updatedAt: doc.updatedAt.toISOString()
  }));
}

export function projectSectionForClient(
  section: {
    id: string;
    anchorId: string;
    pageNumber: number | null;
    headingPath: string[];
    orderIndex: number;
    normalizedText: string;
  },
  acceptedChangeSummaries: string[]
): ClientSafeSection {
  return {
    sectionId: section.id,
    anchorId: section.anchorId,
    pageNumber: section.pageNumber,
    headingPath: section.headingPath,
    orderIndex: section.orderIndex,
    text: section.normalizedText,
    hasAcceptedChanges: acceptedChangeSummaries.length > 0,
    // Only expose summary text — never proposal ids, acceptedBy, message refs
    acceptedChangeSummaries: acceptedChangeSummaries.map(clientSafeSummaryText)
  };
}

// ─── Change summary projection ────────────────────────────────────────────────

export type ClientSafeChangeSummary = {
  title: string;
  summary: string;
  acceptedAt: string | null;
};

export function projectAcceptedChangeForClient(proposal: {
  title: string;
  summary: string;
  acceptedAt: Date | null;
}): ClientSafeChangeSummary {
  return {
    title: clientSafeSummaryText(proposal.title),
    summary: clientSafeSummaryText(proposal.summary),
    acceptedAt: proposal.acceptedAt?.toISOString() ?? null
  };
}

// ─── Project summary projection ───────────────────────────────────────────────

export type ClientSafeProjectSummary = {
  project: {
    id: string;
    name: string;
    description: string | null;
    previewUrl: string | null;
  };
  summary: {
    whatTheProductIs: string;
    whoItIsFor: string;
    mainFlows: string[];
    currentScope: string[];
    recentAcceptedChanges: ClientSafeChangeSummary[];
    openClientVisibleAreas: string[];
    sharedDocumentCount: number;
    latestUpdateAt: string | null;
  };
  updatedAt: string;
};

export function buildClientProjectSummary(input: {
  project: { id: string; name: string; description: string | null; previewUrl: string | null };
  brain: { payloadJson: unknown; acceptedAt: Date | null } | null;
  recentChanges: Array<{ title: string; summary: string; acceptedAt: Date | null }>;
  sharedDocumentCount: number;
  config: ClientShareConfig;
}): ClientSafeProjectSummary {
  const payload = input.brain?.payloadJson as Record<string, unknown> | undefined;

  const recentAcceptedChanges: ClientSafeChangeSummary[] = input.config.showAcceptedChangeSummaries
    ? input.recentChanges.slice(0, 5).map(projectAcceptedChangeForClient)
    : [];

  const latestUpdateAt =
    input.recentChanges[0]?.acceptedAt?.toISOString() ??
    input.brain?.acceptedAt?.toISOString() ??
    null;

  return {
    project: {
      id: input.project.id,
      name: input.project.name,
      description: input.project.description,
      previewUrl: input.project.previewUrl
    },
    summary: {
      whatTheProductIs: clientSafeTextValue(payload?.["executiveSummary"]),
      whoItIsFor: clientSafeTextValue(payload?.["targetAudience"]),
      mainFlows: clientSafeTextArray(payload?.["mainFlows"]),
      currentScope: clientSafeTextArray(payload?.["modules"]),
      recentAcceptedChanges,
      openClientVisibleAreas: Array.isArray(payload?.["unresolvedAreas"])
        ? (payload["unresolvedAreas"] as string[]).map(clientSafeSummaryText)
        : [],
      sharedDocumentCount: input.sharedDocumentCount,
      latestUpdateAt
    },
    updatedAt: new Date().toISOString()
  };
}
