-- Migration 0005: Embedded communication retrieval support
--
-- Adds chunked + embedded communication message indexing so Socrates can
-- retrieve communication evidence by semantic similarity instead of lexical
-- matching only.

CREATE TABLE "communication_message_chunks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "thread_id" UUID NOT NULL REFERENCES "communication_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "project_id" UUID NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "chunk_index" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "contextual_content" TEXT,
  "lexical_content" TEXT NOT NULL,
  "embedding" vector(1536),
  "token_count" INTEGER NOT NULL,
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "communication_message_chunks_message_chunk_key"
  ON "communication_message_chunks"("message_id", "chunk_index");

CREATE INDEX "communication_message_chunks_project_thread_idx"
  ON "communication_message_chunks"("project_id", "thread_id");

CREATE INDEX "communication_message_chunks_message_idx"
  ON "communication_message_chunks"("message_id");

CREATE INDEX "communication_message_chunks_embedding_idx"
  ON "communication_message_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);

CREATE INDEX "communication_message_chunks_lexical_content_idx"
  ON "communication_message_chunks" USING GIN (to_tsvector('english', "lexical_content"));
