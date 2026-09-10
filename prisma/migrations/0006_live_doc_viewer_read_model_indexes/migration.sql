-- Migration 0006: Live Doc Viewer read-model indexes
--
-- Supports exact anchor/section lookup, stable section window paging,
-- document-version metadata reads, citation resolution, and section search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "document_versions_document_id_created_at_desc_idx"
  ON "document_versions" ("document_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "document_versions_project_id_status_processed_at_desc_idx"
  ON "document_versions" ("project_id", "status", "processed_at" DESC);

CREATE INDEX IF NOT EXISTS "document_sections_project_id_anchor_id_idx"
  ON "document_sections" ("project_id", "anchor_id");

CREATE INDEX IF NOT EXISTS "document_sections_project_id_page_number_order_index_idx"
  ON "document_sections" ("project_id", "page_number", "order_index");

CREATE INDEX IF NOT EXISTS "document_chunks_document_version_id_parse_revision_section_id_idx"
  ON "document_chunks" ("document_version_id", "parse_revision", "section_id");

CREATE INDEX IF NOT EXISTS "communication_threads_project_id_last_message_at_desc_idx"
  ON "communication_threads" ("project_id", "last_message_at" DESC);

CREATE INDEX IF NOT EXISTS "communication_messages_thread_id_sent_at_desc_idx"
  ON "communication_messages" ("thread_id", "sent_at" DESC);

CREATE INDEX IF NOT EXISTS "socrates_citations_project_id_citation_type_ref_id_idx"
  ON "socrates_citations" ("project_id", "citation_type", "ref_id");

CREATE INDEX IF NOT EXISTS "document_sections_normalized_text_trgm_idx"
  ON "document_sections" USING GIN ("normalized_text" gin_trgm_ops);
