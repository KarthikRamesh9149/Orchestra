export const JobNames = {
  parseDocument: "parse_document",
  chunkDocument: "chunk_document",
  embedDocumentChunks: "embed_document_chunks",
  generateSourcePackage: "generate_source_package",
  generateClarifiedBrief: "generate_clarified_brief",
  generateBrainGraph: "generate_brain_graph",
  generateProductBrain: "generate_product_brain",
  generateLiveDoc: "generate_live_doc",
  applyAcceptedChange: "apply_accepted_change",
  precomputeSocratesSuggestions: "precompute_socrates_suggestions",
  refreshDashboardSnapshot: "refresh_dashboard_snapshot",
  syncCommunicationConnector: "sync_communication_connector",
  ingestCommunicationBatch: "ingest_communication_batch",
  indexCommunicationMessage: "index_communication_message",
  indexProjectContextEntry: "index_project_context_entry",
  classifyMessageInsight: "classify_message_insight",
  classifyThreadInsight: "classify_thread_insight",
  generateChangeProposalFromInsight: "generate_change_proposal_from_insight",
  syncCalendarConnection: "sync_calendar_connection",
  syncGoogleDriveConnection: "sync_google_drive_connection",
  deepResearchRun: "deep_research_run"
} as const;

export type JobName = (typeof JobNames)[keyof typeof JobNames];

export interface JobDispatcher {
  enqueue<TPayload>(name: JobName, payload: TPayload, idempotencyKey: string): Promise<void>;
}
