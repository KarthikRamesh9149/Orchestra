export const jobKeys = {
  parseDocument(documentVersionId: string, parseRevision: number) {
    return `parse:${documentVersionId}:${parseRevision}`;
  },
  chunkDocument(documentVersionId: string, parseRevision: number) {
    return `chunk:${documentVersionId}:${parseRevision}`;
  },
  embedDocumentChunks(documentVersionId: string, parseRevision: number) {
    return `embed:${documentVersionId}:${parseRevision}`;
  },
  generateSourcePackage(projectId: string, signature: string) {
    return `source-package:${projectId}:${signature}`;
  },
  generateClarifiedBrief(projectId: string, sourceArtifactId: string) {
    return `clarified-brief:${projectId}:${sourceArtifactId}`;
  },
  generateBrainGraph(projectId: string, clarifiedBriefArtifactId: string) {
    return `brain-graph:${projectId}:${clarifiedBriefArtifactId}`;
  },
  generateProductBrain(projectId: string, signature: string) {
    return `product-brain:${projectId}:${signature}`;
  },
  generateLiveDoc(projectId: string, signature: string) {
    return `live-doc:${projectId}:${signature}`;
  },
  applyAcceptedChange(proposalId: string) {
    return `apply-change:${proposalId}`;
  },
  precomputeSocratesSuggestions(projectId: string, sessionId: string) {
    return `socrates-suggestions:${projectId}:${sessionId}`;
  },
  syncCommunicationConnector(connectorId: string, syncType: string, cursorHash: string) {
    return `sync-connector:${connectorId}:${syncType}:${cursorHash}`;
  },
  ingestCommunicationBatch(connectorId: string, syncRunId: string, batchHash: string) {
    return `ingest-batch:${connectorId}:${syncRunId}:${batchHash}`;
  },
  indexCommunicationMessage(messageId: string, bodyHash: string) {
    return `index-message:${messageId}:${bodyHash}`;
  },
  indexProjectContextEntry(contextId: string, bodyHash: string) {
    return `context-entry:${contextId}:${bodyHash}`;
  },
  classifyMessageInsight(messageId: string, bodyHash: string) {
    return `classify-message:${messageId}:${bodyHash}`;
  },
  classifyThreadInsight(threadId: string, threadStateHash: string) {
    return `classify-thread:${threadId}:${threadStateHash}`;
  },
  generateChangeProposalFromInsight(insightId: string) {
    return `proposal-from-insight:${insightId}`;
  },
  refreshDashboardSnapshot(scope: "general" | "project", targetId: string, signature: string) {
    return `dashboard:${scope}:${targetId}:${signature}`;
  },
  deepResearchRun(projectId: string, runId: string) {
    return `deep-research:${projectId}:${runId}`;
  }
} as const;
