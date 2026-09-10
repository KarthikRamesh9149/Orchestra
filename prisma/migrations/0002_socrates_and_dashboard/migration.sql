-- Migration 0002: Socrates session/message/citation/target/suggestion tables + dashboard snapshots
-- Adds: all Feature 2 (Socrates) tables, dashboard_snapshot artifact type, and related enums.

-- Extend ArtifactType enum
ALTER TYPE "ArtifactType" ADD VALUE IF NOT EXISTS 'dashboard_snapshot';

-- New enums
CREATE TYPE "SocratesPageContext" AS ENUM (
  'dashboard_general',
  'dashboard_project',
  'brain_overview',
  'brain_graph',
  'doc_viewer',
  'client_view'
);

CREATE TYPE "SocratesSelectedRefType" AS ENUM (
  'document',
  'document_section',
  'brain_node',
  'change_proposal',
  'decision_record',
  'dashboard_scope'
);

CREATE TYPE "SocratesMessageRole" AS ENUM ('user', 'assistant');

CREATE TYPE "SocratesResponseStatus" AS ENUM ('streaming', 'completed', 'failed');

CREATE TYPE "SocratesCitationType" AS ENUM (
  'document_section',
  'document_chunk',
  'message',
  'brain_node',
  'change_proposal',
  'decision_record',
  'dashboard_snapshot'
);

CREATE TYPE "SocratesOpenTargetType" AS ENUM (
  'document_section',
  'message',
  'thread',
  'brain_node',
  'change_proposal',
  'decision_record',
  'dashboard_filter'
);

CREATE TYPE "DashboardSnapshotScope" AS ENUM ('general', 'project');

-- socrates_sessions
CREATE TABLE "socrates_sessions" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"        UUID NOT NULL REFERENCES "projects"("id"),
  "user_id"           UUID NOT NULL REFERENCES "users"("id"),
  "page_context"      "SocratesPageContext" NOT NULL,
  "selected_ref_type" "SocratesSelectedRefType",
  "selected_ref_id"   UUID,
  "viewer_state_json" JSONB,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "socrates_sessions_project_page_idx" ON "socrates_sessions"("project_id", "page_context");

-- socrates_messages
CREATE TABLE "socrates_messages" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"      UUID NOT NULL REFERENCES "socrates_sessions"("id"),
  "role"            "SocratesMessageRole" NOT NULL,
  "content"         TEXT NOT NULL,
  "response_status" "SocratesResponseStatus",
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "socrates_messages_session_idx" ON "socrates_messages"("session_id");

-- socrates_citations
CREATE TABLE "socrates_citations" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assistant_message_id" UUID NOT NULL REFERENCES "socrates_messages"("id"),
  "project_id"           UUID NOT NULL REFERENCES "projects"("id"),
  "citation_type"        "SocratesCitationType" NOT NULL,
  "ref_id"               UUID NOT NULL,
  "label"                TEXT NOT NULL,
  "page_number"          INTEGER,
  "confidence"           DECIMAL(4,3),
  "order_index"          INTEGER NOT NULL,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "socrates_citations_msg_idx" ON "socrates_citations"("assistant_message_id");

-- socrates_open_targets
CREATE TABLE "socrates_open_targets" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "assistant_message_id" UUID NOT NULL REFERENCES "socrates_messages"("id"),
  "target_type"          "SocratesOpenTargetType" NOT NULL,
  "target_payload_json"  JSONB NOT NULL,
  "order_index"          INTEGER NOT NULL,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX "socrates_open_targets_msg_idx" ON "socrates_open_targets"("assistant_message_id");

-- socrates_suggestions
CREATE TABLE "socrates_suggestions" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"       UUID NOT NULL REFERENCES "socrates_sessions"("id"),
  "page_context"     TEXT NOT NULL,
  "suggestions_json" JSONB NOT NULL,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at"       TIMESTAMPTZ(6)
);

CREATE INDEX "socrates_suggestions_session_page_idx" ON "socrates_suggestions"("session_id", "page_context");

-- dashboard_snapshots
CREATE TABLE "dashboard_snapshots" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"   UUID REFERENCES "projects"("id"),
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id"),
  "scope"        "DashboardSnapshotScope" NOT NULL,
  "payload_json" JSONB NOT NULL,
  "computed_at"  TIMESTAMPTZ(6) NOT NULL
);

CREATE INDEX "dashboard_snapshots_org_scope_idx" ON "dashboard_snapshots"("org_id", "scope", "computed_at" DESC);
CREATE INDEX "dashboard_snapshots_project_idx"   ON "dashboard_snapshots"("project_id", "scope", "computed_at" DESC);
